/*
 * Author: madhusudhan
 * Check the LICENSE in the GitHub repo (https://github.com/Lumorix-studios/Struct) for more information on permissions to use this code.
 */
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::io::Write;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, UNIX_EPOCH};
use tauri::{Emitter, Manager};

/// Windows-only: CREATE_NO_WINDOW stops child processes from flashing or
/// keeping open a visible OS console window.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Mark a child process as windowless on Windows (no-op on other platforms).
/// Every background spawn (ollama probes, the ollama server, agent
/// `run_command`) must go through this or a console window pops up over the
/// app each time the command runs.
fn suppress_window(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = cmd;
    cmd
}

/// The shell to spawn for the integrated terminal.
///
/// Prefers `$SHELL` so people get the shell they actually configured (zsh, fish,
/// …), then walks a short candidate list, then falls back to `/bin/sh`, which
/// POSIX guarantees. Every candidate is checked for existence first: the previous
/// hardcoded `/bin/bash` meant the terminal simply refused to start on distros
/// that ship only dash or busybox ash.
fn default_shell() -> String {
    #[cfg(windows)]
    {
        // PowerShell first (it is what the rest of the Windows paths assume),
        // then cmd.exe as the guaranteed fallback.
        for candidate in ["powershell.exe", "cmd.exe"] {
            if which(candidate) {
                return candidate.to_string();
            }
        }
        "cmd.exe".to_string()
    }

    #[cfg(not(windows))]
    {
        let from_env = std::env::var("SHELL").ok().filter(|s| !s.is_empty());
        let mut candidates: Vec<String> = Vec::new();
        if let Some(shell) = from_env {
            candidates.push(shell);
        }
        candidates.extend(
            ["/bin/bash", "/usr/bin/bash", "/bin/zsh", "/usr/bin/zsh", "/bin/sh"]
                .iter()
                .map(|s| s.to_string()),
        );
        for candidate in &candidates {
            if which(candidate) {
                return candidate.clone();
            }
        }
        // Nothing was found; /bin/sh is the POSIX-guaranteed path, so let the
        // spawn attempt produce the real error rather than failing here.
        "/bin/sh".to_string()
    }
}

/// True when `name` resolves to an executable on PATH (Windows) or is an
/// existing file (Unix, where PATH lookups for an absolute path still apply).
fn which(name: &str) -> bool {
    #[cfg(windows)]
    {
        if name.contains('\\') || name.contains('/') {
            return Path::new(name).is_file();
        }
        let Some(path) = std::env::var_os("PATH") else {
            return false;
        };
        std::env::split_paths(&path).any(|dir| {
            let candidate = dir.join(format!("{name}.exe"));
            candidate.is_file()
        })
    }

    #[cfg(not(windows))]
    {
        Path::new(name).is_file()
    }
}

/// A server this app is responsible for stopping.
enum TrackedServer {
    /// Spawned by this session: live child handle + PID.
    Child(Child, u32),
    /// Orphan from a previous app session, adopted via the PID record. There
    /// is no child handle, but the process tree can still be killed by PID.
    Adopted(u32),
}

/// Track the Ollama server we are responsible for so we can stop it later.
struct ServerState(Mutex<Option<TrackedServer>>);

/// The optional Code OSS-compatible workbench process managed by Neo.
struct CompatibleIdeProcess {
    child: Child,
    url: String,
    workspace: PathBuf,
}

struct CompatibleIdeState(Mutex<Option<CompatibleIdeProcess>>);

/// Set while `start_ollama_server` spawns + waits, so concurrent callers
/// (the local-models panel and the model-switch guard) can't double-spawn:
/// the second spawn would overwrite the first one's live child handle with
/// the dead "bind: address already in use" loser.
static SERVER_STARTING: AtomicBool = AtomicBool::new(false);

/// Result of `start_ollama_server`. Tells the UI exactly what happened so it
/// never claims "started" when the port was actually served by something else
/// (the Ollama tray app, another tool, or an orphan from a previous session).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaStartStatus {
    /// An Ollama server is reachable on port 11434.
    running: bool,
    /// It was already running before this call — we did not spawn a process.
    already_running: bool,
    /// True when the running server belongs to this app session. If false the
    /// server was started outside the app and "Stop" must not kill it.
    owned: bool,
    /// True when the server is an orphan left behind by a previous session of
    /// this app that we re-adopted — "Stop" works on it again.
    adopted: bool,
}

/// Result of `stop_ollama_server`.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaStopStatus {
    /// A server owned by this app was stopped.
    stopped: bool,
    /// A server is still listening on 11434 but was started outside the app.
    still_running_external: bool,
}

/// True when Ollama answers both its health and model-list endpoints.
/// `/api/version` alone can succeed while the server is not usable for chats.
fn ollama_port_responds() -> bool {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_millis(1500))
        .build()
        .ok();
    if let Some(c) = client {
        let version_ok = c
            .get("http://127.0.0.1:11434/api/version")
            .send()
            .map(|r| r.status().is_success())
            .unwrap_or(false);
        let tags_ok = c
            .get("http://127.0.0.1:11434/api/tags")
            .send()
            .map(|r| r.status().is_success())
            .unwrap_or(false);
        return version_ok && tags_ok;
    }
    false
}

// ---------------------------------------------------------------------------
// Owned-server bookkeeping
//
// The packaged exe can die without a clean exit (crash, Task Manager kill,
// Windows shutdown). `RunEvent::Exit` never fires in those cases, so the
// spawned `ollama serve` survives as an orphan holding port 11434. The next
// session used to see the port up, have no tracked child, and report the
// server as "external" — leaving the user with a server the app refuses to
// stop. The PID record file below fixes that: every spawn records its PID,
// and the next session adopts (and can stop) an orphan that is still ours.
// ---------------------------------------------------------------------------

/// Where the PID of the server we spawned is recorded (a plain number).
fn server_record_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    data_dir(app).ok().map(|d| d.join("ollama_server.pid"))
}

fn record_pid(app: &tauri::AppHandle, pid: u32) {
    if let Some(file) = server_record_file(app) {
        if let Some(dir) = file.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let _ = fs::write(&file, pid.to_string());
    }
}

fn recorded_pid(app: &tauri::AppHandle) -> Option<u32> {
    let file = server_record_file(app)?;
    fs::read_to_string(file).ok()?.trim().parse::<u32>().ok()
}

fn clear_pid_record(app: &tauri::AppHandle) {
    if let Some(file) = server_record_file(app) {
        let _ = fs::remove_file(file);
    }
}

/// True when the PID belongs to a live `ollama` process (windowless probes).
fn pid_is_ollama(pid: u32) -> bool {
    #[cfg(windows)]
    {
        let mut probe = Command::new("tasklist");
        probe.args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"]);
        probe.stdout(Stdio::piped()).stderr(Stdio::null());
        suppress_window(&mut probe);
        probe
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase().contains("ollama"))
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        let mut probe = Command::new("ps");
        probe.args(["-p", &pid.to_string(), "-o", "comm="]);
        probe
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase().contains("ollama"))
            .unwrap_or(false)
    }
}

/// PIDs of processes listening on the given TCP port. Used by "Stop" to find
/// whoever holds port 11434 when nothing of ours is running. Parsing is
/// locale-proof: only the local-address column (…:port) and the trailing PID
/// are used, never the state string (which is localized on some Windows).
fn port_listener_pids(port: u16) -> Vec<u32> {
    #[cfg(windows)]
    {
        let mut probe = Command::new("netstat");
        probe.args(["-ano", "-p", "tcp"]);
        probe.stdout(Stdio::piped()).stderr(Stdio::null());
        suppress_window(&mut probe);
        let Ok(output) = probe.output() else {
            return Vec::new();
        };
        let text = String::from_utf8_lossy(&output.stdout);
        let mut pids: Vec<u32> = Vec::new();
        for line in text.lines() {
            // Columns: Proto  Local  Foreign  State  PID (state may be
            // localized, so only rely on column count >= 4 + numeric PID).
            let cols: Vec<&str> = line.split_whitespace().collect();
            if cols.len() < 4 {
                continue;
            }
            let local = cols[1];
            let is_our_port = local
                .rsplit(':')
                .next()
                .map(|p| p == port.to_string())
                .unwrap_or(false);
            if !is_our_port {
                continue;
            }
            // The PID is the last column on netstat -ano rows.
            if let Some(last) = cols.last() {
                if let Ok(pid) = last.parse::<u32>() {
                    if pid > 0 && !pids.contains(&pid) {
                        pids.push(pid);
                    }
                }
            }
        }
        pids
    }
    #[cfg(not(windows))]
    {
        let mut probe = Command::new("lsof");
        probe.args(["-t", &format!("tcp:{port}")]);
        probe.stdout(Stdio::piped()).stderr(Stdio::null());
        suppress_window(&mut probe);
        let Ok(output) = probe.output() else {
            return Vec::new();
        };
        String::from_utf8_lossy(&output.stdout)
            .split_whitespace()
            .filter_map(|t| t.parse::<u32>().ok())
            .collect()
    }
}

/// Kill a process and, on Windows, its whole child tree. Plain
/// `Child::kill()` leaves the model-runner children of `ollama serve` behind.
fn kill_pid_tree(pid: u32) {
    #[cfg(windows)]
    {
        let mut killer = Command::new("taskkill");
        killer.args(["/PID", &pid.to_string(), "/T", "/F"]);
        killer.stdout(Stdio::null()).stderr(Stdio::null());
        suppress_window(&mut killer);
        let _ = killer.status();
    }
    #[cfg(not(windows))]
    {
        let mut killer = Command::new("kill");
        killer.arg("-9").arg(pid.to_string());
        let _ = killer.status();
    }
}

/// True when the server's model-list endpoint answers. `/api/version` alone
/// can be answered by a wedged or orphaned server while every real model
/// call fails, so "started" must mean this works too.
fn ollama_models_endpoint_ok(client: &reqwest::blocking::Client) -> bool {
    client
        .get("http://127.0.0.1:11434/api/tags")
        .send()
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

/// Drop dead tracked-server entries, reporting whether a live one remains.
/// A stored child can die at any time (e.g. it failed to bind because another
/// program held port 11434) — a stale handle would make "stop" silently do
/// nothing and "start" spawn duplicates. Adopted PIDs are re-verified too.
fn refresh_tracked(state: &ServerState) -> bool {
    let Ok(mut guard) = state.0.lock() else {
        return false;
    };
    match guard.take() {
        Some(TrackedServer::Child(mut child, pid)) => match child.try_wait() {
            // Still running — we own the live server.
            Ok(None) => {
                *guard = Some(TrackedServer::Child(child, pid));
                true
            }
            // Exited already (or can't tell) — drop the stale handle.
            _ => false,
        },
        Some(TrackedServer::Adopted(pid)) => {
            if pid_is_ollama(pid) {
                *guard = Some(TrackedServer::Adopted(pid));
                true
            } else {
                false
            }
        }
        None => false,
    }
}

#[tauri::command]
fn save_state(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    validate_state_key(&key)?;
    let dir = data_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create data dir: {e}"))?;
    let file = dir.join(format!("{key}.json"));
    fs::write(&file, value).map_err(|e| format!("Failed to write {}: {e}", file.display()))
}

#[tauri::command]
fn load_state(app: tauri::AppHandle, key: String) -> Result<String, String> {
    validate_state_key(&key)?;
    let dir = data_dir(&app)?;
    let file = dir.join(format!("{key}.json"));
    match fs::read_to_string(&file) {
        Ok(content) => Ok(content),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok("".into()),
        Err(error) => Err(format!("Failed to read {}: {error}", file.display())),
    }
}

fn validate_state_key(key: &str) -> Result<(), String> {
    if key.is_empty()
        || key.chars().any(|c| matches!(c, '\\' | '/' | ':'))
        || key == "."
        || key == ".."
        || key.contains("..")
    {
        return Err("Invalid state key.".into());
    }
    Ok(())
}

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))
}

/// Detect whether Ollama is installed on the system.
#[tauri::command]
fn check_ollama_installed() -> bool {
    // Check common install locations and PATH
    let candidates = [
        "ollama",
        "ollama.exe",
        "C:\\Users\\%USERNAME%\\AppData\\Local\\Programs\\Ollama\\ollama.exe",
        "/usr/local/bin/ollama",
        "/opt/homebrew/bin/ollama",
        "/usr/bin/ollama",
    ];

    for cmd in candidates {
        if cmd.contains("%USERNAME%") {
            // Expand %USERNAME% on Windows
            if let Ok(username) = std::env::var("USERNAME") {
                let expanded = cmd.replace("%USERNAME%", &username);
                if PathBuf::from(&expanded).exists() {
                    return true;
                }
            }
            continue;
        }
        if PathBuf::from(cmd).exists() {
            return true;
        }
    }

    // Also check if `ollama` is on PATH (windowless — this runs on startup
    // and used to flash a console every time).
    let mut probe = Command::new("ollama");
    probe
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    suppress_window(&mut probe);
    probe
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Check if the Ollama server is currently running (port 11434).
#[tauri::command]
fn check_ollama_running() -> bool {
    ollama_port_responds()
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaHttpResponse {
    status: u16,
    body: String,
}

/// Make Ollama requests from Rust so packaged WebView/plugin origins cannot
/// trigger Ollama's 403 origin policy.
#[tauri::command]
fn ollama_request(
    url: String,
    method: String,
    body: Option<String>,
) -> Result<OllamaHttpResponse, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("Invalid Ollama URL: {e}"))?;
    if !matches!(parsed.host_str(), Some("127.0.0.1") | Some("localhost"))
        || parsed.port_or_known_default() != Some(11434)
    {
        return Err("Ollama requests must target localhost:11434.".into());
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| format!("Failed to build Ollama client: {e}"))?;
    let request_method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|e| format!("Invalid Ollama method: {e}"))?;
    let mut request = client
        .request(request_method, parsed)
        .header("Content-Type", "application/json");
    if let Some(payload) = body {
        request = request.body(payload);
    }
    let response = request
        .send()
        .map_err(|e| format!("Failed to reach Ollama: {e}"))?;
    let status = response.status().as_u16();
    let response_body = response
        .text()
        .map_err(|e| format!("Failed to read Ollama response: {e}"))?;
    Ok(OllamaHttpResponse {
        status,
        body: response_body,
    })
}

/// Start the Ollama server as a background process.
///
/// Never blindly spawns a duplicate: if something already serves Ollama on
/// port 11434 the app connects to it. That server is either ours (tracked
/// child → owned), an orphan from a previous session (recognized through the
/// PID record → adopted, so "Stop" works again), or genuinely external (the
/// Ollama tray app, another tool → reused but reported as external so "Stop"
/// won't kill it). When we do spawn, we wait until the server actually
/// answers both its version and model-list endpoints — `ollama serve` exits
/// immediately when the port is taken by a non-Ollama program, and reporting
/// "started" in that case broke every model call that followed.
#[tauri::command]
fn start_ollama_server(
    app: tauri::AppHandle,
    state: tauri::State<'_, ServerState>,
) -> Result<OllamaStartStatus, String> {
    // Serialize: two concurrent starts would spawn twice and the second store
    // would overwrite the first one's live child handle with the dead
    // "bind: address already in use" loser.
    if SERVER_STARTING
        .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
        .is_err()
    {
        // Another start is in flight — wait for it to settle, then report.
        for _ in 0..60 {
            thread::sleep(std::time::Duration::from_millis(250));
            if !SERVER_STARTING.load(Ordering::Relaxed) {
                break;
            }
        }
        let owned = refresh_tracked(&state);
        return Ok(OllamaStartStatus {
            running: ollama_port_responds(),
            already_running: true,
            owned,
            adopted: false,
        });
    }
    let result = do_start_ollama(&app, &state);
    SERVER_STARTING.store(false, Ordering::Release);
    result
}

fn do_start_ollama(
    app: &tauri::AppHandle,
    state: &ServerState,
) -> Result<OllamaStartStatus, String> {
    // Drop a stale child handle if the previously-spawned child already died.
    let owned = refresh_tracked(state);

    // If an Ollama server is already up, reuse it — spawning a second one
    // would die with "bind: address already in use" and corrupt our state.
    if ollama_port_responds() {
        if owned {
            return Ok(OllamaStartStatus {
                running: true,
                already_running: true,
                owned: true,
                adopted: false,
            });
        }
        
        if let Some(pid) = recorded_pid(app) {
            if pid_is_ollama(pid) {
                if let Ok(mut guard) = state.0.lock() {
                    *guard = Some(TrackedServer::Adopted(pid));
                }
                return Ok(OllamaStartStatus {
                    running: true,
                    already_running: true,
                    owned: true,
                    adopted: true,
                });
            }
            // Stale record for a process that is gone — clear it.
            clear_pid_record(app);
        }
        // Genuinely external (the Ollama tray app, another tool) — reuse only.
        return Ok(OllamaStartStatus {
            running: true,
            already_running: true,
            owned: false,
            adopted: false,
        });
    }

    // Find the ollama binary
    let ollama_bin = find_ollama_binary()?;

    // Spawn the server in the background (windowless — the server outlives
    // the request and must never own a visible console).
    let mut cmd = Command::new(&ollama_bin);
    cmd.arg("serve").stdout(Stdio::null()).stderr(Stdio::null());
    suppress_window(&mut cmd);
    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start Ollama server: {e}"))?;
    let pid = child.id();

    // Record the PID so a future session can adopt (or stop) this server if
    // this session dies without a clean exit (crash, Task Manager, shutdown).
    record_pid(app, pid);

    // Store the child process so we can stop it later
    if let Ok(mut guard) = state.0.lock() {
        *guard = Some(TrackedServer::Child(child, pid));
    }

    // Wait (up to ~15s) for the server to bind and answer. Bail out early if
    // the process dies — that's how "address already in use" manifests.
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_millis(1500))
        .build()
        .ok();
    for _ in 0..30 {
        thread::sleep(std::time::Duration::from_millis(500));
        if let Some(c) = &client {
            let version_ok = c
                .get("http://127.0.0.1:11434/api/version")
                .send()
                .map(|r| r.status().is_success())
                .unwrap_or(false);
            // "Started" must mean the server can actually serve models, not
            // just answer a version ping — a wedged/orphaned server can do
            // the latter while every model call fails.
            if version_ok && ollama_models_endpoint_ok(c) {
                return Ok(OllamaStartStatus {
                    running: true,
                    already_running: false,
                    owned: true,
                    adopted: false,
                });
            }
        }
        let died = {
            let mut guard = state
                .0
                .lock()
                .map_err(|e| format!("State lock error: {e}"))?;
            match guard.as_mut() {
                Some(TrackedServer::Child(child, _)) => {
                    matches!(child.try_wait(), Ok(Some(_)) | Err(_))
                }
                _ => true,
            }
        };
        if died {
            // Clean up the dead handle + stale record so the next start
            // isn't confused.
            if let Ok(mut guard) = state.0.lock() {
                *guard = None;
            }
            clear_pid_record(app);
            return Err(
                "The Ollama server exited right after starting. Port 11434 is likely used by \
                 another program (check with: netstat -ano | findstr 11434), or the Ollama \
                 install is broken."
                    .into(),
            );
        }
    }

    // Server didn't come up in time — kill it (and its tree) and report the
    // failure honestly.
    {
        let mut guard = state.0.lock().map_err(|e| format!("State lock error: {e}"))?;
        if let Some(TrackedServer::Child(mut child, pid)) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
            kill_pid_tree(pid);
        }
    }
    clear_pid_record(app);
    Err("The Ollama server did not respond on port 11434 within 15 seconds.".into())
}

/// Stop the Ollama server on port 11434. The app's own servers (spawned or
/// adopted) are stopped directly; any other Ollama process listening on the
/// port (the Ollama tray app's server, an orphan whose PID record was lost)
/// is found via netstat and stopped too — "Stop" should never leave an
/// Ollama server the user cannot reach running. A port held by a process
/// that is not Ollama is left alone and reported as external.
#[tauri::command]
fn stop_ollama_server(
    app: tauri::AppHandle,
    state: tauri::State<'_, ServerState>,
) -> Result<OllamaStopStatus, String> {
    let killed = {
        let mut guard = state.0.lock().map_err(|e| format!("State lock error: {e}"))?;
        match guard.take() {
            Some(TrackedServer::Child(mut child, pid)) => {
                let was_running = matches!(child.try_wait(), Ok(None));
                let _ = child.kill();
                let _ = child.wait();
                // `kill()` doesn't take the process tree with it — the server
                // keeps model-runner children alive. Reap the whole tree.
                kill_pid_tree(pid);
                was_running
            }
            Some(TrackedServer::Adopted(pid)) => {
                kill_pid_tree(pid);
                true
            }
            None => false,
        }
    };
    if killed {
        clear_pid_record(&app);
        // Report accurately once the port is actually released.
        for _ in 0..10 {
            if !ollama_port_responds() {
                return Ok(OllamaStopStatus {
                    stopped: true,
                    still_running_external: false,
                });
            }
            thread::sleep(std::time::Duration::from_millis(300));
        }
        return Ok(OllamaStopStatus {
            stopped: true,
            still_running_external: false,
        });
    }
    // Nothing tracked this session. An orphan from a previous session may
    // still hold the port — if the PID record names a live ollama process,
    // it is ours: stop it instead of telling the user to close something
    // they have no window or tray icon for.
    if let Some(pid) = recorded_pid(&app) {
        if pid_is_ollama(pid) {
            kill_pid_tree(pid);
            clear_pid_record(&app);
            for _ in 0..10 {
                if !ollama_port_responds() {
                    break;
                }
                thread::sleep(std::time::Duration::from_millis(300));
            }
            return Ok(OllamaStopStatus {
                stopped: true,
                still_running_external: false,
            });
        }
        // Stale record for a process that is gone — clear it.
        clear_pid_record(&app);
    }
    // Nothing of ours is running (or the PID record didn't match), yet the
    // port still answers. Find whoever is listening on 11434 and stop it
    // when it is an Ollama process — that covers the Ollama tray app's own
    // server and any orphan whose PID record was lost. The user pressed
    // "Stop"; leaving a server they cannot reach running helps nobody.
    // Only a non-Ollama program squatting on the port is left alone.
    let mut killed_external_ollama = false;
    for pid in port_listener_pids(11434) {
        if pid_is_ollama(pid) {
            kill_pid_tree(pid);
            killed_external_ollama = true;
        }
    }
    if killed_external_ollama {
        clear_pid_record(&app);
        for _ in 0..10 {
            if !ollama_port_responds() {
                break;
            }
            thread::sleep(std::time::Duration::from_millis(300));
        }
        return Ok(OllamaStopStatus {
            stopped: true,
            still_running_external: false,
        });
    }
    // A server still listening now was NOT started by Ollama (or could not
    // be identified) — don't touch processes we can't vouch for.
    let still_running_external = ollama_port_responds();
    Ok(OllamaStopStatus {
        stopped: false,
        still_running_external,
    })
}

/// List installed local models via the Ollama API.
#[tauri::command]
fn list_local_models() -> Result<Vec<serde_json::Value>, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let resp = client
        .get("http://127.0.0.1:11434/api/tags")
        .send()
        .map_err(|e| format!("Failed to reach Ollama server: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Ollama API returned status {}", resp.status()));
    }

    let json: serde_json::Value = resp
        .json()
        .map_err(|e| format!("Failed to parse Ollama response: {e}"))?;

    let models = json
        .get("models")
        .and_then(|m| m.as_array())
        .cloned()
        .unwrap_or_default();

    Ok(models)
}

/// Pull a model from the Ollama registry. Downloads can take many minutes
/// for multi-GB models, so this uses a very long timeout and reports any
/// registry error verbatim.
#[tauri::command]
fn pull_local_model(model_name: String) -> Result<bool, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60 * 60)) // 1 hour
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let resp = client
        .post("http://127.0.0.1:11434/api/pull")
        .json(&serde_json::json!({ "name": model_name, "stream": false }))
        .send()
        .map_err(|e| format!("Failed to reach Ollama while pulling: {e}"))?;

    let status = resp.status();
    // Surface registry errors ("model not found", auth issues, disk full…)
    let body = resp.text().unwrap_or_default();
    if !status.is_success() {
        return Err(format!("Pull failed (HTTP {status}): {body}"));
    }
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&body) {
        if let Some(err) = v.get("error").and_then(|e| e.as_str()) {
            return Err(format!("Pull failed: {err}"));
        }
    }

    Ok(true)
}

/// Delete a local model.
#[tauri::command]
fn delete_local_model(model_name: String) -> Result<bool, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let resp = client
        .delete("http://127.0.0.1:11434/api/delete")
        .json(&serde_json::json!({ "name": model_name }))
        .send()
        .map_err(|e| format!("Failed to delete model: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Failed to delete model: HTTP {}", resp.status()));
    }

    Ok(true)
}


#[derive(serde::Serialize)]
struct FsEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: Option<u64>,
    modified: Option<u64>,
}

fn meta_to_entry(path: &Path) -> FsEntry {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned());
    let md = fs::metadata(path).ok();
    let modified = md
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs());
    FsEntry {
        name,
        path: path.to_string_lossy().into_owned(),
        is_dir: md.as_ref().map(|m| m.is_dir()).unwrap_or(false),
        size: md.as_ref().map(|m| m.len()),
        modified,
    }
}

/// Read the full contents of a text file.
#[tauri::command]
fn fs_read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read {path}: {e}"))
}

/// Read a specific line range of a file. `end_line = 0` means "until EOF".
#[tauri::command]
fn fs_read_file_range(path: String, start_line: usize, end_line: usize) -> Result<String, String> {
    let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read {path}: {e}"))?;
    let lines: Vec<&str> = content.lines().collect();
    let start = start_line.saturating_sub(1);
    if start >= lines.len() {
        return Ok(String::new());
    }
    let end = if end_line == 0 {
        lines.len()
    } else {
        end_line.min(lines.len())
    };
    Ok(lines[start..end].join("\n"))
}

/// Create a new file, or overwrite an existing one, with the given content.
#[tauri::command]
fn fs_write_file(path: String, content: String) -> Result<bool, String> {
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create dir {}: {e}", parent.display()))?;
    }
    fs::write(&p, content).map_err(|e| format!("Failed to write {path}: {e}"))?;
    Ok(true)
}

/// Append text to the end of a file, creating it if it doesn't exist.
#[tauri::command]
fn fs_append_file(path: String, content: String) -> Result<bool, String> {
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Failed to open {path}: {e}"))?;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("Failed to append to {path}: {e}"))?;
    Ok(true)
}

/// Replace exact occurrence(s) of `search` with `replace` in a file.
/// Replaces the first occurrence, or every occurrence when `all` is true.
#[tauri::command]
fn fs_replace_in_file(
    path: String,
    search: String,
    replace: String,
    all: Option<bool>,
) -> Result<bool, String> {
    let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read {path}: {e}"))?;
    if !content.contains(&search) {
        return Err(format!("Search text not found in {path}"));
    }
    let count = if all.unwrap_or(false) {
        content.matches(&search).count()
    } else {
        1
    };
    let updated = content.replacen(&search, &replace, count);
    fs::write(&path, updated).map_err(|e| format!("Failed to write {path}: {e}"))?;
    Ok(true)
}

/// Permanently delete a file.
#[tauri::command]
fn fs_delete_file(path: String) -> Result<bool, String> {
    fs::remove_file(&path).map_err(|e| format!("Failed to delete {path}: {e}"))?;
    Ok(true)
}

/// Stat a path: type, byte size and modification time (unix ms).
#[tauri::command]
fn fs_stat(path: String) -> Result<serde_json::Value, String> {
    let meta = fs::metadata(&path).map_err(|e| format!("Failed to stat {path}: {e}"))?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);
    Ok(serde_json::json!({
        "path": path,
        "isDir": meta.is_dir(),
        "size": if meta.is_dir() { serde_json::Value::Null } else { serde_json::json!(meta.len()) },
        "modified": modified,
    }))
}

/// Copy a file to a new location (creates parent folders of the destination).
#[tauri::command]
fn fs_copy_file(path: String, new_path: String) -> Result<bool, String> {
    if let Some(parent) = std::path::Path::new(&new_path).parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::copy(&path, &new_path)
        .map_err(|e| format!("Failed to copy {path} → {new_path}: {e}"))?;
    Ok(true)
}

/// Replace an inclusive line range with new content. `end_line = 0` means
/// "from start_line to EOF". Returns the new file size in bytes.
#[tauri::command]
fn fs_write_file_range(
    path: String,
    start_line: usize,
    end_line: usize,
    content: String,
) -> Result<usize, String> {
    let text = fs::read_to_string(&path).map_err(|e| format!("Failed to read {path}: {e}"))?;
    let nl: &str = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let lines: Vec<&str> = text.split(nl).collect();
    let start = start_line.max(1).saturating_sub(1); // 1-based → 0-based
    let end = if end_line == 0 {
        lines.len()
    } else {
        end_line.min(lines.len())
    };
    let start = start.min(end);
    let replacement: Vec<&str> = content.split('\n').collect();
    let mut out: Vec<&str> = Vec::with_capacity(lines.len() - (end - start) + replacement.len());
    out.extend_from_slice(&lines[..start]);
    out.extend_from_slice(&replacement);
    out.extend_from_slice(&lines[end..]);
    let mut joined = out.join(nl);
    // Preserve a trailing newline when the replaced range reached EOF and the
    // original file ended with one.
    if end == lines.len() && text.ends_with(nl) && !joined.ends_with(nl) {
        joined.push_str(nl);
    }
    fs::write(&path, &joined).map_err(|e| format!("Failed to write {path}: {e}"))?;
    Ok(joined.len())
}

/// Recursively delete a folder and everything inside it.
#[tauri::command]
fn fs_delete_dir(path: String) -> Result<bool, String> {
    fs::remove_dir_all(&path).map_err(|e| format!("Failed to delete dir {path}: {e}"))?;
    Ok(true)
}

/// Create a directory (and any missing parent directories).
#[tauri::command]
fn fs_create_dir(path: String) -> Result<bool, String> {
    fs::create_dir_all(&path).map_err(|e| format!("Failed to create dir {path}: {e}"))?;
    Ok(true)
}

/// List files and folders inside a directory (sorted: folders first, then name).
#[tauri::command]
fn fs_list_dir(path: String) -> Result<Vec<FsEntry>, String> {
    let rd = fs::read_dir(&path).map_err(|e| format!("Failed to list {path}: {e}"))?;
    let mut out = Vec::new();
    for entry in rd.flatten() {
        out.push(meta_to_entry(&entry.path()));
    }
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}


const SEARCH_RESULT_LIMIT: usize = 500;

#[tauri::command]
fn fs_search_files(path: String, pattern: String, content: Option<bool>) -> Result<Vec<String>, String> {
    fn walk(dir: &Path, pattern: &str, in_content: bool, out: &mut Vec<String>) -> Result<(), String> {
        if out.len() >= SEARCH_RESULT_LIMIT {
            return Ok(());
        }
        // Skip dependency/vendor/build dirs and unreadable dirs gracefully —
        // one permission error or node_modules crawl used to stall the search.
        const SKIP: [&str; 9] = [
            "node_modules",
            ".git",
            "target",
            "dist",
            ".next",
            "build",
            "__pycache__",
            ".venv",
            "venv",
        ];
        let Ok(rd) = fs::read_dir(dir) else {
            return Ok(());
        };
        let pat = pattern.to_lowercase();
        for entry in rd.flatten() {
            if out.len() >= SEARCH_RESULT_LIMIT {
                return Ok(());
            }
            let p = entry.path();
            let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            if p.is_dir() {
                if !SKIP.contains(&name.as_str()) {
                    walk(&p, pattern, in_content, out)?;
                }
            } else if in_content {
                // Skip huge files (lockfiles, bundles) and binary data.
                if let Ok(meta) = entry.metadata() {
                    if meta.len() > 1_000_000 {
                        continue;
                    }
                }
                // Content search: report every matching line as `path:line: text`
                // so the model can jump straight to the right spot.
                if let Ok(text) = fs::read_to_string(&p) {
                    for (i, line) in text.lines().enumerate() {
                        if line.to_lowercase().contains(&pat) {
                            out.push(format!(
                                "{}:{}: {}",
                                p.to_string_lossy(),
                                i + 1,
                                line.trim()
                            ));
                            if out.len() >= SEARCH_RESULT_LIMIT {
                                break;
                            }
                        }
                    }
                }
            } else {
                if p.to_string_lossy().to_lowercase().contains(&pat) {
                    out.push(p.to_string_lossy().into_owned());
                }
            }
        }
        Ok(())
    }
    let mut out = Vec::new();
    walk(Path::new(&path), &pattern, content.unwrap_or(false), &mut out)?;
    if out.len() >= SEARCH_RESULT_LIMIT {
        out.push(format!("… results truncated at {SEARCH_RESULT_LIMIT} matches"));
    }
    Ok(out)
}


#[tauri::command]
async fn run_command(
    command: String,
    cwd: Option<String>,
    timeout_secs: Option<u64>,
) -> Result<serde_json::Value, String> {
    use std::time::{Duration, Instant};

    const CAP: usize = 128 * 1024;
    /// Read a stream to a String, capping memory at `max` bytes and never
    /// failing on invalid UTF-8 (PowerShell emits the OEM codepage by default).
    fn drain_capped(mut h: impl Read, max: usize) -> String {
        let mut buf: Vec<u8> = Vec::new();
        let mut chunk = [0u8; 8192];
        loop {
            match h.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    buf.extend_from_slice(&chunk[..n]);
                    if buf.len() >= max {
                        break;
                    }
                }
            }
        }
        String::from_utf8_lossy(&buf).into_owned()
    }

    // Non-interactive, so never the user's login shell: fish/csh don't take
    // `-c` the same way. Windows keeps PowerShell (present on every supported
    // Windows build, and its argument form below is PowerShell-specific).
    // Unix resolves `sh` through PATH and falls back to the POSIX-guaranteed
    // absolute path, so a stripped PATH can't take out every agent tool call.
    let shell = if cfg!(target_os = "windows") {
        "powershell.exe".to_string()
    } else if which("sh") {
        "sh".to_string()
    } else {
        "/bin/sh".to_string()
    };

    let mut cmd = Command::new(&shell);
    if cfg!(target_os = "windows") {
        // Force UTF-8 console output so non-ASCII output survives the pipe.
        cmd.arg("-NoProfile").arg("-Command").arg(format!(
            "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; {command}"
        ));
    } else {
        cmd.arg("-c").arg(&command);
    }
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    // Windowless — otherwise every agent tool call opens a PowerShell
    // console over the app window.
    suppress_window(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn command: {e}"))?;

    let stdout_handle = child.stdout.take();
    let stderr_handle = child.stderr.take();
    // Cap what we read from the pipes too — a command spewing gigabytes must
    // not balloon memory even though we truncate later for the model.
    let t_out = thread::spawn(move || {
        stdout_handle
            .map(|h| drain_capped(h, CAP + 4096))
            .unwrap_or_default()
    });
    let t_err = thread::spawn(move || {
        stderr_handle
            .map(|h| drain_capped(h, CAP + 4096))
            .unwrap_or_default()
    });

    let timeout = Duration::from_secs(timeout_secs.unwrap_or(120).clamp(1, 900));
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break Some(st),
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(format!("Failed to wait for command: {e}")),
        }
    };

    let stdout = t_out.join().unwrap_or_default();
    let stderr = t_err.join().unwrap_or_default();

    // Truncate on a UTF-8 char boundary — slicing raw bytes mid-multibyte
    // character panicked the app whenever PowerShell output contained
    // non-ASCII (unicode arrows, npm warnings, em-dashes…).
    let cap = |s: String| -> String {
        if s.len() <= CAP {
            return s;
        }
        let mut cut = CAP;
        while cut > 0 && !s.is_char_boundary(cut) {
            cut -= 1;
        }
        format!("{}…[truncated]", &s[..cut])
    };

    Ok(serde_json::json!({
        "exitCode": status.and_then(|st| st.code()),
        "timedOut": status.is_none(),
        "stdout": cap(stdout),
        "stderr": cap(stderr),
    }))
}

/// Rename or move a file or folder.
#[tauri::command]
fn fs_rename(path: String, new_path: String) -> Result<bool, String> {
    fs::rename(&path, &new_path)
        .map_err(|e| format!("Failed to rename {path} -> {new_path}: {e}"))?;
    Ok(true)
}

/// Get the path to the ollama binary.
fn find_ollama_binary() -> Result<String, String> {
    // Check PATH first (windowless probe)
    let mut probe = Command::new("ollama");
    probe.arg("--version");
    suppress_window(&mut probe);
    if let Ok(output) = probe.output() {
        if output.status.success() {
            return Ok("ollama".to_string());
        }
    }

    // Check common install locations
    let candidates = [
        "C:\\Users\\%USERNAME%\\AppData\\Local\\Programs\\Ollama\\ollama.exe",
        "/usr/local/bin/ollama",
        "/opt/homebrew/bin/ollama",
        "/usr/bin/ollama",
    ];

    for cmd in candidates {
        if cmd.contains("%USERNAME%") {
            if let Ok(username) = std::env::var("USERNAME") {
                let expanded = cmd.replace("%USERNAME%", &username);
                if PathBuf::from(&expanded).exists() {
                    return Ok(expanded);
                }
            }
            continue;
        }
        if PathBuf::from(cmd).exists() {
            return Ok(cmd.to_string());
        }
    }
    //hardest lang ive ever learned

    Err("Ollama is not installed. Please install Ollama from https://ollama.com to use local models.".to_string())
}

/// One live terminal session: PTY master (for resize) + input writer + child.
struct TermSession {
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

/// All open terminals, keyed by id. Ids are handed out monotonically.
#[derive(Default)]
struct TerminalState {
    sessions: parking_lot::Mutex<HashMap<u32, TermSession>>,
    next_id: AtomicU32,
}

/// Spawn a new shell in a fresh PTY and stream its output to the frontend.
#[tauri::command]
fn terminal_create(
    app: tauri::AppHandle,
    state: tauri::State<'_, TerminalState>,
    cwd: Option<String>,
) -> Result<u32, String> {
    let id = state.next_id.fetch_add(1, Ordering::SeqCst);

    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open pty: {e}"))?;

    // Pick an interactive shell that actually exists on this machine.
    //
    // This used to be a `cfg!` chain naming /bin/bash on Linux. That breaks two
    // ways: distros that only ship dash as /bin/sh (and no bash at all) got a
    // terminal that refused to start, and nobody's actual login shell was ever
    // used. Honour $SHELL first, then fall back through the usual suspects,
    // checking each one really is present before spawning it.
    let shell_cmd = default_shell();
    let mut cmd = CommandBuilder::new(&shell_cmd);
    cmd.env("TERM", "xterm-256color");
    if let Some(dir) = cwd {
        let p = PathBuf::from(&dir);
        if p.is_dir() {
            cmd.cwd(p);
        }
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| {
            format!(
                "Failed to spawn shell ({shell_cmd}): {e}. \
                 Set the SHELL environment variable to a shell that exists on this system."
            )
        })?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone pty reader: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take pty writer: {e}"))?;

    state.sessions.lock().insert(
        id,
        TermSession {
            master: pair.master,
            writer,
            child,
        },
    );

    // Stream this terminal's output back, tagged with its id.
    let handle = app.clone();
    thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buffer[..n]).to_string();
                    let _ = handle.emit("pty-data", serde_json::json!({ "id": id, "data": text }));
                }
                Err(_) => break,
            }
        }
        // Process ended — clean the session up.
        if let Some(state) = handle.try_state::<TerminalState>() {
            state.sessions.lock().remove(&id);
        }
    });

    Ok(id)
}

/// Write user keystrokes into a specific terminal's shell.
#[tauri::command]
fn terminal_write(state: tauri::State<'_, TerminalState>, id: u32, data: String) {
    if let Some(session) = state.sessions.lock().get_mut(&id) {
        let _ = session.writer.write_all(data.as_bytes());
        let _ = session.writer.flush();
    }
}

/// Resize a terminal's PTY grid (called after xterm fit).
#[tauri::command]
fn terminal_resize(
    state: tauri::State<'_, TerminalState>,
    id: u32,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    state
        .sessions
        .lock()
        .get(&id)
        .ok_or_else(|| format!("terminal {id} not found"))?
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to resize terminal: {e}"))
}

/// Kill a terminal session (closes the reader thread via EOF).
#[tauri::command]
fn terminal_kill(state: tauri::State<'_, TerminalState>, id: u32) {
    if let Some(mut session) = state.sessions.lock().remove(&id) {
        let _ = session.child.kill();
        // `master` drops here, closing the pty and ending the reader thread.
    }
}

// ─── MCP stdio transport ────────────────────────────────────────────────────────
// Persistent stdio sessions for MCP servers run as local commands — the standard
// MCP stdio transport: one JSON-RPC message per line on stdin/stdout. Each
// server process is kept alive across calls and torn down on stop/remove.
//
// Compatibility / robustness notes:
//  • `%VAR%` (Windows) and `$VAR` / `${VAR}` (POSIX) refs in the command, args
//    and cwd are expanded from the environment, so configs like
//    `%LOCALAPPDATA%\Roblox\mcp.bat` work as typed.
//  • Extension-less commands (`npx`, `node`, `python`…) are resolved against
//    PATH; on Windows an `.exe` is spawned directly while `.cmd`/`.bat` shims
//    (npm-style) are routed through `cmd.exe /c`.
//  • `.bat`/`.cmd` targets are always executed via `cmd.exe /c`.
//  • stderr is captured (capped ring of the last N lines) so a crashing server
//    reports *why* it died instead of a bare "pipe is being closed" (os error
//    232 on Windows).

use std::collections::VecDeque;
use std::io::BufRead;
use std::process::ChildStdin;
use std::sync::mpsc::{self, Receiver};
use std::sync::Arc;

/// stdin/stdout child plumbing — locked separately so a read poll never blocks
/// a send on the session map.
struct McpProcIo {
    child: Child,
    stdin: ChildStdin,
}

struct McpProc {
    io: Mutex<McpProcIo>,
    /// stdout lines pushed by the reader thread (bounded backlog). The
    /// receiver is behind a mutex so the whole struct stays `Sync` (required
    /// for Tauri managed state) while still allowing blocking waits.
    rx: Mutex<Receiver<String>>,
    /// Last N stderr lines, kept for crash diagnostics.
    stderr_tail: Arc<Mutex<VecDeque<String>>>,
}

struct McpState(Mutex<HashMap<String, Arc<McpProc>>>);

/// Maximum stderr lines kept for diagnostics.
const STDERR_TAIL_LINES: usize = 40;
/// Maximum characters kept per captured stderr line.
const STDERR_LINE_MAX: usize = 2000;

/// Expand environment references in a string, exposed to the frontend.
///
/// Imported MCP configs routinely contain literal `${APPDATA}` / `%VAR%` in
/// args, cwd and env values. The Rust spawn path expands command/args/cwd
/// itself, but env *values* are passed to the child verbatim, so the import
/// path must expand them before storing. Routing through this command keeps a
/// single implementation instead of a second JS copy that could drift.
#[tauri::command]
fn expand_env_string(input: String) -> String {
    expand_env_vars(&input)
}

/// Expand `%VAR%` (Windows) and `$VAR` / `${VAR}` (POSIX) references from the
/// environment. Unknown variables are left as written.
fn expand_env_vars(input: &str) -> String {
    if !input.contains('%') && !input.contains('$') {
        return input.to_string();
    }
    let chars: Vec<char> = input.chars().collect();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let (name, skip): (Option<String>, usize) = if c == '%' {
            match chars[i + 1..].iter().position(|&ch| ch == '%') {
                Some(end) if end > 0 => {
                    let name: String = chars[i + 1..i + 1 + end].iter().collect();
                    (Some(name), end + 2)
                }
                _ => (None, 0),
            }
        } else if c == '$' && i + 1 < chars.len() && chars[i + 1] == '{' {
            match chars[i + 2..].iter().position(|&ch| ch == '}') {
                Some(end) if end > 0 => {
                    let name: String = chars[i + 2..i + 2 + end].iter().collect();
                    (Some(name), end + 3)
                }
                _ => (None, 0),
            }
        } else if c == '$' {
            let end = chars[i + 1..]
                .iter()
                .take_while(|ch| ch.is_ascii_alphanumeric() || **ch == '_')
                .count();
            if end > 0 {
                let name: String = chars[i + 1..i + 1 + end].iter().collect();
                (Some(name), end + 1)
            } else {
                (None, 0)
            }
        } else {
            (None, 0)
        };
        if let Some(name) =
            name.filter(|n| n.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_'))
        {
            if let Ok(val) = std::env::var(&name) {
                out.push_str(&val);
                i += skip;
                continue;
            }
        }
        out.push(c);
        i += 1;
    }
    out
}

/// Resolve `command` to a spawnable program. Returns the program plus any
/// front args (e.g. `cmd /c`). Handles bare names (`npx`), full paths,
/// `.bat`/`.cmd` files and `%VAR%`-expanded paths.
#[cfg(windows)]
fn resolve_command(command: &str) -> (String, Vec<String>) {
    let expanded = expand_env_vars(command);
    let lower = expanded.to_lowercase();
    if lower.ends_with(".bat") || lower.ends_with(".cmd") {
        return ("cmd.exe".to_string(), vec!["/c".to_string(), expanded]);
    }
    if Path::new(&expanded).extension().is_some() {
        return (expanded, Vec::new());
    }
    // Extension-less: search the cwd, then PATH, for the real shim. `.exe`
    // spawns directly; `.cmd`/`.bat` shims (npm-style) need `cmd.exe /c`.
    let path_var = std::env::var("PATH").unwrap_or_default();
    let dirs = std::env::current_dir().into_iter().chain(
        path_var
            .split(';')
            .filter(|d| !d.is_empty())
            .map(PathBuf::from),
    );
    for dir in dirs {
        for ext in [".exe", ".cmd", ".bat"] {
            let candidate = dir.join(format!("{expanded}{ext}"));
            if candidate.is_file() {
                let cand = candidate.to_string_lossy().into_owned();
                if ext == ".exe" {
                    return (cand, Vec::new());
                }
                return ("cmd.exe".to_string(), vec!["/c".to_string(), cand]);
            }
        }
    }
    (expanded, Vec::new())
}

/// Non-Windows: expand env references and spawn directly.
#[cfg(not(windows))]
fn resolve_command(command: &str) -> (String, Vec<String>) {
    (expand_env_vars(command), Vec::new())
}

/// Join the captured stderr tail into a single diagnostic string.
fn stderr_dump(tail: &Mutex<VecDeque<String>>) -> String {
    match tail.lock() {
        Ok(g) => g
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
            .join("\n"),
        Err(_) => String::new(),
    }
}

/// Explain why a stdio MCP server stopped producing output, if it exited.
fn describe_exit(child: &mut Child, tail: &Mutex<VecDeque<String>>) -> String {
    match child.try_wait() {
        Ok(Some(status)) => {
            let err = stderr_dump(tail);
            if err.is_empty() {
                format!("The server process has exited ({status}).")
            } else {
                format!("The server process has exited ({status}). stderr:\n{err}")
            }
        }
        _ => String::new(),
    }
}

/// Kill and reap a session's child process.
fn kill_proc(proc: &McpProc) {
    let mut io = match proc.io.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    let _ = io.child.kill();
    let _ = io.child.wait();
}

// ─── MCP config auto-discovery ────────────────────────────────────────────────

/// One MCP config file that exists on this machine, found by scanning the
/// well-known locations other MCP clients write to.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConfigHit {
    /// Human label for the owning app, e.g. "Claude Desktop".
    pub app: String,
    /// Absolute path of the config file.
    pub path: String,
}

/// Every config path worth probing, across all supported platforms.
///
/// Deliberately platform-generous: we check every platform's path on every OS
/// (a macOS config can be synced onto a Windows box, and the cost of a failed
/// `is_file()` is nil), so discovery works the same wherever the file came from.
fn mcp_config_candidates(workspace_root: Option<String>) -> Vec<(String, PathBuf)> {
    let home = std::env::var("USERPROFILE")
        .ok()
        .or_else(|| std::env::var("HOME").ok())
        .map(PathBuf::from)
        .unwrap_or_default();
    let appdata = std::env::var("APPDATA").ok().map(PathBuf::from).unwrap_or_default();
    let has_home = !home.as_os_str().is_empty();
    let has_appdata = !appdata.as_os_str().is_empty();

    let mut v: Vec<(String, PathBuf)> = Vec::new();

    // Claude Desktop — app-data location differs per OS.
    if has_home {
        v.push((
            "Claude Desktop".to_string(),
            home.join("Library/Application Support/Claude/claude_desktop_config.json"),
        ));
    }
    if has_appdata {
        v.push((
            "Claude Desktop".to_string(),
            appdata.join("Claude").join("claude_desktop_config.json"),
        ));
    }

    if has_home {
        v.push(("Cursor".to_string(), home.join(".cursor").join("mcp.json")));
        v.push((
            "Windsurf".to_string(),
            home.join(".codeium").join("windsurf").join("mcp_config.json"),
        ));
        v.push(("Claude Code".to_string(), home.join(".claude").join("mcp.json")));
        // VS Code keeps user-scoped servers here on macOS and Linux.
        v.push((
            "VS Code".to_string(),
            home.join("Library/Application Support/Code/User/mcp.json"),
        ));
        v.push((
            "VS Code".to_string(),
            home.join(".config").join("Code").join("User").join("mcp.json"),
        ));
    }
    if has_appdata {
        v.push((
            "VS Code".to_string(),
            appdata.join("Code").join("User").join("mcp.json"),
        ));
        v.push((
            "VS Code Insiders".to_string(),
            appdata.join("Code - Insiders").join("User").join("mcp.json"),
        ));
    }

    // Project-scoped convention: the portable, check-in-able one.
    if let Some(root) = workspace_root.filter(|r| !r.is_empty()) {
        v.push((
            "This project".to_string(),
            PathBuf::from(root).join(".mcp.json"),
        ));
    }

    v
}

/// Find MCP config files already present on this machine.
///
/// Read-only: it only stats paths, never creates or edits a file. Parsing and
/// importing is the frontend's job so the app can show the user what it found
/// before anything is added to their config.
#[tauri::command]
fn mcp_discover_configs(workspace_root: Option<String>) -> Vec<McpConfigHit> {
    mcp_config_candidates(workspace_root)
        .into_iter()
        .filter(|(_, p)| p.is_file())
        .map(|(app, path)| McpConfigHit {
            app,
            path: path.to_string_lossy().into_owned(),
        })
        .collect()
}

#[tauri::command]
fn mcp_stdio_start(
    state: tauri::State<'_, McpState>,
    id: String,
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
) -> Result<(), String> {
    // Tear down any previous process registered under this id.
    {
        let mut guard = state.0.lock().map_err(|e| format!("State lock error: {e}"))?;
        if let Some(old) = guard.remove(&id) {
            kill_proc(&old);
        }
    }

    // Windows shell compatibility: expand env refs, resolve shims, route
    // .bat/.cmd files through cmd.exe.
    let (program, front_args) = resolve_command(&command);
    let args: Vec<String> = args.iter().map(|a| expand_env_vars(a)).collect();

    let mut cmd = Command::new(&program);
    cmd.args(front_args.iter().chain(args.iter()))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        // Capture stderr — a crashing server must be able to say why.
        .stderr(Stdio::piped());
    if let Some(dir) = &cwd {
        let expanded = expand_env_vars(dir);
        let p = PathBuf::from(&expanded);
        if p.is_dir() {
            cmd.current_dir(&p);
        } else {
            return Err(format!("MCP server cwd does not exist: {expanded}"));
        }
    }
    if let Some(vars) = &env {
        for (k, v) in vars {
            cmd.env(k, v);
        }
    }
    suppress_window(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start MCP server \"{command}\": {e}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open MCP server stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to open MCP server stdout".to_string())?;
    let stderr = child.stderr.take();

    // Reader thread: pushes complete lines into a channel with a bounded
    // backlog so a chatty server can't grow memory without bound.
    let (tx, rx) = mpsc::sync_channel::<String>(512);
    thread::spawn(move || {
        let mut reader = std::io::BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let trimmed = line.trim_end_matches(['\r', '\n']).to_string();
                    if trimmed.is_empty() || tx.send(trimmed).is_err() {
                        break;
                    }
                }
            }
        }
    });

    // stderr capture: a small ring buffer of the last lines, so a crash can
    // be diagnosed after the fact (this turns "os error 232" into a readable
    // error message in the UI).
    let stderr_tail: Arc<Mutex<VecDeque<String>>> = Arc::new(Mutex::new(VecDeque::new()));
    if let Some(stderr) = stderr {
        let tail = Arc::clone(&stderr_tail);
        thread::spawn(move || {
            let reader = std::io::BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                let capped: String = line.chars().take(STDERR_LINE_MAX).collect();
                if let Ok(mut guard) = tail.lock() {
                    while guard.len() >= STDERR_TAIL_LINES {
                        guard.pop_front();
                    }
                    guard.push_back(capped);
                }
            }
        });
    }

    state
        .0
        .lock()
        .map_err(|e| format!("State lock error: {e}"))?
        .insert(
            id,
            Arc::new(McpProc {
                io: Mutex::new(McpProcIo { child, stdin }),
                rx: Mutex::new(rx),
                stderr_tail,
            }),
        );
    Ok(())
}

/// Write one JSON-RPC line into the server's stdin.
#[tauri::command]
fn mcp_stdio_send(
    state: tauri::State<'_, McpState>,
    id: String,
    line: String,
) -> Result<(), String> {
    // Clone the session Arc out of the map, then release the map lock — a
    // slow/blocked read poll elsewhere must never stall a send.
    let session = {
        let guard = state.0.lock().map_err(|e| format!("State lock error: {e}"))?;
        guard
            .get(&id)
            .cloned()
            .ok_or_else(|| format!("MCP stdio session {id} is not running"))?
    };
    let write_result = {
        let mut io = session
            .io
            .lock()
            .map_err(|_| "MCP stdio session lock poisoned".to_string())?;
        io.stdin
            .write_all(line.as_bytes())
            .and_then(|_| io.stdin.write_all(b"\n"))
            .and_then(|_| io.stdin.flush())
    };
    if let Err(e) = write_result {
        // The classic "The pipe is being closed (os error 232)" — the server
        // process died. Explain why while we still hold the child handle.
        let detail = {
            let mut io = session
                .io
                .lock()
                .map_err(|_| "MCP stdio session lock poisoned".to_string())?;
            describe_exit(&mut io.child, &session.stderr_tail)
        };
        // The session is dead; drop it so the next start starts clean.
        if let Ok(mut guard) = state.0.lock() {
            if let Some(old) = guard.remove(&id) {
                kill_proc(&old);
            }
        }
        return Err(format!("Failed to write to MCP server: {e}. {detail}"));
    }
    Ok(())
}

/// Read the next stdout line from the server, waiting up to `timeout_ms`.
/// Returns `None` on timeout (the caller re-polls until its own deadline).
#[tauri::command]
fn mcp_stdio_read(
    state: tauri::State<'_, McpState>,
    id: String,
    timeout_ms: u64,
) -> Result<Option<String>, String> {
    // Clone the session Arc out of the map, then release the map lock — the
    // blocking wait below never blocks sends, starts or stops.
    let session = {
        let guard = state.0.lock().map_err(|e| format!("State lock error: {e}"))?;
        guard
            .get(&id)
            .cloned()
            .ok_or_else(|| format!("MCP stdio session {id} is not running"))?
    };
    let wait_result = {
        let rx = match session.rx.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        rx.recv_timeout(std::time::Duration::from_millis(timeout_ms))
    };
    match wait_result {
        Ok(line) => Ok(Some(line)),
        Err(mpsc::RecvTimeoutError::Timeout) => Ok(None),
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            // stdout closed: the server exited (or closed its stdout). Report
            // exit code + captured stderr instead of making the caller poll
            // until its own timeout with no explanation.
            let detail = {
                let mut io = session
                    .io
                    .lock()
                    .map_err(|_| "MCP stdio session lock poisoned".to_string())?;
                describe_exit(&mut io.child, &session.stderr_tail)
            };
            Err(format!("MCP server stopped producing output. {detail}"))
        }
    }
}

/// Kill and forget a stdio MCP server process.
#[tauri::command]
fn mcp_stdio_stop(state: tauri::State<'_, McpState>, id: String) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| format!("State lock error: {e}"))?;
    if let Some(session) = guard.remove(&id) {
        kill_proc(&session);
    }
    Ok(())
}

/// Locate the bundled Struct code-oss server (`server-main.js`) that ships
/// inside Neo at `resources/code-oss/`. Search order:
///  1. `STRUCT_IDE_SERVER` env override (explicit path to server-main.js).
///  2. Resource dir next to the running app (production bundle on Linux/
///     Windows; `Contents/Resources` inside a macOS .app).
///  3. Next to the executable itself (portable/unzipped layouts).
///  4. The crate root's `resources/code-oss/` (compile-time path — exact
///     location used during `tauri dev` on the build machine).
fn resolve_struct_server_main(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(p) = std::env::var("STRUCT_IDE_SERVER") {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Some(p);
        }
    }
    const REL: &str = "code-oss/out/server-main.js";
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(dir) = app.path().resource_dir() {
        candidates.push(dir.join("code-oss/out/server-main.js"));
        candidates.push(dir.join("resources").join(REL));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(REL));
            candidates.push(dir.join("../resources").join(REL));
            candidates.push(dir.join("../Resources").join(REL));
        }
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(REL),
    );
    candidates.into_iter().find(|p| p.is_file())
}

/// Start code-server on an ephemeral loopback-only port for the current
/// workspace. Its own extension host and Open VSX integration provide the
/// compatible workbench; Neo never executes downloaded extensions itself.
#[tauri::command]
fn compatible_ide_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, CompatibleIdeState>,
    workspace: String,
) -> Result<String, String> {
    let workspace = PathBuf::from(&workspace)
        .canonicalize()
        .map_err(|e| format!("Cannot open workspace \"{workspace}\": {e}"))?;
    if !workspace.is_dir() {
        return Err(format!("Workspace is not a directory: {}", workspace.display()));
    }

    let mut guard = state
        .0
        .lock()
        .map_err(|e| format!("Compatible workbench state lock error: {e}"))?;
    if let Some(process) = guard.as_mut() {
        match process.child.try_wait() {
            Ok(None) if process.workspace == workspace => return Ok(process.url.clone()),
            Ok(None) => {
                if let Some(mut old) = guard.take() {
                    let _ = old.child.kill();
                    let _ = old.child.wait();
                }
            }
            Ok(Some(_)) => {
                guard.take();
            }
            Err(e) => return Err(format!("Could not check code-server process: {e}")),
        }
    }

    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|e| format!("Cannot reserve a local workbench port: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Cannot determine the local workbench port: {e}"))?
        .port();
    drop(listener);

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(1))
        .build()
        .map_err(|e| format!("Cannot create workbench health check: {e}"))?;
    let bind_addr = format!("127.0.0.1:{port}");

    // Launch command for the embedded workbench. Two modes:
    //
    //  • Struct (default when the bundled code-oss is found): our rebranded
    //    code-server bundle at `resources/code-oss/`, launched as
    //    `node <server-main.js> --port <p> --host 127.0.0.1
    //    --without-connection-token --accept-server-license-terms
    //    --default-folder <workspace>`. Override the location with
    //    STRUCT_IDE_SERVER (and STRUCT_IDE_NODE for the node binary).
    //  • Legacy: coder's generic `code-server` on PATH (--bind-addr/--auth none).
    let mut command = if let Some(server_main) = resolve_struct_server_main(&app) {
        // APP_ROOT = server_main/../../ — the bundle resolves node_modules and
        // extensions relative to it, so run the server from there.
        let app_root = server_main
            .parent()
            .and_then(|out| out.parent())
            .map(Path::to_path_buf);
        let node = std::env::var("STRUCT_IDE_NODE").unwrap_or_else(|_| "node".to_string());
        let (program, front_args) = resolve_command(&node);
        let mut c = Command::new(program);
        // server-main.js opens the folder via --default-folder (positional args
        // are deprecated upstream), so the workspace is a flag, not a positional.
        c.args(front_args).arg(server_main).args([
            "--port",
            &port.to_string(),
            "--host",
            "127.0.0.1",
            "--without-connection-token",
            "--accept-server-license-terms",
            "--default-folder",
            &workspace.to_string_lossy(),
        ]);
        if let Some(root) = app_root {
            c.current_dir(root);
        }
        c
    } else {
        let (program, front_args) = resolve_command("code-server");
        let mut c = Command::new(program);
        c.args(front_args).args([
            "--bind-addr",
            &bind_addr,
            "--auth",
            "none",
            "--disable-telemetry",
            "--disable-update-check",
        ]).arg(&workspace);
        c
    };

    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| {
            format!(
                "Could not start the workbench ({e}). The bundled Struct code-oss \
                 was not found in resources/code-oss — reinstall Neo, or install \
                 code-server from https://code-server.dev/install as a fallback."
            )
        })?;

    let url = format!("http://127.0.0.1:{port}");
    for _ in 0..200 {
        match child.try_wait() {
            Ok(Some(status)) => {
                return Err(format!(
                    "code-server exited during startup with status {status}. Check its installation and try again."
                ));
            }
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("Could not check code-server startup: {e}"));
            }
            Ok(None) => {}
        }
        if client.get(&url).send().is_ok() {
            *guard = Some(CompatibleIdeProcess {
                child,
                url: url.clone(),
                workspace,
            });
            return Ok(url);
        }
        thread::sleep(Duration::from_millis(100));
    }

    let _ = child.kill();
    let _ = child.wait();
    Err("code-server did not become ready within 20 seconds.".to_string())
}

/// Stop the compatible workbench if it is running.
#[tauri::command]
fn compatible_ide_stop(state: tauri::State<'_, CompatibleIdeState>) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|e| format!("Compatible workbench state lock error: {e}"))?;
    if let Some(mut process) = guard.take() {
        let _ = process.child.kill();
        let _ = process.child.wait();
    }
    Ok(())
}

// ─── LSP stdio transport ─────────────────────────────────────────────────────
//
// Transport for Language Server Protocol servers (clangd, rust-analyzer,
// pyright, typescript-language-server, …). The protocol framing (Content-Length
// headers) and JSON-RPC state machine live in the frontend (`src/lsp.ts`); the
// backend only spawns the child process, forwards raw stdout bytes as events
// and writes exact bytes to stdin. That split keeps the protocol logic in TS —
// where it is testable against a fake server — while process management stays
// where child processes can actually be created.
//
// Events emitted to every window:
//   • `neo:lsp-bytes` { id, data: number[] } — raw stdout chunk (may hold any
//     part of a frame; never assume line boundaries).
//   • `neo:lsp-exit`  { id, detail }         — stdout closed (server exited or
//     crashed); `detail` explains why when the exit status/stderr is known.

/// stdin/stdout child plumbing — same shape as the MCP transport above so the
/// spawn/describe helpers can be shared.
struct LspProc {
    io: Mutex<McpProcIo>,
    /// Last N stderr lines, kept for crash diagnostics.
    stderr_tail: Arc<Mutex<VecDeque<String>>>,
    /// Set by the stderr reader thread once its stream hits EOF, so the stdout
    /// thread can wait briefly before composing the exit detail.
    stderr_done: Arc<AtomicBool>,
}

/// Language server processes keyed by registry id (one per language).
struct LspState(Mutex<HashMap<String, Arc<LspProc>>>);



/// Spawn an LSP server and stream its stdout to the webview as byte chunks.
/// Any previous server registered under the same id is stopped first.
#[tauri::command]
fn lsp_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, LspState>,
    id: String,
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<(), String> {
    // Tear down any previous process registered under this id (restart case).
    {
        let mut guard = state
            .0
            .lock()
            .map_err(|e| format!("State lock error: {e}"))?;
        if let Some(old) = guard.remove(&id) {
            kill_lsp(&old);
        }
    }

    // Same Windows shell compatibility as MCP: env expansion, extension-less
    // PATH lookup, `.bat`/`.cmd` shims routed through cmd.exe.
    let (program, front_args) = resolve_command(&command);
    let args: Vec<String> = args.iter().map(|a| expand_env_vars(a)).collect();

    let mut cmd = Command::new(&program);
    cmd.args(front_args.iter().chain(args.iter()))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = &cwd {
        let expanded = expand_env_vars(dir);
        let p = PathBuf::from(&expanded);
        if p.is_dir() {
            cmd.current_dir(&p);
        } else {
            return Err(format!("LSP server cwd does not exist: {expanded}"));
        }
    }
    suppress_window(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start LSP server \"{command}\": {e}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open LSP server stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to open LSP server stdout".to_string())?;
    let stderr = child.stderr.take();

    // stderr: a ring buffer of the last lines so a crash reports *why* it
    // died instead of a bare "pipe is being closed" (os error 232 on Windows).
    let stderr_tail: Arc<Mutex<VecDeque<String>>> = Arc::new(Mutex::new(VecDeque::new()));
    let stderr_done = Arc::new(AtomicBool::new(false));
    if let Some(stderr) = stderr {
        let tail = Arc::clone(&stderr_tail);
        let done = Arc::clone(&stderr_done);
        thread::spawn(move || {
            let mut reader = std::io::BufReader::new(stderr);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        let trimmed = line.trim_end_matches(['\r', '\n']);
                        if trimmed.is_empty() {
                            continue;
                        }
                        if let Ok(mut g) = tail.lock() {
                            if g.len() >= STDERR_TAIL_LINES {
                                g.pop_front();
                            }
                            g.push_back(trimmed.chars().take(STDERR_LINE_MAX).collect());
                        }
                    }
                }
            }
            done.store(true, Ordering::Relaxed);
        });
    } else {
        stderr_done.store(true, Ordering::Relaxed);
    }

    let proc = Arc::new(LspProc {
        io: Mutex::new(McpProcIo { child, stdin }),
        stderr_tail: Arc::clone(&stderr_tail),
        stderr_done,
    });

    // Register before the reader starts so lsp_write/lsp_stop can't race a
    // server nobody can reach yet.
    {
        let mut guard = state
            .0
            .lock()
            .map_err(|e| format!("State lock error: {e}"))?;
        guard.insert(id.clone(), Arc::clone(&proc));
    }


    // stdout reader thread: forward raw byte chunks; LSP framing is the
    // frontend's job. On EOF (server exited/crashed) emit the exit event with
    // an explanation gathered from the exit status + stderr tail.
    let app_reader = app.clone();
    let id_reader = id.clone();
    thread::spawn(move || {
        let mut reader = std::io::BufReader::new(stdout);
        let mut buf = [0u8; 16 * 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let payload =
                        serde_json::json!({ "id": id_reader.as_str(), "data": &buf[..n] });
                    if app_reader.emit("neo:lsp-bytes", payload).is_err() {
                        break; // no listeners (window gone) — stop reading
                    }
                }
            }
        }
        // stdout closed: let stderr drain briefly so the exit detail can say
        // why the server died instead of just "exited".
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(400);
        while !proc.stderr_done.load(Ordering::Relaxed) && std::time::Instant::now() < deadline {
            thread::sleep(std::time::Duration::from_millis(10));
        }
        let status = match proc.io.lock() {
            Ok(mut io) => io.child.try_wait().ok().flatten().map(|s| s.to_string()),
            Err(_) => None,
        };
        let err_text = match proc.stderr_tail.lock() {
            Ok(g) => g.iter().map(String::as_str).collect::<Vec<_>>().join("\n"),
            Err(_) => String::new(),
        };
        let detail = match (status, err_text.is_empty()) {
            (Some(status), true) => format!("The server exited ({status})."),
            (Some(status), false) => format!("The server exited ({status}). stderr:\n{err_text}"),
            (None, false) => format!("The server closed its stdout. stderr:\n{err_text}"),
            (None, true) => "The server closed its stdout.".to_string(),
        };
        let _ = app_reader.emit(
            "neo:lsp-exit",
            serde_json::json!({ "id": id_reader, "detail": detail }),
        );
    });

    Ok(())
}

/// Write one exact byte string (an LSP frame: `Content-Length` header block +
/// JSON body) to the server's stdin. The payload is always valid UTF-8 —
/// that is what LSP frames are — so a `String` beats a `Vec<u8>` over IPC.
#[tauri::command]
fn lsp_write(state: tauri::State<'_, LspState>, id: String, text: String) -> Result<(), String> {
    // Clone the Arc out of the map, then release the lock — the write below
    // never blocks starts/stops of other servers.
    let proc = {
        let guard = state
            .0
            .lock()
            .map_err(|e| format!("State lock error: {e}"))?;
        guard
            .get(&id)
            .cloned()
            .ok_or_else(|| format!("LSP server {id} is not running"))?
    };
    let write_result = {
        let mut io = match proc.io.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        io.stdin.write_all(text.as_bytes()).and_then(|_| io.stdin.flush())
    };
    if let Err(e) = write_result {
        // Classic "pipe is being closed" — the server died. Explain why while
        // we still hold the child handle, then drop the dead session so the
        // next start begins clean.
        let detail = match proc.io.lock() {
            Ok(mut io) => describe_exit(&mut io.child, &proc.stderr_tail),
            Err(_) => String::new(),
        };
        if let Ok(mut guard) = state.0.lock() {
            if let Some(old) = guard.remove(&id) {
                kill_lsp(&old);
            }
        }
        return Err(format!("Failed to write to LSP server: {e}. {detail}"));
    }
    Ok(())
}

/// Stop and forget a language server process.
#[tauri::command]
fn lsp_stop(state: tauri::State<'_, LspState>, id: String) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|e| format!("State lock error: {e}"))?;
    if let Some(proc) = guard.remove(&id) {
        kill_lsp(&proc);
    }
    Ok(())
}

/// Locate an LSP server executable. Checks, in order: an explicit path,
/// the workspace's `node_modules/.bin` (npm local installs), `%APPDATA%\npm`
/// (npm global on Windows), `%USERPROFILE%\.cargo\bin` (rust-analyzer), then
/// every PATH entry. Returns the resolved path, or `None` when the server is
/// not installed — the frontend then surfaces an install hint instead of
/// failing silently.
#[tauri::command]
fn lsp_probe(command: String, root: Option<String>) -> Option<String> {
    let cmd = command.trim();
    if cmd.is_empty() {
        return None;
    }
    // Explicit path: existence is the whole check.
    if cmd.contains('/') || cmd.contains('\\') {
        let p = PathBuf::from(expand_env_vars(cmd));
        return if p.is_file() {
            Some(p.to_string_lossy().into_owned())
        } else {
            None
        };
    }

    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(root) = &root {
        let root = PathBuf::from(expand_env_vars(root));
        dirs.push(root.join("node_modules").join(".bin"));
    }
    if let Ok(appdata) = std::env::var("APPDATA") {
        dirs.push(PathBuf::from(appdata).join("npm"));
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        dirs.push(PathBuf::from(profile).join(".cargo").join("bin"));
    }
    if let Ok(path_var) = std::env::var("PATH") {
        dirs.extend(std::env::split_paths(&path_var).filter(|d| !d.as_os_str().is_empty()));
    }

    // Bare name on disk: exact file (Unix) plus the Windows PATHEXT set.
    // `.exe` spawns directly; `.cmd`/`.bat` shims are routed through
    // `cmd.exe` again at spawn time by `resolve_command`.
    let exts = ["", ".exe", ".cmd", ".bat", ".com"];
    for dir in &dirs {
        for ext in exts {
            let candidate = dir.join(format!("{cmd}{ext}"));
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().into_owned());
            }
        }
    }
    None
}

/// Kill and reap an LSP server process.
fn kill_lsp(proc: &LspProc) {
    let mut io = match proc.io.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    let _ = io.child.kill();
    let _ = io.child.wait();
}

#[tauri::command]
fn get_app_version() -> Result<String, String> {
    // `env!` (not `tauri::env!`) reads the version from this crate's Cargo.toml
    // at compile time, so it always matches the shipped binary.
    Ok(env!("CARGO_PKG_VERSION").to_string())
}

#[tauri::command]
async fn download_file(url: String, app: tauri::AppHandle) -> Result<String, String> {
    use std::fs;
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("server returned {}", resp.status()));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("read body failed: {e}"))?;

    // `app_cache_dir()` is the per-app cache folder. It must be created on
    // demand — a fresh install has no cache directory yet.
    let mut dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("cache dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create cache: {e}"))?;

    // Only the final path segment is kept, with any `?query`/`#fragment`
    // stripped, so the downloaded file always lands inside `dir` regardless of
    // what the caller passed in.
    let filename = url
        .split(|c| c == '?' || c == '#')
        .next()
        .unwrap_or("")
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty() && *name != ".." && !name.contains('\\'))
        .unwrap_or("neo-update-installer.exe");
    dir.push(filename);

    fs::write(&dir, &bytes).map_err(|e| format!("write file: {e}"))?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
async fn launch_downloaded(path: String) -> Result<(), String> {
    use std::process::Command;
    // Fire-and-forget: launch the installer and return immediately.  Waiting
    // here would freeze the WebView while the user browses the installer UI
    // (especially during UAC elevation on Windows).
    let _child = Command::new("cmd")
        .arg("/c")
        .arg("start")
        .arg("")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("launch failed: {e}"))?;
    Ok(())
}

/// Linux-only WebKitGTK tuning, applied before any webview exists.
///
/// This app draws continuously while idle: the prompt bar runs a canvas
/// particle loop, and WebKitGTK repaints the whole page on every frame. On
/// distributions that default to a software GL stack (llvmpipe/swrast, and
/// every Wayland session where DMABuf import is unavailable) that turns a
/// 60fps animation into a single-digit-fps slideshow and makes typing in the
/// editor feel like wading through treacle.
///
/// `WEBKIT_DISABLE_DMABUF_RENDERER=1` forces WebKit to fall back from the
/// zero-copy DMABuf path to plain shared-memory texture upload. That fallback
/// is faster on llvmpipe and on Wayland/GTK combinations that cannot import
/// DMABuf buffers, which is the common case on desktop Linux today.
///
/// Deliberately NOT set: anything that clamps the device scale factor. This is
/// a text-heavy UI and most laptops run HiDPI, so forcing scale 1 would buy a
/// little speed by rendering every glyph blurry. Correctness of the text wins.
///
/// Set only when the app is running on Linux, and never overwrite a value the
/// user already exported, so a working override stays working.
#[cfg(target_os = "linux")]
fn tune_webkit_for_linux() {
    const DEFAULTS: &[(&str, &str)] = &[("WEBKIT_DISABLE_DMABUF_RENDERER", "1")];
    for (key, value) in DEFAULTS {
        if std::env::var_os(key).is_none() {
            std::env::set_var(key, value);
        }
    }
}

#[cfg(not(target_os = "linux"))]
fn tune_webkit_for_linux() {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tune_webkit_for_linux();

    let builder = tauri::Builder::default();

    // Single-instance guard (release builds only).
    //
    // A second launch (e.g. the browser bouncing `agenticcoder://…` back from
    // an OAuth sign-in) must hand the URL to the running window instead of
    // opening a duplicate app — that is what makes the sign-in flow land in
    // the app the user is already looking at.
    //
    // Why debug builds opt out: the guard works via a named mutex built from
    // the bundle identifier (`{identifier}-sim`). An *installed* Neo holds that
    // mutex for as long as it runs, and a `tauri dev` build shares the same
    // identifier — so with the guard enabled the dev app would find the mutex,
    // hand its argv to the installed instance, and exit(0) before its own
    // window ever exists. `tauri dev` then looks like it starts and instantly
    // quits with no window. Letting debug builds skip the guard means dev can
    // run side by side with an installed app. Trade-off: in dev a deep link
    // opens a fresh dev window instead of focusing the existing one — the URL
    // still arrives there through `getCurrent()`, so the OAuth exchange
    // completes either way.
    #[cfg(not(debug_assertions))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        if let Some(url) = argv.iter().find(|a| a.starts_with("agenticcoder://")) {
            let _ = app.emit("neo:deep-link", url.clone());
        }
    }));

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(ServerState(Mutex::new(None)))
        .manage(CompatibleIdeState(Mutex::new(None)))
        .manage(TerminalState::default())
        .manage(McpState(Mutex::new(HashMap::new())))
        .manage(LspState(Mutex::new(HashMap::new())))
        .invoke_handler(tauri::generate_handler![
            save_state,
            load_state,
            get_app_version,
            download_file,
            launch_downloaded,
            check_ollama_installed,
            check_ollama_running,
            ollama_request,
            start_ollama_server,
            stop_ollama_server,
            list_local_models,
            pull_local_model,
            delete_local_model,
            fs_read_file,
            fs_read_file_range,
            fs_write_file,
            fs_append_file,
            fs_replace_in_file,
            fs_stat,
            fs_copy_file,
            fs_write_file_range,
            fs_delete_file,
            fs_delete_dir,
            fs_create_dir,
            fs_list_dir,
            fs_search_files,
            fs_rename,
            run_command,
            terminal_create,
            terminal_write,
            terminal_resize,
            terminal_kill,
            mcp_discover_configs,
            expand_env_string,
            mcp_stdio_start,
            mcp_stdio_send,
            mcp_stdio_read,
            mcp_stdio_stop,
            compatible_ide_start,
            compatible_ide_stop,
            lsp_start,
            lsp_write,
            lsp_stop,
            lsp_probe
        ])
        .setup(|app| {
            // Desktop: make `agenticcoder://` resolve to *this* executable so
            // OAuth callbacks work without a reinstall (Linux/Windows only —
            // macOS registers the scheme at install time from the bundle).
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Linux only: wry leaves WebKitGTK on its *browser* cache defaults.
            // WebKit documents WEBKIT_CACHE_MODEL_DOCUMENT_VIEWER as the correct
            // choice for non-browser applications, and the browser default has
            // been implicated in flaky NetworkProcess loads — the WebKitGTK
            // "WebKit encountered an internal error …
            // internallyFailedLoadTimerFired" spam (WebKit bug 276312).
            //
            // Tauri passes no `data_directory`, so every window shares the one
            // default WebKitWebContext: setting the model once covers all of
            // them, including windows created later (e.g. the IDE window).
            #[cfg(target_os = "linux")]
            {
                use webkit2gtk::{CacheModel, WebContextExt, WebViewExt};

                for (label, window) in app.webview_windows() {
                    let applied = window.with_webview(|webview| {
                        if let Some(context) = webview.inner().context() {
                            context.set_cache_model(CacheModel::DocumentViewer);
                        }
                    });
                    if let Err(err) = applied {
                        log::warn!("could not apply the WebKit cache model to '{label}': {err}");
                    }
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // When the app exits, stop the Ollama server we spawned (and any
            // orphan we adopted). Without this the server outlives the window
            // as an orphan, keeps holding port 11434, and the next launch
            // silently "adopts" a process it can't control — which is exactly
            // the overlap bug. Note: this only runs on a clean exit; a crash
            // or Task Manager kill is handled by the PID record instead.
            if let tauri::RunEvent::Exit = event {
                let state = app_handle.state::<ServerState>();
                if let Ok(mut guard) = state.0.lock() {
                    match guard.take() {
                        Some(TrackedServer::Child(mut child, pid)) => {
                            let _ = child.kill();
                            let _ = child.wait();
                            kill_pid_tree(pid);
                        }
                        Some(TrackedServer::Adopted(pid)) => kill_pid_tree(pid),
                        None => {}
                    }
                }
                clear_pid_record(app_handle);

                // The optional VS Code-compatible workbench is a child process
                // and must not outlive Neo.
                let compatible_ide = app_handle.state::<CompatibleIdeState>();
                if let Ok(mut guard) = compatible_ide.0.lock() {
                    if let Some(mut process) = guard.take() {
                        let _ = process.child.kill();
                        let _ = process.child.wait();
                    }
                }

                // Language servers are long-lived children too — stop them so
                // no orphan keeps holding indexes/ports after the app closes.
                let lsp_state = app_handle.state::<LspState>();
                if let Ok(mut guard) = lsp_state.0.lock() {
                    for (_, proc) in guard.drain() {
                        kill_lsp(&proc);
                    }
                };
            }
        });
}


/* Neo - Electron main. Pure chat shell, native OS frame. */

// ── Linux GPU/Wayland SIGSEGV workaround ────────────────────────────────────
// This app is pure DOM (no WebGL), yet on Linux desktops/VMs without a
// complete Wayland implementation, Electron 40's default Wayland Ozone backend
// hard-crashes (SIGSEGV) inside the GPU child process on window creation
// ("vaInitialize failed" → the whole binary goes down before "ready-to-show").
//
// The `--ozone-platform` switch is parsed by the native binary *before* any
// main-process JS runs, so `app.commandLine.appendSwitch()` is too late and
// injecting into `process.argv` from inside the entry is also too late. The
// only reliable fix is to re-launch ourselves once with the flag on argv,
// then forward the child's exit code. Prefer X11 (served via XWayland on
// Wayland desktops, so it works everywhere). Override with NEO_OZONE_PLATFORM.
if (process.platform === 'linux' && !process.argv.some((a) => a.startsWith('--ozone-platform'))) {
  const { spawnSync } = require('node:child_process')
  const platform = process.env.NEO_OZONE_PLATFORM || 'x11'
  const relaunch = spawnSync(process.execPath, [...process.argv.slice(1), `--ozone-platform=${platform}`], {
    stdio: 'inherit',
    env: process.env,
  })
  process.exit(relaunch.status ?? 0)
}

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const { spawn } = require('node:child_process')
const { existsSync, statSync, createWriteStream, chmodSync } = require('node:fs')
const { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } = require('node:fs/promises')
const { homedir } = require('node:os')
const { basename, dirname, join } = require('node:path')
const { pipeline } = require('node:stream/promises')

/* Managed llama.cpp runtime: GGUF downloads + local inference server. */
const llamacpp = require('./llamacpp.cjs')

/* ── Spotify OAuth loopback (Authorization Code + PKCE) ─────────────────────
 * Spotify only accepts HTTPS or loopback redirect URIs, so the consent
 * screen's code lands on this tiny loopback server instead of the app's
 * agenticcoder:// deep link. The port is fixed so the user can register
 * http://127.0.0.1:43821/callback once in their Spotify app dashboard —
 * keep in sync with SPOTIFY_REDIRECT_URI in src/spotify.ts. */
const SPOTIFY_OAUTH_PORT = 43821
let spotifyOAuthServer = null   // http.Server while a sign-in may be in flight
let spotifyOAuthWaiter = null   // { resolve, reject, timer } for the pending invoke
let spotifyOAuthPending = null  // callback that raced ahead of the waiter

function spotifyOAuthFinish(payload) {
  if (spotifyOAuthWaiter) {
    const w = spotifyOAuthWaiter
    spotifyOAuthWaiter = null
    clearTimeout(w.timer)
    w.resolve(payload)
  } else {
    spotifyOAuthPending = payload
  }
  // One redirect, one code — stop listening immediately.
  if (spotifyOAuthServer) { try { spotifyOAuthServer.close() } catch {} ; spotifyOAuthServer = null }
}

function spotifyOAuthClose() {
  if (spotifyOAuthServer) { try { spotifyOAuthServer.close() } catch {} ; spotifyOAuthServer = null }
  if (spotifyOAuthWaiter) {
    const w = spotifyOAuthWaiter
    spotifyOAuthWaiter = null
    clearTimeout(w.timer)
    w.reject(new Error('Spotify sign-in was cancelled.'))
  }
  spotifyOAuthPending = null
}

function spotifyOAuthListen() {
  if (spotifyOAuthServer) return Promise.resolve({ port: SPOTIFY_OAUTH_PORT })
  return new Promise((resolve, reject) => {
    const server = require('node:http').createServer((req, res) => {
      let url
      try { url = new URL(req.url || '/', 'http://127.0.0.1') } catch { res.writeHead(400); res.end(); return }
      if (url.pathname !== '/callback') { res.writeHead(404); res.end('Not found'); return }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><meta charset="utf-8"><title>Struct — Spotify</title>' +
        '<body style="font:14px system-ui;background:#1f1f1f;color:#eee;padding:40px;margin:0">' +
        '<p style="font-weight:600">Spotify connected.</p>' +
        '<p style="color:#aaa">You can close this tab and return to Struct.</p>')
      const err = url.searchParams.get('error')
      spotifyOAuthFinish(err
        ? { error: err, state: url.searchParams.get('state') || '' }
        : { code: url.searchParams.get('code') || '', state: url.searchParams.get('state') || '' })
    })
    server.on('error', (e) => {
      if (spotifyOAuthServer === server) spotifyOAuthServer = null
      reject(new Error('Could not open the Spotify callback port 43821 (' + e.message + '). Is another sign-in in progress?'))
    })
    // Loopback only — never bind the callback listener to external interfaces.
    server.listen(SPOTIFY_OAUTH_PORT, '127.0.0.1', () => {
      spotifyOAuthServer = server
      resolve({ port: SPOTIFY_OAUTH_PORT })
    })
  })
}

function spotifyOAuthWait(a) {
  const timeoutSec = Math.max(30, Math.min(900, Number(a && a.timeoutSec) || 300))
  if (spotifyOAuthPending) { const p = spotifyOAuthPending; spotifyOAuthPending = null; return Promise.resolve(p) }
  if (spotifyOAuthWaiter) return Promise.reject(new Error('A Spotify sign-in is already waiting for the browser.'))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      spotifyOAuthWaiter = null
      if (spotifyOAuthServer) { try { spotifyOAuthServer.close() } catch {} ; spotifyOAuthServer = null }
      reject(new Error('Spotify sign-in timed out — no redirect received.'))
    }, timeoutSec * 1000)
    spotifyOAuthWaiter = { resolve, reject, timer }
  })
}

// Software-rendering escape hatch (opt-in). The X11 re-launch above already
// dodges the Wayland vaInitialize SIGSEGV, so hardware acceleration stays ON
// by default — forcing SwiftShader for the whole window made every paint,
// blur and scroll crawl on the CPU. Set NEO_SOFTWARE_RENDER=1 only if the
// host GPU stack is genuinely broken.
if (process.env.NEO_SOFTWARE_RENDER === '1') {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
}

const APP_PROTOCOL = 'agenticcoder'
let mainWindow
let deepLinkReady = false
const pendingDeepLinks = []
const APP_DATA_ID = 'com.lumorixstudios.agenticcoder'
const appDataRoot = process.platform === 'linux'
  ? process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
  : app.getPath('appData')
app.setPath('userData', join(appDataRoot, APP_DATA_ID))

function emitToRenderer(event, payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('neo:event', { event, payload })
  }
}
function sendDeepLink(url) {
  if (!mainWindow || mainWindow.isDestroyed()) { pendingDeepLinks.push(url); return }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
  if (deepLinkReady) mainWindow.webContents.send('neo:deep-link', url)
  else pendingDeepLinks.push(url)
}
function flushDeepLinks(event) {
  for (const url of pendingDeepLinks.splice(0)) event.sender.send('neo:deep-link', url)
}
function handleDeepLink(argv) {
  const url = (argv || []).find((v) => typeof v === 'string' && v.indexOf(APP_PROTOCOL + '://') === 0)
  if (url) sendDeepLink(url)
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1220, height: 820, minWidth: 720, minHeight: 480, show: false,
    frame: true, autoHideMenuBar: true, backgroundColor: '#1f1f1f', title: 'Struct',
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  mainWindow.once('ready-to-show', () => { if (mainWindow) mainWindow.show() })
  mainWindow.webContents.on('did-start-loading', () => { deepLinkReady = false })
  mainWindow.on('closed', () => { mainWindow = undefined })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url).catch((e) => console.error('[electron] openExternal:', e))
    return { action: 'deny' }
  })
  const devUrl = process.env.NEO_DEV_SERVER_URL
  if (devUrl) mainWindow.loadURL(devUrl).catch((e) => console.error('[electron] load:', e))
  else mainWindow.loadFile(join(__dirname, '..', 'dist', 'index.html')).catch((e) => console.error('[electron] load file:', e))
}
async function openExternal(value) {
  if (typeof value !== 'string') throw new Error('External URL must be a string')
  let url
  try { url = new URL(value) } catch { throw new Error('Invalid external URL') }
  if (['https:', 'http:', 'mailto:'].indexOf(url.protocol) < 0) throw new Error('Unsupported URL scheme: ' + url.protocol)
  await shell.openExternal(url.href)
}


/* --- state + fs helpers --- */
function stateFile(key) {
  if (typeof key !== 'string' || !key || key.indexOf('..') >= 0 || /[\\/:]/.test(key)) throw new Error('Invalid state key')
  return join(app.getPath('userData'), key + '.json')
}
async function readState(key) {
  try { return await readFile(stateFile(key), 'utf8') }
  catch (e) { if (e && e.code === 'ENOENT') return ''; throw e }
}
async function writeState(key, value) {
  if (typeof value !== 'string') throw new Error('State value must be a string')
  const file = stateFile(key)
  await mkdir(dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  await writeFile(tmp, value, { mode: 0o600 })
  await rename(tmp, file)
}
function metaToEntry(full, st) {
  return { name: basename(full) || full, path: full, is_dir: st ? st.isDirectory() : false, size: st ? st.size : null, modified: st && st.mtimeMs ? Math.floor(st.mtimeMs / 1000) : null }
}
const SKIP = { node_modules: 1, '.git': 1, target: 1, dist: 1, '.next': 1, build: 1, __pycache__: 1, '.venv': 1, venv: 1 }
const SEARCH_LIMIT = 500
async function searchRec(root, pattern, inContent, out) {
  if (out.length >= SEARCH_LIMIT) return
  let entries
  try { entries = await readdir(root, { withFileTypes: true }) } catch { return }
  const pat = String(pattern).toLowerCase()
  for (const en of entries) {
    if (out.length >= SEARCH_LIMIT) return
    const full = join(root, en.name)
    if (en.isDirectory()) { if (!SKIP[en.name]) await searchRec(full, pattern, inContent, out) }
    else if (inContent) {
      let st = null
      try { st = await stat(full) } catch { continue }
      if (st.size > 1000000) continue
      let text = null
      try { text = await readFile(full, 'utf8') } catch { continue }
      const lines = text.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().indexOf(pat) >= 0) {
          out.push(full + ':' + (i + 1) + ': ' + lines[i].trim())
          if (out.length >= SEARCH_LIMIT) break
        }
      }
    } else if (full.toLowerCase().indexOf(pat) >= 0) out.push(full)
  }
}
function expandEnv(input) {
  if (typeof input !== 'string') return input
  return input
    .replace(/%([^%]+)%/g, (m, n) => (process.env[n] !== undefined ? process.env[n] : m))
    .replace(/\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, b, p) => {
      const n = b !== undefined ? b : p
      return process.env[n] !== undefined ? process.env[n] : m
    })
}
const RUN_CAP = 128 * 1024
function capOut(t) {
  const s = String(t || '')
  return s.length <= RUN_CAP ? s : s.slice(0, RUN_CAP) + '...[truncated]'
}
function runCommand(a) {
  const command = String(a.command || '')
  const cwd = typeof a.cwd === 'string' && a.cwd ? a.cwd : undefined
  let tsec = Number(a.timeoutSecs !== undefined ? a.timeoutSecs : a.timeout_secs !== undefined ? a.timeout_secs : 120) || 120
  tsec = Math.min(Math.max(tsec, 1), 900)
  return new Promise((resolveP, reject) => {
    const bin = process.platform === 'win32' ? 'powershell.exe' : 'sh'
    const sargs = process.platform === 'win32'
      ? ['-NoProfile', '-Command', '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ' + command]
      : ['-c', command]
    let child
    try { child = spawn(bin, sargs, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }) }
    catch (e) { reject(new Error('Failed to spawn command: ' + e.message)); return }
    let out = '', err = '', done = false
    child.stdout.on('data', (c) => { if (out.length < RUN_CAP + 4096) out += c.toString('utf8') })
    child.stderr.on('data', (c) => { if (err.length < RUN_CAP + 4096) err += c.toString('utf8') })
    const timer = setTimeout(() => { try { child.kill() } catch {} }, tsec * 1000)
    const start = Date.now()
    child.on('error', (e) => { if (done) return; done = true; clearTimeout(timer); reject(new Error('Failed to spawn command: ' + e.message)) })
    child.on('close', (code) => {
      if (done) return; done = true; clearTimeout(timer)
      const timed = code === null ? true : Date.now() - start >= tsec * 1000 - 60
      resolveP({ exitCode: code, timedOut: timed, stdout: capOut(out), stderr: capOut(err) })
    })
  })
}


/* --- terminals via node-pty --- */
let ptyMod = null
function pty() {
  if (!ptyMod) {
    try { ptyMod = require('node-pty') }
    catch (e) { throw new Error('Terminal backend unavailable (node-pty): ' + e.message) }
  }
  return ptyMod
}
function defShell() {
  if (process.platform === 'win32') return 'powershell.exe'
  const cands = [process.env.SHELL, '/bin/bash', '/usr/bin/bash', '/bin/zsh', '/usr/bin/zsh', '/bin/sh'].filter(Boolean)
  for (const c of cands) { try { if (existsSync(c)) return c } catch {} }
  return '/bin/sh'
}
const terms = new Map()
let nextTermId = 0
function termCreate(a) {
  const o = a || {}
  const id = nextTermId++
  const proc = pty().spawn(defShell(), [], {
    name: 'xterm-256color', cols: 80, rows: 24,
    cwd: typeof o.cwd === 'string' && o.cwd ? o.cwd : require('node:os').homedir(),
    env: process.env,
  })
  terms.set(id, proc)
  proc.onData((d) => emitToRenderer('neo:terminal-data', { id, data: String(d) }))
  proc.onExit((info) => { terms.delete(id); emitToRenderer('neo:terminal-exit', { id, exitCode: info ? info.exitCode : null }) })
  return id
}


/* --- llama.cpp (managed local runtime) proxy --- */
/* Ports the app is allowed to reach on the loopback interface. The default
 * 18080 is always permitted; any other port is added when the app starts a
 * server on it. Requests to anything else are rejected so this proxy can
 * never be used to talk to an unrelated local service. */
const LLAMA_DEFAULT_PORT = 18080
const llamaAllowedPorts = new Set([LLAMA_DEFAULT_PORT])

/** Validate a loopback URL against the allowed llama-server ports. */
function llamaUrl(raw) {
  let p
  try {
    p = new URL(String(raw))
  } catch {
    throw new Error('Invalid llama.cpp URL: ' + raw)
  }
  const port = p.port || (p.protocol === 'https:' ? '443' : '80')
  if (p.hostname !== '127.0.0.1' && p.hostname !== 'localhost') {
    throw new Error('llama.cpp requests must target the loopback interface.')
  }
  if (!llamaAllowedPorts.has(Number(port))) {
    throw new Error(`llama.cpp requests to port ${port} are not allowed.`)
  }
  return p
}

/**
 * Perform an HTTP request against the local llama-server.
 *
 * The preload bridge has no raw-chunk channel, so the response body is
 * buffered here and handed to the renderer as a whole. The renderer's SSE
 * parser still processes it line by line, so the reply renders incrementally.
 */
function llamaHttp(o) {
  const p = llamaUrl(o.url)
  const lib = p.protocol === 'https:' ? require('node:https') : require('node:http')
  return new Promise((resolveP, reject) => {
    const req = lib.request(
      p,
      {
        method: o.method || 'GET',
        headers: { 'Content-Type': 'application/json' },
        timeout: 600000,
      },
      (res) => {
        let t = ''
        res.setEncoding('utf8')
        res.on('data', (c) => {
          t += c
        })
        res.on('end', () => resolveP({ status: res.statusCode || 0, body: t }))
      },
    )
    req.on('timeout', () => req.destroy(new Error('llama.cpp request timed out')))
    req.on('error', reject)
    if (o.body) req.write(o.body)
    req.end()
  })
}

/* --- ollama proxy + lifecycle --- */
let ollamaChild = null
function ollUrl(raw) {
  let p
  try { p = new URL(String(raw)) } catch { throw new Error('Invalid Ollama URL: ' + raw) }
  const port = p.port || (p.protocol === 'https:' ? '443' : '80')
  if ((p.hostname !== '127.0.0.1' && p.hostname !== 'localhost') || port !== '11434') throw new Error('Ollama requests must target localhost:11434.')
  return p
}
function ollHttp(o) {
  const p = ollUrl(o.url)
  const lib = p.protocol === 'https:' ? require('node:https') : require('node:http')
  return new Promise((resolveP, reject) => {
    const req = lib.request(p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json' }, timeout: 600000 }, (res) => {
      let t = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { t += c })
      res.on('end', () => resolveP({ status: res.statusCode || 0, body: t }))
    })
    req.on('timeout', () => req.destroy(new Error('Ollama request timed out')))
    req.on('error', reject)
    if (o.body) req.write(o.body)
    req.end()
  })
}

async function ollAlive() {
  try {
    const r = await ollHttp({ url: 'http://127.0.0.1:11434/api/version', method: 'GET' })
    return r.status >= 200 && r.status < 500
  } catch { return false }
}
function ollBin() {
  for (const p of ['/usr/local/bin/ollama', '/opt/homebrew/bin/ollama', '/usr/bin/ollama']) {
    try { if (existsSync(p)) return p } catch {}
  }
  return 'ollama'
}
function ollInstalled() {
  try {
    require('node:child_process').execFileSync(ollBin(), ['--version'], { stdio: 'ignore', windowsHide: true })
    return true
  } catch { return false }
}
async function startOllama() {
  if (await ollAlive()) return { running: true, alreadyRunning: true, owned: false, adopted: false }
  try {
    ollamaChild = spawn(ollBin(), ['serve'], { stdio: 'ignore', windowsHide: true })
    ollamaChild.on('exit', () => { ollamaChild = null })
    if (ollamaChild.unref) ollamaChild.unref()
  } catch (e) { throw new Error('Failed to start Ollama: ' + e.message) }
  const deadline = Date.now() + 20000
  for (;;) {
    if (await ollAlive()) break
    if (Date.now() >= deadline) {
      try { if (ollamaChild) ollamaChild.kill() } catch {}
      ollamaChild = null
      throw new Error('Ollama did not answer on port 11434 after starting.')
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return { running: true, alreadyRunning: false, owned: true, adopted: false }
}
async function stopOllama() {
  if (ollamaChild && !ollamaChild.killed) {
    try { ollamaChild.kill() } catch {}
    ollamaChild = null
    return { stopped: true, stillRunningExternal: await ollAlive() }
  }
  return { stopped: false, stillRunningExternal: await ollAlive() }
}
async function ollTags() {
  const r = await ollHttp({ url: 'http://127.0.0.1:11434/api/tags', method: 'GET' })
  if (r.status < 200 || r.status >= 300) throw new Error('Ollama tags failed (HTTP ' + r.status + ')')
  try { return JSON.parse(r.body).models || [] } catch { return [] }
}
async function ollPull(name) {
  const r = await ollHttp({ url: 'http://127.0.0.1:11434/api/pull', method: 'POST', body: JSON.stringify({ name, stream: false }) })
  return r.status >= 200 && r.status < 300
}
async function ollDel(name) {
  const r = await ollHttp({ url: 'http://127.0.0.1:11434/api/delete', method: 'DELETE', body: JSON.stringify({ name }) })
  return r.status >= 200 && r.status < 300
}


/* --- mcp stdio + discovery --- */
const mcpProcs = new Map()
function mcpCands(root) {
  const hits = [], seen = new Set()
  const push = (p, src) => {
    if (!p || seen.has(p)) return
    seen.add(p)
    try { if (existsSync(p) && statSync(p).isFile()) hits.push({ path: p, source: src }) } catch {}
  }
  if (root) {
    push(join(root, '.mcp.json'), 'workspace')
    push(join(root, '.vscode', 'mcp.json'), 'workspace-vscode')
    push(join(root, 'mcp.json'), 'workspace-root')
  }
  const h = require('node:os').homedir()
  push(join(h, '.config', 'neo', 'mcp.json'), 'user')
  push(join(h, '.neo', 'mcp.json'), 'user-legacy')
  if (process.platform === 'win32' && process.env.APPDATA) push(join(process.env.APPDATA, 'neo', 'mcp.json'), 'user-windows')
  return hits
}
function mcpStart(o) {
  const id = String(o.id || '')
  if (!id || !o.command) throw new Error('MCP server id and command are required')
  try { mcpStopSync(id) } catch {}
  const cmd = String(o.command).trim()
  let prog = cmd, fargs = []
  if (process.platform === 'win32' && /\.(bat|cmd)$/i.test((cmd.split(' ')[0] || ''))) { prog = 'cmd.exe'; fargs = ['/d', '/s', '/c', cmd] }
  const alist = fargs.concat(((o.args) || []).map((x) => expandEnv(String(x))))
  const envOut = Object.assign({}, process.env)
  const ex = o.env || {}
  for (const k of Object.keys(ex)) envOut[k] = expandEnv(String(ex[k]))
  let cwdV = undefined
  if (o.cwd) { const e2 = expandEnv(String(o.cwd)); try { if (existsSync(e2)) cwdV = e2 } catch {} }
  const child = spawn(prog, alist, { cwd: cwdV, env: envOut, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  const st = { child, buf: '', queue: [], waiters: [], tail: [] }
  mcpProcs.set(id, st)
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (c) => {
    st.buf += c
    let i = st.buf.indexOf('\n')
    while (i >= 0) {
      const line = st.buf.slice(0, i).trim()
      st.buf = st.buf.slice(i + 1)
      if (line) { if (st.waiters.length > 0) st.waiters.shift()(line); else st.queue.push(line) }
      i = st.buf.indexOf('\n')
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (c) => { st.tail.push(String(c)); if (st.tail.length > 40) st.tail.shift() })
  child.on('exit', () => {
    const e = new Error('MCP server "' + id + '" exited. ' + st.tail.join('').slice(-2000))
    while (st.waiters.length > 0) st.waiters.shift()(null, e)
  })
  return { started: true }
}
function mcpStopSync(id) {
  const st = mcpProcs.get(String(id))
  if (!st) return
  mcpProcs.delete(String(id))
  try { st.child.kill() } catch {}
}
function mcpSend(o) {
  const st = mcpProcs.get(String(o.id))
  if (!st || st.child.killed) throw new Error('MCP server "' + o.id + '" is not running')
  st.child.stdin.write(String(o.line) + '\n')
  return { sent: true }
}
function mcpRead(o) {
  const id = String(o.id)
  const st = mcpProcs.get(id)
  if (!st) throw new Error('MCP server "' + id + '" is not running')
  if (st.queue.length > 0) return Promise.resolve(st.queue.shift())
  let tms = Number(o.timeoutMs || 30000) || 30000
  tms = Math.min(Math.max(tms, 1000), 120000)
  return new Promise((resolveP, reject) => {
    const onL = (line, e) => { clearTimeout(t); if (e) reject(e); else resolveP(line) }
    const t = setTimeout(() => {
      const i = st.waiters.indexOf(onL)
      if (i >= 0) st.waiters.splice(i, 1)
      reject(new Error('Timed out waiting for MCP server "' + id + '"'))
    }, tms)
    st.waiters.push(onL)
  })
}
async function mcpStop(o) {
  const id = String(o.id)
  if (!mcpProcs.get(id)) return { stopped: false }
  mcpStopSync(id)
  return { stopped: true }
}


/* --- main-process HTTP (web tools, bypasses webview CORS) --- */

/** Response size cap for web tools (8 MB). */
const HTTP_FETCH_MAX = 8 * 1024 * 1024

/**
 * Generic http(s) fetch executed in the Electron main process. The renderer's
 * fetch is subject to CORS (webSecurity is on), and search engines / most
 * sites send no Access-Control-Allow-Origin — so the web_search / web_fetch /
 * http_request tools route through here instead.
 *
 * Args: { url, method?, headers?, body? }  — headers must be a plain object of
 * string→string, body a raw string (the tools already serialize JSON).
 * Returns: { status, statusText, headers, body } with body decoded as UTF-8
 * text and the content-encoding/content-length headers stripped (the body
 * arrives already decompressed, and the length no longer matches).
 */
async function httpFetch(a) {
  let url
  try {
    url = new URL(String(a.url || ''))
  } catch {
    throw new Error('http_fetch requires a valid absolute URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Unsupported URL scheme: ' + url.protocol)
  }
  const method = String(a.method || 'GET').toUpperCase()
  const headers = {}
  const rawHeaders = a.headers && typeof a.headers === 'object' && !Array.isArray(a.headers) ? a.headers : {}
  for (const k of Object.keys(rawHeaders)) headers[k] = String(rawHeaders[k])
  const hasBody = typeof a.body === 'string' && a.body.length > 0 && method !== 'GET' && method !== 'HEAD'

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 60000)
  try {
    const res = await fetch(url.toString(), {
      method,
      headers,
      ...(hasBody ? { body: a.body } : {}),
      redirect: 'follow',
      signal: ctrl.signal,
    })
    const declaredLen = Number(res.headers.get('content-length') || 0)
    if (declaredLen && declaredLen > HTTP_FETCH_MAX) {
      throw new Error('Response too large (' + declaredLen + ' bytes; limit 8 MB)')
    }
    const text = await res.text()
    const outHeaders = {}
    res.headers.forEach((v, k) => {
      const lk = k.toLowerCase()
      // Body is already decoded/measured — a stale gzip length would corrupt
      // the reconstructed Response in the renderer.
      if (lk === 'content-encoding' || lk === 'content-length') return
      outHeaders[k] = v
    })
    return {
      status: res.status,
      statusText: res.statusText,
      headers: outHeaders,
      body: text.length > HTTP_FETCH_MAX ? text.slice(0, HTTP_FETCH_MAX) : text,
      truncated: text.length > HTTP_FETCH_MAX,
    }
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('HTTP request timed out after 60s')
    throw new Error('HTTP request failed: ' + (e && e.message ? e.message : String(e)))
  } finally {
    clearTimeout(timer)
  }
}


/* --- Direct mail (IMAP + SMTP over TLS, no OAuth / Cloud Console) --- */
// Gmail via an App Password (Google account → 2-Step Verification → App
// passwords). SMTP (smtp.gmail.com:465, implicit TLS) sends; IMAP
// (imap.gmail.com:993, implicit TLS) searches + reads. Node builtins only —
// no new deps, nothing extra to ship in the packaged app.
//
// Line protocol with dot-stuffing on SMTP DATA, AUTH LOGIN (base64
// user/pass), untagged-response skipping + {byte-count} literal handling on
// IMAP, timed sockets throughout so a hung server can never wedge the agent.
const MAIL_TIMEOUT_MS = 30000
const MAIL_HOST_IMAP = 'imap.gmail.com'
const MAIL_PORT_IMAP = 993
const MAIL_HOST_SMTP = 'smtp.gmail.com'
const MAIL_PORT_SMTP = 465

/** One TLS socket, shared by SMTP and IMAP sessions (connect timeout only). */
function mailConnect(host, port) {
  const tls = require('node:tls')
  return new Promise((resolveP, reject) => {
    let settled = false
    const sock = tls.connect({ host, port, servername: host }, () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveP(sock)
    })
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { sock.destroy() } catch {}
      reject(new Error('Mail connection timed out reaching ' + host + ':' + port + ' (check network / firewall / VPN).'))
    }, MAIL_TIMEOUT_MS)
    sock.once('error', (e) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(e)
    })
  })
}

/** Read server lines until `done(line)` is true; per-read timeout so a hung
 *  server can never wedge the agent (previously this waited forever). */
function mailReadLines(sock, done, timeoutMs) {
  const wait = Number(timeoutMs) > 0 ? Number(timeoutMs) : MAIL_TIMEOUT_MS
  return new Promise((resolveP, reject) => {
    let buf = ''
    const lines = []
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Mail server timed out waiting for a response (Gmail may be slow — retry).'))
    }, wait)
    const onData = (chunk) => {
      buf += chunk.toString('utf8')
      let idx
      while ((idx = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        lines.push(line)
        if (done(line)) { cleanup(); resolveP(lines); return }
      }
    }
    const onErr = (e) => { cleanup(); reject(e) }
    const onClose = () => { cleanup(); reject(new Error('Mail connection closed by Gmail (network drop?).')) }
    const cleanup = () => {
      clearTimeout(timer)
      sock.off('data', onData); sock.off('error', onErr); sock.off('close', onClose)
    }
    sock.on('data', onData)
    sock.once('error', onErr)
    sock.once('close', onClose)
  })
}

function mailWrite(sock, text) {
  return new Promise((resolveP, reject) => {
    sock.write(text, 'utf8', (e) => (e ? reject(e) : resolveP()))
  })
}

function mailClose(sock) {
  try { sock.destroy() } catch {}
}

function mailCreds(a) {
  const user = String((a && (a.email !== undefined ? a.email : a.user)) || '').trim()
  const pass = String((a && (a.appPassword !== undefined ? a.appPassword : a.password)) || '').replace(/\s+/g, '')
  if (!user || !pass) throw new Error('Gmail email + App Password are required.')
  return { user, pass }
}

/** SMTP: greet → EHLO → AUTH LOGIN → MAIL/RCPT/DATA → send → QUIT. */
async function mailSmtpSend(a) {
  const { user, pass } = mailCreds(a)
  const to = String(a.to || '').trim()
  const subject = String(a.subject || '').trim() || '(no subject)'
  const text = String(a.body !== undefined ? a.body : '')
  if (!to) throw new Error('Recipient address is required.')
  const sock = await mailConnect(MAIL_HOST_SMTP, MAIL_PORT_SMTP)
  try {
    await mailReadLines(sock, (l) => l.startsWith('220'))
    const b64 = (s) => Buffer.from(s, 'utf8').toString('base64')
    const expect = async (cmd, code) => {
      await mailWrite(sock, cmd)
      const lines = await mailReadLines(sock, (l) => new RegExp('^' + code + '[ \\-]').test(l))
      const last = lines[lines.length - 1] || ''
      if (!last.startsWith(String(code) + ' ')) throw new Error('SMTP rejected ' + cmd.split(' ')[0] + ': ' + last)
      return lines
    }
    await expect('EHLO struct\r\n', 250)
    await expect('AUTH LOGIN\r\n', 334)
    await expect(b64(user) + '\r\n', 334)
    await expect(b64(pass) + '\r\n', 235)
    await expect('MAIL FROM:<' + user + '>\r\n', 250)
    await expect('RCPT TO:<' + to + '>\r\n', 250)
    await expect('DATA\r\n', 354)
    // Dot-stuffing: a line starting with '.' ends DATA early unless doubled.
    const stuffed = text.split(/\r?\n/).map((l) => (l.startsWith('.') ? '.' + l : l)).join('\r\n')
    const raw =
      'From: ' + user + '\r\n' +
      'To: ' + to + '\r\n' +
      'Subject: ' + subject.replace(/[\r\n]+/g, ' ') + '\r\n' +
      'MIME-Version: 1.0\r\n' +
      'Content-Type: text/plain; charset="UTF-8"\r\n' +
      'Content-Transfer-Encoding: 8bit\r\n\r\n' +
      stuffed + '\r\n.\r\n'
    await mailWrite(sock, raw)
    const sent = await mailReadLines(sock, (l) => /^250 /.test(l))
    await mailWrite(sock, 'QUIT\r\n').catch(() => {})
    const idLine = sent.find((l) => l.startsWith('250 ')) || ''
    return { ok: true, response: idLine.replace(/^250[ -]?/, '').trim() }
  } finally {
    mailClose(sock)
  }
}

let mailTagSeq = 0
function mailTag() {
  mailTagSeq = (mailTagSeq + 1) % 100000
  return 'S' + String(mailTagSeq).padStart(4, '0')
}

/** Send one tagged command; collect until our tagged completion line. */
async function mailImapCmd(sock, cmd) {
  const tag = mailTag()
  await mailWrite(sock, tag + ' ' + cmd + '\r\n')
  const lines = await mailReadLines(sock, (l) => l.startsWith(tag + ' '))
  const done = lines[lines.length - 1] || ''
  if (/^OK\b/i.test(done.slice(tag.length + 1).trim())) return lines
  throw new Error('IMAP command failed: ' + done)
}

function mailQuote(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

/** LOGIN, with an AUTHENTICATE LOGIN challenge fallback for picky servers. */
async function mailImapLogin(sock, user, pass) {
  try {
    return await mailImapCmd(sock, 'LOGIN ' + mailQuote(user) + ' ' + mailQuote(pass))
  } catch (e) {
    const msg = e && e.message ? e.message : String(e)
    if (!/failed/i.test(msg)) throw e
    // fall through to AUTHENTICATE LOGIN below; keep first error as fallback
    var firstErr = msg
  }
  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64')
  const tag = mailTag()
  await mailWrite(sock, tag + ' AUTHENTICATE LOGIN\r\n')
  const c0 = await mailReadLines(sock, (l) => l.startsWith('+') || l.startsWith(tag + ' '))
  if ((c0[c0.length - 1] || '').startsWith(tag + ' ')) throw new Error('Gmail login failed: ' + c0[c0.length - 1] + (firstErr ? ' (LOGIN also said: ' + firstErr + ')' : ''))
  await mailWrite(sock, b64(user) + '\r\n')
  const c1 = await mailReadLines(sock, (l) => l.startsWith('+') || l.startsWith(tag + ' '))
  if ((c1[c1.length - 1] || '').startsWith(tag + ' ')) throw new Error('Gmail login failed: ' + c1[c1.length - 1])
  await mailWrite(sock, b64(pass) + '\r\n')
  const c2 = await mailReadLines(sock, (l) => l.startsWith(tag + ' '))
  const last2 = c2[c2.length - 1] || ''
  if (/^OK\b/i.test(last2.slice(tag.length + 1).trim())) return c2
  throw new Error('Gmail login failed: ' + last2)
}

/** Turn a raw Gmail IMAP failure line into an actionable message (keeps the
 *  server detail instead of swallowing it behind one generic sentence). */
function mailAuthHint(serverLine, user) {
  const line = String(serverLine || '')
  const serverBit = line.replace(/^[A-Z0-9]+\s+(OK|NO|BAD)\b/i, '').trim().replace(/^\[.*?\]\s*/, '').trim()
  if (/application-specific password required|app password/i.test(line)) {
    return 'Gmail rejected the regular account password — you must use an App Password (Google Account → Security → 2-Step Verification → App passwords), not your normal Google password.' + (serverBit ? ' Gmail said: ' + serverBit : '')
  }
  if (/invalid credentials|authenticationfailed|auth.*fail|username and password not accepted/i.test(line)) {
    return 'Gmail said “invalid credentials” for ' + user + ' — the email or the 16-letter App Password is wrong (paste it without spaces; generating a fresh App Password also fixes revoked ones).' + (serverBit && !/invalid credentials/i.test(serverBit) ? ' Gmail said: ' + serverBit : '')
  }
  if (/too many simultaneous|too many connections|try again|temporar/i.test(line)) {
    return 'Gmail is rate-limiting IMAP logins — wait a minute and retry (close other mail apps signed into the same account).' + (serverBit ? ' Gmail said: ' + serverBit : '')
  }
  if (/disabled|imap.*not|access denied|not available/i.test(line)) {
    return 'Gmail refused IMAP access — enable IMAP in Gmail Settings → Forwarding and POP/IMAP → IMAP access, or check a Workspace admin hasn’t disabled “less-secure / mail client” access.' + (serverBit ? ' Gmail said: ' + serverBit : '')
  }
  if (/timed out|connection closed|network|econn|enotfound|eai_again|econnrefused|etimedout/i.test(line)) {
    return 'Couldn’t reach imap.gmail.com:993 — check network / firewall / VPN / DNS, then retry. Detail: ' + line
  }
  return 'Gmail login failed for ' + user + ' — check the email and the 16-letter App Password (Google Account → 2-Step Verification → App passwords).' + (serverBit ? ' Gmail said: ' + serverBit : ' Full response: ' + line)
}

/** Open an authenticated IMAP session on INBOX. Caller must mailClose(sock). */
async function mailImapSession(user, pass) {
  const sock = await mailConnect(MAIL_HOST_IMAP, MAIL_PORT_IMAP)
  try {
    // A '* BYE' greeting means Gmail refused us outright (ban / rate limit);
    // surface it instead of hanging until the read timeout.
    const greet = await mailReadLines(sock, (l) => l.startsWith('* OK') || l.startsWith('* PREAUTH') || l.startsWith('* BYE'))
    const greetLast = greet[greet.length - 1] || ''
    if (greetLast.startsWith('* BYE')) throw new Error('Gmail login failed: ' + greetLast)
    await mailImapLogin(sock, user, pass)
    await mailImapCmd(sock, 'SELECT INBOX')
    return sock
  } catch (e) {
    mailClose(sock)
    const msg = e && e.message ? e.message : String(e)
    if (/auth|login|credential|username|password|invalid|failed|bye|imap/i.test(msg)) {
      throw new Error(mailAuthHint(msg, user))
    }
    throw e
  }
}


/* --- invoke router A: state + fs --- */

/** Pull {byte-count} literals out of FETCH responses (bodies arrive this way). */
function mailImapLiterals(lines) {
  const out = []
  for (let i = 0; i < lines.length; i++) {
    if (!/\{\d+\}\s*$/.test(lines[i])) continue
    let collected = ''
    let j = i + 1
    while (j < lines.length && !/^\* /.test(lines[j]) && !/^[A-Z0-9]+ (OK|NO|BAD)/i.test(lines[j])) {
      collected += (collected ? '\r\n' : '') + lines[j]
      j++
    }
    out.push({ header: lines[i], text: collected })
  }
  return out
}

/** IMAP SEARCH with a Gmail-ish filter: free text, from:, newer_than:Nd. */
async function mailImapSearch(a) {
  const { user, pass } = mailCreds(a)
  const raw = String(a.query !== undefined ? a.query : '').trim()
  const max = Math.min(Math.max(Number(a.maxResults) || 10, 1), 25)
  const keys = []
  let m = raw.match(/from:\s*([^\s]+)/i)
  const from = m ? m[1] : ''
  let rest = raw.replace(/from:\s*[^\s]+/gi, ' ')
  m = rest.match(/newer_than:\s*(\d+)\s*d/i)
  const days = m ? Number(m[1]) : 0
  rest = rest.replace(/newer_than:\s*\d+\s*d/gi, ' ').replace(/\bin:inbox\b/gi, ' ').trim()
  if (from) keys.push('FROM', mailQuote(from))
  if (days > 0) {
    const since = new Date(Date.now() - days * 86400000)
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    keys.push('SINCE', since.getDate() + '-' + months[since.getMonth()] + '-' + since.getFullYear())
  }
  const words = rest.replace(/[a-z_]+:[^\s]+/gi, ' ').split(/\s+/).filter(Boolean).slice(0, 6)
  for (const w of words) keys.push('TEXT', mailQuote(w))
  if (keys.length === 0) keys.push('ALL')
  const sock = await mailImapSession(user, pass)
  try {
    const lines = await mailImapCmd(sock, 'SEARCH ' + keys.join(' '))
    const ids = []
    for (const l of lines) {
      const sm = l.match(/^\* SEARCH\s*(.*)$/)
      if (sm && sm[1].trim()) ids.push(...sm[1].trim().split(/\s+/).map(Number).filter((n) => n > 0))
    }
    ids.sort((x, y) => x - y)
    const newest = ids.slice(-max).reverse()
    const out = []
    for (const id of newest) {
      const f = await mailImapCmd(
        sock,
        'FETCH ' + id + ' (UID ENVELOPE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE TO)])'
      )
      const joined = f.join(' ')
      const grabUid = joined.match(/UID\s+(\d+)/i)
      const hdr = mailImapLiterals(f).map((x) => x.text).join('\r\n')
      const grab = (re) => {
        const mm = hdr.match(re)
        return mm ? mm[1].trim() : ''
      }
      out.push({
        uid: grabUid ? grabUid[1] : String(id),
        seq: id,
        from: grab(/^From:\s*(.+)$/im),
        subject: grab(/^Subject:\s*(.+)$/im) || '(no subject)',
        date: grab(/^Date:\s*(.+)$/im),
        snippet: '',
      })
    }
    await mailWrite(sock, 'LOGOUT\r\n').catch(() => {})
    return out
  } finally {
    mailClose(sock)
  }
}

/** Read one message by UID: full headers + preferred text body. */
async function mailImapRead(a) {
  const { user, pass } = mailCreds(a)
  const uid = String(a.uid !== undefined ? a.uid : a.id !== undefined ? a.id : '').trim()
  if (!uid) throw new Error('Message id is required.')
  const sock = await mailImapSession(user, pass)
  try {
    const f = await mailImapCmd(sock, 'UID FETCH ' + uid + ' (ENVELOPE BODY.PEEK[])')
    const lits = mailImapLiterals(f)
    const raw = lits.length > 0 ? lits.map((x) => x.text).join('\r\n') : ''
    const splitAt = raw.search(/\r?\n\r?\n/)
    const rawHeaders = splitAt >= 0 ? raw.slice(0, splitAt) : raw
    let rawBody = splitAt >= 0 ? raw.slice(splitAt).replace(/^\r?\n\r?\n/, '') : ''
    const grab = (re) => {
      const mm = rawHeaders.match(re)
      return mm ? mm[1].trim() : ''
    }
    const stripHtml = (html) => html
      .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, '')
      .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const decodePart = (text, enc) => {
      if (/base64/i.test(enc)) {
        try { return Buffer.from(text.replace(/\s+/g, ''), 'base64').toString('utf8') } catch { return text }
      }
      if (/quoted-printable/i.test(enc)) {
        return text.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      }
      return text
    }
    const ct = grab(/^Content-Type:\s*(.+)$/im)
    const bm = ct.match(/boundary="?([^";\s]+)"?/i)
    let body = rawBody
    if (bm) {
      const parts = rawBody.split('--' + bm[1])
      let plain = ''
      let html = ''
      for (const part of parts) {
        const ps = part.search(/\r?\n\r?\n/)
        const ph = ps >= 0 ? part.slice(0, ps) : part
        const pb = decodePart(ps >= 0 ? part.slice(ps).replace(/^\r?\n\r?\n/, '') : '', (ph.match(/^Content-Transfer-Encoding:\s*(.+)$/im) || [])[1] || '')
        if (/text\/plain/i.test(ph) && !plain) plain = pb
        else if (/text\/html/i.test(ph) && !html) html = pb
      }
      body = plain || stripHtml(html) || '(empty body)'
    } else if (/text\/html/i.test(ct)) {
      body = stripHtml(rawBody)
    } else {
      body = decodePart(rawBody, grab(/^Content-Transfer-Encoding:\s*(.+)$/im))
    }
    body = body.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    if (!body.trim()) body = '(empty body)'
    await mailWrite(sock, 'LOGOUT\r\n').catch(() => {})
    const flat = body.replace(/\s+/g, ' ').trim()
    return {
      uid,
      from: grab(/^From:\s*(.+)$/im),
      to: grab(/^To:\s*(.+)$/im),
      subject: grab(/^Subject:\s*(.+)$/im) || '(no subject)',
      date: grab(/^Date:\s*(.+)$/im),
      snippet: flat.slice(0, 200),
      body: body.length > 60000 ? body.slice(0, 60000) + '\n... [truncated]' : body,
    }
  } finally {
    mailClose(sock)
  }
}

/** Login probe for the Connect button: IMAP LOGIN + SELECT, nothing else. */
async function mailImapCheck(a) {
  const { user, pass } = mailCreds(a)
  const sock = await mailImapSession(user, pass)
  await mailWrite(sock, 'LOGOUT\r\n').catch(() => {})
  mailClose(sock)
  return { ok: true, email: user }
}

async function invoke(cmd, a) {
  a = a || {}
  if (cmd === 'get_app_version') return app.getVersion()
  if (cmd === 'home_dir') return homedir()
  if (cmd === 'http_fetch') return httpFetch(a)
  if (cmd === 'mail_smtp_send') return mailSmtpSend(a)
  if (cmd === 'mail_imap_search') return mailImapSearch(a)
  if (cmd === 'mail_imap_read') return mailImapRead(a)
  if (cmd === 'mail_imap_check') return mailImapCheck(a)
  if (cmd === 'spotify_oauth_listen') return spotifyOAuthListen()
  if (cmd === 'spotify_oauth_wait') return spotifyOAuthWait(a)
  if (cmd === 'spotify_oauth_cancel') { spotifyOAuthClose(); return true }
  if (cmd === 'load_state') return readState(a.key)
  if (cmd === 'save_state') { if (typeof a.value !== 'string') throw new Error('State value must be a string'); return writeState(a.key, a.value) }
  if (cmd === 'fs_read_file') return readFile(String(a.path), 'utf8').catch((e) => { throw new Error('Failed to read ' + a.path + ': ' + e.message) })
  if (cmd === 'fs_read_file_range') {
    const c = await readFile(String(a.path), 'utf8').catch((e) => { throw new Error('Failed to read: ' + e.message) })
    const lines = c.split('\n')
    const sN = Number(a.startLine !== undefined ? a.startLine : a.start_line !== undefined ? a.start_line : 1) || 1
    const start = Math.max(sN - 1, 0)
    if (start >= lines.length) return ''
    const eN = Number(a.endLine !== undefined ? a.endLine : a.end_line !== undefined ? a.end_line : 0) || 0
    const end = eN === 0 ? lines.length : Math.min(eN, lines.length)
    return lines.slice(start, end).join('\n')
  }
  if (cmd === 'fs_write_file') {
    const p = String(a.path)
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, String(a.content !== undefined ? a.content : ''))
    return true
  }
  if (cmd === 'fs_append_file') {
    const p = String(a.path)
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, String(a.content !== undefined ? a.content : ''), { flag: 'a' })
    return true
  }
  if (cmd === 'fs_replace_in_file') {
    const p = String(a.path)
    const c = await readFile(p, 'utf8').catch((e) => { throw new Error('Failed to read: ' + e.message) })
    const s = String(a.search !== undefined ? a.search : '')
    if (c.indexOf(s) < 0) throw new Error('Search text not found in ' + p)
    const r = String(a.replace !== undefined ? a.replace : '')
    await writeFile(p, a.all === true ? c.split(s).join(r) : c.replace(s, r))
    return true
  }
  if (cmd === 'fs_write_file_range') {
    const p = String(a.path)
    const c = await readFile(p, 'utf8').catch((e) => { throw new Error('Failed to read: ' + e.message) })
    const lines = c.split('\n')
    const sN = Number(a.startLine !== undefined ? a.startLine : a.start_line !== undefined ? a.start_line : 1) || 1
    const start = Math.max(sN - 1, 0)
    const eN = Number(a.endLine !== undefined ? a.endLine : a.end_line !== undefined ? a.end_line : 0) || 0
    const end = eN === 0 ? lines.length : Math.min(eN, lines.length)
    const rep = String(a.content !== undefined ? a.content : '').split('\n')
    const next = lines.slice(0, start).concat(rep).concat(lines.slice(end))
    await writeFile(p, next.join('\n'))
    return next.join('\n').length
  }
  if (cmd === 'fs_delete_file') { await rm(String(a.path)).catch((e) => { throw new Error('Failed to delete: ' + e.message) }); return true }
  if (cmd === 'fs_delete_dir') { await rm(String(a.path), { recursive: true, force: false }).catch((e) => { throw new Error('Failed to delete: ' + e.message) }); return true }
  if (cmd === 'fs_create_dir') { await mkdir(String(a.path), { recursive: true }).catch((e) => { throw new Error('Failed to create: ' + e.message) }); return true }
  if (cmd === 'fs_list_dir') {
    const dir = String(a.path)
    const entries = await readdir(dir, { withFileTypes: true }).catch((e) => { throw new Error('Failed to list: ' + e.message) })
    const out = []
    for (const en of entries) {
      const full = join(dir, en.name)
      let st = null
      try { st = await stat(full) } catch { st = null }
      out.push(metaToEntry(full, st))
    }
    out.sort((x, y) => Number(y.is_dir) - Number(x.is_dir) || x.name.toLowerCase().localeCompare(y.name.toLowerCase()))
    return out
  }
  if (cmd === 'fs_search_files') {
    const out = []
    await searchRec(String(a.path), String(a.pattern !== undefined ? a.pattern : ''), a.content === true, out)
    if (out.length >= SEARCH_LIMIT) out.push('... truncated at ' + SEARCH_LIMIT + ' matches')
    return out
  }
  return invokeB(cmd, a)
}


/* --- invoke router B: meta, procs, terms, ollama, mcp, updater --- */
async function invokeB(cmd, a) {
  if (cmd === 'fs_stat') {
    const p = String(a.path)
    const st = await stat(p).catch((e) => { throw new Error('Failed to stat: ' + e.message) })
    return { path: p, isDir: st.isDirectory(), size: st.size, modified: Math.floor(st.mtimeMs / 1000) }
  }
  if (cmd === 'fs_copy_file') {
    const to = String(a.newPath !== undefined ? a.newPath : a.new_path !== undefined ? a.new_path : '')
    if (!to) throw new Error('Destination path is required')
    await mkdir(dirname(to), { recursive: true })
    await copyFile(String(a.path), to).catch((e) => { throw new Error('Failed to copy: ' + e.message) })
    return true
  }
  if (cmd === 'fs_rename') {
    const to = String(a.newPath !== undefined ? a.newPath : a.new_path !== undefined ? a.new_path : '')
    if (!to) throw new Error('Destination path is required')
    await rename(String(a.path), to).catch((e) => { throw new Error('Failed to rename: ' + e.message) })
    return true
  }
  if (cmd === 'run_command') return runCommand(a)
  if (cmd === 'terminal_create') return termCreate(a)
  if (cmd === 'terminal_write') {
    const pr = terms.get(Number(a.id))
    if (!pr) throw new Error('Terminal ' + a.id + ' is not running')
    pr.write(String(a.data !== undefined ? a.data : ''))
    return null
  }
  if (cmd === 'terminal_resize') {
    const pr = terms.get(Number(a.id))
    if (!pr) throw new Error('Terminal ' + a.id + ' is not running')
    try { pr.resize(Number(a.cols) || 80, Number(a.rows) || 24) } catch {}
    return null
  }
  if (cmd === 'terminal_kill') {
    const pr = terms.get(Number(a.id))
    if (pr) { terms.delete(Number(a.id)); try { pr.kill() } catch {} }
    return null
  }
  if (cmd === 'check_ollama_installed') return ollInstalled()
  if (cmd === 'check_ollama_running') return ollAlive()
  if (cmd === 'ollama_request') {
    // The preload bridge has no raw-chunk channel, so we buffer the Ollama
    // response here and hand the renderer the full NDJSON body. The renderer's
    // SSE/NDJSON parser reads that Response line-by-line, so the reply still
    // renders incrementally and token usage records on the final `done` chunk.
    const r = await ollHttp({ url: String(a.url), method: String(a.method || 'GET'), body: a.body !== undefined ? a.body : undefined })
    return { status: r.status, body: r.body }
  }
  if (cmd === 'start_ollama_server') return startOllama()
  if (cmd === 'stop_ollama_server') return stopOllama()
  if (cmd === 'list_local_models') return ollTags()
  if (cmd === 'pull_local_model') return ollPull(String(a.modelName !== undefined ? a.modelName : a.model_name !== undefined ? a.model_name : ''))
  if (cmd === 'delete_local_model') return ollDel(String(a.modelName !== undefined ? a.modelName : a.model_name !== undefined ? a.model_name : ''))

  /* --- llama.cpp (managed local runtime) --- */
  if (cmd === 'llamacpp_hardware') return llamacpp.detectHardware()
  if (cmd === 'llamacpp_runtime_status') return llamacpp.runtimeStatus()
  if (cmd === 'llamacpp_search_models') {
    return llamacpp.searchModels(String(a.query ?? a.search ?? ''), {
      limit: a.limit !== undefined ? a.limit : a.limit_count,
    })
  }
  if (cmd === 'llamacpp_list_files') {
    return llamacpp.listModelFiles(String(a.repoId ?? a.repo_id ?? ''))
  }
  if (cmd === 'llamacpp_estimate_fit') {
    const hw = a.hardware ? a.hardware : await llamacpp.detectHardware()
    return llamacpp.estimateFit(Number(a.size ?? a.fileSize ?? 0), hw, {
      contextLength: a.contextLength ?? a.context_length,
    })
  }
  if (cmd === 'llamacpp_install_runtime') {
    // Progress is streamed to the renderer as `llamacpp:progress` events.
    return llamacpp.installRuntime((p) => emitToRenderer('llamacpp:progress', p))
  }
  if (cmd === 'llamacpp_download_model') {
    const spec = a.spec ?? a
    return llamacpp.downloadModel(spec, (p) => emitToRenderer('llamacpp:progress', p))
  }
  if (cmd === 'llamacpp_cancel_download') {
    return llamacpp.cancelDownload(String(a.id ?? ''))
  }
  if (cmd === 'llamacpp_list_models') return llamacpp.listLocalModels()
  if (cmd === 'llamacpp_delete_model') {
    return llamacpp.deleteLocalModel(String(a.id ?? a.modelId ?? ''))
  }
  if (cmd === 'llamacpp_start_server') {
    const modelId = String(a.modelId ?? a.id ?? '')
    const port = Number(a.port) || LLAMA_DEFAULT_PORT
    // Allow the proxy to reach the server on this port.
    llamaAllowedPorts.add(port)
    try {
      return await llamacpp.startServer(modelId, {
        port,
        contextLength: a.contextLength ?? a.context_length,
        threads: a.threads,
        gpuLayers: a.gpuLayers ?? a.gpu_layers,
        jinja: !!a.jinja,
      })
    } catch (e) {
      // The server never came up — stop allowing the port again.
      llamaAllowedPorts.delete(port)
      throw e
    }
  }
  if (cmd === 'llamacpp_stop_server') return llamacpp.stopServer()
  if (cmd === 'llamacpp_server_status') return llamacpp.serverStatus()
  if (cmd === 'llamacpp_server_models') return llamacpp.listServerModels()
  if (cmd === 'llamacpp_request') {
    const r = await llamaHttp({
      url: String(a.url),
      method: String(a.method || 'GET'),
      body: a.body !== undefined && a.body !== null ? a.body : undefined,
    })
    return { status: r.status, body: r.body }
  }
  if (cmd === 'mcp_discover_configs') {
    const r = a.workspaceRoot !== undefined ? a.workspaceRoot : a.workspace_root
    return mcpCands(r !== undefined ? r : null)
  }
  if (cmd === 'expand_env_string') return expandEnv(String(a.input !== undefined ? a.input : ''))
  if (cmd === 'mcp_stdio_start') return mcpStart(a)
  if (cmd === 'mcp_stdio_send') return mcpSend(a)
  if (cmd === 'mcp_stdio_read') return mcpRead(a)
  if (cmd === 'mcp_stdio_stop') return mcpStop(a)
  if (cmd === 'download_file') return dlFile(String(a.url || ''))
  if (cmd === 'launch_downloaded') return launchDl(a)
  throw new Error('Electron native command is not implemented: ' + cmd)
}


/* --- updater download + ipc + lifecycle --- */
function dlFile(url) {
  let parsed
  try { parsed = new URL(url) } catch { throw new Error('Invalid download URL: ' + url) }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Unsupported URL scheme')
  const fetch1 = (target, depth) => {
    if (depth > 5) throw new Error('Too many redirects')
    const lib = target.protocol === 'https:' ? require('node:https') : require('node:http')
    return new Promise((resolveP, reject) => {
      const req = lib.get(target.href, { headers: { 'User-Agent': 'Neo-Updater' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          req.destroy()
          fetch1(new URL(res.headers.location, target.href), depth + 1).then(resolveP, reject)
          return
        }
        if (res.statusCode < 200 || res.statusCode >= 300) { reject(new Error('Download server returned ' + res.statusCode)); return }
        const nm = basename(target.pathname) || 'neo-update.bin'
        const dest = join(app.getPath('temp'), 'neo-' + Date.now() + '-' + nm)
        pipeline(res, createWriteStream(dest)).then(() => resolveP(dest), () => reject(new Error('Download failed')))
      })
      req.on('error', () => reject(new Error('Download failed: connection error')))
    })
  }
  return fetch1(parsed, 0)
}
function launchDl(a) {
  const t = String(a.path || '')
  if (!t || !existsSync(t)) throw new Error('Downloaded file not found')

  const isWindows = process.platform === 'win32'
  const isLinux = process.platform === 'linux'
  const isMac = process.platform === 'darwin'

  // Set up spawn options based on platform
  const spawnOptions = {
    detached: true,
    stdio: 'ignore',
  }

  // Windows: hide console for installer files, use shell for recognized extensions
  if (isWindows) {
    spawnOptions.windowsHide = true
    spawnOptions.shell = /\.(msi|bat|cmd|ps1)$/i.test(t)
  } else {
    // Linux/macOS: ensure the file is executable before launching
    try {
      chmodSync(t, 0o755)
    } catch (e) {
      // chmod may fail if running as non-root in some contexts; continue anyway
    }

    // On Linux, use shell to handle the executable properly
    // On macOS, avoid shell for DMG files; use direct spawn
    spawnOptions.shell = isLinux
  }

  const child = spawn(t, [], spawnOptions)
  if (child.unref) child.unref()
  // On non-Windows, give a slightly longer timeout for process startup
  const timeoutMs = isWindows ? 1500 : 2500
  setTimeout(() => app.quit(), timeoutMs)
  return null
}
function needWin() {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Neo window is not available')
  return mainWindow
}
ipcMain.handle('neo:native-invoke', async (_e, cmd, a) => {
  if (typeof cmd !== 'string') throw new Error('Native command name must be a string')
  return invoke(cmd, a || {})
})
ipcMain.handle('neo:event:emit', (_e, ev, payload) => {
  if (typeof ev !== 'string' || !/^[\w:/-]+$/.test(ev)) throw new Error('Invalid event name')
  emitToRenderer(ev, payload)
})
ipcMain.on('neo:deep-link:ready', (ev) => {
  if (ev.sender === (mainWindow && mainWindow.webContents)) { deepLinkReady = true; flushDeepLinks(ev) }
})
ipcMain.handle('neo:open-external', (_e, url) => openExternal(url))
ipcMain.handle('neo:dialog:open', async (_e, o) => {
  o = o || {}
  const props = []
  if (o.directory) props.push('openDirectory')
  else props.push('openFile')
  if (o.multiple) props.push('multiSelections')
  const r = await dialog.showOpenDialog(needWin(), { title: o.title, defaultPath: o.defaultPath, properties: props, filters: o.filters })
  if (r.canceled) return null
  return o.multiple ? r.filePaths : r.filePaths[0] || null
})
ipcMain.handle('neo:dialog:save', async (_e, o) => {
  o = o || {}
  const r = await dialog.showSaveDialog(needWin(), { title: o.title, defaultPath: o.defaultPath, filters: o.filters })
  return r.canceled ? null : r.filePath || null
})
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
else {
  app.on('second-instance', (_e, argv) => handleDeepLink(argv))
  app.on('open-url', (ev, url) => { ev.preventDefault(); sendDeepLink(url) })
}
if (gotLock) {
  app.whenReady().then(() => {
    app.setAsDefaultProtocolClient(APP_PROTOCOL, process.execPath)
    handleDeepLink(process.argv)
    createWindow()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  }).catch((e) => { console.error('[electron] Neo failed to start:', e); app.quit() })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
  app.on('before-quit', () => {
    for (const kv of terms) { try { kv[1].kill() } catch {} }
    terms.clear()
    for (const k of Array.from(mcpProcs.keys())) { try { mcpStopSync(k) } catch {} }
    if (ollamaChild && !ollamaChild.killed) { try { ollamaChild.kill() } catch {} }
    // Stop the managed llama-server so it does not outlive the app.
    try { llamacpp.stopServer() } catch {}
  })
}


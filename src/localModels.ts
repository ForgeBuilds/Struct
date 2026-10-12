/*
 * Author: madhusudhan
 * Check the LICENSE in the GitHub repo (https://github.com/Lumorix-studios/Struct) for more information on permissions to use this code.
 */
import { invoke } from "./native";

export interface LocalModelInfo {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    format: string;
    family: string;
    families: string[] | null;
    parameter_size: string;
    quantization_level: string;
  };
}

export interface LocalModelStatus {
  installed: boolean;
  running: boolean;
}

/** Result of `start_ollama_server` from the Rust backend. */
export interface OllamaStartStatus {
  /** An Ollama server is reachable on port 11434. */
  running: boolean;
  /** It was already running before this call — no process was spawned. */
  alreadyRunning: boolean;
  /** True when the server belongs to this app session (safe to Stop). */
  owned: boolean;
  /** True when the server is an orphan from a previous session we re-adopted. */
  adopted: boolean;
}

/** Result of `stop_ollama_server` from the Rust backend. */
export interface OllamaStopStatus {
  /** A server owned by this app was stopped. */
  stopped: boolean;
  /** A server is still listening but was started outside the app. */
  stillRunningExternal: boolean;
}

function inDesktop(): boolean {
  return Boolean(window.neoDesktop);
}

/**
 * Check if Ollama is installed on the system.
 */
export async function checkOllamaInstalled(): Promise<boolean> {
  if (!inDesktop()) return false;
  try {
    return await invoke<boolean>("check_ollama_installed");
  } catch {
    return false;
  }
}

/**
 * Check if the Ollama server is currently running.
 */
export async function checkOllamaRunning(): Promise<boolean> {
  if (!inDesktop()) return false;
  try {
    return await invoke<boolean>("check_ollama_running");
  } catch {
    return false;
  }
}

/**
 * Start the Ollama server as a background process.
 *
 * Returns the backend's status: whether a server is running, whether it was
 * already running before this call, and whether it is owned by the app. An
 * external server (started by the Ollama tray app, another tool, or an old
 * session) is *reused*, never duplicated, and reported as not owned.
 */
export async function startOllamaServer(): Promise<OllamaStartStatus | null> {
  if (!inDesktop()) return null;
  try {
    return await invoke<OllamaStartStatus>("start_ollama_server");
  } catch (e) {
    // Surface the backend message (e.g. "port 11434 is used by another
    // program") instead of swallowing it behind a boolean.
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/**
 * Stop the Ollama server process started by the app. Reports
 * `stillRunningExternal` when a server started outside the app keeps
 * listening — the UI should tell the user to stop it from its own tray.
 */
export async function stopOllamaServer(): Promise<OllamaStopStatus | null> {
  if (!inDesktop()) return null;
  try {
    return await invoke<OllamaStopStatus>("stop_ollama_server");
  } catch {
    return null;
  }
}

/**
 * List installed local models via the Ollama API.
 */
export async function listLocalModels(): Promise<LocalModelInfo[]> {
  if (!inDesktop()) return [];
  try {
    const models = await invoke<LocalModelInfo[]>("list_local_models");
    return models ?? [];
  } catch {
    return [];
  }
}

/**
 * Pull a model from the Ollama registry.
 */
export async function pullLocalModel(modelName: string): Promise<boolean> {
  if (!inDesktop()) return false;
  try {
    return await invoke<boolean>("pull_local_model", { modelName });
  } catch {
    return false;
  }
}

/**
 * Delete a local model.
 */
export async function deleteLocalModel(modelName: string): Promise<boolean> {
  if (!inDesktop()) return false;
  try {
    return await invoke<boolean>("delete_local_model", { modelName });
  } catch {
    return false;
  }
}

/**
 * Get the full status (installed + running) in one call.
 */
export async function getLocalModelStatus(): Promise<LocalModelStatus> {
  const [installed, running] = await Promise.all([
    checkOllamaInstalled(),
    checkOllamaRunning(),
  ]);
  return { installed, running };
}

/**
 * Make sure an Ollama server is reachable before a local model is used.
 *
 * This is the guard for the "switch model while the app is open" flow: it
 * reuses any server already on port 11434 (the app's own or an external one),
 * starts a fresh one if none is up, and returns `null` on success or a
 * human-readable error message on failure.
 */
export async function ensureOllamaReady(): Promise<string | null> {
  if (await checkOllamaRunning()) return null;
  try {
    const status = await startOllamaServer();
    if (status?.running) return null;
    return "The Ollama server could not be started.";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/**
 * Format a model size in bytes to a human-readable string.
 */
export function formatModelSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}
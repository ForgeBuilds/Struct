// Typed renderer-side API for the managed llama.cpp runtime.
//
// The native module (electron/llamacpp.cjs) owns everything that touches the
// network or the filesystem: Hugging Face search, GGUF downloads, the runtime
// install and the `llama-server` process. The renderer only ever sees plain
// data, so it never has to deal with CORS, file locks or half-written models.

import { invoke, listen } from "./native";

/** Event the native side emits while a runtime/model download is running. */
export const LLAMACPP_PROGRESS_EVENT = "llamacpp:progress";

/** Conservative facts about the machine, used for the fit estimate. */
export interface LlamaCppHardware {
  platform: string;
  arch: string;
  osArch: string;
  cpuModel: string;
  cpuCores: number;
  ramBytes: number;
  freeRamBytes: number;
  freeDiskBytes: number;
  /** llama.cpp CPU builds need a 64-bit host (x86_64 / arm64). */
  supportedArch: boolean;
  /** True when the host exposes AVX2 (x64) — noticeably faster inference. */
  hasAvx2: boolean;
}

/** A GGUF repository as listed by the Hugging Face search API. */
export interface LlamaCppSearchResult {
  id: string;
  downloads: number;
  likes: number;
  pipelineTag: string | null;
  license: string | null;
  tags: string[];
  totalSize: number;
  architecture: string | null;
  contextLength: number;
}

/** One downloadable GGUF file inside a repository. */
export interface LlamaCppFile {
  name: string;
  size: number;
  sha256: string | null;
  /** Quantization tag (e.g. `Q4_K_M`), when it could be derived. */
  quant: string | null;
}

/** The GGUF files of a repository. */
export interface LlamaCppRepoFiles {
  repoId: string;
  files: LlamaCppFile[];
  totalSize: number;
  architecture: string | null;
  contextLength: number;
  license: string | null;
}

/** Verdict of the RAM/disk estimate for a candidate model file. */
export interface LlamaCppFit {
  fileSize: number;
  requiredRamBytes: number;
  status: "ok" | "tight" | "risky" | "impossible" | "unknown";
  reason: string | null;
  canRun: boolean;
}

/** Progress of a running runtime or model download. */
export interface LlamaCppProgress {
  /** Present for model downloads; the runtime download has none. */
  id?: string;
  phase: "downloading" | "extracting" | "done" | "cancelled" | string;
  received: number;
  total: number;
  percent: number;
}


/** State of the managed llama.cpp runtime. */
export interface LlamaCppRuntimeStatus {
  installed: boolean;
  /** The pinned llama.cpp build number (e.g. `b11765`). */
  build: string;
  path: string;
  /** The release asset that would be installed, if the platform has one. */
  asset: { name: string; url: string; kind: "tar.gz" | "zip" } | null;
  /** False when no official build exists for this platform/architecture. */
  supported: boolean;
}

/** A model that was downloaded into the local model directory. */
export interface LlamaCppLocalModel {
  id: string;
  path: string;
  fileName: string;
  repoId: string | null;
  displayName: string;
  quant: string | null;
  size: number;
  modifiedAt: number;
}

/** State of the running `llama-server`. */
export interface LlamaCppServerStatus {
  running: boolean;
  port: number;
  url: string | null;
  modelId: string | null;
  modelPath: string | null;
  startedAt: number;
  logs: string[];
}

/** Options for starting the local server. */
export interface LlamaCppStartOptions {
  port?: number;
  contextLength?: number;
  threads?: number;
  gpuLayers?: number;
  jinja?: boolean;
}

/** A model the running server serves (from `/v1/models`). */
export interface LlamaCppServerModel {
  id: string;
  ownedBy: string | null;
}


/* ── API ──────────────────────────────────────────────────────────────── */

export function hardware(): Promise<LlamaCppHardware> {
  return invoke<LlamaCppHardware>("llamacpp_hardware");
}

export function runtimeStatus(): Promise<LlamaCppRuntimeStatus> {
  return invoke<LlamaCppRuntimeStatus>("llamacpp_runtime_status");
}

export function searchModels(
  query: string,
  limit = 20,
): Promise<LlamaCppSearchResult[]> {
  return invoke<LlamaCppSearchResult[]>("llamacpp_search_models", {
    query,
    limit,
  });
}

export function listRepoFiles(repoId: string): Promise<LlamaCppRepoFiles> {
  return invoke<LlamaCppRepoFiles>("llamacpp_list_files", { repoId });
}

export function estimateFit(
  size: number,
  contextLength?: number,
): Promise<LlamaCppFit> {
  return invoke<LlamaCppFit>("llamacpp_estimate_fit", {
    size,
    contextLength,
  });
}

export function downloadModel(spec: {
  repoId: string;
  fileName: string;
  size: number;
  sha256?: string | null;
}): Promise<{
  id: string;
  path: string;
  size: number;
  fileName: string;
  repoId: string;
}> {
  return invoke("llamacpp_download_model", { spec });
}

export function cancelDownload(id: string): Promise<boolean> {
  return invoke<boolean>("llamacpp_cancel_download", { id });
}

export function listLocalModels(): Promise<LlamaCppLocalModel[]> {
  return invoke<LlamaCppLocalModel[]>("llamacpp_list_models");
}

export function deleteLocalModel(id: string): Promise<{ id: string }> {
  return invoke<{ id: string }>("llamacpp_delete_model", { id });
}

export function startServer(
  modelId: string,
  options: LlamaCppStartOptions = {},
): Promise<LlamaCppServerStatus> {
  return invoke<LlamaCppServerStatus>("llamacpp_start_server", {
    modelId,
    ...options,
  });
}

export function stopServer(): Promise<LlamaCppServerStatus> {
  return invoke<LlamaCppServerStatus>("llamacpp_stop_server");
}

export function serverStatus(): Promise<LlamaCppServerStatus> {
  return invoke<LlamaCppServerStatus>("llamacpp_server_status");
}

export function serverModels(): Promise<LlamaCppServerModel[]> {
  return invoke<LlamaCppServerModel[]>("llamacpp_server_models");
}

/** Subscribe to download/extraction progress. Returns an unsubscribe fn. */
export function onProgress(
  callback: (progress: LlamaCppProgress) => void,
): Promise<() => void> {
  return listen<LlamaCppProgress>(LLAMACPP_PROGRESS_EVENT, (event) =>
    callback(event.payload),
  );
}

/** Format a byte count for display (e.g. `4.7 GB`). */
export function formatBytes(bytes: number): string {
  const n = Number(bytes) || 0;
  if (n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(n) / Math.log(1024)),
  );
  const value = n / Math.pow(1024, i);
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}


export function installRuntime(): Promise<{ path: string; build: string }> {
  return invoke<{ path: string; build: string }>("llamacpp_install_runtime");
}

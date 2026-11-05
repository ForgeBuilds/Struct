import { useCallback, useEffect, useRef, useState } from "react";
import {
  IoServer,
  IoPlay,
  IoStop,
  IoTrash,
  IoDownload,
  IoRefresh,
  IoCube,
  IoCheckmarkCircle,
  IoAlertCircle,
  IoClose,
  IoSearch,
  IoHardwareChipOutline,
  IoCloudDownloadOutline,
} from "react-icons/io5";
import {
  checkOllamaInstalled,
  checkOllamaRunning,
  startOllamaServer,
  stopOllamaServer,
  listLocalModels,
  pullLocalModel,
  deleteLocalModel,
  formatModelSize,
  type LocalModelSelection,
  type LocalModelInfo,
} from "../src/localModels";
import * as llama from "../src/llamacpp";
import { useTranslation } from "../src/i18n";

interface Props {
  onClose: () => void;
  /** Returns an error message, or null on success (may be async). */
  onSelectModel: (selection: LocalModelSelection) => void | Promise<string | null>;
  selectedModel: string;
}

type Engine = "ollama" | "llamacpp";

const POPULAR_MODELS = [
  "llama3.2",
  "llama3.1",
  "mistral",
  "gemma2",
  "phi3",
  "qwen2.5",
  "codellama",
  "deepseek-coder",
];

export default function LocalModels({ onClose, onSelectModel, selectedModel }: Props) {
  const { t } = useTranslation();
  const [installed, setInstalled] = useState(false);
  const [running, setRunning] = useState(false);
  const [models, setModels] = useState<LocalModelInfo[]>([]);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [pulling, setPulling] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pullName, setPullName] = useState("");
  const [showPullInput, setShowPullInput] = useState(false);
  const [engine, setEngine] = useState<Engine>("ollama");
  const [llamaHardware, setLlamaHardware] = useState<llama.LlamaCppHardware | null>(null);
  const [llamaRuntime, setLlamaRuntime] = useState<llama.LlamaCppRuntimeStatus | null>(null);
  const [llamaServer, setLlamaServer] = useState<llama.LlamaCppServerStatus | null>(null);
  const [llamaModels, setLlamaModels] = useState<llama.LlamaCppLocalModel[]>([]);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<llama.LlamaCppSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [repoFiles, setRepoFiles] = useState<llama.LlamaCppRepoFiles | null>(null);
  const [selectedFile, setSelectedFile] = useState<llama.LlamaCppFile | null>(null);
  const [fit, setFit] = useState<llama.LlamaCppFit | null>(null);
  const [llamaProgress, setLlamaProgress] = useState<llama.LlamaCppProgress | null>(null);
  const [llamaBusy, setLlamaBusy] = useState(false);
  const [downloadId, setDownloadId] = useState<string | null>(null);
  const downloadIdRef = useRef<string | null>(null);

  const refreshStatus = useCallback(async () => {
    const [isInstalled, isRunning] = await Promise.all([
      checkOllamaInstalled(),
      checkOllamaRunning(),
    ]);
    setInstalled(isInstalled);
    setRunning(isRunning);
    if (isRunning) {
      const modelList = await listLocalModels();
      setModels(modelList);
    } else {
      setModels([]);
    }
  }, []);

  const refreshLlama = useCallback(async () => {
    try {
      const [runtime, hardware, local, server] = await Promise.all([
        llama.runtimeStatus(),
        llama.hardware(),
        llama.listLocalModels(),
        llama.serverStatus(),
      ]);
      setLlamaRuntime(runtime);
      setLlamaHardware(hardware);
      setLlamaModels(local);
      setLlamaServer(server);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load llama.cpp status.");
    }
  }, []);

  useEffect(() => {
    // Deferred one microtask so the fetch's setState calls never run
    // synchronously inside the effect body (cascading-render lint rule).
    void Promise.resolve().then(() => refreshStatus());
  }, [refreshStatus]);

  useEffect(() => {
    void Promise.resolve().then(() => refreshLlama());
    let stop: (() => void) | undefined;
    let cancelled = false;
    void llama.onProgress((progress) => {
      if (!progress.id || progress.id === downloadIdRef.current) setLlamaProgress(progress);
    }).then((unsubscribe) => {
      if (cancelled) unsubscribe();
      else stop = unsubscribe;
    }).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [refreshLlama]);

  const handleSearch = async () => {
    setSearching(true);
    setError(null);
    try {
      setSearchResults(await llama.searchModels(search.trim(), 24));
      setSelectedRepo(null);
      setRepoFiles(null);
      setSelectedFile(null);
      setFit(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Hugging Face model search failed.");
    }
    setSearching(false);
  };

  const handleOpenRepo = async (repoId: string) => {
    setSelectedRepo(repoId);
    setRepoFiles(null);
    setSelectedFile(null);
    setFit(null);
    setError(null);
    try {
      const files = await llama.listRepoFiles(repoId);
      setRepoFiles(files);
      const recommended = files.files.find((file) => /Q4_K_M/i.test(file.quant || "")) ??
        files.files.find((file) => /Q4/i.test(file.quant || "")) ??
        files.files[0] ??
        null;
      setSelectedFile(recommended);
      if (recommended) setFit(await llama.estimateFit(recommended.size, files.contextLength));
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not load files for ${repoId}.`);
    }
  };

  const handleChooseFile = async (file: llama.LlamaCppFile) => {
    setSelectedFile(file);
    setFit(null);
    if (!file.size) return;
    try {
      setFit(await llama.estimateFit(file.size, repoFiles?.contextLength));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not estimate model compatibility.");
    }
  };

  const handleInstallRuntime = async () => {
    setLlamaBusy(true);
    setError(null);
    setLlamaProgress({ phase: "downloading", received: 0, total: 0, percent: 0 });
    try {
      await llama.installRuntime();
      await refreshLlama();
      setSuccess("llama.cpp runtime installed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not install llama.cpp.");
    }
    setLlamaBusy(false);
  };

  const handleDownload = async () => {
    if (!selectedRepo || !selectedFile) return;
    const id = crypto.randomUUID();
    downloadIdRef.current = id;
    setDownloadId(id);
    setLlamaBusy(true);
    setError(null);
    setLlamaProgress({ id, phase: "downloading", received: 0, total: selectedFile.size, percent: 0 });
    try {
      await llama.downloadModel({
        id,
        repoId: selectedRepo,
        fileName: selectedFile.name,
        size: selectedFile.size,
        sha256: selectedFile.sha256,
      });
      await refreshLlama();
      setSuccess("GGUF model downloaded.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Model download failed.");
    }
    setLlamaBusy(false);
    downloadIdRef.current = null;
    setDownloadId(null);
  };

  const handleCancelDownload = async () => {
    if (!downloadId) return;
    try {
      await llama.cancelDownload(downloadId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel the download.");
    }
  };

  const handleStart = async () => {
    setStarting(true);
    setError(null);
    try {
      const status = await startOllamaServer();
      if (status?.running) {
        setRunning(true);
        if (status.alreadyRunning && !status.owned) {
          // Port 11434 was already served by an Ollama started outside this
          // app — we reuse it instead of spawning a duplicate that would die
          // on bind. Stop will find and stop it by port ownership.
          setSuccess(
            t("localModels.reusedExternal")
          );
        } else if (status.adopted) {
          // The server was an orphan left behind by a previous session — we
          // re-adopted it, so Stop works on it again.
          setSuccess(
            t("localModels.adoptedOrphan")
          );
        } else {
          setSuccess(t("localModels.started"));
        }
        const modelList = await listLocalModels();
        setModels(modelList);
      } else {
        setError(t("localModels.startFailed"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("localModels.startFailed"));
    }
    // Trailing statements instead of `finally`: try/finally is a construct the
    // React Compiler bails out on, which would opt this whole component out of
    // automatic memoization. The catch above never rethrows, so behaviour is
    // identical.
    setStarting(false);
    setTimeout(() => setSuccess(null), 4000);
  };

  const handleStop = async () => {
    setStopping(true);
    setError(null);
    try {
      const status = await stopOllamaServer();
      if (status?.stopped) {
        setRunning(false);
        setModels([]);
        setSuccess(t("localModels.stopped"));
      } else if (status?.stillRunningExternal) {
        // Port 11434 is held by something we could not identify as Ollama,
        // so we never touch it.
        setSuccess(
          t("localModels.portBusy")
        );
      } else {
        setError(t("localModels.notRunning"));
        setRunning(false);
        setModels([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("localModels.stopFailed"));
    }
    setStopping(false);
    setTimeout(() => setSuccess(null), 4000);
  };

  const handlePull = async (name: string) => {
    const modelName = name.trim();
    if (!modelName) return;
    setPulling(modelName);
    setError(null);
    setSuccess(null);
    try {
      const ok = await pullLocalModel(modelName);
      if (ok) {
        setSuccess(`Model "${modelName}" pulled successfully.`);
        const modelList = await listLocalModels();
        setModels(modelList);
        setPullName("");
        setShowPullInput(false);
      } else {
        setError(t("localModels.pullFailed", { name: modelName }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("localModels.pullFailed", { name: modelName }));
    }
    setPulling(null);
    setTimeout(() => setSuccess(null), 3000);
  };

  const handleDelete = async (name: string) => {
    setDeleting(name);
    setError(null);
    try {
      const ok = await deleteLocalModel(name);
      if (ok) {
        setSuccess(`Model "${name}" deleted.`);
        const modelList = await listLocalModels();
        setModels(modelList);
      } else {
        setError(t("localModels.deleteFailed", { name }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("localModels.deleteFailed", { name }));
    }
    setDeleting(null);
    setTimeout(() => setSuccess(null), 3000);
  };

  const handleSelect = async (name: string) => {
    const err = await onSelectModel({ provider: "ollama", model: name });
    if (err) {
      setError(
        `Model "${name}" selected, but the Ollama server isn't reachable: ${err}`
      );
    } else {
      setSuccess(`Model "${name}" selected.`);
      setTimeout(() => setSuccess(null), 2000);
    }
  };

  const handleSelectLlama = async (modelId: string) => {
    setLlamaBusy(true);
    setError(null);
    const err = await onSelectModel({ provider: "llamacpp", modelId });
    setLlamaBusy(false);
    if (err) setError(`Could not start this local model: ${err}`);
    else setSuccess("llama.cpp model started and selected.");
  };

  const handleStopLlama = async () => {
    setLlamaBusy(true);
    setError(null);
    try {
      await llama.stopServer();
      await refreshLlama();
      setSuccess("llama.cpp server stopped.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not stop llama.cpp.");
    }
    setLlamaBusy(false);
  };

  const renderProgress = (progress: llama.LlamaCppProgress | null) => {
    if (!progress) return null;
    const percent = Math.max(0, Math.min(100, progress.percent || 0));
    return (
      <div className="rounded-lg border border-(--border) bg-(--fill-1) p-3">
        <div className="mb-2 flex items-center justify-between gap-2 text-[10.5px] text-[var(--text-secondary)]">
          <span>
            {progress.phase === "extracting"
              ? "Installing runtime…"
              : progress.phase === "done"
                ? "Download complete"
                : progress.phase === "cancelled"
                  ? "Download cancelled"
                  : "Downloading…"}
          </span>
          {progress.total > 0 && (
            <span>{formatModelSize(progress.received)} / {formatModelSize(progress.total)}</span>
          )}
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-(--fill-2)">
          <div
            className="h-full rounded-full bg-(--accent) transition-[width]"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="mt-1 text-right text-[9.5px] text-[var(--text-muted)]">
          {progress.phase === "extracting" ? "Preparing files" : `${percent}%`}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full w-full flex-col bg-[var(--bg-panel)] text-[var(--text-primary)]">
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-(--border) px-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
          {t("localModels.title")}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label={t("localModels.refresh")}
            title={t("localModels.refreshStatus")}
            onClick={() => void Promise.all([refreshStatus(), refreshLlama()])}
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
          >
            <IoRefresh size={14} />
          </button>
          <button
            type="button"
            aria-label={t("localModels.close")}
            title={t("localModels.close")}
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
          >
            <IoClose size={15} />
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 px-4 py-4">
          <div className="flex gap-1 rounded-lg bg-(--fill-1) p-1">
            {([
              ["ollama", "Ollama"],
              ["llamacpp", "llama.cpp"],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setEngine(id)}
                className={`flex-1 rounded-md px-3 py-2 text-[11px] font-medium transition ${
                  engine === id
                    ? "bg-(--fill-2) text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Server Status */}
          {engine === "ollama" && <section>
            <h3 className="mb-2.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
              <IoServer size={13} />
              {t("localModels.serverStatus")}
            </h3>

            {!installed ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.08] px-3 py-2.5">
                <IoAlertCircle size={15} className="mt-0.5 shrink-0 text-[var(--warning)]" />
                <div className="text-[11.5px] leading-5 text-[var(--warning)]">
                  <p className="m-0 font-medium">{t("localModels.notInstalledTitle")}</p>
                  <p className="m-0 mt-1 text-[11px] text-[var(--text-muted)]">
                    {t("localModels.installOllamaFrom")}{" "}
                    <a
                      href="https://ollama.com"
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-[var(--text-primary)]"
                    >
                      ollama.com
                    </a>{" "}
                    {t("localModels.installOllamaTail")}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      running ? "bg-emerald-500" : "bg-zinc-600"
                    }`}
                  />
                  <span className="text-[12.5px] font-medium">
                    {running ? t("localModels.serverRunning") : t("localModels.serverStopped")}
                  </span>
                  <span className="text-[10.5px] text-[var(--text-muted)]">localhost:11434</span>
                </div>

                {!running ? (
                  <button
                    type="button"
                    onClick={handleStart}
                    disabled={starting}
                    className="flex items-center justify-center gap-1.5 rounded-md bg-(--accent) px-3 py-2 text-[12px] font-semibold text-(--on-accent) transition hover:opacity-90 disabled:opacity-50"
                  >
                    <IoPlay size={13} />
                    {starting ? t("localModels.starting") : t("localModels.startServer")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleStop}
                    disabled={stopping}
                    className="flex items-center justify-center gap-1.5 rounded-md border border-red-500/25 bg-red-500/[0.08] px-3 py-2 text-[12px] font-semibold text-[var(--danger)] transition hover:bg-red-500/[0.14] disabled:opacity-50"
                  >
                    <IoStop size={13} />
                    {stopping ? t("localModels.stopping") : t("localModels.stopServer")}
                  </button>
                )}
              </div>
            )}
          </section>}

          {/* Error / Success messages */}
          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/[0.08] px-3 py-2.5 text-[11.5px] leading-5 text-[var(--danger)]">
              {error}
            </div>
          )}
          {success && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.08] px-3 py-2.5 text-[11.5px] leading-5 text-[var(--success)]">
              {success}
            </div>
          )}

          {/* Installed Models */}
          {engine === "ollama" && running && (
            <section>
              <div className="mb-2.5 flex items-center justify-between">
                <h3 className="m-0 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                  <IoCube size={13} />
                  Installed Models
                  <span className="rounded-sm bg-(--fill-2) px-1.5 py-0.5 text-[9.5px] text-[var(--text-secondary)]">
                    {models.length}
                  </span>
                </h3>
                <button
                  type="button"
                  onClick={() => setShowPullInput((v) => !v)}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
                >
                  <IoDownload size={12} />
                  {t("localModels.pullModel")}
                </button>
              </div>

              {showPullInput && (
                <div className="mb-3 flex flex-col gap-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={pullName}
                      onChange={(e) => setPullName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handlePull(pullName);
                      }}
                      placeholder={t("localModels.pullPlaceholder")}
                      spellCheck={false}
                      className="min-w-0 flex-1 rounded-md border border-(--border) bg-(--fill-1) px-2.5 py-2 text-[12px] text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-(--border-strong)"
                    />
                    <button
                      type="button"
                      onClick={() => void handlePull(pullName)}
                      disabled={!pullName.trim() || pulling !== null}
                      className="shrink-0 rounded-md bg-(--accent) px-3 py-2 text-[12px] font-semibold text-(--on-accent) transition hover:opacity-90 disabled:opacity-50"
                    >
                      {pulling ? t("localModels.pulling") : t("localModels.pull")}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {POPULAR_MODELS.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setPullName(m)}
                        className="rounded-full border border-(--border) px-2 py-0.5 text-[10px] text-[var(--text-secondary)] transition hover:border-(--border-strong) hover:text-[var(--text-primary)]"
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {models.length === 0 ? (
                <p className="py-4 text-center text-[11.5px] text-[var(--text-faint)]">
                  {t("localModels.noModels")}
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {models.map((model) => (
                    <div
                      key={model.name}
                      className={`group flex items-center gap-2 rounded-lg border px-3 py-2 transition ${
                        selectedModel === model.name
                          ? "border-(--border-strong) bg-(--fill-2)"
                          : "border-(--border) bg-(--fill-1) hover:border-(--border-strong)"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => void handleSelect(model.name)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <span
                          className={`shrink-0 ${
                            selectedModel === model.name ? "text-(--accent)" : "text-[var(--text-muted)]"
                          }`}
                        >
                          {selectedModel === model.name ? (
                            <IoCheckmarkCircle size={15} />
                          ) : (
                            <IoCube size={15} />
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[12px] font-medium text-[var(--text-primary)]">
                            {model.name}
                          </span>
                          <span className="block text-[10px] text-[var(--text-muted)]">
                            {model.details?.parameter_size ?? t("localModels.unknownSize")} ·{" "}
                            {formatModelSize(model.size)}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(model.name)}
                        disabled={deleting === model.name}
                        title={t("localModels.deleteModel", { name: model.name })}
                        className="shrink-0 rounded-md p-1.5 text-[var(--text-muted)] opacity-0 transition hover:bg-red-500/10 hover:text-[var(--danger)] group-hover:opacity-100 disabled:opacity-30"
                      >
                        <IoTrash size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {engine === "llamacpp" && (
            <>
              <section className="rounded-xl border border-(--border) bg-(--fill-1) p-3">
                <div className="mb-2 flex items-center gap-2">
                  <IoHardwareChipOutline className="text-(--accent)" size={15} />
                  <h3 className="m-0 text-[11px] font-semibold">Your machine</h3>
                </div>
                {llamaHardware ? (
                  <div className="grid grid-cols-2 gap-2 text-[10px] text-[var(--text-secondary)]">
                    <span className="truncate" title={llamaHardware.cpuModel}>CPU · {llamaHardware.cpuModel}</span>
                    <span>{llamaHardware.cpuCores} logical cores</span>
                    <span>{formatModelSize(llamaHardware.ramBytes)} RAM</span>
                    <span>{formatModelSize(llamaHardware.freeDiskBytes)} free disk</span>
                  </div>
                ) : (
                  <p className="m-0 text-[10.5px] text-[var(--text-muted)]">Checking hardware…</p>
                )}
                {llamaRuntime && (
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-(--border) pt-3">
                    <div className="text-[10.5px]">
                      <span className={llamaRuntime.installed ? "text-[var(--success)]" : "text-[var(--text-muted)]"}>
                        {llamaRuntime.installed ? `Runtime ${llamaRuntime.build} installed` : "Managed llama.cpp runtime"}
                      </span>
                      {!llamaRuntime.supported && (
                        <p className="mb-0 mt-1 text-[var(--danger)]">No runtime build is available for this platform.</p>
                      )}
                    </div>
                    {!llamaRuntime.installed && llamaRuntime.supported && (
                      <button
                        type="button"
                        onClick={() => void handleInstallRuntime()}
                        disabled={llamaBusy}
                        className="shrink-0 rounded-md bg-(--accent) px-2.5 py-1.5 text-[10.5px] font-semibold text-(--on-accent) disabled:opacity-50"
                      >
                        {llamaBusy ? "Installing…" : "Install runtime"}
                      </button>
                    )}
                    {llamaServer?.running && (
                      <button
                        type="button"
                        onClick={() => void handleStopLlama()}
                        disabled={llamaBusy}
                        className="shrink-0 rounded-md border border-red-500/25 px-2.5 py-1.5 text-[10.5px] text-[var(--danger)] disabled:opacity-50"
                      >
                        <IoStop className="mr-1 inline" />Stop server
                      </button>
                    )}
                  </div>
                )}
                {llamaBusy && !llamaProgress?.id && renderProgress(llamaProgress)}
              </section>

              <section>
                <div className="mb-2.5 flex items-center justify-between">
                  <h3 className="m-0 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                    <IoCube size={13} />Local GGUF models
                    <span className="rounded-sm bg-(--fill-2) px-1.5 py-0.5 text-[9.5px]">{llamaModels.length}</span>
                  </h3>
                  {llamaServer?.running && (
                    <span className="text-[9.5px] text-[var(--success)]">Serving on {llamaServer.url}</span>
                  )}
                </div>
                {llamaModels.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-(--border) px-3 py-4 text-center text-[10.5px] text-[var(--text-muted)]">
                    No GGUF models yet. Search Hugging Face below to find a model that fits your machine.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {llamaModels.map((model) => (
                      <div key={model.id} className="flex items-center gap-2 rounded-lg border border-(--border) bg-(--fill-1) px-3 py-2">
                        <IoCube className="shrink-0 text-[var(--text-muted)]" size={14} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[11px] font-medium" title={model.fileName}>{model.displayName}</div>
                          <div className="text-[9.5px] text-[var(--text-muted)]">
                            {model.quant ?? "GGUF"} · {formatModelSize(model.size)}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleSelectLlama(model.id)}
                          disabled={llamaBusy}
                          className="shrink-0 rounded-md bg-(--accent) px-2.5 py-1.5 text-[10px] font-semibold text-(--on-accent) disabled:opacity-50"
                        >
                          {llamaServer?.modelId === model.id && llamaServer.running ? "Selected" : "Use model"}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (llamaServer?.modelId === model.id && llamaServer.running) {
                              setError("Stop the llama.cpp server before deleting its active model.");
                              return;
                            }
                            try {
                              const deleted = await llama.deleteLocalModel(model.id);
                              if (deleted.id !== model.id) {
                                throw new Error("The model file could not be deleted.");
                              }
                              await refreshLlama();
                            } catch (e) {
                              setError(e instanceof Error ? e.message : "Could not delete the model.");
                            }
                          }}
                          disabled={llamaBusy}
                          aria-label={`Delete ${model.displayName}`}
                          title="Delete model"
                          className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-red-500/10 hover:text-[var(--danger)] disabled:opacity-40"
                        >
                          <IoTrash size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h3 className="mb-2.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                  <IoSearch size={13} />Discover models
                </h3>
                <form
                  className="mb-2 flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleSearch();
                  }}
                >
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search Hugging Face GGUF models…"
                    aria-label="Search Hugging Face GGUF models"
                    className="min-w-0 flex-1 rounded-md border border-(--border) bg-(--fill-1) px-2.5 py-2 text-[11px] outline-none focus:border-(--border-strong)"
                  />
                  <button
                    type="submit"
                    disabled={searching}
                    className="shrink-0 rounded-md bg-(--fill-2) px-3 py-2 text-[10.5px] font-medium disabled:opacity-50"
                  >
                    {searching ? "Searching…" : "Search"}
                  </button>
                </form>
                {searchResults.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {searchResults.map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        onClick={() => void handleOpenRepo(result.id)}
                        className={`rounded-lg border px-3 py-2 text-left transition ${
                          selectedRepo === result.id
                            ? "border-(--border-strong) bg-(--fill-2)"
                            : "border-(--border) bg-(--fill-1) hover:border-(--border-strong)"
                        }`}
                      >
                        <span className="block truncate text-[10.5px] font-medium">{result.id}</span>
                        <span className="mt-0.5 block text-[9px] text-[var(--text-muted)]">
                          {result.architecture ?? result.pipelineTag ?? "GGUF"} · {result.downloads.toLocaleString()} downloads
                          {result.license ? ` · ${result.license}` : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {selectedRepo && repoFiles && (
                  <div className="mt-3 rounded-lg border border-(--border) bg-(--fill-1) p-3">
                    <div className="mb-2 text-[10.5px] font-medium">{selectedRepo} · Choose a quantization</div>
                    <select
                      value={selectedFile?.name ?? ""}
                      onChange={(event) => {
                        const file = repoFiles.files.find((candidate) => candidate.name === event.target.value);
                        if (file) void handleChooseFile(file);
                      }}
                      className="w-full rounded-md border border-(--border) bg-(--bg-panel) px-2 py-2 text-[10px] outline-none"
                    >
                      {repoFiles.files.map((file) => (
                        <option key={file.name} value={file.name}>
                          {file.quant ?? "GGUF"} · {file.name.split("/").at(-1)} · {formatModelSize(file.size)}
                        </option>
                      ))}
                    </select>
                    {fit && selectedFile && (
                      <div className={`mt-2 rounded-md px-2.5 py-2 text-[9.5px] ${
                        fit.status === "ok" ? "bg-emerald-500/10 text-[var(--success)]" :
                        fit.status === "tight" || fit.status === "risky" ? "bg-amber-500/10 text-[var(--warning)]" :
                        fit.status === "impossible" ? "bg-red-500/10 text-[var(--danger)]" :
                        "bg-(--fill-2) text-[var(--text-secondary)]"
                      }`}>
                        <span className="font-semibold">{fit.status.toUpperCase()}</span>
                        {fit.reason && <span> · {fit.reason}</span>}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleDownload()}
                      disabled={!selectedFile || !fit?.canRun || llamaBusy}
                      className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md bg-(--accent) px-3 py-2 text-[10.5px] font-semibold text-(--on-accent) disabled:opacity-45"
                    >
                      <IoCloudDownloadOutline size={13} />
                      {llamaBusy ? "Working…" : "Download model"}
                    </button>
                  </div>
                )}
                {selectedRepo && !repoFiles && <p className="text-[10px] text-[var(--text-muted)]">Loading repository files…</p>}
                {llamaProgress?.id && downloadId && (
                  <div className="mt-2">
                    {renderProgress(llamaProgress)}
                    <button
                      type="button"
                      onClick={() => void handleCancelDownload()}
                      className="mt-1 rounded px-2 py-1 text-[9.5px] text-[var(--danger)] hover:bg-red-500/10"
                    >
                      Cancel download
                    </button>
                  </div>
                )}
              </section>
            </>
          )}

          {/* How it works */}
          {engine === "ollama" && <section>
            <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
              {t("localModels.howItWorks")}
            </h3>
            <p className="m-0 text-[11px] leading-5 text-[var(--text-secondary)]">
              {t("localModels.howItWorksDesc")}
            </p>
          </section>}
        </div>
      </main>
    </div>
  );
}
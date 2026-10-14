import { useCallback, useEffect, useState } from "react";
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
  type LocalModelInfo,
} from "../src/localModels";

interface Props {
  onClose: () => void;
  /** Returns an error message, or null on success (may be async). */
  onSelectModel: (modelName: string) => void | Promise<string | null>;
  selectedModel: string;
}

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

  useEffect(() => {
    // Deferred one microtask so the fetch's setState calls never run
    // synchronously inside the effect body (cascading-render lint rule).
    void Promise.resolve().then(() => refreshStatus());
  }, [refreshStatus]);

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
            "Connected to an existing Ollama server on port 11434 (started outside this app). Stop will stop it."
          );
        } else if (status.adopted) {
          // The server was an orphan left behind by a previous session — we
          // re-adopted it, so Stop works on it again.
          setSuccess(
            "Re-connected to the Ollama server left running by a previous session. Stop works again."
          );
        } else {
          setSuccess("Ollama server started successfully.");
        }
        const modelList = await listLocalModels();
        setModels(modelList);
      } else {
        setError("Failed to start the Ollama server.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start the Ollama server.");
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
        setSuccess("Ollama server stopped.");
      } else if (status?.stillRunningExternal) {
        // Port 11434 is held by something we could not identify as Ollama,
        // so we never touch it.
        setSuccess(
          "Port 11434 is held by another program the app can't identify as Ollama, so it was left running. Close that program to free the port."
        );
      } else {
        setError("No Ollama server is running.");
        setRunning(false);
        setModels([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to stop the Ollama server.");
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
        setError(`Failed to pull model "${modelName}".`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to pull model "${modelName}".`);
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
        setError(`Failed to delete model "${name}".`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to delete model "${name}".`);
    }
    setDeleting(null);
    setTimeout(() => setSuccess(null), 3000);
  };

  const handleSelect = async (name: string) => {
    const err = await onSelectModel(name);
    if (err) {
      setError(
        `Model "${name}" selected, but the Ollama server isn't reachable: ${err}`
      );
    } else {
      setSuccess(`Model "${name}" selected.`);
      setTimeout(() => setSuccess(null), 2000);
    }
  };

  return (
    <div className="flex h-full w-full flex-col bg-[var(--bg-panel)] text-[var(--text-primary)]">
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-(--border) px-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
          Local Models
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Refresh"
            title="Refresh status"
            onClick={() => void refreshStatus()}
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
          >
            <IoRefresh size={14} />
          </button>
          <button
            type="button"
            aria-label="Close"
            title="Close"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
          >
            <IoClose size={15} />
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 px-4 py-4">
          {/* Server Status */}
          <section>
            <h3 className="mb-2.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
              <IoServer size={13} />
              Server Status
            </h3>

            {!installed ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.08] px-3 py-2.5">
                <IoAlertCircle size={15} className="mt-0.5 shrink-0 text-[var(--warning)]" />
                <div className="text-[11.5px] leading-5 text-[var(--warning)]">
                  <p className="m-0 font-medium">Ollama is not installed</p>
                  <p className="m-0 mt-1 text-[11px] text-[var(--text-muted)]">
                    Install Ollama from{" "}
                    <a
                      href="https://ollama.com"
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-[var(--text-primary)]"
                    >
                      ollama.com
                    </a>{" "}
                    to run local AI models on your device.
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
                    {running ? "Server running" : "Server stopped"}
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
                    {starting ? "Starting…" : "Start Server"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleStop}
                    disabled={stopping}
                    className="flex items-center justify-center gap-1.5 rounded-md border border-red-500/25 bg-red-500/[0.08] px-3 py-2 text-[12px] font-semibold text-[var(--danger)] transition hover:bg-red-500/[0.14] disabled:opacity-50"
                  >
                    <IoStop size={13} />
                    {stopping ? "Stopping…" : "Stop Server"}
                  </button>
                )}
              </div>
            )}
          </section>

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
          {running && (
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
                  Pull Model
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
                      placeholder="e.g. llama3.2"
                      spellCheck={false}
                      className="min-w-0 flex-1 rounded-md border border-(--border) bg-(--fill-1) px-2.5 py-2 text-[12px] text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-(--border-strong)"
                    />
                    <button
                      type="button"
                      onClick={() => void handlePull(pullName)}
                      disabled={!pullName.trim() || pulling !== null}
                      className="shrink-0 rounded-md bg-(--accent) px-3 py-2 text-[12px] font-semibold text-(--on-accent) transition hover:opacity-90 disabled:opacity-50"
                    >
                      {pulling ? "Pulling…" : "Pull"}
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
                  No models installed yet. Pull one to get started.
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
                            {model.details?.parameter_size ?? "Unknown size"} ·{" "}
                            {formatModelSize(model.size)}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(model.name)}
                        disabled={deleting === model.name}
                        title={`Delete ${model.name}`}
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

          {/* How it works */}
          <section>
            <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
              How it works
            </h3>
            <p className="m-0 text-[11px] leading-5 text-[var(--text-secondary)]">
              Local models run entirely on your device using{" "}
              <span className="text-[var(--text-primary)]">Ollama</span>. No data leaves your computer.
              Start the server, pull a model, then select it to chat with it. The selected
              model will be used as your AI provider.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
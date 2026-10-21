import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IoDownload,
  IoTrash,
  IoStop,
  IoRefresh,
  IoCube,
  IoCheckmarkCircle,
  IoCloudDownloadOutline,
  IoHardwareChipOutline,
  IoChevronBack,
  IoServer,
  IoDownloadOutline,
  IoInformationCircleOutline,
  IoSearch,
} from "react-icons/io5";
import {
  hardware,
  runtimeStatus,
  searchModels,
  listRepoFiles,
  estimateFit,
  installRuntime,
  downloadModel,
  cancelDownload,
  listLocalModels,
  deleteLocalModel,
  startServer,
  stopServer,
  serverStatus,
  onProgress,
  formatBytes,
  type LlamaCppFit,
  type LlamaCppHardware,
  type LlamaCppLocalModel,
  type LlamaCppProgress,
  type LlamaCppRepoFiles,
  type LlamaCppRuntimeStatus,
  type LlamaCppSearchResult,
  type LlamaCppServerStatus,
} from "../src/llamacpp";
import { useTranslation } from "../src/i18n";

interface Props {
  /** Select a downloaded model and switch the chat over to it. */
  onSelectModel: (model: LlamaCppLocalModel) => void | Promise<string | null>;
  selectedModelId: string | null;
  /** Close the panel (e.g. when the user clicks the Close button). */
  onClose?: () => void;
}

const QUANT_ORDER = [
  "IQ2_XXS",
  "IQ2_XS",
  "Q2_K",
  "IQ3_XS",
  "Q3_K_S",
  "Q3_K_M",
  "Q3_K_L",
  "IQ4_XS",
  "Q4_0",
  "Q4_K_S",
  "Q4_K_M",
  "Q5_0",
  "Q5_K_S",
  "Q5_K_M",
  "Q6_K",
  "Q8_0",
];

function quantRank(quant: string | null): number {
  if (!quant) return -1;
  const i = QUANT_ORDER.indexOf(quant.toUpperCase());
  return i === -1 ? QUANT_ORDER.length : i;
}

type ViewId = "runtime" | "catalog" | "browse" | "files" | "models";

interface LlamaCppFileLike {
  name: string;
  size: number;
  quant: string | null;
  sha256: string | null;
}

/** Curated popular models shown in the catalog view — no search required. */
interface CatalogEntry {
  repoId: string;
  name: string;
  description: string;
  sizeRange: string;
  recommendedQuant: string;
  architecture: string;
  tags: string[];
  downloads: number;
}

const CATALOG_MODELS: CatalogEntry[] = [
  {
    repoId: "TheBloke/Llama-3.2-3B-Instruct-GGUF",
    name: "Llama 3.2 3B Instruct",
    description: "Small, fast model that's great for everyday chat and instruction-following.",
    sizeRange: "1.8–3 GB",
    recommendedQuant: "Q4_K_M",
    architecture: "Llama 3",
    tags: ["chat", "instruct"],
    downloads: 120000,
  },
  {
    repoId: "TheBloke/Llama-3.1-8B-Instruct-GGUF",
    name: "Llama 3.1 8B Instruct",
    description: "Meta's balanced model — a strong all-rounder for chat and coding.",
    sizeRange: "4.5–9 GB",
    recommendedQuant: "Q4_K_M",
    architecture: "Llama 3",
    tags: ["chat", "coding"],
    downloads: 310000,
  },
  {
    repoId: "TheBloke/Llama-3.1-70B-Instruct-GGUF",
    name: "Llama 3.1 70B Instruct",
    description: "Meta's largest Llama 3 model — powerful reasoning, heavy on resources.",
    sizeRange: "32–45 GB",
    recommendedQuant: "Q4_K_M",
    architecture: "Llama 3",
    tags: ["chat", "reasoning", "coding"],
    downloads: 89000,
  },
  {
    repoId: "TheBloke/Mistral-7B-Instruct-v0.2-GGUF",
    name: "Mistral 7B Instruct v0.2",
    description: "Very popular 7B instruction model with good performance for its size.",
    sizeRange: "3.8–8 GB",
    recommendedQuant: "Q4_K_M",
    architecture: "Mistral",
    tags: ["chat", "instruct"],
    downloads: 420000,
  },
  {
    repoId: "TheBloke/Qwen2.5-7B-Instruct-GGUF",
    name: "Qwen 2.5 7B Instruct",
    description: "Alibaba's strong 7B model — excels at Chinese and English reasoning.",
    sizeRange: "4–8 GB",
    recommendedQuant: "Q4_K_M",
    architecture: "Qwen",
    tags: ["chat", "reasoning", "bilingual"],
    downloads: 56000,
  },
  {
    repoId: "TheBloke/Qwen2.5-14B-Instruct-GGUF",
    name: "Qwen 2.5 14B Instruct",
    description: "Alibaba's powerful 14B model — strong reasoning and multilingual support.",
    sizeRange: "7.5–15 GB",
    recommendedQuant: "Q4_K_M",
    architecture: "Qwen",
    tags: ["chat", "reasoning", "bilingual"],
    downloads: 28000,
  },
  {
    repoId: "TheBloke/Phi-3-mini-4k-instruct-GGUF",
    name: "Phi-3 Mini 4K Instruct",
    description: "Tiny 3.8B model from Microsoft — surprisingly capable for its size.",
    sizeRange: "1.9–4 GB",
    recommendedQuant: "Q4_K_M",
    architecture: "Phi-3",
    tags: ["tiny", "chat"],
    downloads: 180000,
  },
  {
    repoId: "TheBloke/gemma-2b-it-GGUF",
    name: "Gemma 2B Instruct",
    description: "Google's lightweight 2B model — fast and efficient on low-RAM machines.",
    sizeRange: "1.2–2.5 GB",
    recommendedQuant: "Q4_K_M",
    architecture: "Gemma",
    tags: ["tiny", "chat"],
    downloads: 95000,
  },
  {
    repoId: "TheBloke/gemma-2-9b-it-GGUF",
    name: "Gemma 2 9B Instruct",
    description: "Google's 9B model — good quality-to-size ratio for chat tasks.",
    sizeRange: "4.8–10 GB",
    recommendedQuant: "Q4_K_M",
    architecture: "Gemma 2",
    tags: ["chat", "instruct"],
    downloads: 72000,
  },
  {
    repoId: "TheBloke/deepseek-v2.5-16b-chat-GGUF",
    name: "DeepSeek V2.5 16B Chat",
    description: "Strong 16B model — good coding and reasoning capabilities.",
    sizeRange: "8–17 GB",
    recommendedQuant: "Q4_K_M",
    architecture: "DeepSeek",
    tags: ["chat", "coding", "reasoning"],
    downloads: 53000,
  },
  {
    repoId: "TheBloke/codellama-7B-GGUF",
    name: "Code Llama 7B",
    description: "Meta's code-specialized model — trained for coding tasks and infill.",
    sizeRange: "3.8–8 GB",
    recommendedQuant: "Q4_K_M",
    architecture: "Code Llama",
    tags: ["coding", "instruct"],
    downloads: 340000,
  },
  {
    repoId: "TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF",
    name: "TinyLlama 1.1B Chat",
    description: "Extremely lightweight 1.1B model — runs on almost anything.",
    sizeRange: "0.6–1.2 GB",
    recommendedQuant: "Q4_K_M",
    architecture: "TinyLlama",
    tags: ["tiny", "chat"],
    downloads: 110000,
  },
];

export default function LlamaCppModels({
  onSelectModel,
  selectedModelId,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [view, setView] = useState<ViewId>("runtime");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<LlamaCppRuntimeStatus | null>(null);
  const [hardwareInfo, setHardware] = useState<LlamaCppHardware | null>(null);
  const [server, setServer] = useState<LlamaCppServerStatus | null>(null);
  const [models, setModels] = useState<LlamaCppLocalModel[]>([]);
  const [searchResults, setSearchResults] = useState<LlamaCppSearchResult[]>([]);
  const [repoFiles, setRepoFiles] = useState<LlamaCppRepoFiles | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<LlamaCppSearchResult | null>(null);
  const [query, setQuery] = useState("");
  const [installing, setInstalling] = useState(false);
  const [searching, setSearching] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [fit, setFit] = useState<LlamaCppFit | null>(null);
  const [fitFile, setFitFile] = useState<string | null>(null);
  const progressRef = useRef<Map<string, LlamaCppProgress>>(new Map());
  const unsubProgressRef = useRef<(() => void) | null>(null);
  const dismissTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearMessages = useCallback(() => {
    setError(null);
    setSuccess(null);
  }, []);

  const toast = useCallback((msg: string, isError: boolean) => {
    clearMessages();
    if (isError) setError(msg); else setSuccess(msg);
  }, [clearMessages]);

  const dismissAfter = useCallback((ms: number) => {
    const id = setTimeout(() => { setError(null); setSuccess(null); }, ms);
    dismissTimers.current.push(id);
    return id;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const unsub = await onProgress((p) => {
        if (cancelled) return;
        progressRef.current.set(p.id ?? "runtime", p);
        if (p.phase === "done" || p.phase === "cancelled") {
          setDownloading(null);
          void refreshAll();
        }
      });
      unsubProgressRef.current = unsub;
    })();
    return () => {
      cancelled = true;
      unsubProgressRef.current?.();
      dismissTimers.current.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => {
    if (runtime?.installed && view === "runtime") {
      setView("catalog");
    }
  }, [runtime, view]);

  const refreshAll = useCallback(async () => {
    const [rt, hw, sv, mods] = await Promise.all([
      runtimeStatus().catch(() => null),
      hardware().catch(() => null),
      serverStatus().catch(() => null),
      listLocalModels().catch(() => []),
    ]);
    if (rt) setRuntime(rt);
    if (hw) setHardware(hw);
    setServer(sv);
    setModels(Array.isArray(mods) ? mods : []);
  }, []);

  const handleInstallRuntime = useCallback(async () => {
    if (!runtime?.supported) {
      toast(
        t("llamacpp.runtimeUnsupported", {
          platform: runtime?.asset?.name ?? "unknown",
        }),
        true,
      );
      return;
    }
    clearMessages();
    setInstalling(true);
    try {
      await installRuntime();
      toast(t("llamacpp.runtimeInstalled"), false);
      dismissAfter(3000);
      await refreshAll();
      setView("catalog");
    } catch (e) {
      toast(
        e instanceof Error ? e.message : t("llamacpp.runtimeInstallFailed"),
        true,
      );
    } finally {
      setInstalling(false);
    }
  }, [runtime, toast, dismissAfter, refreshAll]);

  const handleStartServer = useCallback(async (modelId: string) => {
    clearMessages();
    setStarting(true);
    try {
      const st = await startServer(modelId);
      if (st.running) {
        setServer(st);
        toast(t("llamacpp.serverStarted"), false);
        dismissAfter(3000);
        await refreshAll();
      } else {
        toast(t("llamacpp.serverStartFailed"), true);
      }
    } catch (e) {
      toast(
        e instanceof Error ? e.message : t("llamacpp.serverStartFailed"),
        true,
      );
    } finally {
      setStarting(false);
    }
  }, [toast, dismissAfter, refreshAll]);

  const handleStopServer = useCallback(async () => {
    clearMessages();
    setStopping(true);
    try {
      const st = await stopServer();
      setServer(st);
      if (!st.running) {
        toast(t("llamacpp.serverStopped"), false);
        dismissAfter(3000);
      } else {
        toast(t("llamacpp.serverStopFailed"), true);
      }
      await refreshAll();
    } catch (e) {
      toast(
        e instanceof Error ? e.message : t("llamacpp.serverStopFailed"),
        true,
      );
    } finally {
      setStopping(false);
    }
  }, [toast, dismissAfter, refreshAll]);

  const handleSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    clearMessages();
    try {
      const results = await searchModels(trimmed, 25);
      setSearchResults(results);
    } catch (e) {
      toast(
        e instanceof Error ? e.message : t("llamacpp.searchFailed"),
        true,
      );
    } finally {
      setSearching(false);
    }
  }, [toast]);

  const handleQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  }, []);

  const handleSelectRepo = useCallback(async (repo: LlamaCppSearchResult) => {
    setSelectedRepo(repo);
    clearMessages();
    try {
      const files = await listRepoFiles(repo.id);
      setRepoFiles(files);
      setView("files");
    } catch (e) {
      toast(
        e instanceof Error ? e.message : t("llamacpp.listFilesFailed"),
        true,
      );
    }
  }, [toast]);

  const handleSelectCatalogModel = useCallback(async (entry: CatalogEntry) => {
    setSelectedRepo({
      id: entry.repoId,
      downloads: entry.downloads,
      likes: 0,
      pipelineTag: "text-generation",
      license: null,
      tags: entry.tags,
      totalSize: 0,
      architecture: entry.architecture,
      contextLength: 0,
    } as LlamaCppSearchResult);
    clearMessages();
    try {
      const files = await listRepoFiles(entry.repoId);
      setRepoFiles(files);
      setSelectedRepo({
        id: entry.repoId,
        downloads: entry.downloads,
        likes: 0,
        pipelineTag: "text-generation",
        license: files.license ?? null,
        tags: files.architecture ? [files.architecture] : entry.tags,
        totalSize: files.totalSize,
        architecture: files.architecture ?? entry.architecture,
        contextLength: files.contextLength ?? 0,
      } as LlamaCppSearchResult);
      setView("files");
    } catch (e) {
      toast(
        e instanceof Error ? e.message : t("llamacpp.listFilesFailed"),
        true,
      );
    }
  }, [toast, dismissAfter]);

  const handleDownload = useCallback(async (file: LlamaCppFileLike) => {
    if (!selectedRepo) return;
    clearMessages();
    setDownloading(file.name);
    try {
      await downloadModel({
        repoId: selectedRepo.id,
        fileName: file.name,
        size: file.size,
        sha256: file.sha256 ?? null,
      });
      toast(t("llamacpp.downloadStarted", { name: file.name }), false);
      dismissAfter(2000);
      await refreshAll();
    } catch (e) {
      setDownloading(null);
      toast(
        e instanceof Error ? e.message : t("llamacpp.downloadFailed", {
          name: file.name,
        }),
        true,
      );
    }
  }, [selectedRepo, toast, dismissAfter, refreshAll]);

  const handleCancel = useCallback(async () => {
    const id = downloading;
    if (!id) return;
    try {
      await cancelDownload(id);
      setDownloading(null);
      toast(t("llamacpp.downloadCancelled"), false);
      dismissAfter(2000);
    } catch (e) {
      toast(
        e instanceof Error ? e.message : t("llamacpp.downloadCancelFailed"),
        true,
      );
    }
  }, [downloading, toast, dismissAfter]);

  const handleDeleteModel = useCallback(async (model: LlamaCppLocalModel) => {
    if (!window.confirm(t("llamacpp.confirmDelete", { name: model.fileName })))
      return;
    clearMessages();
    try {
      await deleteLocalModel(model.id);
      toast(t("llamacpp.modelDeleted", { name: model.fileName }), false);
      dismissAfter(2000);
      await refreshAll();
    } catch (e) {
      toast(
        e instanceof Error ? e.message : t("llamacpp.deleteFailed", {
          name: model.fileName,
        }),
        true,
      );
    }
  }, [toast, dismissAfter, refreshAll]);

  const handleSelectInstalled = useCallback(
    async (model: LlamaCppLocalModel) => {
      clearMessages();
      const err = await onSelectModel(model);
      if (err) {
        toast(
          `Model "${model.fileName}" selected, but not reachable: ${err}`,
          true,
        );
      } else {
        toast(t("llamacpp.modelSelected", { name: model.fileName }), false);
        dismissAfter(2000);
      }
    },
    [onSelectModel, toast, dismissAfter],
  );

  const handleEstimateFit = useCallback(async (file: LlamaCppFileLike) => {
    if (!hardwareInfo) return;
    setFitFile(file.name);
    try {
      const f = await estimateFit(file.size);
      setFit(f);
    } catch {
      setFit(null);
    }
  }, [hardwareInfo]);

  const runtimeInstalled = runtime?.installed ?? false;
  const serverRunning = server?.running ?? false;
  const isSelected = (m: LlamaCppLocalModel) => m.id === selectedModelId;
  const progressFor = (fileName: string) => progressRef.current.get(fileName);
  const isDownloading = (fileName: string) => downloading === fileName;

  const filesSorted = useMemo(() => {
    const files = repoFiles?.files ?? [];
    return [...files].sort((a, b) => {
      const ra = quantRank(a.quant);
      const rb = quantRank(b.quant);
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    });
  }, [repoFiles]);

  const canInstall = runtime?.supported ?? false;

  const downloadedFileNames = new Set(models.map((m) => m.fileName));

  const renderCatalogView = () => (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] leading-5 text-[var(--text-muted)]">
          {t("llamacpp.catalogDesc")}
        </p>
        <button
          type="button"
          onClick={() => setView("browse")}
          className="flex items-center gap-1 rounded-md border border-(--border) bg-(--fill-1) px-2.5 py-1.5 text-[11px] text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
        >
          <IoSearch size={12} /> {t("llamacpp.browseModels")}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {CATALOG_MODELS.map((entry) => {
          const isInstalled = downloadedFileNames.has(
            entry.repoId.split("/").pop() ?? "",
          );
          return (
            <div
              key={entry.repoId}
              className="group flex flex-col gap-2.5 rounded-lg border border-(--border) bg-(--fill-1) p-3.5 transition hover:border-(--border-strong) hover:bg-(--fill-2)"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex shrink-0 items-center justify-center">
                  <IoCube size={22} className="text-[var(--text-muted)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="text-[12px] font-medium text-[var(--text-primary)]">
                    {entry.name}
                  </h4>
                  <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-[var(--text-muted)]">
                    {entry.description}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-1 text-[9.5px]">
                <span className="rounded-full border border-(--border) px-1.5 py-0 text-[var(--text-secondary)]">
                  {entry.architecture}
                </span>
                {entry.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-(--border) px-1.5 py-0 text-[var(--text-secondary)]"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <div className="flex items-center justify-between text-[10.5px] text-[var(--text-muted)]">
                <span>
                  {t("llamacpp.catalogSize")}: {entry.sizeRange}
                </span>
                <span>
                  {entry.downloads.toLocaleString()} {t("llamacpp.downloads")}
                </span>
              </div>

              {isInstalled && (
                <span className="text-[10px] text-[var(--success)]">
                  {t("llamacpp.catalogInstalled")}
                </span>
              )}

              <button
                type="button"
                disabled={serverRunning || isInstalled}
                onClick={() => void handleSelectCatalogModel(entry)}
                className={
                  serverRunning
                    ? "flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] cursor-not-allowed"
                    : isInstalled
                      ? "flex items-center justify-center gap-1.5 rounded-md border border-(--border) px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] cursor-not-allowed"
                      : "flex items-center justify-center gap-1.5 rounded-md bg-(--accent) px-2.5 py-1.5 text-[11px] font-semibold text-(--on-accent) transition hover:opacity-90"
                }
              >
                {isInstalled ? (
                  <IoCheckmarkCircle size={12} />
                ) : (
                  <IoDownloadOutline size={12} />
                )}
                {isInstalled ? t("llamacpp.catalogInstalled") : t("llamacpp.download")}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );

  const backButton = () => (
    <button
      type="button"
      onClick={() => {
        setView("catalog");
        setSelectedRepo(null);
        setRepoFiles(null);
        setFit(null);
        setFitFile(null);
      }}
      className="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
    >
      <IoChevronBack size={13} /> {t("llamacpp.back")}
    </button>
  );

  const messageBox = () => {
    if (error) {
      return (
        <div className="rounded-lg border border-red-500/20 bg-red-500/[0.08] px-3 py-2.5 text-[11.5px] leading-5 text-[var(--danger)]">
          {error}
        </div>
      );
    }
    if (success) {
      return (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.08] px-3 py-2.5 text-[11.5px] leading-5 text-[var(--success)]">
          {success}
        </div>
      );
    }
    return null;
  };

  const renderRuntimeView = () => {
    const notSupported = runtime && !runtime.supported && !runtime.installed;
    return (
      <section className="flex flex-col gap-4">
        <div className="rounded-lg border border-(--border) bg-(--fill-1) p-4">
          <div className="mb-2 flex items-center gap-2">
            <IoHardwareChipOutline size={15} className="text-[var(--text-muted)]" />
            <span className="text-[12px] font-medium text-[var(--text-primary)]">
              {t("llamacpp.runtimeTitle")}
            </span>
          </div>
          <p className="mb-3 text-[11px] leading-5 text-[var(--text-muted)]">
            {t("llamacpp.runtimeDesc")}
          </p>
          {notSupported && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.08] px-3 py-2.5 text-[11.5px] leading-5 text-[var(--warning)]">
              {t("llamacpp.runtimeUnsupportedNoBuild", {
                platform: runtime?.asset?.name ?? "this platform",
              })}
            </div>
          )}
          {!runtimeInstalled && canInstall && (
            <button
              type="button"
              onClick={handleInstallRuntime}
              disabled={installing}
              className="flex items-center justify-center gap-1.5 rounded-md bg-(--accent) px-3 py-2 text-[12px] font-semibold text-(--on-accent) transition hover:opacity-90 disabled:opacity-50"
            >
              {installing ? (
                <>
                  <IoDownloadOutline size={13} className="animate-spin" />
                  {t("llamacpp.installing")}
                </>
              ) : (
                <>
                  <IoCloudDownloadOutline size={13} />
                  {t("llamacpp.installRuntime")}
                </>
              )}
            </button>
          )}
          {runtimeInstalled && (
            <p className="text-[11px] text-[var(--text-muted)]">
              {t("llamacpp.runtimeAlreadyInstalled", { build: runtime?.build ?? "unknown" })}
            </p>
          )}
          {runtime && runtime.asset && !runtimeInstalled && !canInstall && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.08] px-3 py-2.5 text-[11.5px] leading-5 text-[var(--warning)]">
              {t("llamacpp.runtimeNoBuild", { name: runtime.asset.name })}
            </div>
          )}
        {hardwareInfo && (
          <div className="rounded-lg border border-(--border) bg-(--fill-1) p-4">
            <div className="mb-2 flex items-center gap-2">
              <IoInformationCircleOutline size={15} className="text-[var(--text-muted)]" />
              <span className="text-[12px] font-medium text-[var(--text-primary)]">
                {t("llamacpp.hardwareTitle")}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-1 text-[10.5px] leading-4 text-[var(--text-muted)]">
              <div>
                <dt className="font-medium">{t("llamacpp.hwPlatform")}</dt>
                <dd>{hardwareInfo.platform}</dd>
              </div>
              <div>
                <dt className="font-medium">{t("llamacpp.hwArch")}</dt>
                <dd>{hardwareInfo.arch}</dd>
              </div>
              <div>
                <dt className="font-medium">{t("llamacpp.hwRAM")}</dt>
                <dd>{formatBytes(hardwareInfo.ramBytes)}</dd>
              </div>
              <div>
                <dt className="font-medium">{t("llamacpp.hwFreeDisk")}</dt>
                <dd>{formatBytes(hardwareInfo.freeDiskBytes)}</dd>
              </div>
            </dl>
          </div>
        )}
        </div>
      </section>
    );
  };

  const renderBrowseView = () => (
    <section className="flex flex-col gap-4">
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={handleQueryChange}
          onKeyDown={(e) => e.key === "Enter" && void handleSearch(query)}
          placeholder={t("llamacpp.searchPlaceholder")}
          spellCheck={false}
          className="min-w-0 flex-1 rounded-md border border-(--border) bg-(--fill-1) px-2.5 py-2 text-[12px] text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-(--border-strong)"
        />
        <button
          type="button"
          onClick={() => void handleSearch(query)}
          disabled={searching || !query.trim()}
          className="shrink-0 rounded-md bg-(--accent) px-3 py-2 text-[12px] font-semibold text-(--on-accent) transition hover:opacity-90 disabled:opacity-50"
        >
          {searching ? t("llamacpp.searching") : t("llamacpp.search")}
        </button>
      </div>
      {searchResults.length === 0 && !searching && query.trim() && (
        <p className="py-4 text-center text-[11.5px] text-[var(--text-faint)]">
          {t("llamacpp.noResults")}
        </p>
      )}
      <div className="flex flex-col gap-2">
        {searchResults.map((repo) => (
          <div
            key={repo.id}
            className="group flex items-center gap-3 rounded-lg border px-3 py-2.5 transition cursor-pointer hover:border-(--border-strong) hover:bg-(--fill-2)"
          >
            <div className="shrink-0">
              <IoCube size={15} className="text-[var(--text-muted)]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="block truncate text-[12px] font-medium text-[var(--text-primary)]">
                  {repo.id}
                </span>
                {repo.architecture && (
                  <span className="rounded-full border border-(--border) px-1.5 py-0 text-[9px] text-[var(--text-secondary)]">
                    {repo.architecture}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                <span>{formatBytes(repo.totalSize)}</span>
                <span>·</span>
                <span>{repo.downloads.toLocaleString()} {t("llamacpp.downloads")}</span>
                {repo.likes > 0 && (
                  <>
                    <span>·</span>
                    <span>{repo.likes.toLocaleString()} {t("llamacpp.likes")}</span>
                  </>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleSelectRepo(repo)}
              className="shrink-0 rounded-md p-1.5 text-[var(--text-muted)] opacity-0 transition group-hover:opacity-100"
              title={t("llamacpp.viewFiles")}
            >
              <IoChevronBack size={13} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );

  const renderFilesView = () => {
    if (!selectedRepo) return null;
    const hasLicense = selectedRepo.license;
    return (
      <section className="flex flex-col gap-4">
        {backButton()}
        <div className="rounded-lg border border-(--border) bg-(--fill-1) p-4">
          <div className="mb-2 flex items-center gap-2">
            <IoCloudDownloadOutline size={15} className="text-[var(--text-muted)]" />
            <span className="text-[12px] font-medium text-[var(--text-primary)]">
              {selectedRepo?.id}
            </span>
          </div>
          <p className="mb-3 text-[11px] leading-5 text-[var(--text-muted)]">
            {t("llamacpp.repoDesc", {
              size: formatBytes(selectedRepo.totalSize),
              arch: selectedRepo.architecture ?? "—",
            })}
          </p>
          {hasLicense && (
            <p className="mb-3 text-[10.5px] leading-4 text-[var(--text-secondary)] italic">
              {t("llamacpp.license", { license: selectedRepo?.license ?? "—" })}
            </p>
          )}
          <p className="mb-3 text-[10.5px] leading-4 text-[var(--text-muted)]">
            {t("llamacpp.pickQuant")}
          </p>
        </div>
        {filesSorted.length === 0 && (
          <p className="py-4 text-center text-[11.5px] text-[var(--text-faint)]">
            {t("llamacpp.noGGUF")}
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          {filesSorted.map((file) => {
            const prog = progressFor(file.name);
            const isDl = isDownloading(file.name);
            const fitting = fitFile === file.name;
            return (
              <div
                key={file.name}
                className="group flex items-center gap-2 rounded-lg border px-3 py-2.5 transition border-(--border) bg-(--fill-1) hover:border-(--border-strong)"
              >
                <div className="shrink-0">
                  <IoHardwareChipOutline size={14} className="text-[var(--text-muted)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1">
                    <span className="block truncate text-[12px] font-medium text-[var(--text-primary)]">
                      {file.name}
                    </span>
                    {file.quant && (
                      <span
                        className={`rounded-full border px-1.5 py-0 text-[9.5px] ${
                          quantRank(file.quant) <= QUANT_ORDER.indexOf("Q4_K_M")
                            ? "border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-500"
                            : "border-(--border) text-[var(--text-secondary)]"
                        }`}
                      >
                        {file.quant}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)]">
                    {formatBytes(file.size)} ·{" "}
                    {fitting ? (
                      <span className="animate-pulse">{t("llamacpp.estimating")}</span>
                    ) : fit && fitFile === file.name ? (
                      <span className={fit.canRun ? "text-[var(--success)]" : "text-[var(--warning)]"}>
                        {fit.status === "ok"
                          ? t("llamacpp.fitOK")
                          : fit.status === "tight"
                            ? t("llamacpp.fitTight")
                            : fit.status === "risky"
                              ? t("llamacpp.fitRisky")
                              : t("llamacpp.fitImpossible")}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleEstimateFit(file)}
                        className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      >
                        {t("llamacpp.estimateFit")}
                      </button>
                    )}
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-1.5">
                  {isDl ? (
                    <div className="w-20 shrink-0">
                      <div className="flex items-center gap-1.5 text-[10px]">
                        <span className="text-[var(--text-muted)]">
                          {prog ? Math.round(prog.percent) : 0}%
                        </span>
                        <button
                          type="button"
                          onClick={handleCancel}
                          className="shrink-0 rounded p-1 text-[var(--text-muted)] hover:text-red-500"
                          title={t("llamacpp.cancel")}
                        >
                          <IoStop size={12} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={serverRunning}
                      onClick={() => void handleDownload(file)}
                      className={
                        serverRunning
                          ? "shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] cursor-not-allowed"
                          : "shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium bg-(--accent) text-(--on-accent) hover:opacity-90"
                      }
                    >
                      {t("llamacpp.download")}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    );
  };

  const renderModelsView = () => (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IoServer size={15} className="text-[var(--text-muted)]" />
          <span className="text-[12px] font-medium text-[var(--text-primary)]">
            {t("llamacpp.serverTitle")}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void refreshAll()}
          className="shrink-0 rounded-md p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          title={t("llamacpp.refresh")}
        >
          <IoRefresh size={13} />
        </button>
      </div>
      <div className="rounded-lg border border-(--border) bg-(--fill-1) p-4">
        <div className="flex items-center gap-2 mb-3">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              serverRunning ? "bg-emerald-500" : "bg-zinc-600"
            }`}
          />
          <span className="text-[12px] font-medium">
            {serverRunning ? t("llamacpp.serverRunning") : t("llamacpp.serverStopped")}
          </span>
          {server?.url && (
            <span className="ml-2 text-[10.5px] text-[var(--text-muted)]">
              {server.url}
            </span>
          )}
        </div>
        {!runtimeInstalled ? (
          <p className="text-[11px] text-[var(--text-muted)]">
            {t("llamacpp.runtimeRequired")}
          </p>
        ) : !serverRunning ? (
          <button
            type="button"
            disabled={starting || models.length === 0}
            onClick={() => {
              if (models.length === 0) return;
              void handleStartServer(models[0].id);
            }}
            className="flex items-center justify-center gap-1.5 rounded-md bg-(--accent) px-3 py-2 text-[12px] font-semibold text-(--on-accent) transition hover:opacity-90 disabled:opacity-50"
          >
            {starting ? t("llamacpp.starting") : t("llamacpp.startServer")}
          </button>
        ) : (
          <button
            type="button"
            disabled={stopping}
            onClick={handleStopServer}
            className="flex items-center justify-center gap-1.5 rounded-md border border-red-500/25 bg-red-500/[0.08] px-3 py-2 text-[12px] font-semibold text-[var(--danger)] transition hover:bg-red-500/[0.14] disabled:opacity-50"
          >
            {stopping ? t("llamacpp.stopping") : t("llamacpp.stopServer")}
          </button>
        )}
      </div>
      <div className="flex items-center justify-between">
        <h3 className="m-0 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
          <IoCube size={13} />
          {t("llamacpp.installedModels")}
          <span className="rounded-sm bg-(--fill-2) px-1.5 py-0.5 text-[9.5px] text-[var(--text-secondary)]">
            {models.length}
          </span>
        </h3>
        {models.length === 0 && (
          <button
            type="button"
            onClick={() => setView("catalog")}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
          >
            <IoDownload size={12} /> {t("llamacpp.addModel")}
          </button>
        )}
      </div>
      {models.length === 0 && serverRunning && (
        <p className="py-4 text-center text-[11.5px] text-[var(--text-faint)]">
          {t("llamacpp.noModelsInstalled")}
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        {models.map((model) => (
          <div
            key={model.id}
            className={`group flex items-center gap-2 rounded-lg border px-3 py-2 transition ${
              isSelected(model)
                ? "border-(--border-strong) bg-(--fill-2)"
                : "border-(--border) bg-(--fill-1) hover:border-(--border-strong)"
            }`}
          >
            <button
              type="button"
              onClick={() => void handleSelectInstalled(model)}
              disabled={!serverRunning}
              className={`flex min-w-0 flex-1 items-center gap-2 text-left ${
                !serverRunning ? "opacity-60" : ""
              }`}
            >
              <span
                className={`shrink-0 ${
                  isSelected(model) ? "text-(--accent)" : "text-[var(--text-muted)]"
                }`}
              >
                {isSelected(model) ? (
                  <IoCheckmarkCircle size={15} />
                ) : (
                  <IoCube size={15} />
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-medium text-[var(--text-primary)]">
                  {model.fileName}
                </span>
                <div className="block text-[10px] text-[var(--text-muted)]">
                  {model.quant ? `${model.quant} · ` : ""}
                  {formatBytes(model.size)}
                  {serverRunning && server?.modelId === model.id ? ` · ${t("llamacpp.serving")}` : ""}
                </div>
              </span>
            </button>
            <button
              type="button"
              onClick={() => void handleDeleteModel(model)}
              disabled={isSelected(model)}
              title={t("llamacpp.deleteModel", { name: model.fileName })}
              className="shrink-0 rounded-md p-1.5 text-[var(--text-muted)] opacity-0 transition group-hover:opacity-100 disabled:opacity-30"
            >
              <IoTrash size={13} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );

  const headerTitle = useMemo(() => {
    switch (view) {
      case "catalog": return t("llamacpp.catalogTitle");
      case "runtime": return t("llamacpp.runtimeTitle");
      case "browse": return t("llamacpp.browseTitle");
      case "files": return selectedRepo?.id ?? t("llamacpp.filesTitle");
      case "models": return t("llamacpp.modelsTitle");
      default: return t("llamacpp.title");
    }
  }, [view, selectedRepo, t]);

  const showBack = view === "files";

  return (
    <div className="flex h-full w-full flex-col bg-[var(--bg-panel)] text-[var(--text-primary)]">
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-(--border) px-3">
        <div className="flex items-center gap-2">
          {showBack && backButton()}
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
            {headerTitle}
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setSuccess(null);
            onClose?.();
          }}
          className="rounded-md px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
        >
          {t("localModels.close")}
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 px-4 py-4">
          {messageBox()}

          <section className="rounded-lg border border-(--border) bg-(--fill-1) p-3">
            <div className="flex items-center gap-2 mb-1">
              <IoHardwareChipOutline size={13} className="text-[var(--text-muted)]" />
              <span className="text-[10.5px] font-medium text-[var(--text-muted)] uppercase tracking-[0.1em]">
                {t("llamacpp.runtimeStatus")}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {!runtime ? (
                <span className="text-[11px] text-[var(--text-muted)]">{t("llamacpp.checking")}</span>
              ) : runtimeInstalled ? (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  <span className="text-[11.5px] text-[var(--text-secondary)]">
                    {t("llamacpp.runtimeInstalledShort", { build: runtime.build })}
                  </span>
                </>
              ) : canInstall ? (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  <span className="text-[11.5px] text-[var(--text-secondary)]">
                    {t("llamacpp.runtimeNotInstalled")}
                  </span>
                </>
              ) : (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  <span className="text-[11.5px] text-[var(--text-secondary)]">
                    {t("llamacpp.runtimeUnsupportedShort")}
                  </span>
                </>
              )}
              {installing && (
                <span className="text-[10px] text-[var(--text-muted)] animate-pulse">
                  {t("llamacpp.installingShort")}
                </span>
              )}
            </div>
          </section>

          {view === "runtime" && renderRuntimeView()}
          {view === "catalog" && renderCatalogView()}
          {view === "browse" && renderBrowseView()}
          {view === "files" && renderFilesView()}
          {view === "models" && renderModelsView()}

          <section>
            <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
              {t("llamacpp.howItWorks")}
            </h3>
            <p className="m-0 text-[11px] leading-5 text-[var(--text-secondary)]">
              {t("llamacpp.howItWorksDesc")}
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}

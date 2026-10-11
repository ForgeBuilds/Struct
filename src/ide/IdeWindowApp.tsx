/*
 * Author: madhusudhan
 * Check the LICENSE in the GitHub repo (https://github.com/Lumorix-studios/Struct) for more information on permissions to use this code.
 */
//might be obvious what this file functions as lol
//Main ide window interface 

import { lazy, useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import {IoAlertCircle, IoChatboxEllipsesOutline, IoCodeSlash, IoExtensionPuzzleOutline, IoFolderOpenOutline, IoGitBranch, IoSearch, IoSettingsOutline, IoTerminal,  } from "react-icons/io5";
import WindowControls from "../../components/WindowControls";
import IdeMenuBar from "../components/IdeMenuBar";
import { clearAllHistories } from "../components/editorHistory";
import FileExplorer from "../components/FileExplorer";
import type { SectionId } from "../components/SettingsPanel";
import type { AISettings } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import { loadSettings, saveSettings } from "../store";
import {
  AUTH_CHANGED_EVENT,
  getCurrentUser,
  getProfile,
  onAuthChanged,
  type NeoUser,
  type Profile as AccountProfile,
} from "../lib/auth";
import * as byok from "../lib/byok";
import {
  applyUiSettings,
  DEFAULT_UI_SETTINGS,
  loadUiSettings,
  saveUiSettings,
  type UiSettings,
} from "../uiSettings";
import CodeEditor, { type EditorTab } from "../components/CodeEditor";
import BottomPanel, { type PanelTab } from "../components/BottomPanel";
import GitPanel from "../components/GitPanel";
import AgentPanel from "./AgentPanel";
import CommandPalette from "../../components/CommandPalette";
import { ensureOllamaReady } from "../localModels";
import { getActiveLanguage, setActiveLanguage, translate, useTranslation } from "../i18n";
import { clearDiagnostics, normalizePath, publishDiagnostics, quickScan } from "../diagnostics";
import { langOf } from "../components/highlight";
import {
  lspDocChange,
  lspDocClose,
  lspDocOpen,
  lspDocSave,
  lspManages,
  lspSetWorkspace,
} from "../lsp";

const SettingsPanel = lazy(() => import("../components/SettingsPanel"));

/** Icon button for the VS Code-style activity bar rail (same look as chat). */
function RailButton({
  active,
  title,
  titleKey,
  onClick,
  children,
}: {
  active?: boolean;
  title: string;
  titleKey?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const accessibleTitle = titleKey ? t(titleKey) : title;
  return (
    <button
      type="button"
      onClick={onClick}
      title={accessibleTitle}
      aria-label={accessibleTitle}
      className={`relative flex h-[48px] w-full items-center justify-center transition-colors ${
        active ? "text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
      }`}
    >
      {active && (
        <span className="absolute left-0 top-0 h-full w-[2px] bg-(--accent)" />
      )}
      {children}
    </button>
  );
}

function IdeStatusBar({
  agentBusy,
  onToggleAgent,
  workspaceRoot,
  gitBranch,
  activeEditorPath,
  activeDirty,
  cursorPos,
  tabSize,
  wordWrap,
}: {
  agentBusy: boolean;
  onToggleAgent: () => void;
  workspaceRoot: string | null;
  gitBranch: string | null;
  activeEditorPath: string | null;
  activeDirty: boolean;
  cursorPos: { line: number; col: number; sel: number };
  tabSize: number;
  wordWrap: boolean;
}) {
  const { t } = useTranslation();

  return (
    <footer className="flex h-[22px] shrink-0 items-center justify-between border-t border-(--border) bg-[var(--bg-chrome)] px-2 text-[11px] text-[var(--text-secondary)]">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onToggleAgent}
          title={t("ide.toggleAgent")}
          className="flex shrink-0 items-center gap-1.5 rounded px-1 transition-colors hover:text-[var(--text-primary)]"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${agentBusy ? "bg-(--accent) animate-pulse" : "bg-zinc-500"}`} />
          {t("ide.agent")}
        </button>
        {workspaceRoot && (
          <span className="min-w-0 truncate" title={workspaceRoot}>
            {workspaceRoot.split(/[\\/]/).filter(Boolean).pop()}
          </span>
        )}
        {gitBranch && (
          <span className="flex shrink-0 items-center gap-1" title={t("status.currentBranch")}>
            <IoGitBranch size={12} />
            {gitBranch}
          </span>
        )}
        {activeEditorPath && (
          <span
            className="flex shrink-0 items-center gap-1.5"
            title={activeDirty ? t("status.unsavedChanges") : t("status.noUnsaved")}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${activeDirty ? "bg-amber-400" : "bg-(--fill-3)"}`} />
            {activeDirty ? t("ide.unsaved") : t("ide.saved")}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {activeEditorPath && (
          <span className="tabular-nums">
            {t("ide.ln")} {cursorPos.line}, {t("ide.col")} {cursorPos.col}
            {cursorPos.sel > 0 && (
              <span className="ml-2">({cursorPos.sel} {t("ide.selected")})</span>
            )}
          </span>
        )}
        <span>{t("ide.spaces")}: {tabSize}</span>
        <span>{wordWrap ? t("ide.wrap") : t("ide.noWrap")}</span>
        <span>{t("ide.utf8")}</span>
        <span>{t("ide.lf")}</span>
        {activeEditorPath && <span>{langLabel(activeEditorPath)}</span>}
      </div>
    </footer>
  );
}

/* --- persisted workspace / recents --------------------------------------- */

const WS_KEY = "neo.ide.workspaceRoot";
const RECENTS_KEY = "neo.ide.recentFiles";

const loadRoot = (): string | null => localStorage.getItem(WS_KEY);
const loadRecents = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
};

/* Language-mode label for the status bar (VS Code shows the active language). */
const LANG_LABELS: Array<[RegExp, string]> = [
  [/\.(ts|tsx)$/i, "TypeScript"],
  [/\.(js|jsx|mjs|cjs)$/i, "JavaScript"],
  [/\.json$/i, "JSON"],
  [/\.css$/i, "CSS"],
  [/\.(html?|htm)$/i, "HTML"],
  [/\.(md|markdown)$/i, "Markdown"],
  [/\.rs$/i, "Rust"],
  [/\.py$/i, "Python"],
  [/\.go$/i, "Go"],
  [/\.java$/i, "Java"],
  [/\.(c|h)$/i, "C"],
  [/\.(cpp|hpp|cc)$/i, "C++"],
  [/\.(cs)$/i, "C#"],
  [/\.(yml|yaml)$/i, "YAML"],
  [/\.toml$/i, "TOML"],
  [/\.sh(\.bats)?$/i, "Shell Script"],
  [/\.sql$/i, "SQL"],
];

function langLabel(path: string): string {
  for (const [re, label] of LANG_LABELS) if (re.test(path)) return label;
  return "Plain Text";
}

/** Keep diagnostics in sync while typing: forward the edit to the file's
 *  language server when one manages it, otherwise run the instant structural
 *  scan — so even a language with no server installed gets line-accurate
 *  bracket/string/comment errors as you type. */
function syncDiagnostics(path: string, content: string): void {
  lspDocChange(path, content);
  if (lspManages(path)) {
    publishDiagnostics(path, [], "neo"); // server findings supersede the scan
  } else {
    publishDiagnostics(path, quickScan(content, langOf(path)), "neo");
  }
}

export default function IdeWindowApp() {
  const appWindow = getCurrentWindow();

  // --- workspace -----------------------------------------------------------
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(loadRoot);
  // Language servers follow the workspace: switching folders stops every
  // server (and clears their findings); stale structural findings go too.
  useEffect(() => {
    lspSetWorkspace(workspaceRoot);
    clearDiagnostics("neo");
  }, [workspaceRoot]);
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const [explorerCollapsed, setExplorerCollapsed] = useState(false);
  const [gitOpen, setGitOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- AI agent panel (docked right, Cursor-style) 
  const AGENT_OPEN_KEY = "neo.ide.agentOpen";
  const [agentOpen, setAgentOpen] = useState(
    () => localStorage.getItem(AGENT_OPEN_KEY) !== "1"
  );
  const [agentBusy, setAgentBusy] = useState(false);
  const AGENT_WIDTH_KEY = "neo.ide.agentWidth";
  const [agentWidth, setAgentWidth] = useState(() => {
    const stored = Number(localStorage.getItem(AGENT_WIDTH_KEY));
    return Number.isFinite(stored) && stored >= 300 && stored <= 720 ? stored : 400;
  });
  const agentDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const onAgentResizeStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    agentDragRef.current = { startX: e.clientX, startWidth: agentWidth };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onAgentResizeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = agentDragRef.current;
    if (!drag) return;
    // Panel sits on the right — dragging left widens it.
    setAgentWidth(Math.min(720, Math.max(300, drag.startWidth - (e.clientX - drag.startX))));
  };
  const onAgentResizeEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    agentDragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
  };
  useEffect(() => {
    localStorage.setItem(AGENT_OPEN_KEY, agentOpen ? "1" : "0");
  }, [agentOpen]);
  useEffect(() => {
    localStorage.setItem(AGENT_WIDTH_KEY, String(agentWidth));
  }, [agentWidth]);

  // --- command palette 
  const [paletteOpen, setPaletteOpen] = useState(false);
  // --- editor tabs 
  const [editorTabs, setEditorTabs] = useState<EditorTab[]>([]);
  const [activeEditorPath, setActiveEditorPath] = useState<string | null>(null);
  const [revealLine, setRevealLine] = useState<{ path: string; line: number } | null>(null);
  const [recentFiles, setRecentFiles] = useState<string[]>(loadRecents);
  const [uiSettings, setUiSettings] = useState<UiSettings>(DEFAULT_UI_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SectionId | null>(null);
  const [aiSettings, setAiSettings] = useState<AISettings>(DEFAULT_SETTINGS);
  const [account, setAccount] = useState<NeoUser | null>(null);
  const [accountProfile, setAccountProfile] = useState<AccountProfile | null>(null);
  const [accountLoading, setAccountLoading] = useState(true);
  const signedIn = !!account;
  const uiSettingsLoadedRef = useRef(false);
  // Load persisted UI + AI settings once on mount (shared with the chat window).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [ui, ai] = await Promise.all([loadUiSettings(), loadSettings()]);
      if (cancelled) return;
      setUiSettings(ui);
      setActiveLanguage(ui.language);
      setAiSettings(ai);
      uiSettingsLoadedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Apply theme/accent CSS variables whenever UI settings change.
  useEffect(() => {
    applyUiSettings(uiSettings);
  }, [uiSettings]);

  // Persist UI settings (debounced, only after the initial load).
  useEffect(() => {
    if (!uiSettingsLoadedRef.current) return;
    const t = setTimeout(
      () => void saveUiSettings({ ...uiSettings, language: getActiveLanguage() }),
      250
    );
    return () => clearTimeout(t);
  }, [uiSettings]);

  /** Merge a patch into UI settings (Settings panel writes here). */
  const updateUiSettings = (patch: Partial<UiSettings>) => {
    if (patch.language !== undefined && Object.keys(patch).length === 1) {
      setActiveLanguage(patch.language);
      void saveUiSettings({ ...uiSettings, language: patch.language });
      return;
    }
    setUiSettings((prev) => ({ ...prev, ...patch, language: getActiveLanguage() }));
  };

  const handleAiChange = (next: AISettings) => {
    setAiSettings(next);
    void saveSettings(next);
  };

  const refreshAccount = useCallback(async () => {
    setAccountLoading(true);
    try {
      const user = await getCurrentUser();
      setAccount(user);
      if (!user) {
        setAccountProfile(null);
        byok.clearMemoryKeys();
        return;
      }
      setAccountProfile(await getProfile());
    } finally {
      setAccountLoading(false);
    }
  }, []);

  useEffect(() => {
    // Defer the initial refresh off the effect body (no setState-in-effect).
    const boot = window.setTimeout(() => void refreshAccount(), 0);
    const offAuth = onAuthChanged((user) => {
      setAccount(user);
      if (!user) {
        setAccountProfile(null);
        byok.clearMemoryKeys();
        return;
      }
      void refreshAccount();
    });
    const unlistenAuthBroadcast = listen(AUTH_CHANGED_EVENT, () => {
      void refreshAccount();
    });
    return () => {
      window.clearTimeout(boot);
      offAuth();
      void unlistenAuthBroadcast.then((off) => off());
    };
  }, [refreshAccount]);

  useEffect(() => {
    let cancelled = false;
    void byok
      .resolveApiKey(aiSettings.provider, signedIn, accountProfile?.byokEnabled ?? false)
      .then((key) => {
        if (cancelled) return;
        setAiSettings((prev) =>
          prev.provider === aiSettings.provider && prev.apiKey !== key
            ? { ...prev, apiKey: key }
            : prev
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [aiSettings.provider, signedIn, accountProfile?.byokEnabled]);

  const handleSelectLocalModel = async (modelName: string): Promise<string | null> => {
    // Make sure an Ollama server is actually up before switching to it. This
    // reuses the app's own server or an external one already on port 11434,
    // or starts a fresh one — instead of silently pointing chat at a server
    // that may have died (the old overlap bug).
    const serverErr = await ensureOllamaReady();

    // Switch to the Ollama provider and set the selected local model.
    const next: AISettings = {
      ...aiSettings,
      provider: "ollama",
      model: modelName,
      baseUrl: "http://127.0.0.1:11434",
      apiKey: "",
    };
    setAiSettings(next);
    void saveSettings(next);

    return serverErr;
  };

  // --- bottom panel (terminal etc.) ----------------------------------------
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>("terminal");
  const [compatibleIdeOpening, setCompatibleIdeOpening] = useState(false);
  const [compatibleIdeUrl, setCompatibleIdeUrl] = useState<string | null>(null);
  const [compatibleIdeLoadError, setCompatibleIdeLoadError] = useState<string | null>(null);
  const compatibleIdeOpeningRef = useRef(false);

  // --- status bar state (git branch + caret position) ------------------------
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1, sel: 0 });

  // Reset per-workspace UI state when the workspace changes (render-time
  // adjustment — the sanctioned alternative to a setState-in-effect reset).
  const [prevRoot, setPrevRoot] = useState(workspaceRoot);
  if (workspaceRoot !== prevRoot) {
    setPrevRoot(workspaceRoot);
    if (!workspaceRoot) setGitBranch(null);
    if (workspaceRoot) setTerminalOpen(false);
  }

  // Poll the git branch for the status bar. Uses the same `run_command`
  // shell-out as the GitPanel — no dedicated backend command needed.
  useEffect(() => {
    if (!workspaceRoot) return;
    let cancelled = false;
    const fetchBranch = async () => {
      try {
        const res = await invoke<Record<string, unknown>>("run_command", {
          command: "git status --porcelain=v1 -b",
          cwd: workspaceRoot,
          timeout_secs: 10,
        });
        if (cancelled) return;
        const first = (String(res.stdout ?? "").split(/\r?\n/)[0] ?? "").trim();
        if (!first.startsWith("##")) {
          setGitBranch(null); // not a git repository
          return;
        }
        const fresh = /^##\s+no commits yet on\s+(.+)$/i.exec(first);
        const name =
          fresh?.[1] ?? /^##\s+(.+?)(?=\.\.\.|\s+\[|$)/.exec(first)?.[1] ?? null;
        setGitBranch(name && !name.includes("(") ? name.trim() : null);
      } catch {
        if (!cancelled) setGitBranch(null);
      }
    };
    void fetchBranch();
    // Each tick spawns a real `git` process, so this stays infrequent and is
    // suspended while the window is hidden.
    const id = window.setInterval(() => {
      if (!document.hidden) void fetchBranch();
    }, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [workspaceRoot, explorerRefreshKey]);

  // --- explorer width (drag-to-resize, persisted) ---------------------------
  const EXPLORER_KEY = "neo.ide.explorerWidth";
  const [explorerWidth, setExplorerWidth] = useState(() => {
    const stored = Number(localStorage.getItem(EXPLORER_KEY));
    return Number.isFinite(stored) && stored >= 170 && stored <= 480 ? stored : 240;
  });
  const explorerDragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const onExplorerResizeStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    explorerDragRef.current = { startX: e.clientX, startWidth: explorerWidth };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onExplorerResizeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = explorerDragRef.current;
    if (!drag) return;
    setExplorerWidth(Math.min(480, Math.max(170, drag.startWidth + (e.clientX - drag.startX))));
  };
  const onExplorerResizeEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    explorerDragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
  };
  useEffect(() => {
    localStorage.setItem(EXPLORER_KEY, String(explorerWidth));
  }, [explorerWidth]);

  const pushRecent = useCallback((path: string) => {
    setRecentFiles((prev) => {
      const next = [path, ...prev.filter((p) => p !== path)].slice(0, 12);
      try {
        localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
      } catch {
        /* storage full — non-fatal */
      }
      return next;
    });
  }, []);



  // Mirror of the open tabs for callbacks that must stay referentially stable
  // (Tauri event listeners, memoized child props, intervals).
  const tabsRef = useRef<EditorTab[]>([]);
  useLayoutEffect(() => {
    tabsRef.current = editorTabs;
  });

  /** Open a file in an editor tab (fetching content from disk). */
  const openFileInEditor = useCallback(
    async (path: string, line?: number) => {
      // Tabs may be keyed with a different separator/drive case than a jump
      // source (LSP diagnostics publish URI-derived paths) — match on the
      // normalized key and reuse the tab's own path.
      const key = normalizePath(path);
      const existing = tabsRef.current.find((t) => normalizePath(t.path) === key);
      if (existing) {
        setActiveEditorPath(existing.path);
        if (line != null) setRevealLine({ path: existing.path, line });
        return;
      }
      if (line != null) setRevealLine({ path, line });
      setActiveEditorPath(path);
      try {
        const content = await invoke<string>("fs_read_file", { path });
        pushRecent(path);
        // Instant structural feedback while the language server warms up;
        // didOpen retires it once the server takes the file over.
        publishDiagnostics(path, quickScan(content, langOf(path)), "neo");
        void lspDocOpen(path, content);
        setEditorTabs((prev) =>
          prev.some((t) => t.path === path) ? prev : [...prev, { path, content, dirty: false }]
        );
      } catch (e) {
        setError(`Failed to open ${path}: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [pushRecent]
  );

  const collapseExplorer = useCallback(() => setExplorerCollapsed(true), []);
  const closeGit = useCallback(() => setGitOpen(false), []);

  // Stable identities: these go straight into the memoized <CodeEditor>. A new
  // function/object literal per render would defeat that memo on every keystroke.
  const saveEditorFile = async (path: string) => {
    const tab = tabsRef.current.find((t) => t.path === path);
    if (!tab) return;
    try {
      await invoke("fs_write_file", { path, content: tab.content });
      lspDocSave(path);
      setEditorTabs((prev) =>
        prev.map((t) => (t.path === path ? { ...t, dirty: false } : t))
      );
      setExplorerRefreshKey((k) => k + 1);
    } catch (e) {
      setError(`Failed to save ${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // Fresh mirrors so callbacks and the global shortcut handler never go stale.
  const saveRef = useRef(saveEditorFile);
  const activePathRef = useRef(activeEditorPath);
  useLayoutEffect(() => {
    saveRef.current = saveEditorFile;
    activePathRef.current = activeEditorPath;
  });

  const closeEditorTab = useCallback((path: string) => {
    const next = tabsRef.current.filter((t) => t.path !== path);
    const idx = tabsRef.current.findIndex((t) => t.path === path);
    if (idx === -1) return;
    tabsRef.current = next;
    setEditorTabs(next);
    lspDocClose(path);
    if (activePathRef.current === path) {
      setActiveEditorPath(next.length ? next[Math.min(idx, next.length - 1)].path : null);
    }
  }, []);

  const updateEditorContent = useCallback((path: string, content: string) => {
    setEditorTabs((prev) => {
      const next = prev.map((t) => (t.path === path ? { ...t, content, dirty: true } : t));
      tabsRef.current = next;
      return next;
    });
    syncDiagnostics(path, content);
  }, []);

  const handleEditorSave = useCallback((p: string) => void saveRef.current(p), []);

  const closeAllEditorTabs = useCallback(() => {
    for (const t of tabsRef.current) lspDocClose(t.path);
    tabsRef.current = [];
    // Undo timelines are keyed by path and live at module scope, so closing
    // every tab has to drop them explicitly or they pin the old buffers in
    // memory for the rest of the session.
    clearAllHistories();
    setEditorTabs([]);
    setActiveEditorPath(null);
  }, []);

  // Memoized so the memoized <CodeEditor> isn't re-rendered by a fresh object
  // literal on every parent render (which happens on every keystroke).
  const editorPrefs = useMemo(
    () => ({
      fontSize: uiSettings.editorFontSize,
      lineHeight: uiSettings.editorLineHeight,
      tabSize: uiSettings.tabSize,
      wordWrap: uiSettings.wordWrap,
      showLineNumbers: uiSettings.showLineNumbers,
    }),
    [
      uiSettings.editorFontSize,
      uiSettings.editorLineHeight,
      uiSettings.tabSize,
      uiSettings.wordWrap,
      uiSettings.showLineNumbers,
    ]
  );

  const emptyStateHandlers = useRef({
    onOpenFolder: () => void pickWorkspaceFolder(),
    onOpenFiles: () => void pickWorkspaceFiles(),
    onCreateFile: (name: string) => void createFileInWorkspace(name),
  });
  useLayoutEffect(() => {
    emptyStateHandlers.current = {
      onOpenFolder: () => void pickWorkspaceFolder(),
      onOpenFiles: () => void pickWorkspaceFiles(),
      onCreateFile: (name: string) => void createFileInWorkspace(name),
    };
  });
  const editorEmptyState = useMemo(
    () => ({
      hasWorkspace: !!workspaceRoot,
      onOpenFolder: () => void emptyStateHandlers.current.onOpenFolder(),
      onOpenFiles: () => void emptyStateHandlers.current.onOpenFiles(),
      onCreateFile: (name: string) => void emptyStateHandlers.current.onCreateFile(name),
      recentFiles,
      onOpenRecent: (p: string) => void openFileInEditor(p),
    }),
    [workspaceRoot, recentFiles, openFileInEditor]
  );

  // ── Global keyboard shortcuts ──────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "p") {
        // Ctrl+P quick-open and Ctrl+Shift+P share the palette.
        e.preventDefault();
        setPaletteOpen(true);
      } else if (key === "i" && !e.shiftKey) {
        e.preventDefault();
        setAgentOpen((v) => !v);
      } else if (e.shiftKey && key === "e") {
        e.preventDefault();
        setExplorerCollapsed((v) => !v);
      } else if (key === "`") {
        e.preventDefault();
        setTerminalOpen((v) => !v);
      } else if (key === "s" && !e.shiftKey) {
        e.preventDefault();
        if (activePathRef.current) void saveRef.current(activePathRef.current);
      } else if (key === ",") {
        e.preventDefault();
        setSettingsSection(null);
        setSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // __PART_C__

  // --- AUTO-SAVE: persist dirty tabs 800ms after the last keystroke --------
  // Debounced on the SET of dirty paths rather than the tab array itself. It used
  // to depend on `editorTabs`, so every keystroke tore down and re-armed one
  // timer per dirty tab — churn on the typing hot path, and the 800ms window
  // could never elapse while the user kept typing. One timer, and the buffer is
  // read from tabsRef at fire time so it always saves the latest text.
  const dirtyPathsKey = editorTabs
    .filter((t) => t.dirty)
    .map((t) => t.path)
    .join("\n");
  useEffect(() => {
    if (!dirtyPathsKey) return;
    const paths = dirtyPathsKey.split("\n");
    const timer = window.setTimeout(() => {
      for (const path of paths) {
        const tab = tabsRef.current.find((x) => x.path === path);
        if (!tab || !tab.dirty) continue;
        void invoke("fs_write_file", { path: tab.path, content: tab.content })
          .then(() =>
            setEditorTabs((prev) =>
              prev.map((x) => (x.path === path ? { ...x, dirty: false } : x))
            )
          )
          .catch((e) =>
            setError(`Auto-save failed for ${path}: ${e instanceof Error ? e.message : String(e)}`)
          );
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [dirtyPathsKey]);

  // --- Cross-window sync (chat window ⇄ IDE window) --------------------------
  // Refresh a tab from disk unless it has unsaved local edits.
  const syncTabWithDisk = useCallback(async (path: string) => {
    let disk: string | null = null;
    try {
      disk = await invoke<string>("fs_read_file", { path });
    } catch {
      disk = null; // file was deleted / moved / is unreadable
    }
    setEditorTabs((prev) => {
      const idx = prev.findIndex((t) => t.path === path);
      if (idx === -1) return prev;
      const tab = prev[idx];
      if (disk === null) return tab.dirty ? prev : prev.filter((t) => t.path !== path);
      if (tab.dirty || tab.content === disk) return prev;
      const next = [...prev];
      next[idx] = { ...tab, content: disk };
      return next;
    });
  }, []);

  // Cheap change fingerprint (mtime + size) per open tab. The poll below stats
  // each tab and only re-reads a file when its fingerprint actually moved.
  // It used to re-read every open file IN FULL every 2.5s no matter what,
  // pushing whole buffers across the IPC bridge on a timer — the main source
  // of idle CPU, GC churn and memory growth.
  const tabStampsRef = useRef(new Map<string, string>());

  /** `mtime:size` for a path, or null when it is gone / unreadable. */
  const statStamp = useCallback(async (path: string): Promise<string | null> => {
    try {
      const s = await invoke<{
        isDir?: boolean;
        modified?: number | null;
        size?: number | null;
      }>("fs_stat", { path });
      if (s?.isDir) return null;
      return `${s?.modified ?? 0}:${s?.size ?? 0}`;
    } catch {
      return null;
    }
  }, []);

  /** Re-read a single tab, but only once its mtime/size actually moved. */
  const pollTabForChange = useCallback(
    async (path: string) => {
      const stamp = await statStamp(path);
      if (stamp === null) {
        tabStampsRef.current.delete(path);
        setEditorTabs((prev) => {
          const tab = prev.find((t) => t.path === path);
          if (!tab || tab.dirty) return prev;
          return prev.filter((t) => t.path !== path);
        });
        return;
      }
      if (tabStampsRef.current.get(path) === stamp) return; // unchanged — common case
      tabStampsRef.current.set(path, stamp);
      await syncTabWithDisk(path);
    },
    [statStamp, syncTabWithDisk]
  );

  // Poll the filesystem so edits made from the chat window (agent tools), git
  // operations or other editors show up without reopening the file. Suspended
  // while the window is hidden so a backgrounded IDE burns nothing.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.hidden) return;
      const tabs = tabsRef.current;
      // Forget fingerprints of tabs that are no longer open.
      const live = new Set(tabs.map((t) => t.path));
      for (const p of tabStampsRef.current.keys()) {
        if (!live.has(p)) tabStampsRef.current.delete(p);
      }
      for (const t of tabs) {
        if (!t.dirty) void pollTabForChange(t.path);
      }
    }, 2500);
    return () => window.clearInterval(id);
  }, [pollTabForChange]);

  // The chat window forwards file opens (agent tools, problems-panel jumps)
  // and workspace changes to this window via Tauri events.
  useEffect(() => {
    const unlistenOpen = listen<{ path: string; line: number | null }>(
      "neo:ide-open-file",
      (e) => {
        const { path, line } = e.payload;
        if (typeof path === "string" && path) void openFileInEditor(path, line ?? undefined);
      }
    );
    const unlistenChanged = listen("neo:workspace-changed", () => {
      setExplorerRefreshKey((k) => k + 1);
      for (const t of tabsRef.current) {
        if (!t.dirty) void syncTabWithDisk(t.path);
      }
    });
    return () => {
      void unlistenOpen.then((f) => f());
      void unlistenChanged.then((f) => f());
    };
  }, [openFileInEditor, syncTabWithDisk]);

  // --- workspace pickers ----------------------------------------------------
  const pickWorkspaceFolder = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const dir = await open({ directory: true, multiple: false, title: "Open Folder" });
      if (typeof dir === "string") {
        setWorkspaceRoot(dir);
        localStorage.setItem(WS_KEY, dir);
        setEditorTabs([]);
        setActiveEditorPath(null);
      }
    } catch (e) {
      setError(`Failed to open folder: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const pickWorkspaceFiles = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const files = await open({ multiple: true, title: "Open Files" });
      if (Array.isArray(files)) {
        for (const f of files) {
          if (typeof f === "string") await openFileInEditor(f);
        }
      }
    } catch (e) {
      setError(`Failed to open files: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const createFileInWorkspace = async (name: string) => {
    if (!workspaceRoot) return;
    const rel = name.trim().replace(/^[\\/]+/, "").replace(/\\/g, "/");
    const path = `${workspaceRoot.replace(/[\\/]+$/, "")}/${rel}`;
    try {
      await invoke("fs_write_file", { path, content: "" });
      setExplorerRefreshKey((k) => k + 1);
      await openFileInEditor(path);
    } catch (e) {
      setError(`Failed to create ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const activeDirty =
    editorTabs.find((t) => t.path === activeEditorPath)?.dirty ?? false;

  const openExtensionsWorkbench = async () => {
    if (!workspaceRoot) {
      setError("Open a workspace folder before launching the extensions workbench.");
      return;
    }
    if (compatibleIdeOpeningRef.current) return;
    compatibleIdeOpeningRef.current = true;
    setCompatibleIdeOpening(true);
    let runtimeStarted = false;
    try {
      const baseUrl = await invoke<string>("compatible_ide_start", {
        workspace: workspaceRoot,
      });
      runtimeStarted = true;
      const workbenchUrl = new URL(baseUrl);
      workbenchUrl.searchParams.set("folder", workspaceRoot);
      setCompatibleIdeLoadError(null);
      setCompatibleIdeUrl(workbenchUrl.toString());
    } catch (e) {
      let message = e instanceof Error ? e.message : String(e);
      if (runtimeStarted) {
        try {
          await invoke("compatible_ide_stop");
        } catch (stopError) {
          message += `; the workbench process could not be stopped: ${
            stopError instanceof Error ? stopError.message : String(stopError)
          }`;
        }
      }
      setError(`Could not launch extensions workbench: ${message}`);
    } finally {
      compatibleIdeOpeningRef.current = false;
      setCompatibleIdeOpening(false);
    }
  };

  const closeExtensionsWorkbench = async () => {
    setCompatibleIdeUrl(null);
    setCompatibleIdeLoadError(null);
    try {
      await invoke("compatible_ide_stop");
    } catch (e) {
      setError(`Could not stop extensions workbench: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** Persist a batch of paths. An effect event so the debounce effect below can
   *  stay keyed on the tab list and delay settings only, instead of restarting
   *  on every render because `saveEditorFile` is re-created each time. */
  const saveDirtyTabs = useEffectEvent((paths: string[]) => {
    for (const p of paths) void saveEditorFile(p);
  });

  // Auto-save: debounce-save every dirty editor tab after the configured delay.
  useEffect(() => {
    if (!uiSettings.autoSave) return;
    const dirty = editorTabs.filter((t) => t.dirty);
    if (dirty.length === 0) return;
    const id = window.setTimeout(() => {
      saveDirtyTabs(dirty.map((t) => t.path));
    }, uiSettings.autoSaveDelayMs);
    return () => window.clearTimeout(id);
  }, [editorTabs, uiSettings.autoSave, uiSettings.autoSaveDelayMs]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg-editor)] text-[var(--text-primary)]">
      {/*Title bar: menus + workspace + window controls*/}
      <header
        data-tauri-drag-region="deep"
        className="flex h-[35px] shrink-0 items-center justify-between border-b border-(--border) bg-[var(--bg-chrome)] px-2"
      >
        <IdeMenuBar
          hasWorkspace={!!workspaceRoot}
          terminalOpen={terminalOpen}
          onOpenSettings={() => {
            setSettingsSection(null);
            setSettingsOpen(true);
          }}
          gitOpen={gitOpen}
          canSave={activeDirty}
          onSaveFile={() => {
            if (activeEditorPath) void saveEditorFile(activeEditorPath);
          }}
          onOpenFolder={() => void pickWorkspaceFolder()}
          onOpenFiles={() => void pickWorkspaceFiles()}
          onCloseAllTabs={closeAllEditorTabs}
          onToggleTerminal={() => setTerminalOpen((v) => !v)}
          onToggleGit={() => setGitOpen((v) => !v)}
          activePath={activeEditorPath}
          onClosePanel={() => void appWindow.close()}
        />
        <div data-tauri-drag-region="deep" className="flex items-center gap-1.5">
          {workspaceRoot && (
            <span
              data-tauri-drag-region="deep"
              className="max-w-[350px] truncate text-[11.5px] text-[var(--text-secondary)]"
              title={workspaceRoot}
            >
              {[
                activeEditorPath ? (activeEditorPath.split(/[\\/]/).pop() ?? null) : null,
                workspaceRoot.split(/[\\/]/).filter(Boolean).pop() ?? null,
                "Struct",
              ]
                .filter(Boolean)
                .join(" — ")}
            </span>
          )}
          {error && (
            <button
              type="button"
              onClick={() => setError(null)}
              title={error}
              className="max-w-[280px] truncate rounded bg-red-500/15 px-1.5 py-0.5 text-[10.5px] text-red-400"
            >
              {error} ✕
            </button>
          )}
        </div>
        <WindowControls />
      </header>

      {/* ── Body: activity rail | explorer | editor | git ──────────────── */}
      <div className="flex min-h-0 flex-1">
        
        <nav className="flex w-12 shrink-0 flex-col items-center justify-between border-r border-(--border) bg-[var(--bg-chrome)] py-1">
          <div className="flex w-full flex-col items-center gap-1">
            <RailButton
              active={!explorerCollapsed}
              title="Toggle file explorer"
              titleKey="ide.toggleExplorer"
              onClick={() => setExplorerCollapsed((v) => !v)}
            >
              <IoFolderOpenOutline size={19} />
            </RailButton>
            <RailButton active={gitOpen} title="Git tools" titleKey="ide.toggleGit" onClick={() => setGitOpen((v) => !v)}>
              <IoGitBranch size={19} />
            </RailButton>
            <RailButton
              active={agentOpen}
              title="AI Agent"
              titleKey="ide.toggleAgent"
              onClick={() => setAgentOpen((v) => !v)
              }
            >
              <span className="relative">
                <IoChatboxEllipsesOutline size={19} />
                {agentBusy && (
                  <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-(--accent) animate-pulse" />
                )}
              </span>
            </RailButton>
            <RailButton
              active={settingsOpen}
              title="Settings"
              titleKey="ide.openSettings"
              onClick={() => {
                setSettingsSection(null);
                setSettingsOpen((v) => !v);
              }}
            >
              <IoSettingsOutline size={19} />
            </RailButton>
            <RailButton
              active={!!compatibleIdeUrl || compatibleIdeOpening}
              title={compatibleIdeUrl ? "Return to Neo editor" : compatibleIdeOpening ? "Starting extensions workbench…" : "Open VS Code-compatible extensions"}
              onClick={() => {
                if (compatibleIdeUrl) void closeExtensionsWorkbench();
                else void openExtensionsWorkbench();
              }}
            >
              {compatibleIdeUrl ? <IoCodeSlash size={19} /> : <IoExtensionPuzzleOutline size={19} />}
            </RailButton>
          </div>
          <div className="w-full">
            <RailButton
              active={paletteOpen}
              title="Command Palette"
              titleKey="app.search"
              onClick={() => setPaletteOpen(true)}
            >
              <IoSearch size={19} />
            </RailButton>
            <RailButton
              active={terminalOpen && panelTab === "problems"}
              title="Problems"
              onClick={() => {
                setPanelTab("problems");
                setTerminalOpen(true);
              }}
            >
              <IoAlertCircle size={19} />
            </RailButton>
            <RailButton
              active={terminalOpen && panelTab === "debug"}
              title="Debug Console"
              onClick={() => {
                setPanelTab("debug");
                setTerminalOpen(true);
              }}
            >
              <IoCodeSlash size={19} />
            </RailButton>
            <RailButton active={terminalOpen} title="Terminal" titleKey="ide.toggleTerminal" onClick={() => setTerminalOpen((v) => !v)}>
              <IoTerminal size={19} />
            </RailButton>
            
          </div>
        </nav>
        {workspaceRoot && !explorerCollapsed && (
          <>
            <FileExplorer
              root={workspaceRoot}
              activePath={activeEditorPath}
              refreshKey={explorerRefreshKey}
              onOpenFile={openFileInEditor}
              onCollapse={collapseExplorer}
              width={explorerWidth}
            />
            {/* Drag handle — VS Code-style sash between sidebar and editor. */}
            <div
              role="separator"
              aria-orientation="vertical"
              title="Drag to resize explorer"
              onPointerDown={onExplorerResizeStart}
              onPointerMove={onExplorerResizeMove}
              onPointerUp={onExplorerResizeEnd}
              onPointerCancel={onExplorerResizeEnd}
              className="w-[3px] shrink-0 cursor-col-resize touch-none select-none bg-transparent transition-colors hover:bg-(--accent)/25 active:bg-(--accent)/40"
            />
          </>
        )}

        {compatibleIdeUrl ? (
          <section className="relative flex min-w-0 flex-1 flex-col bg-[var(--bg-editor)]">
            {compatibleIdeLoadError ? (
              <div className="m-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
                <p className="font-medium">The extensions workbench could not be displayed.</p>
                <p className="mt-1 break-words text-xs text-red-200/80">{compatibleIdeLoadError}</p>
                <button
                  type="button"
                  onClick={() => void openExtensionsWorkbench()}
                  className="mt-3 rounded bg-red-500/20 px-3 py-1.5 text-xs hover:bg-red-500/30"
                >
                  Retry
                </button>
              </div>
            ) : (
              <iframe
                key={compatibleIdeUrl}
                title="VS Code-compatible Extensions Workbench"
                src={compatibleIdeUrl}
                allow="clipboard-read; clipboard-write"
                allowFullScreen
                onError={() => setCompatibleIdeLoadError(
                  "The embedded workbench failed to load. Check that code-server is still running and reload the workspace."
                )}
                className="h-full w-full flex-1 border-0 bg-[var(--bg-editor)]"
              />
            )}
          </section>
        ) : (
          <CodeEditor
            tabs={editorTabs}
            activePath={activeEditorPath}
            onSelect={setActiveEditorPath}
            onClose={closeEditorTab}
            onChange={updateEditorContent}
            onSave={handleEditorSave}
            onCloseAll={closeAllEditorTabs}
            reveal={revealLine}
            prefs={editorPrefs}
            onCursorChange={setCursorPos}
            emptyState={editorEmptyState}
          />
        )}

        {gitOpen && workspaceRoot && (
          <GitPanel
            root={workspaceRoot}
            onClose={closeGit}
            onOpenFile={(p: string) =>
              void openFileInEditor(`${workspaceRoot.replace(/[/\\]+$/, "")}/${p}`)
            }
          />
        )}

        {/* ── AI Agent panel (docked right) ──────────────────────────────── */}
        {agentOpen && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              title="Drag to resize agent panel"
              onPointerDown={onAgentResizeStart}
              onPointerMove={onAgentResizeMove}
              onPointerUp={onAgentResizeEnd}
              onPointerCancel={onAgentResizeEnd}
              className="w-[3px] shrink-0 cursor-col-resize touch-none select-none bg-transparent transition-colors hover:bg-(--accent)/25 active:bg-(--accent)/40"
            />
            <div style={{ width: agentWidth }} className="h-full shrink-0">
              <AgentPanel
                settings={aiSettings}
                workspaceRoot={workspaceRoot}
                editorTabs={editorTabs}
                activeEditorPath={activeEditorPath}
                onBusyChange={setAgentBusy}
                onClose={() => setAgentOpen(false)}
                onOpenFile={(p) => void openFileInEditor(p)}
                onOpenSettings={() => {
                  setSettingsSection("ai");
                  setSettingsOpen(true);
                }}
                onFilesChanged={() => setExplorerRefreshKey((k) => k + 1)}
              />
            </div>
          </>
        )}
      </div>

     
      <BottomPanel
        open={terminalOpen}
        tab={panelTab}
        onTab={setPanelTab}
        onClose={() => setTerminalOpen(false)}
        root={workspaceRoot}
        onOpenFile={(p, line) => void openFileInEditor(p, line)}
        terminalPrefs={{
          fontSize: uiSettings.terminalFontSize,
          scrollback: uiSettings.terminalScrollback,
          cursorBlink: uiSettings.terminalCursorBlink,
        }}
      />

      <SettingsPanel
        open={settingsOpen}
        settings={uiSettings}
        onChange={updateUiSettings}
        aiSettings={aiSettings}
        onAiChange={handleAiChange}
        onSelectLocalModel={handleSelectLocalModel}
        initialSection={settingsSection}
        onClose={() => setSettingsOpen(false)}
        account={account}
        accountProfile={accountProfile}
        accountLoading={accountLoading}
        onAccountRefresh={() => void refreshAccount()}
        workspaceRoot={workspaceRoot}
      />

      <CommandPalette
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={[
          {
            id: "agent",
            label: "Toggle AI Agent Panel",
            category: "Agent",
            shortcut: "Ctrl+I",
            action: () => setAgentOpen((v) => !v),
          },
          {
            id: "extensions-workbench",
            label: compatibleIdeUrl ? "Return to Neo Editor" : "Open Extensions Workbench",
            category: "Extensions",
            action: () => {
              if (compatibleIdeUrl) void closeExtensionsWorkbench();
              else void openExtensionsWorkbench();
            },
          },
          ...recentFiles.map((p) => ({
            id: `recent-${p}`,
            label: p.split(/[\\/]/).pop() ?? p,
            category: "Recent",
            action: () => void openFileInEditor(p),
          })),
          {
            id: "open-folder",
            label: "Open Folder…",
            category: "File",
            action: () => void pickWorkspaceFolder(),
          },
          {
            id: "open-files",
            label: "Open Files…",
            category: "File",
            action: () => void pickWorkspaceFiles(),
          },
          {
            id: "new-file",
            label: "New File…",
            category: "File",
            action: () => {
              const name = window.prompt(translate("ide.fileNamePrompt", getActiveLanguage()));
              if (name) void createFileInWorkspace(name);
            },
          },
          {
            id: "save",
            label: "Save File",
            category: "File",
            shortcut: "Ctrl+S",
            action: () => {
              if (activeEditorPath) void saveEditorFile(activeEditorPath);
            },
          },
          {
            id: "close-all-tabs",
            label: "Close All Editor Tabs",
            category: "File",
            action: closeAllEditorTabs,
          },
          {
            id: "explorer",
            label: "Toggle File Explorer",
            category: "View",
            shortcut: "Ctrl+Shift+E",
            action: () => setExplorerCollapsed((v) => !v),
          },
          {
            id: "git",
            label: "Toggle Git Panel",
            category: "View",
            action: () => setGitOpen((v) => !v),
          },
          {
            id: "problems",
            label: "Show Problems",
            category: "View",
            action: () => {
              setPanelTab("problems");
              setTerminalOpen(true);
            },
          },
          {
            id: "debug-console",
            label: "Show Debug Console",
            category: "View",
            action: () => {
              setPanelTab("debug");
              setTerminalOpen(true);
            },
          },
          {
            id: "terminal",
            label: "Toggle Terminal",
            category: "View",
            shortcut: "Ctrl+`",
            action: () => setTerminalOpen((v) => !v),
          },
          {
            id: "settings",
            label: "Open Settings",
            category: "Settings",
            shortcut: "Ctrl+,",
            action: () => {
              setSettingsSection(null);
              setSettingsOpen(true);
            },
          },
          {
            id: "ai-settings",
            label: "Open AI Settings",
            category: "Settings",
            action: () => {
              setSettingsSection("ai");
              setSettingsOpen(true);
            },
          },
        ]}
      />

      <IdeStatusBar
        agentBusy={agentBusy}
        onToggleAgent={() => setAgentOpen((v) => !v)}
        workspaceRoot={workspaceRoot}
        gitBranch={gitBranch}
        activeEditorPath={activeEditorPath}
        activeDirty={activeDirty}
        cursorPos={cursorPos}
        tabSize={uiSettings.tabSize}
        wordWrap={uiSettings.wordWrap}
      />
    </div>
  );


}

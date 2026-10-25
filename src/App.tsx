/*
 * Author: madhusudhan
 * Check the LICENSE in the GitHub repo (https://github.com/Lumorix-studios/Struct) for more information on permissions to use this code.
 */
//author of this entire codebase is Madhusudhan thapa (madhusudhant207@gmail.com) and coding agents
// See LICENSE file in the project root for full license information.
//cant guarantee that this codebase is free of bugs or security vulnerabilities. Use at your own risk. The author is not responsible for any damage or loss caused by the use of this codebase.
//also cant assure you this will always stay opensource
//       last modified : 9/24/26
import { lazy, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import { useTranslation } from "./i18n";
import ChatHistorySidebar from "../components/ChatHistorySidebar.tsx";
import InfoPanel from "../components/InfoPanel";
import PrivacyPolicy from "../components/PrivacyPolicy.tsx";
import CommandPalette from "../components/CommandPalette";
//import StatusBar from "../components/StatusBar.tsx";
import Tab2 from "../components/Tab2.tsx";
import Markdown from "./components/Markdown";
// import BottomPanel, { type PanelTab } from "./components/BottomPanel";
//was the terminal panel for the main chat interface ->
// but i assume there is no need for that as it exists inside the IDE
import "./editor.css";
import type { AISettings, ChatSession, Message } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import ThinkingIndicator from "../components/ThinkingIndicator";
import BlurText from "../components/BlurText.tsx";
import {
  loadSettings,
  saveSettings,
  hasSavedSettings,
  loadSessions,
  saveSessions,
  loadActiveSessionId,
  saveActiveSessionId,
} from "./store";
import {
  getCurrentUser,
  getProfile,
  onAuthChanged,
  handleOAuthRedirect,
  AUTH_CHANGED_EVENT,
  type NeoUser,
  type Profile as AccountProfile,
} from "./lib/auth";
import * as cloudSync from "./lib/cloudSync";
import {
  checkForUpdate,
  dismissedUntil,
  setDismissedUntil,
  clearDismissedUntil,
  type UpdateCheckResult,
} from "./lib/updateCheck";
import UpdateNotification from "../components/UpdateNotification";
import PromptBar from "../components/PromptBar";
import {
  buildAttachmentContext,
  expandCommand,
  pickFiles,
  pickFolder,
} from "./lib/attachments";
import { useDeepLinkAuth } from "./lib/deepLink";
import * as byok from "./lib/byok";
import { isSupabaseConfigured } from "./lib/supabase";
import {
  getProviderSpec,
  buildAuthHeaders,
  markNoNativeTools,
  outputTokensForEffort,
  PROVIDER_OPTIONS,
  providerById,
} from "./providers";
import type { ProviderSpec } from "./providers";
import type { ProviderId } from "./types";
import AgenticActivity from "./components/AgenticActivity";
import {
  AGENTIC_PROMPT,
  activityId,
  executeTool,
  formatToolResult,
  ingestNativeChunk,
  isDestructive,
  isToolName,
  nativeAccToCalls,
  parseToolCalls,
  stabilizeStreamingMarkdown,
  stripToolCalls,
  type NativeToolAcc,
  type ToolCall,
} from "./agentic";
import { getProjectContext } from "./projectIndex";
import type { AgenticActivity as AgenticActivityType } from "./agentic";
import type { FsEntry } from "./agentic";
import {
  loadMcpServers,
  listMcpTools,
  callMcpTool,
  formatMcpToolSchema,
  type McpToolEntry,
} from "./mcp";
import { computeLineDiff } from "./diff";
import { checkRateLimit, estimateTokens, recordUsage } from "./tokenUsage";
import { resolveFsPath } from "./agentic";
import { ensureOllamaReady } from "./localModels";
import type { SectionId } from "./components/SettingsPanel";
import {
  applyUiSettings,
  DEFAULT_UI_SETTINGS,
  getRecentFiles,
  getRecentFolders,
  loadUiSettings,
  pushRecentFile,
  saveUiSettings,
  type UiSettings,
} from "./uiSettings";
import { getActiveLanguage, setActiveLanguage } from "./i18n";
import { IoMenu, IoAlertSharp, /*IoBarChartOutline, IoBugOutline*/ IoCheckmark, IoCopyOutline, IoFolderOutline, /*IoSparkles*/ /*IoTerminal,*/ IoThumbsDownSharp, IoThumbsUpSharp, /*IoInformation*/ } from "react-icons/io5";
import { shortPath } from "./utils";

const SettingsPanel = lazy(() => import("./components/SettingsPanel"));
import { invoke, listen, isNativeRuntime, saveDialog, openDialog } from "./native";

type JsonDict = Record<string, unknown>;

/** An open file in the chat's built-in viewer (the whole editor lives here now). */
interface EditorTab {
  path: string;
  content: string;
  dirty: boolean;
}


/** Newline character (avoids escape-sequence issues in generated code). */
const NL = String.fromCharCode(10);

/* Quick-Action presets removed as requested */


/** Result of one streaming round: visible text + any native tool calls. */
interface StreamRoundResult {
  text: string;
  nativeCalls: ToolCall[];
  /** Exact prompt (input) tokens the provider reported for this round — i.e. the
   *  true size of the context that was sent (system prompt + full history +
   *  tool schemas). `0` when the provider returned no usage counters. */
  usageIn?: number;
}

function truncateToolOutput(output: string): string {
  if (output.length <= MAX_TOOL_OUTPUT) return output;
  const head = Math.floor(MAX_TOOL_OUTPUT * 0.6);
  const tail = MAX_TOOL_OUTPUT - head;
  const omitted = output.length - head - tail;
  return (
    output.slice(0, head) +
    `${NL}[... output truncated — ${omitted} characters omitted ...]${NL}` +
    output.slice(output.length - tail)
  );
}

const MAX_TOOL_OUTPUT = 24000;


async function platformFetch(url: string, init: RequestInit): Promise<Response> {
  // Inside Electron, loopback traffic to the local model servers goes through
  // the main process so a locked-down OLLAMA_ORIGINS never 403s the packaged
  // origin, and so the llama-server CORS rules never reject the renderer.
  if (window.neoDesktop) {
    try {
      const parsed = new URL(url);
      const loopback =
        parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
      if (loopback && parsed.port === "11434") {
        const native = await invoke<{ status: number; body: string }>("ollama_request", {
          url,
          method: init.method ?? "GET",
          body: typeof init.body === "string" ? init.body : null,
        });
        return new Response(native.body, {
          status: native.status,
          headers: { "Content-Type": "application/json" },
        });
      }
      // The managed llama-server runs on 18080 by default; the native side
      // validates the port against the set of servers we started.
      if (loopback && parsed.port === "18080") {
        const native = await invoke<{ status: number; body: string }>("llamacpp_request", {
          url,
          method: init.method ?? "GET",
          body: typeof init.body === "string" ? init.body : null,
        });
        return new Response(native.body, {
          status: native.status,
          headers: { "Content-Type": "application/json" },
        });
      }
    } catch (e) {
      throw new Error(
        `Electron native request failed: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e }
      );
    }
  }
  return fetch(url, init);
}
const sendFeedback = (feedback: "good" | "bad" | "report") => {
  const subject = encodeURIComponent("Struct Feedback");
  const body = encodeURIComponent(`Feedback: ${feedback}`);

  window.location.href =
    `mailto:madhusudhant207@gmail.com?subject=${subject}&body=${body}`;
};

function sanitizeHistory(msgs: Message[]): Message[] {
  const out: Message[] = [];
  for (const m of msgs) {
    const hasNativeCalls = !!(m.toolCalls && m.toolCalls.length > 0);
    if (m.role === "assistant" && m.content.trim().length === 0 && !hasNativeCalls) continue;
    const last = out[out.length - 1];
    if (
      last &&
      last.role === m.role &&
      !(last.toolCalls && last.toolCalls.length > 0) &&
      !hasNativeCalls
    ) {
      last.content = `${last.content}
${m.content}`.trim();
    } else {
      out.push({ ...m });
    }
  }
  return out;
}

function generateSessionId(): string {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function deriveTitle(messages: Message[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "Untitled chat";
  const text = firstUser.content.trim();
  return text.length > 50 ? text.slice(0, 50) + "…" : text;
}

const SHARED_WS_KEY = "neo.ide.workspaceRoot";

/** Parse a PromptBar model key of the form `providerId:modelName`
 *  (e.g. `"openai:gpt-4o"`) back into its provider + model. Returns `null` when
 *  the key is malformed or names a provider we don't know, so callers can no-op
 *  instead of switching the app to a bogus provider. */
function parseProviderKey(key: string): { provider: ProviderId; model: string } | null {
  const idx = key.indexOf(":");
  if (idx <= 0) return null;
  const provider = key.slice(0, idx) as ProviderId;
  if (!PROVIDER_OPTIONS.some((p) => p.id === provider)) return null;
  return { provider, model: key.slice(idx + 1).trim() };
}
/** Resolved once per process — the Rust side reports the version this binary
 *  was built as, so it cannot change while the app is running. */
const APP_VERSION = isNativeRuntime()
  ? invoke<string>("get_app_version").catch(() => "0.0.0")
  : Promise.resolve("0.0.0");

/** Known context-window sizes by model-family substring (first match wins). */
const CONTEXT_LIMITS: Array<[string, number]> = [
  ["gpt-4o", 128000],
  ["gpt-4.1", 1000000],
  ["gpt-5", 400000],
  ["o1", 200000],
  ["o3", 200000],
  ["claude", 200000],
  ["gemini-2.5-pro", 1048576],
  ["gemini-2.5-flash", 1048576],
  ["gemini-1.5", 1048576],
  ["gemini", 32768],
  ["deepseek", 65536],
  ["qwen", 32768],
  ["mistral", 32768],
  ["grok", 131072],
  ["llama", 131072], // Llama 3.x is 128k — 8k made modern models look ~16× too full
];

/** Small icon used on the welcome-screen action cards. */
// function CardIcon({ name }: { name: string }) {
//   const cls = "shrink-0 opacity-60";
//   const color = "var(--accent)";
//   switch (name) {
//     case "folder":
//       return <IoFolderOutline size={13} className={cls} color={color} />;
//     case "chart":
//       return <IoBarChartOutline size={13} className={cls} color={color} />;
//     case "bug":
//       return <IoBugOutline size={13} className={cls} color={color} />;
//     default:
//       return <IoSparkles size={13} className={cls} color={color} />;
//   }
// }

function contextLimitFor(model: string): number {
  const m = model.toLowerCase();
  for (const [key, limit] of CONTEXT_LIMITS) {
    if (m.includes(key)) return limit;
  }
  return 128000;
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

/** Small ghost icon-button used in the assistant message action row.
 *  Shows a transient checkmark after a click instead of any dialog. */
function MessageAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        onClick();
        setDone(true);
        window.setTimeout(() => setDone(false), 1200);
      }}
      title={label}
      aria-label={label}
      className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
        done
          ? "text-[var(--success)]"
          : "text-[var(--text-muted)] hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
      }`}
    >
      {done ? (
        <IoCheckmark size={13} />
      ) : (
        children
      )}
    </button>
  );
}

export default function App() {
  // const [onOpenTerminal, setOpenTerminal] = useState(false);
  // Which tab of the bottom dock is visible (terminal/problems/debug/…).
  // const [panelTab, setPanelTab] = useState<PanelTab>("terminal");
  const [historySidebarOpen, setHistorySidebarOpen] = useState(false);
  const [infoPanelOpen, setInfoPanelOpen] = useState(false);
  const [privacyPolicyOpen, setPrivacyPolicyOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [Tab2Open, setTab2Open] = useState(false);
  const { t } = useTranslation();
  // In-app update notification banner (from GitHub releases check).
  const [updateNotification, setUpdateNotification] = useState<{
    result: UpdateCheckResult;
    dismissedAt: number | null;
  } | null>(null);

  /** Ask the releases feed whether a newer build exists and surface the banner
   *  when one does. `force` clears any earlier dismissal, so a manual
   *  "Help → Check for Updates…" always re-prompts. Wrapped in `useCallback`
   *  so the startup effect below can depend on it without re-firing. */
  const runUpdateCheck = useCallback(async (force: boolean) => {
    if (!isNativeRuntime()) return;
    try {
      if (force) clearDismissedUntil();
      const current = await APP_VERSION;
      const result = await checkForUpdate(current);
      if (!result.isUpdateAvailable) {
        setUpdateNotification(null);
        return;
      }
      // A release the user already dismissed stays hidden until something
      // newer ships — otherwise the banner would nag on every launch.
      const dismissed = force ? null : dismissedUntil();
      if (dismissed && dismissed === result.latestVersion) return;
      setUpdateNotification({ result, dismissedAt: Date.now() });
    } catch {
      // Best-effort: a failed check leaves the previous state untouched.
    }
  }, []);

  // One background check on startup so the banner shows up on its own —
  // the user should not have to go looking in the Help menu for it.
  // Deferred a microtask so the check never sets state synchronously inside
  // the effect body (matching how ProblemsPanel kicks off its first scan).
  useEffect(() => {
    void Promise.resolve().then(() => runUpdateCheck(false));
  }, [runUpdateCheck]);

  /** Hide the banner and remember the version, so this release does not
   *  prompt again until a newer one is published. */
  const handleDismissUpdate = useCallback(() => {
    if (updateNotification) {
      setDismissedUntil(updateNotification.result.latestVersion);
    }
    setUpdateNotification(null);
  }, [updateNotification]);

  const [message, setMessage] = useState("");
  const effortTokensRef = useRef(outputTokensForEffort("Medium"));
  const [messages, setMessages] = useState<Message[]>([]);
  // Exact prompt-token count the provider reported for the most recent round of
  // THIS conversation (0 = not measured yet → fall back to the char estimate).
  // Kept in component state, so it survives switching provider/model mid-chat.
  const [ctxReported, setCtxReported] = useState(0);
  const [settings, setSettings] = useState<AISettings>(DEFAULT_SETTINGS);
  const [restored, setRestored] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  // --- Account (Supabase) state ---
  const [account, setAccount] = useState<NeoUser | null>(null);
  const [accountProfile, setAccountProfile] = useState<AccountProfile | null>(null);
  const [accountLoading, setAccountLoading] = useState(isSupabaseConfigured);
  const signedIn = !!account;
  /** updatedAt of the last cloud push per chat id — avoids re-uploading unchanged chats. */
  const cloudPushedAtRef = useRef<Map<string, number>>(new Map());
  const [activities, setActivities] = useState<AgenticActivityType[]>([]);
  const [pendingApproval, setPendingApproval] =
    useState<AgenticActivityType | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Resolver for the pending destructive-tool approval dialog.
  const approvalRef = useRef<{
    id: string;
    resolve: (approved: boolean) => void;
  } | null>(null);
  // Cap the number of tool-executing rounds to avoid runaway loops. Rounds
  // where the model only streams prose (no tool calls) don't count. When the
  // cap is reached mid-task, the run gets a fresh budget (checkpoint) up to
  // MAX_CHECKPOINTS times while it keeps making progress.
  const MAX_TOOL_ROUNDS = 75;
  const MAX_CHECKPOINTS = 2;

  // Keep greetings lightweight, but leave tools enabled for every substantive
  // request. A keyword classifier cannot reliably recognize phrasing such as
  // "look at this", "can you access tools?", or provider-specific tasks.
  const shouldUseAgenticMode = (text: string): boolean => {
    if (/^(?:hi|hey|hello|yo|thanks|thank you|good morning|good afternoon|good evening|ok|okay|cool|nice)[!.?,\s]*$/i.test(text)) {
      return false;
    }
    return true;
  };

  // The active streaming request's abort controller, so we can cancel it.
  const streamControllerRef = useRef<AbortController | null>(null);
  // Mutable hold of the assistant text being streamed in (avoids closures capturing stale state).
  const streamedContentRef = useRef("");
  const streamRenderRef = useRef<{ pending: string; timer: number | null }>({
    pending: "",
    timer: null,
  });
  // Raw (unstripped) assistant text of the round being streamed. The visible
  // text is derived from it, but the derivation (stripping tool-call markup)
  // is far too expensive to run on every delta — see scheduleStreamingAssistantContent.
  const streamRawRef = useRef("");
  // Identifies the current streaming run. A previous run that is still
  // unwinding must not flush its pending text into the next run's bubble.
  const streamRunRef = useRef(0);
  const mountedRef = useRef(true);
  // Whether the user is scrolled near the bottom (auto-follow).
  const autoScrollRef = useRef(true);
  // Late-bound so the Ctrl+Shift+O shortcut always calls the current closure.
  const openWorkspaceRef = useRef<() => void>(() => {});
  // Workspace root shared with the IDE window via a persisted localStorage key.
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(() => {
    const saved = localStorage.getItem(SHARED_WS_KEY);
    return saved || homeRoot;
  });
  // Default working directory when no folder is open: the user's home dir.
  // Fetched once from the native layer (null in plain-browser dev mode) so
  // the agent can list/read/search and run commands anywhere the user asks,
  // without first opening a folder inside the app.
  const [homeRoot, setHomeRoot] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void invoke<string>("home_dir")
      .then((h) => {
        if (!cancelled && typeof h === "string" && h) setHomeRoot(h);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  // --- Context menu (top-left): workspace folder list + pinned files ---
  const [contextEntries, setContextEntries] = useState<FsEntry[]>([]);
  const [pinnedPaths, setPinnedPaths] = useState<string[]>([]);

  // Load the workspace folder listing for the Context menu when the root changes.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!workspaceRoot) {
        setContextEntries([]);
        return;
      }
      try {
        const entries = await invoke<FsEntry[]>("fs_list_dir", { path: workspaceRoot });
        if (cancelled) return;
        const sorted = [...entries].sort((a, b) =>
          a.is_dir !== b.is_dir ? (a.is_dir ? -1 : 1) : a.name.localeCompare(b.name)
        );
        setContextEntries(sorted.slice(0, 60));
      } catch {
        if (!cancelled) setContextEntries([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceRoot]);

  /** Toggle a file's pin in the agent's context (Context menu). */
  const togglePinFile = (path: string) => {
    setPinnedPaths((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    );
  };
  const [editorTabs, setEditorTabs] = useState<EditorTab[]>([]);
  const [activeEditorPath, setActiveEditorPath] = useState<string | null>(null);
  // --- UI settings (Settings tab) ---
  const [uiSettings, setUiSettings] = useState<UiSettings>(DEFAULT_UI_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Which section of the settings panel was requested (null = default). */
  const [settingsSection, setSettingsSection] = useState<SectionId | null>(null);
  const [, setRecentFiles] = useState<string[]>([]);
  const [, setRecentFolders] = useState<string[]>([]);

  const spec: ProviderSpec = getProviderSpec(settings);

  // --- Context-window usage -------------------------------------------------
  // `ctxReported` is the exact prompt-token count the provider gave us for the
  // last completed round — the real size of the context that was sent (system
  // prompt + full history + tool schemas). Because the conversation lives in
  // `messages`, this number follows it when you switch AI models mid-chat; each
  // new turn just refreshes the reading. Until the first reading lands we fall
  // back to a char/4 estimate (shown with a leading `~`).
  const ctxLimit = contextLimitFor(settings.model);
  const estTokens = (() => {
    let chars = settings.systemPrompt.length + 800; // headroom for agent prompt
    for (const m of messages) chars += m.content.length;
    return Math.ceil(chars / 4);
  })();
  const ctxIsReal = ctxReported > 0;
  const ctxTokens = ctxIsReal ? ctxReported : estTokens;
  const ctxPct = Math.min(100, Math.round((ctxTokens / ctxLimit) * 100));

  // --- PromptBar model menu: switch providers straight from the composer ---
  /** Rows for the PromptBar model menu — the active model first, then every
   *  other provider's default model. Picking one switches provider + model
   *  (this used to live in a pill in the top menu). */
  const promptModels = useMemo(() => {
    const rows: { key: string; name: string; tag?: string }[] = [
      {
        key: `${settings.provider}:${settings.model}`,
        name: settings.model || spec.label,
        tag: spec.label,
      },
    ];
    for (const option of PROVIDER_OPTIONS) {
      if (option.id === settings.provider) continue;
      const provider = providerById(option.id);
      rows.push({
        key: `${option.id}:${provider.defaultModel}`,
        name: provider.defaultModel || provider.label,
        tag: provider.label,
      });
    }
    return rows;
  }, [settings.provider, settings.model, spec.label]);

  /** Switch provider/model from the PromptBar. Mirrors the Settings panel:
   *  adopt the new provider's default endpoint, then persist to disk and to the
   *  active session so its tab remembers the model. */
  const handlePromptModelChange = (key: string) => {
    const parsed = parseProviderKey(key);
    if (!parsed || parsed.provider === settings.provider) return;
    const next = providerById(parsed.provider);
    const updated: AISettings = {
      ...settings,
      provider: parsed.provider,
      baseUrl: next.defaultBaseUrl,
      model: parsed.model || next.defaultModel,
    };
    setSettings(updated);
    void saveSettings(updated);
    if (activeSessionId) {
      setSessions((prev) =>
        prev.map((s) => (s.id === activeSessionId ? { ...s, settings: updated } : s))
      );
    }
  };

  /** Global shortcut body. Declared as an effect event so it always sees the
   *  latest refs/state while the listener itself is registered only once. */
  const onGlobalKey = useEffectEvent((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
      e.preventDefault();
      setSettingsSection("ai");
      setSettingsOpen(true);
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "h") {
      e.preventDefault();
      setHistorySidebarOpen((v) => !v);
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "p") {
      e.preventDefault();
      setCommandPaletteOpen((v) => !v);
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "o") {
      e.preventDefault();
      openWorkspaceRef.current();
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "`") {
      e.preventDefault();
      // setOpenTerminal((v) => !v);
    }
    if ((e.ctrlKey || e.metaKey) && e.key === ",") {
      e.preventDefault();
      setSettingsSection(null);
      setSettingsOpen(true);
    }
    // Ctrl+Tab / Ctrl+Shift+Tab: cycle through open editor tabs.
    if (e.ctrlKey && e.key === "Tab") {
      e.preventDefault();
      const tabs = editorTabsRef.current;
      if (tabs.length > 1) {
        const idx = tabs.findIndex((t) => t.path === activeEditorRef.current);
        const next = e.shiftKey
          ? tabs[(idx - 1 + tabs.length) % tabs.length]
          : tabs[(idx + 1) % tabs.length];
        if (next) setActiveEditorPath(next.path);
      }
    }
  });

  useEffect(() => {
    mountedRef.current = true;
    window.addEventListener("keydown", onGlobalKey);
    return () => window.removeEventListener("keydown", onGlobalKey);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [s, sess, activeId, ui] = await Promise.all([
        loadSettings(),
        loadSessions(),
        loadActiveSessionId(),
        loadUiSettings(),
      ]);
      if (cancelled) return;

      setSettings(s);
      setUiSettings(ui);
      setActiveLanguage(ui.language);
      setRecentFiles(getRecentFiles());
      setRecentFolders(getRecentFolders());

      // If we have saved sessions, restore the active one (or the most recent).
      if (sess.length > 0) {
        setSessions(sess);
        const target = activeId
          ? sess.find((x) => x.id === activeId)
          : undefined;
        const session = target ?? sess[0];
        if (session) {
          setActiveSessionId(session.id);
          setMessages(sanitizeHistory(session.messages));
        }
      }

      setRestored(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Browser build only. In the desktop app the deep-link hook owns OAuth
  // callbacks (tokens arrive via `agenticcoder://`, never in the webview URL),
  // so this is a fast no-op there; see useDeepLinkAuth() below.
  useEffect(() => {
    if (isNativeRuntime()) return;
    if (!isSupabaseConfigured) return;
    void handleOAuthRedirect();
  }, []);

  // VS Code style sign-in: `agenticcoder://auth/callback` lands here, the
  // session is restored, onAuthChanged fires and bootstrapCloud refreshes.
  useDeepLinkAuth();

  // ── Cloud bootstrap ───────────────────────────────────────────────────────
  // Runs once after local restore: if the user is signed in, pull their cloud
  // chats/settings and merge them over the local snapshot (newer updatedAt wins
  // per chat). If the cloud is empty (first sign-in) this device's data seeds
  // the account instead.
  const bootstrapCloud = async () => {
    if (!isSupabaseConfigured) {
      setAccountLoading(false);
      return;
    }
    setAccountLoading(true);
    // Never hang on "Checking your session…": any single Supabase step that
    // stalls (dead webview TLS, paused project, missing table) previously
    // left the Account tab on the loading placeholder forever with no error.
    // (Promise.race helper is inlined without generics — `<T>` syntax breaks
    // the .tsx parser inside this component.)
    const withTimeout = (p: Promise<any>, ms: number, label: string): Promise<any> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + " timed out after " + ms / 1000 + "s")), ms);
      });
      return Promise.race([p, timeout]).finally(() => {
        if (timer) clearTimeout(timer);
      });
    };
    try {
      const user = (await withTimeout(getCurrentUser(), 20000, "Session check")) as Awaited<
        ReturnType<typeof getCurrentUser>
      >;
      setAccount(user);
      if (!user) {
        setAccountProfile(null);
        byok.clearMemoryKeys();
        return;
      }
      const profile = (await withTimeout(getProfile(), 20000, "Profile load")) as Awaited<
        ReturnType<typeof getProfile>
      >;
      setAccountProfile(profile);
      const snapshot = (await withTimeout(cloudSync.loadAll(), 25000, "Cloud sync")) as Awaited<
        ReturnType<typeof cloudSync.loadAll>
      >;
      if (snapshot.settings) {
        // Cloud rows NEVER carry the API key — fetchSettings() returns
        // apiKey: "" on purpose (BYOK keys are account-only). Preserve the live
        // in-memory key here, otherwise a token-refresh sign-in silently blanks
        // the provider credential and kills an in-flight streaming turn before
        // the agent reaches its tool loop (which reads as "key unbound" +
        // "tools unavailable").
        //
        // Merge like the chats above — newer updatedAt wins — instead of
        // blindly adopting the cloud row. A stale row (an upsert that failed,
        // an edit made while signed out, an app closed inside the 250ms save
        // debounce) used to overwrite local settings on EVERY launch and auth
        // event, which is why the model id kept reverting while the
        // account-fetched BYOK key always survived. A device with no saved row
        // still seeds from the cloud; a legacy local row with no stamp beats
        // any cloud row rather than risk another silent revert.
        const cloud = snapshot.settings!;
        const hasLocal = await hasSavedSettings();
        setSettings((prev) => {
          if (!cloud.model) return prev; // never adopt an empty model
          if (!hasLocal) return { ...cloud, apiKey: prev.apiKey }; // fresh device
          const cloudAt = Date.parse(cloud.updatedAt ?? "");
          const localAt = Date.parse(prev.updatedAt ?? "");
          const cloudNewer =
            Number.isFinite(cloudAt) && Number.isFinite(localAt) && cloudAt > localAt;
          return cloudNewer ? { ...cloud, apiKey: prev.apiKey } : prev;
        });
      }
      if (snapshot.chats.length > 0) {
        setSessions((prev) => {
          const map = new Map(prev.map((s) => [s.id, s]));
          for (const c of snapshot.chats) {
            const local = map.get(c.id);
            if (!local || c.updatedAt > local.updatedAt) map.set(c.id, c);
            // Remember cloud timestamps so the save-effect doesn't re-upload them.
            cloudPushedAtRef.current.set(c.id, Math.max(c.updatedAt, local?.updatedAt ?? 0));
          }
          return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt);
        });
      } else {
        // First sign-in on a fresh account: seed the cloud from this device.
        const [localSessions, localSettings] = await Promise.all([loadSessions(), loadSettings()]);
        if (localSessions.length > 0) {
          void cloudSync.upsertChats(localSessions);
          for (const s of localSessions) cloudPushedAtRef.current.set(s.id, s.updatedAt);
        }
        void cloudSync.upsertSettings(localSettings);
      }
    } catch (e) {
      // A stall/timeout here used to leave the Account tab on "Checking your
      // session…" forever (finally still clears the flag, but nobody saw WHY).
      console.warn("[auth] Cloud bootstrap failed:", e instanceof Error ? e.message : e);
    } finally {
      setAccountLoading(false);
    }
  };

  useEffect(() => {
    if (!restored) return;
    // Defer the initial bootstrap off the effect body (no setState-in-effect).
    const boot = window.setTimeout(() => void bootstrapCloud(), 0);
    // Live subscription: refresh account state on sign-in/out from any window.
    const off = onAuthChanged((user) => {
      setAccount(user);
      if (!user) {
        setAccountProfile(null);
        byok.clearMemoryKeys();
      } else {
        void bootstrapCloud();
      }
    });
    const unlistenAuthBroadcast = listen(AUTH_CHANGED_EVENT, () => {
      void bootstrapCloud();
    });
    return () => {
      window.clearTimeout(boot);
      off();
      void unlistenAuthBroadcast.then((unlisten) => unlisten());
    };
  }, [restored]);

  /** Re-read account + profile (called after Account-tab edits). */
  const refreshAccount = async () => {
    if (!isSupabaseConfigured) return;
    setAccountLoading(true);
    try {
      const user = await getCurrentUser();
      setAccount(user);
      setAccountProfile(user ? await getProfile() : null);
      if (!user) byok.clearMemoryKeys();
    } finally {
      setAccountLoading(false);
    }
  };

  // ── BYOK key injection ─────────────────────────────────────────────────────
  // The API key is never persisted with settings — it is resolved at runtime
  // from the encrypted account store. Keys belong to the account, so there is
  // no signed-out fallback and an unknown profile resolves to "no key".
  useEffect(() => {
    if (!restored) return;
    let cancelled = false;
    void byok
      .resolveApiKey(settings.provider, signedIn, accountProfile?.byokEnabled ?? false)
      .then((key) => {
        if (cancelled) return;
        setSettings((prev) => ({ ...prev, apiKey: key }));
      })
      .catch((e) => {
        console.error("Failed to resolve API key:", e);
      });
    return () => {
      cancelled = true;
    };
  }, [settings.provider, signedIn, accountProfile?.byokEnabled, restored]);

  useEffect(() => {
    if (!restored) return;
    const t = setTimeout(() => {
      saveSettings(settings);
      // Mirror AI settings to the account (API key excluded — BYOK is separate).
      if (signedIn) void cloudSync.upsertSettings(settings);
    }, 250);
    return () => clearTimeout(t);
  }, [settings, restored, signedIn]);

  // Persist sessions whenever they change.
  useEffect(() => {
    if (!restored) return;
    const t = setTimeout(() => {
      saveSessions(sessions);
      // Push only chats that changed since the last cloud push.
      if (signedIn) {
        const changed = sessions.filter(
          (s) => (cloudPushedAtRef.current.get(s.id) ?? 0) < s.updatedAt
        );
        if (changed.length > 0) {
          for (const s of changed) cloudPushedAtRef.current.set(s.id, s.updatedAt);
          void cloudSync.upsertChats(changed);
        }
      }
    }, 250);
    return () => clearTimeout(t);
  }, [sessions, restored, signedIn]);

  // Persist active session id.
  useEffect(() => {
    if (!restored) return;
    const t = setTimeout(() => {
      saveActiveSessionId(activeSessionId);
    }, 250);
    return () => clearTimeout(t);
  }, [activeSessionId, restored]);

  // Apply UI settings to the document immediately, then persist (debounced).
  useEffect(() => {
    applyUiSettings(uiSettings);
  }, [uiSettings]);
  useEffect(() => {
    if (!restored) return;
    const t = setTimeout(() => {
      void saveUiSettings({ ...uiSettings, language: getActiveLanguage() });
    }, 250);
    return () => clearTimeout(t);
  }, [uiSettings, restored]);

  /** Merge a patch into UI settings (Settings tab writes here). */
  const updateUiSettings = (patch: Partial<UiSettings>) => {
    if (patch.language !== undefined && Object.keys(patch).length === 1) {
      setActiveLanguage(patch.language);
      void saveUiSettings({ ...uiSettings, language: patch.language });
      return;
    }
    setUiSettings((prev) => ({ ...prev, ...patch, language: getActiveLanguage() }));
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

  // Keep the active session's messages in sync with the sessions list.
  useEffect(() => {
    if (!restored || !activeSessionId) return;
    const t = setTimeout(() => {
      setSessions((prev) => {
        const existing = prev.find((s) => s.id === activeSessionId);
        if (!existing) return prev;
        const updated: ChatSession = {
          ...existing,
          messages,
          updatedAt: Date.now(),
          title: existing.title !== "Untitled chat" ? existing.title : deriveTitle(messages),
          settings: existing.settings ?? settings,
        };
        return prev.map((s) => (s.id === activeSessionId ? updated : s));
      });
    }, 250);
    return () => clearTimeout(t);
  }, [messages, activeSessionId, restored, settings]);





  // Keep the chat pinned to the bottom while the user hasn't scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (autoScrollRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isLoading]);

  useEffect(() => {
    // Abort any in-flight stream when the component unmounts.
    return () => {
      streamControllerRef.current?.abort();
    };
  }, []);

  const handleSaveSettings = (next: AISettings) => {
    setSettings(next);
    void saveSettings(next);

    // Persist the settings into the active session so each chat tab
    // remembers which AI it was using.
    if (activeSessionId) {
      setSessions((prev) =>
        prev.map((s) => (s.id === activeSessionId ? { ...s, settings: next } : s))
      );
    }
  };

  const handleSelectLocalModel = async (modelName: string): Promise<string | null> => {
    // Make sure an Ollama server is actually up before switching to it. This
    // reuses the app's own server or an external one already on port 11434,
    // or starts a fresh one — instead of silently pointing chat at a server
    // that may have died (the old overlap bug).
    const serverErr = await ensureOllamaReady();

    // Switch to the Ollama provider and set the selected local model.
    const next: AISettings = {
      ...settings,
      provider: "ollama",
      model: modelName,
      baseUrl: "http://127.0.0.1:11434",
      apiKey: "",
      // Clear any potentially conflicting system prompts when switching to a local tool-model
    };
    setSettings(next);
    void saveSettings(next);

    // Remember the local model choice for the active session too.
    if (activeSessionId) {
      setSessions((prev) =>
        prev.map((s) => (s.id === activeSessionId ? { ...s, settings: next } : s))
      );
    }

    return serverErr;
  };

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    // Consider "at bottom" when within 80px of the scroll bottom.
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  /** Append to the trailing assistant placeholder's content (used while streaming). */
  const setLastAssistantContent = (content: string) => {
    if (!mountedRef.current) return;
    setMessages((prev) => {
      if (prev.length === 0 || prev[prev.length - 1].role !== "assistant") {
        // No assistant bubble present — add one (e.g. non-stream fallback).
        return [...prev, { role: "assistant", content }];
      }
      const copy = [...prev];
      copy[copy.length - 1] = { ...copy[copy.length - 1], content };
      return copy;
    });
  };

  // Network providers can deliver dozens of tiny deltas per frame. Coalesce
  // those updates so markdown parsing and the rest of the chat shell do not
  // rerender for every token.
  //
  // The expensive part is `stripToolCalls`: it scans the *whole* accumulated
  // text for tool-call markup, so running it per delta makes a stream cost
  // O(n²) in the number of characters (a 32k-char answer took ~360ms of pure
  // CPU). Rendering is already throttled to one update per 50ms, so we do
  // the stripping there too — the visible result is identical, but the work is
  // now proportional to the number of *renders*, not the number of deltas.
  const scheduleStreamingAssistantContent = (raw: string) => {
    if (!mountedRef.current) return;
    const state = streamRenderRef.current;
    state.pending = raw;
    if (state.timer !== null) return;
    state.timer = window.setTimeout(() => {
      state.timer = null;
      const pending = state.pending;
      state.pending = "";
      if (!pending) return;
      const shown = stabilizeStreamingMarkdown(stripToolCalls(pending));
      streamedContentRef.current = shown;
      setLastAssistantContent(shown);
    }, 50);
  };

  // Flush any pending render immediately. `runId` identifies the streaming run
  // that is flushing. A run that has been superseded (a newer run already
  // started) must not render its text into the newer run's bubble.
  const flushStreamingAssistantContent = (runId?: number) => {
    const state = streamRenderRef.current;
    if (runId !== undefined && runId !== streamRunRef.current) {
      // This run has been superseded — leave the newer run's state alone.
      return;
    }
    if (state.timer !== null) {
      window.clearTimeout(state.timer);
      state.timer = null;
    }
    if (state.pending) {
      const pending = state.pending;
      state.pending = "";
      const shown = stabilizeStreamingMarkdown(stripToolCalls(pending));
      streamedContentRef.current = shown;
      setLastAssistantContent(shown);
    }
  };

  /** Remove any trailing empty assistant bubble (used for errors / aborts). */
  const removeEmptyAssistant = () => {
    if (!mountedRef.current) return;
    setMessages((prev) => {
      if (prev.length === 0 || prev[prev.length - 1].role !== "assistant") return prev;
      if (prev[prev.length - 1].content.trim().length > 0) return prev;
      return prev.slice(0, -1);
    });
  };

  // Invalidate the in-flight streaming run: it must not write anything into
  // the chat anymore (used when the chat is cleared or a session is switched).
  const invalidateStreamingRun = () => {
    streamRunRef.current++;
    if (streamRenderRef.current.timer !== null) {
      window.clearTimeout(streamRenderRef.current.timer);
      streamRenderRef.current.timer = null;
    }
    streamRenderRef.current.pending = "";
    streamRawRef.current = "";
    streamedContentRef.current = "";
  };

  const stopChat = () => {
    // Abort the in-flight request. The stream loop detects the abort and
    // finalizes whatever content we collected so far. The run is *not*
    // invalidated here — the partial output must still be committed.
    streamControllerRef.current?.abort();
    setIsLoading(false);
  };

  const newChat = () => {
    streamControllerRef.current?.abort();
    // The run must not write into the cleared chat.
    invalidateStreamingRun();
    // Resolve any in-flight approval so the tool loop unwinds instead of
    // hanging on a promise that will never be settled.
    approvalRef.current?.resolve(false);
    approvalRef.current = null;
    setPendingApproval(null);
    // The activity feed is per-conversation, not global — clear it with the
    // messages or the previous run's tool rows linger in the new chat.
    setActivities([]);
    setMessages([]);
    setCtxReported(0);
    setError(null);
    setActiveSessionId(null);
    setIsLoading(false);
  };

  const selectSession = (id: string) => {
    streamControllerRef.current?.abort();
    // The run must not write into the session we are switching to.
    invalidateStreamingRun();
    approvalRef.current?.resolve(false);
    approvalRef.current = null;
    setPendingApproval(null);
    const session = sessions.find((s) => s.id === id);
    if (!session) return;
    setActiveSessionId(id);
    // Activity rows are not persisted per session, so they must be dropped
    // on switch too — otherwise the previous chat's tool feed shows up here.
    setActivities([]);
    setMessages(sanitizeHistory(session.messages));
    setCtxReported(0);
    // Restore the AI provider/model this tab was using (fall back to global).
    if (session.settings) {
      setSettings(session.settings);
    }
    setError(null);
    setIsLoading(false);
  };

  const deleteSession = (id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    // Remove it from the account too.
    if (signedIn) void cloudSync.deleteChat(id);
    if (activeSessionId === id) {
      setActiveSessionId(null);
      setActivities([]);
      setPendingApproval(null);
      setMessages([]);
      setCtxReported(0);
    }
  };

  useEffect(() => {
    const syncRoot = () => {
      const root = localStorage.getItem(SHARED_WS_KEY);
      if (root) setWorkspaceRoot((prev) => (prev === root ? prev : root));
    };
    syncRoot();
    window.addEventListener("focus", syncRoot);
    window.addEventListener("storage", syncRoot);
    return () => {
      window.removeEventListener("focus", syncRoot);
      window.removeEventListener("storage", syncRoot);
    };
  }, []);

  /** Max simultaneously open editor tabs (LRU-evicted beyond this). */
  const MAX_OPEN_TABS = 10;

  const openFileInEditor = async (path: string) => {
    setActiveEditorPath(path);
    if (editorTabs.some((t) => t.path === path)) return;
    try {
      const content = await invoke<string>("fs_read_file", { path });
      setRecentFiles(pushRecentFile(path));
      setEditorTabs((prev) => {
        if (prev.some((t) => t.path === path)) return prev;
        let next: EditorTab[] = [...prev, { path, content, dirty: false }];
        // LRU cap: evict oldest clean tabs so the pane never fills with
        // every file ever opened.
        while (next.length > MAX_OPEN_TABS) {
          const evictIdx = next.findIndex((t) => !t.dirty && t.path !== path);
          if (evictIdx === -1) break;
          next = next.filter((_, i) => i !== evictIdx);
        }
        return next;
      });
    } catch (e) {
      setError(t("app.failedToOpen", { path, error: e instanceof Error ? e.message : String(e) }));
    }
  };


  /** Open a workspace folder — the agent reads/writes inside it. */
  const openWorkspaceFolder = async () => {
    const picked = await openDialog({ title: t("app.openFolder"), directory: true });
    if (!picked.length) return; // user cancelled
    const root = picked[0];
    localStorage.setItem(SHARED_WS_KEY, root);
    setWorkspaceRoot(root);
  };

  // Late-bound so the Ctrl+Shift+E shortcut registered above always calls the
  // current closure.
  useLayoutEffect(() => {
    openWorkspaceRef.current = () => void openWorkspaceFolder();
  });

  /** Persist the active tab back to disk via the Tauri fs command. */
  // Declared as a hoisted function so effects above (auto-save, shortcuts)
  // can reference it without a use-before-declaration violation.
  async function saveEditorFile(path: string) {
    const tab = editorTabs.find((t) => t.path === path);
    if (!tab) return;
    try {
      await invoke("fs_write_file", { path, content: tab.content });
      setEditorTabs((prev) =>
        prev.map((t) => (t.path === path ? { ...t, dirty: false } : t))
      );
    } catch (e) {
      setError(t("app.failedToSave", { path, error: e instanceof Error ? e.message : String(e) }));
    }
  }

  // Mirror of editorTabs for use inside intervals / async callbacks.
  const editorTabsRef = useRef<EditorTab[]>([]);
  useLayoutEffect(() => {
    editorTabsRef.current = editorTabs;
  });

  // Ref mirror of the focused tab path for the async agent loop. Set via an
  // effect so we never write refs during render.
  const activeEditorRef = useRef<string | null>(null);
  useEffect(() => {
    activeEditorRef.current = activeEditorPath;
  }, [activeEditorPath]);

  const syncTabWithDisk = async (path: string) => {
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
  };

  /** Refresh every open tab from disk. */
  const syncAllOpenTabs = () => {
    for (const t of editorTabsRef.current) void syncTabWithDisk(t.path);
  };
  // Ref indirection so intervals and the tool loop always call the latest closure.
  const syncAllOpenTabsRef = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    syncAllOpenTabsRef.current = syncAllOpenTabs;
  });

  /** Approve a pending destructive tool call. */
  const handleApproveTool = (id: string) => {
    const pending = approvalRef.current;
    if (!pending || pending.id !== id) return;
    setPendingApproval(null);
    approvalRef.current = null;
    pending.resolve(true);
  };

  /** Deny a pending destructive tool call. */
  const handleDenyTool = (id: string) => {
    const pending = approvalRef.current;
    if (!pending || pending.id !== id) return;
    setPendingApproval(null);
    approvalRef.current = null;
    pending.resolve(false);
  };

  /** Ask the user to approve a destructive tool call. */
  const requestApproval = (id: string): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      approvalRef.current?.resolve(false); // resolve any stale dialog
      approvalRef.current = { id, resolve };
    });

  const streamRound = async (
    history: Message[],
    agentic: boolean,
    signal: AbortSignal,
    promptSuffix = "",
        mcpTools?: Map<string, McpToolEntry>,
    modelOverride?: { provider: ProviderId; model: string },
    runId?: number,
  ): Promise<StreamRoundResult> => {
    const effectiveSettings: AISettings = {
      ...settings,
      ...(modelOverride
        ? { provider: modelOverride.provider, model: modelOverride.model }
        : {}),
      ...(agentic
        ? {
            systemPrompt: `${settings.systemPrompt}

${AGENTIC_PROMPT}${settings.toolAllowance === "read-only" ? `

Tool allowance: Read Only. Only inspect or search; do not attempt to modify files, run commands, or use MCP tools not explicitly declared read-only.` : ""}${promptSuffix ? `

${promptSuffix}` : ""}`,
          }
        : settings.toolAllowance === "none"
          ? {
              systemPrompt: `${settings.systemPrompt}

Tool allowance: No Tools Allowed. Do not attempt to use tools or claim to have used them. Answer only from the conversation and supplied context.`,
            }
          : {}),
    };
    const s = getProviderSpec(effectiveSettings);
    const endpoint = s.buildUrl(effectiveSettings);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...buildAuthHeaders(s, effectiveSettings.apiKey),
    };

    const additionalTools = mcpTools
      ? [...mcpTools.entries()].map(([name, tool]) => ({
          name,
          description: tool.description ?? `MCP tool ${tool.tool}`,
          parameters:
            tool.schema && typeof tool.schema === "object"
              ? tool.schema
              : { type: "object", properties: {}, required: [] },
        }))
      : undefined;
    const body = s.buildBody(effectiveSettings, history, {
      enableTools: agentic,
      additionalTools,
      maxOutputTokens: effortTokensRef.current,
    });

    // Token budget guard — pause the run before spending when a configured
    // limit (Settings → Dashboard) would be exceeded by this request.
    const limitErr = checkRateLimit(estimateTokens(JSON.stringify(body)));
    if (limitErr) throw new Error(limitErr);

    // Use the signal from sendMessage so cancellation is handled by a single
    // source of truth (no separate per-round AbortController).
    let res: Response;
    try {
      res = await platformFetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (netErr) {
      if (signal.aborted) {
        throw new Error("__ABORTED__", { cause: netErr });
      }
      throw new Error(
        `Could not connect to ${endpoint}: ${
          netErr instanceof Error ? netErr.message : String(netErr)
        }`,
        { cause: netErr }
      );
    }

    if (signal.aborted) throw new Error("__ABORTED__");

    if (!res.ok) {
      let detail: string = `HTTP ${res.status} ${res.statusText}`;
      try {
        const text = await res.text();
        if (text) {
          const trimmed = text.trim();
          // If the server returned HTML (e.g. a website instead of an API),
          // don't dump the whole page — show a concise message instead.
          if (trimmed.startsWith("<") || trimmed.toLowerCase().includes("<!doctype")) {
            detail = `The server returned an HTML page (not an API response). Check that the base URL points to a valid AI API endpoint, not a website.`;
          } else {
            try {
              const parsed = JSON.parse(trimmed) as JsonDict;
              const errMsg = parsed?.error as JsonDict | undefined;
              detail =
                (errMsg?.message as string) ||
                (parsed?.message as string) ||
                trimmed;
            } catch {
              detail = trimmed.length > 500 ? trimmed.slice(0, 500) + "…" : trimmed;
            }
          }
        }
      } catch {
        /* keep the status-based detail */
      }
      let msg = `API error (${res.status}): ${detail}`;
      if (res.status === 401 || res.status === 403) {
        msg += ` ${s.authErrorHint(res.status, settings)}`;
      }

      // Self-healing retries for two recoverable 400s:
      //  1. Google thinking models — a missing thought_signature means replayed
      //     functionCall parts lack the opaque signature the model originally
      //     returned (turns saved before signature capture existed). The
      //     signature is unrecoverable, so retry with tool-call turns
      //     downgraded to plain text.
      //  2. Local models that reject native tools outright (Ollama: "<model>
      //     does not support tools"). Remember the model for this session —
      //     buildBody omits `tools` for it from now on — and retry without
      //     native tools; the agent loop still runs on the text-based tool
      //     protocol (parseToolCalls below).
      const sigHeal = res.status === 400 && /thought[_ ]?signature/i.test(detail);
      const noToolsHeal = res.status === 400 && /does not support tools/i.test(detail);
      if (sigHeal || noToolsHeal) {
        if (noToolsHeal) markNoNativeTools(effectiveSettings);
        const retryBody = s.buildBody(effectiveSettings, history, {
          enableTools: noToolsHeal ? false : agentic,
          additionalTools,
          maxOutputTokens: effortTokensRef.current,
          ...(sigHeal ? { forceTextTools: true } : {}),
        });
        const retryRes = await platformFetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(retryBody),
          signal,
        });
        if (!retryRes.ok) {
          let retryDetail: string = `HTTP ${retryRes.status} ${retryRes.statusText}`;
          try {
            const text = await retryRes.text();
            if (text.trim() && !text.trim().startsWith("<")) {
              try {
                const parsed = JSON.parse(text.trim()) as JsonDict;
                const errMsg = parsed?.error as JsonDict | undefined;
                retryDetail = (errMsg?.message as string) || text.trim().slice(0, 500);
              } catch {
                retryDetail = text.trim().slice(0, 500);
              }
            }
          } catch {
            /* keep status-based detail */
          }
          throw new Error(`API error (${retryRes.status}): ${retryDetail}`);
        }
        if (signal.aborted) throw new Error("__ABORTED__");
        res = retryRes;
      } else {
        throw new Error(msg);
      }
    }

    const bodyStream = res.body;
    let usageIn = 0;
    let usageOut = 0;
    let sawUsage = false;
    if (!bodyStream) {
      const data = (await res.json().catch(() => null)) as JsonDict | null;
      const acc0: NativeToolAcc[] = [];
      if (data) {
        ingestNativeChunk(data, acc0);
        const u = s.extractUsage?.(data);
        if (u && (u.input != null || u.output != null)) {
          usageIn = u.input ?? 0;
          usageOut = u.output ?? 0;
          sawUsage = true;
        }
        const text = s.extractContent(data);
        // No stream to read: the whole response arrives at once. Render it
        // through the same raw -> visible pipeline so it is not lost.
        if (text && runId === streamRunRef.current) {
          scheduleStreamingAssistantContent(streamRawRef.current + text);
        }
        void recordUsage(
          settings.provider,
          settings.model,
          sawUsage && usageIn > 0 ? usageIn : estimateTokens(JSON.stringify(body)),
          sawUsage && usageOut > 0 ? usageOut : estimateTokens(text)
        );
        return {
          text,
          nativeCalls: nativeAccToCalls(acc0),
          usageIn: sawUsage && usageIn > 0 ? usageIn : 0,
        };
      }
      return { text: "", nativeCalls: [] };
    }

    const reader = bodyStream.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let round = "";
    // Raw text of the previous rounds. The visible text is derived from it by
    // stripToolCalls, which now runs once per rendered frame rather than once
    // per delta — so we must keep the *raw* text here, not the stripped one.
    const base = streamRawRef.current;
    const nativeAcc: NativeToolAcc[] = [];

    try {
      while (!signal.aborted) {
        let step: { done: boolean; value?: Uint8Array };
        try {
          step = await reader.read();
        } catch (e) {
          if (signal.aborted) break;
          throw e;
        }
        if (step.done) break;

        buffer += decoder.decode(step.value, { stream: true });
        const lines = buffer.split(NL);
        buffer = lines.pop() ?? "";

        for (const raw of lines) {
          let line = raw.trim();
          if (!line) continue;
          if (line.startsWith("data:")) line = line.slice(5).trim();
          if (!line) continue;
          if (line === "[DONE]") continue;
          if (line.startsWith(":")) continue;
          try {
            const json = JSON.parse(line) as Record<string, unknown>;
            // Accumulate native function-calling chunks so tool-only rounds
            // are not lost when no text deltas are emitted.
            ingestNativeChunk(json, nativeAcc);
            const u = s.extractUsage?.(json);
            if (u && (u.input != null || u.output != null)) {
              // Counters are cumulative (Anthropic `message_start`/`message_delta`,
              // Google's per-chunk `usageMetadata`, OpenAI's final `include_usage`
              // chunk), so keep the latest reading instead of summing — summing
              // would multiply the total by every chunk that carried it.
              if (u.input != null) usageIn = u.input;
              if (u.output != null) usageOut = u.output;
              sawUsage = true;
            }
            const delta = s.extractDelta(json);
            if (delta) {
              round += delta;
              // Hand the *raw* text to the renderer; it strips tool markup
              // once per throttled frame instead of once per delta.
              if (runId === streamRunRef.current) {
                scheduleStreamingAssistantContent(base + round);
              }
            }
          } catch {
            continue;
          }
        }
      }
      buffer += decoder.decode();
      // Some providers close the response without a trailing newline.
      if (buffer.trim() && !signal.aborted) {
        let line = buffer.trim();
        if (line.startsWith("data:")) line = line.slice(5).trim();
        if (line && line !== "[DONE]") {
          try {
            const json = JSON.parse(line) as Record<string, unknown>;
            ingestNativeChunk(json, nativeAcc);
            const delta = s.extractDelta(json);
            if (delta) {
              round += delta;
              // Hand the *raw* text to the renderer; it strips tool markup
              // once per throttled frame instead of once per delta.
              if (runId === streamRunRef.current) {
                scheduleStreamingAssistantContent(base + round);
              }
            }
          } catch {
            // Ignore an incomplete non-JSON trailer.
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (!round && nativeAcc.length === 0 && !signal.aborted) {
      try {
        const nonStreamBody = {
          ...(s.buildBody(effectiveSettings, history, {
            enableTools: agentic,
            additionalTools,
            maxOutputTokens: effortTokensRef.current,
          }) as Record<string, unknown>),
          stream: false,
        } as Record<string, unknown>;
        // Google uses a different URL for streaming vs. non-streaming.
        const nonStreamUrl = endpoint.includes("streamGenerateContent")
          ? endpoint.replace("streamGenerateContent", "generateContent")
          : endpoint;
        const fallbackRes = await platformFetch(nonStreamUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(nonStreamBody),
          signal,
        });
        if (fallbackRes.ok) {
          const data = (await fallbackRes.json().catch(() => null)) as JsonDict | null;
          if (data) {
            round = s.extractContent(data);
            ingestNativeChunk(data, nativeAcc);
            const u = s.extractUsage?.(data);
            if (u && (u.input != null || u.output != null)) {
              usageIn = u.input ?? 0;
              usageOut = u.output ?? 0;
              sawUsage = true;
            }
            // The non-streaming response never went through a delta, so render
            // it here. It goes through the same raw -> visible pipeline, which
            // strips tool markup and stabilizes the markdown.
            if (round && runId === streamRunRef.current) {
              scheduleStreamingAssistantContent(base + round);
            }
          }
        }
      } catch {
        /* stream error — keep whatever we have (may be empty) */
      }
    }

    if (!signal.aborted) {
      void recordUsage(
        settings.provider,
        settings.model,
        sawUsage && usageIn > 0 ? usageIn : estimateTokens(JSON.stringify(body)),
        sawUsage && usageOut > 0 ? usageOut : estimateTokens(round)
      );
    }
    return {
      text: round,
      nativeCalls: nativeAccToCalls(nativeAcc),
      usageIn: sawUsage && usageIn > 0 ? usageIn : 0,
    };
  };

  const sendMessage = async (overrideText?: string) => {
    const trimmed = (overrideText ?? message).trim();
    if (!trimmed || isLoading) return;

    // --- Fail-fast validation BEFORE touching the in-flight stream. ---
    const s = getProviderSpec(settings);
    if (s.needsAuth) {
      const trimmedKey = settings.apiKey.trim();
      if (!trimmedKey) {
        setError(
          signedIn
            ? t("app.noApiKey", { provider: s.label })
            : t("app.signInForApiKey", { provider: s.label })
        );
        return;
      }
      const authErr = s.validateAuth(trimmedKey);
      if (authErr) {
        setError(authErr);
        return;
      }
    }

    const base = settings.baseUrl.trim().replace(/\/+$/, "");
    if (!base) {
      setError(t("app.baseUrlEmpty"));
      return;
    }

    // The activity feed is per-run and is intentionally NOT cleared on send —
    // tool usage rows should stay visible until the user dismisses each row.
    streamControllerRef.current?.abort();
    streamControllerRef.current = null;

    setError(null);
    setMessage("");

    // If there's no active session, create one for this new conversation.
    // Snapshot the current AI settings so this tab remembers its model.
    if (!activeSessionId) {
      const newId = generateSessionId();
      const now = Date.now();
      const newSession: ChatSession = {
        id: newId,
        title: t("app.untitledChat"),
        messages: [],
        createdAt: now,
        updatedAt: now,
        settings,
      };
      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(newId);
    }

    // Optimistically render the user message and a streaming assistant bubble.
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: trimmed,
      },
    ]);
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    // Provider conversation for this agentic run.
    const agentHistory: Message[] = [
      ...sanitizeHistory(messages),
      { role: "user", content: trimmed },
    ];

    const toolAllowance = settings.toolAllowance ?? "all";
    const agentic = shouldUseAgenticMode(trimmed) && toolAllowance !== "none";
    const activeEditorAtSend = activeEditorRef.current;

    // Build the agent's environment suffix: a high-level project map,
    // open tabs, and any MCP tools exposed by enabled servers.
    let promptSuffix = "";
    const mcpDiscovery = agentic
      ? Promise.all(
          loadMcpServers()
            .filter((s) => s.enabled)
            .map(async (s) => {
              try {
                return { server: s, tools: await listMcpTools(s), error: null };
              } catch (error) {
                return {
                  server: s,
                  tools: [],
                  error: error instanceof Error ? error.message : String(error),
                };
              }
            })
        )
      : Promise.resolve([]);
    if (agentic && workspaceRoot) {
      try {
        const projectMap = await getProjectContext(workspaceRoot);
        promptSuffix += `${projectMap}\n\n`;
      } catch {
        /* fallback to simple listing if indexing fails */
        try {
          const entries = await invoke<FsEntry[]>("fs_list_dir", { path: workspaceRoot });
          const names = entries.map((e) => (e.is_dir ? `${e.name}/` : e.name));
          promptSuffix += `Workspace root: ${workspaceRoot}\nEntries: ${names.slice(0, 25).join(", ")}\n`;
        } catch {
          /* no listing available — continue without it */
        }
      }
    }

    let userFileNote = "";
    if (agentic) {
      const rel = (p: string): string =>
        workspaceRoot && p.startsWith(workspaceRoot)
          ? p.slice(workspaceRoot.length).replace(/^[\\/]+/, "")
          : p;
      const openTabs = editorTabsRef.current;
      if (openTabs.length > 0) {
        promptSuffix += `\n\nOpen editor tabs: ${openTabs.map((t) => rel(t.path)).join(", ")}`;
        const activeTab = openTabs.find((t) => t.path === activeEditorAtSend) ?? null;
        if (activeTab) {
          const dirOf = (p: string): string => {
            const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
            return i > 0 ? p.slice(0, i) : p;
          };
          promptSuffix += `\nThe ACTIVE file the user is viewing: ${rel(activeTab.path)} (folder: ${dirOf(activeTab.path)}). Treat references to "this file" or "the current file" as this one. All relative paths resolve against this folder. Work ONLY on this file — do NOT browse, describe, or summarize other files/folders unless explicitly asked.`;
          const MAX_INLINE = 8000;
          const bodyText =
            activeTab.content.length <= MAX_INLINE
              ? activeTab.content
              : `${activeTab.content.slice(0, MAX_INLINE)}\n...[truncated - call read_active_file or read_file for more]`;
          promptSuffix += `\n\nCurrent contents of ${rel(activeTab.path)}:\n${bodyText}\n(end of ${rel(activeTab.path)})`;
          userFileNote = `(Working file: ${rel(activeTab.path)} — its complete source is already in your system context above. Start analyzing it immediately; do not ask for it.)`;
        }
      } else if (workspaceRoot) {
        promptSuffix += `\n\nNo files are currently open in the editor. If the task is ambiguous, use list_dir or search_files to locate the right file before reading.`;
      } else if (homeRoot) {
        promptSuffix += `\n\nNo project folder is open — your default working directory is ${homeRoot}. Relative paths (like ".") resolve there; use absolute paths for anything outside it. You may list, read and search any folder the user asks about.`;
      }

      // Pinned files (from the Context menu) are injected verbatim so the
      // agent always has them available without needing to read them.
      if (pinnedPaths.length > 0) {
        const MAX_PINNED = 8000;
        for (const p of pinnedPaths) {
          const tab = editorTabsRef.current.find((t) => t.path === p);
          let content: string | null = tab ? tab.content : null;
          if (content == null) {
            try {
              content = await invoke<string>("fs_read_file", { path: p });
            } catch {
              content = null; // unreadable (deleted, binary, folder…) — skip
            }
          }
          if (content == null) continue;
          const capped =
            content.length <= MAX_PINNED
              ? content
              : `${content.slice(0, MAX_PINNED)}\n...[truncated — call read_file for more]`;
          promptSuffix += `\n\nPINNED FILE ${rel(p)}:\n${capped}\n(end of pinned ${rel(p)})`;
        }
        promptSuffix += `\n\nThe PINNED FILE sections above were explicitly attached by the user — treat them as primary context.`;
      }
    }

    // The annotated user message is what small models actually attend to.
    if (userFileNote) {
      const lastMsg = agentHistory[agentHistory.length - 1];
      if (lastMsg && lastMsg.role === "user") {
        lastMsg.content = `${lastMsg.content}\n\n${userFileNote}`;
      }
    }

    const mcpTools = new Map<string, McpToolEntry>();
    if (agentic) {
      const discoveries = await mcpDiscovery;
      for (const { server, tools, error } of discoveries) {
        for (const t of tools) {
          mcpTools.set(`mcp_${server.name}_${t.name}`, {
            server,
            tool: t.name,
            description: t.description,
            schema: t.inputSchema,
            readOnly: t.readOnly,
          });
        }
        if (error) {
          promptSuffix += `\nMCP server "${server.name}" is unavailable: ${error}. Do not claim its tools are available; continue with built-in tools or explain the connection error.`;
        }
      }
      if (mcpTools.size > 0) {
        promptSuffix += `

MCP tools available (call via {"name": "<full name>", "arguments": {...}}). Parameters marked (required) MUST be included in arguments or the call fails:
${[...mcpTools.entries()]
  .map(([k, m]) => {
    const sig = formatMcpToolSchema(m.schema);
    return sig ? `- ${k}\n  ${sig}` : `- ${k}`;
  })
  .join(NL)}

MCP call rules:
- If a call fails naming a missing argument (e.g. "datamodel_type is required", "studio_id is required"), re-call WITH that argument included.
- Tools needing id-style arguments (e.g. studio_id) get them from a discovery tool on the same server (e.g. list_roblox_studios) — call that first, then pass the id on every later call to that server.
- Batch independent calls together in one round (e.g. discovery + reads) to save round trips.`;
      }
    }

    setIsLoading(true);
    // Any run that is still unwinding must no longer touch the chat bubble.
    // This also drops any text/timer left pending by a previous run, so a
    // stale timer cannot fire into this run's bubble.
    invalidateStreamingRun();
    const runId = streamRunRef.current;

    const abortCtrl = new AbortController();
    streamControllerRef.current = abortCtrl;

    try {
      let ranTools = 0;
      let toolRounds = 0;
      let sawRawOutput = false;
      // Anti-haywire state: prose-nudges issued, and consecutive rounds whose
      // calls all failed with identical signatures.
      let nudgeCount = 0;
      let failStreak = 0;
      let lastFailSig = "";
      // Cumulative failures per tool NAME (across rounds). Catches models
      // that keep failing with *different* arguments (e.g. guessing news
      // site URLs one after another), which the identical-signature guard
      // below can never trip. A success resets the count, and hitting the
      // limit only BENCHES that tool — the rest of the turn continues.
      const toolFailCounts = new Map<string, number>();
      const TOOL_FAIL_LIMIT = 8;
      // If the model keeps calling benched tools despite the instruction to
      // stop, end the turn after this many extra attempts.
      const BANNED_TOOL_CALL_LIMIT = 3;
      const bannedTools = new Set<string>();
      let bannedToolCalls = 0;
      let totalFails = 0;
      let totalSuccesses = 0;
      // Budget checkpoints: each checkpoint refills the round budget so long
      // tasks never dead-end mid-run while they keep making progress.
      let checkpointsUsed = 0;
      let lastCheckpointSuccesses = 0;
      let totalRounds = 0;
      // Per-turn cache of read-only tool results. Weak models frequently
      // re-emit identical read calls in later rounds; serving them from cache
      // skips redundant filesystem work. Cleared whenever a mutating tool runs.
      const readOnlyCache = new Map<string, { ok: boolean; output: string; data?: unknown }>();

      while (!abortCtrl.signal.aborted) {
        const round = await streamRound(
          agentHistory,
          agentic,
          abortCtrl.signal,
          promptSuffix,
          mcpTools,
          undefined,
          runId
        );
        // Keep the raw text of every round so the next round can append to it
        // (the visible text is derived from this, never the other way round).
        // This happens *before* the abort check so the text of an aborted
        // round is still preserved for the final commit.
        if (runId === streamRunRef.current) {
          streamRawRef.current += round.text;
        }
        if (abortCtrl.signal.aborted) break;
        // Adopt the provider's exact context size for the pill/readout. The
        // conversation itself lives in `messages`, so this value follows it
        // across model switches; each new round just refreshes the number.
        if (round.usageIn && round.usageIn > 0) setCtxReported(round.usageIn);
        const raw = round.text;
        if (raw.trim().length > 0 || round.nativeCalls.length > 0) sawRawOutput = true;

        agentHistory.push({
          role: "assistant",
          content: raw,
          ...(round.nativeCalls.length > 0
            ? {
                toolCalls: round.nativeCalls.map((c, i) => ({
                  id: c.id ?? `call_${toolRounds}_${i}`,
                  name: c.name,
                  arguments: c.arguments,
                  thoughtSignature: c.thoughtSignature,
                })),
              }
            : {}),
        });

        const calls: { call: ToolCall; native: boolean; key: string }[] = [];
        const seenKeys = new Set<string>();
        for (const { call, native } of [
          ...(agentic ? round.nativeCalls.map((c) => ({ call: c, native: true })) : []),
          ...(agentic ? parseToolCalls(raw).map((c) => ({ call: c, native: false })) : []),
        ]) {
          if (!isToolName(call.name) && !call.name.startsWith("mcp_")) continue;
          const key = `${call.name}:${JSON.stringify(call.arguments)}`;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          calls.push({ call, native, key });
        }

        // If the model produced no tool calls, we're done.
        if (calls.length === 0) {
          // Recovery: weak local models often DESCRIBE tool calls in prose
          // ("Sure! Let's use the web_search function...") or emit an EMPTY
          // code fence instead of actually emitting a call. Nudge them to
          // emit a real block instead of ending.
          if (
            agentic &&
            nudgeCount < 2 &&
            /(\b(function call|tool call|tool_call|read_file|list_dir|search_files|web_search|web_fetch)\b|web search|search the web|fetch (the |this |that )?url|```|<[a-z_]+\s*\/?>|\b\w+_\w+\(\)|\bcall\s+(read|list|get|search)_|(?:can'?t|cannot|unable to|don't have|do not have).{0,30}\b(access|use|call).{0,20}\btools?\b)/i.test(raw)
          ) {
            nudgeCount++;
            // Tailor the example to what the user actually asked for: a web
            // question gets a web_search example (with their own message as
            // the query so it can be copied verbatim), otherwise list_dir.
            const wantsWeb =
              /(search|news|latest|web\b|internet|fetch|url|https?|weather|docs|documentation)/i.test(trimmed) ||
              /(web_search|web search|search the web|fetch\b)/i.test(raw);
            const example = wantsWeb
              ? `{"name": "web_search", "arguments": {"query": ${JSON.stringify(trimmed.slice(0, 140))}}}`
              : `{"name": "list_dir", "arguments": {"path": "."}}`;
            agentHistory.push({
              role: "user",
              content:
                `You claimed or described tool access but did not actually emit a call. You have real tools. Reply with EXACTLY ONE real tool-call block as your entire message:\n<tool_call>\n${example}\n</tool_call>\nNo prose, no code fences, no capability disclaimers.`,
            });
            continue;
          }
          break;
        }

        // Plain prose rounds (thinking out loud between calls) don't consume
        // the budget — only rounds that actually execute tools do.
        if (toolRounds >= MAX_TOOL_ROUNDS) {
          if (checkpointsUsed < MAX_CHECKPOINTS && totalSuccesses > lastCheckpointSuccesses) {
            // Still making progress — grant a fresh budget and keep working
            // instead of dead-ending mid-task.
            checkpointsUsed++;
            lastCheckpointSuccesses = totalSuccesses;
            toolRounds = 0;
            agentHistory.push({
              role: "user",
              content: `Checkpoint: you have used ${totalRounds} tool rounds. Your tool budget has been EXTENDED — keep working autonomously until the task is fully complete. Do not stop to summarize or ask for confirmation. If the task is already done, write the final summary now.`,
            });
            continue;
          }
          setError(t("app.toolTurnsExhausted"));
          break;
        }
        toolRounds++;
        totalRounds++;

        const activityIds = new Map<string, string>();
        const planned: AgenticActivityType[] = calls.map(({ call }) => {
          const id = activityId();
          activityIds.set(`${call.name}:${JSON.stringify(call.arguments)}`, id);
          return { id, tool: call.name, args: call.arguments, status: "pending" };
        });
        setActivities((prev) => [...prev, ...planned]);

        const patchActivity = (id: string, patch: Partial<AgenticActivityType>) =>
          setActivities((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));

        const resultsByKey = new Map<string, { ok: boolean; output: string; data?: unknown }>();

        const isAllowedByToolAllowance = (name: string): boolean => {
          if (toolAllowance === "all") return true;
          if (toolAllowance === "none") return false;
          if (name.startsWith("mcp_")) return mcpTools.get(name)?.readOnly === true;
          return !isDestructive(name);
        };
        const allowedCalls = calls.filter(({ call, key }) => {
          if (isAllowedByToolAllowance(call.name)) return true;
          const output =
            toolAllowance === "none"
              ? "Tool use is disabled by the current tool allowance setting."
              : "This tool is blocked by the Read Only setting. Only non-mutating tools and MCP tools declared read-only are allowed.";
          resultsByKey.set(key, { ok: false, output });
          const id = activityIds.get(key);
          if (id) patchActivity(id, { status: "denied", error: output });
          return false;
        });

        const effRoot =
          workspaceRoot ??
          (() => {
            const a = activeEditorRef.current;
            if (!a) return null;
            const i = Math.max(a.lastIndexOf("\\"), a.lastIndexOf("/"));
            return i > 0 ? a.slice(0, i) : null;
          })() ??
          homeRoot;

        const runToolCall = async (call: ToolCall): Promise<{ ok: boolean; output: string; data?: unknown }> => {
          // A tool benched for repeated failures is short-circuited: the
          // model is told to move on instead of hammering it.
          if (bannedTools.has(call.name)) {
            bannedToolCalls++;
            return {
              ok: false,
              output: `Tool "${call.name}" is disabled for the rest of this turn after repeated failures. Use a different tool, or answer from what you already have.`,
            };
          }
          // Weak local models frequently emit tool calls with EMPTY arguments
          // (e.g. web_search with no query). Rescue the common cases by
          // falling back to the user's own message, so one malformed call
          // doesn't send the model into a retry loop.
          const args = { ...call.arguments };
          if (call.name === "web_search" && !String(args.query ?? "").trim()) {
            args.query = trimmed;
          } else if (call.name === "search_files" && !String(args.pattern ?? "").trim()) {
            args.pattern = trimmed;
          }
          // MCP tools are dynamic ("mcp_<server>_<tool>") — route them to
          // their server instead of the built-in executor.
          if (call.name.startsWith("mcp_")) {
            const mcp = mcpTools.get(call.name);
            if (!mcp) {
              return {
                ok: false,
                output: `Unknown MCP tool "${call.name}". It may belong to a server that is offline or disabled. Available MCP tools: ${
                  [...mcpTools.keys()].join(", ") || "(none)"
                }.`,
              };
            }
            try {
              return await callMcpTool(mcp.server, mcp.tool, args);
            } catch (e) {
              return {
                ok: false,
                output: `MCP tool "${call.name}" failed: ${e instanceof Error ? e.message : String(e)}`,
              };
            }
          }
          // git_* and analyze_project_structure are workspace-scoped: with no
          // folder open, effRoot falls back to the home directory, where they
          // would only fail noisily ("not a git repository", "Unknown" type).
          // Keep them gated on an explicitly opened project folder instead.
          if (
            !workspaceRoot &&
            (call.name === "analyze_project_structure" || call.name.startsWith("git_"))
          ) {
            return {
              ok: false,
              output:
                "No project folder is open, so this tool is unavailable. Ask the user to open their project folder (sidebar → Open Folder); these tools operate on the open workspace, not the home directory.",
            };
          }
          const editor = {
            openPaths: editorTabsRef.current.map((t) => t.path),
            activePath: activeEditorRef.current,
            getTabContent: (p: string) =>
              editorTabsRef.current.find((t) => t.path === p)?.content ?? null,
          };
          try {
            const result = await executeTool(call.name, args, effRoot, editor);
            return { ok: result.ok, output: truncateToolOutput(result.output), data: result.data };
          } catch (e) {
            return {
              ok: false,
              output: `Tool "${call.name}" crashed: ${e instanceof Error ? e.message : String(e)}`,
            };
          }
        };

        // --- Read-only batch (parallel). MCP tools the server declares
        // read-only (readOnlyHint) join this batch too — they run without
        // approval and get cached. Unknown MCP tools stay in the sequential
        // batch to be safe. ---
        const isMcpName = (n: string) => n.startsWith("mcp_");
        const readOnly = allowedCalls.filter(({ call }) => {
          if (isDestructive(call.name)) return false;
          if (!isMcpName(call.name)) return true;
          return mcpTools.get(call.name)?.readOnly === true;
        });
        if (readOnly.length > 0) {
          readOnly.forEach(({ key }) => {
            if (readOnlyCache.has(key)) return; // cached — no spinner needed
            const id = activityIds.get(key);
            if (id) patchActivity(id, { status: "running" });
          });
          await Promise.all(
            readOnly.map(async ({ call, key }) => {
              const cached = readOnlyCache.get(key);
              const result = cached ?? (await runToolCall(call));
              if (!cached) readOnlyCache.set(key, result);
              resultsByKey.set(key, result);
              ranTools++;
              const id = activityIds.get(key);
              if (id) {
                patchActivity(
                  id,
                  result.ok
                    ? { status: "done", output: result.output, data: result.data }
                    : { status: "error", error: result.output }
                );
              }
            })
          );
        }

        // --- Mutating batch (sequential, each behind user approval). ---
        const mutating = allowedCalls.filter(
          ({ call }) =>
            isDestructive(call.name) ||
            (isMcpName(call.name) && mcpTools.get(call.name)?.readOnly !== true)
        );
        /** Tools whose result can be shown as a line diff in the activity feed. */
        const FILE_MUTATORS = new Set(["write_file", "append_file", "replace_in_file"]);
        for (const { call, key } of mutating) {
          const id = activityIds.get(key);
          if (!id) continue;

          // Snapshot the file before the change so we can render a diff.
          let beforeContent: string | null = null;
          let targetPath = "";
          if (
            FILE_MUTATORS.has(call.name) &&
            typeof call.arguments.path === "string"
          ) {
            targetPath = call.arguments.path;
            try {
              beforeContent = await invoke<string>("fs_read_file", {
                path: resolveFsPath(targetPath, effRoot),
              });
            } catch {
              beforeContent = null; // new file
            }
          }

          let approved = settings.autoApproveTools === true;
          if (!approved) {
            setPendingApproval({ id, tool: call.name, args: call.arguments, status: "pending" });
            approved = await requestApproval(id);
            setPendingApproval(null);
          }
          if (!approved) {
            patchActivity(id, { status: "denied" });
            resultsByKey.set(key, {
              ok: false,
              output:
                "User denied approval for this operation. Do not retry it; explain and propose alternatives.",
            });
            continue;
          }

          const startedAt = Date.now();
          patchActivity(id, { status: "running", startedAt });
          // A mutation invalidates every cached read-only result.
          readOnlyCache.clear();
          const result = await runToolCall(call);
          resultsByKey.set(key, result);
          if (result.ok) ranTools++;
          patchActivity(
            id,
            result.ok
              ? {
                  status: "done",
                  output: result.output.slice(0, 4000),
                  durationMs: Date.now() - startedAt,
                }
              : {
                  status: "error",
                  error: result.output.slice(0, 2000),
                  durationMs: Date.now() - startedAt,
                }
          );
          // Reflect filesystem mutations in the editor immediately, show a
          // line-by-line diff in the activity feed, and open the changed file.
          if (result.ok) {
            syncAllOpenTabsRef.current();
            if (FILE_MUTATORS.has(call.name) && targetPath) {
              const absPath = resolveFsPath(targetPath, effRoot);
              let afterContent = "";
              try {
                afterContent = await invoke<string>("fs_read_file", { path: absPath });
              } catch {
                afterContent = "";
              }
              patchActivity(id, { diff: computeLineDiff(beforeContent ?? "", afterContent) });
              void openFileInEditor(absPath);
            }
          }
        }


        // Runaway guard: identical failing calls across consecutive rounds.
        // A round with ANY success proves progress — reset the streak.
        const anySuccess = calls.some(({ key }) => resultsByKey.get(key)?.ok === true);
        const failSig = calls
          .filter(({ key }) => resultsByKey.get(key)?.ok === false)
          .map(({ call }) => `${call.name}:${JSON.stringify(call.arguments)}`)
          .sort()
          .join("|");
        if (failSig && failSig === lastFailSig && !anySuccess) {
          failStreak++;
          if (failStreak >= 4) {
            setError(t("app.repeatedToolFailure"));
            break;
          }
        } else {
          lastFailSig = failSig;
          failStreak = failSig ? 1 : 0;
        }

        // Per-tool failure accounting. Success resets a tool's strike count
        // (a tool that recovers is never benched); reaching the limit only
        // benches THAT tool — the turn continues with everything else. Hard
        // stop only if the model keeps hammering benched tools, or nothing
        // succeeds despite many failures.
        for (const [key, r] of resultsByKey) {
          const tool = key.slice(0, key.indexOf(":"));
          if (r.ok) {
            totalSuccesses++;
            toolFailCounts.delete(tool);
          } else if (!bannedTools.has(tool)) {
            totalFails++;
            toolFailCounts.set(tool, (toolFailCounts.get(tool) ?? 0) + 1);
          }
        }
        for (const [tool, count] of toolFailCounts) {
          if (count >= TOOL_FAIL_LIMIT) bannedTools.add(tool);
        }
        if (bannedTools.size > 0) {
          agentHistory.push({
            role: "user",
            content: `Tools disabled for the rest of this turn after repeated failures: ${[
              ...bannedTools,
            ].join(", ")}. Do NOT call them again — use other tools, or summarize what you know and answer directly.`,
          });
        }
        if (
          bannedToolCalls >= BANNED_TOOL_CALL_LIMIT ||
          (totalFails >= 12 && totalSuccesses === 0)
        ) {
          setError(
            `Too many tool failures this turn (${totalFails} failed, ${totalSuccesses} succeeded${
              bannedTools.size > 0 ? `; disabled: ${[...bannedTools].join(", ")}` : ""
            }). Stopped to avoid an endless loop — try rephrasing or check the target system.`
          );
          break;
        }

        // Route results back in the original call order.
        const nativeResults: Message[] = [];
        const resultBlocks: string[] = [];
        for (const { call, native, key } of calls) {
          const result = resultsByKey.get(key);
          if (!result) continue;
          // Truncate large outputs before they enter the model's context.
          const output = truncateToolOutput(result.output);
          if (native) {
            nativeResults.push({
              role: "tool",
              content: output,
              toolCallId: call.id,
              toolName: call.name,
            });
          } else {
            resultBlocks.push(formatToolResult({ ...result, output }));
          }
        }

        // Send the tool results back to the model and loop.
        if (nativeResults.length > 0) {
          agentHistory.push(...nativeResults);
        }
        if (resultBlocks.length > 0) {
          agentHistory.push({ role: "user", content: resultBlocks.join(NL + NL) });
        }
      }

      // Commit whatever visible text accumulated across all rounds. Flush the
      // throttled renderer first, otherwise the final chunk — which has not
      // been rendered yet — would be missing from the committed message.
      flushStreamingAssistantContent(runId);
      if (runId !== streamRunRef.current) {
        // A newer run took over while this one was unwinding — its bubble
        // owns the chat now, so this run must not write to it.
        return;
      }
      // Derive the committed text from the complete raw text so nothing can be
      // lost, even if the last frame was never rendered.
      const finalVisible = stabilizeStreamingMarkdown(stripToolCalls(streamRawRef.current)).trim();
      if (finalVisible) {
        setLastAssistantContent(finalVisible);
      } else if (ranTools > 0) {
        // Tools ran but the model never narrated — show a concise summary
        // instead of a misleading "empty response" error.
        setLastAssistantContent(
          `Done — ${ranTools} file operation${ranTools === 1 ? "" : "s"} completed.`
        );
      } else if (sawRawOutput) {
        // The model said something, but it was all tool markup we could not
        // map to a known tool. Surface that instead of a generic error.
        setError(
          "The model responded, but its tool calls could not be recognized. Try a different model, or rephrase so it answers in plain text."
        );
        removeEmptyAssistant();
      } else {
        setError(
          "The model returned an empty response. Check the model name and endpoint in Settings (Ctrl+B)."
        );
        removeEmptyAssistant();
      }
    } catch (err) {
      if (runId !== streamRunRef.current) {
        // Superseded by a newer run — leave the chat to the newer run.
        return;
      }
      if (abortCtrl.signal.aborted) {
        // User stopped the generation; keep partial output. Flush first so the
        // text that has not been rendered yet is not lost.
        flushStreamingAssistantContent(runId);
        // Derive the partial text from the complete raw text so nothing is
        // lost, even if the last frame was never rendered.
        const partial = stripToolCalls(streamRawRef.current).trim();
        if (partial) {
          setLastAssistantContent(partial);
        } else {
          removeEmptyAssistant();
        }
      } else {
        const msg = err instanceof Error ? err.message : "Failed to reach the AI provider.";
        setError(msg);
        removeEmptyAssistant();
      }
    } finally {
      flushStreamingAssistantContent(runId);
      if (runId === streamRunRef.current) {
        // Only the current run may tear down the shared streaming state; a
        // superseded run would otherwise cancel the newer run's request.
        setIsLoading(false);
        streamControllerRef.current = null;
        approvalRef.current?.resolve(false);
        approvalRef.current = null;
        setPendingApproval(null);
      }
    }
  };


  const handleAnalyzeProject = () => {
    if (!workspaceRoot) {
      setError("Open a workspace folder first, then run Analyze Project.");
      return;
    }
    void sendMessage(
      `Analyze the project at "${workspaceRoot}" in depth: identify the stack, entry points, key modules and their roles, and how data flows between them. Use list_dir, read_file and search_files as needed, then summarize the architecture plus anything that looks risky or unfinished.`
    );
  };

  /** Export the active chat session as JSON via a save dialog (Context menu). */
  const handleSaveSession = async () => {
    try {
      const path = await saveDialog({
        title: "Save chat session",
        defaultPath: `neo-session-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return; // user cancelled
      const payload = {
        exportedAt: new Date().toISOString(),
        workspaceRoot,
        provider: settings.provider,
        model: settings.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        activities,
      };
      await invoke("fs_write_file", { path, content: JSON.stringify(payload, null, 2) });
    } catch (e) {
      setError(`Failed to save session: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
const handleAnimationComplete = () => {
  console.log('Animation completed!');
};

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg-base)] text-[var(--text-primary)] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">

        <InfoPanel isOpen={infoPanelOpen} onClose={() => setInfoPanelOpen(false)} />
        <PrivacyPolicy isOpen={privacyPolicyOpen} onClose={() => setPrivacyPolicyOpen(false)} />
        {updateNotification && (
          <UpdateNotification
            result={updateNotification.result}
            available={updateNotification.result.isUpdateAvailable}
            onDismiss={handleDismissUpdate}
          />
        )}
        <Tab2 isOpen={Tab2Open} onClose={() => setTab2Open(false)} />
        <SettingsPanel
          open={settingsOpen}
          settings={uiSettings}
          onChange={updateUiSettings}
          aiSettings={settings}
          onAiChange={handleSaveSettings}
          onSelectLocalModel={handleSelectLocalModel}
          initialSection={settingsSection}
          onClose={() => setSettingsOpen(false)}
          account={account}
          accountProfile={accountProfile}
          accountLoading={accountLoading}
          onAccountRefresh={() => void refreshAccount()}
          workspaceRoot={workspaceRoot}
        />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <ChatHistorySidebar
            isOpen={historySidebarOpen}
            onClose={() => setHistorySidebarOpen(false)}
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelectSession={selectSession}
            onNewChat={newChat}
            onDeleteSession={deleteSession}
            signedIn={signedIn}
            contextEntries={contextEntries}
            pinnedPaths={pinnedPaths}
            onPinFile={togglePinFile}
            onAnalyzeProject={handleAnalyzeProject}
            onSaveSession={() => void handleSaveSession()}
            onOpenInfoPanel={() => setInfoPanelOpen(true)}
            onOpenTab2={() => setTab2Open(true)}
            onOpenAiSettings={() => {
              setSettingsSection("ai");
              setSettingsOpen(true);
            }}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenPlugins={() => {
              setSettingsSection("plugins");
              setSettingsOpen(true);
            }}
            onOpenAccount={() => {
              setSettingsSection("account");
              setSettingsOpen(true);
            }}
            onOpenCommandPalette={() => setCommandPaletteOpen(true)}
            onCheckForUpdates={() => void runUpdateCheck(true)}
          />
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-base)]">
            {/* --- CONTEXT STRIP --- */}
            {/* relative z-20 keeps it ABOVE the scroll fade so it stays visible/clickable */}
            <div
              className="relative z-20 flex shrink-0 items-center gap-3 overflow-x-auto whitespace-nowrap bg-root py-1.5 pl-2 pr-5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              data-debug="context-strip"
            >
              {/* Chat panel toggle — reopens/closes history now that the railbar is gone. */}
              <button
                type="button"
                onClick={() => setHistorySidebarOpen((v) => !v)}
                title={historySidebarOpen ? "Close chat history" : "Open chat history (Ctrl+Shift+H)"}
                aria-label={historySidebarOpen ? "Close chat history" : "Open chat history"}
                aria-expanded={historySidebarOpen}
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors ${
                  historySidebarOpen
                    ? "bg-(--fill-2) text-[var(--text-primary)]"
                    : "text-[var(--text-muted)] hover:bg-(--fill-1) hover:text-[var(--text-primary)]"
                }`}
              >
                <IoMenu size={15} />
              </button>
             
             {true && (
              <div className="flex items-center gap-1 rounded bg-(--fill-1) px-2 py-0.5 font-mono text-[10px] text-[var(--text-secondary)] hover:bg-(--fill-2)">
                <button
                  type="button"
                  onClick = {openWorkspaceFolder}
                  className="flex items-center gap-2"
                >
                  <IoFolderOutline />
                  {shortPath(workspaceRoot)}
                </button>
              </div>
            )}
              {activeEditorPath && (
                <div className="flex items-center gap-1 rounded border border-(--border) bg-(--fill-1) px-2 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]">
                  <span>
                  </span> {shortPath(activeEditorPath)}
                </div>
              )}
              {!workspaceRoot && homeRoot && (
                <div
                  className="flex items-center gap-1 rounded border border-(--border) bg-(--fill-1) px-2 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]"
                  title={`Default working directory: ${homeRoot}`}
                >
                  <span><IoFolderOutline/>
                  </span> ~
                </div>
              )}
              {!workspaceRoot && !activeEditorPath && !homeRoot && (
                <span className="text-[var(--text-secondary)] text-[10px]">N/A</span>
              )}
              {/* Context-window usage — lives with the chat (it used to be a
                  dropdown inside the top-menu provider pill) and ticks up live
                  while a reply streams. */}
              <div className="ml-auto flex shrink-0 items-center gap-2 pl-4">
                <span className="text-[10.5px] font-medium text-[var(--text-muted)]">Context</span>
                <span
                  className="tabular-nums text-[10px] text-[var(--text-secondary)]"
                  title={
                    ctxIsReal
                      ? "Exact prompt tokens the provider reported for this conversation, vs. the model's context window"
                      : "Estimated from message length — the exact count appears here once the provider reports usage for this chat"
                  }
                >
                  {ctxIsReal ? "" : "~"}
                  {formatTokens(ctxTokens)} / {formatTokens(ctxLimit)}
                </span>
                <div className="h-1 w-14 shrink-0 overflow-hidden rounded-full bg-(--fill-2)">
                  <div
                    className={`h-full rounded-full transition-all ${
                      ctxPct > 85 ? "bg-[var(--danger)]" : ctxPct > 60 ? "bg-[var(--warning)]" : "bg-(--accent)"
                    }`}
                    style={{ width: `${Math.max(3, ctxPct)}%` }}
                  />
                </div>
                <span className="tabular-nums text-[10px] text-[var(--text-faint)]">{ctxPct}%</span>
              </div>
            </div>

            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="relative min-h-0 flex-1 overflow-y-auto"
              data-debug="chat-scroll"
            >
              {messages.length === 0 ? (
                <div className="relative flex min-h-full items-center justify-center px-6">
                  <div className="msg-in relative z-0 w-full  pb-24 text-center" data-debug="welcome-wrap">
                
                     <BlurText
                          text="Ready to start?"
                          effect="blur"
                          animateBy="words"
                          direction="top"
                          staggerFrom="start"
                          trigger="view"
                          delay={200}
                          stepDuration={0.35}
                          blur={10}
                          distance={50}
                          onAnimationComplete={handleAnimationComplete}
                          className="text-2xl mb-8 mx-auto"
                          loop={false}
                          loopDelay={2}
                          focusOnHover={false}
                        />
                    

                    <div className="mx-auto mt-1 grid w-full max-w-lg grid-cols-1 gap-1.5 text-left sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => {
                          void openWorkspaceFolder();
                        }}
                        className="rounded-xl border border-transparent bg-(--fill-1) px-3.5 py-2.5 text-left transition hover:border-(--border) hover:bg-(--fill-2)"
                      >
                        <span className="block text-[12.5px] text-[var(--text-primary)]">Open a project</span>
                        <span className="mt-0.5 block text-[11.5px] leading-4 text-[var(--text-muted)]">Browse and edit files in a real workspace</span>
                      </button>
                      {[
                        {
                          label: "Summarize my project",
                          desc: "A quick overview of what's here",
                          prompt: "Summarize my project in small details",
                        },
                        {
                          label: "Find and fix bugs",
                          desc: "Scan for issues and apply fixes",
                          prompt: "Find and fix bugs and make sure they aren't repeated again",
                        },
                        {
                          label: "Write a new feature",
                          desc: "Describe it and Struct builds it",
                          prompt: "Write a new feature in my code",
                        },
                      ].map((card) => (
                        <button
                          key={card.label}
                          type="button"
                          onClick={() => setMessage(card.prompt)}
                          className="rounded-xl border border-transparent bg-(--fill-1) px-3.5 py-2.5 text-left transition hover:border-(--border) hover:bg-(--fill-2)"
                        >
                          <span className="block text-[12.5px] text-[var(--text-primary)]">{card.label}</span>
                          <span className="mt-0.5 block text-[11.5px] leading-4 text-[var(--text-muted)]">{card.desc}</span>
                        </button>
                      ))}
                    </div>

                    
                  </div>
                </div>
              ) : (
                <div className="mx-auto w-full max-w-3xl px-6 py-10">
                  <div className="space-y-8">
                    {messages.map((msg, index) => (
                      <div key={index} className="msg-in">
                        {msg.role === "user" ? (
                          <div className="flex justify-end">
                            <div className="max-w-[85%] whitespace-pre-wrap rounded-xl bg-(--fill-2) px-4 py-2.5 text-[13px] leading-6 text-[var(--text-primary)]">
                              {msg.content}
                            </div>
                          </div>
                        ) : isLoading &&
                          index === messages.length - 1 &&
                          msg.content.trim().length === 0 ? (
                          <div className="py-1.5 text-[var(--text-muted)]">
                            <ThinkingIndicator label={t("app.thinking")} />
                          </div>
                        ) : (
                          <div className="group/msg min-w-0">
                            <div className="text-[14px] leading-[1.75] text-[var(--text-primary)]">
                              <Markdown content={msg.content} />
                              {isLoading && index === messages.length - 1 && (
                                <span className="stream-caret" aria-hidden />
                              )}
                            </div>
                            <div className="mt-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/msg:opacity-100">
                              <MessageAction
                                label={t("app.copy")}
                                onClick={() => {
                                  void navigator.clipboard.writeText(msg.content);
                                }}
                              >
                                <IoCopyOutline size={13} />
                              </MessageAction>
                              <MessageAction label={t("app.feedbackGood")} onClick={() => sendFeedback("good")}>
                                <IoThumbsUpSharp size={13} />
                              </MessageAction>
                              <MessageAction label={t("app.feedbackBad")} onClick={() => sendFeedback("bad")}>
                                <IoThumbsDownSharp size={13} />
                              </MessageAction>
                              <MessageAction label={t("app.feedbackReport")} onClick={() => sendFeedback("report")}>
                                <IoAlertSharp size={13} />
                              </MessageAction>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <AgenticActivity
                items={activities}
                pending={pendingApproval}
                onApprove={handleApproveTool}
                onDeny={handleDenyTool}
              />
            </div>
            {error && (
              <div className="relative z-20 mx-auto w-full max-w-3xl px-5 pt-2">
                <div className="rounded-lg border border-red-500/20 bg-red-500/[0.08] px-3.5 py-2 text-[12.5px] leading-5 text-[var(--danger)]">
                  {error}
                </div>
              </div>
            )}
            <div className="relative z-20 shrink-0 px-5 pb-3 pt-2">
              <div className="mx-auto w-full max-w-3xl">
                <div className="mb-1.5 flex items-center gap-1.5 px-1">
                  {activeEditorPath ? (
                    <span
                      title={t("agent.activeFileContext")}
                      className="inline-flex items-center gap-1.5 rounded  border-(--border) bg-black px-2 py-0.5 text-[11px] text-[var(--text-secondary)]"
                    >
                      <span className="h-1 w-1 rounded-full bg-(--text-muted)" />
                      {activeEditorPath.split(/[\\/]/).pop()}
                    </span>
                  ) : (
                    <span className="text-[11px] text-[var(--text-faint)]">
                      {t("app.noFileAttached")}
                    </span>
                  )}
                  <label
                    className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded border border-(--border) bg-black px-2 py-0.5 text-[11px] text-[var(--text-secondary)] transition hover:bg-(--fill-2)"
                    title={t("app.toolAllowanceTitle")}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full  bg-black ${
                        settings.toolAllowance === "none"
                          ? "bg-red-500"
                          : settings.toolAllowance === "read-only"
                            ? "bg-amber-500"
                            : "bg-emerald-500"
                      }`}
                    />
                    <select
                      aria-label={t("app.toolAllowance")}
                      className="max-w-[145px] cursor-pointer appearance-none bg-transparent outline-none"
                      value={settings.toolAllowance ?? "all"}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        if (value === "all" || value === "read-only" || value === "none") {
                          handleSaveSettings({ ...settings, toolAllowance: value });
                        }
                      }}
                    >
                      <option value="all">{t("app.toolAll")}</option>
                      <option value="read-only">{t("app.toolReadOnly")}</option>
                      <option value="none">{t("app.toolNone")}</option>
                    </select>
                    <span aria-hidden className="text-[9px] opacity-60">▼</span>
                  </label>
                </div>
                <PromptBar
                  value={message}
                  onValueChange={setMessage}
                  onEffortChange={(effort) => {
                    effortTokensRef.current = outputTokensForEffort(effort);
                  }}
                  busy={isLoading}
                  onSend={(text, detail) => {
                    void (async () => {
                      const ctx = await buildAttachmentContext(detail.attachments);
                      const body = [expandCommand(text), ctx].filter(Boolean).join("\n\n");
                      void sendMessage(body);
                    })();
                  }}
                  onAttach={(key) => (key === "folder" ? pickFolder() : pickFiles())}
                  onStop={stopChat}
                  placeholder={
                    settings.apiKey || !spec.needsAuth
                      ? t("app.placeholderWithKey")
                      : t("app.placeholderNoKey")
                  }
                  models={promptModels}
                  defaultModel={`${settings.provider}:${settings.model}`}
                  onModelChange={handlePromptModelChange}
                  defaultEffort="Medium"
                  className="w-full"
                />
                <div className="mt-1.5 flex items-center justify-between px-1 text-[10.5px] text-[var(--text-faint)]">
                  <span>{t("app.keyboardHint")}</span>
                  <span>{t("agent.verifyInfo")}</span>
                </div>
              </div>
            </div>
          </main>
        </div>

        {/* <BottomPanel
          // open={onOpenTerminal}
          tab={panelTab}
          onTab={setPanelTab}
          // onClose={() => setOpenTerminal(false)}
          root={workspaceRoot}
          onOpenFile={(p, line) => void openFileInEditor(p, line)}
          // terminalPrefs={{
          //   fontSize: uiSettings.terminalFontSize,
          //   scrollback: uiSettings.terminalScrollback,
          //   cursorBlink: uiSettings.terminalCursorBlink,
          // }} */}
        {/* <StatusBar
          historySidebarOpen={historySidebarOpen}
          onToggleHistorySidebar={() => setHistorySidebarOpen((v) => !v)}
          workspaceName={workspaceRoot?.split(/[\\/]/).filter(Boolean).pop() ?? null}
        /> */}
        <CommandPalette
          isOpen={commandPaletteOpen}
          onClose={() => setCommandPaletteOpen(false)}
          commands={[
            {
              id: "open-ai-settings",
              label: t("app.aiSettings"),
              category: "Settings",
              shortcut: "Ctrl+B",
              action: () => {
                setSettingsSection("ai");
                setSettingsOpen(true);
              },
            },
            {
              id: "toggle-history",
              label: t("app.toggleChatHistory"),
              category: "View",
              shortcut: "Ctrl+Shift+H",
              action: () => setHistorySidebarOpen((v) => !v),
            },
            {
              id: "open-information",
              label: t("app.aboutContact"),
              category: "Help",
              action: () => setInfoPanelOpen(true),
            },
            {
              id: "open-privacy",
              label: t("app.privacyPolicy"),
              category: "Help",
              action: () => setPrivacyPolicyOpen(true),
            },
            {
              id: "new-chat",
              label: t("app.newChat"),
              category: "Chat",
              action: newChat,
            },
            {
              id: "stop-stream",
              label: t("app.stopStreaming"),
              category: "Chat",
              shortcut: "Esc",
              action: isLoading ? stopChat : () => {},
            },
            // {
            //   id: "open-terminal",
            //   label: "Toggle Terminal",
            //   category: "View",
            //   shortcut: "Ctrl+`",
            //   action: () => setOpenTerminal((v) => !v),
            // },
            {
              id: "open-workspace",
              label: t("app.openWorkspaceFolder"),
              category: "View",
              shortcut: "Ctrl+Shift+O",
              action: () => openWorkspaceRef.current(),
            },

            {
              id: "open-settings",
              label: t("app.openSettings"),
              category: "Settings",
              shortcut: "Ctrl+,",
              action: () => setSettingsOpen(true),
            },
          ]}
        />
      </div>
  );
}

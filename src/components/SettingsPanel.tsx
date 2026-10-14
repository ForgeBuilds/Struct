/*
 * Author: madhusudhan
 * Check the LICENSE in the GitHub repo (https://github.com/Lumorix-studios/Neo) for more information on permissions to use this code.
 */
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { useTranslation } from "../i18n";
import {
  ACCENT_SWATCHES,
  DEFAULT_UI_SETTINGS,
  LANGUAGE_OPTIONS,
  THEMES,
  isValidHex,
  clearRecentFiles,
  clearRecentFolders,
  type UiSettings,
} from "../uiSettings";
import type { AISettings, ProviderId } from "../types";
import { PROVIDER_OPTIONS, providerById } from "../providers";
import { 
  loadMcpServers, 
  saveMcpServers, 
  makeServerId, 
  listMcpTools, 
  stopStdio, 
  describeServer, 
  discoverMcpServers,
  serverFingerprint,
  type McpServerConfig,
  type DiscoveredServer
} from "../mcp";
import { 
  findAvailableOllamaPort 
} from "../serverManager";
import { ensureOllamaReady } from "../localModels";
import LocalModels from "../../components/LocalModels";
import AccountSection from "./AccountSection";
import type { NeoUser, Profile as AccountProfile } from "../lib/auth";
import { byokAllowed, saveRemoteKey, removeRemoteKey } from "../lib/byok";
import * as cloudSync from "../lib/cloudSync";
import appIcon from "../assets/images/icon.jpeg";

import {
  IoClose, IoInformationCircleOutline,
  IoLockClosedOutline, IoOpenOutline, IoSearch
} from "react-icons/io5";
import {
  formatTokens,
  getCachedRateSettings,
  getUsageSnapshot,
  loadTokenRateSettings,
  resetUsage,
  saveTokenRateSettings,
  type TokenRateSettings,
} from "../tokenUsage";


export type SectionId =
  | "dashboard"
  | "appearance"
  | "ai"
  | "editor"
  | "terminal"
  | "files"
  | "data"
  | "shortcuts"
  | "account"
  | "about";

interface SettingsPanelProps {
  open: boolean;
  settings: UiSettings;
  /** Merge a partial patch into the settings and persist. */
  onChange: (patch: Partial<UiSettings>) => void;
  /** Current AI/chat settings (provider, model, keys, …). */
  aiSettings: AISettings;
  /** Replace the AI settings and persist. */
  onAiChange: (next: AISettings) => void;
  /** User picked a local (Ollama) model from the Local Models browser.
   * Returns an error message (e.g. server not reachable), or null on success. */
  onSelectLocalModel: (modelName: string) => void | Promise<string | null>;
  /** Section to show when the panel opens (defaults to "appearance"). */
  initialSection?: SectionId | null;
  onClose: () => void;
  /** Signed-in account (null when signed out). */
  account?: NeoUser | null;
  /** Full profile incl. the BYOK entitlement flag. */
  accountProfile?: AccountProfile | null;
  /** True while the app is checking/restoring the auth session. */
  accountLoading?: boolean;
  /** Re-read the account/profile after edits in the Account tab. */
  onAccountRefresh?: () => void;
  /** Open workspace folder — used to discover a project-scoped `.mcp.json`. */
  workspaceRoot?: string | null;
}

/* ── Small building blocks ─────────────────────────────────────────── */

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
        checked
          ? "border-transparent bg-(--accent)"
          : "border-(--border) bg-(--fill-2)"
      }`}
    >
      <span
        className={`absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-(--on-accent) transition-all ${
          checked ? "left-[18px]" : "left-[3px] opacity-60"
        }`}
      />
    </button>
  );
}

function Slider({
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-28 cursor-pointer appearance-none rounded-full bg-(--fill-2) accent-[var(--accent)]"
      />
      <span className="w-12 text-right text-[11px] tabular-nums text-[var(--text-secondary)]">
        {value}
        {unit ?? ""}
      </span>
    </div>
  );
}

function Row({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5 border-b border-(--border) py-3.5 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium text-[var(--text-primary)]">{title}</p>
        {description && (
          <p className="mt-0.5 text-[11px] leading-4 text-[var(--text-muted)]">{description}</p>
        )}
      </div>
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 sm:justify-end">{children}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 mt-6 text-[11px] text-[var(--text-muted)] first:mt-0">{children}</p>;
}

/** Export a JSON snapshot of all settings via a browser download. */
function exportSettingsSnapshot(ui: UiSettings, ai: AISettings): void {
  const snapshot = {
    app: "Neo",
    exportedAt: new Date().toISOString(),
    uiSettings: ui,
    aiSettings: ai,
  };
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `neo-settings-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
/* ── Main panel ────────────────────────────────────────────────────── */

interface SectionMeta {
  id: SectionId;
  label: string;
  hint: string;
  group: "Personal" | "Workspace" | "System";
  keywords: string;
}

const SECTIONS: SectionMeta[] = [
  {
    id: "account",
    label: "Account",
    hint: "Profile, sync and signed-in devices",
    group: "Personal",
    keywords: "profile email plan sign in sign out sync avatar name",
  },
  {
    id: "appearance",
    label: "Appearance",
    hint: "Theme, glass, accent and language",
    group: "Workspace",
    keywords: "theme dark light color colour accent glass translucent blur background contrast",
  },
  {
    id: "ai",
    label: "AI",
    hint: "Providers, models, keys and MCP tools",
    group: "Workspace",
    keywords: "provider model api key byok ollama openai anthropic google groq mcp tools",
  },
  {
    id: "dashboard",
    label: "Dashboard",
    hint: "Token usage and rate-limit estimates",
    group: "Workspace",
    keywords: "tokens usage cost rate limits statistics budget",
  },
  {
    id: "files",
    label: "Files & Save",
    hint: "Autosave and recent items",
    group: "Workspace",
    keywords: "autosave recent files folders save",
  },
  {
    id: "shortcuts",
    label: "Shortcuts",
    hint: "Keyboard bindings at a glance",
    group: "Workspace",
    keywords: "keyboard keys hotkeys bindings commands",
  },
  {
    id: "terminal",
    label: "Terminal",
    hint: "Shell, fonts and scrollback",
    group: "System",
    keywords: "shell command prompt font cursor scrollback",
  },
  {
    id: "data",
    label: "Privacy & Data",
    hint: "Local storage, cloud data and recents",
    group: "System",
    keywords: "privacy data storage cloud delete clear recents reset",
  },
  {
    id: "about",
    label: "About",
    hint: "Version, links and build information",
    group: "System",
    keywords: "version update github links help credits",
  },
];

const SHORTCUTS: Array<[string, string]> = [
  ["Ctrl+Shift+P", "Command palette"],
  ["Ctrl+B", "Open AI settings"],
  ["Ctrl+Shift+E", "Toggle code editor"],
  ["Ctrl+Shift+G", "Toggle git panel"],
  ["Ctrl+Shift+H", "Toggle chat history"],
  ["Ctrl+`", "Toggle terminal dock"],
  ["Ctrl+S", "Save active file"],
  ["Ctrl+/", "Toggle line comment"],
  ["Ctrl+,", "Open settings"],
];

const LANGUAGE_LABELS: Record<string, { changeLanguage: string; select: string; selected: string }> = {
  English: { changeLanguage: "Change language", select: "Select...", selected: "Selected" },
  "हिंदी": { changeLanguage: "भाषा बदलें", select: "चुनें...", selected: "चयनित" },
  中文: { changeLanguage: "更改语言", select: "请选择...", selected: "已选择" },
  Español: { changeLanguage: "Cambiar idioma", select: "Seleccionar...", selected: "Seleccionado" },
  Français: { changeLanguage: "Changer la langue", select: "Sélectionner...", selected: "Sélectionné" },
  Deutsch: { changeLanguage: "Sprache ändern", select: "Auswählen...", selected: "Ausgewählt" },
  "日本語": { changeLanguage: "言語を変更", select: "選択...", selected: "選択中" },
  "한국어": { changeLanguage: "언어 변경", select: "선택...", selected: "선택됨" },
  Português: { changeLanguage: "Alterar idioma", select: "Selecionar...", selected: "Selecionado" },
  Русский: { changeLanguage: "Изменить язык", select: "Выберите...", selected: "Выбрано" },
};

export default function SettingsPanel({
  open,
  settings,
  onChange,
  aiSettings,
  onAiChange,
  onSelectLocalModel,
  initialSection,
  onClose,
  account = null,
  accountProfile = null,
  accountLoading = false,
  onAccountRefresh,
  workspaceRoot = null,
}: SettingsPanelProps) {
  const [section, setSection] = useState<SectionId>("appearance");
  const { t, language: selectedValue } = useTranslation(open);
  /** Filters the navigation only — section content is untouched. */
  const [navQuery, setNavQuery] = useState("");
  const navQueryNormalized = navQuery.trim().toLowerCase();
  const sectionKeyMap: Record<SectionId, string> = {
    account: "settings.account",
    appearance: "settings.appearance",
    ai: "settings.ai",
    dashboard: "settings.dashboard",
    editor: "settings.files",
    files: "settings.files",
    shortcuts: "settings.shortcuts",
    terminal: "settings.terminal",
    data: "settings.privacy",
    about: "settings.about",
  };
  const visibleSections = (navQueryNormalized
    ? SECTIONS.filter((s) =>
        `${s.label} ${s.hint} ${s.group} ${s.keywords}`.toLowerCase().includes(navQueryNormalized)
      )
    : SECTIONS
  ).map((item) => ({
    ...item,
    label: t(sectionKeyMap[item.id]) || item.label,
  }));
  // Stable callbacks: keep AccountSection (memoised) from re-rendering
  // whenever an unrelated settings field changes.
  const refreshAccount = useCallback(() => onAccountRefresh?.(), [onAccountRefresh]);
  // --- AI settings state (mirrors the previous chat settings sidebar) ---
  const [showAiKey, setShowAiKey] = useState(false);
  const [showLocalModels, setShowLocalModels] = useState(false);
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>(() => loadMcpServers());
  const [mcpName, setMcpName] = useState("");
  const [mcpTransport, setMcpTransport] = useState<"http" | "stdio">("http");
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpHeaders, setMcpHeaders] = useState("");
  const [mcpCommand, setMcpCommand] = useState("");
  const [mcpArgs, setMcpArgs] = useState("");
  const [mcpCwd, setMcpCwd] = useState("");
  const [mcpEnv, setMcpEnv] = useState("");
  const [mcpError, setMcpError] = useState("");
  const [mcpTest, setMcpTest] = useState<Record<string, string>>({});
  // --- MCP auto-discovery state ---
  const [mcpDiscovered, setMcpDiscovered] = useState<DiscoveredServer[] | null>(null);
  const [mcpScanBusy, setMcpScanBusy] = useState(false);
  /** Ids of discovered entries the user has imported, so the row can be
   *  marked as done instead of silently vanishing from the list. */
  const [mcpImported, setMcpImported] = useState<string[]>([]);
  // --- BYOK key management state (Account-aware) ---
  const signedIn = !!account;
  const [byokDraft, setByokDraft] = useState("");
  const [byokBusy, setByokBusy] = useState(false);
  const [byokMsg, setByokMsg] = useState<string | null>(null);
  // --- Cloud data management state ---
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudMsg, setCloudMsg] = useState<string | null>(null);
  const languageLabels = LANGUAGE_LABELS[selectedValue] ?? LANGUAGE_LABELS.English;

  const handleLanguageChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextLanguage = event.target.value;
    if (nextLanguage && nextLanguage !== selectedValue) {
      onChange({ language: nextLanguage });
    }
  };

  // Reset the BYOK draft when the provider (or auth state) changes.
  useEffect(() => {
    setByokDraft("");
    setByokMsg(null);
  }, [aiSettings.provider, signedIn]);

  const keyConfigured = !!aiSettings.apiKey;
  /**
   * BYOK keys live in the account, so the only requirement now is being signed
   * in — there is no paid plan gating them. While the profile is still loading
   * we show neither the editor nor the sign-in prompt, so a slow network never
   * flashes "locked" at a returning user.
   */
  const byokEntitled = byokAllowed(accountProfile, signedIn);
  const byokLocked = !accountLoading && !byokEntitled;

  /** Persist the provider key — encrypted server-side, account only. */
  const handleSaveByokKey = async () => {
    if (!byokEntitled) {
      setByokMsg("Sign in to store a provider key in your account.");
      return;
    }
    setByokBusy(true);
    setByokMsg(null);
    try {
      await saveRemoteKey(aiSettings.provider, byokDraft);
      onAiChange({ ...aiSettings, apiKey: byokDraft.trim() });
      setByokMsg("Key saved to your account (encrypted server-side).");
      setByokDraft("");
    } catch (e) {
      let message = e instanceof Error ? e.message : String(e);
      if (/BYOK_ENCRYPTION_KEY secret is missing or not 64 hex chars/i.test(message)) {
        message =
          "API-key storage is not configured on the server. Set the Supabase secret BYOK_ENCRYPTION_KEY to 64 hexadecimal characters, then redeploy the api-keys function.";
      }
      if (/upgraded plan|paywall|byok requires/i.test(message)) {
        message =
          "The deployed api-keys function still enforces the old paywall. Redeploy the Supabase function (see supabase/migrations/0006_remove_paywalls.sql).";
      }
      setByokMsg(message);
    } finally {
      setByokBusy(false);
    }
  };

  const handleRemoveByokKey = async () => {
    if (!byokEntitled) return;
    setByokBusy(true);
    setByokMsg(null);
    try {
      await removeRemoteKey(aiSettings.provider);
      onAiChange({ ...aiSettings, apiKey: "" });
      setByokMsg("Key removed from your account.");
    } catch (e) {
      setByokMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setByokBusy(false);
    }
  };

  const [isCheckingPorts, setIsCheckingPorts] = useState(false);
  const [discoveredPort, setDiscoveredPort] = useState<string | null>(null);

  // --- Dashboard (token usage + rate limits) state ---
  const [usageTick, setUsageTick] = useState(0);
  const [rateSettings, setRateSettings] = useState<TokenRateSettings>(() =>
    getCachedRateSettings()
  );

  // Load persisted rate settings once, and live-refresh usage numbers while
  // the dashboard tab is open (agent runs keep recording in the background).
  useEffect(() => {
    void loadTokenRateSettings().then(setRateSettings);
  }, []);
  useEffect(() => {
    if (section !== "dashboard") return;
    const id = window.setInterval(() => setUsageTick((t) => t + 1), 2000);
    return () => window.clearInterval(id);
  }, [section]);

  // --- "About builds" popover (sidebar footer) ---
  const [buildsInfoOpen, setBuildsInfoOpen] = useState(false);
  const buildsInfoRef = useRef<HTMLDivElement>(null);

  // Close the popover on outside click or Escape.
  useEffect(() => {
    if (!buildsInfoOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!buildsInfoRef.current?.contains(e.target as Node)) setBuildsInfoOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBuildsInfoOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [buildsInfoOpen]);

  /** Seed the drafts from the current settings each time the panel opens. An
   *  effect event so the `[open]` dependency stays authoritative and editing a
   *  draft is never clobbered by an unrelated settings change. */
  const seedDrafts = useEffectEvent(() => {
    setSection(initialSection ?? "appearance");
    setShowLocalModels(false);
    setShowAiKey(false);
  });

  useEffect(() => {
    if (open) seedDrafts();
  }, [open]);

  // Jump to a requested section while the panel is already open (e.g. Ctrl+B).
  useEffect(() => {
    if (open && initialSection) setSection(initialSection);
  }, [open, initialSection]);

  const updateAi = <K extends keyof AISettings>(key: K, value: AISettings[K]) => {
    onAiChange({ ...aiSettings, [key]: value });
  };

  const handleAiProviderChange = (nextId: ProviderId) => {
    const spec = providerById(nextId);
    const prevSpec = aiSettings.provider ? providerById(aiSettings.provider) : undefined;
    const knownProviderUrl = Object.values(PROVIDER_OPTIONS)
      .map((provider) => providerById(provider.id).defaultBaseUrl)
      .filter(Boolean);
    const usingDefaultUrl =
      !aiSettings.baseUrl ||
      (prevSpec !== undefined && aiSettings.baseUrl === prevSpec.defaultBaseUrl) ||
      knownProviderUrl.includes(aiSettings.baseUrl);
    const usingDefaultModel =
      !aiSettings.model || (prevSpec !== undefined && aiSettings.model === prevSpec.defaultModel);
    onAiChange({
      ...aiSettings,
      provider: nextId,
      baseUrl: usingDefaultUrl ? spec.defaultBaseUrl : aiSettings.baseUrl,
      model: usingDefaultModel ? spec.defaultModel : aiSettings.model,
    });
  };

  const aiSpec = providerById(aiSettings.provider);
  const aiNeedsKey = aiSpec.needsAuth;

  /** Parse a JSON object field (headers / env); null + inline error on failure. */
  const parseJsonObject = (raw: string, label: string): Record<string, string> | null => {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("expected a JSON object");
      }
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        out[k] = String(v);
      }
      return out;
    } catch (e) {
      setMcpError(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };

  const addMcpServer = () => {
    const name = mcpName.trim();
    if (!name) return;
    setMcpError("");
    let server: McpServerConfig;
    if (mcpTransport === "http") {
      const url = mcpUrl.trim();
      if (!url) {
        setMcpError("URL is required for Streamable-HTTP servers.");
        return;
      }
      const headers = parseJsonObject(mcpHeaders, "Headers");
      if (headers === null) return;
      server = {
        id: makeServerId(),
        name,
        enabled: true,
        transport: "http",
        url,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      };
    } else {
      const command = mcpCommand.trim();
      if (!command) {
        setMcpError("Command is required for stdio servers.");
        return;
      }
      const env = parseJsonObject(mcpEnv, "Env");
      if (env === null) return;
      // Split args on whitespace, honouring double-quoted values.
      const args = (mcpArgs.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []).map((a) =>
        a.replace(/^"|"$/g, "")
      );
      server = {
        id: makeServerId(),
        name,
        enabled: true,
        transport: "stdio",
        command,
        args,
        cwd: mcpCwd.trim() || undefined,
        env: Object.keys(env).length > 0 ? env : undefined,
      };
    }
    const next = [...mcpServers, server];
    setMcpServers(next);
    saveMcpServers(next);
    setMcpName("");
    setMcpUrl("");
    setMcpHeaders("");
    setMcpCommand("");
    setMcpArgs("");
    setMcpCwd("");
    setMcpEnv("");
  };

  const toggleMcpServer = (id: string) => {
    const next = mcpServers.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s));
    setMcpServers(next);
    saveMcpServers(next);
  };

  const removeMcpServer = (id: string) => {
    const target = mcpServers.find((s) => s.id === id);
    if (target?.transport === "stdio") void stopStdio(id);
    const next = mcpServers.filter((s) => s.id !== id);
    setMcpServers(next);
    saveMcpServers(next);
  };

  /** Scan for MCP configs other tools already wrote on this machine. */
  const scanForMcpServers = async () => {
    setMcpScanBusy(true);
    try {
      const found = await discoverMcpServers(workspaceRoot);
      setMcpDiscovered(found);
      setMcpImported([]);
      if (found.length === 0) {
        setMcpError(
          "No MCP config files found. Neo looks for Claude Desktop, Cursor, VS Code, Windsurf and .mcp.json — add a server manually if you keep your config elsewhere."
        );
      }
    } finally {
      setMcpScanBusy(false);
    }
  };

  /** Copy one discovered server into our own config, keeping it editable. */
  const importDiscoveredServer = (entry: DiscoveredServer) => {
    // Fresh id: the discovered one is regenerated on every scan, so reusing it
    // would collide with a previously imported copy of the same server.
    const server: McpServerConfig = { ...entry.server, id: makeServerId(), enabled: true };
    const next = [...mcpServers, server];
    setMcpServers(next);
    saveMcpServers(next);
    setMcpImported((prev) => [...prev, serverFingerprint(server)]);
  };

  /** Import every discovered server that isn't already configured. */
  const importAllDiscovered = () => {
    const existing = new Set(mcpServers.map(serverFingerprint));
    const fresh = (mcpDiscovered ?? []).filter((d) => !existing.has(serverFingerprint(d.server)));
    if (fresh.length === 0) return;
    // De-dupe against each other too, so importing "all" from two apps that both
    // list the same server doesn't create a duplicate pair.
    const seen = new Set(existing);
    const toAdd: McpServerConfig[] = [];
    for (const d of fresh) {
      const fp = serverFingerprint(d.server);
      if (seen.has(fp)) continue;
      seen.add(fp);
      toAdd.push({ ...d.server, id: makeServerId(), enabled: true });
    }
    if (toAdd.length === 0) return;
    const next = [...mcpServers, ...toAdd];
    setMcpServers(next);
    saveMcpServers(next);
    setMcpImported(toAdd.map(serverFingerprint));
  };

  /** Live connectivity check: handshake + tools/list. */
  const testMcpServer = async (s: McpServerConfig) => {
    setMcpTest((prev) => ({ ...prev, [s.id]: "…" }));
    try {
      const tools = await listMcpTools(s);
      setMcpTest((prev) => ({
        ...prev,
        [s.id]: `${tools.length} tool${tools.length === 1 ? "" : "s"}`,
      }));
    } catch (e) {
      setMcpTest((prev) => ({
        ...prev,
        [s.id]: `✕ ${e instanceof Error ? e.message : String(e)}`,
      }));
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  // Token usage snapshot for the Dashboard tab; usageTick only forces a
  // re-render every 2s while the tab is open.
  const usageSnapshot = getUsageSnapshot();
  void usageTick;
  const activeMeta = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  return (
    <div
      className="dialog-backdrop fixed inset-0 z-[95] flex items-center justify-center bg-(--scrim) p-2 sm:p-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="panel-in flex h-[min(680px,92vh)] w-full max-w-5xl flex-col overflow-hidden rounded-lg  border-(--border) bg-[var(--bg-base)] sm:flex-row">
        {/* ── Left nav */}
        <aside className="flex shrink-0 flex-col border-b border-(--border) bg-[var(--bg-panel)] sm:w-[212px] sm:border-b-0 sm:border-r">
          <p className="hidden px-3.5 pb-1.5 pt-3.5 text-[11px] text-[var(--text-muted)] sm:block">
            {t("app.settings")}
          </p>
          <div className="hidden px-2.5 pb-2 pt-2.5 sm:block">
            <div className="relative">
              <IoSearch className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--text-faint)]" />
              <input
                type="text"
                value={navQuery}
                onChange={(e) => setNavQuery(e.target.value)}
                placeholder={t("settings.search")}
                spellCheck={false}
                aria-label={t("settings.search")}
                className="h-7 w-full rounded-md bg-(--fill-1) pl-7 pr-2 text-[11.5px] text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-(--border-strong)"
              />
            </div>
          </div>
          <nav className="flex min-h-0 flex-1 items-center gap-0.5 overflow-x-auto p-1.5 sm:flex-col sm:items-stretch sm:overflow-x-visible sm:overflow-y-auto sm:p-2">

            {visibleSections.length === 0 && (
              <p className="hidden px-2 py-3 text-[11px] leading-4 text-[var(--text-muted)] sm:block">
                {t("settings.noSectionMatch", { query: navQuery.trim() })}
              </p>
            )}
            {visibleSections.map((s) => {
              const active = section === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSection(s.id)}
                  aria-current={active ? "page" : undefined}
                  title={s.label}
                  className={`flex shrink-0 items-center justify-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] transition-colors sm:w-full sm:justify-start sm:py-[6px] ${
                    active
                      ? "bg-(--fill-2) text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:bg-(--fill-1) hover:text-[var(--text-primary)]"
                  }`}
                >
                  <span className="hidden min-w-0 flex-1 truncate sm:inline">{s.label}</span>
                  {!signedIn && s.id === "account" && (
                    <span
                      className="hidden shrink-0 text-[var(--text-faint)] sm:inline"
                      role="img"
                      aria-label={t("settings.signInRequired")}
                      title={t("settings.signInRequired")}
                    >
                      <IoLockClosedOutline className="h-3 w-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
          <div className="hidden px-3 py-2.5 text-[10px] text-[var(--text-faint)] sm:block">
            <div ref={buildsInfoRef} className="relative flex items-center justify-between gap-2">
              <span>Neo 1.12 · Beta</span>
              <button
                type="button"
                aria-label="About builds"
                aria-expanded={buildsInfoOpen}
                className="inline-flex items-center text-[var(--text-faint)] transition hover:text-[var(--text-secondary)]"
                onClick={() => setBuildsInfoOpen((v) => !v)}
              >
                <IoInformationCircleOutline className="h-4 w-4" />
              </button>

              {buildsInfoOpen && (
                <div className="absolute bottom-0 left-full z-50 ml-2 w-72 rounded-lg border border-(--border-strong) bg-[var(--bg-elevated)] p-4 text-left shadow-[0_10px_32px_rgba(0,0,0,0.5)]">
                  <p className="text-xs font-medium text-[var(--text-primary)]">
                    About builds
                  </p>

                  <p className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">
                    Neo is a free and open-source project. The official builds are
                    published by Lumorix Studios and are signed with a verified
                    certificate. The official GitHub repository is{" "}
                    <a
                      href="https://github.com/Lumorix-studios/Neo"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--text-primary)] hover:underline"
                    >
                      here
                    </a>
                  </p>

                  <p className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">
                    The "Nightly" builds are automatically generated from the
                    latest code in the main branch. They may contain new features
                    and bug fixes, but they are not guaranteed to be stable.
                  </p>
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* ── Content */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-(--border) px-4 py-2.5">
            <div className="min-w-0">
              <h2 className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                {activeMeta.label}
              </h2>
              <p className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">{activeMeta.hint}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("settings.close")}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
            >
              <IoClose size={12} />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="mx-auto w-full max-w-3xl px-4 py-4">

            {section === "appearance" && (
              <div>
                <SectionTitle>Theme</SectionTitle>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {THEMES.map((t) => {
                    const selected = settings.themeId === t.id && !settings.customBackground;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => onChange({ themeId: t.id, customBackground: null })}
                        className={`rounded-lg border p-2 text-left transition ${
                          selected
                            ? "border-(--accent) bg-(--fill-1)"
                            : "border-(--border) hover:border-(--border-strong) hover:bg-(--fill-1)"
                        }`}
                      >
                        <div className="mb-1.5 flex gap-1">
                          {[t.base, t.panel, t.elevated, t.active].map((c) => (
                            <span
                              key={c}
                              className="h-4 flex-1 rounded-[3px] border border-(--border)"
                              style={{ background: c }}
                            />
                          ))}
                        </div>
                        <span className={`flex items-center gap-1.5 text-[11.5px] ${selected ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}>
                          {t.label}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <SectionTitle>Surface</SectionTitle>
                <Row
                  title="Glassy surfaces"
                  description="Dialogs, menus and the sidebar turn translucent with a soft blur behind them."
                >
                  <Toggle checked={settings.glass ?? true} onChange={(v) => onChange({ glass: v })} />
                </Row>

                <SectionTitle>Accent</SectionTitle>
                <div className="flex items-center gap-2">
                  {ACCENT_SWATCHES.map((a) => (
                    <button
                      key={a.value}
                      type="button"
                      title={a.label}
                      onClick={() => onChange({ accent: a.value })}
                      className={`h-5 w-5 rounded-full border transition ${
                        settings.accent === a.value
                          ? "border-(--text-primary)"
                          : "border-(--border-strong) hover:border-(--text-muted)"
                      }`}
                      style={{ background: a.value }}
                    />
                  ))}
                  <input
                    type="color"
                    value={isValidHex(settings.accent) ? settings.accent : "var(--accent)"}
                    onChange={(e) => onChange({ accent: e.target.value })}
                    title="Custom accent"
                    className="h-6 w-9 cursor-pointer rounded border border-(--border) bg-transparent p-0.5"
                  />
                </div>
                <Row title={languageLabels.changeLanguage}>
                  <select
                    value={selectedValue}
                    onChange={handleLanguageChange}
                    className="w-48 appearance-none rounded-md border border-(--border) bg-(--fill-1) py-1.5 pl-2.5 pr-8 text-[12px] text-[var(--text-primary)] outline-none transition focus:border-(--border-strong)"
                  >
                    <option value="" disabled>{languageLabels.select}</option>
                    {LANGUAGE_OPTIONS.map((language) => (
                      <option key={language} value={language}>
                        {language}
                      </option>
                    ))}
                  </select>
                </Row>
                          </div>
            )}
            {section === "account" && (
              <AccountSection
                account={account}
                profile={accountProfile}
                authLoading={accountLoading}
                onAccountRefresh={refreshAccount}
              />
            )}
            {section === "ai" &&
              (showLocalModels ? (
                <div className="h-full">
                  <LocalModels
                    onClose={() => setShowLocalModels(false)}
                    onSelectModel={async (modelName) => {
                      // Only close the browser when the model is usable.
                      const err = (await onSelectLocalModel(modelName)) ?? null;
                      if (!err) setShowLocalModels(false);
                      return err;
                    }}
                    selectedModel={aiSettings.model}
                  />
                </div>
              ) : (
              <div>
                <SectionTitle>Provider</SectionTitle>
                <Row title="AI provider" description="Where chat requests are sent.">
                  <div className="relative shrink-0">
                    <select
                      value={aiSettings.provider}
                      onChange={(e) => handleAiProviderChange(e.target.value as ProviderId)}
                      className="w-48 appearance-none rounded-md border border-(--border) bg-(--fill-1) py-1.5 pl-2.5 pr-8 text-[12px] text-[var(--text-primary)] outline-none transition focus:border-(--border-strong)"
                    >
                      {PROVIDER_OPTIONS.map((p) => (
                        <option key={p.id} value={p.id} className="bg-[var(--bg-elevated)]">
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </Row>
                {(aiSpec.note || aiNeedsKey) && (
                  <p className="pb-3 text-[11px] leading-4 text-[var(--text-muted)]">
                    {aiSpec.note ??
                      'API key required — it is sent to your provider as configured; the provider itself rejects invalid keys with a clear error.'}
                  </p>
                )}
                <Row title="Local models" description="Browse, pull and run models locally with Ollama.">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowLocalModels(true)}
                      className="shrink-0 rounded-md border border-(--border-strong) px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
                    >
                      Browse
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        setIsCheckingPorts(true);
                        try {
                          const startupError = await ensureOllamaReady();
                          if (startupError) {
                            setDiscoveredPort(startupError);
                          } else {
                            const port = await findAvailableOllamaPort();
                            if (port) {
                              setDiscoveredPort(port);
                              updateAi("baseUrl", port);
                            } else {
                              setDiscoveredPort("No Ollama server found");
                            }
                          }
                        } catch (error) {
                          setDiscoveredPort(
                            error instanceof Error ? error.message : String(error)
                          );
                        } finally {
                          setIsCheckingPorts(false);
                        }
                      }}
                      disabled={isCheckingPorts}
                      className="shrink-0 rounded-md border border-(--border-strong) px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)] disabled:opacity-50"
                    >
                      {isCheckingPorts ? "Scanning..." : "Auto-Detect Server"}
                    </button>
                  </div>
                </Row>
                {discoveredPort && (
                  <p
                    className={`mb-3 text-[10px] ${
                      discoveredPort === "No Ollama server found" ||
                      discoveredPort.toLowerCase().includes("could not") ||
                      discoveredPort.toLowerCase().includes("install")
                        ? "text-red-400/80"
                        : "text-emerald-400/80"
                    }`}
                  >
                    {discoveredPort === "No Ollama server found"
                      ? "✕ No Ollama server found. Install Ollama, then try again."
                      : `✓ Connected to server at ${discoveredPort}`}
                  </p>
                )}
                <SectionTitle>Connection</SectionTitle>
                <Row title="API endpoint" description="Base URL used for chat requests.">
                  <input
                    type="text"
                    value={aiSettings.baseUrl}
                    onChange={(e) => updateAi("baseUrl", e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    spellCheck={false}
                    className="w-56 shrink-0 rounded-md border border-(--border) bg-(--fill-1) px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-(--border-strong)"
                  />
                </Row>
                <Row title="API key" description={
                  !aiNeedsKey
                    ? "Not required for this provider."
                    : accountLoading
                      ? "Checking your account before loading provider keys."
                      : !signedIn
                        ? "Sign in required — keys live in your account."
                        : byokEntitled
                          ? "Stored encrypted (AES-256-GCM) in your account — never written to disk."
                          : "Locked — sign in to store a provider key in your account."
                }>
                  {aiNeedsKey && !accountLoading && byokEntitled && (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          keyConfigured ? "bg-emerald-500" : "bg-zinc-600"
                        }`}
                      />
                      <span className="text-[10.5px] text-[var(--text-muted)]">
                        {keyConfigured ? "configured" : "not set"}
                      </span>
                    </div>
                  )}
                  {aiNeedsKey && byokLocked && (
                    <span className="shrink-0 text-[10.5px] text-[var(--text-muted)]">locked</span>
                  )}
                </Row>
                {aiNeedsKey && accountLoading && (
                  <p className="pb-3 text-[11px] leading-4 text-[var(--text-muted)]">
                    Checking your saved session before loading API keys.
                  </p>
                )}
                {aiNeedsKey && byokEntitled && (
                  <div className="flex flex-col gap-1.5 pb-3">
                    <p className="text-[10.5px] leading-4 text-[var(--text-muted)]">
                      Your key is encrypted before it is stored in your account. It is only
                      decrypted in memory when Neo needs it.
                    </p>
                    <div className="flex gap-1.5">
                      <div className="relative flex-1">
                        <input
                          type={showAiKey ? "text" : "password"}
                          value={byokDraft}
                          onChange={(e) => setByokDraft(e.target.value)}
                          placeholder={
                            keyConfigured ? "•••••••••••• (enter a new key to replace)" : "Enter API key"
                          }
                          spellCheck={false}
                          autoComplete="off"
                          aria-label={`${providerById(aiSettings.provider).label} API key`}
                          disabled={accountLoading}
                          className="w-full rounded-md border border-(--border) bg-(--fill-1) py-1.5 pl-2.5 pr-14 text-[12px] text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-(--border-strong)"
                        />
                        <button
                          type="button"
                          onClick={() => setShowAiKey((v) => !v)}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-[10.5px] text-[var(--text-muted)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
                        >
                          {showAiKey ? "Hide" : "Show"}
                        </button>
                      </div>
                      <button
                        type="button"
                        disabled={byokBusy || accountLoading || !byokDraft.trim()}
                        title="Encrypt and save this key to your account"
                        onClick={() => void handleSaveByokKey()}
                        className="shrink-0 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition disabled:opacity-40"
                        style={{ background: "var(--accent)", color: "var(--on-accent)" }}
                      >
                        Save
                      </button>
                      {keyConfigured && (
                        <button
                          type="button"
                          disabled={byokBusy || accountLoading}
                          onClick={() => void handleRemoveByokKey()}
                          className="shrink-0 rounded-md border border-(--border-strong) px-2.5 py-1.5 text-[11px] text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)] disabled:opacity-40"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    {byokMsg && (
                      <p className="text-[10.5px] leading-4 text-[var(--text-muted)]">{byokMsg}</p>
                    )}
                  </div>
                )}
                {aiNeedsKey && byokLocked && (
                  <div className="flex flex-col gap-2 pb-3">
                    <p className="text-[11px] leading-4 text-[var(--text-muted)]">
                      Provider keys live in your account, encrypted server-side and never written to
                      disk. Sign in or create an account to add one.
                    </p>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSection("account")}
                        className="rounded-md border border-(--border-strong) px-2.5 py-1 text-[11px] font-medium transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
                        style={{ background: "var(--accent)", color: "var(--on-accent)", borderColor: "transparent" }}
                      >
                        Sign in
                      </button>
                    </div>
                  </div>
                )}

                <SectionTitle>Model</SectionTitle>
                <Row title="Model ID" description="Model identifier sent to the provider.">
                  <input
                    type="text"
                    value={aiSettings.model}
                    onChange={(e) => updateAi("model", e.target.value)}
                    placeholder="e.g. gpt-4o-mini"
                    spellCheck={false}
                    className="w-56 shrink-0 rounded-md border border-(--border) bg-(--fill-1) px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-(--border-strong)"
                  />
                </Row>
                <Row title="Temperature" description="Higher values make output more creative.">
                  <Slider value={aiSettings.temperature} min={0} max={2} step={0.1} onChange={(v) => updateAi("temperature", v)} />
                </Row>
                <SectionTitle>Behavior</SectionTitle>
                <Row title="Auto-approve tools" description="Agent file edits and shell commands run without asking.">
                  <Toggle checked={!!aiSettings.autoApproveTools} onChange={(v) => updateAi("autoApproveTools", v)} />
                </Row>
                <div className="pb-2 pt-1">
                  <p className="mb-1.5 text-[12.5px] font-medium text-[var(--text-primary)]">System prompt</p>
                  <textarea
                    value={aiSettings.systemPrompt}
                    onChange={(e) => updateAi("systemPrompt", e.target.value)}
                    rows={4}
                    placeholder="You are a helpful, professional assistant."
                    className="w-full resize-none rounded-md border border-(--border) bg-(--fill-1) px-2.5 py-2 text-[12.5px] leading-5 text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-(--border-strong)"
                  />
                </div>

                <SectionTitle>MCP servers</SectionTitle>
                <div className="flex flex-col gap-2 pb-2">
                  {/* Auto-discovery: pick up servers the user already configured
                      in Claude Desktop / Cursor / VS Code / Windsurf / .mcp.json. */}
                  <div className="rounded-md border border-dashed border-(--border-strong) bg-(--fill-1) px-2.5 py-2">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-medium text-[var(--text-primary)]">
                          Import from other apps
                        </p>
                        <p className="text-[10.5px] leading-4 text-[var(--text-muted)]">
                          Scans Claude Desktop, Cursor, VS&nbsp;Code, Windsurf and{" "}
                          <code className="font-mono text-[10px]">.mcp.json</code> for servers you
                          already set up. Imported servers stay fully editable here.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void scanForMcpServers()}
                        disabled={mcpScanBusy}
                        className="shrink-0 rounded border border-(--border-strong) px-2 py-1 text-[10.5px] text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)] disabled:opacity-50"
                      >
                        {mcpScanBusy ? "Scanning…" : "Scan"}
                      </button>
                    </div>

                    {mcpDiscovered !== null && mcpDiscovered.length > 0 && (
                      <div className="mt-2 flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-[var(--text-faint)]">
                            {mcpDiscovered.length} found
                          </span>
                          <button
                            type="button"
                            onClick={importAllDiscovered}
                            className="rounded border border-(--border-strong) px-2 py-0.5 text-[10px] text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
                          >
                            Import all
                          </button>
                        </div>
                        {mcpDiscovered.map((d, i) => {
                          const fp = serverFingerprint(d.server);
                          const already = mcpServers.some((s) => serverFingerprint(s) === fp);
                          const done = already || mcpImported.includes(fp);
                          return (
                            <div
                              key={`${d.path}:${d.name}:${i}`}
                              className="flex items-center gap-2 rounded border border-(--border) bg-(--bg-elevated) px-2 py-1.5"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate text-[11.5px] font-medium text-[var(--text-primary)]">
                                    {d.name}
                                  </span>
                                  <span className="shrink-0 rounded border border-(--border-strong) px-1 py-px text-[9px] uppercase tracking-wide text-[var(--text-faint)]">
                                    {d.server.transport}
                                  </span>
                                </div>
                                <div className="truncate text-[10px] text-[var(--text-faint)]">
                                  {describeServer(d.server)}
                                </div>
                                <div className="truncate text-[9.5px] text-[var(--text-faint)]">
                                  from {d.app}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => importDiscoveredServer(d)}
                                disabled={done}
                                className="shrink-0 rounded border border-(--border-strong) px-2 py-1 text-[10px] text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)] disabled:opacity-40"
                              >
                                {done ? "Added" : "Import"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {mcpServers.length === 0 && (
                    <p className="text-[11px] leading-4 text-[var(--text-muted)]">
                      Connect MCP servers to extend the agent with external tools — remote
                      Streamable-HTTP endpoints or local stdio commands.
                    </p>
                  )}
                  {mcpServers.map((s) => (
                    <div key={s.id} className="flex items-center gap-2 rounded-md border border-(--border) bg-(--fill-1) px-2.5 py-2">
                      <button
                        type="button"
                        onClick={() => toggleMcpServer(s.id)}
                        title={s.enabled ? "Disable" : "Enable"}
                        className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${
                          s.enabled ? "bg-(--accent)" : "bg-(--fill-3)"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${
                            s.enabled ? "left-[14px]" : "left-0.5"
                          }`}
                        />
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className={`truncate text-[12px] font-medium ${s.enabled ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}>
                            {s.name}
                          </span>
                          <span className="shrink-0 rounded border border-(--border-strong) px-1 py-px text-[9px] uppercase tracking-wide text-[var(--text-faint)]">
                            {s.transport}
                          </span>
                        </div>
                        <div className="truncate text-[10px] text-[var(--text-faint)]">{describeServer(s)}</div>
                        {mcpTest[s.id] && (
                          <div className={`truncate text-[10px] ${mcpTest[s.id].startsWith("✕") ? "text-red-400/80" : "text-emerald-400/80"}`}>
                            {mcpTest[s.id]}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => void testMcpServer(s)}
                        title="Handshake + list tools"
                        className="shrink-0 rounded border border-(--border-strong) px-2 py-1 text-[10.5px] text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
                      >
                        Test
                      </button>
                      <button
                        type="button"
                        onClick={() => removeMcpServer(s.id)}
                        aria-label={`Remove ${s.name}`}
                        className="shrink-0 rounded p-1 text-[var(--text-muted)] transition hover:bg-red-500/10 hover:text-red-400"
                      >
                        <IoClose size={11} />
                      </button>
                    </div>
                  ))}
                  {/* Transport picker */}
                  <div className="flex items-center gap-1 self-start rounded-md border border-(--border) bg-(--fill-1) p-0.5">
                    {(["http", "stdio"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setMcpTransport(t)}
                        className={`rounded px-2.5 py-1 text-[11px] transition ${
                          mcpTransport === t
                            ? "bg-(--fill-2) text-[var(--text-primary)]"
                            : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                        }`}
                      >
                        {t === "http" ? "HTTP endpoint" : "Local command"}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={mcpName}
                    onChange={(e) => setMcpName(e.target.value)}
                    placeholder="Server name (e.g. filesystem)"
                    spellCheck={false}
                    className="w-full rounded-md border border-(--border) bg-(--fill-1) px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-(--border-strong)"
                  />
                  {mcpTransport === "http" ? (
                    <>
                      <input
                        type="text"
                        value={mcpUrl}
                        onChange={(e) => setMcpUrl(e.target.value)}
                        placeholder="http://localhost:3000/mcp"
                        spellCheck={false}
                        className="w-full rounded-md border border-(--border) bg-(--fill-1) px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-(--border-strong)"
                      />
                      <input
                        type="text"
                        value={mcpHeaders}
                        onChange={(e) => setMcpHeaders(e.target.value)}
                        placeholder='Headers JSON (optional) — e.g. {"Authorization": "Bearer <your token>"}'
                        spellCheck={false}
                        className="w-full rounded-md border border-(--border) bg-(--fill-1) px-2.5 py-1.5 font-mono text-[11px] text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-(--border-strong)"
                      />
                    </>
                  ) : (
                    <>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={mcpCommand}
                          onChange={(e) => setMcpCommand(e.target.value)}
                          placeholder="Command (e.g. npx)"
                          spellCheck={false}
                          className="min-w-0 flex-1 rounded-md border border-(--border) bg-(--fill-1) px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-(--border-strong)"
                        />
                        <input
                          type="text"
                          value={mcpArgs}
                          onChange={(e) => setMcpArgs(e.target.value)}
                          placeholder='Args (e.g. -y @modelcontextprotocol/server-filesystem C:\projects)'
                          spellCheck={false}
                          className="min-w-0 flex-[1.6] rounded-md border border-(--border) bg-(--fill-1) px-2.5 py-1.5 font-mono text-[11px] text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-(--border-strong)"
                        />
                      </div>
                      <input
                        type="text"
                        value={mcpCwd}
                        onChange={(e) => setMcpCwd(e.target.value)}
                        placeholder="Working directory (optional) — e.g. %LOCALAPPDATA%\Roblox"
                        spellCheck={false}
                        className="w-full rounded-md border border-(--border) bg-(--fill-1) px-2.5 py-1.5 font-mono text-[11px] text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-(--border-strong)"
                      />
                      <input
                        type="text"
                        value={mcpEnv}
                        onChange={(e) => setMcpEnv(e.target.value)}
                        placeholder='Env JSON (optional) — e.g. {"API_TOKEN": "<your token>"}'
                        spellCheck={false}
                        className="w-full rounded-md border border-(--border) bg-(--fill-1) px-2.5 py-1.5 font-mono text-[11px] text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-(--border-strong)"
                      />
                    </>
                  )}
                  {mcpError && (
                    <p className="text-[10.5px] leading-4 text-red-400/90">{mcpError}</p>
                  )}
                  <button
                    type="button"
                    onClick={addMcpServer}
                    disabled={!mcpName.trim()}
                    className="self-start rounded-md border border-(--border-strong) px-3 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Add Server
                  </button>
                </div>

                <p className="pt-1 text-[10.5px] text-[var(--text-faint)]">
                  {signedIn
                    ? "AI settings sync to your account. Provider keys are stored separately, encrypted."
                    : "AI settings are stored locally on this device. Sign in to sync them and to add provider keys."}
                </p>
              </div>
              ))}
            {section === "editor" && (
              <div>
                <SectionTitle>Typography</SectionTitle>
                <Row title="Font size" description="Size of the code text in the editor.">
                  <Slider value={settings.editorFontSize} min={10} max={18} step={0.5} unit="px" onChange={(v) => onChange({ editorFontSize: v })} />
                </Row>
                <Row title="Line height" description="Vertical space per line.">
                  <Slider value={settings.editorLineHeight} min={16} max={30} step={1} unit="px" onChange={(v) => onChange({ editorLineHeight: v })} />
                </Row>

                <SectionTitle>Behavior</SectionTitle>
                <Row title="Word wrap" description="Soft-wrap long lines instead of horizontal scrolling.">
                  <Toggle checked={settings.wordWrap} onChange={(v) => onChange({ wordWrap: v })} />
                </Row>
                <Row title="Line numbers" description="Show the gutter with line numbers.">
                  <Toggle checked={settings.showLineNumbers} onChange={(v) => onChange({ showLineNumbers: v })} />
                </Row>
                <Row title="Tab size" description="Spaces inserted per indent level.">
                  <div className="flex shrink-0 overflow-hidden rounded-md border border-(--border)">
                    {[2, 4, 8].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => onChange({ tabSize: n })}
                        className={`px-3 py-1 text-[11.5px] transition ${
                          settings.tabSize === n
                            ? "bg-(--fill-3) text-[var(--text-primary)]"
                            : "text-[var(--text-secondary)] hover:bg-(--fill-2)"
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </Row>
              </div>
            )}

            {section === "files" && (
              <div>
                <SectionTitle>Auto save</SectionTitle>
                <Row title="Auto save" description="Persist dirty editor tabs automatically.">
                  <Toggle checked={settings.autoSave} onChange={(v) => onChange({ autoSave: v })} />
                </Row>
                {settings.autoSave && (
                  <Row title="Auto save delay" description="How long to wait after the last keystroke.">
                    <Slider value={settings.autoSaveDelayMs} min={500} max={3000} step={250} unit="ms" onChange={(v) => onChange({ autoSaveDelayMs: v })} />
                  </Row>
                )}

                <SectionTitle>Privacy</SectionTitle>
                <Row title="Clear recents" description="Removes the recent files and folders lists shown on the empty states.">
                  <button
                    type="button"
                    onClick={() => {
                      clearRecentFiles();
                      clearRecentFolders();
                    }}
                    className="shrink-0 rounded-md border border-(--border-strong) px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
                  >
                    Clear
                  </button>
                </Row>
              </div>
            )}

            {section === "shortcuts" && (
              <div>
                <SectionTitle>Keyboard shortcuts</SectionTitle>
                <div className="overflow-hidden rounded-lg border border-(--border)">
                  {SHORTCUTS.map(([keys, label], i) => (
                    <div
                      key={keys}
                      className={`flex items-center justify-between px-3 py-2 ${i % 2 === 0 ? "bg-(--fill-1)" : ""}`}
                    >
                      <span className="text-[12px] text-[var(--text-secondary)]">{label}</span>
                      <span className="kbd">{keys}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}


            {section === "terminal" && (
              <div>
                <SectionTitle>Typography</SectionTitle>
                <Row title="Font size" description="Size of the terminal text.">
                  <Slider value={settings.terminalFontSize} min={8} max={20} step={0.5} unit="px" onChange={(v) => onChange({ terminalFontSize: v })} />
                </Row>

                <SectionTitle>Buffer</SectionTitle>
                <Row title="Scrollback" description="How much output history is kept per terminal.">
                  <Slider value={settings.terminalScrollback} min={100} max={10000} step={100} onChange={(v) => onChange({ terminalScrollback: v })} />
                </Row>

                <SectionTitle>Cursor</SectionTitle>
                <Row title="Cursor blink" description="Blink the block cursor in terminals.">
                  <Toggle checked={settings.terminalCursorBlink} onChange={(v) => onChange({ terminalCursorBlink: v })} />
                </Row>

                <p className="pt-2 text-[10.5px] text-[var(--text-faint)]">
                  Changes apply instantly to open terminals; new terminals pick them up automatically.
                </p>
              </div>
            )}

            {section === "dashboard" && (
              <div>
                <SectionTitle>Usage today</SectionTitle>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "Requests", value: usageSnapshot.today.requests },
                    { label: "Input tokens", value: usageSnapshot.today.input },
                    { label: "Output tokens", value: usageSnapshot.today.output },
                  ].map((s) => (
                    <div
                      key={s.label}
                      className="rounded-lg border border-(--border) bg-(--fill-1) px-3 py-2.5"
                    >
                      <p className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                        {s.label}
                      </p>
                      <p className="mt-1 text-[15px] font-semibold tabular-nums text-[var(--text-primary)]">
                        {formatTokens(s.value)}
                      </p>
                    </div>
                  ))}
                </div>

                <SectionTitle>Last 7 days</SectionTitle>
                <div className="flex h-24 items-end gap-1.5">
                  {usageSnapshot.last7.map((d) => {
                    const total = d.input + d.output;
                    const max = Math.max(
                      ...usageSnapshot.last7.map((x) => x.input + x.output),
                      1
                    );
                    const dayLabel = new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, {
                      weekday: "narrow",
                    });
                    return (
                      <div
                        key={d.date}
                        className="flex min-w-0 flex-1 flex-col items-center gap-1"
                        title={`${d.date}: ${total.toLocaleString()} tokens · ${d.requests} requests`}
                      >
                        <span className="text-[9px] tabular-nums text-[var(--text-faint)]">
                          {total > 0 ? formatTokens(total) : ""}
                        </span>
                        <div
                          className="w-full rounded-t-sm bg-(--accent)/70"
                          style={{ height: `${Math.max(4, Math.round((total / max) * 72))}px` }}
                        />
                        <span className="text-[9.5px] text-[var(--text-faint)]">{dayLabel}</span>
                      </div>
                    );
                  })}
                </div>

                <SectionTitle>Rate limits</SectionTitle>
                <Row title="Enforce token limits" description="Pause AI requests when a limit below is hit.">
                  <Toggle
                    checked={rateSettings.enabled}
                    onChange={(v) => {
                      const next = { ...rateSettings, enabled: v };
                      setRateSettings(next);
                      void saveTokenRateSettings(next);
                    }}
                  />
                </Row>
                <Row title="Tokens per minute" description="Rolling 60-second window. 0 = unlimited.">
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={rateSettings.maxTokensPerMinute}
                    onChange={(e) => {
                      const next = {
                        ...rateSettings,
                        maxTokensPerMinute: Math.max(0, Math.round(Number(e.target.value) || 0)),
                      };
                      setRateSettings(next);
                      void saveTokenRateSettings(next);
                    }}
                    className="w-24 rounded-md border border-(--border-strong) bg-(--fill-1) px-2 py-1 text-right text-[11.5px] tabular-nums text-[var(--text-primary)] outline-none"
                  />
                </Row>
                <Row title="Tokens per day" description="Calendar-day budget. 0 = unlimited.">
                  <input
                    type="number"
                    min={0}
                    step={10000}
                    value={rateSettings.maxTokensPerDay}
                    onChange={(e) => {
                      const next = {
                        ...rateSettings,
                        maxTokensPerDay: Math.max(0, Math.round(Number(e.target.value) || 0)),
                      };
                      setRateSettings(next);
                      void saveTokenRateSettings(next);
                    }}
                    className="w-24 rounded-md border border-(--border-strong) bg-(--fill-1) px-2 py-1 text-right text-[11.5px] tabular-nums text-[var(--text-primary)] outline-none"
                  />
                </Row>

                <SectionTitle>Recent usage</SectionTitle>
                {usageSnapshot.recent.length === 0 ? (
                  <p className="text-[11.5px] text-[var(--text-muted)]">
                    No AI requests recorded yet.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {usageSnapshot.recent.slice(0, 8).map((r, i) => (
                      <div
                        key={`${r.at}-${i}`}
                        className="flex items-center justify-between rounded-md border border-(--border) px-3 py-1.5 text-[11px]"
                      >
                        <span className="min-w-0 truncate text-white-600">
                          {r.provider} · {r.model}
                        </span>
                        <span className="ml-3 shrink-0 tabular-nums text-emerald-400">
                          {new Date(r.at).toLocaleTimeString()} | Input:{formatTokens(r.input)} | Output:{formatTokens(r.output)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <Row title="Reset usage data" description="Clears all recorded token usage history.">
                  <button
                    type="button"
                    onClick={() => {
                      void resetUsage();
                      setUsageTick((t) => t + 1);
                    }}
                    className="shrink-0 rounded-md border border-(--border-strong) px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
                  >
                    Reset
                  </button>
                </Row>

                <p className="pt-2 text-[10.5px] text-[var(--text-faint)]">
                  Counts include chat and agent rounds — exact when the provider reports usage,
                  char/4 estimates otherwise. 
                </p>
              </div>
            )}

            {section === "data" && (
              <div>
                <SectionTitle>Backup</SectionTitle>
                <Row title="Export settings" description="Download all UI and AI settings as a JSON file.">
                  <button
                    type="button"
                    onClick={() => {
                      exportSettingsSnapshot(settings, aiSettings);
                      alert("Settings exported successfully in your downloads folder.");
                    }}
                    className="shrink-0 rounded-md border border-(--border-strong) px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
                  >
                    Export JSON
                    <></>
                  </button>
                </Row>

                <SectionTitle>Local caches</SectionTitle>
                <Row title="Clear MCP servers" description="Removes all configured MCP server endpoints.">
                  <button
                    type="button"
                    onClick={() => {
                      setMcpServers([]);
                      saveMcpServers([]);
                    }}
                    className="shrink-0 rounded-md border border-(--border-strong) px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
                  >
                    Clear
                  </button>
                </Row>
                <Row title="Clear recents" description="Removes the recent files and folders lists.">
                  <button
                    type="button"
                    onClick={() => {
                      clearRecentFiles();
                      clearRecentFolders();
                    }}
                    className="shrink-0 rounded-md border border-(--border-strong) px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
                  >
                    Clear
                  </button>
                </Row>

                <p className="pt-2 text-[10.5px] text-[var(--text-faint)]">
                  {signedIn
                    ? "Chats, AI settings and your profile sync to your account. Everything else lives on this device."
                    : "Signed out: everything lives on this device — no cloud sync, no telemetry."}
                </p>

                {signedIn && (
                  <>
                    <SectionTitle>Cloud data</SectionTitle>
                    <Row
                      title="Delete cloud data"
                      description="Permanently removes your chats, synced AI settings and stored API keys from your account. Local data is kept."
                    >
                      <button
                        type="button"
                        disabled={cloudBusy}
                        onClick={async () => {
                          if (
                            !window.confirm(
                              "Delete all chats, synced settings and stored API keys from your account? This cannot be undone."
                            )
                          ) {
                            return;
                          }
                          setCloudBusy(true);
                          setCloudMsg(null);
                          try {
                            await cloudSync.deleteAllCloudData();
                            setCloudMsg("Cloud data deleted.");
                          } catch (e) {
                            setCloudMsg(e instanceof Error ? e.message : String(e));
                          } finally {
                            setCloudBusy(false);
                          }
                        }}
                        className="shrink-0 rounded-md border border-red-400/40 px-2.5 py-1 text-[11px] text-red-400/90 transition hover:bg-red-400/10 disabled:opacity-40"
                      >
                        {cloudBusy ? "Deleting…" : "Delete"}
                      </button>
                    </Row>
                    {cloudMsg && (
                      <p className="pt-1 text-[10.5px] leading-4 text-[var(--text-muted)]">{cloudMsg}</p>
                    )}
                  </>
                )}
              </div>
            )}

            {section === "about" && (
              <div>
                <div className="flex items-center gap-3 py-2">
                  <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border border-(--border) bg-(--fill-1)">
                    <img src={appIcon} alt="Neo logo" className="h-full w-full object-contain" />
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-[var(--text-primary)]">Neo</p>
                    <p className="text-[11px] text-[var(--text-muted)]">Version 1.12 (Beta)</p>
                  </div>
                </div>

                <SectionTitle>Important information</SectionTitle>
                <p className="text-[11.5px] leading-5 text-[var(--text-secondary)]">
                 UI settings, MCP servers, token usage and terminal state are stored
                 locally on this device. When you sign in, your chats, AI settings, profile and
                 BYOK API keys are stored in your Supabase account (API keys encrypted
                 server-side). No telemetry is collected. The AI provider you choose may collect
                 data according to their own privacy policy.
                </p>
                <p className = "text-[11.5px] leading-5 text-[var(--text-secondary)]">
                  Neo is in early beta — some features may not work as expected. Please report bugs on the GitHub repository.
                </p>
                <SectionTitle>Links</SectionTitle>
                <div className="flex flex-col gap-1">
                  {[
                    ["GitHub repository", "https://github.com/Lumorix-Studios/Neo"],
                    ["Report an issue", "https://github.com/Lumorix-Studios/Neo/issues"],
                  ].map(([label, href]) => (
                    <a
                      key={href}
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between rounded-md border border-(--border) px-3 py-2 text-[12px] text-[var(--text-secondary)] transition hover:bg-(--fill-1) hover:text-[var(--text-primary)]"
                    >
                      {label}
                      <IoOpenOutline size={10} />
                    </a>
                  ))}
                </div>

</div>
            )}
            </div>
          </div>
          {/* Footer */}
          <footer className="flex h-10 shrink-0 items-center justify-between border-t border-(--border) px-4">
            <span className="flex items-center gap-1.5 text-[10.5px] text-[var(--text-faint)]">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {t("settings.changesInstant")}
            </span>
            <button
              type="button"
              onClick={() => onChange({ ...DEFAULT_UI_SETTINGS })}
              className="rounded-lg border border-(--border-strong) px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
            >
              {t("settings.resetAll")}
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}

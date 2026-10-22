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
import LlamaCppModels from "../../components/LlamaCppModels";
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
import PluginsPanel from "../../components/plugins";


export type SectionId =
  | "dashboard"
  | "appearance"
  | "ai"
  | "editor"
  | "terminal"
  | "files"
  | "plugins"
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
    <div className="flex flex-col gap-2.5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
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
    app: "Struct",
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
  labelKey: string;
  hintKey: string;
  groupKey: string;
  keywords: string;
}

const SECTIONS: SectionMeta[] = [
  {
    id: "account",
    label: "Account",
    hint: "Profile, sync and signed-in devices",
    group: "Personal",
    labelKey: "settings.account",
    hintKey: "settings.hintAccount",
    groupKey: "settings.navGroupPersonal",
    keywords: "profile email plan sign in sign out sync avatar name",
  },
  {
    id: "appearance",
    label: "Appearance",
    hint: "Theme, glass, accent and language",
    group: "Workspace",
    labelKey: "settings.appearance",
    hintKey: "settings.hintAppearance",
    groupKey: "settings.navGroupWorkspace",
    keywords: "theme dark light color colour accent glass translucent blur background contrast",
  },
  {
    id: "ai",
    label: "AI",
    hint: "Providers, models, keys and MCP tools",
    group: "Workspace",
    labelKey: "settings.ai",
    hintKey: "settings.hintAi",
    groupKey: "settings.navGroupWorkspace",
    keywords: "provider model api key byok ollama openai anthropic google groq mcp tools",
  },
  {
    id: "dashboard",
    label: "Dashboard",
    hint: "Token usage, budgets and rate-limit estimates",
    group: "Workspace",
    labelKey: "settings.dashboard",
    hintKey: "settings.hintDashboard",
    groupKey: "settings.navGroupWorkspace",
    keywords: "tokens usage cost rate limits statistics budget",
  },
  {
    id: "files",
    label: "Files & Save",
    hint: "Autosave and recent items",
    group: "Workspace",
    labelKey: "settings.files",
    hintKey: "settings.hintFiles",
    groupKey: "settings.navGroupWorkspace",
    keywords: "autosave recent files folders save",
  },
  {
    id: "plugins",
    label: "Add new plugins",
    hint: "Expand agent tools",
    group: "Workspace",
    labelKey: "settings.labelPlugins",
    hintKey: "settings.hintPlugins",
    groupKey: "settings.navGroupWorkspace",
    keywords: "tools",
  },
  {
    id: "shortcuts",
    label: "Shortcuts",
    hint: "Keyboard bindings at a glance",
    group: "Workspace",
    labelKey: "settings.shortcuts",
    hintKey: "settings.hintShortcuts",
    groupKey: "settings.navGroupWorkspace",
    keywords: "keyboard keys hotkeys bindings commands",
  },
  {
    id: "terminal",
    label: "Terminal",
    hint: "Shell, fonts and scrollback",
    group: "System",
    labelKey: "settings.terminal",
    hintKey: "settings.hintTerminal",
    groupKey: "settings.navGroupSystem",
    keywords: "shell command prompt font cursor scrollback",
  },
  {
    id: "data",
    label: "Privacy & Data",
    hint: "Local storage, cloud data and recents",
    group: "System",
    labelKey: "settings.privacy",
    hintKey: "settings.hintPrivacy",
    groupKey: "settings.navGroupSystem",
    keywords: "privacy data storage cloud delete clear recents reset",
  },
  {
    id: "about",
    label: "About",
    hint: "Version, links and build information",
    group: "System",
    labelKey: "settings.about",
    hintKey: "settings.hintAbout",
    groupKey: "settings.navGroupSystem",
    keywords: "version update github links help credits",
  },
];

const SHORTCUTS: Array<[string, string, string]> = [
  ["Ctrl+Shift+P", "Command palette", "settings.scCommand"],
  ["Ctrl+B", "Open AI settings", "settings.scAi"],
  ["Ctrl+Shift+E", "Toggle code editor", "settings.scEditor"],
  ["Ctrl+Shift+G", "Toggle git panel", "settings.scGit"],
  ["Ctrl+Shift+H", "Toggle chat history", "settings.scHistory"],
  ["Ctrl+`", "Toggle terminal dock", "settings.scTerm"],
  ["Ctrl+S", "Save active file", "settings.scSave"],
  ["Ctrl+/", "Toggle line comment", "settings.scComment"],
  ["Ctrl+,", "Open settings", "settings.scSettings"],
];


const ACCENT_LABEL_KEYS: Record<string, string> = {
  Blue: "settings.accentBlue",
  Violet: "settings.accentViolet",
  Emerald: "settings.accentEmerald",
  Cyan: "settings.accentCyan",
  Amber: "settings.accentAmber",
  Rose: "settings.accentRose",
  Lime: "settings.accentLime",
  Magenta: "settings.accentMagenta",
  Orange: "settings.accentOrange",
  Sky: "settings.accentSky",
  Gold: "settings.accentGold",
  Mint: "settings.accentMint",
};

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
  const translatedSections = SECTIONS.map((item) => ({
    ...item,
    label: t(item.labelKey) || item.label,
    hint: t(item.hintKey) || item.hint,
    group: t(item.groupKey) || item.group,
  }));
  const visibleSections = navQueryNormalized
    ? translatedSections.filter((s) =>
        `${s.label} ${s.hint} ${s.group} ${s.keywords}`.toLowerCase().includes(navQueryNormalized)
      )
    : translatedSections;
  // Stable callbacks: keep AccountSection (memoised) from re-rendering
  // whenever an unrelated settings field changes.
  const refreshAccount = useCallback(() => onAccountRefresh?.(), [onAccountRefresh]);
  // --- AI settings state (mirrors the previous chat settings sidebar) ---
  const [showAiKey, setShowAiKey] = useState(false);
  const [showLocalModels, setShowLocalModels] = useState(false);
  const [aiTab, setAiTab] = useState<"general" | "mcp">("general");
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
      setByokMsg(t("settings.signInToStore"));
      return;
    }
    setByokBusy(true);
    setByokMsg(null);
    try {
      await saveRemoteKey(aiSettings.provider, byokDraft);
      onAiChange({ ...aiSettings, apiKey: byokDraft.trim() });
      setByokMsg(t("settings.keySaved"));
      setByokDraft("");
    } catch (e) {
      let message = e instanceof Error ? e.message : String(e);
      if (/BYOK_ENCRYPTION_KEY secret is missing or not 64 hex chars/i.test(message)) {
        message =
          t("settings.byokNoServer");
      }
      if (/upgraded plan|paywall|byok requires/i.test(message)) {
        message =
          t("settings.byokPaywall");
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
      setByokMsg(t("settings.keyRemoved"));
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
        setMcpError(t("settings.mcpNeedUrl"));
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
        setMcpError(t("settings.mcpNeedCmd"));
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
          t("settings.mcpNoneFound")
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
        [s.id]: t("settings.mcpTools", { count: tools.length, s: tools.length === 1 ? "" : "s" }),
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
        <aside className="flex shrink-0 flex-col  bg-[var(--bg-panel)] sm:w-[212px]">
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
              <span>{t("settings.versionBeta")}</span>
              <button
                type="button"
                aria-label={t("settings.aboutBuilds")}
                aria-expanded={buildsInfoOpen}
                className="inline-flex items-center text-[var(--text-faint)] transition hover:text-[var(--text-secondary)]"
                onClick={() => setBuildsInfoOpen((v) => !v)}
              >
                <IoInformationCircleOutline className="h-4 w-4" />
              </button>

              {buildsInfoOpen && (
                <div className="absolute bottom-0 left-full z-50 ml-2 w-72 rounded-lg bg-[var(--bg-elevated)] p-4 text-left shadow-[0_10px_32px_rgba(0,0,0,0.5)]">
                  <p className="text-xs font-medium text-[var(--text-primary)]">
                    {t("settings.buildsTitle")}
                  </p>

                  <p className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">
                    {t("settings.buildsOfficial").split("{link}")[0]}
                    <a
                      href="https://github.com/Lumorix-studios/Neo"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--text-primary)] hover:underline"
                    >
                      {t("settings.buildsLink")}
                    </a>
                  </p>

                  <p className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">
                    {t("settings.buildsNightly")}
                  </p>
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* ── Content */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center justify-between gap-3 border-(--border) px-4 py-2.5">
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
                <SectionTitle>{t("settings.theme")}</SectionTitle>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {THEMES.map((th) => {
                    const selected = settings.themeId === th.id && !settings.customBackground;
                    return (
                      <button
                        key={th.id}
                        type="button"
                        onClick={() => onChange({ themeId: th.id, customBackground: null })}
                        className={`rounded-lg border p-2 text-left transition ${
                          selected
                            ? "border-(--accent) bg-(--fill-1)"
                            : "border-(--border) hover:border-(--border-strong) hover:bg-(--fill-1)"
                        }`}
                      >
                        <div className="mb-1.5 flex gap-1">
                          {[th.base, th.panel, th.elevated, th.active].map((c) => (
                            <span
                              key={c}
                              className="h-4 flex-1 rounded-[3px] border border-(--border)"
                              style={{ background: c }}
                            />
                          ))}
                        </div>
                        <span className={`flex items-center gap-1.5 text-[11.5px] ${selected ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}>
                          {th.id === "neo" ? t("settings.themeDark") : t("settings.themeLight")}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <SectionTitle>{t("settings.surface")}</SectionTitle>
                <Row
                  title={t("settings.glassy")}
                  description={t("settings.glassyDesc")}
                >
                  <Toggle checked={settings.glass ?? true} onChange={(v) => onChange({ glass: v })} />
                </Row>

                <SectionTitle>{t("settings.accent")}</SectionTitle>
                <div className="flex items-center gap-2">
                  {ACCENT_SWATCHES.map((sw) => { const accentKey = ACCENT_LABEL_KEYS[sw.label] ?? sw.label; return (
                    <button
                      key={sw.value}
                      type="button"
                      title={typeof accentKey === "string" && accentKey.startsWith("settings.") ? t(accentKey) : accentKey}
                      onClick={() => onChange({ accent: sw.value })}
                      className={`h-5 w-5 rounded-full border transition ${
                        settings.accent === sw.value
                          ? "border-(--text-primary)"
                          : "border-(--border-strong) hover:border-(--text-muted)"
                      }`}
                      style={{ background: sw.value }}
                    />
                    );
                  })}
                  <input
                    type="color"
                    value={isValidHex(settings.accent) ? settings.accent : "var(--accent)"}
                    onChange={(e) => onChange({ accent: e.target.value })}
                    title={t("settings.customAccent")}
                    className="h-6 w-9 cursor-pointer rounded border border-(--border) bg-transparent p-0.5"
                  />
                </div>
                <Row title={languageLabels.changeLanguage}>
                  <select
                    value={selectedValue}
                    onChange={handleLanguageChange}
                    className="w-48 appearance-none rounded-md border border-(--border) bg-black py-1.5 pl-2.5 pr-8 text-[12px] text-white outline-none transition focus:border-(--border-strong)"
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
                  {aiSettings.provider === "llamacpp" ? (
                    <LlamaCppModels
                      onClose={() => setShowLocalModels(false)}
                      onSelectModel={async (model) => {
                        const err = (await onSelectLocalModel(model.id)) ?? null;
                        if (!err) setShowLocalModels(false);
                        return err;
                      }}
                      selectedModelId={aiSettings.model ?? null}
                    />
                  ) : (
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
                  )}
                </div>
              ) : (
              <div>
                <div className="mb-4 flex w-fit gap-0.5 rounded-md bg-(--fill-1) p-0.5">
                  {(
                    [
                      ["general", "settings.aiTabGeneral"],
                      ["mcp", "settings.aiTabMcp"],
                    ] as const
                  ).map(([id, labelKey]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setAiTab(id)}
                      className={`rounded px-2.5 py-1 text-[11px] transition ${
                        aiTab === id
                          ? "bg-(--fill-2) text-[var(--text-primary)]"
                          : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                      }`}
                    >
                      {t(labelKey)}
                    </button>
                  ))}
                </div>
                {aiTab === "general" ? (
                  <>
                <SectionTitle>{t("settings.secProvider")}</SectionTitle>
                <Row title={t("settings.aiProvider")} description={t("settings.aiProviderDesc")}>
                  <div className="relative shrink-0">
                    <select
                      value={aiSettings.provider}
                      onChange={(e) => handleAiProviderChange(e.target.value as ProviderId)}
                      className="w-48 appearance-none rounded-md  bg-(--fill-1) py-1.5 pl-2.5 pr-8 text-[12px] text-[var(--text-primary)] outline-none transition focus:border-(--border-strong)"
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
                      t("settings.apiKeyNote")}
                  </p>
                )}
                <Row title={t("settings.localModelsRow")} description={t("settings.localModelsDesc")}>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowLocalModels(true)}
                      className="bg-(--fill-1) shrink-0 rounded-md  px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
                    >
                      {t("settings.browse")}
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
                              setDiscoveredPort(t("settings.noOllama"));
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
                      className="shrink-0 rounded-md bg-(--fill-1) px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)] disabled:opacity-50"
                    >
                      {isCheckingPorts ? t("settings.scanningDots") : t("settings.autoDetect")}
                    </button>
                  </div>
                </Row>
                {discoveredPort && (
                  <p
                    className={`mb-3 text-[10px] ${
                      discoveredPort === t("settings.noOllama") ||
                      discoveredPort.toLowerCase().includes("could not") ||
                      discoveredPort.toLowerCase().includes("install")
                        ? "text-[var(--danger)]"
                        : "text-[var(--success)]"
                    }`}
                  >
                    {discoveredPort === t("settings.noOllama")
                      ? t("settings.ollamaNotFound")
                      : t("settings.ollamaConnected", { port: discoveredPort })}
                  </p>
                )}
                <SectionTitle>{t("settings.secConnection")}</SectionTitle>
                <Row title={t("settings.apiEndpoint")} description={t("settings.apiEndpointDesc")}>
                  <input
                    type="text"
                    value={aiSettings.baseUrl}
                    onChange={(e) => updateAi("baseUrl", e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    spellCheck={false}
                    className="w-56 shrink-0 rounded-md bg-(--fill-1) px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-(--border-strong)"
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
                    {t("settings.checkingSession")}
                  </p>
                )}
                {aiNeedsKey && byokEntitled && (
                  <div className="flex flex-col gap-1.5 pb-3">
                    <p className="text-[10.5px] leading-4 text-[var(--text-muted)]">
                      {t("settings.byokNote")}
                    </p>
                    <div className="flex gap-1.5">
                      <div className="relative flex-1">
                        <input
                          type={showAiKey ? "text" : "password"}
                          value={byokDraft}
                          onChange={(e) => setByokDraft(e.target.value)}
                          placeholder={
                            keyConfigured ? t("settings.apiKeyReplace") : t("settings.enterApiKey")
                          }
                          spellCheck={false}
                          autoComplete="off"
                          aria-label={`${providerById(aiSettings.provider).label} API key`}
                          disabled={accountLoading}
                          className="w-full rounded-md bg-(--fill-1) py-1.5 pl-2.5 pr-14 text-[12px] text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-(--border-strong)"
                        />
                        <button
                          type="button"
                          onClick={() => setShowAiKey((v) => !v)}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-[10.5px] text-[var(--text-muted)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
                        >
                          {showAiKey ? t("settings.hideBtn") : t("settings.showBtn")}
                        </button>
                      </div>
                      <button
                        type="button"
                        disabled={byokBusy || accountLoading || !byokDraft.trim()}
                        title={t("settings.saveKeyTitle")}
                        onClick={() => void handleSaveByokKey()}
                        className="shrink-0 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition disabled:opacity-40"
                        style={{ background: "var(--accent)", color: "var(--on-accent)" }}
                      >
                        {t("settings.saveBtn")}
                      </button>
                      {keyConfigured && (
                        <button
                          type="button"
                          disabled={byokBusy || accountLoading}
                          onClick={() => void handleRemoveByokKey()}
                          className="shrink-0 rounded-md bg-(--fill-1) px-2.5 py-1.5 text-[11px] text-[var(--text-secondary)] transition hover:bg-red-500 hover:text-[var(--text-primary)] disabled:opacity-40"
                        >
                          {t("settings.removeBtn")}
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
                      {t("settings.byokLockedNote")}
                    </p>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSection("account")}
                        className="rounded-md px-2.5 py-1 text-[11px] font-medium transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
                        style={{ background: "var(--accent)", color: "var(--on-accent)"}}
                      >
                        {t("settings.signInBtn")}
                      </button>
                    </div>
                  </div>
                )}

                <SectionTitle>{t("settings.secModel")}</SectionTitle>
                <Row title={t("settings.modelId")} description={t("settings.modelIdDesc")}>
                  <input
                    type="text"
                    value={aiSettings.model}
                    onChange={(e) => updateAi("model", e.target.value)}
                    placeholder={t("settings.modelPh")}
                    spellCheck={false}
                    className="w-56 shrink-0 rounded-md border border-transparent bg-(--fill-1) px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-(--border-strong)"
                  />
                </Row>
                <Row title={t("settings.temperature")} description={t("settings.temperatureDesc")}>
                  <Slider value={aiSettings.temperature} min={0} max={2} step={0.1} onChange={(v) => updateAi("temperature", v)} />
                </Row>
                <SectionTitle>{t("settings.secBehavior")}</SectionTitle>
                <Row title={t("settings.autoApprove")} description={t("settings.autoApproveDesc")}>
                  <Toggle checked={!!aiSettings.autoApproveTools} onChange={(v) => updateAi("autoApproveTools", v)} />
                </Row>
                <div className="pb-2 pt-1">
                  <p className="mb-1.5 text-[12.5px] font-medium text-[var(--text-primary)]">{t("settings.systemPrompt")}</p>
                  <textarea
                    value={aiSettings.systemPrompt}
                    onChange={(e) => updateAi("systemPrompt", e.target.value)}
                    rows={4}
                    placeholder={t("settings.systemPh")}
                    className="w-full resize-none rounded-md border border-transparent bg-(--fill-1) px-2.5 py-2 text-[12.5px] leading-5 text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-(--border-strong)"
                  />
                </div>

                  </>
                ) : (
                  <>
                <div className="flex flex-col gap-2 pb-2">
                  {/* Auto-discovery: pick up servers the user already configured
                      in Claude Desktop / Cursor / VS Code / Windsurf / .mcp.json. */}
                  <div className="rounded-md bg-(--fill-1) px-2.5 py-2">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-medium text-[var(--text-primary)]">
                          {t("settings.mcpImportTitle")}
                        </p>
                        <p className="text-[10.5px] leading-4 text-[var(--text-muted)]">
                          {t("settings.mcpImportDesc")}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void scanForMcpServers()}
                        disabled={mcpScanBusy}
                        className="shrink-0 rounded-md bg-(--fill-1) px-2.5 py-1 text-[10.5px] text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)] disabled:opacity-50"
                      >
                        {mcpScanBusy ? t("settings.mcpScanning") : t("settings.mcpScan")}
                      </button>
                    </div>

                    {mcpDiscovered !== null && mcpDiscovered.length > 0 && (
                      <div className="mt-2 flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-[var(--text-faint)]">
                            {t("settings.mcpFound", { count: mcpDiscovered.length })}
                          </span>
                          <button
                            type="button"
                            onClick={importAllDiscovered}
                            className="rounded-md bg-(--fill-1) px-2.5 py-0.5 text-[10px] text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
                          >
                            {t("settings.mcpImportAll")}
                          </button>
                        </div>
                        {mcpDiscovered.map((d, i) => {
                          const fp = serverFingerprint(d.server);
                          const already = mcpServers.some((s) => serverFingerprint(s) === fp);
                          const done = already || mcpImported.includes(fp);
                          return (
                            <div
                              key={`${d.path}:${d.name}:${i}`}
                              className="flex items-center gap-2 rounded-md bg-(--bg-elevated) px-2 py-1.5"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate text-[11.5px] font-medium text-[var(--text-primary)]">
                                    {d.name}
                                  </span>
                                  <span className="shrink-0 rounded bg-(--fill-2) px-1 py-px text-[9px] uppercase tracking-wide text-[var(--text-faint)]">
                                    {d.server.transport}
                                  </span>
                                </div>
                                <div className="truncate text-[10px] text-[var(--text-faint)]">
                                  {describeServer(d.server)}
                                </div>
                                <div className="truncate text-[9.5px] text-[var(--text-faint)]">
                                  {t("settings.mcpFrom", { app: d.app })}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => importDiscoveredServer(d)}
                                disabled={done}
                                className="shrink-0 rounded-md bg-(--fill-1) px-2.5 py-1 text-[10px] text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)] disabled:opacity-40"
                              >
                                {done ? t("settings.mcpAdded") : t("settings.mcpImport")}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {mcpServers.length === 0 && (
                    <p className="text-[11px] leading-4 text-[var(--text-muted)]">
                      {t("settings.mcpEmpty")}
                    </p>
                  )}
                  {mcpServers.map((s) => (
                    <div key={s.id} className="flex items-center gap-2 rounded-md bg-(--fill-1) px-2.5 py-2">
                      <button
                        type="button"
                        onClick={() => toggleMcpServer(s.id)}
                        title={s.enabled ? t("settings.mcpDisable") : t("settings.mcpEnable")}
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
                          <span className="shrink-0 rounded bg-(--fill-2) px-1 py-px text-[9px] uppercase tracking-wide text-[var(--text-faint)]">
                            {s.transport}
                          </span>
                        </div>
                        <div className="truncate text-[10px] text-[var(--text-faint)]">{describeServer(s)}</div>
                        {mcpTest[s.id] && (
                          <div className={`truncate text-[10px] ${mcpTest[s.id].startsWith("✕") ? "text-[var(--danger)]" : "text-[var(--success)]"}`}>
                            {mcpTest[s.id]}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => void testMcpServer(s)}
                        title={t("settings.mcpTestTitle")}
                        className="shrink-0 rounded-md bg-(--fill-1) px-2.5 py-1 text-[10.5px] text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
                      >
                        {t("settings.mcpTest")}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeMcpServer(s.id)}
                        aria-label={t("settings.mcpRemove", { name: s.name })}
                        className="shrink-0 rounded p-1 text-[var(--text-muted)] transition hover:bg-red-500/10 hover:text-[var(--danger)]"
                      >
                        <IoClose size={11} />
                      </button>
                    </div>
                  ))}
                  <p className="mt-4 text-[11px] text-[var(--text-muted)]">{t("settings.mcpAddManual")}</p>
                  {/* Transport picker */}
                  <div className="flex items-center gap-1 self-start rounded-md bg-(--fill-1) p-0.5">
                    {(["http", "stdio"] as const).map((tr) => (
                      <button
                        key={tr}
                        type="button"
                        onClick={() => setMcpTransport(tr)}
                        className={`rounded px-2.5 py-1 text-[11px] transition ${
                          mcpTransport === tr
                            ? "bg-(--fill-2) text-[var(--text-primary)]"
                            : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                        }`}
                      >
                        {tr === "http" ? t("settings.mcpHttp") : t("settings.mcpStdio")}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={mcpName}
                    onChange={(e) => setMcpName(e.target.value)}
                    placeholder={t("settings.mcpNamePh")}
                    spellCheck={false}
                    className="w-full rounded-md border border-transparent bg-(--fill-1) px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-(--border-strong)"
                  />
                  {mcpTransport === "http" ? (
                    <>
                      <input
                        type="text"
                        value={mcpUrl}
                        onChange={(e) => setMcpUrl(e.target.value)}
                        placeholder={t("settings.mcpUrlPh")}
                        spellCheck={false}
                        className="w-full rounded-md border border-transparent bg-(--fill-1) px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-(--border-strong)"
                      />
                      <input
                        type="text"
                        value={mcpHeaders}
                        onChange={(e) => setMcpHeaders(e.target.value)}
                         placeholder={t("settings.mcpHeadersPh")}
                        spellCheck={false}
                        className="w-full rounded-md border border-transparent bg-(--fill-1) px-2.5 py-1.5 font-mono text-[11px] text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-(--border-strong)"
                      />
                    </>
                  ) : (
                    <>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={mcpCommand}
                          onChange={(e) => setMcpCommand(e.target.value)}
                          placeholder={t("settings.mcpCmdPh")}
                          spellCheck={false}
                          className="min-w-0 flex-1 rounded-md border border-transparent bg-(--fill-1) px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-(--border-strong)"
                        />
                        <input
                          type="text"
                          value={mcpArgs}
                          onChange={(e) => setMcpArgs(e.target.value)}
                           placeholder={t("settings.mcpArgsPh")}
                          spellCheck={false}
                          className="min-w-0 flex-[1.6] rounded-md border border-transparent bg-(--fill-1) px-2.5 py-1.5 font-mono text-[11px] text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-(--border-strong)"
                        />
                      </div>
                      <input
                        type="text"
                        value={mcpCwd}
                        onChange={(e) => setMcpCwd(e.target.value)}
                         placeholder={t("settings.mcpCwdPh")}
                        spellCheck={false}
                        className="w-full rounded-md border border-transparent bg-(--fill-1) px-2.5 py-1.5 font-mono text-[11px] text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-(--border-strong)"
                      />
                      <input
                        type="text"
                        value={mcpEnv}
                        onChange={(e) => setMcpEnv(e.target.value)}
                         placeholder={t("settings.mcpEnvPh")}
                        spellCheck={false}
                        className="w-full rounded-md border border-transparent bg-(--fill-1) px-2.5 py-1.5 font-mono text-[11px] text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-(--border-strong)"
                      />
                    </>
                  )}
                  {mcpError && (
                    <p className="text-[10.5px] leading-4 text-[var(--danger)]">{mcpError}</p>
                  )}
                  <button
                    type="button"
                    onClick={addMcpServer}
                    disabled={!mcpName.trim()}
                    className="self-start rounded-md bg-(--fill-1) px-3 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t("settings.mcpAdd")}
                  </button>
                </div>

                  </>
                )}
                <p className="pt-1 text-[10.5px] text-[var(--text-faint)]">
                  {signedIn
                    ? t("settings.aiSyncIn")
                    : t("settings.aiSyncOut")}
                </p>
              </div>
              ))}
            {section === "editor" && (
              <div>
                <SectionTitle>{t("settings.edTypography")}</SectionTitle>
                <Row title={t("settings.edFontSize")} description={t("settings.edFontSizeDesc")}>
                  <Slider value={settings.editorFontSize} min={10} max={18} step={0.5} unit="px" onChange={(v) => onChange({ editorFontSize: v })} />
                </Row>
                <Row title={t("settings.edLineHeight")} description={t("settings.edLineHeightDesc")}>
                  <Slider value={settings.editorLineHeight} min={16} max={30} step={1} unit="px" onChange={(v) => onChange({ editorLineHeight: v })} />
                </Row>

                <SectionTitle>{t("settings.edBehavior")}</SectionTitle>
                <Row title={t("settings.edWordWrap")} description={t("settings.edWordWrapDesc")}>
                  <Toggle checked={settings.wordWrap} onChange={(v) => onChange({ wordWrap: v })} />
                </Row>
                <Row title={t("settings.edLineNums")} description={t("settings.edLineNumsDesc")}>
                  <Toggle checked={settings.showLineNumbers} onChange={(v) => onChange({ showLineNumbers: v })} />
                </Row>
                <Row title={t("settings.edTabSize")} description={t("settings.edTabSizeDesc")}>
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
                <SectionTitle>{t("settings.filesAutoSave")}</SectionTitle>
                <Row title={t("settings.filesAutoSaveRow")} description={t("settings.filesAutoSaveDesc")}>
                  <Toggle checked={settings.autoSave} onChange={(v) => onChange({ autoSave: v })} />
                </Row>
                {settings.autoSave && (
                  <Row title={t("settings.filesDelay")} description={t("settings.filesDelayDesc")}>
                    <Slider value={settings.autoSaveDelayMs} min={500} max={3000} step={250} unit="ms" onChange={(v) => onChange({ autoSaveDelayMs: v })} />
                  </Row>
                )}

                <SectionTitle>{t("settings.filesPrivacy")}</SectionTitle>
                <Row title={t("settings.filesClear")} description={t("settings.filesClearDesc")}>
                  <button
                    type="button"
                    onClick={() => {
                      clearRecentFiles();
                      clearRecentFolders();
                    }}
                    className="shrink-0 rounded-md border border-(--border-strong) px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
                  >
                    {t("settings.clearBtn")}
                  </button>
                </Row>
              </div>
            )}
            {section === "plugins" && (
              <div>
                <PluginsPanel inline />
              </div>
            )}
            {section === "shortcuts" && (
              <div>
                <SectionTitle>{t("settings.kbTitle")}</SectionTitle>
                <div className="overflow-hidden rounded-lg border border-(--border)">
                  {SHORTCUTS.map(([keys, label, labelKey], i) => (
                    <div
                      key={keys}
                      className={`flex items-center justify-between px-3 py-2 ${i % 2 === 0 ? "bg-(--fill-1)" : ""}`}
                    >
                      <span className="text-[12px] text-[var(--text-secondary)]">{t(labelKey) || label}</span>
                      <span className="kbd">{keys}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}


            {section === "terminal" && (
              <div>
                <SectionTitle>{t("settings.termTypography")}</SectionTitle>
                <Row title={t("settings.termFontSize")} description={t("settings.termFontSizeDesc")}>
                  <Slider value={settings.terminalFontSize} min={8} max={20} step={0.5} unit="px" onChange={(v) => onChange({ terminalFontSize: v })} />
                </Row>

                <SectionTitle>{t("settings.termBuffer")}</SectionTitle>
                <Row title={t("settings.termScrollback")} description={t("settings.termScrollbackDesc")}>
                  <Slider value={settings.terminalScrollback} min={100} max={10000} step={100} onChange={(v) => onChange({ terminalScrollback: v })} />
                </Row>

                <SectionTitle>{t("settings.termCursor")}</SectionTitle>
                <Row title={t("settings.termBlink")} description={t("settings.termBlinkDesc")}>
                  <Toggle checked={settings.terminalCursorBlink} onChange={(v) => onChange({ terminalCursorBlink: v })} />
                </Row>

                <p className="pt-2 text-[10.5px] text-[var(--text-faint)]">
                  {t("settings.termNote")}
                </p>
              </div>
            )}

            {section === "dashboard" && (
              <div>
                <SectionTitle>{t("settings.dashToday")}</SectionTitle>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: t("settings.dashRequests"), value: usageSnapshot.today.requests },
                    { label: t("settings.dashInput"), value: usageSnapshot.today.input },
                    { label: t("settings.dashOutput"), value: usageSnapshot.today.output },
                  ].map((s) => (
                    <div
                      key={s.label}
                      className="relative overflow-hidden rounded-lg border border-(--border) bg-(--fill-1) px-3 py-2.5"
                    >
                      <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-(--accent) to-transparent opacity-60" />
                      <p className="text-[9px] uppercase tracking-wide text-[var(--text-faint)]">
                        {s.label}
                      </p>
                      <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-[var(--text-primary)]">
                        {formatTokens(s.value)}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex items-baseline justify-between rounded-lg border border-(--border) bg-(--fill-1) px-3 py-2.5">
                  <div>
                    <p className="text-[9px] uppercase tracking-wide text-[var(--text-faint)]">
                      {t("settings.dashTotalTokens")}
                    </p>
                    <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                      {t("settings.dashTotalDesc")}
                    </p>
                  </div>
                  <p className="text-[15px] font-semibold tabular-nums text-[var(--text-primary)]">
                    {formatTokens(usageSnapshot.totalTokens)}
                  </p>
                </div>

                {rateSettings.maxTokensPerDay > 0 && (() => {
                  const todayTotal = usageSnapshot.today.input + usageSnapshot.today.output;
                  const dailyLimit = rateSettings.maxTokensPerDay;
                  const dailyPct = Math.min(100, Math.round((todayTotal / dailyLimit) * 100));
                  const dailyRemaining = Math.max(0, dailyLimit - todayTotal);
                  return (
                    <>
                      <SectionTitle>{t("settings.dashBudget")}</SectionTitle>
                      <div className="rounded-lg border border-(--border) bg-(--fill-1) px-3 py-2.5">
                        <div className="mb-1.5 flex items-center justify-between text-[10.5px]">
                          <span className="text-[var(--text-muted)]">
                            {t("settings.dashDailyBudget", {
                              used: formatTokens(todayTotal),
                              limit: formatTokens(dailyLimit),
                            })}
                          </span>
                          <span className="tabular-nums font-medium text-[var(--text-primary)]">
                            {dailyPct}%
                          </span>
                        </div>
                        <div className="h-2.5 w-full rounded-full bg-(--fill-2)">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${dailyPct}%`,
                              backgroundColor: dailyPct >= 90 ? "var(--danger)" : dailyPct >= 75 ? "var(--warning)" : "var(--accent)",
                            }}
                          />
                        </div>
                        <div className="mt-1 text-[10px] text-[var(--text-faint)]">
                          {t("settings.dashRemaining", { remaining: formatTokens(dailyRemaining) })}
                        </div>
                      </div>
                    </>
                  );
                })()}
                <SectionTitle>{t("settings.dash7")}</SectionTitle>
                <div className="flex h-28 items-end gap-1.5">
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
                        title={`${t("settings.dashDayTitle", { date: d.date, total: total.toLocaleString() })} \u00b7 ${t("settings.dashDayReq", { req: d.requests })}`}
                      >
                        <span className="text-[9px] tabular-nums text-[var(--text-faint)]">
                          {total > 0 ? formatTokens(total) : "—"}
                        </span>
                        <div className="relative w-full">
                          <div
                            className="w-full rounded-t-sm bg-gradient-to-t from-(--accent)/70 to-(--accent)/40"
                            style={{ height: `${Math.max(4, Math.round((total / max) * 80))}px` }}
                          />
                        </div>
                        <span className="text-[9.5px] text-[var(--text-faint)]">{dayLabel}</span>
                      </div>
                    );
                  })}
                </div>

                <SectionTitle>{t("settings.dashRates")}</SectionTitle>
                <Row title={t("settings.dashEnforce")} description={t("settings.dashEnforceDesc")}>
                  <Toggle
                    checked={rateSettings.enabled}
                    onChange={(v) => {
                      const next = { ...rateSettings, enabled: v };
                      setRateSettings(next);
                      void saveTokenRateSettings(next);
                    }}
                  />
                </Row>
                <Row title={t("settings.dashPerMin")} description={t("settings.dashPerMinDesc")}>
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
                <Row title={t("settings.dashPerDay")} description={t("settings.dashPerDayDesc")}>
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

                <SectionTitle>{t("settings.dashRecent")}</SectionTitle>
                {usageSnapshot.recent.length === 0 ? (
                  <p className="text-[11.5px] text-[var(--text-muted)]">
                    {t("settings.dashEmpty")}
                  </p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {usageSnapshot.recent.slice(0, 8).map((r, i) => (
                      <div
                        key={`${r.at}-${i}`}
                        className="flex items-center justify-between rounded-md border border-(--border) px-3 py-1.5 text-[11px]"
                      >
                        <span className="min-w-0 truncate text-[var(--text-primary)]">
                          {r.provider} · {r.model}
                        </span>
                        <span className="ml-3 shrink-0 tabular-nums text-[var(--success)]">
                          {new Date(r.at).toLocaleTimeString()} | Input:{formatTokens(r.input)} | Output:{formatTokens(r.output)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <Row title={t("settings.dashReset")} description={t("settings.dashResetDesc")}>
                  <button
                    type="button"
                    onClick={() => {
                      void resetUsage();
                      setUsageTick((t) => t + 1);
                    }}
                    className="shrink-0 rounded-md border border-(--border-strong) px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
                  >
                    {t("settings.resetBtn")}
                  </button>
                </Row>

                <p className="pt-2 text-[10.5px] text-[var(--text-faint)]">
                  {t("settings.dashNote")} 
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
                        className="shrink-0 rounded-md border border-red-400/40 px-2.5 py-1 text-[11px] text-[var(--danger)] transition hover:bg-red-400/10 disabled:opacity-40"
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
                    <img src={appIcon} alt="Struct logo" className="h-full w-full object-contain" />
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-[var(--text-primary)]">Struct</p>
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
                  Struct is in early beta — some features may not work as expected. Please report bugs on the GitHub repository.
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

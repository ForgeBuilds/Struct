/*
 * Author: madhusudhan
 * Check the LICENSE in the GitHub repo (https://github.com/Lumorix-studios/Struct) for more information on permissions to use this code.
 */
import { invoke, isNativeRuntime } from "./native";
export interface UiSettings {
  themeId: string;
  language: string;
  customBackground: string | null;

  /** -0.35..0.35 brightness safety nudge applied to the custom background. */
  bgBrightness: number;

  accent: string;
  editorFontSize: number;
  editorLineHeight: number;
  tabSize: number;
  wordWrap: boolean;
  showLineNumbers: boolean;
  autoSave: boolean;
  autoSaveDelayMs: number;
  terminalFontSize: number;
  terminalScrollback: number;
  terminalCursorBlink: boolean;

  /** Translucent, blurred surfaces (dialogs, dropdowns, sidebar). */
  glass: boolean;
}

export interface ThemePreset {
  id: string;
  label: string;
  base: string;
  panel: string;
  elevated: string;
  active: string;
}

/** Two modes only — Dark and Light. Any other stored id falls back to Dark on load. */
export const THEMES: ThemePreset[] = [
  { id: "neo", label: "Dark", base: "#1f1f1f", panel: "#191919", elevated: "#2b2b2b", active: "#343434" },
  { id: "paper", label: "Light", base: "#f7f7f8", panel: "#f0f0f2", elevated: "#e6e6e9", active: "#dcdce0" },
];

export const ACCENT_SWATCHES: Array<{ label: string; value: string }> = [
  { label: "Blue", value: "#4c8dff" },
  { label: "Violet", value: "#8b5cf6" },
  { label: "Emerald", value: "#34d399" },
  { label: "Cyan", value: "#22d3ee" },
  { label: "Amber", value: "#f59e0b" },
  { label: "Rose", value: "#f43f5e" },
  { label: "Lime", value: "#a3e635" },
  { label: "Magenta", value: "#e879f9" },
  { label: "Orange", value: "#fb923c" },
  { label: "Sky", value: "#38bdf8" },
  { label: "Gold", value: "#facc15" },
  { label: "Mint", value: "#6ee7b7" },
];

export const LANGUAGE_OPTIONS = [
  "English",
  "हिंदी",
  "中文",
  "Español",
  "Français",
  "Deutsch",
  "日本語",
  "한국어",
  "Português",
  "Русский",
] as const;

export const LANGUAGE_CODES: Record<(typeof LANGUAGE_OPTIONS)[number], string> = {
  English: "en",
  "हिंदी": "hi",
  中文: "zh",
  Español: "es",
  Français: "fr",
  Deutsch: "de",
  "日本語": "ja",
  "한국어": "ko",
  Português: "pt",
  Русский: "ru",
};

export function getLanguageCode(language: string | null | undefined): string {
  return LANGUAGE_CODES[(language as keyof typeof LANGUAGE_CODES) ?? "English"] ?? "en";
}

export const DEFAULT_UI_SETTINGS: UiSettings = {
  themeId: "neo",
  language: "English",
  customBackground: null,
  bgBrightness: 0,
  accent: "#4c8dff",
  editorFontSize: 12.5,
  editorLineHeight: 20,
  tabSize: 2,
  wordWrap: false,
  showLineNumbers: true,
  autoSave: false,
  autoSaveDelayMs: 1000,
  terminalFontSize: 12.5,
  terminalScrollback: 1000,
  terminalCursorBlink: true,
  glass: true,
};


const UI_SETTINGS_KEY = "neo.ui-settings.v1";

function inDesktop(): boolean {
  return isNativeRuntime();
}

async function diskRead(key: string): Promise<string | null> {
  try {
    const raw = await invoke<string>("load_state", { key });
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

async function diskWrite(key: string, value: string): Promise<boolean> {
  try {
    await invoke("save_state", { key, value });
    return true;
  } catch {
    return false;
  }
}

export async function loadUiSettings(): Promise<UiSettings> {
  const raw = inDesktop() ? await diskRead(UI_SETTINGS_KEY) : localStorage.getItem(UI_SETTINGS_KEY);
  if (!raw) return DEFAULT_UI_SETTINGS;
  try {
    const merged = { ...DEFAULT_UI_SETTINGS, ...JSON.parse(raw) };
    // Theme ids contributed by the removed extensions system can no longer
    // resolve — fall back to the default palette.
    if (typeof merged.themeId !== "string" || !THEMES.some((t) => t.id === merged.themeId)) {
      merged.themeId = DEFAULT_UI_SETTINGS.themeId;
    }
    if (typeof merged.language !== "string" || !LANGUAGE_OPTIONS.includes(merged.language as (typeof LANGUAGE_OPTIONS)[number])) {
      merged.language = DEFAULT_UI_SETTINGS.language;
    }
    return merged;
  } catch {
    return DEFAULT_UI_SETTINGS;
  }
}

export async function saveUiSettings(s: UiSettings): Promise<void> {
  const raw = JSON.stringify(s);
  if (inDesktop()) {
    const ok = await diskWrite(UI_SETTINGS_KEY, raw);
    if (!ok) localStorage.setItem(UI_SETTINGS_KEY, raw);
  } else {
    localStorage.setItem(UI_SETTINGS_KEY, raw);
  }
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const num = parseInt(full.slice(0, 6), 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => clampByte(v).toString(16).padStart(2, "0")).join("")}`;
}

/** Mix `hex` toward white (amount > 0) or black (amount < 0). amount in [-1, 1]. */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const target = amount >= 0 ? 255 : 0;
  const t = Math.abs(amount);
  return rgbToHex(r + (target - r) * t, g + (target - g) * t, b + (target - b) * t);
}

export function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function isValidHex(hex: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex.trim());
}

function normalizeHex(hex: string): string {
  const h = hex.trim().replace("#", "");
  if (h.length === 3) return `#${h.split("").map((c) => c + c).join("")}`;
  return `#${h}`;
}
/* ── Adaptive / harmony helpers ─────────────────────────────────────── */

/** WCAG relative luminance (0 = black, 1 = white). */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio (1..21) between two colors. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** True when the color reads as a dark surface. */
export function isDarkColor(hex: string): boolean {
  return luminance(hex) < 0.35;
}

/** Best readable ink to place on top of `accent` (white unless too bright). */
export function onAccentInk(accent: string): string {
  return contrastRatio(accent, "#ffffff") >= 3 ? "#ffffff" : "#111111";
}

/**
 * Nudge an accent until it is readable against `bg` (WCAG >= target, default
 * 3:1). The hue is preserved — only lightness moves: accents that are too
 * close in luminance to the background get pushed AWAY from it (lightened on
 * dark themes, darkened on light ones). Bounded so it always terminates.
 */
export function harmonizeAccent(accent: string, bg: string, target = 3): string {
  let c = normalizeHex(accent);
  const bgLum = luminance(bg);
  for (let i = 0; i < 32 && contrastRatio(c, bg) < target; i++) {
    const dir = luminance(c) > bgLum ? 1 : -1;
    c = shade(c, 0.05 * dir);
  }
  return c;
}

/** Brightness safety nudge in [-1,1]: lifts dark bases, deepens light ones. */
export function applyBrightness(hex: string, delta: number): string {
  if (!delta) return hex;
  const l = luminance(hex);
  return delta > 0 ? shade(hex, delta * (1 - l)) : shade(hex, delta * l);
}

/* Neutral ink ramps — one for dark surfaces, one for light/bright ones. */
const DARK_INK = { primary: "#e5e5e5", secondary: "#a1a1a1", muted: "#666666", faint: "#444444" };
const LIGHT_INK = { primary: "#1a1a1a", secondary: "#4d4d4d", muted: "#7d7d7d", faint: "#ababab" };

const DARK_TOK = { kw: "#c678dd", str: "#98c379", num: "#d19a66", com: "#7f848e", fn: "#61afef", tag: "#e06c75" };
const LIGHT_TOK = { kw: "#a626a4", str: "#50a14f", num: "#986801", com: "#8f9dae", fn: "#4078f2", tag: "#e45649" };

/** Pull neutral ink a touch toward the background hue so text feels native on tinted bg. */
function tintToward(ink: string, base: string, amount: number): string {
  const [r, g, b] = hexToRgb(base);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 20) return ink; // neutral base → keep neutral ink
  const [ir, ig, ib] = hexToRgb(ink);
  return rgbToHex(ir + (r - ir) * amount, ig + (g - ig) * amount, ib + (b - ib) * amount);
}

export interface DerivedTheme {
  base: string;
  panel: string;
  elevated: string;
  active: string;
  chrome: string;
  editor: string;
  input: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textFaint: string;
  onAccent: string;
  isDark: boolean;
}

/**
 * Derive a full readable surface/text system from ANY base color — dark
 * or bright. Panels deepen on light bases, ink flips to dark on bright
 * bases, tints toward the base hue for a harmonized look.
 */
export function deriveTheme(rawBase: string, brightness = 0, accent = "#3b82f6"): DerivedTheme {
  const base = applyBrightness(normalizeHex(rawBase), brightness);
  const dark = isDarkColor(base);
  const dir = dark ? 1 : -1;
  const ink = dark ? DARK_INK : LIGHT_INK;
  const tint = (c: string, amt: number) => tintToward(c, base, amt);
  return {
    base,
    panel: shade(base, 0.03 * dir),
    elevated: shade(base, 0.055 * dir),
    active: shade(base, 0.09 * dir),
    chrome: shade(base, -0.025 * dir),
    editor: base,
    input: shade(base, 0.045 * dir),
    textPrimary: tint(ink.primary, 0.06),
    textSecondary: tint(ink.secondary, 0.1),
    textMuted: tint(ink.muted, 0.12),
    textFaint: tint(ink.faint, 0.14),
    onAccent: onAccentInk(accent),
    isDark: dark,
  };
}

export function resolveThemeVars(s: UiSettings): Record<string, string> {
  const theme = THEMES.find((t) => t.id === s.themeId) ?? THEMES[0];
  const custom = !!(s.customBackground && isValidHex(s.customBackground));
  const baseRaw = custom ? normalizeHex(s.customBackground as string) : theme.base;
  const d = deriveTheme(baseRaw, custom ? (s.bgBrightness ?? 0) : 0, s.accent);
  const dark = d.isDark;
  const tok = dark ? DARK_TOK : LIGHT_TOK;
  const alpha = (a: number) => (dark ? "rgba(255,255,255," : "rgba(0,0,0,") + a + ")";
  // Contrast-harmonize the accent against the (possibly derived) background:
  // a very dark accent gets lifted on dark themes, a very bright one gets
  // deepened on light themes — every accent choice stays readable while
  // keeping its hue.
  const accent = harmonizeAccent(s.accent, d.base);
  // Soft-fill visibility adapts to how loud the accent is: quieter on neon
  // accents (they self-announce), stronger on muted ones so tints stay
  // perceptible.
  const accentContrast = contrastRatio(accent, d.base);
  const accentSoftAlpha = accentContrast >= 6 ? 0.12 : accentContrast >= 4 ? 0.16 : 0.2;
  return {
    "--bg-base": d.base,
    // Hand-tuned presets keep their panels; custom colors get fully derived ones.
    "--bg-panel": custom ? d.panel : theme.panel,
    "--bg-elevated": custom ? d.elevated : theme.elevated,
    "--bg-active": custom ? d.active : theme.active,
    "--bg-chrome": custom ? d.chrome : shade(theme.base, -0.025),
    "--bg-editor": custom ? d.editor : theme.base,
    "--bg-input": custom ? d.input : theme.panel,
    "--border": alpha(0.08),
    "--border-strong": alpha(0.16),
    "--fill-1": alpha(0.035),
    "--fill-2": alpha(0.07),
    "--fill-3": alpha(0.13),
    "--text-primary": d.textPrimary,
    "--text-secondary": d.textSecondary,
    "--text-muted": d.textMuted,
    "--text-faint": d.textFaint,
    "--accent": accent,
    "--accent-soft": hexToRgba(accent, accentSoftAlpha),
    "--on-accent": onAccentInk(accent),
    "--code-kw": tok.kw,
    "--code-str": tok.str,
    "--code-num": tok.num,
    "--code-com": tok.com,
    "--code-fn": tok.fn,
    "--code-tag": tok.tag,
  };
}

export function applyUiSettings(s: UiSettings): void {
  const vars = resolveThemeVars(s);
  for (const [k, v] of Object.entries(vars)) {
    document.documentElement.style.setProperty(k, v);
  }
  document.documentElement.dataset.glass = s.glass ? "1" : "0";
}


const RECENT_FILES_KEY = "neo.recents.files.v1";
const RECENT_FOLDERS_KEY = "neo.recents.folders.v1";
const RECENTS_LIMIT = 8;

function readList(key: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeList(key: string, list: string[]): void {
  localStorage.setItem(key, JSON.stringify(list));
}

function pushInto(key: string, value: string): string[] {
  const next = [value, ...readList(key).filter((p) => p !== value)].slice(0, RECENTS_LIMIT);
  writeList(key, next);
  return next;
}

export function getRecentFiles(): string[] {
  return readList(RECENT_FILES_KEY);
}

export function pushRecentFile(path: string): string[] {
  return pushInto(RECENT_FILES_KEY, path);
}

export function clearRecentFiles(): void {
  writeList(RECENT_FILES_KEY, []);
}

export function getRecentFolders(): string[] {
  return readList(RECENT_FOLDERS_KEY);
}

export function pushRecentFolder(path: string): string[] {
  return pushInto(RECENT_FOLDERS_KEY, path);
}

export function clearRecentFolders(): void {
  writeList(RECENT_FOLDERS_KEY, []);
}

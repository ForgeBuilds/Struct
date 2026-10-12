/*
 * Author: madhusudhan
 * Check the LICENSE in the GitHub repo (https://github.com/Lumorix-studios/Struct) for more information on permissions to use this code.
 */
/**
 * Token usage accounting + rate limiting.
 *
 * Every AI request round reports the tokens it consumed (exact counters when
 * the provider returns usage data, char/4 estimates otherwise) into a small
 * persisted store. The Settings → Dashboard tab renders the totals, and the
 * agent loops consult `checkRateLimit()` before each request so configured
 * per-minute / per-day caps pause the agent with a clear message.
 *
 * All data lives on-device (same disk/localStorage pattern as uiSettings).
 */
import { invoke, isNativeRuntime } from "./native";

export interface TokenRateSettings {
  enabled: boolean;
  /** Max tokens (input + output) per rolling 60s window; 0 = unlimited. */
  maxTokensPerMinute: number;
  /** Max tokens per calendar day; 0 = unlimited. */
  maxTokensPerDay: number;
}

export const DEFAULT_TOKEN_RATE_SETTINGS: TokenRateSettings = {
  enabled: false,
  maxTokensPerMinute: 60000,
  maxTokensPerDay: 500000,
};

export interface DayUsage {
  input: number;
  output: number;
  requests: number;
}

export interface RecentRequest {
  at: number;
  input: number;
  output: number;
  provider: string;
  model: string;
}

interface UsageStore {
  days: Record<string, DayUsage>;
  recent: RecentRequest[];
}

const RATE_KEY = "neo.token-rate.v1";
const USAGE_KEY = "neo.token-usage.v1";
const MAX_RECENT = 60;

function inNativeShell(): boolean {
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

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function keyFor(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayKey(): string {
  return keyFor(new Date());
}

/* ── In-memory state (sync access for UI + rate checks) ─────────────── */

let store: UsageStore = { days: {}, recent: [] };
let rate: TokenRateSettings = DEFAULT_TOKEN_RATE_SETTINGS;
/** Rolling 60s window of token spend, used by the per-minute limiter. */
const minuteWindow: Array<{ at: number; tokens: number }> = [];

interface UsageStore {
  days: Record<string, DayUsage>;
  recent: RecentRequest[];
}

// Hydrate from disk once on module load.
void (async () => {
  try {
    const rawRate = inNativeShell() ? await diskRead(RATE_KEY) : localStorage.getItem(RATE_KEY);
    if (rawRate) rate = { ...DEFAULT_TOKEN_RATE_SETTINGS, ...JSON.parse(rawRate) };
    const rawUsage = inNativeShell() ? await diskRead(USAGE_KEY) : localStorage.getItem(USAGE_KEY);
    if (rawUsage) {
      const parsed = JSON.parse(rawUsage) as UsageStore;
      if (parsed && typeof parsed === "object") {
        store = {
          days: parsed.days ?? {},
          recent: Array.isArray(parsed.recent) ? parsed.recent : [],
        };
      }
    }
  } catch {
    /* keep defaults */
  }
})();

export function getCachedRateSettings(): TokenRateSettings {
  return rate;
}

export async function loadTokenRateSettings(): Promise<TokenRateSettings> {
  try {
    const raw = inNativeShell() ? await diskRead(RATE_KEY) : localStorage.getItem(RATE_KEY);
    if (raw) rate = { ...DEFAULT_TOKEN_RATE_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* keep cached value */
  }
  return rate;
}

export async function saveTokenRateSettings(next: TokenRateSettings): Promise<void> {
  rate = next;
  const raw = JSON.stringify(next);
  if (inNativeShell()) {
    const ok = await diskWrite(RATE_KEY, raw);
    if (!ok) localStorage.setItem(RATE_KEY, raw);
  } else {
    localStorage.setItem(RATE_KEY, raw);
  }
}

/** Cheap char/4 token estimate used when the provider returns no counters. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil((text?.length ?? 0) / 4));
}

/**
 * Check the configured limits BEFORE spending tokens. Returns an error
 * message when the (estimated) request would exceed a limit, or null when
 * the request may proceed.
 */
export function checkRateLimit(estimatedNextTokens: number): string | null {
  if (!rate.enabled) return null;
  const now = Date.now();
  while (minuteWindow.length > 0 && now - minuteWindow[0].at > 60_000) minuteWindow.shift();
  const minuteTotal = minuteWindow.reduce((sum, w) => sum + w.tokens, 0);
  if (rate.maxTokensPerMinute > 0 && minuteTotal + estimatedNextTokens > rate.maxTokensPerMinute) {
    return `Token rate limit reached (${rate.maxTokensPerMinute.toLocaleString()} tokens/minute). Wait a moment, or raise the limit in Settings → Dashboard.`;
  }
  const day = store.days[todayKey()] ?? { input: 0, output: 0, requests: 0 };
  if (
    rate.maxTokensPerDay > 0 &&
    day.input + day.output + estimatedNextTokens > rate.maxTokensPerDay
  ) {
    return `Daily token budget reached (${rate.maxTokensPerDay.toLocaleString()} tokens). Raise or disable the budget in Settings → Dashboard.`;
  }
  return null;
}

/** Record one completed request round (exact or estimated token counts). */
export async function recordUsage(
  provider: string,
  model: string,
  input: number,
  output: number
): Promise<void> {
  const now = Date.now();
  minuteWindow.push({ at: now, tokens: input + output });
  const day = (store.days[todayKey()] ??= { input: 0, output: 0, requests: 0 });
  day.input += Math.max(0, Math.round(input));
  day.output += Math.max(0, Math.round(output));
  day.requests += 1;
  store.recent.unshift({ at: now, input, output, provider, model });
  if (store.recent.length > MAX_RECENT) store.recent.length = MAX_RECENT;
  persistUsage();
}

function persistUsage(): void {
  const raw = JSON.stringify(store);
  if (inNativeShell()) {
    void diskWrite(USAGE_KEY, raw);
  } else {
    try {
      localStorage.setItem(USAGE_KEY, raw);
    } catch {
      /* quota — ignore */
    }
  }
}

export interface UsageSnapshot {
  today: DayUsage;
  last7: Array<{ date: string; input: number; output: number; requests: number }>;
  recent: RecentRequest[];
  totalTokens: number;
}

/** Synchronous snapshot for the dashboard UI (reads the in-memory store). */
export function getUsageSnapshot(): UsageSnapshot {
  const today = store.days[todayKey()] ?? { input: 0, output: 0, requests: 0 };
  const last7: UsageSnapshot["last7"] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const k = keyFor(d);
    const u = store.days[k];
    last7.push({
      date: k,
      input: u?.input ?? 0,
      output: u?.output ?? 0,
      requests: u?.requests ?? 0,
    });
  }
  let totalTokens = 0;
  for (const u of Object.values(store.days)) totalTokens += u.input + u.output;
  return { today, last7, recent: store.recent.slice(0, 12), totalTokens };
}

/** Wipe all recorded usage data (Settings → Dashboard → Reset). */
export async function resetUsage(): Promise<void> {
  store = { days: {}, recent: [] };
  minuteWindow.length = 0;
  persistUsage();
}

/** Compact human formatting for token counts (1.2k / 3.4M). */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
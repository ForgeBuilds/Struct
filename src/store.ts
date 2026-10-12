/*
 * Author: madhusudhan
 * Check the LICENSE in the GitHub repo (https://github.com/Lumorix-studios/Struct) for more information on permissions to use this code.
 */
import { invoke, isNativeRuntime } from "./native";
import type { AISettings, ChatSession, Message } from "./types";
import { DEFAULT_SETTINGS } from "./types";

const SETTINGS_KEY = "neochat.settings.v2";
const SESSIONS_KEY = "neochat.sessions.v1";
const ACTIVE_SESSION_KEY = "neochat.activeSession.v1";

const STORAGE_PREFIX = "neochat:";

function inTauri(): boolean {
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

function lsRead(key: string): string | null {
  return localStorage.getItem(STORAGE_PREFIX + key);
}

function lsWrite(key: string, value: string): void {
  localStorage.setItem(STORAGE_PREFIX + key, value);
}

/** Settings persisted to disk never contain the API key — BYOK keys live in
 *  the account only (src/lib/byok.ts), so there is no device fallback. */
function stripApiKey(s: AISettings): AISettings {
  const { apiKey, ...rest } = s;
  void apiKey;
  return { ...DEFAULT_SETTINGS, ...rest, apiKey: "" };
}

/**
 * Settings
 */
export async function loadSettings(): Promise<AISettings> {
  const raw = inTauri() ? await diskRead(SETTINGS_KEY) : lsRead(SETTINGS_KEY);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    return stripApiKey({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: AISettings): Promise<void> {
  const raw = JSON.stringify(stripApiKey(settings));
  if (inTauri()) {
    const ok = await diskWrite(SETTINGS_KEY, raw);
    if (!ok) lsWrite(SETTINGS_KEY, raw);
  } else {
    lsWrite(SETTINGS_KEY, raw);
  }
}

/**
 * Chat sessions (multiple conversations)
 */
export async function loadSessions(): Promise<ChatSession[]> {
  const raw = inTauri() ? await diskRead(SESSIONS_KEY) : lsRead(SESSIONS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveSessions(sessions: ChatSession[]): Promise<void> {
  // Sessions embed a per-chat settings snapshot — strip API keys there too.
  const cleaned = sessions.map((s) => {
    const { apiKey, ...rest } = s.settings ?? ({} as AISettings);
    void apiKey;
    return s.settings
      ? { ...s, settings: { ...rest, apiKey: "" } as AISettings }
      : s;
  });
  const raw = JSON.stringify(cleaned);
  if (inTauri()) {
    const ok = await diskWrite(SESSIONS_KEY, raw);
    if (!ok) lsWrite(SESSIONS_KEY, raw);
  } else {
    lsWrite(SESSIONS_KEY, raw);
  }
}

export async function loadActiveSessionId(): Promise<string | null> {
  const raw = inTauri() ? await diskRead(ACTIVE_SESSION_KEY) : lsRead(ACTIVE_SESSION_KEY);
  return raw || null;
}

export async function saveActiveSessionId(id: string | null): Promise<void> {
  const raw = id ?? "";
  if (inTauri()) {
    const ok = await diskWrite(ACTIVE_SESSION_KEY, raw);
    if (!ok) lsWrite(ACTIVE_SESSION_KEY, raw);
  } else {
    lsWrite(ACTIVE_SESSION_KEY, raw);
  }
}

/**
 * Legacy single-chat history (for backward compatibility)
 */
export async function loadChatHistory(): Promise<Message[]> {
  const raw = inTauri() ? await diskRead("neochat.history.v2") : lsRead("neochat.history.v2");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveChatHistory(messages: Message[]): Promise<void> {
  const raw = JSON.stringify(messages.slice(-200));
  if (inTauri()) {
    const ok = await diskWrite("neochat.history.v2", raw);
    if (!ok) lsWrite("neochat.history.v2", raw);
  } else {
    lsWrite("neochat.history.v2", raw);
  }
}
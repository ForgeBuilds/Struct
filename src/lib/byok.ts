/*
 * Author: madhusudhan
 * Check the LICENSE in the GitHub repo (https://github.com/Lumorix-studios/Struct) for more information on permissions to use this code.
 */
/**
 * BYOK (Bring Your Own Key) — provider API keys for Struct.
 *
 * A key only exists inside a signed-in account: it is encrypted server-side
 * (AES-GCM inside the `api-keys` Supabase Edge Function) and stored in the
 * `user_api_keys` table. The decrypted key is held in memory only — never
 * written to disk.
 *
 * Signed out → no key at all. There is deliberately no local key store: keys
 * belong to the account, not the device. The legacy device stores are still
 * opened once by `clearLocalKey`, purely to purge keys written by older builds.
 */

import { supabase, isSupabaseConfigured } from "./supabase";
import { invoke, isNativeRuntime } from "../native";

const LOCAL_BYOK_KEY = "neo.byok.keys.v1";
const LOCAL_BYOK_STATE_KEY = "neochat.byok.local.v1";

/**
 * Providers that can hold a stored key (the app's ProviderId minus `ollama`,
 * which is a local server). Kept here so the client and the `api-keys` edge
 * function (which enforces the same set) cannot drift apart.
 */
export const BYOK_PROVIDERS = [
  "openai",
  "openrouter",
  "groq",
  "nvidia",
  "anthropic",
  "google",
  "custom",
] as const;

/**
 * Turn a supabase-js functions error into a readable message. Edge Function
 * non-2xx responses throw `FunctionsHttpError`, whose JSON body is attached
 * as `.context`.
 */
async function invokeErrorMessage(error: unknown, fallback: string): Promise<string> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx && typeof (ctx as Response).clone === "function") {
    try {
      const body = (await (ctx as Response).clone().json()) as { error?: string };
      if (body?.error) return body.error;
    } catch {
      /* body already consumed, or not JSON */
    }
  }
  const message = (error as { message?: string } | null)?.message;
  return message && message.trim() ? message : fallback;
}

interface LocalByokStore {
  [provider: string]: string;
}

function inDesktop(): boolean {
  return isNativeRuntime();
}

async function readLocalStore(): Promise<LocalByokStore> {
  try {
    let raw: string | null = null;
    if (inDesktop()) {
      raw = await invoke<string>("load_state", { key: LOCAL_BYOK_STATE_KEY });
      // Migrate the old WebView-local store into the desktop app-data store.
      if (!raw) raw = localStorage.getItem(LOCAL_BYOK_KEY);
    } else {
      raw = localStorage.getItem(LOCAL_BYOK_KEY);
    }
    const parsed = JSON.parse(raw ?? "{}");
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

async function writeLocalStore(store: LocalByokStore): Promise<void> {
  try {
    const raw = JSON.stringify(store);
    if (inDesktop()) {
      await invoke("save_state", { key: LOCAL_BYOK_STATE_KEY, value: raw });
    } else {
      localStorage.setItem(LOCAL_BYOK_KEY, raw);
    }
  } catch {
    if (!inDesktop()) {
      try {
        localStorage.setItem(LOCAL_BYOK_KEY, JSON.stringify(store));
      } catch {
        /* storage unavailable */
      }
    }
  }
}

/** Cached decrypted keys, in-memory only, keyed by provider id. */
const memoryKeys = new Map<string, string>();
const remoteKeyCache = new Map<string, string | null>();
const remoteKeyRequests = new Map<string, Promise<string | null>>();

/**
 * True when the user may store / read provider keys.
 *
 * Keys live in the account, so being signed in is the only requirement — there
 * is no paid-plan gate any more. Signed out is always false: there is no local
 * store to fall back to.
 */
export function byokAllowed(profile: { byokEnabled: boolean } | null, signedIn: boolean): boolean {
  return signedIn && profile?.byokEnabled !== false;
}

/** Fetch the decrypted key for a provider (signed-in users). */
export async function fetchRemoteKey(provider: string): Promise<string | null> {
  if (remoteKeyCache.has(provider)) return remoteKeyCache.get(provider) ?? null;
  const pending = remoteKeyRequests.get(provider);
  if (pending) return pending;
  const request = fetchRemoteKeyOnce(provider);
  remoteKeyRequests.set(provider, request);
  try {
    return await request;
  } finally {
    remoteKeyRequests.delete(provider);
  }
}

async function fetchRemoteKeyOnce(provider: string): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const sb = supabase();
  if (!sb) return null;
  const { data, error } = await sb.functions.invoke("api-keys", {
    method: "GET",
    headers: { "x-neo-provider": provider },
  });
  const payload = data as { apiKey?: string; error?: string } | null;
  if (error) {
    throw new Error(await invokeErrorMessage(error, "Could not load the key from your account."));
  }
  if (payload?.error) {
    throw new Error(payload.error);
  }
  if (payload?.apiKey) memoryKeys.set(provider, payload.apiKey);
  const key = payload?.apiKey ?? null;
  remoteKeyCache.set(provider, key);
  return key;
}

/** Encrypt + store a key server-side (signed-in users). */
export async function saveRemoteKey(provider: string, apiKey: string): Promise<void> {
  if (!isSupabaseConfigured) throw new Error("Not signed in — cannot save key to your account.");
  const sb = supabase();
  if (!sb) throw new Error("Not signed in.");
  if (!apiKey.trim()) return await removeRemoteKey(provider);
  const { error } = await sb.functions.invoke("api-keys", {
    body: { provider, apiKey: apiKey.trim() },
  });
  if (error) {
    throw new Error(await invokeErrorMessage(error, "Could not save the key to your account."));
  }
  const normalized = apiKey.trim();
  memoryKeys.set(provider, normalized);
  remoteKeyCache.set(provider, normalized);
  await clearLocalKey(provider);
}

/** Delete the stored key for a provider (signed-in users). */
export async function removeRemoteKey(provider: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const sb = supabase();
  if (!sb) return;
  const { error } = await sb.functions.invoke("api-keys", {
    method: "DELETE",
    headers: { "x-neo-provider": provider },
  });
  if (error) {
    throw new Error(await invokeErrorMessage(error, "Could not remove the key from your account."));
  }
  memoryKeys.delete(provider);
  remoteKeyCache.set(provider, null);
  await clearLocalKey(provider);
}

/**
 * Purge a key written by an older build's signed-out device store — desktop
 * builds used the Tauri app-data dir, browser builds localStorage. Only ever
 * called to clean up, never to read a key back.
 */
export async function clearLocalKey(provider: string): Promise<void> {
  const store = await readLocalStore();
  delete store[provider];
  await writeLocalStore(store);
}

/**
 * Resolve the API key for a provider at call time.
 *
 * A key is only returned for a signed-in user — signed out, the answer is an
 * empty key, never a device copy.
 */
export async function resolveApiKey(
  provider: string,
  signedIn: boolean,
  byokEnabled: boolean
): Promise<string> {
  if (!byokAllowed({ byokEnabled }, signedIn)) return "";
  if (memoryKeys.has(provider)) return memoryKeys.get(provider) ?? "";
  const remote = await fetchRemoteKey(provider);
  return remote ?? "";
}

/** Drop in-memory copies (on sign-out). */
export function clearMemoryKeys(): void {
  memoryKeys.clear();
  remoteKeyCache.clear();
  remoteKeyRequests.clear();
}

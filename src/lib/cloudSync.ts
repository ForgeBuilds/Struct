/*
 * Author: madhusudhan
 * Check the LICENSE in the GitHub repo (https://github.com/Lumorix-studios/Struct) for more information on permissions to use this code.
 */
/**
 * Per-user cloud sync for Struct — chats, AI settings and profile live in
 * Supabase (RLS-scoped to the signed-in user). Everything else (UI/theme
 * settings, recents, MCP servers, token usage, terminals) stays on-device.
 *
 * Conflict policy: last-writer-wins per table, driven by updated_at / client
 * timestamps. loadAll() returns cloud rows; the App merges them over the
 * local snapshot on sign-in (see App.tsx bootstrapCloud).
 */

import { supabase, isSupabaseConfigured } from "./supabase";
import { BYOK_PROVIDERS } from "./byok";
import type { AISettings, ChatSession } from "../types";
import { DEFAULT_SETTINGS } from "../types";

export interface CloudChatRow {
  id: string;
  title: string;
  messages: ChatSession["messages"];
  settings: Partial<AISettings> | null;
  created_at: string;
  updated_at: string;
}

export interface CloudSettings {
  provider: string;
  model: string;
  base_url: string;
  system_prompt: string;
  temperature: number;
  auto_approve_tools: boolean;
  updated_at: string;
}

export interface CloudSnapshot {
  chats: ChatSession[];
  settings: AISettings | null;
  fetchedAt: number;
}

function ms(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

function rowToSession(row: CloudChatRow): ChatSession {
  return {
    id: row.id,
    title: row.title,
    messages: Array.isArray(row.messages) ? row.messages : [],
    createdAt: ms(row.created_at) || Date.now(),
    updatedAt: ms(row.updated_at) || Date.now(),
    // API keys are never stored in this column — BYOK keys live in
    // user_api_keys and are injected at call time.
    settings: row.settings ? { ...DEFAULT_SETTINGS, ...row.settings, apiKey: "" } : undefined,
  };
}

function sessionToRow(s: ChatSession, userId: string): Record<string, unknown> {
  const { apiKey: _drop, ...rest } = s.settings ?? ({} as AISettings);
  void _drop;
  return {
    user_id: userId,
    id: s.id,
    title: s.title,
    messages: s.messages,
    settings: s.settings ? rest : null,
    created_at: new Date(s.createdAt).toISOString(),
    updated_at: new Date(s.updatedAt).toISOString(),
  };
}

/** Fetch every chat for the signed-in user, newest first. */
export async function fetchChats(): Promise<ChatSession[] | null> {
  if (!isSupabaseConfigured) return null;
  const sb = supabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("chats")
    .select("id, title, messages, settings, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) return null;
  return (data as unknown as CloudChatRow[]).map(rowToSession);
}

/** Delete one chat for the signed-in user. */
export async function deleteChat(id: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const sb = supabase();
  if (!sb) return;
  await sb.from("chats").delete().eq("id", id);
}

/** Upsert one chat (fire-and-forget safe; returns false on failure). */
export async function upsertChat(session: ChatSession): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const sb = supabase();
  if (!sb) return false;
  const { data } = await sb.auth.getSession();
  const uid = data.session?.user?.id;
  if (!uid) return false;
  const { error } = await sb.from("chats").upsert(sessionToRow(session, uid), { onConflict: "id" });
  return !error;
}

/** Upsert many chats in one round-trip batch. */
export async function upsertChats(sessions: ChatSession[]): Promise<void> {
  if (!isSupabaseConfigured || sessions.length === 0) return;
  const sb = supabase();
  if (!sb) return;
  const { data } = await sb.auth.getSession();
  const uid = data.session?.user?.id;
  if (!uid) return;
  const rows = sessions.map((s) => sessionToRow(s, uid));
  // Chunk to stay under request-size limits for very long histories.
  const CHUNK = 25;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await sb.from("chats").upsert(rows.slice(i, i + CHUNK), { onConflict: "id" });
  }
}

/** Fetch the user's AI settings row (null when absent). */
export async function fetchSettings(): Promise<AISettings | null> {
  if (!isSupabaseConfigured) return null;
  const sb = supabase();
  if (!sb) return null;
  const { data: session } = await sb.auth.getSession();
  const uid = session.session?.user?.id;
  if (!uid) return null;
  const { data, error } = await sb
    .from("user_settings")
    .select("provider, model, base_url, system_prompt, temperature, auto_approve_tools, updated_at")
    .eq("user_id", uid)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as CloudSettings;
  return {
    ...DEFAULT_SETTINGS,
    provider: row.provider as AISettings["provider"],
    model: row.model,
    baseUrl: row.base_url,
    systemPrompt: row.system_prompt,
    temperature: row.temperature,
    autoApproveTools: row.auto_approve_tools,
    // Surface the row's write time so the App can merge local-vs-cloud with
    // "newer updatedAt wins" (mirrors the per-chat merge).
    updatedAt: row.updated_at,
    apiKey: "", // never synced — BYOK keys are managed separately
  };
}

/** Upsert the user's AI settings (api key excluded by the caller). */
export async function upsertSettings(settings: AISettings): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const sb = supabase();
  if (!sb) return false;
  const { data } = await sb.auth.getSession();
  const uid = data.session?.user?.id;
  if (!uid) return false;
  // Explicit snake_case columns only — the client shape (baseUrl, systemPrompt,
  // autoApproveTools…) would be rejected by PostgREST as unknown columns.
  const { error } = await sb.from("user_settings").upsert(
    {
      user_id: uid,
      provider: settings.provider,
      model: settings.model,
      base_url: settings.baseUrl,
      system_prompt: settings.systemPrompt,
      temperature: settings.temperature,
      auto_approve_tools: settings.autoApproveTools ?? false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  return !error;
}

/** Fetch chats + settings in parallel (nulls when signed out / offline). */
export async function loadAll(): Promise<CloudSnapshot> {
  if (!isSupabaseConfigured) return { chats: [], settings: null, fetchedAt: Date.now() };
  const [chats, settings] = await Promise.all([fetchChats(), fetchSettings()]);
  return { chats: chats ?? [], settings, fetchedAt: Date.now() };
}

/**
 * Delete every cloud row for the signed-in user: chats, AI settings and the
 * encrypted BYOK keys. Local data is untouched (see the local caches above).
 * Throws if the chats/settings deletes fail so the UI can report it.
 */
export async function deleteAllCloudData(): Promise<void> {
  if (!isSupabaseConfigured) return;
  const sb = supabase();
  if (!sb) return;
  const { data } = await sb.auth.getSession();
  const uid = data.session?.user?.id;
  if (!uid) throw new Error("Not signed in.");
  const [chats, settings] = await Promise.all([
    sb.from("chats").delete().eq("user_id", uid),
    sb.from("user_settings").delete().eq("user_id", uid),
  ]);
  const failure = chats.error ?? settings.error;
  if (failure) throw new Error(failure.message);
  // Best-effort: keys live behind the edge function (RLS blocks direct writes),
  // and there is no "delete all" route, so clear every supported provider.
  await Promise.all(
    BYOK_PROVIDERS.map((provider) =>
      sb.functions
        .invoke("api-keys", { method: "DELETE", headers: { "x-neo-provider": provider } })
        .catch(() => undefined)
    )
  );
}
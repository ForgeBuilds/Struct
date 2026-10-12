/*
 * Author: madhusudhan
 * Check the LICENSE in the GitHub repo (https://github.com/Lumorix-studios/Struct) for more information on permissions to use this code.
 */
/**
 * Supabase client for Struct.
 *
 * Configured via Vite env vars (see .env.example at the repo root):
 *   VITE_SUPABASE_URL      — e.g. https://abcdefgh.supabase.co
 *   VITE_SUPABASE_ANON_KEY — the anon/public key from the same project
 *
 * When either var is missing the app runs fully local (every call in
 * auth.ts / cloudSync.ts / byok.ts degrades to local-only behaviour) so a
 * dev build without a Supabase project keeps working.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Project URL, e.g. https://abcdefgh.supabase.co (empty when unconfigured). */
export const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? "";
/** The public anon key belonging to `supabaseUrl` (empty when unconfigured). */
export const supabaseAnonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? "";

export const isSupabaseConfigured = supabaseUrl.length > 0 && supabaseAnonKey.length > 0;

/**
 * Fetch impl for supabase-js.
 *
 * Electron's Chromium network stack handles TLS itself, so plain
 * `window.fetch` is correct everywhere. The wrapper stays so the client keeps
 * a single place to add retries without touching call sites.
 */
async function resilientFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return window.fetch(input, init);
}

let client: SupabaseClient | null = null;
if (isSupabaseConfigured) {
  // persistSession: keep the login across app restarts (like VS Code sign-in).
  // autoRefreshToken: silently refresh JWTs in the background.
  client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false, // deep-link/token handling is done manually
      // Sessions are persisted in the renderer's localStorage under the
      // supabase-js storage key, so sign-in survives app restarts.
    },
    global: {
      // Single fetch path for Auth/PostgREST/Functions calls (resilientFetch),
      // so future retry/timeout behaviour applies everywhere at once.
      fetch: resilientFetch as typeof fetch,
    },
  });
}

/** The shared Supabase client, or `null` when env vars are not configured. */
export function supabase(): SupabaseClient | null {
  return client;
}
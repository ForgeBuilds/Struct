/*
 * Author: Lumorix Studios
 * Check the LICENSE in the GitHub repo (https://github.com/Lumorix-studios/Struct) for more information on permissions to use this code.
 */
// ═══════════════════════════════════════════════════════════════════════════
// Struct — `api-keys` Edge Function
//
// Encrypts/decrypts BYOK provider API keys with AES-256-GCM and stores them
// in the `user_api_keys` table. Plaintext keys never touch the database and
// direct table access from clients is blocked by RLS (no policies).
//
// Deploy:  supabase functions deploy api-keys
//          (JWT verification stays ON — the app sends the user's JWT, which we
//          validate with sb.auth.getUser() before touching any data.)
// Secrets: supabase secrets set BYOK_ENCRYPTION_KEY=<64 hex chars>
//          (generate with: openssl rand -hex 32)
// ═══════════════════════════════════════════════════════════════════════════

// `npm:` specifier is the dependency form Supabase recommends for Edge
// Functions (see Supabase docs → Edge Functions → Managing dependencies).
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-neo-provider",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function encryptionKey(): Promise<CryptoKey> {
  const hex = Deno.env.get("BYOK_ENCRYPTION_KEY")?.trim() ?? "";
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error("BYOK_ENCRYPTION_KEY secret is missing or not 64 hex chars.");
  }
  const raw = new Uint8Array(hex.match(/.{2}/g)!.map((b) => Number.parseInt(b, 16)));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encrypt(plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey();
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintext)
  );
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), iv.length);
  return btoa(String.fromCharCode(...out));
}

async function decrypt(blob64: string): Promise<string> {
  const blob = Uint8Array.from(atob(blob64), (c) => c.charCodeAt(0));
  const iv = blob.slice(0, 12);
  const ct = blob.slice(12);
  const key = await encryptionKey();
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return dec.decode(pt);
}

const ALLOWED_PROVIDERS = new Set([
  "openai", "openrouter", "groq", "nvidia",
  "deepseek", "mistral", "together", "fireworks", "cerebras",
  "perplexity", "xai", "deepinfra", "sambanova",
  "anthropic", "google", "custom",
]);

// BYOK is no longer a paid feature: any authenticated account may store and
// read its own provider keys. Authentication alone is the gate — the profile
// row is not consulted, so a missing/denied `plan` or `byok_enabled` can never
// lock a signed-in user out of their own keys.

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // Authenticate the caller with their JWT.
    const authHeader = req.headers.get("Authorization") ?? "";
    const sb = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: authData, error: authErr } = await sb.auth.getUser();
    if (authErr || !authData.user) return json({ error: "Unauthorized." }, 401);
    const userId = authData.user.id;

    // Service-role client: the only role allowed to touch the policy-less
    // `user_api_keys` table. Every query below is scoped to `userId`.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const url = new URL(req.url);
    // The client sends the provider as a header (supabase-js `functions.invoke`
    // has no query-string option); ?provider= is kept for curl/manual calls.
    const provider = (req.headers.get("x-neo-provider") ?? url.searchParams.get("provider") ?? "")
      .trim()
      .toLowerCase();

    if (req.method === "GET") {
      if (!ALLOWED_PROVIDERS.has(provider)) return json({ error: "Unknown provider." }, 400);
      const { data, error } = await admin
        .from("user_api_keys")
        .select("encrypted")
        .eq("user_id", userId)
        .eq("provider", provider)
        .maybeSingle();
      if (error) return json({ error: "Lookup failed." }, 500);
      if (!data) return json({ apiKey: null });
      return json({ apiKey: await decrypt(data.encrypted) });
    }

    if (req.method === "POST") {
      const body = (await req.json()) as { provider?: string; apiKey?: string };
      const p = (body.provider ?? "").trim().toLowerCase();
      const key = (body.apiKey ?? "").trim();
      if (!ALLOWED_PROVIDERS.has(p)) return json({ error: "Unknown provider." }, 400);
      if (!key) return json({ error: "Empty key." }, 400);
      const { error } = await admin.from("user_api_keys").upsert({
        user_id: userId,
        provider: p,
        encrypted: await encrypt(key),
        key_hint: key.slice(-4),
        updated_at: new Date().toISOString(),
      });
      if (error) return json({ error: "Could not save key." }, 500);
      return json({ ok: true });
    }

    if (req.method === "DELETE") {
      if (!ALLOWED_PROVIDERS.has(provider)) return json({ error: "Unknown provider." }, 400);
      const { error } = await admin
        .from("user_api_keys")
        .delete()
        .eq("user_id", userId)
        .eq("provider", provider);
      if (error) return json({ error: "Could not delete key." }, 500);
      return json({ ok: true });
    }

    return json({ error: "Method not allowed." }, 405);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

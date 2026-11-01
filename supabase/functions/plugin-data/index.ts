import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-neo-plugin",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});
const enc = new TextEncoder();
const dec = new TextDecoder();
const ALLOWED = new Set(["gmail", "spotify", "calendar", "github", "mcp"]);

async function cryptoKey(): Promise<CryptoKey> {
  const hex = Deno.env.get("BYOK_ENCRYPTION_KEY")?.trim() ?? "";
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error("BYOK_ENCRYPTION_KEY is missing or invalid.");
  const bytes = new Uint8Array(hex.match(/.{2}/g)!.map((v) => parseInt(v, 16)));
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encrypt(value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cryptoKey(), enc.encode(value)));
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv); out.set(cipher, iv.length);
  return btoa(String.fromCharCode(...out));
}

async function decrypt(value: string): Promise<string> {
  const data = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: data.slice(0, 12) }, await cryptoKey(), data.slice(12)));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const client = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", { global: { headers: { Authorization: auth } } });
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return json({ error: "Unauthorized." }, 401);
    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const userId = data.user.id;

    if (req.method === "GET") {
      const { data: rows, error: dbError } = await admin.from("user_plugin_connections").select("plugin, encrypted").eq("user_id", userId);
      if (dbError) return json({ error: "Could not load plugin connections." }, 500);
      const plugins: Record<string, unknown> = {};
      for (const row of rows ?? []) if (ALLOWED.has(row.plugin)) plugins[row.plugin] = JSON.parse(await decrypt(row.encrypted));
      return json({ plugins });
    }

    if (req.method === "POST") {
      const body = await req.json() as { plugin?: string; value?: unknown };
      const plugin = (body.plugin ?? "").trim().toLowerCase();
      if (!ALLOWED.has(plugin)) return json({ error: "Unknown plugin." }, 400);
      const raw = JSON.stringify(body.value);
      if (!raw || raw.length > 1_000_000) return json({ error: "Invalid plugin data." }, 400);
      const { error: dbError } = await admin.from("user_plugin_connections").upsert({ user_id: userId, plugin, encrypted: await encrypt(raw), updated_at: new Date().toISOString() });
      if (dbError) return json({ error: "Could not save plugin data." }, 500);
      return json({ ok: true });
    }

    if (req.method === "DELETE") {
      const plugin = (req.headers.get("x-neo-plugin") ?? new URL(req.url).searchParams.get("plugin") ?? "").trim().toLowerCase() || undefined;
      let query = admin.from("user_plugin_connections").delete().eq("user_id", userId);
      if (plugin) {
        if (!ALLOWED.has(plugin)) return json({ error: "Unknown plugin." }, 400);
        query = query.eq("plugin", plugin);
      }
      const { error: dbError } = await query;
      if (dbError) return json({ error: "Could not delete plugin data." }, 500);
      return json({ ok: true });
    }
    return json({ error: "Method not allowed." }, 405);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

import { supabase, isSupabaseConfigured } from "./supabase";

export type PluginId = "gmail" | "spotify" | "calendar" | "github" | "mcp";
export type PluginData = Partial<Record<PluginId, unknown>>;

async function requireClient() {
  if (!isSupabaseConfigured) throw new Error("Supabase is not configured.");
  const sb = supabase();
  if (!sb) throw new Error("Account database is unavailable.");
  const { data } = await sb.auth.getSession();
  if (!data.session) throw new Error("Sign in to sync plugin connections to your account.");
  return sb;
}

export async function savePluginData(plugin: PluginId, value: unknown): Promise<void> {
  const sb = await requireClient();
  const { error } = await sb.functions.invoke("plugin-data", { body: { plugin, value } });
  if (error) throw new Error(error.message || "Could not save plugin data to your account.");
}

export async function savePluginDataIfSignedIn(plugin: PluginId, value: unknown): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const sb = supabase();
  if (!sb) return false;
  const { data } = await sb.auth.getSession();
  if (!data.session) return false;
  await savePluginData(plugin, value);
  return true;
}

export async function loadPluginData(): Promise<PluginData | null> {
  if (!isSupabaseConfigured) return null;
  const sb = supabase();
  if (!sb) return null;
  const { data: session } = await sb.auth.getSession();
  if (!session.session) return null;
  const { data, error } = await sb.functions.invoke("plugin-data", { method: "GET" });
  if (error) throw new Error(error.message || "Could not load plugin connections from your account.");
  return (data as { plugins?: PluginData } | null)?.plugins ?? {};
}

export async function deletePluginData(plugin?: PluginId): Promise<void> {
  if (!isSupabaseConfigured) return;
  const sb = supabase();
  if (!sb) return;
  const { data: session } = await sb.auth.getSession();
  if (!session.session) return;
  const { error } = await sb.functions.invoke("plugin-data", {
    method: "DELETE",
    ...(plugin ? { headers: { "x-neo-plugin": plugin } } : {}),
  });
  if (error) throw new Error(error.message || "Could not delete plugin data.");
}

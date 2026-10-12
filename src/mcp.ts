/*
 * Author: madhusudhan
 * Check the LICENSE in the GitHub repo (https://github.com/Lumorix-studios/Struct) for more information on permissions to use this code.
 */

/**
 * (Model Context Protocol) client — two transports:
 *
 *  • "http"  — Streamable HTTP servers (JSON-RPC over POST, optional SSE
 *              responses, Mcp-Session-Id handling). Custom request headers
 *              (e.g. Authorization) are configured per server in Settings —
 *              nothing is hardcoded.
 *  • "stdio" — local servers spawned as child processes over the standard
 *              MCP stdio transport (one JSON-RPC message per line), managed
 *              by the Rust backend (mcp_stdio_* commands).
 */
import { invoke } from "./native";

export interface McpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  /** "http" = Streamable HTTP endpoint · "stdio" = local command process. */
  transport: "http" | "stdio";
  /** http transport: the MCP endpoint URL. */
  url?: string;
  /** http transport: extra request headers (e.g. Authorization). User-configured. */
  headers?: Record<string, string>;
  /** stdio transport: executable command (e.g. npx, python, node). */
  command?: string;
  /** stdio transport: command arguments (e.g. ["-y", "@modelcontextprotocol/server-filesystem", "C:/path"]). */
  args?: string[];
  /** stdio transport: working directory (defaults to the app's cwd). */
  cwd?: string;
  /** stdio transport: extra environment variables for the server process. */
  env?: Record<string, string>;
}

export interface McpToolInfo {
  name: string;
  description: string;
  /** JSON-schema for the tool's arguments, when the server advertises one. */
  inputSchema?: Record<string, unknown>;
  /** Server-declared read-only tool (safe to run parallel without approval). */
  readOnly?: boolean;
}

/** Value stored per discovered MCP tool in the agent loops. */
export interface McpToolEntry {
  server: McpServerConfig;
  tool: string;
  description?: string;
  /** Argument schema from tools/list, when the server provides one. */
  schema?: Record<string, unknown>;
  /** Server-declared read-only tool (safe to run parallel, no approval). */
  readOnly?: boolean;
}

const STORAGE_KEY = "neochat.mcp.v2";
const LEGACY_STORAGE_KEY = "neochat.mcp.v1";

// Newline char built at runtime so the source stays escape-sequence safe.
const NL = String.fromCharCode(10);

/** Fill defaults so configs saved by older versions keep working. */
function normalizeServer(raw: unknown): McpServerConfig {
  const s = (raw ?? {}) as Partial<McpServerConfig>;
  return {
    id: String(s.id ?? makeServerId()),
    name: String(s.name ?? "Untitled server"),
    enabled: s.enabled !== false,
    transport: s.transport === "stdio" ? "stdio" : "http",
    url: typeof s.url === "string" ? s.url : undefined,
    headers:
      s.headers && typeof s.headers === "object" && !Array.isArray(s.headers)
        ? (s.headers as Record<string, string>)
        : undefined,
    command: typeof s.command === "string" ? s.command : undefined,
    args: Array.isArray(s.args) ? s.args.map(String) : undefined,
    cwd: typeof s.cwd === "string" ? s.cwd : undefined,
    env:
      s.env && typeof s.env === "object" && !Array.isArray(s.env)
        ? (s.env as Record<string, string>)
        : undefined,
  };
}

export function loadMcpServers(): McpServerConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeServer) : [];
  } catch {
    return [];
  }
}

export function saveMcpServers(servers: McpServerConfig[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
}

export function makeServerId(): string {
  return `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Config auto-discovery ─────────────────────────────────────────────────────

/** A config file found on this machine, as reported by the Rust side. */
export interface McpConfigHit {
  app: string;
  path: string;
}

/** One server parsed out of a discovered config file. */
export interface DiscoveredServer {
  app: string;
  path: string;
  name: string;
  server: McpServerConfig;
}

/**
 * Stable fingerprint used to tell "the same server" apart across config files.
 * Two entries with the same endpoint (or the same command + args) are the same
 * server, however differently the two files happen to name it.
 */
export function serverFingerprint(s: McpServerConfig): string {
  if (s.transport === "stdio") {
    return `stdio:${(s.command ?? "").trim().toLowerCase()}|${(s.args ?? []).join(" ").trim().toLowerCase()}`;
  }
  return `http:${(s.url ?? "").trim().toLowerCase().replace(/\/+$/, "")}`;
}

/**
 * Expand environment references, delegating to the Rust implementation.
 *
 * This is essential, not cosmetic: Claude Desktop configs routinely carry
 * literal `${APPDATA}` / `%VAR%` in args and env values, and storing them
 * verbatim makes the server fail to spawn (ENOENT). The Rust spawn path
 * expands command/args/cwd itself, but env *values* are handed to the child
 * process untouched — so they must be expanded here, at import time.
 *
 * Unknown variables are left as written, matching the Rust behaviour.
 */
async function expandEnvRefs(value: string): Promise<string> {
  if (!value.includes("$") && !value.includes("%")) return value;
  try {
    return await invoke<string>("expand_env_string", { input: value });
  } catch {
    return value; // non-Tauri (browser dev) — leave as-is rather than fail
  }
}

/** Coerce a foreign config entry into our own shape, or null if unusable. */
async function parseForeignEntry(name: string, raw: unknown): Promise<McpServerConfig | null> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;

  // Some clients use `type: "http"` / `type: "sse"` instead of inferring from
  // the presence of a url. Honour an explicit `type` when it's an http-ish one.
  const type = typeof e.type === "string" ? e.type.toLowerCase() : "";
  const url = typeof e.url === "string" ? e.url.trim() : "";
  if (url || type === "http" || type === "sse" || type === "streamable-http") {
    if (!url) return null;
    const headers =
      e.headers && typeof e.headers === "object" && !Array.isArray(e.headers)
        ? Object.fromEntries(
            Object.entries(e.headers as Record<string, unknown>)
              .filter(([, v]) => typeof v === "string")
              .map(([k, v]) => [k, v as string])
          )
        : undefined;
    const expandedHeaders = headers
      ? Object.fromEntries(
          await Promise.all(
            Object.entries(headers).map(async ([k, v]) => [k, await expandEnvRefs(v)])
          )
        )
      : undefined;
    return normalizeServer({
      ...e,
      id: makeServerId(),
      name: String(e.name ?? name),
      enabled: true,
      transport: "http",
      url: await expandEnvRefs(url),
      headers:
        expandedHeaders && Object.keys(expandedHeaders).length > 0 ? expandedHeaders : undefined,
    });
  }

  const command = typeof e.command === "string" ? e.command.trim() : "";
  if (!command) return null;
  const rawEnv =
    e.env && typeof e.env === "object" && !Array.isArray(e.env)
      ? Object.fromEntries(
          Object.entries(e.env as Record<string, unknown>)
            .filter(([, v]) => typeof v === "string")
            .map(([k, v]) => [k, v as string])
        )
      : undefined;
  const expandedEnv = rawEnv
    ? Object.fromEntries(
        await Promise.all(
          Object.entries(rawEnv).map(async ([k, v]) => [k, await expandEnvRefs(v)])
        )
      )
    : undefined;
  const rawArgs = Array.isArray(e.args) ? e.args.map((a) => String(a)) : undefined;
  const expandedArgs = rawArgs
    ? await Promise.all(rawArgs.map((a) => expandEnvRefs(a)))
    : undefined;
  return normalizeServer({
    ...e,
    id: makeServerId(),
    name: String(e.name ?? name),
    enabled: true,
    transport: "stdio",
    command: await expandEnvRefs(command),
    args: expandedArgs,
    cwd: typeof e.cwd === "string" ? await expandEnvRefs(e.cwd) : undefined,
    env: expandedEnv && Object.keys(expandedEnv).length > 0 ? expandedEnv : undefined,
  });
}

/**
 * Parse one MCP config file's `mcpServers` block.
 *
 * Returns an empty list (never throws) for a missing file, malformed JSON or an
 * unexpected shape — a broken config in someone else's app must never break
 * ours. Callers can show a partial list.
 */
export async function parseMcpConfigFile(
  app: string,
  path: string
): Promise<DiscoveredServer[]> {
  let text: string;
  try {
    text = await invoke<string>("fs_read_file", { path });
  } catch {
    return []; // vanished or unreadable between the scan and the read
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }
  if (!json || typeof json !== "object") return [];

  const root = json as Record<string, unknown>;
  // VS Code nests servers under `servers` and requires per-entry `type`; most
  // other clients use `mcpServers`. Accept either, preferring `mcpServers`.
  const block =
    root.mcpServers ?? root.servers ?? (root as unknown as Record<string, unknown>);
  if (!block || typeof block !== "object" || Array.isArray(block)) return [];

  const out: DiscoveredServer[] = [];
  for (const [name, entry] of Object.entries(block as Record<string, unknown>)) {
    const server = await parseForeignEntry(name, entry).catch(() => null);
    if (server) out.push({ app, path, name: server.name, server });
  }
  return out;
}

/**
 * Scan the machine for MCP configs written by other tools and parse them.
 *
 * Returns everything found, including servers the user already has configured
 * here — filtering is the caller's job so it can show "already added" state
 * rather than silently hiding entries.
 */
export async function discoverMcpServers(
  workspaceRoot?: string | null
): Promise<DiscoveredServer[]> {
  let hits: McpConfigHit[];
  try {
    hits = await invoke<McpConfigHit[]>("mcp_discover_configs", {
      workspaceRoot: workspaceRoot ?? null,
    });
  } catch {
    return [];
  }
  const groups = await Promise.all(
    hits.map((h) => parseMcpConfigFile(h.app, h.path).catch(() => []))
  );
  return groups.flat();
}

/** Human-readable target for list rows ("https://…" or `npx -y pkg`). */
export function describeServer(s: McpServerConfig): string {
  if (s.transport === "stdio") {
    return [s.command, ...(s.args ?? [])].filter(Boolean).join(" ");
  }
  return s.url ?? "";
}

interface JsonRpcResponse {
  result?: unknown;
  error?: { message?: string };
  id?: string | number | null;
}

/* ── HTTP transport (Streamable HTTP) ──────────────────────────────────────── */

/** POST one JSON-RPC message; handles both JSON and SSE responses. */
async function rpc(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  sessionId?: string | null,
  timeoutMs = 8_000
): Promise<{ data: JsonRpcResponse | null; session: string | null }> {
  const allHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...headers,
  };
  if (sessionId) allHeaders["Mcp-Session-Id"] = sessionId;

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: allHeaders,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const text = (await res.text()).trim();
        if (text) detail = text.length > 200 ? `${text.slice(0, 200)}…` : text;
      } catch {
        /* keep status-only detail */
      }
      throw new Error(`MCP server returned ${detail}`);
    }

    const session = res.headers.get("mcp-session-id");
    const contentType = res.headers.get("content-type") ?? "";

    if (contentType.includes("text/event-stream")) {
      const text = await res.text();
      let data: JsonRpcResponse | null = null;
      for (const line of text.split(NL)) {
        const t = line.trim();
        if (t.startsWith("data:")) {
          try {
            data = JSON.parse(t.slice(5).trim()) as JsonRpcResponse;
          } catch {
            /* keep last good */
          }
        }
      }
      return { data, session };
    }

    return { data: (await res.json()) as JsonRpcResponse, session };
  } catch (e) {
    if (controller.signal.aborted) {
      throw new Error(`MCP server "${url}" timed out after ${timeoutMs / 1000}s`, { cause: e });
    }
    throw e;
  } finally {
    window.clearTimeout(timer);
  }
}

/* ── stdio transport (local command servers) ───────────────────────────────── */

/** Server ids with a live, initialized stdio process on the Rust side. */
const stdioSessions = new Set<string>();

/** Ensure a stdio server process is running and initialized (handshake once). */
async function ensureStdio(server: McpServerConfig): Promise<void> {
  if (stdioSessions.has(server.id)) return;
  if (!server.command) {
    throw new Error(`MCP server "${server.name}" has no command configured`);
  }

  await invoke("mcp_stdio_start", {
    id: server.id,
    command: server.command,
    args: server.args ?? [],
    cwd: server.cwd ?? null,
    env: server.env ?? null,
  });

  const init = await stdioRpc(server, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "Struct", version: "1.12.0" },
    },
  }, 10_000);
  if (init.error) {
    stdioSessions.delete(server.id);
    await stopStdio(server.id);
    throw new Error(init.error.message ?? "MCP initialize failed");
  }
  // notifications/initialized — no response expected.
  await invoke("mcp_stdio_send", {
    id: server.id,
    line: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  }).catch(() => undefined);

  stdioSessions.add(server.id);
}

/** Kill a stdio server process (used on remove / on fatal errors). */
export async function stopStdio(id: string): Promise<void> {
  stdioSessions.delete(id);
  try {
    await invoke("mcp_stdio_stop", { id });
  } catch {
    /* backend session already gone */
  }
}

/**
 * One correlated JSON-RPC request/response over stdio.
 * `timeoutMs` bounds the wait for the matching response — longer for
 * `tools/call` (Studio-side operations can be slow), shorter for the
 * handshake and `tools/list`.
 */
async function stdioRpc(
  server: McpServerConfig,
  body: Record<string, unknown>,
  timeoutMs = 30_000
): Promise<JsonRpcResponse> {
  const wantId = body.id;
  await invoke("mcp_stdio_send", { id: server.id, line: JSON.stringify(body) });

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`MCP server "${server.name}" timed out`);
    }
    const line = await invoke<string | null>("mcp_stdio_read", {
      id: server.id,
      timeoutMs: 750,
    });
    if (line == null) continue;
    let parsed: JsonRpcResponse;
    try {
      parsed = JSON.parse(line) as JsonRpcResponse;
    } catch {
      continue; // skip non-JSON noise (banners, logs)
    }
    // Skip server-initiated notifications; match our request id.
    if (wantId != null && parsed.id !== wantId) continue;
    return parsed;
  }
}

function extractTools(result: unknown): McpToolInfo[] {
  const tools = ((result as Record<string, unknown> | undefined)?.tools ?? []) as Array<
    Record<string, unknown>
  >;
  return tools.map((t) => ({
    name: String(t.name ?? ""),
    description: String(t.description ?? ""),
    inputSchema:
      t.inputSchema && typeof t.inputSchema === "object"
        ? (t.inputSchema as Record<string, unknown>)
        : undefined,
    readOnly:
      (t.annotations as Record<string, unknown> | undefined)?.readOnlyHint === true,
  }));
}

/**
 * Compact, model-readable parameter list for an MCP tool, e.g.
 * "code: string (required) — The Luau code to execute; studio_id: string (required)".
 * Empty string when the server gave no schema. Without this the model cannot
 * know which arguments a tool requires and guesses (→ repeated failures).
 */
export function formatMcpToolSchema(schema?: Record<string, unknown>): string {
  if (!schema || typeof schema !== "object") return "";
  const props = (schema.properties ?? {}) as Record<
    string,
    { type?: unknown; description?: unknown; enum?: unknown }
  >;
  const required = Array.isArray(schema.required)
    ? (schema.required as unknown[]).map(String)
    : [];
  const keys = Object.keys(props);
  if (keys.length === 0) return "";
  const parts = keys.map((k) => {
    const p = props[k] ?? {};
    const kind = Array.isArray(p.enum) ? p.enum.map(String).join("|") : String(p.type ?? "any");
    const req = required.includes(k) ? " (required)" : "";
    const desc = typeof p.description === "string" ? p.description.trim() : "";
    const d = desc.length > 100 ? `${desc.slice(0, 97)}...` : desc;
    return d ? `${k}: ${kind}${req} — ${d}` : `${k}: ${kind}${req}`;
  });
  return `Parameters: ${parts.join("; ")}`;
}

const CLIENT_INFO = { name: "Struct", version: "1.12.0" };
const MCP_DISCOVERY_TTL_MS = 30_000;

interface HttpSession {
  key: string;
  id: string | null;
}

interface HttpCacheEntry {
  session?: HttpSession;
  tools?: McpToolInfo[];
  toolsAt: number;
  initializing?: Promise<HttpSession>;
}

const httpCache = new Map<string, HttpCacheEntry>();

function httpCacheKey(server: McpServerConfig): string {
  return `${server.id}|${server.url ?? ""}|${JSON.stringify(server.headers ?? {})}`;
}

function clearHttpCache(server: McpServerConfig): void {
  httpCache.delete(httpCacheKey(server));
}

async function ensureHttpSession(server: McpServerConfig): Promise<HttpSession> {
  const key = httpCacheKey(server);
  const cached = httpCache.get(key) ?? { toolsAt: 0 };
  if (cached.session) return cached.session;
  if (cached.initializing) return cached.initializing;

  cached.initializing = (async () => {
    const init = await rpc(
      server.url ?? "",
      {
        jsonrpc: "2.0",
        id: `init_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: CLIENT_INFO },
      },
      server.headers ?? {}
    );
    if (init.data?.error) throw new Error(init.data.error.message ?? "MCP initialize failed");
      const id = init.session;
    await rpc(
      server.url ?? "",
      { jsonrpc: "2.0", method: "notifications/initialized" },
      server.headers ?? {},
      id
    ).catch(() => undefined);
    const session = { key, id };
    cached.session = session;
    cached.initializing = undefined;
    httpCache.set(key, cached);
    return session;
  })();
  httpCache.set(key, cached);
  try {
    return await cached.initializing;
  } catch (e) {
    cached.initializing = undefined;
    httpCache.delete(key);
    throw e;
  }
}

/** initialize → notifications/initialized → tools/list */
export async function listMcpTools(server: McpServerConfig): Promise<McpToolInfo[]> {
  if (server.transport === "stdio") {
    try {
      await ensureStdio(server);
      const list = await stdioRpc(server, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }, 10_000);
      if (list.error) throw new Error(list.error.message ?? "MCP tools/list failed");
      return extractTools(list.result);
    } catch (e) {
      stdioSessions.delete(server.id); // force a fresh spawn next time
      void stopStdio(server.id); // reap the (likely dead) backend process
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  const key = httpCacheKey(server);
  const cached = httpCache.get(key);
  if (cached?.tools && Date.now() - cached.toolsAt < MCP_DISCOVERY_TTL_MS) {
    return cached.tools;
  }
  const session = await ensureHttpSession(server);
  const list = await rpc(
    server.url ?? "",
    {
      jsonrpc: "2.0",
      id: `list_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      method: "tools/list",
      params: {},
    },
    server.headers ?? {},
    session.id
  );
  if (list.data?.error) throw new Error(list.data.error.message ?? "MCP tools/list failed");
  const tools = extractTools(list.data?.result);
  const entry = httpCache.get(key) ?? { toolsAt: 0 };
  entry.tools = tools;
  entry.toolsAt = Date.now();
  httpCache.set(key, entry);
  return tools;
}

/** Flatten a tools/call result into plain text. */
function extractToolOutput(result: unknown): string {
  const r = (result ?? {}) as Record<string, unknown>;
  const content = (r.content ?? []) as Array<Record<string, unknown>>;
  const text = content
    .map((c) => (typeof c.text === "string" ? c.text : JSON.stringify(c)))
    .join(NL)
    .trim();
  return text || "(empty result)";
}

/** initialize → tools/call */
export async function callMcpTool(
  server: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>
): Promise<{ ok: boolean; output: string }> {
  try {
    if (server.transport === "stdio") {
      try {
        await ensureStdio(server);
        const res = await stdioRpc(
          server,
          {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: toolName, arguments: args },
          },
          120_000
        );
        if (res.error) {
          return { ok: false, output: res.error.message ?? "MCP tool error" };
        }
        const isError = Boolean((res.result as Record<string, unknown> | undefined)?.isError);
        return { ok: !isError, output: extractToolOutput(res.result) };
      } catch (e) {
        stdioSessions.delete(server.id); // force a fresh spawn next call
        void stopStdio(server.id); // reap the (likely dead) backend process
        throw e instanceof Error ? e : new Error(String(e));
      }
    }

    const headers = server.headers ?? {};
    const session = await ensureHttpSession(server);

    const res = await rpc(
      server.url ?? "",
      {
        jsonrpc: "2.0",
        id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        method: "tools/call",
        params: { name: toolName, arguments: args },
      },
      headers,
      session.id,
      120_000
    );
    if (res.data?.error) {
      return { ok: false, output: res.data.error.message ?? "MCP tool error" };
    }

    const isError = Boolean((res.data?.result as Record<string, unknown> | undefined)?.isError);
    return { ok: !isError, output: extractToolOutput(res.data?.result) };
  } catch (e) {
    if (server.transport === "http") clearHttpCache(server);
    return { ok: false, output: e instanceof Error ? e.message : String(e) };
  }
}
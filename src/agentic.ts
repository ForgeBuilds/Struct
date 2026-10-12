/*
 * Author: madhusudhan
 * Check the LICENSE in the GitHub repo (https://github.com/Lumorix-studios/Struct) for more information on permissions to use this code.
 */

import { invoke } from "./native";

export type ToolName =
  | "read_file"
  | "read_file_range"
  | "write_file"
  | "append_file"
  | "replace_in_file"
  | "edit_file_lines"
  | "delete_file"
  | "delete_dir"
  | "create_dir"
  | "list_dir"
  | "search_files"
  | "rename"
  | "copy_file"
  | "file_info"
  | "run_command"
  | "git_status"
  | "git_diff"
  | "git_commit"
  | "get_open_files"
  | "read_active_file"
  | "web_search"
  | "web_fetch"
  | "http_request"
  | "env_info"
  | "analyze_project_structure";

export interface ToolCall {
  id?: string;
  /** Known tool name, or a dynamic name such as `mcp_<server>_<tool>`. */
  name: string;
  arguments: Record<string, unknown>;
  /** Gemini thinking models: opaque signature that must be echoed back. */
  thoughtSignature?: string;
}

export interface ToolResult {
  ok: boolean;
  output: string;
  data?: unknown; // Structured data for professional UI rendering (e.g., FsEntry[])
}

export interface AgenticActivity {
  id: string;
  /** Known tool name or a dynamic `mcp_<server>_<tool>` name. */
  tool: string;
  args: Record<string, unknown>;
  status: "pending" | "running" | "approved" | "denied" | "done" | "error";
  startedAt?: number;
  durationMs?: number;
  output?: string;
  error?: string;
  /** Structured tool payload (e.g. FsEntry[] from list_dir) for rich UI. */
  data?: unknown;
  /** Line diff (old → new) attached after a successful file mutation. */
  diff?: Array<{ type: "add" | "del" | "ctx"; text: string }>;
}

export interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number | null;
  modified: number | null;
}

/** Tools that mutate the filesystem / execute code and need user approval. */
const DESTRUCTIVE: ToolName[] = [
  "write_file",
  "append_file",
  "replace_in_file",
  "edit_file_lines",
  "delete_file",
  "delete_dir",
  "create_dir",
  "rename",
  "copy_file",
  "run_command",
  "http_request",
  "git_commit",
];

export function isDestructive(name: string): boolean {
  return (DESTRUCTIVE as string[]).includes(name);
}

const TOOL_NAME_SET = new Set<string>([
  "read_file",
  "read_file_range",
  "write_file",
  "append_file",
  "replace_in_file",
  "edit_file_lines",
  "delete_file",
  "delete_dir",
  "create_dir",
  "list_dir",
  "search_files",
  "rename",
  "copy_file",
  "file_info",
  "run_command",
  "git_status",
  "git_diff",
  "git_commit",
  "get_open_files",
  "read_active_file",
  "web_search",
  "web_fetch",
  "http_request",
  "env_info",
  "analyze_project_structure",
]);

export function isToolName(name: string): name is ToolName {
  return TOOL_NAME_SET.has(name);
}

/** Resolve a model-supplied path against the open workspace root. */
export function resolveFsPath(input: string, workspaceRoot?: string | null): string {
  const p = String(input ?? "").trim();
  if (!p) return p;
  if (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("/") || p.startsWith("\\\\")) return p;
  if (!workspaceRoot) return p;
  const root = workspaceRoot.replace(/[\\/]+$/, "");
  const useWin = /\\/.test(root) || /^[a-zA-Z]:/.test(root);
  const sep = useWin ? "\\" : "/";
  const rel = p.replace(/^[\\/]+/, "").replace(/[\\/]+/g, sep);
  return `${root}${sep}${rel}`;
}

interface JsonSchema {
  type: "object";
  properties: Record<string, { type: string; description: string }>;
  required: string[];
}

const pathProp = { type: "string", description: "File or folder path. Absolute, or relative to the workspace root." };

export const TOOL_JSON_SCHEMAS: Record<ToolName, { description: string; parameters: JsonSchema }> = {
  get_open_files: {
    description:
      "List the files currently open in the editor tabs and which one is active/focused.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  read_active_file: {
    description:
      "Read the current contents of the file that is active (focused) in the editor.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  read_file: {
    description: "Read the full contents of a text file.",
    parameters: { type: "object", properties: { path: pathProp }, required: ["path"] },
  },
  read_file_range: {
    description: "Read a line range from a text file. end_line=0 means until EOF.",
    parameters: {
      type: "object",
      properties: {
        path: pathProp,
        start_line: { type: "integer", description: "1-based start line." },
        end_line: { type: "integer", description: "1-based end line, or 0 for EOF." },
      },
      required: ["path"],
    },
  },
  write_file: {
    description: "Create or overwrite a file (creates parent folders).",
    parameters: {
      type: "object",
      properties: {
        path: pathProp,
        content: { type: "string", description: "Full file contents to write." },
      },
      required: ["path", "content"],
    },
  },
  append_file: {
    description: "Append text to a file, creating it if missing.",
    parameters: {
      type: "object",
      properties: {
        path: pathProp,
        content: { type: "string", description: "Text to append." },
      },
      required: ["path", "content"],
    },
  },
  replace_in_file: {
    description:
      "Replace exact occurrence(s) of search with replace. Replaces the first occurrence, or every occurrence when all=true.",
    parameters: {
      type: "object",
      properties: {
        path: pathProp,
        search: { type: "string", description: "Exact text to find." },
        replace: { type: "string", description: "Replacement text." },
        all: {
          type: "boolean",
          description: "Replace every occurrence instead of just the first (default false).",
        },
      },
      required: ["path", "search", "replace"],
    },
  },
  delete_file: {
    description: "Permanently delete a file.",
    parameters: { type: "object", properties: { path: pathProp }, required: ["path"] },
  },
  delete_dir: {
    description: "Recursively delete a folder.",
    parameters: { type: "object", properties: { path: pathProp }, required: ["path"] },
  },
  create_dir: {
    description: "Create a folder (and parents).",
    parameters: { type: "object", properties: { path: pathProp }, required: ["path"] },
  },
  list_dir: {
    description: "List files and folders in a directory.",
    parameters: { type: "object", properties: { path: pathProp }, required: ["path"] },
  },
  search_files: {
    description: "Recursively search for pattern in file paths, or file contents when content=true.",
    parameters: {
      type: "object",
      properties: {
        path: pathProp,
        pattern: { type: "string", description: "Case-insensitive substring to match." },
        content: { type: "boolean", description: "Search file contents instead of paths." },
      },
      required: ["path", "pattern"],
    },
  },
  rename: {
    description: "Rename or move a file or folder.",
    parameters: {
      type: "object",
      properties: {
        path: pathProp,
        new_path: { type: "string", description: "Destination path." },
      },
      required: ["path", "new_path"],
    },
  },
  copy_file: {
    description: "Copy a file to a new location (creates parent folders).",
    parameters: {
      type: "object",
      properties: {
        path: pathProp,
        new_path: { type: "string", description: "Destination path." },
      },
      required: ["path", "new_path"],
    },
  },
  file_info: {
    description: "Get a file's or folder's size, type and last-modified time.",
    parameters: { type: "object", properties: { path: pathProp }, required: ["path"] },
  },
  edit_file_lines: {
    description:
      "Replace an inclusive line range with new content. end_line=0 means from start_line to EOF.",
    parameters: {
      type: "object",
      properties: {
        path: pathProp,
        start_line: { type: "integer", description: "1-based start line." },
        end_line: { type: "integer", description: "1-based end line, or 0 for EOF." },
        content: { type: "string", description: "Replacement content for the range." },
      },
      required: ["path", "start_line", "content"],
    },
  },
  git_status: {
    description: "Show the git branch and changed files of the open workspace.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  git_diff: {
    description: "Show the current (or staged, staged=true) git diff of the workspace.",
    parameters: {
      type: "object",
      properties: {
        staged: { type: "boolean", description: "Show staged changes instead (default false)." },
      },
      required: [],
    },
  },
  git_commit: {
    description: "Stage ALL workspace changes (git add -A) and commit with the given message.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "The commit message." },
      },
      required: ["message"],
    },
  },
  http_request: {
    description:
      "Perform an arbitrary HTTP request to any API (REST, JSON…). Requires approval. Never use for plain web page reading — use web_fetch.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute http(s) URL." },
        method: { type: "string", description: "HTTP method (default GET)." },
        headers: {
          type: "string",
          description: "Request headers, one per line, 'Name: Value' format.",
        },
        body: { type: "string", description: "Request body (e.g. JSON payload) for POST/PUT." },
      },
      required: ["url"],
    },
  },
  env_info: {
    description: "Report the environment: OS/platform, locale, current local time, workspace root.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  run_command: {
    description:
      "Run a shell command (builds, tests, git, package managers…) and capture stdout/stderr.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to run." },
        cwd: { type: "string", description: "Working directory. Defaults to the workspace root." },
        timeout_secs: { type: "integer", description: "Timeout in seconds (1-900, default 120). Use a long timeout for builds, installs and test suites." },
      },
      required: ["command"],
    },
  },
  web_search: {
    description: "Search the web for real-time information, documentation, or latest library versions.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query." },
      },
      required: ["query"],
    },
  },
  web_fetch: {
    description: "Fetch and extract text content from a specific web page URL.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch." },
      },
      required: ["url"],
    },
  },
  analyze_project_structure: {
    description: "Perform a deep analysis of the workspace structure to map architecture and dependencies.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

/** OpenAI / OpenRouter / Groq / Ollama / custom compatible tools array. */
export const OPENAI_TOOLS = (Object.keys(TOOL_JSON_SCHEMAS) as ToolName[]).map((name) => ({
  type: "function" as const,
  function: {
    name,
    description: TOOL_JSON_SCHEMAS[name].description,
    parameters: TOOL_JSON_SCHEMAS[name].parameters,
  },
}));

/** Anthropic `tools` array. */
export const ANTHROPIC_TOOLS = (Object.keys(TOOL_JSON_SCHEMAS) as ToolName[]).map((name) => ({
  name,
  description: TOOL_JSON_SCHEMAS[name].description,
  input_schema: TOOL_JSON_SCHEMAS[name].parameters,
}));

/** Gemini functionDeclarations. */
export const GEMINI_FUNCTION_DECLARATIONS = (Object.keys(TOOL_JSON_SCHEMAS) as ToolName[]).map((name) => ({
  name,
  description: TOOL_JSON_SCHEMAS[name].description,
  parameters: TOOL_JSON_SCHEMAS[name].parameters,
}));

export interface NativeToolAcc {
  id: string;
  name: string;
  arguments: string;
  /** Gemini: thoughtSignature captured from the emitting part. */
  thoughtSignature?: string;
}

function parseArgBlob(raw: string): Record<string, unknown> {
  const t = raw.trim();
  if (!t) return {};
  try {
    const v = JSON.parse(t) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* lenient retry below */
  }
  // Lenient retry for unescaped-backslash Windows paths etc.
  try {
    const v = JSON.parse(repairJsonBlob(t)) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return { _raw: t };
}

export function nativeAccToCalls(acc: NativeToolAcc[]): ToolCall[] {
  return acc
    .filter((a) => a.name)
    .map((a) => ({
      id: a.id || undefined,
      name: a.name as ToolName,
      arguments: parseArgBlob(a.arguments),
      ...(a.thoughtSignature ? { thoughtSignature: a.thoughtSignature } : {}),
    }));
}

/** Fold a provider stream/response chunk into accumulated native tool calls. */
export function ingestNativeChunk(json: unknown, acc: NativeToolAcc[]): void {
  if (!json || typeof json !== "object") return;
  const j = json as Record<string, unknown>;

  const ingestList = (list: unknown, indexed: boolean) => {
    if (!Array.isArray(list)) return;
    for (let i = 0; i < list.length; i++) {
      const tc = list[i] as Record<string, unknown>;
      if (!tc || typeof tc !== "object") continue;
      const idx = indexed && typeof tc.index === "number" ? tc.index : acc.length > 0 && !tc.id ? acc.length - 1 : acc.length;
      while (acc.length <= idx) acc.push({ id: "", name: "", arguments: "" });
      if (typeof tc.id === "string" && tc.id) acc[idx].id = tc.id;
      const fn = (tc.function as Record<string, unknown> | undefined) ?? tc;
      if (typeof fn.name === "string" && fn.name) acc[idx].name = fn.name;
      const args = fn.arguments ?? fn.args ?? fn.input;
      if (typeof args === "string") acc[idx].arguments += args;
      else if (args && typeof args === "object") acc[idx].arguments = JSON.stringify(args);
    }
  };

  const choices = j.choices as Array<Record<string, unknown>> | undefined;
  const choice = choices?.[0];
  const delta = choice?.delta as Record<string, unknown> | undefined;
  const msg = (choice?.message ?? j.message) as Record<string, unknown> | undefined;
  ingestList(delta?.tool_calls, true);
  ingestList(msg?.tool_calls, false);

  if (j.type === "content_block_start") {
    const cb = j.content_block as Record<string, unknown> | undefined;
    if (cb?.type === "tool_use") {
      const input = cb.input && typeof cb.input === "object" ? JSON.stringify(cb.input) : "";
      acc.push({
        id: typeof cb.id === "string" ? cb.id : `ant_${acc.length}`,
        name: typeof cb.name === "string" ? cb.name : "",
        arguments: input,
      });
    }
  }
  if (j.type === "content_block_delta") {
    const d = j.delta as Record<string, unknown> | undefined;
    if (d?.type === "input_json_delta" && acc.length > 0) {
      acc[acc.length - 1].arguments += String(d.partial_json ?? "");
    }
  }

  const parts =
    (j.candidates as Array<{ content?: { parts?: Array<Record<string, unknown>> } }> | undefined)?.[0]
      ?.content?.parts ?? [];
  for (const p of parts) {
    const fc = p?.functionCall as Record<string, unknown> | undefined;
    if (fc && typeof fc.name === "string") {
      acc.push({
        id: `gem_${acc.length}`,
        // Some Gemini models prefix function names with the default
        // namespace ("default_api:tool_name") — strip it so tool dispatch
        // still matches.
        name: fc.name.replace(/^default_api:/, ""),
        arguments: JSON.stringify(fc.args ?? fc.arguments ?? {}),
        // Thinking models attach an opaque signature to the functionCall
        // part; it must be echoed back when the call is replayed, or the
        // next request fails with 400 "missing a thought_signature".
        // Accept both REST spellings (camelCase / snake_case).
        thoughtSignature:
          (typeof p.thoughtSignature === "string" && p.thoughtSignature) ||
          (typeof p.thought_signature === "string" && p.thought_signature) ||
          undefined,
      });
    }
  }
}

export function agenticSystemPrompt(
  workspaceRoot?: string | null,
  editor?: EditorContext,
  mcpTools?: Array<{ server: string; tool: string; description: string; signature?: string }>
): string {
  const ws = workspaceRoot
    ? `Workspace root: ${workspaceRoot}\nPrefer paths relative to this root. Absolute paths also work.\n`
    : "If the user has not opened a folder, ask for a path or use absolute paths.\n";
  let ed = "";
  if (editor && editor.openPaths.length > 0) {
    ed += `\nOpen editor tabs: ${editor.openPaths.join(", ")}`;
    if (editor.activePath) {
      ed += `\nThe ACTIVE file the user is viewing: ${editor.activePath}. If the task says "this file" or "the current file" without naming one, use it.`;
    }
  }

  let mcp = "";
  if (mcpTools && mcpTools.length > 0) {
    mcp = "\\n\\n## 🔌 DYNAMIC MCP MODULES\\n" + 
          "The following external tools are available via MCP. Call them as `mcp_<server>_<tool>`:\\n" +
          mcpTools.map(t => `- \`${t.server}_${t.tool}\`: ${t.description}${t.signature ? `\n  ${t.signature}` : ""}`).join("\\n");
  }

  return `${AGENTIC_PROMPT}\\n\\n${ws}${ed}${mcp}`;
}

function inTauri(): boolean {
  const win = window as unknown as { __TAURI_INTERNALS__?: unknown };
  return !!win.__TAURI_INTERNALS__;
}

/** Browser fallback for non-Tauri (dev in plain browser) — read-only ops only. */
async function browserFallback(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  switch (name) {
    case "list_dir": {
      // Can't list a real directory in the browser; return a helpful message.
      return { ok: true, output: "Directory listing is only available in the desktop app (Tauri)." };
    }
    case "read_file": {
      const path = String(args.path ?? "");
      try {
        const res = await fetch(path);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return { ok: true, output: await res.text() };
      } catch (e) {
        return { ok: false, output: `Failed to read ${path}: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    default:
      return {
        ok: false,
        output: `Tool "${name}" is only available in the desktop app (Tauri).`,
      };
  }
}

/** Desktop-aware fetch: loopback Ollama requests go through the Electron main
 * process (bypassing webview CORS / origin policy), everything else uses
 * plain fetch. Used by the web_fetch / web_search tools. */
async function platformFetch(url: string, init?: RequestInit): Promise<Response> {
  if (inTauri()) {
    try {
      const parsed = new URL(url);
      if (
        (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") &&
        parsed.port === "11434"
      ) {
        const headers = new Headers(init?.headers);
        headers.set("Origin", "http://localhost");
        return await fetch(url, { ...init, headers });
      }
      return await fetch(url, init);
    } catch (e) {
      throw new Error(
        `Desktop HTTP request failed: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e }
      );
    }
  }
  return fetch(url, init);
}

/** Decode the HTML entities that show up in search-result text. */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x2F;/g, "/")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&[a-z]+;/gi, "");
}

/** Strip tags and collapse whitespace from an HTML fragment. */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

/** One parsed organic search result. */
export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** Pull organic results out of DuckDuckGo's html endpoint output. */
function parseDdgResults(html: string, max: number): WebSearchResult[] {
  // DDG wraps external links in /l/?uddg=<encoded>&rut=… redirects.
  const decodeUrl = (href: string): string => {
    const m = /[?&]uddg=([^&]+)/.exec(href);
    if (m) {
      try {
        return decodeURIComponent(m[1]);
      } catch {
        return href;
      }
    }
    return href.startsWith("//") ? `https:${href}` : href;
  };
  return collectResults(html, max, /<a\s[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/gi, /<a\s[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi, decodeUrl);
}

/** Pull organic results out of DuckDuckGo's lite endpoint output. */
function parseDdgLiteResults(html: string, max: number): WebSearchResult[] {
  // Same /l/?uddg= redirect wrapping as the html endpoint. Note: the lite
  // endpoint renders attributes with single quotes — accept both styles.
  const decodeUrl = (href: string): string => {
    const m = /[?&]uddg=([^&]+)/.exec(href);
    if (m) {
      try {
        return decodeURIComponent(m[1]);
      } catch {
        return href;
      }
    }
    return href.startsWith("//") ? `https:${href}` : href;
  };
  return collectResults(
    html,
    max,
    /<a\s[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/gi,
    /<td\s[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi,
    decodeUrl
  );
}

/** Pair up result anchors with snippets in document order. */
function collectResults(
  html: string,
  max: number,
  anchorRe: RegExp,
  snippetRe: RegExp,
  decodeUrl: (href: string) => string
): WebSearchResult[] {
  const hrefRe = /href="([^"]*)"/i;
  const titles: Array<{ title: string; url: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null && titles.length < max) {
    const href = hrefRe.exec(m[0])?.[1] ?? "";
    titles.push({ title: decodeEntities(stripHtml(m[1])), url: decodeUrl(href) });
  }
  const snippets: string[] = [];
  while ((m = snippetRe.exec(html)) !== null && snippets.length < max) {
    snippets.push(decodeEntities(stripHtml(m[1])));
  }
  return titles.map((t, i) => ({ ...t, snippet: snippets[i] ?? "" }));
}

/** Headers that make the request look like a real browser. Search engines
 * fingerprint non-browser clients (reqwest's default UA) and serve
 * anti-bot challenge pages instead of results. */
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/** True when the engine served an anti-bot challenge instead of results. */
function looksLikeChallenge(body: string): boolean {
  return /anomaly|challenge|captcha|verify you are/i.test(body);
}

async function searchViaDdgHtml(query: string): Promise<WebSearchResult[] | null> {
  const res = await platformFetch(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    { method: "GET", headers: BROWSER_HEADERS }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  // DDG returns HTTP 202 + a challenge page when it flags the client — that
  // must be treated as an engine failure, not "no results".
  if (looksLikeChallenge(html)) return null;
  return parseDdgResults(html, 8);
}

async function searchViaDdgLite(query: string): Promise<WebSearchResult[] | null> {
  const res = await platformFetch(
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
    { method: "GET", headers: BROWSER_HEADERS }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  if (looksLikeChallenge(html)) return null;
  return parseDdgLiteResults(html, 8);
}

/** Extract one tag's content from an RSS <item>, handling CDATA. */
function xmlField(item: string, tag: string): string {
  const re = new RegExp(
    `<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${tag}>`,
    "i"
  );
  const m = re.exec(item);
  return decodeEntities(stripHtml(m ? (m[1] ?? m[2] ?? "") : ""));
}

async function searchViaBingRss(query: string): Promise<WebSearchResult[] | null> {
  // Bing's RSS output is machine-friendly XML and the most bot-tolerant of
  // the free endpoints — the reliable last fallback.
  const res = await platformFetch(
    `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&count=10`,
    { method: "GET", headers: BROWSER_HEADERS }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  const results: WebSearchResult[] = [];
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null && results.length < 8) {
    const title = xmlField(m[1], "title");
    const url = xmlField(m[1], "link");
    const snippet = xmlField(m[1], "description");
    if (title && url) results.push({ title, url, snippet });
  }
  return results.length > 0 ? results : null;
}

/** Snapshot of the user's editor state handed to editor-aware tools. */
export interface EditorContext {
  /** Paths of all currently open editor tabs. */
  openPaths: string[];
  /** Path of the focused/active tab, if any. */
  activePath: string | null;
  /** Returns the live (possibly unsaved) buffer contents for an open path. */
  getTabContent?: (path: string) => string | null;
}

/**
 * Execute a single tool call. Returns a ToolResult that is fed back to the
 * model as a `<tool_result>` block.
 */
async function executeToolUncached(
  name: string,
  args: Record<string, unknown>,
  workspaceRoot?: string | null,
  editor?: EditorContext
): Promise<ToolResult> {
  // Editor-aware tools operate on open tabs; they take no paths, so run them
  // before path resolution.
  if (name === "get_open_files") {
    const e = editor ?? { openPaths: [], activePath: null };
    if (e.openPaths.length === 0)
      return { ok: true, output: "No files are currently open in the editor." };
    const lines = e.openPaths.map((p) =>
      p === e.activePath ? `[ACTIVE] ${p}` : `        ${p}`
    );
    return { ok: true, output: `Open editor tabs:\n${lines.join("\n")}` };
  }
  if (name === "read_active_file") {
    if (!editor?.activePath)
      return { ok: false, output: "No file is currently active in the editor." };
    const content = editor.getTabContent?.(editor.activePath);
    if (content == null)
      return { ok: false, output: "Could not read the active tab's contents." };
    const MAX_READ = 12000;
    const out =
      content.length <= MAX_READ
        ? content
        : `${content.slice(0, MAX_READ)}\n... [truncated, ${content.length - MAX_READ} chars omitted]`;
    return { ok: true, output: `${editor.activePath}:\n${out}` };
  }
  const resolved: Record<string, unknown> = { ...args };
  if (typeof resolved.path === "string") {
    // Sanitize model-supplied paths: strip wrapping quotes, whitespace and
    // invisible characters that make the OS reject an otherwise-correct
    // path (these fail IDENTICALLY every retry, tripping the loop breaker).
    resolved.path = resolveFsPath(
      resolved.path
        .replace(/^["']+|["']+$/g, "")
        .replace(/[\u200b-\u200f\u2028\u2029\ufeff]/g, "")
        .trim(),
      workspaceRoot
    );
  }
  if (typeof resolved.new_path === "string") {
    resolved.new_path = resolveFsPath(resolved.new_path, workspaceRoot);
  }
  args = resolved;
  if (!inTauri()) {
    return browserFallback(name, args);
  }
  try {
    switch (name) {
      case "read_file": {
        const content = await invoke<string>("fs_read_file", { path: String(args.path ?? "") });
        // Smart truncation: keep the model oriented by reporting the file's
        // size and pointing at read_file_range instead of dumping everything.
        const MAX_READ = 60000;
        if (content.length <= MAX_READ) return { ok: true, output: content };
        const NL_CH = String.fromCharCode(10);
        const totalLines = content.split(NL_CH).length;
        const head = Math.floor(MAX_READ * 0.7);
        const tail = MAX_READ - head;
        const headLine = content.slice(0, head).split(NL_CH).length;
        const tailStartLine = content.slice(0, content.length - tail).split(NL_CH).length;
        return {
          ok: true,
          output:
            `[Truncated preview — file has ${totalLines} lines / ${content.length} chars.` +
            ` Use read_file_range(start_line=${headLine + 1}, end_line=${tailStartLine - 1}) for the middle section.]` +
            `${NL_CH}${content.slice(0, head)}${NL_CH}… [${content.length - head - tail} chars omitted] …${NL_CH}` +
            content.slice(content.length - tail),
        };
      }
      case "read_file_range":
        return {
          ok: true,
          output: await invoke<string>("fs_read_file_range", {
            path: String(args.path ?? ""),
            startLine: Number(args.start_line ?? 1),
            endLine: Number(args.end_line ?? 0),
          }),
        };
      case "write_file":
        await invoke("fs_write_file", {
          path: String(args.path ?? ""),
          content: String(args.content ?? ""),
        });
        return { ok: true, output: `Wrote ${String(args.path)} (${String(args.content ?? "").length} chars).` };
      case "append_file":
        await invoke("fs_append_file", {
          path: String(args.path ?? ""),
          content: String(args.content ?? ""),
        });
        return { ok: true, output: `Appended ${String(args.content ?? "").length} chars to ${String(args.path)}.` };
      case "replace_in_file": {
        const replaceAll = args.all === true;
        await invoke("fs_replace_in_file", {
          path: String(args.path ?? ""),
          search: String(args.search ?? ""),
          replace: String(args.replace ?? ""),
          all: replaceAll,
        });
        return {
          ok: true,
          output: `Replaced ${replaceAll ? "all occurrences" : "first occurrence"} in ${String(args.path)}.`,
        };
      }
      case "delete_file":
        await invoke("fs_delete_file", { path: String(args.path ?? "") });
        return { ok: true, output: `Deleted file ${String(args.path)}.` };
      case "copy_file":
        await invoke("fs_copy_file", {
          path: String(args.path ?? ""),
          newPath: String(args.new_path ?? ""),
        });
        return { ok: true, output: `Copied ${String(args.path)} → ${String(args.new_path)}.` };
      case "file_info": {
        const stat = await invoke<{
          path: string;
          isDir: boolean;
          size: number | null;
          modified: number | null;
        }>("fs_stat", { path: String(args.path ?? "") });
        const lines = [
          `Path: ${stat.path}`,
          `Type: ${stat.isDir ? "directory" : "file"}`,
          stat.isDir ? null : `Size: ${stat.size ?? "?"} bytes`,
          stat.modified ? `Modified: ${new Date(stat.modified).toISOString()}` : null,
        ].filter((l): l is string => l !== null);
        return { ok: true, output: lines.join("\n"), data: stat };
      }
      case "edit_file_lines": {
        const startL = Number(args.start_line ?? 1);
        const endL = Number(args.end_line ?? 0);
        await invoke("fs_write_file_range", {
          path: String(args.path ?? ""),
          startLine: startL,
          endLine: endL,
          content: String(args.content ?? ""),
        });
        return {
          ok: true,
          output: `Replaced lines ${startL}-${endL === 0 ? "EOF" : endL} in ${String(args.path)}.`,
        };
      }
      case "git_status":
      case "git_diff":
      case "git_commit": {
        if (!workspaceRoot) {
          return { ok: false, output: "No workspace folder is open, so git tools are unavailable." };
        }
        const runGit = async (command: string, timeoutSecs = 60) =>
          invoke<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }>(
            "run_command",
            { command, cwd: workspaceRoot, timeoutSecs }
          );
        if (name === "git_status") {
          const r = await runGit("git status --porcelain=v1 -b", 30);
          return {
            ok: r.exitCode === 0,
            output:
              r.exitCode === 0
                ? r.stdout.trim() || "(clean working tree — no changes)"
                : `git status failed:\n${(r.stderr || r.stdout).slice(0, 4000)}`,
          };
        }
        if (name === "git_diff") {
          const r = await runGit(args.staged === true ? "git diff --cached" : "git diff", 60);
          const out = `${r.stdout}\n${r.stderr}`.trim();
          const MAX_DIFF = 12000;
          return {
            ok: r.exitCode === 0,
            output:
              r.exitCode === 0
                ? out.length <= MAX_DIFF
                  ? out || "(no changes)"
                  : `${out.slice(0, MAX_DIFF)}\n... [${out.length - MAX_DIFF} chars truncated]`
                : `git diff failed:\n${out.slice(0, 4000)}`,
          };
        }
        // git_commit
        const message = String(args.message ?? "").trim();
        if (!message) {
          return { ok: false, output: "git_commit requires a non-empty commit message." };
        }
        const add = await runGit("git add -A", 60);
        if (add.exitCode !== 0) {
          return {
            ok: false,
            output: `git add -A failed:\n${(add.stderr || add.stdout).slice(0, 4000)}`,
          };
        }
        const commit = await runGit(`git commit -m ${JSON.stringify(message)}`, 60);
        return {
          ok: commit.exitCode === 0,
          output:
            commit.exitCode === 0
              ? (commit.stdout || "Committed.").trim()
              : `git commit failed:\n${(commit.stderr || commit.stdout).slice(0, 4000)}`,
        };
      }
      case "http_request": {
        const method = String(args.method ?? "GET").toUpperCase();
        const url = String(args.url ?? "").trim();
        if (!/^https?:\/\//i.test(url)) {
          return { ok: false, output: "http_request requires an absolute http(s) URL." };
        }
        const headers: Record<string, string> = { ...BROWSER_HEADERS };
        const headerText = typeof args.headers === "string" ? args.headers : "";
        for (const line of headerText.split("\n")) {
          const idx = line.indexOf(":");
          if (idx > 0) headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
        const bodyText = typeof args.body === "string" ? args.body : "";
        const hasBody = bodyText.length > 0 && method !== "GET" && method !== "HEAD";
        const res = await platformFetch(url, {
          method,
          headers,
          ...(hasBody ? { body: bodyText } : {}),
        });
        const text = (await res.text().catch(() => "")) ?? "";
        const MAX_HTTP = 16000;
        const excerpt =
          text.length <= MAX_HTTP
            ? text
            : `${text.slice(0, MAX_HTTP)}\n... [${text.length - MAX_HTTP} chars truncated]`;
        return { ok: res.ok, output: `HTTP ${res.status} ${res.statusText}\n${excerpt}` };
      }
      case "env_info": {
        const nav = navigator as Navigator & { platform?: string };
        const lines = [
          `User agent: ${nav.userAgent}`,
          `Platform: ${nav.platform ?? "unknown"}`,
          `Languages: ${navigator.languages?.join(", ") ?? navigator.language}`,
          workspaceRoot ? `Workspace: ${workspaceRoot}` : "Workspace: (none open)",
          `Local time: ${new Date().toString()}`,
        ];
        return { ok: true, output: lines.join("\n") };
      }
      case "delete_dir":
        await invoke("fs_delete_dir", { path: String(args.path ?? "") });
        return { ok: true, output: `Deleted directory ${String(args.path)}.` };
      case "create_dir":
        await invoke("fs_create_dir", { path: String(args.path ?? "") });
        return { ok: true, output: `Created directory ${String(args.path)}.` };
      case "list_dir": {
        const runList = (dir: string) =>
          invoke<FsEntry[]>("fs_list_dir", { path: dir });
        const requested = String(args.path ?? "").trim();
        if ((requested === "." || requested === "") && !workspaceRoot) {
          return {
            ok: false,
            output:
              "No folder is open and no file is active. Ask the user to open a folder from the sidebar or a file in the editor first.",
          };
        }
        let entries: FsEntry[];
        try {
          entries = await runList(requested || String(workspaceRoot ?? "."));
        } catch (err) {
          if (workspaceRoot && requested && resolveFsPath(requested, workspaceRoot) !== workspaceRoot) {
            entries = await runList(workspaceRoot);
          } else {
            throw err;
          }
        }
        const lines = entries.map((e) => {
          const kind = e.is_dir ? "dir " : "file";
          const size = e.size != null ? ` (${e.size} bytes)` : "";
          return `${kind}  ${e.name}${size}`;
        });
        return {
          ok: true,
          output: lines.length > 0 ? lines.join("\n") : "(empty directory)",
          data: entries,
        };
      }
      case "search_files": {
        const runSearch = (dir: string) =>
          invoke<string[]>("fs_search_files", {
            path: dir,
            pattern: String(args.pattern ?? ""),
            content: Boolean(args.content ?? false),
          });
        const requested = String(args.path ?? "").trim();
        let hits: string[];
        try {
          hits = await runSearch(requested || String(workspaceRoot ?? "."));
        } catch (err) {
          if (workspaceRoot && requested) {
            // The model guessed a directory that doesn't exist — retry from
            // the workspace root so one bad guess doesn't kill the task.
            hits = await runSearch(workspaceRoot);
          } else {
            throw err;
          }
        }
        return {
          ok: true,
          output: hits.length > 0 ? hits.join("\n") : "No matches found.",
        };
      }
      case "rename":
        await invoke("fs_rename", {
          path: String(args.path ?? ""),
          newPath: String(args.new_path ?? ""),
        });
        return { ok: true, output: `Renamed ${String(args.path)} -> ${String(args.new_path)}.` };
      case "run_command": {
        const cwdArg = typeof args.cwd === "string" && args.cwd.trim() ? args.cwd.trim() : null;
        const res = await invoke<Record<string, unknown>>("run_command", {
          command: String(args.command ?? ""),
          cwd: cwdArg ? resolveFsPath(cwdArg, workspaceRoot) : null,
          timeoutSecs: typeof args.timeout_secs === "number" ? Math.round(args.timeout_secs) : null,
        });
        const timedOut = Boolean(res.timedOut);
        const exitCode = res.exitCode as number | null;
        // Cap streams — massive outputs blow up downstream diff/render paths.
        const CAP = 24000;
        const cap = (t: string): string =>
          t.length > CAP ? `${t.slice(0, CAP)}\n...[truncated ${t.length - CAP} chars]` : t;
        const stdout = cap(String(res.stdout ?? "").trim());
        const stderr = cap(String(res.stderr ?? "").trim());
        const NL_CH2 = String.fromCharCode(10);
        const parts: string[] = [];
        if (timedOut) parts.push("Command timed out and was killed.");
        else parts.push(`Exit code: ${exitCode}`);
        if (stdout) parts.push(`stdout:${NL_CH2}${stdout}`);
        if (stderr) parts.push(`stderr:${NL_CH2}${stderr}`);
        return { ok: !timedOut && exitCode === 0, output: parts.join(`${NL_CH2}${NL_CH2}`) };
      }
      case "web_search": {
        // Real web search with a fallback chain: search engines serve
        // anti-bot challenges to non-browser clients (the Tauri HTTP plugin
        // identifies as reqwest by default), so we try multiple engines and
        // stop the model from retrying identically when all fail.
        const query = String(args.query ?? "").trim();
        if (!query) {
          return {
            ok: false,
            output:
              'No search query provided. Emit the query argument, e.g. {"name": "web_search", "arguments": {"query": "latest news Nepal floods"}}.',
          };
        }
        const engines: Array<{ name: string; run: () => Promise<WebSearchResult[] | null> }> = [
          { name: "duckduckgo", run: () => searchViaDdgHtml(query) },
          { name: "duckduckgo-lite", run: () => searchViaDdgLite(query) },
          { name: "bing", run: () => searchViaBingRss(query) },
        ];
        const failures: string[] = [];
        for (const engine of engines) {
          try {
            const results = await engine.run();
            if (results && results.length > 0) {
              const formatted = results.map(
                (r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`
              );
              const out = `Web search results for "${query}" (via ${engine.name}):\n\n${formatted.join("\n\n")}`;
              return {
                ok: true,
                output: out.length > 12000 ? `${out.slice(0, 12000)}\n... [truncated]` : out,
                // Structured payload so the activity feed can render these as
                // clickable links instead of a wall of plain text.
                data: results,
              };
            }
            failures.push(`${engine.name}: no parseable results`);
          } catch (e) {
            failures.push(`${engine.name}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        return {
          ok: false,
          output:
            `Web search failed on all engines (${failures.join("; ")}). ` +
            `Do NOT retry web_search for this query — answer from your existing knowledge instead, ` +
            `or use web_fetch on a specific URL if the user provided one.` +
            (!inTauri()
              ? ` (Note: plain-browser dev mode blocks cross-origin requests via CORS — use the Neo desktop app for web access.)`
              : ""),
        };
      }
      case "web_fetch": {
        // Normalize the URL: weak models often emit bare domains, wrapping
        // quotes or paths with unencoded spaces.
        const rawUrl = String(args.url ?? "")
          .replace(/^["']+|["']+$/g, "")
          .trim();
        if (!rawUrl) {
          return {
            ok: false,
            output:
              'No URL provided. Emit the url argument, e.g. {"name": "web_fetch", "arguments": {"url": "https://example.com/page"}}.',
          };
        }
        let url = rawUrl;
        if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
        try {
          // Browser-like headers — many sites 403 the default reqwest UA.
          const res = await platformFetch(url, { headers: BROWSER_HEADERS, redirect: "follow" });
          if (!res.ok) {
            const status = res.status;
            let hint: string;
            if (status === 401 || status === 403) {
              hint =
                "This site blocks automated readers. Do NOT retry this URL — use web_search on the topic instead, or fetch a different site.";
            } else if (status === 404 || status === 410) {
              hint =
                "That exact page does not exist. Do NOT retry this URL — use web_search to find the correct URL, or fetch the site's section/page that web_search listed.";
            } else {
              hint = "Do NOT retry this URL unchanged.";
            }
            return { ok: false, output: `Failed to fetch ${url}: HTTP ${status}. ${hint}` };
          }
          const text = await res.text();
          if (looksLikeChallenge(text)) {
            return {
              ok: false,
              output: `Failed to fetch ${url}: the site served an anti-bot challenge instead of content. Do NOT retry this URL — use web_search on the topic instead, or fetch a different site.`,
            };
          }
          // Simple cleanup to avoid blowing up the context window with raw HTML.
          const cleaned = text.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, "")
                             .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, "")
                             .replace(/<[^>]+>/g, " ")
                             .replace(/\s+/g, " ")
                             .trim();
          if (cleaned.length < 200) {
            return {
              ok: false,
              output: `Fetched ${url} but it contains (almost) no readable text — it is likely a JS-only app or an error shell. Do NOT retry this URL — use web_search on the topic instead.`,
            };
          }
          return {
            ok: true,
            output: cleaned.length > 15000
              ? `${cleaned.slice(0, 15000)}\n... [truncated for context]`
              : cleaned
          };
        } catch (e) {
          return { ok: false, output: `Failed to fetch ${url}: ${e instanceof Error ? e.message : String(e)}` };
        }
      }
      case "analyze_project_structure": {
        if (!workspaceRoot) return { ok: false, output: "No workspace root open. Cannot analyze project structure." };
        try {
          // Deep analysis: list the root, then look for common project markers
          const entries = await invoke<FsEntry[]>("fs_list_dir", { path: workspaceRoot });
          const markers = {
            packageJson: entries.find(e => e.name === "package.json"),
            cargoToml: entries.find(e => e.name === "Cargo.toml"),
            pyProject: entries.find(e => e.name === "pyproject.toml"),
            goMod: entries.find(e => e.name === "go.mod"),
            readme: entries.find(e => e.name.toLowerCase().startsWith("readme")),
          };
          
          let summary = `Project Analysis for: ${workspaceRoot}\n`;
          summary += `Total Top-level entries: ${entries.length}\n`;
          summary += `Detected project type: ${markers.packageJson ? "Node.js/TS" : markers.cargoToml ? "Rust" : markers.pyProject ? "Python" : markers.goMod ? "Go" : "Unknown"}\n`;
          summary += `Key files found: ${Object.entries(markers).filter(([, v]) => v !== undefined).map(([k]) => k).join(", ")}\n`;
          summary += `\nDirectory map:\n${entries.map(e => `${e.is_dir ? "📁" : "📄"} ${e.name}`).join("\n")}`;
          
          return { ok: true, output: summary };
        } catch (e) {
          return { ok: false, output: `Analysis failed: ${e instanceof Error ? e.message : String(e)}` };
        }
      }
      default:
        return {
          ok: false,
          output: `Unknown tool "${name}". Use one of the documented tools, or an "mcp_<server>_<tool>" name for a connected MCP server.`,
        };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    let argPreview = "(unserializable)";
    try {
      argPreview = JSON.stringify(args).slice(0, 300);
    } catch {
      /* keep fallback */
    }
    return {
      ok: false,
      output: `${msg} | tool_args: ${argPreview}`,
    };
  }
}

/* ── Tool result cache ─────────────────────────────────────────────────────── */
/**
 * Agents routinely re-read the same file, directory or search result several
 * times in one turn (and parallel tool batches can contain duplicate calls).
 * A short-lived cache plus in-flight de-duplication removes that repeated I/O
 * while staying invisible to the model — entries expire after a few seconds and
 * every mutating tool wipes the cache before and after it runs.
 */
const TOOL_CACHE_TTL_MS = 4000;
const TOOL_CACHE_MAX_ENTRIES = 64;

/** Read-only tools whose results can be safely reused for a few seconds. */
const CACHEABLE_TOOLS = new Set<string>([
  "read_file",
  "read_file_range",
  "list_dir",
  "file_info",
  "search_files",
]);

interface ToolCacheEntry {
  at: number;
  result: ToolResult;
}

const toolCache = new Map<string, ToolCacheEntry>();
const toolInflight = new Map<string, Promise<ToolResult>>();

/** Drop every cached tool result (used when files may have changed). */
export function clearToolCache(): void {
  toolCache.clear();
}

function cacheKeyFor(name: string, args: Record<string, unknown>, workspaceRoot?: string | null): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(args);
  } catch {
    serialized = "{}";
  }
  return `${name}|${workspaceRoot ?? ""}|${serialized}`;
}

function rememberToolResult(key: string, result: ToolResult): void {
  if (toolCache.size >= TOOL_CACHE_MAX_ENTRIES) {
    const oldest = toolCache.keys().next().value;
    if (oldest !== undefined) toolCache.delete(oldest);
  }
  toolCache.set(key, { at: Date.now(), result });
}

/**
 * Execute a single tool call. Returns a ToolResult that is fed back to the
 * model as a `<tool_result>` block. Read-only tools are memoised briefly;
 * mutating tools invalidate the cache so the next read sees fresh contents.
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  workspaceRoot?: string | null,
  editor?: EditorContext
): Promise<ToolResult> {
  const useCache = CACHEABLE_TOOLS.has(name);
  const mutates = isDestructive(name) || name.startsWith("mcp_");
  const key = cacheKeyFor(name, args, workspaceRoot);

  if (useCache) {
    const hit = toolCache.get(key);
    if (hit && Date.now() - hit.at < TOOL_CACHE_TTL_MS) return hit.result;
    const pending = toolInflight.get(key);
    if (pending) return pending;
  }

  if (mutates) clearToolCache();

  const run = (async () => {
    const result = await executeToolUncached(name, args, workspaceRoot, editor);
    if (useCache && result.ok) rememberToolResult(key, result);
    if (mutates) clearToolCache();
    return result;
  })();

  if (useCache) {
    toolInflight.set(key, run);
    void run.finally(() => {
      if (toolInflight.get(key) === run) toolInflight.delete(key);
    }).catch(() => {
      /* the caller still receives the rejection from `run` */
    });
  }
  return run;
}


function coerceArgs(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") return parseArgBlob(raw);
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return {};
}

function pushNamedCall(calls: ToolCall[], name: unknown, args: unknown): void {
  if (typeof name !== "string" || !name) return;
  calls.push({ name: name as ToolName, arguments: coerceArgs(args) });
}

/**
 * Repair common LLM JSON mistakes so tool calls survive:
 *  - unescaped backslashes in Windows paths ("C:\Users\x") → properly escaped
 *  - smart quotes → straight quotes
 */
function repairJsonBlob(raw: string): string {
  let s = raw
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\\(?![\\/"bfnrtu])/g, "\\\\");

  // Balance truncation damage: models often stream a call that gets cut off
  // mid-string or mid-object (e.g. replace_in_file with a huge search text).
  // Close any unterminated string literal and append the missing closers so
  // the blob parses instead of being discarded.
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === '"') inStr = !inStr;
  }
  if (inStr) s += '"';
  const openObj = (s.match(/{/g) || []).length - (s.match(/}/g) || []).length;
  const openArr = (s.match(/\[/g) || []).length - (s.match(/]/g) || []).length;
  if (openArr > 0) s += "]".repeat(openArr);
  if (openObj > 0) s += "}".repeat(openObj);
  return s;
}

function tryParseJsonCall(blob: string, calls: ToolCall[]): boolean {
  try {
    const parsed = JSON.parse(blob) as {
      name?: string;
      tool?: string;
      // OpenAI-style nested shape some models emit in text:
      // { "type": "function", "function": { "name": ..., "arguments": {...} } }
      function?: { name?: string; arguments?: unknown };
      arguments?: unknown;
      parameters?: unknown;
      args?: unknown;
    };

    // Nested OpenAI-style shape first.
    if (parsed.function && typeof parsed.function.name === "string") {
      pushNamedCall(calls, parsed.function.name, parsed.function.arguments ?? {});
      return true;
    }

    // Wrapper shape some models emit: {"tool_calls": [{name, arguments}, …]}
    if (Array.isArray((parsed as Record<string, unknown>).tool_calls)) {
      let ok = false;
      for (const item of (parsed as Record<string, unknown>).tool_calls as unknown[]) {
        if (tryParseJsonCall(JSON.stringify(item), calls)) ok = true;
      }
      if (ok) return true;
    }

    const name = parsed.name ?? parsed.tool;
    if (typeof name === "string") {
      pushNamedCall(calls, name, parsed.arguments ?? parsed.parameters ?? parsed.args ?? {});
      return true;
    }
  } catch {
    // Lenient retry: models frequently emit Windows paths with unescaped
    // backslashes ("C:\Users\x") which is invalid JSON. Repair and reparse.
    const fixed = repairJsonBlob(blob);
    if (fixed !== blob) return tryParseJsonCall(fixed, calls);
  }
  return false;
}

/** Parse a blob that may be a single call or a JSON array of calls. */
function tryParseJsonBlob(blob: string, calls: ToolCall[]): boolean {
  const t = blob.trim();
  if (t.startsWith("[")) {
    try {
      const arr = JSON.parse(t) as unknown[];
      let ok = false;
      for (const item of arr) {
        if (tryParseJsonCall(JSON.stringify(item), calls)) ok = true;
      }
      return ok;
    } catch {
      return false;
    }
  }
  return tryParseJsonCall(t, calls);
}

/** True when a JSON blob has both a name-ish key and an args-ish key. */
function looksLikeToolCallJson(blob: string): boolean {
  return (
    /"\s*(?:tool|name|function)"\s*:/.test(blob) &&
    /"\s*(?:arguments|parameters|args|input)"\s*:/.test(blob)
  );
}


export function extractBareJsonCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  for (let i = 0; i < text.length; i++) {
    const openCh = text[i];
    if (openCh !== "{" && openCh !== "[") continue;
    let depth = 0;
    let end = -1;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) break;
    const blob = text.slice(i, end + 1);
    if (looksLikeToolCallJson(blob)) {
      const before = calls.length;
      tryParseJsonBlob(blob, calls);
      if (calls.length > before) i = end; // skip past the consumed blob
    }
  }
  return calls;
}

/**
 * Hide an incomplete trailing bare-JSON tool call while streaming, e.g.
 * `…{"tool": "read_fi` — otherwise partial JSON flashes in the chat and
 * breaks the surrounding markdown until the blob completes.
 */
function stripTrailingPartialJson(text: string): string {
  const m = /\{[^{}]*$/.exec(text);
  if (!m) return text;
  // Match partial keys too ("tool", "nam", "argumen"…) since the stream
  // may be cut mid-key or mid-value.
  if (/"(?:tool|name|function|argumen|paramete|inpu)/.test(m[0])) {
    return text.slice(0, m.index);
  }
  return text;
}

/** Remove bare JSON tool-call blobs from visible output. */
function stripBareJsonCalls(text: string): string {
  // Cheap pre-check before running the O(n²) scanner.
  if (!/"\s*(?:tool|name|function)"\s*:/.test(text)) return text;
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "{") {
      let depth = 0;
      let end = -1;
      for (let j = i; j < text.length; j++) {
        const ch = text[j];
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            end = j;
            break;
          }
        }
      }
      const blob = end !== -1 ? text.slice(i, end + 1) : "";
      if (blob && looksLikeToolCallJson(blob)) {
        const before: ToolCall[] = [];
        tryParseJsonBlob(blob, before);
        if (before.length > 0) {
          i = end + 1;
          continue; // drop the blob
        }
      }
    }
    out += text[i];
    i++;
  }
  return out;
}

/**
 * Parse text tool calls from many model families (XML, Hermes, Qwen, markdown JSON).
 */
export function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const re = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const inner = m[1].trim();
    if (tryParseJsonBlob(inner, calls)) {
      continue;
    }
    const fn = inner.match(/<function=([^>\s]+)>[\s\S]*?<\/function>/i) ?? inner.match(/^([a-zA-Z0-9_]+)\s*\n/);
    if (fn) {
      const name = fn[1];
      const argObj: Record<string, unknown> = {};
      const argRe = /<parameter=([^>]+)>\s*([\s\S]*?)\s*<\/parameter>/gi;
      let am: RegExpExecArray | null;
      while ((am = argRe.exec(inner)) !== null) argObj[am[1]] = am[2];
      if (Object.keys(argObj).length === 0) {
        tryParseJsonCall(inner.replace(/^[^\n]+\n/, ""), calls);
      } else {
        pushNamedCall(calls, name, argObj);
      }
    }
  }

  const invokeRe = /<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/gi;
  while ((m = invokeRe.exec(text)) !== null) {
    const argObj: Record<string, unknown> = {};
    const argRe = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/gi;
    let am: RegExpExecArray | null;
    while ((am = argRe.exec(m[2])) !== null) argObj[am[1]] = am[2];
    pushNamedCall(calls, m[1], argObj);
  }

  const hermesRe = /<function=([^>\s]+)>([\s\S]*?)<\/function>/gi;
  while ((m = hermesRe.exec(text)) !== null) {
    if (!tryParseJsonCall(m[2], calls)) {
      const argObj: Record<string, unknown> = {};
      const argRe = /<parameter=([^>]+)>\s*([\s\S]*?)\s*<\/parameter>/gi;
      let am: RegExpExecArray | null;
      while ((am = argRe.exec(m[2])) !== null) argObj[am[1]] = am[2];
      pushNamedCall(calls, m[1], argObj);
    }
  }

  // <function_call> {"name": ..., "arguments": {...}} </function_call>
  // (the format llama-family models frequently emit in plain text)
  const fcRe = /<function_call>\s*([\s\S]*?)\s*<\/function_call>/gi;
  while ((m = fcRe.exec(text)) !== null) {
    const inner = m[1].trim();
    if (!inner) continue;
    if (tryParseJsonBlob(inner, calls)) continue;
    // Name on its own line followed by an args JSON blob
    const nm = inner.match(/^([a-zA-Z0-9_]+)\s*\n?([\s\S]*)$/);
    if (nm && nm[2].trim()) {
      const args: Record<string, unknown> = {};
      try {
        const v = JSON.parse(repairJsonBlob(nm[2].trim())) as unknown;
        if (v && typeof v === "object" && !Array.isArray(v)) {
          Object.assign(args, v as Record<string, unknown>);
          pushNamedCall(calls, nm[1], args);
        }
      } catch {
        /* unparseable — skip */
      }
    }
  }

  // Self-named XML tags emitted by some models:
  //   <read_active_file/>   <list_dir>{"path": "."}</list_dir>
  const xmlTagRe =
    /<([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*)>([\s\S]*?)<\/\1>|<([a-zA-Z_][a-zA-Z0-9_]*)\s*\/>/g;
  while ((m = xmlTagRe.exec(text)) !== null) {
    const tagName = String(m[1] ?? m[3] ?? "").toLowerCase();
    if (!isToolName(tagName) && !tagName.startsWith("mcp")) continue;
    const inner = (m[2] ?? "").trim();
    if (!inner) {
      pushNamedCall(calls, tagName, {});
      continue;
    }
    if (!tryParseJsonBlob(inner, calls)) {
      // key="value" attribute-style arguments inside the tag
      const argObj: Record<string, unknown> = {};
      const kvRe = /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*"([^"]*)"/g;
      let km: RegExpExecArray | null;
      while ((km = kvRe.exec(inner)) !== null) argObj[km[1]] = km[2];
      pushNamedCall(calls, tagName, argObj);
    }
  }

  const fenceRe = /```(?:json|tool_call|tool)?\s*([\s\S]*?)```/gi;
  while ((m = fenceRe.exec(text)) !== null) {
    tryParseJsonBlob(m[1].trim(), calls);
  }

  // Bare JSON objects printed as plain text (no tags/fences at all).
  calls.push(...extractBareJsonCalls(text));

  return calls;
}


function stripXmlToolTags(text: string): string {
  if (!(/<([a-zA-Z_][a-zA-Z0-9_]*)\s*\/>/.test(text) || /<\/[a-zA-Z_][a-zA-Z0-9_]*>/.test(text)))
    return text;
  return text.replace(
    /<([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*)>([\s\S]*?)<\/\1>|<([a-zA-Z_][a-zA-Z0-9_]*)\s*\/>/g,
    (full, openName: string | undefined, _inner, selfName: string | undefined) => {
      const name = String(openName ?? selfName ?? "").toLowerCase();
      return isToolName(name) || name.startsWith("mcp") ? "" : full;
    }
  );
}


export function stripToolCalls(text: string): string {
  const stripped = text
    // An empty code fence means the model emitted a blank call — never show
    // it (it renders as a stray "json / Copy" block in the chat).
    .replace(/```(?:json|tool_calls?|tool)?\s*```/gi, "")
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
    .replace(/<tool_call>[^<]*$/i, "")
    .replace(/<function_call>[\s\S]*?<\/function_call>/gi, "")
    .replace(/<function_call>\s*$/i, "")
    .replace(/<function=[^>]+>[\s\S]*?<\/function>/gi, "")
    .replace(/<function=[^<]*$/i, "")
    .replace(/<invoke[\s\S]*?<\/invoke>/gi, "")
    .replace(/<invoke[^<]*$/i, "");
  return stripTrailingPartialJson(stripBareJsonCalls(stripXmlToolTags(stripped))).trim();
}


export function stabilizeStreamingMarkdown(text: string): string {
  const fenceCount = (text.match(/```/g) ?? []).length;
  if (fenceCount % 2 === 1) return `${text}
\`\`\``;
  return text;
}

/** Build a `<tool_result>` block to feed back to the model. */
export function formatToolResult(result: ToolResult): string {
  const status = result.ok ? "success" : "error";
  return `<tool_result status="${status}">\n${result.output}\n</tool_result>`;
}

/** Human-readable label for each tool. */
export const TOOL_LABELS: Record<ToolName, string> = {
  get_open_files: "List open tabs",
  read_active_file: "Read active file",
  read_file: "Read file",
  read_file_range: "Read file range",
  write_file: "Write file",
  append_file: "Append to file",
  replace_in_file: "Replace in file",
  edit_file_lines: "Edit line range",
  delete_file: "Delete file",
  delete_dir: "Delete folder",
  create_dir: "Create folder",
  list_dir: "List folder",
  search_files: "Search files",
  rename: "Rename / move",
  copy_file: "Copy file",
  file_info: "File info",
  run_command: "Run command",
  git_status: "Git status",
  git_diff: "Git diff",
  git_commit: "Git commit",
  web_search: "Web search",
  web_fetch: "Web fetch",
  http_request: "HTTP request",
  env_info: "Environment info",
  analyze_project_structure: "Analyze project",
};

/** Short description of each tool for the model's system prompt. */
export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  get_open_files: 'get_open_files() — list the files open in editor tabs and which is active.',
  read_active_file: 'read_active_file() — read the contents of the currently active editor file.',
  read_file: 'read_file(path) — read the full contents of a text file.',
  read_file_range: 'read_file_range(path, start_line, end_line) — read a line range (end_line=0 means to EOF).',
  write_file: 'write_file(path, content) — create or overwrite a file (creates parent folders).',
  append_file: 'append_file(path, content) — append text to a file, creating it if missing.',
  replace_in_file: 'replace_in_file(path, search, replace, all=false) — replace the first occurrence of search with replace, or every occurrence when all=true.',
  edit_file_lines: 'edit_file_lines(path, start_line, end_line, content) — replace a line range with new content (end_line=0 means to EOF).',
  delete_file: 'delete_file(path) — permanently delete a file.',
  delete_dir: 'delete_dir(path) — recursively delete a folder.',
  create_dir: 'create_dir(path) — create a folder (and parents).',
  list_dir: 'list_dir(path) — list files and folders in a directory.',
  search_files: 'search_files(path, pattern, content=false) — recursively search for pattern in file paths (or file contents when content=true).',
  rename: 'rename(path, new_path) — rename or move a file/folder.',
  copy_file: 'copy_file(path, new_path) — copy a file to a new location.',
  file_info: 'file_info(path) — get a path\'s size, type and last-modified time.',
  run_command: 'run_command(command, cwd?, timeout_secs=120) — run a shell command (npm test, cargo build, git status…) and capture its output. Timeout is 1-900s; use a long timeout for builds and test suites.',
  git_status: 'git_status() — show the workspace git branch and changed files.',
  git_diff: 'git_diff(staged=false) — show the current (or staged) diff.',
  git_commit: 'git_commit(message) — stage all workspace changes and commit with the message.',
  web_search: 'web_search(query) — search the web for real-time info or latest docs.',
  web_fetch: 'web_fetch(url) — fetch and extract text from a specific URL.',
  http_request: 'http_request(url, method?, headers?, body?) — call any HTTP API (REST, JSON) and return status + body.',
  env_info: 'env_info() — report OS/platform, locale, current local time and workspace root.',
  analyze_project_structure: 'analyze_project_structure() — deep scan of the workspace to map architecture.',
};

/** The protocol instructions injected into the system prompt. Kept short and
 * literal: small local models follow concrete examples far better than
 * abstract role-play, and they must never claim they lack web access. */
export const AGENTIC_PROMPT = `
You are Neo, a helpful AI assistant with REAL tool access. You CAN search the web, read files, and run commands — through tool calls. NEVER claim you lack internet or system access: if a tool below covers the request, USE it.

## AVAILABLE TOOLS
Web:
- \`web_search(query)\` — search the web for live info, news, docs, latest versions.
- \`web_fetch(url)\` — fetch and read a specific page. Only use URLs that web_search returned; NEVER guess URLs.
Files:
- \`list_dir(path)\`, \`read_file(path)\`, \`read_file_range(path, start_line, end_line)\`, \`write_file(path, content)\`, \`append_file(path, content)\`, \`replace_in_file(path, search, replace, all?)\`, \`edit_file_lines(path, start_line, end_line, content)\`, \`delete_file(path)\`, \`delete_dir(path)\`, \`create_dir(path)\`, \`rename(path, new_path)\`, \`copy_file(path, new_path)\`, \`file_info(path)\`, \`search_files(path, pattern)\`
- \`read_active_file()\`, \`get_open_files()\`
Web:
- \`http_request(url, method?, headers?, body?)\` — call any REST/JSON API directly.
Git (workspace):
- \`git_status()\`, \`git_diff(staged?)\`, \`git_commit(message)\`
System:
- \`run_command(command, cwd?, timeout_secs?)\`
- \`env_info()\`
- \`analyze_project_structure()\`

## HOW TO ACT (strict)
1. Only use tools when the user clearly asks for live/external info (news, "latest" anything, docs) or file/system work. Otherwise answer normally without mentioning or emitting tools.
2. Emit the block EXACTLY like this (no code fences, no surrounding prose if possible):
<tool_call>
{"name": "web_search", "arguments": {"query": "Nepal floods latest news"}}
</tool_call>
3. The system replies with a <tool_result> block. Then answer the user using those results, citing URLs you actually received.
4. NEVER emit an empty code block. NEVER describe a call ("here is the JSON that would...") instead of emitting it — descriptions do nothing and no tool will run.
5. NEVER invent URLs. NEVER retry a failed call unchanged — rephrase the arguments or try a different tool/target.

## AUTONOMY & HORIZON (big tasks)
1. Work multi-step tasks END TO END in one turn. Do not stop halfway to ask for confirmation — the user already approved the goal.
2. Plan silently, then execute step by step until the task is fully complete. Do not stop after the first file or first fix when more are obviously needed.
3. Batch independent read-only tool calls in a single reply when possible — fewer round trips, faster completion.
4. After code changes, VERIFY your work: run the project's build / typecheck / tests via \`run_command\` with a generous \`timeout_secs\`, and fix whatever fails.
5. If you receive a "Checkpoint" message, that is the system EXTENDING your budget — keep working autonomously; do not switch to summarizing.
6. Only finish when the task is complete or you are genuinely blocked; then write a concise summary of what changed and what the user should verify.
`.trim();

/** Generate a unique activity id. */
export function activityId(): string {
  return `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
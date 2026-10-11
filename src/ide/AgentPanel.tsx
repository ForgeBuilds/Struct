/*
 * Author: madhusudhan
 * Check the LICENSE in the GitHub repo (https://github.com/Lumorix-studios/Struct) for more information on permissions to use this code.
 */
//main agent panel interface for the IDE window specifically
import { memo, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import Markdown from "../components/Markdown";
import AgenticActivity from "../components/AgenticActivity";
import type { EditorTab } from "../components/CodeEditor";
import type { AISettings, Message } from "../types";
import StarBorder from "../../components/StarBorder";
import {
  getProviderSpec,
  buildAuthHeaders,
  markNoNativeTools,
  outputTokensForEffort,
} from "../providers";
import type { ProviderSpec } from "../providers";
import ThinkingIndicator from "../../components/ThinkingIndicator";
import PromptBar from "../../components/PromptBar";
import {
  activityId,
  executeTool,
  formatToolResult,
  ingestNativeChunk,
  isDestructive,
  isToolName,
  nativeAccToCalls,
  parseToolCalls,
  resolveFsPath,
  stabilizeStreamingMarkdown,
  stripToolCalls,
  agenticSystemPrompt,
} from "../agentic";
import type { AgenticActivity as AgenticActivityType } from "../agentic";
import type { NativeToolAcc, ToolCall } from "../agentic";
import { computeLineDiff } from "../diff";
import { checkRateLimit, estimateTokens, recordUsage } from "../tokenUsage";
import BlurText from "../../components/BlurText";
import {
  buildAttachmentContext,
  expandCommand,
  pickFiles,
  pickFolder,
} from "../lib/attachments";
import {
  loadMcpServers,
  listMcpTools,
  callMcpTool,
  formatMcpToolSchema,
  type McpToolEntry,
} from "../mcp";
import { IoAdd, IoApps, IoClose, IoFolderOutline, IoTrashOutline } from "react-icons/io5";
import { useTranslation } from "../i18n";

type JsonDict = Record<string, unknown>;

/** Newline character (avoids escape-sequence issues in generated code). */
const NL = String.fromCharCode(10);

/** Tool-execution budget per user request (plain-prose rounds are free).
 * When the cap is reached mid-task, the run is granted a fresh budget
 * ("checkpoint") up to MAX_CHECKPOINTS times as long as it keeps making
 * progress — long tasks continue instead of dead-ending. */
const MAX_TOOL_ROUNDS = 50;
const MAX_TOOL_OUTPUT = 36000;
const MAX_CHECKPOINTS = 3;

function truncateToolOutput(output: string): string {
  if (output.length <= MAX_TOOL_OUTPUT) return output;
  const head = Math.floor(MAX_TOOL_OUTPUT * 0.6);
  const tail = MAX_TOOL_OUTPUT - head;
  const omitted = output.length - head - tail;
  return (
    output.slice(0, head) +
    `${NL}[... output truncated — ${omitted} characters omitted ...]${NL}` +
    output.slice(output.length - tail)
  );
}

async function platformFetch(url: string, init: RequestInit): Promise<Response> {
  const win = window as unknown as { __TAURI_INTERNALS__?: unknown };
  if (win.__TAURI_INTERNALS__) {
    try {
      const parsed = new URL(url);
      if (
        (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") &&
        parsed.port === "11434"
      ) {
        const native = await invoke<{ status: number; body: string }>("ollama_request", {
          url,
          method: init.method ?? "GET",
          body: typeof init.body === "string" ? init.body : null,
        });
        return new Response(native.body, {
          status: native.status,
          headers: { "Content-Type": "application/json" },
        });
      }
      return await tauriFetch(url, init);
    } catch (e) {
      throw new Error(
        `Tauri HTTP request failed: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e }
      );
    }
  }
  return fetch(url, init);
}

/** Merge consecutive same-role messages and drop empty assistant bubbles. */
function sanitizeHistory(msgs: Message[]): Message[] {
  const out: Message[] = [];
  for (const m of msgs) {
    const hasNativeCalls = !!(m.toolCalls && m.toolCalls.length > 0);
    if (m.role === "assistant" && m.content.trim().length === 0 && !hasNativeCalls) continue;
    const last = out[out.length - 1];
    if (
      last &&
      last.role === m.role &&
      !(last.toolCalls && last.toolCalls.length > 0) &&
      !hasNativeCalls
    ) {
      last.content = `${last.content}\n${m.content}`.trim();
    } else {
      out.push({ ...m });
    }
  }
  return out;
}

interface AgentPanelProps {
  settings: AISettings;
  workspaceRoot: string | null;
  editorTabs: EditorTab[];
  activeEditorPath: string | null;
  /** Notifies the parent so the status bar can show a live indicator. */
  onBusyChange?: (busy: boolean) => void;
  onClose: () => void;
  onOpenFile: (path: string) => void;
  onOpenSettings: () => void;
  /** Nudges the explorer to re-scan after the agent mutated the filesystem. */
  onFilesChanged: () => void;
}

// Memoized: the IDE parent re-renders on every keystroke because the tab array
// is its state, and this panel is ~1.5k lines. It reads `editorTabs` only through
// `tabsRef` inside async handlers, so a change to tab *contents* cannot change
// its output — the comparator below ignores it (and the ref still sees the fresh
// value, since the effect that syncs it runs on every parent render).
export default memo(function AgentPanel({
  settings,
  workspaceRoot,
  editorTabs,
  activeEditorPath,
  onBusyChange,
  onClose,
  onOpenFile,
  onOpenSettings,
  onFilesChanged,
}: AgentPanelProps) {
  const { t } = useTranslation();
  const spec: ProviderSpec = getProviderSpec(settings);
  const configured = !spec.needsAuth || !!settings.apiKey.trim();

  // --- chat state ----------------------------------------------------------
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const effortTokensRef = useRef(outputTokensForEffort("Medium"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activities, setActivities] = useState<AgenticActivityType[]>([]);
  const [pendingApproval, setPendingApproval] = useState<AgenticActivityType | null>(null);
  /** chat = plain Q&A · agent = tool-using · orchestrator = plan → execute steps. */
  const [mode, setMode] = useState<"chat" | "agent" | "orchestrator">("agent");
  /** Orchestrator plan steps with live status. */
  const [plan, setPlan] = useState<
    Array<{ title: string; detail: string; status: "pending" | "running" | "done" | "error" }>
  | null>(null);
  const [mcpServerCount, setMcpServerCount] = useState(
    () => loadMcpServers().filter((s) => s.enabled).length
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<AbortController | null>(null);
  const approvalRef = useRef<{ id: string; resolve: (ok: boolean) => void } | null>(null);
  const streamedRef = useRef("");
  const streamPaintRef = useRef<{ pending: string; frame: number | null }>({
    pending: "",
    frame: null,
  });

  // Live mirrors of props for the async agent loop (no stale closures).
  const tabsRef = useRef(editorTabs);
  const activeRef = useRef(activeEditorPath);
  const rootRef = useRef(workspaceRoot);
  const settingsRef = useRef(settings);
  const messagesRef = useRef<Message[]>([]);
  useEffect(() => {
    tabsRef.current = editorTabs;
    activeRef.current = activeEditorPath;
    rootRef.current = workspaceRoot;
    settingsRef.current = settings;
    messagesRef.current = messages;
  });

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  // Pick up MCP server changes made in Settings (cheap localStorage read).
  useEffect(() => {
    const id = window.setInterval(() => {
      setMcpServerCount(loadMcpServers().filter((s) => s.enabled).length);
    }, 15000);
    return () => window.clearInterval(id);
  }, []);

  // Keep the feed pinned to the newest content.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, activities, pendingApproval, busy]);

  // Abort any in-flight request when the panel unmounts.
  useEffect(
    () => () => {
      streamRef.current?.abort();
      if (streamPaintRef.current.frame !== null) {
        window.cancelAnimationFrame(streamPaintRef.current.frame);
      }
    },
    []
  );

  /** Overwrite the trailing assistant bubble (used while streaming). */
  const setLastAssistant = (content: string) => {
    streamedRef.current = content;
    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === "assistant") {
          next[i] = { ...next[i], content };
          return next;
        }
      }
      next.push({ role: "assistant", content });
      return next;
    });
  };

  const removeEmptyAssistant = () => {
    setMessages((prev) => {
      const next = [...prev];
      while (
        next.length > 0 &&
        next[next.length - 1].role === "assistant" &&
        !next[next.length - 1].content.trim()
      ) {
        next.pop();
      }
      return next;
    });
  };

  const requestApproval = (id: string): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      approvalRef.current?.resolve(false); // resolve any stale dialog
      approvalRef.current = { id, resolve };
    });

  const handleApprove = (id: string) => {
    setActivities((prev) => prev.map((a) => (a.id === id ? { ...a, status: "approved" } : a)));
    approvalRef.current?.resolve(true);
    approvalRef.current = null;
  };

  const handleDeny = () => {
    approvalRef.current?.resolve(false);
    approvalRef.current = null;
  };

  /**
   * One streaming round against the provider. Returns the visible text plus
   * any native tool calls accumulated from SSE chunks (all providers).
   */
  const streamRound = async (
    history: Message[],
    systemPrompt: string,
    signal: AbortSignal,
    enableTools = true,
    mcpTools?: Map<string, McpToolEntry>
  ): Promise<{ text: string; nativeCalls: ToolCall[] }> => {
    const s = getProviderSpec(settingsRef.current);
    const endpoint = s.buildUrl(settingsRef.current);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...buildAuthHeaders(s, settingsRef.current.apiKey),
    };
    const effective: AISettings = { ...settingsRef.current, systemPrompt };
    const additionalTools = mcpTools
      ? [...mcpTools.entries()].map(([name, tool]) => ({
          name,
          description: tool.description ?? `MCP tool ${tool.tool}`,
          parameters:
            tool.schema && typeof tool.schema === "object"
              ? tool.schema
              : { type: "object", properties: {}, required: [] },
        }))
      : undefined;
    const body = s.buildBody(effective, history, {
      enableTools,
      additionalTools,
      maxOutputTokens: effortTokensRef.current,
    });

    // Token budget guard — pause the agent before spending when a configured
    // limit (Settings → Dashboard) would be exceeded by this request.
    const limitErr = checkRateLimit(estimateTokens(JSON.stringify(body)));
    if (limitErr) throw new Error(limitErr);

    let res: Response;
    try {
      res = await platformFetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (netErr) {
      if (signal.aborted) throw new Error("__ABORTED__", { cause: netErr });
      throw new Error(
        `Could not connect to ${endpoint}: ${
          netErr instanceof Error ? netErr.message : String(netErr)
        }`,
        { cause: netErr }
      );
    }
    if (signal.aborted) throw new Error("__ABORTED__");

    if (!res.ok) {
      let detail = `HTTP ${res.status} ${res.statusText}`;
      try {
        const text = await res.text();
        const trimmed = (text || "").trim();
        if (trimmed.startsWith("<") || trimmed.toLowerCase().includes("<!doctype")) {
          detail =
            "The server returned an HTML page (not an API response). Check that the base URL points to a valid AI API endpoint.";
        } else if (trimmed) {
          try {
            const parsed = JSON.parse(trimmed) as JsonDict;
            const errMsg = parsed?.error as JsonDict | undefined;
            detail = (errMsg?.message as string) || (parsed?.message as string) || trimmed;
          } catch {
            detail = trimmed.length > 400 ? trimmed.slice(0, 400) + "…" : trimmed;
          }
        }
      } catch {
        /* keep the status-based detail */
      }
      // Self-healing retry: local models that reject native tools outright
      // (Ollama: "<model> does not support tools"). Remember the model for
      // this session — buildBody omits `tools` from now on — and retry once
      // without native tools; the agent loop still runs on the text-based
      // tool protocol (parseToolCalls).
      if (res.status === 400 && /does not support tools/i.test(detail)) {
        markNoNativeTools(effective);
        try {
          const retryRes = await platformFetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify(
              s.buildBody(effective, history, {
                enableTools: false,
                additionalTools,
                maxOutputTokens: effortTokensRef.current,
              })
            ),
            signal,
          });
          if (retryRes.ok) res = retryRes;
        } catch {
          if (signal.aborted) throw new Error("__ABORTED__");
          /* fall through to the original error below */
        }
      }
      if (!res.ok) {
        let msg = `API error (${res.status}): ${detail}`;
        if (res.status === 401 || res.status === 403) {
          msg += ` ${s.authErrorHint(res.status, settingsRef.current)}`;
        }
        throw new Error(msg);
      }
    }

    const nativeAcc: NativeToolAcc[] = [];
    let round = "";
    let usageIn = 0;
    let usageOut = 0;
    let sawUsage = false;
    const show = (text: string) => {
      // The network remains token-streamed, but painting once per animation
      // frame prevents Markdown and the entire message list from rerendering
      // for every token.
      const state = streamPaintRef.current;
      state.pending = stabilizeStreamingMarkdown(stripToolCalls(text));
      if (state.frame !== null) return;
      state.frame = window.requestAnimationFrame(() => {
        state.frame = null;
        setLastAssistant(state.pending);
      });
    };
    const showFinal = (text: string) => {
      const state = streamPaintRef.current;
      if (state.frame !== null) {
        window.cancelAnimationFrame(state.frame);
        state.frame = null;
      }
      state.pending = stabilizeStreamingMarkdown(stripToolCalls(text));
      setLastAssistant(state.pending);
    };

    const processStreamLine = (rawLine: string) => {
      let line = rawLine.trim();
      if (!line || line.startsWith(":")) return;
      if (line.startsWith("data:")) line = line.slice(5).trim();
      if (!line || line === "[DONE]") return;
      try {
        const json = JSON.parse(line) as JsonDict;
        ingestNativeChunk(json, nativeAcc);
        const u = s.extractUsage?.(json);
        if (u && (u.input != null || u.output != null)) {
          // Counters are cumulative across chunks — keep the latest reading
          // rather than summing (summing multiplies the true total).
          if (u.input != null) usageIn = u.input;
          if (u.output != null) usageOut = u.output;
          sawUsage = true;
        }
        const delta = s.extractDelta(json);
        if (delta) {
          round += delta;
          show(round);
        }
      } catch {
        // A partial line remains buffered until the next read.
      }
    };

    const bodyStream = res.body;
    if (!bodyStream) {
      const data = (await res.json().catch(() => null)) as JsonDict | null;
      if (data) {
        ingestNativeChunk(data, nativeAcc);
        round = s.extractContent(data);
        const u = s.extractUsage?.(data);
        void recordUsage(
          settingsRef.current.provider,
          settingsRef.current.model,
          u?.input ?? estimateTokens(JSON.stringify(body)),
          u?.output ?? estimateTokens(round)
        );
        if (round) show(round);
      }
      return { text: round, nativeCalls: nativeAccToCalls(nativeAcc) };
    }

    const reader = bodyStream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const step = await reader.read();
        if (step.done) break;
        if (signal.aborted) throw new Error("__ABORTED__");
        buffer += decoder.decode(step.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) processStreamLine(line);
      }
      buffer += decoder.decode();
      // Fetch implementations are allowed to end without a trailing newline.
      // Processing this remainder is essential for the final text/tool-call
      // chunk, especially with local Ollama-compatible servers.
      if (buffer.trim()) processStreamLine(buffer);
      if (round) showFinal(round);
    } finally {
      reader.releaseLock();
    }

    // No streamed output at all → try a plain (non-stream) request once.
    if (!round && nativeAcc.length === 0 && !signal.aborted) {
      try {
        const nonStreamBody = {
          ...(s.buildBody(effective, history, {
            enableTools,
            additionalTools,
            maxOutputTokens: effortTokensRef.current,
          }) as JsonDict),
          stream: false,
        } as JsonDict;
        const nonStreamUrl = endpoint.includes("streamGenerateContent")
          ? endpoint.replace("streamGenerateContent", "generateContent")
          : endpoint;
        const fallbackRes = await platformFetch(nonStreamUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(nonStreamBody),
          signal,
        });
        if (fallbackRes.ok) {
          const data = (await fallbackRes.json().catch(() => null)) as JsonDict | null;
          if (data) {
            round = s.extractContent(data);
            ingestNativeChunk(data, nativeAcc);
            const u = s.extractUsage?.(data);
            if (u && (u.input != null || u.output != null)) {
              usageIn = u.input ?? 0;
              usageOut = u.output ?? 0;
              sawUsage = true;
            }
            if (round) showFinal(round);
          }
        } else {
          const fallbackDetail = (await fallbackRes.text().catch(() => "")).trim();
          throw new Error(
            `NVIDIA NIM returned no streamed content (${fallbackRes.status})${
              fallbackDetail ? `: ${fallbackDetail.slice(0, 300)}` : "."
            }`
          );
        }
      } catch (fallbackError) {
        if (signal.aborted) throw new Error("__ABORTED__");
        if (fallbackError instanceof Error && fallbackError.message.startsWith("NVIDIA NIM")) {
          throw fallbackError;
        }
      }
    }

    if (!signal.aborted) {
      void recordUsage(
        settingsRef.current.provider,
        settingsRef.current.model,
        sawUsage && usageIn > 0 ? usageIn : estimateTokens(JSON.stringify(body)),
        sawUsage && usageOut > 0 ? usageOut : estimateTokens(round)
      );
    }
    return { text: round, nativeCalls: nativeAccToCalls(nativeAcc) };
  };

  /** Fail fast if the provider isn't configured. */
  const ensureProviderReady = (): boolean => {
    const s = getProviderSpec(settingsRef.current);
    if (s.needsAuth && !settingsRef.current.apiKey.trim()) {
      setError(`Configure your ${s.label} API key in AI Settings to use the agent.`);
      onOpenSettings();
      return false;
    }
    if (!settingsRef.current.baseUrl.trim()) {
      setError("Base URL is empty. Configure it in AI Settings.");
      onOpenSettings();
      return false;
    }
    return true;
  };

  /** Orchestrator: how the planner must shape its reply. */
  const ORCHESTRATOR_PLANNER_PROMPT = `You are the ORCHESTRATOR of a coding agent team. Break the user's goal into concrete, independently executable steps (at most 6).

Respond with ONLY a JSON array — no prose, no code fences, no examples:
[{"title": "Short step title", "detail": "Precise instruction for the coding agent, including file paths where relevant"}]

Rules:
- Every step must be verifiable on its own.
- Later steps may build on earlier ones.
- Order steps so each has everything it needs when it starts.`;

  /** Parse the planner's JSON array of steps out of its reply. */
  const parsePlan = (text: string): { title: string; detail: string }[] | null => {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end <= start) return null;
    try {
      const arr = JSON.parse(text.slice(start, end + 1)) as unknown;
      if (!Array.isArray(arr)) return null;
      const steps = (arr as Record<string, unknown>[])
        .filter((s) => typeof s?.title === "string" && (s.title as string).trim().length > 0)
        .slice(0, 12)
        .map((s) => ({ title: String(s.title), detail: String(s.detail ?? "") }));
      return steps.length > 0 ? steps : null;
    } catch {
      return null;
    }
  };

  /** Collect MCP tools from all enabled servers (offline servers are skipped). */
  const collectMcpTools = async (): Promise<Map<string, McpToolEntry>> => {
    const map = new Map<string, McpToolEntry>();
    const servers = loadMcpServers().filter((s) => s.enabled);
    await Promise.all(
      servers.map(async (s) => {
        try {
          for (const t of await listMcpTools(s)) {
            map.set(`mcp_${s.name}_${t.name}`, {
              server: s,
              tool: t.name,
              description: t.description,
              schema: t.inputSchema,
              readOnly: t.readOnly,
            });
          }
        } catch (e) {
          // Keep the failure in the prompt so the model does not repeatedly
          // invent or retry tools from an unavailable server.
          map.set(`mcp_${s.name}__error`, {
            server: s,
            tool: `__error: ${e instanceof Error ? e.message : String(e)}`,
            schema: undefined,
          });
        }
      })
    );
    return map;
  };

  /** Agentic system prompt: workspace + editor snapshot + MCP tool roster. */
  const buildAgentPrompt = async (): Promise<{
    systemPrompt: string;
    userFileNote: string;
    mcpTools: Map<string, McpToolEntry>;
  }> => {
    const root = rootRef.current;
    const openTabs = tabsRef.current;
    const active = activeRef.current;
    const rel = (p: string): string =>
      root && p.startsWith(root) ? p.slice(root.length).replace(/^[\\/]+/, "") : p;
    const editor = {
      openPaths: openTabs.map((t) => t.path),
      activePath: active,
      getTabContent: (p: string) => openTabs.find((t) => t.path === p)?.content ?? null,
    };
    let systemPrompt = agenticSystemPrompt(root, editor);
    let userFileNote = "";
    if (active) {
      const activeTab = openTabs.find((t) => t.path === active) ?? null;
      if (activeTab) {
        const i = Math.max(active.lastIndexOf("\\"), active.lastIndexOf("/"));
        const dir = i > 0 ? active.slice(0, i) : active;
        const MAX_INLINE = 8000;
        const bodyText =
          activeTab.content.length <= MAX_INLINE
            ? activeTab.content
            : `${activeTab.content.slice(0, MAX_INLINE)}\n...[truncated - call read_active_file or read_file for more]`;
        systemPrompt += `\n\nCurrent contents of ${rel(active)} (folder: ${dir}):\n${bodyText}\n(end of ${rel(active)})`;
        userFileNote = `(Working file: ${rel(active)} — its complete source is already in your system context above. Start analyzing it immediately; do not ask for it.)`;
      }
    } else if (!root) {
      systemPrompt += "\n\nNo folder is open and no file is active in the IDE.";
    }
    const mcpTools = await collectMcpTools();
    const mcpErrors = [...mcpTools.entries()].filter(([, m]) => m.tool.startsWith("__error:"));
    const availableMcpTools = [...mcpTools.entries()].filter(([, m]) => !m.tool.startsWith("__error:"));
    if (availableMcpTools.length > 0) {
      systemPrompt += `\n\nMCP tools available (invoke via tool-call markup using the FULL name). Parameters marked (required) MUST be included or the call fails:\n${[
        ...availableMcpTools,
      ]
        .map(([k, m]) => {
          const sig = formatMcpToolSchema(m.schema);
          return sig ? `- ${k}\n  ${sig}` : `- ${k}`;
        })
        .join(NL)}\n\nMCP call rules:\n- If a call fails naming a missing argument (e.g. "datamodel_type is required", "studio_id is required"), re-call WITH that argument included.\n- Tools needing id-style arguments (e.g. studio_id) get them from a discovery tool on the same server (e.g. list_roblox_studios) — call that first, then pass the id on every later call to that server.\n- Batch independent calls together in one round (e.g. discovery + reads) to save round trips.`;
    }
    if (mcpErrors.length > 0) {
      systemPrompt += `\n\nMCP servers currently unavailable:\n${mcpErrors
        .map(([, m]) => `- ${m.server.name}: ${m.tool.slice("__error: ".length)}`)
        .join("\n")}`;
    }
    return { systemPrompt, userFileNote, mcpTools };
  };

  
  const runLoop = async (
    agentHistory: Message[],
    systemPrompt: string,
    mcpTools: Map<string, McpToolEntry>,
    abortCtrl: AbortController
  ): Promise<number> => {
    let ranTools = 0;
    let toolRounds = 0;
    let nudgeCount = 0;
    let failStreak = 0;
    let lastFailSig = "";
    // Per-tool failure accounting: a tool is benched after too many
    // cumulative failures, but any success resets its count — one broken
    // tool must not end the whole run.
    const toolFailCounts = new Map<string, number>();
    const TOOL_FAIL_LIMIT = 8;
    const BANNED_TOOL_CALL_LIMIT = 3;
    const bannedTools = new Set<string>();
    let bannedToolCalls = 0;
    let totalFails = 0;
    let totalSuccesses = 0;
    // Budget checkpoints: each checkpoint refills the round budget so long
    // tasks never dead-end mid-run while they keep making progress.
    let checkpointsUsed = 0;
    let lastCheckpointSuccesses = 0;
    let totalRounds = 0;
    // Per-turn cache of read-only results; cleared whenever a mutation runs.
    const readOnlyCache = new Map<string, { ok: boolean; output: string }>();
    const FILE_MUTATORS = new Set(["write_file", "append_file", "replace_in_file"]);

      while (!abortCtrl.signal.aborted) {
        const round = await streamRound(
          agentHistory,
          systemPrompt,
          abortCtrl.signal,
          true,
          mcpTools
        );
        if (abortCtrl.signal.aborted) break;
        const raw = round.text;

        agentHistory.push({
          role: "assistant",
          content: raw,
          ...(round.nativeCalls.length > 0
            ? {
                toolCalls: round.nativeCalls.map((c, i) => ({
                  id: c.id ?? `call_${toolRounds}_${i}`,
                  name: c.name,
                  arguments: c.arguments,
                  thoughtSignature: c.thoughtSignature,
                })),
              }
            : {}),
        });

        // Collect native + text-markup tool calls, de-duplicated.
        const calls: { call: ToolCall; native: boolean; key: string }[] = [];
        const seenKeys = new Set<string>();
        for (const { call, native } of [
          ...round.nativeCalls.map((c) => ({ call: c, native: true })),
          ...parseToolCalls(raw).map((c) => ({ call: c, native: false })),
        ]) {
          if (!isToolName(call.name) && !call.name.startsWith("mcp_")) continue;
          const key = `${call.name}:${JSON.stringify(call.arguments)}`;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          calls.push({ call, native, key });
        }

        // No tool calls → the agent is done talking.
        if (calls.length === 0) {
          // Recovery: weak models often DESCRIBE a call without emitting one.
          if (
            nudgeCount < 2 &&
            /(\b(function call|tool call|tool_call|read_file|list_dir|search_files)\b|<[a-z_]+\s*\/?>|\b\w+_\w+\(\)|(?:can'?t|cannot|unable to|don't have|do not have).{0,30}\b(access|use|call).{0,20}\btools?\b)/i.test(
              raw
            )
          ) {
            nudgeCount++;
            agentHistory.push({
              role: "user",
              content:
                'You claimed or described tool access but did not actually emit a call. You have real tools. Reply with EXACTLY ONE real tool-call block as your entire message:\n<tool_call>\n{"name": "get_open_files", "arguments": {}}\n</tool_call>\nNo prose, no code fences, no capability disclaimers.',
            });
            continue;
          }
          break;
        }

        if (toolRounds >= MAX_TOOL_ROUNDS) {
          if (checkpointsUsed < MAX_CHECKPOINTS && totalSuccesses > lastCheckpointSuccesses) {
            // Still making progress — grant a fresh budget and keep working
            // instead of dead-ending mid-task.
            checkpointsUsed++;
            lastCheckpointSuccesses = totalSuccesses;
            toolRounds = 0;
            agentHistory.push({
              role: "user",
              content: `Checkpoint: you have used ${totalRounds} tool rounds. Your tool budget has been EXTENDED — keep working autonomously until the task is fully complete. Do not stop to summarize or ask for confirmation. If the task is already done, write the final summary now.`,
            });
            continue;
          }
          setError(
            "The agent used all of its tool turns for this request. Send a follow-up message to continue where it left off."
          );
          break;
        }
        toolRounds++;
        totalRounds++;

        // Plan the activity rows for this round.
        const activityIds = new Map<string, string>();
        const planned: AgenticActivityType[] = calls.map(({ call }) => {
          const id = activityId();
          activityIds.set(`${call.name}:${JSON.stringify(call.arguments)}`, id);
          return { id, tool: call.name, args: call.arguments, status: "pending" };
        });
        setActivities((prev) => [...prev, ...planned]);

        const patchActivity = (id: string, patch: Partial<AgenticActivityType>) =>
          setActivities((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));

        const resultsByKey = new Map<string, { ok: boolean; output: string }>();
        const effRoot = rootRef.current;

        const isMcp = (name: string) => name.startsWith("mcp_");

        /** Execute one call — built-in filesystem/command tools or MCP tools. */
        const runToolCall = async (call: ToolCall) => {
          // A benched tool is short-circuited: the model is told to move on
          // instead of hammering it.
          if (bannedTools.has(call.name)) {
            bannedToolCalls++;
            return {
              ok: false,
              output: `Tool "${call.name}" is disabled for the rest of this turn after repeated failures. Use a different tool, or answer from what you already have.`,
            };
          }
          if (isMcp(call.name)) {
            const entry = mcpTools.get(call.name);
            if (!entry)
              return {
                ok: false,
                output: `Unknown MCP tool: ${call.name}. Available MCP tools: ${
                  [...mcpTools.keys()].join(", ") || "(none)"
                }`,
              };
            return callMcpTool(entry.server, entry.tool, call.arguments);
          }
          return executeTool(call.name, call.arguments, effRoot, {
            openPaths: tabsRef.current.map((t) => t.path),
            activePath: activeRef.current,
            getTabContent: (p) => tabsRef.current.find((t) => t.path === p)?.content ?? null,
          });
        };

        // --- Read-only batch (parallel, cache-aware). MCP tools the server
        // declares read-only (readOnlyHint) join this batch too; unknown MCP
        // tools stay in the sequential/approval batch to be safe. -----------
        const readOnly = calls.filter(({ call }) => {
          if (isDestructive(call.name)) return false;
          if (!isMcp(call.name)) return true;
          return mcpTools.get(call.name)?.readOnly === true;
        });
        readOnly.forEach(({ key }) => {
          if (readOnlyCache.has(key)) return; // cached — no spinner needed
          const id = activityIds.get(key);
          if (id) patchActivity(id, { status: "running" });
        });
        await Promise.all(
          readOnly.map(async ({ call, key }) => {
            const cached = readOnlyCache.get(key);
            const result = cached ?? (await runToolCall(call));
            if (!cached) readOnlyCache.set(key, result);
            resultsByKey.set(key, result);
            ranTools++;
            const id = activityIds.get(key);
            if (id) {
              patchActivity(
                id,
                result.ok
                  ? { status: "done", output: result.output.slice(0, 4000) }
                  : { status: "error", error: result.output.slice(0, 2000) }
              );
            }
          })
        );

        // --- Mutating batch (sequential, each behind user approval). ---------
        const mutating = calls.filter(
          ({ call }) =>
            isDestructive(call.name) ||
            (isMcp(call.name) && mcpTools.get(call.name)?.readOnly !== true)
        );
        for (const { call, key } of mutating) {
          const id = activityIds.get(key);
          if (!id) continue;

          // Snapshot the file before the change so we can render a diff.
          let beforeContent: string | null = null;
          let targetPath = "";
          if (FILE_MUTATORS.has(call.name) && typeof call.arguments.path === "string") {
            targetPath = call.arguments.path;
            try {
              beforeContent = await invoke<string>("fs_read_file", {
                path: resolveFsPath(targetPath, effRoot),
              });
            } catch {
              beforeContent = null; // new file
            }
          }

          let approved = settingsRef.current.autoApproveTools === true;
          if (!approved) {
            setPendingApproval({ id, tool: call.name, args: call.arguments, status: "pending" });
            approved = await requestApproval(id);
            setPendingApproval(null);
          }
          if (abortCtrl.signal.aborted) break;
          if (!approved) {
            patchActivity(id, { status: "denied" });
            resultsByKey.set(key, {
              ok: false,
              output:
                "User denied approval for this operation. Do not retry it; explain and propose alternatives.",
            });
            continue;
          }

          const startedAt = Date.now();
          patchActivity(id, { status: "running", startedAt });
          // A mutation invalidates every cached read-only result.
          readOnlyCache.clear();
          const result = await runToolCall(call);
          resultsByKey.set(key, result);
          if (result.ok) ranTools++;
          patchActivity(
            id,
            result.ok
              ? {
                  status: "done",
                  output: result.output.slice(0, 4000),
                  durationMs: Date.now() - startedAt,
                }
              : {
                  status: "error",
                  error: result.output.slice(0, 2000),
                  durationMs: Date.now() - startedAt,
                }
          );

          // Reflect mutations in the editor, show a diff, open the file.
          if (result.ok) {
            onFilesChanged();
            if (FILE_MUTATORS.has(call.name) && targetPath) {
              const absPath = resolveFsPath(targetPath, effRoot);
              let afterContent: string;
              try {
                afterContent = await invoke<string>("fs_read_file", { path: absPath });
              } catch {
                afterContent = "";
              }
              patchActivity(id, { diff: computeLineDiff(beforeContent ?? "", afterContent) });
              onOpenFile(absPath);
            }
          }
        }

        // Runaway guard: identical failing calls across consecutive rounds.
        // A round with ANY success proves progress — reset the streak.
        const anySuccess = calls.some(({ key }) => resultsByKey.get(key)?.ok === true);
        const failSig = calls
          .filter(({ key }) => resultsByKey.get(key)?.ok === false)
          .map(({ call }) => `${call.name}:${JSON.stringify(call.arguments)}`)
          .sort()
          .join("|");
        if (failSig && failSig === lastFailSig && !anySuccess) {
          failStreak++;
          if (failStreak >= 4) {
            setError(
              "The same tool calls kept failing identically — stopping to avoid an endless loop. Try rephrasing the task or check that the files exist."
            );
            break;
          }
        } else {
          lastFailSig = failSig;
          failStreak = failSig ? 1 : 0;
        }

        // Per-tool failure accounting. Success resets a tool's strike count;
        // reaching the limit only benches THAT tool — the turn continues with
        // everything else. Hard stop only if the model keeps hammering benched
        // tools, or nothing succeeds despite many failures.
        for (const [key, r] of resultsByKey) {
          const tool = key.slice(0, key.indexOf(":"));
          if (r.ok) {
            totalSuccesses++;
            toolFailCounts.delete(tool);
          } else if (!bannedTools.has(tool)) {
            totalFails++;
            toolFailCounts.set(tool, (toolFailCounts.get(tool) ?? 0) + 1);
          }
        }
        for (const [tool, count] of toolFailCounts) {
          if (count >= TOOL_FAIL_LIMIT) bannedTools.add(tool);
        }
        if (bannedTools.size > 0) {
          agentHistory.push({
            role: "user",
            content: `Tools disabled for the rest of this turn after repeated failures: ${[
              ...bannedTools,
            ].join(", ")}. Do NOT call them again — use other tools, or summarize what you know and answer directly.`,
          });
        }
        if (
          bannedToolCalls >= BANNED_TOOL_CALL_LIMIT ||
          (totalFails >= 16 && totalSuccesses === 0)
        ) {
          setError(
            `Too many tool failures this turn (${totalFails} failed, ${totalSuccesses} succeeded${
              bannedTools.size > 0 ? `; disabled: ${[...bannedTools].join(", ")}` : ""
            }). Stopped to avoid an endless loop — try rephrasing or check the target system.`
          );
          break;
        }

        // Route results back in the original call order.
        const nativeResults: Message[] = [];
        const resultBlocks: string[] = [];
        for (const { call, native, key } of calls) {
          const result = resultsByKey.get(key);
          if (!result) continue;
          const output = truncateToolOutput(result.output);
          if (native) {
            nativeResults.push({
              role: "tool",
              content: output,
              toolCallId: call.id,
              toolName: call.name,
            });
          } else {
            resultBlocks.push(formatToolResult({ ...result, output }));
          }
        }
        if (nativeResults.length > 0) agentHistory.push(...nativeResults);
        if (resultBlocks.length > 0) {
          agentHistory.push({ role: "user", content: resultBlocks.join(NL + NL) });
        }
      }

      return ranTools;
  };

  /** One agentic run — chat (plain Q&A) or agent (full tool loop). */
  const runAgent = async (userText: string, runMode: "chat" | "agent" = "agent") => {
    if (!ensureProviderReady()) return;

    streamRef.current?.abort();
    setError(null);
    setActivities([]);
    setPlan(null);
    setInput("");
    setBusy(true);
    streamedRef.current = "";

    // Optimistically render the user message and a streaming assistant bubble.
    setMessages((prev) => [...prev, { role: "user", content: userText }]);
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    const abortCtrl = new AbortController();
    streamRef.current = abortCtrl;

    try {
      const agentHistory: Message[] = [
        // messagesRef.current is still the pre-turn snapshot here (the user +
        // assistant placeholders above have not rendered yet).
        ...sanitizeHistory(messagesRef.current),
        { role: "user", content: userText },
      ];

      if (runMode === "chat") {
        // Plain Q&A: no tools, no activity feed — one streamed round.
        await streamRound(agentHistory, settingsRef.current.systemPrompt, abortCtrl.signal, false);
        const finalText = streamedRef.current.trim();
        if (finalText) setLastAssistant(finalText);
        else if (!abortCtrl.signal.aborted) {
          setError(
            "The model returned an empty response. Check the model name and endpoint in AI Settings."
          );
          removeEmptyAssistant();
        }
        return;
      }

      const { systemPrompt, userFileNote, mcpTools } = await buildAgentPrompt();
      if (userFileNote) {
        const lastMsg = agentHistory[agentHistory.length - 1];
        if (lastMsg && lastMsg.role === "user") {
          lastMsg.content = `${lastMsg.content}\n\n${userFileNote}`;
        }
      }
      const ranTools = await runLoop(agentHistory, systemPrompt, mcpTools, abortCtrl);

      // Commit whatever visible text accumulated across all rounds.
      const finalVisible = streamedRef.current.trim();
      if (finalVisible) {
        setLastAssistant(finalVisible);
      } else if (ranTools > 0) {
        setLastAssistant(
          `Done — ${ranTools} file operation${ranTools === 1 ? "" : "s"} completed.`
        );
      } else if (!abortCtrl.signal.aborted) {
        setError(
          "The agent returned an empty response. Check the model name and endpoint in AI Settings."
        );
        removeEmptyAssistant();
      }
    } catch (err) {
      if (abortCtrl.signal.aborted || (err instanceof Error && err.message === "__ABORTED__")) {
        // User stopped the generation; keep partial output.
        const partial = stripToolCalls(streamedRef.current).trim();
        if (partial) setLastAssistant(partial);
        else removeEmptyAssistant();
      } else {
        setError(err instanceof Error ? err.message : "Failed to reach the AI provider.");
        removeEmptyAssistant();
      }
    } finally {
      setBusy(false);
      streamRef.current = null;
      approvalRef.current?.resolve(false);
      approvalRef.current = null;
      setPendingApproval(null);
    }
  };

  /**
   * Orchestrator mode: plan the goal into steps, execute each step as its own
   * tool-using run (each with fresh focus but shared conversation context),
   * then synthesize a final summary.
   */
  const runOrchestrator = async (userText: string) => {
    if (!ensureProviderReady()) return;

    streamRef.current?.abort();
    setError(null);
    setActivities([]);
    setPlan(null);
    setInput("");
    setBusy(true);
    streamedRef.current = "";

    setMessages((prev) => [...prev, { role: "user", content: userText }]);
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    const abortCtrl = new AbortController();
    streamRef.current = abortCtrl;

    try {
      const agentHistory: Message[] = [
        ...sanitizeHistory(messagesRef.current),
        { role: "user", content: userText },
      ];
      const { systemPrompt, userFileNote, mcpTools } = await buildAgentPrompt();
      if (userFileNote) {
        const lastMsg = agentHistory[agentHistory.length - 1];
        if (lastMsg && lastMsg.role === "user") {
          lastMsg.content = `${lastMsg.content}\n\n${userFileNote}`;
        }
      }

      // ── Phase 1 — plan ─────────────────────────────────────────────────────
      const planRound = await streamRound(
        agentHistory,
        `${systemPrompt}\n\n${ORCHESTRATOR_PLANNER_PROMPT}`,
        abortCtrl.signal,
        false
      );
      if (abortCtrl.signal.aborted) return;
      const steps = parsePlan(planRound.text);
      if (!steps) {
        setError(
          "The orchestrator could not produce a valid plan. Try phrasing the goal as a concrete task, or switch to Agent mode."
        );
        removeEmptyAssistant();
        return;
      }
      setPlan(steps.map((s) => ({ ...s, status: "pending" as const })));
      agentHistory.push({
        role: "assistant",
        content: `Plan:\n${steps.map((s, i) => `${i + 1}. ${s.title} — ${s.detail}`).join(NL)}`,
      });

      // ── Phase 2 — execute each step with its own tool loop ────────────────
      for (let i = 0; i < steps.length; i++) {
        if (abortCtrl.signal.aborted) break;
        setPlan((prev) =>
          prev ? prev.map((p, j) => (j === i ? { ...p, status: "running" } : p)) : prev
        );
        streamedRef.current = "";
        const stepMsg = `Execute step ${i + 1} of ${steps.length}: ${steps[i].title}.\n${
          steps[i].detail
        }\nWhen the step is complete, reply with a one-sentence summary of what changed.`;
        setMessages((prev) => [...prev, { role: "user", content: stepMsg }]);
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
        agentHistory.push({ role: "user", content: stepMsg });
        try {
          await runLoop(agentHistory, systemPrompt, mcpTools, abortCtrl);
          setPlan((prev) =>
            prev ? prev.map((p, j) => (j === i ? { ...p, status: "done" } : p)) : prev
          );
          const summary = streamedRef.current.trim();
          if (summary) agentHistory.push({ role: "assistant", content: summary });
        } catch (err) {
          if (abortCtrl.signal.aborted) break;
          setPlan((prev) =>
            prev ? prev.map((p, j) => (j === i ? { ...p, status: "error" } : p)) : prev
          );
          agentHistory.push({
            role: "user",
            content: `Step ${i + 1} failed: ${
              err instanceof Error ? err.message : String(err)
            }. Continue with the next step.`,
          });
        }
      }

      // ── Phase 3 — synthesis ────────────────────────────────────────────────
      if (!abortCtrl.signal.aborted) {
        streamedRef.current = "";
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
        agentHistory.push({
          role: "user",
          content:
            "All steps are finished. Write a concise final summary of what was accomplished, which files changed, and anything the user should verify.",
        });
        await streamRound(agentHistory, systemPrompt, abortCtrl.signal, false);
        const finalText = streamedRef.current.trim();
        if (finalText) setLastAssistant(finalText);
        else removeEmptyAssistant();
      }
    } catch (err) {
      if (abortCtrl.signal.aborted || (err instanceof Error && err.message === "__ABORTED__")) {
        const partial = stripToolCalls(streamedRef.current).trim();
        if (partial) setLastAssistant(partial);
        else removeEmptyAssistant();
      } else {
        setError(err instanceof Error ? err.message : "Failed to reach the AI provider.");
        removeEmptyAssistant();
      }
    } finally {
      setBusy(false);
      streamRef.current = null;
      approvalRef.current?.resolve(false);
      approvalRef.current = null;
      setPendingApproval(null);
    }
  };

  const stopAgent = () => {
    streamRef.current?.abort();
    approvalRef.current?.resolve(false);
  };

  const clearChat = () => {
    if (busy) return;
    setMessages([]);
    setActivities([]);
    setError(null);
  };

  const send = (text?: string) => {
    const trimmed = (text ?? input).trim();
    if (!trimmed || busy) return;
    if (mode === "orchestrator") void runOrchestrator(trimmed);
    else void runAgent(trimmed, mode === "chat" ? "chat" : "agent");
  };
  const handleAnimationComplete = () => {
    console.log('Animation completed!');
  };
  // Context-aware starter prompts for the empty state.
  const suggestions = workspaceRoot
    ? [
        {
          label: "Explain this project",
          prompt: "Explore this workspace and explain the project structure and what it does.",
        },
        {
          label: "Review the file",
          prompt:
            "Review the active file for bugs and edge cases, then apply the fixes you are confident about.",
        },
        {
          label: "Find TODOs",
          prompt:
            "Search this workspace for TODO and FIXME comments and summarize what still needs to be done.",
        },
        {
          label: "Add a README",
          prompt:
            "Create a README.md for this project describing its purpose, structure and how to run it.",
        },
      ]
    : [
        {
          label: "Plan a feature",
          prompt:
            "Help me plan a new feature: break it into files, modules and concrete implementation steps.",
        },
        {
          label: "Debug an error",
          prompt: "I have an error I can't figure out. Help me debug it step by step.",
        },
        {
          label: "Explain code",
          prompt: "Explain a piece of code I paste, line by line, in simple terms.",
        },
        {
          label: "Write a script",
          prompt: "Write a small script that automates a repetitive task on my machine.",
        },
      ];

  return (
    <aside className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-panel)]">
      {/* ── Header */}
      <div className="flex h-9 shrink-0 items-center gap-2  border-b border-(--border) px-3">
        
        <span className="text-[8px] font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
          {settings.model} 
        </span>
        {/*Was used to open the agent settings but it isnt needed anymore*/}
        {/* <button
          type="button"
          onClick={onOpenSettings}
          title={t("ide.openAiSettings")}
          className="ml-auto flex items-center gap-1.5 rounded  border-(--border) bg-(--fill-1) px-1.5 py-[2px] text-[10.5px] text-[var(--text-muted)] transition-colors hover:border-(--border-strong) hover:text-[var(--text-primary)]"
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              configured ? "bg-emerald-500" : "bg-zinc-600"
            }`}
          />
          <span className="max-w-[150px] truncate">{settings.model || spec.label}</span>
        </button> */}
        {messages.length > 0 && !busy && (
          <button
            type="button"
            onClick={clearChat}
            title={t("agent.clearConversation")}
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
          >
            <IoTrashOutline size={13} />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          title={t("ide.toggleAgent")}
          className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
        >
          <IoClose size={12} />
        </button>
      </div>

      {/* ── Mode switcher */}
      <div className="flex shrink-0 items-center gap-1 border-b border-(--border) px-2.5 py-1.5">
        {(
          [
            ["chat", t("app.chat"), t("agent.chatTip")],
            ["agent", t("app.agent"), t("agent.agentTip")],
            ["orchestrator", t("agent.orchestrator"), t("agent.orchestratorTip")],
          ] as const
        ).map(([m, label, tip]) => (
          <button
            key={m}
            type="button"
            disabled={busy}
            onClick={() => setMode(m)}
            title={tip}
            className={`rounded-md px-2.5 py-1 text-[11px] transition disabled:opacity-50 ${
              mode === m
                ? "bg-(--fill-2) font-medium text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:bg-(--fill-1) hover:text-[var(--text-primary)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Message feed ─*/}
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex min-h-full flex-col items-center justify-center px-5 pb-6 text-center">
            <p className="mt-1 max-w-[280px] text-[11.5px] leading-5 text-[var(--text-muted)]" />
            {/*Already has a configure an api key to start warning so more arent needed. 
            it would be over stimulating*/}

            {/* {!configured && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="mt-4 m-4 rounded-md border border-(--border-strong) bg-(--fill-1) px-3 py-1.5 text-[11.5px] text-[var(--text-primary)] transition hover:bg-(--fill-2)"
              >
              onfigure to start
              </button>
            )} */}
            
            {/*you can tell what this is lol its what makes the uh 
            Ready to start working animation inside the agent panel 
            inside the IDE */}
            
            <BlurText
              text={t("agent.ready")}
              delay={70}
              animateBy="letters"
              direction="top"
              onAnimationComplete={handleAnimationComplete}
              className="mb-3 justify-center text-center text-2xl text-[var(--text-primary)] font-serif"
            />
            <div className="mt-5 w-full grid grid-cols-2 gap-1.5">
              
              {suggestions.map((sg) => (
            
                //Credits to reactbits.dev for this component. i didnt create it, 
                // but i did modif it in some way
              <StarBorder
                as="button"
                type="button"
                onClick={
                  () => send(sg.prompt)
                }
                disabled={!configured}
                color="purple"
                speed="7s"
                thickness={2}
                backgroundColor="root"
                borderColor="gray"
                className="w-full rounded-[4px] transition hover:bg-(--fill-1)"
                innerClassName="px-3 py-2.5 text-left"
              >
                  <IoAdd className = "bg-black rounded-2xl"/>
                  <span className="text-[11.5px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]">
                    {sg.label}
                  </span>
              </StarBorder>
              ))}
                  
            </div>
          </div>
            
        ) : (
          <div className="space-y-4 px-3.5 py-4">
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="msg-in flex justify-end">
                  <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-lg rounded-br-sm border border-(--border) bg-white/[0.055] px-3 py-1.5 text-[12.5px] leading-5 text-[var(--text-primary)]">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="msg-in">
                  <div className="mb-1 flex items-center gap-1.5">
                    {/* <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="var(--accent)" strokeWidth="1.4" strokeLinejoin="round">
                      <path d="M8 1.8l1.55 4.2L13.8 7.5l-4.25 1.5L8 13.2 6.45 9 2.2 7.5l4.25-1.5L8 1.8z" />
                    </svg> */}
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                      {t("app.agent")}
                    </span>
                  </div>
                  <div className="text-[12.5px] leading-6 text-[var(--text-primary)]">
                    {m.content ? (
                      <Markdown content={m.content} />
                    ) : null}
                    {busy && i === messages.length - 1 && m.content && (
                      <span className="stream-caret" />
                    )}
                  </div>
                </div>
              )
            )}
            {busy && !messages[messages.length - 1]?.content && (
              <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                <ThinkingIndicator label="Thinking" />
              </div>
            )}
            <AgenticActivity
              items={activities}
              pending={pendingApproval}
              onApprove={handleApprove}
              onDeny={handleDeny}
            />
          </div>
        )}
      </div>

      {/* ── Orchestrator plan ──────────────────────────────────────────────── */}
      {plan && (
        <div className="shrink-0 px-3 pb-1">
          <div className="overflow-hidden rounded-lg border border-(--border) bg-(--fill-1)">
            <div className="flex items-center justify-between border-b border-(--border) px-3 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                {t("agent.plan")}
              </span>
              <button
                type="button"
                onClick={() => setPlan(null)}
                title={t("app.close")}
                className="text-[10px] text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
              >
                ✕
              </button>
            </div>
            <div className="px-3 py-1.5">
              {plan.map((s, i) => (
                <div key={i} className="flex items-start gap-2 py-0.5">
                  <span
                    className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${
                      s.status === "running"
                        ? "animate-pulse bg-blue-400"
                        : s.status === "done"
                          ? "bg-emerald-500"
                          : s.status === "error"
                            ? "bg-red-400"
                            : "bg-zinc-600"
                    }`}
                  />
                  <div className="min-w-0">
                    <p className="text-[11.5px] font-medium leading-5 text-[var(--text-primary)]">
                      {i + 1}. {s.title}
                    </p>
                    {s.detail && (
                      <p className="text-[10.5px] leading-4 text-[var(--text-muted)]">{s.detail}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="shrink-0 px-3 pt-2">
          <div className="flex items-start justify-between gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.08] px-3 py-2 text-[11.5px] leading-5 text-red-300">
            <span className="min-w-0 break-words">{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="shrink-0 text-red-300/60 transition hover:text-red-200"
              title={t("app.close")}
            >
              <IoClose size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ── Composer */}
      <div className="shrink-0  border-(--border) p-2.5">
        {/* Context chips — what the agent can currently see. */}
        <div className="mb-1.5 flex flex-wrap items-center gap-3 px-0.5">
          {workspaceRoot ? (
            <span
              title={workspaceRoot}
              className="inline-flex items-center gap-1 rounded border border-(--border) bg-(--fill-1) px-2 py-0.5 text-[10.5px] text-[var(--text-secondary)] m-2"
            >
              <IoFolderOutline size={9} />
              {workspaceRoot.split(/[\\/]/).filter(Boolean).pop()}
            </span>
          ) : (
            <span className="text-[10.5px] text-[var(--text-muted)]">{t("agent.noWorkspace")}</span>
          )}
          {activeEditorPath && (
            <span
              title={t("agent.activeFileContext")}
              className="inline-flex items-center gap-1.5 rounded border border-(--border) bg-(--fill-1) px-2 py-0.5 text-[10.5px] text-[var(--text-secondary)]"
            >
              <span className="h-1 w-1 rounded-full bg-(--accent)" />
              {activeEditorPath.split(/[\\/]/).pop()}
            </span>
          )}
          {mcpServerCount > 0 && (
            <button
              type="button"
              onClick={onOpenSettings}
              title={t("agent.mcpConnected", { count: mcpServerCount })}
              className="inline-flex items-center gap-1.5 rounded border border-(--border) bg-(--fill-1) px-2 py-0.5 text-[10.5px] text-[var(--text-secondary)] transition-colors hover:border-(--border-strong) hover:text-[var(--text-primary)]"
            >
              <IoApps size={9} />
              {mcpServerCount} MCP
            </button>
          )}
        </div>
        <PromptBar
          value={input}
          onValueChange={setInput}
          onEffortChange={(effort) => {
            effortTokensRef.current = outputTokensForEffort(effort);
          }}
          disabled={!configured}
          busy={busy}
          onSend={(text, detail) => {
            void (async () => {
              const ctx = await buildAttachmentContext(detail.attachments);
              const body = [expandCommand(text), ctx].filter(Boolean).join("\n\n");
              send(body);
            })();
          }}
          onAttach={(key) => (key === "folder" ? pickFolder() : pickFiles())}
          onStop={stopAgent}
          placeholder={
            configured
              ? workspaceRoot
                ? t("agent.askToChange")
                : t("agent.askAnything")
              : t("agent.configureAgent")
          }
          models={[{ key: `${settings.provider}:${settings.model}`, name: settings.model || spec.label }]}
          defaultModel={`${settings.provider}:${settings.model}`}
          defaultEffort="Medium"
          className="w-full"
        />
        <div className="mt-1 flex items-center justify-between px-1 text-[10px] text-[var(--text-faint)]">
          <span>{t("agent.verifyInfo")}</span>
          {/* <span>Destructive actions need approval</span> */}
        </div>
      </div>
    </aside>
  );
},
(prev, next) =>
  prev.settings === next.settings &&
  prev.workspaceRoot === next.workspaceRoot &&
  prev.activeEditorPath === next.activeEditorPath &&
  prev.onBusyChange === next.onBusyChange);

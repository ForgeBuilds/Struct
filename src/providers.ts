/*
 * Author: madhusudhan
 * Check the LICENSE in the GitHub repo (https://github.com/Lumorix-studios/Struct) for more information on permissions to use this code.
 */
import type { AISettings, Message, NativeToolCall, ProviderId } from "./types";
import { ANTHROPIC_TOOLS, GEMINI_FUNCTION_DECLARATIONS, OPENAI_TOOLS } from "./agentic";

export interface ProviderSpec {
  id: ProviderId;
  label: string;
  /** Human readable note shown in the settings UI, e.g. "No API key required". */
  note?: string;
  defaultBaseUrl: string;
  defaultModel: string;
  /** Whether the provider requires an API key / token at all. */
  needsAuth: boolean;
  /** Header name used to carry the key, or `null` to use a query parameter. */
  authHeader: string | null;
  /** How the header value is formatted. */
  authScheme: "bearer" | "apikey";
  /** Query parameter name for the key (Google uses `?key=`), or `null`. */
  authQueryParam: string | null;
  /** Extra static headers that must be sent (e.g. Anthropic's `anthropic-version`). */
  extraHeaders: Record<string, string>;
  /** Assemble the full request URL from settings (may embed the key as a query param). */
  buildUrl: (settings: AISettings) => string;
  /** Build the JSON request body from the conversation history (excludes the system prompt
   * which each provider attaches in its own shape). */
  buildBody: (settings: AISettings, history: Message[], opts?: BuildBodyOptions) => object;
  /** Pull a text delta out of a decoded stream chunk. Return `null` when the
   * chunk carries no new text (a role event, usage metadata, `[DONE]`, etc.). */
  extractDelta: (json: unknown) => string | null;
  /** Extract full content from a complete (non-streaming) JSON response. */
  extractContent: (json: unknown) => string;
  /** Pull token usage counters out of a stream chunk / complete response.
   * Return null when the chunk carries no usage info. Optional — when absent
   * (or silent) the caller falls back to char/4 estimates. */
  extractUsage?: (json: unknown) => { input?: number; output?: number } | null;
  /** Validate the API key format. Return a user-facing error string, or `null` when valid. */
  validateAuth: (apiKey: string) => string | null;
  /** Produce a provider-specific hint appended to HTTP auth / config errors. */
  authErrorHint: (status: number, settings: AISettings) => string;
}

/**
 * Minimal, `any`-free shapes for the pieces of each provider's JSON that we
 * actually read. Parsed SSE/NDJSON lines are cast into these so the compiler
 * stays happy without resorting to `any`. Extra fields are simply ignored.
 */
interface OpenAiShape {
  choices?: Array<{
    delta?: {
      content?: string | Array<{ text?: string }>;
      reasoning_content?: string;
      reasoning?: string;
    };
    message?: { content?: string };
  }>;
}
interface AnthropicShape {
  type?: string;
  delta?: { text?: string };
  content?: Array<{ text?: string }>;
}
interface GoogleShape {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}
interface OllamaShape {
  done?: boolean;
  message?: { content?: string };
}

/* ── Token-usage extractors (one per wire format) ───────────────────── */

/** OpenAI-compatible: `usage` on the final chunk (needs include_usage) or
 * any complete response object. */
function openAiUsage(j: unknown): { input?: number; output?: number } | null {
  const u = (j as { usage?: { prompt_tokens?: number; completion_tokens?: number } })?.usage;
  if (!u || (u.prompt_tokens == null && u.completion_tokens == null)) return null;
  return { input: u.prompt_tokens ?? undefined, output: u.completion_tokens ?? undefined };
}

/** Google Gemini: `usageMetadata` on each chunk / complete response. */
function googleUsage(j: unknown): { input?: number; output?: number } | null {
  const u = (j as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } })
    ?.usageMetadata;
  if (!u) return null;
  return { input: u.promptTokenCount, output: u.candidatesTokenCount };
}

/** Anthropic: input tokens arrive in `message_start`, output tokens
 * accumulate in each `message_delta`. */
function anthropicUsage(j: unknown): { input?: number; output?: number } | null {
  const o = j as {
    type?: string;
    message?: { usage?: { input_tokens?: number } };
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  if (o?.type === "message_start" && o.message?.usage?.input_tokens != null) {
    return { input: o.message.usage.input_tokens };
  }
  if (o?.type === "message_delta" && o.usage?.output_tokens != null) {
    return { output: o.usage.output_tokens };
  }
  if (o?.usage?.input_tokens != null || o?.usage?.output_tokens != null) {
    return { input: o.usage?.input_tokens, output: o.usage?.output_tokens };
  }
  return null;
}

/** Ollama: counters only on the final chunk (`done: true`). */
function ollamaUsage(j: unknown): { input?: number; output?: number } | null {
  const o = j as { done?: boolean; prompt_eval_count?: number; eval_count?: number };
  if (!o?.done) return null;
  return { input: o.prompt_eval_count, output: o.eval_count };
}

export interface BuildBodyOptions {
  enableTools?: boolean;
  /** Maximum number of output tokens for this turn, selected by PromptBar effort. */
  maxOutputTokens?: number;
  /** Dynamic MCP tools discovered for this turn. */
  additionalTools?: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
  /** Google only: replay every historical tool-call turn as plain text
   * instead of functionCall parts (self-healing fallback when the Gemini API
   * rejects replayed calls missing their thought_signature). */
  forceTextTools?: boolean;
}

/** Conservative cross-provider budgets for the PromptBar effort selector. */
export function outputTokensForEffort(effort: string | undefined): number {
  switch (effort?.toLowerCase()) {
    case "low":
      return 1024;
    case "medium":
      return 4096;
    case "high":
      return 8192;
    case "extra":
      return 16384;
    case "max":
      return 32768;
    default:
      return 8192;
  }
}

function openAiTools(opts?: BuildBodyOptions): object[] {
  return [
    ...OPENAI_TOOLS,
    ...(opts?.additionalTools ?? []).map((tool) => ({
      type: "function" as const,
      function: tool,
    })),
  ];
}

function anthropicTools(opts?: BuildBodyOptions): object[] {
  return [
    ...ANTHROPIC_TOOLS,
    ...(opts?.additionalTools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    })),
  ];
}

function geminiTools(opts?: BuildBodyOptions): object[] {
  return [
    ...GEMINI_FUNCTION_DECLARATIONS,
    ...(opts?.additionalTools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })),
  ];
}

function toolArgsJson(tc: NativeToolCall): string {
  return JSON.stringify(tc.arguments ?? {});
}

/**
 * Ollama-specific history mapper. Ollama's /api/chat differs from OpenAI in
 * two ways that cause hard 400s if we reuse the OpenAI shapes:
 *  - `tool_calls[].function.arguments` must be an OBJECT, not a JSON string.
 *  - There is no `role: "tool"`; tool results are sent as user messages.
 */
function toOllamaMessages(history: Message[]): object[] {
  const out: object[] = [];
  for (const m of history) {
    if (m.role === "tool") {
      out.push({
        role: "user",
        content: `<tool_result${m.toolName ? ` for ${m.toolName}` : ""}>\n${m.content}\n</tool_result>`,
      });
      continue;
    }
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      out.push({
        role: "assistant",
        content: m.content || "",
        tool_calls: m.toolCalls.map((tc) => ({
          function: { name: tc.name, arguments: tc.arguments ?? {} },
        })),
      });
      continue;
    }
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

function toOpenAiMessages(history: Message[]): object[] {
  const out: object[] = [];
  for (const m of history) {
    if (m.role === "tool") {
      out.push({
        role: "tool",
        tool_call_id: m.toolCallId ?? m.toolName ?? "tool",
        content: m.content,
      });
      continue;
    }
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      out.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: toolArgsJson(tc) },
        })),
      });
      continue;
    }
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

function toAnthropicMessages(history: Message[]): object[] {
  const out: object[] = [];
  for (let i = 0; i < history.length; i++) {
    const m = history[i];
    if (m.role === "tool") continue;
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      const content: object[] = [];
      if (m.content.trim()) content.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls) {
        content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments ?? {} });
      }
      out.push({ role: "assistant", content });
      const results: object[] = [];
      while (i + 1 < history.length && history[i + 1].role === "tool") {
        i++;
        const t = history[i];
        results.push({
          type: "tool_result",
          tool_use_id: t.toolCallId ?? t.toolName,
          content: t.content,
        });
      }
      if (results.length) out.push({ role: "user", content: results });
      continue;
    }
    if (m.role === "system") continue;
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

function toGeminiContents(history: Message[], forceTextTools = false): object[] {
  const out: object[] = [];
  for (let i = 0; i < history.length; i++) {
    const m = history[i];
    if (m.role === "tool") continue;
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      // Gemini thinking models hard-fail (400 "Function call is missing a
      // thought_signature") if a replayed functionCall part lacks the opaque
      // signature the model originally returned. Old turns saved before
      // signature capture existed — and any capture we miss — can't be
      // repaired retroactively, so degrade gracefully: replay the whole
      // call/result exchange as plain text instead of raw functionCall parts.
      const allSigned =
        !forceTextTools && m.toolCalls.every((tc) => !!tc.thoughtSignature);
      if (!allSigned) {
        const callSummary = m.toolCalls
          .map(
            (tc) =>
              `${tc.name.replace(/^default_api:/, "")}(${JSON.stringify(tc.arguments ?? {})})`
          )
          .join("; ");
        out.push({
          role: "model",
          parts: [
            {
              text: `${m.content ? `${m.content}\n` : ""}[called tools: ${callSummary}]`,
            },
          ],
        });
        const resultParts: object[] = [];
        while (i + 1 < history.length && history[i + 1].role === "tool") {
          i++;
          const t = history[i];
          const text = String(t.content ?? "");
          resultParts.push({
            text: `[${t.toolName ?? "tool"} result] ${
              text.length > 4000 ? `${text.slice(0, 4000)}…` : text
            }`,
          });
        }
        if (resultParts.length) out.push({ role: "user", parts: resultParts });
        continue;
      }

      const callParts: object[] = [];
      if (m.content.trim()) callParts.push({ text: m.content });
      for (const tc of m.toolCalls) {
        const part: Record<string, unknown> = {
          // Defensive: some models emit names with a "default_api:" prefix.
          functionCall: { name: tc.name.replace(/^default_api:/, ""), args: tc.arguments ?? {} },
        };
        // Gemini thinking models require the signature returned with a
        // functionCall to be replayed in later turns — without it the API
        // fails with 400 "Function call is missing a thought_signature".
        if (tc.thoughtSignature) part.thoughtSignature = tc.thoughtSignature;
        callParts.push(part);
      }
      out.push({ role: "model", parts: callParts });
      const parts: object[] = [];
      while (i + 1 < history.length && history[i + 1].role === "tool") {
        i++;
        const t = history[i];
        parts.push({
          functionResponse: {
            name: t.toolName ?? "unknown",
            response: { result: t.content },
          },
        });
      }
      if (parts.length) out.push({ role: "user", parts });
      continue;
    }
    out.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    });
  }
  return out;
}

/** Format an API key as a Bearer token header value. */
function bearer(key: string): string {
  return `Bearer ${key}`;
}

function nvidiaChatCompletionsUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(base)) return base;
  if (/\/v1$/i.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

function openAiDeltaText(j: unknown): string | null {
  const delta = (j as OpenAiShape)?.choices?.[0]?.delta;
  const content = delta?.content;
  if (typeof content === "string" && content.length > 0) return content;
  if (Array.isArray(content)) {
    const text = content.map((part) => part.text ?? "").join("");
    if (text) return text;
  }
  for (const value of [delta?.reasoning_content, delta?.reasoning]) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

/**
 * Build the authentication headers for a provider. Keys are only attached when
 * the provider requires auth and a key is present — self-hosted providers such
 * as Ollama never send a key header. Query-param providers (Google) have their
 * key embedded in the URL by `buildUrl` instead.
 */
export function buildAuthHeaders(spec: ProviderSpec, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { ...spec.extraHeaders };
  if (spec.needsAuth && apiKey && spec.authHeader) {
    headers[spec.authHeader] = spec.authScheme === "bearer" ? bearer(apiKey) : apiKey;
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Models that reject native tool calls
// ---------------------------------------------------------------------------
// Some local models (e.g. Ollama's deepseek-coder) return
// `400 … does not support tools` whenever a `tools` field is present. Once a
// model rejects native tools we remember it for the session and omit `tools`
// from every later request — the agent loop still works through the
// text-based tool protocol (parseToolCalls in agentic.ts).
const noNativeTools = new Set<string>();

function noNativeToolsKey(s: AISettings): string {
  return `${s.provider}|${s.baseUrl}|${s.model}`;
}

/** Remember that this model rejected native `tools` so buildBody omits them. */
export function markNoNativeTools(s: AISettings): void {
  noNativeTools.add(noNativeToolsKey(s));
}

/** True once this model has rejected native `tools` with a 400. */
export function nativeToolsUnsupported(s: AISettings): boolean {
  return noNativeTools.has(noNativeToolsKey(s));
}

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "",
    needsAuth: true,
    authHeader: "Authorization",
    authScheme: "bearer",
    authQueryParam: null,
    extraHeaders: {},
    buildUrl: (s) => `${s.baseUrl.replace(/\/+$/, "")}/chat/completions`,
    buildBody: (s, history, opts) => ({
      model: s.model,
      messages: [{ role: "system", content: s.systemPrompt }, ...toOpenAiMessages(history)],
      temperature: s.temperature,
      max_tokens: opts?.maxOutputTokens,
      stream: true,
      // Ask for the exact token counts on the final SSE chunk.
      stream_options: { include_usage: true },
      ...(opts?.enableTools && !nativeToolsUnsupported(s)
        ? { tools: openAiTools(opts), tool_choice: "auto" }
        : {}),
    }),
    extractDelta: (j) => {
      return openAiDeltaText(j);
    },
    extractContent: (j) => (j as OpenAiShape)?.choices?.[0]?.message?.content ?? "",
    extractUsage: openAiUsage,
    validateAuth: (k) =>
      !k
        ? "An OpenAI API key is required (get one at platform.openai.com/api-keys)."
        : null,
    authErrorHint: (status) =>
      `Authentication failed (${status}). Verify your OpenAI key at platform.openai.com/api-keys and confirm billing is enabled.`,
  },

  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    note: "Auto-routes to the best available model.",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "nvidia/nemotron-3-ultra-550b-a55b:free",
    needsAuth: true,
    authHeader: "Authorization",
    authScheme: "bearer",
    authQueryParam: null,
    extraHeaders: {
      // OpenRouter recommends these for app analytics & ranking.
      "HTTP-Referer": "https://neochat.local",
      "X-Title": "Struct",
    },
    buildUrl: (s) => `${s.baseUrl.replace(/\/+$/, "")}/chat/completions`,
    buildBody: (s, history, opts) => ({
      model: s.model,
      messages: [{ role: "system", content: s.systemPrompt }, ...toOpenAiMessages(history)],
      temperature: s.temperature,
      max_tokens: opts?.maxOutputTokens,
      stream: true,
      // Ask for the exact token counts on the final SSE chunk.
      stream_options: { include_usage: true },
      ...(opts?.enableTools ? { tools: openAiTools(opts), tool_choice: "auto" } : {}),
    }),
    extractDelta: (j) => {
      const c = (j as OpenAiShape)?.choices?.[0]?.delta?.content;
      return typeof c === "string" && c.length > 0 ? c : null;
    },
    extractContent: (j) => (j as OpenAiShape)?.choices?.[0]?.message?.content ?? "",
    extractUsage: openAiUsage,
    validateAuth: (k) =>
      !k
        ? "An OpenRouter API key is required (get one at openrouter.ai/keys)."
        : null,
    authErrorHint: (status) =>
      `Authentication failed (${status}). Check your OpenRouter key at openrouter.ai/keys and that the model is available.`,
  },

  groq: {
    id: "groq",
    label: "Groq",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.1-8b-instant",
    needsAuth: true,
    authHeader: "Authorization",
    authScheme: "bearer",
    authQueryParam: null,
    extraHeaders: {},
    buildUrl: (s) => `${s.baseUrl.replace(/\/+$/, "")}/chat/completions`,
    buildBody: (s, history, opts) => ({
      model: s.model,
      messages: [{ role: "system", content: s.systemPrompt }, ...toOpenAiMessages(history)],
      temperature: s.temperature,
      max_tokens: opts?.maxOutputTokens,
      stream: true,
      // Ask for the exact token counts on the final SSE chunk.
      stream_options: { include_usage: true },
      ...(opts?.enableTools ? { tools: openAiTools(opts), tool_choice: "auto" } : {}),
    }),
    extractDelta: (j) => {
      const c = (j as OpenAiShape)?.choices?.[0]?.delta?.content;
      return typeof c === "string" && c.length > 0 ? c : null;
    },
    extractContent: (j) => (j as OpenAiShape)?.choices?.[0]?.message?.content ?? "",
    validateAuth: (k) =>
      !k
        ? "A Groq API key is required (get one at console.groq.com/keys)."
        : null,
    authErrorHint: (status) =>
      `Authentication failed (${status}). Check your Groq key at console.groq.com/keys.`,
  },

  nvidia: {
    id: "nvidia",
    label: "NVIDIA NIM",
    note: "NVIDIA-hosted OpenAI-compatible inference API.",
    defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
    defaultModel: "",
    needsAuth: true,
    authHeader: "Authorization",
    authScheme: "bearer",
    authQueryParam: null,
    extraHeaders: {},
    buildUrl: (s) => nvidiaChatCompletionsUrl(s.baseUrl),
    buildBody: (s, history, opts) => ({
      model: s.model,
      messages: [{ role: "system", content: s.systemPrompt }, ...toOpenAiMessages(history)],
      temperature: s.temperature,
      max_tokens: opts?.maxOutputTokens,
      stream: true,
      ...(opts?.enableTools && !nativeToolsUnsupported(s)
        ? { tools: openAiTools(opts), tool_choice: "auto" }
        : {}),
    }),
    extractDelta: (j) => {
      return openAiDeltaText(j);
    },
    extractContent: (j) => (j as OpenAiShape)?.choices?.[0]?.message?.content ?? "",
    extractUsage: openAiUsage,
    validateAuth: (k) =>
      !k
        ? "An NVIDIA API key is required (get one at build.nvidia.com)."
        : null,
    authErrorHint: (status, s) =>
      `NVIDIA NIM request failed (${status}). Verify your NVIDIA API key, model name "${s.model}", and that the model is available in your NIM account.`,
  },

  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    defaultBaseUrl: "https://api.anthropic.com",
    defaultModel: "",
    needsAuth: true,
    authHeader: "x-api-key",
    authScheme: "apikey", // raw value, NOT "Bearer ..."
    authQueryParam: null,
    extraHeaders: { "anthropic-version": "2023-06-01" },
    buildUrl: (s) => `${s.baseUrl.replace(/\/+$/, "")}/v1/messages`,
    buildBody: (s, history, opts) => ({
      model: s.model,
      system: s.systemPrompt,
      messages: toAnthropicMessages(history),
      max_tokens: opts?.maxOutputTokens ?? 8192,
      temperature: s.temperature,
      stream: true,
      ...(opts?.enableTools ? { tools: anthropicTools(opts) } : {}),
    }),
    extractDelta: (j) => {
      const obj = j as AnthropicShape;
      if (obj?.type !== "content_block_delta") return null;
      const t = obj?.delta?.text;
      return typeof t === "string" && t.length > 0 ? t : null;
    },
    extractContent: (j) => (j as AnthropicShape)?.content?.[0]?.text ?? "",
    extractUsage: anthropicUsage,
    validateAuth: (k) =>
      !k
        ? "An Anthropic API key is required (get one at console.anthropic.com/settings/keys)."
        : null,
    authErrorHint: (status, s) =>
      `Authentication failed (${status}). Verify your Anthropic key at console.anthropic.com/settings/keys and that you have access to "${s.model}".`,
  },

  google: {
    id: "google",
    label: "Google Gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "",
    needsAuth: true,
    authHeader: null, // key goes in the URL query string
    authScheme: "bearer",
    authQueryParam: "key",
    extraHeaders: {},
    buildUrl: (s) => {
      const base = s.baseUrl.replace(/\/+$/, "");
      const url = new URL(`${base}/models/${encodeURIComponent(s.model)}:streamGenerateContent`);
      url.searchParams.set("key", s.apiKey);
      // Request SSE so the response streams line-by-line. Without this,
      // Google returns one big JSON array and streaming yields no deltas
      // (which previously caused empty replies).
      url.searchParams.set("alt", "sse");
      return url.toString();
    },
    buildBody: (s, history, opts) => ({
      contents: toGeminiContents(history, opts?.forceTextTools === true),
      system_instruction: { parts: [{ text: s.systemPrompt }] },
      generationConfig: {
        temperature: s.temperature,
        maxOutputTokens: opts?.maxOutputTokens,
      },
      ...(opts?.enableTools ? { tools: [{ functionDeclarations: geminiTools(opts) }] } : {}),
    }),
    extractDelta: (j) => {
      const t = (j as GoogleShape)?.candidates?.[0]?.content?.parts?.[0]?.text;
      return typeof t === "string" && t.length > 0 ? t : null;
    },
    extractContent: (j) =>
      (j as GoogleShape)?.candidates?.[0]?.content?.parts?.[0]?.text ?? "",
    extractUsage: googleUsage,
    validateAuth: (k) =>
      !k
        ? "A Google API key is required (get one from Google Cloud / AI Studio)."
        : null,
    authErrorHint: (status) =>
      `Authentication failed (${status}). Check your Google API key and that the Generative Language API is enabled in Google Cloud.`,
  },

  ollama: {
    id: "ollama",
    label: "Ollama",
    note: "Self-hosted local model runner. No API key needed.",
    defaultBaseUrl: "http://127.0.0.1:11434",
    defaultModel: "",
    needsAuth: false,
    authHeader: null,
    authScheme: "bearer",
    authQueryParam: null,
    extraHeaders: {},
    buildUrl: (s) => `${s.baseUrl.replace(/\/+$/, "")}/api/chat`,
    buildBody: (s, history, opts) => ({
      model: s.model,
      messages: [{ role: "system", content: s.systemPrompt }, ...toOllamaMessages(history)],
      stream: true,
      options: { temperature: s.temperature, num_predict: opts?.maxOutputTokens },
      ...(opts?.enableTools && !nativeToolsUnsupported(s) ? { tools: openAiTools(opts) } : {}),
    }),
    // Ollama sends newline-delimited JSON (no `data:` prefix). The final chunk
    // has `done: true` and must be ignored.
    extractDelta: (j) => {
      const obj = j as OllamaShape;
      if (obj?.done) return null;
      const c = obj?.message?.content;
      return typeof c === "string" && c.length > 0 ? c : null;
    },
    extractContent: (j) => (j as OllamaShape)?.message?.content ?? "",
    extractUsage: ollamaUsage,
    validateAuth: () => null,
    authErrorHint: (status, s) =>
      `Connection failed (${status}). Ensure Ollama is running on "${s.baseUrl}" and that the model "${s.model}" is pulled (try: ollama pull ${s.model}).`,
  },

  llamacpp: {
    id: "llamacpp",
    label: "llama.cpp (local)",
    note: "Managed local runtime. Models are downloaded and served by llama-server.",
    defaultBaseUrl: "http://127.0.0.1:18080",
    defaultModel: "local",
    needsAuth: false,
    authHeader: null,
    authScheme: "bearer",
    authQueryParam: null,
    extraHeaders: {},
    // llama-server exposes the OpenAI-compatible API, so the request shape is
    // identical to the "custom" provider.
    buildUrl: (s) => `${s.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`,
    buildBody: (s, history, opts) => ({
      model: s.model,
      messages: [{ role: "system", content: s.systemPrompt }, ...toOpenAiMessages(history)],
      temperature: s.temperature,
      max_tokens: opts?.maxOutputTokens,
      stream: true,
      ...(opts?.enableTools && !nativeToolsUnsupported(s)
        ? { tools: openAiTools(opts), tool_choice: "auto" }
        : {}),
    }),
    extractDelta: (j) => {
      const c = (j as OpenAiShape)?.choices?.[0]?.delta?.content;
      return typeof c === "string" && c.length > 0 ? c : null;
    },
    extractContent: (j) => (j as OpenAiShape)?.choices?.[0]?.message?.content ?? "",
    extractUsage: openAiUsage,
    validateAuth: () => null,
    authErrorHint: (status, s) =>
      `Connection failed (${status}). Ensure the local llama-server is running on "${s.baseUrl}" and that a model is loaded.`,
  },

  custom: {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    note: "Any OpenAI-compatible endpoint (e.g. a local proxy).",
    defaultBaseUrl: "",
    defaultModel: "",
    needsAuth: true,
    authHeader: "Authorization",
    authScheme: "bearer",
    authQueryParam: null,
    extraHeaders: {},
    buildUrl: (s) => `${s.baseUrl.replace(/\/+$/, "")}/chat/completions`,
    buildBody: (s, history, opts) => ({
      model: s.model,
      messages: [{ role: "system", content: s.systemPrompt }, ...toOpenAiMessages(history)],
      temperature: s.temperature,
      max_tokens: opts?.maxOutputTokens,
      stream: true,
      ...(opts?.enableTools && !nativeToolsUnsupported(s)
        ? { tools: openAiTools(opts), tool_choice: "auto" }
        : {}),
    }),
    extractDelta: (j) => {
      const c = (j as OpenAiShape)?.choices?.[0]?.delta?.content;
      return typeof c === "string" && c.length > 0 ? c : null;
    },
    extractContent: (j) => (j as OpenAiShape)?.choices?.[0]?.message?.content ?? "",
    extractUsage: openAiUsage,
    validateAuth: (k) => (!k ? "An API key is required." : null),
    authErrorHint: (status) =>
      `Request failed (${status}). Check your base URL, API key, and model in the AI Settings sidebar.`,
  },
};

/**
 * Resolve the provider spec for a given settings object, falling back to a
 * safe default when the stored provider id is unknown (e.g. settings were
 * saved by an older version of the app).
 */
export function getProviderSpec(settings: AISettings): ProviderSpec {
  return PROVIDERS[settings.provider] ?? PROVIDERS.ollama;
}

/** Pick a provider by id, falling back to `ollama` for unknown ids. */
export function providerById(id: ProviderId): ProviderSpec {
  return PROVIDERS[id] ?? PROVIDERS.ollama;
}

/** List of providers suitable for a `<select>`. */
export const PROVIDER_OPTIONS: { id: ProviderId; label: string; note?: string }[] =
  Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label, note: p.note }));

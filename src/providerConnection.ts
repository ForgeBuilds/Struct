import { invoke } from "./native";
import {
  buildAuthHeaders,
  getProviderSpec,
  type ProviderSpec,
} from "./providers";
import type { AISettings, Message } from "./types";

interface NativeHttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

async function nativeProviderFetch(
  url: string,
  init: RequestInit,
  requestId?: string
): Promise<Response> {
  const parsed = new URL(url);
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  const body = typeof init.body === "string" ? init.body : null;

  if (loopback && parsed.port === "11434") {
    const result = await invoke<{ status: number; body: string }>("ollama_request", {
      url,
      method: init.method ?? "GET",
      body,
    });
    return new Response(result.body, {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (loopback && parsed.port === "18080") {
    const result = await invoke<{ status: number; body: string }>("llamacpp_request", {
      url,
      method: init.method ?? "GET",
      body,
    });
    return new Response(result.body, {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, key) => {
    headers[key] = value;
  });
  const result = await invoke<NativeHttpResponse>("http_fetch", {
    url,
    method: init.method ?? "GET",
    headers,
    ...(requestId ? { requestId } : {}),
    ...(body !== null ? { body } : {}),
  });
  return new Response(result.body, {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
  });
}

/** Route provider requests through Electron's main process to avoid renderer CORS. */
export async function providerFetch(url: string, init: RequestInit): Promise<Response> {
  if (!window.neoDesktop) return fetch(url, init);
  if (init.signal?.aborted) throw new DOMException("The request was aborted.", "AbortError");
  if (!init.signal) return nativeProviderFetch(url, init);

  const requestId = crypto.randomUUID();
  let removeAbortListener = () => {};
  const aborted = new Promise<never>((_, reject) => {
    const onAbort = () => {
      void invoke("http_fetch_cancel", { requestId }).catch((error: unknown) => {
        console.warn("Could not cancel the provider request:", error);
      });
      reject(new DOMException("The request was aborted.", "AbortError"));
    };
    init.signal?.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => init.signal?.removeEventListener("abort", onAbort);
  });
  try {
    return await Promise.race([nativeProviderFetch(url, init, requestId), aborted]);
  } finally {
    removeAbortListener();
  }
}

function nonStreamingUrl(spec: ProviderSpec, url: string): string {
  if (spec.id !== "google") return url;
  const endpoint = new URL(url);
  endpoint.pathname = endpoint.pathname.replace("streamGenerateContent", "generateContent");
  endpoint.searchParams.delete("alt");
  return endpoint.toString();
}

function responseErrorMessage(body: string): string {
  if (!body.trim()) return "The endpoint returned an empty error response.";
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object") {
      const object = parsed as Record<string, unknown>;
      const error = object.error;
      if (error && typeof error === "object") {
        const message = (error as Record<string, unknown>).message;
        if (typeof message === "string") return message;
      }
      if (typeof object.message === "string") return object.message;
    }
  } catch {
    // Non-JSON API errors are reported as plain text below.
  }
  const trimmed = body.trim();
  if (trimmed.startsWith("<") || trimmed.toLowerCase().includes("<!doctype")) {
    return "The server returned an HTML page, not an AI API response. Check the endpoint URL.";
  }
  return trimmed.length > 500 ? `${trimmed.slice(0, 500)}…` : trimmed;
}

/** Make one short, non-streaming inference request to verify the configured connection. */
export async function checkProviderConnection(settings: AISettings): Promise<string> {
  const spec = getProviderSpec(settings);
  if (!settings.baseUrl.trim()) throw new Error("Enter an API endpoint URL first.");
  if (!settings.model.trim()) throw new Error("Enter a model ID first.");
  const authError = spec.validateAuth(settings.apiKey.trim());
  if (authError) throw new Error(authError);

  const endpoint = nonStreamingUrl(spec, spec.buildUrl(settings));
  const parsedEndpoint = new URL(endpoint);
  if (parsedEndpoint.protocol !== "http:" && parsedEndpoint.protocol !== "https:") {
    throw new Error("The API endpoint must use HTTP or HTTPS.");
  }
  const history: Message[] = [{ role: "user", content: "Reply with OK." }];
  const request: Record<string, unknown> = {
    ...(spec.buildBody(settings, history, { maxOutputTokens: 16 }) as Record<string, unknown>),
    stream: false,
  };
  delete request.stream_options;
  let response: Response;
  try {
    response = await providerFetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders(spec, settings.apiKey),
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error(`The request to ${endpoint} timed out after 20 seconds.`, {
        cause: error,
      });
    }
    throw new Error(
      `Could not connect to ${endpoint}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
  const body = await response.text();
  if (!response.ok) {
    let message = `HTTP ${response.status} ${response.statusText}: ${responseErrorMessage(body)}`;
    if (response.status === 401 || response.status === 403) {
      message += ` ${spec.authErrorHint(response.status, settings)}`;
    }
    throw new Error(message);
  }

  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("The endpoint responded, but its response was not valid JSON.");
  }
  if (!spec.extractContent(data).trim()) {
    throw new Error("The endpoint responded, but returned no text. Check the model ID and API format.");
  }
  return `Connected to ${spec.label} (${settings.model}).`;
}

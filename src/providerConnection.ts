import { invoke, listen } from "./native";
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
}

interface ProviderStreamEvent {
  requestId: string;
  type: "chunk" | "end" | "error";
  chunk?: Uint8Array;
  message?: string;
}

async function nativeProviderFetch(url: string, init: RequestInit): Promise<Response> {
  if (init.signal?.aborted) throw new DOMException("The request was aborted.", "AbortError");
  const body = typeof init.body === "string" ? init.body : null;
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, key) => {
    headers[key] = value;
  });

  const requestId = crypto.randomUUID();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let unlisten: (() => void) | undefined;
  let closed = false;
  const pending: ProviderStreamEvent[] = [];
  const cleanup = () => {
    unlisten?.();
    unlisten = undefined;
    init.signal?.removeEventListener("abort", onAbort);
  };
  const cancelNative = () => {
    void invoke("http_fetch_cancel", { requestId }).catch((error: unknown) => {
      console.warn("Could not cancel the provider request:", error);
    });
  };
  const failStream = (error: Error) => {
    if (closed) return;
    closed = true;
    cleanup();
    controller?.error(error);
  };
  const handleEvent = (event: ProviderStreamEvent) => {
    if (closed || event.requestId !== requestId) return;
    if (!controller) {
      pending.push(event);
      return;
    }
    if (event.type === "chunk") {
      if (event.chunk) controller.enqueue(event.chunk);
      return;
    }
    if (event.type === "end") {
      closed = true;
      controller.close();
      cleanup();
      return;
    }
    failStream(new Error(event.message || "The provider stream failed."));
  };
  const onAbort = () => {
    cancelNative();
    failStream(new DOMException("The request was aborted.", "AbortError"));
    rejectAborted?.(new DOMException("The request was aborted.", "AbortError"));
  };
  let rejectAborted: ((error: Error) => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    rejectAborted = reject;
  });
  init.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    unlisten = await listen<ProviderStreamEvent>("provider:http-stream", (event) => {
      handleEvent(event.payload);
    });
    if (init.signal?.aborted) {
      onAbort();
      throw new DOMException("The request was aborted.", "AbortError");
    }

    const request = invoke<NativeHttpResponse>("http_fetch_stream", {
      url,
      method: init.method ?? "GET",
      headers,
      requestId,
      ...(body !== null ? { body } : {}),
    });
    const response = await Promise.race([request, aborted]);
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController;
        for (const event of pending.splice(0)) handleEvent(event);
      },
      cancel() {
        if (!closed) {
          closed = true;
          cancelNative();
          cleanup();
        }
      },
    });
    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    cleanup();
    throw error;
  }
}

/** Route provider requests through Electron's main process to avoid renderer CORS. */
export async function providerFetch(url: string, init: RequestInit): Promise<Response> {
  if (!window.neoDesktop) return fetch(url, init);
  return nativeProviderFetch(url, init);
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

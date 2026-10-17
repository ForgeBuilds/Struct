/*
 * Spotify for Struct's agent — OAuth 2.0 Authorization Code + PKCE against
 * the public Web API. No client secret: the user pastes the Client ID of
 * their own Spotify app (developer.spotify.com/dashboard) once, the consent
 * screen opens in the OS browser, and the redirect lands on the loopback
 * callback server in electron/main.cjs (Spotify rejects custom URI schemes,
 * so the agenticcoder:// deep link can't be used here).
 *
 * Shape mirrors src/gmail.ts: a credential/token store plus thin API helpers
 * that agentic.ts's executor calls. Playback control needs a Premium account
 * and an active device; search works for everyone.
 */

import { invoke } from "./native";
import { openExternalUrl } from "./lib/external";

/** Must match SPOTIFY_OAUTH_PORT in electron/main.cjs and the URI registered
 * in the user's Spotify app dashboard (Settings → Redirect URIs). */
export const SPOTIFY_REDIRECT_URI = "http://127.0.0.1:43821/callback";

/** Read playback + control playback + basic profile. */
const SPOTIFY_SCOPES = [
  "user-read-private",
  "user-read-playback-state",
  "user-read-currently-playing",
  "user-modify-playback-state",
];

const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";
const API_BASE = "https://api.spotify.com/v1";

/** What the user pastes in the PlugIns panel + the tokens that follow. */
export interface SpotifyClientConfig {
  clientId: string;
}

interface SpotifyTokenSet {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when accessToken expires. */
  expiresAt: number;
}

interface SpotifyStore extends SpotifyClientConfig, SpotifyTokenSet {
  /** Connected account readout. */
  displayName: string;
  /** "premium" | "free" — playback control requires Premium. */
  product: string;
}

const STORE_KEY = "neochat.spotify.v1";

let memStore: SpotifyStore | null = null;

function loadStore(): SpotifyStore | null {
  if (memStore) return memStore;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<SpotifyStore>;
    if (typeof p.clientId !== "string" || !p.clientId) return null;
    if (typeof p.accessToken !== "string" || !p.accessToken) return null;
    if (typeof p.refreshToken !== "string" || !p.refreshToken) return null;
    memStore = {
      clientId: p.clientId,
      accessToken: p.accessToken,
      refreshToken: p.refreshToken,
      expiresAt: typeof p.expiresAt === "number" ? p.expiresAt : 0,
      displayName: typeof p.displayName === "string" ? p.displayName : "",
      product: typeof p.product === "string" ? p.product : "",
    };
    return memStore;
  } catch {
    return null;
  }
}

function saveStore(s: SpotifyStore): void {
  memStore = s;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable — memory only */
  }
}

/** Display name of the connected account, or null. */
export function spotifyConnectedUser(): string | null {
  const s = loadStore();
  return s && s.displayName ? s.displayName : null;
}

/** "premium" | "free" | "" — used to warn before playback-control calls. */
export function spotifyProduct(): string {
  return loadStore()?.product ?? "";
}

export function hasSpotifyClientConfig(): boolean {
  return loadStore() !== null;
}

/* The Client ID is public (PKCE, no secret) — remember it across disconnects
 * so the setup panel can prefill it on reconnect. */

const CLIENT_ID_KEY = "neochat.spotify.clientId.v1";

export function spotifyRememberedClientId(): string {
  try {
    return localStorage.getItem(CLIENT_ID_KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberSpotifyClientId(id: string): void {
  try {
    localStorage.setItem(CLIENT_ID_KEY, id.trim());
  } catch {
    /* storage unavailable — forgettable */
  }
}

export function disconnectSpotify(): void {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* treat as disconnected */
  }
  memStore = null;
  void invoke("spotify_oauth_cancel").catch(() => undefined);
}

/* ── PKCE helpers ─────────────────────────────────────────────────────────── */

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomUrlSafe(byteLength = 32): string {
  const buf = new Uint8Array(byteLength);
  crypto.getRandomValues(buf);
  return base64UrlEncode(buf);
}

async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return base64UrlEncode(new Uint8Array(digest));
}

/* ── Token lifecycle ──────────────────────────────────────────────────────── */

async function tokenRequest(
  params: Record<string, string>
): Promise<SpotifyTokenSet & { scope?: string }> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    throw new Error(
      body.error_description ||
        body.error ||
        `Spotify token request failed (HTTP ${res.status}).`
    );
  }
  return {
    accessToken: body.access_token,
    // Refresh tokens can be omitted on refresh — keep the old one then.
    refreshToken: body.refresh_token || params.refresh_token || "",
    expiresAt: Date.now() + Math.max(60, Number(body.expires_in ?? 3600)) * 1000,
    scope: body.scope,
  };
}

/** Load a valid access token, refreshing it when it expires within 60s. */
async function validAccessToken(s: SpotifyStore): Promise<string> {
  if (s.expiresAt - Date.now() > 60_000) return s.accessToken;
  const tokens = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: s.refreshToken,
    client_id: s.clientId,
  });
  saveStore({ ...s, ...tokens });
  return tokens.accessToken;
}

/* ── Connect flow ─────────────────────────────────────────────────────────── */

/**
 * Verify the Client ID, open the consent screen in the OS browser, wait for
 * the loopback redirect, exchange the code for tokens, then persist
 * everything. Returns the connected account's display name.
 */
export async function connectSpotify(clientId: string): Promise<string> {
  const id = clientId.trim();
  if (!id) throw new Error("Enter the Client ID from your Spotify app.");

  const codeVerifier = randomUrlSafe(48);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const state = randomUrlSafe(16);

  // Bring up the loopback callback server before opening the browser.
  await invoke("spotify_oauth_listen");

  const authorize = new URL("https://accounts.spotify.com/authorize");
  authorize.search = new URLSearchParams({
    client_id: id,
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    state,
    scope: SPOTIFY_SCOPES.join(" "),
  }).toString();

  try {
    await openExternalUrl(authorize.toString());
  } catch (e) {
    void invoke("spotify_oauth_cancel").catch(() => undefined);
    throw e;
  }

  let code: string;
  try {
    const cb = await invoke<{ code?: string; state?: string; error?: string }>(
      "spotify_oauth_wait",
      { timeoutSec: 300 }
    );
    if (cb?.error) {
      throw new Error(
        cb.error === "access_denied"
          ? "Spotify sign-in was cancelled."
          : `Spotify sign-in failed: ${cb.error}`
      );
    }
    if (!cb?.code) throw new Error("Spotify sign-in returned no code — try again.");
    if (cb.state !== state) throw new Error("Spotify sign-in state mismatch — try again.");
    code = cb.code;
  } catch (e) {
    void invoke("spotify_oauth_cancel").catch(() => undefined);
    throw e;
  }

  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    client_id: id,
    code_verifier: codeVerifier,
  });

  // Identity readout + Premium/free hint for the panel and tool errors.
  // Best-effort: OAuth has already succeeded at this point (tokens are valid),
  // and Spotify intermittently 403s authenticated calls for Development Mode
  // apps with an empty body (backend issue — see the community thread
  // "Development Mode apps return 403 for GET /me"), so a failed readout must
  // not abort the connect.
  let displayName = "Spotify user";
  let product = "";
  try {
    const me = await api<{ display_name?: string; product?: string }>(
      { ...tokens, clientId: id, displayName: "", product: "" },
      "/me"
    );
    displayName = me.display_name || displayName;
    product = me.product || "";
  } catch {
    /* keep placeholders — playback calls still check devices per-request */
  }

  const store: SpotifyStore = { clientId: id, ...tokens, displayName, product };
  saveStore(store);
  return store.displayName;
}

/* ── API helpers (used by agentic.ts) ─────────────────────────────────────── */

async function api<T>(s: SpotifyStore, path: string, init?: RequestInit): Promise<T> {
  const token = await validAccessToken(s);
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...((init?.headers as Record<string, string>) ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as {
    error?: { status?: number; message?: string } | string;
  } | null;
  if (!res.ok) {
    const msg =
      typeof body?.error === "string" ? body.error : (body?.error?.message ?? `HTTP ${res.status}`);
    if (res.status === 401) {
      throw new Error("Spotify authorization expired — reconnect in the PlugIns panel.");
    }
    if (res.status === 404 && /device/i.test(msg)) {
      throw new Error(
        "No active Spotify device — open the Spotify app on a phone or desktop and start playing, then retry."
      );
    }
    if (res.status === 403 && /premium/i.test(msg)) {
      throw new Error("This action needs a Spotify Premium account.");
    }
    if (res.status === 403 && /scope/i.test(msg)) {
      throw new Error(
        "Spotify says the connection is missing a permission — disconnect and reconnect Spotify in the PlugIns panel."
      );
    }
    if (res.status === 403) {
      throw new Error(
        `Spotify denied the request (HTTP 403${msg && msg !== `HTTP ${res.status}` ? `: ${msg}` : ""}). ` +
          "If your app is in Development Mode, the account you signed in with must be listed under " +
          "Users and access in the Spotify developer dashboard. If it already is, Spotify has a known " +
          "intermittent 403 issue — wait a few minutes and retry."
      );
    }
    throw new Error(`Spotify API error: ${msg}`);
  }
  return body as T;
}

function store(): SpotifyStore {
  const s = loadStore();
  if (!s) {
    throw new Error("Spotify is not connected. Open the PlugIns panel, pick Spotify, and connect.");
  }
  return s;
}

export interface SpotifyTrack {
  uri: string;
  name: string;
  artists: string;
  album: string;
  durationMs: number;
}

interface RawTrack {
  uri?: string;
  name?: string;
  duration_ms?: number;
  artists?: Array<{ name?: string }>;
  album?: { name?: string };
}

function mapTrack(t: RawTrack): SpotifyTrack {
  return {
    uri: t.uri ?? "",
    name: t.name ?? "(unknown)",
    artists: (t.artists ?? []).map((a) => a.name ?? "").filter(Boolean).join(", "),
    album: t.album?.name ?? "",
    durationMs: Number(t.duration_ms ?? 0),
  };
}

/** Search the catalog for tracks. Free accounts included. */
export async function spotifySearch(query: string, limit = 5): Promise<SpotifyTrack[]> {
  const q = query.trim();
  if (!q) throw new Error("No search query provided.");
  const n = Math.max(1, Math.min(20, Math.round(limit) || 5));
  const res = await api<{ tracks?: { items?: RawTrack[] } }>(
    store(),
    `/search?${new URLSearchParams({ q, type: "track", limit: String(n) })}`
  );
  return (res.tracks?.items ?? []).map(mapTrack);
}

export interface SpotifyNowPlaying {
  isPlaying: boolean;
  track: SpotifyTrack | null;
  progressMs: number;
  deviceName: string;
  volumePercent: number | null;
}

/** Current playback snapshot (204 → nothing playing). */
export async function spotifyNowPlaying(): Promise<SpotifyNowPlaying> {
  const res = await api<{
    is_playing?: boolean;
    progress_ms?: number;
    item?: RawTrack | null;
    device?: { name?: string; volume_percent?: number | null };
  }>(store(), "/me/player");
  if (!res) {
    return { isPlaying: false, track: null, progressMs: 0, deviceName: "", volumePercent: null };
  }
  return {
    isPlaying: Boolean(res.is_playing),
    track: res.item ? mapTrack(res.item) : null,
    progressMs: Number(res.progress_ms ?? 0),
    deviceName: res.device?.name ?? "",
    volumePercent: typeof res.device?.volume_percent === "number" ? res.device.volume_percent : null,
  };
}

export type SpotifyPlaybackAction = "play" | "pause" | "next" | "previous" | "volume";

/**
 * Player commands. `play` may carry specific track URIs (from
 * spotifySearch); `volume` needs volumePercent 0-100. All player endpoints
 * require Premium + an active device.
 */
export async function spotifyPlayback(
  action: SpotifyPlaybackAction,
  opts: { uris?: string[]; volumePercent?: number } = {}
): Promise<void> {
  const s = store();
  switch (action) {
    case "play": {
      const body = opts.uris && opts.uris.length ? JSON.stringify({ uris: opts.uris }) : undefined;
      await api(s, "/me/player/play", { method: "PUT", body });
      return;
    }
    case "pause":
      await api(s, "/me/player/pause", { method: "PUT" });
      return;
    case "next":
      await api(s, "/me/player/next", { method: "POST" });
      return;
    case "previous":
      await api(s, "/me/player/previous", { method: "POST" });
      return;
    case "volume": {
      const v = Math.max(0, Math.min(100, Math.round(Number(opts.volumePercent ?? 50))));
      await api(s, `/me/player/volume?volume_percent=${v}`, { method: "PUT" });
      return;
    }
  }
}

/** Add one track to the play queue (URI from spotifySearch). */
export async function spotifyQueueTrack(uri: string): Promise<void> {
  const u = uri.trim();
  if (!u) throw new Error("No track URI provided.");
  await api(store(), `/me/player/queue?${new URLSearchParams({ uri: u })}`, { method: "PUT" });
}
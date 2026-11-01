/*
 * Google Calendar for Struct's agent — OAuth 2.0 against
 * the Google Calendar API.
 *
 * Shape mirrors src/gmail.ts: a credential/token store plus thin API helpers
 * that agentic.ts's executor calls.
 */

import { openExternalUrl } from "./lib/external";

/** OAuth redirect URI for Google Calendar consent flow. */
export const GOOGLE_CALENDAR_REDIRECT_URI = "http://127.0.0.1:43822/callback";

/** Scopes for read/write access to Google Calendar. */
export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar",
];

/** What the user pastes in the PlugIns panel. */
export interface CalendarClientConfig {
  clientId: string;
}

interface CalendarTokenSet {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when accessToken expires. */
  expiresAt: number;
}

interface CalendarStore extends CalendarClientConfig, CalendarTokenSet {
  /** Email or ID of the connected calendar. */
  calendarId: string;
  /** Display name of the connected account. */
  displayName: string;
}

const STORE_KEY = "neochat.calendar.v1";

let memStore: CalendarStore | null = null;

function loadStore(): CalendarStore | null {
  if (memStore) return memStore;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<CalendarStore>;
    if (typeof p.clientId !== "string" || !p.clientId) return null;
    if (typeof p.accessToken !== "string" || !p.accessToken) return null;
    if (typeof p.refreshToken !== "string" || !p.refreshToken) return null;
    memStore = {
      clientId: p.clientId,
      accessToken: p.accessToken,
      refreshToken: p.refreshToken,
      expiresAt: typeof p.expiresAt === "number" ? p.expiresAt : 0,
      calendarId: typeof p.calendarId === "string" ? p.calendarId : "primary",
      displayName: typeof p.displayName === "string" ? p.displayName : "",
    };
    return memStore;
  } catch {
    return null;
  }
}



/** Display name of the connected account, or null. */
export function calendarConnectedUser(): string | null {
  const s = loadStore();
  return s && s.displayName ? s.displayName : null;
}

/** "primary" | other calendar ID — used to determine which calendar to use. */
export function calendarProduct(): string {
  return loadStore()?.calendarId ?? "primary";
}

export function hasCalendarClientConfig(): boolean {
  return loadStore() !== null;
}

/** Must match GOOGLE_CALENDAR_OAUTH_PORT in electron/main.cjs and the URI
 * registered in the Google Cloud console (Settings → Redirect URIs).
 */
export function connectCalendar(cfg: CalendarClientConfig): Promise<string> {
  const clientId = cfg.clientId.trim();
  if (!clientId) throw new Error("Enter the Google Client ID.");
  // Open the OAuth consent screen in the OS browser
  const authUrl = new URL("https://accounts.google.com/o/oauth2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", GOOGLE_CALENDAR_REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", GOOGLE_CALENDAR_SCOPES.join(" "));
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  openExternalUrl(authUrl.toString());
  return Promise.resolve(clientId);
}

export function disconnectCalendar(): void {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* storage unavailable — treat as disconnected */
  }
  memStore = null;
}

/*
 * Gmail for Struct's agent — App Password auth + direct IMAP/SMTP via main.
 *
 * the user enables 2-Step Verification on
 * their Google account, creates an App Password, and pastes email + password
 * here. All protocol work (IMAP search/read, SMTP send) runs in the Electron
 * main process over TLS (node builtins) — the renderer never touches sockets.
 *
 * Shape mirrors src/mcp.ts: a small credential store plus thin API helpers
 * that agentic.ts's executor calls.
 */

import { invoke } from "./native";

/** What the user pastes in the PlugIns panel. Memory + localStorage (see below). */
export interface GmailClientConfig {
  email: string;
  appPassword: string;
}

/**
 * Credentials persist in localStorage so reconnecting is one click — same
 * trade-off as the MCP server store. This is a revocable App Password, not
 * the Google password; Disconnect wipes it.
 */
interface GmailStore extends GmailClientConfig {}

const STORE_KEY = "neochat.gmail.v1";

let memCreds: GmailClientConfig | null = null;

export function setGmailClientConfig(cfg: GmailClientConfig | null): void {
  const email = cfg ? cfg.email.trim() : "";
  const appPassword = cfg ? cfg.appPassword.replace(/\s+/g, "") : "";
  memCreds = email && appPassword ? { email, appPassword } : null;
}

export function hasGmailClientConfig(): boolean {
  return memCreds !== null;
}

function loadStore(): GmailStore | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GmailStore>;
    const email = typeof parsed.email === "string" ? parsed.email.trim() : "";
    const appPassword =
      typeof parsed.appPassword === "string" ? parsed.appPassword.replace(/\s+/g, "") : "";
    if (!email || !appPassword) return null;
    return { email, appPassword };
  } catch {
    return null;
  }
}

function saveStore(s: GmailStore): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(s));
}

function creds(): GmailStore {
  if (memCreds) return memCreds;
  const stored = loadStore();
  if (stored) {
    // Adopt into memory so later calls don't re-read storage.
    memCreds = stored;
    return stored;
  }
  throw new Error("Gmail is not connected. Open the PlugIns panel, pick Gmail, and sign in.");
}

export function gmailConnectedEmail(): string | null {
  if (memCreds) return memCreds.email;
  const stored = loadStore();
  return stored ? stored.email : null;
}

export function disconnectGmail(): void {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* storage unavailable — treat as disconnected */
  }
  memCreds = null;
}

/**
 * Verify email + App Password against Gmail (IMAP login probe) and persist.
 * Returns the account email on success; throws a human-readable error otherwise.
 */
export async function connectGmail(cfg: GmailClientConfig): Promise<string> {
  const email = cfg.email.trim();
  const appPassword = cfg.appPassword.replace(/\s+/g, "");
  if (!email || !appPassword) throw new Error("Enter the Gmail address and the App Password.");
  const res = await invoke<{ ok?: boolean; email?: string }>("mail_imap_check", {
    email,
    appPassword,
  });
  const connected = res && typeof res.email === "string" && res.email.trim() ? res.email.trim() : email;
  const store: GmailStore = { email: connected, appPassword };
  saveStore(store);
  memCreds = store;
  return connected;
}

export interface GmailMessageSummary {
  uid: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
}

/** Search mail (Gmail-ish syntax: free text, from:, newer_than:Nd) — newest first. */
export async function gmailSearch(query: string, maxResults = 10): Promise<GmailMessageSummary[]> {
  const c = creds();
  const list = await invoke<GmailMessageSummary[]>("mail_imap_search", {
    email: c.email,
    appPassword: c.appPassword,
    query: query.trim(),
    maxResults,
  });
  return Array.isArray(list) ? list : [];
}

export interface GmailMessageFull extends GmailMessageSummary {
  body: string;
  to: string;
}

/** Full message: headers + decoded body. */
export async function gmailRead(id: string): Promise<GmailMessageFull> {
  const uid = id.trim();
  if (!uid) throw new Error("No message id provided.");
  const c = creds();
  return invoke<GmailMessageFull>("mail_imap_read", {
    email: c.email,
    appPassword: c.appPassword,
    uid,
  });
}

/**
 * Send mail as the connected account. The sender is ALWAYS the authenticated
 * user — no From spoofing (main forces MAIL FROM to the login account).
 */
export async function gmailSend(to: string, subject: string, body: string): Promise<string> {
  if (!to.trim()) throw new Error("No recipient provided.");
  const c = creds();
  const res = await invoke<{ ok?: boolean; response?: string }>("mail_smtp_send", {
    email: c.email,
    appPassword: c.appPassword,
    to: to.trim(),
    subject,
    body,
  });
  if (res && typeof res.response === "string" && res.response) return res.response;
  return "sent";
}

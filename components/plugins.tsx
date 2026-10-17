import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { IoArrowBack, IoClose, IoExtensionPuzzle } from "react-icons/io5";
import { useErrorHandler } from "../src/errorContext";
import {
  connectGmail,
  disconnectGmail,
  gmailConnectedEmail,
  type GmailClientConfig,
} from "../src/gmail";
import {
  connectSpotify,
  disconnectSpotify,
  rememberSpotifyClientId,
  spotifyConnectedUser,
  spotifyProduct,
  spotifyRememberedClientId,
} from "../src/spotify";
import gmailIcon from "../src/assets/images/gmail.webp";
import robloxIcon from "../src/assets/images/roblox.webp";
import spotifyIcon from "../src/assets/images/spotify.webp";

interface Props {
  isOpen?: boolean;
  onClose?: () => void;
  /** Render the panel embedded in the Settings page instead of as a modal. */
  inline?: boolean;
}

type View = "picker" | "gmail" | "spotify";

/**
 * Plugins panel — the sidebar entry point for connecting the agent to external
 * services. Each tile opens its own setup view; Gmail signs in with an App
 * Password (2-Step Verification, no Cloud Console) over direct IMAP/SMTP.
 *
 * Portaled to document.body so it isn't clipped by the sidebar <aside>, which
 * is overflow-hidden and (with glass on) a backdrop-filter containing block.
 */
export default function PluginsPanel({ isOpen = false, onClose = () => {}, inline = false }: Props) {
  const { reportError } = useErrorHandler();
  const [view, setView] = useState<View>("picker");

  // ── Gmail setup state ───────────────────────────────────────────────
  const [gmail, setGmail] = useState<GmailClientConfig>({ email: "", appPassword: "" });
  const [gmailEmail, setGmailEmail] = useState<string | null>(null);
  const [gmailError, setGmailError] = useState("");
  const [gmailBusy, setGmailBusy] = useState(false);

  // ── Spotify setup state ───────────────────────────────────────────────
  const [spotifyClientId, setSpotifyClientId] = useState("");
  const [spotifyUser, setSpotifyUser] = useState<string | null>(null);
  const [spotifyPlan, setSpotifyPlan] = useState("");
  const [spotifyError, setSpotifyError] = useState("");
  const [spotifyBusy, setSpotifyBusy] = useState(false);

  // Reset the view and Gmail state whenever the panel opens (modal) or is
  // forced to render inline (e.g. inside the Settings panel).
  useEffect(() => {
    if (inline || isOpen) {
      setView("picker");
      setGmailError("");
      setGmailEmail(gmailConnectedEmail());
      setSpotifyError("");
      setSpotifyBusy(false);
      setSpotifyUser(spotifyConnectedUser());
      setSpotifyPlan(spotifyProduct());
      setSpotifyClientId(spotifyRememberedClientId());
    }
  }, [inline, isOpen]);

  // Escape closes only the modal form; an inline section doesn't consume keys.
  useEffect(() => {
    if (!inline && isOpen) {
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      };
      window.addEventListener("keydown", onKey, true);
      return () => window.removeEventListener("keydown", onKey, true);
    }
  }, [inline, isOpen, onClose]);

  if (!isOpen && !inline) return null;

  /** Verify the App Password against Gmail, then persist it. */
  const submitGmail = async () => {
    setGmailError("");
    if (!gmail.email.trim() || !gmail.appPassword.replace(/\s+/g, "")) {
      setGmailError("Enter the Gmail address and the 16-character App Password.");
      return;
    }
    setGmailBusy(true);
    try {
      const email = await connectGmail(gmail);
      setGmailEmail(email);
      setGmail({ email, appPassword: "" });
    } catch (e) {
      setGmailError(e instanceof Error ? e.message : String(e));
      reportError(e);
    } finally {
      setGmailBusy(false);
    }
  };

  const dropGmail = () => {
    disconnectGmail();
    setGmail({ email: "", appPassword: "" });
    setGmailEmail(null);
    setGmailError("");
  };

  /** Run the PKCE connect flow — opens the browser, waits for the callback. */
  const submitSpotify = async () => {
    setSpotifyError("");
    const id = spotifyClientId.trim();
    if (!id) {
      setSpotifyError("Paste your Spotify app's Client ID first.");
      return;
    }
    setSpotifyBusy(true);
    try {
      const name = await connectSpotify(id);
      rememberSpotifyClientId(id);
      setSpotifyUser(name);
      setSpotifyPlan(spotifyProduct());
    } catch (e) {
      setSpotifyError(e instanceof Error ? e.message : String(e));
      reportError(e);
    } finally {
      setSpotifyBusy(false);
    }
  };

  const dropSpotify = () => {
    disconnectSpotify();
    setSpotifyUser(null);
    setSpotifyPlan("");
    setSpotifyError("");
  };

  const content = view === "picker" ? (
    <div className="flex flex-col gap-2">
      <p className="m-0 mb-1 text-[11px] leading-4 text-[var(--text-muted)]">
        Each integration unlocks agent tools — e.g. Gmail adds search, read and send.
      </p>
      <button
        onClick={() => setView("gmail")}
        className="flex items-center gap-3 rounded-md border-(--border) bg-(--fill-1) px-3 py-2.5 text-left transition hover:bg-(--fill-2)"
      >
        <img src={gmailIcon} alt="" className="h-6 w-8 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium text-[var(--text-primary)]">
            Gmail
          </span>
          <span className="block truncate text-[10.5px] text-[var(--text-muted)]">
            {gmailEmail ? `Connected as ${gmailEmail}` : "Search, read and send email"}
          </span>
        </span>
        {gmailEmail && (
          <span className="shrink-0 rounded border-(--border-strong) px-1.5 py-px text-[9px] uppercase tracking-wide text-[var(--success)]">
            on
          </span>
        )}
      </button>
      <button
        onClick={() => setView("spotify")}
        className="flex items-center gap-3 rounded-md border-(--border) bg-(--fill-1) px-3 py-2.5 text-left transition hover:bg-(--fill-2)"
      >
        <img src={spotifyIcon} alt="" className="h-8 w-8 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium text-[var(--text-primary)]">
            Spotify
          </span>
          <span className="block truncate text-[10.5px] text-[var(--text-muted)]">
            {spotifyUser ? `Connected as ${spotifyUser}` : "Search, play and queue music"}
          </span>
        </span>
        {spotifyUser && (
          <span className="shrink-0 rounded border-(--border-strong) px-1.5 py-px text-[9px] uppercase tracking-wide text-[var(--success)]">
            Connected
          </span>
        )}
      </button>
      <button
        title="Coming soon"
        className="flex items-center gap-3 rounded-md border-(--border) bg-(--fill-2) px-3 py-2.5 text-left opacity-60 hover:bg-(--fill-3)"
      >
        <img src={robloxIcon} alt="" className="h-8 w-8 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium text-[var(--text-primary)]">
            Roblox Studios
          </span>
          <span className="block truncate text-[10.5px] text-[var(--text-muted)]">
            Visit the mcp section for roblox
          </span>
        </span>
      </button>
    </div>
  ) : view === "gmail" ? (
    <GmailSetup
      gmail={gmail}
      setGmail={setGmail}
      gmailEmail={gmailEmail}
      gmailError={gmailError}
      gmailBusy={gmailBusy}
      onConnect={() => void submitGmail()}
      onDisconnect={dropGmail}
    />
  ) : (
    <SpotifySetup
      clientId={spotifyClientId}
      setClientId={setSpotifyClientId}
      user={spotifyUser}
      plan={spotifyPlan}
      error={spotifyError}
      busy={spotifyBusy}
      onConnect={() => void submitSpotify()}
      onDisconnect={dropSpotify}
    />
  );

  // Inline mode (Settings page): flat section — no modal card, no Close
  // button, no backdrop. Gmail view gets a small back link instead.
  if (inline) {
    return (
      <div className="flex flex-col gap-3">
        {(view === "gmail" || view === "spotify") && (
          <button
            onClick={() => setView("picker")}
            className="flex w-fit items-center gap-1.5 rounded-md px-2 py-1 -ml-2 text-[11.5px] text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
          >
            <IoArrowBack size={12} />
            Plugins
          </button>
        )}
        {content}
      </div>
    );
  }

  const shell = (
    <div className="flex max-h-[82vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-(--border-strong) bg-[var(--bg-elevated)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-(--border) px-5 py-4">
        <div className="flex items-center gap-2">
          {(view === "gmail" || view === "spotify") ? (
            <button
              onClick={() => setView("picker")}
              aria-label="Back to plugins"
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
            >
              <IoArrowBack size={12} />
            </button>
          ) : (
            <IoExtensionPuzzle size={15} className="text-[var(--text-secondary)]" />
          )}
          <div>
            <h2 className="m-0 text-[14px] font-semibold text-[var(--text-primary)]">
              {view === "gmail" ? "Gmail" : view === "spotify" ? "Spotify" : "Plugins"}
            </h2>
            <p className="m-0 text-[11.5px] text-[var(--text-muted)]">
              {view === "gmail"
                ? gmailEmail
                  ? `Connected as ${gmailEmail}`
                  : "Connect the agent to Gmail"
                : view === "spotify"
                  ? spotifyUser
                    ? `Connected as ${spotifyUser}`
                    : "Connect the agent to Spotify"
                  : "Connect the agent to external services"}
            </p>
          </div>
        </div>
        <button
          onClick={() => onClose()}
          aria-label="Close"
          className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
        >
          <IoClose size={12} />
        </button>
      </div>
      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-5">{content}</div>
      {/* Footer */}
      <div className="flex items-center justify-between gap-2 border-t border-(--border) px-5 py-3">
        <span className="text-[10.5px] text-[var(--text-muted)]">
          {view === "gmail"
            ? "App Password · search + read + send"
            : view === "spotify"
              ? "OAuth PKCE · search + playback + queue"
              : "More integrations on the way"}
        </span>
        <button
          onClick={() => onClose()}
          className="rounded-md bg-(--fill-2) px-2.5 py-1 text-[11px] text-[var(--text-primary)] transition hover:bg-(--fill-3)"
        >
          Close
        </button>
      </div>
    </div>
  );

  return createPortal(
    <div
      className="dialog-backdrop fixed inset-0 z-[96] flex items-center justify-center bg-black/50 p-6"
      onClick={() => onClose()}
    >
      {shell}
    </div>,
    document.body
  );
}

interface GmailSetupProps {
  gmail: GmailClientConfig;
  setGmail: (g: GmailClientConfig) => void;
  gmailEmail: string | null;
  gmailError: string;
  gmailBusy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

const GMAIL_INPUT =
  "w-full rounded-md border border-(--border) bg-(--fill-1) px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none";

/** Gmail setup: App Password sign-in → connected readout. */
function GmailSetup(p: GmailSetupProps) {
  return (
    <div className="flex flex-col gap-3">
      {p.gmailEmail ? (
        <div className="flex items-center gap-2 rounded-md border border-(--border) bg-(--fill-1) px-3 py-2.5">
          <img src={gmailIcon} alt="" className="h-7 w-7 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-medium text-[var(--text-primary)]">
              {p.gmailEmail}
            </div>
            <div className="text-[10.5px] text-[var(--success)]">Agent can search, read and send</div>
          </div>
          <button
            onClick={p.onDisconnect}
            className="shrink-0 rounded border border-(--border-strong) px-2 py-1 text-[10.5px] text-[var(--text-secondary)] transition hover:bg-red-500/10 hover:text-[var(--danger)]"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <>
          <p className="m-0 text-[11px] leading-4 text-[var(--text-muted)]">
            No Cloud Console needed. Turn on{" "}
            <span className="font-medium">2-Step Verification</span> on the Google account, then
            create an <span className="font-medium">App Password</span> (Google Account → Security
            → App passwords) and paste it here with the Gmail address.
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">
              Gmail address
            </span>
            <input
              value={p.gmail.email}
              onChange={(e) => p.setGmail({ ...p.gmail, email: e.target.value })}
              placeholder="you@gmail.com"
              spellCheck={false}
              className={GMAIL_INPUT}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">App Password</span>
            <input
              type="password"
              value={p.gmail.appPassword}
              onChange={(e) => p.setGmail({ ...p.gmail, appPassword: e.target.value })}
              placeholder="16-character code (spaces are fine)"
              spellCheck={false}
              className={GMAIL_INPUT}
            />
          </label>
          <button
            onClick={p.onConnect}
            disabled={p.gmailBusy}
            className="flex items-center justify-center gap-1.5 rounded-md bg-(--fill-2) px-3 py-1.5 text-[12px] text-[var(--text-primary)] transition hover:bg-(--fill-3) disabled:opacity-50"
          >
            {p.gmailBusy ? "Connecting…" : "Connect Gmail"}
          </button>
        </>
      )}
      {p.gmailError && (
        <div className="rounded-md border border-(--danger) px-2.5 py-2 text-[11px] leading-4 text-[var(--danger)]">
          {p.gmailError}
        </div>
      )}
    </div>
  );
}

interface SpotifySetupProps {
  clientId: string;
  setClientId: (v: string) => void;
  user: string | null;
  /** "premium" | "free" | "" — playback control needs Premium. */
  plan: string;
  error: string;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

/**
 * Spotify setup: paste your own app's Client ID → PKCE consent in the OS
 * browser → connected readout. No client secret, no developer approval
 * needed; the redirect URI (http://127.0.0.1:43821/callback) is fixed and
 * must be registered in the Spotify dashboard app settings.
 */
function SpotifySetup(p: SpotifySetupProps) {
  return (
    <div className="flex flex-col gap-3">
      {p.user ? (
        <div className="flex items-center gap-2 rounded-md border border-(--border) bg-(--fill-1) px-3 py-2.5">
          <img src={spotifyIcon} alt="" className="h-7 w-7 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-medium text-[var(--text-primary)]">
              {p.user}
              {p.plan && (
                <span className="ml-1.5 text-[10.5px] font-normal text-[var(--text-muted)]">
                  {p.plan === "premium" ? "Premium" : "Free"}
                </span>
              )}
            </div>
            <div className="text-[10.5px] text-[var(--success)]">
              {p.plan === "premium"
                ? "Agent can search, control playback and queue"
                : p.plan === "free"
                  ? "Agent can search — playback control needs Premium"
                  : "Connected"}
            </div>
          </div>
          <button
            onClick={p.onDisconnect}
            className="shrink-0 rounded border border-(--border-strong) px-2 py-1 text-[10.5px] text-[var(--text-secondary)] transition hover:bg-red-500/10 hover:text-[var(--danger)]"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <>
          <p className="m-0 text-[11px] leading-4 text-[var(--text-muted)]">
            Create a free app at{" "}
            <span className="font-medium">developer.spotify.com/dashboard</span>, open its Settings
            and add{" "}
            <span className="font-medium">http://127.0.0.1:43821/callback</span> as a Redirect URI,
            then paste the Client ID below. Sign-in uses OAuth PKCE — no client secret, the
            consent screen opens in your browser.
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">Client ID</span>
            <input
              value={p.clientId}
              onChange={(e) => p.setClientId(e.target.value)}
              placeholder="32-character Client ID"
              spellCheck={false}
              className={GMAIL_INPUT}
            />
          </label>
          <button
            onClick={p.onConnect}
            disabled={p.busy}
            className="flex items-center justify-center gap-1.5 rounded-md bg-(--fill-2) px-3 py-1.5 text-[12px] text-[var(--text-primary)] transition hover:bg-(--fill-3) disabled:opacity-50"
          >
            {p.busy ? "Waiting for browser sign-in…" : "Connect Spotify"}
          </button>
        </>
      )}
      {p.error && (
        <div className="rounded-md border border-(--danger) px-2.5 py-2 text-[11px] leading-4 text-[var(--danger)]">
          {p.error}
        </div>
      )}
    </div>
  );
}

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
import gmailIcon from "../src/assets/images/gmail.svg";
import robloxIcon from "../src/assets/images/roblox.svg";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type View = "picker" | "gmail";

/**
 * Plugins panel — the sidebar entry point for connecting the agent to external
 * services. Each tile opens its own setup view; Gmail signs in with an App
 * Password (2-Step Verification, no Cloud Console) over direct IMAP/SMTP.
 *
 * Portaled to document.body so it isn't clipped by the sidebar <aside>, which
 * is overflow-hidden and (with glass on) a backdrop-filter containing block.
 */
export default function PluginsPanel({ isOpen, onClose }: Props) {
  const { reportError } = useErrorHandler();
  const [view, setView] = useState<View>("picker");

  // ── Gmail setup state ───────────────────────────────────────────────
  const [gmail, setGmail] = useState<GmailClientConfig>({ email: "", appPassword: "" });
  const [gmailEmail, setGmailEmail] = useState<string | null>(null);
  const [gmailError, setGmailError] = useState("");
  const [gmailBusy, setGmailBusy] = useState(false);

  // Refresh the connection readout each time the panel opens; reset to the
  // picker so a reopen never lands on a stale sub-view.
  useEffect(() => {
    if (isOpen) {
      setView("picker");
      setGmailError("");
      setGmailEmail(gmailConnectedEmail());
    }
  }, [isOpen]);


  // Escape closes — matches SettingsPanel/InfoPanel behaviour.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

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

  const body = (
    <div
      className="dialog-backdrop fixed inset-0 z-[96] flex items-center justify-center bg-black/50 p-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-[82vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-(--border-strong) bg-[var(--bg-elevated)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-(--border) px-5 py-4">
          <div className="flex items-center gap-2">
            {view === "gmail" ? (
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
                {view === "gmail" ? "Gmail" : "Plugins"}
              </h2>
              <p className="m-0 text-[11.5px] text-[var(--text-muted)]">
                {view === "gmail"
                  ? gmailEmail
                    ? `Connected as ${gmailEmail}`
                    : "Connect the agent to Gmail"
                  : "Connect the agent to external services"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
          >
            <IoClose size={12} />
          </button>
        </div>
        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {view === "picker" ? (
            <div className="flex flex-col gap-2">
              <p className="m-0 mb-1 text-[11px] leading-4 text-[var(--text-muted)]">
                Each integration unlocks agent tools — e.g. Gmail adds search, read and send.
              </p>
              <button
                onClick={() => setView("gmail")}
                className="flex items-center gap-3 rounded-md border border-(--border) bg-(--fill-1) px-3 py-2.5 text-left transition hover:bg-(--fill-2)"
              >
                <img src={gmailIcon} alt="" className="h-8 w-8 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-[var(--text-primary)]">
                    Gmail
                  </span>
                  <span className="block truncate text-[10.5px] text-[var(--text-muted)]">
                    {gmailEmail ? `Connected as ${gmailEmail}` : "Search, read and send email"}
                  </span>
                </span>
                {gmailEmail && (
                  <span className="shrink-0 rounded border border-(--border-strong) px-1.5 py-px text-[9px] uppercase tracking-wide text-[var(--success)]">
                    on
                  </span>
                )}
              </button>
              <button
                disabled
                title="Coming soon"
                className="flex cursor-not-allowed items-center gap-3 rounded-md border border-(--border) bg-(--fill-1) px-3 py-2.5 text-left opacity-60"
              >
                <img src={robloxIcon} alt="" className="h-8 w-8 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-[var(--text-primary)]">
                    Roblox
                  </span>
                  <span className="block truncate text-[10.5px] text-[var(--text-muted)]">
                    Coming soon
                  </span>
                </span>
              </button>
            </div>
          ) : (
            <GmailSetup
              gmail={gmail}
              setGmail={setGmail}
              gmailEmail={gmailEmail}
              gmailError={gmailError}
              gmailBusy={gmailBusy}
              onConnect={() => void submitGmail()}
              onDisconnect={dropGmail}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-(--border) px-5 py-3">
          <span className="text-[10.5px] text-[var(--text-muted)]">
            {view === "gmail" ? "App Password · search + read + send" : "More integrations on the way"}
          </span>
          <button
            onClick={onClose}
            className="rounded-md bg-(--fill-2) px-2.5 py-1 text-[11px] text-[var(--text-primary)] transition hover:bg-(--fill-3)"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
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

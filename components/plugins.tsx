
//If youre trying to change the string content from say one of the functions go 
// to i18n.ts to change it as i did this to maintain the multiple language compatibility and i apologize if its obscure 
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { IoArrowBack, IoClose, IoExtensionPuzzle} from "react-icons/io5";
import { useErrorHandler } from "../src/errorContext";
import { useTranslation } from "../src/i18n";
import {TbWorldWww} from "react-icons/tb";
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
import { connectCalendar, disconnectCalendar, calendarConnectedUser } from "../src/googleCalendar";
import { connectGitHub, disconnectGitHub, githubConnected } from "../src/github";
import gmailIcon from "../src/assets/images/gmail.webp";
import robloxIcon from "../src/assets/images/roblox.webp";
import spotifyIcon from "../src/assets/images/spotify.webp";
import googleIcon from "../src/assets/images/googlecalander.jpeg";
import githubIcon from "../src/assets/images/github.png";
interface Props {
  isOpen?: boolean;
  onClose?: () => void;
  /** Render the panel embedded in the Settings page instead of as a modal. */
  inline?: boolean;
  onOpenAiSettings?: () => void;
}

type View = "picker" | "gmail" | "spotify" | "calendar" | "github";


export default function PluginsPanel({ isOpen = false, onClose = () => {}, inline = false }: Props) {
  const { t } = useTranslation();
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

  const [calendarClientId, setCalendarClientId] = useState("");
  const [calendarUser, setCalendarUser] = useState<string | null>(null);
  const [calendarError, setCalendarError] = useState("");
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [githubToken, setGithubToken] = useState("");
  const [githubUser, setGithubUser] = useState<string | null>(null);
  const [githubError, setGithubError] = useState("");
  const [githubBusy, setGithubBusy] = useState(false);


  // Reset the view and Gmail state whenever the panel opens (modal) or is
  // forced to render inline (e.g. inside the Settings panel).
  useEffect(() => {
    if (inline || isOpen) {
      setView("picker");
      setGmailError("");
      setGmailEmail(gmailConnectedEmail());
      setSpotifyError("");
      setSpotifyBusy(false);
      setCalendarError("");
      setCalendarBusy(false);
      setCalendarUser(calendarConnectedUser());
      setGithubUser(githubConnected() ? "Connected" : null);
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
      setGmailError(t("plugins.gmailValidationError"));
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
      setSpotifyError(t("plugins.spotifyClientIdRequired"));
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

  const dropCalendar = () => {
    disconnectCalendar();
    setCalendarUser(null);
    setCalendarError("");
  };

  const submitCalendar = async () => {
    setCalendarError("");
    const id = calendarClientId.trim();
    if (!id) { setCalendarError(t("plugins.clientIdRequired")); return; }
    setCalendarBusy(true);
    try { setCalendarUser(await connectCalendar({ clientId: id })); }
    catch (e) { setCalendarError(e instanceof Error ? e.message : String(e)); reportError(e); }
    finally { setCalendarBusy(false); }
  };

  const submitGitHub = async () => {
    setGithubError(""); setGithubBusy(true);
    try { setGithubUser(await connectGitHub(githubToken)); setGithubToken(""); }
    catch (e) { setGithubError(e instanceof Error ? e.message : String(e)); reportError(e); }
    finally { setGithubBusy(false); }
  };
  const dropGitHub = () => { disconnectGitHub(); setGithubUser(null); setGithubError(""); };

  const content = view === "picker" ? (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 w-full items-start">
      {/* <p className="m-0 mb-1 text-[11px] leading-4 text-[var(--text-muted)]">
        //{t("plugins.eachUnlocks")}
      </p> */}
      <button
        onClick={() => setView("gmail")}
        className="flex items-center gap-3 rounded-md border-(--border) bg-(--fill-0) px-3 py-2.5 text-left transition hover:bg-(--fill-2) w-50"
      >
        <img src={gmailIcon} alt="" className="h-6 w-8 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium text-[var(--text-primary)]">
            Gmail
          </span>
          <span className="block truncate text-[10.5px] text-[var(--text-muted)]">
            {gmailEmail ? t("plugins.connectedAs", { name: gmailEmail }) : t("plugins.gmailBlurb")}
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
        className="flex items-center gap-3 rounded-md border-(--border) bg-(--fill-0) px-3 py-2.5 text-left transition hover:bg-(--fill-2) w-50"
      >
        <img src={spotifyIcon} alt="" className="h-8 w-8 shrink-0 rounded-2xl "/>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium text-[var(--text-primary)]">
            Spotify
          </span>
          <span className="block truncate text-[10.5px] text-[var(--text-muted)]">
            {spotifyUser ? t("plugins.connectedAs", { name: spotifyUser }) : t("plugins.spotifyBlurb")}
          </span>
        </span>
        {spotifyUser && (
          <span className="shrink-0 rounded border-(--border-strong) px-1.5 py-px text-[9px] uppercase tracking-wide text-[var(--success)]">
            Connected
          </span>
        )}
      </button>
      <button
        onClick={() => setView("github")}
        className="flex items-center gap-3 rounded-md border-(--border) bg-(--fill-0) px-3 py-2.5 text-left transition hover:bg-(--fill-2) w-50"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-(--fill-2) text-lg"><img src = {githubIcon} className = "h-7 w-7 shrink-0 rounded-2xl"></img></span>
        <span className="min-w-0 flex-1"><span className="block truncate text-[12.5px] font-medium text-[var(--text-primary)]">GitHub</span><span className="block truncate text-[10.5px] text-[var(--text-muted)]">Repos and issues</span></span>
        {githubUser && <span className="text-[9px] text-[var(--success)]">Connected</span>}
      </button>
       <button
        onClick={() => alert("Coming soon!")}
        className=" muted flex items-center gap-3 rounded-md border-(--border) bg-(--fill-0) px-3 py-2.5 text-left transition hover:bg-(--fill-2) w-50"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-(--fill-2) text-lg"><TbWorldWww size = {26}/></span>
        <span className="min-w-0 flex-1"><span className="block truncate text-[12.5px] font-medium text-[var(--text-primary)]">Browser</span><span className="block truncate text-[10.5px] text-[var(--text-muted)]">A browser inside struct</span></span>
      </button>
      <button
        onClick={() => setView("calendar")}
        className="flex items-center gap-3 rounded-md border-(--border) bg-(--fill-0) px-3 py-2.5 text-left transition hover:bg-(--fill-2) w-50"
      >
        <img src={googleIcon} alt="" className="h-8 w-8 shrink-0 rounded-lg" />
        <span className="min-w-0 flex-1"><span className="block truncate text-[12.5px] font-medium text-[var(--text-primary)]">Google Calendar</span><span className="block truncate text-[10.5px] text-[var(--text-muted)]">Manage your schedule</span></span>
        {calendarUser && <span className="text-[9px] text-[var(--success)]">Connected</span>}
      </button>
      <button
        title={t("plugins.comingSoon")}
        onClick ={()=>alert("Visit the mcp section inside the AI settings section")}
        className="flex items-center gap-3 rounded-md border-(--border) bg-(--fill-0) px-3 py-2.5 text-left opacity-60 hover:bg-(--fill-3) w-50"
      >
        <img src={robloxIcon} alt="" className="h-8 w-8 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium text-[var(--text-primary)]">
            Roblox Studios
          </span>
          <span className="block truncate text-[10.5px] text-[var(--text-muted)]">
            {t("plugins.robloxBlurb")}
          </span>
        </span>
      </button>
    </div>
  ) : view === "github" ? (
    <GitHubSetup token={githubToken} setToken={setGithubToken} user={githubUser} error={githubError} busy={githubBusy} onConnect={() => void submitGitHub()} onDisconnect={dropGitHub} />
  ) : view === "calendar" ? (
    <CalendarSetup clientId={calendarClientId} setClientId={setCalendarClientId} user={calendarUser} error={calendarError} busy={calendarBusy} onConnect={() => void submitCalendar()} onDisconnect={dropCalendar} />
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
        {(view === "gmail" || view === "spotify" || view === "calendar" || view === "github") && (
          <button
            onClick={() => setView("picker")}
            className="flex w-fit items-center gap-1.5 rounded-md px-2 py-1 -ml-2 text-[11.5px] text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
          >
            <IoArrowBack size={12} />
            {t("plugins.title")}
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
          {(view === "gmail" || view === "spotify" || view === "calendar" || view === "github") ? (
            <button
              onClick={() => setView("picker")}
              aria-label={t("plugins.backToPlugins")}
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
            >
              <IoArrowBack size={12} />
            </button>
          ) : (
            <IoExtensionPuzzle size={15} className="text-[var(--text-secondary)]" />
          )}
          <div>
            <h2 className="m-0 text-[14px] font-semibold text-[var(--text-primary)]">
              {view === "gmail" ? "Gmail" : view === "spotify" ? "Spotify" : view === "calendar" ? "Google Calendar" : view === "github" ? "GitHub" : t("plugins.title")}
            </h2>
            <p className="m-0 text-[11.5px] text-[var(--text-muted)]">
              {view === "gmail"
                ? gmailEmail
                  ? t("plugins.connectedAs", { name: gmailEmail })
                  : t("plugins.connectGmail")
                : view === "github"
                  ? githubUser ? t("plugins.connectedAs", { name: githubUser }) : "Connect the agent to GitHub"
                : view === "calendar"
                  ? calendarUser ? t("plugins.connectedAs", { name: calendarUser }) : t("plugins.connectCalendar")
                  : view === "spotify"
                  ? spotifyUser
                    ? t("plugins.connectedAs", { name: spotifyUser })
                    : t("plugins.connectSpotify")
                  : t("plugins.connectExternal")}
            </p>
          </div>
        </div>
        <button
          onClick={() => onClose()}
          aria-label={t("plugins.close")}
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
            ? t("plugins.gmailFooter")
            : view === "github" ? "GitHub API · repositories + issues"
            : view === "calendar" ? t("plugins.calendarHelp")
            : view === "spotify"
              ? t("plugins.spotifyFooter")
              : t("plugins.moreSoon")}
        </span>
        <button
          onClick={() => onClose()}
          className="rounded-md bg-(--fill-2) px-2.5 py-1 text-[11px] text-[var(--text-primary)] transition hover:bg-(--fill-3)"
        >
          {t("plugins.close")}
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

interface GitHubSetupProps { token: string; setToken: (v: string) => void; user: string | null; error: string; busy: boolean; onConnect: () => void; onDisconnect: () => void; }

function GitHubSetup(p: GitHubSetupProps) {
  return <div className="flex flex-col gap-3">
    <p className="m-0 text-[11px] leading-4 text-[var(--text-muted)]">Create a fine-grained token in GitHub Settings → Developer settings. Grant read access to repository metadata and issues; grant write access to issues only if you want the agent to create issues.</p>
    {p.user ? <div className="flex items-center gap-2 rounded-md border border-(--border) bg-(--fill-1) px-3 py-2.5"><span className="flex-1 text-[12px]">Connected as {p.user}</span><button onClick={p.onDisconnect}>{"Disconnect"}</button></div> : <><label className="flex flex-col gap-1"><span className="text-[11px]">Personal access token</span><input type="password" value={p.token} onChange={e => p.setToken(e.target.value)} className={GMAIL_INPUT} placeholder="github_pat_…" autoComplete="off" /></label><button onClick={p.onConnect} disabled={p.busy} className="rounded-md bg-(--fill-2) px-3 py-1.5 disabled:opacity-50">{p.busy ? "Connecting…" : "Connect GitHub"}</button></>}
    {p.error && <div className="text-[11px] text-[var(--danger)]">{p.error}</div>}
  </div>;
}

interface CalendarSetupProps { clientId: string; setClientId: (v: string) => void; user: string | null; error: string; busy: boolean; onConnect: () => void; onDisconnect: () => void; }

function CalendarSetup(p: CalendarSetupProps) {
  const { t } = useTranslation();
  return <div className="flex flex-col gap-3">
    <p className="m-0 text-[11px] leading-4 text-[var(--text-muted)]">{t("plugins.calendarHelp")}</p>
    {p.user ? <div className="flex items-center gap-2 rounded-md border border-(--border) bg-(--fill-1) px-3 py-2.5"><img src={googleIcon} alt="" className="h-7 w-7"/><span className="flex-1 text-[12px]">{p.user}</span><button onClick={p.onDisconnect}>{t("plugins.disconnect")}</button></div> : <><label className="flex flex-col gap-1"><span className="text-[11px]">{t("plugins.clientId")}</span><input value={p.clientId} onChange={e => p.setClientId(e.target.value)} className={GMAIL_INPUT} placeholder="Google OAuth Client ID" /></label><button onClick={p.onConnect} disabled={p.busy} className="rounded-md bg-(--fill-2) px-3 py-1.5 disabled:opacity-50">{p.busy ? t("plugins.connecting") : t("plugins.connect")}</button></>}
    {p.error && <div className="text-[11px] text-[var(--danger)]">{p.error}</div>}
  </div>;
}

/** Gmail setup: App Password sign-in → connected readout. */
function GmailSetup(p: GmailSetupProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      {p.gmailEmail ? (
        <div className="flex items-center gap-2 rounded-md border border-(--border) bg-(--fill-1) px-3 py-2.5">
          <img src={gmailIcon} alt="" className="h-7 w-7 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-medium text-[var(--text-primary)]">
              {p.gmailEmail}
            </div>
            <div className="text-[10.5px] text-[var(--success)]">{t("plugins.gmailCapability")}</div>
          </div>
          <button
            onClick={p.onDisconnect}
            className="shrink-0 rounded border border-(--border-strong) px-2 py-1 text-[10.5px] text-[var(--text-secondary)] transition hover:bg-red-500/10 hover:text-[var(--danger)]"
          >
            {t("plugins.disconnect")}
          </button>
        </div>
      ) : (
        <>
          <p className="m-0 text-[11px] leading-4 text-[var(--text-muted)]">
            {t("plugins.gmailHelp")}
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">
              {t("plugins.gmailAddress")}
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
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">{t("plugins.appPassword")}</span>
            <input
              type="password"
              value={p.gmail.appPassword}
              onChange={(e) => p.setGmail({ ...p.gmail, appPassword: e.target.value })}
              placeholder={t("plugins.appPasswordPlaceholder")}
              spellCheck={false}
              className={GMAIL_INPUT}
            />
          </label>
          <button
            onClick={p.onConnect}
            disabled={p.gmailBusy}
            className="flex items-center justify-center gap-1.5 rounded-md bg-(--fill-2) px-3 py-1.5 text-[12px] text-[var(--text-primary)] transition hover:bg-(--fill-3) disabled:opacity-50"
          >
            {p.gmailBusy ? t("plugins.connecting") : t("plugins.connectGmailButton")}
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
  const { t } = useTranslation();
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
                  {p.plan === "premium" ? t("plugins.premium") : t("plugins.free")}
                </span>
              )}
            </div>
            <div className="text-[10.5px] text-[var(--success)]">
              {p.plan === "premium"
                ? t("plugins.spotifyPremiumCap")
                : p.plan === "free"
                  ? t("plugins.spotifyFreeCap")
                  : t("plugins.connected")}
            </div>
          </div>
          <button
            onClick={p.onDisconnect}
            className="shrink-0 rounded border border-(--border-strong) px-2 py-1 text-[10.5px] text-[var(--text-secondary)] transition hover:bg-red-500/10 hover:text-[var(--danger)]"
          >
            {t("plugins.disconnect")}
          </button>
        </div>
      ) : (
        <>
          <p className="m-0 text-[11px] leading-4 text-[var(--text-muted)]">
            {t("plugins.spotifyHelp")}
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">{t("plugins.clientId")}</span>
            <input
              value={p.clientId}
              onChange={(e) => p.setClientId(e.target.value)}
              placeholder={t("plugins.clientIdPlaceholder")}
              spellCheck={false}
              className={GMAIL_INPUT}
            />
          </label>
          <button
            onClick={p.onConnect}
            disabled={p.busy}
            className="flex items-center justify-center gap-1.5 rounded-md bg-(--fill-2) px-3 py-1.5 text-[12px] text-[var(--text-primary)] transition hover:bg-(--fill-3) disabled:opacity-50"
          >
            {p.busy ? t("plugins.waitingBrowser") : t("plugins.connectSpotifyButton")}
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

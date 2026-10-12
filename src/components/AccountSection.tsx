/*
 * Author: madhusudhan
 * Check the LICENSE in the GitHub repo (https://github.com/Lumorix-studios/Struct) for more information on permissions to use this code.
 */


import { memo, useEffect, useState } from "react";
import { openExternalUrl as openUrl } from "../lib/external";
import {
  signInWithEmail,
  signUpWithEmail,
  signInWithOAuth,
  resetPassword,
  signOut,
  updateProfile,
  refreshEnabledProviders,
  checkSupabaseHealth,
  refreshSupabaseHealth,
  providerDisabledMessage,
  onAuthError,
  getLastAuthError,
  clearLastAuthError,
  AUTH_ERROR_EVENT,
  type EnabledProviders,
  type NeoUser,
  type Profile,
} from "../lib/auth";
import { isSupabaseConfigured } from "../lib/supabase";
import { deleteAllCloudData } from "../lib/cloudSync";
import { listen } from "../native";
import { IoLogoGithub, IoLogoGoogle, IoTrash, IoExit } from "react-icons/io5";

interface AccountSectionProps {
  account: NeoUser | null;
  profile: Profile | null;
  authLoading?: boolean;
  /** Ask the app to re-read the account/profile after profile edits. */
  onAccountRefresh: () => void;
}

type Mode = "sign-in" | "sign-up";

function providerName(provider: string | null | undefined): string {
  if (provider === "github") return "GitHub";
  if (provider === "google") return "Google";
  return "Email";
}

function memberSince(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/* ── Flat primitives ───────────────────────────────────────────────────────── */

const TEXT_BUTTON =
  "shrink-0 text-[11.5px] text-[var(--text-muted)] transition-colors hover:text-[var(--primary)] disabled:opacity-40";

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="divide-y divide-(--border) rounded-md border border-(--border) bg-(--fill-1)">
      {children}
    </div>
  );
}

function Row({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="text-[12.5px] text-[var(--text-primary)]">{title}</p>
        {description && (
          <p className="mt-0.5 text-[11px] leading-4 text-[var(--text-muted)]">{description}</p>
        )}
      </div>
      {children && <div className="flex shrink-0 items-center gap-3">{children}</div>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-[11px] text-[var(--text-muted)]">{children}</p>;
}

/* ── Account ───────────────────────────────────────────────────────────────── */

const AccountSection = memo(function AccountSection({
  account,
  profile,
  authLoading = false,
  onAccountRefresh,
}: AccountSectionProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const profileName = profile?.name ?? "";
  const [draft, setDraft] = useState({ name: profileName, from: profileName });
  if (draft.from !== profileName) setDraft({ name: profileName, from: profileName });
  const displayName = draft.name;

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied((c) => (c === label ? null : c)), 1600);
    } catch {
      /* Clipboard unavailable in this webview — ignore. */
    }
  };

  const saveName = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await updateProfile({ displayName: displayName.trim() });
      onAccountRefresh();
      setNotice("Profile saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const removeCloudData = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await deleteAllCloudData();
      setNotice("Synced data deleted from your account.");
      setDangerOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  if (!isSupabaseConfigured) {
    return (
      <p className="text-[11.5px] leading-5 text-[var(--text-muted)]">
        Cloud sync is not configured. Add <code>VITE_SUPABASE_URL</code> and{" "}
        <code>VITE_SUPABASE_ANON_KEY</code> to your <code>.env</code>, then restart the app — see{" "}
        <code>SUPABASE_SETUP.md</code>.
      </p>
    );
  }

  /* ── Signed in ─────────────────────────────────────────────────────────── */
  if (account) {
    const since = memberSince(profile?.createdAt);
    const dirty = displayName !== (profile?.name ?? "");
    const email = account.email;

    return (
      <div className="space-y-6">
        {(error || notice) && (
          <p
            className={`text-[11.5px] leading-4 ${
              error ? "text-red-400/90" : "text-[var(--text-muted)]"
            }`}
          >
            {error ?? notice}
          </p>
        )}

        <section>
          <SectionTitle>Account</SectionTitle>
          <Card>
            <Row title="Display name" description="Shown in the title bar and on synced devices.">
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDraft({ name: e.target.value, from: draft.from })}
                placeholder="Your name"
                spellCheck={false}
                className="h-7 w-40 rounded-md border border-(--border) bg-(--fill-2) px-2 text-[11.5px] text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-(--border-strong)"
              />
              <button
                type="button"
                disabled={!dirty || busy}
                onClick={() => void saveName()}
                className={`${TEXT_BUTTON} ${dirty ? "text-(--accent)" : ""}`}
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </Row>
            <Row title="Email" description="Used for sign-in, receipts and password recovery.">
              <span className="max-w-[190px] truncate text-[11.5px] text-[var(--text-secondary)]">
                {email || "—"}
              </span>
              {email && (
                <button
                  type="button"
                  onClick={() => void copyText(email, "email")}
                  className="shrink-0 text-[11.5px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-40"
                >

                  {copied === "email" ? "Copied" : "Copy"}
                </button>
              )}
            </Row>
            <Row title="Signed in with">
              <span className="text-[11.5px] text-[var(--text-secondary)]">
                {providerName(account.provider)}
              </span>
            </Row>
            {since && (
              <Row title="Member since">
                <span className="text-[11.5px] text-[var(--text-secondary)]">{since}</span>
              </Row>
            )}
            <Row title="Sign out" description="Local data on this device is kept.">
              <button type="button" onClick={() => void signOut()} className="shrink-0 text-[11.5px] text-[var(--text-muted)] transition-colors hover:text-red-500 disabled:opacity-40">
                <IoExit size={16}/>
              </button>
            </Row>
          </Card>
        </section>

        <section>
          <SectionTitle>Cloud data</SectionTitle>
          <Card>
            <Row
              title="Delete synced data"
              description="Erases chats, AI settings and encrypted API keys from your account. Device copies stay put."
            >
              {busy ? (
                <span className="text-[11.5px] text-[var(--text-muted)]">Deleting…</span>
              ) : dangerOpen ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      void removeCloudData();
                      alert("Cloud data deleted.");
                    }}
                    className="shrink-0 text-[11.5px] text-red-400/90 underline-offset-2 hover:underline"
                  >

                    Confirm delete
                    <></>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDangerOpen(false)}
                    className="shrink-0 text-[11.5px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-40"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setDangerOpen(true)} className="shrink-0 text-[11.5px] text-[var(--text-muted)] transition-colors hover:text-red-500 disabled:opacity-40">
                  <IoTrash size={16}/>
                </button>
              )}
            </Row>
          </Card>
          {dangerOpen && (
            <p className="mt-1.5 text-[10.5px] text-[var(--text-faint)]">
              This cannot be undone. Export anything important first.
            </p>
          )}
        </section>
      </div>
    );
  }

  if (authLoading) {
    return <p className="text-[11.5px] text-[var(--text-muted)]">Checking your session…</p>;
  }

  /* ── Signed out ────────────────────────────────────────────────────────── */
  if (!account) {
    return (
      <div className="space-y-6">
        <section>
          <SectionTitle>Locked</SectionTitle>
          <Card>
            <Row
              title="Account"
              description="Your profile, cloud data and provider keys are tied to a Struct account — sign in or create one to open them."
            />
          </Card>
        </section>
        <SignInUp />
      </div>
    );
  }
});

/* ── Signed-out form ───────────────────────────────────────────────────────── */

function SignInUp() {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [callbackError, setCallbackError] = useState<string | null>(() => getLastAuthError());
  const [healthError, setHealthError] = useState<string | null>(null);
  const [providers, setProviders] = useState<EnabledProviders | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    let alive = true;
    void refreshEnabledProviders().then((p) => {
      if (alive && p) setProviders(p);
    });
    // Startup probe: when the URL/key in .env is dead (rotated anon key,
    // paused project, offline…), EVERY method fails. Say so up front instead
    // of letting each button fail one by one.
    void checkSupabaseHealth().then((h) => {
      if (alive && !h.ok && h.message) setHealthError(h.message);
    });
    // OAuth / recovery deep-link failures are broadcast from the auth layer
    // (they happen outside this form). Show them here so "login always fails"
    // always comes with a reason.
    const off = onAuthError((msg) => {
      if (alive) setCallbackError(msg);
    });
    let unlisten: (() => void) | null = null;
    void listen<string>(AUTH_ERROR_EVENT, (e) => {
      if (alive) setCallbackError(typeof e.payload === "string" ? e.payload : String(e.payload));
    }).then((un) => {
      unlisten = un;
    });
    return () => {
      alive = false;
      off();
      try {
        unlisten?.();
      } catch {
        /* listener already gone */
      }
    };
  }, []);

  const runAuth = async (fn: () => Promise<unknown>, done?: (r: unknown) => void) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setCallbackError(null);
    setHealthError(null);
    clearLastAuthError();
    try {
      const result = await fn();
      done?.(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const recheckHealth = () => {
    setHealthError(null);
    void refreshSupabaseHealth().then((h) => {
      setHealthError(!h.ok && h.message ? h.message : null);
    });
    void refreshEnabledProviders().then((p) => {
      if (p) setProviders(p);
    });
  };

  const canSubmit = !busy && email.trim().length > 3 && password.length >= 6;

  const submit = () =>
    void runAuth(
      () =>
        mode === "sign-in"
          ? signInWithEmail(email.trim(), password)
          : signUpWithEmail(email.trim(), password),
      (r) => {
        const res = r as { needsEmailConfirmation?: boolean } | undefined;
        if (res?.needsEmailConfirmation) {
          setNotice("Check your inbox — confirm your email to finish signing up.");
        }
      }
    );

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
  };

  const reset = () =>
    void runAuth(() => resetPassword(email.trim()), () => setNotice("Password-reset email sent."));

  return (
    <div className="space-y-5">
      <div>
        <div className="flex gap-4 text-[12px]">
          {(["sign-in", "sign-up"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={
                mode === m
                  ? "text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
              }
            >
              {m === "sign-in" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] leading-4 text-[var(--text-muted)]">
          Sync chats, settings and encrypted API keys across your devices.
        </p>
      </div>

      {providers?.email === false && (
        <p className="text-[10.5px] leading-4 text-[var(--text-muted)]">
          Email sign-in is switched off for this Supabase project. Turn it on under Dashboard →
          Authentication → Sign In / Providers.
        </p>
      )}

      {healthError && (
        <p className="text-[11.5px] leading-5 text-red-400/90">
          {healthError}{" "}
          <button type="button" onClick={recheckHealth} className="underline underline-offset-2">
            Recheck
          </button>
        </p>
      )}

      <div className="space-y-2.5">
        <label className="block">
          <span className="mb-1 block text-[11px] text-[var(--text-muted)]">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            spellCheck={false}
            autoComplete="email"
            className="h-8 w-full rounded-md border border-(--border) bg-(--fill-1) px-2.5 text-[12px] text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-(--border-strong)"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] text-[var(--text-muted)]">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            className="h-8 w-full rounded-md border border-(--border) bg-(--fill-1) px-2.5 text-[12px] text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-(--border-strong)"
          />
        </label>
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          className="h-8 rounded-md px-3.5 text-[12px] font-medium transition disabled:opacity-40"
          style={{ background: "var(--accent)", color: "var(--on-accent)" }}
        >
          {busy ? "Working…" : mode === "sign-in" ? "Sign in" : "Create account"}
        </button>
        {mode === "sign-in" && (
          <button type="button" disabled={busy || !email.trim()} onClick={reset} className={TEXT_BUTTON}>
            Forgot password?
          </button>
        )}
      </div>

      {error && <p className="text-[11.5px] leading-4 text-red-400/90">{error}</p>}
      {callbackError && !error && (
        <p className="text-[11.5px] leading-4 text-red-400/90">
          Last sign-in attempt failed: {callbackError}
        </p>
      )}
      {notice && !error && !callbackError && (
        <p className="text-[11.5px] leading-4 text-[var(--text-muted)]">{notice}</p>
      )}

      <OAuthButtons
        busy={busy}
        runAuth={runAuth}
        providers={providers}
        onRecheck={() => {
          void refreshEnabledProviders().then((p) => {
            if (p) setProviders(p);
          });
        }}
      />

      <div>
        <button
          type="button"
          onClick={() => setInfoOpen((v) => !v)}
          aria-expanded={infoOpen}
          className="text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
        >
          {infoOpen ? "Hide OAuth status & help" : "OAuth status & help"}
        </button>
        {infoOpen && (
          <p className="mt-1.5 text-[11px] leading-5 text-[var(--text-muted)]">
            Google and GitHub OAuth may be down for maintenance — email and password sign-in always
            works. For enquiries, open an issue on the{" "}
            <a
              href="https://github.com/Lumorix-studios/Struct"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-[var(--text-secondary)]"
            >
              official repository
            </a>
            .
          </p>
        )}
      </div>
    </div>
  );
}

/* ── OAuth buttons (GitHub / Google) ───────────────────────────────────────── */

function OAuthButtons({
  busy,
  runAuth,
  providers,
  onRecheck,
}: {
  busy: boolean;
  runAuth: (fn: () => Promise<unknown>, done?: (r: unknown) => void) => Promise<void>;
  providers: EnabledProviders | null;
  onRecheck: () => void;
}) {
  const githubOff = providers?.github === false;
  const googleOff = providers?.google === false;
  const oauth = (provider: "github" | "google") => ({
    disabled: busy || (provider === "github" ? githubOff : googleOff),
    title:
      provider === "github"
        ? githubOff
          ? providerDisabledMessage("github")
          : "Continue with GitHub"
        : googleOff
          ? providerDisabledMessage("google")
          : "Continue with Google",
    onClick: () =>
      void runAuth(async () => {
        const url = await signInWithOAuth(provider);
        await openUrl(url);
      }),
  });

  const off = [githubOff ? "GitHub" : null, googleOff ? "Google" : null].filter(Boolean).join(" and ");

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          {...oauth("github")}
          className="flex h-8 items-center justify-center gap-2 rounded-md border border-(--border) text-[11.5px] text-[var(--text-secondary)] transition-colors hover:bg-(--fill-1) hover:text-[var(--text-primary)] disabled:opacity-40"
        >
          <IoLogoGithub size={13} />
          GitHub
        </button>
        <button
          type="button"
          {...oauth("google")}
          className="flex h-8 items-center justify-center gap-2 rounded-md border border-(--border) text-[11.5px] text-[var(--text-secondary)] transition-colors hover:bg-(--fill-1) hover:text-[var(--text-primary)] disabled:opacity-40"
        >
          <IoLogoGoogle size={12} />
          Google
        </button>
      </div>
      {off && (
        <p className="text-[10.5px] leading-4 text-[var(--text-muted)]">
          {off} sign-in is switched off in Supabase.{" "}
          <button type="button" onClick={onRecheck} className="underline underline-offset-2">
            Recheck
          </button>
        </p>
      )}
    </div>
  );
}

export default AccountSection;

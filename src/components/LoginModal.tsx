/* Login / sign-up modal. A standalone, full-screen modal so the auth form
 * no longer competes with the settings panel for attention. */

import { useState, useEffect, useCallback } from "react";
import { signInWithOAuth, signInWithEmail, signUpWithEmail, resetPassword, refreshEnabledProviders, checkSupabaseHealth, onAuthError, getLastAuthError, clearLastAuthError, AUTH_ERROR_EVENT } from "../lib/auth";
import { listen } from "../native";
import { IoClose, IoLogoGithub, IoLogoGoogle, IoEye, IoEyeOff } from "react-icons/io5";
import appIcon from "../assets/images/icon.jpeg";

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
}

type Mode = "sign-in" | "sign-up";

function ModalOverlay({ open, onClose, children }: { open: boolean; onClose: () => void; children?: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!open) return null;

  return (
    <div
      className="dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Sign in or create an account"
    >
      <div
        className="panel-in relative w-full max-w-[340px] rounded-lg border border-(--border-strong) bg-(--bg-panel) p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-md p-1 text-(--text-muted) transition hover:text-[var(--text-primary)]"
          aria-label="Close"
        >
          <IoClose size={18} />
        </button>
        {children}
      </div>
    </div>
  );
}

const TEXT_BUTTON =
  "shrink-0 rounded px-1 text-[11.5px] transition-colors " +
  "text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-40";

const INPUT_CLASS =
  "h-8 w-full rounded-md border border-(--border) bg-(--fill-1) px-2.5 text-[12px] " +
  "text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] " +
  "focus:border-(--border-strong)";

const LABEL_CLASS = "mb-1 block text-[11px] text-[var(--text-muted)]";

function OAuthButtons({
  busy,
  onOAuth,
  providers,
  onRecheck,
}: {
  busy: boolean;
  onOAuth: (provider: "github" | "google") => void;
  providers: Record<string, boolean> | null;
  onRecheck: () => void;
}) {
  const [checking, setChecking] = useState(false);

  const check = useCallback(() => {
    setChecking(true);
    void refreshEnabledProviders().then((p) => {
      setChecking(false);
      if (!p) return;
      if (!p.github && !p.google) {
        onRecheck();
      }
    });
  }, [onRecheck]);

  useEffect(() => {
    void check();
  }, [check]);

  return (
    <>
      <div className="flex flex-col gap-1.5">
        {providers?.github !== false && (
          <button
            type="button"
            disabled={busy || checking}
            onClick={() => onOAuth("github")}
            className="flex h-8 w-full items-center justify-center gap-2 rounded-md border border-(--border-strong) text-[12px] text-[var(--text-primary)] transition-colors hover:bg-(--fill-1) disabled:opacity-40"
          >
            <IoLogoGithub size={15} className="opacity-70" />
            {checking ? "Checking..." : "Continue with GitHub"}
          </button>
        )}
        {providers?.google !== false && (
          <button
            type="button"
            disabled={busy || checking}
            onClick={() => onOAuth("google")}
            className="flex h-8 w-full items-center justify-center gap-2 rounded-md border border-(--border-strong) text-[12px] text-[var(--text-primary)] transition-colors hover:bg-(--fill-1) disabled:opacity-40"
          >
            <IoLogoGoogle size={15} className="opacity-70" />
            {checking ? "Checking..." : "Continue with Google"}
          </button>
        )}
      </div>
      {(providers?.github === false || providers?.google === false) && (
        <p className="mt-2 text-[10.5px] leading-4 text-[var(--text-muted)]">
          {providers?.github === false && providers?.google === false
            ? "Email sign-in is the only available method. Use that below."
            : providers?.github === false
            ? "GitHub sign-in isn't enabled on this project — turn it on in Dashboard → Authentication → Sign In / Providers."
            : "Google sign-in isn't enabled on this project — turn it on in Dashboard → Authentication → Sign In / Providers."}
        </p>
      )}
    </>
  );
}

function SignInUpForm({
  mode,
  setMode,
  busy,
  error,
  notice,
  callbackError,
  healthError,
  providers,
  onSubmit,
  onReset,
  onOAuth,
  onRecheckProviders,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  busy: boolean;
  error: string | null;
  notice: string | null;
  callbackError: string | null;
  healthError: string | null;
  providers: Record<string, boolean> | null;
  onSubmit: (email: string, password: string) => void;
  onReset: (email: string) => void;
  onOAuth: (provider: "github" | "google") => void;
  onRecheckProviders: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [step, setStep] = useState<"email" | "password">("email");

  const emailOk = email.trim().length > 3;
  // Email step only needs a plausible email; password is required from there on.
  const canSubmit = !busy && emailOk && (step === "email" ? true : password.length >= 6);

  const submit = () => {
    if (step === "email") {
      if (!emailOk) return;
      setStep("password");
      return;
    }
    onSubmit(email, password);
  };

  const handleEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="space-y-3">
      {healthError && (
        <p className="text-[11.5px] leading-4 text-[var(--danger)]">{healthError}</p>
      )}
      {callbackError && !error && (
        <p className="text-[11.5px] leading-4 text-[var(--danger)]">{callbackError}</p>
      )}
      {notice && !error && !callbackError && (
        <p className="text-[11.5px] leading-4 text-[var(--text-muted)]">{notice}</p>
      )}

      {step === "email" ? (
        <div className="space-y-1">
          <div className="mb-2 flex items-center gap-2">
            <img src={appIcon} alt="Struct logo" className="h-5 w-5 shrink-0 rounded object-contain" />
            <p className="text-[11.5px] leading-4 text-[var(--text-muted)]">Log/Sign in to Struct</p>
          </div>
          <label className={LABEL_CLASS}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            className={INPUT_CLASS}
            onKeyDown={handleEnter}
            autoFocus
          />
        </div>
      ) : (
        <div className="space-y-1">
          <label className={LABEL_CLASS}>Password</label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "sign-in" ? "Your password" : "At least 6 characters"}
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              className={INPUT_CLASS + " pr-9"}
              onKeyDown={handleEnter}
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-(--text-muted) hover:text-[var(--text-primary)]"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <IoEyeOff size={16} /> : <IoEye size={16} />}
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          disabled={!canSubmit || busy}
          onClick={submit}
          className="h-8 flex-1 rounded-md bg-(--text-primary) text-[12px] font-medium text-(--bg-base) transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {step === "email"
            ? "Continue"
            : mode === "sign-in"
            ? "Sign in"
            : "Create account"}
        </button>
        {step === "password" && (
          <button
            type="button"
            disabled={busy || !email.trim()}
            onClick={() => onReset(email)}
            className={TEXT_BUTTON}
          >
            Forgot password?
          </button>
        )}
      </div>

      {error && <p className="text-[11.5px] leading-4 text-[var(--danger)]">{error}</p>}
      {!error && !callbackError && notice && (
        <p className="text-[11.5px] leading-4 text-[var(--text-muted)]">{notice}</p>
      )}

      <div className="my-3 h-[1px] bg-(--border)" />

      <OAuthButtons
        busy={busy}
        onOAuth={onOAuth}
        providers={providers}
        onRecheck={onRecheckProviders}
      />

      {step === "email" && (
        <p className="mt-3 text-[11px] text-[var(--text-muted)]">
          {mode === "sign-in"
            ? "Don't have an account? "
            : "Already have an account? "}
          <button
            type="button"
            onClick={() => {
              setMode(mode === "sign-in" ? "sign-up" : "sign-in");
              setStep("email");
              setPassword("");
            }}
            className="text-[var(--text-primary)] hover:underline"
          >
            {mode === "sign-in" ? "Create one" : "Sign in"}
          </button>
        </p>
      )}
    </div>
  );
}

export default function LoginModal({ open, onClose }: LoginModalProps) {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [callbackError, setCallbackError] = useState<string | null>(() => getLastAuthError());
  const [healthError, setHealthError] = useState<string | null>(null);
  const [providers, setProviders] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void refreshEnabledProviders().then((p) => {
      if (alive) setProviders(p ? {
        email: p.email, github: p.github, google: p.google
      } : null);
    });
    void checkSupabaseHealth().then((h) => {
      if (alive && !h.ok && h.message) setHealthError(h.message);
    });
    const off = onAuthError((msg) => {
      if (alive) setCallbackError(msg);
    });
    let unlisten: (() => void) | null = null;
    void listen<string>(AUTH_ERROR_EVENT, (e) => {
      if (alive) {
        setCallbackError(typeof e.payload === "string" ? e.payload : String(e.payload));
      }
    }).then((un) => {
      unlisten = un;
    });
    return () => {
      alive = false;
      off();
      try { unlisten?.(); } catch { /* ignore */ }
    };
  }, [open]);

  const clearErrors = useCallback(() => {
    setError(null);
    setNotice(null);
    setCallbackError(null);
    setHealthError(null);
    clearLastAuthError();
  }, []);

  const handleReset = useCallback((email: string) => {
    if (!email.trim()) return;
    setBusy(true);
    void resetPassword(email.trim()).then(
      () => {
        setNotice("Password-reset email sent.");
        setBusy(false);
      },
      (e) => {
        setError(e instanceof Error ? e.message : String(e));
        setBusy(false);
      }
    );
  }, []);

  const submit = useCallback((email: string, password: string) => {
    clearErrors();
    setBusy(true);
    if (mode === "sign-in") {
      void signInWithEmail(email.trim(), password.trim()).then(
        () => {
          setBusy(false);
          onClose();
        },
        (e) => {
          setError(e instanceof Error ? e.message : String(e));
          setBusy(false);
        }
      );
    } else {
      void signUpWithEmail(email.trim(), password.trim()).then(
        () => {
          setNotice("Check your inbox — confirm your email to finish signing up.");
          setBusy(false);
        },
        (e) => {
          setError(e instanceof Error ? e.message : String(e));
          setBusy(false);
        }
      );
    }
  }, [mode, clearErrors, onClose]);

  const handleOAuth = useCallback((provider: "github" | "google") => {
    clearErrors();
    setBusy(true);
    void signInWithOAuth(provider).then(
      (dataUrl) => {
        // `skipBrowserRedirect: true` means supabase-js does NOT navigate — we
        // must open the returned authorization URL ourselves. Use the
        // preload's `openExternal` (shell.openExternal in the main process),
        // which opens the provider's consent screen; the user is then
        // redirected back into the app via the `agenticcoder://auth/callback`
        // deep link and `handleOAuthRedirect` finishes the session.
        const opener = window.neoDesktop?.openExternal;
        if (typeof opener === "function") {
          void opener(dataUrl);
        } else {
          // Plain browser build fallback (OAuth deep link isn't registered
          // there, so desktop sign-in is what this app expects).
          window.open(dataUrl, "_blank", "noopener");
        }
        setBusy(false);
      },
      (e) => {
        setError(e instanceof Error ? e.message : String(e));
        setBusy(false);
      }
    );
  }, [clearErrors]);

  const handleSubmit = useCallback((email: string, password: string) => {
    submit(email, password);
  }, [submit]);

  const handleClose = useCallback(() => {
    clearErrors();
    onClose();
  }, [onClose, clearErrors]);

  return (
    <ModalOverlay open={open} onClose={handleClose}>
      <div className="flex flex-col gap-4">
        <h1 className="text-[13px] font-medium text-[var(--text-primary)]">
          {mode === "sign-in" ? "Sign in" : "Create an account"}
        </h1>

        <SignInUpForm
          mode={mode}
          setMode={setMode}
          busy={busy}
          error={error}
          notice={notice}
          callbackError={callbackError}
          healthError={healthError}
          providers={providers}
          onSubmit={handleSubmit}
          onReset={handleReset}
          onOAuth={handleOAuth}
          onRecheckProviders={() => void refreshEnabledProviders().then((p) => setProviders(p ? {
        email: p.email, github: p.github, google: p.google
      } : null))}
        />
      </div>
    </ModalOverlay>
  );
}

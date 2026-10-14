/*
 * Author: madhusudhan
 * Check the LICENSE in the GitHub repo (https://github.com/Lumorix-studios/Struct) for more information on permissions to use this code.
 */


import { memo, useState } from "react";
import { signOut, updateProfile, type NeoUser, type Profile } from "../lib/auth";
import { isSupabaseConfigured } from "../lib/supabase";
import { deleteAllCloudData } from "../lib/cloudSync";
import { IoTrash, IoExit } from "react-icons/io5";
import LoginModal from "./LoginModal";

interface AccountSectionProps {
  account: NeoUser | null;
  profile: Profile | null;
  authLoading?: boolean;
  /** Ask the app to re-read the account/profile after profile edits. */
  onAccountRefresh: () => void;
}

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
  const [loginOpen, setLoginOpen] = useState(false);

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
              error ? "text-[var(--danger)]" : "text-[var(--text-muted)]"
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
              <button type="button" onClick={() => void signOut()} className="shrink-0 text-[11.5px] text-[var(--text-muted)] transition-colors hover:text-[var(--danger)] disabled:opacity-40">
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
                    className="shrink-0 text-[11.5px] text-[var(--danger)] underline-offset-2 hover:underline"
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
                <button type="button" onClick={() => setDangerOpen(true)} className="shrink-0 text-[11.5px] text-[var(--text-muted)] transition-colors hover:text-[var(--danger)] disabled:opacity-40">
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
            >
              <button
                type="button"
                onClick={() => setLoginOpen(true)}
                className="h-7 rounded-md bg-(--text-primary) px-3 text-[12px] font-medium text-(--bg-base) transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                Sign in
              </button>
            </Row>
          </Card>
        </section>
        <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
      </div>
    );
  }
});
export default AccountSection;

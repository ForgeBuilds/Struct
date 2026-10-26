/*
 * Author: madhusudhan
 * Check the LICENSE in the GitHub repo (https://github.com/ForgeBuilds/Struct) for more information on permissions to use this code.
 */

import { memo, useState, type FormEvent } from "react";
import {
  signOut,
  updateProfile,
  type NeoUser,
  type Profile,
} from "../lib/auth";
import { isSupabaseConfigured } from "../lib/supabase";
import { deleteAllCloudData } from "../lib/cloudSync";
import { IoExit, IoLink, IoNavigate, IoTrash } from "react-icons/io5";
import LoginModal from "./LoginModal";
import { openExternalUrl } from "../lib/external";


interface AccountSectionProps {
  account: NeoUser | null;
  profile: Profile | null;
  authLoading?: boolean;
  /** Ask the app to re-read the account/profile after profile edits. */
  onAccountRefresh: () => void;
}

const FIELD_CLASS =
  "h-10 w-60 mt-2 mx-9.5 rounded-lg bg-(--fill-2) px-3 text-[13px] text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-(--border-strong)";

const TEXT_BUTTON =
  "inline-flex items-center justify-center gap-1.5 text-[12px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40";

function memberSince(value: string | null | undefined): string | null {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function AvatarPreview({
  src,
  fallback,
}: {
  src: string;
  fallback: string;
}) {
  const [failed, setFailed] = useState(false);

  if (src && !failed) {
    return (
      
      <img
        src={src}
        alt=""
        onError={() => setFailed(true)}
        className="mx-auto h-25 w-25 rounded-full border border-(--border) object-cover"
      />
      
    );
  }

  return (
    <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-(--border) bg-(--fill-2) text-2xl font-medium text-[var(--text-secondary)]">
      {fallback}
    </span>
  );
}

const AccountSection = memo(function AccountSection({
  account,
  profile,
  authLoading = false,
  onAccountRefresh,
}: AccountSectionProps) {
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);

  const profileName = profile?.name ?? account?.name ?? "";
  const profileAvatar = profile?.avatarUrl ?? account?.avatarUrl ?? "";
  const profileSource = `${profileName}\u0000${profileAvatar}`;

  const [draft, setDraft] = useState({
    name: profileName,
    avatarUrl: profileAvatar,
    from: profileSource,
  });

  // Reset edited values when a fresh profile is loaded.
  if (draft.from !== profileSource) {
    setDraft({
      name: profileName,
      avatarUrl: profileAvatar,
      from: profileSource,
    });
  }

  const dirty =
    draft.name !== profileName || draft.avatarUrl !== profileAvatar;

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const displayName = draft.name.trim();
    if (!displayName) {
      setError("Please enter a display name.");
      setNotice(null);
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      await updateProfile({
        displayName,
        avatarUrl: draft.avatarUrl.trim() || null,
      });

      onAccountRefresh();
      setNotice("Profile saved and synced to your Struct account.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const removeCloudData = async () => {
    setDeleting(true);
    setError(null);
    setNotice(null);

    try {
      await deleteAllCloudData();
      setDangerOpen(false);
      setNotice("Synced data deleted from your account.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };
//shouldnt appear in production builds as this should already have been configured but it is a good fallback if it isnt config
  if (!isSupabaseConfigured) {
    return (
      <p className="text-[12px] leading-5 text-[var(--text-muted)]">
        Cloud sync is not configured. Add <code>VITE_SUPABASE_URL</code> and{" "}
        <code>VITE_SUPABASE_ANON_KEY</code> to your <code>.env</code>, then
        restart the app. See <code>SUPABASE_SETUP.md</code>.
      </p>
    );
  }

  if (authLoading) {
    return (
      <p className="text-center text-[12px] text-[var(--text-muted)]">
        Checking your session…
      </p>
    );
  }

  if (!account) {
    return (
      <div className="mx-auto w-50 rounded-2xl bg-(--fill-0) p-5 text-center ">
        <p className="text-[13px] text-[var(--text-muted)]">
          Sign in /log in
        </p>
        <button
          type="button"
          onClick={() => setLoginOpen(true)}
          className="mt-2 h-6 rounded-lg bg-(--text-primary) px-4 text-[13px] font-medium text-(--bg-base) transition-opacity hover:opacity-90"
        >
          Sign in
        </button>
        <LoginModal
          open={loginOpen}
          onClose={() => setLoginOpen(false)}
        />
      </div>
    );
  }

  const initials = (draft.name.trim() || account.email || "A")
    .charAt(0)
    .toUpperCase();
  const since = memberSince(profile?.createdAt);

  return (
    <div className="mx-auto w-90 max-w-md space-y-4">
      {(error || notice) && (
        <p
          role={error ? "alert" : "status"}
          className={`text-center text-[12px] leading-5 ${
            error ? "text-[var(--danger)]" : "text-[var(--text-muted)]"
          }`}
        >
          {error ?? notice}
        </p>
      )}

      <div className="overflow-hidden rounded-2xl bg-(--fill-1)">
        <div className="px-6 pb-5 pt-8 text-center sm:px-8">
          <AvatarPreview
            key={draft.avatarUrl}
            src={draft.avatarUrl.trim()}
            fallback={initials}
          />

          <h2 className="mt-1 truncate text-[20px] font-medium text-[var(--text-primary)]">
            {draft.name || "Your account"}
          </h2>
          <p className=" truncate text-[13px] text-[var(--text-muted)]">
            {account.email || "No email address"}
          </p>
        </div>

        <form
          onSubmit={(event) => void saveProfile(event)}
          className="space-y-2 px-5 sm:px-6"
        >
          <label className="block">
            <span className="mb-1.5 mx-9.5 block text-[11px] text-[var(--text-muted)]">
              Display name
            </span>
            <input
              type="text"
              value={draft.name}
              onChange={(event) => {
                setNotice(null);
                setDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }));
              }}
              placeholder="Your name"
              maxLength={80}
              autoComplete="name"
              className={FIELD_CLASS}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 mx-9.5 block text-[11px] text-[var(--text-muted)]">
              PFP URL
            </span>
            <input
              type="url"
              value={draft.avatarUrl}
              onChange={(event) => {
                setNotice(null);
                setDraft((current) => ({
                  ...current,
                  avatarUrl: event.target.value,
                }));
              }}
              placeholder="https://example.com/photo.png"
              autoComplete="url"
              maxLength={2048}
              className={FIELD_CLASS}
            />
          </label>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={!dirty || saving || deleting}
              className="h-7 w-20 mx-30.5 mt-4 rounded-lg bg-(--text-primary) px-4 text-[13px] font-medium text-(--bg-base) transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </button>

            {dirty && (
              <button
                type="button"
                disabled={saving || deleting}
                onClick={() => {
                  setDraft({
                    name: profileName,
                    avatarUrl: profileAvatar,
                    from: profileSource,
                  });
                  setError(null);
                  setNotice(null);
                }}
                className={TEXT_BUTTON}
              >
                Discard
              </button>
            )}
          </div>
        </form>

        <div className="flex flex-col items-center gap-3 px-5 py-4 sm:flex-row sm:justify-between sm:px-6 mt-2">
          <p className="text-[11px] text-[var(--text-muted)]">
            Member since {since ?? "—"}
          </p>


          <button
            type="button"
            onClick={() => void signOut()}
            className={TEXT_BUTTON}
          >
            <IoExit size={15} aria-hidden="true" />
            Sign out
          </button>
          
        </div>
        <p className = "text-[10px] text-[var(--text-muted)] mx-6 mb-3">
          For settings regarding password resets visit the 
          <button onClick ={ () => openExternalUrl("https://forgebuilds.github.io/ForgeHQ/account")} className =   "inline-flex items-center justify-center gap-1.5 text-[10px] text-[var(--text-muted)] transition-colors hover:text-blue-500 disabled:cursor-not-allowed disabled:opacity-40 mx-1">
            {/* <IoLink size ={15} 
            className = "rounded-full"/>
            Visit */}
            Website 
            </button>
        </p>
      </div>

      <div className="rounded-xl bg-(--fill-1) px-4 py-4">
        {!dangerOpen ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[12px] text-[var(--text-primary)]">
                Synced data
              </p>
              <p className="mt-1 text-[11px] leading-4 text-[var(--text-muted)]">
                Delete synced chats, settings, and encrypted provider keys.
                Device copies stay put.
              </p>
            </div>

            <button
              type="button"
              disabled={saving || deleting}
              onClick={() => setDangerOpen(true)}
              className={`${TEXT_BUTTON} hover:text-[var(--danger)]`}
            >
              <IoTrash size={14} aria-hidden="true" />
              Delete
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[12px] leading-5 text-[var(--danger)]">
              This can’t be undone. Export anything important first.
            </p>
            <div className="flex items-center justify-end gap-4">
              <button
                type="button"
                disabled={deleting}
                onClick={() => void removeCloudData()}
                className="text-[12px] text-[var(--danger)] hover:underline disabled:opacity-40"
              >
                {deleting ? "Deleting…" : "Confirm delete"}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDangerOpen(false)}
                className={TEXT_BUTTON}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export default AccountSection;
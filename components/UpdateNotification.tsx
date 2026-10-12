import { invoke } from "../src/native";
import { openExternalUrl as openUrl } from "../src/lib/external";
import { useCallback, useState } from "react";
import { IoClose, IoDownload, IoOpenOutline } from "react-icons/io5";
import type { UpdateCheckResult } from "../src/lib/updateCheck";

interface UpdateNotificationProps {
  /** Latest release info from the last check. */
  result: UpdateCheckResult;
  /** Whether the running app is behind the latest release. */
  available: boolean;
  /** Dismiss the banner for the current version. */
  onDismiss: () => void;
}

function formatDate(iso?: string): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return null;
  }
}

export default function UpdateNotification({
  result,
  available,
  onDismiss,
}: UpdateNotificationProps) {
  const [downloading, setDownloading] = useState(false);
  const [launching, setLaunching] = useState(false);

  const release = result.release;
  const version = result.latestVersion;
  const date = formatDate(release.published_at);

  const handleDownload = useCallback(async () => {
    if (!available || !result.downloadUrl) return;
    setDownloading(true);
    try {
      const path = (await invoke<string>("download_file", {
        url: result.downloadUrl,
      })) as string;
      setDownloading(false);
      setLaunching(true);
      await invoke("launch_downloaded", { path });
      onDismiss();
    } catch (err) {
      setDownloading(false);
      // Tauri rejects `invoke` with the plain string returned by the Rust
      // command (not an Error), so normalise both shapes before matching.
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes("download failed") ||
        message.includes("server returned")
      ) {
        // The in-app download path failed — hand the user off to the release
        // page so they can still get the installer.
        try {
          await openUrl(release.html_url);
        } catch {
          /* ignore */
        }
      }
    } finally {
      setLaunching(false);
    }
  }, [available, result, release.html_url, onDismiss]);

  const handleOpenReleases = useCallback(async () => {
    try {
      await openUrl(release.html_url);
    } catch {
      /* ignore */;
    }
  }, [release.html_url]);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 mx-auto max-w-3xl px-4 py-3 sm:px-6 sm:py-4">
      <div className="flex items-start gap-3 rounded-lg border border-emerald-700/40 bg-emerald-950/80 p-3.5 shadow-[0_8px_24px_rgba(0,0,0,0.5)] backdrop-blur-sm">
        {/* Icon */}
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-800/60 text-emerald-300">
          <IoOpenOutline size={16} />
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] font-semibold uppercase tracking-wide text-emerald-300">
              Update available
            </span>
            <span className="flex h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
            <span className="text-[12.5px] font-medium text-[var(--text-primary)]">
              v{version}
            </span>
            {date && (
              <span className="text-[11px] text-[var(--text-muted)]">
                · {date}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--text-secondary)]">
            A newer version of Neo is ready to install.
          </p>
        </div>

        {/* Actions */}
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading || launching || !result.downloadUrl}
            className="flex h-7 items-center gap-1.5 rounded-md bg-emerald-700 px-2.5 py-1 text-[12px] font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-50 hover:bg-emerald-600"
          >
            {downloading && (
              <span className="flex h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            )}
            {launching ? (
              <span className="text-[12px]">Launching…</span>
            ) : downloading ? (
              <span className="text-[12px]">Downloading…</span>
            ) : (
              <>
                <IoDownload size={12} />
                <span>Install</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleOpenReleases}
            disabled={downloading || launching}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
            title="View release notes on GitHub"
          >
            <IoOpenOutline size={14} />
          </button>
          <button
            type="button"
            onClick={onDismiss}
            disabled={downloading || launching}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] transition hover:text-[var(--text-secondary)] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Dismiss"
          >
            <IoClose size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

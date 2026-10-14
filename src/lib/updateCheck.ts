/**
 * Shared update-check logic behind the in-app update notification banner and
 * the "Help → Check for Updates…" menu item.
 *
 * Talks to the GitHub Releases API for `Lumorix-studios/Struct` and compares the
 * locally running version against the latest published tag.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of the GitHub Releases API `latest` response. */
export interface ReleaseInfo {
  tag_name: string;
  published_at?: string;
  html_url: string;
  assets?: ReleaseAsset[];
}

export interface ReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

/** What `checkForUpdate` returns to the caller. */
export interface UpdateCheckResult {
  /** The latest version string from the feed, e.g. `"1.0.10"`. */
  latestVersion: string;
  /** Parsed release object from GitHub. */
  release: ReleaseInfo;
  /** True when the running app is older than the latest release. */
  isUpdateAvailable: boolean;
  /** Platform-specific download URL resolved from release assets, if any. */
  downloadUrl: string | null;
  /** Human-readable error string when the check itself fails. */
  error: string | null;
}

export interface AssetEntry {
  name: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** GitHub Releases API endpoint used by both the top bar and the updater. */
export const RELEASE_URL =
  "https://api.github.com/repos/Lumorix-studios/Struct/releases/latest";
export const RELEASES_PAGE = "https://github.com/Lumorix-studios/Struct/releases";
export const REPO_PAGE = "https://github.com/Lumorix-studios/Struct";

// ---------------------------------------------------------------------------
// Version helpers
// ---------------------------------------------------------------------------

/** Extract a `MAJOR.MINOR.PATCH` token from a GitHub tag like `v1.0.10`. */
export function parseVersion(tag: string): string {
  const match = tag.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : tag.replace(/^release[_v-]*/i, "");
}

/** Compare two semver strings — returns -1 / 0 / 1 like `cmp`. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// OS / asset helpers (kept in sync with the update notification UI so the
// banner and the download pick the same installer).
// ---------------------------------------------------------------------------

type OsKey = "windows" | "linux" | "macos" | "other";

function detectOs(): OsKey {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (ua.includes("Windows")) return "windows";
  if (ua.includes("Mac")) return "macos";
  if (ua.includes("Linux")) return "linux";
  return "other";
}

/** Pick the best platform-specific installer from a release's asset list. */
export function findPlatformAsset(
  assets: ReleaseAsset[],
): AssetEntry | null {
  const os = detectOs();
  if (os === "windows") {
    const exe = assets.find((a) => a.name.toLowerCase().endsWith(".exe"));
    if (exe) return { name: exe.name, url: exe.browser_download_url };
    const msi = assets.find((a) => a.name.toLowerCase().endsWith(".msi"));
    if (msi) return { name: msi.name, url: msi.browser_download_url };
  }
  if (os === "macos") {
    const dmg = assets.find((a) => a.name.toLowerCase().endsWith(".dmg"));
    if (dmg) return { name: dmg.name, url: dmg.browser_download_url };
  }
  if (os === "linux") {
    const deb = assets.find((a) => a.name.toLowerCase().endsWith(".deb"));
    if (deb) return { name: deb.name, url: deb.browser_download_url };
    const rpm = assets.find((a) => a.name.toLowerCase().endsWith(".rpm"));
    if (rpm) return { name: rpm.name, url: rpm.browser_download_url };
  }
  // Unknown OS, or the platform-specific lookup found nothing: fall back to
  // the first installer-shaped asset so the user still has something to grab.
  const fallback = assets.find((a) => /\.(exe|msi|dmg|deb|rpm)$/i.test(a.name));
  return fallback
    ? { name: fallback.name, url: fallback.browser_download_url }
    : null;
}

// ---------------------------------------------------------------------------
// Persistent "dismissed until" marker
// ---------------------------------------------------------------------------

const STORAGE_KEY_DISMISSED = "neo:update:dismissed-until";

/** The version the user dismissed, or `null` if they never dismissed one.
 *  Used on startup so a released-but-dismissed version does not nag again. */
export function dismissedUntil(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY_DISMISSED);
}

/** Remember the version the user dismissed — they won't be prompted again
 *  until a strictly newer release appears. */
export function setDismissedUntil(version: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_DISMISSED, version);
  } catch {
    /* quota / private mode — best-effort */;
  }
}

/** Clear the dismissed-until marker. Used when the user manually triggers a
 *  check from the Help menu — we want to re-prompt even if they previously
 *  dismissed an older release. */
export function clearDismissedUntil(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY_DISMISSED);
  } catch {
    /* best-effort */;
  }
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

/** Result of comparing the locally running version against the latest GitHub
 *  release. Callers should treat `error` as "no conclusion" — network failures
 *  must not be mistaken for "no update available". */
export async function checkForUpdate(
  currentVersion: string,
): Promise<UpdateCheckResult> {
  try {
    const response = await fetch(RELEASE_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });

    if (!response.ok) {
      return {
        latestVersion: currentVersion,
        release: makeEmptyRelease(currentVersion),
        isUpdateAvailable: false,
        downloadUrl: null,
        error: `Releases service returned ${response.status} ${response.statusText}`,
      };
    }

    const release = (await response.json()) as ReleaseInfo;
    const latest = parseVersion(release.tag_name);
    const available = compareVersions(currentVersion, latest) < 0;
    const entry = available ? findPlatformAsset(release.assets ?? []) : null;

    return {
      latestVersion: latest,
      release,
      isUpdateAvailable: available,
      downloadUrl: entry?.url ?? null,
      error: null,
    };
  } catch (err) {
    return {
      latestVersion: currentVersion,
      release: makeEmptyRelease(currentVersion),
      isUpdateAvailable: false,
      downloadUrl: null,
      error:
        err instanceof Error ? err.message : "Could not check for updates.",
    };
  }
}

function makeEmptyRelease(version: string): ReleaseInfo {
  return {
    tag_name: `v${version}`,
    published_at: undefined,
    html_url: REPO_PAGE,
    assets: [],
  };
}


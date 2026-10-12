/*
 * Author: madhusudhan
 * Check the LICENSE in the GitHub repo (https://github.com/Lumorix-studios/Struct) for more information on permissions to use this code.
 */
import { useEffect } from "react";
import { broadcastAuthError, handleOAuthRedirect } from "./auth";

/** Deep-link scheme registered as the OS protocol handler (agenticcoder://). */
const SCHEME = "agenticcoder://";

/** Event emitted by the Electron single-instance handler for a second launch. */
const SINGLE_INSTANCE_EVENT = "neo:deep-link";

/**
 * URLs already handed to the auth layer. On Windows/Linux the same link can
 * arrive twice (the `deep-link://new-url` event *and* our single-instance
 * event), and OAuth codes/tokens are single-use — replaying them would just
 * produce a confusing error.
 */
const consumed = new Set<string>();

/**
 * Feed one raw URL to the auth layer when it looks like an OAuth callback.
 * `getCurrent()` also reports the URL the app was *launched* with, and the
 * session exchange is idempotent, so duplicate delivery is harmless.
 */
function consume(url: string): void {
  if (!url.startsWith(SCHEME)) return;
  if (consumed.has(url)) return;
  consumed.add(url);
  // `handleOAuthRedirect` never rejects (it broadcasts + returns on failure),
  // but a broken deep-link subscription itself would still be silent — surface
  // unexpected throws so a missing plugin / bad URL never looks like "login
  // always fails" with no message.
  void handleOAuthRedirect(url).catch((e: unknown) =>
    broadcastAuthError(e instanceof Error ? e.message : String(e)).catch(() => undefined)
  );
}

/**
 * VS Code style sign-in plumbing: listen for `agenticcoder://auth/callback#…`
 * URLs that the OS hands back after the user authorises in the browser, and
 * complete the Supabase session. No-op in a plain browser (dev preview).
 */
export function useDeepLinkAuth(): void {
  useEffect(() => {
    if (!window.neoDesktop) return;
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    // Cold start from a deep link, plus live links while the app is open.
    // The preload exposes `onDeepLink` (single-instance forwards here) and
    // re-broadcasts OS links over the `neo:deep-link` event channel.
    const offLink = window.neoDesktop.onDeepLink((url) => {
      if (!disposed) consume(url);
    });
    unlisteners.push(offLink);
    void window.neoDesktop
      .listen<string>(SINGLE_INSTANCE_EVENT, (e) => consume(e.payload))
      .then((off) => {
        if (disposed) {
          off();
          return;
        }
        unlisteners.push(off);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      for (const off of unlisteners) {
        try {
          off();
        } catch {
          /* listener already gone */
        }
      }
    };
  }, []);
}
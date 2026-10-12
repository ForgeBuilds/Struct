// Single native bridge. Electron owns the window; the preload exposes
// `window.neoDesktop.invoke`. Everything else falls back to plain fetch so
// the UI also runs in a browser preview.
export function invoke<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (window.neoDesktop) return window.neoDesktop.invoke<T>(command, args);
  return Promise.reject(new Error(`Native command unavailable outside Electron: ${command}`));
}

export function isNativeRuntime(): boolean {
  return Boolean(window.neoDesktop);
}


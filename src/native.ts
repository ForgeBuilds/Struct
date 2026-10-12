import { invoke as tauriInvoke } from "@tauri-apps/api/core";

/** Route native commands to Electron when it owns the window, otherwise Tauri. */
export function invoke<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (window.neoDesktop) return window.neoDesktop.invoke<T>(command, args);
  return tauriInvoke<T>(command, args);
}

export function isNativeRuntime(): boolean {
  return Boolean(
    window.neoDesktop ||
      (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
  );
}

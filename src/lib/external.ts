/** Open a URL in the OS browser (Electron shell) or a new tab (browser). */
export async function openExternalUrl(url: string): Promise<void> {
  if (window.neoDesktop) {
    await window.neoDesktop.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

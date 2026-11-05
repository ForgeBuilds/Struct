export interface BrowserPreviewTab {
  id: string;
  url: string;
}

export function normalizeBrowserPreviewUrl(input: string): string {
  const value = input.trim();
  if (!value) throw new Error("Enter a website URL.");
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(value)
    ? value
    : `${/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(value) ? "http" : "https"}://${value}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("Enter a valid website URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS pages can be previewed.");
  }
  if (url.username || url.password) throw new Error("URLs with embedded credentials are not supported.");
  return url.toString();
}

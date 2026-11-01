const STORE_KEY = "struct.github.token.v1";

function token(): string {
  try {
    const value = localStorage.getItem(STORE_KEY)?.trim();
    if (value) return value;
  } catch { /* storage unavailable */ }
  throw new Error("GitHub is not connected. Open the Plugins panel and connect GitHub.");
}

export function githubConnected(): boolean {
  try { return Boolean(localStorage.getItem(STORE_KEY)?.trim()); } catch { return false; }
}

export async function connectGitHub(value: string): Promise<string> {
  const t = value.trim();
  if (!t) throw new Error("Enter a GitHub personal access token.");
  const response = await fetch("https://api.github.com/user", { headers: headers(t) });
  if (!response.ok) throw new Error(await apiError(response));
  const user = await response.json() as { login?: string };
  if (!user.login) throw new Error("GitHub did not return an account name.");
  localStorage.setItem(STORE_KEY, t);
  return user.login;
}

export function disconnectGitHub(): void {
  try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
}

function headers(accessToken = token()): HeadersInit {
  return { Accept: "application/vnd.github+json", Authorization: `Bearer ${accessToken}`, "X-GitHub-Api-Version": "2022-11-28" };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, { ...init, headers: { ...headers(), ...init?.headers } });
  if (!response.ok) throw new Error(await apiError(response));
  return response.json() as Promise<T>;
}

async function apiError(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  return `GitHub API error (HTTP ${response.status})${body ? `: ${body.slice(0, 400)}` : ""}`;
}

export async function githubRepos(): Promise<Array<{ full_name: string; description: string | null; private: boolean; html_url: string }>> {
  return request("/user/repos?sort=updated&per_page=30");
}

export async function githubIssues(owner: string, repo: string, state = "open"): Promise<Array<{ number: number; title: string; state: string; html_url: string; user: { login: string }; updated_at: string }>> {
  return request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?state=${encodeURIComponent(state)}&per_page=30`);
}

export async function githubCreateIssue(owner: string, repo: string, title: string, body = ""): Promise<{ number: number; html_url: string }> {
  if (!title.trim()) throw new Error("Issue title is required.");
  return request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title.trim(), body }) });
}

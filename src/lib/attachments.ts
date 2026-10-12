/**
 * Shared attachment helpers for the chat composers (main chat + agent panel).
 * Lets users attach files/folders from PromptBar's source menu and inlines
 * their contents so the model can analyze them even without agent tools.
 */
import { invoke } from "../native";

const MAX_FILE_CHARS = 40_000;
const MAX_TOTAL_CHARS = 160_000;

/** File-picker for PromptBar's "Photos & files" source. */
export async function pickFiles(): Promise<string[]> {
  try {
    if (!window.neoDesktop) return [];
    const picked = await window.neoDesktop.openDialog({ multiple: true, directory: false });
    if (!picked) return [];
    return Array.isArray(picked) ? picked : [picked];
  } catch {
    return [];
  }
}

/** Folder-picker for PromptBar's "Folder" source. */
export async function pickFolder(): Promise<string[]> {
  try {
    if (!window.neoDesktop) return [];
    const picked = await window.neoDesktop.openDialog({ multiple: false, directory: true });
    if (!picked) return [];
    return Array.isArray(picked) ? picked : [picked];
  } catch {
    return [];
  }
}

type FsEntry = { name?: string; path?: string; is_dir?: boolean; dir?: boolean };

function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n[... truncated — ${s.length - max} characters omitted ...]`;
}

/**
 * Turn PromptBar's attachment paths into a context block appended to the
 * outgoing message. Files are inlined (truncated to fit a shared budget),
 * folders become a directory listing — in agent mode the model can follow
 * up with read_file / list_dir on the same paths.
 * Returns "" when there is nothing to attach.
 */
export async function buildAttachmentContext(paths: string[]): Promise<string> {
  if (paths.length === 0) return "";
  const parts: string[] = [];
  let budget = MAX_TOTAL_CHARS;
  let handled = 0;

  for (const path of paths) {
    handled += 1;
    if (budget <= 0) {
      parts.push(`_Attachment budget reached — ${paths.length - handled + 1} more item(s) omitted._`);
      break;
    }
    // Try as a text file first; fall back to a folder listing, then binary.
    try {
      const content = await invoke<string>("fs_read_file", { path });
      const body = truncate(content, Math.min(MAX_FILE_CHARS, budget));
      budget -= body.length;
      parts.push(`### File: \`${path}\`\n\`\`\`\n${body}\n\`\`\``);
      continue;
    } catch {
      /* not readable text — maybe a folder or a binary file */
    }
    try {
      const entries = await invoke<FsEntry[]>("fs_list_dir", { path });
      const lines = entries
        .map((e) => {
          const name = e.name ?? baseName(e.path ?? "");
          const isDir = e.is_dir ?? e.dir ?? false;
          return `- ${isDir ? "[dir]" : "[file]"} ${name}`;
        })
        .join("\n");
      const block = `### Folder: \`${path}\`\n${
        lines || "(empty folder)"
      }\n\nUse \`list_dir\` / \`read_file\` on these paths to inspect contents on demand.`;
      const clipped = truncate(block, Math.min(budget, 8_000));
      budget -= clipped.length;
      parts.push(clipped);
      continue;
    } catch {
      /* binary / unreadable — fall through */
    }
    const note = `### Attachment: \`${path}\`\n(Binary or unreadable as text — the path is available to agent tools.)`;
    budget -= note.length;
    parts.push(note);
  }

  if (parts.length === 0) return "";
  return `## Attached files & folders\n\n${parts.join("\n\n")}`;
}

const COMMAND_EXPANSIONS: Record<string, string> = {
  summarize: "Summarize the conversation so far into a concise digest.",
  compare: "Compare the two most recent options side by side in a table.",
  draft: "Write a first draft of what was just discussed.",
  explain: "Explain the last answer in plain language, step by step.",
  tasks: "Turn the discussion into a numbered to-do list with clear next actions.",
};

/** Expand PromptBar's `/command` prefixes into real instructions; unknown
 *  commands (e.g. `/help`) are left untouched. */
export function expandCommand(text: string): string {
  const m = /^\s*\/([\w-]+)\b([\s\S]*)$/.exec(text);
  if (!m) return text;
  const expansion = COMMAND_EXPANSIONS[m[1].toLowerCase()];
  if (!expansion) return text;
  const rest = m[2].trim();
  return rest ? `${expansion}\n${rest}` : expansion;
}
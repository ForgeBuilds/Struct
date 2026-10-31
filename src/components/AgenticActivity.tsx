/*
 * Author: madhusudhan
 * Check the LICENSE in the GitHub repo (https://github.com/Lumorix-studios/Struct) for more information on permissions to use this code.
 */
import { useEffect, useState } from "react";
import type { AgenticActivity as AgenticActivityType, FsEntry, WebSearchResult } from "../agentic";
import { TOOL_LABELS } from "../agentic";
import { IoAlertCircleOutline, IoCheckmarkOutline, IoChevronForward } from "react-icons/io5";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  CommandLineIcon,
  BrowserIcon,
  CodeIcon,
  Delete02Icon,
  Edit02Icon,
  File01Icon,
  Folder01Icon,
  GlobeIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { useTranslation } from "../i18n";

interface AgenticActivityProps {
  items: AgenticActivityType[];
  pending: AgenticActivityType | null;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}

function toolName(tool: string): string {
  return TOOL_LABELS[tool as keyof typeof TOOL_LABELS] ?? tool;
}

function duration(ms: number | undefined): string {
  if (ms == null) return "";
  return `${(ms / 1000).toFixed(1)}s`;
}

function toolIcon(tool: string): IconSvgElement {
  if (/web_search|web_fetch|http_request|gmail|spotify/i.test(tool)) return GlobeIcon;
  if (/run_command|terminal|shell|process/i.test(tool)) return CommandLineIcon;
  if (/git_commit|git_status|git_diff/i.test(tool)) return CodeIcon;
  if (/search_files|list_dir|analyze_project_structure|get_open_files/i.test(tool)) return Folder01Icon;
  if (/delete/i.test(tool)) return Delete02Icon;
  if (/write|append|replace|edit|rename|copy|create/i.test(tool)) return Edit02Icon;
  if (/read_file|file_info|read_active_file/i.test(tool)) return File01Icon;
  if (/browser|url|web/i.test(tool)) return BrowserIcon;
  return Search01Icon;
}

/** Renders the icon for a tool, picking the right component for the icon set. */
function ToolIcon({ tool }: { tool: string }) {
  return <HugeiconsIcon icon={toolIcon(tool)} size={14} strokeWidth={1.7} className="shrink-0" />;
}

function toolArgument(item: AgenticActivityType): string {
  const preferred = ["command", "path", "new_path", "query", "pattern", "url"];
  for (const key of preferred) {
    const value = item.args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function ToolDetails({ item }: { item: AgenticActivityType }) {
  const args = Object.entries(item.args);
  return (
    <div className="ml-6 mt-1 mb-2 space-y-2 border-l border-(--border) pl-3">
      {args.length > 0 && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-4 text-[var(--text-faint)]">
          {args.map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`).join("\n")}
        </pre>
      )}
      <StructuredOutput item={item} />
      {item.error && (
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-4 text-[var(--danger)]">
          {item.error}
        </pre>
      )}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <IoChevronForward
      className={`h-3 w-3 shrink-0 text-[var(--text-muted)] transition-transform ${open ? "rotate-90" : ""}`}
    />
  );
}

/** Render web_search hits as clickable links. Falls back to plain text when a
 *  result has no usable http(s) URL (e.g. a bare hostname from an RSS feed). */
function WebSearchResults({ results }: { results: WebSearchResult[] }) {
  const isHttp = (u: string) => /^https?:\/\//i.test(u);
  return (
    <div className="mx-3 mb-2 overflow-hidden rounded border border-(--border) bg-(--fill-1)">
      <ol className="divide-y divide-(--border)">
        {results.map((r, i) => (
          <li key={i} className="px-2.5 py-1.5">
            <div className="flex items-baseline gap-1.5">
              <span className="shrink-0 font-mono text-[10px] text-[var(--text-faint)]">
                {i + 1}.
              </span>
              {isHttp(r.url) ? (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="truncate text-[11.5px] font-medium text-[var(--accent)] underline underline-offset-2 transition hover:opacity-80"
                  title={r.url}
                >
                  {r.title || r.url}
                </a>
              ) : (
                <span className="truncate text-[11.5px] font-medium text-[var(--text-primary)]">
                  {r.title || r.url}
                </span>
              )}
            </div>
            {r.snippet && (
              <p className="mt-0.5 pl-[18px] text-[10.5px] leading-4 text-[var(--text-muted)]">
                {r.snippet}
              </p>
            )}
            {isHttp(r.url) && (
              <p className="mt-0.5 truncate pl-[18px] font-mono text-[9.5px] text-[var(--text-faint)]">
                {r.url}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function StructuredOutput({ item }: { item: AgenticActivityType }) {
  const { t } = useTranslation();
  if (item.tool === "list_dir" && Array.isArray(item.data)) {
    const entries = item.data as FsEntry[];
    return (
      <div className="mx-3 mb-2 overflow-hidden rounded border border-(--border) bg-(--fill-1)">
        <table className="w-full text-left text-[11px] font-mono">
          <thead className="bg-(--fill-2) text-[var(--text-muted)]">
            <tr>
              <th className="px-2 py-1 font-medium">{t("activity.colName")}</th>
              <th className="px-2 py-1 font-medium text-right">{t("activity.colSize")}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i} className="border-t border-(--border) hover:bg-(--fill-2)">
                <td className="px-2 py-1 text-[var(--text-primary)]">
                  <span className={e.is_dir ? "text-[var(--accent)]" : "text-[var(--text-secondary)]"}>
                    {e.is_dir ? "📁 " : "📄 "}{e.name}
                  </span>
                </td>
                <td className="px-2 py-1 text-right text-[var(--text-faint)]">
                  {e.size ? `${(e.size / 1024).toFixed(1)}KB` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (item.tool === "web_search" && Array.isArray(item.data) && item.data.length > 0) {
    return <WebSearchResults results={item.data as WebSearchResult[]} />;
  }

  if (!item.output) return null;

  return (
    <pre className="mx-3 mb-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded border border-(--border) bg-(--fill-1) px-3 py-2 font-mono text-[11px] leading-5 text-[var(--text-secondary)]">
      {item.output}
    </pre>
  );
}

export default function AgenticActivity({
  items,
  pending,
  onApprove,
  onDeny,
}: AgenticActivityProps) {
  const { t } = useTranslation();
  const [expandedRows, setExpandedRows] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!pending) return;
    const id = pending.id;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); onApprove(id); } 
      else if (e.key === "Escape") { e.preventDefault(); onDeny(id); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pending, onApprove, onDeny]);

  const toggleRow = (id: string) =>
    setExpandedRows((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const visible = items;

  const total = visible.length;
  const activeCount = visible.filter((i) => i.status === "running" || i.status === "pending").length;
  const failedCount = visible.filter((i) => i.status === "error" || i.status === "denied").length;
  const isWorking = activeCount > 0 || !!pending;
  useEffect(() => {
    if (isWorking) setExpanded(true);
  }, [isWorking]);
  if (total === 0 && !pending) return null;

  const summary = isWorking
    ? t("activity.working")
    : failedCount > 0
      ? t("activity.agentActivity")
      : t("activity.toolsUsed", { count: total, plural: total === 1 ? "" : "s" });

  return (
    <div className="mt-2 max-w-full">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="inline-flex items-center gap-1.5 rounded px-1 py-1 text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
      >
        {isWorking ? (
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-(--accent)" />
        ) : failedCount ? (
          <IoAlertCircleOutline aria-hidden className="h-3.5 w-3.5 text-[var(--danger)]" />
        ) : (
          <IoCheckmarkOutline aria-hidden className="h-3.5 w-3.5 text-[var(--text-faint)]" />
        )}
        <span className={failedCount ? "text-[var(--danger)]" : ""}>{summary}</span>
        <Chevron open={expanded} />
      </button>

      {expanded && (
        <div className="ml-1 mt-1 border-l border-(--border) pl-3">
          <div className="space-y-0.5">
            {visible.map((item) => {
              const open = expandedRows.includes(item.id);
              const hasDetail = !!(item.output || item.error || item.data || item.diff?.length);
              const active = item.status === "running" || item.status === "pending" || item.status === "approved";
              const failed = item.status === "error" || item.status === "denied";
              return (
                <div key={item.id}>
                  <div className="flex min-w-0 items-center gap-2 py-1 text-[11px] text-[var(--text-muted)]">
                    <span className={failed ? "text-[var(--danger)]" : active ? "text-[var(--text-secondary)]" : ""} title={toolName(item.tool)}>
                      <ToolIcon tool={item.tool} />
                    </span>
                    <button
                      type="button"
                      onClick={() => hasDetail && toggleRow(item.id)}
                      aria-expanded={hasDetail ? open : undefined}
                      className={`flex min-w-0 flex-1 items-center gap-2 text-left ${hasDetail ? "hover:text-[var(--text-primary)]" : "cursor-default"}`}
                    >
                      <span className={`shrink-0 ${failed ? "text-[var(--danger)]" : active ? "text-[var(--text-primary)]" : ""}`}>{toolName(item.tool)}</span>
                      {toolArgument(item) && <span title={toolArgument(item)} className="min-w-0 truncate font-mono text-[10px] text-[var(--text-faint)]">{toolArgument(item)}</span>}
                      {active && <span className="ml-auto shrink-0 text-[10px] text-[var(--text-faint)]">{t("activity.working")}</span>}
                      {!active && item.durationMs != null && <span className="ml-auto shrink-0 text-[10px] tabular-nums text-[var(--text-faint)]">{duration(item.durationMs)}</span>}
                      {hasDetail && <Chevron open={open} />}
                    </button>
                  </div>
                  {open && (
                    <div className="pb-2 pl-5">
                      <ToolDetails item={item} />
                      {item.diff && item.diff.length > 0 && (
                        <div className="mb-2 overflow-auto font-mono text-[10px]">
                          {item.diff.map((line, i) => (
                            <div key={i} className={line.type === "add" ? "text-[var(--success)]" : line.type === "del" ? "text-[var(--danger)]" : "text-[var(--text-faint)]"}>
                              <span className="mr-2 opacity-50">{line.type === "add" ? "+" : line.type === "del" ? "−" : " "}</span>
                              <span className="whitespace-pre-wrap break-all">{line.text}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {pending && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="mr-auto text-[var(--text-secondary)]">{t("activity.waitingToUse", { tool: toolName(pending.tool) })}</span>
              <button onClick={() => onDeny(pending.id)} className="px-2 py-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]">{t("activity.deny")}</button>
              <button onClick={() => onApprove(pending.id)} className="rounded bg-(--fill-3) px-2.5 py-1 text-[var(--text-primary)] hover:bg-(--fill-2)">{t("activity.approve")}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

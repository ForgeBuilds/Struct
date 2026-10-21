/*
 * Author: madhusudhan
 * Check the LICENSE in the GitHub repo (https://github.com/Lumorix-studios/Struct) for more information on permissions to use this code.
 */
import { useEffect, useState } from "react";
import type { AgenticActivity as AgenticActivityType, FsEntry, WebSearchResult } from "../agentic";
import { TOOL_LABELS } from "../agentic";
import { diffStats } from "../../src/diff";
import { IoChevronForward } from "react-icons/io5";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  CommandLineIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { MdEditNote } from "react-icons/md";
import { FaFile, FaIcons } from "react-icons/fa6";
import type { IconType } from "react-icons";
import ThinkingIndicator from "../../components/ThinkingIndicator";
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

/** Icons come from two different libraries, so we keep track of which kind each
 *  one is and render it with the matching component. */
type ToolIconSpec =
  | { kind: "huge"; icon: IconSvgElement }
  | { kind: "react"; Icon: IconType };

function toolIcon(tool: string): ToolIconSpec {
  if (/search|list_dir|find|grep|glob|status|diff/i.test(tool)) {
    return { kind: "huge", icon: Search01Icon };
  }
  if (/write|append|replace|edit|delete|move|rename|copy|create/i.test(tool)) {
    return { kind: "react", Icon: MdEditNote };
  }
  if (/read|file|dir|open|info/i.test(tool)) {
    return { kind: "react", Icon: FaFile };
  }
  if (/run|exec|command|shell|terminal|process/i.test(tool)) {
    return { kind: "huge", icon: CommandLineIcon };
  }
  return { kind: "react", Icon: FaIcons };
}

/** Renders the icon for a tool, picking the right component for the icon set. */
function ToolIcon({ tool }: { tool: string }) {
  const spec = toolIcon(tool);
  if (spec.kind === "huge") {
    return <HugeiconsIcon icon={spec.icon} size={13} strokeWidth={1.8} className="shrink-0" />;
  }
  const { Icon } = spec;
  return <Icon size={13} className="shrink-0" />;
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
  const [closed, setClosed] = useState<string[]>([]);
  const [expandedRows, setExpandedRows] = useState<string[]>([]);

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

  const remove = (id: string) => setClosed((prev) => [...prev, id]);
  const isClosed = (id: string) => closed.includes(id);
  const toggleRow = (id: string) =>
    setExpandedRows((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const visible = items.filter((item) => !isClosed(item.id));

  const total = visible.length;
  const activeCount = visible.filter((i) => i.status === "running" || i.status === "pending").length;
  const failedCount = visible.filter((i) => i.status === "error" || i.status === "denied").length;
  const totals = visible.reduce((acc, item) => {
      if (item.diff) {
        const s = diffStats(item.diff);
        acc.adds += s.adds; acc.dels += s.dels;
      }
      return acc;
    }, { adds: 0, dels: 0 });

  if (total === 0 && !pending) return null;

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-2">
      <div className="space-y-1">
        {pending && (
          <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
            <ToolIcon tool={pending.tool} />
            <ThinkingIndicator label={t("activity.waitingToUse", { tool: toolName(pending.tool) })} />
            <div className="ml-auto flex shrink-0 items-center gap-1">
                <button
                  onClick={() => onDeny(pending.id)}
                  className="rounded px-2 py-1 text-[11px] text-[var(--text-muted)] transition hover:bg-(--fill-3) hover:text-[var(--text-primary)]"
                >
                  {t("activity.deny")}
                </button>
                <button
                  onClick={() => onApprove(pending.id)}
                  className="rounded bg-(--accent) px-2 py-1 text-[11px] font-medium text-(--on-accent) transition hover:opacity-90"
                >
                  {t("activity.approve")}
                </button>
            </div>
          </div>
        )}

        {total > 0 && (
          <div className="space-y-1">
            <div className="px-1 text-[10px] text-[var(--text-faint)]">
              {activeCount > 0 ? t("activity.working") : failedCount > 0 ? t("activity.agentActivity") : t("activity.toolsUsed", { count: total, plural: total === 1 ? "" : "s" })}
              {totals.adds + totals.dels > 0 && (
                <span className="ml-2 font-mono text-[10px]">
                  <span className="text-[var(--success)]">+{totals.adds}</span> <span className="text-[var(--danger)]">−{totals.dels}</span>
                </span>
              )}
            </div>
            <div className="space-y-0.5">
              {visible.map((item) => {
          const open = expandedRows.includes(item.id);
          const hasDetail = !!(item.output || item.error || item.data);
          return (
            <div key={item.id} className="group">
                <div
                  role={hasDetail ? "button" : undefined}
                  tabIndex={hasDetail ? 0 : undefined}
                  onClick={() => hasDetail && toggleRow(item.id)}
                  onKeyDown={(event) => {
                    if (hasDetail && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      toggleRow(item.id);
                    }
                  }}
                  className={`flex w-full items-center gap-2 px-1 py-1 text-left text-[11px] text-[var(--text-muted)] ${hasDetail ? "cursor-pointer hover:text-[var(--text-secondary)]" : ""}`}
                >
                  <ToolIcon tool={item.tool} />
                  <span className="font-medium">{item.status === "done" ? t("activity.used") : item.status === "error" ? t("activity.failed") : item.status === "denied" ? t("activity.denied") : t("activity.using")} {toolName(item.tool)}</span>
                  <span className="min-w-0 truncate font-mono text-[10px] text-[var(--text-faint)]">
                    {toolArgument(item)}
                  </span>
                  {item.status === "running" && <ThinkingIndicator label="" />}
                  {item.durationMs != null && <span className="ml-auto shrink-0 text-[10px] text-[var(--text-faint)]">{duration(item.durationMs)}</span>}
                  {hasDetail && <Chevron open={open} />}
                  <span
                    onClick={(e) => { e.stopPropagation(); remove(item.id); }}
                  className="ml-1 text-[11px] text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--text-secondary)]"
                >
                  ✕
                </span>
              </div>
              {open && (
                <div className="px-1 pb-2">
                  <ToolDetails item={item} />
                  {item.diff && item.diff.length > 0 && (
                    <div className="mb-2 overflow-hidden rounded border border-(--border) bg-(--fill-1) font-mono text-[11px]">
                      {item.diff.map((l, i) => (
                        <div key={i} className={l.type === "add" ? "bg-emerald-500/10 text-[var(--success)]" : l.type === "del" ? "bg-red-500/10 text-[var(--danger)]" : "text-[var(--text-faint)]"}>
                          <span className="px-2 opacity-50">{l.type === "add" ? "+" : l.type === "del" ? "−" : " "}</span>
                          <span className="whitespace-pre-wrap break-all">{l.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <StructuredOutput item={item} />
                </div>
              )}
            </div>
          );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

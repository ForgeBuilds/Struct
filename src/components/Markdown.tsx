/*
 * Author: madhusudhan
 * Check the LICENSE in the GitHub repo (https://github.com/Lumorix-studios/Struct) for more information on permissions to use this code.
 */
import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { Components } from "react-markdown";

const components: Components = {
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || "");
    const isBlock = match || props.node?.position?.start.line !== props.node?.position?.end.line;
    // Newline char built at runtime so the source stays escape-sequence safe.
    const NL_CH = String.fromCharCode(10);
    const isInline = !match && !String(children).includes(NL_CH);
    const codeText = String(children).replace(new RegExp(NL_CH + "$"), "");

    if (!isBlock || isInline) {
      return (
        <code
          className="rounded border border-(--border) bg-(--fill-2) px-1.5 py-0.5 font-mono text-[0.85em] text-[var(--text-primary)]"
          {...props}
        >
          {children}
        </code>
      );
    }

    return (
      <div className="group relative my-3 overflow-hidden rounded-lg border border-(--border) bg-(--fill-1)">
        <div className="flex items-center justify-between border-b border-(--border) px-3 py-1">
          <span className="font-mono text-[10px] text-[var(--text-muted)]">
            {match ? match[1] : "code"}
          </span>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(codeText);
            }}
            className="text-[10px] text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
          >
            Copy
          </button>
        </div>
        <pre className="scrollbar-thin overflow-x-auto p-3">
          <code className={`hljs font-mono text-[12px] leading-[1.55] ${className || ""}`} {...props}>
            {children}
          </code>
        </pre>
      </div>
    );
  },
  a({ children, href }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="text-[var(--accent)] underline underline-offset-2 transition hover:opacity-80"
      >
        {children}
      </a>
    );
  },
  h1: ({ children }) => (
    <h1 className="mb-2 mt-5 text-[16px] font-semibold text-[var(--text-primary)]">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-1.5 mt-4 text-[14px] font-semibold text-[var(--text-primary)]">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1.5 mt-3.5 text-[13.5px] font-semibold text-[var(--text-primary)]">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-1.5 mt-3 text-[13px] font-semibold text-[var(--text-primary)]">{children}</h4>
  ),
  p: ({ children }) => (
    <p className="my-1.5 leading-6 text-[var(--text-secondary)] first:mt-0 last:mb-0">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="my-1.5 list-disc space-y-0.5 pl-5 text-[var(--text-secondary)] marker:text-[var(--text-faint)]">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1.5 list-decimal space-y-0.5 pl-5 text-[var(--text-secondary)] marker:text-[var(--text-faint)]">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-6">{children}</li>,
  hr: () => <hr className="my-4 border-(--border)" />,
  blockquote: ({ children }) => (
    <blockquote className="my-2.5 border-l border-(--border-strong) pl-3 text-[var(--text-secondary)]">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="min-w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-(--border-strong)">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="border-b border-(--border) px-2.5 py-1.5 text-left font-medium text-[var(--text-primary)]">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-(--border) px-2.5 py-1.5 text-[var(--text-secondary)]">{children}</td>
  ),
  tr: ({ children }) => <tr>{children}</tr>,
  strong: ({ children }) => <strong className="font-semibold text-[var(--text-primary)]">{children}</strong>,
  em: ({ children }) => <em className="text-[var(--text-primary)]">{children}</em>,
};

interface MarkdownProps {
  content: string;
}

function MarkdownBase({ content }: MarkdownProps) {
  return (
    <div className="markdown-body text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
        skipHtml
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownBase);

export default Markdown;
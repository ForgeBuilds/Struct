import type { CSSProperties } from "react";
import { useTranslation } from "../src/i18n";

interface ThinkingIndicatorProps {
  label?: string;
  className?: string;
}

export default function ThinkingIndicator({
  label,
  className = "",
}: ThinkingIndicatorProps) {
  const { t } = useTranslation();
  const resolvedLabel = label ?? t("app.thinking");
  return (
    <span
      role="status"
      aria-label={resolvedLabel}
      className={`pointer-events-none select-none inline-flex items-center gap-1.5 ${className}`}
    >
      <span aria-hidden="true" className="inline-flex items-center gap-0.5">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="h-1 w-1 rounded-full bg-current opacity-40 animate-pulse"
            style={{ animationDelay: `${index * 140}ms` } as CSSProperties}
          />
        ))}
      </span>
      {resolvedLabel && <span>{resolvedLabel}</span>}
    </span>
  );
}

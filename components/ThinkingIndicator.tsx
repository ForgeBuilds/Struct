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
      className={`pointer-events-none select-none inline-flex items-center gap-2 ${className}`}
    >
      <span aria-hidden="true" className="inline-flex items-end gap-1">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="h-2 w-2 rounded-full bg-current animate-thinking-wave"
            style={{ animationDelay: `${index * 120}ms` } as CSSProperties}
          />
        ))}
      </span>
      {resolvedLabel && <span className="text-sm font-medium text-muted-foreground">{resolvedLabel}</span>}
    </span>
  );
}
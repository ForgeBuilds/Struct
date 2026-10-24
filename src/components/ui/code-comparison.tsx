/*
 * CodeComparison - Displays two code snippets side by side for before/after comparison
 * Based on @magicui/code-comparison (https://github.com/magicuigorge/magicui)
 */
import React, { useEffect, useState } from "react";
import { createHighlighter } from "shiki";
import { useTheme } from "next-themes";

interface CodeComparisonProps {
  /** Code snippet for the "before" (left) pane */
  beforeCode: string;
  /** Code snippet for the "after" (right) pane */
  afterCode: string;
  /** Language identifier for syntax highlighting (e.g., "typescript", "javascript") */
  language?: string;
  /** Filename displayed in the header */
  filename?: string;
  /** Theme used when next-themes resolves to light */
  lightTheme?: string;
  /** Theme used when next-themes resolves to dark */
  darkTheme?: string;
  /** Custom color for highlighted lines/indicators */
  highlightColor?: string;
  /** Additional class names */
  className?: string;
}

const DEFAULT_LIGHT_THEME = "github-light";
const DEFAULT_DARK_THEME = "github-dark";
const DEFAULT_HIGHLIGHT_COLOR = "#facc15";

export const CodeComparison: React.FC<CodeComparisonProps> = ({
  beforeCode,
  afterCode,
  language = "plaintext",
  filename = "file.ts",
  lightTheme = DEFAULT_LIGHT_THEME,
  darkTheme = DEFAULT_DARK_THEME,
  highlightColor = DEFAULT_HIGHLIGHT_COLOR,
  className,
}) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const currentTheme = isDark ? darkTheme : lightTheme;

  const [highlightedBefore, setHighlightedBefore] = useState<string>("");
  const [highlightedAfter, setHighlightedAfter] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    const loadHighlighter = async () => {
      try {
        const loader = await createHighlighter({
          themes: [lightTheme, darkTheme],
          langs: [language],
        });
        if (!cancelled) {
          setHighlightedBefore(loader.codeToHtml(beforeCode, {
            lang: language,
            theme: currentTheme,
          }));
          setHighlightedAfter(loader.codeToHtml(afterCode, {
            lang: language,
            theme: currentTheme,
          }));
        }
      } catch (error) {
        console.error("Failed to load highlighter:", error);
      }
    };

    loadHighlighter();
    return () => {
      cancelled = true;
    };
  }, [beforeCode, afterCode, language, lightTheme, darkTheme, currentTheme, highlightColor]);

  return (
    <div className={`code-comparison ${className ?? ""}`}>
      <div className="code-comparison__header">
        <span className="code-comparison__filename">{filename}</span>
        <div className="code-comparison__labels">
          <span className="code-comparison__label code-comparison__label--before">Before</span>
          <span className="code-comparison__label code-comparison__label--after">After</span>
        </div>
        <div className="code-comparison__vsm" aria-hidden="true">
          VS
        </div>
      </div>
      <div className="code-comparison__body">
        <div className="code-comparison__pane code-comparison__pane--before">
          <div dangerouslySetInnerHTML={{ __html: highlightedBefore }} />
        </div>
        <div className="code-comparison__pane code-comparison__pane--after">
          <div dangerouslySetInnerHTML={{ __html: highlightedAfter }} />
        </div>
      </div>
    </div>
  );
};

export default CodeComparison;
/* File edit diff display using CodeComparison for before/after viewing */
import React, { useMemo } from "react";
import { CodeComparison } from "./code-comparison";

interface FileEditDiffProps {
  /** Unified diff lines: "add" (new), "del" (removed), "ctx" (context) */
  diff: Array<{ type: "add" | "del" | "ctx"; text: string }>;
  /** Filename for display and language detection */
  filename?: string;
}

/**
 * Renders the before/after comparison of a file edit using the CodeComparison component.
 * The `diff` array follows the unified diff format:
 * - "add": line added in the new version
 * - "del": line removed from the old version
 * - "ctx": context line present in both versions
 */
export const FileEditDiff: React.FC<FileEditDiffProps> = ({ diff, filename }) => {
  // Reconstruct the "before" (previous) code from the diff
  const beforeCode = useMemo(() => {
    return diff
      .filter((l) => l.type === "del" || l.type === "ctx")
      .map((l) => l.text)
      .join("\n");
  }, [diff]);

  // Reconstruct the "after" (current) code from the diff
  const afterCode = useMemo(() => {
    return diff
      .filter((l) => l.type === "add" || l.type === "ctx")
      .map((l) => l.text)
      .join("\n");
  }, [diff]);

  // Estimate language from filename
  const language =
    filename?.split(".").pop()?.toLowerCase() ?? "plaintext";

  return (
    <CodeComparison
      beforeCode={beforeCode}
      afterCode={afterCode}
      language={language}
      filename={filename ?? "file"}
      highlightColor="#facc15"
    />
  );
};

export default FileEditDiff;

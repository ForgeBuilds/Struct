import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "../src/i18n";

interface Command {
  id: string;
  label: string;
  shortcut?: string;
  category: string;
  action: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  commands: Command[];
}

const COMMAND_TRANSLATION_KEYS: Record<string, string> = {
  agent: "cmd.agent",
  "open-ai-settings": "cmd.openAiSettings",
  "toggle-history": "app.history",
  "open-information": "settings.about",
  "open-privacy": "settings.privacy",
  "new-chat": "app.newChat",
  "stop-stream": "app.stopStreaming",
  "open-ide-window": "app.openEditor",
  "open-folder": "cmd.openFolder",
  "open-files": "cmd.openFiles",
  "new-file": "cmd.newFile",
  save: "cmd.saveFile",
  "close-all-tabs": "cmd.closeAllTabs",
  explorer: "cmd.toggleExplorer",
  git: "cmd.toggleGit",
  terminal: "cmd.toggleTerminal",
  settings: "cmd.openSettings",
  "ai-settings": "cmd.openAiSettings",
};

const CATEGORY_TRANSLATION_KEYS: Record<string, string> = {
  Agent: "app.agent",
  Recent: "cmd.recent",
  File: "cmd.file",
  View: "cmd.view",
  Settings: "cmd.settings",
  Help: "app.help",
  Chat: "app.chat",
};

export default function CommandPalette({ isOpen, onClose, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const { t } = useTranslation(isOpen);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredCommands = useMemo(() => {
    const normalizedQuery = query.toLowerCase();
    return commands
      .map((cmd) => ({
        ...cmd,
        label: COMMAND_TRANSLATION_KEYS[cmd.id]
          ? t(COMMAND_TRANSLATION_KEYS[cmd.id])
          : cmd.label,
        category: CATEGORY_TRANSLATION_KEYS[cmd.category]
          ? t(CATEGORY_TRANSLATION_KEYS[cmd.category])
          : cmd.category,
      }))
      .filter((cmd) =>
        cmd.label.toLowerCase().includes(normalizedQuery) ||
        cmd.category.toLowerCase().includes(normalizedQuery)
      );
  }, [commands, query, t]);

  // Reset the query whenever the palette opens. Done as a render-time
  // adjustment (the sanctioned "reset state on prop change" pattern) instead of
  // in an effect, so the empty list is never painted for one frame first.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
    }
  }

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, filteredCommands.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          filteredCommands[selectedIndex].action();
          onClose();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, selectedIndex, filteredCommands, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="dialog-backdrop fixed inset-0 z-[100] flex items-start justify-center bg-black/50 pt-[14vh]"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-lg border border-(--border-strong) bg-[var(--bg-elevated)]">
        {/* Input */}
        <div className="border-b border-(--border) px-4 py-3">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder={t("cmd.typeCommand") || "Type a command…"}
            spellCheck={false}
            className="w-full bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-faint)]"
          />
        </div>

        {/* Commands list */}
        <div className="max-h-[360px] overflow-y-auto p-1.5">
          {filteredCommands.length === 0 ? (
            <div className="px-3 py-8 text-center text-[12.5px] text-[var(--text-muted)]">
              {t("cmd.noCommandsFound") || "No commands found"}
            </div>
          ) : (
            filteredCommands.map((cmd, idx) => (
              <button
                key={cmd.id}
                onClick={() => {
                  cmd.action();
                  onClose();
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${
                  idx === selectedIndex ? "bg-(--fill-2) text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-[12.5px]">{cmd.label}</span>
                <span className="shrink-0 text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
                  {cmd.category}
                </span>
                {cmd.shortcut && <span className="kbd shrink-0">{cmd.shortcut}</span>}
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 border-t border-(--border) px-4 py-2 text-[10px] text-[var(--text-muted)]">
          <span className="flex items-center gap-1.5">
            <span className="kbd">↑↓</span> {t("cmd.navigate") || "Navigate"}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="kbd">↵</span> {t("cmd.select") || "Select"}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="kbd">Esc</span> {t("cmd.close") || "Close"}
          </span>
        </div>
      </div>
    </div>
  );
}
import { IoFolderOutline } from "react-icons/io5";
import { useTranslation } from "../src/i18n";

interface Props {
  historySidebarOpen: boolean;
  onToggleHistorySidebar: () => void;
  /** Open workspace folder name shown next to the brand. */
  workspaceName?: string | null;
}

function ToggleButton({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded px-1.5 py-px text-[11px] transition-colors ${
        active
          ? "bg-(--fill-3) text-[var(--text-primary)]"
          : "text-[var(--text-muted)] hover:bg-(--fill-3) hover:text-[var(--text-primary)]"
      }`}
    >
      {children}
    </button>
  );
}

export default function StatusBar({
  historySidebarOpen,
  onToggleHistorySidebar,
  workspaceName,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className="flex h-[22px] shrink-0 items-center gap-3 border-t border-(--border) bg-[var(--bg-panel)] px-2 text-[11px] text-[var(--text-muted)]">
      {/* Left */}
      <div className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden">
        {/* <span className="flex shrink-0 items-center gap-1 font-medium text-[var(--text-muted)]">
          <span className="h-1.5 w-1.5 rounded-full bg-(--accent)" />
          Struct
        </span> */}
        {workspaceName && (
          <span className="flex min-w-0 shrink-0 items-center gap-1 text-[var(--text-muted)]" title={workspaceName}>
            <IoFolderOutline size={10} />
            <span className="max-w-[140px] truncate">{workspaceName}</span>
          </span>
        )}
      </div>
      {/* Right */}
      <div className="flex shrink-0 items-center gap-0.5">
        <ToggleButton
          active={historySidebarOpen}
          onClick={onToggleHistorySidebar}
          title={t("app.chatHistory") || "Toggle Chat History (Ctrl+Shift+H)"}
        >
          {t("app.chatHistory") || "Chat History"}
        </ToggleButton>
      </div>
    </div>
  );
}

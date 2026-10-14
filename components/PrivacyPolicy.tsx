import { openExternalUrl as openUrl } from "../src/lib/external";
import { useErrorHandler } from "../src/errorContext";
import { IoClose, IoInformationCircle, IoOpenOutline } from "react-icons/io5";

interface InfoPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function InfoPanel({ isOpen, onClose }: InfoPanelProps) {
  const { reportError } = useErrorHandler();
  if (!isOpen) return null;

  return (
    <div
      className="dialog-backdrop fixed inset-0 z-40 flex items-center justify-center p-6 bg-black/50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-lg border border-(--border-strong) bg-(--bg-panel) p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="m-0 text-[13px] font-medium text-[var(--text-primary)]">Privacy Policies</h2>
            <p className="m-0 text-[11px] text-[var(--text-muted)]">Lumorix Studios</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-(--text-muted) transition hover:text-[var(--text-primary)]"
          >
            <IoClose size={16} />
          </button>
        </div>

        <div className="mt-4">
          <ActionButton
            icon={<IoInformationCircle size={15} />}
            onClick={async () => {
              try {
                await openUrl("https://lumorix-studios.github.io/LumorixStudiosHq/privacypolicyandterms");
              } catch (error) {
                reportError(error);
              }
            }}
            label="View our Policies"
            sublabel="If you have any concerns about our policies, please contact us"
          />
        </div>

        <div className="mt-5 flex items-center justify-end">
          <button
            onClick={onClose}
            className="h-8 rounded-md border border-(--border-strong) px-3 text-[12px] text-[var(--text-primary)] transition hover:bg-(--fill-1)"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Small shared bits ─────────────────────────────────────────────────────── */

function ActionButton({
  icon,
  onClick,
  label,
  sublabel,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  label: string;
  sublabel: string;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 rounded-md border border-(--border) px-3 py-2.5 text-left transition-colors hover:bg-(--fill-1) hover:border-(--border-strong)"
    >
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-(--fill-1) text-[var(--text-secondary)]">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] text-[var(--text-primary)]">{label}</div>
        <div className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">{sublabel}</div>
      </div>
      <IoOpenOutline size={14} className="flex-shrink-0 text-[var(--text-faint)]" />
    </button>
  );
}

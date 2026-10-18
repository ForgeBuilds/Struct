
import { openExternalUrl as openUrl } from "../src/lib/external";
import { IoClose } from "react-icons/io5";
import { useTranslation } from "../src/i18n";
interface ErrorTabProps {
  isOpen: boolean;
  onClose: () => void;
  message?: string;
}

export default function ErrorTab({ isOpen, onClose, message }: ErrorTabProps) {
  const { t } = useTranslation();
  if (!isOpen) return null;

  return (
    <div
      className="dialog-backdrop fixed inset-0 z-40 flex items-center justify-center p-6 bg-black/50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-lg border border-(--border-strong) bg-(--bg-panel) p-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="text-[13px] font-medium text-[var(--text-primary)]">
            {t("error.somethingWentWrong")}
          </div>

          <button
            onClick={onClose}
            className="rounded-md p-1 text-(--text-muted) transition hover:text-[var(--text-primary)]"
          >
            <IoClose size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="mt-4">
          {message ? (
            <p className="text-[12px] leading-5 text-[var(--text-secondary)] break-words">
              {message}
            </p>
          ) : (
            <p className="text-[12px] leading-5 text-[var(--text-secondary)]">
              {t("error.unexpectedError")}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="h-8 rounded-md border border-(--border-strong) px-3 text-[12px] text-[var(--text-primary)] transition hover:bg-(--fill-1)"
          >
            {t("error.close")}
          </button>

          <button
            onClick={async () => {
              try {
                await openUrl("https://github.com/Lumorix-studios/Neo/issues");
              } catch (error) {
                console.error(error);
              }
            }}
            className="h-8 rounded-md bg-(--text-primary) px-3 text-[12px] font-medium text-(--bg-base) transition-opacity hover:opacity-90"
          >
            {t("error.reportIssue")}
          </button>
        </div>

      </div>
    </div>
  );
}
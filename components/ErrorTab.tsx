
import { openExternalUrl as openUrl } from "../src/lib/external";
import { IoClose } from "react-icons/io5";
interface ErrorTabProps {
  isOpen: boolean;
  onClose: () => void;
  message?: string;
}

export default function ErrorTab({ isOpen, onClose, message }: ErrorTabProps) {
  if (!isOpen) return null;
  
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-xl bg-[#10110f] border border-(--border) rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-(--border)">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/20 text-red-400">
              <span className="text-[16px] font-bold">!</span>
            </div>

            <div>
              <div className="text-[15px] font-semibold text-[#f1f1eb]">
                Error
              </div>
              <div className="text-[11px] text-[var(--text-muted)]">
                An unexpected error occurred
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-(--border) text-[var(--text-muted)] transition hover:bg-(--fill-2) hover:text-[#f1f1eb]"
          >
            <IoClose size={14} />
          </button>
        </div>

        {/* Noise */}
        <div className="relative w-full h-[300px] overflow-hidden border-b border-(--border)">
         
          {/* Centered Error Text */}
          <span className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-3xl font-bold tracking-widest text-amber-50">
            ERROR
          </span>
        </div>

        {/* Body */}
        <div className="px-6 py-8 min-h-[50px]">
          {message ? (
            <p className="text-[13px] leading-6 text-[var(--text-secondary)] break-words">
              {message}
            </p>
          ) : (
            <p className="text-[13px] leading-6 text-[var(--text-secondary)]">
              An unexpected error occurred. You can close this dialog and try
              again, or report the issue to help us fix it.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-10 py-5 border-t border-(--border)">
          <span className="text-[11px] text-[var(--text-muted)]">
            © 2026 Lumorix Studios
          </span>
        
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-[#c9f2d6] text-[#152219] text-[13px] font-semibold transition hover:opacity-85"
            >
              Close
            </button>
        
            <button
              onClick={async () => {
                try {
                  await openUrl("https://github.com/Lumorix-studios/Neo/issues");
                } catch (error) {
                  console.error(error);
                }
              }}
              className="px-4 py-1.5 rounded-lg bg-[#c9f2d6] text-[#152219] text-[13px] font-semibold transition hover:opacity-85"
            >
              Report the issue
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
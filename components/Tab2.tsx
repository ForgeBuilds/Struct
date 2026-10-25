import { useState } from "react";
import { openExternalUrl as openUrl } from "../src/lib/external";
import { useErrorHandler } from "../src/errorContext";
import { IoStar, IoStarOutline } from "react-icons/io5";

interface Tab2Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function Tab2({ isOpen, onClose }: Tab2Props) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  void setRating;
  const { reportError } = useErrorHandler();
//laziest way to send stars ik
  const openFeedback = async () => {
    try {
      await openUrl("mailto:madhusudhant207@gmail.com");
    } catch (error) {
      reportError(error);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="dialog-backdrop fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md overflow-hidden rounded-lg bg-[var(--bg-elevated)]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <h2 className="m-0 text-[14px] font-semibold text-[var(--text-primary)]">Rate Struct</h2>
            <p className="m-0 text-[11.5px] text-[var(--text-muted)]"></p>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-6">
          <p className="m-0 mb-5 text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
            Enjoying the app? Tap a star to rate your experience.
          </p>

          <div className="flex items-center justify-center gap-1.5">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => {
                  setRating(star);
                  void openFeedback();
                }}
                onMouseEnter={() => setHover(star)}
                onMouseLeave={() => setHover(0)}
                aria-label={`Rate ${star} star${star > 1 ? "s" : ""}`}
                className="p-1 text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
              >
                {(hover || rating) >= star ? (
                  <IoStar size={26} color="#ececec" />
                ) : (
                  <IoStarOutline size={26} color="#555555" />
                )}
              </button>
            ))}
          </div>

          {rating > 0 && (
            <p className="m-0 mt-4 text-center text-[11.5px] text-[var(--text-muted)]">
              Thanks for the {rating}-star rating!
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between  px-5 py-3">
          <span className="text-[10.5px] text-[var(--text-muted)]">© 2026 ForgeBuilds</span>
          <button
            onClick={onClose}
            className="rounded-md bg-(--accent) px-3.5 py-1.5 text-[12px] font-semibold text-(--on-accent) transition hover:opacity-90"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
import { openExternalUrl as openUrl } from "../src/lib/external";
import { useErrorHandler } from "../src/errorContext";
import { IoCallOutline, IoClose, IoLogoGithub, IoMailOutline, IoOpenOutline } from "react-icons/io5";

interface InfoPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function InfoPanel({ isOpen, onClose }: InfoPanelProps) {
  const { reportError } = useErrorHandler();
  if (!isOpen) return null;

  return (
    <div
      className="dialog-backdrop fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-[82vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-(--border-strong) bg-[var(--bg-elevated)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-(--border) px-5 py-4">
          <div>
            <h2 className="m-0 text-[14px] font-semibold text-[var(--text-primary)]">About & Contact</h2>
            <p className="m-0 text-[11.5px] text-[var(--text-muted)]">Lumorix Studios</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] transition hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
          >
            <IoClose size={12} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="flex flex-col gap-5">
            <Section title="About">
              <p className="m-0 mb-3.5 text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
                Made by{" "}
                <span className="font-medium text-[var(--text-primary)]">Lumorix Studios</span>. A
                GitHub organization for projects, not a registered company.
              </p>

              <ActionButton
                icon={
                  <IoLogoGithub size={15} />
                }
                onClick={async () => {
                  try {
                    await openUrl("https://github.com/Lumorix-studios/Struct.git");
                  } catch (error) {
                    reportError(error);
                  }
                }}
                label="View on GitHub"
                sublabel="Lumorix-studios/Struct"
              />
            </Section>

            <Section title="Contact">
              <div className="flex flex-col gap-2">
                <ActionButton
                  icon={
                    <IoMailOutline size={15} />
                  }
                  onClick={async () => {
                    try {
                      await openUrl("mailto:madhusudhant207@gmail.com?subject=Inquiries");
                    } catch (error) {
                      reportError(error);
                    }
                  }}
                  label="Email"
                  sublabel="madhusudhant207@gmail.com"
                />

                <ActionButton
                  icon={
                    <IoCallOutline size={15} />
                  }
                  onClick={async () => {
                    try {
                      await openUrl("tel:+17722590947");
                    } catch (error) {
                      reportError(error);
                    }
                  }}
                  label="Phone"
                  sublabel="+1 (772) 259-0947"
                />
              </div>
            </Section>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-(--border) px-5 py-3">
          <span className="text-[10.5px] text-[var(--text-muted)]">© 2026 Lumorix Studios</span>
          <button
            onClick={onClose}
            className="rounded-md bg-[#ececec] px-3.5 py-1.5 text-[12px] font-semibold text-[#111111] transition hover:bg-white"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

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
      className="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-(--border) bg-(--fill-1) px-3 py-2.5 text-left transition-all hover:border-(--border-strong) hover:bg-(--fill-1)"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-(--border) bg-(--fill-1) text-[var(--text-secondary)]">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium text-[var(--text-primary)]">{label}</div>
        <div className="mt-0.5 truncate text-[11.5px] text-[var(--text-muted)]">{sublabel}</div>
      </div>
      <IoOpenOutline size={13} className="shrink-0 text-[var(--text-muted)]" />
    </button>
  );
}
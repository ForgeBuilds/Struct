import { openExternalUrl as openUrl } from "../src/lib/external";
import { useErrorHandler } from "../src/errorContext";
import { IoClose, IoInformationCircle, IoInformationCircleOutline,  IoOpenOutline } from "react-icons/io5";

interface InfoPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function InfoPanel({ isOpen, onClose }: InfoPanelProps) {
  const { reportError } = useErrorHandler();
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg flex flex-col overflow-hidden bg-[#10110f] border border-white/[0.08] rounded-2xl shadow-2xl max-h-[82vh]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/[0.08]">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#c9f2d6] text-[#152219]">
              <IoInformationCircleOutline size={16} />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-[#f1f1eb] m-0">Privacy Policies</h2>
              <p className="text-[12px] text-[#777873] m-0">Lumorix Studios</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] text-[#777873] transition hover:bg-white/[0.06] hover:text-[#f1f1eb]"
          >
            <IoClose size={14} />
          </button>
        </div>

       
          
           
              <ActionButton
                icon={
                  <IoInformationCircle size={15} />
                }
                onClick={async () => {
                  try {
                    await openUrl("https://lumorix-studios.github.io/LumorixStudiosHq/privacypolicyandterms");
                  } catch (error) {
                    reportError(error);
                  }
                }}
                label="View our Policies"
                sublabel="If you have any concerns upon our policies please contact us"
                accent = "cream"
              />
            
         
      

        <div className="flex items-center justify-between px-6 py-3.5 border-t border-white/[0.08]">
          <span className="text-[11px] text-[#777873]">© 2026 Lumorix Studios</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#c9f2d6] text-[#152219] text-[13px] font-semibold transition hover:opacity-85"
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
  accent,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  label: string;
  sublabel: string;
  accent: "green" | "cream";
}) {
  const accentColor = accent === "green" ? "#c9f2d6" : "#f1f1eb";

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3.5 py-2.5 bg-transparent border border-white/[0.07] rounded-lg cursor-pointer transition-all text-left hover:bg-white/[0.04] hover:border-white/[0.12]"
    >
      <div
        className="flex h-8 w-8 items-center justify-center rounded-lg flex-shrink-0"
        style={{
          background: `${accentColor}18`,
          border: `1px solid ${accentColor}30`,
          color: accentColor,
        }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-[#d4d4d8]">{label}</div>
        <div className="text-[12px] mt-0.5 truncate" style={{ color: accentColor }}>
          {sublabel}
        </div>
      </div>
      <IoOpenOutline size={14} className="text-[#777873] flex-shrink-0" />
    </button>
  );
}
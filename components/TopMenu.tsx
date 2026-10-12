//this file functions as the topmenu bar prop in the main chatinterface window
//all the menu items are defined here and the actions are passed as props to this component


import { openExternalUrl as openUrl } from "../src/lib/external";
import { useState, useEffect, useRef, type ReactNode } from "react";
import { useErrorHandler } from "../src/errorContext";
import { IoSearch } from "react-icons/io5";
import appIcon from "../src/assets/images/icon.jpeg";
import { useTranslation } from "../src/i18n";

interface TopMenuProps {
  onOpenInfoPanel: () => void;
  onOpenPrivacyPolicy: () => void;
  onOpenTab2: () => void;
  onOpenAiSettings: () => void;
  onOpenChatHistory: () => void;
  onOpenSettings?: () => void;
  /** Opens the command palette from the title-bar "command center" pill. */
  onOpenCommandPalette?: () => void;
  /** Fires a background check for a newer release and, when one is found,
   *  causes the app to show the in-app update notification. */
  onCheckForUpdates?: () => void;
  /** Optional right-aligned slot (model pill, actions) rendered in the title bar. */
  right?: ReactNode;
  /** Trigger a deep project analysis by the agent. */
  onAnalyzeProject?: () => void;
  /** Trigger a session save/export. */
  onSaveSession?: () => void;
  /** Pin a file to the agent's context. */
  onPinFile?: (path: string) => void;
  /** Workspace folder entries shown in the Context menu. */
  contextEntries?: { name: string; path: string; is_dir: boolean }[];
  /** Paths currently pinned to the agent's context. */
  pinnedPaths?: string[];
}

interface MenuDef {
  label: string;
  items: { label: string; action: () => void; shortcut?: string; disabled?: boolean }[];
}

export default function TopMenu({
  onOpenInfoPanel,
  // onOpenPrivacyPolicy,  //this was the actual tab prop but that isnt needed and is deprecated
  onOpenTab2,
  onOpenAiSettings,
  onOpenChatHistory,
  // onOpenTerminal,
  onOpenSettings,
  onOpenCommandPalette,
  onAnalyzeProject,
  onSaveSession,
  onPinFile,
  contextEntries,
  pinnedPaths,
  right,
  onCheckForUpdates,
}: TopMenuProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { reportError } = useErrorHandler();
  const { t } = useTranslation();

  const openDocs = async () => {
    try {
      await openUrl("https://lumorix-studios.github.io/LumorixStudiosHq/Documentation");
    } catch (error) {
      reportError(error);
    }
  };
const openPrivacyPolicy = async () => {
    try {
      await openUrl("https://lumorix-studios.github.io/LumorixStudiosHq/privacypolicyandterms");
    } catch (error) {
      reportError(error);
    }
  };
  const pinned = new Set(pinnedPaths ?? []);
  /** Workspace entries for the Context menu — files are pinnable, folders are informational. */
  const contextItems: MenuDef["items"] = (contextEntries ?? []).slice(0, 25).map((e) => ({
    label: `${pinned.has(e.path) ? "📌 " : ""}${e.is_dir ? "📁 " : "📄 "}${e.name}`,
    action: () => onPinFile?.(e.path),
    disabled: e.is_dir || !onPinFile,
  }));

  const menus: MenuDef[] = [
    {
      label: t("app.context"),
      items: [
        {
          label: t("app.analyzeProject"),
          action: () => onAnalyzeProject?.(),
          disabled: !onAnalyzeProject,
        },
        {
          label: t("app.saveSession"),
          action: () => onSaveSession?.(),
          disabled: !onSaveSession,
        },
        ...(contextItems.length > 0
          ? [
              {
                label: t("app.contextTarget"),
                action: () => {},
                disabled: true,
              },
              ...contextItems,
            ]
          : [
              {
                label: t("app.noFolderOpen"),
                action: () => {},
                disabled: true,
              },
            ]),
      ],
    },
    {
      label: t("app.file"),
      items: [
        { label: t("app.newChat"), action: onOpenChatHistory, shortcut: "Ctrl+Shift+H" },
        { label: t("app.chatHistory"), action: onOpenChatHistory, shortcut: "Ctrl+H" },
      ],
    },
    {
      label: t("app.view"),
      items: [
        { label: t("app.chatHistory"), action: onOpenChatHistory, shortcut: "Ctrl+Shift+H" },
        { label: t("app.aiSettings"), action: onOpenAiSettings, shortcut: "Ctrl+B" },
        ...(onOpenSettings
          ? [{ label: t("app.settingsMenu"), action: onOpenSettings, shortcut: "Ctrl+," }]
          : []),
      ],
    },
    {
      label: t("app.help"),
      items: [
        { label: t("app.documentation"), action: openDocs },
        { label: t("app.aboutContact"), action: onOpenInfoPanel },
        { label: t("app.privacyPolicy"), action: openPrivacyPolicy },
        { label: t("app.rateApp"), action: onOpenTab2 },
        ...(onCheckForUpdates
          ? [{ label: t("app.checkForUpdates"), action: onCheckForUpdates }]
          : []),
      ],
    },
  ];

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <nav
      ref={menuRef}
      className="relative z-50 flex h-[35px] shrink-0 items-center border-b border-(--border) bg-[var(--bg-panel)] pl-3 pr-2"
    >
      {/* Left: brand + menus */}
      <div className="flex min-w-0 flex-1 items-center justify-start gap-1">
        <div className="mr-1.5 flex items-center gap-2 select-none">
          <span className="relative flex h-6 w-6 items-center justify-center">
            <img
              src={appIcon}
              alt="Neo"
              className="h-5 w-5 rounded-md"
            />
          </span>
          <span className="text-[12.5px] font-semibold tracking-tight text-[var(--text-primary)]">
            Neo
          </span>
        </div>

        <div className="flex items-center gap-0.5">
          {menus.map((menu) => (
            <div key={menu.label} className="relative">
              <button
                onClick={() => setOpenMenu(openMenu === menu.label ? null : menu.label)}
                onMouseEnter={() => openMenu && setOpenMenu(menu.label)}
                className={`rounded-[4px] px-2 py-[3px] text-[12.5px] transition-colors ${
                  openMenu === menu.label
                    ? "bg-(--fill-2) text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
                }`}
              >
                {menu.label}
              </button>

              {openMenu === menu.label && (
                <div className="panel-in absolute left-0 top-full z-50 mt-px w-64 overflow-hidden rounded-[5px] bg-[var(--bg-elevated)] p-[3px] shadow-[0_8px_24px_rgba(0,0,0,0.55)]">
                  {menu.items.map((item, i) => (
                    <button
                      key={i}
                      disabled={item.disabled}
                      onClick={() => {
                        item.action();
                        setOpenMenu(null);
                      }}
                      className="flex w-full items-center justify-between rounded-[3px] px-2.5 py-[5px] text-left text-[12.5px] text-[var(--text-primary)] transition-colors hover:bg-(--fill-2) hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <span>{item.label}</span>
                      {item.shortcut && (
                        <span className="ml-8 text-[11px] tracking-wide text-[var(--text-muted)]">
                          {item.shortcut}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {/* Center: command-palette pill — in-flow between two equal flex columns
          so it stays truly centered while the left/right groups shrink
          and truncate with the window width. */}
      {onOpenCommandPalette && (
        <div className="hidden min-w-0 flex-none items-center justify-center px-2 lg:flex">
          <button
            type="button"
            onClick={onOpenCommandPalette}
            title="Search commands and files (Ctrl+P)"
            className="flex h-[22px] w-[min(28vw,280px)] items-center justify-center gap-2 rounded-[6px] b border-(--border-strong) bg-(--fill-1) text-[11.5px] text-[var(--text-muted)] transition-colors hover:border-(--border-strong) hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
          >
            <IoSearch size={11} />
            Search
          </button>
        </div>
      )}
      {/* Right: provider/model pill */}
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
        {right && <div className="flex min-w-0 items-center gap-2">{right}</div>}
      </div>
    </nav>
  );
}
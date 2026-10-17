/*
 * Chat history sidebar — flat session list with search, date grouping and
 * inline delete. Purely presentational: session state lives in App.
 *
 * Also home to the app-level controls that used to live in the removed top
 * menu: the Context/File/View/Help dropdown menus and the command-palette
 * search button.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatSession } from "../src/types";
import { providerById } from "../src/providers";
import { IoAdd, IoClose, IoSearch, IoTrashOutline } from "react-icons/io5";
import { openExternalUrl as openUrl } from "../src/lib/external";
import { useErrorHandler } from "../src/errorContext";
import { useTranslation } from "../src/i18n";
// import appIcon from "../src/assets/images/icon.jpeg";
interface Props {
  isOpen: boolean;
  onClose: () => void;
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onDeleteSession: (id: string) => void;
  /** True when the user is signed in — chats then sync to their account. */
  signedIn?: boolean;

  /* App-level controls relocated from the removed top menu. */
  onOpenInfoPanel?: () => void;
  onOpenTab2?: () => void;
  onOpenAiSettings?: () => void;
  onOpenSettings?: () => void;
  /** Opens Settings directly on the Plugins section. */
  onOpenPlugins?: () => void;
  onOpenAccount?: () => void;
  /** Opens the command palette (was the top bar's Search pill). */
  onOpenCommandPalette?: () => void;
  onCheckForUpdates?: () => void;
  onAnalyzeProject?: () => void;
  onSaveSession?: () => void;
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

const DAY = 24 * 60 * 60 * 1000;

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / (60 * 60_000))}h ago`;
  if (diff < 7 * DAY) return new Date(ts).toLocaleDateString([], { weekday: "short" });
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

type Group = "Today" | "Previous 7 days" | "Older";

function groupFor(ts: number): Group {
  const diff = Date.now() - ts;
  if (diff < DAY) return "Today";
  if (diff < 7 * DAY) return "Previous 7 days";
  return "Older";
}

const ICON_BUTTON =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-(--fill-1) hover:text-[var(--text-primary)]";

export default function ChatHistorySidebar({
  isOpen,
  onClose,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
  // signedIn = false,
  onOpenInfoPanel,
  onOpenTab2,
  onOpenAiSettings,
  onOpenSettings,
  onOpenPlugins,
  onOpenAccount,
  onOpenCommandPalette,
  onCheckForUpdates,
  onAnalyzeProject,
  onSaveSession,
  onPinFile,
  contextEntries,
  pinnedPaths,
}: Props) {
  const [query, setQuery] = useState("");

  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { reportError } = useErrorHandler();
  const { t } = useTranslation();
  /* Close an open menu when clicking anywhere outside the menu row. */
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

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

  /** The old top-bar menus, relocated into the sidebar. */
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
              { label: t("app.contextTarget"), action: () => {}, disabled: true },
              ...contextItems,
            ]
          : [{ label: t("app.noFolderOpen"), action: () => {}, disabled: true }]),
      ],
    },
    {
      label: t("app.file"),
      items: [
        { label: t("app.newChat"), action: onNewChat, shortcut: "Ctrl+Shift+H" },
        { label: t("app.chatHistory"), action: onClose, shortcut: "Ctrl+H" },
      ],
    },
    {
      label: t("app.view"),
      items: [
        { label: t("app.chatHistory"), action: onClose, shortcut: "Ctrl+Shift+H" },
        { label: t("app.aiSettings"), action: () => onOpenAiSettings?.(), shortcut: "Ctrl+B" },
        ...(onOpenSettings
          ? [{ label: t("app.settingsMenu"), action: onOpenSettings, shortcut: "Ctrl+," }]
          : []),
        ...(onOpenAccount ? [{ label: t("app.account"), action: onOpenAccount }] : []),
      ],
    },
    {
      label: t("app.help"),
      items: [
        { label: t("app.documentation"), action: openDocs },
        { label: t("app.aboutContact"), action: () => onOpenInfoPanel?.() },
        { label: t("app.privacyPolicy"), action: openPrivacyPolicy },
        { label: t("app.rateApp"), action: () => onOpenTab2?.() },
        ...(onCheckForUpdates
          ? [{ label: t("app.checkForUpdates"), action: onCheckForUpdates }]
          : []),
      ],
    },
  ];
  const openMenuDef = openMenu ? (menus.find((m) => m.label === openMenu) ?? null) : null;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = [...sessions]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter((s) => {
        if (!q) return true;
        const model = s.settings?.model || providerById(s.settings?.provider ?? "openai").label;
        return `${s.title ?? ""} ${model}`.toLowerCase().includes(q);
      });
    const map: Record<Group, ChatSession[]> = { Today: [], "Previous 7 days": [], Older: [] };
    for (const s of filtered) map[groupFor(s.updatedAt)].push(s);
    return (Object.keys(map) as Group[])
      .map((label) => ({ label, items: map[label] }))
      .filter((g) => g.items.length > 0);
  }, [sessions, query]);

  return (
    <aside
      className={`glass-panel shrink-0 overflow-hidden border-r border-(--border) bg-[var(--bg-panel)] transition-[width] duration-150 ease-out ${
        isOpen ? "w-[360px] max-sm:w-full" : "w-0"
      }`}
    >
      {isOpen && (
        <div className="flex h-full w-full flex-col">
          {/* Menus — relocated from the removed top bar */}
          <div ref={menuRef} className="relative flex shrink-0 items-center gap-0.5 px-1.5 pt-2">
            {menus.map((menu) => (
              <button
                key={menu.label}
                type="button"
                onClick={() => setOpenMenu(openMenu === menu.label ? null : menu.label)}
                onMouseEnter={() => openMenu && setOpenMenu(menu.label)}
                className={`rounded-[4px] px-1.5 py-[3px] text-[12px] transition-colors ${
                  openMenu === menu.label
                    ? "bg-(--fill-2) text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
                }`}
              >
                {menu.label}
              </button>
            ))}
            {onOpenCommandPalette && (
              <button
                type="button"
                onClick={onOpenCommandPalette}
                title="Search commands and files (Ctrl+Shift+P)"
                aria-label="Search commands and files"
                className={`ml-auto ${ICON_BUTTON}`}
              >
                <IoSearch size={13} />
              </button>
            )}

            {openMenuDef && (
              <div className="panel-in absolute left-1.5 top-full z-50 mt-1 w-60 overflow-hidden rounded-[5px] border border-(--border) bg-[var(--bg-elevated)] p-[3px]">
                {openMenuDef.items.map((item, i) => (
                  <button
                    key={i}
                    type="button"
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

          {/* Search + actions */}
          <div className="flex shrink-0 items-center gap-1.5 px-2 py-2">
            <div className="relative min-w-0 flex-1">
              <IoSearch className="pointer-events-none absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--text-faint)]" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search chats"
                spellCheck={false}
                aria-label="Search chats"
                className="h-6 w-full rounded-md bg-(--fill-1) pl-6 pr-2 text-[11.5px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-faint)] focus:bg-(--fill-2)"
              />
            </div>
            <button type="button" onClick={onNewChat} title="New chat" aria-label="New chat" className={ICON_BUTTON}>
              <IoAdd size={13} />
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Close"
              aria-label="Close chat history"
              className={ICON_BUTTON}
            >
              <IoClose size={13} />
            </button>
          </div>

          {/* Sessions */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
            {groups.length === 0 && (
              <p className="px-3 py-6 text-center text-[11px] text-[var(--text-muted)]">
                {query.trim() ? "No chats match." : "No chats yet."}
              </p>
            )}
            {groups.map((group) => (
              <div key={group.label} className="pt-3 first:pt-0">
                <p className="px-3 pb-1 text-[10.5px] text-[var(--text-faint)]">{group.label}</p>
                {group.items.map((session) => {
                  const isActive = session.id === activeSessionId;
                  const confirming = confirmId === session.id;
                  const model =
                    session.settings?.model ||
                    providerById(session.settings?.provider ?? "openai").label;
                  return (
                    <div
                      key={session.id}
                      className={`group relative flex items-center ${
                        isActive ? "bg-(--fill-1)" : "hover:bg-(--fill-1)"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectSession(session.id)}
                        className="min-w-0 flex-1 px-3 py-2 text-left"
                      >
                        <span
                          className={`block truncate text-[12px] ${
                            isActive ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
                          }`}
                        >
                          {session.title || "Untitled chat"}
                        </span>
                        <span className="mt-0.5 block truncate text-[10.5px] text-[var(--text-muted)]">
                          {formatRelative(session.updatedAt)}
                          {model ? ` · ${model}` : ""}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={confirming ? "Click again to delete" : "Delete chat"}
                        title={confirming ? "Click again to delete" : "Delete chat"}
                        onClick={() => {
                          if (confirming) {
                            onDeleteSession(session.id);
                            setConfirmId(null);
                          } else {
                            setConfirmId(session.id);
                          }
                        }}
                        className={`mr-1.5 flex h-6 shrink-0 items-center justify-center rounded-md transition ${
                          confirming
                            ? "w-auto px-1.5 text-[10px] text-[var(--danger)]"
                            : "w-6 text-[var(--text-muted)] opacity-0 hover:text-[var(--danger)] group-hover:opacity-100"
                        }`}
                      >
                        {confirming ? "Delete?" : <IoTrashOutline size={12} />}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          
              <div className="flex shrink-0 items-center gap-1.5 px-4 py-3 m-2">
                <button
                  onClick={() => onOpenPlugins?.()}
                  className="bg-transparent hover:bg-(--fill-1) transition-colors duration-200 rounded-2xl w-25"
                >
                  <span className = "flex items-center gap-1.25 w-100"><IoAdd/>Add PlugIns</span>
                </button>
              </div>
          </div>
          {/* <div className="flex shrink-0 items-center gap-1.5 border-t border-(--border) px-3 py-2">
            <img src={appIcon} alt="" className="h-3.5 w-3.5 rounded-[3px]" />
            <span className="text-[11px] font-semibold text-[var(--text-secondary)]">Struct</span>
            <span className="ml-auto text-[10px] text-[var(--text-faint)]">
              {signedIn ? "Synced to your account." : "Stored on this device."}
            </span>
          </div> */}
        </div>
      )}
    </aside>
  );
}

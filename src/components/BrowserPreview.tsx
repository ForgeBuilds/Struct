import { useEffect, useRef, useState } from "react";
import {
  IoAdd,
  IoArrowBack,
  IoArrowForward,
  IoClose,
  IoGlobeOutline,
  IoOpenOutline,
  IoRefresh,
} from "react-icons/io5";
import { invoke, isNativeRuntime, listen } from "../native";
import { normalizeBrowserPreviewUrl, type BrowserPreviewTab } from "../browserPreview";

interface BrowserPreviewProps {
  visible: boolean;
  tabs: BrowserPreviewTab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onOpenTab: (url: string) => void;
  onCloseTab: (id: string) => void;
  onNavigateTab: (id: string, url: string) => void;
}

function browserCommandError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/Electron native command is not implemented: browser_view_/i.test(message)) {
    return "The running Electron process has not loaded browser preview support. Restart the full Electron app (or rebuild and relaunch the desktop app); refreshing the renderer alone is not enough.";
  }
  return message;
}

function BrowserSurface({
  tab,
  active,
  onNavigate,
}: {
  tab: BrowserPreviewTab;
  active: boolean;
  onNavigate: (id: string, url: string) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const initialUrlRef = useRef(tab.url);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const native = isNativeRuntime();

  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void invoke<{ loaded: boolean; error?: string }>("browser_view_create", {
      id: tab.id,
      url: initialUrlRef.current,
    })
      .then((result) => {
        if (!cancelled) {
          setReady(true);
          setLoadError(result.error ?? null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(browserCommandError(error));
        }
      });
    void listen<{ id: string; url: string }>("browser:navigation", (event) => {
      if (event.payload.id === tab.id) {
        setLoadError(null);
        onNavigate(tab.id, event.payload.url);
      }
    }).then((stop) => {
      if (cancelled) stop();
      else unlisten = stop;
    });
    return () => {
      cancelled = true;
      unlisten?.();
      void invoke("browser_view_close", { id: tab.id }).catch((error: unknown) => {
        console.warn("Could not close the in-app browser tab:", error);
      });
    };
  }, [native, onNavigate, tab.id]);

  useEffect(() => {
    if (!native) return;
    const syncBounds = () => {
      if (!ready) return;
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      void invoke("browser_view_bounds", {
        id: tab.id,
        x: rect.x,
        y: rect.y,
        width: active ? rect.width : 0,
        height: active ? rect.height : 0,
      }).catch((error: unknown) => {
        setLoadError(browserCommandError(error));
      });
    };
    const observer = new ResizeObserver(syncBounds);
    if (viewportRef.current) observer.observe(viewportRef.current);
    window.addEventListener("resize", syncBounds);
    syncBounds();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncBounds);
    };
  }, [active, native, ready, tab.id]);

  return (
    <div
      ref={viewportRef}
      className="relative min-h-0 flex-1 overflow-hidden bg-white"
      style={{ display: active ? "flex" : "none" }}
    >
      {native ? (
        loadError && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--bg-base)] p-6 text-center text-[12px] text-[var(--danger)]">
            {loadError}
          </div>
        )
      ) : (
        <iframe
          title={`Browser preview: ${tab.url}`}
          src={tab.url}
          sandbox="allow-scripts allow-forms allow-downloads"
          className="h-full w-full border-0"
        />
      )}
    </div>
  );
}

export default function BrowserPreview({
  visible,
  tabs,
  activeTabId,
  onSelectTab,
  onOpenTab,
  onCloseTab,
  onNavigateTab,
}: BrowserPreviewProps) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const [addressError, setAddressError] = useState<string | null>(null);

  const openAddress = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("browser-address");
    if (!(input instanceof HTMLInputElement)) return;
    try {
      const url = normalizeBrowserPreviewUrl(input.value);
      setAddressError(null);
      if (activeTab) {
        onNavigateTab(activeTab.id, url);
        if (isNativeRuntime()) {
          void invoke("browser_view_navigate", { id: activeTab.id, url }).catch((error: unknown) => {
            setAddressError(browserCommandError(error));
          });
        }
      } else {
        onOpenTab(url);
      }
    } catch (error) {
      setAddressError(error instanceof Error ? error.message : String(error));
    }
  };

  const perform = (command: string) => {
    if (!activeTab) return;
    void invoke(command, { id: activeTab.id }).catch((error: unknown) => {
      setAddressError(browserCommandError(error));
    });
  };

  return (
    <section className="min-h-0 flex-1 flex-col overflow-hidden" style={{ display: visible ? "flex" : "none" }}>
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-(--border) px-2 pt-1.5">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`flex max-w-56 shrink-0 items-center gap-1 rounded-t-md px-2 py-1.5 text-[11px] ${
              activeTab?.id === tab.id
                ? "bg-(--fill-2) text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:bg-(--fill-1)"
            }`}
          >
            <button type="button" onClick={() => onSelectTab(tab.id)} className="flex min-w-0 items-center gap-1.5">
              <IoGlobeOutline className="shrink-0" />
              <span className="truncate">{tab.url ? new URL(tab.url).host : "New tab"}</span>
            </button>
            <button
              type="button"
              onClick={() => onCloseTab(tab.id)}
              aria-label="Close browser tab"
              className="rounded p-0.5 hover:bg-(--fill-2)"
            >
              <IoClose />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onOpenTab("http://localhost:3000")}
          title="New browser tab"
          aria-label="New browser tab"
          className="mb-1 rounded p-1.5 text-[var(--text-muted)] hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
        >
          <IoAdd />
        </button>
      </div>

      <form onSubmit={openAddress} className="flex shrink-0 items-center gap-2 border-b border-(--border) px-3 py-2">
        <button type="button" onClick={() => perform("browser_view_back")} disabled={!activeTab} title="Back" className="rounded p-1.5 text-[var(--text-muted)] hover:bg-(--fill-2) disabled:opacity-40">
          <IoArrowBack />
        </button>
        <button type="button" onClick={() => perform("browser_view_forward")} disabled={!activeTab} title="Forward" className="rounded p-1.5 text-[var(--text-muted)] hover:bg-(--fill-2) disabled:opacity-40">
          <IoArrowForward />
        </button>
        <button type="button" onClick={() => perform("browser_view_reload")} disabled={!activeTab} title="Reload" className="rounded p-1.5 text-[var(--text-muted)] hover:bg-(--fill-2) disabled:opacity-40">
          <IoRefresh />
        </button>
        <input
          key={`${activeTab?.id ?? "empty"}:${activeTab?.url ?? ""}`}
          name="browser-address"
          type="text"
          defaultValue={activeTab?.url ?? ""}
          placeholder="http://localhost:3000"
          aria-label="Browser address"
          className="min-w-0 flex-1 rounded-md border border-(--border) bg-(--fill-1) px-3 py-1.5 text-[12px] text-[var(--text-primary)] outline-none focus:border-(--border-strong)"
        />
        <button type="submit" className="rounded-md bg-(--fill-2) px-3 py-1.5 text-[11px] text-[var(--text-primary)] hover:bg-(--fill-3)">
          Go
        </button>
        {activeTab && isNativeRuntime() && (
          <button
            type="button"
            onClick={() => void invoke("browser_view_external", { id: activeTab.id })}
            title="Open in default browser"
            className="rounded p-1.5 text-[var(--text-muted)] hover:bg-(--fill-2) hover:text-[var(--text-primary)]"
          >
            <IoOpenOutline />
          </button>
        )}
      </form>

      {addressError && <p role="status" className="shrink-0 px-3 py-1 text-[11px] text-[var(--danger)]">{addressError}</p>}
      {tabs.length === 0 && (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center">
          <IoGlobeOutline size={28} className="text-[var(--text-muted)]" />
          <p className="text-[13px] text-[var(--text-secondary)]">Preview a site or local development server</p>
          <button type="button" onClick={() => onOpenTab("http://localhost:3000")} className="rounded-md bg-(--fill-2) px-3 py-1.5 text-[11px] hover:bg-(--fill-3)">
            Open localhost:3000
          </button>
        </div>
      )}
      {tabs.map((tab) => (
        <BrowserSurface
          key={tab.id}
          tab={tab}
          active={visible && activeTab?.id === tab.id}
          onNavigate={onNavigateTab}
        />
      ))}
    </section>
  );
}

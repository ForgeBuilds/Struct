// Single native bridge. Electron owns the window; the preload exposes
// `window.neoDesktop.invoke`. Everything else falls back to plain fetch so
// the UI also runs in a browser preview.

export interface NativeEvent<T = unknown> {
  event: string
  id: number
  payload: T
}

type EventCallback<T> = (event: NativeEvent<T>) => void

/** Call every registered listener for an event name (browser-preview only). */
class BrowserEventBus {
  private handlers = new Map<string, Set<EventCallback<never>>>()

  on<T>(event: string, callback: EventCallback<T>): () => void {
    let set = this.handlers.get(event) as Set<EventCallback<never>> | undefined
    if (!set) {
      set = new Set()
      this.handlers.set(event, set)
    }
    set.add(callback as EventCallback<never>)
    return () => {
      set.delete(callback as EventCallback<never>)
      if (set.size === 0) this.handlers.delete(event)
    }
  }

  send<T>(event: string, payload: T): void {
    const handlers = [...(this.handlers.get(event) ?? [])]
    for (const handler of handlers) {
      handler({ event, id: 0, payload: payload as never })
    }
  }
}

const browserBus = new BrowserEventBus()

export function invoke<T = unknown>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (window.neoDesktop) return window.neoDesktop.invoke<T>(command, args)
  return Promise.reject(new Error(`Native command unavailable outside Electron: ${command}`))
}

export function listen<T = unknown>(event: string, callback: EventCallback<T>): Promise<() => void> {
  if (window.neoDesktop) return window.neoDesktop.listen<T>(event, callback)
  return Promise.resolve(browserBus.on(event, callback))
}

export function emit(event: string, payload?: unknown): Promise<void> {
  if (window.neoDesktop) return window.neoDesktop.emit(event, payload)
  browserBus.send(event, payload)
  return Promise.resolve()
}

export function isNativeRuntime(): boolean {
  return Boolean(window.neoDesktop)
}

export interface DialogFilter {
  name: string
  extensions: string[]
}

export interface OpenDialogOptions {
  title?: string
  defaultPath?: string
  directory?: boolean
  multiple?: boolean
  filters?: DialogFilter[]
}

/** Native folder/file picker. Resolves to an empty array when it is cancelled
 *  or when no Electron bridge is present, so callers can treat both the same. */
export async function openDialog(options: OpenDialogOptions): Promise<string[]> {
  if (!window.neoDesktop) return []
  const result = await window.neoDesktop.openDialog(options)
  if (!result) return []
  return Array.isArray(result) ? result : [result]
}

/** Native "Save as…" picker. Resolves to null when cancelled / unsupported. */
export async function saveDialog(options: {
  title?: string
  defaultPath?: string
  filters?: DialogFilter[]
}): Promise<string | null> {
  if (!window.neoDesktop) return null
  return window.neoDesktop.saveDialog(options)
}


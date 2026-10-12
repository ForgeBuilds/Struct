// Preload bridge for the Electron shell. The OS draws the window frame,
// so there are no custom window-control methods here.
interface NeoDesktopBridge {
  readonly platform: string
  invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>
  listen<T = unknown>(
    event: string,
    callback: (event: { event: string; id: number; payload: T }) => void,
  ): Promise<() => void>
  emit(event: string, payload?: unknown): Promise<void>
  openExternal(url: string): Promise<void>
  openDialog(options?: {
    title?: string
    defaultPath?: string
    directory?: boolean
    multiple?: boolean
    filters?: { name: string; extensions: string[] }[]
  }): Promise<string | string[] | null>
  saveDialog(options?: {
    title?: string
    defaultPath?: string
    filters?: { name: string; extensions: string[] }[]
  }): Promise<string | null>
  onDeepLink(callback: (url: string) => void): () => void
}

interface Window {
  neoDesktop?: NeoDesktopBridge
}


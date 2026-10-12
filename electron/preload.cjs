const { contextBridge, ipcRenderer } = require('electron')

const eventHandlers = new Map()

ipcRenderer.on('neo:event', (_event, message) => {
  const handlers = eventHandlers.get(message.event)
  if (!handlers) return
  const event = { event: message.event, id: 0, payload: message.payload }
  for (const handler of [...handlers]) handler(event)
})

// Native frame: the OS draws min/max/close. No custom window controls.
const desktop = Object.freeze({
  platform: process.platform,
  invoke: (command, args) => ipcRenderer.invoke('neo:native-invoke', command, args),
  listen: async (event, callback) => {
    let handlers = eventHandlers.get(event)
    if (!handlers) {
      handlers = new Set()
      eventHandlers.set(event, handlers)
    }
    handlers.add(callback)
    return () => {
      handlers.delete(callback)
      if (handlers.size === 0) eventHandlers.delete(event)
    }
  },
  emit: (event, payload) => ipcRenderer.invoke('neo:event:emit', event, payload),
  openExternal: (url) => ipcRenderer.invoke('neo:open-external', url),
  openDialog: (options) => ipcRenderer.invoke('neo:dialog:open', options),
  saveDialog: (options) => ipcRenderer.invoke('neo:dialog:save', options),
  onDeepLink: (callback) => {
    const listener = (_event, url) => callback(url)
    ipcRenderer.on('neo:deep-link', listener)
    ipcRenderer.send('neo:deep-link:ready')
    return () => ipcRenderer.removeListener('neo:deep-link', listener)
  },
})

contextBridge.exposeInMainWorld('neoDesktop', desktop)
window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.dataset.neoShell = 'electron'
})


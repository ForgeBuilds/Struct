const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron')
const { createServer } = require('node:http')
const { spawn } = require('node:child_process')
const { timingSafeEqual } = require('node:crypto')
const { existsSync } = require('node:fs')
const { realpath, readFile, rename, mkdir, writeFile } = require('node:fs/promises')
const { homedir } = require('node:os')
const { dirname, join } = require('node:path')
const { once } = require('node:events')

const APP_PROTOCOL = 'agenticcoder'
let mainWindow
let deepLinkReady = false
const pendingDeepLinks = []
let chatSnapshot = {
  sessionId: null,
  messages: [],
  isLoading: false,
  models: [],
}
let authSnapshot = { user: null, accessToken: null }
let bridgeServer

const APP_DATA_ID = 'com.lumorixstudios.agenticcoder'
const appDataRoot =
  process.platform === 'linux'
    ? process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
    : app.getPath('appData')
app.setPath('userData', join(appDataRoot, APP_DATA_ID))

function emitToRenderer(event, payload) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('neo:event', { event, payload })
  }
}

function sendDeepLink(url) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingDeepLinks.push(url)
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
  if (deepLinkReady) mainWindow.webContents.send('neo:deep-link', url)
  else pendingDeepLinks.push(url)
}

function flushDeepLinks(event) {
  for (const url of pendingDeepLinks.splice(0)) {
    event.sender.send('neo:deep-link', url)
  }
}

function handleDeepLink(argv) {
  const url = argv.find((value) => value.startsWith(`${APP_PROTOCOL}://`))
  if (url) sendDeepLink(url)
}

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value)
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  response.end(body)
}

async function readJsonBody(request, limit = 64 * 1024) {
  const chunks = []
  let length = 0
  for await (const chunk of request) {
    length += chunk.length
    if (length > limit) throw new Error('Request body is too large')
    chunks.push(chunk)
  }
  if (!length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function isAuthorized(request, token) {
  const actual = Buffer.from(request.headers.authorization ?? '')
  const expected = Buffer.from(`Bearer ${token}`)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

async function startAgentBridge(token) {
  await stopAgentBridge()
  const server = createServer((request, response) => {
    void (async () => {
      if (!isAuthorized(request, token)) return sendJson(response, 401, { error: 'Unauthorized' })
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      if (request.method === 'GET' && path === '/state') return sendJson(response, 200, chatSnapshot)
      if (request.method === 'GET' && path === '/auth-session') return sendJson(response, 200, authSnapshot)
      if (request.method === 'POST' && path === '/prompt') {
        if (chatSnapshot.isLoading) {
          return sendJson(response, 409, { error: 'Neo is already responding' })
        }
        const body = await readJsonBody(request)
        if (typeof body.text !== 'string' || !body.text.trim()) {
          return sendJson(response, 400, { error: 'Prompt cannot be empty' })
        }
        if (typeof body.requestId !== 'string' || !body.requestId || body.requestId.length > 128) {
          return sendJson(response, 400, { error: 'Invalid request id' })
        }
        emitToRenderer('neo:agent-panel-prompt', {
          text: body.text,
          requestId: body.requestId,
        })
        return sendJson(response, 202, { accepted: true })
      }
      if (request.method === 'POST' && path === '/models') {
        const body = await readJsonBody(request)
        if (
          (body.provider !== undefined &&
            (typeof body.provider !== 'string' || !body.provider || body.provider.length > 64)) ||
          (body.model !== undefined &&
            (typeof body.model !== 'string' || !body.model || body.model.length > 256)) ||
          (body.provider === undefined) !== (body.model === undefined)
        ) {
          return sendJson(response, 400, { error: 'Invalid model selection' })
        }
        const selection =
          typeof body.provider === 'string' && typeof body.model === 'string'
            ? { provider: body.provider, model: body.model }
            : undefined
        emitToRenderer('neo:agent-panel-models', selection)
        return sendJson(response, 202, { accepted: true })
      }
      if (request.method === 'POST' && path === '/account') {
        emitToRenderer('neo:agent-panel-account')
        return sendJson(response, 202, { accepted: true })
      }
      if (request.method === 'POST' && path === '/signout') {
        emitToRenderer('neo:agent-panel-signout')
        return sendJson(response, 202, { accepted: true })
      }
      return sendJson(response, 404, { error: 'Not found' })
    })().catch((error) => {
      if (!response.headersSent) sendJson(response, 400, { error: error.message })
      else response.destroy(error)
    })
  })

  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolveListen()
    })
  })
  bridgeServer = server
  const address = server.address()
  if (!address || typeof address === 'string') {
    await stopAgentBridge()
    throw new Error('Neo chat bridge did not bind to a TCP port')
  }
  return `http://127.0.0.1:${address.port}`
}

async function stopAgentBridge() {
  if (!bridgeServer) return
  const server = bridgeServer
  bridgeServer = undefined
  await new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()))
  })
}

async function launchIde(workspace, bridgeToken) {
  const root = await realpath(workspace)
  if (!statSyncIsDirectory(root)) throw new Error(`Workspace is not a directory: ${root}`)
  if (typeof bridgeToken !== 'string' || bridgeToken.length < 16) {
    throw new Error('Invalid CODE-OSS bridge token')
  }

  const ideCandidates = [
    process.env.STRUCT_IDE_ELECTRON,
    join(app.getAppPath(), '..', 'Vector', '.build', 'electron', 'struct'),
    join(process.resourcesPath, 'ide', 'struct'),
  ].filter(Boolean)
  const idePath = ideCandidates.find((candidate) => existsSync(candidate))
  if (!idePath) throw new Error('CODE-OSS was not found. Set STRUCT_IDE_ELECTRON to its Electron executable.')

  const extensionPath = app.isPackaged
    ? join(process.resourcesPath, 'neo-chat-bridge')
    : join(app.getAppPath(), 'src-tauri', 'resources', 'neo-chat-bridge')
  if (!existsSync(join(extensionPath, 'package.json'))) {
    throw new Error(`Neo CODE-OSS chat bridge is missing at ${extensionPath}`)
  }

  const bridgeUrl = await startAgentBridge(bridgeToken)
  const profile = join(app.getPath('userData'), 'code-oss')
  const ideRoot = process.env.STRUCT_IDE_APP_ROOT || dirname(dirname(idePath))
  await mkdir(profile, { recursive: true })
  const child = spawn(
    idePath,
    [
      '.',
      root,
      `--user-data-dir=${profile}`,
      `--extensionDevelopmentPath=${extensionPath}`,
      '--disable-extension=struct.struct-agent',
      '--disable-extension=GitHub.copilot',
      '--disable-extension=GitHub.copilot-chat',
      '--enable-proposed-api=lumorix.neo-chat-bridge',
      '--new-window',
    ],
    {
      cwd: ideRoot,
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        VSCODE_AGENT_HOST_COPILOT_AGENT_ENABLED: 'false',
        STRUCT_NEO_BRIDGE_URL: bridgeUrl,
        STRUCT_NEO_BRIDGE_TOKEN: bridgeToken,
      },
    },
  )
  await Promise.race([
    once(child, 'spawn'),
    once(child, 'error').then(([error]) => Promise.reject(error)),
  ])
  child.unref()
}

function statSyncIsDirectory(path) {
  try {
    return require('node:fs').statSync(path).isDirectory()
  } catch {
    return false
  }
}

function stateFile(key) {
  if (typeof key !== 'string' || !key || key.includes('..') || /[\\/:]/.test(key)) {
    throw new Error('Invalid state key')
  }
  return join(app.getPath('userData'), `${key}.json`)
}

async function readState(key) {
  try {
    return await readFile(stateFile(key), 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return ''
    throw error
  }
}

async function writeState(key, value) {
  if (typeof value !== 'string') throw new Error('State value must be a string')
  const file = stateFile(key)
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  await writeFile(temp, value, { mode: 0o600 })
  await rename(temp, file)
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => handleDeepLink(argv))
  app.on('open-url', (event, url) => {
    event.preventDefault()
    sendDeepLink(url)
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 660,
    minHeight: 400,
    show: false,
    frame: false,
    backgroundColor: '#0e0e0e',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.on('did-start-loading', () => {
    deepLinkReady = false
  })
  mainWindow.on('closed', () => {
    mainWindow = undefined
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openExternal(url).catch((error) => console.error('[electron] Open external URL failed:', error))
    return { action: 'deny' }
  })

  const devUrl = process.env.NEO_DEV_SERVER_URL
  if (devUrl) {
    void mainWindow.loadURL(devUrl).catch((error) => {
      console.error(`[electron] Could not load ${devUrl}:`, error)
    })
  } else {
    void mainWindow.loadFile(join(__dirname, '..', 'dist', 'index.html')).catch((error) => {
      console.error('[electron] Could not load the packaged Neo UI:', error)
    })
  }
}

async function openExternal(value) {
  if (typeof value !== 'string') throw new Error('External URL must be a string')
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('Invalid external URL')
  }

  if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) {
    throw new Error(`Unsupported external URL scheme: ${url.protocol}`)
  }
  await shell.openExternal(url.href)
}

function requireMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('Neo window is not available')
  }
  return mainWindow
}

ipcMain.handle('neo:window:minimize', () => requireMainWindow().minimize())
ipcMain.handle('neo:native-invoke', async (_event, command, args = {}) => {
  if (typeof command !== 'string') throw new Error('Native command name must be a string')
  switch (command) {
    case 'get_app_version':
      return app.getVersion()
    case 'load_state': {
      return readState(args.key)
    }
    case 'save_state':
      if (typeof args.value !== 'string') throw new Error('State value must be a string')
      return writeState(args.key, args.value)
    case 'struct_agent_bridge_publish': {
      if (typeof args.snapshot !== 'string' || Buffer.byteLength(args.snapshot) > 4 * 1024 * 1024) {
        throw new Error('Neo chat snapshot is too large or invalid')
      }
      const snapshot = JSON.parse(args.snapshot)
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        throw new Error('Neo chat snapshot must be a JSON object')
      }
      chatSnapshot = snapshot
      return null
    }
    case 'struct_agent_bridge_publish_auth': {
      if (typeof args.snapshot !== 'string' || Buffer.byteLength(args.snapshot) > 64 * 1024) {
        throw new Error('Neo account session is too large or invalid')
      }
      const snapshot = JSON.parse(args.snapshot)
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        throw new Error('Neo account session must be a JSON object')
      }
      authSnapshot = snapshot
      return null
    }
    case 'struct_ide_launch':
      await launchIde(args.workspace, args.bridgeToken)
      return null
    default:
      throw new Error(`Electron native command is not implemented yet: ${command}`)
  }
})
ipcMain.handle('neo:event:emit', (_event, event, payload) => {
  if (typeof event !== 'string' || !/^[\w:/-]+$/.test(event)) {
    throw new Error('Invalid event name')
  }
  emitToRenderer(event, payload)
})
ipcMain.on('neo:deep-link:ready', (event) => {
  if (event.sender === mainWindow?.webContents) {
    deepLinkReady = true
    flushDeepLinks(event)
  }
})
ipcMain.handle('neo:window:toggle-maximize', () => {
  const window = requireMainWindow()
  if (window.isMaximized()) window.unmaximize()
  else window.maximize()
  return window.isMaximized()
})
ipcMain.handle('neo:window:is-maximized', () => requireMainWindow().isMaximized())
ipcMain.handle('neo:window:close', () => requireMainWindow().close())
ipcMain.handle('neo:open-external', (_event, url) => openExternal(url))
ipcMain.handle('neo:dialog:open', async (_event, options = {}) => {
  const result = await dialog.showOpenDialog(requireMainWindow(), {
    properties: options.directory ? ['openDirectory'] : ['openFile'],
    filters: options.filters,
  })
  return result.canceled ? null : options.multiple ? result.filePaths : result.filePaths[0] ?? null
})
ipcMain.handle('neo:dialog:save', async (_event, options = {}) => {
  const result = await dialog.showSaveDialog(requireMainWindow(), {
    defaultPath: options.defaultPath,
    filters: options.filters,
  })
  return result.canceled ? null : result.filePath ?? null
})

if (hasSingleInstanceLock) {
  app.whenReady()
    .then(() => {
      Menu.setApplicationMenu(null)
      app.setAsDefaultProtocolClient(APP_PROTOCOL)
      handleDeepLink(process.argv)
      createWindow()

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
      })
    })
    .catch((error) => {
      console.error('[electron] Neo failed to start:', error)
      app.quit()
    })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', () => {
    void stopAgentBridge().catch((error) => console.error('[electron] Could not stop the Neo bridge:', error))
  })
}

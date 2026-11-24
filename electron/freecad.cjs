/*
 * Author: Lumorix Studios
 * Check the LICENSE in the GitHub repo for more information on permissions to use this code.
 */

/*
 * FreeCAD plugin runtime.
 *
 * FreeCAD is a full desktop CAD application, not a Node library, so it cannot
 * be embedded in the Electron bundle the way the FreeLLMAPI router is. Instead
 * this module:
 *   1. finds a FreeCAD installation on the machine,
 *   2. installs the bundled MCP addon into FreeCAD's user Mod directory,
 *   3. launches FreeCAD, and
 *   4. reports whether the addon's XML-RPC bridge is answering.
 *
 * The MCP server itself is electron/freecad-mcp.cjs, a stdio bridge launched by
 * the normal MCP client (see mcpCommand).
 */

const { spawn, spawnSync } = require('node:child_process')
const {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} = require('node:fs')
const { homedir } = require('node:os')
const { join } = require('node:path')

const RPC_PORT = 9875
const RPC_HOST = '127.0.0.1'
const ADDON_NAME = 'FreeCADMCP'
const SETTINGS_FILE = 'freecad_mcp_settings.json'

function firstExisting(paths) {
  for (const path of paths) {
    if (!path) continue
    try {
      if (existsSync(path)) return path
    } catch {
      /* keep looking */
    }
  }
  return null
}

function which(command) {
  const finder = process.platform === 'win32' ? 'where' : 'which'
  const result = spawnSync(finder, [command], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) return null
  const line = String(result.stdout || '')
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(Boolean)
  return line || null
}

function windowsProgramDirs() {
  // System installs land in "C:\Program Files\FreeCAD 1.0"; per-user installs
  // land in "%LOCALAPPDATA%\Programs\FreeCAD 1.0". Scan both roots.
  const roots = []
  for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]) {
    if (!root) continue
    roots.push(root)
    if (root === process.env.LOCALAPPDATA) roots.push(join(root, 'Programs'))
  }
  const candidates = []
  for (const root of new Set(roots)) {
    try {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^FreeCAD/i.test(entry.name)) continue
        candidates.push(join(root, entry.name, 'bin', 'FreeCAD.exe'))
      }
    } catch {
      /* directory is missing or unreadable */
    }
  }
  return candidates
}

function executableCandidates() {
  const home = homedir()
  if (process.platform === 'win32') {
    const programFiles = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)
    return [
      ...windowsProgramDirs(),
      ...programFiles.map((root) => join(root, 'FreeCAD', 'bin', 'FreeCAD.exe')),
      join(process.env.LOCALAPPDATA || '', 'Programs', 'FreeCAD', 'bin', 'FreeCAD.exe'),
      which('FreeCAD.exe'),
    ]
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/FreeCAD.app/Contents/MacOS/FreeCAD',
      join(home, 'Applications/FreeCAD.app/Contents/MacOS/FreeCAD'),
      '/opt/homebrew/bin/freecad',
      '/usr/local/bin/freecad',
      which('freecad'),
    ]
  }
  return [
    '/usr/bin/freecad',
    '/usr/local/bin/freecad',
    '/snap/bin/freecad',
    '/var/lib/flatpak/exports/bin/org.freecad.FreeCAD',
    join(home, '.local/share/flatpak/exports/bin/org.freecad.FreeCAD'),
    join(home, 'Applications/FreeCAD.AppImage'),
    which('freecad'),
  ]
}

function appDataCandidates(executable) {
  const home = homedir()
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming')
    return [join(appData, 'FreeCAD', 'v1-1'), join(appData, 'FreeCAD')]
  }
  if (process.platform === 'darwin') {
    return [join(home, 'Library/Application Support/FreeCAD')]
  }
  // Snap and Flatpak sandboxes redirect FreeCAD's user data dir, so the
  // package that owns the executable decides which candidate comes first.
  const xdg = [join(home, '.local/share/FreeCAD/v1-1'), join(home, '.local/share/FreeCAD')]
  const snap = join(home, 'snap/freecad/common')
  const flatpak = join(home, '.var/app/org.freecad.FreeCAD/data/FreeCAD')
  const exe = String(executable || '')
  if (exe.startsWith('/snap/')) return [snap, ...xdg, flatpak]
  if (exe.includes('flatpak')) return [flatpak, ...xdg, snap]
  return [...xdg, snap, flatpak]
}

function detect() {
  const executable = firstExisting(executableCandidates())
  const appDataDir =
    firstExisting(appDataCandidates(executable)) ||
    (process.platform === 'win32'
      ? join(process.env.APPDATA || homedir(), 'FreeCAD')
      : process.platform === 'darwin'
        ? join(homedir(), 'Library/Application Support/FreeCAD')
        : join(homedir(), '.local/share/FreeCAD'))
  const addonDir = join(appDataDir, 'Mod', ADDON_NAME)
  const addonInit = join(addonDir, 'InitGui.py')
  const addonInstalled = existsSync(addonInit)
  let addonVersion = null
  try {
    const xml = readFileSync(join(addonDir, 'package.xml'), 'utf8')
    addonVersion = /<version>([^<]+)<\/version>/.exec(xml)?.[1]?.trim() || null
  } catch {
    /* addon not installed */
  }
  return {
    platform: process.platform,
    executable,
    appDataDir,
    addonDir,
    addonInstalled,
    addonVersion,
    settingsPath: join(appDataDir, SETTINGS_FILE),
  }
}

function rpcPing(timeoutMs = 900) {
  return new Promise((resolve) => {
    const body =
      '<?xml version="1.0"?><methodCall><methodName>ping</methodName><params></params></methodCall>'
    let settled = false
    const done = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const req = require('node:http').request(
      {
        host: RPC_HOST,
        port: RPC_PORT,
        path: '/',
        method: 'POST',
        headers: { 'Content-Type': 'text/xml', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        res.resume()
        res.on('end', () => done(res.statusCode === 200))
        res.on('error', () => done(false))
      }
    )
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      done(false)
    })
    req.on('error', () => done(false))
    req.write(body)
    req.end()
  })
}

function addonSource(app) {
  return join(app.getAppPath(), 'electron', 'freecad-runtime', 'addon', ADDON_NAME)
}

function writeSettings(appDataDir, patch) {
  mkdirSync(appDataDir, { recursive: true })
  const settingsPath = join(appDataDir, SETTINGS_FILE)
  let current = {}
  try {
    current = JSON.parse(readFileSync(settingsPath, 'utf8'))
    if (!current || typeof current !== 'object' || Array.isArray(current)) current = {}
  } catch {
    current = {}
  }
  const next = {
    remote_enabled: false,
    allowed_ips: '127.0.0.1',
    auth_token: '',
    ...current,
    ...patch,
  }
  writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`)
  return settingsPath
}

function installAddon(app) {
  const info = detect()
  if (!info.appDataDir) throw new Error('Could not find the FreeCAD user data directory.')
  const source = addonSource(app)
  if (!existsSync(source)) {
    throw new Error(
      'The bundled FreeCAD MCP addon is missing from this build. Run "npm run build:freecad" once, then restart Struct.'
    )
  }
  const target = info.addonDir
  mkdirSync(join(info.appDataDir, 'Mod'), { recursive: true })
  rmSync(target, { recursive: true, force: true })
  cpSync(source, target, { recursive: true })
  // Keep the upstream MIT notice next to the code we copy into FreeCAD.
  const license = join(app.getAppPath(), 'electron', 'freecad-runtime', 'LICENSE')
  if (existsSync(license)) cpSync(license, join(target, 'LICENSE'))
  const settingsPath = writeSettings(info.appDataDir, { auto_start_rpc: true })
  return { ...detect(), settingsPath, installed: true }
}

function setAutoStart(app, enabled) {
  const info = detect()
  if (!info.appDataDir) return info
  writeSettings(info.appDataDir, { auto_start_rpc: Boolean(enabled) })
  return detect()
}

async function launch(app) {
  const info = detect()
  if (!info.executable) {
    throw new Error(
      'FreeCAD was not found on this computer. Install it from https://www.freecad.org/downloads.php and try again.'
    )
  }
  if (await rpcPing()) return { ...info, launched: true, alreadyRunning: true, rpcRunning: true }

  const child = spawn(info.executable, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  })
  child.unref()

  // Give the GUI and the addon's auto-start timer time to come up. A timeout is
  // not fatal: the UI can refresh after the user finishes loading FreeCAD.
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (await rpcPing()) return { ...info, launched: true, alreadyRunning: false, rpcRunning: true }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return { ...detect(), launched: true, alreadyRunning: false, rpcRunning: false }
}

async function connect(app) {
  const info = detect()
  if (!info.executable) {
    throw new Error(
      'FreeCAD was not found on this computer. Install it from https://www.freecad.org/downloads.php and try again.'
    )
  }
  const addonWasInstalled = info.addonInstalled
  const installed = installAddon(app)
  const launched = await launch(app)
  return {
    ...launched,
    addonInstalled: true,
    addonVersion: installed.addonVersion,
    addonWasInstalled,
  }
}

function mcpCommand(app) {
  return {
    command: process.execPath,
    args: [join(app.getAppPath(), 'electron', 'freecad-mcp.cjs')],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      FREECAD_MCP_HOST: RPC_HOST,
      FREECAD_MCP_PORT: String(RPC_PORT),
    },
  }
}

async function status(app) {
  const info = detect()
  const rpcRunning = await rpcPing()
  return {
    ...info,
    rpcRunning,
    mcp: mcpCommand(app),
  }
}

module.exports = {
  ADDON_NAME,
  RPC_HOST,
  RPC_PORT,
  connect,
  detect,
  installAddon,
  launch,
  mcpCommand,
  rpcPing,
  setAutoStart,
  status,
}

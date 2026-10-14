
/* Neo - Electron main. Pure chat shell, native OS frame. */

// ── Linux GPU/Wayland SIGSEGV workaround ────────────────────────────────────
// This app is pure DOM (no WebGL), yet on Linux desktops/VMs without a
// complete Wayland implementation, Electron 40's default Wayland Ozone backend
// hard-crashes (SIGSEGV) inside the GPU child process on window creation
// ("vaInitialize failed" → the whole binary goes down before "ready-to-show").
//
// The `--ozone-platform` switch is parsed by the native binary *before* any
// main-process JS runs, so `app.commandLine.appendSwitch()` is too late and
// injecting into `process.argv` from inside the entry is also too late. The
// only reliable fix is to re-launch ourselves once with the flag on argv,
// then forward the child's exit code. Prefer X11 (served via XWayland on
// Wayland desktops, so it works everywhere). Override with NEO_OZONE_PLATFORM.
if (process.platform === 'linux' && !process.argv.some((a) => a.startsWith('--ozone-platform'))) {
  const { spawnSync } = require('node:child_process')
  const platform = process.env.NEO_OZONE_PLATFORM || 'x11'
  const relaunch = spawnSync(process.execPath, [...process.argv.slice(1), `--ozone-platform=${platform}`], {
    stdio: 'inherit',
    env: process.env,
  })
  process.exit(relaunch.status ?? 0)
}

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const { spawn } = require('node:child_process')
const { existsSync, statSync, createWriteStream } = require('node:fs')
const { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } = require('node:fs/promises')
const { homedir } = require('node:os')
const { basename, dirname, join } = require('node:path')
const { pipeline } = require('node:stream/promises')

// Software-rendering escape hatch (opt-in). The X11 re-launch above already
// dodges the Wayland vaInitialize SIGSEGV, so hardware acceleration stays ON
// by default — forcing SwiftShader for the whole window made every paint,
// blur and scroll crawl on the CPU. Set NEO_SOFTWARE_RENDER=1 only if the
// host GPU stack is genuinely broken.
if (process.env.NEO_SOFTWARE_RENDER === '1') {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
}

const APP_PROTOCOL = 'agenticcoder'
let mainWindow
let deepLinkReady = false
const pendingDeepLinks = []
const APP_DATA_ID = 'com.lumorixstudios.agenticcoder'
const appDataRoot = process.platform === 'linux'
  ? process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
  : app.getPath('appData')
app.setPath('userData', join(appDataRoot, APP_DATA_ID))

function emitToRenderer(event, payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('neo:event', { event, payload })
  }
}
function sendDeepLink(url) {
  if (!mainWindow || mainWindow.isDestroyed()) { pendingDeepLinks.push(url); return }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
  if (deepLinkReady) mainWindow.webContents.send('neo:deep-link', url)
  else pendingDeepLinks.push(url)
}
function flushDeepLinks(event) {
  for (const url of pendingDeepLinks.splice(0)) event.sender.send('neo:deep-link', url)
}
function handleDeepLink(argv) {
  const url = (argv || []).find((v) => typeof v === 'string' && v.indexOf(APP_PROTOCOL + '://') === 0)
  if (url) sendDeepLink(url)
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1220, height: 820, minWidth: 720, minHeight: 480, show: false,
    frame: true, autoHideMenuBar: true, backgroundColor: '#1f1f1f', title: 'Struct',
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  mainWindow.once('ready-to-show', () => { if (mainWindow) mainWindow.show() })
  mainWindow.webContents.on('did-start-loading', () => { deepLinkReady = false })
  mainWindow.on('closed', () => { mainWindow = undefined })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url).catch((e) => console.error('[electron] openExternal:', e))
    return { action: 'deny' }
  })
  const devUrl = process.env.NEO_DEV_SERVER_URL
  if (devUrl) mainWindow.loadURL(devUrl).catch((e) => console.error('[electron] load:', e))
  else mainWindow.loadFile(join(__dirname, '..', 'dist', 'index.html')).catch((e) => console.error('[electron] load file:', e))
}
async function openExternal(value) {
  if (typeof value !== 'string') throw new Error('External URL must be a string')
  let url
  try { url = new URL(value) } catch { throw new Error('Invalid external URL') }
  if (['https:', 'http:', 'mailto:'].indexOf(url.protocol) < 0) throw new Error('Unsupported URL scheme: ' + url.protocol)
  await shell.openExternal(url.href)
}


/* --- state + fs helpers --- */
function stateFile(key) {
  if (typeof key !== 'string' || !key || key.indexOf('..') >= 0 || /[\\/:]/.test(key)) throw new Error('Invalid state key')
  return join(app.getPath('userData'), key + '.json')
}
async function readState(key) {
  try { return await readFile(stateFile(key), 'utf8') }
  catch (e) { if (e && e.code === 'ENOENT') return ''; throw e }
}
async function writeState(key, value) {
  if (typeof value !== 'string') throw new Error('State value must be a string')
  const file = stateFile(key)
  await mkdir(dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  await writeFile(tmp, value, { mode: 0o600 })
  await rename(tmp, file)
}
function metaToEntry(full, st) {
  return { name: basename(full) || full, path: full, is_dir: st ? st.isDirectory() : false, size: st ? st.size : null, modified: st && st.mtimeMs ? Math.floor(st.mtimeMs / 1000) : null }
}
const SKIP = { node_modules: 1, '.git': 1, target: 1, dist: 1, '.next': 1, build: 1, __pycache__: 1, '.venv': 1, venv: 1 }
const SEARCH_LIMIT = 500
async function searchRec(root, pattern, inContent, out) {
  if (out.length >= SEARCH_LIMIT) return
  let entries
  try { entries = await readdir(root, { withFileTypes: true }) } catch { return }
  const pat = String(pattern).toLowerCase()
  for (const en of entries) {
    if (out.length >= SEARCH_LIMIT) return
    const full = join(root, en.name)
    if (en.isDirectory()) { if (!SKIP[en.name]) await searchRec(full, pattern, inContent, out) }
    else if (inContent) {
      let st = null
      try { st = await stat(full) } catch { continue }
      if (st.size > 1000000) continue
      let text = null
      try { text = await readFile(full, 'utf8') } catch { continue }
      const lines = text.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().indexOf(pat) >= 0) {
          out.push(full + ':' + (i + 1) + ': ' + lines[i].trim())
          if (out.length >= SEARCH_LIMIT) break
        }
      }
    } else if (full.toLowerCase().indexOf(pat) >= 0) out.push(full)
  }
}
function expandEnv(input) {
  if (typeof input !== 'string') return input
  return input
    .replace(/%([^%]+)%/g, (m, n) => (process.env[n] !== undefined ? process.env[n] : m))
    .replace(/\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, b, p) => {
      const n = b !== undefined ? b : p
      return process.env[n] !== undefined ? process.env[n] : m
    })
}
const RUN_CAP = 128 * 1024
function capOut(t) {
  const s = String(t || '')
  return s.length <= RUN_CAP ? s : s.slice(0, RUN_CAP) + '...[truncated]'
}
function runCommand(a) {
  const command = String(a.command || '')
  const cwd = typeof a.cwd === 'string' && a.cwd ? a.cwd : undefined
  let tsec = Number(a.timeoutSecs !== undefined ? a.timeoutSecs : a.timeout_secs !== undefined ? a.timeout_secs : 120) || 120
  tsec = Math.min(Math.max(tsec, 1), 900)
  return new Promise((resolveP, reject) => {
    const bin = process.platform === 'win32' ? 'powershell.exe' : 'sh'
    const sargs = process.platform === 'win32'
      ? ['-NoProfile', '-Command', '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ' + command]
      : ['-c', command]
    let child
    try { child = spawn(bin, sargs, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }) }
    catch (e) { reject(new Error('Failed to spawn command: ' + e.message)); return }
    let out = '', err = '', done = false
    child.stdout.on('data', (c) => { if (out.length < RUN_CAP + 4096) out += c.toString('utf8') })
    child.stderr.on('data', (c) => { if (err.length < RUN_CAP + 4096) err += c.toString('utf8') })
    const timer = setTimeout(() => { try { child.kill() } catch {} }, tsec * 1000)
    const start = Date.now()
    child.on('error', (e) => { if (done) return; done = true; clearTimeout(timer); reject(new Error('Failed to spawn command: ' + e.message)) })
    child.on('close', (code) => {
      if (done) return; done = true; clearTimeout(timer)
      const timed = code === null ? true : Date.now() - start >= tsec * 1000 - 60
      resolveP({ exitCode: code, timedOut: timed, stdout: capOut(out), stderr: capOut(err) })
    })
  })
}


/* --- terminals via node-pty --- */
let ptyMod = null
function pty() {
  if (!ptyMod) {
    try { ptyMod = require('node-pty') }
    catch (e) { throw new Error('Terminal backend unavailable (node-pty): ' + e.message) }
  }
  return ptyMod
}
function defShell() {
  if (process.platform === 'win32') return 'powershell.exe'
  const cands = [process.env.SHELL, '/bin/bash', '/usr/bin/bash', '/bin/zsh', '/usr/bin/zsh', '/bin/sh'].filter(Boolean)
  for (const c of cands) { try { if (existsSync(c)) return c } catch {} }
  return '/bin/sh'
}
const terms = new Map()
let nextTermId = 0
function termCreate(a) {
  const o = a || {}
  const id = nextTermId++
  const proc = pty().spawn(defShell(), [], {
    name: 'xterm-256color', cols: 80, rows: 24,
    cwd: typeof o.cwd === 'string' && o.cwd ? o.cwd : require('node:os').homedir(),
    env: process.env,
  })
  terms.set(id, proc)
  proc.onData((d) => emitToRenderer('neo:terminal-data', { id, data: String(d) }))
  proc.onExit((info) => { terms.delete(id); emitToRenderer('neo:terminal-exit', { id, exitCode: info ? info.exitCode : null }) })
  return id
}


/* --- ollama proxy + lifecycle --- */
let ollamaChild = null
function ollUrl(raw) {
  let p
  try { p = new URL(String(raw)) } catch { throw new Error('Invalid Ollama URL: ' + raw) }
  const port = p.port || (p.protocol === 'https:' ? '443' : '80')
  if ((p.hostname !== '127.0.0.1' && p.hostname !== 'localhost') || port !== '11434') throw new Error('Ollama requests must target localhost:11434.')
  return p
}
function ollHttp(o) {
  const p = ollUrl(o.url)
  const lib = p.protocol === 'https:' ? require('node:https') : require('node:http')
  return new Promise((resolveP, reject) => {
    const req = lib.request(p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json' }, timeout: 600000 }, (res) => {
      let t = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { t += c })
      res.on('end', () => resolveP({ status: res.statusCode || 0, body: t }))
    })
    req.on('timeout', () => req.destroy(new Error('Ollama request timed out')))
    req.on('error', reject)
    if (o.body) req.write(o.body)
    req.end()
  })
}
async function ollAlive() {
  try {
    const r = await ollHttp({ url: 'http://127.0.0.1:11434/api/version', method: 'GET' })
    return r.status >= 200 && r.status < 500
  } catch { return false }
}
function ollBin() {
  for (const p of ['/usr/local/bin/ollama', '/opt/homebrew/bin/ollama', '/usr/bin/ollama']) {
    try { if (existsSync(p)) return p } catch {}
  }
  return 'ollama'
}
function ollInstalled() {
  try {
    require('node:child_process').execFileSync(ollBin(), ['--version'], { stdio: 'ignore', windowsHide: true })
    return true
  } catch { return false }
}
async function startOllama() {
  if (await ollAlive()) return { running: true, alreadyRunning: true, owned: false, adopted: false }
  try {
    ollamaChild = spawn(ollBin(), ['serve'], { stdio: 'ignore', windowsHide: true })
    ollamaChild.on('exit', () => { ollamaChild = null })
    if (ollamaChild.unref) ollamaChild.unref()
  } catch (e) { throw new Error('Failed to start Ollama: ' + e.message) }
  const deadline = Date.now() + 20000
  for (;;) {
    if (await ollAlive()) break
    if (Date.now() >= deadline) {
      try { if (ollamaChild) ollamaChild.kill() } catch {}
      ollamaChild = null
      throw new Error('Ollama did not answer on port 11434 after starting.')
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return { running: true, alreadyRunning: false, owned: true, adopted: false }
}
async function stopOllama() {
  if (ollamaChild && !ollamaChild.killed) {
    try { ollamaChild.kill() } catch {}
    ollamaChild = null
    return { stopped: true, stillRunningExternal: await ollAlive() }
  }
  return { stopped: false, stillRunningExternal: await ollAlive() }
}
async function ollTags() {
  const r = await ollHttp({ url: 'http://127.0.0.1:11434/api/tags', method: 'GET' })
  if (r.status < 200 || r.status >= 300) throw new Error('Ollama tags failed (HTTP ' + r.status + ')')
  try { return JSON.parse(r.body).models || [] } catch { return [] }
}
async function ollPull(name) {
  const r = await ollHttp({ url: 'http://127.0.0.1:11434/api/pull', method: 'POST', body: JSON.stringify({ name, stream: false }) })
  return r.status >= 200 && r.status < 300
}
async function ollDel(name) {
  const r = await ollHttp({ url: 'http://127.0.0.1:11434/api/delete', method: 'DELETE', body: JSON.stringify({ name }) })
  return r.status >= 200 && r.status < 300
}


/* --- mcp stdio + discovery --- */
const mcpProcs = new Map()
function mcpCands(root) {
  const hits = [], seen = new Set()
  const push = (p, src) => {
    if (!p || seen.has(p)) return
    seen.add(p)
    try { if (existsSync(p) && statSync(p).isFile()) hits.push({ path: p, source: src }) } catch {}
  }
  if (root) {
    push(join(root, '.mcp.json'), 'workspace')
    push(join(root, '.vscode', 'mcp.json'), 'workspace-vscode')
    push(join(root, 'mcp.json'), 'workspace-root')
  }
  const h = require('node:os').homedir()
  push(join(h, '.config', 'neo', 'mcp.json'), 'user')
  push(join(h, '.neo', 'mcp.json'), 'user-legacy')
  if (process.platform === 'win32' && process.env.APPDATA) push(join(process.env.APPDATA, 'neo', 'mcp.json'), 'user-windows')
  return hits
}
function mcpStart(o) {
  const id = String(o.id || '')
  if (!id || !o.command) throw new Error('MCP server id and command are required')
  try { mcpStopSync(id) } catch {}
  const cmd = String(o.command).trim()
  let prog = cmd, fargs = []
  if (process.platform === 'win32' && /\.(bat|cmd)$/i.test((cmd.split(' ')[0] || ''))) { prog = 'cmd.exe'; fargs = ['/d', '/s', '/c', cmd] }
  const alist = fargs.concat(((o.args) || []).map((x) => expandEnv(String(x))))
  const envOut = Object.assign({}, process.env)
  const ex = o.env || {}
  for (const k of Object.keys(ex)) envOut[k] = expandEnv(String(ex[k]))
  let cwdV = undefined
  if (o.cwd) { const e2 = expandEnv(String(o.cwd)); try { if (existsSync(e2)) cwdV = e2 } catch {} }
  const child = spawn(prog, alist, { cwd: cwdV, env: envOut, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  const st = { child, buf: '', queue: [], waiters: [], tail: [] }
  mcpProcs.set(id, st)
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (c) => {
    st.buf += c
    let i = st.buf.indexOf('\n')
    while (i >= 0) {
      const line = st.buf.slice(0, i).trim()
      st.buf = st.buf.slice(i + 1)
      if (line) { if (st.waiters.length > 0) st.waiters.shift()(line); else st.queue.push(line) }
      i = st.buf.indexOf('\n')
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (c) => { st.tail.push(String(c)); if (st.tail.length > 40) st.tail.shift() })
  child.on('exit', () => {
    const e = new Error('MCP server "' + id + '" exited. ' + st.tail.join('').slice(-2000))
    while (st.waiters.length > 0) st.waiters.shift()(null, e)
  })
  return { started: true }
}
function mcpStopSync(id) {
  const st = mcpProcs.get(String(id))
  if (!st) return
  mcpProcs.delete(String(id))
  try { st.child.kill() } catch {}
}
function mcpSend(o) {
  const st = mcpProcs.get(String(o.id))
  if (!st || st.child.killed) throw new Error('MCP server "' + o.id + '" is not running')
  st.child.stdin.write(String(o.line) + '\n')
  return { sent: true }
}
function mcpRead(o) {
  const id = String(o.id)
  const st = mcpProcs.get(id)
  if (!st) throw new Error('MCP server "' + id + '" is not running')
  if (st.queue.length > 0) return Promise.resolve(st.queue.shift())
  let tms = Number(o.timeoutMs || 30000) || 30000
  tms = Math.min(Math.max(tms, 1000), 120000)
  return new Promise((resolveP, reject) => {
    const onL = (line, e) => { clearTimeout(t); if (e) reject(e); else resolveP(line) }
    const t = setTimeout(() => {
      const i = st.waiters.indexOf(onL)
      if (i >= 0) st.waiters.splice(i, 1)
      reject(new Error('Timed out waiting for MCP server "' + id + '"'))
    }, tms)
    st.waiters.push(onL)
  })
}
async function mcpStop(o) {
  const id = String(o.id)
  if (!mcpProcs.get(id)) return { stopped: false }
  mcpStopSync(id)
  return { stopped: true }
}


/* --- invoke router A: state + fs --- */
async function invoke(cmd, a) {
  a = a || {}
  if (cmd === 'get_app_version') return app.getVersion()
  if (cmd === 'load_state') return readState(a.key)
  if (cmd === 'save_state') { if (typeof a.value !== 'string') throw new Error('State value must be a string'); return writeState(a.key, a.value) }
  if (cmd === 'fs_read_file') return readFile(String(a.path), 'utf8').catch((e) => { throw new Error('Failed to read ' + a.path + ': ' + e.message) })
  if (cmd === 'fs_read_file_range') {
    const c = await readFile(String(a.path), 'utf8').catch((e) => { throw new Error('Failed to read: ' + e.message) })
    const lines = c.split('\n')
    const sN = Number(a.startLine !== undefined ? a.startLine : a.start_line !== undefined ? a.start_line : 1) || 1
    const start = Math.max(sN - 1, 0)
    if (start >= lines.length) return ''
    const eN = Number(a.endLine !== undefined ? a.endLine : a.end_line !== undefined ? a.end_line : 0) || 0
    const end = eN === 0 ? lines.length : Math.min(eN, lines.length)
    return lines.slice(start, end).join('\n')
  }
  if (cmd === 'fs_write_file') {
    const p = String(a.path)
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, String(a.content !== undefined ? a.content : ''))
    return true
  }
  if (cmd === 'fs_append_file') {
    const p = String(a.path)
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, String(a.content !== undefined ? a.content : ''), { flag: 'a' })
    return true
  }
  if (cmd === 'fs_replace_in_file') {
    const p = String(a.path)
    const c = await readFile(p, 'utf8').catch((e) => { throw new Error('Failed to read: ' + e.message) })
    const s = String(a.search !== undefined ? a.search : '')
    if (c.indexOf(s) < 0) throw new Error('Search text not found in ' + p)
    const r = String(a.replace !== undefined ? a.replace : '')
    await writeFile(p, a.all === true ? c.split(s).join(r) : c.replace(s, r))
    return true
  }
  if (cmd === 'fs_write_file_range') {
    const p = String(a.path)
    const c = await readFile(p, 'utf8').catch((e) => { throw new Error('Failed to read: ' + e.message) })
    const lines = c.split('\n')
    const sN = Number(a.startLine !== undefined ? a.startLine : a.start_line !== undefined ? a.start_line : 1) || 1
    const start = Math.max(sN - 1, 0)
    const eN = Number(a.endLine !== undefined ? a.endLine : a.end_line !== undefined ? a.end_line : 0) || 0
    const end = eN === 0 ? lines.length : Math.min(eN, lines.length)
    const rep = String(a.content !== undefined ? a.content : '').split('\n')
    const next = lines.slice(0, start).concat(rep).concat(lines.slice(end))
    await writeFile(p, next.join('\n'))
    return next.join('\n').length
  }
  if (cmd === 'fs_delete_file') { await rm(String(a.path)).catch((e) => { throw new Error('Failed to delete: ' + e.message) }); return true }
  if (cmd === 'fs_delete_dir') { await rm(String(a.path), { recursive: true, force: false }).catch((e) => { throw new Error('Failed to delete: ' + e.message) }); return true }
  if (cmd === 'fs_create_dir') { await mkdir(String(a.path), { recursive: true }).catch((e) => { throw new Error('Failed to create: ' + e.message) }); return true }
  if (cmd === 'fs_list_dir') {
    const dir = String(a.path)
    const entries = await readdir(dir, { withFileTypes: true }).catch((e) => { throw new Error('Failed to list: ' + e.message) })
    const out = []
    for (const en of entries) {
      const full = join(dir, en.name)
      let st = null
      try { st = await stat(full) } catch { st = null }
      out.push(metaToEntry(full, st))
    }
    out.sort((x, y) => Number(y.is_dir) - Number(x.is_dir) || x.name.toLowerCase().localeCompare(y.name.toLowerCase()))
    return out
  }
  if (cmd === 'fs_search_files') {
    const out = []
    await searchRec(String(a.path), String(a.pattern !== undefined ? a.pattern : ''), a.content === true, out)
    if (out.length >= SEARCH_LIMIT) out.push('... truncated at ' + SEARCH_LIMIT + ' matches')
    return out
  }
  return invokeB(cmd, a)
}


/* --- invoke router B: meta, procs, terms, ollama, mcp, updater --- */
async function invokeB(cmd, a) {
  if (cmd === 'fs_stat') {
    const p = String(a.path)
    const st = await stat(p).catch((e) => { throw new Error('Failed to stat: ' + e.message) })
    return { path: p, isDir: st.isDirectory(), size: st.size, modified: Math.floor(st.mtimeMs / 1000) }
  }
  if (cmd === 'fs_copy_file') {
    const to = String(a.newPath !== undefined ? a.newPath : a.new_path !== undefined ? a.new_path : '')
    if (!to) throw new Error('Destination path is required')
    await mkdir(dirname(to), { recursive: true })
    await copyFile(String(a.path), to).catch((e) => { throw new Error('Failed to copy: ' + e.message) })
    return true
  }
  if (cmd === 'fs_rename') {
    const to = String(a.newPath !== undefined ? a.newPath : a.new_path !== undefined ? a.new_path : '')
    if (!to) throw new Error('Destination path is required')
    await rename(String(a.path), to).catch((e) => { throw new Error('Failed to rename: ' + e.message) })
    return true
  }
  if (cmd === 'run_command') return runCommand(a)
  if (cmd === 'terminal_create') return termCreate(a)
  if (cmd === 'terminal_write') {
    const pr = terms.get(Number(a.id))
    if (!pr) throw new Error('Terminal ' + a.id + ' is not running')
    pr.write(String(a.data !== undefined ? a.data : ''))
    return null
  }
  if (cmd === 'terminal_resize') {
    const pr = terms.get(Number(a.id))
    if (!pr) throw new Error('Terminal ' + a.id + ' is not running')
    try { pr.resize(Number(a.cols) || 80, Number(a.rows) || 24) } catch {}
    return null
  }
  if (cmd === 'terminal_kill') {
    const pr = terms.get(Number(a.id))
    if (pr) { terms.delete(Number(a.id)); try { pr.kill() } catch {} }
    return null
  }
  if (cmd === 'check_ollama_installed') return ollInstalled()
  if (cmd === 'check_ollama_running') return ollAlive()
  if (cmd === 'ollama_request') {
    const r = await ollHttp({ url: String(a.url), method: String(a.method || 'GET'), body: a.body !== undefined ? a.body : undefined })
    return { status: r.status, body: r.body }
  }
  if (cmd === 'start_ollama_server') return startOllama()
  if (cmd === 'stop_ollama_server') return stopOllama()
  if (cmd === 'list_local_models') return ollTags()
  if (cmd === 'pull_local_model') return ollPull(String(a.modelName !== undefined ? a.modelName : a.model_name !== undefined ? a.model_name : ''))
  if (cmd === 'delete_local_model') return ollDel(String(a.modelName !== undefined ? a.modelName : a.model_name !== undefined ? a.model_name : ''))
  if (cmd === 'mcp_discover_configs') {
    const r = a.workspaceRoot !== undefined ? a.workspaceRoot : a.workspace_root
    return mcpCands(r !== undefined ? r : null)
  }
  if (cmd === 'expand_env_string') return expandEnv(String(a.input !== undefined ? a.input : ''))
  if (cmd === 'mcp_stdio_start') return mcpStart(a)
  if (cmd === 'mcp_stdio_send') return mcpSend(a)
  if (cmd === 'mcp_stdio_read') return mcpRead(a)
  if (cmd === 'mcp_stdio_stop') return mcpStop(a)
  if (cmd === 'download_file') return dlFile(String(a.url || ''))
  if (cmd === 'launch_downloaded') return launchDl(a)
  throw new Error('Electron native command is not implemented: ' + cmd)
}


/* --- updater download + ipc + lifecycle --- */
function dlFile(url) {
  let parsed
  try { parsed = new URL(url) } catch { throw new Error('Invalid download URL: ' + url) }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Unsupported URL scheme')
  const fetch1 = (target, depth) => {
    if (depth > 5) throw new Error('Too many redirects')
    const lib = target.protocol === 'https:' ? require('node:https') : require('node:http')
    return new Promise((resolveP, reject) => {
      const req = lib.get(target.href, { headers: { 'User-Agent': 'Neo-Updater' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          req.destroy()
          fetch1(new URL(res.headers.location, target.href), depth + 1).then(resolveP, reject)
          return
        }
        if (res.statusCode < 200 || res.statusCode >= 300) { reject(new Error('Download server returned ' + res.statusCode)); return }
        const nm = basename(target.pathname) || 'neo-update.bin'
        const dest = join(app.getPath('temp'), 'neo-' + Date.now() + '-' + nm)
        pipeline(res, createWriteStream(dest)).then(() => resolveP(dest), () => reject(new Error('Download failed')))
      })
      req.on('error', () => reject(new Error('Download failed: connection error')))
    })
  }
  return fetch1(parsed, 0)
}
function launchDl(a) {
  const t = String(a.path || '')
  if (!t || !existsSync(t)) throw new Error('Downloaded file not found')
  const child = spawn(t, [], { detached: true, stdio: 'ignore', windowsHide: true, shell: /\.(msi|bat|cmd|ps1)$/i.test(t) })
  if (child.unref) child.unref()
  setTimeout(() => app.quit(), 1500)
  return null
}
function needWin() {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Neo window is not available')
  return mainWindow
}
ipcMain.handle('neo:native-invoke', async (_e, cmd, a) => {
  if (typeof cmd !== 'string') throw new Error('Native command name must be a string')
  return invoke(cmd, a || {})
})
ipcMain.handle('neo:event:emit', (_e, ev, payload) => {
  if (typeof ev !== 'string' || !/^[\w:/-]+$/.test(ev)) throw new Error('Invalid event name')
  emitToRenderer(ev, payload)
})
ipcMain.on('neo:deep-link:ready', (ev) => {
  if (ev.sender === (mainWindow && mainWindow.webContents)) { deepLinkReady = true; flushDeepLinks(ev) }
})
ipcMain.handle('neo:open-external', (_e, url) => openExternal(url))
ipcMain.handle('neo:dialog:open', async (_e, o) => {
  o = o || {}
  const props = []
  if (o.directory) props.push('openDirectory')
  else props.push('openFile')
  if (o.multiple) props.push('multiSelections')
  const r = await dialog.showOpenDialog(needWin(), { title: o.title, defaultPath: o.defaultPath, properties: props, filters: o.filters })
  if (r.canceled) return null
  return o.multiple ? r.filePaths : r.filePaths[0] || null
})
ipcMain.handle('neo:dialog:save', async (_e, o) => {
  o = o || {}
  const r = await dialog.showSaveDialog(needWin(), { title: o.title, defaultPath: o.defaultPath, filters: o.filters })
  return r.canceled ? null : r.filePath || null
})
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
else {
  app.on('second-instance', (_e, argv) => handleDeepLink(argv))
  app.on('open-url', (ev, url) => { ev.preventDefault(); sendDeepLink(url) })
}
if (gotLock) {
  app.whenReady().then(() => {
    app.setAsDefaultProtocolClient(APP_PROTOCOL)
    handleDeepLink(process.argv)
    createWindow()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  }).catch((e) => { console.error('[electron] Neo failed to start:', e); app.quit() })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
  app.on('before-quit', () => {
    for (const kv of terms) { try { kv[1].kill() } catch {} }
    terms.clear()
    for (const k of Array.from(mcpProcs.keys())) { try { mcpStopSync(k) } catch {} }
    if (ollamaChild && !ollamaChild.killed) { try { ollamaChild.kill() } catch {} }
  })
}


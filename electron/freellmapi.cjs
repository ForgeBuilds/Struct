const { spawn } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const { chmodSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const PORT = 3001
const BASE_URL = `http://127.0.0.1:${PORT}`
let child
let startPromise

function encryptionKey(dataDir) {
  const keyPath = join(dataDir, '.encryption-key')
  try {
    const key = readFileSync(keyPath, 'utf8').trim()
    if (/^[0-9a-f]{64}$/i.test(key)) return key
    throw new Error('The saved FreeLLMAPI encryption key is invalid.')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  const key = randomBytes(32).toString('hex')
  writeFileSync(keyPath, `${key}\n`, { mode: 0o600, flag: 'wx' })
  try {
    chmodSync(keyPath, 0o600)
  } catch (error) {
    if (process.platform !== 'win32') throw error
  }
  return key
}

function serverPath(app) {
  return join(app.getAppPath(), 'electron', 'freellmapi-runtime', 'server', 'dist', 'index.js')
}

function clientPath(app) {
  return join(app.getAppPath(), 'electron', 'freellmapi-runtime', 'client')
}

async function waitUntilReady(serverProcess) {
  let lastError
  for (let attempt = 0; attempt < 120; attempt++) {
    if (serverProcess.exitCode !== null) {
      throw new Error(
        `FreeLLMAPI exited during startup (code ${serverProcess.exitCode}). The local port ${PORT} may already be in use; check the Struct app logs for details.`
      )
    }
    try {
      const response = await fetch(`${BASE_URL}/api/ping`, {
        signal: AbortSignal.timeout(1000),
      })
      if (response.ok) return BASE_URL
      lastError = new Error(`Health check returned HTTP ${response.status}.`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`FreeLLMAPI did not start at ${BASE_URL}: ${lastError?.message ?? 'startup timed out'}`)
}

async function start(app) {
  if (child && child.exitCode === null && child.signalCode === null) {
    return waitUntilReady(child)
  }
  if (startPromise) return startPromise

  startPromise = (async () => {
    const dataDir = join(app.getPath('userData'), 'freellmapi')
    mkdirSync(dataDir, { recursive: true, mode: 0o700 })
    const env = {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(PORT),
      ENCRYPTION_KEY: encryptionKey(dataDir),
      FREEAPI_DB_PATH: join(dataDir, 'freeapi.db'),
      CLIENT_DIST: clientPath(app),
      FREEAPI_USE_NODE_SQLITE: '1',
      FREELLMAPI_INSTALL_METHOD: 'struct-embedded',
      ELECTRON_RUN_AS_NODE: '1',
    }
    const serverProcess = spawn(process.execPath, [serverPath(app)], {
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    })
    child = serverProcess
    serverProcess.stderr.on('data', (chunk) => {
      console.error(`[FreeLLMAPI] ${String(chunk).trimEnd()}`)
    })
    serverProcess.on('error', (error) => {
      console.error('[FreeLLMAPI] Could not launch the embedded router:', error)
    })
    serverProcess.on('exit', (code, signal) => {
      if (code !== 0 && code !== null) {
        console.error(`[FreeLLMAPI] Router exited with code ${code}.`)
      } else if (signal && signal !== 'SIGTERM') {
        console.error(`[FreeLLMAPI] Router exited after ${signal}.`)
      }
      if (child === serverProcess) child = undefined
    })
    try {
      return await waitUntilReady(serverProcess)
    } catch (error) {
      serverProcess.kill()
      if (child === serverProcess) child = undefined
      throw error
    }
  })().finally(() => {
    startPromise = undefined
  })

  return startPromise
}

function stop() {
  if (child && child.exitCode === null && !child.killed) {
    child.kill()
  }
  child = undefined
}

process.once('exit', stop)

module.exports = { start, stop }

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createServer } from 'vite'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const electronCli = join(root, 'node_modules', 'electron', 'cli.js')
let electron
let vite
let stopping = false

function stop(child) {
  if (child && child.exitCode === null) child.kill()
}

async function shutdown() {
  if (stopping) return
  stopping = true
  stop(electron)
  await vite?.close()
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

try {
  await access(electronCli)
  vite = await createServer({
    configFile: join(root, 'vite.config.ts'),
    server: { host: '127.0.0.1' },
  })
  await vite.listen()
  vite.printUrls()
  const url = vite.resolvedUrls?.local[0]
  if (!url) throw new Error('Vite did not report a local development URL')

  electron = spawn(process.execPath, [electronCli, '.'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NEO_DEV_SERVER_URL: url },
  })

  const [code] = await once(electron, 'exit')
  await shutdown()
  process.exitCode = code ?? 1
} catch (error) {
  console.error(`[electron:dev] ${error.message}`)
  await shutdown()
  process.exitCode = 1
}

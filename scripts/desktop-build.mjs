/*
 * Author: Lumorix Studios
 * Check the LICENSE in the GitHub repo for more information on permissions to use this code.
 */

/*
 * Desktop builds for the Electron shell.
 *
 * Neo is a single Electron window now: the renderer is the chat interface and
 * `electron/main.cjs` is the only main process. This wrapper builds the
 * renderer and then hands off to electron-builder for packaging.
 *
 * Run it from the repository root.
 *
 *   npm run build:desktop          build the renderer, then package
 *   npm run build:desktop:bundle   package the existing dist/ without rebuilding
 *
 * Arguments after `--` reach electron-builder, e.g.
 *   node scripts/desktop-build.mjs -- --linux AppImage
 */

import { spawnSync } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

const root = process.cwd()
const BUILDER = join(root, 'node_modules', '.bin', 'electron-builder')

const flags = { bundleOnly: false, help: false }
const forwarded = []
for (const arg of process.argv.slice(2)) {
  if (arg === '--bundle-only') flags.bundleOnly = true
  else if (arg === '--help' || arg === '-h') flags.help = true
  else forwarded.push(arg)
}

if (flags.help) {
  console.log(
    [
      'Usage: node scripts/desktop-build.mjs [--bundle-only] [-- <electron-builder args>]',
      '',
      '  --bundle-only   skip the renderer build and package the existing dist/',
      '',
      'Remaining arguments are forwarded to electron-builder.',
    ].join('\n'),
  )
  process.exit(0)
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

if (!(await exists(BUILDER))) {
  console.error(
    [
      'electron-builder is not installed.',
      '',
      'Install it with:',
      '  npm i -D electron-builder',
      '',
      'Until then, build and run the app in development with:',
      '  npm run build && npx electron .',
    ].join('\n'),
  )
  process.exit(1)
}

if (!flags.bundleOnly) {
  console.log('[build] Building the renderer...')
  const built = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: true })
  if (built.status !== 0) {
    console.error('[build] Renderer build failed.')
    process.exit(built.status ?? 1)
  }
}

console.log('[build] Packaging with electron-builder...')
const result = spawnSync(BUILDER, forwarded, { cwd: root, stdio: 'inherit' })
if (result.error) {
  console.error(`[build] Failed to run electron-builder: ${result.error.message}`)
  process.exit(1)
}
if (result.signal) {
  console.error(`[build] electron-builder was terminated by ${result.signal}.`)
  process.exit(1)
}
process.exit(result.status ?? 1)

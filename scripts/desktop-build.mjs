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
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const root = process.cwd()

// Entry point for electron-builder. On Windows npm generates a platform
// .cmd shim in node_modules/.bin that cannot be spawned directly (it fails
// with ENOENT), so always run the packaged cli.js through the current node
// executable instead.
const BUILDER = join(root, 'node_modules', 'electron-builder', 'cli.js')

const flags = { bundleOnly: false, help: false }
const forwarded = []
for ( const arg of process.argv.slice(2)) {
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

// Pre-build check: when running locally (not in CI), warn if .env is missing
// so the user knows Supabase sign/login won't work in the packaged build.
// Vite bakes import.meta.env.VITE_* into the renderer at build time — a
// runtime .env file beside the installer cannot change an already-built bundle.
if (!flags.bundleOnly && process.env.CI !== 'true') {
  const envPath = join(root, '.env')
  if (!existsSync(envPath)) {
    console.warn(
      '[build] .env not found — Supabase sign/login will NOT work in this build.\n' +
        '  1. Copy .env.example to .env\n' +
        '  2. Fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from\n' +
        '     Supabase Dashboard → Project Settings → API\n' +
        '  3. Re-run this build\n' +
        '  See SUPABASE_SETUP.md for details.\n',
    )
  } else {
    // Sanity-check that .env actually has values (not just the empty template).
    const envContent = readFileSync(envPath, 'utf8')
    const hasUrl = /^VITE_SUPABASE_URL\s*=\s*\S/m.test(envContent)
    const hasKey = /^VITE_SUPABASE_ANON_KEY\s*=\s*\S/m.test(envContent)
    if (!hasUrl || !hasKey) {
      console.warn(
        '[build] .env exists but VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ' +
          'appear empty — Supabase sign/login will NOT work.\n' +
        '  Fill in both values from Supabase Dashboard → Project Settings → API,\n' +
        '  then rebuild. See SUPABASE_SETUP.md.\n',
      )
    }
  }
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
const result = spawnSync(process.execPath, [BUILDER, ...forwarded], { cwd: root, stdio: 'inherit' })
if (result.error) {
  console.error(`[build] Failed to run electron-builder: ${result.error.message}`)
  process.exit(1)
}
if (result.signal) {
  console.error(`[build] electron-builder was terminated by ${result.signal}.`)
  process.exit(1)
}
process.exit(result.status ?? 1)

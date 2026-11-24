/*
 * Author: Lumorix Studios
 * Check the LICENSE in the GitHub repo for more information on permissions to use this code.
 */

/*
 * Vendors the FreeCAD MCP addon into electron/freecad-runtime.
 *
 * FreeCAD itself is a full desktop CAD application and cannot be embedded in
 * the Electron bundle. What we can ship is the small MIT-licensed Python addon
 * that exposes FreeCAD's XML-RPC bridge; the Node MCP server in
 * electron/freecad-mcp.cjs talks to that bridge. This script pins the addon to
 * an upstream commit and copies only the addon + license into the app.
 *
 * Run it from the repository root. It reuses an existing runtime unless
 * FORCE_FREECAD_BUILD=1 is set.
 */

import { createWriteStream } from 'node:fs'
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import * as tar from 'tar'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const commit = '246f608d5de49089aadc41d2d91cfce2ad8a44cd'
const archiveUrl = `https://codeload.github.com/neka-nat/freecad-mcp/tar.gz/${commit}`
const sourceRoot = path.join(root, 'electron/freecad-build-src')
const runtimeRoot = path.join(root, 'electron/freecad-runtime')
const addonSource = path.join(sourceRoot, 'addon/FreeCADMCP')
const addonTarget = path.join(runtimeRoot, 'addon/FreeCADMCP')

async function downloadSource(workDir) {
  const response = await fetch(archiveUrl, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok || !response.body) {
    throw new Error(`Could not download FreeCAD MCP source (${response.status} ${response.statusText}).`)
  }
  const archivePath = path.join(workDir, 'freecad-mcp.tar.gz')
  await pipeline(response.body, createWriteStream(archivePath, { flags: 'wx' }))
  await tar.x({ file: archivePath, cwd: sourceRoot, strip: 1 })
}

async function outputExists() {
  try {
    const [marker] = await Promise.all([
      readFile(path.join(runtimeRoot, 'source-commit'), 'utf8'),
      access(path.join(addonTarget, 'InitGui.py')),
      access(path.join(addonTarget, 'package.xml')),
    ])
    return marker.trim() === commit
  } catch {
    return false
  }
}

async function cpDirectory(source, destination) {
  await mkdir(destination, { recursive: true })
  const entries = await readdir(source, { withFileTypes: true })
  for (const entry of entries) {
    const from = path.join(source, entry.name)
    const to = path.join(destination, entry.name)
    if (entry.isDirectory()) await cpDirectory(from, to)
    else if (entry.isFile()) await copyFile(from, to)
  }
}

async function build() {
  if (await outputExists() && process.env.FORCE_FREECAD_BUILD !== '1') {
    console.log(`[FreeCAD] Reusing addon vendored from ${commit.slice(0, 7)}.`)
    return
  }

  const workDir = await mkdtemp(path.join(os.tmpdir(), 'struct-freecad-'))
  try {
    await rm(sourceRoot, { recursive: true, force: true })
    await rm(runtimeRoot, { recursive: true, force: true })
    await mkdir(sourceRoot, { recursive: true })
    console.log(`[FreeCAD] Downloading pinned addon source ${commit.slice(0, 7)}.`)
    await downloadSource(workDir)

    await cpDirectory(addonSource, addonTarget)
    await copyFile(path.join(sourceRoot, 'LICENSE'), path.join(runtimeRoot, 'LICENSE'))
    await writeFile(path.join(runtimeRoot, 'source-commit'), `${commit}\n`)
    console.log('[FreeCAD] Addon vendored.')
  } finally {
    await rm(sourceRoot, { recursive: true, force: true })
    await rm(workDir, { recursive: true, force: true })
  }
}

build().catch((error) => {
  console.error('[FreeCAD] Build failed:', error)
  process.exitCode = 1
})

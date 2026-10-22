/* Neo — native llama.cpp runtime: hardware probe, Hugging Face GGUF
 * discovery + download, runtime install and `llama-server` lifecycle.
 *
 * Everything that touches the network or the filesystem lives here (the
 * main process) so the renderer never has to deal with CORS, file locking
 * or a half-written model file.
 */
const { app } = require('electron')
const { spawn } = require('node:child_process')
const { createWriteStream, existsSync, chmodSync, createReadStream } = require('node:fs')
const {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  lstat,
  readlink,
  statfs,
  writeFile,
  symlink,
  link,
} = require('node:fs/promises')
const os = require('node:os')
const { basename, dirname, join, resolve, sep } = require('node:path')
const { pipeline } = require('node:stream/promises')
const { tmpdir } = require('node:os')
const crypto = require('node:crypto')
const zlib = require('node:zlib')
const { promisify } = require('node:util')

const gunzip = promisify(zlib.gunzip)
const inflateRaw = promisify(zlib.inflateRaw)

const HF_BASE = 'https://huggingface.co'
const LLAMA_CPP_REPO = 'ggml-org/llama.cpp'
const USER_AGENT = 'Neo/1.0 (+https://github.com/ForgeBuilds/Struct)'

/* ── paths ─────────────────────────────────────────────────────────────── */

/** Root for everything this module owns (runtime + downloaded models). */
function dataRoot() {
  return join(app.getPath('userData'), 'llamacpp')
}
function runtimeDir() {
  return join(dataRoot(), 'runtime')
}
function modelsDir() {
  return join(dataRoot(), 'models')
}
function downloadsDir() {
  return join(dataRoot(), 'downloads')
}

/** Absolute path of the `llama-server` binary for the current platform. */
function serverBinaryPath() {
  const name = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'
  return join(runtimeDir(), name)
}

/* ── hardware probe ───────────────────────────────────────────────────── */

/**
 * Conservative hardware facts used to decide whether a model can run here.
 * `ramBytes` is physical memory, `freeDiskBytes` is the free space on the
 * volume that holds the model directory.
 */
async function detectHardware() {
  const cpus = os.cpus() || []
  let freeDiskBytes = 0
  try {
    await mkdir(modelsDir(), { recursive: true })
    const st = await statfs(modelsDir())
    freeDiskBytes = Number(st.bavail) * Number(st.bsize)
  } catch {
    freeDiskBytes = 0
  }
  const arch = cpus.length ? cpus[0].arch : process.arch
  return {
    platform: process.platform,
    arch,
    osArch: process.arch,
    cpuModel: cpus.length ? cpus[0].model.trim() : 'unknown',
    cpuCores: cpus.length,
    ramBytes: os.totalmem(),
    freeRamBytes: os.freemem(),
    freeDiskBytes,
    /** llama.cpp CPU builds need a 64-bit host (x86_64 / arm64). */
    supportedArch: arch === 'x64' || arch === 'arm64',
    /** True when the host exposes AVX2 (x64) — noticeably faster inference. */
    hasAvx2:
      arch === 'x64' &&
      typeof (cpus[0] || {}).features === 'object' &&
      Array.isArray((cpus[0] || {}).features) &&
      cpus[0].features.includes('avx2'),
  }
}

/* ── HTTP helpers ─────────────────────────────────────────────────────── */

function httpRequest(url, options = {}) {
  const lib = url.startsWith('https:') ? require('node:https') : require('node:http')
  return new Promise((resolveP, reject) => {
    const req = lib.request(
      url,
      {
        method: options.method || 'GET',
        headers: { 'User-Agent': USER_AGENT, ...(options.headers || {}) },
        timeout: options.timeout || 600000,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          const next = new URL(res.headers.location, url).href
          resolveP(httpRequest(next, options))
          return
        }
        resolveP(res)
      },
    )
    req.on('timeout', () => req.destroy(new Error('Request timed out')))
    req.on('error', reject)
    if (options.body) req.write(options.body)
    req.end()
  })
}

/** Fetch and parse a JSON document. */
async function fetchJson(url, options = {}) {
  const res = await httpRequest(url, options)
  const text = await readAll(res)
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`Request failed (${res.statusCode}): ${text.slice(0, 200)}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('The server returned a malformed JSON response.')
  }
}

function readAll(res) {
  return new Promise((resolveP, reject) => {
    let out = ''
    res.setEncoding('utf8')
    res.on('data', (c) => {
      out += c
    })
    res.on('end', () => resolveP(out))
    res.on('error', reject)
  })
}

/* ── archive extraction ─────────────────────────────────────────────────── */

/**
 * Extract a `.tar.gz` archive into `destDir`.
 *
 * We implement the (very small) subset of the tar format we need instead of
 * pulling in a dependency: 512-byte headers, ustar prefix/name split, regular
 * files, directories and long-name (`L`/`K`) extensions.
 */
async function extractTarGz(archivePath, destDir) {
  const raw = await readFile(archivePath)
  const buf = await gunzip(raw)
  let offset = 0
  let longName = null
  const entries = []

  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512)
    if (header.every((b) => b === 0)) break // end-of-archive marker
    const nameField = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    const modeField = header.subarray(100, 108).toString('utf8').replace(/\0.*$/, '').trim()
    const sizeField = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim()
    const size = parseInt(sizeField, 8) || 0
    const typeFlag = String.fromCharCode(header[156]) || '0'
    const linkTarget = header.subarray(157, 257).toString('utf8').replace(/\0.*$/, '')
    const prefixField = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '')
    const magic = header.subarray(257, 263).toString('utf8')
    offset += 512

    let name = longName || nameField
    if (longName) longName = null
    if (magic.startsWith('ustar') && prefixField) name = `${prefixField}/${nameField}`

    const dataStart = offset
    offset += Math.ceil(size / 512) * 512

    if (typeFlag === 'L') {
      // GNU long name: the payload holds the real name of the next entry.
      longName = buf.subarray(dataStart, dataStart + size).toString('utf8').replace(/\0.*$/, '')
      continue
    }
    if (typeFlag === 'x' || typeFlag === 'g' || typeFlag === 'K') continue // pax headers
    const mode = parseInt(modeField, 8) || 0
    if (typeFlag === '0' || typeFlag === '\0' || typeFlag === '7') {
      entries.push({ name, size, dataStart, buf, mode })
    } else if (typeFlag === '5') {
      entries.push({ name, dir: true, mode })
    } else if (typeFlag === '2') {
      // Symlink — the llama.cpp archives ship the shared libraries as
      // symlinks to the versioned file, so these must be recreated.
      entries.push({ name, link: linkTarget, mode })
    } else if (typeFlag === '1') {
      entries.push({ name, hardlink: linkTarget, mode })
    }
  }

  for (const e of entries) {
    const target = safeJoin(destDir, e.name)
    if (e.dir) {
      await mkdir(target, { recursive: true })
      continue
    }
    await mkdir(dirname(target), { recursive: true })
    if (e.link !== undefined) {
      // Re-create the symlink; ignore "already exists" so a re-install works.
      await rm(target, { force: true })
      await symlink(e.link, target).catch(() => {})
      continue
    }
    if (e.hardlink !== undefined) {
      const source = safeJoin(destDir, e.hardlink)
      await rm(target, { force: true })
      await link(source, target).catch(() => {})
      continue
    }
    await writeFile(target, e.buf.subarray(e.dataStart, e.dataStart + e.size))
    // Preserve the executable bit for binaries.
    if (e.mode) {
      try {
        chmodSync(target, e.mode & 0o777)
      } catch {}
    }
  }
  return entries.length
}

/**
 * Extract a `.zip` archive into `destDir`.
 *
 * Only the entries we need are handled: stored (0) and deflated (8) files.
 * The central directory is read for the entry list; sizes come from it.
 */
async function extractZip(archivePath, destDir) {
  const buf = await readFile(archivePath)
  // Locate the end-of-central-directory record (signature 0x06054b50).
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('The downloaded archive is not a valid zip file.')

  const count = buf.readUInt16LE(eocd + 10)
  let ptr = buf.readUInt32LE(eocd + 16)

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) break
    const method = buf.readUInt16LE(ptr + 10)
    const compressedSize = buf.readUInt32LE(ptr + 20)
    const uncompressedSize = buf.readUInt32LE(ptr + 24)
    const nameLen = buf.readUInt16LE(ptr + 28)
    const extraLen = buf.readUInt16LE(ptr + 30)
    const commentLen = buf.readUInt16LE(ptr + 32)
    const localOffset = buf.readUInt32LE(ptr + 42)
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8')
    ptr += 46 + nameLen + extraLen + commentLen

    if (name.endsWith('/')) {
      await mkdir(safeJoin(destDir, name), { recursive: true })
      continue
    }

    // Read the local header to find the actual data offset.
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) continue
    const localNameLen = buf.readUInt16LE(localOffset + 26)
    const localExtraLen = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    const raw = buf.subarray(dataStart, dataStart + compressedSize)

    let data
    if (method === 0) data = raw
    else if (method === 8) data = await inflateRaw(raw)
    else throw new Error(`Unsupported zip compression method ${method}.`)

    const target = safeJoin(destDir, name)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, data)
    if (uncompressedSize && data.length !== uncompressedSize) {
      throw new Error('The extracted archive is corrupt.')
    }
  }
  return count
}

/** Join `base` with a relative archive path, refusing to escape `base`. */
function safeJoin(base, name) {
  const target = resolve(base, name)
  const baseResolved = resolve(base)
  if (target !== baseResolved && !target.startsWith(baseResolved + sep)) {
    throw new Error('The archive contains an unsafe path.')
  }
  return target
}

/* ── runtime installation ──────────────────────────────────────────────── */

/**
 * The llama.cpp build we install.
 *
 * The `latest` GitHub release has no binary assets, so we pin a known
 * build-numbered release. Bumping this constant is all it takes to ship a
 * newer runtime.
 */
const LLAMA_CPP_BUILD = 'b11765'

/** GitHub release asset for the current platform/architecture. */
function runtimeAsset() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  if (process.platform === 'darwin') {
    if (arch !== 'arm64') return null // only the arm64 build is published
    return {
      name: `llama-${LLAMA_CPP_BUILD}-bin-macos-arm64.tar.gz`,
      url: `https://github.com/${LLAMA_CPP_REPO}/releases/download/${LLAMA_CPP_BUILD}/llama-${LLAMA_CPP_BUILD}-bin-macos-arm64.tar.gz`,
      kind: 'tar.gz',
    }
  }
  if (process.platform === 'win32') {
    if (arch !== 'x64') return null
    return {
      name: `llama-${LLAMA_CPP_BUILD}-bin-win-cpu-x64.zip`,
      url: `https://github.com/${LLAMA_CPP_REPO}/releases/download/${LLAMA_CPP_BUILD}/llama-${LLAMA_CPP_BUILD}-bin-win-cpu-x64.zip`,
      kind: 'zip',
    }
  }
  if (process.platform === 'linux') {
    if (arch !== 'x64') return null
    return {
      name: `llama-${LLAMA_CPP_BUILD}-bin-ubuntu-x64.tar.gz`,
      url: `https://github.com/${LLAMA_CPP_REPO}/releases/download/${LLAMA_CPP_BUILD}/llama-${LLAMA_CPP_BUILD}-bin-ubuntu-x64.tar.gz`,
      kind: 'tar.gz',
    }
  }
  return null
}

/** Is a usable `llama-server` already installed? */
function runtimeStatus() {
  const bin = serverBinaryPath()
  return {
    installed: existsSync(bin),
    build: LLAMA_CPP_BUILD,
    path: bin,
    asset: runtimeAsset(),
    supported: runtimeAsset() !== null,
  }
}

/** Find the directory inside `root` that contains the `llama-server` binary. */
async function findServerDir(root) {
  const wanted = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'
  const queue = [root]
  while (queue.length) {
    const dir = queue.shift()
    let names = []
    try {
      names = await readdir(dir)
    } catch {
      continue
    }
    if (names.includes(wanted)) return dir
    for (const n of names) {
      const full = join(dir, n)
      try {
        const st = await stat(full)
        if (st.isDirectory()) queue.push(full)
      } catch {}
    }
  }
  return null
}

/**
 * Recursively copy a directory (fallback when `rename` cannot be used).
 *
 * Symlinks are recreated rather than dereferenced: the Linux runtime archive
 * links its shared libraries (`libggml.so` → `libggml.so.0`), and copying
 * the target bytes would both bloat the runtime and break the loader's
 * expectations about the SONAME layout.
 */
async function copyDir(from, to) {
  await mkdir(to, { recursive: true })
  for (const n of await readdir(from)) {
    const src = join(from, n)
    const dst = join(to, n)
    const st = await lstat(src)
    if (st.isSymbolicLink()) {
      let target = ''
      try {
        target = await readlink(src)
      } catch {
        continue
      }
      await rm(dst, { force: true, recursive: true })
      await symlink(target, dst)
      continue
    }
    if (st.isDirectory()) {
      await copyDir(src, dst)
      continue
    }
    await writeFile(dst, await readFile(src))
    try {
      chmodSync(dst, st.mode & 0o777)
    } catch {}
  }
}

/**
 * Download a plain file to `destPath`, reporting progress.
 *
 * Used for the runtime archive (the GGUF downloader has its own, richer
 * implementation that also validates checksums).
 */
async function downloadFile(url, destPath, onProgress) {
  const res = await httpRequest(url, { timeout: 0 })
  if (res.statusCode >= 400) {
    throw new Error(`The download server returned ${res.statusCode}.`)
  }
  const total = Number(res.headers['content-length']) || 0
  let received = 0
  let lastReport = 0
  res.on('data', (chunk) => {
    received += chunk.length
    const now = Date.now()
    if (now - lastReport >= 200) {
      lastReport = now
      onProgress({
        phase: 'downloading',
        received,
        total,
        percent: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0,
      })
    }
  })
  const out = createWriteStream(destPath)
  await pipeline(res, out)
  onProgress({ phase: 'downloading', received, total: total || received, percent: 100 })
  return destPath
}

/**
 * Download and unpack the llama.cpp runtime.
 *
 * The archive is unpacked into a staging directory first and only moved into
 * place once it is complete, so an interrupted install never leaves a
 * half-extracted runtime behind.
 */
async function installRuntime(onProgress) {
  const asset = runtimeAsset()
  if (!asset) {
    throw new Error(
      `No llama.cpp build is available for ${process.platform}/${process.arch}.`,
    )
  }
  await mkdir(runtimeDir(), { recursive: true })
  await mkdir(downloadsDir(), { recursive: true })

  const archivePath = join(downloadsDir(), asset.name)
  await downloadFile(asset.url, archivePath, onProgress)

  const staging = await mkdtemp(join(tmpdir(), 'neo-llamacpp-'))
  try {
    onProgress({ phase: 'extracting', percent: 0 })
    if (asset.kind === 'zip') await extractZip(archivePath, staging)
    else await extractTarGz(archivePath, staging)

    // The archives may or may not wrap everything in a single directory
    // (`llama-b11765/...`); find the directory that holds `llama-server`.
    const source = await findServerDir(staging)
    if (!source) {
      throw new Error('The archive does not contain a llama-server binary.')
    }

    // Replace the runtime directory: move the old one aside, move the new
    // one in, then delete the old one.
    const previous = join(dataRoot(), 'runtime.old')
    await rm(previous, { recursive: true, force: true })
    if (existsSync(runtimeDir())) await rename(runtimeDir(), previous)
    try {
      await rename(source, runtimeDir())
    } catch {
      // Cross-device rename (staging may live on a different volume).
      await copyDir(source, runtimeDir())
    }
    await rm(previous, { recursive: true, force: true })

    const bin = serverBinaryPath()
    if (!existsSync(bin)) {
      throw new Error('The llama-server binary is missing after installation.')
    }
    try {
      chmodSync(bin, 0o755)
    } catch {}
    onProgress({ phase: 'done', percent: 100 })
    return { path: bin, build: LLAMA_CPP_BUILD }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

/* ── Hugging Face: discovery ───────────────────────────────────────────── */

/**
 * Search Hugging Face for GGUF models.
 *
 * The `filter=gguf` query returns only repos that ship GGUF weights; the
 * `gguf` block of each repo's metadata carries the total weight size and
 * the architecture, which is what we need for the compatibility estimate.
 */
async function searchModels(query, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 50)
  const params = new URLSearchParams({
    filter: 'gguf',
    limit: String(limit),
    sort: 'downloads',
    direction: '-1',
    full: 'true',
  })
  if (query && String(query).trim()) params.set('search', String(query).trim())
  const data = await fetchJson(`${HF_BASE}/api/models?${params.toString()}`)
  if (!Array.isArray(data)) return []
  return data.map((m) => ({
    id: String(m.id || ''),
    downloads: Number(m.downloads) || 0,
    likes: Number(m.likes) || 0,
    pipelineTag: m.pipeline_tag || null,
    license: licenseOf(m.tags),
    tags: Array.isArray(m.tags) ? m.tags.slice(0, 24) : [],
    totalSize: Number((m.gguf || {}).total) || 0,
    architecture: (m.gguf || {}).architecture || null,
    contextLength: Number((m.gguf || {}).context_length) || 0,
  }))
}

function licenseOf(tags) {
  if (!Array.isArray(tags)) return null
  const hit = tags.find((t) => typeof t === 'string' && t.startsWith('license:'))
  return hit ? hit.slice('license:'.length) : null
}

/**
 * List the GGUF files of a repo, with their byte size and (when the repo
 * publishes one) the sha256 of the file — used to validate the download.
 *
 * Only "regular" quantizations are offered: split shards (`-00001-of-00002`)
 * and BF16/FP16 weights are skipped because they are either unwieldy or
 * bigger than the machine can hold.
 */
async function listModelFiles(repoId) {
  const safe = String(repoId || '').trim()
  // Allow raw slashes (owner/repo) or URL-encoded (%2F)
  if (!safe || !/^[\w.-]+(\/[\w.-]+|%2F)+[\w.-]*$/.test(safe)) {
    throw new Error('Invalid Hugging Face repository id.')
  }
  const data = await fetchJson(
    `${HF_BASE}/api/models/${safe.replace(/%2F/g, '/')}?blobs=true`,
  )
  const siblings = Array.isArray(data.siblings) ? data.siblings : []
  const files = []
  for (const s of siblings) {
    const name = String(s.rfilename || '')
    if (!name.toLowerCase().endsWith('.gguf')) continue
    if (/\.\d+-of-\.\d+\.gguf$/i.test(name)) continue
    if (/(^|\/)(BF16|F16|F32|FP16|FP32)\//i.test(name)) continue
    if (/-(BF16|F16|F32|FP16|FP32)\.gguf$/i.test(name)) continue
    const size = Number(s.size) || Number((s.lfs || {}).size) || 0
    const sha = (s.lfs || {}).sha256 || null
    files.push({
      name,
      size,
      sha256: sha,
      quant: quantizationOf(name),
    })
  }
  files.sort((a, b) => a.size - b.size)
  return {
    repoId: safe,
    files,
    totalSize: Number((data.gguf || {}).total) || 0,
    architecture: (data.gguf || {}).architecture || null,
    contextLength: Number((data.gguf || {}).context_length) || 0,
    license: licenseOf(data.tags),
  }
}

/** Extract the quantization tag (e.g. `Q4_K_M`) from a GGUF file name. */
function quantizationOf(name) {
  const base = basename(name).replace(/\.gguf$/i, '')
  const m = base.match(/[.-](IQ\d(?:_\w+)?|Q\d(?:_[A-Z0-9]+)*|Q\d_\w+|F16|BF16|F32|TQ\d_\w+|MXFP\d+)\s*$/i)
  if (m) return m[1].toUpperCase()
  return null
}

/* ── compatibility ─────────────────────────────────────────────────────── */

/**
 * Decide whether a model of `fileSize` bytes can run on this machine.
 *
 * The estimate is deliberately pessimistic: the weights have to fit in RAM
 * (llama.cpp memory-maps them, but the page cache still counts against the
 * machine) and the KV cache for the context window needs headroom on top.
 * A "risky" verdict is still allowed — the user may know better than we do
 * (swap, a GPU with VRAM, a smaller context) — but it is surfaced in the UI.
 */
function estimateFit(fileSize, hardware, options = {}) {
  const size = Math.max(Number(fileSize) || 0, 0)
  const ram = Number(hardware.ramBytes) || 0
  const disk = Number(hardware.freeDiskBytes) || 0
  const ctx = Math.min(Number(options.contextLength) || 4096, 8192)
  // KV cache is roughly 0.5 MB per token for a mid-size model at 4k context.
  const kvBytes = ctx * 512 * 1024
  const requiredRam = Math.round(size * 1.15 + kvBytes + 256 * 1024 * 1024)

  const out = {
    fileSize: size,
    requiredRamBytes: requiredRam,
    status: 'ok',
    reason: null,
    canRun: true,
  }
  if (size === 0) {
    out.status = 'unknown'
    out.reason = 'The model size is unknown.'
    return out
  }
  if (disk > 0 && size > disk * 0.95) {
    out.status = 'impossible'
    out.canRun = false
    out.reason = 'Not enough free disk space.'
    return out
  }
  if (ram > 0 && requiredRam > ram * 0.9) {
    out.status = 'impossible'
    out.canRun = false
    out.reason = 'Not enough RAM.'
    return out
  }
  if (ram > 0 && requiredRam > ram * 0.65) {
    out.status = 'risky'
    out.reason = 'Tight on RAM — expect slow inference or swapping.'
    return out
  }
  if (ram > 0 && requiredRam > ram * 0.45) {
    out.status = 'tight'
    out.reason = 'Fits, but only with limited headroom.'
  }
  return out
}

/* ── downloads ─────────────────────────────────────────────────────────── */

/** In-flight downloads, keyed by an id handed back to the renderer. */
const downloads = new Map()
let downloadSeq = 0

function cancelDownload(id) {
  const d = downloads.get(id)
  if (!d) return false
  d.cancelled = true
  try {
    d.req.destroy()
  } catch {}
  return true
}

/**
 * Download a GGUF file from Hugging Face.
 *
 * The file is written to `<downloads>/<id>.part` and only renamed to its
 * final name once it is complete, so an interrupted download can never be
 * mistaken for a usable model. Progress is reported through `onProgress`.
 */
async function downloadModel(spec, onProgress) {
  const repoId = String(spec.repoId || '').trim()
  const fileName = String(spec.fileName || '').trim()
  if (!/^[\w.-]+\/[\w.-]+$/.test(repoId)) throw new Error('Invalid repository id.')
  if (!fileName || fileName.includes('..')) throw new Error('Invalid file name.')

  const id = `dl_${++downloadSeq}`
  const encoded = fileName.split('/').map(encodeURIComponent).join('/')
  const url = `${HF_BASE}/${repoId}/resolve/main/${encoded}?download=true`
  const expectedSize = Number(spec.size) || 0
  const sha256 = spec.sha256 || null

  await mkdir(downloadsDir(), { recursive: true })
  await mkdir(modelsDir(), { recursive: true })
  // The partial file is named after the *target*, not after the attempt, so a
  // retry of the same download resumes where the previous one stopped.
  const partKey = crypto
    .createHash('sha1')
    .update(`${repoId}/${fileName}`)
    .digest('hex')
    .slice(0, 16)
  const partPath = join(downloadsDir(), `${partKey}.part`)
  const finalPath = join(modelsDir(), `${repoId.replace(/[\\/]/g, '__')}__${basename(fileName)}`)

  const state = { id, cancelled: false, req: null }
  downloads.set(id, state)

  try {
    // Resume support: if a previous attempt left a partial file, ask the
    // server for the remaining bytes only.
    let from = 0
    try {
      const st = await stat(partPath)
      if (st.size > 0 && st.size < expectedSize) from = st.size
    } catch {}

    const headers = { Accept: 'application/octet-stream' }
    if (from > 0) headers.Range = `bytes=${from}-`

    const res = await httpRequest(url, { headers, timeout: 0 })
    if (res.statusCode >= 400) {
      throw new Error(`The download server returned ${res.statusCode}.`)
    }
    const append = from > 0 && res.statusCode === 206
    if (from > 0 && !append) from = 0

    state.req = res
    let received = from
    const total = expectedSize || Number(res.headers['content-length']) || 0
    let lastReport = 0

    const out = createWriteStream(partPath, append ? { flags: 'a' } : { flags: 'w' })
    res.on('data', (chunk) => {
      received += chunk.length
      const now = Date.now()
      if (now - lastReport >= 200) {
        lastReport = now
        onProgress({
          id,
          received,
          total,
          percent: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0,
          phase: 'downloading',
        })
      }
    })
    await pipeline(res, out)
    if (state.cancelled) throw new Error('The download was cancelled.')

    const finalSize = (await stat(partPath)).size
    if (expectedSize > 0 && finalSize !== expectedSize) {
      throw new Error(
        `The downloaded file is ${finalSize} bytes but ${expectedSize} were expected.`,
      )
    }
    if (sha256) await verifySha256(partPath, sha256)

    await rename(partPath, finalPath)
    onProgress({ id, received: finalSize, total: finalSize, percent: 100, phase: 'done' })
    return { id, path: finalPath, size: finalSize, fileName, repoId }
  } catch (e) {
    if (state.cancelled) {
      onProgress({ id, received: 0, total: expectedSize, percent: 0, phase: 'cancelled' })
    }
    throw e
  } finally {
    downloads.delete(id)
  }
}

/** Verify the sha256 of a downloaded file against the value HF published. */
async function verifySha256(path, expected) {
  const hash = crypto.createHash('sha256')
  const stream = createReadStream(path)
  await new Promise((resolveP, reject) => {
    stream.on('data', (c) => hash.update(c))
    stream.on('end', resolveP)
    stream.on('error', reject)
  })
  const actual = hash.digest('hex')
  if (actual !== expected) {
    throw new Error('The downloaded file is corrupt (checksum mismatch).')
  }
}

/* ── local model registry ──────────────────────────────────────────────── */

/**
 * List the GGUF models that were downloaded into the local model directory.
 *
 * The file name encodes the source repository (`<owner>__<repo>__<file>`),
 * which we split back apart so the UI can show the human-readable name.
 */
async function listLocalModels() {
  await mkdir(modelsDir(), { recursive: true })
  const names = await readdir(modelsDir())
  const out = []
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.gguf')) continue
    const full = join(modelsDir(), name)
    let st
    try {
      st = await stat(full)
    } catch {
      continue
    }
    const m = /^([^_]+)__([^_]+)__(.+)$/.exec(name)
    out.push({
      id: name,
      path: full,
      fileName: m ? m[3] : name,
      repoId: m ? `${m[1]}/${m[2]}` : null,
      displayName: m ? m[2] : name.replace(/\.gguf$/i, ''),
      quant: quantizationOf(name),
      size: st.size,
      modifiedAt: st.mtimeMs,
    })
  }
  out.sort((a, b) => b.modifiedAt - a.modifiedAt)
  return out
}

/** Delete a downloaded model. */
async function deleteLocalModel(id) {
  const name = basename(String(id || ''))
  if (!name.toLowerCase().endsWith('.gguf')) {
    throw new Error('Invalid model id.')
  }
  await rm(join(modelsDir(), name), { force: true })
  return { id: name }
}

/* ── server lifecycle ──────────────────────────────────────────────────── */

/**
 * The running `llama-server`, if any.
 *
 * Only one server runs at a time; it serves the model the user selected.
 */
const server = {
  proc: null,
  port: 0,
  modelPath: null,
  modelId: null,
  startedAt: 0,
  logs: [],
}

const DEFAULT_PORT = 18080

/** Current state of the local server (safe to send to the renderer). */
function serverStatus() {
  return {
    running: !!server.proc && server.proc.exitCode === null,
    port: server.port,
    url: server.port ? `http://127.0.0.1:${server.port}` : null,
    modelId: server.modelId,
    modelPath: server.modelPath,
    startedAt: server.startedAt || 0,
    logs: server.logs.slice(-60),
  }
}

/** Append a line to the (bounded) server log buffer. */
function pushLog(line) {
  const text = String(line).replace(/\s+$/, '')
  if (!text) return
  server.logs.push(text)
  if (server.logs.length > 400) server.logs.splice(0, server.logs.length - 400)
}

/** Stop the running server (if any) and wait for it to exit. */
async function stopServer() {
  const proc = server.proc
  if (!proc || proc.exitCode !== null) {
    server.proc = null
    server.port = 0
    server.modelId = null
    server.modelPath = null
    return serverStatus()
  }
  try {
    proc.kill('SIGTERM')
  } catch {}
  // Give the process a moment to shut down cleanly, then force it.
  const exited = await new Promise((resolveP) => {
    const timer = setTimeout(() => resolveP(false), 4000)
    proc.once('exit', () => {
      clearTimeout(timer)
      resolveP(true)
    })
  })
  if (!exited) {
    try {
      proc.kill('SIGKILL')
    } catch {}
  }
  server.proc = null
  server.port = 0
  server.modelId = null
  server.modelPath = null
  return serverStatus()
}

/** Wait until the server answers on `/health`, or time out. */
async function waitForReady(port, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await httpRequest(`http://127.0.0.1:${port}/health`, { timeout: 2000 })
      await readAll(res)
      if (res.statusCode >= 200 && res.statusCode < 500) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

/**
 * Start `llama-server` for a local model.
 *
 * The server speaks the OpenAI-compatible API, so the renderer can talk to it
 * exactly like any other provider.
 */
async function startServer(modelId, options = {}) {
  const status = runtimeStatus()
  if (!status.installed) {
    throw new Error('The llama.cpp runtime is not installed yet.')
  }
  const models = await listLocalModels()
  const model = models.find((m) => m.id === modelId)
  if (!model) throw new Error('The model could not be found.')

  if (server.proc && server.proc.exitCode === null) await stopServer()

  const port = Number(options.port) || DEFAULT_PORT
  const ctx = Math.min(Number(options.contextLength) || 4096, 32768)
  const threads = Math.max(
    1,
    Math.min(Number(options.threads) || os.cpus().length || 4, 64),
  )

  const args = [
    '--model', model.path,
    '--port', String(port),
    '--host', '127.0.0.1',
    '--ctx-size', String(ctx),
    '--threads', String(threads),
    '--no-webui',
    // A stable model id keeps the chat's "model" field in sync with what the
    // server reports through /v1/models, no matter how the file is named.
    '--alias', 'local',
  ]
  if (options.gpuLayers !== undefined && options.gpuLayers !== null) {
    args.push('--n-gpu-layers', String(Math.max(0, Number(options.gpuLayers) || 0)))
  }
  if (options.jinja) args.push('--jinja')

  server.logs = []
  server.modelId = model.id
  server.modelPath = model.path

  const proc = spawn(serverBinaryPath(), args, {
    cwd: runtimeDir(),
    env: { ...process.env, LD_LIBRARY_PATH: runtimeDir() },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  server.proc = proc
  server.port = port

  proc.stdout.on('data', (d) => {
    for (const line of String(d).split('\n')) pushLog(line)
  })
  proc.stderr.on('data', (d) => {
    for (const line of String(d).split('\n')) pushLog(line)
  })
  proc.on('error', (e) => pushLog(`Failed to start llama-server: ${e.message}`))
  proc.on('exit', (code, signal) => {
    pushLog(`llama-server exited (code ${code}, signal ${signal || 'none'})`)
    if (server.proc === proc) {
      server.proc = null
      server.port = 0
      server.modelId = null
      server.modelPath = null
    }
  })

  const ready = await waitForReady(port)
  if (!ready) {
    await stopServer()
    throw new Error('llama-server did not become ready in time.')
  }
  server.startedAt = Date.now()
  return serverStatus()
}

/** Ask the running server which models it serves. */
async function listServerModels() {
  if (!server.port) return []
  try {
    const res = await httpRequest(`http://127.0.0.1:${server.port}/v1/models`, {
      timeout: 5000,
    })
    const text = await readAll(res)
    if (res.statusCode < 200 || res.statusCode >= 300) return []
    const data = JSON.parse(text)
    const list = Array.isArray(data?.data) ? data.data : []
    return list.map((m) => ({ id: String(m.id || ''), ownedBy: m.owned_by || null }))
  } catch {
    return []
  }
}

module.exports = {
  dataRoot,
  runtimeDir,
  modelsDir,
  downloadsDir,
  serverBinaryPath,
  detectHardware,
  searchModels,
  listModelFiles,
  quantizationOf,
  estimateFit,
  downloadModel,
  cancelDownload,
  runtimeStatus,
  installRuntime,
  listLocalModels,
  deleteLocalModel,
  startServer,
  stopServer,
  serverStatus,
  listServerModels,
}

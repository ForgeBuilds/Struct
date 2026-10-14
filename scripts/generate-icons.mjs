/*
 * Author: Lumorix Studios
 * Check the LICENSE in the GitHub repo for more information on permissions to use this code.
 */

/*
 * Generates the app icons electron-builder needs from one high-res source.
 *
 *   npm run icons
 *
 * Reads  src/assets/images/icon.png  (square, >= 512px)
 * Writes build/icon.png   512x512 - Linux / generic
 *        build/icon.ico   multi   - Windows
 *        build/icon.icns  multi   - macOS
 *
 * PNG decode/encode is implemented here because the project has no image
 * dependency and the canonical tools (`iconutil`, ImageMagick) are macOS-only
 * or optional. We package Linux artifacts on Linux, so the .ico and .icns
 * containers are assembled directly per Microsoft's and Apple's formats.
 */

import { deflateSync, inflateSync } from 'node:zlib'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()
const SOURCE = join(root, 'src', 'assets', 'images', 'icon.png')
const OUT = join(root, 'build')

/* ---------------------------------------------------------------- PNG decode */

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('source is not a PNG')
  let pos = 8
  let width = 0
  let height = 0
  let depth = 0
  let colorType = 0
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      depth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (depth !== 8) throw new Error(`unsupported bit depth ${depth} (expected 8)`)
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]
  if (!channels) throw new Error(`unsupported color type ${colorType}`)

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(width * height * 4)
  let rp = 0
  const prev = Buffer.alloc(stride)
  const line = Buffer.alloc(stride)

  for (let y = 0; y < height; y++) {
    const filter = raw[rp++]
    raw.copy(line, 0, rp, rp + stride)
    rp += stride
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      switch (filter) {
        case 0: break
        case 1: line[i] = (line[i] + a) & 0xff; break
        case 2: line[i] = (line[i] + b) & 0xff; break
        case 3: line[i] = (line[i] + ((a + b) >> 1)) & 0xff; break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff
          break
        }
        default: throw new Error(`bad scanline filter ${filter}`)
      }
    }
    // Normalize to RGBA regardless of source channel count.
    for (let x = 0; x < width; x++) {
      const s = x * channels
      const d = (y * width + x) * 4
      const grey = line[s]
      out[d] = channels === 1 || channels === 0 ? grey : line[s]
      out[d + 1] = channels >= 3 ? line[s + 1] : grey
      out[d + 2] = channels >= 3 ? line[s + 2] : grey
      out[d + 3] = channels === 4 ? line[s + 3] : channels === 2 ? line[s + 1] : 255
    }
    line.copy(prev)
  }
  return { width, height, data: out }
}

/* ---------------------------------------------- area-average down/up-scaling */

function resize(img, size) {
  const { width: w, height: h, data } = img
  const out = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    const y0 = Math.floor((y * h) / size)
    const y1 = Math.max(Math.floor(((y + 1) * h) / size), y0 + 1)
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor((x * w) / size)
      const x1 = Math.max(Math.floor(((x + 1) * w) / size), x0 + 1)
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * w + sx) * 4
          r += data[i]
          g += data[i + 1]
          b += data[i + 2]
          a += data[i + 3]
          n++
        }
      }
      const d = (y * size + x) * 4
      out[d] = Math.round(r / n)
      out[d + 1] = Math.round(g / n)
      out[d + 2] = Math.round(b / n)
      out[d + 3] = Math.round(a / n)
    }
  }
  return { width: size, height: size, data: out }
}

/* ---------------------------------------------------------------- PNG encode */

const CRC = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(img) {
  const { width, height, data } = img
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // truecolour + alpha
  const row = width * 4 + 1
  const raw = Buffer.alloc(row * height)
  for (let y = 0; y < height; y++) {
    raw[y * row] = 0 // filter: none
    data.copy(raw, y * row + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}


/* --------------------------------------------------------------------- main */

async function main() {
  const source = decodePng(await readFile(SOURCE))
  if (source.width !== source.height) {
    throw new Error(`source must be square, got ${source.width}x${source.height}`)
  }
  await mkdir(OUT, { recursive: true })
  console.log(`[icons] source ${source.width}x${source.height}`)

  // Linux / generic - electron-builder wants >= 512px
  await writeFile(join(OUT, 'icon.png'), encodePng(resize(source, 512)))
  console.log('[icons] build/icon.png (512x512)')

  // Windows .ico - ICONDIR header + one 16-byte entry per embedded PNG
  const icoSizes = [16, 24, 32, 48, 64, 128, 256]
  const blobs = icoSizes.map((s) => encodePng(resize(source, s)))
  const dir = Buffer.alloc(6)
  dir.writeUInt16LE(0, 0) // reserved
  dir.writeUInt16LE(1, 2) // type: icon
  dir.writeUInt16LE(icoSizes.length, 4)
  let offset = 6 + 16 * icoSizes.length
  const entries = icoSizes.map((s, i) => {
    const e = Buffer.alloc(16)
    e[0] = s >= 256 ? 0 : s // width, 0 means 256
    e[1] = s >= 256 ? 0 : s // height
    e[2] = 0 // palette size
    e[3] = 0 // reserved
    e.writeUInt16LE(1, 4) // colour planes
    e.writeUInt16LE(32, 6) // bits per pixel
    e.writeUInt32LE(blobs[i].length, 8)
    e.writeUInt32LE(offset, 12)
    offset += blobs[i].length
    return e
  })
  await writeFile(join(OUT, 'icon.ico'), Buffer.concat([dir, ...entries, ...blobs]))
  console.log(`[icons] build/icon.ico (${icoSizes.join(', ')})`)

  // macOS .icns - PNG-backed elements, each block is tag + length + data
  const icns = [
    ['icp4', 16], ['icp5', 32], ['icp6', 64],
    ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024],
    ['ic11', 32], // 16x16@2x
    ['ic12', 64], // 32x32@2x
    ['ic13', 256], // 128x128@2x
    ['ic14', 512], // 256x256@2x
  ]
  const blocks = icns.map(([tag, size]) => {
    const png = encodePng(resize(source, size))
    const len = Buffer.alloc(4)
    len.writeUInt32BE(png.length + 8) // includes the 8-byte block header
    return Buffer.concat([Buffer.from(tag, 'ascii'), len, png])
  })
  const body = Buffer.concat(blocks)
  const total = Buffer.alloc(4)
  total.writeUInt32BE(body.length + 8)
  await writeFile(
    join(OUT, 'icon.icns'),
    Buffer.concat([Buffer.from('icns', 'ascii'), total, body]),
  )
  console.log(`[icons] build/icon.icns (${icns.length} elements)`)
}

main().catch((error) => {
  console.error(`[icons] failed: ${error.message}`)
  process.exit(1)
})

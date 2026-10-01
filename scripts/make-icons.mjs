// ============================================================================
// scripts/make-icons.mjs — draw the app icon, with no dependencies.
//
//   node scripts/make-icons.mjs
//
// Writes public/icons/: icon.svg (the master), icon-192.png, icon-512.png,
// icon-maskable-512.png (full-bleed, content inside the 80% safe zone) and
// apple-touch-icon.png (180, full-bleed: iOS rounds the corners itself).
//
// The picture: a curve on a dark rounded square, in the board's own colours
// (--bg #0f1117, --border #2a3047, --accent #4f9cf9). PNGs are rasterised here
// by 4×4 supersampling and written with node's zlib — no canvas, no packages.
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

const BG = [0x0f, 0x11, 0x17]
const AXIS = [0x2f, 0x37, 0x52]
const CURVE = [0x4f, 0x9c, 0xf9]
const DOT = [0xe6, 0xea, 0xf5]

// Geometry in a 512 box. `inset` shrinks the drawing toward the centre (the
// maskable icon keeps everything in the middle 80%).
function geometry(inset) {
  const s = (v) => 256 + (v - 256) * inset
  const pts = []
  for (let i = 0; i <= 160; i++) {
    const t = i / 160
    const x = 92 + t * 328
    // A cubic-like S: up, down, up again — the shape of y = x³ − 3x.
    const u = (t - 0.5) * 2 // -1..1
    const y = 256 - 150 * (1.9 * u * u * u - 1.15 * u) / 0.85
    pts.push([s(x), s(y)])
  }
  return {
    pts,
    axisX: [s(64), s(448), s(256)], // x from, x to, at y
    axisY: [s(64), s(448), s(256)], // y from, y to, at x
    axisW: 10 * inset,
    curveW: 30 * inset,
    dot: [s(pts[118][0]), s(pts[118][1])],
    dotR: 24 * inset,
  }
}

function svg(inset = 1, rounded = true) {
  const g = geometry(inset)
  const d = g.pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('')
  const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" ${rounded ? 'rx="112" ' : ''}fill="${hex(BG)}"/>
  <path d="M${g.axisX[0]} ${g.axisX[2]}H${g.axisX[1]}M${g.axisY[2]} ${g.axisY[0]}V${g.axisY[1]}" stroke="${hex(AXIS)}" stroke-width="${g.axisW}" stroke-linecap="round"/>
  <path d="${d}" fill="none" stroke="${hex(CURVE)}" stroke-width="${g.curveW}" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="${g.dot[0].toFixed(1)}" cy="${g.dot[1].toFixed(1)}" r="${g.dotR}" fill="${hex(DOT)}"/>
</svg>
`
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const qx = ax + t * dx - px
  const qy = ay + t * dy - py
  return Math.sqrt(qx * qx + qy * qy)
}

function insideRounded(x, y, r) {
  const cx = Math.min(Math.max(x, r), 512 - r)
  const cy = Math.min(Math.max(y, r), 512 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

/** RGBA pixels at `size`, sampled from the same geometry as the SVG. */
function raster(size, inset, rounded) {
  const g = geometry(inset)
  const segs = []
  for (let i = 1; i < g.pts.length; i++) segs.push([...g.pts[i - 1], ...g.pts[i]])
  const N = 4
  const k = 512 / size
  const px = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, gg = 0, b = 0, a = 0
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const X = (x + (sx + 0.5) / N) * k
          const Y = (y + (sy + 0.5) / N) * k
          if (rounded && !insideRounded(X, Y, 112)) continue
          let c = BG
          const onAxisX = Math.abs(Y - g.axisX[2]) <= g.axisW / 2 && X >= g.axisX[0] - g.axisW / 2 && X <= g.axisX[1] + g.axisW / 2
          const onAxisY = Math.abs(X - g.axisY[2]) <= g.axisW / 2 && Y >= g.axisY[0] - g.axisW / 2 && Y <= g.axisY[1] + g.axisW / 2
          if (onAxisX || onAxisY) c = AXIS
          for (const s of segs) {
            if (X < Math.min(s[0], s[2]) - g.curveW || X > Math.max(s[0], s[2]) + g.curveW) continue
            if (distToSegment(X, Y, s[0], s[1], s[2], s[3]) <= g.curveW / 2) {
              c = CURVE
              break
            }
          }
          if ((X - g.dot[0]) ** 2 + (Y - g.dot[1]) ** 2 <= g.dotR ** 2) c = DOT
          r += c[0]
          gg += c[1]
          b += c[2]
          a += 1
        }
      }
      const o = (y * size + x) * 4
      if (a > 0) {
        px[o] = Math.round(r / a)
        px[o + 1] = Math.round(gg / a)
        px[o + 2] = Math.round(b / a)
      }
      px[o + 3] = Math.round((a / (N * N)) * 255)
    }
  }
  return px
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, 'icon.svg'), svg(1, true))
const jobs = [
  ['icon-192.png', 192, 1, true],
  ['icon-512.png', 512, 1, true],
  ['icon-maskable-512.png', 512, 0.78, false],
  ['apple-touch-icon.png', 180, 0.86, false],
]
for (const [name, size, inset, rounded] of jobs) {
  fs.writeFileSync(path.join(OUT, name), png(size, raster(size, inset, rounded)))
  console.log('wrote', name)
}

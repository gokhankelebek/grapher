// ============================================================================
// GRAPHER — a minimal QR Code encoder (ISO/IEC 18004), in plain TypeScript.
//
// Byte mode only, all four error-correction levels, versions 1–40, automatic
// mask choice by the standard penalty rules. That is the whole of what a share
// link needs: the link is bytes, and the projector shows one code.
//
// The construction follows the standard step by step — and the well-known
// public-domain reference by Project Nayuki, whose structure this mirrors:
//
//   1. pick the smallest version whose data capacity holds the bytes
//   2. bit stream: mode 0100, length, the bytes, terminator, pad 0xEC 0x11
//   3. split into blocks, append Reed–Solomon check bytes, interleave
//   4. draw the function patterns (finders, timing, alignment, version info)
//   5. lay the codewords out in the two-column zig-zag
//   6. try the eight masks, keep the one with the lowest penalty
//
// No DOM: the result is a boolean grid. Drawing it is the caller's business
// (qrSvgPath below gives an SVG path, which scales for a projector).
// ============================================================================

export type QrEcc = 'L' | 'M' | 'Q' | 'H'

export const QR_MIN_VERSION = 1
export const QR_MAX_VERSION = 40

/** Format-information bits for each level (not alphabetical: the standard's own order). */
const ECC_FORMAT_BITS: Record<QrEcc, number> = { L: 1, M: 0, Q: 3, H: 2 }
const ECC_INDEX: Record<QrEcc, number> = { L: 0, M: 1, Q: 2, H: 3 }

// Index 0 is unused so a version can index directly. Rows: L, M, Q, H.
const ECC_CODEWORDS_PER_BLOCK: readonly (readonly number[])[] = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
]

const NUM_ERROR_CORRECTION_BLOCKS: readonly (readonly number[])[] = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
]

const PENALTY_N1 = 3
const PENALTY_N2 = 3
const PENALTY_N3 = 40
const PENALTY_N4 = 10

// ------------------------------------------------------------- capacities

/** Modules available for data + ECC once every function pattern is drawn. */
export function rawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2
    result -= (25 * numAlign - 10) * numAlign - 55
    if (ver >= 7) result -= 36
  }
  return result
}

/** Data codewords (bytes, before ECC) a version holds at a level. */
export function dataCodewords(ver: number, ecc: QrEcc): number {
  const e = ECC_INDEX[ecc]
  return Math.floor(rawDataModules(ver) / 8) - ECC_CODEWORDS_PER_BLOCK[e][ver] * NUM_ERROR_CORRECTION_BLOCKS[e][ver]
}

const countBits = (ver: number): number => (ver <= 9 ? 8 : 16)

/** How many bytes byte mode fits in a version at a level. */
export function byteCapacity(ver: number, ecc: QrEcc): number {
  return Math.floor((dataCodewords(ver, ecc) * 8 - 4 - countBits(ver)) / 8)
}

/** The smallest version that holds `n` bytes, or null when even 40 cannot. */
export function versionFor(n: number, ecc: QrEcc, minVersion = QR_MIN_VERSION): number | null {
  for (let v = Math.max(QR_MIN_VERSION, minVersion); v <= QR_MAX_VERSION; v++) {
    if (byteCapacity(v, ecc) >= n) return v
  }
  return null
}

// ------------------------------------------------------------- Reed–Solomon

/** GF(2^8) product modulo x^8 + x^4 + x^3 + x^2 + 1 (0x11D). */
function gfMul(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}

/** The generator polynomial's coefficients, highest power first (leading 1 dropped). */
export function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root)
      if (j + 1 < result.length) result[j] ^= result[j + 1]
    }
    root = gfMul(root, 0x02)
  }
  return result
}

/** The check bytes for one block. */
export function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0)
  for (const b of data) {
    const factor = b ^ (result.shift() as number)
    result.push(0)
    for (let i = 0; i < divisor.length; i++) result[i] ^= gfMul(divisor[i], factor)
  }
  return result
}

// ------------------------------------------------------------- codewords

/** The data codewords for `bytes` at a version: header, bytes, terminator, padding. */
export function dataStream(bytes: Uint8Array, ver: number, ecc: QrEcc): number[] {
  const bits: number[] = []
  const put = (val: number, len: number): void => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1)
  }
  put(0b0100, 4)
  put(bytes.length, countBits(ver))
  for (const b of bytes) put(b, 8)
  const capacityBits = dataCodewords(ver, ecc) * 8
  put(0, Math.min(4, capacityBits - bits.length))
  put(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) put(pad, 8)
  const out: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]
    out.push(v)
  }
  return out
}

/** Split into blocks, add each block's check bytes, and interleave. */
export function addEccAndInterleave(data: readonly number[], ver: number, ecc: QrEcc): number[] {
  const e = ECC_INDEX[ecc]
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[e][ver]
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[e][ver]
  const rawCodewords = Math.floor(rawDataModules(ver) / 8)
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks)
  const shortBlockLen = Math.floor(rawCodewords / numBlocks)

  const blocks: number[][] = []
  const divisor = rsDivisor(blockEccLen)
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const len = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1)
    const dat = data.slice(k, k + len)
    k += len
    const check = rsRemainder(dat, divisor)
    // A short block gets a placeholder so every block has the same length.
    if (i < numShortBlocks) dat.push(0)
    blocks.push(dat.concat(check))
  }

  const result: number[] = []
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i])
    })
  }
  return result
}

// ------------------------------------------------------------- the matrix

export interface QrCode {
  version: number
  size: number
  ecc: QrEcc
  mask: number
  /** modules[y][x], true = dark. */
  modules: boolean[][]
}

export function alignmentPositions(ver: number): number[] {
  if (ver === 1) return []
  const numAlign = Math.floor(ver / 7) + 2
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2
  const result = [6]
  for (let pos = ver * 4 + 10; result.length < numAlign; pos -= step) result.splice(1, 0, pos)
  return result
}

/** The 15 format bits (level + mask, BCH-coded and masked). */
export function formatBits(ecc: QrEcc, mask: number): number {
  const data = (ECC_FORMAT_BITS[ecc] << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  return ((data << 10) | rem) ^ 0x5412
}

/** The 18 version bits (versions 7 and up). */
export function versionBits(ver: number): number {
  let rem = ver
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
  return (ver << 12) | rem
}

const bit = (x: number, i: number): boolean => ((x >>> i) & 1) !== 0

function maskBit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0
    case 1: return y % 2 === 0
    case 2: return x % 3 === 0
    case 3: return (x + y) % 3 === 0
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0
    case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
    default: return false
  }
}

class Grid {
  readonly size: number
  readonly modules: boolean[][]
  readonly isFunction: boolean[][]
  constructor(size: number) {
    this.size = size
    this.modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
    this.isFunction = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  }
  setFn(x: number, y: number, dark: boolean): void {
    this.modules[y][x] = dark
    this.isFunction[y][x] = true
  }
}

function drawFunctionPatterns(g: Grid, ver: number): void {
  const size = g.size
  for (let i = 0; i < size; i++) {
    g.setFn(6, i, i % 2 === 0)
    g.setFn(i, 6, i % 2 === 0)
  }
  const finder = (cx: number, cy: number): void => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy))
        const x = cx + dx
        const y = cy + dy
        if (x >= 0 && x < size && y >= 0 && y < size) g.setFn(x, y, d !== 2 && d !== 4)
      }
    }
  }
  finder(3, 3)
  finder(size - 4, 3)
  finder(3, size - 4)

  const pos = alignmentPositions(ver)
  const n = pos.length
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          g.setFn(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
        }
      }
    }
  }

  // Reserve the format areas now (drawn for real once the mask is known).
  drawFormat(g, 'L', 0)

  if (ver >= 7) {
    const bits = versionBits(ver)
    for (let i = 0; i < 18; i++) {
      const b = bit(bits, i)
      const a = size - 11 + (i % 3)
      const c = Math.floor(i / 3)
      g.setFn(a, c, b)
      g.setFn(c, a, b)
    }
  }
}

function drawFormat(g: Grid, ecc: QrEcc, mask: number): void {
  const bits = formatBits(ecc, mask)
  const size = g.size
  for (let i = 0; i <= 5; i++) g.setFn(8, i, bit(bits, i))
  g.setFn(8, 7, bit(bits, 6))
  g.setFn(8, 8, bit(bits, 7))
  g.setFn(7, 8, bit(bits, 8))
  for (let i = 9; i < 15; i++) g.setFn(14 - i, 8, bit(bits, i))
  for (let i = 0; i < 8; i++) g.setFn(size - 1 - i, 8, bit(bits, i))
  for (let i = 8; i < 15; i++) g.setFn(8, size - 15 + i, bit(bits, i))
  g.setFn(8, size - 8, true) // the dark module
}

function drawCodewords(g: Grid, data: readonly number[]): void {
  const size = g.size
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (!g.isFunction[y][x] && i < data.length * 8) {
          g.modules[y][x] = bit(data[i >>> 3], 7 - (i & 7))
          i++
        }
        // Any remainder bits stay light (0), as the standard says.
      }
    }
  }
}

function applyMask(g: Grid, mask: number): void {
  for (let y = 0; y < g.size; y++) {
    for (let x = 0; x < g.size; x++) {
      if (!g.isFunction[y][x] && maskBit(mask, x, y)) g.modules[y][x] = !g.modules[y][x]
    }
  }
}

// ------------------------------------------------------------- penalty

export function penaltyScore(modules: readonly (readonly boolean[])[]): number {
  const size = modules.length
  let result = 0

  const addHistory = (run: number, history: number[]): void => {
    if (history[0] === 0) run += size // the light border before the first run
    history.pop()
    history.unshift(run)
  }
  const countPatterns = (h: readonly number[]): number => {
    const n = h[1]
    const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n
    return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0)
  }
  const terminate = (color: boolean, run: number, history: number[]): number => {
    if (color) {
      addHistory(run, history)
      run = 0
    }
    run += size
    addHistory(run, history)
    return countPatterns(history)
  }

  const line = (at: (i: number) => boolean): void => {
    let color = false
    let run = 0
    const history = [0, 0, 0, 0, 0, 0, 0]
    for (let i = 0; i < size; i++) {
      if (at(i) === color) {
        run++
        if (run === 5) result += PENALTY_N1
        else if (run > 5) result++
      } else {
        addHistory(run, history)
        if (!color) result += countPatterns(history) * PENALTY_N3
        color = at(i)
        run = 1
      }
    }
    result += terminate(color, run, history) * PENALTY_N3
  }
  for (let y = 0; y < size; y++) line((x) => modules[y][x])
  for (let x = 0; x < size; x++) line((y) => modules[y][x])

  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x]
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) result += PENALTY_N2
    }
  }

  let dark = 0
  for (const row of modules) for (const m of row) if (m) dark++
  const total = size * size
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1
  result += k * PENALTY_N4
  return result
}

// ------------------------------------------------------------- public API

export interface QrOptions {
  ecc?: QrEcc
  /** Force a mask (0–7); absent = the lowest-penalty one. */
  mask?: number
  minVersion?: number
}

export class QrTooLongError extends Error {
  readonly bytes: number
  readonly max: number
  constructor(bytes: number, max: number) {
    super(`Too long for a QR code: ${bytes} bytes, and the most one code holds at this level is ${max}.`)
    this.name = 'QrTooLongError'
    this.bytes = bytes
    this.max = max
  }
}

/** Encode bytes. Throws QrTooLongError when even version 40 cannot hold them. */
export function encodeQrBytes(bytes: Uint8Array, opts: QrOptions = {}): QrCode {
  const ecc = opts.ecc ?? 'M'
  const ver = versionFor(bytes.length, ecc, opts.minVersion)
  if (ver === null) throw new QrTooLongError(bytes.length, byteCapacity(QR_MAX_VERSION, ecc))
  const codewords = addEccAndInterleave(dataStream(bytes, ver, ecc), ver, ecc)
  const size = ver * 4 + 17
  const g = new Grid(size)
  drawFunctionPatterns(g, ver)
  drawCodewords(g, codewords)

  let mask = opts.mask ?? -1
  if (mask < 0 || mask > 7) {
    let best = Infinity
    for (let m = 0; m < 8; m++) {
      applyMask(g, m)
      drawFormat(g, ecc, m)
      const p = penaltyScore(g.modules)
      if (p < best) {
        best = p
        mask = m
      }
      applyMask(g, m) // XOR again: undone
    }
  }
  applyMask(g, mask)
  drawFormat(g, ecc, mask)
  return { version: ver, size, ecc, mask, modules: g.modules }
}

/** Encode a string as UTF-8 bytes. */
export function encodeQrText(text: string, opts: QrOptions = {}): QrCode {
  return encodeQrBytes(new TextEncoder().encode(text), opts)
}

/**
 * The code at the most robust level that still fits: M when it can, L when
 * only L can hold it, null when nothing can. A projector at the back of a room
 * wants M's margin; a long link wants L's room.
 */
export function encodeQrBest(text: string): QrCode | null {
  const bytes = new TextEncoder().encode(text)
  for (const ecc of ['M', 'L'] as const) {
    if (versionFor(bytes.length, ecc) !== null) return encodeQrBytes(bytes, { ecc })
  }
  return null
}

/**
 * One SVG path covering every dark module, in module units, offset by a quiet
 * zone of `quiet` modules. Runs along a row merge into one rectangle.
 */
export function qrSvgPath(code: QrCode, quiet = 4): string {
  let d = ''
  for (let y = 0; y < code.size; y++) {
    let x = 0
    while (x < code.size) {
      if (!code.modules[y][x]) {
        x++
        continue
      }
      const start = x
      while (x < code.size && code.modules[y][x]) x++
      d += `M${start + quiet} ${y + quiet}h${x - start}v1h${start - x}z`
    }
  }
  return d
}

// ============================================================================
// src/render/vectorCtx.ts — a RECORDING CanvasRenderingContext2D.
//
// The board has exactly one renderer (src/ui/renderBoard.ts) and it speaks the
// Canvas 2D API. A vector export must not grow a second renderer beside it —
// that is the drift renderBoard.ts was written to end — so instead the SAME
// renderer is pointed at this object, which implements the subset of the 2D
// context the draw modules use and writes down what they asked for:
//
//   paths    in device coordinates (the transform in force at each call is
//            applied as the call is made, exactly as a canvas does), with the
//            fill / stroke paint, width, dash, cap, join and alpha in force at
//            the fill() / stroke();
//   text     with its font, size, weight, style, alignment, colour, and the
//            ALPHABETIC baseline already resolved from textBaseline;
//   clips    as a tree: every item names the innermost clip it was drawn in.
//
// ARCS STAY ARCS. arc() and arcTo() are recorded as circular-arc segments
// (centre, radius, start angle, signed sweep) whenever the transform is a
// uniform scale plus translation — which is every transform the renderer and
// the export composition use — so the SVG writes an `A`, TikZ an `arc[...]`,
// and the PDF its standard ≤ 90° Bézier split. Only under a non-uniform
// transform is an arc flattened to cubic Béziers here (never to a polyline).
//
// PATH2D ROUTING. src/render/curves.ts builds each curve on a Path2D and hands
// it to ctx.stroke(path). The recorder cannot read a native Path2D back, so
// curves.ts asks for its path through `newPath2D(ctx)` below: a context that
// offers `createVectorPath()` (this one) gets a recording VectorPath2D, and
// every real canvas — the screen, the PNG export, the tests' MockCtx under
// withMockPath2D — has no such method and gets `new Path2D()` exactly as
// before. A duck-typed factory rather than swapping globalThis.Path2D: nothing
// global changes during a recording, so it is safe with anything else running.
//
// measureText must be plausible because the renderer lays labels out with it
// (tick thinning, chip widths, placement). In the browser it is a real
// canvas's measureText with the same font; in node (tests) it is an estimate
// from Helvetica's metrics.
// ============================================================================

import { textWidthEstimate } from './fontMetrics'

// ---------------------------------------------------------------------------
// Display list
// ---------------------------------------------------------------------------

/** One segment of a recorded path, in device coordinates (y down). */
export type Seg =
  | { k: 'M'; x: number; y: number }
  | { k: 'L'; x: number; y: number }
  | { k: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  /**
   * A circular arc from the current point (which is on the circle at angle
   * a0) sweeping `sweep` radians — positive is the canvas's own direction
   * (clockwise on screen, y down) — to (x, y). |sweep| ≤ 2π.
   */
  | { k: 'A'; cx: number; cy: number; r: number; a0: number; sweep: number; x: number; y: number }
  | { k: 'Z' }

export interface Rgba {
  /** 0–255 */
  r: number
  g: number
  b: number
  /** 0–1, ALREADY multiplied by globalAlpha where it is an item's paint */
  a: number
}

export interface StrokeSpec {
  color: Rgba
  width: number
  cap: 'butt' | 'round' | 'square'
  join: 'miter' | 'round' | 'bevel'
  miter: number
  /** In device units; empty = solid. */
  dash: number[]
  dashOffset: number
}

export interface FontSpec {
  /** The CSS family list the canvas was given ("system-ui, sans-serif"). */
  family: string
  generic: 'sans-serif' | 'serif' | 'monospace'
  /** Device units. */
  size: number
  italic: boolean
  bold: boolean
}

export interface PathItem {
  t: 'path'
  segs: Seg[]
  fill: Rgba | null
  stroke: StrokeSpec | null
  /** Innermost clip in force; 0 = none. */
  clip: number
}

export interface TextItem {
  t: 'text'
  text: string
  /** Anchor point: x at the alignment edge, y on the ALPHABETIC baseline. */
  x: number
  y: number
  anchor: 'start' | 'middle' | 'end'
  font: FontSpec
  color: Rgba
  /** measureText width in device units at record time. */
  width: number
  clip: number
}

export type DisplayItem = PathItem | TextItem

export interface ClipNode {
  id: number
  /** Enclosing clip; 0 = none. */
  parent: number
  segs: Seg[]
}

export interface DisplayList {
  /** Device size of the whole figure (CSS px). */
  width: number
  height: number
  items: DisplayItem[]
  /** clips[id - 1] is clip `id`. */
  clips: ClipNode[]
}

/** The chain of clips, outermost first, that an item with innermost `id` sits in. */
export function clipChain(list: DisplayList, id: number): number[] {
  const out: number[] = []
  let cur = id
  let guard = 0
  while (cur > 0 && guard++ < 1000) {
    out.unshift(cur)
    cur = list.clips[cur - 1]?.parent ?? 0
  }
  return out
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

const NAMED: Record<string, [number, number, number]> = {
  black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0],
  blue: [0, 0, 255], gray: [128, 128, 128], grey: [128, 128, 128], silver: [192, 192, 192],
  yellow: [255, 255, 0], orange: [255, 165, 0], purple: [128, 0, 128], navy: [0, 0, 128],
  teal: [0, 128, 128], maroon: [128, 0, 0], lime: [0, 255, 0], aqua: [0, 255, 255],
  cyan: [0, 255, 255], magenta: [255, 0, 255], fuchsia: [255, 0, 255], olive: [128, 128, 0],
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = (((h % 360) + 360) % 360) / 360
  if (s === 0) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number): number => {
    let u = t
    if (u < 0) u += 1
    if (u > 1) u -= 1
    if (u < 1 / 6) return p + (q - p) * 6 * u
    if (u < 1 / 2) return q
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6
    return p
  }
  return [f(hh + 1 / 3) * 255, f(hh) * 255, f(hh - 1 / 3) * 255]
}

/** Parse a CSS colour. Null for anything this does not understand. */
export function parseColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase()
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  if (s.startsWith('#')) {
    const h = s.slice(1)
    if (!/^[0-9a-f]+$/.test(h)) return null
    if (h.length === 3 || h.length === 4) {
      const v = h.split('').map((c) => parseInt(c + c, 16))
      return { r: v[0], g: v[1], b: v[2], a: h.length === 4 ? v[3] / 255 : 1 }
    }
    if (h.length === 6 || h.length === 8) {
      const v = [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16))
      return { r: v[0], g: v[1], b: v[2], a: h.length === 8 ? v[3] / 255 : 1 }
    }
    return null
  }
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(s)
  if (fn) {
    const parts = fn[2].split(/[\s,/]+/).filter((p) => p !== '')
    if (parts.length < 3) return null
    const num = (p: string, scale: number): number =>
      p.endsWith('%') ? (parseFloat(p) / 100) * scale : parseFloat(p)
    const a = parts.length >= 4 ? num(parts[3], 1) : 1
    let rgb: [number, number, number]
    if (fn[1].startsWith('rgb')) {
      rgb = [num(parts[0], 255), num(parts[1], 255), num(parts[2], 255)]
    } else {
      rgb = hslToRgb(parseFloat(parts[0]), num(parts[1], 1), num(parts[2], 1))
    }
    if (![...rgb, a].every(Number.isFinite)) return null
    const c = (v: number): number => Math.max(0, Math.min(255, v))
    return { r: c(rgb[0]), g: c(rgb[1]), b: c(rgb[2]), a: Math.max(0, Math.min(1, a)) }
  }
  const named = NAMED[s]
  if (named) return { r: named[0], g: named[1], b: named[2], a: 1 }
  return null
}

/** A browser canvas normalises any CSS colour; used only when parseColor gives up. */
let normaliser: CanvasRenderingContext2D | null | undefined
function browserColor(input: string): Rgba | null {
  if (normaliser === undefined) {
    normaliser = null
    try {
      if (typeof document !== 'undefined') normaliser = document.createElement('canvas').getContext('2d')
    } catch {
      normaliser = null
    }
  }
  if (!normaliser) return null
  normaliser.fillStyle = '#000000'
  normaliser.fillStyle = input
  const out = normaliser.fillStyle
  return typeof out === 'string' ? parseColor(out) : null
}

function paintOf(style: unknown): Rgba {
  if (typeof style === 'string') return parseColor(style) ?? browserColor(style) ?? { r: 0, g: 0, b: 0, a: 1 }
  // A gradient / pattern: its first colour stop stands in for it.
  const g = style as { _first?: string } | null
  if (g && typeof g._first === 'string') return paintOf(g._first)
  return { r: 0, g: 0, b: 0, a: 1 }
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

const MONO_RE = /mono|menlo|consolas|courier|monaco/i
const SERIF_RE = /(^|[\s,"'])(serif|times|georgia|cambria|garamond|palatino)/i

/** Parse a CSS font shorthand the way the renderer writes them. */
export function parseFont(css: string, fallback: FontSpec): FontSpec {
  const m = /^\s*((?:[a-z0-9-]+\s+)*?)(\d*\.?\d+)(px|pt|em|rem)(?:\s*\/\s*[^\s]+)?\s+(.+)$/i.exec(css)
  if (!m) return fallback
  const pre = m[1].toLowerCase().split(/\s+/).filter(Boolean)
  let size = parseFloat(m[2])
  const unit = m[3].toLowerCase()
  if (unit === 'pt') size *= 4 / 3
  else if (unit === 'em' || unit === 'rem') size *= 16
  if (!(size > 0)) return fallback
  const family = m[4].trim()
  const italic = pre.includes('italic') || pre.includes('oblique')
  const bold = pre.some((t) => t === 'bold' || t === 'bolder' || (/^\d+$/.test(t) && parseInt(t, 10) >= 600))
  const generic: FontSpec['generic'] = MONO_RE.test(family)
    ? 'monospace'
    : SERIF_RE.test(family) && !/sans-serif/i.test(family.replace(/.*,/, ''))
      ? 'serif'
      : 'sans-serif'
  // "…, serif" as the LAST family is the stack's own answer; "sans-serif" last is sans.
  const last = family.split(',').pop()?.trim().toLowerCase() ?? ''
  const g2: FontSpec['generic'] =
    last === 'monospace' ? 'monospace' : last === 'serif' ? 'serif' : last === 'sans-serif' ? 'sans-serif' : generic
  return { family, generic: g2, size, italic, bold }
}

/**
 * Where the alphabetic baseline sits relative to the y a canvas was given, as
 * a fraction of the font size, for each textBaseline. The em box of the
 * system faces is ~0.8 above and ~0.2 below the baseline, so 'top' is 0.8 em
 * above it and 'middle' (the em box's middle) 0.3 em above.
 */
const BASELINE_SHIFT: Record<string, number> = {
  alphabetic: 0,
  top: 0.8,
  hanging: 0.72,
  middle: 0.3,
  ideographic: -0.2,
  bottom: -0.2,
}

// ---------------------------------------------------------------------------
// Measuring
// ---------------------------------------------------------------------------

let measurer: CanvasRenderingContext2D | null | undefined
function realMeasure(): CanvasRenderingContext2D | null {
  if (measurer !== undefined) return measurer
  measurer = null
  try {
    if (typeof document !== 'undefined') measurer = document.createElement('canvas').getContext('2d')
  } catch {
    measurer = null
  }
  return measurer
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

/** [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f */
type Mat = [number, number, number, number, number, number]

const IDENTITY: Mat = [1, 0, 0, 1, 0, 0]

const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
]

const apply = (m: Mat, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
]

function invert(m: Mat): Mat | null {
  const det = m[0] * m[3] - m[1] * m[2]
  if (!det || !Number.isFinite(det)) return null
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ]
}

/** Uniform scale + translation (no rotation, no reflection): arcs stay arcs. */
function isSimilar(m: Mat): boolean {
  return Math.abs(m[1]) < 1e-12 && Math.abs(m[2]) < 1e-12 && m[0] > 0 && Math.abs(m[0] - m[3]) < 1e-9 * m[0]
}

/** Linear scale a length is multiplied by (for widths, radii, font sizes). */
const scaleOf = (m: Mat): number => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 0

const TWO_PI = Math.PI * 2

/** The canvas spec's sweep for arc(…, a0, a1, ccw), signed (+ = canvas direction). */
export function arcSweep(a0: number, a1: number, ccw: boolean): number {
  if (!ccw) {
    if (a1 - a0 >= TWO_PI) return TWO_PI
    let s = (a1 - a0) % TWO_PI
    if (s < 0) s += TWO_PI
    return s
  }
  if (a0 - a1 >= TWO_PI) return -TWO_PI
  let s = (a0 - a1) % TWO_PI
  if (s < 0) s += TWO_PI
  return -s
}

/**
 * Cubic Béziers for a circular arc, ≤ 90° each, in whatever space the centre
 * is given in. Returns [x1, y1, x2, y2, x, y] per piece.
 */
export function arcToBeziers(
  cx: number,
  cy: number,
  r: number,
  a0: number,
  sweep: number,
): Array<[number, number, number, number, number, number]> {
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9))
  const step = sweep / n
  const k = (4 / 3) * Math.tan(step / 4)
  const out: Array<[number, number, number, number, number, number]> = []
  let a = a0
  for (let i = 0; i < n; i++) {
    const b = a + step
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    const cb = Math.cos(b)
    const sb = Math.sin(b)
    out.push([
      cx + r * (ca - k * sa),
      cy + r * (sa + k * ca),
      cx + r * (cb + k * sb),
      cy + r * (sb - k * cb),
      cx + r * cb,
      cy + r * sb,
    ])
    a = b
  }
  return out
}

// ---------------------------------------------------------------------------
// Path building
// ---------------------------------------------------------------------------

/** Builds device-space segments from canvas path calls under a transform. */
class PathBuilder {
  segs: Seg[] = []
  /** current point (device); null = no subpath */
  private cur: [number, number] | null = null
  private start: [number, number] | null = null

  constructor(private m: () => Mat) {}

  moveTo(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    const p = apply(this.m(), x, y)
    this.segs.push({ k: 'M', x: p[0], y: p[1] })
    this.cur = p
    this.start = p
  }

  private lineDev(p: [number, number]): void {
    if (!this.cur) {
      this.segs.push({ k: 'M', x: p[0], y: p[1] })
      this.start = p
    } else {
      this.segs.push({ k: 'L', x: p[0], y: p[1] })
    }
    this.cur = p
  }

  lineTo(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    this.lineDev(apply(this.m(), x, y))
  }

  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    if (![x1, y1, x2, y2, x, y].every(Number.isFinite)) return
    const m = this.m()
    if (!this.cur) this.moveTo(x1, y1)
    const a = apply(m, x1, y1)
    const b = apply(m, x2, y2)
    const p = apply(m, x, y)
    this.segs.push({ k: 'C', x1: a[0], y1: a[1], x2: b[0], y2: b[1], x: p[0], y: p[1] })
    this.cur = p
  }

  quadraticCurveTo(qx: number, qy: number, x: number, y: number): void {
    if (![qx, qy, x, y].every(Number.isFinite)) return
    const m = this.m()
    if (!this.cur) this.moveTo(qx, qy)
    const p0 = this.cur as [number, number]
    const q = apply(m, qx, qy)
    const p = apply(m, x, y)
    // A quadratic is a cubic with its controls 2/3 of the way to the apex;
    // affine maps preserve that, so it is done in device space.
    this.segs.push({
      k: 'C',
      x1: p0[0] + (2 / 3) * (q[0] - p0[0]),
      y1: p0[1] + (2 / 3) * (q[1] - p0[1]),
      x2: p[0] + (2 / 3) * (q[0] - p[0]),
      y2: p[1] + (2 / 3) * (q[1] - p[1]),
      x: p[0],
      y: p[1],
    })
    this.cur = p
  }

  arc(x: number, y: number, r: number, a0: number, a1: number, ccw = false): void {
    if (![x, y, r, a0, a1].every(Number.isFinite)) return
    if (r < 0) throw new RangeError('negative radius')
    const sweep = arcSweep(a0, a1, ccw)
    const m = this.m()
    const sx = x + r * Math.cos(a0)
    const sy = y + r * Math.sin(a0)
    this.lineDev(apply(m, sx, sy))
    if (sweep === 0 || r === 0) return
    this.arcLocal(x, y, r, a0, sweep)
  }

  /** The arc proper, from its start point (already current). */
  private arcLocal(x: number, y: number, r: number, a0: number, sweep: number): void {
    const m = this.m()
    const ex = x + r * Math.cos(a0 + sweep)
    const ey = y + r * Math.sin(a0 + sweep)
    const end = apply(m, ex, ey)
    if (isSimilar(m)) {
      const c = apply(m, x, y)
      this.segs.push({ k: 'A', cx: c[0], cy: c[1], r: r * m[0], a0, sweep, x: end[0], y: end[1] })
    } else {
      for (const b of arcToBeziers(x, y, r, a0, sweep)) {
        const p1 = apply(m, b[0], b[1])
        const p2 = apply(m, b[2], b[3])
        const p = apply(m, b[4], b[5])
        this.segs.push({ k: 'C', x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], x: p[0], y: p[1] })
      }
    }
    this.cur = end
  }

  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void {
    if (![x1, y1, x2, y2, r].every(Number.isFinite)) return
    if (r < 0) throw new RangeError('negative radius')
    const m = this.m()
    if (!this.cur) {
      this.moveTo(x1, y1)
      return
    }
    const inv = invert(m)
    if (!inv) return
    const [x0, y0] = apply(inv, this.cur[0], this.cur[1])
    const v1x = x0 - x1
    const v1y = y0 - y1
    const v2x = x2 - x1
    const v2y = y2 - y1
    const l1 = Math.hypot(v1x, v1y)
    const l2 = Math.hypot(v2x, v2y)
    const cross = v1x * v2y - v1y * v2x
    if (l1 < 1e-12 || l2 < 1e-12 || r === 0 || Math.abs(cross) < 1e-12 * l1 * l2) {
      this.lineTo(x1, y1)
      return
    }
    const u1x = v1x / l1
    const u1y = v1y / l1
    const u2x = v2x / l2
    const u2y = v2y / l2
    const cos = Math.max(-1, Math.min(1, u1x * u2x + u1y * u2y))
    const theta = Math.acos(cos)
    const d = r / Math.tan(theta / 2)
    const t1x = x1 + u1x * d
    const t1y = y1 + u1y * d
    const t2x = x1 + u2x * d
    const t2y = y1 + u2y * d
    const bx = u1x + u2x
    const by = u1y + u2y
    const bl = Math.hypot(bx, by)
    const h = r / Math.sin(theta / 2)
    const cx = x1 + (bx / bl) * h
    const cy = y1 + (by / bl) * h
    this.lineTo(t1x, t1y)
    const a0 = Math.atan2(t1y - cy, t1x - cx)
    const a1 = Math.atan2(t2y - cy, t2x - cx)
    let sweep = a1 - a0
    while (sweep > Math.PI) sweep -= TWO_PI
    while (sweep < -Math.PI) sweep += TWO_PI
    this.arcLocal(cx, cy, r, a0, sweep)
  }

  rect(x: number, y: number, w: number, h: number): void {
    if (![x, y, w, h].every(Number.isFinite)) return
    this.moveTo(x, y)
    this.lineTo(x + w, y)
    this.lineTo(x + w, y + h)
    this.lineTo(x, y + h)
    this.closePath()
  }

  closePath(): void {
    if (!this.cur) return
    this.segs.push({ k: 'Z' })
    this.cur = this.start
  }
}

// ---------------------------------------------------------------------------
// Path2D
// ---------------------------------------------------------------------------

type PathOp =
  | ['moveTo', number, number]
  | ['lineTo', number, number]
  | ['bezierCurveTo', number, number, number, number, number, number]
  | ['quadraticCurveTo', number, number, number, number]
  | ['arc', number, number, number, number, number, boolean]
  | ['arcTo', number, number, number, number, number]
  | ['rect', number, number, number, number]
  | ['closePath']

/**
 * A Path2D that remembers its calls, in the path's own coordinates. The
 * transform is the one in force when it is stroked or filled — the canvas
 * rule — so it is replayed then.
 */
export class VectorPath2D {
  ops: PathOp[] = []
  moveTo(x: number, y: number): void { this.ops.push(['moveTo', x, y]) }
  lineTo(x: number, y: number): void { this.ops.push(['lineTo', x, y]) }
  bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void {
    this.ops.push(['bezierCurveTo', a, b, c, d, x, y])
  }
  quadraticCurveTo(a: number, b: number, x: number, y: number): void {
    this.ops.push(['quadraticCurveTo', a, b, x, y])
  }
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw = false): void {
    this.ops.push(['arc', x, y, r, a0, a1, ccw])
  }
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void {
    this.ops.push(['arcTo', x1, y1, x2, y2, r])
  }
  rect(x: number, y: number, w: number, h: number): void { this.ops.push(['rect', x, y, w, h]) }
  closePath(): void { this.ops.push(['closePath']) }
  addPath(p: VectorPath2D): void { this.ops.push(...p.ops) }
}

function replay(ops: readonly PathOp[], b: PathBuilder): void {
  for (const op of ops) {
    switch (op[0]) {
      case 'moveTo': b.moveTo(op[1], op[2]); break
      case 'lineTo': b.lineTo(op[1], op[2]); break
      case 'bezierCurveTo': b.bezierCurveTo(op[1], op[2], op[3], op[4], op[5], op[6]); break
      case 'quadraticCurveTo': b.quadraticCurveTo(op[1], op[2], op[3], op[4]); break
      case 'arc': b.arc(op[1], op[2], op[3], op[4], op[5], op[6]); break
      case 'arcTo': b.arcTo(op[1], op[2], op[3], op[4], op[5]); break
      case 'rect': b.rect(op[1], op[2], op[3], op[4]); break
      case 'closePath': b.closePath(); break
    }
  }
}

/**
 * The Path2D a draw module should build on for THIS context: a recording one
 * for a VectorCtx, the native one for every real canvas (see the header).
 */
export function newPath2D(ctx: CanvasRenderingContext2D): Path2D {
  const make = (ctx as unknown as { createVectorPath?: () => unknown }).createVectorPath
  if (typeof make === 'function') return make.call(ctx) as Path2D
  return new Path2D()
}

// ---------------------------------------------------------------------------
// The context
// ---------------------------------------------------------------------------

interface State {
  m: Mat
  fillStyle: unknown
  strokeStyle: unknown
  lineWidth: number
  lineCap: StrokeSpec['cap']
  lineJoin: StrokeSpec['join']
  miterLimit: number
  dash: number[]
  dashOffset: number
  globalAlpha: number
  font: string
  fontSpec: FontSpec
  textAlign: string
  textBaseline: string
  clip: number
}

const DEFAULT_FONT: FontSpec = { family: 'sans-serif', generic: 'sans-serif', size: 10, italic: false, bold: false }

/**
 * The recording context. Pass it to the renderer as a CanvasRenderingContext2D
 * (`ctx as unknown as CanvasRenderingContext2D`), then read `list()`.
 */
export class VectorCtx {
  private st: State
  private stack: State[] = []
  private path: PathBuilder
  /** Bumped whenever the current path changes, so fill-then-stroke can merge. */
  private pathVersion = 0
  private items: DisplayItem[] = []
  private itemPathVersion: number[] = []
  private clips: ClipNode[] = []

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.st = {
      m: [...IDENTITY] as Mat,
      fillStyle: '#000000',
      strokeStyle: '#000000',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      miterLimit: 10,
      dash: [],
      dashOffset: 0,
      globalAlpha: 1,
      font: '10px sans-serif',
      fontSpec: DEFAULT_FONT,
      textAlign: 'start',
      textBaseline: 'alphabetic',
      clip: 0,
    }
    this.path = new PathBuilder(() => this.st.m)
  }

  /** What the renderer asked for, in order. */
  list(): DisplayList {
    return { width: this.width, height: this.height, items: this.items.slice(), clips: this.clips.slice() }
  }

  // ---- Path2D routing ------------------------------------------------------
  createVectorPath(): VectorPath2D {
    return new VectorPath2D()
  }

  // ---- state -----------------------------------------------------------------
  save(): void {
    this.stack.push({ ...this.st, m: [...this.st.m] as Mat, dash: this.st.dash.slice() })
  }
  restore(): void {
    const s = this.stack.pop()
    if (s) this.st = s
  }
  reset(): void {
    this.stack = []
    this.beginPath()
    this.st = { ...this.st, m: [...IDENTITY] as Mat, clip: 0, dash: [], globalAlpha: 1 }
  }

  get fillStyle(): unknown { return this.st.fillStyle }
  set fillStyle(v: unknown) {
    if (typeof v === 'string' && parseColor(v) === null && browserColor(v) === null) return
    this.st.fillStyle = v
  }
  get strokeStyle(): unknown { return this.st.strokeStyle }
  set strokeStyle(v: unknown) {
    if (typeof v === 'string' && parseColor(v) === null && browserColor(v) === null) return
    this.st.strokeStyle = v
  }
  get lineWidth(): number { return this.st.lineWidth }
  set lineWidth(v: number) { if (Number.isFinite(v) && v > 0) this.st.lineWidth = v }
  get lineCap(): string { return this.st.lineCap }
  set lineCap(v: string) { if (v === 'butt' || v === 'round' || v === 'square') this.st.lineCap = v }
  get lineJoin(): string { return this.st.lineJoin }
  set lineJoin(v: string) { if (v === 'miter' || v === 'round' || v === 'bevel') this.st.lineJoin = v }
  get miterLimit(): number { return this.st.miterLimit }
  set miterLimit(v: number) { if (Number.isFinite(v) && v > 0) this.st.miterLimit = v }
  get lineDashOffset(): number { return this.st.dashOffset }
  set lineDashOffset(v: number) { if (Number.isFinite(v)) this.st.dashOffset = v }
  get globalAlpha(): number { return this.st.globalAlpha }
  set globalAlpha(v: number) { if (Number.isFinite(v) && v >= 0 && v <= 1) this.st.globalAlpha = v }
  get font(): string { return this.st.font }
  set font(v: string) {
    const spec = parseFont(v, this.st.fontSpec)
    if (spec === this.st.fontSpec) return
    this.st.font = v
    this.st.fontSpec = spec
  }
  get textAlign(): string { return this.st.textAlign }
  set textAlign(v: string) { this.st.textAlign = v }
  get textBaseline(): string { return this.st.textBaseline }
  set textBaseline(v: string) { this.st.textBaseline = v }
  // Accepted and ignored: nothing in a vector figure can honour them.
  globalCompositeOperation = 'source-over'
  imageSmoothingEnabled = true
  shadowBlur = 0
  shadowColor = 'rgba(0, 0, 0, 0)'
  shadowOffsetX = 0
  shadowOffsetY = 0
  direction = 'ltr'

  setLineDash(d: number[]): void {
    if (!Array.isArray(d) || d.some((v) => !Number.isFinite(v) || v < 0)) return
    this.st.dash = d.length % 2 === 1 ? [...d, ...d] : d.slice()
  }
  getLineDash(): number[] {
    return this.st.dash.slice()
  }

  // ---- transforms ------------------------------------------------------------
  setTransform(a: number | { a: number; b: number; c: number; d: number; e: number; f: number }, b?: number, c?: number, d?: number, e?: number, f?: number): void {
    if (typeof a === 'object' && a !== null) {
      this.st.m = [a.a, a.b, a.c, a.d, a.e, a.f]
      return
    }
    const m: Mat = [a, b ?? 0, c ?? 0, d ?? 1, e ?? 0, f ?? 0]
    if (m.every(Number.isFinite)) this.st.m = m
  }
  resetTransform(): void { this.st.m = [...IDENTITY] as Mat }
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    const n: Mat = [a, b, c, d, e, f]
    if (n.every(Number.isFinite)) this.st.m = mul(this.st.m, n)
  }
  translate(x: number, y: number): void { this.transform(1, 0, 0, 1, x, y) }
  scale(x: number, y: number): void { this.transform(x, 0, 0, y, 0, 0) }
  rotate(t: number): void {
    const c = Math.cos(t)
    const s = Math.sin(t)
    this.transform(c, s, -s, c, 0, 0)
  }
  getTransform(): { a: number; b: number; c: number; d: number; e: number; f: number } {
    const m = this.st.m
    return { a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] }
  }

  // ---- path ------------------------------------------------------------------
  beginPath(): void {
    this.path = new PathBuilder(() => this.st.m)
    this.pathVersion++
  }
  moveTo(x: number, y: number): void { this.pathVersion++; this.path.moveTo(x, y) }
  lineTo(x: number, y: number): void { this.pathVersion++; this.path.lineTo(x, y) }
  bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void {
    this.pathVersion++
    this.path.bezierCurveTo(a, b, c, d, x, y)
  }
  quadraticCurveTo(a: number, b: number, x: number, y: number): void {
    this.pathVersion++
    this.path.quadraticCurveTo(a, b, x, y)
  }
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw = false): void {
    this.pathVersion++
    this.path.arc(x, y, r, a0, a1, ccw)
  }
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void {
    this.pathVersion++
    this.path.arcTo(x1, y1, x2, y2, r)
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.pathVersion++
    this.path.rect(x, y, w, h)
  }
  roundRect(x: number, y: number, w: number, h: number, r: number | number[] = 0): void {
    const rr = Math.max(0, Math.min(Math.abs(w) / 2, Math.abs(h) / 2, Array.isArray(r) ? (r[0] ?? 0) : r))
    this.pathVersion++
    this.path.moveTo(x + rr, y)
    this.path.arcTo(x + w, y, x + w, y + h, rr)
    this.path.arcTo(x + w, y + h, x, y + h, rr)
    this.path.arcTo(x, y + h, x, y, rr)
    this.path.arcTo(x, y, x + w, y, rr)
    this.path.closePath()
  }
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw = false): void {
    // Not used by the renderer; supported through a local transform so it is
    // still exact (Béziers of the unit circle under the ellipse's map).
    this.save()
    this.translate(x, y)
    this.rotate(rot)
    this.scale(rx, ry)
    this.pathVersion++
    this.path.arc(0, 0, 1, a0, a1, ccw)
    this.restore()
  }
  closePath(): void { this.pathVersion++; this.path.closePath() }

  private segsOf(path?: unknown): { segs: Seg[]; version: number } {
    if (path instanceof VectorPath2D) {
      const b = new PathBuilder(() => this.st.m)
      replay(path.ops, b)
      return { segs: b.segs, version: -1 }
    }
    return { segs: this.path.segs.slice(), version: this.pathVersion }
  }

  private strokeSpec(): StrokeSpec {
    const k = scaleOf(this.st.m)
    const c = paintOf(this.st.strokeStyle)
    return {
      color: { ...c, a: c.a * this.st.globalAlpha },
      width: this.st.lineWidth * k,
      cap: this.st.lineCap,
      join: this.st.lineJoin,
      miter: this.st.miterLimit,
      dash: this.st.dash.map((v) => v * k),
      dashOffset: this.st.dashOffset * k,
    }
  }

  private fillPaint(): Rgba {
    const c = paintOf(this.st.fillStyle)
    return { ...c, a: c.a * this.st.globalAlpha }
  }

  private push(item: DisplayItem, version: number): void {
    this.items.push(item)
    this.itemPathVersion.push(version)
  }

  fill(path?: unknown): void {
    const { segs, version } = this.segsOf(path)
    if (segs.length === 0) return
    const fill = this.fillPaint()
    if (fill.a <= 0) return
    this.push({ t: 'path', segs, fill, stroke: null, clip: this.st.clip }, version)
  }

  stroke(path?: unknown): void {
    const { segs, version } = this.segsOf(path)
    if (segs.length === 0) return
    const stroke = this.strokeSpec()
    if (stroke.color.a <= 0 || !(stroke.width > 0)) return
    // fill() then stroke() of the SAME current path is one shape with an
    // outline: merged, it is one <path>, one PDF `B`, one \filldraw.
    const last = this.items[this.items.length - 1]
    const lastVersion = this.itemPathVersion[this.itemPathVersion.length - 1]
    if (
      version >= 0 &&
      last &&
      last.t === 'path' &&
      last.stroke === null &&
      last.fill !== null &&
      lastVersion === version &&
      last.clip === this.st.clip
    ) {
      last.stroke = stroke
      return
    }
    this.push({ t: 'path', segs, fill: null, stroke, clip: this.st.clip }, version)
  }

  clip(path?: unknown): void {
    const { segs } = this.segsOf(path)
    const id = this.clips.length + 1
    this.clips.push({ id, parent: this.st.clip, segs })
    this.st.clip = id
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const b = new PathBuilder(() => this.st.m)
    b.rect(x, y, w, h)
    const fill = this.fillPaint()
    if (fill.a <= 0 || b.segs.length === 0) return
    this.push({ t: 'path', segs: b.segs, fill, stroke: null, clip: this.st.clip }, -1)
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    const b = new PathBuilder(() => this.st.m)
    b.rect(x, y, w, h)
    const stroke = this.strokeSpec()
    if (stroke.color.a <= 0 || b.segs.length === 0) return
    this.push({ t: 'path', segs: b.segs, fill: null, stroke, clip: this.st.clip }, -1)
  }

  clearRect(): void {
    /* a vector figure has no pixels to clear */
  }

  // ---- text ------------------------------------------------------------------
  measureText(text: string): TextMetrics {
    const real = realMeasure()
    const f = this.st.fontSpec
    let width: number
    if (real) {
      real.font = this.st.font
      width = real.measureText(text).width
    } else {
      width = textWidthEstimate(text, f.generic, f.bold) * f.size
    }
    return {
      width,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: width,
      actualBoundingBoxAscent: f.size * 0.72,
      actualBoundingBoxDescent: f.size * 0.2,
      fontBoundingBoxAscent: f.size * 0.8,
      fontBoundingBoxDescent: f.size * 0.2,
      emHeightAscent: f.size * 0.8,
      emHeightDescent: f.size * 0.2,
      alphabeticBaseline: 0,
      hangingBaseline: f.size * 0.72,
      ideographicBaseline: -f.size * 0.2,
    } as TextMetrics
  }

  fillText(text: string, x: number, y: number): void {
    if (typeof text !== 'string' || text === '' || !Number.isFinite(x) || !Number.isFinite(y)) return
    const color = this.fillPaint()
    if (color.a <= 0) return
    const m = this.st.m
    const k = scaleOf(m)
    const f = this.st.fontSpec
    const shift = BASELINE_SHIFT[this.st.textBaseline] ?? 0
    const p = apply(m, x, y + shift * f.size)
    const al = this.st.textAlign
    const anchor: TextItem['anchor'] =
      al === 'center' ? 'middle' : al === 'right' || al === 'end' ? 'end' : 'start'
    this.push(
      {
        t: 'text',
        text,
        x: p[0],
        y: p[1],
        anchor,
        font: { ...f, size: f.size * k },
        color,
        width: this.measureText(text).width * k,
        clip: this.st.clip,
      },
      -1,
    )
  }

  strokeText(text: string, x: number, y: number): void {
    // Outlined text is not part of any figure the renderer draws; drawn filled.
    const prev = this.st.fillStyle
    this.st.fillStyle = this.st.strokeStyle
    this.fillText(text, x, y)
    this.st.fillStyle = prev
  }

  // ---- things a figure never needs ---------------------------------------------
  createLinearGradient(): CanvasGradient {
    const g = {
      _first: undefined as string | undefined,
      addColorStop(_o: number, c: string): void {
        if (g._first === undefined) g._first = c
      },
    }
    return g as unknown as CanvasGradient
  }
  createRadialGradient(): CanvasGradient {
    return this.createLinearGradient()
  }
  isPointInPath(): boolean { return false }
  isPointInStroke(): boolean { return false }
  drawImage(): void { /* no raster content in a board figure */ }
}

/** Run `paint` against a fresh recorder of the given size; return what it drew. */
export function recordDrawing(
  width: number,
  height: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
): DisplayList {
  const rec = new VectorCtx(width, height)
  paint(rec as unknown as CanvasRenderingContext2D)
  return rec.list()
}

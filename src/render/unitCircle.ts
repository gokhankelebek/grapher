// ============================================================================
// src/render/unitCircle.ts — the unit circle, drawn.
//
// One board object carries a whole trig lesson: the circle of radius 1 and
// its axes, the terminal point P(θ) = (cos θ, sin θ), the initial side and the
// terminal ray, the angle arc (a spiral once |θ| passes a full turn, so
// 13π/6 LOOKS like more than π/6), the reference triangle with its legs
// labelled, the reference angle, ASTC, the tangent segment on x = 1, the
// graph unwrapped to the right, and an inverse question's principal range.
//
// FIGURE, not chrome: every stroke here goes through renderBoard, so it
// reaches the PNG / SVG / PDF / TikZ exports, and under a mono figure style
// (SAT, AP) every ink is the axis black — the pieces stay told apart by
// their labels, their dashes and their weights. The grab point on P is the
// App's handle (chrome); the dot drawn here is the figure's.
//
// Nothing is computed here that a card also prints: every exact value and
// every label string arrives already worked out (src/ui/unitCircleLinks.ts),
// so the board and the card cannot disagree. This file only lays them out.
//
// All lengths are CSS px BEFORE `present.stroke` / `present.type`.
// ============================================================================

import type { Theme, Vec2, Viewport } from '../core/types'
import { ppuX, ppuY } from '../core/types'
import type { InvFn, UnwrapFn } from '../core/trig'
import { labelFont, paintScale } from './grid'
import type { PaintScale } from './grid'

const TWO_PI = Math.PI * 2
const HALF_PI = Math.PI / 2

/** What the board draws for one unit circle — every string already exact. */
export interface UnitCircleFigure {
  id: string
  visible: boolean
  center: Vec2
  theta: number
  /** Circle, rays and P. */
  color: string
  /** "(−√3/2, 1/2)" — the chip at P. */
  pointText: string
  /** The legs' labels; null where the leg has no length (θ on an axis). */
  cosText: string | null
  sinText: string | null
  /** "θ = 5π/6", or "θ = θ′ = π/6" in quadrant I. */
  thetaText: string
  /** "θ′ = π/6"; null when it rides on the θ label or θ is on an axis. */
  refText: string | null
  /** tan θ, or null where it is undefined. */
  tanValue: number | null
  /** "tan θ = −√3/3" / "tan θ undefined". */
  tanText: string
  show: { triangle: boolean; ref: boolean; astc: boolean; tan: boolean }
  /**
   * The graph unwrapped to the right, y = cy + f(x) from x = 0. `ghost` draws
   * the whole period faintly behind the trace (off while playing, so the
   * trace is seen to GROW). `pointText` labels the graph point (θ, f(θ)).
   */
  unwrap: { fn: UnwrapFn; ghost: boolean; value: number | null; pointText: string } | null
  /** Inverse mode: the principal range, the answer and the other solution. */
  inv: {
    fn: InvFn
    v: number
    principal: number
    other: number | null
    range: { lo: number; hi: number; loOpen: boolean; hiOpen: boolean }
    /** "sin⁻¹(1/2) = π/6". */
    answerText: string
    /** "5π/6 — not the principal value"; null when not shown. */
    otherText: string | null
  } | null
}

/** One ink per quantity, from the board palette so print mapping knows them. */
export const UC_INK = {
  cos: '#4f9cf9',
  sin: '#f95f62',
  tan: '#f9a825',
  theta: '#c678dd',
  ref: '#38c976',
  range: '#a3e635',
} as const

export interface UnitCirclePaintOpts {
  vp: Viewport
  theme: Theme
  /** Screen → print colour mapping, or everything → black under mono. */
  paint?: (c: string) => string
  /** True under a mono figure style: fills become a grey wash, ghosts dashed. */
  mono?: boolean
  scale?: PaintScale | null
  font?: 'sans' | 'serif' | null
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

interface Pt {
  x: number
  y: number
}

interface Frame {
  ppx: number
  ppy: number
  cx: number
  cy: number
  hw: number
  hh: number
}

const toPx = (fr: Frame, p: Vec2): Pt => ({
  x: fr.hw + (p.x - fr.cx) * fr.ppx,
  y: fr.hh - (p.y - fr.cy) * fr.ppy,
})

interface St {
  stroke: number
  type: number
  ink: (c: string) => string
  mono: boolean
  theme: Theme
  font: string
  bold: string
  small: string
  dark: boolean
}

function isDarkGround(theme: Theme): boolean {
  const m = /^#([0-9a-fA-F]{6})$/.exec(theme.bg.trim())
  if (!m) return true
  const v = parseInt(m[1], 16)
  return 0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255) < 128
}

/** Keep a far-off coordinate from reaching the canvas as 1e16. */
const clampPx = (v: number, lim: number): number => Math.max(-lim, Math.min(lim, v))

function line(
  ctx: CanvasRenderingContext2D,
  a: Pt,
  b: Pt,
  color: string,
  width: number,
  dash: readonly number[] | null = null,
): void {
  if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.setLineDash(dash ? [...dash] : [])
  ctx.stroke()
  ctx.setLineDash([])
}

function polyline(
  ctx: CanvasRenderingContext2D,
  pts: readonly (Pt | null)[],
  color: string,
  width: number,
  dash: readonly number[] | null = null,
): void {
  ctx.beginPath()
  let pen = false
  for (const p of pts) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      pen = false
      continue
    }
    if (pen) ctx.lineTo(p.x, p.y)
    else ctx.moveTo(p.x, p.y)
    pen = true
  }
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.setLineDash(dash ? [...dash] : [])
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.stroke()
  ctx.setLineDash([])
}

function disc(ctx: CanvasRenderingContext2D, p: Pt, r: number, fill: string, ring: string, ringW: number): void {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return
  ctx.beginPath()
  ctx.arc(p.x, p.y, r, 0, TWO_PI)
  ctx.fillStyle = fill
  ctx.fill()
  if (ringW > 0) {
    ctx.lineWidth = ringW
    ctx.strokeStyle = ring
    ctx.stroke()
  }
}

/** A hollow dot: "this end is not included" / "not the principal value". */
function ring(ctx: CanvasRenderingContext2D, p: Pt, r: number, color: string, bg: string, w: number): void {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return
  ctx.beginPath()
  ctx.arc(p.x, p.y, r, 0, TWO_PI)
  ctx.fillStyle = bg
  ctx.fill()
  ctx.lineWidth = w
  ctx.strokeStyle = color
  ctx.stroke()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

const CHIP_H = 18
const CHIP_PAD = 5
const CHIP_GAP = 6

/**
 * A label on a ground plate, stepped off (px, py) along `dir` far enough that
 * the whole plate clears a glyph of radius `r`. Text in the quantity's own
 * ink, so "1/2" beside the red leg reads as that leg's length.
 */
interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface Queued {
  p: Pt
  dir: Pt
  r: number
  text: string
  color: string
  alpha: number
  /** Lower goes down first and keeps its place; later chips step around it. */
  prio: number
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

function placeChip(
  ctx: CanvasRenderingContext2D,
  q: Queued,
  st: St,
  placed: Rect[],
): void {
  const { p, dir, r, text, color, alpha } = q
  if (!text || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return
  ctx.font = st.font
  const w = ctx.measureText(text).width + 2 * CHIP_PAD * st.type
  const h = CHIP_H * st.type
  const len = Math.hypot(dir.x, dir.y) || 1
  const d = { x: dir.x / len, y: dir.y / len }
  const clearance = Math.abs(d.x) * (w / 2) + Math.abs(d.y) * (h / 2)
  const base = r + clearance + CHIP_GAP * st.type
  // Step outward along its own direction until it clears every chip already
  // down; then, failing that, sideways. A label on a label reads as neither.
  let x = 0
  let y = 0
  let found = false
  const side = { x: -d.y, y: d.x }
  const tries: [number, number][] = []
  for (let k = 0; k <= 8; k++) tries.push([k * 7 * st.type, 0])
  for (let k = 1; k <= 4; k++) tries.push([0, k * (h + 2)], [0, -k * (h + 2)])
  for (const [out, lat] of tries) {
    const cx = p.x + d.x * (base + out) + side.x * lat
    const cy = p.y + d.y * (base + out) + side.y * lat
    x = cx - w / 2
    y = cy - h / 2
    const rect = { x: x - 2, y: y - 2, w: w + 4, h: h + 4 }
    if (!placed.some((b) => overlaps(rect, b))) {
      found = true
      placed.push(rect)
      break
    }
  }
  if (!found) {
    x = p.x + d.x * base - w / 2
    y = p.y + d.y * base - h / 2
    placed.push({ x, y, w, h })
  }
  ctx.globalAlpha = alpha
  roundRect(ctx, x, y, w, h, 4 * st.type)
  ctx.fillStyle = st.theme.bg
  ctx.fill()
  ctx.lineWidth = 1 * st.stroke
  ctx.strokeStyle = st.mono ? st.theme.axis : st.theme.gridMajor
  ctx.stroke()
  ctx.fillStyle = color
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + CHIP_PAD * st.type, y + h / 2)
  ctx.globalAlpha = 1
}

/** The screen direction of math angle `a` — honest on a stretched board. */
function dirOf(fr: Frame, a: number): Pt {
  const x = Math.cos(a) * fr.ppx
  const y = -Math.sin(a) * fr.ppy
  const l = Math.hypot(x, y) || 1
  return { x: x / l, y: y / l }
}

/**
 * An angle arc about C in screen px, from math angle a0 to a1 (either way
 * round, any number of turns). `grow` px are added per full turn: a spiral.
 */
function arcPts(fr: Frame, c: Pt, rPx: number, a0: number, a1: number, grow = 0): Pt[] {
  const span = a1 - a0
  const n = Math.max(8, Math.min(1200, Math.ceil((Math.abs(span) / TWO_PI) * 144)))
  const out: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const t = a0 + (span * i) / n
    const r = rPx + (grow * Math.abs(t - a0)) / TWO_PI
    const d = dirOf(fr, t)
    out.push({ x: c.x + d.x * r, y: c.y + d.y * r })
  }
  return out
}

/** A small filled arrowhead at `tip`, pointing along `dir`. */
function arrowHead(ctx: CanvasRenderingContext2D, tip: Pt, dir: Pt, len: number, color: string): void {
  const l = Math.hypot(dir.x, dir.y)
  if (!(l > 0)) return
  const ux = dir.x / l
  const uy = dir.y / l
  const half = 0.42
  const bx = tip.x - ux * len
  const by = tip.y - uy * len
  ctx.beginPath()
  ctx.moveTo(tip.x, tip.y)
  ctx.lineTo(bx - uy * len * half, by + ux * len * half)
  ctx.lineTo(bx + uy * len * half, by - ux * len * half)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
}

// ---------------------------------------------------------------------------
// The unwrapped graph
// ---------------------------------------------------------------------------

function fnValue(fn: UnwrapFn, x: number): number {
  if (fn === 'sin') return Math.sin(x)
  if (fn === 'cos') return Math.cos(x)
  const c = Math.cos(x)
  return Math.abs(c) < 1e-12 ? NaN : Math.sin(x) / c
}

/**
 * y = cy + f(x) for x in [a, b], as screen points, broken at tan's
 * asymptotes and clamped so a near-vertical branch stays a sane path.
 */
function graphPts(fr: Frame, fn: UnwrapFn, cy: number, a: number, b: number): (Pt | null)[] {
  if (!(b > a)) return []
  const n = Math.max(16, Math.min(4000, Math.ceil(((b - a) * fr.ppx) / 1.5)))
  const lim = 4 * (fr.hh + fr.hw)
  const out: (Pt | null)[] = []
  let branch: number | null = null
  for (let i = 0; i <= n; i++) {
    const x = a + ((b - a) * i) / n
    if (fn === 'tan') {
      // Which branch of tan this sample is on: a new one starts past π/2 + kπ.
      const k = Math.floor((x - HALF_PI) / Math.PI)
      if (branch !== null && k !== branch) out.push(null)
      branch = k
    }
    const y = cy + fnValue(fn, x)
    if (!Number.isFinite(y)) {
      out.push(null)
      continue
    }
    const p = toPx(fr, { x, y })
    out.push({ x: p.x, y: clampPx(p.y, lim) })
  }
  return out
}

// ---------------------------------------------------------------------------
// One circle
// ---------------------------------------------------------------------------

function drawOne(ctx: CanvasRenderingContext2D, f: UnitCircleFigure, fr: Frame, st: St): void {
  const { stroke, type } = st
  const C = toPx(fr, f.center)
  const R = fr.ppx // radius 1, in px along x
  const theta = f.theta
  const cosT = Math.cos(theta)
  const sinT = Math.sin(theta)
  const P = toPx(fr, { x: f.center.x + cosT, y: f.center.y + sinT })
  const circleInk = st.ink(f.color)
  const cosInk = st.ink(UC_INK.cos)
  const sinInk = st.ink(UC_INK.sin)
  const tanInk = st.ink(UC_INK.tan)
  const thetaInk = st.ink(UC_INK.theta)
  const refInk = st.ink(UC_INK.ref)
  const rangeInk = st.ink(UC_INK.range)
  const grey = st.theme.label
  const lim = 4 * (fr.hh + fr.hw)
  const at = (x: number, y: number): Pt => toPx(fr, { x: f.center.x + x, y: f.center.y + y })
  // Every label waits until the strokes are down, then goes on top of them
  // in priority order, stepping around the ones already placed.
  const queue: Queued[] = []
  const chip = (
    _ctx: CanvasRenderingContext2D,
    p: Pt,
    dir: Pt,
    r: number,
    text: string,
    color: string,
    _st: St,
    alpha = 1,
    prio = 5,
  ): void => {
    queue.push({ p, dir, r, text, color, alpha, prio })
  }
  /** An arc OF the unit circle itself, in math coordinates (an ellipse when stretched). */
  const onCircle = (a0: number, a1: number): Pt[] => {
    const n = Math.max(8, Math.min(720, Math.ceil((Math.abs(a1 - a0) / TWO_PI) * 180)))
    const out: Pt[] = []
    for (let i = 0; i <= n; i++) {
      const t = a0 + ((a1 - a0) * i) / n
      out.push(at(Math.cos(t), Math.sin(t)))
    }
    return out
  }

  // --- inverse: the principal range, under everything it describes
  if (f.inv) {
    const { lo, hi, loOpen, hiOpen } = f.inv.range
    ctx.globalAlpha = st.mono ? 0.28 : 0.4
    polyline(ctx, onCircle(lo, hi), rangeInk, 10 * stroke)
    ctx.globalAlpha = 1
  }

  // --- the unwrapped graph's ghost: the whole period, faintly
  const u = f.unwrap
  if (u && u.ghost) {
    const a = Math.min(0, theta)
    const b = Math.max(TWO_PI, theta)
    const ink = u.fn === 'sin' ? sinInk : u.fn === 'cos' ? cosInk : tanInk
    ctx.globalAlpha = st.mono ? 0.6 : 0.35
    polyline(ctx, graphPts(fr, u.fn, f.center.y, a, b), ink, 2 * stroke, st.mono ? [5 * stroke, 5 * stroke] : null)
    ctx.globalAlpha = 1
    if (u.fn === 'tan') {
      // The asymptotes x = π/2 + kπ across the ghost, dashed and quiet.
      ctx.globalAlpha = 0.45
      for (let k = Math.ceil((a - HALF_PI) / Math.PI); HALF_PI + k * Math.PI <= b; k++) {
        const x = HALF_PI + k * Math.PI
        const top = toPx(fr, { x, y: f.center.y + 3 })
        const bot = toPx(fr, { x, y: f.center.y - 3 })
        line(ctx, top, bot, grey, 1 * stroke, [4 * stroke, 4 * stroke])
      }
      ctx.globalAlpha = 1
    }
  }

  // --- the circle's own axes, then the circle
  ctx.globalAlpha = 0.9
  line(ctx, at(-1.25, 0), at(1.25, 0), st.theme.axis, 1 * stroke)
  line(ctx, at(0, -1.25), at(0, 1.25), st.theme.axis, 1 * stroke)
  ctx.globalAlpha = 1
  if (fr.ppx === fr.ppy) {
    ctx.beginPath()
    ctx.arc(C.x, C.y, R, 0, TWO_PI)
    ctx.strokeStyle = circleInk
    ctx.lineWidth = 2 * stroke
    ctx.setLineDash([])
    ctx.stroke()
  } else {
    // A stretched board: the circle is an ellipse on screen, and says so.
    polyline(ctx, onCircle(0, TWO_PI), circleInk, 2 * stroke)
  }
  // Where the circle meets its axes: (±1, 0), (0, ±1), as small ticks.
  for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    disc(ctx, at(x, y), 2.5 * stroke, circleInk, st.theme.bg, 0)
  }

  // --- ASTC, outside the circle on the diagonals
  if (f.show.astc) {
    const letters: [number, string, string][] = [
      [Math.PI / 4, 'A', 'all +'],
      [(3 * Math.PI) / 4, 'S', 'sin +'],
      [(5 * Math.PI) / 4, 'T', 'tan +'],
      [(7 * Math.PI) / 4, 'C', 'cos +'],
    ]
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const [a, letter, note] of letters) {
      const p = at(1.32 * Math.cos(a), 1.32 * Math.sin(a))
      ctx.font = st.bold
      ctx.fillStyle = circleInk
      ctx.fillText(letter, p.x, p.y - 6 * type)
      ctx.font = st.small
      ctx.fillStyle = grey
      ctx.fillText(note, p.x, p.y + 9 * type)
    }
  }

  // --- the unwrapped arc: the length θ, on the circle, in θ's ink
  if (u) {
    const turns = Math.min(Math.abs(theta), TWO_PI) * Math.sign(theta)
    polyline(ctx, onCircle(0, turns), thetaInk, 4.5 * stroke)
  }

  // --- the initial side and the terminal ray
  line(ctx, C, at(1, 0), circleInk, 2.5 * stroke)
  line(ctx, C, P, circleInk, 2.5 * stroke)

  // --- the angle arc: a spiral once it has gone round
  const rTheta = Math.max(16 * stroke, 0.2 * R)
  const grow = Math.max(6 * stroke, 0.07 * R)
  const spiral = Math.abs(theta) > TWO_PI + 1e-9
  if (Math.abs(theta) > 1e-9) {
    const pts = arcPts(fr, C, rTheta, 0, theta, spiral ? grow : 0)
    polyline(ctx, pts, thetaInk, 2 * stroke)
    const tip = pts[pts.length - 1]
    const prev = pts[Math.max(0, pts.length - 4)]
    arrowHead(ctx, tip, { x: tip.x - prev.x, y: tip.y - prev.y }, 8 * stroke, thetaInk)
    const labelAngle = spiral ? theta - Math.sign(theta) * Math.PI : theta / 2
    const labelR = rTheta + (spiral ? grow * (Math.abs(theta) / TWO_PI) : 0)
    const d = dirOf(fr, labelAngle)
    chip(ctx, { x: C.x + d.x * labelR, y: C.y + d.y * labelR }, d, 2 * stroke, f.thetaText, thetaInk, st, 1, 4)
  } else {
    chip(ctx, at(0, 0), { x: -1, y: 1 }, 2 * stroke, f.thetaText, thetaInk, st, 1, 4)
  }

  // --- the reference angle, between the terminal side and the x-axis
  if (f.show.ref && f.refText) {
    const t = ((theta % TWO_PI) + TWO_PI) % TWO_PI
    const base = t > HALF_PI && t < 3 * HALF_PI ? Math.PI : t >= 3 * HALF_PI ? TWO_PI : 0
    const rRef = Math.max(30 * stroke, 0.38 * R)
    const pts = arcPts(fr, C, rRef, t, base)
    polyline(ctx, pts, refInk, 2 * stroke, [5 * stroke, 3 * stroke])
    const mid = (t + base) / 2
    const d = dirOf(fr, mid)
    chip(ctx, { x: C.x + d.x * rRef, y: C.y + d.y * rRef }, d, 2 * stroke, f.refText, refInk, st, 1, 7)
  }

  // --- the reference triangle: cos θ along, sin θ up
  const foot = at(cosT, 0)
  if (f.show.triangle) {
    if (f.cosText !== null) line(ctx, C, foot, cosInk, 3.5 * stroke)
    if (f.sinText !== null) line(ctx, foot, P, sinInk, 3.5 * stroke)
    if (f.cosText !== null && f.sinText !== null) {
      // The right angle at the foot, drawn toward the centre and toward P.
      const s = Math.min(10 * stroke, Math.abs(foot.x - C.x) / 2, Math.abs(P.y - foot.y) / 2)
      const sx = Math.sign(C.x - foot.x) * s
      const sy = Math.sign(P.y - foot.y) * s
      ctx.beginPath()
      ctx.moveTo(foot.x + sx, foot.y)
      ctx.lineTo(foot.x + sx, foot.y + sy)
      ctx.lineTo(foot.x, foot.y + sy)
      ctx.strokeStyle = grey
      ctx.lineWidth = 1 * stroke
      ctx.setLineDash([])
      ctx.stroke()
    }
    if (f.cosText !== null) {
      const mid = { x: (C.x + foot.x) / 2, y: C.y }
      // Across the leg from P, so the label never sits inside the triangle.
      chip(ctx, mid, { x: 0, y: sinT >= 0 ? 1 : -1 }, 2 * stroke, f.cosText, cosInk, st, 1, 3)
    }
    if (f.sinText !== null) {
      const mid = { x: foot.x, y: (foot.y + P.y) / 2 }
      chip(ctx, mid, { x: cosT >= 0 ? 1 : -1, y: 0 }, 2 * stroke, f.sinText, sinInk, st, 1, 3)
    }
  }

  // --- tan θ on the tangent line x = 1
  if (f.show.tan) {
    const x1Top = at(1, 2.2)
    const x1Bot = at(1, -2.2)
    ctx.globalAlpha = 0.7
    line(ctx, x1Top, x1Bot, grey, 1 * stroke, [4 * stroke, 4 * stroke])
    ctx.globalAlpha = 1
    if (f.tanValue !== null) {
      const T = at(1, f.tanValue)
      const Tc = { x: T.x, y: clampPx(T.y, lim) }
      // The terminal side, extended (backwards through the centre in II and
      // III) until it meets x = 1 — the tangent's whole geometric meaning.
      line(ctx, cosT >= 0 ? P : C, Tc, circleInk, 1.5 * stroke, [6 * stroke, 4 * stroke])
      line(ctx, at(1, 0), Tc, tanInk, 3.5 * stroke)
      disc(ctx, Tc, 4 * stroke, tanInk, st.theme.bg, 1.5 * stroke)
      chip(ctx, Tc, { x: 1, y: 0 }, 4 * stroke, f.tanText, tanInk, st, 1, 6)
    } else {
      chip(ctx, at(1, 0.35), { x: 1, y: 0 }, 2 * stroke, f.tanText, tanInk, st, 1, 6)
    }
  }

  // --- the unwrap: the trace, the arc length on the axis, the connector
  if (u) {
    const ink = u.fn === 'sin' ? sinInk : u.fn === 'cos' ? cosInk : tanInk
    const a = Math.min(0, theta)
    const b = Math.max(0, theta)
    // The arc length θ, laid along the x-axis from 0.
    line(ctx, toPx(fr, { x: 0, y: f.center.y }), toPx(fr, { x: theta, y: f.center.y }), thetaInk, 4.5 * stroke)
    const endTick = toPx(fr, { x: theta, y: f.center.y })
    line(ctx, { x: endTick.x, y: endTick.y - 6 * stroke }, { x: endTick.x, y: endTick.y + 6 * stroke }, thetaInk, 2 * stroke)
    polyline(ctx, graphPts(fr, u.fn, f.center.y, a, b), ink, 3 * stroke)
    if (u.value !== null) {
      const G = toPx(fr, { x: theta, y: f.center.y + u.value })
      const Gc = { x: G.x, y: clampPx(G.y, lim) }
      // Where the value comes FROM on the circle: P for sin, (1, tan θ) for
      // tan, and for cos the leg cos θ turned up onto the vertical axis.
      let from: Pt
      if (u.fn === 'sin') from = P
      else if (u.fn === 'tan') from = { x: at(1, 0).x, y: Gc.y }
      else {
        from = at(0, cosT)
        line(ctx, C, from, cosInk, 3.5 * stroke)
      }
      line(ctx, from, Gc, grey, 1.5 * stroke, [6 * stroke, 5 * stroke])
      disc(ctx, Gc, 5 * stroke, ink, st.theme.bg, 1.5 * stroke)
      chip(ctx, Gc, { x: 0.6, y: u.value >= 0 ? -1 : 1 }, 5 * stroke, u.pointText, ink, st, 1, 5)
    }
  }

  // --- inverse: the guide, the other solution (grey), the principal answer
  if (f.inv) {
    const { fn, v, principal, other } = f.inv
    let end: Pt
    if (fn === 'sin') {
      line(ctx, at(-1.3, v), at(1.3, v), rangeInk, 1.5 * stroke, [6 * stroke, 4 * stroke])
      end = at(1.3, v)
    } else if (fn === 'cos') {
      line(ctx, at(v, -1.3), at(v, 1.3), rangeInk, 1.5 * stroke, [6 * stroke, 4 * stroke])
      end = at(v, 1.3)
    } else {
      line(ctx, at(1, 2.2), at(1, -2.2), grey, 1 * stroke, [4 * stroke, 4 * stroke])
      line(ctx, at(-1, -v), at(1, v), rangeInk, 1.5 * stroke, [6 * stroke, 4 * stroke])
      end = at(1, v)
      disc(ctx, { x: end.x, y: clampPx(end.y, lim) }, 3.5 * stroke, rangeInk, st.theme.bg, 1 * stroke)
    }
    const { lo, hi, loOpen, hiOpen } = f.inv.range
    const ends: [number, boolean][] = [
      [lo, loOpen],
      [hi, hiOpen],
    ]
    for (const [a, open] of ends) {
      const p = at(Math.cos(a), Math.sin(a))
      if (open) ring(ctx, p, 5 * stroke, rangeInk, st.theme.bg, 2 * stroke)
      else disc(ctx, p, 5 * stroke, rangeInk, st.theme.bg, 1.5 * stroke)
    }
    if (other !== null && f.inv.otherText) {
      const o = at(Math.cos(other), Math.sin(other))
      ctx.globalAlpha = 0.75
      line(ctx, C, o, grey, 1.5 * stroke, [3 * stroke, 4 * stroke])
      ctx.globalAlpha = 1
      ring(ctx, o, 5.5 * stroke, grey, st.theme.bg, 2 * stroke)
      chip(ctx, o, dirOf(fr, other), 6 * stroke, f.inv.otherText, grey, st, 0.85, 8)
    }
    const Q = at(Math.cos(principal), Math.sin(principal))
    disc(ctx, Q, 6 * stroke, rangeInk, st.theme.bg, 2 * stroke)
    chip(ctx, { x: end.x, y: clampPx(end.y, lim) }, fn === 'cos' ? { x: 0, y: -1 } : { x: 1, y: 0 }, 4 * stroke, f.inv.answerText, rangeInk, st, 1, 2)
  }

  // --- P itself, on top of every stroke that meets it
  disc(ctx, P, 5.5 * stroke, circleInk, st.theme.bg, 2 * stroke)
  chip(ctx, P, dirOf(fr, theta), 7 * stroke, f.pointText, circleInk, st, 1, 1)

  // The glyphs the chips must not cover: P, and the centre.
  const placed: Rect[] = [
    { x: P.x - 8 * stroke, y: P.y - 8 * stroke, w: 16 * stroke, h: 16 * stroke },
  ]
  queue.sort((a, b) => a.prio - b.prio)
  for (const q of queue) placeChip(ctx, q, st, placed)
}

/**
 * Paint every visible unit circle. Called after the shapes and before the
 * curve names and the analysis layer. One circle failing never takes the
 * figure down.
 */
export function drawUnitCircles(
  ctx: CanvasRenderingContext2D,
  figs: readonly UnitCircleFigure[],
  o: UnitCirclePaintOpts,
): void {
  if (figs.length === 0) return
  const vp = o.vp
  if (vp.widthPx <= 0 || vp.heightPx <= 0 || !(vp.pxPerUnit > 0)) return
  const fr: Frame = {
    ppx: ppuX(vp),
    ppy: ppuY(vp),
    cx: vp.center.x,
    cy: vp.center.y,
    hw: vp.widthPx / 2,
    hh: vp.heightPx / 2,
  }
  const { type, stroke } = paintScale(o.scale)
  const face = { font: o.font ?? 'sans' } as const
  const st: St = {
    stroke,
    type,
    ink: o.paint ?? ((c: string) => c),
    mono: o.mono === true,
    theme: o.theme,
    font: labelFont(face, 13 * type),
    bold: `bold ${labelFont(face, 17 * type)}`,
    small: labelFont(face, 10.5 * type),
    dark: isDarkGround(o.theme),
  }
  for (const f of figs) {
    if (!f || !f.visible) continue
    if (![f.center.x, f.center.y, f.theta].every(Number.isFinite)) continue
    ctx.save()
    try {
      drawOne(ctx, f, fr, st)
    } catch {
      /* one circle failing must not cost the figure */
    }
    ctx.globalAlpha = 1
    ctx.setLineDash([])
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.restore()
  }
}

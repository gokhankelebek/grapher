// ============================================================================
// src/render/numberline.ts — the number line: solution sets, domains, intervals.
//
// This is the figure Algebra 1/2 draws more than any other, and the whole
// pedagogical content of it is ONE distinction: a filled dot includes the
// endpoint, a hollow one excludes it. Everything here exists to make that
// distinction survive — at a glance, at any zoom, on a dark screen, on white
// paper, and through a photocopier.
//
// The hollow dot is therefore never "the bar with a gap left in it": its centre
// is FILLED with the ground colour at full opacity before the ring is stroked.
// Transparency would let the interval bar run straight through the middle, and
// a hollow dot with a coloured centre is exactly a filled dot to a student
// skimming a worksheet — the one misreading this figure exists to prevent.
//
// All drawing units are CSS pixels; the caller sets the DPR/scale transform.
// ============================================================================

import type { NLItem, Theme, Viewport } from '../core/types'
import type { PaintScale } from './grid'
import { formatTick, paintScale, pickTickStep } from './grid'

const TWO_PI = Math.PI * 2

/**
 * Tick ladder target.
 *
 * A number line has no vertical labels competing for room, so it can run
 * denser than the cartesian grid -- but not as dense as it used to. At 44px a
 * projected line labelled every integer is a picket fence, and the reviewer
 * measured exactly that. 56px keeps "every unit" at a normal zoom (60 px/unit)
 * and thins the labels to every 2 / 5 / 10 as soon as the board zooms out,
 * which is the whole job of the 1-2-5 ladder.
 *
 * It scales with the presentation TYPE scale: bigger labels need more room
 * between them, so a projected board thins out one rung earlier.
 */
export const NL_TICK_MIN_PX = 56

/** The label ladder this board is using, at this zoom and this type scale. */
export function nlTickStep(vp: Viewport, typeScale = 1): ReturnType<typeof pickTickStep> {
  return pickTickStep(vp.pxPerUnit, NL_TICK_MIN_PX * typeScale)
}

/** Bar thickness when an item states none. */
export const NL_BAR_WIDTH = 6
export const NL_MIN_BAR_WIDTH = 2
export const NL_MAX_BAR_WIDTH = 14

/** Endpoint dot radius, in px, for a bar of the given thickness. */
export function nlDotRadius(barWidth: number): number {
  return Math.max(4.5, barWidth * 0.95 + 1.2)
}

/** Vertical distance between stacked lanes. */
export const NL_LANE_H = 22

/** Grab radius for endpoints / bars, screen px. */
export const NL_HIT_RADIUS = 11

const AXIS_ARROW_LEN = 9
const AXIS_ARROW_HALF = 4
const BAR_ARROW_LEN = 11
const TICK_MAJOR = 7
const TICK_MINOR = 3.5
/** Base type sizes; both multiply by the presentation `type` scale. */
const TICK_LABEL_PX = 11
const ITEM_LABEL_PX = 12
const nlFont = (px: number): string =>
  `${px}px system-ui, -apple-system, "Segoe UI", sans-serif`
const DARK_TEXT = '#e6eaf5'

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * Screen y of the line itself. A number-line board pans in x only, so the line
 * sits at the middle of the canvas by construction rather than wherever the
 * (unused) vertical centre happens to be — a stale y can never push the figure
 * off its own board.
 */
export function numberLineAxisY(vp: Viewport): number {
  return Math.round(vp.heightPx / 2)
}

/** Math x -> screen x. */
export function nlToScreenX(x: number, vp: Viewport): number {
  return vp.widthPx / 2 + (x - vp.center.x) * vp.pxPerUnit
}

/** Screen x -> math x. */
export function nlToMathX(px: number, vp: Viewport): number {
  return vp.center.x + (px - vp.widthPx / 2) / vp.pxPerUnit
}

/** The math span the board is showing. */
export function nlRange(vp: Viewport): { min: number; max: number } {
  const half = vp.widthPx / 2 / vp.pxPerUnit
  return { min: vp.center.x - half, max: vp.center.x + half }
}

/** Nearest minor tick to `x`, for click/drag snapping. */
export function nlSnapX(x: number, vp: Viewport): number {
  const { major, minorDiv } = nlTickStep(vp)
  const minor = major / minorDiv
  const snapped = Math.round(x / minor) * minor
  // A tick further than a few px away isn't what the user was pointing at.
  if (Math.abs(snapped - x) * vp.pxPerUnit > 7) return x
  // Kill float dust so "-2" is exactly -2 in the notation readout.
  return Math.abs(snapped) < minor / 1e6 ? 0 : Number(snapped.toPrecision(12))
}

/** The x-extent an item occupies, unbounded ends included. */
function itemSpan(item: NLItem): { lo: number; hi: number } {
  if (item.kind === 'point') return { lo: item.x, hi: item.x }
  return {
    lo: item.lo === null ? -Infinity : item.lo,
    hi: item.hi === null ? Infinity : item.hi,
  }
}

export interface NLLane {
  item: NLItem
  /** 0 = drawn on the line itself; each step is NL_LANE_H px above it. */
  lane: number
  y: number
}

/**
 * Stack items that would otherwise draw on top of each other.
 *
 * Lane 0 is the line itself, which is where a worksheet draws a solution set —
 * so the ordinary case (one inequality, or a union whose parts don't touch)
 * looks exactly like the hand-drawn figure. Only genuinely overlapping items
 * get lifted, and then only as far as they have to.
 */
export function nlLanes(items: readonly NLItem[], vp: Viewport): NLLane[] {
  const axisY = numberLineAxisY(vp)
  const pad = 2 * nlDotRadius(NL_BAR_WIDTH) + 6 // px of clearance between items
  const occupied: { lo: number; hi: number }[][] = []
  const out: NLLane[] = []
  for (const item of items) {
    const s = itemSpan(item)
    const loPx = s.lo === -Infinity ? -Infinity : nlToScreenX(s.lo, vp) - pad / 2
    const hiPx = s.hi === Infinity ? Infinity : nlToScreenX(s.hi, vp) + pad / 2
    let lane = 0
    for (;;) {
      const row = occupied[lane]
      if (!row) {
        occupied[lane] = [{ lo: loPx, hi: hiPx }]
        break
      }
      const clash = row.some((r) => loPx <= r.hi && hiPx >= r.lo)
      if (!clash) {
        row.push({ lo: loPx, hi: hiPx })
        break
      }
      lane++
    }
    out.push({ item, lane, y: axisY - lane * NL_LANE_H })
  }
  return out
}

export type NLPart = 'lo' | 'hi' | 'point' | 'body'

/**
 * What is under the pointer. Endpoints beat bodies — an endpoint is the thing
 * a teacher aims at, and it is a small target sitting on top of a long one.
 */
export function nlHitTest(
  items: readonly NLItem[],
  vp: Viewport,
  pos: { x: number; y: number },
): { id: string; part: NLPart } | null {
  const lanes = nlLanes(items, vp)
  let best: { id: string; part: NLPart; d: number } | null = null

  for (let i = lanes.length - 1; i >= 0; i--) {
    const { item, y } = lanes[i]
    const dy = Math.abs(pos.y - y)
    if (dy > NL_HIT_RADIUS + 4) continue
    if (item.kind === 'point') {
      const d = Math.hypot(nlToScreenX(item.x, vp) - pos.x, dy)
      if (d <= NL_HIT_RADIUS && (!best || d < best.d)) best = { id: item.id, part: 'point', d }
      continue
    }
    if (item.lo !== null) {
      const d = Math.hypot(nlToScreenX(item.lo, vp) - pos.x, dy)
      if (d <= NL_HIT_RADIUS && (!best || d < best.d)) best = { id: item.id, part: 'lo', d }
    }
    if (item.hi !== null) {
      const d = Math.hypot(nlToScreenX(item.hi, vp) - pos.x, dy)
      if (d <= NL_HIT_RADIUS && (!best || d < best.d)) best = { id: item.id, part: 'hi', d }
    }
  }
  if (best) return { id: best.id, part: best.part }

  // No endpoint answered — try the bars themselves.
  for (let i = lanes.length - 1; i >= 0; i--) {
    const { item, y } = lanes[i]
    if (item.kind !== 'interval') continue
    if (Math.abs(pos.y - y) > NL_HIT_RADIUS) continue
    const a = item.lo === null ? -Infinity : nlToScreenX(item.lo, vp)
    const b = item.hi === null ? Infinity : nlToScreenX(item.hi, vp)
    if (pos.x >= a - 2 && pos.x <= b + 2) return { id: item.id, part: 'body' }
  }
  return null
}

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------

function isDarkGround(theme: Theme): boolean {
  const m = /^#([0-9a-fA-F]{6})$/.exec(theme.bg.trim())
  if (!m) return true
  const v = parseInt(m[1], 16)
  return 0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255) < 128
}

function arrowHead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dir: -1 | 1,
  len: number,
  half: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x - dir * len, y - half)
  ctx.lineTo(x - dir * len, y + half)
  ctx.closePath()
  ctx.fill()
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/**
 * The line itself: axis, arrowheads, ticks on the shared 1–2–5 ladder, labels.
 * Draws no ground of its own — the caller has already painted it.
 */
export function drawNumberLineAxis(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  theme: Theme,
  opts?: PaintScale | null,
): void {
  const W = vp.widthPx
  const H = vp.heightPx
  const ppu = vp.pxPerUnit
  if (W <= 0 || H <= 0 || !(ppu > 0)) return

  const { type, stroke } = paintScale(opts)
  const fpx = TICK_LABEL_PX * type
  const tickMajor = TICK_MAJOR * stroke
  const tickMinor = TICK_MINOR * stroke

  const y = numberLineAxisY(vp)
  const { major, minorDiv } = nlTickStep(vp, type)
  const minor = major / minorDiv
  const { min: xMin, max: xMax } = nlRange(vp)

  ctx.save()

  // ---- minor ticks, never labelled (only while far enough apart to read) --
  if (minor * ppu >= 7 * stroke) {
    ctx.strokeStyle = theme.gridMajor
    ctx.lineWidth = 1 * stroke
    ctx.beginPath()
    const k0 = Math.ceil(xMin / minor)
    const k1 = Math.floor(xMax / minor)
    for (let k = k0; k <= k1; k++) {
      if (((k % minorDiv) + minorDiv) % minorDiv === 0) continue
      const px = nlToScreenX(k * minor, vp)
      ctx.moveTo(px, y - tickMinor)
      ctx.lineTo(px, y + tickMinor)
    }
    ctx.stroke()
  }

  // ---- the line, with an arrowhead at each end ----------------------------
  ctx.strokeStyle = theme.axis
  ctx.fillStyle = theme.axis
  ctx.lineWidth = 1.6 * stroke
  ctx.beginPath()
  ctx.moveTo(0, y)
  ctx.lineTo(W, y)
  ctx.stroke()
  arrowHead(ctx, W, y, 1, AXIS_ARROW_LEN * stroke, AXIS_ARROW_HALF * stroke)
  arrowHead(ctx, 0, y, -1, AXIS_ARROW_LEN * stroke, AXIS_ARROW_HALF * stroke)

  // ---- major ticks + labels ----------------------------------------------
  ctx.lineWidth = 1.6 * stroke
  ctx.beginPath()
  const j0 = Math.ceil(xMin / major)
  const j1 = Math.floor(xMax / major)
  for (let j = j0; j <= j1; j++) {
    const px = nlToScreenX(j * major, vp)
    ctx.moveTo(px, y - tickMajor)
    ctx.lineTo(px, y + tickMajor)
  }
  ctx.stroke()

  ctx.font = nlFont(fpx)
  ctx.fillStyle = theme.label
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (let j = j0; j <= j1; j++) {
    const px = nlToScreenX(j * major, vp)
    const edge = Math.max(12, AXIS_ARROW_LEN * stroke + 3)
    if (px < edge || px > W - edge) continue // keep clear of the arrowheads
    ctx.fillText(formatTick(j * major), px, y + tickMajor + 3 * type)
  }

  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.restore()
}

export interface NLItemPaint {
  /** Already mapped to print colours by the caller where that applies. */
  color: string
  theme: Theme
  /** Screen y of the lane this item sits on. */
  y: number
  barWidth?: number
  dash?: number[]
  opacity?: number
  /** Chrome only: a soft halo under the item saying "this one is selected". */
  selected?: boolean
  /** Chrome only: the endpoint being dragged / hovered, drawn slightly larger. */
  activePart?: NLPart | null
  /** Draw the optional text label above the item. */
  showLabel?: boolean
  /**
   * Presentation scaling: `type` multiplies the label font, `stroke` the bar
   * thickness and the endpoint dots. A number line is a ~40px strip in a tall
   * canvas; projected, it needs to be able to grow.
   */
  scale?: PaintScale | null
}

/**
 * One point or interval. The endpoint dots are painted LAST and always after
 * the bar, so an open endpoint's ground-coloured centre covers the bar rather
 * than letting it show through.
 */
export function drawNLItem(
  ctx: CanvasRenderingContext2D,
  item: NLItem,
  vp: Viewport,
  o: NLItemPaint,
): void {
  const theme = o.theme
  const y = o.y
  const { type, stroke } = paintScale(o.scale)
  // The user's own thickness choice is clamped to its slider range FIRST, then
  // scaled for the projector -- presentation scale is not a way past the range.
  const w =
    Math.max(NL_MIN_BAR_WIDTH, Math.min(NL_MAX_BAR_WIDTH, o.barWidth ?? NL_BAR_WIDTH)) * stroke
  const r = nlDotRadius(w)
  const alpha = o.opacity === undefined ? 1 : Math.max(0.05, Math.min(1, o.opacity))
  const W = vp.widthPx

  /** A dot that reads correctly on any ground: hollow means bg-filled. */
  const dot = (x: number, closed: boolean, grow: number): void => {
    const rr = r + grow
    if (closed) {
      ctx.globalAlpha = alpha
      ctx.beginPath()
      ctx.arc(x, y, rr, 0, TWO_PI)
      ctx.fillStyle = o.color
      ctx.fill()
      // A thin ground-coloured rim keeps two touching closed dots apart.
      ctx.lineWidth = 1.2
      ctx.strokeStyle = theme.bg
      ctx.stroke()
    } else {
      // Opaque centre FIRST, at full alpha: the bar must not read through it.
      ctx.globalAlpha = 1
      ctx.beginPath()
      ctx.arc(x, y, rr, 0, TWO_PI)
      ctx.fillStyle = theme.bg
      ctx.fill()
      ctx.globalAlpha = alpha
      ctx.lineWidth = Math.max(2, w * 0.42)
      ctx.strokeStyle = o.color
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  ctx.save()

  if (o.selected) {
    // Chrome: a soft wash behind the item, never part of the figure.
    ctx.globalAlpha = 0.16
    ctx.fillStyle = o.color
    const s = itemSpan(item)
    const a = s.lo === -Infinity ? 0 : nlToScreenX(s.lo, vp)
    const b = s.hi === Infinity ? W : nlToScreenX(s.hi, vp)
    const pad = r + 4
    roundRect(ctx, Math.min(a, b) - pad, y - pad, Math.abs(b - a) + 2 * pad, 2 * pad, pad)
    ctx.fill()
    ctx.globalAlpha = 1
  }

  if (item.kind === 'interval') {
    const unboundedLo = item.lo === null
    const unboundedHi = item.hi === null
    const a = unboundedLo ? 4 : nlToScreenX(item.lo as number, vp)
    const b = unboundedHi ? W - 4 : nlToScreenX(item.hi as number, vp)
    const left = Math.min(a, b)
    const right = Math.max(a, b)
    // Leave room for the arrowhead so the bar doesn't square off its own tip.
    const barLeft = unboundedLo ? left + BAR_ARROW_LEN - 1 : left
    const barRight = unboundedHi ? right - BAR_ARROW_LEN + 1 : right

    ctx.globalAlpha = alpha
    ctx.strokeStyle = o.color
    ctx.fillStyle = o.color
    ctx.lineWidth = w
    ctx.lineCap = 'butt'
    if (o.dash && o.dash.length > 0) ctx.setLineDash(o.dash)
    if (barRight > barLeft) {
      ctx.beginPath()
      ctx.moveTo(barLeft, y)
      ctx.lineTo(barRight, y)
      ctx.stroke()
    }
    ctx.setLineDash([])
    if (unboundedLo) arrowHead(ctx, left, y, -1, BAR_ARROW_LEN, w * 0.9 + 2)
    if (unboundedHi) arrowHead(ctx, right, y, 1, BAR_ARROW_LEN, w * 0.9 + 2)
    ctx.globalAlpha = 1

    if (!unboundedLo) dot(a, item.loClosed, o.activePart === 'lo' ? 1.6 : 0)
    if (!unboundedHi) dot(b, item.hiClosed, o.activePart === 'hi' ? 1.6 : 0)
  } else {
    dot(nlToScreenX(item.x, vp), item.closed, o.activePart === 'point' ? 1.6 : 0)
  }

  // ---- the label: what makes the figure worksheet-ready -------------------
  const label = typeof item.label === 'string' ? item.label.trim() : ''
  if (o.showLabel !== false && label) {
    const s = itemSpan(item)
    const a = s.lo === -Infinity ? 0 : nlToScreenX(s.lo, vp)
    const b = s.hi === Infinity ? W : nlToScreenX(s.hi, vp)
    let cx = (Math.max(0, Math.min(W, a)) + Math.max(0, Math.min(W, b))) / 2
    ctx.font = nlFont(ITEM_LABEL_PX * type)
    const tw = ctx.measureText(label).width
    cx = Math.max(tw / 2 + 4, Math.min(W - tw / 2 - 4, cx))
    const ly = y - r - 12 * type
    // A ground-coloured plate so a label over a tick or a bar stays readable.
    ctx.globalAlpha = 0.9
    ctx.fillStyle = theme.bg
    roundRect(ctx, cx - tw / 2 - 5, ly - 9 * type, tw + 10, 18 * type, 5)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.fillStyle = isDarkGround(theme) ? DARK_TEXT : theme.label
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, cx, ly)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }

  ctx.restore()
}

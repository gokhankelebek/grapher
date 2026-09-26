// ============================================================================
// src/ui/viewScale.ts — how the VIEW moves when x and y are scaled apart.
//
// Every board used to be square: one pxPerUnit for both axes. Data does not
// care about that — years 1990–2020 against a population in millions is a
// flat smear on a square board — so the viewport may now carry pxPerUnitY
// (core/types.ts). This module is every change the app makes to a view, in one
// place and in plain functions, so the wheel, the pinch, the axis-label drag,
// the zoom buttons, the WINDOW panel and "Zoom to data" all agree about what a
// zoom, a stretch and a fit ARE:
//
//   zoom     — both axes by the same factor, about a screen point that stays
//              put. The ratio between the axes never changes.
//   stretch  — ONE axis, about a screen point that stays put. Implies
//              Independent axes.
//   square   — back to equal axes, keeping the x scale and the centre.
//   window   — the TI WINDOW: x min … y max, set exactly.
//   fit      — frame a box, per axis when Independent, square when Equal.
//
// The AXES MODE is carried by the viewport itself: pxPerUnitY present means
// Independent (even when it happens to equal pxPerUnit), absent means Equal.
// One source of truth, and it is exactly what persists: board.viewport.ppuY.
//
// Everything here mutates the viewport it is handed — the stage keeps its view
// in a ref and redraws without a React render — and is pure otherwise.
// ============================================================================

import type { Vec2, Viewport } from '../core/types'
import { ppuX, ppuY, toMath } from '../core/types'

/**
 * Pixels per unit, either axis. Wide on purpose: a population axis needs
 * ~3·10⁻⁶ px per person, and a 0.001 floor pinned it so a census table
 * collapsed into a sliver 0.7 million tall.
 */
export const MIN_PPU = 1e-9
export const MAX_PPU = 1e9

export const clampPpu = (v: number): number => Math.min(MAX_PPU, Math.max(MIN_PPU, v))

export type AxesMode = 'equal' | 'independent'
export type Axis = 'x' | 'y'

/** The mode a view is in: Independent exactly when it carries its own y scale. */
export const axesModeOf = (vp: Viewport): AxesMode =>
  vp.pxPerUnitY !== undefined ? 'independent' : 'equal'

/** The math box on screen, TI style. */
export interface ViewWindow {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

export function readWindow(vp: Viewport): ViewWindow {
  const hx = vp.widthPx / 2 / ppuX(vp)
  const hy = vp.heightPx / 2 / ppuY(vp)
  return {
    xMin: vp.center.x - hx,
    xMax: vp.center.x + hx,
    yMin: vp.center.y - hy,
    yMax: vp.center.y + hy,
  }
}

/** Move the board by a screen delta (the content follows the pointer). */
export function panBy(vp: Viewport, dxPx: number, dyPx: number): void {
  vp.center = {
    x: vp.center.x - dxPx / ppuX(vp),
    y: vp.center.y + dyPx / ppuY(vp),
  }
}

/**
 * Zoom BOTH axes by one factor about a screen point, which stays under itself.
 *
 * The factor is clamped so neither axis leaves [MIN_PPU, MAX_PPU]: clamping
 * the two scales separately would quietly change the ratio between them at
 * the limits, which a zoom must never do.
 */
export function zoomAbout(vp: Viewport, anchorPx: Vec2, factor: number): void {
  if (!Number.isFinite(factor) || factor <= 0) return
  const px = ppuX(vp)
  const py = ppuY(vp)
  const lo = Math.max(MIN_PPU / px, MIN_PPU / py)
  const hi = Math.min(MAX_PPU / px, MAX_PPU / py)
  const f = lo <= hi ? Math.min(hi, Math.max(lo, factor)) : 1
  const anchor = toMath(anchorPx, vp)
  vp.pxPerUnit = px * f
  if (vp.pxPerUnitY !== undefined) vp.pxPerUnitY = py * f
  vp.center = {
    x: anchor.x - (anchorPx.x - vp.widthPx / 2) / ppuX(vp),
    y: anchor.y + (anchorPx.y - vp.heightPx / 2) / ppuY(vp),
  }
}

/** Turn Independent on without changing what is on screen. */
export function makeIndependent(vp: Viewport): void {
  if (vp.pxPerUnitY === undefined) vp.pxPerUnitY = vp.pxPerUnit
}

/**
 * Back to equal axes: the x scale and the centre stay, y is re-squared to
 * match — so the numbers along x do not move and the board only changes
 * vertically.
 */
export function squareAxes(vp: Viewport): void {
  delete vp.pxPerUnitY
}

/**
 * Stretch ONE axis to an absolute scale about a screen point, which stays
 * under itself along that axis. Stretching implies Independent.
 */
export function setAxisScale(vp: Viewport, axis: Axis, ppu: number, anchorPx: Vec2): void {
  if (!Number.isFinite(ppu) || ppu <= 0) return
  const anchor = toMath(anchorPx, vp)
  makeIndependent(vp)
  if (axis === 'x') {
    vp.pxPerUnit = clampPpu(ppu)
    vp.center = { x: anchor.x - (anchorPx.x - vp.widthPx / 2) / vp.pxPerUnit, y: vp.center.y }
  } else {
    vp.pxPerUnitY = clampPpu(ppu)
    vp.center = { x: vp.center.x, y: anchor.y + (anchorPx.y - vp.heightPx / 2) / vp.pxPerUnitY }
  }
}

/** Stretch ONE axis by a factor about a screen point (⇧-wheel, ⌥-wheel). */
export function stretchAbout(vp: Viewport, axis: Axis, anchorPx: Vec2, factor: number): void {
  if (!Number.isFinite(factor) || factor <= 0) return
  const cur = axis === 'x' ? ppuX(vp) : ppuY(vp)
  setAxisScale(vp, axis, cur * factor, anchorPx)
}

/**
 * The factor a drag along an axis' numbers stretches that axis by.
 *
 * Measured from the board centre, so the number that was grabbed stays under
 * the pointer: grab "6" at 180 px right of centre, drag to 360 px, and the
 * axis doubles. Near the centre the lever would be tiny and a one-pixel
 * wobble would rescale the board, so the lever is floored at MIN_LEVER px —
 * there the drag is a steady rate instead. Never below 5%: dragging a label
 * through the centre does not flip the axis.
 */
export const MIN_LEVER = 60
export function dragStretchFactor(startPx: number, nowPx: number, centrePx: number): number {
  const lever = startPx - centrePx
  const sgn = lever < 0 ? -1 : 1
  const f = 1 + ((nowPx - startPx) * sgn) / Math.max(Math.abs(lever), MIN_LEVER)
  return Number.isFinite(f) ? Math.max(0.05, f) : 1
}

// ------------------------------------------------------ polar needs equal axes

/**
 * The polar ruling draws circles of constant r, and a circle is only a circle
 * on equal axes. So the two exclude each other, and the App REFUSES rather
 * than silently re-squaring: a stretched view is usually a window the teacher
 * set on purpose. (The refusal carries a one-tap "Make axes equal".)
 */
export const POLAR_NEEDS_EQUAL = 'The polar ruling needs equal axes.'
export const INDEPENDENT_NEEDS_SQUARE =
  'The polar ruling needs equal axes — switch the ruling to Square first.'

/** Choosing this ruling on this view is refused (polar on Independent axes). */
export const rulingRefused = (next: string, vp: Viewport): boolean =>
  next === 'polar' && vp.pxPerUnitY !== undefined

/** Choosing this axes mode on this ruling is refused (Independent on polar). */
export const axesModeRefused = (next: AxesMode, ruling: string): boolean =>
  next === 'independent' && ruling === 'polar'

// ------------------------------------------------------------------- window

/** How far the two spans may disagree with the board's shape and still be square. */
export const SQUARE_TOLERANCE = 0.01

export type WindowOutcome =
  | { ok: false; error: string }
  | {
      ok: true
      /** Equal axes were turned into Independent to honour the window. */
      madeIndependent: boolean
      /** The window could not be honoured exactly (polar ruling keeps it square). */
      contained: boolean
    }

/** Say what is wrong with a window before anything moves. */
export function windowError(w: ViewWindow): string | null {
  const vals = [w.xMin, w.xMax, w.yMin, w.yMax]
  if (!vals.every((v) => Number.isFinite(v))) return 'Each of the four values has to be a number'
  if (!(w.xMax > w.xMin)) return 'x max has to be larger than x min'
  if (!(w.yMax > w.yMin)) return 'y max has to be larger than y min'
  return null
}

/**
 * Set the view to a TI WINDOW, exactly.
 *
 * Independent: each axis gets exactly its span. Equal: if the two spans are
 * already in the board's own proportions (within 1%) the board stays equal
 * with x exact; otherwise the window wins and the axes become Independent.
 * `keepSquare` (the polar ruling, which only means anything on equal axes)
 * refuses the stretch and fits the window INSIDE a square view instead.
 */
export function applyWindow(
  vp: Viewport,
  w: ViewWindow,
  opts: { keepSquare?: boolean } = {},
): WindowOutcome {
  const err = windowError(w)
  if (err) return { ok: false, error: err }
  const px = vp.widthPx / (w.xMax - w.xMin)
  const py = vp.heightPx / (w.yMax - w.yMin)
  if (!(px > 0) || !(py > 0) || !Number.isFinite(px) || !Number.isFinite(py)) {
    return { ok: false, error: 'That window is too small to draw' }
  }
  if (px < MIN_PPU || py < MIN_PPU) return { ok: false, error: 'That window is too large to draw' }
  if (px > MAX_PPU || py > MAX_PPU) return { ok: false, error: 'That window is too small to draw' }
  vp.center = { x: (w.xMin + w.xMax) / 2, y: (w.yMin + w.yMax) / 2 }
  const square = Math.abs(py / px - 1) <= SQUARE_TOLERANCE
  if (opts.keepSquare) {
    delete vp.pxPerUnitY
    vp.pxPerUnit = Math.min(px, py)
    return { ok: true, madeIndependent: false, contained: !square }
  }
  if (vp.pxPerUnitY === undefined && square) {
    vp.pxPerUnit = px
    return { ok: true, madeIndependent: false, contained: false }
  }
  const madeIndependent = vp.pxPerUnitY === undefined
  vp.pxPerUnit = px
  vp.pxPerUnitY = py
  return { ok: true, madeIndependent, contained: false }
}

/**
 * TI's ZSquare: equal axes, same centre, and the whole of the current window
 * still on screen — the axis that was squeezed is widened, never cut.
 */
export function squareToContain(vp: Viewport): void {
  const s = Math.min(ppuX(vp), ppuY(vp))
  delete vp.pxPerUnitY
  vp.pxPerUnit = clampPpu(s)
}

// ---------------------------------------------------------------------- fit

export interface Box {
  min: Vec2
  max: Vec2
}

/** Fraction of the frame left as breathing room around a fitted figure. */
export const FIT_MARGIN = 0.12

/**
 * How lopsided a box may be, against the board's own shape, before equal axes
 * stop being readable. "Zoom to data" turns Independent on past it by itself.
 *
 * 2, not the 4 first proposed: measured on the census table the teacher
 * pastes first (1990–2020 against 249–331 million) the excess is 2.5 on a
 * typical board — the points squeezed into a third of the width, which is
 * exactly the unreadable picture this rule exists to fix — and a 4:1 rule
 * never fired on it. Past 2 one axis of the data fills less than half its side
 * of the frame. (A TI's ZoomStat and Desmos's data zoom fit the axes
 * independently always; this only does it when equal axes would hurt.)
 */
export const DATA_ASPECT_LIMIT = 2

/**
 * How much more of the frame one axis of `box` wants than the other, once it is
 * framed on equal axes: 1 is the board's own shape, 4 means one axis of the box
 * would fill only a quarter of its side of the frame. Symmetric (always ≥ 1).
 */
export function boxAspectExcess(vp: Viewport, box: Box): number {
  const w = box.max.x - box.min.x
  const h = box.max.y - box.min.y
  if (!(w > 0) || !(h > 0) || !(vp.widthPx > 0) || !(vp.heightPx > 0)) return 1
  const r = h / w / (vp.heightPx / vp.widthPx)
  return Number.isFinite(r) ? Math.max(r, 1 / r) : 1
}

/**
 * Frame a box with the fit margin all round.
 *
 * `independent` fits each axis to its own extent. A degenerate axis (a
 * horizontal line has no height) has no extent to fit, so it borrows the
 * other axis' scale rather than zooming to MAX_PPU. Equal axes fit the box
 * inside a square frame. The number line pins y at 0 (`centreY0`).
 */
export function fitBox(
  vp: Viewport,
  box: Box,
  opts: { independent: boolean; centreY0?: boolean; margin?: number } = { independent: false },
): void {
  const m = opts.margin ?? FIT_MARGIN
  const usableW = Math.max(1, vp.widthPx * (1 - 2 * m))
  const usableH = Math.max(1, vp.heightPx * (1 - 2 * m))
  const rawW = box.max.x - box.min.x
  const rawH = box.max.y - box.min.y
  const w = Math.max(rawW, 1e-6)
  const h = Math.max(rawH, 1e-6)
  const square = clampPpu(Math.min(usableW / w, usableH / h))
  vp.center = {
    x: (box.min.x + box.max.x) / 2,
    y: opts.centreY0 ? 0 : (box.min.y + box.max.y) / 2,
  }
  if (!opts.independent) {
    delete vp.pxPerUnitY
    vp.pxPerUnit = square
    return
  }
  const scale = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.y), Math.abs(box.max.y), 1)
  const tiny = 1e-9 * scale
  const fx = rawW > tiny ? clampPpu(usableW / rawW) : null
  const fy = rawH > tiny ? clampPpu(usableH / rawH) : null
  vp.pxPerUnit = fx ?? fy ?? square
  vp.pxPerUnitY = fy ?? fx ?? square
}

/**
 * "Zoom to data": frame a table's points.
 *
 * Independent fits per axis. Equal fits square — unless the data is so
 * lopsided (DATA_ASPECT_LIMIT) that a square frame would draw it as a line
 * along one edge, in which case the axes are scaled independently and the
 * caller says so. `keepSquare` (the polar ruling) forbids that.
 */
export function fitData(
  vp: Viewport,
  box: Box,
  opts: { keepSquare?: boolean } = {},
): { madeIndependent: boolean } {
  const wasIndependent = vp.pxPerUnitY !== undefined
  if (opts.keepSquare) {
    fitBox(vp, box, { independent: false })
    return { madeIndependent: false }
  }
  if (wasIndependent) {
    fitBox(vp, box, { independent: true })
    return { madeIndependent: false }
  }
  if (boxAspectExcess(vp, box) > DATA_ASPECT_LIMIT) {
    fitBox(vp, box, { independent: true })
    return { madeIndependent: true }
  }
  fitBox(vp, box, { independent: false })
  return { madeIndependent: false }
}

// -------------------------------------------------------- axis label bands

/**
 * Where a press on the board is on an axis' NUMBERS — the band a drag
 * stretches that axis from.
 *
 * Mirrors where src/render/grid.ts writes the labels: the x numbers sit just
 * under the x-axis (slid to the top or bottom edge when the axis is off
 * screen), the y numbers just left of the y-axis (slid to either side edge).
 * The band is the labels plus a few pixels — about 24 px across — and starts
 * BELOW the x-axis line and LEFT of the y-axis line, so a curve drawn across
 * an axis is still ink. The corner where the two bands meet (the origin's
 * "0") belongs to neither.
 */
export const X_BAND_PX = 24
export const Y_BAND_PX = 48

export function axisBandAt(vp: Viewport, pos: Vec2, typeScale = 1): Axis | null {
  const W = vp.widthPx
  const H = vp.heightPx
  if (!(W > 0) || !(H > 0)) return null
  if (pos.x < 0 || pos.y < 0 || pos.x > W || pos.y > H) return null
  const fpx = 11 * typeScale
  const axisY = H / 2 + vp.center.y * ppuY(vp)
  const axisX = W / 2 - vp.center.x * ppuX(vp)
  const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
  // x labels: grid.ts draws them at clamp(axisY + 5·type, 4, H − fpx − 6), top-aligned.
  const labelY = clamp(axisY + 5 * typeScale, 4, Math.max(4, H - fpx - 6))
  const xTop = Math.max(labelY - 3, Math.min(axisY + 2, labelY))
  const inX = pos.y >= xTop && pos.y <= xTop + X_BAND_PX * typeScale
  // y labels: right-aligned at clamp(axisX − 6, textWidth + 4, W − 4).
  const labelRight = clamp(axisX - 6, Y_BAND_PX * typeScale - 4, W - 4)
  const yRight = Math.min(labelRight + 3, Math.max(axisX - 2, labelRight))
  const inY = pos.x <= yRight && pos.x >= yRight - Y_BAND_PX * typeScale
  if (inX && inY) return null
  if (inX) return 'x'
  if (inY) return 'y'
  return null
}

// --------------------------------------------------------- screen distances

/** Nearest point of a screen polyline to `p`, skipping asymptote jumps. */
export function nearestOnPolyline(p: Vec2, pts: readonly Vec2[]): { dist: number; point: Vec2 } | null {
  let best: { dist: number; point: Vec2 } | null = null
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const abx = b.x - a.x
    const aby = b.y - a.y
    const len2 = abx * abx + aby * aby
    if (len2 > 300 * 300) continue
    let t = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2 : 0
    t = Math.max(0, Math.min(1, t))
    const q = { x: a.x + t * abx, y: a.y + t * aby }
    const d = Math.hypot(p.x - q.x, p.y - q.y)
    if (!best || d < best.dist) best = { dist: d, point: q }
  }
  return best
}

/** Screen distance between two math points — the only honest one on a stretched board. */
export function screenDist(a: Vec2, b: Vec2, vp: Viewport): number {
  return Math.hypot((a.x - b.x) * ppuX(vp), (a.y - b.y) * ppuY(vp))
}

// ---------------------------------------------------------------- formatting

/**
 * A window value, as the WINDOW panel prints it: enough digits to tell the
 * edges of this view apart (a thousandth of the span), and no trailing noise
 * — so 1985 reads "1985", not "1985.000000001", and the default view reads
 * "−8.533", not sixteen digits.
 */
export function formatWindowValue(v: number, span: number): string {
  if (!Number.isFinite(v)) return ''
  const s = Math.abs(span) > 0 && Number.isFinite(span) ? Math.abs(span) : 1
  const decimals = Math.max(0, Math.min(12, Math.ceil(-Math.log10(s / 1000))))
  let out = v.toFixed(decimals)
  if (out.includes('.')) out = out.replace(/0+$/, '').replace(/\.$/, '')
  if (/^-0$/.test(out)) out = '0'
  return out
}

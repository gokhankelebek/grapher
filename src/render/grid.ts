// ============================================================================
// src/render/grid.ts — Desmos-quality infinite grid + axes + labels.
// All drawing units are CSS pixels (ctx is already DPR-scaled by the caller).
// ============================================================================

import type { Viewport, Theme } from '../core/types'

// ---------------------------------------------------------------------------
// Nice step selection: 1–2–5 × 10^n ladder, major spacing targeting 70–120 px.
// Minor subdivision: mantissa 2 → 4 minors (0.5 steps), otherwise 5.
// ---------------------------------------------------------------------------

export interface GridStep {
  major: number     // math units between major lines
  minorDiv: number  // minors per major (4 or 5)
}

const LADDER: ReadonlyArray<readonly [number, number]> = [
  [1, 5],
  [2, 4],
  [5, 5],
  [10, 5],
]

/**
 * The 1–2–5 ladder, shared by every board kind.
 *
 * Exported because a number line needs exactly this decision and must not make
 * a second one: two ladders would drift, and a figure whose ticks disagree with
 * the grid it was copied from is worse than no ticks at all. `minPx` is the
 * only thing that differs — a number line has no vertical labels competing for
 * room, so it can afford a denser ladder (labelling every unit where the
 * cartesian grid would label every second one).
 */
export function pickTickStep(pxPerUnit: number, minPx = 70): GridStep {
  const raw = (minPx / 70) * 90 / pxPerUnit // math units that span the target gap
  const exp = Math.floor(Math.log10(raw))
  const base = Math.pow(10, exp)
  let major = 10 * base
  let minorDiv = 5
  for (let i = 0; i < LADDER.length; i++) {
    const step = LADDER[i][0] * base
    if (step * pxPerUnit >= minPx) {
      major = step
      minorDiv = LADDER[i][1]
      break
    }
  }
  return { major, minorDiv }
}

// ---------------------------------------------------------------------------
// The π ladder.
//
// `y = sin(x)` on a 1–2–5 ladder gets ticks at 3, 6, 9: numbers that have
// nothing to do with the picture above them. A trig unit wants the axis
// measured in the same unit the function is, so there is a SECOND ladder whose
// rungs are rational multiples of π — and it is chosen by exactly the same
// minimum-spacing rule as the decimal one, so labels thin out honestly as the
// board zooms out instead of piling up.
//
// The step is carried as an exact fraction (num/den of π) as well as a float:
// the float places the line, the fraction writes the label. Deriving "which
// multiple of π is this" back from `k * (π/12)` in floating point is how you
// end up printing 2π/2 — so we never do that arithmetic twice.
// ---------------------------------------------------------------------------

/** How an axis is measured. Absent anywhere means 'decimal'. */
export type AxisUnit = 'decimal' | 'pi'

/** Per-axis units; either side may be π independently (polar → cartesian). */
export interface AxisUnits {
  x?: AxisUnit
  y?: AxisUnit
}

/** A GridStep that also knows itself as the exact fraction (num·π)/den. */
export interface PiStep extends GridStep {
  num: number
  den: number
}

/**
 * Rungs below 10π, written as [num, den, minorDiv].
 *
 * Minor subdivision is chosen so the minors are themselves quantities a class
 * writes down: π/2 subdivides into π/6 (not π/10), π into π/4, 2π into π/2.
 * A minor that isn't a nameable angle is just a hairline, and a hairline the
 * teacher can't name is noise.
 */
/**
 * The ladder BOTTOMS OUT at π/12 (15°) on purpose. Halving past it would keep
 * the spacing rule satisfied at extreme zoom — π/24, π/48, π/96 — but π/96 is
 * not a quantity anyone writes on a board, and a label nobody can name is worse
 * than a sparse axis. Zoomed in past π/12 the majors simply get further apart
 * and the π/24 minors carry the structure.
 */
const PI_LADDER: ReadonlyArray<readonly [number, number, number]> = [
  [1, 12, 2],  // π/12  → π/24
  [1, 6, 2],   // π/6   → π/12
  [1, 4, 3],   // π/4   → π/12
  [1, 3, 2],   // π/3   → π/6
  [1, 2, 3],   // π/2   → π/6
  [1, 1, 4],   // π     → π/4
  [2, 1, 4],   // 2π    → π/2
  [5, 1, 5],   // 5π    → π
]

/**
 * The π ladder, chosen by the same rule as `pickTickStep`: the first rung whose
 * major spacing reaches `minPx`. Above 5π the rungs are just the 1–2–5 ladder
 * counted in units of π (10π, 20π, 50π, 100π …), so the two ladders agree about
 * what "far enough apart" means and only disagree about what a unit is.
 */
export function pickPiTickStep(pxPerUnit: number, minPx = 70): PiStep {
  const pxPerPi = pxPerUnit * Math.PI
  if (!(pxPerPi > 0) || !Number.isFinite(pxPerPi)) {
    return { major: Math.PI, minorDiv: 4, num: 1, den: 1 }
  }
  for (let i = 0; i < PI_LADDER.length; i++) {
    const [num, den, minorDiv] = PI_LADDER[i]
    if ((num / den) * pxPerPi >= minPx) {
      return { major: (num * Math.PI) / den, minorDiv, num, den }
    }
  }
  // Zoomed out past 5π: hand the decision to the 1–2–5 ladder, measuring in π.
  const wide = pickTickStep(pxPerPi, minPx)
  const num = Math.max(10, Math.round(wide.major))
  return { major: num * Math.PI, minorDiv: wide.minorDiv, num, den: 1 }
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y > 0) {
    const t = x % y
    x = y
    y = t
  }
  return x || 1
}

// ---------------------------------------------------------------------------
// Tick label formatting: clean decimals via toPrecision trimming; exponent
// form for |v| >= 1e6 or |v| <= 1e-4.
// ---------------------------------------------------------------------------

function trimZeros(s: string): string {
  if (s.indexOf('e') >= 0 || s.indexOf('.') < 0) return s
  let out = s.replace(/0+$/, '')
  if (out.endsWith('.')) out = out.slice(0, -1)
  return out
}

export function formatTick(v: number): string {
  if (v === 0 || !Number.isFinite(v)) return '0'
  const a = Math.abs(v)
  if (a >= 1e6 || a <= 1e-4) {
    const exp = Math.floor(Math.log10(a) + 1e-12)
    const mant = v / Math.pow(10, exp)
    return `${trimZeros(mant.toPrecision(6))}e${exp}`
  }
  return trimZeros(v.toPrecision(12))
}

/**
 * The label for the exact quantity (n·π)/d, written the way a teacher writes it
 * on the board: `0`, `π/2`, `π`, `3π/2`, `2π`, `-π/4`, `5π`.
 *
 * The fraction is reduced first, so the rung that steps by π/2 prints π at
 * k = 2 rather than `2π/2`, and 2π at k = 4 rather than `4π/2`. The coefficient
 * 1 is never written (`π`, never `1π`; `-π`, never `-1π`), and zero is zero —
 * the same zero-suppression `formatTick` does, including for a non-finite
 * argument, so the two ladders cannot disagree about the origin.
 *
 * The minus sign is ASCII, exactly as `formatTick` emits it: within one figure
 * a π axis and a decimal axis are often side by side, and two different minus
 * glyphs on one board is worse than the plainer of the two everywhere.
 */
export function formatPiTick(n: number, d = 1): string {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0 || n === 0) return '0'
  let num = n
  let den = d
  if (den < 0) {
    num = -num
    den = -den
  }
  const g = gcd(num, den)
  num /= g
  den /= g
  const sign = num < 0 ? '-' : ''
  const a = Math.abs(num)
  const coef = a === 1 ? '' : formatTick(a)
  return den === 1 ? `${sign}${coef}π` : `${sign}${coef}π/${formatTick(den)}`
}

/** True when a step came off the π ladder and must be labelled as one. */
export function isPiStep(s: GridStep | PiStep): s is PiStep {
  return (s as PiStep).den !== undefined
}

/** The label for tick index `k` on whichever ladder `step` came from. */
export function tickLabel(step: GridStep | PiStep, k: number): string {
  return isPiStep(step) ? formatPiTick(k * step.num, step.den) : formatTick(k * step.major)
}

// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * Base type size for the axis tick labels, multiplied by `opts.type`.
 * Nothing on this canvas renders above ~13.65px at 1:1; projected at 1280x720
 * across a classroom, 11px is not readable from the back row, so every font
 * here is a base size times a presentation scale rather than a literal.
 */
export const LABEL_PX = 11

export const gridFont = (px: number): string =>
  `${px}px system-ui, -apple-system, "Segoe UI", sans-serif`

export const ARROW_LEN = 8
export const ARROW_HALF = 3.5

/**
 * Line weight is a LADDER, exactly like the grid colours in types.ts:
 * minor 1, major 1.25, axis 1.5. Colour alone does not survive a projector's
 * ambient wash, so the three levels of the grid differ in THICKNESS as well as
 * in value -- and the axis is separated from its own labels, which are drawn in
 * theme.label (a step above theme.axis), never in the axis colour.
 */
export const GRID_MINOR_WIDTH = 1
export const GRID_MAJOR_WIDTH = 1.25
export const GRID_AXIS_WIDTH = 1.5

/**
 * Presentation scaling (see BoardScene.present): `type` multiplies every font,
 * `stroke` every line weight. Both default to 1, so an unscaled board draws
 * exactly the pixels it drew before this existed.
 */
export interface PaintScale {
  type?: number
  stroke?: number
}

/** Normalise a PaintScale: finite, positive, and within sane projector limits. */
export function paintScale(o?: PaintScale | null): { type: number; stroke: number } {
  const n = (v: number | undefined): number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(6, Math.max(0.5, v)) : 1
  return { type: n(o?.type), stroke: n(o?.stroke) }
}

/**
 * A π label ("3π/2") is about 1.6x the glyph run of the decimal it replaces
 * ("4.7"), so the crowding rule has to be re-asked at the wider text or the
 * labels touch at exactly the zoom where the ladder was tuned. This is the
 * π ladder's minimum major spacing, and it scales with `present.type` for the
 * same reason: a 3x projected label needs 3x the room.
 *
 * The DECIMAL ladder keeps its own 70px rule untouched — a board without
 * `axisUnits` must draw the pixels it drew before this file learned about π.
 */
export const PI_LABEL_MIN_PX = 80

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  theme: Theme,
  opts?: PaintScale | null,
  units?: AxisUnits | null,
): void {
  const { type, stroke } = paintScale(opts)
  const fpx = LABEL_PX * type
  const W = vp.widthPx
  const H = vp.heightPx
  const ppu = vp.pxPerUnit
  if (W <= 0 || H <= 0 || !(ppu > 0)) {
    ctx.fillStyle = theme.bg
    ctx.fillRect(0, 0, Math.max(0, W), Math.max(0, H))
    return
  }

  ctx.save()
  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, W, H)

  // One ladder per axis. When neither axis is in π both sides hold the SAME
  // object the old single-step code computed, so the emitted command stream is
  // unchanged down to the argument.
  const decimal = pickTickStep(ppu)
  const piMinPx = PI_LABEL_MIN_PX * type
  const xStep: GridStep | PiStep =
    units?.x === 'pi' ? pickPiTickStep(ppu, piMinPx) : decimal
  const yStep: GridStep | PiStep =
    units?.y === 'pi' ? pickPiTickStep(ppu, piMinPx) : decimal
  const xMinor = xStep.major / xStep.minorDiv
  const yMinor = yStep.major / yStep.minorDiv

  // visible math range
  const xMin = vp.center.x - W / 2 / ppu
  const xMax = vp.center.x + W / 2 / ppu
  const yMin = vp.center.y - H / 2 / ppu
  const yMax = vp.center.y + H / 2 / ppu

  const sx = (x: number): number => W / 2 + (x - vp.center.x) * ppu
  const sy = (y: number): number => H / 2 - (y - vp.center.y) * ppu

  // ---- minor gridlines (skip indices that land on majors) -----------------
  ctx.lineWidth = GRID_MINOR_WIDTH * stroke
  ctx.strokeStyle = theme.gridMinor
  ctx.beginPath()
  {
    const k0 = Math.ceil(xMin / xMinor)
    const k1 = Math.floor(xMax / xMinor)
    for (let k = k0; k <= k1; k++) {
      if (((k % xStep.minorDiv) + xStep.minorDiv) % xStep.minorDiv === 0) continue
      const px = sx(k * xMinor)
      ctx.moveTo(px, 0)
      ctx.lineTo(px, H)
    }
    const j0 = Math.ceil(yMin / yMinor)
    const j1 = Math.floor(yMax / yMinor)
    for (let j = j0; j <= j1; j++) {
      if (((j % yStep.minorDiv) + yStep.minorDiv) % yStep.minorDiv === 0) continue
      const py = sy(j * yMinor)
      ctx.moveTo(0, py)
      ctx.lineTo(W, py)
    }
  }
  ctx.stroke()

  // ---- major gridlines (skip the axes; those get axis styling) ------------
  // A full step heavier than the minors: the ladder is weight + colour, so it
  // still reads when a projector has eaten the colour difference.
  ctx.lineWidth = GRID_MAJOR_WIDTH * stroke
  ctx.strokeStyle = theme.gridMajor
  ctx.beginPath()
  {
    const k0 = Math.ceil(xMin / xStep.major)
    const k1 = Math.floor(xMax / xStep.major)
    for (let k = k0; k <= k1; k++) {
      if (k === 0) continue
      const px = sx(k * xStep.major)
      ctx.moveTo(px, 0)
      ctx.lineTo(px, H)
    }
    const j0 = Math.ceil(yMin / yStep.major)
    const j1 = Math.floor(yMax / yStep.major)
    for (let j = j0; j <= j1; j++) {
      if (j === 0) continue
      const py = sy(j * yStep.major)
      ctx.moveTo(0, py)
      ctx.lineTo(W, py)
    }
  }
  ctx.stroke()

  // ---- axes with arrowheads ----------------------------------------------
  const axisX = sx(0) // screen x of the y-axis
  const axisY = sy(0) // screen y of the x-axis
  const yAxisVisible = axisX >= 0 && axisX <= W
  const xAxisVisible = axisY >= 0 && axisY <= H

  // The axis LINE is theme.axis; its number labels below are theme.label, a
  // step above it. Structure and annotation must never be the same value.
  ctx.strokeStyle = theme.axis
  ctx.fillStyle = theme.axis
  ctx.lineWidth = GRID_AXIS_WIDTH * stroke
  if (yAxisVisible) {
    ctx.beginPath()
    ctx.moveTo(axisX, H)
    ctx.lineTo(axisX, 0)
    ctx.stroke()
    // arrowheads: up (top edge) and down (bottom edge)
    ctx.beginPath()
    ctx.moveTo(axisX, 0)
    ctx.lineTo(axisX - ARROW_HALF, ARROW_LEN)
    ctx.lineTo(axisX + ARROW_HALF, ARROW_LEN)
    ctx.closePath()
    ctx.moveTo(axisX, H)
    ctx.lineTo(axisX - ARROW_HALF, H - ARROW_LEN)
    ctx.lineTo(axisX + ARROW_HALF, H - ARROW_LEN)
    ctx.closePath()
    ctx.fill()
  }
  if (xAxisVisible) {
    ctx.beginPath()
    ctx.moveTo(0, axisY)
    ctx.lineTo(W, axisY)
    ctx.stroke()
    // arrowheads: right and left edges
    ctx.beginPath()
    ctx.moveTo(W, axisY)
    ctx.lineTo(W - ARROW_LEN, axisY - ARROW_HALF)
    ctx.lineTo(W - ARROW_LEN, axisY + ARROW_HALF)
    ctx.closePath()
    ctx.moveTo(0, axisY)
    ctx.lineTo(ARROW_LEN, axisY - ARROW_HALF)
    ctx.lineTo(ARROW_LEN, axisY + ARROW_HALF)
    ctx.closePath()
    ctx.fill()
  }

  // ---- axis number labels -------------------------------------------------
  ctx.font = gridFont(fpx)
  ctx.fillStyle = theme.label

  // x labels: just below the x-axis, clamped to top/bottom edges when the
  // axis is off-screen (labels slide along the edge, Desmos-style).
  {
    const labelY = clamp(axisY + 5 * type, 4, H - fpx - 6)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const k0 = Math.ceil(xMin / xStep.major)
    const k1 = Math.floor(xMax / xStep.major)
    for (let k = k0; k <= k1; k++) {
      if (k === 0) continue
      const px = sx(k * xStep.major)
      const edge = Math.max(14, fpx + 3)
      if (px < edge || px > W - edge) continue // avoid arrowhead corners
      ctx.fillText(tickLabel(xStep, k), px, labelY)
    }
  }

  // y labels: just left of the y-axis, clamped to left/right edges.
  {
    ctx.textBaseline = 'middle'
    const j0 = Math.ceil(yMin / yStep.major)
    const j1 = Math.floor(yMax / yStep.major)
    for (let j = j0; j <= j1; j++) {
      if (j === 0) continue
      const py = sy(j * yStep.major)
      if (py < fpx + 1 || py > H - fpx - 1) continue
      const text = tickLabel(yStep, j)
      const tw = ctx.measureText(text).width
      // right-aligned against the axis, but never pushed off either edge
      const lx = clamp(axisX - 6, tw + 4, W - 4)
      ctx.textAlign = 'right'
      ctx.fillText(text, lx, py)
    }
  }

  // single "0" near the origin (only when the origin itself is on screen)
  if (axisX >= 0 && axisX <= W && axisY >= 0 && axisY <= H) {
    ctx.textAlign = 'right'
    ctx.textBaseline = 'top'
    ctx.fillText('0', axisX - 5 * type, axisY + 5 * type)
  }

  ctx.restore()
}

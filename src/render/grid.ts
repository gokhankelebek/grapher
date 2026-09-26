// ============================================================================
// src/render/grid.ts — Desmos-quality infinite grid + axes + labels.
// All drawing units are CSS pixels (ctx is already DPR-scaled by the caller).
// ============================================================================

import type { FigureStyle, Viewport, Theme } from '../core/types'
import { ppuX, ppuY } from '../core/types'

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

/**
 * The label for tick index `k` on whichever ladder `step` came from.
 *
 * Drawn with a true minus (U+2212), the glyph a textbook and a College Board
 * figure print; the formatters keep the ASCII hyphen so their strings stay
 * comparable and typeable, and the swap happens here, once, for both ladders.
 */
export function tickLabel(step: GridStep | PiStep, k: number): string {
  const s = isPiStep(step) ? formatPiTick(k * step.num, step.den) : formatTick(k * step.major)
  return displayTick(s)
}

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻',
}

/**
 * A tick label as it is DRAWN: a true minus, and scientific notation the way
 * a textbook writes it — "1.5×10⁸", not the "1.5e8" a population axis used to
 * print. The formatters keep ASCII so their strings stay comparable.
 */
function displayTick(s: string): string {
  const m = /^(-?)(\d+(?:\.\d+)?)e([+-]?\d+)(π?)$/.exec(s)
  let out = s
  if (m) {
    const exp = String(parseInt(m[3], 10)).replace(/[-0-9]/g, (c) => SUPERSCRIPT[c])
    const mant = m[2] === '1' ? '' : `${m[2]}×`
    out = `${m[1]}${mant}10${exp}${m[4]}`
  }
  return out.startsWith('-') ? `\u2212${out.slice(1)}` : out
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


// ---------------------------------------------------------------------------
// Figure styles — the grid's half of the LOOK (see FigureStyle in core/types).
//
// Everything below is opt-in: `drawGrid` without a style draws the screen
// board command for command, which is what the regression guard in
// tests/figureStyles.test.ts asserts.
// ---------------------------------------------------------------------------

/**
 * The part of a FigureStyle this layer reads. Declared as a Pick of the one
 * contract in core/types so the two can never drift; the ink and point
 * decisions belong to the curve and marker layers, not here.
 */
export interface GridStyle
  extends Pick<
    FigureStyle,
    'grid' | 'spacing' | 'numbers' | 'arrows' | 'axisNames' | 'originLabel' | 'font'
  > {
  /**
   * Paper reserved at the BOTTOM of the plot, in CSS px: the caption band.
   *
   * The caption is drawn inside the plot rect (that is the rect the export
   * clips to) and it is centred, which is exactly where the y-axis and its
   * tick numbers are. Measured: "Graph of f" knocked out the -4 on the y axis.
   * So the band is stated here and the labels step aside for it, the same way
   * they step aside for the axis names.
   *
   * Absent or 0 means no band, which is every board that has no caption.
   */
  bottomInset?: number
}

/** What "no style" means: today's board, stated out loud. */
export const SCREEN_GRID: GridStyle = {
  grid: 'lines',
  spacing: 'auto',
  numbers: 'major',
  arrows: 'four',
  axisNames: false,
  originLabel: false,
  font: 'sans',
}

const SANS_STACK = 'system-ui, -apple-system, "Segoe UI", sans-serif'
/** Times first: it is the face an SAT item and an AP free-response figure use. */
export const SERIF_STACK = '"Times New Roman", Times, Georgia, serif'

/**
 * The font EVERY on-board label goes through — tick numbers, the axis names,
 * the origin's O, shape labels, analysis chips and the caption.
 *
 * One function rather than one per layer: a figure whose ticks are Times and
 * whose chips are system-ui is not a figure in a style, it is two figures.
 * `italic` is for the things an exam figure italicises: the axis names, and
 * the AP caption.
 */
export function labelFont(
  style: { font?: 'sans' | 'serif' } | null | undefined,
  px: number,
  italic = false,
): string {
  const face = style?.font === 'serif' ? SERIF_STACK : SANS_STACK
  return `${italic ? 'italic ' : ''}${px}px ${face}`
}

/**
 * Below this many pixels a one-unit grid is a grey wash rather than a grid, so
 * `spacing: 'unit'` hands the decision back to the 1–2–5 ladder. It scales with
 * `present.stroke` because the lines themselves do: at 2x, 12px of gap holds
 * two 2px rules and 8px of paper, which is already the floor.
 */
export const UNIT_MIN_PX = 12

/** Total length of an axis tick mark, centred on the axis, before scaling. */
export const TICK_PX = 6

/** Gap a row of x labels needs beyond the widest label itself. */
const X_LABEL_GAP = 8
/** Gap a column of y labels needs, as a multiple of the type size. */
const Y_LABEL_GAP = 1.6

/** How a crowded unit row thins: every 2nd, 5th, 10th … label, never a 3rd. */
const THIN: readonly number[] = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]

/**
 * The fixed one-unit step an exam figure is ruled on: minors every unit,
 * majors every five.
 *
 * A π axis counts in π/2 instead — "one unit" of a trig axis is the quarter
 * turn a class actually writes down — so its minors land on π/2 and its majors
 * on π. Either way the ladder takes over once a unit is too narrow to be a
 * unit, so zooming out degrades to the same honest picture the screen shows.
 */
export function unitTickStep(
  pxPerUnit: number,
  minPx: number,
  pi: PiStep | null,
): GridStep | PiStep {
  if (pi) {
    return (Math.PI / 2) * pxPerUnit >= minPx
      ? { major: Math.PI, minorDiv: 2, num: 1, den: 1 }
      : pi
  }
  return pxPerUnit >= minPx ? { major: 5, minorDiv: 5 } : pickTickStep(pxPerUnit)
}

/** The label for MINOR index `m` on whichever ladder `step` came from. */
export function minorTickLabel(step: GridStep | PiStep, m: number): string {
  const s = isPiStep(step)
    ? formatPiTick(m * step.num, step.den * step.minorDiv)
    : formatTick(m * (step.major / step.minorDiv))
  return displayTick(s)
}

interface Tick {
  /** Math coordinate of the tick. */
  v: number
  text: string
}

/** The majors, exactly as the screen board labels them. */
function majorTicks(step: GridStep | PiStep, lo: number, hi: number): Tick[] {
  const out: Tick[] = []
  const k0 = Math.ceil(lo / step.major)
  const k1 = Math.floor(hi / step.major)
  for (let k = k0; k <= k1; k++) {
    if (k === 0) continue
    out.push({ v: k * step.major, text: tickLabel(step, k) })
  }
  return out
}

/**
 * Every unit tick, thinned by 2, 5 or 10 until adjacent labels cannot touch.
 *
 * `need` is the room one label demands along the axis — the widest glyph run
 * plus a gap for x, a line and a half for y. The thinning is UNIFORM: dropping
 * an awkward label here and there would leave a row whose spacing means
 * nothing, and a reader counts unlabelled ticks between numbers.
 */
function unitTicks(
  step: GridStep | PiStep,
  lo: number,
  hi: number,
  minorPx: number,
  need: (texts: readonly string[]) => number,
): Tick[] {
  const minor = step.major / step.minorDiv
  if (!(minor > 0) || !(minorPx > 0)) return []
  const m0 = Math.ceil(lo / minor - 1e-9)
  const m1 = Math.floor(hi / minor + 1e-9)
  if (m1 - m0 > 4000) return []
  const all: { m: number; text: string }[] = []
  for (let m = m0; m <= m1; m++) {
    if (m === 0) continue
    all.push({ m, text: minorTickLabel(step, m) })
  }
  if (all.length === 0) return []
  const room = need(all.map((t) => t.text))
  let f = THIN[THIN.length - 1]
  for (const cand of THIN) {
    if (cand * minorPx >= room) {
      f = cand
      break
    }
  }
  const out: Tick[] = []
  for (const t of all) {
    if (((t.m % f) + f) % f !== 0) continue
    out.push({ v: t.m * minor, text: t.text })
  }
  return out
}

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  theme: Theme,
  opts?: PaintScale | null,
  units?: AxisUnits | null,
  style?: GridStyle | null,
): void {
  const { type, stroke } = paintScale(opts)
  const st = style ?? SCREEN_GRID
  const fpx = LABEL_PX * type
  const W = vp.widthPx
  const H = vp.heightPx
  // One scale per axis. On an equal-axes board ppx === ppy and every value
  // below is the one the single-scale code computed, argument for argument.
  const ppx = ppuX(vp)
  const ppy = ppuY(vp)
  if (W <= 0 || H <= 0 || !(ppx > 0) || !(ppy > 0)) {
    ctx.fillStyle = theme.bg
    ctx.fillRect(0, 0, Math.max(0, W), Math.max(0, H))
    return
  }

  ctx.save()
  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, W, H)

  // One ladder per axis, each chosen from that axis' own pixels per unit: a
  // stretched board (years against millions) labels every 5 years along x and
  // every 100 000 along y. When the axes are equal and neither is in π both
  // sides hold the SAME object the old single-step code computed, so the
  // emitted command stream is unchanged down to the argument.
  const piMinPx = PI_LABEL_MIN_PX * type
  const unitMinPx = UNIT_MIN_PX * stroke
  const decimalX = pickTickStep(ppx)
  const decimalY = ppy === ppx ? decimalX : pickTickStep(ppy)
  const stepFor = (u: AxisUnit | undefined, ppu: number, decimal: GridStep): GridStep | PiStep => {
    const pi = u === 'pi' ? pickPiTickStep(ppu, piMinPx) : null
    if (st.spacing === 'unit') return unitTickStep(ppu, unitMinPx, pi)
    return pi ?? decimal
  }
  const xStep = stepFor(units?.x, ppx, decimalX)
  const yStep = stepFor(units?.y, ppy, decimalY)
  const xMinor = xStep.major / xStep.minorDiv
  const yMinor = yStep.major / yStep.minorDiv

  // visible math range
  const xMin = vp.center.x - W / 2 / ppx
  const xMax = vp.center.x + W / 2 / ppx
  const yMin = vp.center.y - H / 2 / ppy
  const yMax = vp.center.y + H / 2 / ppy

  const sx = (x: number): number => W / 2 + (x - vp.center.x) * ppx
  const sy = (y: number): number => H / 2 - (y - vp.center.y) * ppy

  if (st.grid === 'lines') {
    // ---- minor gridlines (skip indices that land on majors) ---------------
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

    // ---- major gridlines (skip the axes; those get axis styling) ----------
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
  }

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
    if (st.arrows !== 'none') {
      ctx.beginPath()
      ctx.moveTo(axisX, 0)
      ctx.lineTo(axisX - ARROW_HALF, ARROW_LEN)
      ctx.lineTo(axisX + ARROW_HALF, ARROW_LEN)
      ctx.closePath()
      if (st.arrows === 'four') {
        ctx.moveTo(axisX, H)
        ctx.lineTo(axisX - ARROW_HALF, H - ARROW_LEN)
        ctx.lineTo(axisX + ARROW_HALF, H - ARROW_LEN)
        ctx.closePath()
      }
      ctx.fill()
    }
  }
  if (xAxisVisible) {
    ctx.beginPath()
    ctx.moveTo(0, axisY)
    ctx.lineTo(W, axisY)
    ctx.stroke()
    // arrowheads: right and left edges
    if (st.arrows !== 'none') {
      ctx.beginPath()
      ctx.moveTo(W, axisY)
      ctx.lineTo(W - ARROW_LEN, axisY - ARROW_HALF)
      ctx.lineTo(W - ARROW_LEN, axisY + ARROW_HALF)
      ctx.closePath()
      if (st.arrows === 'four') {
        ctx.moveTo(0, axisY)
        ctx.lineTo(ARROW_LEN, axisY - ARROW_HALF)
        ctx.lineTo(ARROW_LEN, axisY + ARROW_HALF)
        ctx.closePath()
      }
      ctx.fill()
    }
  }

  // ---- tick marks ---------------------------------------------------------
  // The exam figure's grid: nothing across the page, a short mark on the axis
  // itself at every spacing step. Drawn in the axis ink and the axis weight —
  // a tick is part of the axis, not a survivor of the grid.
  if (st.grid === 'ticks') {
    const half = (TICK_PX * stroke) / 2
    ctx.strokeStyle = theme.axis
    ctx.lineWidth = GRID_AXIS_WIDTH * stroke
    ctx.beginPath()
    if (xAxisVisible && xMinor > 0) {
      const k0 = Math.ceil(xMin / xMinor - 1e-9)
      const k1 = Math.floor(xMax / xMinor + 1e-9)
      if (k1 - k0 <= 4000) {
        for (let k = k0; k <= k1; k++) {
          if (k === 0) continue
          const px = sx(k * xMinor)
          ctx.moveTo(px, axisY - half)
          ctx.lineTo(px, axisY + half)
        }
      }
    }
    if (yAxisVisible && yMinor > 0) {
      const j0 = Math.ceil(yMin / yMinor - 1e-9)
      const j1 = Math.floor(yMax / yMinor + 1e-9)
      if (j1 - j0 <= 4000) {
        for (let j = j0; j <= j1; j++) {
          if (j === 0) continue
          const py = sy(j * yMinor)
          ctx.moveTo(axisX - half, py)
          ctx.lineTo(axisX + half, py)
        }
      }
    }
    ctx.stroke()
  }

  // ---- axis number labels -------------------------------------------------
  ctx.font = labelFont(st, fpx)
  ctx.fillStyle = theme.label

  // Room the axis NAMES need at the far ends. Measured: at 1x the +x tip had
  // "7" and an italic "x" four pixels apart, which reads as one token, "7x".
  // The name owns the tip; the last number steps aside.
  const nameGap = st.axisNames ? 2.4 * fpx : 0
  const inset =
    typeof st.bottomInset === 'number' && Number.isFinite(st.bottomInset) && st.bottomInset > 0
      ? st.bottomInset
      : 0

  // x labels: just below the x-axis, clamped to top/bottom edges when the
  // axis is off-screen (labels slide along the edge, Desmos-style).
  {
    const labelY = clamp(axisY + 5 * type, 4, Math.max(4, H - fpx - 6 - inset))
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const ticks =
      st.numbers === 'unit'
        ? unitTicks(xStep, xMin, xMax, xMinor * ppx, (texts) => {
            let w = 0
            for (const t of texts) w = Math.max(w, ctx.measureText(t).width)
            return w + X_LABEL_GAP * type
          })
        : majorTicks(xStep, xMin, xMax)
    for (const t of ticks) {
      const px = sx(t.v)
      const edge = Math.max(14, fpx + 3)
      if (px < edge || px > W - edge - nameGap) continue // arrowheads and the x name
      ctx.fillText(t.text, px, labelY)
    }
  }

  // y labels: just left of the y-axis, clamped to left/right edges.
  {
    ctx.textBaseline = 'middle'
    const ticks =
      st.numbers === 'unit'
        ? unitTicks(yStep, yMin, yMax, yMinor * ppy, () => fpx * Y_LABEL_GAP)
        : majorTicks(yStep, yMin, yMax)
    for (const t of ticks) {
      const py = sy(t.v)
      if (py < fpx + 1 + nameGap || py > H - fpx - 1 - inset) continue
      const text = t.text
      const tw = ctx.measureText(text).width
      // right-aligned against the axis, but never pushed off either edge
      const lx = clamp(axisX - 6, tw + 4, W - 4)
      ctx.textAlign = 'right'
      ctx.fillText(text, lx, py)
    }
  }

  // The origin. An exam figure writes "O" beside it and no zero at all: a
  // figure that prints both has said the same thing twice in two alphabets.
  if (axisX >= 0 && axisX <= W && axisY >= 0 && axisY <= H) {
    ctx.textAlign = 'right'
    ctx.textBaseline = 'top'
    if (st.originLabel) {
      ctx.font = labelFont(st, fpx, st.font === 'serif')
      ctx.fillText('O', axisX - 5 * type, axisY + 4 * type)
      ctx.font = labelFont(st, fpx)
    } else {
      ctx.fillText('0', axisX - 5 * type, axisY + 5 * type)
    }
  }

  // ---- axis names ---------------------------------------------------------
  // Italic, at the arrow tips, in the figure's own face: x below-right of the
  // +x tip, y left of the +y tip — where College Board prints them.
  if (st.axisNames) {
    ctx.font = labelFont(st, fpx, true)
    ctx.fillStyle = theme.label
    if (xAxisVisible) {
      ctx.textAlign = 'right'
      ctx.textBaseline = 'top'
      ctx.fillText('x', W - 3 * type, clamp(axisY + 4 * type, 2, H - fpx - 2))
    }
    if (yAxisVisible) {
      ctx.textAlign = 'right'
      ctx.textBaseline = 'top'
      ctx.fillText('y', clamp(axisX - 6 * type, fpx, W - 2), 2 * type)
    }
  }

  ctx.restore()
}

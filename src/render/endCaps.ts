// ============================================================================
// src/render/endCaps.ts — what the ends of a drawn graph SAY.
//
// A textbook, SAT or AP figure never leaves a curve trailing off the paper
// unmarked. It says one of four things at each end:
//
//   arrow   the graph continues beyond the board
//   closed  the graph stops here, and this point belongs to it
//   open    the graph stops here, and this point does not
//   none    the screen's answer: say nothing
//
// The two ends are independent, because a half-open interval has one of each.
//
// Three separate questions, deliberately kept apart:
//
//   resolveEnds()    WHICH cap each end wants — the teacher's choice, or the
//                    figure style's default for 'auto'. Pure, no geometry.
//   curveEndPoints() WHERE the two ends are and which way the graph was
//                    going there. Pure, no ink.
//   drawCurveEnds()  the ink.
//
// The first two are exported so a card control, a hit test or a test can ask
// the same questions the renderer asks, and get the renderer's own answer.
// ============================================================================

import type {
  CurveEnds,
  EndCap,
  FigureStyle,
  FittedCurve,
  ModelSpec,
  Vec2,
  Viewport,
} from '../core/types'
import type { CurveTrace } from './curves'
import { traceCurve } from './curves'
import { arrowGeometry } from './shapes'

const TWO_PI = Math.PI * 2

// ---------------------------------------------------------------------------
// Geometry, in CSS px before presentation scaling.
// ---------------------------------------------------------------------------

/** Arrowhead length, tip to base, × present.stroke. */
export const END_ARROW_LEN = 11
/** Dot radius, × present.stroke. Same disc an exam figure marks a point with. */
export const END_DOT_R = 3.5
/** The open dot's ink ring, × present.stroke. */
export const END_OPEN_RING = 1.6
/** The closed dot's ground ring, drawn OUTSIDE the disc, × present.stroke. */
export const END_CLOSED_RING = 1.5
/** Samples averaged into the outgoing direction, so a noisy fit cannot jitter it. */
const DIR_SAMPLES = 3
/** A sample this close to the board edge counts as on the board. */
const EDGE_TOL = 1e-6
/** Two ends closer than this are the same point: a closed loop, not two ends. */
const LOOP_TOL = 1

// ---------------------------------------------------------------------------
// 1. Which cap
// ---------------------------------------------------------------------------

/** An `EndCap` with 'auto' already spent. */
export type ResolvedCap = 'none' | 'arrow' | 'open' | 'closed'

export interface ResolvedEnds {
  start: ResolvedCap
  end: ResolvedCap
  /**
   * True where the cap came from the figure default rather than from the
   * teacher. An automatic cap is still allowed to change its mind once the
   * geometry is known — 'closed' was the guess for a domain end, and a domain
   * end that turns out to lie off the board is a run-off, which is an arrow.
   * A cap the teacher NAMED never changes: 'closed' asked for is 'closed'.
   */
  startAuto: boolean
  endAuto: boolean
}

/**
 * What an 'auto' end resolves to once the GEOMETRY is known — which is the
 * only place the whole answer lives.
 *
 * An end that runs off the board is an arrow whatever the domain said; a
 * declared domain end on the board is a closed dot; a natural endpoint is the
 * dot its own nature asks for, filled where the formula has a value there and
 * hollow where it only has a limit.
 */
function autoCap(p: CurveEndPoint): ResolvedCap {
  if (p.kind === 'exit') return 'arrow'
  if (p.kind === 'natural') return p.closed ? 'closed' : 'open'
  return 'closed'
}

/** A finite, ordered domain, or null. */
function finiteDomain(curve: FittedCurve): [number, number] | null {
  const d = curve.domain
  if (!d || !Number.isFinite(d[0]) || !Number.isFinite(d[1]) || !(d[1] > d[0])) return null
  return [d[0], d[1]]
}

/**
 * The cap each end of this curve asks for.
 *
 * 'auto' (and absent, which is the same thing) means: let the figure decide.
 * A 'marked' figure — textbook, SAT, AP — arrows an end that runs off the
 * board and closes a domain end; the screen figure, and no figure at all,
 * say nothing, exactly as the board did before end caps existed.
 *
 * An implicit curve (a circle, an ellipse) is a closed level set: it has no
 * first point and no last one, so there is nothing for a cap to mark, and it
 * gets 'none' whatever anyone asks for.
 *
 * `points` is optional and is the difference between a guess and an answer.
 * Without it the domain is all this function knows, so 'auto' guesses from the
 * domain alone and `startAuto` / `endAuto` warn the caller that the guess is
 * still open to the geometry. Hand it `curveEndPoints(...)` — as the renderer
 * effectively does — and every 'auto' is settled here: an arrow where the
 * graph runs off, a closed dot at a domain end or at a natural endpoint that
 * has its own value, an open dot at one that has only a limit.
 */
export function resolveEnds(
  style: { ends?: CurveEnds } | null | undefined,
  curve: FittedCurve,
  figure: FigureStyle | null | undefined,
  points?: CurveEndPoints | null,
): ResolvedEnds {
  if (curve.kind === 'implicit') {
    return { start: 'none', end: 'none', startAuto: false, endAuto: false }
  }
  const marked = figure != null && figure.curveEnds === 'marked'
  const dom = finiteDomain(curve)
  const one = (
    asked: EndCap | undefined, at: CurveEndPoint | null | undefined,
  ): [ResolvedCap, boolean] => {
    if (asked && asked !== 'auto') return [asked, false]
    if (!marked) return ['none', true]
    if (points) return [at ? autoCap(at) : 'none', true]
    return [dom !== null ? 'closed' : 'arrow', true]
  }
  const [start, startAuto] = one(style?.ends?.start, points?.start)
  const [end, endAuto] = one(style?.ends?.end, points?.end)
  return { start, end, startAuto, endAuto }
}

// ---------------------------------------------------------------------------
// 2. Where the ends are
// ---------------------------------------------------------------------------

export interface CurveEndPoint {
  /** Where the cap sits, in screen px. */
  at: Vec2
  /** Unit OUTGOING direction in screen px — away from the curve. */
  dir: Vec2
  /**
   * 'domain'  — the curve's own DECLARED interval stops here, on the board.
   * 'natural' — the formula itself stops here with a finite value: sqrt(x) at
   *             (0, 0), sqrt(4 - x^2) at (±2, 0), arcsin x at (±1, ±π/2). An
   *             end just as real as a declared one, and marked the same way.
   *             A POLE — 1/x, ln x, tan x, 1/sqrt(x) — is not one of these and
   *             never appears here: it is not an end, and gets no cap.
   * 'exit'    — the graph left the visible board here and keeps going.
   */
  kind: 'domain' | 'natural' | 'exit'
  /**
   * For 'natural' only: the formula has a VALUE at the boundary (a closed dot)
   * rather than merely a limit (an open one). sqrt(0) = 0 closes; a removable
   * hole, where the limit exists and the value does not, opens.
   */
  closed?: boolean
}

export interface CurveEndPoints {
  /** The lower-x (lower-t, lower-θ) end, or null if it has none on the board. */
  start: CurveEndPoint | null
  /** The upper end. */
  end: CurveEndPoint | null
}

const NO_ENDS: CurveEndPoints = { start: null, end: null }

function unit(x: number, y: number): Vec2 | null {
  const l = Math.hypot(x, y)
  if (!(l > 1e-9) || !Number.isFinite(l)) return null
  return { x: x / l, y: y / l }
}

/**
 * The outgoing direction at `at`, averaged over the few samples behind it.
 *
 * One chord is the tangent plus whatever noise the last sample carries; a
 * hand-fitted curve near a steep exit can swing that chord by degrees between
 * frames, and an arrowhead that swings with it reads as a wobble. Averaging
 * the unit chords from the last few samples costs nothing and holds still.
 */
function smoothDir(
  at: Vec2, run: readonly { x: number; y: number }[], from: number, step: number,
): Vec2 | null {
  let sx = 0
  let sy = 0
  let used = 0
  for (let k = 0; k < DIR_SAMPLES; k++) {
    const i = from + k * step
    if (i < 0 || i >= run.length) break
    const u = unit(at.x - run[i].x, at.y - run[i].y)
    if (!u) continue
    sx += u.x
    sy += u.y
    used++
  }
  if (used === 0) return null
  return unit(sx, sy)
}

/**
 * Where a segment that starts inside the board and ends outside it crosses the
 * edge. `a` is the inside point; the returned point is ON the rect.
 */
function edgeCrossing(a: Vec2, b: Vec2, w: number, h: number): Vec2 {
  const dx = b.x - a.x
  const dy = b.y - a.y
  let s = 1
  if (dx > 0) s = Math.min(s, (w - a.x) / dx)
  else if (dx < 0) s = Math.min(s, -a.x / dx)
  if (dy > 0) s = Math.min(s, (h - a.y) / dy)
  else if (dy < 0) s = Math.min(s, -a.y / dy)
  if (!(s >= 0)) s = 0
  if (!(s <= 1)) s = 1
  return { x: a.x + dx * s, y: a.y + dy * s }
}

/**
 * The two ends of a curve as drawn: where each one sits and which way the
 * graph was heading there.
 *
 * The rules, in the order they matter:
 *
 *  - A curve whose interval stops ON the board ends at that point — that is
 *    where a dot goes, and an arrow asked for there still points along the
 *    outgoing tangent.
 *  - Otherwise the end is where the graph crosses off the visible board, and
 *    the direction points out of it.
 *  - A graph that leaves and comes back — a cubic that dips out of the bottom
 *    and returns — is marked at its OUTERMOST exits only: the lowest-t
 *    departure and the highest-t one. Every crossing in between is the middle
 *    of the graph, not an end of it.
 *  - A run that simply STOPS on the board is one of two things, and only the
 *    formula can say which. Where the values settle on a finite limit it is a
 *    NATURAL endpoint — sqrt(x) at (0, 0), sqrt(4 - x^2) at (±2, 0), arcsin x
 *    at (±1, ±π/2) — and it is an end exactly like a declared domain end,
 *    down to the dot. Where the values run away it is a POLE — 1/x, ln x,
 *    tan x, 1/sqrt(x) — and a pole is not an end: nothing is drawn there.
 *  - A natural endpoint counts only where it is the OUTERMOST defined point.
 *    The hole in the middle of a graph is a hole, not an end.
 *  - Implicit curves have no ends at all, and neither does a closed loop whose
 *    two ends are the same point.
 *
 * Screen px throughout; pure, so a card control and a test can ask it too.
 */
export function curveEndPoints(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  vp: Viewport,
): CurveEndPoints {
  let trace: CurveTrace | null = null
  try {
    trace = traceCurve(curve, models, vp)
  } catch {
    return NO_ENDS
  }
  if (!trace || trace.runs.length === 0) return NO_ENDS

  const w = vp.widthPx
  const h = vp.heightPx
  const on = (p: { x: number; y: number }): boolean =>
    p.x >= -EDGE_TOL && p.x <= w + EDGE_TOL && p.y >= -EDGE_TOL && p.y <= h + EDGE_TOL

  const side = (lower: boolean): CurveEndPoint | null => {
    const step = lower ? 1 : -1
    const runs = trace!.runs
    const n = runs.length
    for (let k = 0; k < n; k++) {
      const idx = lower ? k : n - 1 - k
      const run = runs[idx]
      const m = run.length
      // the outermost sample of this run that is actually on the board
      let i = -1
      for (let j = lower ? 0 : m - 1; j >= 0 && j < m; j += step) {
        if (on(run[j])) { i = j; break }
      }
      if (i < 0) continue // this run never shows: try the next one inward

      const outer = i - step // the sample just OUTSIDE, if there is one
      if (outer >= 0 && outer < m) {
        const at = edgeCrossing(run[i], run[outer], w, h)
        const dir =
          smoothDir(at, run, i, step) ?? unit(run[outer].x - run[i].x, run[outer].y - run[i].y)
        return dir ? { at, dir, kind: 'exit' } : null
      }

      // The run begins (or ends) on the board. Three things it can be:
      // the curve's own declared interval stopping, the formula's own domain
      // stopping with a finite value, or a pole. Only the last is not an end.
      const first = run[i]
      const isSpanEnd = lower ? first.t === trace!.t0 : first.t === trace!.t1
      const atDomain = lower ? trace!.atDomain0 : trace!.atDomain1
      // A point with no direction is a one-sample run: the dot still belongs
      // there, and only an arrow needs somewhere to point.
      const dir = smoothDir(first, run, i + step, step) ?? { x: step, y: 0 }
      if (isSpanEnd && atDomain) {
        return { at: { x: first.x, y: first.y }, dir, kind: 'domain' }
      }
      // Refine the boundary rather than settling for the last sample: the last
      // sample of sqrt(x) sits a sampling step short of (0, 0), and a dot a
      // step short of the origin is a dot in the wrong place. The refinement
      // lands on the boundary itself, exactly where the formula is written.
      const nat = lower ? trace!.naturalStart(idx) : trace!.naturalEnd(idx)
      if (nat && on(nat)) {
        return { at: { x: nat.x, y: nat.y }, dir, kind: 'natural', closed: nat.closed }
      }
      return null
    }
    return null
  }

  const start = side(true)
  const end = side(false)
  // A closed loop given a domain — a parametric circle over [0, 2π] — has two
  // ends at one point. Two dots stacked on the rim of a circle is a mark no
  // figure has ever carried, and it is not what the domain meant.
  if (
    start && end && start.kind !== 'exit' && end.kind !== 'exit' &&
    Math.hypot(start.at.x - end.at.x, start.at.y - end.at.y) <= LOOP_TOL
  ) {
    return NO_ENDS
  }
  return { start, end }
}

// ---------------------------------------------------------------------------
// 3. The ink
// ---------------------------------------------------------------------------

export interface EndCapPaint {
  /** The curve's ink — already print-mapped, already mono where mono applies. */
  color: string
  /** The ground, for the open dot's fill and the closed dot's ring. */
  bg: string
  /** Presentation scale on line weight (BoardScene.present.stroke). */
  stroke: number
  /** The width the curve itself is stroked at, in CSS px. */
  width: number
}

function drawArrow(ctx: CanvasRenderingContext2D, p: CurveEndPoint, paint: EndCapPaint): void {
  const len = END_ARROW_LEN * paint.stroke
  const tip = p.at
  const tail = { x: tip.x - p.dir.x * len, y: tip.y - p.dir.y * len }
  const geo = arrowGeometry(tail, tip, len)
  if (!geo) return
  ctx.beginPath()
  ctx.moveTo(tip.x, tip.y)
  ctx.lineTo(geo.w1.x, geo.w1.y)
  ctx.lineTo(geo.w2.x, geo.w2.y)
  ctx.closePath()
  // The curve runs under the head and would poke out past the tip — a blunt,
  // double-pointed arrow. Stroking the head in the GROUND at the curve's own
  // width first takes that stroke away, and the fill then lands on clean paper.
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.lineWidth = paint.width
  ctx.strokeStyle = paint.bg
  ctx.stroke()
  ctx.fillStyle = paint.color
  ctx.fill()
}

function drawDot(
  ctx: CanvasRenderingContext2D, p: CurveEndPoint, closed: boolean, paint: EndCapPaint,
): void {
  const r = END_DOT_R * paint.stroke
  if (closed) {
    // A ground ring OUTSIDE the disc: on a ruled figure a black dot sitting on
    // a black gridline is a thickening, not a point. The ring separates it.
    const ring = END_CLOSED_RING * paint.stroke
    ctx.beginPath()
    ctx.arc(p.at.x, p.at.y, r + ring / 2, 0, TWO_PI)
    ctx.lineWidth = ring
    ctx.strokeStyle = paint.bg
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(p.at.x, p.at.y, r, 0, TWO_PI)
    ctx.fillStyle = paint.color
    ctx.fill()
    return
  }
  ctx.beginPath()
  ctx.arc(p.at.x, p.at.y, r, 0, TWO_PI)
  ctx.fillStyle = paint.bg
  ctx.fill()
  ctx.lineWidth = END_OPEN_RING * paint.stroke
  ctx.strokeStyle = paint.color
  ctx.stroke()
}

function drawOne(
  ctx: CanvasRenderingContext2D,
  p: CurveEndPoint | null,
  cap: ResolvedCap,
  auto: boolean,
  paint: EndCapPaint,
): void {
  if (!p || cap === 'none') return
  // The automatic guess was made from the domain alone; the geometry knows
  // better. A domain end that fell off the board is a run-off, and a run-off
  // is an arrow; a natural endpoint the domain never mentioned is a dot.
  const c = auto ? autoCap(p) : cap
  if (!Number.isFinite(p.at.x) || !Number.isFinite(p.at.y)) return
  if (c === 'arrow') drawArrow(ctx, p, paint)
  else drawDot(ctx, p, c === 'closed', paint)
}

/**
 * Draw both end caps of one curve.
 *
 * FIGURE, not chrome: this runs with `chrome: null` too, so the caps reach the
 * exported PNG. They scale with `present.stroke` like every other line weight.
 */
export function drawCurveEnds(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  ends: ResolvedEnds,
  paint: EndCapPaint,
): void {
  if (ends.start === 'none' && ends.end === 'none') return
  if (vp.widthPx <= 0 || vp.heightPx <= 0 || !(vp.pxPerUnit > 0)) return
  const pts = curveEndPoints(curve, models, vp)
  if (!pts.start && !pts.end) return
  ctx.save()
  try {
    drawOne(ctx, pts.start, ends.start, ends.startAuto, paint)
    drawOne(ctx, pts.end, ends.end, ends.endAuto, paint)
  } finally {
    ctx.restore()
  }
}

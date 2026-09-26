// ============================================================================
// src/render/curves.ts — curve + ink rendering.
// All drawing units are CSS pixels (ctx is already DPR-scaled by the caller).
//
// drawCurve dispatches on curve.kind:
//   explicit / parametric / polar → adaptive sampling (uniform base pass,
//     recursive bisection where the midpoint deviates from the chord),
//     asymptote / discontinuity breaking, generous clipping.
//   implicit → marching squares on a coarse grid with linearly interpolated
//     + bisection-refined edge crossings, plus a midpoint "snap" pass so
//     circles/ellipses stay smooth at any zoom.
// ============================================================================

import type { Vec2, Viewport, FittedCurve, ModelSpec } from '../core/types'
import { ppuX, ppuY } from '../core/types'

const TWO_PI = Math.PI * 2
const DEFAULT_STROKE = 2.5
const CHORD_TOL_PX = 0.25 // max midpoint-to-chord deviation before bisecting
const MAX_DEPTH = 8       // recursion cap for adaptive bisection
const BASE_SAMPLES = 160  // uniform samples across the span before refinement

// ---------------------------------------------------------------------------
// Shared scratch (module-level, reused across calls — no per-sample allocs).
// ---------------------------------------------------------------------------

/** One evaluation: the screen point, and whether the formula had a value. */
export interface Sample { x: number; y: number; ok: boolean }
const SCR: Sample = { x: 0, y: 0, ok: false }

/** A curve's evaluator, parameter in, screen px out. Writes into `out`. */
export type EvalToScreen = (t: number, out: Sample) => void

/**
 * Where a sampled polyline goes. `Path2D` satisfies it structurally, and so
 * does a plain collector that keeps the points — which is how the area overlay
 * gets the SAME adaptive, pole-broken boundary the stroke is drawn from
 * instead of a second sampler that would disagree with it.
 */
export interface PolylineSink {
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
}

/** Polyline emitter writing into a sink with pen-up/pen-down state. */
interface Emitter {
  path: PolylineSink
  f: EvalToScreen  // the curve being sampled — the break probe re-evaluates it
  has: boolean     // a previous finite sample exists
  penDown: boolean // the path's current point IS that sample (it was in-box)
  drawn: boolean   // at least one segment was emitted
  lastT: number
  lastX: number
  lastY: number
  suspectPx: number // gap this large is ambiguous → probe before joining
  cx0: number       // clip box (generous ±1 viewport of overdraw)
  cx1: number
  cy0: number
  cy1: number
  /**
   * Optional listener on every finite sample, BEFORE the clip.
   *
   * The stroke is clipped to the overdraw box and carries no parameter value,
   * so it cannot answer "where does this graph leave the board, and along what
   * tangent" — which is the whole question an end cap asks. The tap is the one
   * place that can: it sees each sample with its t, and `newRun` is true
   * exactly where the pen was lifted, so a tapped trace is broken at the SAME
   * poles the stroke is broken at. Null for every ordinary paint.
   */
  tap: ((t: number, x: number, y: number, newRun: boolean) => void) | null
  /**
   * Optional listener on every crossing between the defined and the undefined,
   * in either direction: `def` is the parameter of the last sample that had a
   * finite value, `und` the first that did not (or the other way round when
   * the graph comes BACK, where `def` is the first finite sample again). The
   * pair brackets the boundary; who the boundary is — a natural endpoint like
   * sqrt(x) at 0, or a pole like 1/x at 0 — is a question only the evaluator
   * can answer, and `classifyEdge` asks it. Fires just before the `tap` that
   * opens the new run, so a run and its edges arrive together. Null for every
   * ordinary paint.
   */
  edge: ((def: number, und: number, entering: boolean) => void) | null
  /** The most recent NON-finite sample, for the run that comes back after it. */
  badT: number
  hasBad: boolean
}

// path/f are assigned by resetEmitter before any use; kept unset here so merely
// importing this module never touches DOM globals (tests, SSR).
const EM: Emitter = {
  path: undefined as unknown as PolylineSink,
  f: undefined as unknown as EvalToScreen,
  has: false,
  penDown: false,
  drawn: false,
  lastT: 0,
  lastX: 0,
  lastY: 0,
  suspectPx: 0,
  cx0: 0, cx1: 0, cy0: 0, cy1: 0,
  tap: null,
  edge: null,
  badT: 0,
  hasBad: false,
}

function resetEmitter(
  em: Emitter, path: PolylineSink, f: EvalToScreen, vp: Viewport,
): void {
  em.path = path
  em.f = f
  em.has = false
  em.penDown = false
  em.drawn = false
  em.lastT = 0
  em.lastX = 0
  em.lastY = 0
  em.suspectPx = 2 * vp.heightPx
  em.cx0 = -vp.widthPx
  em.cx1 = 2 * vp.widthPx
  em.cy0 = -vp.heightPx
  em.cy1 = 2 * vp.heightPx
  em.tap = null
  em.edge = null
  em.badT = 0
  em.hasBad = false
}

// ---------------------------------------------------------------------------
// Discontinuity test.
//
// A large screen-space gap between adjacent samples is ambiguous: either a
// pole/jump (lift the pen) or a perfectly finite curve that is merely very
// steep (keep the pen down). Canvas height cannot tell those apart — judging by
// a fixed fraction of it silently deleted every line whose on-screen slope
// exceeded ~2*H*BASE_SAMPLES/W, so y = 300x rendered as nothing at all.
//
// Ask the function instead. Bisect the parameter interval, always descending
// into the half that still carries the larger screen-space span. Under
// refinement a continuous piece collapses geometrically — its span halves at
// every step — while a pole holds or grows its span (values blow up faster than
// the interval shrinks) and a jump discontinuity holds its span forever. A gap
// that has not collapsed to a drawable step within PROBE_STEPS halvings is a
// discontinuity. Cost is O(PROBE_STEPS) evals, paid only by suspicious gaps.
// ---------------------------------------------------------------------------

const PROBE_STEPS = 40 // resolves slopes past 1e9 px/px before giving up
const JOIN_PX = 8      // span at which the remaining gap is a drawable step
const PROBE: Sample = { x: 0, y: 0, ok: false }

function isDiscontinuity(
  f: EvalToScreen,
  ta: number, xa: number, ya: number,
  tb: number, xb: number, yb: number,
): boolean {
  let aT = ta, aX = xa, aY = ya
  let bT = tb, bX = xb, bY = yb
  for (let i = 0; i < PROBE_STEPS; i++) {
    const mT = (aT + bT) / 2
    // interval collapsed to floating-point resolution with the gap still open
    if (mT === aT || mT === bT) return true
    f(mT, PROBE)
    const mX = PROBE.x
    const mY = PROBE.y
    if (!PROBE.ok || !Number.isFinite(mX) || !Number.isFinite(mY)) return true
    const lo = Math.hypot(mX - aX, mY - aY)
    const hi = Math.hypot(bX - mX, bY - mY)
    let span: number
    if (lo >= hi) { bT = mT; bX = mX; bY = mY; span = lo }
    else { aT = mT; aX = mX; aY = mY; span = hi }
    if (span <= JOIN_PX) return false // collapsed: continuous, just steep
  }
  return true
}

// ---------------------------------------------------------------------------
// Segment emission, clipped to the overdraw box.
//
// Clipping the SEGMENT (Liang–Barsky) rather than clamping each coordinate on
// its own matters now that near-vertical lines actually draw: independent
// clamping bends a steep chord toward the box corner and shifts where it
// crosses the canvas, while clipping keeps the drawn geometry exactly on the
// true chord and merely trims its ends.
// ---------------------------------------------------------------------------

function drawSeg(
  em: Emitter, x0: number, y0: number, x1: number, y1: number,
): void {
  const dx = x1 - x0
  const dy = y1 - y0
  let t0 = 0
  let t1 = 1
  for (let e = 0; e < 4; e++) {
    const p = e === 0 ? -dx : e === 1 ? dx : e === 2 ? -dy : dy
    const q = e === 0 ? x0 - em.cx0 : e === 1 ? em.cx1 - x0
      : e === 2 ? y0 - em.cy0 : em.cy1 - y0
    if (p === 0) {
      if (q < 0) { em.penDown = false; return } // parallel to and outside it
      continue
    }
    const r = q / p
    if (p < 0) {
      if (r > t1) { em.penDown = false; return }
      if (r > t0) t0 = r
    } else {
      if (r < t0) { em.penDown = false; return }
      if (r < t1) t1 = r
    }
  }
  if (t0 > 0 || !em.penDown) {
    // use the exact endpoint when nothing was trimmed, so consecutive
    // segments share bit-identical join coordinates
    em.path.moveTo(t0 > 0 ? x0 + dx * t0 : x0, t0 > 0 ? y0 + dy * t0 : y0)
  }
  em.path.lineTo(t1 < 1 ? x0 + dx * t1 : x1, t1 < 1 ? y0 + dy * t1 : y1)
  em.drawn = true
  em.penDown = t1 >= 1
}

function emitPoint(em: Emitter, t: number, x: number, y: number, ok: boolean): void {
  if (!ok || !Number.isFinite(x) || !Number.isFinite(y)) {
    // defined -> undefined. em.lastT still holds the last FINITE parameter,
    // which is the near side of the boundary this sample is the far side of.
    if (em.has && em.edge) em.edge(em.lastT, t, false)
    em.badT = t
    em.hasBad = true
    em.has = false
    em.penDown = false
    return
  }
  const had = em.has
  let broken = false
  if (had) {
    const px = em.lastX
    const py = em.lastY
    const dx = x - px
    const dy = y - py
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
      broken = true // a gap too wide to even subtract is a pole by construction
    } else if (Math.abs(dy) > em.suspectPx || Math.abs(dx) > em.suspectPx) {
      // Only pay for the probe when the gap could put ink on the canvas: a gap
      // that stays off one side of the box is invisible whichever way it goes.
      const offSameSide =
        (py < em.cy0 && y < em.cy0) || (py > em.cy1 && y > em.cy1) ||
        (px < em.cx0 && x < em.cx0) || (px > em.cx1 && x > em.cx1)
      if (!offSameSide) broken = isDiscontinuity(em.f, em.lastT, px, py, t, x, y)
    }
    if (broken) em.penDown = false
    else drawSeg(em, px, py, x, y)
  }
  // undefined -> defined, on the way back in. The break is a pen lift either
  // way; only the edge tap can tell a boundary that has a point from one that
  // has an asymptote.
  if (!had && em.hasBad && em.edge) em.edge(t, em.badT, true)
  em.hasBad = false
  if (em.tap) em.tap(t, x, y, !had || broken)
  em.has = true
  em.lastT = t
  em.lastX = x
  em.lastY = y
}

// ---------------------------------------------------------------------------
// Adaptive sampling: uniform base pass + recursive bisection on chord error.
// ---------------------------------------------------------------------------

function refine(
  em: Emitter, f: EvalToScreen,
  ta: number, xa: number, ya: number, oka: boolean,
  tb: number, xb: number, yb: number, okb: boolean,
  depth: number,
): void {
  if (depth <= 0) {
    emitPoint(em, tb, xb, yb, okb)
    return
  }
  const tm = (ta + tb) / 2
  f(tm, SCR)
  const xm = SCR.x
  const ym = SCR.y
  const okm = SCR.ok

  let split = false
  if (oka && okb && okm) {
    const dx = xb - xa
    const dy = yb - ya
    const l2 = dx * dx + dy * dy
    let dev: number
    if (l2 < 1e-12) {
      dev = Math.hypot(xm - xa, ym - ya)
    } else {
      dev = Math.abs(dy * (xm - xa) - dx * (ym - ya)) / Math.sqrt(l2)
    }
    split = dev > CHORD_TOL_PX
  } else if (oka !== okm || okm !== okb) {
    split = true // localize the boundary of the defined region
  }

  if (!split) {
    emitPoint(em, tb, xb, yb, okb)
    return
  }
  refine(em, f, ta, xa, ya, oka, tm, xm, ym, okm, depth - 1)
  refine(em, f, tm, xm, ym, okm, tb, xb, yb, okb, depth - 1)
}

function sampleAdaptive(
  em: Emitter,
  f: EvalToScreen,
  t0: number,
  t1: number,
  vp: Viewport,
): void {
  if (!(t1 > t0)) return
  const offX0 = -vp.widthPx
  const offX1 = 2 * vp.widthPx
  const offY0 = -vp.heightPx
  const offY1 = 2 * vp.heightPx

  f(t0, SCR)
  let pt = t0
  let px = SCR.x
  let py = SCR.y
  let pok = SCR.ok
  emitPoint(em, pt, px, py, pok)

  const inv = (t1 - t0) / BASE_SAMPLES
  for (let i = 1; i <= BASE_SAMPLES; i++) {
    const t = i === BASE_SAMPLES ? t1 : t0 + inv * i
    f(t, SCR)
    const x = SCR.x
    const y = SCR.y
    const ok = SCR.ok

    // fully-off segment (both endpoints beyond ±1 viewport on the same side):
    // skip refinement, emit endpoint directly.
    const bothOff =
      pok && ok &&
      ((py < offY0 && y < offY0) || (py > offY1 && y > offY1) ||
       (px < offX0 && x < offX0) || (px > offX1 && x > offX1))
    if (bothOff) {
      emitPoint(em, t, x, y, ok)
    } else {
      refine(em, f, pt, px, py, pok, t, x, y, ok, MAX_DEPTH)
    }
    pt = t
    px = x
    py = y
    pok = ok
  }
}

// ---------------------------------------------------------------------------
// Kind-specific path builders.
// ---------------------------------------------------------------------------

/**
 * The parameter span a curve is sampled over, and the evaluator that turns a
 * parameter into a screen point.
 *
 * Split out of the three builders because the END of a graph is a question
 * about this span and nothing else: whether t0 is the curve's own domain end
 * (a dot belongs there) or merely where the board runs out (an arrow does).
 * Two answers derived from two copies of this arithmetic would eventually
 * disagree, and the disagreement would be a cap drawn in the wrong place.
 */
interface CurveSpan {
  f: EvalToScreen
  t0: number
  t1: number
  /** True when t0 / t1 IS the curve's own declared domain end. */
  atDomain0: boolean
  atDomain1: boolean
}

function explicitSpan(model: ModelSpec, curve: FittedCurve, vp: Viewport): CurveSpan | null {
  if (!model.evalExplicit) return null
  const params = curve.params
  const ppx = ppuX(vp)
  const ppy = ppuY(vp)
  const cx = vp.center.x
  const cy = vp.center.y
  const hw = vp.widthPx / 2
  const hh = vp.heightPx / 2

  const pad = 8 / ppx // sample slightly past the edges so strokes exit cleanly
  let x0 = cx - hw / ppx - pad
  let x1 = cx + hw / ppx + pad
  let atDomain0 = false
  let atDomain1 = false
  if (curve.domain) {
    x0 = Math.max(x0, curve.domain[0])
    x1 = Math.min(x1, curve.domain[1])
    // a NaN bound compares false and is therefore never "the domain end"
    atDomain0 = x0 === curve.domain[0]
    atDomain1 = x1 === curve.domain[1]
  }
  if (!(x1 > x0)) return null

  const f: EvalToScreen = (x, out) => {
    const y = model.evalExplicit!(params, x)
    out.x = hw + (x - cx) * ppx
    out.y = hh - (y - cy) * ppy
    out.ok = Number.isFinite(y)
  }
  return { f, t0: x0, t1: x1, atDomain0, atDomain1 }
}

function buildSpan(path: PolylineSink, span: CurveSpan, vp: Viewport): boolean {
  resetEmitter(EM, path, span.f, vp)
  sampleAdaptive(EM, span.f, span.t0, span.t1, vp)
  return EM.drawn
}

function buildExplicit(
  path: Path2D,
  model: ModelSpec,
  curve: FittedCurve,
  vp: Viewport,
): boolean {
  const span = explicitSpan(model, curve, vp)
  return span !== null && buildSpan(path, span, vp)
}

/**
 * For parametric curves with a null domain: default to [0, 2π], except
 * 'vline'-style lines where x(t) is constant — there t is treated as y and
 * spans the visible y-range (a hair beyond, so the line crosses the canvas).
 */
function inferParametricDomain(
  model: ModelSpec,
  params: number[],
  vp: Viewport,
): [number, number] {
  const ev = model.evalParametric
  if (!ev) return [0, TWO_PI]
  let x0: number | null = null
  let xConst = true
  const probes = [0, 0.73, -0.73, 2.19, 4.81]
  for (let i = 0; i < probes.length; i++) {
    const p = ev.call(model, params, probes[i])
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    if (x0 === null) {
      x0 = p.x
    } else if (Math.abs(p.x - x0) > 1e-9 * (1 + Math.abs(x0))) {
      xConst = false
      break
    }
  }
  if (xConst && x0 !== null) {
    const hh = vp.heightPx / 2 / ppuY(vp)
    return [vp.center.y - hh * 1.05, vp.center.y + hh * 1.05]
  }
  return [0, TWO_PI]
}

function parametricSpan(model: ModelSpec, curve: FittedCurve, vp: Viewport): CurveSpan | null {
  if (!model.evalParametric) return null
  const params = curve.params
  const ppx = ppuX(vp)
  const ppy = ppuY(vp)
  const cx = vp.center.x
  const cy = vp.center.y
  const hw = vp.widthPx / 2
  const hh = vp.heightPx / 2

  const dom = curve.domain ?? inferParametricDomain(model, params, vp)
  const f: EvalToScreen = (t, out) => {
    const p = model.evalParametric!(params, t)
    out.x = hw + (p.x - cx) * ppx
    out.y = hh - (p.y - cy) * ppy
    out.ok = Number.isFinite(p.x) && Number.isFinite(p.y)
  }
  // An INFERRED span is not a domain: [0, 2π] is where the sampler had to
  // stop, not somewhere the curve ends, and a closed loop given a dot at
  // θ = 0 would be marked with an endpoint it does not have.
  const declared = curve.domain != null
  return { f, t0: dom[0], t1: dom[1], atDomain0: declared, atDomain1: declared }
}

function buildParametric(
  path: Path2D,
  model: ModelSpec,
  curve: FittedCurve,
  vp: Viewport,
): boolean {
  const span = parametricSpan(model, curve, vp)
  return span !== null && buildSpan(path, span, vp)
}

function polarSpan(model: ModelSpec, curve: FittedCurve, vp: Viewport): CurveSpan | null {
  if (!model.evalPolar) return null
  const params = curve.params
  const ppx = ppuX(vp)
  const ppy = ppuY(vp)
  const cx = vp.center.x
  const cy = vp.center.y
  const hw = vp.widthPx / 2
  const hh = vp.heightPx / 2

  const dom = curve.domain ?? [0, TWO_PI]
  // negative r follows standard polar convention automatically:
  // r·cosθ / r·sinθ with r < 0 plots the point at angle θ+π.
  const f: EvalToScreen = (th, out) => {
    const r = model.evalPolar!(params, th)
    const x = r * Math.cos(th)
    const y = r * Math.sin(th)
    out.x = hw + (x - cx) * ppx
    out.y = hh - (y - cy) * ppy
    out.ok = Number.isFinite(r)
  }
  const declared = curve.domain != null
  return { f, t0: dom[0], t1: dom[1], atDomain0: declared, atDomain1: declared }
}

function buildPolar(
  path: Path2D,
  model: ModelSpec,
  curve: FittedCurve,
  vp: Viewport,
): boolean {
  const span = polarSpan(model, curve, vp)
  return span !== null && buildSpan(path, span, vp)
}

// ---------------------------------------------------------------------------
// Implicit curves: marching squares.
//   1. Coarse scalar-field grid over the visible region (~160×100, ≈10 px
//      cells), values reused via a module-level Float64Array.
//   2. Edge crossings: linear interpolation sharpened by a few bisection
//      steps of the actual eval — crossing points land on the true curve.
//   3. Per-segment midpoint "snap": the midpoint of each chord is projected
//      onto the zero set along the chord normal, halving chord length and
//      cutting sag error ~4× — smooth circles/ellipses at any zoom.
// ---------------------------------------------------------------------------

let gridVals = new Float64Array(0)

const PB: Vec2 = { x: 0, y: 0 } // bottom-edge crossing (math coords)
const PR: Vec2 = { x: 0, y: 0 } // right
const PT: Vec2 = { x: 0, y: 0 } // top
const PL: Vec2 = { x: 0, y: 0 } // left
const PM: Vec2 = { x: 0, y: 0 } // snapped midpoint scratch

type ImplicitFn = (params: number[], x: number, y: number) => number

/** Bisection-refined crossing between (ax,ay,va) and (bx,by,vb), va·vb < 0. */
function edgeCrossing(
  f: ImplicitFn, model: ModelSpec, params: number[],
  ax: number, ay: number, va: number,
  bx: number, by: number, vb: number,
  out: Vec2,
): void {
  const aPos = va > 0
  for (let i = 0; i < 4; i++) {
    const mx = (ax + bx) / 2
    const my = (ay + by) / 2
    const vm = f.call(model, params, mx, my)
    if (!Number.isFinite(vm)) break
    if (vm === 0) {
      out.x = mx
      out.y = my
      return
    }
    if ((vm > 0) === aPos) {
      ax = mx; ay = my; va = vm
    } else {
      bx = mx; by = my; vb = vm
    }
  }
  const denom = va - vb
  const t = denom !== 0 ? va / denom : 0.5
  out.x = ax + (bx - ax) * t
  out.y = ay + (by - ay) * t
}

/**
 * Project the chord midpoint onto the zero set along the chord normal.
 * Returns true if a bracketed root was found within ±reach of the midpoint.
 */
function snapMidpoint(
  f: ImplicitFn, model: ModelSpec, params: number[],
  ax: number, ay: number, bx: number, by: number,
  reach: number, k: number, out: Vec2,
): boolean {
  const mx = (ax + bx) / 2
  const my = (ay + by) / 2
  let nx: number
  let ny: number
  if (k === 1) {
    nx = -(by - ay)
    ny = bx - ax
    const nl = Math.hypot(nx, ny)
    if (nl < 1e-30) return false
    nx = (nx / nl) * reach
    ny = (ny / nl) * reach
  } else {
    // Stretched board: the normal is taken where the chord is DRAWN — y
    // measured in x-units via k = ppuY/ppuX — and mapped back, so the search
    // runs across the stroke on screen, not 300 000 years sideways.
    nx = -(by - ay) * k
    ny = bx - ax
    const nl = Math.hypot(nx, ny)
    if (nl < 1e-30) return false
    nx = (nx / nl) * reach
    ny = ((ny / nl) * reach) / k
  }
  const vm = f.call(model, params, mx, my)
  if (!Number.isFinite(vm)) return false
  if (vm === 0) {
    out.x = mx
    out.y = my
    return true
  }
  const vPlus = f.call(model, params, mx + nx, my + ny)
  let px: number
  let py: number
  let pv: number
  if (Number.isFinite(vPlus) && (vPlus > 0) !== (vm > 0)) {
    px = mx + nx; py = my + ny; pv = vPlus
  } else {
    const vMinus = f.call(model, params, mx - nx, my - ny)
    if (!Number.isFinite(vMinus) || (vMinus > 0) === (vm > 0)) return false
    px = mx - nx; py = my - ny; pv = vMinus
  }
  edgeCrossing(f, model, params, mx, my, vm, px, py, pv, out)
  return true
}

function segTo(
  path: Path2D, f: ImplicitFn, model: ModelSpec, params: number[],
  a: Vec2, b: Vec2, reach: number,
  cx: number, cy: number, ppx: number, ppy: number, hw: number, hh: number,
): void {
  path.moveTo(hw + (a.x - cx) * ppx, hh - (a.y - cy) * ppy)
  if (snapMidpoint(f, model, params, a.x, a.y, b.x, b.y, reach, ppy / ppx, PM)) {
    path.lineTo(hw + (PM.x - cx) * ppx, hh - (PM.y - cy) * ppy)
  }
  path.lineTo(hw + (b.x - cx) * ppx, hh - (b.y - cy) * ppy)
}

function buildImplicit(
  path: Path2D,
  model: ModelSpec,
  curve: FittedCurve,
  vp: Viewport,
): boolean {
  const f = model.evalImplicit
  if (!f) return false
  const params = curve.params
  const W = vp.widthPx
  const H = vp.heightPx
  const ppx = ppuX(vp)
  const ppy = ppuY(vp)
  const cx = vp.center.x
  const cy = vp.center.y
  const hw = W / 2
  const hh = H / 2

  // coarse grid: ~10 px cells, capped near 160×100
  const nx = Math.max(24, Math.min(160, Math.ceil(W / 10)))
  const ny = Math.max(16, Math.min(100, Math.ceil(H / 10)))
  const padPx = 6
  const mx0 = cx - (hw + padPx) / ppx
  const mx1 = cx + (hw + padPx) / ppx
  const my0 = cy - (hh + padPx) / ppy
  const my1 = cy + (hh + padPx) / ppy
  const dx = (mx1 - mx0) / nx
  const dy = (my1 - my0) / ny
  const cols = nx + 1

  const need = cols * (ny + 1)
  if (gridVals.length < need) gridVals = new Float64Array(need)
  const vals = gridVals

  for (let j = 0; j <= ny; j++) {
    const y = my0 + j * dy
    const row = j * cols
    for (let i = 0; i <= nx; i++) {
      vals[row + i] = f.call(model, params, mx0 + i * dx, y)
    }
  }

  // midpoint-snap search distance, in x-units (y measured in x-units on a
  // stretched board, so it is the cell's SCREEN diagonal either way)
  const kY = ppy / ppx
  const reach = (kY === 1 ? Math.hypot(dx, dy) : Math.hypot(dx, dy * kY)) * 0.35
  let drawn = false

  for (let j = 0; j < ny; j++) {
    const y0 = my0 + j * dy
    const y1 = y0 + dy
    const row = j * cols
    const rowUp = row + cols
    for (let i = 0; i < nx; i++) {
      const v00 = vals[row + i]       // bottom-left  (x0, y0)
      const v10 = vals[row + i + 1]   // bottom-right (x1, y0)
      const v01 = vals[rowUp + i]     // top-left     (x0, y1)
      const v11 = vals[rowUp + i + 1] // top-right    (x1, y1)
      if (
        !Number.isFinite(v00) || !Number.isFinite(v10) ||
        !Number.isFinite(v01) || !Number.isFinite(v11)
      ) continue

      let code = 0
      if (v00 > 0) code |= 1
      if (v10 > 0) code |= 2
      if (v11 > 0) code |= 4
      if (v01 > 0) code |= 8
      if (code === 0 || code === 15) continue

      const x0 = mx0 + i * dx
      const x1 = x0 + dx

      // crossings on the edges this case needs
      const needB = code === 1 || code === 14 || code === 2 || code === 13 ||
        code === 3 || code === 12 || code === 5 || code === 10 ||
        code === 6 || code === 9
      const needT = code === 4 || code === 11 || code === 8 || code === 7 ||
        code === 5 || code === 10 || code === 6 || code === 9
      const needL = code === 1 || code === 14 || code === 8 || code === 7 ||
        code === 3 || code === 12 || code === 5 || code === 10
      const needR = code === 2 || code === 13 || code === 4 || code === 11 ||
        code === 3 || code === 12 || code === 5 || code === 10

      if (needB) edgeCrossing(f, model, params, x0, y0, v00, x1, y0, v10, PB)
      if (needR) edgeCrossing(f, model, params, x1, y0, v10, x1, y1, v11, PR)
      if (needT) edgeCrossing(f, model, params, x0, y1, v01, x1, y1, v11, PT)
      if (needL) edgeCrossing(f, model, params, x0, y0, v00, x0, y1, v01, PL)

      switch (code) {
        case 1: case 14:
          segTo(path, f, model, params, PL, PB, reach, cx, cy, ppx, ppy, hw, hh)
          break
        case 2: case 13:
          segTo(path, f, model, params, PB, PR, reach, cx, cy, ppx, ppy, hw, hh)
          break
        case 3: case 12:
          segTo(path, f, model, params, PL, PR, reach, cx, cy, ppx, ppy, hw, hh)
          break
        case 4: case 11:
          segTo(path, f, model, params, PT, PR, reach, cx, cy, ppx, ppy, hw, hh)
          break
        case 6: case 9:
          segTo(path, f, model, params, PB, PT, reach, cx, cy, ppx, ppy, hw, hh)
          break
        case 7: case 8:
          segTo(path, f, model, params, PL, PT, reach, cx, cy, ppx, ppy, hw, hh)
          break
        case 5: { // v00 & v11 positive — disambiguate with the cell center
          const vc = f.call(model, params, x0 + dx / 2, y0 + dy / 2)
          if (Number.isFinite(vc) && vc > 0) {
            segTo(path, f, model, params, PL, PT, reach, cx, cy, ppx, ppy, hw, hh)
            segTo(path, f, model, params, PB, PR, reach, cx, cy, ppx, ppy, hw, hh)
          } else {
            segTo(path, f, model, params, PL, PB, reach, cx, cy, ppx, ppy, hw, hh)
            segTo(path, f, model, params, PT, PR, reach, cx, cy, ppx, ppy, hw, hh)
          }
          break
        }
        case 10: { // v10 & v01 positive — disambiguate with the cell center
          const vc = f.call(model, params, x0 + dx / 2, y0 + dy / 2)
          if (Number.isFinite(vc) && vc > 0) {
            segTo(path, f, model, params, PL, PB, reach, cx, cy, ppx, ppy, hw, hh)
            segTo(path, f, model, params, PT, PR, reach, cx, cy, ppx, ppy, hw, hh)
          } else {
            segTo(path, f, model, params, PL, PT, reach, cx, cy, ppx, ppy, hw, hh)
            segTo(path, f, model, params, PB, PR, reach, cx, cy, ppx, ppy, hw, hh)
          }
          break
        }
        default:
          continue
      }
      drawn = true
    }
  }
  return drawn
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sample y = evalY(x) over [x0, x1] into SCREEN-space polylines, using exactly
 * the machinery drawCurve uses: the uniform base pass, the recursive bisection
 * on chord error, the pole/jump probe that lifts the pen, and the generous
 * Liang–Barsky clip to ±1 viewport of overdraw.
 *
 * The reason this is exported rather than re-implemented next door: the shaded
 * area under a curve is bounded ABOVE by the very stroke the board already
 * draws. A second sampler would eventually disagree with the first, and the
 * disagreement would show up as shading that creeps past a pole — the exact
 * picture a class must never be shown for 1/x on [-1, 1]. Here the region is
 * split wherever the stroke is broken, because it is the same break.
 *
 * Each returned polyline has at least two points; an empty array means the
 * function put nothing on (or near) the canvas over that span.
 */
export function sampleExplicitPolylines(
  evalY: (x: number) => number,
  vp: Viewport,
  x0: number,
  x1: number,
): Vec2[][] {
  if (!(x1 > x0) || !(ppuX(vp) > 0) || !(ppuY(vp) > 0) || vp.widthPx <= 0 || vp.heightPx <= 0) return []
  const ppx = ppuX(vp)
  const ppy = ppuY(vp)
  const cx = vp.center.x
  const cy = vp.center.y
  const hw = vp.widthPx / 2
  const hh = vp.heightPx / 2

  const f: EvalToScreen = (x, out) => {
    let y: number
    try {
      y = evalY(x)
    } catch {
      y = Number.NaN
    }
    out.x = hw + (x - cx) * ppx
    out.y = hh - (y - cy) * ppy
    out.ok = Number.isFinite(y)
  }

  const sink = new PolylineCollector()
  resetEmitter(EM, sink, f, vp)
  sampleAdaptive(EM, f, x0, x1, vp)
  return sink.lines.filter((l) => l.length >= 2)
}

// ---------------------------------------------------------------------------
// Tracing: the sampled curve, with its parameter, before the clip.
// ---------------------------------------------------------------------------

/** One sample of a traced curve: its parameter and its screen position. */
export interface CurveSample {
  /** x for an explicit curve, t for a parametric one, θ for a polar one. */
  t: number
  /** Screen px. */
  x: number
  y: number
}

// ---------------------------------------------------------------------------
// Natural domain edges.
//
// A formula can stop in two completely different ways, and a figure draws them
// completely differently:
//
//   ENDPOINT  the values settle on a finite limit — sqrt(x) at 0, sqrt(4-x^2)
//             at +-2, arcsin x at +-1. The graph HAS a last point, and a
//             textbook marks it with a dot.
//   POLE      the values run away — 1/x at 0, ln x at 0, 1/sqrt(x) at 0. The
//             graph has no last point, and a textbook marks nothing.
//
// The sampler cannot tell them apart, because both look the same from the
// outside: a run that simply stops. So ask the function. Bisect the parameter
// on `ok` until the boundary is pinned to ~1e-12 of the bracket, watching the
// values on the DEFINED side: a converging sequence is a limit and an endpoint;
// a sequence that keeps moving is a blow-up and a pole. The value, not the
// slope — sqrt has an infinite derivative at its branch point and is still an
// endpoint.
//
// Then the second question, which decides the dot: is the function defined AT
// the boundary? sqrt(0) is 0, so the dot is CLOSED. x*ln(x) has the limit 0 at
// 0 and no value there, so the dot is OPEN. The boundary itself is recovered
// as the simplest number the final bracket still contains, which is the one
// the formula was written about.
// ---------------------------------------------------------------------------

/** Bisection steps on the defined/undefined boundary: 2^-40 of the bracket. */
const EDGE_STEPS = 40
/** Refined values this close together (screen px) have settled on a limit. */
const LIMIT_TOL_PX = 0.5
/** ...plus this much of their own magnitude, for a limit far off the board. */
const LIMIT_REL = 1e-6
/** How many refined values have to agree before the limit is believed. */
const LIMIT_SAMPLES = 3

/** Where a formula's own domain stops, with a finite value. */
export interface NaturalEnd {
  /** The boundary parameter: x for explicit, t for parametric, θ for polar. */
  t: number
  /** The endpoint in screen px — f at the boundary, or its limit. */
  x: number
  y: number
  /**
   * True when f is DEFINED at the boundary (sqrt(x) at 0): a closed dot.
   * False when only the limit exists (x·ln x at 0): an open one.
   */
  closed: boolean
}

/**
 * The simplest number the closed interval [lo, hi] contains.
 *
 * After 40 halvings the boundary is known to about 1e-12 of the original
 * bracket, and every boundary a written formula actually has — 0, ±1, ±2, b in
 * sqrt(x − b) — is then the only round number left inside it. Taking that
 * number back is what lets f be evaluated AT the boundary rather than a
 * rounding error to one side of it, which is the whole difference between a
 * closed dot and an open one.
 */
function simplestIn(lo: number, hi: number): number {
  if (lo <= 0 && hi >= 0) return 0
  const mid = (lo + hi) / 2
  for (let p = 1; p <= 15; p++) {
    const c = Number(mid.toPrecision(p))
    if (c >= lo && c <= hi) return c
  }
  return mid
}

const EDGE_PROBE: Sample = { x: 0, y: 0, ok: false }

function probeOk(f: EvalToScreen, t: number): boolean {
  f(t, EDGE_PROBE)
  return EDGE_PROBE.ok && Number.isFinite(EDGE_PROBE.x) && Number.isFinite(EDGE_PROBE.y)
}

/**
 * Decide what the boundary bracketed by [`def`, `und`] is: a natural endpoint
 * (returned) or a pole (null).
 *
 * `def` is a parameter where f has a finite value and `und` one where it does
 * not; they may be in either order, because a graph can stop going up in the
 * parameter or start again going up in it. Costs EDGE_STEPS + 1 evaluations
 * and is asked at most twice per curve, at the two ends a cap could go on.
 */
export function classifyEdge(
  f: EvalToScreen, def: number, und: number,
): NaturalEnd | null {
  if (!Number.isFinite(def) || !Number.isFinite(und)) return null
  if (!probeOk(f, def)) return null
  let a = def
  let b = und
  // the last few values on the defined side, newest last
  const xs: number[] = [EDGE_PROBE.x]
  const ys: number[] = [EDGE_PROBE.y]
  for (let i = 0; i < EDGE_STEPS; i++) {
    const m = (a + b) / 2
    if (m === a || m === b) break // the bracket is two adjacent doubles
    if (probeOk(f, m)) {
      a = m
      xs.push(EDGE_PROBE.x)
      ys.push(EDGE_PROBE.y)
      if (xs.length > LIMIT_SAMPLES) { xs.shift(); ys.shift() }
    } else {
      b = m
    }
  }
  const last = xs.length - 1
  const lx = xs[last]
  const ly = ys[last]
  // Converged? A pole's values double (1/x) or step by a constant (ln x) with
  // every halving and never settle; a limit stops moving. One value means the
  // bisection never left `def` — f is undefined on the whole open bracket, so
  // `def` IS the boundary and it trivially has a limit.
  const tol = LIMIT_TOL_PX + LIMIT_REL * Math.hypot(lx, ly)
  for (let i = 0; i < last; i++) {
    if (!(Math.hypot(xs[i] - lx, ys[i] - ly) <= tol)) return null // a pole
  }
  // Defined at the boundary itself, with the limit's value? Then the point
  // belongs to the graph.
  const bound = simplestIn(Math.min(a, b), Math.max(a, b))
  if (probeOk(f, bound) && Math.hypot(EDGE_PROBE.x - lx, EDGE_PROBE.y - ly) <= tol) {
    return { t: bound, x: EDGE_PROBE.x, y: EDGE_PROBE.y, closed: true }
  }
  return { t: a, x: lx, y: ly, closed: false }
}

/** The two parameters that bracket one defined/undefined boundary. */
interface EdgeBracket { def: number; und: number }

/** A curve as the sampler saw it: runs of samples, broken at its poles. */
export interface CurveTrace {
  /**
   * One array per pen-down run, in increasing parameter order, each run in
   * increasing parameter order. Runs are NOT clipped — a sample may be far
   * off the board, which is exactly what locating a board exit needs.
   */
  runs: CurveSample[][]
  /** The parameter span actually sampled. */
  t0: number
  t1: number
  /** True when t0 / t1 is the curve's own declared domain end. */
  atDomain0: boolean
  atDomain1: boolean
  /**
   * The natural domain edge that run `run` begins at (`naturalStart`) or ends
   * at (`naturalEnd`) — where the formula stops being defined with a finite
   * value, like sqrt(x) at 0. Null at a pole, at a jump the probe broke, and
   * at the sampled span's own ends.
   *
   * Computed ON DEMAND and cached: the refinement is ~40 evaluations, and only
   * the two outermost ends of a curve are ever asked for a cap.
   */
  naturalStart(run: number): NaturalEnd | null
  naturalEnd(run: number): NaturalEnd | null
}

const NULL_SINK: PolylineSink = { moveTo(): void {}, lineTo(): void {} }

/**
 * Re-sample a curve exactly as `drawCurve` does, and keep the samples.
 *
 * The stroke answers "what is on the canvas"; this answers "where does the
 * graph stop, and which way was it going" — the question an end cap is. It
 * runs the SAME adaptive pass and the SAME pole probe, so a run boundary here
 * is a pen lift there: a cap can never be placed across a break the stroke
 * does not have, and the two can never drift apart.
 *
 * Implicit curves have no parameter and no ends; they return null.
 */
export function traceCurve(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  vp: Viewport,
): CurveTrace | null {
  if (curve.kind === 'implicit') return null
  const model = models[curve.modelId]
  if (!model) return null
  if (vp.widthPx <= 0 || vp.heightPx <= 0 || !(ppuX(vp) > 0) || !(ppuY(vp) > 0)) return null

  let span: CurveSpan | null = null
  try {
    span =
      curve.kind === 'explicit' ? explicitSpan(model, curve, vp)
      : curve.kind === 'parametric' ? parametricSpan(model, curve, vp)
      : polarSpan(model, curve, vp)
  } catch {
    return null
  }
  if (!span) return null

  const runs: CurveSample[][] = []
  // per run, the bracket around the boundary it starts / stops at, if any
  const lo: (EdgeBracket | null)[] = []
  const hi: (EdgeBracket | null)[] = []
  let cur: CurveSample[] = []
  let pending: EdgeBracket | null = null
  resetEmitter(EM, NULL_SINK, span.f, vp)
  EM.tap = (t, x, y, newRun): void => {
    if (newRun || cur.length === 0) {
      cur = []
      runs.push(cur)
      lo.push(pending)
      hi.push(null)
    }
    pending = null
    cur.push({ t, x, y })
  }
  EM.edge = (def, und, entering): void => {
    if (entering) pending = { def, und }
    else if (runs.length > 0) hi[runs.length - 1] = { def, und }
  }
  try {
    sampleAdaptive(EM, span.f, span.t0, span.t1, vp)
  } catch {
    /* an evaluator that threw mid-span still leaves the runs it produced */
  } finally {
    EM.tap = null
    EM.edge = null
  }

  // Drop the empty runs, and their brackets with them, so a run index means
  // the same thing in both lists.
  const keep: number[] = []
  for (let i = 0; i < runs.length; i++) if (runs[i].length > 0) keep.push(i)
  const f = span.f
  const memo = new Map<number, NaturalEnd | null>()
  const natural = (run: number, lower: boolean): NaturalEnd | null => {
    const key = run * 2 + (lower ? 0 : 1)
    const hit = memo.get(key)
    if (hit !== undefined) return hit
    const src = run >= 0 && run < keep.length ? (lower ? lo : hi)[keep[run]] : null
    let out: NaturalEnd | null = null
    if (src) {
      try {
        out = classifyEdge(f, src.def, src.und)
      } catch {
        out = null
      }
    }
    memo.set(key, out)
    return out
  }
  return {
    runs: keep.map((i) => runs[i]),
    t0: span.t0,
    t1: span.t1,
    atDomain0: span.atDomain0,
    atDomain1: span.atDomain1,
    naturalStart: (run) => natural(run, true),
    naturalEnd: (run) => natural(run, false),
  }
}

/**
 * The lineWidth `drawCurve` will actually stroke this curve at, in CSS px.
 * Exported so an end cap — which has to knock that stroke out from under its
 * own head — asks the renderer rather than guessing.
 */
export function curveLineWidth(curve: FittedCurve, strokeScale?: number): number {
  const sc =
    typeof strokeScale === 'number' && Number.isFinite(strokeScale) && strokeScale > 0
      ? Math.min(6, Math.max(0.5, strokeScale))
      : 1
  return (curve.strokeWidth > 0 ? curve.strokeWidth : DEFAULT_STROKE) * sc
}

/** A PolylineSink that keeps the points: one array per pen-down run. */
class PolylineCollector implements PolylineSink {
  lines: Vec2[][] = []
  private cur: Vec2[] | null = null
  moveTo(x: number, y: number): void {
    this.cur = [{ x, y }]
    this.lines.push(this.cur)
  }
  lineTo(x: number, y: number): void {
    if (!this.cur) {
      this.moveTo(x, y)
      return
    }
    this.cur.push({ x, y })
  }
}

/** Paint-time options that are about the BOARD, not about the curve itself. */
export interface CurvePaintOpts {
  /** Presentation scale on the stroke width (BoardScene.present.stroke). */
  strokeScale?: number
  /**
   * True when the figure sits on a light ground. The selection halo is a wash
   * of the curve's own colour, and a wash that reads at 25% against near-black
   * is very nearly white-on-white on paper: two reviewers could not see the
   * selection at all in the light theme. On white it needs real weight.
   */
  lightGround?: boolean
}

/** Selection-halo alpha: a soft wash on black, an actually visible one on white. */
export const HALO_ALPHA_DARK = 0.25
export const HALO_ALPHA_LIGHT = 0.42

export function drawCurve(
  ctx: CanvasRenderingContext2D,
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  vp: Viewport,
  selected?: boolean,
  opts?: CurvePaintOpts | null,
): void {
  if (!curve.visible) return
  const model = models[curve.modelId]
  if (!model) return
  if (vp.widthPx <= 0 || vp.heightPx <= 0 || !(ppuX(vp) > 0) || !(ppuY(vp) > 0)) return

  const path = new Path2D()
  let drawn = false
  switch (curve.kind) {
    case 'explicit':
      drawn = buildExplicit(path, model, curve, vp)
      break
    case 'parametric':
      drawn = buildParametric(path, model, curve, vp)
      break
    case 'polar':
      drawn = buildPolar(path, model, curve, vp)
      break
    case 'implicit':
      drawn = buildImplicit(path, model, curve, vp)
      break
  }
  if (!drawn) return

  const sc =
    opts && typeof opts.strokeScale === 'number' && Number.isFinite(opts.strokeScale) &&
    opts.strokeScale > 0
      ? Math.min(6, Math.max(0.5, opts.strokeScale))
      : 1
  const w = (curve.strokeWidth > 0 ? curve.strokeWidth : DEFAULT_STROKE) * sc
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = curve.color
  if (selected) {
    // soft halo underlay: same geometry, ~3× width
    // (a single stroke() of one Path2D never double-blends its overlaps)
    ctx.globalAlpha = opts?.lightGround ? HALO_ALPHA_LIGHT : HALO_ALPHA_DARK
    ctx.lineWidth = w * 3
    ctx.stroke(path)
    ctx.globalAlpha = 1
  }
  ctx.lineWidth = w
  ctx.stroke(path)
  ctx.restore()
}

/**
 * In-progress hand stroke: quadratic-midpoint smoothing — the curve passes
 * through segment midpoints with the sample points as control points.
 */
export function drawInk(
  ctx: CanvasRenderingContext2D,
  pts: Vec2[],
  vp: Viewport,
  color: string,
  strokeScale = 1,
): void {
  const n = pts.length
  if (n === 0) return
  const ppx = ppuX(vp)
  const ppy = ppuY(vp)
  const cx = vp.center.x
  const cy = vp.center.y
  const hw = vp.widthPx / 2
  const hh = vp.heightPx / 2

  ctx.save()
  ctx.globalAlpha = 0.85
  ctx.strokeStyle = color
  ctx.fillStyle = color
  const sc = Number.isFinite(strokeScale) && strokeScale > 0
    ? Math.min(6, Math.max(0.5, strokeScale))
    : 1
  ctx.lineWidth = 2.5 * sc
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const x0 = hw + (pts[0].x - cx) * ppx
  const y0 = hh - (pts[0].y - cy) * ppy

  if (n === 1) {
    ctx.beginPath()
    ctx.arc(x0, y0, 1.25 * sc, 0, TWO_PI)
    ctx.fill()
    ctx.restore()
    return
  }

  ctx.beginPath()
  ctx.moveTo(x0, y0)
  if (n === 2) {
    ctx.lineTo(hw + (pts[1].x - cx) * ppx, hh - (pts[1].y - cy) * ppy)
  } else {
    for (let i = 1; i < n - 1; i++) {
      const ax = hw + (pts[i].x - cx) * ppx
      const ay = hh - (pts[i].y - cy) * ppy
      const bx = hw + (pts[i + 1].x - cx) * ppx
      const by = hh - (pts[i + 1].y - cy) * ppy
      ctx.quadraticCurveTo(ax, ay, (ax + bx) / 2, (ay + by) / 2)
    }
    ctx.lineTo(
      hw + (pts[n - 1].x - cx) * ppx,
      hh - (pts[n - 1].y - cy) * ppy,
    )
  }
  ctx.stroke()
  ctx.restore()
}

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

const TWO_PI = Math.PI * 2
const DEFAULT_STROKE = 2.5
const CHORD_TOL_PX = 0.25 // max midpoint-to-chord deviation before bisecting
const MAX_DEPTH = 8       // recursion cap for adaptive bisection
const BASE_SAMPLES = 160  // uniform samples across the span before refinement

// ---------------------------------------------------------------------------
// Shared scratch (module-level, reused across calls — no per-sample allocs).
// ---------------------------------------------------------------------------

interface Sample { x: number; y: number; ok: boolean }
const SCR: Sample = { x: 0, y: 0, ok: false }

type EvalToScreen = (t: number, out: Sample) => void

/** Polyline emitter writing into a Path2D with pen-up/pen-down state. */
interface Emitter {
  path: Path2D
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
}

// path/f are assigned by resetEmitter before any use; kept unset here so merely
// importing this module never touches DOM globals (tests, SSR).
const EM: Emitter = {
  path: undefined as unknown as Path2D,
  f: undefined as unknown as EvalToScreen,
  has: false,
  penDown: false,
  drawn: false,
  lastT: 0,
  lastX: 0,
  lastY: 0,
  suspectPx: 0,
  cx0: 0, cx1: 0, cy0: 0, cy1: 0,
}

function resetEmitter(
  em: Emitter, path: Path2D, f: EvalToScreen, vp: Viewport,
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
    em.has = false
    em.penDown = false
    return
  }
  if (em.has) {
    const px = em.lastX
    const py = em.lastY
    const dx = x - px
    const dy = y - py
    let broken = false
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

function buildExplicit(
  path: Path2D,
  model: ModelSpec,
  curve: FittedCurve,
  vp: Viewport,
): boolean {
  if (!model.evalExplicit) return false
  const params = curve.params
  const ppu = vp.pxPerUnit
  const cx = vp.center.x
  const cy = vp.center.y
  const hw = vp.widthPx / 2
  const hh = vp.heightPx / 2

  const pad = 8 / ppu // sample slightly past the edges so strokes exit cleanly
  let x0 = cx - hw / ppu - pad
  let x1 = cx + hw / ppu + pad
  if (curve.domain) {
    x0 = Math.max(x0, curve.domain[0])
    x1 = Math.min(x1, curve.domain[1])
  }
  if (!(x1 > x0)) return false

  const f: EvalToScreen = (x, out) => {
    const y = model.evalExplicit!(params, x)
    out.x = hw + (x - cx) * ppu
    out.y = hh - (y - cy) * ppu
    out.ok = Number.isFinite(y)
  }
  resetEmitter(EM, path, f, vp)
  sampleAdaptive(EM, f, x0, x1, vp)
  return EM.drawn
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
    const hh = vp.heightPx / 2 / vp.pxPerUnit
    return [vp.center.y - hh * 1.05, vp.center.y + hh * 1.05]
  }
  return [0, TWO_PI]
}

function buildParametric(
  path: Path2D,
  model: ModelSpec,
  curve: FittedCurve,
  vp: Viewport,
): boolean {
  if (!model.evalParametric) return false
  const params = curve.params
  const ppu = vp.pxPerUnit
  const cx = vp.center.x
  const cy = vp.center.y
  const hw = vp.widthPx / 2
  const hh = vp.heightPx / 2

  const dom = curve.domain ?? inferParametricDomain(model, params, vp)
  const f: EvalToScreen = (t, out) => {
    const p = model.evalParametric!(params, t)
    out.x = hw + (p.x - cx) * ppu
    out.y = hh - (p.y - cy) * ppu
    out.ok = Number.isFinite(p.x) && Number.isFinite(p.y)
  }
  resetEmitter(EM, path, f, vp)
  sampleAdaptive(EM, f, dom[0], dom[1], vp)
  return EM.drawn
}

function buildPolar(
  path: Path2D,
  model: ModelSpec,
  curve: FittedCurve,
  vp: Viewport,
): boolean {
  if (!model.evalPolar) return false
  const params = curve.params
  const ppu = vp.pxPerUnit
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
    out.x = hw + (x - cx) * ppu
    out.y = hh - (y - cy) * ppu
    out.ok = Number.isFinite(r)
  }
  resetEmitter(EM, path, f, vp)
  sampleAdaptive(EM, f, dom[0], dom[1], vp)
  return EM.drawn
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
  reach: number, out: Vec2,
): boolean {
  const mx = (ax + bx) / 2
  const my = (ay + by) / 2
  let nx = -(by - ay)
  let ny = bx - ax
  const nl = Math.hypot(nx, ny)
  if (nl < 1e-30) return false
  nx = (nx / nl) * reach
  ny = (ny / nl) * reach
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
  cx: number, cy: number, ppu: number, hw: number, hh: number,
): void {
  path.moveTo(hw + (a.x - cx) * ppu, hh - (a.y - cy) * ppu)
  if (snapMidpoint(f, model, params, a.x, a.y, b.x, b.y, reach, PM)) {
    path.lineTo(hw + (PM.x - cx) * ppu, hh - (PM.y - cy) * ppu)
  }
  path.lineTo(hw + (b.x - cx) * ppu, hh - (b.y - cy) * ppu)
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
  const ppu = vp.pxPerUnit
  const cx = vp.center.x
  const cy = vp.center.y
  const hw = W / 2
  const hh = H / 2

  // coarse grid: ~10 px cells, capped near 160×100
  const nx = Math.max(24, Math.min(160, Math.ceil(W / 10)))
  const ny = Math.max(16, Math.min(100, Math.ceil(H / 10)))
  const padPx = 6
  const mx0 = cx - (hw + padPx) / ppu
  const mx1 = cx + (hw + padPx) / ppu
  const my0 = cy - (hh + padPx) / ppu
  const my1 = cy + (hh + padPx) / ppu
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

  const reach = Math.hypot(dx, dy) * 0.35 // midpoint-snap search distance
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
          segTo(path, f, model, params, PL, PB, reach, cx, cy, ppu, hw, hh)
          break
        case 2: case 13:
          segTo(path, f, model, params, PB, PR, reach, cx, cy, ppu, hw, hh)
          break
        case 3: case 12:
          segTo(path, f, model, params, PL, PR, reach, cx, cy, ppu, hw, hh)
          break
        case 4: case 11:
          segTo(path, f, model, params, PT, PR, reach, cx, cy, ppu, hw, hh)
          break
        case 6: case 9:
          segTo(path, f, model, params, PB, PT, reach, cx, cy, ppu, hw, hh)
          break
        case 7: case 8:
          segTo(path, f, model, params, PL, PT, reach, cx, cy, ppu, hw, hh)
          break
        case 5: { // v00 & v11 positive — disambiguate with the cell center
          const vc = f.call(model, params, x0 + dx / 2, y0 + dy / 2)
          if (Number.isFinite(vc) && vc > 0) {
            segTo(path, f, model, params, PL, PT, reach, cx, cy, ppu, hw, hh)
            segTo(path, f, model, params, PB, PR, reach, cx, cy, ppu, hw, hh)
          } else {
            segTo(path, f, model, params, PL, PB, reach, cx, cy, ppu, hw, hh)
            segTo(path, f, model, params, PT, PR, reach, cx, cy, ppu, hw, hh)
          }
          break
        }
        case 10: { // v10 & v01 positive — disambiguate with the cell center
          const vc = f.call(model, params, x0 + dx / 2, y0 + dy / 2)
          if (Number.isFinite(vc) && vc > 0) {
            segTo(path, f, model, params, PL, PB, reach, cx, cy, ppu, hw, hh)
            segTo(path, f, model, params, PT, PR, reach, cx, cy, ppu, hw, hh)
          } else {
            segTo(path, f, model, params, PL, PT, reach, cx, cy, ppu, hw, hh)
            segTo(path, f, model, params, PB, PR, reach, cx, cy, ppu, hw, hh)
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
  if (vp.widthPx <= 0 || vp.heightPx <= 0 || !(vp.pxPerUnit > 0)) return

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
  const ppu = vp.pxPerUnit
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

  const x0 = hw + (pts[0].x - cx) * ppu
  const y0 = hh - (pts[0].y - cy) * ppu

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
    ctx.lineTo(hw + (pts[1].x - cx) * ppu, hh - (pts[1].y - cy) * ppu)
  } else {
    for (let i = 1; i < n - 1; i++) {
      const ax = hw + (pts[i].x - cx) * ppu
      const ay = hh - (pts[i].y - cy) * ppu
      const bx = hw + (pts[i + 1].x - cx) * ppu
      const by = hh - (pts[i + 1].y - cy) * ppu
      ctx.quadraticCurveTo(ax, ay, (ax + bx) / 2, (ay + by) / 2)
    }
    ctx.lineTo(
      hw + (pts[n - 1].x - cx) * ppu,
      hh - (pts[n - 1].y - cy) * ppu,
    )
  }
  ctx.stroke()
  ctx.restore()
}

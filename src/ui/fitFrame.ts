// ============================================================================
// src/ui/fitFrame.ts — where "Fit to curves" looks: a curve's FEATURES.
//
// "Fit to curves" used to measure each curve over the whole visible window, so
// y = x² − 4 on a ±8.5 board reached y = 72 at the edges, and equal axes then
// widened x to match: one click zoomed OUT to x ∈ [−65, 65]. Any curve with a
// steep or asymptotic tail (eˣ, 1/(x − 1), tan x) did the same.
//
// A frame is about what a student is asked to see: the zeros, the turning
// points, the inflections, the y-intercept, the holes, the ends of a drawn
// piece, where the vertical asymptotes stand and the levels the ends lean on.
// The rule, for a function y = f(x):
//
//   x  the key points' x-span — only the MAX_KEY_XS nearest the view centre,
//      so sin x frames about two periods, not every crest in the search
//      window — padded, and widened to MIN_WIDTH (eˣ's one key point (0, 1)
//      still gets a sensible frame), the extra going to the side where the
//      curve is defined (√x, ln x frame to the right of 0);
//   y  the key points' y's and end-asymptote levels, plus the curve's values
//      over that x-range CLIPPED to a band around them — so a pole or an
//      exponential tail cannot blow the frame up — and the x-axis when it is
//      within that band.
//
// Polar and parametric curves are bounded figures: their sampled extent.
// A circle or an ellipse: its leftmost / rightmost / top / bottom points. A
// typed implicit curve: where F changes sign on a grid over the search box.
//
// The pads here are small: the board's fitBox (src/ui/viewScale.ts) puts its
// own FIT_MARGIN all round the box this returns.
//
// Pure: no React, no DOM.
// ============================================================================

import type { FittedCurve, ModelSpec, Vec2 } from '../core/types'
import { analyzeCurve } from '../core/analyze'
import { findEndAsymptotes, findPoles } from '../core/holes'
import type { Box } from './curveState'
import { curveBounds, unionBoxes } from './curveState'

/** What the board is looking at: its x-range, and its y-range when known. */
export interface FitView {
  x: [number, number]
  y?: [number, number]
}

/** The x-range a curve is searched for features over, at the least. */
const SEARCH: [number, number] = [-10, 10]
/** The widest unrestricted search: past it, features are sampled too thinly. */
const SEARCH_MAX = 100
/** A frame narrower than this (math units) is widened to it. */
const MIN_WIDTH = 6
/** How many key x's a frame keeps — the ones nearest the view centre. */
const MAX_KEY_XS = 9
/** Samples of f across the framed x-range. */
const VALUE_SAMPLES = 241
/** Beyond this a value is an asymptote running away, not part of the figure. */
const RUNAWAY = 1e6
/** The smallest half-height of the band values are clipped to. */
const MIN_BAND = 1.5
/** Grid cells per side for a typed implicit curve. */
const IMPLICIT_GRID = 160

const finite = (v: number): boolean => Number.isFinite(v) && Math.abs(v) <= RUNAWAY

function viewOf(view: FitView | [number, number]): FitView {
  return Array.isArray(view) ? { x: view } : view
}

/** The view's x-range, or SEARCH when it is unusable. */
function viewX(view: FitView): [number, number] {
  const [a, b] = view.x
  return Number.isFinite(a) && Number.isFinite(b) && b > a ? [a, b] : SEARCH
}

/**
 * Where an unrestricted curve is searched: [−10, 10] and the view together,
 * unless that is wider than SEARCH_MAX — then the view's centre ± SEARCH_MAX/2.
 */
function searchRange(view: FitView): [number, number] {
  const [w0, w1] = viewX(view)
  const lo = Math.min(SEARCH[0], w0)
  const hi = Math.max(SEARCH[1], w1)
  if (hi - lo <= SEARCH_MAX) return [lo, hi]
  const c = (w0 + w1) / 2
  return [c - SEARCH_MAX / 2, c + SEARCH_MAX / 2]
}

/**
 * The box that frames one curve's features, or null when there is nothing to
 * frame (no model, nothing measurable). Hidden curves are the caller's to
 * leave out; see curvesFeatureBox.
 */
export function curveFeatureBox(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  view: FitView | [number, number],
): Box | null {
  const v = viewOf(view)
  const spec = models[curve.modelId]
  if (!spec) return null
  try {
    if (spec.evalExplicit) return explicitBox(curve, spec, models, v) ?? curveBounds(curve, spec, viewX(v))
    if (spec.evalPolar || spec.evalParametric) return curveBounds(curve, spec, viewX(v))
    if (spec.kind === 'implicit') return implicitBox(curve, spec, models, v) ?? curveBounds(curve, spec, viewX(v))
    return curveBounds(curve, spec, viewX(v))
  } catch {
    return null
  }
}

/** The union of every VISIBLE curve's feature box, or null when there is none. */
export function curvesFeatureBox(
  curves: readonly FittedCurve[],
  models: Record<string, ModelSpec>,
  view: FitView | [number, number],
): Box | null {
  return unionBoxes(curves.filter((c) => c.visible).map((c) => curveFeatureBox(c, models, view)))
}

// ------------------------------------------------------------------ explicit

function explicitBox(
  curve: FittedCurve,
  spec: ModelSpec,
  models: Record<string, ModelSpec>,
  view: FitView,
): Box | null {
  const evalF = spec.evalExplicit
  if (!evalF) return null
  const f = (x: number): number => {
    try {
      const y = evalF.call(spec, curve.params, x)
      return typeof y === 'number' ? y : Number.NaN
    } catch {
      return Number.NaN
    }
  }

  // The curve's own domain: a sketch is restricted to the x-range of its ink.
  let dLo = -Infinity
  let dHi = Infinity
  const d = curve.domain
  if (d && !Number.isNaN(d[0]) && !Number.isNaN(d[1])) {
    dLo = Math.min(d[0], d[1])
    dHi = Math.max(d[0], d[1])
  }
  const [sLo, sHi] = searchRange(view)
  let lo = Number.isFinite(dLo) ? dLo : sLo
  let hi = Number.isFinite(dHi) ? dHi : sHi
  if (!Number.isFinite(dLo) && Number.isFinite(dHi) && !(hi > lo)) lo = dHi - (sHi - sLo)
  if (Number.isFinite(dLo) && !Number.isFinite(dHi) && !(hi > lo)) hi = dLo + (sHi - sLo)
  if (!(hi > lo)) return null
  const inDomain = (x: number): boolean => x >= dLo && x <= dHi
  const defined = (x: number): boolean => inDomain(x) && finite(f(x))

  // ---- the key points
  const analysed: FittedCurve = { ...curve, domain: [lo, hi] }
  const pts: Vec2[] = []
  for (const p of analyzeCurve(analysed, models)) {
    if (p.kind === 'intersection') continue
    if (finite(p.pos.x) && finite(p.pos.y)) pts.push({ x: p.pos.x, y: p.pos.y })
  }
  // The ends of a drawn piece: the value there, or just inside an open end.
  const keyXs: number[] = pts.map((p) => p.x)
  for (const [end, inward] of [[dLo, 1], [dHi, -1]] as const) {
    if (!Number.isFinite(end)) continue
    keyXs.push(end)
    let y = f(end)
    if (!finite(y)) y = f(end + inward * 1e-9 * Math.max(1, Math.abs(end)))
    if (finite(y)) pts.push({ x: end, y })
  }
  // Vertical asymptotes stand at key x's: both branches of 1/(x − 1) are
  // framed near the pole.
  for (const x of findPoles(analysed, models, [lo, hi])) if (finite(x)) keyXs.push(x)
  // The levels the ends lean on (eˣ → 0): key y's with no x of their own.
  const levels: number[] = []
  for (const a of findEndAsymptotes(curve, models)) {
    if (a.kind === 'line' && Math.abs(a.dir.y) < 1e-12 && finite(a.a.y)) levels.push(a.a.y)
  }

  // ---- x: the key x's nearest the view centre, padded and widened
  const [w0, w1] = viewX(view)
  const centre = Math.min(hi, Math.max(lo, (w0 + w1) / 2))
  // One x per place: tan's zero and inflection at kπ (and a pole found twice)
  // land a few ulps apart and would otherwise use up the MAX_KEY_XS budget.
  let xs: number[] = []
  for (const x of keyXs.filter(finite).sort((a, b) => a - b)) {
    const last = xs[xs.length - 1]
    if (last === undefined || x - last > 1e-6 * Math.max(1, Math.abs(x))) xs.push(x)
  }
  if (xs.length > MAX_KEY_XS) {
    xs = xs
      .slice()
      .sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre))
      .slice(0, MAX_KEY_XS)
      .sort((a, b) => a - b)
  }
  if (xs.length === 0) xs = [centre]
  const kx0 = xs[0]
  const kx1 = xs[xs.length - 1]
  const span = kx1 - kx0
  const pad = Math.max(0.1 * span, 0.5)
  let xa = kx0 - pad
  let xb = kx1 + pad
  if (xb - xa < MIN_WIDTH) {
    // The extra width goes where the curve is: √x and ln x frame to the
    // right of 0, not half of the frame on the empty side.
    const need = MIN_WIDTH - (xb - xa)
    const probe = (from: number, dir: number): boolean =>
      [0.25, 0.5, 0.75, 1].some((t) => defined(from + dir * t * need))
    const left = probe(xa, -1)
    const right = probe(xb, 1)
    if (left && !right) xa -= need
    else if (right && !left) xb += need
    else {
      xa -= need / 2
      xb += need / 2
    }
  }

  // ---- y: the key y's, and the values over [xa, xb] clipped to a band
  const tol = 1e-9 * Math.max(1, Math.abs(kx0), Math.abs(kx1))
  const keyYs = pts.filter((p) => p.x >= kx0 - tol && p.x <= kx1 + tol).map((p) => p.y)
  keyYs.push(...levels)
  const values: number[] = []
  const vLo = Math.max(xa, dLo)
  const vHi = Math.min(xb, dHi)
  if (vHi >= vLo) {
    for (let i = 0; i < VALUE_SAMPLES; i++) {
      const x = vLo + ((vHi - vLo) * i) / (VALUE_SAMPLES - 1)
      const y = f(x)
      if (finite(y)) values.push(y)
    }
  }
  if (keyYs.length === 0) {
    // Nothing but poles: the value nearest the middle of the frame anchors it.
    if (values.length === 0) return null
    keyYs.push(values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)])
  }
  const ky0 = Math.min(...keyYs)
  const ky1 = Math.max(...keyYs)
  // Room above and below the features, not the whole of a tail: x³ − 3x
  // (features within ±2) is framed to about ±5, not ±8.
  const half = Math.max(0.75 * (ky1 - ky0), 0.25 * (xb - xa), MIN_BAND)
  const bandLo = ky0 - half
  const bandHi = ky1 + half
  let ya = ky0
  let yb = ky1
  for (const y of values) {
    const c = Math.min(bandHi, Math.max(bandLo, y))
    if (c < ya) ya = c
    if (c > yb) yb = c
  }
  // The x-axis, when it is near (within 3 of the band): a horizontal line
  // y = 3 reads against it; y = x² + 100 does not drag it in.
  if (bandLo - 3 <= 0 && bandHi + 3 >= 0) {
    ya = Math.min(ya, 0)
    yb = Math.max(yb, 0)
  }
  const yPad = Math.max(0.05 * (yb - ya), 0.5)
  return { min: { x: xa, y: ya - yPad }, max: { x: xb, y: yb + yPad } }
}

// ------------------------------------------------------------------ implicit

function implicitBox(
  curve: FittedCurve,
  spec: ModelSpec,
  models: Record<string, ModelSpec>,
  view: FitView,
): Box | null {
  // A circle or an ellipse names its own extremes.
  if (curve.modelId === 'circle' || curve.modelId === 'ellipse') {
    const pts = analyzeCurve(curve, models)
      .map((p) => p.pos)
      .filter((p) => finite(p.x) && finite(p.y))
    const b = pointsBox(pts)
    if (b) return b
  }
  const F = spec.evalImplicit
  if (!F) return null
  const g = (x: number, y: number): number => {
    try {
      const v = F.call(spec, curve.params, x, y)
      return typeof v === 'number' ? v : Number.NaN
    } catch {
      return Number.NaN
    }
  }
  const [x0, x1] = searchRange(view)
  let [y0, y1] = SEARCH
  if (view.y && Number.isFinite(view.y[0]) && Number.isFinite(view.y[1]) && view.y[1] > view.y[0]) {
    y0 = Math.min(y0, view.y[0])
    y1 = Math.max(y1, view.y[1])
    if (y1 - y0 > SEARCH_MAX) {
      const c = (view.y[0] + view.y[1]) / 2
      y0 = c - SEARCH_MAX / 2
      y1 = c + SEARCH_MAX / 2
    }
  }
  const n = IMPLICIT_GRID
  const dx = (x1 - x0) / n
  const dy = (y1 - y0) / n
  const vals = new Float64Array((n + 1) * (n + 1))
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) vals[j * (n + 1) + i] = g(x0 + i * dx, y0 + j * dy)
  }
  const pts: Vec2[] = []
  const cross = (va: number, vb: number): number | null => {
    if (!Number.isFinite(va) || !Number.isFinite(vb)) return null
    if (va === 0) return 0
    if (va > 0 === vb > 0) return null
    return va / (va - vb)
  }
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const v = vals[j * (n + 1) + i]
      const x = x0 + i * dx
      const y = y0 + j * dy
      if (i < n) {
        const t = cross(v, vals[j * (n + 1) + i + 1])
        if (t !== null) pts.push({ x: x + t * dx, y })
      }
      if (j < n) {
        const t = cross(v, vals[(j + 1) * (n + 1) + i])
        if (t !== null) pts.push({ x, y: y + t * dy })
      }
    }
  }
  return pointsBox(pts)
}

function pointsBox(pts: readonly Vec2[]): Box | null {
  let out: Box | null = null
  for (const p of pts) {
    if (!out) out = { min: { ...p }, max: { ...p } }
    else {
      out.min.x = Math.min(out.min.x, p.x)
      out.min.y = Math.min(out.min.y, p.y)
      out.max.x = Math.max(out.max.x, p.x)
      out.max.y = Math.max(out.max.y, p.y)
    }
  }
  return out
}

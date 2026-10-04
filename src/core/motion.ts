// ============================================================================
// Parametric and polar curves, the AP Calculus BC way (src/core/motion.ts)
//
//   parametric   x = x(t), y = y(t),  a ≤ t ≤ b      a particle in the plane
//   polar        r = r(θ),            α ≤ θ ≤ β
//
// PARSER (additive, same wave — src/core/parse/index.ts): typed parametric
// curves, which the app cannot enter today. Accept, in t:
//     (2cos(t), 3sin(t))                 a bare ordered pair of t-expressions
//     (x, y) = (t^2, t^3 - 3t)           with the (x, y) = head
//     x = 2cos(t), y = 3sin(t)           two equations
//     … {0 <= t <= 2pi}  /  for 0 <= t <= 2pi   the t-interval (default
//                                        [0, 2π] for trig, [−10, 10] else)
//   → kind 'parametric', evalParametric(params, t), domain = the t-interval,
//   LaTeX as a pair \left(2\cos t,\ 3\sin t\right),\ 0\le t\le 2\pi. Sliders
//   work as everywhere. Polar lines keep parsing as today (r = …, θ-range).
//   Nothing that parses today may change.
//
// CALCULUS — pure functions over a curve and its model:
//   export function paramState(curve, models, t): ParamState
//       position, velocity ⟨x′, y′⟩, speed, acceleration ⟨x″, y″⟩, dy/dx =
//       y′/x′ (null when x′ = 0: vertical tangent), d²y/dx², the tangent
//       line — all at parameter t (for a polar curve, t is θ and x = r cos θ,
//       y = r sin θ, with dr/dθ too).
//   export function paramFeatures(curve, models): ParamFeatures
//       over the curve's parameter interval: horizontal tangents (y′ = 0,
//       x′ ≠ 0), vertical tangents (x′ = 0, y′ ≠ 0), singular points (both
//       0), where the particle is at rest, start and end points and the
//       direction of motion, arc length ∫√(x′² + y′²) dt, total distance
//       travelled vs displacement; for polar: points at the pole (r = 0),
//       max |r|, and the enclosed area ½∫r² dθ over the interval — each with
//       exact text where exact.ts recognises it.
//   export function polarArea(curve, models, a, b): { value, exact, text }
//       ½∫ₐᵇ r(θ)² dθ — the AP polar area, numeric with exact recognition.
//   export function paramArcLength(curve, models, a, b): number
//
// BUILDERS — families a teacher names:
//   export const PARAM_FAMILIES: ParamFamily[]
//       line through two points, circle, ellipse, cycloid, Lissajous, the
//       projectile (x = v₀cos α·t, y = h + v₀sin α·t − ½gt²), involute —
//       each with named parameters, defaults and a source template.
//   export const POLAR_FAMILIES: ParamFamily[]
//       rose a·cos(kθ) / a·sin(kθ) (petal count: k odd → k, even → 2k),
//       limaçon a + b·cos θ (inner loop when |a| < |b|, cardioid when
//       |a| = |b|, dimpled / convex otherwise), circle r = a·cos θ / a·sin θ,
//       lemniscate r² = a²cos 2θ (as r = a·sqrt(cos(2θ))), Archimedean
//       spiral a·θ, each with its classification sentence.
//   export function familySource(family, values): string
//   export function describePolar(src): string | null
//       "a rose with 3 petals, each of length 2", "a limaçon with an inner
//       loop", "a cardioid" — for any typed polar line that is one.
// ============================================================================

import type { FittedCurve, ModelSpec, Vec2 } from './types'
import { analyzeExpr, parseExpression, richardsonD1, richardsonD2 } from './parse'
import { exactForm, verifiedExact } from './exact'

export interface ParamState {
  t: number
  pos: Vec2
  velocity: Vec2
  speed: number
  acceleration: Vec2
  /** dy/dx = y′/x′; null at a vertical tangent. */
  slope: number | null
  /** d²y/dx²; null where undefined. */
  concavity: number | null
  /** polar only: r and dr/dθ at θ = t. */
  r?: number
  drdt?: number
}

export interface Labeled {
  t: number
  x: number
  y: number
  tText: string
  xText: string
  yText: string
}

export interface ParamFeatures {
  interval: [number, number]
  start: Labeled | null
  end: Labeled | null
  horizontalTangents: Labeled[]
  verticalTangents: Labeled[]
  /** Both derivatives zero (a cusp or a stop). */
  singular: Labeled[]
  arcLength: number
  /** Polar: θ where r = 0. */
  atPole: Labeled[]
  /** Polar: ½∫r²dθ over the interval (null for parametric). */
  area: { value: number; exact: boolean; text: string } | null
  sentences: string[]
}

export interface ParamFamily {
  id: string
  name: string
  kind: 'parametric' | 'polar'
  /** Named parameters with defaults, as text. */
  params: { name: string; label: string; value: string }[]
  /** Default interval as text, e.g. ['0', '2pi']. */
  interval: [string, string]
}

// ============================================================================
// Implementation notes
//
// THE CURVE AS A MOVING POINT. Every question below is asked of a Track: the
// curve's position as a function of its parameter — (x(t), y(t)) for a
// parametric curve, (r(θ)cos θ, r(θ)sin θ) for a polar one (an explicit
// y = f(x) is carried along as (t, f(t)), which costs nothing). The interval
// is the curve's own domain, or the default the renderer uses: [0, 2π] for
// polar and parametric curves, [−10, 10] for an explicit one.
//
// DERIVATIVES are Richardson-extrapolated central differences (the parser's
// richardsonD1 / richardsonD2, the same scheme src/core/calculus.ts uses). For
// a polar curve they are taken of r(θ) and composed by hand —
//   x′ = r′cos θ − r sin θ,          y′ = r′sin θ + r cos θ,
//   x″ = r″cos θ − 2r′sin θ − r cos θ,  y″ = r″sin θ + 2r′cos θ − r sin θ —
// which keeps the one numerical derivative on the smooth function.
//
// dy/dx = y′/x′ is null (a vertical tangent, or a singular point) when |x′|
// is ~0 relative to |y′| — within 1e-9 of it, or within the noise floor of
// the numerical derivative (1e-10 of the size of the numbers involved).
// d²y/dx² = (d/dt(dy/dx))/x′ = (y″x′ − y′x″)/x′³, null with the slope.
//
// TANGENTS AND SINGULAR POINTS. x′ and y′ are sampled at 1024 steps over the
// interval; every sign change is bisected, and a zero that only TOUCHES (x′ =
// 3t² at t = 0, 1 − cos t at t = 2π) is found by a golden-section refinement
// of the local minima of |x′|. A zero of x′ where y′ ≠ 0 is a vertical
// tangent, a zero of y′ where x′ ≠ 0 a horizontal one, and a t where both
// vanish is SINGULAR — a cusp, or the particle at rest — and is listed only
// there. On a closed curve the end of the interval is the start again, so a
// point at t = b that repeats one at t = a is not listed twice. A component
// that is constant (x = 3) has no isolated zeros and reports none.
//
// ARC LENGTH is ∫√(x′² + y′²) dt by adaptive Simpson, split at the singular
// points (where the speed has a corner) and over the runs where the curve is
// defined. It is the total distance travelled; the displacement is the
// straight distance from start to end.
//
// POLAR AREA is ½∫r² dθ over the interval, adaptive Simpson on the runs where
// r is defined. THE RETRACE RULE: when r(θ + π) = −r(θ) for every θ (a rose
// with k odd, the circle r = a·cos θ, …) the point at θ + π is the point at
// θ, so on an interval of length 2π the curve is traced TWICE. The interval's
// integral is still reported as computed (it is what was asked) together
// with the sentence "traced twice on 0 ≤ θ ≤ 2π; one trace is 0 ≤ θ ≤ π" and
// the area of that one trace.
//
// EXACT TEXT: a parameter found by a search is snapped with verifiedExact —
// the candidate must make the derivative (or r) vanish in double precision —
// and only then are the coordinates offered to exactForm; an integral is
// matched by exactForm at 1e-9 (the quadrature is good to ~1e-12). Anything
// else is printed to three decimals.
// ============================================================================

const TWO_PI = 2 * Math.PI
const MINUS = '−'

/** Samples used to bracket the zeros of x′, y′ and r. */
const SCAN_N = 1024
/** Samples used to find where an integrand is defined. */
const RUN_N = 256
/** Adaptive Simpson: evaluation budget and depth, as in calculus.ts. */
const QUAD_BUDGET = 40000
const QUAD_DEPTH = 50
/** An integral is matched to a closed form at this relative tolerance. */
const INTEGRAL_TOL = 1e-9
/** Each defined run is integrated as this many panels. */
const PANELS = 16

export type Fn = (t: number) => number

// ----------------------------------------------------------------------------
// The track
// ----------------------------------------------------------------------------

/** The curve as a moving point (exported for src/core/paramCalc.ts). */
export interface Track {
  kind: 'parametric' | 'polar' | 'explicit'
  interval: [number, number]
  X: Fn
  Y: Fn
  /** polar only */
  R?: Fn
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number.NaN)

function intervalOf(d: [number, number] | null | undefined, fallback: [number, number]): [number, number] {
  if (d && Number.isFinite(d[0]) && Number.isFinite(d[1]) && d[0] !== d[1]) {
    return d[0] < d[1] ? [d[0], d[1]] : [d[1], d[0]]
  }
  return [fallback[0], fallback[1]]
}

export function trackOf(curve: FittedCurve, models: Record<string, ModelSpec>): Track | null {
  const spec = curve ? models?.[curve.modelId] : undefined
  if (!spec) return null
  const p = curve.params
  if (curve.kind === 'parametric' && spec.evalParametric) {
    const at = (t: number): Vec2 => {
      try {
        const v = spec.evalParametric!(p, t)
        return v ?? { x: Number.NaN, y: Number.NaN }
      } catch {
        return { x: Number.NaN, y: Number.NaN }
      }
    }
    return {
      kind: 'parametric',
      interval: intervalOf(curve.domain, [0, TWO_PI]),
      X: (t) => num(at(t).x),
      Y: (t) => num(at(t).y),
    }
  }
  if (curve.kind === 'polar' && spec.evalPolar) {
    const R: Fn = (t) => {
      try { return num(spec.evalPolar!(p, t)) } catch { return Number.NaN }
    }
    return {
      kind: 'polar',
      interval: intervalOf(curve.domain, [0, TWO_PI]),
      X: (t) => R(t) * Math.cos(t),
      Y: (t) => R(t) * Math.sin(t),
      R,
    }
  }
  if (curve.kind === 'explicit' && spec.evalExplicit) {
    const F: Fn = (t) => {
      try { return num(spec.evalExplicit!(p, t)) } catch { return Number.NaN }
    }
    return { kind: 'explicit', interval: intervalOf(curve.domain, [-10, 10]), X: (t) => t, Y: F }
  }
  return null
}

interface Jet {
  x: number; y: number
  x1: number; y1: number
  x2: number; y2: number
  r?: number; r1?: number
}

function jet(tr: Track, t: number): Jet {
  if (tr.R) {
    const R = tr.R
    const r = R(t), r1 = richardsonD1(R, t), r2 = richardsonD2(R, t)
    const c = Math.cos(t), s = Math.sin(t)
    return {
      x: r * c, y: r * s,
      x1: r1 * c - r * s, y1: r1 * s + r * c,
      x2: r2 * c - 2 * r1 * s - r * c, y2: r2 * s + 2 * r1 * c - r * s,
      r, r1,
    }
  }
  return {
    x: tr.X(t), y: tr.Y(t),
    x1: richardsonD1(tr.X, t), y1: richardsonD1(tr.Y, t),
    x2: richardsonD2(tr.X, t), y2: richardsonD2(tr.Y, t),
  }
}

/** x′(t), y′(t) — the velocity alone, for scans. */
function velocity(tr: Track): { vx: Fn; vy: Fn } {
  if (tr.R) {
    const R = tr.R
    return {
      vx: (t) => richardsonD1(R, t) * Math.cos(t) - R(t) * Math.sin(t),
      vy: (t) => richardsonD1(R, t) * Math.sin(t) + R(t) * Math.cos(t),
    }
  }
  const X = tr.X, Y = tr.Y
  return { vx: (t) => richardsonD1(X, t), vy: (t) => richardsonD1(Y, t) }
}

/** The noise floor of a numerical first derivative at this point. */
const noiseAt = (t: number, x: number, y: number): number =>
  1e-10 * Math.max(1, Math.abs(t), Math.abs(x), Math.abs(y))

/** |x′| ~ 0 relative to |y′|: dy/dx does not exist here. */
function xPrimeVanishes(t: number, j: Jet): boolean {
  const ax = Math.abs(j.x1)
  return !(ax > 1e-9 * Math.abs(j.y1) && ax > noiseAt(t, j.x, j.y))
}

// ----------------------------------------------------------------------------
// paramState
// ----------------------------------------------------------------------------

export function paramState(curve: FittedCurve, models: Record<string, ModelSpec>, t: number): ParamState {
  const tr = trackOf(curve, models)
  const NaN2 = { x: Number.NaN, y: Number.NaN }
  if (!tr || !Number.isFinite(t)) {
    return { t, pos: NaN2, velocity: NaN2, speed: Number.NaN, acceleration: NaN2, slope: null, concavity: null }
  }
  const j = jet(tr, t)
  const speed = Math.hypot(j.x1, j.y1)
  let slope: number | null = null
  let concavity: number | null = null
  if (Number.isFinite(j.x1) && Number.isFinite(j.y1) && !xPrimeVanishes(t, j)) {
    slope = j.y1 / j.x1
    const c = (j.y2 * j.x1 - j.y1 * j.x2) / (j.x1 * j.x1 * j.x1)
    concavity = Number.isFinite(c) ? c : null
  }
  const out: ParamState = {
    t,
    pos: { x: j.x, y: j.y },
    velocity: { x: j.x1, y: j.y1 },
    speed,
    acceleration: { x: j.x2, y: j.y2 },
    slope,
    concavity,
  }
  if (tr.kind === 'polar') {
    out.r = j.r
    out.drdt = j.r1
  }
  return out
}

// ----------------------------------------------------------------------------
// Zeros — sign changes and touches
// ----------------------------------------------------------------------------

function bisect(f: Fn, a: number, b: number): number {
  let lo = a, hi = b
  let flo = f(lo)
  for (let i = 0; i < 100; i++) {
    const m = 0.5 * (lo + hi)
    if (m === lo || m === hi) break
    const fm = f(m)
    if (fm === 0) return m
    if (!Number.isFinite(fm)) break
    if (fm > 0 === flo > 0) { lo = m; flo = fm } else hi = m
  }
  return 0.5 * (lo + hi)
}

/** Minimum of g on [a, b], golden section. */
function goldenMin(g: Fn, a: number, b: number): number {
  const phi = 0.6180339887498949
  let lo = a, hi = b
  let x1 = hi - (hi - lo) * phi, x2 = lo + (hi - lo) * phi
  let f1 = g(x1), f2 = g(x2)
  for (let i = 0; i < 120; i++) {
    if (!(Number.isFinite(f1) && Number.isFinite(f2))) break
    if (f1 < f2) { hi = x2; x2 = x1; f2 = f1; x1 = hi - (hi - lo) * phi; f1 = g(x1) }
    else { lo = x1; x1 = x2; f1 = f2; x2 = lo + (hi - lo) * phi; f2 = g(x2) }
    if (hi - lo < 1e-15 * Math.max(1, Math.abs(lo))) break
  }
  return 0.5 * (lo + hi)
}

export interface Scanned { ts: number[]; fs: number[]; scale: number }

function sample(f: Fn, a: number, b: number, n: number): Scanned {
  const ts: number[] = [], fs: number[] = []
  let scale = 0
  for (let i = 0; i <= n; i++) {
    const t = i === n ? b : a + ((b - a) * i) / n
    const v = f(t)
    ts.push(t); fs.push(v)
    if (Number.isFinite(v)) scale = Math.max(scale, Math.abs(v))
  }
  return { ts, fs, scale }
}

/**
 * Every zero of f on [a, b]: bisected sign changes, refined touches, and an
 * end of the interval where f is already ~0. `tol` is what counts as zero.
 * A function that is ~0 everywhere has no isolated zeros: [].
 */
export function zerosOf(f: Fn, a: number, b: number, tol: number, s?: Scanned): number[] {
  const { ts, fs } = s ?? sample(f, a, b, SCAN_N)
  const n = ts.length - 1
  const out: number[] = []
  let allZero = true
  for (const v of fs) if (Number.isFinite(v) && Math.abs(v) > tol) { allZero = false; break }
  if (allZero) return out
  if (Number.isFinite(fs[0]) && Math.abs(fs[0]) <= tol) out.push(ts[0])
  if (Number.isFinite(fs[n]) && Math.abs(fs[n]) <= tol) out.push(ts[n])
  for (let i = 0; i < n; i++) {
    const u = fs[i], v = fs[i + 1]
    if (!Number.isFinite(u) || !Number.isFinite(v)) continue
    if (u === 0 && i > 0) { out.push(ts[i]); continue }
    if (u * v < 0) out.push(bisect(f, ts[i], ts[i + 1]))
  }
  for (let i = 1; i < n; i++) {
    const p = fs[i - 1], q = fs[i], r = fs[i + 1]
    if (!Number.isFinite(p) || !Number.isFinite(q) || !Number.isFinite(r)) continue
    if (p * r < 0 || p * q < 0 || q * r < 0) continue // a crossing: bisected above
    const aq = Math.abs(q)
    if (!(aq <= Math.abs(p) && aq <= Math.abs(r))) continue
    if (aq === Math.abs(p) && aq === Math.abs(r)) continue
    const m = goldenMin((t) => Math.abs(f(t)), ts[i - 1], ts[i + 1])
    if (Math.abs(f(m)) <= tol) out.push(m)
  }
  out.sort((x, y) => x - y)
  const kept: number[] = []
  const gap = 1e-7 * (b - a)
  for (const t of out) {
    if (kept.length > 0 && t - kept[kept.length - 1] <= gap) continue
    kept.push(t)
  }
  return kept
}

// ----------------------------------------------------------------------------
// Integration — adaptive Simpson over the runs where the integrand is defined
// ----------------------------------------------------------------------------

function adaptiveSimpson(f: Fn, a: number, b: number, tol: number): number {
  let evals = 0
  let failed = false
  const ev = (x: number): number => { evals++; return f(x) }
  const fa = ev(a), fb = ev(b), fm = ev((a + b) / 2)
  if (![fa, fb, fm].every(Number.isFinite)) return Number.NaN
  const simp = (x0: number, x1: number, y0: number, ym: number, y1: number): number =>
    ((x1 - x0) / 6) * (y0 + 4 * ym + y1)
  const go = (
    x0: number, x1: number, y0: number, ym: number, y1: number,
    whole: number, eps: number, depth: number,
  ): number => {
    if (failed) return whole
    const mid = (x0 + x1) / 2
    const ylm = ev((x0 + mid) / 2), yrm = ev((mid + x1) / 2)
    if (!Number.isFinite(ylm) || !Number.isFinite(yrm)) { failed = true; return whole }
    const left = simp(x0, mid, y0, ylm, ym)
    const right = simp(mid, x1, ym, yrm, y1)
    const delta = left + right - whole
    // never believe the first two levels: a symmetric integrand can make
    // Simpson agree with itself by coincidence (½(1 + cos θ)² over [0, 2π])
    if (depth >= QUAD_DEPTH || evals >= QUAD_BUDGET || (depth >= 2 && Math.abs(delta) <= 15 * eps)) {
      return left + right + delta / 15
    }
    return go(x0, mid, y0, ylm, ym, left, eps / 2, depth + 1) + go(mid, x1, ym, yrm, y1, right, eps / 2, depth + 1)
  }
  const v = go(a, b, fa, fm, fb, simp(a, b, fa, fm, fb), Math.max(tol, 1e-300), 0)
  return failed ? Number.NaN : v
}

/** The edge between a defined sample `inside` and an undefined one `outside`. */
function definedEdge(f: Fn, inside: number, outside: number): number {
  let a = inside, b = outside
  for (let i = 0; i < 60; i++) {
    const m = 0.5 * (a + b)
    if (m === a || m === b) break
    if (Number.isFinite(f(m))) a = m; else b = m
  }
  return a
}

/** ∫ₐᵇ f over the runs where f is defined (an undefined stretch adds nothing). */
export function integrate(f: Fn, a: number, b: number): number {
  if (a === b) return 0
  if (a > b) return -integrate(f, b, a)
  const { ts, fs, scale } = sample(f, a, b, RUN_N)
  const tol = Math.max(1e-13 * Math.max(scale, 1e-300) * (b - a), 1e-300)
  let total = 0
  let i = 0
  const n = ts.length - 1
  while (i <= n) {
    if (!Number.isFinite(fs[i])) { i++; continue }
    let j = i
    while (j < n && Number.isFinite(fs[j + 1])) j++
    const lo = i > 0 ? definedEdge(f, ts[i], ts[i - 1]) : ts[i]
    const hi = j < n ? definedEdge(f, ts[j], ts[j + 1]) : ts[j]
    if (hi > lo) {
      // panels first, so no single Simpson estimate spans a whole period
      for (let k = 0; k < PANELS; k++) {
        const p0 = lo + ((hi - lo) * k) / PANELS
        const p1 = k === PANELS - 1 ? hi : lo + ((hi - lo) * (k + 1)) / PANELS
        const v = adaptiveSimpson(f, p0, p1, tol / PANELS)
        if (!Number.isFinite(v)) return Number.NaN
        total += v
      }
    }
    i = j + 1
  }
  return total
}

// ----------------------------------------------------------------------------
// Text
// ----------------------------------------------------------------------------

/** Three decimals, true minus, no −0. */
function dec(v: number): string {
  if (!Number.isFinite(v)) return 'undefined'
  let r = Number(v.toFixed(3))
  if (Object.is(r, -0)) r = 0
  return r < 0 ? MINUS + String(-r) : String(r)
}

/** A value that carries full precision: exact when exact.ts says so. */
function fullText(v: number): { text: string; exact: boolean } {
  const f = exactForm(v)
  return f ? { text: f.text, exact: true } : { text: dec(v), exact: false }
}

/** An integral: matched at INTEGRAL_TOL. */
function integralText(v: number): { value: number; exact: boolean; text: string } {
  const f = exactForm(v, { tol: INTEGRAL_TOL })
  return f ? { value: f.value, exact: true, text: f.text } : { value: v, exact: false, text: dec(v) }
}

/**
 * A point of the curve at a parameter that was searched for: the parameter
 * is snapped to a closed form the curve agrees with (`check`), and only a
 * snapped parameter gets exact coordinates.
 */
function labeled(tr: Track, t: number, check?: (c: number) => boolean): Labeled {
  let tt = t
  let tText: string
  let snapped = false
  const form = check ? verifiedExact(t, check) : exactForm(t)
  if (form) { tt = form.value; tText = form.text; snapped = true } else tText = dec(t)
  const x = tr.X(tt), y = tr.Y(tt)
  const xText = snapped ? fullText(x).text : dec(x)
  const yText = snapped ? fullText(y).text : dec(y)
  return { t: tt, x, y, tText, xText, yText }
}

/** "a", "a and b", "a, b and c" */
function listText(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

const paramName = (tr: Track): string => (tr.kind === 'polar' ? 'θ' : tr.kind === 'explicit' ? 'x' : 't')

function intervalText(tr: Track, a: number, b: number): string {
  const v = paramName(tr)
  return `${fullText(a).text} ≤ ${v} ≤ ${fullText(b).text}`
}

// ----------------------------------------------------------------------------
// Analysis shared by paramFeatures and paramArcLength
// ----------------------------------------------------------------------------

export interface Crit {
  vScale: number
  horizontal: number[]
  vertical: number[]
  singular: number[]
  checkX: (c: number) => boolean
  checkY: (c: number) => boolean
  checkBoth: (c: number) => boolean
}

export function critical(tr: Track, a: number, b: number): Crit {
  const { vx, vy } = velocity(tr)
  const sx = sample(vx, a, b, SCAN_N)
  const sy = sample(vy, a, b, SCAN_N)
  const vScale = Math.max(sx.scale, sy.scale)
  const empty: Crit = {
    vScale, horizontal: [], vertical: [], singular: [],
    checkX: () => false, checkY: () => false, checkBoth: () => false,
  }
  if (!(vScale > 0)) return empty
  const zTol = 1e-7 * vScale
  const xr = zerosOf(vx, a, b, zTol, sx)
  const yr = zerosOf(vy, a, b, zTol, sy)
  const small = 1e-6 * vScale
  const singular: number[] = []
  const vertical: number[] = []
  const horizontal: number[] = []
  const near = (list: number[], t: number): boolean =>
    list.some((u) => Math.abs(u - t) <= 1e-6 * Math.max(1, b - a))
  for (const t of xr) (Math.abs(vy(t)) <= small ? singular : vertical).push(t)
  for (const t of yr) {
    if (Math.abs(vx(t)) <= small) { if (!near(singular, t)) singular.push(t) }
    else horizontal.push(t)
  }
  singular.sort((p, q) => p - q)
  // check tolerances for snapping to a closed form: the derivative itself
  // must vanish (to its own noise) at the candidate
  const cTol = 1e-8 * vScale
  return {
    vScale,
    horizontal,
    vertical,
    singular,
    checkX: (c) => Math.abs(vx(c)) <= cTol,
    checkY: (c) => Math.abs(vy(c)) <= cTol,
    checkBoth: (c) => Math.abs(vx(c)) <= cTol && Math.abs(vy(c)) <= cTol,
  }
}

function speedOf(tr: Track): Fn {
  const { vx, vy } = velocity(tr)
  return (t) => Math.hypot(vx(t), vy(t))
}

function arcLengthWith(tr: Track, a: number, b: number, cuts: number[]): number {
  const sp = speedOf(tr)
  const pts = [a, ...cuts.filter((c) => c > a && c < b).sort((p, q) => p - q), b]
  let total = 0
  for (let i = 0; i + 1 < pts.length; i++) {
    const v = integrate(sp, pts[i], pts[i + 1])
    if (!Number.isFinite(v)) return Number.NaN
    total += v
  }
  return total
}

// ----------------------------------------------------------------------------
// paramFeatures
// ----------------------------------------------------------------------------

export function paramFeatures(curve: FittedCurve, models: Record<string, ModelSpec>): ParamFeatures {
  const tr = trackOf(curve, models)
  if (!tr) {
    return {
      interval: [0, 0], start: null, end: null, horizontalTangents: [], verticalTangents: [],
      singular: [], arcLength: 0, atPole: [], area: null, sentences: [],
    }
  }
  const [a, b] = tr.interval
  const v = paramName(tr)
  const crit = critical(tr, a, b)

  const start = labeled(tr, a)
  const end = labeled(tr, b)
  const size = Math.max(1, Math.abs(start.x), Math.abs(start.y), Math.abs(end.x), Math.abs(end.y))
  const closed =
    Number.isFinite(start.x) && Number.isFinite(end.x) &&
    Math.hypot(end.x - start.x, end.y - start.y) <= 1e-9 * size

  // a closed curve's t = b is its t = a: list the point once
  const dropEnd = (ts: number[]): number[] => {
    if (!closed || ts.length < 2) return ts
    const eps = 1e-7 * (b - a)
    return Math.abs(ts[0] - a) <= eps && Math.abs(ts[ts.length - 1] - b) <= eps ? ts.slice(0, -1) : ts
  }
  const horizontalTangents = dropEnd(crit.horizontal).map((t) => labeled(tr, t, crit.checkY))
  const verticalTangents = dropEnd(crit.vertical).map((t) => labeled(tr, t, crit.checkX))
  const singular = dropEnd(crit.singular).map((t) => labeled(tr, t, crit.checkBoth))

  const arcLength = arcLengthWith(tr, a, b, crit.singular)
  const sentences: string[] = []

  // ---- where it goes -------------------------------------------------------
  if (tr.kind === 'polar') {
    sentences.push(`traced counterclockwise as θ increases from ${fullText(a).text} to ${fullText(b).text}`)
  } else if (closed) {
    const { vx, vy } = velocity(tr)
    const signed = 0.5 * integrate((t) => tr.X(t) * vy(t) - tr.Y(t) * vx(t), a, b)
    if (Number.isFinite(signed) && Math.abs(signed) > 1e-9 * size * size) {
      sentences.push(
        `the particle moves ${signed > 0 ? 'counterclockwise' : 'clockwise'} around a closed curve, ` +
          `starting and ending at (${start.xText}, ${start.yText})`,
      )
    } else {
      sentences.push(`the particle starts and ends at (${start.xText}, ${start.yText})`)
    }
  } else {
    sentences.push(
      `the particle moves from (${start.xText}, ${start.yText}) at ${v} = ${start.tText} ` +
        `to (${end.xText}, ${end.yText}) at ${v} = ${end.tText}`,
    )
  }

  const at = (ls: Labeled[]): string => `${v} = ${listText(ls.map((l) => l.tText))}`
  if (horizontalTangents.length > 0) {
    sentences.push(`horizontal tangent${horizontalTangents.length > 1 ? 's' : ''} at ${at(horizontalTangents)}`)
  }
  if (verticalTangents.length > 0) {
    sentences.push(`vertical tangent${verticalTangents.length > 1 ? 's' : ''} at ${at(verticalTangents)}`)
  }
  if (singular.length > 0) {
    sentences.push(
      `${v === 't' ? 'the particle is at rest' : 'dx/dθ = dy/dθ = 0'} at ${at(singular)} ` +
        `(no tangent direction there: a cusp or a stop)`,
    )
  }
  if (Number.isFinite(arcLength)) {
    const L = integralText(arcLength)
    sentences.push(`arc length ${L.exact ? '=' : '≈'} ${L.text} over ${intervalText(tr, a, b)}`)
    if (tr.kind !== 'polar' && !closed) {
      const disp = Math.hypot(end.x - start.x, end.y - start.y)
      if (Number.isFinite(disp)) {
        const D = fullText(disp)
        sentences.push(`displacement ${D.exact ? '=' : '≈'} ${D.text}; distance traveled ${L.exact ? '=' : '≈'} ${L.text}`)
      }
    }
  }

  // ---- polar ----------------------------------------------------------------
  let atPole: Labeled[] = []
  let area: ParamFeatures['area'] = null
  if (tr.kind === 'polar' && tr.R) {
    const R = tr.R
    const sr = sample(R, a, b, SCAN_N)
    const rMax = sr.scale
    if (rMax > 0) {
      const poleTol = 1e-9 * rMax
      atPole = dropEnd(zerosOf(R, a, b, poleTol, sr)).map((t) => {
        const form = verifiedExact(t, (c) => Math.abs(R(c)) <= poleTol)
        const tt = form ? form.value : t
        return { t: tt, x: 0, y: 0, tText: form ? form.text : dec(t), xText: '0', yText: '0' }
      })
      if (atPole.length > 0) sentences.push(`at the pole (r = 0) when θ = ${listText(atPole.map((l) => l.tText))}`)

      // max |r|, first occurrence
      let k = 0
      for (let i = 0; i < sr.fs.length; i++) {
        if (Number.isFinite(sr.fs[i]) && Math.abs(sr.fs[i]) > Math.abs(sr.fs[k]) + 1e-12 * rMax) k = i
      }
      const lo = sr.ts[Math.max(0, k - 1)], hi = sr.ts[Math.min(sr.ts.length - 1, k + 1)]
      const tm = goldenMin((t) => -Math.abs(R(t)), lo, hi)
      const tBest = Math.abs(R(tm)) >= Math.abs(sr.fs[k]) ? tm : sr.ts[k]
      const mv = Math.abs(R(tBest))
      const mForm = exactForm(mv, { tol: 1e-9 })
      const tForm = verifiedExact(tBest, (c) => Math.abs(Math.abs(R(c)) - mv) <= 1e-9 * rMax)
      sentences.push(
        `max |r| ${mForm ? '=' : '≈'} ${mForm ? mForm.text : dec(mv)} at θ = ${tForm ? tForm.text : dec(tBest)}`,
      )
    }

    area = polarArea(curve, models, a, b)
    if (area) {
      sentences.push(`area ½∫r² dθ over ${intervalText(tr, a, b)} ${area.exact ? '=' : '≈'} ${area.text}`)
      const retrace = retraces(R, a)
      const len = b - a
      if (retrace && Math.abs(len - TWO_PI) <= 1e-9 * TWO_PI) {
        const one = polarArea(curve, models, a, a + Math.PI)
        sentences.push(
          `traced twice on ${intervalText(tr, a, b)}; one trace is ${intervalText(tr, a, a + Math.PI)}` +
            (one ? `, enclosing area ${one.exact ? '' : '≈ '}${one.text}` : ''),
        )
      } else if (retrace && len > Math.PI * (1 + 1e-9)) {
        sentences.push(`the curve repeats itself every π of θ, so ${intervalText(tr, a, b)} traces part of it more than once`)
      }
      let neg = false, pos = false
      for (const r of sr.fs) { if (r < -1e-9 * rMax) neg = true; else if (r > 1e-9 * rMax) pos = true }
      if (neg && pos && !retrace) {
        sentences.push('r < 0 on part of the interval: those points plot on the opposite side of the pole')
      }
    }
  }

  return {
    interval: [a, b],
    start,
    end,
    horizontalTangents,
    verticalTangents,
    singular,
    arcLength,
    atPole,
    area,
    sentences,
  }
}

/** r(θ + π) = −r(θ) for all θ: the point at θ + π IS the point at θ. */
function retraces(R: Fn, a: number): boolean {
  let seen = 0
  let scale = 0
  const pairs: [number, number][] = []
  for (let i = 0; i < 97; i++) {
    const t = a + (Math.PI * (i + 0.37)) / 97
    const u = R(t), w = R(t + Math.PI)
    if (Number.isFinite(u) !== Number.isFinite(w)) return false
    if (!Number.isFinite(u)) continue
    pairs.push([u, w])
    scale = Math.max(scale, Math.abs(u))
    seen++
  }
  if (seen < 10 || !(scale > 0)) return false
  return pairs.every(([u, w]) => Math.abs(u + w) <= 1e-9 * scale)
}

// ----------------------------------------------------------------------------
// polarArea / paramArcLength
// ----------------------------------------------------------------------------

export function polarArea(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  a: number,
  b: number,
): { value: number; exact: boolean; text: string } | null {
  const tr = trackOf(curve, models)
  if (!tr || !tr.R || !Number.isFinite(a) || !Number.isFinite(b)) return null
  const R = tr.R
  const v = integrate((t) => { const r = R(t); return 0.5 * r * r }, a, b)
  if (!Number.isFinite(v)) return null
  return integralText(v)
}

export function paramArcLength(curve: FittedCurve, models: Record<string, ModelSpec>, a: number, b: number): number {
  const tr = trackOf(curve, models)
  if (!tr || !Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN
  if (a === b) return 0
  const lo = Math.min(a, b), hi = Math.max(a, b)
  const crit = critical(tr, lo, hi)
  return arcLengthWith(tr, lo, hi, crit.singular)
}

// ----------------------------------------------------------------------------
// Families
// ----------------------------------------------------------------------------

type Vals = Record<string, string>

/** A plain decimal literal, sign allowed: safe to write in front of a factor. */
const LIT = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/

/** v · body, simplified for 0, 1 and −1; null when the term vanishes. */
function times(v: string, body: string): string | null {
  const s = v.trim()
  if (LIT.test(s)) {
    const n = Number(s)
    if (n === 0) return null
    if (n === 1) return body
    if (n === -1) return `-${body}`
    return /^[0-9.]/.test(body) ? `${s}*${body}` : `${s}${body}`
  }
  return `(${s})*${body}`
}

/** v · (inner): the brackets only when there is a coefficient. */
function timesGroup(v: string, inner: string): string | null {
  const s = v.trim()
  if (LIT.test(s) && Number(s) === 1) return inner
  return times(s, `(${inner})`)
}

/** A constant term of a sum; null for 0. */
function constant(v: string): string | null {
  const s = v.trim()
  if (LIT.test(s)) return Number(s) === 0 ? null : s
  // a term of a sum needs no brackets: + and − are the loosest operators
  return s
}

const negate = (term: string | null): string | null =>
  term === null ? null : term.startsWith('-') ? term.slice(1) : `-${term}`

function sum(terms: (string | null)[]): string {
  const ts = terms.filter((t): t is string => t !== null && t !== '')
  if (ts.length === 0) return '0'
  let out = ts[0]
  for (const t of ts.slice(1)) out += t.startsWith('-') ? ` - ${t.slice(1)}` : ` + ${t}`
  return out
}

/** A literal's value as the shortest clean decimal. */
const clean = (n: number): string => String(Number(n.toPrecision(12)))

function gcd(a: number, b: number): number {
  a = Math.abs(a); b = Math.abs(b)
  while (b) { const t = a % b; a = b; b = t }
  return a
}

/** An angle typed in degrees, as radians text: 45 → pi/4. */
function degrees(v: string): string {
  const s = v.trim()
  if (/^-?\d+$/.test(s)) {
    const n = parseInt(s, 10)
    if (n === 0) return '0'
    const g = gcd(n, 180)
    const p = n / g, q = 180 / g
    const head = p === 1 ? 'pi' : p === -1 ? '-pi' : `${p}pi`
    return q === 1 ? head : `${head}/${q}`
  }
  return `(${s})*pi/180`
}

/** The value of a constant text (NaN when it is not one). */
function valueOf(text: string): number {
  const a = analyzeExpr(text)
  return a.ok && a.free.length === 0 ? a.value : Number.NaN
}

/** Flight time of the projectile: the positive root of h + v₀sin α·t − ½gt² = 0. */
function landing(v0: number, alphaDeg: number, h: number, g: number): number {
  const vy = v0 * Math.sin((alphaDeg * Math.PI) / 180)
  const T = (vy + Math.sqrt(vy * vy + 2 * g * h)) / g
  return Number.isFinite(T) && T > 0 ? T : Number.NaN
}

const flightText = (T: number): string => (Number.isFinite(T) ? clean(Number(T.toFixed(3))) : '2')

type Built = { x: string; y: string } | { r: string }

const BUILD: Record<string, (v: Vals) => Built> = {
  // ---- parametric -----------------------------------------------------------
  line: (v) => {
    const d = (p: string, q: string): string =>
      LIT.test(p.trim()) && LIT.test(q.trim()) ? clean(Number(q) - Number(p)) : `(${q}) - (${p})`
    return {
      x: sum([constant(v.x1), times(d(v.x1, v.x2), 't')]),
      y: sum([constant(v.y1), times(d(v.y1, v.y2), 't')]),
    }
  },
  circle: (v) => ({
    x: sum([constant(v.h), times(v.a, 'cos(t)')]),
    y: sum([constant(v.k), times(v.a, 'sin(t)')]),
  }),
  ellipse: (v) => ({
    x: sum([constant(v.h), times(v.a, 'cos(t)')]),
    y: sum([constant(v.k), times(v.b, 'sin(t)')]),
  }),
  cycloid: (v) => ({
    x: timesGroup(v.a, 't - sin(t)') ?? '0',
    y: timesGroup(v.a, '1 - cos(t)') ?? '0',
  }),
  lissajous: (v) => ({
    x: times(v.A, `sin(${sum([times(v.a, 't'), constant(v.delta)])})`) ?? '0',
    y: times(v.B, `sin(${times(v.b, 't') ?? '0'})`) ?? '0',
  }),
  projectile: (v) => {
    const ang = degrees(v.alpha)
    const g = v.g.trim()
    const half = LIT.test(g) ? clean(Number(g) / 2) : `(${g})/2`
    return {
      x: times(v.v0, `cos(${ang}) t`) ?? '0',
      y: sum([constant(v.h), times(v.v0, `sin(${ang}) t`), negate(times(half, 't^2'))]),
    }
  },
  involute: (v) => ({
    x: timesGroup(v.a, 'cos(t) + t sin(t)') ?? '0',
    y: timesGroup(v.a, 'sin(t) - t cos(t)') ?? '0',
  }),
  // ---- polar ----------------------------------------------------------------
  roseCos: (v) => ({ r: times(v.a, `cos(${times(v.k, 'θ') ?? '0'})`) ?? '0' }),
  roseSin: (v) => ({ r: times(v.a, `sin(${times(v.k, 'θ') ?? '0'})`) ?? '0' }),
  limacon: (v) => ({ r: sum([constant(v.a), times(v.b, 'cos(θ)')]) }),
  limaconSin: (v) => ({ r: sum([constant(v.a), times(v.b, 'sin(θ)')]) }),
  circleCos: (v) => ({ r: times(v.a, 'cos(θ)') ?? '0' }),
  circleSin: (v) => ({ r: times(v.a, 'sin(θ)') ?? '0' }),
  lemniscate: (v) => ({ r: times(v.a, 'sqrt(cos(2θ))') ?? '0' }),
  spiral: (v) => ({ r: times(v.a, 'θ') ?? '0' }),
}

const P = (name: string, label: string, value: string) => ({ name, label, value })

export const PARAM_FAMILIES: ParamFamily[] = [
  {
    id: 'line', name: 'Line through two points', kind: 'parametric',
    params: [P('x1', 'x₁', '0'), P('y1', 'y₁', '0'), P('x2', 'x₂', '4'), P('y2', 'y₂', '3')],
    interval: ['0', '1'],
  },
  {
    id: 'circle', name: 'Circle', kind: 'parametric',
    params: [P('h', 'center x', '0'), P('k', 'center y', '0'), P('a', 'radius', '2')],
    interval: ['0', '2pi'],
  },
  {
    id: 'ellipse', name: 'Ellipse', kind: 'parametric',
    params: [P('h', 'center x', '0'), P('k', 'center y', '0'), P('a', 'x semi-axis a', '3'), P('b', 'y semi-axis b', '2')],
    interval: ['0', '2pi'],
  },
  {
    id: 'cycloid', name: 'Cycloid', kind: 'parametric',
    params: [P('a', 'radius of the rolling circle', '1')],
    interval: ['0', '2pi'],
  },
  {
    id: 'lissajous', name: 'Lissajous curve', kind: 'parametric',
    params: [P('A', 'x amplitude A', '2'), P('a', 'x frequency a', '3'), P('delta', 'phase δ', 'pi/2'), P('B', 'y amplitude B', '2'), P('b', 'y frequency b', '2')],
    interval: ['0', '2pi'],
  },
  {
    id: 'projectile', name: 'Projectile', kind: 'parametric',
    params: [
      P('v0', 'launch speed v₀', '20'),
      P('alpha', 'launch angle α (degrees)', '45'),
      P('h', 'launch height h', '0'),
      P('g', 'g (9.8 m/s² or 32 ft/s²)', '9.8'),
    ],
    interval: ['0', flightText(landing(20, 45, 0, 9.8))],
  },
  {
    id: 'involute', name: 'Involute of a circle', kind: 'parametric',
    params: [P('a', 'radius of the circle', '1')],
    interval: ['0', '2pi'],
  },
]

export const POLAR_FAMILIES: ParamFamily[] = [
  {
    id: 'roseCos', name: 'Rose r = a cos kθ', kind: 'polar',
    params: [P('a', 'petal length a', '2'), P('k', 'k (odd: k petals, even: 2k)', '3')],
    interval: ['0', '2pi'],
  },
  {
    id: 'roseSin', name: 'Rose r = a sin kθ', kind: 'polar',
    params: [P('a', 'petal length a', '2'), P('k', 'k (odd: k petals, even: 2k)', '2')],
    interval: ['0', '2pi'],
  },
  {
    id: 'limacon', name: 'Limaçon r = a + b cos θ', kind: 'polar',
    params: [P('a', 'a', '1'), P('b', 'b', '2')],
    interval: ['0', '2pi'],
  },
  {
    id: 'limaconSin', name: 'Limaçon r = a + b sin θ', kind: 'polar',
    params: [P('a', 'a', '1'), P('b', 'b', '1')],
    interval: ['0', '2pi'],
  },
  {
    id: 'circleCos', name: 'Circle r = a cos θ', kind: 'polar',
    params: [P('a', 'diameter a', '2')],
    interval: ['0', 'pi'],
  },
  {
    id: 'circleSin', name: 'Circle r = a sin θ', kind: 'polar',
    params: [P('a', 'diameter a', '2')],
    interval: ['0', 'pi'],
  },
  {
    id: 'lemniscate', name: 'Lemniscate r² = a² cos 2θ', kind: 'polar',
    params: [P('a', 'loop length a', '2')],
    interval: ['0', '2pi'],
  },
  {
    id: 'spiral', name: 'Archimedean spiral r = aθ', kind: 'polar',
    params: [P('a', 'a', '0.5')],
    interval: ['0', '4pi'],
  },
]

/** Is this interval text the polar default, one turn from 0? */
function isFullTurn(iv: [string, string]): boolean {
  const lo = valueOf(iv[0]), hi = valueOf(iv[1])
  return lo === 0 && Math.abs(hi - TWO_PI) <= 1e-12
}

/**
 * Typed source for a family at these values: the two-equation parametric
 * spelling `x = …, y = … {lo <= t <= hi}` (never the bare pair, which the
 * App's shape reader would take for a point), or the ordinary polar line
 * `r = …`, with `{lo <= θ <= hi}` unless the interval is one full turn from 0.
 * A value is text and is written in as typed (wrapped in brackets unless it
 * is a plain number). Without an interval the family's default is used —
 * except the projectile, which runs until it lands at these values.
 */
export function familySource(family: ParamFamily, values: Record<string, string>, interval?: [string, string]): string {
  const build = family ? BUILD[family.id] : undefined
  if (!build) return ''
  const v: Vals = {}
  for (const p of family.params) {
    const raw = values?.[p.name]
    v[p.name] = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : p.value
  }
  let iv: [string, string] = interval ?? family.interval
  if (!interval && family.id === 'projectile') {
    iv = ['0', flightText(landing(valueOf(v.v0), valueOf(v.alpha), valueOf(v.h), valueOf(v.g)))]
  }
  const out = build(v)
  if ('r' in out) {
    return isFullTurn(iv) ? `r = ${out.r}` : `r = ${out.r} {${iv[0]} <= θ <= ${iv[1]}}`
  }
  return `x = ${out.x}, y = ${out.y} {${iv[0]} <= t <= ${iv[1]}}`
}

// ----------------------------------------------------------------------------
// describePolar
// ----------------------------------------------------------------------------

/** The simplest text of a coefficient read off samples. */
function coefText(v: number): string {
  const f = exactForm(v, { tol: 1e-9 })
  return f ? f.text : dec(v)
}

/** An angle, reduced to [0, 2π), as text. */
function angleText(t: number): string {
  let u = t % TWO_PI
  if (u < 0) u += TWO_PI
  if (Math.abs(u - TWO_PI) < 1e-9) u = 0
  const f = exactForm(u, { tol: 1e-9 })
  return f ? f.text : dec(u)
}

/** Least squares on a few basis functions (normal equations, Gaussian elimination). */
function lsq(rows: number[][], ys: number[]): number[] | null {
  const m = rows[0]?.length ?? 0
  const A = Array.from({ length: m }, () => new Array<number>(m + 1).fill(0))
  for (let i = 0; i < rows.length; i++) {
    for (let p = 0; p < m; p++) {
      for (let q = 0; q < m; q++) A[p][q] += rows[i][p] * rows[i][q]
      A[p][m] += rows[i][p] * ys[i]
    }
  }
  for (let c = 0; c < m; c++) {
    let piv = c
    for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r
    if (Math.abs(A[piv][c]) < 1e-300) return null
    ;[A[c], A[piv]] = [A[piv], A[c]]
    for (let r = 0; r < m; r++) {
      if (r === c) continue
      const f = A[r][c] / A[c][c]
      for (let k = c; k <= m; k++) A[r][k] -= f * A[c][k]
    }
  }
  return A.map((row, i) => row[m] / row[i])
}

/** max |y − fit| over the samples, relative to `scale`. */
function misfit(rows: number[][], ys: number[], c: number[], scale: number): number {
  let worst = 0
  for (let i = 0; i < rows.length; i++) {
    let v = 0
    for (let k = 0; k < c.length; k++) v += rows[i][k] * c[k]
    worst = Math.max(worst, Math.abs(ys[i] - v))
  }
  return worst / Math.max(scale, 1e-300)
}

const FIT_TOL = 1e-8

/**
 * What a typed polar line IS, read off its values at the default sliders:
 * a rose (petal count, petal length, the directions of the petals), a
 * limaçon (inner loop / cardioid / dimpled / convex), a circle through the
 * pole or about it, a lemniscate, an Archimedean spiral — else null.
 */
export function describePolar(src: string): string | null {
  if (typeof src !== 'string') return null
  const o = parseExpression(src)
  if (!o.ok || o.plot.kind !== 'polar') return null
  const spec = o.plot.makeModel('describe')
  const params = o.plot.defaultParams
  const R: Fn = (t) => { try { return num(spec.evalPolar!(params, t)) } catch { return Number.NaN } }

  const N = 720
  const ths: number[] = [], rs: number[] = []
  let finite = 0, scale = 0
  for (let i = 0; i < N; i++) {
    const t = (TWO_PI * (i + 0.25)) / N
    const r = R(t)
    ths.push(t); rs.push(r)
    if (Number.isFinite(r)) { finite++; scale = Math.max(scale, Math.abs(r)) }
  }
  if (finite < N / 8 || !(scale > 0)) return null
  const fin = ths.map((_, i) => i).filter((i) => Number.isFinite(rs[i]))

  if (finite === N) {
    // a constant: a circle about the pole
    const mean = rs.reduce((s, r) => s + r, 0) / N
    if (rs.every((r) => Math.abs(r - mean) <= FIT_TOL * scale)) {
      return `a circle of radius ${coefText(Math.abs(mean))} centered at the pole`
    }
    // A cos kθ + B sin kθ: k = 1 a circle through the pole, k ≥ 2 a rose
    for (let k = 1; k <= 12; k++) {
      const rows = ths.map((t) => [Math.cos(k * t), Math.sin(k * t)])
      const c = lsq(rows, rs)
      if (!c || misfit(rows, rs, c, scale) > FIT_TOL) continue
      const [A, B] = c
      const amp = Math.hypot(A, B)
      if (k === 1) {
        return (
          `a circle of diameter ${coefText(amp)} through the pole, ` +
          `centered at (${coefText(A / 2)}, ${coefText(B / 2)})`
        )
      }
      const phi = Math.atan2(B, A) // r = amp·cos(kθ − φ)
      const dirs: number[] = []
      for (let n = 0; n < 2 * k; n++) {
        const th = (phi + n * Math.PI) / k
        let d = n % 2 === 0 ? th : th + Math.PI
        d = ((d % TWO_PI) + TWO_PI) % TWO_PI
        if (Math.abs(d - TWO_PI) < 1e-9) d = 0
        if (!dirs.some((e) => Math.abs(e - d) < 1e-7 || Math.abs(Math.abs(e - d) - TWO_PI) < 1e-7)) dirs.push(d)
      }
      dirs.sort((p, q) => p - q)
      const petals = dirs.length
      return (
        `a rose with ${petals} petals, each of length ${coefText(amp)}, ` +
        `along θ = ${listText(dirs.map(angleText))}`
      )
    }
    // a + B cos θ + C sin θ: a limaçon
    {
      const rows = ths.map((t) => [1, Math.cos(t), Math.sin(t)])
      const c = lsq(rows, rs)
      if (c && misfit(rows, rs, c, scale) <= FIT_TOL) {
        const a = Math.abs(c[0])
        const b = Math.hypot(c[1], c[2])
        if (b > FIT_TOL * scale && a > FIT_TOL * scale) {
          if (Math.abs(a - b) <= 1e-7 * Math.max(a, b)) return 'a cardioid'
          if (a < b) return 'a limaçon with an inner loop'
          if (a < 2 * b * (1 - 1e-9)) return 'a dimpled limaçon'
          return 'a convex limaçon'
        }
      }
    }
    // a + bθ: an Archimedean spiral
    {
      const rows = ths.map((t) => [1, t])
      const c = lsq(rows, rs)
      if (c && misfit(rows, rs, c, scale) <= FIT_TOL && Math.abs(c[1]) > FIT_TOL * scale) {
        return 'an Archimedean spiral'
      }
    }
    return null
  }

  // undefined on part of the turn: r² = A cos 2θ + B sin 2θ is a lemniscate
  {
    const rows = fin.map((i) => [Math.cos(2 * ths[i]), Math.sin(2 * ths[i])])
    const ys = fin.map((i) => rs[i] * rs[i])
    const c = lsq(rows, ys)
    const sameSign = fin.every((i) => rs[i] >= -FIT_TOL * scale) || fin.every((i) => rs[i] <= FIT_TOL * scale)
    if (c && sameSign && misfit(rows, ys, c, scale * scale) <= FIT_TOL) {
      const a = Math.sqrt(Math.hypot(c[0], c[1]))
      return `a lemniscate with loops of length ${coefText(a)}`
    }
  }
  return null
}

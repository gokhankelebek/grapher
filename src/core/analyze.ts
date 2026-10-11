// ============================================================================
// Curve analysis — the features a calculus student is asked to find: where a
// curve crosses, turns, and changes concavity.
//
//   export function analyzeCurve(curve, models): SpecialPoint[]
//   export function zeroIntervals(curve, models, range?): ZeroInterval[]
//
// A zero SET that is an interval — floor(x) on [0, 1) — is reported once by
// zeroIntervals, never as a run of point zeros; jumps cut the scans the way
// poles do, so nothing is ever bracketed across one (see "Jumps" below).
//
// Two layers:
//   * closed form where it is easy AND exact (a line's root, a parabola's
//     vertex, sine's crests, abs's kink, a cubic's inflection) — flagged
//     exact: true, so the UI never implies more precision than was computed;
//   * a guarded numeric core for everything else, including typed expressions:
//     dense sampling for brackets, then bisection + Newton polish.
//
// The numeric core is written around the ways naive implementations lie:
// tangencies that never cross, domain endpoints masquerading as extrema,
// kinks where f'' explodes, undefined regions, and poles — a sign-change scan
// reports every asymptote as a root unless it is told not to.
// ============================================================================

import type {
  ExactPoint, FittedCurve, ModelSpec, PieceInfo, SpecialPoint, SpecialPointKind, Vec2,
} from './types'
import { conicToCenterForm } from './fit/optimize'
import { findHoles } from './holes'
import { curveDomain } from './domainRange'
// The x's of an intersection are the zeros of f − g, and calculus.ts already
// hands that difference back to analyzeCurve as a curve of its own. The import
// is circular by construction — calculus.ts imports analyzeCurve — and safe:
// both sides are hoisted function declarations, used only from inside bodies.
import { curveIntersections } from './calculus'
import { numValue, polynomialCoeffs } from './valueTable'
import { solveExpEquation } from './expSolve'
import type { ExpShape } from './expSolve'
import type { Num } from './valueTable'
import { exactForm, verifiedExact } from './exact'
import type { ExactForm } from './exact'

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Sample count for bracketing. The main lever on cost; see the perf test. */
const SAMPLES = 1200
/** Samples for parametric/polar sweeps (cheaper per point, closed curves). */
const PARAM_SAMPLES = 720
/** Fallback x-range when a curve carries no domain of its own. */
const DEFAULT_DOMAIN: [number, number] = [-10, 10]
/** Two points closer than this in x are the same point. */
const DEDUPE_X = 1e-6
/** A zero/extremum this close (relatively) to a hole IS the hole. */
const HOLE_DEDUPE = 1e-6
/**
 * Tolerance for recognising a hole's y. Looser than every other match here,
 * and it has to be: that y is a LIMIT, and holes.ts declares one converged
 * when three rungs of its h ladder agree to 1e-6. Matching it at 1e-11 would
 * not be stricter, only blind — it would refuse to call the limit of
 * (x²−1)/(x−1) two. The x of a hole is a snapped root and is matched tight.
 */
const HOLE_Y_TOL = 1e-8

const EPS = Number.EPSILON
/** Step for a central-difference first derivative: cbrt(eps) ~ 6.1e-6. */
const H1 = Math.cbrt(EPS)
/** Step for a second derivative: eps^(1/4) ~ 1.2e-4 — bigger, or the
 *  subtraction of three nearly equal values loses every significant digit. */
const H2 = Math.pow(EPS, 0.25)

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

type Fn = (x: number) => number

// ---------------------------------------------------------------------------
// Time budget
//
// Every search here is bounded by its sample counts; the clock is the
// backstop for a formula whose every sample is a refinement (sin(1/x),
// sin(50x)/x) on a slow device. Past the budget the scans stop refining and
// the analysis reports the points it has already confirmed — never a guess.
// One analyzeCurve call opens it; nested calls share it.
// ---------------------------------------------------------------------------

/** The most one analyzeCurve call may spend refining points (ms) — a backstop; see domainRange BUDGET_MS. */
const ANALYSIS_BUDGET_MS = 400

const clock = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()

let analysisEnd = Infinity

function withAnalysisBudget<T>(make: () => T): T {
  if (analysisEnd !== Infinity) return make()
  analysisEnd = clock() + ANALYSIS_BUDGET_MS
  try {
    return make()
  } finally {
    analysisEnd = Infinity
  }
}

const analysisLate = (): boolean => analysisEnd !== Infinity && clock() > analysisEnd

function pt(
  kind: SpecialPointKind,
  x: number,
  y: number,
  label: string,
  exact: boolean,
  tangent?: boolean,
): SpecialPoint | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  // `+ 0` turns −0 into 0: a card should never print "−0"
  const p: SpecialPoint = { kind, pos: { x: x + 0, y: y + 0 }, label, exact }
  if (tangent) p.tangent = true
  return p
}

function d1(f: Fn, x: number): number {
  const h = H1 * Math.max(1, Math.abs(x))
  return (f(x + h) - f(x - h)) / (2 * h)
}

function d2(f: Fn, x: number): number {
  const h = H2 * Math.max(1, Math.abs(x))
  return (f(x + h) - 2 * f(x) + f(x - h)) / (h * h)
}

/** Robust magnitude scale of the sampled values (75th percentile of |y|). */
function robustScale(ys: number[]): number {
  const a: number[] = []
  for (const y of ys) if (Number.isFinite(y)) a.push(Math.abs(y))
  if (a.length === 0) return 1
  a.sort((p, q) => p - q)
  const v = a[Math.min(a.length - 1, Math.floor(0.75 * a.length))]
  return v > 0 ? v : 1
}

function median(a: number[]): number {
  if (a.length === 0) return 0
  const s = a.slice().sort((p, q) => p - q)
  return s[Math.floor(s.length / 2)]
}

// ---------------------------------------------------------------------------
// Root finding on a bracket, with the pole guard
// ---------------------------------------------------------------------------

/**
 * Locate f = 0 inside [a, b] where f changes sign. Bisection (always safe)
 * with Newton polish, then a VALUE CHECK: at a genuine root |f| is tiny, at a
 * pole the "sign change" is the function passing through infinity and |f|
 * stays enormous. That check — not a heuristic — is what keeps 1/x and tan(x)
 * from reporting a zero at every asymptote.
 */
function refineRoot(f: Fn, a: number, b: number, zeroTol: number): number | null {
  let lo = a
  let hi = b
  let flo = f(lo)
  let fhi = f(hi)
  if (!Number.isFinite(flo) || !Number.isFinite(fhi)) return null
  if (flo === 0) return lo
  if (fhi === 0) return hi
  if (flo > 0 === fhi > 0) return null

  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi)
    if (mid === lo || mid === hi) break
    const fm = f(mid)
    if (!Number.isFinite(fm)) return null
    if (fm === 0) { lo = hi = mid; break }
    if (fm > 0 === flo > 0) { lo = mid; flo = fm } else { hi = mid; fhi = fm }
    if (hi - lo < 1e-15 * Math.max(1, Math.abs(lo))) break
  }

  let x = 0.5 * (lo + hi)
  // Newton polish, but never outside the bracket the bisection proved
  for (let i = 0; i < 6; i++) {
    const fx = f(x)
    if (!Number.isFinite(fx) || fx === 0) break
    const g = d1(f, x)
    if (!Number.isFinite(g) || g === 0) break
    const nx = x - fx / g
    if (!Number.isFinite(nx) || nx < lo || nx > hi) break
    if (Math.abs(nx - x) < 1e-16 * Math.max(1, Math.abs(x))) { x = nx; break }
    x = nx
  }

  const fx = f(x)
  if (!Number.isFinite(fx)) return null
  // the pole guard
  if (Math.abs(fx) > zeroTol) return null
  return x
}

/** Golden-section minimum of g on [a, b] — derivative free, so a kink or an
 *  infinite-slope branch point does not derail it. */
function goldenMin(g: Fn, a: number, b: number): number {
  const phi = 0.6180339887498949
  let lo = a
  let hi = b
  let x1 = hi - (hi - lo) * phi
  let x2 = lo + (hi - lo) * phi
  let f1 = g(x1)
  let f2 = g(x2)
  for (let i = 0; i < 90; i++) {
    if (!Number.isFinite(f1) || !Number.isFinite(f2)) break
    if (f1 < f2) {
      hi = x2; x2 = x1; f2 = f1
      x1 = hi - (hi - lo) * phi
      f1 = g(x1)
    } else {
      lo = x1; x1 = x2; f1 = f2
      x2 = lo + (hi - lo) * phi
      f2 = g(x2)
    }
    if (hi - lo < 1e-13 * Math.max(1, Math.abs(lo))) break
  }
  return 0.5 * (lo + hi)
}

// ---------------------------------------------------------------------------
// The generic numeric analysis of an explicit curve
// ---------------------------------------------------------------------------

interface Run { i0: number; i1: number } // inclusive sample indices

/**
 * Sample steps that pass through a pole: the step dwarfs a typical step AND
 * the values themselves are far outside the curve's usual magnitude.
 * `pole[i]` flags the step from sample i to i + 1.
 */
function poleSteps(ys: number[], scale: number): Uint8Array {
  const n = ys.length - 1
  const pole = new Uint8Array(Math.max(0, n))
  const steps: number[] = []
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(ys[i]) && Number.isFinite(ys[i + 1])) {
      steps.push(Math.abs(ys[i + 1] - ys[i]))
    }
  }
  const medStep = median(steps)
  if (!(medStep > 0)) return pole
  for (let i = 0; i < n; i++) {
    const a = ys[i]
    const b = ys[i + 1]
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue
    if (Math.abs(b - a) > 100 * medStep && Math.max(Math.abs(a), Math.abs(b)) > 20 * scale) {
      pole[i] = 1
    }
  }
  return pole
}

/**
 * Split the sampled domain into maximal runs that are finite AND free of a
 * break. Undefined regions (sqrt left of its branch point), poles and jumps
 * all end a run, so no candidate — a sign change, a turn, a change of
 * concavity — is ever bracketed across one. `cut[i]` flags the step i → i + 1.
 */
function findRuns(ys: number[], cut: Uint8Array): Run[] {
  const runs: Run[] = []
  let start = -1
  for (let i = 0; i < ys.length; i++) {
    const ok = Number.isFinite(ys[i])
    if (!ok) {
      if (start >= 0 && i - 1 >= start) runs.push({ i0: start, i1: i - 1 })
      start = -1
      continue
    }
    if (start < 0) start = i
    if (i === ys.length - 1 || cut[i]) {
      runs.push({ i0: start, i1: i })
      start = -1
    }
  }
  return runs.filter(r => r.i1 > r.i0)
}

// ---------------------------------------------------------------------------
// Jumps
//
// The step of floor(x), the riser of sign(x), the seam between two pieces of a
// piecewise function that do not meet. Every scan below pairs neighbouring
// samples, and a pair that straddles a jump lies to each of them:
//
//   * the first difference reads a flat step followed by a riser as a turn,
//     so floor(x) reported a "minimum" at the foot of every stair;
//   * the second difference reads the riser as +curvature then −curvature, so
//     f = {x² + 1, x ≤ 0 ; 3, 0 < x ≤ 2 ; …} reported an "inflection" one
//     sample right of the jump at 0 — (0.008333, 3);
//   * a sign change across a jump is not a root (the pole guard already knew).
//
// So jumps are found FIRST and cut the runs, exactly like poles. Whether a
// suspicious step is a jump is the renderer's question too, and it is
// answered the renderer's way (src/render/curves.ts, isDiscontinuity) — the
// criterion is mirrored here in math units rather than imported, since core
// must not depend on render: bisect the step, always descending into the half
// that carries the larger |Δf|. A continuous curve's gap shrinks WITH the
// interval (by ~256× over 8 halvings, however steep); a jump's gap HOLDS —
// once the interval is ≤ 1e-9 of the span it is still ≥ 3/4 of what it was 8
// halvings earlier — and a pole's GROWS. Only a jump carries points (the
// value AT the jump can be a zero or a one-sided extremum); a pole or an
// undefined gap only cuts.
//
// Which steps are probed: every step containing a stated piece end
// (ModelSpec.pieces), and every step at least JUMP_GATE× taller than both of
// its neighbours — a resolved smooth curve changes its step by a few percent
// from one sample to the next, never by 3×, so the gate costs a smooth curve
// nothing.
// ---------------------------------------------------------------------------

/** Mirrors render/curves.ts JUMP_REL_T: the probe's resolution, as a fraction of the span. */
const JUMP_REL_T = 1e-9
/** Mirrors render/curves.ts HOLD_STEPS / HOLD_RATIO. */
const JUMP_HOLD_STEPS = 8
const JUMP_HOLD_RATIO = 0.75
/** A gap that has grown more than this over HOLD_STEPS halvings is a pole. */
const POLE_GROWTH = 4
const JUMP_PROBE_STEPS = 80
/** A step this many times taller than both of its neighbours is probed. */
const JUMP_GATE = 3
/** …or one this far (× its neighbours' size) off the trend they extrapolate to. */
const JUMP_TREND = 0.5
/** At most this many suspicious steps are probed (piece ends always are). */
const JUMP_MAX_GATED = 256
const JUMP_SPANS = new Float64Array(JUMP_PROBE_STEPS + 1)
/** The smallest positive normal double; below it lie the subnormals. */
const MIN_NORMAL = 2.2250738585072014e-308

type BreakKind = 'jump' | 'pole' | 'undefined'

interface Break {
  /** the sample step it sits in: xs[j] → xs[j + 1] */
  j: number
  kind: BreakKind
  /** a bracket around it, [p, q], ~1e-15 wide for a jump */
  p: number
  q: number
  /** where it is exactly — a piece end or a recognised closed form — or null */
  at: number | null
}

/**
 * The discontinuity criterion of render/curves.ts, in math units. Returns
 * null when [a, b] is continuous, else the kind and a bracket around it; a
 * jump's bracket is then tightened to double precision so its location can
 * be recognised.
 */
function probeJump(
  f: Fn,
  a: number, fa: number,
  b: number, fb: number,
  tEps: number,
  joinTol: number,
): { kind: BreakKind; p: number; q: number } | null {
  let aX = a, aY = fa, bX = b, bY = fb
  JUMP_SPANS[0] = Math.abs(fb - fa)
  if (!(JUMP_SPANS[0] > joinTol)) return null
  let decided = false
  for (let i = 1; i <= JUMP_PROBE_STEPS; i++) {
    const m = 0.5 * (aX + bX)
    // collapsed to adjacent doubles with the gap still open
    if (m === aX || m === bX) return { kind: 'jump', p: aX, q: bX }
    let y: number
    try { y = f(m) } catch { y = Number.NaN }
    if (!Number.isFinite(y)) return { kind: 'undefined', p: m, q: m }
    const l = Math.abs(y - aY)
    const r = Math.abs(bY - y)
    let span: number
    if (l >= r) { bX = m; bY = y; span = l } else { aX = m; aY = y; span = r }
    if (span <= joinTol) return null // collapsed: continuous, just steep
    JUMP_SPANS[i] = span
    if (!decided && bX - aX <= tEps) {
      const before = JUMP_SPANS[Math.max(0, i - JUMP_HOLD_STEPS)]
      if (span < JUMP_HOLD_RATIO * before) return null
      if (span > POLE_GROWTH * before) return { kind: 'pole', p: aX, q: bX }
      decided = true
    }
    if (decided && bX - aX <= 1e-15 * Math.max(1, Math.abs(aX))) break
  }
  // out of steps with the gap open: the renderer lifts the pen here too
  return { kind: decided ? 'jump' : 'undefined', p: aX, q: bX }
}

/** Is [p, q] (widened by a hair) around x? */
function brackets(p: number, q: number, x: number): boolean {
  const tol = 1e-12 * Math.max(1, Math.abs(p), Math.abs(q))
  return x >= Math.min(p, q) - tol && x <= Math.max(p, q) + tol
}

/**
 * Where exactly a boundary located to double precision inside [p, q] is: a
 * stated piece end, else a closed form the bracket actually contains (the
 * integers of floor(x), the 1/3 of floor(3x)), else null — "somewhere in
 * [p, q]" is known, but nothing can be said about the point itself.
 */
function snapBoundary(p: number, q: number, ends: number[]): number | null {
  for (const e of ends) if (brackets(p, q, e)) return e + 0
  const form = exactForm(0.5 * (p + q), { tol: 1e-12 })
  if (form && brackets(p, q, form.value)) return form.value + 0 // never −0
  return null
}

/**
 * The nice number a snapped boundary IS, for ModelSpec.evalExact: p/q with
 * q ≤ 64, or pπ/q with q ≤ 24 — the forms snapBoundary's exactForm returns.
 * Null for anything else (a surd, or a piece end at 0.37).
 */
function exactPointOf(x: number): ExactPoint | null {
  if (!Number.isFinite(x)) return null
  for (let q = 1; q <= 64; q++) {
    const p = Math.round(x * q)
    if (Math.abs(p) < 2 ** 26 && p / q === x) return { p, q, pi: false }
  }
  for (let q = 1; q <= 24; q++) {
    const p = Math.round((x * q) / Math.PI)
    if (p !== 0 && Math.abs(p) < 2 ** 26 && Math.abs((p * Math.PI) / q - x) <= 4e-16 * Math.abs(x)) {
      return { p, q, pi: true }
    }
  }
  return null
}

/** Is x part of the curve's stated domain? True for a curve without pieces. */
function coveredByPieces(pieces: PieceInfo[] | null, x: number): boolean {
  if (!pieces || pieces.length === 0) return true
  for (const q of pieces) {
    if (x > q.lo && x < q.hi) return true
    if (x === q.lo && q.loClosed) return true
    if (x === q.hi && q.hiClosed) return true
  }
  return false
}

/** Finite piece ends, sorted and deduplicated. */
function pieceEnds(pieces: PieceInfo[] | null): number[] {
  if (!pieces) return []
  const out: number[] = []
  for (const q of pieces) {
    if (Number.isFinite(q.lo)) out.push(q.lo)
    if (Number.isFinite(q.hi)) out.push(q.hi)
  }
  out.sort((a, b) => a - b)
  return out.filter((v, i) => i === 0 || v !== out[i - 1])
}

function findBreaks(
  f: Fn,
  xs: number[],
  ys: number[],
  pole: Uint8Array,
  scale: number,
  ends: number[],
): Break[] {
  const n = ys.length - 1
  if (n < 1) return []
  const span = xs[n] - xs[0]
  const step = span / n
  const tEps = JUMP_REL_T * span
  const joinTol = 1e-13 * Math.max(1, scale)
  const gateFloor = 1e-9 * Math.max(1, scale)
  const probe = new Uint8Array(n)
  const fin = (i: number) => i >= 0 && i <= n && Number.isFinite(ys[i])
  // the signed step k → k + 1, NaN where it is not a step of the curve
  const D = (k: number): number => (fin(k) && fin(k + 1) ? ys[k + 1] - ys[k] : Number.NaN)
  let gated = 0
  for (let j = 0; j < n && gated < JUMP_MAX_GATED; j++) {
    if (pole[j]) continue
    const dj = D(j)
    if (!(Math.abs(dj) > gateFloor)) continue
    const l1 = D(j - 1)
    const r1 = D(j + 1)
    const nb = Math.max(Number.isFinite(l1) ? Math.abs(l1) : 0, Number.isFinite(r1) ? Math.abs(r1) : 0)
    let suspicious = Math.abs(dj) > JUMP_GATE * nb
    if (!suspicious) {
      // A jump riding on a steep stretch — floor(x) + tan(x) near a pole —
      // hides from the ratio test. It cannot hide from the TREND: a smooth
      // curve's step is its neighbours' step extrapolated to within a third
      // difference (h³·f‴), while a jump adds its whole height.
      const l2 = D(j - 2)
      const r2 = D(j + 2)
      let dev = Infinity
      if (Number.isFinite(l1) && Number.isFinite(l2)) dev = Math.min(dev, Math.abs(dj - (2 * l1 - l2)))
      if (Number.isFinite(r1) && Number.isFinite(r2)) dev = Math.min(dev, Math.abs(dj - (2 * r1 - r2)))
      suspicious = Number.isFinite(dev) && dev > JUMP_TREND * nb
    }
    if (suspicious) { probe[j] = 1; gated++ }
  }
  for (const e of ends) {
    if (!(e > xs[0] && e < xs[n])) continue
    let k = Math.min(n - 1, Math.max(0, Math.floor((e - xs[0]) / step)))
    while (k > 0 && xs[k] > e) k--
    while (k < n - 1 && xs[k + 1] < e) k++
    probe[k] = 1
    // a piece end ON a sample: the seam may be on either side of it
    if (xs[k] === e && k > 0) probe[k - 1] = 1
    if (xs[k + 1] === e && k + 1 < n) probe[k + 1] = 1
  }
  const out: Break[] = []
  for (let j = 0; j < n; j++) {
    if (!probe[j] || pole[j] || !fin(j) || !fin(j + 1)) continue
    const r = probeJump(f, xs[j], ys[j], xs[j + 1], ys[j + 1], tEps, joinTol)
    if (!r) continue
    out.push({ j, kind: r.kind, p: r.p, q: r.q, at: r.kind === 'jump' ? snapBoundary(r.p, r.q, ends) : null })
  }
  return out
}

// ---------------------------------------------------------------------------
// Flat stretches
//
// floor(x) is constant on [0, 1); y = 0 {0 < x < 3} is zero on all of it. A
// constant stretch is not a run of zeros, maxima or minima, and textbooks do
// not list them: where f is zero on an interval, the ZERO SET is that
// interval, reported once by zeroIntervals() below, and analyzeCurve drops
// every individual zero, extremum and inflection inside any flat stretch.
//
// Flat means BIT-FOR-BIT equal: consecutive samples with identical values and
// the midpoint between each pair agreeing too. A tolerance would be wrong
// here — x¹⁰ is below 1e-7 on a whole neighbourhood of 0 and is still zero at
// exactly one point — and a typed constant, a floor, a ceil or a piecewise
// constant evaluates to the same double every time.
// ---------------------------------------------------------------------------

interface Flat {
  lo: number
  hi: number
  loClosed: boolean
  hiClosed: boolean
  /** the constant value */
  y: number
}

/**
 * The boundary of a flat stretch at value y between `inside` (f === y) and
 * `outside` (f !== y, or undefined): bisected to double precision, then
 * snapped to a piece end or a closed form the bracket contains. It is closed
 * when f takes y AT the boundary and the pieces include it.
 */
function flatEdge(
  f: Fn,
  inside: number,
  outside: number,
  y: number,
  ends: number[],
  pieces: PieceInfo[] | null,
): { x: number; closed: boolean } | null {
  const eq = (x: number): boolean => {
    try { return f(x) === y } catch { return false }
  }
  let a = inside
  let b = outside
  for (let i = 0; i < 80; i++) {
    const m = 0.5 * (a + b)
    if (m === a || m === b) break
    if (eq(m)) a = m
    else b = m
  }
  const c = snapBoundary(Math.min(a, b), Math.max(a, b), ends)
  if (c === null && y === 0) {
    // e^(−1/x²) is 0 in double precision for |x| < 0.0366 — by UNDERFLOW, not
    // because the function is zero there. A curve that genuinely leaves zero
    // at some x ≠ 0 is ~ulp(x)·slope just outside, far above the subnormals;
    // one that fades through them into 0 was never zero on an interval.
    let fb: number
    try { fb = f(b) } catch { fb = Number.NaN }
    if (fb !== 0 && Math.abs(fb) < MIN_NORMAL && Math.abs(b) > 1e-300) return null
  }
  if (c === null) {
    // located to one ulp but not recognised: `a` is in the set and `b` is
    // not, so "up to and including a" is true to double precision
    return { x: a, closed: coveredByPieces(pieces, a) }
  }
  return { x: c, closed: eq(c) && coveredByPieces(pieces, c) }
}

function findFlats(
  f: Fn,
  xs: number[],
  ys: number[],
  cut: Uint8Array,
  ends: number[],
  pieces: PieceInfo[] | null,
): Flat[] {
  const n = ys.length - 1
  const out: Flat[] = []
  const at = (x: number): number => {
    try { return f(x) } catch { return Number.NaN }
  }
  let i = 0
  while (i < n) {
    const y = ys[i]
    if (!Number.isFinite(y) || cut[i] || ys[i + 1] !== y || at(0.5 * (xs[i] + xs[i + 1])) !== y) {
      i++
      continue
    }
    let j = i + 1
    // where the run of equal samples stops — or where the midpoint check fails
    let outsideR: number | null = null
    while (j < n && !cut[j] && ys[j + 1] === y) {
      const m = 0.5 * (xs[j] + xs[j + 1])
      if (at(m) !== y) { outsideR = m; break }
      j++
    }
    const left = i === 0
      ? { x: xs[0], closed: coveredByPieces(pieces, xs[0]) }
      : flatEdge(f, xs[i], xs[i - 1], y, ends, pieces)
    const right = j === n
      ? { x: xs[n], closed: coveredByPieces(pieces, xs[n]) }
      : flatEdge(f, xs[j], outsideR ?? xs[j + 1], y, ends, pieces)
    if (left && right && right.x > left.x) {
      out.push({ lo: left.x, hi: right.x, loClosed: left.closed, hiClosed: right.closed, y })
    }
    i = j
  }
  return out
}

/** Everything the numeric core learns from one pass of sampling. */
interface Grid {
  f: Fn
  xs: number[]
  ys: number[]
  step: number
  scale: number
  zeroTol: number
  breaks: Break[]
  runs: Run[]
  flats: Flat[]
  ends: number[]
  pieces: PieceInfo[] | null
}

function scanGrid(f: Fn, lo: number, hi: number, pieces: PieceInfo[] | null): Grid {
  const n = SAMPLES
  const xs = new Array<number>(n + 1)
  const ys = new Array<number>(n + 1)
  const step = (hi - lo) / n
  for (let i = 0; i <= n; i++) {
    const x = i === n ? hi : lo + i * step
    xs[i] = x
    let y: number
    try { y = f(x) } catch { y = Number.NaN }
    ys[i] = y
  }
  const scale = robustScale(ys)
  // The pole guard's "is |f| actually small here?" test has to be relative to
  // the curve's OWN magnitude. An absolute floor of 1e-7 declares every value
  // of 1e-8·cos(x) + 2e-8 to be zero, so a curve whose minimum |f| is 1e-8 and
  // which never crosses the axis reports four roots drawn at y = 0.
  const zeroTol = 1e-7 * scale
  const ends = pieceEnds(pieces)
  const pole = poleSteps(ys, scale)
  const breaks = findBreaks(f, xs, ys, pole, scale, ends)
  const cut = pole
  for (const b of breaks) cut[b.j] = 1
  const runs = findRuns(ys, cut)
  const flats = findFlats(f, xs, ys, cut, ends, pieces)
  return { f, xs, ys, step, scale, zeroTol, breaks, runs, flats, ends, pieces }
}

interface NumericOpts {
  zeros: boolean
  extrema: boolean
  inflections: boolean
}

function analyzeExplicitNumeric(
  f: Fn,
  lo: number,
  hi: number,
  opts: NumericOpts,
  pieces: PieceInfo[] | null,
  /** f at an exactly-known x in exact arithmetic (ModelSpec.evalExact), when
   *  the model offers it and can certify the value; else undefined */
  exactAt: (x: number) => number | undefined = () => undefined,
): SpecialPoint[] {
  const out: SpecialPoint[] = []
  const g = scanGrid(f, lo, hi, pieces)
  const { xs, ys, step, scale, zeroTol, breaks, runs, flats, ends } = g
  const n = xs.length - 1
  // A run end INSIDE the scan (not its own edge, not a stated piece end) sits
  // beside a gap — a pole, a jump, an undefined sample. There a value merely
  // below tolerance is a curve heading to 0, not reaching it: e^(1/x) at
  // x = −1/60 is 8.7e−27 as x → 0⁻, and 0 is not in its domain. Only an
  // exact 0 there is a zero; a true zero at the edge of an undefined stretch
  // (√(4 − x²) at ±2) is still found by its own sample or by the edge
  // refinement below.
  const atPieceEnd = (x: number): boolean =>
    ends.some((e) => Math.abs(e - x) <= 1e-12 * Math.max(1, Math.abs(e)))
  const interiorEnd = (i: number): boolean => i !== 0 && i !== n && !atPieceEnd(xs[i])

  for (const run of runs) {
    const { i0, i1 } = run

    // ---- zeros: sign changes, then tangencies -----------------------------
    if (opts.zeros) {
      // A root sitting ON a run's endpoint has no bracket to be found in: the
      // scan below pairs sample i with i + 1, so the last index of the run is
      // never a left endpoint, and at a DOMAIN end there is no sample beyond it
      // to change sign against. Users type exact endpoints — cos(x) on
      // [-pi/2, pi/2] is two of them — so test the ends directly, and by
      // tolerance rather than equality: cos(-pi/2) evaluates to 6.1e-17, not 0.
      // A run boundary produced by a pole has |y| enormous there, so it cannot
      // be mistaken for one of these.
      for (const i of i0 === i1 ? [i0] : [i0, i1]) {
        const y = ys[i]
        if (interiorEnd(i) && y !== 0) continue
        if (Number.isFinite(y) && Math.abs(y) <= zeroTol) {
          const p = pt('zero', xs[i], 0, 'zero', false)
          if (p) out.push(p)
        }
      }
      for (let i = i0; i < i1; i++) {
        if (analysisLate()) break
        const ya = ys[i]
        const yb = ys[i + 1]
        if (ya === 0) {
          const p = pt('zero', xs[i], 0, 'zero', false)
          if (p) out.push(p)
          continue
        }
        if (ya > 0 !== yb > 0) {
          const r = refineRoot(f, xs[i], xs[i + 1], zeroTol)
          if (r !== null) {
            const p = pt('zero', r, 0, 'zero', false)
            if (p) out.push(p)
          }
        }
      }
      // Tangencies: f touches zero without crossing, so no sign change exists
      // to find. Look for local minima of |f| and refine them properly before
      // deciding — at the sampling grid (x-2)^2 is ~1e-5 from its own root.
      for (let i = i0 + 1; i < i1; i++) {
        if (analysisLate()) break
        const a = Math.abs(ys[i - 1])
        const b = Math.abs(ys[i])
        const c = Math.abs(ys[i + 1])
        if (!(b <= a && b <= c) || (b === a && b === c)) continue
        const xm = goldenMin(x => Math.abs(f(x)), xs[i - 1], xs[i + 1])
        const fm = f(xm)
        if (!Number.isFinite(fm) || Math.abs(fm) > zeroTol) continue
        // A CROSSING root also dips |f| to zero, and the sign-change scan has
        // already reported it. What makes this a tangency is that f keeps the
        // same sign on both sides — probe out far enough to clear the noise.
        const delta = 0.25 * step
        const before = f(xm - delta)
        const after = f(xm + delta)
        if (!Number.isFinite(before) || !Number.isFinite(after)) continue
        if (before === 0 || after === 0) continue
        if (before > 0 !== after > 0) continue // crosses: not a tangency
        const p = pt('zero', xm, 0, 'zero', false, true)
        if (p) out.push(p)
      }
    }

    // ---- extrema: sign change in the first difference ---------------------
    // Bracketing this way is what keeps a domain endpoint from being called a
    // maximum: a monotonic run has no interior sign change, so it yields none.
    if (opts.extrema) {
      for (let i = i0 + 1; i < i1; i++) {
        if (analysisLate()) break
        const dPrev = ys[i] - ys[i - 1]
        const dNext = ys[i + 1] - ys[i]
        if (dPrev === 0 && dNext === 0) continue
        const rising = dPrev > 0
        if (dNext === 0 || rising === dNext > 0) continue
        const isMax = rising
        const gm: Fn = isMax ? (x => -f(x)) : (x => f(x))
        const xm = goldenMin(gm, xs[i - 1], xs[i + 1])
        const ym = f(xm)
        if (!Number.isFinite(ym)) continue
        // prominence: reject flat-line numerical noise
        const span = Math.max(
          Math.abs(ym - ys[i - 1]), Math.abs(ym - ys[i + 1]),
        )
        if (span < 1e-12 * Math.max(1, scale)) continue
        const p = pt(
          isMax ? 'maximum' : 'minimum', xm, ym, isMax ? 'max' : 'min', false,
        )
        if (p) out.push(p)
      }
    }

    // ---- inflections: sign change in the second difference ----------------
    if (opts.inflections) {
      // A second difference is "significant" when it implies a curvature above
      // a scale-relative floor: |s| ~ |f''|*h^2, so this threshold is really
      // |f''| > 1e-6 * scale. Everything below it is floating-point noise — on
      // a straight line that is ALL of it, which is what keeps a line (and a
      // parabola, whose curvature never changes sign) free of inflections.
      const curvFloor = 1e-6 * Math.max(1, scale) * step * step
      // Walk the significant values and bracket each sign change between
      // consecutive ones. Insignificant entries are skipped rather than
      // treated as a sign: an f'' that passes cleanly through zero AT a sample
      // makes the second difference exactly 0 (tan at the origin does this
      // exactly, being odd), and that is the strongest evidence of an
      // inflection there is — not a reason to discard the crossing.
      let jPrev = -1
      let sPrevSign = 0
      for (let i = i0 + 1; i < i1; i++) {
        if (analysisLate()) break
        const s = ys[i + 1] - 2 * ys[i] + ys[i - 1]
        if (!Number.isFinite(s) || Math.abs(s) <= curvFloor) continue
        const sign = s > 0 ? 1 : -1
        // A sign change whose stencils straddle a piece end is the seam's
        // kink talking, not the curve: the concavity on either side of a
        // stated seam is judged directly, below.
        if (
          sPrevSign !== 0 && sign !== sPrevSign &&
          !ends.some(e => e > xs[jPrev - 1] && e < xs[i + 1])
        ) {
          const r = bisectSecond(f, xs[jPrev], xs[i])
          if (r !== null) {
            const y = f(r)
            if (Number.isFinite(y)) {
              const p = pt('inflection', r, y, 'inflection', false)
              if (p) out.push(p)
            }
          }
        }
        jPrev = i
        sPrevSign = sign
      }
    }
  }

  // ---- inflections AT a continuous seam ------------------------------------
  // {x² if x < 0 ; −x² if x ≥ 0} changes concavity exactly at its seam. The
  // scan above declines every bracket that straddles a seam, so ask directly:
  // one-sided second differences, stencils kept clear of the seam itself.
  if (opts.inflections && ends.length > 0) {
    const curvFloor = 1e-6 * Math.max(1, scale) * step * step
    const at = (x: number): number => {
      try { return f(x) } catch { return Number.NaN }
    }
    for (const e of ends) {
      if (!(e > xs[0] + 3 * step && e < xs[n] - 3 * step)) continue
      if (breaks.some(b => brackets(xs[b.j], xs[b.j + 1], e))) continue
      const ye = at(e)
      const sL = at(e - 3 * step) - 2 * at(e - 2 * step) + at(e - step)
      const sR = at(e + step) - 2 * at(e + 2 * step) + at(e + 3 * step)
      if (!Number.isFinite(ye) || !Number.isFinite(sL) || !Number.isFinite(sR)) continue
      if (Math.abs(sL) <= curvFloor || Math.abs(sR) <= curvFloor) continue
      if (sL > 0 === sR > 0) continue
      const p = pt('inflection', e, ye, 'inflection', true)
      if (p) out.push(p)
    }
  }

  // ---- the value AT a jump -------------------------------------------------
  // A jump is where the scans above stop, and it can still carry a point of
  // its own: sign(x) is zero AT 0 and nowhere near it; x − floor(x) is zero
  // at every integer; f = {x² + 1, x ≤ 0 ; 3, x > 0} has f(0) = 1 below both
  // sides, a genuine minimum. Only a jump whose location is KNOWN exactly
  // (a piece end, or a closed form its bracket contains) is asked: the value
  // there is f at that x, and an extremum must be STRICT against both sides —
  // the foot of a floor stair equals the step it starts, so it is not one.
  const jumpXs: number[] = []
  for (const b of breaks) {
    jumpXs.push(b.at ?? 0.5 * (b.p + b.q))
    if (b.kind !== 'jump') continue
    // a root between the samples and the jump, on either side of it
    if (opts.zeros) {
      const fp = f(b.p)
      const fq = f(b.q)
      if (Number.isFinite(fp) && ys[b.j] !== 0 && fp !== 0 && ys[b.j] > 0 !== fp > 0) {
        const r = refineRoot(f, xs[b.j], b.p, zeroTol)
        if (r !== null) { const p = pt('zero', r, 0, 'zero', false); if (p) out.push(p) }
      }
      if (Number.isFinite(fq) && ys[b.j + 1] !== 0 && fq !== 0 && ys[b.j + 1] > 0 !== fq > 0) {
        const r = refineRoot(f, b.q, xs[b.j + 1], zeroTol)
        if (r !== null) { const p = pt('zero', r, 0, 'zero', false); if (p) out.push(p) }
      }
    }
    const c = b.at
    if (c === null) continue
    // In exact arithmetic where the model can: the double nearest π makes
    // sign(sin x) 1 there, and the zero at π would be lost.
    let v: number
    try { v = exactAt(c) ?? f(c) } catch { continue }
    if (!Number.isFinite(v)) continue
    if (opts.zeros && Math.abs(v) <= zeroTol) {
      const p = pt('zero', c, 0, 'zero', true)
      if (p) out.push(p)
    }
    // both sides must be in the window: at its edge, one side is not the curve's
    const d = 1e-7 * Math.max(1, Math.abs(c))
    if (opts.extrema && c - d >= xs[0] && c + d <= xs[n]) {
      let L: number
      let R: number
      try { L = f(c - d); R = f(c + d) } catch { continue }
      if (!Number.isFinite(L) || !Number.isFinite(R)) continue
      const kind: SpecialPointKind | null =
        v < L && v < R ? 'minimum' : v > L && v > R ? 'maximum' : null
      if (kind) {
        const p = pt(kind, c, v, kind === 'maximum' ? 'max' : 'min', true)
        if (p) out.push(p)
      }
    }
  }

  // ---- what a jump or a flat stretch rules out -------------------------------
  const zeroFlats = flats.filter(fl => fl.y === 0)
  const nearJump = (x: number): boolean => jumpXs.some(
    jx => Math.abs(x - jx) < Math.max(step, 2 * H2 * Math.max(1, Math.abs(x))) &&
      Math.abs(x - jx) > 1e-12 * Math.max(1, Math.abs(x)),
  )
  const inFlat = (p: SpecialPoint): boolean => flats.some((fl) => {
    const tol = 1e-9 * Math.max(1, Math.abs(p.pos.x))
    if (p.pos.x > fl.lo + tol && p.pos.x < fl.hi - tol) return true
    // at (or a step from) an end, the point IS the stretch when it has its value
    const nearEnd = p.pos.x >= fl.lo - step && p.pos.x <= fl.hi + step
    return nearEnd && Math.abs(p.pos.y - fl.y) <= 1e-9 * Math.max(1, Math.abs(fl.y))
  })
  return out.filter((p) => {
    if (p.kind === 'zero') {
      // one zero SET, reported once as an interval (zeroIntervals)
      const tol = 1e-9 * Math.max(1, Math.abs(p.pos.x))
      return !zeroFlats.some(fl => p.pos.x >= fl.lo - tol && p.pos.x <= fl.hi + tol)
    }
    // exact === true here means the point was placed AT the jump on purpose
    if (!p.exact && nearJump(p.pos.x)) return false
    return !inFlat(p)
  })
}

/** Bisection on the numeric second derivative. */
function bisectSecond(f: Fn, a: number, b: number): number | null {
  let lo = a
  let hi = b
  let flo = d2(f, lo)
  let fhi = d2(f, hi)
  if (!Number.isFinite(flo) || !Number.isFinite(fhi)) return null
  if (flo > 0 === fhi > 0) return null
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi)
    if (mid === lo || mid === hi) break
    const fm = d2(f, mid)
    if (!Number.isFinite(fm)) return null
    if (fm === 0) return mid
    if (fm > 0 === flo > 0) { lo = mid; flo = fm } else { hi = mid; fhi = fm }
  }
  return 0.5 * (lo + hi)
}

// ---------------------------------------------------------------------------
// Closed forms
// ---------------------------------------------------------------------------

/** Collect integers k with value(k) inside [lo, hi], guarding runaway ranges. */
function forEachK(
  kLo: number,
  kHi: number,
  fn: (k: number) => void,
): void {
  const a = Math.ceil(Math.min(kLo, kHi) - 1)
  const b = Math.floor(Math.max(kLo, kHi) + 1)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return
  if (b - a > 4096) return // absurd frequency: fall back to numerics elsewhere
  // a counted walk: past 2^53, k + 1 === k and `k++` would never reach b
  if (Math.abs(a) > 2 ** 52 || Math.abs(b) > 2 ** 52) return
  for (let i = 0; a + i <= b && i <= 4097; i++) fn(a + i)
}

/**
 * Closed-form analysis for the families where it is easy and exact. Returns
 * null when this family has no closed form (the caller then goes numeric), or
 * a partial result plus flags saying which kinds still need the numeric pass.
 */
interface ClosedForm {
  points: SpecialPoint[]
  /** kinds fully handled here; the numeric pass must skip them */
  handled: { zeros: boolean; extrema: boolean; inflections: boolean }
}

function closedForm(
  curve: FittedCurve,
  lo: number,
  hi: number,
): ClosedForm | null {
  const p = curve.params
  const inDom = (x: number) => x >= lo - 1e-12 && x <= hi + 1e-12
  const push = (arr: SpecialPoint[], q: SpecialPoint | null) => { if (q) arr.push(q) }
  const all = { zeros: true, extrema: true, inflections: true }

  switch (curve.modelId) {
    case 'line': {
      // params [b, m] ascending -> y = m x + b
      const [b, m] = p
      const out: SpecialPoint[] = []
      if (Math.abs(m) > 1e-15) {
        const r = -b / m
        if (inDom(r)) push(out, pt('zero', r, 0, 'zero', true))
      }
      // a line has no extrema and no inflection — say so by handling them
      return { points: out, handled: all }
    }
    case 'poly2': {
      // params [c0, c1, c2] -> c2 x^2 + c1 x + c0
      const [c0, c1, c2] = p
      if (Math.abs(c2) < 1e-15) return null
      const out: SpecialPoint[] = []
      const xv = -c1 / (2 * c2)
      const yv = (c2 * xv + c1) * xv + c0
      if (inDom(xv)) {
        push(out, pt(c2 > 0 ? 'minimum' : 'maximum', xv, yv, c2 > 0 ? 'min' : 'max', true))
      }
      const disc = c1 * c1 - 4 * c2 * c0
      if (Math.abs(disc) <= 1e-14 * Math.max(1, c1 * c1)) {
        // the parabola rests on the axis: one double root, a tangency
        if (inDom(xv)) push(out, pt('zero', xv, 0, 'zero', true, true))
      } else if (disc > 0) {
        const s = Math.sqrt(disc)
        for (const r of [(-c1 - s) / (2 * c2), (-c1 + s) / (2 * c2)]) {
          if (inDom(r)) push(out, pt('zero', r, 0, 'zero', true))
        }
      }
      // a parabola has constant curvature: no inflection, ever
      return { points: out, handled: all }
    }
    case 'poly3': {
      // params [c0, c1, c2, c3]; f' = 3c3 x^2 + 2c2 x + c1, f'' = 6c3 x + 2c2
      const [c0, c1, c2, c3] = p
      if (Math.abs(c3) < 1e-15) return null
      const out: SpecialPoint[] = []
      const f = (x: number) => ((c3 * x + c2) * x + c1) * x + c0
      const disc = 4 * c2 * c2 - 12 * c3 * c1
      if (disc > 0) {
        const s = Math.sqrt(disc)
        const r1 = (-2 * c2 - s) / (6 * c3)
        const r2 = (-2 * c2 + s) / (6 * c3)
        for (const r of [Math.min(r1, r2), Math.max(r1, r2)]) {
          if (!inDom(r)) continue
          // f'' = 6c3 r + 2c2 decides which is which
          const second = 6 * c3 * r + 2 * c2
          const isMax = second < 0
          push(out, pt(isMax ? 'maximum' : 'minimum', r, f(r), isMax ? 'max' : 'min', true))
        }
      }
      // the inflection: exactly -c2/(3 c3), and the midpoint of the extrema
      const xi = -c2 / (3 * c3)
      if (inDom(xi)) push(out, pt('inflection', xi, f(xi), 'inflection', true))
      // roots stay numeric (the cubic formula buys no accuracy here)
      return { points: out, handled: { zeros: false, extrema: true, inflections: true } }
    }
    case 'sine': {
      // params [a, b, c, d] -> a sin(bx + c) + d
      const [a, b, c, d] = p
      if (Math.abs(a) < 1e-15 || Math.abs(b) < 1e-15) return null
      const out: SpecialPoint[] = []
      const th = (x: number) => b * x + c
      const xOf = (t: number) => (t - c) / b
      const t0 = th(lo)
      const t1 = th(hi)
      const kz0 = (Math.min(t0, t1) - Math.PI) / (2 * Math.PI)
      const kz1 = (Math.max(t0, t1) + Math.PI) / (2 * Math.PI)

      // zeros: sin(theta) = -d/a
      const S = -d / a
      if (Math.abs(S) <= 1) {
        const base = Math.asin(S)
        const tangent = Math.abs(Math.abs(S) - 1) < 1e-12
        forEachK(kz0, kz1, k => {
          const cands = tangent
            ? [base + 2 * Math.PI * k]
            : [base + 2 * Math.PI * k, Math.PI - base + 2 * Math.PI * k]
          for (const t of cands) {
            const x = xOf(t)
            if (inDom(x)) push(out, pt('zero', x, 0, 'zero', true, tangent))
          }
        })
      }
      // crests and troughs
      forEachK(kz0, kz1, k => {
        const tMax = Math.PI / 2 + 2 * Math.PI * k
        const tMin = -Math.PI / 2 + 2 * Math.PI * k
        const xMax = xOf(tMax)
        const xMin = xOf(tMin)
        if (inDom(xMax)) {
          const isMax = a > 0
          push(out, pt(isMax ? 'maximum' : 'minimum', xMax, d + a, isMax ? 'max' : 'min', true))
        }
        if (inDom(xMin)) {
          const isMax = a < 0
          push(out, pt(isMax ? 'maximum' : 'minimum', xMin, d - a, isMax ? 'max' : 'min', true))
        }
        // inflections where sin(theta) = 0 -> y = d
        for (const t of [2 * Math.PI * k, Math.PI + 2 * Math.PI * k]) {
          const x = xOf(t)
          if (inDom(x)) push(out, pt('inflection', x, d, 'inflection', true))
        }
      })
      return { points: out, handled: all }
    }
    case 'abs': {
      // params [a, b, c] -> a|x - b| + c. The kink is a genuine extremum but
      // NOT a zero of a smooth derivative, and f'' there is a delta spike.
      const [a, b, c] = p
      if (Math.abs(a) < 1e-15) return null
      const out: SpecialPoint[] = []
      if (inDom(b)) {
        const isMax = a < 0
        push(out, pt(isMax ? 'maximum' : 'minimum', b, c, isMax ? 'max' : 'min', true))
      }
      const u = -c / a // |x - b| = u
      if (Math.abs(u) < 1e-15) {
        if (inDom(b)) push(out, pt('zero', b, 0, 'zero', true, true))
      } else if (u > 0) {
        for (const r of [b - u, b + u]) if (inDom(r)) push(out, pt('zero', r, 0, 'zero', true))
      }
      // two straight arms: no inflection
      return { points: out, handled: all }
    }
    case 'sqrt': {
      // params [a, b, c] -> a sqrt(x - b) + c, undefined left of b, monotonic.
      // The branch point is the domain's left END, so it is NOT an extremum.
      const [a, b, c] = p
      if (Math.abs(a) < 1e-15) return null
      const out: SpecialPoint[] = []
      const u = -c / a
      if (u >= 0) {
        const r = b + u * u
        if (inDom(r) && r >= b) push(out, pt('zero', r, 0, 'zero', true))
      }
      return { points: out, handled: all }
    }
    case 'cbrt': {
      // params [a, b, c] -> a cbrt(x - b) + c. Monotonic, and concavity flips
      // at the branch point (f'' is unbounded there, not zero — a numeric
      // second-derivative scan would never find it).
      const [a, b, c] = p
      if (Math.abs(a) < 1e-15) return null
      const out: SpecialPoint[] = []
      const u = -c / a
      const r = b + u * u * u
      if (inDom(r)) push(out, pt('zero', r, 0, 'zero', true))
      if (inDom(b) && b > lo + 1e-12 && b < hi - 1e-12) {
        push(out, pt('inflection', b, c, 'inflection', true))
      }
      return { points: out, handled: all }
    }
    case 'exp': {
      // params [a, b, c] -> a e^{bx} + c: monotonic, no inflection
      const [a, b, c] = p
      if (Math.abs(a) < 1e-15 || Math.abs(b) < 1e-15) return null
      const out: SpecialPoint[] = []
      const ratio = -c / a
      if (ratio > 0) {
        const r = Math.log(ratio) / b
        if (inDom(r)) push(out, pt('zero', r, 0, 'zero', true))
      }
      return { points: out, handled: all }
    }
    case 'log': {
      // params [a, b, c] -> a ln(x - b) + c, defined only for x > b.
      // a ln(u) + c = 0 at u = e^{-c/a}, which is positive for every c: a
      // logarithm crosses the axis exactly once, always. It is monotonic
      // (f' = a/u never vanishes) and its concavity never changes sign
      // (f'' = -a/u² ), so it has neither extrema nor inflections — and the
      // asymptote at x = b is NOT a zero, however close to it the curve runs.
      const [a, b, c] = p
      if (Math.abs(a) < 1e-15) return null
      const out: SpecialPoint[] = []
      const r = b + Math.exp(-c / a)
      if (Number.isFinite(r) && r > b && inDom(r)) push(out, pt('zero', r, 0, 'zero', true))
      return { points: out, handled: all }
    }
    case 'recip': {
      // params [a, b, c] -> a/(x - b) + c, a hyperbola with a pole at x = b.
      // a/(x-b) = -c has the single solution x = b - a/c when c != 0; when
      // c = 0 the curve is a/(x-b), which approaches the axis but never
      // reaches it, so there is no zero at all. THE POLE IS NOT A ZERO: it is
      // where the curve stops existing, and the value there is undefined, not
      // small. (The numeric scanner's value check says the same thing from the
      // other side; this family never reaches it, being handled in closed form.)
      const [a, b, c] = p
      if (Math.abs(a) < 1e-15) return null
      const out: SpecialPoint[] = []
      if (Math.abs(c) > 1e-15) {
        const r = b - a / c
        if (Number.isFinite(r) && r !== b && inDom(r)) push(out, pt('zero', r, 0, 'zero', true))
      }
      // monotone on each branch (f' = -a/u²), no inflection (f'' = 2a/u³)
      return { points: out, handled: all }
    }
    case 'logistic': {
      // params [a, b, c, d] -> a/(1 + e^{-b(x-c)}) + d
      const [a, b, c, d] = p
      if (Math.abs(a) < 1e-15 || Math.abs(b) < 1e-15) return null
      const out: SpecialPoint[] = []
      if (inDom(c)) push(out, pt('inflection', c, d + a / 2, 'inflection', true))
      // a/(1+E) + d = 0  ->  E = -a/d - 1
      if (Math.abs(d) > 1e-15) {
        const E = -a / d - 1
        if (E > 0) {
          const r = c - Math.log(E) / b
          if (inDom(r)) push(out, pt('zero', r, 0, 'zero', true))
        }
      }
      return { points: out, handled: all }
    }
    case 'gauss': {
      // params [a, b, c, d] -> a e^{-((x-b)/c)^2} + d
      const [a, b, c, d] = p
      if (Math.abs(a) < 1e-15 || Math.abs(c) < 1e-15) return null
      const out: SpecialPoint[] = []
      if (inDom(b)) {
        const isMax = a > 0
        push(out, pt(isMax ? 'maximum' : 'minimum', b, a + d, isMax ? 'max' : 'min', true))
      }
      // inflections where 2u^2/c^2 = 1
      const w = Math.abs(c) / Math.SQRT2
      const yi = d + a * Math.exp(-0.5)
      for (const r of [b - w, b + w]) {
        if (inDom(r)) push(out, pt('inflection', r, yi, 'inflection', true))
      }
      // zeros: e^{-(u/c)^2} = -d/a
      const R = -d / a
      if (R > 0 && R <= 1) {
        if (Math.abs(R - 1) < 1e-14) {
          if (inDom(b)) push(out, pt('zero', b, 0, 'zero', true, true))
        } else {
          const u = Math.abs(c) * Math.sqrt(-Math.log(R))
          for (const r of [b - u, b + u]) {
            if (inDom(r)) push(out, pt('zero', r, 0, 'zero', true))
          }
        }
      }
      return { points: out, handled: all }
    }
    case 'power': {
      // params [a, b, c, p] -> a|x - b|^p + c. Even about b: the vertex is an
      // extremum (a cusp when p < 1), and there is no inflection on either arm.
      const [a, b, c, e] = p
      if (Math.abs(a) < 1e-15 || !(e > 0)) return null
      const out: SpecialPoint[] = []
      if (inDom(b) && b > lo + 1e-12 && b < hi - 1e-12) {
        const isMax = a < 0
        push(out, pt(isMax ? 'maximum' : 'minimum', b, c, isMax ? 'max' : 'min', true))
      }
      const ratio = -c / a
      if (Math.abs(ratio) < 1e-15) {
        if (inDom(b)) push(out, pt('zero', b, 0, 'zero', true, true))
      } else if (ratio > 0) {
        const u = Math.pow(ratio, 1 / e)
        for (const r of [b - u, b + u]) if (inDom(r)) push(out, pt('zero', r, 0, 'zero', true))
      }
      return { points: out, handled: all }
    }
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Exact forms
//
// Every SpecialPoint the explicit path produces gets asked whether its
// coordinates are a number a teacher would write down — √3, π/4, (1+√5)/2 —
// and the answer is attached as exactX / exactY (src/core/exact.ts).
//
// The rule is the one the module's contract states, applied per point:
//
//   * a point LOCATED IN CLOSED FORM (`exact: true` — a parabola's vertex, a
//     sine crest, a cubic's inflection) carries full double precision, so its
//     x is matched directly at 1e-11. Nothing has to witness it: it was
//     solved, not searched. This is also the only path that can speak for the
//     kink of a|x − b|, where there is no derivative to test with.
//   * a point LOCATED NUMERICALLY (`exact: false` — a bisected root, a
//     golden-section extremum, a bisected f″ crossing) is good to ~1e-8, so
//     `verifiedExact` proposes at 1e-6 and THE CURVE decides: the candidate
//     is accepted only if f, f′ or f″ is actually ~0 AT the candidate. That
//     is what stops 1.9999998 from being printed as 2 when the extremum is
//     genuinely somewhere else.
//
// y is never verified, because y is not searched for: it is f evaluated at the
// exact x, so recognising it is an ordinary tight match. And when an x form is
// accepted the point is POLISHED onto it — pos.x = form.value, pos.y = f of
// that — so the decimal beside "√2" on the card is the decimal OF √2, not the
// bisection's last iterate.
//
// The definitional coordinate is left alone: a zero's y is 0 and a
// y-intercept's x is 0 by construction, and printing "0" beside them as a
// discovery would be noise.
// ---------------------------------------------------------------------------

/** Tolerance for a value that was solved for rather than searched for. */
const EXACT_TIGHT = 1e-11
/** Tolerance for a y, which is one evaluation of f away from an exact x. */
const EXACT_Y = 1e-10
/** |f(c)| this small, relative to the curve's magnitude, IS a zero. */
const ZERO_CHECK = 1e-9
/** |f′(c)| this small, relative to the curve's typical slope, IS an extremum. */
const SLOPE_CHECK = 1e-8
/** |f″(c)| relative to the curve's typical curvature — differentiated twice. */
const CURV_CHECK_SYMBOLIC = 1e-9
const CURV_CHECK_NUMERIC = 1e-7
/**
 * Step for the f″ a CANDIDATE is checked with, as a fraction of |x|. Much
 * larger than H2, which is tuned for a bisection scan that only needs a sign.
 * Here f″ has to be small enough to separate a real inflection from a form
 * that missed by 1e-6, and at H2 the answer is buried in roundoff: three
 * nearly equal values over (1.2e-4)² carries ~1e-8 of dust, which is the size
 * of the thing being measured. At 1e-3 the dust is ~1e-9 and Richardson
 * cancels the h² truncation term that paying for the wider stencil would
 * otherwise cost. The margin this buys is not theoretical: a sketched
 * sinusoid's inflection sat 6e-7 from (31−√307)/4 and was ACCEPTED before it.
 */
const H_CHECK2 = 1e-3
/** Samples used to size "small" for the three checks above. */
const SCALE_SAMPLES = 64

/** Ascending coefficients of p′ from ascending coefficients of p. */
function polyDeriv(c: number[]): number[] {
  if (c.length <= 1) return [0]
  const out = new Array<number>(c.length - 1)
  for (let k = 1; k < c.length; k++) out[k - 1] = c[k] * k
  return out
}

function horner(c: number[], x: number): number {
  let v = 0
  for (let i = c.length - 1; i >= 0; i--) v = v * x + c[i]
  return v
}

/** Families whose params ARE ascending polynomial coefficients. */
const POLY_FAMILIES = new Set(['line', 'poly2', 'poly3', 'poly4'])

interface Derivs {
  d1: (x: number) => number | null
  d2: (x: number) => number | null
  /** true when both came from differentiated coefficients */
  symbolic: boolean
}

/**
 * f′ and f″ for the checks. Polynomials are differentiated exactly; everything
 * else gets Richardson extrapolation of the central difference — the same
 * scheme calculus.ts uses for a typed expression's tangent, written here so
 * that analyze does not have to import the module that imports IT.
 *
 * No corner detector, deliberately: at the kink of a typed |x − 1| the
 * symmetric difference reads 0, and 0 is the right answer to "is x = 1 where
 * this curve turns?" — which is the only question being asked here.
 */
function derivsFor(curve: FittedCurve, f: Fn): Derivs {
  if (POLY_FAMILIES.has(curve.modelId) && curve.params.every(Number.isFinite)) {
    const c1 = polyDeriv(curve.params)
    const c2 = polyDeriv(c1)
    return {
      d1: (x: number) => horner(c1, x),
      d2: (x: number) => horner(c2, x),
      symbolic: true,
    }
  }
  return {
    d1: (x: number) => {
      const h = H1 * Math.max(1, Math.abs(x))
      const a = (f(x + h) - f(x - h)) / (2 * h)
      const b = (f(x + h / 2) - f(x - h / 2)) / h
      const m = (4 * b - a) / 3
      return Number.isFinite(m) ? m : null
    },
    d2: (x: number) => {
      const h = H_CHECK2 * Math.max(1, Math.abs(x))
      const f0 = f(x)
      const a = (f(x + h) - 2 * f0 + f(x - h)) / (h * h)
      const hh = h / 2
      const b = (f(x + hh) - 2 * f0 + f(x - hh)) / (hh * hh)
      const m = (4 * b - a) / 3
      return Number.isFinite(m) ? m : null
    },
    symbolic: false,
  }
}

interface Scales {
  value: number
  slope: number
  curv: number
}

/** What "small" means for this curve: its own magnitude, slope and curvature. */
function sampleScales(f: Fn, lo: number, hi: number): Scales {
  const n = SCALE_SAMPLES
  const step = (hi - lo) / n
  const ys = new Array<number>(n + 1)
  for (let i = 0; i <= n; i++) {
    let y: number
    try { y = f(lo + i * step) } catch { y = Number.NaN }
    ys[i] = y
  }
  const slopes: number[] = []
  const curvs: number[] = []
  for (let i = 1; i < n; i++) {
    const a = ys[i - 1]
    const b = ys[i]
    const c = ys[i + 1]
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) continue
    slopes.push((c - a) / (2 * step))
    curvs.push((c - 2 * b + a) / (step * step))
  }
  return {
    value: Math.max(1, robustScale(ys)),
    slope: Math.max(1, robustScale(slopes)),
    curv: Math.max(1, robustScale(curvs)),
  }
}

/** The curve's own test that a candidate x really is this kind of point. */
function checkFor(
  kind: SpecialPointKind,
  f: Fn,
  der: Derivs,
  scales: () => Scales,
): ((c: number) => boolean) | null {
  switch (kind) {
    case 'zero':
      return (c: number) => {
        let y: number
        try { y = f(c) } catch { return false }
        return Number.isFinite(y) && Math.abs(y) <= ZERO_CHECK * scales().value
      }
    case 'maximum':
    case 'minimum':
      return (c: number) => {
        let m: number | null
        try { m = der.d1(c) } catch { return false }
        return m !== null && Math.abs(m) <= SLOPE_CHECK * scales().slope
      }
    case 'inflection':
      return (c: number) => {
        let s: number | null
        try { s = der.d2(c) } catch { return false }
        const tol = der.symbolic ? CURV_CHECK_SYMBOLIC : CURV_CHECK_NUMERIC
        return s !== null && Math.abs(s) <= tol * scales().curv
      }
    default:
      return null
  }
}

/** The exact form of a y that has already been computed, if it has one. */
function attachY(p: SpecialPoint, y: number): void {
  if (!Number.isFinite(y)) return
  const form = exactForm(y, { tol: EXACT_Y })
  if (!form) return
  p.exactY = form.text
  p.pos = { x: p.pos.x, y: form.value + 0 }
}

/**
 * Attach exactX to ONE point and polish the point onto the form: pos.x
 * becomes the form's value and pos.y is f re-evaluated there, so the decimal
 * beside "√2" is the decimal OF √2. `check` is the curve's own test that a
 * candidate x really is this kind of point — the thing that keeps a form that
 * merely fits the digits from ever being printed.
 *
 * A point flagged `exact` was solved for, so its x is matched tight and
 * directly; everything else goes through verifiedExact.
 */
function attachExactAt(p: SpecialPoint, f: Fn, check: (c: number) => boolean): void {
  let form: ExactForm | null = p.exact
    ? exactForm(p.pos.x, { tol: EXACT_TIGHT })
    : null
  if (!form) form = verifiedExact(p.pos.x, check)
  if (!form) return

  p.exactX = form.text
  if (p.kind === 'zero') {
    // a zero's y is 0 by definition, not by evaluation
    p.pos = { x: form.value, y: 0 }
    return
  }
  let y: number
  try { y = f(form.value) } catch { y = Number.NaN }
  p.pos = { x: form.value + 0, y: (Number.isFinite(y) ? y : p.pos.y) + 0 }
  attachY(p, p.pos.y)
}

/**
 * Attach exactX / exactY to the points of an explicit curve, and polish each
 * point onto the form that was accepted for it.
 */
function attachExactForms(
  points: SpecialPoint[],
  curve: FittedCurve,
  f: Fn,
  lo: number,
  hi: number,
): SpecialPoint[] {
  if (points.length === 0) return points
  const der = derivsFor(curve, f)
  let cached: Scales | null = null
  const scales = () => (cached ??= sampleScales(f, lo, hi))

  for (const p of points) {
    // A hole is not on the curve: f has no value at its x and its y is a
    // two-sided limit, so there is nothing to verify against. Both
    // coordinates are matched directly — the x is a snapped root or a written
    // exclusion, the y the limit that converged.
    if (p.kind === 'hole') {
      const xf = exactForm(p.pos.x, { tol: EXACT_TIGHT })
      const yf = exactForm(p.pos.y, { tol: HOLE_Y_TOL })
      if (xf) { p.exactX = xf.text; p.pos = { x: xf.value, y: p.pos.y } }
      if (yf) { p.exactY = yf.text; p.pos = { x: p.pos.x, y: yf.value } }
      continue
    }
    // x = 0 by construction; only the y says anything.
    if (p.kind === 'y-intercept') {
      attachY(p, p.pos.y)
      continue
    }
    // out of time: the rest keep their decimals (a closed form is never guessed)
    if (analysisLate()) continue
    const check = checkFor(p.kind, f, der, scales)
    if (!check) continue
    // Polish: the printed decimal becomes the decimal of the printed form.
    attachExactAt(p, f, check)
  }
  return points
}

/**
 * Exponential zeros and crossings in their LOGARITHMIC form (F-LE.4). A
 * typed y = a·b^(mx + c) + k carries its shape (ModelSpec.expShape, read from
 * the formula itself by src/core/expSolve.ts); a zero of it — or a crossing
 * of two such curves, or of one with a constant — is then the solution of an
 * equation solved exactly: log₂(7/3) = ln(7/3)/ln 2, 5 ln 4 = 10 ln 2,
 * ln 3/(ln 3 − ln 2). The form is attached only to the point the numeric
 * search already found there (to 1e-7), and only when the shape was
 * recognised exactly; nothing is ever guessed from digits here.
 */
function attachExpForms(
  points: SpecialPoint[],
  curve: FittedCurve,
  spec: ModelSpec | undefined,
  other: { curve: FittedCurve; spec: ModelSpec } | null,
): SpecialPoint[] {
  if (!spec?.expShape || points.length === 0) return points
  try {
    const fs = spec.expShape(curve.params)
    if (!fs) return points
    let gs: ExpShape | null = { term: null, k: { n: 0n, d: 1n } } as ExpShape
    if (other) {
      gs = other.spec.expShape ? other.spec.expShape(other.curve.params) : null
      if (!gs) return points
    }
    if (!fs.term && !gs.term) return points
    const sol = solveExpEquation(fs, gs)
    if (!sol || sol.kind !== 'one') return points
    const want: SpecialPointKind = other ? 'intersection' : 'zero'
    for (const p of points) {
      if (p.kind !== want) continue
      if (Math.abs(p.pos.x - sol.x) > 1e-7 * Math.max(1, Math.abs(sol.x))) continue
      if (sol.rational && p.exactX) continue
      p.exactX = sol.forms[0].text
      if (sol.forms.length > 1) p.exactAlt = sol.forms.slice(1).map((f) => f.text).join(' = ')
      else delete p.exactAlt
      let y = p.pos.y
      if (want === 'zero') y = 0
      else {
        try {
          const v = spec.evalExplicit?.(curve.params, sol.x)
          if (typeof v === 'number' && Number.isFinite(v)) y = v
        } catch {
          /* keep the y the search found */
        }
      }
      p.pos = { x: sol.x, y }
      p.exact = true
      if (want === 'intersection') {
        delete p.exactY
        attachY(p, y)
      }
    }
  } catch {
    /* a shape that cannot be solved leaves the points as they were */
  }
  return points
}

// ---------------------------------------------------------------------------
// Explicit driver
// ---------------------------------------------------------------------------

function analyzeExplicit(
  curve: FittedCurve,
  spec: ModelSpec,
  models: Record<string, ModelSpec>,
): SpecialPoint[] {
  const evalF = spec.evalExplicit
  if (!evalF) return []
  const f: Fn = (x: number) => {
    const v = evalF.call(spec, curve.params, x)
    return typeof v === 'number' ? v : Number.NaN
  }
  const dom = curve.domain ?? DEFAULT_DOMAIN
  let lo = dom[0]
  let hi = dom[1]
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return []

  const cf = closedForm(curve, lo, hi)
  const out: SpecialPoint[] = cf ? cf.points.slice() : []
  const need: NumericOpts = cf
    ? { zeros: !cf.handled.zeros, extrema: !cf.handled.extrema, inflections: !cf.handled.inflections }
    : { zeros: true, extrema: true, inflections: true }

  if (need.zeros || need.extrema || need.inflections) {
    const evalExact = spec.evalExact
    const exactAt = evalExact
      ? (x: number): number | undefined => {
          const at = exactPointOf(x)
          return at ? evalExact.call(spec, curve.params, at) : undefined
        }
      : undefined
    out.push(...analyzeExplicitNumeric(f, lo, hi, need, piecesOf(curve, spec), exactAt))
  }

  // y-intercept: a direct evaluation, so it is exact when it exists at all
  if (lo <= 0 && hi >= 0) {
    const y0 = f(0)
    if (Number.isFinite(y0)) {
      const q = pt('y-intercept', 0, y0, 'y-intercept', true)
      if (q) out.push(q)
    }
  }

  // ---- holes ------------------------------------------------------------
  // Removable discontinuities, over the SAME range everything else was found
  // on. A hole is not a zero and not an extremum, however the scan read it:
  // (x−1)²/(x−1) has the limit 0 at x = 1 and a sign change straddling it, so
  // the sign-change scan reports an x-intercept that the curve does not have.
  // Whatever the numeric core found AT a hole is dropped in its favour.
  const holes = findHoles(curve, models, [lo, hi])
  const kept = holes.length === 0
    ? finish(out)
    : finish(out).filter(p => !holes.some(
        h => Math.abs(p.pos.x - h.x) <= HOLE_DEDUPE * Math.max(1, Math.abs(h.x)),
      ))

  // Holes come after the zeros, extrema and inflections: they are a different
  // kind of fact about the curve, and the readout lists them last.
  // `exact` stays false even for a hole whose x is exact (an explicit
  // `{x != 2}`): SpecialPoint has ONE exact flag and the y here is a limit,
  // never an exact value, so claiming exactness would overstate the y.
  for (const h of holes.slice().sort((a, b) => a.x - b.x)) {
    // a hole the formula reaches from one side only is an open END of the
    // graph (x·ln x at 0): the same open ring, stated as where f heads
    const q = pt('hole', h.x, h.y, h.side ? 'open end' : 'hole', false)
    if (q) {
      if (h.side) q.side = h.side
      kept.push(q)
    }
  }
  return attachExpForms(attachExactForms(inDomain(kept, curve, models, f), curve, f, lo, hi), curve, spec, null)
}

/**
 * Only points whose x is in the curve's domain.
 *
 * An evaluator can hand back a value where the formula has none: (e²ˣ − 1)/
 * ln(1 + x) at x = −1 is (e⁻² − 1)/(−∞), which IEEE arithmetic calls 0, so
 * the scan found a "zero" at −1 — where ln(1 + x) does not exist. A point
 * that sits at the edge of where f is defined (f has no value just to one
 * side of it) is checked against curveDomain, which settles a boundary by
 * exact arithmetic and by how f arrives there: √x keeps its zero at 0,
 * ln(1 + x) loses its point at −1. Holes are not on the curve by definition
 * and are kept. Interior points never pay for the domain scan.
 */
function inDomain(
  points: SpecialPoint[],
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  f: Fn,
): SpecialPoint[] {
  let dom: ReturnType<typeof curveDomain> | undefined
  return points.filter((p) => {
    if (p.kind === 'hole') return true
    const x = p.pos.x
    const d = 1e-7 * Math.max(1, Math.abs(x))
    if (Number.isFinite(f(x - d)) && Number.isFinite(f(x + d))) return true
    if (dom === undefined) dom = curveDomain(curve, models)
    if (!dom || dom.kind !== 'intervals' || dom.parts.length === 0) return true
    const parts = dom.parts
    // a periodic domain lists only the parts of its core window: beyond them, keep
    if (x < parts[0].lo || x > parts[parts.length - 1].hi) return dom.periodic !== undefined
    const near = (a: number, b: number): boolean =>
      Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b))
    return parts.some((q) => {
      if (near(x, q.lo)) return q.loClosed
      if (near(x, q.hi)) return q.hiClosed
      return x > q.lo && x < q.hi
    })
  })
}

/** Dedupe within each kind, drop non-finite, sort left to right. */
function finish(points: SpecialPoint[]): SpecialPoint[] {
  const byKind = new Map<string, SpecialPoint[]>()
  for (const p of points) {
    if (!Number.isFinite(p.pos.x) || !Number.isFinite(p.pos.y)) continue
    const list = byKind.get(p.kind)
    if (list) list.push(p)
    else byKind.set(p.kind, [p])
  }
  const kept: SpecialPoint[] = []
  for (const list of byKind.values()) {
    list.sort((a, b) => a.pos.x - b.pos.x)
    for (const p of list) {
      const dup = kept.find(
        q => q.kind === p.kind && Math.abs(q.pos.x - p.pos.x) < DEDUPE_X,
      )
      if (dup) {
        // prefer the closed-form version of the same point
        if (p.exact && !dup.exact) {
          dup.pos = p.pos
          dup.exact = true
          if (p.tangent) dup.tangent = true
        } else if (p.tangent && !dup.tangent) {
          dup.tangent = true
        }
        continue
      }
      kept.push(p)
    }
  }
  kept.sort((a, b) => a.pos.x - b.pos.x)
  return kept
}

// ---------------------------------------------------------------------------
// Implicit conics
// ---------------------------------------------------------------------------

function analyzeCircle(curve: FittedCurve): SpecialPoint[] {
  const [a, b, r] = curve.params
  if (!(r > 0)) return []
  const out: SpecialPoint[] = []
  const add = (x: number, y: number, label: string) => {
    const p = pt('extreme', x, y, label, true)
    if (p) out.push(p)
  }
  add(a - r, b, 'left')
  add(a + r, b, 'right')
  add(a, b - r, 'bottom')
  add(a, b + r, 'top')
  // x-axis crossings
  const disc = r * r - b * b
  if (disc > 0) {
    const s = Math.sqrt(disc)
    for (const x of [a - s, a + s]) {
      const p = pt('zero', x, 0, 'zero', true)
      if (p) out.push(p)
    }
  } else if (Math.abs(disc) < 1e-14 * Math.max(1, r * r)) {
    const p = pt('zero', a, 0, 'zero', true, true)
    if (p) out.push(p)
  }
  return out.sort((p, q) => p.pos.x - q.pos.x)
}

function analyzeEllipse(curve: FittedCurve): SpecialPoint[] {
  const cf = conicToCenterForm(curve.params)
  if (!cf) return []
  const { cx, cy, rx, ry, angle } = cf
  const co = Math.cos(angle)
  const si = Math.sin(angle)
  const at = (t: number): Vec2 => ({
    x: cx + rx * Math.cos(t) * co - ry * Math.sin(t) * si,
    y: cy + rx * Math.cos(t) * si + ry * Math.sin(t) * co,
  })
  const out: SpecialPoint[] = []
  // dx/dt = 0 and dy/dt = 0, solved exactly
  const tx = Math.atan2(-ry * si, rx * co)
  const ty = Math.atan2(ry * co, rx * si)
  const xs = [at(tx), at(tx + Math.PI)].sort((p, q) => p.x - q.x)
  const ys = [at(ty), at(ty + Math.PI)].sort((p, q) => p.y - q.y)
  const add = (v: Vec2, label: string) => {
    const p = pt('extreme', v.x, v.y, label, true)
    if (p) out.push(p)
  }
  add(xs[0], 'left')
  add(xs[1], 'right')
  add(ys[0], 'bottom')
  add(ys[1], 'top')
  // x-axis crossings: set y = 0 in the conic -> A x^2 + D x + F = 0
  // conic params are unit-normalised, so A shrinks like 1/|centre|² as the
  // ellipse moves away from the origin: an absolute floor here would stop
  // reporting x-intercepts long before A stopped being meaningful
  const [A, B, C, D, , F] = curve.params
  const quad = Math.max(Math.abs(A), Math.abs(B), Math.abs(C))
  if (quad > 0 && Math.abs(A) > 1e-12 * quad) {
    const disc = D * D - 4 * A * F
    if (disc > 0) {
      const s = Math.sqrt(disc)
      for (const x of [(-D - s) / (2 * A), (-D + s) / (2 * A)]) {
        const p = pt('zero', x, 0, 'zero', true)
        if (p) out.push(p)
      }
    }
  }
  return out.sort((p, q) => p.pos.x - q.pos.x)
}

// ---------------------------------------------------------------------------
// Polar
// ---------------------------------------------------------------------------

function analyzePolar(
  curve: FittedCurve,
  spec: ModelSpec,
  models: Record<string, ModelSpec>,
): SpecialPoint[] {
  const tips = polarTips(curve, spec)

  // Holes, at the CARTESIAN point the curve is missing: r = sin(θ)/θ has no
  // value at θ = 0 but approaches 1 from both sides, so the open ring goes at
  // (1, 0). A tip that lands on a hole is the hole — the curve is not there.
  const holes = findHoles(curve, models, [lo0(curve), hi0(curve)])
  const kept = holes.length === 0
    ? tips
    : tips.filter(p => !holes.some(
        h => Math.hypot(p.pos.x - h.x, p.pos.y - h.y)
          <= HOLE_DEDUPE * Math.max(1, Math.hypot(h.x, h.y)),
      ))
  for (const h of holes) {
    // `exact` stays false: the point is a limit, as it is for an explicit hole.
    const q = pt('hole', h.x, h.y, 'hole', false)
    if (q) {
      // Both coordinates of a polar hole are limits — r0·cos θ0 and r0·sin θ0
      // — so neither is verified against anything, exactly as above.
      const xf = exactForm(q.pos.x, { tol: HOLE_Y_TOL })
      const yf = exactForm(q.pos.y, { tol: HOLE_Y_TOL })
      if (xf) { q.exactX = xf.text; q.pos = { x: xf.value, y: q.pos.y } }
      if (yf) { q.exactY = yf.text; q.pos = { x: q.pos.x, y: yf.value } }
      kept.push(q)
    }
  }
  return kept
}

/** The θ window a polar curve is swept over — its own, or one default turn. */
const lo0 = (curve: FittedCurve): number =>
  curve.domain ? Math.min(curve.domain[0], curve.domain[1]) : 0
const hi0 = (curve: FittedCurve): number =>
  curve.domain ? Math.max(curve.domain[0], curve.domain[1]) : 2 * Math.PI

function polarTips(curve: FittedCurve, spec: ModelSpec): SpecialPoint[] {
  const evalR = spec.evalPolar
  if (!evalR) return []
  const out: SpecialPoint[] = []
  // A tip is only a tip of THIS curve when its θ window sweeps it: the tips
  // come from the family's closed form over a whole turn, and a rose drawn on
  // 0 ≤ θ ≤ π/3 has one petal, not six. The same point is reached at θ + kπ
  // (r(θ + π) = −r(θ) for an odd rose traces it again), so any such θ inside
  // the window counts.
  const dom = curve.domain
  const swept = (x: number, y: number, t: number): boolean => {
    if (!dom) return true
    const a = Math.min(dom[0], dom[1]), b = Math.max(dom[0], dom[1])
    if (!Number.isFinite(a) || !Number.isFinite(b)) return true
    const tol = 1e-9 * Math.max(1, Math.hypot(x, y))
    const k0 = Math.ceil((a - t) / Math.PI - 1e-9)
    for (let k = k0, i = 0; i < 64; k++, i++) {
      const th = t + k * Math.PI
      if (th > b + 1e-9 * Math.max(1, Math.abs(b))) break
      const r = evalR.call(spec, curve.params, Math.min(b, Math.max(a, th)))
      if (Number.isFinite(r) && Math.hypot(r * Math.cos(th) - x, r * Math.sin(th) - y) <= tol) return true
    }
    return false
  }
  const push = (r: number, t: number) => {
    const p = pt('petal-tip', r * Math.cos(t), r * Math.sin(t), 'petal tip', true)
    if (p && swept(p.pos.x, p.pos.y, t)) out.push(p)
  }

  if (curve.modelId === 'polarRose') {
    // r = a cos(k*theta + c): |r| peaks where k*theta + c = pi*m
    const a = curve.params[0]
    const k = Math.round(curve.params[1])
    const c = curve.params[2] ?? 0
    if (!(Math.abs(a) > 0) || !(k >= 1)) return []
    for (let m = 0; m < 2 * k; m++) {
      const t = (Math.PI * m - c) / k
      push(evalR.call(spec, curve.params, t), t)
    }
  } else if (curve.modelId === 'limacon') {
    // r = a + b cos(theta): dr/dtheta = 0 at theta = 0, pi. The larger |r| is
    // the local maximum; the other is a local minimum, not a tip.
    const [a, b] = curve.params
    const r0 = a + b
    const rp = a - b
    if (Math.abs(r0) >= Math.abs(rp)) push(r0, 0)
    if (Math.abs(rp) >= Math.abs(r0)) push(rp, Math.PI)
  } else {
    // spiral and anything else: r is monotonic, so its largest value is a
    // domain endpoint rather than a local maximum. Nothing meaningful.
    return []
  }

  // dedupe coincident tips (an odd-k rose traces each petal twice)
  const kept: SpecialPoint[] = []
  for (const p of out) {
    if (kept.some(q => Math.hypot(q.pos.x - p.pos.x, q.pos.y - p.pos.y) < 1e-9)) continue
    kept.push(p)
  }
  return kept
}

// ---------------------------------------------------------------------------
// Parametric
// ---------------------------------------------------------------------------

function analyzeParametric(curve: FittedCurve, spec: ModelSpec): SpecialPoint[] {
  const evalP = spec.evalParametric
  if (!evalP) return []
  const dom = curve.domain ?? [0, 2 * Math.PI]
  const lo = dom[0]
  const hi = dom[1]
  if (!(hi > lo)) return []
  const n = PARAM_SAMPLES
  let iMinX = 0, iMaxX = 0, iMinY = 0, iMaxY = 0
  const val = (i: number) => evalP.call(spec, curve.params, lo + ((hi - lo) * i) / n)
  let best = val(0)
  if (!Number.isFinite(best.x) || !Number.isFinite(best.y)) return []
  let minX = best.x, maxX = best.x, minY = best.y, maxY = best.y
  for (let i = 1; i <= n; i++) {
    const v = val(i)
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) continue
    if (v.x < minX) { minX = v.x; iMinX = i }
    if (v.x > maxX) { maxX = v.x; iMaxX = i }
    if (v.y < minY) { minY = v.y; iMinY = i }
    if (v.y > maxY) { maxY = v.y; iMaxY = i }
  }
  const step = (hi - lo) / n
  // The search never leaves the curve's own t-interval: (t² − 4t, t − 1) on
  // 0 ≤ t ≤ 5 is rightmost at its END, t = 5 → (5, 4), and a bracket that
  // ran past the end used to find (5.042, 4.007) — a point the curve does
  // not reach. An extreme on the first or last sample is compared with the
  // end itself, which wins when it is at least as extreme.
  const refine = (i: number, key: 'x' | 'y', wantMax: boolean): Vec2 => {
    const a = Math.max(lo, lo + (i - 1) * step)
    const b = Math.min(hi, lo + (i + 1) * step)
    const g = (t: number) => {
      const v = evalP.call(spec, curve.params, t)
      const c = key === 'x' ? v.x : v.y
      return Number.isFinite(c) ? (wantMax ? -c : c) : Infinity
    }
    let t = goldenMin(g, a, b)
    for (const end of [a === lo ? lo : null, b === hi ? hi : null]) {
      if (end !== null && g(end) <= g(t)) t = end
    }
    return evalP.call(spec, curve.params, t)
  }
  const out: SpecialPoint[] = []
  const add = (v: Vec2, label: string) => {
    const p = pt('extreme', v.x, v.y, label, false)
    if (p) out.push(p)
  }
  add(refine(iMinX, 'x', false), 'left')
  add(refine(iMaxX, 'x', true), 'right')
  add(refine(iMinY, 'y', false), 'bottom')
  add(refine(iMaxY, 'y', true), 'top')
  return out.sort((p, q) => p.pos.x - q.pos.x)
}

/**
 * Only points the curve actually passes through.
 *
 * A piecewise function approaching an EXCLUDED end — x² + 1 on x < 0 near
 * (0, 1) — looks to the numeric scans like a minimum and an inflection
 * there, but f(0) belongs to another piece (it is 3) and the point is an
 * open dot, not a feature. Every zero, extremum, inflection and intercept
 * of a curve with pieces is checked against f itself at its x; one that
 * f does not reach is dropped. Holes are points f does NOT reach by
 * definition and are kept; curves without pieces are untouched.
 */
function ownedPoints(points: SpecialPoint[], curve: FittedCurve, spec: ModelSpec): SpecialPoint[] {
  const pieces = piecesOf(curve, spec)
  if (!pieces || !spec.evalExplicit) return points
  const f = spec.evalExplicit
  const at = (x: number): number => {
    try {
      return f.call(spec, curve.params, x)
    } catch {
      return Number.NaN
    }
  }
  // Finite piece ends; a scan converging on one from inside lands a hair
  // away from it, so "at the end" is judged with a small tolerance.
  const ends = pieceEnds(pieces)
  const near = (x: number, e: number): boolean => Math.abs(x - e) <= 1e-6 * Math.max(1, Math.abs(e))
  return points.filter((p) => {
    if (p.kind === 'hole' || p.kind === 'intersection') return true
    const x = p.pos.x
    const same = (y: number): boolean =>
      Number.isFinite(y) && Math.abs(y - p.pos.y) <= 1e-6 * Math.max(1, Math.abs(y), Math.abs(p.pos.y))
    const end = ends.find((e) => near(x, e))
    // At a piece end the point must be the value f takes AT the end — and the
    // end must be one the pieces INCLUDE: y = x {0 < x < 3} is not zero at 0,
    // whatever a lenient evaluator hands back there.
    if (end !== undefined) return coveredByPieces(pieces, end) && same(at(end))
    return same(at(x))
  })
}

/** The model's stated pieces (ModelSpec.pieces), or null when it has none. */
function piecesOf(curve: FittedCurve, spec: ModelSpec): PieceInfo[] | null {
  if (typeof spec.pieces !== 'function') return null
  let raw: PieceInfo[] | null | undefined
  try {
    raw = spec.pieces(curve.params)
  } catch {
    return null
  }
  if (!Array.isArray(raw) || raw.length === 0) return null
  const ok = raw.filter(q => q && typeof q.lo === 'number' && typeof q.hi === 'number' && !(q.hi < q.lo))
  return ok.length > 0 ? ok : null
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function analyzeCurve(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
): SpecialPoint[] {
  return withAnalysisBudget(() => analyzeCurveIn(curve, models))
}

function analyzeCurveIn(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
): SpecialPoint[] {
  try {
    const spec = models[curve.modelId]
    if (!spec || !curve.params.every(Number.isFinite)) return []

    if (spec.evalExplicit) return ownedPoints(analyzeExplicit(curve, spec, models), curve, spec)
    if (spec.evalPolar) return analyzePolar(curve, spec, models)
    if (spec.kind === 'implicit') {
      if (curve.modelId === 'circle') return analyzeCircle(curve)
      if (curve.modelId === 'ellipse') return analyzeEllipse(curve)
      return []
    }
    if (spec.evalParametric) {
      // a vertical line has no meaningful zero/extremum story
      if (curve.modelId === 'vline') return []
      return analyzeParametric(curve, spec)
    }
    return []
  } catch {
    return []
  }
}

/** One stretch on which a curve is identically zero (see zeroIntervals). */
export interface ZeroInterval {
  lo: number
  hi: number
  /** f(lo) = 0 and lo is in the domain: "0 ≤ x" rather than "0 < x" */
  loClosed: boolean
  hiClosed: boolean
}

/**
 * Where an explicit curve is zero on a whole INTERVAL rather than at points:
 * floor(x) on [0, 1), ceil(x) on (−1, 0], y = 0 {0 < x < 3}, the zero piece of
 * a piecewise function. A zero set like that is reported here, once, as an
 * interval — analyzeCurve drops every individual zero inside one (and every
 * extremum and inflection inside any constant stretch), keeping only the
 * isolated zeros elsewhere. The card reads "zero on 0 ≤ x < 1".
 *
 *   * `lo`/`hi` are located to double precision and snapped onto a stated
 *     piece end or a closed form the boundary bracket contains (the integers
 *     of floor, the 1/3 of floor(3x)); `exactForm(lo)` recovers its text.
 *   * `loClosed`/`hiClosed` say whether f is zero AT that end and the
 *     pieces include it — floor(x): [0, 1) → true/false; ceil(x): false/true.
 *   * The search is clipped to `range` ∩ curve.domain, so an interval that
 *     runs off the window ends at the window's edge (closed there when f is
 *     zero at the edge). `range` defaults to what analyzeCurve analyses —
 *     curve.domain, or [−10, 10] without one — so the two always agree on
 *     which zeros were folded into an interval.
 *   * Zero means EXACTLY zero, on every sample and between them: x¹⁰ is tiny
 *     near 0 but zero only at 0, and stays an isolated (tangent) zero.
 *     Resolution is one sample step (1/1200 of the span): a zero stretch
 *     narrower than that is reported by analyzeCurve as a point.
 *
 * Sorted left to right. [] for anything that is not an explicit y = f(x), and
 * never throws.
 */
export function zeroIntervals(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  range?: readonly [number, number],
): ZeroInterval[] {
  try {
    const spec = models[curve.modelId]
    if (!spec || !spec.evalExplicit || !curve.params.every(Number.isFinite)) return []
    const evalF = spec.evalExplicit
    const f: Fn = (x: number) => {
      const v = evalF.call(spec, curve.params, x)
      return typeof v === 'number' ? v : Number.NaN
    }
    const span = range
      ? sharedSpan(curve.domain ?? null, null, range)
      : sharedSpan(null, null, curve.domain ?? DEFAULT_DOMAIN)
    if (!span) return []
    const g = scanGrid(f, span[0], span[1], piecesOf(curve, spec))
    return g.flats
      .filter(fl => fl.y === 0)
      .map(fl => ({ lo: fl.lo, hi: fl.hi, loClosed: fl.loClosed, hiClosed: fl.hiClosed }))
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Intersections — where one curve meets another.
//
//   export function intersectionPoints(parent, other, models, range): SpecialPoint[]
//
// An intersection is an analysis point like any other, and it is reported on
// the PARENT: pos.y is the parent's f at the crossing (the two agree there, by
// definition, and the assertion below refuses the point if they do not), and
// withId names the curve it was met.
//
// Nothing here searches for the x's. A crossing IS a zero of f − g, and
// calculus.ts already hands that difference to the analyzer as a curve of its
// own — sign-change scan, pole guard, tangency pass, dedupe — so this function
// is about what the crossings MEAN: is the location known in closed form, does
// the difference touch without crossing, and what is the exact form.
//
// EXACTNESS IS NOT INHERITED FROM THE FAMILIES, only from the arithmetic. Two
// polynomials differ by a polynomial, and a polynomial of degree ≤ 2 has roots
// from a formula — those are exact. A cubic difference's roots were bisected
// to, whatever its coefficients were typed as, and are not.
//
// The exact FORM, on the other hand, is verified the way every other point's
// is: a candidate is believed only when the two curves actually agree at it,
// |f(c) − g(c)| ≤ 1e-9 · scale, evaluated AT the candidate. sin x and cos x
// meet at π/4 because sin(π/4) − cos(π/4) is zero, not because 0.7853981 is
// near π/4.
// ---------------------------------------------------------------------------

/** |f(c) − g(c)| this small, relative to their magnitude, and they MEET. */
const MEET_CHECK = 1e-9
/** A crossing reported this far from an actual meeting point is dropped. */
const MEET_ACCEPT = 1e-7
/**
 * First probe distance for the tangency test, as a fraction of the span — the
 * quarter-step the numeric core's own tangency pass uses, so a touch is read
 * here the same way it is read there.
 */
const TOUCH_PROBE = 0.25 / SAMPLES

/** The curve as f(x), or null when the family has no f(x) to evaluate. */
function explicitFnOf(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
): Fn | null {
  const spec = models[curve.modelId]
  if (!spec || spec.kind !== 'explicit' || !spec.evalExplicit) return null
  if (!Array.isArray(curve.params) || !curve.params.every(Number.isFinite)) return null
  const ev = spec.evalExplicit
  const params = curve.params
  return (x: number) => {
    let v: unknown
    try { v = ev.call(spec, params, x) } catch { return Number.NaN }
    return typeof v === 'number' ? v : Number.NaN
  }
}

/** `range`, clipped to whichever of the two curves restricts itself. */
function sharedSpan(
  a: [number, number] | null,
  b: [number, number] | null,
  range: readonly [number, number],
): [number, number] | null {
  let lo = Math.min(range[0], range[1])
  let hi = Math.max(range[0], range[1])
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null
  for (const d of [a, b]) {
    if (!d) continue
    const [dl, dh] = d
    if (!Number.isFinite(dl) || !Number.isFinite(dh) || !(dh > dl)) continue
    lo = Math.max(lo, dl)
    hi = Math.min(hi, dh)
  }
  return hi > lo ? [lo, hi] : null
}

/** Drop the zero leading coefficients a subtraction left behind. */
function trimCoeffs(c: readonly number[]): number[] {
  const out = c.slice()
  while (out.length > 1 && out[out.length - 1] === 0) out.pop()
  return out
}

/**
 * The roots of f − g when that difference has roots from a FORMULA: both
 * curves polynomial families and their difference linear or quadratic. Null
 * means "no closed form here" — a cubic or quartic difference, or a leading
 * coefficient too small for the formula to be the one the analyzer used.
 *
 * The thresholds mirror closedForm() exactly, because the question being
 * asked is precisely "did the analyzer take that branch?".
 */
function closedRootsOfDifference(
  parent: FittedCurve,
  other: FittedCurve,
): number[] | null {
  if (!POLY_FAMILIES.has(parent.modelId) || !POLY_FAMILIES.has(other.modelId)) return null
  const n = Math.max(parent.params.length, other.params.length)
  const d = new Array<number>(n)
  for (let i = 0; i < n; i++) d[i] = (parent.params[i] ?? 0) - (other.params[i] ?? 0)
  if (!d.every(Number.isFinite)) return null
  const t = trimCoeffs(d)

  if (t.length <= 2) {
    const b = t[0] ?? 0
    const m = t[1] ?? 0
    if (!(Math.abs(m) > 1e-15)) return []   // constant: no crossing to be exact about
    return [-b / m]
  }
  if (t.length === 3) {
    const [c0, c1, c2] = t
    if (Math.abs(c2) < 1e-15) return null   // closedForm() declines this too
    const disc = c1 * c1 - 4 * c2 * c0
    if (Math.abs(disc) <= 1e-14 * Math.max(1, c1 * c1)) return [-c1 / (2 * c2)]
    if (disc < 0) return []
    const s = Math.sqrt(disc)
    return [(-c1 - s) / (2 * c2), (-c1 + s) / (2 * c2)]
  }
  return null   // degree ≥ 3: the analyzer bisected for these
}

/**
 * Does f − g touch at x without crossing?
 *
 * Probing, not differentiating: a tangency of two sketched curves is a double
 * root of their difference, where f′ − g′ is zero too and a derivative test
 * reads noise. The probes step OUT from the crossing — past the neighbouring
 * crossings' half-distance, never — and widen until the difference is clear of
 * the curves' own numerical dust. Same sign on both sides is a touch.
 */
function touchesWithoutCrossing(
  f: Fn,
  g: Fn,
  x: number,
  span: number,
  gap: number,
  scale: number,
): boolean {
  const noise = MEET_CHECK * scale
  const base = Math.min(TOUCH_PROBE * span, 0.4 * gap)
  if (!(base > 0)) return false
  for (const k of [1, 10, 100]) {
    const d = base * k
    if (d > 0.45 * gap) break
    const before = f(x - d) - g(x - d)
    const after = f(x + d) - g(x + d)
    if (!Number.isFinite(before) || !Number.isFinite(after)) return false
    // too close to the crossing to tell the two apart: step further out
    if (Math.abs(before) <= noise || Math.abs(after) <= noise) continue
    return before > 0 === after > 0
  }
  return false
}

/**
 * Where `parent` meets `other` inside `range`, as analysis points on the
 * parent: kind 'intersection', withId = other.id, one per meeting point
 * (a tangency once), never a pole, sorted left to right.
 *
 * `exact` is true only for a crossing solved by formula (see
 * closedRootsOfDifference); `tangent` marks a touch that does not cross.
 * exactX is attached the way every other point's is — proposed loosely,
 * accepted only when both curves agree at the candidate — and the point is
 * polished onto the accepted form, so its decimal is the form's decimal.
 *
 * Two explicit functions of x take the path below, unchanged. Every other
 * pairing — explicit × implicit, implicit × implicit, and anything with a
 * parametric or polar curve in it — is solved in the plane by
 * planeIntersections (see "Intersections in the plane"), and its points are
 * reported the same way: kind 'intersection', withId, verified on both
 * curves, exact forms only when both curves agree at the form. Cheap enough
 * to run per visible pair on every analysis refresh; it memoises nothing.
 */
export function intersectionPoints(
  parent: FittedCurve,
  other: FittedCurve,
  models: Record<string, ModelSpec>,
  range: readonly [number, number],
): SpecialPoint[] {
  return pairMeeting(parent, other, models, range).points
}

// ---------------------------------------------------------------------------
// Coinciding curves — "f and g are the same function".
//
// y = x² − 2x − 8, y = (x + 2)(x − 4) and y = (x − 1)² − 9 are ONE function.
// Their difference is zero everywhere, and a root hunt over a difference that
// is rounding noise reports dozens of "crossings" — every sign change of the
// last bit. So before any crossing is looked for, the pair is asked whether it
// is the same curve:
//
//   * two POLYNOMIALS (valueTable.polynomialCoeffs, verified at x's the
//     interpolation never saw) are compared coefficient by coefficient —
//     EXACTLY when both are rational, so x² and x² + 10⁻⁹ are different
//     functions that never meet (no crossing, no coincidence), and within
//     10⁻¹² of the largest coefficient when one is a fitted decimal;
//   * anything else is SAMPLED: 512 x's across the span plus 48 far out to
//     ±1000 spans, f − g compared with a tolerance of 10⁻¹⁰ of the values
//     themselves plus 10⁻¹² of the window's typical |f|. Agreeing everywhere
//     sampled is "the same function"; agreeing on a run of samples is an
//     overlap INTERVAL (a piecewise curve sharing a piece), its ends bisected
//     to the last bit, snapped to closed forms, and OPEN where the two are
//     not both defined (ln(x²) and 2 ln x: x > 0).
//
//     Floating point makes "agree" cheap where the values are huge: 2ˣ and
//     2ˣ + 3 are within 10⁻¹⁰ of each other past x ≈ 35, and e^x and 2e^x
//     are both ∞ past 709. So: ∞ and ∞ is undecidable, never agreement; an
//     agreement whose tolerance is not 100× below the smallest difference the
//     WINDOW shows (away from a crossing) is undecidable too; and the far
//     samples are compared loosely and can only veto — an overlap needs six
//     agreeing samples inside the window.
//
//     Both undefined (a shared gap) ENDS a run: √(x² − 4) and √(x − 2)·√(x + 2)
//     coincide for x ≥ 2, not over the gap (−2, 2) where neither exists.
//     Undecidable samples neither break nor start one.
//
//   * either way, a HOLE one curve has and the other does not (findHoles) is
//     an exception: (x² − 1)/(x − 1) and x + 1 coincide everywhere except at
//     x = 1, so they are not quite the same function.
//
// Crossings inside an overlap are dropped — the curves are not crossing there,
// they are one curve — and crossings outside it are kept.
// ---------------------------------------------------------------------------

/** Where two curves are the same curve. */
export interface Coincidence {
  /** f ≡ g wherever both are drawn (the whole shared domain). */
  everywhere: boolean
  /**
   * The overlap intervals (±Infinity for an unbounded side); [] when everywhere.
   * An end is OPEN (loOpen / hiOpen) when the two are not both defined there:
   * ln(x²) and 2 ln x coincide for x > 0, not x ≥ 0.
   */
  intervals: { lo: number; hi: number; loExact?: string; hiExact?: string; loOpen?: boolean; hiOpen?: boolean }[]
  /** Decided by exact polynomial coefficients, not by sampling. */
  exact: boolean
  /**
   * x's inside the overlap where only ONE of the two is defined — a hole the
   * other does not have: (x² − 1)/(x − 1) and x + 1 at x = 1. Absent when none.
   */
  except?: { x: number; exact?: string }[]
  /** Both are undefined somewhere (a shared gap): the same function wherever they are defined. */
  gaps?: boolean
}

/** The meeting points of two curves, and where they coincide (null: nowhere). */
export interface PairMeeting {
  points: SpecialPoint[]
  coincide: Coincidence | null
}

const COINCIDE_SAMPLES = 512
const COINCIDE_FAR = 48
const COINCIDE_TOL = 1e-10
const COINCIDE_FLOOR = 1e-13
/** The absolute half of the in-window tolerance, as a fraction of the window's typical |f|. */
const COINCIDE_ABS = 1e-12
/** Outside the window the comparison is looser: those samples can only veto "everywhere". */
const COINCIDE_FAR_TOL = 1e-8
/**
 * An agreement counts only when its tolerance is at least this many times
 * below the smallest difference the window shows between the two curves.
 */
const COINCIDE_RESOLVE = 100
/** A run must hold this many consecutive agreeing samples to be an overlap, not a crossing. */
const COINCIDE_RUN = 6

function polyCoeffsOf(curve: FittedCurve, models: Record<string, ModelSpec>, f: Fn): Num[] | null {
  const spec = models[curve.modelId]
  if (!spec || spec.pieces) return null
  try {
    return polynomialCoeffs(f)
  } catch {
    return null
  }
}

/** Do the two curves coincide, and where? Explicit pairs only; null when they do not. */
export function curveCoincidence(
  a: FittedCurve,
  b: FittedCurve,
  models: Record<string, ModelSpec>,
  range: readonly [number, number],
): Coincidence | null {
  try {
    const f = explicitFnOf(a, models)
    const g = explicitFnOf(b, models)
    if (!f || !g) return null
    const span = sharedSpan(a.domain ?? null, b.domain ?? null, range)
    if (!span) return null
    return coincidenceOf(a, b, f, g, models, span)
  } catch {
    return null
  }
}

function coincidenceOf(
  a: FittedCurve,
  b: FittedCurve,
  f: Fn,
  g: Fn,
  models: Record<string, ModelSpec>,
  span: [number, number],
): Coincidence | null {
  const base = coincidenceBase(a, b, f, g, models, span)
  return base ? withHoleExceptions(base, a, b, f, g, models, span) : null
}

/** Both defined at x and equal there: the end of an overlap is then IN it (x ≥ 0), else not (x > 0). */
function closedAt(f: Fn, g: Fn, x: number): boolean {
  let u: number
  let w: number
  try {
    u = f(x)
    w = g(x)
  } catch {
    return false
  }
  if (!Number.isFinite(u) || !Number.isFinite(w)) return false
  return Math.abs(u - w) <= 1e-9 * Math.max(1, Math.abs(u), Math.abs(w))
}

/** An overlap interval with its ends snapped to closed forms and marked open where neither curve is there. */
function overlapInterval(f: Fn, g: Fn, lo: number, hi: number): Coincidence['intervals'][number] {
  const iv = withExactEnds(lo, hi)
  if (Number.isFinite(iv.lo) && !closedAt(f, g, iv.lo)) iv.loOpen = true
  if (Number.isFinite(iv.hi) && !closedAt(f, g, iv.hi)) iv.hiOpen = true
  return iv
}

/**
 * The same function "everywhere" — except where ONE of the two has a hole the
 * other does not: (x² − 1)/(x − 1) and x + 1 agree at every x but 1, where
 * only x + 1 is defined. Holes come from findHoles over the window (removable
 * discontinuities and written exclusions); a hole both curves share is not an
 * exception — neither is defined there.
 */
function withHoleExceptions(
  c: Coincidence,
  a: FittedCurve,
  b: FittedCurve,
  f: Fn,
  g: Fn,
  models: Record<string, ModelSpec>,
  span: [number, number],
): Coincidence {
  let ha: { x: number }[] = []
  let hb: { x: number }[] = []
  try {
    ha = findHoles(a, models, span)
    hb = findHoles(b, models, span)
  } catch {
    return c
  }
  const near = (p: number, q: number): boolean => Math.abs(p - q) <= 1e-9 * Math.max(1, Math.abs(p))
  const except: { x: number; exact?: string }[] = []
  const consider = (x: number, theirs: { x: number }[], other: Fn): void => {
    if (!Number.isFinite(x) || theirs.some((h) => near(h.x, x))) return
    if (except.some((e) => near(e.x, x))) return
    let v: number
    try { v = other(x) } catch { return }
    if (!Number.isFinite(v)) return
    if (!inOverlap(c, x)) return
    const e = exactForm(x, { tol: 1e-9 })
    except.push(e ? { x: e.value, exact: e.text } : { x })
  }
  for (const h of ha) consider(h.x, hb, g)
  for (const h of hb) consider(h.x, ha, f)
  if (except.length === 0) return c
  except.sort((p, q) => p.x - q.x)
  if (c.everywhere) return { everywhere: false, intervals: [{ lo: -Infinity, hi: Infinity }], exact: c.exact, except, ...(c.gaps ? { gaps: true } : {}) }
  return { ...c, except }
}

function coincidenceBase(
  a: FittedCurve,
  b: FittedCurve,
  f: Fn,
  g: Fn,
  models: Record<string, ModelSpec>,
  span: [number, number],
): Coincidence | null {
  const domLo = Math.max(a.domain ? Math.min(...a.domain) : -Infinity, b.domain ? Math.min(...b.domain) : -Infinity)
  const domHi = Math.min(a.domain ? Math.max(...a.domain) : Infinity, b.domain ? Math.max(...b.domain) : Infinity)
  const domainAll = (exact: boolean): Coincidence => {
    if (!a.domain && !b.domain) return { everywhere: true, intervals: [], exact }
    return { everywhere: false, intervals: [overlapInterval(f, g, domLo, domHi)], exact }
  }
  // ---- two polynomials: their coefficients decide
  const pa = polyCoeffsOf(a, models, f)
  const pb = pa ? polyCoeffsOf(b, models, g) : null
  if (pa && pb) {
    if (pa.length !== pb.length) return null
    const rational = pa.every((c) => !('d' in c)) && pb.every((c) => !('d' in c))
    if (rational) {
      const same = pa.every((c, i) => {
        const d = pb[i] as { p: number; q: number }
        const e = c as { p: number; q: number }
        return e.p === d.p && e.q === d.q
      })
      return same ? domainAll(true) : null
    }
    const big = Math.max(...pa.map((c) => Math.abs(numValue(c))), ...pb.map((c) => Math.abs(numValue(c))))
    const same = pa.every((c, i) => Math.abs(numValue(c) - numValue(pb[i])) <= 1e-12 * Math.max(1, big))
    return same ? domainAll(false) : null
  }
  // ---- anything else: sampled
  const [lo, hi] = span
  const pts: { x: number; win: boolean }[] = []
  for (let i = 0; i < COINCIDE_SAMPLES; i++) pts.push({ x: lo + ((hi - lo) * (i + 0.5)) / COINCIDE_SAMPLES, win: true })
  for (let k = 0; k < COINCIDE_FAR / 2; k++) {
    const r = Math.pow(1000, (k + 1) / (COINCIDE_FAR / 2)) * 1.0137
    for (const x of [hi + r * Math.max(1, hi - lo) / 10, lo - r * Math.max(1, hi - lo) / 10]) {
      if (x > domLo && x < domHi) pts.push({ x, win: false })
    }
  }
  pts.sort((u, w) => u.x - w.x)
  const xs = pts.map((p) => p.x)
  const evalPair = (x: number): [number, number] => {
    try {
      return [f(x), g(x)]
    } catch {
      return [Number.NaN, Number.NaN]
    }
  }
  const vals = xs.map(evalPair)

  // The window's typical size: the absolute half of the tolerance is a
  // fraction of it, so a value that is tiny next to the window — sin²x and
  // (1 − cos 2x)/2 at x ≈ 0, where the second is pure cancellation — can
  // still be seen to agree.
  const mags: number[] = []
  vals.forEach(([u, w], i) => {
    if (pts[i].win && Number.isFinite(u) && Number.isFinite(w)) mags.push(Math.max(Math.abs(u), Math.abs(w)))
  })
  let Y = median(mags)
  if (!(Y > 0)) Y = mags.reduce((s, v) => Math.max(s, v), 0)
  if (!(Y > 0)) Y = 1

  // 0 differ, 1 agree, 2 both undefined (a shared hole or gap),
  // 3 undecidable (both negligible, or agreeing only because the arithmetic
  // cannot see a difference the window shows plainly — see below)
  type St = 0 | 1 | 2 | 3
  const raw = (u: number, w: number, win: boolean): { s: St; d: number; tol: number } => {
    const fu = Number.isFinite(u)
    const fw = Number.isFinite(w)
    if (!fu && !fw) {
      // NaN and NaN: neither is defined here, a shared gap
      if (Number.isNaN(u) && Number.isNaN(w)) return { s: 2, d: 0, tol: 0 }
      // ∞ and ∞ of one sign — e^x and 2e^x past 709, ln(x²) and 2 ln x at
      // 0 — is no evidence of agreement: undecidable
      if (u === w) return { s: 3, d: 0, tol: 0 }
      return { s: 0, d: Infinity, tol: 0 }
    }
    if (!fu || !fw) return { s: 0, d: Infinity, tol: 0 }
    const m = Math.max(Math.abs(u), Math.abs(w))
    // Both (nearly) zero says nothing either way — 2ˣ and 3^(x − 1) far to
    // the left, two curves crossing on the axis.
    if (m <= COINCIDE_FLOOR) return { s: 3, d: 0, tol: 0 }
    const d = Math.abs(u - w)
    // relative to the values themselves, plus a sliver of the window's size;
    // far outside the window looser still (those samples can only veto)
    const tol = win ? COINCIDE_TOL * m + COINCIDE_ABS * Y : COINCIDE_FAR_TOL * (m + Y)
    return d <= tol ? { s: 1, d, tol } : { s: 0, d, tol }
  }
  const first = vals.map(([u, w], i) => raw(u, w, pts[i].win))

  // The smallest difference the WINDOW shows between the two (away from
  // where they cross, where any difference is small). An agreement whose own
  // tolerance is not far below it proves nothing: 2ˣ and 2ˣ + 3 differ by 3
  // everywhere, and "agree" past x ≈ 35 only because 3 is below 10⁻¹⁰ of 2ˣ.
  const sgn = (i: number): number => Math.sign(vals[i][0] - vals[i][1])
  let dMin = Infinity
  for (let i = 0; i < first.length; i++) {
    const r = first[i]
    if (!pts[i].win || r.s !== 0 || !Number.isFinite(r.d)) continue
    const crossing = [i - 1, i + 1].some((j) => j >= 0 && j < first.length && first[j].s === 0 && Number.isFinite(first[j].d) && sgn(j) !== sgn(i))
    if (!crossing) dMin = Math.min(dMin, r.d)
  }
  const settle = (r: { s: St; tol: number }): St => (r.s === 1 && COINCIDE_RESOLVE * r.tol >= dMin ? 3 : r.s)
  const st: St[] = first.map(settle)
  const stateAt = (x: number): St => {
    const [u, w] = evalPair(x)
    return settle(raw(u, w, x >= lo && x <= hi))
  }

  let agreeIn = 0
  st.forEach((s, i) => {
    if (s === 1 && pts[i].win) agreeIn++
  })
  if (agreeIn < COINCIDE_RUN) return null
  if (!st.includes(0)) {
    const all = domainAll(false)
    return st.includes(2) ? { ...all, gaps: true } : all
  }

  // runs of agreement: a difference ends one, and so does a gap where
  // neither is defined (√(x² − 4) and √(x − 2)·√(x + 2) are not one curve on
  // (−2, 2), where there is no curve at all); undecidable samples pass
  const runs: { i0: number; i1: number; n: number }[] = []
  let i0 = -1
  let i1 = -1
  let count = 0
  for (let i = 0; i <= st.length; i++) {
    const s = i < st.length ? st[i] : 0
    if (s === 1) {
      if (i0 < 0) i0 = i
      i1 = i
      if (pts[i].win) count++
    } else if (s === 0 || s === 2) {
      if (i0 >= 0) runs.push({ i0, i1, n: count })
      i0 = -1
      count = 0
    }
  }
  const inside = (s: St): boolean => s === 1 || s === 3
  const edge = (inX: number, outX: number): number => {
    let p = inX
    let q = outX
    for (let k = 0; k < 60; k++) {
      const m = 0.5 * (p + q)
      if (m === p || m === q) break
      if (inside(stateAt(m))) p = m
      else q = m
    }
    return p
  }
  const intervals: Coincidence['intervals'] = []
  for (const r of runs) {
    // far samples can veto, never make an overlap: a run needs the window's own samples
    if (r.n < COINCIDE_RUN) continue
    let j0 = r.i0
    while (j0 > 0 && st[j0 - 1] === 3) j0--
    let j1 = r.i1
    while (j1 < st.length - 1 && st[j1 + 1] === 3) j1++
    const L = j0 === 0 ? domLo : edge(xs[j0], xs[j0 - 1])
    const H = j1 === xs.length - 1 ? domHi : edge(xs[j1], xs[j1 + 1])
    if (!(H > L)) continue
    intervals.push(overlapInterval(f, g, L, H))
  }
  return intervals.length > 0 ? { everywhere: false, intervals, exact: false } : null
}

function withExactEnds(lo: number, hi: number): Coincidence['intervals'][number] {
  // an end found by bisection that is within a hair of 0 IS 0 (x and x² part there)
  if (Math.abs(lo) < 1e-9) lo = 0
  if (Math.abs(hi) < 1e-9) hi = 0
  const out: Coincidence['intervals'][number] = { lo, hi }
  if (Number.isFinite(lo)) {
    const e = exactForm(lo, { tol: 1e-9 })
    if (e) {
      out.lo = e.value
      out.loExact = e.text
    }
  }
  if (Number.isFinite(hi)) {
    const e = exactForm(hi, { tol: 1e-9 })
    if (e) {
      out.hi = e.value
      out.hiExact = e.text
    }
  }
  return out
}

/** Is x inside (or at the end of) one of the overlap intervals? */
function inOverlap(c: Coincidence, x: number): boolean {
  if (c.everywhere) return true
  return c.intervals.some((iv) => x >= iv.lo - 1e-9 * Math.max(1, Math.abs(iv.lo)) && x <= iv.hi + 1e-9 * Math.max(1, Math.abs(iv.hi)))
}

/**
 * intersectionPoints, with the pair's coincidence: where the two curves are
 * the same curve no point is reported (see "Coinciding curves" above).
 */
export function pairMeeting(
  parent: FittedCurve,
  other: FittedCurve,
  models: Record<string, ModelSpec>,
  range: readonly [number, number],
): PairMeeting {
  try {
    const f = explicitFnOf(parent, models)
    const g = explicitFnOf(other, models)
    // Anything that is not a pair of functions of x — a circle, a typed conic,
    // a polar or parametric curve — goes through the plane solver below.
    if (!f || !g) return { points: planeIntersections(parent, other, models, range), coincide: null }
    const span = sharedSpan(parent.domain ?? null, other.domain ?? null, range)
    if (!span) return { points: [], coincide: null }
    const [lo, hi] = span

    const coincide = coincidenceOf(parent, other, f, g, models, span)
    // the same curve over the whole span (bar a hole): nothing to cross
    if (coincide && (coincide.everywhere || coincide.intervals.some((iv) => iv.lo <= lo && iv.hi >= hi))) return { points: [], coincide }
    const points = meetingPoints(parent, other, models, f, g, lo, hi, range)
    return { points: coincide ? points.filter((p) => !inOverlap(coincide, p.pos.x)) : points, coincide }
  } catch {
    return { points: [], coincide: null }
  }
}

function meetingPoints(
  parent: FittedCurve,
  other: FittedCurve,
  models: Record<string, ModelSpec>,
  f: Fn,
  g: Fn,
  lo: number,
  hi: number,
  range: readonly [number, number],
): SpecialPoint[] {
  try {
    const xs = curveIntersections(parent, other, models, [lo, hi])
    const winLo = Math.min(range[0], range[1])
    const winHi = Math.max(range[0], range[1])
    if (xs.length === 0) return []

    // What "they agree here" means for THESE two curves: their own magnitude.
    const scale = Math.max(sampleScales(f, lo, hi).value, sampleScales(g, lo, hi).value)
    const meets = (c: number): boolean => {
      let a: number
      let b: number
      try { a = f(c); b = g(c) } catch { return false }
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false
      return Math.abs(a - b) <= MEET_CHECK * scale
    }

    const closed = closedRootsOfDifference(parent, other)
    const out: SpecialPoint[] = []

    for (let i = 0; i < xs.length; i++) {
      const x = xs[i]
      const y = f(x)
      const gy = g(x)
      if (!Number.isFinite(y) || !Number.isFinite(gy)) continue
      // the assertion: a crossing the curves do not actually share is not one
      if (Math.abs(y - gy) > MEET_ACCEPT * scale) continue
      // At an edge of the WINDOW (not a curve's own domain end: sin x on
      // [π, 2π] really does meet y = 0 at π and 2π) a "meeting" can be two
      // curves merely becoming small together — 2ˣ and 3^(x − 1) far to the
      // left. Such a point is kept when the two values agree relative to
      // themselves, as a real crossing's do, or when f − g opens up a step
      // inside the window, as it does past a real crossing (cos x and 0 at
      // −π/2); it is dropped when f − g stays negligible there too.
      // A crossing the arithmetic cannot resolve is not one: 10ˣ and 10ˣ + 1
      // "cross" near x = 16 only because 1 is below the last bit of 10¹⁶.
      // A real crossing (or touch) opens f − g up a step away, by far more
      // than the rounding of the values there.
      {
        const probe = (hi - lo) / SAMPLES
        let seen = false
        let clear = false
        for (const xp of [x - probe, x + probe]) {
          let u = Number.NaN
          let w = Number.NaN
          try { u = f(xp); w = g(xp) } catch { /* outside: no say */ }
          if (!Number.isFinite(u) || !Number.isFinite(w)) continue
          seen = true
          if (Math.abs(u - w) > 1e-12 * Math.max(Math.abs(u), Math.abs(w))) clear = true
        }
        if (seen && !clear) continue
      }
      const tolEdge = 1e-9 * (hi - lo)
      const atWinEdge =
        (Math.abs(x - winLo) <= tolEdge && Math.abs(lo - winLo) <= tolEdge) ||
        (Math.abs(x - winHi) <= tolEdge && Math.abs(hi - winHi) <= tolEdge)
      if (atWinEdge && Math.abs(y - gy) > 1e-6 * Math.max(Math.abs(y), Math.abs(gy))) {
        const step = (hi - lo) / SAMPLES
        const xin = x - lo < hi - x ? x + step : x - step
        let din = Number.NaN
        try { din = Math.abs(f(xin) - g(xin)) } catch { /* no value: not a crossing */ }
        if (!(din > 10 * MEET_ACCEPT * scale)) continue
      }

      const tol = 1e-9 * Math.max(1, Math.abs(x))
      const exact =
        closed !== null && closed.some(r => Math.abs(r - x) <= tol)
      const p = pt('intersection', x, y, 'intersection', exact)
      if (!p) continue
      p.withId = other.id

      const gapL = i > 0 ? x - xs[i - 1] : hi - lo
      const gapR = i + 1 < xs.length ? xs[i + 1] - x : hi - lo
      if (touchesWithoutCrossing(f, g, x, hi - lo, Math.min(gapL, gapR), scale)) {
        p.tangent = true
      }

      attachExactAt(p, f, meets)
      attachExpForms([p], parent, models[parent.modelId], models[other.modelId] ? { curve: other, spec: models[other.modelId] } : null)
      out.push(p)
    }
    return finish(out)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Intersections in the plane — every pairing that is not two functions of x.
//
// A sketched circle fits the `circle` family, a sketched ellipse the general
// conic `ellipse`, a typed x² + y² = 25 is an implicit expression, and polar
// and parametric curves are neither. Each curve is reduced to one of three
// shapes, and each pair of shapes has the one method that suits it:
//
//   explicit y = f(x)      × implicit G = 0     h(x) = G(x, f(x)), scanned in x
//   parametric/polar P(t)  × implicit G = 0     h(t) = G(P(t)), scanned in t
//   parametric/polar P(t)  × explicit f         h(t) = y(t) − f(x(t)), in t
//   implicit A             × implicit B         A traced by marching squares
//                                               into polylines, G_B's sign
//                                               changes along them, 2D Newton
//                                               on (G_A, G_B)
//   parametric/polar       × parametric/polar   polyline segment crossings,
//                                               2D Newton on (t₁, t₂); two
//                                               polar curves also meet at the
//                                               pole when BOTH reach r = 0,
//                                               at whatever θ each does
//
// A one-variable scan finds sign changes (bisected to the last bit, with a
// pole guard: a "root" where |h| is not small is an asymptote) and touches:
// local minima of |h| refined by golden section, accepted when h comes within
// TOUCH_H of zero on h's own scale — so a parabola tangent to a circle is ONE
// point, flagged tangent. The same minima search along A's polylines finds
// tangencies of two implicit curves.
//
// Every point then has to earn its place in the plane: its geometric distance
// to BOTH curves (|G|/|∇G| for an implicit, the perpendicular offset for an
// explicit, the nearest point of P for a parametric) must be below
// MEET_ACCEPT · max(1, |x|, |y|), and it must lie inside both domains and the
// x-range. Exact forms are proposed for x and y separately and accepted only
// when the candidate point lies on both curves to MEET_CHECK.
// ---------------------------------------------------------------------------

type XYFn = (x: number, y: number) => number
type PFn = (t: number) => Vec2

interface ExplicitGeo { kind: 'explicit'; f: Fn; lo: number; hi: number }
interface ImplicitGeo {
  kind: 'implicit'
  G: XYFn
  /** Exact extent [x0, x1, y0, y1] when the family says so (circle, ellipse). */
  box: [number, number, number, number] | null
}
interface ParamGeo {
  kind: 'param'
  P: PFn
  t0: number
  t1: number
  /** r(θ) for a polar curve, else null. */
  r: Fn | null
}
type Geo = ExplicitGeo | ImplicitGeo | ParamGeo

/** A meeting point before it is a SpecialPoint: where, how, and the t's. */
interface RawMeet {
  x: number
  y: number
  tangent: boolean
  /** Parameter on the parent / the other curve, when that curve is P(t). */
  tA?: number
  tB?: number
}

/** h within this (relative to h's own scale) of zero at a local min: a touch. */
const TOUCH_H = 1e-9
/** Only minima of |h| this small (relative) are worth a golden-section search. */
const TOUCH_TRY = 1e-2
/** Two plane points closer than this (relative to max(1, |x|, |y|)) are one. */
const DEDUPE_XY = 1e-6
/** Cells along the longer side of the grid an implicit curve is traced on. */
const TRACE_CELLS = 96
/** Cells along each side of the coarse grid that locates an implicit curve. */
const PROBE_CELLS = 64
/** Curves meeting at an angle whose sine is below this are touching. */
const TANGENT_SIN = 1e-6
/** |h| below this fraction of its off-curve size, sample after sample: overlap. */
const OVERLAP = 1e-9
/** More meetings than this is two curves lying along each other, not a list. */
const MAX_MEETS = 64

const safe1 = (fn: Fn): Fn => (u: number) => {
  let v: number
  try { v = fn(u) } catch { return Number.NaN }
  return typeof v === 'number' ? v : Number.NaN
}

/** The curve as one of the three plane shapes, or null. */
function geoOf(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  range: readonly [number, number],
): Geo | null {
  const spec = models[curve.modelId]
  if (!spec) return null
  if (!Array.isArray(curve.params) || !curve.params.every(Number.isFinite)) return null
  const params = curve.params

  if (spec.kind === 'explicit' && spec.evalExplicit) {
    const f = explicitFnOf(curve, models)
    const span = sharedSpan(curve.domain ?? null, null, range)
    if (!f || !span) return null
    return { kind: 'explicit', f, lo: span[0], hi: span[1] }
  }

  if (spec.evalImplicit) {
    const ev = spec.evalImplicit
    const G: XYFn = (x, y) => {
      let v: number
      try { v = ev.call(spec, params, x, y) } catch { return Number.NaN }
      return typeof v === 'number' ? v : Number.NaN
    }
    let box: ImplicitGeo['box'] = null
    if (curve.modelId === 'circle') {
      const [a, b, r] = params
      const R = Math.abs(r)
      if (!(R > 0)) return null
      box = [a - R, a + R, b - R, b + R]
    } else if (curve.modelId === 'ellipse') {
      const cf = conicToCenterForm(params)
      if (cf) {
        const c = Math.cos(cf.angle)
        const s = Math.sin(cf.angle)
        const hw = Math.sqrt(cf.rx * cf.rx * c * c + cf.ry * cf.ry * s * s)
        const hh = Math.sqrt(cf.rx * cf.rx * s * s + cf.ry * cf.ry * c * c)
        box = [cf.cx - hw, cf.cx + hw, cf.cy - hh, cf.cy + hh]
      }
    }
    return { kind: 'implicit', G, box }
  }

  if (spec.evalPolar) {
    const ev = spec.evalPolar
    const r = safe1((th: number) => ev.call(spec, params, th))
    const P: PFn = (th) => {
      const rv = r(th)
      return { x: rv * Math.cos(th), y: rv * Math.sin(th) }
    }
    const d = curve.domain
    const t0 = d ? Math.min(d[0], d[1]) : 0
    const t1 = d ? Math.max(d[0], d[1]) : 2 * Math.PI
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || !(t1 > t0)) return null
    return { kind: 'param', P, t0, t1, r }
  }

  if (spec.evalParametric) {
    const ev = spec.evalParametric
    const P: PFn = (t) => {
      let v: Vec2
      try { v = ev.call(spec, params, t) } catch { return { x: Number.NaN, y: Number.NaN } }
      return v && typeof v.x === 'number' && typeof v.y === 'number'
        ? v
        : { x: Number.NaN, y: Number.NaN }
    }
    let t0: number
    let t1: number
    if (curve.domain) {
      t0 = Math.min(curve.domain[0], curve.domain[1])
      t1 = Math.max(curve.domain[0], curve.domain[1])
    } else if (xIsConstant(P)) {
      // x = a drawn as t ↦ (a, t): t IS y, and the renderer runs it across
      // the whole board. The board's height is not known here; the x-range's
      // reach is a generous stand-in for it.
      const R = 2 * Math.max(Math.abs(range[0]), Math.abs(range[1]), Math.abs(range[1] - range[0]))
      t0 = -R
      t1 = R
    } else {
      t0 = 0
      t1 = 2 * Math.PI
    }
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || !(t1 > t0)) return null
    return { kind: 'param', P, t0, t1, r: null }
  }
  return null
}

/** Is x(t) the same at every probe? (the 'vline' shape — renderer's test) */
function xIsConstant(P: PFn): boolean {
  let x0: number | null = null
  for (const t of [0, 0.73, -0.73, 2.19, 4.81]) {
    const p = P(t)
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    if (x0 === null) x0 = p.x
    else if (Math.abs(p.x - x0) > 1e-9 * (1 + Math.abs(x0))) return false
  }
  return x0 !== null
}

/** Samples of a P(t) sweep: enough for a long spiral, never fewer than a turn's. */
function paramSamples(g: ParamGeo): number {
  const turns = (g.t1 - g.t0) / (2 * Math.PI)
  return Math.max(PARAM_SAMPLES, Math.min(4000, Math.ceil(PARAM_SAMPLES * turns)))
}

// ---- one-variable scan ----------------------------------------------------

interface Hit1 { u: number; tangent: boolean }

/** Bisect h = 0 on [a, b] (h(a) = ha, opposite sign at b) to the last bit. */
function bisect1(h: Fn, a: number, b: number, ha: number): number {
  let hb = Number.NaN
  for (let i = 0; i < 200; i++) {
    const m = 0.5 * (a + b)
    if (!(m > a && m < b)) break
    const hm = h(m)
    if (!Number.isFinite(hm)) return Number.NaN
    if (hm === 0) return m
    if (hm > 0 === ha > 0) { a = m; ha = hm } else { b = m; hb = hm }
  }
  if (!Number.isFinite(hb)) hb = h(b)
  return Math.abs(ha) <= Math.abs(hb) ? a : b
}

/**
 * The zeros of h on [a, b]: sign changes bisected, exact zeros taken as they
 * are, and touches — local minima of |h| that golden section drives to within
 * TOUCH_H of zero — flagged tangent. A bracketed "root" at which |h| is not
 * small is a pole, and is refused.
 */
function scan1D(h: Fn, a: number, b: number, n: number, unit?: number): Hit1[] {
  const us = new Float64Array(n + 1)
  const hs = new Float64Array(n + 1)
  const abs: number[] = []
  for (let i = 0; i <= n; i++) {
    const u = a + ((b - a) * i) / n
    us[i] = u
    const v = h(u)
    hs[i] = v
    if (Number.isFinite(v)) abs.push(Math.abs(v))
  }
  if (abs.length === 0) return []
  abs.sort((p, q) => p - q)
  const q75 = abs[Math.min(abs.length - 1, Math.floor(0.75 * abs.length))]
  const scale = q75 > 0 ? q75 : 1
  const hits: Hit1[] = []
  const root = (lo: number, hi: number, hlo: number) => {
    const u = bisect1(h, lo, hi, hlo)
    if (!Number.isFinite(u)) return
    const v = h(u)
    // the pole guard: bisection walks straight into an asymptote too
    if (Number.isFinite(v) && Math.abs(v) <= MEET_ACCEPT * scale) hits.push({ u, tangent: false })
  }
  const same = (p: number, q: number) => p !== 0 && q !== 0 && p > 0 === q > 0

  for (let i = 0; i <= n; i++) {
    const v = hs[i]
    if (!Number.isFinite(v)) continue
    if (v === 0) {
      const l = i > 0 ? hs[i - 1] : Number.NaN
      const r = i < n ? hs[i + 1] : Number.NaN
      hits.push({ u: us[i], tangent: Number.isFinite(l) && Number.isFinite(r) && same(l, r) })
      continue
    }
    if (i < n) {
      const w = hs[i + 1]
      if (Number.isFinite(w) && w !== 0 && v > 0 !== w > 0) root(us[i], us[i + 1], v)
    }
  }

  for (let i = 1; i < n; i++) {
    const p = hs[i - 1]
    const c = hs[i]
    const q = hs[i + 1]
    if (!Number.isFinite(p) || !Number.isFinite(c) || !Number.isFinite(q)) continue
    if (!same(p, c) || !same(c, q)) continue
    const ac = Math.abs(c)
    if (!(ac < Math.abs(p) && ac <= Math.abs(q))) continue
    if (ac > TOUCH_TRY * scale) continue
    const s = c > 0 ? 1 : -1
    const u = goldenMin(x => {
      const v = h(x)
      return Number.isFinite(v) ? s * v : Infinity
    }, us[i - 1], us[i + 1])
    const v = h(u)
    if (!Number.isFinite(v)) continue
    if (v === 0 || s * v > 0) {
      if (Math.abs(v) <= TOUCH_H * scale) hits.push({ u, tangent: true })
    } else {
      // it dipped through zero between two samples: two crossings
      root(us[i - 1], u, p)
      root(u, us[i + 1], v)
    }
  }
  hits.sort((x, y) => x.u - y.u)
  if (!(unit !== undefined && unit > 0) || hits.length === 0) return hits

  // Where the two curves LIE ALONG each other, h is zero to rounding over a
  // whole run of samples and every sign flip of the noise would be reported.
  // `unit` is what h measures one step off the curve; a run of samples this
  // far below it is an overlap, and nothing inside it is a meeting point.
  const flat = OVERLAP * unit
  const runs: [number, number][] = []
  for (let i = 0; i <= n; ) {
    if (!(Math.abs(hs[i]) <= flat)) { i++; continue }
    let j = i
    while (j + 1 <= n && Math.abs(hs[j + 1]) <= flat) j++
    if (j - i >= 2) runs.push([us[Math.max(0, i - 1)], us[Math.min(n, j + 1)]])
    i = j + 1
  }
  if (runs.length === 0) return hits
  return hits.filter(x => !runs.some(([l, r]) => x.u >= l && x.u <= r))
}

// ---- distances, pins, Newton ----------------------------------------------

function grad(G: XYFn, x: number, y: number): [number, number] {
  const hx = H1 * Math.max(1, Math.abs(x))
  const hy = H1 * Math.max(1, Math.abs(y))
  return [
    (G(x + hx, y) - G(x - hx, y)) / (2 * hx),
    (G(x, y + hy) - G(x, y - hy)) / (2 * hy),
  ]
}

function dP(P: PFn, t: number): Vec2 {
  const h = H1 * Math.max(1, Math.abs(t))
  const a = P(t + h)
  const b = P(t - h)
  return { x: (a.x - b.x) / (2 * h), y: (a.y - b.y) / (2 * h) }
}

/** The t of P nearest (x, y), Gauss–Newton from a starting t. */
function nearestT(g: ParamGeo, x: number, y: number, t: number): number {
  for (let k = 0; k < 12; k++) {
    const p = g.P(t)
    const d = dP(g.P, t)
    const den = d.x * d.x + d.y * d.y
    if (!(den > 0) || !Number.isFinite(den)) break
    const dt = -((p.x - x) * d.x + (p.y - y) * d.y) / den
    if (!Number.isFinite(dt)) break
    const nt = Math.min(g.t1, Math.max(g.t0, t + dt))
    const moved = Math.abs(nt - t)
    t = nt
    if (moved <= 1e-15 * Math.max(1, Math.abs(t))) break
  }
  return t
}

/** How far (x, y) is from the curve; Infinity outside its domain. */
function distTo(g: Geo, x: number, y: number, hint?: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return Infinity
  switch (g.kind) {
    case 'explicit': {
      const tol = 1e-12 * Math.max(1, Math.abs(x))
      if (x < g.lo - tol || x > g.hi + tol) return Infinity
      const fx = g.f(x)
      if (!Number.isFinite(fx)) return Infinity
      const s = d1(g.f, x)
      const k = Number.isFinite(s) ? Math.sqrt(1 + s * s) : 1
      return Math.abs(y - fx) / k
    }
    case 'implicit': {
      const v = g.G(x, y)
      if (!Number.isFinite(v)) return Infinity
      if (v === 0) return 0
      const [gx, gy] = grad(g.G, x, y)
      const n = Math.hypot(gx, gy)
      return n > 0 && Number.isFinite(n) ? Math.abs(v) / n : Infinity
    }
    case 'param': {
      const t = nearestT(g, x, y, hint ?? nearestSampleT(g, x, y))
      const p = g.P(t)
      const d = Math.hypot(p.x - x, p.y - y)
      return Number.isFinite(d) ? d : Infinity
    }
  }
}

function nearestSampleT(g: ParamGeo, x: number, y: number): number {
  const n = 256
  let best = g.t0
  let bd = Infinity
  for (let i = 0; i <= n; i++) {
    const t = g.t0 + ((g.t1 - g.t0) * i) / n
    const p = g.P(t)
    const d = Math.hypot(p.x - x, p.y - y)
    if (d < bd) { bd = d; best = t }
  }
  return best
}

/**
 * The y at which the curve passes x = cx, near yHint — or NaN when the curve
 * cannot say (a vertical tangent, a curve that does not reach that x).
 */
function pinY(g: Geo, cx: number, yHint: number, tHint?: number): number {
  switch (g.kind) {
    case 'explicit': {
      const tol = 1e-12 * Math.max(1, Math.abs(cx))
      if (cx < g.lo - tol || cx > g.hi + tol) return Number.NaN
      return g.f(cx)
    }
    case 'implicit': {
      let y = yHint
      for (let k = 0; k < 40; k++) {
        const v = g.G(cx, y)
        if (!Number.isFinite(v)) return Number.NaN
        if (v === 0) return y
        const h = H1 * Math.max(1, Math.abs(y))
        const gy = (g.G(cx, y + h) - g.G(cx, y - h)) / (2 * h)
        if (!(Math.abs(gy) > 0) || !Number.isFinite(gy)) return Number.NaN
        const step = v / gy
        y -= step
        if (Math.abs(step) <= 1e-15 * Math.max(1, Math.abs(y))) break
      }
      return Math.abs(y - yHint) <= 1e-3 * Math.max(1, Math.abs(yHint)) ? y : Number.NaN
    }
    case 'param': {
      let t = tHint ?? nearestSampleT(g, cx, yHint)
      for (let k = 0; k < 40; k++) {
        const p = g.P(t)
        const d = dP(g.P, t)
        if (!Number.isFinite(p.x) || !(Math.abs(d.x) > 0)) return Number.NaN
        const step = (p.x - cx) / d.x
        t = Math.min(g.t1, Math.max(g.t0, t - step))
        if (Math.abs(step) <= 1e-15 * Math.max(1, Math.abs(t))) break
      }
      const p = g.P(t)
      return Math.abs(p.x - cx) <= 1e-12 * Math.max(1, Math.abs(cx)) &&
        Math.abs(p.y - yHint) <= 1e-3 * Math.max(1, Math.abs(yHint))
        ? p.y
        : Number.NaN
    }
  }
}

/** Newton on (G_A, G_B) = 0 from (x, y); null when the Jacobian is singular. */
function newton2(GA: XYFn, GB: XYFn, x: number, y: number): Vec2 | null {
  for (let k = 0; k < 40; k++) {
    const f1 = GA(x, y)
    const f2 = GB(x, y)
    if (!Number.isFinite(f1) || !Number.isFinite(f2)) return null
    if (f1 === 0 && f2 === 0) break
    const [a, b] = grad(GA, x, y)
    const [c, d] = grad(GB, x, y)
    const det = a * d - b * c
    if (!(Math.abs(det) > 1e-12 * Math.hypot(a, b) * Math.hypot(c, d))) return null
    const dx = (-f1 * d + b * f2) / det
    const dy = (-a * f2 + c * f1) / det
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null
    x += dx
    y += dy
    if (Math.hypot(dx, dy) <= 1e-15 * Math.max(1, Math.abs(x), Math.abs(y))) break
  }
  return { x, y }
}

/** Newton on P₁(t₁) − P₂(t₂) = 0; null when the tangents are parallel. */
function newtonTT(A: ParamGeo, B: ParamGeo, t1: number, t2: number): [number, number] | null {
  for (let k = 0; k < 40; k++) {
    const p = A.P(t1)
    const q = B.P(t2)
    const fx = p.x - q.x
    const fy = p.y - q.y
    if (!Number.isFinite(fx) || !Number.isFinite(fy)) return null
    if (fx === 0 && fy === 0) break
    const a = dP(A.P, t1)
    const b = dP(B.P, t2)
    // J = [[a.x, −b.x], [a.y, −b.y]]
    const det = -a.x * b.y + b.x * a.y
    if (!(Math.abs(det) > 1e-12 * Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y))) return null
    const d1v = (-fx * -b.y - -b.x * -fy) / det
    const d2v = (a.x * -fy - a.y * -fx) / det
    if (!Number.isFinite(d1v) || !Number.isFinite(d2v)) return null
    const n1 = Math.min(A.t1, Math.max(A.t0, t1 + d1v))
    const n2 = Math.min(B.t1, Math.max(B.t0, t2 + d2v))
    const moved = Math.abs(n1 - t1) + Math.abs(n2 - t2)
    t1 = n1
    t2 = n2
    if (moved <= 1e-15 * Math.max(1, Math.abs(t1), Math.abs(t2))) break
  }
  return [t1, t2]
}

// ---- the pairings ---------------------------------------------------------

function explicitImplicit(E: ExplicitGeo, I: ImplicitGeo): RawMeet[] {
  const h = (x: number) => {
    const y = E.f(x)
    return Number.isFinite(y) ? I.G(x, y) : Number.NaN
  }
  // what G reads a short step off the explicit curve: the size of "not on it"
  const step = 1e-2 * Math.max(1, E.hi - E.lo)
  const unit = offCurveUnit(k => {
    const x = E.lo + ((E.hi - E.lo) * k) / 16
    const y = E.f(x)
    return Math.max(Math.abs(I.G(x, y + step)), Math.abs(I.G(x + step, y)))
  })
  return scan1D(h, E.lo, E.hi, SAMPLES, unit).map(({ u, tangent }) => ({
    x: u, y: E.f(u), tangent,
  }))
}

/** Median of 17 finite probes of an off-curve magnitude; 0 when none. */
function offCurveUnit(probe: (k: number) => number): number {
  const v: number[] = []
  for (let k = 0; k <= 16; k++) {
    const m = probe(k)
    if (Number.isFinite(m)) v.push(m)
  }
  return v.length > 0 ? median(v) : 0
}

function paramOther(P: ParamGeo, O: ExplicitGeo | ImplicitGeo): { m: RawMeet; t: number }[] {
  const h: Fn = O.kind === 'implicit'
    ? t => {
      const p = P.P(t)
      return O.G(p.x, p.y)
    }
    : t => {
      const p = P.P(t)
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return Number.NaN
      if (p.x < O.lo || p.x > O.hi) return Number.NaN
      return p.y - O.f(p.x)
    }
  const W = O.kind === 'explicit' ? Math.max(1, O.hi - O.lo) : 1
  const unit = offCurveUnit(k => {
    const p = P.P(P.t0 + ((P.t1 - P.t0) * k) / 16)
    if (O.kind === 'explicit') return 1e-2 * W
    const step = 1e-2 * Math.max(1, Math.abs(p.x), Math.abs(p.y))
    return Math.max(Math.abs(O.G(p.x + step, p.y)), Math.abs(O.G(p.x, p.y + step)))
  })
  return scan1D(h, P.t0, P.t1, paramSamples(P), unit).map(({ u, tangent }) => {
    const p = P.P(u)
    return { m: { x: p.x, y: p.y, tangent }, t: u }
  })
}

/** Where G changes sign on a box: its extent, grown by a cell; null if nowhere. */
function probeBox(
  G: XYFn,
  x0: number, x1: number, y0: number, y1: number,
  n: number,
): [number, number, number, number] | null {
  const dx = (x1 - x0) / n
  const dy = (y1 - y0) / n
  const vals = new Float64Array((n + 1) * (n + 1))
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) vals[j * (n + 1) + i] = G(x0 + i * dx, y0 + j * dy)
  }
  let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity
  const mark = (i: number, j: number) => {
    const x = x0 + i * dx
    const y = y0 + j * dy
    if (x < bx0) bx0 = x
    if (x > bx1) bx1 = x
    if (y < by0) by0 = y
    if (y > by1) by1 = y
  }
  const cross = (p: number, q: number) =>
    Number.isFinite(p) && Number.isFinite(q) && p > 0 !== q > 0
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const v = vals[j * (n + 1) + i]
      if (i < n && cross(v, vals[j * (n + 1) + i + 1])) { mark(i, j); mark(i + 1, j) }
      if (j < n && cross(v, vals[(j + 1) * (n + 1) + i])) { mark(i, j); mark(i, j + 1) }
    }
  }
  if (!(bx1 >= bx0)) return null
  return [
    Math.max(x0, bx0 - dx), Math.min(x1, bx1 + dx),
    Math.max(y0, by0 - dy), Math.min(y1, by1 + dy),
  ]
}

/**
 * Marching squares on a box: the zero set of G as polylines (vertices on the
 * grid edges, linearly interpolated), each flagged closed when it loops.
 */
function tracePolylines(
  G: XYFn,
  x0: number, x1: number, y0: number, y1: number,
  nx: number, ny: number,
): { xs: number[]; ys: number[]; closed: boolean }[] {
  const cols = nx + 1
  const dx = (x1 - x0) / nx
  const dy = (y1 - y0) / ny
  const vals = new Float64Array(cols * (ny + 1))
  for (let j = 0; j <= ny; j++) {
    const y = y0 + j * dy
    for (let i = 0; i <= nx; i++) vals[j * cols + i] = G(x0 + i * dx, y)
  }
  const HN = (ny + 1) * nx
  const total = HN + ny * cols
  const px = new Float64Array(total)
  const py = new Float64Array(total)
  const has = new Uint8Array(total)
  const nb1 = new Int32Array(total).fill(-1)
  const nb2 = new Int32Array(total).fill(-1)

  const crossing = (id: number, ax: number, ay: number, va: number, bx: number, by: number, vb: number): boolean => {
    if (has[id]) return true
    if (!Number.isFinite(va) || !Number.isFinite(vb) || va > 0 === vb > 0) return false
    const t = va / (va - vb)
    px[id] = ax + (bx - ax) * t
    py[id] = ay + (by - ay) * t
    has[id] = 1
    return true
  }
  const link = (a: number, b: number) => {
    if (nb1[a] < 0) nb1[a] = b; else nb2[a] = b
    if (nb1[b] < 0) nb1[b] = a; else nb2[b] = a
  }

  for (let j = 0; j < ny; j++) {
    const ya = y0 + j * dy
    const yb = ya + dy
    for (let i = 0; i < nx; i++) {
      const xa = x0 + i * dx
      const xb = xa + dx
      const v00 = vals[j * cols + i]
      const v10 = vals[j * cols + i + 1]
      const v01 = vals[(j + 1) * cols + i]
      const v11 = vals[(j + 1) * cols + i + 1]
      if (!Number.isFinite(v00) || !Number.isFinite(v10) || !Number.isFinite(v01) || !Number.isFinite(v11)) continue
      const bottom = j * nx + i
      const top = (j + 1) * nx + i
      const left = HN + j * cols + i
      const right = HN + j * cols + i + 1
      const e: number[] = []
      if (crossing(bottom, xa, ya, v00, xb, ya, v10)) e.push(bottom)
      if (crossing(right, xb, ya, v10, xb, yb, v11)) e.push(right)
      if (crossing(top, xa, yb, v01, xb, yb, v11)) e.push(top)
      if (crossing(left, xa, ya, v00, xa, yb, v01)) e.push(left)
      if (e.length === 2) {
        link(e[0], e[1])
      } else if (e.length === 4) {
        // a saddle cell: the centre's sign says which corners are joined
        const vc = G(xa + dx / 2, ya + dy / 2)
        if (vc > 0 === v00 > 0) {
          link(bottom, right)   // cut off corner (1, 0)
          link(top, left)       // cut off corner (0, 1)
        } else {
          link(bottom, left)    // cut off corner (0, 0)
          link(top, right)      // cut off corner (1, 1)
        }
      }
    }
  }

  const seen = new Uint8Array(total)
  const lines: { xs: number[]; ys: number[]; closed: boolean }[] = []
  const walk = (start: number) => {
    const xs: number[] = []
    const ys: number[] = []
    let prev = -1
    let cur = start
    let closed = false
    while (cur >= 0 && !seen[cur]) {
      seen[cur] = 1
      xs.push(px[cur])
      ys.push(py[cur])
      const next = nb1[cur] !== prev ? nb1[cur] : nb2[cur]
      prev = cur
      cur = next
      if (cur === start) { closed = true; break }
    }
    if (xs.length >= 2) lines.push({ xs, ys, closed })
  }
  // open chains from their ends first, then the loops
  for (let id = 0; id < total; id++) {
    if (has[id] && !seen[id] && (nb1[id] < 0 || nb2[id] < 0)) walk(id)
  }
  for (let id = 0; id < total; id++) if (has[id] && !seen[id]) walk(id)
  return lines
}

function implicitImplicit(A: ImplicitGeo, B: ImplicitGeo, range: readonly [number, number]): RawMeet[] {
  const lo = Math.min(range[0], range[1])
  const hi = Math.max(range[0], range[1])
  const R = Math.max(Math.abs(lo), Math.abs(hi), hi - lo)
  const extent = (g: ImplicitGeo) =>
    g.box ?? probeBox(g.G, lo, hi, -R, R, PROBE_CELLS)
  const ea = extent(A)
  if (!ea) return []
  const eb = extent(B)
  if (!eb) return []
  const size = Math.max(ea[1] - ea[0], ea[3] - ea[2], eb[1] - eb[0], eb[3] - eb[2])
  const pad = 0.02 * size + 1e-9 * Math.max(1, R)
  const x0 = Math.max(lo, ea[0], eb[0]) - pad
  const x1 = Math.min(hi, ea[1], eb[1]) + pad
  const y0 = Math.max(ea[2], eb[2]) - pad
  const y1 = Math.min(ea[3], eb[3]) + pad
  if (!(x1 > x0) || !(y1 > y0)) return []
  const w = x1 - x0
  const hgt = y1 - y0
  const nx = Math.max(12, Math.round(TRACE_CELLS * Math.min(1, w / hgt)))
  const ny = Math.max(12, Math.round(TRACE_CELLS * Math.min(1, hgt / w)))
  const lines = tracePolylines(A.G, x0, x1, y0, y1, nx, ny)

  // Project a point onto A along ∇G_A — keeps a tangency search on A itself.
  const onA = (x: number, y: number): Vec2 => {
    for (let k = 0; k < 3; k++) {
      const v = A.G(x, y)
      if (!Number.isFinite(v) || v === 0) break
      const [gx, gy] = grad(A.G, x, y)
      const n2 = gx * gx + gy * gy
      if (!(n2 > 0)) break
      x -= (v * gx) / n2
      y -= (v * gy) / n2
    }
    return { x, y }
  }

  const out: RawMeet[] = []
  const cross = (x: number, y: number) => {
    const p = newton2(A.G, B.G, x, y)
    if (!p) return
    // Newton creeps onto a tangency too (linearly, not quadratically): the
    // gradients are parallel there, and that is what makes it a touch.
    const [a, b] = grad(A.G, p.x, p.y)
    const [c, d] = grad(B.G, p.x, p.y)
    const sin = Math.abs(a * d - b * c) / (Math.hypot(a, b) * Math.hypot(c, d))
    out.push({ x: p.x, y: p.y, tangent: sin <= TANGENT_SIN })
  }
  const sameSign = (p: number, q: number) =>
    Number.isFinite(p) && Number.isFinite(q) && p !== 0 && q !== 0 && p > 0 === q > 0
  for (const L of lines) {
    const n = L.xs.length
    if (liesAlong(L, B, onA)) continue
    const gb = L.xs.map((x, k) => B.G(x, L.ys[k]))
    const finite = gb.filter(Number.isFinite).map(Math.abs).sort((p, q) => p - q)
    if (finite.length === 0) continue
    const q75 = finite[Math.min(finite.length - 1, Math.floor(0.75 * finite.length))]
    const scale = q75 > 0 ? q75 : 1
    const segs = L.closed ? n : n - 1
    for (let k = 0; k < segs; k++) {
      const k2 = (k + 1) % n
      const a = gb[k]
      const b = gb[k2]
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue
      if (a === 0) {
        // a vertex ON B: a crossing unless B's sign is the same either side
        const km = k > 0 ? k - 1 : L.closed ? n - 1 : -1
        if (km >= 0 && sameSign(gb[km], b)) {
          out.push({ x: L.xs[k], y: L.ys[k], tangent: true })
        } else {
          cross(L.xs[k], L.ys[k])
        }
        continue
      }
      if (b !== 0 && a > 0 !== b > 0) {
        const t = a / (a - b)
        cross(L.xs[k] + (L.xs[k2] - L.xs[k]) * t, L.ys[k] + (L.ys[k2] - L.ys[k]) * t)
      }
    }
    // touches: a local minimum of |G_B| along A with no sign change around it
    for (let k = 0; k < n; k++) {
      if (!L.closed && (k === 0 || k === n - 1)) continue
      const km = (k - 1 + n) % n
      const kp = (k + 1) % n
      const p = gb[km], c = gb[k], q = gb[kp]
      if (!Number.isFinite(p) || !Number.isFinite(c) || !Number.isFinite(q)) continue
      if (c === 0 || p === 0 || q === 0 || p > 0 !== c > 0 || c > 0 !== q > 0) continue
      const ac = Math.abs(c)
      if (!(ac < Math.abs(p) && ac <= Math.abs(q)) || ac > TOUCH_TRY * scale) continue
      const s = c > 0 ? 1 : -1
      // walk the two chords km → k → kp with s ∈ [0, 2], projected onto A
      const at = (u: number): Vec2 => {
        const [i0, i1, f] = u <= 1 ? [km, k, u] : [k, kp, u - 1]
        return onA(
          L.xs[i0] + (L.xs[i1] - L.xs[i0]) * f,
          L.ys[i0] + (L.ys[i1] - L.ys[i0]) * f,
        )
      }
      const u = goldenMin(v => {
        const pt2 = at(v)
        const g = B.G(pt2.x, pt2.y)
        return Number.isFinite(g) ? s * g : Infinity
      }, 0, 2)
      const m = at(u)
      const gm = B.G(m.x, m.y)
      if (!Number.isFinite(gm)) continue
      if (s * gm < 0) {
        // dipped through between vertices: two crossings, Newton from each side
        const l = at(u / 2)
        const r = at((u + 2) / 2)
        cross(l.x, l.y)
        cross(r.x, r.y)
      } else if (Math.abs(gm) <= TOUCH_H * scale) {
        out.push({ x: m.x, y: m.y, tangent: true })
      }
    }
  }
  return out
}

/**
 * Does B lie along this whole stretch of A? Five vertices, projected onto A,
 * are asked for their distance to B; when most of them are ON B the two
 * curves share this piece, and it has no meeting points to list.
 */
function liesAlong(
  L: { xs: number[]; ys: number[] },
  B: Geo,
  onA: (x: number, y: number) => Vec2,
): boolean {
  const n = L.xs.length
  if (n < 5) return false
  let on = 0
  for (let k = 0; k < 5; k++) {
    const i = Math.floor(((n - 1) * (k + 0.5)) / 5)
    const p = onA(L.xs[i], L.ys[i])
    const Lc = Math.max(1, Math.abs(p.x), Math.abs(p.y))
    if (distTo(B, p.x, p.y) <= MEET_ACCEPT * Lc) on++
  }
  return on >= 3
}

function sweep(g: ParamGeo): { ts: Float64Array; xs: Float64Array; ys: Float64Array } {
  const n = paramSamples(g)
  const ts = new Float64Array(n + 1)
  const xs = new Float64Array(n + 1)
  const ys = new Float64Array(n + 1)
  for (let i = 0; i <= n; i++) {
    const t = g.t0 + ((g.t1 - g.t0) * i) / n
    const p = g.P(t)
    ts[i] = t
    xs[i] = p.x
    ys[i] = p.y
  }
  return { ts, xs, ys }
}

function paramParam(A: ParamGeo, B: ParamGeo): RawMeet[] {
  const a = sweep(A)
  const b = sweep(B)
  const out: RawMeet[] = []

  // bucket B's segments on a grid over B's extent
  let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity
  for (let i = 0; i < b.xs.length; i++) {
    const x = b.xs[i], y = b.ys[i]
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    if (x < bx0) bx0 = x
    if (x > bx1) bx1 = x
    if (y < by0) by0 = y
    if (y > by1) by1 = y
  }
  if (!(bx1 >= bx0) || !(by1 >= by0)) return []
  const G = 64
  const cw = Math.max(bx1 - bx0, by1 - by0, 1e-12) / G
  const cellOf = (x: number, y: number): [number, number] => [
    Math.floor((x - bx0) / cw), Math.floor((y - by0) / cw),
  ]
  const buckets = new Map<number, number[]>()
  const key = (i: number, j: number) => i * 100003 + j
  const segOK = (s: { xs: Float64Array; ys: Float64Array }, k: number) =>
    Number.isFinite(s.xs[k]) && Number.isFinite(s.ys[k]) &&
    Number.isFinite(s.xs[k + 1]) && Number.isFinite(s.ys[k + 1])
  for (let k = 0; k + 1 < b.xs.length; k++) {
    if (!segOK(b, k)) continue
    const [i0, j0] = cellOf(Math.min(b.xs[k], b.xs[k + 1]), Math.min(b.ys[k], b.ys[k + 1]))
    const [i1, j1] = cellOf(Math.max(b.xs[k], b.xs[k + 1]), Math.max(b.ys[k], b.ys[k + 1]))
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const kk = key(i, j)
        const list = buckets.get(kk)
        if (list) list.push(k); else buckets.set(kk, [k])
      }
    }
  }
  const stamp = new Int32Array(b.xs.length).fill(-1)
  for (let k = 0; k + 1 < a.xs.length; k++) {
    if (!segOK(a, k)) continue
    const ax = a.xs[k], ay = a.ys[k]
    const ex = a.xs[k + 1] - ax, ey = a.ys[k + 1] - ay
    const [i0, j0] = cellOf(Math.min(ax, ax + ex), Math.min(ay, ay + ey))
    const [i1, j1] = cellOf(Math.max(ax, ax + ex), Math.max(ay, ay + ey))
    if (i1 < 0 || j1 < 0 || i0 > G || j0 > G) continue
    for (let i = Math.max(0, i0); i <= Math.min(G, i1); i++) {
      for (let j = Math.max(0, j0); j <= Math.min(G, j1); j++) {
        const list = buckets.get(key(i, j))
        if (!list) continue
        for (const m of list) {
          if (stamp[m] === k) continue
          stamp[m] = k
          const cx = b.xs[m], cy = b.ys[m]
          const fx = b.xs[m + 1] - cx, fy = b.ys[m + 1] - cy
          const den = ex * fy - ey * fx
          if (den === 0) continue
          const s = ((cx - ax) * fy - (cy - ay) * fx) / den
          const u = ((cx - ax) * ey - (cy - ay) * ex) / den
          if (s < 0 || s > 1 || u < 0 || u > 1) continue
          const t1 = a.ts[k] + (a.ts[k + 1] - a.ts[k]) * s
          const t2 = b.ts[m] + (b.ts[m + 1] - b.ts[m]) * u
          const tt = newtonTT(A, B, t1, t2)
          if (!tt) continue
          const p = A.P(tt[0])
          const da = dP(A.P, tt[0])
          const db = dP(B.P, tt[1])
          const sin = Math.abs(da.x * db.y - da.y * db.x) /
            (Math.hypot(da.x, da.y) * Math.hypot(db.x, db.y))
          out.push({ x: p.x, y: p.y, tangent: sin <= TANGENT_SIN, tA: tt[0], tB: tt[1] })
          if (out.length > 4 * MAX_MEETS) return out
        }
      }
    }
  }

  // Two polar curves meet at the pole whenever both reach r = 0 — at
  // whatever θ each of them does. Nothing above can see that: the two
  // curves are at the pole at DIFFERENT parameter values.
  if (A.r && B.r) {
    const za = scan1D(A.r, A.t0, A.t1, paramSamples(A))
    const zb = za.length > 0 ? scan1D(B.r, B.t0, B.t1, paramSamples(B)) : []
    if (za.length > 0 && zb.length > 0) {
      out.push({ x: 0, y: 0, tangent: false, tA: za[0].u, tB: zb[0].u })
    }
  }
  return out
}

/**
 * Every meeting of two curves that are not both functions of x, as analysis
 * points on the parent. See the section comment above.
 */
function planeIntersections(
  parent: FittedCurve,
  other: FittedCurve,
  models: Record<string, ModelSpec>,
  range: readonly [number, number],
): SpecialPoint[] {
  try {
    const lo = Math.min(range[0], range[1])
    const hi = Math.max(range[0], range[1])
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return []
    // a curve with itself meets everywhere, which is not a list of points
    if (
      parent.modelId === other.modelId &&
      parent.params.length === other.params.length &&
      parent.params.every((v, i) => v === other.params[i]) &&
      String(parent.domain) === String(other.domain)
    ) return []
    const A = geoOf(parent, models, range)
    const B = geoOf(other, models, range)
    if (!A || !B) return []

    let raw: RawMeet[]
    if (A.kind === 'explicit' && B.kind === 'implicit') {
      raw = explicitImplicit(A, B)
    } else if (A.kind === 'implicit' && B.kind === 'explicit') {
      raw = explicitImplicit(B, A)
    } else if (A.kind === 'implicit' && B.kind === 'implicit') {
      raw = implicitImplicit(A, B, [lo, hi])
    } else if (A.kind === 'param' && B.kind === 'param') {
      raw = paramParam(A, B)
    } else if (A.kind === 'param' && B.kind !== 'param') {
      raw = paramOther(A, B).map(({ m, t }) => ({ ...m, tA: t }))
    } else if (B.kind === 'param' && A.kind !== 'param') {
      raw = paramOther(B, A).map(({ m, t }) => ({ ...m, tB: t }))
    } else {
      return []
    }
    return finishPlane(raw, A, B, other.id, lo, hi)
  } catch {
    return []
  }
}

/** Verify, dedupe, attach exact forms, sort — the plane solver's last step. */
function finishPlane(
  raw: RawMeet[],
  A: Geo,
  B: Geo,
  withId: string,
  lo: number,
  hi: number,
): SpecialPoint[] {
  const W = hi - lo
  const kept: RawMeet[] = []
  for (const m of raw) {
    if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) continue
    if (m.x < lo - 1e-12 * W || m.x > hi + 1e-12 * W) continue
    const L = Math.max(1, Math.abs(m.x), Math.abs(m.y))
    if (distTo(A, m.x, m.y, m.tA) > MEET_ACCEPT * L) continue
    if (distTo(B, m.x, m.y, m.tB) > MEET_ACCEPT * L) continue
    const dup = kept.find(
      q => Math.hypot(q.x - m.x, q.y - m.y) <= DEDUPE_XY * Math.max(1, Math.abs(m.x), Math.abs(m.y)),
    )
    if (dup) {
      // a crossing outranks a touch found at the same place
      if (dup.tangent && !m.tangent) dup.tangent = false
      continue
    }
    kept.push({ ...m })
  }
  if (kept.length > MAX_MEETS) return []

  const out: SpecialPoint[] = []
  for (const m of kept) {
    const p = pt('intersection', m.x, m.y, 'intersection', false, m.tangent)
    if (!p) continue
    p.withId = withId
    attachPlaneExact(p, A, B, m.tA, m.tB)
    out.push(p)
  }
  out.sort((p, q) => p.pos.x - q.pos.x || p.pos.y - q.pos.y)
  return out
}

/**
 * exactX / exactY for a point in the plane, each accepted only when the
 * candidate point lies on BOTH curves to MEET_CHECK — the plane's version of
 * "f − g vanishes at the form". The point is polished onto what is accepted.
 */
function attachPlaneExact(p: SpecialPoint, A: Geo, B: Geo, tA?: number, tB?: number): void {
  const onBoth = (x: number, y: number): boolean => {
    const L = Math.max(1, Math.abs(x), Math.abs(y))
    return distTo(A, x, y, tA) <= MEET_CHECK * L && distTo(B, x, y, tB) <= MEET_CHECK * L
  }
  // The y a candidate x implies: read off whichever curve can say, and of
  // those the one the other curve agrees with best.
  const yAt = (cx: number, yHint: number): number => {
    let best = Number.NaN
    let bestD = Infinity
    for (const [g, t, o, to] of [[A, tA, B, tB], [B, tB, A, tA]] as const) {
      const y = pinY(g, cx, yHint, t)
      if (!Number.isFinite(y)) continue
      const d = distTo(o, cx, y, to)
      if (d < bestD) { bestD = d; best = y }
    }
    return best
  }

  let { x, y } = p.pos
  const fx = verifiedExact(x, c => {
    const cy = yAt(c, y)
    return onBoth(c, Number.isFinite(cy) ? cy : y)
  })
  if (fx) {
    const cy = yAt(fx.value, y)
    x = fx.value
    if (Number.isFinite(cy)) y = cy
    p.exactX = fx.text
  }
  const fy = verifiedExact(y, c => onBoth(x, c))
  if (fy) {
    y = fy.value
    p.exactY = fy.text
  }
  p.pos = { x: x + 0, y: y + 0 }
}

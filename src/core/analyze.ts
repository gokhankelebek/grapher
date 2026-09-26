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
  FittedCurve, ModelSpec, PieceInfo, SpecialPoint, SpecialPointKind, Vec2,
} from './types'
import { conicToCenterForm } from './fit/optimize'
import { findHoles } from './holes'
// The x's of an intersection are the zeros of f − g, and calculus.ts already
// hands that difference back to analyzeCurve as a curve of its own. The import
// is circular by construction — calculus.ts imports analyzeCurve — and safe:
// both sides are hoisted function declarations, used only from inside bodies.
import { curveIntersections } from './calculus'
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
): SpecialPoint[] {
  const out: SpecialPoint[] = []
  const g = scanGrid(f, lo, hi, pieces)
  const { xs, ys, step, scale, zeroTol, breaks, runs, flats, ends } = g
  const n = xs.length - 1

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
        if (Number.isFinite(y) && Math.abs(y) <= zeroTol) {
          const p = pt('zero', xs[i], 0, 'zero', false)
          if (p) out.push(p)
        }
      }
      for (let i = i0; i < i1; i++) {
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
    let v: number
    try { v = f(c) } catch { continue }
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
  for (let k = a; k <= b; k++) fn(k)
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
    const check = checkFor(p.kind, f, der, scales)
    if (!check) continue
    // Polish: the printed decimal becomes the decimal of the printed form.
    attachExactAt(p, f, check)
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
    out.push(...analyzeExplicitNumeric(f, lo, hi, need, piecesOf(curve, spec)))
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
    const q = pt('hole', h.x, h.y, 'hole', false)
    if (q) kept.push(q)
  }
  return attachExactForms(kept, curve, f, lo, hi)
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
  const push = (r: number, t: number) => {
    const p = pt('petal-tip', r * Math.cos(t), r * Math.sin(t), 'petal tip', true)
    if (p) out.push(p)
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
  const refine = (i: number, key: 'x' | 'y', wantMax: boolean): Vec2 => {
    const a = lo + (i - 1) * step
    const b = lo + (i + 1) * step
    const g = (t: number) => {
      const v = evalP.call(spec, curve.params, t)
      const c = key === 'x' ? v.x : v.y
      return Number.isFinite(c) ? (wantMax ? -c : c) : Infinity
    }
    const t = goldenMin(g, a, b)
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
 * Returns [] unless both curves are explicit functions of x. Cheap enough to
 * run per visible pair on every analysis refresh; it memoises nothing.
 */
export function intersectionPoints(
  parent: FittedCurve,
  other: FittedCurve,
  models: Record<string, ModelSpec>,
  range: readonly [number, number],
): SpecialPoint[] {
  try {
    const f = explicitFnOf(parent, models)
    const g = explicitFnOf(other, models)
    if (!f || !g) return []
    const span = sharedSpan(parent.domain ?? null, other.domain ?? null, range)
    if (!span) return []
    const [lo, hi] = span

    const xs = curveIntersections(parent, other, models, [lo, hi])
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
      out.push(p)
    }
    return finish(out)
  } catch {
    return []
  }
}

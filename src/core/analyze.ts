// ============================================================================
// Curve analysis — the features a calculus student is asked to find: where a
// curve crosses, turns, and changes concavity.
//
//   export function analyzeCurve(curve, models): SpecialPoint[]
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
  FittedCurve, ModelSpec, SpecialPoint, SpecialPointKind, Vec2,
} from './types'
import { conicToCenterForm } from './fit/optimize'
import { findHoles } from './holes'

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
  const p: SpecialPoint = { kind, pos: { x, y }, label, exact }
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
 * Split the sampled domain into maximal runs that are finite AND free of a
 * blow-up. Undefined regions (sqrt left of its branch point) and poles both
 * end a run, so no candidate ever straddles one.
 */
function findRuns(xs: number[], ys: number[], scale: number): Run[] {
  const steps: number[] = []
  for (let i = 0; i + 1 < ys.length; i++) {
    if (Number.isFinite(ys[i]) && Number.isFinite(ys[i + 1])) {
      steps.push(Math.abs(ys[i + 1] - ys[i]))
    }
  }
  const medStep = median(steps)
  const runs: Run[] = []
  let start = -1
  for (let i = 0; i < ys.length; i++) {
    const ok = Number.isFinite(ys[i])
    if (ok && start < 0) start = i
    let breakHere = !ok
    if (!breakHere && i + 1 < ys.length && Number.isFinite(ys[i + 1])) {
      const jump = Math.abs(ys[i + 1] - ys[i])
      // a pole: the step dwarfs a typical step AND the values themselves are
      // far outside the curve's usual magnitude
      if (
        medStep > 0 && jump > 100 * medStep &&
        Math.max(Math.abs(ys[i]), Math.abs(ys[i + 1])) > 20 * scale
      ) {
        if (start >= 0) { runs.push({ i0: start, i1: i }); start = -1 }
        continue
      }
    }
    if (breakHere) {
      if (start >= 0 && i - 1 >= start) runs.push({ i0: start, i1: i - 1 })
      start = -1
    } else if (i === ys.length - 1 && start >= 0) {
      runs.push({ i0: start, i1: i })
    }
  }
  void xs
  return runs.filter(r => r.i1 > r.i0)
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
): SpecialPoint[] {
  const out: SpecialPoint[] = []
  const n = SAMPLES
  const xs = new Array<number>(n + 1)
  const ys = new Array<number>(n + 1)
  const step = (hi - lo) / n
  for (let i = 0; i <= n; i++) {
    const x = lo + i * step
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
  const runs = findRuns(xs, ys, scale)

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
        const g: Fn = isMax ? (x => -f(x)) : (x => f(x))
        const xm = goldenMin(g, xs[i - 1], xs[i + 1])
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
        if (sPrevSign !== 0 && sign !== sPrevSign) {
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
  return out
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
    out.push(...analyzeExplicitNumeric(f, lo, hi, need))
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
  return kept
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
    if (q) kept.push(q)
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

    if (spec.evalExplicit) return analyzeExplicit(curve, spec, models)
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

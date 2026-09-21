// ============================================================================
// Holes and asymptotes (src/core/holes.ts)
//
//   export function findHoles(curve, models, range): Hole[]
//   export function findPoles(curve, models, range): number[]
//   export function findAsymptotes(curve, models, range): Asymptote[]
//   export function findEndAsymptotes(curve, models): Asymptote[]
//
// A HOLE is a removable discontinuity: the formula is undefined at x0 but the
// two one-sided limits exist, are finite and agree — (x²−1)/(x−1) at (1, 2),
// sin(x)/x at (0, 1), or an explicit exclusion `{x != 2}` on a curve that is
// fine there. A POLE is where |f| grows without bound on at least one side —
// a vertical asymptote. Candidates come from ModelSpec.singularities (typed
// expressions); library families have none except `recip` (a pole at x = b,
// answered in this file from its own params) and `log` (a pole at x = b,
// answered from the family's own `singularities`).
//
// Classification is by VALUE, never by slope, exactly as the end-cap rule in
// src/render/curves.ts `classifyEdge`: sample f at x0 ± h for h stepping down
// by 10 from 1e-3·scale to 1e-8·scale, where scale = max(1, |x0|).
//
//   * a side CONVERGES when its last three values agree within
//         tol = max(1e-6·|f|, 1e-6·mag, 1e-9·scale)
//     where mag is the median |f| over the range. The mag term is not
//     decoration: a limit of 0 — (x−1)²/(x−1) at x = 1 — has no |f| of its own
//     to be relative to, and 1e-6, 1e-7, 1e-8 would never "agree" without it.
//   * a side ALSO converges when its steps are COLLAPSING — each of the last
//     two at most half the one before it, and the last one already inside tol.
//     x·ln(x) at 0 crawls to its limit (−6.9e-3, −9.2e-4, … , −1.8e-7): the
//     last three values are still 1.4e-5 apart, but the steps are dying by a
//     factor of 8 per rung and there is nowhere else for them to go. The limit
//     is then the last value.
//   * a side DIVERGES when a value is infinite, when |f| passes 1e6·mag, when
//     |f| grows at every rung of the ladder and ends 100× where it began, or —
//     the LOG case — when |f| grows at every rung and its steps refuse to
//     shrink (the last at least half the first) while being bigger than tol.
//     ln(x) at 0 steps down by ln 10 ≈ 2.303 on every rung forever: it never
//     reaches 100× over six rungs, and "the values stopped changing" is the
//     one thing it never does. The `> tol` clause is what keeps the last
//     digits of an honest limit — sec θ read through cos(π/2) ≈ 6.1e-17 —
//     from looking like a staircase.
//   * a side is ABSENT when the formula has no value at all on it: ln(x) and
//     x·ln(x) are simply not there left of 0. An absent side is neither a
//     limit nor a blow-up, and it lets the other side speak alone.
//   * a HOLE needs both sides to converge to the same value (within the same
//     tol), or one side absent and the other converged; its y is the mean of
//     the limits it has.
//   * a POLE needs one diverging side.
//   * ANYTHING ELSE is neither. A jump — |x|/x at 0 — converges on both sides
//     to different values: it is not a hole and it is not an asymptote, and it
//     is reported in neither list.
//
// A point is never both: `classify` returns one verdict, and findHoles and
// findPoles read the same verdict, so the two listings cannot disagree.
//
// `exact` says the x is known, not merely located: true when f is finite there
// (so x0 is an explicit exclusion, which is a written number) or when x0
// round-trips through 12 significant digits, which is how a root bisected and
// then snapped to the simplest number in its own bracket announces that it
// landed on 1, −2 or 0.5 rather than on an approximation to π/2. The y of a
// hole is a limit, so it is never exact.
//
// ---------------------------------------------------------------------------
// POLAR
//
// A polar curve's singularities are in θ: denominators of r(θ), tan/sec/cot/
// csc, the arguments of ln/log, and `{θ != c}` exclusions. They are scanned
// over the curve's own θ window (`curve.domain`, else one turn [0, 2π]) — the
// `range` argument is an x-range and says nothing about θ. Unlike the explicit
// path, a candidate AT an end of that window is still probed from both sides:
// a θ window is a sweep, not a declared stop, and r(θ) is a formula that goes
// on existing outside it. That is what lets r = sin(θ)/θ report its hole and
// r = 1/θ its asymptote, both of which live at θ = 0.
//
//   * a polar HOLE is classified by the VALUE of r on both sides of θ0, by
//     exactly the rule above. Its point is (r0·cos θ0, r0·sin θ0): `Hole.x`
//     and `Hole.y` are a CARTESIAN point for every kind of curve, so a caller
//     never has to ask which.
//   * a polar POLE (|r| → ∞ as θ → θ0) becomes a LINE asymptote when the
//     perpendicular offset settles: d = lim r(θ)·sin(θ − θ0), walked on the
//     same h ladder from both sides with a unit yardstick (d is a distance on
//     the board, and 1 board unit is the thing it is large or small compared
//     to). Both sides must converge and agree within the same tol — or one
//     must be absent — or there is no asymptote. The line is
//         a   = (−d·sin θ0,  d·cos θ0)      the foot of the perpendicular
//         dir = ( cos θ0,    sin θ0)        the direction θ0 itself
//     r = tan θ gives d = −1 at θ = π/2 (x = 1) and d = −1 at θ = 3π/2
//     (x = −1); r = 1/θ gives d = 1 at θ = 0 (y = 1). When d runs away the
//     escape is parabolic and there is no line to draw: r = 2/(1 − cos θ) is
//     a parabola and says so by returning nothing.
//   * r = sec θ IS the line x = 1, and at θ = π/2 it runs to infinity ALONG
//     itself. We still report the line: a graph that coincides with its own
//     asymptote is a true statement about the graph, the dashed line lands
//     exactly under the curve, and suppressing it would need a second,
//     shakier test ("is this line the curve?") to buy nothing.
//   * findPoles stays explicit-only — it returns x values, and a polar
//     asymptote is a slant line that no single x can name. A polar curve's
//     asymptotes come out of findAsymptotes.
//
// Parametric and implicit curves carry no singularities and are left alone.
//
// Pure TypeScript, no DOM. Consumers: analyzeCurve (lists holes as
// SpecialPoints of kind 'hole', explicit and polar alike), the renderer (open
// ring at each hole in every figure style; dashed asymptotes under the marked
// styles).
// ============================================================================

import type { Asymptote, FittedCurve, ModelSpec, Vec2 } from './types'
import { endBehaviour } from './fit/models'

export interface Hole {
  /** CARTESIAN x of the point — for a polar hole, r0·cos θ0 */
  x: number
  /** CARTESIAN y of the point — the two-sided limit, or r0·sin θ0 */
  y: number
  /** true when the point came from an explicit exclusion or a closed-form root */
  exact: boolean
}

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** The h ladder, as a multiple of scale = max(1, |x0|). */
const LADDER = [1e-3, 1e-4, 1e-5, 1e-6, 1e-7, 1e-8]

/** Relative slack on "the last three values agree". */
const CONVERGE_REL = 1e-6

/** Absolute floor on that slack, as a multiple of scale. */
const CONVERGE_ABS = 1e-9

/** |f| this far past the curve's own magnitude is a blow-up. */
const POLE_FACTOR = 1e6

/** A monotonically growing side is a blow-up once it has grown this much. */
const POLE_GROWTH = 100

/**
 * A growing side whose last step is still this fraction of its first has not
 * slowed down at all: that is a logarithm marching off to −∞, not a limit.
 */
const LOG_STEP_KEEP = 0.5

/** A step this much smaller than the one before it is collapsing, not drifting. */
const TAIL_SHRINK = 0.5

/** Samples used to measure the curve's own magnitude over the range. */
const MAG_SAMPLES = 128

/**
 * The yardstick for a polar offset d = lim r·sin(θ − θ0). Unlike f, d has no
 * "own magnitude" to be measured against — it is a distance on the board, and
 * one board unit is what makes it large or small.
 */
const OFFSET_MAG = 1

/** One default turn of θ, when a polar curve declares no window of its own. */
const TWO_PI = 2 * Math.PI

/** Two lines whose normal and offset agree this closely are the same line. */
const LINE_DEDUPE = 1e-7

type Fn = (x: number) => number

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function median(a: number[]): number {
  if (a.length === 0) return 0
  const s = a.slice().sort((p, q) => p - q)
  return s[Math.floor(s.length / 2)]
}

/** The curve's own |f| magnitude over [lo, hi] — the yardstick for "huge". */
function magnitudeOf(f: Fn, lo: number, hi: number): number {
  const vals: number[] = []
  const n = MAG_SAMPLES
  for (let i = 0; i <= n; i++) {
    const v = f(lo + ((hi - lo) * i) / n)
    if (Number.isFinite(v)) vals.push(Math.abs(v))
  }
  const m = median(vals)
  return m > 0 ? m : 1e-12
}

/** True when `x` is a number somebody could have written down. */
const looksWritten = (x: number): boolean => x === Number(x.toPrecision(12))

interface SideVerdict {
  /** the one-sided limit, when the side settled on one */
  limit: number | null
  /** |f| ran away on this side */
  diverges: boolean
  /** the formula has no value at all on this side (ln x, left of 0) */
  absent: boolean
}

/**
 * Walk the h ladder on one side of x0 and say what happened there.
 * `dir` is −1 (from the left) or +1 (from the right).
 */
function probeSide(f: Fn, x0: number, dir: 1 | -1, mag: number, scale: number): SideVerdict {
  const vals: number[] = []
  let infinite = false
  for (const e of LADDER) {
    const v = f(x0 + dir * e * scale)
    if (typeof v !== 'number' || Number.isNaN(v)) continue
    if (!Number.isFinite(v)) { infinite = true; continue }
    vals.push(v)
  }
  if (infinite) return { limit: null, diverges: true, absent: false }
  // Nothing at all on this side: not a limit, not a blow-up. `ln(x)` and
  // `x·ln(x)` are simply not defined left of 0, and the right side decides.
  if (vals.length === 0) return { limit: null, diverges: false, absent: true }
  if (vals.length < 3) return { limit: null, diverges: false, absent: false }

  const abs = vals.map(Math.abs)
  if (Math.max(...abs) > POLE_FACTOR * mag) return { limit: null, diverges: true, absent: false }

  // A pole's values double (1/x) with every halving and never settle; a limit
  // stops moving. The growth factor is what keeps a hole approached from below
  // — 1.999, 1.9999, 1.99999 — out of this.
  let growing = true
  for (let i = 1; i < abs.length; i++) if (!(abs[i] > abs[i - 1])) { growing = false; break }
  if (growing && abs[abs.length - 1] > POLE_GROWTH * Math.max(abs[0], Number.MIN_VALUE)) {
    return { limit: null, diverges: true, absent: false }
  }

  const last = vals.slice(-3)
  const ref = Math.abs(last[2])
  const tol = Math.max(CONVERGE_REL * ref, CONVERGE_REL * mag, CONVERGE_ABS * scale)
  if (Math.abs(last[0] - last[2]) <= tol && Math.abs(last[1] - last[2]) <= tol) {
    return { limit: last[2], diverges: false, absent: false }
  }

  // The values did not settle. Two ways that still has an answer, told apart
  // by what the STEPS between rungs are doing.
  const steps: number[] = []
  for (let i = 1; i < vals.length; i++) steps.push(Math.abs(vals[i] - vals[i - 1]))
  const n = steps.length

  // A logarithm steps by ln 10 ≈ 2.303 every time h is divided by 10 — the
  // step never shrinks, so the side never arrives anywhere. It only reaches
  // ~2.7× over six rungs, which POLE_GROWTH cannot see. The `> tol` clause
  // keeps rounding noise (sec θ near cos(π/2) ≈ 6.1e-17) out of this branch.
  if (growing && n >= 2 && steps[n - 1] > tol && steps[n - 1] >= LOG_STEP_KEEP * steps[0]) {
    return { limit: null, diverges: true, absent: false }
  }

  // The opposite: steps dying geometrically and already inside tol. x·ln(x)
  // crawls to 0 this way, and its last value IS the limit to the precision
  // that is left.
  if (
    n >= 3 &&
    steps[n - 1] <= tol &&
    steps[n - 1] <= TAIL_SHRINK * steps[n - 2] &&
    steps[n - 2] <= TAIL_SHRINK * steps[n - 3]
  ) {
    return { limit: vals[vals.length - 1], diverges: false, absent: false }
  }

  return { limit: null, diverges: false, absent: false }
}

type Verdict = 'hole' | 'pole' | 'neither'

interface Classified {
  verdict: Verdict
  /** the two-sided limit, when the verdict is 'hole' */
  y: number
}

/** Sort one candidate x0 by VALUE — the whole rule, in one place. */
function classify(f: Fn, x0: number, mag: number): Classified {
  const scale = Math.max(1, Math.abs(x0))
  const left = probeSide(f, x0, -1, mag, scale)
  const right = probeSide(f, x0, 1, mag, scale)
  if (left.diverges || right.diverges) return { verdict: 'pole', y: 0 }

  // One side has no formula on it at all: the other side is the whole story.
  // x·ln(x) exists only right of 0 and arrives at 0 — an open point on the
  // graph, which is exactly what a hole is.
  if (left.absent !== right.absent) {
    const only = left.absent ? right.limit : left.limit
    if (only === null || !Number.isFinite(only)) return { verdict: 'neither', y: 0 }
    return { verdict: 'hole', y: only }
  }
  if (left.limit === null || right.limit === null) return { verdict: 'neither', y: 0 }

  const ref = Math.max(Math.abs(left.limit), Math.abs(right.limit))
  const tol = Math.max(CONVERGE_REL * ref, CONVERGE_REL * mag, CONVERGE_ABS * scale)
  if (Math.abs(left.limit - right.limit) > tol) return { verdict: 'neither', y: 0 } // a jump

  const y = 0.5 * (left.limit + right.limit)
  if (!Number.isFinite(y)) return { verdict: 'neither', y: 0 }
  return { verdict: 'hole', y }
}

// ---------------------------------------------------------------------------
// Candidates — explicit
// ---------------------------------------------------------------------------

interface Context {
  f: Fn
  xs: number[]
  mag: number
}

/**
 * The candidate singular x, the evaluator to judge them with, and the
 * curve's magnitude — or null when this curve cannot have either feature.
 *
 * Library families are answered from the family, never by sampling: `recip`
 * has a pole at its shift parameter b and nothing else (handled here, since
 * the family carries no `singularities`), `log` names its own pole at x = b
 * through `singularities`, and no other family in MODELS has a hole or an
 * asymptote at all.
 */
function contextFor(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  range: [number, number],
): Context | null {
  const spec = models[curve.modelId]
  if (!spec || !spec.evalExplicit) return null
  if (!curve.params.every(Number.isFinite)) return null

  let lo = Math.min(range[0], range[1])
  let hi = Math.max(range[0], range[1])
  // A candidate sitting ON a declared domain end is not a hole and not an
  // asymptote of this curve: only one of its two sides is on the graph at all,
  // so there is no two-sided limit to have. `y = (x²−1)/(x−1) {−3 < x < 1}`
  // stops at x = 1, and the open END CAP is what says so — drawing a ring
  // there as well would be the same dot twice.
  let domLo = -Infinity
  let domHi = Infinity
  if (curve.domain) {
    domLo = Math.min(curve.domain[0], curve.domain[1])
    domHi = Math.max(curve.domain[0], curve.domain[1])
    lo = Math.max(lo, domLo)
    hi = Math.min(hi, domHi)
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return null

  const evalF = spec.evalExplicit
  const f: Fn = (x: number) => {
    let v: number
    try { v = evalF.call(spec, curve.params, x) } catch { return Number.NaN }
    return typeof v === 'number' ? v : Number.NaN
  }

  let xs: number[]
  if (spec.singularities) {
    xs = spec.singularities(curve.params, [lo, hi]) ?? []
  } else if (curve.modelId === 'recip') {
    // a/(x − b) + c: the pole is at b, and only when there is an a to blow up
    const [a, b] = curve.params
    xs = Math.abs(a) > 0 ? [b] : []
  } else {
    return null
  }

  const atEnd = (x: number, end: number): boolean =>
    Number.isFinite(end) && Math.abs(x - end) <= 1e-9 * Math.max(1, Math.abs(end))
  xs = xs.filter((x) =>
    Number.isFinite(x) && x >= lo && x <= hi &&
    !atEnd(x, domLo) && !atEnd(x, domHi))
  if (xs.length === 0) return null
  xs.sort((p, q) => p - q)
  return { f, xs, mag: magnitudeOf(f, lo, hi) }
}

// ---------------------------------------------------------------------------
// Candidates — polar
// ---------------------------------------------------------------------------

interface PolarContext {
  r: Fn
  thetas: number[]
  mag: number
}

/**
 * The candidate singular θ of a polar curve, r(θ) to judge them with, and the
 * curve's own |r| magnitude — or null when this is not a polar curve that
 * knows its own singularities.
 *
 * The θ window is the curve's own domain, or one turn. `range` is an x-range
 * and has nothing to say about θ, so it is not consulted. Candidates at the
 * ends of the window are KEPT: see the header.
 */
function polarContextFor(curve: FittedCurve, models: Record<string, ModelSpec>): PolarContext | null {
  const spec = models[curve.modelId]
  if (!spec || !spec.evalPolar || !spec.singularities) return null
  if (!curve.params.every(Number.isFinite)) return null

  const dom = curve.domain ?? [0, TWO_PI]
  const lo = Math.min(dom[0], dom[1])
  const hi = Math.max(dom[0], dom[1])
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return null

  const evalR = spec.evalPolar
  const r: Fn = (t: number) => {
    let v: number
    try { v = evalR.call(spec, curve.params, t) } catch { return Number.NaN }
    return typeof v === 'number' ? v : Number.NaN
  }

  const thetas = (spec.singularities(curve.params, [lo, hi]) ?? [])
    .filter((t) => Number.isFinite(t) && t >= lo && t <= hi)
  if (thetas.length === 0) return null
  thetas.sort((p, q) => p - q)
  return { r, thetas, mag: magnitudeOf(r, lo, hi) }
}

/**
 * d = lim r(θ)·sin(θ − θ0) from both sides, or null when it does not settle.
 * This is the signed distance from the origin to the line the curve runs out
 * along; an infinite or two-valued d means the escape is not along a line.
 */
function polarOffset(r: Fn, th: number): number | null {
  const g: Fn = (t) => r(t) * Math.sin(t - th)
  const scale = Math.max(1, Math.abs(th))
  const left = probeSide(g, th, -1, OFFSET_MAG, scale)
  const right = probeSide(g, th, 1, OFFSET_MAG, scale)
  if (left.diverges || right.diverges) return null
  if (left.absent !== right.absent) {
    const only = left.absent ? right.limit : left.limit
    return only !== null && Number.isFinite(only) ? only : null
  }
  if (left.limit === null || right.limit === null) return null
  const ref = Math.max(Math.abs(left.limit), Math.abs(right.limit))
  const tol = Math.max(CONVERGE_REL * ref, CONVERGE_REL * OFFSET_MAG, CONVERGE_ABS * scale)
  if (Math.abs(left.limit - right.limit) > tol) return null
  const d = 0.5 * (left.limit + right.limit)
  return Number.isFinite(d) ? d : null
}

/** The line in direction θ0 whose signed perpendicular offset is d. */
function lineAt(th: number, d: number): Extract<Asymptote, { kind: 'line' }> {
  const c = Math.cos(th)
  const s = Math.sin(th)
  const a: Vec2 = { x: -d * s, y: d * c }
  return { kind: 'line', a, dir: { x: c, y: s } }
}

/**
 * A key that two spellings of the SAME line share. r = sec θ runs to infinity
 * at θ = π/2 (d = −1) and again at θ = 3π/2 (d = +1); both name x = 1, once in
 * each direction, and the board wants one dashed line, not two.
 */
function lineKey(l: Extract<Asymptote, { kind: 'line' }>): string {
  let nx = -l.dir.y
  let ny = l.dir.x
  let d = nx * l.a.x + ny * l.a.y
  // Orient the normal so that the same line always produces the same key.
  if (d < 0 || (d === 0 && (nx < 0 || (nx === 0 && ny < 0)))) { nx = -nx; ny = -ny; d = -d }
  const q = (v: number) => (Math.round(v / LINE_DEDUPE) * LINE_DEDUPE).toFixed(7)
  return `${q(nx)},${q(ny)},${q(d)}`
}

// ---------------------------------------------------------------------------
// End behaviour — the line a graph leans on as x → ±∞
//
// A HORIZONTAL or SLANT asymptote is the pole's mirror image: the pole asks
// what f does as x walks INTO a point, this asks what it does as x walks out
// of the board and never comes back. So it is read the same way — on a ladder,
// by VALUE, with the same convergence rules — but the ladder GROWS by 10 at
// every rung instead of shrinking by it:
//
//     x_k = s · X₀ · 10^k,  k = 0…6,  s = ±1
//     X₀  = 100 · max(1, |a finite domain edge|, |a parameter|), capped
//
// X₀ is 100 for an ordinary curve, so the last three rungs are 10^6, 10^7 and
// 10^8 — far enough that 3/(x − 1) is 3e-8 and near enough that f itself is
// still carrying ~8 honest digits past its leading one (an f of size 10^8 is
// known to ~1e-8 absolute, and the intercept b is read out of exactly that
// difference). The domain edge is in the max because a curve declared on
// [1000, ∞) has not even started behaving at x = 100; a parameter is in it for
// the same reason, and the cap keeps a wild one from pushing the ladder past
// the precision that makes b readable at all.
//
//   * m_k = f(x_k)/x_k, and m has SETTLED when the last three agree within
//     1e-6·max(1, |m|) — or when the steps between them are collapsing
//     geometrically and the last is already inside it, the same two ways the
//     pole machinery lets a side converge. x² and e^x fail both (m grows);
//     so does sin x + oscillation, whose steps never shrink.
//   * the VALUE of m is not m_6. m_k = m + b/x_k + O(x_k^−2), so m_6 carries
//     an error of b/x_6 — and b is then read as f(x_6) − m·x_6, in which that
//     error is multiplied by x_6 and comes back out as a whole b. The one
//     estimate that kills it is Richardson on the last two rungs, which the
//     ladder's fixed ratio of 10 makes exact:  m = (10·m_6 − m_5)/9. On
//     y = 2x + 2 + 3/(x−1) that returns 2.000000000, and b then converges to
//     2 instead of to the 0 that f(x_6)/x_6 · x_6 would have manufactured.
//   * |m| ≤ 1e-9 is HORIZONTAL, and is reported as m = 0 exactly (dir = (1,0)).
//     Richardson already sends 1/x, atan x and e^{−x} + 2 to ~1e-15 there. So
//     is any |m| no bigger than |m_6 − m_5|, the last rung's own change in the
//     estimate: a bounded oscillation (tan x) leaves a residue of ~|f|/x_6
//     there, and a residue kept as a slope comes back multiplied by x_6 as a
//     fabricated intercept. The cost is that a true slope below ~1e-7 is read
//     as level — and then its b does not settle, so nothing is reported.
//   * b_k = f(x_k) − m·x_k, and the side HAS an asymptote when b settles by
//     the same rule — by AGREEMENT only when the slope is not level, since the
//     Richardson m is the secant through the last two rungs and pins b_5 = b_6
//     on any f at all — within tol = max(1e-6·|b|, 1e-6·mag, 1e-9), where mag is
//     the median |f| over the visible-ish range [−10, 10] ∩ domain — the same
//     `mag` the hole machinery measures, and for the same reason: a b of 0 has
//     no magnitude of its own to be relative to. A |b| inside that tolerance
//     IS zero, so 1/x reports y = 0 rather than y = 1e-8.
//   * a NON-FINITE f at any rung ends that side with no asymptote: √x has
//     nothing to say to the left of its branch point, ln x nothing to the left
//     of 0, and e^x at 10^8 is Infinity, which is not a line.
//   * SLOW DRIFT is caught by b, not by m: ln x and √x send m to 0 honestly,
//     and then b = f keeps growing and never settles. Oscillation is caught
//     the same way — x + sin x has m = 1 exactly and a b that is sin x.
//   * a graph that IS the line is not approaching it. y = 2x + 3 converges to
//     y = 2x + 3, and a dashed rule under a straight graph says nothing; the
//     same verdict the `line` family gets in its own table (src/core/fit/
//     models.ts). One sampled check decides it, over the HALF of the visible
//     range this end looks out from — |x| is the line y = x to the right and
//     y = −x to the left, and each end has to be allowed to say so.
//   * a side whose DOMAIN is finite has no end at all: `{-3 < x < 5}` stops,
//     and what the formula would have done past the stop is not on the graph.
//   * two sides that name the SAME line are reported once (1/x leans on y = 0
//     from both), two that differ are both reported (arctan's ±π/2).
//
// A library family is never sampled: `endBehaviour` in src/core/fit/models.ts
// answers from the parameters, exactly, and its comment carries the table.
// Parametric, implicit and polar curves have no end behaviour in x — a polar
// curve's slant line comes from d = lim r·sin(θ − θ0) above.
// ---------------------------------------------------------------------------

/** Rungs of the outward ladder, k = 0…END_RUNGS. */
const END_RUNGS = 6

/** What the ladder multiplies by at every rung. Richardson reads this too. */
const END_RATIO = 10

/** X₀ = END_BASE · max(1, |domain edge|, |parameter|). */
const END_BASE = 100

/**
 * The ceiling on X₀. Past x ≈ 1e10 an f of any size has fewer honest digits
 * left than the intercept needs, and "no asymptote" beats a fabricated one.
 */
const END_BASE_MAX = 1e4

/** A slope this close to level IS level: the asymptote is horizontal. */
const M_ZERO = 1e-9

/** The visible-ish range `mag` is measured over, before the domain clips it. */
const END_MAG_RANGE: readonly [number, number] = [-10, 10]

/** Samples in the "is the graph already this line?" check. */
const COINCIDE_SAMPLES = 32

/** One end line, y = m·x + b. */
interface EndLine {
  m: number
  b: number
}

/**
 * The limit of a sequence walking OUT to infinity, or null when it never
 * settles — the pole machinery's two convergence rules, read on a growing
 * ladder instead of a shrinking one.
 */
function tailLimit(vals: number[], tol: number, collapsing = true): number | null {
  const n = vals.length
  if (n < 3) return null
  const last = vals.slice(-3)
  if (Math.abs(last[0] - last[2]) <= tol && Math.abs(last[1] - last[2]) <= tol) {
    return last[2]
  }
  if (!collapsing) return null
  // The values did not stop moving. They may still be arriving: steps dying
  // by a factor at every rung, the last already inside tol. c/x reaches its 0
  // this way — 1e-6, 1e-7, 1e-8 never "agree", and there is nowhere else for
  // them to go.
  const steps: number[] = []
  for (let i = 1; i < n; i++) steps.push(Math.abs(vals[i] - vals[i - 1]))
  const s = steps.length
  if (
    s >= 3 &&
    steps[s - 1] <= tol &&
    steps[s - 1] <= TAIL_SHRINK * steps[s - 2] &&
    steps[s - 2] <= TAIL_SHRINK * steps[s - 3]
  ) {
    return vals[n - 1]
  }
  return null
}

/** Walk one side out to infinity and say what line it leans on, if any. */
function endSide(f: Fn, side: 1 | -1, x0: number, mag: number): EndLine | null {
  const xs: number[] = []
  const fs: number[] = []
  let x = side * x0
  for (let k = 0; k <= END_RUNGS; k++) {
    const v = f(x)
    // Infinity is not a line, and NaN is a domain edge reached (√x to the
    // left, ln of a negative). Either way this side has no asymptote.
    if (typeof v !== 'number' || !Number.isFinite(v)) return null
    xs.push(x)
    fs.push(v)
    x *= END_RATIO
  }

  const n = fs.length
  const ms = fs.map((v, i) => v / xs[i])
  const mTol = CONVERGE_REL * Math.max(1, Math.abs(ms[n - 1]))
  if (tailLimit(ms, mTol) === null) return null

  // Richardson on the last two rungs: m_k = m + b/x_k + O(x_k^−2), and the
  // ladder's ratio is exactly 10, so (10·m_6 − m_5)/9 cancels the b/x term
  // that the intercept would otherwise inherit multiplied by x.
  let m = (END_RATIO * ms[n - 1] - ms[n - 2]) / (END_RATIO - 1)
  if (!Number.isFinite(m)) return null
  // A slope smaller than the last rung's own change in it is not a slope, it
  // is what is left of the estimate. tan x hands back m_k = tan(x_k)/x_k,
  // which is ~1e-8 of nothing in particular at x = 1e8; kept, that residue
  // becomes an m·x term of size 2 at the far end and can be mistaken for an
  // intercept. Level is the honest reading, and then b = tan x is asked to
  // settle and does not.
  if (Math.abs(m) <= Math.max(M_ZERO, Math.abs(ms[n - 1] - ms[n - 2]))) m = 0

  const bs = fs.map((v, i) => v - m * xs[i])
  const bTol = Math.max(
    CONVERGE_REL * Math.abs(bs[n - 1]),
    CONVERGE_REL * mag,
    CONVERGE_ABS,
  )
  // The b sequence is only honest when m is level. For a slant, m is the
  // SECANT SLOPE through the last two rungs — (10·m_6 − m_5)/9 is exactly
  // (f_6 − f_5)/(x_6 − x_5) — so both of those points lie on the candidate
  // line and b_5 = b_6 identically, whatever f is. The last step is then 0 by
  // construction and says nothing, which is enough to let a collapsing-steps
  // reading pass anything (tan x arrives at a "limit" of −0.2302 that way).
  // What DOES test the line is an earlier rung: b_4 is f(10^6) measured
  // against it, and "the last three agree" is exactly that question.
  let b = tailLimit(bs, bTol, m === 0)
  if (b === null || !Number.isFinite(b)) return null
  if (Math.abs(b) <= bTol) b = 0
  return { m, b }
}

/**
 * The graph IS this line, over the part of the visible range that this END
 * looks out from.
 *
 * y = 2x + 3 leans on y = 2x + 3, and a dashed rule drawn under a straight
 * graph states nothing about it. This is the one test that tells "approaches"
 * from "equals", and it is not a shaky one: it asks whether every sample of f
 * already sits on the line, to the same tolerance the intercept was read at.
 *
 * The window is ONE SIDE, not the whole board, because the functions this is
 * for are the ones that are a line on one side and something else on the
 * other: |x| is x to the right and −x to the left, |x|/x is +1 and −1. Judged
 * over both halves at once neither end would ever look like its own line, and
 * a board would rule a dashed y = x under the right arm of a V.
 */
function isTheLine(f: Fn, m: number, b: number, lo: number, hi: number, mag: number): boolean {
  let seen = 0
  for (let i = 0; i <= COINCIDE_SAMPLES; i++) {
    const x = lo + ((hi - lo) * i) / COINCIDE_SAMPLES
    const v = f(x)
    if (!Number.isFinite(v)) continue
    seen++
    const want = m * x + b
    const tol = Math.max(CONVERGE_REL * Math.abs(want), CONVERGE_REL * mag, CONVERGE_ABS)
    if (Math.abs(v - want) > tol) return false
  }
  return seen > 0
}

/** Two end lines that name the same line — 1/x leans on y = 0 from both sides. */
function sameEndLine(a: EndLine, b: EndLine): boolean {
  const mTol = CONVERGE_REL * Math.max(1, Math.abs(a.m), Math.abs(b.m))
  const bTol = CONVERGE_REL * Math.max(1, Math.abs(a.b), Math.abs(b.b))
  return Math.abs(a.m - b.m) <= mTol && Math.abs(a.b - b.b) <= bTol
}

/** X₀: far enough out that the curve's own shifts are behind it. */
function endBase(curve: FittedCurve, domLo: number, domHi: number): number {
  let s = 1
  if (Number.isFinite(domLo)) s = Math.max(s, Math.abs(domLo))
  if (Number.isFinite(domHi)) s = Math.max(s, Math.abs(domHi))
  for (const p of curve.params) if (Number.isFinite(p)) s = Math.max(s, Math.abs(p))
  return Math.min(END_BASE_MAX, END_BASE * s)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function findHoles(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  range: [number, number],
): Hole[] {
  try {
    const polar = polarContextFor(curve, models)
    if (polar) {
      const out: Hole[] = []
      for (const th of polar.thetas) {
        const c = classify(polar.r, th, polar.mag)
        if (c.verdict !== 'hole') continue
        const x = c.y * Math.cos(th)
        const y = c.y * Math.sin(th)
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        // r finite AT θ0 means the formula never broke there: θ0 was written
        // down as an exclusion, so it is known rather than located.
        const exact = Number.isFinite(polar.r(th)) || looksWritten(th)
        out.push({ x, y, exact })
      }
      return out
    }

    const ctx = contextFor(curve, models, range)
    if (!ctx) return []
    const out: Hole[] = []
    for (const x of ctx.xs) {
      const c = classify(ctx.f, x, ctx.mag)
      if (c.verdict !== 'hole') continue
      if (!Number.isFinite(x) || !Number.isFinite(c.y)) continue
      // f finite AT the point means the formula never broke there: the x was
      // written down as an exclusion, so it is known rather than located.
      const exact = Number.isFinite(ctx.f(x)) || looksWritten(x)
      out.push({ x, y: c.y, exact })
    }
    return out
  } catch {
    return []
  }
}

/**
 * The x of every vertical asymptote. Explicit curves only: a polar curve's
 * asymptote is a slant line that no single x can name, and findAsymptotes is
 * where it comes out.
 */
export function findPoles(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  range: [number, number],
): number[] {
  try {
    const ctx = contextFor(curve, models, range)
    if (!ctx) return []
    const out: number[] = []
    for (const x of ctx.xs) {
      if (!Number.isFinite(x)) continue
      // The `recip` family's pole is known from its params — no sampling, and
      // no chance of a flat a ≈ 0 branch talking it out of one.
      if (curve.modelId === 'recip' && !models[curve.modelId]?.singularities) {
        out.push(x)
        continue
      }
      if (classify(ctx.f, x, ctx.mag).verdict === 'pole') out.push(x)
    }
    return out
  } catch {
    return []
  }
}

/**
 * The HORIZONTAL and SLANT asymptotes of an explicit curve — the lines its two
 * ends lean on as x → ±∞. Parametric, implicit and polar curves have none: a
 * polar curve's slant line is a different fact, read off d = lim r·sin(θ − θ0)
 * in findAsymptotes below.
 *
 * No `range`: an end asymptote is a statement about infinity, not about the
 * board, and the same line is true wherever the viewport happens to be. The
 * ranges that DO appear — the ladder's X₀ and the visible-ish [−10, 10] that
 * `mag` is measured over — come from the curve and from the rule, not from a
 * caller, so a curve cannot gain or lose an asymptote by being panned.
 *
 * A library family answers from its parameters (the table in src/core/fit/
 * models.ts); anything else — a typed expression — is walked out on the ladder
 * described above. Each line comes back as { kind: 'line', a: (0, b),
 * dir: unit(1, m) }, which is (1, 0) exactly for a horizontal one.
 */
export function findEndAsymptotes(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
): Asymptote[] {
  try {
    const spec = models[curve.modelId]
    if (!spec || spec.kind !== 'explicit' || !spec.evalExplicit) return []
    if (!curve.params.every(Number.isFinite)) return []

    // A declared END is a stop: the graph does not go on past it, so there is
    // nothing out there to approach. Only an open side has an end behaviour.
    let domLo = -Infinity
    let domHi = Infinity
    if (curve.domain) {
      domLo = Math.min(curve.domain[0], curve.domain[1])
      domHi = Math.max(curve.domain[0], curve.domain[1])
    }
    const openLeft = !Number.isFinite(domLo)
    const openRight = !Number.isFinite(domHi)
    if (!openLeft && !openRight) return []

    const found: EndLine[] = []
    const family = endBehaviour(curve.modelId, curve.params)
    if (family) {
      if (openLeft && family.left) found.push(family.left)
      if (openRight && family.right) found.push(family.right)
    } else {
      const evalF = spec.evalExplicit
      const f: Fn = (x: number) => {
        let v: number
        try { v = evalF.call(spec, curve.params, x) } catch { return Number.NaN }
        return typeof v === 'number' ? v : Number.NaN
      }
      // The yardstick for "b has stopped moving", and the window the
      // coincidence check reads: what a reader can see, clipped to the domain.
      let lo = Math.max(END_MAG_RANGE[0], domLo)
      let hi = Math.min(END_MAG_RANGE[1], domHi)
      if (!(hi > lo)) { lo = END_MAG_RANGE[0]; hi = END_MAG_RANGE[1] }
      const mag = magnitudeOf(f, lo, hi)
      const x0 = endBase(curve, domLo, domHi)
      for (const side of [-1, 1] as const) {
        if (side < 0 ? !openLeft : !openRight) continue
        const line = endSide(f, side, x0, mag)
        if (!line) continue
        // The half of the window this end looks out from — the whole of it
        // when the graph is only ever on one side of the axis anyway.
        let clo = side < 0 ? lo : Math.max(lo, 0)
        let chi = side < 0 ? Math.min(hi, 0) : hi
        if (!(chi > clo)) { clo = lo; chi = hi }
        if (isTheLine(f, line.m, line.b, clo, chi, mag)) continue
        found.push(line)
      }
    }

    const out: Asymptote[] = []
    const kept: EndLine[] = []
    for (const l of found) {
      if (!Number.isFinite(l.m) || !Number.isFinite(l.b)) continue
      if (kept.some((k) => sameEndLine(k, l))) continue
      kept.push(l)
      const len = Math.hypot(1, l.m)
      out.push({ kind: 'line', a: { x: 0, y: l.b }, dir: { x: 1 / len, y: l.m / len } })
    }
    return out
  } catch {
    return []
  }
}

/**
 * Every asymptote of the curve: the vertical ones from findPoles(), the lines
 * the two ends lean on as x → ±∞, and the slant lines a polar curve runs out
 * along.
 *
 * Vertical first, then the ends — the order a reader names them in, and the
 * order the renderer has always put its dashes down in.
 */
export function findAsymptotes(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  range: [number, number],
): Asymptote[] {
  try {
    const polar = polarContextFor(curve, models)
    if (polar) {
      const out: Asymptote[] = []
      const seen = new Set<string>()
      for (const th of polar.thetas) {
        if (classify(polar.r, th, polar.mag).verdict !== 'pole') continue
        const d = polarOffset(polar.r, th)
        if (d === null) continue // a parabolic escape: no line to draw
        const line = lineAt(th, d)
        if (!Number.isFinite(line.a.x) || !Number.isFinite(line.a.y)) continue
        const key = lineKey(line)
        if (seen.has(key)) continue
        seen.add(key)
        out.push(line)
      }
      return out
    }
    const out: Asymptote[] = findPoles(curve, models, range)
      .map((x) => ({ kind: 'vertical', x }) as Asymptote)
    out.push(...findEndAsymptotes(curve, models))
    return out
  } catch {
    return []
  }
}

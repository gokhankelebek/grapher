// ============================================================================
// Holes and vertical asymptotes (src/core/holes.ts)
//
//   export function findHoles(curve, models, range): Hole[]
//   export function findPoles(curve, models, range): number[]
//
// A HOLE is a removable discontinuity: the formula is undefined at x0 but the
// two one-sided limits exist, are finite and agree — (x²−1)/(x−1) at (1, 2),
// sin(x)/x at (0, 1), or an explicit exclusion `{x != 2}` on a curve that is
// fine there. A POLE is where |f| grows without bound on at least one side —
// a vertical asymptote. Candidates come from ModelSpec.singularities (typed
// expressions); library families have none except `recip` (a pole at x = b)
// and are answered from the family, not by sampling.
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
//   * a side DIVERGES when a value is infinite, when |f| passes 1e6·mag, or
//     when |f| grows at every rung of the ladder and ends 100× where it began.
//   * a HOLE needs both sides to converge to the same value (within the same
//     tol); its y is the mean of the two limits.
//   * a POLE needs one diverging side.
//   * ANYTHING ELSE is neither. A jump — |x|/x at 0 — converges on both sides
//     to different values: it is not a hole and it is not an asymptote, and it
//     is reported in neither list.
//
// `exact` says the x is known, not merely located: true when f is finite there
// (so x0 is an explicit exclusion, which is a written number) or when x0
// round-trips through 12 significant digits, which is how a root bisected and
// then snapped to the simplest number in its own bracket announces that it
// landed on 1, −2 or 0.5 rather than on an approximation to π/2. The y of a
// hole is a limit, so it is never exact.
//
// Pure TypeScript, no DOM. Consumers: analyzeCurve (lists holes as
// SpecialPoints of kind 'hole'), the renderer (open ring at each hole in
// every figure style; dashed asymptotes under the marked styles).
// ============================================================================

import type { Asymptote, FittedCurve, ModelSpec } from './types'

export interface Hole {
  x: number
  /** the two-sided limit */
  y: number
  /** true when x came from an explicit exclusion or a closed-form root */
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

/** Samples used to measure the curve's own magnitude over the range. */
const MAG_SAMPLES = 128

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
  if (infinite) return { limit: null, diverges: true }
  if (vals.length < 3) return { limit: null, diverges: false }

  const abs = vals.map(Math.abs)
  if (Math.max(...abs) > POLE_FACTOR * mag) return { limit: null, diverges: true }

  // A pole's values double (1/x) or step by a constant (ln x) with every
  // halving and never settle; a limit stops moving. The growth factor is what
  // keeps a hole approached from below — 1.999, 1.9999, 1.99999 — out of this.
  let growing = true
  for (let i = 1; i < abs.length; i++) if (!(abs[i] > abs[i - 1])) { growing = false; break }
  if (growing && abs[abs.length - 1] > POLE_GROWTH * Math.max(abs[0], Number.MIN_VALUE)) {
    return { limit: null, diverges: true }
  }

  const last = vals.slice(-3)
  const ref = Math.abs(last[2])
  const tol = Math.max(CONVERGE_REL * ref, CONVERGE_REL * mag, CONVERGE_ABS * scale)
  if (Math.abs(last[0] - last[2]) > tol || Math.abs(last[1] - last[2]) > tol) {
    return { limit: null, diverges: false }
  }
  return { limit: last[2], diverges: false }
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
  if (left.limit === null || right.limit === null) return { verdict: 'neither', y: 0 }

  const ref = Math.max(Math.abs(left.limit), Math.abs(right.limit))
  const tol = Math.max(CONVERGE_REL * ref, CONVERGE_REL * mag, CONVERGE_ABS * scale)
  if (Math.abs(left.limit - right.limit) > tol) return { verdict: 'neither', y: 0 } // a jump

  const y = 0.5 * (left.limit + right.limit)
  if (!Number.isFinite(y)) return { verdict: 'neither', y: 0 }
  return { verdict: 'hole', y }
}

// ---------------------------------------------------------------------------
// Candidates
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
 * has a pole at its shift parameter b and nothing else, and no other family
 * in MODELS has a hole or an asymptote at all.
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
// Public API
// ---------------------------------------------------------------------------

export function findHoles(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  range: [number, number],
): Hole[] {
  try {
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
 * Every asymptote of the curve on `range`: the vertical ones from
 * findPoles(), plus (core wave) the slant lines a polar curve approaches.
 */
export function findAsymptotes(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  range: [number, number],
): Asymptote[] {
  return findPoles(curve, models, range).map((x) => ({ kind: 'vertical', x }))
}

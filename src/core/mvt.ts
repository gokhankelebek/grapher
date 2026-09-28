// ============================================================================
// src/core/mvt.ts — the average rate of change, the Mean Value Theorem, Rolle's
// theorem and the average value of a function, over [a, b].
//
//   secantOf(src, a, b)              f(a), f(b), the slope [f(b) − f(a)]/(b − a)
//   continuityOn(src, a, b)          where f fails to be continuous on [a, b]:
//                                    outside the domain, undefined, a pole, a
//                                    jump, a hole (removable) — leftmost first
//   differentiabilityOn(src, a, b)   where f fails to be differentiable on
//                                    (a, b): a corner (|x| at 0), a cusp
//                                    (x^(2/3)), a vertical tangent (x^(1/3))
//   mvtPoints(src, a, b, m)          every c in (a, b) with f′(c) = m
//   averageValue(src, a, b)          f_avg = (1/(b − a))∫ₐᵇ f, and every c in
//                                    [a, b] with f(c) = f_avg
//   mvtSourceOf(curve, models)       the source for a board curve
//
// THE SOURCE. Everything here reads f through a small object (MvtSource), not
// a curve, so the tests can hand it x³ or |x| written out, and the board can
// hand it any curve: a typed line (its jets give f′ to rounding, its exact
// evaluator says sin π is 0 and not 1.2e-16), a library family (tangentAt's
// symbolic slopes), a polynomial (Horner, exactly).
//
// THE HYPOTHESES are checked numerically, the way analyze.ts finds a jump:
// the candidates are the formula's own singularities and piece ends, holes
// and poles from holes.ts, and whatever a fine scan finds suspicious (a NaN,
// a step that does not shrink under bisection, a chord slope that spikes, a
// chord slope that turns abruptly). Every candidate is then classified from
// its one-sided limits and one-sided derivatives, so a steep but smooth
// stretch is never reported as a corner: a corner is a place where the two
// one-sided derivatives converge to DIFFERENT numbers.
//
// EXACT FORMS. A c found by bisection is only good to a few ulps of f′, so it
// is snapped with verifiedExact and the curve itself is the judge: the form is
// kept only when f′(form) = m to 1e-9. x³ on [−2, 2] gives c = ±2√3/3; x² on
// [0, 3] averages 3 at c = √3.
//
// Pure: no DOM, no React.
// ============================================================================

import type { FittedCurve, ModelSpec } from './types'
import type { ExactForm } from './exact'
import { exactForm, verifiedExact } from './exact'
import { areaUnder, polynomialOf, tangentAt } from './calculus'
import { findHoles, findPoles } from './holes'

// ---------------------------------------------------------------------------
// The source
// ---------------------------------------------------------------------------

/** How the theorems read a function. */
export interface MvtSource {
  /** f(x) as drawn: NaN outside the domain and wherever f is undefined. */
  f(x: number): number
  /** f′(x); NaN where f is not differentiable or the slope is unknown. */
  d(x: number): number
  /** The drawn domain, or null for all of ℝ. */
  domain: [number, number] | null
  /** Ascending coefficients, when f is a polynomial (then everything is exact). */
  poly?: number[] | null
  /** f at a NICE x in exact arithmetic (sin π = 0); undefined when it cannot say. */
  exactAt?(x: number): number | undefined
  /** Where the formula is undefined, within the range (poles, excluded points). */
  singularities?(range: [number, number]): number[]
  /** Vertical asymptotes, within the range. */
  poles?(range: [number, number]): number[]
  /** Removable holes, within the range. */
  holes?(range: [number, number]): number[]
  /** Piece boundaries of a piecewise definition. */
  pieceEnds?: number[]
  /** ∫ₐᵇ f, and whether it came from a closed form. Null: it does not exist. */
  integral?(a: number, b: number): { value: number; exact: boolean } | null
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface Secant {
  a: number
  b: number
  fa: number
  fb: number
  /** [f(b) − f(a)]/(b − a) — exactly 0 when f(a) = f(b) (Rolle). */
  m: number
  /** f(a) = f(b): Rolle's theorem is the case in hand. */
  rolle: boolean
}

export type ContinuityKind = 'domain' | 'undefined' | 'pole' | 'jump' | 'hole' | 'removable'

export interface ContinuityFailure {
  kind: ContinuityKind
  /** where — for 'undefined' over a stretch, where the stretch starts */
  x: number
  /** 'undefined' over a stretch: where it ends */
  to?: number
  exact: ExactForm | null
}

export type SmoothnessKind = 'corner' | 'cusp' | 'vertical'

export interface SmoothnessFailure {
  kind: SmoothnessKind
  x: number
  exact: ExactForm | null
  /** the two one-sided derivatives, when finite (a corner) */
  left?: number
  right?: number
}

export interface Solution {
  x: number
  exact: ExactForm | null
  /**
   * Set when the equation holds on a whole STRETCH [x, to] rather than at a
   * point — a flat step of floor(x) at its own average, a linear piece whose
   * slope is the secant's.
   */
  to?: number
  toExact?: ExactForm | null
}

export interface MvtPoints {
  /** f′ = m everywhere on (a, b): f is linear there, and every c works. */
  all: boolean
  points: Solution[]
}

export interface AverageValue {
  value: number
  /** the integral came from a closed form (or a polynomial) */
  exact: boolean
  /** f_avg as a closed form, when it is one */
  form: ExactForm | null
  integral: number
  points: Solution[]
}

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Samples across [a, b] for the hypothesis scans. */
const SCAN_N = 1200
/** Samples across (a, b) for the root scans. */
const ROOT_N = 800
/** A chord-slope turn this many times its neighbours' is probed as a corner. */
const CORNER_GATE = 8
/** A chord slope peaking this many times the chords two away is probed as a cusp. */
const SPIKE_GATE = 3
/** At most this many candidates of each scan are classified. */
const MAX_PROBES = 64
/** Relative tolerance for "these two one-sided derivatives differ". */
const CORNER_REL = 1e-4
/** The check an exact c has to pass: |f′(c) − m| or |f(c) − f_avg| below this (relative). */
const EXACT_CHECK = 1e-9
/** A root of f′ − m is accepted when |f′(c) − m| is below this (relative). */
const ROOT_ACCEPT = 1e-6

const clampSpan = (lo: number, hi: number): number => Math.max(1e-300, hi - lo)
const scaleOf = (x: number): number => Math.max(1, Math.abs(x))

function safe(fn: (x: number) => number, x: number): number {
  try {
    const v = fn(x)
    return typeof v === 'number' ? v : Number.NaN
  } catch {
    return Number.NaN
  }
}

/** f at x, exactly when the source can say so. */
function valueAt(src: MvtSource, x: number): number {
  if (src.exactAt) {
    try {
      const e = src.exactAt(x)
      if (typeof e === 'number') return e
    } catch {
      /* fall through */
    }
  }
  return safe(src.f, x)
}

function inDomain(src: MvtSource, x: number): boolean {
  const d = src.domain
  if (!d) return true
  const lo = Math.min(d[0], d[1])
  const hi = Math.max(d[0], d[1])
  const tol = 1e-9 * Math.max(1, Math.abs(lo), Math.abs(hi))
  return x >= lo - tol && x <= hi + tol
}

/** A location found to double precision, as a closed form when it IS one. */
function snapExact(x: number, tol = 1e-10): ExactForm | null {
  if (x === 0) return { text: '0', tex: '0', value: 0 }
  const form = exactForm(x, { tol })
  return form
}

/** The snapped value, when it is within `reach` of x, else x. */
function snapped(x: number, reach: number): { x: number; exact: ExactForm | null } {
  const form = exactForm(x, { tol: 1e-9 })
  if (form && Math.abs(form.value - x) <= reach) return { x: form.value + 0, exact: form }
  if (Math.abs(x) <= reach) return { x: 0, exact: { text: '0', tex: '0', value: 0 } }
  return { x, exact: snapExact(x) }
}

// ---------------------------------------------------------------------------
// The secant
// ---------------------------------------------------------------------------

/** f(a), f(b) and the slope between them. Null when either end is undefined. */
export function secantOf(src: MvtSource, a: number, b: number): Secant | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return null
  if (!inDomain(src, a) || !inDomain(src, b)) return null
  const fa = valueAt(src, a)
  const fb = valueAt(src, b)
  if (!Number.isFinite(fa) || !Number.isFinite(fb)) return null
  const rolle = Math.abs(fb - fa) <= 1e-12 * Math.max(1, Math.abs(fa), Math.abs(fb))
  const m = rolle ? 0 : (fb - fa) / (b - a)
  if (!Number.isFinite(m)) return null
  return { a, b, fa, fb: rolle ? fa : fb, m, rolle }
}

// ---------------------------------------------------------------------------
// One-sided behaviour
// ---------------------------------------------------------------------------

const LADDER = [1e-3, 1e-4, 1e-5, 1e-6, 1e-7, 1e-8]

/**
 * lim f(x) as x → c from one side: a number, ±Infinity when it runs away, or
 * null when f is undefined on that side.
 */
export function sideLimit(f: (x: number) => number, c: number, dir: 1 | -1): number | null {
  const s = scaleOf(c)
  const vs = LADDER.map((h) => safe(f, c + dir * h * s))
  const tail = vs.slice(2)
  if (tail.some((v) => Number.isNaN(v))) return null
  const inf = tail.find((v) => !Number.isFinite(v))
  if (inf !== undefined) return inf > 0 ? Infinity : -Infinity
  const d1 = Math.abs(vs[4] - vs[3])
  const d2 = Math.abs(vs[5] - vs[4])
  if (d2 > 0.5 * d1 && d2 > 1e-6 * Math.max(1, Math.abs(vs[5]))) {
    return vs[5] > 0 ? Infinity : -Infinity
  }
  // The nearest sample, 1e-8 away: comparisons against it use 1e-6.
  return vs[5]
}

/**
 * Does f(x) approach `ref` as x → c from one side? Judged by the gap SHRINKING
 * over four decades of h rather than by its size at the smallest h: ∛x is
 * still 0.002 away from 0 at h = 1e-8, and is continuous; a jump's gap does
 * not shrink at all.
 */
export function approaches(f: (x: number) => number, c: number, dir: 1 | -1, ref: number): boolean {
  const s = scaleOf(c)
  const e4 = Math.abs(safe(f, c + dir * 1e-4 * s) - ref)
  const e8 = Math.abs(safe(f, c + dir * 1e-8 * s) - ref)
  if (!Number.isFinite(e4) || !Number.isFinite(e8)) return false
  return e8 <= 1e-9 * Math.max(1, Math.abs(ref)) || e8 < 0.5 * e4
}

/** Do the two sides of c approach the same value (whatever f(c) is)? */
export function sidesMeet(f: (x: number) => number, c: number): boolean {
  const s = scaleOf(c)
  const d4 = Math.abs(safe(f, c - 1e-4 * s) - safe(f, c + 1e-4 * s))
  const d8 = Math.abs(safe(f, c - 1e-8 * s) - safe(f, c + 1e-8 * s))
  if (!Number.isFinite(d4) || !Number.isFinite(d8)) return false
  const mag = Math.max(1, Math.abs(safe(f, c + 1e-8 * s)))
  return d8 <= 1e-9 * mag || d8 < 0.5 * d4
}

/**
 * The one-sided derivatives at c, Richardson-extrapolated from one-sided
 * difference quotients (error O(h²)). ±Infinity where the quotient runs away
 * — a cusp or a vertical tangent — and NaN where f is undefined on that side.
 */
export function sideSlopes(f: (x: number) => number, c: number): { left: number; right: number } {
  const s = scaleOf(c)
  const f0 = safe(f, c)
  const q = (dir: 1 | -1, h: number): number => (safe(f, c + dir * h) - f0) / (dir * h)
  const side = (dir: 1 | -1): number => {
    if (!Number.isFinite(f0)) return Number.NaN
    const coarse = q(dir, 1e-2 * s)
    const h = 1e-5 * s
    const q1 = q(dir, h)
    const q2 = q(dir, 2 * h)
    const fine = q(dir, 1e-8 * s)
    if (![coarse, q1, q2, fine].every(Number.isFinite)) return Number.NaN
    // A quotient that keeps growing as h shrinks is an infinite slope: x^(2/3)
    // grows 100× over these six decades, a smooth curve not at all.
    if (Math.abs(fine) > 10 * Math.max(1, Math.abs(coarse)) && Math.abs(fine) > 50) {
      return fine > 0 ? Infinity : -Infinity
    }
    return 2 * q1 - q2
  }
  return { left: side(-1), right: side(1) }
}

// ---------------------------------------------------------------------------
// Continuity on [a, b]
// ---------------------------------------------------------------------------

/** Mirrors analyze.ts probeJump: bisect toward the larger gap; a jump's gap holds. */
function probeStep(
  f: (x: number) => number,
  a: number,
  fa: number,
  b: number,
  fb: number,
  span: number,
): { kind: 'jump' | 'pole' | 'undefined'; p: number; q: number } | null {
  let aX = a
  let aY = fa
  let bX = b
  let bY = fb
  const joinTol = 1e-13 * Math.max(1, Math.abs(fa), Math.abs(fb))
  const spans: number[] = [Math.abs(fb - fa)]
  if (!(spans[0] > joinTol)) return null
  const tEps = 1e-9 * span
  let decided = false
  for (let i = 1; i <= 80; i++) {
    const m = 0.5 * (aX + bX)
    if (m === aX || m === bX) return { kind: 'jump', p: aX, q: bX }
    const y = safe(f, m)
    if (!Number.isFinite(y)) return { kind: 'undefined', p: m, q: m }
    const l = Math.abs(y - aY)
    const r = Math.abs(bY - y)
    let gap: number
    if (l >= r) {
      bX = m
      bY = y
      gap = l
    } else {
      aX = m
      aY = y
      gap = r
    }
    if (gap <= joinTol) return null
    spans[i] = gap
    if (!decided && bX - aX <= tEps) {
      const before = spans[Math.max(0, i - 8)]
      if (gap < 0.75 * before) return null
      if (gap > 4 * before) return { kind: 'pole', p: aX, q: bX }
      decided = true
    }
    if (decided && bX - aX <= 1e-15 * Math.max(1, Math.abs(aX))) break
  }
  return { kind: decided ? 'jump' : 'undefined', p: aX, q: bX }
}

/**
 * Where f fails to be continuous on the CLOSED interval [a, b], leftmost first.
 * Empty when f is continuous there. At a (and b) only the inside matters:
 * √x is continuous on [0, 4].
 */
export function continuityOn(src: MvtSource, a: number, b: number): ContinuityFailure[] {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return []
  if (!inDomain(src, lo) || !inDomain(src, hi)) {
    const x = !inDomain(src, a) ? a : b
    return [{ kind: 'domain', x, exact: snapExact(x) }]
  }
  const f = src.f
  const span = clampSpan(lo, hi)
  const within = (x: number): boolean =>
    x >= lo - 1e-12 * scaleOf(x) && x <= hi + 1e-12 * scaleOf(x)
  const cands: number[] = []
  const stretches: ContinuityFailure[] = []
  const add = (x: number): void => {
    if (Number.isFinite(x) && within(x)) cands.push(Math.min(hi, Math.max(lo, x)))
  }
  try {
    for (const x of src.singularities?.([lo, hi]) ?? []) add(x)
  } catch {
    /* none */
  }
  try {
    for (const x of src.poles?.([lo, hi]) ?? []) add(x)
  } catch {
    /* none */
  }
  try {
    for (const x of src.holes?.([lo, hi]) ?? []) add(x)
  } catch {
    /* none */
  }
  for (const x of src.pieceEnds ?? []) add(x)

  // The scan: every sample, a NaN run's edges, and every suspicious step.
  const N = SCAN_N
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i <= N; i++) {
    const x = i === N ? hi : lo + (span * i) / N
    xs.push(x)
    ys.push(safe(f, x))
  }
  /** Where finite turns into undefined between two samples. */
  const edge = (good: number, bad: number): number => {
    let g = good
    let bd = bad
    for (let k = 0; k < 60; k++) {
      const m = 0.5 * (g + bd)
      if (m === g || m === bd) break
      if (Number.isFinite(safe(f, m))) g = m
      else bd = m
    }
    return 0.5 * (g + bd)
  }
  let i = 0
  while (i <= N) {
    if (Number.isFinite(ys[i])) {
      i++
      continue
    }
    let j = i
    while (j + 1 <= N && !Number.isFinite(ys[j + 1])) j++
    const start = i > 0 ? edge(xs[i - 1], xs[i]) : lo
    const end = j < N ? edge(xs[j + 1], xs[j]) : hi
    if (j === i && i > 0 && i < N) {
      // One bad sample: a point (1/x at 0), classified below.
      add(xs[i])
    } else if (end - start > 1e-9 * span) {
      const s = snapped(start, 1e-9 * span)
      const e = snapped(end, 1e-9 * span)
      stretches.push({ kind: 'undefined', x: s.x, to: e.x, exact: s.exact })
    } else {
      add(start)
    }
    i = j + 1
  }
  let probes = 0
  const D = (k: number): number =>
    k >= 0 && k < N && Number.isFinite(ys[k]) && Number.isFinite(ys[k + 1]) ? ys[k + 1] - ys[k] : Number.NaN
  for (let k = 0; k < N && probes < MAX_PROBES; k++) {
    const dk = D(k)
    if (!Number.isFinite(dk) || Math.abs(dk) <= 1e-9 * Math.max(1, Math.abs(ys[k]))) continue
    const l = D(k - 1)
    const r = D(k + 1)
    const nb = Math.max(Number.isFinite(l) ? Math.abs(l) : 0, Number.isFinite(r) ? Math.abs(r) : 0)
    if (!(Math.abs(dk) > 3 * nb)) continue
    probes++
    const res = probeStep(f, xs[k], ys[k], xs[k + 1], ys[k + 1], span)
    if (!res) continue
    add(0.5 * (res.p + res.q))
  }

  // Classify every candidate from its one-sided limits and its value.
  const out: ContinuityFailure[] = [...stretches]
  const seen: number[] = []
  cands.sort((p, q) => p - q)
  for (const raw of cands) {
    const { x, exact } = snapped(raw, 1e-9 * Math.max(span, scaleOf(raw)))
    if (seen.some((s) => Math.abs(s - x) <= 1e-9 * Math.max(span, scaleOf(x)))) continue
    if (stretches.some((s) => x >= s.x - 1e-12 && x <= (s.to ?? s.x) + 1e-12)) continue
    seen.push(x)
    const atLo = x <= lo + 1e-12 * scaleOf(lo)
    const atHi = x >= hi - 1e-12 * scaleOf(hi)
    const v = valueAt(src, x)
    const L = atLo ? null : sideLimit(f, x, -1)
    const R = atHi ? null : sideLimit(f, x, 1)
    const sides = [L, R].filter((s): s is number => s !== null)
    if (sides.length === 0 && !Number.isFinite(v)) {
      out.push({ kind: 'undefined', x, exact })
      continue
    }
    if (sides.some((s) => !Number.isFinite(s))) {
      out.push({ kind: 'pole', x, exact })
      continue
    }
    if (L !== null && R !== null && !sidesMeet(f, x)) {
      out.push({ kind: 'jump', x, exact })
      continue
    }
    if (!Number.isFinite(v)) {
      out.push({ kind: sides.length === 0 ? 'undefined' : 'hole', x, exact })
      continue
    }
    const offL = L !== null && !approaches(f, x, -1, v)
    const offR = R !== null && !approaches(f, x, 1, v)
    if (offL || offR) {
      // At an end only the inside counts, so a step AT a is a jump of the
      // outside, not of f on [a, b] — unless f(a) is not that inside limit.
      out.push({ kind: atLo || atHi ? 'jump' : 'removable', x, exact })
    }
  }
  out.sort((p, q) => p.x - q.x)
  return out
}

// ---------------------------------------------------------------------------
// Differentiability on (a, b)
// ---------------------------------------------------------------------------

/** Chord slope of f over [u, v]. */
const chord = (f: (x: number) => number, u: number, v: number): number =>
  (safe(f, v) - safe(f, u)) / (v - u)

/** Pin a kink inside [u, v] down: the two outer chords' lines meet at it. */
function locateKink(f: (x: number) => number, u0: number, v0: number): number {
  let u = u0
  let v = v0
  let c = 0.5 * (u + v)
  for (let k = 0; k < 40; k++) {
    const w = v - u
    if (!(w > 1e-13 * scaleOf(c))) break
    const sL = chord(f, u - w, u)
    const sR = chord(f, v, v + w)
    const fu = safe(f, u)
    const fv = safe(f, v)
    let next = Number.NaN
    if ([sL, sR, fu, fv].every(Number.isFinite) && Math.abs(sL - sR) > 1e-12 * Math.max(1, Math.abs(sL), Math.abs(sR))) {
      next = (fv - fu + sL * u - sR * v) / (sL - sR)
    }
    if (!(next > u && next < v)) {
      // Fall back: keep the half that is further from a straight line.
      const m = 0.5 * (u + v)
      const dev = (p: number, q: number): number =>
        Math.abs(safe(f, 0.5 * (p + q)) - 0.5 * (safe(f, p) + safe(f, q)))
      if (dev(u, m) >= dev(m, v)) v = m
      else u = m
      c = 0.5 * (u + v)
      continue
    }
    c = next
    const half = w / 8
    u = Math.max(u, c - half)
    v = Math.min(v, c + half)
  }
  return c
}

/** Pin a slope spike inside [u, v] down: keep the half with the steeper chord. */
function locateSpike(f: (x: number) => number, u0: number, v0: number): number {
  let u = u0
  let v = v0
  for (let k = 0; k < 70; k++) {
    const m = 0.5 * (u + v)
    if (m === u || m === v) break
    const l = Math.abs(chord(f, u, m))
    const r = Math.abs(chord(f, m, v))
    if (!Number.isFinite(l) && !Number.isFinite(r)) break
    if (!Number.isFinite(r) || l >= r) v = m
    else u = m
  }
  return 0.5 * (u + v)
}

/** A maximum (`up`) or minimum of f inside [u, v], by golden section. */
function locateExtremum(f: (x: number) => number, u0: number, v0: number, up: boolean): number {
  let l = u0
  let r = v0
  const phi = (Math.sqrt(5) - 1) / 2
  const val = (x: number): number => {
    const y = safe(f, x)
    return up ? -y : y
  }
  for (let k = 0; k < 160; k++) {
    const m1 = r - phi * (r - l)
    const m2 = l + phi * (r - l)
    if (!(m2 > m1)) break
    if (val(m1) <= val(m2)) r = m2
    else l = m1
  }
  return 0.5 * (l + r)
}

/**
 * Where f is NOT differentiable on the OPEN interval (a, b): corners, cusps,
 * vertical tangents. Points where f is not even continuous are left to
 * continuityOn (they are not differentiable either, and say so there).
 */
export function differentiabilityOn(src: MvtSource, a: number, b: number): SmoothnessFailure[] {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return []
  if (src.poly) return [] // a polynomial is smooth everywhere
  const f = src.f
  const span = clampSpan(lo, hi)
  const N = SCAN_N
  const dx = span / N
  const xs: number[] = []
  for (let i = 0; i <= N; i++) xs.push(i === N ? hi : lo + dx * i)
  const s: number[] = []
  for (let i = 0; i < N; i++) s.push(chord(f, xs[i], xs[i + 1]))
  const cands: number[] = []
  const inside = (x: number): boolean => x > lo + 1e-9 * span && x < hi - 1e-9 * span
  for (const e of src.pieceEnds ?? []) if (inside(e)) cands.push(e)

  const fin = (k: number): boolean => k >= 0 && k < N && Number.isFinite(s[k])
  // Corners: the chord slope turns abruptly — far more than its neighbours turn.
  const turn = (k: number): number => (fin(k - 1) && fin(k + 1) ? Math.abs(s[k + 1] - s[k - 1]) : Number.NaN)
  let probes = 0
  for (let k = 1; k < N - 1 && probes < MAX_PROBES; k++) {
    const t = turn(k)
    if (!Number.isFinite(t)) continue
    const floor = 1e-7 * (1 + Math.abs(s[k - 1]) + Math.abs(s[k + 1]))
    if (!(t > floor)) continue
    const l = turn(k - 2)
    const r = turn(k + 2)
    const nb = Math.max(Number.isFinite(l) ? l : 0, Number.isFinite(r) ? r : 0)
    if (!(t > CORNER_GATE * nb)) continue
    // Only the local peak of the turn: a kink inside chord k shows in k and k ± 1.
    const tl = turn(k - 1)
    const tr = turn(k + 1)
    if ((Number.isFinite(tl) && tl > t) || (Number.isFinite(tr) && tr >= t)) continue
    probes++
    cands.push(locateKink(f, xs[Math.max(0, k - 1)], xs[Math.min(N, k + 2)]))
  }
  // Cusps and vertical tangents. At the scan's resolution x^(2/3) is only
  // mildly steep, so these are found by SHAPE rather than size: a chord slope
  // that peaks well above the chords two away (x^(1/3) at 0), and an extremum
  // where the slope flips far more abruptly than its neighbours turn
  // (x^(2/3) at 0). The strongest few of each are classified below.
  const scored: { score: number; at: () => number }[] = []
  const mag = (k: number): number => (fin(k) ? Math.abs(s[k]) : 0)
  for (let k = 0; k < N; k++) {
    if (!fin(k)) continue
    const m = Math.abs(s[k])
    if (!(m > 0) || mag(k - 1) > m || mag(k + 1) > m) continue
    const score = m / Math.max(mag(k - 2), mag(k + 2), 1e-300)
    if (score > SPIKE_GATE) {
      const u = xs[Math.max(0, k - 1)]
      const v = xs[Math.min(N, k + 2)]
      scored.push({ score, at: () => locateSpike(f, u, v) })
    }
  }
  for (let k = 1; k < N; k++) {
    if (!fin(k - 1) || !fin(k) || !(s[k - 1] * s[k] < 0)) continue
    const flip = Math.abs(s[k] - s[k - 1])
    const nl = fin(k - 3) && fin(k - 2) ? Math.abs(s[k - 2] - s[k - 3]) : 0
    const nr = fin(k + 1) && fin(k + 2) ? Math.abs(s[k + 2] - s[k + 1]) : 0
    const score = flip / Math.max(nl, nr, 1e-300)
    if (score > SPIKE_GATE / 2) {
      const u = xs[k - 1]
      const v = xs[Math.min(N, k + 1)]
      const up = s[k - 1] > 0
      scored.push({ score, at: () => locateExtremum(f, u, v, up) })
    }
  }
  scored.sort((p, q) => q.score - p.score)
  for (const c of scored.slice(0, MAX_PROBES / 2)) cands.push(c.at())

  const out: SmoothnessFailure[] = []
  cands.sort((p, q) => p - q)
  for (const raw of cands) {
    if (!inside(raw)) continue
    const { x, exact } = snapped(raw, 1e-8 * Math.max(span, scaleOf(raw)))
    if (!inside(x)) continue
    if (out.some((o) => Math.abs(o.x - x) <= 1e-7 * Math.max(span, scaleOf(x)))) continue
    const fx = valueAt(src, x)
    if (!Number.isFinite(fx)) continue // not continuous: continuityOn's business
    // A jump or a pole is continuityOn's to report, not a corner.
    if (!approaches(f, x, -1, fx) || !approaches(f, x, 1, fx)) continue
    const { left, right } = sideSlopes(f, x)
    if (Number.isNaN(left) || Number.isNaN(right)) continue
    const infL = !Number.isFinite(left)
    const infR = !Number.isFinite(right)
    if (infL || infR) {
      const same = infL && infR && Math.sign(left) === Math.sign(right)
      out.push({ kind: same ? 'vertical' : 'cusp', x, exact })
      continue
    }
    if (Math.abs(left - right) > CORNER_REL * Math.max(1, Math.abs(left), Math.abs(right))) {
      out.push({ kind: 'corner', x, exact, left, right })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Roots of g on an interval
// ---------------------------------------------------------------------------

/**
 * Every x in [lo, hi] (open ends when `open`) where g(x) = 0: sign changes
 * bisected, touching zeros by golden section, each accepted only where |g| is
 * genuinely small — a sign change across a corner of f′ is not a root.
 */
function rootsOf(
  g: (x: number) => number,
  lo: number,
  hi: number,
  open: boolean,
  accept: number,
): { all: boolean; xs: number[]; stretches: [number, number][] } {
  const N = ROOT_N
  const span = hi - lo
  const xs: number[] = []
  const gs: number[] = []
  const i0 = open ? 1 : 0
  const i1 = open ? N - 1 : N
  for (let i = i0; i <= i1; i++) {
    const x = i === N ? hi : lo + (span * i) / N
    xs.push(x)
    gs.push(safe(g, x))
  }
  const finite = gs.filter(Number.isFinite)
  if (finite.length > 0.9 * gs.length && finite.every((v) => Math.abs(v) <= accept)) {
    return { all: true, xs: [], stretches: [] }
  }
  // Runs of three or more samples where g vanishes — to rounding, not merely
  // nearly (x³ is 1e-6 at 0.01): a stretch, not a point.
  const flat = 1e-10 * Math.max(1, accept / ROOT_ACCEPT)
  const stretches: [number, number][] = []
  {
    let k = 0
    while (k < xs.length) {
      if (!(Math.abs(gs[k]) <= accept)) {
        k++
        continue
      }
      let j = k
      while (j + 1 < xs.length && Math.abs(gs[j + 1]) <= accept) j++
      if (j - k >= 2 && gs.slice(k, j + 1).every((v) => Math.abs(v) <= flat)) {
        // Pin each end down to where g stops vanishing (floor(x)'s step at 2).
        const pin = (inside: number, outside: number): number => {
          let p = inside
          let q = outside
          for (let it = 0; it < 80; it++) {
            const m = 0.5 * (p + q)
            if (m === p || m === q) break
            if (Math.abs(safe(g, m)) <= flat) p = m
            else q = m
          }
          return p
        }
        const from = k > 0 ? pin(xs[k], xs[k - 1]) : xs[k]
        const to = j + 1 < xs.length ? pin(xs[j], xs[j + 1]) : xs[j]
        stretches.push([from, to])
      }
      k = j + 1
    }
  }
  const inStretch = (x: number): boolean =>
    stretches.some(([p, q]) => x >= p - span / N && x <= q + span / N)
  const out: number[] = []
  const push = (x: number): void => {
    const v = safe(g, x)
    if (!(Math.abs(v) <= accept)) return
    if (open && !(x > lo && x < hi)) return
    if (inStretch(x)) return
    if (out.some((o) => Math.abs(o - x) <= 1e-7 * Math.max(span, scaleOf(x)))) return
    out.push(x)
  }
  for (let k = 0; k < xs.length; k++) {
    if (gs[k] === 0) push(xs[k])
  }
  for (let k = 0; k + 1 < xs.length; k++) {
    const p = gs[k]
    const q = gs[k + 1]
    if (!Number.isFinite(p) || !Number.isFinite(q) || p === 0 || q === 0) continue
    if (Math.sign(p) === Math.sign(q)) continue
    let l = xs[k]
    let r = xs[k + 1]
    const sl = Math.sign(p)
    for (let it = 0; it < 200; it++) {
      const m = 0.5 * (l + r)
      if (m === l || m === r) break
      const v = safe(g, m)
      if (!Number.isFinite(v)) break
      if (v === 0) {
        l = m
        r = m
        break
      }
      if (Math.sign(v) === sl) l = m
      else r = m
    }
    const gl = Math.abs(safe(g, l))
    const gr = Math.abs(safe(g, r))
    push(gl <= gr ? l : r)
  }
  // Touching zeros: a local minimum of |g| that nearly reaches 0.
  for (let k = 1; k + 1 < xs.length; k++) {
    const a = Math.abs(gs[k - 1])
    const b = Math.abs(gs[k])
    const c = Math.abs(gs[k + 1])
    if (![a, b, c].every(Number.isFinite)) continue
    if (!(b <= a && b <= c)) continue
    if (Math.sign(gs[k - 1]) !== Math.sign(gs[k + 1])) continue
    if (b > 1e3 * accept + 1e-4 * Math.max(a, c)) continue
    let l = xs[k - 1]
    let r = xs[k + 1]
    const phi = (Math.sqrt(5) - 1) / 2
    for (let it = 0; it < 120; it++) {
      const m1 = r - phi * (r - l)
      const m2 = l + phi * (r - l)
      if (!(m2 > m1)) break
      if (Math.abs(safe(g, m1)) <= Math.abs(safe(g, m2))) r = m2
      else l = m1
    }
    push(0.5 * (l + r))
  }
  out.sort((p, q) => p - q)
  return { all: false, xs: out, stretches }
}

/** Snap each root with verifiedExact, the curve itself the judge. */
function exactRoots(xs: number[], check: (x: number) => boolean): Solution[] {
  return xs.map((x) => {
    let exact: ExactForm | null = null
    if (x === 0 || Math.abs(x) < 1e-12) {
      exact = check(0) ? { text: '0', tex: '0', value: 0 } : null
      if (exact) return { x: 0, exact }
    }
    try {
      exact = verifiedExact(x, check, { tol: 1e-7 })
    } catch {
      exact = null
    }
    return exact ? { x: exact.value + 0, exact } : { x, exact: null }
  })
}

/** Points and stretches, in order along x; a stretch's ends snapped when nice. */
function withStretches(points: Solution[], stretches: [number, number][]): Solution[] {
  if (stretches.length === 0) return points
  const out = points.slice()
  for (const [p, q] of stretches) {
    const a = snapped(p, 1e-9 * Math.max(1, q - p))
    const b = snapped(q, 1e-9 * Math.max(1, q - p))
    out.push({ x: a.x, exact: a.exact, to: b.x, toExact: b.exact })
  }
  out.sort((u, v) => u.x - v.x)
  return out
}

// ---------------------------------------------------------------------------
// The Mean Value Theorem
// ---------------------------------------------------------------------------

/**
 * Every c in the open interval (a, b) with f′(c) = m — whether or not the
 * hypotheses hold (a c that happens to exist is still reported).
 */
export function mvtPoints(src: MvtSource, a: number, b: number, m: number): MvtPoints {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo) || !Number.isFinite(m)) {
    return { all: false, points: [] }
  }
  const g = (x: number): number => safe(src.d, x) - m
  const accept = ROOT_ACCEPT * Math.max(1, Math.abs(m))
  const r = rootsOf(g, lo, hi, true, accept)
  if (r.all) return { all: true, points: [] }
  const tight = EXACT_CHECK * Math.max(1, Math.abs(m))
  const points = exactRoots(r.xs, (c) => Math.abs(safe(src.d, c) - m) <= tight)
  return { all: false, points: withStretches(points, r.stretches) }
}

// ---------------------------------------------------------------------------
// Average value
// ---------------------------------------------------------------------------

/** ∫ of the polynomial with ascending coefficients c, from a to b. */
export function polyIntegral(c: readonly number[], a: number, b: number): number {
  let A = 0
  let B = 0
  for (let k = c.length - 1; k >= 0; k--) {
    A = (A + c[k] / (k + 1)) * a
    B = (B + c[k] / (k + 1)) * b
  }
  return B - A
}

const horner = (c: readonly number[], x: number): number => {
  let y = 0
  for (let k = c.length - 1; k >= 0; k--) y = y * x + c[k]
  return y
}

const hornerD = (c: readonly number[], x: number): number => {
  let y = 0
  for (let k = c.length - 1; k >= 1; k--) y = y * x + k * c[k]
  return y
}

/**
 * f_avg = (1/(b − a))∫ₐᵇ f dx, and every c in [a, b] with f(c) = f_avg (the
 * Mean Value Theorem for integrals). Null when the integral does not exist.
 */
export function averageValue(src: MvtSource, a: number, b: number): AverageValue | null {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return null
  if (!inDomain(src, lo) || !inDomain(src, hi)) return null
  let I: { value: number; exact: boolean } | null = null
  if (src.poly) I = { value: polyIntegral(src.poly, lo, hi), exact: true }
  else if (src.integral) {
    try {
      I = src.integral(lo, hi)
    } catch {
      I = null
    }
  }
  if (!I || !Number.isFinite(I.value)) return null
  let value = I.value / (hi - lo)
  // A closed-form integral is good to rounding; a measured one only to the
  // quadrature's own tolerance, so its closed form (if any) must be simple.
  const form = I.exact ? exactForm(value) : exactForm(value, { tol: 1e-10 })
  if (form && I.exact) value = form.value
  const target = value
  const f = src.f
  const g = (x: number): number => safe(f, x) - target
  const accept = ROOT_ACCEPT * Math.max(1, Math.abs(target))
  const r = rootsOf(g, lo, hi, false, accept)
  const tight = EXACT_CHECK * Math.max(1, Math.abs(target))
  const points = r.all
    ? []
    : withStretches(
        exactRoots(r.xs, (c) => Math.abs(valueAt(src, c) - target) <= tight),
        r.stretches,
      )
  return { value, exact: I.exact, form, integral: I.value, points }
}

// ---------------------------------------------------------------------------
// The source for a board curve
// ---------------------------------------------------------------------------

/** A NICE x for ModelSpec.evalExact: p/q (q ≤ 64) or pπ/q (q ≤ 24), exactly. */
function exactPointOf(x: number): { p: number; q: number; pi: boolean } | null {
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

/**
 * How the theorems read a board curve: a function of x, or null.
 *
 * f′ comes from the best source there is — a polynomial's coefficients, a
 * typed line's jets, a library family's symbolic slope — and only then from a
 * difference quotient (tangentAt's own fallback). A curve that CALLS another
 * (`f(x − 1)`) has no jets and falls through to that.
 */
export function mvtSourceOf(curve: FittedCurve, models: Record<string, ModelSpec>): MvtSource | null {
  if (!curve || curve.kind !== 'explicit') return null
  const spec = models[curve.modelId]
  const ev = spec?.evalExplicit
  if (!spec || spec.kind !== 'explicit' || !ev) return null
  const params = curve.params.slice()
  const domain =
    curve.domain && Number.isFinite(curve.domain[0]) && Number.isFinite(curve.domain[1])
      ? ([Math.min(curve.domain[0], curve.domain[1]), Math.max(curve.domain[0], curve.domain[1])] as [number, number])
      : null
  const inside = (x: number): boolean => !domain || (x >= domain[0] && x <= domain[1])
  const f = (x: number): number => {
    if (!inside(x)) return Number.NaN
    try {
      const v = ev.call(spec, params, x)
      return typeof v === 'number' ? v : Number.NaN
    } catch {
      return Number.NaN
    }
  }
  let poly: number[] | null = null
  try {
    poly = polynomialOf(curve, models)
  } catch {
    poly = null
  }
  const jets = spec.taylor ? spec.taylor.bind(spec) : null
  const d = (x: number): number => {
    if (!inside(x)) return Number.NaN
    if (poly) return hornerD(poly, x)
    if (jets) {
      try {
        const c = jets(params, x, 1)
        if (c && Number.isFinite(c[1])) {
          // At a domain END only one side exists; the jet is still the slope.
          return Number.isFinite(f(x)) ? c[1] : Number.NaN
        }
        // Null jets: not analytic here (|x| at 0), or a formula jets cannot
        // carry (a named call) — the difference quotient decides.
      } catch {
        /* fall through */
      }
    }
    try {
      return tangentAt(curve, models, x)?.m ?? Number.NaN
    } catch {
      return Number.NaN
    }
  }
  const src: MvtSource = {
    f: poly ? (x: number) => (inside(x) ? horner(poly as number[], x) : Number.NaN) : f,
    d,
    domain,
    poly,
  }
  if (spec.evalExact) {
    const exactEval = spec.evalExact.bind(spec)
    src.exactAt = (x: number) => {
      if (!inside(x)) return undefined
      const p = exactPointOf(x)
      if (!p) return undefined
      try {
        const v = exactEval(params, p)
        return typeof v === 'number' ? v : undefined
      } catch {
        return undefined
      }
    }
  }
  if (spec.singularities) {
    const sing = spec.singularities.bind(spec)
    src.singularities = (range) => sing(params, range).filter(inside)
  }
  if (spec.pieces) {
    try {
      const ends: number[] = []
      for (const p of spec.pieces(params)) {
        if (Number.isFinite(p.lo)) ends.push(p.lo)
        if (Number.isFinite(p.hi)) ends.push(p.hi)
      }
      src.pieceEnds = ends.filter(inside)
    } catch {
      /* none */
    }
  }
  if (!poly) {
    src.poles = (range) => findPoles(curve, models, range)
    src.holes = (range) => findHoles(curve, models, range).map((h) => h.x)
  }
  src.integral = (a: number, b: number) => {
    try {
      const r = areaUnder(curve, models, a, b)
      return r ? { value: r.value, exact: r.exact } : null
    } catch {
      return null
    }
  }
  return src
}

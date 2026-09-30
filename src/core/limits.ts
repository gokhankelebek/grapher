// ============================================================================
// src/core/limits.ts — limits at a point and at ±∞, the way AP Calculus Unit 1
// (and AP Precalculus) asks about them.
//
//   limitAt(src, a)                the left, right and two-sided limits (a
//                                  number, ±∞, 'DNE' with the reason, or
//                                  'unknown'), f(a), the classification at a
//                                  and the three-part continuity checklist.
//                                  a may be ±Infinity: a limit at infinity.
//   limitTable(src, a, side)       the table of values a class fills in:
//                                  a ± 0.1, 0.01, 0.001, 0.0001 (or x = 10,
//                                  100, … 10⁵ toward ∞), f(x) to sensible digits;
//                                  toward ∞ the column stops before a row
//                                  the doubles overflow on (eˣ at 1000)
//   deltaFor(src, a, L, ε, side)   the largest δ found on a sampled scan with
//                                  0 < |x − a| < δ ⇒ |f(x) − L| < ε
//   limitPoints(src, range)        where the interesting limits are: holes,
//                                  jumps, poles (what a dragged a snaps to)
//   limitSourceOf(curve, models)   the source for a board curve
//
// HOW A ONE-SIDED LIMIT IS READ. Three instruments, in order of trust:
//
//   1. The JET. A typed line's Taylor jet at a (src/core/parse/jets.ts) is
//      exact up to rounding and survives a removable 0/0: sin(x)/x at 0 has
//      c₀ = 1, (√(x+4) − 2)/x has c₀ = 1/4. When the jet exists at an interior
//      point both sides converge to c₀, and that is the limit — checked once
//      against a sample, never trusted blind.
//   2. The LADDER. f at a ± 10⁻ᵏ·s, k = 1 … 7 (s = max(1, |a|)): a side
//      DIVERGES when its values keep one sign and grow at every rung (100×, or
//      steps that refuse to shrink — ln|x| walks down by ln 10 per rung
//      forever), mirroring src/core/holes.ts; it is infinite when a value is.
//   3. The WINDOWS. Min and max of f over [a + 10⁻⁽ᵏ⁺¹⁾s, a + 10⁻ᵏs], 96
//      samples each. A convergent side's windows SHRINK (by 10⁴ over four
//      decades for anything smooth, by 10^(4/3) for ∛x); an oscillating side's
//      do not, and its values do not run off to one side either — sin(1/x)
//      fills [−1, 1] in every window however close. The limit of a converging
//      side is snapped to a closed form only when every window closes IN on
//      that form (x·sin(1/x) → 0, floor(x) → 1 from the left of 2), otherwise
//      it is reported as a decimal marked approximate.
//
//   Where the numbers do not settle either way the answer is 'unknown', never
//   a guess: 1/ln|x| does go to 0, but at 10⁻⁷ it is still −0.06, and a
//   number line that says "0" there would be claiming more than it measured.
//
// AT ±∞ the same three instruments run on x = ±10ᵏ (k = 1 … 8) and on the
// windows [X, 3X]: (2x² + 1)/(x² − 3) → 2, e^(−x) → 0, ln x → ∞, sin x
// oscillates, x·sin x oscillates without bound. Where the doubles overflow
// into NaN first (e^x/(e^x + 1) is ∞/∞ past x ≈ 709.78) that NaN is no
// sample, not "undefined": the ladder is laid geometrically from 10 up to
// the last x that evaluates, and e^x/(e^x + 1) → 1 is read from there.
//
// Pure: no DOM, no React, no render imports — the renderer's oneSidedLimit
// idea is mirrored here, not imported.
// ============================================================================

import type { FittedCurve, ModelSpec } from './types'
import type { ExactForm } from './exact'
import { exactForm } from './exact'
import { continuityOn, mvtSourceOf } from './mvt'
import type { MvtSource } from './mvt'
import { findHoles, findPoles } from './holes'
import { overflowEdge } from './domainRange'

// ---------------------------------------------------------------------------
// The source
// ---------------------------------------------------------------------------

/** How a limit reads a function: the theorems' source, plus the jet's c₀. */
export interface LimitSource extends MvtSource {
  /**
   * c₀ of the Taylor jet at x — the value f extends to continuously there,
   * including across a removable 0/0. Null where there is no jet (not
   * analytic at x, or a formula jets cannot carry).
   */
  jet0?(x: number): number | null
}

/**
 * The source for a board curve (null when it is not a function of x).
 *
 * The theorems' source, with f read from the curve's OWN evaluator: mvt.ts
 * swaps in Horner's rule when five samples say "polynomial", and a piecewise
 * x² with a different value at x = 2 passes that test — which is harmless for
 * a secant and fatal for "f(2) differs from the limit". Holes and poles are
 * always offered for the same reason.
 */
export function limitSourceOf(curve: FittedCurve, models: Record<string, ModelSpec>): LimitSource | null {
  const base = mvtSourceOf(curve, models)
  if (!base) return null
  const spec = models[curve.modelId]
  const ev = spec?.evalExplicit
  if (!spec || !ev) return null
  const params = curve.params.slice()
  const domain = base.domain
  const f = (x: number): number => {
    if (domain && (x < domain[0] || x > domain[1])) return Number.NaN
    try {
      const v = ev.call(spec, params, x)
      return typeof v === 'number' ? v : Number.NaN
    } catch {
      return Number.NaN
    }
  }
  const src: LimitSource = { ...base, f }
  src.poles = (range) => findPoles(curve, models, range)
  src.holes = (range) => findHoles(curve, models, range).map((h) => h.x)
  if (spec.taylor) {
    const jets = spec.taylor.bind(spec)
    src.jet0 = (x: number): number | null => {
      try {
        const c = jets(params, x, 0)
        return c && Number.isFinite(c[0]) ? c[0] : null
      } catch {
        return null
      }
    }
  }
  return src
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** Why a limit does not exist. */
export type DneReason =
  /** both one-sided limits exist and differ (a jump) */
  | 'sides-differ'
  /** the two sides run off to −∞ and +∞ */
  | 'infinite-signs'
  /** f oscillates: sin(1/x) at 0, sin x at ∞ */
  | 'oscillates'
  /** f is defined on one side only: √x at 0 — only the one-sided limit exists */
  | 'one-sided'
  /** f is not defined there at all (on this side, or on both) */
  | 'undefined'

/**
 * One limit: a finite number, +Infinity, −Infinity, 'DNE' (with the reason),
 * or 'unknown' when the numbers did not settle.
 */
export interface LimitOutcome {
  value: number | 'DNE' | 'unknown'
  /** The closed form of a finite value, when it is one (1/4, π/2, 6). */
  exact: ExactForm | null
  /** A finite value known only numerically: say ≈. */
  approx: boolean
  /** Set with 'DNE'. */
  why?: DneReason
  /** Oscillation only: whether it stays bounded (sin(1/x)) or not (x·sin x at ∞). */
  bounded?: boolean
}

export type LimitClass =
  /** f(a) defined, the limit exists, and they agree */
  | 'continuous'
  /** the limit exists, f(a) is undefined or differs from it — a hole */
  | 'removable'
  /** both one-sided limits finite and different */
  | 'jump'
  /** a one-sided limit is ±∞ — a vertical asymptote */
  | 'infinite'
  /** f oscillates as x → a */
  | 'oscillating'
  /** f is defined on one side of a only: an endpoint of its domain */
  | 'endpoint'
  /** f is not defined anywhere near a */
  | 'undefined'
  /** the numbers did not settle */
  | 'unknown'
  /** a = ±∞: there is no "at a" to classify */
  | 'infinity'

export interface LimitResult {
  a: number
  /** From the left / right; null at ±∞ (there is only one way in). */
  left: LimitOutcome | null
  right: LimitOutcome | null
  /** The two-sided limit (at ±∞: THE limit). */
  two: LimitOutcome
  /** f(a); null when it is undefined (or a = ±∞). */
  fa: { value: number; exact: ExactForm | null } | null
  kind: LimitClass
  /**
   * AP continuity at a: (1) f(a) is defined, (2) the limit exists, (3) it
   * equals f(a). At an endpoint of the domain, (2) and (3) are read one-sided
   * from the side f lives on. Null at ±∞.
   */
  checklist: [boolean, boolean, boolean] | null
  /** Endpoint only: which side f is defined on (−1 left, 1 right). */
  liveSide?: -1 | 1
}

export type LimitSide = 'both' | 'left' | 'right'

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** The ladder toward a finite a: h = 10⁻ᵏ·s. */
const NEAR_K = [1, 2, 3, 4, 5, 6, 7]
/** The ladder toward ±∞: |x| = 10ᵏ. */
const FAR_K = [1, 2, 3, 4, 5, 6, 7, 8]
/** Samples per window. */
const WINDOW_N = 96
/** A converging side's nearest window is at most this fraction of its farthest. */
const SHRINK = 0.1
/** An oscillating side's nearest window is at least this fraction of the one three decades out. */
const HOLD = 0.3
/** Relative agreement for "the two sides meet" and "the limit is f(a)". */
const MEET_REL = 1e-6

const scaleOf = (x: number): number => Math.max(1, Math.abs(x))

function safe(fn: (x: number) => number, x: number): number {
  try {
    const v = fn(x)
    return typeof v === 'number' ? v : Number.NaN
  } catch {
    return Number.NaN
  }
}

function inDomain(src: MvtSource, x: number): boolean {
  const d = src.domain
  if (!d) return true
  const tol = 1e-9 * Math.max(1, Math.abs(d[0]), Math.abs(d[1]))
  return x >= d[0] - tol && x <= d[1] + tol
}

/** f at x, exactly when the source can say so (sin π is 0, not 1.2e-16). */
function valueAt(src: MvtSource, x: number): number {
  if (!inDomain(src, x)) return Number.NaN
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

const near = (p: number, q: number, mag: number): boolean =>
  Math.abs(p - q) <= MEET_REL * Math.max(1, mag, Math.abs(p), Math.abs(q))

// ---------------------------------------------------------------------------
// One side
// ---------------------------------------------------------------------------

interface Window {
  min: number
  max: number
  /** finite samples */
  n: number
  /** min |f| over the finite samples */
  minAbs: number
  /** every finite sample has this sign (0 when mixed or zero) */
  sign: number
}

function windowOf(f: (x: number) => number, u: number, v: number): Window {
  let min = Infinity
  let max = -Infinity
  let n = 0
  let minAbs = Infinity
  let pos = 0
  let neg = 0
  for (let i = 0; i <= WINDOW_N; i++) {
    const x = u + ((v - u) * i) / WINDOW_N
    const y = safe(f, x)
    if (Number.isNaN(y)) continue
    n++
    if (y < min) min = y
    if (y > max) max = y
    const m = Math.abs(y)
    if (m < minAbs) minAbs = m
    if (y > 0) pos++
    else if (y < 0) neg++
  }
  const sign = pos === n && n > 0 ? 1 : neg === n && n > 0 ? -1 : 0
  return { min, max, n, minAbs, sign }
}

const unknown = (): LimitOutcome => ({ value: 'unknown', exact: null, approx: false })
const dne = (why: DneReason, bounded?: boolean): LimitOutcome => ({
  value: 'DNE',
  exact: null,
  approx: false,
  why,
  ...(bounded !== undefined ? { bounded } : {}),
})

/**
 * The closed form every window closes in on, or null. `wins` run from far to
 * near; `cands` are proposals (the nearest value, its extrapolation, f(a)),
 * each only a guess until the windows agree: the distance from the form to
 * the farthest point of each window must shrink at every one of the last four
 * windows and end a tenth of where it began — or be nothing at all. A limit
 * ε away from a nice number stops shrinking once the windows are narrower
 * than ε, which is what keeps 1 + 10⁻³ from being called 1.
 */
function settledForm(
  cands: readonly number[],
  wins: readonly Window[],
  mag: number,
  vs: readonly number[] = [],
): ExactForm | null {
  const forms: ExactForm[] = []
  const zero: ExactForm = { text: '0', tex: '0', value: 0 }
  const wN = wins[wins.length - 1]
  const spread = wN ? wN.max - wN.min : Infinity
  // Simplest first: 0, then what the numbers say to six places, then — for a
  // slow approach (∛x, √x) — a SHORT form within 10⁻³ (1, 1/2, π/2; never a
  // compound surd, which a slow approach cannot tell from its neighbours).
  for (const c of cands) {
    if (Number.isFinite(c) && Math.abs(c) <= Math.max(1e-9 * Math.max(1, mag), 10 * spread)) forms.push(zero)
  }
  for (const c of cands) {
    if (!Number.isFinite(c)) continue
    const tight = exactForm(c, { tol: 1e-6 })
    if (tight) forms.push(tight)
  }
  for (const c of cands) {
    if (!Number.isFinite(c)) continue
    const loose = exactForm(c, { tol: 1e-3 })
    if (loose && loose.text.length <= 5 && !/[+]|.[−]/.test(loose.text)) forms.push(loose)
  }
  for (const form of forms) {
    const dist = wins.map((w) => Math.max(Math.abs(w.max - form.value), Math.abs(w.min - form.value)))
    const first = dist[0]
    const last = dist[dist.length - 1]
    if (!Number.isFinite(last) || !Number.isFinite(first)) continue
    const tiny = 1e-9 * Math.max(1, mag, Math.abs(form.value))
    if (last <= tiny) return form.value === 0 ? zero : form
    const tailD = dist.slice(-4)
    const steady = tailD.every((d, i) => i === 0 || d <= 0.8 * tailD[i - 1] || d <= tiny)
    const scale = Math.max(1, mag, Math.abs(form.value))
    if (!(steady && last <= SHRINK * first && last <= 0.05 * scale)) continue
    // Close enough that nothing measurable separates them: done.
    if (last <= 1e-5 * scale) return form.value === 0 ? zero : form
    // A SLOW approach (√x, ∛x) must also be heading for the form: Aitken's
    // extrapolation of the last three rungs lands on it. 1/ln|x| is still at
    // −0.062 at 10⁻⁷ and creeping; its extrapolation is nowhere near −1/16.
    if (aitkenAgrees(vs, form.value, scale)) return form.value === 0 ? zero : form
  }
  return null
}

/** Does Aitken's Δ² extrapolation of the ladder's last three values land on c? */
function aitkenAgrees(vs: readonly number[], c: number, scale: number): boolean {
  const v = vs.filter(Number.isFinite)
  if (v.length < 3) return false
  const [p, q, r] = v.slice(-3)
  const s1 = q - p
  const s2 = r - q
  let pred = r
  if (s1 !== 0) {
    const ratio = s2 / s1
    if (!(ratio > -1 && ratio < 1)) return false
    pred = r + (s2 * ratio) / (1 - ratio)
  }
  return Math.abs(pred - c) <= 0.25 * Math.max(Math.abs(r - c), 1e-12 * scale)
}


/**
 * One side of a: `xs` are the ladder's x's (far to near), `wins` the windows
 * (far to near). Shared by the finite and the infinite case.
 */
function readSide(
  f: (x: number) => number,
  xs: readonly number[],
  wins: readonly Window[],
  hint: number | null = null,
): LimitOutcome {
  const vs = xs.map((x) => safe(f, x))
  const defined = wins.filter((w) => w.n > 0).length
  // Nothing at all on this side, or nothing in the nearest half of it.
  if (defined === 0) return dne('undefined')
  const nearWins = wins.slice(-3)
  if (nearWins.every((w) => w.n === 0)) return dne('undefined')
  if (nearWins.some((w) => w.n < WINDOW_N / 4)) return unknown()

  const tail = vs.slice(-4)
  // Overflow or a value that IS infinite: that side runs away.
  const inf = tail.find((v) => v === Infinity || v === -Infinity)
  const mag = Math.max(
    1,
    ...wins.slice(0, 2).map((w) => (Number.isFinite(w.minAbs) ? w.minAbs : 0)),
  )

  // Oscillation: the windows do not shrink, and do not run off to one side.
  const w3 = wins[wins.length - 4]
  const wN = wins[wins.length - 1]
  const range = (w: Window): number => w.max - w.min
  if (inf === undefined && w3 && Number.isFinite(range(w3)) && Number.isFinite(range(wN))) {
    const holds = range(wN) >= HOLD * range(w3) && range(wN) > 1e-3 * mag
    // Running off: one sign, and each window wholly beyond the one before it
    // (ln x toward ∞ widens by nothing and still never comes back).
    const lastFour = wins.slice(-4)
    const runsOff =
      wN.sign !== 0 &&
      lastFour.every((w) => w.sign === wN.sign) &&
      lastFour.every((w, i) => {
        if (i === 0) return true
        const prev = lastFour[i - 1]
        return wN.sign > 0 ? w.min >= prev.max - 1e-12 * Math.abs(prev.max) : w.max <= prev.min + 1e-12 * Math.abs(prev.min)
      })
    if (holds && !runsOff) {
      // Bounded when the near windows are no wider than the far ones (×4 slack).
      const bounded = range(wN) <= 4 * range(w3) + 1e-9
      if (wN.sign === 0 || range(wN) > 1e-2 * Math.max(1, Math.abs(wN.max), Math.abs(wN.min))) {
        return dne('oscillates', bounded)
      }
    }
  }

  // Divergence, mirroring holes.ts: an infinite value; or one sign and |f|
  // growing at every rung, to 100×, or by steps that refuse to shrink.
  if (inf !== undefined) return { value: inf, exact: null, approx: false }
  const nearV = vs.slice(-5)
  if (nearV.every(Number.isFinite)) {
    const sgn = Math.sign(nearV[nearV.length - 1])
    const oneSign = sgn !== 0 && nearV.every((v) => Math.sign(v) === sgn)
    const grows = nearV.every((v, i) => i === 0 || Math.abs(v) > Math.abs(nearV[i - 1]))
    if (oneSign && grows) {
      const first = Math.abs(nearV[0])
      const last = Math.abs(nearV[nearV.length - 1])
      const step0 = Math.abs(nearV[1] - nearV[0])
      const stepN = Math.abs(nearV[nearV.length - 1] - nearV[nearV.length - 2])
      const tol = 1e-6 * Math.max(1, mag)
      if (last >= 100 * Math.max(first, 1e-300) || last > 1e8 * mag || (stepN >= 0.5 * step0 && stepN > tol)) {
        return { value: sgn > 0 ? Infinity : -Infinity, exact: null, approx: false }
      }
    }
  }

  // Convergence: the windows close in.
  const wFar = wins.find((w) => w.n > 0) ?? wins[0]
  if (!Number.isFinite(range(wN)) || !Number.isFinite(range(wFar))) return unknown()
  const valMag = Math.max(1, Math.abs(wN.max), Math.abs(wN.min))
  const closes = range(wN) <= SHRINK * range(wFar) || range(wN) <= 1e-9 * valMag
  if (!closes) return unknown()
  // The estimate: the nearest ladder value (the window's middle when the
  // ladder's last rung fell on a NaN).
  const lastV = vs[vs.length - 1]
  const est = Number.isFinite(lastV) ? lastV : 0.5 * (wN.max + wN.min)
  // Richardson on the last two rungs (the rungs are a factor 10 apart:
  // L ≈ (10·v(h) − v(10h))/9 for a first-order approach).
  const pv = vs[vs.length - 2]
  const rich = Number.isFinite(lastV) && Number.isFinite(pv) ? (10 * lastV - pv) / 9 : est
  const cands = hint !== null && Number.isFinite(hint) ? [est, rich, hint] : [est, rich]
  const form = settledForm(cands, wins.filter((w) => w.n > 0), mag, vs)
  if (form) return { value: form.value, exact: form, approx: false }
  // No closed form: a decimal is stated only when the nearest window pins it
  // to four places; a slow approach (1/ln|x|) is honestly 'unknown'.
  if (range(wN) > 1e-4 * valMag) return unknown()
  const value = Math.abs(rich - est) <= 1e-3 * valMag ? rich : est
  return { value, exact: null, approx: true }
}

/** One side of a finite a. */
function sideAt(src: LimitSource, a: number, dir: -1 | 1, hint: number | null): LimitOutcome {
  const s = scaleOf(a)
  const f = (x: number): number => (inDomain(src, x) ? safe(src.f, x) : Number.NaN)
  const xs = NEAR_K.map((k) => a + dir * Math.pow(10, -k) * s)
  const wins = NEAR_K.slice(0, -1).map((k) => {
    const hFar = Math.pow(10, -k) * s
    const hNear = Math.pow(10, -(k + 1)) * s
    return windowOf(f, a + dir * hNear, a + dir * hFar)
  })
  return readSide(f, xs, wins, hint)
}

/**
 * How far out toward ±∞ (dir) f can be READ: +∞, or the last |x| before the
 * doubles overflow into NaN. e^x/(e^x + 1) is ∞/∞ = NaN from x ≈ 709.78 on,
 * though it is defined (and ≈ 1) everywhere; a NaN that begins where f was
 * arriving smoothly, far out, is that (see overflowEdge in ./domainRange).
 * A formula that really stops (√(1000 − x), ln(1000 − x)) is read as it is.
 */
function readableReach(f: (x: number) => number, dir: -1 | 1): number {
  let lastFinite: number | null = null
  for (const k of [1, ...FAR_K.map((q) => q + 0.5), 9]) {
    const x = dir * Math.pow(10, k)
    const v = f(x)
    if (Number.isFinite(v)) { lastFinite = x; continue }
    if (!Number.isNaN(v) || lastFinite === null) return Infinity
    // NaN from here out?
    const beyond = [2, 10, 100].map((m) => f(x * m))
    if (!beyond.every(Number.isNaN)) return Infinity
    const X = overflowEdge(f, lastFinite, x)
    return X === null ? Infinity : Math.abs(X)
  }
  return Infinity
}

/** The one way in to ±∞. */
function sideAtInfinity(src: LimitSource, dir: -1 | 1): LimitOutcome {
  const d = src.domain
  if (d && (dir > 0 ? Number.isFinite(d[1]) : Number.isFinite(d[0]))) return dne('undefined')
  const f = (x: number): number => safe(src.f, x)
  const reach = readableReach(f, dir)
  if (reach < Infinity) {
    // Overflow NaN is no sample: the ladder runs from 10 to the last x that
    // evaluates, geometrically (its windows [X, 3X] inside the reach), and
    // the limit is read from there — e^x/(e^x + 1) → 1.
    const top = (0.9 * reach) / 3
    if (top > 20) {
      const n = FAR_K.length
      const r = Math.pow(top / 10, 1 / (n - 1))
      const Xs = FAR_K.map((_, i) => 10 * Math.pow(r, i))
      const xs = Xs.map((X) => dir * X)
      const wins = Xs.slice(0, -1).map((X) => (dir > 0 ? windowOf(f, X, 3 * X) : windowOf(f, -3 * X, -X)))
      return readSide(f, xs, wins)
    }
  }
  const xs = FAR_K.map((k) => dir * Math.pow(10, k))
  const wins = FAR_K.slice(0, -1).map((k) => {
    const X = Math.pow(10, k)
    return dir > 0 ? windowOf(f, X, 3 * X) : windowOf(f, -3 * X, -X)
  })
  return readSide(f, xs, wins)
}

// ---------------------------------------------------------------------------
// The limit at a
// ---------------------------------------------------------------------------

const isNum = (o: LimitOutcome): o is LimitOutcome & { value: number } => typeof o.value === 'number'
const isFiniteOutcome = (o: LimitOutcome): boolean => isNum(o) && Number.isFinite(o.value)

/** The two sides, put together. */
function combine(L: LimitOutcome, R: LimitOutcome, mag: number): LimitOutcome {
  if (L.value === 'unknown' || R.value === 'unknown') {
    // An oscillating or undefined side decides it regardless of the other.
    if (L.value === 'DNE' && L.why === 'oscillates') return dne('oscillates', L.bounded)
    if (R.value === 'DNE' && R.why === 'oscillates') return dne('oscillates', R.bounded)
    return unknown()
  }
  const lu = L.value === 'DNE' && L.why === 'undefined'
  const ru = R.value === 'DNE' && R.why === 'undefined'
  if (lu && ru) return dne('undefined')
  if (lu || ru) return dne('one-sided')
  if (L.value === 'DNE' || R.value === 'DNE') {
    const o = L.value === 'DNE' ? L : R
    return dne(o.why ?? 'oscillates', o.bounded)
  }
  const l = L.value as number
  const r = R.value as number
  if (!Number.isFinite(l) || !Number.isFinite(r)) {
    if (l === r) return { value: l, exact: null, approx: false }
    return Number.isFinite(l) || Number.isFinite(r) ? dne('sides-differ') : dne('infinite-signs')
  }
  if (!near(l, r, mag)) return dne('sides-differ')
  // Agreeing sides: the exact one speaks for both.
  const exact = L.exact ?? R.exact
  if (exact) return { value: exact.value, exact, approx: false }
  return { value: 0.5 * (l + r), exact: null, approx: L.approx || R.approx }
}

/**
 * f(a), as a class states it: the value and its closed form, or null when f
 * is undefined there. Three sources, one verdict:
 *   * the drawn evaluation — NaN or ±∞ is undefined (it honours a restricted
 *     domain and a piece's conditions, which the exact evaluator does not);
 *   * the formula's own singularities — a point written `{x != 2}` evaluates
 *     to a number and is still excluded, and 1/ln|x| is not 0 at 0;
 *   * the exact evaluator, when it agrees with the drawn value (sin π = 0).
 */
function valueWithForm(src: LimitSource, a: number): { value: number; exact: ExactForm | null } | null {
  if (!inDomain(src, a)) return null
  const plain = safe(src.f, a)
  if (!Number.isFinite(plain)) return null
  let named = false
  try {
    const tol = 1e-12 * scaleOf(a)
    const sing = src.singularities?.([a - 1e-9 * scaleOf(a), a + 1e-9 * scaleOf(a)]) ?? []
    named = sing.some((x) => Math.abs(x - a) <= tol)
  } catch {
    /* no singularities to ask */
  }
  if (named) {
    // A one-formula line's `{x != 2}` is not in its evaluator (x² {x != 2}
    // still says 4 at 2): the singularity decides. A PIECEWISE evaluator
    // gates every condition, so a finite value there is some piece's own:
    // {x² if x ≠ 2; 5 if x = 2} names 2 (the first piece's exclusion) and
    // its second piece says f(2) = 5. Only a pole the doubles missed —
    // tan(π/2) is 1.6e16, not ∞ — is still undefined.
    if (!src.pieceEnds) return null
    const h = 1e-6 * scaleOf(a)
    const around = Math.abs(safe(src.f, a - h)) + Math.abs(safe(src.f, a + h))
    if (!(Math.abs(plain) <= 1e8 * (1 + (Number.isFinite(around) ? around : 0)))) return null
  }
  let v = plain
  const e = valueAt(src, a)
  if (Number.isFinite(e) && Math.abs(e - plain) <= 1e-9 * Math.max(1, Math.abs(plain))) v = e
  if (v === 0) return { value: 0, exact: { text: '0', tex: '0', value: 0 } }
  const form = exactForm(v)
  return { value: v, exact: form }
}

/**
 * Everything about lim x→a f(x): both sides, the two-sided limit, f(a), what
 * kind of point a is, and the AP continuity checklist. `a` may be ±Infinity.
 */
export function limitAt(src: LimitSource, a: number): LimitResult {
  if (a === Infinity || a === -Infinity) {
    const two = sideAtInfinity(src, a > 0 ? 1 : -1)
    return { a, left: null, right: null, two, fa: null, kind: 'infinity', checklist: null }
  }
  if (!Number.isFinite(a)) {
    return { a, left: null, right: null, two: unknown(), fa: null, kind: 'unknown', checklist: null }
  }
  const fa = valueWithForm(src, a)
  const d = src.domain
  const tol = 1e-12 * scaleOf(a)
  const inside = !d || (a > d[0] + tol && a < d[1] - tol)

  let left: LimitOutcome | null = null
  let right: LimitOutcome | null = null

  // 1. The jet, at an interior point: both sides converge to c₀.
  if (inside && src.jet0) {
    const c0 = src.jet0(a)
    if (c0 !== null && Number.isFinite(c0)) {
      const h = 1e-4 * scaleOf(a)
      const probe = [safe(src.f, a - h), safe(src.f, a + h)]
      const agrees = probe.every((v) => Number.isFinite(v) && Math.abs(v - c0) <= 1e-2 * Math.max(1, Math.abs(c0)))
      if (agrees) {
        const form = c0 === 0 ? { text: '0', tex: '0', value: 0 } : exactForm(c0)
        // A jet is exact to rounding: a closed form is kept when the jet IS
        // one; otherwise the value is still the value, only unnamed.
        const o: LimitOutcome = form
          ? { value: form.value, exact: form, approx: false }
          : { value: c0, exact: null, approx: false }
        left = o
        right = o
      }
    }
  }

  // 2 and 3. The ladder and the windows.
  if (!left || !right) {
    left = sideAt(src, a, -1, fa ? fa.value : null)
    right = sideAt(src, a, 1, fa ? fa.value : null)
    // A side that converges to f(a) takes f(a)'s exact value (√x at 0⁺ is 0,
    // floor(x) at 2⁺ is 2).
    if (fa) {
      for (const which of ['left', 'right'] as const) {
        const o = which === 'left' ? left : right
        if (isFiniteOutcome(o) && near(o.value as number, fa.value, Math.abs(fa.value)) && !o.exact) {
          const upd: LimitOutcome = fa.exact
            ? { value: fa.exact.value, exact: fa.exact, approx: false }
            : { value: fa.value, exact: null, approx: o.approx }
          if (which === 'left') left = upd
          else right = upd
        }
      }
    }
  }

  const mag = Math.max(
    1,
    isFiniteOutcome(left) ? Math.abs(left.value as number) : 0,
    isFiniteOutcome(right) ? Math.abs(right.value as number) : 0,
  )
  const two = combine(left, right, mag)

  // What kind of point a is.
  let kind: LimitClass
  let liveSide: -1 | 1 | undefined
  const lu = left.value === 'DNE' && left.why === 'undefined'
  const ru = right.value === 'DNE' && right.why === 'undefined'
  const osc = (o: LimitOutcome): boolean => o.value === 'DNE' && o.why === 'oscillates'
  const infinite = (o: LimitOutcome): boolean => isNum(o) && !Number.isFinite(o.value)
  if (lu && ru) kind = 'undefined'
  else if (lu || ru) {
    kind = 'endpoint'
    liveSide = lu ? 1 : -1
  } else if (osc(left) || osc(right)) kind = 'oscillating'
  else if (infinite(left) || infinite(right)) kind = 'infinite'
  else if (left.value === 'unknown' || right.value === 'unknown') kind = 'unknown'
  else if (two.value === 'DNE') kind = 'jump'
  else if (fa && isNum(two) && near(two.value, fa.value, mag)) kind = 'continuous'
  else kind = 'removable'

  // The checklist. At an endpoint (2) and (3) are one-sided, from where f lives.
  let lim: LimitOutcome = two
  if (kind === 'endpoint') lim = liveSide === 1 ? right : left
  const exists = isFiniteOutcome(lim)
  const equals = exists && fa !== null && near(lim.value as number, fa.value, mag)
  const checklist: [boolean, boolean, boolean] = [fa !== null, exists, equals]
  // An endpoint whose one side is itself oscillating or infinite is really that.
  if (kind === 'endpoint' && !exists) {
    if (osc(lim)) kind = 'oscillating'
    else if (infinite(lim)) kind = 'infinite'
  }

  return {
    a,
    left,
    right,
    two,
    fa,
    kind,
    checklist,
    ...(liveSide !== undefined ? { liveSide } : {}),
  }
}

/** The limit the link asks for: two-sided, or one side of it. */
export function chosenLimit(res: LimitResult, side: LimitSide): LimitOutcome {
  if (side === 'left' && res.left) return res.left
  if (side === 'right' && res.right) return res.right
  return res.two
}

// ---------------------------------------------------------------------------
// The table of values
// ---------------------------------------------------------------------------

export interface TableRow {
  x: number
  /** "2.99", "0.0001", "1000" — the x as the table prints it. */
  xText: string
  /** f(x); NaN where undefined. */
  y: number
  /** "5.99", "0.998334", "undefined" */
  yText: string
}

export interface LimitTable {
  /** x approaching a from the left, farthest first (x → a⁻), or toward −∞. */
  left: TableRow[] | null
  /** x approaching a from the right, farthest first (x → a⁺), or toward +∞. */
  right: TableRow[] | null
}

const MINUS = '−'

/** f(x) the way a table of values prints it: seven significant digits, trimmed. */
export function tableNumber(v: number): string {
  if (Number.isNaN(v)) return 'undefined'
  if (v === Infinity) return '∞'
  if (v === -Infinity) return `${MINUS}∞`
  if (v === 0) return '0'
  const mag = Math.abs(v)
  let s: string
  if (mag >= 1e7 || mag < 1e-6) {
    const [m, e] = v.toExponential(4).split('e')
    const mant = m.replace(/\.?0+$/, '')
    s = `${mant}e${Number(e)}`
  } else {
    // Seven significant digits (1.999² = 3.996001, not 3.996) — and more (up
    // to ten) when seven would round a value that is NOT a round number to
    // one: sin(0.001)/0.001 is 0.99999983, and a table that prints "1" there
    // has stopped approaching.
    const at = (p: number): string => {
      let t = v.toPrecision(p)
      if (t.includes('e')) t = String(Number(t))
      if (t.includes('.')) t = t.replace(/0+$/, '').replace(/\.$/, '')
      return t
    }
    s = at(7)
    for (let p = 8; p <= 10; p++) {
      const digits = s.replace(/^-/, '').replace('.', '').replace(/^0+/, '').length
      if (Number(s) === v || digits > 2) break
      s = at(p)
    }
  }
  return s.replace(/-/g, MINUS)
}

/** Decimal places of a short decimal (0 for a whole number), or null. */
function placesOf(v: number): number | null {
  for (let p = 0; p <= 6; p++) {
    const t = Math.round(v * Math.pow(10, p)) / Math.pow(10, p)
    if (Math.abs(t - v) <= 1e-12 * Math.max(1, Math.abs(v))) return p
  }
  return null
}

/** x in the table: a ± h at h's own precision (2.99, 3.0001), else six significant digits. */
function tableX(x: number, a: number, k: number): string {
  const pa = placesOf(a)
  if (pa !== null) {
    const s = x.toFixed(Math.max(pa, k))
    return (s.startsWith('-0') && Number(s) === 0 ? s.slice(1) : s).replace(/-/g, MINUS)
  }
  return tableNumber(Number(x.toPrecision(k + 3)))
}

/**
 * The AP table: a ± 0.1, 0.01, 0.001, 0.0001 (farthest first on each side),
 * or x = ±10, 100, … 10⁵ toward ±∞. `side` picks which columns.
 */
export function limitTable(src: LimitSource, a: number, side: LimitSide = 'both'): LimitTable {
  const f = (x: number): number => {
    const v = valueAt(src, x)
    return Number.isFinite(v) ? v : Number.isNaN(v) ? Number.NaN : v
  }
  if (a === Infinity || a === -Infinity) {
    const dir = a > 0 ? 1 : -1
    // The column STOPS at the last x whose value the doubles can hold. eˣ at
    // 1000 is not ∞ (it is about 2·10⁴³⁴), and e^x/(e^x + 1) there is not
    // undefined (it is 1 to 400 places): a row that overflowed would print
    // a false answer, so it is left out rather than marked. A value that
    // really is ±∞ or undefined at that x (ln(1000 − x) at 1000) stays.
    const plain = (x: number): number => safe(src.f, x)
    const reach = readableReach(plain, dir)
    const overflowed = (x: number, y: number): boolean => {
      if (Number.isFinite(y)) return false
      if (Number.isNaN(y)) return Math.abs(x) > reach
      const h = 1e-6 * Math.abs(x)
      return !Number.isFinite(plain(x - h)) && !Number.isFinite(plain(x + h))
    }
    const rows: TableRow[] = []
    for (const k of [1, 2, 3, 4, 5]) {
      const x = dir * Math.pow(10, k)
      const y = f(x)
      if (rows.length > 0 && overflowed(x, y)) break
      rows.push({ x, xText: tableNumber(x), y, yText: tableNumber(y) })
    }
    return dir > 0 ? { left: null, right: rows } : { left: rows, right: null }
  }
  const ks = [1, 2, 3, 4]
  const col = (dir: -1 | 1): TableRow[] =>
    ks.map((k) => {
      const x = a + dir * Math.pow(10, -k)
      const y = f(x)
      return { x, xText: tableX(x, a, k), y, yText: tableNumber(y) }
    })
  return {
    left: side === 'right' ? null : col(-1),
    right: side === 'left' ? null : col(1),
  }
}

// ---------------------------------------------------------------------------
// ε–δ
// ---------------------------------------------------------------------------

export interface DeltaResult {
  /** The largest δ found. */
  delta: number
  /** No violation was found out to the scan's reach: any δ up to `delta` works on it. */
  capped: boolean
}

/** Samples of the ε–δ scan on each side. */
const DELTA_N = 4000

/**
 * The largest δ on a sampled scan with 0 < |x − a| < δ ⇒ |f(x) − L| < ε — on
 * both sides, or one of them. x where f is undefined is not in the domain, so
 * it asks nothing of δ. The first violating sample on either side is refined
 * by bisection toward a. Null when a, L or ε make no sense.
 */
export function deltaFor(
  src: LimitSource,
  a: number,
  L: number,
  eps: number,
  side: LimitSide = 'both',
  reach: number = 4 * scaleOf(a),
): DeltaResult | null {
  if (![a, L, eps, reach].every(Number.isFinite) || !(eps > 0) || !(reach > 0)) return null
  const f = (x: number): number => (inDomain(src, x) ? safe(src.f, x) : Number.NaN)
  const bad = (x: number): boolean => {
    const y = f(x)
    if (Number.isNaN(y)) return false
    return !(Math.abs(y - L) < eps)
  }
  const dirs: (-1 | 1)[] = side === 'left' ? [-1] : side === 'right' ? [1] : [-1, 1]
  let delta = reach
  let capped = true
  for (const dir of dirs) {
    // Geometric rungs close in (a violation right next to a), then a fine
    // linear scan out to the reach.
    const ts: number[] = []
    for (let k = 9; k >= 1; k--) ts.push(reach * Math.pow(10, -k - 1))
    for (let i = 1; i <= DELTA_N; i++) ts.push((reach * i) / DELTA_N)
    let good = 0
    for (const t of ts) {
      if (t >= delta) break
      if (!bad(a + dir * t)) {
        good = t
        continue
      }
      // Refine between the last good t and this bad one.
      let lo = good
      let hi = t
      for (let it = 0; it < 60; it++) {
        const m = 0.5 * (lo + hi)
        if (m === lo || m === hi) break
        if (bad(a + dir * m)) hi = m
        else lo = m
      }
      if (hi < delta) {
        delta = hi
        capped = false
      }
      break
    }
  }
  return { delta, capped }
}

// ---------------------------------------------------------------------------
// Where the interesting limits are
// ---------------------------------------------------------------------------

export interface LimitPoint {
  x: number
  kind: 'hole' | 'jump' | 'pole' | 'undefined'
  exact: ExactForm | null
}

/**
 * The holes, jumps, poles (and isolated undefined points) of f within the
 * range, leftmost first — continuityOn's findings, which already sort a
 * removable 0/0 from a jump from an asymptote.
 */
export function limitPoints(src: LimitSource, range: [number, number]): LimitPoint[] {
  const lo = Math.min(range[0], range[1])
  const hi = Math.max(range[0], range[1])
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return []
  let a = lo
  let b = hi
  const d = src.domain
  if (d) {
    a = Math.max(a, d[0])
    b = Math.min(b, d[1])
    if (!(b > a)) return []
  }
  let found: ReturnType<typeof continuityOn> = []
  try {
    found = continuityOn(src, a, b)
  } catch {
    found = []
  }
  const out: LimitPoint[] = []
  for (const c of found) {
    if (c.kind === 'domain') continue
    if (c.kind === 'undefined' && c.to !== undefined) continue
    const kind: LimitPoint['kind'] =
      c.kind === 'hole' || c.kind === 'removable'
        ? 'hole'
        : c.kind === 'jump'
          ? 'jump'
          : c.kind === 'pole'
            ? 'pole'
            : 'undefined'
    out.push({ x: c.x, kind, exact: c.exact })
  }
  // A written exclusion ({x != 2}) evaluates to a number and so slips past
  // the scan; the formula's own singularities are asked about one by one.
  let sing: number[] = []
  try {
    sing = src.singularities?.([a, b]) ?? []
  } catch {
    sing = []
  }
  for (const x of sing) {
    if (out.some((p) => Math.abs(p.x - x) <= 1e-9 * scaleOf(x))) continue
    const r = limitAt(src, x)
    const kind: LimitPoint['kind'] | null =
      r.kind === 'removable'
        ? 'hole'
        : r.kind === 'jump'
          ? 'jump'
          : r.kind === 'infinite'
            ? 'pole'
            : r.kind === 'oscillating' || r.kind === 'undefined'
              ? 'undefined'
              : null
    if (kind) out.push({ x, kind, exact: x === 0 ? { text: '0', tex: '0', value: 0 } : exactForm(x) })
  }
  out.sort((p, q) => p.x - q.x)
  return out
}

/**
 * How far f runs on from a on one side without a break — the nearest hole,
 * jump, pole, gap or domain end — capped at `cap`. What the gliding arrows
 * may ride: an arrow on the NEXT step of floor(x) is not approaching a.
 */
export function reachFrom(src: LimitSource, a: number, dir: -1 | 1, cap: number = 20 * scaleOf(a)): number {
  if (!Number.isFinite(a) || !(cap > 0)) return 0
  let lim = cap
  const d = src.domain
  if (d) lim = Math.min(lim, dir > 0 ? d[1] - a : a - d[0])
  if (!(lim > 0)) return 0
  const lo = dir > 0 ? a : a - lim
  const hi = dir > 0 ? a + lim : a
  let found: ReturnType<typeof continuityOn> = []
  try {
    found = continuityOn(src, lo, hi)
  } catch {
    found = []
  }
  const gap = 1e-9 * Math.max(scaleOf(a), lim)
  let best = lim
  for (const c of found) {
    if (c.kind === 'domain') continue
    // A stretch where f is undefined begins (or, to the left, ends) the break.
    const edge = c.kind === 'undefined' && c.to !== undefined ? (dir > 0 ? c.x : c.to) : c.x
    const dist = dir > 0 ? edge - a : a - edge
    if (dist > gap && dist < best) best = dist
  }
  return best
}

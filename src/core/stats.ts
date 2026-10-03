// ============================================================================
// src/core/stats.ts — the statistics of NC Math 3 / AP Precalculus.
//
//   NORMAL     erf / erfc (error under 1e-15 relative near the centre, a
//              continued fraction in the tails), the pdf and cdf of N(μ, σ),
//              the inverse normal (Acklam, then one Halley step against the
//              accurate cdf), z-scores and the empirical rule
//   RANDOM     a seeded generator (mulberry32) and its normal variates, so a
//              simulation is a pure function of its settings and seed
//   SAMPLING   σ/√n and √(p(1−p)/n), z* for a confidence level, the margin of
//              error, and repeated sampling from a normal population, a
//              proportion or a pasted list
//   COMPARING  the randomisation test: shuffle the group labels, record the
//              difference in means, and the p-value as the share at least as
//              extreme as the difference the experiment saw
//
// Pure: no DOM, no React. Nothing here is stored — a simulation's results are
// recomputed from its seed and settings every time they are needed.
// ============================================================================

const SQRT2 = Math.SQRT2
const SQRT_PI = Math.sqrt(Math.PI)
const SQRT_2PI = Math.sqrt(2 * Math.PI)

// ---------------------------------------------------------------------------
// erf / erfc
// ---------------------------------------------------------------------------

/**
 * erf(x) for |x| ≤ 2.5 by the series of positive terms
 *   erf x = (2/√π) e^{−x²} Σ 2ⁿ x^{2n+1} / (1·3·5···(2n+1)),
 * which has no cancellation, so it keeps full double precision.
 */
function erfSeries(x: number): number {
  const x2 = x * x
  let term = x
  let sum = x
  for (let n = 1; n < 200; n++) {
    term *= (2 * x2) / (2 * n + 1)
    sum += term
    if (Math.abs(term) < 1e-17 * Math.abs(sum)) break
  }
  return (2 / SQRT_PI) * Math.exp(-x2) * sum
}

/**
 * erfc(x) for x ≥ 2.5 by the continued fraction
 *   erfc x = e^{−x²}/√π · 1/(x + (1/2)/(x + 1/(x + (3/2)/(x + 2/(x + …)))))
 * evaluated with the modified Lentz method — relative accuracy in the tail.
 */
function erfcFraction(x: number): number {
  const tiny = 1e-300
  let f = x
  let C = x
  let D = 0
  for (let k = 1; k < 500; k++) {
    const a = k / 2
    D = x + a * D
    if (Math.abs(D) < tiny) D = tiny
    C = x + a / C
    if (Math.abs(C) < tiny) C = tiny
    D = 1 / D
    const delta = C * D
    f *= delta
    if (Math.abs(delta - 1) < 1e-16) break
  }
  return Math.exp(-x * x) / SQRT_PI / f
}

const SPLIT = 2.5

/** The error function. */
export function erf(x: number): number {
  if (Number.isNaN(x)) return NaN
  if (x === Infinity) return 1
  if (x === -Infinity) return -1
  const ax = Math.abs(x)
  if (ax <= SPLIT) return erfSeries(x)
  const v = 1 - erfcFraction(ax)
  return x < 0 ? -v : v
}

/** The complementary error function 1 − erf(x), accurate (relatively) in the right tail. */
export function erfc(x: number): number {
  if (Number.isNaN(x)) return NaN
  if (x === Infinity) return 0
  if (x === -Infinity) return 2
  if (x > SPLIT) return erfcFraction(x)
  if (x < -SPLIT) return 2 - erfcFraction(-x)
  return 1 - erfSeries(x)
}

// ---------------------------------------------------------------------------
// The normal distribution
// ---------------------------------------------------------------------------

/** The density of N(μ, σ) at x. */
export function normalPdf(x: number, mu = 0, sigma = 1): number {
  if (!(sigma > 0)) return NaN
  const z = (x - mu) / sigma
  return Math.exp(-0.5 * z * z) / (sigma * SQRT_2PI)
}

/** P(X ≤ x) for X ~ N(μ, σ). Accurate relatively in both tails. */
export function normalCdf(x: number, mu = 0, sigma = 1): number {
  if (!(sigma > 0)) return NaN
  const z = (x - mu) / sigma
  if (z === Infinity) return 1
  if (z === -Infinity) return 0
  return 0.5 * erfc(-z / SQRT2)
}

/** P(a ≤ X ≤ b) — written so a far tail does not cancel to 0. */
export function normalBetween(a: number, b: number, mu = 0, sigma = 1): number {
  if (!(sigma > 0)) return NaN
  if (b < a) return 0
  const za = (a - mu) / sigma
  const zb = (b - mu) / sigma
  // Both bounds in the upper tail: subtract the upper tails instead.
  if (za > 0) return Math.max(0, normalCdf(-za) - normalCdf(-zb))
  return Math.max(0, normalCdf(zb) - normalCdf(za))
}

const A = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
const B = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
const C = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
const D = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
const P_LOW = 0.02425

/**
 * The z with Φ(z) = p (the standard normal's quantile). Acklam's rational
 * approximation (relative error 1.15e-9), then Halley steps against the
 * accurate cdf, which bring it to machine precision.
 */
export function invNorm(p: number, mu = 0, sigma = 1): number {
  if (!(p >= 0 && p <= 1) || !(sigma > 0)) return NaN
  if (p === 0) return -Infinity
  if (p === 1) return Infinity
  let x: number
  if (p < P_LOW) {
    const q = Math.sqrt(-2 * Math.log(p))
    x = (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1)
  } else if (p <= 1 - P_LOW) {
    const q = p - 0.5
    const r = q * q
    x = ((((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q) /
      (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1)
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    x = -(((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1)
  }
  // Refinement (Halley). In the upper half the error is measured on the upper
  // tail, so p close to 1 keeps its digits.
  for (let i = 0; i < 2; i++) {
    const e = p > 0.5 ? (1 - p) - normalCdf(-x) : normalCdf(x) - p
    const u = e * SQRT_2PI * Math.exp((x * x) / 2)
    if (!Number.isFinite(u)) break
    x = x - u / (1 + (x * u) / 2)
  }
  return mu + sigma * x
}

/** z = (x − μ)/σ. */
export function zScore(x: number, mu: number, sigma: number): number {
  return (x - mu) / sigma
}

/** x = μ + zσ. */
export function fromZ(z: number, mu: number, sigma: number): number {
  return mu + z * sigma
}

/** The empirical rule: the share within k standard deviations, exact and as taught. */
export const EMPIRICAL_RULE: readonly { k: 1 | 2 | 3; exact: number; taught: number; text: string }[] = [
  { k: 1, exact: normalBetween(-1, 1), taught: 0.68, text: '68%' },
  { k: 2, exact: normalBetween(-2, 2), taught: 0.95, text: '95%' },
  { k: 3, exact: normalBetween(-3, 3), taught: 0.997, text: '99.7%' },
]

/** The share of N(μ, σ) within kσ of μ — the empirical rule's exact value. */
export function withinK(k: number): number {
  return normalBetween(-Math.abs(k), Math.abs(k))
}

/** Which kind of normal probability a card asks for. */
export type NormalMode = 'below' | 'above' | 'between' | 'outside' | 'percentile'

export const NORMAL_MODES: readonly NormalMode[] = ['below', 'above', 'between', 'outside', 'percentile']

/** The probability a normal card states, by mode (percentile has none — it states x). */
export function normalProbability(mode: Exclude<NormalMode, 'percentile'>, mu: number, sigma: number, a: number, b: number): number {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  switch (mode) {
    case 'below':
      return normalCdf(a, mu, sigma)
    case 'above':
      return normalCdf(-(a - mu) / sigma)
    case 'between':
      return normalBetween(lo, hi, mu, sigma)
    case 'outside':
      return normalCdf(lo, mu, sigma) + normalCdf(-(hi - mu) / sigma)
  }
}

// ---------------------------------------------------------------------------
// A seeded generator
// ---------------------------------------------------------------------------

export interface Rng {
  /** Uniform on [0, 1). */
  next(): number
  /** A standard normal variate (Box–Muller; two uniforms per call). */
  normal(): number
  /** An integer in [0, n). */
  int(n: number): number
}

/** A seed as the generator reads it: a whole number in [0, 2³²). */
export function cleanSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 1
  return (Math.floor(Math.abs(seed)) >>> 0) || 1
}

/** mulberry32: small, fast, and the same stream for the same seed everywhere. */
export function makeRng(seed: number): Rng {
  let s = cleanSeed(seed)
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    normal(): number {
      let u = next()
      while (u <= 0) u = next()
      const v = next()
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
    },
    int(n: number): number {
      return Math.min(n - 1, Math.floor(next() * n))
    },
  }
}

/** A fresh seed, for a new simulation (the only non-deterministic call here). */
export function freshSeed(): number {
  return (Math.floor(Math.random() * 4294967295) >>> 0) || 1
}

// ---------------------------------------------------------------------------
// Sampling distributions and the margin of error
// ---------------------------------------------------------------------------

/** The standard deviation of the sample mean: σ/√n. */
export function sdOfMean(sigma: number, n: number): number {
  return sigma / Math.sqrt(n)
}

/** The standard deviation of the sample proportion: √(p(1−p)/n). */
export function sdOfProportion(p: number, n: number): number {
  return Math.sqrt((p * (1 - p)) / n)
}

/** z* for confidence C (0.95 → 1.959964…). */
export function zStar(confidence: number): number {
  return invNorm((1 + confidence) / 2)
}

/** The margin of error z*·SD at confidence C. */
export function marginOfError(confidence: number, sd: number): number {
  return zStar(confidence) * sd
}

/** Mean and (population, ÷N) standard deviation of a list. */
export function meanSd(xs: ArrayLike<number>, sample = false): { mean: number; sd: number } {
  const n = xs.length
  if (n === 0) return { mean: NaN, sd: NaN }
  let m = 0
  for (let i = 0; i < n; i++) m += xs[i]
  m /= n
  let ss = 0
  for (let i = 0; i < n; i++) ss += (xs[i] - m) * (xs[i] - m)
  const div = sample ? n - 1 : n
  return { mean: m, sd: div > 0 ? Math.sqrt(ss / div) : 0 }
}

export function mean(xs: ArrayLike<number>): number {
  return meanSd(xs).mean
}

// ---------------------------------------------------------------------------
// Repeated sampling
// ---------------------------------------------------------------------------

export type Population =
  | { kind: 'normal'; mu: number; sigma: number }
  | { kind: 'proportion'; p: number }
  | { kind: 'list'; values: readonly number[] }

export type Statistic = 'mean' | 'proportion'

/** The parameter a population's statistic estimates, and that statistic's SD for samples of n. */
export function theoryOf(pop: Population, stat: Statistic, n: number): { center: number; sd: number } | null {
  if (pop.kind === 'normal') return { center: pop.mu, sd: sdOfMean(pop.sigma, n) }
  if (pop.kind === 'proportion') return { center: pop.p, sd: sdOfProportion(pop.p, n) }
  if (pop.values.length === 0) return null
  if (stat === 'proportion') {
    const p = successShare(pop.values)
    return { center: p, sd: sdOfProportion(p, n) }
  }
  const { mean: m, sd } = meanSd(pop.values)
  return { center: m, sd: sdOfMean(sd, n) }
}

/** In a list, a success is a 1 (a yes / no list is typed as 1s and 0s). */
export function successShare(values: readonly number[]): number {
  if (values.length === 0) return NaN
  let k = 0
  for (const v of values) if (v === 1) k++
  return k / values.length
}

/**
 * `reps` samples of size n from the population, each reduced to its statistic.
 * Sampling from a list is WITH replacement (each draw is any of its values).
 * The same settings and seed give the same numbers, always.
 */
export function simulateSamples(pop: Population, stat: Statistic, n: number, reps: number, seed: number): Float64Array {
  const rng = makeRng(seed)
  const out = new Float64Array(Math.max(0, Math.floor(reps)))
  const size = Math.max(1, Math.floor(n))
  for (let r = 0; r < out.length; r++) {
    let s = 0
    if (pop.kind === 'normal') {
      for (let i = 0; i < size; i++) s += pop.mu + pop.sigma * rng.normal()
    } else if (pop.kind === 'proportion') {
      for (let i = 0; i < size; i++) if (rng.next() < pop.p) s += 1
    } else {
      const vs = pop.values
      if (stat === 'proportion') {
        for (let i = 0; i < size; i++) if (vs[rng.int(vs.length)] === 1) s += 1
      } else {
        for (let i = 0; i < size; i++) s += vs[rng.int(vs.length)]
      }
    }
    out[r] = s / size
  }
  return out
}

// ---------------------------------------------------------------------------
// Comparing two treatments: the randomisation test
// ---------------------------------------------------------------------------

export type Tail = 'two' | 'upper' | 'lower'

/** Is d at least as extreme as the observed difference, in the direction(s) the test looks? */
export function asExtreme(d: number, observed: number, tail: Tail): boolean {
  const eps = 1e-9 * Math.max(1, Math.abs(observed))
  if (tail === 'upper') return d >= observed - eps
  if (tail === 'lower') return d <= observed + eps
  return Math.abs(d) >= Math.abs(observed) - eps
}

export interface RandomizationResult {
  /** mean(A) − mean(B) as the experiment assigned them. */
  observed: number
  /** The difference after each re-randomisation, in order. */
  diffs: Float64Array
  /** How many were at least as extreme as the observed one. */
  extreme: number
  /** extreme / reps. */
  p: number
}

/**
 * Shuffle the labels: pool both groups, deal the first |A| to A and the rest
 * to B (a seeded Fisher–Yates shuffle), and record mean(A) − mean(B) — `reps`
 * times. The p-value is the share at least as extreme as the observed.
 */
export function randomizationTest(
  a: readonly number[],
  b: readonly number[],
  reps: number,
  seed: number,
  tail: Tail = 'two',
): RandomizationResult | null {
  if (a.length === 0 || b.length === 0) return null
  const pool = [...a, ...b]
  const nA = a.length
  const nB = b.length
  const total = pool.reduce((s, v) => s + v, 0)
  const observed = mean(a) - mean(b)
  const rng = makeRng(seed)
  const diffs = new Float64Array(Math.max(0, Math.floor(reps)))
  let extreme = 0
  for (let r = 0; r < diffs.length; r++) {
    // A partial Fisher–Yates: only the first nA places need choosing.
    let sA = 0
    for (let i = 0; i < nA; i++) {
      const j = i + rng.int(pool.length - i)
      const t = pool[i]
      pool[i] = pool[j]
      pool[j] = t
      sA += pool[i]
    }
    const d = sA / nA - (total - sA) / nB
    diffs[r] = d
    if (asExtreme(d, observed, tail)) extreme++
  }
  return { observed, diffs, extreme, p: diffs.length > 0 ? extreme / diffs.length : NaN }
}

/**
 * The EXACT randomisation p-value: every way of choosing which |A| of the
 * pooled values were group A. Only for small groups (C(n, k) ≤ 2·10⁶);
 * null otherwise. The simulated p-value estimates this number.
 */
export function exactRandomizationP(a: readonly number[], b: readonly number[], tail: Tail = 'two'): number | null {
  const pool = [...a, ...b]
  const n = pool.length
  const k = a.length
  if (k === 0 || b.length === 0) return null
  let combos = 1
  for (let i = 0; i < k; i++) combos = (combos * (n - i)) / (i + 1)
  if (combos > 2e6) return null
  const total = pool.reduce((s, v) => s + v, 0)
  const observed = mean(a) - mean(b)
  let extreme = 0
  let count = 0
  const walk = (start: number, left: number, sum: number): void => {
    if (left === 0) {
      count++
      const d = sum / k - (total - sum) / (n - k)
      if (asExtreme(d, observed, tail)) extreme++
      return
    }
    for (let i = start; i <= n - left; i++) walk(i + 1, left - 1, sum + pool[i])
  }
  walk(0, k, 0)
  return extreme / count
}

// ---------------------------------------------------------------------------
// Reading pasted numbers
// ---------------------------------------------------------------------------

/**
 * "12, 15 18\n21; 9.5" → [12, 15, 18, 21, 9.5]. Commas, spaces, semicolons,
 * tabs and new lines all separate; a Unicode minus is a minus. Anything that
 * is not a number is reported by position.
 */
export function parseNumberList(text: string): { values: number[]; bad: string[] } {
  const values: number[] = []
  const bad: string[] = []
  for (const tok of text.replace(/−/g, '-').split(/[\s,;]+/)) {
    if (tok === '') continue
    const v = Number(tok)
    if (Number.isFinite(v)) values.push(v)
    else bad.push(tok)
  }
  return { values, bad }
}

// ---------------------------------------------------------------------------
// Bins
// ---------------------------------------------------------------------------

/** A "nice" step near `raw`: 1, 2, 2.5 or 5 × 10ᵏ. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1
  const e = Math.floor(Math.log10(raw))
  const f = raw / 10 ** e
  const m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return m * 10 ** e
}

/**
 * Equal-width bins over [lo, hi] that start on a multiple of the width, and
 * how many of the first `upto` values fall in each.
 */
export function binCounts(
  values: ArrayLike<number>,
  start: number,
  width: number,
  bins: number,
  upto = values.length,
): number[] {
  const counts = new Array<number>(bins).fill(0)
  const m = Math.min(upto, values.length)
  for (let i = 0; i < m; i++) {
    let k = Math.floor((values[i] - start) / width + 1e-9)
    if (k < 0) k = 0
    if (k >= bins) k = bins - 1
    counts[k]++
  }
  return counts
}

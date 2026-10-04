// ============================================================================
// src/core/univariate.ts — one-variable statistics (NC Math 1 S-ID.1–3).
//
//   SUMMARY     n, mean, median, mode(s), min / max, range, the quartiles, IQR,
//               the population SD σx (÷ n) and the sample SD Sx (÷ (n − 1)),
//               the five-number summary — the numbers a TI-84's 1-Var Stats
//               prints, computed the same way
//   QUARTILES   THE TI-84 / AP METHOD: Q1 is the median of the lower half and
//               Q3 the median of the upper half, where the halves LEAVE OUT the
//               median when n is odd ({1 … 9}: Q1 = 2.5, Q3 = 7.5). Not the
//               "inclusive" or the interpolating spreadsheet QUARTILE methods,
//               which give different numbers for the same list.
//   OUTLIERS    the 1.5·IQR rule: below Q1 − 1.5·IQR or above Q3 + 1.5·IQR
//               (strictly), and the whiskers of the modified box plot (the
//               most extreme values inside the fences)
//   SHAPE       "appears roughly symmetric / skewed right / skewed left" by two
//               simple checks that must not disagree — the mean against the
//               median (in SDs) and the quartile skew (Q3 + Q1 − 2·median)/IQR
//   MEASURES    which centre and spread suit the shape (S-ID.2): the median and
//               IQR for a skewed set or one with outliers, else the mean and SD
//   COMPARING   the sentence comparing two or more sets' centre and spread
//   EXCLUDING   the before / after of leaving values out (S-ID.3) and which
//               measures moved most
//   BINS        a histogram's default bin width, its bins, and a dot plot's
//               stacks
//
// Pure: no DOM, no React. Nothing here is stored.
// ============================================================================

export interface Summary {
  n: number
  /** The values, sorted ascending. */
  sorted: number[]
  mean: number
  sum: number
  median: number
  min: number
  max: number
  range: number
  q1: number
  q3: number
  iqr: number
  /** Population SD (÷ n): the TI's σx. */
  sdPop: number
  /** Sample SD (÷ (n − 1)): the TI's Sx. NaN when n < 2. */
  sdSample: number
  /** Every value with the highest frequency; empty when no value repeats (or every value repeats equally). */
  modes: number[]
  /** How often each mode occurs. */
  modeCount: number
}

/** The median of sorted[lo … hi) (hi exclusive). */
function medianOf(sorted: readonly number[], lo: number, hi: number): number {
  const m = hi - lo
  if (m <= 0) return NaN
  const mid = lo + Math.floor(m / 2)
  return m % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** The median of an already sorted list. */
export function median(sorted: readonly number[]): number {
  return medianOf(sorted, 0, sorted.length)
}

/**
 * Q1 and Q3 by the TI-84 / AP method: the medians of the lower and upper
 * halves, the median itself left out of both halves when n is odd. One value:
 * Q1 = Q3 = that value.
 */
export function quartiles(sorted: readonly number[]): { q1: number; q3: number } {
  const n = sorted.length
  if (n === 0) return { q1: NaN, q3: NaN }
  if (n === 1) return { q1: sorted[0], q3: sorted[0] }
  const half = Math.floor(n / 2)
  return { q1: medianOf(sorted, 0, half), q3: medianOf(sorted, n - half, n) }
}

/** Mean, a Kahan-summed total (so 0.1 + 0.2 + … does not drift). */
function kahanSum(xs: readonly number[]): number {
  let s = 0
  let c = 0
  for (const x of xs) {
    const y = x - c
    const t = s + y
    c = t - s - y
    s = t
  }
  return s
}

/** Mode(s): the most frequent values. None when nothing repeats, or every value is equally frequent. */
export function modesOf(sorted: readonly number[]): { modes: number[]; count: number } {
  if (sorted.length === 0) return { modes: [], count: 0 }
  const runs: { v: number; k: number }[] = []
  for (const v of sorted) {
    const last = runs[runs.length - 1]
    if (last && last.v === v) last.k++
    else runs.push({ v, k: 1 })
  }
  let best = 0
  for (const r of runs) best = Math.max(best, r.k)
  if (best <= 1) return { modes: [], count: 1 }
  const modes = runs.filter((r) => r.k === best).map((r) => r.v)
  // "Every value appears twice" has no mode in the sense a class means —
  // but 5, 5, 5, 5 (one value, every time) has the mode 5.
  if (modes.length === runs.length && runs.length > 1) return { modes: [], count: best }
  return { modes, count: best }
}

/** Everything 1-Var Stats prints. Non-finite values are ignored. */
export function summarize(values: readonly number[]): Summary {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  const n = sorted.length
  if (n === 0) {
    return {
      n: 0, sorted, mean: NaN, sum: 0, median: NaN, min: NaN, max: NaN, range: NaN,
      q1: NaN, q3: NaN, iqr: NaN, sdPop: NaN, sdSample: NaN, modes: [], modeCount: 0,
    }
  }
  const sum = kahanSum(sorted)
  const mean = sum / n
  const ss = kahanSum(sorted.map((x) => (x - mean) * (x - mean)))
  const { q1, q3 } = quartiles(sorted)
  const { modes, count } = modesOf(sorted)
  return {
    n,
    sorted,
    mean,
    sum,
    median: median(sorted),
    min: sorted[0],
    max: sorted[n - 1],
    range: sorted[n - 1] - sorted[0],
    q1,
    q3,
    iqr: q3 - q1,
    sdPop: Math.sqrt(ss / n),
    sdSample: n > 1 ? Math.sqrt(ss / (n - 1)) : NaN,
    modes,
    modeCount: count,
  }
}

/** The five-number summary: min, Q1, median, Q3, max. */
export function fiveNumber(s: Summary): [number, number, number, number, number] {
  return [s.min, s.q1, s.median, s.q3, s.max]
}

// ---------------------------------------------------------------------------
// Outliers: the 1.5·IQR rule and the modified box plot
// ---------------------------------------------------------------------------

export interface Fences {
  lower: number
  upper: number
  /** The outliers, ascending. */
  outliers: number[]
  /** The whiskers' ends: the most extreme values inside the fences. */
  whiskerLo: number
  whiskerHi: number
}

/** Below Q1 − 1.5·IQR or above Q3 + 1.5·IQR (strictly) is an outlier. */
export function fences(s: Summary): Fences {
  if (s.n === 0) return { lower: NaN, upper: NaN, outliers: [], whiskerLo: NaN, whiskerHi: NaN }
  const lower = s.q1 - 1.5 * s.iqr
  const upper = s.q3 + 1.5 * s.iqr
  // A hair of tolerance, so 1.5 × an IQR of 0.3 does not make a fence value an outlier by rounding.
  const tol = 1e-9 * Math.max(1, Math.abs(lower), Math.abs(upper))
  const outliers = s.sorted.filter((v) => v < lower - tol || v > upper + tol)
  const inside = s.sorted.filter((v) => v >= lower - tol && v <= upper + tol)
  return {
    lower,
    upper,
    outliers,
    whiskerLo: inside.length > 0 ? inside[0] : s.min,
    whiskerHi: inside.length > 0 ? inside[inside.length - 1] : s.max,
  }
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

export type ShapeKind = 'symmetric' | 'right' | 'left' | 'few' | 'constant'

export interface Shape {
  kind: ShapeKind
  /** "appears skewed right" — always cautious. */
  words: string
  /** Why: "mean 81.2 > median 78; the upper quartile is farther from the median". */
  reason: string
  /** (mean − median) / Sx. */
  meanMedian: number
  /** (Q3 + Q1 − 2·median) / IQR (0 when the IQR is 0). */
  quartileSkew: number
}

/** The mean–median check: |mean − median| of at least this many SDs is a lean. */
export const SHAPE_MEAN_MEDIAN = 0.15
/** The quartile check: |(Q3 + Q1 − 2·median)/IQR| of at least this is a lean. */
export const SHAPE_QUARTILE = 0.2
/** Either check alone decides only at this strength (the other being neutral). */
const STRONG_MEAN_MEDIAN = 0.3
const STRONG_QUARTILE = 0.4
/** Fewer values than this: no shape is claimed. */
export const SHAPE_MIN_N = 5

const sign = (v: number, t: number): -1 | 0 | 1 => (v > t ? 1 : v < -t ? -1 : 0)

/**
 * The shape in cautious words. Two checks vote: the mean against the median
 * in SDs (the mean is pulled toward a long tail) and the quartile skew (a long
 * tail stretches its quartile away from the median). Both leaning the same way
 * is a skew; one leaning strongly while the other is neutral is a skew; any
 * other combination — including the two disagreeing — is "roughly symmetric".
 */
export function shapeOf(s: Summary, fmt: (v: number) => string = (v) => String(Number(v.toPrecision(4)))): Shape {
  if (s.n < SHAPE_MIN_N) {
    return { kind: 'few', words: 'has too few values to judge its shape', reason: `only ${s.n} value${s.n === 1 ? '' : 's'}`, meanMedian: 0, quartileSkew: 0 }
  }
  const sd = s.sdSample
  if (!(sd > 0)) {
    return { kind: 'constant', words: 'has every value the same', reason: 'no spread at all', meanMedian: 0, quartileSkew: 0 }
  }
  const d = (s.mean - s.median) / sd
  const q = s.iqr > 0 ? (s.q3 + s.q1 - 2 * s.median) / s.iqr : 0
  const a = sign(d, SHAPE_MEAN_MEDIAN)
  const b = sign(q, SHAPE_QUARTILE)
  let dir: -1 | 0 | 1 = 0
  if (a !== 0 && a === b) dir = a
  else if (a !== 0 && b === 0 && Math.abs(d) >= STRONG_MEAN_MEDIAN) dir = a
  else if (b !== 0 && a === 0 && Math.abs(q) >= STRONG_QUARTILE) dir = b
  const rel = s.mean > s.median ? '>' : s.mean < s.median ? '<' : '='
  const mm = `mean ${fmt(s.mean)} ${rel} median ${fmt(s.median)}`
  const lowGap = s.median - s.q1
  const highGap = s.q3 - s.median
  const qWords =
    s.iqr > 0 && Math.abs(highGap - lowGap) > 1e-12
      ? highGap > lowGap
        ? 'Q3 is farther above the median than Q1 is below it'
        : 'Q1 is farther below the median than Q3 is above it'
      : 'the quartiles are evenly spaced about the median'
  if (dir === 1) return { kind: 'right', words: 'appears skewed right', reason: `${mm}; ${qWords}`, meanMedian: d, quartileSkew: q }
  if (dir === -1) return { kind: 'left', words: 'appears skewed left', reason: `${mm}; ${qWords}`, meanMedian: d, quartileSkew: q }
  return { kind: 'symmetric', words: 'appears roughly symmetric', reason: `${mm}; ${qWords}`, meanMedian: d, quartileSkew: q }
}

// ---------------------------------------------------------------------------
// Which measures suit the shape (S-ID.2)
// ---------------------------------------------------------------------------

export type Measures = 'median-iqr' | 'mean-sd'

export interface Recommendation {
  use: Measures
  /** "Use the median and IQR: the distribution appears skewed right, and the median and IQR are resistant to a long tail." */
  sentence: string
}

export function recommend(s: Summary, shape: Shape, f: Fences): Recommendation {
  const out = f.outliers.length
  if (shape.kind === 'right' || shape.kind === 'left' || out > 0) {
    const why =
      out > 0 && (shape.kind === 'right' || shape.kind === 'left')
        ? `it ${shape.words} and has ${out === 1 ? 'an outlier' : `${out} outliers`}`
        : out > 0
          ? `it has ${out === 1 ? 'an outlier' : `${out} outliers`}`
          : `it ${shape.words}`
    return {
      use: 'median-iqr',
      sentence: `Use the median and IQR to describe its center and spread: ${why}, and the median and IQR are resistant to extreme values.`,
    }
  }
  if (shape.kind === 'few' || shape.kind === 'constant' || s.n < 2) {
    return { use: 'median-iqr', sentence: 'With so few values (or no spread), report the median and IQR; the shape cannot be judged.' }
  }
  return {
    use: 'mean-sd',
    sentence: 'Use the mean and standard deviation to describe its center and spread: it appears roughly symmetric with no outliers.',
  }
}

// ---------------------------------------------------------------------------
// Comparing sets (S-ID.2)
// ---------------------------------------------------------------------------

export interface NamedSummary {
  name: string
  s: Summary
  shape: Shape
  fences: Fences
}

/** The measures to compare two or more sets by: the median and IQR as soon as any of them calls for it. */
export function measuresFor(sets: readonly NamedSummary[]): Measures {
  return sets.some((x) => recommend(x.s, x.shape, x.fences).use === 'median-iqr') ? 'median-iqr' : 'mean-sd'
}

const centreOf = (s: Summary, m: Measures): number => (m === 'median-iqr' ? s.median : s.mean)
const spreadOf = (s: Summary, m: Measures): number => (m === 'median-iqr' ? s.iqr : s.sdSample)

/**
 * "Period 2 has a higher median (82 vs 75) and a larger IQR (14 vs 9) than
 * Period 1, so its scores are typically higher and more variable." For three
 * or more sets, the highest and lowest of each. Empty sets are left out.
 */
export function compareSentence(sets: readonly NamedSummary[], fmt: (v: number) => string): string {
  const live = sets.filter((x) => x.s.n > 0)
  if (live.length < 2) return ''
  const m = measuresFor(live)
  const cName = m === 'median-iqr' ? 'median' : 'mean'
  const sName = m === 'median-iqr' ? 'IQR' : 'standard deviation'
  const why = m === 'median-iqr' ? 'the median and IQR, since at least one set is skewed or has outliers' : 'the mean and standard deviation, since every set appears roughly symmetric with no outliers'
  if (live.length === 2) {
    const [a, b] = live
    const ca = centreOf(a.s, m)
    const cb = centreOf(b.s, m)
    const sa = spreadOf(a.s, m)
    const sb = spreadOf(b.s, m)
    // The subject is the set with the higher centre (the second on a tie).
    const [X, Y, cx, cy, sx, sy] = ca > cb ? [a, b, ca, cb, sa, sb] : [b, a, cb, ca, sb, sa]
    const eq = (u: number, v: number): boolean => Math.abs(u - v) <= 1e-9 * Math.max(1, Math.abs(u), Math.abs(v))
    const centre = eq(cx, cy) ? `the same ${cName} (${fmt(cx)})` : `a higher ${cName} (${fmt(cx)} vs ${fmt(cy)})`
    const spread = eq(sx, sy)
      ? `the same ${sName} (${fmt(sx)})`
      : `a ${sx > sy ? 'larger' : 'smaller'} ${sName} (${fmt(sx)} vs ${fmt(sy)})`
    const higher = !eq(cx, cy)
    const vary = eq(sx, sy) ? null : sx > sy ? 'more variable' : 'more consistent'
    const tail =
      higher && vary
        ? `its values are typically higher and ${vary}`
        : higher
          ? 'its values are typically higher, with the same spread'
          : vary
            ? `typical values are the same, but ${X.name}’s are ${vary}`
            : 'the two sets have the same center and spread'
    return `${X.name} has ${centre} and ${spread} than ${Y.name}: ${tail}. (Compared by ${why}.)`
  }
  const by = (f: (x: NamedSummary) => number) => live.slice().sort((p, q) => f(q) - f(p))
  const c = by((x) => centreOf(x.s, m))
  const s = by((x) => spreadOf(x.s, m))
  const list = (xs: NamedSummary[], f: (x: NamedSummary) => number) => xs.map((x) => `${x.name} ${fmt(f(x))}`).join(' > ')
  return `${cName[0].toUpperCase()}${cName.slice(1)}s from highest: ${list(c, (x) => centreOf(x.s, m))}. ${sName === 'IQR' ? 'IQRs' : 'Standard deviations'} from largest: ${list(s, (x) => spreadOf(x.s, m))}. ${c[0].name} has the highest typical values and ${s[0].name} the most variable. (Compared by ${why}.)`
}

// ---------------------------------------------------------------------------
// Leaving values out (S-ID.3)
// ---------------------------------------------------------------------------

export type EffectMeasure = 'mean' | 'median' | 'sd' | 'iqr'

export interface Effect {
  before: Summary
  after: Summary
  removed: number[]
  rows: { key: EffectMeasure; label: string; before: number; after: number; change: number }[]
  /** The measures, most moved first (change relative to the SD before). */
  ranked: EffectMeasure[]
  sentence: string
}

const EFFECT_LABEL: Record<EffectMeasure, string> = { mean: 'mean', median: 'median', sd: 'SD (Sx)', iqr: 'IQR' }

/**
 * Before and after leaving out the values whose `keep` entry is false. The
 * measures are ranked by how far they moved relative to the SD before, and
 * the sentence says which moved most.
 */
export function exclusionEffect(values: readonly number[], keep: readonly boolean[], fmt: (v: number) => string): Effect {
  const before = summarize(values)
  const kept: number[] = []
  const removed: number[] = []
  values.forEach((v, i) => (keep[i] === false ? removed.push(v) : kept.push(v)))
  const after = summarize(kept)
  const pick = (s: Summary, k: EffectMeasure): number => (k === 'mean' ? s.mean : k === 'median' ? s.median : k === 'sd' ? s.sdSample : s.iqr)
  const keys: EffectMeasure[] = ['mean', 'median', 'sd', 'iqr']
  const rows = keys.map((key) => {
    const b = pick(before, key)
    const a = pick(after, key)
    return { key, label: EFFECT_LABEL[key], before: b, after: a, change: a - b }
  })
  const scale = before.sdSample > 0 ? before.sdSample : 1
  const size = (k: EffectMeasure): number => {
    const c = rows.find((r) => r.key === k)!.change
    return Number.isFinite(c) ? Math.abs(c) / scale : Infinity
  }
  const ranked = keys.slice().sort((p, q) => size(q) - size(p))
  let sentence = ''
  if (removed.length === 0) {
    sentence = 'Nothing is left out.'
  } else if (after.n === 0) {
    sentence = 'Every value is left out: there is nothing to summarize.'
  } else {
    const what = removed.length === 1 ? fmt(removed[0]) : `${removed.length} values (${removed.slice(0, 4).map(fmt).join(', ')}${removed.length > 4 ? ', …' : ''})`
    /** "raised the mean from 74.2 to 76", "left the median at 77", "made the SD (Sx) undefined". */
    const moved = (k: EffectMeasure): string => {
      const r = rows.find((x) => x.key === k)!
      if (!Number.isFinite(r.after)) return `made the ${r.label} undefined`
      if (Math.abs(r.change) <= 1e-9 * Math.max(1, Math.abs(r.before))) return `left the ${r.label} at ${fmt(r.before)}`
      return `${r.change > 0 ? 'raised' : 'lowered'} the ${r.label} from ${fmt(r.before)} to ${fmt(r.after)}`
    }
    const [first, second] = ranked
    const still = ranked.slice(2).filter((k) => size(k) < 0.1)
    const stillText = still.length > 0 ? ` The ${still.map((k) => EFFECT_LABEL[k]).join(' and ')} barely moved.` : ''
    const resistant =
      (first === 'mean' || first === 'sd') && (second === 'mean' || second === 'sd')
        ? ' The mean and SD are not resistant to extreme values; the median and IQR are.'
        : ''
    const most = size(first) > 1e-12 ? ` The ${EFFECT_LABEL[first]} moved most.` : ''
    sentence = `Leaving out ${what} ${moved(first)} and ${moved(second)}.${stillText}${most}${resistant}`
  }
  return { before, after, removed, rows, ranked, sentence }
}

// ---------------------------------------------------------------------------
// Bins and stacks
// ---------------------------------------------------------------------------

/** The "nice" number (1, 2, 2.5 or 5 × 10ᵏ) NEAREST to raw on a log scale. */
export function niceNearest(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1
  const e = Math.floor(Math.log10(raw))
  let best = 1
  let bestD = Infinity
  for (const k of [e - 1, e, e + 1]) {
    for (const m of [1, 2, 2.5, 5]) {
      const c = m * 10 ** k
      const d = Math.abs(Math.log(c / raw))
      if (d < bestD - 1e-12) {
        bestD = d
        best = c
      }
    }
  }
  return Number(best.toPrecision(12))
}

/** The default bin width: about Sturges' number of bins (5 to 12), rounded to a nice width. */
export function defaultBinWidth(values: readonly number[]): number {
  const s = summarize(values)
  if (s.n === 0) return 1
  // Every value the same: a tenth of it, or 1 when it is 0 (never 10⁻⁹).
  if (!(s.range > 0)) return s.min !== 0 ? niceNearest(Math.abs(s.min) * 0.1) : 1
  const k = Math.min(12, Math.max(5, Math.ceil(Math.log2(s.n) + 1)))
  let w = niceNearest(s.range / k)
  // whole-number data gets whole-number bins
  if (s.sorted.every((v) => Number.isInteger(v)) && w < 1) w = 1
  return w
}

/** The most bins a histogram draws; a typed width that would make more is widened (see histogramWidth). */
export const MAX_HIST_BINS = 200

/** The smallest "nice" number (1, 2, 2.5 or 5 × 10ᵏ) at or above raw. */
export function niceAtLeast(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1
  const e = Math.floor(Math.log10(raw))
  for (const k of [e - 1, e, e + 1]) {
    for (const m of [1, 2, 2.5, 5]) {
      const c = Number((m * 10 ** k).toPrecision(12))
      if (c >= raw * (1 - 1e-12)) return c
    }
  }
  return Number((10 ** (e + 1)).toPrecision(12))
}

/**
 * The width a histogram actually draws with, and why when it is not the one
 * asked for: a width that would cut the data into more than MAX_HIST_BINS
 * bins (0.001 over a range of 100) is widened to the smallest nice width
 * that fits, and said so, instead of the plot going blank.
 */
export function histogramWidth(values: readonly number[], width: number): { width: number; note: string | null } {
  const xs = values.filter((v) => Number.isFinite(v))
  const w = width > 0 && Number.isFinite(width) ? width : 1
  if (xs.length === 0) return { width: w, note: null }
  let lo = Infinity
  let hi = -Infinity
  for (const v of xs) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  const bins = Math.floor((hi - lo) / w) + 2
  if (bins <= MAX_HIST_BINS) return { width: w, note: null }
  const wide = niceAtLeast((hi - lo) / (MAX_HIST_BINS - 2))
  const fmt = (v: number): string => String(Number(v.toPrecision(6)))
  return {
    width: wide,
    note: `A bin width of ${fmt(w)} would make about ${Math.round((hi - lo) / w).toLocaleString('en-US')} bins: drawn with width ${fmt(wide)} instead.`,
  }
}

export interface Bins {
  start: number
  width: number
  counts: number[]
}

/**
 * Equal bins [start + k·w, start + (k+1)·w) — the TI-84's convention: a value
 * on an edge counts in the bin to its right — starting on a multiple of the
 * width at or below the smallest value.
 */
export function histogramBins(values: readonly number[], width: number, from?: number): Bins {
  const xs = values.filter((v) => Number.isFinite(v))
  const w = width > 0 && Number.isFinite(width) ? width : 1
  if (xs.length === 0) return { start: 0, width: w, counts: [] }
  let lo = Infinity
  let hi = -Infinity
  for (const v of xs) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  const base = from ?? lo
  const start = Number((Math.floor(base / w + 1e-9) * w).toPrecision(12))
  const idx = (v: number): number => Math.floor((v - start) / w + 1e-9)
  const bins = Math.max(1, idx(hi) + 1)
  if (bins > 5000) return { start, width: w, counts: [] }
  const counts = new Array<number>(bins).fill(0)
  for (const v of xs) {
    const k = idx(v)
    if (k >= 0 && k < bins) counts[k]++
  }
  return { start, width: w, counts }
}

/** The step a dot plot stacks at: the data's own resolution when it is fine enough, else about 1/60 of the range. */
export function dotStep(values: readonly number[]): number {
  const xs = values.filter((v) => Number.isFinite(v))
  if (xs.length === 0) return 1
  const s = summarize(xs)
  const range = s.range
  let decimals = 0
  for (const v of xs) {
    const t = String(Number(v.toPrecision(10)))
    const m = /\.(\d+)$/.exec(t)
    if (m) decimals = Math.max(decimals, m[1].length)
    if (/e/i.test(t)) decimals = 10
  }
  const res = 10 ** -Math.min(decimals, 10)
  if (!(range > 0)) return res
  if (range / res <= 80) return res
  return niceNearest(range / 60)
}

/** Dot-plot stacks: the values grouped to the step, where each stack sits, and the indices in it, ascending. */
export function dotStacks(values: readonly number[], step: number): { at: number; idx: number[] }[] {
  const map = new Map<number, number[]>()
  values.forEach((v, i) => {
    if (!Number.isFinite(v)) return
    const k = Math.round(v / step)
    const list = map.get(k)
    if (list) list.push(i)
    else map.set(k, [i])
  })
  // A stack sits at its values' own mean (exactly the value when they are equal), not at the rounded step.
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, idx]) => ({ at: Number((idx.reduce((t, i) => t + values[i], 0) / idx.length).toPrecision(12)), idx }))
}

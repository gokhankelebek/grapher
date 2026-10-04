// ============================================================================
// src/core/valueTable.ts — the table of values for any y = f(x), the way NC
// Math 1–3 asks about it.
//
//   tableXs(spec)                    x from a start by a step for n rows, or a
//                                    typed list (exact text: 0.5, π/6, −1/3)
//   valueTable(f, xs, opts?)         f(x) exact where exact, else decimals,
//                                    with Δy, Δ²y, the ratios y₍ₙ₊₁₎/yₙ and the
//                                    average rate of change over each interval
//   tablePattern(table, f)           "Δy is constant (3): linear", "Δ²y is
//                                    constant (4): quadratic", "the ratio is
//                                    constant (2): exponential" — or nothing
//   scanCrossings(gap, xs)           where f and g cross (a sign change
//                                    where they MEET — never a pole) and
//                                    where they touch; "for good" is
//                                    decided from growth classes
//                                    (src/core/growth.ts) by the caller
//   overtake(f, g, from)             the crossings on [from, 1000]
//   polynomialCoeffs(f)              the coefficients when f IS a polynomial
//   syntheticDivision(coeffs, a)     the Remainder Theorem's tableau, exact
//                                    with a fractional a
//
// NEVER OVER-CLAIM. A table only samples f, and a sample can lie: sin x at
// 0, π, 2π has Δy = 0 every time. So a pattern is stated only when f ITSELF
// agrees with it — the line, parabola or exponential the table implies is
// checked against f at x's the table never visited (between its rows and
// beyond its ends). A cubic shows no Δ³ column, so it is never named at all.
//
// Pure: no React, no DOM.
// ============================================================================

import type { ExactForm } from './exact'
import { exactForm, verifiedExact } from './exact'
import { tableNumber } from './limits'

const MINUS = '−'

// ---------------------------------------------------------------------------
// Numbers, the way a table prints them
// ---------------------------------------------------------------------------

/** One printed value. */
export interface Cell {
  v: number
  /** "4.375", "√2", "1/3", "0.3333333", "undefined" */
  text: string
  /** The same in LaTeX. */
  tex: string
  /** The text IS the value (a closed form, an integer or a short decimal). */
  exact: boolean
}

/** Places a decimal may have and still be "the value" rather than a rounding. */
const SHORT_PLACES = 4
/**
 * Slack for "this double is that short decimal": the rounding a few
 * operations leave (0.1 + 0.2), never a real difference — 1000000.0005 is
 * not 1000000. Relative to |v| in units of the double's own precision, with a
 * tiny absolute floor near 0.
 */
const shortTol = (v: number): number => Math.max(1e-13, 256 * Number.EPSILON * Math.abs(v))

/** The decimal places of v when it is a short decimal (≤ 4 places), else null. */
export function shortPlaces(v: number): number | null {
  if (!Number.isFinite(v)) return null
  if (Number.isInteger(v)) return 0
  if (Math.abs(v) >= 1e9) return null
  for (let p = 0; p <= SHORT_PLACES; p++) {
    const f = Math.pow(10, p)
    const t = Math.round(v * f) / f
    if (Math.abs(t - v) <= shortTol(v)) return p
  }
  return null
}

const withMinus = (s: string): string => (s.startsWith('-') ? MINUS + s.slice(1) : s)

/** A printed value: an integer or a short decimal, a closed form, else seven significant digits. */
export function cell(v: number): Cell {
  if (Number.isNaN(v)) return { v, text: 'undefined', tex: '\\text{undefined}', exact: true }
  // An overflow, not a value (a pole or ln 0 is undefined, and the evaluator
  // says so with NaN before it gets here).
  if (v === Infinity) return { v, text: 'too large', tex: '\\text{too large}', exact: false }
  if (v === -Infinity) return { v, text: `too large (${MINUS})`, tex: '\\text{too large }(-)', exact: false }
  if (v === 0 || Math.abs(v) < 1e-13) return { v: 0, text: '0', tex: '0', exact: true }
  if (Number.isInteger(v)) {
    // Every integer a double holds exactly prints as itself; past 2⁵³ the
    // double is a rounding, so it is a decimal (≈) in scientific form.
    if (Number.isSafeInteger(v)) return { v, text: withMinus(String(v)), tex: String(v), exact: true }
    const t = tableNumber(v)
    return { v, text: t, tex: t.replace(/−/g, '-').replace(/e\+?(-?\d+)$/, '\\times 10^{$1}'), exact: false }
  }
  const p = shortPlaces(v)
  if (p !== null) {
    const s = (Math.round(v * Math.pow(10, p)) / Math.pow(10, p)).toFixed(p)
    return { v, text: withMinus(s), tex: s, exact: true }
  }
  const ex = exactForm(v)
  if (ex) return { v, text: ex.text, tex: ex.tex, exact: true }
  const t = tableNumber(v)
  return { v, text: t, tex: t.replace(/−/g, '-').replace(/e(-?\d+)$/, '\\times 10^{$1}'), exact: false }
}

/** The parser's spelling of a printed value: "−π/6" → "-pi/6", "2√3/3" → "2sqrt(3)/3". */
export function parserText(text: string): string {
  return text
    .replace(/−/g, '-')
    .replace(/π/g, 'pi')
    .replace(/√(\d+)/g, 'sqrt($1)')
    .replace(/√\(/g, 'sqrt(')
}

// ---------------------------------------------------------------------------
// The x column
// ---------------------------------------------------------------------------

export const TABLE_N_MIN = 2
export const TABLE_N_MAX = 25
export const TABLE_N_DEFAULT = 6

export type TableXSpec =
  | { mode: 'step'; start: number; step: number; n: number; exactStep?: boolean }
  | { mode: 'list'; list: number[] }

/**
 * The x's. A start and step that are decimals are snapped to twelve
 * significant digits, so 0.1 · 3 is 0.3 (not 0.30000000000000004) and f is
 * evaluated at the number the table prints. π-steps are left as they are —
 * snapping would move π/2 off itself.
 */
export function tableXs(spec: TableXSpec): number[] {
  if (spec.mode === 'list') return spec.list.filter((x) => Number.isFinite(x))
  const n = Math.max(TABLE_N_MIN, Math.min(TABLE_N_MAX, Math.round(spec.n)))
  if (!Number.isFinite(spec.start) || !Number.isFinite(spec.step) || spec.step === 0) return []
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const x = spec.start + i * spec.step
    if (spec.exactStep === false) {
      out.push(x)
      continue
    }
    // Snap only what is floating residue: at x = 10¹⁵ with step 1, twelve
    // digits would merge every row into one.
    const snapped = Number(x.toPrecision(12))
    out.push(Math.abs(snapped - x) <= 1e-6 * Math.abs(spec.step) ? snapped : x)
  }
  return out
}

/** True when the typed text names a multiple of π (or a root) — leave such x's unsnapped. */
export function irrationalText(text: string): boolean {
  return /π|pi|√|sqrt|e\b/i.test(text)
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

export interface ValueTable {
  xs: number[]
  x: Cell[]
  y: Cell[]
  /** Δy between row i and row i + 1 (length n − 1). */
  d1: Cell[]
  /** Δ²y (length n − 2). */
  d2: Cell[]
  /** y₍ᵢ₊₁₎ / yᵢ (length n − 1); undefined where yᵢ = 0. */
  ratio: Cell[]
  /** Average rate of change over [xᵢ, xᵢ₊₁] (length n − 1). */
  avg: Cell[]
  /** The x's are equally spaced: Δy and Δ²y say something about the function. */
  equal: boolean
  /** The common step when `equal`. */
  h: number | null
}

/** y at x, exactly when the caller can certify it (ModelSpec.evalExact), else f(x). */
export type Evaluator = (x: number) => number

function equalSpacing(xs: readonly number[]): number | null {
  if (xs.length < 2) return null
  const h = xs[1] - xs[0]
  if (!Number.isFinite(h) || h === 0) return null
  const tol = 1e-9 * Math.max(1, Math.abs(h), ...xs.map(Math.abs))
  for (let i = 1; i < xs.length - 1; i++) if (Math.abs(xs[i + 1] - xs[i] - h) > tol) return null
  return h
}

/**
 * A difference that should have cancelled to zero, snapped: 3 − 3 is 0. Only
 * rounding residue is snapped — a few units of the doubles' own precision at
 * the size of the values — never a real difference: 10⁷ + 0.001 − 10⁷ is 0.001.
 */
function tidy(v: number, scale: number): number {
  if (!Number.isFinite(v)) return v
  if (Math.abs(v) <= 4 * Number.EPSILON * Math.max(1, scale)) return 0
  return v
}

/**
 * b − a for two values the table prints as short decimals, taken as those
 * decimals: (10⁷ + 0.004) − (10⁷ + 0.001) is 0.003, not the 0.0030000005 the
 * doubles leave. Anything else is the plain difference.
 */
function decimalDiff(a: number, b: number, d: number): number {
  const pa = shortPlaces(a)
  const pb = shortPlaces(b)
  if (pa === null || pb === null || !Number.isFinite(d)) return d
  const f = Math.pow(10, Math.max(pa, pb))
  return Math.round(d * f) / f
}

export function valueTable(f: Evaluator, xs: readonly number[]): ValueTable {
  const ys = xs.map((x) => {
    try {
      const v = f(x)
      return typeof v === 'number' ? v : Number.NaN
    } catch {
      return Number.NaN
    }
  })
  const scale = Math.max(1, ...ys.filter(Number.isFinite).map(Math.abs))
  const d1v: number[] = []
  const ratiov: number[] = []
  const avgv: number[] = []
  for (let i = 0; i + 1 < ys.length; i++) {
    const d = tidy(decimalDiff(ys[i], ys[i + 1], ys[i + 1] - ys[i]), scale)
    d1v.push(d)
    ratiov.push(ys[i] === 0 || !Number.isFinite(ys[i]) ? Number.NaN : ys[i + 1] / ys[i])
    const dx = xs[i + 1] - xs[i]
    avgv.push(dx === 0 ? Number.NaN : tidy(d / dx, scale / Math.max(1e-12, Math.abs(dx))))
  }
  const d2v: number[] = []
  for (let i = 0; i + 1 < d1v.length; i++) d2v.push(tidy(decimalDiff(d1v[i], d1v[i + 1], d1v[i + 1] - d1v[i]), scale))
  const h = equalSpacing(xs)
  return {
    xs: xs.slice(),
    x: xs.map(cell),
    y: ys.map(cell),
    d1: d1v.map(cell),
    d2: d2v.map(cell),
    ratio: ratiov.map(cell),
    avg: avgv.map(cell),
    equal: h !== null,
    h,
  }
}

// ---------------------------------------------------------------------------
// The pattern note
// ---------------------------------------------------------------------------

export type PatternKind = 'linear' | 'quadratic' | 'exponential'

export interface TablePattern {
  kind: PatternKind
  /** The constant: Δy, Δ²y or the ratio. */
  value: Cell
  /** "Δy is constant (3): linear". */
  text: string
}

/**
 * All finite and equal to the first. The slack is relative to the values
 * THEMSELVES (the differences being compared), plus the rounding the values
 * they were taken from can leave (`scale`, their size) — never relative to
 * that size alone: Δy of 0.001, 0.003, 0.005 at y ≈ 10⁷ are not constant.
 */
function constant(vals: readonly number[], scale: number): boolean {
  if (vals.length === 0 || !vals.every(Number.isFinite)) return false
  const big = Math.max(...vals.map(Math.abs))
  const tol = 1e-9 * big + 64 * Number.EPSILON * Math.max(1, scale)
  return vals.every((v) => Math.abs(v - vals[0]) <= tol)
}

/**
 * Does f agree with `model` away from the table's rows? Midpoints, points
 * off the grid and just past both ends. Points where f is undefined are not
 * evidence either way, but at least two must be checked and every one agree.
 */
function agrees(f: Evaluator, model: (x: number) => number, xs: readonly number[], h: number): boolean {
  const x0 = xs[0]
  const xn = xs[xs.length - 1]
  const far = 10 * Math.max(1, Math.abs(x0), Math.abs(xn))
  const probes = [
    x0 + 0.5 * h,
    x0 + 1.37 * h,
    (x0 + xn) / 2 + 0.29 * h,
    xn - 0.41 * h,
    xn + 0.63 * h,
    x0 - 0.83 * h,
    // far from the rows on both sides: |x| agrees with a line on 1 … 6
    x0 - 5.3 * h,
    x0 - 50.7 * h,
    xn + 50.3 * h,
    -far - 0.37,
    far + 0.41,
  ]
  let checked = 0
  for (const x of probes) {
    let y: number
    try {
      y = f(x)
    } catch {
      continue
    }
    if (!Number.isFinite(y)) continue
    const m = model(x)
    if (!Number.isFinite(m)) return false
    if (Math.abs(y - m) > 1e-7 * Math.max(1, Math.abs(y), Math.abs(m))) return false
    checked++
  }
  return checked >= 2
}

/**
 * What f IS, read off its formula (src/core/growth.ts) — what certifies a
 * pattern for the function rather than for the rows: `degree` the polynomial's
 * true degree (null: not a polynomial), `exponential` exactly c·bˣ.
 */
export interface TableStructure {
  degree: number | null
  exponential: boolean
}

/**
 * What the table shows — only when it is so, and only when f agrees.
 * Linear before quadratic before exponential (a constant Δy is also a
 * constant Δ²y of 0, and a constant function has ratio 1).
 *
 * `structure` is what f is (see TableStructure): a pattern is then named
 * only when f's formula IS that kind of function — |x| on 1 … 6 has a
 * constant Δy, but |x| is not linear. `null`: f's formula cannot be read
 * (a piecewise, a sketch), so nothing is named. Absent: the numeric checks
 * alone (rows, plus f between and far beyond them).
 */
export function tablePattern(t: ValueTable, f: Evaluator, structure?: TableStructure | null): TablePattern | null {
  if (structure === null) return null
  if (!t.equal || t.h === null || t.xs.length < 3) return null
  const ys = t.y.map((c) => c.v)
  if (!ys.every(Number.isFinite)) return null
  const scale = Math.max(1, ...ys.map(Math.abs))
  const h = t.h
  const x0 = t.xs[0]
  const d1 = t.d1.map((c) => c.v)
  if (constant(d1, scale)) {
    if (structure && !(structure.degree !== null && structure.degree <= 1)) return null
    const m = d1[0] / h
    if (!agrees(f, (x) => ys[0] + m * (x - x0), t.xs, h)) return null
    const value = cell(d1[0])
    const what = d1[0] === 0 ? 'linear (a constant function)' : 'linear'
    return { kind: 'linear', value, text: `Δy is constant (${value.text}): ${what}` }
  }
  const d2 = t.d2.map((c) => c.v)
  if (t.xs.length >= 4 && constant(d2, scale) && d2[0] !== 0) {
    if (structure && structure.degree !== 2) return null
    // Newton's form through the first three rows.
    const a1 = d1[0] / h
    const a2 = d2[0] / (2 * h * h)
    const model = (x: number): number => ys[0] + a1 * (x - x0) + a2 * (x - x0) * (x - x0 - h)
    if (!agrees(f, model, t.xs, h)) return null
    const value = cell(d2[0])
    return { kind: 'quadratic', value, text: `Δ²y is constant (${value.text}): quadratic` }
  }
  const r = t.ratio.map((c) => c.v)
  if (constant(r, Math.max(1, Math.abs(r[0]))) && r[0] > 0 && Math.abs(r[0] - 1) > 1e-9) {
    if (structure && !structure.exponential) return null
    const b = r[0]
    const model = (x: number): number => ys[0] * Math.pow(b, (x - x0) / h)
    if (!agrees(f, model, t.xs, h)) return null
    const value = cell(b)
    return { kind: 'exponential', value, text: `the ratio is constant (${value.text}): exponential` }
  }
  return null
}

// ---------------------------------------------------------------------------
// Overtaking: F-LE.3
// ---------------------------------------------------------------------------

export interface Overtake {
  /** Who is ahead after the last crossing: 'f' or 'g'. */
  leader: 'f' | 'g'
  /** The last crossing in [from, to], or null when one was ahead the whole way. */
  x: number | null
  exact: ExactForm | null
  /** Every crossing found in [from, to], ascending. */
  crossings: number[]
  /** Where they touch without crossing (x² and 2x − 1 at x = 1), ascending. */
  touches: number[]
  /** How far the comparison was checked. */
  to: number
}

/**
 * f − g at one x: its sign, and its size relative to max(1, |f|, |g|) — so a
 * sign change is a crossing only where the two values actually meet, not
 * across a pole (1/(x − 3) jumps from −∞ to +∞ past y = 1).
 */
export interface Gap {
  s: number
  rel: number
}

export type GapFn = (x: number) => Gap | null

/** f − g from plain values; null where either is undefined. */
export function plainGap(f: Evaluator, g: Evaluator): GapFn {
  return (x: number): Gap | null => {
    let a: number
    let b: number
    try {
      a = f(x)
      b = g(x)
    } catch {
      return null
    }
    if (Number.isNaN(a) || Number.isNaN(b)) return null
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      if (a === b) return null
      return { s: a > b ? 1 : -1, rel: 1 }
    }
    const d = a - b
    const rel = Math.abs(d) / Math.max(1, Math.abs(a), Math.abs(b))
    // below the doubles' resolution the sign of a − b is rounding, not order
    return { s: rel <= GAP_RESOLUTION ? 0 : Math.sign(d), rel }
  }
}

/** A relative difference this small is the doubles' rounding: no sign. */
export const GAP_RESOLUTION = 16 * Number.EPSILON

/** A bisected sign change is a crossing only when f and g agree there to this (relative) size. */
export const CROSS_TOL = 1e-6
/** A local minimum of |f − g| this small (relative) is a touch. */
export const TOUCH_TOL = 1e-12

export interface CrossScan {
  crossings: number[]
  touches: number[]
  /**
   * Where f − g changes sign WITHOUT f and g meeting: across a pole
   * (1/x at 0) or a gap in the domain. The leader changes there, but they
   * do not cross.
   */
  flips: number[]
  /** The sign of f − g at the last sample where it was defined and nonzero (NaN: never). */
  lastS: number
  /** Where that last sign began: the last crossing or flip, else the first defined sample. */
  settled: number
  settledBy: 'cross' | 'flip' | 'start'
  /** The first and the last x where both were defined. */
  first: number
  reach: number
}

/**
 * The crossings and touches of f and g over the sample x's (ascending): every
 * sign change of f − g between neighbouring samples is bisected and kept only
 * when f and g meet there (|f − g| ≤ CROSS_TOL, relative) — a pole or a jump
 * changes sign without meeting, and is a flip. Where |f − g| dips toward 0
 * without changing sign, the dip is refined and kept as a touch when it
 * reaches TOUCH_TOL and is sharp (far below its neighbours, not a level of
 * rounding noise). An undefined sample breaks the run: nothing is bisected
 * across a gap, and a sign that differs on its far side is a flip.
 */
export function scanCrossings(gap: GapFn, xs: readonly number[]): CrossScan {
  const crossings: number[] = []
  const touches: number[] = []
  const flips: number[] = []
  const events: { x: number; by: 'cross' | 'flip' }[] = []
  let lastS = Number.NaN
  let first = Number.NaN
  let reach = Number.NaN
  type S = { x: number; s: number; rel: number }
  let run: S[] = []
  const bisect = (a: S, b: S): void => {
    let lo = a.x
    let hi = b.x
    let broken = false
    for (let k = 0; k < 90; k++) {
      const mid = (lo + hi) / 2
      if (mid === lo || mid === hi) break
      const gm = gap(mid)
      if (!gm) {
        broken = true // undefined inside: a gap in the domain, not a crossing
        break
      }
      if (gm.s === 0) {
        lo = hi = mid
        break
      }
      if (gm.s === a.s) lo = mid
      else hi = mid
    }
    const x = (lo + hi) / 2
    // Agreement where they "cross": both sides of the bracket, and the middle.
    const ends = broken ? [] : [gap(lo), gap(hi), gap(x)].filter((v): v is Gap => v !== null)
    if (ends.length === 0 || Math.min(...ends.map((v) => v.rel)) > CROSS_TOL) {
      flips.push(x)
      events.push({ x, by: 'flip' })
      return
    }
    crossings.push(x)
    events.push({ x, by: 'cross' })
  }
  const touchNear = (a: S, m: S, b: S): void => {
    // Golden-section search for the smallest |f − g| on [a, b].
    let lo = a.x
    let hi = b.x
    const R = (Math.sqrt(5) - 1) / 2
    let c = hi - R * (hi - lo)
    let d = lo + R * (hi - lo)
    const at = (x: number): number => {
      const v = gap(x)
      return v && v.s !== -m.s ? v.rel : Infinity
    }
    let fc = at(c)
    let fd = at(d)
    for (let k = 0; k < 80 && hi - lo > 1e-15 * Math.max(1, Math.abs(lo)); k++) {
      if (fc <= fd) {
        hi = d
        d = c
        fd = fc
        c = hi - R * (hi - lo)
        fc = at(c)
      } else {
        lo = c
        c = d
        fc = fd
        d = lo + R * (hi - lo)
        fd = at(d)
      }
    }
    const x = fc <= fd ? c : d
    const best = Math.min(fc, fd, m.rel)
    if (best <= TOUCH_TOL && best <= 1e-6 * Math.min(a.rel, b.rel)) touches.push(best === m.rel ? m.x : x)
  }
  let prevS = 0 // the last nonzero sign of the previous run
  let lastDefined = Number.NaN // the last defined x before a gap
  let gapXs: number[] = [] // the undefined samples of the current gap
  const flush = (): void => {
    if (run.length === 0) return
    // Zeros that are only rounding (|f − g| was already at the doubles'
    // resolution beside them, as for x² + 3x and x² + 2x at x = 10¹⁶) say
    // nothing: they are left out, and the signs around them decide.
    const quiet = (k: number): boolean => k < 0 || k >= run.length || run[k].rel < 1e-9
    const kept: S[] = []
    for (let i = 0; i < run.length; i++) {
      if (run[i].s !== 0) {
        kept.push(run[i])
        continue
      }
      let j = i
      while (j + 1 < run.length && run[j + 1].s === 0) j++
      if (!(quiet(i - 1) && quiet(j + 1))) for (let k = i; k <= j; k++) kept.push(run[k])
      i = j
    }
    run = kept
    if (run.length === 0) return
    // a sign that differs across a gap in the domain: a point the formula
    // leaves out (1/x at 0) is the flip; a wide gap, where the run resumes
    const firstS = run.find((r) => r.s !== 0)
    if (firstS && prevS !== 0 && firstS.s !== prevS) {
      const x = gapXs.length > 0 && gapXs.length <= 2 ? gapXs[Math.floor((gapXs.length - 1) / 2)] : run[0].x
      flips.push(x)
      events.push({ x, by: 'flip' })
    }
    // zeros ON a sample: a crossing when the sign changes across them, else a touch
    for (let i = 0; i < run.length; i++) {
      if (run[i].s !== 0) continue
      let j = i
      while (j + 1 < run.length && run[j + 1].s === 0) j++
      const before = i > 0 ? run[i - 1].s : 0
      const after = j + 1 < run.length ? run[j + 1].s : 0
      const x = run[Math.floor((i + j) / 2)].x
      if (before !== 0 && after !== 0 && before !== after) {
        crossings.push(x)
        events.push({ x, by: 'cross' })
      } else touches.push(x)
      i = j
    }
    let lastNZ: S | null = null
    for (let i = 0; i < run.length; i++) {
      const b = run[i]
      if (b.s === 0) continue
      if (lastNZ && lastNZ.s !== b.s && i > 0 && run[i - 1].s !== 0) bisect(run[i - 1], b)
      lastNZ = b
      if (i >= 1 && i + 1 < run.length) {
        const a = run[i - 1]
        const c = run[i + 1]
        if (a.s === b.s && b.s === c.s && b.rel < a.rel && b.rel <= c.rel && b.rel < 1e-3) touchNear(a, b, c)
      }
    }
    if (lastNZ) prevS = lastNZ.s
    run = []
  }
  void lastDefined
  for (const x of xs) {
    const g = gap(x)
    if (!g || Number.isNaN(g.s)) {
      if (run.length > 0) {
        flush()
        gapXs = []
      }
      gapXs.push(x)
      continue
    }
    if (run.length === 0 && !Number.isNaN(lastDefined) && gapXs.length === 0) gapXs = []
    run.push({ x, s: g.s, rel: g.rel })
    lastDefined = x
    if (Number.isNaN(first)) first = x
    reach = x
    if (g.s !== 0) lastS = g.s
  }
  flush()
  crossings.sort((a, b) => a - b)
  touches.sort((a, b) => a - b)
  events.sort((a, b) => a.x - b.x)
  const ev = events[events.length - 1]
  return {
    crossings,
    touches,
    flips,
    lastS,
    settled: ev ? ev.x : first,
    settledBy: ev ? ev.by : 'start',
    first,
    reach,
  }
}

/**
 * The sample x's for a comparison from `from`: dense (step 0.025) over the
 * first 60 units — where a class's table lives — then geometric (2 % a step)
 * out to `to`, which can be as far as 10³⁰⁰ when f and g are read in log space.
 */
export function compareGrid(from: number, to: number): number[] {
  const xs: number[] = []
  const near = Math.min(to, Math.max(from + 60, 60))
  const N1 = Math.min(20000, Math.max(2400, Math.ceil((near - from) / 0.025)))
  for (let i = 0; i <= N1; i++) xs.push(from + ((near - from) * i) / N1)
  if (to > near) {
    let x = near
    while (x < to) {
      x = Math.min(to, x * 1.02)
      xs.push(x)
    }
  }
  return xs
}

/** Evenly spaced samples over [a, b]. */
export function linearGrid(a: number, b: number, n = 2400): number[] {
  const xs: number[] = []
  for (let i = 0; i <= n; i++) xs.push(a + ((b - a) * i) / n)
  return xs
}

/** The exact form of a crossing, when f and g verifiably agree there. */
export function crossingExact(f: Evaluator, g: Evaluator, x: number): ExactForm | null {
  return verifiedExact(x, (c) => {
    const a = f(c)
    const b = g(c)
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a))
  })
}

/**
 * The crossings of f and g on [from, to] from plain values: who leads after
 * the last, every crossing (a pole is not one) and every touch. Says nothing
 * about beyond `to` — src/ui/valueTableLinks.ts decides "for good" from the
 * growth classes (src/core/growth.ts).
 */
export function overtake(f: Evaluator, g: Evaluator, from: number, to = 1000): Overtake | null {
  if (!Number.isFinite(from) || !(to > from)) return null
  const near = Math.min(to, from + 60)
  const xs = linearGrid(from, near)
  if (to > near) xs.push(...linearGrid(near, to).slice(1))
  const scan = scanCrossings(plainGap(f, g), xs)
  if (Number.isNaN(scan.lastS)) return null
  const leader = scan.lastS > 0 ? 'f' : 'g'
  const x = scan.crossings.length > 0 ? scan.crossings[scan.crossings.length - 1] : null
  const exact = x !== null ? crossingExact(f, g, x) : null
  return { leader, x, exact, crossings: scan.crossings, touches: scan.touches, to: scan.reach }
}

// ---------------------------------------------------------------------------
// Polynomials and synthetic division: A-APR.2
// ---------------------------------------------------------------------------

/** A rational p/q in lowest terms, q > 0 — or a plain double when it is not one. */
export type Num = { p: number; q: number } | { d: number }

const LIMIT = 2 ** 50

function gcd(a: number, b: number): number {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b) [a, b] = [b, a % b]
  return a || 1
}

function rat(p: number, q: number): Num {
  if (q < 0) {
    p = -p
    q = -q
  }
  if (!Number.isInteger(p) || !Number.isInteger(q) || q === 0) return { d: p / q }
  const g = gcd(p, q)
  p /= g
  q /= g
  if (Math.abs(p) > LIMIT || q > LIMIT) return { d: p / q }
  return { p: p + 0, q }
}

export const numValue = (n: Num): number => ('d' in n ? n.d : n.p / n.q)

/** A double read as a fraction with a small denominator, when it is one. */
export function toNum(v: number, maxQ = 1000): Num {
  if (!Number.isFinite(v)) return { d: v }
  for (let q = 1; q <= maxQ; q++) {
    const p = Math.round(v * q)
    if (Math.abs(p / q - v) <= 1e-11 * Math.max(1, Math.abs(v))) return rat(p, q)
  }
  return { d: v }
}

function add(a: Num, b: Num): Num {
  if ('d' in a || 'd' in b) return { d: numValue(a) + numValue(b) }
  return rat(a.p * b.q + b.p * a.q, a.q * b.q)
}

function mul(a: Num, b: Num): Num {
  if ('d' in a || 'd' in b) return { d: numValue(a) * numValue(b) }
  return rat(a.p * b.p, a.q * b.q)
}

/**
 * Printed: an integer, a short decimal, p/q; a double as the table prints it.
 * `fractions`: every non-integer rational as p/q (a = 1/2 was typed as a
 * fraction, so the tableau stays in fractions).
 */
export function numCell(n: Num, fractions = false): Cell {
  if ('d' in n) return cell(n.d)
  if (n.q === 1) return cell(n.p)
  // A denominator of 2ᵃ5ᵇ with ≤ 4 places reads as the decimal a class types.
  if (!fractions && shortPlaces(n.p / n.q) !== null) return cell(n.p / n.q)
  const neg = n.p < 0
  const text = `${neg ? MINUS : ''}${Math.abs(n.p)}/${n.q}`
  const tex = `${neg ? '-' : ''}\\frac{${Math.abs(n.p)}}{${n.q}}`
  return { v: n.p / n.q, text, tex, exact: true }
}

/** The degrees tried when finding a typed curve's polynomial. */
export const POLY_MAX_DEGREE = 8

/**
 * Descending coefficients [cₙ … c₀] when f IS a polynomial of degree ≤ 8,
 * else null. Interpolated at the integers −4 … 4 (where a polynomial with
 * rational coefficients evaluates exactly), each coefficient snapped to a
 * fraction when it is one, and then VERIFIED at ten x's the interpolation
 * never saw: a sine, a pole, an exponential or a piecewise break fails there.
 */
export function polynomialCoeffs(f: Evaluator): Num[] | null {
  const nodes = [0, 1, -1, 2, -2, 3, -3, 4, -4]
  const ys = nodes.map((x) => {
    try {
      return f(x)
    } catch {
      return Number.NaN
    }
  })
  if (!ys.every(Number.isFinite)) return null
  // …and far out on both sides: a piecewise break at x = 10 passes every test
  // inside [−4, 8], but not these.
  const tests = [-3.7, -2.45, -1.3, -0.55, 0.37, 1.21, 2.6, 3.33, 5.9, 7.15, -51.3, 49.7, -1013.1, 997.3]
  const ty = tests.map((x) => {
    try {
      return f(x)
    } catch {
      return Number.NaN
    }
  })
  if (!ty.every(Number.isFinite)) return null
  for (let deg = 0; deg <= POLY_MAX_DEGREE; deg++) {
    const k = deg + 1
    const xs = nodes.slice(0, k)
    // Newton divided differences, then expanded to ascending coefficients.
    const dd = ys.slice(0, k)
    for (let j = 1; j < k; j++) for (let i = k - 1; i >= j; i--) dd[i] = (dd[i] - dd[i - 1]) / (xs[i] - xs[i - j])
    let coef = [dd[k - 1]]
    for (let i = k - 2; i >= 0; i--) {
      const next = new Array<number>(coef.length + 1).fill(0)
      for (let m = 0; m < coef.length; m++) {
        next[m + 1] += coef[m]
        next[m] -= coef[m] * xs[i]
      }
      next[0] += dd[i]
      coef = next
    }
    const nums = coef.map((c) => toNum(c))
    const vals = nums.map(numValue)
    const at = (x: number): number => {
      let s = 0
      for (let m = vals.length - 1; m >= 0; m--) s = s * x + vals[m]
      return s
    }
    const ok =
      tests.every((x, i) => Math.abs(at(x) - ty[i]) <= 1e-8 * Math.max(1, Math.abs(ty[i]))) &&
      nodes.every((x, i) => Math.abs(at(x) - ys[i]) <= 1e-8 * Math.max(1, Math.abs(ys[i])))
    if (!ok) continue
    // Trim leading zeros (the interpolant of a cubic at degree 4 has c₄ ≈ 0).
    const desc = nums.slice().reverse()
    while (desc.length > 1 && numValue(desc[0]) === 0) desc.shift()
    return desc
  }
  return null
}

export interface SyntheticDivision {
  a: Num
  /** The dividend's coefficients, highest power first. */
  coeffs: Num[]
  /** The products a · (bring-down so far), under coeffs[1 …]. */
  products: Num[]
  /** The bottom row: the quotient's coefficients, then the remainder. */
  bottom: Num[]
  quotient: Num[]
  remainder: Num
}

/** The tableau: bring down, multiply by a, add — the remainder is f(a). */
export function syntheticDivision(coeffs: readonly Num[], a: Num): SyntheticDivision | null {
  if (coeffs.length < 2) return null
  const bottom: Num[] = [coeffs[0]]
  const products: Num[] = []
  for (let i = 1; i < coeffs.length; i++) {
    const p = mul(bottom[i - 1], a)
    products.push(p)
    bottom.push(add(coeffs[i], p))
  }
  return {
    a,
    coeffs: coeffs.slice(),
    products,
    bottom,
    quotient: bottom.slice(0, -1),
    remainder: bottom[bottom.length - 1],
  }
}

const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' }
const sup = (n: number): string => String(n).split('').map((d) => SUP[d] ?? d).join('')

/** A polynomial from descending coefficients: "x² − 2x + 2", "(1/2)x³ + 4". Text and LaTeX. */
export function polyText(desc: readonly Num[], fractions = false): { text: string; tex: string } {
  const deg = desc.length - 1
  const text: string[] = []
  const tex: string[] = []
  desc.forEach((c, i) => {
    const pow = deg - i
    const v = numValue(c)
    if (v === 0 || Math.abs(v) < 1e-13) return
    const neg = v < 0
    const mag = numCell(neg ? negate(c) : c, fractions)
    const xs = pow === 0 ? '' : pow === 1 ? 'x' : `x${sup(pow)}`
    const xt = pow === 0 ? '' : pow === 1 ? 'x' : `x^{${pow}}`
    const one = mag.v === 1 && pow > 0
    const frac = /\//.test(mag.text) || /\s/.test(mag.text)
    const ct = one ? '' : pow > 0 && frac ? `(${mag.text})` : mag.text
    const cx = one ? '' : mag.tex
    const first = text.length === 0
    text.push(`${first ? (neg ? MINUS : '') : neg ? ` ${MINUS} ` : ' + '}${ct}${xs}`)
    tex.push(`${first ? (neg ? '-' : '') : neg ? ' - ' : ' + '}${cx}${xt}`)
  })
  if (text.length === 0) return { text: '0', tex: '0' }
  return { text: text.join(''), tex: tex.join('') }
}

function negate(n: Num): Num {
  return 'd' in n ? { d: -n.d } : { p: -n.p, q: n.q }
}

/** "(x − 3)", "(x + 2)", "(x − 1/2)" and its LaTeX. */
export function divisorText(a: Num, fractions = false): { text: string; tex: string } {
  const v = numValue(a)
  if (v === 0) return { text: 'x', tex: 'x' }
  const mag = numCell(v < 0 ? negate(a) : a, fractions)
  return {
    text: `(x ${v < 0 ? '+' : MINUS} ${mag.text})`,
    tex: `\\left(x ${v < 0 ? '+' : '-'} ${mag.tex}\\right)`,
  }
}

/**
 * The a of a divisor as typed: "3", "-1/2", "x - 3", "x+2", "(x + 1/3)".
 * Null when it is neither a number nor x ± a number.
 */
export function divisorA(text: string, parse: (s: string) => number | null): number | null {
  let s = text.trim().replace(/−/g, '-').replace(/\s+/g, '')
  if (s === '') return null
  while (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1)
  const m = /^x([+-])(.+)$/i.exec(s)
  if (m) {
    const v = parse(m[2])
    if (v === null || !Number.isFinite(v)) return null
    return m[1] === '-' ? v : -v
  }
  if (/^x$/i.test(s)) return 0
  const v = parse(s)
  return v !== null && Number.isFinite(v) ? v : null
}

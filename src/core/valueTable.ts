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
//   overtake(f, g, from)             where one function passes the other for
//                                    good (2ˣ passes x³ after x ≈ 9.94)
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
/** Relative slack for "this double is that short decimal". */
const SHORT_TOL = 1e-9

/** The decimal places of v when it is a short decimal (≤ 4 places), else null. */
export function shortPlaces(v: number): number | null {
  if (!Number.isFinite(v)) return null
  if (Number.isInteger(v)) return 0
  if (Math.abs(v) >= 1e9) return null
  for (let p = 0; p <= SHORT_PLACES; p++) {
    const f = Math.pow(10, p)
    const t = Math.round(v * f) / f
    if (Math.abs(t - v) <= SHORT_TOL * Math.max(1, Math.abs(v))) return p
  }
  return null
}

const withMinus = (s: string): string => (s.startsWith('-') ? MINUS + s.slice(1) : s)

/** A printed value: an integer or a short decimal, a closed form, else seven significant digits. */
export function cell(v: number): Cell {
  if (Number.isNaN(v)) return { v, text: 'undefined', tex: '\\text{undefined}', exact: true }
  if (v === Infinity) return { v, text: '∞', tex: '\\infty', exact: true }
  if (v === -Infinity) return { v, text: `${MINUS}∞`, tex: '-\\infty', exact: true }
  if (v === 0 || Math.abs(v) < 1e-13) return { v: 0, text: '0', tex: '0', exact: true }
  if (Number.isInteger(v) && Math.abs(v) < 1e15) {
    return { v, text: withMinus(String(v)), tex: String(v), exact: true }
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
    out.push(spec.exactStep === false ? x : Number(x.toPrecision(12)))
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

/** A difference that should have cancelled to zero, snapped: 1.2 − 1.0 is 0.2, 3 − 3 is 0. */
function tidy(v: number, scale: number): number {
  if (!Number.isFinite(v)) return v
  if (Math.abs(v) <= 1e-12 * Math.max(1, scale)) return 0
  return v
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
    const d = tidy(ys[i + 1] - ys[i], scale)
    d1v.push(d)
    ratiov.push(ys[i] === 0 || !Number.isFinite(ys[i]) ? Number.NaN : ys[i + 1] / ys[i])
    const dx = xs[i + 1] - xs[i]
    avgv.push(dx === 0 ? Number.NaN : tidy(d / dx, scale / Math.max(1e-12, Math.abs(dx))))
  }
  const d2v: number[] = []
  for (let i = 0; i + 1 < d1v.length; i++) d2v.push(tidy(d1v[i + 1] - d1v[i], scale))
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

/** All finite and equal to the first within a relative tolerance. */
function constant(vals: readonly number[], scale: number): boolean {
  if (vals.length === 0 || !vals.every(Number.isFinite)) return false
  const tol = 1e-9 * Math.max(1, scale)
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
  const probes = [x0 + 0.5 * h, x0 + 1.37 * h, (x0 + xn) / 2 + 0.29 * h, xn - 0.41 * h, xn + 0.63 * h, x0 - 0.83 * h]
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
 * What the table shows — only when it is so, and only when f agrees.
 * Linear before quadratic before exponential (a constant Δy is also a
 * constant Δ²y of 0, and a constant function has ratio 1).
 */
export function tablePattern(t: ValueTable, f: Evaluator): TablePattern | null {
  if (!t.equal || t.h === null || t.xs.length < 3) return null
  const ys = t.y.map((c) => c.v)
  if (!ys.every(Number.isFinite)) return null
  const scale = Math.max(1, ...ys.map(Math.abs))
  const h = t.h
  const x0 = t.xs[0]
  const d1 = t.d1.map((c) => c.v)
  if (constant(d1, scale)) {
    const m = d1[0] / h
    if (!agrees(f, (x) => ys[0] + m * (x - x0), t.xs, h)) return null
    const value = cell(d1[0])
    const what = d1[0] === 0 ? 'linear (a constant function)' : 'linear'
    return { kind: 'linear', value, text: `Δy is constant (${value.text}): ${what}` }
  }
  const d2 = t.d2.map((c) => c.v)
  if (t.xs.length >= 4 && constant(d2, scale) && d2[0] !== 0) {
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
  /** How far the comparison was checked. */
  to: number
}

/** Where the doubles stop being able to compare them (both overflow): the scan ends there. */
function compare(f: Evaluator, g: Evaluator, x: number): number {
  let a: number
  let b: number
  try {
    a = f(x)
    b = g(x)
  } catch {
    return Number.NaN
  }
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN
  if (a === b) return 0
  if (!Number.isFinite(a) && !Number.isFinite(b)) return Number.NaN
  return a > b ? 1 : -1
}

/**
 * The crossings of f and g on [from, to], each refined by bisection, and who
 * leads after the last. The scan is dense near `from` (the table's range is
 * where a class looks) and coarser out to `to`; it ends early where both
 * overflow, which is past every crossing a high-school pair has.
 */
export function overtake(f: Evaluator, g: Evaluator, from: number, to = 1000): Overtake | null {
  if (!Number.isFinite(from) || !(to > from)) return null
  const near = Math.min(to, from + 60)
  const xs: number[] = []
  const N1 = 2400
  for (let i = 0; i <= N1; i++) xs.push(from + ((near - from) * i) / N1)
  if (to > near) {
    const N2 = 2400
    for (let i = 1; i <= N2; i++) xs.push(near + ((to - near) * i) / N2)
  }
  const crossings: number[] = []
  let prevX = Number.NaN
  let prevS = Number.NaN
  let lastS = Number.NaN
  let reach = from
  for (const x of xs) {
    const s = compare(f, g, x)
    if (Number.isNaN(s)) {
      prevS = Number.NaN
      continue
    }
    reach = x
    if (s === 0) {
      // A touch exactly on a sample: a crossing only if the sign then changes.
      continue
    }
    if (!Number.isNaN(prevS) && s !== prevS) {
      let lo = prevX
      let hi = x
      for (let k = 0; k < 80; k++) {
        const mid = (lo + hi) / 2
        const sm = compare(f, g, mid)
        if (Number.isNaN(sm)) break
        if (sm === prevS || sm === 0) {
          if (sm === 0) {
            lo = hi = mid
            break
          }
          lo = mid
        } else hi = mid
      }
      crossings.push((lo + hi) / 2)
    }
    prevX = x
    prevS = s
    lastS = s
  }
  if (Number.isNaN(lastS)) return null
  const leader = lastS > 0 ? 'f' : 'g'
  const x = crossings.length > 0 ? crossings[crossings.length - 1] : null
  let exact: ExactForm | null = null
  if (x !== null) {
    exact = verifiedExact(x, (c) => {
      const a = f(c)
      const b = g(c)
      return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a))
    })
  }
  return { leader, x, exact, crossings, to: reach }
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
  const tests = [-3.7, -2.45, -1.3, -0.55, 0.37, 1.21, 2.6, 3.33, 5.9, 7.15]
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

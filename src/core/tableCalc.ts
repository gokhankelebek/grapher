// ============================================================================
// src/core/tableCalc.ts — calculus on a data table, the AP free-response way.
//
// A table of (t, r(t)) rows is all a student is given: no formula, unequal
// gaps, units in the headers. From it the AP Calculus exam asks for
//
//   6.2 / 6.3  left, right, midpoint and trapezoidal sums over any run of
//              rows, with the widths Δtₖ explicit and the sum written out
//              term by term: L₄ = (2)(4.3) + (3)(5.0) + … = 68.5
//   2.1 / 2.3  r′(c) estimated by a difference quotient of the rows that
//              bracket c
//   8.1        the average value, (1/(b − a))·(a trapezoidal sum)
//   1.16, 5.1  "must there be a time when …?": the IVT and the MVT, stated
//              only when the problem grants the hypothesis (a table alone
//              never shows continuity or differentiability)
//
// and this module answers each of them in the exam's own words.
//
// EXACT. Table data are decimals as typed ("4.3", "5.0", "−0.25", "3/4"), so
// every value is read as an exact rational (bigint numerator/denominator) and
// the arithmetic is exact: (2)(4.3) + (3)(5.0) is 23.6, never 23.599999. A
// result that terminates is printed as the decimal it is; one that does not
// is printed as its fraction and to three decimal places, the precision AP
// asks for ("749/120 ≈ 6.242"). A cell that is not a plain rational ("2pi")
// puts the whole computation on floating point, and every value says "≈".
//
// HONEST. Nothing is ever claimed from the data alone that the data cannot
// show. "The left sum is an underestimate" is only ever written as AP writes
// it — "if r is increasing on [0, 12], the left sum is an underestimate" —
// and only when the rows are consistent with r increasing there; rows that
// rise and fall say instead that the table cannot decide.
//
// Pure: no DOM, no React. Imports nothing outside src/core.
// ============================================================================

// ---------------------------------------------------------------------------
// Exact rationals
// ---------------------------------------------------------------------------

/** n/d in lowest terms, d > 0. */
export interface Q {
  readonly n: bigint
  readonly d: bigint
}

const babs = (a: bigint): bigint => (a < 0n ? -a : a)

function gcd(a: bigint, b: bigint): bigint {
  let x = babs(a)
  let y = babs(b)
  while (y !== 0n) {
    const t = x % y
    x = y
    y = t
  }
  return x
}

export function qMake(n: bigint, d: bigint = 1n): Q | null {
  if (d === 0n) return null
  let nn = n
  let dd = d
  if (dd < 0n) {
    nn = -nn
    dd = -dd
  }
  const g = gcd(nn, dd)
  return g > 1n ? { n: nn / g, d: dd / g } : { n: nn, d: dd }
}

const qa = (n: bigint, d: bigint): Q => qMake(n, d) as Q

export const qAdd = (a: Q, b: Q): Q => qa(a.n * b.d + b.n * a.d, a.d * b.d)
export const qSub = (a: Q, b: Q): Q => qa(a.n * b.d - b.n * a.d, a.d * b.d)
export const qMul = (a: Q, b: Q): Q => qa(a.n * b.n, a.d * b.d)
export const qDiv = (a: Q, b: Q): Q | null => (b.n === 0n ? null : qMake(a.n * b.d, a.d * b.n))
/** −1, 0 or 1. */
export const qCmp = (a: Q, b: Q): number => {
  const s = a.n * b.d - b.n * a.d
  return s < 0n ? -1 : s > 0n ? 1 : 0
}
export function qToNumber(a: Q): number {
  const n = Number(a.n)
  const d = Number(a.d)
  if (Number.isFinite(n) && Number.isFinite(d)) return n / d
  // Huge terms: scale down as decimal strings would.
  const shift = Math.max(a.n.toString().length, a.d.toString().length) - 15
  const p = 10n ** BigInt(Math.max(0, shift))
  return Number(a.n / p) / Number(a.d / p)
}

const DEC = /^([-+]?)(\d*)(?:\.(\d*))?(?:[eE]([-+]?\d+))?$/

function decimalQ(s: string): Q | null {
  const m = DEC.exec(s)
  if (!m) return null
  const int = m[2] ?? ''
  const frac = m[3] ?? ''
  if (int === '' && frac === '') return null
  const exp = m[4] ? Number(m[4]) : 0
  if (!Number.isInteger(exp) || Math.abs(exp) > 40) return null
  let n = BigInt(`${int}${frac}` || '0')
  let d = 10n ** BigInt(frac.length)
  if (exp > 0) n *= 10n ** BigInt(exp)
  else if (exp < 0) d *= 10n ** BigInt(-exp)
  if (m[1] === '-') n = -n
  return qMake(n, d)
}

/**
 * A cell's text as an exact rational, or null when it is not a plain number:
 * "4.3", "−0.25", "5.0", "1e3", "3/4", "1,234" (US thousands), "2,25"
 * (decimal comma). "2pi", "sqrt(2)" and blanks are null.
 */
export function qParse(text: string): Q | null {
  let s = String(text ?? '')
    .trim()
    .replace(/[−–]/g, '-')
    .replace(/[\s   ]/g, '')
  if (s === '') return null
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '')
  else if (/^[-+]?\d+,\d+$/.test(s)) s = s.replace(',', '.')
  const slash = s.indexOf('/')
  if (slash > 0 && slash === s.lastIndexOf('/')) {
    const a = decimalQ(s.slice(0, slash))
    const b = decimalQ(s.slice(slash + 1))
    return a && b ? qDiv(a, b) : null
  }
  return decimalQ(s)
}

// ---------------------------------------------------------------------------
// Numbers that are exact when they can be
// ---------------------------------------------------------------------------

/** A value, with its exact rational when every input it came from had one. */
export interface Num {
  v: number
  q: Q | null
}

export const numQ = (q: Q): Num => ({ v: qToNumber(q), q })
export const numF = (v: number): Num => ({ v, q: null })
export const numInt = (k: number): Num => numQ(qa(BigInt(k), 1n))

/** A cell read as a Num: exact when its text is a plain rational that agrees with `v`. */
export function numOfCell(text: string, v: number): Num {
  const q = qParse(text)
  if (q) {
    const qv = qToNumber(q)
    if (Math.abs(qv - v) <= 1e-9 * Math.max(1, Math.abs(v))) return { v: qv, q }
  }
  return numF(v)
}

function lift(a: Num, b: Num, fq: (x: Q, y: Q) => Q | null, ff: (x: number, y: number) => number): Num {
  if (a.q && b.q) {
    const r = fq(a.q, b.q)
    if (r) return numQ(r)
  }
  return numF(ff(a.v, b.v))
}

export const nAdd = (a: Num, b: Num): Num => lift(a, b, qAdd, (x, y) => x + y)
export const nSub = (a: Num, b: Num): Num => lift(a, b, qSub, (x, y) => x - y)
export const nMul = (a: Num, b: Num): Num => lift(a, b, qMul, (x, y) => x * y)
export const nDiv = (a: Num, b: Num): Num => lift(a, b, qDiv, (x, y) => x / y)
/** −1, 0 or 1 — exactly when both are exact. */
export function nCmp(a: Num, b: Num): number {
  if (a.q && b.q) return qCmp(a.q, b.q)
  const tol = 1e-12 * Math.max(1, Math.abs(a.v), Math.abs(b.v))
  return a.v < b.v - tol ? -1 : a.v > b.v + tol ? 1 : 0
}
export const nSum = (list: readonly Num[]): Num => list.reduce((s, x) => nAdd(s, x), numInt(0))

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

const MINUS = '−'
/** Decimal places shown for a value that is not exact (the AP free-response precision). */
export const AP_PLACES = 3
/** A terminating decimal longer than this is shown as a fraction and to three places. */
const MAX_EXACT_PLACES = 6

/** The terminating decimal of q ("37.2", "−0.25", "6"), or null. */
export function qDecimal(q: Q, maxPlaces = MAX_EXACT_PLACES): string | null {
  let d = q.d
  let twos = 0
  let fives = 0
  while (d % 2n === 0n) {
    d /= 2n
    twos++
  }
  while (d % 5n === 0n) {
    d /= 5n
    fives++
  }
  if (d !== 1n) return null
  const places = Math.max(twos, fives)
  if (places > maxPlaces) return null
  const scaled = (q.n * 10n ** BigInt(places)) / q.d
  const neg = scaled < 0n
  let digits = babs(scaled).toString()
  if (places > 0) {
    digits = digits.padStart(places + 1, '0')
    digits = `${digits.slice(0, -places)}.${digits.slice(-places)}`
  }
  return `${neg ? MINUS : ''}${digits}`
}

/** "6.242", "−0.233": three places, rounded, a true minus, never "−0.000". */
export function ap3(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const s = v.toFixed(AP_PLACES)
  return (/^-0\.0+$/.test(s) ? s.slice(1) : s).replace('-', MINUS)
}

/** A float as briefly as it is: "2.5" for 2.5000000001, else three places. */
function floatText(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const r = Math.round(v * 1000) / 1000
  if (Math.abs(v - r) <= 1e-9 * Math.max(1, Math.abs(v))) {
    return String(r === 0 ? 0 : r).replace('-', MINUS)
  }
  return ap3(v)
}

/** An operand as the working prints it: "2", "0.75", "1/3", or three places. */
export function numText(x: Num): string {
  if (x.q) return qDecimal(x.q) ?? `${x.q.n < 0n ? MINUS : ''}${babs(x.q.n)}/${x.q.d}`
  return floatText(x.v)
}

/** The same in TeX: "2", "0.75", "\frac{1}{3}", "-\frac{7}{30}". */
export function numTex(x: Num): string {
  if (x.q) {
    const dec = qDecimal(x.q)
    if (dec) return dec.replace(MINUS, '-')
    return `${x.q.n < 0n ? '-' : ''}\\frac{${babs(x.q.n)}}{${x.q.d}}`
  }
  return floatText(x.v).replace(MINUS, '-')
}

/** A result: "= 68.5", "= 749/120 ≈ 6.242" or (not exact) "≈ 6.242". */
export interface ValueText {
  /** "= 68.5" / "= 749/120 ≈ 6.242" / "≈ 6.242". */
  rhs: string
  /** The same in TeX. */
  rhsTex: string
  /** The value alone, as a chip says it after its "=" or "≈": "68.5", "6.242". */
  short: string
  /** True when `short` is a rounding ("≈"), false when it is the exact value ("="). */
  rounded: boolean
}

export function valueText(x: Num): ValueText {
  if (x.q) {
    const dec = qDecimal(x.q)
    if (dec) return { rhs: `= ${dec}`, rhsTex: `= ${dec.replace(MINUS, '-')}`, short: dec, rounded: false }
    const frac = numText(x)
    return {
      rhs: `= ${frac} ≈ ${ap3(x.v)}`,
      rhsTex: `= ${numTex(x)} \\approx ${ap3(x.v).replace(MINUS, '-')}`,
      short: ap3(x.v),
      rounded: true,
    }
  }
  const t = floatText(x.v)
  return { rhs: `≈ ${t}`, rhsTex: `\\approx ${t.replace(MINUS, '-')}`, short: t, rounded: true }
}

/** "= 68.5" → "L₄ = 68.5"; a rounded value keeps its ≈: "avg ≈ 6.242". */
export const chipOf = (lhs: string, v: ValueText): string => `${lhs} ${v.rounded ? '≈' : '='} ${v.short}`

const SUB = '₀₁₂₃₄₅₆₇₈₉'
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹'
const subDigits = (k: number): string =>
  `${k < 0 ? '₋' : ''}${String(Math.abs(k))
    .split('')
    .map((c) => SUB[Number(c)])
    .join('')}`
const supDigits = (k: number): string =>
  `${k < 0 ? '⁻' : ''}${String(Math.abs(k))
    .split('')
    .map((c) => SUP[Number(c)])
    .join('')}`
/** A small index as a subscript: 4 → "₄". */
export const sub = (k: number): string => subDigits(k)

// ---------------------------------------------------------------------------
// Names and units from the headers
// ---------------------------------------------------------------------------

/** What the headers say: the function's letter, its variable and the units. */
export interface TableNames {
  /** "r" (from "r(t) (gal/min)"), a single-letter y header, else "f". */
  fn: string
  /** "t" (from "t (min)" or the r(t) in the y header), else "x". */
  arg: string
  xUnit: string | null
  yUnit: string | null
  /** The unit of ∫ r(t) dt: "gal/min" over "min" → "gallons". Null without both units. */
  intUnit: string | null
  /** The unit of r′: "gal/min per min". */
  derivUnit: string | null
}

/**
 * "r(t) (gal/min)" → { name: "r(t)", unit: "gal/min" }; "t (min)" → t, min;
 * "Time [s]" → Time, s. A bracket right after a name with no space is a
 * function's argument when it holds a single letter ("r(t)"), a unit
 * otherwise ("Time(min)").
 */
export function splitLabel(label: string): { name: string; unit: string | null } {
  const s = String(label ?? '').trim()
  const m = /^(.*?)(\s*)[([]([^()[\]]*)[)\]]\s*$/.exec(s)
  if (!m || m[1].trim() === '') return { name: s, unit: null }
  const inner = m[3].trim()
  const spaced = m[2].length > 0
  if (!spaced && /^[A-Za-zα-ωΑ-Ω]$/.test(inner)) return { name: s, unit: null }
  if (inner === '') return { name: m[1].trim(), unit: null }
  return { name: m[1].trim(), unit: inner }
}

const LETTER = /^[A-Za-zα-ωΑ-Ω]$/

/** Time units, by every spelling a header uses, to one key. */
const TIME: Record<string, string> = {
  s: 's', sec: 's', secs: 's', second: 's', seconds: 's',
  min: 'min', mins: 'min', minute: 'min', minutes: 'min',
  h: 'h', hr: 'h', hrs: 'h', hour: 'h', hours: 'h',
  d: 'day', day: 'day', days: 'day',
  wk: 'week', week: 'week', weeks: 'week',
  mo: 'month', month: 'month', months: 'month',
  y: 'yr', yr: 'yr', yrs: 'yr', year: 'yr', years: 'yr',
}

const unitKey = (u: string): string => {
  const s = u.trim().toLowerCase().replace(/\.$/, '')
  return TIME[s] ?? s.replace(/s$/, '')
}

/** What an amount's abbreviation means in a sentence: gal → gallons. */
const AMOUNT: Record<string, string> = {
  gal: 'gallons', L: 'liters', l: 'liters', mL: 'milliliters', ml: 'milliliters',
  m: 'meters', ft: 'feet', km: 'kilometers', mi: 'miles', cm: 'centimeters', in: 'inches', mm: 'millimeters',
  lb: 'pounds', lbs: 'pounds', kg: 'kilograms', g: 'grams',
  'm³': 'cubic meters', 'ft³': 'cubic feet', 'cm³': 'cubic centimeters',
  'm^3': 'cubic meters', 'ft^3': 'cubic feet', 'cm^3': 'cubic centimeters',
}

/**
 * The unit of r(t)·Δt: "gal/min" over "min" is "gallons", "people per hour"
 * over "hours" is "people", "ft/sec" over "sec" is "feet". When the rate is
 * not "something per x-unit" the product is written out: "N·m".
 */
export function integralUnit(yUnit: string | null, xUnit: string | null): string | null {
  if (!yUnit || !xUnit) return null
  const slash = yUnit.lastIndexOf('/')
  const per = /^(.*\S)\s+per\s+(\S.*)$/i.exec(yUnit)
  const parts = per ? [per[1], per[2]] : slash > 0 ? [yUnit.slice(0, slash), yUnit.slice(slash + 1)] : null
  if (parts && unitKey(parts[1]) === unitKey(xUnit)) {
    const amount = parts[0].trim()
    return AMOUNT[amount] ?? amount
  }
  return /[\s/]/.test(yUnit) ? `(${yUnit})·${xUnit}` : `${yUnit}·${xUnit}`
}

/** The unit of r′: "gal/min per min", "ft/sec per sec"; a plain unit over x: "ft/sec". */
export function derivativeUnit(yUnit: string | null, xUnit: string | null): string | null {
  if (!yUnit || !xUnit) return null
  return /\/|\sper\s/i.test(yUnit) ? `${yUnit} per ${xUnit}` : `${yUnit}/${xUnit}`
}

export function tableNames(xLabel: string, yLabel: string): TableNames {
  const x = splitLabel(xLabel)
  const y = splitLabel(yLabel)
  let fn = 'f'
  let argY: string | null = null
  const call = /^([A-Za-zα-ωΑ-Ω])\s*\(\s*([A-Za-zα-ω])\s*\)$/.exec(y.name)
  if (call) {
    fn = call[1]
    argY = call[2]
  } else if (LETTER.test(y.name) && y.name !== 'y' && y.name !== 'Y') {
    fn = y.name
  }
  const arg = LETTER.test(x.name) ? x.name : (argY ?? 'x')
  if (fn === arg) fn = 'f'
  return {
    fn,
    arg,
    xUnit: x.unit,
    yUnit: y.unit,
    intUnit: integralUnit(y.unit, x.unit),
    derivUnit: derivativeUnit(y.unit, x.unit),
  }
}

const withUnit = (text: string, unit: string | null): string => (unit ? `${text} ${unit}` : text)
const texUnit = (unit: string | null): string => (unit ? `\\ \\text{${texEscape(unit)}}` : '')

/** Text inside \text{…}: the characters KaTeX and LaTeX treat specially. */
function texEscape(s: string): string {
  return s.replace(/[\\{}$&#^_%~]/g, (c) => (c === '\\' ? '\\textbackslash{}' : c === '~' ? '\\textasciitilde{}' : c === '^' ? '\\textasciicircum{}' : `\\${c}`))
}

/** A Greek or Latin letter in TeX. */
function texLetter(c: string): string {
  const GREEK: Record<string, string> = {
    α: '\\alpha', β: '\\beta', γ: '\\gamma', δ: '\\delta', θ: '\\theta', λ: '\\lambda', μ: '\\mu', π: '\\pi',
    ρ: '\\rho', σ: '\\sigma', τ: '\\tau', φ: '\\phi', ω: '\\omega',
  }
  return GREEK[c] ?? c
}

// ---------------------------------------------------------------------------
// The rows
// ---------------------------------------------------------------------------

/** One row, read: its values and the text the working prints for them. */
export interface TablePt {
  x: Num
  y: Num
  /** As typed when it is a plain number ("5.0" stays "5.0"), true minus. */
  xText: string
  yText: string
}

const PLAIN = /^[-+−]?(\d+\.?\d*|\.\d+)$/

/** The text a row's value is printed with: the teacher's own when it is a plain number. */
export function cellText(text: string, n: Num): string {
  const t = String(text ?? '').trim()
  if (PLAIN.test(t)) return t.replace(/^\+/, '').replace(/^-/, MINUS)
  return numText(n)
}

const texNum = (t: string): string => t.replace(MINUS, '-')
/** A value as a factor or an addend: "(−4.3)" when negative. */
const paren = (t: string): string => (t.startsWith(MINUS) ? `(${t})` : t)

/** "r(5)", "r(t_{k-1})" … */
const call = (fn: string, at: string): string => `${fn}(${at})`

function intText(a: TablePt, b: TablePt, n: TableNames): string {
  const ai = Number.isInteger(a.x.v) && Math.abs(a.x.v) < 1000
  const bi = Number.isInteger(b.x.v) && Math.abs(b.x.v) < 1000
  const body = `${n.fn}(${n.arg}) d${n.arg}`
  return ai && bi ? `∫${subDigits(a.x.v)}${supDigits(b.x.v)} ${body}` : `∫ from ${a.xText} to ${b.xText} of ${body}`
}

const intTex = (a: TablePt, b: TablePt, n: TableNames): string =>
  `\\int_{${texNum(a.xText)}}^{${texNum(b.xText)}} ${texLetter(n.fn)}(${texLetter(n.arg)})\\,d${texLetter(n.arg)}`

const range = (a: TablePt, b: TablePt): string => `[${a.xText}, ${b.xText}]`

// ---------------------------------------------------------------------------
// Riemann and trapezoidal sums
// ---------------------------------------------------------------------------

export type SumMethod = 'left' | 'right' | 'midpoint' | 'trapezoid'
export const SUM_METHODS: readonly SumMethod[] = ['left', 'right', 'midpoint', 'trapezoid']
export const SUM_LETTER: Record<SumMethod, string> = { left: 'L', right: 'R', midpoint: 'M', trapezoid: 'T' }
export const SUM_NAME: Record<SumMethod, string> = {
  left: 'left Riemann sum',
  right: 'right Riemann sum',
  midpoint: 'midpoint sum',
  trapezoid: 'trapezoidal sum',
}

/** One piece of the picture: a rectangle (h0 = h1) or a trapezoid. */
export interface SumPiece {
  x0: number
  x1: number
  /** Height at x0 and at x1; equal for a rectangle. */
  h0: number
  h1: number
}

export interface SumOk {
  ok: true
  method: SumMethod
  /** The first and last row (indices into the points). */
  i: number
  j: number
  /** Subintervals. */
  n: number
  value: Num
  pieces: SumPiece[]
  /** "L₄". */
  symbol: string
  /** "L_{4}". */
  symbolTex: string
  /** "L_{4} = \sum_{k=1}^{4} r(t_{k-1})\,\Delta t_k" — the question a hidden answer leaves. */
  sigmaTex: string
  /** "Σ r(tₖ₋₁)Δtₖ for k = 1 to 4". */
  sigmaText: string
  /** "\Delta t_{1} = 2,\ \Delta t_{2} = 3 …", and the midpoints for M. */
  widthsTex: string
  widthsText: string
  /** The sum written out, term by term: "(2)(4.3)", "\tfrac{1}{2}(2)(4.3 + 5.0)". */
  termsTex: string[]
  termsText: string[]
  result: ValueText
  /** "L₄ = (2)(4.3) + (3)(5.0) + … = 68.5". */
  text: string
  /** "∫₀¹² r(t) dt ≈ 68.5 gallons". */
  integralText: string
  integralTex: string
  /** "L₄ = 68.5" — the chip on the board. */
  chip: string
  /** The over/under-estimate sentence, conditional as AP writes it; null when there is nothing to say. */
  estimate: string | null
}

export interface SumNo {
  ok: false
  method: SumMethod
  why: string
}

export type SumResult = SumOk | SumNo

/** Is m the midpoint of a and b? Exactly when all three are exact. */
function isMid(a: Num, m: Num, b: Num): boolean {
  if (a.q && m.q && b.q) return qCmp(qMul(m.q, qa(2n, 1n)), qAdd(a.q, b.q)) === 0
  return Math.abs(2 * m.v - (a.v + b.v)) <= 1e-9 * Math.max(1, Math.abs(a.v), Math.abs(b.v))
}

/** Signs of the successive differences of a list: +1 all rising, −1 all falling, 0 flat somewhere, null mixed. */
function trend(list: readonly Num[]): 1 | -1 | 0 | null {
  let up = false
  let down = false
  let flat = false
  for (let k = 1; k < list.length; k++) {
    const c = nCmp(list[k], list[k - 1])
    if (c > 0) up = true
    else if (c < 0) down = true
    else flat = true
  }
  if (up && down) return null
  if (flat) return 0
  return up ? 1 : -1
}

/** The over/under sentence for a sum on rows i..j (see the header: only conditional, only when consistent). */
function estimateSentence(pts: readonly TablePt[], i: number, j: number, method: SumMethod, n: TableNames, letter: string): string | null {
  const run = pts.slice(i, j + 1)
  const on = range(pts[i], pts[j])
  const f = n.fn
  if (method === 'left' || method === 'right') {
    const t = trend(run.map((p) => p.y))
    if (t === null) {
      return `The values rise and fall on ${on}, so ${f} is not monotonic there: the table alone cannot say whether ${letter} is an overestimate or an underestimate.`
    }
    if (t === 0) return null
    const under = (method === 'left') === (t === 1)
    const dir = t === 1 ? 'increasing' : 'decreasing'
    const side = method === 'left' ? 'left' : 'right'
    return `If ${f} is ${dir} on ${on}, the ${side} sum ${letter} is an ${under ? 'underestimate' : 'overestimate'}: each rectangle's height is ${f}'s ${under ? 'smallest' : 'largest'} value on its subinterval.`
  }
  // Trapezoids and midpoints turn on concavity: the slopes between rows.
  if (run.length < 3) return null
  const slopes: Num[] = []
  for (let k = 1; k < run.length; k++) slopes.push(nDiv(nSub(run[k].y, run[k - 1].y), nSub(run[k].x, run[k - 1].x)))
  const t = trend(slopes)
  if (t === null) {
    return `The slopes between rows rise and fall on ${on}, so ${f} is not concave up or concave down throughout: the table alone cannot say whether ${letter} is an overestimate or an underestimate.`
  }
  if (t === 0) return null
  const up = t === 1
  const shape = up ? 'concave up' : 'concave down'
  if (method === 'trapezoid') {
    return `If ${f} is ${shape} on ${on}, the trapezoidal sum ${letter} is an ${up ? 'overestimate' : 'underestimate'}: each trapezoid's top is a chord, which lies ${up ? 'above' : 'below'} the graph.`
  }
  return `If ${f} is ${shape} on ${on}, the midpoint sum ${letter} is an ${up ? 'underestimate' : 'overestimate'}: the tangent line at each midpoint lies ${up ? 'below' : 'above'} the graph and bounds the same area as the rectangle.`
}

/**
 * A sum over rows i..j (i < j) of points with strictly increasing x.
 *
 * L, R and T use every gap of the rows as a subinterval, widths unequal as
 * they come. M pairs the gaps — [t_i, t_{i+2}], [t_{i+2}, t_{i+4}] … — and
 * samples the middle row, so it needs an even number of gaps and each middle
 * row exactly at its subinterval's midpoint; otherwise it says why not.
 */
export function tableSum(pts: readonly TablePt[], i: number, j: number, method: SumMethod, names: TableNames): SumResult {
  if (!(i >= 0 && j < pts.length && i < j)) {
    return { ok: false, method, why: 'Choose two different rows for the interval.' }
  }
  const a = names.arg
  const at = texLetter(a)
  const f = names.fn
  const ft = texLetter(f)
  const L = SUM_LETTER[method]

  const pieces: SumPiece[] = []
  const termsTex: string[] = []
  const termsText: string[] = []
  const widthTex: string[] = []
  const widthText: string[] = []
  const parts: Num[] = []
  let n = 0
  let sigmaTex = ''
  let sigmaText = ''

  if (method === 'midpoint') {
    const gaps = j - i
    if (gaps % 2 !== 0) {
      return {
        ok: false,
        method,
        why: `Unavailable on ${range(pts[i], pts[j])}: a midpoint sum from a table uses subintervals [${a}ₖ, ${a}ₖ₊₂] whose midpoint ${a}ₖ₊₁ is a row, so it needs an even number of gaps, and this interval has ${gaps}.`,
      }
    }
    for (let k = i; k < j; k += 2) {
      if (!isMid(pts[k].x, pts[k + 1].x, pts[k + 2].x)) {
        const mid = nDiv(nAdd(pts[k].x, pts[k + 2].x), numInt(2))
        return {
          ok: false,
          method,
          why: `Unavailable: the midpoint of ${range(pts[k], pts[k + 2])} is ${numText(mid)}, which is not in the table (the row between them has ${a} = ${pts[k + 1].xText}). A midpoint sum needs every subinterval's midpoint to be a table value.`,
        }
      }
    }
    n = gaps / 2
    const bars: string[] = []
    const barsTex: string[] = []
    for (let m = 1, k = i; k < j; k += 2, m++) {
      const w = nSub(pts[k + 2].x, pts[k].x)
      const h = pts[k + 1]
      parts.push(nMul(w, h.y))
      pieces.push({ x0: pts[k].x.v, x1: pts[k + 2].x.v, h0: h.y.v, h1: h.y.v })
      termsTex.push(`(${texNum(numText(w))})(${texNum(h.yText)})`)
      termsText.push(`(${numText(w)})(${h.yText})`)
      widthTex.push(`\\Delta ${at}_{${m}} = ${texNum(numText(w))}`)
      widthText.push(`Δ${a}${sub(m)} = ${numText(w)}`)
      barsTex.push(`\\bar{${at}}_{${m}} = ${texNum(h.xText)}`)
      bars.push(`${a}̄${sub(m)} = ${h.xText}`)
    }
    widthTex.push(...barsTex)
    widthText.push(...bars)
    sigmaTex = `${L}_{${n}} = \\sum_{m=1}^{${n}} ${ft}(\\bar{${at}}_m)\\,\\Delta ${at}_m`
    sigmaText = `Σ ${f}(${a}̄ₘ)Δ${a}ₘ for m = 1 to ${n}, ${a}̄ₘ the midpoint of the m-th subinterval`
  } else {
    n = j - i
    for (let k = i + 1; k <= j; k++) {
      const p0 = pts[k - 1]
      const p1 = pts[k]
      const w = nSub(p1.x, p0.x)
      const wt = numText(w)
      widthTex.push(`\\Delta ${at}_{${k}} = ${texNum(wt)}`)
      widthText.push(`Δ${a}${sub(k)} = ${wt}`)
      if (method === 'trapezoid') {
        parts.push(nDiv(nMul(w, nAdd(p0.y, p1.y)), numInt(2)))
        pieces.push({ x0: p0.x.v, x1: p1.x.v, h0: p0.y.v, h1: p1.y.v })
        const second = p1.yText.startsWith(MINUS) ? ` - ${texNum(p1.yText.slice(1))}` : ` + ${texNum(p1.yText)}`
        const secondT = p1.yText.startsWith(MINUS) ? ` − ${p1.yText.slice(1)}` : ` + ${p1.yText}`
        termsTex.push(`\\tfrac{1}{2}(${texNum(wt)})(${texNum(p0.yText)}${second})`)
        termsText.push(`½(${wt})(${p0.yText}${secondT})`)
      } else {
        const s = method === 'left' ? p0 : p1
        parts.push(nMul(w, s.y))
        pieces.push({ x0: p0.x.v, x1: p1.x.v, h0: s.y.v, h1: s.y.v })
        termsTex.push(`(${texNum(wt)})(${texNum(s.yText)})`)
        termsText.push(`(${wt})(${s.yText})`)
      }
    }
    const body =
      method === 'left'
        ? `${ft}(${at}_{k-1})`
        : method === 'right'
          ? `${ft}(${at}_k)`
          : `\\frac{${ft}(${at}_{k-1}) + ${ft}(${at}_k)}{2}`
    const bodyT =
      method === 'left' ? `${f}(${a}ₖ₋₁)` : method === 'right' ? `${f}(${a}ₖ)` : `½(${f}(${a}ₖ₋₁) + ${f}(${a}ₖ))`
    sigmaTex = `${L}_{${n}} = \\sum_{k=${i + 1}}^{${j}} ${body}\\,\\Delta ${at}_k`
    sigmaText = `Σ ${bodyT}·Δ${a}ₖ for k = ${i + 1} to ${j}`
  }

  const value = nSum(parts)
  const result = valueText(value)
  const symbol = `${L}${sub(n)}`
  const unit = names.intUnit
  const integralText = `${intText(pts[i], pts[j], names)} ≈ ${result.short}${unit ? ` ${unit}` : ''}`
  const integralTex = `${intTex(pts[i], pts[j], names)} \\approx ${texNum(result.short)}${texUnit(unit)}`
  return {
    ok: true,
    method,
    i,
    j,
    n,
    value,
    pieces,
    symbol,
    symbolTex: `${L}_{${n}}`,
    sigmaTex,
    sigmaText: `${symbol} = ${sigmaText}`,
    widthsTex: widthTex.join(',\\ '),
    widthsText: widthText.join(', '),
    termsTex,
    termsText,
    result,
    text: `${symbol} = ${termsText.join(' + ')} ${result.rhs}`,
    integralText,
    integralTex,
    chip: chipOf(symbol, result),
    estimate: estimateSentence(pts, i, j, method, names, symbol),
  }
}

/**
 * The sum as an aligned TeX block that fits a sidebar: the Σ form, then the
 * terms a few to a line, then the value. `perLine` terms per line.
 */
export function sumTex(s: SumOk, perLine = s.method === 'trapezoid' ? 1 : 2): string {
  const lines: string[] = [`${s.sigmaTex}`]
  for (let k = 0; k < s.termsTex.length; k += perLine) {
    const chunk = s.termsTex.slice(k, k + perLine).join(' + ')
    lines.push(k === 0 ? `&= ${chunk}` : `&\\quad + ${chunk}`)
  }
  lines.push(`&${s.result.rhsTex}`)
  // the Σ line carries the alignment point at its "="
  const first = lines[0].replace(' = ', ' &= ')
  return `\\begin{aligned}${[first, ...lines.slice(1)].join(' \\\\ ')}\\end{aligned}`
}

// ---------------------------------------------------------------------------
// The derivative from a difference quotient
// ---------------------------------------------------------------------------

export interface DerivOk {
  ok: true
  /** The rows the quotient uses. */
  a: TablePt
  b: TablePt
  /** How they were chosen. */
  how: 'between' | 'central' | 'first' | 'last'
  value: Num
  result: ValueText
  /** "r′(6) ≈ (r(9) − r(5))/(9 − 5) = (7.1 − 5.9)/(9 − 5) = 1.2/4 = 0.3 gal/min per min". */
  text: string
  tex: string
  /** "r′(6) ≈". */
  lhs: string
  lhsTex: string
  /** "r'(6) \\approx \\dfrac{r(9) - r(5)}{9 - 5}": the setup a hidden answer leaves. */
  setupTex: string
  /** "r′(6) ≈ 0.3". */
  chip: string
  /** Why these two rows, in a sentence. */
  why: string
  unit: string | null
}

export interface CalcNo {
  ok: false
  why: string
}

/** The quotient (r(b) − r(a))/(b − a), worked: [text, tex, value]. */
function quotient(p: TablePt, q: TablePt, names: TableNames): { text: string; tex: string; lines: string[]; value: Num; result: ValueText } {
  const f = names.fn
  const ft = texLetter(f)
  const dy = nSub(q.y, p.y)
  const dx = nSub(q.x, p.x)
  const value = nDiv(dy, dx)
  const result = valueText(value)
  const minusY = p.yText.startsWith(MINUS) ? `(${p.yText})` : p.yText
  const minusX = p.xText.startsWith(MINUS) ? `(${p.xText})` : p.xText
  const text =
    `(${f}(${q.xText}) − ${f}(${p.xText}))/(${q.xText} − ${minusX}) = (${q.yText} − ${minusY})/(${q.xText} − ${minusX})` +
    ` = ${paren(numText(dy))}/${paren(numText(dx))} ${result.rhs}`
  const lines = [
    `\\dfrac{${ft}(${texNum(q.xText)}) - ${ft}(${texNum(p.xText)})}{${texNum(q.xText)} - ${texNum(minusX)}}`,
    `\\dfrac{${texNum(q.yText)} - ${texNum(minusY)}}{${texNum(q.xText)} - ${texNum(minusX)}}`,
    `\\dfrac{${numTex(dy)}}{${numTex(dx)}} ${result.rhsTex}`,
  ]
  return { text, tex: lines.join(' = '), lines, value, result }
}

/**
 * r′(c) from the table: between two rows, their difference quotient; at an
 * inner row, the quotient of its two neighbours (the symmetric difference
 * quotient); at the first or last row, the one-sided quotient with the next.
 */
export function tableDerivative(pts: readonly TablePt[], c: Num, cText: string, names: TableNames): DerivOk | CalcNo {
  if (pts.length < 2) return { ok: false, why: 'The table needs at least two rows.' }
  const last = pts.length - 1
  const a = names.arg
  if (nCmp(c, pts[0].x) < 0 || nCmp(c, pts[last].x) > 0) {
    return { ok: false, why: `${a} = ${cText} is outside the table, which runs from ${pts[0].xText} to ${pts[last].xText}.` }
  }
  let p = 0
  let q = 1
  let how: DerivOk['how'] = 'between'
  const at = pts.findIndex((pt) => nCmp(pt.x, c) === 0)
  if (at === 0) {
    how = 'first'
  } else if (at === last) {
    p = last - 1
    q = last
    how = 'last'
  } else if (at > 0) {
    p = at - 1
    q = at + 1
    how = 'central'
  } else {
    const k = pts.findIndex((pt) => nCmp(pt.x, c) > 0)
    p = k - 1
    q = k
  }
  const P = pts[p]
  const Qp = pts[q]
  const w = quotient(P, Qp, names)
  const f = names.fn
  const lhs = `${f}′(${cText}) ≈`
  const lhsTex = `${texLetter(f)}'(${texNum(cText)}) \\approx`
  const why =
    how === 'between'
      ? `${a} = ${cText} lies between the rows ${a} = ${P.xText} and ${a} = ${Qp.xText}: the difference quotient of those two.`
      : how === 'central'
        ? `${a} = ${cText} is a row: the quotient of the rows either side of it, ${a} = ${P.xText} and ${a} = ${Qp.xText}.`
        : how === 'first'
          ? `${a} = ${cText} is the first row: the one-sided quotient with the next row, ${a} = ${Qp.xText}.`
          : `${a} = ${cText} is the last row: the one-sided quotient with the row before, ${a} = ${P.xText}.`
  const unit = names.derivUnit
  return {
    ok: true,
    a: P,
    b: Qp,
    how,
    value: w.value,
    result: w.result,
    text: withUnit(`${lhs} ${w.text}`, unit),
    // aligned, one step a line, so it fits a sidebar
    tex: `\\begin{aligned}${lhsTex.replace(/\s*\\approx$/, ' &\\approx ')}${w.lines[0]} \\\\ &= ${w.lines[1]} \\\\ &= ${w.lines[2]}${texUnit(unit)}\\end{aligned}`,
    lhs,
    lhsTex,
    setupTex: `${lhsTex} ${w.lines[0]}`,
    chip: `${f}′(${cText}) ≈ ${w.result.short}`,
    why,
    unit,
  }
}

// ---------------------------------------------------------------------------
// Average value
// ---------------------------------------------------------------------------

export interface AvgOk {
  ok: true
  i: number
  j: number
  /** The trapezoidal sum it divides. */
  trap: SumOk
  value: Num
  result: ValueText
  /** "Average value of r on [0, 12] ≈ (1/(12 − 0))·T₄ = 74.9/12 = 749/120 ≈ 6.242 gal/min". */
  text: string
  /** The setup: "\frac{1}{12 - 0}\int_0^{12} r(t)\,dt \approx \frac{1}{12}\,T_4". */
  setupTex: string
  /** "= \frac{74.9}{12} = \frac{749}{120} \approx 6.242\ \text{gal/min}". */
  valueTex: string
  /** "\frac{1}{12}\,T_{4} = \frac{74.9}{12} = …": the working after the trapezoidal sum. */
  workTex: string
  chip: string
  unit: string | null
}

export function tableAverage(pts: readonly TablePt[], i: number, j: number, names: TableNames): AvgOk | CalcNo {
  const trap = tableSum(pts, i, j, 'trapezoid', names)
  if (!trap.ok) return { ok: false, why: trap.why }
  const A = pts[i]
  const B = pts[j]
  const len = nSub(B.x, A.x)
  const value = nDiv(trap.value, len)
  const result = valueText(value)
  const f = names.fn
  const unit = names.yUnit
  const minusA = A.xText.startsWith(MINUS) ? `(${A.xText})` : A.xText
  const tShort = trap.result.rounded ? numText(trap.value) : trap.result.short
  const text = withUnit(
    `Average value of ${f} on ${range(A, B)} ≈ (1/(${B.xText} − ${minusA}))·${trap.symbol} = ${paren(tShort)}/${paren(numText(len))} ${result.rhs}`,
    unit,
  )
  const setupTex = `\\dfrac{1}{${texNum(B.xText)} - ${texNum(minusA)}}${intTex(A, B, names)} \\approx \\frac{1}{${numTex(len)}}\\,${trap.symbolTex}`
  const valueTex = `= \\frac{${texNum(tShort)}}{${numTex(len)}} ${result.rhsTex}${texUnit(unit)}`
  return {
    ok: true,
    i,
    j,
    trap,
    value,
    result,
    text,
    setupTex,
    valueTex,
    workTex: `\\frac{1}{${numTex(len)}}\\,${trap.symbolTex} ${valueTex}`,
    chip: chipOf('avg', result),
    unit,
  }
}

// ---------------------------------------------------------------------------
// "Must there be …?" — the MVT and the IVT
// ---------------------------------------------------------------------------

export interface MvtResult {
  ok: true
  /** The average rate of change on [a, b] — always computable from two rows. */
  slope: Num
  result: ValueText
  /** "(r(9) − r(2))/(9 − 2) = (7.1 − 5.0)/(9 − 2) = 2.1/7 = 0.3". */
  quotientText: string
  quotientTex: string
  /** The hypothesis was granted, so the theorem's conclusion is stated. */
  holds: boolean
  /** The AP sentence (holds) or what is needed (not granted). */
  statement: string
  /** "slope = 0.3" / "r′(c) = 0.3" — the chip on the board. */
  chip: string
  unit: string | null
}

/**
 * The MVT on the rows i < j. A table never shows that r is differentiable,
 * so the conclusion is stated only when the teacher has granted it
 * (`differentiable`); without it the sentence says what is needed.
 */
export function tableMvt(pts: readonly TablePt[], i: number, j: number, differentiable: boolean, names: TableNames): MvtResult | CalcNo {
  if (!(i >= 0 && j < pts.length && i < j)) return { ok: false, why: 'Choose two different rows.' }
  const A = pts[i]
  const B = pts[j]
  const w = quotient(A, B, names)
  const f = names.fn
  const unit = names.derivUnit
  const open = `(${A.xText}, ${B.xText})`
  const rolle = w.value.q ? w.value.q.n === 0n : w.value.v === 0
  const statement = differentiable
    ? `Because ${f} is differentiable, ${f} is continuous on ${range(A, B)} and differentiable on ${open}. By the Mean Value Theorem there is a value c in ${open} with ${f}′(c) = ${withUnit(`${w.text}`, unit)}.${
        rolle ? ` (Here ${f}(${A.xText}) = ${f}(${B.xText}), so ${f}′(c) = 0: Rolle's theorem.)` : ''
      }`
    : `The Mean Value Theorem needs ${f} continuous on ${range(A, B)} and differentiable on ${open}, which a table cannot show. If the problem states that ${f} is differentiable, check the box above; the average rate of change on ${range(A, B)} is ${w.result.short}${unit ? ` ${unit}` : ''} either way.`
  return {
    ok: true,
    slope: w.value,
    result: w.result,
    quotientText: w.text,
    quotientTex: w.tex,
    holds: differentiable,
    statement,
    chip: differentiable ? chipOf(`${f}′(c)`, w.result) : chipOf('slope', w.result),
    unit,
  }
}

export interface IvtResult {
  ok: true
  /** The target value lies strictly between r(a) and r(b). */
  between: boolean
  /** The target is one of the two values already. */
  attained: boolean
  /** The hypothesis was granted and the target is between: the conclusion is stated. */
  holds: boolean
  statement: string
  /** "r(c) = 15" when it holds, else null. */
  chip: string | null
}

/**
 * The IVT on the rows i < j for a target value. Stated only when the teacher
 * has granted differentiability (hence continuity) and the target lies between
 * the two values; otherwise the sentence says which of the two is missing.
 */
export function tableIvt(
  pts: readonly TablePt[],
  i: number,
  j: number,
  target: Num,
  targetText: string,
  differentiable: boolean,
  names: TableNames,
): IvtResult | CalcNo {
  if (!(i >= 0 && j < pts.length && i < j)) return { ok: false, why: 'Choose two different rows.' }
  const A = pts[i]
  const B = pts[j]
  const f = names.fn
  const lo = nCmp(A.y, B.y) <= 0 ? A : B
  const hi = lo === A ? B : A
  const attained = nCmp(target, A.y) === 0 || nCmp(target, B.y) === 0
  const between = nCmp(lo.y, target) < 0 && nCmp(target, hi.y) < 0
  const open = `(${A.xText}, ${B.xText})`
  const T = targetText
  const unit = names.yUnit
  const vals = `${f}(${A.xText}) = ${A.yText} and ${f}(${B.xText}) = ${B.yText}`
  let statement: string
  if (attained) {
    const hit = nCmp(target, A.y) === 0 ? A : B
    statement = `No theorem is needed: ${f}(${hit.xText}) = ${hit.yText} already.`
  } else if (!between) {
    statement = `The Intermediate Value Theorem does not apply: ${T} is not between ${vals}. (${f} may still take the value ${T}; the theorem just does not promise it.)`
  } else if (!differentiable) {
    statement = `The Intermediate Value Theorem needs ${f} continuous on ${range(A, B)}, which a table cannot show. If the problem states that ${f} is differentiable (so continuous), check the box above.`
  } else {
    statement = `Because ${f} is differentiable, ${f} is continuous on ${range(A, B)}. Since ${f}(${lo.xText}) = ${lo.yText} < ${T} < ${hi.yText} = ${f}(${hi.xText}), by the Intermediate Value Theorem there is a value c in ${open} with ${f}(c) = ${withUnit(T, unit)}.`
  }
  const holds = between && differentiable
  return { ok: true, between, attained, holds, statement, chip: holds ? `${f}(c) = ${T}` : null }
}

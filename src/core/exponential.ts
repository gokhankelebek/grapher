// ============================================================================
// Exponential functions, the way a precalculus class states them
// (src/core/exponential.ts)
//
//     y = a·b^((x − h)/p) + k
//
//   a  initial value (the value at x = h when k = 0), "starts at 200"
//   b  growth factor per p units: 1.05 grows 5%, 1/2 halves, 2 doubles
//   p  the period b applies over: "per year" p = 1, "halves every 5.7" p = 5.7
//   h  horizontal shift, k the horizontal asymptote y = k
//
// Like the factored form, everything visible is still a TYPED EXPRESSION:
// a spec becomes source text and goes through the ordinary parser, so the
// horizontal asymptote, intercepts, exact forms, intersections, end caps and
// the exam figures all apply unchanged. This module is the bridge between
// that text and the quantities a teacher states — including every way of
// stating the rate.
//
//   export function expSource(spec): string
//       spec → canonical parseable source: "y = 200(1/2)^(x/5.7) + 10",
//       "y = 3(1.05)^x", "f(x) = -2(3)^(x - 1) - 4", "y = 5e^(0.2x)"
//       (base e written as e^(r·x) — see ExpSpec.base). Numbers keep the text
//       the teacher gave them.
//   export function readExponential(src): ExpSpec | null
//       the inverse for any typed explicit expression of the shape
//       a·b^(linear in x) + k (also e^(…), b^x·a, a/b^x, and 2^(x+3) with the
//       shift folded into a or h as the canonical form chooses); null for
//       anything else. Must round-trip expSource.
//   export function rateOf(spec): ExpRate
//       every reading of the rate at once: growth factor per 1 unit,
//       percent change per unit ("grows 5.00% per unit", "decays 50.0% per
//       5.7 units"), continuous rate r = ln(b)/p, and the doubling time or
//       half-life (whichever applies), each numeric and as a sentence.
//   export function expFromTwoPoints(p1, p2, k = 0): ExpSpec | null
//       the exponential through two points with asymptote y = k; null when
//       the points are on opposite sides of k, on it, or share an x.
//   export function expFromRate(init, rate, k = 0): ExpSpec
//       build from an initial value and one statement of the rate (see
//       RateStatement): a factor, a percent, a doubling time, a half-life,
//       a continuous rate.
//   export function expFeatures(spec): ExpFeatures
//       y-intercept, horizontal asymptote, increasing/decreasing, concavity,
//       domain/range sentences, end behaviour — the card's summary.
// ============================================================================

import { evalAst, parseAst, type ExprNode } from './parse'

export interface ExpSpec {
  /** The function's name when typed as f(x) = …; absent for y = … */
  name?: string
  /** Initial value multiplier, as written ("200", "-3", "1/2"). */
  a: string
  /**
   * The base as written ("1.05", "1/2", "3"). The string "e" means the
   * natural base, and then `rate` is the continuous rate and p is 1.
   */
  b: string
  /** Continuous rate r for base e (y = a·e^(r(x − h)) + k). */
  rate?: string
  /** Period of the base, default "1". */
  p: string
  /** Horizontal shift, default "0". */
  h: string
  /** Horizontal asymptote, default "0". */
  k: string
}

export type RateStatement =
  | { kind: 'factor'; b: string; per?: string } // b per `per` units
  | { kind: 'percent'; pct: string; grows: boolean; per?: string } // 5% per year
  | { kind: 'doubling'; time: string }
  | { kind: 'half-life'; time: string }
  | { kind: 'continuous'; r: string } // y = a·e^(rx)

export interface ExpRate {
  /** Growth factor per one unit of x. */
  perUnit: number
  /** Percent change per one unit, signed (+5 grows, −50 decays). */
  percentPerUnit: number
  /** Continuous rate ln(b)/p. */
  continuous: number
  /** Doubling time when growing, else null. */
  doubling: number | null
  /** Half-life when decaying, else null. */
  halfLife: number | null
  /** Teacher sentences, true minus signs, ≤ 4 significant digits. */
  sentences: string[]
}

export interface ExpFeatures {
  yIntercept: number | null
  asymptote: number
  increasing: boolean
  concaveUp: boolean
  /** "all real numbers", "y > 10", "y < −4" */
  domain: string
  range: string
  endBehaviour: string
}

// ============================================================================
// Implementation
//
// Canonical source (expSource):
//   head      `y = ` or `name(x) = `.
//   a         omitted for 1, `-` for −1; written bare when it is a plain
//             number, a simple fraction n/d, a constant (pi, e), one function
//             call (sqrt(3)) or a number times one of those (2pi), each with
//             an optional leading minus; otherwise parenthesised: (sqrt(3)/2).
//   base      `e` for the natural base. A single integer ≥ 2 is written bare
//             ONLY when nothing stands in front of it (y = 2^x, y = -2^x);
//             after a coefficient, and always for a decimal, a fraction or
//             anything else, it is parenthesised: 3(2)^x, (1.05)^x, (1/2)^x.
//   exponent  X = x, or x - h / x + |h| (x - (h) when h is a sum).
//             p = 1          → X                      2^x, 2^(x - 1)
//             p = 1/n exact  → nX                     2^(2x), 2^(2(x + 1))
//             otherwise      → X/p (p parenthesised when not one atom)
//                                                     (1/2)^(x/5.7), 2^((x - 1)/(7/3))
//             p < 0          → the same with a leading minus: 3^(-x/2).
//             Base e: rate·X (and /p if p ≠ 1): e^(0.2x), e^(-0.2(x - 1)),
//             e^x, e^(-x), e^(1/2x), e^((sqrt(2)/2)x).
//             The exponent is parenthesised unless it is the bare `x`.
//   k         omitted for 0; ` - s` for "-s" with s a single term, ` + (…)`
//             for a sum, else ` + k`.
//   Numbers keep the teacher's text throughout (1.05 stays 1.05, 1/2 stays
//   1/2); the only rewriting is p = 1/n → the integer multiplier n.
//
// Reading (readExponential): the body (after `y =`, `f(x) =`, or bare) is a
// sum of constant terms and exactly ONE term that is a product/quotient of
// constants and powers b^u with u linear in the variable (b^u, e^u, exp(u)).
// Several powers in one product are folded into one base ONLY when they
// share the same exponent (2^x·3^x → 6^x, 2^x/3^x → (2/3)^x, e^x·e^x →
// e^(2x)); powers with different exponents → null. Then:
//   * the constant terms, with their signs, are k (text kept when there is
//     one; several fold into one exact number: 3·2^x − 1 + 2 → k = 1);
//   * the constant factors are a (coefficientText, same rules as factored.ts);
//     a/b^u reads as a·b^(−u);
//   * u is peeled into  sign · Π K / Π P · (c·x + d):
//       h = −d/c (the text of the root of the innermost linear part:
//           x − 1 → "1", x + 3 → "−3"): 2^(x + 3) keeps the shift in h;
//       the total x-coefficient C = sign·ΠK/ΠP·c;
//   * a NEGATIVE C on a base other than e is read the textbook way: the base
//     is inverted and C made positive: 2^(−x) → (1/2)^x, (1/2)^(−x) → 2^x,
//     0.8^(−x) → (1.25)^x, 1.05^(−x) → (20/21)^x. Base e keeps a negative
//     rate: e^(−0.5x) has rate −0.5.
//   * p = 1/C (the cx + d → (x − h)/p rule):
//       – u written as X/P or (x ± q)/P (one divisor, x-coefficient 1):
//         p is P's own text ("5.7", "pi", "7/3");
//       – C an exact rational: 1/C an integer → "N"; C an integer → "1/N";
//         1/C a terminating decimal (≤ 6 places) → that decimal (2x/5 →
//         "2.5"); otherwise the decimal of 1/C at 12 significant digits;
//       – C symbolic of the form 1/P → P's text; otherwise 12 digits.
//     For base e, rate = C instead (p = "1"), written as a decimal when C is
//     a terminating rational that had to be computed (x/2 → "0.5").
//   * The variable: x, or t when the body is written in t (the parser plots
//     y = f(t) as a function of the horizontal variable, so the graph is the
//     same). ExpSpec has no variable slot, so expSource writes x back.
//   * Safety net: the reading is evaluated against the typed body at nine
//     points; any disagreement → null, so a misread is never shown.
// ============================================================================

// ----------------------------------------------------------------------------
// Exact rationals (copied from factored.ts, which keeps them private)
// ----------------------------------------------------------------------------

type Rat = readonly [number, number] // [numerator, denominator > 0], reduced

const RAT_LIMIT = 1e12

function gcd(a: number, b: number): number {
  a = Math.abs(a); b = Math.abs(b)
  while (b) { const t = a % b; a = b; b = t }
  return a
}

function rat(n: number, d: number): Rat | null {
  if (!Number.isInteger(n) || !Number.isInteger(d) || d === 0) return null
  if (Math.abs(n) > RAT_LIMIT || Math.abs(d) > RAT_LIMIT) return null
  if (d < 0) { n = -n; d = -d }
  const g = gcd(n, d) || 1
  return [n / g + 0, d / g]
}

const rAdd = (a: Rat, b: Rat) => rat(a[0] * b[1] + b[0] * a[1], a[1] * b[1])
const rMul = (a: Rat, b: Rat) => rat(a[0] * b[0], a[1] * b[1])
const rDiv = (a: Rat, b: Rat) => (b[0] === 0 ? null : rat(a[0] * b[1], a[1] * b[0]))
const rNeg = (a: Rat): Rat => [-a[0] + 0, a[1]]
const rVal = (a: Rat) => a[0] / a[1]

function rPow(a: Rat, e: number): Rat | null {
  let out: Rat | null = [1, 1]
  const base = e < 0 ? rDiv([1, 1], a) : a
  if (!base) return null
  for (let i = 0; i < Math.abs(e) && out; i++) out = rMul(out, base)
  return out
}

function ratText(r: Rat): string {
  return r[1] === 1 ? String(r[0]) : `${r[0]}/${r[1]}`
}

/** A terminating decimal (≤ `places` places) when the denominator is 2^i·5^j. */
function terminating(r: Rat, places = 6): string | null {
  let d = r[1]
  let twos = 0
  let fives = 0
  while (d % 2 === 0) { d /= 2; twos++ }
  while (d % 5 === 0) { d /= 5; fives++ }
  if (d !== 1 || Math.max(twos, fives) > places) return null
  return String(r[0] / r[1])
}

/** An integer, else a terminating decimal, else n/d. */
function ratDecText(r: Rat): string {
  return r[1] === 1 ? String(r[0]) : terminating(r) ?? ratText(r)
}

/** Exact value of a node built from integers, decimals and + − × ÷ ^int. */
function ratOf(n: ExprNode): Rat | null {
  switch (n.t) {
    case 'num': {
      if (/^\d+$/.test(n.raw)) return rat(Number(n.raw), 1)
      const m = /^(\d*)\.(\d+)$/.exec(n.raw)
      if (m && m[2].length <= 9) return rat(Number(m[1] + m[2]), Math.pow(10, m[2].length))
      return Number.isInteger(n.v) ? rat(n.v, 1) : null
    }
    case 'neg': {
      const a = ratOf(n.a)
      return a && rNeg(a)
    }
    case 'bin': {
      const a = ratOf(n.a)
      if (!a) return null
      if (n.op === '^') {
        const e = ratOf(n.b)
        return e && e[1] === 1 && Math.abs(e[0]) <= 16 ? rPow(a, e[0]) : null
      }
      const b = ratOf(n.b)
      if (!b) return null
      switch (n.op) {
        case '+': return rAdd(a, b)
        case '-': return rAdd(a, rNeg(b))
        case '*': return rMul(a, b)
        case '/': return rDiv(a, b)
      }
      return null
    }
    default:
      return null
  }
}

/** Nearest simple fraction (denominator ≤ maxDen) when `v` IS one, else null. */
function snapRat(v: number, maxDen = 1000, tol = 1e-12): Rat | null {
  if (!Number.isFinite(v)) return null
  for (let d = 1; d <= maxDen; d++) {
    const n = Math.round(v * d)
    if (Math.abs(n / d - v) <= tol * Math.max(1, Math.abs(v))) return rat(n, d)
  }
  return null
}

/** 12 significant digits, no trailing zeros. */
const dec12 = (v: number): string => String(Number(v.toPrecision(12)))

// ----------------------------------------------------------------------------
// AST helpers (copied from factored.ts)
// ----------------------------------------------------------------------------

const numNode = (k: number): ExprNode => ({ t: 'num', v: k, raw: String(k) })

function ratNode(r: Rat): ExprNode {
  const mag: ExprNode =
    r[1] === 1
      ? numNode(Math.abs(r[0]))
      : { t: 'bin', op: '/', a: numNode(Math.abs(r[0])), b: numNode(r[1]) }
  return r[0] < 0 ? { t: 'neg', a: mag } : mag
}

/** Mentions a variable or a free constant (anything that is not a number). */
function hasVar(n: ExprNode): boolean {
  switch (n.t) {
    case 'var': return true
    case 'param': return true
    case 'neg': return hasVar(n.a)
    case 'bin': return hasVar(n.a) || hasVar(n.b)
    case 'call': return n.args.some(hasVar)
    default: return false
  }
}

/** Uses only the variable `v` (no params, no other variables). */
function onlyVar(n: ExprNode, v: string): boolean {
  switch (n.t) {
    case 'var': return n.name === v
    case 'param': return false
    case 'neg': return onlyVar(n.a, v)
    case 'bin': return onlyVar(n.a, v) && onlyVar(n.b, v)
    case 'call': return n.args.every((m) => onlyVar(m, v))
    default: return true
  }
}

function usesVar(n: ExprNode, v: string): boolean {
  switch (n.t) {
    case 'var': return n.name === v
    case 'neg': return usesVar(n.a, v)
    case 'bin': return usesVar(n.a, v) || usesVar(n.b, v)
    case 'call': return n.args.some((m) => usesVar(m, v))
    default: return false
  }
}

function prec(n: ExprNode): number {
  switch (n.t) {
    case 'neg': return 1
    case 'bin':
      return n.op === '+' || n.op === '-' ? 1 : n.op === '^' ? 3 : 2
    default:
      return 4
  }
}

/** Print a node back to source the parser reads the same way. */
function srcOf(n: ExprNode): string {
  switch (n.t) {
    case 'num': return n.raw
    case 'const': return n.name
    case 'var': return n.name
    case 'param': return n.name
    case 'call': return `${n.fn}(${n.args.map(srcOf).join(', ')})`
    case 'neg': {
      const s = srcOf(n.a)
      return prec(n.a) < 2 || s.startsWith('-') ? `-(${s})` : `-${s}`
    }
    case 'bin': {
      const ls = srcOf(n.a)
      const rs = srcOf(n.b)
      const rWrap = (min: number) => (prec(n.b) < min || rs.startsWith('-') ? `(${rs})` : rs)
      switch (n.op) {
        case '+': return `${ls}+${rWrap(1)}`
        case '-': return `${ls}-${rWrap(2)}`
        case '*': {
          const l = prec(n.a) < 2 && n.a.t !== 'neg' ? `(${ls})` : ls
          const r = rWrap(2)
          return `${l}${joinSep(l, r)}${r}`
        }
        case '/': {
          const l = prec(n.a) < 2 && n.a.t !== 'neg' ? `(${ls})` : ls
          return `${l}/${rWrap(3)}`
        }
        case '^': {
          const b = prec(n.a) < 4 ? `(${ls})` : ls
          const e = prec(n.b) < 4 ? `(${rs})` : rs
          return `${b}^${e}`
        }
      }
    }
  }
  return ''
}

/** How to glue two juxtaposed factors so the tokenizer splits them back. */
function joinSep(l: string, r: string): string {
  if (/^[0-9.]/.test(r)) return '*'
  // "2e" followed by digits would lex as scientific notation; `e^` never does
  if (/[0-9]$/.test(l) && /^e(?!\^)/.test(r)) return '*'
  if (/[A-Za-z]$/.test(l) && /^[A-Za-z]/.test(r)) return ' '
  return ''
}

// ----------------------------------------------------------------------------
// Constants carried with their text: C = value + exact form + a node to print
// ----------------------------------------------------------------------------

interface C { v: number; r: Rat | null; n: ExprNode }

const cRat = (r: Rat): C => ({ v: rVal(r), r, n: ratNode(r) })
const ONE = cRat([1, 1])
const isRat = (c: C, k: number) => c.r !== null && c.r[1] === 1 && c.r[0] === k

function cOf(n: ExprNode): C {
  const r = ratOf(n)
  return { v: evalAst(n, NaN), r, n }
}

function cNeg(c: C): C {
  return {
    v: -c.v,
    r: c.r && rNeg(c.r),
    n: c.n.t === 'neg' ? c.n.a : { t: 'neg', a: c.n },
  }
}

function cSum(cs: C[]): C {
  if (cs.length === 0) return cRat([0, 1])
  if (cs.length === 1) return cs[0]
  let exact: Rat | null = [0, 1]
  const sym: C[] = []
  for (const c of cs) {
    if (c.r && exact) exact = rAdd(exact, c.r)
    else sym.push(c)
  }
  const v = cs.reduce((s, c) => s + c.v, 0)
  if (!exact) return { v, r: null, n: numNode(Number(dec12(v))) }
  if (sym.length === 0) return cRat(exact)
  let node: ExprNode | null = exact[0] === 0 ? null : ratNode(exact)
  for (const c of sym) {
    if (node === null) node = c.n
    else if (c.n.t === 'neg') node = { t: 'bin', op: '-', a: node, b: c.n.a }
    else node = { t: 'bin', op: '+', a: node, b: c.n }
  }
  return { v, r: null, n: node! }
}

/** a·b keeping text: a factor of ±1 leaves the other's text untouched. */
function cMul(a: C, b: C): C {
  if (isRat(a, 1)) return b
  if (isRat(b, 1)) return a
  if (isRat(a, -1)) return cNeg(b)
  if (isRat(b, -1)) return cNeg(a)
  if (a.r && b.r) {
    const m = rMul(a.r, b.r)
    if (m) return cRat(m)
  }
  return { v: a.v * b.v, r: null, n: { t: 'bin', op: '*', a: a.n, b: b.n } }
}

function cDiv(a: C, b: C): C {
  if (isRat(b, 1)) return a
  if (isRat(b, -1)) return cNeg(a)
  if (a.r && b.r) {
    const q = rDiv(a.r, b.r)
    if (q) return cRat(q)
  }
  return { v: a.v / b.v, r: null, n: { t: 'bin', op: '/', a: a.n, b: b.n } }
}

const cText = (c: C): string => srcOf(c.n)

/** |c|, keeping text. */
const cAbs = (c: C): C => (c.v < 0 ? cNeg(c) : c)

// ----------------------------------------------------------------------------
// Constant strings
// ----------------------------------------------------------------------------

const valueCache = new Map<string, number>()

/** Numeric value of a constant string ("sqrt(2)", "-1/2", "2pi", "e"); NaN if not. */
function valueOf(s: string | undefined): number {
  const key = (s ?? '').trim()
  const hit = valueCache.get(key)
  if (hit !== undefined) return hit
  let v = NaN
  const ast = parseAst(key)
  if (ast.ok && ast.rhs === null && !hasVar(ast.lhs)) v = evalAst(ast.lhs, NaN)
  if (!Number.isFinite(v)) v = NaN
  if (valueCache.size > 500) valueCache.clear()
  valueCache.set(key, v)
  return v
}

function exactOf(s: string): Rat | null {
  const ast = parseAst(s.trim())
  return ast.ok && ast.rhs === null ? ratOf(ast.lhs) : null
}

function nodeOf(s: string): ExprNode | null {
  const ast = parseAst(s.trim())
  return ast.ok && ast.rhs === null && !hasVar(ast.lhs) ? ast.lhs : null
}

const isExactly = (s: string, k: number): boolean => {
  const r = exactOf(s)
  return r !== null && r[1] === 1 && r[0] === k
}

/** Blank or missing → the default. */
const txt = (s: string | undefined, dflt: string): string => {
  const t = (s ?? '').trim()
  return t === '' ? dflt : t
}

const isE = (spec: ExpSpec): boolean => txt(spec.b, '').trim() === 'e'

/** The value of the spec's function at x (NaN when a part is not a number). */
function specAt(spec: ExpSpec, x: number): number {
  const a = valueOf(txt(spec.a, '1'))
  const p = valueOf(txt(spec.p, '1'))
  const h = valueOf(txt(spec.h, '0'))
  const k = valueOf(txt(spec.k, '0'))
  if (isE(spec)) {
    const r = valueOf(txt(spec.rate, '1'))
    return a * Math.exp((r * (x - h)) / p) + k
  }
  const b = valueOf(spec.b)
  return a * Math.pow(b, (x - h) / p) + k
}

// ----------------------------------------------------------------------------
// expSource
// ----------------------------------------------------------------------------

/** a written bare in front of the power? (see the rules at the top) */
function bareCoefficient(a: string): boolean {
  const ast = parseAst(a)
  if (!ast.ok || ast.rhs !== null) return false
  let n = ast.lhs
  if (n.t === 'neg') n = n.a
  const unit = (m: ExprNode) => m.t === 'const' || m.t === 'call'
  if (n.t === 'num' || unit(n)) return true
  if (n.t === 'bin' && n.op === '/') return n.a.t === 'num' && n.b.t === 'num'
  if (n.t === 'bin' && n.op === '*') return n.a.t === 'num' && unit(n.b)
  return false
}

/** One atom to the parser (a number, a constant, a call)? */
function atomText(s: string): boolean {
  const n = nodeOf(s)
  return n !== null && prec(n) >= 4
}

/** "x", "x - 1", "x + 3", "x - (1+sqrt(2))". */
function shifted(h: string): string {
  const r = h.replace(/^\+/, '').trim()
  const exact = exactOf(r)
  if (exact && exact[0] === 0) return 'x'
  if (r.startsWith('-')) {
    const s = r.slice(1).trim()
    const rest = parseAst(s)
    if (rest.ok && rest.rhs === null && prec(rest.lhs) >= 2) return `x + ${s}`
  }
  const ast = parseAst(r)
  if (ast.ok && ast.rhs === null && prec(ast.lhs) < 2) return `x - (${r})`
  return `x - ${r}`
}

/** " + 10", " - 4", " - 1/2", " + (1+sqrt(2))", "" for 0. */
function constantTail(k: string): string {
  const r = k.replace(/^\+/, '').trim()
  const exact = exactOf(r)
  if (exact && exact[0] === 0) return ''
  if (r.startsWith('-')) {
    const s = r.slice(1).trim()
    const rest = parseAst(s)
    if (rest.ok && rest.rhs === null && prec(rest.lhs) >= 2) return ` - ${s}`
  }
  const ast = parseAst(r)
  if (ast.ok && ast.rhs === null && prec(ast.lhs) < 2) return ` + (${r})`
  return ` + ${r}`
}

/** The text of −s for a constant string. */
function negText(s: string): string {
  const n = nodeOf(s)
  return n ? cText(cNeg(cOf(n))) : `-(${s})`
}

/** The exponent of a base other than e (without the outer parentheses). */
function periodExponent(X: string, pRaw: string): string {
  let p = pRaw
  let sign = ''
  if (valueOf(p) < 0) { sign = '-'; p = negText(p) }
  const grouped = X === 'x' ? 'x' : `(${X})`
  if (isExactly(p, 1)) return sign ? `-${grouped}` : X
  const r = exactOf(p)
  if (r && r[0] === 1 && r[1] > 1) return `${sign}${r[1]}${grouped}` // p = 1/n → nx
  const divisor = atomText(p) ? p : `(${p})`
  return `${sign}${grouped}/${divisor}`
}

/** The exponent of e: rate·X (/p). */
function rateExponent(X: string, rate: string, p: string): string {
  const grouped = X === 'x' ? 'x' : `(${X})`
  let e: string
  if (isExactly(rate, 1)) e = X
  else if (isExactly(rate, -1)) e = `-${grouped}`
  else {
    const coef = bareCoefficient(rate) ? rate : `(${rate})`
    e = `${coef}${joinSep(coef, grouped)}${grouped}`
  }
  if (isExactly(p, 1)) return e
  const lead = e === X && X !== 'x' ? `(${e})` : e
  return `${lead}/${atomText(p) ? p : `(${p})`}`
}

export function expSource(spec: ExpSpec): string {
  const head = spec.name ? `${spec.name}(x) = ` : 'y = '
  const a = txt(spec.a, '1')
  const b = txt(spec.b, '1')
  const p = txt(spec.p, '1')
  const X = shifted(txt(spec.h, '0'))
  const natural = b === 'e'

  const exponent = natural
    ? rateExponent(X, txt(spec.rate, '1'), p)
    : periodExponent(X, p)
  const power = exponent === 'x' ? 'x' : `(${exponent})`

  const unitA = isExactly(a, 1) ? '' : isExactly(a, -1) ? '-' : null
  let base: string
  if (natural) base = 'e'
  else if (unitA !== null && /^\d+$/.test(b) && Number(b) >= 2) base = b
  else base = `(${b})`
  const pow = `${base}^${power}`

  let term: string
  if (unitA !== null) term = `${unitA}${pow}`
  else {
    const coef = bareCoefficient(a) ? a : `(${a})`
    term = `${coef}${joinSep(coef, pow)}${pow}`
  }
  return `${head}${term}${constantTail(txt(spec.k, '0'))}`
}

// ----------------------------------------------------------------------------
// readExponential
// ----------------------------------------------------------------------------

/** Coefficient of the variable in a single term (2x, x/3, -x); null otherwise. */
function xCoef(n: ExprNode): C | null {
  if (n.t === 'var') return ONE
  if (n.t === 'neg') {
    const k = xCoef(n.a)
    return k && cNeg(k)
  }
  if (n.t === 'bin' && n.op === '*') {
    if (hasVar(n.a) && !hasVar(n.b)) {
      const k = xCoef(n.a)
      return k && cMul(k, cOf(n.b))
    }
    if (hasVar(n.b) && !hasVar(n.a)) {
      const k = xCoef(n.b)
      return k && cMul(cOf(n.a), k)
    }
  }
  if (n.t === 'bin' && n.op === '/' && hasVar(n.a) && !hasVar(n.b)) {
    const k = xCoef(n.a)
    return k && cDiv(k, cOf(n.b))
  }
  return null
}

/** Split a linear sum into its x-terms and its constant terms (text kept). */
function linearTerms(n: ExprNode, sign: 1 | -1, ks: C[], cs: C[]): boolean {
  if (!hasVar(n)) {
    const c = cOf(n)
    cs.push(sign < 0 ? cNeg(c) : c)
    return true
  }
  if (n.t === 'bin' && (n.op === '+' || n.op === '-')) {
    return (
      linearTerms(n.a, sign, ks, cs) &&
      linearTerms(n.b, n.op === '-' ? (-sign as 1 | -1) : sign, ks, cs)
    )
  }
  if (n.t === 'neg') return linearTerms(n.a, -sign as 1 | -1, ks, cs)
  const k = xCoef(n)
  if (!k) return false
  ks.push(sign < 0 ? cNeg(k) : k)
  return true
}

interface Linear {
  /** Total coefficient of the variable. */
  c: C
  /** Where the exponent is 0 (the shift h). */
  h: C
  /** The single divisor P when u is written X/P with coefficient ±1 on x. */
  divisor: C | null
}

/** u = sign · ΠK / ΠP · (c·x + d), with the text of each piece kept. */
function readLinear(u: ExprNode): Linear | null {
  let sign = 1
  const mults: C[] = []
  const divs: C[] = []
  let n = u
  for (;;) {
    if (n.t === 'neg') { sign = -sign; n = n.a; continue }
    if (n.t === 'bin' && n.op === '*' && !hasVar(n.a)) { mults.push(cOf(n.a)); n = n.b; continue }
    if (n.t === 'bin' && n.op === '*' && !hasVar(n.b)) { mults.push(cOf(n.b)); n = n.a; continue }
    if (n.t === 'bin' && n.op === '/' && !hasVar(n.b)) { divs.push(cOf(n.b)); n = n.a; continue }
    break
  }
  const ks: C[] = []
  const cs: C[] = []
  if (!linearTerms(n, 1, ks, cs) || ks.length === 0) return null
  const cL = cSum(ks)
  if (!Number.isFinite(cL.v) || cL.v === 0) return null
  const h = cDiv(cSum(cs.map(cNeg)), cL)

  let S: C = sign < 0 ? cNeg(ONE) : ONE
  for (const K of mults) S = cMul(S, K)
  for (const P of divs) S = cDiv(S, P)
  const c = cMul(S, cL)
  if (!Number.isFinite(c.v) || c.v === 0 || !Number.isFinite(h.v)) return null
  const unitX = isRat(cL, 1) || isRat(cL, -1)
  const divisor = mults.length === 0 && divs.length === 1 && unitX ? cAbs(divs[0]) : null
  return { c, h, divisor }
}

/** The period p = 1/C for a positive coefficient C (see the rules at the top). */
function periodText(c: C, divisor: C | null): string {
  if (divisor) return cText(divisor)
  if (c.r) {
    const inv: Rat = [c.r[1], c.r[0]]
    if (inv[1] === 1) return String(inv[0])
    if (inv[0] === 1) return ratText(inv)
    return terminating(inv) ?? dec12(1 / c.v)
  }
  if (c.n.t === 'bin' && c.n.op === '/') {
    const one = ratOf(c.n.a)
    if (one && one[0] === 1 && one[1] === 1) return srcOf(c.n.b)
  }
  return dec12(1 / c.v)
}

/** 1/b as text: 2 → "1/2", 1/2 → "2", 0.8 → "1.25", 1.05 → "20/21". */
function invertBase(b: C): string {
  if (b.r) {
    const inv: Rat = [b.r[1], b.r[0]]
    if (inv[1] === 1) return String(inv[0])
    const decimal = b.n.t === 'num' && b.n.raw.includes('.')
    return (decimal && terminating(inv)) || ratText(inv)
  }
  if (b.n.t === 'bin' && b.n.op === '/') {
    const one = ratOf(b.n.a)
    if (one && one[0] === 1 && one[1] === 1) return srcOf(b.n.b)
  }
  const s = srcOf(b.n)
  return `1/${prec(b.n) >= 3 ? s : `(${s})`}`
}

/**
 * The product of the constant leaves (with their powers) and the sign, as
 * text (copied from factored.ts). One leaf with power 1 keeps its own text
 * (0.5 stays 0.5); otherwise exact parts combine into one fraction in front
 * of the symbolic ones.
 */
function coefficientText(sign: number, consts: { c: C; p: number }[]): string | null {
  let s = sign
  let R: Rat | null = [1, 1]
  const symNum: ExprNode[] = []
  const symDen: ExprNode[] = []
  let v = sign
  const rest: { c: C; p: number }[] = []
  for (const { c, p } of consts) {
    v *= Math.pow(c.v, p)
    if (c.r && Math.abs(c.r[0]) === 1 && c.r[1] === 1) {
      if (c.r[0] < 0 && Math.abs(p) % 2 === 1) s = -s
      continue
    }
    rest.push({ c, p })
  }
  if (!Number.isFinite(v) || v === 0) return Number.isFinite(v) ? '0' : null
  if (rest.length === 1 && rest[0].p === 1) {
    let c = rest[0].c
    if (s < 0) c = cNeg(c)
    return cText(c)
  }
  for (const { c, p } of rest) {
    if (c.r && R) {
      R = rPow(c.r, p) && rMul(R, rPow(c.r, p)!)
      continue
    }
    let n = c.n
    if (n.t === 'neg') {
      if (Math.abs(p) % 2 === 1) s = -s
      n = n.a
    }
    const powered: ExprNode = Math.abs(p) === 1 ? n : { t: 'bin', op: '^', a: n, b: numNode(Math.abs(p)) }
    ;(p > 0 ? symNum : symDen).push(powered)
  }
  if (!R) return dec12(v)
  if (R[0] < 0) { s = -s; R = rNeg(R) }
  if (symNum.length === 0 && symDen.length === 0) return ratText(s < 0 ? rNeg(R) : R)
  const prod = (ns: ExprNode[]): ExprNode | null =>
    ns.reduce<ExprNode | null>((acc, m) => (acc ? { t: 'bin', op: '*', a: acc, b: m } : m), null)
  const top = prod([...(R[0] !== 1 ? [numNode(R[0])] : []), ...symNum]) ?? numNode(1)
  const bottom = prod([...(R[1] !== 1 ? [numNode(R[1])] : []), ...symDen])
  const node: ExprNode = bottom ? { t: 'bin', op: '/', a: top, b: bottom } : top
  return srcOf(s < 0 ? { t: 'neg', a: node } : node)
}

/** A power with the variable in its exponent: base^u, e^u, exp(u). */
interface PowerLeaf { base: ExprNode | 'e'; u: ExprNode; p: 1 | -1 }

/** Split a sum into signed terms. */
function sumTerms(n: ExprNode, sign: 1 | -1, out: { n: ExprNode; s: 1 | -1 }[]): void {
  if (n.t === 'bin' && (n.op === '+' || n.op === '-')) {
    sumTerms(n.a, sign, out)
    sumTerms(n.b, n.op === '-' ? (-sign as 1 | -1) : sign, out)
  } else if (n.t === 'neg' && n.a.t === 'bin' && (n.a.op === '+' || n.a.op === '-')) {
    sumTerms(n.a, -sign as 1 | -1, out)
  } else {
    out.push({ n, s: sign })
  }
}

const SAMPLES = [-2.71, -1.13, -0.37, 0, 0.29, 0.83, 1.61, 2.2, 3.07]

export function readExponential(src: string): ExpSpec | null {
  if (!src || src.includes('{') || /\b(for|if|where|when)\b/.test(src)) return null
  const ast = parseAst(src)
  if (!ast.ok) return null

  // ---- head: y = …, f(x) = … / f(t) = …, or a bare expression ------------
  let name: string | undefined
  let body: ExprNode
  let head: 'x' | 't' | null = null
  if (ast.rhs === null) body = ast.lhs
  else if (ast.lhs.t === 'var' && ast.lhs.name === 'y') body = ast.rhs
  else if (
    ast.lhs.t === 'bin' && ast.lhs.op === '*' &&
    ast.lhs.a.t === 'param' && ast.lhs.b.t === 'var' &&
    (ast.lhs.b.name === 'x' || ast.lhs.b.name === 't')
  ) {
    name = ast.lhs.a.name
    head = ast.lhs.b.name
    body = ast.rhs
  } else return null
  // the variable: x, or t when the body is written in t (see the notes)
  const v = head ?? (usesVar(body, 't') && !usesVar(body, 'x') ? 't' : 'x')
  if (!onlyVar(body, v) || !usesVar(body, v)) return null

  // ---- the sum: constants (k) and exactly one exponential term ------------
  const terms: { n: ExprNode; s: 1 | -1 }[] = []
  sumTerms(body, 1, terms)
  const constants: C[] = []
  let term: { n: ExprNode; s: 1 | -1 } | null = null
  for (const t of terms) {
    if (!hasVar(t.n)) constants.push(t.s < 0 ? cNeg(cOf(t.n)) : cOf(t.n))
    else if (term) return null // 2^x + 3^x, 2^x + x
    else term = t
  }
  if (!term) return null

  // ---- the term: constant factors and powers b^u -------------------------
  let sign = term.s as number
  const consts: { c: C; p: number }[] = []
  const leaves: PowerLeaf[] = []
  const flatten = (n: ExprNode, p: 1 | -1): boolean => {
    if (!hasVar(n)) {
      consts.push({ c: cOf(n), p })
      return true
    }
    if (n.t === 'neg') { sign = -sign; return flatten(n.a, p) }
    if (n.t === 'bin' && n.op === '*') return flatten(n.a, p) && flatten(n.b, p)
    if (n.t === 'bin' && n.op === '/') return flatten(n.a, p) && flatten(n.b, -p as 1 | -1)
    if (n.t === 'bin' && n.op === '^' && !hasVar(n.a)) {
      leaves.push({ base: n.a.t === 'const' && n.a.name === 'e' ? 'e' : n.a, u: n.b, p })
      return true
    }
    if (n.t === 'call' && n.fn === 'exp') {
      leaves.push({ base: 'e', u: n.args[0], p })
      return true
    }
    return false // x·2^x, (2^x)^2, 2^x inside sqrt, …
  }
  if (!flatten(term.n, 1) || leaves.length === 0) return null

  // ---- exponents: all linear, and all the same when there are several ----
  const lins: Linear[] = []
  for (const leaf of leaves) {
    const lin = readLinear(leaf.u)
    if (!lin) return null // 2^(x^2), 2^(1/x)
    lins.push(lin)
  }
  const lin = lins[0]
  const same = (u: number, w: number) => Math.abs(u - w) <= 1e-12 * Math.max(1, Math.abs(u))
  if (!lins.every((l) => same(l.c.v, lin.c.v) && same(l.h.v, lin.h.v))) return null

  // ---- the base (products of powers with one exponent fold into one) -----
  let natural: boolean
  let baseC: C | null = null
  let eCount = 0 // net power of e for a pure-e product
  if (leaves.every((l) => l.base === 'e')) {
    natural = true
    for (const l of leaves) eCount += l.p
    if (eCount === 0) return null // e^x / e^x
  } else {
    natural = false
    for (const l of leaves) {
      const bc = l.base === 'e' ? cOf({ t: 'const', name: 'e' }) : cOf(l.base)
      const powered = l.p > 0 ? bc : cDiv(ONE, bc)
      baseC = baseC ? cMul(baseC, powered) : powered
    }
    if (!baseC || !Number.isFinite(baseC.v) || baseC.v <= 0 || same(baseC.v, 1)) return null
  }

  // ---- assemble ------------------------------------------------------------
  const a = coefficientText(sign, consts)
  if (a === null || a === '0') return null
  const k = constants.length === 0 ? '0' : cText(cSum(constants))
  const h = lin.h.v === 0 ? '0' : cText(lin.h)

  const spec: ExpSpec = { a, b: '', p: '1', h, k }
  if (natural) {
    let rate = eCount === 1 ? lin.c : cMul(cRat([eCount, 1]), lin.c)
    if (rate.r && rate.n.t !== 'num' && !(rate.n.t === 'neg' && rate.n.a.t === 'num')) {
      rate = { ...rate, n: nodeOf(ratDecText(rate.r))! }
    }
    spec.b = 'e'
    spec.rate = cText(rate)
  } else {
    let c = lin.c
    let b = cText(baseC!)
    if (c.v < 0) {
      // the textbook reading: 2^(−x) is (1/2)^x
      b = invertBase(baseC!)
      c = cNeg(c)
    }
    spec.b = b
    spec.p = periodText(c, lin.divisor)
  }
  if (name) spec.name = name

  // ---- safety net: the reading must BE the typed function ----------------
  for (const x of SAMPLES) {
    const want = evalAst(body, x)
    const got = specAt(spec, x)
    if (!Number.isFinite(want) || Math.abs(want) > 1e12) continue
    if (!Number.isFinite(got)) return null
    if (Math.abs(want - got) > 1e-7 * Math.max(1, Math.abs(want))) return null
  }
  return spec
}

// ----------------------------------------------------------------------------
// Numbers for sentences
// ----------------------------------------------------------------------------

const MINUS = '−'

/** 4 significant digits, trailing zeros dropped, true minus. */
function fmt4(v: number): string {
  if (v === Infinity) return '∞'
  if (v === -Infinity) return `${MINUS}∞`
  const s = String(Number(v.toPrecision(4)))
  return s.replace('-', MINUS)
}

/** "unit" / "5.7 units". */
const units = (v: number): string => (fmt4(v) === '1' ? 'unit' : `${fmt4(v)} units`)

// ----------------------------------------------------------------------------
// rateOf
// ----------------------------------------------------------------------------

export function rateOf(spec: ExpSpec): ExpRate {
  const p = valueOf(txt(spec.p, '1'))
  const natural = isE(spec)
  // continuous rate per unit: ln(b)/p, or r/p for base e
  const continuous = natural
    ? valueOf(txt(spec.rate, '1')) / p
    : Math.log(valueOf(spec.b)) / p
  if (!Number.isFinite(continuous)) {
    return { perUnit: NaN, percentPerUnit: NaN, continuous: NaN, doubling: null, halfLife: null, sentences: [] }
  }
  const perUnit = Math.exp(continuous)
  const percentPerUnit = (perUnit - 1) * 100
  const growing = continuous > 0
  const decaying = continuous < 0
  const doubling = growing ? Math.LN2 / continuous : null
  const halfLife = decaying ? Math.LN2 / -continuous : null

  const sentences: string[] = []
  if (!growing && !decaying) {
    sentences.push('constant: no growth or decay')
  } else {
    const verb = growing ? 'grows' : 'decays'
    const factorWord = growing ? 'growth factor' : 'decay factor'
    const byPeriod = !natural && Number.isFinite(p) && p !== 1 && p > 0
    if (byPeriod) {
      // the teacher's own statement first: "decays by 50% every 5.7 units"
      const b = valueOf(spec.b)
      sentences.push(`${verb} by ${fmt4(Math.abs(b - 1) * 100)}% every ${units(p)}`)
    }
    sentences.push(`${verb} by ${fmt4(Math.abs(percentPerUnit))}% per unit`)
    if (byPeriod) sentences.push(`${factorWord} ${fmt4(valueOf(spec.b))} every ${units(p)}`)
    sentences.push(`${factorWord} ${fmt4(perUnit)} per unit`)
    sentences.push(`continuous rate ${fmt4(continuous * 100)}% per unit`)
    if (doubling !== null) sentences.push(`doubles every ${units(doubling)}`)
    if (halfLife !== null) sentences.push(`half-life ${units(halfLife)}`)
  }
  // a < 0 flips the graph over y = k; the rate words describe |y − k|
  if (valueOf(txt(spec.a, '1')) < 0) sentences.push('reflected: a < 0')
  return { perUnit, percentPerUnit, continuous, doubling, halfLife, sentences }
}

// ----------------------------------------------------------------------------
// expFromTwoPoints
// ----------------------------------------------------------------------------

/**
 * A computed number as text: an integer, a terminating decimal (≤ 6 places),
 * a small fraction (denominator ≤ 100) when it IS one, else 6 significant
 * digits.
 */
function niceText(v: number): string {
  const r = snapRat(v, 100, 1e-9)
  if (r) return ratDecText(r)
  return String(Number(v.toPrecision(6)))
}

const niceExact = (v: number): boolean => snapRat(v, 100, 1e-9) !== null

/**
 * b per unit = ((y2 − k)/(y1 − k))^(1/(x2 − x1)), a = (y1 − k)/b^x1, emitted
 * with h = 0 and p = 1. When a point sits on x = 0, a is that point's height
 * above k exactly. When neither does and a is not a clean number, the curve
 * is anchored at the first point instead (h = x1, a = y1 − k exactly) — the
 * "cleaner a" choice. null when the points share an x, sit on opposite sides
 * of y = k, or either sits on it, and when y1 = y2 (base 1: a line, not an
 * exponential).
 */
export function expFromTwoPoints(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  k = 0,
): ExpSpec | null {
  const { x: x1, y: y1 } = p1
  const { x: x2, y: y2 } = p2
  if (![x1, y1, x2, y2, k].every(Number.isFinite)) return null
  if (x1 === x2) return null
  const d1 = y1 - k
  const d2 = y2 - k
  if (d1 === 0 || d2 === 0 || Math.sign(d1) !== Math.sign(d2)) return null
  if (d1 === d2) return null
  const b = Math.pow(d2 / d1, 1 / (x2 - x1))
  if (!Number.isFinite(b) || b <= 0 || b === 1) return null

  const kText = dec12(k)
  const bText = niceText(b)
  if (x1 === 0) return { a: dec12(d1), b: bText, p: '1', h: '0', k: kText }
  if (x2 === 0) return { a: dec12(d2), b: bText, p: '1', h: '0', k: kText }
  const a = d1 / Math.pow(b, x1)
  if (niceExact(a)) return { a: niceText(a), b: bText, p: '1', h: '0', k: kText }
  return { a: dec12(d1), b: bText, p: '1', h: dec12(x1), k: kText }
}

// ----------------------------------------------------------------------------
// expFromRate
// ----------------------------------------------------------------------------

/** s − t as text, exact when both are rational ("200" − "10" → "190"). */
function differenceText(s: string, t: string): string {
  const tr = exactOf(t)
  if (tr && tr[0] === 0) return s
  const sr = exactOf(s)
  if (sr && tr) {
    const d = rAdd(sr, rNeg(tr))
    if (d) return ratDecText(d)
  }
  const sn = nodeOf(s)
  const tn = nodeOf(t)
  if (sn && tn) return cText(cSum([cOf(sn), cNeg(cOf(tn))]))
  return dec12(valueOf(s) - valueOf(t))
}

/** 1 ± pct/100 as text: "5" grows → "1.05", "20" decays → "0.8". */
function percentBase(pct: string, grows: boolean): string {
  const r = exactOf(pct)
  if (r) {
    const frac = rDiv(r, [100, 1])
    const b = frac && rAdd([1, 1], grows ? frac : rNeg(frac))
    if (b) return ratDecText(b)
  }
  const v = valueOf(pct)
  return dec12(1 + (grows ? v : -v) / 100)
}

/**
 * The teacher's "starts at 200" means f(0) = 200. With h = 0 that is
 * a·b^0 + k = a + k, so a = init − k (and a = init when k = 0).
 */
export function expFromRate(init: string, rate: RateStatement, k = '0'): ExpSpec {
  const kText = txt(k, '0')
  const a = differenceText(txt(init, '1'), kText)
  const base = { a, h: '0', k: kText }
  switch (rate.kind) {
    case 'factor':
      return { ...base, b: txt(rate.b, '1'), p: txt(rate.per, '1') }
    case 'percent':
      return { ...base, b: percentBase(txt(rate.pct, '0'), rate.grows), p: txt(rate.per, '1') }
    case 'doubling':
      return { ...base, b: '2', p: txt(rate.time, '1') }
    case 'half-life':
      return { ...base, b: '1/2', p: txt(rate.time, '1') }
    case 'continuous':
      return { ...base, b: 'e', rate: txt(rate.r, '1'), p: '1' }
  }
}

// ----------------------------------------------------------------------------
// expFeatures
// ----------------------------------------------------------------------------

export function expFeatures(spec: ExpSpec): ExpFeatures {
  const a = valueOf(txt(spec.a, '1'))
  const k = valueOf(txt(spec.k, '0'))
  const y0 = specAt(spec, 0)
  const { perUnit } = rateOf(spec)
  const growing = perUnit > 1
  const decaying = perUnit < 1
  const kf = fmt4(k)

  if (!Number.isFinite(a) || a === 0 || !(growing || decaying)) {
    // degenerate: a constant function
    const c = Number.isFinite(y0) ? fmt4(y0) : '?'
    return {
      yIntercept: Number.isFinite(y0) ? y0 : null,
      asymptote: k,
      increasing: false,
      concaveUp: false,
      domain: 'all real numbers',
      range: `y = ${c}`,
      endBehaviour: `constant: y = ${c}`,
    }
  }
  const up = a > 0
  const far = up ? '∞' : `${MINUS}∞`
  const left = growing ? kf : far
  const right = growing ? far : kf
  return {
    yIntercept: Number.isFinite(y0) ? y0 : null,
    asymptote: k,
    increasing: (up && growing) || (!up && decaying),
    concaveUp: up,
    domain: 'all real numbers',
    range: up ? `y > ${kf}` : `y < ${kf}`,
    endBehaviour: `as x → ${MINUS}∞, y → ${left}; as x → ∞, y → ${right}`,
  }
}

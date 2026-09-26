// ============================================================================
// Sinusoidal functions, the way a precalculus class states them
// (src/core/sinusoidal.ts)
//
//     y = a·sin(b(x − h)) + k        or        y = a·cos(b(x − h)) + k
//
//   |a| amplitude (a < 0 reflects), b the angular frequency, period 2π/|b|,
//   h the phase (horizontal) shift, k the midline y = k.
//
// Sibling of src/core/exponential.ts / logarithmic.ts / factored.ts: a spec
// becomes a TYPED EXPRESSION and goes through the ordinary parser, so the
// analysis (zeros, extrema, inflections — with exact forms like π/4), the
// π-scaled axes, intersections, end caps and the exam figures all apply.
//
// PARSER (additive, same wave, core agent): sec, csc, cot (with their poles
// as singular sources, like tan), and the names arcsin, arccos, arctan as
// aliases of asin, acos, atan — plus sin^2(x)-style powers ONLY if the
// parser can do it without ambiguity (say what you decide).
//
//   export function sinSource(spec): string
//       canonical parseable source: "y = 3sin(2(x - pi/4)) + 1",
//       "y = -cos(x)", "f(x) = 2sin(pi/6 x) - 4" (b written as the teacher
//       gave it: 2, pi/6, 1/2), "y = sin(x + pi/3)" when b = 1.
//   export function readSinusoid(src): SinSpec | null
//       the inverse for any typed a·sin(u) + k / a·cos(u) + k with u linear
//       in x — including sin(2x - pi/2) (h = π/4), cos(3x) + 1, 4 - 2sin(x),
//       and u = (2π/P)(x − h) with P given; verified numerically; null
//       otherwise (sin(x²), sin x + cos x — say whether a·sin + b·cos is
//       folded into one sinusoid: it is one, and the textbook asks for it).
//   export function sinFeatures(spec): SinFeatures
//   export function sinFromParts(p): SinSpec
//       amplitude, period, phase shift, midline (+ which function, and
//       "starts at a maximum / minimum / midline going up / going down",
//       which chooses sin/cos and the sign of a as a textbook does).
//   export function sinFromExtrema(max, min): SinSpec | null
//       an adjacent maximum and minimum point → amplitude, midline, period
//       (twice their x-distance), phase — as cos starting at the max.
//   export function rewriteAs(spec, fn): SinSpec
//       the same function written with the other of sin/cos (shift h by a
//       quarter period), or with a positive a (shift by half a period).
// ============================================================================

import { exactForm } from './exact'
import { evalAst, parseAst, type ExprNode } from './parse'

export type SinFn = 'sin' | 'cos'

export interface SinSpec {
  /** The function's name when typed as f(x) = …; absent for y = … */
  name?: string
  fn: SinFn
  /** Signed amplitude as written ("3", "-1/2"). */
  a: string
  /** Angular frequency as written ("2", "pi/6", "1/2"); period 2π/|b|. */
  b: string
  /** Phase shift as written ("pi/4", "-1", "0"). */
  h: string
  /** Midline as written. */
  k: string
}

export type SinStart = 'max' | 'min' | 'mid-up' | 'mid-down'

export interface SinFeatures {
  amplitude: number
  period: number
  frequency: number
  phaseShift: number
  midline: number
  max: number
  min: number
  /** "−2 ≤ y ≤ 4" */
  range: string
  /**
   * The five key points of the cycle that starts at x = h: start, quarter,
   * half, three quarters, end — with exact text when the numbers are nice
   * multiples of π ("π/4") and the kind of each point.
   */
  keyPoints: { x: number; y: number; xText: string; yText: string; kind: 'max' | 'min' | 'mid' }[]
  /** Teacher sentences: "amplitude 3", "period π", "phase shift π/4 right",
   *  "midline y = 1", "range −2 ≤ y ≤ 4". */
  sentences: string[]
}

// ============================================================================
// Implementation
//
// Syntax (src/core/parse, this wave): sec, csc, cot (poles where cos / sin /
// sin is 0 — singular sources exactly like tan, so holes.ts draws their
// vertical asymptotes); arcsin, arccos, arctan as aliases resolved in the
// parser to asin, acos, atan (one name in the AST, \arcsin on the card, as
// asin always rendered); sin^2(x), cos^3 x, tan^(2)(x) = (sin x)² … for
// sin cos tan sec csc cot — the same AST as sin(x)^2, so the card prints
// \sin\left(x\right)^{2}; sin^-1(x) / sin^(-1)(x) = arcsin (also cos, tan).
// Any other power there (sin^2.5, sin^x, sin^-2, sin^0, sec^-1) is a
// positioned error saying how to write it: (sin(x))^2.5.
//
// Canonical source (sinSource):
//   head      `y = ` or `name(x) = `.
//   argument  X = x, x - h, x + |h| (x - (h) when h is a sum);
//             b = 1 → X;  b = −1 → -x / -(X);  otherwise
//               h = 0:  bx glued when b is a number, a constant, one call or
//                       a number times one (2x, pi x, 2pi x, sqrt(2)x);
//                       a fraction with a space (pi/6 x, 1/2 x);
//                       anything else parenthesised ((1+pi)x);
//               h ≠ 0:  b(X) for the bare kinds (2(x - pi/4)), else (b)(X)
//                       ((pi/6)(x - 2), (1/2)(x + 1)).
//             Every candidate is checked by parsing it back (it must BE b·X),
//             falling through to the parenthesised form otherwise.
//   a         omitted for 1, `-` for −1; bare when it is a number, constant,
//             call, or number times one of those (3sin, -sqrt(2)sin, 2pi sin);
//             otherwise parenthesised ((1/2)sin(x)).
//   k         omitted for 0; ` - s` for "-s", ` + (…)` for a sum, else ` + k`.
//   Numbers keep the teacher's text throughout.
//
// Reading (readSinusoid): the body (after `y =`, `f(x) =`, or bare) is a sum
// of constant terms (→ k) and one or more terms that are each a product /
// quotient of constants and exactly one sin or cos of an argument linear in
// the variable.
//   * ONE term: a is the constant factors (text kept for one factor), and
//     u = sign·ΠK/ΠP·(c·x + d) gives b = c (the total x-coefficient, as
//     written: 2, pi/6, 2pi/12) and h = −d/c. When the argument is written
//     b(x − h) the h text is the teacher's; when b is distributed
//     (sin(2x − pi/2)) h is computed and written exactly when it is nice —
//     a fraction, a rational multiple of π ("pi/4"), or a surd — else as the
//     symbolic quotient.
//   * SEVERAL terms (the FOLD): every argument must be the same u up to sign
//     (same |b|, same h; sin(−u) = −sin u, cos(−u) = cos u). With
//     A = Σ sin-coefficients and C = Σ cos-coefficients,
//         A·sin(u) + C·cos(u) = R·sin(u + φ),  R = √(A² + C²),  φ = atan2(C, A)
//     and u + φ = b(x − (h − φ/b)). C = 0 stays a sin (a = A), A = 0 stays a
//     cos (a = C); otherwise it is a sin with R > 0. R and the new h are
//     written exactly when nice (sin x + cos x → sqrt(2)sin(x + pi/4)),
//     else with 12 significant digits (3sin x − 4cos x → 5sin(x −
//     0.927295218002)).
//   Refused (null): sin(x²), sin(x) + cos(2x), sin(x)cos(x), sin(x)², tan,
//   x + sin(x), 1/sin(x), a slider anywhere, and anything whose sinusoid
//   part cancels to 0.
//   Safety net: the reading is evaluated against the typed body at nine
//   points over a period; any disagreement → null.
//
// Text for computed numbers (the fold, sinFromParts, sinFromExtrema,
// rewriteAs) is exact when the number IS one of: a small fraction, a rational
// multiple of π ("3pi/4"), r + sπ ("1 + pi/2", rewriteAs only), or an
// exactForm surd ("sqrt(2)"); otherwise 12 significant digits.
// ============================================================================

// ----------------------------------------------------------------------------
// Exact rationals (copied from logarithmic.ts, which keeps them private)
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
// AST helpers (copied from logarithmic.ts)
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

/** A plain decimal literal: written bare after log_. */
const PLAIN_NUMBER = /^(?:\d+(?:\.\d+)?|\.\d+)$/

/** Print a node back to source the parser reads the same way. */
function srcOf(n: ExprNode): string {
  switch (n.t) {
    case 'num': return n.raw
    case 'const': return n.name
    case 'var': return n.name
    case 'param': return n.name
    case 'call': {
      if (n.fn === 'log_') {
        const b = srcOf(n.args[0])
        return `log_${PLAIN_NUMBER.test(b) ? b : `(${b})`}(${srcOf(n.args[1])})`
      }
      return `${n.fn}(${n.args.map(srcOf).join(', ')})`
    }
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

/** −s as text, keeping s's own text: "3" → "-3", "-1/2" → "1/2". */
function negText(s: string): string {
  const n = nodeOf(s)
  return n ? srcOf(negNode(n)) : `-(${s})`
}

/** −n, removing a minus where there is one: −(−u) = u, −((−1)/2) = 1/2. */
function negNode(n: ExprNode): ExprNode {
  if (n.t === 'neg') return n.a
  if (n.t === 'bin' && (n.op === '*' || n.op === '/')) {
    // the minus of a product/quotient sits on its leftmost factor
    const left = leftNeg(n)
    if (left) return left
  }
  return { t: 'neg', a: n }
}

function leftNeg(n: ExprNode): ExprNode | null {
  if (n.t === 'neg') return n.a
  if (n.t === 'bin' && (n.op === '*' || n.op === '/')) {
    const a = leftNeg(n.a)
    return a ? { ...n, a } : null
  }
  return null
}

/** |s| as text. */
const absText = (s: string): string => (valueOf(s) < 0 ? negText(s) : s)

const sameValue = (u: number, w: number, tol = 1e-12): boolean =>
  Math.abs(u - w) <= tol * Math.max(1, Math.abs(u), Math.abs(w))

// ----------------------------------------------------------------------------
// Computed numbers as text: exact when they ARE something nice
// ----------------------------------------------------------------------------

/** pπ/q as source: "pi", "-pi", "3pi", "pi/4", "-3pi/4". */
function piText(s: Rat): string {
  const p = s[0]
  const head = p === 1 ? 'pi' : p === -1 ? '-pi' : `${p}pi`
  return s[1] === 1 ? head : `${head}/${s[1]}`
}

/** An exactForm text ("−2√3/9", "3π/4", "(1+√5)/2") as parseable source. */
function exactSource(text: string): string {
  return text
    .replace(/−/g, '-')
    .replace(/(\d*)√(\d+)/g, (_m, k: string, n: string) => `${k}sqrt(${n})`)
    .replace(/(\d)π/g, '$1pi')
    .replace(/π/g, 'pi')
}

/**
 * A computed number as source: a small fraction (a decimal when it
 * terminates and `decimal` asks for one), a rational multiple of π, an
 * exactForm surd, else 12 significant digits.
 */
function numSource(v: number, decimal = false): string {
  if (!Number.isFinite(v)) return 'NaN'
  if (v === 0 || Object.is(v, -0)) return '0'
  const r = snapRat(v, 100, 1e-11)
  if (r) return decimal ? ratDecText(r) : ratText(r)
  const s = snapRat(v / Math.PI, 24, 1e-11)
  if (s && s[0] !== 0 && Math.abs(s[0]) <= 64) return piText(s)
  const e = exactForm(v)
  if (e) {
    const src = exactSource(e.text)
    if (sameValue(valueOf(src), v, 1e-11)) return src
  }
  return dec12(v)
}

/**
 * A number of the form r + sπ (r, s rational) — what a phase shift is after
 * a quarter-period shift of a nice h. null when the text is not one.
 */
interface RPi { r: Rat; s: Rat }

function rPiOf(text: string): RPi | null {
  const n = nodeOf(text)
  if (!n) return null
  const terms: { n: ExprNode; s: 1 | -1 }[] = []
  sumTerms(n, 1, terms)
  let r: Rat | null = [0, 1]
  let s: Rat | null = [0, 1]
  for (const t of terms) {
    const q = ratOf(t.n)
    if (q) {
      r = r && rAdd(r, t.s < 0 ? rNeg(q) : q)
      continue
    }
    const v = evalAst(t.n, NaN) * t.s
    const p = snapRat(v / Math.PI, 100, 1e-12)
    if (!p) return null
    s = s && rAdd(s, p)
  }
  return r && s ? { r, s } : null
}

function rPiText(x: RPi, decimal: boolean): string {
  const rt = (q: Rat) => (decimal ? ratDecText(q) : ratText(q))
  if (x.s[0] === 0) return rt(x.r)
  if (x.r[0] === 0) return piText(x.s)
  return x.s[0] > 0 ? `${rt(x.r)} + ${piText(x.s)}` : `${rt(x.r)} - ${piText(rNeg(x.s))}`
}

function rPiAdd(x: RPi, y: RPi): RPi | null {
  const r = rAdd(x.r, y.r)
  const s = rAdd(x.s, y.s)
  return r && s ? { r, s } : null
}

// ----------------------------------------------------------------------------
// The spec as numbers
// ----------------------------------------------------------------------------

function valuesOf(spec: SinSpec) {
  return {
    a: valueOf(txt(spec.a, '1')),
    b: valueOf(txt(spec.b, '1')),
    h: valueOf(txt(spec.h, '0')),
    k: valueOf(txt(spec.k, '0')),
  }
}

const trig = (fn: SinFn, u: number): number => (fn === 'cos' ? Math.cos(u) : Math.sin(u))

/** The value of the spec's function at x. */
function specAt(spec: SinSpec, x: number): number {
  const { a, b, h, k } = valuesOf(spec)
  return a * trig(spec.fn, b * (x - h)) + k
}

// ----------------------------------------------------------------------------
// sinSource
// ----------------------------------------------------------------------------

/**
 * A factor written bare in front of what it multiplies: a number, a constant,
 * one call, or a number times one of those, with an optional leading minus.
 * Fractions are NOT bare here: (1/2)sin(x), not 1/2sin(x).
 */
function bareFactor(s: string): boolean {
  const ast = parseAst(s)
  if (!ast.ok || ast.rhs !== null) return false
  let n = ast.lhs
  if (n.t === 'neg') n = n.a
  const unit = (m: ExprNode) => m.t === 'const' || m.t === 'call'
  if (n.t === 'num' || unit(n)) return true
  if (n.t === 'bin' && n.op === '*') return n.a.t === 'num' && unit(n.b)
  return false
}

/** A quotient at the top (pi/6, -1/2, 2pi/3): written `pi/6 x` before a bare x. */
function isQuotient(s: string): boolean {
  const n = nodeOf(s)
  if (!n) return false
  const m = n.t === 'neg' ? n.a : n
  return m.t === 'bin' && m.op === '/'
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

const PROBE_XS = [-1.37, 0.41, 2.9]

/**
 * The first candidate that parses back to coefficient × rest — the glued and
 * spaced spellings are only used when the parser reads them that way.
 */
function firstProduct(candidates: string[], coef: string, rest: string): string {
  const cv = valueOf(coef)
  const r = parseAst(rest)
  for (const c of candidates) {
    const ast = parseAst(c)
    if (!ast.ok || ast.rhs !== null || !r.ok || r.rhs !== null) continue
    const ok = PROBE_XS.every((x) => {
      const want = cv * evalAst(r.lhs, x)
      const got = evalAst(ast.lhs, x)
      return Number.isFinite(want) && sameValue(got, want, 1e-9)
    })
    if (ok) return c
  }
  return candidates[candidates.length - 1]
}

/** The argument b(x − h), written the textbook way. */
function argumentText(b: string, h: string): string {
  const X = shifted(h)
  if (isExactly(b, 1)) return X
  if (isExactly(b, -1)) return X === 'x' ? '-x' : `-(${X})`
  const cands: string[] = []
  if (X === 'x') {
    if (bareFactor(b)) cands.push(`${b}${joinSep(b, 'x')}x`)
    if (isQuotient(b)) cands.push(`${b} x`)
    cands.push(`(${b})x`)
  } else {
    if (bareFactor(b)) cands.push(`${b}(${X})`)
    cands.push(`(${b})(${X})`)
  }
  return firstProduct(cands, b, X)
}

export function sinSource(spec: SinSpec): string {
  const head = spec.name ? `${spec.name}(x) = ` : 'y = '
  const fn: SinFn = spec.fn === 'cos' ? 'cos' : 'sin'
  const a = txt(spec.a, '1')
  const call = `${fn}(${argumentText(txt(spec.b, '1'), txt(spec.h, '0'))})`
  let term: string
  if (isExactly(a, 1)) term = call
  else if (isExactly(a, -1)) term = `-${call}`
  else {
    const cands: string[] = []
    if (bareFactor(a)) cands.push(`${a}${joinSep(a, call)}${call}`)
    cands.push(`(${a})${call}`)
    term = firstProduct(cands, a, call)
  }
  return `${head}${term}${constantTail(txt(spec.k, '0'))}`
}

// ----------------------------------------------------------------------------
// readSinusoid
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
  /** the total x-coefficient */
  b: C
  /** the zero of the argument */
  h: C
  /** h is the teacher's own text: the inner sum was x − h (x-coefficient 1) */
  asWritten: boolean
  /** the argument was written with a decimal somewhere */
  decimal: boolean
}

/** u = sign · ΠK / ΠP · (c·x + d): the total x-coefficient and h = −d/c. */
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
  const b = cMul(S, cL)
  if (!Number.isFinite(b.v) || b.v === 0 || !Number.isFinite(h.v)) return null
  return { b, h, asWritten: isRat(cL, 1), decimal: srcOf(u).includes('.') }
}

/** h as text: the teacher's when written x − h, else exact when nice. */
function phaseText(lin: Linear): string {
  if (lin.h.v === 0) return '0'
  if (lin.asWritten) return cText(lin.h)
  if (lin.h.r) return lin.decimal ? ratDecText(lin.h.r) : ratText(lin.h.r)
  const nice = numSource(lin.h.v, lin.decimal)
  // numSource falls back to 12 digits; the symbolic quotient is exact
  return nice === dec12(lin.h.v) ? cText(lin.h) : nice
}

/**
 * The product of the constant leaves (with their powers) and the sign, as
 * text (copied from logarithmic.ts). One leaf with power 1 keeps its own
 * text; otherwise exact parts combine into one fraction in front of the
 * symbolic ones.
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

type CallNode = Extract<ExprNode, { t: 'call' }>

const isSinCos = (n: ExprNode): n is CallNode => n.t === 'call' && (n.fn === 'sin' || n.fn === 'cos')

/** One term: sign · Π constants^±1 · (sin|cos)(u). */
interface TrigTerm {
  fn: SinFn
  sign: number
  consts: { c: C; p: number }[]
  lin: Linear
}

function readTrigTerm(term: { n: ExprNode; s: 1 | -1 }): TrigTerm | null {
  let sign = term.s as number
  const consts: { c: C; p: number }[] = []
  const leaves: { call: CallNode; p: number }[] = []
  const flatten = (n: ExprNode, p: 1 | -1): boolean => {
    if (!hasVar(n)) {
      consts.push({ c: cOf(n), p })
      return true
    }
    if (n.t === 'neg') { sign = -sign; return flatten(n.a, p) }
    if (n.t === 'bin' && n.op === '*') return flatten(n.a, p) && flatten(n.b, p)
    if (n.t === 'bin' && n.op === '/') return flatten(n.a, p) && flatten(n.b, -p as 1 | -1)
    if (isSinCos(n)) {
      leaves.push({ call: n, p })
      return true
    }
    return false // x·sin(x), sin(x)^2, tan(x), sqrt(sin(x)), …
  }
  if (!flatten(term.n, 1)) return null
  if (leaves.length !== 1 || leaves[0].p !== 1) return null // sin·cos, 1/sin
  const lin = readLinear(leaves[0].call.args[0])
  if (!lin) return null // sin(x^2), sin(1/x)
  return { fn: leaves[0].call.fn as SinFn, sign, consts, lin }
}

/** The numeric value of a term's constant factor. */
function coefficientValue(t: TrigTerm): number {
  let v = t.sign
  for (const { c, p } of t.consts) v *= Math.pow(c.v, p)
  return v
}

/** Fractions of a period the safety net samples at. */
const PERIOD_SAMPLES = [0.03, 0.11, 0.2, 0.37, 0.5, 0.61, 0.77, 0.9, 1.3]

export function readSinusoid(src: string): SinSpec | null {
  if (!src || src.includes('{') || /\b(for|if|where|when|otherwise)\b/.test(src)) return null
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
  // the variable: x, or t when the body is written in t (plotted the same)
  const v = head ?? (usesVar(body, 't') && !usesVar(body, 'x') ? 't' : 'x')
  if (!onlyVar(body, v) || !usesVar(body, v)) return null

  // ---- the sum: constants (k) and the sinusoid terms -----------------------
  const terms: { n: ExprNode; s: 1 | -1 }[] = []
  sumTerms(body, 1, terms)
  const constants: C[] = []
  const trigs: TrigTerm[] = []
  for (const t of terms) {
    if (!hasVar(t.n)) {
      constants.push(t.s < 0 ? cNeg(cOf(t.n)) : cOf(t.n))
      continue
    }
    const tt = readTrigTerm(t)
    if (!tt) return null
    trigs.push(tt)
  }
  if (trigs.length === 0) return null
  const k = constants.length === 0 ? '0' : cText(cSum(constants))

  let spec: SinSpec
  if (trigs.length === 1) {
    // ---- one term: every text as the teacher wrote it ---------------------
    const t = trigs[0]
    const a = coefficientText(t.sign, t.consts)
    if (a === null || a === '0') return null
    spec = { fn: t.fn, a, b: cText(t.lin.b), h: phaseText(t.lin), k }
  } else {
    // ---- the fold: A·sin(u) + C·cos(u) = R·sin(u + φ) --------------------
    const ref = trigs[0].lin
    let A = 0
    let Cc = 0
    let decimal = false
    for (const t of trigs) {
      if (!sameValue(Math.abs(t.lin.b.v), Math.abs(ref.b.v))) return null // sin(x) + cos(2x)
      if (!sameValue(t.lin.h.v, ref.h.v)) return null // sin(x) + cos(x + 1)
      const cv = coefficientValue(t)
      if (!Number.isFinite(cv)) return null
      decimal ||= t.lin.decimal || t.consts.some(({ c }) => cText(c).includes('.'))
      // sin(−u) = −sin(u), cos(−u) = cos(u)
      const flip = Math.sign(t.lin.b.v) !== Math.sign(ref.b.v)
      if (t.fn === 'sin') A += flip ? -cv : cv
      else Cc += cv
    }
    const scale = Math.max(1, ...trigs.map((t) => Math.abs(coefficientValue(t))))
    const zeroA = Math.abs(A) <= 1e-12 * scale
    const zeroC = Math.abs(Cc) <= 1e-12 * scale
    if (zeroA && zeroC) return null // sin(x) − sin(x): only the constant is left
    const b = cText(ref.b)
    if (zeroC) spec = { fn: 'sin', a: numSource(A, decimal), b, h: phaseText(ref), k }
    else if (zeroA) spec = { fn: 'cos', a: numSource(Cc, decimal), b, h: phaseText(ref), k }
    else {
      const R = Math.hypot(A, Cc)
      const phi = Math.atan2(Cc, A)
      const h = ref.h.v - phi / ref.b.v
      spec = { fn: 'sin', a: numSource(R, decimal), b, h: numSource(h, decimal), k }
    }
  }
  if (name) spec.name = name

  // ---- safety net: the reading must BE the typed function ----------------
  const vals = valuesOf(spec)
  if (![vals.a, vals.b, vals.h, vals.k].every(Number.isFinite) || vals.a === 0 || vals.b === 0) return null
  const period = (2 * Math.PI) / Math.abs(vals.b)
  const tol = 1e-7 * Math.max(1, Math.abs(vals.a) + Math.abs(vals.k))
  for (const f of PERIOD_SAMPLES) {
    const x = vals.h + f * period
    const want = evalAst(body, x)
    const got = specAt(spec, x)
    if (!Number.isFinite(want) || !Number.isFinite(got)) return null
    if (Math.abs(want - got) > tol) return null
  }
  return spec
}

// ----------------------------------------------------------------------------
// Numbers for sentences
// ----------------------------------------------------------------------------

const MINUS = '−'

/** 4 significant digits, trailing zeros dropped, true minus. */
function fmt4(v: number): string {
  const s = String(Number(v.toPrecision(4)))
  return s.replace('-', MINUS)
}

/**
 * A number for the card: an integer; a short decimal when the teacher writes
 * decimals; an exact form (3/2, π/4, 3π/2, √2) when it is one; else 4
 * significant digits.
 */
function numText(v: number, decimal = false): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : v < 0 ? `${MINUS}∞` : '?'
  if (Object.is(v, -0)) v = 0
  if (Number.isInteger(v)) return String(v).replace('-', MINUS)
  if (decimal) {
    const d = Number(v.toFixed(6))
    if (sameValue(d, v, 1e-12)) return String(d).replace('-', MINUS)
  }
  const e = exactForm(v)
  return e ? e.text : fmt4(v)
}

// ----------------------------------------------------------------------------
// sinFeatures
// ----------------------------------------------------------------------------

/** sin / cos at the five quarter points of a cycle, for b > 0. */
const QUARTERS: Record<SinFn, number[]> = {
  sin: [0, 1, 0, -1, 0],
  cos: [1, 0, -1, 0, 1],
}

export function sinFeatures(spec: SinSpec): SinFeatures {
  const { a, b, h, k } = valuesOf(spec)
  const fn: SinFn = spec.fn === 'cos' ? 'cos' : 'sin'
  const amplitude = Math.abs(a)
  const period = (2 * Math.PI) / Math.abs(b)
  const frequency = Math.abs(b) / (2 * Math.PI)
  const max = k + amplitude
  const min = k - amplitude
  if (![a, b, h, k].every(Number.isFinite) || b === 0) {
    return {
      amplitude, period, frequency, phaseShift: h, midline: k, max, min,
      range: '', keyPoints: [], sentences: [],
    }
  }
  const yDec = /\./.test(`${spec.a}${spec.k}`)
  const xDec = /\./.test(`${spec.b}${spec.h}`)
  const kText = numText(k, yDec)
  if (a === 0) {
    return {
      amplitude: 0, period, frequency, phaseShift: h, midline: k, max: k, min: k,
      range: `y = ${kText}`, keyPoints: [], sentences: [`constant: y = ${kText}`],
    }
  }

  const range = `${numText(min, yDec)} ≤ y ≤ ${numText(max, yDec)}`
  const keyPoints: SinFeatures['keyPoints'] = QUARTERS[fn].map((q, i) => {
    // sin(−u) = −sin(u): with b < 0 the cycle runs the other way
    const s = fn === 'sin' && b < 0 ? -q : q
    const x = h + (i * period) / 4
    const y = s === 0 ? k : k + a * s
    const kind: 'max' | 'min' | 'mid' = s === 0 ? 'mid' : a * s > 0 ? 'max' : 'min'
    return { x, y, xText: numText(x, xDec), yText: numText(y, yDec), kind }
  })

  const phase =
    h === 0
      ? 'no phase shift'
      : `phase shift ${numText(Math.abs(h), xDec)} to the ${h > 0 ? 'right' : 'left'}`
  const sentences = [
    `amplitude ${numText(amplitude, yDec)}`,
    `period ${numText(period, xDec)}`,
    phase,
    `midline y = ${kText}`,
    `range ${range}`,
  ]
  return { amplitude, period, frequency, phaseShift: h, midline: k, max, min, range, keyPoints, sentences }
}

// ----------------------------------------------------------------------------
// sinFromParts / sinFromExtrema
// ----------------------------------------------------------------------------

/** b = 2π/P as text: P = 12 → "pi/6", P = pi → "2", P = 3 → "2pi/3". */
function bFromPeriod(P: string): string {
  const r = exactOf(P)
  if (r && r[0] !== 0) {
    const c = rDiv([2, 1], r)
    if (c) return piText(c)
  }
  const v = valueOf(P)
  if (Number.isFinite(v) && v !== 0) {
    const q = snapRat(v / Math.PI, 100, 1e-12)
    if (q && q[0] !== 0) {
      const c = rDiv([2, 1], q)
      if (c) return ratText(c)
    }
  }
  return `2pi/${bareFactor(P) && !P.trim().startsWith('-') ? P : `(${P})`}`
}

/** b = 2π/P for a computed period. */
function bFromPeriodValue(P: number): string {
  const q = snapRat(P / Math.PI, 100, 1e-9)
  if (q && q[0] !== 0) return ratText(rDiv([2, 1], q)!)
  const r = snapRat(P, 100, 1e-9)
  if (r && r[0] !== 0) return piText(rDiv([2, 1], r)!)
  return dec12((2 * Math.PI) / P)
}

/** A computed coordinate as text: a fraction, a π multiple, else 12 digits. */
function coordSource(v: number): string {
  if (!Number.isFinite(v)) return 'NaN'
  const r = snapRat(v, 100, 1e-9)
  if (r) return ratDecText(r)
  const s = snapRat(v / Math.PI, 24, 1e-9)
  if (s && s[0] !== 0) return piText(s)
  return dec12(v)
}

/**
 * From the parts a textbook states. `start` says where the cycle begins at
 * x = phase, and chooses the function and the sign of a:
 *   max → cos, a > 0     min → cos, a < 0
 *   mid-up → sin, a > 0  mid-down → sin, a < 0
 * Without `start`, the function is `fn` (default sin) and a is the amplitude
 * exactly as given (signed). b = 2π/period, simplified.
 */
export function sinFromParts(p: {
  amplitude: string
  period: string
  phase: string
  midline: string
  start?: SinStart
  fn?: SinFn
}): SinSpec {
  const amp = txt(p.amplitude, '1')
  const b = bFromPeriod(txt(p.period, '2pi'))
  const h = txt(p.phase, '0')
  const k = txt(p.midline, '0')
  if (!p.start) return { fn: p.fn ?? 'sin', a: amp, b, h, k }
  const fn: SinFn = p.start === 'max' || p.start === 'min' ? 'cos' : 'sin'
  const mag = absText(amp)
  const a = p.start === 'max' || p.start === 'mid-up' ? mag : negText(mag)
  return { fn, a, b, h, k }
}

/**
 * An adjacent maximum and minimum: amplitude (max.y − min.y)/2, midline
 * their average, period twice their x-distance, written as cos starting at
 * the maximum (h = max.x). null when they share an x, max.y ≤ min.y, or a
 * coordinate is not a number.
 */
export function sinFromExtrema(
  max: { x: number; y: number },
  min: { x: number; y: number },
): SinSpec | null {
  if (![max.x, max.y, min.x, min.y].every(Number.isFinite)) return null
  const dx = Math.abs(max.x - min.x)
  if (!(dx > 0) || !(max.y > min.y)) return null
  return {
    fn: 'cos',
    a: coordSource((max.y - min.y) / 2),
    b: bFromPeriodValue(2 * dx),
    h: coordSource(max.x),
    k: coordSource((max.y + min.y) / 2),
  }
}

// ----------------------------------------------------------------------------
// rewriteAs
// ----------------------------------------------------------------------------

/**
 * The same function written with `fn`, and with a positive a when asked.
 *   sin → cos:  a·sin(θ) = a·cos(θ − π/2)  → h + π/(2b)
 *   cos → sin:  a·cos(θ) = a·sin(θ + π/2)  → h − π/(2b)
 *   a < 0:      −|a|·f(θ) = |a|·f(θ ± π)   → h ∓ π/b, whichever h is
 *               nearer 0 (to the right on a tie)
 * The new h is exact (r + sπ, "pi/2", "3 + pi/4") when h and b are nice —
 * a fraction or a rational multiple of π each — else 12 significant digits.
 * A spec that is not a number (or b = 0) comes back unchanged.
 */
export function rewriteAs(spec: SinSpec, fn: SinFn, positiveA = false): SinSpec {
  const { a, b, h } = valuesOf(spec)
  if (![a, b, h].every(Number.isFinite) || b === 0) return spec
  const hText = txt(spec.h, '0')
  const decimal = hText.includes('.')
  // π/(2b) exactly: b = p/q → (q/2p)π; b = cπ → 1/(2c)
  const bx = rPiOf(txt(spec.b, '1'))
  let quarter: RPi | null = null
  if (bx && bx.s[0] === 0 && bx.r[0] !== 0) {
    const s = rDiv([1, 2], bx.r)
    quarter = s && { r: [0, 1], s }
  } else if (bx && bx.r[0] === 0 && bx.s[0] !== 0) {
    const r = rDiv([1, 2], bx.s)
    quarter = r && { r, s: [0, 1] }
  }
  const scale = (x: RPi | null, m: number): RPi | null => {
    if (!x) return null
    const r = rMul(x.r, [m, 1])
    const s = rMul(x.s, [m, 1])
    return r && s ? { r, s } : null
  }

  let hv = h
  let hx: RPi | null = rPiOf(hText)
  const shift = (quarters: number) => {
    hv += (quarters * Math.PI) / (2 * b)
    const step = scale(quarter, quarters)
    hx = hx && step ? rPiAdd(hx, step) : null
  }

  let out: SinSpec = { ...spec, fn: spec.fn === 'cos' ? 'cos' : 'sin' }
  if (out.fn !== fn) {
    shift(fn === 'cos' ? 1 : -1)
    out.fn = fn
  }
  if (positiveA && a < 0) {
    const half = Math.PI / b
    const right = Math.abs(hv + half) <= Math.abs(hv - half)
    shift(right ? 2 : -2)
    out = { ...out, a: negText(txt(spec.a, '1')) }
  }
  if (hv === h) return out // nothing moved: same function, a already positive
  if (Math.abs(hv) < 1e-12 * Math.max(1, Math.abs(h), Math.abs(Math.PI / b))) return { ...out, h: '0' }
  return { ...out, h: hx ? rPiText(hx, decimal) : numSource(hv, decimal) }
}

// ============================================================================
// Transformations of parent functions (src/core/transform.ts)
//
//     y = a·f(b(x − h)) + k
//
// The Math 3 / Precalculus way of reading a function: which PARENT it comes
// from, and what was done to it — in words, in order, and point by point.
//
//   a  vertical stretch (|a| > 1) / compression (|a| < 1); a < 0 reflects
//      across the x-axis
//   b  horizontal compression (|b| > 1) / stretch (|b| < 1) by 1/|b|; b < 0
//      reflects across the y-axis
//   h  horizontal shift (right when h > 0);  k  vertical shift (up when k > 0)
//
// Like every sibling (factored, exponential, logarithmic, sinusoidal) a spec
// becomes a TYPED EXPRESSION and goes through the ordinary parser.
//
//   export const PARENTS: ParentFn[]
//       the parent library: linear x, quadratic x², cubic x³, absolute |x|,
//       square root √x, cube root ∛x, reciprocal 1/x, reciprocal squared
//       1/x², exponential 2^x and e^x, logarithmic log₂ x and ln x, sin x,
//       cos x, tan x, greatest integer ⌊x⌋ — each with its source body in x,
//       its key points (the ones a textbook table lists: for x² (−2,4),
//       (−1,1), (0,0), (1,1), (2,4); for √x (0,0), (1,1), (4,2), (9,3) …),
//       its domain/range sentences and asymptotes.
//   export function transformSource(spec): string
//       "y = -2(x - 3)^2 + 1", "y = |x + 2| - 3", "y = sqrt(-(x - 1))",
//       "y = 3/(x - 2) + 1", "f(x) = -2^(x + 1) + 4" … canonical, parseable,
//       reading like a textbook (b folded where the textbook folds it:
//       sqrt(2x), |3x|, (2x)^2 — never (2(x - 0))^2).
//   export function readTransform(src): TransformSpec | null
//       the inverse: which parent, and a, b, h, k — for ANY typed explicit
//       curve that is one: -2(x-3)^2+1, 3|x|, |2x-6|+1 (b = 2, h = 3),
//       sqrt(4-x) (b = −1, h = 4), 1/(x+2) - 3, (x-1)^3, -x^2, 2^(x-1)+3,
//       cbrt(8x) … Ambiguities have a canonical answer, documented:
//       (2x)² = 4x² (a = 4 or b = 2? — choose b only when the teacher wrote
//       it inside); a quadratic in standard form (x² − 6x + 8) is read in
//       vertex form (completing the square) — a teacher asks exactly that.
//       Verified numerically; null for anything that is not one parent.
//   export function describe(spec): TransformStep[]
//       the transformations in the order a textbook applies them
//       (horizontal: shift inside first? — use the standard order
//       "reflect/stretch, then shift": b, then h, then a, then k), each as
//       a sentence: "horizontal compression by a factor of 1/2",
//       "reflection across the x-axis", "vertical stretch by a factor of 2",
//       "shift right 3", "shift up 1"; identity steps omitted.
//   export function mapPoints(spec): { from: Vec2; to: Vec2 }[]
//       each parent key point and its image (x/b + h, a·y + k), with exact
//       text for both (π multiples, fractions).
//   export function transformFeatures(spec): TransformFeatures
//       domain, range, asymptotes, vertex / centre / anchor point by parent.
// ============================================================================

import type { Vec2 } from './types'
import { exactForm } from './exact'
import { evalAst, parseAst, type ExprNode } from './parse'

export type ParentId =
  | 'linear'
  | 'quadratic'
  | 'cubic'
  | 'absolute'
  | 'sqrt'
  | 'cbrt'
  | 'reciprocal'
  | 'reciprocal2'
  | 'exp2'
  | 'expe'
  | 'log2'
  | 'ln'
  | 'sin'
  | 'cos'
  | 'tan'
  | 'floor'

export interface ParentFn {
  id: ParentId
  /** "Quadratic", "Square root", … */
  name: string
  /** The body in x as typed: "x^2", "sqrt(x)", "|x|", "1/x", "2^x". */
  body: string
  /** KaTeX of y = f(x). */
  latex: string
  keyPoints: { x: number; y: number; xText: string; yText: string }[]
  domain: string
  range: string
  /** e.g. "x = 0, y = 0" for 1/x; "" when none. */
  asymptotes: string
  /** What the special point is called: "vertex", "centre", "anchor". */
  anchorName: string
}

export interface TransformSpec {
  name?: string
  parent: ParentId
  /** As written: "1", "-2", "1/2". */
  a: string
  b: string
  h: string
  k: string
}

export interface TransformStep {
  kind: 'reflect-x' | 'reflect-y' | 'v-stretch' | 'v-compress' | 'h-stretch' | 'h-compress' | 'shift-h' | 'shift-v'
  sentence: string
}

export interface TransformFeatures {
  domain: string
  range: string
  asymptotes: string
  anchor: { name: string; x: number; y: number; xText: string; yText: string } | null
}

// ============================================================================
// Implementation
//
// TEXTBOOK CONVENTIONS (the choices, in one place)
//
//   Key points — the table a textbook lists for the parent:
//     x, x², x³, |x|   x = −2, −1, 0, 1, 2 (one five-row table for all four,
//                      so the cubic's (±2, ±8) are included, as in most
//                      Math 3 / Algebra 2 transformation tables)
//     √x               (0,0) (1,1) (4,2) (9,3)
//     ∛x               (−8,−2) (−1,−1) (0,0) (1,1) (8,2)
//     1/x              (−2,−1/2) (−1,−1) (−1/2,−2) (1/2,2) (1,1) (2,1/2)
//     1/x²             (−2,1/4) (−1,1) (−1/2,4) (1/2,4) (1,1) (2,1/4)
//     2^x              (−1,1/2) (0,1) (1,2) (2,4)
//     e^x              (0,1) (1,e)
//     log₂ x           (1/2,−1) (1,0) (2,1) (4,2)
//     ln x             (1,0) (e,1)
//     sin x, cos x     the five quarter points of [0, 2π]
//     tan x            (−π/4,−1) (0,0) (π/4,1)
//     ⌊x⌋              the left (closed) endpoints of the steps x = −2 … 2
//
//   Anchor (the one point a teacher tracks), and what it is called:
//     vertex (0,0) of x² and |x|; inflection point (0,0) of x³, ∛x and tan x;
//     starting point (0,0) of √x; center (0,0) of 1/x and 1/x² (where the
//     asymptotes cross — US spelling, this is a US classroom); key point
//     (0,1) of 2^x and e^x; key point (1,0) of log₂ x and ln x; cycle start
//     (0,0) of sin x and (0,1) of cos x; step endpoint (0,0) of ⌊x⌋; reference
//     point (0,0) of the line y = x. The anchor of a transformed curve is the
//     image of the parent's anchor, like any key point.
//
//   Order of the steps (describe): b, then h, then a, then k —
//     horizontal stretch/compression, reflection across the y-axis,
//     horizontal shift, vertical stretch/compression, reflection across the
//     x-axis, vertical shift. The b-steps must come before the h-shift
//     (f(bx) first, then x → x − h gives f(b(x − h))), and a before k.
//     Within one axis the stretch and the reflection commute; the stretch is
//     listed first.
//
// Canonical source (transformSource):
//   head      `y = ` or `name(x) = `.
//   inner     b(x − h) the way sinusoidal.ts writes an argument: x, x - 3,
//             x + 2; b = −1 → -x, -(x - 1); h = 0 → bx glued (2x, pi x) or a
//             fraction spaced (1/2 x); both → b(x - h) ((1/2)(x - 3) for a
//             fraction).
//   body      x^2 / (x - 3)^2 / (2x)^2 / (2(x - 3))^2 — likewise ^3;
//             |inner|; sqrt(inner), cbrt(inner), ln(inner), log_2(inner),
//             sin/cos/tan(inner), floor(inner); 1/inner and 1/inner^2 with
//             the inner parenthesised unless it is the bare x; 2^inner and
//             e^inner with the exponent parenthesised unless bare.
//   a         omitted for 1, `-` for −1; bare in front when it is a number,
//             a constant, a call, or a number times one of those (2(x - 3)^2,
//             -3|x|, 2e^x, sqrt(2)sin(x)); parenthesised otherwise
//             ((1/2)x^2). The reciprocals put a in the numerator (3/(x - 2),
//             -1/x, (1/2)/x); base 2 after a coefficient is parenthesised as
//             in exponential.ts (3(2)^(x - 1)), bare otherwise (-2^(x + 1)).
//             Every glued candidate is checked by parsing it back.
//   k         omitted for 0; ` - 4`, ` + 1`, ` + (…)` for a sum.
//   linear    a·x + k when b = 1 and h = 0 (2x + 3); a(inner) + k otherwise.
//   Numbers keep the teacher's text throughout.
//
// Reading (readTransform): the body (after `y =`, `f(x) =`, or bare) is
//   1. ONE PARENT TERM plus constants: the sum splits into constant terms
//      (→ k) and exactly one term in x, which must be a product/quotient of
//      constants (→ a) and exactly one parent leaf:
//          abs(u) |u|, sqrt(u), u^(1/2), cbrt(u), u^2, u^3, 1/u, u^(-1),
//          1/u^2, u^(-2), 2^u, e^u, exp(u), ln(u), log_2(u), log2(u),
//          sin(u), cos(u), tan(u), floor(u)
//      with u linear in x; u = b(x − h) read as sinusoidal.ts reads an
//      argument (b the total x-coefficient; h the teacher's text when u is
//      written with x − h, else computed exactly: |2x − 6| → b = 2, h = 3;
//      sqrt(4 − x) → b = −1, h = 4). 1/2^u reads as 2^(−u) (b negated).
//      INSIDE vs OUTSIDE: a factor written inside the parent is b, one
//      written outside is a — (2x)^2 is b = 2, 4x^2 is a = 4; |3x| is b = 3,
//      3|x| is a = 3; sqrt(4x) is b = 4 (never rewritten as 2√x). A
//      denominator linear in x is the reciprocal's argument whole, so
//      1/(2(x − 1)) and 3/(2x − 2) are b = 2 — the fraction bar is inside.
//   2. otherwise a POLYNOMIAL in x (expanded exactly, rational coefficients
//      kept exact):
//        degree 1 → the linear parent in slope-intercept form (a = slope,
//          b = 1, h = 0, k = intercept). A line is the one parent whose
//          transformation is not unique (2(x − 3) + 1 = 2x − 5), so it is
//          ALWAYS read this way: 2x + 3 → a = 2, k = 3; 2(x - 3) + 1 →
//          a = 2, k = −5.
//        degree 2 → VERTEX FORM by completing the square: x^2 - 6x + 8 and
//          (x-2)(x-4) → a = 1, h = 3, k = −1 (exact text when rational).
//        degree 3 that IS a(x − h)³ + k (x^3 - 3x^2 + 3x - 1 → (x − 1)³);
//          any other cubic → null.
//   EVEN PARENTS are normalised to b > 0: f(−u) = f(u) for x², |x|, 1/x² and
//   cos, so |3 − x| reads as b = 1, h = 3 and (−2x)² as b = 2 — a reflection
//   across the y-axis does nothing to them and is never reported. Odd
//   parents keep the sign as written (sqrt, ∛, 1/x, 2^x … have no symmetry,
//   or an odd one where −x inside IS the textbook's y-axis reflection).
//   Refused (null): sums of parents (x^2 + |x|, sin x + cos x), products
//   (x·sin x, |x|·x), compositions (sqrt(x^2 + 1), sin(x^2)), other bases
//   (3^x, log_3 x, log x), non-parent polynomials (x^3 − x), a constant,
//   a slider anywhere, piecewise definitions.
//   Safety net: the reading is evaluated against the typed body at nine
//   points of the transformed domain (x = h + u/b for nine u in the parent's
//   domain, away from its breaks); any disagreement → null.
//
// Exact text (mapPoints, transformFeatures, describe): numbers are carried
// as r + s·π or r + s·e (r, s rational) when the spec's texts are such
// numbers, so (π/2)/2 + π/4 prints "π/2" and 2·e + 1 prints "2e + 1";
// anything else goes through exactForm (surds, fractions) or 4 significant
// digits. Card text: Unicode minus, π.
// ============================================================================

// ----------------------------------------------------------------------------
// Exact rationals (copied from sinusoidal.ts, which keeps them private)
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
// AST helpers (copied from sinusoidal.ts)
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
// (copied from sinusoidal.ts)
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
// Constant strings (copied from sinusoidal.ts)
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

const sameValue = (u: number, w: number, tol = 1e-12): boolean =>
  Math.abs(u - w) <= tol * Math.max(1, Math.abs(u), Math.abs(w))

// ----------------------------------------------------------------------------
// Computed numbers as source text (copied from sinusoidal.ts)
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

// ----------------------------------------------------------------------------
// Numbers for the card (Unicode)
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
// Exact numbers r + s·π or r + s·e (r, s rational) — what key points and
// shifts are made of
// ----------------------------------------------------------------------------

type Unit = 'pi' | 'e'

interface Q { r: Rat; s: Rat; u: Unit | null }

const ZERO_R: Rat = [0, 1]
const UNIT_VALUE: Record<Unit, number> = { pi: Math.PI, e: Math.E }
const UNIT_TEXT: Record<Unit, string> = { pi: 'π', e: 'e' }

const qR = (n: number, d = 1): Q => ({ r: rat(n, d)!, s: ZERO_R, u: null })
const qU = (u: Unit, n: number, d = 1): Q => ({ r: ZERO_R, s: rat(n, d)!, u })
const qRat = (r: Rat): Q => ({ r, s: ZERO_R, u: null })

const qVal = (q: Q): number => rVal(q.r) + (q.u ? rVal(q.s) * UNIT_VALUE[q.u] : 0)
const pureRat = (q: Q): boolean => q.s[0] === 0
const isZeroQ = (q: Q): boolean => q.r[0] === 0 && q.s[0] === 0

function qAdd(x: Q | null, y: Q | null): Q | null {
  if (!x || !y) return null
  let u: Unit | null = x.s[0] !== 0 ? x.u : null
  if (y.s[0] !== 0) {
    if (u && u !== y.u) return null
    u = y.u
  }
  const r = rAdd(x.r, y.r)
  const s = rAdd(x.s, y.s)
  if (!r || !s) return null
  return { r, s, u: s[0] === 0 ? null : u }
}

const qNeg = (x: Q | null): Q | null => x && { r: rNeg(x.r), s: rNeg(x.s), u: x.u }

function qScale(x: Q, m: Rat): Q | null {
  const r = rMul(x.r, m)
  const s = rMul(x.s, m)
  return r && s ? { r, s, u: s[0] === 0 ? null : x.u } : null
}

function qMul(x: Q | null, y: Q | null): Q | null {
  if (!x || !y) return null
  if (pureRat(x)) return qScale(y, x.r)
  if (pureRat(y)) return qScale(x, y.r)
  return null
}

function qDiv(x: Q | null, y: Q | null): Q | null {
  if (!x || !y || isZeroQ(y)) return null
  if (isZeroQ(x)) return qR(0)
  if (pureRat(y)) {
    const inv = rDiv([1, 1], y.r)
    return inv && qScale(x, inv)
  }
  // (s₁·U) / (s₂·U) is rational
  if (y.r[0] === 0 && x.r[0] === 0 && x.u === y.u) {
    const q = rDiv(x.s, y.s)
    return q && qRat(q)
  }
  return null
}

const qAbs = (x: Q | null): Q | null => (x && qVal(x) < 0 ? qNeg(x) : x)

/** A rational as card text: "−1/2", or "0.5" when the teacher writes decimals. */
const ratCard = (r: Rat, decimal: boolean): string =>
  (decimal ? ratDecText(r) : ratText(r)).replace('-', MINUS)

/** s·U as card text: "π", "−π", "3π/4", "e/2", "2e". */
function unitCard(s: Rat, u: Unit): string {
  const sym = UNIT_TEXT[u]
  const p = s[0]
  const head = p === 1 ? sym : p === -1 ? `${MINUS}${sym}` : `${String(p).replace('-', MINUS)}${sym}`
  return s[1] === 1 ? head : `${head}/${s[1]}`
}

function qText(q: Q, decimal = false): string {
  if (q.s[0] === 0 || !q.u) return ratCard(q.r, decimal)
  const ut = unitCard(q.s, q.u)
  if (q.r[0] === 0) return ut
  return q.r[0] > 0 ? `${ut} + ${ratCard(q.r, decimal)}` : `${ut} ${MINUS} ${ratCard(rNeg(q.r), decimal)}`
}

/** An exact number when we have one, else the card text of the value. */
const exactText = (q: Q | null, v: number, decimal = false): string =>
  q && sameValue(qVal(q), v, 1e-9) ? qText(q, decimal) : numText(v, decimal)

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

/** The single constant (pi / e) a term is made of, with numbers; null otherwise. */
function unitOf(n: ExprNode): Unit | null {
  const seen = new Set<Unit>()
  let bad = false
  const walk = (m: ExprNode): void => {
    switch (m.t) {
      case 'const':
        if (m.name === 'pi' || m.name === 'tau') seen.add('pi')
        else if (m.name === 'e') seen.add('e')
        else bad = true
        return
      case 'neg': walk(m.a); return
      case 'bin': walk(m.a); walk(m.b); return
      case 'num': return
      default: bad = true
    }
  }
  walk(n)
  if (bad || seen.size !== 1) return null
  return [...seen][0]
}

/** A spec text as r + s·U, when it is one ("3", "-1/2", "pi/4", "1 + pi/2", "2e"). */
function qOf(text: string): Q | null {
  const n = nodeOf(text)
  if (!n) return null
  const terms: { n: ExprNode; s: 1 | -1 }[] = []
  sumTerms(n, 1, terms)
  let acc: Q | null = qR(0)
  for (const t of terms) {
    const r = ratOf(t.n)
    if (r) {
      acc = qAdd(acc, qRat(t.s < 0 ? rNeg(r) : r))
      continue
    }
    const u = unitOf(t.n)
    if (!u) return null
    const v = evalAst(t.n, NaN) * t.s
    const s = snapRat(v / UNIT_VALUE[u], 1000, 1e-12)
    if (!s) return null
    acc = qAdd(acc, { r: ZERO_R, s, u })
  }
  return acc
}

// ----------------------------------------------------------------------------
// The parent library
// ----------------------------------------------------------------------------

/** Parent-argument values the safety net samples (away from every break). */
const U_ALL = [-2.3, -1.7, -0.9, -0.35, 0.21, 0.63, 1.4, 2.2, 3.1]
const U_POS = [0.13, 0.4, 0.77, 1.3, 2.1, 3.3, 4.6, 6.2, 8.9]
const U_TAN = [-1.3, -0.9, -0.5, -0.2, 0.1, 0.35, 0.7, 1.1, 1.4]

interface ParentData {
  id: ParentId
  name: string
  body: string
  latex: string
  f: (u: number) => number
  points: [Q, Q][]
  anchor: [Q, Q]
  anchorName: string
  domain: string
  range: string
  asymptotes: string
  samples: number[]
}

const P = (x: Q, y: Q): [Q, Q] => [x, y]
const O = qR(0)
const I = qR(1)
const pts5 = (f: (n: number) => number): [Q, Q][] => [-2, -1, 0, 1, 2].map((n) => P(qR(n), qR(f(n))))

const DATA: ParentData[] = [
  {
    id: 'linear', name: 'Linear', body: 'x', latex: 'y = x', f: (u) => u,
    points: pts5((n) => n), anchor: P(O, O), anchorName: 'reference point',
    domain: 'all real numbers', range: 'all real numbers', asymptotes: '', samples: U_ALL,
  },
  {
    id: 'quadratic', name: 'Quadratic', body: 'x^2', latex: 'y = x^{2}', f: (u) => u * u,
    points: pts5((n) => n * n), anchor: P(O, O), anchorName: 'vertex',
    domain: 'all real numbers', range: 'y ≥ 0', asymptotes: '', samples: U_ALL,
  },
  {
    id: 'cubic', name: 'Cubic', body: 'x^3', latex: 'y = x^{3}', f: (u) => u * u * u,
    points: pts5((n) => n * n * n), anchor: P(O, O), anchorName: 'inflection point',
    domain: 'all real numbers', range: 'all real numbers', asymptotes: '', samples: U_ALL,
  },
  {
    id: 'absolute', name: 'Absolute value', body: '|x|', latex: 'y = \\left|x\\right|', f: Math.abs,
    points: pts5(Math.abs), anchor: P(O, O), anchorName: 'vertex',
    domain: 'all real numbers', range: 'y ≥ 0', asymptotes: '', samples: U_ALL,
  },
  {
    id: 'sqrt', name: 'Square root', body: 'sqrt(x)', latex: 'y = \\sqrt{x}', f: Math.sqrt,
    points: [P(O, O), P(I, I), P(qR(4), qR(2)), P(qR(9), qR(3))], anchor: P(O, O), anchorName: 'starting point',
    domain: 'x ≥ 0', range: 'y ≥ 0', asymptotes: '', samples: U_POS,
  },
  {
    id: 'cbrt', name: 'Cube root', body: 'cbrt(x)', latex: 'y = \\sqrt[3]{x}', f: Math.cbrt,
    points: [P(qR(-8), qR(-2)), P(qR(-1), qR(-1)), P(O, O), P(I, I), P(qR(8), qR(2))],
    anchor: P(O, O), anchorName: 'inflection point',
    domain: 'all real numbers', range: 'all real numbers', asymptotes: '', samples: U_ALL,
  },
  {
    id: 'reciprocal', name: 'Reciprocal', body: '1/x', latex: 'y = \\frac{1}{x}', f: (u) => 1 / u,
    points: [
      P(qR(-2), qR(-1, 2)), P(qR(-1), qR(-1)), P(qR(-1, 2), qR(-2)),
      P(qR(1, 2), qR(2)), P(I, I), P(qR(2), qR(1, 2)),
    ],
    anchor: P(O, O), anchorName: 'center',
    domain: 'x ≠ 0', range: 'y ≠ 0', asymptotes: 'x = 0, y = 0', samples: U_ALL,
  },
  {
    id: 'reciprocal2', name: 'Reciprocal squared', body: '1/x^2', latex: 'y = \\frac{1}{x^{2}}',
    f: (u) => 1 / (u * u),
    points: [
      P(qR(-2), qR(1, 4)), P(qR(-1), I), P(qR(-1, 2), qR(4)),
      P(qR(1, 2), qR(4)), P(I, I), P(qR(2), qR(1, 4)),
    ],
    anchor: P(O, O), anchorName: 'center',
    domain: 'x ≠ 0', range: 'y > 0', asymptotes: 'x = 0, y = 0', samples: U_ALL,
  },
  {
    id: 'exp2', name: 'Exponential (base 2)', body: '2^x', latex: 'y = 2^{x}', f: (u) => Math.pow(2, u),
    points: [P(qR(-1), qR(1, 2)), P(O, I), P(I, qR(2)), P(qR(2), qR(4))],
    anchor: P(O, I), anchorName: 'key point',
    domain: 'all real numbers', range: 'y > 0', asymptotes: 'y = 0', samples: U_ALL,
  },
  {
    id: 'expe', name: 'Exponential (base e)', body: 'e^x', latex: 'y = e^{x}', f: Math.exp,
    points: [P(O, I), P(I, qU('e', 1))],
    anchor: P(O, I), anchorName: 'key point',
    domain: 'all real numbers', range: 'y > 0', asymptotes: 'y = 0', samples: U_ALL,
  },
  {
    id: 'log2', name: 'Logarithmic (base 2)', body: 'log_2(x)', latex: 'y = \\log_{2}x', f: Math.log2,
    points: [P(qR(1, 2), qR(-1)), P(I, O), P(qR(2), I), P(qR(4), qR(2))],
    anchor: P(I, O), anchorName: 'key point',
    domain: 'x > 0', range: 'all real numbers', asymptotes: 'x = 0', samples: U_POS,
  },
  {
    id: 'ln', name: 'Natural logarithm', body: 'ln(x)', latex: 'y = \\ln x', f: Math.log,
    points: [P(I, O), P(qU('e', 1), I)],
    anchor: P(I, O), anchorName: 'key point',
    domain: 'x > 0', range: 'all real numbers', asymptotes: 'x = 0', samples: U_POS,
  },
  {
    id: 'sin', name: 'Sine', body: 'sin(x)', latex: 'y = \\sin x', f: Math.sin,
    points: [P(O, O), P(qU('pi', 1, 2), I), P(qU('pi', 1), O), P(qU('pi', 3, 2), qR(-1)), P(qU('pi', 2), O)],
    anchor: P(O, O), anchorName: 'cycle start',
    domain: 'all real numbers', range: '−1 ≤ y ≤ 1', asymptotes: '', samples: U_ALL,
  },
  {
    id: 'cos', name: 'Cosine', body: 'cos(x)', latex: 'y = \\cos x', f: Math.cos,
    points: [P(O, I), P(qU('pi', 1, 2), O), P(qU('pi', 1), qR(-1)), P(qU('pi', 3, 2), O), P(qU('pi', 2), I)],
    anchor: P(O, I), anchorName: 'cycle start',
    domain: 'all real numbers', range: '−1 ≤ y ≤ 1', asymptotes: '', samples: U_ALL,
  },
  {
    id: 'tan', name: 'Tangent', body: 'tan(x)', latex: 'y = \\tan x', f: Math.tan,
    points: [P(qU('pi', -1, 4), qR(-1)), P(O, O), P(qU('pi', 1, 4), I)],
    anchor: P(O, O), anchorName: 'inflection point',
    domain: 'x ≠ π/2 + nπ', range: 'all real numbers', asymptotes: 'x = π/2 + nπ', samples: U_TAN,
  },
  {
    id: 'floor', name: 'Greatest integer', body: 'floor(x)', latex: 'y = \\left\\lfloor x\\right\\rfloor',
    f: Math.floor,
    points: pts5((n) => n), anchor: P(O, O), anchorName: 'step endpoint',
    domain: 'all real numbers', range: 'all integers', asymptotes: '', samples: U_ALL,
  },
]

const BY_ID = new Map<ParentId, ParentData>(DATA.map((d) => [d.id, d]))

export const PARENTS: ParentFn[] = DATA.map((d) => ({
  id: d.id,
  name: d.name,
  body: d.body,
  latex: d.latex,
  keyPoints: d.points.map(([x, y]) => ({ x: qVal(x), y: qVal(y), xText: qText(x), yText: qText(y) })),
  domain: d.domain,
  range: d.range,
  asymptotes: d.asymptotes,
  anchorName: d.anchorName,
}))

/** f(−u) = f(u): a reflection across the y-axis does nothing to these. */
const EVEN: ReadonlySet<ParentId> = new Set<ParentId>(['quadratic', 'absolute', 'reciprocal2', 'cos'])

// ----------------------------------------------------------------------------
// The spec as numbers
// ----------------------------------------------------------------------------

interface Vals {
  a: number; b: number; h: number; k: number
  qa: Q | null; qb: Q | null; qh: Q | null; qk: Q | null
  /** the teacher writes decimals: computed rationals print as decimals */
  dec: boolean
}

function valsOf(spec: TransformSpec): Vals {
  const a = txt(spec.a, '1')
  const b = txt(spec.b, '1')
  const h = txt(spec.h, '0')
  const k = txt(spec.k, '0')
  return {
    a: valueOf(a), b: valueOf(b), h: valueOf(h), k: valueOf(k),
    qa: qOf(a), qb: qOf(b), qh: qOf(h), qk: qOf(k),
    dec: `${a}${b}${h}${k}`.includes('.'),
  }
}

const finiteVals = (v: Vals): boolean => [v.a, v.b, v.h, v.k].every(Number.isFinite) && v.b !== 0

const dataOf = (spec: TransformSpec): ParentData | undefined => BY_ID.get(spec.parent)

/** a·f(b(x − h)) + k. */
function specAt(d: ParentData, v: Vals, x: number): number {
  return v.a * d.f(v.b * (x - v.h)) + v.k
}

// ----------------------------------------------------------------------------
// transformSource
// ----------------------------------------------------------------------------

/**
 * A factor written bare in front of what it multiplies: a number, a constant,
 * one call, or a number times one of those, with an optional leading minus.
 * Fractions are NOT bare here: (1/2)x^2, not 1/2x^2.
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

/** A quotient at the top (pi/6, -1/2): written `1/2 x` before a bare x. */
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

const PROBE_XS = [-1.37, 0.41, 2.9, 5.3]

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
    let tested = 0
    const ok = PROBE_XS.every((x) => {
      const want = cv * evalAst(r.lhs, x)
      if (!Number.isFinite(want)) return true // outside the domain: no test here
      tested++
      const got = evalAst(ast.lhs, x)
      return sameValue(got, want, 1e-9)
    })
    if (ok && tested > 0) return c
  }
  return candidates[candidates.length - 1]
}

/** The argument b(x − h), written the textbook way (as sinusoidal.ts does). */
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

/** The parent applied to the inner argument, no coefficient. */
function bodyText(parent: ParentId, inner: string): string {
  const group = inner === 'x' ? 'x' : `(${inner})`
  switch (parent) {
    case 'linear': return group
    case 'quadratic': return `${group}^2`
    case 'cubic': return `${group}^3`
    case 'absolute': return `|${inner}|`
    case 'sqrt': return `sqrt(${inner})`
    case 'cbrt': return `cbrt(${inner})`
    case 'reciprocal': return `1/${group}`
    case 'reciprocal2': return `1/${group}^2`
    case 'exp2': return `2^${group}`
    case 'expe': return `e^${group}`
    case 'log2': return `log_2(${inner})`
    case 'ln': return `ln(${inner})`
    case 'sin': return `sin(${inner})`
    case 'cos': return `cos(${inner})`
    case 'tan': return `tan(${inner})`
    case 'floor': return `floor(${inner})`
  }
}

/** a·(body), written the textbook way. */
function withCoefficient(parent: ParentId, a: string, inner: string): string {
  const body = bodyText(parent, inner)
  if (isExactly(a, 1)) return body
  const group = inner === 'x' ? 'x' : `(${inner})`
  if (parent === 'reciprocal' || parent === 'reciprocal2') {
    const den = parent === 'reciprocal' ? group : `${group}^2`
    const cands = [`${a}/${den}`, `(${a})/${den}`]
    if (!(bareFactor(a) && !a.includes('/'))) cands.shift()
    return firstProduct(cands, a, body)
  }
  if (isExactly(a, -1)) return `-${body}`
  if (parent === 'exp2') {
    const tail = `(2)^${group}`
    const cands: string[] = []
    if (bareFactor(a)) cands.push(`${a}${tail}`)
    cands.push(`(${a})${tail}`, `(${a})*2^${group}`)
    return firstProduct(cands, a, body)
  }
  const cands: string[] = []
  if (bareFactor(a)) cands.push(`${a}${joinSep(a, body)}${body}`)
  cands.push(`(${a})${body}`, `(${a})*${body}`)
  return firstProduct(cands, a, body)
}

export function transformSource(spec: TransformSpec): string {
  const head = spec.name ? `${spec.name}(x) = ` : 'y = '
  const parent: ParentId = BY_ID.has(spec.parent) ? spec.parent : 'linear'
  const a = txt(spec.a, '1')
  const k = txt(spec.k, '0')
  if (isExactly(a, 0)) return `${head}${k}`
  const inner = argumentText(txt(spec.b, '1'), txt(spec.h, '0'))
  return `${head}${withCoefficient(parent, a, inner)}${constantTail(k)}`
}

// ----------------------------------------------------------------------------
// readTransform — reading a linear argument (copied from sinusoidal.ts)
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
  for (const D of divs) S = cDiv(S, D)
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
 * text (copied from sinusoidal.ts). One leaf with power 1 keeps its own
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

// ----------------------------------------------------------------------------
// readTransform — one parent term
// ----------------------------------------------------------------------------

const CALL_PARENT: Readonly<Record<string, ParentId>> = {
  abs: 'absolute',
  sqrt: 'sqrt',
  cbrt: 'cbrt',
  ln: 'ln',
  log2: 'log2',
  exp: 'expe',
  sin: 'sin',
  cos: 'cos',
  tan: 'tan',
  floor: 'floor',
}

/** The leaf of a parent term: which parent, its argument, and whether b flips. */
function classifyLeaf(n: ExprNode, p: 1 | -1): { parent: ParentId; arg: ExprNode; flip: boolean } | null {
  // base^u with a constant base: 2^u, e^u — and 1/2^u = 2^(−u)
  if (n.t === 'bin' && n.op === '^' && !hasVar(n.a) && hasVar(n.b)) {
    const base = n.a.t === 'const' && n.a.name === 'e' ? 'expe' : isRat(cOf(n.a), 2) ? 'exp2' : null
    return base ? { parent: base, arg: n.b, flip: p < 0 } : null
  }
  if (n.t === 'call' && n.fn === 'exp') return { parent: 'expe', arg: n.args[0], flip: p < 0 }
  if (p < 0) {
    // 1/u, 1/u^2
    if (readLinear(n)) return { parent: 'reciprocal', arg: n, flip: false }
    if (n.t === 'bin' && n.op === '^' && !hasVar(n.b) && isRat(cOf(n.b), 2)) {
      return { parent: 'reciprocal2', arg: n.a, flip: false }
    }
    return null
  }
  if (n.t === 'call') {
    if (n.fn === 'log_') {
      const base = n.args[0]
      return !hasVar(base) && isRat(cOf(base), 2) ? { parent: 'log2', arg: n.args[1], flip: false } : null
    }
    const parent = CALL_PARENT[n.fn]
    return parent && n.args.length === 1 ? { parent, arg: n.args[0], flip: false } : null
  }
  if (n.t === 'bin' && n.op === '^' && !hasVar(n.b)) {
    const e = ratOf(n.b)
    if (!e) return null
    const parent: ParentId | null =
      e[1] === 1
        ? e[0] === 2 ? 'quadratic' : e[0] === 3 ? 'cubic' : e[0] === -1 ? 'reciprocal' : e[0] === -2 ? 'reciprocal2' : null
        : e[0] === 1 && e[1] === 2 ? 'sqrt' : null
    return parent ? { parent, arg: n.a, flip: false } : null
  }
  return null // a bare linear leaf is the polynomial path's (slope-intercept)
}

function readOneTerm(body: ExprNode): TransformSpec | null {
  const terms: { n: ExprNode; s: 1 | -1 }[] = []
  sumTerms(body, 1, terms)
  const constants: C[] = []
  const varTerms: { n: ExprNode; s: 1 | -1 }[] = []
  for (const t of terms) {
    if (hasVar(t.n)) varTerms.push(t)
    else constants.push(t.s < 0 ? cNeg(cOf(t.n)) : cOf(t.n))
  }
  if (varTerms.length !== 1) return null

  let sign = varTerms[0].s as number
  const consts: { c: C; p: number }[] = []
  const leaves: { n: ExprNode; p: 1 | -1 }[] = []
  const flatten = (n: ExprNode, p: 1 | -1): void => {
    if (!hasVar(n)) consts.push({ c: cOf(n), p })
    else if (n.t === 'neg') { sign = -sign; flatten(n.a, p) }
    else if (n.t === 'bin' && n.op === '*') { flatten(n.a, p); flatten(n.b, p) }
    else if (n.t === 'bin' && n.op === '/') {
      flatten(n.a, p)
      // a denominator linear in x is the reciprocal's argument, constants
      // and all: 1/(2(x − 1)) is b = 2 (written inside), not a = 1/2
      if (hasVar(n.b) && readLinear(n.b)) leaves.push({ n: n.b, p: -p as 1 | -1 })
      else flatten(n.b, -p as 1 | -1)
    }
    else leaves.push({ n, p })
  }
  flatten(varTerms[0].n, 1)
  if (leaves.length !== 1) return null // (x − 2)(x − 4), x·sin x: not one leaf

  const leaf = classifyLeaf(leaves[0].n, leaves[0].p)
  if (!leaf) return null
  const lin = readLinear(leaf.arg)
  if (!lin) return null // sqrt(x^2 + 1), sin(x^2)
  const a = coefficientText(sign, consts)
  if (a === null || a === '0') return null
  return {
    parent: leaf.parent,
    a,
    b: cText(leaf.flip ? cNeg(lin.b) : lin.b),
    h: phaseText(lin),
    k: constants.length === 0 ? '0' : cText(cSum(constants)),
  }
}

// ----------------------------------------------------------------------------
// readTransform — polynomials (linear; quadratic → vertex form; a(x − h)³ + k)
// ----------------------------------------------------------------------------

/** A coefficient: its value and, when it has one, its exact rational. */
interface PC { v: number; r: Rat | null }

const pcR = (r: Rat): PC => ({ v: rVal(r), r })
const pcAdd = (a: PC, b: PC): PC => ({ v: a.v + b.v, r: a.r && b.r ? rAdd(a.r, b.r) : null })
const pcMul = (a: PC, b: PC): PC => ({ v: a.v * b.v, r: a.r && b.r ? rMul(a.r, b.r) : null })
const pcNeg = (a: PC): PC => ({ v: -a.v, r: a.r && rNeg(a.r) })
const pcDiv = (a: PC, b: PC): PC => ({ v: a.v / b.v, r: a.r && b.r ? rDiv(a.r, b.r) : null })

const MAX_DEGREE = 6

function polyAdd(p: PC[], q: PC[]): PC[] {
  const out: PC[] = []
  for (let i = 0; i < Math.max(p.length, q.length); i++) out.push(pcAdd(p[i] ?? pcR([0, 1]), q[i] ?? pcR([0, 1])))
  return out
}

function polyMul(p: PC[], q: PC[]): PC[] | null {
  if (p.length + q.length - 2 > MAX_DEGREE) return null
  const out: PC[] = Array.from({ length: p.length + q.length - 1 }, () => pcR([0, 1]))
  for (let i = 0; i < p.length; i++) for (let j = 0; j < q.length; j++) out[i + j] = pcAdd(out[i + j], pcMul(p[i], q[j]))
  return out
}

/** The coefficients (index = power) of a polynomial in x, or null. */
function polyOf(n: ExprNode): PC[] | null {
  if (!hasVar(n)) {
    const v = evalAst(n, NaN)
    return Number.isFinite(v) ? [{ v, r: ratOf(n) }] : null
  }
  switch (n.t) {
    case 'var': return [pcR([0, 1]), pcR([1, 1])]
    case 'neg': {
      const p = polyOf(n.a)
      return p && p.map(pcNeg)
    }
    case 'bin': {
      if (n.op === '+' || n.op === '-') {
        const p = polyOf(n.a)
        const q = polyOf(n.b)
        return p && q ? polyAdd(p, n.op === '-' ? q.map(pcNeg) : q) : null
      }
      if (n.op === '*') {
        const p = polyOf(n.a)
        const q = polyOf(n.b)
        return p && q ? polyMul(p, q) : null
      }
      if (n.op === '/') {
        if (hasVar(n.b)) return null
        const p = polyOf(n.a)
        const d: PC = { v: evalAst(n.b, NaN), r: ratOf(n.b) }
        return p && d.v !== 0 && Number.isFinite(d.v) ? p.map((c) => pcDiv(c, d)) : null
      }
      if (n.op === '^') {
        if (hasVar(n.b)) return null
        const e = ratOf(n.b)
        if (!e || e[1] !== 1 || e[0] < 0 || e[0] > MAX_DEGREE) return null
        const base = polyOf(n.a)
        if (!base) return null
        let out: PC[] | null = [pcR([1, 1])]
        for (let i = 0; i < e[0] && out; i++) out = polyMul(out, base)
        return out
      }
      return null
    }
    default:
      return null
  }
}

function pcText(c: PC, decimal: boolean): string {
  if (c.r) return decimal ? ratDecText(c.r) : ratText(c.r)
  return numSource(c.v, decimal)
}

function readPolynomial(body: ExprNode, decimal: boolean): TransformSpec | null {
  const p = polyOf(body)
  if (!p) return null
  const scale = Math.max(1, ...p.map((c) => Math.abs(c.v)))
  const isZero = (c: PC | undefined) => !c || (c.r ? c.r[0] === 0 : Math.abs(c.v) <= 1e-12 * scale)
  let deg = p.length - 1
  while (deg > 0 && isZero(p[deg])) deg--
  const c = (i: number): PC => p[i] ?? pcR([0, 1])
  const t = (x: PC) => pcText(x, decimal)
  if (deg === 1) return { parent: 'linear', a: t(c(1)), b: '1', h: '0', k: t(c(0)) }
  if (deg === 2) {
    // a(x − h)² + k: h = −c₁/(2a), k = c₀ − c₁²/(4a)
    const a = c(2)
    const h = pcNeg(pcDiv(c(1), pcMul(pcR([2, 1]), a)))
    const k = pcAdd(c(0), pcNeg(pcDiv(pcMul(c(1), c(1)), pcMul(pcR([4, 1]), a))))
    return { parent: 'quadratic', a: t(a), b: '1', h: t(h), k: t(k) }
  }
  if (deg === 3) {
    // a(x − h)³ + k = a x³ − 3ah x² + 3ah² x − ah³ + k
    const a = c(3)
    const h = pcNeg(pcDiv(c(2), pcMul(pcR([3, 1]), a)))
    const lin = pcMul(pcMul(pcR([3, 1]), a), pcMul(h, h))
    const fits = lin.r && c(1).r ? lin.r[0] === c(1).r![0] && lin.r[1] === c(1).r![1] : sameValue(lin.v, c(1).v, 1e-9)
    if (!fits) return null // x³ − x is not a transformed x³
    const k = pcAdd(c(0), pcMul(a, pcMul(h, pcMul(h, h))))
    return { parent: 'cubic', a: t(a), b: '1', h: t(h), k: t(k) }
  }
  return null
}

// ----------------------------------------------------------------------------
// readTransform
// ----------------------------------------------------------------------------

export function readTransform(src: string): TransformSpec | null {
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
  const v = head ?? (usesVar(body, 't') && !usesVar(body, 'x') ? 't' : 'x')
  if (!onlyVar(body, v) || !usesVar(body, v)) return null

  const decimal = srcOf(body).includes('.')
  let spec = readOneTerm(body) ?? readPolynomial(body, decimal)
  if (!spec) return null

  // even parents: f(−u) = f(u), so b > 0
  if (EVEN.has(spec.parent) && valueOf(spec.b) < 0) spec = { ...spec, b: negText(spec.b) }
  if (name) spec = { name, ...spec }

  // ---- safety net: the reading must BE the typed function ----------------
  const d = dataOf(spec)!
  const vals = valsOf(spec)
  if (!finiteVals(vals) || vals.a === 0) return null
  for (const u of d.samples) {
    const x = vals.h + u / vals.b
    const want = evalAst(body, x)
    const got = specAt(d, vals, x)
    if (!Number.isFinite(want) || !Number.isFinite(got)) return null
    if (Math.abs(want - got) > 1e-7 * Math.max(1, Math.abs(want))) return null
  }
  return spec
}

// ----------------------------------------------------------------------------
// describe
// ----------------------------------------------------------------------------

/** 1/|b| as card text: "1/2", "3", "6/π". */
function reciprocalText(qb: Q | null, b: number, decimal: boolean): string {
  const inv = 1 / Math.abs(b)
  if (qb && sameValue(qVal(qb), b, 1e-9)) {
    if (pureRat(qb)) {
      const r = rDiv([1, 1], qb.r)
      if (r) return ratCard(r[0] < 0 ? rNeg(r) : r, decimal)
    } else if (qb.r[0] === 0 && qb.u) {
      // b = (p/q)·U → 1/|b| = q/(|p|·U)
      const p = Math.abs(qb.s[0])
      const sym = UNIT_TEXT[qb.u]
      return p === 1 ? `${qb.s[1]}/${sym}` : `${qb.s[1]}/(${p}${sym})`
    }
  }
  return numText(inv, decimal)
}

export function describe(spec: TransformSpec): TransformStep[] {
  const v = valsOf(spec)
  if (!finiteVals(v) || v.a === 0 || !dataOf(spec)) return []
  const steps: TransformStep[] = []
  const abs = (q: Q | null, x: number) => exactText(qAbs(q), Math.abs(x), v.dec)

  // b: stretch/compression by 1/|b|, then the reflection across the y-axis
  const B = Math.abs(v.b)
  if (!sameValue(B, 1)) {
    const factor = reciprocalText(v.qb, v.b, v.dec)
    steps.push(
      B > 1
        ? { kind: 'h-compress', sentence: `horizontal compression by a factor of ${factor}` }
        : { kind: 'h-stretch', sentence: `horizontal stretch by a factor of ${factor}` },
    )
  }
  if (v.b < 0) steps.push({ kind: 'reflect-y', sentence: 'reflection across the y-axis' })
  // h
  if (v.h !== 0) {
    steps.push({ kind: 'shift-h', sentence: `shift ${v.h > 0 ? 'right' : 'left'} ${abs(v.qh, v.h)}` })
  }
  // a: stretch/compression by |a|, then the reflection across the x-axis
  const A = Math.abs(v.a)
  if (!sameValue(A, 1)) {
    const factor = abs(v.qa, v.a)
    steps.push(
      A > 1
        ? { kind: 'v-stretch', sentence: `vertical stretch by a factor of ${factor}` }
        : { kind: 'v-compress', sentence: `vertical compression by a factor of ${factor}` },
    )
  }
  if (v.a < 0) steps.push({ kind: 'reflect-x', sentence: 'reflection across the x-axis' })
  // k
  if (v.k !== 0) {
    steps.push({ kind: 'shift-v', sentence: `shift ${v.k > 0 ? 'up' : 'down'} ${abs(v.qk, v.k)}` })
  }
  return steps
}

// ----------------------------------------------------------------------------
// mapPoints
// ----------------------------------------------------------------------------

/** The image (x/b + h, a·y + k) of one parent point, exactly when possible. */
function imageOf(v: Vals, px: Q, py: Q): { to: Vec2; toText: [string, string] } {
  const x = qVal(px) / v.b + v.h
  const y = v.a * qVal(py) + v.k
  const qx = qAdd(qDiv(px, v.qb), v.qh)
  const qy = qAdd(qMul(v.qa, py), v.qk)
  return { to: { x, y }, toText: [exactText(qx, x, v.dec), exactText(qy, y, v.dec)] }
}

export function mapPoints(spec: TransformSpec): { from: Vec2; to: Vec2; fromText: [string, string]; toText: [string, string] }[] {
  const d = dataOf(spec)
  const v = valsOf(spec)
  if (!d || !finiteVals(v)) return []
  return d.points.map(([px, py]) => ({
    from: { x: qVal(px), y: qVal(py) },
    fromText: [qText(px), qText(py)] as [string, string],
    ...imageOf(v, px, py),
  }))
}

// ----------------------------------------------------------------------------
// transformFeatures
// ----------------------------------------------------------------------------

/** n·p as text: "nπ", "nπ/2", "2nπ", "3n", "n/2"; `n·1.571` otherwise. */
function nTimes(q: Q | null, p: number, decimal: boolean): string {
  if (q && sameValue(qVal(q), p, 1e-9) && (pureRat(q) || q.r[0] === 0)) {
    const c = pureRat(q) ? q.r : q.s
    const sym = pureRat(q) || !q.u ? '' : UNIT_TEXT[q.u]
    const num = c[0] === 1 ? '' : String(c[0])
    return `${num}n${sym}${c[1] === 1 ? '' : `/${c[1]}`}`
  }
  return `n·${numText(p, decimal)}`
}

/** c − ⌊c/p⌋·p: the representative of c + np in [0, p). */
function reduceMod(qc: Q | null, qp: Q | null, c: number, p: number): { q: Q | null; v: number } {
  const v = c - Math.floor(c / p + 1e-12) * p
  const ratio = qDiv(qc, qp)
  if (qc && qp && ratio && pureRat(ratio)) {
    const n = Math.floor(rVal(ratio.r))
    const q = qAdd(qc, qMul(qR(-n), qp))
    return { q, v: q ? qVal(q) : v }
  }
  return { q: null, v: Math.abs(v - p) < 1e-12 * Math.max(1, p) ? 0 : v }
}

export function transformFeatures(spec: TransformSpec): TransformFeatures {
  const d = dataOf(spec)
  const v = valsOf(spec)
  if (!d || !finiteVals(v)) return { domain: '', range: '', asymptotes: '', anchor: null }
  const dec = v.dec
  const hT = exactText(v.qh, v.h, dec)
  const kT = exactText(v.qk, v.k, dec)
  const up = v.a > 0
  const right = v.b > 0

  let domain = 'all real numbers'
  let range = 'all real numbers'
  let asymptotes = ''
  switch (d.id) {
    case 'quadratic':
    case 'absolute':
      range = `y ${up ? '≥' : '≤'} ${kT}`
      break
    case 'sqrt':
      domain = `x ${right ? '≥' : '≤'} ${hT}`
      range = `y ${up ? '≥' : '≤'} ${kT}`
      break
    case 'reciprocal':
      domain = `x ≠ ${hT}`
      range = `y ≠ ${kT}`
      asymptotes = `x = ${hT}, y = ${kT}`
      break
    case 'reciprocal2':
      domain = `x ≠ ${hT}`
      range = `y ${up ? '>' : '<'} ${kT}`
      asymptotes = `x = ${hT}, y = ${kT}`
      break
    case 'exp2':
    case 'expe':
      range = `y ${up ? '>' : '<'} ${kT}`
      asymptotes = `y = ${kT}`
      break
    case 'log2':
    case 'ln':
      domain = `x ${right ? '>' : '<'} ${hT}`
      asymptotes = `x = ${hT}`
      break
    case 'sin':
    case 'cos': {
      const A = Math.abs(v.a)
      const qA = qAbs(v.qa)
      const lo = exactText(qAdd(v.qk, qNeg(qA)), v.k - A, dec)
      const hi = exactText(qAdd(v.qk, qA), v.k + A, dec)
      range = `${lo} ≤ y ≤ ${hi}`
      break
    }
    case 'tan': {
      // b(x − h) = π/2 + nπ  ⇔  x = h + π/(2|b|) + n·π/|b|
      const B = Math.abs(v.b)
      const qB = qAbs(v.qb)
      const qp = qDiv(qU('pi', 1), qB)
      const qc = qAdd(v.qh, qDiv(qU('pi', 1, 2), qB))
      const p = Math.PI / B
      const first = reduceMod(qc, qp, v.h + p / 2, p)
      const nP = nTimes(qp, p, dec)
      const at = Math.abs(first.v) < 1e-12 ? nP : `${exactText(first.q, first.v, dec)} + ${nP}`
      domain = `x ≠ ${at}`
      asymptotes = `x = ${at}`
      break
    }
    case 'floor': {
      // a·n + k over the integers n
      const A = Math.abs(v.a)
      const qA = qAbs(v.qa)
      if (qA && pureRat(qA) && v.qk && pureRat(v.qk) && sameValue(qVal(qA), A, 1e-9) && sameValue(qVal(v.qk), v.k, 1e-9)) {
        const kr = reduceMod(v.qk, qA, v.k, A)
        const aIsOne = qA.r[0] === 1 && qA.r[1] === 1
        if (aIsOne && kr.q && isZeroQ(kr.q)) range = 'all integers'
        else {
          const nA = nTimes(qA, A, dec)
          range = kr.q && isZeroQ(kr.q) ? `y = ${nA}` : `y = ${nA} + ${exactText(kr.q, kr.v, dec)}`
        }
      } else {
        const kTail = v.k === 0 ? '' : v.k > 0 ? ` + ${kT}` : ` ${MINUS} ${exactText(qNeg(v.qk), -v.k, dec)}`
        range = `y = ${nTimes(qA, A, dec)}${kTail}`
      }
      break
    }
    default:
      break // linear, cubic, cube root: all real numbers both ways
  }
  if (v.a === 0) {
    range = `y = ${kT}`
    asymptotes = ''
  }

  const [ax, ay] = d.anchor
  const img = imageOf(v, ax, ay)
  return {
    domain,
    range,
    asymptotes,
    anchor: { name: d.anchorName, x: img.to.x, y: img.to.y, xText: img.toText[0], yText: img.toText[1] },
  }
}

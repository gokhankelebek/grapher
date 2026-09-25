// ============================================================================
// Logarithmic functions, the way a precalculus class states them
// (src/core/logarithmic.ts)
//
//     y = a·log_b(c(x − h)) + k          (c defaults to 1)
//
//   b  the base: any b > 0, b ≠ 1; "e" is ln, "10" is the common log
//   a  vertical stretch/reflection, c horizontal scale (c < 0 reflects the
//      graph across x = h, so the domain becomes x < h)
//   h  the vertical asymptote x = h;  k the vertical shift
//
// Sibling of src/core/exponential.ts and src/core/factored.ts: a spec becomes
// a TYPED EXPRESSION and goes through the ordinary parser, so the vertical
// asymptote (a pole of ln), intercepts, exact forms, intersections, end caps,
// natural-domain endpoints and the exam figures all apply unchanged.
//
// PARSER (additive, same wave, core agent): arbitrary bases are typed as
//     log_3(x), log_(1/2)(x - 1), log_b(x) with a slider b, log_10(x)
// evaluate as ln(arg)/ln(base), render as \log_{3}\left(x\right), and join
// the existing ln/log/log2/log10 as singular arguments. log(x) stays log₁₀,
// log2/log10 keep working.
//
//   export function logSource(spec): string
//       canonical parseable source: "y = log_3(x)", "y = 2ln(x - 1) + 4",
//       "f(x) = -log_(1/2)(2(x + 3)) - 1", "y = log(x)" for base 10.
//   export function readLogarithmic(src): LogSpec | null
//       the inverse for any typed explicit a·log_b(linear in x) + k,
//       including ln, log, log2, log10, log_b, ln(x)/ln(3) (change of base,
//       read as base 3); only a linear argument — log(x^2), ln(abs(x)) → null,
//       as is anything else. Verified numerically against the typed formula.
//   export function logFeatures(spec): LogFeatures
//   export function logFromTwoPoints(p1, p2, h = 0, b = 'e'): LogSpec | null
//       through two points with asymptote x = h in the given base (solves a
//       and k); null when a point is on the wrong side of the asymptote or
//       the two share an x.
//   export function logAsInverse(exp: ExpSpec): LogSpec
//   export function expAsInverse(log: LogSpec): ExpSpec
//       the inverse function, exactly: y = a·b^((x − h)/p) + k ⇄
//       y = p·log_b((x − k)/a) + h.
//   export function rebase(spec, base): LogSpec
//       the same function in another base (change of base folds 1/ln(b) into
//       a): "ln" ⇄ "log" ⇄ log_2 … for the card's "write in base" switch.
// ============================================================================

import type { ExpSpec } from './exponential'
import { evalAst, parseAst, type ExprNode } from './parse'

export interface LogSpec {
  /** The function's name when typed as f(x) = …; absent for y = … */
  name?: string
  /** Vertical stretch, as written ("1", "-2", "1/2"). */
  a: string
  /** The base as written: "e" (ln), "10" (log), "2", "1/2", "3". */
  b: string
  /** Horizontal scale inside the log, default "1". */
  c: string
  /** Vertical asymptote x = h, default "0". */
  h: string
  /** Vertical shift, default "0". */
  k: string
}

export interface LogFeatures {
  /** x = h */
  asymptote: number
  /** "x > 3" or "x < 3" */
  domain: string
  /** always "all real numbers" */
  range: string
  xIntercept: number | null
  yIntercept: number | null
  /** The point where the argument is 1 — (h + 1/c, k) — the anchor. */
  anchor: { x: number; y: number }
  /** The point where the argument is b — (h + b/c, k + a). */
  basePoint: { x: number; y: number }
  increasing: boolean
  concaveUp: boolean
  endBehaviour: string
  /** Teacher sentences: "vertical asymptote x = 1", "passes through (2, 4)
   *  and (4, 6)", "log₂ x = ln x / ln 2". */
  sentences: string[]
}


// ============================================================================
// Implementation
//
// Syntax (src/core/parse): log_B(u) with B a number literal (log_3, log_10,
// log_2.5), a constant or single letter (log_e = ln, log_pi, log_b — a slider
// that starts at 2, since a base of 1 has no logarithm), or a parenthesised
// constant expression (log_(1/2), log_(sqrt(2))). The argument is
// parenthesised or paren-less exactly like `ln x`: `log_2 x` is log₂(x) and
// `log_2 x + 1` is log₂(x) + 1; the digits after `_` are always the whole
// base, so `log_2x` is log₂(x) as well. `log_(x)(2)` is an error ("The base of
// a logarithm must be a number"), so is a bare `log_`.
//
// Canonical source (logSource):
//   head      `y = ` or `name(x) = `.
//   function  base e → ln(…), base 10 → log(…), otherwise log_B(…) with B bare
//             when it is a plain decimal number (log_3, log_0.5, log_2.5) and
//             parenthesised otherwise (log_(1/2), log_(sqrt(2)), log_(pi)).
//   a         omitted for 1, `-` for −1; written bare when it is a number, a
//             constant, one call (sqrt(3)) or a number times one of those,
//             each with an optional minus; otherwise parenthesised — a
//             fraction included, so (1/2)ln(x), never 1/2ln(x).
//   argument  X = x, x - h, x + |h| (x - (h) when h is a sum);
//             c = 1 → X;  c = −1 → -x / -(X);  otherwise cx when h = 0 and
//             c(X) when not, c bare or parenthesised by the rule for a:
//             ln(x), ln(x - 1), log_3(2x), log_3(-(x - 3)), ln((1/2)(x + 1)).
//   k         omitted for 0; ` - s` for "-s", ` + (…)` for a sum, else ` + k`.
//   Numbers keep the teacher's text throughout.
//
// Reading (readLogarithmic): the body (after `y =`, `f(x) =`, or bare) is a sum
// of constant terms and exactly ONE term that is a product/quotient of
// constants and one logarithm (ln, log, log2, log10, log_B) of an argument
// linear in the variable. Then:
//   * the constant terms are k (text kept for one; exact rationals fold);
//   * the argument u = sign·ΠK/ΠP·(c·x + d) gives c (the total x-coefficient)
//     and h = −d/c: x − 1 → c 1, h 1; 2x − 6 → c 2, h 3; 3 − x → c −1, h 3;
//     2(x + 3) → c 2, h −3;
//   * CHANGE OF BASE: a constant logarithm in the DENOMINATOR, in the same
//     base as the variable one, is folded into the base: ln(x)/ln(3) →
//     log_3(x), log(x)/log(2) → log_2(x), 2ln(x − 1)/ln(1/2) + 4 → a 2,
//     base 1/2. In a different base (ln(x)/log(3)) it stays a constant factor
//     of a — the function is the same either way;
//   * the remaining constant factors are a (same rules as factored.ts).
//   Refused (null): log(x²), x·ln(x), 1/ln(x), ln(x)², ln(x) + ln(x + 1), a
//   slider anywhere (log_b(x)), and ln(abs(x)) / ln|x| — its argument is not
//   linear: it is the two-branched even function, not one member of this
//   family, so it stays an ordinary typed expression.
//   Safety net: the reading is evaluated against the typed body at nine
//   points of its domain; any disagreement → null.
//
// Change of base (rebase): a' = a·ln(b')/ln(b). When that ratio is a small
//   exact fraction (2 ⇄ 4 ⇄ 8, 1/2 ⇄ 2, 3 ⇄ 9, 2 ⇄ sqrt(2), 10 ⇄ 100) a' is
//   written exactly (log_4 → log_2 halves a; log_(1/2) → log_2 negates it);
//   otherwise a' is a decimal with 12 significant digits: log_2(x) in base e
//   is 1.44269504089ln(x). The symbolic 1/ln(2) is deliberately NOT used:
//   readLogarithmic would read (1/ln(2))ln(x) straight back as log_2(x) (it
//   is the change-of-base formula), so the card's base switch would snap
//   back. The 12-digit text agrees with the function to ~1e-12 relative.
// ============================================================================

// ----------------------------------------------------------------------------
// Exact rationals (copied from exponential.ts, which keeps them private)
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

/** A computed number: a small fraction when it IS one (1e-9), else 12 digits. */
function computedText(v: number): string {
  const r = snapRat(v, 100, 1e-9)
  return r ? ratDecText(r) : dec12(v)
}

// ----------------------------------------------------------------------------
// AST helpers (copied from exponential.ts; srcOf also prints log_B)
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
const E_C: C = { v: Math.E, r: null, n: { t: 'const', name: 'e' } }
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

/**
 * A base as the spec stores it. Accepts the base itself ("e", "10", "2",
 * "1/2") and the names of the functions: "ln" → "e", "log" → "10",
 * "log2" → "2", "log10" → "10", "log_3" / "log_(1/2)" → "3" / "1/2".
 */
function normBase(b: string | undefined): string {
  const t = txt(b, 'e')
  if (t === 'ln' || t === 'e') return 'e'
  if (t === 'log' || t === 'log10') return '10'
  if (t === 'log2') return '2'
  const m = /^log_\s*(.+)$/.exec(t)
  if (m) {
    const inner = m[1].trim()
    const bare = /^\((.*)\)$/.exec(inner)
    return normBase(bare ? bare[1] : inner)
  }
  return t
}

/** The base's value (e for "e"); NaN when it is not a valid base. */
function baseValue(b: string | undefined): number {
  const t = normBase(b)
  const v = t === 'e' ? Math.E : valueOf(t)
  return v > 0 && v !== 1 && Number.isFinite(v) ? v : NaN
}

/** The parts of a spec as numbers. */
function valuesOf(spec: LogSpec) {
  return {
    a: valueOf(txt(spec.a, '1')),
    b: baseValue(spec.b),
    c: valueOf(txt(spec.c, '1')),
    h: valueOf(txt(spec.h, '0')),
    k: valueOf(txt(spec.k, '0')),
  }
}

/** The value of the spec's function at x (NaN outside its domain). */
function specAt(spec: LogSpec, x: number): number {
  const { a, b, c, h, k } = valuesOf(spec)
  return (a * Math.log(c * (x - h))) / Math.log(b) + k
}

// ----------------------------------------------------------------------------
// logSource
// ----------------------------------------------------------------------------

/**
 * A factor written bare in front of what it multiplies: a number, a constant,
 * one call, or a number times one of those, with an optional leading minus.
 * Fractions are NOT bare here: (1/2)ln(x), not 1/2ln(x).
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

const factorText = (s: string): string => (bareFactor(s) ? s : `(${s})`)

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

/** The function's name for a base: ln, log, log_3, log_(1/2). */
function logName(b: string): string {
  if (b === 'e') return 'ln'
  if (isExactly(b, 10)) return 'log'
  return PLAIN_NUMBER.test(b) ? `log_${b}` : `log_(${b})`
}

/** The argument c(x − h), written the textbook way. */
function argumentText(c: string, h: string): string {
  const X = shifted(h)
  if (isExactly(c, 1)) return X
  if (isExactly(c, -1)) return X === 'x' ? '-x' : `-(${X})`
  const coef = factorText(c)
  if (X === 'x') return `${coef}${joinSep(coef, 'x')}x`
  return `${coef}(${X})`
}

export function logSource(spec: LogSpec): string {
  const head = spec.name ? `${spec.name}(x) = ` : 'y = '
  const a = txt(spec.a, '1')
  const call = `${logName(normBase(spec.b))}(${argumentText(txt(spec.c, '1'), txt(spec.h, '0'))})`
  let term: string
  if (isExactly(a, 1)) term = call
  else if (isExactly(a, -1)) term = `-${call}`
  else {
    const coef = factorText(a)
    term = `${coef}${joinSep(coef, call)}${call}`
  }
  return `${head}${term}${constantTail(txt(spec.k, '0'))}`
}

// ----------------------------------------------------------------------------
// readLogarithmic
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

/** u = sign · ΠK / ΠP · (c·x + d): the total x-coefficient c and h = −d/c. */
function readLinear(u: ExprNode): { c: C; h: C } | null {
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
  return { c, h }
}

/**
 * The product of the constant leaves (with their powers) and the sign, as
 * text (copied from exponential.ts). One leaf with power 1 keeps its own
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

const LOG_FNS: ReadonlySet<string> = new Set(['ln', 'log', 'log2', 'log10', 'log_'])

type CallNode = Extract<ExprNode, { t: 'call' }>

const isLogCall = (n: ExprNode): n is CallNode => n.t === 'call' && LOG_FNS.has(n.fn)

/** The base of a logarithm call, with its text. */
function logCallBase(n: CallNode): C {
  switch (n.fn) {
    case 'ln': return E_C
    case 'log2': return cRat([2, 1])
    case 'log_': {
      const b = n.args[0]
      return b.t === 'const' && b.name === 'e' ? E_C : cOf(b)
    }
    default: return cRat([10, 1]) // log, log10
  }
}

const logCallArg = (n: CallNode): ExprNode => (n.fn === 'log_' ? n.args[1] : n.args[0])

function containsLog(n: ExprNode): boolean {
  switch (n.t) {
    case 'neg': return containsLog(n.a)
    case 'bin': return containsLog(n.a) || containsLog(n.b)
    case 'call': return LOG_FNS.has(n.fn) || n.args.some(containsLog)
    default: return false
  }
}

/** A base's text: "e", "10", "3", "1/2", "sqrt(2)". */
function baseText(b: C): string {
  if (b.n.t === 'const' && b.n.name === 'e') return 'e'
  return cText(b)
}

const sameValue = (u: number, w: number): boolean =>
  Math.abs(u - w) <= 1e-12 * Math.max(1, Math.abs(u), Math.abs(w))

/** Argument values u = c(x − h) the safety net samples at. */
const U_SAMPLES = [0.05, 0.3, 0.7, 1, 1.6, 2.5, 4.2, 7.9, 15]

export function readLogarithmic(src: string): LogSpec | null {
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

  // ---- the sum: constants (k) and exactly one logarithmic term ------------
  const terms: { n: ExprNode; s: 1 | -1 }[] = []
  sumTerms(body, 1, terms)
  const constants: C[] = []
  let term: { n: ExprNode; s: 1 | -1 } | null = null
  for (const t of terms) {
    if (!hasVar(t.n)) constants.push(t.s < 0 ? cNeg(cOf(t.n)) : cOf(t.n))
    else if (term) return null // ln(x) + ln(x + 1), ln(x) + x
    else term = t
  }
  if (!term) return null

  // ---- the term: constant factors and one logarithm of the variable ------
  let sign = term.s as number
  const consts: { c: C; p: number }[] = []
  const constLogs: { call: CallNode; p: number }[] = []
  const leaves: { call: CallNode; p: number }[] = []
  // A constant that holds a logarithm is split into its factors, so a
  // change-of-base denominator (ln(3), 2ln(3), 1/ln(3)) can be found.
  const splitConst = (n: ExprNode, p: 1 | -1): void => {
    if (n.t === 'neg' && containsLog(n.a)) { sign = -sign; splitConst(n.a, p); return }
    if (n.t === 'bin' && n.op === '*' && containsLog(n)) { splitConst(n.a, p); splitConst(n.b, p); return }
    if (n.t === 'bin' && n.op === '/' && containsLog(n)) { splitConst(n.a, p); splitConst(n.b, -p as 1 | -1); return }
    if (isLogCall(n)) { constLogs.push({ call: n, p }); return }
    consts.push({ c: cOf(n), p })
  }
  const flatten = (n: ExprNode, p: 1 | -1): boolean => {
    if (!hasVar(n)) {
      if (containsLog(n)) splitConst(n, p)
      else consts.push({ c: cOf(n), p })
      return true
    }
    if (n.t === 'neg') { sign = -sign; return flatten(n.a, p) }
    if (n.t === 'bin' && n.op === '*') return flatten(n.a, p) && flatten(n.b, p)
    if (n.t === 'bin' && n.op === '/') return flatten(n.a, p) && flatten(n.b, -p as 1 | -1)
    if (isLogCall(n)) {
      leaves.push({ call: n, p })
      return true
    }
    return false // x·ln(x), ln(x)^2, sqrt(ln(x)), …
  }
  if (!flatten(term.n, 1)) return null
  if (leaves.length !== 1 || leaves[0].p !== 1) return null // ln(x)ln(x), 1/ln(x)
  const leaf = leaves[0].call

  // ---- the base, and change of base --------------------------------------
  let base = logCallBase(leaf)
  const denominator = constLogs.findIndex(
    (l) => l.p === -1 && sameValue(logCallBase(l.call).v, base.v),
  )
  if (denominator >= 0) {
    base = cOf(logCallArg(constLogs[denominator].call))
    if (base.n.t === 'const' && base.n.name === 'e') base = E_C
    constLogs.splice(denominator, 1)
  }
  for (const l of constLogs) consts.push({ c: cOf(l.call), p: l.p })
  if (!(base.v > 0) || !Number.isFinite(base.v) || sameValue(base.v, 1)) return null

  // ---- the argument ------------------------------------------------------
  const lin = readLinear(logCallArg(leaf))
  if (!lin) return null // log(x^2), ln(abs(x)), ln(1/x)

  // ---- assemble ------------------------------------------------------------
  const a = coefficientText(sign, consts)
  if (a === null || a === '0') return null
  const spec: LogSpec = {
    a,
    b: baseText(base),
    c: cText(lin.c),
    h: lin.h.v === 0 ? '0' : cText(lin.h),
    k: constants.length === 0 ? '0' : cText(cSum(constants)),
  }
  if (name) spec.name = name

  // ---- safety net: the reading must BE the typed function ----------------
  const c = lin.c.v
  const h = lin.h.v
  for (const u of U_SAMPLES) {
    const x = h + u / c
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

const pointText = (p: { x: number; y: number }): string => `(${fmt4(p.x)}, ${fmt4(p.y)})`

const SUBSCRIPT: Record<string, string> = {
  0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉',
}

/** "log₂ x = ln x / ln 2", "log_(1/2) x = ln x / ln(1/2)". */
function changeOfBaseSentence(b: string): string | null {
  if (b === 'e') return null
  if (isExactly(b, 10)) return 'log x = ln x / ln 10'
  if (/^\d+$/.test(b)) {
    const sub = [...b].map((d) => SUBSCRIPT[d]).join('')
    return `log${sub} x = ln x / ln ${b}`
  }
  const bare = PLAIN_NUMBER.test(b)
  return `log_${bare ? b : `(${b})`} x = ln x / ln${bare ? ` ${b}` : `(${b})`}`
}

// ----------------------------------------------------------------------------
// logFeatures
// ----------------------------------------------------------------------------

export function logFeatures(spec: LogSpec): LogFeatures {
  const { a, b, c, h, k } = valuesOf(spec)
  const hf = fmt4(h)
  const y0 = specAt(spec, 0)
  const yIntercept = Number.isFinite(y0) ? y0 : null
  const right = c > 0
  const domain = Number.isFinite(c) && c !== 0 ? `x ${right ? '>' : '<'} ${hf}` : 'no real numbers'
  const anchor = { x: h + 1 / c, y: k }
  const basePoint = { x: h + b / c, y: k + a }

  if (![a, b, c, h, k].every(Number.isFinite) || a === 0 || c === 0) {
    // degenerate: a constant (a = 0), or not a logarithm at all
    const constant = a === 0 && Number.isFinite(k)
    return {
      asymptote: h,
      domain,
      range: constant ? `y = ${fmt4(k)}` : 'all real numbers',
      xIntercept: null,
      yIntercept,
      anchor,
      basePoint,
      increasing: false,
      concaveUp: false,
      endBehaviour: constant ? `constant: y = ${fmt4(k)}` : '',
      sentences: [],
    }
  }

  const lnb = Math.log(b)
  // f' = a / ((x − h)·ln b), and x − h has the sign of c on the domain
  const increasing = a * c * lnb > 0
  // f'' = −a / ((x − h)²·ln b)
  const concaveUp = a * lnb < 0
  // the x-intercept: c(x − h) = b^(−k/a)
  const xi = h + Math.pow(b, -k / a) / c
  const xIntercept = Number.isFinite(xi) ? xi : null

  // near the asymptote log_b(u) → −∞ (b > 1) or +∞ (b < 1); far away the opposite
  const nearSign = -Math.sign(a) * Math.sign(lnb)
  const inf = (s: number) => (s > 0 ? '∞' : `${MINUS}∞`)
  const endBehaviour =
    `as x → ${hf}${right ? '⁺' : '⁻'}, y → ${inf(nearSign)}; ` +
    `as x → ${right ? '∞' : `${MINUS}∞`}, y → ${inf(-nearSign)}`

  const sentences = [
    `vertical asymptote x = ${hf}`,
    `domain ${domain}`,
    `passes through ${pointText(anchor)} and ${pointText(basePoint)}`,
  ]
  if (xIntercept !== null) sentences.push(`x-intercept (${fmt4(xIntercept)}, 0)`)
  sentences.push(`${increasing ? 'increasing' : 'decreasing'}, concave ${concaveUp ? 'up' : 'down'}`)
  const cob = changeOfBaseSentence(normBase(spec.b))
  if (cob) sentences.push(cob)

  return {
    asymptote: h,
    domain,
    range: 'all real numbers',
    xIntercept,
    yIntercept,
    anchor,
    basePoint,
    increasing,
    concaveUp,
    endBehaviour,
    sentences,
  }
}

// ----------------------------------------------------------------------------
// logFromTwoPoints
// ----------------------------------------------------------------------------

/**
 * y = a·log_b(c(x − h)) + k through two points, the asymptote x = h and the
 * base given; c is 1 when both points are right of x = h and −1 when both are
 * left of it (the reflected log). a = (y2 − y1)/(L2 − L1), k = y1 − a·L1 with
 * L = log_b(c(x − h)); each written as a small fraction when it is one, else
 * with 12 significant digits. null when the points share an x, a point is ON
 * the asymptote, they are on opposite sides of it, or the base is not a base.
 */
export function logFromTwoPoints(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  h = 0,
  b = 'e',
): LogSpec | null {
  const { x: x1, y: y1 } = p1
  const { x: x2, y: y2 } = p2
  if (![x1, y1, x2, y2, h].every(Number.isFinite)) return null
  if (x1 === x2) return null
  const bv = baseValue(b)
  if (!Number.isFinite(bv)) return null
  const d1 = x1 - h
  const d2 = x2 - h
  if (d1 === 0 || d2 === 0 || Math.sign(d1) !== Math.sign(d2)) return null
  const c = d1 > 0 ? 1 : -1
  const L1 = Math.log(c * d1) / Math.log(bv)
  const L2 = Math.log(c * d2) / Math.log(bv)
  if (!Number.isFinite(L1) || !Number.isFinite(L2) || L1 === L2) return null
  const a = (y2 - y1) / (L2 - L1)
  const k = y1 - a * L1
  if (!Number.isFinite(a) || !Number.isFinite(k)) return null
  return { a: computedText(a), b: normBase(b), c: String(c), h: dec12(h), k: computedText(k) }
}

// ----------------------------------------------------------------------------
// Inverses
// ----------------------------------------------------------------------------

/** s/t as text: exact when both are rational (a decimal if either was typed
 *  as one), `1/P` → P's reciprocal kept as text, symbolic otherwise. */
function quotientText(s: string, t: string): string {
  const sr = exactOf(s)
  const tr = exactOf(t)
  if (sr && tr) {
    const q = rDiv(sr, tr)
    if (q) return s.includes('.') || t.includes('.') ? ratDecText(q) : ratText(q)
  }
  const sn = nodeOf(s)
  const tn = nodeOf(t)
  if (!sn || !tn) return dec12(valueOf(s) / valueOf(t))
  // 1/(1/P) is P
  if (sr && sr[0] === 1 && sr[1] === 1) {
    let m = tn
    let neg = false
    if (m.t === 'neg') { neg = true; m = m.a }
    if (m.t === 'bin' && m.op === '/') {
      const one = ratOf(m.a)
      if (one && one[0] === 1 && one[1] === 1) {
        const p = cOf(m.b)
        return cText(neg ? cNeg(p) : p)
      }
    }
  }
  return cText(cDiv(cOf(sn), cOf(tn)))
}

/**
 * y = a·b^((x − h)/p) + k  ⇄  y = p·log_b((x − k)/a) + h.
 * For base e (y = a·e^(r(x − h)/p) + k) the log's a is p/r and the base is e.
 * The name is not carried: the inverse is a different function.
 */
export function logAsInverse(exp: ExpSpec): LogSpec {
  const A = txt(exp.a, '1')
  const P = txt(exp.p, '1')
  const natural = txt(exp.b, '') === 'e'
  return {
    a: natural ? quotientText(P, txt(exp.rate, '1')) : P,
    b: natural ? 'e' : txt(exp.b, 'e'),
    c: quotientText('1', A),
    h: txt(exp.k, '0'),
    k: txt(exp.h, '0'),
  }
}

/**
 * y = a·log_b(c(x − h)) + k  ⇄  y = (1/c)·b^((x − k)/a) + h.
 * Base e becomes e^(r(x − k)) with the continuous rate r = 1/a (p = 1).
 */
export function expAsInverse(log: LogSpec): ExpSpec {
  const a = txt(log.a, '1')
  const b = normBase(log.b)
  const out: ExpSpec = {
    a: quotientText('1', txt(log.c, '1')),
    b,
    p: '1',
    h: txt(log.k, '0'),
    k: txt(log.h, '0'),
  }
  if (b === 'e') {
    // a decimal rate when it terminates (1/2 → 0.5), as readExponential writes it
    const r = exactOf(a)
    const inv = r && rDiv([1, 1], r)
    out.rate = inv ? ratDecText(inv) : quotientText('1', a)
  } else {
    out.p = a
  }
  return out
}

// ----------------------------------------------------------------------------
// rebase
// ----------------------------------------------------------------------------

/**
 * The same function in another base: a' = a·ln(b')/ln(b), everything else
 * unchanged. Exact when ln(b')/ln(b) is a small fraction, else a 12-digit
 * decimal (see the notes at the top for why not "1/ln(2)"). `base` may be
 * the base ("e", "10", "2", "1/2") or a function name ("ln", "log", "log2",
 * "log_3"). An invalid base, or a spec whose base or a is not a number,
 * returns the spec unchanged.
 */
export function rebase(spec: LogSpec, base: string): LogSpec {
  const target = normBase(base)
  const bNew = baseValue(target)
  const bOld = baseValue(spec.b)
  const aText = txt(spec.a, '1')
  const aVal = valueOf(aText)
  if (!Number.isFinite(bNew) || !Number.isFinite(bOld) || !Number.isFinite(aVal)) return spec
  if (sameValue(bNew, bOld)) return { ...spec, b: target }
  const ratio = Math.log(bNew) / Math.log(bOld)
  const exact = snapRat(ratio, 12, 1e-12)
  let a: string
  if (exact) {
    const an = nodeOf(aText)
    const prod = an ? cMul(cRat(exact), cOf(an)) : null
    if (prod && prod.r) a = aText.includes('.') ? ratDecText(prod.r) : ratText(prod.r)
    else if (an) {
      // symbolic a: one fraction in front of the symbolic part, sqrt(3)/2
      a = coefficientText(1, [{ c: cRat(exact), p: 1 }, { c: cOf(an), p: 1 }]) ?? dec12(aVal * rVal(exact))
    } else a = dec12(aVal * rVal(exact))
  } else {
    a = dec12(aVal * ratio)
  }
  return { ...spec, a, b: target }
}

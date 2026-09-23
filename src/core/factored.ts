// ============================================================================
// Functions built from their roots (src/core/factored.ts)
//
// A teacher sets a polynomial by its zeros and their multiplicities, and a
// rational function by the zeros of its numerator and its denominator:
//
//     y = 2(x + 1)²(x − 3)                    roots −1 (×2), 3 (×1), a = 2
//     y = (x − 1)(x + 2)² / ((x − 3)(x + 1))   num 1, −2 (×2); den 3, −1
//
// Everything visible is still a TYPED EXPRESSION: a factored spec is turned
// into source text and goes through the ordinary parser, so analysis, holes,
// vertical/horizontal/slant asymptotes, exact forms, intersections, end caps
// and figure styles all apply unchanged. This module is the two-way bridge
// between that text and a list of factors a card can edit.
//
//   export function factoredSource(spec): string
//       spec → "y = 2(x + 1)^2(x - 3)", canonical, parseable by
//       parseExpression. Roots keep the text the teacher gave them, so
//       sqrt(2) stays sqrt(2) and 1/2 stays 1/2 in the equation.
//   export function readFactored(src): FactoredSpec | null
//       the inverse, for ANY typed explicit expression that is a product of
//       a constant and powers of linear factors (x − r), (x + r), (ax − b),
//       bare x, and irreducible quadratics, over another such product —
//       so a curve typed by hand as y = (x-1)^2(x+3) gets the root editor
//       too. null for anything else (sums of products, x^2 − 1 unfactored).
//   export function rootsOf(spec): FactoredRoot[]
//       the numeric value, side and multiplicity of every real root, with
//       what the graph does there: 'crosses' (odd multiplicity), 'touches'
//       (even), 'flattens' (odd ≥ 3, crosses with an inflection); for the
//       denominator 'asymptote-odd' (sign changes across) / 'asymptote-even'
//       (same sign both sides); a root shared by numerator and denominator
//       cancels down to min(m, n) and is 'hole' when the numerator's
//       multiplicity is ≥ the denominator's, else still an asymptote of the
//       leftover multiplicity.
//   export function leadingThrough(spec, point): number | null
//       the leading coefficient a that makes the curve pass through `point`
//       (null when the point is a root, a pole, or the product is 0 there).
//   export function endBehaviour(spec): string
//       one teacher sentence: "degree 3, leading coefficient positive: falls
//       to the left, rises to the right", "degrees 2/2: horizontal asymptote
//       y = 2", "degrees 3/2: slant asymptote", "degrees 4/1: no horizontal
//       or slant asymptote; behaves like 2x^3 at the ends" (true minus signs).
// ============================================================================

import { evalAst, parseAst, type ExprNode } from './parse'

/** One factor of the numerator or the denominator. */
export interface Factor {
  /**
   * A real root, as the teacher wrote it: "3", "-1", "1/2", "sqrt(2)",
   * "-2pi". Evaluated with the app's numeric expression parser.
   */
  root?: string
  /**
   * Instead of a real root, a complex-conjugate pair p ± qi, written as the
   * irreducible quadratic (x² − 2px + p² + q²). Both as strings, as above.
   */
  complex?: { re: string; im: string }
  /** Multiplicity, a whole number ≥ 1. */
  mult: number
}

export interface FactoredSpec {
  /** The function's name when typed as f(x) = …; absent for y = … */
  name?: string
  /** Leading coefficient, as written ("2", "-1/2", "sqrt(3)"). */
  a: string
  num: Factor[]
  /** Empty for a polynomial. */
  den: Factor[]
}

export type RootBehaviour =
  | 'crosses'
  | 'touches'
  | 'flattens'
  | 'asymptote-odd'
  | 'asymptote-even'
  | 'hole'

export interface FactoredRoot {
  x: number
  /** Which list it came from; a cancelled root reports 'both'. */
  side: 'num' | 'den' | 'both'
  /** The multiplicity that decides the behaviour (after cancelling). */
  mult: number
  behaviour: RootBehaviour
  /** Index into spec.num / spec.den (the numerator's for 'both'). */
  index: number
}

// ============================================================================
// Implementation
//
// Canonical source (factoredSource):
//   head      `y = ` or `name(x) = `
//   a         omitted for 1, `-` for −1; written bare when it is a plain
//             number, a simple fraction n/d, a constant (pi, e), one function
//             call (sqrt(3)) or a number times one of those (2pi, 2sqrt(3)),
//             each with an optional leading minus; otherwise parenthesised,
//             e.g. (sqrt(3)/2)(x - 1).
//   factors   bare `x` for the root 0 FIRST (textbook y = x(x + 1)(x − 2)),
//             then the other real roots in increasing order, complex pairs
//             last (by real part, then imaginary part). Root text as given:
//             (x - r); (x + s) when r is "-s" with s a single term;
//             (x - (1-sqrt(2))) when r is a sum. Multiplicity m > 1 → ^m.
//             Equal roots on one side are merged (x·x would lex as `xx`).
//   complex   p ± qi → (x^2 - 2px + (p² + q²)) with the coefficients
//             simplified: exact fractions when p and q are rational, else
//             12-significant-digit decimals; a fractional x-coefficient is
//             written 3x/2.
//   rational  num/(den): the denominator is parenthesised when it has more
//             than one factor or a power; an empty numerator is `a/(…)`.
// ============================================================================

// ----------------------------------------------------------------------------
// Exact rationals (small; anything past 1e12 falls back to floating point)
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
  return [n / g + 0, d / g] // + 0 turns −0 into 0
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

/** Nearest simple fraction (denominator ≤ 1000) when `v` IS one, else null. */
function snapRat(v: number): Rat | null {
  if (!Number.isFinite(v)) return null
  for (let d = 1; d <= 1000; d++) {
    const n = Math.round(v * d)
    if (Math.abs(n / d - v) <= 1e-12 * Math.max(1, Math.abs(v))) return rat(n, d)
  }
  return null
}

/** 12 significant digits, no trailing zeros. */
const dec12 = (v: number): string => String(Number(v.toPrecision(12)))

/** A floating value as text: an exact fraction when it is one, else 12 digits. */
const numText = (v: number): string => {
  const r = snapRat(v)
  return r ? ratText(r) : dec12(v)
}

// ----------------------------------------------------------------------------
// AST helpers
// ----------------------------------------------------------------------------

const numNode = (k: number): ExprNode => ({ t: 'num', v: k, raw: String(k) })

function ratNode(r: Rat): ExprNode {
  const mag: ExprNode =
    r[1] === 1
      ? numNode(Math.abs(r[0]))
      : { t: 'bin', op: '/', a: numNode(Math.abs(r[0])), b: numNode(r[1]) }
  return r[0] < 0 ? { t: 'neg', a: mag } : mag
}

function hasX(n: ExprNode): boolean {
  switch (n.t) {
    case 'var': return true // any variable: x, or a y/t/r/θ that disqualifies
    case 'param': return true // a free constant is not a number either
    case 'neg': return hasX(n.a)
    case 'bin': return hasX(n.a) || hasX(n.b)
    case 'call': return n.args.some(hasX)
    default: return false
  }
}

/** Uses only the variable x (no params, no y/t/r/θ). */
function onlyX(n: ExprNode): boolean {
  switch (n.t) {
    case 'var': return n.name === 'x'
    case 'param': return false
    case 'neg': return onlyX(n.a)
    case 'bin': return onlyX(n.a) && onlyX(n.b)
    case 'call': return n.args.every(onlyX)
    default: return true
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
          // a leading minus binds tighter than × anyway: -2pi = (-2)pi
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
  if (/[0-9]$/.test(l) && /^e/.test(r)) return '*' // 2e would be read as 2e…
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

/** −c, keeping the text: −(0.25) prints -0.25, −(−sqrt(2)) prints sqrt(2). */
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
// Evaluating root strings and the spec itself
// ----------------------------------------------------------------------------

const valueCache = new Map<string, number>()

/** Numeric value of a constant string ("sqrt(2)", "-1/2", "2pi"); NaN if not. */
function valueOf(s: string): number {
  const key = s.trim()
  const hit = valueCache.get(key)
  if (hit !== undefined) return hit
  let v = NaN
  const ast = parseAst(key)
  if (ast.ok && ast.rhs === null && !hasX(ast.lhs)) v = evalAst(ast.lhs, NaN)
  if (!Number.isFinite(v)) v = NaN
  if (valueCache.size > 500) valueCache.clear()
  valueCache.set(key, v)
  return v
}

function exactOf(s: string): Rat | null {
  const ast = parseAst(s.trim())
  return ast.ok && ast.rhs === null ? ratOf(ast.lhs) : null
}

const isComplex = (f: Factor): boolean => !!f.complex

/** Value of one factor (without its multiplicity) at x. */
function factorAt(f: Factor, x: number): number {
  if (f.complex) {
    const p = valueOf(f.complex.re)
    const q = valueOf(f.complex.im)
    return (x - p) * (x - p) + q * q
  }
  return x - valueOf(f.root ?? '')
}

function productAt(fs: Factor[], x: number): number {
  let p = 1
  for (const f of fs) p *= Math.pow(factorAt(f, x), f.mult)
  return p
}

/** The spec's function with a = 1: Πnum / Πden. */
function shapeAt(spec: FactoredSpec, x: number): number {
  return productAt(spec.num, x) / productAt(spec.den, x)
}

// ----------------------------------------------------------------------------
// factoredSource
// ----------------------------------------------------------------------------

/** a written bare in front of the factors? (see the rules at the top) */
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

/** Root text inside (x ∓ …). */
function linearFactor(root: string): string {
  const r = root.trim().replace(/^\+/, '')
  const exact = exactOf(r)
  if (exact && exact[0] === 0) return 'x'
  // "-s" with s a single term (1/2, 2pi, sqrt(2)) → (x + s)
  if (r.startsWith('-')) {
    const s = r.slice(1).trim()
    const rest = parseAst(s)
    if (rest.ok && rest.rhs === null && prec(rest.lhs) >= 2) return `(x + ${s})`
  }
  const ast = parseAst(r)
  if (ast.ok && ast.rhs === null && prec(ast.lhs) < 2) return `(x - (${r}))`
  return `(x - ${r})`
}

function complexFactor(re: string, im: string): string {
  const pr = exactOf(re)
  const qr = exactOf(im)
  let b: Rat | null = null
  let c: Rat | null = null
  if (pr && qr) {
    b = rMul([-2, 1], pr)
    const p2 = rMul(pr, pr)
    const q2 = rMul(qr, qr)
    c = p2 && q2 && rAdd(p2, q2)
  }
  const p = valueOf(re)
  const q = valueOf(im)
  b ??= snapRat(-2 * p)
  c ??= snapRat(p * p + q * q)
  const bv = b ? rVal(b) : -2 * p
  let out = 'x^2'
  if (bv !== 0) {
    const sign = bv < 0 ? ' - ' : ' + '
    let mag: string
    if (b) {
      const [n, d] = [Math.abs(b[0]), b[1]]
      mag = `${n === 1 ? '' : n}x${d === 1 ? '' : `/${d}`}`
    } else {
      mag = `${dec12(Math.abs(bv))}x`
    }
    out += sign + mag
  }
  const cv = c ? rVal(c) : p * p + q * q
  if (cv !== 0) {
    const mag = c ? ratText([Math.abs(c[0]), c[1]]) : dec12(Math.abs(cv))
    out += (cv < 0 ? ' - ' : ' + ') + mag
  }
  return `(${out})`
}

/** Equal roots on one side merged; real roots sorted; complex last. */
function canonical(fs: Factor[]): Factor[] {
  const out: Factor[] = []
  const same = (u: number, v: number) => Math.abs(u - v) <= 1e-12 * Math.max(1, Math.abs(u))
  for (const f of fs) {
    const mult = Math.max(1, Math.round(f.mult))
    const hit = out.find((g) => {
      if (!!g.complex !== !!f.complex) return false
      if (f.complex && g.complex) {
        return (
          same(valueOf(f.complex.re), valueOf(g.complex.re)) &&
          same(Math.abs(valueOf(f.complex.im)), Math.abs(valueOf(g.complex.im)))
        )
      }
      const u = valueOf(f.root ?? '')
      const v = valueOf(g.root ?? '')
      return Number.isNaN(u) ? (f.root ?? '').trim() === (g.root ?? '').trim() : same(u, v)
    })
    if (hit) hit.mult += mult
    else out.push({ ...f, mult })
  }
  const key = (f: Factor): [number, number, number] => {
    if (f.complex) return [2, valueOf(f.complex.re), Math.abs(valueOf(f.complex.im))]
    const v = valueOf(f.root ?? '')
    if (v === 0) return [0, 0, 0] // bare x leads: y = x(x + 1)(x − 2)
    return [1, Number.isNaN(v) ? Infinity : v, 0]
  }
  return out
    .map((f, i) => ({ f, k: key(f), i }))
    .sort((p, q) => p.k[0] - q.k[0] || p.k[1] - q.k[1] || p.k[2] - q.k[2] || p.i - q.i)
    .map((e) => e.f)
}

function factorsText(fs: Factor[]): { text: string; count: number; powered: boolean } {
  const list = canonical(fs)
  let text = ''
  for (const f of list) {
    const base = f.complex ? complexFactor(f.complex.re, f.complex.im) : linearFactor(f.root ?? '')
    const piece = f.mult > 1 ? `${base}^${f.mult}` : base
    text += text && /[A-Za-z0-9]$/.test(text) && /^[A-Za-z]/.test(piece) ? `*${piece}` : piece
  }
  return { text, count: list.length, powered: list.some((f) => f.mult > 1) }
}

export function factoredSource(spec: FactoredSpec): string {
  const head = spec.name ? `${spec.name}(x) = ` : 'y = '
  const a = (spec.a ?? '').trim() || '1'
  const exactA = exactOf(a)
  const num = factorsText(spec.num)
  const den = factorsText(spec.den)

  let top: string
  if (!num.text) {
    top = bareCoefficient(a) || !den.text ? a : `(${a})`
  } else if (exactA && exactA[0] === 1 && exactA[1] === 1) {
    top = num.text
  } else if (exactA && exactA[0] === -1 && exactA[1] === 1) {
    top = `-${num.text}`
  } else {
    const coef = bareCoefficient(a) ? a : `(${a})`
    top = `${coef}${joinSep(coef, num.text)}${num.text}`
  }
  if (!den.text) return head + top
  const bottom = den.count > 1 || den.powered ? `(${den.text})` : den.text
  return `${head}${top}/${bottom}`
}

// ----------------------------------------------------------------------------
// readFactored
// ----------------------------------------------------------------------------

/** Polynomial in x with numeric (and, where possible, exact) coefficients. */
type Poly = C[]

const MAX_DEG = 8

function pAdd(p: Poly, q: Poly): Poly {
  const out: Poly = []
  for (let i = 0; i < Math.max(p.length, q.length); i++) {
    out.push(cSum([p[i] ?? cRat([0, 1]), q[i] ?? cRat([0, 1])]))
  }
  return out
}

function cMulNum(a: C, b: C): C {
  if (a.r && b.r) {
    const m = rMul(a.r, b.r)
    if (m) return cRat(m)
  }
  return { v: a.v * b.v, r: null, n: numNode(Number(dec12(a.v * b.v))) }
}

function pMul(p: Poly, q: Poly): Poly | null {
  if (p.length + q.length - 2 > MAX_DEG) return null
  const out: Poly = Array.from({ length: p.length + q.length - 1 }, () => cRat([0, 1]))
  for (let i = 0; i < p.length; i++) {
    for (let j = 0; j < q.length; j++) out[i + j] = cSum([out[i + j], cMulNum(p[i], q[j])])
  }
  return out
}

function polyOf(n: ExprNode): Poly | null {
  if (!hasX(n)) return [cOf(n)]
  switch (n.t) {
    case 'var': return n.name === 'x' ? [cRat([0, 1]), ONE] : null
    case 'neg': {
      const a = polyOf(n.a)
      return a && a.map((c) => (c.r ? cRat(rNeg(c.r)) : { v: -c.v, r: null, n: numNode(Number(dec12(-c.v))) }))
    }
    case 'bin': {
      if (n.op === '^') {
        const e = ratOf(n.b)
        if (!e || e[1] !== 1 || e[0] < 0 || e[0] > MAX_DEG) return null
        const base = polyOf(n.a)
        let out: Poly | null = [ONE]
        for (let i = 0; i < e[0] && out && base; i++) out = pMul(out, base)
        return base && out
      }
      const a = polyOf(n.a)
      if (!a) return null
      if (n.op === '/') {
        if (hasX(n.b)) return null
        const d = cOf(n.b)
        if (d.v === 0) return null
        return a.map((c) => (c.r && d.r ? cDiv(c, d) : { v: c.v / d.v, r: null, n: numNode(Number(dec12(c.v / d.v))) }))
      }
      const b = polyOf(n.b)
      if (!b) return null
      if (n.op === '+') return pAdd(a, b)
      if (n.op === '-') return pAdd(a, b.map((c) => (c.r ? cRat(rNeg(c.r)) : { ...c, v: -c.v })))
      return pMul(a, b)
    }
    default:
      return null
  }
}

function degree(p: Poly): number {
  let d = p.length - 1
  while (d >= 0 && p[d].v === 0) d--
  return d
}

/** Coefficient of x in a single x-term (2x, x/3, -x, sqrt(2)x); null otherwise. */
function xCoef(n: ExprNode): C | null {
  if (n.t === 'var') return n.name === 'x' ? ONE : null
  if (n.t === 'neg') {
    const k = xCoef(n.a)
    return k && cNeg(k)
  }
  if (n.t === 'bin' && n.op === '*') {
    if (hasX(n.a) && !hasX(n.b)) {
      const k = xCoef(n.a)
      return k && cMulSym(k, cOf(n.b))
    }
    if (hasX(n.b) && !hasX(n.a)) {
      const k = xCoef(n.b)
      return k && cMulSym(cOf(n.a), k)
    }
  }
  if (n.t === 'bin' && n.op === '/' && hasX(n.a) && !hasX(n.b)) {
    const k = xCoef(n.a)
    return k && cDiv(k, cOf(n.b))
  }
  return null
}

function cMulSym(a: C, b: C): C {
  if (a.r && b.r) {
    const m = rMul(a.r, b.r)
    if (m) return cRat(m)
  }
  if (isRat(a, 1)) return b
  if (isRat(b, 1)) return a
  if (isRat(a, -1)) return cNeg(b)
  if (isRat(b, -1)) return cNeg(a)
  return { v: a.v * b.v, r: null, n: { t: 'bin', op: '*', a: a.n, b: b.n } }
}

/** Split a linear sum into its x-terms and its constant terms (text kept). */
function linearTerms(n: ExprNode, sign: 1 | -1, ks: C[], cs: C[]): boolean {
  if (!hasX(n)) {
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

/** √(n/d) as text when exact-ish: "3", "sqrt(2)", "3sqrt(2)/2"; else null. */
function sqrtText(r: Rat, over: number): string | null {
  // √(n/d) / over = √(n·d) / (d·over)
  const nd = r[0] * r[1]
  if (nd < 0 || nd > RAT_LIMIT) return null
  let outside = 1
  let inside = nd
  for (let f = 2; f * f <= inside; f++) {
    while (inside % (f * f) === 0) { inside /= f * f; outside *= f }
  }
  const k = rat(outside, r[1] * over)
  if (!k) return null
  if (inside === 1) return ratText(k)
  const lead = k[0] === 1 ? '' : String(k[0])
  return `${lead}sqrt(${inside})${k[1] === 1 ? '' : `/${k[1]}`}`
}

interface ReadFactor { factor: Factor; value: number; side: 'num' | 'den' }

/** A quadratic leaf, made monic (the leading coefficient goes to `a`). */
function readQuadratic(p: Poly, mult: number, side: 'num' | 'den', out: ReadFactor[]): C | null {
  const [c0, c1, c2] = p
  const exact = c0.r && c1.r && c2.r
  const B = exact ? rDiv(c1.r!, c2.r!) : null
  const Cc = exact ? rDiv(c0.r!, c2.r!) : null
  const b = B ? rVal(B) : c1.v / c2.v
  const c = Cc ? rVal(Cc) : c0.v / c2.v
  // exact discriminant of the monic x² + bx + c: b² − 4c
  const disc = B && Cc ? rAdd(rMul(B, B)!, rMul([-4, 1], Cc)!) : null
  const dv = disc ? rVal(disc) : b * b - 4 * c
  const reR = B ? rDiv(rNeg(B), [2, 1]) : null
  const reText = reR ? ratText(reR) : numText(-b / 2)
  const re = reR ? rVal(reR) : -b / 2
  if (dv < 0 && (disc || dv < -1e-12 * Math.max(1, b * b, Math.abs(c)))) {
    const im = Math.sqrt(-dv) / 2
    const imText = (disc && sqrtText(rNeg(disc), 2)) ?? numText(im)
    out.push({ factor: { complex: { re: reText, im: imText }, mult }, value: re, side })
    return c2
  }
  const half = Math.sqrt(Math.max(0, dv)) / 2
  const halfText = disc && reR ? sqrtText(disc, 2) : null
  if (half === 0 || halfText === '0') {
    out.push({ factor: { root: reText, mult: 2 * mult }, value: re, side })
    return c2
  }
  for (const s of [-1, 1] as const) {
    const value = re + s * half
    let text: string
    if (reR && halfText && !halfText.includes('sqrt')) {
      // a perfect square: two rational roots
      const h = exactOf(halfText)!
      text = ratText(rAdd(reR, s < 0 ? rNeg(h) : h)!)
    } else if (reR && halfText) {
      // p ± t with t irrational: "sqrt(2)", "-sqrt(2)", "1+sqrt(2)"
      const sgn = s < 0 ? '-' : reR[0] === 0 ? '' : '+'
      text = `${reR[0] === 0 ? '' : ratText(reR)}${sgn}${halfText}`
    } else {
      text = numText(value)
    }
    out.push({ factor: { root: text, mult }, value, side })
  }
  return c2
}

/** The part of the source after the one top-level '=' (the whole thing if none). */
function bodyText(src: string): string {
  const at = src.indexOf('=')
  return at < 0 ? src : src.slice(at + 1)
}

/** The whole text wrapped in one pair of parentheses? */
function wrapped(text: string): boolean {
  const t = text.trim()
  if (!t.startsWith('(') || !t.endsWith(')')) return false
  let depth = 0
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '(') depth++
    else if (t[i] === ')') {
      depth--
      if (depth === 0 && i < t.length - 1) return false
    }
  }
  return true
}

export function readFactored(src: string): FactoredSpec | null {
  if (!src || src.includes('{') || /\b(for|if|where|when)\b/.test(src)) return null
  const ast = parseAst(src)
  if (!ast.ok) return null

  // ---- head: y = …, f(x) = …, or a bare expression -----------------------
  let name: string | undefined
  let body: ExprNode
  if (ast.rhs === null) body = ast.lhs
  else if (ast.lhs.t === 'var' && ast.lhs.name === 'y') body = ast.rhs
  else if (
    ast.lhs.t === 'bin' && ast.lhs.op === '*' &&
    ast.lhs.a.t === 'param' && ast.lhs.b.t === 'var' && ast.lhs.b.name === 'x'
  ) {
    name = ast.lhs.a.name
    body = ast.rhs
  } else return null
  if (!onlyX(body)) return null

  // a sum at the top level is an expanded form (x^2 - 1), not a product —
  // unless it is one parenthesised factor, y = (x^2 - 2)
  // (or minus one: y = -(x^2 + 1))
  const top = body.t === 'neg' ? body.a : body
  const topText = bodyText(src).trim().replace(body.t === 'neg' ? /^[-−]/ : /^$/, '')
  if (top.t === 'bin' && (top.op === '+' || top.op === '-') && !wrapped(topText)) {
    return null
  }

  // ---- flatten into constant and x-bearing leaves with integer powers ----
  let sign = 1
  const consts: { c: C; p: number }[] = []
  const leaves: { n: ExprNode; p: number }[] = []
  const flatten = (n: ExprNode, p: number): boolean => {
    if (!hasX(n)) {
      consts.push({ c: cOf(n), p })
      return true
    }
    if (n.t === 'neg') {
      if (Math.abs(p) % 2 === 1) sign = -sign
      return flatten(n.a, p)
    }
    if (n.t === 'bin' && n.op === '*') return flatten(n.a, p) && flatten(n.b, p)
    if (n.t === 'bin' && n.op === '/') return flatten(n.a, p) && flatten(n.b, -p)
    if (n.t === 'bin' && n.op === '^') {
      if (hasX(n.b)) return false
      const e = ratOf(n.b)
      if (!e || e[1] !== 1 || e[0] < 1 || e[0] > 64) return false
      return flatten(n.a, p * e[0])
    }
    leaves.push({ n, p })
    return true
  }
  if (!flatten(body, 1)) return null

  // ---- read each leaf ----------------------------------------------------
  const found: ReadFactor[] = []
  for (const { n, p } of leaves) {
    const poly = polyOf(n)
    if (!poly) return null
    const deg = degree(poly)
    const side = p > 0 ? 'num' : 'den'
    const mult = Math.abs(p)
    if (deg === 1) {
      const ks: C[] = []
      const cs: C[] = []
      if (!linearTerms(n, 1, ks, cs)) return null
      const k = cSum(ks)
      if (k.v === 0) return null
      const root = cDiv(cSum(cs.map(cNeg)), k)
      found.push({ factor: { root: cText(root), mult }, value: root.v, side })
      consts.push({ c: k, p })
    } else if (deg === 2) {
      const lead = readQuadratic(poly, mult, side, found)
      if (!lead) return null
      consts.push({ c: lead, p })
    } else {
      return null
    }
  }

  // ---- the leading coefficient ------------------------------------------
  const a = coefficientText(sign, consts)
  if (a === null) return null

  // ---- merge repeats, sort, split ---------------------------------------
  const spec: FactoredSpec = { a, num: [], den: [] }
  if (name) spec.name = name
  for (const side of ['num', 'den'] as const) {
    const mine = found.filter((f) => f.side === side)
    const merged: ReadFactor[] = []
    for (const f of mine) {
      const hit = merged.find((g) => sameFactor(g.factor, f.factor))
      if (hit) hit.factor.mult += f.factor.mult
      else merged.push({ ...f, factor: { ...f.factor } })
    }
    merged.sort((u, v) => {
      const cu = u.factor.complex ? 1 : 0
      const cv = v.factor.complex ? 1 : 0
      if (cu !== cv) return cu - cv
      if (u.value !== v.value) return u.value - v.value
      return valueOf(u.factor.complex?.im ?? '0') - valueOf(v.factor.complex?.im ?? '0')
    })
    spec[side] = merged.map((f) => f.factor)
  }

  // ---- safety net: the reading must BE the typed function ----------------
  const av = valueOf(a)
  for (const x of [-2.71, -1.13, -0.37, 0.29, 0.83, 1.61, 3.07]) {
    const want = evalAst(body, x)
    const got = av * shapeAt(spec, x)
    if (!Number.isFinite(want) || !Number.isFinite(got)) continue
    if (Math.abs(want - got) > 1e-7 * Math.max(1, Math.abs(want))) return null
  }
  return spec
}

function sameFactor(f: Factor, g: Factor): boolean {
  const same = (u: number, v: number) => Math.abs(u - v) <= 1e-12 * Math.max(1, Math.abs(u))
  if (f.complex && g.complex) {
    return same(valueOf(f.complex.re), valueOf(g.complex.re)) && same(valueOf(f.complex.im), valueOf(g.complex.im))
  }
  if (f.complex || g.complex) return false
  return same(valueOf(f.root!), valueOf(g.root!))
}

/**
 * The product of the constant leaves (with their powers) and the sign, as
 * text. One leaf with power 1 keeps its own text (0.5 stays 0.5); otherwise
 * exact parts combine into one fraction in front of the symbolic ones:
 * 2·sqrt(3) → "2sqrt(3)", sqrt(3)/2 → "sqrt(3)/2".
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
// rootsOf
// ----------------------------------------------------------------------------

/**
 * Cancellation (a root r with multiplicity m upstairs and n downstairs):
 *   m ≥ n  → 'hole'. The reduced function is defined at r (a zero of
 *            multiplicity m − n when m > n, a nonzero value when m = n) but
 *            the typed one is not, so the graph has an open circle there —
 *            ON the x-axis when m > n. `mult` is m − n (0 for a plain hole).
 *   m < n  → still a vertical asymptote of multiplicity n − m:
 *            'asymptote-odd' / 'asymptote-even' by its parity.
 */
export function rootsOf(spec: FactoredSpec): FactoredRoot[] {
  interface Group { x: number; m: number; n: number; iNum: number; iDen: number }
  const groups: Group[] = []
  const near = (u: number, v: number) => Math.abs(u - v) <= 1e-9 * Math.max(1, Math.abs(u))
  const add = (side: 'num' | 'den', fs: Factor[]) => {
    fs.forEach((f, i) => {
      if (isComplex(f) || f.root === undefined) return
      const x = valueOf(f.root)
      if (!Number.isFinite(x)) return
      const mult = Math.max(1, Math.round(f.mult))
      let g = groups.find((h) => near(h.x, x))
      if (!g) {
        g = { x, m: 0, n: 0, iNum: -1, iDen: -1 }
        groups.push(g)
      }
      if (side === 'num') { g.m += mult; if (g.iNum < 0) g.iNum = i }
      else { g.n += mult; if (g.iDen < 0) g.iDen = i }
    })
  }
  add('num', spec.num)
  add('den', spec.den)

  const zero = (m: number): RootBehaviour => (m % 2 === 0 ? 'touches' : m === 1 ? 'crosses' : 'flattens')
  const pole = (n: number): RootBehaviour => (n % 2 === 0 ? 'asymptote-even' : 'asymptote-odd')
  return groups
    .map((g): FactoredRoot => {
      if (g.n === 0) return { x: g.x, side: 'num', mult: g.m, behaviour: zero(g.m), index: g.iNum }
      if (g.m === 0) return { x: g.x, side: 'den', mult: g.n, behaviour: pole(g.n), index: g.iDen }
      if (g.m >= g.n) return { x: g.x, side: 'both', mult: g.m - g.n, behaviour: 'hole', index: g.iNum }
      return { x: g.x, side: 'both', mult: g.n - g.m, behaviour: pole(g.n - g.m), index: g.iNum }
    })
    .sort((p, q) => p.x - q.x)
}

// ----------------------------------------------------------------------------
// leadingThrough
// ----------------------------------------------------------------------------

export function leadingThrough(
  spec: FactoredSpec,
  point: { x: number; y: number },
): number | null {
  const { x, y } = point
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  for (const f of spec.den) {
    if (f.complex) continue
    const r = valueOf(f.root ?? '')
    if (Math.abs(x - r) <= 1e-12 * Math.max(1, Math.abs(r))) return null
  }
  const shape = shapeAt(spec, x)
  if (!Number.isFinite(shape) || shape === 0) return null
  const a = y / shape
  return Number.isFinite(a) ? a : null
}

// ----------------------------------------------------------------------------
// endBehaviour
// ----------------------------------------------------------------------------

const MINUS = '−'

/** 4 significant digits, trailing zeros dropped, true minus. */
function fmt4(v: number): string {
  const s = String(Number(v.toPrecision(4)))
  return s.replace('-', MINUS)
}

function degreeOf(fs: Factor[]): number {
  return fs.reduce((d, f) => d + (f.complex ? 2 : 1) * Math.max(1, Math.round(f.mult)), 0)
}

export function endBehaviour(spec: FactoredSpec): string {
  const a = valueOf(spec.a || '1')
  if (!Number.isFinite(a)) return ''
  const dn = degreeOf(spec.num)
  const dd = degreeOf(spec.den)
  if (a === 0) return 'the zero function: y = 0'

  if (spec.den.length === 0) {
    if (dn === 0) return `degree 0: constant, y = ${fmt4(a)}`
    const pos = a > 0
    const left = (dn % 2 === 0) === pos ? 'rises' : 'falls'
    const right = pos ? 'rises' : 'falls'
    return `degree ${dn}, leading coefficient ${pos ? 'positive' : 'negative'}: ${left} to the left, ${right} to the right`
  }

  const degs = `degrees ${dn}/${dd}: `
  if (dn < dd) return `${degs}horizontal asymptote y = 0`
  if (dn === dd) return `${degs}horizontal asymptote y = ${fmt4(a)}`
  if (dn === dd + 1) return `${degs}slant asymptote`
  const k = dn - dd
  const coef = a === 1 ? '' : a === -1 ? MINUS : fmt4(a)
  return `${degs}no horizontal or slant asymptote; behaves like ${coef}x^${k} at the ends`
}

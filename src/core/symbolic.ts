// ============================================================================
// src/core/symbolic.ts — a small symbolic differentiator over the parser's AST.
//
// Moved out of src/core/euler.ts (where it derived d²y/dx² for Euler's
// verdict) so implicit differentiation can share it. The tree, its
// simplifying constructors, the derivative rules and the printers are
// UNCHANGED; what is new is exported at the bottom of the file:
//
//   Dm(s, 'x' | 'y')     the partial derivatives ∂/∂x and ∂/∂y (the other
//                        variable held constant) beside the total d/dx of
//                        the original D(s), where y = y(x)
//
// The multivariate-polynomial normal form that implicit differentiation
// prints through lives in src/core/implicitDiff.ts.
// ============================================================================

import type { ExprNode } from './parse'

const MINUS = '−'
const withMinus = (s: string): string => (s.startsWith('-') ? MINUS + s.slice(1) : s)
export type S =
  | { t: 'n'; v: number }
  | { t: 'c'; name: string }
  | { t: 'x' }
  | { t: 'y' }
  | { t: 'yp' }
  | { t: 'p'; name: string }
  | { t: 'neg'; a: S }
  | { t: 'add' | 'sub' | 'mul' | 'pow'; a: S; b: S }
  /** `tight`: a number·letter over something, printed 2y/L rather than (2y)/L (collectYp only). */
  | { t: 'div'; a: S; b: S; tight?: true }
  | { t: 'fn'; fn: string; a: S }

const N = (v: number): S => ({ t: 'n', v })
const ZERO = N(0)
const ONE = N(1)
type Num = { t: 'n'; v: number }
function isN(s: S): s is Num
function isN(s: S, v: number): boolean
function isN(s: S, v?: number): boolean {
  return s.t === 'n' && (v === undefined || s.v === v)
}

function same(a: S, b: S): boolean {
  if (a.t !== b.t) return false
  switch (a.t) {
    case 'n':
      return a.v === (b as { v: number }).v
    case 'c':
    case 'p':
      return a.name === (b as { name: string }).name
    case 'x':
    case 'y':
    case 'yp':
      return true
    case 'neg':
      return same(a.a, (b as { a: S }).a)
    case 'fn':
      return a.fn === (b as { fn: string }).fn && same(a.a, (b as { a: S }).a)
    default: {
      const bb = b as { a: S; b: S }
      return same(a.a, bb.a) && same(a.b, bb.b)
    }
  }
}

function neg(a: S): S {
  if (isN(a)) return N(-a.v)
  if (a.t === 'neg') return a.a
  return { t: 'neg', a }
}

function add(a: S, b: S): S {
  if (isN(a, 0)) return b
  if (isN(b, 0)) return a
  if (isN(a) && isN(b)) return N(a.v + b.v)
  if (b.t === 'neg') return sub(a, b.a)
  if (isN(b) && b.v < 0) return sub(a, N(-b.v))
  if (a.t === 'neg') return sub(b, a.a)
  if (same(a, b)) return mul(N(2), a)
  return { t: 'add', a, b }
}

function sub(a: S, b: S): S {
  if (isN(b, 0)) return a
  if (isN(a, 0)) return neg(b)
  if (isN(a) && isN(b)) return N(a.v - b.v)
  if (b.t === 'neg') return add(a, b.a)
  if (same(a, b)) return ZERO
  return { t: 'sub', a, b }
}

// Products and quotients are normalised as ONE monomial: a coefficient p/q
// times factors with integer exponents, like factors merged. That is what
// turns x·(x·y) into x²y, y·y′/y into y′, and √y/(2√y) into 1/2 — the
// difference between a line a teacher can read aloud and one they cannot.

interface Mono {
  /** coefficient numerator and denominator (integers when they can be) */
  p: number
  q: number
  fs: { b: S; e: number }[]
}

function collect(s: S, sign: 1 | -1, m: Mono): void {
  switch (s.t) {
    case 'n':
      if (sign > 0) m.p *= s.v
      else m.q *= s.v
      return
    case 'neg':
      m.p = -m.p
      collect(s.a, sign, m)
      return
    case 'mul':
      collect(s.a, sign, m)
      collect(s.b, sign, m)
      return
    case 'div':
      collect(s.a, sign, m)
      collect(s.b, sign === 1 ? -1 : 1, m)
      return
    case 'pow':
      if (isN(s.b) && Number.isInteger(s.b.v) && !isN(s.a)) {
        push(m, s.a, sign * s.b.v)
        return
      }
      push(m, s, sign)
      return
    default:
      push(m, s, sign)
  }
}

function push(m: Mono, b: S, e: number): void {
  for (const f of m.fs) {
    if (same(f.b, b)) {
      f.e += e
      return
    }
  }
  m.fs.push({ b, e })
}

function gcd(a: number, b: number): number {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b > 0) [a, b] = [b, a % b]
  return a
}

/** Raw product, left to right, no normalising (the constructors call this). */
function chain(parts: S[]): S {
  let out = parts[0]
  for (let i = 1; i < parts.length; i++) out = { t: 'mul', a: out, b: parts[i] }
  return out
}

function build(m: Mono): S {
  if (m.p === 0) return ZERO
  let p = m.p
  let q = m.q
  if (q < 0) {
    p = -p
    q = -q
  }
  if (Number.isInteger(p) && Number.isInteger(q)) {
    const g = gcd(p, q)
    if (g > 1) {
      p /= g
      q /= g
    }
  } else {
    p = p / q
    q = 1
  }
  const negative = p < 0
  p = Math.abs(p)
  const top: S[] = []
  const bottom: S[] = []
  // dy/dx last on its side: "x·dy/dx", the way the answer is written
  const ordered = m.fs
    .filter((f) => f.e !== 0)
    .sort((a, b) => (a.b.t === 'yp' ? 1 : 0) - (b.b.t === 'yp' ? 1 : 0))
  for (const f of ordered) {
    const e = Math.abs(f.e)
    const factor: S = e === 1 ? f.b : pow(f.b, N(e))
    ;(f.e > 0 ? top : bottom).push(factor)
  }
  if (p !== 1 || top.length === 0) top.unshift(N(p))
  if (q !== 1) bottom.unshift(N(q))
  const num = chain(top)
  const out: S = bottom.length === 0 ? num : { t: 'div', a: num, b: chain(bottom) }
  return negative ? { t: 'neg', a: out } : out
}

function mono(a: S, b: S, over: boolean): S {
  const m: Mono = { p: 1, q: 1, fs: [] }
  collect(a, 1, m)
  collect(b, over ? -1 : 1, m)
  return build(m)
}

function mul(a: S, b: S): S {
  if (isN(a, 0) || isN(b, 0)) return ZERO
  return mono(a, b, false)
}

function div(a: S, b: S): S {
  if (isN(a, 0)) return ZERO
  return mono(a, b, true)
}

function pow(a: S, b: S): S {
  if (isN(b, 0)) return ONE
  if (isN(b, 1)) return a
  if (isN(a) && isN(b)) return N(Math.pow(a.v, b.v))
  // (u^a)^n = u^(a·n)
  if (a.t === 'pow' && isN(b)) return pow(a.a, mul(a.b, b))
  return { t: 'pow', a, b }
}

const fn = (name: string, a: S): S => ({ t: 'fn', fn: name, a })

/** Does this sub-tree depend on x, y or dy/dx? */
function varies(s: S): boolean {
  switch (s.t) {
    case 'x':
    case 'y':
    case 'yp':
      return true
    case 'n':
    case 'c':
    case 'p':
      return false
    case 'neg':
    case 'fn':
      return varies(s.a)
    default:
      return varies(s.a) || varies(s.b)
  }
}

/** The parser's AST in this module's tree, or null for anything it cannot differentiate. */
function fromAst(n: ExprNode): S | null {
  switch (n.t) {
    case 'num':
      return N(n.v)
    case 'const':
      return { t: 'c', name: n.name }
    case 'var':
      return n.name === 'x' ? { t: 'x' } : n.name === 'y' ? { t: 'y' } : null
    case 'param':
      return { t: 'p', name: n.name }
    case 'neg': {
      const a = fromAst(n.a)
      return a ? neg(a) : null
    }
    case 'bin': {
      const a = fromAst(n.a)
      const b = fromAst(n.b)
      if (!a || !b) return null
      switch (n.op) {
        case '+':
          return add(a, b)
        case '-':
          return sub(a, b)
        case '*':
          return mul(a, b)
        case '/':
          return div(a, b)
        case '^':
          return pow(a, b)
      }
      return null
    }
    case 'call': {
      if (n.args.length !== 1 || !DIFFABLE.has(n.fn)) return null
      const a = fromAst(n.args[0])
      return a ? fn(n.fn, a) : null
    }
    default:
      return null
  }
}

const DIFFABLE: ReadonlySet<string> = new Set([
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'exp', 'ln', 'sqrt',
  'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh',
])

/** d/dx with y = y(x). Null when some piece has no rule here. */
function D(s: S): S | null {
  return Dm(s, 'total')
}

/**
 * Which derivative Dm takes: 'total' is d/dx with y = y(x) (the original D);
 * 'x' and 'y' are the partials ∂/∂x and ∂/∂y, the other variable held
 * constant. dy/dx never occurs in a partial's input.
 */
export type DMode = 'total' | 'x' | 'y'

/** Does s depend on what `mode` differentiates by? ('total': x, y or dy/dx.) */
function variesIn(s: S, mode: DMode): boolean {
  if (mode === 'total') return varies(s)
  switch (s.t) {
    case 'x':
      return mode === 'x'
    case 'y':
      return mode === 'y'
    case 'yp':
    case 'n':
    case 'c':
    case 'p':
      return false
    case 'neg':
    case 'fn':
      return variesIn(s.a, mode)
    default:
      return variesIn(s.a, mode) || variesIn(s.b, mode)
  }
}

/** The derivative `mode` names, by the same rules as D. Null when some piece has no rule here. */
export function Dm(s: S, mode: DMode): S | null {
  const D = (u: S): S | null => Dm(u, mode)
  const varies = (u: S): boolean => variesIn(u, mode)
  switch (s.t) {
    case 'n':
    case 'c':
    case 'p':
      return ZERO
    case 'x':
      return mode === 'y' ? ZERO : ONE
    case 'y':
      return mode === 'total' ? { t: 'yp' } : mode === 'y' ? ONE : ZERO
    case 'yp':
      return null // y'' of y'' is not asked for
    case 'neg': {
      const a = D(s.a)
      return a ? neg(a) : null
    }
    case 'add':
    case 'sub': {
      const a = D(s.a)
      const b = D(s.b)
      if (!a || !b) return null
      return s.t === 'add' ? add(a, b) : sub(a, b)
    }
    case 'mul': {
      const a = D(s.a)
      const b = D(s.b)
      if (!a || !b) return null
      return add(mul(a, s.b), mul(s.a, b))
    }
    case 'div': {
      const a = D(s.a)
      const b = D(s.b)
      if (!a || !b) return null
      if (!varies(s.b)) return div(a, s.b)
      if (!varies(s.a)) return neg(div(mul(s.a, b), pow(s.b, N(2))))
      return div(sub(mul(a, s.b), mul(s.a, b)), pow(s.b, N(2)))
    }
    case 'pow': {
      const du = D(s.a)
      const dv = D(s.b)
      if (!du || !dv) return null
      if (!varies(s.b)) {
        // power rule: v·u^(v−1)·u'
        const e = isN(s.b) ? N(s.b.v - 1) : sub(s.b, ONE)
        return mul(mul(s.b, pow(s.a, e)), du)
      }
      if (!varies(s.a)) {
        // a^v · ln a · v'   (e^v · v' for the base e)
        const lnA = s.a.t === 'c' && s.a.name === 'e' ? ONE : fn('ln', s.a)
        return mul(mul(s, lnA), dv)
      }
      return null // u(x)^v(x): not an AP question
    }
    case 'fn': {
      const du = D(s.a)
      if (!du) return null
      const u = s.a
      const outer = ((): S | null => {
        switch (s.fn) {
          case 'sin': return fn('cos', u)
          case 'cos': return neg(fn('sin', u))
          case 'tan': return pow(fn('sec', u), N(2))
          case 'sec': return mul(fn('sec', u), fn('tan', u))
          case 'csc': return neg(mul(fn('csc', u), fn('cot', u)))
          case 'cot': return neg(pow(fn('csc', u), N(2)))
          case 'exp': return fn('exp', u)
          case 'ln': return div(ONE, u)
          case 'sqrt': return div(ONE, mul(N(2), fn('sqrt', u)))
          case 'asin': return div(ONE, fn('sqrt', sub(ONE, pow(u, N(2)))))
          case 'acos': return neg(div(ONE, fn('sqrt', sub(ONE, pow(u, N(2))))))
          case 'atan': return div(ONE, add(ONE, pow(u, N(2))))
          case 'sinh': return fn('cosh', u)
          case 'cosh': return fn('sinh', u)
          case 'tanh': return sub(ONE, pow(fn('tanh', u), N(2)))
        }
        return null
      })()
      if (!outer) return null
      // chain rule, written the way a student would: outer'·u' with u' last
      if (isN(du, 1)) return outer
      if (outer.t === 'div' && isN(outer.a, 1)) return div(du, outer.b)
      return mul(outer, du)
    }
  }
}

/** Replace dy/dx by `f`, rebuilding through the simplifying constructors. */
function subst(s: S, f: S): S {
  switch (s.t) {
    case 'yp':
      return f
    case 'n':
    case 'c':
    case 'p':
    case 'x':
    case 'y':
      return s
    case 'neg':
      return neg(subst(s.a, f))
    case 'fn':
      return fn(s.fn, subst(s.a, f))
    case 'add':
      return add(subst(s.a, f), subst(s.b, f))
    case 'sub':
      return sub(subst(s.a, f), subst(s.b, f))
    case 'mul':
      return mul(subst(s.a, f), subst(s.b, f))
    case 'div':
      // A tight quotient is written by collectYp and holds no dy/dx.
      return s.tight ? s : div(subst(s.a, f), subst(s.b, f))
    case 'pow':
      return pow(subst(s.a, f), subst(s.b, f))
  }
}

function hasYp(s: S): boolean {
  switch (s.t) {
    case 'yp':
      return true
    case 'n':
    case 'c':
    case 'p':
    case 'x':
    case 'y':
      return false
    case 'neg':
    case 'fn':
      return hasYp(s.a)
    default:
      return hasYp(s.a) || hasYp(s.b)
  }
}

// ---- collecting like terms in dy/dx --------------------------------------
//
// The product rule leaves a logistic field's d²y/dx² as two terms that share
// dy/dx: y(1 − y) gives (1 − y)·dy/dx − y·dy/dx. The AP answer (and every
// teacher) writes (1 − 2y)·dy/dx — the factor whose sign IS the concavity. So
// the top-level terms of the form A·dy/dx are collected when every A is a
// polynomial in y whose coefficients are numbers times parameters (k, L) —
// and the collected line is kept only when it agrees with the original at
// several sample points. Anything else keeps the product rule's own line.

/** One term of a polynomial in y: c · Π(factor^e) · y^ye. */
interface PTerm {
  c: number
  ye: number
  /** Parameters, constants and x, by key ("p:k", "c:pi", "x"), with their tree and exponent. */
  fs: Map<string, { s: S; e: number }>
}
type Poly = Map<string, PTerm>

const POLY_MAX_TERMS = 16

function termKey(t: PTerm): string {
  const f = [...t.fs.entries()].filter(([, v]) => v.e !== 0).map(([k, v]) => `${k}^${v.e}`).sort()
  return `${t.ye}|${f.join('*')}`
}

function polyAdd(P: Poly, t: PTerm): void {
  if (t.c === 0) return
  const fs = new Map([...t.fs].filter(([, v]) => v.e !== 0))
  const clean: PTerm = { c: t.c, ye: t.ye, fs }
  const k = termKey(clean)
  const hit = P.get(k)
  if (hit) {
    hit.c += t.c
    if (Math.abs(hit.c) <= 1e-12 * Math.max(Math.abs(t.c), 1e-300)) P.delete(k)
  } else P.set(k, clean)
}

function polyOf(c: number, ye = 0, fs: Map<string, { s: S; e: number }> = new Map()): Poly {
  const P: Poly = new Map()
  polyAdd(P, { c, ye, fs })
  return P
}

function polyMul(A: Poly, B: Poly): Poly | null {
  const out: Poly = new Map()
  for (const a of A.values()) {
    for (const b of B.values()) {
      const fs = new Map<string, { s: S; e: number }>()
      for (const [k, v] of a.fs) fs.set(k, { s: v.s, e: v.e })
      for (const [k, v] of b.fs) {
        const hit = fs.get(k)
        if (hit) hit.e += v.e
        else fs.set(k, { s: v.s, e: v.e })
      }
      polyAdd(out, { c: a.c * b.c, ye: a.ye + b.ye, fs })
      if (out.size > POLY_MAX_TERMS) return null
    }
  }
  return out
}

function polyScale(A: Poly, k: number): Poly {
  const out: Poly = new Map()
  for (const t of A.values()) polyAdd(out, { ...t, c: t.c * k })
  return out
}

/** A tree as a polynomial in y over numbers × parameters, or null. */
function toPoly(s: S): Poly | null {
  switch (s.t) {
    case 'n':
      return polyOf(s.v)
    case 'y':
      return polyOf(1, 1)
    case 'x':
      return polyOf(1, 0, new Map([['x', { s, e: 1 }]]))
    case 'p':
      return polyOf(1, 0, new Map([[`p:${s.name}`, { s, e: 1 }]]))
    case 'c':
      return polyOf(1, 0, new Map([[`c:${s.name}`, { s, e: 1 }]]))
    case 'neg': {
      const a = toPoly(s.a)
      return a ? polyScale(a, -1) : null
    }
    case 'add':
    case 'sub': {
      const a = toPoly(s.a)
      const b = toPoly(s.b)
      if (!a || !b) return null
      const out: Poly = new Map()
      for (const t of a.values()) polyAdd(out, t)
      for (const t of b.values()) polyAdd(out, { ...t, c: s.t === 'sub' ? -t.c : t.c })
      return out.size > POLY_MAX_TERMS ? null : out
    }
    case 'mul': {
      const a = toPoly(s.a)
      const b = toPoly(s.b)
      return a && b ? polyMul(a, b) : null
    }
    case 'div': {
      // Only by a single term: y/L, k/2 — never by a sum.
      const a = toPoly(s.a)
      const b = toPoly(s.b)
      if (!a || !b || b.size !== 1) return null
      const t = [...b.values()][0]
      if (t.c === 0) return null
      const inv = new Map<string, { s: S; e: number }>()
      for (const [k, v] of t.fs) inv.set(k, { s: v.s, e: -v.e })
      return polyMul(a, polyOf(1 / t.c, -t.ye, inv))
    }
    case 'pow': {
      if (!isN(s.b) || !Number.isInteger(s.b.v) || s.b.v < 0 || s.b.v > 4) return null
      const a = toPoly(s.a)
      if (!a) return null
      let out: Poly | null = polyOf(1)
      for (let i = 0; i < s.b.v && out; i++) out = polyMul(out, a)
      return out
    }
    default:
      return null
  }
}

/** p/q for a coefficient that is one (q ≤ 1000), else null. */
function ratio(v: number): { p: number; q: number } | null {
  if (!Number.isFinite(v)) return null
  for (let q = 1; q <= 1000; q++) {
    const p = Math.round(v * q)
    if (Math.abs(p / q - v) <= 1e-12 * Math.max(1, Math.abs(v)) && Math.abs(p) <= 1e6) return { p, q }
  }
  return null
}

const tidyC = (v: number): number => Number(v.toPrecision(12))

/**
 * One term, sign dropped: |c|·factors·y^ye. `c` is a p/q when it is one — so
 * y/5, 2y/L — else a decimal.
 */
function termS(t: PTerm, decimal = false): S {
  const c = Math.abs(tidyC(t.c))
  const r = ratio(c)
  const top: S[] = []
  const bottom: S[] = []
  // A short decimal out front stays one: 0.5(1 − y/5), not (…)/2.
  if (decimal && r && r.q !== 1 && String(c).length <= 8) top.push(N(c))
  else if (r && r.q !== 1) {
    if (r.p !== 1) top.push(N(r.p))
    bottom.push(N(r.q))
  } else if (c !== 1) top.push(N(r ? r.p : c))
  for (const f of [...t.fs.values()].sort((a, b) => b.e - a.e)) {
    if (f.e === 0) continue
    const e = Math.abs(f.e)
    ;(f.e > 0 ? top : bottom).push(e === 1 ? f.s : { t: 'pow', a: f.s, b: N(e) })
  }
  if (t.ye > 0) top.push(t.ye === 1 ? { t: 'y' } : { t: 'pow', a: { t: 'y' }, b: N(t.ye) })
  if (top.length === 0) top.push(ONE)
  const num = chain(top)
  if (bottom.length === 0) return num
  // "2y/L": a number beside one letter needs no bracket over the line.
  const tight = top.length === 2 && top[0].t === 'n' && PREC[top[1].t] >= 6 && top[1].t !== 'n'
  return tight ? { t: 'div', a: num, b: chain(bottom), tight: true } : { t: 'div', a: num, b: chain(bottom) }
}

/** Σ of the terms, constant first then rising powers of y. */
function sumS(terms: PTerm[]): S {
  const sorted = terms.slice().sort((a, b) => a.ye - b.ye || termKey(a).localeCompare(termKey(b)))
  // Lead with a positive term when there is one: 2y − 1, not −1 + 2y.
  const lead = sorted.findIndex((t) => tidyC(t.c) > 0)
  if (lead > 0) sorted.unshift(...sorted.splice(lead, 1))
  let out: S | null = null
  for (const t of sorted) {
    const body = termS(t)
    const neg_ = tidyC(t.c) < 0
    if (out === null) out = neg_ ? { t: 'neg', a: body } : body
    else out = neg_ ? { t: 'sub', a: out, b: body } : { t: 'add', a: out, b: body }
  }
  return out ?? ZERO
}

/**
 * The collected A, written the way it is taught: an integer gcd pulled out
 * front (6 − 4y → 2(3 − 2y)); otherwise the constant term pulled out when the
 * others are clean multiples of it (0.5 − 0.1y → 0.5(1 − y/5),
 * k − 2ky/L → k(1 − 2y/L)); otherwise the plain sum.
 */
function polyS(P: Poly): S {
  const terms = [...P.values()]
  if (terms.length === 0) return ZERO
  if (terms.length === 1) {
    const b = termS(terms[0])
    return tidyC(terms[0].c) < 0 ? neg(b) : b
  }
  const plainNums = terms.every((t) => t.fs.size === 0 && Number.isInteger(tidyC(t.c)))
  if (plainNums) {
    const g = terms.reduce((acc, t) => gcd(acc, tidyC(t.c)), 0)
    if (g > 1) return { t: 'mul', a: N(g), b: sumS(terms.map((t) => ({ ...t, c: t.c / g }))) }
    return sumS(terms)
  }
  const c0s = terms.filter((t) => t.ye === 0)
  if (c0s.length === 1) {
    const t0 = c0s[0]
    const inner: PTerm[] = []
    let ok = true
    for (const t of terms) {
      const rc = t.c / t0.c
      if (t !== t0 && !ratio(Math.abs(tidyC(rc)))) ok = false
      const fs = new Map<string, { s: S; e: number }>()
      for (const [k, v] of t.fs) fs.set(k, { s: v.s, e: v.e })
      for (const [k, v] of t0.fs) {
        const hit = fs.get(k)
        if (hit) hit.e -= v.e
        else fs.set(k, { s: v.s, e: -v.e })
      }
      inner.push({ c: t === t0 ? 1 : rc, ye: t.ye, fs: new Map([...fs].filter(([, v]) => v.e !== 0)) })
    }
    if (ok) {
      const front = termS({ ...t0, c: Math.abs(t0.c) }, true)
      const body: S = { t: 'mul', a: front, b: sumS(inner) }
      return tidyC(t0.c) < 0 ? { t: 'neg', a: body } : body
    }
  }
  return sumS(terms)
}

/** The top-level terms of a sum, each with its sign. */
function sumTerms(s: S, sign: 1 | -1, out: { s: S; sign: 1 | -1 }[]): void {
  if (s.t === 'add' || s.t === 'sub') {
    sumTerms(s.a, sign, out)
    sumTerms(s.b, s.t === 'sub' ? (-sign as 1 | -1) : sign, out)
  } else if (s.t === 'neg') sumTerms(s.a, -sign as 1 | -1, out)
  else out.push({ s, sign })
}

const MATH_FN: Record<string, (v: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  sec: (v) => 1 / Math.cos(v), csc: (v) => 1 / Math.sin(v), cot: (v) => 1 / Math.tan(v),
  exp: Math.exp, ln: Math.log, sqrt: Math.sqrt,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
}
const CONST_VAL: Record<string, number> = { pi: Math.PI, tau: 2 * Math.PI, e: Math.E }

/** s at x, y, dy/dx and the parameters' values (a parameter not given is NaN). */
function evalS(s: S, env: { x: number; y: number; yp: number; p: (name: string) => number }): number {
  switch (s.t) {
    case 'n':
      return s.v
    case 'c':
      return CONST_VAL[s.name] ?? Number.NaN
    case 'x':
      return env.x
    case 'y':
      return env.y
    case 'yp':
      return env.yp
    case 'p':
      return env.p(s.name)
    case 'neg':
      return -evalS(s.a, env)
    case 'add':
      return evalS(s.a, env) + evalS(s.b, env)
    case 'sub':
      return evalS(s.a, env) - evalS(s.b, env)
    case 'mul':
      return evalS(s.a, env) * evalS(s.b, env)
    case 'div':
      return evalS(s.a, env) / evalS(s.b, env)
    case 'pow':
      return Math.pow(evalS(s.a, env), evalS(s.b, env))
    case 'fn': {
      const g = MATH_FN[s.fn]
      return g ? g(evalS(s.a, env)) : Number.NaN
    }
  }
}

/** Two trees that agree at seven sample points (x, y, dy/dx and every parameter varied). */
function agreeNumerically(a: S, b: S): boolean {
  let finite = 0
  for (let i = 0; i < 7; i++) {
    const vals = new Map<string, number>()
    const p = (name: string): number => {
      let v = vals.get(name)
      if (v === undefined) {
        let h = i * 131 + 7
        for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 9973
        v = 0.6 + (h % 997) / 400
        vals.set(name, v)
      }
      return v
    }
    const env = { x: 0.37 + 0.41 * i, y: 0.23 + 0.53 * i, yp: -1.3 + 0.61 * i, p }
    const u = evalS(a, env)
    const v = evalS(b, env)
    if (!Number.isFinite(u) && !Number.isFinite(v)) continue
    if (!Number.isFinite(u) || !Number.isFinite(v)) return false
    if (Math.abs(u - v) > 1e-9 * Math.max(1, Math.abs(u), Math.abs(v))) return false
    finite++
  }
  return finite >= 4
}

/**
 * Terms A·dy/dx + B·dy/dx + … collected into (A + B + …)·dy/dx, where every A
 * is a polynomial in y over numbers and parameters. Null when there is
 * nothing to collect, or the collected line does not check out numerically.
 */
function collectYp(s: S): S | null {
  // y(2 − y)/3: collect over the numerator.
  if (s.t === 'div' && !varies(s.b)) {
    const top = collectYp(s.a)
    const result = top ? div(top, s.b) : null
    return result && agreeNumerically(s, result) ? result : null
  }
  const terms: { s: S; sign: 1 | -1 }[] = []
  sumTerms(s, 1, terms)
  if (terms.length < 2) return null
  const yp: S = { t: 'yp' }
  const total: Poly = new Map()
  let firstAt = -1
  let count = 0
  const rest: ({ s: S; sign: 1 | -1 } | null)[] = []
  for (const t of terms) {
    const A = hasYp(t.s) ? div(t.s, yp) : null
    const P = A && !hasYp(A) ? toPoly(A) : null
    if (!P) {
      rest.push(t)
      continue
    }
    for (const pt of P.values()) polyAdd(total, { ...pt, c: pt.c * t.sign })
    if (total.size > POLY_MAX_TERMS) return null
    if (firstAt < 0) {
      firstAt = rest.length
      rest.push(null)
    }
    count++
  }
  if (count < 2) return null
  for (const t of total.values()) if (t.ye < 0) return null
  const A = polyS(total)
  const collected: S | null = isN(A, 0) ? null : A.t === 'neg' ? neg(mul(A.a, yp)) : mul(A, yp)
  let out: S | null = null
  for (const t of rest) {
    const piece = t === null ? (collected ? { s: collected, sign: 1 as const } : null) : t
    if (!piece) continue
    let body = piece.s
    let sign: number = piece.sign
    if (body.t === 'neg') {
      body = body.a
      sign = -sign
    }
    if (out === null) out = sign < 0 ? neg(body) : body
    else out = sign < 0 ? { t: 'sub', a: out, b: body } : { t: 'add', a: out, b: body }
  }
  const result = out ?? ZERO
  return agreeNumerically(s, result) ? result : null
}

// ---- printing ------------------------------------------------------------

const PREC: Record<S['t'], number> = {
  add: 1, sub: 1, neg: 2, mul: 3, div: 3, pow: 5, n: 6, c: 6, x: 6, y: 6, yp: 6, p: 6, fn: 6,
}
const SUP: Record<string, string> = { '2': '²', '3': '³', '4': '⁴', '5': '⁵' }
const CONST_TEXT: Record<string, string> = { pi: 'π', tau: 'τ', e: 'e' }
const CONST_TEX: Record<string, string> = { pi: '\\pi', tau: '\\tau', e: 'e' }
const FN_TEX: Record<string, string> = {
  asin: '\\arcsin', acos: '\\arccos', atan: '\\arctan',
}

function numText(v: number): string {
  const t = Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)))
  return withMinus(t)
}

/** Does this print as something that starts with a digit? */
function leadsWithDigit(s: S): boolean {
  if (s.t === 'n') return true
  if (s.t === 'mul' || s.t === 'div' || s.t === 'pow') return leadsWithDigit(s.a)
  return false
}

/**
 * The letter the variable prints as. 'x' everywhere except inside printIn,
 * which parametric and polar calculus (src/core/paramCalc.ts) use to print a
 * tree built in x as a formula in t or θ.
 */
let VAR_TEXT = 'x'
let VAR_TEX = 'x'

/** Run `f` with the variable printed as `name` (and `texName` in KaTeX). */
function printIn<T>(name: string, texName: string, f: () => T): T {
  const was = [VAR_TEXT, VAR_TEX]
  VAR_TEXT = name
  VAR_TEX = texName
  try {
    return f()
  } finally {
    VAR_TEXT = was[0]
    VAR_TEX = was[1]
  }
}

function text(s: S, parent = 0): string {
  const p = PREC[s.t]
  const wrap = (body: string): string => (p < parent ? `(${body})` : body)
  switch (s.t) {
    case 'n':
      return s.v < 0 && parent > 1 ? `(${numText(s.v)})` : numText(s.v)
    case 'c':
      return CONST_TEXT[s.name] ?? s.name
    case 'x':
      return VAR_TEXT
    case 'y':
      return 'y'
    case 'yp':
      return 'dy/dx'
    case 'p':
      return s.name
    case 'neg':
      return wrap(`${MINUS}${text(s.a, 3)}`)
    case 'add':
      return wrap(`${text(s.a, 1)} + ${text(s.b, 1)}`)
    case 'sub':
      return wrap(`${text(s.a, 1)} ${MINUS} ${text(s.b, 2)}`)
    case 'mul': {
      const l = text(s.a, 3)
      const r = text(s.b, 4)
      // 2x, 2y, 3(x + y): a number juxtaposes with a letter; dy/dx never does
      const juxt = s.a.t === 'n' && s.b.t !== 'yp' && !leadsWithDigit(s.b) && s.b.t !== 'n'
      return wrap(juxt ? `${l}${r}` : `${l}·${r}`)
    }
    case 'div': {
      // "dy/dx/(2√y)" reads as a fraction of fractions; bracket the derivative
      const top = s.a.t === 'yp' ? '(dy/dx)' : s.tight ? text(s.a, 3) : text(s.a, 5)
      return wrap(`${top}/${text(s.b, 5)}`)
    }
    case 'pow': {
      const base = text(s.a, 6)
      const e = isN(s.b) && SUP[String(s.b.v)] ? SUP[String(s.b.v)] : `^${text(s.b, 6)}`
      return wrap(`${base}${e}`)
    }
    case 'fn':
      if (s.fn === 'sqrt') return PREC[s.a.t] >= 6 ? `√${text(s.a)}` : `√(${text(s.a)})`
      return `${s.fn}(${text(s.a)})`
  }
}

function tex(s: S, parent = 0): string {
  const p = PREC[s.t]
  const wrap = (body: string): string => (p < parent ? `\\left(${body}\\right)` : body)
  switch (s.t) {
    case 'n':
      return s.v < 0 && parent > 1 ? `\\left(${String(s.v)}\\right)` : String(Number(s.v.toPrecision(6)))
    case 'c':
      return CONST_TEX[s.name] ?? s.name
    case 'x':
      return VAR_TEX
    case 'y':
      return 'y'
    case 'yp':
      return '\\frac{dy}{dx}'
    case 'p':
      return s.name
    case 'neg':
      return wrap(`-${tex(s.a, 3)}`)
    case 'add':
      return wrap(`${tex(s.a, 1)} + ${tex(s.b, 1)}`)
    case 'sub':
      return wrap(`${tex(s.a, 1)} - ${tex(s.b, 2)}`)
    case 'mul': {
      const l = tex(s.a, 3)
      const r = tex(s.b, 4)
      if (leadsWithDigit(s.b)) return wrap(`${l} \\cdot ${r}`)
      return wrap(s.a.t === 'n' && s.b.t !== 'yp' ? `${l}${r}` : `${l}\\,${r}`)
    }
    case 'div':
      return `\\frac{${tex(s.a)}}{${tex(s.b)}}`
    case 'pow':
      return wrap(`{${tex(s.a, 6)}}^{${tex(s.b)}}`)
    case 'fn':
      return s.fn === 'sqrt'
        ? `\\sqrt{${tex(s.a)}}`
        : `${FN_TEX[s.fn] ?? `\\${s.fn}`}\\left(${tex(s.a)}\\right)`
  }
}


// ---- the module's surface -------------------------------------------------

export {
  N,
  ZERO,
  ONE,
  isN,
  same,
  neg,
  add,
  sub,
  mul,
  div,
  pow,
  fn,
  varies,
  fromAst,
  D,
  subst,
  hasYp,
  collectYp,
  evalS,
  text,
  tex,
  printIn,
  numText,
  MATH_FN,
  CONST_VAL,
}

// ============================================================================
// src/core/inverse.ts — the inverse of a function as an EQUATION.
//
//   export function invertFormula(src, restriction, name): InverseFormula | null
//
// The board already draws any function's inverse as the reflection (f(t), t)
// (functionEnv.inverseRelation). This is the algebra a Precalc / Math 3
// student is asked for: "find f⁻¹(x)". It works on the parser's AST
// (parseAst from ./parse), the way a student does — swap and solve:
//
//   1. x occurs ONCE in the formula: undo the operations from the outside in.
//        + c, − c, · c, / c, c − u, c / u         the inverse operation
//        u^n (n odd integer)                      ∛, ⁵√ … (written (x)^(1/n) or cbrt)
//        u^n (n even) / |u|                       ±√ — the sign from the branch
//        √u, ∛u, u^(p/q)                          the power back
//        e^u, b^u, 10^u                           ln, log_b, log
//        ln u, log u, log_b u                     e^, b^
//        sin u, cos u, tan u (and the arc-trig)   the principal inverse on the
//                                                  principal branch; another
//                                                  branch of the restriction
//                                                  shifts/reflects it:
//                                                  sin on [π/2, 3π/2] → π − arcsin x
//        sinh, tanh (cosh by branch like x²)
//   2. x occurs more than once, in two shapes a textbook uses:
//        a quadratic in x (ax² + bx + c, expanded or not) — complete the
//        square, the branch from the restriction: x² − 2x + 3 on x ≥ 1 is
//        1 + √(x − 2);
//        a linear-fractional (ax + b)/(cx + d) — (dx − b)/(−cx + a) → written
//        (b − dx)/(cx − a) or the tidiest equivalent.
//   Anything else (x + eˣ, x·sin x, a named call, a piecewise) is null: the
//   curve is still reflected on the board; there is just no formula.
//
// BRANCHES. Where the formula is not one-to-one (an even power, |u|, a
// quadratic, a trig function, cosh), the inverse needs to know WHICH part of
// the domain it inverts: `restriction` (the curve domain the teacher chose,
// or null for the whole natural domain). With no restriction and a
// non-invertible step, the result is null — never a formula that is wrong on
// half its graph. For u^2 on a restriction where u ≥ 0 the root is +√, where
// u ≤ 0 it is −√ (decided by evaluating u at an interior point of the
// restriction).
//
// VERIFIED. Every result is checked numerically before it is returned:
// f(f⁻¹(y)) = y at ~9 points spread over f's range on the restriction (and
// f⁻¹(f(x)) = x over the restriction), relative 1e-9. A formula that fails
// the check is null.
//
// OUTPUT. `source` is a line the app's parser reads back — "y = sqrt(x - 2) + 1"
// — so "Add f⁻¹ as a curve" types it; `latex` is the textbook form
// "f^{-1}(x) = \sqrt{x - 2} + 1" (the parser's own LaTeX of the solved body,
// with the head renamed); `text` is Unicode "f⁻¹(x) = √(x − 2) + 1". Numbers
// are printed as in the source (exact rationals stay fractions; π stays pi).
//
// Pure TypeScript: no DOM, no imports from src/ui. Owned by the core agent.
//
// ---------------------------------------------------------------------------
// NOTES (implementation; the contract above is unchanged)
//
//   * The solved body is built as a parser AST and printed three ways: the
//     source (parser tokens: sqrt, cbrt, ln, log, log_2, asin, pi, e, ^), the
//     Unicode text, and — by parsing that source back — the parser's own
//     LaTeX. The source is also what the verification compiles, so a line
//     that does not read back is never returned.
//   * Tidiness is built in, not cleaned up after: a constant added to or
//     subtracted from a sum folds into its constant (x − 3 − 1 is x − 4),
//     multiplying or dividing by a rational folds into one coefficient
//     ((x − 3)/2, never (x − 3)·(1/2)), −(a − b) is b − a, and parentheses
//     appear only where the parser needs them.
//   * Both roads to a completed square print the same line: (x − 1)² + 2 and
//     x² − 2x + 3 on x ≥ 1 are both "sqrt(x - 2) + 1".
//   * An odd root other than the cube root is written (u)^(1/n). The parser
//     evaluates a negative base to a fractional power as NaN today, so such
//     a formula fails its own verification on negative u and is null until
//     the parser reads odd roots of negatives (see the report); the cube
//     root is written cbrt(u), which the parser evaluates everywhere.
//   * A formula with free constants (sliders a, b) is null: its value is not
//     a number until the sliders are, so it cannot be verified here.
// ============================================================================

import type { IntervalPart } from './domainRange'
import { describeSet } from './domainRange'
import { exactForm } from './exact'
import { compileExpr, parseAst, parseExpression, piecewiseParts } from './parse'
import type { ExprNode } from './parse'

export interface InverseFormula {
  /** "f^{-1}(x) = \sqrt{x-2}+1" */
  latex: string
  /** "f⁻¹(x) = √(x − 2) + 1" */
  text: string
  /** a typed line the parser reads back, head "y =": "y = sqrt(x - 2) + 1" */
  source: string
  /** when a branch was chosen: "the branch x ≥ 1" / "principal branch" — for the card; else null */
  branch: string | null
}

// ============================================================================
// AST building — with the folding that keeps the answer tidy
// ============================================================================

type N = ExprNode

const X: N = { t: 'var', name: 'x' }
const PI: N = { t: 'const', name: 'pi' }
const E: N = { t: 'const', name: 'e' }

/** A rational p/q (q > 0, lowest terms) — the arithmetic of coefficients. */
interface Rat { p: number; q: number }

function gcd(a: number, b: number): number {
  a = Math.abs(a); b = Math.abs(b)
  while (b) [a, b] = [b, a % b]
  return a || 1
}
function rat(p: number, q = 1): Rat | null {
  if (!Number.isFinite(p) || !Number.isFinite(q) || q === 0) return null
  if (!Number.isInteger(p) || !Number.isInteger(q)) return null
  if (q < 0) { p = -p; q = -q }
  const g = gcd(p, q)
  p /= g; q /= g
  if (Math.abs(p) > 1e12 || q > 1e12) return null
  return { p: p + 0, q }
}
const rAdd = (a: Rat, b: Rat) => rat(a.p * b.q + b.p * a.q, a.q * b.q)
const rMul = (a: Rat, b: Rat) => rat(a.p * b.p, a.q * b.q)
const rDiv = (a: Rat, b: Rat) => (b.p === 0 ? null : rat(a.p * b.q, a.q * b.p))
const rNeg = (a: Rat): Rat => ({ p: -a.p + 0, q: a.q })
/** A rational a reader wants to see as a fraction: 3/2, 5/64 — not 6173/5000. */
const nice = (a: Rat) => a.q <= 64 && Math.abs(a.p) <= 100000

/** A decimal literal as the rational it names ("0.25" is 1/4). */
function ratOfRaw(raw: string, v: number): Rat | null {
  if (Number.isInteger(v)) return rat(v)
  const m = /^(\d*)\.(\d+)$/.exec(raw.trim())
  if (!m || m[2].length > 9) return null
  return rat(Number((m[1] || '0') + m[2]), 10 ** m[2].length)
}

/** A float that is a small rational, as that rational. */
function ratOfValue(v: number): Rat | null {
  if (!Number.isFinite(v)) return null
  for (let q = 1; q <= 1000; q++) {
    const p = Math.round(v * q)
    if (Math.abs(p / q - v) <= 1e-12 * Math.max(1, Math.abs(v))) return rat(p, q)
  }
  return null
}

/** The exact rational value of a constant subtree, or null (π, e, √2 …). */
function ratOf(n: N): Rat | null {
  switch (n.t) {
    case 'num': return ratOfRaw(n.raw, n.v)
    case 'neg': { const a = ratOf(n.a); return a ? rNeg(a) : null }
    case 'bin': {
      const a = ratOf(n.a), b = ratOf(n.b)
      if (!a || !b) return null
      switch (n.op) {
        case '+': return rAdd(a, b)
        case '-': return rAdd(a, rNeg(b))
        case '*': return rMul(a, b)
        case '/': return rDiv(a, b)
        case '^': {
          if (b.q !== 1 || Math.abs(b.p) > 12) return null
          let r: Rat | null = rat(1)
          for (let i = 0; i < Math.abs(b.p) && r; i++) r = rMul(r, a)
          return r && b.p < 0 ? rDiv(rat(1)!, r) : r
        }
      }
      return null
    }
    default: return null
  }
}

const numNode = (v: number): N => ({ t: 'num', v, raw: String(v) })

/** A decimal node carrying the full double (the printer rounds it for show). */
function decNode(v: number): N {
  const a = Math.abs(v)
  const body: N = { t: 'num', v: a, raw: String(Number(a.toPrecision(15))) }
  return v < 0 ? { t: 'neg', a: body } : body
}

/** A rational as a node: 3, −3, 3/4, −3/4 — and a decimal when the fraction would be ugly. */
function ratNode(r: Rat): N {
  if (!nice(r)) return decNode(r.p / r.q)
  const a = Math.abs(r.p)
  const body: N = r.q === 1 ? numNode(a) : { t: 'bin', op: '/', a: numNode(a), b: numNode(r.q) }
  return r.p < 0 ? { t: 'neg', a: body } : body
}

/** A computed number as a node: a rational when it is one, else a decimal. */
function valueNode(v: number): N {
  const r = ratOfValue(v)
  if (r) return ratNode(r)
  return decNode(v)
}

const isNum = (n: N, v: number) => n.t === 'num' && n.v === v
const isZero = (n: N) => { const r = ratOf(n); return !!r && r.p === 0 }

/** −a, tidy: −(−a) = a, −(a − b) = b − a, −(k·u) keeps the minus in front. */
function neg(a: N): N {
  if (a.t === 'neg') return a.a
  if (isZero(a)) return numNode(0)
  if (a.t === 'bin' && a.op === '-') return { t: 'bin', op: '-', a: a.b, b: a.a }
  if (a.t === 'bin' && a.op === '/' && a.a.t === 'bin' && a.a.op === '-') {
    return { t: 'bin', op: '/', a: neg(a.a), b: a.b }
  }
  return { t: 'neg', a }
}

/** The trailing constant of a sum (u + 3 → [u, 3]), for folding. */
function splitConst(n: N): { rest: N | null; c: Rat } | null {
  if (n.t === 'bin' && (n.op === '+' || n.op === '-')) {
    const r = ratOf(n.b)
    if (r && ratOf(n.a) === null) return { rest: n.a, c: n.op === '+' ? r : rNeg(r) }
  }
  const r = ratOf(n)
  if (r) return { rest: null, c: r }
  return null
}

/** |c| as it was written (1.5 stays 1.5), for a constant whose sign is known. */
function absNode(c: N, r: Rat): N {
  if (c.t === 'neg') return c.a
  if (r.p >= 0) return c
  return ratNode(rNeg(r))
}

/** a + c for a constant c (a rational folds into a's own constant). */
function addC(a: N, c: N): N {
  const rc = ratOf(c)
  if (rc) {
    if (rc.p === 0) return a
    const sp = splitConst(a)
    if (sp && sp.rest) {
      const sum = rAdd(sp.c, rc)
      if (sum) return sum.p === 0 ? sp.rest : withConst(sp.rest, sum)
    }
    // nothing to fold into: the constant keeps its own spelling
    return rc.p < 0
      ? { t: 'bin', op: '-', a, b: absNode(c, rc) }
      : { t: 'bin', op: '+', a, b: absNode(c, rc) }
  }
  if (c.t === 'neg') return { t: 'bin', op: '-', a, b: c.a }
  return { t: 'bin', op: '+', a, b: c }
}

/** u + r written with the sign on the operator. */
function withConst(u: N, r: Rat): N {
  if (r.p === 0) return u
  return r.p < 0
    ? { t: 'bin', op: '-', a: u, b: ratNode(rNeg(r)) }
    : { t: 'bin', op: '+', a: u, b: ratNode(r) }
}

/** a − c. */
function subC(a: N, c: N): N {
  const rc = ratOf(c)
  if (rc) {
    if (rc.p === 0) return a
    const sp = splitConst(a)
    if (sp && sp.rest) return addC(a, ratNode(rNeg(rc)))
    return rc.p > 0
      ? { t: 'bin', op: '-', a, b: absNode(c, rc) }
      : { t: 'bin', op: '+', a, b: absNode(c, rc) }
  }
  if (c.t === 'neg') return { t: 'bin', op: '+', a, b: c.a }
  return { t: 'bin', op: '-', a, b: c }
}

/** c − a, for a constant c. */
function cMinus(c: N, a: N): N {
  if (isZero(c)) return neg(a)
  // c − (u + k) = (c − k) − u
  const sp = splitConst(a)
  const rc = ratOf(c)
  if (sp && sp.rest && rc) {
    const d = rAdd(rc, rNeg(sp.c))
    if (d) return d.p === 0 ? neg(sp.rest) : { t: 'bin', op: '-', a: ratNode(d), b: sp.rest }
  }
  if (a.t === 'neg') return addC(a.a, c)
  return { t: 'bin', op: '-', a: c, b: a }
}

/** k·u for a rational k: 3u, −u, (3u)/4 — a coefficient in front. */
function mulR(u: N, k: Rat): N {
  if (k.p === 0) return numNode(0)
  if (k.p === 1 && k.q === 1) return u
  if (k.p === -1 && k.q === 1) return neg(u)
  if (u.t === 'neg') return mulR(u.a, rNeg(k))
  // (u/q0)·k and (k0·u)·k fold
  if (u.t === 'bin' && u.op === '/') {
    const d = ratOf(u.b)
    if (d) { const kk = rDiv(k, d); if (kk) return mulR(u.a, kk) }
  }
  if (u.t === 'bin' && u.op === '*') {
    const c0 = ratOf(u.a)
    if (c0) { const kk = rMul(k, c0); if (kk) return mulR(u.b, kk) }
  }
  // a whole-number multiplier distributes when it clears the constant's
  // fraction: 2(x + 3/2) is 2x + 3 (but (x − 3)/2 stays as it is)
  if (k.q === 1) {
    const sp = splitConst(u)
    if (sp && sp.rest) {
      const kc = rMul(k, sp.c)
      if (kc && kc.q === 1 && sp.c.q !== 1) return withConst(mulR(sp.rest, k), kc)
    }
  }
  if (!nice(k)) {
    // a fitted coefficient: ONE decimal constant — divide by the number that
    // was written (x/1.234) when it is a short one, else multiply
    const kv = Math.abs(k.p / k.q)
    const inv = 1 / kv
    const short = Number(inv.toPrecision(6)) === Number(inv.toPrecision(15))
    const body: N = short
      ? { t: 'bin', op: '/', a: u, b: decNode(inv) }
      : { t: 'bin', op: '*', a: decNode(kv), b: u }
    return k.p < 0 ? neg(body) : body
  }
  const a = Math.abs(k.p)
  let body: N = a === 1 ? u : { t: 'bin', op: '*', a: numNode(a), b: u }
  if (k.q !== 1) body = { t: 'bin', op: '/', a: body, b: numNode(k.q) }
  return k.p < 0 ? neg(body) : body
}

/** A constant written with a decimal point (a fitted or typed 1.5): kept as written. */
function isDecimal(c: N): boolean {
  switch (c.t) {
    case 'num': return c.raw.includes('.') && !Number.isInteger(c.v)
    case 'neg': return isDecimal(c.a)
    default: return false
  }
}

/** 1/c as a short number (0.5 → 2, 0.25 → 4), or null. */
function shortReciprocal(c: N): Rat | null {
  const r = ratOf(c)
  if (!r || r.p === 0) return null
  const inv = rDiv(rat(1)!, r)
  if (!inv) return null
  const v = inv.p / inv.q
  return Number.isInteger(v) || Number(v.toPrecision(3)) === v ? inv : null
}

/** u · c for a constant c. */
function mulC(u: N, c: N): N {
  if (isDecimal(c)) {
    // 1.5·u stays 1.5u: a decimal a teacher wrote is not turned into 3/2
    if (c.t === 'neg') return neg(mulC(u, c.a))
    if (u.t === 'neg') return neg(mulC(u.a, c))
    return { t: 'bin', op: '*', a: c, b: u }
  }
  const r = ratOf(c)
  if (r) return mulR(u, r)
  if (c.t === 'neg') return neg(mulC(u, c.a))
  return { t: 'bin', op: '*', a: c, b: u }
}

/** u / c for a constant c. */
function divC(u: N, c: N): N | null {
  if (isDecimal(c) && !shortReciprocal(c)) {
    // ÷ 2.1 stays ÷ 2.1 (never ×10/21); ÷ 0.5 is still × 2
    if (c.t === 'neg') { const d = divC(u, c.a); return d ? neg(d) : null }
    if (u.t === 'neg') { const d = divC(u.a, c); return d ? neg(d) : null }
    return { t: 'bin', op: '/', a: u, b: c }
  }
  const r = ratOf(c)
  if (r) {
    if (r.p === 0) return null
    const inv = rDiv(rat(1)!, r)
    return inv ? mulR(u, inv) : null
  }
  if (c.t === 'neg') { const d = divC(u, c.a); return d ? neg(d) : null }
  return { t: 'bin', op: '/', a: u, b: c }
}

/** c / u for a constant c. */
function cDiv(c: N, u: N): N {
  if (u.t === 'neg') return neg(cDiv(c, u.a))
  const r = ratOf(c)
  if (r && r.p < 0) return neg({ t: 'bin', op: '/', a: ratNode(rNeg(r)), b: u })
  return { t: 'bin', op: '/', a: c, b: u }
}

const call = (fn: string, ...args: N[]): N => ({ t: 'call', fn, args })
const pow = (a: N, b: N): N => ({ t: 'bin', op: '^', a, b })

// ============================================================================
// Reading the formula
// ============================================================================

function containsX(n: N): boolean {
  switch (n.t) {
    case 'var': return n.name === 'x'
    case 'neg': return containsX(n.a)
    case 'bin': return containsX(n.a) || containsX(n.b)
    case 'call': return n.args.some(containsX)
    case 'ucall': return true
    default: return false
  }
}

function countX(n: N): number {
  switch (n.t) {
    case 'var': return n.name === 'x' ? 1 : 0
    case 'neg': return countX(n.a)
    case 'bin': return countX(n.a) + countX(n.b)
    case 'call': return n.args.reduce((s, a) => s + countX(a), 0)
    case 'ucall': return 99
    default: return 0
  }
}

/** Nothing here but x, numbers and the constants: no y, no sliders, no named calls. */
function plain(n: N): boolean {
  switch (n.t) {
    case 'num': case 'const': return true
    case 'var': return n.name === 'x'
    case 'param': case 'ucall': return false
    case 'neg': return plain(n.a)
    case 'bin': return plain(n.a) && plain(n.b)
    case 'call': return n.args.every(plain)
  }
  return false
}

/** Compiled f from a node, via the parser's own compiler (one closure). */
function compiled(src: string): ((x: number) => number) | null {
  const c = compileExpr(src)
  if (!c.ok) return null
  if (c.expr.vars.some((v) => v !== 'x') || c.expr.paramNames.length > 0) return null
  const ev = c.expr.ev
  return (x: number) => {
    let v: number
    try { v = ev([], x, Number.NaN) } catch { return Number.NaN }
    return typeof v === 'number' ? v : Number.NaN
  }
}

// ============================================================================
// The restriction: sample points, and the values of a sub-expression on it
// ============================================================================

/** Points spread over the restriction (or a default window), interior first. */
function samplePoints(R: IntervalPart | null): number[] {
  const out: number[] = []
  if (!R || (!Number.isFinite(R.lo) && !Number.isFinite(R.hi))) {
    for (let i = 0; i < 25; i++) out.push(-4.8 + 0.4 * i + 0.0137)
    return out
  }
  const { lo, hi } = R
  if (Number.isFinite(lo) && Number.isFinite(hi)) {
    for (let i = 0; i <= 12; i++) out.push(lo + (hi - lo) * (0.03 + (0.94 * i) / 12))
    return out
  }
  const steps = [0.013, 0.1, 0.3, 0.7, 1.1, 1.7, 2.6, 3.9, 5.3, 7.7, 11.3, 17.9, 29.3]
  if (Number.isFinite(lo)) for (const s of steps) out.push(lo + s * Math.max(1, Math.abs(lo) * 0.1))
  else for (const s of steps) out.push(hi - s * Math.max(1, Math.abs(hi) * 0.1))
  return out
}

interface Ctx {
  R: IntervalPart | null
  xs: number[]
  /** set when the solve picked a branch */
  branch: 'principal' | 'restriction' | null
}

/** The values of a sub-expression u(x) over the restriction: min, max (NaN-free). */
function uRange(u: N, ctx: Ctx): { min: number; max: number } | null {
  if (!ctx.R) return null
  const src = printSource(u)
  const g = compiled(src)
  if (!g) return null
  const pts = ctx.xs.slice()
  // the ends too (a closed end, or the limit at an open one)
  for (const e of [ctx.R.lo, ctx.R.hi]) if (Number.isFinite(e)) pts.push(e)
  let min = Infinity, max = -Infinity
  for (const x of pts) {
    const v = g(x)
    if (!Number.isFinite(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!Number.isFinite(ctx.R.lo) || !Number.isFinite(ctx.R.hi)) {
    // an unbounded restriction: the trig branches need u bounded
    if (!(max - min < 1e6)) return { min: -Infinity, max: Infinity }
    // probe far out: u that runs away is unbounded
    const far = Number.isFinite(ctx.R.lo) ? ctx.R.lo + 1e6 : ctx.R.hi - 1e6
    const vf = g(far)
    if (Number.isFinite(vf) && Math.abs(vf) > 1e3 * (1 + Math.abs(max) + Math.abs(min))) {
      return { min: Math.min(min, vf), max: Math.max(max, vf) }
    }
  }
  return max >= min ? { min, max } : null
}

/** The sign u keeps on the restriction: 1, −1, or 0 when it changes sign. */
function uSign(u: N, ctx: Ctx): 1 | -1 | 0 {
  const r = uRange(u, ctx)
  if (!r) return 0
  const tol = 1e-12 * Math.max(1, Math.abs(r.min), Math.abs(r.max))
  if (r.min >= -tol && r.max > tol) return 1
  if (r.max <= tol && r.min < -tol) return -1
  return 0
}

// ============================================================================
// Solving
// ============================================================================

/** k·π as a node (π, 2π, −π, …). */
function kPi(k: number): N {
  if (k === 0) return numNode(0)
  const body = Math.abs(k) === 1 ? PI : ({ t: 'bin', op: '*', a: numNode(Math.abs(k)), b: PI } as N)
  return k < 0 ? neg(body) : body
}

/** x such that n(x) = T, or null. */
function unwind(n: N, T: N, ctx: Ctx): N | null {
  if (n.t === 'var' && n.name === 'x') return T
  if (!containsX(n)) return null
  if (countX(n) > 1) return solveShape(n, T, ctx)
  switch (n.t) {
    case 'neg': return unwind(n.a, neg(T), ctx)
    case 'bin': {
      const inA = containsX(n.a)
      const u = inA ? n.a : n.b
      const c = inA ? n.b : n.a
      switch (n.op) {
        case '+': return unwind(u, subC(T, c), ctx)
        case '-': return inA ? unwind(u, addC(T, c), ctx) : unwind(u, cMinus(c, T), ctx)
        case '*': {
          if (isZero(c)) return null
          const d = divC(T, c)
          return d ? unwind(u, d, ctx) : null
        }
        case '/':
          if (inA) return unwind(u, mulC(T, c), ctx)
          if (isZero(c)) return null
          return unwind(u, cDiv(c, T), ctx)
        case '^':
          return inA ? unwindPower(u, c, T, ctx) : unwindExp(c, u, T, ctx)
      }
      return null
    }
    case 'call': return unwindCall(n.fn, n.args, T, ctx)
  }
  return null
}

/** u^e = T. */
function unwindPower(u: N, e: N, T: N, ctx: Ctx): N | null {
  const r = ratOf(e)
  if (!r) {
    // an irrational constant power: u = T^(1/e), u ≥ 0 as the parser reads it
    return unwind(u, pow(T, cDiv(numNode(1), e)), ctx)
  }
  if (r.p === 0) return null
  if (r.q === 1) {
    const n = r.p
    const an = Math.abs(n)
    const base = n < 0 ? cDiv(numNode(1), T) : T // u^(−n) = T ⇔ u^n = 1/T
    if (an === 1) return unwind(u, base, ctx)
    const root = an === 2 ? call('sqrt', base) : an === 3 ? call('cbrt', base) : pow(base, ratNode(rat(1, an)!))
    if (an % 2 === 1) return unwind(u, root, ctx)
    // an even power: which root depends on the sign of u on the restriction
    const s = uSign(u, ctx)
    if (s === 0) return null
    ctx.branch = ctx.branch ?? 'restriction'
    return unwind(u, s > 0 ? root : neg(root), ctx)
  }
  // u^(p/q) = T  ⇒  u = T^(q/p)
  const inv = rDiv(rat(1)!, r)
  if (!inv) return null
  if (inv.q === 1) {
    const k = inv.p
    if (k === 1) return unwind(u, T, ctx)
    const body = k < 0 ? cDiv(numNode(1), T) : T
    return unwind(u, Math.abs(k) === 1 ? body : pow(body, numNode(Math.abs(k))), ctx)
  }
  if (inv.p === 1 && inv.q === 3) return unwind(u, call('cbrt', T), ctx)
  if (inv.p === 1 && inv.q === 2) return unwind(u, call('sqrt', T), ctx)
  return unwind(u, pow(T, ratNode(inv)), ctx)
}

/** b^u = T for a constant base b. */
function unwindExp(b: N, u: N, T: N, ctx: Ctx): N | null {
  const bv = constValue(b)
  if (!(bv > 0) || bv === 1) return null
  if (b.t === 'const' && b.name === 'e') return unwind(u, call('ln', T), ctx)
  if (isNum(b, 10)) return unwind(u, call('log', T), ctx)
  return unwind(u, call('log_', b, T), ctx)
}

function constValue(n: N): number {
  const g = compiled(printSource(n))
  return g ? g(0) : Number.NaN
}

function unwindCall(fn: string, args: N[], T: N, ctx: Ctx): N | null {
  if (fn === 'log_') {
    if (containsX(args[0])) return null
    return unwind(args[1], pow(args[0], T), ctx)
  }
  if (args.length !== 1) return null
  const u = args[0]
  switch (fn) {
    case 'sqrt': return unwind(u, pow(T, numNode(2)), ctx)
    case 'cbrt': return unwind(u, pow(T, numNode(3)), ctx)
    case 'ln': return unwind(u, pow(E, T), ctx)
    case 'exp': return unwind(u, call('ln', T), ctx)
    case 'log': case 'log10': return unwind(u, pow(numNode(10), T), ctx)
    case 'log2': return unwind(u, pow(numNode(2), T), ctx)
    case 'asin': return unwind(u, call('sin', T), ctx)
    case 'acos': return unwind(u, call('cos', T), ctx)
    case 'atan': return unwind(u, call('tan', T), ctx)
    case 'abs': {
      const s = uSign(u, ctx)
      if (s === 0) return null
      ctx.branch = ctx.branch ?? 'restriction'
      return unwind(u, s > 0 ? T : neg(T), ctx)
    }
    case 'sinh':
      // u = ln(T + √(T² + 1))
      return unwind(u, call('ln', addC(T, call('sqrt', addC(pow(T, numNode(2)), numNode(1))))), ctx)
    case 'tanh':
      // u = ln((1 + T)/(1 − T))/2
      return unwind(u, mulR(call('ln', { t: 'bin', op: '/', a: addC(T, numNode(1)), b: cMinus(numNode(1), T) }), rat(1, 2)!), ctx)
    case 'cosh': {
      const s = uSign(u, ctx)
      if (s === 0) return null
      ctx.branch = ctx.branch ?? 'restriction'
      const w = call('ln', addC(T, call('sqrt', subC(pow(T, numNode(2)), numNode(1)))))
      return unwind(u, s > 0 ? w : neg(w), ctx)
    }
    case 'sin': case 'csc': return trigBranch('sin', fn === 'csc' ? cDiv(numNode(1), T) : T, u, ctx)
    case 'cos': case 'sec': return trigBranch('cos', fn === 'sec' ? cDiv(numNode(1), T) : T, u, ctx)
    case 'tan': return trigBranch('tan', T, u, ctx)
    case 'cot': return trigBranch('cot', T, u, ctx)
  }
  return null
}

/**
 * The branch of sin/cos/tan/cot the restriction puts u on, and u there.
 *   sin on [kπ − π/2, kπ + π/2]:  u = kπ + (−1)^k arcsin T
 *   cos on [jπ, (j+1)π]:          u = jπ + arccos T (j even), (j+1)π − arccos T (j odd)
 *   tan on (kπ − π/2, kπ + π/2):  u = kπ + arctan T
 *   cot on (kπ, (k+1)π):          u = kπ + π/2 − arctan T
 */
function trigBranch(kind: 'sin' | 'cos' | 'tan' | 'cot', T: N, u: N, ctx: Ctx): N | null {
  const r = uRange(u, ctx)
  if (!r || !Number.isFinite(r.min) || !Number.isFinite(r.max)) return null
  const tol = 1e-9 * Math.max(1, Math.abs(r.min), Math.abs(r.max))
  const mid = 0.5 * (r.min + r.max)
  const inside = (a: number, b: number) => r.min >= a - tol && r.max <= b + tol
  let sol: N
  let k = 0
  switch (kind) {
    case 'sin': {
      k = Math.round(mid / Math.PI)
      if (!inside(k * Math.PI - Math.PI / 2, k * Math.PI + Math.PI / 2)) return null
      const a = call('asin', T)
      sol = k === 0 ? a : k % 2 === 0 ? { t: 'bin', op: '+', a: kPi(k), b: a } : { t: 'bin', op: '-', a: kPi(k), b: a }
      break
    }
    case 'cos': {
      k = Math.floor(mid / Math.PI)
      if (!inside(k * Math.PI, (k + 1) * Math.PI)) return null
      const a = call('acos', T)
      if (k % 2 === 0) sol = k === 0 ? a : { t: 'bin', op: '+', a: kPi(k), b: a }
      else sol = k + 1 === 0 ? neg(a) : { t: 'bin', op: '-', a: kPi(k + 1), b: a }
      break
    }
    case 'tan': {
      k = Math.round(mid / Math.PI)
      if (!inside(k * Math.PI - Math.PI / 2, k * Math.PI + Math.PI / 2)) return null
      const a = call('atan', T)
      sol = k === 0 ? a : { t: 'bin', op: '+', a: kPi(k), b: a }
      break
    }
    case 'cot': {
      k = Math.floor(mid / Math.PI)
      if (!inside(k * Math.PI, (k + 1) * Math.PI)) return null
      const half: N = { t: 'bin', op: '/', a: PI, b: numNode(2) }
      const base: N = k === 0 ? half : { t: 'bin', op: '+', a: kPi(k), b: half }
      sol = { t: 'bin', op: '-', a: base, b: call('atan', T) }
      break
    }
  }
  ctx.branch = k === 0 && kind !== 'cot' && ctx.branch === null ? 'principal' : 'restriction'
  return unwind(u, sol, ctx)
}

// ---- x more than once: a polynomial or a ratio of polynomials --------------

/** Coefficients, ascending, of a polynomial in x (degree ≤ 4), or null. */
type Poly = number[]
const pAdd = (a: Poly, b: Poly): Poly => {
  const out = new Array(Math.max(a.length, b.length)).fill(0)
  a.forEach((v, i) => (out[i] += v)); b.forEach((v, i) => (out[i] += v))
  return out
}
const pScale = (a: Poly, k: number): Poly => a.map((v) => v * k)
const pMul = (a: Poly, b: Poly): Poly => {
  const out = new Array(a.length + b.length - 1).fill(0)
  a.forEach((u, i) => b.forEach((v, j) => (out[i + j] += u * v)))
  return out
}
const deg = (a: Poly): number => {
  let d = a.length - 1
  while (d > 0 && Math.abs(a[d]) <= 1e-14 * Math.max(1, ...a.map(Math.abs))) d--
  return d
}

/** n as N(x)/D(x) with polynomials N, D, or null. */
function ratFn(n: N): { N: Poly; D: Poly } | null {
  if (!containsX(n)) {
    const v = constValue(n)
    return Number.isFinite(v) ? { N: [v], D: [1] } : null
  }
  switch (n.t) {
    case 'var': return n.name === 'x' ? { N: [0, 1], D: [1] } : null
    case 'neg': { const a = ratFn(n.a); return a ? { N: pScale(a.N, -1), D: a.D } : null }
    case 'bin': {
      if (n.op === '^') {
        const e = ratOf(n.b)
        if (!e || e.q !== 1 || e.p < 0 || e.p > 4) return null
        const a = ratFn(n.a)
        if (!a) return null
        let N: Poly = [1], D: Poly = [1]
        for (let i = 0; i < e.p; i++) { N = pMul(N, a.N); D = pMul(D, a.D) }
        return { N, D }
      }
      const a = ratFn(n.a), b = ratFn(n.b)
      if (!a || !b) return null
      let out: { N: Poly; D: Poly }
      switch (n.op) {
        case '+': out = { N: pAdd(pMul(a.N, b.D), pMul(b.N, a.D)), D: pMul(a.D, b.D) }; break
        case '-': out = { N: pAdd(pMul(a.N, b.D), pScale(pMul(b.N, a.D), -1)), D: pMul(a.D, b.D) }; break
        case '*': out = { N: pMul(a.N, b.N), D: pMul(a.D, b.D) }; break
        case '/': out = { N: pMul(a.N, b.D), D: pMul(a.D, b.N) }; break
        default: return null
      }
      if (out.N.length > 6 || out.D.length > 6) return null
      return out
    }
    default: return null
  }
}

/** Divide out a common constant so D's leading coefficient is 1 when D is constant. */
function trimmed(p: Poly): Poly {
  return p.slice(0, deg(p) + 1)
}

/** x more than once: the quadratic and the linear-fractional a textbook uses. */
function solveShape(n: N, T: N, ctx: Ctx): N | null {
  const rf = ratFn(n)
  if (!rf) return null
  let Np = trimmed(rf.N)
  let Dp = trimmed(rf.D)
  // a common linear factor (x(x+1)/x) is not a shape a lesson inverts
  if (Dp.length === 1) {
    Np = pScale(Np, 1 / Dp[0])
    Dp = [1]
    const d = Np.length - 1
    if (d === 1) {
      // b·x + a = T  ⇒  x = (T − a)/b
      const [a, b] = Np
      const q = divC(subC(T, valueNode(a)), valueNode(b))
      return q ? unwind(X, q, ctx) : null
    }
    if (d === 2) return solveQuadratic(Np, T, ctx)
    return null
  }
  if (Dp.length === 2 && Np.length <= 2) {
    const a = Np[1] ?? 0, b = Np[0], c = Dp[1], d = Dp[0]
    if (Math.abs(a * d - b * c) <= 1e-12 * Math.max(1, Math.abs(a * d), Math.abs(b * c))) return null
    // x = (d·T − b)/(a − c·T), signs arranged so T's coefficient below is positive
    let numA = -d, numB = b, denA = c, denB = -a // (−dT + b)/(cT − a)
    if (c < 0) { numA = d; numB = -b; denA = -c; denB = a }
    const num = lin(numA, T, numB)
    const den = lin(denA, T, denB)
    return { t: 'bin', op: '/', a: num, b: den }
  }
  return null
}

/** k·T + m, tidy. */
function lin(k: number, T: N, m: number): N {
  const kr = ratOfValue(k)
  const kt = kr ? mulR(T, kr) : ({ t: 'bin', op: '*', a: valueNode(k), b: T } as N)
  if (k === 0) return valueNode(m)
  return addC(kt, valueNode(m))
}

/** a x² + b x + c = T on the restriction's side of the vertex. */
function solveQuadratic(p: Poly, T: N, ctx: Ctx): N | null {
  const [c, b, a] = p
  if (!ctx.R || a === 0) return null
  const h = -b / (2 * a)
  const k = c - (b * b) / (4 * a)
  const pts = ctx.xs.concat([ctx.R.lo, ctx.R.hi].filter(Number.isFinite))
  const tol = 1e-9 * Math.max(1, Math.abs(h))
  let side = 0
  if (pts.every((x) => x >= h - tol)) side = 1
  else if (pts.every((x) => x <= h + tol)) side = -1
  if (side === 0) return null
  ctx.branch = 'restriction'
  // √((T − k)/a), with the sign of a folded in
  const ar = ratOfValue(a)
  const kN = valueNode(k)
  let inner: N
  if (ar && ar.p > 0) inner = mulR(subC(T, kN), rDiv(rat(1)!, ar)!)
  else if (ar && ar.p < 0) inner = mulR(cMinus(kN, T), rDiv(rat(1)!, rNeg(ar))!)
  else inner = { t: 'bin', op: '/', a: subC(T, kN), b: valueNode(a) }
  const root = call('sqrt', inner)
  const hN = valueNode(h)
  if (side > 0) return isZero(hN) ? root : addC(root, hN)
  return isZero(hN) ? neg(root) : cMinus(hN, root)
}

// ============================================================================
// Printing — source (the parser's tokens), Unicode text
// ============================================================================

const prec = (n: N): number => {
  switch (n.t) {
    case 'bin':
      return n.op === '+' || n.op === '-' ? 1 : n.op === '^' ? 3 : 2
    case 'neg': return 1.5
    case 'num': return 4
    default: return 4
  }
}

const isAtomSrc = (n: N) => n.t === 'var' || n.t === 'const' || n.t === 'call' || (n.t === 'num' && n.v >= 0)

function wrapIf(s: string, cond: boolean): string {
  return cond ? `(${s})` : s
}

/** Significant digits a fitted (decimal) constant is shown with, as the app prints fitted numbers. */
const SHOW_DIGITS = 4

/**
 * The same formula with every long decimal rounded for show (1.234567 →
 * 1.235); integers and fractions are untouched. A coefficient that rounds to
 * 1, or an added decimal smaller than 0.00005, drops out.
 */
function rounded(n: N): N {
  switch (n.t) {
    case 'num': {
      if (!/[.eE]/.test(n.raw)) return n
      const v = Number(n.v.toPrecision(SHOW_DIGITS))
      return { t: 'num', v, raw: String(v) }
    }
    case 'neg': return { t: 'neg', a: rounded(n.a) }
    case 'call': return { t: 'call', fn: n.fn, args: n.args.map(rounded) }
    case 'bin': {
      const a = rounded(n.a), b = rounded(n.b)
      // a fitted additive constant below the 4th decimal place is fitting
      // noise on the board's scale (x − 0.000005047): it drops out
      if ((n.op === '+' || n.op === '-') && b.t === 'num' && (b.v === 0 || (/[.eE]/.test(b.raw) && Math.abs(b.v) < 5e-5))) return a
      if (n.op === '*' && a.t === 'num' && a.v === 1) return b
      if (n.op === '/' && b.t === 'num' && b.v === 1) return a
      return { t: 'bin', op: n.op, a, b }
    }
    default: return n
  }
}

/** The formula in the parser's own spelling. */
export function printSource(n: N): string {
  switch (n.t) {
    case 'num': return n.raw
    case 'const': return n.name
    case 'var': return n.name
    case 'param': return n.name
    case 'neg': return `-${wrapIf(printSource(n.a), n.a.t === 'bin' && (n.a.op === '+' || n.a.op === '-') || n.a.t === 'neg')}`
    case 'ucall': return `${n.name}(${printSource(n.arg)})`
    case 'call': {
      if (n.fn === 'log_') {
        const b = n.args[0]
        const base = b.t === 'num' && Number.isInteger(b.v) && b.v > 0 ? b.raw : b.t === 'const' ? b.name : `(${printSource(b)})`
        return `log_${base}(${printSource(n.args[1])})`
      }
      return `${n.fn}(${n.args.map(printSource).join(', ')})`
    }
    case 'bin': {
      const a = n.a, b = n.b
      switch (n.op) {
        case '+':
          if (b.t === 'neg') return `${printSource(a)} - ${wrapIf(printSource(b.a), prec(b.a) <= 1)}`
          return `${printSource(a)} + ${printSource(b)}`
        case '-':
          return `${printSource(a)} - ${wrapIf(printSource(b), prec(b) <= 1.5)}`
        case '*': {
          const ls = wrapIf(printSource(a), prec(a) < 2)
          const rs = wrapIf(printSource(b), prec(b) < 2 || b.t === 'neg')
          // a number in front of a letter or a bracket is written the way a
          // teacher types it: 3x, 2pi, 3(x - 1), 3sqrt(x) — never before e
          if (a.t === 'num' && /^[a-df-zA-Z(]/.test(rs)) return `${ls}${rs}`
          return `${ls}*${rs}`
        }
        case '/': {
          const ls = wrapIf(printSource(a), prec(a) < 2)
          const rs = wrapIf(printSource(b), !(isAtomSrc(b) || (b.t === 'bin' && b.op === '^')))
          return `${ls}/${rs}`
        }
        case '^': {
          const ls = wrapIf(printSource(a), !isAtomSrc(a) || (a.t === 'num' && a.raw.includes('.')))
          const rs = wrapIf(printSource(b), !isAtomSrc(b))
          return `${ls}^${rs}`
        }
      }
    }
  }
  return ''
}

const SUP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '-': '⁻', x: 'ˣ',
}
const SUB: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
}
const TEXT_FN: Record<string, string> = { asin: 'arcsin', acos: 'arccos', atan: 'arctan' }

const MINUS = '−'

/** The formula as a card prints it: √(x − 2) + 1, log₂(x) + 1, π − arcsin(x). */
export function printText(n: N): string {
  switch (n.t) {
    case 'num': return n.raw.replace('-', MINUS)
    case 'const': return n.name === 'pi' ? 'π' : n.name === 'tau' ? 'τ' : n.name
    case 'var': return n.name
    case 'param': return n.name
    case 'neg': return `${MINUS}${wrapIf(printText(n.a), n.a.t === 'bin' && (n.a.op === '+' || n.a.op === '-') || n.a.t === 'neg')}`
    case 'ucall': return `${n.name}(${printText(n.arg)})`
    case 'call': {
      const arg = n.args[n.args.length - 1]
      const inner = printText(arg)
      switch (n.fn) {
        case 'sqrt': return isAtomSrc(arg) && arg.t !== 'call' ? `√${inner}` : `√(${inner})`
        case 'cbrt': return isAtomSrc(arg) && arg.t !== 'call' ? `∛${inner}` : `∛(${inner})`
        case 'abs': return `|${inner}|`
        case 'log_': {
          const b = n.args[0]
          const bs = printText(b)
          const sub = /^\d+$/.test(bs) ? [...bs].map((c) => SUB[c]).join('') : `_(${bs})`
          return `log${sub}(${inner})`
        }
        case 'log2': return `log₂(${inner})`
        case 'log10': return `log₁₀(${inner})`
        default: return `${TEXT_FN[n.fn] ?? n.fn}(${n.args.map(printText).join(', ')})`
      }
    }
    case 'bin': {
      const a = n.a, b = n.b
      switch (n.op) {
        case '+':
          if (b.t === 'neg') return `${printText(a)} ${MINUS} ${wrapIf(printText(b.a), prec(b.a) <= 1)}`
          return `${printText(a)} + ${printText(b)}`
        case '-':
          return `${printText(a)} ${MINUS} ${wrapIf(printText(b), prec(b) <= 1.5)}`
        case '*': {
          const ls = wrapIf(printText(a), prec(a) < 2)
          const rs = wrapIf(printText(b), prec(b) < 2 || b.t === 'neg')
          if (a.t === 'num' && !/^[0-9.]/.test(rs)) return `${ls}${rs}`
          return `${ls}·${rs}`
        }
        case '/': {
          const ls = wrapIf(printText(a), prec(a) < 2)
          const rs = wrapIf(printText(b), !(isAtomSrc(b) || (b.t === 'bin' && b.op === '^')))
          return `${ls}/${rs}`
        }
        case '^': {
          const ls = wrapIf(printText(a), !isAtomSrc(a) || (a.t === 'num' && a.raw.includes('.')))
          const es = printSource(b)
          if (/^-?\d+$|^x$/.test(es)) return `${ls}${[...es].map((c) => SUP[c]).join('')}`
          return `${ls}^${wrapIf(printText(b), !isAtomSrc(b))}`
        }
      }
    }
  }
  return ''
}

// ============================================================================
// Entry point
// ============================================================================

/** The body of the line (the formula of x), and a restriction typed into it. */
function readLine(src: string): { body: N; bodyText: string; typedRestriction: IntervalPart | null } | null {
  const text = (src ?? '').trim()
  if (text === '') return null
  let exprText = text
  let typedRestriction: IntervalPart | null = null
  const pw = piecewiseParts(text)
  if (pw) {
    if (!pw.restricted || pw.branches.length !== 1) return null
    exprText = pw.head ? `${pw.head} = ${pw.branches[0].expr}` : pw.branches[0].expr
    // the restriction as typed, read by the parser's own pieces
    const parsed = parseExpression(text)
    if (parsed.ok) {
      let pieces: unknown = null
      try { pieces = parsed.plot.makeModel('inverse-probe').pieces?.(parsed.plot.defaultParams) } catch { pieces = null }
      if (Array.isArray(pieces) && pieces.length === 1) {
        const q = pieces[0] as { lo: number; hi: number; loClosed: boolean; hiClosed: boolean }
        typedRestriction = { lo: q.lo, hi: q.hi, loClosed: q.loClosed, hiClosed: q.hiClosed, loExact: null, hiExact: null }
      }
    }
  }
  const ast = parseAst(exprText)
  if (!ast.ok) return null
  let body: N | null = null
  const { lhs, rhs } = ast
  let bodyText = exprText
  const eq = exprText.indexOf('=')
  if (rhs === null) body = lhs
  else if (lhs.t === 'var' && lhs.name === 'y') { body = rhs; bodyText = exprText.slice(eq + 1) }
  else if (lhs.t === 'bin' && lhs.op === '*' && lhs.a.t === 'param' && lhs.b.t === 'var' && lhs.b.name === 'x') {
    body = rhs
    bodyText = exprText.slice(eq + 1)
  } else if (rhs.t === 'var' && rhs.name === 'y') { body = lhs; bodyText = exprText.slice(0, eq) }
  if (!body || !plain(body) || !containsX(body)) return null
  return { body, bodyText, typedRestriction }
}

/**
 * f⁻¹ as an equation, or null (see the header). `src` is the curve's typed
 * line ("y = …" or "f(x) = …"; a sketched family's equation text works too),
 * `restriction` the stretch being inverted, `name` the curve's letter for
 * the head ("f" → f⁻¹(x)).
 */
export function invertFormula(
  src: string,
  restriction: IntervalPart | null,
  name = 'f',
): InverseFormula | null {
  try {
    const line = readLine(src)
    if (!line) return null
    const R = restriction ?? line.typedRestriction
    const f = compiled(line.bodyText)
    if (!f) return null
    const ctx: Ctx = { R, xs: samplePoints(R), branch: null }
    const inv = unwind(line.body, X, ctx)
    if (!inv || !plain(inv)) return null

    // verified at full precision; shown with fitted constants rounded
    const g = compiled(printSource(inv))
    if (!g) return null
    if (!verified(f, g, R)) return null
    const shown = rounded(inv)
    const source = `y = ${printSource(shown)}`

    const parsed = parseExpression(source)
    if (!parsed.ok) return null
    const tex = bracketFracPowers(parsed.plot.latex.replace(/^\s*y\s*=\s*/, ''))
    const head = name || 'f'
    let branch: string | null = null
    if (ctx.branch === 'principal') branch = 'principal branch'
    else if (ctx.branch === 'restriction' && R) branch = `the branch ${describeSet([withExactEnds(R)], 'x').builder}`
    return {
      latex: `${head}^{-1}(x) = ${tex}`,
      text: `${head}⁻¹(x) = ${printText(shown)}`,
      source,
      branch,
    }
  } catch {
    return null
  }
}

/**
 * \frac{a}{b}^{2} reads as if only b were squared: bracket the fraction,
 * \left(\frac{a}{b}\right)^{2}. (The parser's LaTeX leaves \frac bare as a
 * base because it is self-delimiting as a factor; as a base it is not.)
 */
function bracketFracPowers(tex: string): string {
  let out = ''
  let i = 0
  while (i < tex.length) {
    if (tex.startsWith('\\frac{', i)) {
      const a = groupEnd(tex, i + 5)
      const b = a >= 0 && tex[a + 1] === '{' ? groupEnd(tex, a + 1) : -1
      if (b >= 0 && tex[b + 1] === '^') {
        out += `\\left(${bracketFracPowers(tex.slice(i, b + 1))}\\right)`
        i = b + 1
        continue
      }
    }
    out += tex[i]
    i++
  }
  return out
}

/** Index of the '}' closing the '{' at `i`, or −1. */
function groupEnd(s: string, i: number): number {
  if (s[i] !== '{') return -1
  let depth = 0
  for (let k = i; k < s.length; k++) {
    if (s[k] === '{') depth++
    else if (s[k] === '}') { depth--; if (depth === 0) return k }
  }
  return -1
}

/** f(g(y)) = y over f's values on the restriction, and g(f(x)) = x there. */
function verified(f: (x: number) => number, g: (x: number) => number, R: IntervalPart | null): boolean {
  let pts = samplePoints(R)
  let good = 0
  const check = (xs: number[]): boolean => {
    for (const x of xs) {
      if (R && !inside(R, x)) continue
      const y = f(x)
      if (!Number.isFinite(y)) continue
      const gy = g(y)
      if (!Number.isFinite(gy)) return false
      const fgy = f(gy)
      if (!Number.isFinite(fgy)) return false
      if (Math.abs(fgy - y) > 1e-9 * Math.max(1, Math.abs(y))) return false
      if (Math.abs(gy - x) > 1e-7 * Math.max(1, Math.abs(x))) return false
      good++
    }
    return true
  }
  if (!check(pts)) return false
  if (good < 5 && !R) {
    // a formula that lives far from 0 (ln(x − 50)): look further right and left
    pts = []
    for (let i = 1; i <= 24; i++) pts.push(Math.pow(1.6, i) + 0.0137, -Math.pow(1.6, i) - 0.0137)
    if (!check(pts)) return false
  }
  return good >= 5
}

/** A restriction's ends as closed forms where they are ones (π/2, not 1.571). */
function withExactEnds(R: IntervalPart): IntervalPart {
  const ex = (v: number) => (Number.isFinite(v) ? exactForm(v) : null)
  return { ...R, loExact: R.loExact ?? ex(R.lo), hiExact: R.hiExact ?? ex(R.hi) }
}

function inside(R: IntervalPart, x: number): boolean {
  return (x > R.lo || (R.loClosed && x === R.lo)) && (x < R.hi || (R.hiClosed && x === R.hi))
}

// ============================================================================
// src/core/endLimit.ts — a one-sided limit read off the FORMULA, not samples.
//
//   export function formulaLimit(node, params, e, side): EndLimit | null
//
// The limit of a typed formula as x → e from one side (side +1: from the
// right, x → e⁺; −1: from the left), by the limit laws applied to its parse
// tree: a continuous function of a finite limit is its value there; a
// quotient of a nonzero finite limit by an infinite one is 0, with a sign;
// ln of something arriving at 0 from above is −∞; e^(−∞) is 0⁺. It answers
// only where the laws decide the case — an indeterminate form (0/0, ∞ − ∞,
// 0·∞), a step function, a named call or anything else unfamiliar is null,
// and the caller reads the end numerically as before.
//
// Why: some ends converge too slowly for any ladder of samples. (e²ˣ − 1)/
// ln(1 + x) as x → −1⁺ is (e⁻² − 1)/(−∞) = 0⁺, but it gets there like
// 1/ln h: 0.12, 0.092, 0.074, … at h = 10⁻⁴, 10⁻⁵, 10⁻⁶, and an
// extrapolation of those "converges" to 0.0156. The tree says 0.
//
// A ZERO limit carries the side it is approached from (0⁺ / 0⁻) when that is
// needed — under a division, ln, √ — read by evaluating the subexpression
// just inside the end, at three distances that must agree in sign.
//
// Pure TypeScript, no DOM. Consumer: src/core/domainRange.ts (stretch ends).
// ============================================================================

import type { ExprNode } from './parse'
import { evalAstAt } from './parse'

/** A one-sided limit: a finite value, or ±∞. */
export type EndLimit = { kind: 'fin'; v: number } | { kind: 'inf'; sign: 1 | -1 }

type Lim = EndLimit | null

/**
 * A finite limit this close to 0 that is not exactly 0 is rounding as often
 * as it is a value (sin π is 1.2e−16): it may not be divided by, logged or
 * multiplied into ∞ — the laws stand aside and the samples decide.
 */
const TINY = 1e-10
const tiny = (v: number): boolean => v !== 0 && Math.abs(v) < TINY

const fin = (v: number): Lim => (Number.isFinite(v) ? { kind: 'fin', v } : null)
const inf = (sign: number): Lim => ({ kind: 'inf', sign: sign > 0 ? 1 : -1 })

const CONSTS: Record<string, number> = { pi: Math.PI, tau: 2 * Math.PI, e: Math.E }

/** Functions continuous on all of ℝ, and what they do at ±∞ (null: no limit). */
const WHOLE_LINE: Record<string, { f: (a: number) => number; atInf: (s: 1 | -1) => Lim }> = {
  exp: { f: Math.exp, atInf: (s) => (s > 0 ? inf(1) : fin(0)) },
  atan: { f: Math.atan, atInf: (s) => fin((s * Math.PI) / 2) },
  sinh: { f: Math.sinh, atInf: (s) => inf(s) },
  cosh: { f: Math.cosh, atInf: () => inf(1) },
  tanh: { f: Math.tanh, atInf: (s) => fin(s) },
  cbrt: { f: Math.cbrt, atInf: (s) => inf(s) },
  abs: { f: Math.abs, atInf: () => inf(1) },
  sin: { f: Math.sin, atInf: () => null },
  cos: { f: Math.cos, atInf: () => null },
}

/** Logarithms: continuous for a positive argument, −∞ at 0⁺, +∞ at +∞. */
const LOGS: Record<string, (a: number) => number> = {
  ln: Math.log,
  log: Math.log10,
  log10: Math.log10,
  log2: Math.log2,
}

/**
 * lim f(x) as x → e from `side`, by the limit laws over the formula's tree;
 * null when the laws do not decide it. `e` may be ±∞ (side is then the
 * inside, −sign(e)): 1/ln x → 0 as x → ∞, which no tail of samples reaches.
 */
export function formulaLimit(node: ExprNode, params: readonly number[], e: number, side: 1 | -1): EndLimit | null {
  if (Number.isNaN(e)) return null
  try {
    return lim(node, params, e, side, 0)
  } catch {
    return null
  }
}

/**
 * The side a subexpression with limit 0 arrives from: +1 (0⁺), −1 (0⁻), or
 * 0 when it is exactly 0 nearby or its sign is not settled.
 */
function zeroSide(node: ExprNode, params: readonly number[], e: number, side: 1 | -1): number {
  const s = Math.max(1, Math.abs(e))
  let got = 0
  for (const d of [1e-6, 1e-9, 1e-12]) {
    // at ±∞: far out instead, 10⁶, 10⁹, 10¹²
    const x = Number.isFinite(e) ? e + side * d * s : Math.sign(e) / d
    if (x === e) return 0
    const v = evalAstAt(node, params, x)
    if (!Number.isFinite(v) || v === 0) return 0
    const sg = v > 0 ? 1 : -1
    if (got !== 0 && sg !== got) return 0
    got = sg
  }
  return got
}

function lim(n: ExprNode, p: readonly number[], e: number, side: 1 | -1, depth: number): Lim {
  if (depth > 200) return null
  const sub = (m: ExprNode): Lim => lim(m, p, e, side, depth + 1)
  switch (n.t) {
    case 'num':
      return fin(n.v)
    case 'const':
      return fin(CONSTS[n.name] ?? Number.NaN)
    case 'param':
      return fin(p[n.i])
    case 'var':
      if (n.name === 'y') return null
      return Number.isFinite(e) ? fin(e) : inf(e)
    case 'neg': {
      const a = sub(n.a)
      if (!a) return null
      return a.kind === 'fin' ? fin(-a.v + 0) : inf(-a.sign)
    }
    case 'bin': {
      const a = sub(n.a)
      if (!a) return null
      const b = sub(n.b)
      if (!b) return null
      switch (n.op) {
        case '+':
        case '-': {
          const sb = n.op === '+' ? 1 : -1
          if (a.kind === 'fin' && b.kind === 'fin') return fin(a.v + sb * b.v)
          if (a.kind === 'inf' && b.kind === 'inf') return a.sign === sb * b.sign ? inf(a.sign) : null
          return a.kind === 'inf' ? inf(a.sign) : inf(sb * (b as { sign: number }).sign)
        }
        case '*': {
          if (a.kind === 'fin' && b.kind === 'fin') return fin(a.v * b.v)
          if (a.kind === 'inf' && b.kind === 'inf') return inf(a.sign * b.sign)
          const f = a.kind === 'fin' ? a.v : (b as { v: number }).v
          const s = a.kind === 'inf' ? a.sign : (b as { sign: number }).sign
          return f === 0 || tiny(f) ? null : inf(s * Math.sign(f))
        }
        case '/': {
          if (a.kind === 'inf' && b.kind === 'inf') return null
          if (b.kind === 'inf') {
            // anything finite over ±∞ is 0
            return a.kind === 'fin' ? fin(0) : null
          }
          if (tiny(b.v)) return null
          if (b.v !== 0) return a.kind === 'fin' ? fin(a.v / b.v) : inf(a.sign * Math.sign(b.v))
          // over something arriving at 0: ±∞ when the top is not 0 and the
          // bottom's side is settled
          if (a.kind === 'fin' && (a.v === 0 || tiny(a.v))) return null
          const zs = zeroSide(n.b, p, e, side)
          if (zs === 0) return null
          return inf((a.kind === 'fin' ? Math.sign(a.v) : a.sign) * zs)
        }
        case '^':
          return powLim(n, a, b, p, e, side)
      }
      return null
    }
    case 'call': {
      const args = n.args.map(sub)
      if (args.some((a) => a === null)) return null
      const a = args[0] as EndLimit
      const w = WHOLE_LINE[n.fn]
      if (w && n.args.length === 1) return a.kind === 'fin' ? fin(w.f(a.v)) : w.atInf(a.sign)
      const lg = LOGS[n.fn]
      if (lg && n.args.length === 1) {
        if (a.kind === 'inf') return a.sign > 0 ? inf(1) : null
        if (tiny(a.v)) return null
        if (a.v > 0) return fin(lg(a.v))
        if (a.v === 0 && zeroSide(n.args[0], p, e, side) > 0) return inf(-1)
        return null
      }
      if (n.fn === 'sqrt') {
        if (a.kind === 'inf') return a.sign > 0 ? inf(1) : null
        if (a.v > 0) return fin(Math.sqrt(a.v))
        if (a.v === 0 && zeroSide(n.args[0], p, e, side) > 0) return fin(0)
        return null
      }
      if (n.fn === 'asin' || n.fn === 'acos') {
        if (a.kind !== 'fin' || !(a.v > -1 && a.v < 1)) return null
        return fin(n.fn === 'asin' ? Math.asin(a.v) : Math.acos(a.v))
      }
      if (n.fn === 'tan' || n.fn === 'sec' || n.fn === 'csc' || n.fn === 'cot') {
        if (a.kind !== 'fin') return null
        // continuous where the denominator is clearly away from 0
        const c = Math.cos(a.v), s = Math.sin(a.v)
        const den = n.fn === 'tan' || n.fn === 'sec' ? c : s
        if (Math.abs(den) < 1e-6) return null
        const v = n.fn === 'tan' ? s / c : n.fn === 'sec' ? 1 / c : n.fn === 'csc' ? 1 / s : c / s
        return fin(v)
      }
      if ((n.fn === 'min' || n.fn === 'max') && n.args.length === 2) {
        const b = args[1] as EndLimit
        if (a.kind === 'fin' && b.kind === 'fin') return fin(n.fn === 'min' ? Math.min(a.v, b.v) : Math.max(a.v, b.v))
        return null
      }
      if (n.fn === 'log_' && n.args.length === 2) {
        const b = args[1] as EndLimit
        if (a.kind !== 'fin' || !(a.v > 0) || a.v === 1) return null
        if (b.kind === 'fin' && tiny(b.v)) return null
        const lnB = Math.log(a.v)
        if (b.kind === 'inf') return b.sign > 0 ? inf(Math.sign(lnB)) : null
        if (b.v > 0) return fin(Math.log(b.v) / lnB)
        if (b.v === 0 && zeroSide(n.args[1], p, e, side) > 0) return inf(-Math.sign(lnB))
        return null
      }
      // floor, ceil, sign, fact and anything else: not by the laws
      return null
    }
    default:
      // a named call (f(u)) is known only through its curve
      return null
  }
}

/** a^b, from the limits of a and b. */
function powLim(n: Extract<ExprNode, { t: 'bin' }>, a: EndLimit, b: EndLimit, p: readonly number[], e: number, side: 1 | -1): Lim {
  if (a.kind === 'fin' && b.kind === 'fin') {
    if (tiny(a.v) && b.v < 0) return null
    if (a.v > 0) return fin(Math.pow(a.v, b.v))
    if (a.v === 0) {
      if (b.v > 0) return fin(0)
      if (b.v < 0 && zeroSide(n.a, p, e, side) > 0) return inf(1)
      return null
    }
    // a negative base: an integer power only (the parser's odd roots aside)
    return Number.isInteger(b.v) ? fin(Math.pow(a.v, b.v)) : null
  }
  if (a.kind === 'inf') {
    if (b.kind !== 'fin') return a.sign > 0 ? (b.sign > 0 ? inf(1) : fin(0)) : null
    if (a.sign > 0) return b.v > 0 ? inf(1) : b.v < 0 ? fin(0) : null
    // (−∞)^k for an integer k
    if (!Number.isInteger(b.v) || b.v === 0) return null
    return b.v > 0 ? inf(b.v % 2 === 0 ? 1 : -1) : fin(0)
  }
  // a finite base to an infinite power
  if (b.kind !== 'inf' || !(a.v > 0) || a.v === 1) return null
  const grows = (a.v > 1) === (b.sign > 0)
  return grows ? inf(1) : fin(0)
}

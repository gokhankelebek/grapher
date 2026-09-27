// ============================================================================
// src/core/parse/jets.ts — Taylor-mode automatic differentiation over the
// parser's AST.
//
// A "jet" is the truncated Taylor series of a sub-expression at x = a:
// c[0…n], c[k] = u⁽ᵏ⁾(a)/k!. Constants are [v, 0, …], x is [a, 1, 0, …], and
// every operation has a standard O(n²) recurrence on coefficients (Griewank &
// Walther, "Evaluating Derivatives", ch. 13):
//
//   w = u ± v      w_k = u_k ± v_k
//   w = u · v      w_k = Σ_{j=0..k} u_j v_{k−j}
//   w = u / v      w_k = (u_k − Σ_{j=1..k} v_j w_{k−j}) / v_0        (v_0 ≠ 0)
//   w = exp u      w_0 = e^{u_0},  k w_k = Σ_{j=1..k} j u_j w_{k−j}
//   w = ln u       w_0 = ln u_0,   w_k = (u_k − (1/k) Σ_{j=1..k−1} j w_j u_{k−j}) / u_0
//   s = sin u, c = cos u   k s_k =  Σ j u_j c_{k−j},  k c_k = −Σ j u_j s_{k−j}
//   w = u^r (real r, u_0 > 0 or r integer)
//                  w_0 = u_0^r,    w_k = (1/(k u_0)) Σ_{j=1..k} (r j − k + j) u_j w_{k−j}
//   tan, atan, asin, acos, sinh, cosh, tanh, sqrt, cbrt, log bases, sec/csc/cot
//   — each from the ones above (tan = sin/cos, atan' = u'/(1+u²) integrated
//   term by term, …).
//
// Non-analytic points answer null for the WHOLE jet: |u| where u_0 = 0,
// floor/ceil/sign where u_0 is an integer (resp. 0) — elsewhere they are
// locally constant, so their jet is [value, 0, …] — √u / ln u / u^r at
// u_0 ≤ 0 where the function is not analytic there, a denominator that
// vanishes to a higher order than its numerator (a pole), a non-finite
// coefficient among the n + 1, a named call (ucall), and any variable other
// than x.
//
// A REMOVABLE singularity is not null: where u and v both vanish, to orders
// ≥ m and m, (x − a)^m cancels — sin(x)/x at 0 is 1 − x²/6 + x⁴/120 − …,
// the BC classic, although the curve itself has a hole there. The walk runs
// PAD degrees past n so the m coefficients a cancellation costs come out of
// the padding (see Ctx.div).
//
// Owned by the core agent. See ModelSpec.taylor in ../types.ts.
// ============================================================================

import type { ExprNode } from './index'

type Jet = Float64Array

/**
 * "u_0 is zero to rounding": |u_0| within TINY of the size the next few
 * terms give u across a unit step (scaled by |a|, since a itself carries
 * rounding of relative size ε). sin(x) at the double nearest π has
 * u_0 ≈ 1.2e-16 with u_1 = −1 — a zero, not a tiny positive number whose log
 * is −36.7. A formula that is small but not a zero there (u_0 ≫ ε·u_1·|a|)
 * is unaffected.
 */
const TINY = 1e-12

/**
 * Extra degrees every walk carries past the n asked for, so that a
 * removable singularity — which costs its quotient m trailing coefficients —
 * still leaves n + 1 good ones. At most PAD orders may cancel.
 */
const PAD = 8

/** The jet machinery for one call: the working length L and the centre a. */
class Ctx {
  readonly L: number
  readonly a: number
  readonly params: readonly number[]
  constructor(L: number, a: number, params: readonly number[]) {
    this.L = L
    this.a = a
    this.params = params
  }

  zeros(): Jet {
    return new Float64Array(this.L)
  }

  constant(v: number): Jet {
    const w = this.zeros()
    w[0] = v
    return w
  }

  /** |u_0| is zero to rounding, measured against the terms that follow it. */
  nearZero(u: Jet, u0 = u[0]): boolean {
    if (u0 === 0) return true
    const rho = Math.max(1, Math.abs(this.a))
    let s = 0
    let r = 1
    const top = Math.min(this.L, 4)
    for (let k = 1; k < top; k++) {
      r *= rho
      const t = Math.abs(u[k]) * r
      if (t > s) s = t
    }
    return Math.abs(u0) <= TINY * s
  }

  add(u: Jet, v: Jet, sign = 1): Jet {
    const w = this.zeros()
    for (let k = 0; k < this.L; k++) w[k] = u[k] + sign * v[k]
    return w
  }

  scale(u: Jet, c: number): Jet {
    const w = this.zeros()
    for (let k = 0; k < this.L; k++) w[k] = u[k] * c
    return w
  }

  mul(u: Jet, v: Jet): Jet {
    const L = this.L
    const w = this.zeros()
    for (let k = 0; k < L; k++) {
      let s = 0
      for (let j = 0; j <= k; j++) s += u[j] * v[k - j]
      w[k] = s
    }
    return w
  }

  /**
   * How many leading coefficients of u are zero to rounding (each measured
   * against the next few, as nearZero measures u_0); stops at PAD + 1. A NaN
   * (a coefficient an earlier cancellation could not supply) is not a zero.
   */
  zeroOrder(u: Jet): number {
    const rho = Math.max(1, Math.abs(this.a))
    let m = 0
    while (m <= PAD && m < this.L - 1) {
      const um = u[m]
      if (Number.isNaN(um)) break
      if (um !== 0) {
        let s = 0
        let r = 1
        const top = Math.min(this.L, m + 4)
        for (let k = m + 1; k < top; k++) {
          r *= rho
          const t = Math.abs(u[k]) * r
          if (t > s) s = t
        }
        if (!(Math.abs(um) <= TINY * s)) break
      }
      m++
    }
    return m
  }

  /**
   * u / v. Where v vanishes at a to order m and u to at least that order —
   * sin(x)/x, (1 − cos x)/x², (eˣ − 1)/x at 0 — the common factor (x − a)^m
   * cancels: both jets shift down m places and divide. The quotient then
   * knows only L − m coefficients; the rest are NaN, which every recurrence
   * carries upward only (coefficient k reads coefficients ≤ k), so the
   * padding PAD absorbs it. u vanishing to lower order is a pole: null.
   */
  div(u: Jet, v: Jet): Jet | null {
    let m = 0
    if (this.nearZero(v)) {
      m = this.zeroOrder(v)
      if (m > PAD || m >= this.L) return null
      if (this.zeroOrder(u) < m) return null
    }
    const L = this.L
    const v0 = v[m]
    const w = this.zeros()
    for (let k = 0; k < L; k++) {
      if (k + m >= L) {
        w[k] = Number.NaN
        continue
      }
      let s = u[k + m]
      for (let j = 1; j <= k; j++) s -= v[j + m] * w[k - j]
      w[k] = s / v0
    }
    return w
  }

  exp(u: Jet, w0 = Math.exp(u[0])): Jet {
    const L = this.L
    const w = this.zeros()
    w[0] = w0
    for (let k = 1; k < L; k++) {
      let s = 0
      for (let j = 1; j <= k; j++) s += j * u[j] * w[k - j]
      w[k] = s / k
    }
    return w
  }

  /** ln u — analytic only where u_0 > 0. */
  log(u: Jet): Jet | null {
    const u0 = u[0]
    if (!(u0 > 0) || this.nearZero(u)) return null
    const L = this.L
    const w = this.zeros()
    w[0] = Math.log(u0)
    for (let k = 1; k < L; k++) {
      let s = 0
      for (let j = 1; j < k; j++) s += j * w[j] * u[k - j]
      w[k] = (u[k] - s / k) / u0
    }
    return w
  }

  /** [sin u, cos u] (hyperbolic: [sinh u, cosh u]). */
  sincos(u: Jet, hyperbolic = false): [Jet, Jet] {
    const L = this.L
    const s = this.zeros()
    const c = this.zeros()
    const u0 = u[0]
    s[0] = hyperbolic ? Math.sinh(u0) : Math.sin(u0)
    c[0] = hyperbolic ? Math.cosh(u0) : Math.cos(u0)
    const cs = hyperbolic ? 1 : -1
    for (let k = 1; k < L; k++) {
      let ss = 0
      let cc = 0
      for (let j = 1; j <= k; j++) {
        const ju = j * u[j]
        ss += ju * c[k - j]
        cc += ju * s[k - j]
      }
      s[k] = ss / k
      c[k] = (cs * cc) / k
    }
    return [s, c]
  }

  /** u^r for u_0 ≠ 0, w_0 given (the evaluator's value of u_0^r). */
  powReal(u: Jet, r: number, w0: number): Jet | null {
    if (!Number.isFinite(w0) || this.nearZero(u)) return null
    const L = this.L
    const u0 = u[0]
    const w = this.zeros()
    w[0] = w0
    for (let k = 1; k < L; k++) {
      let s = 0
      for (let j = 1; j <= k; j++) s += ((r + 1) * j - k) * u[j] * w[k - j]
      w[k] = s / (k * u0)
    }
    return w
  }

  /** u^m, m a non-negative integer: repeated squaring — exact at u_0 = 0. */
  powInt(u: Jet, m: number): Jet {
    let result = this.constant(1)
    let base = u
    let e = m
    let first = true
    while (e > 0) {
      if (e & 1) {
        result = first ? base : this.mul(result, base)
        first = false
      }
      e = Math.floor(e / 2)
      if (e > 0) base = this.mul(base, base)
    }
    return result
  }

  /** u′ as a jet (its last coefficient is unknown at this length: 0). */
  deriv(u: Jet): Jet {
    const L = this.L
    const w = this.zeros()
    for (let k = 0; k + 1 < L; k++) w[k] = (k + 1) * u[k + 1]
    return w
  }

  /** ∫ d from the given w0: w_k = d_{k−1}/k. */
  integ(d: Jet, w0: number): Jet {
    const L = this.L
    const w = this.zeros()
    w[0] = w0
    for (let k = 1; k < L; k++) w[k] = d[k - 1] / k
    return w
  }
}

const isConstJet = (u: Jet): boolean => {
  for (let k = 1; k < u.length; k++) if (u[k] !== 0) return false
  return true
}

function logBaseValue(b: number, u: number): number {
  if (b === 10) return Math.log10(u)
  if (b === 2) return Math.log2(u)
  return Math.log(u) / Math.log(b)
}

function walk(cx: Ctx, n: ExprNode): Jet | null {
  switch (n.t) {
    case 'num':
      return cx.constant(n.v)
    case 'const':
      return cx.constant(n.name === 'pi' ? Math.PI : n.name === 'tau' ? 2 * Math.PI : n.name === 'e' ? Math.E : Number.NaN)
    case 'var': {
      if (n.name !== 'x') return null
      const w = cx.constant(cx.a)
      if (cx.L > 1) w[1] = 1
      return w
    }
    case 'param': {
      const v = cx.params[n.i]
      return typeof v === 'number' ? cx.constant(v) : null
    }
    case 'neg': {
      const u = walk(cx, n.a)
      return u ? cx.scale(u, -1) : null
    }
    case 'bin':
      return binJet(cx, n.op, n.a, n.b)
    case 'call':
      return callJet(cx, n.fn, n.args)
    case 'ucall':
      return null
  }
  return null
}

function binJet(cx: Ctx, op: '+' | '-' | '*' | '/' | '^', A: ExprNode, B: ExprNode): Jet | null {
  if (op === '^' && A.t === 'const' && A.name === 'e') {
    // e^v: exp directly, not exp(v·ln e)
    const v = walk(cx, B)
    return v ? cx.exp(v) : null
  }
  const u = walk(cx, A)
  if (!u) return null
  const v = walk(cx, B)
  if (!v) return null
  switch (op) {
    case '+': return cx.add(u, v)
    case '-': return cx.add(u, v, -1)
    case '*': return cx.mul(u, v)
    case '/': return cx.div(u, v)
    case '^': return powJet(cx, u, v)
  }
  return null
}

function powJet(cx: Ctx, u: Jet, v: Jet): Jet | null {
  const u0 = u[0]
  if (isConstJet(v)) {
    const r = v[0]
    if (!Number.isFinite(r)) return null
    if (Number.isInteger(r) && Math.abs(r) <= 1e6) {
      if (r >= 0) return cx.powInt(u, r)
      if (cx.nearZero(u)) return null
      return cx.div(cx.constant(1), cx.powInt(u, -r))
    }
    // a real exponent: analytic only where the base is positive (the
    // evaluator's Math.pow is NaN for a negative base; 0 is a branch point)
    if (!(u0 > 0)) return null
    return cx.powReal(u, r, Math.pow(u0, r))
  }
  // u^v = exp(v ln u)
  const lu = cx.log(u)
  if (!lu) return null
  return cx.exp(cx.mul(v, lu), Math.pow(u0, v[0]))
}

function callJet(cx: Ctx, fn: string, args: ExprNode[]): Jet | null {
  if (fn === 'min' || fn === 'max' || fn === 'log_') {
    if (args.length !== 2) return null
    const p = walk(cx, args[0])
    if (!p) return null
    const q = walk(cx, args[1])
    if (!q) return null
    if (fn === 'log_') {
      // args are [base, u]
      const b = p
      const b0 = b[0]
      if (!(b0 > 0) || b0 === 1 || !Number.isFinite(b0)) return null
      const lu = cx.log(q)
      if (!lu) return null
      if (isConstJet(b)) {
        const w = cx.scale(lu, 1 / Math.log(b0))
        w[0] = logBaseValue(b0, q[0])
        return w
      }
      const lb = cx.log(b)
      return lb ? cx.div(lu, lb) : null
    }
    const d = cx.add(p, q, -1)
    if (cx.nearZero(d)) return null
    const pBigger = d[0] > 0
    return fn === 'max' ? (pBigger ? p : q) : (pBigger ? q : p)
  }
  if (args.length !== 1) return null
  const u = walk(cx, args[0])
  if (!u) return null
  const u0 = u[0]
  switch (fn) {
    case 'sin': return cx.sincos(u)[0]
    case 'cos': return cx.sincos(u)[1]
    case 'tan': {
      const [s, c] = cx.sincos(u)
      return cx.div(s, c)
    }
    case 'sec': return cx.div(cx.constant(1), cx.sincos(u)[1])
    case 'csc': return cx.div(cx.constant(1), cx.sincos(u)[0])
    case 'cot': {
      const [s, c] = cx.sincos(u)
      return cx.div(c, s)
    }
    case 'sinh': return cx.sincos(u, true)[0]
    case 'cosh': return cx.sincos(u, true)[1]
    case 'tanh': {
      const [s, c] = cx.sincos(u, true)
      return cx.div(s, c)
    }
    case 'atan': {
      // atan′ = u′/(1 + u²), integrated term by term
      const d = cx.div(cx.deriv(u), cx.add(cx.constant(1), cx.mul(u, u)))
      return d ? cx.integ(d, Math.atan(u0)) : null
    }
    case 'asin':
    case 'acos': {
      // ±u′/√(1 − u²): analytic only strictly inside (−1, 1)
      if (!(Math.abs(u0) < 1)) return null
      const q = cx.add(cx.constant(1), cx.mul(u, u), -1)
      const rq = cx.powReal(q, -0.5, 1 / Math.sqrt(q[0]))
      if (!rq) return null
      const d = cx.mul(cx.deriv(u), rq)
      return fn === 'asin' ? cx.integ(d, Math.asin(u0)) : cx.integ(cx.scale(d, -1), Math.acos(u0))
    }
    case 'sqrt':
      if (!(u0 > 0)) return null
      return cx.powReal(u, 0.5, Math.sqrt(u0))
    case 'cbrt':
      return cx.powReal(u, 1 / 3, Math.cbrt(u0))
    case 'abs':
      if (cx.nearZero(u)) return null
      return u0 > 0 ? u : cx.scale(u, -1)
    case 'ln': return cx.log(u)
    case 'log':
    case 'log10':
    case 'log2': {
      const lu = cx.log(u)
      if (!lu) return null
      const w = cx.scale(lu, fn === 'log2' ? 1 / Math.LN2 : 1 / Math.LN10)
      w[0] = fn === 'log2' ? Math.log2(u0) : Math.log10(u0)
      return w
    }
    case 'exp': return cx.exp(u)
    case 'floor':
    case 'ceil': {
      // locally constant off the integers; a step's edge is not analytic
      if (!Number.isFinite(u0) || cx.nearZero(u, u0 - Math.round(u0))) return null
      return cx.constant(fn === 'floor' ? Math.floor(u0) : Math.ceil(u0))
    }
    case 'sign':
      if (!Number.isFinite(u0) || cx.nearZero(u)) return null
      return cx.constant(Math.sign(u0))
  }
  return null
}

/**
 * The Taylor coefficients of `body` at x = a up to degree n (length n + 1),
 * or null where the formula is not analytic at a (see the header). `params`
 * are the slider values, indexed by the AST's param nodes.
 */
export function jetAt(
  body: ExprNode,
  params: readonly number[],
  a: number,
  n: number,
): number[] | null {
  if (!Number.isFinite(a) || !Number.isFinite(n) || n < 0) return null
  const deg = Math.floor(n)
  // work to degree ≥ 2 so a zero of a denominator is recognised as one even
  // when only the value is asked for (the near-zero test reads u_1, u_2),
  // plus PAD degrees for removable singularities to cancel into
  const L = Math.max(deg, 2) + 1 + PAD
  const w = walk(new Ctx(L, a, params), body)
  if (!w) return null
  const out = new Array<number>(deg + 1)
  for (let k = 0; k <= deg; k++) {
    const c = w[k]
    if (!Number.isFinite(c)) return null
    out[k] = c
  }
  return out
}

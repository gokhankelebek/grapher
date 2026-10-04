// ============================================================================
// src/core/growth.ts — what a typed formula IS, read off its AST instead of
// guessed from samples.
//
// A table only samples f, and a sample can lie: |x| on 1, 2, 3, … has a
// constant Δy, and 1.001ˣ is below x for every x up to 9 000. So the claims a
// card makes about f ITSELF are certified structurally here:
//
//   polyDegree(f)        f is a polynomial in x of degree ≤ d (sums,
//                        products, constant divisors, whole powers) — or null
//   isExponential(f)     f is exactly c·e^(λx) (a·bˣ, a·b^(mx + k)), λ ≠ 0
//   classify(f)          f's END BEHAVIOUR as x → +∞: an asymptotic expansion
//                        in terms c·e^(λx)·x^p·(ln x)^q, exact when the
//                        formula is a finite sum of such terms, otherwise its
//                        leading term(s) and an o(·) remainder; or a bounded
//                        oscillation times an envelope (sin x, x·cos x); or
//                        null when it cannot be told (a named call, x^x …)
//   diffClass(f, g)      the same for f − g: its leading term's sign is who
//                        is ahead for good — an exponential with base > 1
//                        beats every power, a power beats every logarithm,
//                        the higher degree wins, then the leading coefficient
//   commonPeriod(fs)     a period the formulas share, when x enters them only
//                        through sin/cos/tan of kx + d with commensurate k
//   logEvaluator(f)      f(x) as sign · e^ℓ, so 1.01ˣ and x¹⁰⁰ can be compared
//                        at x = 10⁶ where both overflow a double
//
// Pure: no React, no DOM.
// ============================================================================

import type { ExprNode } from './parse'
import { evalAstAt } from './parse'

type Node = ExprNode

/** A formula and the sliders' values it is read at. */
export interface Formula {
  node: ExprNode
  params: readonly number[]
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

/** Free of x (and of every named call): a number once the sliders are read. */
function xFree(n: Node): boolean {
  switch (n.t) {
    case 'num':
    case 'const':
    case 'param':
      return true
    case 'neg':
      return xFree(n.a)
    case 'bin':
      return xFree(n.a) && xFree(n.b)
    case 'call':
      return n.args.every(xFree)
    default:
      return false
  }
}

/** The value of an x-free subtree, or null when it is not a finite number. */
function constVal(n: Node, params: readonly number[]): number | null {
  try {
    const v = evalAstAt(n, params, Number.NaN)
    return Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

/** The largest whole power a polynomial may be raised to and still be read. */
const POW_MAX = 64

function degreeOf(n: Node, params: readonly number[]): number | null {
  if (xFree(n)) return constVal(n, params) === null ? null : 0
  switch (n.t) {
    case 'var':
      return n.name === 'x' ? 1 : null
    case 'neg':
      return degreeOf(n.a, params)
    case 'bin': {
      if (n.op === '+' || n.op === '-' || n.op === '*') {
        const a = degreeOf(n.a, params)
        const b = a === null ? null : degreeOf(n.b, params)
        if (a === null || b === null) return null
        return n.op === '*' ? a + b : Math.max(a, b)
      }
      if (n.op === '/') {
        if (!xFree(n.b)) return null
        const d = constVal(n.b, params)
        if (d === null || d === 0) return null
        return degreeOf(n.a, params)
      }
      // '^': a whole, non-negative constant power of a polynomial
      if (!xFree(n.b)) return null
      const e = constVal(n.b, params)
      if (e === null || !Number.isInteger(e) || e < 0 || e > POW_MAX) return null
      const a = degreeOf(n.a, params)
      return a === null ? null : a * e
    }
    default:
      return null
  }
}

/**
 * f is a polynomial in x of degree at most d — read off the formula: sums,
 * products, division by a nonzero constant and whole powers only. |x|, √(x²),
 * x²/x, a piecewise or a named call are not (null). The bound can exceed the
 * true degree when terms cancel ((x + 1)³ − x³); the coefficients settle that.
 */
export function polyDegree(f: Formula): number | null {
  try {
    return degreeOf(f.node, f.params)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// End behaviour: asymptotic expansions
// ---------------------------------------------------------------------------

/** c · e^(λx) · x^p · (ln x)^q. */
export interface Term {
  c: number
  lam: number
  p: number
  q: number
}

type Ord = Pick<Term, 'lam' | 'p' | 'q'>

/**
 * `sum`: f = Σ terms (largest first) exactly, or — when not `exact` — up to a
 * remainder smaller than the last term listed. An empty exact sum is 0.
 * `osc`: f oscillates without settling, taking values of both signs of the
 * size of `env` again and again (sin x, x·cos x).
 */
export type Asym = { k: 'sum'; terms: Term[]; exact: boolean } | { k: 'osc'; env: Ord }

const ZERO: Asym = { k: 'sum', terms: [], exact: true }
const constant = (v: number): Asym | null =>
  !Number.isFinite(v) ? null : v === 0 ? ZERO : { k: 'sum', terms: [{ c: v, lam: 0, p: 0, q: 0 }], exact: true }
const X: Asym = { k: 'sum', terms: [{ c: 1, lam: 0, p: 1, q: 0 }], exact: true }

const same = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b))

/** Which grows faster: e^(λx) first, then x^p, then (ln x)^q. */
export function cmpOrd(a: Ord, b: Ord): number {
  if (!same(a.lam, b.lam)) return a.lam > b.lam ? 1 : -1
  if (!same(a.p, b.p)) return a.p > b.p ? 1 : -1
  if (!same(a.q, b.q)) return a.q > b.q ? 1 : -1
  return 0
}

const ORD0: Ord = { lam: 0, p: 0, q: 0 }

/** Sorted largest first, like orders merged, cancelled terms dropped. */
function norm(terms: readonly Term[]): Term[] {
  const sorted = terms.filter((t) => t.c !== 0).sort((a, b) => -cmpOrd(a, b))
  const out: Term[] = []
  let mag = 0
  for (const t of sorted) {
    const last = out[out.length - 1]
    if (last && cmpOrd(last, t) === 0) {
      last.c += t.c
      mag = Math.max(mag, Math.abs(t.c))
      if (Math.abs(last.c) <= 1e-12 * mag) out.pop()
    } else {
      out.push({ ...t })
      mag = Math.abs(t.c)
    }
  }
  return out
}

function neg(A: Asym | null): Asym | null {
  if (!A) return null
  if (A.k === 'osc') return A
  return { k: 'sum', terms: A.terms.map((t) => ({ ...t, c: -t.c })), exact: A.exact }
}

function add(A: Asym | null, B: Asym | null): Asym | null {
  if (!A || !B) return null
  if (A.k === 'osc' && B.k === 'osc') {
    const c = cmpOrd(A.env, B.env)
    return c === 0 ? null : c > 0 ? A : B
  }
  if (A.k === 'osc' || B.k === 'osc') {
    const O = (A.k === 'osc' ? A : B) as { k: 'osc'; env: Ord }
    const S = (A.k === 'osc' ? B : A) as { k: 'sum'; terms: Term[]; exact: boolean }
    const above = S.terms.filter((t) => cmpOrd(t, O.env) > 0)
    if (above.length > 0) return { k: 'sum', terms: above, exact: false }
    const lead = S.terms[0]
    if (!lead) return S.exact ? O : null
    return cmpOrd(lead, O.env) < 0 ? O : null
  }
  const merged = norm([...A.terms, ...B.terms])
  const bounds: Ord[] = []
  if (!A.exact) bounds.push(A.terms[A.terms.length - 1] ?? ORD0)
  if (!B.exact) bounds.push(B.terms[B.terms.length - 1] ?? ORD0)
  if (bounds.length === 0) return { k: 'sum', terms: merged, exact: true }
  const bound = bounds.reduce((m, b) => (cmpOrd(b, m) > 0 ? b : m))
  const kept = merged.filter((t) => cmpOrd(t, bound) >= 0)
  return kept.length === 0 ? null : { k: 'sum', terms: kept, exact: false }
}

const mulT = (a: Term, b: Term): Term => ({ c: a.c * b.c, lam: a.lam + b.lam, p: a.p + b.p, q: a.q + b.q })
const divT = (a: Term, b: Term): Term => ({ c: a.c / b.c, lam: a.lam - b.lam, p: a.p - b.p, q: a.q - b.q })
const ordPlus = (a: Ord, b: Ord, s = 1): Ord => ({ lam: a.lam + s * b.lam, p: a.p + s * b.p, q: a.q + s * b.q })

/** The most terms an exact product keeps before it settles for its leading term. */
const MAX_TERMS = 64

function mul(A: Asym | null, B: Asym | null): Asym | null {
  if (!A || !B) return null
  if (A.k === 'osc' && B.k === 'osc') return null
  if (A.k === 'osc' || B.k === 'osc') {
    const O = (A.k === 'osc' ? A : B) as { k: 'osc'; env: Ord }
    const S = (A.k === 'osc' ? B : A) as { k: 'sum'; terms: Term[]; exact: boolean }
    if (S.terms.length === 0) return S.exact ? ZERO : null
    return { k: 'osc', env: ordPlus(O.env, S.terms[0]) }
  }
  if ((A.terms.length === 0 && A.exact) || (B.terms.length === 0 && B.exact)) return ZERO
  if (A.terms.length === 0 || B.terms.length === 0) return null
  if (A.exact && B.exact && A.terms.length * B.terms.length <= MAX_TERMS * 4) {
    const out: Term[] = []
    for (const a of A.terms) for (const b of B.terms) out.push(mulT(a, b))
    const terms = norm(out)
    if (terms.length <= MAX_TERMS) return { k: 'sum', terms, exact: true }
  }
  return { k: 'sum', terms: [mulT(A.terms[0], B.terms[0])], exact: false }
}

function div(A: Asym | null, B: Asym | null): Asym | null {
  if (!A || !B || B.k === 'osc' || B.terms.length === 0) return null
  const b = B.terms[0]
  if (A.k === 'osc') return { k: 'osc', env: ordPlus(A.env, b, -1) }
  if (A.terms.length === 0) return A.exact ? ZERO : null
  if (B.exact && B.terms.length === 1) return { k: 'sum', terms: A.terms.map((t) => divT(t, b)), exact: A.exact }
  return { k: 'sum', terms: [divT(A.terms[0], b)], exact: false }
}

/** p/q (q ≤ 99) when v is one, for the sign of an odd root of a negative number. */
function oddRootSign(k: number): number | null {
  if (Number.isInteger(k)) return k % 2 === 0 ? 1 : -1
  for (let q = 3; q <= 99; q += 2) {
    const p = Math.round(k * q)
    if (Math.abs(p - k * q) <= 1e-9 * Math.max(1, Math.abs(k * q))) return p % 2 === 0 ? 1 : -1
  }
  return null
}

function powT(t: Term, k: number): Term | null {
  let c: number
  if (t.c > 0) c = Math.pow(t.c, k)
  else {
    const s = oddRootSign(k)
    if (s === null) return null
    c = s * Math.pow(-t.c, k)
  }
  if (!Number.isFinite(c) || c === 0) return null
  return { c, lam: t.lam * k, p: t.p * k, q: t.q * k }
}

function powConst(A: Asym | null, k: number): Asym | null {
  if (!A || A.k === 'osc' || !Number.isFinite(k)) return null
  if (k === 0) return constant(1)
  if (A.terms.length === 0) return A.exact && k > 0 ? ZERO : null
  if (A.exact && A.terms.length === 1) {
    const t = powT(A.terms[0], k)
    return t ? { k: 'sum', terms: [t], exact: true } : null
  }
  if (A.exact && Number.isInteger(k) && k > 0 && k <= 8) {
    let out: Asym | null = A
    for (let i = 1; i < k && out; i++) out = mul(out, A)
    return out
  }
  const t = powT(A.terms[0], k)
  return t ? { k: 'sum', terms: [t], exact: false } : null
}

/** e^(L·B) for B exactly a + m·x + r·ln x: c·e^(Lm·x)·x^(Lr). */
function expScaled(B: Asym | null, L: number): Asym | null {
  if (!B || B.k === 'osc' || !B.exact || !Number.isFinite(L)) return null
  let a = 0
  let m = 0
  let r = 0
  for (const t of B.terms) {
    if (cmpOrd(t, ORD0) === 0) a = t.c
    else if (cmpOrd(t, { lam: 0, p: 1, q: 0 }) === 0) m = t.c
    else if (cmpOrd(t, { lam: 0, p: 0, q: 1 }) === 0) r = t.c
    else return null
  }
  const c = Math.exp(L * a)
  if (!Number.isFinite(c) || c === 0) return null
  return { k: 'sum', terms: [{ c, lam: L * m, p: L * r, q: 0 }], exact: true }
}

/** ln(A) / ln(base). */
function lnOf(A: Asym | null, scale = 1): Asym | null {
  if (!A || A.k === 'osc' || A.terms.length === 0 || !Number.isFinite(scale)) return null
  const t = A.terms[0]
  if (!(t.c > 0)) return null
  const parts: Term[] = []
  if (t.lam !== 0) parts.push({ c: t.lam, lam: 0, p: 1, q: 0 })
  if (t.p !== 0) parts.push({ c: t.p, lam: 0, p: 0, q: 1 })
  const lc = Math.log(t.c)
  if (Math.abs(lc) > 1e-15) parts.push({ c: lc, lam: 0, p: 0, q: 0 })
  const scaled = parts.map((u) => ({ ...u, c: u.c * scale }))
  if (A.exact && A.terms.length === 1 && t.q === 0) return { k: 'sum', terms: norm(scaled), exact: true }
  // ln(lead) + ln(1 + o(1)) [+ q·ln ln x, which sits between ln x and 1]
  const keep = t.q !== 0 ? scaled.filter((u) => cmpOrd(u, ORD0) > 0) : scaled
  return keep.length === 0 ? null : { k: 'sum', terms: norm(keep), exact: false }
}

/** The sign of A for large x times A: |A| (exact stays exact). */
function absOf(A: Asym | null): Asym | null {
  if (!A || A.k === 'osc') return null
  if (A.terms.length === 0) return A.exact ? ZERO : null
  const s = A.terms[0].c > 0 ? 1 : -1
  return { k: 'sum', terms: A.terms.map((t) => ({ ...t, c: s * t.c })), exact: A.exact }
}

/** A → ±∞. */
const unbounded = (A: Asym | null): boolean => !!A && A.k === 'sum' && A.terms.length > 0 && cmpOrd(A.terms[0], ORD0) > 0

const LN10 = Math.LN10
const LN2 = Math.LN2

function asym(n: Node, params: readonly number[]): Asym | null {
  if (xFree(n)) {
    const v = constVal(n, params)
    return v === null ? null : constant(v)
  }
  switch (n.t) {
    case 'var':
      return n.name === 'x' ? X : null
    case 'neg':
      return neg(asym(n.a, params))
    case 'bin': {
      if (n.op === '^') {
        if (xFree(n.b)) {
          const k = constVal(n.b, params)
          return k === null ? null : powConst(asym(n.a, params), k)
        }
        if (xFree(n.a)) {
          const b = constVal(n.a, params)
          if (b === null || !(b > 0)) return null
          if (b === 1) return constant(1)
          return expScaled(asym(n.b, params), Math.log(b))
        }
        return null
      }
      const a = asym(n.a, params)
      if (!a) return null
      const b = asym(n.b, params)
      if (n.op === '+') return add(a, b)
      if (n.op === '-') return add(a, neg(b))
      if (n.op === '*') return mul(a, b)
      return div(a, b)
    }
    case 'call': {
      const fn = n.fn
      if (fn === 'log_') {
        if (!xFree(n.args[0])) return null
        const base = constVal(n.args[0], params)
        if (base === null || !(base > 0) || base === 1) return null
        return lnOf(asym(n.args[1], params), 1 / Math.log(base))
      }
      const A = asym(n.args[0], params)
      switch (fn) {
        case 'exp':
          return expScaled(A, 1)
        case 'ln':
          return lnOf(A)
        case 'log':
        case 'log10':
          return lnOf(A, 1 / LN10)
        case 'log2':
          return lnOf(A, 1 / LN2)
        case 'sqrt':
          return powConst(A, 0.5)
        case 'cbrt':
          return powConst(A, 1 / 3)
        case 'abs':
          return absOf(A)
        case 'sin':
        case 'cos':
          return unbounded(A) ? { k: 'osc', env: ORD0 } : null
        case 'atan':
        case 'tanh':
          if (!unbounded(A)) return null
          return {
            k: 'sum',
            terms: [{ c: ((A as { terms: Term[] }).terms[0].c > 0 ? 1 : -1) * (fn === 'atan' ? Math.PI / 2 : 1), lam: 0, p: 0, q: 0 }],
            exact: false,
          }
        case 'sinh':
        case 'cosh': {
          const s = fn === 'sinh' ? -1 : 1
          const plus = expScaled(A, 1)
          const minus = expScaled(A, -1)
          const half = constant(0.5)
          return mul(add(plus, s < 0 ? neg(minus) : minus), half)
        }
        default:
          return null
      }
    }
    default:
      return null
  }
}

/** f's end behaviour as x → +∞ (see Asym), or null when it cannot be read. */
export function classify(f: Formula): Asym | null {
  try {
    return asym(f.node, f.params)
  } catch {
    return null
  }
}

/** f − g's end behaviour, or null. */
export function diffClass(f: Formula, g: Formula): Asym | null {
  try {
    return add(asym(f.node, f.params), neg(asym(g.node, g.params)))
  } catch {
    return null
  }
}

/** f is exactly c·e^(λx) with λ ≠ 0 (a·bˣ, a·b^(mx + k)): its ratio over equal steps is constant everywhere. */
export function isExponential(f: Formula): boolean {
  const A = classify(f)
  if (!A || A.k !== 'sum' || !A.exact || A.terms.length !== 1) return false
  const t = A.terms[0]
  return t.lam !== 0 && t.p === 0 && t.q === 0
}

/**
 * Why the leader of f − g's leading term wins, in a teacher's words: the
 * growth classes of f's and g's own leading terms compared. `names` label
 * the two in the sentence ("1/(x − 3) tends to 0").
 */
export function growthReason(F: Asym | null, G: Asym | null, leader: 'f' | 'g', names?: { f: string; g: string }): string {
  const lead = (A: Asym | null): Term | null => (A && A.k === 'sum' ? A.terms[0] ?? null : null)
  const poly = (A: Asym | null): boolean =>
    !!A && A.k === 'sum' && A.exact && A.terms.every((t) => t.lam === 0 && t.q === 0 && Number.isInteger(t.p) && t.p >= 0)
  const w = leader === 'f' ? lead(F) : lead(G)
  const l = leader === 'f' ? lead(G) : lead(F)
  const lName = (leader === 'f' ? names?.g : names?.f) ?? 'the other'
  const bothPoly = poly(F) && poly(G)
  if (!w && !l) return 'by their end behaviour'
  if (!l) return 'it stays positive for large x'
  if (!w) return `${lName} stays negative for large x`
  const c = cmpOrd(w, l)
  if (c < 0) {
    // the loser's own leading term dominates — and is negative
    if (cmpOrd(l, ORD0) > 0) return `${lName} falls without bound`
    return `${lName} approaches 0 from below`
  }
  if (c === 0) {
    if (same(w.c, l.c)) return 'their leading terms are equal, so the next terms decide'
    if (bothPoly) return 'the same degree, so the larger leading coefficient wins'
    return 'the same rate of growth, so the larger leading coefficient wins'
  }
  if (cmpOrd(w, ORD0) === 0 && cmpOrd(l, ORD0) < 0) return `${lName} tends to 0`
  if (!same(w.lam, l.lam)) {
    if (w.lam > 0 && same(l.lam, 0)) return 'an exponential with base > 1 outgrows every power of x'
    if (w.lam > 0 && l.lam > 0) return 'the exponential with the larger base grows faster'
    if (same(w.lam, 0) && l.lam < 0) return 'an exponential with base < 1 decays toward 0'
    return 'the exponential with the larger base wins'
  }
  if (!same(w.p, l.p)) {
    if (bothPoly) return 'the higher degree wins'
    if (w.p > 0 && same(l.p, 0) && l.q > 0) return 'a power of x outgrows every power of ln x'
    return 'the larger power of x wins'
  }
  if (same(l.q, 0) && same(l.p, 0)) return 'a logarithm grows without bound'
  return 'the higher power of ln x wins'
}

// ---------------------------------------------------------------------------
// Periodicity
// ---------------------------------------------------------------------------

const TRIG = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot'])

/** The frequencies k of the trig calls x enters through (as sin(kx + d)), or null when x enters any other way. */
function freqs(n: Node, params: readonly number[]): number[] | null {
  if (xFree(n)) return []
  switch (n.t) {
    case 'neg':
      return freqs(n.a, params)
    case 'bin': {
      const a = freqs(n.a, params)
      const b = a === null ? null : freqs(n.b, params)
      return a && b ? [...a, ...b] : null
    }
    case 'call': {
      if (TRIG.has(n.fn) && n.args.length === 1) {
        const arg = n.args[0]
        const d = degreeOf(arg, params)
        if (d !== null && d <= 1) {
          const m = evalAstAt(arg, params, 1) - evalAstAt(arg, params, 0)
          if (Number.isFinite(m) && m !== 0) return [Math.abs(m)]
        }
      }
      const out: number[] = []
      for (const a of n.args) {
        const f = freqs(a, params)
        if (!f) return null
        out.push(...f)
      }
      return out
    }
    default:
      return null
  }
}

function ratio(v: number, maxQ: number): { p: number; q: number } | null {
  for (let q = 1; q <= maxQ; q++) {
    const p = Math.round(v * q)
    if (p > 0 && Math.abs(p / q - v) <= 1e-9 * Math.max(1, v)) return { p, q }
  }
  return null
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

/**
 * A period every formula shares (2π·L/k₁ for commensurate frequencies), 'const'
 * when none depends on x, or null when one is not periodic (x outside a trig
 * call) or the frequencies do not fit one period.
 */
export function commonPeriod(fs: readonly Formula[]): number | 'const' | null {
  try {
    const all: number[] = []
    for (const f of fs) {
      const k = freqs(f.node, f.params)
      if (!k) return null
      all.push(...k)
    }
    if (all.length === 0) return 'const'
    const k1 = all[0]
    let L = 1
    for (const k of all) {
      const r = ratio(k / k1, 64)
      if (!r) return null
      L = (L * r.q) / gcd(L, r.q)
      if (L > 1000) return null
    }
    return (2 * Math.PI * L) / k1
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// f(x) in log space: sign · e^ℓ
// ---------------------------------------------------------------------------

/** sign (−1, 0, 1) · e^l. */
export interface LogNum {
  s: number
  l: number
}

const LN_ZERO: LogNum = { s: 0, l: -Infinity }

function fromPlain(v: number): LogNum | null {
  if (Number.isNaN(v)) return null
  if (v === 0) return LN_ZERO
  return { s: v > 0 ? 1 : -1, l: Math.log(Math.abs(v)) }
}

export function toPlain(a: LogNum): number {
  return a.s === 0 ? 0 : a.s * Math.exp(a.l)
}

/** a + b without leaving log space. */
export function lsum(a: LogNum, b: LogNum): LogNum | null {
  if (a.s === 0) return b
  if (b.s === 0) return a
  if (a.l === Infinity && b.l === Infinity) return a.s === b.s ? a : null
  const hi = a.l >= b.l ? a : b
  const lo = a.l >= b.l ? b : a
  const r = Math.exp(lo.l - hi.l)
  if (hi.s === lo.s) return { s: hi.s, l: hi.l + Math.log1p(r) }
  if (r === 1) return LN_ZERO
  return { s: hi.s, l: hi.l + Math.log1p(-r) }
}

function powLN(a: LogNum, k: number): LogNum | null {
  if (Number.isNaN(k)) return null
  if (a.s === 0) return k > 0 ? LN_ZERO : null
  const l = a.l === 0 ? 0 : k * a.l
  if (Number.isNaN(l)) return null
  if (l === -Infinity) return LN_ZERO
  if (a.s > 0) return { s: 1, l }
  const s = oddRootSign(k)
  return s === null ? null : { s, l }
}

const PLAIN: Record<string, (a: number, b: number) => number> = {
  sin: (a) => Math.sin(a),
  cos: (a) => Math.cos(a),
  tan: (a) => Math.tan(a),
  sec: (a) => 1 / Math.cos(a),
  csc: (a) => 1 / Math.sin(a),
  cot: (a) => Math.cos(a) / Math.sin(a),
  asin: (a) => Math.asin(a),
  acos: (a) => Math.acos(a),
  atan: (a) => Math.atan(a),
  floor: (a) => Math.floor(a),
  ceil: (a) => Math.ceil(a),
  sign: (a) => Math.sign(a),
  min: (a, b) => Math.min(a, b),
  max: (a, b) => Math.max(a, b),
}

type LogFn = (x: number) => LogNum | null

function compileLog(n: Node, params: readonly number[]): LogFn | null {
  if (xFree(n)) {
    let v: number
    try {
      v = evalAstAt(n, params, Number.NaN)
    } catch {
      return null
    }
    const c = fromPlain(v)
    return () => c
  }
  switch (n.t) {
    case 'var':
      return n.name === 'x' ? (x) => fromPlain(x) : null
    case 'neg': {
      const a = compileLog(n.a, params)
      if (!a) return null
      return (x) => {
        const u = a(x)
        return u ? { s: -u.s, l: u.l } : null
      }
    }
    case 'bin': {
      const A = compileLog(n.a, params)
      const B = compileLog(n.b, params)
      if (!A || !B) return null
      switch (n.op) {
        case '+':
        case '-': {
          const sgn = n.op === '-' ? -1 : 1
          return (x) => {
            const u = A(x)
            const v = B(x)
            return u && v ? lsum(u, { s: sgn * v.s, l: v.l }) : null
          }
        }
        case '*':
          return (x) => {
            const u = A(x)
            const v = B(x)
            if (!u || !v) return null
            if (u.s === 0 || v.s === 0) return LN_ZERO
            return { s: u.s * v.s, l: u.l + v.l }
          }
        case '/':
          return (x) => {
            const u = A(x)
            const v = B(x)
            if (!u || !v || v.s === 0) return null
            if (u.s === 0) return LN_ZERO
            const l = u.l - v.l
            return Number.isNaN(l) ? null : { s: u.s * v.s, l }
          }
        default:
          return (x) => {
            const u = A(x)
            const v = B(x)
            return u && v ? powLN(u, toPlain(v)) : null
          }
      }
    }
    case 'call': {
      const args: LogFn[] = []
      for (const a of n.args) {
        const c = compileLog(a, params)
        if (!c) return null
        args.push(c)
      }
      const A = args[0]
      switch (n.fn) {
        case 'exp':
          return (x) => {
            const u = A(x)
            if (!u) return null
            const v = toPlain(u)
            return v === -Infinity ? LN_ZERO : { s: 1, l: v }
          }
        case 'ln':
        case 'log':
        case 'log10':
        case 'log2':
        case 'log_': {
          const scale = n.fn === 'ln' ? 1 : n.fn === 'log2' ? 1 / LN2 : n.fn === 'log_' ? null : 1 / LN10
          const U = n.fn === 'log_' ? args[1] : A
          return (x) => {
            let k = scale
            if (k === null) {
              const b = args[0](x)
              if (!b || b.s <= 0 || b.l === 0) return null
              k = 1 / b.l
            }
            const u = U(x)
            if (!u || u.s <= 0) return null
            return fromPlain(u.l * k)
          }
        }
        case 'sqrt':
          return (x) => {
            const u = A(x)
            if (!u || u.s < 0) return null
            return u.s === 0 ? LN_ZERO : { s: 1, l: u.l / 2 }
          }
        case 'cbrt':
          return (x) => {
            const u = A(x)
            return u ? (u.s === 0 ? LN_ZERO : { s: u.s, l: u.l / 3 }) : null
          }
        case 'abs':
          return (x) => {
            const u = A(x)
            return u ? { s: Math.abs(u.s), l: u.l } : null
          }
        case 'sinh':
        case 'cosh':
        case 'tanh':
          return (x) => {
            const u = A(x)
            if (!u) return null
            const v = toPlain(u)
            if (Math.abs(v) < 700) return fromPlain(n.fn === 'sinh' ? Math.sinh(v) : n.fn === 'cosh' ? Math.cosh(v) : Math.tanh(v))
            if (n.fn === 'tanh') return fromPlain(Math.sign(v))
            return { s: n.fn === 'cosh' ? 1 : Math.sign(v), l: Math.abs(v) - LN2 }
          }
        default: {
          const fn = PLAIN[n.fn]
          if (!fn) return null
          const trig = TRIG.has(n.fn)
          return (x) => {
            const vals: number[] = []
            for (const a of args) {
              const u = a(x)
              if (!u) return null
              const v = toPlain(u)
              // sin of 10¹⁶ is noise: no digit of the argument is left after the period
              if (trig && !(Math.abs(v) < 1e15)) return null
              vals.push(v)
            }
            return fromPlain(fn(vals[0], vals[1] ?? 0))
          }
        }
      }
    }
    default:
      return null
  }
}

/** f(x) as sign · e^ℓ, free of overflow; null when the formula has something it cannot carry. */
export function logEvaluator(f: Formula): LogFn | null {
  try {
    const ev = compileLog(f.node, f.params)
    if (!ev) return null
    return (x) => {
      try {
        return ev(x)
      } catch {
        return null
      }
    }
  } catch {
    return null
  }
}

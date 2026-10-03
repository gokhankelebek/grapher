// ============================================================================
// src/core/expSolve.ts — exponential equations solved EXACTLY, with logarithms
// (NC.M3.F-LE.4: "use logarithms to express the solution to ab^(ct) = d").
//
//   expShapeOf(node, isVar, params?)   read a·b^(mx + c) + k off a typed formula
//   solveExpEquation(f, g, v?)         f(x) = g(x) for two such shapes
//
// What is solved, and only this:
//
//   A·B^(mx + c) + K = D             one power: isolate it, take logs
//                                    3·2ˣ = 7        → x = log₂(7/3) = ln(7/3)/ln 2
//                                    5e^(0.2t) = 20  → t = 5 ln 4 = 10 ln 2
//   A₁·B₁^(u₁) = A₂·B₂^(u₂)          two powers: ln of both sides, collect x
//                                    2ˣ = 3^(x−1)    → x = ln 3/(ln 3 − ln 2)
//
// with A, B, K, D, m, c EXACT rationals (as typed: 0.2 is 1/5) and B = e or a
// positive rational ≠ 1. Every logarithm that comes out is the log of a
// positive rational, so the answer is a rational combination of ln p over
// primes p — which is how "ln 4 = 2 ln 2" and "ln 1024 = 10 ln 2" are SEEN to
// be equal rather than guessed from digits.
//
// NEVER FAKE ONE. A shape is recognised from the formula's structure or not
// at all: a sum of two different powers (2ˣ + 3ˣ = 10), a power plus a
// constant on both sides of a two-power equation, π or √2 as a coefficient,
// x in a base — all return null, and the caller keeps its decimal.
//
// Pure: no DOM, nothing from src/ui. The only import is the parser's AST type.
// ============================================================================

import type { ExprNode } from './parse'

const MINUS = '−'

// ---------------------------------------------------------------------------
// Rationals (bigint)
// ---------------------------------------------------------------------------

interface R {
  n: bigint
  d: bigint
}

const babs = (a: bigint): bigint => (a < 0n ? -a : a)
function bgcd(a: bigint, b: bigint): bigint {
  a = babs(a)
  b = babs(b)
  while (b !== 0n) [a, b] = [b, a % b]
  return a
}
function mk(n: bigint, d: bigint = 1n): R {
  if (d === 0n) throw new Error('zero denominator')
  if (d < 0n) {
    n = -n
    d = -d
  }
  const g = bgcd(n, d)
  return g > 1n ? { n: n / g, d: d / g } : { n, d }
}
const ZERO: R = { n: 0n, d: 1n }
const ONE: R = { n: 1n, d: 1n }
const add = (a: R, b: R): R => mk(a.n * b.d + b.n * a.d, a.d * b.d)
const sub = (a: R, b: R): R => mk(a.n * b.d - b.n * a.d, a.d * b.d)
const mul = (a: R, b: R): R => mk(a.n * b.n, a.d * b.d)
const div = (a: R, b: R): R => mk(a.n * b.d, a.d * b.n)
const neg = (a: R): R => ({ n: -a.n, d: a.d })
const isZero = (a: R): boolean => a.n === 0n
const eq = (a: R, b: R): boolean => a.n === b.n && a.d === b.d
const sgn = (a: R): number => (a.n > 0n ? 1 : a.n < 0n ? -1 : 0)
const num = (a: R): number => Number(a.n) / Number(a.d)
const isInt = (a: R): boolean => a.d === 1n

/** A typed literal as the fraction it names: "0.2" is 1/5. */
function literal(raw: string, v: number): R | null {
  const m = /^(\d*)(?:\.(\d*))?$/.exec((raw ?? '').trim())
  if (m && (m[1] || m[2])) {
    const frac = m[2] ?? ''
    if (frac.length > 12) return null
    return mk(BigInt((m[1] || '0') + frac), 10n ** BigInt(frac.length))
  }
  return Number.isSafeInteger(v) ? mk(BigInt(v)) : null
}

/** A slider value that IS a short decimal (≤ 6 places), as that fraction. */
function paramValue(v: number | undefined): R | null {
  if (v === undefined || !Number.isFinite(v)) return null
  for (let k = 0, d = 1; k <= 6; k++, d *= 10) {
    const n = Math.round(v * d)
    if (n / d === v && Number.isSafeInteger(n)) return mk(BigInt(n), BigInt(d))
  }
  return null
}

function rText(a: R): string {
  const s = a.n < 0n ? MINUS : ''
  return a.d === 1n ? `${s}${babs(a.n)}` : `${s}${babs(a.n)}/${a.d}`
}
/** A terminating decimal with more than one place as it is typed (21/20 → 1.05, 1/5 → 0.2); else the fraction. */
function dText(a: R): string {
  let d = a.d
  let twos = 0
  let fives = 0
  while (d % 2n === 0n) { d /= 2n; twos++ }
  while (d % 5n === 0n) { d /= 5n; fives++ }
  const places = Math.max(twos, fives)
  if (d !== 1n || a.d <= 2n || places > 6) return rText(a)
  const s = (Number(a.n) / Number(a.d)).toFixed(places)
  return s.startsWith('-') ? MINUS + s.slice(1) : s
}
const dTex = (a: R): string => (dText(a).includes('.') ? dText(a).replace(MINUS, '-') : rTex(a))

function rTex(a: R): string {
  const s = a.n < 0n ? '-' : ''
  return a.d === 1n ? `${s}${babs(a.n)}` : `${s}\\frac{${babs(a.n)}}{${a.d}}`
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** The base of a power: e, or a positive rational other than 1. */
export type ExpBase = { e: true } | { e: false; r: R }

/** coef · base^(m·x + c), with m ≠ 0 and coef ≠ 0. */
export interface ExpTerm {
  coef: R
  base: ExpBase
  m: R
  c: R
}

/** term + k; term null is the constant k. */
export interface ExpShape {
  term: ExpTerm | null
  k: R
}

type IsVar = (n: ExprNode) => boolean

const sameBase = (a: ExpBase, b: ExpBase): boolean => (a.e && b.e) || (!a.e && !b.e && eq(a.r, b.r))

function hasVar(n: ExprNode, isVar: IsVar): boolean {
  switch (n.t) {
    case 'num':
    case 'const':
      return false
    case 'var':
    case 'param':
      return isVar(n)
    case 'neg':
      return hasVar(n.a, isVar)
    case 'bin':
      return hasVar(n.a, isVar) || hasVar(n.b, isVar)
    case 'call':
      return n.args.some((a) => hasVar(a, isVar))
    default:
      return true
  }
}

/** The exact rational value of a var-free subtree, or null (π, e, √2, a call). */
function rational(n: ExprNode, params: readonly number[] | undefined): R | null {
  switch (n.t) {
    case 'num':
      return literal(n.raw, n.v)
    case 'param':
      return params ? paramValue(params[n.i]) : null
    case 'neg': {
      const a = rational(n.a, params)
      return a ? neg(a) : null
    }
    case 'bin': {
      const a = rational(n.a, params)
      const b = rational(n.b, params)
      if (!a || !b) return null
      switch (n.op) {
        case '+':
          return add(a, b)
        case '-':
          return sub(a, b)
        case '*':
          return mul(a, b)
        case '/':
          return isZero(b) ? null : div(a, b)
        case '^': {
          if (!isInt(b) || babs(b.n) > 64n) return null
          const k = Number(b.n)
          if (isZero(a) && k <= 0) return null
          let out = ONE
          for (let i = 0; i < Math.abs(k); i++) out = mul(out, a)
          if (babs(out.n) > 10n ** 30n || out.d > 10n ** 30n) return null
          return k < 0 ? div(ONE, out) : out
        }
      }
      return null
    }
    default:
      return null
  }
}

/** m·x + c with m, c exact, or null. */
function linear(n: ExprNode, isVar: IsVar, params: readonly number[] | undefined): { m: R; c: R } | null {
  if (!hasVar(n, isVar)) {
    const v = rational(n, params)
    return v ? { m: ZERO, c: v } : null
  }
  switch (n.t) {
    case 'var':
    case 'param':
      return { m: ONE, c: ZERO }
    case 'neg': {
      const a = linear(n.a, isVar, params)
      return a ? { m: neg(a.m), c: neg(a.c) } : null
    }
    case 'bin': {
      if (n.op === '+' || n.op === '-') {
        const a = linear(n.a, isVar, params)
        const b = linear(n.b, isVar, params)
        if (!a || !b) return null
        return n.op === '+' ? { m: add(a.m, b.m), c: add(a.c, b.c) } : { m: sub(a.m, b.m), c: sub(a.c, b.c) }
      }
      if (n.op === '*') {
        const ka = hasVar(n.a, isVar) ? null : rational(n.a, params)
        const kb = hasVar(n.b, isVar) ? null : rational(n.b, params)
        if (ka) {
          const b = linear(n.b, isVar, params)
          return b ? { m: mul(ka, b.m), c: mul(ka, b.c) } : null
        }
        if (kb) {
          const a = linear(n.a, isVar, params)
          return a ? { m: mul(kb, a.m), c: mul(kb, a.c) } : null
        }
        return null
      }
      if (n.op === '/') {
        if (hasVar(n.b, isVar)) return null
        const k = rational(n.b, params)
        const a = linear(n.a, isVar, params)
        return k && a && !isZero(k) ? { m: div(a.m, k), c: div(a.c, k) } : null
      }
      return null
    }
    default:
      return null
  }
}

function baseOf(n: ExprNode, params: readonly number[] | undefined): ExpBase | null {
  if (n.t === 'const') return n.name === 'e' ? { e: true } : null
  const r = rational(n, params)
  if (!r || sgn(r) <= 0 || eq(r, ONE)) return null
  return { e: false, r }
}

function scale(s: ExpShape, k: R): ExpShape {
  if (isZero(k)) return { term: null, k: ZERO }
  return { term: s.term ? { ...s.term, coef: mul(s.term.coef, k) } : null, k: mul(s.k, k) }
}

function shape(n: ExprNode, isVar: IsVar, params: readonly number[] | undefined): ExpShape | null {
  if (!hasVar(n, isVar)) {
    const v = rational(n, params)
    return v ? { term: null, k: v } : null
  }
  switch (n.t) {
    case 'neg': {
      const a = shape(n.a, isVar, params)
      return a ? scale(a, neg(ONE)) : null
    }
    case 'call': {
      if (n.fn !== 'exp' || n.args.length !== 1) return null
      const u = linear(n.args[0], isVar, params)
      if (!u || isZero(u.m)) return null
      return { term: { coef: ONE, base: { e: true }, m: u.m, c: u.c }, k: ZERO }
    }
    case 'bin': {
      if (n.op === '^') {
        if (hasVar(n.a, isVar)) return null
        const base = baseOf(n.a, params)
        const u = linear(n.b, isVar, params)
        if (!base || !u || isZero(u.m)) return null
        return { term: { coef: ONE, base, m: u.m, c: u.c }, k: ZERO }
      }
      const a = shape(n.a, isVar, params)
      const b = shape(n.b, isVar, params)
      if (!a || !b) return null
      if (n.op === '+' || n.op === '-') {
        const bb = n.op === '-' ? scale(b, neg(ONE)) : b
        const k = add(a.k, bb.k)
        if (a.term && bb.term) {
          const t1 = a.term
          const t2 = bb.term
          if (!sameBase(t1.base, t2.base) || !eq(t1.m, t2.m) || !eq(t1.c, t2.c)) return null
          const coef = add(t1.coef, t2.coef)
          return { term: isZero(coef) ? null : { ...t1, coef }, k }
        }
        return { term: a.term ?? bb.term, k }
      }
      if (n.op === '*') {
        if (!a.term) return scale(b, a.k)
        if (!b.term) return scale(a, b.k)
        // b^u · b^w = b^(u + w), when nothing is added to either
        if (!isZero(a.k) || !isZero(b.k) || !sameBase(a.term.base, b.term.base)) return null
        const m = add(a.term.m, b.term.m)
        if (isZero(m)) return null
        return { term: { coef: mul(a.term.coef, b.term.coef), base: a.term.base, m, c: add(a.term.c, b.term.c) }, k: ZERO }
      }
      if (n.op === '/') {
        if (!b.term) return isZero(b.k) ? null : scale(a, div(ONE, b.k))
        if (!a.term) {
          // k / (A·B^u) = (k/A)·B^(−u)
          if (!isZero(b.k)) return null
          return { term: { coef: div(a.k, b.term.coef), base: b.term.base, m: neg(b.term.m), c: neg(b.term.c) }, k: ZERO }
        }
        if (!isZero(a.k) || !isZero(b.k) || !sameBase(a.term.base, b.term.base)) return null
        const m = sub(a.term.m, b.term.m)
        if (isZero(m)) return null
        return { term: { coef: div(a.term.coef, b.term.coef), base: a.term.base, m, c: sub(a.term.c, b.term.c) }, k: ZERO }
      }
      return null
    }
    default:
      return null
  }
}

/**
 * a·b^(mx + c) + k read off a formula, every number exact — or null. A
 * formula with no power of x in it (a constant, a line) is a shape with a
 * null term only when it is a CONSTANT; anything else in x is null.
 * `params` are the sliders' current values, used only when they are short
 * decimals (2, 0.25) — a slider dragged to 2.0371 is not an exact number.
 */
export function expShapeOf(n: ExprNode, isVar: IsVar, params?: readonly number[]): ExpShape | null {
  try {
    return shape(n, isVar, params)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Logarithms of rationals, as Σ r_p ln p over primes
// ---------------------------------------------------------------------------

/** r0 + Σ coef[p]·ln p — r0 collects ln e = 1. */
interface LogLin {
  r0: R
  ln: Map<string, R>
}

const LL0 = (): LogLin => ({ r0: ZERO, ln: new Map() })

/** Prime factorisation of n > 0, or null when a cofactor is too large to be sure of. */
function factor(n: bigint): Map<bigint, number> | null {
  const out = new Map<bigint, number>()
  let m = babs(n)
  for (let p = 2n; p * p <= m; p += p === 2n ? 1n : 2n) {
    if (p > 1_000_000n) return null
    while (m % p === 0n) {
      out.set(p, (out.get(p) ?? 0) + 1)
      m /= p
    }
  }
  if (m > 1n) out.set(m, (out.get(m) ?? 0) + 1)
  return out
}

/** ln r for a positive rational r. */
function lnOf(r: R): LogLin | null {
  if (sgn(r) <= 0) return null
  const fn = factor(r.n)
  const fd = factor(r.d)
  if (!fn || !fd) return null
  const out = LL0()
  for (const [p, k] of fn) out.ln.set(String(p), mk(BigInt(k)))
  for (const [p, k] of fd) out.ln.set(String(p), sub(out.ln.get(String(p)) ?? ZERO, mk(BigInt(k))))
  return out
}

function lnBase(b: ExpBase): LogLin | null {
  if (b.e) return { r0: ONE, ln: new Map() }
  return lnOf(b.r)
}

function llAdd(a: LogLin, b: LogLin): LogLin {
  const out: LogLin = { r0: add(a.r0, b.r0), ln: new Map(a.ln) }
  for (const [p, c] of b.ln) out.ln.set(p, add(out.ln.get(p) ?? ZERO, c))
  for (const [p, c] of out.ln) if (isZero(c)) out.ln.delete(p)
  return out
}
function llScale(a: LogLin, k: R): LogLin {
  const out: LogLin = { r0: mul(a.r0, k), ln: new Map() }
  if (isZero(k)) return out
  for (const [p, c] of a.ln) out.ln.set(p, mul(c, k))
  return out
}
const llSub = (a: LogLin, b: LogLin): LogLin => llAdd(a, llScale(b, neg(ONE)))
const llZero = (a: LogLin): boolean => isZero(a.r0) && a.ln.size === 0
const llValue = (a: LogLin): number => {
  let s = num(a.r0)
  for (const [p, c] of a.ln) s += num(c) * Math.log(Number(p))
  return s
}

/** a = q·b for a rational q, else null (b ≠ 0). */
function llRatio(a: LogLin, b: LogLin): R | null {
  let q: R | null = null
  const keys = new Set([...a.ln.keys(), ...b.ln.keys()])
  const pairs: [R, R][] = [[a.r0, b.r0], ...[...keys].map((k): [R, R] => [a.ln.get(k) ?? ZERO, b.ln.get(k) ?? ZERO])]
  for (const [x, y] of pairs) {
    if (isZero(y)) {
      if (!isZero(x)) return null
      continue
    }
    const r = div(x, y)
    if (q === null) q = r
    else if (!eq(q, r)) return null
  }
  return q
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const SUB: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' }
const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' }

export interface LogForm {
  text: string
  tex: string
}

/** The argument of a log: "4", "(7/3)". */
const argText = (r: R): string => (isInt(r) ? ` ${rText(r)}` : `(${rText(r)})`)
const argTex = (r: R): string => (isInt(r) ? ` ${rTex(r)}` : `\\left(${rTex(r)}\\right)`)

function logName(b: ExpBase): LogForm {
  if (b.e) return { text: 'ln', tex: '\\ln' }
  if (isInt(b.r) && b.r.n === 10n) return { text: 'log', tex: '\\log' }
  if (isInt(b.r)) return { text: `log${String(b.r.n).split('').map((c) => SUB[c] ?? c).join('')}`, tex: `\\log_{${b.r.n}}` }
  const bt = dText(b.r)
  return { text: bt.includes('.') ? `log_${bt}` : `log_(${bt})`, tex: `\\log_{${dTex(b.r)}}` }
}

/** "log₂(7/3)", "ln 4". */
function logAtom(b: ExpBase, r: R, decimal = false): LogForm {
  const n = logName(b)
  if (decimal && dText(r).includes('.')) return { text: `${n.text} ${dText(r)}`, tex: `${n.tex} ${dTex(r)}` }
  return { text: `${n.text}${argText(r)}`, tex: `${n.tex}${argTex(r)}` }
}

/** α·ATOM + β, as a class writes it: "5 ln 4", "(ln 5 − 1)/2", "log₂ 5 + 1", "(1/2) log₃ 10". */
function affine(alpha: R, atom: LogForm, beta: R): LogForm {
  const plain = (a: R): LogForm => ({ text: rText(a), tex: rTex(a) })
  if (isZero(alpha)) return plain(beta)
  // (ATOM ± b)/q
  if (!isInt(alpha) && babs(alpha.n) === 1n && !isZero(beta)) {
    const q = alpha.d
    const bq = mul(beta, mk(q))
    if (isInt(bq)) {
      const b = bq.n
      const innerT = alpha.n < 0n ? `${babs(b)} ${MINUS} ${atom.text}` : `${atom.text} ${b < 0n ? MINUS : '+'} ${babs(b)}`
      const innerX = alpha.n < 0n ? `${babs(b)} - ${atom.tex}` : `${atom.tex} ${b < 0n ? '-' : '+'} ${babs(b)}`
      if (alpha.n < 0n && b < 0n) {
        // −(ATOM + |b|)/q
        return { text: `${MINUS}(${atom.text} + ${babs(b)})/${q}`, tex: `-\\frac{${atom.tex} + ${babs(b)}}{${q}}` }
      }
      return { text: `(${innerT})/${q}`, tex: `\\frac{${innerX}}{${q}}` }
    }
  }
  let t: string
  let x: string
  if (eq(alpha, ONE)) {
    t = atom.text
    x = atom.tex
  } else if (eq(alpha, neg(ONE))) {
    t = `${MINUS}${atom.text}`
    x = `-${atom.tex}`
  } else if (isInt(alpha)) {
    t = `${rText(alpha)} ${atom.text}`
    x = `${rTex(alpha)}${atom.tex}`
  } else {
    t = `(${rText(alpha)}) ${atom.text}`
    x = `${rTex(alpha)}${atom.tex}`
  }
  if (isZero(beta)) return { text: t, tex: x }
  return {
    text: `${t} ${sgn(beta) < 0 ? MINUS : '+'} ${rText(sgn(beta) < 0 ? neg(beta) : beta)}`,
    tex: `${x} ${sgn(beta) < 0 ? '-' : '+'} ${rTex(sgn(beta) < 0 ? neg(beta) : beta)}`,
  }
}

/** Σ r_p ln p + r0, written: "ln 3 − ln 2", "2 ln 2 + 1". Positive terms first. */
function llText(a: LogLin): LogForm {
  const terms: { c: R; t: string; x: string }[] = []
  const primes = [...a.ln.keys()].sort((p, q) => (BigInt(p) < BigInt(q) ? -1 : 1))
  for (const p of primes) terms.push({ c: a.ln.get(p) as R, t: `ln ${p}`, x: `\\ln ${p}` })
  if (!isZero(a.r0)) terms.push({ c: a.r0, t: '', x: '' })
  terms.sort((u, w) => (sgn(u.c) > 0 ? 0 : 1) - (sgn(w.c) > 0 ? 0 : 1))
  if (terms.length === 0) return { text: '0', tex: '0' }
  let text = ''
  let tex = ''
  terms.forEach((term, i) => {
    const negative = sgn(term.c) < 0
    const mag = negative ? neg(term.c) : term.c
    let bodyT: string
    let bodyX: string
    if (term.t === '') {
      bodyT = rText(mag)
      bodyX = rTex(mag)
    } else if (eq(mag, ONE)) {
      bodyT = term.t
      bodyX = term.x
    } else {
      bodyT = isInt(mag) ? `${rText(mag)} ${term.t}` : `(${rText(mag)}) ${term.t}`
      bodyX = `${rTex(mag)}${term.x}`
    }
    if (i === 0) {
      text = `${negative ? MINUS : ''}${bodyT}`
      tex = `${negative ? '-' : ''}${bodyX}`
    } else {
      text += ` ${negative ? MINUS : '+'} ${bodyT}`
      tex += ` ${negative ? '-' : '+'} ${bodyX}`
    }
  })
  return { text, tex }
}

/** Σ k_p ln p with INTEGER k_p and no constant, as one log: ln(3/2). Null otherwise. */
function llAsOneLog(a: LogLin): R | null {
  if (!isZero(a.r0)) return null
  let n = 1n
  let d = 1n
  for (const [p, c] of a.ln) {
    if (!isInt(c) || babs(c.n) > 64n) return null
    const pp = BigInt(p) ** babs(c.n)
    if (c.n > 0n) n *= pp
    else d *= pp
  }
  return mk(n, d)
}

/** r = s^k with k ≥ 2 as large as possible (s rational > 0), else null. */
function perfectPower(r: R): { s: R; k: number } | null {
  const ll = lnOf(r)
  if (!ll || ll.ln.size === 0) return null
  let g = 0n
  for (const c of ll.ln.values()) g = bgcd(g, c.n)
  if (g < 2n) return null
  const s = llAsOneLog(llScale(ll, mk(1n, g)))
  return s ? { s, k: Number(g) } : null
}

const wrap = (f: LogForm): LogForm => (/ [+−] /.test(f.text) ? { text: `(${f.text})`, tex: `\\left(${f.tex}\\right)` } : f)

/** m·v + c in text: "x", "x − 1", "0.2t" is (1/5)t, "2x + 1". */
function linText(m: R, c: R, v: string): LogForm {
  const head = (k: R): LogForm => {
    if (eq(k, ONE)) return { text: v, tex: v }
    if (eq(k, neg(ONE))) return { text: `${MINUS}${v}`, tex: `-${v}` }
    if (isInt(k)) return { text: `${rText(k)}${v}`, tex: `${rTex(k)}${v}` }
    if (dText(k).includes('.')) return { text: `${dText(k)}${v}`, tex: `${dTex(k)}${v}` }
    return { text: `(${rText(k)})${v}`, tex: `${rTex(k)}${v}` }
  }
  const h = head(m)
  if (isZero(c)) return h
  const negc = sgn(c) < 0
  const mc = negc ? neg(c) : c
  return { text: `${h.text} ${negc ? MINUS : '+'} ${rText(mc)}`, tex: `${h.tex} ${negc ? '-' : '+'} ${rTex(mc)}` }
}

/** B^(u) written: "2ˣ", "3^(x − 1)", "e^(0.2t)". */
function powerText(b: ExpBase, m: R, c: R, v: string): LogForm {
  const bt = b.e ? 'e' : isInt(b.r) ? rText(b.r) : `(${dText(b.r)})`
  const bx = b.e ? 'e' : isInt(b.r) ? rTex(b.r) : `\\left(${dTex(b.r)}\\right)`
  const u = linText(m, c, v)
  const supT = u.text === v && v.length === 1 && SUPV[v] ? `${bt}${SUPV[v]}` : `${bt}^(${u.text})`
  return { text: supT, tex: `${bx}^{${u.tex}}` }
}
const SUPV: Record<string, string> = { x: 'ˣ', t: 'ᵗ', n: 'ⁿ' }

function termText(t: ExpTerm, v: string): LogForm {
  const p = powerText(t.base, t.m, t.c, v)
  if (eq(t.coef, ONE)) return p
  if (eq(t.coef, neg(ONE))) return { text: `${MINUS}${p.text}`, tex: `-${p.tex}` }
  const c = isInt(t.coef) ? { text: rText(t.coef), tex: rTex(t.coef) } : { text: `(${rText(t.coef)})`, tex: rTex(t.coef) }
  return { text: `${c.text}·${p.text}`, tex: `${c.tex}\\cdot ${p.tex}` }
}

// ---------------------------------------------------------------------------
// Solving
// ---------------------------------------------------------------------------

export type ExpSolution =
  | {
      kind: 'one'
      /** the solution, in double precision (from the exact form) */
      x: number
      /**
       * Equal exact forms, the one a class writes first: ["log₂(7/3)",
       * "ln(7/3)/ln 2"], ["5 ln 4", "10 ln 2"], ["ln 3/(ln 3 − ln 2)"].
       * A rational answer has one form: ["3"].
       */
      forms: LogForm[]
      /** true when the answer is a rational number (2ˣ = 8 → 3) */
      rational: boolean
      /** the route: isolate the power, take logs, solve — one line per step */
      steps: LogForm[]
    }
  | { kind: 'none'; reason: string; steps: LogForm[] }
  | { kind: 'all'; steps: LogForm[] }

const rForm = (r: R): LogForm => ({ text: rText(r), tex: rTex(r) })

/**
 * Solve f(x) = g(x) for two exponential shapes. Null when the equation is not
 * one this module solves exactly (see the header) — including when neither
 * side has a power of x in it.
 */
export function solveExpEquation(f: ExpShape, g: ExpShape, v = 'x'): ExpSolution | null {
  try {
    return solveImpl(f, g, v)
  } catch {
    return null
  }
}

function solveImpl(f0: ExpShape, g0: ExpShape, v: string): ExpSolution | null {
  if (!f0.term && !g0.term) return null
  // the power on the left
  const [f, g] = f0.term ? [f0, g0] : [g0, f0]
  const t = f.term as ExpTerm

  if (!g.term || (sameBase(g.term.base, t.base) && eq(g.term.m, t.m) && eq(g.term.c, t.c))) {
    // ---- one power: (A − A₂)·B^u = D
    const A = g.term ? sub(t.coef, g.term.coef) : t.coef
    const D = sub(g.k, f.k)
    const steps: LogForm[] = []
    const P = powerText(t.base, t.m, t.c, v)
    if (isZero(A)) {
      return isZero(D) ? { kind: 'all', steps } : { kind: 'none', reason: `the powers cancel, leaving 0 = ${rText(D)}`, steps }
    }
    const R0 = div(D, A)
    if (!eq(A, ONE) || !isZero(f.k) || g.term) steps.push({ text: `${P.text} = ${rText(R0)}`, tex: `${P.tex} = ${rTex(R0)}` })
    if (sgn(R0) <= 0) {
      const bt = t.base.e ? 'e' : rText(t.base.r)
      return {
        kind: 'none',
        reason: `${P.text} is always positive, so it is never ${rText(R0)}: no solution`,
        steps: steps.concat([{ text: `A power of ${bt} is always positive, so there is no solution.`, tex: `\\text{A power of ${bt} is always positive: no solution}` }]),
      }
    }
    const u = linText(t.m, t.c, v)
    const lnR = lnOf(R0)
    const lnB = lnBase(t.base)
    if (!lnR || !lnB) return null
    // u = log_B R, so x = (log_B R − c)/m
    const q = llZero(lnR) ? ZERO : llRatio(lnR, lnB)
    const alpha = div(ONE, t.m)
    const beta = neg(div(t.c, t.m))
    if (q !== null) {
      // a rational answer: 2ˣ = 8, 4ˣ = 8, e^(x−1) = 1
      const x = add(mul(q, alpha), beta)
      const at = rForm(q)
      steps.push({ text: `${u.text} = ${at.text}`, tex: `${u.tex} = ${at.tex}` })
      if (u.text !== v) steps.push({ text: `${v} = ${rText(x)}`, tex: `${v} = ${rTex(x)}` })
      return { kind: 'one', x: num(x), forms: [rForm(x)], rational: true, steps }
    }
    const atom = logAtom(t.base, R0)
    steps.push({ text: `${u.text} = ${atom.text}`, tex: `${u.tex} = ${atom.tex}` })
    const forms: LogForm[] = [affine(alpha, atom, beta)]
    if (!t.base.e) {
      // ln R / ln B: log₂(7/3) = ln(7/3)/ln 2
      const lnAtom = logAtom({ e: true }, R0)
      const lnB2 = logAtom({ e: true }, t.base.r, true)
      const pAbs = babs(alpha.n)
      const numT = pAbs === 1n ? lnAtom.text : `${pAbs} ${lnAtom.text}`
      const numX = pAbs === 1n ? lnAtom.tex : `${pAbs}${lnAtom.tex}`
      const denT = alpha.d === 1n ? lnB2.text : `(${alpha.d} ${lnB2.text})`
      const denX = alpha.d === 1n ? lnB2.tex : `${alpha.d}${lnB2.tex}`
      const sign = alpha.n < 0n
      let text = `${sign ? MINUS : ''}${numT}/${denT}`
      let tex = `${sign ? '-' : ''}\\frac{${numX}}{${denX}}`
      if (!isZero(beta)) {
        text += ` ${sgn(beta) < 0 ? MINUS : '+'} ${rText(sgn(beta) < 0 ? neg(beta) : beta)}`
        tex += ` ${sgn(beta) < 0 ? '-' : '+'} ${rTex(sgn(beta) < 0 ? neg(beta) : beta)}`
      }
      forms.push({ text, tex })
    } else {
      // ln of a perfect power: 5 ln 4 = 10 ln 2
      const pp = perfectPower(R0)
      if (pp) forms.push(affine(mul(alpha, mk(BigInt(pp.k))), logAtom({ e: true }, pp.s), beta))
    }
    const x = num(alpha) * llValue(lnR) / llValue(lnB) + num(beta)
    if (u.text !== v) steps.push({ text: `${v} = ${forms[0].text}`, tex: `${v} = ${forms[0].tex}` })
    if (!Number.isFinite(x)) return null
    return { kind: 'one', x, forms, rational: false, steps }
  }

  // ---- two powers, nothing added: A₁·B₁^u₁ = A₂·B₂^u₂
  const s = g.term
  if (!isZero(sub(f.k, g.k))) return null
  const ratio = div(s.coef, t.coef)
  const steps: LogForm[] = []
  const left = termText(t, v)
  const right = termText(s, v)
  if (sgn(ratio) <= 0) {
    return {
      kind: 'none',
      reason: `${left.text} and ${right.text} have opposite signs everywhere: no solution`,
      steps,
    }
  }
  const l1 = lnBase(t.base)
  const l2 = lnBase(s.base)
  const lA1 = lnOf(sgn(t.coef) < 0 ? neg(t.coef) : t.coef)
  const lA2 = lnOf(sgn(s.coef) < 0 ? neg(s.coef) : s.coef)
  if (!l1 || !l2 || !lA1 || !lA2) return null
  // ln|A₁| + (m₁x + c₁) ln B₁ = ln|A₂| + (m₂x + c₂) ln B₂
  const sideText = (A: R, b: ExpBase, m: R, c: R): LogForm => {
    const parts: LogForm[] = []
    const absA = sgn(A) < 0 ? neg(A) : A
    if (!eq(absA, ONE)) parts.push(logAtom({ e: true }, absA))
    const u = linText(m, c, v)
    if (b.e) parts.push(u)
    else {
      const lb = logAtom({ e: true }, b.r)
      const uw = wrap(u)
      parts.push({ text: `${uw.text} ${lb.text}`, tex: `${uw.tex}${lb.tex}` })
    }
    return { text: parts.map((p) => p.text).join(' + '), tex: parts.map((p) => p.tex).join(' + ') }
  }
  const sl = sideText(t.coef, t.base, t.m, t.c)
  const sr = sideText(s.coef, s.base, s.m, s.c)
  steps.push({ text: `Take ln of both sides: ${sl.text} = ${sr.text}`, tex: `${sl.tex} = ${sr.tex}` })
  let Dn = llSub(llScale(l1, t.m), llScale(l2, s.m))
  let Nm = llAdd(llSub(lA2, lA1), llSub(llScale(l2, s.c), llScale(l1, t.c)))
  if (llZero(Dn)) {
    return llZero(Nm) ? { kind: 'all', steps } : { kind: 'none', reason: 'the x terms cancel and what is left is false: no solution', steps }
  }
  {
    const dt = llText(Dn)
    const single = Dn.ln.size + (isZero(Dn.r0) ? 0 : 1) === 1
    const lhs: LogForm =
      dt.text === '1' ? { text: v, tex: v }
      : dt.text === `${MINUS}1` ? { text: `${MINUS}${v}`, tex: `-${v}` }
      : Dn.ln.size === 0 ? { text: `${dt.text}${v}`, tex: `${dt.tex}${v}` }
      : single ? { text: `${v} ${dt.text}`, tex: `${v}\\,${dt.tex}` }
      : { text: `${v}(${dt.text})`, tex: `${v}\\left(${dt.tex}\\right)` }
    steps.push({ text: `Collect the ${v} terms: ${lhs.text} = ${llText(Nm).text}`, tex: `${lhs.tex} = ${llText(Nm).tex}` })
  }
  // a positive denominator, integer coefficients
  if (llValue(Dn) < 0) {
    Dn = llScale(Dn, neg(ONE))
    Nm = llScale(Nm, neg(ONE))
  }
  let L = 1n
  const coefs = [Dn.r0, Nm.r0, ...Dn.ln.values(), ...Nm.ln.values()]
  for (const c of coefs) L = (L / bgcd(L, c.d)) * c.d
  let G = 0n
  for (const c of coefs) G = bgcd(G, (c.n * L) / c.d)
  if (G === 0n) G = 1n
  Dn = llScale(Dn, mk(L, G))
  Nm = llScale(Nm, mk(L, G))
  const x = llValue(Nm) / llValue(Dn)
  if (!Number.isFinite(x)) return null
  if (llZero(Nm)) {
    steps.push({ text: `${v} = 0`, tex: `${v} = 0` })
    return { kind: 'one', x: 0, forms: [rForm(ZERO)], rational: true, steps }
  }
  const q = llRatio(Nm, Dn)
  if (q !== null) {
    steps.push({ text: `${v} = ${rText(q)}`, tex: `${v} = ${rTex(q)}` })
    return { kind: 'one', x: num(q), forms: [rForm(q)], rational: true, steps }
  }
  const forms: LogForm[] = []
  if (Dn.ln.size === 0) {
    // only ln e's below: x = Nm / r0
    forms.push(llText(llScale(Nm, div(ONE, Dn.r0))))
  } else {
    const nt = wrap(llText(Nm))
    const dt = wrap(llText(Dn))
    forms.push({ text: `${nt.text}/${dt.text}`, tex: `\\frac{${llText(Nm).tex}}{${llText(Dn).tex}}` })
    // each side one log: ln 3/ln(3/2)
    const n1 = llAsOneLog(Nm)
    const d1 = llAsOneLog(Dn)
    if (n1 && d1 && (Nm.ln.size > 1 || Dn.ln.size > 1)) {
      const a = logAtom({ e: true }, n1)
      const b = logAtom({ e: true }, d1)
      forms.push({ text: `${a.text}/${b.text}`, tex: `\\frac{${a.tex}}{${b.tex}}` })
    }
    // …which is one logarithm: log₂ 3, log_(3/2) 3
    if (n1 && d1 && sgn(sub(d1, ONE)) > 0) forms.push(logAtom({ e: false, r: d1 }, n1))
  }
  steps.push({ text: `${v} = ${forms[0].text}`, tex: `${v} = ${forms[0].tex}` })
  return { kind: 'one', x, forms, rational: false, steps }
}

/** Unicode superscript of an integer (for callers that print powers). */
export const supText = (n: number | string): string => String(n).split('').map((c) => SUP[c] ?? c).join('')

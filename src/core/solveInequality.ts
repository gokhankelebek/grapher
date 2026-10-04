// ============================================================================
// src/core/solveInequality.ts — solve an inequality (or equation) in ONE
// variable exactly, and show the working the way it is taught.
//
//   export function solveInequality(src, opts?): SolveOutcome
//
// Input: a line in x with ONE relation, or a compound —
//   x^2 - 4 > 0            (x-1)/(x+2) <= 0          |2x - 3| < 5
//   sqrt(x+1) >= x - 1     e^x > 3                   sin(x) >= 1/2 {0 <= x <= 2pi}
//   x^3 >= 4x              2 < 3x - 1 <= 8           x^2 > 1 and x < 3
//   |x - 4| >= 2 or x = 0  x^2 - 4 = 0 (an equation: the solution set is points)
// Either side may hold x: f(x) R g(x) is solved as h = f − g R 0. A
// restriction {…} or a typed interval limits the universe (needed for trig).
// Constant-only bounds (x > 2, −1 ≤ x < 3) must keep working exactly as the
// old number-line parser did (./parse/inequality.ts) — this supersedes it.
//
// METHOD — the number-line method a Precalc / Math 3 student is taught:
//   1. h(x) = left − right; its domain (domainRange.naturalDomain of h).
//   2. Critical values: the zeros of h AND the points where h is undefined
//      (poles, domain ends) — exact where exact (exactForm / verifiedExact,
//      roots of polynomials by the factored/exact machinery where possible:
//      ±√2, (1 ± √5)/2, π/6 + 2kπ within the universe).
//   3. A test point in each interval between critical values (the nicest
//      number inside: an integer if there is one, else a simple fraction),
//      h evaluated there, its sign.
//   4. The solution set: the intervals whose sign satisfies R, plus the zeros
//      when R includes equality (≤, ≥, =) — but NEVER a point outside the
//      domain (a pole is always open, √ domain ends closed only if h is
//      defined and satisfies R there).
//   5. A written conclusion: "x² − 4 > 0 for x < −2 or x > 2, so the solution
//      is (−∞, −2) ∪ (2, ∞)".
// Absolute value inequalities ALSO get the distance reading when they are of
// the shape |x − a| R b (or |mx + c| R b): "the numbers within 3/2 of 5/2".
// Compounds: each clause solved, then ∩ (and) / ∪ (or) of the solution sets.
//
// Uses ./domainRange (naturalDomain, describeSet), ./signChart (signs),
// ./exact, ./parse (parseExpression / parseAst / analyzeExpr), and
// ./parse/condition (Piece algebra: union / intersect / complement, which
// this module may import — condition.ts is the shared interval engine).
//
// Pure TypeScript: no DOM, no imports from src/ui. Owned by the core agent.
//
// ---------------------------------------------------------------------------
// HOW IT IS SOLVED (implementation notes — the contract above is unchanged)
//
// Each clause h R 0 is read by the first engine that fits it:
//
//   * RATIONAL (exact). h is a ratio of polynomials with rational
//     coefficients (x² − 4, (x−1)/(x+2), x³ − 4x, 1/x − 1). Everything is
//     bigint fractions: rational roots by the rational root theorem with
//     their multiplicities, the rest by square-free decomposition, a
//     quadratic factor by the quadratic formula as an exact surd ((1 ± √5)/2),
//     anything of degree ≥ 3 left over numerically (snapped with exactForm
//     where it is a closed form). Test-point values are exact fractions. The
//     denominator's roots are the undefined points, cancelled or not (a hole
//     is still not in the domain). Also gives h in factored form.
//   * ABSOLUTE-LINEAR (exact). h = α·|mx + c| + β — |2x − 3| < 5,
//     2|x − 1| + 3 ≥ 7. Critical values centre ± radius, and the distance
//     reading.
//   * POLYNOMIAL WITH REAL COEFFICIENTS. Like RATIONAL, in doubles (x < √2,
//     x ≤ 2π, x² > π): roots by the quadratic formula / derivative splitting,
//     snapped to closed forms.
//   * NUMERIC — anything else (√, e^x, log, trig, mixtures). A dense scan of
//     the universe ∩ window (default ±1000; 1/50 steps near 0, coarser far
//     out), with: sign changes bisected to the last bit and classified as a
//     zero, a pole or a jump by what |h| does as the bracket closes; exact
//     zero samples; touching zeros (local minima of |h| refined by golden
//     section); NaN transitions bisected into domain ends (overflow far out —
//     e^x/(e^x+1) past x ≈ 710 — is recognised and not taken for an end);
//     and the zeros of every denominator / tan-cos / csc-sin in the formula
//     scanned on their own, so a hole or pole between samples is still found.
//     Every point is snapped to a closed form: exactForm first, then ln r,
//     log r, log₂ r, e^r, and (for trig) arcsin r + kπ style forms, each
//     verified against h itself.
//
// A trig clause with no restriction that repeats every 2π (or 4π, 6π, 8π) is
// solved over one period [0, P) — the universe is reported, and a note says
// so. Points in a scan's window are honest within it; a note says when the
// endpoints are decimals or the search was windowed.
// ============================================================================

import type { IntervalPart, RealSet } from './domainRange'
import { describeSet, overflowEdge } from './domainRange'
import type { ExactForm } from './exact'
import { exactForm, verifiedExact } from './exact'
import { analyzeExpr, evalAst, parseAst, type ExprNode } from './parse'
import { CondError, newCtx, parseCondition, type Piece } from './parse/condition'
import { expShapeOf, solveExpEquation } from './expSolve'

export type Relation = '<' | '<=' | '>' | '>=' | '=' | '!='

/** One critical value on the number line. */
export interface CriticalValue {
  x: number
  exact: ExactForm | null
  /** a zero of h (makes h = 0) or a point where h is undefined */
  why: 'zero' | 'undefined' | 'domain-end'
  /** does the solution set contain this point? (drawn ● if so, ○ if not) */
  included: boolean
  /**
   * (additive) the multiplicity of a zero when h is a polynomial or a ratio of
   * polynomials and it is known — 2 for (x − 3)²: no sign change there.
   */
  multiplicity?: number
}

/** One row of the test-point table. */
export interface TestRow {
  /** the open interval between consecutive critical values (±Infinity ends) */
  lo: number
  hi: number
  /** the test point and its exact text ("0", "−3", "1/2") */
  t: number
  tText: string
  /** h(t), its text, and sign; null where h is undefined on this interval */
  value: number | null
  valueText: string
  sign: 1 | -1 | 0 | null
  /** does this interval satisfy the relation? */
  satisfies: boolean
}

/** One clause's full working (a compound has one per clause). */
export interface ClauseWork {
  /** the clause as typed and as h R 0, in text and TeX */
  text: string
  tex: string
  hText: string
  hTex: string
  relation: Relation
  /** the domain of h (the universe ∩ natural domain) */
  domain: RealSet | null
  critical: CriticalValue[]
  table: TestRow[]
  /** this clause's solution set */
  solution: RealSet
  /** "the numbers within 3/2 of 5/2" for |x − a| R b, else null */
  distance: { center: number; centerText: string; radius: number; radiusText: string; sentence: string } | null
  /**
   * (additive) h in factored form when h is a polynomial or a ratio of
   * polynomials with rational coefficients — "x(x + 2)(x − 2)",
   * "(x − 1)/(x + 2)" — else absent / null.
   */
  factored?: { text: string; tex: string } | null
  /**
   * (additive) an exponential equation solved by its structure
   * (./expSolve.ts): the zero's equal exact forms ("log₂(7/3)",
   * "ln(7/3)/ln 2") and the steps that produce them. Absent otherwise.
   */
  exp?: { x: number; forms: { text: string; tex: string }[]; steps: { text: string; tex: string }[] } | null
}

export interface SolveResult {
  ok: true
  /** the whole input's solution set (clauses combined), in interval and set-builder form */
  solution: RealSet
  /** 'and' / 'or' structure of the input, for the stacked view (A, B, A ∩ B) */
  combine: 'single' | 'and' | 'or'
  clauses: ClauseWork[]
  /** the written conclusion, plain text and TeX */
  conclusion: string
  conclusionTex: string
  /** the universe the input was solved over ({0 ≤ x ≤ 2π}), or null for ℝ */
  universe: IntervalPart | null
  /** the variable as typed (x unless the line used another single letter) */
  variable: string
  /** true when every endpoint is exact (no decimal approximations) */
  exact: boolean
  /** honest caveats ("solved numerically between −1000 and 1000", …) */
  notes: string[]
}

export type SolveOutcome = SolveResult | { ok: false; error: string; pos?: number }

export interface SolveOptions {
  /** search window for numeric root finding beyond the exact methods */
  window?: [number, number]
}

// ============================================================================
// Errors and small helpers
// ============================================================================

class SolveError extends Error {
  pos: number | undefined
  constructor(message: string, pos?: number) {
    super(message)
    this.pos = pos
  }
}

function fail(message: string, pos?: number): never {
  throw new SolveError(message, pos)
}

const MINUS = '−'
const DEFAULT_WINDOW: [number, number] = [-1000, 1000]
/** More critical values than this in one clause is not a number line any more. */
const MAX_CRITICAL = 400

type Fn = (x: number) => number
type Sign = 1 | -1 | 0
type Why = CriticalValue['why']

const same = (a: number, b: number): boolean =>
  a === b || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)))

const SUP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻',
}
const SUB: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
}
const sup = (n: number | string): string => String(n).split('').map((c) => SUP[c] ?? c).join('')

/** Three places, trailing zeros dropped, a real minus sign (signChart's decimalText). */
function decimalText(v: number): string {
  if (v === Infinity) return '∞'
  if (v === -Infinity) return `${MINUS}∞`
  if (!Number.isFinite(v)) return '—'
  const mag = Math.abs(v)
  if (mag !== 0 && (mag >= 1e7 || mag < 5e-4)) return v.toExponential(2).replace('-', MINUS)
  const s = v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
  return (s === '-0' ? '0' : s).replace('-', MINUS)
}

/** Four significant digits, a real minus — how domainRange prints an inexact endpoint. */
function sig4Text(v: number): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : `${MINUS}∞`
  if (Math.abs(v) < 1e-12) return '0'
  const s = String(Number(v.toPrecision(4)) + 0)
  return s.startsWith('-') ? MINUS + s.slice(1) : s
}

/** Four significant digits — how domainRange prints an inexact endpoint. */
function decimalTex(v: number): string {
  if (!Number.isFinite(v)) return v > 0 ? '\\infty' : '-\\infty'
  const s = String(Number(v.toPrecision(4)) + 0)
  if (/e/.test(s)) {
    const [m, e] = s.split('e')
    return `${m}\\cdot 10^{${Number(e)}}`
  }
  return s
}

const REL_TEXT: Record<Relation, string> = { '<': '<', '<=': '≤', '>': '>', '>=': '≥', '=': '=', '!=': '≠' }
const REL_TEX: Record<Relation, string> = { '<': '<', '<=': '\\le', '>': '>', '>=': '\\ge', '=': '=', '!=': '\\ne' }

const flipRel = (r: Relation): Relation =>
  r === '<' ? '>' : r === '<=' ? '>=' : r === '>' ? '<' : r === '>=' ? '<=' : r

/** Does a value of this sign satisfy h R 0? */
function sat(rel: Relation, s: Sign): boolean {
  switch (rel) {
    case '<': return s < 0
    case '<=': return s <= 0
    case '>': return s > 0
    case '>=': return s >= 0
    case '=': return s === 0
    case '!=': return s !== 0
  }
}

const includesEquality = (r: Relation): boolean => r === '<=' || r === '>=' || r === '='

// ============================================================================
// Exact rationals (bigint)
// ============================================================================

interface Q { n: bigint; d: bigint }

const babs = (a: bigint): bigint => (a < 0n ? -a : a)
function bgcd(a: bigint, b: bigint): bigint {
  a = babs(a)
  b = babs(b)
  while (b !== 0n) {
    const t = a % b
    a = b
    b = t
  }
  return a
}

function mkQ(n: bigint, d: bigint = 1n): Q {
  if (d === 0n) throw new Error('zero denominator')
  if (d < 0n) { n = -n; d = -d }
  const g = bgcd(n, d)
  return g > 1n ? { n: n / g, d: d / g } : { n, d }
}

const Q0: Q = { n: 0n, d: 1n }
const Q1: Q = { n: 1n, d: 1n }
const qadd = (a: Q, b: Q): Q => mkQ(a.n * b.d + b.n * a.d, a.d * b.d)
const qsub = (a: Q, b: Q): Q => mkQ(a.n * b.d - b.n * a.d, a.d * b.d)
const qmul = (a: Q, b: Q): Q => mkQ(a.n * b.n, a.d * b.d)
const qdiv = (a: Q, b: Q): Q => mkQ(a.n * b.d, a.d * b.n)
const qneg = (a: Q): Q => ({ n: -a.n, d: a.d })
const qabs = (a: Q): Q => ({ n: babs(a.n), d: a.d })
const qz = (a: Q): boolean => a.n === 0n
const qsign = (a: Q): Sign => (a.n > 0n ? 1 : a.n < 0n ? -1 : 0)
const qeq = (a: Q, b: Q): boolean => a.n === b.n && a.d === b.d
const qnum = (a: Q): number => Number(a.n) / Number(a.d)
const qint = (a: Q): boolean => a.d === 1n

function qText(a: Q): string {
  const s = a.n < 0n ? MINUS : ''
  return a.d === 1n ? `${s}${babs(a.n)}` : `${s}${babs(a.n)}/${a.d}`
}
function qTex(a: Q): string {
  const s = a.n < 0n ? '-' : ''
  return a.d === 1n ? `${s}${babs(a.n)}` : `${s}\\frac{${babs(a.n)}}{${a.d}}`
}
const qExact = (a: Q): ExactForm => ({ text: qText(a), tex: qTex(a), value: qnum(a) })

/** A typed decimal ("0.5", ".25", "1e3") as the exact fraction it names. */
function qFromDecimal(raw: string): Q | null {
  const m = /^(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw.trim())
  if (!m) return null
  const int = m[1] ?? ''
  const frac = m[2] ?? ''
  if (int === '' && frac === '') return null
  const exp = Number(m[3] ?? 0)
  if (Math.abs(exp) > 30) return null
  let n = BigInt((int || '0') + frac)
  let d = 10n ** BigInt(frac.length)
  if (exp > 0) n *= 10n ** BigInt(exp)
  else if (exp < 0) d *= 10n ** BigInt(-exp)
  return mkQ(n, d)
}

/** A double that IS a fraction with a modest denominator (to the last ulp or two), else null. */
function qFromNumber(v: number): Q | null {
  if (!Number.isFinite(v)) return null
  if (Number.isInteger(v)) return Math.abs(v) <= Number.MAX_SAFE_INTEGER ? mkQ(BigInt(v)) : null
  if (Math.abs(v) > 1e9) return null
  let x = v
  let h0 = 0, h1 = 1, k0 = 1, k1 = 0
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(x)
    const h2 = a * h1 + h0
    const k2 = a * k1 + k0
    if (k2 > 1e6) break
    h0 = h1; h1 = h2; k0 = k1; k1 = k2
    if (Math.abs(h1 / k1 - v) <= 4 * Number.EPSILON * Math.abs(v)) return mkQ(BigInt(h1), BigInt(k1))
    const fr = x - a
    if (fr === 0) break
    x = 1 / fr
  }
  return null
}

// ============================================================================
// Polynomials over Q (index = degree; [] is the zero polynomial)
// ============================================================================

type QP = Q[]

function qpTrim(p: QP): QP {
  let k = p.length
  while (k > 0 && qz(p[k - 1])) k--
  return k === p.length ? p : p.slice(0, k)
}
const qpDeg = (p: QP): number => p.length - 1
const qpLead = (p: QP): Q => p[p.length - 1]

function qpAdd(a: QP, b: QP): QP {
  const out: QP = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) out.push(qadd(a[i] ?? Q0, b[i] ?? Q0))
  return qpTrim(out)
}
const qpNeg = (a: QP): QP => a.map(qneg)
const qpSub = (a: QP, b: QP): QP => qpAdd(a, qpNeg(b))
function qpMul(a: QP, b: QP): QP {
  if (a.length === 0 || b.length === 0) return []
  const out: QP = new Array(a.length + b.length - 1).fill(Q0)
  for (let i = 0; i < a.length; i++) {
    if (qz(a[i])) continue
    for (let j = 0; j < b.length; j++) out[i + j] = qadd(out[i + j], qmul(a[i], b[j]))
  }
  return qpTrim(out)
}
const qpScale = (a: QP, c: Q): QP => qpTrim(a.map((x) => qmul(x, c)))
const qpEq = (a: QP, b: QP): boolean => a.length === b.length && a.every((x, i) => qeq(x, b[i]))

function qpDivmod(a: QP, b: QP): { q: QP; r: QP } {
  let r = a.slice()
  const db = qpDeg(b)
  if (qpDeg(r) < db) return { q: [], r }
  const q: QP = new Array(qpDeg(r) - db + 1).fill(Q0)
  const lb = qpLead(b)
  while (r.length > 0 && qpDeg(r) >= db) {
    const k = qpDeg(r) - db
    const c = qdiv(qpLead(r), lb)
    q[k] = c
    const sub: QP = new Array(k).fill(Q0).concat(b.map((x) => qmul(x, c)))
    r = qpSub(r, sub)
  }
  return { q: qpTrim(q), r }
}

const qpDeriv = (a: QP): QP => qpTrim(a.slice(1).map((c, i) => qmul(c, mkQ(BigInt(i + 1)))))
const qpMonic = (a: QP): QP => (a.length === 0 ? a : qpScale(a, qdiv(Q1, qpLead(a))))

function qpGcd(a: QP, b: QP): QP {
  let x = a, y = b
  while (y.length > 0) {
    const { r } = qpDivmod(x, y)
    x = y
    y = r
  }
  return qpMonic(x)
}

function qpEval(p: QP, t: Q): Q {
  let acc = Q0
  for (let i = p.length - 1; i >= 0; i--) acc = qadd(qmul(acc, t), p[i])
  return acc
}

function qpEvalF(p: QP, x: number): number {
  let acc = 0
  for (let i = p.length - 1; i >= 0; i--) acc = acc * x + qnum(p[i])
  return acc
}

/** Square-free decomposition (Yun): p = lead · Π fᵢ^i with each fᵢ monic and square-free. */
function squareFree(p: QP): { f: QP; mult: number }[] {
  const out: { f: QP; mult: number }[] = []
  if (qpDeg(p) < 1) return out
  const dp = qpDeriv(p)
  const a0 = qpGcd(p, dp)
  let b = qpDivmod(p, a0).q
  const c = qpDivmod(dp, a0).q
  let d = qpSub(c, qpDeriv(b))
  let i = 1
  while (qpDeg(b) >= 1 && i < 64) {
    const a = qpGcd(b, d)
    if (qpDeg(a) >= 1) out.push({ f: qpMonic(a), mult: i })
    const b2 = qpDivmod(b, a).q
    const c2 = qpDivmod(d, a).q
    d = qpSub(c2, qpDeriv(b2))
    b = b2
    i++
  }
  return out
}

// ----------------------------------------------------------------------------
// Polynomial text — "x³ − 4x", "2x² − x + 1/2" — and TeX
// ----------------------------------------------------------------------------

function polyText(p: QP, v: string): string {
  if (p.length === 0) return '0'
  const terms: string[] = []
  for (let k = p.length - 1; k >= 0; k--) {
    const c = p[k]
    if (qz(c)) continue
    const neg = c.n < 0n
    const a = qabs(c)
    let body: string
    const xk = k === 0 ? '' : k === 1 ? v : `${v}${sup(k)}`
    if (k === 0) body = qText(a)
    else if (qeq(a, Q1)) body = xk
    else body = qint(a) ? `${qText(a)}${xk}` : `(${qText(a)})${xk}`
    if (terms.length === 0) terms.push(neg ? `${MINUS}${body}` : body)
    else terms.push(`${neg ? MINUS : '+'} ${body}`)
  }
  return terms.join(' ')
}

function polyTex(p: QP, v: string): string {
  if (p.length === 0) return '0'
  let out = ''
  for (let k = p.length - 1; k >= 0; k--) {
    const c = p[k]
    if (qz(c)) continue
    const neg = c.n < 0n
    const a = qabs(c)
    const xk = k === 0 ? '' : k === 1 ? v : `${v}^{${k}}`
    const body = k === 0 ? qTex(a) : qeq(a, Q1) ? xk : `${qTex(a)}${xk}`
    if (out === '') out = neg ? `-${body}` : body
    else out += ` ${neg ? '-' : '+'} ${body}`
  }
  return out
}

/** The primitive integer polynomial with the same roots (positive leading coefficient), and the factor s with p = ints / s. */
function primitiveInts(p: QP): { ints: bigint[]; s: Q } {
  let L = 1n
  for (const c of p) L = (L / bgcd(L, c.d)) * c.d
  let ints = p.map((c) => c.n * (L / c.d))
  let g = 0n
  for (const c of ints) g = bgcd(g, c)
  if (g === 0n) g = 1n
  ints = ints.map((c) => c / g)
  let s = mkQ(L, g)
  if (ints[ints.length - 1] < 0n) {
    ints = ints.map((c) => -c)
    s = qneg(s)
  }
  return { ints, s }
}

// ============================================================================
// Real roots
// ============================================================================

interface Root {
  x: number
  exact: ExactForm | null
  mult: number
  /** the factor for the factored form, e.g. "(2x − 1)" or "(x − √2)" */
  factorText: string
  factorTex: string
  /** order key for the factored form (x first, then by root) */
  key: number
}

/** Divisors of |n| (n ≠ 0), or null when |n| is too large to factor quickly. */
function divisors(n: bigint): bigint[] | null {
  n = babs(n)
  if (n === 0n) return null
  if (n > 10_000_000_000n) return null
  const out: bigint[] = []
  for (let i = 1n; i * i <= n; i++) {
    if (n % i === 0n) {
      out.push(i)
      if (i * i !== n) out.push(n / i)
    }
  }
  return out
}

/** The text of "x − r" for a root r, as a factor. */
function linFactor(v: string, r: ExactForm): { text: string; tex: string } {
  const t = r.text
  const simpleNeg = t.startsWith(MINUS) && !/[+−]/.test(t.slice(1).replace(/^\(.*\)$/, ''))
  const tex = r.tex
  if (simpleNeg) {
    const texPos = tex.startsWith('-') ? tex.slice(1) : tex
    return { text: `(${v} + ${t.slice(1)})`, tex: `\\left(${v} + ${texPos}\\right)` }
  }
  return { text: `(${v} ${MINUS} ${t})`, tex: `\\left(${v} - ${tex}\\right)` }
}

/** (−b ± √D)/(2a) for integers with D > 0 not a square: both roots, exact, ascending. */
function quadraticSurds(a: bigint, b: bigint, c: bigint): ExactForm[] {
  const D = b * b - 4n * a * c
  if (D <= 0n) return []
  // D = s²·n with n square-free (as far as trial division goes)
  let s = 1n
  let n = D
  for (let p = 2n; p * p <= n && p < 100000n; p++) {
    while (n % (p * p) === 0n) {
      n /= p * p
      s *= p
    }
  }
  let A = -b
  let S = s
  let Dn = 2n * a
  if (Dn < 0n) { A = -A; Dn = -Dn }
  const g = bgcd(bgcd(A, S), Dn)
  A /= g; S /= g; Dn /= g
  // values by the numerically stable form of the quadratic formula
  const af = Number(a), bf = Number(b), cf = Number(c)
  const sq = Math.sqrt(Number(D))
  const qv = -0.5 * (bf + (bf >= 0 ? sq : -sq))
  const vals = [qv / af, cf / qv].sort((u, w) => u - w)
  const out: ExactForm[] = []
  for (const sg of [-1, 1]) {
    // with Dn > 0 the "−" root is the smaller one
    const value = sg < 0 ? vals[0] : vals[1]
    const ef = exactForm(value)
    if (ef && ef.text.includes('√') && Math.abs(ef.value - value) <= 1e-12 * Math.max(1, Math.abs(value))) {
      out.push(ef)
      continue
    }
    const surd = `${S === 1n ? '' : S}√${n}`
    const surdTex = `${S === 1n ? '' : S}\\sqrt{${n}}`
    let text: string, tex: string
    if (A === 0n) {
      const core = `${sg < 0 ? MINUS : ''}${surd}`
      text = Dn === 1n ? core : `${core}/${Dn}`
      tex = `${sg < 0 ? '-' : ''}${Dn === 1n ? surdTex : `\\frac{${surdTex}}{${Dn}}`}`
    } else {
      const inner = `${A < 0n ? MINUS : ''}${babs(A)}${sg < 0 ? MINUS : '+'}${surd}`
      const innerTex = `${A < 0n ? '-' : ''}${babs(A)}${sg < 0 ? '-' : '+'}${surdTex}`
      text = Dn === 1n ? inner : `(${inner})/${Dn}`
      tex = Dn === 1n ? innerTex : `\\frac{${innerTex}}{${Dn}}`
    }
    out.push({ text, tex, value })
  }
  return out
}

/** Real roots of a polynomial with double coefficients (c[i] of x^i), ascending, touching roots included. */
function realRootsFloat(c0: number[]): number[] {
  const scale = Math.max(...c0.map((c) => Math.abs(c)), 0)
  const c = c0.slice()
  while (c.length > 0 && Math.abs(c[c.length - 1]) <= 1e-13 * scale) c.pop()
  const deg = c.length - 1
  if (deg < 1) return []
  if (deg === 1) return [-c[0] / c[1]]
  const ev = (x: number): number => {
    let acc = 0
    for (let i = deg; i >= 0; i--) acc = acc * x + c[i]
    return acc
  }
  const mag = (x: number): number => {
    let acc = 0
    for (let i = deg; i >= 0; i--) acc = acc * Math.abs(x) + Math.abs(c[i])
    return acc
  }
  if (deg === 2) {
    const [cc, b, a] = c
    const D = b * b - 4 * a * cc
    const tol = 1e-12 * (b * b + Math.abs(4 * a * cc))
    if (D < -tol) return []
    if (Math.abs(D) <= tol) return [-b / (2 * a)]
    const q = -0.5 * (b + (b >= 0 ? Math.sqrt(D) : -Math.sqrt(D)))
    return [q / a, cc / q].sort((u, w) => u - w)
  }
  const dc = c.slice(1).map((v, i) => v * (i + 1))
  const crit = realRootsFloat(dc)
  let B = 0
  for (let i = 0; i < deg; i++) B = Math.max(B, Math.abs(c[i] / c[deg]))
  B = 1 + B
  const pts = [-B, ...crit.filter((x) => x > -B && x < B), B]
  const out: number[] = []
  for (const x of crit) if (Math.abs(ev(x)) <= 1e-11 * mag(x)) out.push(x)
  for (let i = 0; i + 1 < pts.length; i++) {
    let a = pts[i], b = pts[i + 1]
    let fa = ev(a)
    const fb = ev(b)
    if (fa === 0 || fb === 0 || Math.sign(fa) === Math.sign(fb)) continue
    for (let k = 0; k < 200; k++) {
      const m = 0.5 * (a + b)
      if (m === a || m === b) break
      const fm = ev(m)
      if (fm === 0) { a = b = m; break }
      if (Math.sign(fm) === Math.sign(fa)) { a = m; fa = fm } else b = m
    }
    out.push(0.5 * (a + b))
  }
  out.sort((u, w) => u - w)
  return out.filter((x, i) => i === 0 || !same(x, out[i - 1]))
}

interface QRoots {
  roots: Root[]
  /** the constant in front of the factored form */
  content: Q
  /** irreducible factors with no real roots shown (or roots only approximated) */
  rest: { text: string; tex: string; mult: number }[]
}

/** Every real root of a nonzero polynomial over Q, exact where it can be, with multiplicities. */
function qRoots(p: QP, v: string): QRoots {
  const roots: Root[] = []
  const rest: { text: string; tex: string; mult: number }[] = []
  let content = qpLead(p)
  let r = qpMonic(p)
  // x = 0
  let z = 0
  while (r.length > 1 && qz(r[0])) { r = r.slice(1); z++ }
  if (z > 0) roots.push({ x: 0, exact: { text: '0', tex: '0', value: 0 }, mult: z, factorText: v, factorTex: v, key: -Infinity })
  // rational roots
  if (qpDeg(r) >= 1) {
    const { ints } = primitiveInts(r)
    const d0 = divisors(ints[0])
    const dn = divisors(ints[ints.length - 1])
    if (d0 && dn && d0.length * dn.length <= 20000) {
      const tried = new Set<string>()
      for (const pp of d0) {
        for (const qq of dn) {
          if (bgcd(pp, qq) !== 1n) continue
          for (const sg of [1n, -1n]) {
            if (qpDeg(r) < 1) break
            const cand = mkQ(sg * pp, qq)
            const key = `${cand.n}/${cand.d}`
            if (tried.has(key)) continue
            tried.add(key)
            // Σ aᵢ pⁱ q^(d−i) = 0 in integers first: cheap, and most candidates fail it
            {
              const { ints: cur } = primitiveInts(r)
              const d = cur.length - 1
              let acc = 0n
              let pp2 = 1n
              const qpow: bigint[] = [1n]
              for (let k = 1; k <= d; k++) qpow.push(qpow[k - 1] * cand.d)
              for (let k = 0; k <= d; k++) {
                acc += cur[k] * pp2 * qpow[d - k]
                pp2 *= cand.n
              }
              if (acc !== 0n) continue
            }
            let m = 0
            while (qpDeg(r) >= 1 && qz(qpEval(r, cand))) {
              r = qpDivmod(r, [qneg(cand), Q1]).q
              m++
            }
            if (m === 0) continue
            // the factor (qx − p): content absorbs 1/q per power
            const P = cand.n, D = cand.d
            const head = D === 1n ? v : `${D}${v}`
            const fText = `(${head} ${P > 0n ? MINUS : '+'} ${babs(P)})`
            const fTex = `\\left(${head} ${P > 0n ? '-' : '+'} ${babs(P)}\\right)`
            for (let k = 0; k < m; k++) content = qdiv(content, mkQ(D))
            roots.push({ x: qnum(cand), exact: qExact(cand), mult: m, factorText: fText, factorTex: fTex, key: qnum(cand) })
          }
        }
      }
    }
  }
  // what is left has no rational roots
  const pushQuadratic = (f: QP, mult: number): void => {
    const { ints } = primitiveInts(f)
    const [c, b, a] = ints
    const D = b * b - 4n * a * c
    if (D < 0n) {
      // irreducible over ℝ: shown as it is, the content absorbs its leading coefficient
      for (let k = 0; k < mult; k++) content = qdiv(content, mkQ(a))
      const qf = ints.map((x) => mkQ(x))
      rest.push({ text: `(${polyText(qf, v)})`, tex: `\\left(${polyTex(qf, v)}\\right)`, mult })
      return
    }
    for (const ef of quadraticSurds(a, b, c)) {
      const lf = linFactor(v, ef)
      roots.push({ x: ef.value, exact: ef, mult, factorText: lf.text, factorTex: lf.tex, key: ef.value })
    }
  }
  if (qpDeg(r) === 1) {
    // cannot happen (a rational root), but be safe
    const x0 = qneg(r[0])
    const lf = linFactor(v, qExact(x0))
    roots.push({ x: qnum(x0), exact: qExact(x0), mult: 1, factorText: lf.text, factorTex: lf.tex, key: qnum(x0) })
  } else if (qpDeg(r) === 2) {
    pushQuadratic(r, 1)
  } else if (qpDeg(r) >= 3) {
    for (const { f, mult } of squareFree(r)) {
      if (qpDeg(f) === 1) {
        const x0 = qneg(f[0])
        const lf = linFactor(v, qExact(x0))
        roots.push({ x: qnum(x0), exact: qExact(x0), mult, factorText: lf.text, factorTex: lf.tex, key: qnum(x0) })
        continue
      }
      if (qpDeg(f) === 2) { pushQuadratic(f, mult); continue }
      const xs = realRootsFloat(f.map(qnum))
      const found: Root[] = []
      for (const x0 of xs) {
        // polish with Newton in doubles, then snap
        let x = x0
        const df = qpDeriv(f)
        for (let k = 0; k < 4; k++) {
          const d = qpEvalF(df, x)
          if (d === 0) break
          const nx = x - qpEvalF(f, x) / d
          if (!Number.isFinite(nx)) break
          x = nx
        }
        const mag = (c: number): number => f.reduce((acc, k, i) => acc + Math.abs(qnum(k)) * Math.abs(c) ** i, 0)
        const ex = snapPoint(x, { bases: [], trig: false }, (c) => Math.abs(qpEvalF(f, c)) <= 1e-12 * Math.max(1, mag(c)), false)
        const lf = ex ? linFactor(v, ex) : { text: '', tex: '' }
        found.push({ x: ex ? ex.value : x, exact: ex, mult, factorText: lf.text, factorTex: lf.tex, key: x })
      }
      roots.push(...found)
      if (found.length !== qpDeg(f) || found.some((f2) => !f2.exact)) {
        // shown as the polynomial itself; its roots stay on the line regardless
        for (const f2 of found) { f2.factorText = ''; f2.factorTex = '' }
        const { ints } = primitiveInts(f)
        for (let k = 0; k < mult; k++) content = qdiv(content, mkQ(ints[ints.length - 1]))
        const qf = ints.map((x) => mkQ(x))
        rest.push({ text: `(${polyText(qf, v)})`, tex: `\\left(${polyTex(qf, v)}\\right)`, mult })
      }
    }
  }
  roots.sort((a, b) => a.key - b.key)
  return { roots, content, rest }
}

/** "x(x + 2)(x − 2)", "2(x − 1)²" from roots and leftovers. */
function factoredOf(qr: QRoots): { text: string; tex: string; count: number } {
  const parts: { text: string; tex: string }[] = []
  for (const r of qr.roots) {
    if (!r.factorText) continue
    parts.push({
      text: r.factorText + (r.mult > 1 ? sup(r.mult) : ''),
      tex: r.factorTex + (r.mult > 1 ? `^{${r.mult}}` : ''),
    })
  }
  for (const f of qr.rest) {
    parts.push({ text: f.text + (f.mult > 1 ? sup(f.mult) : ''), tex: f.tex + (f.mult > 1 ? `^{${f.mult}}` : '') })
  }
  return { text: parts.map((p) => p.text).join(''), tex: parts.map((p) => p.tex).join(''), count: parts.length }
}

// ============================================================================
// Expression trees
// ============================================================================

type IsVar = (n: ExprNode) => boolean

function hasVarNode(n: ExprNode, isVar: IsVar): boolean {
  switch (n.t) {
    case 'num': case 'const': return false
    case 'var': case 'param': return isVar(n)
    case 'neg': return hasVarNode(n.a, isVar)
    case 'bin': return hasVarNode(n.a, isVar) || hasVarNode(n.b, isVar)
    case 'call': return n.args.some((a) => hasVarNode(a, isVar))
    default: return true
  }
}

function constValue(n: ExprNode): number {
  try {
    return evalAst(n, 0)
  } catch {
    return Number.NaN
  }
}

const NATIVE: Record<string, (a: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  sec: (a) => 1 / Math.cos(a), csc: (a) => 1 / Math.sin(a), cot: (a) => Math.cos(a) / Math.sin(a),
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs,
  ln: Math.log, log: Math.log10, log2: Math.log2, log10: Math.log10, exp: Math.exp,
  floor: Math.floor, ceil: Math.ceil, sign: Math.sign,
}

/** A closure for h(x), with the parser's own semantics (calls it cannot do natively go through evalAst). */
function compileFn(n: ExprNode, isVar: IsVar): Fn {
  if (!hasVarNode(n, isVar)) {
    const v = constValue(n)
    return () => v
  }
  switch (n.t) {
    case 'var': case 'param': return (x) => x
    case 'neg': {
      const a = compileFn(n.a, isVar)
      return (x) => -a(x)
    }
    case 'bin': {
      const a = compileFn(n.a, isVar)
      const b = compileFn(n.b, isVar)
      switch (n.op) {
        case '+': return (x) => a(x) + b(x)
        case '-': return (x) => a(x) - b(x)
        case '*': return (x) => a(x) * b(x)
        case '/': return (x) => a(x) / b(x)
        case '^': {
          if (n.b.t === 'num') {
            const e = n.b.v
            if (e === 2) return (x) => { const u = a(x); return u * u }
            if (e === 3) return (x) => { const u = a(x); return u * u * u }
            if (e === 0.5) return (x) => Math.sqrt(a(x))
          }
          const hu = { t: 'num', v: 0, raw: '0' } as { t: 'num'; v: number; raw: string }
          const hw = { t: 'num', v: 0, raw: '0' } as { t: 'num'; v: number; raw: string }
          const node = { t: 'bin', op: '^', a: hu, b: hw } as ExprNode
          return (x) => {
            const u = a(x)
            const w = b(x)
            if (u > 0 || Number.isInteger(w) || Number.isNaN(u) || Number.isNaN(w)) return Math.pow(u, w)
            hu.v = u
            hw.v = w
            hu.raw = String(u)
            hw.raw = String(w)
            return constValue(node)
          }
        }
      }
      return () => Number.NaN
    }
    case 'call': {
      const native = NATIVE[n.fn]
      if (native && n.args.length === 1) {
        const a = compileFn(n.args[0], isVar)
        return (x) => native(a(x))
      }
      const args = n.args.map((c) => compileFn(c, isVar))
      const holes = n.args.map(() => ({ t: 'num', v: 0, raw: '0' }) as { t: 'num'; v: number; raw: string })
      const node = { t: 'call', fn: n.fn, args: holes } as ExprNode
      return (x) => {
        for (let i = 0; i < args.length; i++) {
          holes[i].v = args[i](x)
          holes[i].raw = String(holes[i].v)
        }
        return constValue(node)
      }
    }
    default:
      return () => Number.NaN
  }
}

// ----------------------------------------------------------------------------
// h as a ratio of polynomials, exactly (over Q) or in doubles
// ----------------------------------------------------------------------------

interface RQ { num: QP; den: QP }
const MAX_DEG = 40

function rqNorm(r: RQ): RQ | null {
  if (r.den.length === 0) return null
  if (qpDeg(r.num) > MAX_DEG || qpDeg(r.den) > MAX_DEG) return null
  if (qpDeg(r.den) === 0) return { num: qpScale(r.num, qdiv(Q1, r.den[0])), den: [Q1] }
  // a positive leading coefficient below
  if (qsign(qpLead(r.den)) < 0) return { num: qpNeg(r.num), den: qpNeg(r.den) }
  return r
}

function toRQ(n: ExprNode, isVar: IsVar): RQ | null {
  switch (n.t) {
    case 'num': {
      const q = qFromDecimal(n.raw ?? '') ?? qFromNumber(n.v)
      return q ? { num: qpTrim([q]), den: [Q1] } : null
    }
    case 'const': return null
    case 'var': case 'param': return isVar(n) ? { num: [Q0, Q1], den: [Q1] } : null
    case 'neg': {
      const a = toRQ(n.a, isVar)
      return a ? { num: qpNeg(a.num), den: a.den } : null
    }
    case 'bin': {
      if (n.op === '^') {
        if (hasVarNode(n.b, isVar)) return null
        const k = constValue(n.b)
        if (!Number.isInteger(k) || Math.abs(k) > MAX_DEG) return null
        const base = toRQ(n.a, isVar)
        if (!base) return null
        if (k === 0) return { num: [Q1], den: [Q1] }
        let num: QP = [Q1], den: QP = [Q1]
        for (let i = 0; i < Math.abs(k); i++) {
          num = qpMul(num, base.num)
          den = qpMul(den, base.den)
          if (qpDeg(num) > MAX_DEG || qpDeg(den) > MAX_DEG) return null
        }
        if (k < 0) {
          if (num.length === 0) return null
          return rqNorm({ num: den, den: num })
        }
        return rqNorm({ num, den })
      }
      const a = toRQ(n.a, isVar)
      if (!a) return null
      const b = toRQ(n.b, isVar)
      if (!b) return null
      switch (n.op) {
        case '+': case '-': {
          const nb = n.op === '-' ? qpNeg(b.num) : b.num
          if (qpEq(a.den, b.den)) return rqNorm({ num: qpAdd(a.num, nb), den: a.den })
          return rqNorm({ num: qpAdd(qpMul(a.num, b.den), qpMul(nb, a.den)), den: qpMul(a.den, b.den) })
        }
        case '*': return rqNorm({ num: qpMul(a.num, b.num), den: qpMul(a.den, b.den) })
        case '/': {
          if (b.num.length === 0) return null
          return rqNorm({ num: qpMul(a.num, b.den), den: qpMul(a.den, b.num) })
        }
      }
      return null
    }
    case 'call': {
      if (hasVarNode(n, isVar)) return null
      const q = qFromNumber(constValue(n))
      return q ? { num: qpTrim([q]), den: [Q1] } : null
    }
    default:
      return null
  }
}

/** The same in doubles (π, e, √2 allowed as coefficients). */
interface RF { num: number[]; den: number[] }

function rfTrim(p: number[]): number[] {
  const scale = Math.max(0, ...p.map((c) => Math.abs(c)))
  let k = p.length
  while (k > 0 && Math.abs(p[k - 1]) <= 1e-14 * scale) k--
  return p.slice(0, k)
}
function rfAdd(a: number[], b: number[]): number[] {
  const out: number[] = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) out.push((a[i] ?? 0) + (b[i] ?? 0))
  return rfTrim(out)
}
function rfMul(a: number[], b: number[]): number[] {
  if (a.length === 0 || b.length === 0) return []
  const out = new Array(a.length + b.length - 1).fill(0)
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j]
  return rfTrim(out)
}
const rfEq = (a: number[], b: number[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

function toRF(n: ExprNode, isVar: IsVar): RF | null {
  if (!hasVarNode(n, isVar)) {
    const v = constValue(n)
    return Number.isFinite(v) ? { num: rfTrim([v]), den: [1] } : null
  }
  switch (n.t) {
    case 'var': case 'param': return { num: [0, 1], den: [1] }
    case 'neg': {
      const a = toRF(n.a, isVar)
      return a ? { num: a.num.map((c) => -c), den: a.den } : null
    }
    case 'bin': {
      if (n.op === '^') {
        if (hasVarNode(n.b, isVar)) return null
        const k = constValue(n.b)
        if (!Number.isInteger(k) || Math.abs(k) > MAX_DEG) return null
        const base = toRF(n.a, isVar)
        if (!base) return null
        let num = [1], den = [1]
        for (let i = 0; i < Math.abs(k); i++) {
          num = rfMul(num, base.num)
          den = rfMul(den, base.den)
        }
        if (k < 0) [num, den] = [den, num]
        if (den.length === 0 || num.length - 1 > MAX_DEG || den.length - 1 > MAX_DEG) return null
        return { num, den }
      }
      const a = toRF(n.a, isVar)
      const b = toRF(n.b, isVar)
      if (!a || !b) return null
      let out: RF | null = null
      switch (n.op) {
        case '+': case '-': {
          const nb = n.op === '-' ? b.num.map((c) => -c) : b.num
          out = rfEq(a.den, b.den)
            ? { num: rfAdd(a.num, nb), den: a.den }
            : { num: rfAdd(rfMul(a.num, b.den), rfMul(nb, a.den)), den: rfMul(a.den, b.den) }
          break
        }
        case '*': out = { num: rfMul(a.num, b.num), den: rfMul(a.den, b.den) }; break
        case '/': out = b.num.length === 0 ? null : { num: rfMul(a.num, b.den), den: rfMul(a.den, b.num) }; break
      }
      if (!out || out.den.length === 0 || out.num.length - 1 > MAX_DEG || out.den.length - 1 > MAX_DEG) return null
      return out
    }
    default:
      return null
  }
}

// ----------------------------------------------------------------------------
// Structure read off the tree: log/exponential bases, trig, singular sources
// ----------------------------------------------------------------------------

interface TreeInfo {
  bases: number[]
  trig: boolean
  /** sub-expressions whose zeros make h undefined: denominators, cos for tan/sec, sin for csc/cot */
  sing: ExprNode[]
}

const TRIG = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot'])

function treeInfo(h: ExprNode, isVar: IsVar): TreeInfo {
  const bases: number[] = []
  const sing: ExprNode[] = []
  let trig = false
  const addBase = (b: number): void => {
    if (Number.isFinite(b) && b > 0 && b !== 1 && !bases.some((x) => same(x, b))) bases.push(b)
  }
  const walk = (n: ExprNode): void => {
    switch (n.t) {
      case 'neg': walk(n.a); return
      case 'bin':
        if (n.op === '/' && hasVarNode(n.b, isVar)) sing.push(n.b)
        if (n.op === '^') {
          if (!hasVarNode(n.a, isVar) && hasVarNode(n.b, isVar)) addBase(constValue(n.a))
          if (hasVarNode(n.a, isVar) && !hasVarNode(n.b, isVar) && constValue(n.b) < 0) sing.push(n.a)
        }
        walk(n.a); walk(n.b); return
      case 'call': {
        const inner = n.args[n.args.length - 1]
        if (hasVarNode(n, isVar)) {
          if (TRIG.has(n.fn)) trig = true
          if (n.fn === 'tan' || n.fn === 'sec') sing.push({ t: 'call', fn: 'cos', args: [inner] } as ExprNode)
          if (n.fn === 'csc' || n.fn === 'cot') sing.push({ t: 'call', fn: 'sin', args: [inner] } as ExprNode)
          if (n.fn === 'exp' || n.fn === 'ln') addBase(Math.E)
          if (n.fn === 'log' || n.fn === 'log10') addBase(10)
          if (n.fn === 'log2') addBase(2)
          if (n.fn === 'log_' && !hasVarNode(n.args[0], isVar)) addBase(constValue(n.args[0]))
        }
        for (const a of n.args) walk(a)
        return
      }
      default: return
    }
  }
  walk(h)
  // e^x is const e to a power
  return { bases, trig, sing }
}

// ============================================================================
// Closed forms beyond exactForm: ln r, log r, log₂ r, e^r, arcsin r + kπ, …
// ============================================================================

interface SnapEnv {
  bases: number[]
  trig: boolean
}

/** A modest fraction (not 0, not 1) the double IS, for the argument of a log. */
function niceRatio(y: number): Q | null {
  if (!(y > 0) || !Number.isFinite(y)) return null
  const ef = exactForm(y, { tol: 1e-9 })
  if (!ef || /[√π]/.test(ef.text)) return null
  const q = qFromNumber(ef.value)
  if (!q || qeq(q, Q1)) return null
  if (q.d > 64n || babs(q.n) > 100000n) return null
  return q
}

function niceArg(r: number): ExactForm | null {
  const ef = exactForm(r, { tol: 1e-9 })
  if (!ef || ef.text.includes('π')) return null
  if (ef.text.length > 9) return null
  return ef
}

const paren = (t: string): string => (/^[0-9√]+$/.test(t) ? ` ${t}` : `(${t})`)

function logName(B: number): { text: string; tex: string } {
  if (same(B, Math.E)) return { text: 'ln', tex: '\\ln' }
  if (B === 10) return { text: 'log', tex: '\\log' }
  const bq = qFromNumber(B)
  if (bq && qint(bq)) {
    const s = String(bq.n)
    return { text: `log${s.split('').map((c) => SUB[c] ?? c).join('')}`, tex: `\\log_{${s}}` }
  }
  return { text: `log_${decimalText(B)}`, tex: `\\log_{${decimalTex(B)}}` }
}

function extForms(x: number, env: SnapEnv, tol: number): ExactForm[] {
  const out: ExactForm[] = []
  const close = (v: number): boolean => Math.abs(v - x) <= tol * Math.max(1, Math.abs(x))
  // ln r, log r, log₂ r, and those over k
  const bases = [...env.bases]
  for (const b of [Math.E, 10, 2]) if (!bases.some((x2) => same(x2, b))) bases.push(b)
  for (const B of bases) {
    const lnB = Math.log(B)
    for (let k = 1; k <= 4; k++) {
      const y = Math.pow(B, k * x)
      if (!(y > 1e-6 && y < 1e6)) continue
      let q = niceRatio(y)
      if (!q) continue
      let neg = false
      // ln(1/3) reads better as −ln 3
      if (q.n < q.d) {
        const inv = mkQ(q.d, q.n)
        if (qint(inv)) { q = inv; neg = true }
      }
      const value = ((neg ? -1 : 1) * Math.log(qnum(q))) / (k * lnB)
      if (!close(value)) continue
      const nm = logName(B)
      const argT = paren(qText(q))
      const argTex = qint(q) ? ` ${qTex(q)}` : `\\left(${qTex(q)}\\right)`
      let text = `${nm.text}${argT}`
      let tex = `${nm.tex}${argTex}`
      if (k > 1) {
        text = `${nm.text}(${qText(q)})/${k}`
        tex = `\\frac{${nm.tex}${argTex}}{${k}}`
      }
      if (neg) {
        text = `${MINUS}${text}`
        tex = `-${tex}`
      }
      out.push({ text, tex, value })
      break
    }
  }
  // ∛r
  if (x !== 0 && Math.abs(x) < 100) {
    const y = x * x * x
    const q = qFromNumber(Number(y.toPrecision(12)))
    if (q && q.d <= 64n && babs(q.n) <= 100000n && !qz(q)) {
      const aq = qabs(q)
      const value = Math.sign(x) * Math.cbrt(qnum(aq))
      if (close(value)) {
        const arg = qint(aq) ? qText(aq) : `(${qText(aq)})`
        out.push({ text: `${x < 0 ? MINUS : ''}∛${arg}`, tex: `${x < 0 ? '-' : ''}\\sqrt[3]{${qTex(aq)}}`, value })
      }
    }
  }
  // e^r
  if (x !== 0 && Math.abs(x) > 1e-6 && Math.abs(x) < 1e6) {
    const L = Math.log(Math.abs(x))
    const rf = exactForm(L, { tol: 1e-9 })
    const r = rf && !/[√π]/.test(rf.text) ? qFromNumber(rf.value) : null
    if (r && !qz(r) && r.d <= 6n) {
      const value = Math.sign(x) * Math.exp(qnum(r))
      if (close(value)) {
        let text: string, tex: string
        if (qeq(r, Q1)) { text = 'e'; tex = 'e' } else if (qint(r) && r.n > 0n) { text = `e${sup(String(r.n))}`; tex = `e^{${r.n}}` } else if (qeq(r, mkQ(-1n))) { text = '1/e'; tex = '\\frac{1}{e}' } else if (qeq(r, mkQ(1n, 2n))) { text = '√e'; tex = '\\sqrt{e}' } else { text = `e^(${qText(r)})`; tex = `e^{${qTex(r)}}` }
        if (x < 0) { text = `${MINUS}${text}`; tex = `-${tex}` }
        out.push({ text, tex, value })
      }
    }
  }
  // arcsin r + kπ, π − arcsin r, 2π − arccos r, π + arctan r, …
  if (env.trig) {
    let best: { form: ExactForm; cost: number } | null = null
    const fams = [
      { name: 'arcsin', tex: '\\arcsin', inv: Math.asin, fwd: Math.sin, lo: -Math.PI / 2, hi: Math.PI / 2, rank: 0 },
      { name: 'arccos', tex: '\\arccos', inv: Math.acos, fwd: Math.cos, lo: 0, hi: Math.PI, rank: 1 },
      { name: 'arctan', tex: '\\arctan', inv: Math.atan, fwd: Math.tan, lo: -Math.PI / 2, hi: Math.PI / 2, rank: 2 },
    ]
    for (let m = -8; m <= 8; m++) {
      for (const F of fams) {
        for (const sg of [1, -1]) {
          const a = sg * (x - m * Math.PI)
          if (!(a > F.lo && a < F.hi)) continue
          const rf = niceArg(F.fwd(a))
          if (!rf || rf.value === 0) continue
          const value = m * Math.PI + sg * F.inv(rf.value)
          if (!close(value)) continue
          const cost = Math.abs(m) * 2 + (rf.value < 0 ? 3 : 0) + (sg < 0 ? 1 : 0) + F.rank * 0.5
          if (best && best.cost <= cost) continue
          const call = `${F.name}(${rf.text})`
          const callTex = `${F.tex}\\left(${rf.tex}\\right)`
          const mT = m === 0 ? '' : m === 1 ? 'π' : m === -1 ? `${MINUS}π` : `${m < 0 ? MINUS : ''}${Math.abs(m)}π`
          const mTex = m === 0 ? '' : m === 1 ? '\\pi' : m === -1 ? '-\\pi' : `${m}\\pi`
          const text = m === 0 ? `${sg < 0 ? MINUS : ''}${call}` : `${mT} ${sg < 0 ? MINUS : '+'} ${call}`
          const tex = m === 0 ? `${sg < 0 ? '-' : ''}${callTex}` : `${mTex} ${sg < 0 ? '-' : '+'} ${callTex}`
          best = { form: { text, tex, value }, cost }
        }
      }
    }
    if (best) out.push(best.form)
  }
  return out
}

/** The closed form of a located point, checked against h where a check is given. */
function snapPoint(x: number, env: SnapEnv, check: (c: number) => boolean, loose: boolean): ExactForm | null {
  if (!Number.isFinite(x)) return null
  if (Math.abs(x) < 1e-12 && check(0)) return { text: '0', tex: '0', value: 0 }
  const f = exactForm(x, { tol: 1e-10 })
  if (f && check(f.value)) return f
  if (loose) {
    const g = verifiedExact(x, check)
    if (g) return g
  }
  for (const c of extForms(x, env, loose ? 1e-7 : 1e-10)) if (check(c.value)) return c
  return null
}

// ============================================================================
// The numeric scan
// ============================================================================

interface Mark {
  x: number
  exact: ExactForm | null
  why: Why
  mult?: number
  /** found by golden section on |h| (located to ~1e-8, not to the last bit) */
  touch?: boolean
  /** a jump of h where h may still be defined */
  jump?: boolean
  /** the end of a stretch where h = 0 (floor(x) = 2): whether it is in is read from h there */
  evalSign?: boolean
  /** |h| near the point, for checks */
  scale: number
}

/** Grid over [lo, hi]: 1/50 near 0, 1/10 to ±200, 1/2 to ±2000, then relative. */
function gridOf(lo: number, hi: number): number[] {
  const out: number[] = []
  if (hi - lo <= 60) {
    const N = 3000
    for (let i = 0; i <= N; i++) out.push(lo + ((hi - lo) * i) / N)
    return out
  }
  out.push(lo)
  let x = lo
  for (let guard = 0; guard < 100000; guard++) {
    const ax = Math.abs(x)
    let nx: number
    if (ax < 25 || (x < 0 && ax <= 25)) nx = (Math.floor(x * 50 + 1e-7) + 1) / 50
    else if (ax < 200 || (x < 0 && ax <= 200)) nx = (Math.floor(x * 10 + 1e-7) + 1) / 10
    else if (ax < 2000 || (x < 0 && ax <= 2000)) nx = (Math.floor(x * 2 + 1e-7) + 1) / 2
    else nx = x + ax / 4000
    if (nx >= hi) break
    out.push(nx)
    x = nx
  }
  out.push(hi)
  return out
}

function bisectDefined(f: Fn, xin: number, xout: number): number {
  let a = xin, b = xout
  for (let i = 0; i < 200; i++) {
    const m = 0.5 * (a + b)
    if (m === a || m === b) break
    if (!Number.isNaN(f(m))) a = m
    else b = m
  }
  return a
}

/** Minimise |h| on [a, b] by golden section. */
function goldenMinAbs(f: Fn, a: number, b: number): number {
  const g = (x: number): number => {
    const v = Math.abs(f(x))
    return Number.isNaN(v) ? Infinity : v
  }
  const r = (Math.sqrt(5) - 1) / 2
  let c = b - r * (b - a), d = a + r * (b - a)
  let gc = g(c), gd = g(d)
  for (let i = 0; i < 120; i++) {
    if (b - a <= 4 * Number.EPSILON * Math.max(1, Math.abs(a))) break
    if (gc < gd) { b = d; d = c; gd = gc; c = b - r * (b - a); gc = g(c) } else { a = c; c = d; gc = gd; d = a + r * (b - a); gd = g(d) }
  }
  return gc < gd ? c : d
}

const sgnOf = (v: number): Sign => (v > 0 ? 1 : v < 0 ? -1 : 0)

/** Zeros (and, for h itself, poles, jumps and domain ends) of f over one stretch. */
function scanStretch(
  f: Fn, lo: number, hi: number, zerosOnly: boolean, marks: Mark[], state: { overflow: boolean },
  /** max(|L|, |R|) when h = L − R: what an exact 0 of h could be absorbing */
  magAt?: Fn,
): void {
  const xs = gridOf(lo, hi)
  const vs = xs.map(f)
  const n = xs.length
  const isN = (i: number): boolean => Number.isNaN(vs[i])
  const localScale = (i: number): number => {
    let s = 0
    for (let k = Math.max(0, i - 3); k <= Math.min(n - 1, i + 3); k++) if (Number.isFinite(vs[k])) s = Math.max(s, Math.abs(vs[k]))
    return s
  }
  // overflow: a NaN tail far out that f arrived at smoothly — not an end of the domain
  let first = 0, last = n - 1
  if (!zerosOnly) {
    if (isN(n - 1) && Math.abs(hi) >= 5) {
      let j = n - 1
      while (j > 0 && isN(j)) j--
      if (!isN(j) && xs[j] > 0 && overflowEdge(f, xs[j], xs[j + 1]) !== null) { last = j; state.overflow = true }
    }
    if (isN(0) && Math.abs(lo) >= 5) {
      let j = 0
      while (j < n - 1 && isN(j)) j++
      if (!isN(j) && xs[j] < 0 && overflowEdge(f, xs[j], xs[j - 1]) !== null) { first = j; state.overflow = true }
    }
    // domain transitions
    for (let i = first; i < last; i++) {
      if (isN(i) === isN(i + 1)) continue
      const din = isN(i) ? i + 1 : i
      const dout = isN(i) ? i : i + 1
      const c = bisectDefined(f, xs[din], xs[dout])
      marks.push({ x: c, exact: null, why: 'domain-end', scale: localScale(din) })
    }
  }
  for (let i = first; i <= last; i++) {
    if (isN(i)) continue
    const v = vs[i]
    // exact zero samples (a run of them is a stretch where h = 0)
    if (v === 0) {
      let j = i
      while (j + 1 <= last && vs[j + 1] === 0) j++
      const before = i > first && !isN(i - 1) ? Math.abs(vs[i - 1]) : Infinity
      const after = j < last && !isN(j + 1) ? Math.abs(vs[j + 1]) : Infinity
      const underflow = (before < 1e-250 || after < 1e-250) && (j > i || Math.min(before, after) < 1e-250)
      // ABSORPTION: h = L − R is 0 here only because the sides are so large
      // that the difference seen next door is below their last bits —
      // 2ˣ − (2ˣ + 1) is −1 everywhere, but 0 in doubles once 2ˣ passes
      // ~10¹³ (and 2ˣ + 1 rounds to 2ˣ past 2⁵³). Not a zero, not a stretch.
      let absorbed = false
      if (magAt) {
        const near = Math.min(before, after)
        const M = Math.max(magAt(xs[i]), magAt(xs[j]))
        absorbed = Number.isFinite(near) && Number.isFinite(M) && near <= 1e-11 * M
      }
      if (!underflow && !absorbed) {
        if (j === i) marks.push({ x: xs[i], exact: null, why: 'zero', scale: localScale(i) })
        else {
          if (i > first && !isN(i - 1)) {
            let a = xs[i - 1], b = xs[i]
            for (let k = 0; k < 200; k++) {
              const m = 0.5 * (a + b)
              if (m === a || m === b) break
              if (f(m) === 0) b = m
              else a = m
            }
            marks.push({ x: b, exact: null, why: 'zero', evalSign: true, scale: localScale(i) })
          }
          // (a stretch that runs to the end of the scan or into a domain end has no end of its own here)
          if (j < last && !isN(j + 1)) {
            let a = xs[j], b = xs[j + 1]
            for (let k = 0; k < 200; k++) {
              const m = 0.5 * (a + b)
              if (m === a || m === b) break
              if (f(m) === 0) a = m
              else b = m
            }
            marks.push({ x: a, exact: null, why: 'zero', evalSign: true, scale: localScale(j) })
          }
        }
      }
      i = j
      continue
    }
    if (!zerosOnly && !Number.isFinite(v) && i > first && i < last && Number.isFinite(vs[i - 1]) && Number.isFinite(vs[i + 1])) {
      marks.push({ x: xs[i], exact: null, why: 'undefined', scale: localScale(i) })
      continue
    }
    if (i + 1 <= last && !isN(i + 1) && vs[i + 1] !== 0 && sgnOf(v) !== sgnOf(vs[i + 1])) {
      // a sign change: bisect, then read what |h| did
      let a = xs[i], b = xs[i + 1], fa = v, fb = vs[i + 1]
      const S0 = Math.max(Number.isFinite(fa) ? Math.abs(fa) : 0, Number.isFinite(fb) ? Math.abs(fb) : 0, 1e-300)
      let nanInside = false
      for (let k = 0; k < 200; k++) {
        const m = 0.5 * (a + b)
        if (m === a || m === b) break
        const fm = f(m)
        if (Number.isNaN(fm)) { nanInside = true; a = b = m; break }
        if (fm === 0) { a = b = m; fa = fb = 0; break }
        if (sgnOf(fm) === sgnOf(fa)) { a = m; fa = fm } else { b = m; fb = fm }
      }
      if (nanInside) {
        if (!zerosOnly) marks.push({ x: a, exact: null, why: 'undefined', scale: S0 })
        continue
      }
      const lo2 = Math.min(Math.abs(fa), Math.abs(fb))
      const hi2 = Math.max(Math.abs(fa), Math.abs(fb))
      const at = Math.abs(fa) <= Math.abs(fb) ? a : b
      if (lo2 <= 1e-8 * S0) marks.push({ x: at, exact: null, why: 'zero', scale: S0 })
      else if (!zerosOnly) {
        if (!Number.isFinite(hi2) || hi2 >= 1e8 * S0) marks.push({ x: at, exact: null, why: 'undefined', scale: S0 })
        else marks.push({ x: at, exact: null, why: 'undefined', jump: true, scale: S0 })
      }
      continue
    }
    // a touch: a local minimum of |h| that reaches 0 without a sign change
    if (i > first && i < last && !isN(i - 1) && !isN(i + 1) && Number.isFinite(v)) {
      const l = Math.abs(vs[i - 1]), r = Math.abs(vs[i + 1]), m = Math.abs(v)
      if (Number.isFinite(l) && Number.isFinite(r) && m <= l && m <= r && sgnOf(vs[i - 1]) === sgnOf(v) && sgnOf(vs[i + 1]) === sgnOf(v) && m <= 0.5 * Math.max(l, r)) {
        const S = localScale(i)
        // values this small are underflow (x·eˣ far left), not a function reaching 0
        if (S < 1e-250) continue
        const c = goldenMinAbs(f, xs[i - 1], xs[i + 1])
        const fc = f(c)
        if (Number.isFinite(fc) && sgnOf(fc) === -sgnOf(v)) {
          // it dipped through: two close zeros
          for (const [p, q] of [[xs[i - 1], c], [c, xs[i + 1]]]) {
            let a = p, b = q, fa = f(a)
            for (let k = 0; k < 200; k++) {
              const mm = 0.5 * (a + b)
              if (mm === a || mm === b) break
              const fm = f(mm)
              if (sgnOf(fm) === sgnOf(fa)) { a = mm; fa = fm } else b = mm
            }
            marks.push({ x: a, exact: null, why: 'zero', scale: S })
          }
        } else if (Number.isFinite(fc) && Math.abs(fc) <= 1e-10 * Math.max(S, 1e-300)) {
          marks.push({ x: c, exact: null, why: 'zero', touch: true, scale: S })
        }
      }
    }
  }
}

// ============================================================================
// Engines
// ============================================================================

interface Engine {
  marks: Mark[]
  /** h at a test point: exact when it can be; null value where h is undefined */
  valueAt: (t: number, tq: Q | null) => { v: number | null; text: string; exact: boolean }
  f: Fn
  /** the scan was used (so a window applies) */
  numeric: boolean
  factored: { text: string; tex: string } | null
  /** h written out as a polynomial, when it is one over Q */
  poly: QP | null
  distance: { alpha: Q; beta: Q; m: Q; c: Q } | null
  overflow: boolean
  windowCut: boolean
}

/**
 * h at a test point, as the table prints it. `relative`: h is L − R already
 * snapped to 0 where the two sides agree to their last bits (buildEngine), so
 * a value that is merely SMALL is not 0 — e^(−100) − 2^(−100) ≈ −7.9×10⁻³¹ is
 * negative, and calling it 0 put all of (−∞, 0) into e^x = 2^x.
 */
function numericValue(v: number, relative = false): { v: number | null; text: string; exact: boolean } {
  if (Number.isNaN(v)) return { v: null, text: 'undefined', exact: true }
  if (!Number.isFinite(v)) return { v, text: decimalText(v), exact: false }
  if (v === 0) return { v: 0, text: '0', exact: true }
  if (Math.abs(v) < 1e-13) return relative ? { v, text: `≈ ${decimalText(v)}`, exact: false } : { v: 0, text: '0', exact: true }
  const ef = exactForm(v)
  if (ef) return { v, text: ef.text, exact: true }
  const ext = extForms(v, { bases: [], trig: false }, 1e-11)
  if (ext.length > 0) return { v, text: ext[0].text, exact: true }
  return { v, text: `≈ ${decimalText(v)}`, exact: false }
}

/** h = α·|mx + c| + β, read exactly — or null. */
function absLinear(h: ExprNode, isVar: IsVar): { alpha: Q; beta: Q; m: Q; c: Q } | null {
  const found: ExprNode[] = []
  const walk = (n: ExprNode): void => {
    if (n.t === 'call' && n.fn === 'abs' && hasVarNode(n, isVar)) { found.push(n); return }
    if (n.t === 'neg') walk(n.a)
    else if (n.t === 'bin') { walk(n.a); walk(n.b) }
    else if (n.t === 'call') n.args.forEach(walk)
  }
  walk(h)
  if (found.length !== 1) return null
  const A = found[0] as Extract<ExprNode, { t: 'call' }>
  const inner = toRQ(A.args[0], isVar)
  if (!inner || qpDeg(inner.den) !== 0 || qpDeg(inner.num) !== 1) return null
  const marker = { t: 'param', name: '\u0000abs', i: -1 } as ExprNode
  const replace = (n: ExprNode): ExprNode => {
    if (n === A) return marker
    if (n.t === 'neg') return { t: 'neg', a: replace(n.a) } as ExprNode
    if (n.t === 'bin') return { t: 'bin', op: n.op, a: replace(n.a), b: replace(n.b) } as ExprNode
    return n
  }
  const outer = toRQ(replace(h), (n) => n === marker)
  if (!outer || qpDeg(outer.den) !== 0 || qpDeg(outer.num) !== 1) return null
  return { alpha: outer.num[1], beta: outer.num[0] ?? Q0, m: inner.num[1], c: inner.num[0] ?? Q0 }
}

function buildEngine(
  h: ExprNode, isVar: IsVar, v: string, uparts: IntervalPart[], win: [number, number], env: SnapEnv, info: TreeInfo,
  sides: { L: ExprNode; R: ExprNode } | null,
): Engine {
  let f = compileFn(h, isVar)
  let magAt: Fn | undefined
  if (sides) {
    // L − R where the two agree to the last few bits is 0, not noise that
    // changes sign (sin²x + cos²x = 1, everywhere)
    const fL = compileFn(sides.L, isVar)
    const fR = compileFn(sides.R, isVar)
    magAt = (x) => Math.max(Math.abs(fL(x)), Math.abs(fR(x)))
    f = (x) => {
      const a = fL(x)
      const b = fR(x)
      const d = a - b
      const m = Math.max(Math.abs(a), Math.abs(b))
      return Number.isFinite(m) && Math.abs(d) <= 1e-13 * m ? 0 : d
    }
  }
  const base = { f, numeric: false, factored: null, poly: null, distance: null, overflow: false, windowCut: false }
  // ---- |mx + c| ----
  const al = absLinear(h, isVar)
  if (al) {
    const { alpha, beta, m, c } = al
    const marks: Mark[] = []
    const center = qneg(qdiv(c, m))
    const radius = qdiv(qneg(beta), qmul(alpha, qabs(m)))
    if (qsign(radius) > 0) {
      for (const p of [qsub(center, radius), qadd(center, radius)]) marks.push({ x: qnum(p), exact: qExact(p), why: 'zero', mult: 1, scale: 1 })
    } else if (qz(radius)) marks.push({ x: qnum(center), exact: qExact(center), why: 'zero', scale: 1 })
    const valueAt = (t: number, tq: Q | null) => {
      if (!tq) return numericValue(f(t))
      const q = qadd(qmul(alpha, qabs(qadd(qmul(m, tq), c))), beta)
      return { v: qnum(q), text: qText(q), exact: true }
    }
    return { ...base, marks, valueAt, distance: al }
  }
  // ---- a ratio of polynomials over Q ----
  const rq = toRQ(h, isVar)
  if (rq) {
    const marks: Mark[] = []
    let factored: { text: string; tex: string } | null = null
    const numR = rq.num.length > 0 && qpDeg(rq.num) >= 1 ? qRoots(rq.num, v) : null
    const denR = qpDeg(rq.den) >= 1 ? qRoots(rq.den, v) : null
    if (numR) for (const r of numR.roots) marks.push({ x: r.x, exact: r.exact, why: 'zero', mult: r.mult, scale: 1 })
    if (denR) for (const r of denR.roots) marks.push({ x: r.x, exact: r.exact, why: 'undefined', mult: r.mult, scale: 1 })
    if (rq.num.length > 0 && (numR || denR)) {
      const nf = numR ? factoredOf(numR) : { text: '', tex: '', count: 0 }
      const df = denR ? factoredOf(denR) : { text: '', tex: '', count: 0 }
      let content = numR ? numR.content : rq.num[0]
      if (denR) content = qdiv(content, denR.content)
      const cT = qeq(content, Q1) ? '' : qeq(content, qneg(Q1)) ? MINUS : qint(content) ? qText(content) : `(${qText(content)})`
      const cTex = qeq(content, Q1) ? '' : qeq(content, qneg(Q1)) ? '-' : qTex(content)
      let numT = nf.count > 0 ? `${cT}${nf.text}` : qText(content)
      let numTex = nf.count > 0 ? `${cTex}${nf.tex}` : qTex(content)
      // a lone first-degree factor needs no brackets: x − 2
      if (nf.count === 1 && !denR && cT === '' && /^\([^()]*\)$/.test(nf.text)) {
        numT = nf.text.slice(1, -1)
        numTex = nf.tex.replace(/^\\left\(/, '').replace(/\\right\)$/, '')
      }
      if (denR && df.count > 0) {
        const denT = df.count === 1 && /^[^()]*$|^\([^()]*\)$/.test(df.text) ? df.text : `(${df.text})`
        factored = { text: `${numT}/${denT}`, tex: `\\frac{${nf.count > 0 ? `${cTex}${nf.tex}` : qTex(content)}}{${df.tex}}` }
      } else factored = { text: numT, tex: numTex }
    }
    const valueAt = (t: number, tq: Q | null) => {
      if (!tq) return numericValue(f(t))
      const d = qpEval(rq.den, tq)
      if (qz(d)) return { v: null, text: 'undefined', exact: true }
      const q = qdiv(qpEval(rq.num, tq), d)
      return { v: qnum(q), text: qText(q), exact: true }
    }
    const poly = qpDeg(rq.den) === 0 ? rq.num : null
    return { ...base, marks, valueAt, factored, poly }
  }
  // ---- a ratio of polynomials in doubles ----
  const rf = toRF(h, isVar)
  if (rf) {
    const marks: Mark[] = []
    const evp = (p: number[], x: number): number => p.reduceRight((acc, c) => acc * x + c, 0)
    for (const [p, why] of [[rf.num, 'zero'], [rf.den, 'undefined']] as const) {
      for (const x of realRootsFloat(p)) {
        const ex = snapPoint(x, env, (c) => Math.abs(evp(p, c)) <= 1e-9 * Math.max(1, ...p.map((k, i) => Math.abs(k) * Math.abs(c) ** i)), false)
        marks.push({ x: ex ? ex.value : x, exact: ex, why, scale: 1 })
      }
    }
    return { ...base, marks, valueAt: (t: number) => numericValue(f(t)) }
  }
  // ---- numeric ----
  const marks: Mark[] = []
  const state = { overflow: false }
  let windowCut = false
  const singFns = info.sing.map((s) => compileFn(s, isVar))
  for (const P of uparts) {
    const lo = Math.max(P.lo, win[0])
    const hi = Math.min(P.hi, win[1])
    if (P.lo < win[0] || P.hi > win[1]) windowCut = true
    if (!(hi > lo)) continue
    const raw: Mark[] = []
    scanStretch(f, lo, hi, false, raw, state, magAt)
    for (const g of singFns) {
      const zs: Mark[] = []
      scanStretch(g, lo, hi, true, zs, { overflow: false })
      for (const z of zs) {
        const d = 1e-7 * Math.max(1, Math.abs(z.x))
        if (Number.isFinite(f(z.x - d)) || Number.isFinite(f(z.x + d))) raw.push({ x: z.x, exact: null, why: 'undefined', scale: z.scale })
      }
    }
    // the universe's own finite ends are added later; a scan end is not a domain end
    marks.push(...raw)
  }
  return { ...base, marks, valueAt: (t: number) => numericValue(f(t), !!sides), numeric: true, overflow: state.overflow, windowCut }
}

// ============================================================================
// Marks → critical values, rows, the solution
// ============================================================================

const WHY_RANK: Record<Why, number> = { 'domain-end': 3, undefined: 2, zero: 1 }

function dedupeMarks(ms: Mark[]): Mark[] {
  const sorted = ms.slice().sort((a, b) => a.x - b.x)
  const out: Mark[] = []
  for (const m of sorted) {
    const last = out[out.length - 1]
    if (last && same(last.x, m.x)) {
      const keep = WHY_RANK[m.why] > WHY_RANK[last.why] ? { ...m } : { ...last }
      keep.exact = last.exact ?? m.exact
      if (keep.exact) keep.x = keep.exact.value
      keep.mult = last.mult ?? m.mult
      keep.touch = (last.touch ?? false) && (m.touch ?? false)
      keep.evalSign = (last.evalSign ?? false) || (m.evalSign ?? false)
      out[out.length - 1] = keep
      continue
    }
    out.push({ ...m })
  }
  return out
}

/** Is h defined at a domain end, and what is it there? (√ ends are in; ln's are not.) */
function valueAtEnd(f: Fn, c: number, exact: ExactForm | null): number | null {
  const v = f(c)
  // a rational end is computed exactly enough: what h is there, it is
  const rationalEnd = Number.isInteger(c) || (exact !== null && !/[√πe]|ln|log|arc/.test(exact.text))
  if (rationalEnd || (exact === null && Number.isFinite(v))) return Number.isFinite(v) ? v : null
  // an irrational end: roundoff decides f(c), so read the one-sided approach
  for (const side of [-1, 1]) {
    const s = Math.max(1, Math.abs(c))
    const v1 = f(c + side * 1e-10 * s)
    const v2 = f(c + side * 1e-8 * s)
    if (Number.isFinite(v1) && Number.isFinite(v2)) {
      if (Math.abs(v1 - v2) <= 1e-2 * Math.max(1, Math.abs(v2))) return Number.isFinite(v) ? v : v1
      return null
    }
  }
  return Number.isFinite(v) ? v : null
}

function part(lo: number, hi: number, loClosed: boolean, hiClosed: boolean, loExact: ExactForm | null, hiExact: ExactForm | null): IntervalPart {
  return {
    lo, hi,
    loClosed: Number.isFinite(lo) && loClosed,
    hiClosed: Number.isFinite(hi) && hiClosed,
    loExact: Number.isFinite(lo) ? loExact : null,
    hiExact: Number.isFinite(hi) ? hiExact : null,
  }
}

/** Sort and merge parts that overlap or touch at a point one of them owns. */
function mergeParts(input: readonly IntervalPart[]): IntervalPart[] {
  const ps = input
    .filter((p) => (p.lo < p.hi && !same(p.lo, p.hi)) || (same(p.lo, p.hi) && p.loClosed && p.hiClosed && Number.isFinite(p.lo)))
    .map((p) => (same(p.lo, p.hi) ? { ...p, hi: p.lo, hiExact: p.loExact } : { ...p }))
    .sort((a, b) => a.lo - b.lo || (a.loClosed === b.loClosed ? 0 : a.loClosed ? -1 : 1))
  const out: IntervalPart[] = []
  for (const p of ps) {
    const last = out[out.length - 1]
    if (last) {
      const touch = same(last.hi, p.lo)
      if ((p.lo < last.hi && !touch) || (touch && (last.hiClosed || p.loClosed))) {
        if (same(p.hi, last.hi)) last.hiClosed = last.hiClosed || p.hiClosed
        else if (p.hi > last.hi) { last.hi = p.hi; last.hiClosed = p.hiClosed; last.hiExact = p.hiExact }
        if (touch && !last.loExact && Number.isFinite(last.lo)) last.loExact = last.loExact ?? null
        continue
      }
    }
    out.push(p)
  }
  return out
}

function intersectParts(a: readonly IntervalPart[], b: readonly IntervalPart[]): IntervalPart[] {
  const out: IntervalPart[] = []
  for (const p of a) {
    for (const q of b) {
      let lo: number, loC: boolean, loE: ExactForm | null
      if (same(p.lo, q.lo)) { lo = p.loExact ? p.lo : q.lo; loC = p.loClosed && q.loClosed; loE = p.loExact ?? q.loExact } else if (p.lo > q.lo) { lo = p.lo; loC = p.loClosed; loE = p.loExact } else { lo = q.lo; loC = q.loClosed; loE = q.loExact }
      let hi: number, hiC: boolean, hiE: ExactForm | null
      if (same(p.hi, q.hi)) { hi = p.hiExact ? p.hi : q.hi; hiC = p.hiClosed && q.hiClosed; hiE = p.hiExact ?? q.hiExact } else if (p.hi < q.hi) { hi = p.hi; hiC = p.hiClosed; hiE = p.hiExact } else { hi = q.hi; hiC = q.hiClosed; hiE = q.hiExact }
      if (lo < hi && !same(lo, hi)) out.push(part(lo, hi, loC, hiC, loE, hiE))
      else if (same(lo, hi) && loC && hiC && Number.isFinite(lo)) out.push(part(lo, lo, true, true, loE, loE))
    }
  }
  return mergeParts(out)
}

const WHOLE = (): IntervalPart => part(-Infinity, Infinity, false, false, null, null)

function inParts(ps: readonly IntervalPart[], x: number): boolean {
  for (const p of ps) {
    const loOk = x > p.lo || (same(x, p.lo) && p.loClosed)
    const hiOk = x < p.hi || (same(x, p.hi) && p.hiClosed)
    if (loOk && hiOk && !(same(x, p.lo) && !p.loClosed) && !(same(x, p.hi) && !p.hiClosed)) return true
  }
  return false
}

/** A RealSet the way domainRange writes one; a set of points is 'finite' with "{−2, 2}". */
function realSet(parts: IntervalPart[], v: string): RealSet {
  if (parts.length > 0 && parts.every((p) => p.lo === p.hi)) {
    const ends = parts.map((p) => ({ t: p.loExact ? p.loExact.text : sig4Text(p.lo), tex: p.loExact ? p.loExact.tex : decimalTex(p.lo) }))
    const text = `{${ends.map((e) => e.t).join(', ')}}`
    const tex = `\\left\\{${ends.map((e) => e.tex).join(', ')}\\right\\}`
    const one = parts.length === 1
    return {
      kind: 'finite',
      parts,
      points: parts.map((p) => p.lo),
      text,
      tex,
      builder: one ? `${v} = ${ends[0].t}` : text,
      builderTex: one ? `${v} = ${ends[0].tex}` : tex,
    }
  }
  return { kind: 'intervals', parts, ...describeSet(parts, v) }
}

// ----------------------------------------------------------------------------
// Test points
// ----------------------------------------------------------------------------

interface Cand { t: number; text: string; q: Q | null }

function testCandidates(a: number, b: number, trig: boolean): Cand[] {
  const out: Cand[] = []
  const inside = (t: number): boolean => t > a && t < b && !same(t, a) && !same(t, b)
  const push = (c: Cand): void => {
    if (inside(c.t) && !out.some((o) => o.t === c.t)) out.push(c)
  }
  const intC = (k: number): Cand => ({ t: k, text: k < 0 ? `${MINUS}${-k}` : String(k), q: mkQ(BigInt(k)) })
  if (inside(0)) push(intC(0))
  if (trig) {
    for (const q of [1, 2, 3, 4, 6, 12]) {
      const kLo = Math.floor((a * q) / Math.PI) + 1
      const kHi = Math.ceil((b * q) / Math.PI) - 1
      if (!(Number.isFinite(kLo) || Number.isFinite(kHi))) continue
      let k: number
      if (kLo > 0) k = kLo
      else if (kHi < 0) k = kHi
      else k = kLo <= 1 && 1 <= kHi ? 1 : kHi
      if (!Number.isFinite(k) || k === 0) continue
      const t = (k * Math.PI) / q
      const ef = exactForm(t)
      if (ef) push({ t, text: ef.text, q: null })
    }
  }
  if (Math.max(Math.abs(Number.isFinite(a) ? a : 0), Math.abs(Number.isFinite(b) ? b : 0)) < 1e12) {
    if (a >= 0 || b <= 0) {
      const dir = a >= 0 ? 1 : -1
      let k = a >= 0 ? Math.floor(a) + 1 : Math.ceil(b) - 1
      for (let i = 0; i < 3; i++, k += dir) push(intC(k))
    } else {
      push(intC(1)); push(intC(-1))
    }
    for (let e = 1; e <= 6; e++) { push(intC(10 ** e)); push(intC(-(10 ** e))) }
    let got = 0
    for (let q = 2; q <= 64 && got < 2; q++) {
      const p = a >= 0 ? Math.floor(a * q) + 1 : b <= 0 ? Math.ceil(b * q) - 1 : 0
      const t = p / q
      if (bgcd(BigInt(p), BigInt(q)) !== 1n || !inside(t)) continue
      push({ t, text: qText(mkQ(BigInt(p), BigInt(q))), q: mkQ(BigInt(p), BigInt(q)) })
      got++
    }
  }
  if (out.length === 0) {
    const t = Number.isFinite(a) && Number.isFinite(b) ? 0.5 * (a + b) : Number.isFinite(a) ? a + 1 : b - 1
    const ef = exactForm(t)
    out.push({ t, text: ef ? ef.text : decimalText(t), q: qFromNumber(t) })
  }
  return out
}

// ============================================================================
// Clause solving
// ============================================================================

interface ClauseCtx {
  isVar: IsVar
  v: string
  vTex: string
  universe: IntervalPart[]
  win: [number, number]
  notes: Set<string>
}

interface ClauseOut {
  work: ClauseWork
  exactAll: boolean
}

/** Clauses that are already solved for the variable (x > 2, [0, 5), {1, 2}): the conclusion does not repeat them. */
const SOLVED = new WeakSet<ClauseWork>()

function solveRel(
  L: ExprNode, R: ExprNode, rel0: Relation,
  texts: { text: string; tex: string; lSrc: string; rSrc: string; lTex: string; rTex: string },
  cx: ClauseCtx,
): ClauseOut {
  let left = L, right = R, rel = rel0
  let lSrc = texts.lSrc, rSrc = texts.rSrc, lTex = texts.lTex, rTex = texts.rTex
  // the variable on the left, as it is taught: 2 < x reads x > 2
  if (!hasVarNode(L, cx.isVar) && hasVarNode(R, cx.isVar)) {
    left = R; right = L; rel = flipRel(rel0)
    ;[lSrc, rSrc, lTex, rTex] = [rSrc, lSrc, rTex, lTex]
  }
  const rightZero = !hasVarNode(right, cx.isVar) && constValue(right) === 0
  let h: ExprNode = rightZero ? left : ({ t: 'bin', op: '-', a: left, b: right } as ExprNode)
  let sides: { L: ExprNode; R: ExprNode } | null = rightZero ? null : { L: left, R: right }
  // |…| isolated with a positive coefficient, as it is taught: −|x| > −2 is |x| − 2 < 0
  const shape = absLinear(h, cx.isVar)
  let absText: { text: string; tex: string } | null = null
  if (shape) {
    let { alpha, beta } = shape
    if (qsign(alpha) < 0) {
      h = { t: 'neg', a: h } as ExprNode
      if (sides) sides = { L: sides.R, R: sides.L }
      rel = flipRel(rel)
      alpha = qneg(alpha)
      beta = qneg(beta)
    }
    const inner = [shape.c, shape.m]
    const a = qeq(alpha, Q1) ? '' : qint(alpha) ? qText(alpha) : `(${qText(alpha)})`
    const aTex = qeq(alpha, Q1) ? '' : qTex(alpha)
    const b = qz(beta) ? '' : ` ${qsign(beta) < 0 ? MINUS : '+'} ${qText(qabs(beta))}`
    const bTex = qz(beta) ? '' : ` ${qsign(beta) < 0 ? '-' : '+'} ${qTex(qabs(beta))}`
    // |3 − x| stays |3 − x| rather than |−x + 3|
    const backwards = qsign(shape.m) < 0 && !qz(shape.c)
    const mAbs = qabs(shape.m)
    const xTerm = (qeq(mAbs, Q1) ? '' : qint(mAbs) ? qText(mAbs) : `(${qText(mAbs)})`) + cx.v
    const xTermTex = (qeq(mAbs, Q1) ? '' : qTex(mAbs)) + cx.vTex
    const innerT = backwards ? `${qText(shape.c)} ${MINUS} ${xTerm}` : polyText(qpTrim(inner), cx.v)
    const innerTex = backwards ? `${qTex(shape.c)} - ${xTermTex}` : polyTex(qpTrim(inner), cx.vTex)
    absText = {
      text: `${a}|${innerT}|${b}`,
      tex: `${aTex}\\left|${innerTex}\\right|${bTex}`,
    }
  }
  const info = treeInfo(h, cx.isVar)
  const env: SnapEnv = { bases: info.bases, trig: info.trig }
  const eng = buildEngine(h, cx.isVar, cx.v, cx.universe, cx.win, env, info, sides)
  const f = eng.f

  // ---- h, as text ----
  const needsParens = (n: ExprNode): boolean => n.t === 'neg' || (n.t === 'bin' && (n.op === '+' || n.op === '-')) || (n.t === 'num' && n.v < 0)
  let hText: string, hTex: string
  if (absText) { hText = absText.text; hTex = absText.tex } else if (rightZero) { hText = pretty(lSrc); hTex = lTex } else if (eng.poly) { hText = polyText(eng.poly, cx.v); hTex = polyTex(eng.poly, cx.vTex) } else if (!hasVarNode(right, cx.isVar) && exactForm(Math.abs(constValue(right)))) {
    const c = constValue(right)
    const ef = exactForm(Math.abs(c)) as ExactForm
    hText = `${pretty(lSrc)} ${c < 0 ? '+' : MINUS} ${ef.text}`
    hTex = `${lTex} ${c < 0 ? '+' : '-'} ${ef.tex}`
  } else {
    hText = `${pretty(lSrc)} ${MINUS} ${needsParens(right) ? `(${pretty(rSrc)})` : pretty(rSrc)}`
    hTex = `${lTex} - ${needsParens(right) ? `\\left(${rTex}\\right)` : rTex}`
  }

  // ---- snap and classify the marks ----
  let marks = dedupeMarks(eng.marks)
  for (const m of marks) {
    if (m.exact) continue
    const S = Math.max(m.scale, 1e-300)
    const check = m.why === 'zero' && !m.evalSign
      ? (c: number) => { const y = f(c); return Number.isFinite(y) && Math.abs(y) <= (m.touch ? 1e-12 : 1e-9) * Math.max(S, 1) }
      : () => true
    const ex = snapPoint(m.x, env, check, m.touch === true)
    if (ex) { m.exact = ex; m.x = ex.value }
  }
  marks = dedupeMarks(marks)
  // An exponential equation a·b^(mx + c) = d (or two powers of x) is solved
  // by its STRUCTURE (./expSolve.ts): its zero is written as the logarithm
  // the method produces — log₂(7/3), 5 ln 4 — never as whatever a digit
  // match proposed (ln 1024). Read only when both sides are such shapes.
  let expWork: ClauseWork['exp'] = null
  {
    const fs = expShapeOf(left, cx.isVar)
    const gs = fs ? expShapeOf(right, cx.isVar) : null
    const sol = fs && gs ? solveExpEquation(fs, gs, cx.v) : null
    if (sol && sol.kind === 'one') {
      const at = marks.find((m) => m.why === 'zero' && Math.abs(m.x - sol.x) <= 1e-7 * Math.max(1, Math.abs(sol.x)))
      if (at) {
        at.x = sol.x
        at.exact = { text: sol.forms[0].text, tex: sol.forms[0].tex, value: sol.x }
        expWork = { x: sol.x, forms: sol.forms, steps: sol.steps }
      }
    }
  }
  // a "domain end" with h defined on both sides is an excluded point (a hole)
  for (const m of marks) {
    if (m.why !== 'domain-end') continue
    const d = 1e-7 * Math.max(1, Math.abs(m.x))
    if (!Number.isNaN(f(m.x - d)) && !Number.isNaN(f(m.x + d))) m.why = 'undefined'
  }
  if (marks.length > MAX_CRITICAL) {
    fail(`${texts.text} has more than ${MAX_CRITICAL} critical values — restrict ${cx.v} to an interval, like {0 ≤ ${cx.v} ≤ 2π}`)
  }

  // ---- per universe part: critical values and rows ----
  const critical: CriticalValue[] = []
  const table: TestRow[] = []
  const solParts: IntervalPart[] = []
  const domParts: IntervalPart[] = []
  const zeroMult = new Map<number, number>()

  for (const U of cx.universe) {
    const inside = marks.filter((m) => (m.x > U.lo || same(m.x, U.lo)) && (m.x < U.hi || same(m.x, U.hi)))
    // the universe's finite ends are ends of the domain too
    const ends: Mark[] = []
    for (const [x, ex] of [[U.lo, U.loExact], [U.hi, U.hiExact]] as const) {
      if (!Number.isFinite(x) || inside.some((m) => same(m.x, x))) continue
      const d = 1e-9 * Math.max(1, Math.abs(x))
      const inward = x === U.lo ? x + d : x - d
      if (!Number.isFinite(f(x)) && Number.isNaN(f(inward))) continue
      ends.push({ x, exact: ex ?? exactForm(x), why: 'domain-end', scale: 1 })
    }
    const cuts = [...inside, ...ends].sort((a, b) => a.x - b.x)
    for (const m of cuts) {
      const inU = inParts([U], m.x)
      let defined: number | null
      let sign: Sign | null
      if (m.why === 'zero' && !m.evalSign) { defined = 0; sign = 0 } else if (m.why === 'undefined' || m.evalSign) {
        if (m.jump || m.evalSign) {
          const y = f(m.x)
          defined = Number.isFinite(y) ? y : null
          sign = defined === null ? null : Math.abs(defined) < 1e-13 ? 0 : sgnOf(defined)
        } else { defined = null; sign = null }
      } else {
        defined = valueAtEnd(f, m.x, m.exact)
        sign = defined === null ? null : Math.abs(defined) <= 1e-12 * Math.max(1, m.scale) ? 0 : sgnOf(defined)
      }
      const included = inU && sign !== null && sat(rel, sign)
      const cv: CriticalValue = { x: m.x, exact: m.exact, why: m.why, included }
      if (m.why === 'zero' && m.mult !== undefined) cv.multiplicity = m.mult
      if (m.why === 'zero' && m.mult !== undefined && m.mult % 2 === 0) zeroMult.set(m.x, m.mult)
      critical.push(cv)
      if (inU && defined !== null) domParts.push(part(m.x, m.x, true, true, m.exact, m.exact))
      if (included) solParts.push(part(m.x, m.x, true, true, m.exact, m.exact))
    }
    // rows between consecutive cuts (and out to the universe's ends)
    const pos: { x: number; ex: ExactForm | null }[] = []
    if (!cuts.length || !same(cuts[0].x, U.lo)) pos.push({ x: U.lo, ex: U.loExact })
    for (const m of cuts) pos.push({ x: m.x, ex: m.exact })
    if (!cuts.length || !same(cuts[cuts.length - 1].x, U.hi)) pos.push({ x: U.hi, ex: U.hiExact })
    for (let i = 0; i + 1 < pos.length; i++) {
      const a = pos[i], b = pos[i + 1]
      if (!(b.x > a.x) || same(a.x, b.x)) continue
      const cands = testCandidates(a.x, b.x, env.trig)
      let pick = cands[0]
      let val = eng.valueAt(pick.t, pick.q)
      const first = val
      for (const c of cands.slice(0, 12)) {
        const vv = c === cands[0] ? val : eng.valueAt(c.t, c.q)
        // An exact value reads better — but never a 0 the nicest point did not
        // see: there is no zero inside the interval, so a 0 far out is the
        // arithmetic failing (eˣ and 2ˣ both underflow at x = −10000; eˣ + 0.001
        // rounds to eˣ at x = 100), not h vanishing.
        if (vv.v === 0 && first.v !== null && first.v !== 0) continue
        if (vv.exact && vv.v !== null) { pick = c; val = vv; break }
      }
      let sign: Sign | null = null
      if (val.v !== null) sign = Math.abs(val.v) < 1e-13 && val.exact ? 0 : sgnOf(val.v)
      const satisfies = sign !== null && sat(rel, sign)
      table.push({ lo: a.x, hi: b.x, t: pick.t, tText: pick.text, value: val.v, valueText: val.text, sign, satisfies })
      if (val.v !== null) domParts.push(part(a.x, b.x, false, false, a.ex, b.ex))
      if (satisfies) solParts.push(part(a.x, b.x, false, false, a.ex, b.ex))
    }
  }

  const solution = mergeParts(solParts)
  const domain = mergeParts(domParts)
  const exactAll = solution.every((p) => (!Number.isFinite(p.lo) || p.loExact !== null) && (!Number.isFinite(p.hi) || p.hiExact !== null))
  if (eng.numeric && eng.windowCut) {
    cx.notes.add(`The critical values of ${texts.text} were found by a numeric search over ${decimalText(cx.win[0])} ≤ ${cx.v} ≤ ${decimalText(cx.win[1])} (and written exactly where they have a closed form); beyond that window the sign is assumed not to change again.`)
  }
  if (eng.overflow) cx.notes.add('Far out the values overflow double precision; the sign there is read from where h arrives at the overflow.')
  for (const [x, mult] of zeroMult) {
    const cv = critical.find((c) => c.x === x)
    const t = cv?.exact ? cv.exact.text : sig4Text(x)
    cx.notes.add(`${t} is a zero of multiplicity ${mult} of ${hText}: h touches 0 there without changing sign.`)
  }

  // ---- distance reading ----
  let distance: ClauseWork['distance'] = null
  if (eng.distance) {
    const { alpha, beta, m, c } = eng.distance
    const center = qneg(qdiv(c, m))
    const radius = qdiv(qneg(beta), qmul(alpha, qabs(m)))
    const r2 = qsign(alpha) > 0 ? rel : flipRel(rel)
    if (qsign(radius) > 0) {
      const cT = qText(center), rT = qText(radius)
      const inner = qz(center) ? cx.v : qsign(center) > 0 ? `${cx.v} ${MINUS} ${cT}` : `${cx.v} + ${qText(qneg(center))}`
      const words: Record<Relation, string> = {
        '<': `within ${rT} of ${cT}`,
        '<=': `within ${rT} of ${cT}, ends included`,
        '>': `more than ${rT} from ${cT}`,
        '>=': `at least ${rT} from ${cT}`,
        '=': `exactly ${rT} from ${cT}`,
        '!=': `not exactly ${rT} from ${cT}`,
      }
      distance = {
        center: qnum(center), centerText: cT, radius: qnum(radius), radiusText: rT,
        sentence: `|${inner}| ${REL_TEXT[r2]} ${rT}: the numbers ${words[r2]}`,
      }
    }
  }

  const work: ClauseWork = {
    text: texts.text,
    tex: texts.tex,
    hText,
    hTex,
    relation: rel,
    domain: realSet(domain, cx.v),
    critical,
    table,
    solution: realSet(solution, cx.v),
    distance,
    factored: eng.factored,
  }
  if (expWork) work.exp = expWork
  const bare = (n: ExprNode): boolean => (n.t === 'var' || n.t === 'param') && cx.isVar(n)
  if ((bare(L) && !hasVarNode(R, cx.isVar)) || (bare(R) && !hasVarNode(L, cx.isVar))) SOLVED.add(work)
  return { work, exactAll }
}

/** A clause given as a set: an interval, a list of points, or a bound with ∞ (the old grammar). */
function solveGiven(pieces: Piece[], text: string, tex: string, cx: ClauseCtx): ClauseOut {
  const parts = intersectParts(mergeParts(pieces.map(pieceToPart)), cx.universe)
  const critical: CriticalValue[] = []
  for (const p of parts) {
    if (Number.isFinite(p.lo)) critical.push({ x: p.lo, exact: p.loExact, why: 'zero', included: p.loClosed })
    if (Number.isFinite(p.hi) && p.hi !== p.lo) critical.push({ x: p.hi, exact: p.hiExact, why: 'zero', included: p.hiClosed })
  }
  const allPts = pieces.length > 0 && pieces.every((p) => p.lo === p.hi)
  const exactAll = parts.every((p) => (!Number.isFinite(p.lo) || p.loExact !== null) && (!Number.isFinite(p.hi) || p.hiExact !== null))
  const out: ClauseOut = {
    work: {
      text, tex, hText: text, hTex: tex,
      relation: allPts ? '=' : '<=',
      domain: realSet(cx.universe, cx.v),
      critical,
      table: [],
      solution: realSet(parts, cx.v),
      distance: null,
      factored: null,
    },
    exactAll,
  }
  SOLVED.add(out.work)
  return out
}

function boundExact(v: number, tex: string | null, src: string | null | undefined): ExactForm | null {
  if (!Number.isFinite(v)) return null
  const ef = exactForm(v)
  if (ef) return ef
  for (const c of extForms(v, { bases: [], trig: false }, 1e-10)) return c
  if (tex && src) return { text: pretty(src), tex, value: v }
  return null
}

function pieceToPart(p: Piece): IntervalPart {
  return part(p.lo, p.hi, p.loC, p.hiC, boundExact(p.lo, p.loTex, p.loSrc), boundExact(p.hi, p.hiTex, p.hiSrc))
}

// ============================================================================
// Source handling: normalisation, universe, connectives, relations
// ============================================================================

/** Unicode the expression parser does not read, rewritten; `map` takes new offsets back to the typed ones. */
function normalise(src: string): { s: string; map: number[] } {
  let s = ''
  const map: number[] = []
  const put = (t: string, at: number): void => { for (const c of t) { s += c; map.push(at) } }
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '√') put('sqrt', i)
    else if (c === '⩽' || c === '≦') put('≤', i)
    else if (c === '⩾' || c === '≧') put('≥', i)
    else if (c === '∈') put(' in ', i)
    else if (c === ' ') put(' ', i)
    else put(c, i)
  }
  map.push(src.length)
  return { s, map }
}

/** Display text: ≤ ≥ ≠, a real minus, x², √, π, θ. */
function pretty(src: string): string {
  let t = src.trim()
  t = t.replace(/<=|=</g, '≤').replace(/>=|=>/g, '≥').replace(/!=|<>/g, '≠').replace(/==/g, '=')
  t = t.replace(/sqrt\s*\(/g, '√(').replace(/(?<![A-Za-z])pi(?![A-Za-z])/g, 'π').replace(/(?<![A-Za-z])theta(?![A-Za-z])/g, 'θ').replace(/(?<![A-Za-z])tau(?![A-Za-z])/g, 'τ')
  t = t.replace(/(?<![A-Za-z])(?:infinity|infty|inf|oo)(?![A-Za-z])/g, '∞')
  t = t.replace(/\^\s*(\d)(?![\d.])/g, (_m, d: string) => SUP[d])
  t = t.replace(/\*/g, '·').replace(/-/g, MINUS)
  t = t.replace(/\s*(≤|≥|≠|<|>|=)\s*/g, ' $1 ')
  return t.replace(/\s+/g, ' ').trim()
}

const OPENERS = '([{'
const CLOSERS = ')]}'

function matchClose(s: string, i: number): number {
  let depth = 0
  for (let k = i; k < s.length; k++) {
    if (OPENERS.includes(s[k])) depth++
    else if (CLOSERS.includes(s[k])) {
      depth--
      if (depth === 0) return k
    }
  }
  return -1
}

function topLevelCommas(s: string): number[] {
  const out: number[] = []
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (OPENERS.includes(c)) depth++
    else if (CLOSERS.includes(c)) depth--
    else if (c === ',' && depth === 0) out.push(i)
  }
  return out
}

interface RelTok { op: Relation; at: number; len: number }

function scanRels(s: string): RelTok[] {
  const out: RelTok[] = []
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (OPENERS.includes(c)) { depth++; continue }
    if (CLOSERS.includes(c)) { depth--; continue }
    if (depth !== 0) continue
    const two = s.slice(i, i + 2)
    if (two === '<=' || two === '=<') { out.push({ op: '<=', at: i, len: 2 }); i++; continue }
    if (two === '>=' || two === '=>') { out.push({ op: '>=', at: i, len: 2 }); i++; continue }
    if (two === '!=' || two === '<>') { out.push({ op: '!=', at: i, len: 2 }); i++; continue }
    if (two === '==') { out.push({ op: '=', at: i, len: 2 }); i++; continue }
    if (c === '≤') out.push({ op: '<=', at: i, len: 1 })
    else if (c === '≥') out.push({ op: '>=', at: i, len: 1 })
    else if (c === '≠') out.push({ op: '!=', at: i, len: 1 })
    else if (c === '<') out.push({ op: '<', at: i, len: 1 })
    else if (c === '>') out.push({ op: '>', at: i, len: 1 })
    else if (c === '=') out.push({ op: '=', at: i, len: 1 })
  }
  return out
}

type Conn = 'and' | 'or'

function splitConnectives(src: string): { parts: { text: string; start: number }[]; ops: Conn[] } {
  const parts: { text: string; start: number }[] = []
  const ops: Conn[] = []
  let depth = 0
  let segStart = 0
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (OPENERS.includes(c)) { depth++; continue }
    if (CLOSERS.includes(c)) { depth--; continue }
    if (depth !== 0) continue
    let op: Conn | null = null
    let len = 0
    if (c === '∪') { op = 'or'; len = 1 } else if (c === '∩') { op = 'and'; len = 1 } else if (/[A-Za-z]/.test(c) && (i === 0 || !/[A-Za-z0-9_]/.test(src[i - 1]))) {
      let j = i
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++
      const word = src.slice(i, j).toLowerCase()
      if (word === 'or' || word === 'and') { op = word; len = j - i } else { i = j - 1; continue }
    }
    if (op === null) continue
    parts.push({ text: src.slice(segStart, i), start: segStart })
    ops.push(op)
    segStart = i + len
    i += len - 1
  }
  parts.push({ text: src.slice(segStart), start: segStart })
  return { parts, ops }
}

const HAS_INFINITY_RE = /(^|[^A-Za-z])(inf|infty|infinity|oo)([^A-Za-z]|$)|∞/i
const REL_CHAR_RE = /[<>=≤≥≠]/
const CONN_END_RE = /(^|[^A-Za-z])(and|or)\s*$|[∪∩]\s*$/i

/** A trailing restriction: "{0 <= x <= 2pi}", "on [0, 2pi)", "for 0 <= x < 2pi", ", x in [0, 2pi]". */
function splitUniverse(s: string): { body: string; uni: string | null; uniStart: number } {
  const t = s.replace(/\s+$/, '')
  // braces
  if (t.endsWith('}')) {
    let depth = 0
    let open = -1
    for (let k = t.length - 1; k >= 0; k--) {
      if (CLOSERS.includes(t[k])) depth++
      else if (OPENERS.includes(t[k])) {
        depth--
        if (depth === 0) { open = k; break }
      }
    }
    if (open > 0 && t[open] === '{') {
      const body = t.slice(0, open)
      const inner = t.slice(open + 1, -1)
      if (body.trim() !== '' && !CONN_END_RE.test(body) && REL_CHAR_RE.test(body) && (REL_CHAR_RE.test(inner) || /^\s*[[(]/.test(inner) || /\bin\b/.test(inner))) {
        return { body, uni: inner, uniStart: open + 1 }
      }
    }
  }
  // keywords and a comma, at depth 0: the leftmost one that leaves a clean body
  let depth = 0
  const seps: { at: number; len: number }[] = []
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (OPENERS.includes(c)) { depth++; continue }
    if (CLOSERS.includes(c)) { depth--; continue }
    if (depth !== 0) continue
    if (c === ',') { seps.push({ at: i, len: 1 }); continue }
    if (/[A-Za-z]/.test(c) && (i === 0 || !/[A-Za-z0-9_]/.test(t[i - 1]))) {
      let j = i
      while (j < t.length && /[A-Za-z0-9_]/.test(t[j])) j++
      const w = t.slice(i, j).toLowerCase()
      if (['for', 'on', 'over', 'where', 'when', 'in'].includes(w) && i > 0) seps.push({ at: i, len: j - i })
      i = j - 1
    }
  }
  for (const sep of seps) {
    const body = t.slice(0, sep.at)
    let uni = t.slice(sep.at + sep.len)
    let uniStart = sep.at + sep.len
    const m = /^(\s*[A-Za-zθ]+\s+in\s+)/.exec(uni)
    if (m) { uni = uni.slice(m[1].length); uniStart += m[1].length }
    if (body.trim() !== '' && REL_CHAR_RE.test(body) && topLevelCommas(body).length === 0 && uni.trim() !== '' && (REL_CHAR_RE.test(uni) || /^\s*[[(]/.test(uni))) {
      return { body, uni, uniStart }
    }
  }
  return { body: s, uni: null, uniStart: 0 }
}

// ============================================================================
// Conclusion text
// ============================================================================

function partPhrase(p: IntervalPart, v: string): { t: string; tex: string } {
  const e = (x: number, ex: ExactForm | null) => ({ t: ex ? ex.text : sig4Text(x), tex: ex ? ex.tex : decimalTex(x) })
  const lo = e(p.lo, p.loExact), hi = e(p.hi, p.hiExact)
  const loF = Number.isFinite(p.lo), hiF = Number.isFinite(p.hi)
  if (loF && hiF && p.lo === p.hi) return { t: `${v} = ${lo.t}`, tex: `${v} = ${lo.tex}` }
  if (loF && hiF) {
    return {
      t: `${lo.t} ${p.loClosed ? '≤' : '<'} ${v} ${p.hiClosed ? '≤' : '<'} ${hi.t}`,
      tex: `${lo.tex} ${p.loClosed ? '\\le' : '<'} ${v} ${p.hiClosed ? '\\le' : '<'} ${hi.tex}`,
    }
  }
  if (loF) return { t: `${v} ${p.loClosed ? '≥' : '>'} ${lo.t}`, tex: `${v} ${p.loClosed ? '\\ge' : '>'} ${lo.tex}` }
  if (hiF) return { t: `${v} ${p.hiClosed ? '≤' : '<'} ${hi.t}`, tex: `${v} ${p.hiClosed ? '\\le' : '<'} ${hi.tex}` }
  return { t: 'every real number', tex: '\\text{every real number}' }
}

/** "x < −2 or x > 2", "x ≠ 3", "x = −2 or x = 2", "every real number" — null for ∅. */
function setPhrase(set: RealSet, v: string, vTex: string): { t: string; tex: string } | null {
  const ps = set.parts
  if (ps.length === 0) return null
  if (ps.length === 1 && !Number.isFinite(ps[0].lo) && !Number.isFinite(ps[0].hi)) return { t: 'every real number', tex: '\\text{every real number}' }
  if (set.kind === 'intervals' && set.builder !== set.text && ps.length > 1) {
    const d = describeSet(ps, vTex)
    return { t: set.builder, tex: d.builderTex }
  }
  const items = ps.map((p) => ({ t: partPhrase(p, v).t, tex: partPhrase(p, vTex).tex }))
  return { t: items.map((i) => i.t).join(' or '), tex: items.map((i) => i.tex).join(' \\text{ or } ') }
}

function clauseSentence(w: ClauseWork, v: string, vTex: string): { t: string; tex: string; empty: boolean } {
  const ph = setPhrase(w.solution, v, vTex)
  if (!ph) return { t: `${w.text} is never true`, tex: `${w.tex} \\text{ is never true}`, empty: true }
  const word = w.solution.kind === 'finite' ? 'when' : 'for'
  return { t: `${w.text} ${word} ${ph.t}`, tex: `${w.tex} \\text{ ${word} } ${ph.tex}`, empty: false }
}

function conclusionOf(
  clauses: ClauseWork[], combine: SolveResult['combine'], mixed: boolean,
  sol: RealSet, uni: IntervalPart | null, v: string, vTex: string, typed: { t: string; tex: string },
): { t: string; tex: string } {
  const setT = sol.parts.length === 0 ? 'there is no solution (∅)' : `the solution ${sol.kind === 'finite' ? 'set ' : ''}is ${sol.text}`
  const setTex = sol.parts.length === 0 ? '\\text{there is no solution } (\\varnothing)' : `\\text{the solution ${sol.kind === 'finite' ? 'set ' : ''}is } ${sol.tex}`
  let pre = '', preTex = ''
  if (uni) {
    const ud = partPhrase(uni, v), udTex = partPhrase(uni, vTex)
    pre = `On ${ud.t}, `
    preTex = `\\text{On } ${udTex.tex}\\text{, }`
  }
  if (clauses.every((c) => SOLVED.has(c))) {
    // nothing to solve: say what the set is, in interval notation
    const allGiven = clauses.every((c) => c.table.length === 0)
    if (sol.parts.length === 0) {
      return { t: `${pre}${typed.t} holds for no number, so ${setT}`, tex: `${preTex}${typed.tex}\\text{ holds for no number, so } ${setTex}` }
    }
    if (allGiven) {
      const st = `The solution ${sol.kind === 'finite' ? 'set ' : ''}is ${sol.text}`
      return { t: `${pre}${pre ? st.charAt(0).toLowerCase() + st.slice(1) : st}`, tex: `${preTex}\\text{${pre ? 'the' : 'The'} solution ${sol.kind === 'finite' ? 'set ' : ''}is } ${sol.tex}` }
    }
    const how = sol.kind === 'finite' ? 'as a set' : 'in interval notation'
    return { t: `${pre}${typed.t} ${how} is ${sol.text}`, tex: `${preTex}${typed.tex}\\text{ ${how} is } ${sol.tex}` }
  }
  if (clauses.length === 1) {
    const s = clauseSentence(clauses[0], v, vTex)
    return { t: `${pre}${s.t}, so ${setT}`, tex: `${preTex}${s.tex}\\text{, so } ${setTex}` }
  }
  const each = clauses.map((c) => clauseSentence(c, v, vTex))
  const ph = setPhrase(sol, v, vTex)
  let join: string, joinTex: string
  if (mixed) {
    join = ph ? `Combining them ("and" before "or"), they hold for ${ph.t}` : 'Combining them ("and" before "or"), they never hold together'
    joinTex = ph ? `\\text{Combining them, they hold for } ${ph.tex}` : '\\text{Combining them, they never hold}'
  } else if (combine === 'and') {
    join = ph ? `Both are true for ${ph.t}` : 'They are never true together'
    joinTex = ph ? `\\text{Both are true for } ${ph.tex}` : '\\text{They are never true together}'
    if (clauses.length > 2) { join = join.replace('Both are', 'All are'); joinTex = joinTex.replace('Both are', 'All are') }
  } else {
    join = ph ? `At least one is true for ${ph.t}` : 'Neither is ever true'
    joinTex = ph ? `\\text{At least one is true for } ${ph.tex}` : '\\text{Neither is ever true}'
  }
  return {
    t: `${pre}${each.map((e) => e.t).join('; ')}. ${join}, so ${setT}`,
    tex: `${preTex}${each.map((e) => e.tex).join(';\\ ')}.\\ ${joinTex}\\text{, so } ${setTex}`,
  }
}

// ============================================================================
// Entry point
// ============================================================================

interface RelClause {
  kind: 'rel'
  L: ExprNode
  R: ExprNode
  rel: Relation
  text: string
  tex: string
  lSrc: string
  rSrc: string
  lTex: string
  rTex: string
}
interface GivenClause {
  kind: 'given'
  pieces: Piece[]
  text: string
  tex: string
}
type Clause = RelClause | GivenClause

/** The and / or structure of the input over its clauses. */
type Tree = { kind: 'leaf'; i: number } | { kind: 'and' | 'or'; kids: Tree[]; chain?: boolean }

/** Solve a one-variable inequality, equation or compound (see the header). */
export function solveInequality(src: string, opts?: SolveOptions): SolveOutcome {
  let map: number[] = []
  const origin = (p: number | undefined): number | undefined => (p === undefined ? undefined : map[Math.max(0, Math.min(map.length - 1, p))])
  try {
    if (typeof src !== 'string' || src.trim() === '') {
      return { ok: false, error: 'Empty input — write an inequality like x^2 - 4 > 0, or an interval like [-2, 5)' }
    }
    const norm = normalise(src)
    map = norm.map
    return solveImpl(norm.s, opts)
  } catch (err) {
    if (err instanceof SolveError || err instanceof CondError) {
      const pos = origin(err.pos)
      return pos !== undefined ? { ok: false, error: err.message, pos } : { ok: false, error: err.message }
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function sideOf(text: string, start: number): { node: ExprNode; src: string; tex: string } {
  const lead = text.length - text.trimStart().length
  const t = text.trim()
  if (t === '') fail('Expected an expression on each side of the comparison', start)
  const r = parseAst(t)
  if (!r.ok) fail(r.error, r.pos !== undefined ? start + lead + r.pos : start)
  if (r.rhs !== null) fail("Unexpected '='", start)
  const an = analyzeExpr(t)
  return { node: r.lhs, src: t, tex: an.ok ? an.latex : t }
}

function collectNames(n: ExprNode, out: Set<string>): void {
  switch (n.t) {
    case 'var': case 'param': out.add(n.name); return
    case 'neg': collectNames(n.a, out); return
    case 'bin': collectNames(n.a, out); collectNames(n.b, out); return
    case 'call': n.args.forEach((a) => collectNames(a, out)); return
    default: return
  }
}

function solveImpl(s: string, opts?: SolveOptions): SolveResult {
  const win: [number, number] =
    opts?.window && Number.isFinite(opts.window[0]) && Number.isFinite(opts.window[1]) && opts.window[1] > opts.window[0]
      ? [opts.window[0], opts.window[1]]
      : DEFAULT_WINDOW
  const { body, uni, uniStart } = splitUniverse(s)
  const condCtx = newCtx(analyzeExpr)
  // ---- clauses, as a tree: 'and' binds tighter than 'or', brackets group ----
  const clauses: Clause[] = []
  const names = new Set<string>()

  const leafOf = (text0: string, start0: number): Tree => {
    const lead = text0.length - text0.trimStart().length
    const tt = text0.trim()
    const start = start0 + lead
    if (tt === '') fail('Expected an inequality, an interval or a set of points', start)
    const head = tt[0]
    const closeAt = OPENERS.includes(head) ? matchClose(tt, 0) : -1
    const isSet = head === '{' && closeAt === tt.length - 1
    const isInterval = (head === '[' || head === '(') && closeAt === tt.length - 1 && topLevelCommas(tt.slice(1, -1)).length >= 1
    if (isSet || isInterval || HAS_INFINITY_RE.test(tt)) {
      const pieces = parseCondition(tt, condCtx, start)
      clauses.push({ kind: 'given', pieces, text: pretty(tt), tex: givenTex(pieces) })
      return { kind: 'leaf', i: clauses.length - 1 }
    }
    const rels = scanRels(tt)
    if (rels.length === 0) {
      fail(`Expected a comparison in '${tt}' — something like ${tt || 'x'} > 0, or an interval like [1, 3]`, start)
    }
    if (rels.length > 2) {
      fail(`Too many comparisons in one chain — use 'and' / 'or' to join separate inequalities`, start + rels[2].at)
    }
    const spans: { text: string; start: number }[] = []
    let from = 0
    for (const r of rels) {
      spans.push({ text: tt.slice(from, r.at), start: start + from })
      from = r.at + r.len
    }
    spans.push({ text: tt.slice(from), start: start + from })
    const sides = spans.map((sp) => sideOf(sp.text, sp.start))
    for (const sd of sides) collectNames(sd.node, names)
    const mk = (i: number, j: number, rel: Relation, txt: string): Tree => {
      clauses.push({
        kind: 'rel', L: sides[i].node, R: sides[j].node, rel,
        text: pretty(txt),
        tex: `${sides[i].tex} ${REL_TEX[rel]} ${sides[j].tex}`,
        lSrc: sides[i].src, rSrc: sides[j].src, lTex: sides[i].tex, rTex: sides[j].tex,
      })
      return { kind: 'leaf', i: clauses.length - 1 }
    }
    if (rels.length === 1) return mk(0, 1, rels[0].op, tt)
    // a chain a R1 m R2 b: (a R1 m) and (m R2 b)
    const [r1, r2] = rels
    for (const r of rels) {
      if (r.op === '=' || r.op === '!=') fail(`'${REL_TEXT[r.op]}' cannot be part of a chain — use 'and' / 'or' instead`, start + r.at)
    }
    const less = (r: Relation) => r === '<' || r === '<='
    if (less(r1.op) !== less(r2.op)) {
      fail('The chain changes direction — write it as a < … < b (or all the other way round)', start + r2.at)
    }
    const A = mk(0, 1, r1.op, tt.slice(0, r2.at))
    const B = mk(1, 2, r2.op, tt.slice(r1.at + r1.len))
    return { kind: 'and', kids: [A, B], chain: true }
  }

  const compound = (text: string, start: number): Tree => {
    const { parts, ops } = splitConnectives(text)
    const nodes = parts.map((p): Tree => {
      let t = p.text
      let st = start + p.start
      // brackets around a whole comparison or compound: (x < 3), (x < 1 or x > 4)
      for (;;) {
        const lead = t.length - t.trimStart().length
        const tt = t.trim()
        const inner = tt.slice(1, -1)
        if (tt.startsWith('(') && matchClose(tt, 0) === tt.length - 1 && topLevelCommas(inner).length === 0 && scanRels(inner).length > 0) {
          st += lead + 1
          t = inner
          if (splitConnectives(inner).ops.length > 0) return compound(inner, st)
          continue
        }
        break
      }
      return leafOf(t, st)
    })
    if (nodes.length === 1) return nodes[0]
    const ors: Tree[] = []
    let acc: Tree[] = [nodes[0]]
    for (let i = 0; i < ops.length; i++) {
      if (ops[i] === 'and') acc.push(nodes[i + 1])
      else { ors.push(acc.length === 1 ? acc[0] : { kind: 'and', kids: acc }); acc = [nodes[i + 1]] }
    }
    ors.push(acc.length === 1 ? acc[0] : { kind: 'and', kids: acc })
    return ors.length === 1 ? ors[0] : { kind: 'or', kids: ors }
  }
  const tree = compound(body, 0)

  // ---- the universe ----
  let uniPieces: Piece[] | null = null
  if (uni !== null) uniPieces = parseCondition(uni, condCtx, uniStart)

  // ---- the variable ----
  if (condCtx.name !== null) names.add(condCtx.name)
  if (names.size > 1) {
    const [a, b] = [...names]
    fail(`Two different letters ('${a}' and '${b}') — a number line solves for one variable at a time`)
  }
  if (names.size === 0 && clauses.some((c) => c.kind === 'rel')) {
    fail('There is no variable here, so there is nothing to solve — write something like x^2 > 4')
  }
  // a line of bare intervals / sets ([0, 5), {1, 2}) names no letter: it is about x
  const V = names.size > 0 ? [...names][0] : 'x'
  const vText = V === 'theta' ? 'θ' : V
  const vTex = V === 'theta' ? '\\theta' : V
  const isVar: IsVar = (n) => (n.t === 'var' || n.t === 'param') && n.name === V

  // ---- universe parts (a typed one, or one period for a periodic trig clause) ----
  const notes = new Set<string>()
  let universe: IntervalPart[] = [WHOLE()]
  let uniReport: IntervalPart | null = null
  if (uniPieces) {
    universe = mergeParts(uniPieces.map(pieceToPart))
    if (universe.length === 0) fail('The restriction is empty — nothing is left to solve over', uniStart)
    uniReport = universe.length === 1 ? universe[0] : part(universe[0].lo, universe[universe.length - 1].hi, universe[0].loClosed, universe[universe.length - 1].hiClosed, universe[0].loExact, universe[universe.length - 1].hiExact)
  } else {
    let period = 0
    for (const c of clauses) {
      if (c.kind !== 'rel') continue
      const h: ExprNode = { t: 'bin', op: '-', a: c.L, b: c.R } as ExprNode
      const info = treeInfo(h, isVar)
      if (!info.trig) continue
      const f = compileFn(h, isVar)
      for (const k of [1, 2, 3, 4]) {
        const P = 2 * Math.PI * k
        let ok = true
        for (let j = 0; j < 24 && ok; j++) {
          const x = -9.7 + 0.83 * j
          const a = f(x), b = f(x + P)
          if (Number.isNaN(a) && Number.isNaN(b)) continue
          if (!(Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a)))) ok = false
        }
        if (ok) { period = Math.max(period, P); break }
      }
    }
    if (period > 0) {
      const pe = exactForm(period)
      universe = [part(0, period, true, false, { text: '0', tex: '0', value: 0 }, pe)]
      uniReport = universe[0]
      const pT = pe ? pe.text : decimalText(period)
      notes.add(`The trig function repeats every ${pT}, so this is solved over one period, 0 ≤ ${vText} < ${pT}; every solution plus a multiple of ${pT} is also a solution. Add a restriction like {−π ≤ ${vText} ≤ π} to choose another interval.`)
    }
  }

  // ---- solve ----
  const cx: ClauseCtx = { isVar, v: vText, vTex, universe, win, notes }
  const outs: ClauseOut[] = clauses.map((c) =>
    c.kind === 'given'
      ? solveGiven(c.pieces, c.text, c.tex, cx)
      : solveRel(c.L, c.R, c.rel, { text: c.text, tex: c.tex, lSrc: c.lSrc, rSrc: c.rSrc, lTex: c.lTex, rTex: c.rTex }, cx),
  )

  // ---- combine along the tree ----
  const evalTree = (t: Tree): IntervalPart[] => {
    if (t.kind === 'leaf') return outs[t.i].work.solution.parts
    const sets = t.kids.map(evalTree)
    if (t.kind === 'and') return sets.slice(1).reduce((acc, p) => intersectParts(acc, p), sets[0])
    return mergeParts(sets.flat())
  }
  const combinedParts = mergeParts(evalTree(tree))
  const solution = realSet(combinedParts, vText)
  const combine: SolveResult['combine'] = tree.kind === 'leaf' ? 'single' : tree.kind
  const kinds = new Set<string>()
  const walkKinds = (t: Tree): void => {
    if (t.kind === 'leaf') return
    kinds.add(t.kind)
    t.kids.forEach(walkKinds)
  }
  walkKinds(tree)
  const mixed = kinds.has('and') && kinds.has('or')

  const exact = combinedParts.every((p) => (!Number.isFinite(p.lo) || p.loExact !== null) && (!Number.isFinite(p.hi) || p.hiExact !== null))
  if (!exact) notes.add('Endpoints written as decimals are approximate: they were found numerically and have no closed form here.')
  const works = outs.map((o) => o.work)
  const texOf = (t: Tree, top: boolean): string => {
    if (t.kind === 'leaf') return works[t.i].tex
    const inner = t.kids.map((k) => texOf(k, false)).join(`\\text{ ${t.kind} } `)
    return top || t.kind === 'and' ? inner : `\\left(${inner}\\right)`
  }
  const typed = { t: pretty(body), tex: texOf(tree, true) }
  const concl = conclusionOf(works, combine, mixed, solution, uniReport, vText, vTex, typed)
  return {
    ok: true,
    solution,
    combine,
    clauses: works,
    conclusion: concl.t,
    conclusionTex: concl.tex,
    universe: uniReport,
    variable: vText,
    exact,
    notes: [...notes],
  }
}

/** Interval / set notation with the bounds as typed. */
function givenTex(pieces: Piece[]): string {
  if (pieces.length === 0) return '\\varnothing'
  return pieces
    .map((p) => {
      if (p.lo === p.hi) return `\\left\\{${p.loTex ?? decimalTex(p.lo)}\\right\\}`
      const l = Number.isFinite(p.lo) && p.loC ? '[' : '('
      const r = Number.isFinite(p.hi) && p.hiC ? ']' : ')'
      const lo = Number.isFinite(p.lo) ? p.loTex ?? decimalTex(p.lo) : '-\\infty'
      const hi = Number.isFinite(p.hi) ? p.hiTex ?? decimalTex(p.hi) : '\\infty'
      return `\\left${l}${lo}, ${hi}\\right${r}`
    })
    .join(' \\cup ')
}

// ============================================================================
// Shared exact machinery — read by ./equationRoute.ts (the algebraic route of
// an equation: squaring, the LCD, combining logs) so that it solves its
// polynomial with the SAME rational-root / surd code this solver uses, rather
// than a second copy of it. Nothing here changes how an inequality is solved.
// ============================================================================

export type { Q, QP, IsVar, RQ, QRoots, Root as QRoot }
export {
  mkQ, Q0, Q1, qadd, qsub, qmul, qdiv, qneg, qabs, qz, qsign, qeq, qnum, qint, qText, qTex, qFromDecimal, qFromNumber,
  qpTrim, qpDeg, qpLead, qpAdd, qpNeg, qpSub, qpMul, qpScale, qpEq, qpDivmod, qpGcd, qpEval, qpEvalF, qpMonic,
  polyText as qpText, polyTex as qpTex, qRoots, toRQ, hasVarNode, constValue, compileFn, pretty as prettySource,
}

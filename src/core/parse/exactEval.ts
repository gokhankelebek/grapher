// ============================================================================
// src/core/parse/exactEval.ts — a typed formula evaluated EXACTLY at a nice x.
//
// The jump-dot layer (src/render/curves.ts) snaps a step's x to a nice number
// — an integer, p/q, or pπ/q — and then has to say which side the step
// attains there. The nearest double cannot always say it:
//
//   sign(sin x) at π    sin(3.141592653589793) = 1.2e-16, so sign = 1 (true: 0)
//   ceil(10x)   at 0.3  10 · 0.3 = 3.0000000000000004, so ceil = 4    (true: 3)
//
// This walks the parser's own AST with values of the form a + bπ (a, b
// rational), which is closed under everything a step function is built from:
// + − ×, ÷ by a rational (or π by π), integer powers, sin/cos/tan/sec/csc/cot
// at the multiples of π where they are rational, and floor/ceil/sign/abs/
// min/max/sqrt. Anything else — e, ln, a named call, a product of two π
// terms, a trig value like sin(π/4) = √2/2 — answers "can't certify" and
// the caller keeps the ordinary floating-point value, which is right
// whenever the true value is not sitting exactly on a step's edge.
// ============================================================================

import type { ExactPoint } from '../types'
import type { ExprNode } from './index'

/** A rational n/d in lowest terms, d > 0. */
interface Rat { n: number; d: number }
/** a + bπ, certified; 'nan' = certifiably undefined (1/0, sqrt(−1), tan(π/2)). */
type Val = { a: Rat; b: Rat } | 'nan'

/**
 * Numerators and denominators stay under 2^26, so every cross product in
 * add/sub/mul/cmp stays under 2^53 and is exact in a double.
 */
const LIMIT = 2 ** 26

class Unsure extends Error {}
const unsure = (): never => {
  throw new Unsure()
}

function gcd(a: number, b: number): number {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b) [a, b] = [b, a % b]
  return a
}

function rat(n: number, d = 1): Rat {
  if (d === 0 || !Number.isInteger(n) || !Number.isInteger(d)) return unsure()
  if (d < 0) {
    n = -n
    d = -d
  }
  const g = gcd(n, d) || 1
  n /= g
  d /= g
  if (Math.abs(n) > LIMIT || d > LIMIT) return unsure()
  return { n: n + 0, d }
}

const ZERO = rat(0)
const ONE = rat(1)
const isZero = (r: Rat) => r.n === 0
const add = (x: Rat, y: Rat) => rat(x.n * y.d + y.n * x.d, x.d * y.d)
const sub = (x: Rat, y: Rat) => rat(x.n * y.d - y.n * x.d, x.d * y.d)
const mul = (x: Rat, y: Rat) => rat(x.n * y.n, x.d * y.d)
const div = (x: Rat, y: Rat) => (isZero(y) ? unsure() : rat(x.n * y.d, x.d * y.n))
const cmp = (x: Rat, y: Rat) => Math.sign(x.n * y.d - y.n * x.d)
const floorR = (r: Rat) => rat(Math.floor(r.n / r.d))
const ceilR = (r: Rat) => rat(Math.ceil(r.n / r.d))

const num = (v: Val): number => (v === 'nan' ? Number.NaN : v.a.n / v.a.d + (v.b.n / v.b.d) * Math.PI)
const rational = (r: Rat): Val => ({ a: r, b: ZERO })
const isRational = (v: { a: Rat; b: Rat }) => isZero(v.b)

/**
 * A number literal as a rational: "0.3" is 3/10, not 0.299999999999999988898.
 * Scientific notation and anything unreadable is not certified.
 */
function literal(raw: string, v: number): Rat {
  if (Number.isInteger(v)) return rat(v)
  const m = /^(\d*)\.(\d+)$/.exec(raw.trim())
  if (!m || m[2].length > 9) return unsure()
  const d = 10 ** m[2].length
  return rat(Number((m[1] || '0') + m[2]), d)
}

/** A slider value as a short decimal (0.25, −1.5), or not certified. */
function paramRat(v: number): Rat {
  if (!Number.isFinite(v)) return unsure()
  for (let k = 0, d = 1; k <= 6; k++, d *= 10) {
    const n = Math.round(v * d)
    if (n / d === v) return rat(n, d)
  }
  return unsure()
}

/**
 * The sign of an IRRATIONAL a + bπ (b ≠ 0), from its double: never exactly
 * on an integer, so only a value within rounding of one is in doubt.
 */
function irrationalFloat(v: { a: Rat; b: Rat }): number {
  const x = num(v)
  if (!Number.isFinite(x)) return unsure()
  if (Math.abs(x - Math.round(x)) <= 1e-9 * Math.max(1, Math.abs(x))) return unsure()
  return x
}

// sin(kπ/12) for k = 0…23, where it is rational (null where it is not).
const HALF = rat(1, 2)
const SIN12: (Rat | null)[] = Array.from({ length: 24 }, (_, k) => {
  switch (k) {
    case 0: case 12: return ZERO
    case 2: case 10: return HALF
    case 6: return ONE
    case 14: case 22: return rat(-1, 2)
    case 18: return rat(-1)
    default: return null
  }
})

/** Twelfths of π in [0, 24) for an argument that is a rational multiple of π. */
function twelfths(v: Val): number {
  // a rational argument other than 0 (handled by the caller) has an
  // irrational sine
  if (v === 'nan' || !isZero(v.a)) return unsure()
  const t = mul(v.b, rat(12))
  if (t.d !== 1) return unsure()
  return ((t.n % 24) + 24) % 24
}

function sinPi(k: number): Rat {
  return SIN12[k] ?? unsure()
}

function trig(fn: string, arg: Val): Val {
  if (arg === 'nan') return 'nan'
  const k = isZero(arg.a) && isZero(arg.b) ? 0 : twelfths(arg)
  const s = () => sinPi(k)
  const c = () => sinPi((k + 6) % 24)
  const recip = (r: Rat): Val => (isZero(r) ? 'nan' : rational(div(ONE, r)))
  switch (fn) {
    case 'sin': return rational(s())
    case 'cos': return rational(c())
    case 'csc': return recip(s())
    case 'sec': return recip(c())
    case 'tan':
    case 'cot': {
      // tan(kπ/12) is rational only at multiples of π/4
      if (k % 3 !== 0) return unsure()
      const q = (k / 3) % 4 // quarter turns of π/4
      const tan = [ZERO, ONE, null, rat(-1)][q]
      if (fn === 'tan') return tan ? rational(tan) : 'nan'
      if (tan === null) return rational(ZERO)
      return recip(tan)
    }
  }
  return unsure()
}

function evalNode(n: ExprNode, pt: Val, params: readonly number[]): Val {
  switch (n.t) {
    case 'num': return rational(literal(n.raw, n.v))
    case 'const':
      if (n.name === 'pi') return { a: ZERO, b: ONE }
      if (n.name === 'tau') return { a: ZERO, b: rat(2) }
      return unsure() // e
    case 'var': return n.name === 'x' ? pt : unsure()
    case 'param': return rational(paramRat(params[n.i]))
    case 'neg': {
      const v = evalNode(n.a, pt, params)
      return v === 'nan' ? v : { a: sub(ZERO, v.a), b: sub(ZERO, v.b) }
    }
    case 'bin': {
      const a = evalNode(n.a, pt, params)
      const b = evalNode(n.b, pt, params)
      if (a === 'nan' || b === 'nan') return 'nan'
      switch (n.op) {
        case '+': return { a: add(a.a, b.a), b: add(a.b, b.b) }
        case '-': return { a: sub(a.a, b.a), b: sub(a.b, b.b) }
        case '*':
          if (isRational(a)) return { a: mul(a.a, b.a), b: mul(a.a, b.b) }
          if (isRational(b)) return { a: mul(a.a, b.a), b: mul(a.b, b.a) }
          return unsure()
        case '/':
          if (isRational(b)) return isZero(b.a) ? 'nan' : { a: div(a.a, b.a), b: div(a.b, b.a) }
          // pπ/q ÷ rπ/s: a pure multiple of π over another
          if (isZero(b.a) && isZero(a.a)) return rational(div(a.b, b.b))
          return unsure()
        case '^': {
          if (!isRational(a) || !isRational(b) || b.a.d !== 1) return unsure()
          const e = b.a.n
          if (Math.abs(e) > 64) return unsure()
          if (isZero(a.a)) return e > 0 ? rational(ZERO) : e === 0 ? unsure() : 'nan'
          let r = ONE
          for (let i = 0; i < Math.abs(e); i++) r = mul(r, a.a)
          return rational(e < 0 ? div(ONE, r) : r)
        }
      }
      return unsure()
    }
    case 'call': {
      const args = n.args.map((m) => evalNode(m, pt, params))
      const u = args[0]
      if (args.some((v) => v === 'nan')) return 'nan'
      const v = u as { a: Rat; b: Rat }
      switch (n.fn) {
        case 'sin': case 'cos': case 'tan': case 'sec': case 'csc': case 'cot':
          return trig(n.fn, v)
        case 'floor':
          return rational(isRational(v) ? floorR(v.a) : rat(Math.floor(irrationalFloat(v))))
        case 'ceil':
          return rational(isRational(v) ? ceilR(v.a) : rat(Math.ceil(irrationalFloat(v))))
        case 'sign':
          return rational(rat(isRational(v) ? Math.sign(v.a.n) : Math.sign(irrationalFloat(v))))
        case 'abs': {
          const neg = isRational(v) ? v.a.n < 0 : irrationalFloat(v) < 0
          return neg ? { a: sub(ZERO, v.a), b: sub(ZERO, v.b) } : v
        }
        case 'min':
        case 'max': {
          const w = args[1] as { a: Rat; b: Rat }
          const c = isRational(v) && isRational(w)
            ? cmp(v.a, w.a)
            : Math.sign(irrationalFloat({ a: sub(v.a, w.a), b: sub(v.b, w.b) }))
          return (n.fn === 'min') === (c <= 0) ? v : w
        }
        case 'sqrt': {
          if (!isRational(v)) return unsure()
          if (v.a.n < 0) return 'nan'
          const rn = Math.round(Math.sqrt(v.a.n))
          const rd = Math.round(Math.sqrt(v.a.d))
          if (rn * rn !== v.a.n || rd * rd !== v.a.d) return unsure()
          return rational(rat(rn, rd))
        }
      }
      return unsure()
    }
  }
  return unsure()
}

/**
 * f(x) for the formula `body` at the nice point `pt`, computed exactly:
 * a number (NaN where the formula is certifiably undefined there), or
 * undefined when the exact arithmetic above cannot certify the value.
 */
export function evalExactAt(
  body: ExprNode,
  params: readonly number[],
  pt: ExactPoint,
): number | undefined {
  try {
    const r = rat(pt.p, pt.q)
    const x: Val = pt.pi ? { a: ZERO, b: r } : rational(r)
    return num(evalNode(body, x, params))
  } catch (err) {
    if (err instanceof Unsure) return undefined
    throw err
  }
}

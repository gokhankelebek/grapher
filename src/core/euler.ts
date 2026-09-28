// ============================================================================
// Euler's method (src/core/euler.ts) — AP Calculus BC.
//
//   export function eulerSteps(f, x0, y0, h, n): EulerResult
//   export function eulerVerdict(f, x0, y0, xEnd, opts?): EulerVerdict
//   export function secondDerivativeOf(src): SecondDerivative | null
//   export function eulerNumber(v): EulerNumber
//
// THE STEPS are the table a student fills in by hand:
//
//     n | xₙ | yₙ | dy/dx = f(xₙ, yₙ) | Δy = h·dy/dx
//
// with xₙ = x₀ + n·h computed from x₀ every time (never accumulated, so
// x₄ = 2 is 2 and not 1.9999999999999998), and yₙ₊₁ = yₙ + Δy.
//
// THE VERDICT is the AP free-response question "is your approximation an
// overestimate or an underestimate? Explain." The answer is read off the
// concavity of the TRUE solution through (x₀, y₀):
//
//     d²y/dx² = f_x + f_y · dy/dx = f_x + f_y · f
//
// evaluated ALONG that solution (src/core/ode.ts solveField), with f_x and
// f_y by central differences on f itself — so it works for any f the parser
// accepts, with sliders, without a CAS.
//
//   concave up   (y'' ≥ 0, not ≡ 0)   the tangent lines Euler follows lie
//                                      BELOW the curve → underestimate
//   concave down (y'' ≤ 0, not ≡ 0)   they lie ABOVE → overestimate
//   y'' ≡ 0                            the solution is a line → exact
//   changes sign                       concavity cannot tell
//
// STEPPING LEFT DOES NOT REVERSE THIS. A convex function lies above EVERY one
// of its tangent lines, on both sides of the point of tangency, so a tangent
// step to the left from a concave-up solution also lands below it. Worked:
// dy/dx = y from (0, 1), h = −0.5 gives y₁ = 1 − 0.5 = 0.5 < e^(−0.5) ≈ 0.607 —
// under, exactly as h = +0.5 gives 1.5 < e^0.5 ≈ 1.649. (Over several steps the
// error at step k is carried as eₖ(1 + h·f_y) plus a new local error of the
// same sign, so the sign survives as long as 1 + h·f_y > 0 — i.e. unless the
// step is so large the method is unstable. `agrees` below catches that case
// by comparing against the true value, rather than asserting it away.)
//
// The derivative is ALSO derived symbolically from the parser's AST where it
// can be (polynomials, quotients, powers, exp/ln/trig/roots), in the form the
// AP answer expects: in terms of x, y and dy/dx — "d²y/dx² = 1 + dy/dx" for
// dy/dx = x + y — and, when it prints short, with dy/dx substituted back in
// ("= 1 + x + y"). Where it cannot be (|u|, floor, a named call) the sentence
// states the sign and where it was checked, which is the minimum an answer
// needs.
//
// Pure: no DOM, no React. Numbers print through `eulerNumber`, which uses
// exactForm at a tight tolerance: Euler on a polynomial field is rational
// arithmetic, so 17/8 IS 17/8, and a table of 2.125000000000001 is the tool
// failing at arithmetic in front of a class.
// ============================================================================

import type { Vec2 } from './types'
import { solveField } from './ode'
import { exactForm } from './exact'
import { parseAst } from './parse'
import type { ExprNode } from './parse'

type F = (x: number, y: number) => number

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export interface EulerNumber {
  /** What the table prints: "2.5", "17/8", "π/4", "1.6487", "—". */
  text: string
  /** KaTeX of the same reading. */
  tex: string
  /** True when `text` is a closed form rather than a rounded decimal. */
  exact: boolean
  /** Always the decimal reading, for a tooltip beside a closed form. */
  decimal: string
}

/** Relative tolerance for "this value IS that closed form". */
export const EULER_EXACT_TOL = 1e-12
/** Decimals a non-exact value prints to (trailing zeros trimmed). */
export const EULER_DECIMALS = 4

const MINUS = '−'
const withMinus = (s: string): string => (s.startsWith('-') ? MINUS + s.slice(1) : s)

function decimalText(v: number): string {
  if (!Number.isFinite(v)) return '—'
  if (Math.abs(v) < 1e-12) return '0'
  const a = Math.abs(v)
  if (a >= 1e7 || a < 1e-4) return withMinus(v.toExponential(3))
  return withMinus(String(Number(v.toFixed(EULER_DECIMALS))))
}

/** A fraction whose decimal stops within two places (5/2, 15/4, 6/5) reads as that decimal. */
function shortDecimal(q: number): boolean {
  return 100 % q === 0
}

/**
 * One number as the Euler table prints it.
 *
 * Integers and fractions whose decimal ends within two places print as that
 * decimal (2.5, 3.75); other fractions as fractions (17/8, 1/3); a multiple of
 * π or a surd in its closed form (π/4, √2) — each only when exactForm matches
 * at EULER_EXACT_TOL. Anything else is a decimal to four places.
 */
export function eulerNumber(v: number): EulerNumber {
  const decimal = decimalText(v)
  if (!Number.isFinite(v)) return { text: '—', tex: '\\text{—}', exact: false, decimal }
  if (Math.abs(v) < 1e-12) return { text: '0', tex: '0', exact: true, decimal: '0' }
  const e = exactForm(v, { tol: EULER_EXACT_TOL })
  if (!e) return { text: decimal, tex: decimal.replace(MINUS, '-'), exact: false, decimal }
  const frac = /^[-−]?(\d+)\/(\d+)$/.exec(e.text)
  const whole = /^[-−]?\d+$/.test(e.text)
  if (whole || (frac && shortDecimal(Number(frac[2])))) {
    const t = decimalText(e.value)
    return { text: t, tex: t.replace(MINUS, '-'), exact: true, decimal }
  }
  return { text: withMinus(e.text), tex: e.tex, exact: true, decimal }
}

// ---------------------------------------------------------------------------
// The steps
// ---------------------------------------------------------------------------

export interface EulerRow {
  k: number
  x: number
  y: number
  /** f(xₖ, yₖ). NaN where it is undefined. */
  slope: number
  /** h · slope. */
  dy: number
}

export interface EulerResult {
  rows: EulerRow[]
  /** Set when the method could not take all n steps; `k` is the last row. */
  stopped: { k: number; reason: string } | null
}

/** More steps than any table on a board should hold. */
export const EULER_MAX_STEPS = 1000

/**
 * Euler's method for dy/dx = f(x, y) from (x0, y0), n steps of size h.
 *
 * Rows k = 0…n. Every row carries its slope and Δy, the last one included
 * (the table's final line has them too; they are simply not used). Stops
 * early — and says why in `stopped` — when a slope needed for the NEXT step is
 * undefined or a value overflows; the rows up to that point are still right.
 */
export function eulerSteps(f: F, x0: number, y0: number, h: number, n: number): EulerResult {
  const rows: EulerRow[] = []
  if (!Number.isFinite(x0) || !Number.isFinite(y0)) {
    return { rows, stopped: { k: 0, reason: 'the starting point is not a number' } }
  }
  if (!Number.isFinite(h) || h === 0) {
    return {
      rows: [{ k: 0, x: x0, y: y0, slope: safe(f, x0, y0), dy: NaN }],
      stopped: { k: 0, reason: 'the step size h must be a nonzero number' },
    }
  }
  const steps = Math.max(0, Math.min(EULER_MAX_STEPS, Math.floor(Number.isFinite(n) ? n : 0)))
  let y = y0
  for (let k = 0; k <= steps; k++) {
    const x = k === 0 ? x0 : x0 + k * h
    const slope = safe(f, x, y)
    const dy = h * slope
    rows.push({ k, x, y, slope, dy })
    if (k === steps) break
    if (!Number.isFinite(slope)) {
      return {
        rows,
        stopped: {
          k,
          reason: `dy/dx is undefined at (${eulerNumber(x).text}, ${eulerNumber(y).text})`,
        },
      }
    }
    const next = y + dy
    if (!Number.isFinite(next)) {
      return { rows, stopped: { k, reason: 'the values grow past what can be computed' } }
    }
    y = next
  }
  return { rows, stopped: null }
}

function safe(f: F, x: number, y: number): number {
  try {
    const v = f(x, y)
    return Number.isFinite(v) ? v : NaN
  } catch {
    return NaN
  }
}

// ---------------------------------------------------------------------------
// d²y/dx², numerically
// ---------------------------------------------------------------------------

/**
 * d²y/dx² = f_x + f_y · f at (x, y), by central differences on f. NaN where f
 * is undefined nearby. The step is relative, so a point at x = 1000 is not
 * differenced across a gap it cannot resolve.
 */
export function secondDerivativeAt(f: F, x: number, y: number): number {
  const s = numericD2(f, x, y)
  return s ? s.value : NaN
}

function numericD2(f: F, x: number, y: number): { value: number; scale: number } | null {
  const dx = 1e-5 * Math.max(1, Math.abs(x))
  const dyStep = 1e-5 * Math.max(1, Math.abs(y))
  const f0 = safe(f, x, y)
  const fx = (safe(f, x + dx, y) - safe(f, x - dx, y)) / (2 * dx)
  const fy = (safe(f, x, y + dyStep) - safe(f, x, y - dyStep)) / (2 * dyStep)
  const value = fx + fy * f0
  if (!Number.isFinite(value)) return null
  return { value, scale: Math.abs(fx) + Math.abs(fy * f0) }
}

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

export type EulerVerdictKind = 'under' | 'over' | 'exact' | 'unknown'
export type Concavity = 'up' | 'down' | 'zero' | 'mixed'

export interface EulerVerdict {
  kind: EulerVerdictKind
  /** The sign of d²y/dx² along the true solution on the interval; null when it was not measured. */
  concavity: Concavity | null
  /** y(xEnd) on the true solution through (x0, y0); null when it does not get there. */
  trueY: number | null
  /** Where d²y/dx² changes sign, when it does. */
  changeNear: number | null
  /** d²y/dx² as the AP answer writes it, when it could be derived. */
  d2: SecondDerivative | null
  /**
   * Does the actual error agree with the concavity verdict? Null when there
   * is nothing to compare. False only when a step is so large the method is
   * unstable and the error has flipped sign — the card says so.
   */
  agrees: boolean | null
  /** One AP-style sentence: the reason. */
  reason: string
}

export interface VerdictOpts {
  /** The symbolic d²y/dx², to quote in the sentence. */
  d2?: SecondDerivative | null
  /** The Euler value at xEnd, for `agrees`. */
  yEuler?: number
}

/** d²y/dx² counts as zero below this, relative to the size of its two terms. */
const ZERO_REL = 1e-6
const ZERO_ABS = 1e-8

/**
 * Over- or underestimate, from the concavity of the TRUE solution through
 * (x0, y0) on the interval between x0 and xEnd (either order). See the file
 * header for why the direction of stepping does not enter into it.
 */
export function eulerVerdict(
  f: F,
  x0: number,
  y0: number,
  xEnd: number,
  opts: VerdictOpts = {},
): EulerVerdict {
  const d2 = opts.d2 ?? null
  const base = { d2, changeNear: null as number | null }
  const lo = Math.min(x0, xEnd)
  const hi = Math.max(x0, xEnd)
  const pt = `(${eulerNumber(x0).text}, ${eulerNumber(y0).text})`
  const interval = `[${eulerNumber(lo).text}, ${eulerNumber(hi).text}]`
  const at = `y(${eulerNumber(xEnd).text})`

  if (![x0, y0, xEnd].every(Number.isFinite) || !(hi > lo)) {
    return {
      ...base,
      kind: 'unknown',
      concavity: null,
      trueY: null,
      agrees: null,
      reason: 'There is no interval to step across.',
    }
  }

  let path: Vec2[] = []
  try {
    path = solveField(f, { x: x0, y: y0 }, [lo, hi])
  } catch {
    path = []
  }
  const width = hi - lo
  const reachTol = 1e-9 * Math.max(1, width)
  const endPt = xEnd > x0 ? path[path.length - 1] : path[0]
  const reaches = !!endPt && Math.abs(endPt.x - xEnd) <= reachTol
  const trueY = reaches ? endPt.y : null

  // Concavity along whatever of the solution exists on the interval.
  let pos = 0
  let neg = 0
  let firstSign = 0
  let changeNear: number | null = null
  let lastSignedX = x0
  // Walk from x0 towards xEnd, so "changes sign near" is the first change met.
  const ordered = xEnd > x0 ? path : path.slice().reverse()
  for (const p of ordered) {
    const s = numericD2(f, p.x, p.y)
    if (!s) continue
    if (Math.abs(s.value) <= ZERO_ABS + ZERO_REL * s.scale) continue
    const sign = s.value > 0 ? 1 : -1
    if (sign > 0) pos++
    else neg++
    if (firstSign === 0) firstSign = sign
    else if (sign !== firstSign && changeNear === null) changeNear = (lastSignedX + p.x) / 2
    lastSignedX = p.x
  }
  const concavity: Concavity | null =
    path.length < 2 ? null : pos > 0 && neg > 0 ? 'mixed' : pos > 0 ? 'up' : neg > 0 ? 'down' : 'zero'

  const quoted = d2Quote(d2)

  if (!reaches) {
    const stop = path.length > 0 ? (xEnd > x0 ? path[path.length - 1].x : path[0].x) : x0
    return {
      d2,
      changeNear,
      kind: 'unknown',
      concavity,
      trueY: null,
      agrees: null,
      reason:
        `The solution through ${pt} does not reach x = ${eulerNumber(xEnd).text} — it stops near ` +
        `x ≈ ${eulerNumber(stop).text}, where it blows up or turns vertical — so there is no true value to compare.`,
    }
  }

  const err = opts.yEuler !== undefined && Number.isFinite(opts.yEuler) ? opts.yEuler - (trueY as number) : null
  const errTiny = err !== null && Math.abs(err) <= 1e-9 * Math.max(1, Math.abs(trueY as number))

  if (concavity === 'up' || concavity === 'down') {
    const up = concavity === 'up'
    const agrees = err === null || errTiny ? null : up ? err < 0 : err > 0
    return {
      d2,
      changeNear: null,
      kind: up ? 'under' : 'over',
      concavity,
      trueY,
      agrees,
      reason:
        `The solution through ${pt} is concave ${up ? 'up' : 'down'} on ${interval} ` +
        `(${quoted} ${up ? '>' : '<'} 0 along it), so the tangent lines Euler’s method follows lie ` +
        `${up ? 'below' : 'above'} it: the approximation to ${at} is ${up ? 'an underestimate' : 'an overestimate'}.`,
    }
  }

  if (concavity === 'zero') {
    return {
      d2,
      changeNear: null,
      kind: 'exact',
      concavity,
      trueY,
      agrees: null,
      reason:
        `${quoted} = 0 along the solution through ${pt}, so the solution is a line and ` +
        `Euler’s method follows it exactly.`,
    }
  }

  return {
    d2,
    changeNear,
    kind: 'unknown',
    concavity,
    trueY,
    agrees: null,
    reason:
      `${quoted} changes sign on ${interval}` +
      (changeNear !== null ? ` (near x ≈ ${withMinus(String(Number(changeNear.toFixed(2))))})` : '') +
      `, so the solution changes concavity and concavity alone cannot tell whether Euler’s method over- or underestimates.`,
  }
}

/** "d²y/dx² = 1 + dy/dx = 1 + x + y", or just "d²y/dx²". */
function d2Quote(d2: SecondDerivative | null): string {
  if (!d2) return 'd²y/dx²'
  return d2.inXY && d2.inXY.text !== d2.text
    ? `d²y/dx² = ${d2.text} = ${d2.inXY.text}`
    : `d²y/dx² = ${d2.text}`
}

// ===========================================================================
// d²y/dx², symbolically
// ===========================================================================
//
// Implicit differentiation of the right-hand side with y = y(x):
//
//     d/dx f(x, y) = f_x + f_y · dy/dx
//
// over the parser's own AST. A small tree of its own (below) because the
// result needs a node the parser does not have — dy/dx itself — and because
// the simplifier has to live in the constructors to keep "0·y + 1·dy/dx" from
// ever being printed.

export interface SecondDerivative {
  /** In x, y and dy/dx: "1 + dy/dx". */
  text: string
  tex: string
  /** dy/dx substituted back in, when that prints short: "1 + x + y". */
  inXY: { text: string; tex: string } | null
}

type S =
  | { t: 'n'; v: number }
  | { t: 'c'; name: string }
  | { t: 'x' }
  | { t: 'y' }
  | { t: 'yp' }
  | { t: 'p'; name: string }
  | { t: 'neg'; a: S }
  | { t: 'add' | 'sub' | 'mul' | 'div' | 'pow'; a: S; b: S }
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
  switch (s.t) {
    case 'n':
    case 'c':
    case 'p':
      return ZERO
    case 'x':
      return ONE
    case 'y':
      return { t: 'yp' }
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
      return div(subst(s.a, f), subst(s.b, f))
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

function text(s: S, parent = 0): string {
  const p = PREC[s.t]
  const wrap = (body: string): string => (p < parent ? `(${body})` : body)
  switch (s.t) {
    case 'n':
      return s.v < 0 && parent > 1 ? `(${numText(s.v)})` : numText(s.v)
    case 'c':
      return CONST_TEXT[s.name] ?? s.name
    case 'x':
      return 'x'
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
      const top = s.a.t === 'yp' ? '(dy/dx)' : text(s.a, 5)
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
      return 'x'
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

/** The substituted form is offered only while it stays a readable line. */
const INXY_MAX_CHARS = 36

/** The right-hand side of "dy/dx = …" / "y' = …", split the way the field parser splits it. */
export function fieldRhs(src: string): string | null {
  if (typeof src !== 'string') return null
  const eq = src.indexOf('=')
  const colon = src.indexOf(':')
  const cut = eq < 0 ? colon : colon < 0 ? eq : Math.min(eq, colon)
  if (cut < 0) return null
  const rhs = src.slice(cut + 1)
  return rhs.trim() === '' ? null : rhs
}

/**
 * d²y/dx² for dy/dx = (the right side of `src`), by implicit differentiation:
 * in x, y and dy/dx, plus the same with dy/dx substituted when that is short.
 * Null when the right side uses something with no rule here (|u|, floor, sign,
 * min/max, u(x)^v(x)); the verdict then states the sign without a formula.
 */
export function secondDerivativeOf(src: string): SecondDerivative | null {
  const rhs = fieldRhs(src)
  if (rhs === null) return null
  const ast = parseAst(rhs)
  if (!ast.ok || ast.rhs !== null) return null
  const f = fromAst(ast.lhs)
  if (!f) return null
  const d = D(f)
  if (!d) return null
  const out: SecondDerivative = { text: text(d), tex: tex(d), inXY: null }
  if (hasYp(d)) {
    const s = subst(d, f)
    const t = text(s)
    if (t.length <= INXY_MAX_CHARS) out.inXY = { text: t, tex: tex(s) }
  }
  return out
}

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
import { D, collectYp, fromAst, hasYp, subst, tex, text } from './symbolic'

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

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻',
}

/**
 * A decimal as the table prints it, text and KaTeX. Very large and very
 * small values use the app's scientific notation — "1.235×10⁷", "10⁻⁵" —
 * the way src/render/grid.ts draws a tick (core cannot import it), never
 * JavaScript's "1.235e+7".
 */
function decimalParts(v: number): { text: string; tex: string; shown: number } {
  if (!Number.isFinite(v)) return { text: '—', tex: '\\text{—}', shown: Number.NaN }
  if (Math.abs(v) < 1e-12) return { text: '0', tex: '0', shown: 0 }
  const a = Math.abs(v)
  if (a >= 1e7 || a < 1e-4) {
    const [m0, e0] = v.toExponential(3).split('e')
    const m = m0.replace(/\.?0+$/, '')
    const neg = m.startsWith('-')
    const mant = neg ? m.slice(1) : m
    const exp = String(parseInt(e0, 10))
    const sup = exp.replace(/[-0-9]/g, (c) => SUPERSCRIPT[c])
    const text = (neg ? MINUS : '') + (mant === '1' ? '' : `${mant}×`) + `10${sup}`
    const tex = (neg ? '-' : '') + (mant === '1' ? '' : `${mant}\\times `) + `10^{${exp}}`
    return { text, tex, shown: Number(v.toExponential(3)) }
  }
  const t = String(Number(v.toFixed(EULER_DECIMALS)))
  return { text: withMinus(t), tex: t, shown: Number(t) }
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
  const dp = decimalParts(v)
  const decimal = dp.text
  if (!Number.isFinite(v)) return { text: '—', tex: '\\text{—}', exact: false, decimal }
  // 0 is exact only when it IS 0; 1e-14 printed as "0" is a rounding
  if (Math.abs(v) < 1e-12) return { text: '0', tex: '0', exact: v === 0, decimal: '0' }
  const e = exactForm(v, { tol: EULER_EXACT_TOL })
  if (!e) return { text: decimal, tex: dp.tex, exact: false, decimal }
  const frac = /^[-−]?(\d+)\/(\d+)$/.exec(e.text)
  const whole = /^[-−]?\d+$/.test(e.text)
  if (whole || (frac && shortDecimal(Number(frac[2])))) {
    // printed as a decimal: exact only when the decimal says all of it
    // (12345678 prints "1.235×10⁷", a rounding)
    const p = decimalParts(e.value)
    return { text: p.text, tex: p.tex, exact: p.shown === e.value, decimal }
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
// over the parser's own AST. A small tree of its own (src/core/symbolic.ts,
// shared with implicit differentiation) because the result needs a node the
// parser does not have — dy/dx itself — and because the simplifier has to
// live in the constructors to keep "0·y + 1·dy/dx" from ever being printed.

export interface SecondDerivative {
  /** In x, y and dy/dx: "1 + dy/dx". */
  text: string
  tex: string
  /** dy/dx substituted back in, when that prints short: "1 + x + y". */
  inXY: { text: string; tex: string } | null
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
  const raw = D(f)
  if (!raw) return null
  // (1 − y)·dy/dx − y·dy/dx → (1 − 2y)·dy/dx, when it checks out.
  const d = collectYp(raw) ?? raw
  const out: SecondDerivative = { text: text(d), tex: tex(d), inXY: null }
  if (hasYp(d)) {
    const s = subst(d, f)
    const t = text(s)
    if (t.length <= INXY_MAX_CHARS) out.inXY = { text: t, tex: tex(s) }
  }
  return out
}

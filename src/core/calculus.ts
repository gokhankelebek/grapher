// ============================================================================
// Calculus on a curve — tangent lines, derivative curves, definite integrals,
// Riemann sums. The three things an AP Calculus AB class actually does to a
// graph, against the SAME curve objects the board already holds.
//
//   export function tangentAt(curve, models, x): TangentLine | null
//   export function derivativeModel(curve, models, id): DerivativeCurve | null
//   export function areaUnder(curve, models, a, b): AreaResult | null
//   export function areaBetween(parent, other, models, a, b, abs): AreaResult | null
//   export function curveIntersections(parent, other, models, range): number[]
//   export function riemann(curve, models, a, b, n, method): RiemannResult | null
//
// Two layers, exactly as in analyze.ts:
//   * closed form wherever the family allows it — a cubic's derivative IS a
//     parabola, ∫ a·sin(bx + c) is a cosine — flagged `exact: true`, so the
//     board never implies more precision than was computed;
//   * a guarded numeric core for everything else, including typed expressions.
//
// The guards are the point. A slope at the kink of |x| does not exist, and a
// central difference will cheerfully report 0; the area under 1/x across the
// origin does not exist, and any Riemann-style sum will cheerfully report a
// finite number. Both are refused (null) rather than approximated, because a
// wrong number on a projector is worse than no number.
//
// Pure TypeScript: no DOM, no imports from src/ui.
// ============================================================================

import type { FittedCurve, ModelSpec, ParamMeta, Vec2 } from './types'
import { MODELS, fmt } from './fit/models'
import { analyzeCurve } from './analyze'

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

const EPS = Number.EPSILON

/**
 * Step for the Richardson first derivative. A plain central difference wants
 * cbrt(eps); Richardson extrapolation kills the h² term, so the optimum moves
 * out to eps^(1/5) ≈ 7.4e-4, where the truncation error (O(h⁴)) and the
 * subtraction's roundoff (O(eps/h)) are both about 1e-13.
 */
const H_D1 = Math.pow(EPS, 1 / 5)

/** Samples used to scan an integration interval for gaps and poles. */
const SCAN = 256

/** Relative accuracy asked of adaptive Simpson. */
const QUAD_REL = 1e-10

/** Hard ceiling on integrand evaluations — a slider drag must stay cheap. */
const QUAD_BUDGET = 20000

/** Recursion depth ceiling for adaptive Simpson. */
const QUAD_DEPTH = 50

/** A value this far outside the curve's own magnitude at a gap edge is a pole. */
const POLE_FACTOR = 20

/** Largest n a Riemann sum will build rectangles for. */
const MAX_RECTS = 200000

type Fn = (x: number) => number

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/** y = m·x + b, touching the curve at `point`. */
export interface TangentLine {
  m: number
  b: number
  point: Vec2
  /** true when m came from a differentiated formula, not a difference quotient */
  exact: boolean
}

/**
 * A curve the board can register and draw: f′ of the curve it came from.
 *
 * HOW THE CALLER USES IT. `spec.id` says which of the two cases this is:
 *   * spec.id !== the requested id  — the derivative IS a library family (a
 *     cubic's derivative is a `poly2`). Register NOTHING; make the new curve
 *     with modelId = spec.id and it inherits that family's sliders, handles,
 *     analysis and interpretations for free.
 *   * spec.id === the requested id  — the derivative needed its own closure.
 *     Register it beside the typed-expression models, exactly as App.tsx
 *     registers `expr_N`, and persist whatever it takes to rebuild it.
 */
export interface DerivativeCurve {
  /** The family (shared, from `models`) or the closure built for `id`. */
  spec: ModelSpec
  params: number[]
  kind: 'explicit'
  domain: [number, number] | null
  /** Honest label: "f'(x) = 3x^{2} - 4", or "\frac{d}{dx}[...]" when numeric. */
  latex: string
  /** true when `spec.evalExplicit` is a differentiated formula. */
  exact: boolean
}

/** ∫_a^b f, signed (below the axis is negative) — the AP convention. */
export interface AreaResult {
  value: number
  exact: boolean
  /** integrand evaluations spent; absent on the closed-form path */
  samples?: number
}

export interface RiemannRect {
  x0: number
  x1: number
  /** f at the rule's sample point (trapezoid: the mean of the two ends). */
  height: number
}

export interface RiemannResult {
  value: number
  rects: RiemannRect[]
  /** subintervals whose sample was undefined; they contribute nothing. */
  skipped: number
}

export type RiemannMethod = 'left' | 'right' | 'midpoint' | 'trapezoid'

// ---------------------------------------------------------------------------
// Curve access
// ---------------------------------------------------------------------------

interface Explicit {
  spec: ModelSpec
  params: number[]
  f: Fn
  /** null = unrestricted (the curve is drawn across the whole view). */
  domain: [number, number] | null
}

/** A domain we can trust; a malformed one is treated as "no restriction". */
function normDomain(d: [number, number] | null | undefined): [number, number] | null {
  if (!d) return null
  const [lo, hi] = d
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return null
  return [lo, hi]
}

/**
 * The curve as a plain function of x, or null when there is no such thing:
 * a polar, implicit or parametric curve has no f(x) to differentiate, and a
 * curve carrying a NaN parameter has nothing to say either.
 */
function explicitOf(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
): Explicit | null {
  const spec = models[curve.modelId]
  if (!spec || spec.kind !== 'explicit' || !spec.evalExplicit) return null
  if (!Array.isArray(curve.params) || !curve.params.every(Number.isFinite)) return null
  const params = curve.params
  const ev = spec.evalExplicit
  const f: Fn = (x: number) => {
    let v: unknown
    try { v = ev.call(spec, params, x) } catch { return Number.NaN }
    return typeof v === 'number' ? v : Number.NaN
  }
  return { spec, params, f, domain: normDomain(curve.domain) }
}

/** Inside the curve's own x-range, with a whisker for a typed endpoint. */
function inDomain(dom: [number, number] | null, x: number): boolean {
  if (!dom) return true
  const tol = 1e-9 * Math.max(1, Math.abs(dom[0]), Math.abs(dom[1]), dom[1] - dom[0])
  return x >= dom[0] - tol && x <= dom[1] + tol
}

/** Length scale for step sizing: the drawn window, or the point's own size. */
function spanOf(dom: [number, number] | null, x: number): number {
  if (dom) return dom[1] - dom[0]
  return Math.max(1, Math.abs(x))
}

function metaFor(name: string, v: number): ParamMeta {
  const span = Math.max(Math.abs(v) * 2, 1)
  return { name, min: v - span, max: v + span, step: span / 100 }
}

function metas(names: string[]): (params: number[]) => ParamMeta[] {
  return (params: number[]) => names.map((nm, i) => metaFor(nm, params[i] ?? 0))
}

/** Horner on ascending coefficients (same convention as the poly families). */
function horner(c: number[], x: number): number {
  let v = 0
  for (let i = c.length - 1; i >= 0; i--) v = v * x + c[i]
  return v
}

// ---------------------------------------------------------------------------
// Symbolic slopes
//
// One formula per family, differentiated by hand. `undefined` is a real
// answer here and a different one from `none`: at the kink of a·|x − b| the
// derivative DOES NOT EXIST, and falling through to a difference quotient
// there would invent a slope of 0 for a corner. `none` means only that this
// family has no hand-written rule, so the numeric path is honest.
// ---------------------------------------------------------------------------

type Slope =
  | { kind: 'value'; m: number }
  | { kind: 'undefined' }   // no derivative here: a kink, a pole, a vertical tangent
  | { kind: 'none' }        // no closed form in this module; use the numeric path

const UNDEF: Slope = { kind: 'undefined' }
const NO_RULE: Slope = { kind: 'none' }

function value(m: number): Slope {
  return Number.isFinite(m) ? { kind: 'value', m } : UNDEF
}

/** Ascending coefficients of p′ from ascending coefficients of p. */
function polyDeriv(c: number[]): number[] {
  if (c.length <= 1) return [0]
  const out = new Array<number>(c.length - 1)
  for (let k = 1; k < c.length; k++) out[k - 1] = c[k] * k
  return out
}

function symbolicSlope(modelId: string, p: number[], x: number): Slope {
  switch (modelId) {
    case 'line':
      return value(p[1] ?? 0)

    case 'poly2':
    case 'poly3':
    case 'poly4':
      return value(horner(polyDeriv(p), x))

    // a·sin(bx + c) + d  ->  a·b·cos(bx + c)
    case 'sine':
      return value(p[0] * p[1] * Math.cos(p[1] * x + p[2]))

    // a·e^{−((x−b)/c)²} + d  ->  −2a(x−b)/c² · e^{−((x−b)/c)²}
    case 'gauss': {
      const c = p[2]
      if (!(Math.abs(c) > 0)) return UNDEF
      const z = (x - p[1]) / c
      return value((-2 * p[0] * (x - p[1])) / (c * c) * Math.exp(-z * z))
    }

    // a·e^{bx} + c  ->  a·b·e^{bx}
    case 'exp':
      return value(p[0] * p[1] * Math.exp(p[1] * x))

    // a·ln(x − b) + c  ->  a/(x − b); nothing exists at or left of the asymptote
    case 'log':
      return x > p[1] ? value(p[0] / (x - p[1])) : UNDEF

    // a·√(x − b) + c  ->  a/(2√(x − b)); vertical tangent AT the branch point
    case 'sqrt':
      return x > p[1] ? value(p[0] / (2 * Math.sqrt(x - p[1]))) : UNDEF

    // a·∛(x − b) + c  ->  a/(3·(x − b)^{2/3}); vertical tangent at x = b
    case 'cbrt': {
      const u = x - p[1]
      if (u === 0) return UNDEF
      return value(p[0] / (3 * Math.cbrt(u * u)))
    }

    // a·|x − b|^e + c  ->  a·e·|x − b|^{e−1}·sgn(x − b)
    case 'power': {
      const u = x - p[1]
      const e = p[3]
      if (u === 0) return e > 1 ? value(0) : UNDEF   // e ≤ 1: a corner or a cusp
      const s = u > 0 ? 1 : -1
      return value(p[0] * e * Math.pow(Math.abs(u), e - 1) * s)
    }

    // a·|x − b| + c  ->  a·sgn(x − b); the kink has no slope at all
    case 'abs': {
      const u = x - p[1]
      if (u === 0) return UNDEF
      return value(u > 0 ? p[0] : -p[0])
    }

    // a/(1 + e^{−b(x−c)}) + d  ->  a·b·s(1 − s)
    case 'logistic': {
      const s = 1 / (1 + Math.exp(-p[1] * (x - p[2])))
      return value(p[0] * p[1] * s * (1 - s))
    }

    // a/(x − b) + c  ->  −a/(x − b)²; the pole belongs to neither branch
    case 'recip': {
      const u = x - p[1]
      if (u === 0) return UNDEF
      return value(-p[0] / (u * u))
    }

    default:
      return NO_RULE
  }
}

/** Families whose derivative this module knows in closed form. */
function hasSymbolic(modelId: string): boolean {
  return symbolicSlope(modelId, [1, 1, 1, 1], 0.5).kind !== 'none'
}

// ---------------------------------------------------------------------------
// Numeric slope
// ---------------------------------------------------------------------------

/**
 * f′(x) by Richardson extrapolation of the central difference, with a corner
 * detector.
 *
 * The detector is the part worth reading. k(h) = (f(x+h) − 2f(x) + f(x−h))/h
 * is h·f″ for a smooth function — it HALVES when h halves — and is the jump
 * in slope at a corner, where it does not shrink at all. Comparing k(h) with
 * k(h/2) separates the two without ever having to guess how curved "too
 * curved" is, so y = |x − 1| typed as text refuses a tangent at x = 1 exactly
 * as the abs family does, while y = 1000x² at 0 (enormous f″, no corner)
 * still gets its tangent.
 *
 * Returns null where the slope does not exist or cannot be trusted.
 */
function numericSlope(f: Fn, x: number, span: number): number | null {
  const scale = Math.min(Math.max(1, Math.abs(x)), Math.max(span, 1e-12))
  const h = H_D1 * scale
  if (!(h > 0) || !Number.isFinite(h)) return null

  const f0 = f(x)
  const fp1 = f(x + h)
  const fm1 = f(x - h)
  const fp2 = f(x + h / 2)
  const fm2 = f(x - h / 2)
  if (![f0, fp1, fm1, fp2, fm2].every(Number.isFinite)) return null

  const d1 = (fp1 - fm1) / (2 * h)
  const d2 = (fp2 - fm2) / h            // = (fp2 - fm2) / (2 · h/2)
  const m = (4 * d2 - d1) / 3
  if (!Number.isFinite(m)) return null

  const k1 = (fp1 - 2 * f0 + fm1) / h
  const k2 = (fp2 - 2 * f0 + fm2) / (h / 2)
  const noise = Math.max(
    (64 * EPS * (Math.abs(f0) + 1)) / h,   // the subtraction's own dust
    1e-9 * (1 + Math.abs(m)),
  )
  if (Math.abs(k1) > noise && Math.abs(k2) > 0.75 * Math.abs(k1)) return null

  return m
}

// ---------------------------------------------------------------------------
// 1. Tangent line
// ---------------------------------------------------------------------------

/**
 * The tangent y = m·x + b at x.
 *
 * Symbolic for every explicit library family, numeric (Richardson) for typed
 * expressions and anything else with an evalExplicit. Returns null — never a
 * field containing NaN — outside the curve's domain, at a pole, at a corner,
 * at a vertical tangent, and for any curve that is not a function of x.
 */
export function tangentAt(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  x: number,
): TangentLine | null {
  if (!Number.isFinite(x)) return null
  const ex = explicitOf(curve, models)
  if (!ex) return null
  if (!inDomain(ex.domain, x)) return null

  const y = ex.f(x)
  if (!Number.isFinite(y)) return null

  const sym = symbolicSlope(curve.modelId, ex.params, x)
  if (sym.kind === 'undefined') return null

  let m: number
  let exact: boolean
  if (sym.kind === 'value') {
    m = sym.m
    exact = true
  } else {
    const num = numericSlope(ex.f, x, spanOf(ex.domain, x))
    if (num === null) return null
    m = num
    exact = false
  }

  const b = y - m * x
  if (!Number.isFinite(m) || !Number.isFinite(b)) return null
  return { m, b, point: { x, y }, exact }
}

// ---------------------------------------------------------------------------
// 2. Derivative curve
// ---------------------------------------------------------------------------

/** "y = 3x^{2} - 4" (or "f(x) = ...") -> "f'(x) = 3x^{2} - 4". */
function primeLatex(body: string): string {
  return `f'(x) = ${stripLhs(body)}`
}

function stripLhs(s: string): string {
  return s.replace(/^\s*(?:y|f\s*\(\s*x\s*\))\s*=\s*/, '').trim()
}

/** "x", "x - 1.2", "x + 1.2" */
function xMinus(b: number): string {
  if (!Number.isFinite(b) || b === 0) return 'x'
  return b > 0 ? `x - ${fmt(b)}` : `x + ${fmt(-b)}`
}

/** Wrap in \left( \right) unless it is the bare variable. */
function paren(inner: string): string {
  return inner === 'x' ? 'x' : `\\left(${inner}\\right)`
}

/** A leading coefficient: "", "-", or the formatted number. */
function coef(v: number): string {
  const s = fmt(v)
  if (s === '1') return ''
  if (s === '-1') return '-'
  return s
}

/**
 * a/(k·body): move k into the numerator when it divides a into something at
 * least as readable, so √'s derivative prints 1/√x rather than 2/(2√x) — and
 * leave it downstairs otherwise, because 1/(2√x) is how it is written on the
 * board and 0.5/√x is not.
 */
function overFrac(a: number, k: number): { sign: string; num: string; den: string } {
  const sign = a < 0 ? '-' : ''
  const m = Math.abs(a)
  const q = m / k
  if (Number.isInteger(q)) return { sign, num: fmt(q), den: '' }
  return { sign, num: fmt(m), den: String(k) }
}

function closureSpec(
  id: string,
  name: string,
  latex: (params: number[]) => string,
  evalExplicit: (params: number[], x: number) => number,
  names: string[],
): ModelSpec {
  return { id, kind: 'explicit', name, evalExplicit, latex, paramMeta: metas(names) }
}

/** The derivative of a library family that is itself a library family. */
function familyDerivative(
  modelId: string,
  p: number[],
  models: Record<string, ModelSpec>,
): { spec: ModelSpec; params: number[] } | null {
  const pick = (id: string): ModelSpec | null => models[id] ?? MODELS[id] ?? null

  switch (modelId) {
    // a line's derivative is its own slope: a horizontal line
    case 'line': {
      const spec = pick('line')
      return spec ? { spec, params: [p[1] ?? 0, 0] } : null
    }
    // poly_n -> poly_{n−1}; a cubic's derivative IS a parabola, sliders and all
    case 'poly2':
    case 'poly3':
    case 'poly4': {
      const d = polyDeriv(p)
      const id = d.length >= 4 ? 'poly3' : d.length === 3 ? 'poly2' : 'line'
      const spec = pick(id)
      if (!spec) return null
      const params = id === 'line' && d.length < 2 ? [d[0] ?? 0, 0] : d
      return { spec, params }
    }
    // a·sin(bx + c) + d  ->  a·b·sin(bx + c + π/2)
    case 'sine': {
      const spec = pick('sine')
      return spec
        ? { spec, params: [p[0] * p[1], p[1], p[2] + Math.PI / 2, 0] }
        : null
    }
    // a·e^{bx} + c  ->  (a·b)·e^{bx}
    case 'exp': {
      const spec = pick('exp')
      return spec ? { spec, params: [p[0] * p[1], p[1], 0] } : null
    }
    // a·ln(x − b) + c  ->  a/(x − b): the reciprocal family, exactly
    case 'log': {
      const spec = pick('recip')
      return spec ? { spec, params: [p[0], p[1], 0] } : null
    }
    default:
      return null
  }
}

/**
 * Closed-form derivative specs for the families whose derivative is real
 * mathematics but not a member of the library. Each closes over nothing: its
 * params are the parent's, minus the ones that differentiate away, so every
 * slider on the derivative card still means what its letter says.
 */
function closureDerivative(
  modelId: string,
  p: number[],
  id: string,
): { spec: ModelSpec; params: number[] } | null {
  switch (modelId) {
    // −a/(x − b)²
    case 'recip':
      return {
        params: [p[0], p[1]],
        spec: closureSpec(
          id, 'Derivative',
          q => {
            // the numerator IS the coefficient, so the sign rides outside the
            // fraction: "-\frac{2}{(x-1)^{2}}", never "\frac{-2}{...}"
            const frac = `\\frac{${fmt(Math.abs(q[0]))}}{${paren(xMinus(q[1]))}^{2}}`
            return `f'(x) = ${q[0] < 0 ? '' : '-'}${frac}`
          },
          (q, x) => {
            const u = x - q[1]
            return u === 0 ? Number.NaN : -q[0] / (u * u)
          },
          ['a', 'b'],
        ),
      }

    // −2a(x − b)/c² · e^{−((x−b)/c)²}
    case 'gauss':
      return {
        params: [p[0], p[1], p[2]],
        spec: closureSpec(
          id, 'Derivative',
          q => {
            const k = (-2 * q[0]) / (q[2] * q[2])
            // (x − b)/c is just (x − b) when c is ±1; the square eats the sign
            const inner = Math.abs(q[2]) === 1
              ? paren(xMinus(q[1]))
              : `\\left(\\frac{${xMinus(q[1])}}{${fmt(q[2])}}\\right)`
            return `f'(x) = ${coef(k)}${paren(xMinus(q[1]))}e^{-${inner}^{2}}`
          },
          (q, x) => {
            const c = q[2]
            if (!(Math.abs(c) > 0)) return Number.NaN
            const z = (x - q[1]) / c
            return ((-2 * q[0] * (x - q[1])) / (c * c)) * Math.exp(-z * z)
          },
          ['a', 'b', 'c'],
        ),
      }

    // a·b·e^{−b(x−c)} / (1 + e^{−b(x−c)})²
    case 'logistic':
      return {
        params: [p[0], p[1], p[2]],
        spec: closureSpec(
          id, 'Derivative',
          q => {
            // e^{−b(x−c)}: fold the minus into the coefficient so a negative b
            // does not print "e^{--2(x-1)}"
            const e = `e^{${coef(-q[1])}${paren(xMinus(q[2]))}}`
            return `f'(x) = \\frac{${coef(q[0] * q[1]) || '1'}${e}}{\\left(1 + ${e}\\right)^{2}}`
          },
          (q, x) => {
            const s = 1 / (1 + Math.exp(-q[1] * (x - q[2])))
            return q[0] * q[1] * s * (1 - s)
          },
          ['a', 'b', 'c'],
        ),
      }

    // a·sgn(x − b) — a step, and NaN exactly at the corner
    case 'abs':
      return {
        params: [p[0], p[1]],
        spec: closureSpec(
          id, 'Derivative',
          q => `f'(x) = ${coef(q[0])}\\operatorname{sgn}${paren(xMinus(q[1]))}`,
          (q, x) => {
            const u = x - q[1]
            return u === 0 ? Number.NaN : u > 0 ? q[0] : -q[0]
          },
          ['a', 'b'],
        ),
      }

    // a / (2√(x − b))
    case 'sqrt':
      return {
        params: [p[0], p[1]],
        spec: closureSpec(
          id, 'Derivative',
          q => {
            const f = overFrac(q[0], 2)
            return `f'(x) = ${f.sign}\\frac{${f.num}}{${f.den}\\sqrt{${xMinus(q[1])}}}`
          },
          (q, x) => (x > q[1] ? q[0] / (2 * Math.sqrt(x - q[1])) : Number.NaN),
          ['a', 'b'],
        ),
      }

    // a / (3·∛((x − b)²))
    case 'cbrt':
      return {
        params: [p[0], p[1]],
        spec: closureSpec(
          id, 'Derivative',
          q => {
            const f = overFrac(q[0], 3)
            return `f'(x) = ${f.sign}\\frac{${f.num}}{${f.den}\\sqrt[3]{${paren(xMinus(q[1]))}^{2}}}`
          },
          (q, x) => {
            const u = x - q[1]
            return u === 0 ? Number.NaN : q[0] / (3 * Math.cbrt(u * u))
          },
          ['a', 'b'],
        ),
      }

    // a·e·|x − b|^{e−1}·sgn(x − b)
    case 'power':
      return {
        params: [p[0], p[1], p[3]],
        spec: closureSpec(
          id, 'Derivative',
          q => {
            const e = q[2] - 1
            const bars = `\\left|${xMinus(q[1])}\\right|`
            const body = e === 0 ? '' : e === 1 ? bars : `${bars}^{${fmt(e)}}`
            const k = coef(q[0] * q[2])
            const head = k === '' && body === '' ? '' : k
            return `f'(x) = ${head}${body}\\operatorname{sgn}${paren(xMinus(q[1]))}`
          },
          (q, x) => {
            const u = x - q[1]
            const e = q[2]
            if (u === 0) return e > 1 ? 0 : Number.NaN
            return q[0] * e * Math.pow(Math.abs(u), e - 1) * (u > 0 ? 1 : -1)
          },
          ['a', 'b', 'p'],
        ),
      }

    default:
      return null
  }
}

/**
 * f′(x) as a curve the board can register under `id` and treat like any other
 * — sliders, handles, analysis, its own tangent lines.
 *
 * Closed form wherever one exists AND stays inside the library:
 *   poly_n -> poly_{n−1}   sine -> sine   exp -> exp   log -> recip
 * Closed form as a small closure where the formula leaves the library:
 *   recip, gauss, logistic, abs, sqrt, cbrt, power
 * A difference-quotient closure for typed expressions and anything else —
 * `exact: false`, and its latex says \frac{d}{dx}[...] rather than pretending
 * to a formula it never derived.
 */
export function derivativeModel(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  id: string,
): DerivativeCurve | null {
  const ex = explicitOf(curve, models)
  if (!ex) return null
  const domain = normDomain(curve.domain)

  const fam = familyDerivative(curve.modelId, ex.params, models)
  if (fam) {
    let latex: string
    try { latex = primeLatex(fam.spec.latex(fam.params)) } catch { latex = "f'(x)" }
    return { spec: fam.spec, params: fam.params, kind: 'explicit', domain, latex, exact: true }
  }

  const clo = closureDerivative(curve.modelId, ex.params, id)
  if (clo) {
    let latex: string
    try { latex = clo.spec.latex(clo.params) } catch { latex = "f'(x)" }
    // a hand-differentiated formula living in a closure is still a formula
    return { spec: clo.spec, params: clo.params, kind: 'explicit', domain, latex, exact: true }
  }

  // ---- numeric: typed expressions and any family without a hand rule -------
  const parent = ex.spec
  const parentEval = parent.evalExplicit
  if (!parentEval) return null
  const span = domain ? domain[1] - domain[0] : 20

  const spec: ModelSpec = {
    id,
    kind: 'explicit',
    name: 'Derivative',
    // The SAME Richardson difference the tangent uses, so a tangent drawn at x
    // and the derivative curve's height at x are one number, not two.
    evalExplicit: (params: number[], x: number): number => {
      const g: Fn = (t: number) => {
        let v: unknown
        try { v = parentEval.call(parent, params, t) } catch { return Number.NaN }
        return typeof v === 'number' ? v : Number.NaN
      }
      const m = numericSlope(g, x, span)
      return m === null ? Number.NaN : m
    },
    latex: (params: number[]) => {
      let body: string
      try { body = stripLhs(parent.latex(params)) } catch { body = 'f(x)' }
      return `\\frac{d}{dx}\\left[${body}\\right]`
    },
    paramMeta: (params: number[]) => {
      try { return parent.paramMeta(params) } catch { return [] }
    },
  }

  let latex: string
  try { latex = spec.latex(ex.params) } catch { latex = `\\frac{d}{dx}\\left[f(x)\\right]` }
  return {
    spec,
    params: ex.params.slice(),
    kind: 'explicit',
    domain,
    latex,
    exact: false,
  }
}

// ---------------------------------------------------------------------------
// 3. Definite integral
// ---------------------------------------------------------------------------

type Closed =
  | { kind: 'value'; v: number }
  | { kind: 'refuse' }   // the integral does not exist on this interval
  | { kind: 'none' }     // no closed form here; go numeric

/** Ascending coefficients of an antiderivative of p, with F(0) = 0. */
function polyAnti(c: number[]): number[] {
  const out = new Array<number>(c.length + 1).fill(0)
  for (let k = 0; k < c.length; k++) out[k + 1] = c[k] / (k + 1)
  return out
}

/** u·ln u − u, continuous at u = 0 where the limit is 0. */
function xlnx(u: number): number {
  if (u === 0) return 0
  return u * Math.log(u) - u
}

/** ∫_lo^hi f in closed form, lo < hi. */
function closedIntegral(modelId: string, p: number[], lo: number, hi: number): Closed {
  const W = hi - lo
  const ok = (v: number): Closed =>
    Number.isFinite(v) ? { kind: 'value', v } : { kind: 'none' }

  switch (modelId) {
    case 'line':
    case 'poly2':
    case 'poly3':
    case 'poly4': {
      const F = polyAnti(p)
      return ok(horner(F, hi) - horner(F, lo))
    }

    // ∫ a·sin(bx + c) + d  =  −(a/b)·cos(bx + c) + d·x
    case 'sine': {
      const [a, b, c, d] = p
      if (b === 0) return ok((a * Math.sin(c) + d) * W)
      return ok((-a / b) * (Math.cos(b * hi + c) - Math.cos(b * lo + c)) + d * W)
    }

    // ∫ a·e^{bx} + c  =  (a/b)·e^{bx} + c·x
    case 'exp': {
      const [a, b, c] = p
      if (b === 0) return ok((a + c) * W)
      return ok((a / b) * (Math.exp(b * hi) - Math.exp(b * lo)) + c * W)
    }

    // ∫ a·ln(x − b) + c  =  a·[(x−b)ln(x−b) − (x−b)] + c·x, only right of b
    case 'log': {
      const [a, b, c] = p
      if (lo < b) return { kind: 'refuse' }   // the integrand is undefined there
      return ok(a * (xlnx(hi - b) - xlnx(lo - b)) + c * W)
    }

    // ∫ a/(x − b) + c  =  a·ln|x − b| + c·x — but NOT across the pole
    case 'recip': {
      const [a, b, c] = p
      if (b >= lo && b <= hi) return { kind: 'refuse' }
      return ok(a * (Math.log(Math.abs(hi - b)) - Math.log(Math.abs(lo - b))) + c * W)
    }

    default:
      return { kind: 'none' }
  }
}

interface Quad { value: number; evals: number }

/**
 * Adaptive Simpson on [a, b], refusing (null) the moment the integrand stops
 * being finite: the caller has already carved the interval into runs where it
 * is defined, so a NaN down here means a gap too narrow for the scan to see,
 * and inventing a value across it would be a guess.
 */
function adaptiveSimpson(f: Fn, a: number, b: number, tol: number): Quad | null {
  let evals = 0
  const ev = (x: number): number => { evals++; return f(x) }

  const fa = ev(a)
  const fb = ev(b)
  const m0 = (a + b) / 2
  const fm0 = ev(m0)
  if (![fa, fb, fm0].every(Number.isFinite)) return null

  const simp = (x0: number, x1: number, y0: number, ym: number, y1: number): number =>
    ((x1 - x0) / 6) * (y0 + 4 * ym + y1)

  let failed = false

  const go = (
    x0: number, x1: number,
    y0: number, ym: number, y1: number,
    whole: number, eps: number, depth: number,
  ): number => {
    if (failed) return whole
    const mid = (x0 + x1) / 2
    const lm = (x0 + mid) / 2
    const rm = (mid + x1) / 2
    const ylm = ev(lm)
    const yrm = ev(rm)
    if (!Number.isFinite(ylm) || !Number.isFinite(yrm)) { failed = true; return whole }
    const left = simp(x0, mid, y0, ylm, ym)
    const right = simp(mid, x1, ym, yrm, y1)
    const delta = left + right - whole
    // out of depth or out of budget: take the better estimate and stop — an
    // honest approximation flagged exact:false beats an unbounded loop while
    // somebody drags a slider
    if (depth >= QUAD_DEPTH || evals >= QUAD_BUDGET) return left + right + delta / 15
    if (Math.abs(delta) <= 15 * eps) return left + right + delta / 15
    return (
      go(x0, mid, y0, ylm, ym, left, eps / 2, depth + 1) +
      go(mid, x1, ym, yrm, y1, right, eps / 2, depth + 1)
    )
  }

  const whole = simp(a, b, fa, fm0, fb)
  const v = go(a, b, fa, fm0, fb, whole, Math.max(tol, 1e-300), 0)
  if (failed || !Number.isFinite(v)) return null
  return { value: v, evals }
}

interface Run { lo: number; hi: number }

interface Scan {
  runs: Run[]
  /** true when part of [lo, hi] is undefined (a gap, a branch point) */
  gaps: boolean
  /** true when a blow-up was found: the integral does not exist */
  pole: boolean
  evals: number
  /** typical |f| over the interval, for tolerance setting */
  scale: number
}

function median(a: number[]): number {
  if (a.length === 0) return 0
  const s = a.slice().sort((p, q) => p - q)
  return s[Math.floor(s.length / 2)]
}

/**
 * Walk [lo, hi] once and report where f is actually defined.
 *
 * Two different things can end a run and they get opposite treatment. An
 * UNDEFINED region — sqrt left of its branch point, a piecewise gap — is a
 * hole in the domain: the finite runs still have areas and the total is
 * reported with exact:false. A POLE is an infinite discontinuity: ∫_{−1}^{1}
 * dx/x does not exist, and quietly summing the two branches to 0 would be a
 * lie with a plausible face, so any blow-up refuses the whole interval.
 *
 * The tell for the difference is the magnitude at the edge. Next to a gap the
 * curve has an ordinary value; next to a pole it has an enormous one.
 */
function scanRuns(f: Fn, lo: number, hi: number): Scan {
  const n = SCAN
  const xs = new Array<number>(n + 1)
  const ys = new Array<number>(n + 1)
  const step = (hi - lo) / n
  for (let i = 0; i <= n; i++) {
    const x = i === n ? hi : lo + i * step
    xs[i] = x
    ys[i] = f(x)
  }
  let evals = n + 1

  const finite: number[] = []
  for (const y of ys) if (Number.isFinite(y)) finite.push(Math.abs(y))
  if (finite.length === 0) return { runs: [], gaps: true, pole: false, evals, scale: 1 }
  finite.sort((p, q) => p - q)
  const scale = Math.max(finite[Math.min(finite.length - 1, Math.floor(0.75 * finite.length))], 1e-12)

  const steps: number[] = []
  for (let i = 0; i + 1 < ys.length; i++) {
    if (Number.isFinite(ys[i]) && Number.isFinite(ys[i + 1])) {
      steps.push(Math.abs(ys[i + 1] - ys[i]))
    }
  }
  const medStep = median(steps)

  // ±Infinity is a pole outright; a huge finite jump between neighbours is one too
  for (let i = 0; i <= n; i++) {
    if (!Number.isFinite(ys[i]) && !Number.isNaN(ys[i])) {
      return { runs: [], gaps: false, pole: true, evals, scale }
    }
    if (i < n && Number.isFinite(ys[i]) && Number.isFinite(ys[i + 1])) {
      const jump = Math.abs(ys[i + 1] - ys[i])
      if (
        medStep > 0 && jump > 100 * medStep &&
        Math.max(Math.abs(ys[i]), Math.abs(ys[i + 1])) > POLE_FACTOR * scale
      ) {
        return { runs: [], gaps: false, pole: true, evals, scale }
      }
    }
  }

  // maximal runs of defined samples
  const idx: Array<[number, number]> = []
  let start = -1
  for (let i = 0; i <= n; i++) {
    const ok = Number.isFinite(ys[i])
    if (ok && start < 0) start = i
    if (!ok && start >= 0) { idx.push([start, i - 1]); start = -1 }
  }
  if (start >= 0) idx.push([start, n])

  const gaps = idx.length !== 1 || idx[0][0] !== 0 || idx[0][1] !== n

  // A value at the edge of a gap that dwarfs the curve is an asymptote, not a
  // hole: the pole guard above cannot see it, because the sample that would
  // have been enormous came back NaN instead.
  for (const [i0, i1] of idx) {
    const leftEdge = i0 > 0
    const rightEdge = i1 < n
    if (leftEdge && Math.abs(ys[i0]) > POLE_FACTOR * scale) {
      return { runs: [], gaps, pole: true, evals, scale }
    }
    if (rightEdge && Math.abs(ys[i1]) > POLE_FACTOR * scale) {
      return { runs: [], gaps, pole: true, evals, scale }
    }
  }

  /** Bisect toward the edge of the defined region; returns the defined side. */
  const edge = (def: number, undef: number): number => {
    let a = def
    let b = undef
    for (let k = 0; k < 60; k++) {
      const m = (a + b) / 2
      if (m === a || m === b) break
      evals++
      if (Number.isFinite(f(m))) a = m
      else b = m
    }
    return a
  }

  const runs: Run[] = []
  for (const [i0, i1] of idx) {
    if (i1 <= i0) continue   // a lone defined sample has no width
    const a = i0 > 0 ? edge(xs[i0], xs[i0 - 1]) : xs[i0]
    const b = i1 < n ? edge(xs[i1], xs[i1 + 1]) : xs[i1]
    if (b > a) runs.push({ lo: a, hi: b })
  }
  return { runs, gaps, pole: false, evals, scale }
}

/**
 * ∫_a^b f, signed: area below the axis counts negative, the AP convention.
 * (A UI that wants total area can ask for |·| by splitting at the zeros
 * analyzeCurve already reports.)
 *
 * Closed form for poly, line, sine, exp, log and recip. Adaptive Simpson for
 * every other family and for typed expressions, with the interval first
 * scanned for gaps and poles: a gap is integrated around (exact:false), a
 * pole refuses the whole interval.
 *
 * Returns null when the curve is not a function of x, when [a, b] leaves the
 * curve's own domain, or when the integral does not exist.
 */
export function areaUnder(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  a: number,
  b: number,
): AreaResult | null {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  const ex = explicitOf(curve, models)
  if (!ex) return null
  if (!inDomain(ex.domain, a) || !inDomain(ex.domain, b)) return null
  if (a === b) return { value: 0, exact: true }

  const sign = b > a ? 1 : -1
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)

  const cf = closedIntegral(curve.modelId, ex.params, lo, hi)
  if (cf.kind === 'refuse') return null
  if (cf.kind === 'value') return { value: sign * cf.v, exact: true }

  const scan = scanRuns(ex.f, lo, hi)
  if (scan.pole) return null
  if (scan.runs.length === 0) return null

  let total = 0
  let evals = scan.evals
  const tol = QUAD_REL * Math.max(1, (hi - lo) * scan.scale)
  for (const run of scan.runs) {
    const share = tol * Math.max((run.hi - run.lo) / (hi - lo), 1e-6)
    const q = adaptiveSimpson(ex.f, run.lo, run.hi, share)
    if (!q) return null
    total += q.value
    evals += q.evals
  }
  if (!Number.isFinite(total)) return null
  return { value: sign * total, exact: false, samples: evals }
}

// ---------------------------------------------------------------------------
// 3b. Area between two curves
//
// ∫(f − g) is not a new kind of integral: it is the same definite integral of
// one new integrand. What IS new is the pair of guards — the region has to
// stay inside BOTH domains and clear of BOTH curves' poles — and the split at
// the crossings, which |f − g| needs and the signed integral does not.
//
// The split is the whole difficulty. |f − g| has a KINK at every intersection,
// and Simpson's rule fits a parabola through three points: a parabola through
// a corner is wrong by O(h²) no matter how small h gets, so an adaptive rule
// straddling one refines forever and still misses. Integrating each crossing-
// free piece on its own and summing the magnitudes gives the same number with
// a smooth integrand on every piece, which is exactly "top minus bottom" done
// once per region.
// ---------------------------------------------------------------------------

/** The polynomial families, whose params ARE ascending coefficients. */
const POLY_IDS = new Set(['line', 'poly2', 'poly3', 'poly4'])

/** Drop the zero leading coefficients a subtraction left behind. */
function trimPoly(c: readonly number[]): number[] {
  const out = c.slice()
  while (out.length > 1 && out[out.length - 1] === 0) out.pop()
  return out
}

/** The smallest library family that can hold this polynomial, or null. */
function polyFamily(c: readonly number[]): { modelId: string; params: number[] } | null {
  const t = trimPoly(c)
  if (t.length <= 2) return { modelId: 'line', params: [t[0] ?? 0, t[1] ?? 0] }
  if (t.length === 3) return { modelId: 'poly2', params: t }
  if (t.length === 4) return { modelId: 'poly3', params: t }
  if (t.length === 5) return { modelId: 'poly4', params: t }
  return null
}

/**
 * Ascending coefficients of f − g, when BOTH curves are polynomials.
 *
 * Null for every other pair — including a pair whose difference happens to be
 * a polynomial (e·x and e·x + sin x are not), because that is a fact about the
 * formulas rather than about the families, and this layer only knows families.
 */
function diffPoly(
  parent: FittedCurve,
  pParams: readonly number[],
  other: FittedCurve,
  oParams: readonly number[],
): number[] | null {
  if (!POLY_IDS.has(parent.modelId) || !POLY_IDS.has(other.modelId)) return null
  const n = Math.max(pParams.length, oParams.length)
  const out = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i++) out[i] = (pParams[i] ?? 0) - (oParams[i] ?? 0)
  return out
}

/** The x-range both curves are actually on, inside `range`. Null when empty. */
function sharedRange(
  f: Explicit,
  g: Explicit,
  range: readonly [number, number],
): [number, number] | null {
  let lo = Math.min(range[0], range[1])
  let hi = Math.max(range[0], range[1])
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null
  for (const d of [f.domain, g.domain]) {
    if (!d) continue
    lo = Math.max(lo, d[0])
    hi = Math.min(hi, d[1])
  }
  return hi > lo ? [lo, hi] : null
}

/** A spec for h = f − g, so the analyzer can hunt its zeros like any curve. */
const DIFF_MODEL_ID = 'calc:difference'

function differenceSpec(f: Fn, g: Fn): ModelSpec {
  return {
    id: DIFF_MODEL_ID,
    kind: 'explicit',
    name: 'Difference',
    evalExplicit: (_p: number[], x: number) => f(x) - g(x),
    latex: () => 'f(x) - g(x)',
    paramMeta: () => [],
  }
}

/**
 * Where `parent` and `other` meet on `range`: the zeros of f − g, sorted,
 * deduped, a tangency counted once, and never a pole.
 *
 * None of that logic is written here. A crossing of two curves IS a zero of
 * their difference, so the difference is handed to analyzeCurve() as a curve
 * in its own right and the analyzer's own machinery answers: the sign-change
 * scan with the |f| value check that keeps 1/x from reporting a zero at its
 * asymptote, the golden-section pass that finds a tangency no sign change can
 * bracket, and finish()'s dedupe. When both curves are polynomials the
 * difference is a polynomial too, and it is handed over AS one — so two
 * parabolas meet at the closed-form roots of a quadratic rather than at two
 * numbers a bisection walked to.
 *
 * The range is clipped to both domains first: a crossing off the end of one
 * sketch is a crossing of a curve that is not there.
 */
export function curveIntersections(
  parent: FittedCurve,
  other: FittedCurve,
  models: Record<string, ModelSpec>,
  range: readonly [number, number],
): number[] {
  const F = explicitOf(parent, models)
  const G = explicitOf(other, models)
  if (!F || !G) return []
  const span = sharedRange(F, G, range)
  if (!span) return []
  const [lo, hi] = span

  const cp = diffPoly(parent, F.params, other, G.params)
  const fam = cp ? polyFamily(cp) : null

  const diffCurve: FittedCurve = {
    id: 'calc:diff',
    modelId: fam ? fam.modelId : DIFF_MODEL_ID,
    params: fam ? fam.params : [],
    kind: 'explicit',
    domain: [lo, hi],
    color: '#000000',
    strokeWidth: 1,
    visible: false,
    error: 0,
  }
  const specs: Record<string, ModelSpec> = fam
    ? MODELS
    : { [DIFF_MODEL_ID]: differenceSpec(F.f, G.f) }

  let found: ReturnType<typeof analyzeCurve>
  try {
    found = analyzeCurve(diffCurve, specs)
  } catch {
    return []
  }

  const tol = 1e-9 * Math.max(1, Math.abs(lo), Math.abs(hi))
  const xs = found
    .filter((p) => p.kind === 'zero' && Number.isFinite(p.pos.x))
    .map((p) => p.pos.x)
    .filter((x) => x >= lo - tol && x <= hi + tol)
    .sort((a, b) => a - b)

  const dedupe = 1e-7 * Math.max(1, Math.abs(lo), Math.abs(hi))
  const out: number[] = []
  for (const x of xs) {
    if (out.length > 0 && Math.abs(x - out[out.length - 1]) <= dedupe) continue
    out.push(x)
  }
  return out
}

/** Cut [lo, hi] at every interior x in `cuts`; the pieces come out in order. */
function pieces(lo: number, hi: number, cuts: readonly number[]): Run[] {
  const edge = 1e-12 * Math.max(1, Math.abs(lo), Math.abs(hi))
  const inner = cuts.filter((x) => x > lo + edge && x < hi - edge).sort((a, b) => a - b)
  const out: Run[] = []
  let left = lo
  for (const x of inner) {
    if (x > left) out.push({ lo: left, hi: x })
    left = x
  }
  if (hi > left) out.push({ lo: left, hi })
  return out.length > 0 ? out : [{ lo, hi }]
}

/** The runs on which BOTH curves are defined. Both lists are sorted. */
function overlapRuns(a: readonly Run[], b: readonly Run[]): Run[] {
  const out: Run[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i].lo, b[j].lo)
    const hi = Math.min(a[i].hi, b[j].hi)
    if (hi > lo) out.push({ lo, hi })
    if (a[i].hi < b[j].hi) i++
    else j++
  }
  return out
}

/**
 * ∫_a^b (f − g) dx, with f the parent and g the other curve — and with `abs`,
 * ∫_a^b |f − g| dx: top minus bottom across every crossing, which is what an
 * AP question means by "the area between the curves".
 *
 * Signed both ways round, exactly as areaUnder is: b < a flips the sign, |·|
 * or not, because the orientation of the interval belongs to the integral and
 * not to the integrand.
 *
 * Closed form when both curves are polynomial families — a difference of
 * polynomials is a polynomial, and its antiderivative is one line — reported
 * `exact: true`. Everything else is adaptive Simpson on f − g, under the same
 * guards areaUnder uses and one guard more: the region has to stay inside BOTH
 * domains, and a pole of EITHER curve refuses the whole interval. ∫(1/x − x)
 * over [−1, 2] does not exist, and the fact that g is a perfectly nice line
 * does not make it exist.
 *
 * With `abs`, the interval is cut at every intersection first (see the note on
 * the kink above) and the magnitudes are summed piece by piece.
 */
export function areaBetween(
  parent: FittedCurve,
  other: FittedCurve,
  models: Record<string, ModelSpec>,
  a: number,
  b: number,
  abs = false,
): AreaResult | null {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  const F = explicitOf(parent, models)
  const G = explicitOf(other, models)
  if (!F || !G) return null
  if (!inDomain(F.domain, a) || !inDomain(F.domain, b)) return null
  if (!inDomain(G.domain, a) || !inDomain(G.domain, b)) return null
  if (a === b) return { value: 0, exact: true }

  const sign = b > a ? 1 : -1
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)

  // ---- closed form: a difference of polynomials is a polynomial ----------
  const cp = diffPoly(parent, F.params, other, G.params)
  if (cp) {
    const anti = polyAnti(cp)
    const at = (x: number): number => horner(anti, x)
    if (!abs) {
      const v = at(hi) - at(lo)
      if (!Number.isFinite(v)) return null
      return { value: sign * v, exact: true }
    }
    // The cuts are roots of that same polynomial, and the integrand VANISHES
    // at each of them: a root located to 1e-15 moves the answer by 1e-30, so
    // the pieces are as exact as the antiderivative they are evaluated from.
    let total = 0
    for (const p of pieces(lo, hi, curveIntersections(parent, other, models, [lo, hi]))) {
      total += Math.abs(at(p.hi) - at(p.lo))
    }
    if (!Number.isFinite(total)) return null
    return { value: sign * total, exact: true }
  }

  // ---- numeric ------------------------------------------------------------
  const sf = scanRuns(F.f, lo, hi)
  if (sf.pole) return null
  const sg = scanRuns(G.f, lo, hi)
  if (sg.pole) return null
  const runs = overlapRuns(sf.runs, sg.runs)
  if (runs.length === 0) return null

  const h: Fn = (x: number) => F.f(x) - G.f(x)
  const scale = Math.max(sf.scale, sg.scale)
  const tol = QUAD_REL * Math.max(1, (hi - lo) * scale)
  const cuts = abs ? curveIntersections(parent, other, models, [lo, hi]) : []

  let total = 0
  let evals = sf.evals + sg.evals
  for (const run of runs) {
    for (const part of abs ? pieces(run.lo, run.hi, cuts) : [run]) {
      if (!(part.hi > part.lo)) continue
      const share = tol * Math.max((part.hi - part.lo) / (hi - lo), 1e-6)
      const q = adaptiveSimpson(h, part.lo, part.hi, share)
      if (!q) return null
      total += abs ? Math.abs(q.value) : q.value
      evals += q.evals
    }
  }
  if (!Number.isFinite(total)) return null
  return { value: sign * total, exact: false, samples: evals }
}

// ---------------------------------------------------------------------------
// 4. Riemann sums
// ---------------------------------------------------------------------------

/**
 * The n rectangles of a left/right/midpoint/trapezoid sum, plus their total —
 * so "increase n and watch it converge" is one call per frame.
 *
 * Heights are f at the rule's sample point, which for the trapezoid rule is
 * the mean of the two ends: height · width is then exactly that trapezoid's
 * signed area, and a UI can draw the slab or its top edge from the same
 * number. A subinterval whose sample is undefined contributes nothing and is
 * omitted from `rects`, counted in `skipped`, so a gap in the curve shows as
 * a gap in the picture instead of a hole in the arithmetic.
 *
 * No convergence claim is made: a Riemann sum across a pole is a finite number
 * for every n and means nothing, which is why areaUnder — not this — is the
 * function that refuses.
 */
export function riemann(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  a: number,
  b: number,
  n: number,
  method: RiemannMethod,
): RiemannResult | null {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > MAX_RECTS) return null
  const ex = explicitOf(curve, models)
  if (!ex) return null
  if (!inDomain(ex.domain, a) || !inDomain(ex.domain, b)) return null
  if (a === b) return { value: 0, rects: [], skipped: 0 }

  const dx = (b - a) / n
  const rects: RiemannRect[] = []
  let value = 0
  let skipped = 0

  for (let i = 0; i < n; i++) {
    const x0 = a + i * dx
    const x1 = i === n - 1 ? b : a + (i + 1) * dx
    let height: number
    if (method === 'left') height = ex.f(x0)
    else if (method === 'right') height = ex.f(x1)
    else if (method === 'midpoint') height = ex.f((x0 + x1) / 2)
    else {
      const y0 = ex.f(x0)
      const y1 = ex.f(x1)
      height = (y0 + y1) / 2
    }
    if (!Number.isFinite(height)) { skipped++; continue }
    rects.push({ x0, x1, height })
    value += height * (x1 - x0)
  }

  if (!Number.isFinite(value)) return null
  return { value, rects, skipped }
}

/** Exposed for tests and for a UI that wants to know before it offers. */
export function hasExactDerivative(modelId: string): boolean {
  return hasSymbolic(modelId)
}

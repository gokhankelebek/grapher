// ============================================================================
// Model family registry. Each ModelSpec provides eval (matching its kind),
// KaTeX-renderable latex with nicely formatted numbers, and slider metadata
// centered on the current parameter values.
// ============================================================================

import type { ModelSpec, ParamMeta, Vec2 } from '../types'
import { conicToCenterForm } from './optimize'

// ---------------------------------------------------------------------------
// Number / term formatting
// ---------------------------------------------------------------------------

/** Round to `sig` significant digits and render KaTeX-safe (no bare 1e-7). */
export function fmt(v: number, sig = 4): string {
  if (!Number.isFinite(v)) return '0'
  if (v === 0 || Math.abs(v) < 1e-300) return '0'
  let r = Number(v.toPrecision(sig))
  if (Object.is(r, -0)) r = 0
  const a = Math.abs(r)
  if (a === 0) return '0'
  if (a >= 1e-4 && a < 1e7) {
    const s = String(r)
    if (!s.includes('e')) return s
  }
  const exp = Math.floor(Math.log10(a))
  let mant = Number((r / Math.pow(10, exp)).toPrecision(sig))
  if (Math.abs(mant) >= 10) mant = Number((mant / 10).toPrecision(sig)) // rounding edge
  return `${mant} \\cdot 10^{${exp}}`
}

const NEGLIGIBLE = 1e-12

/** Default significant digits. */
const SIG = 4

// ---------------------------------------------------------------------------
// Scale-aware digit counts
//
// Four significant figures is a fixed RELATIVE error. That is exactly right for
// a number whose own magnitude sets the curve's scale (an amplitude, a radius,
// a leading coefficient) and exactly wrong for one that merely LOCATES a
// feature much smaller than itself. A circle of radius 2 centred at x = 12345
// prints its centre as 12350 and no longer meets the drawn circle; a parabola
// five screens right of the origin has its coefficients cancel to a curve whose
// own y-range is 9 while each rounding costs ~10; a sinusoid's phase drifts
// until the printed wave is inverted. The printed equation has to agree with
// the curve being plotted, so the digit count is chosen from the size of the
// feature the number locates, not from the number itself.
// ---------------------------------------------------------------------------

/** Significant digits that keep the rounding error of `v` near `absTol`. */
function digitsForAbs(v: number, absTol: number): number {
  const a = Math.abs(v)
  if (!Number.isFinite(a) || a === 0) return SIG
  if (!(absTol > 0) || !Number.isFinite(absTol)) return SIG
  return Math.min(16, Math.max(SIG, Math.ceil(Math.log10(a / absTol))))
}

/**
 * Digits for a coordinate that locates a feature of size `ref` (a centre next
 * to a radius, a peak next to a width). Below 10·ref the default already
 * resolves the feature, so ordinary near-origin curves print exactly as before.
 */
function digitsFor(v: number, ref: number): number {
  const r = Number.isFinite(ref) && ref > 0 ? ref : 1
  if (!(Math.abs(v) > 10 * r)) return SIG
  return digitsForAbs(v, 1e-4 * r)
}

/** fmt() with the digit count that keeps |Δv| small next to `ref`. */
function fmtRel(v: number, ref: number): string {
  return fmt(v, digitsFor(v, ref))
}

/**
 * Format one term `±coef·body`. `leading` renders "-2.3x"/"2.3x", otherwise
 * " + 2.3x"/" - 2.3x". Drops "1·" (renders "x" not "1x"). Returns '' when the
 * coefficient is negligible (unless it is a lone constant and `keepZero`).
 */
function term(v: number, body: string, leading: boolean, sig = SIG, floor = NEGLIGIBLE): string {
  if (Math.abs(v) < floor) return ''
  const av = Math.abs(v)
  const avStr = fmt(av, sig)
  const isOne = avStr === '1'
  const core = body === '' ? avStr : isOne ? body : `${avStr}${body}`
  if (leading) return v < 0 ? `-${core}` : core
  return v < 0 ? ` - ${core}` : ` + ${core}`
}

/** Sum of terms; bodies[i] pairs with coeffs[i]. Falls back to '0'. */
function termSum(
  coeffs: number[], bodies: string[], sigs?: number[], floors?: number[],
): string {
  let out = ''
  for (let i = 0; i < coeffs.length; i++) {
    out += term(coeffs[i], bodies[i], out === '', sigs?.[i] ?? SIG, floors?.[i] ?? NEGLIGIBLE)
  }
  return out === '' ? '0' : out
}

// ---------------------------------------------------------------------------
// Polynomials — the family where rounding hurts most, because the terms cancel
// ---------------------------------------------------------------------------

/** p(x) = Σ b_k (x − x0)^k, exact, by repeated synthetic division. */
function shiftPolyCoeffs(c: number[], x0: number): number[] {
  const out: number[] = []
  let a = c.slice()
  while (a.length > 0) {
    const m = a.length - 1
    if (m === 0) { out.push(a[0]); break }
    const q = new Array<number>(m).fill(0)
    q[m - 1] = a[m]
    for (let i = m - 1; i >= 1; i--) q[i - 1] = a[i] + x0 * q[i]
    out.push(a[0] + x0 * q[0])
    a = q
  }
  return out
}

/**
 * How much of the shifted coefficient b_k is our own arithmetic rather than the
 * curve.
 *
 * b_k = Σ_{j≥k} C(j,k)·c_j·x0^{j−k} is a sum of terms that can be far larger
 * than the result — the vertex form of a parabola is exactly that case, where
 * b_1 = p'(x0) is 2·c_2·x0 + c_1 with the two halves cancelling — so b_k
 * arrives carrying ±eps·S_k of rounding. BELOW that, b_k is not a small
 * coefficient: it is the residue of a cancellation, and printing it is how
 * "y = 0.3(x − 3)² − 2.22·10⁻¹⁶(x − 3) − 2" happened. The estimate is the
 * textbook one for a floating-point sum, with a small factor for the n
 * additions the synthetic division makes.
 */
const RESIDUE = 8 * Number.EPSILON

function shiftResidue(c: number[], n: number, x0: number): number[] {
  const ax = Math.abs(x0)
  const out = new Array<number>(n + 1).fill(0)
  for (let k = 0; k <= n; k++) {
    let s = 0
    let binom = 1 // C(k, k)
    for (let j = k; j <= n; j++) {
      if (j > k) binom = (binom * j) / (j - k)
      s += binom * Math.abs(c[j] ?? 0) * Math.pow(ax, j - k)
    }
    out[k] = Number.isFinite(s) ? RESIDUE * s : 0
  }
  return out
}

/**
 * The window a polynomial's own shape occupies: centred on its centre of
 * symmetry x0 = −c_{n−1}/(n·c_n), half-width W from the largest root magnitude
 * of the shifted coefficients, and R the y-range the shape spans there. The
 * constant term is deliberately left out of both — it is a vertical offset, not
 * a scale, and letting a curve drawn high above the axis widen its own error
 * budget is the vertical twin of the bug being fixed.
 *
 * Coefficients that are pure cancellation residue are left out as well, and
 * that omission is load-bearing: a vertex-form parabola has b_1 = 0 in exact
 * arithmetic and 2.2e-16 in floating point, and reading a window off THAT
 * makes W ≈ 7e-16 and R ≈ 3e-31 — a curve the size of a rounding error, whose
 * error budget is small enough to print the rounding error as a term.
 */
function polyScale(c: number[], n: number): { x0: number; W: number; R: number } {
  const raw = -c[n - 1] / (n * c[n])
  const x0 = Number.isFinite(raw) ? raw : 0
  const b = shiftPolyCoeffs(c, x0)
  const res = shiftResidue(c, n, x0)
  const real = (k: number) => Math.abs(b[k]) > res[k]
  let W = 0
  for (let k = 1; k < n; k++) {
    if (!real(k)) continue
    const q = Math.abs(b[k] / b[n])
    if (q > 0 && Number.isFinite(q)) W = Math.max(W, Math.pow(q, 1 / (n - k)))
  }
  if (!(W > 0) || !Number.isFinite(W)) W = 1 // a pure monomial sets no x-scale
  let R = 0
  for (let k = 1; k <= n; k++) if (real(k)) R += Math.abs(b[k]) * Math.pow(W, k)
  if (!(R > 0) || !Number.isFinite(R)) R = 1
  return { x0, W, R }
}

function polyTermsLatex(
  c: number[], sigs: number[], body: (i: number) => string, floors?: number[],
): string {
  const coeffs: number[] = []
  const bodies: string[] = []
  const ss: number[] = []
  const fs: number[] = []
  for (let i = c.length - 1; i >= 0; i--) {
    coeffs.push(c[i] ?? 0)
    bodies.push(body(i))
    ss.push(sigs[i] ?? SIG)
    fs.push(floors?.[i] ?? NEGLIGIBLE)
  }
  return `y = ${termSum(coeffs, bodies, ss, fs)}`
}

/** Ascending coefficients -> "y = c_n x^{n} + ... + c_0". */
function polyLatex(c: number[]): string {
  let n = c.length - 1
  while (n > 0 && !(Math.abs(c[n]) > NEGLIGIBLE)) n--
  const plainBody = (i: number) => (i === 0 ? '' : i === 1 ? 'x' : `x^{${i}}`)
  if (n < 1 || !c.every(Number.isFinite)) {
    return polyTermsLatex(c, c.map(() => SIG), plainBody)
  }

  const head = c.slice(0, n + 1)
  const { x0, W, R } = polyScale(head, n)
  // over the window, x reaches |x0| + W, so coefficient k is levered by that
  // much; give each one the digits its own lever demands
  const X = Math.abs(x0) + W
  const sigs = head.map((v, k) => digitsForAbs(v, (1e-4 * R) / Math.pow(X, k)))
  if (Math.max(...sigs) <= 10) return polyTermsLatex(head, sigs, plainBody)

  // The expanded form has stopped surviving rounding at any readable length:
  // print about the centre instead, where every coefficient is commensurate
  // with the curve's own scale and the shift itself is exact.
  const x0d = digitsFor(x0, W)
  const x0r = Number(x0.toPrecision(x0d))
  const b = shiftPolyCoeffs(head, x0r)
  const res = shiftResidue(head, n, x0r)
  // A term is printed only if it is BOTH visible against the curve's own range
  // over the window AND bigger than the rounding the shift itself introduced.
  const tol = b.map((_, k) => Math.max((1e-4 * R) / Math.pow(W, k), res[k]))
  const bSigs = b.map((v, k) => digitsForAbs(v, tol[k]))
  const inner = shifted('x', x0r, W)
  const wrapped = inner === 'x' ? 'x' : `\\left(${inner}\\right)`
  // Re-expanding coefficients that themselves cancelled leaves dust: a cubic
  // whose quadratic term is exactly zero comes back as 1.5e-5. Drop a term the
  // window cannot see rather than printing arithmetic noise as mathematics.
  return polyTermsLatex(
    b, bSigs,
    i => (i === 0 ? '' : i === 1 ? wrapped : `${wrapped}^{${i}}`),
    tol,
  )
}

/** "(x - 1.2)" style inner expression, collapsing when the shift is ~0. */
function shifted(variable: string, center: number, ref = 1): string {
  if (Math.abs(center) < NEGLIGIBLE) return variable
  return center > 0
    ? `${variable} - ${fmtRel(center, ref)}`
    : `${variable} + ${fmtRel(-center, ref)}`
}

/**
 * Exponent label: a fitted exponent lands on values like 0.667, which reads far
 * better as \frac{2}{3}. Snap to a simple fraction (denominator ≤ 6) when it is
 * within 0.5%, otherwise print the decimal.
 */
function expLatex(e: number): string {
  if (!Number.isFinite(e)) return '0'
  for (let den = 2; den <= 6; den++) {
    const num = Math.round(e * den)
    if (num === 0) continue
    if (num % den === 0) continue // integral — handled by the plain path below
    if (Math.abs(e - num / den) <= 0.005 * Math.abs(e)) {
      const sign = num < 0 ? '-' : ''
      return `${sign}\\frac{${Math.abs(num)}}{${den}}`
    }
  }
  return fmt(e)
}

/** "(x - 1.2)^2" -> "\left(x - 1.2\right)^{2}" or "x^{2}" when centered. */
function shiftedSq(variable: string, center: number, ref = 1): string {
  const inner = shifted(variable, center, ref)
  return inner === variable ? `${variable}^{2}` : `\\left(${inner}\\right)^{2}`
}

/** Horner evaluation of ascending coefficients. */
function horner(c: number[], x: number): number {
  let v = 0
  for (let i = c.length - 1; i >= 0; i--) v = v * x + c[i]
  return v
}

// ---------------------------------------------------------------------------
// Slider metadata
// ---------------------------------------------------------------------------

function metaFor(name: string, v: number): ParamMeta {
  const span = Math.max(Math.abs(v) * 2, 1)
  return { name, min: v - span, max: v + span, step: span / 100 }
}

// ---------------------------------------------------------------------------
// Translation helpers (drag-editing): exact rigid shifts of the curve
// ---------------------------------------------------------------------------

function polyMulLocal(a: number[], b: number[]): number[] {
  const out = new Array<number>(a.length + b.length - 1).fill(0)
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j]
  }
  return out
}

/** q(x) = p(x − dx) + dy, exact via binomial expansion (ascending coeffs). */
function translatePolyCoeffs(c: number[], dx: number, dy: number): number[] {
  const out = new Array<number>(c.length).fill(0)
  let acc: number[] = [1] // (x − dx)^j, expanded
  for (let j = 0; j < c.length; j++) {
    for (let i = 0; i < acc.length; i++) out[i] += c[j] * acc[i]
    if (j < c.length - 1) acc = polyMulLocal(acc, [-dx, 1])
  }
  out[0] += dy
  return out
}

function centeredMeta(names: string[], params: number[]): ParamMeta[] {
  return names.map((name, i) => metaFor(name, params[i] ?? 0))
}

function polyModel(id: string, name: string, degree: number): ModelSpec {
  const names = ['a', 'b', 'c', 'd', 'e'].slice(0, degree + 1)
  return {
    id,
    kind: 'explicit',
    name,
    evalExplicit: (p, x) => horner(p, x),
    latex: p => polyLatex(p),
    // ascending storage, but present sliders highest-degree first, matching latex
    paramMeta: p =>
      names.map((nm, i) => {
        const idx = degree - i
        return metaFor(nm, p[idx] ?? 0)
      }),
    translate: (p, dx, dy) => translatePolyCoeffs(p, dx, dy),
  }
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

export const MODELS: Record<string, ModelSpec> = {
  // -------------------------------------------------------------- explicit --
  line: {
    id: 'line',
    kind: 'explicit',
    name: 'Line',
    // params: [b, m] ascending -> y = m x + b
    evalExplicit: (p, x) => horner(p, x),
    latex: p => polyLatex(p),
    paramMeta: p => [metaFor('m', p[1] ?? 0), metaFor('b', p[0] ?? 0)],
    translate: (p, dx, dy) => translatePolyCoeffs(p, dx, dy),
  },

  poly2: polyModel('poly2', 'Parabola', 2),
  poly3: polyModel('poly3', 'Cubic', 3),
  poly4: polyModel('poly4', 'Quartic', 4),

  sine: {
    id: 'sine',
    kind: 'explicit',
    name: 'Sinusoid',
    // params: [a, b, c, d] -> a·sin(bx + c) + d
    evalExplicit: (p, x) => p[0] * Math.sin(p[1] * x + p[2]) + p[3],
    latex: p => {
      const [a, b, c, d] = p
      // The phase is measured in radians: 4 significant figures of 1e5 is a
      // whole radian out, which prints a wave inverted against the one drawn.
      // The frequency is worse: its error is levered by how far the wave sits
      // from the origin (x ≈ −c/b), plus the few periods it spans there.
      const ab = Math.abs(b)
      const reach = ab > 0 ? Math.abs(c / b) + (8 * Math.PI) / ab : 1
      const inner = termSum(
        [b, c], ['x', ''], [digitsForAbs(b, 1e-3 / reach), digitsFor(c, 1)],
      )
      const sinTerm = `\\sin\\left(${inner}\\right)`
      return `y = ${termSum([a, d], [sinTerm, ''], [SIG, digitsFor(d, Math.abs(a))])}`
    },
    paramMeta: p => centeredMeta(['a', 'b', 'c', 'd'], p),
    // a·sin(b(x−dx) + c) + d + dy
    translate: (p, dx, dy) => [p[0], p[1], p[2] - p[1] * dx, p[3] + dy],
  },

  gauss: {
    id: 'gauss',
    kind: 'explicit',
    name: 'Gaussian',
    // params: [a, b, c, d] -> a·exp(−((x−b)/c)²) + d
    evalExplicit: (p, x) => {
      const z = (x - p[1]) / p[2]
      return p[0] * Math.exp(-z * z) + p[3]
    },
    latex: p => {
      const [a, b, c, d] = p
      const expTerm = `e^{-\\left(\\frac{${shifted('x', b, Math.abs(c))}}{${fmt(c)}}\\right)^{2}}`
      return `y = ${termSum([a, d], [expTerm, ''], [SIG, digitsFor(d, Math.abs(a))])}`
    },
    paramMeta: p => centeredMeta(['a', 'b', 'c', 'd'], p),
    translate: (p, dx, dy) => [p[0], p[1] + dx, p[2], p[3] + dy],
  },

  exp: {
    id: 'exp',
    kind: 'explicit',
    name: 'Exponential',
    // params: [a, b, c] -> a·exp(bx) + c
    evalExplicit: (p, x) => p[0] * Math.exp(p[1] * x) + p[2],
    latex: p => {
      const [a, b, c] = p
      const expTerm = `e^{${term(b, 'x', true) || '0'}}`
      // a·e^{bx} translated right by dx becomes (a·e^{−b·dx})·e^{bx}: the
      // amplitude of a perfectly ordinary curve drawn 120 units out is 1e-23.
      // Dropping it as "negligible" would print the asymptote instead of the
      // curve, so only an exactly-zero amplitude removes the term.
      const head = term(a, expTerm, true, SIG, 1e-300)
      const tail = term(c, '', head === '', digitsFor(c, Math.abs(a)))
      return `y = ${head + tail || '0'}`
    },
    paramMeta: p => centeredMeta(['a', 'b', 'c'], p),
    // a·e^{b(x−dx)} + c + dy  =  (a·e^{−b·dx})·e^{bx} + (c + dy), exact
    translate: (p, dx, dy) => {
      const a2 = p[0] * Math.exp(-p[1] * dx)
      return [Number.isFinite(a2) ? a2 : p[0], p[1], p[2] + dy]
    },
  },

  log: {
    id: 'log',
    kind: 'explicit',
    name: 'Logarithm',
    // params: [a, b, c] -> a·ln(x − b) + c. The vertical asymptote at x = b is
    // the family's defining feature: the curve does not merely get steep there,
    // it STOPS, so everything at or left of b is undefined and says so with
    // NaN (the renderer lifts the pen on a non-finite sample).
    evalExplicit: (p, x) => {
      const u = x - p[1]
      return u > 0 ? p[0] * Math.log(u) + p[2] : Number.NaN
    },
    latex: p => {
      const [a, b, c] = p
      const body = `\\ln\\left(${shifted('x', b)}\\right)`
      return `y = ${termSum([a, c], [body, ''], [SIG, digitsFor(c, Math.abs(a))])}`
    },
    paramMeta: p => centeredMeta(['a', 'b', 'c'], p),
    // a·ln((x − dx) − b) + c + dy = a·ln(x − (b + dx)) + (c + dy), exact
    translate: (p, dx, dy) => [p[0], p[1] + dx, p[2] + dy],
  },

  sqrt: {
    id: 'sqrt',
    kind: 'explicit',
    name: 'Square root',
    // params: [a, b, c] -> a·sqrt(x − b) + c, undefined left of the branch point
    evalExplicit: (p, x) => {
      const u = x - p[1]
      return u < 0 ? Number.NaN : p[0] * Math.sqrt(u) + p[2]
    },
    latex: p => {
      const [a, b, c] = p
      return `y = ${termSum(
        [a, c], [`\\sqrt{${shifted('x', b)}}`, ''], [SIG, digitsFor(c, Math.abs(a))],
      )}`
    },
    paramMeta: p => centeredMeta(['a', 'b', 'c'], p),
    translate: (p, dx, dy) => [p[0], p[1] + dx, p[2] + dy],
  },

  cbrt: {
    id: 'cbrt',
    kind: 'explicit',
    name: 'Cube root',
    // params: [a, b, c] -> a·cbrt(x − b) + c, defined for every x
    evalExplicit: (p, x) => p[0] * Math.cbrt(x - p[1]) + p[2],
    latex: p => {
      const [a, b, c] = p
      return `y = ${termSum(
        [a, c], [`\\sqrt[3]{${shifted('x', b)}}`, ''], [SIG, digitsFor(c, Math.abs(a))],
      )}`
    },
    paramMeta: p => centeredMeta(['a', 'b', 'c'], p),
    translate: (p, dx, dy) => [p[0], p[1] + dx, p[2] + dy],
  },

  power: {
    id: 'power',
    kind: 'explicit',
    name: 'Power curve',
    // params: [a, b, c, p] -> a·|x − b|^p + c. The absolute value makes the
    // family even about the branch point, which is what a hand-drawn cusp
    // (x^{2/3} and friends) actually looks like on both sides of x = b.
    evalExplicit: (p, x) => p[0] * Math.pow(Math.abs(x - p[1]), p[3]) + p[2],
    latex: p => {
      const [a, b, c, e] = p
      const body = `\\left|${shifted('x', b)}\\right|^{${expLatex(e)}}`
      return `y = ${termSum([a, c], [body, ''], [SIG, digitsFor(c, Math.abs(a))])}`
    },
    paramMeta: p => [
      metaFor('a', p[0] ?? 1),
      metaFor('b', p[1] ?? 0),
      metaFor('c', p[2] ?? 0),
      { name: 'p', min: 0.1, max: 4, step: 0.01 },
    ],
    translate: (p, dx, dy) => [p[0], p[1] + dx, p[2] + dy, p[3]],
  },

  abs: {
    id: 'abs',
    kind: 'explicit',
    name: 'Absolute value',
    // params: [a, b, c] -> a·|x−b| + c
    evalExplicit: (p, x) => p[0] * Math.abs(x - p[1]) + p[2],
    latex: p => {
      const [a, b, c] = p
      const absTerm = `\\left|${shifted('x', b)}\\right|`
      return `y = ${termSum([a, c], [absTerm, ''], [SIG, digitsFor(c, Math.abs(a))])}`
    },
    paramMeta: p => centeredMeta(['a', 'b', 'c'], p),
    translate: (p, dx, dy) => [p[0], p[1] + dx, p[2] + dy],
  },

  logistic: {
    id: 'logistic',
    kind: 'explicit',
    name: 'Logistic',
    // params: [a, b, c, d] -> a / (1 + exp(−b(x−c))) + d
    evalExplicit: (p, x) => p[0] / (1 + Math.exp(-p[1] * (x - p[2]))) + p[3],
    latex: p => {
      const [a, b, c, d] = p
      // the midpoint c only matters to within a fraction of the transition
      // width 1/|b|; further out the logistic is flat and the equation lies
      const inner = shifted('x', c, Math.abs(b) > 0 ? 1 / Math.abs(b) : 1)
      const bAbs = fmt(Math.abs(b))
      const bCoef = bAbs === '1' ? '' : bAbs
      const sign = b >= 0 ? '-' : ''
      const frac = `\\frac{${fmt(a)}}{1 + e^{${sign}${bCoef}\\left(${inner}\\right)}}`
      const tail = term(d, '', false, digitsFor(d, Math.abs(a)))
      return `y = ${frac}${tail}`
    },
    paramMeta: p => centeredMeta(['a', 'b', 'c', 'd'], p),
    translate: (p, dx, dy) => [p[0], p[1], p[2] + dx, p[3] + dy],
  },

  recip: {
    id: 'recip',
    kind: 'explicit',
    name: 'Reciprocal',
    // params: [a, b, c] -> a/(x − b) + c. Both branches belong to the curve;
    // the pole at x = b belongs to neither, so it evaluates to NaN and the
    // renderer breaks the path there instead of drawing the vertical line
    // between +∞ and −∞ that naive sampling produces.
    evalExplicit: (p, x) => {
      const u = x - p[1]
      return u === 0 ? Number.NaN : p[0] / u + p[2]
    },
    latex: p => {
      const [a, b, c] = p
      if (!(Math.abs(a) > NEGLIGIBLE)) return `y = ${fmt(c)}`
      // the numerator IS the coefficient, so the sign is carried outside the
      // fraction rather than inside it ("-\frac{2}{x}", not "\frac{-2}{x}")
      const frac = `\\frac{${fmt(Math.abs(a))}}{${shifted('x', b)}}`
      const head = a < 0 ? `-${frac}` : frac
      return `y = ${head}${term(c, '', false, digitsFor(c, Math.abs(a)))}`
    },
    paramMeta: p => centeredMeta(['a', 'b', 'c'], p),
    // a/((x − dx) − b) + c + dy = a/(x − (b + dx)) + (c + dy), exact
    translate: (p, dx, dy) => [p[0], p[1] + dx, p[2] + dy],
  },

  // ------------------------------------------------------------ parametric --
  vline: {
    id: 'vline',
    kind: 'parametric',
    name: 'Vertical line',
    // params: [a] -> t ↦ (a, t)
    evalParametric: (p, t): Vec2 => ({ x: p[0], y: t }),
    latex: p => `x = ${fmtRel(p[0], 1)}`,
    paramMeta: p => centeredMeta(['a'], p),
    translate: (p, dx, _dy) => [p[0] + dx],
  },

  // -------------------------------------------------------------- implicit --
  circle: {
    id: 'circle',
    kind: 'implicit',
    name: 'Circle',
    // params: [a, b, r] -> (x−a)² + (y−b)² − r² = 0
    evalImplicit: (p, x, y) => {
      const dx = x - p[0], dy = y - p[1]
      return dx * dx + dy * dy - p[2] * p[2]
    },
    latex: p => {
      const [a, b, r] = p
      // the centre is only meaningful to within a fraction of the radius
      const ref = Math.abs(r)
      return `${shiftedSq('x', a, ref)} + ${shiftedSq('y', b, ref)} = ${fmt(r * r)}`
    },
    paramMeta: p => {
      const r = Math.abs(p[2] ?? 1)
      const span = Math.max(r * 2, 1)
      return [
        metaFor('a', p[0] ?? 0),
        metaFor('b', p[1] ?? 0),
        { name: 'r', min: Math.max(span / 200, r - span), max: r + span, step: span / 100 },
      ]
    },
    translate: (p, dx, dy) => [p[0] + dx, p[1] + dy, p[2]],
  },

  ellipse: {
    id: 'ellipse',
    kind: 'implicit',
    name: 'Ellipse',
    // params: [A, B, C, D, E, F] -> Ax² + Bxy + Cy² + Dx + Ey + F = 0
    evalImplicit: (p, x, y) =>
      p[0] * x * x + p[1] * x * y + p[2] * y * y + p[3] * x + p[4] * y + p[5],
    latex: p => {
      const [A, B, C, D, E, F] = p
      const axisAligned = Math.abs(B) < 0.02 * (Math.abs(A) + Math.abs(C) + 1e-300)
      if (axisAligned) {
        const cf = conicToCenterForm([A, 0, C, D, E, F])
        if (cf) {
          const ref = Math.min(cf.rx, cf.ry)
          return (
            `\\frac{${shiftedSq('x', cf.cx, ref)}}{${fmt(cf.rx * cf.rx)}} + ` +
            `\\frac{${shiftedSq('y', cf.cy, ref)}}{${fmt(cf.ry * cf.ry)}} = 1`
          )
        }
      }
      // general conic form; scale so the largest quadratic coefficient is 1
      const scale = Math.max(Math.abs(A), Math.abs(B), Math.abs(C)) || 1
      const s = (A >= 0 ? 1 : -1) / scale
      // A coefficient of the degree-k monomial is levered by L^k, and moving Q
      // by δ moves the curve by δ/|∇Q| ≈ δ/(2·r_min) in the scaled form. Ask
      // each coefficient for the digits that keep the curve within 0.1% of its
      // own minor radius — a rotated ellipse far from the origin otherwise
      // rounds into a conic with no real solutions at all.
      const cf = conicToCenterForm(p)
      const m = cf ? Math.min(cf.rx, cf.ry) : 0
      const L = cf
        ? Math.max(Math.abs(cf.cx) + cf.rx, Math.abs(cf.cy) + cf.ry, 1)
        : 1
      const tol0 = m > 0 ? 1e-5 * m * m : 0
      const sigAt = (k: number, v: number) => digitsForAbs(v, tol0 / Math.pow(L, k))
      const lhs = termSum(
        [A * s, B * s, C * s, D * s, E * s],
        ['x^{2}', 'xy', 'y^{2}', 'x', 'y'],
        [sigAt(2, A * s), sigAt(2, B * s), sigAt(2, C * s), sigAt(1, D * s), sigAt(1, E * s)],
      )
      return `${lhs} = ${fmt(-F * s, sigAt(0, F * s))}`
    },
    paramMeta: p => centeredMeta(['A', 'B', 'C', 'D', 'E', 'F'], p),
    // Q'(x, y) = Q(x − dx, y − dy), expanded exactly
    translate: (p, dx, dy) => {
      const [A, B, C, D, E, F] = p
      return [
        A,
        B,
        C,
        D - 2 * A * dx - B * dy,
        E - B * dx - 2 * C * dy,
        F + A * dx * dx + B * dx * dy + C * dy * dy - D * dx - E * dy,
      ]
    },
  },

  // ----------------------------------------------------------------- polar --
  polarRose: {
    id: 'polarRose',
    kind: 'polar',
    name: 'Rose',
    // params: [a, k, c] -> r = a·cos(kθ + c)  (c: phase, hand roses are rotated)
    evalPolar: (p, theta) => p[0] * Math.cos(Math.round(p[1]) * theta + (p[2] ?? 0)),
    latex: p => {
      const k = Math.round(p[1])
      const c = p[2] ?? 0
      const kStr = k === 1 ? '' : String(k)
      const inner =
        Math.abs(c) < 1e-4
          ? `${kStr}\\theta`
          : `${kStr}\\theta ${c > 0 ? '+' : '-'} ${fmtRel(Math.abs(c), 1)}`
      return `r = ${term(p[0], `\\cos\\left(${inner}\\right)`, true) || '0'}`
    },
    paramMeta: p => {
      const c = p[2] ?? 0
      return [
        metaFor('a', p[0] ?? 1),
        { name: 'k', min: 1, max: 8, step: 1 },
        { name: 'c', min: c - Math.PI, max: c + Math.PI, step: Math.PI / 100 },
      ]
    },
  },

  limacon: {
    id: 'limacon',
    kind: 'polar',
    name: 'Limaçon',
    // params: [a, b] -> r = a + b·cos(θ)
    evalPolar: (p, theta) => p[0] + p[1] * Math.cos(theta),
    // the constant only matters against the size of the variation it offsets
    latex: p => `r = ${termSum(
      [p[0], p[1]], ['', '\\cos\\theta'], [digitsFor(p[0], Math.abs(p[1])), SIG],
    )}`,
    paramMeta: p => centeredMeta(['a', 'b'], p),
  },

  spiral: {
    id: 'spiral',
    kind: 'polar',
    name: 'Spiral',
    // params: [a, b] -> r = a + b·θ
    evalPolar: (p, theta) => p[0] + p[1] * theta,
    latex: p => `r = ${termSum(
      [p[0], p[1]], ['', '\\theta'],
      [digitsFor(p[0], Math.abs(p[1]) * 2 * Math.PI), SIG],
    )}`,
    paramMeta: p => centeredMeta(['a', 'b'], p),
  },

  // ------------------------------------------------------------- universal --
  fourier: {
    id: 'fourier',
    kind: 'parametric',
    name: 'Fourier curve',
    // params: [cx, cy, ax1, bx1, ay1, by1, ax2, ...] for N harmonics
    evalParametric: (p, t): Vec2 => {
      const N = Math.floor((p.length - 2) / 4)
      let x = p[0]
      let y = p[1]
      for (let n = 1; n <= N; n++) {
        const o = 2 + (n - 1) * 4
        const cn = Math.cos(n * t)
        const sn = Math.sin(n * t)
        x += p[o] * cn + p[o + 1] * sn
        y += p[o + 2] * cn + p[o + 3] * sn
      }
      return { x, y }
    },
    latex: p => {
      const N = Math.floor((p.length - 2) / 4)
      if (N < 1) return `\\text{Fourier}(0)`
      const [cx, cy, ax, bx, ay, by] = p
      const dots = N > 1 ? ' + \\cdots' : ''
      // the centre only locates a shape whose size is set by the harmonics
      let amp = 0
      for (let i = 2; i < p.length; i++) amp = Math.max(amp, Math.abs(p[i]))
      const cSig = (v: number) => digitsFor(v, amp)
      const xPart = termSum([cx, ax, bx], ['', '\\cos t', '\\sin t'], [cSig(cx), SIG, SIG])
      const yPart = termSum([cy, ay, by], ['', '\\cos t', '\\sin t'], [cSig(cy), SIG, SIG])
      return (
        `\\text{Fourier}(N{=}${N}):\\; ` +
        `x \\approx ${xPart}${dots},\\;\\; y \\approx ${yPart}${dots}`
      )
    },
    paramMeta: p => {
      const N = Math.floor((p.length - 2) / 4)
      const metas: ParamMeta[] = [metaFor('c_x', p[0] ?? 0), metaFor('c_y', p[1] ?? 0)]
      for (let n = 1; n <= N; n++) {
        const o = 2 + (n - 1) * 4
        metas.push(
          metaFor(`a_{x${n}}`, p[o] ?? 0),
          metaFor(`b_{x${n}}`, p[o + 1] ?? 0),
          metaFor(`a_{y${n}}`, p[o + 2] ?? 0),
          metaFor(`b_{y${n}}`, p[o + 3] ?? 0),
        )
      }
      return metas
    },
    translate: (p, dx, dy) => {
      const out = p.slice()
      out[0] = (out[0] ?? 0) + dx
      out[1] = (out[1] ?? 0) + dy
      return out
    },
  },
}

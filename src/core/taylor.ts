// ============================================================================
// src/core/taylor.ts — Taylor and Maclaurin polynomials of a curve, their
// error bounds, and the interval of convergence of the series.
//
//   export function taylorSourceOf(curve, models): TaylorSource | null
//   export function taylorPolynomial(src, a, n): TaylorPoly | null
//   export function evalTaylor(poly, x): number
//   export function taylorModel(poly, modelId): ModelSpec
//   export function taylorLatex(poly): string
//   export function taylorText(poly): string
//   export function lagrangeBound(src, a, n, x): LagrangeBound | null
//   export function alternatingBound(src, a, n, x): number | null
//   export function errorBand(src, a, n, xs): Float64Array
//   export function convergence(src, a): Convergence | null
//
// THE COEFFICIENTS come from ModelSpec.taylor — Taylor-mode automatic
// differentiation over the typed formula (./parse/jets.ts): c[k] = f⁽ᵏ⁾(a)/k!
// to rounding, at any degree. Never finite differences: a 7th difference is
// noise, and the BC classroom asks for P₉ of sin x.
//
// A SKETCHED curve (a library family: poly3, sine, exp …) has no formula of
// its own. src/ui/calcLinks.ts turns it into one (curveEquationText →
// parseExpression) and hands the parsed model to taylorSourceOf; core may not
// import from src/ui, which is why the source is an explicit object.
//
// THE INTERVAL OF CONVERGENCE is read off the coefficients themselves, the way
// a BC student is taught to — the root test on c[k] for the radius, then the
// two endpoint series by the p-series / alternating series tests on their
// terms:
//   radius R      1/limsup |c_k|^{1/k}, fitted over the nonzero c_k for
//                 k ∈ [K_LO, TAYLOR_ROC_DEGREE] (log|c_k| against k is a line
//                 of slope −ln R; superlinear decay — k ln k — is R = ∞, the
//                 entire functions e^x, sin, cos, polynomials). Snapped with
//                 exactForm when it is a nice number (1, 2, π/2, √2).
//   endpoints     t_k = c_k (±R)^k. |t_k| fitted as C·k^{−p}:
//                   p ≲ 0          terms do not → 0          diverges
//                   p > 1          absolutely                converges
//                   0 < p ≤ 1      alternating & decreasing  conditional
//                                  one sign                  diverges
//                   anything else                            unknown
//   So ln(1+x) at 0 is (−1, 1], arctan x is [−1, 1], 1/(1−x) is (−1, 1),
//   √(1+x) is [−1, 1], e^x is (−∞, ∞).
//
// THE ERROR. The Lagrange bound |f(x) − Pₙ(x)| ≤ M |x − a|^{n+1} / (n+1)!,
// M = max |f⁽ⁿ⁺¹⁾(t)| for t between a and x — f⁽ⁿ⁺¹⁾(t) = (n+1)! · c_{n+1}(t),
// one jet per sampled t, maximised over a fine sample of [a, x] and refined
// around the largest. And, where the series at x alternates with decreasing
// terms from degree n+1 on, the alternating series bound: the first omitted
// nonzero term. Both are the AP free-response questions.
//
// Pure TypeScript: no DOM, no imports from src/ui. Owned by the core agent.
// ============================================================================

import type { FittedCurve, ModelSpec } from './types'
import type { ExactForm } from './exact'
import { exactForm } from './exact'

/** The degree slider's range (the card clamps to it; so does the loader). */
export const TAYLOR_N_MIN = 0
export const TAYLOR_N_MAX = 30
export const TAYLOR_N_DEFAULT = 3
/** The degree the radius and endpoint tests read coefficients up to. */
export const TAYLOR_ROC_DEGREE = 64

/** What Taylor needs of a curve: its values, its jets, and where it lives. */
export interface TaylorSource {
  /** f(x); NaN where undefined */
  f(x: number): number
  /** c[0…n] at a (ModelSpec.taylor with the curve's params), or null */
  jet(a: number, n: number): number[] | null
  /** the curve's drawn domain, or null for all of ℝ */
  domain: [number, number] | null
  /**
   * Optional: where the formula is undefined within `range` (sorted) — poles,
   * and holes like sin(x)/x at 0. A point whose jet exists is a removable
   * hole; one whose jet is null is a pole. With it, the bounds and the radius
   * know exactly where a pole is; without it they fall back to reading the
   * coefficients (see derivAt). taylorSourceOf fills it from
   * ModelSpec.singularities.
   */
  singularities?(range: [number, number]): number[]
}

/** Pₙ about a. */
export interface TaylorPoly {
  a: number
  n: number
  /** c[0…n]; a coefficient within rounding of 0 is exactly 0 */
  coeffs: number[]
  /** each coefficient as a closed form when it is one (1/6, √3/2, −π/4), else null */
  exact: (ExactForm | null)[]
  /** a itself as a closed form (π/6), else null */
  exactA: ExactForm | null
}

export interface LagrangeBound {
  /** max |f⁽ⁿ⁺¹⁾(t)| for t between a and x */
  M: number
  /** the t where it is attained */
  argMax: number
  /** M |x − a|^{n+1} / (n+1)! */
  bound: number
}

/** 'converges' is absolute convergence; 'conditional' is conditional. */
export type EndBehavior = 'converges' | 'conditional' | 'diverges' | 'unknown'

export interface Convergence {
  /** radius; Infinity for an entire function */
  R: number
  exactR: ExactForm | null
  /** a − R and a + R (±Infinity when R is) */
  lo: number
  hi: number
  /** behaviour at a − R and a + R; 'unknown' never becomes a bracket */
  left: EndBehavior
  right: EndBehavior
  /** interval notation, Unicode: "(−1, 1]", "(−∞, ∞)", "[π/2 − 1, π/2 + 1)" */
  text: string
  /** the same in KaTeX */
  tex: string
}

// ============================================================================
// Tuning
// ============================================================================

/** True minus, U+2212. */
const MINUS = '−'
const SUP_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹'
const SUB_DIGITS = '₀₁₂₃₄₅₆₇₈₉'

/**
 * A coefficient this small against its neighbours (k ± 1, k ± 2) is rounding
 * of a zero: cos about 2π has c₁ = −sin(2π) = 2.4e-16. Neighbours rather than
 * the largest coefficient, because 1/(1 − x) about 0.9 has c₃₀ = 10³¹ and a
 * perfectly real c₀ = 10.
 */
const ZERO_REL = 1e-13

/**
 * Closed forms of the coefficients are matched this tightly (relative): the
 * jets carry ~1e-15, so a genuine 1/5040 fits to the last few bits and a
 * decimal like e/5040 has no business being called a fraction.
 */
const EXACT_TOL = 1e-12
/** An exact coefficient's integer part (numerator) is at most this. */
const EXACT_MAX_NUM = 1e5

/** Denominators above this are written with factorials: x¹¹/11!. */
const FACTORIAL_FROM = 1e6

/** The first degree the radius and endpoint fits read. */
const K_LO = 16

/** The radius and endpoint fits read the largest |c_k| of each block this long. */
const CREST_BLOCK = 6
/** A tail that follows one smooth curve to this rms (in ln) is "smooth". */
const SMOOTH_RMS = 1e-3
/** A tail below the head by this factor (at the fitted R) is rounding noise. */
const NOISE_FLOOR = 1e-9

/** Radius snapping: relative agreement with a simple closed form. */
const R_SNAP_TOL = 1e-5

/** Lagrange: samples of [a, x] and golden-section refinement steps. */
const LAGRANGE_SAMPLES = 96
const LAGRANGE_REFINE = 40

// ============================================================================
// Small helpers
// ============================================================================

const clampN = (n: number): number =>
  Math.min(TAYLOR_N_MAX, Math.max(TAYLOR_N_MIN, Math.round(n)))

function inDomain(src: TaylorSource, x: number): boolean {
  const d = src.domain
  return !d || (x >= Math.min(d[0], d[1]) && x <= Math.max(d[0], d[1]))
}

function factorial(k: number): number {
  let f = 1
  for (let i = 2; i <= k; i++) f *= i
  return f
}

function bigFactorial(k: number): bigint {
  let f = 1n
  for (let i = 2n; i <= BigInt(k); i++) f *= i
  return f
}

function bigGcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a
  let y = b < 0n ? -b : b
  while (y > 0n) {
    const t = x % y
    x = y
    y = t
  }
  return x
}

const sup = (k: number): string => String(k).split('').map(d => SUP_DIGITS[Number(d)]).join('')
const sub = (k: number): string => String(k).split('').map(d => SUB_DIGITS[Number(d)]).join('')

/** 4 significant digits for text; exponent form outside [1e-4, 1e6). */
function decText(v: number): string {
  const s = decParts(v)
  const m = s.mant.replace('-', MINUS)
  if (s.exp === null) return m
  const e = s.exp < 0 ? '⁻' + sup(-s.exp) : sup(s.exp)
  return `${m}×10${e}`
}

function decTex(v: number): string {
  const s = decParts(v)
  return s.exp === null ? s.mant : `${s.mant}\\cdot 10^{${s.exp}}`
}

function decParts(v: number): { mant: string; exp: number | null } {
  const av = Math.abs(v)
  if (av === 0 || (av >= 1e-4 && av < 1e6)) return { mant: String(Number(v.toPrecision(4)) + 0), exp: null }
  const [m, e] = v.toExponential(3).split('e')
  return { mant: String(Number(m)), exp: Number(e) }
}

/**
 * Zero the coefficients that are rounding of a zero (see ZERO_REL). `raw`
 * may be longer than the result: the extra terms are neighbours to compare
 * with, then dropped.
 */
function cleanCoeffs(raw: readonly number[], n: number): number[] {
  const out = new Array<number>(n + 1)
  for (let k = 0; k <= n; k++) {
    const c = raw[k]
    let nb = 0
    for (let d = -2; d <= 2; d++) {
      if (d === 0) continue
      const j = k + d
      if (j >= 0 && j < raw.length) nb = Math.max(nb, Math.abs(raw[j]))
    }
    out[k] = Math.abs(c) <= ZERO_REL * nb ? 0 : c
  }
  return out
}

// ============================================================================
// Exact coefficients
//
// A coefficient is sign · num · head / den with num, den integers (BigInt,
// since 20! is past 2⁵³) and head 1, √n, π, or a compound (a ± b√n) — the
// shapes a BC answer key prints. Three ways in, most direct first:
//   1. exactForm(|c|) itself (1/6, √3/2, 5/128, (1+√5)/4 …) at EXACT_TOL;
//   2. |c| · M a small integer (≤ EXACT_MAX_NUM) times 1, √2 or √3, for M in
//      {1, k, k!} × {2^j, 3^j} — this is how 1/5040, √3/240, 1/(2^k k!),
//      429/2048 and 1/2^{k+1} are read at any degree. The numerator is kept
//      small on purpose: a random decimal comes within 1e-12 of SOME fraction
//      with a big numerator, but of one with a small numerator and one of
//      these denominators only by a coincidence of ~1e-7;
//   3. exactForm(|c| · k!) — the derivative f⁽ᵏ⁾(a) itself as a closed form
//      ((√6 − √2)/4 for sin about π/12), then divided by k!.
// ============================================================================

interface Head {
  text: string
  tex: string
  value: number
  /** a sum (1+√5): parenthesised when multiplied */
  compound: boolean
}

interface Coef {
  sign: 1 | -1
  num: bigint
  den: bigint
  head: Head | null
}

const SQRT_HEADS: Head[] = [2, 3].map(n => ({
  text: '√' + n,
  tex: `\\sqrt{${n}}`,
  value: Math.sqrt(n),
  compound: false,
}))

function makeCoef(sign: 1 | -1, num: bigint, den: bigint, head: Head | null): Coef {
  const g = bigGcd(num, den)
  return { sign, num: num / g, den: den / g, head }
}

/** Parse one of exactForm's positive outputs back into num · head / den. */
function parseForm(f: ExactForm): { num: bigint; den: bigint; head: Head | null } | null {
  const tex = f.tex
  let m: RegExpMatchArray | null
  if ((m = tex.match(/^(\d+)$/))) return { num: BigInt(m[1]), den: 1n, head: null }
  if ((m = tex.match(/^\\frac\{(\d+)\}\{(\d+)\}$/))) return { num: BigInt(m[1]), den: BigInt(m[2]), head: null }
  const sqrtHead = (n: string): Head => ({ text: '√' + n, tex: `\\sqrt{${n}}`, value: Math.sqrt(Number(n)), compound: false })
  const piHead: Head = { text: 'π', tex: '\\pi', value: Math.PI, compound: false }
  if ((m = tex.match(/^(\d*)\\sqrt\{(\d+)\}$/))) return { num: BigInt(m[1] || '1'), den: 1n, head: sqrtHead(m[2]) }
  if ((m = tex.match(/^\\frac\{(\d*)\\sqrt\{(\d+)\}\}\{(\d+)\}$/))) {
    return { num: BigInt(m[1] || '1'), den: BigInt(m[3]), head: sqrtHead(m[2]) }
  }
  if ((m = tex.match(/^(\d*)\\pi$/))) return { num: BigInt(m[1] || '1'), den: 1n, head: piHead }
  if ((m = tex.match(/^\\frac\{(\d*)\\pi\}\{(\d+)\}$/))) return { num: BigInt(m[1] || '1'), den: BigInt(m[2]), head: piHead }
  const quad = (a: string, s: string, b: string, n: string): Head => {
    const bb = b === '' ? 1 : Number(b)
    const A = Number(a)
    const text = (A < 0 ? MINUS + String(-A) : String(A)) + (s === '+' ? '+' : MINUS) + (bb === 1 ? '' : String(bb)) + '√' + n
    return {
      text,
      tex: `${A}${s}${bb === 1 ? '' : bb}\\sqrt{${n}}`,
      value: A + (s === '+' ? 1 : -1) * bb * Math.sqrt(Number(n)),
      compound: true,
    }
  }
  if ((m = tex.match(/^\\frac\{(-?\d+)([+-])(\d*)\\sqrt\{(\d+)\}\}\{(\d+)\}$/))) {
    return { num: 1n, den: BigInt(m[5]), head: quad(m[1], m[2], m[3], m[4]) }
  }
  if ((m = tex.match(/^(-?\d+)([+-])(\d*)\\sqrt\{(\d+)\}$/))) {
    return { num: 1n, den: 1n, head: quad(m[1], m[2], m[3], m[4]) }
  }
  return null
}

function tightForm(v: number): ExactForm | null {
  return exactForm(v, { tol: EXACT_TOL * Math.min(1, Math.abs(v)) })
}

interface Mult {
  /** the multiplier in double precision */
  v: number
  /** 1, k or k! */
  base: 0 | 1 | 2
  /** a power of 2 (p = 2) or of 3 (p = 3), exponent e */
  p: 2 | 3
  e: number
}

const MULTS: Mult[][] = []

/** The multipliers of family 2 for degree k: {1, k, k!} × {2^j, 3^j}. */
function multipliers(k: number): Mult[] {
  const cached = MULTS[k]
  if (cached) return cached
  const out: Mult[] = []
  const bases: [number, 0 | 1 | 2][] = [[1, 0]]
  if (k >= 2) bases.push([k, 1], [factorial(k), 2])
  for (const [bv, base] of bases) {
    for (let e = 0; e <= 2 * k + 2; e++) out.push({ v: bv * 2 ** e, base, p: 2, e })
    for (let e = 1; e <= k + 1; e++) out.push({ v: bv * 3 ** e, base, p: 3, e })
  }
  MULTS[k] = out
  return out
}

function multBig(m: Mult, k: number): bigint {
  const b = m.base === 0 ? 1n : m.base === 1 ? BigInt(k) : bigFactorial(k)
  return b * BigInt(m.p) ** BigInt(m.e)
}

function recognise(c: number, k: number): Coef | null {
  if (c === 0) return { sign: 1, num: 0n, den: 1n, head: null }
  const sign: 1 | -1 = c < 0 ? -1 : 1
  const v = Math.abs(c)

  // 1. the coefficient itself
  const f1 = tightForm(v)
  if (f1) {
    const p = parseForm(f1)
    if (p) return makeCoef(sign, p.num, p.den, p.head)
  }

  // 2. a small integer (times √2, √3) over a structured denominator
  for (const head of [null, ...SQRT_HEADS]) {
    const hv = head ? head.value : 1
    for (const m of multipliers(k)) {
      const w = (v * m.v) / hv
      if (!(w >= 0.5) || w > EXACT_MAX_NUM + 0.5) continue
      const W = Math.round(w)
      if (Math.abs(w - W) <= EXACT_TOL * w) return makeCoef(sign, BigInt(W), multBig(m, k), head)
    }
  }

  // 3. the derivative f⁽ᵏ⁾(a) = k! c_k as a closed form
  if (k >= 2) {
    const d = v * factorial(k)
    if (d <= EXACT_MAX_NUM && d >= 1 / EXACT_MAX_NUM) {
      const f3 = tightForm(d)
      if (f3) {
        const p = parseForm(f3)
        if (p) return makeCoef(sign, p.num, p.den * bigFactorial(k), p.head)
      }
    }
  }
  return null
}

function coefValue(q: Coef): number {
  return (q.sign * Number(q.num) * (q.head ? q.head.value : 1)) / Number(q.den)
}

/** The coefficient as an ExactForm, in exact.ts's style ("−√3/240"). */
function coefForm(q: Coef): ExactForm {
  const value = coefValue(q)
  if (q.num === 0n) return { text: '0', tex: '0', value: 0 }
  const s = q.sign < 0
  let numText: string
  let numTex: string
  if (q.head) {
    const n = q.num === 1n ? '' : String(q.num)
    numText = n + q.head.text
    numTex = n + q.head.tex
  } else {
    numText = String(q.num)
    numTex = String(q.num)
  }
  if (q.den === 1n) {
    return { text: (s ? MINUS : '') + numText, tex: (s ? '-' : '') + numTex, value }
  }
  const nt = q.head?.compound ? `(${numText})` : numText
  return {
    text: (s ? MINUS : '') + nt + '/' + String(q.den),
    tex: (s ? '-' : '') + `\\frac{${numTex}}{${String(q.den)}}`,
    value,
  }
}

// ============================================================================
// Source and polynomial
// ============================================================================

/**
 * The Taylor source of a curve whose model offers `taylor` (every typed
 * explicit expression). Null for anything else — the UI builds one for a
 * sketched family from its equation text.
 */
export function taylorSourceOf(curve: FittedCurve, models: Record<string, ModelSpec>): TaylorSource | null {
  if (!curve || curve.kind !== 'explicit') return null
  const spec = models[curve.modelId]
  if (!spec || spec.kind !== 'explicit' || !spec.taylor || !spec.evalExplicit) return null
  const taylor = spec.taylor.bind(spec)
  const evalExplicit = spec.evalExplicit.bind(spec)
  const params = curve.params
  const domain = curve.domain ? ([curve.domain[0], curve.domain[1]] as [number, number]) : null
  // f is the curve as drawn: NaN at a hole (sin(x)/x at 0), although the
  // jet — and so Pₙ, whose c₀ is the limit there — exists
  const src: TaylorSource = {
    f: (x: number) => (inDomain(src, x) ? evalExplicit(params, x) : Number.NaN),
    jet: (a: number, n: number) => (inDomain(src, a) ? taylor(params, a, n) : null),
    domain,
  }
  if (spec.singularities) {
    const sing = spec.singularities.bind(spec)
    src.singularities = (range: [number, number]) => sing(params, range).filter(x => inDomain(src, x))
  }
  return src
}

// ============================================================================
// Jets near a hole
//
// sin(x)/x is entire, but its jet at t ≠ 0 is sin · (1/x): every coefficient
// is a difference of terms of size |t|^{−k}, and at t = 0.01 the 5th is
// already noise. At the hole itself the cancellation is exact (jets.ts shifts
// the common zero out), so near a hole the jet is taken THERE, to high
// degree, and re-expanded at t by the Taylor shift
//     c_k(t) = Σ_{j ≥ k} W_j C(j, k) (t − s)^{j−k}.
// Both ways lose digits at the same rate when |t − s| is half the quotient's
// own radius (≈ ((1 + x)/(1 − x))^k against ((1 + x)/x)^k, x = |t − s|/R), so
// the shift is used inside that and the direct jet outside it.
// ============================================================================

/** How far past the interval a hole is still looked for. */
const HOLE_REACH = 16
/** Re-expand from a hole when |t − s| < HOLE_SHIFT · (the quotient's radius there). */
const HOLE_SHIFT = 0.5
/** The degree a hole's jet is taken to: 2n + HOLE_EXTRA (≤ HOLE_MAX_DEG). */
const HOLE_EXTRA = 80
const HOLE_MAX_DEG = 240

interface Hole {
  s: number
  W: number[]
  R: number
}

/** The jets of a source over [lo, hi], and the poles it knows of there. */
interface Jetter {
  jet(t: number, n: number): number[] | null
  /** non-removable singularities in [lo − HOLE_REACH, hi + HOLE_REACH], sorted */
  poles: number[]
}

/** 1/limsup |W_j|^{1/j}, read over the top of the jet (∞ when it is all 0). */
function tailRadius(W: number[]): number {
  let R = Infinity
  const top = W.length - 1
  for (let j = Math.max(1, top - 24); j <= top; j++) {
    const w = Math.abs(W[j])
    if (w > 0 && Number.isFinite(w)) R = Math.min(R, Math.pow(w, -1 / j))
  }
  return R
}

/** c[0…n] of Σ W_j (x − s)^j re-expanded about s + d (repeated synthetic division). */
function taylorShift(W: number[], d: number, n: number): number[] {
  const b = W.slice()
  const N = b.length - 1
  for (let i = 0; i <= n && i <= N; i++) {
    for (let j = N - 1; j >= i; j--) b[j] += d * b[j + 1]
  }
  return b.slice(0, n + 1)
}

function jetter(src: TaylorSource, lo: number, hi: number, nMax: number): Jetter {
  const holes: Hole[] = []
  const poles: number[] = []
  if (src.singularities && Number.isFinite(lo) && Number.isFinite(hi)) {
    let sing: number[] = []
    try {
      sing = src.singularities([lo - HOLE_REACH, hi + HOLE_REACH])
    } catch {
      sing = []
    }
    const deg = Math.min(HOLE_MAX_DEG, 2 * nMax + HOLE_EXTRA)
    for (const s of sing) {
      if (!Number.isFinite(s)) continue
      if (!src.jet(s, 2)) {
        poles.push(s)
        continue
      }
      const W = src.jet(s, deg)
      if (W && W.every(Number.isFinite)) holes.push({ s, W, R: tailRadius(W) })
    }
    poles.sort((x, y) => x - y)
  }
  return {
    poles,
    jet(t: number, n: number): number[] | null {
      if (!inDomain(src, t)) return null
      let best: Hole | null = null
      let bestQ = HOLE_SHIFT
      for (const h of holes) {
        const q = Math.abs(t - h.s) / h.R
        if (q < bestQ || (q === 0 && !best)) {
          best = h
          bestQ = q
        }
      }
      if (best && n < best.W.length) return taylorShift(best.W, t - best.s, n)
      return src.jet(t, n)
    },
  }
}

/**
 * Pₙ about a, or null when a is outside the domain or f is not analytic
 * there. n is clamped to [TAYLOR_N_MIN, TAYLOR_N_MAX] and integerised.
 */
export function taylorPolynomial(src: TaylorSource, a: number, n: number): TaylorPoly | null {
  if (!Number.isFinite(a) || !Number.isFinite(n)) return null
  if (!inDomain(src, a)) return null
  const N = clampN(n)
  // two extra terms: the neighbours the zero test reads for c_{n−1}, c_n
  const raw = jetter(src, a, a, N + 2).jet(a, N + 2)
  if (!raw || raw.length < N + 1) return null
  for (const c of raw) if (!Number.isFinite(c)) return null
  const coeffs = cleanCoeffs(raw, N)
  const exact: (ExactForm | null)[] = []
  for (let k = 0; k <= N; k++) {
    const q = recognise(coeffs[k], k)
    if (q) {
      exact.push(coefForm(q))
      coeffs[k] = coefValue(q)
    } else {
      exact.push(null)
    }
  }
  return { a, n: N, coeffs, exact, exactA: a === 0 ? { text: '0', tex: '0', value: 0 } : tightForm(a) }
}

/** Pₙ(x), by Horner in (x − a). */
export function evalTaylor(poly: TaylorPoly, x: number): number {
  const h = x - poly.a
  const c = poly.coeffs
  let s = 0
  for (let k = c.length - 1; k >= 0; k--) s = s * h + c[k]
  return s
}

/**
 * Pₙ as a curve: an explicit model with no params, named "Taylor polynomial",
 * whose latex is taylorLatex(poly), registered by the caller under modelId.
 */
export function taylorModel(poly: TaylorPoly, modelId: string): ModelSpec {
  return {
    id: modelId,
    kind: 'explicit',
    name: 'Taylor polynomial',
    evalExplicit: (_p, x) => evalTaylor(poly, x),
    latex: () => taylorLatex(poly),
    paramMeta: () => [],
  }
}

// ============================================================================
// Writing Pₙ
// ============================================================================

/** a as it is written inside (x − a): its magnitude, in text and tex. */
function centreParts(a: number, exactA: ExactForm | null): { text: string; tex: string } {
  const av = Math.abs(a)
  if (Number.isInteger(av)) return { text: String(av), tex: String(av) }
  // a decimal the teacher typed (0.5, 1.25) stays a decimal
  if (Number(av.toFixed(3)) === av) return { text: String(av), tex: String(av) }
  const f = exactA ? (a < 0 ? tightForm(av) : exactA) : null
  if (f) {
    const t = f.text.startsWith(MINUS) ? f.text.slice(1) : f.text
    const x = f.tex.startsWith('-') ? f.tex.slice(1) : f.tex
    return { text: t, tex: x }
  }
  return { text: decText(av), tex: decTex(av) }
}

interface Written {
  /** negative? (becomes the minus between terms) */
  neg: boolean
  text: string
  tex: string
}

function writeTerms(poly: TaylorPoly): Written[] {
  const { a, coeffs } = poly
  const centre = a === 0 ? null : centreParts(a, poly.exactA)
  const op = a > 0 ? '-' : '+'
  const opText = a > 0 ? MINUS : '+'
  const powTex = (k: number): string => {
    if (k === 0) return ''
    if (!centre) return k === 1 ? 'x' : `x^{${k}}`
    const base = `\\left(x ${op} ${centre.tex}\\right)`
    return k === 1 ? base : `${base}^{${k}}`
  }
  const powText = (k: number): string => {
    if (k === 0) return ''
    if (!centre) return k === 1 ? 'x' : 'x' + sup(k)
    const base = `(x ${opText} ${centre.text})`
    return k === 1 ? base : base + sup(k)
  }

  const coefs: (Coef | null)[] = poly.coeffs.map((c, k) => (poly.exact[k] ? recognise(c, k) : null))
  // factorials: when one denominator is past FACTORIAL_FROM and is m·k!,
  // every such denominator is written m·k! (x − x³/3! + x⁵/5! − …)
  let factorialMode = false
  for (let k = 2; k < coefs.length; k++) {
    const q = coefs[k]
    if (q && q.num !== 0n && q.den > BigInt(FACTORIAL_FROM) && q.den % bigFactorial(k) === 0n) factorialMode = true
  }
  const denParts = (q: Coef, k: number): { text: string; tex: string; paren: boolean } => {
    if (factorialMode && k >= 2 && q.den % bigFactorial(k) === 0n) {
      // a denominator that IS a factorial is written as one: sin(x)/x has
      // x²/3!, not x²/(3·2!)
      for (let j = k; j <= k + 12; j++) {
        const f = bigFactorial(j)
        if (f === q.den) return { text: `${j}!`, tex: `${j}!`, paren: false }
        if (f > q.den) break
      }
      const m = q.den / bigFactorial(k)
      return m === 1n
        ? { text: `${k}!`, tex: `${k}!`, paren: false }
        : { text: `${m}·${k}!`, tex: `${m}\\cdot ${k}!`, paren: true }
    }
    return { text: String(q.den), tex: String(q.den), paren: false }
  }

  const out: Written[] = []
  for (let k = 0; k < coeffs.length; k++) {
    const c = coeffs[k]
    if (c === 0) continue
    const q = coefs[k]
    const P = powTex(k)
    const Pt = powText(k)
    if (!q) {
      // a decimal: 4 significant digits
      const mag = Math.abs(c)
      if (k === 0) out.push({ neg: c < 0, text: decText(mag), tex: decTex(mag) })
      else if (mag === 1) out.push({ neg: c < 0, text: Pt, tex: P })
      else out.push({ neg: c < 0, text: decText(mag) + Pt, tex: decTex(mag) + P })
      continue
    }
    const neg = q.sign < 0
    const D = denParts(q, k)
    const hasDen = q.den !== 1n
    const denText = D.paren ? `(${D.text})` : D.text
    if (!q.head) {
      const N = q.num === 1n && k > 0 ? '' : String(q.num)
      if (!hasDen) {
        out.push({ neg, text: N + Pt, tex: N + P })
      } else {
        // a fraction bar is its own bracket: \frac{x - 1}{2}, not \frac{(x - 1)}{2}
        const top = centre && k === 1 && N === '' ? `x ${op} ${centre.tex}` : N + P
        out.push({ neg, text: `${N}${Pt}/${denText}`, tex: `\\frac{${top}}{${D.tex}}` })
      }
      continue
    }
    // a surd, π or compound numerator: the coefficient, then the power
    const n = q.num === 1n ? '' : String(q.num)
    const hText = n + q.head.text
    const hTexRaw = n + q.head.tex
    const hTex = q.head.compound && k > 0 && !hasDen ? `\\left(${hTexRaw}\\right)` : hTexRaw
    const sep = k > 0 && /[a-zA-Z]$/.test(hTex) ? ' ' : ''
    if (!hasDen) {
      const t = k === 0 ? hText : q.head.compound ? `(${hText})${Pt}` : centre ? hText + Pt : `${hText}·${Pt}`
      out.push({ neg, text: t, tex: hTex + sep + P })
    } else {
      const inner = q.head.compound ? `(${hText})/${denText}` : `${hText}/${denText}`
      out.push({
        neg,
        text: k === 0 ? inner : `(${inner})${Pt}`,
        tex: `\\frac{${hTexRaw}}{${D.tex}}${P}`,
      })
    }
  }
  return out
}

function joinTerms(terms: Written[], useTex: boolean): string {
  if (terms.length === 0) return '0'
  let s = ''
  terms.forEach((t, i) => {
    const body = useTex ? t.tex : t.text
    if (i === 0) s += t.neg ? (useTex ? '-' : MINUS) + body : body
    else s += (t.neg ? (useTex ? ' - ' : ` ${MINUS} `) : ' + ') + body
  })
  return s
}

/**
 * "P_{3}(x) = x - \frac{x^{3}}{6}" — terms in increasing degree, zero terms
 * omitted, exact coefficients where they are exact (decimals otherwise, as
 * the rest of the app prints them), powers of (x − a) with a in exact form
 * ("\left(x - \frac{\pi}{6}\right)^{2}"), "x" alone when a = 0. P_n(x) = 0
 * when every coefficient is 0.
 */
export function taylorLatex(poly: TaylorPoly): string {
  return `P_{${poly.n}}(x) = ${joinTerms(writeTerms(poly), true)}`
}

/** The same in plain Unicode for the card: "P₃(x) = x − x³/6". */
export function taylorText(poly: TaylorPoly): string {
  return `P${sub(poly.n)}(x) = ${joinTerms(writeTerms(poly), false)}`
}

// ============================================================================
// Error bounds
// ============================================================================


/**
 * |f⁽ᵐ⁾(t)| and how far from t the nearest singularity may be: the ratio
 * |c_{m−1}/c_m|, |c_m/c_{m+1}| — exactly the distance for a simple pole,
 * less for a higher one, ∞ for a polynomial.
 */
function derivAt(J: Jetter, t: number, m: number): { v: number; r: number } {
  const j = J.jet(t, m + 1)
  if (!j || j.length <= m + 1 || !j.every(Number.isFinite)) return { v: Number.NaN, r: 0 }
  const ratio = (p: number, q: number) => (q === 0 ? Infinity : Math.abs(p / q))
  const r = Math.max(ratio(j[m], j[m + 1]), m >= 1 ? ratio(j[m - 1], j[m]) : 0)
  return { v: Math.abs(j[m]) * factorial(m), r }
}

/**
 * Could a singularity lie between two samples? Each sample's radius (see
 * derivAt) is at most its distance to the nearest singularity, so a pole
 * strictly between them leaves BOTH radii shorter than the gap; a pole on the
 * far side of one of them leaves the other's radius longer than the gap.
 */
function gapTooWide(t1: number, r1: number, t2: number, r2: number): boolean {
  const h = Math.abs(t2 - t1)
  return h > 0 && r1 < h && r2 < h
}

/** |h|^m / m!, as a product so neither side overflows. */
function powOverFact(h: number, m: number): number {
  let s = 1
  const ah = Math.abs(h)
  for (let k = 1; k <= m; k++) s *= ah / k
  return s
}

/**
 * The largest value of g seen by a golden-section search of [l, r] (g is
 * unimodal there when called on a sample's neighbours). NaNs are ignored.
 */
function goldenMax(g: (t: number) => number, l: number, r: number, steps: number): { t: number; v: number } {
  let best = { t: l, v: -Infinity }
  if (!(r > l)) return best
  const phi = (Math.sqrt(5) - 1) / 2
  let x1 = r - phi * (r - l)
  let x2 = l + phi * (r - l)
  let f1 = g(x1)
  let f2 = g(x2)
  const see = (t: number, v: number) => {
    if (v > best.v) best = { t, v }
  }
  see(x1, f1)
  see(x2, f2)
  for (let it = 0; it < steps && r - l > 1e-15 * Math.max(1, Math.abs(l)); it++) {
    if (!(f1 <= f2)) {
      r = x2
      x2 = x1
      f2 = f1
      x1 = r - phi * (r - l)
      f1 = g(x1)
      see(x1, f1)
    } else {
      l = x1
      x1 = x2
      f1 = f2
      x2 = l + phi * (r - l)
      f2 = g(x2)
      see(x2, f2)
    }
  }
  return best
}

/** The Lagrange error bound at x (see the header), or null. */
export function lagrangeBound(src: TaylorSource, a: number, n: number, x: number): LagrangeBound | null {
  if (![a, n, x].every(Number.isFinite)) return null
  if (!inDomain(src, a) || !inDomain(src, x)) return null
  const m = clampN(n) + 1
  const lo = Math.min(a, x)
  const hi = Math.max(a, x)
  const J = jetter(src, lo, hi, m + 1)
  // a pole the source names, anywhere on [a, x]: no bound (a hole is fine —
  // its jet exists, and f⁽ⁿ⁺¹⁾ there is the limit)
  if (J.poles.some(p => p >= lo && p <= hi)) return null
  const g = (t: number): number => derivAt(J, t, m).v
  const g0 = g(a)
  if (!Number.isFinite(g0)) return null
  if (lo === hi) return { M: g0, argMax: a, bound: 0 }

  const S = LAGRANGE_SAMPLES
  const ts: number[] = []
  const gs: number[] = []
  let best = 0
  let prevR = 0
  for (let i = 0; i <= S; i++) {
    const t = i === S ? hi : lo + ((hi - lo) * i) / S
    const d = derivAt(J, t, m)
    // not n + 1 times differentiable somewhere between: no Lagrange bound
    if (!Number.isFinite(d.v)) return null
    if (i > 0 && gapTooWide(ts[i - 1], prevR, t, d.r)) return null
    ts.push(t)
    gs.push(d.v)
    prevR = d.r
    if (d.v > gs[best]) best = i
  }
  let M = gs[best]
  let argMax = ts[best]
  // golden-section refinement of the maximum between the neighbouring samples
  const peak = goldenMax(g, ts[Math.max(0, best - 1)], ts[Math.min(S, best + 1)], LAGRANGE_REFINE)
  if (peak.v > M) {
    M = peak.v
    argMax = peak.t
  }
  if (!Number.isFinite(M)) return null
  return { M, argMax, bound: M * powOverFact(x - a, m) }
}

/**
 * The alternating series bound at x — |first omitted nonzero term| — when the
 * terms c_k (x − a)^k for k > n alternate in sign and decrease in size (read
 * over k ≤ TAYLOR_ROC_DEGREE); null otherwise.
 */
export function alternatingBound(src: TaylorSource, a: number, n: number, x: number): number | null {
  if (![a, n, x].every(Number.isFinite)) return null
  if (!inDomain(src, a) || x === a) return null
  const N = clampN(n)
  const D = TAYLOR_ROC_DEGREE
  const raw = jetter(src, a, a, D + 2).jet(a, D + 2)
  if (!raw) return null
  const c = cleanCoeffs(raw, D)
  const h = x - a
  const terms: number[] = []
  let p = 1
  for (let k = 0; k <= D; k++) {
    if (k > N && c[k] !== 0) terms.push(c[k] * p)
    p *= h
  }
  if (terms.length < 2 || !terms.every(Number.isFinite)) return null
  for (let i = 1; i < terms.length; i++) {
    if (Math.sign(terms[i]) === Math.sign(terms[i - 1])) return null
    if (Math.abs(terms[i]) > Math.abs(terms[i - 1]) * (1 + 1e-12)) return null
  }
  // decreasing to degree 64 is not yet convergence (ln(1+x) at 1.01): x has
  // to lie in the interval of convergence
  const conv = convergence(src, a)
  if (!conv) return null
  const d = Math.abs(h)
  if (d > conv.R * (1 + 1e-12)) return null
  if (Math.abs(d - conv.R) <= 1e-12 * conv.R) {
    const end = h > 0 ? conv.right : conv.left
    if (end !== 'converges' && end !== 'conditional') return null
  }
  return Math.abs(terms[0])
}

/**
 * The Lagrange bound at every x of `xs` (sorted ascending), for the shaded
 * band Pₙ ± R(x) on the board; NaN where there is none. Must be cheap enough
 * for a slider drag at ~200 samples: the running maximum of |f⁽ⁿ⁺¹⁾| is swept
 * outward from a, one jet per sample, not recomputed per x.
 */
export function errorBand(src: TaylorSource, a: number, n: number, xs: readonly number[]): Float64Array {
  const out = new Float64Array(xs.length).fill(Number.NaN)
  if (!Number.isFinite(a) || !Number.isFinite(n) || !inDomain(src, a)) return out
  const m = clampN(n) + 1
  const finite = xs.filter(Number.isFinite)
  const J = jetter(src, Math.min(a, ...finite), Math.max(a, ...finite), m + 1)
  const d0 = derivAt(J, a, m)
  const g0 = d0.v
  if (!Number.isFinite(g0)) return out
  let first = 0
  while (first < xs.length && !(xs[first] >= a)) first++
  const g = (t: number): number => derivAt(J, t, m).v
  // the first pole the source names on either side of a: the band stops there
  const poleRight = J.poles.find(p => p > a) ?? Infinity
  const poleLeft = [...J.poles].reverse().find(p => p < a) ?? -Infinity
  // outward from a, one jet per sample; a crest of |f⁽ⁿ⁺¹⁾| that falls
  // between samples (|sin| at π/2) is refined once, where it is seen
  const sweep = (from: number, step: 1 | -1): void => {
    let run = g0
    let pT = a
    let pV = g0
    let ppT = Number.NaN
    let ppV = Number.NaN
    let pR = d0.r
    for (let i = from; i >= 0 && i < xs.length; i += step) {
      const x = xs[i]
      if (x >= poleRight || x <= poleLeft) break
      const d = derivAt(J, x, m)
      const v = d.v
      // past a pole (or a sample that straddles one) there is no bound
      if (!Number.isFinite(v) || gapTooWide(pT, pR, x, d.r)) break
      pR = d.r
      if (pV >= v && pV >= ppV) {
        const peak = goldenMax(g, Math.min(ppT, x), Math.max(ppT, x), 30)
        if (peak.v > run) run = peak.v
      }
      if (v > run) run = v
      out[i] = run * powOverFact(x - a, m)
      ppT = pT
      ppV = pV
      pT = x
      pV = v
    }
  }
  sweep(first, 1)
  sweep(first - 1, -1)
  return out
}

// ============================================================================
// Interval of convergence
// ============================================================================

/** Least squares by modified Gram–Schmidt; null when the basis is degenerate. */
function lstsq(A: number[][], y: number[]): { coef: number[]; rms: number } | null {
  const m = y.length
  const p = A[0]?.length ?? 0
  if (m < p + 1) return null
  // columns
  const Q: number[][] = []
  for (let j = 0; j < p; j++) Q.push(A.map(r => r[j]))
  const Rm: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0))
  for (let j = 0; j < p; j++) {
    for (let i = 0; i < j; i++) {
      let d = 0
      for (let r = 0; r < m; r++) d += Q[i][r] * Q[j][r]
      Rm[i][j] = d
      for (let r = 0; r < m; r++) Q[j][r] -= d * Q[i][r]
    }
    let nn = 0
    for (let r = 0; r < m; r++) nn += Q[j][r] * Q[j][r]
    nn = Math.sqrt(nn)
    if (!(nn > 1e-10)) return null
    Rm[j][j] = nn
    for (let r = 0; r < m; r++) Q[j][r] /= nn
  }
  const qy = Q.map(col => col.reduce((s, v, r) => s + v * y[r], 0))
  const coef = new Array<number>(p).fill(0)
  for (let j = p - 1; j >= 0; j--) {
    let s = qy[j]
    for (let i = j + 1; i < p; i++) s -= Rm[j][i] * coef[i]
    coef[j] = s / Rm[j][j]
  }
  let ss = 0
  for (let r = 0; r < m; r++) {
    const fit = A[r].reduce((s, v, j) => s + v * coef[j], 0)
    ss += (y[r] - fit) ** 2
  }
  return { coef, rms: Math.sqrt(ss / m) }
}

interface Pt { k: number; y: number }

const fitPts = (pts: Pt[], basis: (k: number) => number[]) =>
  lstsq(pts.map(p => basis(p.k)), pts.map(p => p.y))

/**
 * The limsup, not the average: the highest point of each block of
 * CREST_BLOCK consecutive degrees (counted down from the top), measured
 * against the trend ln|c_k| ≈ α − k ln R — re-estimated from the crests
 * themselves a few times, starting from the plain least-squares line. A
 * series whose coefficients oscillate (a complex pair of singularities,
 * 1/(1 + x²) about 1) is read along its crests; any block of 6 holds one.
 */
function crests(pts: Pt[], top: number): Pt[] {
  const line = (q: Pt[]) => fitPts(q, k => [1, k])
  let slope = line(pts)?.coef[1] ?? 0
  let out: Pt[] = []
  for (let it = 0; it < 4; it++) {
    out = []
    for (let hi = top; hi - CREST_BLOCK + 1 >= K_LO; hi -= CREST_BLOCK) {
      const lo = hi - CREST_BLOCK + 1
      let best: Pt | null = null
      for (const p of pts) {
        if (p.k < lo || p.k > hi) continue
        if (!best || p.y - slope * p.k > best.y - slope * best.k) best = p
      }
      if (best) out.push(best)
    }
    out.reverse()
    const s2 = out.length >= 3 ? line(out)?.coef[1] : undefined
    if (s2 === undefined || s2 === slope) break
    slope = s2
  }
  return out
}

// ln|c_k| against k. The smooth fits carry the 1/k, 1/k² corrections of the
// asymptotics (Stirling; binomial series), the crest fits only the shape.
const ENTIRE_SMOOTH = (k: number): number[] => [1, k, Math.log(k), k * Math.log(k), 1 / k]
const ENTIRE_CREST = (k: number): number[] => [1, k, k * Math.log(k)]
const FINITE_SMOOTH = (k: number): number[] => [1, k, Math.log(k), 1 / k, 1 / (k * k)]
const FINITE_CREST = (k: number): number[] => [1, k, Math.log(k)]
const END_SMOOTH = (k: number): number[] => [1, Math.log(k), 1 / k, 1 / (k * k)]
const END_CREST = (k: number): number[] => [1, Math.log(k)]

/** R as a simple closed form (p/q, pπ/q, √m/q) when the estimate is one. */
function snapRadius(R: number): ExactForm | null {
  const close = (v: number) => Math.abs(v - R) <= R_SNAP_TOL * R
  const cands: number[] = []
  for (let q = 1; q <= 12; q++) {
    const p = Math.round(R * q)
    if (p >= 1 && p <= 240) cands.push(p / q)
  }
  for (let q = 1; q <= 12; q++) {
    const p = Math.round((R * q) / Math.PI)
    if (p >= 1 && p <= 24) cands.push((p * Math.PI) / q)
  }
  for (let q = 1; q <= 6; q++) {
    const mm = Math.round((R * q) ** 2)
    if (mm >= 2 && mm <= 200 && !Number.isInteger(Math.sqrt(mm))) cands.push(Math.sqrt(mm) / q)
  }
  for (const v of cands) {
    if (!close(v)) continue
    const f = exactForm(v, { tol: 1e-13 })
    if (f) return f
  }
  return null
}

/**
 * The endpoint series Σ c_k (±R)^k: |t_k| fitted as C·k^{−p}, then the
 * nth-term test (p ≤ 0), absolute convergence (p > 1), and for 0 < p ≤ 1 the
 * alternating series test or a divergent p-series. Only a smooth tail — one
 * the fit follows to SMOOTH_RMS — is trusted near the thresholds; margins
 * round every threshold, and inside a margin the answer is 'unknown'.
 */
function endBehavior(c: number[], R: number, sign: 1 | -1, smooth: boolean): EndBehavior {
  const lnR = Math.log(R)
  const pts: Pt[] = []
  const terms: number[] = []
  for (let k = K_LO; k < c.length; k++) {
    if (c[k] === 0) continue
    pts.push({ k, y: Math.log(Math.abs(c[k])) + k * lnR })
    terms.push(c[k] * (sign < 0 && k % 2 === 1 ? -1 : 1))
  }
  if (pts.length < 6) return 'unknown'
  const use = smooth ? pts : crests(pts, c.length - 1)
  if (use.length < 4) return 'unknown'
  const fit = fitPts(use, smooth ? END_SMOOTH : END_CREST)
  if (!fit) return 'unknown'
  const p = -fit.coef[1]
  // terms that do not go to 0: the nth-term test
  if (p <= 0.05) return 'diverges'
  // |t_k| ≤ C k^{−p} with p > 1: absolute convergence by comparison
  if (p >= 1.1) return 'converges'
  if (!smooth || fit.rms > SMOOTH_RMS) return 'unknown'
  let alternating = true
  let oneSign = true
  let decreasing = true
  for (let i = 1; i < terms.length; i++) {
    if (Math.sign(terms[i]) === Math.sign(terms[i - 1])) alternating = false
    else oneSign = false
    if (Math.abs(terms[i]) > Math.abs(terms[i - 1]) * (1 + 1e-9)) decreasing = false
  }
  if (oneSign && p <= 1.02) return 'diverges' // a p-series with p ≤ 1 (the harmonic series)
  if (alternating && decreasing && p >= 0.1 && p <= 1.02) return 'conditional'
  return 'unknown'
}

function endpointText(v: number, exactA: ExactForm | null, exactR: ExactForm | null, a: number, side: 1 | -1): { text: string; tex: string } {
  if (!Number.isFinite(v)) {
    return v > 0 ? { text: '∞', tex: '\\infty' } : { text: MINUS + '∞', tex: '-\\infty' }
  }
  if (v === 0) return { text: '0', tex: '0' }
  const f = tightForm(v)
  if (f) return { text: f.text, tex: f.tex }
  if (exactR && (exactA || a === 0 || Number.isInteger(a))) {
    const A = exactA ?? { text: String(a).replace('-', MINUS), tex: String(a) }
    if (a === 0) {
      return side < 0 ? { text: MINUS + exactR.text, tex: '-' + exactR.tex } : { text: exactR.text, tex: exactR.tex }
    }
    return side < 0
      ? { text: `${A.text} ${MINUS} ${exactR.text}`, tex: `${A.tex} - ${exactR.tex}` }
      : { text: `${A.text} + ${exactR.text}`, tex: `${A.tex} + ${exactR.tex}` }
  }
  return { text: decText(v), tex: decTex(v) }
}

/** The interval of convergence of the Taylor series about a, or null. */
export function convergence(src: TaylorSource, a: number): Convergence | null {
  if (!Number.isFinite(a) || !inDomain(src, a)) return null
  const D = TAYLOR_ROC_DEGREE
  const J = jetter(src, a, a, D + 2)
  const raw = J.jet(a, D + 2)
  if (!raw || raw.length < D + 1) return null
  for (const v of raw) if (!Number.isFinite(v)) return null
  const c = cleanCoeffs(raw, D)

  const pts: Pt[] = []
  for (let k = K_LO; k <= D; k++) if (c[k] !== 0) pts.push({ k, y: Math.log(Math.abs(c[k])) })

  const entire = (): Convergence => ({
    R: Infinity,
    exactR: null,
    lo: -Infinity,
    hi: Infinity,
    left: 'converges',
    right: 'converges',
    text: `(${MINUS}∞, ∞)`,
    tex: '\\left(-\\infty, \\infty\\right)',
  })

  // a polynomial: every coefficient from K_LO to D is 0
  if (pts.length === 0) return entire()
  if (pts.length < 6) return null

  // smooth tail (every point on one curve) or oscillating (read its crests)
  const entAll = fitPts(pts, ENTIRE_SMOOTH)
  const smooth = !!entAll && entAll.rms < SMOOTH_RMS
  const use = smooth ? pts : crests(pts, D)
  if (use.length < 6) return null

  // superlinear decay of ln|c_k| (−k ln k: 1/k!) is an entire function
  const ent = smooth ? entAll : fitPts(use, ENTIRE_CREST)
  if (!ent) return null
  const delta = ent.coef[smooth ? 3 : 2]
  // the source's own poles: the nearest real one bounds R exactly
  const dPole = J.poles.reduce((d, p) => Math.min(d, Math.abs(p - a)), Infinity)
  if (delta < -0.1) return Number.isFinite(dPole) ? null : entire() // a pole contradicts it
  if (delta < -0.03 || delta > 0.1) return null // neither reading is clean: say nothing

  const fin = fitPts(use, smooth ? FINITE_SMOOTH : FINITE_CREST)
  if (!fin) return null
  // |c_k| R^k ~ k^γ: a pole of order m has γ = m − 1; a γ past this is not a
  // singularity, it is the fit failing
  if (!(Math.abs(fin.coef[2]) <= 12)) return null
  const Rest = Math.exp(-fin.coef[1])
  if (!Number.isFinite(Rest) || !(Rest > 0)) return null
  let exactR = fin.rms < 1e-4 ? snapRadius(Rest) : null
  let R = exactR ? exactR.value : Rest
  // a named pole at (or inside) the fitted distance IS the radius, to the
  // last bit: 1/(x − 0.37) about 0 has R = 0.37, not the fit's 0.3700001
  if (dPole <= Rest * (1 + 1e-3)) {
    R = dPole
    exactR = snapRadius(dPole) ?? tightForm(dPole)
    if (exactR && Math.abs(exactR.value - dPole) > 1e-12 * dPole) exactR = tightForm(dPole)
  }

  // Rounding, not a singularity: a cancellation the source does not name as a
  // hole. sin(x)/x about 0.7 read directly (no singularities) is sin · (1/x),
  // and past the degree where the true coefficients sink below
  // ε · 0.7^{−k} the tail is 1/x's rounding growing at 1/x's rate. A genuine
  // singularity keeps |c_k| R^k within a power of k of the head's.
  const lnR = Math.log(R)
  let head = -Infinity
  let tail = -Infinity
  for (let k = 0; k <= D; k++) {
    if (c[k] === 0) continue
    const v = Math.log(Math.abs(c[k])) + k * lnR
    if (k < K_LO) head = Math.max(head, v)
    else tail = Math.max(tail, v)
  }
  if (head > -Infinity && tail < head + Math.log(NOISE_FLOOR)) return null

  const left = endBehavior(c, R, -1, smooth)
  const right = endBehavior(c, R, 1, smooth)
  const exactA = a === 0 ? { text: '0', tex: '0', value: 0 } : tightForm(a)
  const lo = a - R
  const hi = a + R
  const L = endpointText(lo, exactA, exactR, a, -1)
  const H = endpointText(hi, exactA, exactR, a, 1)
  const closed = (b: EndBehavior) => b === 'converges' || b === 'conditional'
  const lb = closed(left) ? '[' : '('
  const rb = closed(right) ? ']' : ')'
  return {
    R,
    exactR,
    lo,
    hi,
    left,
    right,
    text: `${lb}${L.text}, ${H.text}${rb}`,
    tex: `\\left${lb}${L.tex}, ${H.tex}\\right${rb}`,
  }
}

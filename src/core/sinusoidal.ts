// ============================================================================
// Sinusoidal functions, the way a precalculus class states them
// (src/core/sinusoidal.ts)
//
//     y = a·sin(b(x − h)) + k        or        y = a·cos(b(x − h)) + k
//
//   |a| amplitude (a < 0 reflects), b the angular frequency, period 2π/|b|,
//   h the phase (horizontal) shift, k the midline y = k.
//
// Sibling of src/core/exponential.ts / logarithmic.ts / factored.ts: a spec
// becomes a TYPED EXPRESSION and goes through the ordinary parser, so the
// analysis (zeros, extrema, inflections — with exact forms like π/4), the
// π-scaled axes, intersections, end caps and the exam figures all apply.
//
// PARSER (additive, same wave, core agent): sec, csc, cot (with their poles
// as singular sources, like tan), and the names arcsin, arccos, arctan as
// aliases of asin, acos, atan — plus sin^2(x)-style powers ONLY if the
// parser can do it without ambiguity (say what you decide).
//
//   export function sinSource(spec): string
//       canonical parseable source: "y = 3sin(2(x - pi/4)) + 1",
//       "y = -cos(x)", "f(x) = 2sin(pi/6 x) - 4" (b written as the teacher
//       gave it: 2, pi/6, 1/2), "y = sin(x + pi/3)" when b = 1.
//   export function readSinusoid(src): SinSpec | null
//       the inverse for any typed a·sin(u) + k / a·cos(u) + k with u linear
//       in x — including sin(2x - pi/2) (h = π/4), cos(3x) + 1, 4 - 2sin(x),
//       and u = (2π/P)(x − h) with P given; verified numerically; null
//       otherwise (sin(x²), sin x + cos x — say whether a·sin + b·cos is
//       folded into one sinusoid: it is one, and the textbook asks for it).
//   export function sinFeatures(spec): SinFeatures
//   export function sinFromParts(p): SinSpec
//       amplitude, period, phase shift, midline (+ which function, and
//       "starts at a maximum / minimum / midline going up / going down",
//       which chooses sin/cos and the sign of a as a textbook does).
//   export function sinFromExtrema(max, min): SinSpec | null
//       an adjacent maximum and minimum point → amplitude, midline, period
//       (twice their x-distance), phase — as cos starting at the max.
//   export function rewriteAs(spec, fn): SinSpec
//       the same function written with the other of sin/cos (shift h by a
//       quarter period), or with a positive a (shift by half a period).
// ============================================================================

export type SinFn = 'sin' | 'cos'

export interface SinSpec {
  /** The function's name when typed as f(x) = …; absent for y = … */
  name?: string
  fn: SinFn
  /** Signed amplitude as written ("3", "-1/2"). */
  a: string
  /** Angular frequency as written ("2", "pi/6", "1/2"); period 2π/|b|. */
  b: string
  /** Phase shift as written ("pi/4", "-1", "0"). */
  h: string
  /** Midline as written. */
  k: string
}

export type SinStart = 'max' | 'min' | 'mid-up' | 'mid-down'

export interface SinFeatures {
  amplitude: number
  period: number
  frequency: number
  phaseShift: number
  midline: number
  max: number
  min: number
  /** "−2 ≤ y ≤ 4" */
  range: string
  /**
   * The five key points of the cycle that starts at x = h: start, quarter,
   * half, three quarters, end — with exact text when the numbers are nice
   * multiples of π ("π/4") and the kind of each point.
   */
  keyPoints: { x: number; y: number; xText: string; yText: string; kind: 'max' | 'min' | 'mid' }[]
  /** Teacher sentences: "amplitude 3", "period π", "phase shift π/4 right",
   *  "midline y = 1", "range −2 ≤ y ≤ 4". */
  sentences: string[]
}

// TODO(core agent): implement.
export function sinSource(_spec: SinSpec): string {
  return 'y = 0'
}

export function readSinusoid(_src: string): SinSpec | null {
  return null
}

export function sinFeatures(_spec: SinSpec): SinFeatures {
  return {
    amplitude: 0, period: 0, frequency: 0, phaseShift: 0, midline: 0,
    max: 0, min: 0, range: '', keyPoints: [], sentences: [],
  }
}

export function sinFromParts(p: {
  amplitude: string
  period: string
  phase: string
  midline: string
  start?: SinStart
  fn?: SinFn
}): SinSpec {
  return { fn: p.fn ?? 'sin', a: p.amplitude, b: '1', h: p.phase, k: p.midline }
}

export function sinFromExtrema(
  _max: { x: number; y: number },
  _min: { x: number; y: number },
): SinSpec | null {
  return null
}

export function rewriteAs(spec: SinSpec, _fn: SinFn, _positiveA = false): SinSpec {
  return spec
}

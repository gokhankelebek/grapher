// ============================================================================
// Exponential functions, the way a precalculus class states them
// (src/core/exponential.ts)
//
//     y = a·b^((x − h)/p) + k
//
//   a  initial value (the value at x = h when k = 0), "starts at 200"
//   b  growth factor per p units: 1.05 grows 5%, 1/2 halves, 2 doubles
//   p  the period b applies over: "per year" p = 1, "halves every 5.7" p = 5.7
//   h  horizontal shift, k the horizontal asymptote y = k
//
// Like the factored form, everything visible is still a TYPED EXPRESSION:
// a spec becomes source text and goes through the ordinary parser, so the
// horizontal asymptote, intercepts, exact forms, intersections, end caps and
// the exam figures all apply unchanged. This module is the bridge between
// that text and the quantities a teacher states — including every way of
// stating the rate.
//
//   export function expSource(spec): string
//       spec → canonical parseable source: "y = 200(1/2)^(x/5.7) + 10",
//       "y = 3(1.05)^x", "f(x) = -2(3)^(x - 1) - 4", "y = 5e^(0.2x)"
//       (base e written as e^(r·x) — see ExpSpec.base). Numbers keep the text
//       the teacher gave them.
//   export function readExponential(src): ExpSpec | null
//       the inverse for any typed explicit expression of the shape
//       a·b^(linear in x) + k (also e^(…), b^x·a, a/b^x, and 2^(x+3) with the
//       shift folded into a or h as the canonical form chooses); null for
//       anything else. Must round-trip expSource.
//   export function rateOf(spec): ExpRate
//       every reading of the rate at once: growth factor per 1 unit,
//       percent change per unit ("grows 5.00% per unit", "decays 50.0% per
//       5.7 units"), continuous rate r = ln(b)/p, and the doubling time or
//       half-life (whichever applies), each numeric and as a sentence.
//   export function expFromTwoPoints(p1, p2, k = 0): ExpSpec | null
//       the exponential through two points with asymptote y = k; null when
//       the points are on opposite sides of k, on it, or share an x.
//   export function expFromRate(init, rate, k = 0): ExpSpec
//       build from an initial value and one statement of the rate (see
//       RateStatement): a factor, a percent, a doubling time, a half-life,
//       a continuous rate.
//   export function expFeatures(spec): ExpFeatures
//       y-intercept, horizontal asymptote, increasing/decreasing, concavity,
//       domain/range sentences, end behaviour — the card's summary.
// ============================================================================

export interface ExpSpec {
  /** The function's name when typed as f(x) = …; absent for y = … */
  name?: string
  /** Initial value multiplier, as written ("200", "-3", "1/2"). */
  a: string
  /**
   * The base as written ("1.05", "1/2", "3"). The string "e" means the
   * natural base, and then `rate` is the continuous rate and p is 1.
   */
  b: string
  /** Continuous rate r for base e (y = a·e^(r(x − h)) + k). */
  rate?: string
  /** Period of the base, default "1". */
  p: string
  /** Horizontal shift, default "0". */
  h: string
  /** Horizontal asymptote, default "0". */
  k: string
}

export type RateStatement =
  | { kind: 'factor'; b: string; per?: string } // b per `per` units
  | { kind: 'percent'; pct: string; grows: boolean; per?: string } // 5% per year
  | { kind: 'doubling'; time: string }
  | { kind: 'half-life'; time: string }
  | { kind: 'continuous'; r: string } // y = a·e^(rx)

export interface ExpRate {
  /** Growth factor per one unit of x. */
  perUnit: number
  /** Percent change per one unit, signed (+5 grows, −50 decays). */
  percentPerUnit: number
  /** Continuous rate ln(b)/p. */
  continuous: number
  /** Doubling time when growing, else null. */
  doubling: number | null
  /** Half-life when decaying, else null. */
  halfLife: number | null
  /** Teacher sentences, true minus signs, ≤ 4 significant digits. */
  sentences: string[]
}

export interface ExpFeatures {
  yIntercept: number | null
  asymptote: number
  increasing: boolean
  concaveUp: boolean
  /** "all real numbers", "y > 10", "y < −4" */
  domain: string
  range: string
  endBehaviour: string
}

// TODO(core agent): implement.
export function expSource(_spec: ExpSpec): string {
  return 'y = 0'
}

export function readExponential(_src: string): ExpSpec | null {
  return null
}

export function rateOf(_spec: ExpSpec): ExpRate {
  return { perUnit: 1, percentPerUnit: 0, continuous: 0, doubling: null, halfLife: null, sentences: [] }
}

export function expFromTwoPoints(
  _p1: { x: number; y: number },
  _p2: { x: number; y: number },
  _k = 0,
): ExpSpec | null {
  return null
}

export function expFromRate(_init: string, _rate: RateStatement, _k = '0'): ExpSpec {
  return { a: _init, b: '1', p: '1', h: '0', k: _k }
}

export function expFeatures(_spec: ExpSpec): ExpFeatures {
  return {
    yIntercept: null,
    asymptote: 0,
    increasing: true,
    concaveUp: true,
    domain: 'all real numbers',
    range: '',
    endBehaviour: '',
  }
}

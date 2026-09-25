// ============================================================================
// Logarithmic functions, the way a precalculus class states them
// (src/core/logarithmic.ts)
//
//     y = a·log_b(c(x − h)) + k          (c defaults to 1)
//
//   b  the base: any b > 0, b ≠ 1; "e" is ln, "10" is the common log
//   a  vertical stretch/reflection, c horizontal scale (c < 0 reflects the
//      graph across x = h, so the domain becomes x < h)
//   h  the vertical asymptote x = h;  k the vertical shift
//
// Sibling of src/core/exponential.ts and src/core/factored.ts: a spec becomes
// a TYPED EXPRESSION and goes through the ordinary parser, so the vertical
// asymptote (a pole of ln), intercepts, exact forms, intersections, end caps,
// natural-domain endpoints and the exam figures all apply unchanged.
//
// PARSER (additive, same wave, core agent): arbitrary bases are typed as
//     log_3(x), log_(1/2)(x - 1), log_b(x) with a slider b, log_10(x)
// evaluate as ln(arg)/ln(base), render as \log_{3}\left(x\right), and join
// the existing ln/log/log2/log10 as singular arguments. log(x) stays log₁₀,
// log2/log10 keep working.
//
//   export function logSource(spec): string
//       canonical parseable source: "y = log_3(x)", "y = 2ln(x - 1) + 4",
//       "f(x) = -log_(1/2)(2(x + 3)) - 1", "y = log(x)" for base 10.
//   export function readLogarithmic(src): LogSpec | null
//       the inverse for any typed explicit a·log_b(linear in x) + k,
//       including ln, log, log2, log10, log_b, ln(x)/ln(3) (change of base,
//       read as base 3), log(x^2)?? — no: only a linear argument; null for
//       anything else. Verified numerically against the typed formula.
//   export function logFeatures(spec): LogFeatures
//   export function logFromTwoPoints(p1, p2, h = 0, b = 'e'): LogSpec | null
//       through two points with asymptote x = h in the given base (solves a
//       and k); null when a point is on the wrong side of the asymptote or
//       the two share an x.
//   export function logAsInverse(exp: ExpSpec): LogSpec
//   export function expAsInverse(log: LogSpec): ExpSpec
//       the inverse function, exactly: y = a·b^((x − h)/p) + k ⇄
//       y = p·log_b((x − k)/a) + h.
//   export function rebase(spec, base): LogSpec
//       the same function in another base (change of base folds 1/ln(b) into
//       a): "ln" ⇄ "log" ⇄ log_2 … for the card's "write in base" switch.
// ============================================================================

import type { ExpSpec } from './exponential'

export interface LogSpec {
  /** The function's name when typed as f(x) = …; absent for y = … */
  name?: string
  /** Vertical stretch, as written ("1", "-2", "1/2"). */
  a: string
  /** The base as written: "e" (ln), "10" (log), "2", "1/2", "3". */
  b: string
  /** Horizontal scale inside the log, default "1". */
  c: string
  /** Vertical asymptote x = h, default "0". */
  h: string
  /** Vertical shift, default "0". */
  k: string
}

export interface LogFeatures {
  /** x = h */
  asymptote: number
  /** "x > 3" or "x < 3" */
  domain: string
  /** always "all real numbers" */
  range: string
  xIntercept: number | null
  yIntercept: number | null
  /** The point where the argument is 1 — (h + 1/c, k) — the anchor. */
  anchor: { x: number; y: number }
  /** The point where the argument is b — (h + b/c, k + a). */
  basePoint: { x: number; y: number }
  increasing: boolean
  concaveUp: boolean
  endBehaviour: string
  /** Teacher sentences: "vertical asymptote x = 1", "passes through (2, 4)
   *  and (4, 6)", "log₂ x = ln x / ln 2". */
  sentences: string[]
}

// TODO(core agent): implement.
export function logSource(_spec: LogSpec): string {
  return 'y = 0'
}

export function readLogarithmic(_src: string): LogSpec | null {
  return null
}

export function logFeatures(_spec: LogSpec): LogFeatures {
  return {
    asymptote: 0,
    domain: 'x > 0',
    range: 'all real numbers',
    xIntercept: null,
    yIntercept: null,
    anchor: { x: 1, y: 0 },
    basePoint: { x: Math.E, y: 1 },
    increasing: true,
    concaveUp: false,
    endBehaviour: '',
    sentences: [],
  }
}

export function logFromTwoPoints(
  _p1: { x: number; y: number },
  _p2: { x: number; y: number },
  _h = 0,
  _b = 'e',
): LogSpec | null {
  return null
}

export function logAsInverse(_exp: ExpSpec): LogSpec {
  return { a: '1', b: 'e', c: '1', h: '0', k: '0' }
}

export function expAsInverse(_log: LogSpec): ExpSpec {
  return { a: '1', b: 'e', p: '1', h: '0', k: '0', rate: '1' }
}

export function rebase(spec: LogSpec, _base: string): LogSpec {
  return spec
}

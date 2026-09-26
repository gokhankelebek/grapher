// ============================================================================
// Transformations of parent functions (src/core/transform.ts)
//
//     y = a·f(b(x − h)) + k
//
// The Math 3 / Precalculus way of reading a function: which PARENT it comes
// from, and what was done to it — in words, in order, and point by point.
//
//   a  vertical stretch (|a| > 1) / compression (|a| < 1); a < 0 reflects
//      across the x-axis
//   b  horizontal compression (|b| > 1) / stretch (|b| < 1) by 1/|b|; b < 0
//      reflects across the y-axis
//   h  horizontal shift (right when h > 0);  k  vertical shift (up when k > 0)
//
// Like every sibling (factored, exponential, logarithmic, sinusoidal) a spec
// becomes a TYPED EXPRESSION and goes through the ordinary parser.
//
//   export const PARENTS: ParentFn[]
//       the parent library: linear x, quadratic x², cubic x³, absolute |x|,
//       square root √x, cube root ∛x, reciprocal 1/x, reciprocal squared
//       1/x², exponential 2^x and e^x, logarithmic log₂ x and ln x, sin x,
//       cos x, tan x, greatest integer ⌊x⌋ — each with its source body in x,
//       its key points (the ones a textbook table lists: for x² (−2,4),
//       (−1,1), (0,0), (1,1), (2,4); for √x (0,0), (1,1), (4,2), (9,3) …),
//       its domain/range sentences and asymptotes.
//   export function transformSource(spec): string
//       "y = -2(x - 3)^2 + 1", "y = |x + 2| - 3", "y = sqrt(-(x - 1))",
//       "y = 3/(x - 2) + 1", "f(x) = -2^(x + 1) + 4" … canonical, parseable,
//       reading like a textbook (b folded where the textbook folds it:
//       sqrt(2x), |3x|, (2x)^2 — never (2(x - 0))^2).
//   export function readTransform(src): TransformSpec | null
//       the inverse: which parent, and a, b, h, k — for ANY typed explicit
//       curve that is one: -2(x-3)^2+1, 3|x|, |2x-6|+1 (b = 2, h = 3),
//       sqrt(4-x) (b = −1, h = 4), 1/(x+2) - 3, (x-1)^3, -x^2, 2^(x-1)+3,
//       cbrt(8x) … Ambiguities have a canonical answer, documented:
//       (2x)² = 4x² (a = 4 or b = 2? — choose b only when the teacher wrote
//       it inside); a quadratic in standard form (x² − 6x + 8) is read in
//       vertex form (completing the square) — a teacher asks exactly that.
//       Verified numerically; null for anything that is not one parent.
//   export function describe(spec): TransformStep[]
//       the transformations in the order a textbook applies them
//       (horizontal: shift inside first? — use the standard order
//       "reflect/stretch, then shift": b, then h, then a, then k), each as
//       a sentence: "horizontal compression by a factor of 1/2",
//       "reflection across the x-axis", "vertical stretch by a factor of 2",
//       "shift right 3", "shift up 1"; identity steps omitted.
//   export function mapPoints(spec): { from: Vec2; to: Vec2 }[]
//       each parent key point and its image (x/b + h, a·y + k), with exact
//       text for both (π multiples, fractions).
//   export function transformFeatures(spec): TransformFeatures
//       domain, range, asymptotes, vertex / centre / anchor point by parent.
// ============================================================================

import type { Vec2 } from './types'

export type ParentId =
  | 'linear'
  | 'quadratic'
  | 'cubic'
  | 'absolute'
  | 'sqrt'
  | 'cbrt'
  | 'reciprocal'
  | 'reciprocal2'
  | 'exp2'
  | 'expe'
  | 'log2'
  | 'ln'
  | 'sin'
  | 'cos'
  | 'tan'
  | 'floor'

export interface ParentFn {
  id: ParentId
  /** "Quadratic", "Square root", … */
  name: string
  /** The body in x as typed: "x^2", "sqrt(x)", "|x|", "1/x", "2^x". */
  body: string
  /** KaTeX of y = f(x). */
  latex: string
  keyPoints: { x: number; y: number; xText: string; yText: string }[]
  domain: string
  range: string
  /** e.g. "x = 0, y = 0" for 1/x; "" when none. */
  asymptotes: string
  /** What the special point is called: "vertex", "centre", "anchor". */
  anchorName: string
}

export interface TransformSpec {
  name?: string
  parent: ParentId
  /** As written: "1", "-2", "1/2". */
  a: string
  b: string
  h: string
  k: string
}

export interface TransformStep {
  kind: 'reflect-x' | 'reflect-y' | 'v-stretch' | 'v-compress' | 'h-stretch' | 'h-compress' | 'shift-h' | 'shift-v'
  sentence: string
}

export interface TransformFeatures {
  domain: string
  range: string
  asymptotes: string
  anchor: { name: string; x: number; y: number; xText: string; yText: string } | null
}

// TODO(core agent): implement.
export const PARENTS: ParentFn[] = []

export function transformSource(_spec: TransformSpec): string {
  return 'y = 0'
}

export function readTransform(_src: string): TransformSpec | null {
  return null
}

export function describe(_spec: TransformSpec): TransformStep[] {
  return []
}

export function mapPoints(_spec: TransformSpec): { from: Vec2; to: Vec2; fromText: [string, string]; toText: [string, string] }[] {
  return []
}

export function transformFeatures(_spec: TransformSpec): TransformFeatures {
  return { domain: '', range: '', asymptotes: '', anchor: null }
}

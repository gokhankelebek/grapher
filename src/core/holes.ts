// ============================================================================
// Holes and vertical asymptotes (src/core/holes.ts)
//
//   export function findHoles(curve, models, range): Hole[]
//   export function findPoles(curve, models, range): number[]
//
// A HOLE is a removable discontinuity: the formula is undefined at x0 but the
// two one-sided limits exist, are finite and agree — (x²−1)/(x−1) at (1, 2),
// sin(x)/x at (0, 1), or an explicit exclusion `{x != 2}` on a curve that is
// fine there. A POLE is where |f| grows without bound on at least one side —
// a vertical asymptote. Candidates come from ModelSpec.singularities (typed
// expressions); library families have none except `recip` (a pole at x = b)
// and are answered from the family, not by sampling.
//
// Classification is by VALUE, never by slope, exactly as the end-cap rule in
// src/render/endCaps.ts: sample f at x0 ± h for h stepping down by 10 from
// 1e-3·scale to 1e-8·scale; the side converges when its last three values
// agree within max(1e-6·|f|, 1e-9·scale); a hole needs both sides to converge
// to the same value (within that tolerance); a side that keeps growing marks
// a pole. `exact` is true when x0 came from an explicit exclusion or a
// closed-form root; the y of a hole is the limit, so it is never exact.
//
// Pure TypeScript, no DOM. Consumers: analyzeCurve (lists holes as
// SpecialPoints of kind 'hole'), the renderer (open ring at each hole in
// every figure style; dashed asymptotes under the marked styles).
// ============================================================================

import type { FittedCurve, ModelSpec } from './types'

export interface Hole {
  x: number
  /** the two-sided limit */
  y: number
  /** true when x came from an explicit exclusion or a closed-form root */
  exact: boolean
}

// TODO(core agent): implement. Stubbed so the render/App half can compile.
export function findHoles(
  _curve: FittedCurve,
  _models: Record<string, ModelSpec>,
  _range: [number, number],
): Hole[] {
  return []
}

export function findPoles(
  _curve: FittedCurve,
  _models: Record<string, ModelSpec>,
  _range: [number, number],
): number[] {
  return []
}

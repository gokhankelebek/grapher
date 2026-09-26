// ============================================================================
// Parametric and polar curves, the AP Calculus BC way (src/core/motion.ts)
//
//   parametric   x = x(t), y = y(t),  a ≤ t ≤ b      a particle in the plane
//   polar        r = r(θ),            α ≤ θ ≤ β
//
// PARSER (additive, same wave — src/core/parse/index.ts): typed parametric
// curves, which the app cannot enter today. Accept, in t:
//     (2cos(t), 3sin(t))                 a bare ordered pair of t-expressions
//     (x, y) = (t^2, t^3 - 3t)           with the (x, y) = head
//     x = 2cos(t), y = 3sin(t)           two equations
//     … {0 <= t <= 2pi}  /  for 0 <= t <= 2pi   the t-interval (default
//                                        [0, 2π] for trig, [−10, 10] else)
//   → kind 'parametric', evalParametric(params, t), domain = the t-interval,
//   LaTeX as a pair \left(2\cos t,\ 3\sin t\right),\ 0\le t\le 2\pi. Sliders
//   work as everywhere. Polar lines keep parsing as today (r = …, θ-range).
//   Nothing that parses today may change.
//
// CALCULUS — pure functions over a curve and its model:
//   export function paramState(curve, models, t): ParamState
//       position, velocity ⟨x′, y′⟩, speed, acceleration ⟨x″, y″⟩, dy/dx =
//       y′/x′ (null when x′ = 0: vertical tangent), d²y/dx², the tangent
//       line — all at parameter t (for a polar curve, t is θ and x = r cos θ,
//       y = r sin θ, with dr/dθ too).
//   export function paramFeatures(curve, models): ParamFeatures
//       over the curve's parameter interval: horizontal tangents (y′ = 0,
//       x′ ≠ 0), vertical tangents (x′ = 0, y′ ≠ 0), singular points (both
//       0), where the particle is at rest, start and end points and the
//       direction of motion, arc length ∫√(x′² + y′²) dt, total distance
//       travelled vs displacement; for polar: points at the pole (r = 0),
//       max |r|, and the enclosed area ½∫r² dθ over the interval — each with
//       exact text where exact.ts recognises it.
//   export function polarArea(curve, models, a, b): { value, exact, text }
//       ½∫ₐᵇ r(θ)² dθ — the AP polar area, numeric with exact recognition.
//   export function paramArcLength(curve, models, a, b): number
//
// BUILDERS — families a teacher names:
//   export const PARAM_FAMILIES: ParamFamily[]
//       line through two points, circle, ellipse, cycloid, Lissajous, the
//       projectile (x = v₀cos α·t, y = h + v₀sin α·t − ½gt²), involute —
//       each with named parameters, defaults and a source template.
//   export const POLAR_FAMILIES: ParamFamily[]
//       rose a·cos(kθ) / a·sin(kθ) (petal count: k odd → k, even → 2k),
//       limaçon a + b·cos θ (inner loop when |a| < |b|, cardioid when
//       |a| = |b|, dimpled / convex otherwise), circle r = a·cos θ / a·sin θ,
//       lemniscate r² = a²cos 2θ (as r = a·sqrt(cos(2θ))), Archimedean
//       spiral a·θ, each with its classification sentence.
//   export function familySource(family, values): string
//   export function describePolar(src): string | null
//       "a rose with 3 petals, each of length 2", "a limaçon with an inner
//       loop", "a cardioid" — for any typed polar line that is one.
// ============================================================================

import type { FittedCurve, ModelSpec, Vec2 } from './types'

export interface ParamState {
  t: number
  pos: Vec2
  velocity: Vec2
  speed: number
  acceleration: Vec2
  /** dy/dx = y′/x′; null at a vertical tangent. */
  slope: number | null
  /** d²y/dx²; null where undefined. */
  concavity: number | null
  /** polar only: r and dr/dθ at θ = t. */
  r?: number
  drdt?: number
}

export interface Labeled {
  t: number
  x: number
  y: number
  tText: string
  xText: string
  yText: string
}

export interface ParamFeatures {
  interval: [number, number]
  start: Labeled | null
  end: Labeled | null
  horizontalTangents: Labeled[]
  verticalTangents: Labeled[]
  /** Both derivatives zero (a cusp or a stop). */
  singular: Labeled[]
  arcLength: number
  /** Polar: θ where r = 0. */
  atPole: Labeled[]
  /** Polar: ½∫r²dθ over the interval (null for parametric). */
  area: { value: number; exact: boolean; text: string } | null
  sentences: string[]
}

export interface ParamFamily {
  id: string
  name: string
  kind: 'parametric' | 'polar'
  /** Named parameters with defaults, as text. */
  params: { name: string; label: string; value: string }[]
  /** Default interval as text, e.g. ['0', '2pi']. */
  interval: [string, string]
}

// TODO(core agent): implement.
export function paramState(_curve: FittedCurve, _models: Record<string, ModelSpec>, t: number): ParamState {
  return { t, pos: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, speed: 0, acceleration: { x: 0, y: 0 }, slope: null, concavity: null }
}

export function paramFeatures(_curve: FittedCurve, _models: Record<string, ModelSpec>): ParamFeatures {
  return {
    interval: [0, 0], start: null, end: null, horizontalTangents: [], verticalTangents: [],
    singular: [], arcLength: 0, atPole: [], area: null, sentences: [],
  }
}

export function polarArea(
  _curve: FittedCurve,
  _models: Record<string, ModelSpec>,
  _a: number,
  _b: number,
): { value: number; exact: boolean; text: string } | null {
  return null
}

export function paramArcLength(_curve: FittedCurve, _models: Record<string, ModelSpec>, _a: number, _b: number): number {
  return 0
}

export const PARAM_FAMILIES: ParamFamily[] = []
export const POLAR_FAMILIES: ParamFamily[] = []

export function familySource(_family: ParamFamily, _values: Record<string, string>, _interval?: [string, string]): string {
  return ''
}

export function describePolar(_src: string): string | null {
  return null
}

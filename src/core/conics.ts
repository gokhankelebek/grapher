// ============================================================================
// Conic sections, the way Math 3 / Precalculus states them (src/core/conics.ts)
//
//   circle      (x − h)² + (y − k)² = r²
//   ellipse     (x − h)²/a² + (y − k)²/b² = 1          (either axis major)
//   hyperbola   (x − h)²/a² − (y − k)²/b² = 1           (opens left/right)
//               (y − k)²/a² − (x − h)²/b² = 1           (opens up/down)
//   parabola    (x − h)² = 4p(y − k)   (opens up/down)
//               (y − k)² = 4p(x − h)   (opens left/right)
//
// Like every sibling module (factored, exponential, logarithmic, sinusoidal,
// transform, piecewise), a spec becomes a TYPED EXPRESSION — here an
// IMPLICIT equation the parser already plots — so the curve is an ordinary
// typed curve; this module is the bridge to the quantities a teacher states,
// and the source of the figure's construction lines (foci, directrix,
// asymptotes, the hyperbola's box).
//
//   export function conicSource(spec): string
//       standard form, parseable: "(x - 2)^2/9 + (y + 1)^2/4 = 1",
//       "(x - 1)^2 + y^2 = 16", "(y - 3)^2/16 - x^2/9 = 1",
//       "(x + 2)^2 = 8(y - 1)", "y^2 = -12x".
//   export function readConic(src): ConicSpec | null
//       any typed conic in STANDARD form, and in GENERAL form
//       Ax² + Cy² + Dx + Ey + F = 0 (completing the square — the classic
//       exercise), axis-aligned; B·xy ≠ 0 → null here (see classify).
//       Degenerate cases (a point, two lines, no graph) → null with a
//       reason from classify. Verified numerically.
//   export function classify(src): ConicClass
//       the discriminant test for ANY general quadratic in x and y, incl.
//       a rotated one (B ≠ 0): circle / ellipse / parabola / hyperbola /
//       degenerate, with the rotation angle θ = ½·atan(B/(A − C)) and a
//       sentence ("B² − 4AC = −16 < 0: an ellipse, rotated 26.57°").
//   export function conicFeatures(spec): ConicFeatures
//       center, vertices, co-vertices, foci, directrix, asymptotes, the
//       hyperbola's fundamental rectangle, eccentricity, the lengths of the
//       axes and the latus rectum — numbers and exact text (√5, 2 + √13).
//   builders — each returns a spec or a refusal reason:
//     conicFromCircle(center, radius | pointOnCircle)
//     conicFromEllipse({center, vertex, focus? | coVertex? | e?})
//     conicFromHyperbola({center, vertex, focus? | asymptoteSlope? | e?})
//     conicFromParabola({vertex, focus} | {focus, directrix} | {vertex, point, opens})
//     conicFromFoci(f1, f2, {sum} | {difference})   the locus definitions
// ============================================================================

import type { Vec2 } from './types'

export type ConicKind = 'circle' | 'ellipse' | 'hyperbola' | 'parabola'

export interface ConicSpec {
  kind: ConicKind
  /** Center (vertex, for a parabola), as written. */
  h: string
  k: string
  /** circle: r; ellipse: semi-axis along x; hyperbola: the transverse semi-axis. */
  a: string
  /** ellipse: semi-axis along y; hyperbola: the conjugate semi-axis. Unused otherwise. */
  b?: string
  /** hyperbola/parabola: which way it opens. Ellipse: absent (a, b say). */
  opens?: 'x' | 'y'
  /** parabola: the focal parameter p (signed: negative opens down/left). */
  p?: string
}

export interface ConicClass {
  kind: ConicKind | 'degenerate' | 'none'
  rotated: boolean
  /** Rotation angle of the axes in radians (0 when B = 0). */
  theta: number
  discriminant: number
  sentence: string
}

export interface Labeled {
  x: number
  y: number
  xText: string
  yText: string
}

export interface ConicFeatures {
  center: Labeled | null
  vertices: Labeled[]
  coVertices: Labeled[]
  foci: Labeled[]
  /** Parabola: the directrix as "y = −2" / "x = 3" with its value. */
  directrix: { axis: 'x' | 'y'; value: number; text: string } | null
  /** Hyperbola: the two asymptotes as lines through the center. */
  asymptotes: { slope: number; text: string }[]
  /** Hyperbola: corners of the fundamental rectangle. */
  box: Vec2[] | null
  eccentricity: number
  /** "major axis 6, minor axis 4, focal distance √5", "latus rectum 8". */
  sentences: string[]
}

// TODO(core agent): implement.
export function conicSource(_spec: ConicSpec): string {
  return 'x^2 + y^2 = 1'
}

export function readConic(_src: string): ConicSpec | null {
  return null
}

export function classify(_src: string): ConicClass {
  return { kind: 'none', rotated: false, theta: 0, discriminant: 0, sentence: '' }
}

export function conicFeatures(_spec: ConicSpec): ConicFeatures {
  return {
    center: null, vertices: [], coVertices: [], foci: [], directrix: null,
    asymptotes: [], box: null, eccentricity: 0, sentences: [],
  }
}

export type Built = ConicSpec | { error: string }

export function conicFromCircle(_center: Vec2, _radiusOrPoint: number | Vec2): Built {
  return { error: 'not implemented' }
}

export function conicFromEllipse(_o: { center: Vec2; vertex: Vec2; focus?: Vec2; coVertex?: Vec2; e?: number }): Built {
  return { error: 'not implemented' }
}

export function conicFromHyperbola(_o: { center: Vec2; vertex: Vec2; focus?: Vec2; asymptoteSlope?: number; e?: number }): Built {
  return { error: 'not implemented' }
}

export function conicFromParabola(
  _o: { vertex: Vec2; focus: Vec2 } | { focus: Vec2; directrix: { axis: 'x' | 'y'; value: number } } | { vertex: Vec2; point: Vec2; opens: 'up' | 'down' | 'left' | 'right' },
): Built {
  return { error: 'not implemented' }
}

export function conicFromFoci(_f1: Vec2, _f2: Vec2, _o: { sum: number } | { difference: number }): Built {
  return { error: 'not implemented' }
}

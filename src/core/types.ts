// ============================================================================
// GRAPHER — shared contracts. ALL modules code against this file.
// Coordinate convention: "math" space is standard cartesian (y up).
// "screen" space is canvas pixels (y down). Viewport maps between them.
// ============================================================================

export interface Vec2 { x: number; y: number }

export interface Viewport {
  center: Vec2        // math coords at canvas center
  pxPerUnit: number   // zoom: pixels per math unit
  widthPx: number
  heightPx: number
}

export function toScreen(p: Vec2, vp: Viewport): Vec2 {
  return {
    x: vp.widthPx / 2 + (p.x - vp.center.x) * vp.pxPerUnit,
    y: vp.heightPx / 2 - (p.y - vp.center.y) * vp.pxPerUnit,
  }
}

export function toMath(p: Vec2, vp: Viewport): Vec2 {
  return {
    x: vp.center.x + (p.x - vp.widthPx / 2) / vp.pxPerUnit,
    y: vp.center.y - (p.y - vp.heightPx / 2) / vp.pxPerUnit,
  }
}

export type CurveKind = 'explicit' | 'polar' | 'parametric' | 'implicit'

/** A slider-editable parameter description. */
export interface ParamMeta {
  name: string      // e.g. "a", "b", "ω", "φ"
  min: number
  max: number
  step: number
}

/**
 * A curve model family (e.g. "sine", "poly2", "ellipse", "fourier").
 * Registered in MODELS (src/core/fit/models.ts):
 *   export const MODELS: Record<string, ModelSpec>
 * Param arrays are the single source of truth; latex/eval derive from them.
 */
export interface ModelSpec {
  id: string
  kind: CurveKind
  name: string                       // human label, e.g. "Sinusoid"
  // exactly one eval* is implemented, matching `kind`:
  evalExplicit?(params: number[], x: number): number
  evalPolar?(params: number[], theta: number): number
  evalParametric?(params: number[], t: number): Vec2
  evalImplicit?(params: number[], x: number, y: number): number
  latex(params: number[]): string    // KaTeX-renderable string
  paramMeta(params: number[]): ParamMeta[]  // ranges centered on current values
  /** Optional: return params translated by (dx, dy) in math units (for drag-editing).
   *  Omit when translation isn't meaningful for the family. */
  translate?(params: number[], dx: number, dy: number): number[]
}

/** One curve living on the board. */
export interface FittedCurve {
  id: string
  modelId: string            // key into MODELS
  params: number[]
  kind: CurveKind
  /** x-range (explicit), theta-range (polar), t-range (parametric); null = whole view */
  domain: [number, number] | null
  color: string
  strokeWidth: number
  visible: boolean
  sourceStroke?: Vec2[]      // original ink, math coords — kept for refit
  error: number              // rms residual in math units
}

/** Candidate produced by recognition, ranked best-first. */
export interface FitResult {
  modelId: string
  params: number[]
  kind: CurveKind
  domain: [number, number] | null
  error: number   // rms residual (math units)
  score: number   // model-selection score (AIC-like); LOWER is better
}

/** Output of stroke preprocessing. */
export interface ProcessedStroke {
  points: Vec2[]        // resampled + lightly smoothed, math coords
  closed: boolean       // endpoints meet (relative to stroke size)
  arcLength: number
  bbox: { min: Vec2; max: Vec2 }
  /** true if the stroke fails the vertical line test badly (multi-valued in x) */
  multiValuedX: boolean
}

// ============================================================================
// Module contracts (implemented by the owning module):
//
// src/core/stroke.ts
//   export function processStroke(raw: Vec2[], vp: Viewport): ProcessedStroke
//
// src/core/fit/recognize.ts
//   export function recognize(stroke: ProcessedStroke, vp: Viewport): FitResult[]
//     — fits every plausible model family, returns candidates sorted by score.
//
// src/core/fit/models.ts
//   export const MODELS: Record<string, ModelSpec>
//
// src/render/grid.ts
//   export function drawGrid(ctx: CanvasRenderingContext2D, vp: Viewport, theme: Theme): void
//
// src/render/curves.ts
//   export function drawCurve(ctx: CanvasRenderingContext2D, curve: FittedCurve,
//                             models: Record<string, ModelSpec>, vp: Viewport): void
//   export function drawInk(ctx: CanvasRenderingContext2D, pts: Vec2[], vp: Viewport,
//                           color: string): void
// ============================================================================

export interface Theme {
  bg: string
  gridMinor: string
  gridMajor: string
  axis: string
  label: string
}

/**
 * Grid contrast is a LADDER, not a texture. Two independent reviews measured
 * the old values at 1.17:1 minor / 1.45:1 major / 6.2:1 axis -- a flat wash
 * that a projector's ambient light erases, then a cliff. Minor and major now
 * sit at real steps, and the axis line is separated from its labels so the
 * structure and its annotation stop being the same colour.
 */
export const DARK_THEME: Theme = {
  bg: '#0f1117',
  gridMinor: '#232a40',   // ~1.45:1
  gridMajor: '#39415f',   // ~2.1:1
  axis: '#8b93b0',        // ~6.2:1
  label: '#a3abc6',       // annotation, a step above the axis line
}

/**
 * Light/print theme. Exports on a dark ground cannot go in a worksheet or
 * through a copier, so every figure needs a version meant for white paper.
 */
export const LIGHT_THEME: Theme = {
  bg: '#ffffff',
  gridMinor: '#dfe3ec',   // ~1.6:1
  gridMajor: '#b9c0cf',   // ~2.5:1
  axis: '#4a5163',        // ~7.9:1
  label: '#2b3140',
}

export const CURVE_COLORS = [
  '#4f9cf9', '#f95f62', '#38c976', '#f9a825',
  '#c678dd', '#2dd4bf', '#fb7185', '#a3e635',
]

/**
 * Print counterparts, index-for-index with CURVE_COLORS, so a curve keeps its
 * identity between screen and paper. The screen palette is tuned for contrast
 * against a near-black ground and washes out on white -- amber in particular
 * drops to about 1.7:1, which a copier renders as nothing.
 */
export const PRINT_CURVE_COLORS = [
  '#1a5fb4', '#c01c28', '#1a7f37', '#9a6700',
  '#7038b0', '#0f766e', '#bf3989', '#4d7c0f',
]

/** Map a screen curve colour to its print counterpart; unknown colours pass through. */
export function toPrintColor(color: string): string {
  const i = CURVE_COLORS.indexOf(color)
  return i >= 0 ? PRINT_CURVE_COLORS[i] : color
}

let idCounter = 0
export function nextId(): string {
  return `c${++idCounter}_${Math.random().toString(36).slice(2, 7)}`
}

// ============================================================================
// Typed-expression contract (src/core/parse/index.ts):
//   export function parseExpression(src: string): ParseOutcome
// Accepts e.g. "y = 2sin(3x) + 1", "x^2 + y^2 = 4", "r = 1 + cos(theta)",
// "a*x^2 + b" (free constants a,b,... become editable params with defaults 1).
// ============================================================================

export interface ParsedPlot {
  kind: CurveKind
  latex: string                 // KaTeX form of the input
  paramNames: string[]          // free constants discovered (a, b, k, ...)
  defaultParams: number[]       // initial values for those constants
  domain: [number, number] | null
  /** Build a ModelSpec closing over the parsed AST; its params are the free constants. */
  makeModel(modelId: string): ModelSpec
}

export type ParseOutcome =
  | { ok: true; plot: ParsedPlot }
  | { ok: false; error: string; pos?: number }

// ============================================================================
// Curve-editing contract (src/core/fit/edit.ts) — "grab the math itself":
//
//   export function getHandles(curve: FittedCurve, models: Record<string, ModelSpec>): CurveHandle[]
//     — model-aware control points (vertex, center, radius, crest, domain ends...).
//   export function applyHandleDrag(curve: FittedCurve, models: Record<string, ModelSpec>,
//       handleId: string, target: Vec2): { params: number[]; domain: [number, number] | null }
//     — exact, closed-form where possible (radius drag = set r; vertex drag = shift).
//   export function dragCurvePoint(curve: FittedCurve, models: Record<string, ModelSpec>,
//       grab: Vec2, target: Vec2): number[]
//     — semantic drag from ANY point on the curve: damped Gauss-Newton finds the
//       minimal parameter change moving the grabbed curve point to `target` while
//       soft-anchoring the rest of the curve (numeric Jacobian over params).
//   export function oversketch(curve: FittedCurve, models: Record<string, ModelSpec>,
//       ink: Vec2[]): { params: number[]; error: number } | null
//     — refit the SAME model family blending new ink with samples of the current
//       curve away from the ink's span (local redraw, global shape preserved).
//   export function snapParams(modelId: string, params: number[]):
//       { params: number[]; snapped: boolean[] } | null
//     — magnetize params to nice values (integers, halves, π-multiples) within
//       ~1.5% relative tolerance; null when nothing snaps.
// ============================================================================

export interface CurveHandle {
  id: string           // stable within a selection, e.g. "vertex", "radius", "domain-start"
  pos: Vec2            // math coords
  kind: 'feature' | 'domain-start' | 'domain-end' | 'center' | 'radius' | 'rotation'
  label?: string       // tooltip: "amplitude", "vertex", ...
  cursor?: string      // CSS cursor hint
}

// ============================================================================
// Curve analysis (src/core/analyze.ts) — the features a student is asked to
// find: where it crosses, turns, and changes concavity.
//
//   export function analyzeCurve(
//     curve: FittedCurve,
//     models: Record<string, ModelSpec>,
//   ): SpecialPoint[]
//
// Points are returned in left-to-right order (by x) for explicit families, and
// restricted to the curve's own domain. Never throws: an un-analyzable family
// returns an empty array. Must be fast enough to re-run while a slider is
// being dragged (< 2ms for a typical curve).
// ============================================================================

export type SpecialPointKind =
  | 'zero'         // f(x) = 0 — an x-intercept / root
  | 'maximum'      // local maximum
  | 'minimum'      // local minimum
  | 'inflection'   // concavity changes
  | 'y-intercept'  // f(0)
  | 'extreme'      // closed/polar curves: leftmost, rightmost, top, bottom
  | 'petal-tip'    // polar: local maximum of |r|

export interface SpecialPoint {
  kind: SpecialPointKind
  pos: Vec2
  /** short human label for the readout, e.g. "zero", "max", "inflection" */
  label: string
  /**
   * True when the location is known in closed form (a line's root, a
   * parabola's vertex) rather than located numerically. Lets the UI avoid
   * implying more precision than was actually computed.
   */
  exact: boolean
  /**
   * True when the point is a tangency — the curve touches zero (or a critical
   * value) without crossing, e.g. a double root. Worth flagging because it is
   * the case naive sign-change root finding silently misses.
   */
  tangent?: boolean
}

// ============================================================================
// Editable analysis (src/core/fit/edit.ts) — state a feature, not a parameter.
//
//   export function applyFeatureEdit(
//     curve: FittedCurve,
//     models: Record<string, ModelSpec>,
//     edit: FeatureEdit,
//   ): FeatureEditResult
//
// "Put this zero at x = 2." "Put the maximum at (-1, 5)." The curve changes to
// satisfy the constraint while moving as little as possible otherwise.
//
// Some requests are impossible and must be refused with a reason a teacher can
// read, never silently approximated: a parabola cannot have three zeros, and a
// cubic's maximum and minimum are not independent — its inflection sits exactly
// at their midpoint, because a cubic is point-symmetric about it.
// ============================================================================

export interface FeatureEdit {
  /** The feature being moved, exactly as returned by analyzeCurve(). */
  point: SpecialPoint
  /**
   * Desired new position. Either coordinate may be omitted to leave it free —
   * "put the zero at x = 2" fixes x only; a zero's y is 0 by definition.
   */
  to: { x?: number; y?: number }
  /**
   * Other features to hold fixed while this one moves, if the family has the
   * freedom. Ignored when honouring them all would over-determine the curve.
   */
  pinned?: SpecialPoint[]
}

export type FeatureEditResult =
  | {
      ok: true
      params: number[]
      domain: [number, number] | null
      /** true when the constraint is satisfied in closed form rather than numerically */
      exact: boolean
      /** features that moved as a side effect, for the UI to report honestly */
      alsoMoved?: SpecialPoint[]
    }
  | {
      ok: false
      /** plain-language reason, shown to the user verbatim */
      reason: string
      /** nearest achievable result, when one exists and is worth offering */
      nearest?: { params: number[]; domain: [number, number] | null }
    }

// ============================================================================
// Number lines — solution sets, domains, interval notation.
//
// A number line is not a curve family: it is a different KIND of board, the
// way GraphFree separates Cartesian / Polar / Number Line grids. A document
// carries one kind, and a number-line board holds NLItems instead of curves.
// Everything else -- pan/zoom, undo, documents, autosave, export -- is shared.
// ============================================================================

export type BoardKind = 'cartesian' | 'number-line'

/**
 * A point or an interval on the line. `null` on an interval bound means
 * unbounded in that direction and renders as an arrow.
 *
 * Closed/open is the whole pedagogical point: a filled dot includes the
 * endpoint, a hollow one excludes it, and getting that wrong is the single
 * most common mistake a student makes reading a solution set.
 */
export type NLItem =
  | {
      kind: 'point'
      id: string
      x: number
      closed: boolean
      color: string
      label?: string
    }
  | {
      kind: 'interval'
      id: string
      lo: number | null
      hi: number | null
      loClosed: boolean
      hiClosed: boolean
      color: string
      label?: string
    }

/** Human-readable interval notation, e.g. "[-2, 5)" or "(-inf, 3]". */
export function intervalNotation(it: Extract<NLItem, { kind: 'interval' }>): string {
  const lo = it.lo === null ? '-\\infty' : trimNum(it.lo)
  const hi = it.hi === null ? '\\infty' : trimNum(it.hi)
  const l = it.lo === null ? '(' : it.loClosed ? '[' : '('
  const r = it.hi === null ? ')' : it.hiClosed ? ']' : ')'
  return `${l}${lo}, ${hi}${r}`
}

function trimNum(v: number): string {
  const s = v.toPrecision(6)
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

// ============================================================================
// Inequality parsing (src/core/parse/inequality.ts):
//
//   export function parseInequality(src: string): InequalityOutcome
//
// Accepts what a teacher actually writes for a solution set:
//   x < 3          x >= -2          -2 <= x < 5        2 < x <= 7
//   x < -2 or x >= 3               x <= 1 and x > -4
//   [-2, 5)        (-inf, 3]        {-1, 2, 5}         x = 4
// Returns the items to draw, already normalised (sorted, merged where they
// overlap) so "x < 1 or x < 3" is one ray rather than two stacked ones.
// ============================================================================

/**
 * Omit that distributes over a union. Plain `Omit<NLItem, ...>` collapses to the
 * members' COMMON keys, so `item.lo` would not typecheck at the call site even
 * though it is there at runtime.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** An NLItem before the board assigns it an id and a colour. */
export type NLItemDraft = DistributiveOmit<NLItem, 'id' | 'color'>

export type InequalityOutcome =
  | { ok: true; items: NLItemDraft[]; latex: string }
  | { ok: false; error: string; pos?: number }

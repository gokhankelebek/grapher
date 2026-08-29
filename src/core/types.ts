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

export const DARK_THEME: Theme = {
  bg: '#0f1117',
  gridMinor: '#1c2030',
  gridMajor: '#2a3047',
  axis: '#8b93b0',
  label: '#8b93b0',
}

export const CURVE_COLORS = [
  '#4f9cf9', '#f95f62', '#38c976', '#f9a825',
  '#c678dd', '#2dd4bf', '#fb7185', '#a3e635',
]

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

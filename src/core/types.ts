// ============================================================================
// GRAPHER — shared contracts. ALL modules code against this file.
// Coordinate convention: "math" space is standard cartesian (y up).
// "screen" space is canvas pixels (y down). Viewport maps between them.
// ============================================================================

export interface Vec2 { x: number; y: number }

export interface Viewport {
  center: Vec2        // math coords at canvas center
  /**
   * Zoom: pixels per math unit ALONG X — and along y too unless pxPerUnitY
   * says otherwise.
   */
  pxPerUnit: number
  /**
   * Pixels per math unit along y, when the axes are scaled independently
   * (data: years 1990–2020 against millions). Absent means equal axes —
   * every viewport that never sets it behaves exactly as before. Read it
   * through ppuY(vp); never assume a square board where a length, a slope
   * or a distance on screen is computed.
   */
  pxPerUnitY?: number
  widthPx: number
  heightPx: number
}

/** Pixels per unit along x. */
export const ppuX = (vp: Viewport): number => vp.pxPerUnit

/** Pixels per unit along y (equal to ppuX on an equal-axes board). */
export const ppuY = (vp: Viewport): number =>
  vp.pxPerUnitY !== undefined && Number.isFinite(vp.pxPerUnitY) && vp.pxPerUnitY > 0
    ? vp.pxPerUnitY
    : vp.pxPerUnit

/** True when the board is stretched: one screen pixel is not the same length in x and y. */
export const isStretched = (vp: Viewport): boolean => ppuY(vp) !== ppuX(vp)

export function toScreen(p: Vec2, vp: Viewport): Vec2 {
  return {
    x: vp.widthPx / 2 + (p.x - vp.center.x) * ppuX(vp),
    y: vp.heightPx / 2 - (p.y - vp.center.y) * ppuY(vp),
  }
}

export function toMath(p: Vec2, vp: Viewport): Vec2 {
  return {
    x: vp.center.x + (p.x - vp.widthPx / 2) / ppuX(vp),
    y: vp.center.y - (p.y - vp.heightPx / 2) / ppuY(vp),
  }
}

// ----------------------------------------------------------------------------
// Independent x and y scales — the contract for the wave that adds them.
//
// RENDER (src/render/**, src/ui/renderBoard.ts, src/ui/exportFit.ts):
//   every place that turns a math LENGTH into pixels or back uses ppuX for
//   horizontal and ppuY for vertical: the grid gets its own tick ladder per
//   axis (pickTickStep(ppuX) for x labels and verticals, pickTickStep(ppuY)
//   for y) and its own π rule per axis; samplers measure screen distance in
//   pixels, not in math units scaled by one ppu; slope-field segments,
//   vector arrowheads, end-cap arrows, polygon label normals, residuals and
//   asymptote lines are computed in SCREEN space; the polar ruling is only
//   drawn on an equal-axes board (a stretched board draws the cartesian grid
//   and the App refuses polar ruling while stretched); exportFit fits x and y
//   independently when the board is stretched.
// APP (App.tsx, CanvasStage, gestures, snap, persist, settings):
//   Axes: Equal / Independent (board setting, persisted with the view as
//   board.viewport.ppuY — omitted when equal, byte-identical for old docs);
//   a WINDOW panel (x min, x max, y min, y max — TI style) that sets the
//   view exactly and turns Independent on when the two spans need it;
//   wheel/pinch zoom scales both axes by the same factor about the cursor;
//   dragging along an axis' numbers (or ⇧-wheel over the board for x,
//   ⌥-wheel for y) stretches ONE axis; "Zoom to data" and fit-to-curves fit
//   each axis to its own extent when Independent is on; snapping, hit radii
//   and handle drags convert per axis.
// ----------------------------------------------------------------------------

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
  /**
   * Where the formula is UNDEFINED as written, for a typed explicit
   * expression: zeros of every denominator, arguments of tan/sec/cot/csc at
   * their poles, and points the teacher excluded with `{x != c}` — the
   * candidates src/core/holes.ts sorts into holes and vertical asymptotes.
   * Sorted, deduplicated, within `range`. Absent for library families.
   */
  singularities?(params: number[], range: [number, number]): number[]
  /**
   * For a typed PIECEWISE (or restricted) explicit expression: its pieces in
   * increasing x, each with its interval and which ends it includes — what
   * a textbook marks with a filled (included) or open (excluded) dot, and
   * where a jump or a removable gap sits. Absent for everything else.
   * Produced by the parser (src/core/parse/index.ts) from the conditions as
   * written; `lo`/`hi` are ±Infinity for an unbounded side. A single piece
   * with no condition is not reported (absent), so ordinary curves are
   * untouched.
   */
  pieces?(params: number[]): PieceInfo[]
  /**
   * For a typed explicit expression: f at a NICE x (p/q or pπ/q), computed
   * in exact arithmetic — what the jump-dot layer needs to say which side a
   * step attains, where the nearest double cannot (sin of the double nearest
   * π is 1.2e-16, not 0). NaN where the formula is certifiably undefined;
   * undefined where exact arithmetic cannot certify a value (the caller
   * keeps the ordinary evaluation). Absent for everything else.
   */
  evalExact?(params: number[], x: ExactPoint): number | undefined
  /**
   * For a typed explicit expression: its Taylor coefficients at x = a,
   * c[k] = f⁽ᵏ⁾(a)/k! for k = 0…n, by Taylor-mode automatic differentiation
   * over the formula (src/core/parse/jets.ts) — exact up to rounding at any
   * degree, never a finite difference. Null where f is not analytic at a
   * (outside its domain, at a pole, |x| at 0, a step's edge, √ at 0) or the
   * formula has something jets cannot carry (a named call). Absent for
   * everything else; src/core/taylor.ts is the only caller.
   */
  taylor?(params: number[], a: number, n: number): number[] | null
  /**
   * For a typed TWO-VARIABLE INEQUALITY — y < x² − 4, x + 2y ≤ 8, x > 3,
   * x² + y² < 9, 2 < y < x + 3: the region and its boundaries at these params
   * (see InequalityInfo below). The curve itself is the BOUNDARY (an explicit
   * y = f(x) when the inequality solves for y, implicit otherwise), so every
   * card, slider, name and persistence path treats it as the typed curve it
   * is; this hook is what makes the renderer shade a side and dash a strict
   * boundary. Absent for everything that is not an inequality.
   */
  inequality?(params: number[]): InequalityInfo | null
  latex(params: number[]): string    // KaTeX-renderable string
  paramMeta(params: number[]): ParamMeta[]  // ranges centered on current values
  /** Optional: return params translated by (dx, dy) in math units (for drag-editing).
   *  Omit when translation isn't meaningful for the family. */
  translate?(params: number[], dx: number, dy: number): number[]
}

/** A nice x for ModelSpec.evalExact: p/q, or pπ/q when `pi` (q > 0). */
export interface ExactPoint {
  p: number
  q: number
  pi: boolean
}

/** One piece of a piecewise definition (ModelSpec.pieces). */
export interface PieceInfo {
  lo: number
  hi: number
  loClosed: boolean
  hiClosed: boolean
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
  | 'hole'         // removable discontinuity: f undefined at x, finite two-sided limit (pos = the limit)
  | 'intersection' // where this curve meets another (SpecialPoint.withId names the other)

export interface SpecialPoint {
  kind: SpecialPointKind
  pos: Vec2
  /** short human label for the readout, e.g. "zero", "max", "inflection" */
  label: string
  /**
   * The coordinate in closed form when one is KNOWN, as plain Unicode the
   * card and the on-board chip print next to the decimal: "√3", "−√3",
   * "2√3/9", "π/4", "−3π/2", "(1+√5)/2", "3/2". Absent when the value is a
   * decimal and nothing more. Never a guess that was not verified against
   * the curve — see src/core/exact.ts.
   */
  exactX?: string
  exactY?: string
  /**
   * For kind 'intersection': the id of the other curve. Produced by
   * src/core/analyze.ts intersectionPoints(parent, other, models, range),
   * which lists the points where parent and other meet inside `range`,
   * exact forms verified against f − g, one SpecialPoint per meeting point
   * (tangencies once), never a pole.
   */
  withId?: string
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
  | NLSolveItem

/**
 * A typed inequality, SOLVED (src/core/solveInequality.ts). Only the source
 * line and how to show it are stored: the solution set, the critical values
 * and the working are recomputed from `src` on every load and every frame
 * (src/ui/nlSolve.ts caches them), so a better solver improves old documents
 * and nothing computed can go stale on disk.
 */
export interface NLSolveItem {
  kind: 'solve'
  id: string
  /** the inequality as typed: "x^2 - 4 > 0", "|2x - 3| < 5", "x^2 > 1 and x < 3" */
  src: string
  color: string
  label?: string
  show: NLSolveShow
}

/** What a solve item draws besides its solution set. Absent flags take NL_SOLVE_DEFAULTS. */
export interface NLSolveShow {
  /** the + / − row above the line, with 0 / und at the critical values */
  signs?: boolean
  /** the test points as small ticks labelled "t = 0" */
  tests?: boolean
  /** |x − a| R b: the centre and a bracket of radius b above the line */
  distance?: boolean
  /** a compound: one line per clause (A, B), then A ∩ B / A ∪ B */
  stacked?: boolean
}

export const NL_SOLVE_DEFAULTS: Required<NLSolveShow> = {
  signs: true,
  tests: false,
  distance: true,
  stacked: true,
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

// ============================================================================
// Slope fields and solution curves — AP Calculus differential equations.
//
// A slope field is not a curve: it is a direction at every point, dy/dx =
// f(x, y), drawn as a lattice of short segments. A solution curve is the path
// through a chosen point that follows those directions (RK4 both ways).
//
//   src/core/parse/slopeField.ts
//     export function parseSlopeField(src: string): SlopeFieldOutcome
//       accepts "dy/dx = x - y", "y' = x*y", "dy/dx = a*x + b" (free constants
//       become sliders, exactly like parseExpression)
//   src/core/ode.ts
//     export function solveField(f, through: Vec2, range: [number, number],
//                                opts?): Vec2[]
//       RK4 from `through` in both x directions across `range`, stopping on
//       blow-up or non-finite; returns the polyline in order of increasing x
//   render: BoardScene.fields?: readonly SlopeField[]
//           BoardScene.polylines?: readonly Polyline[]   (solution curves, and
//           any other open path the App wants drawn as figure content)
// ============================================================================

export interface SlopeField {
  id: string
  /** dy/dx = f(x, y) at the current params */
  f: (x: number, y: number) => number
  latex: string
  color: string
  visible: boolean
  /** lattice spacing in CSS px; the renderer picks a default (~28) when absent */
  spacingPx?: number
}

/** An open path in math coords drawn as figure content (exports, not chrome). */
export interface Polyline {
  id: string
  pts: readonly Vec2[]
  color: string
  width?: number
  dash?: readonly number[]
}

/**
 * Euler's method on the board: the path through (x₀, y₀), (x₁, y₁), … drawn as
 * the tangent segments it is made of, a filled dot at every step and a larger
 * ring at the start. Figure content (src/render/euler.ts): it exports, and it
 * goes mono under SAT / AP like every other stroke.
 */
export interface EulerPath {
  id: string
  pts: readonly Vec2[]
  color: string
  dash?: readonly number[]
  /** "P₀", "P₁", … one per point, when the run's labels are on. */
  labels?: readonly string[]
  /** "h = 0.5": a small tag past the last point — the figure's own legend. */
  tag?: string
}

export type SlopeFieldOutcome =
  | {
      ok: true
      latex: string
      paramNames: string[]
      defaultParams: number[]
      /** Build the field closure for a given param vector. */
      makeField(id: string, params: number[], color: string): SlopeField
    }
  | { ok: false; error: string; pos?: number }

// ============================================================================
// Shapes — points, segments, vectors and polygons (Math 3 transformations,
// vector problems, geometric figures drawn to be measured).
//
// A shape is figure content in math coords, like a Polyline: it exports, it
// is not chrome. Vertices are the editable thing; everything visible is
// derived from them and the style.
//
//   src/core/parse/shapes.ts
//     export function parseShape(src: string): ShapeOutcome
//       "point (1, 2)"            "P = (1, 2)"
//       "segment (0,0) (3,4)"     "AB = (0,0) (3,4)"
//       "vector <3, 4>"           "v = <3, 4> from (1, 1)"    (tail optional, (0,0))
//       "polygon (0,0) (4,0) (4,3)"   "triangle (0,0) (4,0) (4,3)"
//       numbers may be expressions in free single-letter constants (sliders),
//       exactly as parseExpression; latex is the KaTeX of the shape
//   render: BoardScene.shapes?: readonly Shape[]   (src/render/shapes.ts)
//     points: filled disc + label; segments: stroked; vectors: stroked with a
//     filled arrowhead at the tip, sized in CSS px × present.stroke; polygons:
//     closed path, optional translucent fill; vertex labels when `labels` is
//     set (A, B, C… or the point's own name)
// ============================================================================

export type Shape =
  | ({ kind: 'point'; id: string; at: Vec2; color: string; visible: boolean; label?: string; measure?: ShapeMeasureDraw } & ShapeXformDraw)
  | ({ kind: 'segment'; id: string; a: Vec2; b: Vec2; color: string; visible: boolean; labels?: [string, string]; measure?: ShapeMeasureDraw } & ShapeXformDraw)
  | { kind: 'vector'; id: string; tail: Vec2; v: Vec2; color: string; visible: boolean; label?: string }
  | ({ kind: 'polygon'; id: string; pts: readonly Vec2[]; color: string; visible: boolean; fill?: boolean; labels?: readonly string[]; measure?: ShapeMeasureDraw } & ShapeXformDraw)
  /** A whole line through `through` along `dir` — "parallel to AB through P" (a linked line). */
  | ({ kind: 'line'; id: string; through: Vec2; dir: Vec2; color: string; visible: boolean; measure?: ShapeMeasureDraw } & ShapeXformDraw)

/**
 * A line defined by OTHER shapes: "parallel to AB through P". The parser
 * reads the words; the board resolves the names against the shapes on it
 * (src/ui/shapeLinks.ts) on every change, so the line follows A, B and P.
 */
export interface ShapeLineLink {
  rel: 'parallel' | 'perpendicular'
  /** The two point names of the segment it is measured against: ['A', 'B']. */
  to: [string, string]
  /** A point's name, or fixed coordinates. */
  through: string | Vec2
}

export type ShapeOutcome =
  | {
      ok: true
      kind: Shape['kind']
      latex: string
      paramNames: string[]
      defaultParams: number[]
      /** Build the shape for a given param vector. */
      makeShape(id: string, params: number[], color: string): Shape
      /** A linked line's references (kind 'line' only); resolved by the board. */
      link?: ShapeLineLink
    }
  | { ok: false; error: string; pos?: number }

// ============================================================================
// Measurements on shapes (NC Math 1 G-GPE.4–6, Math 2 G-SRT.6/8/12).
//
//   src/core/geometry.ts     distance, midpoint, slope, ∥/⊥, perimeter, shoelace
//                            area, angles, classification, right-triangle trig
//   src/ui/shapeLinks.ts     a shape's display toggles (BoardShape.measure) →
//                            ShapeMeasureDraw, every text already worked out
//   render/shapes.ts         draws it: side chips at the midpoints (outside),
//                            angle arcs with degrees (inside), right-angle
//                            squares, congruence ticks and arcs, midpoint dots,
//                            a summary chip under the figure
//   reveal mode / student copies replace the texts with "?" (src/ui/reveal.ts)
// ============================================================================

/** What a shape can show on the board. Stored per shape, only when set. */
export type MeasureFlag =
  | 'lengths'
  | 'slopes'
  | 'angles'
  | 'right'
  | 'marks'
  | 'midpoints'
  | 'area'
  | 'classify'
  | 'equation'

/** The order flags are listed and stored in. */
export const MEASURE_FLAGS: readonly MeasureFlag[] = [
  'lengths', 'slopes', 'angles', 'right', 'marks', 'midpoints', 'area', 'classify', 'equation',
]

/** One line of the summary chip, and which answer it states. */
export interface MeasureSummaryLine {
  part: 'area' | 'class'
  text: string
}

/** What render/shapes.ts draws for a shape's measurements: texts already worked out. */
export interface ShapeMeasureDraw {
  /** Per side (vertex i → i + 1; a segment has one side): the length chip. */
  lengths?: readonly (string | null)[]
  /** Per side: "m = 1/2". */
  slopes?: readonly (string | null)[]
  /** Per vertex: the degree label of its angle arc. */
  angles?: readonly (string | null)[]
  /** Per vertex: a right-angle square. */
  right?: readonly boolean[]
  /** Per side: how many congruence ticks (0 none). */
  ticks?: readonly number[]
  /** Per vertex: how many congruence arcs (0 none). */
  arcs?: readonly number[]
  /** Per side: the midpoint's coordinates; a dot is drawn there. */
  midpoints?: readonly (string | null)[]
  /** Lines of the chip under the figure: perimeter and area, the classification. */
  summary?: readonly MeasureSummaryLine[]
  /** A point measured to another point: a dashed segment with its readouts. */
  pair?: { to: Vec2; length: string | null; slope: string | null; midpoint: string | null }
  /** A line's equation chip. */
  equation?: string | null
}

// ============================================================================
// Transformations of shapes (NC Math 2 G-CO.2–8, G-SRT.1–3, F-IF.1–2).
//
//   src/core/transform2d.ts   translate / reflect / rotate / dilate, exact
//                             images, mapping notation, compositions, find
//                             the motion, symmetry, triangle criteria
//   src/core/parse/xform.ts   "rotate ABC 90° about (0, 0)" and the card's
//                             exact text inputs (angle, k, a line, a point)
//   src/ui/shapeXform.ts      an IMAGE is a shape whose BoardShape.xform
//                             names its pre-image and the transformation (as
//                             typed); its vertices are recomputed on every
//                             change, so A′B′C′ follows ABC when A is dragged
//   render/shapes.ts          images dashed; the visual aids below
//   reveal mode / student copy: the image itself is the answer (only what is
//                             GIVEN — the mirror, the centre, the vector —
//                             stays); the lines of symmetry are an answer too
// ============================================================================

/** A transformation as the card holds it: every parameter exactly as typed. */
export type XformOp =
  /** by ⟨a, b⟩ — the two components as typed: ["3", "-2"]. */
  | { t: 'translate'; by: [string, string] }
  /** "y = x", "x-axis", "x = 2", "y = 2x + 1", "(0, 0) (1, 2)", "AB" */
  | { t: 'reflect'; line: string }
  /** angle in degrees as typed ("90", "-45"); about "(0, 0)", "O", "C" */
  | { t: 'rotate'; angle: string; about: string }
  /** scale factor as typed ("2", "1/2", "-3"); about a point */
  | { t: 'dilate'; k: string; about: string }

/** The visual aids an image can draw, in the order they are listed and stored. */
export type XformAid = 'paths' | 'mirror' | 'arc' | 'rays' | 'vector'
export const XFORM_AIDS: readonly XformAid[] = ['paths', 'mirror', 'arc', 'rays', 'vector']

/** What a transformation's image (or a symmetric figure) draws besides itself. */
export interface ShapeAidsDraw {
  /** Dotted connectors from each pre-image vertex to its image. */
  paths?: readonly (readonly [Vec2, Vec2])[]
  /** The mirror line, edge to edge, with its equation chip. */
  mirror?: { through: Vec2; dir: Vec2; label: string }
  /** A rotation: the arc from `from` about `center` through `deg` (ccw +), labelled. */
  arc?: { center: Vec2; from: Vec2; to: Vec2; deg: number; label: string }
  /** Dilation rays: dashed segments along each line through the centre. */
  rays?: readonly (readonly [Vec2, Vec2])[]
  /** The centre of a rotation or dilation, named. */
  center?: { at: Vec2; label: string }
  /** The translation vector, from a vertex to its image. */
  vector?: { tail: Vec2; v: Vec2; label: string }
  /** The symmetry overlay: lines of symmetry, edge to edge. */
  symLines?: readonly { through: Vec2; dir: Vec2 }[]
  /** …and the rotation symmetry, in a chip at the centre. */
  symText?: { at: Vec2; text: string }
}

/** A transformation's image: what it is the image of, and under what. */
export interface ShapeImageInfo {
  /** "△ABC" */
  of: string
  /** "△A′B′C′" */
  name: string
  /** "a rotation of 90° counterclockwise about the origin" */
  words: string
  /** "R_{90°, O}" */
  notation: string
  /** "(x, y) → (−y, x)" */
  rule: string
}

/** The transformation extras a point, segment or polygon may carry. */
export interface ShapeXformDraw {
  /** Drawn dashed: a transformation's image. */
  dashed?: boolean
  /** Visual aids (an image's construction marks, the symmetry overlay). */
  aids?: ShapeAidsDraw
  /** Set on an image. */
  image?: ShapeImageInfo
  /** Reveal mode / student copy: the figure is the answer — draw only its given aids. */
  figureHidden?: boolean
}

// ============================================================================
// Figure styles — the LOOK of the whole board, chosen to match where the
// figure is going: the screen, a textbook-style worksheet, an SAT item, an
// AP Calculus free-response figure.
//
// A style is a bundle the renderer reads in one place (BoardScene.figure); it
// overrides the theme and decides how the grid, the axes, the labels and the
// curve inks are drawn. The board on screen is drawn in the chosen style too,
// so the export is exactly what the teacher is looking at.
//
//   'screen'   — today's board: dark/light theme, colour palette, auto ladder
//   'textbook' — white, grey gridlines every unit with darker majors, black
//                axes with arrowheads at all four ends, numbers on the majors,
//                curves in the print palette (the GraphFree/worksheet look)
//   'sat'      — white, light-grey gridlines every unit, black axes with
//                arrowheads at all four ends, a number on EVERY unit tick on
//                both axes, x and y at the arrow tips, every curve black
//   'ap'       — white, NO gridlines: bare black axes with arrowheads at all
//                four ends and short tick marks, numbers on the ticks, "O" at
//                the origin, x and y at the tips, serif italic labels, every
//                curve black (derived curves dashed), an optional caption
//                such as "Graph of f" under the figure
//
//   render:  BoardScene.figure?: FigureStyle   (absent === FIGURE_STYLES.screen)
//            BoardScene.caption?: string       (figure content: it exports)
//   App:     board.figure persisted as the style id (omitted for 'screen');
//            picker in Board & export settings with live thumbnails rendered
//            through renderBoard itself
// ============================================================================

export type FigureStyleId = 'screen' | 'textbook' | 'sat' | 'ap'

export interface FigureStyle {
  id: FigureStyleId
  name: string
  /** Colours. For 'screen' the App substitutes the active dark/light theme. */
  theme: Theme
  /** Full gridlines, tick marks on the axes only, or bare axes. */
  grid: 'lines' | 'ticks' | 'none'
  /**
   * Gridline / tick spacing: the zoom-aware ladder (pickTickStep), or a fixed
   * one unit (majors every 5) as exam figures use. 'unit' falls back to the
   * ladder when a unit would be narrower than ~12 px.
   */
  spacing: 'auto' | 'unit'
  /** Which ticks carry a number: the ladder's majors, or every unit. */
  numbers: 'major' | 'unit'
  /** Arrowheads on all four axis ends, on the positive ends only, or none. */
  arrows: 'four' | 'positive' | 'none'
  /** Italic x and y at the arrow tips. */
  axisNames: boolean
  /** "O" beside the origin. */
  originLabel: boolean
  font: 'sans' | 'serif'
  /** Curves in their own colours (print-mapped on a light ground) or all black. */
  curveInk: 'palette' | 'mono'
  /** Curve stroke width in CSS px before presentation scaling. */
  curveWidth: number
  /** Analysis / shape point markers: filled discs or rings. */
  pointStyle: 'filled' | 'ring'
  /**
   * What an 'auto' curve end resolves to: 'marked' draws an arrow where the
   * graph runs off the board and a closed dot at a domain end; 'plain' draws
   * nothing (the screen look).
   */
  curveEnds: 'marked' | 'plain'
}

export const FIGURE_STYLES: Record<FigureStyleId, FigureStyle> = {
  screen: {
    id: 'screen',
    name: 'Screen',
    theme: DARK_THEME,
    grid: 'lines',
    spacing: 'auto',
    numbers: 'major',
    arrows: 'four',
    axisNames: false,
    originLabel: false,
    font: 'sans',
    curveInk: 'palette',
    curveWidth: 2.5,
    pointStyle: 'ring',
    curveEnds: 'plain',
  },
  textbook: {
    id: 'textbook',
    name: 'Textbook',
    theme: { bg: '#ffffff', gridMinor: '#c9cdd6', gridMajor: '#8d93a1', axis: '#000000', label: '#000000' },
    grid: 'lines',
    spacing: 'unit',
    numbers: 'major',
    arrows: 'four',
    axisNames: false,
    originLabel: false,
    font: 'sans',
    curveInk: 'palette',
    curveWidth: 2,
    pointStyle: 'filled',
    curveEnds: 'marked',
  },
  sat: {
    id: 'sat',
    name: 'SAT',
    theme: { bg: '#ffffff', gridMinor: '#d4d7de', gridMajor: '#d4d7de', axis: '#000000', label: '#000000' },
    grid: 'lines',
    spacing: 'unit',
    numbers: 'unit',
    arrows: 'four',
    axisNames: true,
    originLabel: false,
    font: 'sans',
    curveInk: 'mono',
    curveWidth: 2,
    pointStyle: 'filled',
    curveEnds: 'marked',
  },
  ap: {
    id: 'ap',
    name: 'AP Calculus',
    theme: { bg: '#ffffff', gridMinor: '#ffffff', gridMajor: '#ffffff', axis: '#000000', label: '#000000' },
    grid: 'ticks',
    spacing: 'unit',
    numbers: 'unit',
    arrows: 'four',
    axisNames: true,
    originLabel: true,
    font: 'serif',
    curveInk: 'mono',
    curveWidth: 2,
    pointStyle: 'filled',
    curveEnds: 'marked',
  },
}

// ============================================================================
// Curve end caps — what a graph's ends say.
//
// A textbook or exam figure marks the ends of every drawn curve: an ARROW
// where the graph continues beyond the board, a CLOSED dot where a restricted
// graph ends and the endpoint belongs to it, an OPEN dot where it does not,
// or nothing. Each end is chosen separately (a half-open interval has one of
// each). 'auto' lets the figure style decide: exam/textbook styles draw an
// arrow on an end that runs off the board and a closed dot on a domain end;
// the screen style draws nothing, as today.
//
//   per curve:  CurveStyle.ends?: { start?: EndCap; end?: EndCap }  (persist.ts)
//               "start" is the lower-x end (lower-t for parametric, lower-θ
//               for polar), "end" the upper
//   per figure: FigureStyle.curveEnds — the default an 'auto' end resolves to
//   render:     src/render/curves.ts draws the cap at the last sample before
//               the graph leaves the board (arrow along the tangent, pointing
//               outward) or at the domain end (dots), in the curve's ink,
//               sized in CSS px × present.stroke
// ============================================================================

export type EndCap = 'auto' | 'none' | 'arrow' | 'open' | 'closed'

export interface CurveEnds {
  start?: EndCap
  end?: EndCap
}

// ============================================================================
// Asymptotes — lines a graph approaches without reaching.
//
//   'vertical'  x = c            (a pole of an explicit or log-type curve)
//   'line'      through `a` in direction `dir` (unit), from a polar curve
//               whose r runs away as θ → θ0 while r·sin(θ − θ0) → d
//   src/core/holes.ts: findAsymptotes(curve, models, range): Asymptote[]
//   — findPoles() keeps returning the vertical ones as plain x values.
//   The renderer draws every kind dashed under the marked figure styles.
// ============================================================================

export type Asymptote =
  | { kind: 'vertical'; x: number }
  | { kind: 'line'; a: Vec2; dir: Vec2 }

// ============================================================================
// Two-variable inequalities — regions of the plane (NC Math 3, Algebra 2,
// AP Precalculus): y < x² − 4, y ≥ 2x + 1, x > 3, x + 2y ≤ 8, x² + y² < 9,
// 2 < y < x + 3. Typed on a graph board like any equation.
//
//   src/core/parse/index.ts   parseExpression reads a line whose top level
//                             carries < > ≤ ≥ (<=, >=, =<, =>) as an
//                             inequality: its ModelSpec draws the boundary and
//                             answers `inequality(params)`.
//   src/core/inequality2d.ts  the region as polygons (per-column spans), the
//                             implicit boundary as chained contours, the
//                             test-point sentences and the card's words.
//   src/core/linprog.ts       the feasible polygon of a linear system, its
//                             vertices (exact where rational) and an objective.
//   src/render/inequalities.ts  shading (cached per viewport) and boundaries,
//                             dashed when strict.
// ============================================================================

export type IneqRel = '<' | '<=' | '>' | '>='

/** One boundary as the renderer draws it. */
export type IneqBoundary =
  /** y = f(x): NaN where undefined (the pen lifts, nothing is shaded there). */
  | { kind: 'y'; f: (x: number) => number }
  /** x = c: a vertical line. */
  | { kind: 'x'; c: number }
  /** F(x, y) = 0, drawn as a contour. */
  | { kind: 'implicit'; F: (x: number, y: number) => number }

/**
 * Which side of the boundary is the region. 'inside' / 'outside' are for an
 * implicit boundary whose region is (or is not) bounded; 'where' is an
 * implicit boundary that is neither (y² < x): the card then says it in full.
 */
export type IneqSide = 'above' | 'below' | 'right' | 'left' | 'inside' | 'outside' | 'where'

/** One inequality of the chain (a compound 2 < y < x + 3 has two). */
export interface IneqPart {
  /** The region is s > 0 (strict) or s ≥ 0; NaN is outside it. */
  s: (x: number, y: number) => number
  strict: boolean
  boundary: IneqBoundary
  side: IneqSide
  /** s = a·x + b·y + c exactly (constant coefficients at these params). */
  linear?: { a: number; b: number; c: number }
  /** KaTeX of the boundary as written: "y = x^{2} - 4", "x + 2y = 8". */
  boundaryLatex: string
  /** The same in plain Unicode for sentences: "y = x² − 4". */
  boundaryText: string
  /** Index of the two terms of `InequalityInfo.terms` this part compares. */
  terms: [number, number]
}

export interface InequalityInfo {
  parts: readonly IneqPart[]
  /** The chain as typed: terms ("2", "y", "x + 3") and the signs between them. */
  terms: readonly string[]
  rels: readonly IneqRel[]
  /** Term i's value at (x, y), at these params. */
  term: (i: number, x: number, y: number) => number
  /** The free constants and their values, for substituted sentences. */
  paramNames: readonly string[]
  params: readonly number[]
}

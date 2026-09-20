// ============================================================================
// GRAPHER — document persistence (pure: no DOM, no storage APIs).
//
// Everything here is plain data in / plain data out so it can be unit-tested in
// node. The browser-side storage adapter lives in src/ui/storage.ts.
//
// THE CLOSURE PROBLEM: typed-expression curves reference a ModelSpec built by
// parseExpression(...).plot.makeModel(). Those are live closures and cannot be
// JSON-serialized. We persist the expression SOURCE TEXT per curve instead and
// rebuild the models on load. A source that no longer parses degrades to a
// visibly broken card rather than a vanished curve or a dead board.
// ============================================================================

import type {
  BoardKind,
  CurveKind,
  FigureStyleId,
  FitResult,
  FittedCurve,
  ModelSpec,
  NLItem,
  Vec2,
} from './types'
import { FIGURE_STYLES } from './types'
import { parseExpression } from './parse'
import { parseSlopeField } from './parse/slopeField'
import { parseShape } from './parse/shapes'
import { MODELS } from './fit/models'
import { derivativeModel } from './calculus'
import type { RiemannMethod } from './calculus'

/**
 * Bump when the on-disk shape changes in a way older readers can't handle.
 *
 * 1 -> 2 added the board KIND and its number-line items. The change is purely
 * additive: a version-1 document has no `kind` and no `items`, which is exactly
 * what a cartesian board serialises to today, so reading one is not a repair
 * and must not be reported as one (see SILENT_UPGRADE_FROM). In the other
 * direction a cartesian board still writes neither field, so a document this
 * reader saves stays readable by a version-1 reader unless it is actually a
 * number line — the only case where the older reader would genuinely be lost.
 */
export const SCHEMA_VERSION = 2

/**
 * The oldest format this reader upgrades with nothing lost or repaired. Below
 * it, a load says so; at or above it, the upgrade is invisible because there is
 * nothing to tell the user about.
 */
const SILENT_UPGRADE_FROM = 1

/** Per-curve style extras that FittedCurve itself doesn't carry. */
export interface CurveStyle {
  dash?: number[]
  opacity?: number
  /** Number-line items only: bar thickness in px (curves use strokeWidth). */
  width?: number
  /**
   * Number-line items only: which ANSWER this piece belongs to.
   *
   * "x < −2 or x ≥ 3" is one answer in two pieces, and the things that belong
   * to the answer rather than to a piece — its label, its interval notation —
   * need to know which pieces are in it. The stamp lives here because the
   * style map is already carried through history, export and this file; an
   * item with no stamp is an answer of one, which is what it is.
   */
  group?: string
}
export type StyleMap = Record<string, CurveStyle>

// --- calculus objects -------------------------------------------------------
//
// A tangent line, a derivative curve, a shaded integral and a Riemann sum are
// not four new kinds of thing on the board: two of them ARE curves (a `line`
// and a member of f′'s own family) and two of them are overlays the renderer
// already draws. What has to survive a reload is much smaller — the LINK that
// says which curve each one was asked about, and with what numbers.
//
// Everything visible is then recomputed from the link on load, which is the
// same code path a slider drag takes, so a reopened document is live rather
// than a photograph of the last time it was open. The types live here, beside
// the format that stores them, because the loader has to validate them and
// core may not reach into src/ui.

/** Which of the four calculus objects a link describes. */
export type CalcKind = 'tangent' | 'derivative' | 'area' | 'riemann'

/** A tangent line at one point of `parentId`, drawn as the curve `curveId`. */
export interface TangentLink {
  kind: 'tangent'
  id: string
  parentId: string
  /** The `line` curve this link drives; it lives and dies with the link. */
  curveId: string
  x: number
}

/** f′ of `parentId`, drawn as the curve `curveId`. */
export interface DerivativeLink {
  kind: 'derivative'
  id: string
  parentId: string
  curveId: string
}

/** The signed region between `parentId` and the x-axis over [from, to]. */
export interface AreaLink {
  kind: 'area'
  id: string
  parentId: string
  from: number
  to: number
  /** Read out |∫| instead of the signed value. The picture is the same. */
  abs: boolean
}

export interface RiemannLink {
  kind: 'riemann'
  id: string
  parentId: string
  from: number
  to: number
  n: number
  method: RiemannMethod
}

export type CalcLink = TangentLink | DerivativeLink | AreaLink | RiemannLink

/** The two links that own a curve of their own. */
export type CurveLink = TangentLink | DerivativeLink

export const isCurveLink = (l: CalcLink): l is CurveLink =>
  l.kind === 'tangent' || l.kind === 'derivative'

// --- slope fields -----------------------------------------------------------
//
// A slope field is dy/dx = f(x, y): a lattice of directions, plus however many
// solution curves the class threaded through it. Exactly like a calculus link,
// NOTHING computed is stored. What a document remembers is the sentence the
// teacher typed, the constants its sliders are at, and the points the solution
// curves were asked to pass through; the closure, the lattice and every
// integrated polyline are rebuilt from those on load.
//
// That is the whole reason a reopened field is live rather than a photograph:
// a slider dragged after a reload deforms its solution curves, because those
// curves were never stored in the first place.

/** One initial condition: the point a solution curve is asked to pass through. */
export interface FieldSolution {
  id: string
  x: number
  y: number
}

/** A slope field as the board holds it. `src` is the only source of truth. */
export interface BoardField {
  id: string
  /** The differential equation exactly as it was typed. */
  src: string
  /** The free constants, in the parser's own order. */
  params: number[]
  color: string
  /** Lattice spacing in CSS px — Sparse / Normal / Dense. */
  spacingPx: number
  visible: boolean
  solutions: FieldSolution[]
}

/** Lattice spacings the card offers, coarse to fine. */
export const FIELD_SPACINGS = { sparse: 40, normal: 28, dense: 18 } as const
/** The renderer's own default; a field at this spacing writes no key. */
export const FIELD_SPACING_DEFAULT = FIELD_SPACINGS.normal

const SPACING_VALUES: readonly number[] = [
  FIELD_SPACINGS.sparse,
  FIELD_SPACINGS.normal,
  FIELD_SPACINGS.dense,
]

/**
 * The nearest offered spacing. The card and the loader must agree exactly, or
 * a reopened document shows a segmented control with nothing selected.
 */
export function clampFieldSpacing(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return FIELD_SPACING_DEFAULT as number
  let best: number = FIELD_SPACING_DEFAULT
  let bestD = Infinity
  for (const px of SPACING_VALUES) {
    const d = Math.abs(px - v)
    if (d < bestD) {
      bestD = d
      best = px
    }
  }
  return best
}

// --- shapes -----------------------------------------------------------------
//
// A point, a segment, a vector, a polygon. Same rule as everything else on
// this board: what is stored is the LINE THE TEACHER TYPED plus the constants
// its sliders are at, and every vertex is evaluated out of that on load. So a
// triangle written `ABC = (0,0) (4,0) (a,3)` comes back with its slider still
// driving C, rather than as three frozen numbers.
//
// That is also why a dragged vertex REWRITES the source text (see the App):
// the source is the only truth there is, so a vertex whose position no longer
// follows from it would be a lie the next load would expose.

/** A shape as the board holds it. `src` is the only source of truth. */
export interface BoardShape {
  id: string
  /** The shape exactly as it was typed, e.g. "ABC = (0,0) (4,0) (4,3)". */
  src: string
  /** The free constants, in the parser's own order. */
  params: number[]
  color: string
  /** Polygons only: paint the interior. Ignored by the other kinds. */
  fill: boolean
  visible: boolean
}

// --- board ruling -----------------------------------------------------------
//
// Which LATTICE a cartesian board is drawn on: the square grid, or the
// concentric circles and radial spokes a polar curve is actually read off.
// It is a property of the board, not of any curve — a rose and its r-vs-θ
// companion can be on screen together and the teacher chooses the frame the
// class is reading — which is exactly why it lives in the document beside the
// axis units rather than on a curve.

/** The ruling a cartesian board is drawn on. */
export type BoardGrid = 'cartesian' | 'polar'

/** Anything but the word 'polar' is the square ruling, which is the default. */
export function storedGrid(v: unknown): BoardGrid {
  return v === 'polar' ? 'polar' : 'cartesian'
}

// --- figure style -----------------------------------------------------------
//
// WHICH LOOK the board is drawn in — the screen, a textbook page, an SAT item,
// an AP Calculus free-response figure (see FIGURE_STYLES in core/types.ts).
//
// Per document, beside the ruling and for the same reason: a figure built for
// an AP handout is an AP figure on any machine, and the teacher who set it must
// find it set tomorrow. Only the ID is stored — the style itself is code, so a
// tuned gridline colour reaches every document ever saved rather than being
// frozen into each of them.
//
// 'screen' is the default and what every document ever written meant, so such a
// board writes no key at all and serialises byte-for-byte as it did before this
// existed; an older reader drops a key it does not know and lands exactly on
// the screen look.

/** True for one of the four ids the renderer actually knows. */
export function isFigureStyleId(v: unknown): v is FigureStyleId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(FIGURE_STYLES, v)
}

/**
 * Read a stored style id. Absent, unreadable, or a name this build does not
 * have falls back to the screen look — a board drawn in a style nobody can
 * render is not a board. The LOADER says so for a name it did not recognise
 * (that is a lost instruction, not a default); absence is not a repair.
 */
export function storedFigureStyle(v: unknown): FigureStyleId {
  return isFigureStyleId(v) ? v : 'screen'
}

/** A caption is one line under a figure, not a paragraph. */
export const MAX_CAPTION_CHARS = 120

/** Read a stored caption. Anything that is not text means no caption. */
export function storedCaption(v: unknown): string {
  if (typeof v !== 'string') return ''
  const t = v.slice(0, MAX_CAPTION_CHARS)
  return t.trim() === '' ? '' : t
}

/** Rectangle counts a board offers. 200 is also where the slider stops. */
export const RIEMANN_N_MIN = 1
export const RIEMANN_N_MAX = 200
export const RIEMANN_N_DEFAULT = 8

/** Integerise and clamp n — the slider and the loader must agree exactly. */
export function clampRiemannN(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : RIEMANN_N_DEFAULT
  return Math.min(RIEMANN_N_MAX, Math.max(RIEMANN_N_MIN, n))
}

const RIEMANN_METHODS: readonly RiemannMethod[] = ['left', 'right', 'midpoint', 'trapezoid']

const isMethod = (v: unknown): v is RiemannMethod =>
  typeof v === 'string' && (RIEMANN_METHODS as readonly string[]).includes(v)

/** The model id a numerically-differentiated derivative registers under. */
export const DERIV_MODEL_PREFIX = 'dfdx_'

export type BoardMode = 'draw' | 'pan'

// --- axis units -------------------------------------------------------------
//
// How each axis is MEASURED is a property of the document, not of the window:
// a trig lesson is a trig lesson on any machine, and a teacher who set the
// x-axis to decimal because the class is reading amplitudes must find it
// decimal again tomorrow.
//
// Three states per axis, not two. 'auto' is the default and the interesting
// one: it asks the renderer's own recommendation (suggestAxisUnits) every time
// the curve set changes, so typing y = sin(x) turns the x-axis into π/2, π,
// 3π/2 by itself and deleting the last trig curve turns it back. 'decimal' and
// 'pi' are a teacher overruling that, and an override has to STICK — a board
// that argued back every time a sketch landed would be unusable.

/** What a teacher has said about one axis. 'auto' = let the board decide. */
export type AxisUnitChoice = 'auto' | 'decimal' | 'pi'

/** The per-document choice. Both sides default to 'auto'. */
export interface AxisUnitChoices {
  x: AxisUnitChoice
  y: AxisUnitChoice
}

/** What a document that has never been told anything about its axes means. */
export const AUTO_AXIS_UNITS: AxisUnitChoices = { x: 'auto', y: 'auto' }

/** A settled axis: what the renderer is actually handed. */
export type ResolvedAxisUnit = 'decimal' | 'pi'

export interface ResolvedAxisUnits {
  x: ResolvedAxisUnit
  y: ResolvedAxisUnit
}

/**
 * Settle the choice against a recommendation.
 *
 * The recommendation is `suggestAxisUnits()`'s: it only ever speaks about an
 * axis it wants in π, so a silent axis resolves to 'decimal' — the grid every
 * board has always drawn. An explicit choice ignores the recommendation
 * entirely, which is the whole point of making one.
 *
 * Pure, and free of anything React or canvas, so the rule the App runs on every
 * curve change is the rule the tests run.
 */
export function resolveAxisUnits(
  choices: AxisUnitChoices | undefined | null,
  suggestion?: { x?: ResolvedAxisUnit; y?: ResolvedAxisUnit } | null,
): ResolvedAxisUnits {
  const settle = (
    choice: AxisUnitChoice | undefined,
    hint: ResolvedAxisUnit | undefined,
  ): ResolvedAxisUnit => {
    if (choice === 'pi' || choice === 'decimal') return choice
    return hint === 'pi' ? 'pi' : 'decimal'
  }
  return {
    x: settle(choices?.x, suggestion?.x),
    y: settle(choices?.y, suggestion?.y),
  }
}

/** Read one stored side. Anything that is not an explicit unit means 'auto'. */
function storedAxisUnit(v: unknown): AxisUnitChoice {
  return v === 'pi' || v === 'decimal' ? v : 'auto'
}

// --- defensive limits: a stored blob is untrusted input ----------------------
const MAX_CURVES = 2000
const MAX_ITEMS = 500
const MAX_LABEL_CHARS = 120
const MAX_PARAMS = 64
const MAX_CANDIDATES = 24
/** A board with more calculus objects than this is a damaged record. */
const MAX_CALC = 200
/** Same for slope fields, and for the solution curves through any one of them. */
const MAX_FIELDS = 100
const MAX_SOLUTIONS = 100
/** And for shapes. A figure with more than this in it is a damaged record. */
const MAX_SHAPES = 200
/** Stored stroke resolution. Keeps boards small; plenty for refit and hit tests. */
export const MAX_STORED_STROKE = 120
const MAX_STROKE_IN = 20000
const STROKE_DP = 4
const CANDIDATE_DP = 6

// ---------------------------------------------------------------- stored shape

export interface StoredCandidate {
  modelId: string
  params: number[]
  kind: CurveKind
  domain: [number, number] | null
  error: number
  score: number
}

export interface StoredCurve {
  id: string
  modelId: string
  /** Full precision on purpose: typed exact values must round-trip exactly. */
  params: number[]
  kind: CurveKind
  domain: [number, number] | null
  color: string
  strokeWidth: number
  visible: boolean
  error: number
  /** Flat [x0,y0,x1,y1,...], rounded — flat halves the JSON size vs {x,y}. */
  stroke?: number[]
  /** Present iff this curve came from a typed equation. */
  exprSource?: string
  /**
   * The user's own typed form for a curve that is still a FAMILY — the
   * factored cubic they wrote, which the card keeps printing while the
   * family's params drive the curve.
   *
   * Deliberately NOT exprSource. That field means "this curve IS a typed
   * expression", and the loader rebuilds a model closure from it; putting a
   * family's display text there would overwrite the family with a generic
   * expr_N model on the next load, losing its handles and its interpretation.
   * Absent field = no source, so every document already on disk is unchanged.
   */
  displaySource?: string
  style?: CurveStyle
  candidates?: StoredCandidate[]
}

/**
 * An NLItem is already plain JSON, so it is stored as it lives — plus the same
 * per-id style record a curve carries, which lives beside the item rather than
 * in a second map so an item and its styling can never be separated.
 */
export type StoredNLItem = NLItem & { style?: CurveStyle }

export interface StoredBoard {
  curves: StoredCurve[]
  viewport: { cx: number; cy: number; ppu: number }
  selectedId: string | null
  mode: BoardMode
  /**
   * Omitted entirely for a cartesian board, which is what every version-1
   * document is: a board that has never been a number line therefore
   * serialises byte-for-byte as it did before this field existed.
   */
  kind?: BoardKind
  /** Omitted when empty, for the same reason. */
  items?: StoredNLItem[]
  /**
   * Per-axis units, and ONLY the sides a teacher chose explicitly.
   *
   * Absent — the field, or either side of it — means 'auto', which is what
   * every document written before this existed meant and still means. A board
   * on automatic therefore serialises byte-for-byte as it did before, so no
   * schema bump: an older reader drops a field it does not know, and dropping
   * it lands exactly on the default.
   */
  axisUnits?: { x?: ResolvedAxisUnit; y?: ResolvedAxisUnit }
  /**
   * The calculus objects attached to curves on this board — tangents,
   * derivative curves, shaded integrals, Riemann sums — as LINKS, never as
   * results. Each one is a handful of numbers; everything they draw is
   * recomputed on load.
   *
   * Omitted entirely when there are none, which is every document written
   * before this field existed: such a board serialises byte-for-byte as it did
   * then, and an older reader drops a key it does not know and lands exactly on
   * "this board has no calculus objects".
   */
  calc?: StoredCalcLink[]
  /**
   * The slope fields on this board, and the initial conditions their solution
   * curves were drawn through. Never the curves themselves: those are RK4
   * output, they are megabytes, and they would be a stale answer the moment a
   * slider moved.
   *
   * Omitted entirely when there are none — which is every document written
   * before this field existed, so such a board serialises byte-for-byte as it
   * did then, and an older reader drops a key it does not know and lands
   * exactly on "this board has no slope fields".
   */
  fields?: StoredField[]
  /**
   * The points, segments, vectors and polygons on this board — as the lines
   * that were typed, never as evaluated vertices, for the same reason a field
   * stores its sentence.
   *
   * Omitted entirely when there are none, which is every document written
   * before this field existed: such a board serialises byte-for-byte as it did
   * then, and an older reader drops a key it does not know and lands exactly
   * on "this board has no shapes".
   */
  shapes?: StoredShape[]
  /**
   * The ruling: 'polar' when the board is drawn on circles and spokes.
   *
   * Written ONLY for a polar board. The square ruling is the default and what
   * every document ever written meant, so a cartesian board writes no key and
   * serialises byte-for-byte as it did before this existed — and an older
   * reader drops a key it does not know and lands exactly on 'cartesian'.
   */
  grid?: BoardGrid
  /**
   * The figure style's ID: 'textbook', 'sat', 'ap'.
   *
   * Written ONLY when it is not the screen look, which is the default and what
   * every document ever written meant — so a board nobody has restyled writes
   * no key and serialises byte-for-byte as it did before this existed.
   */
  figure?: FigureStyleId
  /**
   * The line printed under the figure — "Graph of f" on an AP-style figure.
   *
   * Content, not chrome: it is part of what the teacher wrote, so it belongs to
   * the document. Written only when there is one, by the same rule.
   */
  caption?: string
}

/**
 * One shape as JSON: the line as typed, its constants, and its style.
 *
 * Everything that has a default is omitted at that default, by the same rule
 * the fields follow: a control nobody touched must not change the bytes of a
 * saved document.
 */
export interface StoredShape {
  id: string
  /** The shape as typed — the only thing that rebuilds its vertices. */
  src: string
  color: string
  /** Free constants. Omitted when the shape has none. */
  params?: number[]
  /** Polygons only, and only when the interior is painted. */
  fill?: true
  /** Written only when the shape is hidden. */
  hidden?: true
}

/**
 * One slope field as JSON: the sentence, its constants, and its points.
 *
 * Everything that has a default is omitted at that default, for the same
 * reason `calc` is omitted when empty: a control nobody touched must not
 * change the bytes of a saved document.
 */
export interface StoredField {
  id: string
  /** The differential equation as typed — the only thing that rebuilds it. */
  src: string
  color: string
  /** Free constants. Omitted when the equation has none. */
  params?: number[]
  /** Lattice spacing in px. Omitted at the default. */
  spacing?: number
  /** Written only when the field is hidden. */
  hidden?: true
  /** Initial conditions, flat [x0,y0,x1,y1,...]. Omitted when there are none. */
  through?: number[]
}

/** One link, flattened. Only the fields its own kind uses are ever written. */
export interface StoredCalcLink {
  kind: CalcKind
  id: string
  parentId: string
  curveId?: string
  x?: number
  from?: number
  to?: number
  abs?: boolean
  n?: number
  method?: RiemannMethod
}

export interface StoredDoc {
  version: number
  id: string
  name: string
  createdAt: number
  modifiedAt: number
  board: StoredBoard
}

/** What a board holds, so the documents list can say so without opening it. */
export interface DocCounts {
  curves: number
  points: number
  intervals: number
}

export interface DocMeta {
  id: string
  name: string
  createdAt: number
  modifiedAt: number
  /**
   * Index-only, both optional: the documents list shows a board's kind and
   * what is on it, and neither is worth opening a 200KB record to find out.
   * They live in the index (src/ui/storage.ts), never in the document itself,
   * so the on-disk document schema is untouched. Absent = not known yet.
   */
  kind?: BoardKind
  counts?: DocCounts
}

/** Count what a stored board holds. Cheap: it never touches stroke data. */
export function countBoard(board: StoredBoard): DocCounts {
  const items = Array.isArray(board.items) ? board.items : []
  let points = 0
  let intervals = 0
  for (const it of items) {
    if (it && it.kind === 'point') points++
    else if (it && it.kind === 'interval') intervals++
  }
  return {
    curves: Array.isArray(board.curves) ? board.curves.length : 0,
    points,
    intervals,
  }
}

// ---------------------------------------------------------------- live shape

export interface BoardInput {
  curves: FittedCurve[]
  /** Absent means 'cartesian' — every pre-number-line caller keeps working. */
  kind?: BoardKind
  items?: NLItem[]
  styles: StyleMap
  candidates: Map<string, FitResult[]>
  /** curveId -> the equation the user typed. */
  exprSources: Record<string, string>
  /** curveId -> the typed form to PRINT while the family still means it. */
  displaySources?: Record<string, string>
  /** Per-axis units. Absent = both automatic, which writes nothing. */
  axisUnits?: AxisUnitChoices
  /** Calculus objects. Absent or empty writes nothing at all. */
  calc?: readonly CalcLink[]
  /** Slope fields. Absent or empty writes nothing at all, by the same rule. */
  fields?: readonly BoardField[]
  /** Shapes. Absent or empty writes nothing at all, by the same rule. */
  shapes?: readonly BoardShape[]
  /** The ruling. Absent means 'cartesian', which writes nothing at all. */
  grid?: BoardGrid
  /** The figure style. Absent means 'screen', which writes nothing at all. */
  figure?: FigureStyleId
  /** The caption under the figure. Absent or blank writes nothing at all. */
  caption?: string
  viewport: { center: Vec2; pxPerUnit: number }
  selectedId: string | null
  mode: BoardMode
}

export interface HydratedBoard {
  curves: FittedCurve[]
  kind: BoardKind
  items: NLItem[]
  styles: StyleMap
  candidates: Map<string, FitResult[]>
  /** Rebuilt from source text — the closures the board needs to render. */
  extraModels: Record<string, ModelSpec>
  exprSources: Record<string, string>
  /** curveId -> the typed form the card prints instead of the generated one. */
  displaySources: Record<string, string>
  /** curveId -> why its equation could not be rebuilt. */
  brokenExpr: Record<string, string>
  /** Per-axis units as the document states them; 'auto' where it is silent. */
  axisUnits: AxisUnitChoices
  /**
   * The calculus links that survived: every one whose parent curve (and, for a
   * tangent or a derivative, its own curve) is still on the board. A link that
   * lost its parent is dropped AND reported — silently forgetting the tangent
   * a lesson was built around is exactly the kind of quiet loss this file
   * exists to prevent.
   */
  calc: CalcLink[]
  /**
   * The slope fields that could be rebuilt. A field whose equation no longer
   * parses is dropped and REPORTED: it is the one thing on the board that is
   * pure text, so a silent drop would lose the lesson and leave no trace of
   * what it said.
   */
  fields: BoardField[]
  /**
   * The shapes that could be rebuilt, by the same rule and for the same
   * reason: a triangle is one line of text, and a silent drop would lose the
   * figure a lesson was built around and leave no trace of what it said.
   */
  shapes: BoardShape[]
  /** The ruling this document states. 'cartesian' when it is silent. */
  grid: BoardGrid
  /** The figure style this document states. 'screen' when it is silent. */
  figure: FigureStyleId
  /** The caption under the figure. '' when there is none. */
  caption: string
  viewport: { center: Vec2; pxPerUnit: number }
  selectedId: string | null
  mode: BoardMode
  /** Highest expr_N seen, so new equations don't collide with restored ones. */
  exprCounter: number
  /** Highest dfdx_N seen, for the same reason. */
  derivCounter: number
}

export interface LoadResult {
  /** Null only when nothing at all could be salvaged. */
  meta: DocMeta | null
  board: HydratedBoard | null
  /** Human-readable notes about anything dropped or repaired. */
  problems: string[]
  /** True when the document loaded but something was lost or repaired. */
  degraded: boolean
}

// ------------------------------------------------------------------- helpers

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

const isStr = (v: unknown): v is string => typeof v === 'string'

const KINDS: readonly CurveKind[] = ['explicit', 'polar', 'parametric', 'implicit']
const isKind = (v: unknown): v is CurveKind => isStr(v) && (KINDS as readonly string[]).includes(v)

const round = (v: number, dp: number): number => {
  const f = 10 ** dp
  return Math.round(v * f) / f
}

function numArray(v: unknown, max: number, dp?: number): number[] | null {
  if (!Array.isArray(v) || v.length > max) return null
  const out: number[] = []
  for (const n of v) {
    if (!isNum(n)) return null
    out.push(dp === undefined ? n : round(n, dp))
  }
  return out
}

function domainOf(v: unknown): [number, number] | null {
  if (v === null || v === undefined) return null
  if (Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1])) return [v[0], v[1]]
  return null
}

/** Uniformly thin a stroke to at most `max` points, always keeping the ends. */
export function decimate(points: Vec2[], max = MAX_STORED_STROKE): Vec2[] {
  if (points.length <= max) return points
  const out: Vec2[] = []
  const last = points.length - 1
  for (let i = 0; i < max - 1; i++) {
    out.push(points[Math.round((i * last) / (max - 1))])
  }
  out.push(points[last])
  return out
}

const newId = (): string =>
  `d${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

// ------------------------------------------------------------------ save side

function candidateToStored(c: FitResult): StoredCandidate {
  return {
    modelId: c.modelId,
    params: c.params.map((v) => round(v, CANDIDATE_DP)),
    kind: c.kind,
    domain: c.domain,
    error: round(c.error, CANDIDATE_DP),
    score: round(c.score, CANDIDATE_DP),
  }
}

export function boardToStored(input: BoardInput): StoredBoard {
  const curves: StoredCurve[] = input.curves.map((c) => {
    const stored: StoredCurve = {
      id: c.id,
      modelId: c.modelId,
      params: c.params.slice(),
      kind: c.kind,
      domain: c.domain,
      color: c.color,
      strokeWidth: c.strokeWidth,
      visible: c.visible,
      error: c.error,
    }
    if (c.sourceStroke && c.sourceStroke.length > 0) {
      const pts = decimate(c.sourceStroke)
      const flat: number[] = []
      for (const p of pts) {
        flat.push(round(p.x, STROKE_DP), round(p.y, STROKE_DP))
      }
      stored.stroke = flat
    }
    const src = input.exprSources[c.id]
    if (src !== undefined) stored.exprSource = src
    // Written only when there is one, so a board without any typed display
    // forms serialises byte-for-byte as it did before this field existed.
    const shown = input.displaySources?.[c.id]
    if (typeof shown === 'string' && shown.trim() !== '') stored.displaySource = shown
    const st = input.styles[c.id]
    if (st && (st.dash !== undefined || st.opacity !== undefined)) stored.style = { ...st }
    const cands = input.candidates.get(c.id)
    if (cands && cands.length > 0) {
      stored.candidates = cands.slice(0, MAX_CANDIDATES).map(candidateToStored)
    }
    return stored
  })

  const board: StoredBoard = {
    curves,
    viewport: {
      cx: round(input.viewport.center.x, 6),
      cy: round(input.viewport.center.y, 6),
      ppu: round(input.viewport.pxPerUnit, 6),
    },
    selectedId: input.selectedId,
    mode: input.mode,
  }

  // Written only when they carry information. A cartesian board with no items
  // produces the same JSON it produced before either field existed.
  if (input.kind === 'number-line') board.kind = 'number-line'
  // Same rule for the axes: an automatic side is not a choice, so it is not
  // written. Both automatic and the key never appears.
  const ax: { x?: ResolvedAxisUnit; y?: ResolvedAxisUnit } = {}
  if (input.axisUnits?.x === 'pi' || input.axisUnits?.x === 'decimal') ax.x = input.axisUnits.x
  if (input.axisUnits?.y === 'pi' || input.axisUnits?.y === 'decimal') ax.y = input.axisUnits.y
  if (ax.x !== undefined || ax.y !== undefined) board.axisUnits = ax
  const items = input.items ?? []
  if (items.length > 0) {
    board.items = items.slice(0, MAX_ITEMS).map((it) => itemToStored(it, input.styles[it.id]))
  }

  // Same rule again: no calculus objects, no key, so a board that has never
  // had one writes exactly the JSON it wrote before this field existed.
  const calc = input.calc ?? []
  if (calc.length > 0) board.calc = calc.slice(0, MAX_CALC).map(calcLinkToStored)

  // And once more for the slope fields.
  const fields = input.fields ?? []
  if (fields.length > 0) board.fields = fields.slice(0, MAX_FIELDS).map(fieldToStored)

  // And for the shapes.
  const shapes = input.shapes ?? []
  if (shapes.length > 0) board.shapes = shapes.slice(0, MAX_SHAPES).map(shapeToStored)

  // The ruling, only when it is not the square one every document has always
  // been drawn on.
  if (input.grid === 'polar') board.grid = 'polar'

  // And the look, only when it is not the screen one every document has always
  // been drawn in — with its caption, only when there is one to print.
  if (isFigureStyleId(input.figure) && input.figure !== 'screen') board.figure = input.figure
  const caption = storedCaption(input.caption)
  if (caption !== '') board.caption = caption

  return board
}

/**
 * One shape as JSON.
 *
 * The params are NOT rounded, for the reason a field's are not: a vertex is
 * evaluated from them, and a triangle whose apex comes back a millionth off
 * is a triangle whose area readout changed while the document was closed.
 */
export function shapeToStored(s: BoardShape): StoredShape {
  const out: StoredShape = { id: s.id, src: s.src, color: s.color }
  if (s.params.length > 0) out.params = s.params.slice()
  if (s.fill === true) out.fill = true
  if (s.visible === false) out.hidden = true
  return out
}

/**
 * One shape out of an untrusted blob, re-parsed.
 *
 * The typed line is the only thing that can rebuild the vertices, so a source
 * the parser now refuses is not salvageable: the loader reports it rather than
 * swallowing it, exactly as it does for a slope field.
 */
export function storedToShape(raw: unknown): { shape: BoardShape } | { error: string } {
  if (!isObj(raw)) return { error: 'it was not readable' }
  const { id, src, color } = raw
  if (!isStr(id) || !id) return { error: 'it had no id' }
  if (!isStr(src) || src.trim() === '') return { error: 'it had nothing typed in it' }
  let outcome: ReturnType<typeof parseShape>
  try {
    outcome = parseShape(src)
  } catch {
    return { error: 'the parser could not read it' }
  }
  if (!outcome.ok) return { error: outcome.error }

  // Matched to the shape's own list by POSITION — the order the parser reports
  // them in and the order the sliders are shown in. A shorter list (an older
  // save, a hand-edited file) falls back to the parser's defaults rather than
  // leaving a slider at undefined.
  const stored = Array.isArray(raw.params) ? raw.params : []
  const params = outcome.defaultParams.map((d, i) => {
    const v = stored[i]
    return isNum(v) ? v : d
  })

  return {
    shape: {
      id,
      src,
      params,
      color: isStr(color) && color ? color : '#4f9cf9',
      fill: raw.fill === true,
      visible: raw.hidden !== true,
    },
  }
}

/**
 * One slope field as JSON.
 *
 * The params and the initial conditions are NOT rounded, for the reason a
 * calculus link's limits are not: a solution curve through (0, 2) that comes
 * back through (0, 2.000001) is a different curve, and on a logistic field
 * near an equilibrium it is a visibly different picture.
 */
export function fieldToStored(f: BoardField): StoredField {
  const out: StoredField = { id: f.id, src: f.src, color: f.color }
  if (f.params.length > 0) out.params = f.params.slice()
  const spacing = clampFieldSpacing(f.spacingPx)
  if (spacing !== FIELD_SPACING_DEFAULT) out.spacing = spacing
  if (f.visible === false) out.hidden = true
  if (f.solutions.length > 0) {
    const flat: number[] = []
    for (const s of f.solutions.slice(0, MAX_SOLUTIONS)) flat.push(s.x, s.y)
    out.through = flat
  }
  return out
}

/**
 * One slope field out of an untrusted blob, re-parsed.
 *
 * The equation is the only thing that can rebuild the closure, so a source
 * that no longer parses is not salvageable: null, with the parser's own
 * sentence, which the loader reports rather than swallowing.
 */
export function storedToField(raw: unknown): { field: BoardField } | { error: string } {
  if (!isObj(raw)) return { error: 'it was not readable' }
  const { id, src, color } = raw
  if (!isStr(id) || !id) return { error: 'it had no id' }
  if (!isStr(src) || src.trim() === '') return { error: 'it had no equation' }
  let outcome: ReturnType<typeof parseSlopeField>
  try {
    outcome = parseSlopeField(src)
  } catch {
    return { error: 'the parser could not read it' }
  }
  if (!outcome.ok) return { error: outcome.error }

  // The stored constants are matched to the equation's own list by POSITION,
  // which is the order the parser reports them in and the order the sliders
  // are shown in. A shorter list (an older save, a hand-edited file) falls
  // back to the parser's defaults rather than leaving a slider at undefined.
  const stored = Array.isArray(raw.params) ? raw.params : []
  const params = outcome.defaultParams.map((d, i) => {
    const v = stored[i]
    return isNum(v) ? v : d
  })

  const solutions: FieldSolution[] = []
  const through = Array.isArray(raw.through) ? raw.through : []
  for (let i = 0; i + 1 < through.length && solutions.length < MAX_SOLUTIONS; i += 2) {
    const x = through[i]
    const y = through[i + 1]
    // A non-finite initial condition is not a curve anyone can integrate; it
    // is dropped on its own rather than taking the whole field with it.
    if (!isNum(x) || !isNum(y)) continue
    solutions.push({ id: newId(), x, y })
  }

  return {
    field: {
      id,
      src,
      params,
      color: isStr(color) && color ? color : '#4f9cf9',
      spacingPx: clampFieldSpacing(raw.spacing),
      visible: raw.hidden !== true,
      solutions,
    },
  }
}

/**
 * One link as JSON: own properties only, and only the ones its kind uses.
 *
 * The numbers are NOT rounded, for the same reason a curve's params are not:
 * a limit dragged exactly onto the end of a curve's domain, rounded up by a
 * millionth, lands outside it — and the integral that was there before the
 * reload politely refuses to exist after it.
 */
export function calcLinkToStored(l: CalcLink): StoredCalcLink {
  switch (l.kind) {
    case 'tangent':
      return {
        kind: 'tangent',
        id: l.id,
        parentId: l.parentId,
        curveId: l.curveId,
        x: l.x,
      }
    case 'derivative':
      return { kind: 'derivative', id: l.id, parentId: l.parentId, curveId: l.curveId }
    case 'area':
      return {
        kind: 'area',
        id: l.id,
        parentId: l.parentId,
        from: l.from,
        to: l.to,
        // false is the default, so it is not written: an unsigned toggle
        // nobody touched must not change the bytes.
        ...(l.abs === true ? { abs: true } : {}),
      }
    case 'riemann':
      return {
        kind: 'riemann',
        id: l.id,
        parentId: l.parentId,
        from: l.from,
        to: l.to,
        n: clampRiemannN(l.n),
        method: l.method,
      }
  }
}

/**
 * One link out of an untrusted blob. Null when it is not salvageable: every
 * field a link carries is load-bearing, and half a link would shade a region
 * the document never asked for.
 */
export function storedToCalcLink(raw: unknown): CalcLink | null {
  if (!isObj(raw)) return null
  const { id, parentId, curveId } = raw
  if (!isStr(id) || !id || !isStr(parentId) || !parentId) return null
  switch (raw.kind) {
    case 'tangent':
      if (!isStr(curveId) || !curveId || !isNum(raw.x)) return null
      return { kind: 'tangent', id, parentId, curveId, x: raw.x }
    case 'derivative':
      if (!isStr(curveId) || !curveId) return null
      return { kind: 'derivative', id, parentId, curveId }
    case 'area':
      if (!isNum(raw.from) || !isNum(raw.to)) return null
      return { kind: 'area', id, parentId, from: raw.from, to: raw.to, abs: raw.abs === true }
    case 'riemann':
      if (!isNum(raw.from) || !isNum(raw.to)) return null
      return {
        kind: 'riemann',
        id,
        parentId,
        from: raw.from,
        to: raw.to,
        n: clampRiemannN(raw.n),
        method: isMethod(raw.method) ? raw.method : 'left',
      }
    default:
      return null
  }
}

/** How a dropped link names itself in the load report. */
export function calcNoun(kind: CalcKind): string {
  switch (kind) {
    case 'tangent':
      return 'tangent line'
    case 'derivative':
      return 'derivative curve'
    case 'area':
      return 'shaded area'
    case 'riemann':
      return 'Riemann sum'
  }
}

/** Copy an item into a fresh, own-property-only record (no aliasing, no extras). */
function itemToStored(it: NLItem, style: CurveStyle | undefined): StoredNLItem {
  const styled =
    style &&
    (style.dash !== undefined ||
      style.opacity !== undefined ||
      style.width !== undefined ||
      style.group !== undefined)
      ? { style: { ...style } }
      : {}
  if (it.kind === 'point') {
    return {
      ...styled,
      kind: 'point',
      id: it.id,
      x: round(it.x, 6),
      closed: it.closed === true,
      color: it.color,
      ...(it.label !== undefined ? { label: it.label } : {}),
    }
  }
  return {
    ...styled,
    kind: 'interval',
    id: it.id,
    lo: it.lo === null ? null : round(it.lo, 6),
    hi: it.hi === null ? null : round(it.hi, 6),
    loClosed: it.loClosed === true,
    hiClosed: it.hiClosed === true,
    color: it.color,
    ...(it.label !== undefined ? { label: it.label } : {}),
  }
}

export function createDoc(name: string, board: StoredBoard, now = Date.now()): StoredDoc {
  return {
    version: SCHEMA_VERSION,
    id: newId(),
    name,
    createdAt: now,
    modifiedAt: now,
    board,
  }
}

export function emptyBoard(kind: BoardKind = 'cartesian'): StoredBoard {
  const board: StoredBoard = {
    curves: [],
    viewport: { cx: 0, cy: 0, ppu: 60 },
    selectedId: null,
    mode: 'draw',
  }
  if (kind === 'number-line') board.kind = 'number-line'
  return board
}

export function serializeDoc(doc: StoredDoc): string {
  return JSON.stringify(doc)
}

// ------------------------------------------------------------------ load side

/** Rebuild the ModelSpec for one typed curve. Returns null with a reason. */
function rebuildExprModel(
  modelId: string,
  source: string,
): { spec: ModelSpec } | { error: string } {
  let outcome: ReturnType<typeof parseExpression>
  try {
    outcome = parseExpression(source)
  } catch {
    return { error: 'the parser could not read it' }
  }
  if (!outcome.ok) return { error: outcome.error }
  try {
    return { spec: outcome.plot.makeModel(modelId) }
  } catch {
    return { error: 'the equation could not be turned back into a plot' }
  }
}

function storedToCurve(
  raw: unknown,
  problems: string[],
): { curve: FittedCurve; stored: StoredCurve } | null {
  if (!isObj(raw)) return null
  const { id, modelId, kind, color } = raw
  if (!isStr(id) || !id) return null
  if (!isStr(modelId) || !modelId) return null
  if (!isKind(kind)) return null

  const params = numArray(raw.params, MAX_PARAMS)
  if (!params) return null

  const strokeFlat =
    raw.stroke === undefined ? null : numArray(raw.stroke, MAX_STROKE_IN * 2, STROKE_DP)
  if (raw.stroke !== undefined && !strokeFlat) {
    problems.push(`Curve ${id}: unreadable stroke data was dropped.`)
  }

  let sourceStroke: Vec2[] | undefined
  if (strokeFlat && strokeFlat.length >= 2) {
    sourceStroke = []
    for (let i = 0; i + 1 < strokeFlat.length; i += 2) {
      sourceStroke.push({ x: strokeFlat[i], y: strokeFlat[i + 1] })
    }
  }

  const curve: FittedCurve = {
    id,
    modelId,
    params,
    kind,
    domain: domainOf(raw.domain),
    color: isStr(color) && color ? color : '#4f9cf9',
    strokeWidth: isNum(raw.strokeWidth) ? raw.strokeWidth : 2.5,
    visible: typeof raw.visible === 'boolean' ? raw.visible : true,
    error: isNum(raw.error) ? raw.error : 0,
    ...(sourceStroke ? { sourceStroke } : {}),
  }

  const stored: StoredCurve = {
    ...(raw as unknown as StoredCurve),
    id,
    modelId,
    params,
    kind,
    domain: curve.domain,
    color: curve.color,
    strokeWidth: curve.strokeWidth,
    visible: curve.visible,
    error: curve.error,
  }
  return { curve, stored }
}

function storedToCandidates(raw: unknown): FitResult[] {
  if (!Array.isArray(raw)) return []
  const out: FitResult[] = []
  for (const c of raw.slice(0, MAX_CANDIDATES)) {
    if (!isObj(c)) continue
    const params = numArray(c.params, MAX_PARAMS)
    if (!params || !isStr(c.modelId) || !isKind(c.kind)) continue
    out.push({
      modelId: c.modelId,
      params,
      kind: c.kind,
      domain: domainOf(c.domain),
      error: isNum(c.error) ? c.error : 0,
      score: isNum(c.score) ? c.score : 0,
    })
  }
  return out
}

/**
 * One stored item, validated. Returns null when it is not salvageable — an
 * interval with no finite ends at all, say, which would draw as the whole line
 * and silently claim every number.
 */
function storedToItem(raw: unknown): NLItem | null {
  if (!isObj(raw)) return null
  const id = raw.id
  if (!isStr(id) || !id) return null
  const color = isStr(raw.color) && raw.color ? raw.color : '#4f9cf9'
  const label =
    isStr(raw.label) && raw.label.trim() ? raw.label.slice(0, MAX_LABEL_CHARS) : undefined

  if (raw.kind === 'point') {
    if (!isNum(raw.x)) return null
    return {
      kind: 'point',
      id,
      x: raw.x,
      closed: raw.closed !== false,
      color,
      ...(label !== undefined ? { label } : {}),
    }
  }
  if (raw.kind !== 'interval') return null
  const lo = raw.lo === null ? null : isNum(raw.lo) ? raw.lo : undefined
  const hi = raw.hi === null ? null : isNum(raw.hi) ? raw.hi : undefined
  if (lo === undefined || hi === undefined) return null
  // (-inf, inf) is not an interval a teacher draws; it is a damaged record.
  if (lo === null && hi === null) return null
  if (lo !== null && hi !== null && hi < lo) return null
  return {
    kind: 'interval',
    id,
    lo,
    hi,
    loClosed: raw.loClosed === true,
    hiClosed: raw.hiClosed === true,
    color,
    ...(label !== undefined ? { label } : {}),
  }
}

function styleOf(raw: unknown): CurveStyle | null {
  if (!isObj(raw)) return null
  const style: CurveStyle = {}
  const dash = numArray(raw.dash, 8)
  if (dash && dash.length > 0) style.dash = dash
  if (isNum(raw.opacity)) style.opacity = Math.min(1, Math.max(0, raw.opacity))
  if (isNum(raw.width)) style.width = Math.min(64, Math.max(0.5, raw.width))
  if (isStr(raw.group) && raw.group.trim()) style.group = raw.group.slice(0, 64)
  return style.dash ||
    style.opacity !== undefined ||
    style.width !== undefined ||
    style.group !== undefined
    ? style
    : null
}

/**
 * Turn a parsed (but untrusted) document into live board state.
 * Never throws: whatever is individually valid is kept, the rest is reported.
 */
export function hydrateDoc(rawDoc: unknown): LoadResult {
  const problems: string[] = []
  let degraded = false

  if (!isObj(rawDoc)) {
    return { meta: null, board: null, problems: ['The saved file is not a document.'], degraded: true }
  }

  const version = isNum(rawDoc.version) ? rawDoc.version : 0
  if (version > SCHEMA_VERSION) {
    problems.push(
      `This document was saved by a newer version of Grapher (format ${version}; this app reads ${SCHEMA_VERSION}). Anything it doesn't recognise was skipped.`,
    )
    degraded = true
  } else if (version < SILENT_UPGRADE_FROM) {
    problems.push(`Upgraded this document from format ${version} to ${SCHEMA_VERSION}.`)
  }
  // Between SILENT_UPGRADE_FROM and current the formats differ only by fields
  // that were added, never moved or reinterpreted, so there is nothing to say:
  // announcing an upgrade that changed nothing would put a "restored with
  // changes" banner over every document a teacher already had.

  const meta: DocMeta = {
    id: isStr(rawDoc.id) && rawDoc.id ? rawDoc.id : newId(),
    name: isStr(rawDoc.name) && rawDoc.name.trim() ? rawDoc.name : 'Untitled',
    createdAt: isNum(rawDoc.createdAt) ? rawDoc.createdAt : Date.now(),
    modifiedAt: isNum(rawDoc.modifiedAt) ? rawDoc.modifiedAt : Date.now(),
  }

  const rawBoard = isObj(rawDoc.board) ? rawDoc.board : null
  if (!rawBoard) {
    problems.push('The document had no board; started an empty one.')
    return { meta, board: blankHydrated(), problems, degraded: true }
  }

  // viewport — a silently reset view is confusing, so say when we had to
  const rawVp = isObj(rawBoard.viewport) ? rawBoard.viewport : {}
  if ('viewport' in rawBoard) {
    const readable = isObj(rawBoard.viewport) && isNum(rawVp.cx) && isNum(rawVp.cy) && isNum(rawVp.ppu)
    if (!readable) {
      problems.push('The saved view position was unreadable; the view was reset.')
      degraded = true
    }
  }
  const ppuRaw = isNum(rawVp.ppu) ? rawVp.ppu : 60
  const viewport = {
    center: { x: isNum(rawVp.cx) ? rawVp.cx : 0, y: isNum(rawVp.cy) ? rawVp.cy : 0 },
    pxPerUnit: Math.min(100000, Math.max(0.001, ppuRaw)),
  }

  // curves
  const curves: FittedCurve[] = []
  const styles: StyleMap = {}
  const candidates = new Map<string, FitResult[]>()
  const extraModels: Record<string, ModelSpec> = {}
  const exprSources: Record<string, string> = {}
  const displaySources: Record<string, string> = {}
  const brokenExpr: Record<string, string> = {}
  let exprCounter = 0

  const rawCurves = Array.isArray(rawBoard.curves) ? rawBoard.curves : []
  if (!Array.isArray(rawBoard.curves)) {
    problems.push('The curve list was unreadable.')
    degraded = true
  }
  if (rawCurves.length > MAX_CURVES) {
    problems.push(`Only the first ${MAX_CURVES} curves were loaded.`)
    degraded = true
  }

  let dropped = 0
  const seen = new Set<string>()
  for (const raw of rawCurves.slice(0, MAX_CURVES)) {
    const built = storedToCurve(raw, problems)
    if (!built) {
      dropped++
      continue
    }
    const { curve, stored } = built
    if (seen.has(curve.id)) {
      dropped++
      continue
    }
    seen.add(curve.id)

    // Typed equations: rebuild the model closure from its source text.
    if (isStr(stored.exprSource) && stored.exprSource.trim()) {
      const source = stored.exprSource
      exprSources[curve.id] = source
      const m = /^expr_(\d+)$/.exec(curve.modelId)
      if (m) exprCounter = Math.max(exprCounter, Number(m[1]))
      const rebuilt = rebuildExprModel(curve.modelId, source)
      if ('spec' in rebuilt) {
        extraModels[curve.modelId] = rebuilt.spec
      } else {
        brokenExpr[curve.id] = rebuilt.error
        problems.push(`“${source}” could not be restored: ${rebuilt.error}`)
        degraded = true
      }
    }

    // A family's own typed form. It never builds a model — it is only what
    // the card prints — so it is read for every curve, expression or not.
    if (isStr(stored.displaySource) && stored.displaySource.trim()) {
      displaySources[curve.id] = stored.displaySource
    }

    const style = styleOf(stored.style)
    if (style) styles[curve.id] = style
    const cands = storedToCandidates(stored.candidates)
    if (cands.length > 0) candidates.set(curve.id, cands)
    curves.push(curve)
  }

  if (dropped > 0) {
    problems.push(`${dropped} damaged curve${dropped === 1 ? '' : 's'} could not be read.`)
    degraded = true
  }

  // ---- board kind + number-line items
  // An unknown kind is read as cartesian: that is the board every document was
  // before this field existed, and it never loses anything that is on disk.
  const kind: BoardKind = rawBoard.kind === 'number-line' ? 'number-line' : 'cartesian'
  const items: NLItem[] = []
  const rawItems = Array.isArray(rawBoard.items) ? rawBoard.items : []
  if (rawBoard.items !== undefined && !Array.isArray(rawBoard.items)) {
    problems.push('The number-line item list was unreadable.')
    degraded = true
  }
  if (rawItems.length > MAX_ITEMS) {
    problems.push(`Only the first ${MAX_ITEMS} number-line items were loaded.`)
    degraded = true
  }
  let droppedItems = 0
  for (const raw of rawItems.slice(0, MAX_ITEMS)) {
    const item = storedToItem(raw)
    if (!item || seen.has(item.id)) {
      droppedItems++
      continue
    }
    seen.add(item.id)
    const st = isObj(raw) ? styleOf(raw.style) : null
    if (st) styles[item.id] = st
    items.push(item)
  }
  if (droppedItems > 0) {
    problems.push(
      `${droppedItems} damaged number-line item${droppedItems === 1 ? '' : 's'} could not be read.`,
    )
    degraded = true
  }

  // ---- calculus objects
  //
  // The links come back first, then the model closures the derivative curves
  // among them need. A link is only kept when everything it names is still
  // here; anything else is reported rather than dropped in silence, because a
  // tangent that quietly stops existing is a lesson that quietly stops working.
  const calc: CalcLink[] = []
  const derivCounter = { value: 0 }
  const rawCalc = Array.isArray(rawBoard.calc) ? rawBoard.calc : []
  if (rawBoard.calc !== undefined && !Array.isArray(rawBoard.calc)) {
    problems.push('The list of calculus objects was unreadable.')
    degraded = true
  }
  if (rawCalc.length > MAX_CALC) {
    problems.push(`Only the first ${MAX_CALC} calculus objects were loaded.`)
    degraded = true
  }
  {
    const curveIds = new Set(curves.map((c) => c.id))
    const seenLinks = new Set<string>()
    let damaged = 0
    for (const raw of rawCalc.slice(0, MAX_CALC)) {
      const link = storedToCalcLink(raw)
      if (!link || seenLinks.has(link.id)) {
        damaged++
        continue
      }
      if (!curveIds.has(link.parentId)) {
        problems.push(
          `A ${calcNoun(link.kind)} was dropped: the curve it belonged to is no longer in this document.`,
        )
        degraded = true
        continue
      }
      if (isCurveLink(link) && !curveIds.has(link.curveId)) {
        problems.push(
          `A ${calcNoun(link.kind)} was dropped: the curve it drew is no longer in this document.`,
        )
        degraded = true
        continue
      }
      seenLinks.add(link.id)
      calc.push(link)
    }
    if (damaged > 0) {
      problems.push(
        `${damaged} damaged calculus object${damaged === 1 ? '' : 's'} could not be read.`,
      )
      degraded = true
    }
  }

  // A derivative that had to be differentiated numerically lives in a closure,
  // exactly like a typed expression, and is rebuilt the same way: from the
  // thing that defines it, which here is its parent curve rather than a line of
  // text. A library-family derivative (a cubic's parabola) needs nothing.
  {
    const byId = new Map(curves.map((c) => [c.id, c]))
    const lost = new Set<string>()
    for (const link of calc) {
      if (link.kind !== 'derivative') continue
      const child = byId.get(link.curveId)
      const parent = byId.get(link.parentId)
      if (!child || !parent) continue
      const m = new RegExp(`^${DERIV_MODEL_PREFIX}(\\d+)$`).exec(child.modelId)
      if (m) derivCounter.value = Math.max(derivCounter.value, Number(m[1]))
      if (MODELS[child.modelId] ?? extraModels[child.modelId]) continue
      let built: ReturnType<typeof derivativeModel> = null
      try {
        built = derivativeModel(parent, { ...MODELS, ...extraModels }, child.modelId)
      } catch {
        built = null
      }
      if (built && built.spec.id === child.modelId) {
        extraModels[child.modelId] = built.spec
        continue
      }
      // Nothing can draw this curve any more. Its only reason to exist was the
      // link, so both go, and the report says so.
      problems.push(
        'A derivative curve could not be rebuilt from the curve it came from, so it was removed.',
      )
      degraded = true
      lost.add(link.id)
      lost.add(`curve:${child.id}`)
    }
    if (lost.size > 0) {
      for (let i = calc.length - 1; i >= 0; i--) {
        if (lost.has(calc[i].id)) calc.splice(i, 1)
      }
      for (let i = curves.length - 1; i >= 0; i--) {
        if (lost.has(`curve:${curves[i].id}`)) curves.splice(i, 1)
      }
    }
  }

  // ---- slope fields
  //
  // A field is pure text plus a handful of numbers, so it is rebuilt exactly
  // the way a typed curve is: re-parse the sentence, and if the parser refuses
  // it now, say so. There is no half-field to keep — without the closure there
  // is no lattice and no solution curve — so it is dropped, loudly.
  const fields: BoardField[] = []
  const rawFields = Array.isArray(rawBoard.fields) ? rawBoard.fields : []
  if (rawBoard.fields !== undefined && !Array.isArray(rawBoard.fields)) {
    problems.push('The list of slope fields was unreadable.')
    degraded = true
  }
  if (rawFields.length > MAX_FIELDS) {
    problems.push(`Only the first ${MAX_FIELDS} slope fields were loaded.`)
    degraded = true
  }
  for (const raw of rawFields.slice(0, MAX_FIELDS)) {
    const built = storedToField(raw)
    if ('error' in built) {
      const src = isObj(raw) && isStr(raw.src) ? raw.src : null
      problems.push(
        src
          ? `The slope field “${src}” could not be restored: ${built.error}`
          : `A slope field could not be restored: ${built.error}`,
      )
      degraded = true
      continue
    }
    if (seen.has(built.field.id)) {
      problems.push('A slope field was dropped: two of them claimed the same id.')
      degraded = true
      continue
    }
    seen.add(built.field.id)
    fields.push(built.field)
  }

  // ---- shapes
  //
  // One typed line each, rebuilt the way a field is: re-parse, and if the
  // parser refuses it now, say so. There is no half-shape to keep — without
  // the coordinates there is nothing to draw — so it is dropped, loudly.
  const shapes: BoardShape[] = []
  const rawShapes = Array.isArray(rawBoard.shapes) ? rawBoard.shapes : []
  if (rawBoard.shapes !== undefined && !Array.isArray(rawBoard.shapes)) {
    problems.push('The list of shapes was unreadable.')
    degraded = true
  }
  if (rawShapes.length > MAX_SHAPES) {
    problems.push(`Only the first ${MAX_SHAPES} shapes were loaded.`)
    degraded = true
  }
  for (const raw of rawShapes.slice(0, MAX_SHAPES)) {
    const built = storedToShape(raw)
    if ('error' in built) {
      const src = isObj(raw) && isStr(raw.src) ? raw.src : null
      problems.push(
        src
          ? `The shape “${src}” could not be restored: ${built.error}`
          : `A shape could not be restored: ${built.error}`,
      )
      degraded = true
      continue
    }
    if (seen.has(built.shape.id)) {
      problems.push('A shape was dropped: two of them claimed the same id.')
      degraded = true
      continue
    }
    seen.add(built.shape.id)
    shapes.push(built.shape)
  }

  // ---- the ruling. Unreadable or absent is not a repair: it is the default.
  const grid = storedGrid(rawBoard.grid)

  // ---- the figure style. Absence is the default and says nothing. A NAMED
  // style this build does not have is different: the document asked for a look
  // and did not get it, and a figure that silently came back in the wrong one
  // would be pasted into a worksheet before anybody noticed.
  const figure = storedFigureStyle(rawBoard.figure)
  if (rawBoard.figure !== undefined && !isFigureStyleId(rawBoard.figure)) {
    problems.push(
      isStr(rawBoard.figure)
        ? `This board asked for the “${rawBoard.figure}” figure style, which this version doesn’t have; it was drawn in the screen style.`
        : 'This board’s figure style was unreadable; it was drawn in the screen style.',
    )
    degraded = true
  }
  const caption = storedCaption(rawBoard.caption)

  // ---- axis units. Unreadable or absent is not a repair: it is the default.
  const rawAxis = isObj(rawBoard.axisUnits) ? rawBoard.axisUnits : {}
  const axisUnits: AxisUnitChoices = {
    x: storedAxisUnit(rawAxis.x),
    y: storedAxisUnit(rawAxis.y),
  }

  const selectable = new Set<string>([
    ...curves.map((c) => c.id),
    ...items.map((i) => i.id),
    ...fields.map((f) => f.id),
    ...shapes.map((s) => s.id),
  ])
  const selectedId =
    isStr(rawBoard.selectedId) && selectable.has(rawBoard.selectedId)
      ? rawBoard.selectedId
      : null
  const mode: BoardMode = rawBoard.mode === 'pan' ? 'pan' : 'draw'

  return {
    meta,
    board: {
      curves,
      kind,
      items,
      styles,
      candidates,
      extraModels,
      exprSources,
      displaySources,
      brokenExpr,
      axisUnits,
      calc,
      fields,
      shapes,
      grid,
      figure,
      caption,
      viewport,
      selectedId,
      mode,
      exprCounter,
      derivCounter: derivCounter.value,
    },
    problems,
    degraded,
  }
}

function blankHydrated(): HydratedBoard {
  return {
    curves: [],
    kind: 'cartesian',
    items: [],
    styles: {},
    candidates: new Map(),
    extraModels: {},
    exprSources: {},
    displaySources: {},
    brokenExpr: {},
    axisUnits: { ...AUTO_AXIS_UNITS },
    calc: [],
    fields: [],
    shapes: [],
    grid: 'cartesian',
    figure: 'screen',
    caption: '',
    viewport: { center: { x: 0, y: 0 }, pxPerUnit: 60 },
    selectedId: null,
    mode: 'draw',
    exprCounter: 0,
    derivCounter: 0,
  }
}

/** Parse a stored JSON string. Never throws — a hostile blob yields a report. */
export function deserializeDoc(json: string): LoadResult {
  if (typeof json !== 'string' || json.trim() === '') {
    return { meta: null, board: null, problems: ['The saved document was empty.'], degraded: true }
  }
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return {
      meta: null,
      board: null,
      problems: ['The saved document is corrupted (it isn’t valid JSON) and could not be opened.'],
      degraded: true,
    }
  }
  return hydrateDoc(raw)
}

/** Round-trip helper used by save: live board -> full document record. */
export function docFromBoard(meta: DocMeta, input: BoardInput, now = Date.now()): StoredDoc {
  return {
    version: SCHEMA_VERSION,
    id: meta.id,
    name: meta.name,
    createdAt: meta.createdAt,
    modifiedAt: now,
    board: boardToStored(input),
  }
}

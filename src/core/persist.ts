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
  NLSolveShow,
  CurveEnds,
  EndCap,
  Vec2,
} from './types'
import { FIGURE_STYLES } from './types'
import { namedCallSites, parseExpression } from './parse'
import type { FunctionEnv } from './functionEnv'
import { parseSlopeField } from './parse/slopeField'
import { parseShape } from './parse/shapes'
import { MODELS } from './fit/models'
import { accumulationModel, derivativeModel } from './calculus'
import { TAYLOR_N_DEFAULT, TAYLOR_N_MAX, TAYLOR_N_MIN } from './taylor'
import type { RiemannMethod } from './calculus'
import { RR_DEFS, RR_SCENARIOS, cleanParams } from './relatedRates'
import type { RRScenario } from './relatedRates'
import type { SectionShape, VolumeAxis, VolumeMethod } from './volume'
import { isSectionShape } from './volume'
import type { RegressionKind } from './data'
import type { InvFn, UnwrapFn } from './trig'

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
  /** End caps (arrow / open dot / closed dot) per end; absent = 'auto'. */
  ends?: CurveEnds
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

/** Which of the calculus objects a link describes. */
export type CalcKind =
  | 'tangent'
  | 'derivative'
  | 'area'
  | 'riemann'
  | 'accumulation'
  | 'taylor'
  | 'secant'
  | 'limit'
  | 'volume'
  | 'signchart'
  | 'pcalc'
  | 'polarbetween'

/** A tangent line at one point of `parentId`, drawn as the curve `curveId`. */
export interface TangentLink {
  kind: 'tangent'
  id: string
  parentId: string
  /**
   * The `line` curve this link drives; it lives and dies with the link. On an
   * implicit parent it is a `line` or, at a vertical tangent, a `vline`.
   */
  curveId: string
  x: number
  /**
   * Implicit parents only (x² + y² = 25): the point's y — which branch x is
   * on. The point is re-found on the curve from (x, y) on every change.
   * Written only when present, so every explicit tangent stores what it did.
   */
  y?: number
  /** Implicit parents only: the horizontal and vertical tangents marked on the board. */
  marks?: true
}

/** f′ of `parentId`, drawn as the curve `curveId`. */
export interface DerivativeLink {
  kind: 'derivative'
  id: string
  parentId: string
  curveId: string
}

/**
 * The signed region between `parentId` and the x-axis over [from, to] — or,
 * when `otherId` names a second curve, the region BETWEEN the two curves.
 *
 * Between curves the number is ∫(f − g) dx with f the parent and g the
 * other; `abs` then means ∫|f − g| — the area between them in the AP sense,
 * top minus bottom wherever they cross — rather than |∫(f − g)|. Deleting
 * either curve removes the link. Contract for the halves:
 *   src/core/calculus.ts   areaBetween(parent, other, models, a, b, abs): AreaResult | null
 *                          curveIntersections(parent, other, models, range): number[]
 *   src/ui/calcLinks.ts    defaultBetweenBounds(parent, other, models, window)
 *                          areaReadout / overlaysFor / cardCalc / dependentsOf /
 *                          followDomains all understand `otherId`
 */
export interface AreaLink {
  kind: 'area'
  id: string
  parentId: string
  /** The second curve, for an area between curves. Absent: the x-axis. */
  otherId?: string
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

/**
 * The accumulation function g(x) = C + ∫ₐˣ f(t) dt of `parentId`, drawn as the
 * curve `curveId` — the AP free-response "the graph of f is shown" picture.
 *
 * `x` is the probe: where the card reads g(x) out and the region from a to x
 * is shaded. Absent means no probe. `C` absent means 0, and is not written
 * when it is 0, so the common case stores four fields and a number.
 *   src/core/calculus.ts  accumulationModel(parent, models, a, C, modelId)
 *   src/ui/calcLinks.ts   accumReadout / accumFacts / overlaysFor / cardCalc
 */
export interface AccumulationLink {
  kind: 'accumulation'
  id: string
  parentId: string
  curveId: string
  /** The lower limit. */
  a: number
  /** g(a). */
  C: number
  /** The probe x, when there is one. */
  x?: number
}

/**
 * The Taylor polynomial Pₙ of `parentId` about x = a, drawn as the curve
 * `curveId` (model `tay_<link id>`, rebuilt from the parent on load and on
 * every change — nothing computed is stored).
 *
 * `x` is the probe: where the card reads Pₙ(x), f(x), the actual error and
 * the Lagrange (and, when it applies, alternating series) bound. `band` shows
 * the Lagrange error band Pₙ ± R(x) on the board; `ioc` shades the interval
 * of convergence on the x-axis. Both default off and are not written when
 * off, nor is an absent probe.
 *   src/core/taylor.ts   taylorSourceOf / taylorPolynomial / taylorModel /
 *                        lagrangeBound / alternatingBound / errorBand /
 *                        convergence
 */
export interface TaylorLink {
  kind: 'taylor'
  id: string
  parentId: string
  curveId: string
  /** the center */
  a: number
  /** the degree, an integer in [TAYLOR_N_MIN, TAYLOR_N_MAX] */
  n: number
  /** the probe x, when there is one */
  x?: number
  band?: boolean
  ioc?: boolean
}

/** The model id a Taylor polynomial registers under: this prefix + the link id. */
export const TAYLOR_MODEL_PREFIX = 'tay_'

/**
 * The secant line of `parentId` through (a, f(a)) and (b, f(b)): the average
 * rate of change over [a, b], and — switched on — the Mean Value Theorem
 * (`mvt`: its hypotheses, every c with f′(c) equal to the secant's slope, the
 * tangent lines there) and the average value (`avg`: f_avg, the rectangle of
 * that height, every c with f(c) = f_avg).
 *
 * The secant is the figure's own line, drawn as an overlay rather than a
 * curve: it holds no letter and gets no analysis. Nothing computed is stored;
 * the switches are written only when on.
 *   src/core/mvt.ts        secantOf / continuityOn / differentiabilityOn /
 *                          mvtPoints / averageValue / mvtSourceOf
 *   src/ui/secantLinks.ts  secantRow / secantOverlays / defaultSecant
 */
export interface SecantLink {
  kind: 'secant'
  id: string
  parentId: string
  a: number
  b: number
  mvt?: true
  avg?: true
}

/**
 * lim x→a of `parentId`: the left, right and two-sided limits, f(a), what
 * kind of point a is and the AP continuity checklist — and, switched on, the
 * table of values (`table`) and the ε–δ picture (`epsilon`, with ε in `eps`).
 *
 * `a` may be ±Infinity for a limit at infinity. JSON has no Infinity (it
 * would write null), so in the FILE ±∞ is the string sentinel 'inf' / '-inf'
 * (LIMIT_INF / LIMIT_NEG_INF); every finite a is an ordinary number. `side` is
 * written only when it is not 'both', `table` and `epsilon` only when on, and
 * `eps` only while the ε–δ picture is on and ε is not the default 0.5 — so
 * nothing about a limit reaches a file that never had one.
 *   src/core/limits.ts    limitAt / limitTable / deltaFor / limitPoints /
 *                         limitSourceOf
 *   src/ui/limitLinks.ts  limitRow / limitOverlays / defaultLimitA
 */
export interface LimitLink {
  kind: 'limit'
  id: string
  parentId: string
  /** The point approached; ±Infinity for x → ±∞. */
  a: number
  side?: 'both' | 'left' | 'right'
  table?: true
  epsilon?: true
  /** ε for the ε–δ picture; absent means LIMIT_EPS_DEFAULT. */
  eps?: number
}

/** ±∞ in a stored limit link (JSON cannot hold Infinity). */
export const LIMIT_INF = 'inf'
export const LIMIT_NEG_INF = '-inf'
/** ε when the link does not say. */
export const LIMIT_EPS_DEFAULT = 0.5
/** ε's range on the card's slider; a file cannot carry an ε outside it. */
export const LIMIT_EPS_MIN = 0.01
export const LIMIT_EPS_MAX = 2

/**
 * The volume of a solid built on the region between `parentId` and `otherId`
 * (absent: the x-axis) over [a, b] — the same region the area-between link
 * shades. `method` says how it is cut: washers/disks, shells, or known
 * cross-sections perpendicular to the x-axis (`section`, with `ratio` for a
 * rectangle's height). `axis` is the axis of revolution, y = at ('h') or
 * x = at ('v'); absent means the x-axis. `x` is the representative slice —
 * the slice's x for the dx methods and its y for the two that slice in dy
 * (washers about a vertical axis, shells about a horizontal one); absent
 * means the middle.
 *
 * Only what is not the default reaches a file: `method` when not 'washer',
 * `axis` when not the x-axis, `section` only for sections and only when not
 * 'square', `ratio` only for a rectangle and only when not 1, `perp: 'y'`
 * only for sections perpendicular to the y-axis (absent: the x-axis — every
 * older file), `x` only when set. Deleting either curve removes the link.
 *   src/core/volume.ts     washerVolume / shellVolume / sectionVolume /
 *                          horizontalBands / washerVolumeDy / shellVolumeDy /
 *                          exactVolume
 *   src/ui/volumeLinks.ts  volumeRow / volumeOverlays / defaultVolume
 */
export interface VolumeLink {
  kind: 'volume'
  id: string
  parentId: string
  otherId?: string
  a: number
  b: number
  method: VolumeMethod
  axis?: VolumeAxis
  section?: SectionShape
  ratio?: number
  /** Sections only: perpendicular to the y-axis. Absent: to the x-axis. */
  perp?: 'y'
  x?: number
}

/** f, f′, f″ — a sign chart's rows, and what its curve is taken to be. */
export type SignLevel = 'f' | 'f1' | 'f2'
export const SIGN_LEVELS: readonly SignLevel[] = ['f', 'f1', 'f2']

/**
 * The sign chart of `parentId` (AP Calculus Unit 5): strips along the bottom
 * of the board for f, f′ and f″ (`rows`, top to bottom in that order), each
 * with its critical x's, "0" / "und" at them and + / − between; the AP
 * statements they justify on the card; and — `as` — "treat this graph as f′"
 * (or f″), the AP classic, where the same machinery reasons about the unseen
 * f: f increases where the shown graph is positive, and so on.
 *
 * `arrows` adds a row of ↗ ↘ for f, `cup` a row of ∪ ∩, `guides` dashed lines
 * from each critical x up through the graph; `a`/`b` is the closed interval
 * for the Candidates Test. Nothing computed is stored. `rows` is always
 * written (it is the chart); `as` only when it is not 'f', the switches only
 * when on, a and b only as a pair.
 *   src/core/signChart.ts     signChart / conclusions / chartSourceOf
 *   src/ui/signChartLinks.ts  signChartRow / signChartFigures
 */
export interface SignChartLink {
  kind: 'signchart'
  id: string
  parentId: string
  /** What the curve IS: absent means f. */
  as?: 'f1' | 'f2'
  /** Which strips, a subset of SIGN_LEVELS at or after `as`, in that order. */
  rows: SignLevel[]
  arrows?: true
  cup?: true
  guides?: true
  /** The Candidates Test interval [a, b], when one is set. */
  a?: number
  b?: number
}

/** The rows a chart may show when its curve is `as`: f′ has no f row. */
export function signRowsFor(as: SignLevel | undefined): SignLevel[] {
  const from = SIGN_LEVELS.indexOf(as ?? 'f')
  return SIGN_LEVELS.slice(Math.max(0, from))
}

/** Rows as a file may hold them: known, allowed for `as`, once each, in order. */
export function cleanSignRows(rows: unknown, as: SignLevel | undefined): SignLevel[] {
  const ok = signRowsFor(as)
  const want = Array.isArray(rows) ? rows : []
  return ok.filter((r) => want.includes(r))
}

/**
 * Parametric / polar calculus at one point of `parentId` (AP Calculus BC
 * Unit 9): dx/dt, dy/dt, dy/dx and d²y/dx² written out, and at the chosen
 * parameter `t` (θ for a polar curve) the point, the tangent line (drawn),
 * speed, velocity and acceleration — for polar r, r′ and what r′ says about
 * the pole; the horizontal / vertical tangents and singular points of the
 * interval (`marks`: drawn on the board too); the arc length over [a, b]
 * (absent: the curve's own interval) with, for a parametric curve, the
 * displacement beside the distance travelled.
 *
 * Nothing computed is stored: `t` always, `marks` only when on, a and b only
 * as a pair — so a file that never had one is byte-for-byte what it was.
 *   src/core/paramCalc.ts       paramSymbolic / atParam / tangentLists /
 *                               arcLengthOf
 *   src/ui/paramCalcLinks.ts    paramCalcRow / paramCalcOverlays
 */
export interface ParamCalcLink {
  kind: 'pcalc'
  id: string
  parentId: string
  /** The chosen parameter: t, or θ for a polar curve. */
  t: number
  /** The horizontal and vertical tangents (and singular points) marked on the board. */
  marks?: true
  /** The arc-length interval; absent: the curve's own. */
  a?: number
  b?: number
}

/**
 * The area inside one polar curve and outside another — the AP classic
 * "inside r = 3 sin θ, outside r = 1 + sin θ": ½∫(R² − r²) dθ between the
 * θ where they meet, the region shaded. By default the region is inside the
 * parent and outside `otherId`; `swap` turns it round. a and b are the
 * θ-bounds when the teacher set them (a pair, or absent: the meetings around
 * the region, re-found on every change). Deleting either curve removes it.
 *   src/core/paramCalc.ts      polarIntersections / defaultBetweenBounds /
 *                              polarBetween / betweenRegion
 *   src/ui/paramCalcLinks.ts   polarBetweenRow / polarBetweenOverlays
 */
export interface PolarBetweenLink {
  kind: 'polarbetween'
  id: string
  parentId: string
  otherId: string
  /** Inside the other curve and outside the parent. */
  swap?: true
  a?: number
  b?: number
}

export type CalcLink =
  | TangentLink
  | DerivativeLink
  | AreaLink
  | RiemannLink
  | AccumulationLink
  | TaylorLink
  | SecantLink
  | LimitLink
  | VolumeLink
  | SignChartLink
  | ParamCalcLink
  | PolarBetweenLink

/** The links that own a curve of their own. */
export type CurveLink = TangentLink | DerivativeLink | AccumulationLink | TaylorLink

export const isCurveLink = (l: CalcLink): l is CurveLink =>
  l.kind === 'tangent' || l.kind === 'derivative' || l.kind === 'accumulation' || l.kind === 'taylor'

// --- inverses and names -----------------------------------------------------
//
// "Show inverse" on ANY function: the relation x = f(y), drawn as the
// parametric curve (f(t), t) under `inv_<link id>`. Like a derivative curve it
// is a LINK plus a curve whose model is rebuilt from the parent on load and
// follows the parent live; nothing computed is stored. `from`/`to` is the
// stretch of the parent's x the inverse reflects — fixed when it was asked
// for, so a reopened document reflects the same stretch.
//
// Curve NAMES (f, g, h …) are stored per curve (`StoredCurve.name`), and so
// are the names a typed line CALLS (`StoredCurve.calls`) — the letters its
// `f(x − 1)`, `f'(x)` are calls of rather than sliders. Both are omitted when
// absent, so every document written before them serialises byte-for-byte as
// it did. See src/ui/nameLinks.ts for what they mean.

/** The inverse of `parentId`, drawn as the parametric curve `curveId`. */
export interface InverseLink {
  id: string
  parentId: string
  curveId: string
  /** The parent's x-range the relation is drawn over. */
  from: number
  to: number
}

/** The model id an inverse relation registers under: this prefix + the link id. */
export const INV_MODEL_PREFIX = 'inv_'

/** One inverse link as JSON (all fields load-bearing). */
export interface StoredInverseLink {
  id: string
  parentId: string
  curveId: string
  from: number
  to: number
}

/** A curve name: one ASCII letter. */
const isNameLetter = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z]$/.test(v)

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
  /**
   * Euler's-method runs on this field. Optional, and absent (not []) on a
   * field that has none, so every field built before Euler existed is still
   * the same object — and still the same bytes on disk.
   */
  eulers?: EulerRun[]
}

/**
 * One run of Euler's method: the start point, the step and the number of
 * steps. Exactly what a student is given on the exam, and nothing computed —
 * the table, the path and the verdict are all re-asked of the field on every
 * change (src/core/euler.ts), so a slider drag moves the whole table live.
 */
export interface EulerRun {
  id: string
  x0: number
  y0: number
  /** Step size. Nonzero; negative steps to the left. */
  h: number
  /** Number of steps, an integer in [EULER_N_MIN, EULER_N_MAX]. */
  n: number
  /** Also draw the true solution through (x0, y0), dashed. */
  showTrue?: true
  /** Label the points P₀, P₁, … on the board. */
  labels?: true
}

/** Steps a run may take. 50 is already more rows than a card can show usefully. */
export const EULER_N_MIN = 1
export const EULER_N_MAX = 50
/** Runs one field may carry — comparing h = 0.5, 0.25, 0.125 is three. */
export const MAX_EULER_RUNS = 12

/** Integerise and clamp a step count — the card's input and the loader agree. */
export function clampEulerN(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 4
  return Math.min(EULER_N_MAX, Math.max(EULER_N_MIN, Math.round(v)))
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

// --- data tables --------------------------------------------------------------
//
// A table of (x, y) rows a teacher typed or pasted, drawn as a scatter plot,
// and the regressions fitted to it. Same rule again: what is stored is the
// TEACHER'S TEXT — every cell exactly as typed, numbers parsed on use — and
// the regressions as LINKS ({kind, curveId, digits}), never as coefficients.
// Each regression's curve is an ordinary typed curve (its source is the
// fitted equation), so it is stored with the curves; the link only says which
// curve follows which table, and it is re-fitted from the rows on load.

/** How a table's points are drawn. Mirrors render/scatter's ScatterMarker. */
export type DataMarker = 'dot' | 'ring' | 'cross' | 'square'

const DATA_MARKERS: readonly DataMarker[] = ['dot', 'ring', 'cross', 'square']

/** Coefficient digits a regression's equation is written with. */
export const REG_DIGITS_MIN = 2
export const REG_DIGITS_MAX = 6
export const REG_DIGITS_DEFAULT = 4

/** Integerise and clamp a digits count. One rule, shared with the card. */
export function clampRegDigits(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return REG_DIGITS_DEFAULT
  return Math.min(REG_DIGITS_MAX, Math.max(REG_DIGITS_MIN, Math.round(v)))
}

const REG_KINDS: readonly RegressionKind[] = [
  'linear', 'quadratic', 'cubic', 'quartic',
  'exponential', 'power', 'logarithmic', 'logistic', 'sinusoidal',
]

export const isRegressionKind = (v: unknown): v is RegressionKind =>
  typeof v === 'string' && (REG_KINDS as readonly string[]).includes(v)

/** One regression fitted to a table: which model, which curve draws it. */
export interface DataRegression {
  id: string
  kind: RegressionKind
  /** The typed curve the fit writes into. */
  curveId: string
  /** Coefficient digits, REG_DIGITS_MIN..MAX. */
  digits: number
  /** Draw each point's residual to this curve. At most one per table. */
  residuals: boolean
  /**
   * The curve's equation was edited by hand, so it no longer follows the
   * table: it is an ordinary curve, and the card says so.
   */
  detached?: boolean
}

/** One cell pair as the teacher typed it. */
export interface DataRow {
  x: string
  y: string
}

/** A data table as the board holds it. The rows are the only truth. */
export interface BoardData {
  id: string
  name: string
  xLabel: string
  yLabel: string
  rows: DataRow[]
  color: string
  visible: boolean
  /** Absent = dot. */
  marker?: DataMarker
  regressions: DataRegression[]
}

// --- sequences ----------------------------------------------------------------
//
// A sequence (src/core/sequences.ts) — a_n = 3 + 4(n − 1), a recursion, or a
// typed list of terms — drawn as the dots (n, aₙ). Same rule as everything
// else here: what is stored is the LINE THE TEACHER TYPED, the constants its
// sliders are at, the index window and two toggles. The terms, the partial
// sums, the classification and the continuous partner are all recomputed from
// the line on every change, so none of them can go stale.
//
// Unlike a field or a shape, a sequence whose line no longer parses is KEPT:
// it is one line of text and nothing else, so keeping it loses nothing and the
// card can say what is wrong and let the teacher retype it.

/** The index window: how many terms a sequence shows, at most. */
export const SEQ_COUNT_MIN = 1
export const SEQ_COUNT_MAX = 200
export const SEQ_COUNT_DEFAULT = 10
/** The first index shown is an integer inside ±SEQ_N0_LIMIT. */
export const SEQ_N0_LIMIT = 100000

/** A term count as the card and the store accept it. */
export function clampSeqCount(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return SEQ_COUNT_DEFAULT
  return Math.min(SEQ_COUNT_MAX, Math.max(SEQ_COUNT_MIN, Math.round(v)))
}

/** A first index as the card and the store accept it. */
export function clampSeqN0(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 1
  return Math.min(SEQ_N0_LIMIT, Math.max(-SEQ_N0_LIMIT, Math.round(v)))
}

/**
 * How far the partial sums of a series reach: S_N for N = k₀ … k₀ + 199
 * (1 … 200 for a series from n = 1). The stored N is only kept inside the
 * widest window any start could give it; the card clamps it to its own.
 */
export const SERIES_N_SPAN = 200

/** A partial-sum index as the store accepts it (a whole number, or null). */
export function clampSeriesN(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  const lim = SEQ_N0_LIMIT + SERIES_N_SPAN
  return Math.min(lim, Math.max(-lim, Math.round(v)))
}

/**
 * A sequence's series, as its card shows it ("Σ Show series"): present only
 * while it is shown. Everything the section prints — the verdict, the tests,
 * the sum, S_N — is recomputed from the line, so only the teacher's choices
 * live here.
 */
export interface SeqSeriesView {
  /** The partial sums run to S_N. */
  N: number
  /** Join the partial-sum dots (n, Sₙ) with a line. */
  connect: boolean
  /** Draw each term as a bar stacked on the partial sum before it (the staircase). */
  bars: boolean
}

/** A sequence as the board holds it. `src` is the only source of truth. */
export interface BoardSequence {
  id: string
  /** The line as typed: "a_n = 3 + 4(n - 1)", "b_1 = 10, b_(n+1) = 0.5b_n", "2, 6, 18, 54". */
  src: string
  color: string
  visible: boolean
  /** The first index shown. */
  n0: number
  /** How many terms are shown: n = n0 … n0 + count − 1. */
  count: number
  /** Draw the continuous partner (y = 4x − 1 behind an arithmetic sequence), dashed. */
  showPartner: boolean
  /** Draw the partial sums (n, Sₙ) as rings. */
  showSums: boolean
  /** The free constants, in the parser's own order. */
  params: number[]
  /**
   * A typed LIST ("2, 6, 18, 54") says no letter, so the board gives it one
   * when it arrives — the next free sequence letter — and keeps it here.
   * Absent for every other sequence: its letter is the one its line names.
   */
  name?: string
  /** The series section, while "Σ Show series" is on. Absent otherwise. */
  series?: SeqSeriesView
}

// --- unit circle --------------------------------------------------------------
//
// The unit circle (AP Precalculus Unit 3, NC Math 3): a circle of radius 1
// about (cx, cy), the terminal point P(θ) = (cos θ, sin θ), and what a lesson
// switches on around it — the reference triangle, the reference angle, ASTC,
// the tangent segment, the unwrapped graph of sin, cos or tan, and an inverse
// question (sin⁻¹(1/2)). Same rule as everything else: what is stored is what
// the teacher SET — the centre, the angle, the toggles, the question. Every
// exact value, label and polyline is recomputed from those (src/core/trig.ts,
// src/ui/unitCircleLinks.ts), so nothing drawn can go stale.

/** Which parts of the picture are on. */
export interface UnitCircleShow {
  /** The legs cos θ and sin θ, labelled. */
  triangle: boolean
  /** The reference angle θ′'s arc and label. */
  ref: boolean
  /** "All Students Take Calculus" in the quadrants. */
  astc: boolean
  /** The tangent segment on x = 1. */
  tan: boolean
  /** csc, sec and cot on the card too. */
  recip: boolean
  /** In inverse mode, the other solution in [0, 2π), greyed. */
  other: boolean
}

export const UC_SHOW_DEFAULT: Readonly<UnitCircleShow> = {
  triangle: true,
  ref: true,
  astc: false,
  tan: false,
  recip: false,
  other: true,
}

export const UC_COLOR_DEFAULT = '#2dd4bf'

/** A unit circle as the board holds it. θ is in radians whatever the mode. */
export interface BoardUnitCircle {
  id: string
  cx: number
  cy: number
  theta: number
  /** Degree mode: the card reads and writes θ in degrees. */
  deg?: true
  show: UnitCircleShow
  /** The graph unwrapped to the right: y = sin x, cos x or tan x. */
  unwrap?: UnwrapFn
  /** Inverse mode: which inverse, and the value it is asked about. */
  inv?: { fn: InvFn; v: number }
  color: string
  /** Written only when hidden. */
  hidden?: true
}

/**
 * One unit circle as JSON. Defaults are omitted, the rule every record here
 * follows: `show` carries only the switches that differ from UC_SHOW_DEFAULT
 * (and is absent when none do), the colour only when it was changed.
 */
export interface StoredUnitCircle {
  id: string
  cx: number
  cy: number
  theta: number
  deg?: true
  show?: Partial<UnitCircleShow>
  unwrap?: UnwrapFn
  inv?: { fn: InvFn; v: number }
  color?: string
  hidden?: true
}

const UC_SHOW_KEYS: readonly (keyof UnitCircleShow)[] = ['triangle', 'ref', 'astc', 'tan', 'recip', 'other']
const UC_FNS: readonly string[] = ['sin', 'cos', 'tan']
/** A centre further out than this, or an angle past this many turns, is a damaged record. */
const UC_COORD_LIMIT = 1e6
const UC_THETA_LIMIT = 2000 * Math.PI

export function unitCircleToStored(u: BoardUnitCircle): StoredUnitCircle {
  const out: StoredUnitCircle = { id: u.id, cx: u.cx, cy: u.cy, theta: u.theta }
  if (u.deg) out.deg = true
  const show: Partial<UnitCircleShow> = {}
  let any = false
  for (const k of UC_SHOW_KEYS) {
    if (u.show[k] !== UC_SHOW_DEFAULT[k]) {
      show[k] = u.show[k]
      any = true
    }
  }
  if (any) out.show = show
  if (u.unwrap) out.unwrap = u.unwrap
  if (u.inv) out.inv = { fn: u.inv.fn, v: u.inv.v }
  if (u.color !== UC_COLOR_DEFAULT) out.color = u.color
  if (u.hidden) out.hidden = true
  return out
}

/** One unit circle out of an untrusted blob. */
export function storedToUnitCircle(raw: unknown): { circle: BoardUnitCircle } | { error: string } {
  if (!isObj(raw)) return { error: 'it was not readable' }
  const { id, cx, cy, theta } = raw
  if (!isStr(id) || !id) return { error: 'it had no id' }
  if (!isNum(cx) || !isNum(cy) || Math.abs(cx) > UC_COORD_LIMIT || Math.abs(cy) > UC_COORD_LIMIT) {
    return { error: 'its centre was unreadable' }
  }
  if (!isNum(theta) || Math.abs(theta) > UC_THETA_LIMIT) return { error: 'its angle was unreadable' }
  const show: UnitCircleShow = { ...UC_SHOW_DEFAULT }
  if (isObj(raw.show)) {
    for (const k of UC_SHOW_KEYS) {
      const v = raw.show[k]
      if (typeof v === 'boolean') show[k] = v
    }
  }
  const circle: BoardUnitCircle = {
    id,
    cx,
    cy,
    theta,
    show,
    color: isStr(raw.color) && raw.color ? raw.color : UC_COLOR_DEFAULT,
  }
  if (raw.deg === true) circle.deg = true
  if (isStr(raw.unwrap) && UC_FNS.includes(raw.unwrap)) circle.unwrap = raw.unwrap as UnwrapFn
  if (isObj(raw.inv) && isStr(raw.inv.fn) && UC_FNS.includes(raw.inv.fn) && isNum(raw.inv.v)) {
    circle.inv = { fn: raw.inv.fn as InvFn, v: raw.inv.v }
  }
  if (raw.hidden === true) circle.hidden = true
  return { circle }
}

// --- inequality system --------------------------------------------------------
//
// Two-variable inequalities are typed curves (their line is their source, like
// every other typed curve). What the BOARD adds is the system they form: the
// visible inequalities, taken together. The document keeps only what the
// teacher SET for it — the solution-region switch, the test point, the
// linear-programming objective and its goal, the iso-profit line — and each
// key only when set, so a board that never had a system writes nothing and
// serialises byte-for-byte as it did before this existed. Everything drawn
// (the common region, the corners, the table) is recomputed from the curves.

export interface BoardIneqSystem {
  /** Shade only the region common to every visible inequality. */
  solution?: true
  /** The draggable test point, while it is on the board. */
  test?: { x: number; y: number }
  /** The objective as typed ("P = 3x + 2y") and whether it is maximised or minimised. */
  objective?: { src: string; goal: 'max' | 'min' }
  /** The dashed iso-profit line through the optimum. */
  iso?: true
}

/** A system with nothing set is no system: null, and nothing is written. */
export function systemToStored(sys: BoardIneqSystem | null | undefined): BoardIneqSystem | null {
  if (!sys) return null
  const out: BoardIneqSystem = {}
  if (sys.solution) out.solution = true
  if (sys.test && Number.isFinite(sys.test.x) && Number.isFinite(sys.test.y)) out.test = { x: sys.test.x, y: sys.test.y }
  if (sys.objective && typeof sys.objective.src === 'string' && sys.objective.src.trim() !== '') {
    out.objective = { src: sys.objective.src.slice(0, 200), goal: sys.objective.goal === 'min' ? 'min' : 'max' }
  }
  if (sys.iso) out.iso = true
  return Object.keys(out).length > 0 ? out : null
}

/**
 * The system out of an untrusted blob; unreadable keys are dropped — and,
 * when `problems` is given, each one is reported there (a lost test point or
 * objective is a lost instruction, not a default).
 */
export function storedToSystem(raw: unknown, problems?: string[]): BoardIneqSystem | null {
  if (raw === undefined || raw === null) return null
  const say = (what: string): void => {
    problems?.push(`The inequality system’s ${what}.`)
  }
  if (!isObj(raw)) {
    problems?.push('The inequality system was unreadable, so its settings were reset.')
    return null
  }
  const out: BoardIneqSystem = {}
  if (raw.solution === true) out.solution = true
  else if (raw.solution !== undefined) say('solution-region switch was unreadable; it was turned off')
  if (isObj(raw.test) && isNum(raw.test.x) && isNum(raw.test.y) && Math.abs(raw.test.x) < 1e9 && Math.abs(raw.test.y) < 1e9) {
    out.test = { x: raw.test.x, y: raw.test.y }
  } else if (raw.test !== undefined) {
    say('test point was unreadable, so it was removed')
  }
  if (isObj(raw.objective) && isStr(raw.objective.src) && raw.objective.src.trim() !== '') {
    const g = raw.objective.goal
    if (g !== undefined && g !== 'min' && g !== 'max') say('objective goal was unreadable; it maximises')
    out.objective = { src: raw.objective.src.slice(0, 200), goal: g === 'min' ? 'min' : 'max' }
  } else if (raw.objective !== undefined) {
    say('objective was unreadable, so it was removed')
  }
  if (raw.iso === true) out.iso = true
  else if (raw.iso !== undefined) say('iso-profit line switch was unreadable; it was turned off')
  return Object.keys(out).length > 0 ? out : null
}

// --- related rates ------------------------------------------------------------
//
// Build ▾ → Related rates (AP Calculus Unit 4): one board object, a scenario
// (ladder, cone, shadow, ripple, balloon) with its givens, the instant t, the
// "when x = 6" question and two switches. Same rule as everything else: what
// is stored is what the teacher SET; every drawing, formula and live value is
// recomputed from it (src/core/relatedRates.ts, src/ui/relatedRatesLinks.ts).
// One per board, stored as `board.relatedRates` — a single object, written
// only when there is one.

export const RR_COLOR_DEFAULT = '#38bdf8'

export interface BoardRelatedRates {
  id: string
  scenario: RRScenario
  /** The givens, by key (L, c, x0 …) — every key the scenario has. */
  params: Record<string, number>
  /** The instant, in the scenario's time unit. */
  t: number
  /** "When x = 6": the question t was solved from, kept so the card can say it. */
  when?: { q: string; v: number }
  /** Play stops at the `when` instant. */
  pause?: true
  /** Written only when the mini-graph of the unknown rate is switched off. */
  graph?: false
  color: string
  hidden?: true
}

export interface StoredRelatedRates {
  id: string
  scenario: RRScenario
  params: Record<string, number>
  t: number
  when?: { q: string; v: number }
  pause?: true
  graph?: false
  color?: string
  hidden?: true
}

const RR_T_LIMIT = 1e7

export function relatedRatesToStored(r: BoardRelatedRates): StoredRelatedRates {
  const params: Record<string, number> = {}
  for (const d of RR_DEFS[r.scenario].params) {
    const v = r.params[d.key]
    if (typeof v === 'number' && Number.isFinite(v)) params[d.key] = v
  }
  const out: StoredRelatedRates = { id: r.id, scenario: r.scenario, params, t: r.t }
  if (r.when) out.when = { q: r.when.q, v: r.when.v }
  if (r.pause) out.pause = true
  if (r.graph === false) out.graph = false
  if (r.color !== RR_COLOR_DEFAULT) out.color = r.color
  if (r.hidden) out.hidden = true
  return out
}

/**
 * A CSS colour as this app writes one: #rgb, #rgba, #rrggbb, #rrggbbaa, or
 * rgb()/rgba()/hsl()/hsla(). Anything else ("banana", "url(…)", "") is not
 * a colour and falls back to the object's default — reported by the loader.
 */
export function isColorString(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const t = v.trim()
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t)) return true
  return /^(?:rgba?|hsla?)\(\s*[-+0-9.%\s,/deg]+\)$/i.test(t)
}

/**
 * The related-rates problem out of an untrusted blob. A value that is there
 * but damaged (a given that is not a number or out of range, an unreadable
 * t, "when", pause, graph or colour) is replaced by its default — and, when
 * `problems` is given, reported there like every other object's damage.
 */
export function storedToRelatedRates(
  raw: unknown,
  problems?: string[],
): { rr: BoardRelatedRates } | { error: string } {
  if (!isObj(raw)) return { error: 'it was not readable' }
  const { id, scenario, t } = raw
  if (!isStr(id) || !id) return { error: 'it had no id' }
  if (!isStr(scenario) || !(RR_SCENARIOS as readonly string[]).includes(scenario)) {
    return { error: 'its scenario was unknown' }
  }
  const sc = scenario as RRScenario
  const say = (what: string): void => {
    problems?.push(`The related-rates problem’s ${what}.`)
  }
  const params = cleanParams(sc, raw.params)
  if (raw.params !== undefined && !isObj(raw.params)) {
    say('givens were unreadable; the defaults were used')
  } else {
    const rec = isObj(raw.params) ? raw.params : {}
    for (const d of RR_DEFS[sc].params) {
      const v = rec[d.key]
      // Absent is the default (a given added after the file was written).
      if (v === undefined) continue
      if (!isNum(v)) say(`given ${d.key} was unreadable; the default was used`)
      else if (v !== params[d.key]) say(`given ${d.key} was out of range; it was moved to ${params[d.key]}`)
    }
  }
  const tOk = isNum(t) && Math.abs(t) <= RR_T_LIMIT
  if (!tOk) say('instant t was unreadable; it starts at 0')
  const colorOk = raw.color === undefined || isColorString(raw.color)
  if (!colorOk) say('colour was not a colour; the default was used')
  const rr: BoardRelatedRates = {
    id,
    scenario: sc,
    params,
    t: tOk ? t : 0,
    color: colorOk && isStr(raw.color) ? raw.color.trim() : RR_COLOR_DEFAULT,
  }
  if (
    isObj(raw.when) &&
    isStr(raw.when.q) &&
    RR_DEFS[sc].quantities.some((q) => q.key === (raw.when as { q: string }).q) &&
    isNum(raw.when.v)
  ) {
    rr.when = { q: raw.when.q, v: raw.when.v }
  } else if (raw.when !== undefined) {
    say('“when” question was unreadable, so it was removed')
  }
  if (raw.pause === true) rr.pause = true
  else if (raw.pause !== undefined) say('pause switch was unreadable; it was turned off')
  if (raw.graph === false) rr.graph = false
  else if (raw.graph !== undefined) say('graph switch was unreadable; the graph is shown')
  if (raw.hidden === true) rr.hidden = true
  else if (raw.hidden !== undefined) say('hidden switch was unreadable; it is shown')
  return { rr }
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

/**
 * Integerise and clamp a Taylor degree — the card's stepper and the loader
 * agree exactly. Junk is the default degree rather than a refusal: the centre
 * is what defines the polynomial, and a degree nobody can read is the one the
 * card would have offered anyway.
 */
export function clampTaylorN(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : TAYLOR_N_DEFAULT
  return Math.min(TAYLOR_N_MAX, Math.max(TAYLOR_N_MIN, n))
}

const RIEMANN_METHODS: readonly RiemannMethod[] = ['left', 'right', 'midpoint', 'trapezoid']

const isMethod = (v: unknown): v is RiemannMethod =>
  typeof v === 'string' && (RIEMANN_METHODS as readonly string[]).includes(v)

/** The model id a numerically-differentiated derivative registers under. */
export const DERIV_MODEL_PREFIX = 'dfdx_'

/**
 * The model id an accumulation closure registers under: this prefix and the
 * LINK's id, which is unique in its document by construction — so there is no
 * counter to persist, and a reload rebuilds the same id from the link alone.
 */
export const ACCUM_MODEL_PREFIX = 'intf_'

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
/** And for data tables, their rows, their regressions and one cell's text. */
const MAX_DATA = 50
const MAX_DATA_ROWS = 10000
const MAX_REGRESSIONS = 20
const MAX_CELL_CHARS = 64
/** And for sequences, and one sequence's typed line. */
const MAX_SEQUENCES = 100
const MAX_SEQ_SRC_CHARS = 2000
/** And for unit circles: a lesson has one; a handful is still a board. */
const MAX_UNIT_CIRCLES = 8
/** Stored stroke resolution. Keeps boards small; plenty for refit and hit tests. */
export const MAX_STORED_STROKE = 120
const MAX_STROKE_IN = 20000
const STROKE_DP = 4
const CANDIDATE_DP = 6

// ------------------------------------------------------- per-curve view settings
//
// The switches on a curve's card that say how to LOOK at it — a conic's
// construction, a transformation's parent, a polar curve's shaded area, the
// Motion section's acceleration and "particle in export", and a factored
// curve built through a point (its `a` re-solved to keep passing through it).
// None of them is the curve: the equation is the whole truth about that. But a
// teacher who set them up for a lesson expects them to be there tomorrow, so
// they travel with the document in ONE map, `board.curveViews`, keyed by curve
// id — every field omitted at its default, an entry with nothing to say
// omitted, and the whole key omitted when no curve says anything. A document
// that never touched one serialises byte-for-byte as it did before.
//
// NOT here: the particle's position, play / pause and speed. They are the
// state of a demonstration in progress, and t moves on every animation frame
// — persisting it would rewrite the document sixty times a second.

/** A polar curve's shaded area ½∫r²dθ: on or off, and its θ-bounds as typed. */
export interface CurveViewArea {
  on: boolean
  /** θ from, as typed ("π/6"). */
  a: string
  /** θ to, as typed. */
  b: string
}

/** One curve's view settings. Every field absent at its default. */
export interface CurveView {
  /** Conic: its foci, directrix, asymptotes and box are figure content. */
  construction?: true
  /** Transformation: the parent's ghost, as the teacher left it. Absent = the section's default. */
  showParent?: boolean
  /** Polar: the shaded area. Absent = never turned on. */
  area?: CurveViewArea
  /** Motion: draw the acceleration vector too. */
  accel?: true
  /** Motion: the particle and its vectors go into the exported figure. */
  exportParticle?: true
  /** Built from roots THROUGH this point: `a` is solved from it on every edit. */
  through?: Vec2
  /**
   * A restricted function: its whole natural-domain graph drawn behind it,
   * faint and dashed — "show the cut-off part". Figure content when on.
   */
  ghost?: true
  /** The horizontal line test: the line's height. Present = the line is shown. */
  hlt?: number
  /**
   * The reflected-point probe: (a, f(a)) on f and (f(a), a) on f⁻¹, joined
   * across y = x. Present = shown, at this a. Kept on f (not on an inverse
   * link) because it reflects f itself — it works the same whether f⁻¹ is a
   * linked reflection, an exact typed curve, or not drawn at all.
   */
  reflect?: number
}
export type CurveViews = Record<string, CurveView>

/** The same, as JSON: the point flat, like a stroke. */
export interface StoredCurveView {
  construction?: true
  showParent?: boolean
  area?: CurveViewArea
  accel?: true
  exportParticle?: true
  through?: [number, number]
  ghost?: true
  hlt?: number
  reflect?: number
}

/** A typed θ-bound longer than this is not a bound anybody typed. */
const MAX_VIEW_TEXT = 64

/**
 * One curve's settings with every default dropped, or null when nothing is
 * left to say. The one normaliser both directions go through, so what is
 * written and what is read back are the same object.
 */
export function normalizeCurveView(v: CurveView | undefined | null): CurveView | null {
  if (!v) return null
  const out: CurveView = {}
  if (v.construction === true) out.construction = true
  if (typeof v.showParent === 'boolean') out.showParent = v.showParent
  if (
    v.area &&
    typeof v.area.on === 'boolean' &&
    typeof v.area.a === 'string' &&
    typeof v.area.b === 'string'
  ) {
    out.area = { on: v.area.on, a: v.area.a.slice(0, MAX_VIEW_TEXT), b: v.area.b.slice(0, MAX_VIEW_TEXT) }
  }
  if (v.accel === true) out.accel = true
  if (v.exportParticle === true) out.exportParticle = true
  if (v.through && isNum(v.through.x) && isNum(v.through.y)) {
    out.through = { x: v.through.x, y: v.through.y }
  }
  if (v.ghost === true) out.ghost = true
  if (isNum(v.hlt)) out.hlt = v.hlt
  if (isNum(v.reflect)) out.reflect = v.reflect
  return Object.keys(out).length > 0 ? out : null
}

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
  /**
   * The curve's letter (f, g, h …). Stable: it never shifts when curves are
   * added, removed or reordered, which is what lets `g(x) = 2f(x − 1) + 3`
   * keep meaning the same f. Absent on every document written before names
   * were stored (the board derives them once on load).
   */
  name?: string
  /**
   * The names a typed line CALLS — `f` for `g(x) = 2f(x − 1) + 3` — as
   * opposed to single letters it multiplies (`a(x + 1)` with slider a).
   * Present only on a typed line that calls something.
   */
  calls?: string[]
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
  /**
   * `ppuY` is the y scale of a board whose axes are scaled independently
   * (Settings → Axes: Independent). Omitted on an equal-axes board — every
   * document written before the field existed, and every one since that never
   * left Equal — so those serialise byte-for-byte as they always did.
   */
  viewport: { cx: number; cy: number; ppu: number; ppuY?: number }
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
   * "Show inverse" links (see InverseLink). Omitted when there are none, so a
   * board that never had one serialises byte-for-byte as it did before.
   */
  inverses?: StoredInverseLink[]
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
   * The data tables on this board — every cell as the teacher typed it — and
   * the regressions fitted to them, as links to their typed curves.
   *
   * Omitted entirely when there are none, which is every document written
   * before this field existed: such a board serialises byte-for-byte as it did
   * then, and an older reader drops a key it does not know (the regression
   * curves survive there as ordinary typed curves).
   */
  data?: StoredData[]
  /**
   * The sequences on this board — each as the line that was typed, its index
   * window and its two toggles. Never the terms: they are recomputed.
   *
   * Omitted entirely when there are none, which is every document written
   * before this field existed: such a board serialises byte-for-byte as it did
   * then, and an older reader drops a key it does not know.
   */
  sequences?: StoredSequence[]
  /**
   * The unit circles on this board — centre, angle, switches, question.
   * Omitted entirely when there are none, which is every document written
   * before this field existed: such a board serialises byte-for-byte as it
   * did then, and an older reader drops a key it does not know.
   */
  unitCircles?: StoredUnitCircle[]
  /**
   * The related-rates object (one per board) — scenario, givens, instant,
   * question, switches. Omitted when there is none, which is every document
   * written before this field existed: such a board serialises
   * byte-for-byte as it did then.
   */
  relatedRates?: StoredRelatedRates
  /**
   * The inequality system's settings (solution region, test point, objective).
   * Omitted when nothing is set — every document written before it existed.
   */
  system?: BoardIneqSystem
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
  /**
   * Per-curve view settings (see CurveView), keyed by curve id, in board
   * order. Omitted when no curve has one — every document written before
   * this existed — so such a board serialises byte-for-byte as it did.
   */
  curveViews?: Record<string, StoredCurveView>
  /**
   * A teacher note shown at the top of the sidebar — what to show, what to
   * ask the class. The examples gallery writes one into every example it
   * opens; a teacher's own documents never have one. Written ONLY when there
   * is one, so every other document serialises byte-for-byte as it did
   * before this existed, and an older reader drops a key it does not know.
   */
  note?: string
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
 * One data table as JSON. Defaults are omitted, by the rule every other
 * record here follows: a control nobody touched must not change the bytes.
 */
export interface StoredSequence {
  id: string
  /** The line as typed — the only thing that rebuilds the terms. */
  src: string
  color: string
  /** The first index shown. Always written: it is what the teacher set. */
  n0: number
  /** How many terms are shown. Always written. */
  count: number
  /** Free constants. Omitted when the sequence has none. */
  params?: number[]
  /** Written only when the continuous partner is drawn. */
  partner?: true
  /** Written only when the partial sums are drawn. */
  sums?: true
  /** Written only when the sequence is hidden. */
  hidden?: true
  /** A listed sequence's letter (see BoardSequence.name). */
  name?: string
  /** Written only while the series is shown; its switches only when on. */
  series?: { N: number; connect?: true; bars?: true }
}

export interface StoredData {
  id: string
  name: string
  color: string
  /** Omitted at "x". */
  xLabel?: string
  /** Omitted at "y". */
  yLabel?: string
  /** [x, y] cell text per row, exactly as typed. */
  rows: [string, string][]
  /** Written only when the table is hidden. */
  hidden?: true
  /** Omitted at 'dot'. */
  marker?: DataMarker
  /** Omitted when there are none. */
  regressions?: StoredRegression[]
}

export interface StoredRegression {
  id: string
  kind: RegressionKind
  curveId: string
  /** Omitted at the default (4). */
  digits?: number
  /** Written only when on. */
  residuals?: true
  /** Written only when the curve was edited by hand. */
  detached?: true
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
  /** Euler's-method runs. Omitted when there are none. */
  eulers?: StoredEuler[]
}

/**
 * One Euler run as JSON. No id: like an initial condition's, it is minted on
 * load, so a load/save cycle cannot change a byte. The flags are written only
 * when on.
 */
export interface StoredEuler {
  x0: number
  y0: number
  h: number
  n: number
  true?: true
  labels?: true
}

/** One link, flattened. Only the fields its own kind uses are ever written. */
export interface StoredCalcLink {
  kind: CalcKind
  id: string
  parentId: string
  /** Area between two curves only; absent means the region runs to the axis. */
  otherId?: string
  curveId?: string
  x?: number
  from?: number
  to?: number
  abs?: boolean
  n?: number
  /** Riemann: the rule. Volume: 'shell' or 'section' (washers are the default and are not written). */
  method?: RiemannMethod | VolumeMethod
  /**
   * Accumulation: the lower limit (and g(a) when it is not 0). Taylor: the
   * centre. Secant: the left-hand point. Limit: the point approached — the
   * string LIMIT_INF / LIMIT_NEG_INF for ±∞.
   */
  a?: number | typeof LIMIT_INF | typeof LIMIT_NEG_INF
  C?: number
  /** Taylor only, and only when on: the error band and the interval of convergence. */
  band?: boolean
  ioc?: boolean
  /** Secant only: the right-hand point (a is the left-hand one), and the two switches when on. */
  b?: number
  mvt?: boolean
  avg?: boolean
  /** Limit only: the side when not 'both', the two switches when on, ε when not 0.5. */
  side?: 'left' | 'right'
  table?: boolean
  epsilon?: boolean
  eps?: number
  /** Volume only: the axis when not the x-axis, the section when not a square, the rectangle's ratio when not 1. */
  axis?: VolumeAxis
  section?: SectionShape
  ratio?: number
  /** Volume only: 'y' for cross-sections perpendicular to the y-axis. */
  perp?: 'y'
  /** Tangent on an implicit curve only: the point's y (its branch). */
  y?: number
  /** Tangent on an implicit curve, or parametric / polar calculus, only when on: the H/V tangents marked. */
  marks?: true
  /** Parametric / polar calculus only: the chosen t (θ). */
  t?: number
  /** Area between polar curves only, and only when on: inside the other curve, outside the parent. */
  swap?: true
  /** Sign chart only: what the curve is (absent: f), its rows, and the switches when on. */
  as?: 'f1' | 'f2'
  rows?: SignLevel[]
  arrows?: true
  cup?: true
  guides?: true
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
  /** solved inequalities on a number line; absent when there are none */
  solved?: number
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
  let solved = 0
  for (const it of items) {
    if (it && it.kind === 'point') points++
    else if (it && it.kind === 'interval') intervals++
    else if (it && it.kind === 'solve') solved++
  }
  return {
    curves: Array.isArray(board.curves) ? board.curves.length : 0,
    points,
    intervals,
    ...(solved > 0 ? { solved } : {}),
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
  /** curveId -> its letter. Absent or empty writes nothing at all. */
  names?: Readonly<Record<string, string>>
  /** curveId -> the names that typed line calls. Absent or empty writes nothing. */
  calls?: Readonly<Record<string, readonly string[]>>
  /** Inverse links. Absent or empty writes nothing at all. */
  inverses?: readonly InverseLink[]
  /** Slope fields. Absent or empty writes nothing at all, by the same rule. */
  fields?: readonly BoardField[]
  /** Shapes. Absent or empty writes nothing at all, by the same rule. */
  shapes?: readonly BoardShape[]
  /** Data tables. Absent or empty writes nothing at all, by the same rule. */
  data?: readonly BoardData[]
  /** Sequences. Absent or empty writes nothing at all, by the same rule. */
  sequences?: readonly BoardSequence[]
  /** Unit circles. Absent or empty writes nothing at all, by the same rule. */
  unitCircles?: readonly BoardUnitCircle[]
  /** The related-rates object (the first, if several). Absent or empty writes nothing at all. */
  relatedRates?: readonly BoardRelatedRates[]
  /** The inequality system's settings. Absent or empty writes nothing at all. */
  system?: BoardIneqSystem | null
  /** The ruling. Absent means 'cartesian', which writes nothing at all. */
  grid?: BoardGrid
  /** The figure style. Absent means 'screen', which writes nothing at all. */
  figure?: FigureStyleId
  /** The caption under the figure. Absent or blank writes nothing at all. */
  caption?: string
  /**
   * False when the caption is the teacher's OWN words rather than the one the
   * board derived for itself.
   *
   * A derived caption ("Graphs of f and g", re-derived whenever the curves
   * change) is not part of the document: storing it would freeze a sentence
   * that is supposed to follow the board, and would change the bytes of every
   * document that never had a caption. So the auto caption writes nothing,
   * exactly as before this existed.
   *
   * The one thing that cannot be said by silence is a caption the teacher
   * deliberately CLEARED: absent would read back as "derive one". That is what
   * this flag buys — `captionAuto: false` with a blank caption writes
   * `"caption": ""`, and the loader reads the key's PRESENCE as "these words
   * are the teacher's". Absent (every existing caller) behaves as it always
   * did: blank writes nothing.
   */
  captionAuto?: boolean
  /** curveId -> its view settings. Absent, empty or all-default writes nothing. */
  curveViews?: Readonly<CurveViews>
  /** The teacher note (see StoredBoard.note). Absent or blank writes nothing at all. */
  note?: string
  /** pxPerUnitY present = Independent axes (see StoredBoard.viewport.ppuY). */
  viewport: { center: Vec2; pxPerUnit: number; pxPerUnitY?: number }
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
   * curveId -> the letter the document stored for it. Empty for a document
   * written before names were stored: the board derives them once.
   */
  names: Record<string, string>
  /** curveId -> the names that typed line calls (see StoredCurve.calls). */
  calls: Record<string, string[]>
  /**
   * The inverse links whose parent and curve are both still here. The curve's
   * model is NOT rebuilt here — the board registers one per link.
   */
  inverses: InverseLink[]
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
  /**
   * The data tables that could be read. A table that is not readable is
   * dropped and REPORTED; so is a regression whose curve is gone.
   */
  data: BoardData[]
  /**
   * The sequences, as typed. A record that is not readable at all is dropped
   * and REPORTED; one whose line no longer parses is kept (its card says so).
   */
  sequences: BoardSequence[]
  /** The unit circles that could be read; an unreadable one is dropped and REPORTED. */
  unitCircles: BoardUnitCircle[]
  /** The related-rates object, as a list of none or one; an unreadable one is dropped and REPORTED. */
  relatedRates: BoardRelatedRates[]
  /** The inequality system's settings; null when the document has none. */
  system: BoardIneqSystem | null
  /** The ruling this document states. 'cartesian' when it is silent. */
  grid: BoardGrid
  /** The figure style this document states. 'screen' when it is silent. */
  figure: FigureStyleId
  /** The caption under the figure. '' when there is none. */
  caption: string
  /**
   * True when this document says nothing about its caption, so the board is
   * free to derive one from the curves on it (see BoardInput.captionAuto).
   * False when the caption above is the teacher's own words — including the
   * blank they deliberately left.
   */
  captionAuto: boolean
  /**
   * curveId -> the view settings the document stored, for curves still on
   * the board. An entry that could not be read is dropped and REPORTED.
   */
  curveViews: CurveViews
  /** The teacher note, when the document has one (an opened example). */
  note?: string
  /** pxPerUnitY present = Independent axes; absent = equal. */
  viewport: { center: Vec2; pxPerUnit: number; pxPerUnitY?: number }
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

/**
 * Rounding to significant digits, for a scale that may be 3·10⁻⁶: six
 * decimal places would keep one digit of it.
 */
const roundSig = (v: number, sig: number): number =>
  v === 0 || !Number.isFinite(v) ? v : Number(v.toPrecision(sig))

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

/**
 * The end caps worth writing down: a fresh record holding only the ends the
 * teacher actually chose. 'auto' is not a choice — it is the default the
 * figure style answers — so it is dropped, and a pair of them is nothing at
 * all. Returning undefined for "nothing to say" is what keeps a document that
 * predates end caps byte-identical through a load/save round trip.
 */
function writableEnds(ends: CurveEnds | undefined): CurveEnds | undefined {
  if (!ends) return undefined
  const out: CurveEnds = {}
  if (ends.start !== undefined && ends.start !== 'auto') out.start = ends.start
  if (ends.end !== undefined && ends.end !== 'auto') out.end = ends.end
  return out.start !== undefined || out.end !== undefined ? out : undefined
}

/** A copy of a style carrying `ends` only when there is something to carry. */
function withEnds(style: CurveStyle, ends: CurveEnds | undefined): CurveStyle {
  const out: CurveStyle = { ...style }
  if (ends) out.ends = ends
  else delete out.ends
  return out
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
    // A name and the names a line calls, only when there are some: a board
    // from before names were stored writes exactly the bytes it always did.
    const nm = input.names?.[c.id]
    if (isNameLetter(nm)) stored.name = nm
    const calls = src !== undefined ? input.calls?.[c.id] : undefined
    if (Array.isArray(calls) && calls.length > 0) {
      const ok = calls.filter(isNameLetter)
      if (ok.length > 0) stored.calls = ok.slice()
    }
    const st = input.styles[c.id]
    // End caps are written only when a choice was actually made: 'auto' IS the
    // absence of one, so a curve nobody touched serialises byte-for-byte as it
    // did before this field existed.
    const ends = writableEnds(st?.ends)
    if (st && (st.dash !== undefined || st.opacity !== undefined || ends !== undefined)) {
      stored.style = withEnds(st, ends)
    }
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
      // Six places for every scale a square board ever had (byte-identical);
      // significant digits below that, where six places would erase it.
      ppu:
        input.viewport.pxPerUnit >= 1e-3
          ? round(input.viewport.pxPerUnit, 6)
          : roundSig(input.viewport.pxPerUnit, 9),
      // Independent axes only. Equal writes nothing, so an equal board is
      // byte-identical to what it was before this key existed.
      ...(typeof input.viewport.pxPerUnitY === 'number' &&
      Number.isFinite(input.viewport.pxPerUnitY) &&
      input.viewport.pxPerUnitY > 0
        ? { ppuY: roundSig(input.viewport.pxPerUnitY, 9) }
        : {}),
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

  // And for the inverses.
  const inverses = input.inverses ?? []
  if (inverses.length > 0) {
    board.inverses = inverses.slice(0, MAX_CALC).map((l) => ({
      id: l.id,
      parentId: l.parentId,
      curveId: l.curveId,
      from: l.from,
      to: l.to,
    }))
  }

  // And once more for the slope fields.
  const fields = input.fields ?? []
  if (fields.length > 0) board.fields = fields.slice(0, MAX_FIELDS).map(fieldToStored)

  // And for the shapes.
  const shapes = input.shapes ?? []
  if (shapes.length > 0) board.shapes = shapes.slice(0, MAX_SHAPES).map(shapeToStored)

  // And for the data tables.
  const data = input.data ?? []
  if (data.length > 0) board.data = data.slice(0, MAX_DATA).map(dataToStored)

  // And for the sequences.
  const sequences = input.sequences ?? []
  if (sequences.length > 0) board.sequences = sequences.slice(0, MAX_SEQUENCES).map(sequenceToStored)

  // And for the unit circles.
  const circles = input.unitCircles ?? []
  if (circles.length > 0) board.unitCircles = circles.slice(0, MAX_UNIT_CIRCLES).map(unitCircleToStored)

  // And the related-rates object: one per board, only when there is one.
  const rates = input.relatedRates ?? []
  if (rates.length > 0) board.relatedRates = relatedRatesToStored(rates[0])

  // And the inequality system, only when something about it is set.
  const system = systemToStored(input.system)
  if (system) board.system = system

  // The ruling, only when it is not the square one every document has always
  // been drawn on.
  if (input.grid === 'polar') board.grid = 'polar'

  // And the look, only when it is not the screen one every document has always
  // been drawn in — with its caption, only when there is one to print.
  if (isFigureStyleId(input.figure) && input.figure !== 'screen') board.figure = input.figure
  //
  // A DERIVED caption is not the document's: it is re-derived from the curves
  // on every load, so writing it would freeze a sentence that is supposed to
  // follow the board. The teacher's own words are written — including the
  // blank they deliberately left, which is the one thing silence cannot say.
  const caption = storedCaption(input.caption)
  if (input.captionAuto === true) {
    /* the board writes this one; the document stays silent */
  } else if (caption !== '') board.caption = caption
  else if (input.captionAuto === false) board.caption = ''

  // And the per-curve view settings: only curves on the board, in board
  // order, only fields off their defaults — and no key at all when that is
  // nothing, which is every board that never touched one.
  if (input.curveViews) {
    const views: Record<string, StoredCurveView> = {}
    let any = false
    for (const c of input.curves) {
      const v = normalizeCurveView(input.curveViews[c.id])
      if (!v) continue
      const st: StoredCurveView = {}
      if (v.construction) st.construction = true
      if (v.showParent !== undefined) st.showParent = v.showParent
      if (v.area) st.area = { on: v.area.on, a: v.area.a, b: v.area.b }
      if (v.accel) st.accel = true
      if (v.exportParticle) st.exportParticle = true
      if (v.through) st.through = [v.through.x, v.through.y]
      if (v.ghost) st.ghost = true
      if (v.hlt !== undefined) st.hlt = v.hlt
      if (v.reflect !== undefined) st.reflect = v.reflect
      views[c.id] = st
      any = true
    }
    if (any) board.curveViews = views
  }

  // And the teacher note, last and only when there is one: every document
  // that never had one writes exactly the bytes it always wrote.
  const note = storedNote(input.note)
  if (note !== '') board.note = note

  return board
}

/** The longest teacher note a document carries. */
export const MAX_NOTE_CHARS = 1200

/** A note as a document keeps it: a string, trimmed, capped; '' for none. */
export function storedNote(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v.trim().slice(0, MAX_NOTE_CHARS)
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

/** One data table as JSON: the cells as typed, defaults omitted. */
export function dataToStored(d: BoardData): StoredData {
  const out: StoredData = { id: d.id, name: d.name, color: d.color, rows: [] }
  if (d.xLabel !== 'x') out.xLabel = d.xLabel
  if (d.yLabel !== 'y') out.yLabel = d.yLabel
  out.rows = d.rows.slice(0, MAX_DATA_ROWS).map((r) => [r.x, r.y])
  if (d.visible === false) out.hidden = true
  if (d.marker !== undefined && d.marker !== 'dot') out.marker = d.marker
  if (d.regressions.length > 0) {
    out.regressions = d.regressions.slice(0, MAX_REGRESSIONS).map((r) => {
      const sr: StoredRegression = { id: r.id, kind: r.kind, curveId: r.curveId }
      const digits = clampRegDigits(r.digits)
      if (digits !== REG_DIGITS_DEFAULT) sr.digits = digits
      if (r.residuals) sr.residuals = true
      if (r.detached) sr.detached = true
      return sr
    })
  }
  return out
}

/** A cell out of an untrusted blob: text as typed, a stored number as its text. */
function cellOf(v: unknown): string {
  if (isStr(v)) return v.slice(0, MAX_CELL_CHARS)
  if (isNum(v)) return String(v)
  return ''
}

/**
 * One data table out of an untrusted blob. The rows are salvaged cell by cell
 * (an unreadable cell is a blank one, which the plot skips); a regression
 * that is unreadable is dropped and counted, so the loader can say so.
 */
export function storedToData(
  raw: unknown,
): { data: BoardData; droppedRegressions: number } | { error: string } {
  if (!isObj(raw)) return { error: 'it was not readable' }
  const { id, name, color } = raw
  if (!isStr(id) || !id) return { error: 'it had no id' }
  if (!Array.isArray(raw.rows)) return { error: 'its rows were unreadable' }
  const rows: DataRow[] = []
  for (const r of raw.rows.slice(0, MAX_DATA_ROWS)) {
    if (Array.isArray(r)) rows.push({ x: cellOf(r[0]), y: cellOf(r[1]) })
    else if (isObj(r)) rows.push({ x: cellOf(r.x), y: cellOf(r.y) })
    else rows.push({ x: '', y: '' })
  }
  const regressions: DataRegression[] = []
  let droppedRegressions = 0
  const rawRegs = Array.isArray(raw.regressions) ? raw.regressions : []
  if (raw.regressions !== undefined && !Array.isArray(raw.regressions)) droppedRegressions++
  const seenRegs = new Set<string>()
  for (const rr of rawRegs.slice(0, MAX_REGRESSIONS)) {
    if (
      !isObj(rr) ||
      !isStr(rr.id) ||
      !rr.id ||
      seenRegs.has(rr.id) ||
      !isStr(rr.curveId) ||
      !rr.curveId ||
      !isRegressionKind(rr.kind)
    ) {
      droppedRegressions++
      continue
    }
    seenRegs.add(rr.id)
    const reg: DataRegression = {
      id: rr.id,
      kind: rr.kind,
      curveId: rr.curveId,
      digits: clampRegDigits(rr.digits),
      residuals: rr.residuals === true,
    }
    if (rr.detached === true) reg.detached = true
    regressions.push(reg)
  }
  const label = (v: unknown, dflt: string): string =>
    isStr(v) ? v.slice(0, MAX_LABEL_CHARS) : dflt
  const data: BoardData = {
    id,
    name: isStr(name) && name.trim() ? name.slice(0, MAX_LABEL_CHARS) : 'Table',
    xLabel: label(raw.xLabel, 'x'),
    yLabel: label(raw.yLabel, 'y'),
    rows,
    color: isStr(color) && color ? color : '#4f9cf9',
    visible: raw.hidden !== true,
    regressions,
  }
  if (isStr(raw.marker) && (DATA_MARKERS as readonly string[]).includes(raw.marker) && raw.marker !== 'dot') {
    data.marker = raw.marker as DataMarker
  }
  return { data, droppedRegressions }
}

/**
 * One sequence as JSON: the line, the window, the toggles only when on.
 *
 * The params are NOT rounded, for the reason a shape's are not: a slider at
 * r = 0.5 that came back 0.4999999 would change "Σ = 20" into a decimal.
 */
export function sequenceToStored(q: BoardSequence): StoredSequence {
  const out: StoredSequence = {
    id: q.id,
    src: q.src,
    color: q.color,
    n0: clampSeqN0(q.n0),
    count: clampSeqCount(q.count),
  }
  if (q.params.length > 0) out.params = q.params.slice()
  if (q.showPartner) out.partner = true
  if (q.showSums) out.sums = true
  if (q.visible === false) out.hidden = true
  if (typeof q.name === 'string' && /^[A-Za-z]$/.test(q.name)) out.name = q.name
  if (q.series) {
    const N = clampSeriesN(q.series.N)
    if (N !== null) {
      out.series = { N }
      if (q.series.connect) out.series.connect = true
      if (q.series.bars) out.series.bars = true
    }
  }
  return out
}

/**
 * One sequence out of an untrusted blob. NOT re-parsed here: the line is kept
 * even when it no longer reads (the card says why), and the App reconciles
 * the constants against the parser's list by position.
 */
export function storedToSequence(raw: unknown): { sequence: BoardSequence } | { error: string } {
  if (!isObj(raw)) return { error: 'it was not readable' }
  const { id, src, color } = raw
  if (!isStr(id) || !id) return { error: 'it had no id' }
  if (!isStr(src) || src.trim() === '') return { error: 'it had nothing typed in it' }
  const params = Array.isArray(raw.params)
    ? raw.params.slice(0, MAX_PARAMS).map((v) => (isNum(v) ? v : 1))
    : []
  const name = isStr(raw.name) && /^[A-Za-z]$/.test(raw.name) ? raw.name : undefined
  const sr = isObj(raw.series) ? raw.series : null
  const sN = sr ? clampSeriesN(sr.N) : null
  const series: SeqSeriesView | undefined =
    sr && sN !== null ? { N: sN, connect: sr.connect === true, bars: sr.bars === true } : undefined
  return {
    sequence: {
      id,
      src: src.slice(0, MAX_SEQ_SRC_CHARS),
      color: isStr(color) && color ? color : '#4f9cf9',
      visible: raw.hidden !== true,
      n0: clampSeqN0(raw.n0),
      count: clampSeqCount(raw.count),
      showPartner: raw.partner === true,
      showSums: raw.sums === true,
      params,
      ...(name !== undefined ? { name } : {}),
      ...(series !== undefined ? { series } : {}),
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
  if (f.eulers && f.eulers.length > 0) {
    out.eulers = f.eulers.slice(0, MAX_EULER_RUNS).map((r) => {
      const e: StoredEuler = { x0: r.x0, y0: r.y0, h: r.h, n: clampEulerN(r.n) }
      if (r.showTrue) e.true = true
      if (r.labels) e.labels = true
      return e
    })
  }
  return out
}

/**
 * The Euler runs out of an untrusted blob. A run with no usable start, or a
 * step size that is zero or not a number, cannot be stepped at all and is
 * dropped — each one reported. A step count is clamped rather than refused:
 * 80 steps is a request for "a lot", not a damaged record.
 */
export function storedToEulers(raw: unknown): { runs: EulerRun[]; problems: string[] } {
  const runs: EulerRun[] = []
  const problems: string[] = []
  if (raw === undefined) return { runs, problems }
  if (!Array.isArray(raw)) {
    problems.push('Its list of Euler’s-method runs was unreadable.')
    return { runs, problems }
  }
  let dropped = 0
  for (const r of raw) {
    if (runs.length >= MAX_EULER_RUNS) {
      problems.push(`Only the first ${MAX_EULER_RUNS} Euler’s-method runs were loaded.`)
      break
    }
    if (!isObj(r) || !isNum(r.x0) || !isNum(r.y0) || !isNum(r.h) || r.h === 0 || !isNum(r.n)) {
      dropped++
      continue
    }
    const run: EulerRun = { id: newId(), x0: r.x0, y0: r.y0, h: r.h, n: clampEulerN(r.n) }
    if (r.true === true) run.showTrue = true
    if (r.labels === true) run.labels = true
    runs.push(run)
  }
  if (dropped > 0) {
    problems.push(
      dropped === 1
        ? 'An Euler’s-method run with no usable start point or step size was removed.'
        : `${dropped} Euler’s-method runs with no usable start point or step size were removed.`,
    )
  }
  return { runs, problems }
}

/**
 * One slope field out of an untrusted blob, re-parsed.
 *
 * The equation is the only thing that can rebuild the closure, so a source
 * that no longer parses is not salvageable: null, with the parser's own
 * sentence, which the loader reports rather than swallowing.
 */
export function storedToField(
  raw: unknown,
): { field: BoardField; problems?: string[] } | { error: string } {
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

  const field: BoardField = {
    id,
    src,
    params,
    color: isStr(color) && color ? color : '#4f9cf9',
    spacingPx: clampFieldSpacing(raw.spacing),
    visible: raw.hidden !== true,
    solutions,
  }
  // Only a field that HAS runs grows the key, so a field from before Euler
  // existed comes back as exactly the object it always did.
  const euler = storedToEulers(raw.eulers)
  if (euler.runs.length > 0) field.eulers = euler.runs
  return euler.problems.length > 0 ? { field, problems: euler.problems } : { field }
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
    case 'tangent': {
      const out: StoredCalcLink = {
        kind: 'tangent',
        id: l.id,
        parentId: l.parentId,
        curveId: l.curveId,
        x: l.x,
      }
      // An implicit curve's point: its branch, and the marks switch when on.
      if (l.y !== undefined && Number.isFinite(l.y)) out.y = l.y
      if (l.marks) out.marks = true
      return out
    }
    case 'derivative':
      return { kind: 'derivative', id: l.id, parentId: l.parentId, curveId: l.curveId }
    case 'area':
      return {
        kind: 'area',
        id: l.id,
        parentId: l.parentId,
        // Written only when it is there. An area to the x-axis is the area to
        // the x-axis, and an absent second curve must not become `otherId:
        // undefined` in the bytes of every document that never had one.
        ...(l.otherId !== undefined && l.otherId !== '' ? { otherId: l.otherId } : {}),
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
    case 'accumulation':
      return {
        kind: 'accumulation',
        id: l.id,
        parentId: l.parentId,
        curveId: l.curveId,
        a: l.a,
        // 0 is the default and is not written; neither is an absent probe.
        ...(l.C !== 0 && Number.isFinite(l.C) ? { C: l.C } : {}),
        ...(l.x !== undefined && Number.isFinite(l.x) ? { x: l.x } : {}),
      }
    case 'taylor':
      return {
        kind: 'taylor',
        id: l.id,
        parentId: l.parentId,
        curveId: l.curveId,
        a: l.a,
        n: clampTaylorN(l.n),
        // Off is the default for both switches, and no probe is the default
        // probe: none of the three is written until somebody asks for it.
        ...(l.x !== undefined && Number.isFinite(l.x) ? { x: l.x } : {}),
        ...(l.band === true ? { band: true } : {}),
        ...(l.ioc === true ? { ioc: true } : {}),
      }
    case 'secant':
      return {
        kind: 'secant',
        id: l.id,
        parentId: l.parentId,
        a: l.a,
        b: l.b,
        // Both switches default off and are written only when on.
        ...(l.mvt === true ? { mvt: true } : {}),
        ...(l.avg === true ? { avg: true } : {}),
      }
    case 'limit':
      return {
        kind: 'limit',
        id: l.id,
        parentId: l.parentId,
        // JSON would write Infinity as null: ±∞ travels as a string sentinel.
        a: l.a === Infinity ? LIMIT_INF : l.a === -Infinity ? LIMIT_NEG_INF : l.a,
        // 'both' is the default, and one-sided is meaningless at ±∞.
        ...((l.side === 'left' || l.side === 'right') && Number.isFinite(l.a) ? { side: l.side } : {}),
        ...(l.table === true ? { table: true } : {}),
        ...(l.epsilon === true ? { epsilon: true } : {}),
        ...(l.epsilon === true && isNum(l.eps) && l.eps > 0 && l.eps !== LIMIT_EPS_DEFAULT ? { eps: l.eps } : {}),
      }
    case 'volume': {
      const axis = l.axis && isNum(l.axis.at) && (l.axis.dir === 'h' || l.axis.dir === 'v') ? l.axis : null
      const section = l.method === 'section' && isSectionShape(l.section) ? l.section : 'square'
      return {
        kind: 'volume',
        id: l.id,
        parentId: l.parentId,
        ...(l.otherId !== undefined && l.otherId !== '' ? { otherId: l.otherId } : {}),
        a: l.a,
        b: l.b,
        // Washers about the x-axis with no slice chosen is the default solid:
        // none of the switches below reach a file until somebody moves one.
        ...(l.method === 'shell' || l.method === 'section' ? { method: l.method } : {}),
        ...(axis && !(axis.dir === 'h' && axis.at === 0) ? { axis: { dir: axis.dir, at: axis.at } } : {}),
        ...(l.method === 'section' && section !== 'square' ? { section } : {}),
        ...(l.method === 'section' && section === 'rectangle' && isNum(l.ratio) && l.ratio > 0 && l.ratio !== 1
          ? { ratio: l.ratio }
          : {}),
        ...(l.method === 'section' && l.perp === 'y' ? { perp: 'y' as const } : {}),
        ...(l.x !== undefined && isNum(l.x) ? { x: l.x } : {}),
      }
    }
    case 'signchart': {
      const as = l.as === 'f1' || l.as === 'f2' ? l.as : undefined
      const pair = isNum(l.a) && isNum(l.b) && l.a !== l.b
      return {
        kind: 'signchart',
        id: l.id,
        parentId: l.parentId,
        // 'f' is the default: a chart of the graph itself writes no `as`.
        ...(as ? { as } : {}),
        rows: cleanSignRows(l.rows, as),
        ...(l.arrows === true && as !== 'f2' ? { arrows: true as const } : {}),
        ...(l.cup === true ? { cup: true as const } : {}),
        ...(l.guides === true ? { guides: true as const } : {}),
        // The Candidates Test interval travels as a pair, or not at all.
        ...(pair ? { a: Math.min(l.a as number, l.b as number), b: Math.max(l.a as number, l.b as number) } : {}),
      }
    }
    case 'pcalc': {
      const pair = isNum(l.a) && isNum(l.b) && l.a !== l.b
      return {
        kind: 'pcalc',
        id: l.id,
        parentId: l.parentId,
        t: l.t,
        ...(l.marks === true ? { marks: true as const } : {}),
        ...(pair ? { a: Math.min(l.a as number, l.b as number), b: Math.max(l.a as number, l.b as number) } : {}),
      }
    }
    case 'polarbetween': {
      const pair = isNum(l.a) && isNum(l.b) && l.a !== l.b
      return {
        kind: 'polarbetween',
        id: l.id,
        parentId: l.parentId,
        otherId: l.otherId,
        ...(l.swap === true ? { swap: true as const } : {}),
        ...(pair ? { a: Math.min(l.a as number, l.b as number), b: Math.max(l.a as number, l.b as number) } : {}),
      }
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
    case 'tangent': {
      if (!isStr(curveId) || !curveId || !isNum(raw.x)) return null
      const t: TangentLink = { kind: 'tangent', id, parentId, curveId, x: raw.x }
      if (isNum(raw.y)) t.y = raw.y
      if (raw.marks === true) t.marks = true
      return t
    }
    case 'derivative':
      if (!isStr(curveId) || !curveId) return null
      return { kind: 'derivative', id, parentId, curveId }
    case 'area': {
      if (!isNum(raw.from) || !isNum(raw.to)) return null
      // A second curve that is not a usable id is no second curve: the link
      // still describes the area under the parent, which is the region the
      // rest of its own numbers were measured on.
      const otherId = isStr(raw.otherId) && raw.otherId ? raw.otherId : undefined
      return {
        kind: 'area',
        id,
        parentId,
        ...(otherId ? { otherId } : {}),
        from: raw.from,
        to: raw.to,
        abs: raw.abs === true,
      }
    }
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
    case 'accumulation': {
      if (!isStr(curveId) || !curveId) return null
      // The lower limit is the whole definition: without it there is no g.
      // C and the probe default (0, none) when absent; a C that is present
      // but not a number is damage, and the link is refused rather than
      // quietly moved up or down the page.
      if (!isNum(raw.a)) return null
      if (raw.C !== undefined && !isNum(raw.C)) return null
      const C = isNum(raw.C) ? raw.C : 0
      return {
        kind: 'accumulation',
        id,
        parentId,
        curveId,
        a: raw.a,
        C,
        ...(isNum(raw.x) ? { x: raw.x } : {}),
      }
    }
    case 'taylor': {
      if (!isStr(curveId) || !curveId) return null
      // The centre IS the polynomial; without it there is nothing to rebuild.
      // A degree that is present but not a number is damage (the file says
      // something, and it is not a degree); an absent one is the default.
      if (!isNum(raw.a)) return null
      if (raw.n !== undefined && !isNum(raw.n)) return null
      return {
        kind: 'taylor',
        id,
        parentId,
        curveId,
        a: raw.a,
        n: clampTaylorN(raw.n),
        ...(isNum(raw.x) ? { x: raw.x } : {}),
        ...(raw.band === true ? { band: true } : {}),
        ...(raw.ioc === true ? { ioc: true } : {}),
      }
    }
    case 'secant': {
      // The two points ARE the secant: without both there is no line. The
      // switches are true or absent — anything else is simply off.
      if (!isNum(raw.a) || !isNum(raw.b)) return null
      return {
        kind: 'secant',
        id,
        parentId,
        a: raw.a,
        b: raw.b,
        ...(raw.mvt === true ? { mvt: true as const } : {}),
        ...(raw.avg === true ? { avg: true as const } : {}),
      }
    }
    case 'limit': {
      // The point IS the limit: a finite number, or the ±∞ sentinel. Anything
      // else (null, a bare Infinity that JSON already lost) is refused. The
      // side and the switches default when they are not what they should be.
      const a = isNum(raw.a) ? raw.a : raw.a === LIMIT_INF ? Infinity : raw.a === LIMIT_NEG_INF ? -Infinity : null
      if (a === null) return null
      const side = Number.isFinite(a) && (raw.side === 'left' || raw.side === 'right') ? raw.side : undefined
      // Held to the card's slider (0.01–2): a hand-written 1e300 is not an ε
      // the picture, the δ search or the slider can do anything with.
      const eps =
        raw.epsilon === true && isNum(raw.eps) && raw.eps > 0
          ? Math.min(LIMIT_EPS_MAX, Math.max(LIMIT_EPS_MIN, raw.eps))
          : undefined
      return {
        kind: 'limit',
        id,
        parentId,
        a,
        ...(side ? { side } : {}),
        ...(raw.table === true ? { table: true as const } : {}),
        ...(raw.epsilon === true ? { epsilon: true as const } : {}),
        ...(eps !== undefined && eps !== LIMIT_EPS_DEFAULT ? { eps } : {}),
      }
    }
    case 'volume': {
      // The interval IS the region's extent: without both ends there is no
      // solid. Everything else defaults when it is not what it should be — an
      // axis that is not {dir, finite at} is the x-axis, a method that is not
      // one of the three is washers, a section that is not a shape is a square.
      if (!isNum(raw.a) || !isNum(raw.b)) return null
      const otherId = isStr(raw.otherId) && raw.otherId ? raw.otherId : undefined
      const method: VolumeMethod = raw.method === 'shell' || raw.method === 'section' ? raw.method : 'washer'
      const ax = raw.axis
      const axis =
        isObj(ax) && (ax.dir === 'h' || ax.dir === 'v') && isNum(ax.at) && !(ax.dir === 'h' && ax.at === 0)
          ? { dir: ax.dir as 'h' | 'v', at: ax.at }
          : undefined
      const section = method === 'section' && isSectionShape(raw.section) && raw.section !== 'square' ? raw.section : undefined
      const ratio =
        section === 'rectangle' && isNum(raw.ratio) && raw.ratio > 0 && raw.ratio !== 1 ? raw.ratio : undefined
      // A slice in dx sits inside [a, b]. One in dy (washers about a vertical
      // axis, shells about a horizontal one, sections ⟂ y) holds a HEIGHT,
      // whose range only the curves know — the board clamps that one.
      const dir = axis ? axis.dir : 'h'
      const inY =
        (method === 'washer' && dir === 'v') ||
        (method === 'shell' && dir === 'h') ||
        (method === 'section' && raw.perp === 'y')
      const sliceX = (x: number): number =>
        inY ? x : Math.min(Math.max(raw.a as number, raw.b as number), Math.max(Math.min(raw.a as number, raw.b as number), x))
      return {
        kind: 'volume',
        id,
        parentId,
        ...(otherId ? { otherId } : {}),
        a: raw.a,
        b: raw.b,
        method,
        ...(axis ? { axis } : {}),
        ...(section ? { section } : {}),
        ...(ratio !== undefined ? { ratio } : {}),
        ...(method === 'section' && raw.perp === 'y' ? { perp: 'y' as const } : {}),
        ...(isNum(raw.x) ? { x: sliceX(raw.x) } : {}),
      }
    }
    case 'signchart': {
      // Everything about a sign chart defaults: rows that are not rows are
      // dropped, a switch that is not true is off, an interval that is not a
      // pair of distinct numbers is no interval. `as` that is not f′ or f″ is f.
      const as = raw.as === 'f1' || raw.as === 'f2' ? raw.as : undefined
      const pair = isNum(raw.a) && isNum(raw.b) && raw.a !== raw.b
      return {
        kind: 'signchart',
        id,
        parentId,
        ...(as ? { as } : {}),
        rows: cleanSignRows(raw.rows, as),
        ...(raw.arrows === true && as !== 'f2' ? { arrows: true as const } : {}),
        ...(raw.cup === true ? { cup: true as const } : {}),
        ...(raw.guides === true ? { guides: true as const } : {}),
        ...(pair
          ? { a: Math.min(raw.a as number, raw.b as number), b: Math.max(raw.a as number, raw.b as number) }
          : {}),
      }
    }
    case 'pcalc': {
      // The chosen t IS the object: without it there is no point to read at.
      // The switch is true or off; the interval a pair or nothing.
      if (!isNum(raw.t)) return null
      const pair = isNum(raw.a) && isNum(raw.b) && raw.a !== raw.b
      return {
        kind: 'pcalc',
        id,
        parentId,
        t: raw.t,
        ...(raw.marks === true ? { marks: true as const } : {}),
        ...(pair
          ? { a: Math.min(raw.a as number, raw.b as number), b: Math.max(raw.a as number, raw.b as number) }
          : {}),
      }
    }
    case 'polarbetween': {
      // The second curve IS half the region: without it there is nothing.
      if (!isStr(raw.otherId) || !raw.otherId || raw.otherId === parentId) return null
      const pair = isNum(raw.a) && isNum(raw.b) && raw.a !== raw.b
      return {
        kind: 'polarbetween',
        id,
        parentId,
        otherId: raw.otherId,
        ...(raw.swap === true ? { swap: true as const } : {}),
        ...(pair
          ? { a: Math.min(raw.a as number, raw.b as number), b: Math.max(raw.a as number, raw.b as number) }
          : {}),
      }
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
    case 'accumulation':
      return 'accumulation function'
    case 'taylor':
      return 'Taylor polynomial'
    case 'secant':
      return 'secant line'
    case 'limit':
      return 'limit'
    case 'volume':
      return 'volume'
    case 'signchart':
      return 'sign chart'
    case 'pcalc':
      return 'parametric / polar calculus point'
    case 'polarbetween':
      return 'area between polar curves'
  }
}

/** Copy an item into a fresh, own-property-only record (no aliasing, no extras). */
function itemToStored(it: NLItem, style: CurveStyle | undefined): StoredNLItem {
  // A number-line item has no ends to cap (the card never offers them), but the
  // style map is one map: whatever is on it travels with it, sanitised.
  const ends = writableEnds(style?.ends)
  const styled =
    style &&
    (style.dash !== undefined ||
      style.opacity !== undefined ||
      ends !== undefined ||
      style.width !== undefined ||
      style.group !== undefined)
      ? { style: withEnds(style, ends) }
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
  if (it.kind === 'solve') {
    // Only what was TYPED and how to show it: the solution, the critical
    // values and the working are recomputed from `src` on load.
    return {
      ...styled,
      kind: 'solve',
      id: it.id,
      src: it.src,
      color: it.color,
      ...(it.label !== undefined ? { label: it.label } : {}),
      show: solveShowToStored(it.show),
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
  env?: FunctionEnv,
): { spec: ModelSpec } | { error: string } {
  let outcome: ReturnType<typeof parseExpression>
  try {
    outcome = parseExpression(source, env)
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

/** A solve item's typed line is capped: no inequality a teacher types is longer. */
const MAX_SOLVE_SRC_CHARS = 400

/** The display flags, own booleans only, in a fixed key order. */
function solveShowToStored(show: NLSolveShow | undefined): NLSolveShow {
  const out: NLSolveShow = {}
  const src = (show ?? {}) as Record<string, unknown>
  for (const k of ['signs', 'tests', 'distance', 'stacked'] as const) {
    if (typeof src[k] === 'boolean') out[k] = src[k] as boolean
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
  if (raw.kind === 'solve') {
    if (!isStr(raw.src)) return null
    const src = raw.src.slice(0, MAX_SOLVE_SRC_CHARS)
    if (src.trim() === '') return null
    return {
      kind: 'solve',
      id,
      src,
      color,
      ...(label !== undefined ? { label } : {}),
      show: solveShowToStored(isObj(raw.show) ? (raw.show as NLSolveShow) : {}),
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

const END_CAPS: readonly EndCap[] = ['auto', 'none', 'arrow', 'open', 'closed']

/** One end's cap, or undefined for anything this reader does not recognise. */
function capOf(raw: unknown): EndCap | undefined {
  return isStr(raw) && (END_CAPS as readonly string[]).includes(raw)
    ? (raw as EndCap)
    : undefined
}

/**
 * End caps off disk. An unknown word is dropped rather than guessed at, and
 * 'auto' is normalised away so the live map says the same thing the file did.
 */
function endsOf(raw: unknown): CurveEnds | undefined {
  if (!isObj(raw)) return undefined
  return writableEnds({ start: capOf(raw.start), end: capOf(raw.end) })
}

function styleOf(raw: unknown): CurveStyle | null {
  if (!isObj(raw)) return null
  const style: CurveStyle = {}
  const dash = numArray(raw.dash, 8)
  if (dash && dash.length > 0) style.dash = dash
  if (isNum(raw.opacity)) style.opacity = Math.min(1, Math.max(0, raw.opacity))
  const ends = endsOf(raw.ends)
  if (ends) style.ends = ends
  if (isNum(raw.width)) style.width = Math.min(64, Math.max(0.5, raw.width))
  if (isStr(raw.group) && raw.group.trim()) style.group = raw.group.slice(0, 64)
  return style.dash ||
    style.opacity !== undefined ||
    style.ends !== undefined ||
    style.width !== undefined ||
    style.group !== undefined
    ? style
    : null
}

/**
 * Turn a parsed (but untrusted) document into live board state.
 * Never throws: whatever is individually valid is kept, the rest is reported.
 */
/** How a load wires the typed lines that call other curves. */
export interface HydrateOptions {
  /**
   * f(x) for the curve NAMED `name`, at its live parameters — the board's own
   * resolver, so the models a load builds follow later slider drags. Absent:
   * the loaded document's curves as they were stored (tests, previews).
   */
  resolve?: (name: string, x: number) => number
  /**
   * Where the curve NAMED `name` is undefined (FunctionEnv.singularities) —
   * the board's own answer, so a loaded `g(x) = 2f(x − 1) + 3` finds f's
   * asymptote exactly as a freshly typed one does. Absent: a named call
   * contributes no singularities (tests, previews).
   */
  singularities?: (name: string, range: [number, number]) => number[]
}

export function hydrateDoc(rawDoc: unknown, opts: HydrateOptions = {}): LoadResult {
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
  const viewport: HydratedBoard['viewport'] = {
    center: { x: isNum(rawVp.cx) ? rawVp.cx : 0, y: isNum(rawVp.cy) ? rawVp.cy : 0 },
    pxPerUnit: Math.min(1e9, Math.max(1e-9, ppuRaw)),
  }
  // Independent axes. A y scale that is not a positive number is not a view
  // anybody chose: the board opens with equal axes and says so.
  if ('ppuY' in rawVp) {
    if (isNum(rawVp.ppuY) && rawVp.ppuY > 0) {
      viewport.pxPerUnitY = Math.min(1e9, Math.max(1e-9, rawVp.ppuY))
    } else {
      problems.push('The saved y scale was unreadable; the axes were made equal.')
      degraded = true
    }
  }

  // curves
  const curves: FittedCurve[] = []
  const styles: StyleMap = {}
  const candidates = new Map<string, FitResult[]>()
  const extraModels: Record<string, ModelSpec> = {}
  const exprSources: Record<string, string> = {}
  const displaySources: Record<string, string> = {}
  const brokenExpr: Record<string, string> = {}
  const names: Record<string, string> = {}
  const calls: Record<string, string[]> = {}
  let exprCounter = 0

  // The names a typed line calls are evaluated LAZILY, through this resolver,
  // so the order the lines are read in does not matter: parsing only has to
  // know WHICH letters are calls, and each stored line says so itself.
  const resolve = opts.resolve ?? storedResolver(curves, names, extraModels)

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

    // The curve's letter. Two curves claiming one letter is damage; the second
    // loses it quietly and the board hands it a fresh one.
    if (isNameLetter(stored.name) && !Object.values(names).includes(stored.name)) {
      names[curve.id] = stored.name
    }

    // Typed equations: rebuild the model closure from its source text.
    if (isStr(stored.exprSource) && stored.exprSource.trim()) {
      const source = stored.exprSource
      exprSources[curve.id] = source
      const m = /^expr_(\d+)$/.exec(curve.modelId)
      if (m) exprCounter = Math.max(exprCounter, Number(m[1]))
      const lineCalls = Array.isArray(stored.calls)
        ? [...new Set(stored.calls.filter(isNameLetter))]
        : []
      if (lineCalls.length > 0) calls[curve.id] = lineCalls
      const env = storedLineEnv(resolve, lineCalls, source, stored.name, opts.singularities)
      const rebuilt = rebuildExprModel(curve.modelId, source, env)
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
    /** curve id → already drawn by a link (a derived curve has one driver). */
    const drawn = new Set<string>()
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
      if (
        (link.kind === 'area' || link.kind === 'volume' || link.kind === 'polarbetween') &&
        link.otherId !== undefined &&
        !curveIds.has(link.otherId)
      ) {
        // The same loss as a missing parent, and reported the same way: the
        // region between f and a curve that is gone is not the region under f.
        problems.push(
          `A ${calcNoun(link.kind)} was dropped: the second curve it was measured against is no longer in this document.`,
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
      if (isCurveLink(link) && link.curveId === link.parentId) {
        // A link that draws its own parent would overwrite the parent with
        // the thing derived from it (a Taylor polynomial of f replacing f).
        problems.push(`A ${calcNoun(link.kind)} was dropped: it claimed to draw the curve it came from.`)
        degraded = true
        continue
      }
      if (isCurveLink(link) && drawn.has(link.curveId)) {
        // Two links driving one curve would fight over it on every change.
        problems.push(
          `A ${calcNoun(link.kind)} was dropped: its curve is already drawn by another calculus object.`,
        )
        degraded = true
        continue
      }
      if (isCurveLink(link)) drawn.add(link.curveId)
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

  // An accumulation function that had to be a closure is rebuilt the same way,
  // from its parent and the link's own a and C. Its id is the link's, so there
  // is no counter to restore. A closed-form one (x³/3 − x IS a cubic) needs
  // nothing: its family is in the library.
  {
    const byId = new Map(curves.map((c) => [c.id, c]))
    const lost = new Set<string>()
    for (const link of calc) {
      if (link.kind !== 'accumulation') continue
      const child = byId.get(link.curveId)
      const parent = byId.get(link.parentId)
      if (!child || !parent) continue
      if (MODELS[child.modelId] ?? extraModels[child.modelId]) continue
      let built: ReturnType<typeof accumulationModel> = null
      try {
        built = accumulationModel(parent, { ...MODELS, ...extraModels }, link.a, link.C, child.modelId)
      } catch {
        built = null
      }
      if (built && built.spec.id === child.modelId) {
        extraModels[child.modelId] = built.spec
        continue
      }
      if (built) {
        // The parent is now a family whose antiderivative IS in the library:
        // the curve simply becomes that family, which is what the board would
        // have made of it anyway.
        child.modelId = built.spec.id
        child.params = built.params.slice()
        continue
      }
      problems.push(
        'An accumulation function could not be rebuilt from the curve it came from, so it was removed.',
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

  // A Taylor polynomial is always a closure, rebuilt by the board from its
  // parent and the link's own a and n (src/ui/calcLinks.ts — a sketched
  // parent is read through its equation text, which core cannot reach). All
  // this loader can check is that every such curve still has a link to be
  // rebuilt from: one that lost it has nothing that could ever draw it.
  {
    const claimed = new Set<string>()
    for (const link of calc) if (link.kind === 'taylor') claimed.add(link.curveId)
    const orphan = curves.filter(
      (c) => c.modelId.startsWith(TAYLOR_MODEL_PREFIX) && !claimed.has(c.id),
    )
    if (orphan.length > 0) {
      const gone = new Set(orphan.map((c) => c.id))
      for (let i = curves.length - 1; i >= 0; i--) {
        if (gone.has(curves[i].id)) curves.splice(i, 1)
      }
      for (const id of gone) delete names[id]
      problems.push(
        `${orphan.length === 1 ? 'A Taylor polynomial' : `${orphan.length} Taylor polynomials`} could not be rebuilt without the curve ${orphan.length === 1 ? 'it' : 'they'} came from, so ${orphan.length === 1 ? 'it was' : 'they were'} removed.`,
      )
      degraded = true
    }
  }

  // ---- inverse links
  //
  // Kept when its parent and its curve are both here; the curve's model is
  // the board's to register (it reads the parent live). An inverse curve whose
  // link did not survive has nothing to draw it, so it goes too — reported.
  const inverses: InverseLink[] = []
  {
    const rawInv = Array.isArray(rawBoard.inverses) ? rawBoard.inverses : []
    if (rawBoard.inverses !== undefined && !Array.isArray(rawBoard.inverses)) {
      problems.push('The list of inverses was unreadable.')
      degraded = true
    }
    const curveIds = new Set(curves.map((c) => c.id))
    const seenInv = new Set<string>()
    const claimed = new Set<string>()
    for (const raw of rawInv.slice(0, MAX_CALC)) {
      if (!isObj(raw)) continue
      const { id, parentId, curveId, from, to } = raw
      if (!isStr(id) || !id || !isStr(parentId) || !isStr(curveId) || !isNum(from) || !isNum(to)) {
        problems.push('A damaged inverse could not be read.')
        degraded = true
        continue
      }
      if (seenInv.has(id) || claimed.has(curveId)) continue
      if (!curveIds.has(parentId) || !curveIds.has(curveId)) {
        problems.push('An inverse was dropped: the curve it belonged to is no longer in this document.')
        degraded = true
        continue
      }
      seenInv.add(id)
      claimed.add(curveId)
      inverses.push({ id, parentId, curveId, from, to })
    }
    const orphan = curves.filter(
      (c) => c.modelId.startsWith(INV_MODEL_PREFIX) && !claimed.has(c.id),
    )
    if (orphan.length > 0) {
      const gone = new Set(orphan.map((c) => c.id))
      for (let i = curves.length - 1; i >= 0; i--) {
        if (gone.has(curves[i].id)) curves.splice(i, 1)
      }
      for (const id of gone) delete names[id]
      problems.push(
        `${orphan.length === 1 ? 'An inverse curve' : `${orphan.length} inverse curves`} could not be rebuilt, so ${orphan.length === 1 ? 'it was' : 'they were'} removed.`,
      )
      degraded = true
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
    if (built.problems && built.problems.length > 0) {
      for (const p of built.problems) problems.push(`The slope field “${built.field.src}”: ${p}`)
      degraded = true
    }
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

  // ---- data tables
  //
  // The cells come back as typed; the scatter plot and every regression are
  // re-fitted from them. A table that cannot be read is dropped and reported.
  // A regression whose curve is not on the board any more is dropped and
  // reported too: it would be a fit with nowhere to draw.
  const data: BoardData[] = []
  const rawData = Array.isArray(rawBoard.data) ? rawBoard.data : []
  if (rawBoard.data !== undefined && !Array.isArray(rawBoard.data)) {
    problems.push('The list of data tables was unreadable.')
    degraded = true
  }
  if (rawData.length > MAX_DATA) {
    problems.push(`Only the first ${MAX_DATA} data tables were loaded.`)
    degraded = true
  }
  {
    const curveIds = new Set(curves.map((c) => c.id))
    const claimed = new Set<string>()
    for (const raw of rawData.slice(0, MAX_DATA)) {
      const built = storedToData(raw)
      if ('error' in built) {
        const nm = isObj(raw) && isStr(raw.name) ? raw.name : null
        problems.push(
          nm
            ? `The data table “${nm}” could not be restored: ${built.error}.`
            : `A data table could not be restored: ${built.error}.`,
        )
        degraded = true
        continue
      }
      if (seen.has(built.data.id)) {
        problems.push('A data table was dropped: two objects claimed the same id.')
        degraded = true
        continue
      }
      seen.add(built.data.id)
      const table = built.data
      if (built.droppedRegressions > 0) {
        const k = built.droppedRegressions
        problems.push(
          `${k} damaged regression${k === 1 ? '' : 's'} on “${table.name}” could not be read.`,
        )
        degraded = true
      }
      const kept: DataRegression[] = []
      for (const r of table.regressions) {
        if (!curveIds.has(r.curveId) || claimed.has(r.curveId)) {
          problems.push(
            `A ${r.kind} regression on “${table.name}” was dropped: the curve it drew is no longer in this document.`,
          )
          degraded = true
          continue
        }
        claimed.add(r.curveId)
        kept.push(r)
      }
      table.regressions = kept
      data.push(table)
    }
  }

  // ---- sequences
  //
  // One typed line each. A record with no line is dropped and reported; a
  // line that no longer parses is kept — the card says what is wrong with it.
  const sequences: BoardSequence[] = []
  const rawSeqs = Array.isArray(rawBoard.sequences) ? rawBoard.sequences : []
  if (rawBoard.sequences !== undefined && !Array.isArray(rawBoard.sequences)) {
    problems.push('The list of sequences was unreadable.')
    degraded = true
  }
  if (rawSeqs.length > MAX_SEQUENCES) {
    problems.push(`Only the first ${MAX_SEQUENCES} sequences were loaded.`)
    degraded = true
  }
  for (const raw of rawSeqs.slice(0, MAX_SEQUENCES)) {
    const built = storedToSequence(raw)
    if ('error' in built) {
      problems.push(`A sequence could not be restored: ${built.error}.`)
      degraded = true
      continue
    }
    if (seen.has(built.sequence.id)) {
      problems.push('A sequence was dropped: two objects claimed the same id.')
      degraded = true
      continue
    }
    seen.add(built.sequence.id)
    sequences.push(built.sequence)
  }

  // ---- unit circles
  const unitCircles: BoardUnitCircle[] = []
  const rawCircles = Array.isArray(rawBoard.unitCircles) ? rawBoard.unitCircles : []
  if (rawBoard.unitCircles !== undefined && !Array.isArray(rawBoard.unitCircles)) {
    problems.push('The unit circle was unreadable.')
    degraded = true
  }
  if (rawCircles.length > MAX_UNIT_CIRCLES) {
    problems.push(`Only the first ${MAX_UNIT_CIRCLES} unit circles were loaded.`)
    degraded = true
  }
  for (const raw of rawCircles.slice(0, MAX_UNIT_CIRCLES)) {
    const built = storedToUnitCircle(raw)
    if ('error' in built) {
      problems.push(`A unit circle could not be restored: ${built.error}.`)
      degraded = true
      continue
    }
    if (seen.has(built.circle.id)) {
      problems.push('A unit circle was dropped: two objects claimed the same id.')
      degraded = true
      continue
    }
    seen.add(built.circle.id)
    unitCircles.push(built.circle)
  }

  // ---- related rates
  const relatedRates: BoardRelatedRates[] = []
  if (rawBoard.relatedRates !== undefined) {
    const rrProblems: string[] = []
    const built = storedToRelatedRates(rawBoard.relatedRates, rrProblems)
    if (!('error' in built) && rrProblems.length > 0) {
      problems.push(...rrProblems)
      degraded = true
    }
    if ('error' in built) {
      problems.push(`The related-rates problem could not be restored: ${built.error}.`)
      degraded = true
    } else if (seen.has(built.rr.id)) {
      problems.push('The related-rates problem was dropped: two objects claimed the same id.')
      degraded = true
    } else {
      seen.add(built.rr.id)
      relatedRates.push(built.rr)
    }
  }

  // ---- the inequality system. Absent is the default; unreadable keys drop.
  const sysProblems: string[] = []
  const system = storedToSystem(rawBoard.system, sysProblems)
  if (sysProblems.length > 0) {
    problems.push(...sysProblems)
    degraded = true
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
  // PRESENCE, not content: a stored "" is a caption the teacher cleared, and a
  // missing key is a document that never had an opinion — which is every
  // document written before captions followed the board.
  const captionAuto = !isStr(rawBoard.caption)

  // ---- per-curve view settings. Absent is the default and says nothing. An
  // entry for a curve that is no longer here, or one that cannot be read, is
  // dropped and REPORTED — a construction a lesson was built around does not
  // quietly vanish; a field that cannot be read is dropped from its entry and
  // the rest of the entry kept.
  const curveViews: CurveViews = {}
  if (rawBoard.curveViews !== undefined) {
    if (!isObj(rawBoard.curveViews)) {
      problems.push('The curves’ view settings were unreadable and were reset.')
      degraded = true
    } else {
      const ids = new Set(curves.map((c) => c.id))
      let orphans = 0
      let damaged = 0
      for (const [id, raw] of Object.entries(rawBoard.curveViews)) {
        if (!ids.has(id)) {
          orphans++
          continue
        }
        if (!isObj(raw)) {
          damaged++
          continue
        }
        const v = readStoredCurveView(raw)
        if (v.damaged) damaged++
        if (v.view) curveViews[id] = v.view
      }
      if (orphans > 0) {
        problems.push(
          orphans === 1
            ? 'A curve’s view settings were dropped: the curve is no longer in this document.'
            : `${orphans} curves’ view settings were dropped: those curves are no longer in this document.`,
        )
        degraded = true
      }
      if (damaged > 0) {
        problems.push(
          damaged === 1
            ? 'A curve’s view settings could not all be read; the unreadable ones were reset.'
            : `${damaged} curves’ view settings could not all be read; the unreadable ones were reset.`,
        )
        degraded = true
      }
    }
  }

  // ---- the teacher note. Absent is the default; a note that is there but is
  // not text is a lost instruction, so it is reported rather than dropped.
  const note = storedNote(rawBoard.note)
  if (rawBoard.note !== undefined && !isStr(rawBoard.note)) {
    problems.push('The document’s teacher note was unreadable and was dropped.')
    degraded = true
  }

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
    ...data.map((d) => d.id),
    ...sequences.map((q) => q.id),
    ...unitCircles.map((u) => u.id),
    ...relatedRates.map((r) => r.id),
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
      names,
      calls,
      inverses,
      fields,
      shapes,
      data,
      sequences,
      unitCircles,
      relatedRates,
      system,
      grid,
      figure,
      caption,
      captionAuto,
      curveViews,
      ...(note !== '' ? { note } : {}),
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

/**
 * One stored entry read back: every field that is what it claims to be, and
 * whether any field was not. An unknown key is a newer writer's, not damage.
 */
function readStoredCurveView(raw: Record<string, unknown>): { view: CurveView | null; damaged: boolean } {
  let damaged = false
  const v: CurveView = {}
  if (raw.construction !== undefined) {
    if (raw.construction === true) v.construction = true
    else damaged = true
  }
  if (raw.showParent !== undefined) {
    if (typeof raw.showParent === 'boolean') v.showParent = raw.showParent
    else damaged = true
  }
  if (raw.area !== undefined) {
    const a = raw.area
    if (
      isObj(a) &&
      typeof a.on === 'boolean' &&
      isStr(a.a) && a.a.length <= MAX_VIEW_TEXT &&
      isStr(a.b) && a.b.length <= MAX_VIEW_TEXT
    ) {
      v.area = { on: a.on, a: a.a, b: a.b }
    } else damaged = true
  }
  if (raw.accel !== undefined) {
    if (raw.accel === true) v.accel = true
    else damaged = true
  }
  if (raw.exportParticle !== undefined) {
    if (raw.exportParticle === true) v.exportParticle = true
    else damaged = true
  }
  if (raw.through !== undefined) {
    const t = raw.through
    if (Array.isArray(t) && t.length === 2 && isNum(t[0]) && isNum(t[1])) v.through = { x: t[0], y: t[1] }
    else damaged = true
  }
  if (raw.ghost !== undefined) {
    if (raw.ghost === true) v.ghost = true
    else damaged = true
  }
  if (raw.hlt !== undefined) {
    if (isNum(raw.hlt)) v.hlt = raw.hlt
    else damaged = true
  }
  if (raw.reflect !== undefined) {
    if (isNum(raw.reflect)) v.reflect = raw.reflect
    else damaged = true
  }
  return { view: normalizeCurveView(v), damaged }
}

/**
 * f(x) for a named curve of the document being loaded, at its stored
 * parameters. Used only when the caller brings no resolver of its own. A name
 * re-entered while it is being evaluated (f and g calling each other) is NaN,
 * never a stack overflow.
 */
function storedResolver(
  curves: readonly FittedCurve[],
  names: Readonly<Record<string, string>>,
  extraModels: Readonly<Record<string, ModelSpec>>,
): (name: string, x: number) => number {
  const active = new Set<string>()
  return (name, x) => {
    let c: FittedCurve | undefined
    for (const k of curves) {
      if (names[k.id] === name) {
        c = k
        break
      }
    }
    if (!c || c.kind !== 'explicit' || active.has(c.id)) return Number.NaN
    if (c.domain && (x < Math.min(c.domain[0], c.domain[1]) || x > Math.max(c.domain[0], c.domain[1]))) {
      return Number.NaN
    }
    const spec = extraModels[c.modelId] ?? MODELS[c.modelId]
    if (!spec || !spec.evalExplicit) return Number.NaN
    active.add(c.id)
    try {
      const v = spec.evalExplicit(c.params, x)
      return typeof v === 'number' ? v : Number.NaN
    } catch {
      return Number.NaN
    } finally {
      active.delete(c.id)
    }
  }
}

/**
 * The env one stored line is parsed against: the letters it CALLS (stored
 * with it), plus its own head when that head is its stored name — so the
 * line parses exactly as it did when it was typed. Undefined when the line
 * calls nothing and names nothing: it then parses as it always has.
 */
function storedLineEnv(
  resolve: (name: string, x: number) => number,
  lineCalls: readonly string[],
  source: string,
  name: unknown,
  singularities?: (name: string, range: [number, number]) => number[],
): FunctionEnv | undefined {
  const head = namedCallSites(source).head
  const own = isNameLetter(name) && head === name ? name : null
  if (lineCalls.length === 0 && own === null) return undefined
  const has = new Set(lineCalls)
  if (own !== null) has.add(own)
  const env: FunctionEnv = { has: (n) => has.has(n), eval: (n, x) => resolve(n, x) }
  if (singularities) env.singularities = (n, range) => singularities(n, range)
  return env
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
    names: {},
    calls: {},
    inverses: [],
    fields: [],
    shapes: [],
    data: [],
    sequences: [],
    unitCircles: [],
    relatedRates: [],
    system: null,
    grid: 'cartesian',
    figure: 'screen',
    caption: '',
    captionAuto: true,
    curveViews: {},
    viewport: { center: { x: 0, y: 0 }, pxPerUnit: 60 },
    selectedId: null,
    mode: 'draw',
    exprCounter: 0,
    derivCounter: 0,
  }
}

/** Parse a stored JSON string. Never throws — a hostile blob yields a report. */
export function deserializeDoc(json: string, opts: HydrateOptions = {}): LoadResult {
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
  return hydrateDoc(raw, opts)
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

// ================================================================ worksheets
//
// A worksheet is a PAGE OF FIGURES: references to documents (never copies of
// them), each with an optional label override, caption and figure style, laid
// out in a grid on a letter or A4 page. It is stored beside the documents under
// a key of its own (src/ui/storage.ts), so no document's bytes change and an
// older reader never sees it. The figures are rebuilt from the documents every
// time the sheet is opened or exported: a worksheet follows its documents.

export type SheetPage = 'letter' | 'a4'
export type SheetOrientation = 'portrait' | 'landscape'
export type SheetCols = 1 | 2 | 3
/** (a) (b) (c) …, 1 2 3 …, or no labels at all. */
export type SheetNumbering = 'a' | '1' | 'none'

export interface WorksheetItem {
  /** The document this figure is drawn from. */
  docId: string
  /** Replaces the automatic "(a)" — e.g. "7." or "(iii)". Blank = automatic. */
  label?: string
  /** One line printed under the figure. */
  caption?: string
  /** This figure's style; absent = the sheet's style. */
  style?: FigureStyleId
}

export interface Worksheet {
  id: string
  name: string
  page: SheetPage
  orientation: SheetOrientation
  cols: SheetCols
  items: WorksheetItem[]
  numbering: SheetNumbering
  /** Printed across the top of page 1. */
  title?: string
  /**
   * The answer key: analysis markers, their labels and the intersection chips
   * on every figure. Off (absent) = the clean student version.
   */
  showAnswers?: boolean
  /** The style every figure takes unless it says otherwise. Absent = 'textbook'. */
  style?: FigureStyleId
  /** "Name: ______  Date: ____" under the title. Absent = shown. */
  nameLine?: boolean
  createdAt: number
  modifiedAt: number
}

export const WORKSHEET_VERSION = 1
export const MAX_SHEET_ITEMS = 60
export const MAX_SHEETS = 200
const MAX_SHEET_NAME = 80
const MAX_SHEET_TITLE = 160
const MAX_SHEET_CAPTION = 200
const MAX_SHEET_LABEL = 12
/** The style a new sheet's figures are drawn in: paper, light, unfussy. */
export const DEFAULT_SHEET_STYLE: FigureStyleId = 'textbook'

/** Printable text: control characters become spaces, then trimmed and capped. */
function sheetText(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined
  // eslint-disable-next-line no-control-regex
  const t = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return t === '' ? undefined : t.slice(0, max)
}

export function newWorksheet(name: string, now = Date.now()): Worksheet {
  return {
    id: newId(),
    name: sheetText(name, MAX_SHEET_NAME) ?? 'Worksheet',
    page: 'letter',
    orientation: 'portrait',
    cols: 2,
    items: [],
    numbering: 'a',
    showAnswers: false,
    style: DEFAULT_SHEET_STYLE,
    nameLine: true,
    createdAt: now,
    modifiedAt: now,
  }
}

/**
 * Read one worksheet out of untrusted JSON. Null when it is not a worksheet at
 * all (no id); otherwise every field is repaired to something valid, and an
 * item that names no document is dropped.
 */
export function storedToWorksheet(raw: unknown): Worksheet | null {
  if (!isObj(raw)) return null
  const id = typeof raw.id === 'string' && raw.id.trim() !== '' ? raw.id.slice(0, 64) : null
  if (!id) return null
  const items: WorksheetItem[] = []
  if (Array.isArray(raw.items)) {
    for (const it of raw.items.slice(0, MAX_SHEET_ITEMS)) {
      if (!isObj(it) || typeof it.docId !== 'string' || it.docId === '') continue
      const label = sheetText(it.label, MAX_SHEET_LABEL)
      const caption = sheetText(it.caption, MAX_SHEET_CAPTION)
      items.push({
        docId: it.docId.slice(0, 64),
        ...(label !== undefined ? { label } : {}),
        ...(caption !== undefined ? { caption } : {}),
        ...(isFigureStyleId(it.style) ? { style: it.style } : {}),
      })
    }
  }
  const title = sheetText(raw.title, MAX_SHEET_TITLE)
  const at = (v: unknown): number => (isNum(v) && v >= 0 ? v : 0)
  return {
    id,
    name: sheetText(raw.name, MAX_SHEET_NAME) ?? 'Worksheet',
    page: raw.page === 'a4' ? 'a4' : 'letter',
    orientation: raw.orientation === 'landscape' ? 'landscape' : 'portrait',
    cols: raw.cols === 1 || raw.cols === 3 ? raw.cols : 2,
    items,
    numbering: raw.numbering === '1' || raw.numbering === 'none' ? raw.numbering : 'a',
    ...(title !== undefined ? { title } : {}),
    showAnswers: raw.showAnswers === true,
    style: isFigureStyleId(raw.style) ? raw.style : DEFAULT_SHEET_STYLE,
    nameLine: raw.nameLine !== false,
    createdAt: at(raw.createdAt),
    modifiedAt: at(raw.modifiedAt),
  }
}

/** The on-disk record for every worksheet: a version and the list. */
export function serializeWorksheets(sheets: readonly Worksheet[]): string {
  return JSON.stringify({ version: WORKSHEET_VERSION, sheets: sheets.slice(0, MAX_SHEETS) })
}

/**
 * Read the worksheets record. Never throws: a damaged record reads as empty,
 * an unreadable sheet is skipped and REPORTED, a duplicate id keeps the first.
 */
export function deserializeWorksheets(json: string | null): { sheets: Worksheet[]; problems: string[] } {
  if (json === null || json.trim() === '') return { sheets: [], problems: [] }
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return { sheets: [], problems: ['The saved worksheets are corrupted and could not be read.'] }
  }
  const list = isObj(raw) && Array.isArray(raw.sheets) ? raw.sheets : Array.isArray(raw) ? raw : null
  if (!list) return { sheets: [], problems: ['The saved worksheets are not in a format this app reads.'] }
  const problems: string[] = []
  if (isObj(raw) && isNum(raw.version) && raw.version > WORKSHEET_VERSION) {
    problems.push('These worksheets were saved by a newer version of Grapher; anything unknown was skipped.')
  }
  const sheets: Worksheet[] = []
  const seen = new Set<string>()
  for (const s of list.slice(0, MAX_SHEETS)) {
    const w = storedToWorksheet(s)
    if (!w) {
      problems.push('An unreadable worksheet was skipped.')
      continue
    }
    if (seen.has(w.id)) continue
    seen.add(w.id)
    sheets.push(w)
  }
  return { sheets, problems }
}

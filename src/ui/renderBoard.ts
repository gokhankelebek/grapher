// ============================================================================
// src/ui/renderBoard.ts — ONE routine that draws the board.
//
// The screen and the exported PNG are the same picture at different sizes, on
// different paper. Before this file they were two independent code paths, and
// they had already drifted: the export drew background + grid + curves and
// nothing else, so every analysis marker and label a teacher had switched on
// was silently dropped on the way out (measured: 1460 label pixels on screen,
// 0 in the file).
//
// So there is exactly one renderer. What separates the two callers is the
// SCENE they hand it, not the code that runs:
//
//   screen  : theme = dark (or the user's canvas choice), chrome = present
//   export  : theme = light/print, chrome = null, colours mapped to print
//
// `chrome` is the whole editing vocabulary — edit handles, hover/selection
// halos, in-progress ink, the fade of a just-recognised stroke. It is the
// scaffolding around the figure, never part of the figure, so the export path
// simply passes null and cannot accidentally inherit any of it.
//
// All drawing units are CSS pixels: the caller sets the DPR/scale transform.
// ============================================================================

import type {
  BoardKind,
  CurveHandle,
  FigureStyle,
  FigureStyleId,
  FittedCurve,
  ModelSpec,
  NLItem,
  SpecialPoint,
  Theme,
  Vec2,
  Viewport,
} from '../core/types'
import { FIGURE_STYLES, LIGHT_THEME, ppuX, ppuY, toPrintColor, toScreen } from '../core/types'
import type { StyleMap } from '../core/persist'
import type { AxisUnit, AxisUnits, PaintScale } from '../render/grid'
import { SCREEN_GRID, drawGrid, labelFont as figureFont, paintScale } from '../render/grid'
import type { GridStyle } from '../render/grid'
import { drawPolarGrid } from '../render/polarGrid'
import { curveLineWidth, drawCurve, drawInk, traceCurve } from '../render/curves'
import { END_DOT_R, curveEndPoints, drawCurveEnds, resolveEnds } from '../render/endCaps'
import { drawAsymptotes, drawHoles, holeRange } from '../render/holes'
import { findAsymptotes, findHoles } from '../core/holes'
import type { Overlay } from '../render/overlays'
import { drawOverlays } from '../render/overlays'
import type { Polyline, SlopeField } from '../render/fields'
import { drawPolylines, drawSlopeFields } from '../render/fields'
import type { Shape } from '../render/shapes'
import { drawShapes } from '../render/shapes'
import type { ScatterSet } from '../render/scatter'
import { drawScatter } from '../render/scatter'
import { drawNLItem, drawNumberLineAxis, nlLanes } from '../render/numberline'
import type { NLPart } from '../render/numberline'
import { pointText } from './numeric'
import { readSinusoid } from '../core/sinusoidal'
import { evalAst, parseAst } from '../core/parse'

const TWO_PI = Math.PI * 2

/**
 * An analysis marker yields its spot to an interactive handle sitting within
 * this radius (a parabola's vertex is both a handle and a minimum). Exported
 * from here because the renderer and CanvasStage's marker hit-test must agree:
 * a marker that isn't drawn must never be clickable.
 */
export const HANDLE_HIT_RADIUS = 10

/**
 * The grab radius at a given presentation scale.
 *
 * The renderer masks an analysis marker wherever a handle sits within this
 * radius, and CanvasStage refuses to hit-test a marker it masked — a marker
 * that isn't drawn must never be clickable. Both sides therefore have to ask
 * the SAME function once handles start growing with `present.stroke`: the UI
 * wiring must call handleHitRadius(present) rather than the bare constant.
 * At the default scale the two are identical, so nothing changes until then.
 */
export function handleHitRadius(present?: PaintScale | null): number {
  return HANDLE_HIT_RADIUS * paintScale(present).stroke
}

/** Analysis labels: mono, so digits line up column-wise between labels. */
const LABEL_PX = 11
const labelFont = (px: number): string => `${px}px "SF Mono", Menlo, Consolas, monospace`
/** Above this many labels the board is an unreadable pile, whatever they say. */
const MAX_LABELS = 8
/** Two labels closer than this along the curve collapse to markers only. */
const MIN_LABEL_GAP = 28
/** Label text on a dark ground; on a light one the theme's own label colour. */
const DARK_TEXT = '#e6eaf5'
/**
 * Shaded fills under mono ink.
 *
 * 0.12 of black is ~#e3e3e3: dark enough to read as shading at a glance, light
 * enough that a black curve, a black Riemann outline and a tick number all
 * survive on top of it — and light enough to photocopy without going solid.
 */
export const MONO_FILL_ALPHA = 0.12

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

/** Editing scaffolding. Present on screen, ALWAYS null for export. */
export interface BoardChrome {
  /** Selected curve id — draws the soft selection halo under its stroke. */
  selectedId: string | null
  /** Control handles of the selected curve. Also mask analysis markers. */
  handles: readonly CurveHandle[]
  /** Handle being dragged / hovered / edited — drawn slightly larger. */
  activeHandleId: string | null
  /** Analysis index emphasised because the readout row is hovered. */
  highlight: number | null
  /** Analysis index whose editor popover is open. */
  openIdx: number | null
  /** Analysis index under the pointer. */
  hoverIdx: number | null
  /** The just-recognised stroke, fading out. */
  fade?: { pts: readonly Vec2[]; alpha: number; color: string } | null
  /** Ink under the pen right now. */
  ink?: { pts: readonly Vec2[]; color: string } | null
  /** Per-curve fade-in alpha (a curve that has just appeared). */
  curveAlpha?: { id: string; alpha: number } | null
  /**
   * Number line: the endpoint under the pointer or being dragged. Emphasis
   * only — the dot is already drawn, this makes it a little bigger.
   */
  activePart?: { itemId: string; part: NLPart } | null
  /**
   * Number line: the item being dragged into existence right now. It is not in
   * `items` yet, so it exists only as chrome until the pointer comes up.
   */
  pending?: NLItem | null
}

/**
 * One meeting point, and the two curves it belongs to.
 *
 * `point.kind` is 'intersection' and `point.withId` is the OTHER curve, which
 * is the contract src/core/analyze.ts intersectionPoints() produces;
 * `curveId` is the curve it was solved on. Both sides are named because the
 * point is computed once for a pair and drawn once for the board — a scene
 * that carried only the point could not tell whether it still has two visible
 * curves under it.
 */
export interface BoardIntersection {
  curveId: string
  point: SpecialPoint
}

export interface BoardScene {
  vp: Viewport
  theme: Theme
  curves: readonly FittedCurve[]
  styles: StyleMap
  models: Record<string, ModelSpec>
  /**
   * Which kind of board this scene is. Absent means 'cartesian', so every
   * existing caller keeps drawing exactly what it drew before.
   */
  kind?: BoardKind
  /**
   * Which RULING the cartesian board is drawn on — the square lattice, or the
   * concentric circles and radial spokes a polar curve is actually read off.
   *
   * Absent means 'cartesian', and an explicit 'cartesian' is the same thing
   * said out loud: both go through `drawGrid` with the same arguments, so a
   * scene that never mentions this field draws the identical command stream it
   * drew before the field existed.
   *
   * It is a property of the BOARD, not of any curve: a rose and its cartesian
   * r-vs-θ companion can be on screen together, and the teacher chooses which
   * frame the class is reading. `axisUnits` still applies — the radius ladder
   * honours `x: 'pi'` exactly as the x axis does.
   *
   * Cartesian boards only; a number-line board ignores it.
   */
  grid?: 'cartesian' | 'polar'
  /** Number-line boards draw these instead of curves. */
  items?: readonly NLItem[]
  /** Markers + labels for one curve. Null/absent when the toggle is off. */
  analysis?: { curve: FittedCurve; points: readonly SpecialPoint[] } | null
  /**
   * Where the curves MEET each other — the one analysis point that does not
   * belong to a curve.
   *
   * `analysis` above describes ONE curve, which is the right shape for a zero
   * or an inflection and the wrong shape for a crossing: an intersection has
   * two parents, it is drawn ONCE for both of them, and it goes on drawing
   * while neither of them is selected. So it is its own field, and each entry
   * names both sides (`curveId` is the curve it was solved on, `point.withId`
   * the other) so the renderer can drop a point whose partner has been hidden.
   *
   * FIGURE, not chrome: where two graphs cross is a fact about the picture,
   * not a note the editor is keeping, so it reaches the export. Absent or
   * empty means the board draws exactly what it drew before the field existed.
   *
   * The CALLER decides when there are any: on screen that is "while the
   * Analysis toggle is on", the same rule every other marker follows.
   */
  intersections?: readonly BoardIntersection[]
  /**
   * Force the print palette on.
   *
   * Normally this does not need to be said: a light GROUND selects the print
   * palette by itself (see renderBoard), because the screen palette is tuned
   * against near-black and measures 1.51-3.07:1 on white. This flag only
   * exists so a caller can ask for print colours on a ground the luminance
   * test would call dark. It can no longer be the reason screen and export
   * disagree -- that was the bug.
   */
  printColors?: boolean
  /**
   * Presentation scaling, for a board projected across a classroom.
   *
   *   type   — multiplies every on-canvas font: axis tick labels, analysis
   *            labels, number-line tick and item labels.
   *   stroke — multiplies every line weight: curve strokes, grid and axis
   *            rules, marker and handle glyphs, number-line bars and dots.
   *
   * Absent means { type: 1, stroke: 1 }; values are clamped to [0.5, 6]. At
   * 1:1 nothing on this canvas renders above ~13.65px, which is not legible
   * at 1280x720 from the back of a room.
   */
  present?: { type: number; stroke: number }
  /**
   * How each axis is measured — 'decimal' (the 1–2–5 ladder) or 'pi' (ticks at
   * rational multiples of π, labelled π/2, π, 3π/2, 2π …).
   *
   * Absent, or either side absent, means 'decimal': a scene that never mentions
   * this draws exactly the grid it drew before the field existed. The two axes
   * are independent on purpose — a polar-to-cartesian lesson puts θ in π along
   * x while y stays a plain length, and a lesson going the other way wants the
   * opposite.
   *
   * This is a CARTESIAN property; a number-line board ignores it.
   */
  axisUnits?: AxisUnits
  /**
   * Filled figure content painted between the grid and the curves: the shaded
   * area under a curve, Riemann rectangles, and the general closed region.
   *
   * These are FIGURE, not chrome. They carry the mathematics the lesson is
   * about — a shaded ∫ that vanished from the PNG would be the same bug the
   * analysis layer had — so they go through this one routine and reach the
   * export identically. Absent or empty means the board draws exactly the
   * pixels it drew before this field existed.
   *
   * Cartesian only; a number-line board ignores it.
   */
  overlays?: readonly Overlay[]
  /**
   * Slope fields: dy/dx = f(x, y) as a lattice of short tangent segments,
   * painted under everything the class is meant to look AT.
   *
   * The field is the ground, not the subject. A solution curve threading it,
   * and the teacher's own sketched curves, must read on top of it — so it
   * goes below the polylines and below the strokes, at a reduced alpha.
   *
   * FIGURE, not chrome: it exports.
   *
   * Cartesian only; a number-line board ignores it.
   */
  fields?: readonly SlopeField[]
  /**
   * Open paths in math coords — the RK4 solution curve through a chosen
   * point, and anything else the App wants drawn as a plain path.
   *
   * These are not FittedCurves: there is no model and no closed form to
   * re-sample, only the points the integrator produced. They are still
   * FIGURE, and a solution curve missing from the exported PNG would be the
   * same bug the analysis layer had.
   *
   * Cartesian only; a number-line board ignores it.
   */
  polylines?: readonly Polyline[]
  /**
   * Points, segments, vectors and polygons — the figure a class MEASURES.
   *
   * Painted after every curve and before the analysis layer: a triangle, a
   * chord or a vector is drawn AGAINST the curves it is measured against, so
   * it sits on top of them. A vertex buried under a 2.5px stroke is a vertex
   * no one can read a coordinate off.
   *
   * FIGURE, not chrome: it exports.
   *
   * Cartesian only; a number-line board ignores it.
   */
  shapes?: readonly Shape[]
  /**
   * Data sets — the (x, y) rows of a pasted or typed table, as a scatter plot.
   *
   * Painted after every curve and before the shapes and the analysis layer:
   * the regression is an ordinary curve, and a class judges it by looking at
   * the data AGAINST it, so the points sit on top. A set whose `residualsTo`
   * names a visible explicit curve also gets a thin half-alpha segment from
   * each point to that curve, under every marker.
   *
   * Colours go through the same ink as the curves: print-mapped on a light
   * ground, and theme.axis under a mono figure style (SAT / AP).
   *
   * FIGURE, not chrome: it exports. Absent or empty means the board draws
   * exactly the command stream it drew before this field existed.
   *
   * Cartesian only; a number-line board ignores it.
   */
  scatter?: readonly ScatterSet[]
  /**
   * The LOOK of the whole board: the screen, a textbook worksheet, an SAT
   * item, an AP free-response figure. See FigureStyle in core/types.
   *
   * Absent is exactly `FIGURE_STYLES.screen` with the scene's own theme, and
   * it is absent-by-default on purpose: a scene that never mentions this field
   * draws the identical command stream it drew before the field existed
   * (tests/figureStyles.test.ts asserts that byte for byte). An explicit
   * 'screen' means the same thing — the App substitutes the live dark/light
   * theme there, so the style's own theme is not consulted for it.
   *
   * Any other style REPLACES the scene theme everywhere below this line: the
   * grid, the tick and chip labels, the ground ring on a point, the halos.
   */
  figure?: FigureStyle
  /**
   * A line of text under the figure — "Graph of f", the caption an AP
   * free-response figure carries.
   *
   * It is FIGURE, not chrome: it is drawn with `chrome: null` too, so it
   * reaches the exported PNG. It is laid out INSIDE the viewport rect, which
   * is the rect the export clips to; a caller that crops to content has to
   * leave room for it (see captionHeight).
   */
  caption?: string
  /**
   * What each curve is CALLED, keyed by curve id — "f", "g", "f′".
   *
   * Drawn only under a MARKED figure style (Textbook / SAT / AP: the looks
   * whose curves already carry end caps and asymptotes), and only when two or
   * more of the curves on the board have a name. One curve needs no label —
   * the caption already says which function it is — and the screen look needs
   * none at all, because the sidebar cards are right there beside the board
   * saying it in colour.
   *
   * Absent means no names are drawn, so a scene that never mentions this field
   * produces exactly the command stream it produced before it existed.
   *
   * FIGURE, not chrome: a printed figure with three unlabelled curves and a
   * caption about f is the bug this exists to close, so the labels reach the
   * PNG (chrome: null) exactly as the caption does.
   */
  curveNames?: Readonly<Record<string, string>>
  /** Editing chrome. Null = the figure alone. */
  chrome?: BoardChrome | null
}

/** Re-exported so the App can name the field's type without reaching into render/. */
export type { AxisUnit, AxisUnits }
/**
 * The figure-style contract, re-exported from the one place it is defined, so
 * the App can name it (picker, persistence, thumbnails) without importing two
 * modules to describe one scene.
 */
export type { FigureStyle, FigureStyleId }
export { FIGURE_STYLES }
export type { Overlay, OverlayRect } from '../render/overlays'
export type { Polyline, SlopeField } from '../render/fields'
export type { Shape } from '../render/shapes'
export type { ScatterMarker, ScatterSet } from '../render/scatter'

/**
 * Trig by name, at a word boundary, so `sinh`/`cosh`/`tanh` (not periodic) and
 * `asin`/`arccos` (periodic in the OUTPUT, so it is y that wants π, not x) are
 * both left alone. A leading backslash is a non-letter, so `\sin(x)` matches.
 */
const TRIG_SOURCE = /(?:^|[^A-Za-z])(sin|cos|tan|sec|csc|cot)(?![A-Za-z])/i

/**
 * AUTO mode: what the axes would ideally be for this set of curves.
 *
 * A RECOMMENDATION, not a decision — it returns `{ x: 'pi' }` when anything on
 * the board is trigonometric and `{}` otherwise, and the App chooses whether to
 * honour it (a teacher who has deliberately set decimal axes must not have them
 * changed underneath by the next sketch).
 *
 * A fitted `sine` is self-identifying. A typed expression is not: its family is
 * `expr_N` and the text the teacher wrote lives in the App's source map, so it
 * is passed in — keyed by curve id, the same shape `curveLegend` takes.
 */
/**
 * sin(π/6·x) — a Ferris wheel with a period of 12 — has its features at
 * whole numbers, not at multiples of π, and a π axis would label them
 * 3.82π. For a line that reads as one sinusoid, the FREQUENCY decides: b a
 * rational multiple of π (π/6, 2π/3) means a rational period and a decimal
 * axis; a phase shift carrying π (2(x − π/4)) says nothing about the axis.
 */
function periodIsRational(src: string): boolean {
  const spec = readSinusoid(src)
  if (!spec) return false
  const ast = parseAst(spec.b)
  if (!ast.ok) return false
  const b = Math.abs(evalAst(ast.lhs, 0))
  if (!Number.isFinite(b) || b === 0) return false
  const r = b / Math.PI
  for (let q = 1; q <= 24; q++) {
    const p = Math.round(r * q)
    if (p !== 0 && Math.abs(r * q - p) < 1e-9 * Math.max(1, p)) return true
  }
  return false
}

export function suggestAxisUnits(
  curves: readonly FittedCurve[],
  sources?: Record<string, string>,
): { x?: 'pi' } {
  for (const curve of curves) {
    if (!curve.visible) continue
    if (curve.modelId === 'sine') return { x: 'pi' }
    if (curve.modelId.startsWith('expr_')) {
      const src = sources?.[curve.id]
      if (typeof src === 'string' && TRIG_SOURCE.test(src) && !periodIsRational(src)) return { x: 'pi' }
    }
  }
  return {}
}

// ---------------------------------------------------------------------------
// Palette helpers
// ---------------------------------------------------------------------------

/**
 * Relative luminance of the ground, so a theme the caller invented still gets
 * readable label text without having to declare a text colour.
 */
function isDarkGround(theme: Theme): boolean {
  const m = /^#([0-9a-fA-F]{6})$/.exec(theme.bg.trim())
  if (!m) return true
  const v = parseInt(m[1], 16)
  const r = (v >> 16) & 255
  const g = (v >> 8) & 255
  const b = v & 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128
}

function textColor(theme: Theme): string {
  return isDarkGround(theme) ? DARK_TEXT : theme.label
}

// ---------------------------------------------------------------------------
// Analysis markers and labels
// ---------------------------------------------------------------------------

/**
 * The text on a point's plate.
 *
 * A chip is a NAME for the point, not a table of it: where the analyzer knows
 * the closed form the plate says "(\u221a3, 0)" and stops there, because
 * "(\u221a3, 0) \u2248 (1.732, 0)" is two answers on a label a reader glances at,
 * and the card two feet away is where both readings belong. Coordinates with
 * no closed form print exactly as they always did \u2014 p.exact still decides how
 * many digits a numerically located point is entitled to.
 *
 * Every surface goes through pointText, so the chip and the card can never
 * disagree about what this point is called.
 */
function labelFor(p: SpecialPoint): string {
  const text = pointText(p, { decimal: false })
  if (p.kind === 'zero') return `${text}${p.tangent ? ' (touches)' : ''}`
  return text
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/**
 * READ-ONLY vocabulary. A marker says what a point IS; it is never grabbable,
 * and it must not borrow a glyph from anything that is:
 *
 *   hollow ring  zero           ring diameter carries no meaning
 *   filled dot   max / min      the value the class is usually after
 *   diamond      inflection     deliberately not a circle
 *   faint dot    y-intercept    present, but the least interesting point
 *
 * Handles (drawHandles) use a disjoint set of shapes. Sizes scale with the
 * presentation stroke scale so the label layout can reserve the right room.
 */
/**
 * The exam figure's marker: one filled disc, whatever the feature is.
 *
 * On paper a hollow ring, a diamond and a faint dot are three glyphs a reader
 * has to be taught; a printed figure states the point and lets the caption say
 * what it is. ~3.5 x the stroke is the College Board dot.
 */
export const FILLED_POINT_R = 3.5

/**
 * Does this kind of point get a marker GLYPH from the analysis layer?
 *
 * Two kinds do not, and both for the same reason: their glyph is already on
 * the board, drawn by a layer that owns it.
 *
 *   hole          the open ring drawn with the curve (src/render/holes.ts),
 *                 which is there in every figure style whether the analysis
 *                 layer is switched on or not. A second disc on top of it
 *                 would fill the one mark whose whole meaning is that it is
 *                 empty. The hole still gets its LABEL: "(1, 2)" is the
 *                 number the question is about.
 *   intersection  the neutral diamond drawn by drawIntersections, once, for
 *                 the pair. A marker in one curve's colour on top of it would
 *                 claim the point for that curve, and it belongs to both.
 *
 * Exported because the hit test in CanvasStage has to ask the same question —
 * a marker it did not draw must never be clickable — and neither of these can
 * be moved in any case, so there is nothing for a click to open. A crossing is
 * a consequence of two curves; "put this intersection at x = 3" is not a
 * sentence about either of them.
 */
export function hasMarkerGlyph(kind: SpecialPoint['kind']): boolean {
  return kind !== 'hole' && kind !== 'intersection'
}

function markerRadius(p: SpecialPoint, s: number, grow = 0, filled = false): number {
  if (filled) return (FILLED_POINT_R + grow) * s
  switch (p.kind) {
    // The ring the curve loop already drew: the label steps off THAT, since
    // it is the glyph a reader sees here.
    case 'hole':
      return (END_DOT_R + grow) * s
    case 'zero':
      return (4 + grow) * s
    case 'inflection':
      return (4.6 + grow) * s
    case 'maximum':
    case 'minimum':
      return (3.5 + grow) * s
    case 'y-intercept':
      return (2.6 + grow) * s
    default:
      return (3 + grow) * s
  }
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  p: SpecialPoint,
  sx: number,
  sy: number,
  color: string,
  bg: string,
  grow: number,
  s = 1,
  filled = false,
): void {
  const r = markerRadius(p, s, grow, filled)
  if (filled) {
    // No ground rim: an exam figure's dot sits ON the curve and is meant to.
    ctx.globalAlpha = 1
    ctx.beginPath()
    ctx.arc(sx, sy, r, 0, TWO_PI)
    ctx.fillStyle = color
    ctx.fill()
    return
  }
  const ring = (lw: number): void => {
    ctx.beginPath()
    ctx.arc(sx, sy, r, 0, TWO_PI)
    ctx.fillStyle = bg
    ctx.fill()
    ctx.lineWidth = lw * s
    ctx.strokeStyle = color
    ctx.stroke()
  }
  const dot = (alpha: number): void => {
    ctx.globalAlpha = alpha
    ctx.beginPath()
    ctx.arc(sx, sy, r, 0, TWO_PI)
    ctx.fillStyle = color
    ctx.fill()
    ctx.lineWidth = 1.5 * s
    ctx.strokeStyle = bg
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  switch (p.kind) {
    case 'zero':
      // hollow ring, sitting on the axis
      ring(1.8)
      break
    case 'maximum':
    case 'minimum':
      dot(1)
      break
    case 'inflection': {
      // diamond — deliberately not a circle, so concavity reads at a glance
      ctx.beginPath()
      ctx.moveTo(sx, sy - r)
      ctx.lineTo(sx + r, sy)
      ctx.lineTo(sx, sy + r)
      ctx.lineTo(sx - r, sy)
      ctx.closePath()
      ctx.fillStyle = bg
      ctx.fill()
      ctx.lineWidth = 1.7 * s
      ctx.strokeStyle = color
      ctx.stroke()
      break
    }
    case 'y-intercept':
      dot(0.62)
      break
    default:
      dot(0.74)
      break
  }
}

/**
 * The affordance a marker only shows on approach: dashed while hovered, solid
 * while its editor is open. Deliberately a ring AROUND the glyph rather than a
 * change to the glyph, so the marker's own shape — which encodes what kind of
 * feature it is — stays exactly as it reads at rest.
 *
 * Chrome: it answers the pointer, not the maths, so it never reaches export.
 */
function drawMarkerHalo(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  color: string,
  open: boolean,
  s = 1,
): void {
  ctx.save()
  ctx.beginPath()
  ctx.arc(sx, sy, 10 * s, 0, TWO_PI)
  ctx.strokeStyle = color
  ctx.globalAlpha = open ? 0.92 : 0.5
  ctx.lineWidth = (open ? 1.6 : 1.2) * s
  if (!open) ctx.setLineDash([2.5 * s, 3 * s])
  ctx.stroke()
  ctx.restore()
}

/**
 * Label priority — the ORDER the crowding budget is spent in.
 *
 * Measured on y = 0.3(x-3)^2 - 2: the board labelled the y-intercept
 * "(0, 0.7000)" and left the minimum (3, -2) as a bare dot. With the two close
 * together, that label sits between them and reads as the vertex's
 * coordinates, which is a wrong answer printed on the board. The vertex is the
 * number the class wants; the y-intercept is the one it can read off the axis
 * by itself, so it goes last.
 */
function labelRank(p: SpecialPoint): number {
  switch (p.kind) {
    case 'maximum':
    case 'minimum':
    case 'petal-tip':
      return 0
    case 'inflection':
      return 1
    case 'extreme':
      return 2
    case 'zero':
      return 3
    case 'y-intercept':
      return 4
    default:
      return 3
  }
}

/**
 * Which way the label steps off the curve.
 *
 * A label box used to be placed up-and-right of its marker whatever the curve
 * was doing, so it regularly sat ON the stroke — and with a 0.86-alpha plate,
 * the curve showed through it mottled. The fix is geometric: leave along the
 * NORMAL to the local tangent, which is the one direction guaranteed to move
 * away from the curve rather than along it.
 *
 * At a turning point the tangent is horizontal and the arms are the constraint
 * instead, so a minimum labels below itself and a maximum above.
 */
function labelNormal(
  p: SpecialPoint,
  slopeAt?: ((x: number) => number) | null,
  /** ppuY / ppuX: 1 on an equal-axes board, where a math slope IS the screen slope. */
  aspect = 1,
): { x: number; y: number } {
  if (p.kind === 'minimum') return { x: 0, y: 1 }
  if (p.kind === 'maximum' || p.kind === 'petal-tip') return { x: 0, y: -1 }
  // The slope as DRAWN: a stretched board tilts every tangent by ppuY/ppuX.
  const m = (slopeAt ? slopeAt(p.pos.x) : 0) * aspect
  if (!Number.isFinite(m) || m === 0) return { x: 0, y: -1 }
  // screen tangent of screen slope m is (1, -m); its normals are ±(-m, -1)
  const L = Math.hypot(m, 1)
  return { x: -m / L, y: -1 / L }
}

interface LabelBox { x: number; y: number; w: number; h: number }

interface AnalysisOpts {
  color: string
  theme: Theme
  /** Empty for export: with no handles on the board, nothing masks a marker. */
  handles: readonly CurveHandle[]
  highlight: number | null
  openIdx: number | null
  hoverIdx: number | null
  /** Hover/open rings are chrome; suppressed when chrome is off. */
  halos: boolean
  /** Presentation scale; see BoardScene.present. */
  scale?: PaintScale | null
  /**
   * Marker vocabulary: the screen's rings/diamonds/dots, or the printed
   * figure's one filled disc. Absent means 'ring', which is the screen.
   */
  pointStyle?: 'filled' | 'ring' | null
  /**
   * The figure's label face. Absent keeps the mono face these chips have
   * always used (digits line up column-wise between labels); 'serif' is the
   * exam figure, where one face has to carry every label on the board.
   */
  font?: 'sans' | 'serif' | null
  /**
   * df/dx in math units, when the family can supply it. Only used to choose
   * which side of the curve a label sits on.
   */
  slopeAt?: ((x: number) => number) | null
  /**
   * The curve itself, in SCREEN pixels: screen x -> screen y, or null where it
   * is undefined or outside its own domain. The tangent picks a side; this
   * settles it, because a tangent says nothing about where the curve bends
   * back to. Absent for families that are not a function of screen x.
   */
  screenY?: ((px: number) => number | null) | null
  /**
   * Plates already standing on this board, which new ones step around, and
   * which this layer appends its own to.
   *
   * Absent means "this layer is the only one placing labels", which is what
   * every caller meant before the intersection layer existed — so a call that
   * omits it lays out exactly the boxes it always did.
   */
  reserve?: LabelBox[]
}

export function drawAnalysis(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  points: readonly SpecialPoint[],
  o: AnalysisOpts,
): void {
  if (points.length === 0) return
  const { type, stroke } = paintScale(o.scale)
  const mask = handleHitRadius(o.scale)

  const handlePts = o.handles.map((h) => toScreen(h.pos, vp))
  const shown: { p: SpecialPoint; sx: number; sy: number; i: number; masked: boolean }[] = []

  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (!p || !p.pos || !Number.isFinite(p.pos.x) || !Number.isFinite(p.pos.y)) continue
    const s = toScreen(p.pos, vp)
    if (s.x < -30 || s.y < -30 || s.x > vp.widthPx + 30 || s.y > vp.heightPx + 30) continue
    // Yield the GLYPH to an interactive handle (a parabola's vertex is both a
    // minimum and a handle), unless this is the one the user is pointing at in
    // the readout. The LABEL is not given up with it: the coordinates are the
    // whole reason the point is on the board, and a handle does not state them.
    // That is how the vertex ended up as the one feature never labelled.
    let masked = false
    if (i !== o.highlight && i !== o.openIdx) {
      for (const hp of handlePts) {
        if (Math.hypot(hp.x - s.x, hp.y - s.y) <= mask) {
          masked = true
          break
        }
      }
    }
    shown.push({ p, sx: s.x, sy: s.y, i, masked })
  }
  if (shown.length === 0) return

  const bg = o.theme.bg
  const filled = o.pointStyle === 'filled'
  const emph = (i: number): boolean => i === o.highlight || i === o.openIdx

  for (const m of shown) {
    if (m.masked) continue
    // A hole's glyph is the open ring the curve loop drew; nothing goes on top
    // of it, not even a hover halo — there is no marker here to point at.
    if (!hasMarkerGlyph(m.p.kind)) continue
    const emphasised = emph(m.i)
    if (o.halos && (m.i === o.openIdx || m.i === o.hoverIdx)) {
      drawMarkerHalo(ctx, m.sx, m.sy, o.color, m.i === o.openIdx, stroke)
    }
    const grow = emphasised ? 2.5 : o.halos && m.i === o.hoverIdx ? 1.2 : 0
    drawMarker(ctx, m.p, m.sx, m.sy, o.color, bg, grow, stroke, filled)
  }

  // --- labels: the same crowding budget, spent on the points a class reads
  // first. MAX_LABELS no longer means "more than eight points, so draw none";
  // it means "label the eight that matter most".
  const fpx = LABEL_PX * type
  const gap = MIN_LABEL_GAP * type
  const h = 16 * type
  ctx.font = o.font ? figureFont({ font: o.font }, fpx) : labelFont(fpx)
  ctx.textBaseline = 'middle'
  const placed: LabelBox[] = o.reserve ?? []
  const anchors: number[] = []
  const text0 = textColor(o.theme)

  const ranked = shown.slice().sort((a, b) => {
    const ra = emph(a.i) ? -1 : labelRank(a.p)
    const rb = emph(b.i) ? -1 : labelRank(b.p)
    return ra !== rb ? ra - rb : a.sx - b.sx
  })

  for (const m of ranked) {
    if (placed.length >= MAX_LABELS) break
    // crowded neighbours: keep the marker, drop the text
    if (!emph(m.i) && anchors.some((a) => Math.abs(a - m.sx) < gap)) continue

    const text = labelFor(m.p)
    const w = ctx.measureText(text).width + 10 * type
    // A masked point has a handle standing on it, which is bigger than any
    // marker: step off from the handle's radius so the plate clears it too.
    const mr = m.masked
      ? 7 * stroke
      : markerRadius(m.p, stroke, emph(m.i) ? 2.5 : 0, filled)
    const n = labelNormal(m.p, o.slopeAt, ppuY(vp) / ppuX(vp))
    const box = placeLabel(vp, m.sx, m.sy, w, h, mr, n, type, placed, o.screenY ?? null)
    if (!box) continue

    drawLabelPlate(
      ctx,
      m.sx,
      m.sy,
      box,
      text,
      {
        bg,
        leader: o.color,
        border: emph(m.i) ? o.color : o.theme.gridMajor,
        text: emph(m.i) ? o.color : text0,
      },
      type,
      stroke,
    )

    placed.push(box)
    anchors.push(m.sx)
  }
  ctx.textBaseline = 'alphabetic'
}

// ---------------------------------------------------------------------------
// Intersections — the one marker that belongs to two curves
// ---------------------------------------------------------------------------

/**
 * The half-diagonal of the intersection diamond, before `present.stroke`.
 *
 * A little larger than a turning point's dot (3.5) because it is the only
 * glyph on the board sitting where two strokes already cross, which is the
 * busiest pixel a marker ever has to be read against.
 */
export const INTERSECTION_R = 4

/**
 * The ink a crossing is drawn in: NEUTRAL, always.
 *
 * Every other marker on this board takes the colour of the curve it belongs
 * to, and that is exactly what an intersection must not do — it belongs to
 * two of them, and drawing it in f's blue says the point is f's, which is the
 * one thing that is untrue about it. So it is drawn in the ink the board uses
 * for saying things: the label colour, or under mono (a figure whose curves
 * are all one black) the axis ink, since there the label colour would be the
 * only grey on an otherwise black-and-white figure.
 */
export function intersectionInk(theme: Theme, mono = false): string {
  return mono ? theme.axis : textColor(theme)
}

export interface IntersectionOpts {
  theme: Theme
  /** The neutral ink — intersectionInk(theme, mono). */
  color: string
  /** Presentation scale; see BoardScene.present. */
  scale?: PaintScale | null
  /** The figure's label face, as drawAnalysis takes it. */
  font?: 'sans' | 'serif' | null
  /** Plates already on the board; this layer steps around them and adds its own. */
  reserve?: LabelBox[]
}

/**
 * Where the curves meet: a filled diamond on a ground ring, and a chip saying
 * which point it is.
 *
 * A diamond, not a disc, because a disc is already spoken for (a maximum), and
 * a filled one because the crossing is a point the graph actually passes
 * through — unlike the hollow ring of a zero, which marks a value. The ground
 * ring is what makes it readable at all: it sits precisely where two strokes
 * overlap, and without a rim of paper around it the glyph is two curves and a
 * smudge.
 *
 * The chip is `pointText(p, { decimal: false })` — the same rule as every
 * other plate on this board, so a crossing at (√2, 2) is labelled "(√2, 2)"
 * and the decimal beside it lives on the card, where there is room for both.
 *
 * Each point is drawn ONCE. The caller pairs the curves (a, b) and never
 * (b, a); this only guards the case of three curves through one point, where
 * two different pairs answer with the same place.
 */
export function drawIntersections(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  points: readonly SpecialPoint[],
  o: IntersectionOpts,
): void {
  if (points.length === 0) return
  const { type, stroke } = paintScale(o.scale)
  const bg = o.theme.bg
  const r = INTERSECTION_R * stroke
  const ring = r + 1.6 * stroke

  const seen = new Set<string>()
  const shown: { p: SpecialPoint; sx: number; sy: number }[] = []
  for (const p of points) {
    if (!p || !p.pos || !Number.isFinite(p.pos.x) || !Number.isFinite(p.pos.y)) continue
    const s = toScreen(p.pos, vp)
    if (s.x < -30 || s.y < -30 || s.x > vp.widthPx + 30 || s.y > vp.heightPx + 30) continue
    const key = `${Math.round(s.x)},${Math.round(s.y)}`
    if (seen.has(key)) continue
    seen.add(key)
    shown.push({ p, sx: s.x, sy: s.y })
  }
  if (shown.length === 0) return

  const diamond = (sx: number, sy: number, rad: number): void => {
    ctx.beginPath()
    ctx.moveTo(sx, sy - rad)
    ctx.lineTo(sx + rad, sy)
    ctx.lineTo(sx, sy + rad)
    ctx.lineTo(sx - rad, sy)
    ctx.closePath()
  }

  ctx.globalAlpha = 1
  for (const m of shown) {
    diamond(m.sx, m.sy, ring)
    ctx.fillStyle = bg
    ctx.fill()
    diamond(m.sx, m.sy, r)
    ctx.fillStyle = o.color
    ctx.fill()
  }

  // --- the chips, through the same clearance the analysis plates use, and
  // around the ones the analysis layer has already put down.
  const fpx = LABEL_PX * type
  const h = 16 * type
  ctx.font = o.font ? figureFont({ font: o.font }, fpx) : labelFont(fpx)
  ctx.textBaseline = 'middle'
  const placed: LabelBox[] = o.reserve ?? []
  const text0 = textColor(o.theme)

  // The crowding budget is counted PER LAYER, not shared. The selected curve
  // can easily have eight labels of its own, and if the cap were the length of
  // the shared list the crossings would be the first thing dropped from a busy
  // board — on a board that is busy precisely because it has several graphs on
  // it, which is the only kind of board that HAS a crossing. The shared list
  // still decides where a plate may sit; it just does not decide how many.
  let mine = 0
  for (const m of shown) {
    if (mine >= MAX_LABELS) break
    // The string that is actually drawn, exact form and all: a plate measured
    // on "(1.414, 2.000)" and printed with "(√2, 2)" is a box of the wrong
    // width, and the crowding test it feeds is then wrong too.
    const text = pointText(m.p, { decimal: false })
    const w = ctx.measureText(text).width + 10 * type
    // Straight up off the crossing. There are two tangents here and no reason
    // to prefer either, so the plate takes the direction that reads as a
    // callout — and placeLabel tries straight down when that spot is taken.
    const box = placeLabel(vp, m.sx, m.sy, w, h, ring, { x: 0, y: -1 }, type, placed, null)
    if (!box) continue
    drawLabelPlate(
      ctx,
      m.sx,
      m.sy,
      box,
      text,
      { bg, leader: o.color, border: o.theme.gridMajor, text: text0 },
      type,
      stroke,
    )
    placed.push(box)
    mine++
  }
  ctx.textBaseline = 'alphabetic'
}

/** The four inks one plate is drawn in. */
interface PlateInk {
  bg: string
  /** The 1px line back to the marker. */
  leader: string
  border: string
  text: string
}

/**
 * One label plate, with the leader back to the point it names.
 *
 * Shared by the per-curve analysis layer and the intersection layer so the two
 * cannot drift into looking like different kinds of label: a chip on this
 * board is a chip, whichever layer put it there.
 */
function drawLabelPlate(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  box: LabelBox,
  text: string,
  ink: PlateInk,
  type: number,
  stroke: number,
): void {
  // A 1px leader from the marker to the plate: the label is off the curve,
  // so something has to say which point it belongs to. Drawn first, so the
  // opaque plate covers the half that would otherwise run under the text.
  ctx.save()
  ctx.globalAlpha = 0.55
  ctx.strokeStyle = ink.leader
  ctx.lineWidth = 1 * stroke
  ctx.beginPath()
  ctx.moveTo(sx, sy)
  ctx.lineTo(box.x + box.w / 2, box.y + box.h / 2)
  ctx.stroke()
  ctx.restore()

  // FULL opacity: a 0.86 plate let the curve through the text mottled.
  ctx.globalAlpha = 1
  roundRect(ctx, box.x, box.y, box.w, box.h, 4 * type)
  ctx.fillStyle = ink.bg
  ctx.fill()
  ctx.lineWidth = 1 * stroke
  ctx.strokeStyle = ink.border
  ctx.stroke()
  ctx.fillStyle = ink.text
  ctx.fillText(text, box.x + 5 * type, box.y + box.h / 2)
}

/**
 * Step out along `n` (then along -n) until the plate is on the canvas, clear of
 * every plate already placed, and clear of its own marker. Null when the label
 * has nowhere to go — in which case the marker stands alone, which is honest.
 */
function placeLabel(
  vp: Viewport,
  sx: number,
  sy: number,
  w: number,
  h: number,
  markerR: number,
  n: { x: number; y: number },
  type: number,
  placed: readonly LabelBox[],
  screenY: ((px: number) => number | null) | null,
): LabelBox | null {
  /** Does the curve actually pass through this plate? The tangent can't say. */
  const onCurve = (b: LabelBox): boolean => {
    if (!screenY) return false
    const step = Math.max(1, b.w / 32)
    for (let px = b.x; px <= b.x + b.w; px += step) {
      const py = screenY(px)
      if (py === null) continue
      if (py >= b.y - 1 && py <= b.y + b.h + 1) return true
    }
    return false
  }
  // How far along the normal the plate has to start.
  //
  // Offsetting the CENTRE by "half a line height" is not enough: the plate also
  // extends along the TANGENT, which is where the curve is, so a wide label on
  // a sloped curve still crossed the stroke with its corners. Project the box's
  // half-extents onto the normal — that is the distance at which the whole
  // plate, corners included, clears the local tangent.
  const clearance = Math.abs(n.x) * (w / 2) + Math.abs(n.y) * (h / 2)
  const base = markerR + clearance + 6 * type
  for (const dir of [n, { x: -n.x, y: -n.y }]) {
    for (let k = 0; k < 5; k++) {
      const d = base + k * 16 * type
      const cx = sx + dir.x * d
      const cy = sy + dir.y * d
      const x = Math.min(Math.max(cx - w / 2, 2), Math.max(2, vp.widthPx - w - 2))
      const y = cy - h / 2
      if (y < 2 || y + h > vp.heightPx - 2) continue
      // Clamping x back onto the canvas can slide the plate over its own
      // marker; that is exactly the "label sits on the curve" case.
      if (sx > x - 2 && sx < x + w + 2 && sy > y - 2 && sy < y + h + 2) continue
      const clash = placed.some(
        (r) => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y,
      )
      if (clash) continue
      const box = { x, y, w, h }
      if (onCurve(box)) continue
      return box
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Handles (chrome)
// ---------------------------------------------------------------------------

/**
 * INTERACTIVE vocabulary — deliberately disjoint from the analysis markers.
 *
 * Before this, a handle and a marker differed by 1.5-2px of radius and nothing
 * else, and the domain-trim handle was a hollow circle: the same glyph as a
 * ZERO marker, and the same glyph this app's own number line uses for "endpoint
 * excluded". One shape meant three things. Now:
 *
 *   cored dot   feature / radius / rotation   filled disc with a ground-coloured
 *                                             core ring — reads as "grab me",
 *                                             never as a hollow ring
 *   bracket     domain-start / domain-end     [ and ], facing into the domain.
 *                                             Never a circle, and it says
 *                                             "interval end" in the notation a
 *                                             class already writes
 *   crosshair   center                        arms + a small square knob
 *
 * No handle is a plain filled dot (extremum), a hollow ring (zero) or a diamond
 * (inflection). Emphasis stays a size step, so activeHandleId still reads.
 */
function drawHandles(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  theme: Theme,
  color: string,
  handles: readonly CurveHandle[],
  activeId: string | null,
  scale?: PaintScale | null,
): void {
  const { stroke } = paintScale(scale)
  // The bracket glyph needs round caps/joins; save so that preference cannot
  // leak into whatever the caller draws next.
  ctx.save()
  for (const h of handles) {
    const sp = toScreen(h.pos, vp)
    if (
      !Number.isFinite(sp.x) ||
      !Number.isFinite(sp.y) ||
      sp.x < -24 ||
      sp.y < -24 ||
      sp.x > vp.widthPx + 24 ||
      sp.y > vp.heightPx + 24
    ) {
      continue
    }
    const grow = h.id === activeId ? 3 : 0   // ~1.6x on r=5: hover must be unmistakable
    if (h.kind === 'domain-start' || h.kind === 'domain-end') {
      // A bracket: vertical stem with two arms turning INTO the domain, so the
      // pair reads as [ ... ] — an interval, which is what a trimmed domain is.
      const half = (9 + grow) * stroke
      const arm = (5 + grow * 0.6) * stroke
      const dir = h.kind === 'domain-start' ? 1 : -1
      const bracket = (): void => {
        ctx.beginPath()
        ctx.moveTo(sp.x + dir * arm, sp.y - half)
        ctx.lineTo(sp.x, sp.y - half)
        ctx.lineTo(sp.x, sp.y + half)
        ctx.lineTo(sp.x + dir * arm, sp.y + half)
        ctx.stroke()
      }
      // ground-coloured underlay first: the bracket sits ON its own curve
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = theme.bg
      ctx.lineWidth = (2.4 + grow * 0.5) * stroke + 2.6 * stroke
      bracket()
      ctx.strokeStyle = color
      ctx.lineWidth = (2.4 + grow * 0.5) * stroke
      bracket()
    } else if (h.kind === 'center') {
      // crosshair with a square knob — angular, so it cannot be read as a dot
      const arm = (7 + grow) * stroke
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5 * stroke
      ctx.beginPath()
      ctx.moveTo(sp.x - arm, sp.y)
      ctx.lineTo(sp.x + arm, sp.y)
      ctx.moveTo(sp.x, sp.y - arm)
      ctx.lineTo(sp.x, sp.y + arm)
      ctx.stroke()
      const k = (2.6 + grow * 0.5) * stroke
      ctx.fillStyle = color
      ctx.fillRect(sp.x - k, sp.y - k, 2 * k, 2 * k)
    } else {
      // cored dot: filled disc, ground rim, and a ground core ring inside it
      const r = (5.5 + grow) * stroke
      ctx.beginPath()
      ctx.arc(sp.x, sp.y, r, 0, TWO_PI)
      ctx.fillStyle = color
      ctx.fill()
      ctx.lineWidth = 2 * stroke
      ctx.strokeStyle = theme.bg
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(sp.x, sp.y, r * 0.42, 0, TWO_PI)
      ctx.lineWidth = 1.4 * stroke
      ctx.strokeStyle = theme.bg
      ctx.stroke()
    }
  }
  ctx.restore()
}

/**
 * df/dx for an explicit family, by central difference — only ever used to pick
 * which side of the curve a label steps off to, so a cheap estimate is exactly
 * the right amount of work. Null for families where "the local tangent" is not
 * a single number.
 */
function explicitSlope(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
): ((x: number) => number) | null {
  if (curve.kind !== 'explicit') return null
  const model = models[curve.modelId]
  const f = model?.evalExplicit
  if (!f) return null
  return (x: number): number => {
    const h = 1e-4 * (1 + Math.abs(x))
    try {
      const a = f.call(model, curve.params, x - h)
      const b = f.call(model, curve.params, x + h)
      if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
      return (b - a) / (2 * h)
    } catch {
      return 0
    }
  }
}

/**
 * The same family sampled in screen pixels, so the label placer can ask "is the
 * curve inside this rectangle?" without knowing anything about maths space.
 */
function explicitScreenY(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  vp: Viewport,
): ((px: number) => number | null) | null {
  if (curve.kind !== 'explicit') return null
  const model = models[curve.modelId]
  const f = model?.evalExplicit
  if (!f) return null
  return (px: number): number | null => {
    const x = vp.center.x + (px - vp.widthPx / 2) / ppuX(vp)
    if (curve.domain && (x < curve.domain[0] || x > curve.domain[1])) return null
    try {
      const y = f.call(model, curve.params, x)
      if (!Number.isFinite(y)) return null
      return vp.heightPx / 2 - (y - vp.center.y) * ppuY(vp)
    } catch {
      return null
    }
  }
}

/**
 * The curve a data set's residuals run to, as math x -> math y (null where it
 * is undefined), or null when `id` is not a VISIBLE EXPLICIT curve with an
 * evaluator: a residual is a vertical distance, and only y = f(x) has one.
 */
function residualCurve(
  scene: BoardScene,
  id: string,
): ((x: number) => number | null) | null {
  const curve = scene.curves.find((c) => c.id === id)
  if (!curve || !curve.visible || curve.kind !== 'explicit') return null
  const model = scene.models[curve.modelId]
  const f = model?.evalExplicit
  if (!f) return null
  const d = curve.domain
  return (x: number): number | null => {
    if (d && (x < d[0] || x > d[1])) return null
    try {
      const y = f.call(model, curve.params, x)
      return Number.isFinite(y) ? y : null
    } catch {
      return null
    }
  }
}

// ---------------------------------------------------------------------------
// Figure styles
// ---------------------------------------------------------------------------

/**
 * The style this scene is actually drawn in, or null for "the screen".
 *
 * Absent and 'screen' are the SAME answer: the contract says an absent figure
 * is FIGURE_STYLES.screen with the scene's own theme, so an explicit 'screen'
 * must not start overriding the theme, the curve width or the ink — it has to
 * leave the command stream exactly where it found it.
 */
function figureOf(scene: BoardScene): FigureStyle | null {
  const f = scene.figure
  return f && f.id !== 'screen' ? f : null
}

/** The caption's type size and the paper below it, before `present.type`. */
export const CAPTION_PX = 14
export const CAPTION_MARGIN = 10

/**
 * Room a caption needs at the BOTTOM of the plot rect, in CSS px.
 *
 * Exported for whoever frames the figure: the caption is drawn inside the
 * viewport (that is the rect the export clips to), so a viewport fitted tightly
 * to the content has to be given this much extra height or the caption lands on
 * the curve.
 */
export function captionHeight(present?: PaintScale | null): number {
  return (CAPTION_PX + 2 * CAPTION_MARGIN) * paintScale(present).type
}

/**
 * The caption: centred under the figure, in the figure's own face, italic for
 * the AP look. FIGURE, not chrome — it is drawn with `chrome: null` too, which
 * is the whole point of having it in this routine rather than in the App.
 */
function drawCaption(
  ctx: CanvasRenderingContext2D,
  scene: BoardScene,
  theme: Theme,
  fig: FigureStyle | null,
  type: number,
): void {
  const text = typeof scene.caption === 'string' ? scene.caption.trim() : ''
  if (!text) return
  const vp = scene.vp
  if (vp.widthPx <= 0 || vp.heightPx <= 0) return
  const px = CAPTION_PX * type
  ctx.save()
  ctx.globalAlpha = 1
  ctx.font = figureFont(fig, px, fig?.font === 'serif')
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  const cx = vp.widthPx / 2
  const baseline = vp.heightPx - CAPTION_MARGIN * type
  // A knockout in the ground, no border: the caption is laid out INSIDE the
  // plot rect (that is the rect the export clips to), and the y-axis runs
  // straight down the middle of it — measured, the axis and its bottom
  // arrowhead struck through "Graph of f". On white the plate is invisible;
  // what it buys is that no rule ever crosses the words.
  const w = ctx.measureText(text).width + 10 * type
  const h = px * 1.5
  ctx.fillStyle = theme.bg
  ctx.fillRect(cx - w / 2, baseline + 0.25 * px - h, w, h)
  ctx.fillStyle = textColor(theme)
  ctx.fillText(text, cx, baseline)
  ctx.restore()
  ctx.textAlign = 'start'
  ctx.textBaseline = 'alphabetic'
}

// ---------------------------------------------------------------------------
// Curve names on the figure
// ---------------------------------------------------------------------------

/** A curve's name on the figure: smaller than the caption, larger than a chip. */
export const CURVE_NAME_PX = 13
/** How far off the curve the name sits, before `present.stroke`. */
const CURVE_NAME_GAP = 8
/** Fractions along the visible run to try, in order, before giving up. */
const NAME_SPOTS: readonly number[] = [0.8, 0.6, 0.4, 0.2]

interface NameBox {
  x: number
  y: number
  w: number
  h: number
}

const overlaps = (a: NameBox, b: NameBox): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/**
 * Roughly where the analysis layer's chips will land, so a curve name does not
 * sit on top of one.
 *
 * An APPROXIMATION on purpose: the chips are placed by drawAnalysis, which
 * runs AFTER this (names belong to the curves, chips belong on top of
 * everything), so their exact boxes are not knowable here without laying the
 * whole layer out twice. What is knowable is the marker each chip is tethered
 * to, and a chip is always within about a chip's height of its marker — so a
 * band around each marker is reserved instead. It errs towards moving the
 * name, which is the cheap direction: there are three more spots to try.
 */
function chipZones(scene: BoardScene, type: number): NameBox[] {
  const an = scene.analysis ?? null
  const out: NameBox[] = []
  const w = 44 * type
  const h = 34 * type
  const band = (p: SpecialPoint): void => {
    if (!p || !p.pos || !Number.isFinite(p.pos.x) || !Number.isFinite(p.pos.y)) return
    const s = toScreen(p.pos, scene.vp)
    out.push({ x: s.x - w / 2, y: s.y - h / 2, w, h })
  }
  if (an && an.curve.visible) for (const p of an.points) band(p)
  // A crossing's chip is placed by the same layout and is no less in the way.
  for (const m of scene.intersections ?? []) band(m.point)
  return out
}

/**
 * The name of each curve, beside the curve it names.
 *
 * The placement rule is the one a textbook uses: go along the graph to where
 * it is still well inside the frame — 80% of the way across its visible run —
 * and put the letter on the side AWAY from the x axis, so it lands in the open
 * paper above a curve that is above the axis and below one that is below it,
 * rather than in the crowd of tick numbers along the axis itself. If the spot
 * is taken (by another name, or by where an analysis chip is about to go), the
 * same question is asked at 60%, 40% and 20%. If all four are taken the name
 * is dropped: a letter printed on top of another letter names nothing.
 */
function drawCurveNames(
  ctx: CanvasRenderingContext2D,
  scene: BoardScene,
  theme: Theme,
  fig: FigureStyle,
  ink: (c: string) => string,
  scale: { type: number; stroke: number },
): void {
  const names = scene.curveNames
  if (!names) return
  const vp = scene.vp
  if (vp.widthPx <= 0 || vp.heightPx <= 0) return
  const labelled = scene.curves.filter(
    (c) => c.visible && typeof names[c.id] === 'string' && names[c.id] !== '',
  )
  // One curve is told by the caption; the labels are for telling curves APART.
  if (labelled.length < 2) return

  const { type, stroke } = scale
  const px = CURVE_NAME_PX * type
  const gap = CURVE_NAME_GAP * stroke
  const h = px * 1.3
  const axisY = toScreen({ x: 0, y: 0 }, vp).y
  const placed: NameBox[] = chipZones(scene, type)

  ctx.save()
  ctx.font = figureFont(fig, px, true)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const curve of labelled) {
    const text = names[curve.id]
    let trace: ReturnType<typeof traceCurve> = null
    try {
      trace = traceCurve(curve, scene.models, vp)
    } catch {
      trace = null
    }
    if (!trace) continue
    // Every sample the board actually shows, left to right. A polar or
    // parametric curve doubles back, so "along the visible run from the left"
    // has to be asked of the screen x, not of the parameter.
    const on: { x: number; y: number }[] = []
    for (const run of trace.runs) {
      for (const s of run) {
        if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) continue
        if (s.x < 0 || s.x > vp.widthPx || s.y < 0 || s.y > vp.heightPx) continue
        on.push({ x: s.x, y: s.y })
      }
    }
    if (on.length === 0) continue
    on.sort((a, b) => a.x - b.x)

    const w = ctx.measureText(text).width + 6 * type
    let box: NameBox | null = null
    for (const f of NAME_SPOTS) {
      const s = on[Math.min(on.length - 1, Math.max(0, Math.round(f * (on.length - 1))))]
      // Away from the axis: above a curve drawn above it, below one below it.
      // Screen y grows downward, so "above" is the smaller number.
      const cy = s.y <= axisY ? s.y - gap - h / 2 : s.y + gap + h / 2
      const cand: NameBox = { x: s.x - w / 2, y: cy - h / 2, w, h }
      if (cand.y < 0 || cand.y + cand.h > vp.heightPx) continue
      if (placed.some((p) => overlaps(p, cand))) continue
      box = cand
      break
    }
    if (!box) continue
    // A knockout, no border, exactly as the caption does it: the label is off
    // the curve, but a gridline or a tick number running through a single
    // italic letter makes it unreadable, and on white the plate is invisible.
    ctx.fillStyle = theme.bg
    ctx.fillRect(box.x, box.y, box.w, box.h)
    ctx.fillStyle = ink(curve.color)
    ctx.fillText(text, box.x + box.w / 2, box.y + box.h / 2)
    placed.push(box)
  }
  ctx.restore()
  ctx.textAlign = 'start'
  ctx.textBaseline = 'alphabetic'
}

/**
 * Where a curve with a restricted domain STOPS, and whether that end is part
 * of the graph.
 *
 * `closed` is always true today because FittedCurve.domain is a closed
 * interval — there is nowhere in the contract to say "open at this end" — but
 * the flag is what the exam convention is about (filled = included, hollow =
 * excluded), so it is stated rather than assumed, and the day a piecewise
 * definition carries inclusivity this function is the only thing that changes.
 */
export function domainEnds(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
): { at: Vec2; closed: boolean }[] {
  const d = curve.domain
  if (!d || !Number.isFinite(d[0]) || !Number.isFinite(d[1]) || !(d[1] > d[0])) return []
  const model = models[curve.modelId]
  if (!model) return []
  const at = (t: number): Vec2 | null => {
    try {
      if (curve.kind === 'explicit' && model.evalExplicit) {
        const y = model.evalExplicit(curve.params, t)
        return Number.isFinite(y) ? { x: t, y } : null
      }
      if (curve.kind === 'parametric' && model.evalParametric) {
        const v = model.evalParametric(curve.params, t)
        return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x, y: v.y } : null
      }
      if (curve.kind === 'polar' && model.evalPolar) {
        const r = model.evalPolar(curve.params, t)
        return Number.isFinite(r) ? { x: r * Math.cos(t), y: r * Math.sin(t) } : null
      }
    } catch {
      return null
    }
    return null
  }
  const out: { at: Vec2; closed: boolean }[] = []
  for (const t of d) {
    const p = at(t)
    if (p) out.push({ at: p, closed: true })
  }
  return out
}

// ---------------------------------------------------------------------------
// The one render routine
// ---------------------------------------------------------------------------

/**
 * Draw the whole board into `ctx`, in CSS pixels, filling vp.widthPx ×
 * vp.heightPx from the current transform origin.
 *
 * Order is deliberate: ground, grid, curves, analysis, handles, ink. Analysis
 * markers go UNDER the handles — handles are interactive and must stay visually
 * dominant wherever the two coincide.
 */
export function renderBoard(ctx: CanvasRenderingContext2D, scene: BoardScene): void {
  const { vp, models } = scene
  const chrome = scene.chrome ?? null
  const scale = paintScale(scene.present)

  // The style is chosen ONCE, here, and everything below reads it: there is no
  // second place that decides what a figure looks like, the same way there is
  // no second place that decides what a figure CONTAINS.
  const fig = figureOf(scene)
  const theme = fig ? fig.theme : scene.theme

  // The palette follows the GROUND, not the export flag.
  //
  // toPrintColor() used to be applied only while exporting, so the live light
  // theme kept a palette tuned against near-black: measured on white, lime
  // 1.51:1, teal 1.86:1, amber 1.97:1, green 2.15:1, against 4.9-7.3:1 for the
  // print palette the PNG used. A teacher previewing "for projecting on white"
  // therefore saw a figure that was both illegible AND not the one they would
  // get. Deriving it from the theme makes screen and export agree by
  // construction; `printColors` survives only as a force-on.
  const lightGround = !isDarkGround(theme)
  const print = scene.printColors === true || lightGround
  const paint = (c: string): string => (print ? toPrintColor(c) : c)

  // Mono ink: one black for every curve, polyline, field, shape and overlay
  // outline. A printed figure is photocopied, faxed and scanned to grey; the
  // colour that separates two curves on screen separates nothing on paper, so
  // what distinguishes them there is dash, width and label — which all survive.
  //
  // CHROME keeps its colours: handles and in-progress ink are the teacher's
  // editing vocabulary, they never reach the export, and a black handle on a
  // black curve would be unusable.
  // A caption reserves a band at the bottom of the plot, and the grid's labels
  // keep out of it: the caption is centred, which is where the y axis and its
  // numbers live. Without a caption there is no band and no style object, so
  // the grid call is the one it has always been.
  const captioned = typeof scene.caption === 'string' && scene.caption.trim() !== ''
  const gridStyle: GridStyle | null = captioned
    ? { ...(fig ?? SCREEN_GRID), bottomInset: captionHeight(scene.present) }
    : fig
  const mono = fig?.curveInk === 'mono'
  const ink = mono ? (): string => theme.axis : paint
  /** Shaded fills under mono ink: a grey wash light enough to copy. */
  const washAlpha = mono ? MONO_FILL_ALPHA : null

  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, Math.max(0, vp.widthPx), Math.max(0, vp.heightPx))

  // A number line is a different KIND of board, not a curve drawn differently:
  // no grid, no y axis, no models. It goes through this same routine — and so
  // through the same export — precisely so it can never grow a second path.
  if (scene.kind === 'number-line') {
    renderNumberLine(ctx, scene, theme, chrome, paint, scale)
    drawCaption(ctx, scene, theme, fig, scale.type)
    return
  }

  // The ruling is the board's, not the curve's: one dispatch, one grid, and
  // the export takes whichever one the screen took because it is the same call.
  try {
    if (scene.grid === 'polar')
      drawPolarGrid(ctx, vp, theme, scale, scene.axisUnits ?? null, gridStyle)
    else drawGrid(ctx, vp, theme, scale, scene.axisUnits ?? null, gridStyle)
  } catch {
    /* grid module absent or failed — keep going */
  }

  // Overlays: after the grid, before every curve — so a curve's own stroke
  // sits on top of its own shading rather than under it — and before all
  // chrome, because they are part of the figure.
  const overlays = scene.overlays
  if (overlays && overlays.length > 0) {
    try {
      drawOverlays(ctx, overlays, {
        vp,
        curves: scene.curves,
        models,
        paint: ink,
        scale,
        fillAlpha: washAlpha,
      })
    } catch {
      /* overlay render failed — the figure still stands */
    }
  }

  // Slope fields: under the polylines, under every curve. The lattice is the
  // ground the solution stands on; a curve broken up by it could not be read.
  const fields = scene.fields
  if (fields && fields.length > 0) {
    try {
      drawSlopeFields(ctx, fields, { vp, paint: ink, scale })
    } catch {
      /* field render failed — the figure still stands */
    }
  }

  // Solution curves and other open paths: above the field they solve, below
  // the fitted curves, and — like both — part of the figure, never chrome.
  const polylines = scene.polylines
  if (polylines && polylines.length > 0) {
    try {
      drawPolylines(ctx, polylines, { vp, paint: ink, scale })
    } catch {
      /* polyline render failed — the figure still stands */
    }
  }

  for (const curve of scene.curves) {
    if (!curve.visible) continue
    const style = scene.styles[curve.id]
    let alpha = 1
    const fadeIn = chrome?.curveAlpha
    if (fadeIn && fadeIn.id === curve.id) alpha = Math.max(0, Math.min(1, fadeIn.alpha))
    if (style?.opacity !== undefined) alpha *= style.opacity
    ctx.globalAlpha = alpha
    if (style?.dash) ctx.setLineDash(style.dash)
    try {
      // The selection halo is chrome: it says "this one is selected", not
      // anything about the maths, so it must not reach the exported figure.
      // Under mono ink on white it is dropped outright: the halo is a wash of
      // the curve's own colour, and a black wash around a black curve is a
      // glow no exam figure has ever had.
      const selected = chrome !== null && curve.id === chrome.selectedId && !(mono && lightGround)
      // The style's curveWidth replaces the family's default weight; a width
      // the teacher set on THIS curve still wins, as every explicit choice
      // does over a preset.
      const w = style?.width
      const c =
        fig !== null
          ? {
              ...curve,
              color: ink(curve.color),
              strokeWidth: typeof w === 'number' && w > 0 ? w : fig.curveWidth,
            }
          : print
          ? { ...curve, color: paint(curve.color) }
          : curve
      // Where the formula breaks. Both lists come from src/core/holes.ts, and
      // both are looked for over the VISIBLE x-range padded a little — a hole
      // three screens away costs a bisection and is never drawn.
      //
      // The dashed asymptote is a figure convention (a textbook rules one, the
      // screen does not, because the break in the stroke already says it), so
      // it asks the same question the end caps ask: does this figure MARK what
      // its curves do at the edges? It goes down BEFORE the curve so the curve
      // sits on top of it.
      //
      // findAsymptotes, not findPoles: an asymptote is a LINE, and the slant
      // line a polar curve leans on is the same convention drawn at a
      // different angle. The renderer clips whichever it is to the board.
      const breaks = holeRange(vp)
      let holes: readonly { x: number; y: number }[] = []
      if (breaks) {
        try {
          holes = findHoles(c, models, breaks)
        } catch {
          /* the curve still draws; only its rings are lost */
        }
        if (fig !== null && fig.curveEnds === 'marked') {
          try {
            drawAsymptotes(ctx, vp, findAsymptotes(c, models, breaks), {
              color: c.color,
              bg: theme.bg,
              stroke: scale.stroke,
            })
          } catch {
            /* ditto */
          }
        }
      }
      // lightGround: the selection halo is a wash of the curve's own colour,
      // and at 25% on white it was invisible — the same bug as the palette.
      drawCurve(ctx, c, models, vp, selected, {
        strokeScale: scale.stroke,
        lightGround,
      })
      // What the ends of the graph SAY: an arrow where it runs off the board,
      // a filled dot where a restricted graph stops and the point belongs to
      // it, a hollow one where it does not. On screen the domain is told by
      // the BRACKET handles instead, which are chrome — so an exported screen
      // figure never said it at all, and an exam figure has to.
      //
      // See src/render/endCaps.ts: the teacher's per-end choice wins, 'auto'
      // asks the figure style, and no style at all says nothing.
      drawCurveEnds(ctx, vp, c, models, resolveEnds(style, curve, fig), {
        color: c.color,
        bg: theme.bg,
        stroke: scale.stroke,
        width: curveLineWidth(c, scale.stroke),
      })
      // A hole is not a figure convention: EVERY style rings it, the screen
      // included. A board that draws (x²-1)/(x-1) as an unbroken line through
      // (1, 2) has stated something false, and the ring is what stops it. It
      // is the SAME glyph as an open end cap on purpose — both say "this point
      // is not on the graph" — and it goes on top of the stroke it interrupts.
      //
      // Which is exactly why a hole that IS an end must not be ringed twice:
      // a graph restricted to [-3, 1] that stops at its own hole gets one
      // hollow circle, not two in the same place. The geometry is only asked
      // for when there is a hole to place AND a cap that could already be
      // marking it — with no holes, or with a figure that caps nothing, this
      // costs one field read.
      let capped: Vec2[] = []
      if (holes.length > 0) {
        const guess = resolveEnds(style, curve, fig)
        if (guess.start !== 'none' || guess.end !== 'none') {
          try {
            const pts = curveEndPoints(c, models, vp)
            const settled = resolveEnds(style, curve, fig, pts)
            if (pts.start && settled.start === 'open') capped.push(pts.start.at)
            if (pts.end && settled.end === 'open') capped.push(pts.end.at)
          } catch {
            capped = []
          }
        }
      }
      drawHoles(
        ctx,
        vp,
        holes,
        { color: c.color, bg: theme.bg, stroke: scale.stroke },
        capped,
      )
    } catch {
      /* curve render failed — skip */
    }
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }

  // Data: on top of every curve (the fit is judged by the points against it),
  // under the shapes and the analysis layer. Residuals, when asked for, go
  // under the markers and end on the named curve.
  const scatter = scene.scatter
  if (scatter && scatter.length > 0) {
    try {
      drawScatter(ctx, scatter, {
        vp,
        theme,
        paint: ink,
        scale,
        curveAt: (id) => residualCurve(scene, id),
      })
    } catch {
      /* data render failed — the figure still stands */
    }
  }

  // Shapes: on top of every curve, under the analysis layer. The figure is
  // measured AGAINST the curves, so it cannot be painted beneath them; the
  // markers and labels that state the numbers still go on top of it.
  const shapes = scene.shapes
  if (shapes && shapes.length > 0) {
    try {
      drawShapes(ctx, shapes, {
        vp,
        theme,
        paint: ink,
        scale,
        fillAlpha: washAlpha,
        font: fig?.font ?? null,
      })
    } catch {
      /* shape render failed — the figure still stands */
    }
  }

  // The names, after every curve and before the analysis layer: a letter
  // belongs to the stroke it labels, and the chips that state coordinates go
  // on top of everything. Marked figures only — see BoardScene.curveNames.
  if (fig !== null && fig.curveEnds === 'marked') {
    try {
      drawCurveNames(ctx, scene, theme, fig, ink, scale)
    } catch {
      /* a name that could not be placed must not take the figure with it */
    }
  }

  // One budget of plates for the whole board: the crossings' chips step around
  // the selected curve's, because they are labels on the same picture.
  const plates: LabelBox[] = []

  const an = scene.analysis ?? null
  if (an && an.points.length > 0 && an.curve.visible) {
    try {
      drawAnalysis(ctx, vp, an.points, {
        reserve: plates,
        color: ink(an.curve.color),
        theme,
        pointStyle: fig?.pointStyle ?? null,
        font: fig?.font ?? null,
        handles: chrome?.handles ?? [],
        highlight: chrome?.highlight ?? null,
        openIdx: chrome?.openIdx ?? null,
        hoverIdx: chrome?.hoverIdx ?? null,
        halos: chrome !== null,
        scale,
        slopeAt: explicitSlope(an.curve, models),
        screenY: explicitScreenY(an.curve, models, vp),
      })
    } catch {
      /* analysis render failed — the board still stands */
    }
  }

  // Where the curves MEET, on top of the per-curve markers: a crossing is the
  // point a class is looking for on a board with two graphs on it, and it is
  // the one marker that has to be legible over another curve's own stroke.
  //
  // A point whose partner has been hidden is dropped here rather than upstream:
  // the scene is the thing that knows what is visible.
  const crossings = scene.intersections
  if (crossings && crossings.length > 0) {
    try {
      const shown = new Set<string>()
      for (const c of scene.curves) if (c.visible) shown.add(c.id)
      const pts = crossings
        .filter((m) => shown.has(m.curveId) && shown.has(m.point.withId ?? ''))
        .map((m) => m.point)
      if (pts.length > 0) {
        drawIntersections(ctx, vp, pts, {
          theme,
          color: intersectionInk(theme, mono),
          font: fig?.font ?? null,
          scale,
          reserve: plates,
        })
      }
    } catch {
      /* a crossing that could not be drawn must not take the board with it */
    }
  }

  // The caption is the last thing the FIGURE says, so it goes on top of every
  // figure layer and under the editing chrome.
  drawCaption(ctx, scene, theme, fig, scale.type)

  if (chrome) {
    const sel = scene.curves.find((c) => c.id === chrome.selectedId && c.visible)
    if (sel && chrome.handles.length > 0) {
      drawHandles(ctx, vp, theme, paint(sel.color), chrome.handles, chrome.activeHandleId, scale)
    }
    if (chrome.fade) {
      ctx.globalAlpha = Math.max(0, Math.min(1, chrome.fade.alpha))
      try {
        drawInk(ctx, chrome.fade.pts as Vec2[], vp, paint(chrome.fade.color), scale.stroke)
      } catch {
        /* ignore */
      }
      ctx.globalAlpha = 1
    }
    if (chrome.ink && chrome.ink.pts.length > 1) {
      try {
        drawInk(ctx, chrome.ink.pts as Vec2[], vp, paint(chrome.ink.color), scale.stroke)
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * The number-line half of the one render routine.
 *
 * Same contract as the cartesian half: everything in `items` is the figure and
 * reaches the export; everything in `chrome` (selection wash, endpoint
 * emphasis, the interval currently being dragged out) is scaffolding and stops
 * at the screen.
 */
function renderNumberLine(
  ctx: CanvasRenderingContext2D,
  scene: BoardScene,
  theme: Theme,
  chrome: BoardChrome | null,
  paint: (c: string) => string,
  scale: { type: number; stroke: number },
): void {
  const { vp } = scene
  const items = scene.items ?? []

  try {
    drawNumberLineAxis(ctx, vp, theme, scale)
  } catch {
    /* axis render failed — items still stand */
  }

  const lanes = nlLanes(items, vp)
  for (const { item, y } of lanes) {
    const style = scene.styles[item.id]
    try {
      drawNLItem(ctx, item, vp, {
        color: paint(item.color),
        theme,
        y,
        barWidth: style?.width,
        scale,
        ...(style?.dash ? { dash: style.dash } : {}),
        ...(style?.opacity !== undefined ? { opacity: style.opacity } : {}),
        selected: chrome !== null && item.id === chrome.selectedId,
        activePart:
          chrome && chrome.activePart && chrome.activePart.itemId === item.id
            ? chrome.activePart.part
            : null,
      })
    } catch {
      /* one bad item must not take the board down */
    }
  }

  // Chrome: the interval being dragged out right now, drawn on the top lane so
  // it never hides behind what is already there.
  if (chrome?.pending) {
    // Laid out WITH the existing items, so it lands in the lane it will keep
    // when the pointer comes up — the preview doesn't jump on release.
    const withPending = nlLanes([...items, chrome.pending], vp)
    const spot = withPending[withPending.length - 1]
    try {
      drawNLItem(ctx, chrome.pending, vp, {
        color: paint(chrome.pending.color),
        theme,
        y: spot ? spot.y : numberLineTopY(vp),
        scale,
        // Slightly ghosted: it is a promise, not yet a fact.
        opacity: 0.85,
        selected: false,
        activePart: null,
      })
    } catch {
      /* preview only — never worth a broken frame */
    }
  }
}

/** Where the pending item sits when nothing else is on the board. */
function numberLineTopY(vp: Viewport): number {
  return Math.round(vp.heightPx / 2)
}

// ---------------------------------------------------------------------------
// Export composition — the same scene, on paper of a stated size
// ---------------------------------------------------------------------------

/**
 * How big the PNG is, and how much white sits around the plot. A worksheet
 * wants every figure the same size, so this has to be statable rather than
 * "whatever my window happened to be".
 */
export interface ExportSettings {
  /** Multiplier on the on-screen size. Ignored when `width` is set. */
  scale: number
  /** Exact output width of the whole image in px; null = use `scale`. */
  width: number | null
  /** Quiet margin around the plot, in CSS px before scaling. */
  margin: number
  /** Which ground the figure is drawn on. Default: light, for paper. */
  theme: 'light' | 'dark'
}

export const EXPORT_SCALES = [1, 2, 4] as const

export const DEFAULT_EXPORT: ExportSettings = {
  scale: 2,
  width: null,
  margin: 24,
  theme: 'light',
}

export const MIN_EXPORT_WIDTH = 200
export const MAX_EXPORT_WIDTH = 8000
export const MAX_EXPORT_MARGIN = 200
/** Above this the browser silently hands back a blank canvas on some devices. */
const MAX_EXPORT_PIXELS = 40e6

export function clampExportSettings(s: ExportSettings): ExportSettings {
  const scale = Number.isFinite(s.scale) ? Math.min(8, Math.max(0.25, s.scale)) : 2
  const margin = Number.isFinite(s.margin)
    ? Math.round(Math.min(MAX_EXPORT_MARGIN, Math.max(0, s.margin)))
    : DEFAULT_EXPORT.margin
  const width =
    s.width === null || !Number.isFinite(s.width)
      ? null
      : Math.round(Math.min(MAX_EXPORT_WIDTH, Math.max(MIN_EXPORT_WIDTH, s.width)))
  return { scale, width, margin, theme: s.theme === 'dark' ? 'dark' : 'light' }
}

export interface ExportGeometry {
  /** Output pixel size of the whole image, margins included. */
  w: number
  h: number
  /** Device-pixel multiplier actually used. */
  scale: number
  /** Margin in output pixels. */
  margin: number
}

/**
 * Output geometry for a viewport. `width`, when set, is the width of the whole
 * image including margins — that is the number a teacher can state and reuse
 * across a document.
 */
export function exportGeometry(vp: Viewport, raw: ExportSettings): ExportGeometry {
  const s = clampExportSettings(raw)
  const plotW = Math.max(1, vp.widthPx)
  const plotH = Math.max(1, vp.heightPx)
  const layoutW = plotW + 2 * s.margin
  const layoutH = plotH + 2 * s.margin
  let scale = s.width !== null ? s.width / layoutW : s.scale
  if (!(scale > 0) || !Number.isFinite(scale)) scale = 1
  // Keep the image inside what canvas can actually rasterise.
  const px = layoutW * scale * layoutH * scale
  if (px > MAX_EXPORT_PIXELS) scale *= Math.sqrt(MAX_EXPORT_PIXELS / px)
  return {
    w: Math.max(1, Math.round(layoutW * scale)),
    h: Math.max(1, Math.round(layoutH * scale)),
    scale,
    margin: s.margin * scale,
  }
}

/**
 * Render the scene onto its own canvas at the stated output size, with the
 * margin band painted in the theme's ground and the plot clipped to its own
 * rect so nothing bleeds into the quiet edge.
 */
export function renderBoardToCanvas(
  scene: BoardScene,
  settings: ExportSettings,
): { canvas: HTMLCanvasElement; geometry: ExportGeometry } | null {
  const geo = exportGeometry(scene.vp, settings)
  const canvas = document.createElement('canvas')
  canvas.width = geo.w
  canvas.height = geo.h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = scene.theme.bg
  ctx.fillRect(0, 0, geo.w, geo.h)

  ctx.save()
  ctx.setTransform(geo.scale, 0, 0, geo.scale, geo.margin, geo.margin)
  ctx.beginPath()
  ctx.rect(0, 0, scene.vp.widthPx, scene.vp.heightPx)
  ctx.clip()
  renderBoard(ctx, scene)
  ctx.restore()

  return { canvas, geometry: geo }
}

/** The theme an export setting names. */
export function exportTheme(settings: ExportSettings, dark: Theme): Theme {
  return settings.theme === 'dark' ? dark : LIGHT_THEME
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), 'image/png')
    } catch {
      resolve(null)
    }
  })
}

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
  FittedCurve,
  ModelSpec,
  NLItem,
  SpecialPoint,
  Theme,
  Vec2,
  Viewport,
} from '../core/types'
import { LIGHT_THEME, toPrintColor, toScreen } from '../core/types'
import type { StyleMap } from '../core/persist'
import type { AxisUnit, AxisUnits, PaintScale } from '../render/grid'
import { drawGrid, paintScale } from '../render/grid'
import { drawPolarGrid } from '../render/polarGrid'
import { drawCurve, drawInk } from '../render/curves'
import type { Overlay } from '../render/overlays'
import { drawOverlays } from '../render/overlays'
import type { Polyline, SlopeField } from '../render/fields'
import { drawPolylines, drawSlopeFields } from '../render/fields'
import { drawNLItem, drawNumberLineAxis, nlLanes } from '../render/numberline'
import type { NLPart } from '../render/numberline'
import { formatCoord } from './numeric'

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
  /** Editing chrome. Null = the figure alone. */
  chrome?: BoardChrome | null
}

/** Re-exported so the App can name the field's type without reaching into render/. */
export type { AxisUnit, AxisUnits }
export type { Overlay, OverlayRect } from '../render/overlays'
export type { Polyline, SlopeField } from '../render/fields'

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
export function suggestAxisUnits(
  curves: readonly FittedCurve[],
  sources?: Record<string, string>,
): { x?: 'pi' } {
  for (const curve of curves) {
    if (!curve.visible) continue
    if (curve.modelId === 'sine') return { x: 'pi' }
    if (curve.modelId.startsWith('expr_')) {
      const src = sources?.[curve.id]
      if (typeof src === 'string' && TRIG_SOURCE.test(src)) return { x: 'pi' }
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

function labelFor(p: SpecialPoint): string {
  // p.exact says whether this location was solved in closed form or located
  // numerically; the formatter uses it so a numeric result is not printed to
  // more digits than the method can actually support.
  const o = { exact: p.exact }
  if (p.kind === 'zero') {
    return `${formatCoord(p.pos.x, o)}${p.tangent ? ' (touches)' : ''}`
  }
  return `(${formatCoord(p.pos.x, o)}, ${formatCoord(p.pos.y, o)})`
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
function markerRadius(p: SpecialPoint, s: number, grow = 0): number {
  switch (p.kind) {
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
): void {
  const r = markerRadius(p, s, grow)
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
): { x: number; y: number } {
  if (p.kind === 'minimum') return { x: 0, y: 1 }
  if (p.kind === 'maximum' || p.kind === 'petal-tip') return { x: 0, y: -1 }
  const m = slopeAt ? slopeAt(p.pos.x) : 0
  if (!Number.isFinite(m) || m === 0) return { x: 0, y: -1 }
  // screen tangent of math slope m is (1, -m); its normals are ±(-m, -1)
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
  const emph = (i: number): boolean => i === o.highlight || i === o.openIdx

  for (const m of shown) {
    if (m.masked) continue
    const emphasised = emph(m.i)
    if (o.halos && (m.i === o.openIdx || m.i === o.hoverIdx)) {
      drawMarkerHalo(ctx, m.sx, m.sy, o.color, m.i === o.openIdx, stroke)
    }
    const grow = emphasised ? 2.5 : o.halos && m.i === o.hoverIdx ? 1.2 : 0
    drawMarker(ctx, m.p, m.sx, m.sy, o.color, bg, grow, stroke)
  }

  // --- labels: the same crowding budget, spent on the points a class reads
  // first. MAX_LABELS no longer means "more than eight points, so draw none";
  // it means "label the eight that matter most".
  const fpx = LABEL_PX * type
  const gap = MIN_LABEL_GAP * type
  const h = 16 * type
  ctx.font = labelFont(fpx)
  ctx.textBaseline = 'middle'
  const placed: LabelBox[] = []
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
      : markerRadius(m.p, stroke, emph(m.i) ? 2.5 : 0)
    const n = labelNormal(m.p, o.slopeAt)
    const box = placeLabel(vp, m.sx, m.sy, w, h, mr, n, type, placed, o.screenY ?? null)
    if (!box) continue

    // A 1px leader from the marker to the plate: the label is off the curve,
    // so something has to say which point it belongs to. Drawn first, so the
    // opaque plate covers the half that would otherwise run under the text.
    ctx.save()
    ctx.globalAlpha = 0.55
    ctx.strokeStyle = o.color
    ctx.lineWidth = 1 * stroke
    ctx.beginPath()
    ctx.moveTo(m.sx, m.sy)
    ctx.lineTo(box.x + box.w / 2, box.y + box.h / 2)
    ctx.stroke()
    ctx.restore()

    // FULL opacity: a 0.86 plate let the curve through the text mottled.
    ctx.globalAlpha = 1
    roundRect(ctx, box.x, box.y, box.w, box.h, 4 * type)
    ctx.fillStyle = bg
    ctx.fill()
    ctx.lineWidth = 1 * stroke
    ctx.strokeStyle = emph(m.i) ? o.color : o.theme.gridMajor
    ctx.stroke()
    ctx.fillStyle = emph(m.i) ? o.color : text0
    ctx.fillText(text, box.x + 5 * type, box.y + h / 2)

    placed.push(box)
    anchors.push(m.sx)
  }
  ctx.textBaseline = 'alphabetic'
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
    const x = vp.center.x + (px - vp.widthPx / 2) / vp.pxPerUnit
    if (curve.domain && (x < curve.domain[0] || x > curve.domain[1])) return null
    try {
      const y = f.call(model, curve.params, x)
      if (!Number.isFinite(y)) return null
      return vp.heightPx / 2 - (y - vp.center.y) * vp.pxPerUnit
    } catch {
      return null
    }
  }
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
  const { vp, theme, models } = scene
  const chrome = scene.chrome ?? null
  const scale = paintScale(scene.present)

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

  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, Math.max(0, vp.widthPx), Math.max(0, vp.heightPx))

  // A number line is a different KIND of board, not a curve drawn differently:
  // no grid, no y axis, no models. It goes through this same routine — and so
  // through the same export — precisely so it can never grow a second path.
  if (scene.kind === 'number-line') {
    renderNumberLine(ctx, scene, chrome, paint, scale)
    return
  }

  // The ruling is the board's, not the curve's: one dispatch, one grid, and
  // the export takes whichever one the screen took because it is the same call.
  try {
    if (scene.grid === 'polar') drawPolarGrid(ctx, vp, theme, scale, scene.axisUnits ?? null)
    else drawGrid(ctx, vp, theme, scale, scene.axisUnits ?? null)
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
        paint,
        scale,
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
      drawSlopeFields(ctx, fields, { vp, paint, scale })
    } catch {
      /* field render failed — the figure still stands */
    }
  }

  // Solution curves and other open paths: above the field they solve, below
  // the fitted curves, and — like both — part of the figure, never chrome.
  const polylines = scene.polylines
  if (polylines && polylines.length > 0) {
    try {
      drawPolylines(ctx, polylines, { vp, paint, scale })
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
      const selected = chrome !== null && curve.id === chrome.selectedId
      const c = print ? { ...curve, color: paint(curve.color) } : curve
      // lightGround: the selection halo is a wash of the curve's own colour,
      // and at 25% on white it was invisible — the same bug as the palette.
      drawCurve(ctx, c, models, vp, selected, {
        strokeScale: scale.stroke,
        lightGround,
      })
    } catch {
      /* curve render failed — skip */
    }
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }

  const an = scene.analysis ?? null
  if (an && an.points.length > 0 && an.curve.visible) {
    try {
      drawAnalysis(ctx, vp, an.points, {
        color: paint(an.curve.color),
        theme,
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
  chrome: BoardChrome | null,
  paint: (c: string) => string,
  scale: { type: number; stroke: number },
): void {
  const { vp, theme } = scene
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

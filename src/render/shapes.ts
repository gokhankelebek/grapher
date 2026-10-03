// ============================================================================
// src/render/shapes.ts — points, segments, vectors and polygons.
//
// A shape is the figure a class MEASURES: triangle ABC and its image under a
// translation, the vector <4, 3> drawn from the origin, the segment whose
// length is the question. Unlike a curve there is nothing to sample — the
// vertices ARE the mathematics, and everything visible here is derived from
// them and the style.
//
// Three rules this layer is built around:
//
//   The figure sits ON TOP of the curves. A shape is drawn against the curves
//   it is measured against — a chord across a parabola, a tangent triangle —
//   so it paints after every stroke and before the analysis layer and the
//   chrome. A vertex hidden under a 2.5px stroke is a vertex a class cannot
//   read a coordinate off.
//
//   A vertex label never sits on the figure. The label of a polygon vertex
//   steps out along the OUTWARD bisector — the direction computed from the
//   polygon's own orientation (signed area), so a triangle typed clockwise and
//   the same triangle typed counter-clockwise both label outside, not one of
//   each. A point's chip steps up-right; a vector's rides the left-hand side
//   of its direction of travel, which is where a class writes it.
//
//   A point must read on top of a curve of its OWN colour. The disc carries a
//   ground-coloured ring around it, so (2, 4) on y = x² is a dot on a line and
//   not a bulge in the line.
//
// FIGURE, not chrome: shapes carry the mathematics the lesson is about, so
// they go through the one render routine and reach the exported PNG unchanged.
// Nothing in this file may ask whether chrome is on.
//
// All drawing units are CSS pixels (ctx is already DPR-scaled by the caller).
// ============================================================================

import type { Shape, ShapeAidsDraw, ShapeMeasureDraw, Theme, Vec2, Viewport } from '../core/types'
import { ppuX, ppuY } from '../core/types'
import { LABEL_PX, gridFont, labelFont, paintScale, type PaintScale } from './grid'

/** Re-exported so the board can name this without reaching into core/. */
export type { Shape }

const TWO_PI = Math.PI * 2
const DEG = Math.PI / 180

// ---------------------------------------------------------------------------
// Constants — every length in CSS px BEFORE `present.stroke` / `present.type`.
// ---------------------------------------------------------------------------

/** A plotted point: big enough to read across a room, small enough to be a point. */
export const SHAPE_POINT_RADIUS = 4
/** The ground-coloured ring that lifts a point off a same-coloured curve. */
export const SHAPE_POINT_RING_WIDTH = 1.5
/** Endpoint / vertex dots. Smaller than a plotted point: they are punctuation. */
export const SHAPE_DOT_RADIUS = 3
export const SHAPE_SEGMENT_WIDTH = 2
/** A vector is the heaviest line on the board — it is a quantity, not a path. */
export const SHAPE_VECTOR_WIDTH = 2.5
export const SHAPE_POLYGON_WIDTH = 2
/** Arrowhead length along its own wings. */
export const SHAPE_ARROW_LEN = 12
/** Half-angle of the head. 22° reads as an arrow at 12px and as one at 72px. */
export const SHAPE_ARROW_HALF_ANGLE = 22 * DEG
/**
 * Polygon fill. The same wash as an overlay region (OVERLAY_FILL_ALPHA), on
 * purpose: a shaded triangle and a shaded region are the same gesture, so they
 * must be the same weight of ink.
 */
export const SHAPE_FILL_ALPHA = 0.18
/** Air between a glyph and the label chip that names it. */
export const SHAPE_LABEL_GAP = 6
/** Label chip geometry — the analysis layer's chip, so the board has one chip. */
export const SHAPE_LABEL_H = 16
export const SHAPE_LABEL_PAD = 5

/** Label text on a dark ground; on a light one the theme's own label colour. */
const DARK_TEXT = '#e6eaf5'
/** A dot or a chip this far outside the canvas is simply not drawn. */
const CULL_MARGIN = 60
/** Up-and-right, the default step for a chip with no geometry to follow. */
const UP_RIGHT = { x: Math.SQRT1_2, y: -Math.SQRT1_2 }

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

interface Frame {
  /**
   * Pixels per unit along x and along y. Every head, normal and label offset
   * below is computed from toPx'd points, so a stretched board only changes
   * where the vertices land, never the shape of an arrowhead.
   */
  ppx: number
  ppy: number
  cx: number
  cy: number
  hw: number
  hh: number
  /** Generous overdraw box — the same ±1 viewport curves.ts clips strokes to. */
  bx0: number
  bx1: number
  by0: number
  by1: number
}

function frameOf(vp: Viewport): Frame {
  return {
    ppx: ppuX(vp),
    ppy: ppuY(vp),
    cx: vp.center.x,
    cy: vp.center.y,
    hw: vp.widthPx / 2,
    hh: vp.heightPx / 2,
    bx0: -vp.widthPx,
    bx1: 2 * vp.widthPx,
    by0: -vp.heightPx,
    by1: 2 * vp.heightPx,
  }
}

interface Pt { x: number; y: number }

const toPx = (fr: Frame, p: Vec2): Pt => ({
  x: fr.hw + (p.x - fr.cx) * fr.ppx,
  y: fr.hh - (p.y - fr.cy) * fr.ppy,
})

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

const finite = (p: Vec2 | undefined | null): boolean =>
  !!p && Number.isFinite(p.x) && Number.isFinite(p.y)

/** Is this glyph close enough to the canvas to be worth drawing at all? */
function onCanvas(fr: Frame, p: Pt): boolean {
  return (
    p.x >= -CULL_MARGIN &&
    p.y >= -CULL_MARGIN &&
    p.x <= 2 * fr.hw + CULL_MARGIN &&
    p.y <= 2 * fr.hh + CULL_MARGIN
  )
}

/**
 * Does any part of this shape reach the overdraw box?
 *
 * A polygon a million units wide, or one parked off the side of the board,
 * costs one bounding-box test and nothing else — the same bargain curves.ts
 * strikes with its clip.
 */
function nearBox(fr: Frame, pts: readonly Pt[]): boolean {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of pts) {
    if (p.x < x0) x0 = p.x
    if (p.x > x1) x1 = p.x
    if (p.y < y0) y0 = p.y
    if (p.y > y1) y1 = p.y
  }
  return x1 >= fr.bx0 && x0 <= fr.bx1 && y1 >= fr.by0 && y0 <= fr.by1
}

const unit = (x: number, y: number): Pt | null => {
  const L = Math.hypot(x, y)
  return L > 0 && Number.isFinite(L) ? { x: x / L, y: y / L } : null
}

// ---------------------------------------------------------------------------
// Clipped stroking — the same Liang–Barsky walk fields.ts and curves.ts use.
//
// Clipping the SEGMENT rather than clamping its endpoints keeps the drawn
// geometry exactly on the true edge: clamping bends a steep edge toward the
// corner of the box and moves where it crosses the canvas.
// ---------------------------------------------------------------------------

const PEN = { down: false, drawn: false }

function clipSeg(
  ctx: CanvasRenderingContext2D,
  fr: Frame,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  const dx = x1 - x0
  const dy = y1 - y0
  let t0 = 0
  let t1 = 1
  for (let e = 0; e < 4; e++) {
    const p = e === 0 ? -dx : e === 1 ? dx : e === 2 ? -dy : dy
    const q = e === 0 ? x0 - fr.bx0 : e === 1 ? fr.bx1 - x0 : e === 2 ? y0 - fr.by0 : fr.by1 - y0
    if (p === 0) {
      if (q < 0) {
        PEN.down = false
        return
      }
      continue
    }
    const r = q / p
    if (p < 0) {
      if (r > t1) {
        PEN.down = false
        return
      }
      if (r > t0) t0 = r
    } else {
      if (r < t0) {
        PEN.down = false
        return
      }
      if (r < t1) t1 = r
    }
  }
  if (t0 > 0 || !PEN.down) {
    // the exact endpoint when nothing was trimmed, so consecutive edges share
    // bit-identical join coordinates and the round join lands on the vertex
    ctx.moveTo(t0 > 0 ? x0 + dx * t0 : x0, t0 > 0 ? y0 + dy * t0 : y0)
  }
  ctx.lineTo(t1 < 1 ? x0 + dx * t1 : x1, t1 < 1 ? y0 + dy * t1 : y1)
  PEN.drawn = true
  PEN.down = t1 >= 1
}

/** Stroke an open or closed screen-space path, clipped to the overdraw box. */
function strokePath(
  ctx: CanvasRenderingContext2D,
  fr: Frame,
  pts: readonly Pt[],
  close: boolean,
): void {
  const n = pts.length
  if (n < 2) return
  ctx.beginPath()
  PEN.down = false
  PEN.drawn = false
  const edges = close ? n : n - 1
  for (let i = 0; i < edges; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    clipSeg(ctx, fr, a.x, a.y, b.x, b.y)
  }
  if (PEN.drawn) ctx.stroke()
}

// ---------------------------------------------------------------------------
// Glyphs
// ---------------------------------------------------------------------------

interface Style {
  /** present.stroke and present.type, already clamped. */
  stroke: number
  type: number
  theme: Theme
  /** Label ink for this ground. */
  ink: string
  /** The shape's colour, already through `paint`. */
  color: string
  /** Polygon fill alpha; SHAPE_FILL_ALPHA unless the board forced one. */
  fillAlpha: number
}

function dot(ctx: CanvasRenderingContext2D, fr: Frame, p: Pt, st: Style): void {
  if (!onCanvas(fr, p)) return
  ctx.beginPath()
  ctx.arc(p.x, p.y, SHAPE_DOT_RADIUS * st.stroke, 0, TWO_PI)
  ctx.fillStyle = st.color
  ctx.fill()
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
 * A name, on the analysis layer's own chip: ground plate, hairline border, one
 * line of text. Stepped off (px, py) along the unit direction `dir`, far
 * enough that the WHOLE plate — corners included — clears the glyph of radius
 * `r`, which is the same projection drawAnalysis uses to clear a curve.
 *
 * The font is the grid's, not the analysis layer's mono: a vertex label is a
 * NAME (A, B, C′, v), not a column of digits to line up, and it should read as
 * the same kind of annotation as the axis numbers it sits among.
 */
function label(
  ctx: CanvasRenderingContext2D,
  fr: Frame,
  px: number,
  py: number,
  dir: Pt,
  r: number,
  text: string,
  st: Style,
): void {
  if (!text) return
  const w = ctx.measureText(text).width + 2 * SHAPE_LABEL_PAD * st.type
  const h = SHAPE_LABEL_H * st.type
  const clearance = Math.abs(dir.x) * (w / 2) + Math.abs(dir.y) * (h / 2)
  const d = r + clearance + SHAPE_LABEL_GAP * st.type
  const cx = px + dir.x * d
  const cy = py + dir.y * d
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return
  if (!onCanvas(fr, { x: cx, y: cy })) return

  const x = cx - w / 2
  const y = cy - h / 2
  roundRect(ctx, x, y, w, h, 4 * st.type)
  ctx.globalAlpha = 1
  ctx.fillStyle = st.theme.bg
  ctx.fill()
  ctx.lineWidth = 1 * st.stroke
  ctx.strokeStyle = st.theme.gridMajor
  ctx.stroke()
  ctx.fillStyle = st.ink
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + SHAPE_LABEL_PAD * st.type, y + h / 2)
}

// ---------------------------------------------------------------------------
// point
// ---------------------------------------------------------------------------

function drawPoint(
  ctx: CanvasRenderingContext2D,
  s: Extract<Shape, { kind: 'point' }>,
  fr: Frame,
  st: Style,
): void {
  if (!finite(s.at)) return
  const p = toPx(fr, s.at)
  if (s.measure?.pair && finite(s.measure.pair.to)) {
    segmentMeasure(ctx, fr, p, toPx(fr, s.measure.pair.to), {
      lengths: s.measure.pair.length === null ? undefined : [s.measure.pair.length],
      slopes: s.measure.pair.slope === null ? undefined : [s.measure.pair.slope],
      midpoints: s.measure.pair.midpoint === null ? undefined : [s.measure.pair.midpoint],
    }, st, true)
  }
  if (!onCanvas(fr, p)) return
  const r = SHAPE_POINT_RADIUS * st.stroke
  const ring = SHAPE_POINT_RING_WIDTH * st.stroke

  // The ring sits OUTSIDE the disc (centre-line at r + half the ring), so the
  // disc keeps its full 4px radius and the ring is what separates it from
  // whatever it is standing on — a curve of its own colour, most of all.
  ctx.beginPath()
  ctx.arc(p.x, p.y, r + ring / 2, 0, TWO_PI)
  ctx.strokeStyle = st.theme.bg
  ctx.lineWidth = ring
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(p.x, p.y, r, 0, TWO_PI)
  ctx.fillStyle = st.color
  ctx.fill()

  if (s.label) label(ctx, fr, p.x, p.y, UP_RIGHT, r + ring, s.label, st)
}

// ---------------------------------------------------------------------------
// segment
// ---------------------------------------------------------------------------

function drawSegment(
  ctx: CanvasRenderingContext2D,
  s: Extract<Shape, { kind: 'segment' }>,
  fr: Frame,
  st: Style,
): void {
  if (!finite(s.a) || !finite(s.b)) return
  const a = toPx(fr, s.a)
  const b = toPx(fr, s.b)
  if (!nearBox(fr, [a, b])) return

  ctx.strokeStyle = st.color
  ctx.lineWidth = SHAPE_SEGMENT_WIDTH * st.stroke
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (s.dashed) setDash(ctx, IMAGE_DASH, st)
  strokePath(ctx, fr, [a, b], false)
  if (s.dashed) setDash(ctx, [], st)

  if (s.measure) segmentMeasure(ctx, fr, a, b, s.measure, st, false)

  dot(ctx, fr, a, st)
  dot(ctx, fr, b, st)

  const labels = s.labels
  if (!labels) return
  // Each end labels AWAY from the other: the one direction guaranteed to leave
  // the segment rather than run along it.
  const away = unit(a.x - b.x, a.y - b.y)
  const r = SHAPE_DOT_RADIUS * st.stroke
  label(ctx, fr, a.x, a.y, away ?? UP_RIGHT, r, labels[0] ?? '', st)
  label(ctx, fr, b.x, b.y, away ? { x: -away.x, y: -away.y } : UP_RIGHT, r, labels[1] ?? '', st)
}

// ---------------------------------------------------------------------------
// vector
// ---------------------------------------------------------------------------

/**
 * Tip, both wing points and where the shaft must stop.
 *
 * The wings are the head's own length away from the tip, rotated ±22° off the
 * direction the vector came FROM, so the head is 12px along its wings whatever
 * the vector's length or angle. The shaft stops at the wings' base —
 * headLen·cos(22°) back from the tip — because a 2.5px shaft running to the
 * tip pokes out of a filled head as a blunt pixel or two at the point, which
 * is exactly where the eye reads the direction.
 */
export function arrowGeometry(
  tail: Pt,
  tip: Pt,
  headLen: number,
): { u: Pt; w1: Pt; w2: Pt; base: Pt } | null {
  const u = unit(tip.x - tail.x, tip.y - tail.y)
  if (!u) return null
  const ca = Math.cos(SHAPE_ARROW_HALF_ANGLE)
  const sa = Math.sin(SHAPE_ARROW_HALF_ANGLE)
  // the direction the head points back along
  const bx = -u.x
  const by = -u.y
  const w1 = { x: tip.x + headLen * (bx * ca - by * sa), y: tip.y + headLen * (bx * sa + by * ca) }
  const w2 = { x: tip.x + headLen * (bx * ca + by * sa), y: tip.y + headLen * (by * ca - bx * sa) }
  // never past the tail: a vector shorter than its own head is all head
  const len = Math.hypot(tip.x - tail.x, tip.y - tail.y)
  const back = Math.min(headLen * ca, len)
  return { u, w1, w2, base: { x: tip.x - u.x * back, y: tip.y - u.y * back } }
}

function drawVector(
  ctx: CanvasRenderingContext2D,
  s: Extract<Shape, { kind: 'vector' }>,
  fr: Frame,
  st: Style,
): void {
  if (!finite(s.tail) || !finite(s.v)) return
  const tail = toPx(fr, s.tail)
  const tip = toPx(fr, { x: s.tail.x + s.v.x, y: s.tail.y + s.v.y })
  if (!nearBox(fr, [tail, tip])) return

  const geo = arrowGeometry(tail, tip, SHAPE_ARROW_LEN * st.stroke)
  if (!geo) {
    // The zero vector has no direction, so it gets no head and no shaft: a dot
    // at its tail, which is the whole truth about <0, 0>.
    dot(ctx, fr, tail, st)
    if (s.label) {
      label(ctx, fr, tail.x, tail.y, UP_RIGHT, SHAPE_DOT_RADIUS * st.stroke, s.label, st)
    }
    return
  }

  ctx.strokeStyle = st.color
  ctx.lineWidth = SHAPE_VECTOR_WIDTH * st.stroke
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  strokePath(ctx, fr, [tail, geo.base], false)

  ctx.beginPath()
  ctx.moveTo(tip.x, tip.y)
  ctx.lineTo(geo.w1.x, geo.w1.y)
  ctx.lineTo(geo.w2.x, geo.w2.y)
  ctx.closePath()
  ctx.fillStyle = st.color
  ctx.fill()

  if (s.label) {
    // The left-hand side of the direction of travel, in MATH orientation:
    // travelling along +x (screen (1, 0)), left is +y, which is screen (0, -1).
    const n = { x: geo.u.y, y: -geo.u.x }
    const mx = (tail.x + tip.x) / 2
    const my = (tail.y + tip.y) / 2
    label(ctx, fr, mx, my, n, (SHAPE_VECTOR_WIDTH / 2) * st.stroke, s.label, st)
  }
}

// ---------------------------------------------------------------------------
// polygon
// ---------------------------------------------------------------------------

/**
 * The outward direction at every vertex, from the polygon's own orientation.
 *
 * Twice the signed area gives the winding; the outward normal of an edge
 * (dx, dy) is then sign·(dy, -dx), and a vertex's outward direction is the
 * bisector of the two normals meeting there. Deriving the sign rather than
 * assuming one is what makes "the labels are outside" true for a triangle
 * typed clockwise AND for the same triangle typed the other way round — and a
 * class types them both.
 *
 * Both are computed in SCREEN coordinates, so the y-flip cancels: the sign and
 * the normals come from the same handedness.
 */
export function outwardDirs(pts: readonly Pt[]): Pt[] {
  const n = pts.length
  let a2 = 0
  for (let i = 0; i < n; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % n]
    a2 += p.x * q.y - q.x * p.y
  }
  const sgn = a2 >= 0 ? 1 : -1
  const normal = (i: number): Pt | null => {
    const p = pts[i]
    const q = pts[(i + 1) % n]
    const u = unit(q.x - p.x, q.y - p.y)
    return u ? { x: sgn * u.y, y: -sgn * u.x } : null
  }
  const norms: (Pt | null)[] = []
  for (let i = 0; i < n; i++) norms.push(normal(i))

  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const prev = norms[(i - 1 + n) % n]
    const next = norms[i]
    let d: Pt | null = null
    if (prev && next) d = unit(prev.x + next.x, prev.y + next.y)
    // A spike doubles back on itself and the two normals cancel; then the
    // edge normal is still an honest "away from the figure".
    if (!d) d = next ?? prev ?? null
    out.push(d ?? UP_RIGHT)
  }
  return out
}

/** Distinct in MATH coords: two vertices a rounding error apart are one. */
function distinctCount(pts: readonly Vec2[]): number {
  let n = 0
  for (let i = 0; i < pts.length; i++) {
    let seen = false
    for (let j = 0; j < i; j++) {
      if (Math.abs(pts[i].x - pts[j].x) < 1e-12 && Math.abs(pts[i].y - pts[j].y) < 1e-12) {
        seen = true
        break
      }
    }
    if (!seen) n++
  }
  return n
}

function drawPolygon(
  ctx: CanvasRenderingContext2D,
  s: Extract<Shape, { kind: 'polygon' }>,
  fr: Frame,
  st: Style,
): void {
  const src = s.pts
  if (!src || src.length === 0) return
  for (const p of src) if (!finite(p)) return

  const pts = src.map((p) => toPx(fr, p))
  if (!nearBox(fr, pts)) return
  const closed = distinctCount(src) >= 3

  // Fill first, under its own outline. The boundary is CLAMPED rather than
  // clipped: a filled region may not end early where it leaves the box (that
  // is the unshaded gutter overlays.ts measured next to a pole), and every
  // clamped vertex is already off the canvas.
  if (s.fill && closed) {
    ctx.globalAlpha = st.fillAlpha
    ctx.fillStyle = st.color
    ctx.beginPath()
    for (let i = 0; i < pts.length; i++) {
      const x = clamp(pts[i].x, fr.bx0, fr.bx1)
      const y = clamp(pts[i].y, fr.by0, fr.by1)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.fill()
    ctx.globalAlpha = 1
  }

  ctx.strokeStyle = st.color
  ctx.lineWidth = SHAPE_POLYGON_WIDTH * st.stroke
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  if (s.dashed) setDash(ctx, IMAGE_DASH, st)
  strokePath(ctx, fr, pts, closed)
  if (s.dashed) setDash(ctx, [], st)

  // The measurement marks (arcs, squares, ticks) sit on the figure, under its
  // vertex dots; their chips come last, over everything the polygon drew.
  if (s.measure && closed) polygonMarks(ctx, fr, pts, s.measure, st)

  for (const p of pts) dot(ctx, fr, p, st)

  if (s.measure && closed) polygonChips(ctx, fr, pts, s.measure, st)

  const labels = s.labels
  if (!labels || labels.length === 0) return
  const r = SHAPE_DOT_RADIUS * st.stroke
  if (closed) {
    const dirs = outwardDirs(pts)
    for (let i = 0; i < pts.length; i++) {
      const text = labels[i]
      if (text) label(ctx, fr, pts[i].x, pts[i].y, dirs[i], r, text, st)
    }
    return
  }
  // Degenerate: no interior to be outside of. Step away from the centroid,
  // which for two points is along the segment and for one is nowhere — so the
  // lone point falls back to up-right, like a plotted point.
  let gx = 0
  let gy = 0
  for (const p of pts) {
    gx += p.x / pts.length
    gy += p.y / pts.length
  }
  for (let i = 0; i < pts.length; i++) {
    const text = labels[i]
    if (!text) continue
    label(ctx, fr, pts[i].x, pts[i].y, unit(pts[i].x - gx, pts[i].y - gy) ?? UP_RIGHT, r, text, st)
  }
}

// ---------------------------------------------------------------------------
// line — "parallel to AB through P", drawn edge to edge
// ---------------------------------------------------------------------------

function drawLine(
  ctx: CanvasRenderingContext2D,
  s: Extract<Shape, { kind: 'line' }>,
  fr: Frame,
  st: Style,
): void {
  if (!finite(s.through) || !finite(s.dir)) return
  const p = toPx(fr, s.through)
  const u = unit(s.dir.x * fr.ppx, -s.dir.y * fr.ppy)
  if (!u) return
  const L = 4 * (fr.hw + fr.hh) + Math.abs(p.x - fr.hw) + Math.abs(p.y - fr.hh)
  ctx.strokeStyle = st.color
  ctx.lineWidth = SHAPE_SEGMENT_WIDTH * st.stroke
  ctx.lineCap = 'round'
  strokePath(ctx, fr, [{ x: p.x - u.x * L, y: p.y - u.y * L }, { x: p.x + u.x * L, y: p.y + u.y * L }], false)

  const eq = s.measure?.equation
  if (!eq) return
  // The chip sits beside the stretch of the line nearest the middle of the
  // board, on its upper side, so it is on screen whenever the line is.
  // A fixed step from the point it passes through, toward the middle of the
  // board: near the figure it belongs to, clear of P's own name, and two
  // lines through the same P (∥ and ⊥) step off in different directions.
  const toward = (fr.hw - p.x) * u.x + (fr.hh - p.y) * u.y >= 0 ? 1 : -1
  const step = 130 * st.type
  let at: Pt = { x: p.x + u.x * toward * step, y: p.y + u.y * toward * step }
  if (!onCanvas(fr, at) || !onCanvas(fr, p)) {
    // P is off the board: the stretch nearest the middle instead
    const t = (fr.hw - p.x) * u.x + (fr.hh - p.y) * u.y
    at = { x: p.x + u.x * t, y: p.y + u.y * t }
  }
  label(ctx, fr, at.x, at.y, upperNormal(u), SHAPE_SEGMENT_WIDTH * st.stroke, eq, st)
}

// ---------------------------------------------------------------------------
// Transformations — an image's construction marks, and the symmetry overlay
// ---------------------------------------------------------------------------

/** An image's outline: dashed, so the pre-image and its image never read as one figure. */
export const IMAGE_DASH: readonly number[] = [7, 5]
/** The mirror line: long dashes, heavier than a grid line, lighter than a figure. */
const MIRROR_DASH: readonly number[] = [10, 6]
/** Vertex paths A → A′: dotted, the quietest mark on the board. */
const PATH_DASH: readonly number[] = [2, 4]
/** Dilation rays. */
const RAY_DASH: readonly number[] = [6, 5]
/** Lines of symmetry. */
const SYM_DASH: readonly number[] = [8, 5]
const AID_WIDTH = 1.5
/** A rotation arc whose vertex sits (almost) on the centre is drawn at this radius. */
const ARC_MIN_R = 22

function setDash(ctx: CanvasRenderingContext2D, d: readonly number[], st: Style): void {
  if (typeof ctx.setLineDash === 'function') ctx.setLineDash(d.map((v) => v * st.stroke))
}

/** A whole line through a point, edge to edge, in screen space; null when degenerate. */
function screenLine(fr: Frame, through: Vec2, dir: Vec2): { p: Pt; u: Pt; ends: [Pt, Pt] } | null {
  if (!finite(through) || !finite(dir)) return null
  const p = toPx(fr, through)
  const u = unit(dir.x * fr.ppx, -dir.y * fr.ppy)
  if (!u) return null
  const L = 4 * (fr.hw + fr.hh) + Math.abs(p.x - fr.hw) + Math.abs(p.y - fr.hh)
  return { p, u, ends: [{ x: p.x - u.x * L, y: p.y - u.y * L }, { x: p.x + u.x * L, y: p.y + u.y * L }] }
}

/** A filled arrowhead at `tip`, pointing along the unit direction `u`. */
function arrowHead(ctx: CanvasRenderingContext2D, tip: Pt, u: Pt, st: Style, len: number): void {
  const geo = arrowGeometry({ x: tip.x - u.x * len * 2, y: tip.y - u.y * len * 2 }, tip, len)
  if (!geo) return
  ctx.beginPath()
  ctx.moveTo(tip.x, tip.y)
  ctx.lineTo(geo.w1.x, geo.w1.y)
  ctx.lineTo(geo.w2.x, geo.w2.y)
  ctx.closePath()
  ctx.fillStyle = st.color
  ctx.fill()
}

/** A centre of rotation or dilation: a ring, and its name. */
function centreMark(ctx: CanvasRenderingContext2D, fr: Frame, at: Vec2, text: string, st: Style): void {
  if (!finite(at)) return
  const p = toPx(fr, at)
  if (!onCanvas(fr, p)) return
  const r = 3.5 * st.stroke
  ctx.beginPath()
  ctx.arc(p.x, p.y, r, 0, TWO_PI)
  ctx.fillStyle = st.theme.bg
  ctx.fill()
  ctx.lineWidth = 1.75 * st.stroke
  ctx.strokeStyle = st.color
  ctx.stroke()
  label(ctx, fr, p.x, p.y, { x: -Math.SQRT1_2, y: Math.SQRT1_2 }, r, text, st)
}

/**
 * Everything a transformation draws besides the image: the mirror line, the
 * rotation's centre and arc, the dilation's rays, the translation vector, the
 * vertex paths — and a polygon's lines of symmetry. Under the figure, so the
 * image's own outline and vertex dots read on top.
 */
function drawAids(ctx: CanvasRenderingContext2D, a: ShapeAidsDraw, fr: Frame, st: Style): void {
  ctx.save()
  ctx.strokeStyle = st.color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (a.symLines && a.symLines.length > 0) {
    ctx.globalAlpha = 0.8
    ctx.lineWidth = AID_WIDTH * st.stroke
    setDash(ctx, SYM_DASH, st)
    for (const l of a.symLines) {
      const sl = screenLine(fr, l.through, l.dir)
      if (sl) strokePath(ctx, fr, sl.ends, false)
    }
  }
  if (a.mirror) {
    ctx.globalAlpha = 0.9
    ctx.lineWidth = 1.75 * st.stroke
    setDash(ctx, MIRROR_DASH, st)
    const sl = screenLine(fr, a.mirror.through, a.mirror.dir)
    if (sl) strokePath(ctx, fr, sl.ends, false)
  }
  if (a.rays && a.rays.length > 0) {
    ctx.globalAlpha = 0.7
    ctx.lineWidth = 1.25 * st.stroke
    setDash(ctx, RAY_DASH, st)
    for (const [p, q] of a.rays) {
      if (finite(p) && finite(q)) strokePath(ctx, fr, [toPx(fr, p), toPx(fr, q)], false)
    }
  }
  if (a.paths && a.paths.length > 0) {
    ctx.globalAlpha = 0.85
    ctx.lineWidth = 1.5 * st.stroke
    setDash(ctx, PATH_DASH, st)
    for (const [p, q] of a.paths) {
      if (finite(p) && finite(q)) strokePath(ctx, fr, [toPx(fr, p), toPx(fr, q)], false)
    }
  }
  setDash(ctx, [], st)
  ctx.globalAlpha = 1

  if (a.arc && finite(a.arc.center) && finite(a.arc.from) && finite(a.arc.to)) {
    const c = toPx(fr, a.arc.center)
    const f = toPx(fr, a.arc.from)
    const t = toPx(fr, a.arc.to)
    // the radii to the vertex and to its image, quietly dashed
    ctx.globalAlpha = 0.7
    ctx.lineWidth = 1.25 * st.stroke
    setDash(ctx, RAY_DASH, st)
    strokePath(ctx, fr, [c, f], false)
    strokePath(ctx, fr, [c, t], false)
    setDash(ctx, [], st)
    ctx.globalAlpha = 1
    let r = Math.hypot(f.x - c.x, f.y - c.y)
    const a0 = r < 1e-9 ? 0 : Math.atan2(f.y - c.y, f.x - c.x)
    if (r < ARC_MIN_R * st.stroke) r = ARC_MIN_R * st.stroke
    // screen y points down: a counterclockwise turn in the plane is a
    // DEcreasing screen angle
    const sweep = (-a.arc.deg * Math.PI) / 180
    const a1 = a0 + sweep
    ctx.lineWidth = 1.75 * st.stroke
    ctx.beginPath()
    ctx.arc(c.x, c.y, r, a0, a1, sweep < 0)
    ctx.stroke()
    const e = { x: c.x + r * Math.cos(a1), y: c.y + r * Math.sin(a1) }
    const dir = sweep < 0 ? { x: Math.sin(a1), y: -Math.cos(a1) } : { x: -Math.sin(a1), y: Math.cos(a1) }
    arrowHead(ctx, e, dir, st, 9 * st.stroke)
    const am = a0 + sweep / 2
    label(ctx, fr, c.x + r * Math.cos(am), c.y + r * Math.sin(am), { x: Math.cos(am), y: Math.sin(am) }, 2 * st.stroke, a.arc.label, st)
  }
  if (a.vector && finite(a.vector.tail) && finite(a.vector.v)) {
    const tail = toPx(fr, a.vector.tail)
    const tip = toPx(fr, { x: a.vector.tail.x + a.vector.v.x, y: a.vector.tail.y + a.vector.v.y })
    const geo = arrowGeometry(tail, tip, 11 * st.stroke)
    if (geo) {
      ctx.lineWidth = 2 * st.stroke
      strokePath(ctx, fr, [tail, geo.base], false)
      arrowHead(ctx, tip, geo.u, st, 11 * st.stroke)
      const n = { x: geo.u.y, y: -geo.u.x }
      label(ctx, fr, (tail.x + tip.x) / 2, (tail.y + tip.y) / 2, n, st.stroke, a.vector.label, st)
    }
  }
  if (a.mirror) {
    const sl = screenLine(fr, a.mirror.through, a.mirror.dir)
    if (sl) {
      // the equation chip: near the middle of the board, on the line's upper side
      const t = (fr.hw - sl.p.x) * sl.u.x + (fr.hh - sl.p.y) * sl.u.y
      const step = 150 * st.type
      const at = { x: sl.p.x + sl.u.x * (t + step), y: sl.p.y + sl.u.y * (t + step) }
      const spot = onCanvas(fr, at) ? at : { x: sl.p.x + sl.u.x * t, y: sl.p.y + sl.u.y * t }
      label(ctx, fr, spot.x, spot.y, upperNormal(sl.u), st.stroke, a.mirror.label, st)
    }
  }
  if (a.center) centreMark(ctx, fr, a.center.at, a.center.label, st)
  if (a.symText && finite(a.symText.at)) {
    const p = toPx(fr, a.symText.at)
    label(ctx, fr, p.x, p.y, { x: 0, y: 1 }, 0, a.symText.text, st)
  }
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Measurements — side chips, angle arcs, right-angle squares, congruence marks
// ---------------------------------------------------------------------------

/** Radius of an angle arc, CSS px before present.stroke. */
export const MEASURE_ARC_R = 16
/** Spacing of the rings of a congruence arc mark. */
const ARC_RING_GAP = 4
/** Side of a right-angle square. */
export const MEASURE_SQUARE = 10
/** A congruence tick: its length across the side, and the gap between ticks. */
const TICK_LEN = 10
const TICK_GAP = 4
/** Midpoint ring radius. */
const MID_R = 3.5
const MARK_WIDTH = 1.5

/** The normal of direction u that points up the screen (or right, when u is vertical). */
function upperNormal(u: Pt): Pt {
  const n = { x: u.y, y: -u.x }
  if (Math.abs(n.y) < 1e-9) return n.x >= 0 ? n : { x: -n.x, y: -n.y }
  return n.y < 0 ? n : { x: -n.x, y: -n.y }
}

/** Each edge's outward unit normal (edge i: vertex i → i + 1), from the polygon's orientation. */
function edgeNormals(pts: readonly Pt[]): (Pt | null)[] {
  const n = pts.length
  let a2 = 0
  for (let i = 0; i < n; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % n]
    a2 += p.x * q.y - q.x * p.y
  }
  const sgn = a2 >= 0 ? 1 : -1
  const out: (Pt | null)[] = []
  for (let i = 0; i < n; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % n]
    const u = unit(q.x - p.x, q.y - p.y)
    out.push(u ? { x: sgn * u.y, y: -sgn * u.x } : null)
  }
  return out
}

/** How far a chip of this text reaches along `dir` from its own centre. */
function chipReach(ctx: CanvasRenderingContext2D, text: string, dir: Pt, st: Style): number {
  const w = ctx.measureText(text).width + 2 * SHAPE_LABEL_PAD * st.type
  const h = SHAPE_LABEL_H * st.type
  return Math.abs(dir.x) * (w / 2) + Math.abs(dir.y) * (h / 2)
}

/**
 * Chips stacked outward from (x, y) along `dir`: the first just clear of the
 * line, each next one clear of the one before.
 */
function chipStack(ctx: CanvasRenderingContext2D, fr: Frame, x: number, y: number, dir: Pt, r: number, texts: readonly string[], st: Style): void {
  let at = r
  for (const t of texts) {
    if (!t) continue
    label(ctx, fr, x, y, dir, at, t, st)
    at += 2 * chipReach(ctx, t, dir, st) + SHAPE_LABEL_GAP * st.type * 0.6
  }
}

/** A hollow ring at a midpoint. */
function midRing(ctx: CanvasRenderingContext2D, fr: Frame, p: Pt, st: Style): void {
  if (!onCanvas(fr, p)) return
  ctx.beginPath()
  ctx.arc(p.x, p.y, MID_R * st.stroke, 0, TWO_PI)
  ctx.fillStyle = st.theme.bg
  ctx.fill()
  ctx.lineWidth = MARK_WIDTH * st.stroke
  ctx.strokeStyle = st.color
  ctx.stroke()
}

/** k short ticks across the edge a→b, centred at fraction `f` of the way along. */
function ticks(ctx: CanvasRenderingContext2D, fr: Frame, a: Pt, b: Pt, k: number, f: number, st: Style): void {
  const u = unit(b.x - a.x, b.y - a.y)
  if (!u || k <= 0) return
  const n = { x: -u.y, y: u.x }
  const cx = a.x + (b.x - a.x) * f
  const cy = a.y + (b.y - a.y) * f
  if (!onCanvas(fr, { x: cx, y: cy })) return
  const half = (TICK_LEN / 2) * st.stroke
  const gap = TICK_GAP * st.stroke
  ctx.beginPath()
  for (let j = 0; j < k; j++) {
    const off = (j - (k - 1) / 2) * gap
    const mx = cx + u.x * off
    const my = cy + u.y * off
    ctx.moveTo(mx - n.x * half, my - n.y * half)
    ctx.lineTo(mx + n.x * half, my + n.y * half)
  }
  ctx.lineWidth = MARK_WIDTH * st.stroke
  ctx.strokeStyle = st.color
  ctx.stroke()
}

/** The canvas arc at vertex c from the ray toward `a` to the ray toward `b`, on the side `inward` points to. */
function interiorArc(ctx: CanvasRenderingContext2D, c: Pt, a: Pt, b: Pt, inward: Pt, r: number): void {
  const a0 = Math.atan2(a.y - c.y, a.x - c.x)
  const a1 = Math.atan2(b.y - c.y, b.x - c.x)
  let delta = a1 - a0
  while (delta < 0) delta += TWO_PI
  while (delta >= TWO_PI) delta -= TWO_PI
  const mid = a0 + delta / 2
  const cw = Math.cos(mid) * inward.x + Math.sin(mid) * inward.y >= 0
  ctx.beginPath()
  if (cw) ctx.arc(c.x, c.y, r, a0, a0 + delta, false)
  else ctx.arc(c.x, c.y, r, a0, a1, true)
  ctx.stroke()
}

function polygonMarks(ctx: CanvasRenderingContext2D, fr: Frame, pts: readonly Pt[], m: ShapeMeasureDraw, st: Style): void {
  const n = pts.length
  const out = outwardDirs(pts)
  ctx.save()
  ctx.lineWidth = MARK_WIDTH * st.stroke
  ctx.strokeStyle = st.color
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'miter'
  for (let i = 0; i < n; i++) {
    const c = pts[i]
    if (!onCanvas(fr, c)) continue
    const prev = pts[(i - 1 + n) % n]
    const next = pts[(i + 1) % n]
    const inward = { x: -out[i].x, y: -out[i].y }
    const square = m.right?.[i] === true
    if (square) {
      const u = unit(prev.x - c.x, prev.y - c.y)
      const w = unit(next.x - c.x, next.y - c.y)
      if (u && w) {
        const k = MEASURE_SQUARE * st.stroke
        ctx.beginPath()
        ctx.moveTo(c.x + u.x * k, c.y + u.y * k)
        ctx.lineTo(c.x + (u.x + w.x) * k, c.y + (u.y + w.y) * k)
        ctx.lineTo(c.x + w.x * k, c.y + w.y * k)
        ctx.stroke()
      }
      continue
    }
    const rings = Math.max(m.angles?.[i] ? 1 : 0, m.arcs?.[i] ?? 0)
    for (let j = 0; j < rings; j++) {
      interiorArc(ctx, c, prev, next, inward, (MEASURE_ARC_R + j * ARC_RING_GAP) * st.stroke)
    }
  }
  // congruence ticks; moved off the midpoint when a midpoint ring is there
  if (m.ticks) {
    for (let i = 0; i < n; i++) {
      const k = m.ticks[i] ?? 0
      if (k > 0) ticks(ctx, fr, pts[i], pts[(i + 1) % n], k, m.midpoints?.[i] ? 0.36 : 0.5, st)
    }
  }
  ctx.restore()
}

function polygonChips(ctx: CanvasRenderingContext2D, fr: Frame, pts: readonly Pt[], m: ShapeMeasureDraw, st: Style): void {
  const n = pts.length
  const normals = edgeNormals(pts)
  const out = outwardDirs(pts)
  const line = (SHAPE_POLYGON_WIDTH / 2) * st.stroke

  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    const nrm = normals[i]
    if (!nrm) continue
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2
    if (m.midpoints?.[i]) {
      const mp = { x: mx, y: my }
      midRing(ctx, fr, mp, st)
      label(ctx, fr, mx, my, { x: -nrm.x, y: -nrm.y }, MID_R * st.stroke, m.midpoints[i]!, st)
    }
    const texts = [m.lengths?.[i] ?? '', m.slopes?.[i] ?? ''].filter((t) => t)
    // clear of the congruence ticks crossing the side, not just of the line
    const base = (m.ticks?.[i] ?? 0) > 0 ? Math.max(line, (TICK_LEN / 2 + 1) * st.stroke) : line
    if (texts.length > 0) chipStack(ctx, fr, mx, my, nrm, base, texts, st)
  }

  if (m.angles) {
    for (let i = 0; i < n; i++) {
      const text = m.angles[i]
      if (!text) continue
      const c = pts[i]
      const prev = pts[(i - 1 + n) % n]
      const next = pts[(i + 1) % n]
      const inward = { x: -out[i].x, y: -out[i].y }
      // keep the chip clear of both sides: its centre must sit at least its
      // half-diagonal away from each, which a thin angle pushes outward
      const u = unit(prev.x - c.x, prev.y - c.y)
      const w = unit(next.x - c.x, next.y - c.y)
      const theta = u && w ? Math.acos(Math.max(-1, Math.min(1, u.x * w.x + u.y * w.y))) : Math.PI / 2
      const wTxt = ctx.measureText(text).width + 2 * SHAPE_LABEL_PAD * st.type
      const hTxt = SHAPE_LABEL_H * st.type
      const halfDiag = Math.hypot(wTxt, hTxt) / 2
      const reach = chipReach(ctx, text, inward, st)
      const rings = Math.max(1, m.arcs?.[i] ?? 0)
      const arcR = (MEASURE_ARC_R + (rings - 1) * ARC_RING_GAP) * st.stroke
      const need = Math.sin(Math.min(theta, Math.PI - 1e-3) / 2) > 0.05 ? halfDiag / Math.sin(theta / 2) - reach - SHAPE_LABEL_GAP * st.type : arcR
      const r = Math.min(90 * st.stroke, Math.max(arcR, need))
      label(ctx, fr, c.x, c.y, inward, r, text, st)
    }
  }

  if (m.summary && m.summary.length > 0) {
    // clear of the side chips stacked under the lowest edges
    const stacked = (m.lengths ? 1 : 0) + (m.slopes ? 1 : 0)
    summaryChip(ctx, fr, pts, m.summary.map((l) => l.text), st, stacked)
  }
}

/** The chip under the figure: perimeter and area, the classification. */
function summaryChip(ctx: CanvasRenderingContext2D, fr: Frame, pts: readonly Pt[], lines: readonly string[], st: Style, stacked = 0): void {
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const p of pts) {
    x0 = Math.min(x0, p.x)
    x1 = Math.max(x1, p.x)
    y0 = Math.min(y0, p.y)
    y1 = Math.max(y1, p.y)
  }
  const pad = SHAPE_LABEL_PAD * st.type
  const lh = SHAPE_LABEL_H * st.type
  const w = Math.max(...lines.map((t) => ctx.measureText(t).width)) + 2 * pad
  const h = lh * lines.length + pad * 0.6
  // under the figure, clear of its vertex labels; above it when there is no room
  const clear = (30 + stacked * (SHAPE_LABEL_H + 4)) * st.type
  let top = y1 + clear
  if (top + h > 2 * fr.hh - 4 && y0 - clear - h >= 4) top = y0 - clear - h
  const cx = Math.min(Math.max((x0 + x1) / 2, w / 2 + 4), 2 * fr.hw - w / 2 - 4)
  if (!Number.isFinite(cx) || !Number.isFinite(top)) return
  if (!onCanvas(fr, { x: cx, y: top + h / 2 })) return
  const x = cx - w / 2
  roundRect(ctx, x, top, w, h, 4 * st.type)
  ctx.fillStyle = st.theme.bg
  ctx.fill()
  ctx.lineWidth = 1 * st.stroke
  ctx.strokeStyle = st.color
  ctx.stroke()
  ctx.fillStyle = st.ink
  ctx.textBaseline = 'middle'
  lines.forEach((t, i) => ctx.fillText(t, x + pad, top + pad * 0.3 + lh * (i + 0.5)))
}

/**
 * A segment's readouts (or a point's, measured to another point): length and
 * slope stacked on the upper side, the midpoint ring and its coordinates on
 * the lower side, the equation after them. `dashed` draws the connector
 * first — a point pair has no segment of its own.
 */
function segmentMeasure(ctx: CanvasRenderingContext2D, fr: Frame, a: Pt, b: Pt, m: ShapeMeasureDraw, st: Style, dashed: boolean): void {
  if (!nearBox(fr, [a, b])) return
  const u = unit(b.x - a.x, b.y - a.y)
  if (dashed) {
    ctx.save()
    ctx.setLineDash([6 * st.stroke, 4 * st.stroke])
    ctx.lineWidth = MARK_WIDTH * st.stroke
    ctx.strokeStyle = st.color
    strokePath(ctx, fr, [a, b], false)
    ctx.restore()
    dot(ctx, fr, b, st)
  }
  if (!u) return
  const nUp = upperNormal(u)
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const line = (SHAPE_SEGMENT_WIDTH / 2) * st.stroke
  if (m.midpoints?.[0]) {
    midRing(ctx, fr, { x: mx, y: my }, st)
    const down = { x: -nUp.x, y: -nUp.y }
    chipStack(ctx, fr, mx, my, down, MID_R * st.stroke, [m.midpoints[0]!, m.equation ?? ''], st)
  }
  const up = [m.lengths?.[0] ?? '', m.slopes?.[0] ?? '', m.midpoints?.[0] ? '' : (m.equation ?? '')].filter((t) => t)
  if (up.length > 0) chipStack(ctx, fr, mx, my, nUp, line, up, st)
}

// ---------------------------------------------------------------------------
// The layer
// ---------------------------------------------------------------------------

export interface ShapePaintOpts {
  vp: Viewport
  /** The ground: the point ring and every label chip are painted in it. */
  theme: Theme
  /**
   * The board's screen→print colour mapping (identity on a dark ground). The
   * SAME function the curves go through, so a triangle and the curve it is
   * measured against can never end up in two different palettes.
   */
  paint?: ((c: string) => string) | null
  /** Presentation scale: every weight and glyph follows it; fill alpha does not. */
  scale?: PaintScale | null
  /**
   * One fill alpha for every filled polygon, overriding SHAPE_FILL_ALPHA.
   *
   * The mono-ink figure's grey wash: with outline and fill both black, the
   * lightness of the wash is the only thing left to separate a filled triangle
   * from its own boundary. Absent leaves SHAPE_FILL_ALPHA exactly as it was.
   */
  fillAlpha?: number | null
  /**
   * The figure's label face, for shape labels. Absent is the sans stack this
   * layer has always used; 'serif' is the exam figure, where a label in
   * system-ui beside Times tick numbers reads as a different document.
   */
  font?: 'sans' | 'serif' | null
}

const identity = (c: string): string => c

/**
 * Relative luminance of the ground, so a theme the caller invented still gets
 * readable label text without having to declare one. Same test renderBoard
 * makes — a shape label and an analysis label must not disagree about which
 * ground they are on.
 */
function isDarkGround(theme: Theme): boolean {
  const m = /^#([0-9a-fA-F]{6})$/.exec(theme.bg.trim())
  if (!m) return true
  const v = parseInt(m[1], 16)
  return 0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255) < 128
}

/**
 * Paint every visible shape, in the order given.
 *
 * Called after the curves and before the analysis layer: the figure sits on
 * top of the curves it is measured against, and under the markers and labels
 * that state the numbers. One bad shape never takes the board down — a teacher
 * mid-lesson would rather lose one triangle than the whole figure.
 */
export function drawShapes(
  ctx: CanvasRenderingContext2D,
  shapes: readonly Shape[],
  o: ShapePaintOpts,
): void {
  if (shapes.length === 0) return
  let any = false
  for (const s of shapes) {
    if (s && s.visible) {
      any = true
      break
    }
  }
  if (!any) return

  const vp = o.vp
  if (vp.widthPx <= 0 || vp.heightPx <= 0 || !(vp.pxPerUnit > 0)) return
  const fr = frameOf(vp)
  const { type, stroke } = paintScale(o.scale)
  const paint = o.paint ?? identity
  const theme = o.theme
  const ink = isDarkGround(theme) ? DARK_TEXT : theme.label

  const fillAlpha =
    typeof o.fillAlpha === 'number' && Number.isFinite(o.fillAlpha)
      ? Math.min(1, Math.max(0, o.fillAlpha))
      : SHAPE_FILL_ALPHA

  ctx.save()
  ctx.font = o.font ? labelFont({ font: o.font }, LABEL_PX * type) : gridFont(LABEL_PX * type)
  for (const s of shapes) {
    if (!s || !s.visible) continue
    const st: Style = { stroke, type, theme, ink, color: paint(s.color), fillAlpha }
    try {
      if (s.kind !== 'vector' && s.aids) drawAids(ctx, s.aids, fr, st)
      if (s.kind !== 'vector' && s.figureHidden) continue
      switch (s.kind) {
        case 'point':
          drawPoint(ctx, s, fr, st)
          break
        case 'segment':
          drawSegment(ctx, s, fr, st)
          break
        case 'vector':
          drawVector(ctx, s, fr, st)
          break
        case 'polygon':
          drawPolygon(ctx, s, fr, st)
          break
        case 'line':
          drawLine(ctx, s, fr, st)
          break
      }
    } catch {
      /* one shape failing must not cost the figure */
    }
  }
  ctx.globalAlpha = 1
  ctx.textBaseline = 'alphabetic'
  ctx.restore()
}

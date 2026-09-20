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

import type { Shape, Theme, Vec2, Viewport } from '../core/types'
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
  ppu: number
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
    ppu: vp.pxPerUnit,
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
  x: fr.hw + (p.x - fr.cx) * fr.ppu,
  y: fr.hh - (p.y - fr.cy) * fr.ppu,
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
  strokePath(ctx, fr, [a, b], false)

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
  strokePath(ctx, fr, pts, closed)

  for (const p of pts) dot(ctx, fr, p, st)

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
      }
    } catch {
      /* one shape failing must not cost the figure */
    }
  }
  ctx.globalAlpha = 1
  ctx.textBaseline = 'alphabetic'
  ctx.restore()
}

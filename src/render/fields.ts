// ============================================================================
// src/render/fields.ts — slope fields and open polylines.
//
// A slope field is not a curve. A curve says "y is this"; a field says "at
// every point, y is CHANGING like this", and the picture a class needs is a
// lattice of short segments, each tangent to whatever solution passes through
// it. The solution curve itself is an open polyline handed over in math
// coords (src/core/ode.ts integrates it; this file only draws it).
//
// Two rules the layer is built around:
//
//   The lattice is anchored to math (0, 0), never to the viewport corner.
//   Anchoring to the corner makes every segment slide under the cursor while
//   the board is panned — the field appears to swim, and a field that moves
//   while the mathematics does not is a lie about the mathematics. Lattice
//   points sit at integer multiples of the spacing in MATH units, so panning
//   only changes which of them are on screen.
//
//   A segment is drawn, never dropped. Zoom out far enough and the honest
//   lattice would be tens of thousands of segments — a grey wash. The cap is
//   spent by widening the spacing, so the field thins out and stays legible,
//   rather than by skipping points, which would leave holes with no meaning.
//
// Both are FIGURE, not chrome: they carry the mathematics, so they go through
// the one render routine and reach the exported PNG unchanged. Nothing here
// may ask whether chrome is on.
//
// All drawing units are CSS pixels (ctx is already DPR-scaled by the caller).
// ============================================================================

import type { Polyline, SlopeField, Viewport } from '../core/types'
import { paintScale, type PaintScale } from './grid'

/** Re-exported so the board can name these without reaching into core/. */
export type { SlopeField, Polyline }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Lattice spacing in CSS px when the field does not state one. */
export const FIELD_SPACING_PX = 28
/** Segment length as a fraction of the spacing — short enough to leave air. */
export const FIELD_SEGMENT_FRACTION = 0.6
/**
 * Field alpha. The field is TEXTURE: the eye should read a direction at a
 * glance and then look straight past it at the solution curve drawn on top.
 * At full strength a 800-segment lattice out-shouts every curve on the board.
 */
export const FIELD_ALPHA = 0.55
/** Segment weight in CSS px before `present.stroke`. Hairlines, deliberately. */
export const FIELD_LINE_WIDTH = 1
/**
 * Most segments drawn for one field in one frame. Past this the lattice stops
 * being a picture of a direction and becomes a grey wash; the spacing widens
 * to stay under it (see the file header).
 */
export const FIELD_MAX_POINTS = 4000
/** Stroke width for a polyline that does not state one. */
export const POLYLINE_WIDTH = 2

/**
 * Screen-space rise:run past which a segment is simply drawn vertical.
 *
 * dy/dx = ±∞ has an honest limit — the tangent direction is straight up — and
 * a lattice point on the y-axis of dy/dx = y/x deserves that segment rather
 * than a gap. The threshold also keeps `ppy * m` from overflowing to Infinity
 * for a merely enormous finite m, which would leave a zero-length direction.
 */
const VERTICAL_RATIO = 1e6

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

interface Frame {
  /** Pixels per math unit along x and y. Equal today; see frameOf. */
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

/**
 * The viewport as a screen frame.
 *
 * `pxPerUnit` is a single number today, so the pixels are square and ppx ===
 * ppy. The two are kept apart anyway: a slope is a RATIO of units, and the
 * screen angle of dy/dx = 1 is 45° only while the scales agree. If an
 * independent y zoom ever lands, the arithmetic below is already correct
 * rather than quietly off by the aspect ratio — a field whose segments are not
 * tangent to the solution curve is worse than no field.
 */
function frameOf(vp: Viewport): Frame {
  const aniso = vp as Viewport & { pxPerUnitX?: number; pxPerUnitY?: number }
  const pos = (v: number | undefined): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
  const base = vp.pxPerUnit
  return {
    ppx: pos(aniso.pxPerUnitX) ?? base,
    ppy: pos(aniso.pxPerUnitY) ?? base,
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

export interface FieldPaintOpts {
  vp: Viewport
  /**
   * The board's screen→print colour mapping (identity on a dark ground). The
   * SAME function the curves go through, so a field and the solution curve
   * riding on it can never end up in two different palettes.
   */
  paint?: ((c: string) => string) | null
  /** Presentation scale: spacing, segment length and weight all follow it. */
  scale?: PaintScale | null
}

const identity = (c: string): string => c

// ---------------------------------------------------------------------------
// Slope fields
// ---------------------------------------------------------------------------

/**
 * Slope scratch, grown but never shrunk, reused across fields and frames.
 *
 * f is evaluated once per lattice point per frame and the values are kept
 * here, so the paint pass allocates nothing per point — at 4000 points and 60
 * fps a per-point object would be a quarter of a million allocations a second
 * for a picture that never changes shape.
 */
let SLOPES = new Float64Array(0)

function slopeScratch(n: number): Float64Array {
  if (SLOPES.length < n) SLOPES = new Float64Array(n)
  return SLOPES
}

/** The lattice for one field, after the density guard has had its say. */
interface Lattice {
  /** Spacing in CSS px, possibly widened from what the field asked for. */
  spacing: number
  /** Spacing in math units along each axis. */
  hx: number
  hy: number
  /** First lattice index on (or just off) each edge; positions are index*h. */
  i0: number
  j0: number
  nx: number
  ny: number
}

/**
 * Lattice indices covering the viewport, at a spacing wide enough to stay
 * under FIELD_MAX_POINTS.
 *
 * The margin is half a segment, so a point just off the edge still contributes
 * the half of its segment that is on screen and the field runs to the border
 * instead of stopping a spacing short of it.
 */
function latticeFor(fr: Frame, wantPx: number): Lattice {
  let spacing = wantPx
  let hx = 0
  let hy = 0
  let i0 = 0
  let j0 = 0
  let nx = 0
  let ny = 0

  for (let guard = 0; guard < 64; guard++) {
    hx = spacing / fr.ppx
    hy = spacing / fr.ppy
    const margin = (FIELD_SEGMENT_FRACTION / 2) * spacing
    const x0 = fr.cx - (fr.hw + margin) / fr.ppx
    const x1 = fr.cx + (fr.hw + margin) / fr.ppx
    const y0 = fr.cy - (fr.hh + margin) / fr.ppy
    const y1 = fr.cy + (fr.hh + margin) / fr.ppy
    i0 = Math.ceil(x0 / hx)
    j0 = Math.ceil(y0 / hy)
    nx = Math.max(0, Math.floor(x1 / hx) - i0 + 1)
    ny = Math.max(0, Math.floor(y1 / hy) - j0 + 1)
    const total = nx * ny
    if (!Number.isFinite(total) || total <= FIELD_MAX_POINTS) break
    // Widen rather than drop: area scales with spacing², so one sqrt step
    // lands on the cap, and the 1.05 floor guarantees progress.
    spacing *= Math.max(1.05, Math.sqrt(total / FIELD_MAX_POINTS))
  }

  return { spacing, hx, hy, i0, j0, nx, ny }
}

function drawOneField(
  ctx: CanvasRenderingContext2D,
  field: SlopeField,
  fr: Frame,
  strokeScale: number,
  paint: (c: string) => string,
): void {
  const asked =
    typeof field.spacingPx === 'number' && Number.isFinite(field.spacingPx) && field.spacingPx > 0
      ? field.spacingPx
      : FIELD_SPACING_PX
  const lat = latticeFor(fr, asked * strokeScale)
  const n = lat.nx * lat.ny
  if (n <= 0) return

  // Pass 1: evaluate. A throwing f is a NaN like any other — one bad lattice
  // point must not cost the field, let alone the board.
  const slopes = slopeScratch(n)
  const f = field.f
  let k = 0
  for (let j = 0; j < lat.ny; j++) {
    const y = (lat.j0 + j) * lat.hy
    for (let i = 0; i < lat.nx; i++) {
      const x = (lat.i0 + i) * lat.hx
      let m: number
      try {
        m = f(x, y)
      } catch {
        m = Number.NaN
      }
      slopes[k++] = typeof m === 'number' ? m : Number.NaN
    }
  }

  // Pass 2: paint. One path for the whole lattice, one stroke: a single
  // stroke() of one path never double-blends where segments touch, so the
  // field keeps one flat alpha instead of mottling at the crossings.
  const half = (FIELD_SEGMENT_FRACTION / 2) * lat.spacing
  ctx.globalAlpha = FIELD_ALPHA
  ctx.strokeStyle = paint(field.color)
  ctx.lineWidth = FIELD_LINE_WIDTH * strokeScale
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()

  let drew = false
  k = 0
  for (let j = 0; j < lat.ny; j++) {
    const y = (lat.j0 + j) * lat.hy
    const py = fr.hh - (y - fr.cy) * fr.ppy
    for (let i = 0; i < lat.nx; i++) {
      const m = slopes[k++]
      // NaN is "f is not defined here" — leave the point empty, which is the
      // truth. Only ±∞ (and the merely enormous) get the vertical limit.
      if (Number.isNaN(m)) continue
      const x = (lat.i0 + i) * lat.hx
      const px = fr.hw + (x - fr.cx) * fr.ppx
      let dxh: number
      let dyh: number
      if (!Number.isFinite(m) || Math.abs(m) * fr.ppy > VERTICAL_RATIO * fr.ppx) {
        dxh = 0
        dyh = half
      } else {
        // Math (1, m) → screen (ppx, -ppy·m): the minus IS the y-flip, and it
        // is why a positive slope must rise to the RIGHT on a canvas whose y
        // grows downward.
        const ux = fr.ppx
        const uy = -fr.ppy * m
        const len = Math.sqrt(ux * ux + uy * uy)
        if (!(len > 0)) continue
        dxh = (ux / len) * half
        dyh = (uy / len) * half
      }
      ctx.moveTo(px - dxh, py - dyh)
      ctx.lineTo(px + dxh, py + dyh)
      drew = true
    }
  }
  if (drew) ctx.stroke()
  ctx.globalAlpha = 1
}

/**
 * Paint every visible slope field, in the order given.
 *
 * Called under the polylines and the curves: the field is the ground the
 * solution stands on, and a curve whose own stroke were interrupted by the
 * lattice would be unreadable. One bad field never takes the board down.
 */
export function drawSlopeFields(
  ctx: CanvasRenderingContext2D,
  fields: readonly SlopeField[],
  o: FieldPaintOpts,
): void {
  if (fields.length === 0) return
  let any = false
  for (const field of fields) {
    if (field && field.visible && typeof field.f === 'function') {
      any = true
      break
    }
  }
  if (!any) return

  const vp = o.vp
  if (vp.widthPx <= 0 || vp.heightPx <= 0 || !(vp.pxPerUnit > 0)) return
  const fr = frameOf(vp)
  if (!(fr.ppx > 0) || !(fr.ppy > 0)) return
  const { stroke } = paintScale(o.scale)
  const paint = o.paint ?? identity

  ctx.save()
  for (const field of fields) {
    if (!field || !field.visible || typeof field.f !== 'function') continue
    try {
      drawOneField(ctx, field, fr, stroke, paint)
    } catch {
      /* one field failing must not cost the figure */
    }
  }
  ctx.globalAlpha = 1
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Polylines
// ---------------------------------------------------------------------------

/** Pen state for the clipped walk. Module-level, like curves.ts's emitter. */
const PEN = { down: false, drawn: false }

/**
 * Liang–Barsky clip of one segment to the overdraw box, with pen state.
 *
 * Clipping the SEGMENT rather than clamping each endpoint is the same choice
 * curves.ts makes and for the same reason: clamping bends a steep chord toward
 * the corner of the box and moves where it crosses the canvas, while clipping
 * leaves the drawn geometry exactly on the true chord.
 */
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
    const q =
      e === 0 ? x0 - fr.bx0 : e === 1 ? fr.bx1 - x0 : e === 2 ? y0 - fr.by0 : fr.by1 - y0
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
    // the exact endpoint when nothing was trimmed, so consecutive segments
    // share bit-identical join coordinates
    ctx.moveTo(t0 > 0 ? x0 + dx * t0 : x0, t0 > 0 ? y0 + dy * t0 : y0)
  }
  ctx.lineTo(t1 < 1 ? x0 + dx * t1 : x1, t1 < 1 ? y0 + dy * t1 : y1)
  PEN.drawn = true
  PEN.down = t1 >= 1
}

function drawOnePolyline(
  ctx: CanvasRenderingContext2D,
  pl: Polyline,
  fr: Frame,
  strokeScale: number,
  paint: (c: string) => string,
): void {
  const pts = pl.pts
  if (!pts || pts.length < 2) return

  const w =
    (typeof pl.width === 'number' && Number.isFinite(pl.width) && pl.width > 0
      ? pl.width
      : POLYLINE_WIDTH) * strokeScale
  ctx.strokeStyle = paint(pl.color)
  ctx.lineWidth = w
  if (pl.dash && pl.dash.length > 0) ctx.setLineDash(pl.dash.slice())

  ctx.beginPath()
  PEN.down = false
  PEN.drawn = false
  let has = false
  let lastX = 0
  let lastY = 0
  for (const p of pts) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      // A blown-up RK4 step is a genuine hole in the solution, not a place to
      // join across: lift the pen and start again after it.
      has = false
      PEN.down = false
      continue
    }
    const px = fr.hw + (p.x - fr.cx) * fr.ppx
    const py = fr.hh - (p.y - fr.cy) * fr.ppy
    if (has) clipSeg(ctx, fr, lastX, lastY, px, py)
    lastX = px
    lastY = py
    has = true
  }
  if (PEN.drawn) ctx.stroke()
  ctx.setLineDash([])
}

/**
 * Paint every polyline, in the order given.
 *
 * A solution curve is figure content: it is the answer to the differential
 * equation the field poses, and it exports with everything else.
 */
export function drawPolylines(
  ctx: CanvasRenderingContext2D,
  lines: readonly Polyline[],
  o: FieldPaintOpts,
): void {
  if (lines.length === 0) return
  let any = false
  for (const pl of lines) {
    if (pl && pl.pts && pl.pts.length >= 2) {
      any = true
      break
    }
  }
  if (!any) return

  const vp = o.vp
  if (vp.widthPx <= 0 || vp.heightPx <= 0 || !(vp.pxPerUnit > 0)) return
  const fr = frameOf(vp)
  if (!(fr.ppx > 0) || !(fr.ppy > 0)) return
  const { stroke } = paintScale(o.scale)
  const paint = o.paint ?? identity

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const pl of lines) {
    if (!pl) continue
    try {
      drawOnePolyline(ctx, pl, fr, stroke, paint)
    } catch {
      /* one polyline failing must not cost the figure */
    }
  }
  ctx.setLineDash([])
  ctx.restore()
}

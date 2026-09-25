// ============================================================================
// src/render/scatter.ts — (x, y) data as a scatter plot, and its residuals.
//
// A data table (src/core/data.ts) is pasted or typed, and its regression
// becomes an ORDINARY typed curve. What is left for the renderer is the data
// itself: one marker per row, and — when the teacher asks for it — a thin
// vertical segment from each point to the fitted curve, which is what a
// residual IS, drawn.
//
// Three rules this layer is built around:
//
//   The data sits ON TOP of the fitted curve. A class judges a fit by looking
//   at the points against the line, so the markers paint after every curve and
//   before the shapes and the analysis layer. Each filled marker carries a
//   ground-coloured rim so a point on a curve of its own colour is a dot on a
//   line, not a bulge in it (the rule src/render/shapes.ts follows for points).
//
//   Residuals go UNDER the markers. They are half-alpha, one stroke weight
//   thin, and every set's residuals are drawn before any set's markers, so no
//   residual ever crosses a data point.
//
//   A data set is large. Ten thousand rows must draw inside a frame, so every
//   glyph kind of a set is ONE path and one paint — never one path per point —
//   and a point off the board costs two multiplies and a compare.
//
//   And every glyph is FILLED, never stroked, and no subpath is closePath()'d.
//   Measured in Chromium, 10 000 points at DPR 2 (paint + GPU flush): on a
//   GPU canvas the whole layer is 2-6 ms either way, but one closePath() per
//   subpath took 10 000 squares from ~2 ms to ~240 ms — fill() closes each
//   subpath implicitly, so the explicit close buys nothing. On a canvas Chrome
//   has moved to SOFTWARE raster (no GPU, or a page that reads pixels back),
//   one stroke of 10 000 discs costs ~48 ms against ~8 ms for one fill. So a
//   rim is a ground-coloured disc UNDER the ink disc, a ring is an ink disc
//   with a ground disc on top of it, a cross is two filled quads, and a
//   residual is a 1px-wide filled quad — the same pixels a butt-capped
//   stroke covers, at the cost of a fill.
//
// FIGURE, not chrome: the data is what the lesson is about, so it goes through
// the one render routine and reaches the exported PNG unchanged. Nothing in
// this file may ask whether chrome is on.
//
// All drawing units are CSS pixels (ctx is already DPR-scaled by the caller).
// ============================================================================

import type { Theme, Viewport } from '../core/types'
import { paintScale, type PaintScale } from './grid'

/** How one data set's points are drawn. */
export type ScatterMarker = 'dot' | 'ring' | 'cross' | 'square'

/**
 * One data set — a table's x and y columns, drawn as a scatter plot.
 *
 * `xs[i]`, `ys[i]` is row i; the shorter column wins, and a row with a
 * non-finite value in either column is skipped (a blank cell, a "n/a").
 */
export interface ScatterSet {
  id: string
  xs: readonly number[]
  ys: readonly number[]
  /** Screen palette colour; the board maps it to print / mono as it does a curve. */
  color: string
  visible: boolean
  /** Absent = 'dot'. */
  marker?: ScatterMarker
  /**
   * What the set is called ("Table 1", "Lab data"). Not painted on the canvas:
   * it is for the App's card / legend and for accessible text.
   */
  label?: string
  /**
   * A curve id. When it names a VISIBLE EXPLICIT curve in the scene, each point
   * gets a thin vertical segment to that curve's value at its x — the residual.
   * Points where the curve is undefined (outside its domain, a pole) get none.
   */
  residualsTo?: string
}

// ---------------------------------------------------------------------------
// Constants — every length in CSS px BEFORE `present.stroke`.
// ---------------------------------------------------------------------------

/** Marker radius: the College Board dot, and the analysis layer's filled point. */
export const SCATTER_R = 3.5
/** The ground rim outside a filled marker. */
export const SCATTER_RIM = 1.5
/** A 'ring' marker's ink ring. */
export const SCATTER_RING_WIDTH = 1.5
/** A 'cross' marker's two strokes. */
export const SCATTER_CROSS_WIDTH = 2
/** A residual segment. */
export const SCATTER_RESIDUAL_WIDTH = 1
export const SCATTER_RESIDUAL_ALPHA = 0.5
/**
 * Half-side of a 'square' marker, as a fraction of SCATTER_R: the square of
 * the same AREA as the dot (√π / 2), so a set of squares does not read as
 * heavier than a set of dots beside it.
 */
export const SCATTER_SQUARE_HALF = Math.sqrt(Math.PI) / 2

const TWO_PI = Math.PI * 2

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ScatterPaintOpts {
  vp: Viewport
  /** The ground: rims and the inside of a 'ring' marker are painted in it. */
  theme: Theme
  /**
   * The board's ink mapping: screen → print on a light ground, everything →
   * theme.axis under a mono figure style. The SAME function the curves go
   * through, so a data set and the curve fitted to it share a palette.
   */
  paint?: ((c: string) => string) | null
  /** Presentation scale: every radius and weight follows `stroke`. */
  scale?: PaintScale | null
  /**
   * Resolve `residualsTo`: the curve's y at a math x, or null where it is
   * undefined. Returns null for an id that is not a visible explicit curve,
   * in which case the set draws no residuals.
   */
  curveAt?: ((id: string) => ((x: number) => number | null) | null) | null
}

const identity = (c: string): string => c

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

/**
 * Paint every visible data set: all residuals first, then all markers.
 *
 * One bad set never takes the board down, and an empty or all-hidden list
 * issues no command at all — so a board without data draws exactly what it
 * drew before this layer existed.
 */
export function drawScatter(
  ctx: CanvasRenderingContext2D,
  sets: readonly ScatterSet[],
  o: ScatterPaintOpts,
): void {
  if (sets.length === 0) return
  const live = sets.filter(
    (s) => s && s.visible && Array.isArray(s.xs) && Array.isArray(s.ys),
  )
  if (live.length === 0) return
  const vp = o.vp
  if (!(vp.widthPx > 0) || !(vp.heightPx > 0) || !(vp.pxPerUnit > 0)) return

  const { stroke } = paintScale(o.scale)
  const paint = o.paint ?? identity

  ctx.save()
  ctx.setLineDash([])
  ctx.globalAlpha = 1

  // Residuals, every set, before any marker.
  if (o.curveAt) {
    for (const s of live) {
      if (!s.residualsTo) continue
      let f: ((x: number) => number | null) | null = null
      try {
        f = o.curveAt(s.residualsTo)
      } catch {
        f = null
      }
      if (!f) continue
      try {
        drawResiduals(ctx, s, f, vp, paint(s.color), stroke)
      } catch {
        /* the markers still draw */
      }
    }
  }

  for (const s of live) {
    try {
      drawMarkers(ctx, s, vp, paint(s.color), o.theme.bg, stroke)
    } catch {
      /* one bad set must not take the others with it */
    }
  }

  ctx.restore()
}

/**
 * Append one quad (four corners, no closePath) to the current path. Every
 * quad on a path is wound the same way round, so where two overlap — the two
 * arms of a cross — the non-zero fill adds them rather than cancelling.
 */
function quad(
  ctx: CanvasRenderingContext2D,
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
  dx: number, dy: number,
): void {
  ctx.moveTo(ax, ay)
  ctx.lineTo(bx, by)
  ctx.lineTo(cx, cy)
  ctx.lineTo(dx, dy)
}

function drawResiduals(
  ctx: CanvasRenderingContext2D,
  s: ScatterSet,
  f: (x: number) => number | null,
  vp: Viewport,
  color: string,
  stroke: number,
): void {
  const n = Math.min(s.xs.length, s.ys.length)
  const hw = vp.widthPx / 2
  const hh = vp.heightPx / 2
  const ppu = vp.pxPerUnit
  const cx = vp.center.x
  const cy = vp.center.y
  const W = vp.widthPx
  const H = vp.heightPx
  const w = (SCATTER_RESIDUAL_WIDTH * stroke) / 2
  const m = 2 + stroke
  let any = false

  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const x = s.xs[i]
    const y = s.ys[i]
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const sx = hw + (x - cx) * ppu
    // A vertical segment off the left or right of the board is off the board.
    if (sx < -m || sx > W + m) continue
    let fy: number | null
    try {
      fy = f(x)
    } catch {
      fy = null
    }
    if (fy === null || !Number.isFinite(fy)) continue
    let y0 = hh - (y - cy) * ppu
    let y1 = hh - (fy - cy) * ppu
    // Both ends above, or both below: nothing of it shows.
    if ((y0 < -m && y1 < -m) || (y0 > H + m && y1 > H + m)) continue
    // Clamping a VERTICAL segment to the band is exact (it cannot bend), and it
    // keeps a residual to a curve that shoots off to 1e12 a sane coordinate.
    y0 = Math.min(H + m, Math.max(-m, y0))
    y1 = Math.min(H + m, Math.max(-m, y1))
    if (y0 === y1) continue
    // The point's end first, the curve's end second: (sx, y0) → (sx, y1) is
    // the segment's centre line, and the quad is it, one stroke weight wide.
    quad(ctx, sx - w, y0, sx + w, y0, sx + w, y1, sx - w, y1)
    any = true
  }
  if (!any) return
  ctx.globalAlpha = SCATTER_RESIDUAL_ALPHA
  ctx.fillStyle = color
  ctx.fill()
  ctx.globalAlpha = 1
}

function drawMarkers(
  ctx: CanvasRenderingContext2D,
  s: ScatterSet,
  vp: Viewport,
  color: string,
  bg: string,
  stroke: number,
): void {
  const n = Math.min(s.xs.length, s.ys.length)
  if (n === 0) return
  const marker: ScatterMarker =
    s.marker === 'ring' || s.marker === 'cross' || s.marker === 'square' ? s.marker : 'dot'

  const r = SCATTER_R * stroke
  const rim = SCATTER_RIM * stroke
  const hw = vp.widthPx / 2
  const hh = vp.heightPx / 2
  const ppu = vp.pxPerUnit
  const cx = vp.center.x
  const cy = vp.center.y
  // A marker whose whole glyph (rim included) is off the board is not drawn.
  // The cross reaches furthest: its arm tips sit on the corners of the r-box.
  const m = r * Math.SQRT2 + rim + 1
  const x0 = -m
  const x1 = vp.widthPx + m
  const y0 = -m
  const y1 = vp.heightPx + m

  // Screen positions of the points that survive, packed flat: [x0, y0, x1, y1…].
  const P = new Float64Array(2 * n)
  let k = 0
  for (let i = 0; i < n; i++) {
    const x = s.xs[i]
    const y = s.ys[i]
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const sx = hw + (x - cx) * ppu
    if (sx < x0 || sx > x1) continue
    const sy = hh - (y - cy) * ppu
    if (sy < y0 || sy > y1) continue
    P[k++] = sx
    P[k++] = sy
  }
  if (k === 0) return

  const discs = (rad: number, fill: string): void => {
    ctx.beginPath()
    for (let j = 0; j < k; j += 2) {
      ctx.moveTo(P[j] + rad, P[j + 1])
      ctx.arc(P[j], P[j + 1], rad, 0, TWO_PI)
    }
    ctx.fillStyle = fill
    ctx.fill()
  }
  const squares = (h: number, fill: string): void => {
    ctx.beginPath()
    for (let j = 0; j < k; j += 2) {
      const px = P[j]
      const py = P[j + 1]
      quad(ctx, px - h, py - h, px + h, py - h, px + h, py + h, px - h, py + h)
    }
    ctx.fillStyle = fill
    ctx.fill()
  }
  // An × (not a +, which a grid tick already is): two arms from corner to
  // corner of the r-box, each a quad `half` long either side of the centre
  // and `t` thick either side of its centre line — a butt-capped stroke.
  const crosses = (half: number, t: number, fill: string): void => {
    const a = half * Math.SQRT1_2 // along each axis
    const b = t * Math.SQRT1_2
    ctx.beginPath()
    for (let j = 0; j < k; j += 2) {
      const px = P[j]
      const py = P[j + 1]
      // "\" arm, u = (1, 1)/√2, v = (-1, 1)/√2
      quad(ctx, px + a - b, py + a + b, px - a - b, py - a + b, px - a + b, py - a - b, px + a + b, py + a - b)
      // "/" arm, u = (1, -1)/√2, v = (1, 1)/√2 — the same winding
      quad(ctx, px + a + b, py - a + b, px - a + b, py + a + b, px - a - b, py + a - b, px + a - b, py - a - b)
    }
    ctx.fillStyle = fill
    ctx.fill()
  }

  ctx.globalAlpha = 1
  switch (marker) {
    case 'dot':
      // The rim: a ground disc rim-wider than the ink disc, UNDER it, so the
      // disc keeps its full radius and the rim is what separates it from a
      // curve. Every rim goes down before any disc: in a dense cluster the
      // discs merge into one blob of ink instead of punching holes in each other.
      discs(r + rim, bg)
      discs(r, color)
      break
    case 'ring': {
      // An open data point: an ink ring SCATTER_RING_WIDTH wide centred on r,
      // with ground inside it, so the curve behind it is hidden and the ring
      // reads as a ring and not as a crossing.
      const t = (SCATTER_RING_WIDTH * stroke) / 2
      discs(r + t, color)
      discs(r - t, bg)
      break
    }
    case 'square': {
      const h = SCATTER_SQUARE_HALF * r
      squares(h + rim, bg)
      squares(h, color)
      break
    }
    case 'cross': {
      const half = r * Math.SQRT2
      const t = (SCATTER_CROSS_WIDTH * stroke) / 2
      crosses(half + rim, t + rim, bg)
      crosses(half, t, color)
      break
    }
  }
}

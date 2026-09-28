// ============================================================================
// src/render/overlays.ts — filled figure content that sits between the grid
// and the curves.
//
// Three primitives, one paint routine:
//
//   area    the signed region between a curve and the x-axis over [from, to]
//           (or between TWO curves, with `against`). This is what a class sees
//           when the integral sign goes on the board.
//   rects   Riemann rectangles, exactly as src/core/calculus.ts computes them.
//   region  a closed polygon in math coords — the general "shade this region"
//           primitive, for inequalities today and for graphfree's shade-by-
//           point tomorrow. The App builds the boundary; this only fills it.
//   band    the strip between two sampled boundaries over the same x's — a
//           Taylor polynomial's Lagrange error band Pₙ(x) ± R(x). NaN in either
//           boundary breaks the strip, exactly as a pole breaks a stroke.
//   axisStrip  a thick translucent bar ON the x-axis over [from, to], with the
//           number line's own endpoint vocabulary: ● included, ○ excluded, an
//           arrowhead where the interval runs to ±∞ — the interval of
//           convergence of a series, drawn where a class reads intervals.
//
// And two MARKS, painted after the curves rather than under them (a dot under
// a 2.5px stroke is a dot with a line through it):
//
//   segment a straight segment between two math points, optionally dashed —
//           the probe from Pₙ(x) up to f(x), whose length IS the error.
//   dot     one point: filled, or hollow (ground-filled centre, as on the
//           number line, so nothing reads through it).
//   hline   a horizontal line across the whole board at a height — the
//           horizontal line test.
//   line    a straight line of any slope across the whole board, through a
//           point — a secant extended past its two points, the tangent at a
//           Mean Value Theorem c. Optionally dashed, optionally faint.
//   label   a small chip of text beside a math point ("c = 2√3/3"), ground-
//           filled and ringed in its colour, stepped off the point along a
//           stated screen direction.
//
// And one more under the curves:
//
//   ghost   a function's graph, faint and dashed — the part of f a
//           restricted domain cut off, drawn behind the part it kept.
//
// These are FIGURE, not chrome: they carry the mathematics the lesson is
// about, so they go through the one render routine and reach the exported PNG
// unchanged. Nothing in this file may ask whether chrome is on.
//
// Why the area boundary is sampled by curves.ts and not here: shading under
// 1/x on [-1, 1] must break at the pole, exactly where the stroke breaks. Two
// samplers would eventually disagree, and the disagreement is a filled band
// crossing infinity. So the boundary IS the stroke's own polyline.
//
// All drawing units are CSS pixels (ctx is already DPR-scaled by the caller).
// ============================================================================

import type { FittedCurve, ModelSpec, Vec2, Viewport } from '../core/types'
import { ppuX, ppuY } from '../core/types'
import { sampleExplicitPolylines } from './curves'
import { LABEL_PX, gridFont, labelFont, paintScale, type PaintScale } from './grid'

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

/** One Riemann rectangle: [x0, x1] in math units, `height` signed. */
export interface OverlayRect {
  x0: number
  x1: number
  /** f at the rule's sample point. Negative draws BELOW the axis. */
  height: number
}

export type Overlay =
  | {
      kind: 'area'
      /** Which curve bounds the region (FittedCurve.id). */
      curveId: string
      from: number
      to: number
      /**
       * A second curve id. Present: shade BETWEEN the two curves. Absent: the
       * region runs to the x-axis, and the part below the axis shades too —
       * the AP signed-area convention, where the picture shows |∫| as area and
       * the number carries the sign.
       */
      against?: string
      color?: string
      alpha?: number
    }
  | {
      kind: 'rects'
      /** Whose colour the rectangles take; the geometry is entirely in `rects`. */
      curveId: string
      rects: readonly OverlayRect[]
      color?: string
    }
  | {
      kind: 'region'
      /** A closed polygon in MATH coords. The closing edge is implicit. */
      boundary: readonly Vec2[]
      color?: string
      alpha?: number
    }
  | {
      kind: 'band'
      /** Whose colour the band takes. */
      curveId: string
      /** Sample x's, ascending; lo[i] and hi[i] are the band's edges there. */
      xs: readonly number[]
      lo: ArrayLike<number>
      hi: ArrayLike<number>
      color?: string
      alpha?: number
    }
  | {
      kind: 'axisStrip'
      /** Whose colour the strip takes. */
      curveId: string
      /** Either end may be ±Infinity: the strip then runs off the board with an arrow. */
      from: number
      to: number
      /** What each finite end says. 'none' draws the bar's end and no mark. */
      left: StripEnd
      right: StripEnd
      color?: string
      alpha?: number
    }
  | {
      kind: 'segment'
      /** Whose colour it takes, when no colour is stated. */
      curveId?: string
      from: Vec2
      to: Vec2
      dashed?: boolean
      color?: string
      /** Stroke weight in CSS px before `present.stroke`. Absent: MARK_LINE_WIDTH. */
      width?: number
    }
  | {
      kind: 'line'
      /** Whose colour it takes, when no colour is stated. */
      curveId?: string
      /** A point the line passes through, in math units. */
      at: Vec2
      /** dy/dx in math units. */
      slope: number
      dashed?: boolean
      color?: string
      /** Stroke alpha (0–1). Absent: 1. */
      alpha?: number
      /** Stroke weight in CSS px before `present.stroke`. Absent: MARK_LINE_WIDTH. */
      width?: number
    }
  | {
      kind: 'label'
      curveId?: string
      /** The point the chip names, in math units. */
      at: Vec2
      text: string
      /**
       * Which way the chip steps off the point, in SCREEN terms (y down). It is
       * normalised; absent is straight up.
       */
      dir?: Vec2
      /**
       * Step off PERPENDICULAR to a line of this slope (math units) instead —
       * to the side below it when `below`, above it otherwise. The renderer
       * knows the axes' scales, so a chip beside a tangent of slope 4 clears
       * that tangent on a stretched board as well as on a square one.
       */
      across?: { slope: number; below: boolean }
      color?: string
    }
  | {
      kind: 'dot'
      curveId?: string
      at: Vec2
      hollow?: boolean
      color?: string
    }
  | {
      kind: 'hline'
      curveId?: string
      /** The line's height in math units; it runs across the whole board. */
      y: number
      color?: string
      dashed?: boolean
    }
  | {
      kind: 'ghost'
      /** Whose colour it takes, when no colour is stated. */
      curveId?: string
      /** The function to draw — NaN where it is undefined (the pen lifts). */
      f: (x: number) => number
      color?: string
      /** Stroke alpha on screen. Under mono ink the board states its own. */
      alpha?: number
    }

/** An axis strip's endpoint: ● included, ○ excluded, or nothing said. */
export type StripEnd = 'closed' | 'open' | 'none'

/** The overlay kinds painted ON TOP of the curves (see `layer`). */
export const OVERLAY_MARK_KINDS: ReadonlySet<Overlay['kind']> = new Set([
  'segment',
  'dot',
  'hline',
  'line',
  'label',
])

/** True when any of these overlays is a mark — the board then paints in two passes. */
export function hasOverlayMarks(overlays: readonly Overlay[]): boolean {
  return overlays.some((ov) => ov && OVERLAY_MARK_KINDS.has(ov.kind))
}

/** The axis strip's bar weight and its alpha when none is stated, in CSS px. */
export const AXIS_STRIP_WIDTH = 9
export const AXIS_STRIP_ALPHA = 0.38
/** A mark dot's radius and a probe segment's weight, CSS px before `present.stroke`. */
export const MARK_DOT_RADIUS = 4.5
export const MARK_LINE_WIDTH = 1.75

/** A ghost's stroke alpha when none is stated, and under mono ink (grey, still dashed). */
export const GHOST_ALPHA = 0.38
export const GHOST_MONO_ALPHA = 0.5
/** A ghost's stroke weight and dash, CSS px before `present.stroke`. */
export const GHOST_LINE_WIDTH = 2
const GHOST_DASH = [7, 6]
/** The horizontal line test's weight. */
export const HLINE_WIDTH = 2

/** Fill alpha when the overlay does not state one. */
export const OVERLAY_FILL_ALPHA = 0.18
/** Riemann outline weight, in CSS px before `present.stroke`. */
export const OVERLAY_RECT_LINE_WIDTH = 1
/** Colour of last resort — only reached when the named curve is gone. */
const FALLBACK_COLOR = '#8b93b0'
/** A polygon needs this many points before it encloses anything. */
const MIN_REGION_POINTS = 3

export interface OverlayPaintOpts {
  vp: Viewport
  curves: readonly FittedCurve[]
  models: Record<string, ModelSpec>
  /**
   * The board's screen→print colour mapping (identity on a dark ground). The
   * SAME function the curves go through, so a shaded region and the stroke
   * above it can never end up in two different palettes.
   */
  paint?: ((c: string) => string) | null
  /** Presentation scale. Outline weight scales; fill alpha deliberately does not. */
  scale?: PaintScale | null
  /**
   * One fill alpha for every overlay on the board, overriding both the default
   * and any alpha an overlay states for itself.
   *
   * This is the mono-ink figure's grey wash: under `curveInk: 'mono'` every
   * shading is the same black, so the only thing left to separate a shaded
   * region from the curve above it is how light the wash is. Absent (the
   * normal case) leaves every overlay's own alpha exactly as it was.
   */
  fillAlpha?: number | null
  /**
   * The ground colour, for a hollow dot's centre (an excluded endpoint must
   * not let the bar read through it). Absent: the centre is left unfilled.
   */
  bg?: string | null
  /**
   * Which overlays this call paints: 'fills' (everything but the marks —
   * under the curves), 'marks' (segments and dots — over them), or absent for
   * all of them in the order given.
   */
  layer?: 'fills' | 'marks' | null
  /**
   * The figure's label face, for `label` chips. Absent is the sans stack the
   * grid uses; 'serif' is the exam figure.
   */
  font?: 'sans' | 'serif' | null
  /**
   * Every label chip painted is pushed here as its screen box, so a later
   * label layer (the analysis plates) can step around it. Absent: not kept.
   */
  placed?: { x: number; y: number; w: number; h: number }[] | null
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

interface Frame {
  /** Pixels per unit along x and along y (equal on an equal-axes board). */
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

const sx = (fr: Frame, x: number): number => fr.hw + (x - fr.cx) * fr.ppx
const sy = (fr: Frame, y: number): number => fr.hh - (y - fr.cy) * fr.ppy
const mathX = (fr: Frame, px: number): number => fr.cx + (px - fr.hw) / fr.ppx
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/**
 * y = 0 in screen px, held inside the overdraw box.
 *
 * A board scrolled a million units away from the axis would otherwise close
 * every polygon at a coordinate no rasteriser handles gracefully; clamping to
 * the box changes nothing that is on screen, because the box already is.
 */
function axisScreenY(fr: Frame): number {
  return clamp(sy(fr, 0), fr.by0, fr.by1)
}

function explicitEval(
  curve: FittedCurve | undefined,
  models: Record<string, ModelSpec>,
): ((x: number) => number) | null {
  if (!curve || curve.kind !== 'explicit') return null
  const model = models[curve.modelId]
  const f = model?.evalExplicit
  if (!f) return null
  const dom = curve.domain
  return (x: number): number => {
    if (dom && (x < dom[0] || x > dom[1])) return Number.NaN
    return f.call(model, curve.params, x)
  }
}

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------

/** Fill a screen-space polygon. One fill() per closed piece — no smoothing. */
function fillPolygon(
  ctx: CanvasRenderingContext2D,
  pts: readonly Vec2[],
  color: string,
  alpha: number,
): void {
  if (pts.length < MIN_REGION_POINTS) return
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.closePath()
  ctx.fill()
  ctx.globalAlpha = 1
}

/**
 * The shaded area under (or between) curves.
 *
 * `from`/`to` are taken as an interval either way round, intersected with the
 * curve's own domain and with the overdraw box, so an interval that runs off
 * the board costs 160 samples of the part you can see rather than 160 samples
 * of the part you cannot.
 */
function drawArea(
  ctx: CanvasRenderingContext2D,
  ov: Extract<Overlay, { kind: 'area' }>,
  fr: Frame,
  vp: Viewport,
  o: OverlayPaintOpts,
  color: string,
  alpha: number,
): void {
  const curve = o.curves.find((c) => c.id === ov.curveId)
  const top = explicitEval(curve, o.models)
  if (!top) return
  if (!Number.isFinite(ov.from) || !Number.isFinite(ov.to)) return

  let a = Math.min(ov.from, ov.to)
  let b = Math.max(ov.from, ov.to)
  const halfSpan = (1.5 * vp.widthPx) / fr.ppx
  a = Math.max(a, fr.cx - halfSpan)
  b = Math.min(b, fr.cx + halfSpan)
  if (!(b > a)) return

  const bottomCurve = ov.against ? o.curves.find((c) => c.id === ov.against) : undefined
  const bottom = ov.against ? explicitEval(bottomCurve, o.models) : null
  // `against` naming a curve that is gone must not silently become "to the
  // axis": that is a different region and a different number.
  if (ov.against && !bottom) return

  const axisY = axisScreenY(fr)
  const lines = sampleExplicitPolylines(boxed(top, fr), vp, a, b)

  for (const line of lines) {
    if (bottom) {
      for (const piece of strip(line, bottom, fr)) {
        fillPolygon(ctx, piece, color, alpha)
      }
    } else {
      const poly: Vec2[] = line.slice()
      poly.push({ x: line[line.length - 1].x, y: axisY })
      poly.push({ x: line[0].x, y: axisY })
      fillPolygon(ctx, poly, color, alpha)
    }
  }
}

/**
 * The same function, with its VALUE held inside the overdraw box.
 *
 * A stroke that shoots off the canvas may simply be dropped — you cannot see
 * the part that left. A shaded region may not: next to a pole the region's
 * visible part is the full height of the canvas, and culling the boundary
 * segments that leave the box ends the polygon early, leaving a white wedge
 * hugging the asymptote where the shading should run right up to it. Measured
 * on 1/x over [-1, 1] at 60 px/unit: a 7 px unshaded gutter on each side of
 * the pole, widening as the board zooms out.
 *
 * Clamping keeps the x-extent and costs nothing in truth, because every
 * clamped y is already off the canvas. It does NOT paper over the pole: NaN
 * stays NaN, and a jump between the two clamps stays a gap the width of the
 * box, which the discontinuity probe cannot collapse — so the pen still lifts
 * exactly where the stroke lifts it.
 */
function boxed(f: (x: number) => number, fr: Frame): (x: number) => number {
  const yTop = fr.cy + (fr.hh - fr.by0) / fr.ppy
  const yBot = fr.cy + (fr.hh - fr.by1) / fr.ppy
  return (x: number): number => {
    const y = f(x)
    return Number.isFinite(y) ? clamp(y, yBot, yTop) : y
  }
}

/**
 * The strip between a sampled top boundary and a second function.
 *
 * The bottom curve is evaluated at the TOP curve's own sample x's rather than
 * sampled independently: paired samples are what makes a strip a strip. Where
 * the bottom is undefined — a sqrt left of its branch point, a piecewise gap —
 * the strip ends and a new one starts after it, which is the same rule the
 * stroke follows. A bottom that leaps more than the whole canvas between two
 * neighbouring samples is a pole of its own and breaks the strip too.
 */
function strip(
  line: readonly Vec2[],
  bottom: (x: number) => number,
  fr: Frame,
): Vec2[][] {
  const out: Vec2[][] = []
  let topRun: Vec2[] = []
  let botRun: Vec2[] = []
  let prevRaw = Number.NaN
  const jump = 2 * (fr.by1 - fr.by0)

  const flush = (): void => {
    if (topRun.length >= 2) {
      const poly = topRun.slice()
      for (let i = botRun.length - 1; i >= 0; i--) poly.push(botRun[i])
      out.push(poly)
    }
    topRun = []
    botRun = []
    prevRaw = Number.NaN
  }

  for (const p of line) {
    let y: number
    try {
      y = bottom(mathX(fr, p.x))
    } catch {
      y = Number.NaN
    }
    if (!Number.isFinite(y)) {
      flush()
      continue
    }
    const raw = sy(fr, y)
    if (Number.isFinite(prevRaw) && Math.abs(raw - prevRaw) > jump) flush()
    topRun.push(p)
    botRun.push({ x: p.x, y: clamp(raw, fr.by0, fr.by1) })
    prevRaw = raw
  }
  flush()
  return out
}

/**
 * Riemann rectangles: exact math-coordinate rectangles, axis to `height`.
 *
 * Outlined at FULL colour and filled at the same wash as an area, so a bar
 * chart of the same region reads as the same region. `height < 0` needs no
 * special case at all — the axis and the top simply swap sides, which is what
 * a rectangle below the axis IS.
 */
function drawRects(
  ctx: CanvasRenderingContext2D,
  ov: Extract<Overlay, { kind: 'rects' }>,
  fr: Frame,
  color: string,
  strokeScale: number,
): void {
  const axisY = axisScreenY(fr)
  ctx.lineJoin = 'miter'
  for (const r of ov.rects) {
    if (!r || !Number.isFinite(r.x0) || !Number.isFinite(r.x1) || !Number.isFinite(r.height)) {
      continue
    }
    const x0 = sx(fr, Math.min(r.x0, r.x1))
    const x1 = sx(fr, Math.max(r.x0, r.x1))
    if (x1 < fr.bx0 || x0 > fr.bx1) continue // wholly outside the overdraw box
    const topY = clamp(sy(fr, r.height), fr.by0, fr.by1)
    const cx0 = clamp(x0, fr.bx0, fr.bx1)
    const cx1 = clamp(x1, fr.bx0, fr.bx1)

    ctx.beginPath()
    ctx.moveTo(cx0, axisY)
    ctx.lineTo(cx0, topY)
    ctx.lineTo(cx1, topY)
    ctx.lineTo(cx1, axisY)
    ctx.closePath()

    ctx.globalAlpha = OVERLAY_FILL_ALPHA
    ctx.fillStyle = color
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = color
    ctx.lineWidth = OVERLAY_RECT_LINE_WIDTH * strokeScale
    ctx.stroke()
  }
}

/**
 * The strip between two sampled edges: one polygon per run of samples where
 * both edges are finite, each edge held inside the overdraw box (a band next
 * to a pole is the full height of the canvas, not a wedge that stops short).
 */
function drawBand(
  ctx: CanvasRenderingContext2D,
  ov: Extract<Overlay, { kind: 'band' }>,
  fr: Frame,
  color: string,
  alpha: number,
): void {
  const n = Math.min(ov.xs.length, ov.lo.length, ov.hi.length)
  let top: Vec2[] = []
  let bot: Vec2[] = []
  const flush = (): void => {
    if (top.length >= 2) {
      const poly = top.slice()
      for (let i = bot.length - 1; i >= 0; i--) poly.push(bot[i])
      fillPolygon(ctx, poly, color, alpha)
    }
    top = []
    bot = []
  }
  for (let i = 0; i < n; i++) {
    const x = ov.xs[i]
    const a = ov.lo[i]
    const b = ov.hi[i]
    if (!Number.isFinite(x) || !Number.isFinite(a) || !Number.isFinite(b)) {
      flush()
      continue
    }
    const px = clamp(sx(fr, x), fr.bx0, fr.bx1)
    top.push({ x: px, y: clamp(sy(fr, Math.max(a, b)), fr.by0, fr.by1) })
    bot.push({ x: px, y: clamp(sy(fr, Math.min(a, b)), fr.by0, fr.by1) })
  }
  flush()
}

/** A filled arrowhead pointing along ±x, its tip at (x, y). */
function arrowTip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dir: -1 | 1,
  len: number,
  half: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x - dir * len, y - half)
  ctx.lineTo(x - dir * len, y + half)
  ctx.closePath()
  ctx.fill()
}

/** ● or ○ at a screen point — hollow is ground-filled first, as on the number line. */
function markDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  hollow: boolean,
  bg: string | null | undefined,
  ring: number,
): void {
  ctx.globalAlpha = 1
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  if (hollow) {
    if (bg) {
      ctx.fillStyle = bg
      ctx.fill()
    }
    ctx.lineWidth = ring
    ctx.strokeStyle = color
    ctx.stroke()
  } else {
    ctx.fillStyle = color
    ctx.fill()
  }
}

/**
 * The interval of convergence, ON the x-axis: a thick translucent bar with the
 * number line's endpoint marks — ● included, ○ excluded — and an arrowhead
 * where the interval runs to ±∞ (to the board's own edge).
 */
function drawAxisStrip(
  ctx: CanvasRenderingContext2D,
  ov: Extract<Overlay, { kind: 'axisStrip' }>,
  fr: Frame,
  vp: Viewport,
  color: string,
  alpha: number,
  stroke: number,
  bg: string | null | undefined,
): void {
  const lo = Math.min(ov.from, ov.to)
  const hi = Math.max(ov.from, ov.to)
  if (Number.isNaN(lo) || Number.isNaN(hi) || !(hi >= lo)) return
  const y = sy(fr, 0)
  // The axis is off the board: there is nowhere to read the interval from.
  if (y < -AXIS_STRIP_WIDTH * stroke || y > vp.heightPx + AXIS_STRIP_WIDTH * stroke) return
  const w = AXIS_STRIP_WIDTH * stroke
  const tipLen = w * 1.3
  const infLo = lo === -Infinity
  const infHi = hi === Infinity
  const a = infLo ? 2 : clamp(sx(fr, lo), fr.bx0, fr.bx1)
  const b = infHi ? vp.widthPx - 2 : clamp(sx(fr, hi), fr.bx0, fr.bx1)
  if (b < 0 || a > vp.widthPx) return
  const barA = infLo ? a + tipLen - 1 : a
  const barB = infHi ? b - tipLen + 1 : b
  ctx.globalAlpha = alpha
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = w
  ctx.lineCap = 'butt'
  if (barB > barA) {
    ctx.beginPath()
    ctx.moveTo(barA, y)
    ctx.lineTo(barB, y)
    ctx.stroke()
  }
  // Arrowheads and endpoint marks at full strength: they are the statement.
  ctx.globalAlpha = 1
  if (infLo) arrowTip(ctx, a, y, -1, tipLen, w * 0.9 + 2)
  if (infHi) arrowTip(ctx, b, y, 1, tipLen, w * 0.9 + 2)
  const r = Math.max(MARK_DOT_RADIUS * stroke, w * 0.62)
  const ring = Math.max(2, w * 0.3)
  if (!infLo && ov.left !== 'none') markDot(ctx, a, y, r, color, ov.left === 'open', bg, ring)
  if (!infHi && ov.right !== 'none') markDot(ctx, b, y, r, color, ov.right === 'open', bg, ring)
}

/** A straight segment between two math points, clipped to the overdraw box. */
function drawSegment(
  ctx: CanvasRenderingContext2D,
  ov: Extract<Overlay, { kind: 'segment' }>,
  fr: Frame,
  color: string,
  stroke: number,
): void {
  const { from, to } = ov
  if (![from.x, from.y, to.x, to.y].every(Number.isFinite)) return
  ctx.globalAlpha = 1
  ctx.strokeStyle = color
  const w = typeof ov.width === 'number' && Number.isFinite(ov.width) && ov.width > 0 ? ov.width : MARK_LINE_WIDTH
  ctx.lineWidth = w * stroke
  ctx.lineCap = 'round'
  if (ov.dashed) ctx.setLineDash([5 * stroke, 4 * stroke])
  ctx.beginPath()
  ctx.moveTo(clamp(sx(fr, from.x), fr.bx0, fr.bx1), clamp(sy(fr, from.y), fr.by0, fr.by1))
  ctx.lineTo(clamp(sx(fr, to.x), fr.bx0, fr.bx1), clamp(sy(fr, to.y), fr.by0, fr.by1))
  ctx.stroke()
  if (ov.dashed) ctx.setLineDash([])
}

/**
 * A straight line through `at` with slope `slope`, across the whole board.
 *
 * Clipped analytically to the visible x-range (padded) BEFORE projecting, and
 * never by clamping the two ends separately — that would bend the line.
 */
function drawLine(
  ctx: CanvasRenderingContext2D,
  ov: Extract<Overlay, { kind: 'line' }>,
  fr: Frame,
  vp: Viewport,
  color: string,
  stroke: number,
): void {
  const { at, slope } = ov
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y) || !Number.isFinite(slope)) return
  const pad = 0.1 * vp.widthPx
  const x0 = mathX(fr, -pad)
  const x1 = mathX(fr, vp.widthPx + pad)
  const y0 = at.y + slope * (x0 - at.x)
  const y1 = at.y + slope * (x1 - at.x)
  let p0 = { x: sx(fr, x0), y: sy(fr, y0) }
  let p1 = { x: sx(fr, x1), y: sy(fr, y1) }
  // Clip in screen space against the overdraw band in y, keeping the direction.
  const clipY = (p: Vec2, q: Vec2, yLim: number): Vec2 => {
    const t = (yLim - p.y) / (q.y - p.y)
    return { x: p.x + t * (q.x - p.x), y: yLim }
  }
  for (const lim of [fr.by0, fr.by1]) {
    const out0 = lim === fr.by0 ? p0.y < lim : p0.y > lim
    const out1 = lim === fr.by0 ? p1.y < lim : p1.y > lim
    if (out0 && out1) return
    if (out0) p0 = clipY(p0, p1, lim)
    else if (out1) p1 = clipY(p1, p0, lim)
  }
  if (![p0.x, p0.y, p1.x, p1.y].every(Number.isFinite)) return
  const alpha = typeof ov.alpha === 'number' && Number.isFinite(ov.alpha) ? clamp(ov.alpha, 0, 1) : 1
  const w = typeof ov.width === 'number' && Number.isFinite(ov.width) && ov.width > 0 ? ov.width : MARK_LINE_WIDTH
  ctx.globalAlpha = alpha
  ctx.strokeStyle = color
  ctx.lineWidth = w * stroke
  ctx.lineCap = 'butt'
  if (ov.dashed) ctx.setLineDash([7 * stroke, 5 * stroke])
  ctx.beginPath()
  ctx.moveTo(p0.x, p0.y)
  ctx.lineTo(p1.x, p1.y)
  ctx.stroke()
  if (ov.dashed) ctx.setLineDash([])
  ctx.globalAlpha = 1
}

/** A label chip's height and padding, in CSS px before `present.type`. */
export const LABEL_CHIP_H = 17
const LABEL_CHIP_PAD = 5
const LABEL_CHIP_GAP = 5

/**
 * A chip of text stepped off a math point along `dir` (screen terms): ground
 * fill, a hairline ring in the colour, the text in the colour. The step clears
 * the mark dot and half the chip along that direction, so the chip never sits
 * on the point it names.
 */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  ov: Extract<Overlay, { kind: 'label' }>,
  fr: Frame,
  vp: Viewport,
  color: string,
  scale: { type: number; stroke: number },
  bg: string | null | undefined,
  font: 'sans' | 'serif' | null | undefined,
  placed: { x: number; y: number; w: number; h: number }[] | null | undefined,
): void {
  const text = typeof ov.text === 'string' ? ov.text : ''
  if (!text || !Number.isFinite(ov.at.x) || !Number.isFinite(ov.at.y)) return
  const px = sx(fr, ov.at.x)
  const py = sy(fr, ov.at.y)
  if (px < -40 || py < -40 || px > vp.widthPx + 40 || py > vp.heightPx + 40) return
  const type = scale.type
  ctx.font = font ? labelFont({ font }, LABEL_PX * type) : gridFont(LABEL_PX * type)
  const w = ctx.measureText(text).width + 2 * LABEL_CHIP_PAD * type
  const h = LABEL_CHIP_H * type
  let raw = ov.dir ?? { x: 0, y: -1 }
  if (ov.across && Number.isFinite(ov.across.slope)) {
    // Screen tangent (ppx, −m·ppy); its normal (m·ppy, ppx) points DOWN the screen.
    const n = { x: ov.across.slope * fr.ppy, y: fr.ppx }
    raw = ov.across.below ? n : { x: -n.x, y: -n.y }
  }
  const len = Math.hypot(raw.x, raw.y)
  const d = len > 0 && Number.isFinite(len) ? { x: raw.x / len, y: raw.y / len } : { x: 0, y: -1 }
  const r = MARK_DOT_RADIUS * scale.stroke
  const step = r + Math.abs(d.x) * (w / 2) + Math.abs(d.y) * (h / 2) + LABEL_CHIP_GAP * type
  let x = px + d.x * step - w / 2
  let y = py + d.y * step - h / 2
  // Kept on the board: a chip half off the edge is a chip nobody can read.
  x = clamp(x, 2, Math.max(2, vp.widthPx - w - 2))
  y = clamp(y, 2, Math.max(2, vp.heightPx - h - 2))
  const rr = 4 * type
  ctx.globalAlpha = 1
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
  if (bg) {
    ctx.fillStyle = bg
    ctx.fill()
  }
  ctx.lineWidth = 1 * scale.stroke
  ctx.strokeStyle = color
  ctx.stroke()
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(text, x + LABEL_CHIP_PAD * type, y + h / 2)
  placed?.push({ x, y, w, h })
}

/** A horizontal line across the whole board, at math height `y`. */
function drawHLine(
  ctx: CanvasRenderingContext2D,
  ov: Extract<Overlay, { kind: 'hline' }>,
  fr: Frame,
  vp: Viewport,
  color: string,
  stroke: number,
): void {
  if (!Number.isFinite(ov.y)) return
  const y = sy(fr, ov.y)
  if (y < -8 || y > vp.heightPx + 8) return
  ctx.globalAlpha = 1
  ctx.strokeStyle = color
  ctx.lineWidth = HLINE_WIDTH * stroke
  ctx.lineCap = 'butt'
  if (ov.dashed) ctx.setLineDash([8 * stroke, 5 * stroke])
  ctx.beginPath()
  ctx.moveTo(0, y)
  ctx.lineTo(vp.widthPx, y)
  ctx.stroke()
  if (ov.dashed) ctx.setLineDash([])
}

/** A function's graph, faint and dashed, over the visible x-range (padded). */
function drawGhost(
  ctx: CanvasRenderingContext2D,
  ov: Extract<Overlay, { kind: 'ghost' }>,
  fr: Frame,
  vp: Viewport,
  color: string,
  alpha: number,
  stroke: number,
): void {
  if (typeof ov.f !== 'function') return
  const halfSpan = (0.6 * vp.widthPx) / fr.ppx
  const lines = sampleExplicitPolylines(boxed(ov.f, fr), vp, fr.cx - halfSpan, fr.cx + halfSpan)
  if (lines.length === 0) return
  ctx.globalAlpha = alpha
  ctx.strokeStyle = color
  ctx.lineWidth = GHOST_LINE_WIDTH * stroke
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'round'
  ctx.setLineDash(GHOST_DASH.map((d) => d * stroke))
  for (const line of lines) {
    ctx.beginPath()
    ctx.moveTo(line[0].x, line[0].y)
    for (let i = 1; i < line.length; i++) ctx.lineTo(line[i].x, line[i].y)
    ctx.stroke()
  }
  ctx.setLineDash([])
  ctx.globalAlpha = 1
}

/**
 * Paint every overlay, in the order given, into the current transform.
 *
 * Called between the grid and the curves so a curve's own stroke lands on top
 * of its own shading. One bad overlay never takes the board down: each is
 * painted inside its own try, because a teacher mid-lesson would rather lose
 * one shaded region than the whole figure.
 */
export function drawOverlays(
  ctx: CanvasRenderingContext2D,
  overlays: readonly Overlay[],
  o: OverlayPaintOpts,
): void {
  if (overlays.length === 0) return
  const vp = o.vp
  if (vp.widthPx <= 0 || vp.heightPx <= 0 || !(vp.pxPerUnit > 0)) return
  const fr = frameOf(vp)
  const ps = paintScale(o.scale)
  const { stroke } = ps
  // Explicit colours go through the board's mapping too: toPrintColor passes
  // an unknown colour straight through, so this only ever helps a palette
  // colour the App picked, and it keeps overlay and stroke in one palette.
  const paint = o.paint ?? ((c: string): string => c)

  const layer = o.layer ?? null

  ctx.save()
  for (const ov of overlays) {
    if (!ov) continue
    if (layer !== null && OVERLAY_MARK_KINDS.has(ov.kind) !== (layer === 'marks')) continue
    try {
      const forced =
        typeof o.fillAlpha === 'number' && Number.isFinite(o.fillAlpha)
          ? clamp(o.fillAlpha, 0, 1)
          : null
      const alpha =
        forced !== null
          ? forced
          : ov.kind === 'rects' ||
              ov.kind === 'segment' ||
              ov.kind === 'dot' ||
              ov.kind === 'hline' ||
              ov.kind === 'line' ||
              ov.kind === 'label'
          ? OVERLAY_FILL_ALPHA
          : clamp(
              typeof ov.alpha === 'number' && Number.isFinite(ov.alpha)
                ? ov.alpha
                : OVERLAY_FILL_ALPHA,
              0,
              1,
            )
      const named =
        ov.kind === 'region' || ov.curveId === undefined
          ? undefined
          : o.curves.find((c) => c.id === ov.curveId)
      const color = paint(ov.color ?? named?.color ?? FALLBACK_COLOR)

      switch (ov.kind) {
        case 'area':
          drawArea(ctx, ov, fr, vp, o, color, alpha)
          break
        case 'rects':
          drawRects(ctx, ov, fr, color, stroke)
          break
        case 'band':
          drawBand(ctx, ov, fr, color, alpha)
          break
        case 'axisStrip': {
          // Its own, stronger default: a bar on the axis at the area's 0.18
          // would vanish into the axis line it sits on.
          const own =
            forced !== null
              ? forced
              : typeof ov.alpha === 'number' && Number.isFinite(ov.alpha)
                ? clamp(ov.alpha, 0, 1)
                : AXIS_STRIP_ALPHA
          drawAxisStrip(ctx, ov, fr, vp, color, own, stroke, o.bg)
          break
        }
        case 'segment':
          drawSegment(ctx, ov, fr, color, stroke)
          break
        case 'hline':
          drawHLine(ctx, ov, fr, vp, color, stroke)
          break
        case 'line':
          drawLine(ctx, ov, fr, vp, color, stroke)
          break
        case 'label':
          drawLabel(ctx, ov, fr, vp, color, ps, o.bg, o.font, o.placed)
          break
        case 'ghost': {
          // Faint on screen; under mono ink a grey that survives a copier.
          const own =
            forced !== null
              ? GHOST_MONO_ALPHA
              : typeof ov.alpha === 'number' && Number.isFinite(ov.alpha)
                ? clamp(ov.alpha, 0, 1)
                : GHOST_ALPHA
          drawGhost(ctx, ov, fr, vp, color, own, stroke)
          break
        }
        case 'dot': {
          const p = ov.at
          if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) break
          const x = sx(fr, p.x)
          const y = sy(fr, p.y)
          if (x < fr.bx0 || x > fr.bx1 || y < fr.by0 || y > fr.by1) break
          markDot(ctx, x, y, MARK_DOT_RADIUS * stroke, color, ov.hollow === true, o.bg, 2 * stroke)
          break
        }
        case 'region': {
          const pts: Vec2[] = []
          for (const p of ov.boundary) {
            if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
            pts.push({
              x: clamp(sx(fr, p.x), fr.bx0, fr.bx1),
              y: clamp(sy(fr, p.y), fr.by0, fr.by1),
            })
          }
          fillPolygon(ctx, pts, color, alpha)
          break
        }
      }
    } catch {
      /* one overlay failing must not cost the figure */
    }
  }
  ctx.globalAlpha = 1
  ctx.restore()
}

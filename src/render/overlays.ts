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
import { sampleExplicitPolylines } from './curves'
import { paintScale, type PaintScale } from './grid'

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
}

// ---------------------------------------------------------------------------
// Geometry helpers
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

const sx = (fr: Frame, x: number): number => fr.hw + (x - fr.cx) * fr.ppu
const sy = (fr: Frame, y: number): number => fr.hh - (y - fr.cy) * fr.ppu
const mathX = (fr: Frame, px: number): number => fr.cx + (px - fr.hw) / fr.ppu
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
  const halfSpan = (1.5 * vp.widthPx) / fr.ppu
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
  const yTop = fr.cy + (fr.hh - fr.by0) / fr.ppu
  const yBot = fr.cy + (fr.hh - fr.by1) / fr.ppu
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
  const { stroke } = paintScale(o.scale)
  // Explicit colours go through the board's mapping too: toPrintColor passes
  // an unknown colour straight through, so this only ever helps a palette
  // colour the App picked, and it keeps overlay and stroke in one palette.
  const paint = o.paint ?? ((c: string): string => c)

  ctx.save()
  for (const ov of overlays) {
    if (!ov) continue
    try {
      const alpha =
        ov.kind === 'rects'
          ? OVERLAY_FILL_ALPHA
          : clamp(
              typeof ov.alpha === 'number' && Number.isFinite(ov.alpha)
                ? ov.alpha
                : OVERLAY_FILL_ALPHA,
              0,
              1,
            )
      const named = ov.kind === 'region' ? undefined : o.curves.find((c) => c.id === ov.curveId)
      const color = paint(ov.color ?? named?.color ?? FALLBACK_COLOR)

      switch (ov.kind) {
        case 'area':
          drawArea(ctx, ov, fr, vp, o, color, alpha)
          break
        case 'rects':
          drawRects(ctx, ov, fr, color, stroke)
          break
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

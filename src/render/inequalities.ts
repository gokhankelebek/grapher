// ============================================================================
// src/render/inequalities.ts — shading and boundaries of 2-D inequalities.
//
// A typed inequality is a curve whose model answers `inequality(params)`
// (src/core/types.ts). The board draws, for each visible one:
//
//   the REGION   a light wash of the curve's colour (the grey mono wash under
//                SAT / AP), painted under every curve; with the system's
//                "solution region" on, each inequality's own wash is dimmed
//                and the region common to all of them is painted stronger
//                and hatched — the picture a textbook prints;
//   the BOUNDARY solid for ≤ ≥, dashed for < > — per part, so the compound
//                2 < y ≤ x + 3 is one dashed and one solid line. A y = f(x)
//                boundary is stroked by the ordinary explicit sampler (poles
//                lift the pen, exactly as for the curve); x = c is a line; an
//                implicit F = 0 is a chained contour so the dash runs round
//                the whole circle instead of restarting every 10 px.
//
// Regions and contours are CACHED per (model, params, viewport): a slider
// drag or a pan recomputes once per new view, a redraw with nothing changed
// (hover, selection, a playing animation elsewhere) costs a map lookup.
// Everything goes through ctx path calls, so the vector exporters (which
// replay this very renderer through src/render/vectorCtx.ts) get the same
// polygons.
// ============================================================================

import type { FittedCurve, IneqPart, InequalityInfo, ModelSpec, Vec2, Viewport } from '../core/types'
import { ppuX, ppuY } from '../core/types'
import { contourPolylines, regionPolygons } from '../core/inequality2d'
import type { Box } from '../core/inequality2d'
import { HALO_ALPHA_DARK, HALO_ALPHA_LIGHT, curveLineWidth, drawCurve } from './curves'

/** Wash alphas: one inequality, dimmed under a solution region, the solution itself. */
export const INEQ_FILL_ALPHA = 0.16
export const INEQ_DIM_ALPHA = 0.06
export const INEQ_SOLUTION_ALPHA = 0.2
/** Under mono ink (SAT / AP): a grey that photocopies. */
export const INEQ_MONO_ALPHA = 0.12
export const INEQ_MONO_DIM_ALPHA = 0.05
export const INEQ_MONO_SOLUTION_ALPHA = 0.2
/** The strict boundary's dash, CSS px before presentation scaling. */
export const INEQ_DASH: readonly number[] = [9, 6]
/** Hatch spacing and weight, CSS px. */
const HATCH_GAP = 9
const HATCH_WIDTH = 1.1
const HATCH_ALPHA = 0.55

/** The inequality a curve states at its params, or null. Never throws. */
export function inequalityOf(curve: FittedCurve, models: Record<string, ModelSpec>): InequalityInfo | null {
  const m = models[curve.modelId]
  if (!m || typeof m.inequality !== 'function') return null
  try {
    return m.inequality(curve.params) ?? null
  } catch {
    return null
  }
}

/** True when this curve is a typed inequality. */
export function isInequalityCurve(curve: FittedCurve, models: Record<string, ModelSpec>): boolean {
  return typeof models[curve.modelId]?.inequality === 'function'
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_MAX = 64
const cache = new Map<string, Vec2[][]>()

function remember(key: string, make: () => Vec2[][]): Vec2[][] {
  const got = cache.get(key)
  if (got) {
    cache.delete(key)
    cache.set(key, got)
    return got
  }
  const v = make()
  cache.set(key, v)
  if (cache.size > CACHE_MAX) {
    const first = cache.keys().next().value
    if (first !== undefined) cache.delete(first)
  }
  return v
}

/** Tests only. */
export function clearInequalityCache(): void {
  cache.clear()
}

function vpKey(vp: Viewport): string {
  return `${vp.center.x},${vp.center.y},${ppuX(vp)},${ppuY(vp)},${vp.widthPx},${vp.heightPx}`
}

/**
 * A fingerprint of the parts' functions: what they ARE, not what they are
 * called — a line that calls f(x) changes when f does, with the same params.
 */
function fingerprint(parts: readonly IneqPart[]): string {
  const probe = (p: IneqPart, x: number, y: number): string => {
    try {
      const v = p.s(x, y)
      return Number.isFinite(v) ? v.toPrecision(12) : String(v)
    } catch {
      return 'e'
    }
  }
  return parts
    .map((p) => `${p.boundary.kind}${p.side}${p.strict ? 's' : ''}:${probe(p, 0.3137, 0.2718)}:${probe(p, -1.414, 2.236)}:${probe(p, 2.71, -3.3)}`)
    .join('/')
}

/** The visible math box, padded a few px so polygon edges stay off the board. */
function boxOf(vp: Viewport, padPx = 6): Box {
  const px = ppuX(vp)
  const py = ppuY(vp)
  return {
    x0: vp.center.x - (vp.widthPx / 2 + padPx) / px,
    x1: vp.center.x + (vp.widthPx / 2 + padPx) / px,
    y0: vp.center.y - (vp.heightPx / 2 + padPx) / py,
    y1: vp.center.y + (vp.heightPx / 2 + padPx) / py,
  }
}

/** The region of these parts on this view, as math-coord polygons (cached). */
export function regionOnView(parts: readonly IneqPart[], vp: Viewport): Vec2[][] {
  if (parts.length === 0 || !(vp.widthPx > 0) || !(vp.heightPx > 0)) return []
  const key = `r|${fingerprint(parts)}|${vpKey(vp)}`
  return remember(key, () =>
    regionPolygons(parts, boxOf(vp), {
      cols: Math.ceil(vp.widthPx / 2) + 2,
      rows: Math.ceil(vp.heightPx / 4) + 2,
    }),
  )
}

/** F = 0 on this view as math-coord polylines (cached). */
function contourOnView(part: IneqPart, vp: Viewport): Vec2[][] {
  const b = part.boundary
  if (b.kind !== 'implicit') return []
  const key = `c|${fingerprint([part])}|${vpKey(vp)}`
  return remember(key, () =>
    contourPolylines(b.F, boxOf(vp, 12), Math.ceil(vp.widthPx / 5) + 2, Math.ceil(vp.heightPx / 5) + 2),
  )
}

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------

function toPx(vp: Viewport): (p: Vec2) => Vec2 {
  const px = ppuX(vp)
  const py = ppuY(vp)
  const hw = vp.widthPx / 2
  const hh = vp.heightPx / 2
  const cx = vp.center.x
  const cy = vp.center.y
  return (p) => ({ x: hw + (p.x - cx) * px, y: hh - (p.y - cy) * py })
}

function tracePolys(ctx: CanvasRenderingContext2D, polys: readonly Vec2[][], vp: Viewport): void {
  const S = toPx(vp)
  ctx.beginPath()
  for (const poly of polys) {
    if (poly.length < 3) continue
    const p0 = S(poly[0])
    ctx.moveTo(p0.x, p0.y)
    for (let i = 1; i < poly.length; i++) {
      const p = S(poly[i])
      ctx.lineTo(p.x, p.y)
    }
    ctx.closePath()
  }
}

/** One fill() for the whole region: abutting polygons join without seams. */
export function fillRegion(
  ctx: CanvasRenderingContext2D,
  polys: readonly Vec2[][],
  vp: Viewport,
  color: string,
  alpha: number,
): void {
  if (polys.length === 0) return
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  tracePolys(ctx, polys, vp)
  ctx.fill()
  ctx.restore()
}

/** Diagonal hatching clipped to the region. */
export function hatchRegion(
  ctx: CanvasRenderingContext2D,
  polys: readonly Vec2[][],
  vp: Viewport,
  color: string,
  alpha: number,
  stroke: number,
): void {
  if (polys.length === 0) return
  const S = toPx(vp)
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const poly of polys) {
    for (const q of poly) {
      const p = S(q)
      if (p.x < x0) x0 = p.x
      if (p.x > x1) x1 = p.x
      if (p.y < y0) y0 = p.y
      if (p.y > y1) y1 = p.y
    }
  }
  x0 = Math.max(x0, -2)
  x1 = Math.min(x1, vp.widthPx + 2)
  y0 = Math.max(y0, -2)
  y1 = Math.min(y1, vp.heightPx + 2)
  if (!(x1 > x0) || !(y1 > y0)) return
  ctx.save()
  tracePolys(ctx, polys, vp)
  ctx.clip()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = color
  ctx.lineWidth = HATCH_WIDTH * stroke
  ctx.setLineDash([])
  const gap = HATCH_GAP * stroke
  ctx.beginPath()
  // Lines x − y = k (screen, rising to the right), k spaced by gap·√2.
  const step = gap * Math.SQRT2
  const k0 = Math.floor((x0 - y1) / step) * step
  for (let k = k0; k <= x1 - y0; k += step) {
    ctx.moveTo(k + y0, y0)
    ctx.lineTo(k + y1, y1)
  }
  ctx.stroke()
  ctx.restore()
}

export interface ShadingOpts {
  /** The board's colour mapping (print palette / mono ink). */
  ink: (c: string) => string
  mono: boolean
  /** The system's "solution region" is on. */
  solution: boolean
  /** Colour of the solution region's wash and hatch. */
  solutionColor: string
  stroke: number
}

/**
 * Every visible inequality's wash, then — with the solution region on and at
 * least two inequalities — the common region, stronger and hatched.
 */
export function drawInequalityShading(
  ctx: CanvasRenderingContext2D,
  curves: readonly FittedCurve[],
  models: Record<string, ModelSpec>,
  vp: Viewport,
  o: ShadingOpts,
): void {
  const live: { curve: FittedCurve; info: InequalityInfo }[] = []
  for (const c of curves) {
    if (!c.visible) continue
    const info = inequalityOf(c, models)
    if (info && info.parts.length > 0) live.push({ curve: c, info })
  }
  if (live.length === 0) return
  const system = o.solution && live.length >= 2
  const own = o.mono
    ? system
      ? INEQ_MONO_DIM_ALPHA
      : INEQ_MONO_ALPHA
    : system
      ? INEQ_DIM_ALPHA
      : INEQ_FILL_ALPHA
  for (const { curve, info } of live) {
    try {
      fillRegion(ctx, regionOnView(info.parts, vp), vp, o.ink(curve.color), own)
    } catch {
      /* one region failing must not cost the figure */
    }
  }
  if (!system) return
  try {
    const all = live.flatMap((l) => l.info.parts)
    const polys = regionOnView(all, vp)
    fillRegion(ctx, polys, vp, o.solutionColor, o.mono ? INEQ_MONO_SOLUTION_ALPHA : INEQ_SOLUTION_ALPHA)
    hatchRegion(ctx, polys, vp, o.solutionColor, HATCH_ALPHA, o.stroke)
  } catch {
    /* ditto */
  }
}

export interface BoundaryOpts {
  selected: boolean
  strokeScale: number
  lightGround: boolean
  /** A dash the teacher set on this curve: it wins over the strict dash. */
  userDash?: readonly number[] | null
}

function strokePolylines(
  ctx: CanvasRenderingContext2D,
  lines: readonly Vec2[][],
  vp: Viewport,
  color: string,
  width: number,
  dash: readonly number[],
  o: BoundaryOpts,
): void {
  const S = toPx(vp)
  const trace = (): void => {
    ctx.beginPath()
    for (const line of lines) {
      if (line.length < 2) continue
      const p0 = S(line[0])
      ctx.moveTo(p0.x, p0.y)
      for (let i = 1; i < line.length; i++) {
        const p = S(line[i])
        ctx.lineTo(p.x, p.y)
      }
    }
  }
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = color
  if (o.selected) {
    ctx.setLineDash([])
    ctx.globalAlpha = o.lightGround ? HALO_ALPHA_LIGHT : HALO_ALPHA_DARK
    ctx.lineWidth = width * 3
    trace()
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  ctx.setLineDash(dash.slice())
  ctx.lineWidth = width
  trace()
  ctx.stroke()
  ctx.restore()
}

/**
 * The boundaries of one inequality curve, each solid or dashed by its own
 * strictness. `curve` arrives already painted (its colour and width are the
 * figure's); `models` is the board's.
 */
export function drawInequalityBoundaries(
  ctx: CanvasRenderingContext2D,
  curve: FittedCurve,
  info: InequalityInfo,
  models: Record<string, ModelSpec>,
  vp: Viewport,
  o: BoundaryOpts,
): void {
  const sc = Math.min(6, Math.max(0.5, o.strokeScale || 1))
  const width = curveLineWidth(curve, sc)
  const model = models[curve.modelId]
  for (const part of info.parts) {
    const dash =
      o.userDash && o.userDash.length > 0 ? o.userDash : part.strict ? INEQ_DASH.map((d) => d * sc) : []
    const b = part.boundary
    try {
      if (b.kind === 'y') {
        // The curve's own explicit model when it IS this boundary (holes and
        // poles handled exactly as for any typed y = f(x)); a stand-in
        // otherwise (one side of a compound band).
        const own = info.parts.length === 1 && model?.kind === 'explicit' && curve.kind === 'explicit'
        const f = b.f
        const stand: ModelSpec = {
          id: '__ineq_boundary__',
          kind: 'explicit',
          name: 'Boundary',
          evalExplicit: (_p, x) => f(x),
          latex: () => '',
          paramMeta: () => [],
        }
        const c = own ? curve : { ...curve, kind: 'explicit' as const, modelId: stand.id, params: [], domain: null }
        const ms = own ? models : { ...models, [stand.id]: stand }
        ctx.save()
        ctx.setLineDash(dash.slice())
        drawCurve(ctx, c, ms, vp, o.selected, { strokeScale: sc, lightGround: o.lightGround })
        ctx.restore()
      } else if (b.kind === 'x') {
        if (!Number.isFinite(b.c)) continue
        const y0 = vp.center.y - (vp.heightPx / 2 + 8) / ppuY(vp)
        const y1 = vp.center.y + (vp.heightPx / 2 + 8) / ppuY(vp)
        strokePolylines(ctx, [[{ x: b.c, y: y0 }, { x: b.c, y: y1 }]], vp, curve.color, width, dash, o)
      } else {
        strokePolylines(ctx, contourOnView(part, vp), vp, curve.color, width, dash, o)
      }
    } catch {
      /* one boundary failing must not cost the others */
    }
  }
}

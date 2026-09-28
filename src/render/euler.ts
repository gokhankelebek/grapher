// ============================================================================
// src/render/euler.ts — Euler's method as a figure.
//
// What an AP item draws: the broken line from (x₀, y₀) through each
// (xₖ, yₖ), a filled dot at every step, and the start marked a little larger
// (a ring) because it is the one point that was GIVEN rather than computed.
// Optional chips name the points P₀, P₁, …; a small "h = 0.5" tag past the
// last point is the figure's own legend, so two runs compared on one board
// (h = 0.5 against h = 0.25) can be told apart on paper, where colour is gone.
//
// FIGURE, not chrome: the path is the mathematics of the lesson, so it goes
// through the one render routine and reaches the exported PNG unchanged; the
// board's `paint` is the curve ink, so under SAT / AP it is black like every
// other stroke and only the dash and the tag distinguish two runs.
//
// All lengths are CSS px before `present.stroke` / `present.type`.
// ============================================================================

import type { EulerPath, Theme, Vec2, Viewport } from '../core/types'
import { ppuX, ppuY } from '../core/types'
import { LABEL_PX, gridFont, labelFont, paintScale, type PaintScale } from './grid'

export type { EulerPath }

export const EULER_WIDTH = 2
/** A step's dot: the same size as a shape's plotted point. */
export const EULER_DOT_RADIUS = 3.5
/** The start: an open ring a little larger than a dot. */
export const EULER_START_RADIUS = 5.5
export const EULER_START_WIDTH = 2
/** The ground-coloured halo that lifts a dot off a stroke of its own colour. */
const HALO = 1.5
const LABEL_H = 16
const LABEL_PAD = 5
const LABEL_GAP = 5
const DARK_TEXT = '#e6eaf5'
const TWO_PI = Math.PI * 2
const CULL = 60

export interface EulerPaintOpts {
  vp: Viewport
  theme: Theme
  paint?: ((c: string) => string) | null
  scale?: PaintScale | null
  font?: 'sans' | 'serif' | null
}

interface Pt {
  x: number
  y: number
}

function isDarkGround(theme: Theme): boolean {
  const m = /^#([0-9a-fA-F]{6})$/.exec(theme.bg.trim())
  if (!m) return true
  const v = parseInt(m[1], 16)
  return 0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255) < 128
}

function chip(
  ctx: CanvasRenderingContext2D,
  at: Pt,
  dir: Pt,
  r: number,
  text: string,
  o: { theme: Theme; ink: string; type: number; stroke: number; w: number; h: number },
): void {
  const w = ctx.measureText(text).width + 2 * LABEL_PAD * o.type
  const h = LABEL_H * o.type
  const clearance = Math.abs(dir.x) * (w / 2) + Math.abs(dir.y) * (h / 2)
  const d = r + clearance + LABEL_GAP * o.type
  const cx = at.x + dir.x * d
  const cy = at.y + dir.y * d
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return
  if (cx < -CULL || cy < -CULL || cx > o.w + CULL || cy > o.h + CULL) return
  const x = cx - w / 2
  const y = cy - h / 2
  const rr = 4 * o.type
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
  ctx.fillStyle = o.theme.bg
  ctx.fill()
  ctx.lineWidth = 1 * o.stroke
  ctx.strokeStyle = o.theme.gridMajor
  ctx.stroke()
  ctx.fillStyle = o.ink
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + LABEL_PAD * o.type, y + h / 2)
}

const unit = (x: number, y: number): Pt => {
  const l = Math.hypot(x, y)
  return l > 0 ? { x: x / l, y: y / l } : { x: 0, y: -1 }
}

/** The local direction of the path at point i, in screen px. */
function along(px: readonly Pt[], i: number): Pt {
  const a = px[Math.max(0, i - 1)]
  const b = px[Math.min(px.length - 1, i + 1)]
  return unit(b.x - a.x, b.y - a.y)
}

/** Perpendicular to the path, on the upper side of the screen. */
function upNormal(d: Pt): Pt {
  const n = { x: d.y, y: -d.x }
  return n.y <= 0 ? n : { x: -n.x, y: -n.y }
}

function drawOne(
  ctx: CanvasRenderingContext2D,
  e: EulerPath,
  vp: Viewport,
  o: { theme: Theme; ink: string; type: number; stroke: number; color: string },
): void {
  const ppx = ppuX(vp)
  const ppy = ppuY(vp)
  const toPx = (p: Vec2): Pt => ({
    x: vp.widthPx / 2 + (p.x - vp.center.x) * ppx,
    y: vp.heightPx / 2 - (p.y - vp.center.y) * ppy,
  })
  const px: Pt[] = []
  for (const p of e.pts) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) break
    const q = toPx(p)
    // A step that has run off to 1e300 is not something a canvas can stroke.
    if (Math.abs(q.x) > 1e7 || Math.abs(q.y) > 1e7) break
    px.push(q)
  }
  if (px.length === 0) return

  // the tangent segments
  if (px.length > 1) {
    ctx.beginPath()
    ctx.moveTo(px[0].x, px[0].y)
    for (let i = 1; i < px.length; i++) ctx.lineTo(px[i].x, px[i].y)
    ctx.setLineDash(e.dash && e.dash.length > 0 ? e.dash.map((v) => v * o.stroke) : [])
    ctx.lineWidth = EULER_WIDTH * o.stroke
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.strokeStyle = o.color
    ctx.stroke()
    ctx.setLineDash([])
  }

  const onCanvas = (p: Pt): boolean =>
    p.x >= -CULL && p.y >= -CULL && p.x <= vp.widthPx + CULL && p.y <= vp.heightPx + CULL

  // a dot at every step after the start, haloed in the ground
  const r = EULER_DOT_RADIUS * o.stroke
  for (let i = 1; i < px.length; i++) {
    const p = px[i]
    if (!onCanvas(p)) continue
    ctx.beginPath()
    ctx.arc(p.x, p.y, r + (HALO * o.stroke) / 2, 0, TWO_PI)
    ctx.lineWidth = HALO * o.stroke
    ctx.strokeStyle = o.theme.bg
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(p.x, p.y, r, 0, TWO_PI)
    ctx.fillStyle = o.color
    ctx.fill()
  }

  // the start: a ring, filled with the ground so the path does not run through it
  const s = px[0]
  const R = EULER_START_RADIUS * o.stroke
  if (onCanvas(s)) {
    ctx.beginPath()
    ctx.arc(s.x, s.y, R, 0, TWO_PI)
    ctx.fillStyle = o.theme.bg
    ctx.fill()
    ctx.lineWidth = EULER_START_WIDTH * o.stroke
    ctx.strokeStyle = o.color
    ctx.stroke()
  }

  const chipOpts = { theme: o.theme, ink: o.ink, type: o.type, stroke: o.stroke, w: vp.widthPx, h: vp.heightPx }
  if (e.labels && e.labels.length > 0) {
    for (let i = 0; i < px.length && i < e.labels.length; i++) {
      const text = e.labels[i]
      if (!text) continue
      chip(ctx, px[i], upNormal(along(px, i)), i === 0 ? R : r, text, chipOpts)
    }
  }
  if (e.tag) {
    const last = px.length - 1
    const d = px.length > 1 ? along(px, last) : { x: 1, y: 0 }
    // past the end, along the path, turned a little down so it clears the P label above
    const n = upNormal(d)
    chip(ctx, px[last], unit(d.x - 0.6 * n.x, d.y - 0.6 * n.y), last === 0 ? R : r, e.tag, chipOpts)
  }
}

/**
 * Paint every Euler path, in order. Called after the curves and before the
 * shapes: the path is judged AGAINST the solution curve it approximates, so
 * it sits on top of it.
 */
export function drawEulerPaths(
  ctx: CanvasRenderingContext2D,
  paths: readonly EulerPath[],
  o: EulerPaintOpts,
): void {
  if (paths.length === 0) return
  const vp = o.vp
  if (vp.widthPx <= 0 || vp.heightPx <= 0 || !(vp.pxPerUnit > 0)) return
  const { type, stroke } = paintScale(o.scale)
  const paint = o.paint ?? ((c: string) => c)
  const ink = isDarkGround(o.theme) ? DARK_TEXT : o.theme.label
  ctx.save()
  ctx.globalAlpha = 1
  ctx.font = o.font ? labelFont({ font: o.font }, LABEL_PX * type) : gridFont(LABEL_PX * type)
  for (const e of paths) {
    if (!e) continue
    try {
      drawOne(ctx, e, vp, { theme: o.theme, ink, type, stroke, color: paint(e.color) })
    } catch {
      /* one run failing must not cost the figure */
    }
  }
  ctx.textBaseline = 'alphabetic'
  ctx.restore()
}

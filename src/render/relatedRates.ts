// ============================================================================
// src/render/relatedRates.ts — a related-rates scenario, drawn.
//
// The picture arrives as a short list of PRIMITIVES in math coordinates — the
// wall and floor, the ladder, the cone and its water, the lamp, the person and
// the shadow, circles — plus labelled live values and rate arrows, and an
// optional mini-graph of the unknown rate against t in its own little frame.
// Everything is laid out by src/ui/relatedRatesLinks.ts; this file only paints.
//
// FIGURE, not chrome: every stroke goes through renderBoard, so it reaches the
// PNG / SVG / PDF / TikZ exports, and under a mono figure style (SAT, AP) every
// ink is the axis black — the water becomes a grey wash, the labels keep
// the pieces apart.
//
// All lengths are CSS px BEFORE `present.stroke` / `present.type`.
// ============================================================================

import type { Theme, Vec2, Viewport } from '../core/types'
import { ppuX, ppuY } from '../core/types'
import { labelFont, paintScale } from './grid'
import type { PaintScale } from './grid'

/** Named inks: the scenario's own colour, and one per kind of quantity. */
export type RRInk = 'main' | 'ground' | 'water' | 'rate' | 'q1' | 'q2' | 'light' | 'shadow' | 'faint'

export const RR_INK: Record<Exclude<RRInk, 'main' | 'ground' | 'faint'>, string> = {
  water: '#38bdf8',
  rate: '#f95f62',
  q1: '#4f9cf9',
  q2: '#38c976',
  light: '#f9a825',
  shadow: '#8b93b0',
}

export type RRPrim =
  | { k: 'line'; a: Vec2; b: Vec2; ink: RRInk; w?: number; dash?: number[] }
  | { k: 'poly'; pts: Vec2[]; ink: RRInk; fill?: number; w?: number; closed?: boolean; dash?: number[] }
  | { k: 'circle'; c: Vec2; r: number; ink: RRInk; fill?: number; w?: number; dash?: number[] }
  | { k: 'dot'; at: Vec2; ink: RRInk; r?: number }
  /** A hatched ground or wall: the solid edge a→b, hatch on the `side` (a unit vector). */
  | { k: 'hatch'; a: Vec2; b: Vec2; side: Vec2 }
  /** A right-angle mark at `at`, legs along u and v. */
  | { k: 'right'; at: Vec2; u: Vec2; v: Vec2 }
  /** A rate arrow from `from` to `to` (math units), with its label at the head. */
  | { k: 'arrow'; from: Vec2; to: Vec2; ink: RRInk; label?: string }
  /** A dimension: a thin double-headed line a→b with its label, offset by `off` px. */
  | { k: 'dim'; a: Vec2; b: Vec2; ink: RRInk; label: string; off: Vec2 }
  /** A value chip at a point, stepped off along `dir` (screen, y down). */
  | { k: 'label'; at: Vec2; text: string; ink: RRInk; dir: Vec2; big?: boolean }

export interface RRGraph {
  /** Where the frame sits, in math units. */
  box: { x0: number; y0: number; x1: number; y1: number }
  /** The samples (t, rate), NaN where the rate has no value. */
  pts: { t: number; v: number }[]
  t1: number
  vLo: number
  vHi: number
  now: { t: number; v: number } | null
  /** "dy/dt (ft/s)" and "t (s)". */
  yLabel: string
  xLabel: string
}

export interface RelatedRatesFigure {
  id: string
  visible: boolean
  color: string
  prims: RRPrim[]
  graph: RRGraph | null
  /** A title chip over the scene: "x = 6 ft · dy/dt = −3/2 ft/s". */
  title: { at: Vec2; text: string } | null
  /**
   * The names of the rates this picture ANSWERS ("dy/dt"), so reveal mode can
   * say "dy/dt = ?" on every chip that states one. The renderer ignores it.
   */
  answers?: readonly string[]
}

export interface RRPaintOpts {
  vp: Viewport
  theme: Theme
  paint?: (c: string) => string
  mono?: boolean
  scale?: PaintScale | null
  font?: 'sans' | 'serif' | null
}

interface Fr {
  ppx: number
  ppy: number
  cx: number
  cy: number
  hw: number
  hh: number
}

const px = (fr: Fr, p: Vec2): Vec2 => ({ x: fr.hw + (p.x - fr.cx) * fr.ppx, y: fr.hh - (p.y - fr.cy) * fr.ppy })

interface St {
  stroke: number
  type: number
  mono: boolean
  theme: Theme
  font: string
  bold: string
  small: string
  ink(i: RRInk): string
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}
const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** A chip stepped off `p` along `dir`, nudged clear of the chips already down. */
function chip(
  ctx: CanvasRenderingContext2D,
  st: St,
  p: Vec2,
  dir: Vec2,
  text: string,
  color: string,
  placed: Rect[],
  big = false,
): void {
  if (!text || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return
  ctx.font = big ? st.bold : st.font
  const pad = 5 * st.type
  const w = ctx.measureText(text).width + 2 * pad
  const h = (big ? 22 : 18) * st.type
  const len = Math.hypot(dir.x, dir.y) || 1
  const d = { x: dir.x / len, y: dir.y / len }
  const base = Math.abs(d.x) * (w / 2) + Math.abs(d.y) * (h / 2) + 7 * st.type
  const side = { x: -d.y, y: d.x }
  let x = p.x + d.x * base - w / 2
  let y = p.y + d.y * base - h / 2
  const tries: [number, number][] = [[0, 0]]
  for (let k = 1; k <= 6; k++) tries.push([k * 8 * st.type, 0], [0, k * (h + 2)], [0, -k * (h + 2)])
  for (const [out, lat] of tries) {
    const cx = p.x + d.x * (base + out) + side.x * lat
    const cy = p.y + d.y * (base + out) + side.y * lat
    const r = { x: cx - w / 2 - 2, y: cy - h / 2 - 2, w: w + 4, h: h + 4 }
    if (!placed.some((b) => overlaps(r, b))) {
      x = cx - w / 2
      y = cy - h / 2
      break
    }
  }
  placed.push({ x: x - 2, y: y - 2, w: w + 4, h: h + 4 })
  roundRect(ctx, x, y, w, h, 4 * st.type)
  ctx.fillStyle = st.theme.bg
  ctx.fill()
  ctx.lineWidth = 1 * st.stroke
  ctx.strokeStyle = st.mono ? st.theme.axis : st.theme.gridMajor
  ctx.stroke()
  ctx.fillStyle = color
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + pad, y + h / 2)
}

function head(ctx: CanvasRenderingContext2D, tip: Vec2, from: Vec2, len: number, color: string): void {
  const dx = tip.x - from.x
  const dy = tip.y - from.y
  const l = Math.hypot(dx, dy)
  if (!(l > 0)) return
  const ux = dx / l
  const uy = dy / l
  const bx = tip.x - ux * len
  const by = tip.y - uy * len
  ctx.beginPath()
  ctx.moveTo(tip.x, tip.y)
  ctx.lineTo(bx - uy * len * 0.45, by + ux * len * 0.45)
  ctx.lineTo(bx + uy * len * 0.45, by - ux * len * 0.45)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
}

function strokePath(ctx: CanvasRenderingContext2D, pts: Vec2[], color: string, w: number, dash?: number[], closed = false): void {
  if (pts.length < 2) return
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  if (closed) ctx.closePath()
  ctx.strokeStyle = color
  ctx.lineWidth = w
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.setLineDash(dash ?? [])
  ctx.stroke()
  ctx.setLineDash([])
}

function withAlpha(ctx: CanvasRenderingContext2D, a: number, f: () => void): void {
  const prev = ctx.globalAlpha
  ctx.globalAlpha = prev * a
  f()
  ctx.globalAlpha = prev
}

function drawOne(ctx: CanvasRenderingContext2D, f: RelatedRatesFigure, fr: Fr, st: St): void {
  const s = st.stroke
  const placed: Rect[] = []
  const labels: (() => void)[] = []
  const ink = (i: RRInk): string => (i === 'main' ? (st.mono ? st.theme.axis : f.color) : st.ink(i))
  for (const p of f.prims) {
    switch (p.k) {
      case 'line':
        strokePath(ctx, [px(fr, p.a), px(fr, p.b)], ink(p.ink), (p.w ?? 2) * s, p.dash?.map((v) => v * s))
        break
      case 'poly': {
        const pts = p.pts.map((q) => px(fr, q))
        if (p.fill && pts.length > 2) {
          withAlpha(ctx, st.mono ? Math.min(0.35, p.fill) : p.fill, () => {
            ctx.beginPath()
            ctx.moveTo(pts[0].x, pts[0].y)
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
            ctx.closePath()
            ctx.fillStyle = st.mono ? '#888888' : ink(p.ink)
            ctx.fill()
          })
        }
        if (p.w !== 0) strokePath(ctx, pts, ink(p.ink), (p.w ?? 2) * s, p.dash?.map((v) => v * s), p.closed !== false)
        break
      }
      case 'circle': {
        const c = px(fr, p.c)
        const rx = p.r * fr.ppx
        const ry = p.r * fr.ppy
        if (!(rx > 0) || !(ry > 0)) break
        ctx.beginPath()
        if (Math.abs(rx - ry) < 1e-9) ctx.arc(c.x, c.y, rx, 0, Math.PI * 2)
        else {
          // A stretched board: the circle is an ellipse on screen.
          for (let i = 0; i <= 96; i++) {
            const a = (i / 96) * Math.PI * 2
            const X = c.x + rx * Math.cos(a)
            const Y = c.y + ry * Math.sin(a)
            if (i === 0) ctx.moveTo(X, Y)
            else ctx.lineTo(X, Y)
          }
          ctx.closePath()
        }
        if (p.fill) {
          withAlpha(ctx, st.mono ? Math.min(0.3, p.fill) : p.fill, () => {
            ctx.fillStyle = st.mono ? '#888888' : ink(p.ink)
            ctx.fill()
          })
        }
        if (p.w !== 0) {
          ctx.strokeStyle = ink(p.ink)
          ctx.lineWidth = (p.w ?? 2) * s
          ctx.setLineDash(p.dash?.map((v) => v * s) ?? [])
          ctx.stroke()
          ctx.setLineDash([])
        }
        break
      }
      case 'dot': {
        const c = px(fr, p.at)
        ctx.beginPath()
        ctx.arc(c.x, c.y, (p.r ?? 4.5) * s, 0, Math.PI * 2)
        ctx.fillStyle = ink(p.ink)
        ctx.fill()
        break
      }
      case 'hatch': {
        const a = px(fr, p.a)
        const b = px(fr, p.b)
        const color = st.theme.axis
        strokePath(ctx, [a, b], color, 2.2 * s)
        const len = Math.hypot(b.x - a.x, b.y - a.y)
        if (!(len > 0)) break
        const ux = (b.x - a.x) / len
        const uy = (b.y - a.y) / len
        // side in math → screen (y flips)
        const sx = p.side.x
        const sy = -p.side.y
        const step = 10 * s
        const hl = 8 * s
        ctx.beginPath()
        for (let d = step / 2; d < len; d += step) {
          const x = a.x + ux * d
          const y = a.y + uy * d
          ctx.moveTo(x, y)
          ctx.lineTo(x + sx * hl - ux * hl * 0.7, y + sy * hl - uy * hl * 0.7)
        }
        ctx.strokeStyle = color
        ctx.lineWidth = 1 * s
        ctx.stroke()
        break
      }
      case 'right': {
        const o = px(fr, p.at)
        const k = 11 * s
        const u = { x: p.u.x, y: -p.u.y }
        const v = { x: p.v.x, y: -p.v.y }
        strokePath(
          ctx,
          [
            { x: o.x + u.x * k, y: o.y + u.y * k },
            { x: o.x + u.x * k + v.x * k, y: o.y + u.y * k + v.y * k },
            { x: o.x + v.x * k, y: o.y + v.y * k },
          ],
          st.theme.label,
          1.2 * s,
        )
        break
      }
      case 'arrow': {
        const a = px(fr, p.from)
        const b = px(fr, p.to)
        if (Math.hypot(b.x - a.x, b.y - a.y) < 3) break
        const color = ink(p.ink)
        strokePath(ctx, [a, b], color, 2.6 * s)
        head(ctx, b, a, 11 * s, color)
        if (p.label) {
          const dir = { x: b.x - a.x, y: b.y - a.y }
          const text = p.label
          labels.push(() => chip(ctx, st, b, dir, text, color, placed))
        }
        break
      }
      case 'dim': {
        const a0 = px(fr, p.a)
        const b0 = px(fr, p.b)
        const a = { x: a0.x + p.off.x * s, y: a0.y + p.off.y * s }
        const b = { x: b0.x + p.off.x * s, y: b0.y + p.off.y * s }
        if (Math.hypot(b.x - a.x, b.y - a.y) < 6) break
        const color = ink(p.ink)
        strokePath(ctx, [a0, a], st.theme.gridMajor, 1 * s)
        strokePath(ctx, [b0, b], st.theme.gridMajor, 1 * s)
        strokePath(ctx, [a, b], color, 1.4 * s)
        head(ctx, a, b, 7 * s, color)
        head(ctx, b, a, 7 * s, color)
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const text = p.label
        const dir = { x: p.off.x, y: p.off.y }
        labels.push(() => chip(ctx, st, mid, Math.hypot(dir.x, dir.y) > 0 ? dir : { x: 0, y: 1 }, text, color, placed))
        break
      }
      case 'label': {
        const at = px(fr, p.at)
        const text = p.text
        const color = ink(p.ink)
        const big = p.big === true
        labels.push(() => chip(ctx, st, at, p.dir, text, color, placed, big))
        break
      }
    }
  }
  if (f.graph) drawGraph(ctx, f.graph, fr, st, ink('main'), ink('rate'), placed)
  if (f.title) {
    const at = px(fr, f.title.at)
    const text = f.title.text
    labels.unshift(() => chip(ctx, st, at, { x: 0, y: -1 }, text, st.mono ? st.theme.axis : '#e6e9f2', placed, true))
  }
  for (const l of labels) l()
}

function drawGraph(
  ctx: CanvasRenderingContext2D,
  g: RRGraph,
  fr: Fr,
  st: St,
  lineInk: string,
  dotInk: string,
  placed: Rect[],
): void {
  const s = st.stroke
  const a = px(fr, { x: g.box.x0, y: g.box.y1 })
  const b = px(fr, { x: g.box.x1, y: g.box.y0 })
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const w = Math.abs(b.x - a.x)
  const h = Math.abs(b.y - a.y)
  if (!(w > 30) || !(h > 24)) return
  placed.push({ x, y, w, h })
  ctx.save()
  roundRect(ctx, x, y, w, h, 6 * st.type)
  ctx.fillStyle = st.theme.bg
  withAlpha(ctx, 0.92, () => ctx.fill())
  ctx.lineWidth = 1 * s
  ctx.strokeStyle = st.mono ? st.theme.axis : st.theme.gridMajor
  ctx.stroke()
  const padL = 10 * st.type
  const padB = 16 * st.type
  const padT = 20 * st.type
  const padR = 10 * st.type
  const gx0 = x + padL
  const gx1 = x + w - padR
  const gy0 = y + padT
  const gy1 = y + h - padB
  const span = g.vHi - g.vLo || 1
  const toX = (t: number): number => gx0 + ((gx1 - gx0) * t) / (g.t1 || 1)
  const toY = (v: number): number => gy1 - ((gy1 - gy0) * (v - g.vLo)) / span
  // zero line
  if (g.vLo < 0 && g.vHi > 0) strokePath(ctx, [{ x: gx0, y: toY(0) }, { x: gx1, y: toY(0) }], st.theme.axis, 1 * s)
  strokePath(ctx, [{ x: gx0, y: gy0 }, { x: gx0, y: gy1 }, { x: gx1, y: gy1 }], st.theme.axis, 1 * s)
  // the curve, pen lifted over NaN and clipped to the frame
  ctx.beginPath()
  ctx.rect(gx0 - 1, gy0 - 1, gx1 - gx0 + 2, gy1 - gy0 + 2)
  ctx.clip()
  ctx.beginPath()
  let pen = false
  for (const q of g.pts) {
    if (!Number.isFinite(q.v)) {
      pen = false
      continue
    }
    const X = toX(q.t)
    const Y = Math.max(gy0 - 50, Math.min(gy1 + 50, toY(q.v)))
    if (pen) ctx.lineTo(X, Y)
    else ctx.moveTo(X, Y)
    pen = true
  }
  ctx.strokeStyle = lineInk
  ctx.lineWidth = 2 * s
  ctx.setLineDash([])
  ctx.stroke()
  if (g.now && Number.isFinite(g.now.v)) {
    const X = toX(g.now.t)
    strokePath(ctx, [{ x: X, y: gy0 }, { x: X, y: gy1 }], st.theme.gridMajor, 1 * s, [3 * s, 3 * s])
    ctx.beginPath()
    ctx.arc(X, toY(g.now.v), 4.5 * s, 0, Math.PI * 2)
    ctx.fillStyle = dotInk
    ctx.fill()
  }
  ctx.restore()
  ctx.font = st.small
  ctx.fillStyle = st.theme.label
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(g.yLabel, x + padL, y + padT / 2 + 1)
  ctx.textAlign = 'right'
  ctx.fillText(g.xLabel, x + w - padR, y + h - padB / 2)
}

export function drawRelatedRates(
  ctx: CanvasRenderingContext2D,
  figs: readonly RelatedRatesFigure[],
  o: RRPaintOpts,
): void {
  if (figs.length === 0) return
  const vp = o.vp
  if (vp.widthPx <= 0 || vp.heightPx <= 0 || !(vp.pxPerUnit > 0)) return
  const fr: Fr = {
    ppx: ppuX(vp),
    ppy: ppuY(vp),
    cx: vp.center.x,
    cy: vp.center.y,
    hw: vp.widthPx / 2,
    hh: vp.heightPx / 2,
  }
  const { type, stroke } = paintScale(o.scale)
  const face = { font: o.font ?? 'sans' } as const
  const paint = o.paint ?? ((c: string) => c)
  const mono = o.mono === true
  const st: St = {
    stroke,
    type,
    mono,
    theme: o.theme,
    font: labelFont(face, 13 * type),
    bold: `bold ${labelFont(face, 15 * type)}`,
    small: labelFont(face, 11 * type),
    ink: (i) => {
      if (mono) return o.theme.axis
      if (i === 'ground') return o.theme.axis
      if (i === 'faint') return o.theme.gridMajor
      if (i === 'main') return o.theme.label
      return paint(RR_INK[i])
    },
  }
  for (const f of figs) {
    if (!f || !f.visible) continue
    ctx.save()
    try {
      drawOne(ctx, { ...f, color: paint(f.color) }, fr, st)
    } catch {
      /* one scenario failing must not cost the figure */
    }
    ctx.globalAlpha = 1
    ctx.setLineDash([])
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.restore()
  }
}

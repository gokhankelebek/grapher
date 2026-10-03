// ============================================================================
// src/render/stats.ts — a statistics figure, drawn.
//
// A normal curve with its shaded probability, the empirical rule's brackets
// and a z row under the raw values; or a dot plot / histogram of simulated
// statistics with the theoretical curve, the observed mean or difference and
// the extreme tail. Each figure sits on its own opaque panel with its own
// axis: the board's grid means nothing to a density, so it does not show
// through. Everything is laid out (in board units) by src/ui/statsLinks.ts;
// this file only paints.
//
// FIGURE, not chrome: every stroke goes through renderBoard, so it reaches the
// PNG / SVG / PDF / TikZ exports, and under a mono figure style (SAT, AP)
// every ink is the axis black and every fill a grey wash.
//
// All lengths are CSS px BEFORE `present.stroke` / `present.type`.
// ============================================================================

import type { Theme, Vec2, Viewport } from '../core/types'
import { ppuX, ppuY } from '../core/types'
import type { DescribeStat } from '../core/describeAdapters'
import { labelFont, paintScale } from './grid'
import type { PaintScale } from './grid'

/** Named inks: the object's own colour, and one per role. */
export type StatInk = 'main' | 'theory' | 'obs' | 'hot' | 'rule' | 'axis'

export const STAT_INK: Record<Exclude<StatInk, 'main' | 'axis'>, string> = {
  theory: '#f9a825',
  obs: '#f95f62',
  hot: '#f95f62',
  rule: '#8b93b0',
}

export interface StatBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * Everything in BOARD units except where a field says px. `color`, where a
 * primitive has it, overrides the named ink with an object's own colour (one
 * per data set on a data plot); a mono figure style still paints it black.
 */
export type StatPrim =
  | { k: 'curve'; pts: Vec2[]; ink: StatInk; w: number; dash?: number[]; color?: string }
  | { k: 'fill'; pts: Vec2[]; ink: StatInk; alpha: number; color?: string; answer?: boolean }
  /** `edge: false`: the wash alone, no outline (a two-way table's highlighted row, column or cell). */
  | { k: 'rect'; x0: number; y0: number; x1: number; y1: number; ink: StatInk; alpha: number; color?: string; edge?: false }
  /**
   * A Venn diagram: the universe `box` and its circles, with the regions in
   * `atoms` shaded — atom m is the region inside circle i exactly when bit i
   * of m is set (0 = outside every circle); `atoms` has bit m set for each
   * shaded atom. Shading is clipped to the circles, so arcs stay arcs in the
   * vector exports.
   */
  | { k: 'venn'; box: StatBox; circles: { x: number; y: number; r: number }[]; atoms: number; ink: StatInk; alpha: number; color?: string }
  /** Many dots of one radius (board units). */
  | { k: 'dots'; pts: Vec2[]; r: number; ink: StatInk; color?: string }
  /** Many hollow rings of one radius (board units): values left out, outliers. */
  | { k: 'ring'; pts: Vec2[]; r: number; ink: StatInk; color?: string; dash?: boolean }
  | { k: 'vline'; x: number; y0: number; y1: number; ink: StatInk; w?: number; dash?: number[]; color?: string }
  /** ←── 68% ──→ between x0 and x1 at height y. */
  | { k: 'bracket'; x0: number; x1: number; y: number; text: string; ink: StatInk }
  /** A value chip stepped off `at` along `dir` (screen, y down). */
  | { k: 'chip'; at: Vec2; text: string; ink: StatInk; dir?: Vec2; answer?: boolean }
  /**
   * Plain text at `at`, raised by `rise` × the plot's height. 'center' and
   * 'right' as before ('right' hangs from its point); 'start' / 'end' are
   * left- / right-aligned on the middle line. `avoid`: skipped when it would
   * overlap text already placed. `answer`: reveal mode masks it.
   */
  | {
      k: 'text'
      at: Vec2
      text: string
      ink: StatInk
      small?: boolean
      rise: number
      align?: 'center' | 'right' | 'start' | 'end'
      color?: string
      avoid?: boolean
      answer?: boolean
      bold?: boolean
    }

export interface StatsFigure {
  id: string
  kind: 'normal' | 'sim' | 'data' | 'resid' | 'prob'
  visible: boolean
  color: string
  /** The opaque panel. */
  panel: StatBox
  /** Where the data are plotted. */
  plot: StatBox
  prims: StatPrim[]
  /** The axis line's height. */
  axisY: number
  /** No horizontal axis at all (a two-way table, a Venn or a tree diagram). */
  noAxis?: true
  /** Ticks with their raw-value label and (normal) z label. An empty text keeps the tick only. */
  ticks: { x: number; text: string; z: string }[]
  /** Emphasised ticks: the bounds, the observed difference. */
  marks: { x: number; text: string; z: string; answerZ: boolean; answerText: boolean; ink?: StatInk }[]
  /** Draw the z row under the raw values. */
  zRow: boolean
  /** What the axis measures ("x", "sample mean x̄"). */
  axisLabel: string
  /** A vertical axis at the plot's left edge (a residual plot's): ticks and what it measures. */
  yTicks?: { y: number; text: string }[]
  yLabel?: string
  /** The title band: the question, and its answer (masked in reveal mode). */
  title: { question: string; answer: string }
  /** The figure in words (src/core/describeAdapters.ts describeStats). */
  describe: DescribeStat | null
}

export interface StatsPaintOpts {
  vp: Viewport
  theme: Theme
  paint?: (c: string) => string
  mono?: boolean
  scale?: PaintScale | null
  font?: 'sans' | 'serif' | null
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}
const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

interface St {
  stroke: number
  type: number
  mono: boolean
  theme: Theme
  face: { font: 'sans' | 'serif' }
  ink(i: StatInk): string
  /** An object's own colour, painted for the palette (black under mono). */
  own(c: string): string
}

function drawOne(ctx: CanvasRenderingContext2D, f: StatsFigure, toPx: (p: Vec2) => Vec2, st: St): void {
  const s = st.stroke
  const t = st.type
  const P = (x: number, y: number): Vec2 => toPx({ x, y })
  const a = P(f.panel.x0, f.panel.y1)
  const b = P(f.panel.x1, f.panel.y0)
  const panel = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
  if (!(panel.w > 40) || !(panel.h > 30)) return
  const pa = P(f.plot.x0, f.plot.y1)
  const pb = P(f.plot.x1, f.plot.y0)
  const plotH = Math.abs(pb.y - pa.y)

  // ---- the panel: an opaque ground with a hairline frame
  roundRect(ctx, panel.x, panel.y, panel.w, panel.h, 8 * t)
  ctx.fillStyle = st.theme.bg
  ctx.fill()
  ctx.lineWidth = 1 * s
  ctx.strokeStyle = st.mono ? st.theme.axis : st.theme.gridMajor
  ctx.setLineDash([])
  ctx.stroke()

  ctx.save()
  ctx.beginPath()
  ctx.rect(panel.x, panel.y, panel.w, panel.h)
  ctx.clip()

  const placed: Rect[] = []
  const later: (() => void)[] = []
  const small = labelFont(st.face, 11 * t)
  const font = labelFont(st.face, 13 * t)
  const bold = `bold ${labelFont(st.face, 13 * t)}`

  const chip = (at: Vec2, text: string, color: string, dir: Vec2 | undefined): void => {
    if (!text || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return
    ctx.font = bold
    const pad = 5 * t
    const w = ctx.measureText(text).width + 2 * pad
    const h = 19 * t
    const d = dir ?? { x: 0, y: 0 }
    const len = Math.hypot(d.x, d.y)
    const u = len > 0 ? { x: d.x / len, y: d.y / len } : { x: 0, y: 0 }
    const off = len > 0 ? Math.abs(u.x) * (w / 2) + Math.abs(u.y) * (h / 2) + 6 * t : 0
    let cx = at.x + u.x * off
    let cy = at.y + u.y * off
    // keep inside the panel
    cx = Math.max(panel.x + w / 2 + 3, Math.min(panel.x + panel.w - w / 2 - 3, cx))
    cy = Math.max(panel.y + h / 2 + 3, Math.min(panel.y + panel.h - h / 2 - 3, cy))
    for (let k = 0; k < 8; k++) {
      const r = { x: cx - w / 2 - 2, y: cy - h / 2 - 2, w: w + 4, h: h + 4 }
      if (!placed.some((q) => overlaps(q, r))) break
      cy -= h + 3
    }
    placed.push({ x: cx - w / 2 - 2, y: cy - h / 2 - 2, w: w + 4, h: h + 4 })
    roundRect(ctx, cx - w / 2, cy - h / 2, w, h, 4 * t)
    ctx.fillStyle = st.theme.bg
    ctx.fill()
    ctx.lineWidth = 1 * s
    ctx.strokeStyle = color
    ctx.stroke()
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, cx, cy)
  }

  const line = (pts: Vec2[], color: string, w: number, dash?: number[]): void => {
    if (pts.length < 2) return
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
    ctx.strokeStyle = color
    ctx.lineWidth = w * s
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.setLineDash((dash ?? []).map((v) => v * s))
    ctx.stroke()
    ctx.setLineDash([])
  }

  const wash = (alpha: number): number => (st.mono ? Math.min(0.28, alpha * 0.6) : alpha)
  const inkOf = (i: StatInk, c?: string): string => (c ? st.own(c) : st.ink(i))
  const fillInk = (i: StatInk, c?: string): string => (st.mono ? '#777777' : inkOf(i, c))

  for (const p of f.prims) {
    switch (p.k) {
      case 'fill': {
        const pts = p.pts.map(toPx)
        if (pts.length < 3) break
        ctx.beginPath()
        ctx.moveTo(pts[0].x, pts[0].y)
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
        ctx.closePath()
        const prev = ctx.globalAlpha
        ctx.globalAlpha = prev * wash(p.alpha)
        ctx.fillStyle = fillInk(p.ink, p.color)
        ctx.fill()
        ctx.globalAlpha = prev
        break
      }
      case 'rect': {
        const q0 = P(p.x0, p.y1)
        const q1 = P(p.x1, p.y0)
        const x = Math.min(q0.x, q1.x)
        const y = Math.min(q0.y, q1.y)
        const w = Math.abs(q1.x - q0.x)
        const h = Math.abs(q1.y - q0.y)
        if (!(h > 0)) break
        const prev = ctx.globalAlpha
        ctx.globalAlpha = prev * wash(p.alpha)
        ctx.fillStyle = fillInk(p.ink, p.color)
        ctx.fillRect(x, y, w, h)
        ctx.globalAlpha = prev
        if (p.edge === false) break
        ctx.lineWidth = 1 * s
        ctx.strokeStyle = inkOf(p.ink, p.color)
        ctx.strokeRect(x, y, w, h)
        break
      }
      case 'venn': {
        const q0 = P(p.box.x0, p.box.y1)
        const q1 = P(p.box.x1, p.box.y0)
        const bx = Math.min(q0.x, q1.x)
        const by = Math.min(q0.y, q1.y)
        const bw = Math.abs(q1.x - q0.x)
        const bh = Math.abs(q1.y - q0.y)
        if (!(bw > 0) || !(bh > 0)) break
        const ppx = Math.abs(P(1, 0).x - P(0, 0).x)
        const cs = p.circles.map((c) => ({ ...toPx({ x: c.x, y: c.y }), r: c.r * ppx }))
        const n = 1 << cs.length
        for (let atom = 0; atom < n; atom++) {
          if (!(p.atoms & (1 << atom))) continue
          ctx.save()
          // inside each circle the atom is in…
          cs.forEach((c, i) => {
            if (!(atom & (1 << i))) return
            ctx.beginPath()
            ctx.moveTo(c.x + c.r, c.y)
            ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2)
            ctx.clip()
          })
          // …and outside the others: the box with that circle as a hole (opposite winding)
          cs.forEach((c, i) => {
            if (atom & (1 << i)) return
            ctx.beginPath()
            ctx.rect(bx, by, bw, bh)
            ctx.moveTo(c.x + c.r, c.y)
            ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2, true)
            ctx.clip()
          })
          const prev = ctx.globalAlpha
          ctx.globalAlpha = prev * wash(p.alpha)
          ctx.fillStyle = fillInk(p.ink, p.color)
          ctx.fillRect(bx, by, bw, bh)
          ctx.globalAlpha = prev
          ctx.restore()
        }
        ctx.lineWidth = 1.4 * s
        ctx.setLineDash([])
        ctx.strokeStyle = st.theme.axis
        ctx.strokeRect(bx, by, bw, bh)
        ctx.lineWidth = 2 * s
        ctx.strokeStyle = inkOf('main', p.color)
        for (const c of cs) {
          ctx.beginPath()
          ctx.moveTo(c.x + c.r, c.y)
          ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2)
          ctx.stroke()
        }
        break
      }
      case 'dots': {
        const ppx = Math.abs(P(1, 0).x - P(0, 0).x)
        const r = Math.max(0.8, p.r * ppx)
        ctx.fillStyle = inkOf(p.ink, p.color)
        ctx.beginPath()
        for (const q of p.pts) {
          const c = toPx(q)
          ctx.moveTo(c.x + r, c.y)
          ctx.arc(c.x, c.y, r, 0, Math.PI * 2)
        }
        ctx.fill()
        break
      }
      case 'ring': {
        const ppx = Math.abs(P(1, 0).x - P(0, 0).x)
        const r = Math.max(1.2, p.r * ppx)
        ctx.strokeStyle = inkOf(p.ink, p.color)
        ctx.lineWidth = 1.4 * s
        ctx.setLineDash(p.dash ? [2 * s, 2 * s] : [])
        for (const q of p.pts) {
          const c = toPx(q)
          ctx.beginPath()
          ctx.arc(c.x, c.y, r, 0, Math.PI * 2)
          ctx.stroke()
        }
        ctx.setLineDash([])
        break
      }
      case 'curve':
        line(p.pts.map(toPx), inkOf(p.ink, p.color), p.w, p.dash)
        break
      case 'vline':
        line([P(p.x, p.y0), P(p.x, p.y1)], inkOf(p.ink, p.color), p.w ?? 1.5, p.dash)
        break
      case 'bracket': {
        const l = P(p.x0, p.y)
        const r = P(p.x1, p.y)
        const color = st.ink(p.ink)
        line([l, r], color, 1.3)
        const k = 5 * t
        line([{ x: l.x + k, y: l.y - k }, l, { x: l.x + k, y: l.y + k }], color, 1.3)
        line([{ x: r.x - k, y: r.y - k }, r, { x: r.x - k, y: r.y + k }], color, 1.3)
        const text = p.text
        later.push(() => {
          ctx.font = bold
          const w = ctx.measureText(text).width + 8 * t
          const cx = (l.x + r.x) / 2
          ctx.fillStyle = st.theme.bg
          ctx.fillRect(cx - w / 2, l.y - 8 * t, w, 16 * t)
          ctx.fillStyle = color
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(text, cx, l.y)
        })
        break
      }
      case 'text': {
        const at = toPx(p.at)
        const y = at.y - p.rise * plotH
        const color = inkOf(p.ink, p.color)
        const text = p.text
        const align = p.align ?? 'center'
        later.push(() => {
          if (!text) return
          ctx.font = p.bold ? (p.small ? `bold ${small}` : bold) : p.small ? small : font
          if (p.avoid) {
            const w = ctx.measureText(text).width
            const h = (p.small ? 12 : 15) * t
            const x0 = align === 'center' ? at.x - w / 2 : align === 'start' ? at.x : at.x - w
            const r = { x: x0 - 1, y: y - h / 2, w: w + 2, h }
            if (placed.some((q) => overlaps(q, r))) return
            placed.push(r)
          }
          ctx.fillStyle = color
          if (align === 'start' || align === 'end') {
            ctx.textAlign = align === 'start' ? 'left' : 'right'
            ctx.textBaseline = 'middle'
            ctx.fillText(text, at.x, y)
            return
          }
          ctx.textAlign = align
          ctx.textBaseline = align === 'right' ? 'top' : 'middle'
          ctx.fillText(text, at.x, align === 'right' ? y + 4 * t : y)
        })
        break
      }
      case 'chip': {
        const at = toPx(p.at)
        const text = p.text
        const color = st.ink(p.ink)
        const dir = p.dir
        later.push(() => chip(at, text, color, dir))
        break
      }
    }
  }

  // ---- the axis, its ticks, the raw row and the z row
  const axisL = P(f.plot.x0, f.axisY)
  const axisR = P(f.plot.x1, f.axisY)
  if (!f.noAxis) line([axisL, axisR], st.theme.axis, 1.4)
  const tickLen = 5 * t
  const row1 = axisL.y + tickLen + 9 * t
  const row2 = row1 + 17 * t
  const taken: Rect[] = []
  const label = (x: number, y: number, text: string, color: string, f2: string): void => {
    if (!text) return
    ctx.font = f2
    const w = ctx.measureText(text).width
    const r = { x: x - w / 2 - 3, y: y - 8 * t, w: w + 6, h: 16 * t }
    if (taken.some((q) => overlaps(q, r))) return
    taken.push(r)
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, x, y)
  }
  // marks first: they win any crowding
  for (const m of f.marks) {
    const x = P(m.x, f.axisY).x
    const color = m.ink ? st.ink(m.ink) : st.ink('main')
    line([{ x, y: axisL.y - tickLen * 1.4 }, { x, y: axisL.y + tickLen * 1.4 }], color, 2.2)
    label(x, row1, m.text, color, bold)
    if (f.zRow && m.z) label(x, row2, m.z, color, bold)
  }
  for (const k of f.ticks) {
    const x = P(k.x, f.axisY).x
    line([{ x, y: axisL.y }, { x, y: axisL.y + tickLen }], st.theme.axis, 1.2)
    label(x, row1, k.text, st.theme.label, font)
    if (f.zRow) label(x, row2, k.z, st.theme.label, small)
  }
  // ---- a vertical axis (a residual plot's), its ticks and what it measures
  if (f.yTicks && f.yTicks.length > 0) {
    const top = P(f.plot.x0, f.plot.y1)
    const bottom = P(f.plot.x0, f.plot.y0)
    line([bottom, top], st.theme.axis, 1.2)
    ctx.font = small
    ctx.fillStyle = st.theme.label
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (const k of f.yTicks) {
      const q = P(f.plot.x0, k.y)
      line([{ x: q.x - tickLen, y: q.y }, q], st.theme.axis, 1.1)
      if (k.text) ctx.fillText(k.text, q.x - tickLen - 3 * t, q.y)
    }
    if (f.yLabel) {
      ctx.save()
      ctx.font = labelFont(st.face, 11 * t, true)
      ctx.translate(panel.x + 9 * t, (top.y + bottom.y) / 2)
      ctx.rotate(-Math.PI / 2)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(f.yLabel, 0, 0)
      ctx.restore()
    }
  }

  ctx.font = labelFont(st.face, 12 * t, true)
  ctx.fillStyle = st.theme.label
  if (f.zRow) {
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText('x', axisL.x - 6 * t, row1)
    ctx.fillText('z', axisL.x - 6 * t, row2)
  } else if (f.axisLabel) {
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.font = labelFont(st.face, 11 * t, true)
    ctx.fillText(f.axisLabel, axisR.x, row2)
  }

  for (const l of later) l()

  // ---- the title band
  const q = f.title.question
  const ans = f.title.answer
  if (q || ans) {
    ctx.font = bold
    const qw = ctx.measureText(q).width
    const aw = ans ? ctx.measureText(ans).width : 0
    const cx = panel.x + panel.w / 2
    const y = panel.y + 15 * t
    let x = cx - (qw + aw) / 2
    if (x < panel.x + 6) x = panel.x + 6
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = st.mono ? st.theme.axis : st.theme.label
    ctx.fillText(q, x, y)
    if (ans) {
      ctx.fillStyle = st.ink('main')
      ctx.fillText(ans, x + qw, y)
    }
  }
  ctx.restore()
}

export function drawStats(ctx: CanvasRenderingContext2D, figs: readonly StatsFigure[], o: StatsPaintOpts): void {
  if (figs.length === 0) return
  const vp = o.vp
  if (vp.widthPx <= 0 || vp.heightPx <= 0 || !(vp.pxPerUnit > 0)) return
  const ppx = ppuX(vp)
  const ppy = ppuY(vp)
  const toPx = (p: Vec2): Vec2 => ({
    x: vp.widthPx / 2 + (p.x - vp.center.x) * ppx,
    y: vp.heightPx / 2 - (p.y - vp.center.y) * ppy,
  })
  const { type, stroke } = paintScale(o.scale)
  const paint = o.paint ?? ((c: string) => c)
  const mono = o.mono === true
  for (const f of figs) {
    if (!f || !f.visible) continue
    const main = paint(f.color)
    const st: St = {
      stroke,
      type,
      mono,
      theme: o.theme,
      face: { font: o.font ?? 'sans' },
      ink: (i) => {
        if (mono || i === 'axis') return o.theme.axis
        if (i === 'main') return main
        if (i === 'rule') return o.theme.label
        return paint(STAT_INK[i])
      },
      own: (c) => (mono ? o.theme.axis : paint(c)),
    }
    ctx.save()
    try {
      drawOne(ctx, f, toPx, st)
    } catch {
      /* one figure failing must not cost the board */
    }
    ctx.globalAlpha = 1
    ctx.setLineDash([])
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.restore()
  }
}

/** The panels in board units, for hit-testing a click on a figure. */
export function statsAt(figs: readonly StatsFigure[], p: Vec2): StatsFigure | null {
  for (let i = figs.length - 1; i >= 0; i--) {
    const f = figs[i]
    if (!f.visible) continue
    if (p.x >= f.panel.x0 && p.x <= f.panel.x1 && p.y >= f.panel.y0 && p.y <= f.panel.y1) return f
  }
  return null
}

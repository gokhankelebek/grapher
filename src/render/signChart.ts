// ============================================================================
// src/render/signChart.ts — sign-chart strips along the bottom of the board.
//
//   ┌──────────────────────────────────────────────────────────────────┐
//   │ f′   ──── + ────┼──── − ────┼──── + ────                            │
//   │ f       ↗       ┊     ↘     ┊     ↗                                 │
//   │ f″   ──── − ─────────┼───────── + ────                              │
//   │         −1           0          1                                  │
//   └──────────────────────────────────────────────────────────────────┘
//
// Each strip is a ROW of the chart: its label (f, f′, f″), a line with a
// tick at every critical x, "0" or "und" on the tick, and + / − in each open
// interval between them. An arrow row (↗ ↘) says what f does, a concavity
// row (∪ ∩) how it bends; both are drawn as strokes, not glyphs, so every
// export format (SVG, PDF, TikZ) draws them the same. The last line of each
// chart is its x's, in exact form, placed UNDER the board x they belong to.
//
// ALIGNMENT is the point: a strip is laid out in screen space along the
// bottom band, but every x on it is the board's own x — mapped with the same
// viewport as the curves — so each critical x lines up with the graph above.
// `guides` draws a dashed line from each critical x up through the graph.
//
// THE BAND. The strips are painted on an OPAQUE backing in the ground colour,
// with a rule along its top, rather than by shrinking the plot to make room.
// Shrinking would change the viewport every other layer (grid, curves,
// gestures, handles, exports' framing) maps through; a backing leaves the
// board's geometry — and so the alignment — exactly as it is, and the teacher
// can pan the graph up if something sits under the band. The grid's numbers
// step out of the band the way they step out of the caption's (bottomInset),
// and the export framing reserves the band like the caption band.
//
// FIGURE, not chrome: it exports, and under a mono figure style (SAT / AP)
// every stroke and letter is the one ink.
//
// All units are CSS px; the caller has already applied DPR.
// ============================================================================

import type { Theme, Viewport } from '../core/types'
import { ppuX } from '../core/types'
import { labelFont, paintScale, type PaintScale } from './grid'

/** One x on a strip. */
export interface SignStripMark {
  x: number
  /** What the tick says: "0", "und", or nothing (a jump). */
  label: '0' | 'und' | ''
}

/** One strip. */
export interface SignStripRow {
  /** "f′", "f″", "f" */
  label: string
  /**
   * sign: + / − on a line; arrow: ↗ ↘ → (from f′'s signs); concavity: ∪ ∩
   * (from f″'s signs).
   */
  kind: 'sign' | 'arrow' | 'concavity'
  marks: readonly SignStripMark[]
  /** In increasing x; ends may be ±Infinity. null: outside the domain (nothing drawn). */
  intervals: readonly { from: number; to: number; sign: 1 | -1 | 0 | null }[]
}

/** One chart: its strips, the x's under them, and whether the guides are on. */
export interface SignChartFigure {
  id: string
  /** The curve's colour (the row labels and the guides wear it). */
  color: string
  rows: readonly SignStripRow[]
  /** Every critical x of the chart, with its exact text, for the x line and the guides. */
  ticks: readonly { x: number; text: string }[]
  guides: boolean
}

export interface SignChartPaintOpts {
  vp: Viewport
  theme: Theme
  /** The board's ink: print-mapped on white, one black under a mono style. */
  paint: (c: string) => string
  /** Every letter and rule in one ink (SAT / AP). */
  mono: boolean
  /** Text colour on this ground. */
  text: string
  scale?: PaintScale | null
  font?: 'sans' | 'serif' | null
  /** Paper already reserved at the bottom (the caption band), px. */
  bottomInset?: number
  /** The + and − colours on screen (ignored under mono). */
  plus?: string
  minus?: string
}

/** A strip's height, and the x line's, before `present.type`. */
export const SIGN_ROW_PX = 24
export const SIGN_TICK_ROW_PX = 18
/** The label column, before `present.type`. */
export const SIGN_LABEL_W = 38
/** Paper above and below the strips inside the band. */
const BAND_PAD = 5
/** Half a tick's height. */
const TICK_HALF = 8
/** An interval narrower than this (px) carries no sign. */
const MIN_SIGN_W = 16
const GUIDE_DASH = [5, 5]
const GUIDE_ALPHA = 0.5

/** The band all these charts need at the bottom of the plot, in CSS px (0: none). */
export function signBandHeight(charts: readonly SignChartFigure[] | null | undefined, present?: PaintScale | null): number {
  if (!charts || charts.length === 0) return 0
  const type = paintScale(present).type
  let h = 0
  for (const c of charts) {
    if (c.rows.length === 0) continue
    h += c.rows.length * SIGN_ROW_PX + SIGN_TICK_ROW_PX
  }
  return h > 0 ? (h + 2 * BAND_PAD) * type : 0
}

/** Screen x of a math x, clamped far off-screen for ±∞. */
function sxOf(vp: Viewport, x: number): number {
  if (x === Infinity) return vp.widthPx * 4
  if (x === -Infinity) return -vp.widthPx * 3
  return vp.widthPx / 2 + (x - vp.center.x) * ppuX(vp)
}

/** The top of the band, px. */
function bandTop(charts: readonly SignChartFigure[], o: SignChartPaintOpts): number {
  const inset = o.bottomInset && Number.isFinite(o.bottomInset) && o.bottomInset > 0 ? o.bottomInset : 0
  return o.vp.heightPx - inset - signBandHeight(charts, o.scale)
}

/**
 * The guides: a dashed line from each critical x up through the graph, to
 * the band. Painted UNDER the curves (the caller calls this before them).
 */
export function drawSignGuides(
  ctx: CanvasRenderingContext2D,
  charts: readonly SignChartFigure[],
  o: SignChartPaintOpts,
): void {
  const { type, stroke } = paintScale(o.scale)
  void type
  const top = bandTop(charts, o)
  const W = o.vp.widthPx
  const labelW = SIGN_LABEL_W * paintScale(o.scale).type
  ctx.save()
  ctx.lineWidth = 1.25 * stroke
  ctx.setLineDash(GUIDE_DASH.map((d) => d * stroke))
  ctx.globalAlpha = o.mono ? 0.7 : GUIDE_ALPHA
  for (const c of charts) {
    if (!c.guides || c.rows.length === 0) continue
    ctx.strokeStyle = o.mono ? o.paint(c.color) : o.paint(c.color)
    ctx.beginPath()
    for (const t of c.ticks) {
      if (!Number.isFinite(t.x)) continue
      const px = sxOf(o.vp, t.x)
      if (px < labelW || px > W) continue
      ctx.moveTo(px, 0)
      ctx.lineTo(px, top)
    }
    ctx.stroke()
  }
  ctx.restore()
  ctx.setLineDash([])
  ctx.globalAlpha = 1
}

/** A ground-filled chip of text centred on (x, y). */
function knockout(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  bg: string,
  color: string,
  padX: number,
  h: number,
): void {
  const w = ctx.measureText(text).width + 2 * padX
  ctx.fillStyle = bg
  ctx.fillRect(x - w / 2, y - h / 2, w, h)
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
}

/** ↗ (s = 1), ↘ (s = −1) or → (0), centred on (x, y), as strokes. */
function arrowGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, s: 1 | -1 | 0, size: number, color: string): void {
  const dx = size
  const dy = s === 0 ? 0 : -s * size * 0.7
  const x0 = x - dx
  const y0 = y - dy
  const x1 = x + dx
  const y1 = y + dy
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1, y1)
  ctx.stroke()
  const len = Math.hypot(x1 - x0, y1 - y0)
  const ux = (x1 - x0) / len
  const uy = (y1 - y0) / len
  const head = 0.55 * size
  const half = 0.3 * size
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x1 - ux * head - uy * half, y1 - uy * head + ux * half)
  ctx.lineTo(x1 - ux * head + uy * half, y1 - uy * head - ux * half)
  ctx.closePath()
  ctx.fill()
}

/** ∪ (s = 1) or ∩ (s = −1), centred on (x, y), as a stroked half circle; — for 0. */
function cupGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, s: 1 | -1 | 0, size: number, color: string): void {
  ctx.strokeStyle = color
  ctx.beginPath()
  if (s === 0) {
    ctx.moveTo(x - size, y)
    ctx.lineTo(x + size, y)
  } else if (s === 1) {
    // the lower half of a circle: canvas y runs down, so 0 → π is the bottom
    ctx.moveTo(x - size, y - size * 0.45)
    ctx.arc(x, y - size * 0.45, size, Math.PI, 0, true)
  } else {
    ctx.moveTo(x - size, y + size * 0.45)
    ctx.arc(x, y + size * 0.45, size, Math.PI, 0, false)
  }
  ctx.stroke()
}

/**
 * The strips themselves, on their backing, above the caption band. Painted
 * after every other figure layer and before the caption.
 */
export function drawSignStrips(
  ctx: CanvasRenderingContext2D,
  charts: readonly SignChartFigure[],
  o: SignChartPaintOpts,
): void {
  const band = signBandHeight(charts, o.scale)
  if (band <= 0) return
  const { type, stroke } = paintScale(o.scale)
  const W = o.vp.widthPx
  const top = bandTop(charts, o)
  const labelW = SIGN_LABEL_W * type
  const rowH = SIGN_ROW_PX * type
  const tickRowH = SIGN_TICK_ROW_PX * type
  const axisInk = o.mono ? o.paint(o.theme.axis) : o.theme.axis
  const textInk = o.text
  const plus = o.mono ? textInk : o.paint(o.plus ?? '#38c976')
  const minus = o.mono ? textInk : o.paint(o.minus ?? '#f95f62')
  const serif = o.font === 'serif'

  ctx.save()
  ctx.globalAlpha = 1
  ctx.setLineDash([])
  // The backing, and the rule that says where the graph stops.
  ctx.fillStyle = o.theme.bg
  ctx.fillRect(0, top, W, band)
  ctx.strokeStyle = axisInk
  ctx.lineWidth = 1 * stroke
  ctx.beginPath()
  ctx.moveTo(0, top + 0.5)
  ctx.lineTo(W, top + 0.5)
  ctx.stroke()

  let y = top + BAND_PAD * type
  const inView = (px: number): boolean => px >= labelW && px <= W
  for (const chart of charts) {
    if (chart.rows.length === 0) continue
    const blockTop = y
    const rowColor = o.paint(chart.color)
    // Faint connectors down the block at every critical x: the chart's grid.
    const blockBottom = y + chart.rows.length * rowH
    ctx.save()
    ctx.globalAlpha = o.mono ? 0.45 : 0.3
    ctx.strokeStyle = axisInk
    ctx.lineWidth = 1 * stroke
    ctx.setLineDash([2 * stroke, 3 * stroke])
    ctx.beginPath()
    for (const t of chart.ticks) {
      const px = sxOf(o.vp, t.x)
      if (!Number.isFinite(t.x) || !inView(px)) continue
      ctx.moveTo(px, blockTop)
      ctx.lineTo(px, blockBottom)
    }
    ctx.stroke()
    ctx.restore()

    for (const row of chart.rows) {
      const cy = y + rowH / 2
      // The label, in the curve's colour (the one ink under mono).
      ctx.font = labelFont({ font: serif ? 'serif' : 'sans' }, 14 * type, true)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = rowColor
      ctx.fillText(row.label, 8 * type, cy)

      if (row.kind === 'sign') {
        // The line, only where the row is defined at all.
        ctx.strokeStyle = axisInk
        ctx.lineWidth = 1.25 * stroke
        ctx.beginPath()
        for (const iv of row.intervals) {
          if (iv.sign === null) continue
          const a = Math.max(labelW, sxOf(o.vp, iv.from))
          const b = Math.min(W, sxOf(o.vp, iv.to))
          if (!(b > a)) continue
          ctx.moveTo(a, cy)
          ctx.lineTo(b, cy)
        }
        ctx.stroke()
      }

      // The signs (or arrows, or cups), in the visible part of each interval.
      for (const iv of row.intervals) {
        if (iv.sign === null) continue
        const a = Math.max(labelW, sxOf(o.vp, iv.from))
        const b = Math.min(W, sxOf(o.vp, iv.to))
        if (!(b - a >= MIN_SIGN_W * type)) continue
        const cx = (a + b) / 2
        if (row.kind === 'sign') {
          const t = iv.sign === 1 ? '+' : iv.sign === -1 ? '−' : '0'
          ctx.font = `bold ${labelFont({ font: serif ? 'serif' : 'sans' }, 15 * type)}`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          knockout(ctx, t, cx, cy, o.theme.bg, iv.sign === 1 ? plus : iv.sign === -1 ? minus : textInk, 4 * type, 14 * type)
        } else if (row.kind === 'arrow') {
          ctx.lineWidth = 1.75 * stroke
          arrowGlyph(ctx, cx, cy, iv.sign, 8 * type, rowColor)
        } else {
          ctx.lineWidth = 1.75 * stroke
          cupGlyph(ctx, cx, cy, iv.sign, 7 * type, rowColor)
        }
      }

      if (row.kind === 'sign') {
        // Ticks, with "0" / "und" on them.
        ctx.strokeStyle = axisInk
        ctx.lineWidth = 1.5 * stroke
        ctx.beginPath()
        for (const m of row.marks) {
          const px = sxOf(o.vp, m.x)
          if (!Number.isFinite(m.x) || !inView(px)) continue
          ctx.moveTo(px, cy - TICK_HALF * type)
          ctx.lineTo(px, cy + TICK_HALF * type)
        }
        ctx.stroke()
        ctx.font = labelFont({ font: serif ? 'serif' : 'sans' }, 11 * type)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        for (const m of row.marks) {
          const px = sxOf(o.vp, m.x)
          if (!Number.isFinite(m.x) || !inView(px) || m.label === '') continue
          knockout(ctx, m.label, px, cy, o.theme.bg, textInk, 2 * type, 12 * type)
        }
      }
      y += rowH
    }

    // The x line: each critical x, exactly, under the board x it is.
    ctx.font = labelFont({ font: serif ? 'serif' : 'sans' }, 11.5 * type)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = textInk
    const cy = y + tickRowH / 2
    const placed: [number, number][] = []
    for (const t of chart.ticks) {
      const px = sxOf(o.vp, t.x)
      if (!Number.isFinite(t.x) || !inView(px)) continue
      const w = ctx.measureText(t.text).width
      const x0 = Math.max(labelW, Math.min(W - w, px - w / 2))
      const span: [number, number] = [x0 - 3 * type, x0 + w + 3 * type]
      if (placed.some(([p, q]) => span[0] < q && p < span[1])) continue
      placed.push(span)
      ctx.fillText(t.text, x0 + w / 2, cy)
    }
    y += tickRowH
  }
  ctx.restore()
  ctx.textAlign = 'start'
  ctx.textBaseline = 'alphabetic'
  ctx.globalAlpha = 1
}

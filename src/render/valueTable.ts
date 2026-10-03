// ============================================================================
// src/render/valueTable.ts — a table of values drawn ON the figure.
//
//   ┌─────┬──────┬─────┐
//   │  x  │ f(x) │ Δy  │
//   ├─────┼──────┼─────┤
//   │  0  │   1  │     │
//   │  1  │   3  │  2  │
//   └─────┴──────┴─────┘
//
// A card's "show table on figure" puts its table in the bottom-left corner
// of the plot (above a caption or sign-chart band; the top of the board is
// where the toolbar floats, the bottom right where the zoom buttons sit), on an opaque backing in the ground colour with a rule in the
// axis ink, so a curve that runs under it does not read through. Two tables
// stand side by side. A thin bar in the curve's colour says whose table it
// is (under a mono figure style it is the one ink, like everything else).
//
// FIGURE, not chrome: it exports — the SVG, PDF and TikZ exports record this
// same drawing — and a student copy (reveal mode) prints "?" for the values.
//
// All units are CSS px; the caller has already applied DPR.
// ============================================================================

import type { Theme, Viewport } from '../core/types'
import { LABEL_PX, labelFont, paintScale, type PaintScale } from './grid'

/** One table on the figure (built by src/ui/valueTableLinks.ts). */
export interface ValueTableFigure {
  id: string
  color: string
  heads: readonly string[]
  /** rows[i][j]: column j of row i ('' for nothing). */
  rows: readonly (readonly string[])[]
  /** Columns from this index on are answers. */
  answerFrom: number
}

export interface ValueTablePaintOpts {
  vp: Viewport
  theme: Theme
  paint: (c: string) => string
  mono: boolean
  /** Text colour on this ground. */
  text: string
  scale?: PaintScale | null
  font?: 'sans' | 'serif' | null
  /** Paper already reserved at the bottom (caption and sign-chart bands), px. */
  bottomInset?: number
}

/** The corner inset, row height and cell padding, before `present.type`. */
const INSET = 8
const ROW_H = 17
const PAD_X = 6
const BAR_W = 3
const GAP = 8

/** Width and height a table needs (px), for layout and for the export framing. */
export function valueTableSize(
  ctx: CanvasRenderingContext2D,
  t: ValueTableFigure,
  o: Pick<ValueTablePaintOpts, 'scale' | 'font'>,
): { w: number; h: number; cols: number[] } {
  const { type } = paintScale(o.scale)
  const px = LABEL_PX * type
  const cols: number[] = []
  ctx.save()
  for (let j = 0; j < t.heads.length; j++) {
    ctx.font = `600 ${labelFont(o.font ? { font: o.font } : null, px)}`
    let w = ctx.measureText(t.heads[j]).width
    ctx.font = labelFont(o.font ? { font: o.font } : null, px)
    for (const r of t.rows) w = Math.max(w, ctx.measureText(r[j] ?? '').width)
    cols.push(Math.ceil(w + 2 * PAD_X * type))
  }
  ctx.restore()
  const w = cols.reduce((a, b) => a + b, 0) + BAR_W * type
  const h = (t.rows.length + 1) * ROW_H * type
  return { w, h, cols }
}

export function drawValueTables(
  ctx: CanvasRenderingContext2D,
  tables: readonly ValueTableFigure[],
  o: ValueTablePaintOpts,
): void {
  if (tables.length === 0) return
  const { type, stroke } = paintScale(o.scale)
  const px = LABEL_PX * type
  const rowH = ROW_H * type
  const axisInk = o.mono ? o.paint(o.theme.axis) : o.theme.axis
  const font = o.font ? { font: o.font } : null
  let left = INSET * type
  const inset = o.bottomInset && Number.isFinite(o.bottomInset) && o.bottomInset > 0 ? o.bottomInset : 0
  ctx.save()
  ctx.globalAlpha = 1
  ctx.setLineDash([])
  ctx.textBaseline = 'middle'
  for (const t of tables) {
    if (t.heads.length === 0) continue
    const { w, h, cols } = valueTableSize(ctx, t, o)
    if (left + w > o.vp.widthPx) break
    const top = Math.max(INSET * type, o.vp.heightPx - inset - INSET * type - h)
    // the backing and its frame
    ctx.fillStyle = o.theme.bg
    ctx.fillRect(left, top, w, h)
    ctx.strokeStyle = axisInk
    ctx.lineWidth = 1 * stroke
    ctx.strokeRect(left + 0.5, top + 0.5, w - 1, h - 1)
    // whose table: a bar in the curve's colour
    ctx.fillStyle = o.mono ? axisInk : o.paint(t.color)
    ctx.fillRect(left, top, BAR_W * type, h)
    const x0 = left + BAR_W * type
    // the rule under the header, and the column rules
    ctx.beginPath()
    ctx.moveTo(x0, top + rowH)
    ctx.lineTo(left + w, top + rowH)
    let cx = x0
    for (let j = 0; j < cols.length - 1; j++) {
      cx += cols[j]
      ctx.moveTo(cx, top)
      ctx.lineTo(cx, top + h)
    }
    ctx.stroke()
    // the text: header bold, values right-aligned
    ctx.fillStyle = o.text
    ctx.textAlign = 'center'
    ctx.font = `600 ${labelFont(font, px)}`
    cx = x0
    for (let j = 0; j < t.heads.length; j++) {
      ctx.fillText(t.heads[j], cx + cols[j] / 2, top + rowH / 2)
      cx += cols[j]
    }
    ctx.font = labelFont(font, px)
    ctx.textAlign = 'right'
    t.rows.forEach((r, i) => {
      const y = top + (i + 1.5) * rowH
      let x = x0
      for (let j = 0; j < cols.length; j++) {
        const s = r[j] ?? ''
        if (s !== '') ctx.fillText(s, x + cols[j] - PAD_X * type, y)
        x += cols[j]
      }
    })
    left += w + GAP * type
  }
  ctx.restore()
}

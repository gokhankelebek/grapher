// ============================================================================
// src/ui/worksheetLayout.ts — where everything goes on a worksheet page.
//
// Pure geometry in POINTS (1/72 in), y down from the top-left of the page.
// The PDF, the on-screen preview, the PNG and the LaTeX widths all read it,
// so they cannot disagree about a cell.
//
//   page     letter 612 x 792 pt, A4 595.28 x 841.89 pt; landscape swaps them;
//   margins  0.75 in (54 pt) on every side;
//   header   page 1 only: the title (16 pt bold), then "Name ____ Date ____";
//   grid     `cols` columns with an 18 pt gutter; every cell is a label band
//            (the (a) sits in its top-left corner), a figure box, and a
//            caption band when any figure on the sheet has a caption;
//   rows     as many as fit; the rest flow onto further pages.
//
// The figure box is 4:3 of the cell width, capped so that at least two rows
// fit page 1 under its header — a one-column sheet of full-width 4:3 figures would otherwise
// print one figure per page. A figure keeps its OWN aspect inside the box.
// ============================================================================

import type { SheetCols, SheetNumbering, SheetOrientation, SheetPage } from '../core/persist'

export const PAGE_SIZES_PT: Record<SheetPage, { w: number; h: number }> = {
  letter: { w: 612, h: 792 },
  a4: { w: 595.28, h: 841.89 },
}

export const SHEET_MARGIN_PT = 54
export const GUTTER_PT = 18
export const ROW_GAP_PT = 14
export const LABEL_BAND_PT = 16
export const CAPTION_BAND_PT = 28
export const TITLE_SIZE_PT = 16
export const TITLE_BAND_PT = 26
export const NAME_BAND_PT = 26
export const HEADER_GAP_PT = 8
/** A figure box is never wider than this times its height (and is 4:3 by default). */
const FIGURE_ASPECT = 4 / 3

export interface RectPt {
  x: number
  y: number
  w: number
  h: number
}

export interface CellLayout {
  /** Index into the sheet's items. */
  index: number
  /** The whole cell. */
  cell: RectPt
  /** The label's baseline origin, top-left corner of the cell. */
  label: { x: number; y: number }
  /** The box the figure is fitted into. */
  figure: RectPt
  /** The caption band (h 0 when the sheet has no captions). */
  caption: RectPt
  /**
   * Under the caption: the figure's data table and, on the key, its worked
   * answers. As tall as the tallest such block in the row (h 0 without).
   */
  extra: RectPt
}

export interface PageLayout {
  cells: CellLayout[]
  /** Where the last row on the page ends (pt from the top). */
  bottom: number
}

export interface SheetLayout {
  width: number
  height: number
  margin: number
  /** Width available to the content: the page less both margins. */
  contentW: number
  /** Header rects on page 1 (null when absent). */
  title: RectPt | null
  nameLine: RectPt | null
  cellW: number
  cellH: number
  figureH: number
  rowsFirst: number
  rowsRest: number
  pages: PageLayout[]
}

export interface LayoutInput {
  page: SheetPage
  orientation: SheetOrientation
  cols: SheetCols
  count: number
  hasTitle: boolean
  nameLine: boolean
  hasCaptions: boolean
  /**
   * Per item, the height (pt) of what is printed under its figure and caption
   * — a data table, the key's answers. A row grows to its tallest; absent or
   * all zero, every row is the same height (the layout as it always was).
   */
  extra?: readonly number[]
}

export function pageSize(page: SheetPage, orientation: SheetOrientation): { w: number; h: number } {
  const s = PAGE_SIZES_PT[page]
  return orientation === 'landscape' ? { w: s.h, h: s.w } : { w: s.w, h: s.h }
}

/** Width of one cell for `cols` columns in a content width. */
export function cellWidth(contentW: number, cols: number): number {
  return (contentW - (cols - 1) * GUTTER_PT) / cols
}

export function layoutSheet(o: LayoutInput): SheetLayout {
  const { w, h } = pageSize(o.page, o.orientation)
  const m = SHEET_MARGIN_PT
  const contentW = w - 2 * m
  const contentH = h - 2 * m
  const cols = Math.max(1, Math.min(3, Math.round(o.cols)))
  const cellW = cellWidth(contentW, cols)

  let y = m
  const title = o.hasTitle ? { x: m, y, w: contentW, h: TITLE_BAND_PT } : null
  if (title) y += TITLE_BAND_PT
  const nameLine = o.nameLine ? { x: m, y, w: contentW, h: NAME_BAND_PT } : null
  if (nameLine) y += NAME_BAND_PT
  const header = y > m ? y - m + HEADER_GAP_PT : 0

  const captionH = o.hasCaptions ? CAPTION_BAND_PT : 0
  const bands = LABEL_BAND_PT + captionH
  // Two rows must fit on page 1, under the header.
  const twoRows = (contentH - header - ROW_GAP_PT) / 2 - bands
  const figureH = Math.max(40, Math.min(cellW / FIGURE_ASPECT, twoRows))
  const cellH = bands + figureH

  const rowsIn = (avail: number): number => Math.max(1, Math.floor((avail + ROW_GAP_PT) / (cellH + ROW_GAP_PT)))
  const rowsFirst = rowsIn(contentH - header)
  const rowsRest = rowsIn(contentH)

  const pages: PageLayout[] = []
  const extraOf = (i: number): number => Math.max(0, o.extra?.[i] ?? 0)
  const anyExtra = o.extra !== undefined && o.extra.some((e) => e > 0)
  let index = 0
  let pageNo = 0
  while (index < o.count || pages.length === 0) {
    const top = m + (pageNo === 0 ? header : 0)
    const cells: CellLayout[] = []
    let y = top
    let rows = 0
    // Without extras every row is cellH tall: as many rows as rowsIn says.
    // With them a row is as tall as its tallest block, and the page takes
    // rows while they fit (always at least one).
    const most = anyExtra ? Infinity : pageNo === 0 ? rowsFirst : rowsRest
    while (index < o.count && rows < most) {
      const n = Math.min(cols, o.count - index)
      let ex = 0
      for (let k = 0; k < n; k++) ex = Math.max(ex, extraOf(index + k))
      const rowH = cellH + ex
      if (anyExtra && rows > 0 && y + rowH > m + contentH + 1e-6) break
      for (let c = 0; c < n; c++) {
        const x = m + c * (cellW + GUTTER_PT)
        cells.push({
          index,
          cell: { x, y, w: cellW, h: rowH },
          label: { x, y: y + LABEL_BAND_PT - 4 },
          figure: { x, y: y + LABEL_BAND_PT, w: cellW, h: figureH },
          caption: { x, y: y + LABEL_BAND_PT + figureH, w: cellW, h: captionH },
          extra: { x, y: y + cellH, w: cellW, h: ex },
        })
        index++
      }
      y += rowH + ROW_GAP_PT
      rows++
    }
    pages.push({ cells, bottom: rows > 0 ? y - ROW_GAP_PT : top })
    pageNo++
    if (o.count === 0) break
  }

  return { width: w, height: h, margin: m, contentW, title, nameLine, cellW, cellH, figureH, rowsFirst, rowsRest, pages }
}

const ROMAN_FREE = 'abcdefghijklmnopqrstuvwxyz'

/** The automatic label of the i-th figure: "(a)", "1." … or ''. */
export function autoLabel(i: number, numbering: SheetNumbering): string {
  if (numbering === 'none') return ''
  if (numbering === '1') return `${i + 1}.`
  // a … z, then aa, ab … — a sheet of 60 never runs out.
  let n = i
  let s = ''
  do {
    s = ROMAN_FREE[n % 26] + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return `(${s})`
}

/** The label printed for an item: its own override, else the automatic one. */
export function itemLabel(i: number, numbering: SheetNumbering, own?: string): string {
  const t = own?.trim()
  return t ? t : autoLabel(i, numbering)
}

/**
 * Where a figure of `w` x `h` (any units) sits inside a box: scaled to fit,
 * centred across, at the top of the box (so labels line up along a row).
 */
export function fitInBox(w: number, h: number, box: RectPt): { x: number; y: number; scale: number } {
  const s = Math.min(box.w / Math.max(1e-6, w), box.h / Math.max(1e-6, h))
  return { x: box.x + (box.w - w * s) / 2, y: box.y, scale: s }
}

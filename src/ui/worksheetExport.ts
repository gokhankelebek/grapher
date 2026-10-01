// ============================================================================
// src/ui/worksheetExport.ts — a worksheet as pages, a PDF and LaTeX.
//
//   figures    each item's document drawn by its own export scene
//              (./docScene.ts) at the PHYSICAL width of its cell, so a label
//              that is 8 pt in the document's own PDF is 8 pt on the sheet;
//   pages      DisplayLists in points (./worksheetLayout.ts): the figures
//              placed into their cells, plus the title, the name/date line,
//              the (a)(b)(c) labels and the captions as text — one list per
//              page, written by the existing PDF writer (multi-page), by the
//              SVG writer for the editor's preview, and replayed onto a
//              canvas for the PNG;
//   LaTeX      a snippet: a header comment with the preamble, the title, the
//              name/date line, then a grid of minipages, each holding its
//              figure's TikZ (the document's own TikZ export at that cell's
//              width) or, in the pgfplots variant, its pgfplots axis.
//
// The answer key is a property of the FIGURES (./docScene.ts `answers`): off,
// every analysis marker, label and intersection chip is cleared from every
// scene — the student version; on, they are drawn — the key.
// ============================================================================

import type { FigureStyleId } from '../core/types'
import type { Worksheet, WorksheetItem } from '../core/persist'
import { DEFAULT_SHEET_STYLE } from '../core/persist'
import type { DisplayList } from '../render/vectorCtx'
import { toPdfPages } from '../render/vectorPdf'
import { toSvg } from '../render/vectorSvg'
import { toTikz } from '../render/vectorTikz'
import { texEscapeText, texLabel } from '../render/texText'
import { GREY, addClip, addLine, addRect, addText, emptyPage, measure, placeList, wrapText } from '../render/vectorPage'
import type { DocFigure, DocModel } from './docScene'
import { docFigure, recordFigure } from './docScene'
import type { SheetLayout } from './worksheetLayout'
import { GUTTER_PT, TITLE_SIZE_PT, fitInBox, itemLabel, layoutSheet, pageSize } from './worksheetLayout'
import { PGFPLOTS_FILLBETWEEN, PGFPLOTS_PREAMBLE, toPgfplots } from './pgfplotsExport'
import { PX_PER_CM } from './vectorExport'

/** CSS px → pt. */
const PT_PER_PX = 0.75
const PT_PER_CM = 72 / 2.54

export const LABEL_SIZE_PT = 11
export const CAPTION_SIZE_PT = 10
export const NAME_SIZE_PT = 11

/** The style an item is drawn in. */
export function itemStyle(sheet: Worksheet, item: WorksheetItem): FigureStyleId {
  return item.style ?? sheet.style ?? DEFAULT_SHEET_STYLE
}

/** One cell's figure, ready to place — or the reason there is none. */
export interface SheetFigure {
  item: WorksheetItem
  label: string
  /** Null when the document is gone or could not be read. */
  figure: DocFigure | null
  /** The recorded figure, CSS px. */
  list: DisplayList | null
  /** Physical width the figure was drawn at, cm. */
  widthCm: number
  missing?: string
}

/** Look up a document's model; null = not in storage / unreadable. */
export type ModelLookup = (docId: string) => DocModel | null

export function sheetLayoutFor(sheet: Worksheet): SheetLayout {
  return layoutSheet({
    page: sheet.page,
    orientation: sheet.orientation,
    cols: sheet.cols,
    count: sheet.items.length,
    hasTitle: !!sheet.title && sheet.title.trim() !== '',
    nameLine: sheet.nameLine !== false,
    hasCaptions: sheet.items.some((i) => !!i.caption && i.caption.trim() !== ''),
  })
}

/**
 * Draw every item's figure at the size of its cell. A figure is first drawn
 * at the cell's width; when its own aspect makes it taller than the box it is
 * drawn again, narrower, so its type stays at its stated size rather than
 * being shrunk with the picture.
 */
export function sheetFigures(
  sheet: Worksheet,
  lookup: ModelLookup,
  answers: boolean,
  layout: SheetLayout = sheetLayoutFor(sheet),
): SheetFigure[] {
  const boxW = layout.cellW
  const boxH = layout.figureH
  return sheet.items.map((item, i) => {
    const label = itemLabel(i, sheet.numbering, item.label)
    const model = lookup(item.docId)
    if (!model) {
      return { item, label, figure: null, list: null, widthCm: 0, missing: 'This document is no longer saved.' }
    }
    const style = itemStyle(sheet, item)
    // The cell's own caption replaces the document's: one line under a figure.
    const caption = item.caption && item.caption.trim() !== '' ? '' : undefined
    const draw = (widthCm: number): { figure: DocFigure; list: DisplayList } => {
      const figure = docFigure(model, { style, answers, widthCm, caption })
      return { figure, list: recordFigure(figure) }
    }
    // Physical widths are stated to 0.1 cm (clampLatexWidth rounds), so round
    // DOWN: a figure never comes out wider than its cell.
    const tenth = (cm: number): number => Math.max(3, Math.floor(cm * 10 + 1e-9) / 10)
    let widthCm = tenth(boxW / PT_PER_CM)
    let got = draw(widthCm)
    const hPt = got.list.height * PT_PER_PX
    if (hPt > boxH + 0.5) {
      widthCm = tenth((widthCm * boxH) / hPt)
      got = draw(widthCm)
    }
    return { item, label, figure: got.figure, list: got.list, widthCm }
  })
}

const WHITE = { r: 255, g: 255, b: 255, a: 1 }
const FAINT = { r: 160, g: 160, b: 160, a: 1 }

/** The pages, as display lists in points. */
export function composeSheet(sheet: Worksheet, figures: readonly SheetFigure[], layout: SheetLayout = sheetLayoutFor(sheet)): DisplayList[] {
  const pages: DisplayList[] = []
  layout.pages.forEach((pl, pageNo) => {
    const page = emptyPage(layout.width, layout.height)
    addRect(page, { x: 0, y: 0, w: layout.width, h: layout.height }, WHITE)
    if (pageNo === 0) {
      if (layout.title && sheet.title) {
        addText(page, sheet.title, layout.title.x + layout.title.w / 2, layout.title.y + TITLE_SIZE_PT, {
          size: TITLE_SIZE_PT,
          bold: true,
          anchor: 'middle',
        })
      }
      if (layout.nameLine) {
        const r = layout.nameLine
        const base = r.y + 17
        const o = { size: NAME_SIZE_PT }
        const nameW = measure('Name:', o)
        const dateW = measure('Date:', o)
        const dateLine = 110
        addText(page, 'Name:', r.x, base, o)
        addLine(page, r.x + nameW + 4, base + 1.5, r.x + r.w * 0.6, base + 1.5, 0.6)
        const dx = r.x + r.w - dateLine - dateW - 4
        addText(page, 'Date:', dx, base, o)
        addLine(page, r.x + r.w - dateLine, base + 1.5, r.x + r.w, base + 1.5, 0.6)
      }
    }
    for (const c of pl.cells) {
      const f = figures[c.index]
      if (!f) continue
      if (f.label) addText(page, f.label, c.label.x, c.label.y, { size: LABEL_SIZE_PT, bold: true })
      if (f.list) {
        const fit = fitInBox(f.list.width * PT_PER_PX, f.list.height * PT_PER_PX, c.figure)
        const clip = addClip(page, c.figure)
        placeList(page, f.list, { x: fit.x, y: fit.y, scale: fit.scale * PT_PER_PX }, clip)
      } else {
        const r = c.figure
        page.items.push({
          t: 'path',
          segs: [
            { k: 'M', x: r.x, y: r.y },
            { k: 'L', x: r.x + r.w, y: r.y },
            { k: 'L', x: r.x + r.w, y: r.y + r.h },
            { k: 'L', x: r.x, y: r.y + r.h },
            { k: 'Z' },
          ],
          fill: null,
          stroke: { color: FAINT, width: 0.75, cap: 'butt', join: 'miter', miter: 10, dash: [4, 3], dashOffset: 0 },
          clip: 0,
        })
        addText(page, f.missing ?? 'Missing figure', r.x + r.w / 2, r.y + r.h / 2, {
          size: 10,
          italic: true,
          anchor: 'middle',
          color: GREY,
        })
      }
      const cap = f.item.caption?.trim()
      if (cap && c.caption.h > 0) {
        const o = { size: CAPTION_SIZE_PT, anchor: 'middle' as const }
        const lines = wrapText(cap, c.caption.w - 4, o, 2)
        lines.forEach((line, k) => {
          addText(page, line, c.caption.x + c.caption.w / 2, c.caption.y + 11 + k * 12, o)
        })
      }
    }
    pages.push(page)
  })
  return pages
}

/** Everything one export of a sheet needs, built once. */
export function buildSheet(sheet: Worksheet, lookup: ModelLookup, answers: boolean): { layout: SheetLayout; figures: SheetFigure[]; pages: DisplayList[] } {
  const layout = sheetLayoutFor(sheet)
  const figures = sheetFigures(sheet, lookup, answers, layout)
  return { layout, figures, pages: composeSheet(sheet, figures, layout) }
}

/** The sheet as PDF bytes: one page per page of the layout, vector throughout. */
export function sheetPdf(sheet: Worksheet, lookup: ModelLookup, answers: boolean): Uint8Array {
  const { pages } = buildSheet(sheet, lookup, answers)
  return toPdfPages(pages, { ptPerPx: 1, title: sheet.title || sheet.name })
}

/** One page as SVG (the editor's preview), at `pixelWidth` on screen. */
export function pageSvg(page: DisplayList, pixelWidth: number): string {
  return toSvg(page, { pixelWidth, pixelHeight: (pixelWidth * page.height) / page.width })
}

// ---------------------------------------------------------------------------
// LaTeX
// ---------------------------------------------------------------------------

export interface LatexOptions {
  /** pgfplots axes (the equations) instead of TikZ drawings (the picture). */
  pgfplots?: boolean
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g

/** Prose for TeX: no control characters, every special escaped. */
export function texText(s: string): string {
  return texEscapeText(s.replace(CONTROL, ' '))
}

/** A comment line's text: no line breaks or control characters in it. */
const commentText = (s: string): string => s.replace(/[\u0000-\u001f\u007f]+/g, ' ')

/** A picture's body: no comment header, no blank lines (it sits inside \resizebox). */
function pictureBody(src: string): string {
  return src
    .split('\n')
    .filter((l) => l.trim() !== '' && !/^\s*%/.test(l))
    .join('\n')
}

const PAGE_NAMES = { letter: 'US letter', a4: 'A4' } as const

/** The worksheet as a LaTeX snippet. */
export function sheetLatex(
  sheet: Worksheet,
  figures: readonly SheetFigure[],
  answers: boolean,
  opts: LatexOptions = {},
): string {
  const cols = sheet.cols
  const gutter = GUTTER_PT
  const width = cols === 1 ? '\\linewidth' : `\\dimexpr(\\linewidth-${(cols - 1) * gutter}pt)/${cols}\\relax`
  const { w, h } = pageSize(sheet.page, sheet.orientation)
  // Each figure's picture first: the preamble is what they need, together.
  const sources = figures.map((f) =>
    f.figure && f.list
      ? opts.pgfplots && f.figure.scene.kind !== 'number-line'
        ? toPgfplots(f.figure.scene, { widthCm: f.widthCm, sources: f.figure.sources, extraMarkers: f.figure.context })
        : toTikz(f.list)
      : null,
  )
  // (A number line has no pgfplots form: its TikZ picture goes in instead.)
  const fillBetween = sources.some((src) => src !== null && src.includes(`%   ${PGFPLOTS_FILLBETWEEN}`))
  const out: string[] = []
  const rule = `% ${'-'.repeat(72)}`
  out.push(rule)
  out.push(
    `% Grapher worksheet "${commentText(sheet.name)}": ${figures.length} figure${figures.length === 1 ? '' : 's'}, ` +
      `${cols} column${cols === 1 ? '' : 's'}, ${PAGE_NAMES[sheet.page]} ${sheet.orientation}.`,
  )
  out.push(answers ? '% ANSWER KEY: analysis markers, labels and intersections are drawn.' : '% Student version: no answers drawn.')
  out.push('% Preamble (once, in your document):')
  out.push('%   \\usepackage{tikz}       % the figures (it loads xcolor)')
  out.push('%   \\usepackage{graphicx}   % \\resizebox: a figure wider than its column shrinks to fit')
  if (opts.pgfplots) {
    for (const l of PGFPLOTS_PREAMBLE) out.push(`%   ${l}`)
    if (fillBetween) out.push(`%   ${PGFPLOTS_FILLBETWEEN}`)
  }
  out.push(
    `% Laid out for ${PAGE_NAMES[sheet.page]} ${sheet.orientation} (${(w / 72).toFixed(2)} x ${(h / 72).toFixed(2)} in), ` +
      `each column a share of \\linewidth, with`,
  )
  out.push(
    `%   \\usepackage[${sheet.page === 'a4' ? 'a4paper' : 'letterpaper'}${sheet.orientation === 'landscape' ? ',landscape' : ''},margin=0.75in]{geometry}`,
  )
  out.push(rule)

  if (sheet.title && sheet.title.trim() !== '') {
    out.push('\\begin{center}')
    out.push(`  {\\large\\bfseries ${texText(sheet.title)}}`)
    out.push('\\end{center}')
  }
  if (sheet.nameLine !== false) {
    out.push('\\noindent Name: \\rule{0.5\\linewidth}{0.4pt}\\hfill Date: \\rule{0.2\\linewidth}{0.4pt}')
    out.push('\\par\\medskip')
  }

  figures.forEach((f, i) => {
    const col = i % cols
    if (col === 0) out.push('\\noindent')
    out.push(`% ${f.label || `figure ${i + 1}`}: ${commentText(f.figure ? '' : '(missing) ')}${commentText(f.item.docId)}`)
    out.push(`\\begin{minipage}[t]{${width}}%`)
    if (f.label) out.push(`  {\\bfseries ${texText(f.label)}}\\par\\nobreak\\vspace{2pt}%`)
    out.push('  \\centering')
    const src = sources[i]
    if (src !== null) {
      const body = pictureBody(src)
      out.push('  \\resizebox{\\ifdim\\width>\\linewidth\\linewidth\\else\\width\\fi}{!}{%')
      out.push(body)
      out.push('  }%')
    } else {
      out.push(`  \\fbox{\\parbox{0.9\\linewidth}{\\centering\\itshape ${texText(f.missing ?? 'Missing figure')}}}%`)
    }
    const cap = f.item.caption?.trim()
    // A caption is a board label like any other: "y = x³ − 3" is set as
    // mathematics, prose stays prose (src/render/texText.ts).
    if (cap) out.push(`  \\par\\vspace{2pt}{\\small ${texLabel(cap.replace(CONTROL, ' '))}}%`)
    out.push('\\end{minipage}%')
    const lastInRow = col === cols - 1 || i === figures.length - 1
    if (lastInRow) out.push('\\par\\bigskip')
    else out.push(`\\hspace{${gutter}pt}%`)
  })
  return out.join('\n') + '\n'
}

/** cm → CSS px, re-exported for the editor's thumbnails. */
export const cmFromPx = (px: number): number => px / PX_PER_CM

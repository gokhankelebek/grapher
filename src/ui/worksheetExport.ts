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
// scene — the student version; on, they are drawn — the key. The key also
// says so ("ANSWER KEY" beside the title, and over every later page) and
// writes the worked answers under each figure: every answer reveal mode
// would hide, in reveal order, in Present's own words (./docAnswers.ts,
// ./sheetBlocks.ts). Answers that do not fit their cell go on after the
// figures under "Answers, continued" — never dropped.
//
// A figure that relies on a data table prints it under the figure in BOTH
// copies (WorksheetItem.table; on by default for such a figure).
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
import { GUTTER_PT, ROW_GAP_PT, TITLE_SIZE_PT, fitInBox, itemLabel, layoutSheet, pageSize } from './worksheetLayout'
import { docAnswerLines, docDataTables, relyOnTable } from './docAnswers'
import type { AnswerLine } from './revealedAnswers'
import type { KeyAnswer, TableLayout, WrappedAnswer } from './sheetBlocks'
import {
  ANSWER_LEAD_PT,
  answersHeight,
  drawAnswers,
  drawTables,
  fitAnswers,
  keyAnswers,
  labelHead,
  layoutTables,
  tablesHeight,
  wrapAnswer,
} from './sheetBlocks'
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
  /** The data tables printed under the figure (both copies), laid out for its cell. */
  tables: TableLayout[]
  /** The key: every answer on the document, in reveal order. Empty on a student copy. */
  key: KeyAnswer[]
  /** The answers printed in the cell, wrapped to its width. */
  answers: WrappedAnswer[]
  /** The answers that did not fit the cell: printed after the figures. */
  more: KeyAnswer[]
}

/** Look up a document's model; null = not in storage / unreadable. */
export type ModelLookup = (docId: string) => DocModel | null

/** Whether an item prints its document's data table: as the teacher set it, else on when the figure relies on one. */
export function includeTable(item: WorksheetItem, model: DocModel | null): boolean {
  return item.table ?? relyOnTable(model)
}

/**
 * The layout of a sheet. `answers`: the key, whose header always has a title
 * band (it says "ANSWER KEY" there). `extra`: per item, what is printed under
 * its figure (sheetFigures works it out).
 */
export function sheetLayoutFor(sheet: Worksheet, answers = false, extra?: readonly number[]): SheetLayout {
  return layoutSheet({
    page: sheet.page,
    orientation: sheet.orientation,
    cols: sheet.cols,
    count: sheet.items.length,
    hasTitle: (!!sheet.title && sheet.title.trim() !== '') || answers,
    nameLine: sheet.nameLine !== false,
    hasCaptions: sheet.items.some((i) => !!i.caption && i.caption.trim() !== ''),
    ...(extra ? { extra } : {}),
  })
}

/** A document's answers, once per document model (a sheet is rebuilt on every edit). */
const answerCache = new WeakMap<DocModel, AnswerLine[]>()
function answerLinesOf(model: DocModel, figure: DocFigure): AnswerLine[] {
  const hit = answerCache.get(model)
  if (hit) return hit
  const lines = docAnswerLines(model, { overlays: figure.scene.overlays ?? [] })
  answerCache.set(model, lines)
  return lines
}

/** What a cell prints under its figure and caption, in points. */
export function extraHeight(f: SheetFigure): number {
  return tablesHeight(f.tables) + answersHeight(f.answers)
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
  layout: SheetLayout = sheetLayoutFor(sheet, answers),
): SheetFigure[] {
  const boxW = layout.cellW
  const boxH = layout.figureH
  // A row may grow to a whole page: a cell's answers stop there and go on after the figures.
  const pageRoom = layout.height - 2 * layout.margin - layout.cellH
  return sheet.items.map((item, i) => {
    const label = itemLabel(i, sheet.numbering, item.label)
    const model = lookup(item.docId)
    if (!model) {
      return {
        item, label, figure: null, list: null, widthCm: 0, missing: 'This document is no longer saved.',
        tables: [], key: [], answers: [], more: [],
      }
    }
    const style = itemStyle(sheet, item)
    // The cell's own caption replaces the document's: one line under a figure.
    const caption = item.caption && item.caption.trim() !== '' ? '' : undefined
    const draw = (widthCm: number): { figure: DocFigure; list: DisplayList } => {
      // The key's figure leaves out its own line of answers: the cell states them all, under it.
      const figure = docFigure(model, { style, answers, widthCm, caption, ...(answers ? { keyLine: false } : {}) })
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
    const tables = includeTable(item, model) ? layoutTables(docDataTables(model), boxW) : []
    const key = answers ? keyAnswers(answerLinesOf(model, got.figure)) : []
    const wrapped = key.map((a) => wrapAnswer(a, boxW))
    // (Nine tenths of a page at most, so the LaTeX, set in TeX's own
    // metrics, never runs a row off the page either.)
    const { fit, rest } = fitAnswers(wrapped, Math.max(ANSWER_LEAD_PT * 3, 0.9 * pageRoom - tablesHeight(tables)))
    return { item, label, figure: got.figure, list: got.list, widthCm, tables, key, answers: fit, more: rest }
  })
}

const WHITE = { r: 255, g: 255, b: 255, a: 1 }
const FAINT = { r: 160, g: 160, b: 160, a: 1 }

/** The key's mark: beside the title on page 1, over every later page. */
export const KEY_MARK = 'ANSWER KEY'
const KEY_RED = { r: 176, g: 20, b: 20, a: 1 }
const KEY_SIZE_PT = 11
/** "Answers, continued": the heading of what did not fit under its figure. */
export const MORE_HEADING = 'Answers, continued'

/** The boxed "ANSWER KEY" with its left edge at x, baseline at y; returns its width. */
function keyBadge(page: DisplayList, x: number, base: number, size = KEY_SIZE_PT): number {
  const o = { size, bold: true, color: KEY_RED }
  const w = measure(KEY_MARK, o) + 10
  const r = { x, y: base - size * 0.95, w, h: size * 1.35 }
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
    stroke: { color: KEY_RED, width: 1, cap: 'butt', join: 'miter', miter: 10, dash: [], dashOffset: 0 },
    clip: 0,
  })
  addText(page, KEY_MARK, x + 5, base, o)
  return w
}

/** The pages, as display lists in points. */
export function composeSheet(
  sheet: Worksheet,
  figures: readonly SheetFigure[],
  layout: SheetLayout = sheetLayoutFor(sheet),
  answers = false,
): DisplayList[] {
  const pages: DisplayList[] = []
  const title = sheet.title?.trim() ?? ''
  const newPage = (): DisplayList => {
    const page = emptyPage(layout.width, layout.height)
    addRect(page, { x: 0, y: 0, w: layout.width, h: layout.height }, WHITE)
    // Every later page of a key says so too: a loose page 2 is never mistaken for the student copy.
    if (answers && pages.length > 0) {
      const base = layout.margin - 18
      const right = layout.width - layout.margin
      const o = { size: 9, color: GREY }
      const lead = title ? `${title} — ` : ''
      const badgeW = measure(KEY_MARK, { size: 9, bold: true }) + 10
      if (lead) addText(page, lead, right - badgeW - 4, base, { ...o, anchor: 'end' })
      keyBadge(page, right - badgeW, base, 9)
    }
    pages.push(page)
    return page
  }
  layout.pages.forEach((pl, pageNo) => {
    const page = newPage()
    if (pageNo === 0) {
      if (layout.title) {
        const base = layout.title.y + TITLE_SIZE_PT
        const centre = layout.title.x + layout.title.w / 2
        const to = { size: TITLE_SIZE_PT, bold: true }
        if (answers) {
          // The title and the badge, centred together as one line.
          // (Bold serif is measured with the regular face's metrics, which run
          // narrow: allow for the bold's extra width so the badge never touches it.)
          const tw = title ? measure(title, to) * 1.1 : 0
          const bw = measure(KEY_MARK, { size: KEY_SIZE_PT, bold: true }) + 10
          const gap = title ? 12 : 0
          const left = Math.max(layout.title.x, centre - (tw + gap + bw) / 2)
          if (title) addText(page, title, left, base, to)
          keyBadge(page, left + tw + gap, base - 1)
        } else if (title) {
          addText(page, title, centre, base, { ...to, anchor: 'middle' })
        }
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
      // Under the caption: the data table, then (the key) the worked answers.
      let y = c.extra.y
      if (f.tables.length > 0) y = drawTables(page, f.tables, c.extra.x, c.extra.w, y)
      if (f.answers.length > 0) drawAnswers(page, f.answers, c.extra.x, y)
      if (f.more.length > 0) {
        addText(page, `continued under “${MORE_HEADING}”`, c.extra.x, y + answersHeight(f.answers) + ANSWER_LEAD_PT - 2, {
          size: 8,
          italic: true,
          color: GREY,
        })
      }
    }
  })

  // ---- what did not fit under its figure, in full-width text after the figures
  const rest = figures.filter((f) => f.more.length > 0)
  if (rest.length > 0) {
    const width = layout.contentW
    const bottom = layout.height - layout.margin
    let page = pages[pages.length - 1]
    let y = (layout.pages[layout.pages.length - 1]?.bottom ?? layout.margin) + ROW_GAP_PT
    const room = (h: number): void => {
      if (y + h <= bottom) return
      page = newPage()
      y = layout.margin
    }
    room(30)
    addText(page, MORE_HEADING, layout.margin, y + 13, { size: 12, bold: true })
    y += 18
    for (const f of rest) {
      room(ANSWER_LEAD_PT * 2 + 14)
      addText(page, f.label || 'Figure', layout.margin, y + 13, { size: LABEL_SIZE_PT, bold: true })
      y += 14
      for (const a of f.more) {
        const w = wrapAnswer(a, width)
        // An answer longer than a page is set across pages, line by line.
        for (let i = 0; i < w.lines.length; ) {
          room(ANSWER_LEAD_PT * 2)
          const k = Math.max(1, Math.min(w.lines.length - i, Math.floor((bottom - y) / ANSWER_LEAD_PT) - 1))
          y = drawAnswers(page, [{ answer: a, lines: w.lines.slice(i, i + k) }], layout.margin, y)
          i += k
        }
      }
      y += 6
    }
  }
  return pages
}

/** Everything one export of a sheet needs, built once. */
export function buildSheet(sheet: Worksheet, lookup: ModelLookup, answers: boolean): { layout: SheetLayout; figures: SheetFigure[]; pages: DisplayList[] } {
  const first = sheetLayoutFor(sheet, answers)
  const figures = sheetFigures(sheet, lookup, answers, first)
  const extra = figures.map(extraHeight)
  const layout = extra.some((e) => e > 0) ? sheetLayoutFor(sheet, answers, extra) : first
  return { layout, figures, pages: composeSheet(sheet, figures, layout, answers) }
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
        ? toPgfplots(f.figure.scene, {
            widthCm: f.widthCm,
            sources: f.figure.sources,
            extraMarkers: f.figure.context,
            ...(f.figure.keyLine === false ? { keyLine: false } : {}),
          })
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
  out.push(answers ? '% ANSWER KEY: analysis markers, labels and intersections are drawn, and the worked answers printed.' : '% Student version: no answers drawn.')
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

  const hasTitle = !!sheet.title && sheet.title.trim() !== ''
  if (hasTitle || answers) {
    out.push('\\begin{center}')
    const title = hasTitle ? `{\\large\\bfseries ${texText(sheet.title ?? '')}}` : ''
    // The key says so beside its title: a boxed, red ANSWER KEY (xcolor comes with TikZ).
    const badge = answers ? `{\\color[rgb]{0.69,0.08,0.08}\\fbox{\\bfseries ${KEY_MARK}}}` : ''
    out.push(`  ${[title, badge].filter(Boolean).join('\\quad')}`)
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
    for (const l of latexTables(f.tables)) out.push(`  ${l}`)
    for (const l of latexAnswers(f.answers.map((w) => w.answer))) out.push(`  ${l}`)
    if (f.more.length > 0) out.push(`  {\\footnotesize\\itshape continued under ${texText(`“${MORE_HEADING}”`)}}\\par%`)
    out.push('\\end{minipage}%')
    const lastInRow = col === cols - 1 || i === figures.length - 1
    if (lastInRow) out.push('\\par\\bigskip')
    else out.push(`\\hspace{${gutter}pt}%`)
  })
  // What did not fit under its figure: ordinary paragraphs, which break across pages.
  const rest = figures.filter((f) => f.more.length > 0)
  if (rest.length > 0) {
    out.push(`\\noindent{\\bfseries ${texText(MORE_HEADING)}}\\par\\smallskip`)
    for (const f of rest) {
      out.push(`\\noindent{\\bfseries ${texText(f.label || 'Figure')}}\\par`)
      for (const l of latexAnswers(f.more)) out.push(l)
      out.push('\\medskip')
    }
  }
  return out.join('\n') + '\n'
}

/** A piece of a key's text: mathematics in $…$, prose escaped (texLabel), control characters gone. */
const texPiece = (t: string): string => texLabel(t.replace(CONTROL, ' '))

/** A figure's data tables as tabulars, grouped as the PDF groups them. */
export function latexTables(tables: readonly TableLayout[]): string[] {
  const out: string[] = []
  for (const t of tables) {
    out.push('\\par\\vspace{6pt}{\\centering' + (t.size < 9 ? '\\footnotesize' : '\\small') + '%')
    if (t.named) out.push(`{\\itshape ${texText(t.table.name)}}\\par\\vspace{2pt}%`)
    t.groups.forEach((g, i) => {
      if (i > 0) out.push('\\hspace{8pt}%')
      out.push('\\begin{tabular}[t]{|c|c|}\\hline')
      // a header set on two lines (name over units) is a one-column tabular of its own
      const head = (lines: readonly string[]): string =>
        lines.length > 1
          ? `\\begin{tabular}[b]{@{}c@{}}${lines.map((l) => `\\textbf{${texPiece(l)}}`).join('\\\\')}\\end{tabular}`
          : `\\textbf{${texPiece(lines[0] ?? '')}}`
      out.push(`${head(t.head[0])} & ${head(t.head[1])}\\\\ \\hline`)
      for (const r of g) out.push(`${texPiece(r[0]) || '{}'} & ${texPiece(r[1]) || '{}'}\\\\ \\hline`)
      out.push('\\end{tabular}%')
    })
    out.push('\\par}%')
  }
  return out
}

/**
 * A value's LaTeX, broken where TeX may break the line: at the ", ", "; " and
 * " · " between its parts (outside any brackets), each part its own $…$ — one
 * long $…$ of twelve zeros cannot be broken and would run off the column.
 */
export function texValue(v: string): string {
  const parts: string[] = []
  const seps: string[] = []
  let depth = 0
  let cur = ''
  const t = v.trim()
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if ((ch === ')' || ch === ']' || ch === '}') && depth > 0) depth--
    const sep = depth === 0 ? (/^(, |; | · )/.exec(t.slice(i))?.[1] ?? null) : null
    if (sep) {
      parts.push(cur)
      seps.push(sep)
      cur = ''
      i += sep.length - 1
      continue
    }
    cur += ch
  }
  parts.push(cur)
  return parts
    .map((p, i) => texPiece(p) + (i < seps.length ? (seps[i] === ' · ' ? ' $\\cdot$ ' : `${seps[i].trim()} `) : ''))
    .join('')
}

/** The key's answers as paragraphs: the label bold, the value after it, a hanging indent. */
export function latexAnswers(list: readonly KeyAnswer[]): string[] {
  if (list.length === 0) return []
  const out = ['\\par\\vspace{4pt}{\\small\\raggedright%']
  for (const a of list) {
    out.push(`\\noindent\\hangindent=1em\\hangafter=1 \\textbf{${texPiece(labelHead(a))}} ${texValue(a.value)}\\par%`)
  }
  out.push('}%')
  return out
}

// ---------------------------------------------------------------------------
// File names
// ---------------------------------------------------------------------------

/** Names Windows will not create a file under, whatever the extension. */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

/**
 * A title as a file name every system accepts: "Unit 6 Quiz: Riemann sums" →
 * "Unit 6 Quiz - Riemann sums". Letters of every script stay; the characters
 * a file system refuses (\ / : * ? " < > |) and control characters go, as do
 * leading and trailing dots and spaces. '' when nothing usable is left.
 */
export function fileBase(s: string | undefined): string {
  if (!s) return ''
  let t = s
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s*:\s*/g, ' - ')
    .replace(/\s*[\\/]\s*/g, '-')
    .replace(/[*?"<>|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s-]+|[.\s]+$/g, '')
  if (t.length > 100) t = t.slice(0, 100).replace(/[.\s-]+$/g, '')
  if (RESERVED.test(t)) t = `${t}_`
  return t
}

/** The stem of every file a sheet exports: its title, else its name, else "worksheet". */
export function sheetFileStem(sheet: Pick<Worksheet, 'title' | 'name'>): string {
  return fileBase(sheet.title) || fileBase(sheet.name) || 'worksheet'
}

/** "Riemann sums quiz - Key.pdf", "… - Student.tex", "… - Key p2.png". */
export function sheetFileName(
  sheet: Pick<Worksheet, 'title' | 'name'>,
  answers: boolean,
  ext: 'pdf' | 'tex' | 'png',
  page?: number,
): string {
  return `${sheetFileStem(sheet)} - ${answers ? 'Key' : 'Student'}${page !== undefined ? ` p${page}` : ''}.${ext}`
}

/** cm → CSS px, re-exported for the editor's thumbnails. */
export const cmFromPx = (px: number): number => px / PX_PER_CM

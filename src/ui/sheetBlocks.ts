// ============================================================================
// src/ui/sheetBlocks.ts — what a worksheet prints UNDER a figure.
//
//   data table   the table a figure relies on (a scatter plot, calculus on a
//                table), its headers as typed — units and all — in both the
//                student copy and the key: a table problem cannot be done
//                from paper without it. Many rows wrap into side-by-side
//                column groups, each with its own header row.
//   answers      the key only: every answer reveal mode would hide on the
//                document, in reveal order, in the words Present's
//                "Revealed" panel uses (src/ui/docAnswers.ts). Answers with
//                the same label ("f · zero") are gathered on one line, in the
//                order they are revealed.
//
// Pure geometry and display-list drawing in POINTS, for the PDF, the preview
// and the PNG; worksheetExport.ts writes the LaTeX from the same layouts, so
// the two cannot group a table differently.
// ============================================================================

import type { DisplayList } from '../render/vectorCtx'
import type { TextOpts } from '../render/vectorPage'
import { addLine, addText, measure } from '../render/vectorPage'
import type { AnswerLine } from './revealedAnswers'
import { UNREADABLE } from './revealedAnswers'
import type { PrintTable } from './docAnswers'

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

/** One answer as the key prints it: a label and everything revealed under it. */
export interface KeyAnswer {
  label: string
  value: string
}

/** What the key says for an answer whose value could not be read. */
export const KEY_UNREADABLE = 'shown on the figure'

/**
 * Answer lines → the key's answers: the same label gathered on one line (in
 * reveal order, at the place of its first answer), the values joined by ", ".
 */
export function keyAnswers(lines: readonly AnswerLine[]): KeyAnswer[] {
  const out: KeyAnswer[] = []
  const at = new Map<string, number>()
  for (const l of lines) {
    const value = l.value === UNREADABLE ? (l.place === 'board' ? KEY_UNREADABLE : '') : l.value.trim()
    if (value === '') continue
    const i = at.get(l.label)
    if (i === undefined) {
      at.set(l.label, out.length)
      out.push({ label: l.label, value })
    } else if (!out[i].value.split(', ').includes(value)) {
      out[i] = { label: l.label, value: `${out[i].value}, ${value}` }
    }
  }
  return out
}

/** The label's ending: "f · zero:" — none after a label that ends in =, ≈ or : or before a value that starts with one. */
export function labelHead(a: KeyAnswer): string {
  const label = a.label.trim()
  if (/[=≈:<>]$/.test(label) || /^[=≈<>≤≥]/.test(a.value.trim())) return label
  return `${label}:`
}

/** One answer as one line of plain text: "f · zero: −√3, 0, √3". */
export function keyAnswerText(a: KeyAnswer): string {
  return `${labelHead(a)} ${a.value.trim()}`
}

export const ANSWER_SIZE_PT = 9
export const ANSWER_LEAD_PT = 11
/** The second and later lines of one answer sit this far in. */
const HANG_PT = 10
/** Space above the answers (under a table or the caption). */
export const ANSWERS_GAP_PT = 5

/** A run of one weight within one printed line. */
export interface Run {
  text: string
  bold: boolean
}

/** One answer, wrapped: its lines, each a list of runs. */
export interface WrappedAnswer {
  answer: KeyAnswer
  lines: Run[][]
}

// Sans, as the figures' own labels are — and the one face whose bold the
// PDF's metrics measure exactly, so a bold label never runs into its value.
const opts = (bold: boolean): TextOpts => ({ size: ANSWER_SIZE_PT, bold, generic: 'sans-serif' })

/** Split a word wider than `width` into pieces that fit (never dropped). */
function hardSplit(word: string, width: number, bold: boolean): string[] {
  if (measure(word, opts(bold)) <= width) return [word]
  const out: string[] = []
  let cur = ''
  for (const ch of word) {
    if (cur && measure(cur + ch, opts(bold)) > width) {
      out.push(cur)
      cur = ch
    } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}

/** Wrap one answer into lines no wider than `width`: label bold, value regular, a hanging indent. */
export function wrapAnswer(a: KeyAnswer, width: number): WrappedAnswer {
  const words: Run[] = []
  for (const w of labelHead(a).split(/\s+/).filter(Boolean)) words.push({ text: w, bold: true })
  for (const w of a.value.trim().split(/\s+/).filter(Boolean)) words.push({ text: w, bold: false })
  const lines: Run[][] = []
  let line: Run[] = []
  let used = 0
  const room = (): number => (lines.length === 0 ? width : width - HANG_PT)
  const space = measure(' ', opts(false))
  for (const word of words) {
    for (const piece of hardSplit(word.text, Math.max(20, width - HANG_PT), word.bold)) {
      const w = measure(piece, opts(word.bold))
      if (line.length > 0 && used + space + w > room()) {
        lines.push(line)
        line = []
        used = 0
      }
      const last = line[line.length - 1]
      if (!last) line.push({ text: piece, bold: word.bold })
      else if (last.bold === word.bold) last.text += ` ${piece}`
      else line.push({ text: ` ${piece}`, bold: word.bold })
      used += last ? space + w : w
    }
  }
  if (line.length > 0) lines.push(line)
  return { answer: a, lines }
}

/** The height of wrapped answers, gap included (0 for none). */
export function answersHeight(list: readonly WrappedAnswer[]): number {
  const n = list.reduce((s, a) => s + a.lines.length, 0)
  return n === 0 ? 0 : ANSWERS_GAP_PT + n * ANSWER_LEAD_PT
}

/**
 * Keep what fits in `maxH` (whole answers while they fit; a first answer
 * taller than that is cut between its lines) and return the rest, which the
 * sheet prints after the figures — never dropped.
 */
export function fitAnswers(list: readonly WrappedAnswer[], maxH: number): { fit: WrappedAnswer[]; rest: KeyAnswer[] } {
  const fit: WrappedAnswer[] = []
  let h = ANSWERS_GAP_PT
  for (let i = 0; i < list.length; i++) {
    const a = list[i]
    const ah = a.lines.length * ANSWER_LEAD_PT
    if (h + ah <= maxH + 1e-6) {
      fit.push(a)
      h += ah
      continue
    }
    const later = list.slice(i + 1).map((w) => w.answer)
    if (fit.length === 0) {
      const k = Math.floor((maxH - h) / ANSWER_LEAD_PT)
      if (k >= 1 && k < a.lines.length) {
        // The rest of this one answer goes on after the figures, said to be continued.
        fit.push({ answer: a.answer, lines: a.lines.slice(0, k) })
        const value = a.lines
          .slice(k)
          .map((line) => line.map((r) => r.text).join(''))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
        return { fit, rest: [{ label: `${a.answer.label} (continued)`, value }, ...later] }
      }
    }
    return { fit, rest: [a.answer, ...later] }
  }
  return { fit, rest: [] }
}

/** Draw wrapped answers with their top at `y` (the gap included). Returns the y under them. */
export function drawAnswers(page: DisplayList, list: readonly WrappedAnswer[], x: number, y: number): number {
  let base = y + ANSWERS_GAP_PT
  for (const a of list) {
    a.lines.forEach((line, i) => {
      base += ANSWER_LEAD_PT
      let cx = x + (i === 0 ? 0 : HANG_PT)
      for (const r of line) {
        // A run's leading space is an advance, not a glyph: SVG would collapse it.
        const lead = r.text.length - r.text.trimStart().length
        if (lead > 0) cx += measure(r.text.slice(0, lead), opts(r.bold))
        const t = r.text.trimStart()
        addText(page, t, cx, base - 2, opts(r.bold))
        cx += measure(t, opts(r.bold))
      }
    })
  }
  return base
}

// ---------------------------------------------------------------------------
// Data tables
// ---------------------------------------------------------------------------

const SANS = 'sans-serif' as const
export const TABLE_SIZE_PT = 9
export const TABLE_ROW_PT = 12.5
/** A column group holds at most this many rows before the table wraps into another group. */
export const TABLE_ROWS_MAX = 8
const CELL_PAD_PT = 5
const GROUP_GAP_PT = 10
/** Space above a table (under the caption) and between two tables. */
export const TABLE_GAP_PT = 6
const MIN_TABLE_SIZE_PT = 6.5

/** One table, laid out: its rows split into side-by-side groups of the same columns. */
export interface TableLayout {
  table: PrintTable
  /** The rows of each group, in order. */
  groups: [string, string][][]
  /** The two column widths, shared by every group. */
  colW: [number, number]
  /** The type size (smaller only when even one group is wider than the cell). */
  size: number
  /** The whole table's width and height (its name line included). */
  width: number
  height: number
  /** Whether its name is printed over it (only when a figure has several tables). */
  named: boolean
  /** Each header as printed: one line, or its name over its units ("r(t)" / "(gal/min)"). */
  head: [string[], string[]]
}

/**
 * A header on one line, or — when it is wider than the column's values —
 * its name over its units, the way AP tables print "r(t)" over "(gallons per hour)".
 */
export function headerLines(h: string, values: readonly string[], size: number): string[] {
  const m = /^(.*\S)\s+(\([^()]*\))$/.exec(h.trim())
  if (!m) return [h]
  const widest = Math.max(0, ...values.map((v) => measure(v, { size, generic: SANS })))
  return measure(h, { size, bold: true, generic: SANS }) > widest + 2 * CELL_PAD_PT ? [m[1], m[2]] : [h]
}

/** Lay out a figure's tables for a cell `width` points wide. */
export function layoutTables(tables: readonly PrintTable[], width: number): TableLayout[] {
  const named = tables.length > 1
  return tables.map((t) => {
    const n = t.rows.length
    const headOf = (size: number): [string[], string[]] => [
      headerLines(t.headers[0], t.rows.map((r) => r[0]), size),
      headerLines(t.headers[1], t.rows.map((r) => r[1]), size),
    ]
    const natural = (size: number): [number, number] => {
      const head = { size, bold: true, generic: SANS }
      const cell = { size, generic: SANS }
      const [h0, h1] = headOf(size)
      const w0 = Math.max(...h0.map((l) => measure(l, head)), ...t.rows.map((r) => measure(r[0], cell)))
      const w1 = Math.max(...h1.map((l) => measure(l, head)), ...t.rows.map((r) => measure(r[1], cell)))
      return [w0 + 2 * CELL_PAD_PT, w1 + 2 * CELL_PAD_PT]
    }
    let size = TABLE_SIZE_PT
    let colW = natural(size)
    const one = colW[0] + colW[1]
    if (one > width) {
      size = Math.max(MIN_TABLE_SIZE_PT, (TABLE_SIZE_PT * width) / one)
      colW = natural(size)
    }
    const groupW = colW[0] + colW[1]
    const fitAcross = Math.max(1, Math.floor((width + GROUP_GAP_PT) / (groupW + GROUP_GAP_PT)))
    const wanted = Math.ceil(n / TABLE_ROWS_MAX)
    const count = Math.max(1, Math.min(fitAcross, wanted))
    const per = Math.ceil(n / count)
    const groups: [string, string][][] = []
    for (let i = 0; i < n; i += per) groups.push(t.rows.slice(i, i + per))
    const head = headOf(size)
    const headRows = Math.max(head[0].length, head[1].length)
    const rowPt = (TABLE_ROW_PT * size) / TABLE_SIZE_PT
    const height = (per + headRows) * rowPt + (named ? rowPt : 0)
    const w = groups.length * groupW + (groups.length - 1) * GROUP_GAP_PT
    return { table: t, groups, colW, size, width: w, height, named, head }
  })
}

/** The height of a figure's tables, gaps included (0 for none). */
export function tablesHeight(list: readonly TableLayout[]): number {
  return list.reduce((s, t) => s + TABLE_GAP_PT + t.height, 0)
}

const LINE = { r: 0, g: 0, b: 0, a: 1 }

/** Draw a figure's tables, centred in [x, x + width], top at y. Returns the y under them. */
export function drawTables(page: DisplayList, list: readonly TableLayout[], x: number, width: number, y: number): number {
  let top = y
  for (const t of list) {
    top += TABLE_GAP_PT
    const rowPt = (TABLE_ROW_PT * t.size) / TABLE_SIZE_PT
    const base = (row: number): number => top + row * rowPt + rowPt * 0.72
    let left = x + (width - t.width) / 2
    if (t.named) {
      addText(page, t.table.name, x + width / 2, base(0), { size: t.size, italic: true, anchor: 'middle', generic: SANS })
      top += rowPt
    }
    const [w0, w1] = t.colW
    const hr = Math.max(t.head[0].length, t.head[1].length)
    for (const g of t.groups) {
      const rows = g.length + hr
      const bottom = top + rows * rowPt
      // the rules: a box, the header's underline, a line between rows, the column divider
      for (let r = hr; r <= rows; r++) addLine(page, left, top + r * rowPt, left + w0 + w1, top + r * rowPt, r === hr ? 0.9 : 0.5, LINE)
      addLine(page, left, top, left + w0 + w1, top, 0.5, LINE)
      addLine(page, left, top, left, bottom, 0.5, LINE)
      addLine(page, left + w0, top, left + w0, bottom, 0.5, LINE)
      addLine(page, left + w0 + w1, top, left + w0 + w1, bottom, 0.5, LINE)
      const cell = (text: string, col: 0 | 1, row: number, bold: boolean): void => {
        const cx = left + (col === 0 ? w0 / 2 : w0 + w1 / 2)
        addText(page, text, cx, base(row), { size: t.size, bold, anchor: 'middle', generic: SANS })
      }
      // a one-line header sits on the header's last line, beside a two-line one
      for (const col of [0, 1] as const) {
        const lines = t.head[col]
        lines.forEach((l, k) => cell(l, col, hr - lines.length + k, true))
      }
      g.forEach((r, i) => {
        cell(r[0], 0, i + hr, false)
        cell(r[1], 1, i + hr, false)
      })
      left += w0 + w1 + GROUP_GAP_PT
    }
    const per = Math.max(...t.groups.map((g) => g.length))
    top += (per + hr) * rowPt
  }
  return top
}

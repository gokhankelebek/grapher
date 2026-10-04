// ============================================================================
// src/ui/tableCalcLinks.ts — "Calculus on this table": what a data table's
// card, the board, reveal mode, the description and the exports say about it.
//
// The mathematics is src/core/tableCalc.ts. What the DOCUMENT keeps is the
// teacher's choices (BoardData.calc, a TableCalcView): which tools are on, the
// method, the interval or pair of rows by their x VALUES, a typed c or target
// value, and whether the problem grants that r is differentiable. Everything
// shown — sums, quotients, theorems, the rectangles on the board — is worked
// out again from the rows on every change, so editing a cell re-does the sum.
//
//   readTable(d)                 the rows as points, or why calculus waits
//                                (fewer than two rows, x not increasing — with
//                                "Sort by x" — or an x that repeats)
//   tableCalcCard(d)             everything the card prints
//   tableCalcOverlays(data)      the rectangles / trapezoids, the secants, the
//                                average-value line and the answer chips
//   tableCalcKeys(d)             reveal mode's keys, in card order
//   tableCalcSentences(data)     the description's sentences (answers flagged)
//   tableCalcAnswer(d, part)     one key's line for presentation's panel
//   sortRowsByX(rows)            "Sort by x"
//   turnOn(d, part)              a tool's settings when it is switched on
//
// Pure: no React, no DOM.
// ============================================================================

import type { BoardData, DataRow, TableCalcView } from '../core/persist'
import { normalizeTableCalc } from '../core/persist'
import type { Overlay, OverlayRect } from '../render/overlays'
import { MARK_LINE_WIDTH, OVERLAY_FILL_ALPHA, OVERLAY_RECT_LINE_WIDTH } from '../render/overlays'
import type { AvgOk, CalcNo, DerivOk, IvtResult, MvtResult, Num, SumMethod, SumResult, TableNames, TablePt } from '../core/tableCalc'
import {
  SUM_LETTER,
  SUM_METHODS,
  SUM_NAME,
  cellText,
  nAdd,
  nCmp,
  nDiv,
  numF,
  numInt,
  numOfCell,
  numText,
  qDecimal,
  qParse,
  qToNumber,
  sumTex,
  tableAverage,
  tableDerivative,
  tableIvt,
  tableMvt,
  tableNames,
  tableSum,
  ap3,
} from '../core/tableCalc'
import { cellNumber } from './dataLinks'
import { parseNumeric } from './numeric'
import type { TableCalcPart } from './reveal'
import { tableCalcKey } from './reveal'

export type { TableCalcPart, TableCalcView }
export { tableCalcKey }

/** The tools, in card (and teaching) order. */
export const TABLE_CALC_PARTS: readonly TableCalcPart[] = ['sum', 'deriv', 'avg', 'mvt', 'ivt']

/** What each tool is called on the card, in the panel and in the palette. */
export const TABLE_CALC_WORD: Record<TableCalcPart, string> = {
  sum: 'Riemann / trapezoidal sum',
  deriv: 'derivative estimate',
  avg: 'average value',
  mvt: 'Mean Value Theorem',
  ivt: 'Intermediate Value Theorem',
}

const MINUS = '−'

// ---------------------------------------------------------------------------
// The rows
// ---------------------------------------------------------------------------

export type TableRead =
  | { ok: true; pts: TablePt[]; names: TableNames }
  | {
      ok: false
      names: TableNames
      /** Why calculus waits, in a sentence. */
      text: string
      /** "Sort by x" would fix it. */
      canSort: boolean
    }

/** A table's rows as points for calculus: every row with both cells, in order, x strictly increasing. */
export function readTable(d: BoardData): TableRead {
  const names = tableNames(d.xLabel, d.yLabel)
  const pts: TablePt[] = []
  const rowOf: number[] = []
  d.rows.forEach((r, i) => {
    const x = cellNumber(r.x)
    const y = cellNumber(r.y)
    if (x === null || y === null) return
    const xn = numOfCell(r.x, x)
    const yn = numOfCell(r.y, y)
    pts.push({ x: xn, y: yn, xText: cellText(r.x, xn), yText: cellText(r.y, yn) })
    rowOf.push(i + 1)
  })
  const a = names.arg
  if (pts.length < 2) {
    return { ok: false, names, canSort: false, text: 'Calculus on a table needs at least two rows with both values.' }
  }
  // An x that repeats cannot be fixed by sorting: a table of a function has each x once.
  const seen = new Map<number, number>()
  for (let k = 0; k < pts.length; k++) {
    const prev = seen.get(pts[k].x.v)
    if (prev !== undefined) {
      return {
        ok: false,
        names,
        canSort: false,
        text: `${a} = ${pts[k].xText} appears twice (rows ${rowOf[prev]} and ${rowOf[k]}). Calculus on a table needs each ${a} once: a function has one value at each input.`,
      }
    }
    seen.set(pts[k].x.v, k)
  }
  for (let k = 1; k < pts.length; k++) {
    if (nCmp(pts[k].x, pts[k - 1].x) <= 0) {
      return {
        ok: false,
        names,
        canSort: true,
        text: `${a} must increase down the table: row ${rowOf[k]} (${a} = ${pts[k].xText}) comes after ${a} = ${pts[k - 1].xText}.`,
      }
    }
  }
  return { ok: true, pts, names }
}

/**
 * "Sort by x": the rows in increasing x, ties and all in their own order;
 * a row whose x is not a number (or blank) keeps its place after them.
 */
export function sortRowsByX(rows: readonly DataRow[]): DataRow[] {
  const keyed = rows.map((r, i) => ({ r, i, x: cellNumber(r.x) }))
  const nums = keyed.filter((k) => k.x !== null).sort((p, q) => (p.x as number) - (q.x as number) || p.i - q.i)
  const rest = keyed.filter((k) => k.x === null)
  return [...nums, ...rest].map((k) => ({ x: k.r.x, y: k.r.y }))
}

/** A row index by its x value (what the settings store), or -1. */
function indexOfX(pts: readonly TablePt[], x: number | undefined): number {
  if (x === undefined) return -1
  return pts.findIndex((p) => p.x.v === x || Math.abs(p.x.v - x) <= 1e-12 * Math.max(1, Math.abs(x)))
}

/** An interval [a, b] from stored x values: absent ends are the table's; a lost one says so. */
function interval(pts: readonly TablePt[], o: { a?: number; b?: number } | undefined): { i: number; j: number; lost: string | null } {
  const last = pts.length - 1
  let i = o?.a === undefined ? 0 : indexOfX(pts, o.a)
  let j = o?.b === undefined ? last : indexOfX(pts, o.b)
  let lost: string | null = null
  if (i < 0 || j < 0 || i >= j) {
    lost = 'The rows this used are no longer in the table, so it uses the whole table.'
    i = 0
    j = last
  }
  return { i, j, lost }
}

/** A typed number (c, a target value): exact when it is a plain rational. */
export function typedNum(text: string | undefined): Num | null {
  if (text === undefined || text.trim() === '') return null
  const q = qParse(text)
  if (q) return { v: qToNumber(q), q }
  const v = parseNumeric(text)
  return v === null || !Number.isFinite(v) ? null : numF(v)
}

/** A typed value as the working prints it: "6", "−2.5", or the number it reads as. */
function typedText(text: string, n: Num): string {
  const t = text.trim()
  if (/^[-+−]?(\d+\.?\d*|\.\d+)$/.test(t)) return t.replace(/^\+/, '').replace(/^-/, MINUS)
  return numText(n)
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export interface SumCard {
  method: SumMethod
  i: number
  j: number
  result: SumResult
  /** The aligned TeX block (Σ form, terms, value), when the sum exists. */
  tex: string | null
  /** The other methods on the same interval: "R₄ = 81.3", or why not. */
  others: { method: SumMethod; chip: string | null; why: string | null }[]
  lost: string | null
}

export interface DerivCard {
  /** c as typed. */
  c: string
  result: DerivOk | CalcNo
}

export interface AvgCard {
  i: number
  j: number
  result: AvgOk | CalcNo
  /** The trapezoidal sum's TeX block. */
  trapTex: string | null
  lost: string | null
}

export interface MvtCard {
  i: number
  j: number
  result: MvtResult | CalcNo
  lost: string | null
}

export interface IvtCard {
  i: number
  j: number
  /** The target as typed ('' when none yet). */
  y: string
  result: IvtResult | CalcNo
  lost: string | null
}

export interface TableCalcCard {
  read: TableRead
  /** The rows' x values, for the pickers. */
  xs: { v: number; text: string }[]
  /** "r", "t", and the table's interval "[0, 12]". */
  fn: string
  arg: string
  span: string
  /** The teacher granted that r is differentiable. */
  diff: boolean
  sum: SumCard | null
  deriv: DerivCard | null
  avg: AvgCard | null
  mvt: MvtCard | null
  ivt: IvtCard | null
  /** Some tool is on. */
  any: boolean
}

const okOf = <T extends { ok?: boolean }>(r: T | CalcNo): r is T => r.ok !== false

/** Everything "Calculus on this table" prints for this table. */
export function tableCalcCard(d: BoardData): TableCalcCard {
  const read = readTable(d)
  const v: TableCalcView = d.calc ?? {}
  const any = TABLE_CALC_PARTS.some((p) => partOn(v, p))
  const names = read.names
  const base: TableCalcCard = {
    read,
    xs: [],
    fn: names.fn,
    arg: names.arg,
    span: '',
    diff: v.diff === true,
    sum: null,
    deriv: null,
    avg: null,
    mvt: null,
    ivt: null,
    any,
  }
  if (!read.ok) return base
  const pts = read.pts
  base.xs = pts.map((p) => ({ v: p.x.v, text: p.xText }))
  base.span = `[${pts[0].xText}, ${pts[pts.length - 1].xText}]`
  if (v.sum) {
    const { i, j, lost } = interval(pts, v.sum)
    const method = v.sum.m ?? 'left'
    const result = tableSum(pts, i, j, method, names)
    const others = SUM_METHODS.filter((m) => m !== method).map((m) => {
      const r = tableSum(pts, i, j, m, names)
      return r.ok ? { method: m, chip: r.chip, why: null } : { method: m, chip: null, why: r.why }
    })
    base.sum = { method, i, j, result, tex: result.ok ? sumTex(result) : null, others, lost }
  }
  if (v.der) {
    const c = typedNum(v.der.c)
    base.deriv = {
      c: v.der.c,
      result: c ? tableDerivative(pts, c, typedText(v.der.c, c), names) : { ok: false, why: `Type the ${names.arg} where ${names.fn}′ is wanted.` },
    }
  }
  if (v.avg) {
    const { i, j, lost } = interval(pts, v.avg)
    const result = tableAverage(pts, i, j, names)
    base.avg = { i, j, result, trapTex: okOf(result) ? sumTex(result.trap) : null, lost }
  }
  if (v.mvt) {
    const { i, j, lost } = interval(pts, v.mvt)
    base.mvt = { i, j, result: tableMvt(pts, i, j, v.diff === true, names), lost }
  }
  if (v.ivt) {
    const { i, j, lost } = interval(pts, v.ivt)
    const y = v.ivt.y ?? ''
    const target = typedNum(y)
    base.ivt = {
      i,
      j,
      y,
      result: target
        ? tableIvt(pts, i, j, target, typedText(y, target), v.diff === true, names)
        : { ok: false, why: `Type the value ${names.fn}(c) should take.` },
      lost,
    }
  }
  return base
}

/** Is this tool switched on in these settings? */
export function partOn(v: TableCalcView | undefined, part: TableCalcPart): boolean {
  if (!v) return false
  return part === 'sum' ? !!v.sum : part === 'deriv' ? !!v.der : part === 'avg' ? !!v.avg : part === 'mvt' ? !!v.mvt : !!v.ivt
}

/** A tool's answer exists (it is worth a reveal key): the tool is on and computed. */
function partAnswers(card: TableCalcCard, part: TableCalcPart): boolean {
  if (!card.read.ok) return false
  if (part === 'sum') return !!card.sum && card.sum.result.ok
  if (part === 'deriv') return !!card.deriv && okOf(card.deriv.result)
  if (part === 'avg') return !!card.avg && okOf(card.avg.result)
  if (part === 'mvt') return !!card.mvt && okOf(card.mvt.result)
  return !!card.ivt && okOf(card.ivt.result)
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** A table's next calculus settings: the settings, or worked out from the table as it is now. */
export type TableCalcNext = TableCalcView | undefined | ((d: BoardData) => TableCalcView | undefined)

/** A sensible start for a tool being switched on (stored as the teacher's choice from then on). */
export function turnOn(d: BoardData, part: TableCalcPart): TableCalcView {
  const v: TableCalcView = { ...(d.calc ?? {}) }
  const read = readTable(d)
  const pts = read.ok ? read.pts : []
  if (part === 'sum') v.sum = v.sum ?? {}
  else if (part === 'avg') v.avg = v.avg ?? {}
  else if (part === 'mvt') v.mvt = v.mvt ?? {}
  else if (part === 'deriv') {
    if (!v.der) {
      // between the two middle rows: a c the table has no row for, the usual question
      let c = '1'
      if (pts.length >= 2) {
        const k = Math.max(0, Math.floor((pts.length - 2) / 2))
        const mid = nDiv(nAdd(pts[k].x, pts[k + 1].x), numInt(2))
        c = plainText(mid)
      }
      v.der = { c }
    }
  } else if (!v.ivt) {
    let y = '0'
    if (pts.length >= 2) {
      const mid = nDiv(nAdd(pts[0].y, pts[pts.length - 1].y), numInt(2))
      y = plainText(mid)
    }
    v.ivt = { y }
  }
  return normalizeTableCalc(v) ?? {}
}

/** A value as a person would type it: "7", "6.2", or three places. ASCII minus. */
function plainText(n: Num): string {
  const t = n.q ? (qDecimal(n.q, 3) ?? ap3(n.v)) : ap3(n.v)
  return t.replace(MINUS, '-')
}

/** Switch a tool off. */
export function turnOff(v: TableCalcView | undefined, part: TableCalcPart): TableCalcView | undefined {
  if (!v) return undefined
  const out: TableCalcView = { ...v }
  if (part === 'sum') delete out.sum
  else if (part === 'deriv') delete out.der
  else if (part === 'avg') delete out.avg
  else if (part === 'mvt') delete out.mvt
  else delete out.ivt
  return normalizeTableCalc(out) ?? undefined
}

// ---------------------------------------------------------------------------
// Reveal mode
// ---------------------------------------------------------------------------

/** This table's answer keys, in card order — only for tools that are on and computed. */
export function tableCalcKeys(d: BoardData, card: TableCalcCard = tableCalcCard(d)): string[] {
  if (!d.calc) return []
  return TABLE_CALC_PARTS.filter((p) => partAnswers(card, p)).map((p) => tableCalcKey(d.id, p))
}

/** One key's line for presentation's "Revealed answers" panel. */
export function tableCalcAnswer(d: BoardData, part: string): { label: string; value: string | null; color: string } {
  const card = tableCalcCard(d)
  const color = d.color
  const label = `${d.name} · ${TABLE_CALC_WORD[part as TableCalcPart] ?? 'calculus'}`
  const value = ((): string | null => {
    if (part === 'sum' && card.sum?.result.ok) return `${card.sum.result.text}; ${card.sum.result.integralText}`
    if (part === 'deriv' && card.deriv && okOf(card.deriv.result)) return card.deriv.result.text
    if (part === 'avg' && card.avg && okOf(card.avg.result)) return card.avg.result.text
    if (part === 'mvt' && card.mvt && okOf(card.mvt.result)) return card.mvt.result.statement
    if (part === 'ivt' && card.ivt && okOf(card.ivt.result)) return card.ivt.result.statement
    return null
  })()
  return { label, value, color }
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

/** The rectangles or trapezoids, the secants, the average line and the chips, for every visible table. */
export function tableCalcOverlays(data: readonly BoardData[]): Overlay[] {
  const out: Overlay[] = []
  for (const d of data) {
    if (!d.visible || !d.calc) continue
    let card: TableCalcCard
    try {
      card = tableCalcCard(d)
    } catch {
      continue
    }
    if (!card.read.ok) continue
    const pts = card.read.pts
    const color = d.color
    const key = (p: TableCalcPart): string => tableCalcKey(d.id, p)

    const s = card.sum?.result
    if (s && s.ok) {
      if (s.method === 'trapezoid') {
        for (const pc of s.pieces) {
          out.push({
            kind: 'path',
            points: [
              { x: pc.x0, y: 0 },
              { x: pc.x0, y: pc.h0 },
              { x: pc.x1, y: pc.h1 },
              { x: pc.x1, y: 0 },
            ],
            closed: true,
            fill: OVERLAY_FILL_ALPHA,
            width: OVERLAY_RECT_LINE_WIDTH,
            color,
            under: true,
          })
        }
      } else {
        const rects: OverlayRect[] = s.pieces.map((pc) => ({ x0: pc.x0, x1: pc.x1, height: pc.h0 }))
        out.push({ kind: 'rects', curveId: d.id, rects, color })
      }
      const top = Math.max(0, ...s.pieces.map((pc) => Math.max(pc.h0, pc.h1)))
      out.push({
        kind: 'label',
        at: { x: (pts[s.i].x.v + pts[s.j].x.v) / 2, y: top },
        text: s.chip,
        color,
        answer: key('sum'),
      })
    }

    const dv = card.deriv?.result
    if (dv && okOf(dv)) {
      const a = { x: dv.a.x.v, y: dv.a.y.v }
      const b = { x: dv.b.x.v, y: dv.b.y.v }
      out.push({ kind: 'segment', from: a, to: b, color, width: MARK_LINE_WIDTH + 0.5 })
      const slope = (b.y - a.y) / (b.x - a.x)
      out.push({
        kind: 'label',
        at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        text: dv.chip,
        across: { slope, below: false },
        color,
        answer: key('deriv'),
      })
    }

    const av = card.avg?.result
    if (av && okOf(av) && card.avg) {
      const x0 = pts[card.avg.i].x.v
      const x1 = pts[card.avg.j].x.v
      const y = av.value.v
      out.push({ kind: 'segment', from: { x: x0, y }, to: { x: x1, y }, dashed: true, color, answer: key('avg') })
      out.push({ kind: 'label', at: { x: x1, y }, dir: { x: 1, y: -0.4 }, text: av.chip, color, answer: key('avg') })
    }

    const mv = card.mvt?.result
    if (mv && okOf(mv) && card.mvt) {
      const A = pts[card.mvt.i]
      const B = pts[card.mvt.j]
      const a = { x: A.x.v, y: A.y.v }
      const b = { x: B.x.v, y: B.y.v }
      out.push({ kind: 'segment', from: a, to: b, dashed: true, color })
      out.push({
        kind: 'label',
        at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        text: mv.chip,
        across: { slope: (b.y - a.y) / (b.x - a.x), below: true },
        color,
        answer: key('mvt'),
      })
    }

    const iv = card.ivt?.result
    if (iv && okOf(iv) && card.ivt) {
      const target = typedNum(card.ivt.y)
      if (target) {
        const x0 = pts[card.ivt.i].x.v
        const x1 = pts[card.ivt.j].x.v
        out.push({ kind: 'segment', from: { x: x0, y: target.v }, to: { x: x1, y: target.v }, dashed: true, color })
        if (iv.chip) {
          out.push({ kind: 'label', at: { x: (x0 + x1) / 2, y: target.v }, text: iv.chip, color, answer: key('ivt') })
        }
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// The description
// ---------------------------------------------------------------------------

/**
 * What the calculus on each visible table draws (always) and states (answers):
 * the same rows, the same sums, so the words and the figure cannot disagree.
 */
export function tableCalcSentences(data: readonly BoardData[]): { text: string; answer?: boolean }[] {
  const out: { text: string; answer?: boolean }[] = []
  for (const d of data) {
    if (!d.visible || !d.calc) continue
    let card: TableCalcCard
    try {
      card = tableCalcCard(d)
    } catch {
      continue
    }
    if (!card.read.ok) continue
    const pts = card.read.pts
    const f = card.fn
    const s = card.sum
    if (s && s.result.ok) {
      const r = s.result
      const span = `[${pts[s.i].xText}, ${pts[s.j].xText}]`
      const shape = r.method === 'trapezoid' ? 'trapezoids' : 'rectangles'
      const widths = r.pieces.map((pc) => fmtWidth(pc.x1 - pc.x0))
      out.push({
        text: `On ${d.name}, a ${SUM_NAME[r.method]} of ${f} over ${span} is drawn as ${r.n} ${r.n === 1 ? shape.slice(0, -1) : shape} with width${r.n === 1 ? '' : 's'} ${list(widths)}.`,
      })
      out.push({ text: `${r.text}, so ${r.integralText}.`, answer: true })
    }
    const dv = card.deriv
    if (dv && okOf(dv.result)) {
      const q = dv.result
      out.push({ text: `A secant through (${q.a.xText}, ${q.a.yText}) and (${q.b.xText}, ${q.b.yText}) estimates ${f}′(${dv.c.trim()}).` })
      out.push({ text: `The difference quotient gives ${q.text}.`, answer: true })
    }
    const av = card.avg
    if (av && okOf(av.result)) {
      out.push({ text: `The average value of ${f} on [${pts[av.i].xText}, ${pts[av.j].xText}] is estimated with a trapezoidal sum, and drawn as a dashed horizontal line.` })
      out.push({ text: `${av.result.text}.`, answer: true })
    }
    const mv = card.mvt
    if (mv && okOf(mv.result)) {
      out.push({ text: `A dashed secant joins (${pts[mv.i].xText}, ${pts[mv.i].yText}) and (${pts[mv.j].xText}, ${pts[mv.j].yText}).` })
      out.push({ text: mv.result.statement, answer: true })
    }
    const iv = card.ivt
    if (iv && okOf(iv.result)) {
      out.push({ text: `A dashed line at ${f} = ${iv.y.trim()} runs from ${card.arg} = ${pts[iv.i].xText} to ${card.arg} = ${pts[iv.j].xText}.` })
      out.push({ text: iv.result.statement, answer: true })
    }
  }
  return out
}

const fmtWidth = (w: number): string => {
  const r = Math.round(w * 1e6) / 1e6
  return String(r).replace('-', MINUS)
}

const list = (items: readonly string[]): string =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

/** The letter a sum's method writes: L, R, M, T. */
export const methodLetter = (m: SumMethod): string => SUM_LETTER[m]

// ============================================================================
// src/ui/dataLinks.ts — data tables and the regressions linked to them, as
// plain data, plus every pure question the board asks about them.
//
// src/core/data.ts already does the mathematics: reading a spreadsheet paste,
// fitting nine models the way a TI-84 does, writing a fit as a typed line.
// None of that is STATE. What the board remembers is the teacher's text — the
// cells exactly as typed — and, per regression, a LINK: which model, which
// curve draws it, how many digits. Everything visible is recomputed from
// those, every time a cell changes, which is the whole reason editing one y
// re-fits every regression on the table in place: none of the coefficients
// are stored answers that could go stale, they are questions re-asked.
//
// Pure: no React, no DOM, no canvas. The App owns the state; this owns the
// meaning of it.
// ============================================================================

import type { DataParse, RegressionKind, RegressionResult } from '../core/data'
import { fitRegression, regressionSource, suggestModels } from '../core/data'
import type { BoardData, DataMarker, DataRegression, DataRow } from '../core/persist'
import {
  REG_DIGITS_DEFAULT,
  REG_DIGITS_MAX,
  REG_DIGITS_MIN,
  clampRegDigits,
  isRegressionKind,
} from '../core/persist'
import { parseExpression } from '../core/parse'
import type { ScatterSet } from '../render/scatter'
import { parseNumeric } from './numeric'

export type { BoardData, DataMarker, DataRegression, DataRow, RegressionKind, RegressionResult }
export { REG_DIGITS_DEFAULT, REG_DIGITS_MAX, REG_DIGITS_MIN, clampRegDigits, isRegressionKind }

/** Every kind, in the order the menu lists the ones it cannot fit. */
export const REGRESSION_KINDS: readonly RegressionKind[] = [
  'linear',
  'quadratic',
  'cubic',
  'quartic',
  'exponential',
  'power',
  'logarithmic',
  'logistic',
  'sinusoidal',
]

/** What the card calls each kind. */
export const KIND_NAME: Record<RegressionKind, string> = {
  linear: 'Linear',
  quadratic: 'Quadratic',
  cubic: 'Cubic',
  quartic: 'Quartic',
  exponential: 'Exponential',
  power: 'Power',
  logarithmic: 'Logarithmic',
  logistic: 'Logistic',
  sinusoidal: 'Sinusoidal',
}

/** The TI-84 command each kind matches — what a student's calculator calls it. */
export const KIND_TI: Record<RegressionKind, string> = {
  linear: 'LinReg(ax+b)',
  quadratic: 'QuadReg',
  cubic: 'CubicReg',
  quartic: 'QuartReg',
  exponential: 'ExpReg',
  power: 'PwrReg',
  logarithmic: 'LnReg',
  logistic: 'Logistic',
  sinusoidal: 'SinReg',
}

/** The fits whose r² is cheap enough to show beside the menu item. */
const CHEAP: ReadonlySet<RegressionKind> = new Set<RegressionKind>([
  'linear',
  'quadratic',
  'cubic',
  'quartic',
  'exponential',
  'power',
  'logarithmic',
])

// ---------------------------------------------------------------------------
// Cells -> numbers
// ---------------------------------------------------------------------------

const PLAIN = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/
const THOUSANDS = /^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/

/**
 * One cell as a number, or null when it is blank or not a number.
 *
 * The teacher's own text is what is stored; this is the reading of it. Plain
 * numbers first (the fast path — a pasted column is almost all of them), a
 * real minus sign and a US thousands comma, then anything the shared numeric
 * reader accepts: "3/4", "2pi", "sqrt(2)".
 */
export function cellNumber(text: string): number | null {
  const s = String(text ?? '')
    .trim()
    .replace(/−/g, '-')
    .replace(/[   ]/g, '')
  if (s === '') return null
  if (PLAIN.test(s)) {
    const v = Number(s)
    return Number.isFinite(v) ? v : null
  }
  if (THOUSANDS.test(s)) {
    const v = Number(s.replace(/,/g, ''))
    return Number.isFinite(v) ? v : null
  }
  // A decimal comma ("2,25") — the only other shape a spreadsheet hands over.
  if (/^[-+]?\d+,\d+$/.test(s)) {
    const v = Number(s.replace(',', '.'))
    return Number.isFinite(v) ? v : null
  }
  try {
    return parseNumeric(s)
  } catch {
    return null
  }
}

export interface DataColumns {
  xs: number[]
  ys: number[]
  /** Row indices (0-based, into `rows`) the numbers came from. */
  used: number[]
  /** Rows that have text but cannot be plotted, 1-based, with the reason. */
  skipped: { row: number; reason: string }[]
}

/**
 * The rows as numbers. A row with both cells blank is not a row — it is the
 * space at the end of the table — and is skipped silently; a row with one
 * blank or one unreadable cell is skipped and SAID, with its number, so the
 * teacher can find it.
 */
export function dataColumns(rows: readonly DataRow[]): DataColumns {
  const out: DataColumns = { xs: [], ys: [], used: [], skipped: [] }
  rows.forEach((r, i) => {
    const xt = r.x.trim()
    const yt = r.y.trim()
    if (xt === '' && yt === '') return
    const x = cellNumber(xt)
    const y = cellNumber(yt)
    if (x !== null && y !== null) {
      out.xs.push(x)
      out.ys.push(y)
      out.used.push(i)
      return
    }
    const row = i + 1
    if (xt === '') out.skipped.push({ row, reason: 'x is blank' })
    else if (yt === '') out.skipped.push({ row, reason: 'y is blank' })
    else if (x === null) out.skipped.push({ row, reason: `x “${xt}” is not a number` })
    else out.skipped.push({ row, reason: `y “${yt}” is not a number` })
  })
  return out
}

/** A cell whose text is there but is not a number — marked on the grid. */
export function cellIsBad(text: string): boolean {
  return text.trim() !== '' && cellNumber(text) === null
}

/** The key a fit is cached under: the numbers and the model, nothing else. */
export function fitKey(cols: DataColumns, kind: RegressionKind): string {
  return `${kind}|${cols.xs.join(',')}|${cols.ys.join(',')}`
}

/**
 * A fit, cached on the numbers. The sync pass asks for every regression on
 * every change to the board; the table rarely changed, so the answer rarely
 * has to be recomputed (a logistic fit is a Levenberg–Marquardt run).
 */
export function makeFitCache(limit = 64): (cols: DataColumns, kind: RegressionKind) => RegressionResult {
  const cache = new Map<string, RegressionResult>()
  return (cols, kind) => {
    const key = fitKey(cols, kind)
    const hit = cache.get(key)
    if (hit) return hit
    let res: RegressionResult
    try {
      res = fitRegression(kind, cols.xs, cols.ys)
    } catch {
      res = { ok: false, kind, coef: {}, r2: NaN, residuals: [], error: 'The fit could not be computed.', notes: [] }
    }
    if (cache.size >= limit) {
      const first = cache.keys().next().value
      if (first !== undefined) cache.delete(first)
    }
    cache.set(key, res)
    return res
  }
}

// ---------------------------------------------------------------------------
// Editing rows
// ---------------------------------------------------------------------------

/**
 * Rows with one cell set. Typing in the row PAST the end appends a row — the
 * grid always shows one blank row there — and trailing rows left entirely
 * blank are trimmed, so the stored table never grows a tail of nothing.
 */
export function setCell(
  rows: readonly DataRow[],
  index: number,
  col: 'x' | 'y',
  text: string,
): DataRow[] {
  const out = rows.slice()
  while (out.length <= index) out.push({ x: '', y: '' })
  out[index] = { ...out[index], [col]: text }
  return trimTail(out)
}

/** Rows without the entirely blank rows at the end. */
export function trimTail(rows: readonly DataRow[]): DataRow[] {
  let n = rows.length
  while (n > 0 && rows[n - 1].x.trim() === '' && rows[n - 1].y.trim() === '') n--
  return rows.slice(0, n)
}

/** Rows without row `index`. */
export function removeRow(rows: readonly DataRow[], index: number): DataRow[] {
  return rows.filter((_, i) => i !== index)
}

/** A number as a cell: the shortest text that reads back as the same number. */
export function numberCell(v: number): string {
  return Number.isFinite(v) ? String(v) : ''
}

export type PasteMode = 'replace' | 'append'

/**
 * A paste applied to a table: the parsed rows replace it or go on the end.
 * On replace the header's names become the column labels; on append they do
 * only when the table's own labels are still the defaults.
 */
export function applyPaste(
  data: Pick<BoardData, 'rows' | 'xLabel' | 'yLabel'>,
  parse: DataParse,
  mode: PasteMode,
): { rows: DataRow[]; xLabel: string; yLabel: string } {
  const pasted: DataRow[] = parse.xs.map((x, i) => ({ x: numberCell(x), y: numberCell(parse.ys[i]) }))
  const headed = parse.xLabel !== 'x' || parse.yLabel !== 'y'
  if (mode === 'replace') {
    return { rows: pasted, xLabel: parse.xLabel, yLabel: parse.yLabel }
  }
  const kept = trimTail(data.rows)
  const defaults = data.xLabel === 'x' && data.yLabel === 'y'
  return {
    rows: [...kept, ...pasted],
    xLabel: headed && defaults ? parse.xLabel : data.xLabel,
    yLabel: headed && defaults ? parse.yLabel : data.yLabel,
  }
}

/** What a paste says back: how much it read, and every row it could not. */
export function pasteReport(parse: DataParse): string[] {
  const out: string[] = []
  if (!parse.ok) {
    out.push(parse.error ?? 'Nothing in that paste could be read as numbers.')
    return out
  }
  const n = parse.xs.length
  out.push(`Read ${n} row${n === 1 ? '' : 's'}.`)
  for (const s of parse.skipped) out.push(`Row ${s.row} skipped: ${s.reason}`)
  for (const note of parse.notes) out.push(note)
  return out
}

/** Does this text look like more than one cell (a spreadsheet paste)? */
export function isMultiCellPaste(text: string): boolean {
  return /[\t\n\r]/.test(text.replace(/[\r\n]+$/, ''))
}

// ---------------------------------------------------------------------------
// The Regression ▾ menu
// ---------------------------------------------------------------------------

export interface RegressionChoice {
  kind: RegressionKind
  /** True for the kinds that can be fitted to this data. */
  ok: boolean
  /** r² on the data, for the cheap fits. */
  r2?: number
  /** Why this kind is refused, in the fitter's own words. */
  reason?: string
}

/**
 * suggestModels first — ranked, each cheap one with its r² — then every other
 * kind, greyed, with the fitter's refusal ("exponential needs every y to be
 * positive — (2, −1) has y ≤ 0"). A hint, never an automatic choice.
 */
export function regressionMenu(
  cols: DataColumns,
  fit: (cols: DataColumns, kind: RegressionKind) => RegressionResult = makeFitCache(),
): RegressionChoice[] {
  let suggested: RegressionKind[] = []
  try {
    suggested = suggestModels(cols.xs, cols.ys)
  } catch {
    suggested = []
  }
  const out: RegressionChoice[] = []
  for (const kind of suggested) {
    const choice: RegressionChoice = { kind, ok: true }
    if (CHEAP.has(kind)) {
      const res = fit(cols, kind)
      if (res.ok && Number.isFinite(res.r2)) choice.r2 = res.r2
    }
    out.push(choice)
  }
  for (const kind of REGRESSION_KINDS) {
    if (suggested.includes(kind)) continue
    const res = fit(cols, kind)
    if (res.ok) {
      out.push({ kind, ok: true, ...(Number.isFinite(res.r2) ? { r2: res.r2 } : {}) })
      continue
    }
    out.push({
      kind,
      ok: false,
      reason:
        cols.xs.length === 0
          ? 'There is no data to fit yet.'
          : (res.error ?? `${KIND_NAME[kind]} cannot be fitted to this data.`),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Readouts
// ---------------------------------------------------------------------------

const MINUS = '−'

/** Four places like a TI, a real minus sign, never "−0.0000". */
export function statText(v: number, places = 4): string {
  if (!Number.isFinite(v)) return '—'
  let s = v.toFixed(places)
  if (/^-0\.?0*$/.test(s)) s = s.slice(1)
  return s.replace('-', MINUS)
}

export interface RegressionReadout {
  /** "r = 0.9991, r² = 0.9983" / "R² = 0.9990". */
  main: string
  /** "on ln y" — what the TI's r and r² were computed on, when not y vs x. */
  on?: string
  /** "R² = 0.9990 on the data" — for the linearised fits. */
  data?: string
}

/**
 * What the card prints under a fit, labelled as a TI prints it: r and r² for
 * LinReg and for the three linearised fits (those two on the TRANSFORMED data,
 * which the label says), R² for the polynomials and the nonlinear fits.
 */
export function regressionReadout(res: RegressionResult): RegressionReadout | null {
  if (!res.ok) return null
  const r2 = Number.isFinite(res.r2) ? statText(res.r2) : '—'
  if (res.kind === 'linear') {
    return res.r !== undefined && Number.isFinite(res.r)
      ? { main: `r = ${statText(res.r)}, r² = ${r2}` }
      : { main: `r² = ${r2}` }
  }
  if (res.kind === 'exponential' || res.kind === 'power' || res.kind === 'logarithmic') {
    const on =
      res.kind === 'exponential' ? 'on ln y' : res.kind === 'power' ? 'on ln y vs ln x' : 'on y vs ln x'
    const lin = res.r2Linearised
    if (res.r !== undefined && Number.isFinite(res.r) && lin !== undefined && Number.isFinite(lin)) {
      return {
        main: `r = ${statText(res.r)}, r² = ${statText(lin)}`,
        on,
        data: `R² = ${r2} on the data`,
      }
    }
    return { main: `R² = ${r2}` }
  }
  return { main: `R² = ${r2}` }
}

/** The KaTeX for a regression's equation. Falls back to the text itself. */
export function sourceLatex(src: string): string {
  if (!src) return ''
  try {
    const o = parseExpression(src)
    if (o.ok && typeof o.plot.latex === 'string' && o.plot.latex.trim() !== '') return o.plot.latex
  } catch {
    /* fall through */
  }
  return src.replace(/\\/g, '\\\\')
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export type RegressionStatus = 'ok' | 'failed' | 'detached' | 'missing'

export interface RegressionRow {
  reg: DataRegression
  status: RegressionStatus
  result: RegressionResult | null
  /** The curve's equation now (the fit's, or the teacher's once detached). */
  src: string
  latex: string
  readout: RegressionReadout | null
  /** Why the curve is hidden (a failed re-fit). */
  reason?: string
  notes: string[]
}

export interface DataCardData {
  columns: DataColumns
  /** Points on the plot. */
  count: number
  regressions: RegressionRow[]
  /** The kinds already on this table, so the menu can tick them. */
  onBoard: ReadonlySet<RegressionKind>
}

/** Everything one table's card prints, already worked out. */
export function dataCard(
  data: BoardData,
  exprSources: Readonly<Record<string, string>>,
  curveIds: ReadonlySet<string>,
  fit: (cols: DataColumns, kind: RegressionKind) => RegressionResult,
): DataCardData {
  const columns = dataColumns(data.rows)
  const onBoard = new Set<RegressionKind>()
  const regressions: RegressionRow[] = data.regressions.map((reg) => {
    const src = exprSources[reg.curveId] ?? ''
    if (!curveIds.has(reg.curveId)) {
      return { reg, status: 'missing', result: null, src: '', latex: '', readout: null, notes: [] }
    }
    if (reg.detached) {
      return {
        reg,
        status: 'detached',
        result: null,
        src,
        latex: sourceLatex(src),
        readout: null,
        notes: [],
      }
    }
    onBoard.add(reg.kind)
    const result = fit(columns, reg.kind)
    if (!result.ok) {
      return {
        reg,
        status: 'failed',
        result,
        src,
        latex: sourceLatex(src),
        readout: null,
        reason:
          columns.xs.length === 0
            ? 'There is no data to fit.'
            : (result.error ?? 'This model cannot be fitted to the data now.'),
        notes: [],
      }
    }
    const fresh = regressionSource(result, clampRegDigits(reg.digits))
    return {
      reg,
      status: 'ok',
      result,
      src: fresh || src,
      latex: sourceLatex(fresh || src),
      readout: regressionReadout(result),
      notes: result.notes.slice(),
    }
  })
  return { columns, count: columns.xs.length, regressions, onBoard }
}

// ---------------------------------------------------------------------------
// The sync: re-fit every linked regression, restate its curve in place
// ---------------------------------------------------------------------------

export interface RegressionSyncInput {
  data: readonly BoardData[]
  curves: readonly { id: string; visible: boolean }[]
  exprSources: Readonly<Record<string, string>>
  /** regressionId -> the source this sync last wrote (or found) on its curve. */
  written: ReadonlyMap<string, string>
  /** Regressions whose curve the BOARD hid because the fit went away. */
  autoHidden: ReadonlySet<string>
  fit: (cols: DataColumns, kind: RegressionKind) => RegressionResult
}

export interface RegressionSyncPlan {
  /** Restate these curves, in place, to these sources. */
  restate: { regId: string; curveId: string; src: string }[]
  /** Hide these curves: the fit stopped existing. */
  hide: { regId: string; curveId: string }[]
  /** Show these again: the fit is back, and it was the board that hid them. */
  show: { regId: string; curveId: string }[]
  /** These curves were edited by hand: the regression lets go of them. */
  detach: { dataId: string; regId: string }[]
  written: Map<string, string>
  autoHidden: Set<string>
}

/**
 * What has to change so every linked regression says what its table says.
 *
 * The one subtle rule is DETACHING. A curve's equation can change for two
 * reasons: the table changed (so the fit rewrote it), or the teacher rewrote
 * it by hand (on its card, in its Exponential section, by dragging a handle).
 * The second must not be overwritten on the next keystroke in a cell. So a
 * regression remembers the source it last wrote; a curve whose source is
 * neither that nor what the data now says was edited by hand, and the
 * regression lets go of it. Undo restores the curve AND the table together,
 * so a restored source always equals the fit of the restored rows.
 *
 * A failed re-fit HIDES the curve rather than leaving the last one up — a
 * stale fit on a projector is a wrong answer that looks like a right one —
 * and brings it back when the data allows, unless the teacher hid it too.
 */
export function planRegressionSync(input: RegressionSyncInput): RegressionSyncPlan {
  const plan: RegressionSyncPlan = {
    restate: [],
    hide: [],
    show: [],
    detach: [],
    written: new Map(input.written),
    autoHidden: new Set(input.autoHidden),
  }
  const curves = new Map(input.curves.map((c) => [c.id, c]))
  const live = new Set<string>()
  for (const d of input.data) {
    const cols = dataColumns(d.rows)
    for (const reg of d.regressions) {
      live.add(reg.id)
      if (reg.detached) continue
      const curve = curves.get(reg.curveId)
      if (!curve) continue
      const current = input.exprSources[reg.curveId]
      const res = input.fit(cols, reg.kind)
      const desired = res.ok ? regressionSource(res, clampRegDigits(reg.digits)) : ''
      const last = plan.written.get(reg.id)
      if (current !== undefined && last !== undefined && current !== last && current !== desired) {
        plan.detach.push({ dataId: d.id, regId: reg.id })
        plan.written.delete(reg.id)
        if (plan.autoHidden.delete(reg.id) && !curve.visible) {
          plan.show.push({ regId: reg.id, curveId: reg.curveId })
        }
        continue
      }
      if (desired === '') {
        if (current !== undefined && last === undefined) plan.written.set(reg.id, current)
        if (curve.visible) {
          plan.hide.push({ regId: reg.id, curveId: reg.curveId })
          plan.autoHidden.add(reg.id)
        }
        continue
      }
      if (current !== desired) plan.restate.push({ regId: reg.id, curveId: reg.curveId, src: desired })
      plan.written.set(reg.id, desired)
      if (plan.autoHidden.delete(reg.id) && !curve.visible) {
        plan.show.push({ regId: reg.id, curveId: reg.curveId })
      }
    }
  }
  // Forget regressions that are gone, so the maps cannot grow for ever.
  for (const id of [...plan.written.keys()]) if (!live.has(id)) plan.written.delete(id)
  for (const id of [...plan.autoHidden]) if (!live.has(id)) plan.autoHidden.delete(id)
  return plan
}

/** True when a plan changes nothing. */
export function planIsEmpty(p: RegressionSyncPlan): boolean {
  return p.restate.length === 0 && p.hide.length === 0 && p.show.length === 0 && p.detach.length === 0
}

// ---------------------------------------------------------------------------
// Dependents
// ---------------------------------------------------------------------------

/**
 * The tables with every regression on one of `curveIds` taken off — deleting
 * a regression's curve removes the regression. Returns the same array when
 * nothing changed.
 */
export function dropRegressionsFor(
  data: readonly BoardData[],
  curveIds: ReadonlySet<string>,
): BoardData[] {
  let changed = false
  const out = data.map((d) => {
    const kept = d.regressions.filter((r) => !curveIds.has(r.curveId))
    if (kept.length === d.regressions.length) return d
    changed = true
    return { ...d, regressions: kept }
  })
  return changed ? out : (data as BoardData[])
}

/** The curves that go when a table goes: its LINKED regressions' curves. */
export function linkedCurves(data: BoardData): string[] {
  return data.regressions.filter((r) => !r.detached).map((r) => r.curveId)
}

/** Which regression (if any) draws `curveId`, and on which table. */
export function regressionFor(
  data: readonly BoardData[],
  curveId: string,
): { data: BoardData; reg: DataRegression } | null {
  for (const d of data) {
    const reg = d.regressions.find((r) => r.curveId === curveId && !r.detached)
    if (reg) return { data: d, reg }
  }
  return null
}

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

/**
 * The scatter sets the board draws. A table's residuals go to its first
 * linked regression with the toggle on — the renderer draws one set of
 * residuals per table, and the card keeps the toggle exclusive.
 */
export function scatterSets(data: readonly BoardData[], curveIds: ReadonlySet<string>): ScatterSet[] {
  return data.map((d) => {
    const cols = dataColumns(d.rows)
    const res = d.regressions.find((r) => r.residuals && !r.detached && curveIds.has(r.curveId))
    const set: ScatterSet = {
      id: d.id,
      xs: cols.xs,
      ys: cols.ys,
      color: d.color,
      visible: d.visible,
      label: d.name,
    }
    if (d.marker && d.marker !== 'dot') set.marker = d.marker
    if (res) set.residualsTo = res.curveId
    return set
  })
}

export interface Box {
  min: { x: number; y: number }
  max: { x: number; y: number }
}

/**
 * The box a table's points occupy, padded so a single point or a flat row of
 * them still has an extent to frame. Null for a table with nothing plotted.
 */
export function dataBox(data: BoardData): Box | null {
  const { xs, ys } = dataColumns(data.rows)
  if (xs.length === 0) return null
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < xs.length; i++) {
    minX = Math.min(minX, xs[i])
    maxX = Math.max(maxX, xs[i])
    minY = Math.min(minY, ys[i])
    maxY = Math.max(maxY, ys[i])
  }
  const padX = maxX > minX ? 0 : Math.max(1, Math.abs(minX) * 0.1)
  const padY = maxY > minY ? 0 : Math.max(1, Math.abs(minY) * 0.1)
  return { min: { x: minX - padX, y: minY - padY }, max: { x: maxX + padX, y: maxY + padY } }
}

/** "Table 3": the next name no table on the board is using. */
export function nextTableName(data: readonly BoardData[]): string {
  const used = new Set(data.map((d) => d.name))
  for (let n = 1; ; n++) {
    const name = `Table ${n}`
    if (!used.has(name)) return name
  }
}

/** What the presentation legend says for a table. */
export function dataLegend(
  data: readonly BoardData[],
): { id: string; color: string; tex: string; text: string }[] {
  return data
    .filter((d) => d.visible && dataColumns(d.rows).xs.length > 0)
    .map((d) => ({
      id: d.id,
      color: d.color,
      tex: `\\text{${texSafe(d.name)}}`,
      text: d.name,
    }))
}

function texSafe(s: string): string {
  return s.replace(/[\\{}$&#^_%~]/g, '')
}

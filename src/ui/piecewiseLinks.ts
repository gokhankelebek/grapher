// ============================================================================
// src/ui/piecewiseLinks.ts — a piecewise (or step) function as a TABLE of
// pieces, the pure half of src/ui/PiecewiseEditor.tsx.
//
//     f(x) = { x² + 1   if x < 0
//            { 3        if 0 ≤ x ≤ 2
//            { −x + 5   if x > 2
//
// A teacher asked for this in so many words: "easier than typing it inside a
// curly bracket". So a piece is a ROW — its formula, then its interval as two
// bound fields with a relation between each bound and x that toggles
// < ⇄ ≤ (open ⇄ closed, the dot the graph will draw). "+ piece" tiles the
// line: the new row starts where the one above ended, with the other
// inclusivity (previous x ≤ 2 → next 2 < x), so pieces meet without a gap or
// an overlap unless the teacher makes one.
//
// Everything here is pure; the core (src/core/piecewise.ts) owns the syntax
// (piecewiseSource), the reading back (readPiecewise), the verdict at every
// breakpoint (breakpoints) and the step functions (stepSpec). This module is
// the bridge between those and the fields a card shows:
//
//   row ops         addRow (tiling default), removeRow, moveRow,
//                   toggleClosed, setCell, setOtherwise
//   spec ⇄ rows     tableToSpec, tableFromSpec, tableFromSource
//   validation      tableProblems (per cell: formula, lower, upper), nameProblem
//   verdicts        verdictSpec (an "otherwise" row → what it owns),
//                   pieceEvaluator, verdictsFor
//   the drafts      blankPiecewiseDraft, piecewiseResult (the Build card),
//                   stepFamilySource, stepTableSpec (the Step tab),
//                   commitTable (the card section)
// ============================================================================

import { analyzeExpr, compileExpr, parseExpression, piecewiseParts } from '../core/parse'
import { complementOf, type Piece } from '../core/parse/condition'
import {
  breakpoints,
  piecewiseSource,
  readPiecewise,
  stepSpec,
  type BreakKind,
  type PieceSpec,
  type PiecewiseSpec,
} from '../core/piecewise'
import { exactForm } from '../core/exact'

// ----------------------------------------------------------------------------
// rows
// ----------------------------------------------------------------------------

/** One piece as its fields show it. An empty bound is unbounded (−∞ / ∞). */
export interface PieceRow {
  /** The formula in x, as typed ("x^2 + 1", "3", "sqrt(x)"). */
  expr: string
  lo: string
  hi: string
  /** ≤ on the left (a filled dot at lo); meaningless while lo is empty. */
  loClosed: boolean
  /** ≤ on the right (a filled dot at hi); meaningless while hi is empty. */
  hiClosed: boolean
}

/** The rows, and whether the LAST one is "otherwise" (its bounds unused). */
export interface PieceTable {
  rows: PieceRow[]
  otherwise: boolean
}

export type PieceCell = 'expr' | 'lo' | 'hi'
export type BoundSide = 'lo' | 'hi'

const INF_TEXT = /^[+\-−]?\s*(?:inf|infty|infinity|oo|∞|\\infty)$/i

/** A bound field that means "unbounded": empty, or ∞ typed out. */
export function isOpenEnded(text: string | undefined | null): boolean {
  const s = (text ?? '').trim()
  return s === '' || INF_TEXT.test(s)
}

export function blankRow(): PieceRow {
  return { expr: '', lo: '', hi: '', loClosed: false, hiClosed: false }
}

export function blankTable(): PieceTable {
  return { rows: [blankRow()], otherwise: false }
}

/**
 * "+ piece". The new row goes at the end — or just above an "otherwise" row,
 * which stays last — and starts where the row above it ends, with the other
 * inclusivity: above ends `x ≤ 2`, the new one starts `2 < x`. Above
 * unbounded on the right: the new row starts unbounded too.
 */
export function addRow(t: PieceTable): PieceTable {
  const at = t.otherwise && t.rows.length > 0 ? t.rows.length - 1 : t.rows.length
  const prev = at > 0 ? t.rows[at - 1] : null
  const row = blankRow()
  if (prev && !isOpenEnded(prev.hi)) {
    row.lo = prev.hi.trim()
    row.loClosed = !prev.hiClosed
  }
  const rows = [...t.rows.slice(0, at), row, ...t.rows.slice(at)]
  return { rows, otherwise: t.otherwise }
}

/** "×". The last row left is cleared rather than removed. */
export function removeRow(t: PieceTable, i: number): PieceTable {
  if (i < 0 || i >= t.rows.length) return t
  if (t.rows.length === 1) return blankTable()
  const last = t.rows.length - 1
  const rows = t.rows.filter((_, k) => k !== i)
  // Removing the "otherwise" row must not turn the row above into one.
  return { rows, otherwise: t.otherwise && i !== last }
}

/**
 * ↑ / ↓ or a drag: row `from` now sits at `to`. The order is part of the
 * meaning only where pieces overlap (the first match wins); "otherwise" is
 * a property of the LAST row, so it is dropped when that row moves or when
 * another row takes its place.
 */
export function moveRow(t: PieceTable, from: number, to: number): PieceTable {
  const n = t.rows.length
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return t
  const rows = [...t.rows]
  const [r] = rows.splice(from, 1)
  rows.splice(to, 0, r)
  const last = n - 1
  return { rows, otherwise: t.otherwise && from !== last && to !== last }
}

/** Click the relation: < ⇄ ≤. An unbounded side has no dot to toggle. */
export function toggleClosed(t: PieceTable, i: number, side: BoundSide): PieceTable {
  const r = t.rows[i]
  if (!r) return t
  if (isOpenEnded(side === 'lo' ? r.lo : r.hi)) return t
  const next: PieceRow = side === 'lo' ? { ...r, loClosed: !r.loClosed } : { ...r, hiClosed: !r.hiClosed }
  return { ...t, rows: t.rows.map((q, k) => (k === i ? next : q)) }
}

export function setCell(t: PieceTable, i: number, cell: PieceCell, text: string): PieceTable {
  const r = t.rows[i]
  if (!r) return t
  const next: PieceRow = { ...r, [cell]: text }
  return { ...t, rows: t.rows.map((q, k) => (k === i ? next : q)) }
}

export function setOtherwise(t: PieceTable, on: boolean): PieceTable {
  return t.otherwise === on ? t : { ...t, otherwise: on }
}

/** Is row i the "otherwise" row (its bound fields are then unused)? */
export function isOtherwiseRow(t: PieceTable, i: number): boolean {
  return t.otherwise && i === t.rows.length - 1
}

// ----------------------------------------------------------------------------
// spec ⇄ rows
// ----------------------------------------------------------------------------

function pieceOfRow(r: PieceRow, otherwise: boolean): PieceSpec {
  const p: PieceSpec = { expr: r.expr.trim(), loClosed: false, hiClosed: false }
  if (otherwise) return p
  if (!isOpenEnded(r.lo)) {
    p.lo = r.lo.trim()
    p.loClosed = r.loClosed
  }
  if (!isOpenEnded(r.hi)) {
    p.hi = r.hi.trim()
    p.hiClosed = r.hiClosed
  }
  return p
}

/** The rows as the core's spec; an "otherwise" row has no bounds. */
export function tableToSpec(t: PieceTable, name?: string): PiecewiseSpec {
  const last = t.rows.length - 1
  const pieces = t.rows.map((r, i) => pieceOfRow(r, t.otherwise && i === last))
  const n = (name ?? '').trim()
  return n ? { name: n, pieces } : { pieces }
}

/** The spec's pieces as rows. A last piece with no bounds reads as "otherwise". */
export function tableFromSpec(spec: PiecewiseSpec): PieceTable {
  const rows: PieceRow[] = (spec.pieces ?? []).map((p) => ({
    expr: p.expr ?? '',
    lo: p.lo ?? '',
    hi: p.hi ?? '',
    loClosed: p.lo !== undefined && p.loClosed === true,
    hiClosed: p.hi !== undefined && p.hiClosed === true,
  }))
  if (rows.length === 0) return blankTable()
  const last = spec.pieces[spec.pieces.length - 1]
  const otherwise = rows.length > 1 && last.lo === undefined && last.hi === undefined
  return { rows, otherwise }
}

/** A typed line → its table (and name); null when the core does not read it. */
export function tableFromSource(src: string | undefined | null): { table: PieceTable; name?: string } | null {
  const spec = safeReadPiecewise(src)
  if (!spec) return null
  return spec.name ? { table: tableFromSpec(spec), name: spec.name } : { table: tableFromSpec(spec) }
}

/** readPiecewise, never throwing. */
export function safeReadPiecewise(src: string | undefined | null): PiecewiseSpec | null {
  if (typeof src !== 'string' || src.trim() === '') return null
  try {
    return readPiecewise(src)
  } catch {
    return null
  }
}

/**
 * The spec a card's Piecewise section speaks for, or null. A braced
 * piecewise line always; a single restricted formula (`x^2 {0 <= x < 3}`)
 * too — a teacher may want to add a piece to it — but its section starts
 * collapsed (see piecewiseOpenByDefault).
 */
export function piecewiseSectionSpec(src: string | undefined | null): PiecewiseSpec | null {
  return safeReadPiecewise(src)
}

/** Open the section by itself only for a line with more than one piece. */
export function piecewiseOpenByDefault(src: string | undefined | null): boolean {
  if (typeof src !== 'string') return false
  try {
    const parts = piecewiseParts(src)
    return parts !== null && !parts.restricted && parts.branches.length > 1
  } catch {
    return false
  }
}

// ----------------------------------------------------------------------------
// validation, one cell at a time
// ----------------------------------------------------------------------------

export interface CellProblem {
  row: number
  cell: PieceCell
  message: string
}

/** Variables a formula may not use (x is the one it is in). */
const NOT_X = new Set(['y', 'r', 'θ', 't'])

/** One formula field: null when fine, else what is wrong with it. */
export function exprProblem(text: string): string | null {
  const s = text.trim()
  if (s === '') return "Type this piece's formula"
  const c = compileExpr(s)
  if (!c.ok) return c.error
  const bad = c.expr.vars.find((v) => NOT_X.has(v))
  if (bad) return `A piece is a formula in x — ${bad} cannot appear in it`
  return null
}

/** A bound's value; ±∞ when open-ended; null when it is not a constant. */
export function boundValue(text: string, absent: number): number | null {
  if (isOpenEnded(text)) return absent
  const a = analyzeExpr(text.trim())
  if (!a.ok || a.free.length > 0 || !Number.isFinite(a.value)) return null
  return a.value
}

/** One bound field: null when fine (empty = unbounded), else what is wrong. */
export function boundProblem(text: string): string | null {
  if (isOpenEnded(text)) return null
  const a = analyzeExpr(text.trim())
  if (!a.ok) return a.error
  const vars = a.free.filter((v) => v === 'x' || NOT_X.has(v))
  if (vars.length > 0) return `A bound is a number, not ${vars.includes('x') ? 'a formula in x' : vars[0]}`
  if (a.free.length === 0 && !Number.isFinite(a.value)) return 'This bound is not a finite number'
  return null
}

/** Every bad cell of the table, in row order. */
export function tableProblems(t: PieceTable): CellProblem[] {
  const out: CellProblem[] = []
  t.rows.forEach((r, i) => {
    const e = exprProblem(r.expr)
    if (e) out.push({ row: i, cell: 'expr', message: e })
    if (isOtherwiseRow(t, i)) return
    const lp = boundProblem(r.lo)
    const hp = boundProblem(r.hi)
    if (lp) out.push({ row: i, cell: 'lo', message: lp })
    if (hp) out.push({ row: i, cell: 'hi', message: hp })
    if (lp || hp) return
    const lo = boundValue(r.lo, Number.NEGATIVE_INFINITY)
    const hi = boundValue(r.hi, Number.POSITIVE_INFINITY)
    if (lo === null || hi === null) return // a slider bound: the parser decides
    if (lo > hi) {
      out.push({ row: i, cell: 'hi', message: `No x has ${r.lo.trim()} < x < ${r.hi.trim()}: the bounds are the wrong way round` })
    } else if (lo === hi && !(r.loClosed && r.hiClosed)) {
      out.push({ row: i, cell: 'hi', message: `This piece is empty — make both ends ≤ for the single point x = ${r.lo.trim()}` })
    }
  })
  return out
}

/** The first problem of one cell, or null. */
export function cellProblem(problems: readonly CellProblem[], row: number, cell: PieceCell): string | null {
  return problems.find((p) => p.row === row && p.cell === cell)?.message ?? null
}

const RESERVED_NAMES = new Set(['x', 'y', 'e', 'r', 't'])

/** The name field: empty (y = …) or one letter that is not a variable. */
export function nameProblem(name: string): string | null {
  const n = name.trim()
  if (n === '') return null
  if (!/^[A-Za-z]$/.test(n)) return 'Name the function with one letter, like f'
  if (RESERVED_NAMES.has(n)) return `${n} is taken — name the function with another letter, like f`
  return null
}

// ----------------------------------------------------------------------------
// verdicts at the breakpoints
// ----------------------------------------------------------------------------

/** A finite number the parser reads back exactly. */
function numSrc(v: number): string {
  const r = Number(v.toPrecision(15))
  if (Number.isInteger(r)) return String(r)
  const s = String(r)
  return /e/i.test(s) ? r.toFixed(20).replace(/0+$/, '').replace(/\.$/, '') : s
}

/**
 * The spec breakpoints() should judge. As typed, except an "otherwise" row
 * (a last piece with no bounds): it owns exactly what no other row claims,
 * so it becomes one piece per stretch of that complement — otherwise it
 * would "overlap" every other row. Rows with a slider bound are left as
 * typed (breakpoints skips them).
 */
export function verdictSpec(spec: PiecewiseSpec): PiecewiseSpec {
  const ps = spec.pieces ?? []
  const last = ps[ps.length - 1]
  if (ps.length < 2 || !last || last.lo !== undefined || last.hi !== undefined) return spec
  const others = ps.slice(0, -1)
  const claimed: Piece[] = []
  for (const p of others) {
    const lo = boundValue(p.lo ?? '', Number.NEGATIVE_INFINITY)
    const hi = boundValue(p.hi ?? '', Number.POSITIVE_INFINITY)
    if (lo === null || hi === null) return { ...spec, pieces: others }
    claimed.push({
      lo,
      hi,
      loC: Number.isFinite(lo) && p.loClosed,
      hiC: Number.isFinite(hi) && p.hiClosed,
      loTex: null,
      hiTex: null,
      loSrc: p.lo ?? null,
      hiSrc: p.hi ?? null,
    })
  }
  let rest: Piece[]
  try {
    rest = complementOf(claimed)
  } catch {
    return spec
  }
  const owned: PieceSpec[] = rest.map((q) => {
    const out: PieceSpec = { expr: last.expr, loClosed: false, hiClosed: false }
    if (Number.isFinite(q.lo)) {
      out.lo = q.loSrc ?? numSrc(q.lo)
      out.loClosed = q.loC
    }
    if (Number.isFinite(q.hi)) {
      out.hi = q.hiSrc ?? numSrc(q.hi)
      out.hiClosed = q.hiC
    }
    return out
  })
  return { ...spec, pieces: [...others, ...owned] }
}

/**
 * evalPiece for breakpoints(): piece i's own formula anywhere, sliders at
 * `sliders` (by name) or 1. A piece that does not compile is NaN everywhere.
 */
export function pieceEvaluator(
  spec: PiecewiseSpec,
  sliders: Readonly<Record<string, number>> = {},
): (i: number, x: number) => number {
  const fs = (spec.pieces ?? []).map((p) => {
    const c = compileExpr((p.expr ?? '').trim() || '0')
    if (!c.ok) return null
    const params = c.expr.paramNames.map((n) => (Number.isFinite(sliders[n]) ? sliders[n] : 1))
    const ev = c.expr.ev
    return (x: number) => ev(params, x, 0)
  })
  return (i, x) => {
    const f = fs[i]
    return f ? f(x) : Number.NaN
  }
}

/** The slider values of a line: the parser's defaults, or the curve's own. */
export function slidersOf(src: string, values?: readonly number[]): Record<string, number> {
  const out: Record<string, number> = {}
  try {
    const o = parseExpression(src)
    if (!o.ok) return out
    o.plot.paramNames.forEach((n, i) => {
      const v = values?.[i] ?? o.plot.defaultParams[i]
      if (Number.isFinite(v)) out[n] = v
    })
  } catch {
    // no sliders known: every one reads as 1
  }
  return out
}

export interface Verdict {
  kind: BreakKind
  x: number
  text: string
}

/** What happens at each breakpoint, left to right — the list under the table. */
export function verdictsFor(spec: PiecewiseSpec, sliders: Readonly<Record<string, number>> = {}): Verdict[] {
  try {
    const judged = verdictSpec(spec)
    return breakpoints(judged, pieceEvaluator(judged, sliders)).map((b) => ({
      kind: b.kind,
      x: b.x,
      text: b.sentence,
    }))
  } catch {
    return []
  }
}

// ----------------------------------------------------------------------------
// the Step tab
// ----------------------------------------------------------------------------

export type StepKind = 'floor' | 'ceil' | 'round'
export type StepMode = 'family' | 'table'

export interface StepDraft {
  mode: StepMode
  kind: StepKind
  a: string
  b: string
  h: string
  k: string
  /** A table step function: each row's `expr` is the constant value. */
  table: PieceTable
}

export const STEP_KINDS: { kind: StepKind; label: string; formula: string }[] = [
  { kind: 'floor', label: 'floor ⌊x⌋', formula: 'y = a·⌊b(x − h)⌋ + k' },
  { kind: 'ceil', label: 'ceiling ⌈x⌉', formula: 'y = a·⌈b(x − h)⌉ + k' },
  { kind: 'round', label: 'round', formula: 'y = a·round(b(x − h)) + k' },
]

export function blankStepDraft(): StepDraft {
  return { mode: 'family', kind: 'floor', a: '1', b: '1', h: '0', k: '0', table: blankTable() }
}

/** A constant field of the family (a, b, h, k): null when fine. */
export function constProblem(text: string, field: 'a' | 'b' | 'h' | 'k'): string | null {
  const s = text.trim()
  if (s === '') return null // the default (1 or 0)
  const a = analyzeExpr(s)
  if (!a.ok) return a.error
  if (a.free.some((v) => v === 'x' || NOT_X.has(v))) return `${field} is a number, not a formula in x`
  if (a.free.length === 0 && !Number.isFinite(a.value)) return `${field} is not a finite number`
  if (field === 'b' && a.free.length === 0 && a.value === 0) return 'b = 0 makes every step infinitely wide'
  return null
}

/** Put the name on a `y = …` line: `f(x) = …`. */
function named(src: string, name: string | undefined): string {
  const n = (name ?? '').trim()
  return n ? src.replace(/^\s*y\s*=\s*/, `${n}(x) = `) : src
}

/** The greatest-integer family's one-line source (floor / ceil / round). */
export function stepFamilySource(d: StepDraft, name?: string): string {
  const src = stepSpec(d.kind, { a: d.a, b: d.b, h: d.h, k: d.k }) as string
  return named(src, name)
}

/** "each step is 1 wide and 1 high" — the sentence under a family's preview. */
export function stepFamilySentence(d: StepDraft): string | null {
  const val = (t: string, dflt: number): number | null => {
    if (t.trim() === '') return dflt
    const a = analyzeExpr(t.trim())
    return a.ok && a.free.length === 0 && Number.isFinite(a.value) ? a.value : null
  }
  const a = val(d.a, 1)
  const b = val(d.b, 1)
  if (a === null || b === null || b === 0) return null
  const txt = (v: number): string => exactForm(v)?.text ?? String(Number(v.toPrecision(6)))
  if (a === 0) return 'a = 0: the line is the constant k — no steps'
  const w = txt(1 / Math.abs(b))
  const hgt = txt(Math.abs(a))
  const dir = (a > 0) === (b > 0) ? 'up' : 'down'
  // ⌊x⌋ steps include their left end, ⌈x⌉ their right; b < 0 mirrors that.
  const closedLeft = (d.kind !== 'ceil') === (b > 0)
  const ends = closedLeft
    ? 'each step is closed on the left, open on the right'
    : 'each step is open on the left, closed on the right'
  return `steps ${w} wide, each ${hgt} ${dir} from the last — ${ends}`
}

/** The table step function via the core's stepSpec('table'). */
export function stepTableSpec(t: PieceTable, name?: string): PiecewiseSpec {
  const last = t.rows.length - 1
  const spec = stepSpec('table', {
    table: t.rows.map((r, i) =>
      t.otherwise && i === last
        ? { lo: '', hi: '', value: r.expr, loClosed: false, hiClosed: false }
        : { lo: r.lo, hi: r.hi, value: r.expr, loClosed: r.loClosed, hiClosed: r.hiClosed },
    ),
  }) as PiecewiseSpec
  const n = (name ?? '').trim()
  return n ? { name: n, pieces: spec.pieces } : spec
}

/** A parking-fee table to start the Step tab's table from. */
export function parkingTable(): PieceTable {
  return {
    rows: [
      { expr: '5', lo: '0', hi: '1', loClosed: false, hiClosed: true },
      { expr: '8', lo: '1', hi: '2', loClosed: false, hiClosed: true },
      { expr: '11', lo: '2', hi: '3', loClosed: false, hiClosed: true },
    ],
    otherwise: false,
  }
}

// ----------------------------------------------------------------------------
// the Build card's draft
// ----------------------------------------------------------------------------

export type PiecewiseTab = 'pieces' | 'step'

export interface PiecewiseDraft {
  tab: PiecewiseTab
  /** Optional one-letter name: f(x) = …; empty writes y = … */
  name: string
  pieces: PieceTable
  step: StepDraft
}

export function blankPiecewiseDraft(): PiecewiseDraft {
  return { tab: 'pieces', name: 'f', pieces: blankTable(), step: blankStepDraft() }
}

/** The header example, as a draft. */
export function exampleDraft(): PiecewiseDraft {
  return {
    ...blankPiecewiseDraft(),
    pieces: {
      rows: [
        { expr: 'x^2 + 1', lo: '', hi: '0', loClosed: false, hiClosed: false },
        { expr: '3', lo: '0', hi: '2', loClosed: true, hiClosed: true },
        { expr: '-x + 5', lo: '2', hi: '', loClosed: false, hiClosed: false },
      ],
      otherwise: false,
    },
  }
}

export interface PiecewiseResult {
  /** What "Add to graph" hands on; null while anything is wrong. */
  src: string | null
  /** The source as far as it can be written, for the preview (even with errors). */
  previewSrc: string | null
  latex: string | null
  problems: CellProblem[]
  /** A problem with the whole (name, a family field, the parser's refusal). */
  error: string | null
  verdicts: Verdict[]
  /** A sentence for the step family. */
  sentence: string | null
}

function parseLatex(src: string): { latex: string | null; error: string | null } {
  try {
    const o = parseExpression(src)
    if (!o.ok) return { latex: null, error: o.error }
    if (o.plot.kind !== 'explicit') return { latex: null, error: 'This is not a function of x' }
    return { latex: o.plot.latex, error: null }
  } catch {
    return { latex: null, error: 'The parser crashed on this equation.' }
  }
}

/** Everything the Build card shows, from its draft. */
export function piecewiseResult(d: PiecewiseDraft): PiecewiseResult {
  const empty: PiecewiseResult = {
    src: null, previewSrc: null, latex: null, problems: [], error: null, verdicts: [], sentence: null,
  }
  const nameErr = nameProblem(d.name)
  const name = nameErr ? undefined : d.name.trim() || undefined

  if (d.tab === 'step' && d.step.mode === 'family') {
    const fields = ['a', 'b', 'h', 'k'] as const
    const bad = fields.map((f) => constProblem(d.step[f], f)).find((m) => m !== null) ?? null
    const error = nameErr ?? bad
    if (bad) return { ...empty, error }
    const src = stepFamilySource(d.step, name)
    const p = parseLatex(src)
    return {
      ...empty,
      src: error || p.error ? null : src,
      previewSrc: src,
      latex: p.latex,
      error: error ?? p.error,
      sentence: stepFamilySentence(d.step),
    }
  }

  const table = d.tab === 'step' ? d.step.table : d.pieces
  const spec = d.tab === 'step' ? stepTableSpec(table, name) : tableToSpec(table, name)
  const problems = tableProblems(table)
  const src = piecewiseSource(spec)
  const p = parseLatex(src)
  const bad = problems.length > 0
  return {
    ...empty,
    src: bad || nameErr || p.error ? null : src,
    previewSrc: src,
    latex: p.latex,
    problems,
    error: nameErr ?? (bad ? null : p.error),
    verdicts: bad || p.error ? [] : verdictsFor(spec, slidersOf(src)),
  }
}

// ----------------------------------------------------------------------------
// the card section
// ----------------------------------------------------------------------------

/**
 * A committed edit on the card: the table → the line to restate, or the
 * refusal. The rows must all be fine and the line must parse; nothing is
 * restated otherwise (the section keeps the edit and shows the problem).
 */
export function commitTable(
  t: PieceTable,
  name: string | undefined,
): { src: string; error: null } | { src: null; error: string } {
  const problems = tableProblems(t)
  if (problems.length > 0) return { src: null, error: problems[0].message }
  const src = piecewiseSource(tableToSpec(t, name))
  const p = parseLatex(src)
  if (p.error) return { src: null, error: p.error }
  return { src, error: null }
}

/** The relation text between a bound and x: < or ≤. */
export function relText(closed: boolean): string {
  return closed ? '≤' : '<'
}

/** The dot the graph draws at that end: ● closed, ○ open. */
export function dotGlyph(closed: boolean): string {
  return closed ? '●' : '○'
}

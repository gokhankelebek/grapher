// ============================================================================
// src/ui/valueTableLinks.ts — the Table section of an explicit curve's card:
// a table of values (NC.M1.F-IF.2), its differences and ratios (F-LE.1), two
// functions side by side and where one overtakes the other (F-IF.9, F-LE.3),
// and synthetic division by (x − a) with the Remainder Theorem (M3.A-APR.2).
//
// src/core/valueTable.ts owns the mathematics. This module owns what a
// teacher SEES of it, from one stored record per curve (ValueTableView in
// src/core/persist.ts — only what was typed, every default absent):
//
//   tablePanel(curve, view, ctx)   everything the card prints
//   tableOverlays(…)               the evaluated point on the board: a dot at
//                                  (a, f(a)), dashed guides to both axes and
//                                  a chip "f(1.5) = 4.375" (an answer)
//   tableFigures(…)                the tables a teacher put ON the figure
//   tableSentences(…)              the table in words (describeGraph)
//   tableDataRows(panel)           "Copy to a data table"
//
// Nothing computed is stored: every value is recomputed from the curve on
// every change, so a table follows its curve's slider live.
//
// Pure: no React, no DOM, no canvas.
// ============================================================================

import type { ExactPoint, FittedCurve, ModelSpec, PieceInfo } from '../core/types'
import type { ValueTableCol, ValueTableView } from '../core/persist'
import {
  VALUE_TABLE_COLS,
  VALUE_TABLE_N_DEFAULT,
  VALUE_TABLE_N_MAX,
  VALUE_TABLE_N_MIN,
  VALUE_TABLE_START_DEFAULT,
  VALUE_TABLE_STEP_DEFAULT,
} from '../core/persist'
import type { Cell, CrossScan, Evaluator, Gap, GapFn, Num, SyntheticDivision, TablePattern, TableStructure, ValueTable } from '../core/valueTable'
import {
  cell,
  GAP_RESOLUTION,
  compareGrid,
  crossingExact,
  linearGrid,
  plainGap,
  scanCrossings,
  divisorA,
  divisorText,
  irrationalText,
  numCell,
  numValue,
  parserText,
  polyText,
  polynomialCoeffs,
  syntheticDivision,
  tablePattern,
  tableXs,
  toNum,
  valueTable,
} from '../core/valueTable'
import { tableNumber } from '../core/limits'
import { analyzeExpr, parseExpression } from '../core/parse'
import type { ExprNode } from '../core/parse'
import type { Asym, Formula, LogNum } from '../core/growth'
import { commonPeriod, diffClass, classify, growthReason, isExponential, logEvaluator, lsum, polyDegree } from '../core/growth'
import type { ExactForm } from '../core/exact'
import { prettyMath } from '../core/ineqText'
import type { Overlay } from '../render/overlays'
import type { ValueTableFigure } from '../render/valueTable'
import { explicitF, familyF } from './domainLinks'
import { parseNumeric } from './numeric'
import { maskValueTable, tableKey } from './reveal'
import type { TablePart } from './reveal'

const MINUS = '−'

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** One table's settings with the defaults filled in. */
export interface TableSettings {
  start: string
  step: string
  n: number
  /** The typed list, or null in start / step mode. */
  list: string | null
  cols: ValueTableCol[]
  ev: string
  dot: boolean
  vs: string | null
  div: string
  fig: boolean
}

export function resolveTable(v: ValueTableView | undefined | null): TableSettings {
  return {
    start: v?.start ?? VALUE_TABLE_START_DEFAULT,
    step: v?.step ?? VALUE_TABLE_STEP_DEFAULT,
    n: v?.n ?? VALUE_TABLE_N_DEFAULT,
    list: typeof v?.list === 'string' ? v.list : null,
    cols: v?.cols ? VALUE_TABLE_COLS.filter((c) => v.cols!.includes(c)) : [],
    ev: v?.ev ?? '',
    dot: v?.dot !== false,
    vs: v?.vs ?? null,
    div: v?.div ?? '',
    fig: v?.fig === true,
  }
}

export const TABLE_N_MIN = VALUE_TABLE_N_MIN
export const TABLE_N_MAX = VALUE_TABLE_N_MAX

/** Column headers, plain text. */
export const COL_HEAD: Record<ValueTableCol, string> = {
  d1: 'Δy',
  d2: 'Δ²y',
  ratio: 'ratio',
  avg: 'avg rate',
}

/** What each column is, for its toggle's tooltip. */
export const COL_TITLE: Record<ValueTableCol, string> = {
  d1: 'First differences: each y minus the y above it (constant for a linear function)',
  d2: 'Second differences: each Δy minus the Δy above it (constant for a quadratic)',
  ratio: 'Ratios: each y divided by the y above it (constant for an exponential)',
  avg: 'Average rate of change over each interval: Δy / Δx',
}

/** Reveal-mode answer keys (src/ui/reveal.ts): the values, the evaluation, the comparison, the division. */
export { tableKey }
export type { TablePart }

/**
 * The keys a stored table states, in teaching order. `live`: the curves on
 * the board — a compare whose other curve has gone states nothing, so it is
 * no step of reveal mode.
 */
export function tableKeysOf(curveId: string, v: ValueTableView | undefined | null, live?: ReadonlySet<string>): string[] {
  if (!v) return []
  const out = [tableKey(curveId, 'values')]
  if (v.ev) out.push(tableKey(curveId, 'eval'))
  if (v.vs && (!live || live.has(v.vs))) out.push(tableKey(curveId, 'compare'))
  if (v.div) out.push(tableKey(curveId, 'divide'))
  return out
}

// ---------------------------------------------------------------------------
// Reading what was typed
// ---------------------------------------------------------------------------

/** A typed x: "2", "-1/3", "pi/6", "π/6", "√2", "sqrt(2)/2". */
export function parseX(text: string): number | null {
  const s = text
    .trim()
    .replace(/−/g, '-')
    .replace(/√\s*(\d+(?:\.\d+)?)/g, 'sqrt($1)')
    .replace(/√\s*\(/g, 'sqrt(')
  if (s === '') return null
  const v = parseNumeric(s)
  return v !== null && Number.isFinite(v) ? v : null
}

/**
 * Text that is a NUMBER as a table's x is written — 2, −1/3, 0.25, π/6, 2π,
 * √2, sqrt(3)/2, e — rather than an expression to work out (sin(2), f(1)).
 */
export function isNumberText(text: string): boolean {
  const s = text.trim().replace(/\bpi\b/gi, '').replace(/\bsqrt\b/gi, '').replace(/[π√]/g, '')
  return /^[\d\s.+\-−*/()^e]*$/i.test(s) && !/e\s*\(/i.test(s) && /\d|π|pi|e/i.test(text)
}

/** The x's of a typed list: comma- or semicolon-separated (spaces when there are neither). */
export function parseXList(text: string): { xs: number[]; bad: string[] } {
  const raw = /[,;]/.test(text) ? text.split(/[,;]/) : text.trim().split(/\s+/)
  const xs: number[] = []
  const bad: string[] = []
  for (const part of raw) {
    const t = part.trim()
    if (t === '') continue
    const v = parseX(t)
    if (v === null) bad.push(t)
    else xs.push(v)
  }
  return { xs: xs.slice(0, VALUE_TABLE_N_MAX), bad }
}

/** The x's the settings describe, or why there are none. */
export function settingsXs(s: TableSettings): { xs: number[]; error: string | null } {
  if (s.list !== null) {
    const { xs, bad } = parseXList(s.list)
    if (bad.length > 0) return { xs, error: `Not a number: ${bad.map((b) => `“${b}”`).join(', ')}` }
    if (xs.length === 0) return { xs, error: 'Type the x values, separated by commas: −2, −1, 0, 1/2, π' }
    return { xs, error: null }
  }
  const start = parseX(s.start)
  if (start === null) return { xs: [], error: `The start “${s.start}” is not a number` }
  const step = parseX(s.step)
  if (step === null || step === 0) return { xs: [], error: `The step “${s.step}” is not a nonzero number` }
  const exactStep = !(irrationalText(s.start) || irrationalText(s.step))
  return { xs: tableXs({ mode: 'step', start, step, n: s.n, exactStep }), error: null }
}

// ---------------------------------------------------------------------------
// f, evaluated
// ---------------------------------------------------------------------------

/** x as a nice point (p/q or pπ/q, q ≤ 64), for ModelSpec.evalExact. */
function exactPointOf(x: number): ExactPoint | null {
  if (!Number.isFinite(x)) return null
  const r = toNum(x, 64)
  if ('p' in r) return { p: r.p, q: r.q, pi: false }
  const t = toNum(x / Math.PI, 24)
  if ('p' in t) return { p: t.p, q: t.q, pi: true }
  return null
}

/**
 * y = f(x) for a table cell: certified by the typed formula's exact
 * evaluator at a nice x (sin x at π is 0, not 1.2e-16; tan x at π/2 is
 * undefined), else the ordinary value. NaN outside the curve's domain.
 */
export function cellEvaluator(curve: FittedCurve, models: Record<string, ModelSpec>): Evaluator | null {
  const f = explicitF(curve, models)
  if (!f) return null
  const spec = models[curve.modelId]
  const ex = spec?.evalExact
  // A typed restriction's own ends: {0 < x < 5} leaves out 0 and 5, which a
  // [0, 5] domain alone would let in.
  let pieces: PieceInfo[] | null = null
  try {
    pieces = spec?.pieces ? spec.pieces(curve.params) : null
  } catch {
    pieces = null
  }
  const inPieces = (x: number): boolean =>
    !pieces ||
    pieces.some((p) => (x > p.lo || (x === p.lo && p.loClosed)) && (x < p.hi || (x === p.hi && p.hiClosed)))
  return (x: number): number => {
    if (!inPieces(x)) return Number.NaN
    const v = f(x)
    // Undefined stays undefined: outside a typed restriction ({x ≥ 0}) the
    // plain evaluation is NaN, and the exact one — which reads the formula
    // alone — must never put a value back.
    if (Number.isNaN(v)) return Number.NaN
    if (!Number.isFinite(v)) {
      // ±∞ AT x with finite values beside it is a pole or ln 0: undefined.
      // ∞ on both sides is an overflow (2¹¹⁰⁰), which is a value, too large.
      const d = 1e-7 * Math.max(1, Math.abs(x))
      return Number.isFinite(f(x - d)) || Number.isFinite(f(x + d)) ? Number.NaN : v
    }
    if (!ex || !Number.isFinite(x)) return v
    const d = curve.domain
    if (d && (x < Math.min(d[0], d[1]) || x > Math.max(d[0], d[1]))) return v
    const pt = exactPointOf(x)
    if (!pt) return v
    try {
      const e = ex.call(spec, curve.params, pt)
      if (typeof e !== 'number') return v
      // The exact value refines a defined one, or removes a spurious one
      // (tan at π/2) — it is never ±∞.
      return Number.isFinite(e) || Number.isNaN(e) ? e : Number.NaN
    } catch {
      return v
    }
  }
}

/** What an Evaluate field and a compare read: the board, by letter. */
export interface TableContext {
  curves: readonly FittedCurve[]
  models: Record<string, ModelSpec>
  /** curveId → the letter the board stores for it (what a typed line calls). */
  letters: Readonly<Record<string, string>>
  /** curveId → the name the card and figure show (f, g, f′). Falls back to letters. */
  names?: Readonly<Record<string, string>>
  /** curveId → the line as typed, for "2ˣ passes x³" rather than "g passes f". */
  sources?: Readonly<Record<string, string>>
}

function nameOf(ctx: TableContext, id: string): string {
  return ctx.names?.[id] ?? ctx.letters[id] ?? 'f'
}

/** The curve holding this letter, when it is a function of x. */
function curveByLetter(ctx: TableContext, letter: string): FittedCurve | null {
  for (const c of ctx.curves) if (ctx.letters[c.id] === letter && c.kind === 'explicit') return c
  return null
}

/** The right-hand side of a typed line, as Unicode: "2ˣ", "x³ − 2x + 4". Null when there is none or it is long. */
export function shortLabel(src: string | undefined, max = 18): string | null {
  if (!src) return null
  const m = /^\s*(?:y|[A-Za-z](?:'|′)*\s*\(\s*x\s*\))\s*=\s*(.+)$/.exec(src)
  const rhs = m ? m[1] : /=/.test(src) ? null : src
  if (!rhs || /[{};<>≤≥]/.test(rhs)) return null
  let t: string
  try {
    t = prettyMath(rhs.trim())
  } catch {
    return null
  }
  t = t
    .replace(/\*/g, '·')
    .replace(/\^\s*x\b/g, 'ˣ')
    .replace(/\s+/g, ' ')
    .trim()
  return t.length > 0 && t.length <= max ? t : null
}

export type EvalView =
  | {
      ok: true
      /** "f(1.5)", "f(−3) + g(2)" — the question. */
      question: string
      value: Cell
      /** "f(1.5) = 4.375", "f(0.5) = √2 ≈ 1.414214", "f(1) ≈ 2.718282". */
      text: string
      /** The board's chip: "f(1.5) = 4.375", "f(0.5) = √2", "f(1) ≈ 2.718282". */
      chip: string
      /** A single call of a curve on the board: where its dot goes. */
      point: { curveId: string; x: number; y: number } | null
    }
  | { ok: false; question: string; error: string }

const SUPS: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' }

/** "f(1.5)" from what was typed: spaces tidied, a real minus sign, f(1)^2 as f(1)², * as ·. */
function questionText(src: string): string {
  return src
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\^\s*(\d+)/g, (_, d: string) => d.split('').map((c) => SUPS[c] ?? c).join(''))
    .replace(/\*/g, '·')
    .replace(/-/g, MINUS)
    .replace(/\bpi\b/g, 'π')
}

/** "= 4.375", "= √2 ≈ 1.414214", "≈ 2.718282". */
export function valueTail(c: Cell): string {
  if (!Number.isFinite(c.v)) return c.text === 'undefined' ? 'is undefined' : `= ${c.text}`
  if (!c.exact) return `≈ ${c.text}`
  if (/[/√π]/.test(c.text)) return `= ${c.text} ≈ ${tableNumber(c.v)}`
  return `= ${c.text}`
}

/** The chip's shorter tail: the closed form alone, or the decimal. */
function chipTail(c: Cell): string {
  if (!Number.isFinite(c.v)) return c.text === 'undefined' ? 'is undefined' : `= ${c.text}`
  return c.exact ? `= ${c.text}` : `≈ ${c.text}`
}

/** An evaluation that worked. */
function okEval(question: string, value: Cell, point: { curveId: string; x: number; y: number } | null): EvalView {
  return { ok: true, question, value, text: `${question} ${valueTail(value)}`, chip: `${question} ${chipTail(value)}`, point }
}

/**
 * Evaluate what was typed in the card's Evaluate field: a bare number a
 * means f(a) of THIS curve; otherwise any constant expression of the
 * board's named functions — f(2.5), f(−3) + g(2), 2f(1) − 1.
 */
export function evaluateTyped(src: string, self: FittedCurve, ctx: TableContext): EvalView | null {
  const text = src.trim()
  if (text === '') return null
  const selfLetter = ctx.letters[self.id] ?? null
  // A bare number: f(a). (sin(2) is a value to work out, not an x.)
  const bare = isNumberText(text) ? parseX(text) : null
  if (bare !== null) {
    const ev = cellEvaluator(self, ctx.models)
    const name = nameOf(ctx, self.id)
    const q = `${name}(${cell(bare).text})`
    if (!ev) return { ok: false, question: q, error: `${name} is not a function of x` }
    const y = ev(bare)
    return okEval(q, cell(y), Number.isFinite(y) ? { curveId: self.id, x: bare, y } : null)
  }
  const question = questionText(text)
  // One call of one curve: f(a), certified at a nice a.
  const one = /^\s*([A-Za-z])\s*\((.*)\)\s*$/.exec(text)
  if (one) {
    const a = parseX(one[2])
    const c = a !== null ? curveByLetter(ctx, one[1]) : null
    if (a !== null && c) {
      const ev = cellEvaluator(c, ctx.models)
      const y = ev ? ev(a) : Number.NaN
      const q = `${one[1]}(${cell(a).text})`
      return okEval(q, cell(y), Number.isFinite(y) ? { curveId: c.id, x: a, y } : null)
    }
  }
  // Anything else: a constant expression in the board's names.
  const byLetter = new Map<string, FittedCurve>()
  for (const c of ctx.curves) {
    const l = ctx.letters[c.id]
    if (l && c.kind === 'explicit' && !byLetter.has(l)) byLetter.set(l, c)
  }
  const fs = new Map<string, Evaluator | null>()
  const env = {
    has: (n: string) => byLetter.has(n),
    eval: (n: string, x: number): number => {
      if (!fs.has(n)) {
        const c = byLetter.get(n)
        fs.set(n, c ? cellEvaluator(c, ctx.models) : null)
      }
      const f = fs.get(n)
      return f ? f(x) : Number.NaN
    },
  }
  let outcome: ReturnType<typeof parseExpression>
  try {
    outcome = parseExpression(parserText(text), env)
  } catch {
    return { ok: false, question, error: `Type ${selfLetter ?? 'f'}(2.5), or f(−3) + g(2)` }
  }
  if (!outcome.ok) return { ok: false, question, error: `Type ${selfLetter ?? 'f'}(2.5), or f(−3) + g(2)` }
  const plot = outcome.plot
  if (plot.paramNames.length > 0) {
    const missing = plot.paramNames.filter((n) => /^[A-Za-z]$/.test(n))
    const what = missing.length > 0 ? missing[0] : plot.paramNames[0]
    return { ok: false, question, error: `${what} is not a function on this board` }
  }
  if (plot.kind !== 'explicit') return { ok: false, question, error: 'Type a value to work out, such as f(2.5)' }
  // x in it at all — sqrt(x − 1) is undefined at 0.37, but it is not a number.
  const DEPENDS = 'That depends on x — type a value, such as f(2.5)'
  try {
    const a = analyzeExpr(parserText(text), env)
    if (a.ok && a.free.includes('x')) return { ok: false, question, error: DEPENDS }
  } catch {
    /* the probes below decide */
  }
  const probes = [0.37, 2.91, -1.73, 5.29, 11.7, 0.053, 101.3]
  const vals: number[] = []
  try {
    const model = plot.makeModel('__table_eval__')
    const ev = model.evalExplicit
    if (ev) for (const x of probes) vals.push(ev.call(model, plot.defaultParams, x))
  } catch {
    /* nothing to evaluate */
  }
  const finite = vals.filter(Number.isFinite)
  if (finite.some((v) => Math.abs(v - finite[0]) > 1e-9 * Math.max(1, Math.abs(finite[0])))) {
    return { ok: false, question, error: DEPENDS }
  }
  // Defined at some probes and not at others: it moves with x.
  if (finite.length > 0 && finite.length < vals.length) return { ok: false, question, error: DEPENDS }
  return okEval(question, cell(finite.length > 0 ? finite[0] : Number.NaN), null)
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

export interface TableRowView {
  x: Cell
  y: Cell
  /** The difference / ratio / rate from the row above (absent on the first row, or rows for Δ²y). */
  d1?: Cell
  d2?: Cell
  ratio?: Cell
  avg?: Cell
  /** The compared function's value. */
  g?: Cell
  /** Who is ahead in this row; `flip` when that changed since the row above. */
  lead?: 'f' | 'g' | '='
  flip?: boolean
}

export interface CompareView {
  otherId: string
  otherName: string
  /** "2ˣ passes x³ after x ≈ 9.94 and stays ahead (checked to x = 1000)". */
  sentence: string | null
  /** "They cross at x ≈ 1.37 and x ≈ 9.94." */
  crossings: string | null
  /** "Average rate of change from x = 0 to 5: f 6.2, g 25". */
  avg: string | null
}

export interface DivisionView {
  /** The a as typed. */
  input: string
  error: string | null
  degree: number
  /** The dividend's coefficients, highest power first (always present). */
  coeffs: Cell[]
  dividend: { text: string; tex: string }
  /** Present once an a has been typed and read. */
  work: {
    a: Cell
    products: Cell[]
    bottom: Cell[]
    remainder: Cell
    quotient: { text: string; tex: string }
    divisor: { text: string; tex: string }
    factor: boolean
    /** "f(−2) = remainder = 0". */
    statement: string
    /** "(x + 2) is a factor of f(x)" or "(x − 1) is not a factor of f(x)". */
    verdict: string
    /** f(x) = (x + 2)(x² − 2x + 2) + 0, in LaTeX. */
    identity: string
  } | null
}

export interface TablePanel {
  curveId: string
  /** "f" — what the card calls it. */
  name: string
  settings: TableSettings
  error: string | null
  rows: TableRowView[]
  /** The extra columns shown, in order. */
  cols: ValueTableCol[]
  pattern: TablePattern | null
  evaluate: EvalView | null
  compare: CompareView | null
  /** The curves a compare can pick (explicit, not this one). */
  others: { id: string; name: string }[]
  /** Null when f is not a polynomial (no Remainder Theorem subsection). */
  division: DivisionView | null
  /** "x = 0 … 5, 6 rows" — the folded header. */
  summary: string
}

const fix2 = (v: number): string => {
  if (Math.abs(v) >= 1e5) {
    const [m, e] = v.toExponential(2).split('e')
    const exp = String(Number(e)).replace(/-/g, MINUS).split('').map((c) => SUPS[c] ?? (c === MINUS ? '⁻' : c)).join('')
    return `${m.replace(/^-/, MINUS)} × 10${exp}`
  }
  return v.toFixed(2).replace(/^-/, MINUS)
}

/** "x = 2", "x ≈ 9.94". A found root reads as exact only when it is a small, short number (x = 4), never x = 3430631121407624. */
function atText(x: number, exactText: string | null): string {
  if (exactText) return `x = ${exactText}`
  const c = cell(x)
  return c.exact && Math.abs(x) < 1e6 && !/[/√π]/.test(c.text) ? `x = ${c.text}` : `x ≈ ${fix2(x)}`
}

function labelFor(ctx: TableContext, id: string): string {
  return shortLabel(ctx.sources?.[id]) ?? `${nameOf(ctx, id)}(x)`
}

// ---------------------------------------------------------------------------
// The formula a curve IS (src/core/growth.ts reads it)
// ---------------------------------------------------------------------------

const numNode = (v: number): ExprNode => ({ t: 'num', v, raw: String(v) }) as ExprNode
const X_NODE = { t: 'var', name: 'x' } as ExprNode
const binNode = (op: '+' | '*' | '^', a: ExprNode, b: ExprNode): ExprNode => ({ t: 'bin', op, a, b }) as ExprNode

/** A library family's formula at its parameters (lines, polynomials, a·e^(bx) + c); null for the rest. */
function libraryFormula(modelId: string, p: readonly number[]): ExprNode | null {
  if (!p.every(Number.isFinite)) return null
  if (modelId === 'line' || modelId === 'poly2' || modelId === 'poly3' || modelId === 'poly4') {
    // ascending coefficients
    let out: ExprNode = numNode(p[0] ?? 0)
    for (let k = 1; k < p.length; k++) out = binNode('+', out, binNode('*', numNode(p[k]), k === 1 ? X_NODE : binNode('^', X_NODE, numNode(k))))
    return out
  }
  if (modelId === 'exp' && p.length >= 3) {
    const e = { t: 'call', fn: 'exp', args: [binNode('*', numNode(p[1]), X_NODE)] } as ExprNode
    return binNode('+', binNode('*', numNode(p[0]), e), numNode(p[2]))
  }
  return null
}

/**
 * The formula a curve is, with its sliders:
 *   'whole'   only when that formula IS the curve for every x — no pieces,
 *             no restriction, no sketch's ends: what end behaviour needs
 *   'family'  the same, except that a sketched line or polynomial is its
 *             family (the polynomial a teacher divides is the one drawn)
 *   'drawn'   the formula the curve follows wherever it is drawn (one
 *             piece): what a table's pattern needs, since its rows lie there
 */
export function formulaOf(curve: FittedCurve, models: Record<string, ModelSpec>, mode: 'whole' | 'family' | 'drawn'): Formula | null {
  if (curve.kind !== 'explicit') return null
  const spec = models[curve.modelId]
  if (!spec || typeof spec.inequality === 'function') return null
  if (spec.formula) {
    if (mode !== 'drawn' && (spec.pieces || curve.domain)) return null
    return { node: spec.formula, params: curve.params }
  }
  if (spec.pieces) return null
  if (mode === 'whole' && curve.domain) return null
  if (mode === 'family' && curve.domain && !/^(line|poly\d)$/.test(curve.modelId)) return null
  const node = libraryFormula(curve.modelId, curve.params)
  return node ? { node, params: curve.params } : null
}

/** What the table's pattern may name for this curve (src/core/valueTable.ts TableStructure), or null when nothing. */
export function tableStructure(curve: FittedCurve, models: Record<string, ModelSpec>): TableStructure | null {
  const F = formulaOf(curve, models, 'drawn')
  if (!F) return null
  let degree: number | null = null
  if (polyDegree(F) !== null) {
    const c = formulaCoeffs(F) ?? coeffsBySamples(curve, models)
    if (c) degree = c.length - 1
  }
  return { degree, exponential: isExponential(F) }
}

// ---------------------------------------------------------------------------
// Comparing two functions (F-IF.9, F-LE.3)
// ---------------------------------------------------------------------------

/** f − g from log-space values: overflow-free, so 1.01ˣ and x¹⁰⁰ compare at x = 10⁶. */
function logGap(f: (x: number) => LogNum | null, g: (x: number) => LogNum | null): GapFn {
  return (x: number): Gap | null => {
    const a = f(x)
    const b = g(x)
    if (!a || !b) return null
    if (a.l === Infinity && b.l === Infinity && a.s === b.s) return null
    const d = lsum(a, { s: -b.s, l: b.l })
    if (!d || Number.isNaN(d.l)) return null
    const la = a.s !== 0 ? a.l : -Infinity
    const lb = b.s !== 0 ? b.l : -Infinity
    const m = Math.max(0, la, lb)
    const rel = d.s === 0 ? 0 : Math.exp(d.l - m)
    // ℓ carries about 16 digits of ITSELF: a relative difference below that
    // is rounding, and has no sign (x² + 3x and x² + 2x at x = 10¹⁴⁰)
    const blur =
      a.s === b.s && a.s !== 0 && Math.abs(la - lb) <= GAP_RESOLUTION * Math.max(1, Math.abs(la), Math.abs(lb))
    return { s: blur || rel <= GAP_RESOLUTION ? 0 : d.s, rel }
  }
}

/** How far "for good" is checked when f and g are read in log space. */
export const COMPARE_FAR = 1e300

/**
 * What a comparison can say:
 *   same         the formulas are one function
 *   eventual     the growth classes decide who is ahead for good, and the
 *                search found the last crossing before that
 *   beyond       the growth classes decide, but the leader at the end of
 *                the search (10³⁰⁰) is the other one: the pass lies further
 *   oscillating  f − g keeps changing sign as x grows (sin x, x·cos x)
 *   periodic     f − g is periodic: one period decides (crossings or not)
 *   window       nothing decides beyond the table: its range only
 */
export interface CompareOutcome {
  kind: 'same' | 'eventual' | 'beyond' | 'oscillating' | 'periodic' | 'window'
  /** Who is ahead for good (eventual, beyond), throughout (periodic without crossings), or at the end of the table (window). */
  leader: 'f' | 'g' | null
  /** Who is ahead at the end of the search (beyond). */
  endLeader: 'f' | 'g' | null
  crossings: number[]
  touches: number[]
  /** The last crossing. */
  last: number | null
  exact: ExactForm | null
  /**
   * Where the leader's final run began: a crossing (it passes there), a flip
   * (a pole or a gap in the domain: it is ahead after it, without a
   * crossing), or the start (ahead throughout). `first` is where both were
   * first defined.
   */
  settled: number
  settledBy: 'cross' | 'flip' | 'start'
  first: number
  /** Sign changes at poles (periodic: a difference that changes sign only there). */
  flips: number
  reason: string | null
  from: number
  to: number
}

const sideOf = (s: number): 'f' | 'g' | null => (s > 0 ? 'f' : s < 0 ? 'g' : null)

/** Compare f and g from x = from on; `end` is the table's last x. F and G: their formulas, when they are the whole curve. */
export function compareFunctions(
  f: Evaluator,
  g: Evaluator,
  F: Formula | null,
  G: Formula | null,
  from: number,
  end: number,
  names?: { f: string; g: string },
): CompareOutcome {
  const lastOf = (xs: number[]): number | null => (xs.length > 0 ? xs[xs.length - 1] : null)
  const of = (scan: CrossScan) => ({
    endLeader: null,
    exact: null,
    reason: null,
    from,
    crossings: scan.crossings,
    touches: scan.touches,
    last: lastOf(scan.crossings),
    settled: scan.settled,
    settledBy: scan.settledBy,
    first: scan.first,
    flips: scan.flips.length,
    to: scan.reach,
  })
  const window = (): CompareOutcome => {
    const to = end > from ? end : from + 1
    const scan = scanCrossings(plainGap(f, g), linearGrid(from, to))
    const last = lastOf(scan.crossings)
    return { ...of(scan), kind: 'window', leader: sideOf(scan.lastS), exact: last !== null ? crossingExact(f, g, last) : null, to }
  }
  const H: Asym | null = F && G ? diffClass(F, G) : null
  if (H && H.k === 'sum' && H.terms.length === 0 && H.exact) {
    return { ...of(scanCrossings(() => null, [])), kind: 'same', leader: null, to: Infinity }
  }
  if (H && H.k === 'sum' && H.terms.length > 0 && F && G) {
    const sigma = H.terms[0].c > 0 ? 1 : -1
    const lf = logEvaluator(F)
    const lg = logEvaluator(G)
    const gap = lf && lg ? logGap(lf, lg) : plainGap(f, g)
    const scan: CrossScan = scanCrossings(gap, compareGrid(from, COMPARE_FAR))
    if (!Number.isNaN(scan.lastS)) {
      const leader = sideOf(sigma)
      const last = lastOf(scan.crossings)
      const reason = growthReason(classify(F), classify(G), leader ?? 'f', names)
      const exact = last !== null ? crossingExact(f, g, last) : null
      if (scan.lastS === sigma) return { ...of(scan), kind: 'eventual', leader, exact, reason }
      return { ...of(scan), kind: 'beyond', leader, endLeader: sideOf(scan.lastS), exact, reason }
    }
    return window()
  }
  if (H && H.k === 'osc') {
    const scan = scanCrossings(plainGap(f, g), compareGrid(from, Math.max(end, from + 60)))
    return { ...of(scan), kind: 'oscillating', leader: null, last: null }
  }
  const T = F && G ? commonPeriod([F, G]) : null
  if (typeof T === 'number' && T > 0 && Number.isFinite(T)) {
    // One whole period from the table's start says everything: it repeats.
    const scan = scanCrossings(plainGap(f, g), linearGrid(from, from + T, 4800))
    const inPeriod = scan.crossings.filter((x) => x < from + T * (1 - 1e-9))
    if (inPeriod.length > 0) {
      // the first few, a period's worth and the start of the next
      const more = scanCrossings(plainGap(f, g), linearGrid(from, from + 2 * T, 9600))
      return { ...of(more), kind: 'periodic', leader: null, touches: [], last: null, to: Infinity }
    }
    if (!Number.isNaN(scan.lastS)) {
      // ahead throughout — unless the difference changes sign at its poles
      const leader = scan.flips.length > 0 ? null : sideOf(scan.lastS)
      return { ...of(scan), kind: 'periodic', leader, crossings: [], touches: scan.touches.filter((x) => x < from + T * (1 - 1e-9)), last: null, to: Infinity }
    }
  }
  return window()
}

/**
 * A comparison is worked out once per pair of curves (their specs, sliders
 * and the table's range) — the card, the figure and the sentences all ask.
 */
const COMPARE_CACHE = new WeakMap<ModelSpec, WeakMap<ModelSpec, Map<string, CompareOutcome>>>()

function cachedCompare(
  a: FittedCurve,
  b: FittedCurve,
  models: Record<string, ModelSpec>,
  from: number,
  end: number,
  work: () => CompareOutcome,
): CompareOutcome {
  const sa = models[a.modelId]
  const sb = models[b.modelId]
  if (!sa || !sb) return work()
  let inner = COMPARE_CACHE.get(sa)
  if (!inner) COMPARE_CACHE.set(sa, (inner = new WeakMap()))
  let m = inner.get(sb)
  if (!m) inner.set(sb, (m = new Map()))
  const key = `${a.params.join(',')}|${JSON.stringify(a.domain)}|${b.params.join(',')}|${JSON.stringify(b.domain)}|${from}|${end}`
  const hit = m.get(key)
  if (hit) return hit
  const out = work()
  if (m.size > 32) m.delete(m.keys().next().value as string)
  m.set(key, out)
  return out
}

/** At most this many crossings are listed; the rest are counted. */
export const CROSSINGS_SHOWN = 5

function crossingsLine(o: CompareOutcome): string | null {
  const list = o.crossings.map((x) => atText(x, null))
  if (o.kind === 'oscillating' || (o.kind === 'periodic' && list.length > 0)) {
    const first = list.slice(0, CROSSINGS_SHOWN)
    return first.length > 0
      ? `They cross infinitely often${o.kind === 'periodic' ? ' (the difference is periodic)' : ''}: at ${first.join(', ')}, …`
      : 'They cross infinitely often.'
  }
  if (list.length <= 1) return null
  if (list.length <= CROSSINGS_SHOWN) return `They cross at ${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}.`
  return `They cross ${list.length} times: first at ${list.slice(0, CROSSINGS_SHOWN).join(', ')} and ${list.length - CROSSINGS_SHOWN} more, the last at ${list[list.length - 1]}.`
}

/** ", except at x = 1, where they touch" — the touches after `after`. */
function touchText(touches: readonly number[], after: number | null, f: Evaluator, g: Evaluator): string {
  const t = touches.filter((x) => after === null || x > after)
  if (t.length === 0) return ''
  const at = t.slice(0, 3).map((x) => atText(x, crossingExact(f, g, x)?.text ?? null).replace(/^x [=≈] /, ''))
  const more = t.length > 3 ? ` and ${t.length - 3} more` : ''
  return `, except at x ${t.length === 1 && crossingExact(f, g, t[0]) ? '=' : '≈'} ${at.join(', ')}${more}, where they touch`
}

function compareView(
  self: FittedCurve,
  other: FittedCurve,
  ctx: TableContext,
  xs: readonly number[],
  ys: readonly number[],
  gs: readonly number[],
): CompareView {
  const f = explicitF(self, ctx.models)
  const g = explicitF(other, ctx.models)
  const nameA = nameOf(ctx, self.id)
  const nameB = nameOf(ctx, other.id)
  let sentence: string | null = null
  let crossings: string | null = null
  if (f && g && xs.length > 0) {
    const from = Math.min(...xs)
    const end = Math.max(...xs)
    const labF = labelFor(ctx, self.id)
    const labG = labelFor(ctx, other.id)
    const F = formulaOf(self, ctx.models, 'whole')
    const G = formulaOf(other, ctx.models, 'whole')
    let o: CompareOutcome | null = null
    try {
      o = cachedCompare(self, other, ctx.models, from, end, () => compareFunctions(f, g, F, G, from, end, { f: labF, g: labG }))
    } catch {
      o = null
    }
    if (o) {
      const lab = (w: 'f' | 'g' | null): string => (w === 'g' ? labG : labF)
      const lead = lab(o.leader)
      const back = lab(o.leader === 'g' ? 'f' : 'g')
      const lastAt = o.last !== null ? atText(o.last, o.exact?.text ?? null) : null
      const touch = touchText(o.touches, o.settledBy === 'start' ? null : o.settled, f, g)
      const fromText = cell(from).text
      /** Since when the leader has been ahead: "passes … after x ≈ 9.94", "is above … for every x after x = 0". */
      const since = (tail: string): string => {
        if (o!.settledBy === 'cross' && lastAt !== null) return `${lead} passes ${back} after ${lastAt}${tail}`
        if (o!.settledBy === 'flip') return `${lead} is above ${back} for every x after ${atText(o!.settled, null)}${tail}`
        const where = o!.first > from + 1e-9 * Math.max(1, Math.abs(from)) ? ' where both are defined' : ''
        return `${lead} is above ${back} for every x from x = ${fromText} on${where}${tail}`
      }
      switch (o.kind) {
        case 'same':
          sentence = `${labF} and ${labG} are the same function: they agree for every x`
          break
        case 'eventual':
          sentence = `${since(touch)}${o.settledBy === 'cross' && !touch ? '' : ','} and stays ahead for good (${o.reason})`
          break
        case 'beyond':
          sentence = `${lab(o.endLeader)} is ahead as far as x = ${fix2(o.to)}, but ${lead} passes it eventually (${o.reason})`
          break
        case 'oscillating':
          sentence = `Neither stays ahead: ${labF} − ${labG} keeps changing sign as x grows`
          break
        case 'periodic':
          sentence =
            o.leader !== null
              ? `${lead} is above ${back} for every x${touch} (the difference is periodic, so one period decides)`
              : o.crossings.length > 0
                ? `Neither stays ahead: the difference is periodic, so the pattern of crossings repeats forever`
                : `Neither stays ahead: the difference is periodic and changes sign at its asymptotes`
          break
        case 'window': {
          // Nothing decides beyond the table: say only what its range shows.
          const endText = cell(o.to).exact ? cell(o.to).text : fix2(o.to)
          const where = o.first > from + 1e-9 * Math.max(1, Math.abs(from)) ? ' where both are defined' : ''
          if (o.leader === null) sentence = null
          else if (o.settledBy === 'cross' && lastAt !== null)
            sentence = `${lead} passes ${back} after ${lastAt} and is ahead up to x = ${endText}, the end of the table${touch}`
          else if (o.settledBy === 'flip')
            sentence = `${lead} is above ${back} for every x after ${atText(o.settled, null)} up to x = ${endText}, the end of the table${touch}`
          else sentence = `${lead} is above ${back} for every x in the table, from x = ${fromText} to x = ${endText}${where}${touch}`
          break
        }
      }
      crossings = crossingsLine(o)
    }
  }
  let avg: string | null = null
  if (xs.length >= 2) {
    const i0 = 0
    const i1 = xs.length - 1
    const dx = xs[i1] - xs[i0]
    const af = (ys[i1] - ys[i0]) / dx
    const ag = (gs[i1] - gs[i0]) / dx
    if (Number.isFinite(af) && Number.isFinite(ag) && dx !== 0) {
      const rate = (v: number): string => {
        const c = cell(v)
        return /[/√π]/.test(c.text) ? `${c.text} ≈ ${tableNumber(v)}` : c.exact ? c.text : `≈ ${c.text}`
      }
      avg = `Average rate of change from x = ${cell(xs[i0]).text} to ${cell(xs[i1]).text}: ${nameA} ${rate(af)}, ${nameB} ${rate(ag)}`
    }
  }
  return { otherId: other.id, otherName: nameB, sentence, crossings, avg }
}

/**
 * The polynomial's coefficients, highest first, or null when f is not one.
 * Its FORMULA must be a polynomial (src/core/growth.ts polyDegree) and hold
 * for every x: a piecewise (x² for x < 10, x after) or a restricted curve is
 * not a polynomial, whatever its values near 0 look like.
 */
export function polyOf(curve: FittedCurve, models: Record<string, ModelSpec>): Num[] | null {
  if (curve.kind !== 'explicit') return null
  const F = formulaOf(curve, models, 'family')
  if (!F) return null
  const c = formulaCoeffs(F) ?? (polyDegree(F) !== null ? coeffsBySamples(curve, models) : null)
  return c && c.length >= 2 ? c : null
}

function coeffsBySamples(curve: FittedCurve, models: Record<string, ModelSpec>): Num[] | null {
  const f = familyF(curve, models)
  return f ? polynomialCoeffs(f) : null
}

/**
 * A polynomial formula's coefficients, highest first, expanded from the
 * formula itself (src/core/growth.ts) — 10⁷ + 0.001x² has c₂ = 0.001, not an
 * interpolation's 0.0010000002 — each snapped to a fraction when it is one.
 * Null when the formula is not a polynomial (or not one it can expand).
 */
export function formulaCoeffs(F: Formula): Num[] | null {
  if (polyDegree(F) === null) return null
  const A = classify(F)
  if (!A || A.k !== 'sum' || !A.exact) return null
  let deg = 0
  for (const t of A.terms) {
    if (t.lam !== 0 || t.q !== 0 || !Number.isInteger(t.p) || t.p < 0) return null
    deg = Math.max(deg, t.p)
  }
  const out: Num[] = []
  for (let k = deg; k >= 0; k--) out.push(toNum(A.terms.find((t) => t.p === k)?.c ?? 0))
  return out
}

function divisionView(coeffs: Num[], input: string, name: string, f: Evaluator | null): DivisionView {
  const view: DivisionView = {
    input,
    error: null,
    degree: coeffs.length - 1,
    coeffs: coeffs.map((n) => numCell(n)),
    dividend: polyText(coeffs),
    work: null,
  }
  if (input.trim() === '') return view
  const av = divisorA(input, parseX)
  if (av === null) {
    view.error = `Type a, or the divisor: −2, 1/3, x + 2`
    return view
  }
  const a = toNum(av, 1000)
  const d: SyntheticDivision | null = syntheticDivision(coeffs, a)
  if (!d) return view
  // a typed as a fraction keeps the whole tableau in fractions
  const fr = /\//.test(input)
  const r = numCell(d.remainder, fr)
  const aCell = numCell(a, fr)
  const divisor = divisorText(a, fr)
  const quotient = polyText(d.quotient, fr)
  const factor = Math.abs(numValue(d.remainder)) <= 1e-12 * Math.max(1, ...coeffs.map((c) => Math.abs(numValue(c))))
  // The Remainder Theorem, checked: f(a) straight from the curve.
  if (f) {
    const fa = f(av)
    if (Number.isFinite(fa) && Math.abs(fa - numValue(d.remainder)) > 1e-6 * Math.max(1, Math.abs(fa))) {
      view.error = 'This curve’s coefficients are not exact enough to divide.'
      return view
    }
  }
  const rTex = factor ? '0' : r.tex
  view.work = {
    a: aCell,
    products: d.products.map((n) => numCell(n, fr)),
    bottom: d.bottom.map((n) => numCell(n, fr)),
    remainder: factor ? cell(0) : r,
    quotient,
    divisor,
    factor,
    statement: `${name}(${aCell.text}) = remainder = ${factor ? '0' : r.text}`,
    verdict: factor
      ? `${divisor.text} is a factor of ${name}(x)`
      : `${divisor.text} is not a factor of ${name}(x)`,
    identity: `${name}(x) = ${divisor.tex}\\left(${quotient.tex}\\right) ${rTex.startsWith('-') ? '- ' + rTex.slice(1) : '+ ' + rTex}`,
  }
  return view
}

/**
 * Everything the Table section prints for one curve. Null when the curve is
 * not a function of x (a table needs one y per x).
 */
export function tablePanel(curve: FittedCurve, stored: ValueTableView | undefined | null, ctx: TableContext): TablePanel | null {
  if (curve.kind !== 'explicit') return null
  const spec = ctx.models[curve.modelId]
  if (!spec?.evalExplicit || typeof spec.inequality === 'function') return null
  const s = resolveTable(stored)
  const name = nameOf(ctx, curve.id)
  const ev = cellEvaluator(curve, ctx.models)
  const plain = explicitF(curve, ctx.models)
  const { xs, error } = settingsXs(s)
  const t: ValueTable | null = ev && xs.length > 0 ? valueTable(ev, xs) : null
  const others = ctx.curves
    .filter((c) => c.id !== curve.id && c.kind === 'explicit' && typeof ctx.models[c.modelId]?.inequality !== 'function')
    .map((c) => ({ id: c.id, name: nameOf(ctx, c.id) }))
  const other = s.vs ? ctx.curves.find((c) => c.id === s.vs && c.kind === 'explicit') ?? null : null
  const gEv = other ? cellEvaluator(other, ctx.models) : null

  const rows: TableRowView[] = []
  let prevLead: TableRowView['lead'] | undefined
  if (t) {
    for (let i = 0; i < t.xs.length; i++) {
      const row: TableRowView = { x: t.x[i], y: t.y[i] }
      // Beside an undefined value the difference is blank, not "undefined".
      const def = (k: number): boolean => Number.isFinite(t.y[k].v)
      if (i >= 1 && def(i) && def(i - 1)) {
        if (s.cols.includes('d1')) row.d1 = t.d1[i - 1]
        if (s.cols.includes('ratio')) row.ratio = t.ratio[i - 1]
        if (s.cols.includes('avg')) row.avg = t.avg[i - 1]
      }
      if (i >= 2 && def(i) && def(i - 1) && def(i - 2) && s.cols.includes('d2')) row.d2 = t.d2[i - 2]
      if (gEv) {
        const gy = gEv(t.xs[i])
        row.g = cell(gy)
        const fy = t.y[i].v
        if (Number.isFinite(fy) && Number.isFinite(gy)) {
          row.lead = fy > gy ? 'f' : fy < gy ? 'g' : '='
          if (prevLead && prevLead !== '=' && row.lead !== '=' && row.lead !== prevLead) row.flip = true
          prevLead = row.lead === '=' ? prevLead : row.lead
        }
      }
      rows.push(row)
    }
  }
  const pattern = t && plain ? tablePattern(t, plain, tableStructure(curve, ctx.models)) : null
  const evaluate = s.ev ? evaluateTyped(s.ev, curve, ctx) : null
  const compare =
    other && t && gEv
      ? compareView(curve, other, ctx, t.xs, t.y.map((c) => c.v), rows.map((r) => r.g?.v ?? Number.NaN))
      : null
  const coeffs = polyOf(curve, ctx.models)
  const division = coeffs ? divisionView(coeffs, s.div, name, plain) : null

  const summary =
    t && t.xs.length > 0
      ? s.list !== null
        ? `x = ${t.x.map((c) => c.text).slice(0, 4).join(', ')}${t.xs.length > 4 ? ', …' : ''}`
        : `x = ${t.x[0].text} … ${t.x[t.x.length - 1].text}, ${t.xs.length} rows`
      : 'table of values'

  return {
    curveId: curve.id,
    name,
    settings: s,
    error,
    rows,
    cols: s.cols,
    pattern,
    evaluate,
    compare,
    others,
    division,
    summary,
  }
}

// ---------------------------------------------------------------------------
// Copy to a data table
// ---------------------------------------------------------------------------

/** One cell as a data table stores it: the parser's spelling of an exact value, else its decimal. */
function dataText(c: Cell): string {
  if (!Number.isFinite(c.v)) return ''
  if (c.exact) return parserText(c.text)
  return String(Number(c.v.toPrecision(10)))
}

/** The rows "Copy to a data table" writes: (x, f(x)) for every defined row. */
export function tableDataRows(panel: TablePanel): { x: string; y: string }[] {
  return panel.rows.filter((r) => Number.isFinite(r.y.v)).map((r) => ({ x: dataText(r.x), y: dataText(r.y) }))
}

// ---------------------------------------------------------------------------
// The board: the evaluated point
// ---------------------------------------------------------------------------

/**
 * The Evaluate field's point on the board, for every curve whose card has
 * one and has not switched its dot off: the dot at (a, f(a)), dashed guides
 * down to the x-axis and across to the y-axis, and a chip stating the value
 * (an answer: reveal mode hides it).
 */
export function tableOverlays(
  curves: readonly FittedCurve[],
  tables: Readonly<Record<string, ValueTableView>>,
  ctx: TableContext,
): Overlay[] {
  const out: Overlay[] = []
  for (const c of curves) {
    const v = tables[c.id]
    if (!v?.ev || v.dot === false || !c.visible || c.kind !== 'explicit') continue
    let r: EvalView | null = null
    try {
      r = evaluateTyped(v.ev, c, ctx)
    } catch {
      r = null
    }
    if (!r || !r.ok || !r.point) continue
    const owner = curves.find((k) => k.id === r!.point!.curveId)
    if (!owner || !owner.visible) continue
    const { x, y } = r.point
    out.push({ kind: 'segment', curveId: owner.id, from: { x, y: 0 }, to: { x, y }, dashed: true })
    // the guide across to the y-axis marks f(a) there: an answer, like the chip
    out.push({ kind: 'segment', curveId: owner.id, from: { x: 0, y }, to: { x, y }, dashed: true, answer: tableKey(c.id, 'eval') })
    out.push({ kind: 'dot', curveId: owner.id, at: { x, y } })
    out.push({
      kind: 'label',
      curveId: owner.id,
      at: { x, y },
      text: r.chip,
      dir: { x: 1, y: -1 },
      answer: tableKey(c.id, 'eval'),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// The figure: a table drawn on the board
// ---------------------------------------------------------------------------

export type { ValueTableFigure }

/** Column headers on the figure: short, and every glyph one the TikZ export can set. */
const FIG_HEAD: Record<ValueTableCol, string> = { d1: 'Δy', d2: 'Δ²y', ratio: 'ratio', avg: 'rate' }

/** A figure table as a student copy prints it: every value "?". */
export const maskTableFigure = maskValueTable

/** The headers and rows a panel puts on the figure. */
export function panelFigure(panel: TablePanel, color: string, hidden = false): ValueTableFigure | null {
  if (panel.rows.length === 0) return null
  const heads = ['x', `${panel.name}(x)`]
  if (panel.compare) heads.push(`${panel.compare.otherName}(x)`)
  for (const c of panel.cols) heads.push(FIG_HEAD[c])
  const rows = panel.rows.map((r) => {
    const cells = [r.x.text, r.y.text]
    if (panel.compare) cells.push(r.g?.text ?? '')
    for (const c of panel.cols) cells.push(r[c]?.text ?? '')
    return hidden ? cells.map((t, j) => (j >= 1 && t !== '' ? '?' : t)) : cells
  })
  return { id: panel.curveId, color, heads, rows, answerFrom: 1 }
}

/** Every table a card put on the figure ("show table on figure"), in board order. */
export function tableFigures(
  curves: readonly FittedCurve[],
  tables: Readonly<Record<string, ValueTableView>>,
  ctx: TableContext,
  hidden?: (key: string) => boolean,
): ValueTableFigure[] {
  const out: ValueTableFigure[] = []
  for (const c of curves) {
    const v = tables[c.id]
    if (!v?.fig || !c.visible) continue
    let p: TablePanel | null = null
    try {
      p = tablePanel(c, { ...v, ev: undefined, div: undefined }, ctx)
    } catch {
      p = null
    }
    if (!p) continue
    const f = panelFigure(p, c.color, hidden ? hidden(tableKey(c.id, 'values')) : false)
    if (f) out.push(f)
  }
  return out
}

// ---------------------------------------------------------------------------
// In words
// ---------------------------------------------------------------------------

/** A sentence for describeGraph; `answer` sentences are left out of a student copy. */
export interface TableSentence {
  text: string
  answer?: true
}

/** The tables in words, for every curve that has stored settings. */
export function tableSentences(
  curves: readonly FittedCurve[],
  tables: Readonly<Record<string, ValueTableView>>,
  ctx: TableContext,
): TableSentence[] {
  const out: TableSentence[] = []
  for (const c of curves) {
    const v = tables[c.id]
    if (!v || !c.visible) continue
    let p: TablePanel | null = null
    try {
      p = tablePanel(c, v, ctx)
    } catch {
      p = null
    }
    if (!p || p.rows.length === 0) continue
    const xs = p.rows.map((r) => r.x.text).join(', ')
    const where = p.settings.fig ? ' is drawn on the figure' : ' is on its card'
    out.push({ text: `A table of values for ${p.name}(x)${where}, at x = ${xs}.` })
    out.push({ text: `Its values are ${p.name}(x) = ${p.rows.map((r) => r.y.text).join(', ')}.`, answer: true })
    if (p.pattern) out.push({ text: `${p.pattern.text[0].toUpperCase()}${p.pattern.text.slice(1)}.`, answer: true })
    if (p.evaluate?.ok) {
      out.push({ text: `The value ${p.evaluate.question} is worked out${p.evaluate.point && p.settings.dot ? ' and marked on the graph' : ''}.` })
      out.push({ text: `Evaluated: ${p.evaluate.text}.`, answer: true })
    }
    if (p.compare) {
      out.push({ text: `The functions ${p.name} and ${p.compare.otherName} are compared side by side in the table.` })
      if (p.compare.sentence) out.push({ text: `Compared: ${p.compare.sentence}.`, answer: true })
    }
    if (p.division?.work) {
      const w = p.division.work
      out.push({ text: `The polynomial ${p.name}(x) = ${p.division.dividend.text} is divided by ${w.divisor.text} by synthetic division.` })
      out.push({ text: `The quotient is ${w.quotient.text} with remainder ${w.remainder.text}, so ${w.statement} and ${w.verdict}.`, answer: true })
    }
  }
  return out
}

/** Columns a card offers, in order. */
export const TABLE_COLS: readonly ValueTableCol[] = VALUE_TABLE_COLS

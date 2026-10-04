// ============================================================================
// src/ui/nlSolve.ts — a SOLVE item on the number line: what it draws, how the
// drawing is laid out, and the working its card shows.
//
// The item stores only its source line (types.ts NLSolveItem). Everything
// here is recomputed from `solveInequality(src)` — cached per source line, so
// the board, the card, the export and the worksheet all share one solve.
//
//   solveCached(src)            the solver's outcome, memoised
//   solveFigureSpec(item, r)    what to draw: one LINE per clause (stacked
//                               compounds), the combined set on the board's
//                               own axis, sign rows, test points, distance
//                               brackets, exact endpoint labels
//   solveLayout(spec, axisY)    where each line and each band sits (px)
//   solveBlocks(items, vp)      every solve item on a board, stacked upward
//                               from the axis; `lift` is where the plain
//                               point/interval items start above them
//   distanceBracket(...)        the |x − a| R b bracket's geometry
//   workingSteps / workingText  the taught method, structured and as text
//   graphSources(src)           the curve(s) "Show on graph" adds
//
// Pure: no React, no DOM, no canvas.
// ============================================================================

import type { NLItem, NLSolveItem, NLSolveShow, Viewport } from '../core/types'
import { NL_SOLVE_DEFAULTS } from '../core/types'
import type { RealSet } from '../core/domainRange'
import { solveInequality } from '../core/solveInequality'
import { equationRoute } from '../core/equationRoute'
import type { EquationRoute, RouteCandidate } from '../core/equationRoute'
import { parseAst } from '../core/parse'
import type { ClauseWork, Relation, SolveOutcome, SolveResult, TestRow } from '../core/solveInequality'
import { numberLineAxisY } from '../render/numberline'
import type {
  BracketGeometry,
  SolveDistanceSpec,
  SolveFigureSpec,
  SolveLayout,
  SolveLineLayout,
  SolveLineSpec,
} from '../render/nlSolve'
import { SOLVE_BAND, distanceBracket } from '../render/nlSolve'
import type { Overlay } from '../render/overlays'
import type { Vec2 } from '../core/types'
import { isHidden, solveKey } from './reveal'
import type { RevealState } from './reveal'

export type { BracketGeometry, SolveFigureSpec, SolveLayout, SolveLineLayout, SolveLineSpec, SolveDistanceSpec }
export { distanceBracket }

/** A point or an interval: every NL item that is not a solve item. */
export type PlainNLItem = Exclude<NLItem, NLSolveItem>

export const isSolveItem = (it: NLItem): it is NLSolveItem => it.kind === 'solve'
export const isPlainItem = (it: NLItem): it is PlainNLItem => it.kind !== 'solve'

/** The display flags with the defaults filled in. */
export function solveShow(item: NLSolveItem): Required<NLSolveShow> {
  const s = item.show ?? {}
  return {
    signs: typeof s.signs === 'boolean' ? s.signs : NL_SOLVE_DEFAULTS.signs,
    tests: typeof s.tests === 'boolean' ? s.tests : NL_SOLVE_DEFAULTS.tests,
    distance: typeof s.distance === 'boolean' ? s.distance : NL_SOLVE_DEFAULTS.distance,
    stacked: typeof s.stacked === 'boolean' ? s.stacked : NL_SOLVE_DEFAULTS.stacked,
  }
}

// ---------------------------------------------------------------------------
// The solve, cached
// ---------------------------------------------------------------------------

const CACHE_MAX = 128
const cache = new Map<string, SolveOutcome>()
let solver: (src: string) => SolveOutcome = (src) => solveInequality(src)

/**
 * The solver's outcome for a source line. Never throws: a solver exception is
 * an `ok: false` like any other refusal, so one bad line cannot take a board
 * (or a worksheet page) down.
 */
export function solveCached(src: string): SolveOutcome {
  const hit = cache.get(src)
  if (hit) {
    // refresh: most recently used last
    cache.delete(src)
    cache.set(src, hit)
    return hit
  }
  let out: SolveOutcome
  try {
    out = solver(src)
    if (!out || typeof out !== 'object') out = { ok: false, error: 'The solver gave no answer' }
  } catch (e) {
    out = { ok: false, error: e instanceof Error ? e.message : 'The solver failed on this line' }
  }
  // A refusal from a solver that is not there yet must not be remembered.
  if (out.ok || out.error !== 'not implemented') {
    cache.set(src, out)
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
  }
  return out
}

/** Tests only: answer from fixtures instead of the real solver. Null restores it. */
export function setSolverForTests(fn: ((src: string) => SolveOutcome) | null): void {
  solver = fn ?? ((src) => solveInequality(src))
  cache.clear()
  routeCache.clear()
}

/** The result for an item, or null when it does not solve. */
export function solveOf(item: NLSolveItem): SolveResult | null {
  const r = solveCached(item.src)
  return r.ok ? r : null
}

/** "x^2 > > 1" with the error at 6 → "x^2 > ▸> 1". */
export function markErrorAt(src: string, pos: number | undefined): string | null {
  if (pos === undefined || !Number.isFinite(pos) || pos < 0 || pos > src.length) return null
  return `${src.slice(0, pos)}▸${src.slice(pos)}`
}

/** The solver's refusal as one line, position included when it has one. */
export function solveErrorText(src: string, out: { error: string; pos?: number }): string {
  const marked = markErrorAt(src, out.pos)
  return marked === null ? out.error : `${out.error} — at character ${(out.pos as number) + 1}: ${marked}`
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const MINUS = '−'

/** A decimal as a worksheet writes it: 4 significant digits, a real minus. */
export function numText(v: number): string {
  if (v === Infinity) return '∞'
  if (v === -Infinity) return `${MINUS}∞`
  if (!Number.isFinite(v)) return '?'
  if (Math.abs(v) < 1e-12) return '0'
  const s = Number(v.toPrecision(4)).toString()
  return s.replace(/^-/, MINUS)
}

const near = (a: number, b: number): boolean =>
  a === b || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))

/** The exact text of x if the result knows one (a critical value or a set end). */
export function exactTextAt(result: SolveResult, x: number): string {
  for (const c of result.clauses) {
    for (const cv of c.critical) if (near(cv.x, x) && cv.exact) return cv.exact.text
    for (const p of c.solution.parts) {
      if (near(p.lo, x) && p.loExact) return p.loExact.text
      if (near(p.hi, x) && p.hiExact) return p.hiExact.text
    }
  }
  for (const p of result.solution.parts) {
    if (near(p.lo, x) && p.loExact) return p.loExact.text
    if (near(p.hi, x) && p.hiExact) return p.hiExact.text
  }
  if (result.universe) {
    const u = result.universe
    if (near(u.lo, x) && u.loExact) return u.loExact.text
    if (near(u.hi, x) && u.hiExact) return u.hiExact.text
  }
  return numText(x)
}

const REL_TEXT: Record<Relation, string> = { '<': '<', '<=': '≤', '>': '>', '>=': '≥', '=': '=', '!=': '≠' }
const REL_TEX: Record<Relation, string> = { '<': '<', '<=': '\\le', '>': '>', '>=': '\\ge', '=': '=', '!=': '\\ne' }

export const relationText = (r: Relation): string => REL_TEXT[r] ?? r
export const relationTex = (r: Relation): string => REL_TEX[r] ?? r

/** "(−∞, −2)" — a test interval, always open. */
export function testIntervalText(result: SolveResult, row: TestRow): string {
  const lo = row.lo === -Infinity ? `${MINUS}∞` : exactTextAt(result, row.lo)
  const hi = row.hi === Infinity ? '∞' : exactTextAt(result, row.hi)
  return `(${lo}, ${hi})`
}

export function signText(s: TestRow['sign']): string {
  return s === 1 ? '+' : s === -1 ? MINUS : s === 0 ? '0' : 'undefined'
}

const WHY_TEXT = { zero: 'h = 0', undefined: 'h undefined', 'domain-end': 'end of the domain' } as const

/**
 * A condition per interval, built from the parts when the set's own builder
 * is only its interval text (a compound's combined set): "x < −1 or 1 < x < 3".
 */
function partsCondition(set: RealSet, v: string, tex: boolean): string | null {
  if (set.kind !== 'intervals' || set.parts.length === 0) return null
  const lt = (closed: boolean): string => (closed ? (tex ? '\\le' : '≤') : '<')
  const gt = (closed: boolean): string => (closed ? (tex ? '\\ge' : '≥') : '>')
  const end = (x: number, e: { text: string; tex: string } | null): string =>
    e ? (tex ? e.tex : e.text) : tex ? numText(x).replace(MINUS, '-') : numText(x)
  const out: string[] = []
  for (const p of set.parts) {
    const loF = Number.isFinite(p.lo)
    const hiF = Number.isFinite(p.hi)
    if (!loF && !hiF) out.push(tex ? `${v} \\in \\mathbb{R}` : `${v} ∈ ℝ`)
    else if (!loF) out.push(`${v} ${lt(p.hiClosed)} ${end(p.hi, p.hiExact)}`)
    else if (!hiF) out.push(`${v} ${gt(p.loClosed)} ${end(p.lo, p.loExact)}`)
    else if (p.lo === p.hi) out.push(`${v} = ${end(p.lo, p.loExact)}`)
    else out.push(`${end(p.lo, p.loExact)} ${lt(p.loClosed)} ${v} ${lt(p.hiClosed)} ${end(p.hi, p.hiExact)}`)
  }
  // Each clause braced into one unbreakable group, \allowbreak after the
  // "or": a long condition wraps between clauses ("x < −2 or" / "x > 2"),
  // never inside one ("x <" / "−2").
  return tex ? out.map((c) => `{${c}}`).join(' \\text{ or } \\allowbreak ') : out.join(' or ')
}

/** The builder is really a condition (not the interval text it falls back to). */
const isCondition = (set: RealSet): boolean => {
  const b = set.builder.trim()
  return b !== '' && b !== set.text.trim() && !/^[([{]/.test(b)
}

/** Set-builder: "{x | x < −2 or x > 2}" — words stay words ("all real numbers"). */
export function builderText(set: RealSet, variable = 'x'): string {
  const b = set.builder.trim()
  if (/^(all|no)\b/i.test(b) || /^the empty set/i.test(b)) return b
  const cond = isCondition(set) ? b : partsCondition(set, variable, false)
  return cond ? `{${variable} | ${cond}}` : b || set.text
}

/**
 * A condition's top-level "or"s as wrap points, with each clause one
 * unbreakable group (see partsCondition): only when the braces balance, so a
 * clause is never split mid-group.
 */
function breakableOr(tex: string): string {
  const parts = tex.split('\\text{ or }')
  if (parts.length < 2) return tex
  const balanced = (t: string): boolean => {
    let d = 0
    for (const ch of t) {
      if (ch === '{') d++
      else if (ch === '}' && --d < 0) return false
    }
    return d === 0
  }
  if (!parts.every(balanced)) return tex
  return parts.map((p) => `{${p.trim()}}`).join(' \\text{ or } \\allowbreak ')
}

export function builderTex(set: RealSet, variable = 'x'): string {
  const b = set.builder.trim()
  if (/^(all|no)\b/i.test(b) || /^the empty set/i.test(b)) return set.builderTex || set.tex
  const cond = isCondition(set) ? breakableOr(set.builderTex.trim()) : partsCondition(set, variable, true)
  return cond ? `\\{\\, ${variable} \\mid ${cond} \\,\\}` : set.builderTex || set.tex
}

/** The typed line, typeset: the clauses' own TeX joined the way they were. */
export function inputTex(result: SolveResult): string {
  if (result.clauses.length === 0) return result.solution.tex
  const u = result.universe
  const lo = (x: number, e: { tex: string } | null): string => (e ? e.tex : numText(x).replace(MINUS, '-'))
  const within = u
    ? `\\quad \\{${lo(u.lo, u.loExact)} ${u.loClosed ? '\\le' : '<'} ${result.variable || 'x'} ${u.hiClosed ? '\\le' : '<'} ${lo(u.hi, u.hiExact)}\\}`
    : ''
  if (result.combine === 'single' || result.clauses.length === 1) return result.clauses[0].tex + within
  const word = result.combine === 'and' ? '\\text{ and }' : '\\text{ or }'
  return result.clauses.map((c) => c.tex).join(word) + within
}

/** "A", "B", … for clause i. */
export const clauseName = (i: number): string => String.fromCharCode(65 + (i % 26))

/** "A ∩ B", "A ∪ B ∪ C". */
export function combineName(result: SolveResult): string {
  const op = result.combine === 'and' ? ' ∩ ' : ' ∪ '
  return result.clauses.map((_, i) => clauseName(i)).join(op)
}

// ---------------------------------------------------------------------------
// The distance reading of |x − a| R b
// ---------------------------------------------------------------------------

/** "within 3/2 of 5/2", "more than 4 from 1" … the bracket's label. */
export function distanceLabel(relation: Relation, radiusText: string, centerText: string): string {
  switch (relation) {
    case '<':
      return `within ${radiusText} of ${centerText}`
    case '<=':
      return `at most ${radiusText} from ${centerText}`
    case '>':
      return `more than ${radiusText} from ${centerText}`
    case '>=':
      return `at least ${radiusText} from ${centerText}`
    case '=':
      return `exactly ${radiusText} from ${centerText}`
    default:
      return `not ${radiusText} from ${centerText}`
  }
}

// ---------------------------------------------------------------------------
// The figure: what to draw
// ---------------------------------------------------------------------------

/** ● / ○ at every critical value and every end of the set, one per x. */
function dotsFor(set: RealSet, clause: ClauseWork | null): { x: number; closed: boolean }[] {
  const out: { x: number; closed: boolean }[] = []
  const put = (x: number, closed: boolean, strong: boolean): void => {
    if (!Number.isFinite(x)) return
    const at = out.find((d) => near(d.x, x))
    if (!at) out.push({ x, closed })
    // The SET decides (a part closed at x means x is in it); a critical
    // value's own flag only speaks where no part ends.
    else if (strong) at.closed = at.closed || closed
  }
  if (set.kind === 'intervals') {
    for (const p of set.parts) {
      put(p.lo, p.loClosed, true)
      put(p.hi, p.hiClosed, true)
    }
  } else if (set.kind === 'finite' && set.points) {
    for (const x of set.points) put(x, true, true)
  }
  // A domain end the set does not reach (0 and 2π of {0 ≤ x ≤ 2π}) is where
  // the question stops, not a boundary of the answer: no dot there.
  if (clause) for (const cv of clause.critical) if (cv.why !== 'domain-end' || cv.included) put(cv.x, cv.included, false)
  out.sort((a, b) => a.x - b.x)
  return out
}

function lineFor(
  clause: ClauseWork,
  result: SolveResult,
  show: Required<NLSolveShow>,
  label: string,
  main: boolean,
): SolveLineSpec {
  const signs =
    show.signs && clause.table.length > 0
      ? {
          marks: clause.critical.map((cv) => ({
            x: cv.x,
            label: (cv.why === 'zero' ? '0' : cv.why === 'undefined' ? 'und' : '') as '0' | 'und' | '',
          })),
          intervals: clause.table.map((r) => ({ from: r.lo, to: r.hi, sign: r.sign })),
        }
      : null
  const tests = show.tests && clause.table.length > 0 ? clause.table.map((r) => ({ x: r.t, text: `t = ${r.tText}` })) : null
  const d = clause.distance
  const distance: SolveDistanceSpec | null =
    show.distance && d && Number.isFinite(d.center) && Number.isFinite(d.radius) && d.radius >= 0
      ? {
          center: d.center,
          radius: d.radius,
          centerText: d.centerText,
          radiusText: d.radiusText,
          label: distanceLabel(clause.relation, d.radiusText, d.centerText),
        }
      : null
  void result
  return { label, main, set: clause.solution, dots: dotsFor(clause.solution, clause), signs, tests, distance }
}

/**
 * Everything one solve item draws, top line first. A single inequality is
 * one line — the board's own axis. A stacked compound is one line per clause
 * (A, B, …) and then the combined set, which is the board's axis.
 */
export function solveFigureSpec(
  item: NLSolveItem,
  result: SolveResult,
  opts: { main?: boolean } = {},
): SolveFigureSpec {
  const show = solveShow(item)
  const main = opts.main !== false
  const lines: SolveLineSpec[] = []
  const ownLabel = typeof item.label === 'string' ? item.label.trim() : ''
  if (result.combine === 'single' || result.clauses.length <= 1) {
    const clause = result.clauses[0]
    if (clause) {
      const line = lineFor(clause, result, show, main ? '' : ownLabel, main)
      // The clause's own set and the whole input's are the same set here, but
      // a universe ({0 ≤ x ≤ 2π}) is applied to the whole — draw the whole.
      line.set = result.solution
      line.dots = dotsFor(result.solution, clause)
      lines.push(line)
    } else {
      lines.push({ label: main ? '' : ownLabel, main, set: result.solution, dots: dotsFor(result.solution, null), signs: null, tests: null, distance: null })
    }
  } else {
    if (show.stacked) {
      result.clauses.forEach((c, i) => lines.push(lineFor(c, result, show, clauseName(i), false)))
    }
    lines.push({
      label: show.stacked ? combineName(result) : main ? '' : ownLabel,
      main,
      set: result.solution,
      dots: dotsFor(result.solution, null),
      signs: null,
      tests: null,
      distance: null,
    })
  }

  // Exact labels under the axis: every x a dot sits at, in its exact form.
  const exact: { x: number; text: string }[] = []
  const guides: number[] = []
  for (const l of lines) {
    for (const d of l.dots) {
      if (!exact.some((e) => near(e.x, d.x))) exact.push({ x: d.x, text: exactTextAt(result, d.x) })
      if (!guides.some((g) => near(g, d.x))) guides.push(d.x)
    }
  }
  // the centre of a distance bracket is named under the axis too (3/2)
  for (const l of lines) {
    const d = l.distance
    if (d && !exact.some((e) => near(e.x, d.center))) exact.push({ x: d.center, text: d.centerText })
  }
  // the universe's ends ({0 ≤ x ≤ 2π}) are labelled exactly too
  if (result.universe) {
    for (const x of [result.universe.lo, result.universe.hi]) {
      if (Number.isFinite(x) && !exact.some((e) => near(e.x, x))) exact.push({ x, text: exactTextAt(result, x) })
    }
  }
  exact.sort((a, b) => a.x - b.x)
  guides.sort((a, b) => a - b)
  return { id: item.id, color: item.color, lines, exact, guides: lines.length > 1 ? guides : [] }
}

// ---------------------------------------------------------------------------
// The figure: where it goes (stacked layout)
// ---------------------------------------------------------------------------

/** How far above its line each band of one line reaches, px at type 1. */
export function lineBands(line: SolveLineSpec): { tests: number; signs: number; distance: number; total: number } {
  const tests = line.tests ? SOLVE_BAND.tests : 0
  const signs = line.signs ? SOLVE_BAND.signs : 0
  const distance = line.distance ? SOLVE_BAND.distance : 0
  return { tests, signs, distance, total: SOLVE_BAND.clear + tests + signs + distance }
}

/**
 * Lay the lines out bottom-up from `baseY` (the last line sits ON it). Every
 * line keeps the same x-scale — only y is decided here. Bands stack above
 * their own line: test-point labels nearest, then the sign row, then the
 * distance bracket, so a sign never sits on a test label and the bracket
 * never crosses a sign.
 */
export function solveLayout(spec: SolveFigureSpec, baseY: number, type = 1): SolveLayout {
  const t = Number.isFinite(type) && type > 0 ? type : 1
  const out: SolveLineLayout[] = new Array(spec.lines.length)
  let y = baseY
  for (let i = spec.lines.length - 1; i >= 0; i--) {
    const line = spec.lines[i]
    const b = lineBands(line)
    let reach = SOLVE_BAND.clear * t
    const testsY = line.tests ? y - reach - (SOLVE_BAND.tests * t) / 2 : null
    reach += b.tests * t
    const signsY = line.signs ? y - reach - (SOLVE_BAND.signs * t) / 2 : null
    reach += b.signs * t
    const bracketY = line.distance ? y - reach - SOLVE_BAND.bracketDrop * t : null
    reach += b.distance * t
    // A stacked line carries its name ABOVE it at the left: room for it.
    if (line.label !== '' && !line.tests && !line.signs && !line.distance) reach = Math.max(reach, SOLVE_BAND.label * t)
    out[i] = { y, testsY, signsY, bracketY, top: y - reach }
    y = y - reach - SOLVE_BAND.gap * t
  }
  const top = out.length > 0 ? Math.min(...out.map((l) => l.top)) : baseY
  return { lines: out, top }
}

// ---------------------------------------------------------------------------
// Every solve item on a board
// ---------------------------------------------------------------------------

export interface SolveBlock {
  item: NLSolveItem
  result: SolveResult
  spec: SolveFigureSpec
  layout: SolveLayout
}

export interface SolveBlocks {
  blocks: SolveBlock[]
  /**
   * How far above the axis the plain items' lane 0 sits, px: 0 when there is
   * no solve item (so an old board is laid out exactly as before).
   */
  lift: number
  /** the topmost px any solve block reaches (axisY when none) */
  top: number
}

/** Space between one solve item's block and the next one above it. */
const BLOCK_GAP = 18

/**
 * All the solve items, stacked upward from the axis: the first one draws its
 * set ON the board's axis (the worksheet picture), each later one on its own
 * labelled line above. Items that do not solve take no room.
 */
export function solveBlocks(items: readonly NLItem[], vp: Viewport, type = 1): SolveBlocks {
  const axisY = numberLineAxisY(vp)
  const blocks: SolveBlock[] = []
  let base = axisY
  let top = axisY
  for (const it of items) {
    if (!isSolveItem(it)) continue
    const result = solveOf(it)
    if (!result) continue
    const main = blocks.length === 0
    const spec = solveFigureSpec(it, result, { main })
    const layout = solveLayout(spec, base, type)
    blocks.push({ item: it, result, spec, layout })
    top = Math.min(top, layout.top)
    base = layout.top - BLOCK_GAP * type
  }
  const lift = blocks.length > 0 ? Math.max(0, axisY - top) + BLOCK_GAP * type : 0
  return { blocks, lift, top }
}

/** The x's a solve item wants in view: critical values, set ends, distance ends. */
export function solveXs(result: SolveResult): number[] {
  const xs: number[] = []
  const add = (x: number): void => {
    if (Number.isFinite(x)) xs.push(x)
  }
  for (const c of result.clauses) {
    for (const cv of c.critical) add(cv.x)
    if (c.distance) {
      add(c.distance.center - c.distance.radius)
      add(c.distance.center + c.distance.radius)
    }
  }
  for (const p of result.solution.parts) {
    add(p.lo)
    add(p.hi)
  }
  for (const x of result.solution.points ?? []) add(x)
  if (result.universe) {
    add(result.universe.lo)
    add(result.universe.hi)
  }
  return xs
}

/**
 * The x-range to frame for a set of x's: their span with a margin, at least
 * 2 units wide, and never collapsed to a point (x = 3 alone frames [1, 5]).
 */
export function fitRange(xs: readonly number[]): { min: number; max: number } | null {
  const f = xs.filter((x) => Number.isFinite(x))
  if (f.length === 0) return null
  let min = Math.min(...f)
  let max = Math.max(...f)
  const span = max - min
  const pad = Math.max(1, span * 0.25)
  min -= pad
  max += pad
  return { min, max }
}

// ---------------------------------------------------------------------------
// The working, as taught
// ---------------------------------------------------------------------------

export type WorkingStep =
  | { kind: 'heading'; text: string; tex: string }
  | { kind: 'line'; text: string; tex?: string }
  | { kind: 'table'; clause: number; rows: WorkingRow[]; hName: string }
  | { kind: 'conclusion'; text: string; tex: string }
  | { kind: 'note'; text: string }

export interface WorkingRow {
  interval: string
  t: string
  value: string
  sign: string
  ok: boolean
}

function criticalSentence(result: SolveResult, clause: ClauseWork, v: string): string {
  if (clause.critical.length === 0) return `Critical values: none — h never changes sign, so one test point decides.`
  const parts = clause.critical.map((cv) => `${v} = ${exactTextAt(result, cv.x)} (${WHY_TEXT[cv.why] ?? cv.why})`)
  return `Critical values: ${parts.join(', ')}`
}

function domainSentence(clause: ClauseWork): string | null {
  if (!clause.domain) return null
  const d = clause.domain
  const words = d.builder && /^all real/i.test(d.builder) ? 'all real numbers' : d.text
  return `Domain of h: ${words}`
}

function clauseSteps(result: SolveResult, clause: ClauseWork, index: number, compound: boolean): WorkingStep[] {
  const v = result.variable || 'x'
  const rel = relationText(clause.relation)
  const steps: WorkingStep[] = []
  if (compound) {
    steps.push({ kind: 'heading', text: `${clauseName(index)}: ${clause.text}`, tex: `\\text{${clauseName(index)}:}\\ ${clause.tex}` })
  }
  // A set typed as itself — [0, 5), {1, 2, 3}, x ∈ (−∞, 4] — has nothing to
  // solve: no h, no critical values, no test points. Say what it is.
  if (clause.table.length === 0 && clause.hText.trim() === clause.text.trim()) {
    steps.push({ kind: 'line', text: `This is already a set: ${clause.solution.text}.`, tex: clause.solution.tex })
    if (compound) {
      steps.push({ kind: 'line', text: `So ${clauseName(index)} = ${clause.solution.text}`, tex: `${clauseName(index)} = ${clause.solution.tex}` })
    }
    return steps
  }
  steps.push({
    kind: 'line',
    text: `Let h(${v}) = ${clause.hText}; solve h(${v}) ${rel} 0.`,
    tex: `h(${v}) = ${clause.hTex},\\quad h(${v}) ${relationTex(clause.relation)} 0`,
  })
  const dom = domainSentence(clause)
  if (dom) steps.push({ kind: 'line', text: dom })
  steps.push({ kind: 'line', text: criticalSentence(result, clause, v) })
  if (clause.table.length > 0) {
    steps.push({
      kind: 'table',
      clause: index,
      hName: `h(t)`,
      rows: clause.table.map((r) => ({
        interval: testIntervalText(result, r),
        t: r.tText,
        value: r.value === null ? 'undefined' : r.valueText,
        sign: signText(r.sign),
        ok: r.satisfies,
      })),
    })
  }
  if (clause.distance) steps.push({ kind: 'line', text: clause.distance.sentence })
  if (compound) {
    steps.push({ kind: 'line', text: `So ${clauseName(index)} = ${clause.solution.text}`, tex: `${clauseName(index)} = ${clause.solution.tex}` })
  }
  return steps
}

/** The whole working, in the order it is taught. */
export function workingSteps(result: SolveResult): WorkingStep[] {
  const compound = result.combine !== 'single' && result.clauses.length > 1
  const steps: WorkingStep[] = []
  // the universe first: it is part of the question ("on 0 ≤ x ≤ 2π")
  if (result.universe) {
    const u = result.universe
    const lo = u.loExact?.text ?? numText(u.lo)
    const hi = u.hiExact?.text ?? numText(u.hi)
    steps.push({
      kind: 'line',
      text: `Only ${lo} ${u.loClosed ? '≤' : '<'} ${result.variable || 'x'} ${u.hiClosed ? '≤' : '<'} ${hi} is considered.`,
    })
  }
  result.clauses.forEach((c, i) => steps.push(...clauseSteps(result, c, i, compound)))
  if (compound) {
    const both = result.combine === 'and'
    steps.push({ kind: 'heading', text: `Combine (${both ? 'and' : 'or'})`, tex: `\\text{Combine (${both ? 'and' : 'or'})}` })
    steps.push({
      kind: 'line',
      text: both
        ? `Both must hold, so intersect: ${combineName(result)} = ${result.solution.text}`
        : `Either may hold, so unite: ${combineName(result)} = ${result.solution.text}`,
    })
  }
  steps.push({ kind: 'conclusion', text: result.conclusion, tex: result.conclusionTex })
  for (const n of result.notes) steps.push({ kind: 'note', text: n })
  return steps
}

/** A table as fixed-width text columns. */
export function tableText(rows: readonly WorkingRow[], hName = 'h(t)'): string[] {
  const head = ['interval', 'test point', hName, 'sign', '✓/✗']
  const body = rows.map((r) => [r.interval, r.t, r.value, r.sign, r.ok ? '✓' : '✗'])
  const widths = head.map((h, c) => Math.max(h.length, ...body.map((b) => b[c].length)))
  const fmt = (cells: string[]): string =>
    cells.map((cell, c) => (c === cells.length - 1 ? cell : cell.padEnd(widths[c]))).join(' | ')
  return [fmt(head), widths.map((w, c) => '-'.repeat(c === widths.length - 1 ? 3 : w)).join('-+-'), ...body.map(fmt)]
}

/** The working as plain text, ready to paste into a handout or a key. */
export function workingText(src: string, result: SolveResult): string {
  const lines: string[] = [`Solve ${src.trim()}`]
  let n = 0
  for (const s of workingSteps(result)) {
    if (s.kind === 'heading') {
      lines.push('', s.text)
      n = 0
    } else if (s.kind === 'line') lines.push(`${++n}. ${s.text}`)
    else if (s.kind === 'table') {
      lines.push(`${++n}. Test a point in each interval:`)
      for (const t of tableText(s.rows, s.hName)) lines.push(`   ${t}`)
    } else if (s.kind === 'conclusion') lines.push('', s.text)
    else lines.push(`Note: ${s.text}`)
  }
  lines.push(`Interval notation: ${result.solution.text}`)
  lines.push(`Set-builder: ${builderText(result.solution, result.variable || 'x')}`)
  const route = routeOf(src, result)
  if (route) lines.push('', ...routeText(route, result.variable || 'x'))
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// The algebraic route of an EQUATION, and its extraneous solutions
// ---------------------------------------------------------------------------

/**
 * How a class would solve this equation by hand — square both sides, clear
 * the denominators, combine the logs (src/core/equationRoute.ts), or take
 * logarithms of an exponential equation (src/core/expSolve.ts) — with every
 * candidate checked in the ORIGINAL equation. The solver's own answer (the
 * sign of L − R) is unaffected: this is the working beside it.
 */
export interface SolveRoute {
  kind: EquationRoute['kind'] | 'exp'
  method: string
  steps: { text: string; tex?: string }[]
  candidates: RouteCandidate[]
  identity: boolean
  summary: string
  /** for an exponential equation: the solution's equal exact forms and its value */
  exp?: { forms: { text: string; tex: string }[]; x: number }
}

const routeCache = new Map<string, SolveRoute | null>()

/** The two sides of a single top-level "=" (no restriction, no compound), or null. */
function equationSides(src: string): [string, string] | null {
  const body = src.trim()
  if (/\{[^{}]*\}\s*$/.test(body) && !/^\{/.test(body)) return null
  if (splitConnectives(body).length !== 1) return null
  const parts = splitRelations(body)
  if (!parts || parts.length !== 2) return null
  // exactly one relation, and it is "="
  let depth = 0
  const ops: string[] = []
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    else if (depth === 0) {
      REL_RE.lastIndex = i
      const m = REL_RE.exec(body)
      if (m) {
        ops.push(m[0])
        i += m[0].length - 1
      }
    }
  }
  return ops.length === 1 && ops[0] === '=' ? [parts[0], parts[1]] : null
}

/** The route for a solved line, or null when it is not a single equation the route reads. */
export function routeOf(src: string, result: SolveResult | null): SolveRoute | null {
  if (!result || result.combine !== 'single' || result.clauses.length !== 1 || result.universe) return null
  const clause = result.clauses[0]
  if (clause.relation !== '=') return null
  const key = src
  if (routeCache.has(key)) return routeCache.get(key) ?? null
  let out: SolveRoute | null = null
  try {
    const v = result.variable || 'x'
    if (clause.exp) {
      const forms = clause.exp.forms
      // four decimal places, the way a calculator check is written: ≈ 1.2224
      const dec = clause.exp.x.toFixed(4).replace(/^-/, MINUS)
      const shown = `${forms.map((f) => f.text).join(' = ')} ≈ ${dec}`
      out = {
        kind: 'exp',
        method: 'Take logarithms',
        steps: clause.exp.steps.map((st) => ({ text: st.text, tex: st.tex })),
        candidates: [
          { x: clause.exp.x, text: forms[0].text, tex: forms[0].tex, exact: true, ok: true, reason: `${v} = ${shown}` },
        ],
        identity: false,
        summary: `${v} = ${shown}`,
        exp: { forms, x: clause.exp.x },
      }
    } else {
      const sides = equationSides(src)
      if (sides) {
        const fix = (t: string): string => t.replace(/√/g, 'sqrt').replace(/[−–]/g, '-')
        const L = parseAst(fix(sides[0]))
        const R = parseAst(fix(sides[1]))
        if (L.ok && R.ok && L.rhs === null && R.rhs === null) {
          const name = v === 'θ' ? 'theta' : v
          const r = equationRoute(L.lhs, R.lhs, name, v)
          if (r) out = { kind: r.kind, method: r.method, steps: r.steps, candidates: r.candidates, identity: r.identity, summary: r.summary }
        }
      }
    }
  } catch {
    out = null
  }
  routeCache.set(key, out)
  if (routeCache.size > CACHE_MAX) routeCache.delete(routeCache.keys().next().value as string)
  return out
}

/** The route as plain text lines, for "Copy as text". */
export function routeText(route: SolveRoute, v = 'x'): string[] {
  const lines = [`Algebraic route — ${route.method}:`]
  route.steps.forEach((st, i) => lines.push(`  ${i + 1}. ${st.text}`))
  if (route.kind !== 'exp' && route.candidates.length > 0) {
    lines.push('  Check each candidate in the original equation:')
    for (const c of route.candidates) {
      lines.push(`   ${c.ok ? '✓' : '✗'} ${v} = ${c.text}${c.ok ? '' : ' (extraneous)'}: ${c.reason}`)
    }
  }
  lines.push(`  ${route.summary}`)
  return lines
}

/** A sentence for "Show on graph" about the candidates the graphs do NOT confirm. */
export function graphNote(src: string): string | null {
  const r = routeOf(src, solveOf({ kind: 'solve', id: '', src, color: '' } as NLSolveItem))
  if (!r || r.kind === 'exp') return null
  const bad = r.candidates.filter((c) => !c.ok)
  if (bad.length === 0) return null
  const list = bad.map((c) => `x = ${c.text}`).join(' and ')
  return `${list} ${bad.length > 1 ? 'are' : 'is'} extraneous — the graphs do not meet there.`
}

/** Is `src` a single equation "Show on graph" draws as its two sides (y = L and y = R)? */
function graphsAsSides(src: string, wanted: readonly GraphCurve[] | null): boolean {
  return !!wanted && wanted.length === 2 && wanted.every((g) => !g.signChart) && /=/.test(src) && !/[<>≤≥≠!]/.test(src)
}

/**
 * Show on graph's toast note, or null: none while reveal mode hides the
 * item's solution — the extraneous candidate is part of the route, which is
 * behind that answer.
 */
export function graphNoteShown(item: { id: string; src: string }, reveal: RevealState | null): string | null {
  if (reveal && isHidden(reveal, solveKey(item.id))) return null
  return graphsAsSides(item.src, graphSources(item.src)) ? graphNote(item.src) : null
}

/**
 * On the Graph board, the extraneous candidates of each solved equation whose
 * two sides are drawn there: a hollow dot on each side's graph at the
 * candidate's x (they do not meet there — √(x + 7) is 3 at x = 2, x − 5 is
 * −3), and a chip "x = 2 (extraneous)". Where neither side has a value (a
 * denominator or a log argument is 0 or negative) the dot sits on the x-axis.
 * Each mark carries the item's solution key, so reveal mode hides it with the
 * route.
 */
export function extraneousOverlays(
  items: readonly NLItem[],
  curves: readonly { id: string; modelId: string; params: number[]; visible: boolean }[],
  exprSources: Readonly<Record<string, string>>,
  evalAt: (curveId: string, x: number) => number,
): Overlay[] {
  const out: Overlay[] = []
  for (const it of items) {
    if (it.kind !== 'solve') continue
    const wanted = graphSources(it.src)
    if (!wanted || !graphsAsSides(it.src, wanted)) continue
    const ids = wanted.map((g) => {
      const hit = Object.entries(exprSources).find(([id, src]) => src.trim() === g.src && curves.some((c) => c.id === id && c.visible))
      return hit ? hit[0] : null
    })
    if (ids.some((id) => id === null)) continue
    const r = routeOf(it.src, solveOf(it))
    if (!r || r.kind === 'exp') continue
    const key = solveKey(it.id)
    for (const c of r.candidates) {
      if (c.ok || !Number.isFinite(c.x)) continue
      const at: Vec2[] = []
      for (const id of ids as string[]) {
        let y = Number.NaN
        try { y = evalAt(id, c.x) } catch { y = Number.NaN }
        if (Number.isFinite(y)) {
          at.push({ x: c.x, y })
          out.push({ kind: 'dot', curveId: id, at: { x: c.x, y }, hollow: true, answer: key })
        }
      }
      if (at.length === 0) {
        at.push({ x: c.x, y: 0 })
        out.push({ kind: 'dot', at: { x: c.x, y: 0 }, hollow: true, color: it.color, answer: key })
      }
      const top = at.reduce((p, q) => (q.y > p.y ? q : p))
      out.push({ kind: 'label', at: top, text: `x = ${c.text} (extraneous)`, dir: { x: 0, y: -1 }, color: it.color, answer: key })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// "Show on graph": the curve(s) to add to the Graph board
// ---------------------------------------------------------------------------

export interface GraphCurve {
  /** a line the Graph board's equation box accepts: "y = x^2 - 4" */
  src: string
  /** attach a sign chart of the curve's own sign (h above / below the x-axis) */
  signChart: boolean
}

const REL_RE = /<=|>=|!=|=<|=>|≤|≥|≠|<|>|=/y

/** Split at top-level relation operators (outside (), [], {}). */
function splitRelations(s: string): string[] | null {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    else if (depth === 0) {
      REL_RE.lastIndex = i
      const m = REL_RE.exec(s)
      if (m) {
        parts.push(s.slice(start, i).trim())
        i += m[0].length - 1
        start = i + 1
      }
    }
  }
  parts.push(s.slice(start).trim())
  return parts.some((p) => p === '') ? null : parts
}

/** Split at top-level " and " / " or ". */
function splitConnectives(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    else if (depth === 0) {
      const m = /^\s+(and|or)\s+/i.exec(s.slice(i))
      if (m && /\s/.test(ch)) {
        out.push(s.slice(start, i).trim())
        i += m[0].length - 1
        start = i + 1
      }
    }
  }
  out.push(s.slice(start).trim())
  return out.filter((p) => p !== '')
}

/** One top-level relation, and it is "=" (not ≤, ≥, ≠). */
function isEquation(clause: string): boolean {
  let depth = 0
  const ops: string[] = []
  for (let i = 0; i < clause.length; i++) {
    const ch = clause[i]
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    else if (depth === 0) {
      REL_RE.lastIndex = i
      const m = REL_RE.exec(clause)
      if (m) {
        ops.push(m[0])
        i += m[0].length - 1
      }
    }
  }
  return ops.length === 1 && ops[0] === '='
}

const isZero = (s: string): boolean => /^\(?\s*0+(\.0*)?\s*\)?$/.test(s)
const needsParens = (s: string): boolean => /[+\-−]/.test(s.replace(/^\s*[-−]/, '')) || /^\s*[-−]/.test(s)

/**
 * The curves that picture an inequality on the Graph board. For L R R the
 * method's own function h = L − R (just L when R is 0), with its sign chart:
 * the solution is where the graph of h is above / below the x-axis, and the
 * chart's strip under the graph IS the solution intervals marked on the
 * x-axis. A chain a < E < b draws y = E and the two levels. A restriction
 * {…} is carried onto every curve. Null when nothing could be read.
 */
export function graphSources(src: string): GraphCurve[] | null {
  let body = src.trim()
  let restr = ''
  const m = /\{[^{}]*\}\s*$/.exec(body)
  if (m && m.index > 0) {
    restr = ` ${m[0].trim()}`
    body = body.slice(0, m.index).trim()
  }
  const out: GraphCurve[] = []
  for (const clause of splitConnectives(body)) {
    const parts = splitRelations(clause)
    if (!parts || parts.length < 2) continue
    if (parts.length === 2) {
      const [L, R] = parts
      // An EQUATION with x on both sides is pictured as the two sides, y₁ = L
      // and y₂ = R: its solutions are where the graphs MEET (the board marks
      // those crossings), and a candidate the algebra produced that is not a
      // crossing is extraneous for all to see.
      if (isEquation(clause) && !isZero(R) && !isZero(L)) {
        out.push({ src: `y = ${L}${restr}`, signChart: false })
        out.push({ src: `y = ${R}${restr}`, signChart: false })
        continue
      }
      let h: string
      if (isZero(R)) h = L
      else if (isZero(L)) h = R
      else h = `${L} - ${needsParens(R) ? `(${R})` : R}`
      out.push({ src: `y = ${h}${restr}`, signChart: true })
    } else if (parts.length === 3) {
      const [a, e, b] = parts
      out.push({ src: `y = ${e}${restr}`, signChart: false })
      out.push({ src: `y = ${a}`, signChart: false })
      out.push({ src: `y = ${b}`, signChart: false })
    }
  }
  // the graph's equation box reads sqrt(…), not the √ a solve line may be typed with
  for (const c of out) c.src = c.src.replace(/√/g, 'sqrt')
  // the same curve twice is one curve
  const seen = new Set<string>()
  const uniq = out.filter((c) => (seen.has(c.src) ? false : (seen.add(c.src), true)))
  return uniq.length > 0 ? uniq : null
}

/**
 * What a click near a solved inequality's lines lands on: the item, when the
 * pointer is on one of its lines over its set (a bar or a dot). Null otherwise
 * — the bare line between bars still places a point, as it always has.
 */
export function solveHit(
  items: readonly NLItem[],
  vp: Viewport,
  pos: { x: number; y: number },
  type = 1,
  radius = 11,
): string | null {
  const { blocks } = solveBlocks(items, vp, type)
  for (let b = blocks.length - 1; b >= 0; b--) {
    const { spec, layout, item } = blocks[b]
    for (let i = 0; i < spec.lines.length; i++) {
      const y = layout.lines[i].y
      if (Math.abs(pos.y - y) > radius) continue
      const line = spec.lines[i]
      const x = (vp.center.x + (pos.x - vp.widthPx / 2) / vp.pxPerUnit)
      const tol = radius / vp.pxPerUnit
      if (line.dots.some((d) => Math.abs(d.x - x) <= tol)) return item.id
      if (line.set.kind === 'intervals' && line.set.parts.some((p) => x >= p.lo - tol && x <= p.hi + tol)) return item.id
    }
  }
  return null
}

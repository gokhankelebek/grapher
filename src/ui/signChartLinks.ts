// ============================================================================
// src/ui/signChartLinks.ts — the sign-chart link: f, f′ and f″ as strips along
// the bottom of the board and as the AP statements they justify on the card —
// and "treat this graph as f′ (or f″)", the AP classic.
//
// src/core/signChart.ts owns the mathematics (the rows, the conclusions). This
// module owns what a teacher SEES of it:
//
//   the card    which rows, what the graph is taken to be, a small chart per
//               row, the conclusions (copyable as plain text), and the
//               closed interval of the Candidates Test
//   the board   SignChartFigure — the strips' rows, ticks and guides
//
// Everything is recomputed from the link { as?, rows, arrows?, cup?, guides?,
// a?, b? } on every change; nothing computed is stored. One analysis per
// (curve as it is now, as, range, interval) is cached, so the card and the
// board — both rebuilt on every frame of a slider drag — share it. The cache
// keys on App's depKeys, so a chart on p(x) = h(x) + 1 moves when h does.
//
// Pure: no React, no DOM, no canvas.
// ============================================================================

import type { FittedCurve, ModelSpec } from '../core/types'
import type { SignChartLink, SignLevel } from '../core/persist'
import { SIGN_LEVELS, signRowsFor } from '../core/persist'
import { chartSourceOf, conclusionsOf, signChartOf, xText } from '../core/signChart'
import type { ChartSource, Conclusion, SignChart } from '../core/signChart'
import type { SignChartFigure, SignStripRow } from '../render/signChart'

export type { SignChartLink, SignLevel }

/** f → "f", f1 → "f′", f2 → "f″", for the letter L. */
export function levelName(level: SignLevel, L = 'f'): string {
  return level === 'f' ? L : level === 'f1' ? `${L}′` : `${L}″`
}

/** The rows a fresh chart shows: f′ for a graph of f, the graph's own row otherwise. */
export function defaultSignRows(as: SignLevel = 'f'): SignLevel[] {
  return [as === 'f' ? 'f1' : as]
}

/**
 * The x-range a chart is analysed over: the view (App's crossSpan — padded
 * and snapped coarse, so a pan re-solves only when the board has moved on)
 * joined with [−10, 10], where the features of a lesson's function live. The
 * chart itself runs on past both ends to ±∞ wherever the signs stop changing.
 */
export function signRange(span: readonly [number, number] | null | undefined): [number, number] {
  const lo = span && Number.isFinite(span[0]) ? Math.min(span[0], span[1]) : -10
  const hi = span && Number.isFinite(span[1]) ? Math.max(span[0], span[1]) : 10
  return [Math.min(-10, lo), Math.max(10, hi)]
}

// ---------------------------------------------------------------------------
// The analysis, cached
// ---------------------------------------------------------------------------

const SERIALS = new WeakMap<object, number>()
let serialNext = 1
const serialOf = (o: object | undefined): number => {
  if (!o) return 0
  let n = SERIALS.get(o)
  if (n === undefined) {
    n = serialNext++
    SERIALS.set(o, n)
  }
  return n
}

/** One curve as it is now; `dep` is App's depKeys[curve.id]. */
const curveKey = (c: FittedCurve, models: Record<string, ModelSpec>, dep = ''): string =>
  [c.modelId, serialOf(models[c.modelId]), c.params.join(','), c.domain ? c.domain.join(',') : '', dep].join('|')

export interface SignAnalysis {
  src: ChartSource | null
  /** The rows, by level (absent: not a row of this `as`). */
  charts: Partial<Record<SignLevel, SignChart | null>>
  conclusions: Conclusion[]
}

const CACHE = new Map<string, SignAnalysis>()
const CACHE_MAX = 32

function remember(key: string, value: SignAnalysis): SignAnalysis {
  CACHE.set(key, value)
  while (CACHE.size > CACHE_MAX) {
    const oldest = CACHE.keys().next().value
    if (oldest === undefined) break
    CACHE.delete(oldest)
  }
  return value
}

/** The rows and the statements for this curve, as it is now. */
export function analyzeSigns(
  parent: FittedCurve,
  models: Record<string, ModelSpec>,
  as: SignLevel,
  range: readonly [number, number],
  interval: readonly [number, number] | null,
  fName: string,
  dep = '',
): SignAnalysis {
  const key = `${curveKey(parent, models, dep)}|${as}|${range[0]},${range[1]}|${interval ? interval.join(',') : ''}|${fName}`
  const hit = CACHE.get(key)
  if (hit) {
    CACHE.delete(key)
    CACHE.set(key, hit)
    return hit
  }
  const out: SignAnalysis = { src: null, charts: {}, conclusions: [] }
  try {
    out.src = chartSourceOf(parent, models)
  } catch {
    out.src = null
  }
  if (out.src) {
    for (const level of signRowsFor(as)) {
      try {
        out.charts[level] = signChartOf(out.src, level, range, as)
      } catch {
        out.charts[level] = null
      }
    }
    try {
      out.conclusions = conclusionsOf(out.src, range, { as, interval, fName })
    } catch {
      out.conclusions = []
    }
  }
  return remember(key, out)
}

const asOf = (link: Pick<SignChartLink, 'as'>): SignLevel => (link.as === 'f1' || link.as === 'f2' ? link.as : 'f')
const intervalOf = (link: Pick<SignChartLink, 'a' | 'b'>): [number, number] | null =>
  typeof link.a === 'number' && typeof link.b === 'number' && Number.isFinite(link.a) && Number.isFinite(link.b) && link.a !== link.b
    ? [Math.min(link.a, link.b), Math.max(link.a, link.b)]
    : null

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

/** One cell of the card's small chart: a sign (or arrow, or cup) or a critical x. */
export type SignCell =
  | { kind: 'sign'; text: string; sign: 1 | -1 | 0 | null }
  | { kind: 'mark'; x: string; at: '0' | 'und' | '' }
  | { kind: 'more' }

export interface SignCardRow {
  level: SignLevel | 'arrows' | 'cup'
  label: string
  cells: SignCell[]
}

/** One sign chart, as its PARENT's card shows it. */
export interface SignChartRow {
  linkId: string
  as: SignLevel
  /** The rows shown (in order) and the rows that may be shown. */
  rows: SignLevel[]
  available: SignLevel[]
  arrows: boolean
  cup: boolean
  guides: boolean
  /** The Candidates Test interval, when set, and its ends in exact text. */
  a: number | null
  b: number | null
  aText: string
  bText: string
  fName: string
  /** "Sign chart of f′", "Graph taken as f′" */
  title: string
  /** The small chart on the card, one line per strip shown. */
  chart: SignCardRow[]
  conclusions: Conclusion[]
  /** Everything above as plain text — what "Copy" puts on the clipboard. */
  plain: string
  problem: string | null
}

/** The card's small chart for one row. */
function cardCells(chart: SignChart, kind: 'sign' | 'arrows' | 'cup'): SignCell[] {
  const cells: SignCell[] = []
  if (chart.truncated[0]) cells.push({ kind: 'more' })
  const glyph = (s: 1 | -1 | 0 | null): string => {
    if (s === null) return '·'
    if (kind === 'arrows') return s === 1 ? '↗' : s === -1 ? '↘' : '→'
    if (kind === 'cup') return s === 1 ? '∪' : s === -1 ? '∩' : '—'
    return s === 1 ? '+' : s === -1 ? '−' : '0'
  }
  const markAt = (x: number): SignCell | null => {
    const m = chart.marks.find((mm) => mm.x === x)
    if (!m) return null
    return { kind: 'mark', x: m.text, at: kind === 'sign' ? (m.at === 'zero' ? '0' : m.at === 'und' ? 'und' : '') : '' }
  }
  chart.intervals.forEach((iv, i) => {
    if (i === 0 && Number.isFinite(iv.from)) {
      const m = markAt(iv.from)
      if (m) cells.push(m)
    }
    cells.push({ kind: 'sign', text: glyph(iv.sign), sign: iv.sign })
    if (Number.isFinite(iv.to)) {
      const m = markAt(iv.to)
      if (m) cells.push(m)
    }
  })
  if (chart.truncated[1]) cells.push({ kind: 'more' })
  return cells
}

/** One line of plain text per strip: "f′:  +  (−1: 0)  −  (1: 0)  +". */
function plainLine(row: SignCardRow): string {
  const parts = row.cells.map((c) =>
    c.kind === 'sign' ? c.text : c.kind === 'more' ? '…' : c.at ? `[${c.x}: ${c.at}]` : `[${c.x}]`,
  )
  return `${row.label}:  ${parts.join('  ')}`
}

/**
 * What the card says about one sign chart: the rows asked for, drawn small;
 * the AP statements; and why there is nothing, when there is nothing.
 */
export function signChartRow(
  link: SignChartLink,
  parent: FittedCurve | undefined,
  models: Record<string, ModelSpec>,
  fName = 'f',
  /** depKeys[parent.id]: the curves this one calls, as they are now. */
  dep = '',
  range: readonly [number, number] = [-10, 10],
): SignChartRow {
  const as = asOf(link)
  const available = signRowsFor(as)
  const rows = SIGN_LEVELS.filter((l) => available.includes(l) && link.rows.includes(l))
  const iv = intervalOf(link)
  const row: SignChartRow = {
    linkId: link.id,
    as,
    rows,
    available,
    arrows: link.arrows === true && as !== 'f2',
    cup: link.cup === true,
    guides: link.guides === true,
    a: iv ? iv[0] : null,
    b: iv ? iv[1] : null,
    aText: iv ? xText(iv[0]) : '',
    bText: iv ? xText(iv[1]) : '',
    fName,
    title: as === 'f' ? `Sign chart of ${fName}` : `This graph is ${levelName(as, fName)}`,
    chart: [],
    conclusions: [],
    plain: '',
    problem: null,
  }
  if (!parent) {
    row.problem = 'the curve it was drawn for is gone'
    return row
  }
  const an = analyzeSigns(parent, models, as, range, iv, fName, dep)
  if (!an.src) {
    row.problem = `${fName} is not a function of x`
    return row
  }
  for (const level of SIGN_LEVELS) {
    const c = an.charts[level]
    if (!c) continue
    if (rows.includes(level)) row.chart.push({ level, label: levelName(level, fName), cells: cardCells(c, 'sign') })
    // The behaviour rows ride their sign row's chart, shown or not.
    if (level === 'f1' && row.arrows) row.chart.push({ level: 'arrows', label: fName, cells: cardCells(c, 'arrows') })
    if (level === 'f2' && row.cup) row.chart.push({ level: 'cup', label: fName, cells: cardCells(c, 'cup') })
  }
  row.conclusions = an.conclusions
  if (Object.values(an.charts).every((c) => !c)) row.problem = 'no sign chart could be read from this curve'
  const head = as === 'f' ? `Sign chart of ${fName}` : `The graph shown is ${levelName(as, fName)}`
  row.plain = [head, ...row.chart.map(plainLine), '', ...row.conclusions.map((c) => c.text)].join('\n').trim()
  return row
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

function strip(chart: SignChart, label: string, kind: SignStripRow['kind']): SignStripRow {
  return {
    label,
    kind,
    marks: kind === 'sign'
      ? chart.marks.map((m) => ({ x: m.x, label: m.at === 'zero' ? '0' : m.at === 'und' ? 'und' : '' }))
      : [],
    intervals: chart.intervals.map((iv) => ({ from: iv.from, to: iv.to, sign: iv.sign })),
  }
}

/**
 * The strips every visible parent's sign chart puts on the board, in the
 * order the links were added. A hidden or missing parent draws nothing.
 */
export function signChartFigures(
  links: readonly SignChartLink[],
  curves: readonly FittedCurve[],
  models: Record<string, ModelSpec>,
  letters: Readonly<Record<string, string>>,
  deps: Readonly<Record<string, string>>,
  range: readonly [number, number],
): SignChartFigure[] {
  const out: SignChartFigure[] = []
  for (const link of links) {
    const parent = curves.find((c) => c.id === link.parentId)
    if (!parent || !parent.visible) continue
    const as = asOf(link)
    const L = letters[parent.id] ?? 'f'
    let an: SignAnalysis
    try {
      an = analyzeSigns(parent, models, as, range, intervalOf(link), L, deps[parent.id] ?? '')
    } catch {
      continue
    }
    if (!an.src) continue
    const available = signRowsFor(as)
    const rows = SIGN_LEVELS.filter((l) => available.includes(l) && link.rows.includes(l))
    const arrows = link.arrows === true && as !== 'f2'
    const cup = link.cup === true
    const strips: SignStripRow[] = []
    const shown: SignChart[] = []
    for (const level of SIGN_LEVELS) {
      const c = an.charts[level]
      if (!c) continue
      if (rows.includes(level)) {
        strips.push(strip(c, levelName(level, L), 'sign'))
        shown.push(c)
      }
      if (level === 'f1' && arrows) {
        strips.push(strip(c, L, 'arrow'))
        if (!rows.includes(level)) shown.push(c)
      }
      if (level === 'f2' && cup) {
        strips.push(strip(c, L, 'concavity'))
        if (!rows.includes(level)) shown.push(c)
      }
    }
    if (strips.length === 0) continue
    // The x's under the strips: every finite critical x any shown row has.
    const ticks: { x: number; text: string }[] = []
    for (const c of shown) {
      for (const m of c.marks) {
        if (!Number.isFinite(m.x)) continue
        if (ticks.some((t) => Math.abs(t.x - m.x) <= 1e-9 * Math.max(1, Math.abs(m.x)))) continue
        ticks.push({ x: m.x, text: m.text })
      }
    }
    ticks.sort((p, q) => p.x - q.x)
    out.push({ id: link.id, color: parent.color, rows: strips, ticks, guides: link.guides === true })
  }
  return out
}

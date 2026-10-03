// ============================================================================
// src/ui/boardDescription.ts — the board in words, for a screen reader.
//
// The live board is described by the same pipeline that writes the AP item
// bank's figuredesc (src/ui/itemBank.ts → src/core/describeAdapters.ts): the
// document as it would be saved, hydrated through docScene, described from
// the scene its export would draw. So what a screen reader hears is what the
// figure shows — never a second opinion.
//
//   describeBoard(model, { answers }) → { summary, long, figuredesc }
//
// `answers: false` is the student copy: reveal mode describes only what it
// shows (no zeros, extrema or computed values), the same rule the bank's stem
// figure follows.
// ============================================================================

import type { AdapterCalc, AdapterInput } from '../core/describeAdapters'
import { describeCurves, numberLineFromSolve } from '../core/describeAdapters'
import type { DescribeNumberLine, GraphDescription } from '../core/describeGraph'
import { describeScene, fmt } from '../core/describeGraph'
import type { NLItem } from '../core/types'
import { ppuX } from '../core/types'
import type { DocModel } from './docScene'
import { docFigure } from './docScene'
import { describeInputOf } from './itemBank'
import { paletteDashes } from './dashes'
import type { CurvePalette } from '../core/a11yPalette'
import { solveOf } from './nlSolve'
import { viewStatesFrom } from './curveViews'
import { tableSentences } from './valueTableLinks'
import { circleSentences } from './circleLinks'

export interface BoardDescription extends GraphDescription {
  /** One short sentence for the board's accessible name (aria-label). */
  summary: string
}

export interface DescribeBoardOptions {
  /** Include computed answers (zeros, extrema, values). False in reveal mode. */
  answers: boolean
  /** The summary's character limit (default 160). */
  maxSummary?: number
  /** The person's curve palette: under 'safe' every curve has its own dash, and the description says which. */
  palette?: CurvePalette
}

const EMPTY_GRAPH: BoardDescription = {
  summary: 'Empty graph',
  figuredesc: 'An empty coordinate plane.',
  long: 'The graph is empty. Draw a curve on the board, or press the plus button in the sidebar and type an equation.',
}

const EMPTY_LINE: BoardDescription = {
  summary: 'Empty number line',
  figuredesc: 'An empty number line.',
  long: 'The number line is empty. Press the plus button in the sidebar and type an inequality to solve it.',
}

/** Cut a sentence at a word boundary, with an ellipsis. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, Math.max(1, max - 1))
  const sp = cut.lastIndexOf(' ')
  return `${(sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[,;:.\s]+$/, '')}…`
}

/** The figuredesc as a name: it already starts "Graph of …" — say what it is only when it does not. */
function lead(what: string, figuredesc: string): string {
  return new RegExp(`^(a |an |the )?${what}`, 'i').test(figuredesc) ? figuredesc : `${what}: ${figuredesc}`
}

/** The calculus objects a description can state (shaded areas, sums, secants, tangents). */
function calcOf(m: DocModel): { calc: AdapterCalc[]; hide: Set<string> } {
  const calc: AdapterCalc[] = []
  const hide = new Set<string>()
  const visible = new Set(m.board.curves.filter((c) => c.visible).map((c) => c.id))
  for (const l of m.board.calc) {
    if (l.kind === 'area' && visible.has(l.parentId)) {
      calc.push({ kind: 'area', curve: l.parentId, ...(l.otherId ? { other: l.otherId } : {}), a: l.from, b: l.to })
    } else if (l.kind === 'riemann' && visible.has(l.parentId)) {
      calc.push({ kind: 'riemann', curve: l.parentId, a: l.from, b: l.to, n: l.n, method: l.method })
    } else if (l.kind === 'secant' && visible.has(l.parentId)) {
      calc.push({ kind: 'secant', curve: l.parentId, x: l.a, x2: l.b })
    } else if (l.kind === 'tangent' && visible.has(l.parentId) && l.y === undefined) {
      calc.push({ kind: 'tangent', curve: l.parentId, x: l.x })
      // The tangent line is said once, as a tangent — not again as "a line".
      hide.add(l.curveId)
    }
  }
  return { calc, hide }
}

function cartesian(m: DocModel, o: DescribeBoardOptions): BoardDescription {
  const fig = docFigure(m, { style: 'screen', answers: o.answers, caption: '' })
  const scene = o.palette === 'safe' ? { ...fig.scene, styles: paletteDashes(fig.scene.curves, fig.scene.styles) } : fig.scene
  const base = describeInputOf(m, scene, null)
  const { calc, hide } = calcOf(m)
  // The Table sections a teacher set up: the x's always, the values only as answers.
  const views = viewStatesFrom(m.board.curveViews, m.board.curves)
  const tables = Object.keys(views.table).length > 0
    ? tableSentences(m.board.curves, views.table, {
        curves: m.board.curves,
        models: m.models,
        letters: m.names,
        names: m.curveNames,
        sources: m.sources,
      })
    : []
  // A circle's Circle theorems: what is drawn always, what it states as answers.
  const circles = Object.keys(views.circle).length > 0
    ? circleSentences(m.board.curves, m.board.exprSources, views.circle)
    : []
  const added = [...tables, ...circles]
  const input: AdapterInput = {
    ...base,
    // The board's cards show every equation, so the description states them.
    curves: base.curves.filter((c) => !hide.has(c.curve.id)).map((c) => ({ ...c, shows: { equation: true } })),
    ...(calc.length > 0 ? { calc } : {}),
    ...(added.length > 0
      ? { extras: [...(base.extras ?? []), ...added.map((t) => ({ text: t.text, ...(t.answer ? { answer: true } : {}) }))] }
      : {}),
  }
  const others =
    m.board.fields.length + m.board.shapes.length + m.board.data.length + m.board.sequences.length +
    m.board.unitCircles.length + m.board.relatedRates.length + m.board.stats.length
  if (input.curves.length === 0 && others === 0) return EMPTY_GRAPH
  const d = describeCurves(input, { answers: o.answers, maxLength: 300 })
  return { ...d, summary: clip(lead('Graph', d.figuredesc), o.maxSummary ?? 160) }
}

/** The number line's dots and shading, as it draws them. */
function numberLineInput(m: DocModel): DescribeNumberLine | null {
  const half = m.vp.widthPx / 2 / ppuX(m.vp)
  const min = m.vp.center.x - half
  const max = m.vp.center.x + half
  const items: readonly NLItem[] = m.board.items
  const solve = items.find((i) => i.kind === 'solve')
  if (solve && solve.kind === 'solve') {
    const r = solveOf(solve)
    if (r) return numberLineFromSolve(r, min, max)
  }
  const points: DescribeNumberLine['points'] = []
  const intervals: DescribeNumberLine['intervals'] = []
  for (const it of items) {
    if (it.kind === 'point') points.push({ x: it.x, closed: it.closed })
    else if (it.kind === 'interval') {
      intervals.push({ lo: it.lo, hi: it.hi })
      if (it.lo !== null) points.push({ x: it.lo, closed: it.loClosed })
      if (it.hi !== null) points.push({ x: it.hi, closed: it.hiClosed })
    }
  }
  if (points.length === 0 && intervals.length === 0) return null
  return { min, max, points: points.sort((a, b) => a.x - b.x), intervals }
}

function numberLine(m: DocModel, o: DescribeBoardOptions): BoardDescription {
  const nl = numberLineInput(m)
  if (!nl) return EMPTY_LINE
  const d = describeScene(
    { board: 'number-line', window: { xMin: nl.min, xMax: nl.max, yMin: -1, yMax: 1 }, curves: [], numberLine: nl },
    { answers: o.answers, maxLength: 300 },
  )
  return { ...d, summary: clip(lead('Number line', d.figuredesc), o.maxSummary ?? 160) }
}

/** The board in words. Never throws: a failure describes the board as unreadable. */
export function describeBoard(m: DocModel, o: DescribeBoardOptions): BoardDescription {
  try {
    return m.kind === 'number-line' ? numberLine(m, o) : cartesian(m, o)
  } catch {
    const what = m.kind === 'number-line' ? 'Number line' : 'Graph'
    return { summary: what, figuredesc: `${what}.`, long: `${what}. A description of it could not be made.` }
  }
}

/** A window as words, for a short status: "x from −10 to 10". */
export function windowWords(m: DocModel): string {
  const half = m.vp.widthPx / 2 / ppuX(m.vp)
  return `x from ${fmt(m.vp.center.x - half)} to ${fmt(m.vp.center.x + half)}`
}

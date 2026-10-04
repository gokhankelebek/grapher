// ============================================================================
// src/ui/docAnswers.ts — a stored document's answers, as the key prints them.
//
// The worksheet answer key writes, under each figure, every answer reveal
// mode would hide on that document, in the order Next reveals them, in the
// very words Present's "Revealed" panel uses. Nothing here words an answer:
//
//   order   the reveal inventory (src/ui/reveal.ts buildInventory), fed what
//           src/app/useRevealMode.ts feeds it, rebuilt from the stored
//           document instead of from the live board's hooks;
//   words   src/ui/revealedAnswers.ts answerLine, through the shared readers
//           of src/ui/answerSources.ts — the cards' own calculus rows
//           (cardCalc), the Table and Circle sections, the figures' titles.
//
// Where the live board computes a section only for the SELECTED card (the
// Table and Circle panels), the key computes it for every curve that has one:
// a printed key has no "selected card".
//
// Also here: the data tables a figure relies on (a scatter plot, calculus on
// a table), as plain cells for the sheet to print beside its figure.
// ============================================================================

import type { FittedCurve, ModelSpec, SpecialPoint } from '../core/types'
import { ppuX } from '../core/types'
import type { BoardData } from '../core/persist'
import { analyzeCurve } from '../core/analyze'
import { curveDomain, curveRange, naturalDomain, oneToOneInfo } from '../core/domainRange'
import { invertFormula } from '../core/inverse'
import { parseExpression } from '../core/parse'
import type { Overlay } from '../render/overlays'
import { curveNames } from '../render/curveNames'
import type { DocModel } from './docScene'
import type { AnswerLine } from './revealedAnswers'
import { revealedLines } from './revealedAnswers'
import { answerSourcesOf, calcLinesOf, signAsOf } from './answerSources'
import type { DomainRows } from './answerSources'
import type { RevealInventory } from './reveal'
import {
  buildInventory,
  eulerKey,
  rrKey,
  seriesKey,
  shapeKey,
  solveKey,
  statKey,
  SYSTEM_KEY,
  ucKey,
} from './reveal'
import { asymptoteTexts } from './CurveCard'
import { cardCalc } from './calcLinks'
import { boardMeetings, intersectionSpan, taylorApart } from './intersections'
import { viewStatesFrom } from './curveViews'
import { familyKeyOf } from './familyFacts'
import { complexKeysOf } from './complexLinks'
import { tableKeysOf, tablePanel } from './valueTableLinks'
import { circleKeysOf, circlePanel } from './circleLinks'
import { makeFitCache, residualPlotReg } from './dataLinks'
import { residFigId, residualFigures } from './residualLinks'
import { tableCalcKeys } from './tableCalcLinks'
import { systemCard } from './systemLinks'
import { compileShapes, sceneShapes } from './shapeLinks'
import { measureAnswerParts } from './shapeMeasure'
import { compileSequences, sequenceCard } from './seqLinks'
import { compileFields, fieldCard } from './fieldLinks'
import { unitCircleFigure } from './unitCircleLinks'
import { relatedRatesFigure } from './relatedRatesLinks'
import { statsFigures } from './statsLinks'
import { signRange } from './signChartLinks'
import { implicitSearchBox, isImplicitCurve } from './implicitLinks'
import { drawnExtent, inverseRestriction, oneToOneText, setRowText, splitTyped } from './domainLinks'
import { curveEquationText } from './equationText'
import { dependencyKeys } from './nameLinks'
import { curveSpecSerial } from './valueKeys'

const residualFit = makeFitCache()

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn() ?? fallback
  } catch {
    return fallback
  }
}

const analyze = (c: FittedCurve, models: Record<string, ModelSpec>): SpecialPoint[] =>
  safe(() => {
    const pts = analyzeCurve(c, models)
    return Array.isArray(pts) ? pts : []
  }, [] as SpecialPoint[])

export interface DocAnswerOptions {
  /**
   * The figure's overlays as the KEY draws them: a chip's text is what a line
   * says when its own reader has nothing (revealedAnswers chips()).
   */
  overlays?: readonly Overlay[]
}

/** The x-window the teacher framed (crossings and sign charts are found across it, as the figure's are). */
function windowOf(m: DocModel): [number, number] {
  const half = m.vp.widthPx / 2 / ppuX(m.vp)
  return [m.vp.center.x - half, m.vp.center.x + half]
}

/**
 * Every answer on a stored document, in reveal order, as the lines Present's
 * "Revealed" panel shows once everything is revealed. Never throws.
 */
export function docAnswerLines(m: DocModel, o: DocAnswerOptions = {}): AnswerLine[] {
  try {
    return answersOf(m, o)
  } catch {
    return []
  }
}

function answersOf(m: DocModel, o: DocAnswerOptions): AnswerLine[] {
  const board = m.board
  const curves = board.curves
  const models = m.models
  const overlays = o.overlays ?? []

  if (m.kind === 'number-line') {
    const inv = buildInventory({
      curves: [],
      crossings: [],
      after: board.items.filter((it) => it.kind === 'solve').map((it) => solveKey(it.id)),
    })
    return linesFor(m, inv, overlays, null)
  }
  if (m.kind !== 'cartesian') return []

  const selectedId = board.selectedId
  const window = windowOf(m)
  const span = intersectionSpan(window)
  const shown = curves.filter((c) => c.visible)
  const curveIds = new Set(curves.map((c) => c.id))
  const views = viewStatesFrom(board.curveViews, curves)

  // depKeys, as useModels builds them: a line that calls another curve (or a
  // link drives) has no family facts of its own.
  const depKeys = safe(() => dependencyKeys(curves, m.names, board.calls, (c) => curveSpecSerial(c, models)), {} as Record<string, string>)
  for (const l of board.calc) {
    if (l.kind !== 'taylor' && l.kind !== 'accumulation' && l.kind !== 'tangent') continue
    const sig = l.kind === 'taylor' ? `T${l.a},${l.n}` : l.kind === 'accumulation' ? `A${l.a},${l.C}` : `L${l.x}`
    depKeys[l.curveId] = depKeys[l.curveId] ? `${depKeys[l.curveId]};${sig}` : sig
  }

  const meetings = safe(
    () => boardMeetings(curves, models, span, taylorApart(board.calc)),
    { points: [], coincide: [] } as ReturnType<typeof boardMeetings>,
  )
  const sysCard = safe(() => systemCard(curves, models, board.system), null)
  const shapesCompiled = safe(() => compileShapes(board.shapes), new Map() as ReturnType<typeof compileShapes>)

  // ---- the teaching order (useRevealMode's inventory)
  const after: string[] = []
  for (const q of board.sequences) if (q.series && q.visible) after.push(seriesKey(q.id))
  for (const f of board.fields) if (f.eulers && f.eulers.length > 0) after.push(eulerKey(f.id))
  for (const u of board.unitCircles) if (u.hidden !== true) after.push(ucKey(u.id))
  for (const r of board.relatedRates) if (r.hidden !== true) after.push(rrKey(r.id))
  for (const st of board.stats) if (st.hidden !== true) after.push(statKey(st.id))
  for (const d of board.data) if (d.visible && residualPlotReg(d, curveIds)) after.push(statKey(residFigId(d.id)))
  for (const d of board.data) if (d.visible && d.calc) after.push(...safe(() => tableCalcKeys(d), [] as string[]))
  if (sysCard?.lp) after.push(SYSTEM_KEY)
  for (const ov of overlays) {
    if (ov.kind === 'label' && ov.answer && ov.answer.startsWith('solve:') && !after.includes(ov.answer)) after.push(ov.answer)
  }
  for (const s of board.shapes) {
    if (!s.visible) continue
    const c = shapesCompiled.get(s.id)
    if (!c?.shape) continue
    if (s.xform) after.push(shapeKey(s.id, 'image'))
    if (s.measure) for (const part of safe(() => measureAnswerParts(c.shape!.kind, s.measure, c.reports), [])) after.push(shapeKey(s.id, part))
    if (s.sym && c.sym) after.push(shapeKey(s.id, 'symmetry'))
  }

  const domainOn = domainRowsFor(m, selectedId)
  const inv = buildInventory({
    curves: shown.map((c) => {
      const family = (): string[] => {
        const k = safe(() => familyKeyOf(c, board.exprSources[c.id], models, depKeys[c.id]), null)
        return k ? [k] : []
      }
      return {
        id: c.id,
        points: analyze(c, models),
        // Every curve's asymptotes (the live board lists only the selected card's):
        // a printed key has no selected card, and states what each figure dashes in.
        asymptotes: safe(() => asymptoteTexts(c, models).length, 0),
        domain: c.id === selectedId && domainOn !== null,
        inverse: c.id === selectedId && domainOn !== null,
        calc: board.calc.filter((l) => l.parentId === c.id).map((l) => l.id),
        extra:
          c.kind === 'explicit'
            ? [...family(), ...safe(() => complexKeysOf(c, models), []), ...tableKeysOf(c.id, views.table[c.id], curveIds)]
            : [...family(), ...safe(() => circleKeysOf(c, board.exprSources[c.id], views.circle[c.id]), [])],
      }
    }),
    crossings: meetings.points,
    coincide: meetings.coincide.map((c) => [c.a, c.b] as const),
    after,
  })
  return linesFor(m, inv, overlays, domainOn)
}

/**
 * The Domain rows the selected card states (useDomainPanel, for a curve that
 * is not itself an inverse): null when the card has none.
 */
function domainRowsFor(m: DocModel, selectedId: string | null): DomainRows | null {
  if (!selectedId) return null
  const c = m.board.curves.find((k) => k.id === selectedId)
  if (!c || c.kind !== 'explicit' || !c.visible) return null
  if (m.board.inverses.some((l) => l.curveId === selectedId)) return null
  const models = m.models
  // As useDomainLens: a sketch still on the piece it was drawn over is the
  // function drawn on a piece; a restricted typed line's natural domain is
  // its body's.
  const curve = drawnExtent(c) ? { ...c, domain: null } : c
  const src = m.board.exprSources[c.id]
  const split = c.modelId.startsWith('expr_') && src ? splitTyped(src) : null
  const callsOthers = (m.board.calls[c.id]?.length ?? 0) > 0
  const base =
    split && split !== 'piecewise' && split.cond !== null && !callsOthers
      ? safe(() => {
          const o = parseExpression(split.base)
          return o.ok && o.plot.kind === 'explicit' ? o.plot.makeModel(`base_${c.id}`) : null
        }, null)
      : null
  const natural = safe(
    () => (base ? naturalDomain({ ...curve, modelId: base.id, domain: null }, { ...models, [base.id]: base }) : naturalDomain(curve, models)),
    null,
  )
  const domain = safe(() => curveDomain(curve, models), null)
  const range = safe(() => curveRange(curve, models), null)
  const one = safe(() => oneToOneInfo(curve, models), null)
  const name = m.curveNames[c.id] ?? m.names[c.id] ?? 'f'
  // f⁻¹ as the card writes it: the formula on the stretch the teacher chose,
  // or why there is none.
  const inverseSrc = c.modelId.startsWith('expr_')
    ? split && split !== 'piecewise' ? split.base : null
    : safe(() => curveEquationText(c, models[c.modelId]), null)
  const formula = inverseSrc && !callsOthers
    ? safe(() => invertFormula(inverseSrc, inverseRestriction(domain, natural), name), null)
    : null
  const inverse = formula
    ? `${name}⁻¹(x) = ${formula.text}`
    : one && !one.oneToOne
      ? `${name} isn’t one-to-one — restrict its domain first`
      : 'No formula for this inverse — it is still drawn by reflection'
  return {
    domain: setRowText(domain, 'interval'),
    range: setRowText(range, 'interval'),
    oneToOne: oneToOneText(one),
    inverse,
  }
}

function linesFor(m: DocModel, inv: RevealInventory, overlays: readonly Overlay[], domain: DomainRows | null): AnswerLine[] {
  const board = m.board
  const curves = board.curves
  const models = m.models
  const cartesian = m.kind === 'cartesian'
  const window = windowOf(m)
  const views = viewStatesFrom(board.curveViews, curves)
  const sources = { ...board.displaySources, ...board.exprSources }

  const calcCards = cartesian && board.calc.length > 0 ? safe(() => cardsOf(m, window), {}) : {}
  const seqCompiled = compileSequences(board.sequences)
  const seqCards = new Map(board.sequences.flatMap((q) => {
    const c = seqCompiled.get(q.id)
    return c ? [[q.id, safe(() => sequenceCard(q, c), null)] as const] : []
  }))
  const fieldCompiled = compileFields(board.fields)
  const tableCtx = { curves, models, letters: m.names, names: m.curveNames, sources }
  const curveIds = new Set(curves.map((c) => c.id))
  const shapesCompiled = safe(() => compileShapes(board.shapes), new Map() as ReturnType<typeof compileShapes>)

  const signAs = signAsOf(board.calc)
  const src = answerSourcesOf({
    curves,
    models,
    boardNames: m.curveNames,
    names: m.names,
    exprSources: board.exprSources,
    pointOf: (key) => inv.pointOf(key),
    domainRows: (id) => (domain && id === board.selectedId ? domain : null),
    calcLines: calcLinesOf(calcCards),
    tablePanelFor: (id) => {
      const c = curves.find((k) => k.id === id)
      return c && c.kind === 'explicit' ? safe(() => tablePanel(c, views.table[id], tableCtx), null) : null
    },
    circlePanelFor: (id) => {
      const c = curves.find((k) => k.id === id)
      return c ? safe(() => circlePanel(c, board.exprSources[id], views.circle[id]), null) : null
    },
    overlays,
    ucFigures: cartesian ? board.unitCircles.flatMap((u) => safe(() => [unitCircleFigure(u)], [])) : [],
    rrFigures: cartesian ? board.relatedRates.flatMap((r) => safe(() => [relatedRatesFigure(r)], [])) : [],
    statsFigs: cartesian
      ? [...safe(() => statsFigures(board.stats), []), ...safe(() => residualFigures(board.data, curveIds, residualFit), [])]
      : [],
    seqCardFor: (id) => seqCards.get(id) ?? undefined,
    fieldCardFor: (id) => {
      const f = board.fields.find((x) => x.id === id)
      return f ? safe(() => fieldCard(f, fieldCompiled), undefined) : undefined
    },
    sysCard: cartesian ? safe(() => systemCard(curves, models, board.system), null) : null,
    screenShapes: cartesian ? safe(() => sceneShapes(board.shapes, shapesCompiled), []) : [],
    shapes: board.shapes,
    dataSets: board.data,
    items: board.items,
    signAs: (id) => signAs.get(id) ?? null,
  })
  return revealedLines({ revealed: inv.order.slice() }, inv.order, src)
}

/** The cards' calculus rows, as useBoardOverlays computes them for the live board. */
function cardsOf(m: DocModel, window: [number, number]): ReturnType<typeof cardCalc> {
  const board = m.board
  const curves = board.curves
  const models = m.models
  const calcLinks = board.calc
  const typed = { ...board.displaySources, ...board.exprSources }
  const calls = board.calls
  const callsOthers = (id: string): boolean => (calls[id]?.length ?? 0) > 0
  const curveLabel = (curve: FittedCurve): string => {
    const spec = models[curve.modelId]
    if (spec && !curve.modelId.startsWith('expr_') && spec.name) return spec.name
    const t = typed[curve.id]?.trim()
    if (t) return t.length > 24 ? `${t.slice(0, 23)}…` : t
    return spec?.name ?? curve.modelId
  }
  // The line invertFormula (and a volume's integral) reads: the typed line
  // without its restriction, or a sketch's equation.
  const sourceOf = (c: FittedCurve): string | null => {
    const s = board.exprSources[c.id]
    if (c.modelId.startsWith('expr_') && s) {
      const split = splitTyped(s)
      return split && split !== 'piecewise' ? split.base : null
    }
    return safe(() => curveEquationText(c, models[c.modelId]), null)
  }
  const letters = curveNames(curves, typed, calcLinks, m.names, board.inverses)
  const sources: Record<string, string> = {}
  for (const l of calcLinks) {
    if (l.kind === 'volume') {
      for (const id of [l.parentId, l.otherId]) {
        if (!id || sources[id] !== undefined) continue
        const c = curves.find((cc) => cc.id === id)
        if (!c || !c.modelId.startsWith('expr_') || callsOthers(id)) continue
        const s = sourceOf(c)
        if (s) sources[id] = s
      }
    }
    if (l.kind === 'tangent' && sources[l.parentId] === undefined) {
      const c = curves.find((cc) => cc.id === l.parentId)
      if (c && isImplicitCurve(c, models) && !callsOthers(c.id)) {
        const s = sourceOf(c)
        if (s) sources[c.id] = s
      }
    }
  }
  for (const l of calcLinks) {
    if (l.kind !== 'pcalc' && l.kind !== 'polarbetween') continue
    for (const id of l.kind === 'polarbetween' ? [l.parentId, l.otherId] : [l.parentId]) {
      if (!id || sources[id] !== undefined || callsOthers(id)) continue
      const c = curves.find((cc) => cc.id === id)
      if (!c) continue
      let s: string | null = board.exprSources[c.id] ?? null
      if (!s && !c.modelId.startsWith('expr_')) s = safe(() => curveEquationText(c, models[c.modelId]), null)
      if (s) sources[id] = s
    }
  }
  const cardLetters = curveNames(
    curves.map((c) => (c.visible ? c : { ...c, visible: true })),
    typed,
    calcLinks,
    m.names,
    board.inverses,
  )
  const halfW = (window[1] - window[0]) / 2
  const box = implicitSearchBox(m.vp.center, halfW, m.vp.heightPx / 2 / (m.vp.pxPerUnitY ?? m.vp.pxPerUnit))
  const span = intersectionSpan(window)
  return cardCalc(calcLinks, curves, models, curveLabel, letters, calls, sources, box, {}, cardLetters, signRange(span))
}

// ---------------------------------------------------------------------------
// The data tables a figure relies on
// ---------------------------------------------------------------------------

/** One data table as the sheet prints it: its headers as typed (units and all) and its cells. */
export interface PrintTable {
  id: string
  name: string
  headers: [string, string]
  rows: [string, string][]
}

/** The visible data tables of a document, with at least one filled row. */
export function docDataTables(m: DocModel | null): PrintTable[] {
  if (!m || m.kind !== 'cartesian') return []
  const out: PrintTable[] = []
  for (const d of m.board.data) {
    if (!d.visible) continue
    const rows = printRows(d)
    if (rows.length === 0) continue
    out.push({ id: d.id, name: d.name, headers: [d.xLabel.trim() || 'x', d.yLabel.trim() || 'y'], rows })
  }
  return out
}

/** The rows as typed, minus the empty ones (a table's blank last line). */
function printRows(d: BoardData): [string, string][] {
  return d.rows
    .map((r) => [r.x.trim(), r.y.trim()] as [string, string])
    .filter(([x, y]) => x !== '' || y !== '')
}

/** Whether a figure relies on a data table, so the sheet prints it unless told not to. */
export function relyOnTable(m: DocModel | null): boolean {
  return docDataTables(m).length > 0
}


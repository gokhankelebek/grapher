// ============================================================================
// src/app/usePresentAnswers.ts — reveal mode in presentation: the answers the
// class has seen, as lines for the board's "Revealed answers" panel.
//
// Presentation hides the sidebar, where most revealed values live (a sum, a
// domain, a classification). This hook reads each revealed key's value from
// what the cards themselves are built from (src/ui/revealedAnswers.ts maps a
// key to its line) — only while presentation AND reveal mode are both on, so
// an ordinary board pays nothing for it.
//
// Called once per render by App (src/App.tsx), after every hook it reads.
// ============================================================================

import { useMemo } from 'react'
import { oneToOneText, setRowText } from '../ui/domainLinks'
import { revealedLines } from '../ui/revealedAnswers'
import type { AnswerLine } from '../ui/revealedAnswers'
import { viewSpans } from '../ui/renderBoard'
import { answerSourcesOf, calcLinesOf, circlePartText, shapePartText, signAsOf, tablePartText } from '../ui/answerSources'
import type { CalcLine } from '../ui/answerSources'
import type { RevealInventory } from '../ui/reveal'
import type { BoardStateApi } from './useBoardState'
import type { DocumentStateApi } from './useDocumentState'
import type { SessionStateApi } from './useSessionState'
import type { ModelsApi } from './useModels'
import type { BoardOverlaysApi } from './useBoardOverlays'
import type { DomainPanelApi } from './useDomainPanel'
import type { ValueTablesApi } from './useValueTables'
import type { CircleViewsApi } from './useCircleViews'
import type { DataTablesApi } from './useDataTables'
import type { FieldsApi } from './useFields'
import type { InequalitySystemApi } from './useInequalitySystem'
import type { UnitCircleApi } from './useUnitCircle'
import type { RelatedRatesApi } from './useRelatedRates'
import type { StatsApi } from './useStats'
import type { SelectionMarksApi } from './useSelectionMarks'
import type { CurveNamesApi } from './useCurveNames'

export interface PresentAnswersDeps {
  board: BoardStateApi
  docState: DocumentStateApi
  session: SessionStateApi
  derived: ModelsApi
  overlaysApi: BoardOverlaysApi
  panel: DomainPanelApi
  valueTablesApi: ValueTablesApi
  circleViewsApi: CircleViewsApi
  tables: DataTablesApi
  fieldsApi: FieldsApi
  system: InequalitySystemApi
  unitCircle: UnitCircleApi
  rates: RelatedRatesApi
  statsApi: StatsApi
  marks: SelectionMarksApi
  naming: CurveNamesApi
  revealInv: RevealInventory | null
}

// The readers themselves are pure and shared with the worksheet answer key
// (src/ui/answerSources.ts), so the projector and the printed key say the same.
export { calcLinesOf, circlePartText, shapePartText, tablePartText }

export function usePresentAnswers(deps: PresentAnswersDeps): AnswerLine[] {
  const { board, docState, session, derived, overlaysApi, panel, valueTablesApi, circleViewsApi } = deps
  const { tables, fieldsApi, system, unitCircle, rates, statsApi, marks, naming, revealInv } = deps
  const { curves, items, shapes, dataSets, calcLinks } = board
  const { exprSources, names } = docState
  const { reveal, presentMode, setNotation } = session
  const { models } = derived
  const { calcCards, overlays } = overlaysApi
  const { domainPanel } = panel
  const { tablePanelFor } = valueTablesApi
  const { circlePanelFor } = circleViewsApi
  const { seqCardFor } = tables
  const { fieldCardFor } = fieldsApi
  const { sysCard } = system
  const { ucFigures } = unitCircle
  const { rrFigures } = rates
  const { statsFigs } = statsApi
  const { screenShapes } = marks
  const { boardCurveNames } = naming

  const on = presentMode && reveal.on && revealInv !== null
  const calcLines = useMemo(() => (on ? calcLinesOf(calcCards) : new Map<string, CalcLine>()), [on, calcCards])

  return useMemo<AnswerLine[]>(() => {
    if (!on || !revealInv) return []
    const signAs = signAsOf(calcLinks)
    const sources = answerSourcesOf({
      curves,
      models,
      boardNames: boardCurveNames,
      names,
      exprSources,
      pointOf: (key) => revealInv.pointOf(key),
      view: viewSpans(derived.vpRef.current),
      domainRows(id) {
        const p = domainPanel
        if (!p || p.ownerId !== id) return null
        return {
          domain: setRowText(p.domain, setNotation),
          range: setRowText(p.range, setNotation),
          oneToOne: oneToOneText(p.oneToOne, p.variable),
          inverse: p.inverse?.text ? `${p.name}⁻¹(x) = ${p.inverse.text}` : (p.inverse?.why ?? null),
        }
      },
      calcLines,
      tablePanelFor,
      circlePanelFor,
      overlays,
      ucFigures,
      rrFigures,
      statsFigs,
      seqCardFor,
      fieldCardFor,
      sysCard,
      screenShapes,
      shapes,
      dataSets,
      items,
      signAs: (id) => signAs.get(id) ?? null,
    })
    return revealedLines(reveal, revealInv.order, sources)
  }, [
    on, revealInv, reveal, curves, items, shapes, boardCurveNames, names, models, domainPanel, setNotation,
    exprSources, calcLines, tablePanelFor, circlePanelFor, overlays, ucFigures, rrFigures, statsFigs,
    seqCardFor, fieldCardFor, sysCard, screenShapes, dataSets, calcLinks,
  ])
}

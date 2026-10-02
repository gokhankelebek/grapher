// ============================================================================
// src/app/useCommands.ts — the command palette and the help sheet: facts, actions, ⌘K.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { NL_SOLVE_DEFAULTS } from '../core/types'
import { availability, COMMAND_BY_ID, isMacPlatform, pushRecent } from '../ui/commands'
import type {
  Command,
  CommandActions,
  CommandContext,
  CurveFacts,
  SequenceFacts,
  SolveFacts,
  TargetFacts,
} from '../ui/commands'
import { curveLegend } from '../ui/present'
import { MAX_RECENT_COMMANDS, updatePrefs } from '../ui/storage'
import type { BoardStateApi } from './useBoardState'
import type { DocumentStateApi } from './useDocumentState'
import type { SessionStateApi } from './useSessionState'
import type { BoardRefsApi } from './useBoardRefs'
import type { ModelsApi } from './useModels'
import type { NoticesApi } from './useNotices'
import type { HistoryApi } from './useHistory'
import type { DocumentActionsApi } from './useDocumentActions'
import type { CurveEditingApi } from './useCurveEditing'
import type { CalcLinksApi } from './useCalcLinks'
import type { FieldsApi } from './useFields'
import type { TypedLinesApi } from './useTypedLines'
import type { DataTablesApi } from './useDataTables'
import type { DomainLensApi } from './useDomainLens'
import type { NumberLineApi } from './useNumberLine'
import type { ViewportApi } from './useViewport'
import type { UnitCircleApi } from './useUnitCircle'
import type { RelatedRatesApi } from './useRelatedRates'
import type { BoardOverlaysApi } from './useBoardOverlays'
import type { CurveNamesApi } from './useCurveNames'
import type { RevealModeApi } from './useRevealMode'
import type { ExportApi } from './useExport'
import type { FigureSettingsApi } from './useFigureSettings'
import type { SidebarEditorsApi } from './useSidebarEditors'
import type { ExamplesApi } from './useExamples'

/** What useCommands reads from the hooks App calls before it. */
export interface CommandsDeps {
  board: BoardStateApi
  docState: DocumentStateApi
  session: SessionStateApi
  refs: BoardRefsApi
  derived: ModelsApi
  notices: NoticesApi
  history: HistoryApi
  docActions: DocumentActionsApi
  editing: CurveEditingApi
  calc: CalcLinksApi
  fieldsApi: FieldsApi
  typed: TypedLinesApi
  tables: DataTablesApi
  domain: DomainLensApi
  numberLine: NumberLineApi
  viewport: ViewportApi
  unitCircle: UnitCircleApi
  rates: RelatedRatesApi
  overlaysApi: BoardOverlaysApi
  naming: CurveNamesApi
  revealMode: RevealModeApi
  exporter: ExportApi
  figureSettings: FigureSettingsApi
  editors: SidebarEditorsApi
  examples: ExamplesApi
}

export function useCommands({ board, docState, session, refs, derived, notices, history, docActions, editing, calc, fieldsApi, typed, tables, domain, numberLine, viewport, unitCircle, rates, overlaysApi, naming, revealMode, exporter, figureSettings, editors, examples }: CommandsDeps) {
  const {
    curves, kind, items, selectedId, setSelectedId, sidebarOpen, setSidebarOpen, lens, fields,
    shapes, dataSets, sequences, boardGrid, figureStyle, previewFigure, setPreviewFigure,
  } = board
  const { shared, exprSources, brokenExpr, displaySources, inverses } = docState
  const {
    showAnalysis, reveal, canvasTheme, exportFormat, axisUnitChoice, presentMode, setPresentMode,
    palette, setPalette, helpOpen, setHelpOpen, recentCommands, setRecentCommands,
  } = session
  const { undoRef, redoRef } = refs
  const { models } = derived
  const { showToast } = notices
  const { undo, redo } = history
  const {
    openWorksheet, newDocument, setBoardKind, makeSharedCopy, duplicateDocument, openShareDialog,
    toggleAnalysis, exportDocument,
  } = docActions
  const { toggleVisible, duplicateCurve } = editing
  const { curveLabel, addCalcObject, addAreaBetween } = calc
  const { addEuler } = fieldsApi
  const { toggleSeqSums, toggleSeqSeries } = typed
  const { addDataTable } = tables
  const { showInverseOf, toggleHlt } = domain
  const { setSolveShow } = numberLine
  const { zoomBy, resetView, fitToContent, graphSolve } = viewport
  const { addUnitCircle } = unitCircle
  const { addRelatedRates } = rates
  const { calcCards, betweenCards } = overlaysApi
  const { cardNames } = naming
  const { revealStep, toggleReveal } = revealMode
  const { exportPNG, copyPNG, exportVector, exportCurrent, copyLatex } = exporter
  const {
    setAxisUnit, setRuling, chooseFigureStyle, cycleAxisUnitX, toggleCanvasTheme,
  } = figureSettings
  const {
    showBuilder, revealSidebar, typeLine, deleteSelection, showDomain, pickImportFile,
  } = editors

  // ------------------------------------------------------ the command palette
  const mac = useMemo(() => isMacPlatform(), [])
  const recentRef = useRef(recentCommands)
  recentRef.current = recentCommands
  const commandsLive = palette !== null || helpOpen

  /** Each curve as the palette sees it: its name, its equation, and what its ⋯ menu offers. */
  const commandCurves = useMemo<CurveFacts[]>(() => {
    if (!commandsLive || kind !== 'cartesian') return []
    const shown = curveLegend(
      curves.map((c) => (c.visible ? c : { ...c, visible: true })),
      models,
      displaySources,
    )
    const texOf = new Map(shown.map((e) => [e.id, e]))
    return curves.map((c) => {
      const calc = calcCards[c.id]
      const spec = models[c.modelId]
      const broken = Boolean(brokenExpr[c.id])
      const typed = exprSources[c.id] ?? displaySources[c.id]
      const e = texOf.get(c.id)
      return {
        id: c.id,
        name: cardNames[c.id] ?? curveLabel(c),
        tex: e?.tex,
        text: typed ?? e?.text ?? spec?.name ?? c.modelId,
        color: c.color,
        kind: c.kind,
        calc: calc
          ? {
              canAdd: calc.canAdd,
              implicitOnly: calc.implicitOnly,
              motion: calc.motion,
              polarPartner: calc.polarPartner,
              taylorBlocked: calc.taylorBlocked,
            }
          : null,
        between: betweenCards[c.id]?.canAdd === true,
        // the ⋯ menu's "Show inverse": an explicit curve that is not broken
        inverse: c.kind === 'explicit' && !broken,
        // the Domain / range rows: a function's own card (not an inequality's, not f⁻¹'s)
        domain:
          c.kind === 'explicit' &&
          !broken &&
          typeof spec?.inequality !== 'function' &&
          !inverses.some((l) => l.curveId === c.id),
        hlt: typeof lens[c.id]?.hlt === 'number',
      }
    })
  }, [
    commandsLive,
    kind,
    curves,
    models,
    displaySources,
    exprSources,
    calcCards,
    betweenCards,
    brokenExpr,
    cardNames,
    curveLabel,
    inverses,
    lens,
  ])

  const commandActions: CommandActions = {
    select: (id) => setSelectedId(id),
    typeLine,
    openBuilder: (which) => {
      revealSidebar()
      showBuilder(which, 'open')
    },
    addDataTable: () => {
      revealSidebar()
      showBuilder(null, 'open')
      addDataTable()
    },
    addUnitCircle,
    addRelatedRates,
    addCalc: addCalcObject,
    addAreaBetween,
    showInverse: showInverseOf,
    setHlt: toggleHlt,
    showDomain,
    duplicateCurve,
    toggleVisible,
    deleteSelected: deleteSelection,
    addEuler,
    toggleSeqSeries,
    toggleSeqSums,
    solveShow: setSolveShow,
    solveGraph: (id) => {
      const err = graphSolve(id)
      if (err) showToast(err)
    },
    undo,
    redo,
    newDocument,
    setBoardKind,
    duplicateDocument,
    openWorksheet,
    openExamples: examples.openGallery,
    share: openShareDialog,
    backup: exportDocument,
    importFile: pickImportFile,
    makeCopy: () => makeSharedCopy('asked'),
    download: exportCurrent,
    downloadAs: (f) => (f === 'png' ? exportPNG() : exportVector(f)),
    copyPng: copyPNG,
    copyLatex,
    setFigure: chooseFigureStyle,
    setPreview: setPreviewFigure,
    setAxisUnitX: (choice) => setAxisUnit('x', choice),
    cycleAxisX: cycleAxisUnitX,
    setRuling,
    toggleAnalysis,
    toggleTheme: toggleCanvasTheme,
    setPresent: setPresentMode,
    toggleReveal,
    revealStep,
    toggleSidebar: () => setSidebarOpen((o) => !o),
    zoomFit: fitToContent,
    zoomIn: () => zoomBy(1.25),
    zoomOut: () => zoomBy(1 / 1.25),
    resetView,
    help: () => setHelpOpen(true),
  }

  const commandCtx: CommandContext | null = !commandsLive
    ? null
    : {
        board: kind,
        readOnly: shared?.viewOnly === true,
        shared: shared !== null,
        selectedId,
        curves: commandCurves,
        fields:
          kind === 'cartesian'
            ? fields.map<TargetFacts>((f, i) => ({
                id: f.id,
                name: fields.length > 1 ? `Slope field ${i + 1}` : 'Slope field',
                text: f.src,
                color: f.color,
              }))
            : [],
        sequences:
          kind === 'cartesian'
            ? sequences.map<SequenceFacts>((q, i) => ({
                id: q.id,
                name: q.name ?? (sequences.length > 1 ? `Sequence ${i + 1}` : 'Sequence'),
                text: q.src,
                color: q.color,
                series: q.series !== undefined,
                sums: q.showSums,
              }))
            : [],
        solves:
          kind === 'number-line'
            ? items.flatMap<SolveFacts>((it, i) =>
                it.kind === 'solve'
                  ? [
                      {
                        id: it.id,
                        name: it.label || `Inequality ${i + 1}`,
                        text: it.src,
                        color: it.color,
                        signs: it.show.signs ?? NL_SOLVE_DEFAULTS.signs,
                        tests: it.show.tests ?? NL_SOLVE_DEFAULTS.tests,
                      },
                    ]
                  : [],
              )
            : [],
        canUndo: undoRef.current.length > 0,
        canRedo: redoRef.current.length > 0,
        hasContent:
          kind === 'number-line'
            ? items.length > 0
            : curves.length > 0 || fields.length > 0 || shapes.length > 0 || dataSets.length > 0 || sequences.length > 0,
        showAnalysis,
        canvasTheme,
        presentMode,
        revealOn: reveal.on,
        sidebarOpen,
        figure: kind === 'cartesian' ? figureStyle : null,
        previewFigure,
        exportFormat,
        axisX: kind === 'cartesian' ? axisUnitChoice.x : null,
        grid: kind === 'cartesian' ? boardGrid : null,
        actions: commandActions,
      }

  /** Remember a run command at the front of the recent list (Prefs.recentCommands). */
  const noteRecent = useCallback((id: string): void => {
    const next = pushRecent(recentRef.current, id, MAX_RECENT_COMMANDS)
    recentRef.current = next
    setRecentCommands(next)
    updatePrefs({ recentCommands: next })
  }, [])

  /** Run a command the palette chose — on `targetId` when it was picked. */
  const runCommand = (cmd: Command, targetId?: string): void => {
    const ctx = commandCtx
    setPalette(null)
    setHelpOpen(false)
    if (!ctx) return
    noteRecent(cmd.id)
    if (targetId && targetId !== ctx.selectedId) setSelectedId(targetId)
    cmd.run(ctx, targetId)
  }

  /** The help sheet's "Do it": run it here, or ask "which curve?" in the palette. */
  const doFromHelp = (id: string): void => {
    const cmd = COMMAND_BY_ID.get(id)
    if (!cmd || !commandCtx) return
    const av = availability(cmd, commandCtx)
    if (av.state === 'ready') runCommand(cmd, av.targetId)
    else if (av.state === 'pick') {
      setHelpOpen(false)
      setPalette({ key: Date.now(), pick: id })
    }
  }

  // ⌘K / Ctrl+K opens the palette from anywhere — even with the cursor in the
  // equation box, which is exactly when a teacher reaches for a tool by name.
  // While the palette or the help sheet is open they handle ⌘K themselves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const isK = e.key.toLowerCase() === 'k'
      if (!isK || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      e.preventDefault()
      setHelpOpen(false)
      setPalette((p) => (p ? null : { key: Date.now() }))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return {
    mac, commandCtx, runCommand, doFromHelp,
  }
}

export type CommandsApi = ReturnType<typeof useCommands>

import { useEffect, useMemo } from 'react'
import type { CSSProperties } from 'react'
import { inkMapper } from './core/a11yPalette'
import { InkContext } from './ui/inkContext'
import { useSliderShiftSteps } from './ui/sliderKeys'
import { BOARD_DESC_ID, useGraphDescription } from './app/useGraphDescription'
import { MODE } from './app/constants'
import { FIGURE_STYLES } from './core/types'
import { AnalysisOverlay } from './ui/AnalysisOverlay'
import { AnswerContext } from './ui/answerContext'
import { CanvasStage } from './ui/CanvasStage'
import { DocMenu } from './ui/DocMenu'
import { ExportMenu } from './ui/ExportMenu'
import { NumberLineStage } from './ui/NumberLineStage'
import { PresentBar } from './ui/PresentBar'
import { PresentLegend } from './ui/PresentLegend'
import { PresentAnswers } from './ui/PresentAnswers'
import { RevealContext } from './ui/RevealAnswer'
import { RevealControls } from './ui/RevealControls'
import { Sidebar } from './ui/Sidebar'
import { Toolbar } from './ui/Toolbar'
import { TeacherNote } from './ui/TeacherNote'
import { useBoardState } from './app/useBoardState'
import { useDocumentState } from './app/useDocumentState'
import { useSessionState } from './app/useSessionState'
import { useBoardRefs } from './app/useBoardRefs'
import { useModels } from './app/useModels'
import { useNotices } from './app/useNotices'
import { useHistory } from './app/useHistory'
import { useDocumentPersistence } from './app/useDocumentPersistence'
import { useDocumentActions } from './app/useDocumentActions'
import { useCurveEditing } from './app/useCurveEditing'
import { useCalcLinks } from './app/useCalcLinks'
import { useFields } from './app/useFields'
import { useShapes } from './app/useShapes'
import { useTypedLines } from './app/useTypedLines'
import { useDataTables } from './app/useDataTables'
import { useBuilders } from './app/useBuilders'
import { useDomainLens } from './app/useDomainLens'
import { useNumberLine } from './app/useNumberLine'
import { useViewport } from './app/useViewport'
import { useUnitCircle } from './app/useUnitCircle'
import { useExamples } from './app/useExamples'
import { useGalleryLink } from './app/useGalleryLink'
import { useItemBank } from './app/useItemBank'
import { useRelatedRates } from './app/useRelatedRates'
import { useStats } from './app/useStats'
import { useInequalitySystem } from './app/useInequalitySystem'
import { useBoardOverlays } from './app/useBoardOverlays'
import { useExtraHandles } from './app/useExtraHandles'
import { useSelectionMarks } from './app/useSelectionMarks'
import { useCurveNames } from './app/useCurveNames'
import { useDomainPanel } from './app/useDomainPanel'
import { useValueTables } from './app/useValueTables'
import { useCircleViews } from './app/useCircleViews'
import { useBoardLook } from './app/useBoardLook'
import { useRevealMode } from './app/useRevealMode'
import { useCardCrossings } from './app/useCardCrossings'
import { useExport } from './app/useExport'
import { useFitAll } from './app/useFitAll'
import { useFigureSettings } from './app/useFigureSettings'
import { useFileDrop } from './app/useFileDrop'
import { useSidebarEditors } from './app/useSidebarEditors'
import { useCommands } from './app/useCommands'
import { useKeyboard } from './app/useKeyboard'
import { usePresentation } from './app/usePresentation'
import { usePresentAnswers } from './app/usePresentAnswers'
import { feedbackHref, useCourseFocus } from './app/useCourseFocus'
import { BuildFocus } from './ui/BuildMenu'
import { FirstRun } from './ui/FirstRun'
import { AboutDialog } from './ui/AboutDialog'
import { coursesLabel, galleryFilterFor } from './ui/courses'
import { BRAND } from './brand'
import { examplesLib } from './app/useExamples'
import { itemBankLib } from './app/useItemBank'
import { LazyWait, lazyComponent, lazyModule, prefetchLazyModules } from './ui/lazyLoad'

// Dialogs and sheets: none is open on the first render, so their code (and
// what only they use — the examples catalog, the item bank's LaTeX import,
// the QR encoder, the worksheet's pages) loads when one is first opened, or
// in the idle prefetch after the first paint (src/ui/lazyLoad.tsx).
const DescribeDialog = lazyComponent(lazyModule(() => import('./ui/DescribeDialog')), (m) => m.DescribeDialog, <LazyWait />)
const CommandPalette = lazyComponent(lazyModule(() => import('./ui/CommandPalette')), (m) => m.CommandPalette, <LazyWait />)
const HelpSheet = lazyComponent(
  lazyModule(() => Promise.all([import('./ui/HelpSheet'), examplesLib.load()]).then(([m]) => m)),
  (m) => m.HelpSheet,
  <LazyWait />,
)
const ShareDialog = lazyComponent(lazyModule(() => import('./ui/ShareDialog')), (m) => m.ShareDialog, <LazyWait />)
const WorksheetEditor = lazyComponent(lazyModule(() => import('./ui/WorksheetEditor')), (m) => m.WorksheetEditor, <LazyWait />)
const ExampleGallery = lazyComponent(
  lazyModule(() => Promise.all([import('./ui/ExampleGallery'), examplesLib.load()]).then(([m]) => m)),
  (m) => m.ExampleGallery,
  <LazyWait />,
)
const itemBankDialogs = lazyModule(() =>
  Promise.all([import('./ui/ItemBankDialogs'), itemBankLib.load()]).then(([m]) => m),
)
const CopyForBankDialog = lazyComponent(itemBankDialogs, (m) => m.CopyForBankDialog, <LazyWait />)
const GraphFromItemDialog = lazyComponent(itemBankDialogs, (m) => m.GraphFromItemDialog, <LazyWait />)

/** Per-curve style extras FittedCurve doesn't carry (kept in a parallel map). */
export type { CurveStyle, StyleMap } from './core/persist'
export type { CurveEdit, Mode } from './app/types'
export {
  BETWEEN_ABS,
  BETWEEN_CANCELLED,
  betweenCardInfo,
  betweenIntent,
  betweenNotice,
  betweenTargets,
} from './app/between'
export type { BetweenIntent } from './app/between'

/**
 * The composition root. Every piece of state, every effect and every handler
 * lives in a hook under src/app/, called here in the order the old single
 * component declared them; App only wires their results into the board,
 * the sidebar and the dialogs.
 */
export default function App() {
  const board = useBoardState()
  const docState = useDocumentState()
  const session = useSessionState()
  const refs = useBoardRefs({ board, docState, session })
  const derived = useModels({ board, docState, session, refs })
  const notices = useNotices({ board, session, refs })
  const history = useHistory({ board, docState, session, refs, derived, notices })
  const persistence = useDocumentPersistence({ board, docState, session, refs, derived, notices })
  const docActions = useDocumentActions({
    board, docState, session, refs, derived, notices, history, persistence,
  })
  const editing = useCurveEditing({ board, session, refs, derived, notices, history })
  const calc = useCalcLinks({ board, refs, derived, notices, history, editing })
  const fieldsApi = useFields({ board, refs, derived, notices, history, editing, calc })
  const shapesApi = useShapes({ board, refs, derived, notices, history, editing, calc })
  const typed = useTypedLines({
    board, refs, derived, notices, history, editing, calc, fieldsApi, shapesApi,
  })
  const tables = useDataTables({ board, docState, refs, derived, notices, history, editing })
  const builders = useBuilders({ board, refs, derived, notices, history, typed })
  const domain = useDomainLens({ board, session, refs, derived, notices, history, calc, typed })
  const numberLine = useNumberLine({ board, refs, history, editing })
  const viewport = useViewport({
    board, refs, derived, notices, history, persistence, docActions, calc, fieldsApi, typed, tables,
    numberLine, revealRef: session.revealRef,
  })
  const examplesApi = useExamples({ docState, refs, derived, notices, persistence, viewport })
  const unitCircle = useUnitCircle({ board, refs, derived, notices, history, calc, viewport })
  const rates = useRelatedRates({ board, refs, notices, history, calc, viewport })
  const statsApi = useStats({ board, refs, notices, history, calc, viewport })
  const system = useInequalitySystem({ board, refs, derived, history })
  const overlaysApi = useBoardOverlays({
    board, docState, session, derived, calc, tables, domain, system, shapesApi,
  })
  const handlesApi = useExtraHandles({
    board, docState, refs, derived, calc, fieldsApi, shapesApi, builders,
  })
  const marks = useSelectionMarks({
    board, docState, session, refs, derived, fieldsApi, shapesApi, tables, builders, domain,
    viewport, unitCircle, system, handlesApi, statsApi,
  })
  const naming = useCurveNames({ board, docState, session, refs, derived, history, overlaysApi })
  const panel = useDomainPanel({ board, docState, refs, derived, calc, domain, naming })
  const valueTablesApi = useValueTables({ board, docState, derived, notices, tables, naming })
  const circleViewsApi = useCircleViews({ board, docState })
  const lookApi = useBoardLook({ board, session, refs, derived, calc, marks, naming })
  const revealMode = useRevealMode({
    board, docState, session, derived, editing, system, overlaysApi, panel, lookApi, shapesApi,
  })
  const cardCrossings = useCardCrossings({ refs, calc, naming, lookApi })
  const describer = useGraphDescription({
    board, session, refs, derived, notices, persistence, overlaysApi,
  })
  const exporter = useExport({
    board, docState, session, refs, derived, notices, calc, fieldsApi, shapesApi, tables,
    unitCircle, rates, system, overlaysApi, marks, naming, lookApi, revealMode, describer, statsApi,
    valueTablesApi,
  })
  // "Fit to curves" frames the geometry too, measured as the fitted export is
  const fitAll = useFitAll({
    refs, derived, fieldsApi, shapesApi, viewport,
    geometryMarksRef: overlaysApi.geometryMarksRef, exportContent: exporter.exportContent,
  })
  const viewportFit = useMemo(() => ({ ...viewport, fitToContent: fitAll }), [viewport, fitAll])
  const figureSettings = useFigureSettings({
    board, docState, session, refs, derived, notices, history, viewport, lookApi,
  })
  const fileDrop = useFileDrop({ docState })
  const editors = useSidebarEditors({
    board, session, refs, notices, docActions, editing, fieldsApi, shapesApi, typed, tables,
    numberLine, unitCircle, rates, statsApi,
  })
  const itemBank = useItemBank({
    refs, derived, notices, persistence, overlaysApi, examples: examplesApi,
  })
  // First run, the teacher's courses, backups and About (before ⌘K, which offers them)
  const focus = useCourseFocus({ docState, refs, notices, persistence, docActions, examples: examplesApi })
  const commandsApi = useCommands({
    board, docState, session, refs, derived, notices, history, docActions, editing, calc, fieldsApi,
    typed, tables, domain, numberLine, viewport: viewportFit, unitCircle, rates, overlaysApi, naming, revealMode,
    exporter, figureSettings, editors, examples: examplesApi, itemBank, describer, statsApi, shapesApi,
    circleViewsApi, focus,
  })
  useKeyboard({
    board, docState, session, refs, history, editing, calc, revealMode, figureSettings, editors,
    viewport,
  })
  useSliderShiftSteps()
  const presentation = usePresentation({
    board, docState, session, refs, derived, fieldsApi, shapesApi, tables,
  })
  const presentAnswers = usePresentAnswers({
    board, docState, session, derived, overlaysApi, panel, valueTablesApi, circleViewsApi, tables,
    fieldsApi, system, unitCircle, rates, statsApi, marks, naming, revealInv: revealMode.revealInv,
  })

  const {
    curves, kind, items, styles, selectedId, sidebarOpen, setSidebarOpen, drawingActive,
    setDrawingActive, exprOpen, factorOpen, expOpen, logisticOpen, logOpen, sinOpen, transformOpen,
    piecewiseOpen, conicOpen, motionOpen, fields, armedField, shapes, dataSets, sequences, seqOpen,
    unitCircles, relatedRates, stats, boardGrid, figureStyle, figureCaption, previewFigure,
    setPreviewFigure, snapFlash, shake, toast, setToast, confirmAsk, setConfirmAsk,
  } = board
  const {
    docMeta, docs, saveState, saveError, loadNotice, setLoadNotice, conflict, shared, shareDialog,
    setShareDialog, bannerTop, switchBlocked, setSwitchBlocked, exprSources, brokenExpr,
    displaySources, dropActive,
  } = docState
  const {
    showAnalysis, reveal, markersOn, canvasTheme, exportFormat, changeExportFormat, latexWidthCm,
    changeLatexWidth, wheelPref, setWheelPref, setNotation, axisUnitChoice, exportSettings,
    presentMode, setPresentMode, presentType, palette, setPalette, helpOpen, setHelpOpen,
    recentCommands, exprSeed, legendCorner, setLegendCorner, copyState, highlight, setHighlight,
    featureNote, setFeatureNote, curvePalette, setCurvePalette,
  } = session
  const {
    models, depKeys, analysis, editedIds, axisUnits, vpRef, stageRef, nlStageRef, overlayRef,
  } = derived
  const { showToast } = notices
  const { undo, redo, editStart, editEnd, editCancel, commitWithSnap } = history
  const { saveNow, reloadCurrentDoc, docNote } = persistence
  const { galleryOpen, openGallery, closeGallery, openExample, foldedNotes, setNoteFolded } = examplesApi
  useGalleryLink(openGallery) // ?app=1&gallery=1 (the landing page's "Open an AP example")
  const {
    bankOpen, openBankCopy, closeBankCopy, itemOpen, openGraphFromItem, closeGraphFromItem,
    buildBankFigure, copyBankText, downloadTex, graphItem,
  } = itemBank
  const {
    worksheetOpen, setWorksheetOpen, openWorksheet, renameDoc, newDocument, setBoardKind,
    openDocument, saveBoardAsNewDoc, copyName, makeSharedCopy, duplicateDocument, openShareDialog,
    deleteDocument, toggleAnalysis, exportDocument, importDocument,
  } = docActions
  const {
    pickColor, handleStrokeRecognized, deleteCurve, clearAll, toggleVisible, cycleColor, setParam,
    applyCandidate, candidatesFor, dragCurveLive, handleDragLive, oversketchApply, showNotice,
    oversketchFail, setParamExact, applyFeature, applyFeatureByIndex, applyNearestFeature,
    duplicateCurve, setStrokeWidth, setDash, setEnds, setOpacity,
  } = editing
  const { addCalcObject, addAreaBetween, selectObject, changeCalc, removeCalcObject } = calc
  const {
    setFieldEquation, setFieldParam, setFieldParamExact, setFieldSpacing, toggleFieldVisible,
    cycleFieldColor, deleteField, removeSolution, addEuler, patchEuler, removeEuler, fieldScene,
    eulerFigure, pointPick, fieldCardFor, armSolution, setSolutionCoord,
  } = fieldsApi
  const {
    setShapeEquation, setShapeParam, setShapeParamExact, toggleShapeVisible, cycleShapeColor,
    toggleShapeFill, deleteShape, setShapeCoord, shapeCardFor, setShapeMeasure, addShape,
    addImage, setImageOp, setImageAids, toggleSymmetry, setShapeCompare,
  } = shapesApi
  const {
    buildSequence, setSequenceSource, setSeqParam, setSeqParamExact, setSeqWindow, toggleSeqVisible,
    toggleSeqPartner, toggleSeqSums, toggleSeqSeries, setSeqSeries, cycleSeqColor, deleteSequence,
    duplicateSequence, addExpression, setCurveEquation,
  } = typed
  const {
    addDataTable, setDataCellText, setDataLabel, removeDataRowAt, pasteData, toggleDataVisible,
    cycleDataColor, setDataMarker, deleteData, duplicateData, addRegression, removeRegression,
    setRegressionDigits, toggleResiduals, toggleResidualPlot, refitRegression, scatterScene, dataCardFor, seqCardFor,
    seqDefaultName, setTableCalc, sortTableByX,
  } = tables
  const {
    buildFromRoots, restateFactors, dropFactorThrough, factorThroughFor, buildExponential,
    convertToTyped, buildLogistic, showLogisticField, buildLogarithm, buildSinusoid,
    buildTransformation, buildPiecewise, piecewiseEnvFor, piecewiseBuildEnv, buildConic,
    setConicConstruction, conicConstructionFor, buildMotion, commitMotionInterval, patchMotion,
    motionFor, setTransformShowParent, transformShowParentFor,
  } = builders
  const { showInverse, showInverseOf, domainActions, renameCurve } = domain
  const {
    placePoint, createInterval, moveEndpoint, toggleEnd, setBound, setItemLabel, cycleItemColor,
    deleteItem, setItemWidth, addInequality, setSolveShow, setItemEquation,
  } = numberLine
  const {
    viewRefresh, viewportChanged, zoomBy, resetView, viewSettings, graphSolve,
    zoomToData, zoomToSequence,
  } = viewport
  const { addUnitCircle, ucFigures, unitCircleCardNodes } = unitCircle
  const { addRelatedRates, rrFigures, relatedRatesCardNodes } = rates
  const { addNormal, addSimulation, addDataPlot, addProbability, statsFigs, statsCardNodes } = statsApi
  const { ineqSolution, systemCardNode } = system
  const { overlays, calcFor, betweenFor } = overlaysApi
  const { motionScalesFor, boardHandles, boardAnalysis, screenPolylines, screenShapes } = marks
  const {
    boardCurveNames, cardNames, renamableNames, linkErrors, takenNames, piecewiseName, exprNames,
    inverseNotes, signFigures, signBandPx,
  } = naming
  const { domainPanelFor, logInverseSources } = panel
  const { tablePanelFor, tableActions, tableFigs } = valueTablesApi
  const { circlePanelFor, circleActions } = circleViewsApi
  const {
    captionText, screenTheme, look, boardFigure, boardCaption, boardTheme, lightBoard,
    boardCrossings,
  } = lookApi
  const {
    revealKey, toggleReveal, sceneReveal, contextShown, revealApi, revealControls,
  } = revealMode
  const { crossingsFor } = cardCrossings
  const {
    copyPNG, exportCurrent, latexCopyState, copyLatex, physicalSizeOf, exportSizeOf,
    changeExportSettings,
  } = exporter
  const {
    setAxisUnit, setRuling, chooseFigureStyle, setCaption, resetCaption, toggleCanvasTheme,
  } = figureSettings
  const { endDrop, keepDropAlive } = fileDrop
  const { showBuilder } = editors
  /** Build ▾'s courses and its non-builder rows (src/ui/BuildMenu.tsx BuildFocus). */
  const buildFocus = useMemo(
    () => ({
      courses: focus.courses,
      onTypeLine: editors.typeLine,
      onSolveInequality: () => {
        setBoardKind('number-line')
        editors.typeLine()
      },
    }),
    [focus.courses, editors.typeLine, setBoardKind],
  )
  const { mac, commandCtx, runCommand, doFromHelp } = commandsApi
  const {
    canUndo, canRedo, present, legendShown, changePresentType, hasBoardContent, answerBoard,
  } = presentation
  const { description, describeOpen, openDescribe, closeDescribe, copyText, copyAltText } = describer
  /** The colour a card shows: the board's palette (the sidebar is dark in every theme). */
  const cardInk = useMemo(() => inkMapper(false, curvePalette), [curvePalette])
  /**
   * A view-only share link opened in reveal mode: the person is a student.
   * The teacher's tools (Analysis, Undo/Redo, Reveal, Present, Download, the
   * share and copy actions) and the reveal-everything buttons are not theirs.
   */
  const student = shared?.student === true
  /** What the board's live region says: the latest toast or "moved" note. */
  const liveText = toast?.msg ?? (featureNote?.kind === 'moved' ? featureNote.text : '')
  // After the first paint, fetch the code the first render left out, in idle time.
  useEffect(() => prefetchLazyModules(), [])

  return (
    <div
      className={`app${lightBoard ? ' canvas-light' : ''}${
        presentMode ? ' present-mode' : ''
      }${helpOpen ? ' help-open' : ''}`}
      data-present={presentMode ? 'on' : 'off'}
    >
      {/* Keyboard: the first Tab stop jumps over the sidebar to the board. */}
      <a
        className="skip-link"
        href="#board-canvas"
        data-testid="skip-to-board"
        onClick={(e) => {
          e.preventDefault()
          document.getElementById('board-canvas')?.focus()
        }}
      >
        Skip to board
      </a>
      <InkContext.Provider value={cardInk}>
      <RevealContext.Provider value={revealApi}>
      <AnswerContext.Provider value={answerBoard}>
      <BuildFocus.Provider value={buildFocus}>
      <Sidebar
        open={sidebarOpen && !presentMode}
        docId={docMeta.id}
        readOnly={shared?.viewOnly === true}
        topNote={
          // A view-only link shows the note only when the teacher included it
          // (and never to a student in reveal mode): it is written to them.
          shared?.noteHidden ? null : (
            <TeacherNote
              note={docNote}
              folded={foldedNotes.has(docMeta.id)}
              onFold={(f) => setNoteFolded(docMeta.id, f)}
            />
          )
        }
        student={student}
        kind={kind}
        onSetKind={setBoardKind}
        items={items}
        onItemDelete={deleteItem}
        onItemCycleColor={cycleItemColor}
        onItemToggleEnd={toggleEnd}
        onItemSetBound={setBound}
        onItemLabel={setItemLabel}
        onItemWidth={setItemWidth}
        onItemEquation={setItemEquation}
        onSolveShow={setSolveShow}
        onSolveGraph={graphSolve}
        curves={curves}
        styles={styles}
        models={models}
        selectedId={selectedId}
        exprOpen={exprOpen}
        exprSeed={exprSeed}
        snapFlash={snapFlash}
        shake={shake}
        exprSources={exprSources}
        brokenExpr={brokenExpr}
        displaySources={displaySources}
        editedIds={editedIds}
        analysis={analysis}
        intersectionsFor={crossingsFor}
        onAnalysisHover={setHighlight}
        onFeatureEdit={applyFeatureByIndex}
        candidatesFor={candidatesFor}
        onSelect={selectObject}
        onDelete={deleteCurve}
        onDuplicate={duplicateCurve}
        onToggleVisible={toggleVisible}
        onCycleColor={cycleColor}
        onParamChange={setParam}
        onParamEditStart={() => editStart('move slider')}
        onParamEditEnd={editEnd}
        onParamCommit={(id) => commitWithSnap(id, false)}
        onParamSetExact={setParamExact}
        onApplyCandidate={applyCandidate}
        onCurveEquation={setCurveEquation}
        onStrokeWidth={setStrokeWidth}
        onDash={setDash}
        onEnds={setEnds}
        onOpacity={setOpacity}
        onExprToggle={() => showBuilder('expr', 'toggle')}
        factorOpen={factorOpen}
        onFactorToggle={() => showBuilder('factor', 'toggle')}
        expOpen={expOpen}
        onExpToggle={() => showBuilder('exp', 'toggle')}
        logisticOpen={logisticOpen}
        onLogisticToggle={() => showBuilder('logistic', 'toggle')}
        onLogisticBuild={buildLogistic}
        onLogisticRestate={restateFactors}
        onShowLogisticField={showLogisticField}
        logOpen={logOpen}
        onLogToggle={() => showBuilder('log', 'toggle')}
        sinOpen={sinOpen}
        onSinToggle={() => showBuilder('sin', 'toggle')}
        onSinBuild={buildSinusoid}
        onSinRestate={restateFactors}
        transformOpen={transformOpen}
        onTransformToggle={() => showBuilder('transform', 'toggle')}
        onTransformBuild={buildTransformation}
        onTransformRestate={restateFactors}
        piecewiseOpen={piecewiseOpen}
        onPiecewiseToggle={() => showBuilder('piecewise', 'toggle')}
        onPiecewiseBuild={buildPiecewise}
        conicOpen={conicOpen}
        onConicToggle={() => showBuilder('conic', 'toggle')}
        onConicBuild={buildConic}
        onConicRestate={restateFactors}
        conicConstructionFor={conicConstructionFor}
        onConicConstruction={setConicConstruction}
        motionOpen={motionOpen}
        onMotionToggle={() => showBuilder('motion', 'toggle')}
        onMotionBuild={buildMotion}
        onUnitCircleAdd={addUnitCircle}
        unitCircleCards={unitCircleCardNodes}
        systemCard={systemCardNode}
        unitCircleCount={kind === 'cartesian' ? unitCircles.length : 0}
        onRelatedRatesAdd={addRelatedRates}
        relatedRatesCards={relatedRatesCardNodes}
        relatedRatesCount={kind === 'cartesian' ? relatedRates.length : 0}
        onNormalAdd={addNormal}
        onSimulationAdd={addSimulation}
        onDataPlotAdd={addDataPlot}
        onProbabilityAdd={addProbability}
        statsCards={statsCardNodes}
        statsCount={kind === 'cartesian' ? stats.length : 0}
        seqOpen={seqOpen}
        onSeqToggle={() => showBuilder('seq', 'toggle')}
        onSeqBuild={buildSequence}
        seqDefaultName={seqDefaultName}
        sequences={sequences}
        seqCardFor={seqCardFor}
        onSeqDelete={deleteSequence}
        onSeqDuplicate={duplicateSequence}
        onSeqToggleVisible={toggleSeqVisible}
        onSeqCycleColor={cycleSeqColor}
        onSeqZoom={zoomToSequence}
        onSeqParamChange={setSeqParam}
        onSeqParamSetExact={setSeqParamExact}
        onSeqEquation={setSequenceSource}
        onSeqWindow={setSeqWindow}
        onSeqTogglePartner={toggleSeqPartner}
        onSeqToggleSums={toggleSeqSums}
        onSeqToggleSeries={toggleSeqSeries}
        onSeqSeriesChange={setSeqSeries}
        motionFor={motionFor}
        motionScalesFor={motionScalesFor}
        onMotionPlay={patchMotion}
        onMotionInterval={commitMotionInterval}
        onPiecewiseRestate={restateFactors}
        piecewiseEnvFor={piecewiseEnvFor}
        piecewiseBuildEnv={piecewiseBuildEnv}
        piecewiseName={piecewiseName}
        takenNames={takenNames}
        transformShowParentFor={transformShowParentFor}
        onTransformShowParent={setTransformShowParent}
        boardTheme={screenTheme}
        onLogBuild={buildLogarithm}
        logInverseSources={logInverseSources}
        onLogRestate={restateFactors}
        onShowInverse={showInverse}
        cardNames={cardNames}
        storedNames={renamableNames}
        onRename={renameCurve}
        linkErrors={linkErrors}
        cardNotes={inverseNotes}
        onShowInverseOf={showInverseOf}
        domainPanelFor={domainPanelFor}
        domainActions={domainActions}
        setNotation={setNotation}
        tablePanelFor={tablePanelFor}
        tableActions={tableActions}
        circlePanelFor={circlePanelFor}
        circleActions={circleActions}
        depKeys={depKeys}
        exprNames={exprNames}
        onExpBuild={buildExponential}
        onExpRestate={restateFactors}
        onConvertTyped={convertToTyped}
        onFactorBuild={buildFromRoots}
        onFactorRestate={restateFactors}
        factorThroughFor={factorThroughFor}
        onFactorThroughDrop={dropFactorThrough}
        onExprSubmit={kind === 'number-line' ? addInequality : addExpression}
        calcFor={calcFor}
        onAddCalc={addCalcObject}
        betweenFor={betweenFor}
        onAddAreaBetween={addAreaBetween}
        onCalcChange={changeCalc}
        onCalcRemove={removeCalcObject}
        fields={fields}
        fieldCardFor={fieldCardFor}
        armedField={armedField}
        onFieldArm={armSolution}
        onFieldDelete={deleteField}
        onFieldToggleVisible={toggleFieldVisible}
        onFieldCycleColor={cycleFieldColor}
        onFieldSpacing={setFieldSpacing}
        onFieldParamChange={setFieldParam}
        onFieldParamSetExact={setFieldParamExact}
        onFieldEquation={setFieldEquation}
        onSolutionSet={setSolutionCoord}
        onSolutionRemove={removeSolution}
        onEulerAdd={addEuler}
        onEulerPatch={patchEuler}
        onEulerRemove={removeEuler}
        shapes={shapes}
        shapeCardFor={shapeCardFor}
        onShapeDelete={deleteShape}
        onShapeToggleVisible={toggleShapeVisible}
        onShapeCycleColor={cycleShapeColor}
        onShapeToggleFill={toggleShapeFill}
        onShapeParamChange={setShapeParam}
        onShapeParamSetExact={setShapeParamExact}
        onShapeEquation={setShapeEquation}
        onShapeCoord={setShapeCoord}
        onShapeMeasure={setShapeMeasure}
        onShapeAdd={addShape}
        onShapeImage={addImage}
        onShapeImageOp={setImageOp}
        onShapeImageAids={setImageAids}
        onShapeSymmetry={toggleSymmetry}
        onShapeCompare={setShapeCompare}
        onDataAdd={() => {
          showBuilder(null, 'open')
          addDataTable()
        }}
        data={dataSets}
        dataCardFor={dataCardFor}
        onDataDelete={deleteData}
        onDataDuplicate={duplicateData}
        onDataToggleVisible={toggleDataVisible}
        onDataCycleColor={cycleDataColor}
        onDataZoom={zoomToData}
        onDataMarker={setDataMarker}
        onDataCell={setDataCellText}
        onDataLabel={setDataLabel}
        onDataRemoveRow={removeDataRowAt}
        onDataPaste={pasteData}
        onRegressionAdd={addRegression}
        onRegressionRemove={removeRegression}
        onRegressionDigits={setRegressionDigits}
        onRegressionResiduals={toggleResiduals}
        onRegressionResidualPlot={toggleResidualPlot}
        onRegressionRefit={refitRegression}
        onDataCalc={setTableCalc}
        onDataSortX={sortTableByX}
      />
      </BuildFocus.Provider>
      </AnswerContext.Provider>

      {sidebarOpen && !presentMode && (
        <div className="scrim" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      )}

      <main
        className={signBandPx > 0 ? 'canvas-area has-sign-band' : 'canvas-area'}
        // The sign chart's band along the bottom of the board: the zoom stack
        // and the bottom notices sit ABOVE it rather than over its right end
        // (a projector at 1024 px showed the f″ row's last sign under them).
        style={signBandPx > 0 ? ({ '--sign-band': `${Math.round(signBandPx)}px` } as CSSProperties) : undefined}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            keepDropAlive()
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) endDrop()
        }}
        onDrop={(e) => {
          e.preventDefault()
          endDrop()
          const file = e.dataTransfer.files?.[0]
          if (file) importDocument(file)
        }}
      >
        {kind === 'number-line' ? (
          <NumberLineStage
            ref={nlStageRef}
            items={items}
            styles={styles}
            theme={boardTheme}
            {...(boardFigure ? { figure: boardFigure } : {})}
            selectedId={selectedId}
            mode={shared?.viewOnly ? 'pan' : MODE}
            inkColor={pickColor()}
            vpRef={vpRef}
            onSelect={selectObject}
            reveal={sceneReveal}
            onRevealMark={revealKey}
            onPlacePoint={placePoint}
            onCreateInterval={createInterval}
            onMoveEndpoint={moveEndpoint}
            onToggleEnd={toggleEnd}
            onEditStart={editStart}
            onEditEnd={editEnd}
            onEditCancel={editCancel}
            onViewportChange={viewportChanged}
            present={present}
            inkPalette={curvePalette}
            a11yLabel={description.summary}
            describedBy={BOARD_DESC_ID}
          />
        ) : (
        <CanvasStage
          ref={stageRef}
          curves={curves}
          styles={styles}
          models={models}
          selectedId={selectedId}
          mode={MODE}
          inkColor={pickColor()}
          vpRef={vpRef}
          onStrokeRecognized={handleStrokeRecognized}
          onSelect={selectObject}
          onDrawingChange={setDrawingActive}
          onDragCurve={dragCurveLive}
          onHandleDrag={handleDragLive}
          onOversketch={oversketchApply}
          onOversketchFail={oversketchFail}
          onCurveEditStart={editStart}
          onCurveEditEnd={commitWithSnap}
          onCurveEditCancel={editCancel}
          onViewportChange={viewportChanged}
          onStageResize={viewRefresh}
          onNotice={showNotice}
          analysis={boardAnalysis}
          analysisHighlight={markersOn ? highlight : null}
          intersections={boardCrossings}
          onFeatureEdit={applyFeature}
          theme={boardTheme}
          present={present}
          wheelPref={wheelPref}
          axisUnits={axisUnits}
          overlays={overlays}
          fields={fieldScene}
          polylines={screenPolylines}
          eulers={eulerFigure.paths}
          shapes={screenShapes}
          scatter={scatterScene}
          unitCircles={ucFigures}
          relatedRates={rrFigures}
          stats={statsFigs}
          signCharts={signFigures}
          valueTables={tableFigs}
          inequalitySolution={ineqSolution}
          grid={boardGrid}
          figure={boardFigure}
          caption={boardCaption}
          curveNames={boardCurveNames}
          extraHandles={boardHandles}
          pointPick={pointPick}
          reveal={sceneReveal}
          onRevealMark={revealKey}
          readOnly={shared?.viewOnly === true}
          inkPalette={curvePalette}
          a11yLabel={description.summary}
          describedBy={BOARD_DESC_ID}
        />
        )}

        {/* The board in words (src/app/useGraphDescription.ts): what the
            canvas's aria-describedby reads, kept current a moment after the
            board stops changing. Polite and not atomic, so a screen reader
            says the paragraph that changed, not the whole board again. */}
        <div id={BOARD_DESC_ID} className="sr-only" aria-live="polite" data-testid="board-description">
          {description.long.split(/\n\n+/).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>

        {/* A shared document says so on the board, with the one thing to do
            about it. DOM, so it never reaches an export. */}
        {shared && !presentMode && (
          <div className="share-stack" style={{ top: bannerTop }}>
            <div className="share-banner" data-testid="share-banner" role="status">
              <span className="share-banner-text">
                <strong>Shared graph</strong>
                {student
                  ? ' · view only · Next checks one answer at a time'
                  : shared.viewOnly
                    ? ' · view only'
                    : ' · not in your documents yet'}
              </span>
              {/* A student's copy would open with every answer showing. */}
              {!student && (
                <button
                  className="share-banner-btn"
                  data-testid="share-make-copy"
                  onClick={() => makeSharedCopy('asked')}
                  title="Save this graph into your own documents, where you can edit it"
                >
                  Make a copy
                </button>
              )}
            </div>
            {shared.question && (
              <div className="share-question-banner" data-testid="share-question-banner" role="note" aria-label="Question">
                <span className="share-question-tag">Question</span>
                <span className="share-question-text">{shared.question}</span>
              </div>
            )}
          </div>
        )}

        {/* A preview is a temporary state the board is in, and the one thing a
            temporary state must never be is hard to leave. The switch that
            turned it on is three clicks away inside a panel; this chip is on
            the board itself and turns it off with one, so a teacher who comes
            back to a white board tomorrow morning has the answer in front of
            them rather than a setting to hunt for. Chrome, not figure: it is a
            DOM element, so it cannot reach the PNG. */}
        {look.previewing && (
          <button
            className="fig-preview-chip"
            data-testid="figure-preview-chip"
            onClick={() => setPreviewFigure(false)}
            title="Stop previewing — put the board back on your theme"
          >
            <span>Previewing {FIGURE_STYLES[figureStyle].name}</span>
            <span className="fig-preview-x" aria-hidden="true">
              ×
            </span>
          </button>
        )}

        {/* Reveal mode's controls on the board (in presentation they ride in
            the PresentBar instead). DOM, so they never reach an export. */}
        {reveal.on && !presentMode && (
          <div className="reveal-bar" data-testid="reveal-bar">
            <RevealControls {...revealControls} student={student} />
          </div>
        )}

        {kind === 'cartesian' && contextShown.length > 0 && (
          <AnalysisOverlay ref={overlayRef} marked={contextShown} theme={boardTheme} vpRef={vpRef} bottomInset={signBandPx} />
        )}

        {presentMode ? (
          <PresentBar
            scale={presentType}
            canUndo={canUndo}
            onScale={changePresentType}
            onUndo={undo}
            onExit={() => setPresentMode(false)}
            reveal={revealControls}
          />
        ) : (
        <Toolbar
          sidebarOpen={sidebarOpen}
          canUndo={canUndo}
          canRedo={canRedo}
          showAnalysis={showAnalysis}
          onToggleAnalysis={toggleAnalysis}
          canvasTheme={canvasTheme}
          onToggleCanvasTheme={toggleCanvasTheme}
          docMenu={
            <DocMenu
              name={docMeta.name}
              currentId={docMeta.id}
              docs={docs}
              saveState={saveState}
              kind={kind}
              hasContent={hasBoardContent}
              onRename={renameDoc}
              onNew={newDocument}
              onClearBoard={clearAll}
              onOpen={openDocument}
              onDuplicate={duplicateDocument}
              onDelete={deleteDocument}
              onExport={exportDocument}
              onImport={focus.restoreFromFile /* a document, or a full backup */}
              backupDue={focus.backupDue}
              onBackupAll={focus.saveBackup}
              onSnoozeBackup={focus.snoozeBackup}
              onWorksheet={student ? undefined : openWorksheet}
              onExamples={openGallery}
              onGraphFromItem={student ? undefined : openGraphFromItem}
              onShare={student ? undefined : openShareDialog}
              shared={shared ? (shared.viewOnly ? 'view' : 'edit') : null}
              onMakeCopy={student ? undefined : () => makeSharedCopy('asked')}
              student={student}
            />
          }
          student={student}
          brand={BRAND}
          onExamples={openGallery}
          settings={{
            brand: BRAND,
            coursesLabel: coursesLabel(focus.courses),
            onCourses: focus.openCourses,
            tipDue: focus.tipDue,
            onDismissTip: focus.dismissTip,
            onBackup: focus.saveBackup,
            onRestore: focus.pickRestore,
            onAbout: focus.openAbout,
            feedbackHref: feedbackHref(),
          }}
          exportMenu={
            // A student gets none of these: Reveal off and Download would both
            // put every answer up, and Present is the teacher's projector.
            student ? undefined : (
            <>
              {/* The presentation switch lives beside Download because both
                  are "the board leaves this window": one to paper, one to a
                  wall. The Toolbar component itself is untouched — it takes
                  this slot as a node. */}
              <button
                className={`tb-btn tb-toggle${reveal.on ? ' reveal-toggle-on' : ''}`}
                onClick={toggleReveal}
                data-testid="reveal-enter"
                aria-pressed={reveal.on}
                title={
                  reveal.on
                    ? 'Leave reveal mode — every answer shows again (R)'
                    : 'Reveal mode (R) — hide the answers, then reveal them one at a time'
                }
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.4" />
                  <path
                    d="M6.2 6.3a1.9 1.9 0 1 1 2.6 1.75c-.5.22-.8.6-.8 1.15v.4"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                  <circle cx="8" cy="11.6" r="0.85" fill="currentColor" />
                </svg>
                <span className="tb-label tb-reveal-label">Reveal</span>
              </button>
              <button
                className="tb-btn tb-icon"
                onClick={() => setPresentMode(true)}
                data-testid="present-enter"
                aria-pressed={presentMode}
                title="Present this board (F) — big type, no sidebar, equations on the canvas"
                aria-label="Presentation mode"
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <rect
                    x="1.4"
                    y="2.4"
                    width="13.2"
                    height="9"
                    rx="1.4"
                    stroke="currentColor"
                    strokeWidth="1.4"
                  />
                  <path
                    d="M8 11.4v2.2M5.6 13.6h4.8"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              <div className="tb-sep" />
              <ExportMenu
                settings={exportSettings}
                hasContent={hasBoardContent}
                sizeOf={exportSizeOf}
                copyState={copyState}
                onChange={changeExportSettings}
                onExport={exportCurrent}
                onCopy={copyPNG}
                format={exportFormat}
                onFormat={changeExportFormat}
                formatAvailable={(f) => f !== 'pgfplots' || kind === 'cartesian'}
                latexWidthCm={latexWidthCm}
                onLatexWidth={changeLatexWidth}
                physicalSizeOf={physicalSizeOf}
                onCopyLatex={copyLatex}
                latexCopyState={latexCopyState}
                onItemBank={kind === 'cartesian' ? openBankCopy : undefined}
                axisUnits={kind === 'cartesian' ? axisUnitChoice : null}
                resolvedAxisUnits={axisUnits}
                onAxisUnit={setAxisUnit}
                grid={kind === 'cartesian' ? boardGrid : null}
                onGrid={setRuling}
                view={kind === 'cartesian' ? viewSettings : null}
                wheel={wheelPref}
                onWheel={setWheelPref}
                figure={figureStyle}
                screenTheme={screenTheme}
                caption={captionText}
                captionAuto={figureCaption === null}
                preview={previewFigure}
                onFigure={chooseFigureStyle}
                onCaption={setCaption}
                onCaptionAuto={resetCaption}
                onPreview={setPreviewFigure}
                curvePalette={curvePalette}
                onCurvePalette={setCurvePalette}
                onCopyAltText={() => {
                  void copyAltText()
                }}
              />
            </>
            )
          }
          onToggleSidebar={() => setSidebarOpen((o) => !o)}
          onUndo={undo}
          onRedo={redo}
          onHelp={() => {
            setPalette(null)
            setHelpOpen(true)
          }}
          onDescribe={openDescribe}
          curvePalette={curvePalette}
          onCurvePalette={setCurvePalette}
        />
        )}

        {presentMode && reveal.on && (
          <PresentAnswers
            lines={presentAnswers}
            total={revealControls.total}
            type={present?.type ?? presentType}
            side={legendCorner.endsWith('left') ? 'right' : 'left'}
          />
        )}

        {presentMode && (
          <PresentLegend
            entries={legendShown}
            type={present?.type ?? presentType}
            vpRef={kind === 'cartesian' ? vpRef : undefined}
            bottomInset={kind === 'cartesian' ? signBandPx : 0}
            corner={legendCorner}
            onCycleCorner={() =>
              setLegendCorner((c) =>
                c === 'bottom-left'
                  ? 'top-left'
                  : c === 'top-left'
                    ? 'top-right'
                    : c === 'top-right'
                      ? 'bottom-right'
                      : 'bottom-left',
              )
            }
          />
        )}

        {/* One live region that is always there, so a screen reader hears
            every toast and note: a region mounted together with its text is
            often not announced at all. The visible toast is its picture. */}
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="live-status">
          {liveText}
        </div>

        {toast && (
          <div key={toast.key} className="toast">
            <span className="toast-text">{toast.msg}</span>
            {toast.action && (
              <button
                className="toast-action"
                onClick={() => {
                  const run = toast.action?.run
                  setToast(null)
                  run?.()
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}

        {confirmAsk && (
          <div key={confirmAsk.key} className="feature-note feature-note-refused" role="alertdialog">
            <span className="feature-note-text">{confirmAsk.text}</span>
            <button
              className="feature-note-action"
              onClick={() => {
                const run = confirmAsk.run
                setConfirmAsk(null)
                run()
              }}
            >
              {confirmAsk.yes}
            </button>
            <button className="feature-note-action" onClick={() => setConfirmAsk(null)}>
              Keep my edits
            </button>
          </div>
        )}

        {featureNote && (
          <div
            key={featureNote.key}
            className={`feature-note${
              featureNote.kind === 'refused' ? ' feature-note-refused' : ''
            }`}
            role={featureNote.kind === 'refused' ? 'alert' : undefined}
          >
            <span className="feature-note-text">
              {featureNote.kind === 'refused' ? featureNote.reason : featureNote.text}
            </span>
            {featureNote.kind === 'refused' && featureNote.nearest && (
              <button className="feature-note-action" onClick={applyNearestFeature}>
                Use nearest achievable
              </button>
            )}
            {featureNote.kind === 'refused' && (
              <button
                className="feature-note-close"
                title="Dismiss"
                aria-label="Dismiss"
                onClick={() => setFeatureNote(null)}
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M4 4l8 8M12 4l-8 8"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
          </div>
        )}

        {saveError && (
          <div className="banner banner-error" role="alert">
            <div className="banner-body">
              <strong className="banner-title">Not saved</strong>
              <span className="banner-text">{saveError}</span>
            </div>
            <div className="banner-actions">
              <button className="banner-action" onClick={exportDocument}>
                Save a backup
              </button>
              <button className="banner-action" onClick={saveNow}>
                Retry
              </button>
            </div>
          </div>
        )}

        {conflict && (
          <div className="banner banner-error" role="alert">
            <div className="banner-body">
              <strong className="banner-title">
                {conflict === 'deleted'
                  ? 'This document was deleted in another tab'
                  : 'This document was changed in another tab'}
              </strong>
              <span className="banner-text">
                {conflict === 'deleted'
                  ? 'Nothing here has been thrown away — but this board is no longer being saved. Save it as a new document to keep it.'
                  : 'To protect the other tab’s work, this board is not being saved. Reload to take that version, or save this one as a copy.'}
              </span>
            </div>
            <div className="banner-actions">
              {conflict === 'stale' && (
                <button className="banner-action" onClick={reloadCurrentDoc}>
                  Reload
                </button>
              )}
              <button
                className="banner-action"
                onClick={() => saveBoardAsNewDoc(copyName())}
              >
                Save as a copy
              </button>
              <button className="banner-action" onClick={exportDocument}>
                Save a backup
              </button>
            </div>
          </div>
        )}

        {switchBlocked && (
          <div className="banner banner-error" role="alert">
            <div className="banner-body">
              <strong className="banner-title">Stayed on this document</strong>
              <span className="banner-text">{switchBlocked}</span>
            </div>
            <div className="banner-actions">
              <button className="banner-action" onClick={exportDocument}>
                Save a backup
              </button>
              <button className="banner-action" onClick={() => setSwitchBlocked(null)}>
                Dismiss
              </button>
            </div>
          </div>
        )}

        {loadNotice && (
          <div className={`banner${loadNotice.fatal ? ' banner-error' : ' banner-warn'}`} role="alert">
            <div className="banner-body">
              <strong className="banner-title">
                {loadNotice.fatal ? 'Couldn’t open that document' : 'Document restored with changes'}
              </strong>
              <span className="banner-text">{loadNotice.problems.slice(0, 3).join(' ')}</span>
            </div>
            <div className="banner-actions">
              <button className="banner-action" onClick={() => setLoadNotice(null)}>
                Dismiss
              </button>
            </div>
          </div>
        )}

        {kind === 'number-line' && items.length === 0 && !loadNotice?.fatal && (
          <div className="empty-hint" aria-hidden="true">
            <div className="empty-glyph">⟵•⟶</div>
            <div className="empty-title">Press + and type an inequality to solve it</div>
            <div className="empty-sub">
              “x^2 - 4 &gt; 0”, “|2x - 3| &lt; 5”, “x^2 &gt; 1 and x &lt; 3” — or click the line for a point, drag
              along it for an interval
            </div>
          </div>
        )}

        {kind === 'cartesian' &&
          curves.length === 0 &&
          fields.length === 0 &&
          shapes.length === 0 &&
          dataSets.length === 0 &&
          sequences.length === 0 &&
          unitCircles.length === 0 &&
          relatedRates.length === 0 &&
          stats.length === 0 &&
          !drawingActive &&
          !loadNotice?.fatal && (
          <div className="empty-hint" aria-hidden="true">
            <div className="empty-glyph">∿</div>
            <div className="empty-title">Draw anything — a wave, a circle, a heart…</div>
            <div className="empty-sub">
              Every stroke becomes a live equation. Select a curve to get handles; drag them, or
              double-click one to type exact values.
            </div>
          </div>
          )}

        {curves.length === 0 &&
          items.length === 0 &&
          fields.length === 0 &&
          shapes.length === 0 &&
          !drawingActive &&
          loadNotice?.fatal && (
          <div className="empty-hint empty-hint-error">
            <div className="empty-glyph empty-glyph-error">⚠</div>
            <div className="empty-title">This board is empty because a document couldn’t be opened</div>
            <div className="empty-sub">
              The damaged document was left untouched in storage — nothing was overwritten. You can
              open another document from the menu, or import a file you exported earlier.
            </div>
          </div>
          )}

        {worksheetOpen && (
          <WorksheetEditor
            docs={docs}
            screen={{ widthPx: vpRef.current.widthPx, heightPx: vpRef.current.heightPx }}
            onClose={() => setWorksheetOpen(false)}
            toast={(msg) => showToast(msg)}
          />
        )}

        {galleryOpen && (
          <ExampleGallery defaultCourses={galleryFilterFor(focus.courses)} onOpen={openExample} onClose={closeGallery} />
        )}

        {/* First run ("What do you teach?") and Settings → Your courses. */}
        {focus.chooser && (
          <FirstRun
            mode={focus.chooser}
            initial={focus.courses ?? []}
            onFinish={focus.finishFirstRun}
            onSave={(next) => {
              focus.chooseCourses(next)
              focus.closeChooser()
              showToast(next.length > 0 ? `Your courses: ${coursesLabel(next)}.` : 'No courses chosen — everything is shown.', { ms: 2600 })
            }}
            onCancel={focus.closeChooser}
          />
        )}
        {focus.aboutOpen && <AboutDialog onBackup={student ? undefined : focus.saveBackup} onClose={focus.closeAbout} />}

        {/* Once, after the first saved edit: the honest truth about storage. */}
        {focus.storageNotice && !presentMode && (
          <div className="storage-note" role="status" data-testid="storage-notice">
            <span className="storage-note-text">Your graphs are saved in this browser only.</span>
            <button className="storage-note-action" onClick={focus.saveBackup}>
              Save a backup →
            </button>
            <button className="storage-note-x" onClick={focus.dismissStorageNotice} aria-label="Dismiss" title="Dismiss">
              ×
            </button>
          </div>
        )}
        {bankOpen && (
          <CopyForBankDialog
            docName={docMeta.name}
            graph={kind === 'cartesian'}
            build={buildBankFigure}
            copy={copyBankText}
            download={downloadTex}
            onClose={closeBankCopy}
          />
        )}
        {itemOpen && <GraphFromItemDialog graph={graphItem} onClose={closeGraphFromItem} />}

        {describeOpen && (
          <DescribeDialog
            description={description}
            studentCopy={reveal.on}
            onCopy={(text, what) => {
              void copyText(text, what)
            }}
            onClose={closeDescribe}
          />
        )}

        {shareDialog && (
          <ShareDialog
            name={docMeta.name}
            json={shareDialog.json}
            baseHref={window.location.href}
            onClose={() => setShareDialog(null)}
          />
        )}

        {dropActive && (
          <div className="drop-overlay" aria-hidden="true">
            <div className="drop-inner">Drop a .json document to open it</div>
          </div>
        )}

        <div className="zoom-controls">
          <button className="zoom-btn" onClick={() => zoomBy(1.25)} title="Zoom in" aria-label="Zoom in">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 3.25v9.5M3.25 8h9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <button
            className="zoom-btn"
            onClick={() => zoomBy(1 / 1.25)}
            title="Zoom out"
            aria-label="Zoom out"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3.25 8h9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <button
            className="zoom-btn"
            onClick={fitAll}
            title="Fit to curves (frame everything visible)"
            aria-label="Fit to curves"
            data-testid="fit-to-curves"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M2 5.5v-2a1.5 1.5 0 0 1 1.5-1.5h2M10.5 2h2A1.5 1.5 0 0 1 14 3.5v2M14 10.5v2a1.5 1.5 0 0 1-1.5 1.5h-2M5.5 14h-2A1.5 1.5 0 0 1 2 12.5v-2"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <path d="M4.5 10c1.6 0 2-4 3.5-4s1.9 2 3.5 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
          <button className="zoom-btn" onClick={resetView} title="Reset view" aria-label="Reset view">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="8" r="3.25" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </main>
      </RevealContext.Provider>
      </InkContext.Provider>

      {/* ⌘K and ?: outside <main>, so the help sheet can print on its own. */}
      {palette && commandCtx && (
        <CommandPalette
          key={palette.key}
          ctx={commandCtx}
          recent={recentCommands}
          pickFor={palette.pick}
          mac={mac}
          onRun={runCommand}
          onClose={() => setPalette(null)}
        />
      )}
      {helpOpen && commandCtx && (
        <HelpSheet
          ctx={commandCtx}
          mac={mac}
          onDo={doFromHelp}
          onPalette={() => {
            setHelpOpen(false)
            setPalette({ key: Date.now() })
          }}
          onExample={(id) => {
            setHelpOpen(false)
            openExample(id)
          }}
          courses={focus.courses}
          onCourses={
            student
              ? undefined
              : () => {
                  setHelpOpen(false)
                  focus.openCourses()
                }
          }
          onClose={() => setHelpOpen(false)}
        />
      )}
    </div>
  )
}

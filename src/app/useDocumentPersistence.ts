// ============================================================================
// src/app/useDocumentPersistence.ts — load, autosave, switch, backup and share-open.
//
// What the board writes (currentBoardInput), when (the autosave effect), what a
// load puts back (applyHydrated), the startup restore, a share link opened
// from the hash, and the other-tab conflict watcher.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { MODELS } from '../core/fit/models'
import {
  AUTO_AXIS_UNITS,
  createDoc,
  deserializeDoc,
  docFromBoard,
  emptyBoard,
} from '../core/persist'
import type { BoardInput, DocMeta, HydratedBoard } from '../core/persist'
import { parseShareHash, urlWithoutShare } from '../core/share'
import type { BoardKind, ModelSpec } from '../core/types'
import { curveNames } from '../render/curveNames'
import { collectCurveViews, viewStatesFrom } from '../ui/curveViews'
import { nextDocName } from '../ui/docName'
import { ensureCalls, ensureNames, legacyNames, sliderLetters } from '../ui/nameLinks'
import { REVEAL_OFF } from '../ui/reveal'
import { sequenceLetters } from '../ui/seqLinks'
import { openShare } from '../ui/shareOpen'
import {
  isGrapherKey,
  listDocs,
  readDocJSON,
  readDocStamp,
  readIndex,
  setCurrentDoc,
  usedBytes,
  writeDoc,
} from '../ui/storage'
import type { SaveOutcome } from '../ui/storage'
import { axesModeOf } from '../ui/viewScale'
import { AUTOSAVE_MS, MODE } from './constants'
import type { BoardStateApi } from './useBoardState'
import type { DocumentStateApi } from './useDocumentState'
import type { SessionStateApi } from './useSessionState'
import type { BoardRefsApi } from './useBoardRefs'
import type { ModelsApi } from './useModels'
import type { NoticesApi } from './useNotices'

/** What useDocumentPersistence reads from the hooks App calls before it. */
export interface DocumentPersistenceDeps {
  board: BoardStateApi
  docState: DocumentStateApi
  session: SessionStateApi
  refs: BoardRefsApi
  derived: ModelsApi
  notices: NoticesApi
}

export function useDocumentPersistence({ board, docState, session, refs, derived, notices }: DocumentPersistenceDeps) {
  const {
    curves, setCurves, kind, setKind, items, setItems, styles, setStyles, selectedId, setSelectedId,
    setSidebarOpen, readViewStates, writeViewStates, curveViewsSig, setExtraModels, calcLinks,
    setCalcLinks, fields, setFields, setArmedField, shapes, setShapes, dataSets, setDataSets,
    sequences, setSequences, unitCircles, setUnitCircles, relatedRates, setRelatedRates, setRrPlay,
    stats, setStats, setStatsPlay,
    ineqSystem, setIneqSystem, setUcPlay, boardGrid, setBoardGrid, setAxesMode, viewSubsRef,
    figureStyle, setFigureStyle, figureCaption, setFigureCaption, setPreviewFigure, bumpHistory,
  } = board
  const {
    docMeta, setDocMeta, setDocs, setSaveState, setSaveError, setLoadNotice, setConflict, setShared,
    sharedRef, setSharedState, makeSharedCopyRef, setSwitchBlocked, exprSources, setExprSources,
    setBrokenExpr, displaySources, setDisplaySources, setEdits, names, setNames, calls, setCalls,
    inverses, setInverses,
  } = docState
  const { revealByDocRef, axisUnitChoice, setAxisUnitChoice } = session
  const {
    curvesRef, itemsRef, kindRef, stylesRef, selectedRef, undoRef, redoRef, preEditRef,
    setGesturing, candidatesRef, exprCounterRef, exprSourcesRef, brokenExprRef, displaySourcesRef,
    axisUnitChoiceRef, editsRef, calcRef, fieldsRef, shapesRef, dataRef, seqRef, ucRef, rrRef,
    statsRef, sysRef, namesRef, callsRef, inversesRef, regWrittenRef, regAutoHiddenRef, cellFoldRef,
    boardGridRef, figureStyleRef, figureCaptionRef, polarOfferedRef, derivCounterRef, calcSigRef,
    calcDomainRef, calcAutoHiddenRef, docMetaRef, saveTimerRef, hydratedRef, docStoredRef,
    skipAutosaveRef, unsavedRef, loadedStateRef,
  } = refs
  const {
    modelsRef, resolveName, singularOf, makeInverseSpec, vpRef, stageRef, nlStageRef,
  } = derived
  const { showToast } = notices

  // The teacher note (an opened example's): part of the document, written
  // with it, never part of undo. A ref for the serializer, state for the card.
  const noteRef = useRef<string>('')
  const [docNote, setDocNote] = useState<string>('')

  // ======================================================= documents / saving
  const blankBoard = useCallback(
    (nextKind: BoardKind = 'cartesian'): HydratedBoard => ({
      curves: [],
      kind: nextKind,
      items: [],
      styles: {},
      candidates: new Map(),
      extraModels: {},
      exprSources: {},
      displaySources: {},
      brokenExpr: {},
      axisUnits: { ...AUTO_AXIS_UNITS },
      calc: [],
      names: {},
      calls: {},
      inverses: [],
      fields: [],
      shapes: [],
      data: [],
      sequences: [],
      unitCircles: [],
      relatedRates: [],
      stats: [],
      system: null,
      grid: 'cartesian',
      figure: 'screen',
      caption: '',
      captionAuto: true,
      curveViews: {},
      viewport: { center: { x: 0, y: 0 }, pxPerUnit: 60 },
      selectedId: null,
      mode: 'draw',
      exprCounter: 0,
      derivCounter: 0,
    }),
    [],
  )

  /** Everything the serializer needs, read from the live refs. */
  const currentBoardInput = useCallback(
    (): BoardInput => ({
      curves: curvesRef.current,
      kind: kindRef.current,
      items: itemsRef.current,
      styles: stylesRef.current,
      candidates: candidatesRef.current,
      exprSources: exprSourcesRef.current,
      displaySources: displaySourcesRef.current,
      axisUnits: axisUnitChoiceRef.current,
      calc: calcRef.current,
      names: namesRef.current,
      calls: callsRef.current,
      inverses: inversesRef.current,
      fields: fieldsRef.current,
      shapes: shapesRef.current,
      data: dataRef.current,
      sequences: seqRef.current,
      unitCircles: ucRef.current,
      relatedRates: rrRef.current,
      stats: statsRef.current,
      system: sysRef.current,
      grid: boardGridRef.current,
      figure: figureStyleRef.current,
      // The DERIVED caption is not the document's: it is re-derived from the
      // curves on every load, so storing it would freeze a sentence that is
      // supposed to follow the board — and would change the bytes of every
      // board that never had a caption.
      caption: figureCaptionRef.current ?? '',
      captionAuto: figureCaptionRef.current === null,
      curveViews: collectCurveViews(readViewStates()),
      ...(noteRef.current !== '' ? { note: noteRef.current } : {}),
      viewport: {
        center: vpRef.current.center,
        pxPerUnit: vpRef.current.pxPerUnit,
        ...(vpRef.current.pxPerUnitY !== undefined
          ? { pxPerUnitY: vpRef.current.pxPerUnitY }
          : {}),
      },
      selectedId: selectedRef.current,
      mode: MODE,
    }),
    [],
  )

  /**
   * Write the board now. Returns the outcome — callers that are about to
   * REPLACE the board must not proceed on a failure, or the only copy of the
   * unsaved work is gone.
   */
  const saveNow = useCallback((): SaveOutcome => {
    // A shared document is never written in place (see `shared`).
    if (sharedRef.current) return { ok: true }
    if (!hydratedRef.current) return { ok: true }
    window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = 0
    const meta = docMetaRef.current
    if (!meta.id) return { ok: true }
    const doc = docFromBoard(meta, currentBoardInput())
    // Once the record exists, every write is conditional on nothing else having
    // touched it since we last read or wrote it.
    const outcome = writeDoc(
      doc,
      docStoredRef.current ? { expectModifiedAt: meta.modifiedAt } : {},
    )
    if (outcome.ok) {
      docMetaRef.current = { ...meta, modifiedAt: doc.modifiedAt }
      docStoredRef.current = true
      unsavedRef.current = false
      setDocs(listDocs())
      setSaveState('saved')
      setSaveError(null)
      setSwitchBlocked(null)
      setConflict(null)
      return outcome
    }
    // Never silent: the board is still in memory, but it is NOT on disk.
    setSaveState('error')
    if ('conflict' in outcome) {
      setConflict(outcome.conflict)
      setSaveError(null)
      return outcome
    }
    const kb = Math.round(usedBytes() / 1024)
    setSaveError(
      outcome.quota
        ? `${outcome.message} Grapher is using about ${kb}KB. Save a backup of this document, or delete documents you no longer need, then edit again to retry.`
        : outcome.message,
    )
    return outcome
  }, [currentBoardInput])

  /**
   * Save before swapping the board away. False means the swap must be
   * abandoned: the work on screen exists nowhere else.
   */
  const saveBeforeSwitch = useCallback((): boolean => {
    // A shared document: untouched, there is nothing to keep; edited, the
    // edits are kept as a copy in this browser's documents — never thrown away.
    if (sharedRef.current) {
      return undoRef.current.length === 0 ? true : makeSharedCopyRef.current('switch')
    }
    // Unchanged since it was loaded or last written, and on disk: nothing to
    // save, and writing anyway would bump modifiedAt for no reason.
    if (hydratedRef.current && docStoredRef.current && !unsavedRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = 0
      return true
    }
    const res = saveNow()
    if (res.ok) return true
    setSwitchBlocked(
      'conflict' in res
        ? `${res.message} Nothing was switched, so this board is still here. Save a backup, or reload the other tab’s version, before moving on.`
        : 'This document could not be saved, so switching would have thrown the work away. Save a backup first.',
    )
    return false
  }, [saveNow])

  const scheduleSave = useCallback((): void => {
    if (!hydratedRef.current) return
    if (sharedRef.current) {
      unsavedRef.current = true
      return
    }
    unsavedRef.current = true
    setSaveState('saving')
    window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(saveNow, AUTOSAVE_MS)
  }, [saveNow])

  /** Swap the whole board over to a freshly loaded document. */
  const applyHydrated = useCallback((meta: DocMeta, board: HydratedBoard): void => {
    // Whatever is loaded now is not the shared document (a share sets it again).
    sharedRef.current = null
    setShared(null)
    loadedStateRef.current = {
      curves: board.curves,
      items: board.items,
      kind: board.kind,
      styles: board.styles,
      exprSources: board.exprSources,
      displaySources: board.displaySources,
      selectedId: board.selectedId,
      name: meta.name,
    }
    curvesRef.current = board.curves
    itemsRef.current = board.items
    kindRef.current = board.kind
    stylesRef.current = board.styles
    candidatesRef.current = board.candidates
    exprSourcesRef.current = board.exprSources
    brokenExprRef.current = board.brokenExpr
    // The typed display form is part of the DOCUMENT — a factored cubic must
    // still print factored after a reload — so it comes back with the board.
    // The edit log does not: it is this session's account of what has been
    // done since the curve was recognised, and a freshly loaded curve is
    // exactly what the document said it was.
    displaySourcesRef.current = board.displaySources
    axisUnitChoiceRef.current = board.axisUnits
    // The links come back; everything they DRAW is rebuilt from them by the
    // sync pass below, against the models this load just registered. A
    // reopened board is therefore live, not a photograph.
    calcRef.current = board.calc
    // Same rule: the equations come back, everything they DRAW is re-derived.
    fieldsRef.current = board.fields
    // And the shapes: the lines come back, every vertex is evaluated again.
    shapesRef.current = board.shapes
    // And the tables: the cells come back, every fit is re-asked of them.
    dataRef.current = board.data
    // And the sequences: the lines come back, every term is evaluated again.
    seqRef.current = board.sequences
    // And the unit circle: centre, θ and switches; every label is re-derived.
    ucRef.current = board.unitCircles
    // And the related-rates problem: givens and t; every drawing is re-derived.
    rrRef.current = board.relatedRates
    // And the statistics objects: settings and seeds; every result is re-derived.
    statsRef.current = board.stats
    // And the inequality system's settings; its corners are re-derived.
    sysRef.current = board.system
    // The inverse links come back; their models are registered below, reading
    // the parent live exactly as they did before the document was closed.
    inversesRef.current = board.inverses
    callsRef.current = ensureCalls(board.calls, board.curves, board.exprSources)
    {
      // Names: the ones the document stored — or, for a document written
      // before names were stored, the letters the board derived for it (so
      // its caption still names the same curves) — then every curve still
      // without one gets the next free letter, once. From here on they are
      // stored, and never shift.
      const nameBoard = {
        curves: board.curves,
        sources: { ...board.displaySources, ...board.exprSources },
        calc: board.calc,
        inverses: board.inverses,
        calls: callsRef.current,
      }
      const seed =
        Object.keys(board.names).length > 0
          ? board.names
          : legacyNames(
              curveNames(board.curves, nameBoard.sources, board.calc),
              nameBoard,
            )
      namesRef.current = ensureNames(seed, nameBoard, () =>
        [
          ...sliderLetters(board.curves, board.exprSources, { ...MODELS, ...board.extraModels }),
          ...sequenceLetters(board.sequences),
        ],
      )
    }
    regWrittenRef.current = new Map()
    regAutoHiddenRef.current = new Set()
    cellFoldRef.current = null
    boardGridRef.current = board.grid
    figureStyleRef.current = board.figure
    figureCaptionRef.current = board.captionAuto ? null : board.caption
    polarOfferedRef.current = false
    calcSigRef.current = new Map()
    calcDomainRef.current = new Map()
    calcAutoHiddenRef.current = new Set()
    derivCounterRef.current = board.derivCounter
    editsRef.current = {}
    selectedRef.current = board.selectedId
    docMetaRef.current = meta
    noteRef.current = board.note ?? ''
    setDocNote(noteRef.current)
    exprCounterRef.current = board.exprCounter
    docStoredRef.current = false
    unsavedRef.current = false
    undoRef.current = []
    redoRef.current = []
    preEditRef.current = null
    setGesturing(false)
    skipAutosaveRef.current = true

    setCurves(board.curves)
    setItems(board.items)
    setKind(board.kind)
    setStyles(board.styles)
    setExprSources(board.exprSources)
    setBrokenExpr(board.brokenExpr)
    setDisplaySources(board.displaySources)
    setAxisUnitChoice(board.axisUnits)
    setCalcLinks(board.calc)
    setFields(board.fields)
    setShapes(board.shapes)
    setDataSets(board.data)
    setSequences(board.sequences)
    setUnitCircles(board.unitCircles)
    setRelatedRates(board.relatedRates)
    setRrPlay(null)
    setStats(board.stats)
    setStatsPlay(null)
    setIneqSystem(board.system)
    setUcPlay(null)
    setInverses(board.inverses)
    setCalls(callsRef.current)
    setNames(namesRef.current)
    setBoardGrid(board.grid)
    setFigureStyle(board.figure)
    setFigureCaption(board.captionAuto ? null : board.caption)
    // A view of the board, not a property of it: every document opens on the
    // theme, whatever the last one was being previewed in.
    setPreviewFigure(false)
    setArmedField(null)
    setEdits({})
    // The view settings the document stored — and nothing left over from the
    // document this tab had open before.
    writeViewStates(viewStatesFrom(board.curveViews, board.curves))
    {
      // One live model per inverse link, under its curve's model id.
      const inv: Record<string, ModelSpec> = {}
      for (const l of board.inverses) {
        const child = board.curves.find((c) => c.id === l.curveId)
        if (child) inv[child.modelId] = makeInverseSpec(child.modelId, l)
      }
      modelsRef.current = { ...MODELS, ...board.extraModels, ...inv }
      setExtraModels({ ...board.extraModels, ...inv })
    }
    setSelectedId(board.selectedId)
    setDocMeta(meta)
    bumpHistory((v) => v + 1)

    // A number line pans in x only, so its saved y is always 0 — force it, or
    // a document switched from a cartesian board would open with its line off
    // the top of the canvas.
    vpRef.current.center = {
      x: board.viewport.center.x,
      y: board.kind === 'number-line' ? 0 : board.viewport.center.y,
    }
    vpRef.current.pxPerUnit = board.viewport.pxPerUnit
    // Independent axes travel with the view. A polar ruling is only drawn on
    // equal axes, so a document that somehow says both opens square.
    if (board.viewport.pxPerUnitY !== undefined && board.grid !== 'polar') {
      vpRef.current.pxPerUnitY = board.viewport.pxPerUnitY
    } else {
      delete vpRef.current.pxPerUnitY
    }
    setAxesMode(axesModeOf(vpRef.current))
    viewSubsRef.current.forEach((fn) => fn())
    stageRef.current?.redraw()
    nlStageRef.current?.redraw()
  }, [])

  /**
   * Open the share link in `hash` (src/ui/shareOpen.ts) as a new, temporary
   * document. `fallback` runs when there is nothing to open (startup: restore
   * the last document); null means a board is already open — a link pasted
   * into the address bar of a running tab — and it must be kept safe first.
   */
  const openShareFromHash = useCallback(
    async (hash: string, fallback: (() => void) | null): Promise<void> => {
      const outcome = await openShare(hash, {
        load: (json) => deserializeDoc(json, { resolve: resolveName, singularities: singularOf }),
        newId: () => createDoc('Shared graph', emptyBoard()).id,
        now: () => Date.now(),
      })
      // Read once: a reload must not import it again (the document is in
      // memory now, and in the student's documents if they make a copy).
      try {
        window.history.replaceState(window.history.state, '', urlWithoutShare(window.location.href))
      } catch {
        /* a sandboxed frame may refuse; the link then simply re-opens on reload */
      }
      if (outcome.kind !== 'open') {
        fallback?.()
        if (outcome.kind === 'error') showToast(outcome.message, { ms: 7000 })
        return
      }
      if (fallback === null && !saveBeforeSwitch()) return
      // Reveal mode is one state per document (see revealByDocRef): seed this
      // one's, and the switch below picks it up.
      if (outcome.flags.reveal) revealByDocRef.current.set(outcome.meta.id, { ...REVEAL_OFF, on: true })
      applyHydrated(outcome.meta, outcome.board)
      setSharedState({ viewOnly: outcome.flags.view })
      docStoredRef.current = false
      hydratedRef.current = true
      setConflict(null)
      setSwitchBlocked(null)
      setSaveError(null)
      setSaveState('saved')
      setLoadNotice(outcome.problems.length > 0 ? { problems: outcome.problems, fatal: false } : null)
      if (outcome.flags.view) setSidebarOpen(false)
      setDocs(listDocs())
      // The banner says "Shared" already; the toast says what that means —
      // except in reveal mode, whose bar sits where the toast would.
      if (!outcome.flags.reveal) showToast(
        outcome.flags.view
          ? `Opened “${outcome.meta.name}” from a share link — view only. Make a copy to keep it.`
          : `Opened “${outcome.meta.name}” from a share link. It isn’t in your documents until you make a copy.`,
        { ms: 5000 },
      )
    },
    [applyHydrated, resolveName, saveBeforeSwitch, setSharedState, showToast, singularOf],
  )

  // Restore the last document on startup. Runs before any save is allowed —
  // unless the address carries a share link, which opens instead (and falls
  // back to this when the link is unreadable).
  useEffect(() => {
    if (parseShareHash(window.location.hash).kind === 'share') {
      void openShareFromHash(window.location.hash, restoreLast)
      return
    }
    restoreLast()
    function restoreLast(): void {
      const index = readIndex()
      const id = index.currentId ?? index.docs[0]?.id ?? null
      if (id) {
        const json = readDocJSON(id)
        if (json !== null) {
          const res = deserializeDoc(json, { resolve: resolveName, singularities: singularOf })
          if (res.meta && res.board) {
            applyHydrated(res.meta, res.board)
            docStoredRef.current = true
            if (res.problems.length > 0) {
              setLoadNotice({ problems: res.problems, fatal: false })
            }
            hydratedRef.current = true
            setCurrentDoc(res.meta.id)
            setDocs(listDocs())
            return
          }
          // Unreadable: keep the damaged record on disk (the user may want to
          // recover or export it) and start a new document so work can continue.
          setLoadNotice({ problems: res.problems, fatal: true })
        }
      }
      const doc = createDoc(nextDocName('cartesian', listDocs().map((d) => d.name)), emptyBoard())
      const meta: DocMeta = {
        id: doc.id,
        name: doc.name,
        createdAt: doc.createdAt,
        modifiedAt: doc.modifiedAt,
      }
      docMetaRef.current = meta
      setDocMeta(meta)
      hydratedRef.current = true
      // Not written yet — but claim it as current now, so a reload doesn't guess
      // from index order which document this tab was working on.
      docStoredRef.current = false
      setCurrentDoc(meta.id)
      setDocs(listDocs())
    }
    // Runs once, on mount: the share opener is stable for the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyHydrated])

  // A share link pasted into the address bar of a tab that is already open
  // changes only the fragment — no reload — so it is picked up here.
  useEffect(() => {
    const onHash = (): void => {
      if (parseShareHash(window.location.hash).kind === 'share') {
        void openShareFromHash(window.location.hash, null)
      }
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [openShareFromHash])

  // Leaving a shared document that has edits, by closing the tab: ask first.
  // (Switching documents inside the app keeps them as a copy instead.)
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent): void => {
      if (sharedRef.current && undoRef.current.length > 0) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  // Autosave: any board change schedules a debounced write. A board that is
  // still exactly what was just loaded is not a change.
  useEffect(() => {
    if (!hydratedRef.current) return
    // The load happens inside an effect, so this effect runs once more with the
    // pre-load values still in scope; that run is not a change either.
    if (skipAutosaveRef.current) {
      skipAutosaveRef.current = false
      return
    }
    const loaded = loadedStateRef.current
    if (
      loaded &&
      loaded.curves === curves &&
      loaded.items === items &&
      loaded.kind === kind &&
      loaded.styles === styles &&
      loaded.exprSources === exprSources &&
      loaded.displaySources === displaySources &&
      loaded.selectedId === selectedId &&
      loaded.name === docMeta.name
    ) {
      loadedStateRef.current = null
      return
    }
    loadedStateRef.current = null
    scheduleSave()
  }, [
    curves,
    items,
    kind,
    styles,
    exprSources,
    displaySources,
    // A units change is a change to the document, so it has to reach the same
    // debounced write everything else does.
    axisUnitChoice,
    // So is a calculus object. Moving a limit or changing n leaves the curves
    // untouched, so without this the change would be on screen and nowhere
    // else until the next thing a teacher happened to do.
    calcLinks,
    // And a slope field. Its equation, its constants, its spacing and its
    // initial conditions are the whole of it, and none of them touch a curve.
    fields,
    // And a shape, for exactly the same reason — a dragged vertex changes one
    // line of text and no curve at all.
    shapes,
    // And a data table: a typed cell changes no curve until the fit re-runs.
    dataSets,
    // And a sequence: its line, window and toggles touch no curve.
    sequences,
    // And the unit circle: θ, its switches, its question.
    unitCircles,
    // And the related-rates problem: its givens, t, its question.
    relatedRates,
    // And the statistics objects: μ, σ, bounds, a simulation's settings and seed.
    stats,
    // And the inequality system: its switches, test point and objective.
    ineqSystem,
    // And a rename, which may change nothing but a letter.
    names,
    calls,
    inverses,
    // And the ruling, which is a property of the document like the units.
    boardGrid,
    // And the look the figure is in, with its caption: both are the document's
    // and neither touches a curve, so without this a board restyled for an AP
    // handout would come back tomorrow as a screen board.
    figureStyle,
    figureCaption,
    // And a curve's view settings — a construction, a shaded polar area, a
    // factored curve's point. The key ignores the particle, so a playing
    // particle never schedules a write.
    curveViewsSig,
    selectedId,
    docMeta.name,
    scheduleSave,
  ])

  // Don't lose the debounce window to a closing tab or a backgrounded phone.
  useEffect(() => {
    const flush = (): void => {
      if (saveTimerRef.current) saveNow()
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [saveNow])

  /** Throw away what's in memory and take the stored version of this document. */
  const reloadCurrentDoc = useCallback((): void => {
    const id = docMetaRef.current.id
    const json = id ? readDocJSON(id) : null
    const res = json === null ? null : deserializeDoc(json, { resolve: resolveName, singularities: singularOf })
    if (!res || !res.meta || !res.board) {
      setLoadNotice({
        problems: res?.problems ?? ['That document is no longer in storage.'],
        fatal: true,
      })
      return
    }
    applyHydrated(res.meta, res.board)
    docStoredRef.current = true
    setConflict(null)
    setSwitchBlocked(null)
    setSaveState('saved')
    setSaveError(null)
    setDocs(listDocs())
  }, [applyHydrated])

  // Cross-tab awareness. localStorage is shared, so another tab can save over,
  // or delete, the document this one is showing. Without this the Documents
  // list went stale (listing deleted documents, missing new ones) and a tab
  // could sit on a board that exists nowhere while its badge read "saved".
  useEffect(() => {
    const onStorage = (e: StorageEvent): void => {
      if (!isGrapherKey(e.key)) return
      setDocs(listDocs())
      const meta = docMetaRef.current
      if (!meta.id || !docStoredRef.current) return
      const stamp = readDocStamp(meta.id)
      if (!stamp.exists) setConflict('deleted')
      else if (stamp.modifiedAt > meta.modifiedAt) setConflict('stale')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return {
    blankBoard, currentBoardInput, saveNow, saveBeforeSwitch, scheduleSave, applyHydrated,
    reloadCurrentDoc, docNote,
  }
}

export type DocumentPersistenceApi = ReturnType<typeof useDocumentPersistence>

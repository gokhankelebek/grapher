import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FitResult, FittedCurve, ModelSpec, ProcessedStroke, Viewport } from './core/types'
import { CURVE_COLORS, DARK_THEME, LIGHT_THEME, nextId } from './core/types'
import { MODELS } from './core/fit/models'
import { parseExpression } from './core/parse'
import { applyFeatureEdit, snapParams } from './core/fit/edit'
import { analyzeCurve } from './core/analyze'
import type { FeatureEditResult, SpecialPoint } from './core/types'
import { describePoints } from './ui/featureEdit'
import { CanvasStage } from './ui/CanvasStage'
import type { CanvasStageHandle } from './ui/CanvasStage'
import { Toolbar } from './ui/Toolbar'
import { Sidebar } from './ui/Sidebar'
import { DocMenu } from './ui/DocMenu'
import type { SaveState } from './ui/DocMenu'
import { ExportMenu } from './ui/ExportMenu'
import type { CopyState } from './ui/ExportMenu'
import {
  DEFAULT_EXPORT,
  canvasToPngBlob,
  clampExportSettings,
  exportGeometry,
  exportTheme,
  renderBoardToCanvas,
} from './ui/renderBoard'
import type { BoardScene, ExportSettings } from './ui/renderBoard'
import {
  createDoc,
  deserializeDoc,
  docFromBoard,
  emptyBoard,
  serializeDoc,
} from './core/persist'
import type { BoardInput, DocMeta, HydratedBoard } from './core/persist'
import {
  isGrapherKey,
  listDocs,
  readDocJSON,
  readDocStamp,
  readIndex,
  readExportSettings,
  readPrefs,
  removeDoc,
  setCurrentDoc,
  updatePrefs,
  usedBytes,
  writeDoc,
  writeExportSettings,
} from './ui/storage'
import type { SaveOutcome } from './ui/storage'

export type Mode = 'draw' | 'pan'

/** Per-curve style extras FittedCurve doesn't carry (kept in a parallel map). */
export type { CurveStyle, StyleMap } from './core/persist'
import type { CurveStyle, StyleMap } from './core/persist'

/** How long the board sits idle before it is written to storage. */
const AUTOSAVE_MS = 400

/** Stable identity — avoids re-rendering the canvas when markers are hidden. */
const EMPTY_ANALYSIS: SpecialPoint[] = []

/**
 * One undo/redo history entry.
 *
 * exprSources/brokenExpr/candidates belong in here, not beside it: a typed
 * equation's source text is the ONLY thing that can rebuild its model closure
 * after a reload, so a snapshot that restored the curve but not its source
 * produced a curve that looked fine until the next load and then came back dead
 * (labelled "expr_1", drawing nothing, with no warning — persist.ts only renders
 * its "can't restore" card when a source IS present).
 */
interface Snapshot {
  curves: FittedCurve[]
  styles: StyleMap
  exprSources: Record<string, string>
  brokenExpr: Record<string, string>
  candidates: Map<string, FitResult[]>
}

/** The board-state slice any mutation may change; omitted keys are untouched. */
interface StatePatch {
  curves?: FittedCurve[]
  styles?: StyleMap
  exprSources?: Record<string, string>
  brokenExpr?: Record<string, string>
  candidates?: Map<string, FitResult[]>
}

const MIN_PPU = 0.001
const MAX_PPU = 100000
const HISTORY_LIMIT = 100

const clampPpu = (v: number): number => Math.min(MAX_PPU, Math.max(MIN_PPU, v))

export default function App() {
  const [curves, setCurves] = useState<FittedCurve[]>([])
  const [styles, setStyles] = useState<StyleMap>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('draw')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [drawingActive, setDrawingActive] = useState(false)
  const [exprOpen, setExprOpen] = useState(false)
  const [extraModels, setExtraModels] = useState<Record<string, ModelSpec>>({})
  const [snapFlash, setSnapFlash] = useState<{ id: string; mask: boolean[]; key: number } | null>(
    null,
  )
  const [shake, setShake] = useState<{ id: string; key: number } | null>(null)
  const [toast, setToast] = useState<{ msg: string; key: number } | null>(null)
  const [, bumpHistory] = useState(0)

  // ---- documents / persistence
  const [docMeta, setDocMeta] = useState<DocMeta>(() => ({
    id: '',
    name: 'Untitled',
    createdAt: Date.now(),
    modifiedAt: Date.now(),
  }))
  const [docs, setDocs] = useState<DocMeta[]>([])
  const [saveState, setSaveState] = useState<SaveState>('saved')
  /** Sticky banner for a failed save (quota) — must not be missable. */
  const [saveError, setSaveError] = useState<string | null>(null)
  /** Set when the last load lost or repaired something. */
  const [loadNotice, setLoadNotice] = useState<{ problems: string[]; fatal: boolean } | null>(null)
  /** Another tab changed or deleted the document this tab has open. */
  const [conflict, setConflict] = useState<'stale' | 'deleted' | null>(null)
  /** Set when a document switch was refused because this board isn't saved. */
  const [switchBlocked, setSwitchBlocked] = useState<string | null>(null)
  /** curveId -> the equation text the user typed (rebuilt into models on load). */
  const [exprSources, setExprSources] = useState<Record<string, string>>({})
  /** curveId -> why its equation could not be restored. */
  const [brokenExpr, setBrokenExpr] = useState<Record<string, string>>({})
  const [dropActive, setDropActive] = useState(false)

  // ---- curve analysis (zeros, extrema, inflections)
  const [showAnalysis, setShowAnalysis] = useState<boolean>(() => readPrefs().showAnalysis)
  /**
   * Ground the ON-SCREEN canvas is drawn on. Dark by default — the export has
   * its own, independent setting, because the two are answering different
   * questions ("what do I want to look at" vs "what goes on the paper").
   */
  const [canvasTheme, setCanvasTheme] = useState<'dark' | 'light'>(() => readPrefs().canvasTheme)
  const [exportSettings, setExportSettings] = useState<ExportSettings>(() => ({
    ...readPrefs().exportDefaults,
  }))
  const [copyState, setCopyState] = useState<CopyState>({ kind: 'idle' })
  /** Index into the analysis array whose marker should be emphasised. */
  const [highlight, setHighlight] = useState<number | null>(null)
  /**
   * The board's answer to the last feature edit. A refusal is the solver's own
   * sentence, shown verbatim and left up until it is dismissed or superseded; a
   * side-effect report says what else moved and fades on its own. Never modal —
   * the teacher keeps typing either way.
   */
  const [featureNote, setFeatureNote] = useState<
    | {
        kind: 'refused'
        key: number
        reason: string
        nearest?: { curveId: string; params: number[]; domain: [number, number] | null }
      }
    | { kind: 'moved'; key: number; text: string }
    | null
  >(null)
  const featureNoteTimerRef = useRef(0)

  const curvesRef = useRef<FittedCurve[]>([])
  const stylesRef = useRef<StyleMap>({})
  const selectedRef = useRef<string | null>(null)
  const undoRef = useRef<Snapshot[]>([])
  const redoRef = useRef<Snapshot[]>([])
  const preEditRef = useRef<Snapshot | null>(null)
  const candidatesRef = useRef<Map<string, FitResult[]>>(new Map())
  const exprCounterRef = useRef(0)
  const altRef = useRef(false)
  const snapTimerRef = useRef(0)
  const shakeTimerRef = useRef(0)
  const toastTimerRef = useRef(0)
  const exprSourcesRef = useRef<Record<string, string>>({})
  const brokenExprRef = useRef<Record<string, string>>({})
  const docMetaRef = useRef<DocMeta>(docMeta)
  const saveTimerRef = useRef(0)
  /** Nothing may be written until the stored document has been read in. */
  const hydratedRef = useRef(false)
  /**
   * True once the open document actually exists in storage (loaded from it, or
   * written at least once). Only then can "the record is gone" mean another tab
   * deleted it rather than "we haven't saved it yet".
   */
  const docStoredRef = useRef(false)
  /** Skips the one autosave run that happens in the same pass as a load. */
  const skipAutosaveRef = useRef(false)
  /**
   * The exact state a load put on the board. While the board is still identical
   * to it, autosave stays quiet: re-writing a document just because it was
   * opened bumped its modifiedAt for no reason, which — now that writes are
   * checked against the stored stamp — made merely opening a second tab report
   * a conflict in the first.
   */
  const loadedStateRef = useRef<{
    curves: FittedCurve[]
    styles: StyleMap
    exprSources: Record<string, string>
    selectedId: string | null
    mode: Mode
    name: string
  } | null>(null)

  const models = useMemo<Record<string, ModelSpec>>(
    () => ({ ...MODELS, ...extraModels }),
    [extraModels],
  )
  const modelsRef = useRef(models)
  modelsRef.current = models
  selectedRef.current = selectedId
  const modeRef = useRef<Mode>(mode)
  modeRef.current = mode

  const selectedCurve = useMemo(
    () => curves.find((c) => c.id === selectedId) ?? null,
    [curves, selectedId],
  )

  // Value-based key: re-analyze only when the curve's shape actually changes,
  // so unrelated re-renders (hover, save state, toasts) never pay the cost.
  const analysisKey = selectedCurve
    ? `${selectedCurve.id}|${selectedCurve.modelId}|${selectedCurve.params.join(',')}|${
        selectedCurve.domain ? selectedCurve.domain.join(',') : ''
      }`
    : ''

  const analysisRef = useRef<SpecialPoint[]>([])

  const analysis = useMemo<SpecialPoint[]>(() => {
    if (!selectedCurve) return []
    try {
      const pts = analyzeCurve(selectedCurve, models)
      return Array.isArray(pts) ? pts : []
    } catch {
      // An un-analyzable family must never take the board down.
      return []
    }
    // selectedCurve is intentionally tracked through analysisKey, not identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisKey, models])
  analysisRef.current = analysis

  const vpRef = useRef<Viewport>({
    center: { x: 0, y: 0 },
    pxPerUnit: 60,
    widthPx: 800,
    heightPx: 600,
  })
  const stageRef = useRef<CanvasStageHandle>(null)

  // ------------------------------------------------------------ state/history
  const takeSnapshot = useCallback(
    (): Snapshot => ({
      curves: curvesRef.current,
      styles: stylesRef.current,
      exprSources: exprSourcesRef.current,
      brokenExpr: brokenExprRef.current,
      candidates: candidatesRef.current,
    }),
    [],
  )

  const applyState = useCallback((s: StatePatch): void => {
    if (s.curves) {
      curvesRef.current = s.curves
      setCurves(s.curves)
    }
    if (s.styles) {
      stylesRef.current = s.styles
      setStyles(s.styles)
    }
    if (s.exprSources) {
      exprSourcesRef.current = s.exprSources
      setExprSources(s.exprSources)
    }
    if (s.brokenExpr) {
      brokenExprRef.current = s.brokenExpr
      setBrokenExpr(s.brokenExpr)
    }
    // Replaced wholesale, never mutated in place, so snapshots stay immutable.
    if (s.candidates) candidatesRef.current = s.candidates
  }, [])

  /** Apply new state and push the previous snapshot onto the undo stack. */
  const commitState = useCallback(
    (s: StatePatch): void => {
      undoRef.current = [...undoRef.current.slice(-(HISTORY_LIMIT - 1)), takeSnapshot()]
      redoRef.current = []
      applyState(s)
      bumpHistory((v) => v + 1)
    },
    [applyState, takeSnapshot],
  )

  const undo = useCallback((): void => {
    const stack = undoRef.current
    if (stack.length === 0) return
    // Any answer on screen was about the state we are leaving.
    window.clearTimeout(featureNoteTimerRef.current)
    setFeatureNote(null)
    const prev = stack[stack.length - 1]
    undoRef.current = stack.slice(0, -1)
    redoRef.current = [...redoRef.current, takeSnapshot()]
    applyState(prev)
    bumpHistory((v) => v + 1)
    setSelectedId((sel) => (sel && prev.curves.some((c) => c.id === sel) ? sel : null))
  }, [applyState, takeSnapshot])

  const redo = useCallback((): void => {
    const stack = redoRef.current
    if (stack.length === 0) return
    window.clearTimeout(featureNoteTimerRef.current)
    setFeatureNote(null)
    const next = stack[stack.length - 1]
    redoRef.current = stack.slice(0, -1)
    undoRef.current = [...undoRef.current, takeSnapshot()]
    applyState(next)
    bumpHistory((v) => v + 1)
    setSelectedId((sel) => (sel && next.curves.some((c) => c.id === sel) ? sel : null))
  }, [applyState, takeSnapshot])

  // Live-edit bracket: capture once at edit start, commit once at edit end.
  const editStart = useCallback((): void => {
    if (!preEditRef.current) preEditRef.current = takeSnapshot()
  }, [takeSnapshot])

  const editEnd = useCallback((): void => {
    const pre = preEditRef.current
    preEditRef.current = null
    if (pre && (pre.curves !== curvesRef.current || pre.styles !== stylesRef.current)) {
      undoRef.current = [...undoRef.current.slice(-(HISTORY_LIMIT - 1)), pre]
      redoRef.current = []
      bumpHistory((v) => v + 1)
    }
  }, [])

  /** Abort the live edit bracket, reverting to the pre-edit state (no history). */
  const editCancel = useCallback((): void => {
    const pre = preEditRef.current
    preEditRef.current = null
    if (pre) applyState(pre)
  }, [applyState])

  /** Commit the edit bracket, magnetizing params to nice values first.
   *  Snaps only while a bracket is actually open, and never when Alt is held. */
  const commitWithSnap = useCallback(
    (curveId: string | null, skipSnap: boolean): void => {
      if (curveId && !skipSnap && !altRef.current && preEditRef.current) {
        const c = curvesRef.current.find((cv) => cv.id === curveId)
        if (c) {
          try {
            const spec = modelsRef.current[c.modelId]
            const res = spec
              ? snapParams(c.modelId, c.params, {
                  spec,
                  domain: c.domain,
                  error: c.error,
                })
              : null
            if (res && res.snapped.some(Boolean)) {
              applyState({
                curves: curvesRef.current.map((cv) =>
                  cv.id === curveId ? { ...cv, params: res.params.slice() } : cv,
                ),
              })
              window.clearTimeout(snapTimerRef.current)
              setSnapFlash({ id: curveId, mask: res.snapped, key: Date.now() })
              snapTimerRef.current = window.setTimeout(() => setSnapFlash(null), 600)
            }
          } catch {
            /* snapping is best-effort */
          }
        }
      }
      editEnd()
    },
    [applyState, editEnd],
  )

  // Track Alt so slider/nudge commits can honor "hold Alt to skip snapping".
  useEffect(() => {
    const onDown = (e: KeyboardEvent): void => {
      if (e.key === 'Alt') altRef.current = true
    }
    const onUp = (e: KeyboardEvent): void => {
      if (e.key === 'Alt') altRef.current = false
    }
    const onBlur = (): void => {
      altRef.current = false
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // ======================================================= documents / saving
  const blankBoard = useCallback(
    (): HydratedBoard => ({
      curves: [],
      styles: {},
      candidates: new Map(),
      extraModels: {},
      exprSources: {},
      brokenExpr: {},
      viewport: { center: { x: 0, y: 0 }, pxPerUnit: 60 },
      selectedId: null,
      mode: 'draw',
      exprCounter: 0,
    }),
    [],
  )

  /** Everything the serializer needs, read from the live refs. */
  const currentBoardInput = useCallback(
    (): BoardInput => ({
      curves: curvesRef.current,
      styles: stylesRef.current,
      candidates: candidatesRef.current,
      exprSources: exprSourcesRef.current,
      viewport: { center: vpRef.current.center, pxPerUnit: vpRef.current.pxPerUnit },
      selectedId: selectedRef.current,
      mode: modeRef.current,
    }),
    [],
  )

  /**
   * Write the board now. Returns the outcome — callers that are about to
   * REPLACE the board must not proceed on a failure, or the only copy of the
   * unsaved work is gone.
   */
  const saveNow = useCallback((): SaveOutcome => {
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
        ? `${outcome.message} Grapher is using about ${kb}KB. Export this document to a file, or delete documents you no longer need, then edit again to retry.`
        : outcome.message,
    )
    return outcome
  }, [currentBoardInput])

  /**
   * Save before swapping the board away. False means the swap must be
   * abandoned: the work on screen exists nowhere else.
   */
  const saveBeforeSwitch = useCallback((): boolean => {
    const res = saveNow()
    if (res.ok) return true
    setSwitchBlocked(
      'conflict' in res
        ? `${res.message} Nothing was switched, so this board is still here. Export it to a file, or reload the other tab’s version, before moving on.`
        : 'This document could not be saved, so switching would have thrown the work away. Export it to a file first.',
    )
    return false
  }, [saveNow])

  const scheduleSave = useCallback((): void => {
    if (!hydratedRef.current) return
    setSaveState('saving')
    window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(saveNow, AUTOSAVE_MS)
  }, [saveNow])

  /** Swap the whole board over to a freshly loaded document. */
  const applyHydrated = useCallback((meta: DocMeta, board: HydratedBoard): void => {
    loadedStateRef.current = {
      curves: board.curves,
      styles: board.styles,
      exprSources: board.exprSources,
      selectedId: board.selectedId,
      mode: board.mode,
      name: meta.name,
    }
    curvesRef.current = board.curves
    stylesRef.current = board.styles
    candidatesRef.current = board.candidates
    exprSourcesRef.current = board.exprSources
    brokenExprRef.current = board.brokenExpr
    selectedRef.current = board.selectedId
    modeRef.current = board.mode
    docMetaRef.current = meta
    exprCounterRef.current = board.exprCounter
    docStoredRef.current = false
    undoRef.current = []
    redoRef.current = []
    preEditRef.current = null
    skipAutosaveRef.current = true

    setCurves(board.curves)
    setStyles(board.styles)
    setExprSources(board.exprSources)
    setBrokenExpr(board.brokenExpr)
    setExtraModels(board.extraModels)
    setSelectedId(board.selectedId)
    setMode(board.mode)
    setDocMeta(meta)
    bumpHistory((v) => v + 1)

    vpRef.current.center = { x: board.viewport.center.x, y: board.viewport.center.y }
    vpRef.current.pxPerUnit = board.viewport.pxPerUnit
    stageRef.current?.redraw()
  }, [])

  // Restore the last document on startup. Runs before any save is allowed.
  useEffect(() => {
    const index = readIndex()
    const id = index.currentId ?? index.docs[0]?.id ?? null
    if (id) {
      const json = readDocJSON(id)
      if (json !== null) {
        const res = deserializeDoc(json)
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
    const doc = createDoc('Untitled', emptyBoard())
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
  }, [applyHydrated])

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
      loaded.styles === styles &&
      loaded.exprSources === exprSources &&
      loaded.selectedId === selectedId &&
      loaded.mode === mode &&
      loaded.name === docMeta.name
    ) {
      loadedStateRef.current = null
      return
    }
    loadedStateRef.current = null
    scheduleSave()
  }, [curves, styles, exprSources, selectedId, mode, docMeta.name, scheduleSave])

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
    const res = json === null ? null : deserializeDoc(json)
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

  const renameDoc = useCallback((name: string): void => {
    const next = { ...docMetaRef.current, name }
    docMetaRef.current = next
    setDocMeta(next)
  }, [])

  const newDocument = useCallback((): void => {
    // Refuse to replace the board when the work on it isn't on disk.
    if (!saveBeforeSwitch()) return
    const doc = createDoc('Untitled', emptyBoard())
    const meta: DocMeta = {
      id: doc.id,
      name: doc.name,
      createdAt: doc.createdAt,
      modifiedAt: doc.modifiedAt,
    }
    applyHydrated(meta, blankBoard())
    setLoadNotice(null)
    setConflict(null)
    docStoredRef.current = writeDoc(doc).ok
    setCurrentDoc(meta.id)
    setDocs(listDocs())
  }, [applyHydrated, blankBoard, saveBeforeSwitch])

  const openDocument = useCallback(
    (id: string): void => {
      if (id === docMetaRef.current.id) return
      if (!saveBeforeSwitch()) return
      const json = readDocJSON(id)
      const res = json === null ? null : deserializeDoc(json)
      if (!res || !res.meta || !res.board) {
        setLoadNotice({
          problems: res?.problems ?? ['That document could not be found.'],
          fatal: true,
        })
        return
      }
      applyHydrated(res.meta, res.board)
      docStoredRef.current = true
      setConflict(null)
      setLoadNotice(res.problems.length > 0 ? { problems: res.problems, fatal: false } : null)
      setCurrentDoc(res.meta.id)
      setDocs(listDocs())
    },
    [applyHydrated, saveBeforeSwitch],
  )

  /**
   * Re-target the board in memory at a brand-new document record and write it.
   * Used both by Duplicate and by the "save a copy" escape from a cross-tab
   * conflict, where the current record must not be overwritten.
   */
  const saveBoardAsNewDoc = useCallback(
    (name: string): boolean => {
      const fresh = createDoc(name, emptyBoard())
      const meta: DocMeta = {
        id: fresh.id,
        name: fresh.name,
        createdAt: fresh.createdAt,
        modifiedAt: fresh.modifiedAt,
      }
      const doc = docFromBoard(meta, currentBoardInput())
      const res = writeDoc(doc)
      if (!res.ok) {
        setSaveState('error')
        if (!('conflict' in res)) setSaveError(res.message)
        return false
      }
      // Keep the stamp we just wrote, or the next autosave reads storage as
      // "newer than us" and reports a conflict against our own write.
      docMetaRef.current = { ...meta, modifiedAt: doc.modifiedAt }
      docStoredRef.current = true
      setDocMeta(meta)
      setCurrentDoc(meta.id)
      setDocs(listDocs())
      setSaveState('saved')
      setSaveError(null)
      setConflict(null)
      setSwitchBlocked(null)
      return true
    },
    [currentBoardInput],
  )

  const duplicateDocument = useCallback((): void => {
    if (!saveBeforeSwitch()) return
    saveBoardAsNewDoc(`${docMetaRef.current.name} copy`)
  }, [saveBeforeSwitch, saveBoardAsNewDoc])

  const deleteDocument = useCallback(
    (id: string): void => {
      removeDoc(id)
      const remaining = listDocs()
      setDocs(remaining)
      if (id !== docMetaRef.current.id) return
      const next = remaining[0]
      if (next) {
        const json = readDocJSON(next.id)
        const res = json === null ? null : deserializeDoc(json)
        if (res?.meta && res.board) {
          applyHydrated(res.meta, res.board)
          docStoredRef.current = true
          setConflict(null)
          setLoadNotice(res.problems.length > 0 ? { problems: res.problems, fatal: false } : null)
          setCurrentDoc(res.meta.id)
          return
        }
      }
      newDocument()
    },
    [applyHydrated, newDocument],
  )

  const toggleAnalysis = useCallback((): void => {
    setShowAnalysis((v) => {
      const next = !v
      updatePrefs({ showAnalysis: next })
      return next
    })
  }, [])

  const exportDocument = useCallback((): void => {
    const meta = docMetaRef.current
    const json = serializeDoc(docFromBoard(meta, currentBoardInput()))
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const safe = meta.name.replace(/[^\w\d\-. ]+/g, '_').trim() || 'grapher'
    const a = document.createElement('a')
    a.href = url
    a.download = `${safe}.grapher.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [currentBoardInput])

  const importDocument = useCallback(
    (file: File): void => {
      file
        .text()
        .then((text) => {
          const res = deserializeDoc(text)
          if (!res.board || !res.meta) {
            setLoadNotice({
              problems: res.problems.length ? res.problems : ['That file could not be read.'],
              fatal: true,
            })
            return
          }
          // The import replaces the board, so the board it replaces must be
          // safely on disk first.
          if (!saveBeforeSwitch()) return
          // Always mint a new id so an import can never overwrite a document
          // that happens to share an id with the file.
          const fallback = file.name.replace(/\.(grapher\.)?json$/i, '')
          const fresh = createDoc(res.meta.name || fallback || 'Imported', emptyBoard())
          const meta: DocMeta = {
            id: fresh.id,
            name: fresh.name,
            createdAt: res.meta.createdAt || fresh.createdAt,
            modifiedAt: Date.now(),
          }
          applyHydrated(meta, res.board)
          setConflict(null)
          setLoadNotice(res.problems.length > 0 ? { problems: res.problems, fatal: false } : null)
          const doc = docFromBoard(meta, currentBoardInput())
          const written = writeDoc(doc)
          if (written.ok) {
            docMetaRef.current = { ...meta, modifiedAt: doc.modifiedAt }
            docStoredRef.current = true
            setSaveState('saved')
          } else {
            docStoredRef.current = false
            setSaveState('error')
            if (!('conflict' in written)) setSaveError(written.message)
          }
          setCurrentDoc(meta.id)
          setDocs(listDocs())
        })
        .catch(() => {
          setLoadNotice({ problems: ['That file could not be read.'], fatal: true })
        })
    },
    [applyHydrated, currentBoardInput, saveBeforeSwitch],
  )

  // -------------------------------------------------------------- curve CRUD
  const pickColor = useCallback((): string => {
    const used = new Set(curvesRef.current.map((c) => c.color))
    for (const color of CURVE_COLORS) {
      if (!used.has(color)) return color
    }
    return CURVE_COLORS[curvesRef.current.length % CURVE_COLORS.length]
  }, [])

  const handleStrokeRecognized = useCallback(
    (processed: ProcessedStroke, results: FitResult[]): FittedCurve | null => {
      const best = results[0]
      if (!best) return null
      const curve: FittedCurve = {
        id: nextId(),
        modelId: best.modelId,
        params: best.params.slice(),
        kind: best.kind,
        domain: best.domain,
        color: pickColor(),
        strokeWidth: 2.5,
        visible: true,
        sourceStroke: processed.points,
        error: best.error,
      }
      commitState({
        curves: [...curvesRef.current, curve],
        candidates: new Map(candidatesRef.current).set(curve.id, results),
      })
      setSelectedId(curve.id)
      return curve
    },
    [commitState, pickColor],
  )

  const deleteCurve = useCallback(
    (id: string): void => {
      const { [id]: _gone, ...restStyles } = stylesRef.current
      const { [id]: _src, ...restSources } = exprSourcesRef.current
      const { [id]: _broken, ...restBroken } = brokenExprRef.current
      // Everything the curve owns goes through commitState in one call, so the
      // snapshot it pushes still holds the equation text that rebuilds it.
      commitState({
        curves: curvesRef.current.filter((c) => c.id !== id),
        styles: restStyles,
        exprSources: restSources,
        brokenExpr: restBroken,
      })
      setSelectedId((sel) => (sel === id ? null : sel))
    },
    [commitState],
  )

  const clearAll = useCallback((): void => {
    if (curvesRef.current.length === 0) return
    commitState({ curves: [], styles: {}, exprSources: {}, brokenExpr: {} })
    setSelectedId(null)
  }, [commitState])

  const toggleVisible = useCallback(
    (id: string): void => {
      commitState({
        curves: curvesRef.current.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c)),
      })
    },
    [commitState],
  )

  const cycleColor = useCallback(
    (id: string): void => {
      commitState({
        curves: curvesRef.current.map((c) => {
          if (c.id !== id) return c
          const idx = CURVE_COLORS.indexOf(c.color)
          const next = CURVE_COLORS[(idx + 1 + CURVE_COLORS.length) % CURVE_COLORS.length]
          return { ...c, color: next }
        }),
      })
    },
    [commitState],
  )

  const setParam = useCallback(
    (id: string, index: number, value: number): void => {
      applyState({
        curves: curvesRef.current.map((c) =>
          c.id === id
            ? { ...c, params: c.params.map((p, i) => (i === index ? value : p)) }
            : c,
        ),
      })
    },
    [applyState],
  )

  const applyCandidate = useCallback(
    (id: string, cand: FitResult): void => {
      commitState({
        curves: curvesRef.current.map((c) =>
          c.id === id
            ? {
                ...c,
                modelId: cand.modelId,
                params: cand.params.slice(),
                kind: cand.kind,
                domain: cand.domain,
                error: cand.error,
              }
            : c,
        ),
      })
    },
    [commitState],
  )

  const candidatesFor = useCallback(
    (id: string): FitResult[] => candidatesRef.current.get(id) ?? [],
    [],
  )

  // ----------------------------------------------------- drag / nudge editing
  /** Live param+stroke update during a canvas drag (history handled by editStart/End). */
  const dragCurveLive = useCallback(
    (id: string, params: number[], stroke?: { x: number; y: number }[]): void => {
      applyState({
        curves: curvesRef.current.map((c) =>
          c.id === id ? { ...c, params, ...(stroke ? { sourceStroke: stroke } : {}) } : c,
        ),
      })
    },
    [applyState],
  )

  /** Live param+domain update during a handle drag. */
  const handleDragLive = useCallback(
    (id: string, params: number[], domain: [number, number] | null): void => {
      applyState({
        curves: curvesRef.current.map((c) => (c.id === id ? { ...c, params, domain } : c)),
      })
    },
    [applyState],
  )

  /** Successful oversketch refit: one undoable commit. */
  const oversketchApply = useCallback(
    (id: string, params: number[], error: number): void => {
      commitState({
        curves: curvesRef.current.map((c) => (c.id === id ? { ...c, params, error } : c)),
      })
    },
    [commitState],
  )

  /** A brief, non-modal message at the foot of the board. */
  const showToast = useCallback((msg: string, ms = 3600): void => {
    window.clearTimeout(toastTimerRef.current)
    setToast({ msg, key: Date.now() })
    toastTimerRef.current = window.setTimeout(() => setToast(null), ms)
  }, [])

  /** Oversketch couldn't blend the stroke: shake the card, brief toast. */
  const oversketchFail = useCallback((id: string): void => {
    window.clearTimeout(shakeTimerRef.current)
    window.clearTimeout(toastTimerRef.current)
    window.clearTimeout(featureNoteTimerRef.current)
    setFeatureNote(null)
    const key = Date.now()
    setShake({ id, key })
    setToast({ msg: 'Couldn’t blend that stroke', key })
    shakeTimerRef.current = window.setTimeout(() => setShake(null), 500)
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2000)
  }, [])

  /** Exact value typed into a card readout: one undoable commit, no snapping. */
  const setParamExact = useCallback(
    (id: string, index: number, value: number): void => {
      commitState({
        curves: curvesRef.current.map((c) =>
          c.id === id
            ? { ...c, params: c.params.map((p, i) => (i === index ? value : p)) }
            : c,
        ),
      })
    },
    [commitState],
  )

  // -------------------------------------------------------- feature editing
  //
  // "Put this zero at x = −2." The teacher states a fact about the curve and
  // the solver decides whether the family can honour it. Three outcomes, all of
  // which must reach the teacher:
  //   ok            — one undoable commit, and NO snapParams (see below).
  //   ok + alsoMoved— the same commit, plus a report of what else shifted.
  //   refused       — nothing changes; the solver's own sentence is shown.

  /** Only one answer is on screen at a time — both reply to the last action. */
  const showFeatureNote = useCallback(
    (note: typeof featureNote): void => {
      window.clearTimeout(featureNoteTimerRef.current)
      window.clearTimeout(toastTimerRef.current)
      setToast(null)
      setFeatureNote(note)
      if (note && note.kind === 'moved') {
        featureNoteTimerRef.current = window.setTimeout(() => setFeatureNote(null), 5200)
      }
    },
    [],
  )

  /**
   * Returns true when the curve actually changed (the caller closes its editor)
   * and false when it did not, so a refusal leaves the typed value on screen.
   */
  const applyFeature = useCallback(
    (curveId: string, point: SpecialPoint, to: { x?: number; y?: number }): boolean => {
      const curve = curvesRef.current.find((c) => c.id === curveId)
      if (!curve) return true

      const refuse = (reason: string): boolean => {
        showFeatureNote({ kind: 'refused', key: Date.now(), reason })
        return false
      }

      /**
       * Hold the point's SIBLINGS OF THE SAME KIND still.
       *
       * Without this, "set the zeros to −2, 1, 3" never converges: each edit is
       * free to slide the other two, so fixing the second undoes the first and
       * the teacher chases the numbers around forever. Same-kind is the pin rule
       * a teacher already has in their head — "these zeros stay, move this one" —
       * and it is the only one that makes the three-in-a-row workflow terminate.
       * Cross-kind pinning is deliberately NOT attempted: a cubic's maximum,
       * minimum and inflection are not independent, and pretending otherwise
       * would manufacture refusals the family never actually earned. The solver
       * drops the pins itself when honouring them would over-determine the curve.
       */
      // analysisRef holds the SELECTED curve's points only, so pin from it only
      // when that is the curve being edited.
      const pinned =
        curveId === selectedRef.current
          ? analysisRef.current.filter((p) => p !== point && p.kind === point.kind)
          : []

      let res: FeatureEditResult
      try {
        res = applyFeatureEdit(curve, modelsRef.current, {
          point,
          to,
          ...(pinned.length > 0 ? { pinned } : {}),
        })
      } catch {
        return refuse('That change couldn’t be worked out for this curve.')
      }
      if (!res || typeof res !== 'object' || typeof res.ok !== 'boolean') {
        return refuse('That change couldn’t be worked out for this curve.')
      }

      if (!res.ok) {
        // The reason is written for a teacher and is shown WORD FOR WORD; the
        // fallback exists only for a solver that returned no sentence at all.
        const reason =
          typeof res.reason === 'string' && res.reason.trim() !== ''
            ? res.reason
            : 'That isn’t something this curve can do.'
        const near = res.nearest
        showFeatureNote({
          kind: 'refused',
          key: Date.now(),
          reason,
          // Offered as a choice, never applied behind the teacher's back.
          ...(near && Array.isArray(near.params)
            ? { nearest: { curveId, params: near.params.slice(), domain: near.domain } }
            : {}),
        })
        return false
      }

      if (!Array.isArray(res.params) || res.params.some((p) => !Number.isFinite(p))) {
        return refuse('That change couldn’t be worked out for this curve.')
      }

      // ONE undo entry, and deliberately no snapParams: the teacher stated an
      // exact fact, exactly as with a typed coordinate. Magnetizing "x = −2" to
      // something rounder would destroy the very thing that was just asserted —
      // the same inversion HandleInput.tsx documents for typed values.
      commitState({
        curves: curvesRef.current.map((c) =>
          c.id === curveId ? { ...c, params: res.params.slice(), domain: res.domain } : c,
        ),
      })

      const moved = Array.isArray(res.alsoMoved) ? res.alsoMoved : []
      const parts: string[] = []
      if (moved.length > 0) {
        const text = describePoints(moved)
        if (text) parts.push(`Also moved: ${text}`)
      }
      if (res.exact === false) parts.push('Placed as closely as this family allows.')
      showFeatureNote(
        parts.length > 0 ? { kind: 'moved', key: Date.now(), text: parts.join(' · ') } : null,
      )
      return true
    },
    [commitState, showFeatureNote],
  )

  /** Card readout path: the index is into the selected curve's analysis. */
  const applyFeatureByIndex = useCallback(
    (curveId: string, index: number, to: { x?: number; y?: number }): boolean => {
      if (curveId !== selectedRef.current) return true
      const point = analysisRef.current[index]
      if (!point) return true
      return applyFeature(curveId, point, to)
    },
    [applyFeature],
  )

  /** The explicit "yes, take the nearest one" — its own undo entry. */
  const applyNearestFeature = useCallback((): void => {
    const note = featureNote
    if (!note || note.kind !== 'refused' || !note.nearest) return
    const { curveId, params, domain } = note.nearest
    setFeatureNote(null)
    if (!curvesRef.current.some((c) => c.id === curveId)) return
    commitState({
      curves: curvesRef.current.map((c) =>
        c.id === curveId ? { ...c, params: params.slice(), domain } : c,
      ),
    })
  }, [commitState, featureNote])

  /** Keyboard nudge of the selected curve; returns true if it moved. */
  const nudgeSelected = useCallback(
    (dx: number, dy: number): boolean => {
      const sel = curvesRef.current.find((c) => c.id === selectedRef.current)
      if (!sel) return false
      const spec = modelsRef.current[sel.modelId]
      if (!spec || !spec.translate) return false
      try {
        const params = spec.translate(sel.params, dx, dy)
        const stroke = sel.sourceStroke?.map((p) => ({ x: p.x + dx, y: p.y + dy }))
        editStart()
        applyState({
          curves: curvesRef.current.map((c) =>
            c.id === sel.id ? { ...c, params, ...(stroke ? { sourceStroke: stroke } : {}) } : c,
          ),
        })
        return true
      } catch {
        return false
      }
    },
    [applyState, editStart],
  )

  const duplicateCurve = useCallback(
    (id: string): void => {
      const src = curvesRef.current.find((c) => c.id === id)
      if (!src) return
      const spec = modelsRef.current[src.modelId]
      let params = src.params.slice()
      let stroke = src.sourceStroke
      if (spec && spec.translate) {
        try {
          params = spec.translate(src.params, 0.5, -0.5)
          stroke = stroke?.map((p) => ({ x: p.x + 0.5, y: p.y - 0.5 }))
        } catch {
          params = src.params.slice()
          stroke = src.sourceStroke
        }
      }
      const copy: FittedCurve = {
        ...src,
        id: nextId(),
        params,
        color: pickColor(),
        ...(stroke ? { sourceStroke: stroke } : {}),
      }
      const cands = candidatesRef.current.get(id)
      const srcExpr = exprSourcesRef.current[id]
      const brokenWhy = brokenExprRef.current[id]
      const st = stylesRef.current[id]
      commitState({
        curves: [...curvesRef.current, copy],
        ...(st ? { styles: { ...stylesRef.current, [copy.id]: st } } : {}),
        ...(cands ? { candidates: new Map(candidatesRef.current).set(copy.id, cands) } : {}),
        ...(srcExpr !== undefined
          ? { exprSources: { ...exprSourcesRef.current, [copy.id]: srcExpr } }
          : {}),
        ...(brokenWhy !== undefined
          ? { brokenExpr: { ...brokenExprRef.current, [copy.id]: brokenWhy } }
          : {}),
      })
      setSelectedId(copy.id)
    },
    [commitState, pickColor],
  )

  // ------------------------------------------------------------- curve style
  const setStrokeWidth = useCallback(
    (id: string, width: number): void => {
      applyState({
        curves: curvesRef.current.map((c) => (c.id === id ? { ...c, strokeWidth: width } : c)),
      })
    },
    [applyState],
  )

  const setDash = useCallback(
    (id: string, dash: number[] | undefined): void => {
      commitState({
        styles: { ...stylesRef.current, [id]: { ...stylesRef.current[id], dash } },
      })
    },
    [commitState],
  )

  const setOpacity = useCallback(
    (id: string, opacity: number): void => {
      applyState({
        styles: { ...stylesRef.current, [id]: { ...stylesRef.current[id], opacity } },
      })
    },
    [applyState],
  )

  // ------------------------------------------------------- typed expressions
  /** Parse and add a typed expression. Returns an error message, or null on success. */
  const addExpression = useCallback(
    (src: string): string | null => {
      let outcome: ReturnType<typeof parseExpression>
      try {
        outcome = parseExpression(src)
      } catch {
        return 'The parser crashed on this input'
      }
      if (!outcome.ok) {
        // The parser's message already embeds the position where relevant.
        return outcome.error
      }
      const plot = outcome.plot
      const modelId = `expr_${++exprCounterRef.current}`
      let spec: ModelSpec
      try {
        spec = plot.makeModel(modelId)
      } catch {
        return 'Could not build a plot from this expression'
      }
      setExtraModels((prev) => ({ ...prev, [modelId]: spec }))
      const curve: FittedCurve = {
        id: nextId(),
        modelId,
        params: plot.defaultParams.slice(),
        kind: plot.kind,
        domain: plot.domain,
        color: pickColor(),
        strokeWidth: 2.5,
        visible: true,
        error: 0,
      }
      // Keep the source text: it is the only thing that can rebuild this
      // curve's model closure after a reload. It rides in the same commit as
      // the curve so undo/redo can never separate the two.
      commitState({
        curves: [...curvesRef.current, curve],
        exprSources: { ...exprSourcesRef.current, [curve.id]: src },
      })
      setSelectedId(curve.id)
      return null
    },
    [commitState, pickColor],
  )

  // ---------------------------------------------------------------- viewport
  const zoomBy = useCallback(
    (factor: number): void => {
      const vp = vpRef.current
      vp.pxPerUnit = clampPpu(vp.pxPerUnit * factor)
      stageRef.current?.redraw()
      scheduleSave()
    },
    [scheduleSave],
  )

  const resetView = useCallback((): void => {
    const vp = vpRef.current
    vp.center = { x: 0, y: 0 }
    vp.pxPerUnit = 60
    stageRef.current?.redraw()
    scheduleSave()
  }, [scheduleSave])

  // ------------------------------------------------------------------ export
  //
  // The exported PNG is not a second rendering of the board — it is the SAME
  // scene handed to the same renderBoard() the canvas uses, with two things
  // swapped: the theme (light, print-safe colours) and `chrome: null`, which
  // drops handles, hover/selection halos and live ink. Anything the teacher can
  // see that is part of the figure — grid, curves with their dash/opacity/width,
  // analysis markers and labels — is therefore in the file by construction, and
  // cannot silently go missing the way it did when export had its own code.
  const exportSettingsRef = useRef<ExportSettings>(exportSettings)
  exportSettingsRef.current = exportSettings
  const showAnalysisRef = useRef(showAnalysis)
  showAnalysisRef.current = showAnalysis
  const canvasThemeRef = useRef(canvasTheme)
  canvasThemeRef.current = canvasTheme
  const copyTimerRef = useRef(0)

  const boardTheme = canvasTheme === 'light' ? LIGHT_THEME : DARK_THEME

  const buildExportScene = useCallback((settings: ExportSettings): BoardScene => {
    const vp = vpRef.current
    const sel = curvesRef.current.find((c) => c.id === selectedRef.current) ?? null
    return {
      vp: {
        center: { x: vp.center.x, y: vp.center.y },
        pxPerUnit: vp.pxPerUnit,
        widthPx: vp.widthPx,
        heightPx: vp.heightPx,
      },
      theme: exportTheme(settings, DARK_THEME),
      curves: curvesRef.current,
      styles: stylesRef.current,
      models: modelsRef.current,
      analysis:
        showAnalysisRef.current && sel && sel.visible && analysisRef.current.length > 0
          ? { curve: sel, points: analysisRef.current }
          : null,
      // The screen palette is tuned against near-black and washes out on white
      // (amber lands near 1.7:1 — a copier renders it as nothing), so a light
      // export swaps every curve for its print counterpart.
      printColors: settings.theme === 'light',
      chrome: null,
    }
  }, [])

  const renderExportCanvas = useCallback((): HTMLCanvasElement | null => {
    const settings = clampExportSettings(exportSettingsRef.current)
    const out = renderBoardToCanvas(buildExportScene(settings), settings)
    return out ? out.canvas : null
  }, [buildExportScene])

  const pngFileName = useCallback((): string => {
    const safe = docMetaRef.current.name.replace(/[^\w\d\-. ]+/g, '_').trim()
    return `${safe || 'grapher'}.png`
  }, [])

  const downloadBlob = useCallback(
    (blob: Blob): void => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = pngFileName()
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    },
    [pngFileName],
  )

  const exportPNG = useCallback((): void => {
    const canvas = renderExportCanvas()
    if (!canvas) {
      showToast('Couldn’t render the figure for export.')
      return
    }
    void canvasToPngBlob(canvas).then((blob) => {
      if (!blob) {
        showToast('Couldn’t render the figure for export.')
        return
      }
      downloadBlob(blob)
    })
  }, [renderExportCanvas, downloadBlob, showToast])

  const flashCopy = useCallback((next: CopyState): void => {
    setCopyState(next)
    window.clearTimeout(copyTimerRef.current)
    copyTimerRef.current = window.setTimeout(() => setCopyState({ kind: 'idle' }), 2200)
  }, [])

  useEffect(() => () => window.clearTimeout(copyTimerRef.current), [])

  /**
   * Why the clipboard can refuse, in the browser's own terms. Checked BEFORE
   * trying, so the honest message is available even where the attempt would
   * throw synchronously.
   */
  const clipboardBlockedBecause = (): string | null => {
    if (typeof window === 'undefined') return 'there is no browser here'
    if (!window.isSecureContext) {
      return 'this page isn’t on a secure (https) connection'
    }
    if (typeof window.ClipboardItem !== 'function') {
      return 'this browser can’t put images on the clipboard'
    }
    if (!navigator.clipboard || typeof navigator.clipboard.write !== 'function') {
      return 'this browser has no clipboard write access'
    }
    return null
  }

  const describeClipboardError = (err: unknown): string => {
    const name = err instanceof Error ? err.name : ''
    if (name === 'NotAllowedError') {
      return 'the browser blocked it (the page has to be focused, and copying has to come from a click)'
    }
    if (name === 'SecurityError') return 'the browser blocked it for security reasons'
    if (name === 'DataError' || name === 'NotSupportedError') {
      return 'this browser won’t accept a PNG on the clipboard'
    }
    return 'the browser refused'
  }

  /**
   * Copy the figure to the clipboard, ready to paste into Word or Docs.
   *
   * Everything up to `clipboard.write` runs SYNCHRONOUSLY inside the click:
   * Safari treats an `await` as the end of the user gesture and rejects the
   * write, so the ClipboardItem is built around a PROMISE of the blob rather
   * than the blob itself. Every failure path ends in a download plus a message
   * saying what happened — a Copy button that quietly does nothing is worse
   * than no Copy button.
   */
  const copyPNG = useCallback((): void => {
    const canvas = renderExportCanvas()
    if (!canvas) {
      showToast('Couldn’t render the figure to copy.')
      return
    }
    const blobPromise = canvasToPngBlob(canvas).then((b) => {
      if (!b) throw new Error('png encode failed')
      return b
    })

    const fallBack = (reason: string): void => {
      blobPromise.then(
        (blob) => {
          downloadBlob(blob)
          flashCopy({ kind: 'fell-back', reason })
          showToast(`Couldn’t copy — ${reason}. Downloaded the PNG instead.`)
        },
        () => {
          flashCopy({ kind: 'idle' })
          showToast('Couldn’t produce a PNG to copy or download.')
        },
      )
    }

    const blocked = clipboardBlockedBecause()
    if (blocked !== null) {
      fallBack(blocked)
      return
    }

    setCopyState({ kind: 'working' })
    const done = (): void => flashCopy({ kind: 'copied' })

    try {
      const item = new ClipboardItem({ 'image/png': blobPromise })
      navigator.clipboard.write([item]).then(done, (err: unknown) => {
        // Some browsers accept a resolved Blob but not a promise of one; that
        // second attempt is outside the gesture, so it may itself be refused.
        blobPromise.then(
          (blob) => {
            try {
              navigator.clipboard
                .write([new ClipboardItem({ 'image/png': blob })])
                .then(done, () => fallBack(describeClipboardError(err)))
            } catch {
              fallBack(describeClipboardError(err))
            }
          },
          () => fallBack('the PNG could not be encoded'),
        )
      })
    } catch (err) {
      fallBack(describeClipboardError(err))
    }
  }, [renderExportCanvas, downloadBlob, flashCopy, showToast])

  /**
   * Output pixel size for a candidate setting. A function, not a memo: the
   * viewport is a mutable ref that pan/zoom/resize change without re-rendering
   * App, so the readout has to be computed when it is about to be shown.
   */
  const exportSizeOf = useCallback(
    (s: ExportSettings): { w: number; h: number } => {
      const geo = exportGeometry(vpRef.current, s)
      return { w: geo.w, h: geo.h }
    },
    [],
  )

  const changeExportSettings = useCallback((next: ExportSettings): void => {
    const clean = clampExportSettings(next)
    setExportSettings(clean)
    writeExportSettings(docMetaRef.current.id, clean)
  }, [])

  /**
   * Export settings follow the DOCUMENT: a worksheet's figures have to come out
   * the same size as each other. A document that has none yet inherits the last
   * settings used, so the choice is made once and then stops being a decision.
   */
  const exportDocRef = useRef<string | null>(null)
  useEffect(() => {
    if (exportDocRef.current === docMeta.id) return
    exportDocRef.current = docMeta.id
    setExportSettings(readExportSettings(docMeta.id))
  }, [docMeta.id])

  const toggleCanvasTheme = useCallback((): void => {
    setCanvasTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark'
      updatePrefs({ canvasTheme: next })
      return next
    })
  }, [])

  // ------------------------------------------------------------ file dropping
  //
  // dragleave alone can never be trusted to take the overlay down: it fires
  // when the pointer crosses onto a CHILD element, and it doesn't fire at all
  // if the drag ends outside the window or is cancelled with Escape. So the
  // overlay is driven by a watchdog — dragover repeats while a drag is live, so
  // a gap in those events means the drag is over — with the explicit end events
  // as the fast path.
  const dropTimerRef = useRef(0)
  const endDrop = useCallback((): void => {
    window.clearTimeout(dropTimerRef.current)
    dropTimerRef.current = 0
    setDropActive(false)
  }, [])

  const keepDropAlive = useCallback((): void => {
    setDropActive(true)
    window.clearTimeout(dropTimerRef.current)
    dropTimerRef.current = window.setTimeout(() => setDropActive(false), 900)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') endDrop()
    }
    window.addEventListener('dragend', endDrop)
    window.addEventListener('drop', endDrop)
    window.addEventListener('blur', endDrop)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('dragend', endDrop)
      window.removeEventListener('drop', endDrop)
      window.removeEventListener('blur', endDrop)
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(dropTimerRef.current)
    }
  }, [endDrop])

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    const NUDGE: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, 1],
      ArrowDown: [0, -1],
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const meta = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      if (meta && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (meta && key === 'y') {
        e.preventDefault()
        redo()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRef.current) {
        e.preventDefault()
        deleteCurve(selectedRef.current)
      } else if (NUDGE[e.key]) {
        const [ux, uy] = NUDGE[e.key]
        const step = e.shiftKey ? 1 : 0.1
        if (nudgeSelected(ux * step, uy * step)) e.preventDefault()
      } else if (key === 'd' && !meta) {
        setMode('draw')
      } else if (key === 'p' && !meta) {
        setMode('pan')
      } else if (key === 'a' && !meta) {
        setShowAnalysis((v) => {
          const next = !v
          updatePrefs({ showAnalysis: next })
          return next
        })
      }
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key.startsWith('Arrow')) commitWithSnap(selectedRef.current, false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [undo, redo, deleteCurve, nudgeSelected, commitWithSnap])

  // ------------------------------------------------------------------ render
  const canUndo = undoRef.current.length > 0
  const canRedo = redoRef.current.length > 0

  return (
    <div className="app">
      <Sidebar
        open={sidebarOpen}
        curves={curves}
        styles={styles}
        models={models}
        selectedId={selectedId}
        exprOpen={exprOpen}
        snapFlash={snapFlash}
        shake={shake}
        exprSources={exprSources}
        brokenExpr={brokenExpr}
        analysis={analysis}
        onAnalysisHover={setHighlight}
        onFeatureEdit={applyFeatureByIndex}
        candidatesFor={candidatesFor}
        onSelect={setSelectedId}
        onDelete={deleteCurve}
        onDuplicate={duplicateCurve}
        onToggleVisible={toggleVisible}
        onCycleColor={cycleColor}
        onParamChange={setParam}
        onParamEditStart={editStart}
        onParamEditEnd={editEnd}
        onParamCommit={(id) => commitWithSnap(id, false)}
        onParamSetExact={setParamExact}
        onApplyCandidate={applyCandidate}
        onStrokeWidth={setStrokeWidth}
        onDash={setDash}
        onOpacity={setOpacity}
        onExprToggle={() => setExprOpen((o) => !o)}
        onExprSubmit={addExpression}
      />

      {sidebarOpen && (
        <div className="scrim" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      )}

      <main
        className="canvas-area"
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
        <CanvasStage
          ref={stageRef}
          curves={curves}
          styles={styles}
          models={models}
          selectedId={selectedId}
          mode={mode}
          inkColor={pickColor()}
          vpRef={vpRef}
          onStrokeRecognized={handleStrokeRecognized}
          onSelect={setSelectedId}
          onDrawingChange={setDrawingActive}
          onDragCurve={dragCurveLive}
          onHandleDrag={handleDragLive}
          onOversketch={oversketchApply}
          onOversketchFail={oversketchFail}
          onCurveEditStart={editStart}
          onCurveEditEnd={commitWithSnap}
          onCurveEditCancel={editCancel}
          onViewportChange={scheduleSave}
          analysis={showAnalysis ? analysis : EMPTY_ANALYSIS}
          analysisHighlight={highlight}
          onFeatureEdit={applyFeature}
          theme={boardTheme}
        />

        <Toolbar
          mode={mode}
          sidebarOpen={sidebarOpen}
          canUndo={canUndo}
          canRedo={canRedo}
          hasCurves={curves.length > 0}
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
              onRename={renameDoc}
              onNew={newDocument}
              onOpen={openDocument}
              onDuplicate={duplicateDocument}
              onDelete={deleteDocument}
              onExport={exportDocument}
              onImport={importDocument}
            />
          }
          exportMenu={
            <ExportMenu
              settings={exportSettings}
              sizeOf={exportSizeOf}
              copyState={copyState}
              onChange={changeExportSettings}
              onExport={exportPNG}
              onCopy={copyPNG}
            />
          }
          onMode={setMode}
          onToggleSidebar={() => setSidebarOpen((o) => !o)}
          onUndo={undo}
          onRedo={redo}
          onClear={clearAll}
        />

        {toast && (
          <div key={toast.key} className="toast" role="status">
            {toast.msg}
          </div>
        )}

        {featureNote && (
          <div
            key={featureNote.key}
            className={`feature-note${
              featureNote.kind === 'refused' ? ' feature-note-refused' : ''
            }`}
            role={featureNote.kind === 'refused' ? 'alert' : 'status'}
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
            <button className="banner-action" onClick={exportDocument}>
              Export to file
            </button>
            <button className="banner-action" onClick={saveNow}>
              Retry
            </button>
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
            {conflict === 'stale' && (
              <button className="banner-action" onClick={reloadCurrentDoc}>
                Reload
              </button>
            )}
            <button
              className="banner-action"
              onClick={() => saveBoardAsNewDoc(`${docMetaRef.current.name} copy`)}
            >
              Save as a copy
            </button>
            <button className="banner-action" onClick={exportDocument}>
              Export to file
            </button>
          </div>
        )}

        {switchBlocked && (
          <div className="banner banner-error" role="alert">
            <div className="banner-body">
              <strong className="banner-title">Stayed on this document</strong>
              <span className="banner-text">{switchBlocked}</span>
            </div>
            <button className="banner-action" onClick={exportDocument}>
              Export to file
            </button>
            <button className="banner-action" onClick={() => setSwitchBlocked(null)}>
              Dismiss
            </button>
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
            <button className="banner-action" onClick={() => setLoadNotice(null)}>
              Dismiss
            </button>
          </div>
        )}

        {curves.length === 0 && !drawingActive && !loadNotice?.fatal && (
          <div className="empty-hint" aria-hidden="true">
            <div className="empty-glyph">∿</div>
            <div className="empty-title">Draw anything — a wave, a circle, a heart…</div>
            <div className="empty-sub">Every stroke becomes a live equation — or press + to type one</div>
          </div>
        )}

        {curves.length === 0 && !drawingActive && loadNotice?.fatal && (
          <div className="empty-hint empty-hint-error">
            <div className="empty-glyph empty-glyph-error">⚠</div>
            <div className="empty-title">This board is empty because a document couldn’t be opened</div>
            <div className="empty-sub">
              The damaged document was left untouched in storage — nothing was overwritten. You can
              open another document from the menu, or import a file you exported earlier.
            </div>
          </div>
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
    </div>
  )
}

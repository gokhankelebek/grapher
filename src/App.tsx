import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FitResult, FittedCurve, ModelSpec, ProcessedStroke, Viewport } from './core/types'
import { CURVE_COLORS, DARK_THEME, nextId } from './core/types'
import { MODELS } from './core/fit/models'
import { parseExpression } from './core/parse'
import { snapParams } from './core/fit/edit'
import { analyzeCurve } from './core/analyze'
import type { SpecialPoint } from './core/types'
import { drawGrid } from './render/grid'
import { drawCurve } from './render/curves'
import { CanvasStage } from './ui/CanvasStage'
import type { CanvasStageHandle } from './ui/CanvasStage'
import { Toolbar } from './ui/Toolbar'
import { Sidebar } from './ui/Sidebar'
import { DocMenu } from './ui/DocMenu'
import type { SaveState } from './ui/DocMenu'
import {
  createDoc,
  deserializeDoc,
  docFromBoard,
  emptyBoard,
  serializeDoc,
} from './core/persist'
import type { BoardInput, DocMeta, HydratedBoard } from './core/persist'
import {
  listDocs,
  readDocJSON,
  readIndex,
  readPrefs,
  removeDoc,
  setCurrentDoc,
  usedBytes,
  writeDoc,
  writePrefs,
} from './ui/storage'

export type Mode = 'draw' | 'pan'

/** Per-curve style extras FittedCurve doesn't carry (kept in a parallel map). */
export type { CurveStyle, StyleMap } from './core/persist'
import type { CurveStyle, StyleMap } from './core/persist'

/** How long the board sits idle before it is written to storage. */
const AUTOSAVE_MS = 400

/** Stable identity — avoids re-rendering the canvas when markers are hidden. */
const EMPTY_ANALYSIS: SpecialPoint[] = []

/** One undo/redo history entry. */
interface Snapshot {
  curves: FittedCurve[]
  styles: StyleMap
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
  /** curveId -> the equation text the user typed (rebuilt into models on load). */
  const [exprSources, setExprSources] = useState<Record<string, string>>({})
  /** curveId -> why its equation could not be restored. */
  const [brokenExpr, setBrokenExpr] = useState<Record<string, string>>({})
  const [dropActive, setDropActive] = useState(false)

  // ---- curve analysis (zeros, extrema, inflections)
  const [showAnalysis, setShowAnalysis] = useState<boolean>(() => readPrefs().showAnalysis)
  /** Index into the analysis array whose marker should be emphasised. */
  const [highlight, setHighlight] = useState<number | null>(null)

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
  const docMetaRef = useRef<DocMeta>(docMeta)
  const saveTimerRef = useRef(0)
  /** Nothing may be written until the stored document has been read in. */
  const hydratedRef = useRef(false)
  /** Loading a document shouldn't immediately re-save what was just read. */
  const skipAutosaveRef = useRef(false)

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

  const vpRef = useRef<Viewport>({
    center: { x: 0, y: 0 },
    pxPerUnit: 60,
    widthPx: 800,
    heightPx: 600,
  })
  const stageRef = useRef<CanvasStageHandle>(null)

  // ------------------------------------------------------------ state/history
  const takeSnapshot = useCallback(
    (): Snapshot => ({ curves: curvesRef.current, styles: stylesRef.current }),
    [],
  )

  const applyState = useCallback((s: { curves?: FittedCurve[]; styles?: StyleMap }): void => {
    if (s.curves) {
      curvesRef.current = s.curves
      setCurves(s.curves)
    }
    if (s.styles) {
      stylesRef.current = s.styles
      setStyles(s.styles)
    }
  }, [])

  /** Apply new state and push the previous snapshot onto the undo stack. */
  const commitState = useCallback(
    (s: { curves?: FittedCurve[]; styles?: StyleMap }): void => {
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

  const saveNow = useCallback((): void => {
    if (!hydratedRef.current) return
    window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = 0
    const meta = docMetaRef.current
    if (!meta.id) return
    const doc = docFromBoard(meta, currentBoardInput())
    const outcome = writeDoc(doc)
    if (outcome.ok) {
      docMetaRef.current = { ...meta, modifiedAt: doc.modifiedAt }
      setDocs(listDocs())
      setSaveState('saved')
      setSaveError(null)
    } else {
      // Never silent: the board is still in memory, but it is NOT on disk.
      setSaveState('error')
      const kb = Math.round(usedBytes() / 1024)
      setSaveError(
        outcome.quota
          ? `${outcome.message} Grapher is using about ${kb}KB. Export this document to a file, or delete documents you no longer need, then edit again to retry.`
          : outcome.message,
      )
    }
  }, [currentBoardInput])

  const scheduleSave = useCallback((): void => {
    if (!hydratedRef.current) return
    setSaveState('saving')
    window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(saveNow, AUTOSAVE_MS)
  }, [saveNow])

  /** Swap the whole board over to a freshly loaded document. */
  const applyHydrated = useCallback((meta: DocMeta, board: HydratedBoard): void => {
    curvesRef.current = board.curves
    stylesRef.current = board.styles
    candidatesRef.current = board.candidates
    exprSourcesRef.current = board.exprSources
    selectedRef.current = board.selectedId
    modeRef.current = board.mode
    docMetaRef.current = meta
    exprCounterRef.current = board.exprCounter
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
    setDocs(listDocs())
  }, [applyHydrated])

  // Autosave: any board change schedules a debounced write.
  useEffect(() => {
    if (!hydratedRef.current) return
    if (skipAutosaveRef.current) {
      skipAutosaveRef.current = false
      return
    }
    scheduleSave()
  }, [curves, styles, selectedId, mode, docMeta.name, scheduleSave])

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

  const renameDoc = useCallback((name: string): void => {
    const next = { ...docMetaRef.current, name }
    docMetaRef.current = next
    setDocMeta(next)
  }, [])

  const newDocument = useCallback((): void => {
    saveNow()
    const doc = createDoc('Untitled', emptyBoard())
    const meta: DocMeta = {
      id: doc.id,
      name: doc.name,
      createdAt: doc.createdAt,
      modifiedAt: doc.modifiedAt,
    }
    applyHydrated(meta, blankBoard())
    setLoadNotice(null)
    writeDoc(doc)
    setCurrentDoc(meta.id)
    setDocs(listDocs())
  }, [applyHydrated, blankBoard, saveNow])

  const openDocument = useCallback(
    (id: string): void => {
      if (id === docMetaRef.current.id) return
      saveNow()
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
      setLoadNotice(res.problems.length > 0 ? { problems: res.problems, fatal: false } : null)
      setCurrentDoc(res.meta.id)
      setDocs(listDocs())
    },
    [applyHydrated, saveNow],
  )

  const duplicateDocument = useCallback((): void => {
    saveNow()
    const src = docMetaRef.current
    const doc = createDoc(`${src.name} copy`, emptyBoard())
    const meta: DocMeta = {
      id: doc.id,
      name: doc.name,
      createdAt: doc.createdAt,
      modifiedAt: doc.modifiedAt,
    }
    // The board in memory is already the one being copied — just re-target it.
    docMetaRef.current = meta
    setDocMeta(meta)
    writeDoc(docFromBoard(meta, currentBoardInput()))
    setCurrentDoc(meta.id)
    setDocs(listDocs())
    setSaveState('saved')
  }, [currentBoardInput, saveNow])

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
      writePrefs({ showAnalysis: next })
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
          saveNow()
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
          setLoadNotice(res.problems.length > 0 ? { problems: res.problems, fatal: false } : null)
          writeDoc(docFromBoard(meta, currentBoardInput()))
          setCurrentDoc(meta.id)
          setDocs(listDocs())
          setSaveState('saved')
        })
        .catch(() => {
          setLoadNotice({ problems: ['That file could not be read.'], fatal: true })
        })
    },
    [applyHydrated, currentBoardInput, saveNow],
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
      candidatesRef.current.set(curve.id, results)
      commitState({ curves: [...curvesRef.current, curve] })
      setSelectedId(curve.id)
      return curve
    },
    [commitState, pickColor],
  )

  const deleteCurve = useCallback(
    (id: string): void => {
      const { [id]: _gone, ...restStyles } = stylesRef.current
      const { [id]: _src, ...restSources } = exprSourcesRef.current
      exprSourcesRef.current = restSources
      setExprSources(restSources)
      setBrokenExpr((prev) => {
        if (!(id in prev)) return prev
        const { [id]: _b, ...rest } = prev
        return rest
      })
      commitState({ curves: curvesRef.current.filter((c) => c.id !== id), styles: restStyles })
      setSelectedId((sel) => (sel === id ? null : sel))
    },
    [commitState],
  )

  const clearAll = useCallback((): void => {
    if (curvesRef.current.length === 0) return
    exprSourcesRef.current = {}
    setExprSources({})
    setBrokenExpr({})
    commitState({ curves: [], styles: {} })
    setSelectedId(null)
  }, [commitState])

  const toggleVisible = useCallback(
    (id: string): void => {
      applyState({
        curves: curvesRef.current.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c)),
      })
    },
    [applyState],
  )

  const cycleColor = useCallback(
    (id: string): void => {
      applyState({
        curves: curvesRef.current.map((c) => {
          if (c.id !== id) return c
          const idx = CURVE_COLORS.indexOf(c.color)
          const next = CURVE_COLORS[(idx + 1 + CURVE_COLORS.length) % CURVE_COLORS.length]
          return { ...c, color: next }
        }),
      })
    },
    [applyState],
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

  /** Oversketch couldn't blend the stroke: shake the card, brief toast. */
  const oversketchFail = useCallback((id: string): void => {
    window.clearTimeout(shakeTimerRef.current)
    window.clearTimeout(toastTimerRef.current)
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
      if (cands) candidatesRef.current.set(copy.id, cands)
      const srcExpr = exprSourcesRef.current[id]
      if (srcExpr !== undefined) {
        exprSourcesRef.current = { ...exprSourcesRef.current, [copy.id]: srcExpr }
        setExprSources(exprSourcesRef.current)
      }
      const st = stylesRef.current[id]
      commitState({
        curves: [...curvesRef.current, copy],
        ...(st ? { styles: { ...stylesRef.current, [copy.id]: st } } : {}),
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
      // curve's model closure after a reload.
      exprSourcesRef.current = { ...exprSourcesRef.current, [curve.id]: src }
      setExprSources(exprSourcesRef.current)
      commitState({ curves: [...curvesRef.current, curve] })
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
  const exportPNG = useCallback((): void => {
    const vp = vpRef.current
    const scale = 2
    const off = document.createElement('canvas')
    off.width = Math.max(1, Math.round(vp.widthPx * scale))
    off.height = Math.max(1, Math.round(vp.heightPx * scale))
    const ctx = off.getContext('2d')
    if (!ctx) return
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    ctx.fillStyle = DARK_THEME.bg
    ctx.fillRect(0, 0, vp.widthPx, vp.heightPx)
    try {
      drawGrid(ctx, vp, DARK_THEME)
    } catch {
      /* ignore */
    }
    for (const curve of curvesRef.current) {
      if (!curve.visible) continue
      const st = stylesRef.current[curve.id]
      if (st?.opacity !== undefined) ctx.globalAlpha = st.opacity
      if (st?.dash) ctx.setLineDash(st.dash)
      try {
        drawCurve(ctx, curve, modelsRef.current, vp)
      } catch {
        /* ignore */
      }
      ctx.setLineDash([])
      ctx.globalAlpha = 1
    }
    off.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'grapher.png'
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }, 'image/png')
  }, [])

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
          writePrefs({ showAnalysis: next })
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
            if (!dropActive) setDropActive(true)
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDropActive(false)
        }}
        onDrop={(e) => {
          const file = e.dataTransfer.files?.[0]
          if (!file) return
          e.preventDefault()
          setDropActive(false)
          importDocument(file)
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
        />

        <Toolbar
          mode={mode}
          sidebarOpen={sidebarOpen}
          canUndo={canUndo}
          canRedo={canRedo}
          hasCurves={curves.length > 0}
          showAnalysis={showAnalysis}
          onToggleAnalysis={toggleAnalysis}
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
          onMode={setMode}
          onToggleSidebar={() => setSidebarOpen((o) => !o)}
          onUndo={undo}
          onRedo={redo}
          onClear={clearAll}
          onExport={exportPNG}
        />

        {toast && (
          <div key={toast.key} className="toast" role="status">
            {toast.msg}
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

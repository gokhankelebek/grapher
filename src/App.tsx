import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  BoardKind,
  FitResult,
  FittedCurve,
  ModelSpec,
  NLItem,
  NLItemDraft,
  ProcessedStroke,
  Viewport,
} from './core/types'
import { CURVE_COLORS, DARK_THEME, LIGHT_THEME, nextId, toPrintColor } from './core/types'
import { MODELS } from './core/fit/models'
import { parseExpression } from './core/parse'
import { parseInequality } from './core/parse/inequality'
import { applyFeatureEdit, snapParams } from './core/fit/edit'
import { analyzeCurve } from './core/analyze'
import { curveBounds, splitNotice, unionBoxes } from './ui/curveState'
import { answerPieces } from './ui/nlText'
import { AnswerContext } from './ui/answerContext'
import { AnalysisOverlay, drawContextMarkers } from './ui/AnalysisOverlay'
import type { AnalysisOverlayHandle } from './ui/AnalysisOverlay'
import type { FeatureEditResult, SpecialPoint } from './core/types'
import { describePoints } from './ui/featureEdit'
import { readCurveEquation } from './ui/equationText'
import { CanvasStage } from './ui/CanvasStage'
import type { CanvasStageHandle } from './ui/CanvasStage'
import { NumberLineStage } from './ui/NumberLineStage'
import type { NumberLineStageHandle } from './ui/NumberLineStage'
import type { NLPart } from './render/numberline'
import { Toolbar } from './ui/Toolbar'
import { Sidebar } from './ui/Sidebar'
import { DocMenu } from './ui/DocMenu'
import type { SaveState } from './ui/DocMenu'
import { ExportMenu } from './ui/ExportMenu'
import type { CopyState } from './ui/ExportMenu'
import {
  canvasToPngBlob,
  exportGeometry,
  exportTheme,
  renderBoardToCanvas,
  suggestAxisUnits,
} from './ui/renderBoard'
import type { AxisUnits, BoardScene } from './ui/renderBoard'
import { clampFitSettings, contentBounds, exportViewport } from './ui/exportFit'
import type { FitExportSettings } from './ui/exportFit'
import { PresentBar } from './ui/PresentBar'
import { PresentLegend } from './ui/PresentLegend'
import { DEFAULT_PRESENT_TYPE, curveLegend, itemLegend, presentScale } from './ui/present'
import { copyDocName, nextDocName } from './ui/docName'
import {
  AUTO_AXIS_UNITS,
  createDoc,
  deserializeDoc,
  docFromBoard,
  emptyBoard,
  resolveAxisUnits,
  serializeDoc,
} from './core/persist'
import type {
  AxisUnitChoice,
  AxisUnitChoices,
  BoardInput,
  DocMeta,
  HydratedBoard,
  ResolvedAxisUnits,
} from './core/persist'
import {
  clampPresentScale,
  copyExportSettings,
  isGrapherKey,
  listDocs,
  readDocJSON,
  readDocStamp,
  readIndex,
  hasExportSettings,
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

/**
 * The canvas is MODELESS — Space or a middle-drag or two fingers pan, a tap
 * selects, a tap on nothing deselects. The type survives because the stages and
 * the document format still name it; it has exactly one value that is ever used.
 */
export type Mode = 'draw' | 'pan'

/** The one value. Nothing sets it any more. */
const MODE: Mode = 'draw'

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
  /** Number-line items. They live in the same history as the curves so a board
   *  whose kind was switched still undoes in the order things happened. */
  items: NLItem[]
  kind: BoardKind
  styles: StyleMap
  exprSources: Record<string, string>
  brokenExpr: Record<string, string>
  /** curveId -> the user's own typed form, while the params still mean it. */
  displaySources: Record<string, string>
  /** curveId -> the edits made since recognition, in the order they were made. */
  edits: Record<string, CurveEdit[]>
  candidates: Map<string, FitResult[]>
  /**
   * What the action was, in three or four words: "set zero", "edit equation",
   * "delete curve". Undo changed 0.6% of the pixels on a measured board and
   * said nothing; now it says what it took back.
   */
  label: string
}

/**
 * One thing done to a curve after it was recognised.
 *
 * `feature` edits are recorded in full because they can be RE-APPLIED: asking
 * for another reading of the same sketch then re-states "the zero is at −2"
 * against the new family, and only falls back to the confirm when the new
 * family refuses. The others cannot be replayed and are remembered only so the
 * board knows the curve is no longer a reading of its ink.
 */
export type CurveEdit =
  | { kind: 'feature'; point: SpecialPoint; to: { x?: number; y?: number } }
  | { kind: 'equation' }
  | { kind: 'handle' }
  | { kind: 'param' }

/** The board-state slice any mutation may change; omitted keys are untouched. */
interface StatePatch {
  curves?: FittedCurve[]
  items?: NLItem[]
  kind?: BoardKind
  styles?: StyleMap
  exprSources?: Record<string, string>
  brokenExpr?: Record<string, string>
  displaySources?: Record<string, string>
  edits?: Record<string, CurveEdit[]>
  candidates?: Map<string, FitResult[]>
}

const MIN_PPU = 0.001
const MAX_PPU = 100000
const HISTORY_LIMIT = 100

const clampPpu = (v: number): number => Math.min(MAX_PPU, Math.max(MIN_PPU, v))

export default function App() {
  const [curves, setCurves] = useState<FittedCurve[]>([])
  /**
   * What KIND of board this document is. A number line is not a curve family:
   * it has its own contents (`items`), its own stage and its own half of the
   * renderer. Everything else — documents, autosave, undo, pan/zoom, export —
   * is deliberately shared, so there is one of each rather than two.
   */
  const [kind, setKind] = useState<BoardKind>('cartesian')
  const [items, setItems] = useState<NLItem[]>([])
  const [styles, setStyles] = useState<StyleMap>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [drawingActive, setDrawingActive] = useState(false)
  const [exprOpen, setExprOpen] = useState(false)
  const [extraModels, setExtraModels] = useState<Record<string, ModelSpec>>({})
  const [snapFlash, setSnapFlash] = useState<{ id: string; mask: boolean[]; key: number } | null>(
    null,
  )
  const [shake, setShake] = useState<{ id: string; key: number } | null>(null)
  /** A brief line at the foot of the board, sometimes with one thing to do. */
  const [toast, setToast] = useState<{
    msg: string
    key: number
    action?: { label: string; run(): void }
  } | null>(null)
  /**
   * A destructive thing asked about before it happens. One line, two buttons,
   * never modal: the teacher can ignore it and keep working.
   */
  const [confirmAsk, setConfirmAsk] = useState<{
    key: number
    text: string
    yes: string
    run(): void
  } | null>(null)
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
  /** curveId -> the typed form the user wrote for a curve that is still a family. */
  const [displaySources, setDisplaySources] = useState<Record<string, string>>({})
  /** curveId -> what has been done to it since it was recognised. */
  const [edits, setEdits] = useState<Record<string, CurveEdit[]>>({})
  const [dropActive, setDropActive] = useState(false)

  // ---- curve analysis (zeros, extrema, inflections)
  const [showAnalysis, setShowAnalysis] = useState<boolean>(() => readPrefs().showAnalysis)
  /**
   * Ground the ON-SCREEN canvas is drawn on. Dark by default — the export has
   * its own, independent setting, because the two are answering different
   * questions ("what do I want to look at" vs "what goes on the paper").
   */
  const [canvasTheme, setCanvasTheme] = useState<'dark' | 'light'>(() => readPrefs().canvasTheme)
  /**
   * How each axis is MEASURED, as this document states it.
   *
   * 'auto' — the default, and both sides start there — means the board decides
   * from what is on it, every time the curve set changes: a sine lands and the
   * x-axis becomes π/2, π, 3π/2; the last trig curve is deleted and it goes
   * back to 1, 2, 3. 'decimal'/'pi' is the teacher overruling that, and the
   * override sticks until they hand the axis back to auto — a board that
   * argued back every time a sketch landed would be unusable mid-lesson.
   *
   * It belongs to the DOCUMENT (persist.ts), not to preferences: a trig lesson
   * is a trig lesson on any machine, while the next document is not.
   */
  const [axisUnitChoice, setAxisUnitChoice] = useState<AxisUnitChoices>(AUTO_AXIS_UNITS)
  const [exportSettings, setExportSettings] = useState<FitExportSettings>(() => ({
    ...readPrefs().exportDefaults,
  }))
  /**
   * Presentation mode: the board projected across a room. F enters and leaves,
   * Esc leaves. Nothing about it is written to the document — it is a way of
   * LOOKING at a board, not a property of one — except the size, which is a
   * fact about the teacher's room and is remembered in preferences.
   */
  const [presentMode, setPresentMode] = useState(false)
  const [presentType, setPresentType] = useState<number>(() => readPrefs().presentScale)
  const [legendCorner, setLegendCorner] = useState<
    'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  >('bottom-left')
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
  const itemsRef = useRef<NLItem[]>([])
  const kindRef = useRef<BoardKind>('cartesian')
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
  const displaySourcesRef = useRef<Record<string, string>>({})
  const axisUnitChoiceRef = useRef<AxisUnitChoices>(axisUnitChoice)
  axisUnitChoiceRef.current = axisUnitChoice
  const editsRef = useRef<Record<string, CurveEdit[]>>({})
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
    items: NLItem[]
    kind: BoardKind
    styles: StyleMap
    exprSources: Record<string, string>
    displaySources: Record<string, string>
    selectedId: string | null
    name: string
  } | null>(null)

  const models = useMemo<Record<string, ModelSpec>>(
    () => ({ ...MODELS, ...extraModels }),
    [extraModels],
  )
  const modelsRef = useRef(models)
  modelsRef.current = models
  selectedRef.current = selectedId

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

  // ------------------------------------------- analysis for the OTHER curves
  //
  // Markers used to exist only for the selected curve, so switching Analysis on
  // and then deselecting left a lit button over an empty board. The toggle now
  // means every visible curve, and the cost is kept off the hot path by a memo
  // per curve keyed on the only three things that can move a special point.
  const analysisCacheRef = useRef(new Map<string, SpecialPoint[]>())
  const analysisModelsRef = useRef(models)
  if (analysisModelsRef.current !== models) {
    analysisModelsRef.current = models
    analysisCacheRef.current = new Map()
  }

  const analysisFor = useCallback((curve: FittedCurve): SpecialPoint[] => {
    const key = `${curve.id}|${curve.modelId}|${curve.params.join(',')}|${
      curve.domain ? curve.domain.join(',') : ''
    }`
    const hit = analysisCacheRef.current.get(key)
    if (hit) return hit
    let pts: SpecialPoint[] = []
    try {
      const got = analyzeCurve(curve, analysisModelsRef.current)
      pts = Array.isArray(got) ? got : []
    } catch {
      pts = []
    }
    // One entry per curve: the previous key for this id is dead the moment the
    // curve moves, so the map cannot grow with the length of a drag.
    for (const k of analysisCacheRef.current.keys()) {
      if (k.startsWith(`${curve.id}|`)) analysisCacheRef.current.delete(k)
    }
    analysisCacheRef.current.set(key, pts)
    return pts
  }, [])

  /**
   * curveId -> "this curve is no longer a reading of its ink". The card uses it
   * to decide whether σ still means anything.
   */
  const editedIds = useMemo<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {}
    for (const [id, list] of Object.entries(edits)) {
      if (list.length > 0) out[id] = true
    }
    return out
  }, [edits])

  /** The visible, unselected curves and their markers. Empty when off. */
  const contextAnalysis = useMemo(() => {
    if (!showAnalysis || kind !== 'cartesian') return []
    return curves
      .filter((c) => c.visible && c.id !== selectedId)
      .map((curve) => ({ curve, points: analysisFor(curve) }))
      .filter((m) => m.points.length > 0)
  }, [showAnalysis, kind, curves, selectedId, analysisFor])

  // -------------------------------------------------------------- axis units
  //
  // AUTO is re-asked whenever the curve set changes, which is what makes
  // `y = sin(x)` turn the x-axis into π/2, π, 3π/2 on its own and deleting the
  // last trig curve turn it back. suggestAxisUnits is the renderer's own
  // recommendation — pure, and it reads a TYPED curve's family out of
  // exprSources, the same map keyed by curve id the legend takes.
  //
  // A number line has no axis units to choose, so it never asks.
  const axisSuggestion = useMemo<AxisUnits>(
    () => (kind === 'cartesian' ? suggestAxisUnits(curves, exprSources) : {}),
    [kind, curves, exprSources],
  )
  const suggestedX: 'decimal' | 'pi' = axisSuggestion.x === 'pi' ? 'pi' : 'decimal'
  const suggestedXRef = useRef(suggestedX)
  suggestedXRef.current = suggestedX
  const { x: axisChoiceX, y: axisChoiceY } = axisUnitChoice
  /**
   * What the grid is actually drawn in. Memoised on the two RESOLVED strings
   * rather than on the curve list, so a board whose units have not changed
   * hands the stage the identical object it had last frame.
   */
  const axisUnits = useMemo<ResolvedAxisUnits>(
    () => resolveAxisUnits({ x: axisChoiceX, y: axisChoiceY }, { x: suggestedX }),
    [axisChoiceX, axisChoiceY, suggestedX],
  )
  const axisUnitsRef = useRef<ResolvedAxisUnits>(axisUnits)
  axisUnitsRef.current = axisUnits

  const vpRef = useRef<Viewport>({
    center: { x: 0, y: 0 },
    pxPerUnit: 60,
    widthPx: 800,
    heightPx: 600,
  })
  const stageRef = useRef<CanvasStageHandle>(null)
  const nlStageRef = useRef<NumberLineStageHandle>(null)
  const overlayRef = useRef<AnalysisOverlayHandle>(null)

  // ------------------------------------------------------------------ toasts
  /**
   * A brief, non-modal message at the foot of the board, optionally carrying
   * the ONE thing to do about it. Defined up here because undo and redo report
   * themselves through it.
   */
  const showToast = useCallback(
    (msg: string, opts?: { ms?: number; action?: { label: string; run(): void } }): void => {
      window.clearTimeout(toastTimerRef.current)
      setToast({ msg, key: Date.now(), ...(opts?.action ? { action: opts.action } : {}) })
      toastTimerRef.current = window.setTimeout(() => setToast(null), opts?.ms ?? 3600)
    },
    [],
  )

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

  // ------------------------------------------------------------ state/history
  const takeSnapshot = useCallback(
    (label: string): Snapshot => ({
      curves: curvesRef.current,
      items: itemsRef.current,
      kind: kindRef.current,
      styles: stylesRef.current,
      exprSources: exprSourcesRef.current,
      brokenExpr: brokenExprRef.current,
      displaySources: displaySourcesRef.current,
      edits: editsRef.current,
      candidates: candidatesRef.current,
      label,
    }),
    [],
  )

  const applyState = useCallback((s: StatePatch): void => {
    if (s.curves) {
      curvesRef.current = s.curves
      setCurves(s.curves)
    }
    if (s.items) {
      itemsRef.current = s.items
      setItems(s.items)
    }
    if (s.kind) {
      kindRef.current = s.kind
      setKind(s.kind)
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
    if (s.displaySources) {
      displaySourcesRef.current = s.displaySources
      setDisplaySources(s.displaySources)
    }
    if (s.edits) {
      editsRef.current = s.edits
      setEdits(s.edits)
    }
    // Replaced wholesale, never mutated in place, so snapshots stay immutable.
    if (s.candidates) candidatesRef.current = s.candidates
  }, [])

  /**
   * Apply new state and push the previous snapshot onto the undo stack.
   *
   * `label` names the action in the teacher's words, not the code's, because
   * it is what the undo toast will say: "Undid: set zero".
   */
  const commitState = useCallback(
    (s: StatePatch, label = 'change'): void => {
      undoRef.current = [...undoRef.current.slice(-(HISTORY_LIMIT - 1)), takeSnapshot(label)]
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
    redoRef.current = [...redoRef.current, takeSnapshot(prev.label)]
    applyState(prev)
    bumpHistory((v) => v + 1)
    setSelectedId((sel) =>
      sel && (prev.curves.some((c) => c.id === sel) || prev.items.some((i) => i.id === sel))
        ? sel
        : null,
    )
    // An undo that moved 0.6% of the pixels on a measured board said nothing at
    // all. Now it says what it took back.
    showToast(`Undid: ${prev.label}`, { ms: 2200 })
  }, [applyState, takeSnapshot, showToast])

  const redo = useCallback((): void => {
    const stack = redoRef.current
    if (stack.length === 0) return
    window.clearTimeout(featureNoteTimerRef.current)
    setFeatureNote(null)
    const next = stack[stack.length - 1]
    redoRef.current = stack.slice(0, -1)
    undoRef.current = [...undoRef.current, takeSnapshot(next.label)]
    applyState(next)
    bumpHistory((v) => v + 1)
    setSelectedId((sel) =>
      sel && (next.curves.some((c) => c.id === sel) || next.items.some((i) => i.id === sel))
        ? sel
        : null,
    )
    showToast(`Redid: ${next.label}`, { ms: 2200 })
  }, [applyState, takeSnapshot, showToast])

  /**
   * Live-edit bracket: capture once at edit start, commit once at edit end.
   *
   * The label is optional AND defensive: this is handed straight to React
   * event props in places (a slider's onPointerDown), so the first argument
   * can arrive as an event rather than a name.
   */
  const editStart = useCallback(
    (label?: unknown): void => {
      const name = typeof label === 'string' && label.trim() !== '' ? label : 'edit curve'
      if (!preEditRef.current) preEditRef.current = takeSnapshot(name)
    },
    [takeSnapshot],
  )

  const editEnd = useCallback((): void => {
    const pre = preEditRef.current
    preEditRef.current = null
    if (
      pre &&
      (pre.curves !== curvesRef.current ||
        pre.items !== itemsRef.current ||
        pre.styles !== stylesRef.current)
    ) {
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

  // ------------------------------------------------------- curve provenance
  //
  // A sketched curve starts as a READING OF ITS INK, and σ on its card is the
  // distance between the two. Every edit after that — a typed equation, a
  // stated feature, a dragged handle, a typed coefficient — makes the ink a
  // description of something the curve no longer is. Two things depend on
  // knowing which: the card stops showing σ, and asking for another reading
  // stops being free (it refits the ORIGINAL sketch, which would throw the
  // edits away without saying so).

  /** The edit map with one more entry for `id`. Goes INTO the commit's patch. */
  const withEdit = useCallback((id: string, edit: CurveEdit): Record<string, CurveEdit[]> => {
    const list = editsRef.current[id] ?? []
    return { ...editsRef.current, [id]: [...list, edit] }
  }, [])

  /** Record an edit made inside a live bracket (a drag), once per kind. */
  const noteEdit = useCallback((id: string, edit: CurveEdit): void => {
    const list = editsRef.current[id] ?? []
    if (edit.kind !== 'feature' && list.some((e) => e.kind === edit.kind)) return
    const next = { ...editsRef.current, [id]: [...list, edit] }
    editsRef.current = next
    setEdits(next)
  }, [])

  /** Everything this curve owns, minus the curve. */
  const forgetCurve = useCallback(
    (id: string): { displaySources: Record<string, string>; edits: Record<string, CurveEdit[]> } => {
      const { [id]: _src, ...displaySources } = displaySourcesRef.current
      const { [id]: _ed, ...edits } = editsRef.current
      return { displaySources, edits }
    },
    [],
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
      kind: kindRef.current,
      items: itemsRef.current,
      styles: stylesRef.current,
      candidates: candidatesRef.current,
      exprSources: exprSourcesRef.current,
      displaySources: displaySourcesRef.current,
      axisUnits: axisUnitChoiceRef.current,
      viewport: { center: vpRef.current.center, pxPerUnit: vpRef.current.pxPerUnit },
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
    setSaveState('saving')
    window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(saveNow, AUTOSAVE_MS)
  }, [saveNow])

  /** Swap the whole board over to a freshly loaded document. */
  const applyHydrated = useCallback((meta: DocMeta, board: HydratedBoard): void => {
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
    editsRef.current = {}
    selectedRef.current = board.selectedId
    docMetaRef.current = meta
    exprCounterRef.current = board.exprCounter
    docStoredRef.current = false
    undoRef.current = []
    redoRef.current = []
    preEditRef.current = null
    skipAutosaveRef.current = true

    setCurves(board.curves)
    setItems(board.items)
    setKind(board.kind)
    setStyles(board.styles)
    setExprSources(board.exprSources)
    setBrokenExpr(board.brokenExpr)
    setDisplaySources(board.displaySources)
    setAxisUnitChoice(board.axisUnits)
    setEdits({})
    setExtraModels(board.extraModels)
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
    stageRef.current?.redraw()
    nlStageRef.current?.redraw()
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

  const newDocument = useCallback(
    (nextKind: BoardKind = 'cartesian'): void => {
      // Refuse to replace the board when the work on it isn't on disk.
      if (!saveBeforeSwitch()) return
      // "Untitled / Untitled copy / Untitled copy copy", told apart only by
      // "just now" and "4 min ago", was the whole documents list. A board is
      // named for what it IS and numbered from what is already there.
      const doc = createDoc(
        nextDocName(nextKind, listDocs().map((d) => d.name)),
        emptyBoard(nextKind),
      )
      const meta: DocMeta = {
        id: doc.id,
        name: doc.name,
        createdAt: doc.createdAt,
        modifiedAt: doc.modifiedAt,
      }
      applyHydrated(meta, blankBoard(nextKind))
      setLoadNotice(null)
      setConflict(null)
      docStoredRef.current = writeDoc(doc).ok
      setCurrentDoc(meta.id)
      setDocs(listDocs())
    },
    [applyHydrated, blankBoard, saveBeforeSwitch],
  )

  /**
   * Turn this document into the other kind of board.
   *
   * Nothing is thrown away: a board keeps both its curves and its items, and
   * the kind only decides which of the two it is showing and editing. Switching
   * back brings the other set straight back, which is the only behaviour that
   * makes the switch safe to try — and it is one undo step either way.
   */
  const setBoardKind = useCallback(
    (nextKind: BoardKind): void => {
      if (nextKind === kindRef.current) return
      commitState({ kind: nextKind })
      setSelectedId(null)
      if (nextKind === 'number-line') vpRef.current.center = { x: vpRef.current.center.x, y: 0 }
      stageRef.current?.redraw()
      nlStageRef.current?.redraw()
    },
    [commitState],
  )

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
      const from = docMetaRef.current.id
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
      // A copy is the same figure under a new id, so it has to come out the
      // same size. Leaving that to the global "last used" defaults is what
      // reset a 1x document to 2x when it was saved as a copy from the
      // conflict banner — the copy must carry its own settings across.
      copyExportSettings(from, meta.id)
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

  const copyName = useCallback(
    (): string =>
      copyDocName(kindRef.current, docMetaRef.current.name, listDocs().map((d) => d.name)),
    [],
  )

  const duplicateDocument = useCallback((): void => {
    if (!saveBeforeSwitch()) return
    saveBoardAsNewDoc(copyName())
  }, [saveBeforeSwitch, saveBoardAsNewDoc, copyName])

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
    const onBoard =
      kindRef.current === 'number-line'
        ? itemsRef.current.map((i) => i.color)
        : curvesRef.current.map((c) => c.color)
    const used = new Set(onBoard)
    for (const color of CURVE_COLORS) {
      if (!used.has(color)) return color
    }
    return CURVE_COLORS[onBoard.length % CURVE_COLORS.length]
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
      commitState(
        {
          curves: [...curvesRef.current, curve],
          candidates: new Map(candidatesRef.current).set(curve.id, results),
        },
        'draw curve',
      )
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
      const forgotten = forgetCurve(id)
      commitState(
        {
          curves: curvesRef.current.filter((c) => c.id !== id),
          styles: restStyles,
          exprSources: restSources,
          brokenExpr: restBroken,
          ...forgotten,
        },
        'delete curve',
      )
      setSelectedId((sel) => (sel === id ? null : sel))
    },
    [commitState, forgetCurve],
  )

  const clearAll = useCallback((): void => {
    // Clears what this board is actually showing; the other kind's contents are
    // not on screen, so wiping them would be a deletion the user can't see.
    if (kindRef.current === 'number-line') {
      if (itemsRef.current.length === 0) return
      const styles: StyleMap = {}
      for (const c of curvesRef.current) {
        const st = stylesRef.current[c.id]
        if (st) styles[c.id] = st
      }
      commitState({ items: [], styles }, 'remove everything on the line')
      setSelectedId(null)
      return
    }
    if (curvesRef.current.length === 0) return
    const styles: StyleMap = {}
    for (const it of itemsRef.current) {
      const st = stylesRef.current[it.id]
      if (st) styles[it.id] = st
    }
    commitState(
      { curves: [], styles, exprSources: {}, brokenExpr: {}, displaySources: {}, edits: {} },
      'remove all curves',
    )
    setSelectedId(null)
  }, [commitState])

  const toggleVisible = useCallback(
    (id: string): void => {
      const now = curvesRef.current.find((c) => c.id === id)
      commitState(
        {
          curves: curvesRef.current.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c)),
        },
        now && now.visible ? 'hide curve' : 'show curve',
      )
    },
    [commitState],
  )

  const cycleColor = useCallback(
    (id: string): void => {
      commitState(
        {
          curves: curvesRef.current.map((c) => {
            if (c.id !== id) return c
            const idx = CURVE_COLORS.indexOf(c.color)
            const next = CURVE_COLORS[(idx + 1 + CURVE_COLORS.length) % CURVE_COLORS.length]
            return { ...c, color: next }
          }),
        },
        'change colour',
      )
    },
    [commitState],
  )

  const setParam = useCallback(
    (id: string, index: number, value: number): void => {
      noteEdit(id, { kind: 'param' })
      applyState({
        curves: curvesRef.current.map((c) =>
          c.id === id
            ? { ...c, params: c.params.map((p, i) => (i === index ? value : p)) }
            : c,
        ),
      })
    },
    [applyState, noteEdit],
  )

  /**
   * Read this sketch as something else.
   *
   * The candidate was fitted to the ORIGINAL ink, so applying it throws away
   * everything done to the curve since — and it used to do that silently, with
   * no way back other than an undo nobody knew they needed (clicking the first
   * family again does NOT restore the edits; it refits the ink a second time).
   *
   * So: a curve that has only ever been READ is switched straight over. A curve
   * that has been edited gets its feature edits RE-STATED against the new
   * family first — "the zero is at −2" is a fact about the curve, not about the
   * cubic — and only when that is impossible is the teacher asked, once, in one
   * line. Either way it is a single undo step.
   */
  const applyCandidate = useCallback(
    (id: string, cand: FitResult): void => {
      const curve = curvesRef.current.find((c) => c.id === id)
      if (!curve) return
      const name = modelsRef.current[cand.modelId]?.name ?? cand.modelId
      const label = `read as ${name.toLowerCase()}`
      const refit: FittedCurve = {
        ...curve,
        modelId: cand.modelId,
        params: cand.params.slice(),
        kind: cand.kind,
        domain: cand.domain,
        error: cand.error,
      }
      const put = (next: FittedCurve, edits: Record<string, CurveEdit[]>): void => {
        const { [id]: _src, ...displaySources } = displaySourcesRef.current
        commitState(
          {
            curves: curvesRef.current.map((c) => (c.id === id ? next : c)),
            displaySources,
            edits,
          },
          label,
        )
        setSelectedId(id)
      }

      const history = editsRef.current[id] ?? []
      if (history.length === 0) {
        put(refit, editsRef.current)
        return
      }

      // Replayable only when every edit was a stated FEATURE: a typed equation
      // or a dragged handle has no restatement in another family.
      if (history.every((e) => e.kind === 'feature')) {
        let work = refit
        let ok = true
        for (const e of history) {
          if (e.kind !== 'feature') continue
          try {
            const res = applyFeatureEdit(work, modelsRef.current, { point: e.point, to: e.to })
            if (!res || !res.ok || !Array.isArray(res.params) || res.params.some((v) => !Number.isFinite(v))) {
              ok = false
              break
            }
            work = { ...work, params: res.params.slice(), domain: res.domain }
          } catch {
            ok = false
            break
          }
        }
        if (ok) {
          put(work, editsRef.current)
          showFeatureNote({
            kind: 'moved',
            key: Date.now(),
            text: `Read as a ${name.toLowerCase()}, with your ${history.length === 1 ? 'edit' : `${history.length} edits`} re-applied.`,
          })
          return
        }
      }

      setConfirmAsk({
        key: Date.now(),
        text: `This refits your original sketch as a ${name.toLowerCase()} and discards the edits you made — continue?`,
        yes: 'Refit anyway',
        run: () => {
          const { [id]: _gone, ...edits } = editsRef.current
          put(refit, edits)
        },
      })
    },
    [commitState, showFeatureNote],
  )

  const candidatesFor = useCallback(
    (id: string): FitResult[] => candidatesRef.current.get(id) ?? [],
    [],
  )

  // ----------------------------------------------------- drag / nudge editing
  /** Live param+stroke update during a canvas drag (history handled by editStart/End). */
  const dragCurveLive = useCallback(
    (id: string, params: number[], stroke?: { x: number; y: number }[]): void => {
      noteEdit(id, { kind: 'handle' })
      applyState({
        curves: curvesRef.current.map((c) =>
          c.id === id ? { ...c, params, ...(stroke ? { sourceStroke: stroke } : {}) } : c,
        ),
      })
    },
    [applyState, noteEdit],
  )

  /** Live param+domain update during a handle drag. */
  const handleDragLive = useCallback(
    (id: string, params: number[], domain: [number, number] | null): void => {
      noteEdit(id, { kind: 'handle' })
      applyState({
        curves: curvesRef.current.map((c) => (c.id === id ? { ...c, params, domain } : c)),
      })
    },
    [applyState, noteEdit],
  )

  /** Successful oversketch refit: one undoable commit. */
  const oversketchApply = useCallback(
    (id: string, params: number[], error: number): void => {
      commitState(
        {
          curves: curvesRef.current.map((c) => (c.id === id ? { ...c, params, error } : c)),
        },
        'blend stroke',
      )
    },
    [commitState],
  )

  /**
   * A transient notice the STAGE raised, naming something undoable that just
   * happened ("Blended into this curve · Undo"). It arrives as text with the
   * word Undo in it; here it becomes a real button, because a sentence that
   * says Undo and cannot be pressed is worse than no sentence.
   */
  const showNotice = useCallback(
    (text: string): void => {
      const { msg, undoable } = splitNotice(text)
      showToast(msg, undoable ? { action: { label: 'Undo', run: undo } } : undefined)
    },
    [showToast, undo],
  )

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
      commitState(
        {
          curves: curvesRef.current.map((c) =>
            c.id === id
              ? { ...c, params: c.params.map((p, i) => (i === index ? value : p)) }
              : c,
          ),
          edits: withEdit(id, { kind: 'param' }),
        },
        'set coefficient',
      )
    },
    [commitState, withEdit],
  )

  // -------------------------------------------------------- feature editing
  //
  // "Put this zero at x = −2." The teacher states a fact about the curve and
  // the solver decides whether the family can honour it. Three outcomes, all of
  // which must reach the teacher:
  //   ok            — one undoable commit, and NO snapParams (see below).
  //   ok + alsoMoved— the same commit, plus a report of what else shifted.
  //   refused       — nothing changes; the solver's own sentence is shown.

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
      commitState(
        {
          curves: curvesRef.current.map((c) =>
            c.id === curveId ? { ...c, params: res.params.slice(), domain: res.domain } : c,
          ),
          // Recorded so another reading of the same sketch can re-state it.
          edits: withEdit(curveId, { kind: 'feature', point, to }),
        },
        `set ${point.label}`,
      )

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
    [commitState, showFeatureNote, withEdit],
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
      const shownSrc = displaySourcesRef.current[id]
      const madeEdits = editsRef.current[id]
      commitState(
        {
          curves: [...curvesRef.current, copy],
          ...(st ? { styles: { ...stylesRef.current, [copy.id]: st } } : {}),
          ...(cands ? { candidates: new Map(candidatesRef.current).set(copy.id, cands) } : {}),
          ...(srcExpr !== undefined
            ? { exprSources: { ...exprSourcesRef.current, [copy.id]: srcExpr } }
            : {}),
          ...(brokenWhy !== undefined
            ? { brokenExpr: { ...brokenExprRef.current, [copy.id]: brokenWhy } }
            : {}),
          ...(shownSrc !== undefined
            ? { displaySources: { ...displaySourcesRef.current, [copy.id]: shownSrc } }
            : {}),
          ...(madeEdits !== undefined
            ? { edits: { ...editsRef.current, [copy.id]: madeEdits.slice() } }
            : {}),
        },
        'duplicate curve',
      )
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
      commitState(
        { styles: { ...stylesRef.current, [id]: { ...stylesRef.current[id], dash } } },
        'change line style',
      )
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
      commitState(
        {
          curves: [...curvesRef.current, curve],
          exprSources: { ...exprSourcesRef.current, [curve.id]: src },
        },
        'add equation',
      )
      setSelectedId(curve.id)
      return null
    },
    [commitState, pickColor],
  )

  /**
   * Retype the equation ON a card.
   *
   * THE TRADE THIS MAKES. A sketched curve is a member of a family — poly3,
   * sine, circle — and that membership is what gives it drag handles, an
   * arrow-nudge, an Interpretations list and "put this zero at x = 2". A typed
   * expression has none of those. So the edited text is first offered back to
   * the curve's OWN family: when it still is one (new coefficients on the same
   * cubic, however it is written), only the params change and every handle
   * survives. Only when the text is genuinely something else does the curve
   * become a typed expression — and then the board says what was traded, in
   * the same non-modal line that reports a feature edit's side effects, so it
   * is never a silent downgrade. Either way it is one undo entry.
   */
  const setCurveEquation = useCallback(
    (id: string, src: string): string | null => {
      const curve = curvesRef.current.find((c) => c.id === id)
      if (!curve) return null
      const isExpr = curve.modelId.startsWith('expr_')
      // A curve that is already an expression stays one: it has no handles to
      // protect, and its free constants are sliders the user asked for by name.
      const familySpec = isExpr ? undefined : modelsRef.current[curve.modelId]

      let res: ReturnType<typeof readCurveEquation>
      try {
        res = readCurveEquation(src, curve, familySpec)
      } catch {
        return 'The parser crashed on this input'
      }
      if (!res.ok) return res.error

      if (res.mode === 'family') {
        const unchanged =
          res.params.length === curve.params.length &&
          res.params.every((v, i) => Object.is(v, curve.params[i]))
        // Pressing Enter on a line nobody edited is not an edit.
        if (unchanged) return null
        // The curve is still a cubic (or a circle, or a sine) — so every handle
        // and every interpretation survives, and the card goes on printing the
        // line the user wrote. A lesson about factored form must not have its
        // equation expanded the moment it is entered.
        commitState(
          {
            curves: curvesRef.current.map((c) =>
              c.id === id ? { ...c, params: res.params.slice() } : c,
            ),
            displaySources: { ...displaySourcesRef.current, [id]: src },
            edits: withEdit(id, { kind: 'equation' }),
          },
          'edit equation',
        )
        setSelectedId(id)
        return null
      }

      if (isExpr && exprSourcesRef.current[id] === src && brokenExprRef.current[id] === undefined) {
        return null
      }
      const modelId = `expr_${++exprCounterRef.current}`
      let spec: ModelSpec
      try {
        spec = res.plot.makeModel(modelId)
      } catch {
        return 'Could not build a plot from this expression'
      }
      setExtraModels((prev) => ({ ...prev, [modelId]: spec }))
      const lost = isExpr ? null : (familySpec?.name ?? null)
      // The ink belonged to the family that just went away; keeping it would
      // let an oversketch try to refit a model that no longer exists. Undo
      // restores the whole curve, ink included.
      const { sourceStroke: _ink, ...bare } = curve
      const { [id]: _wasBroken, ...restBroken } = brokenExprRef.current
      const { [id]: _shown, ...restShown } = displaySourcesRef.current
      commitState(
        {
          curves: curvesRef.current.map((c) =>
            c.id === id
              ? {
                  ...bare,
                  modelId,
                  kind: res.plot.kind,
                  params: res.plot.defaultParams.slice(),
                  domain: res.plot.domain,
                  error: 0,
                }
              : c,
          ),
          exprSources: { ...exprSourcesRef.current, [id]: src },
          brokenExpr: restBroken,
          displaySources: restShown,
          edits: withEdit(id, { kind: 'equation' }),
        },
        'edit equation',
      )
      setSelectedId(id)
      if (lost) {
        showFeatureNote({
          kind: 'moved',
          key: Date.now(),
          text: `That is no longer a ${lost.toLowerCase()}, so it is a typed equation now — it has no drag handles or fit error. Undo brings the ${lost.toLowerCase()} back.`,
        })
      }
      return null
    },
    [commitState, showFeatureNote, withEdit],
  )

  // ======================================================= number-line items
  //
  // The whole content of this figure is where each endpoint sits and whether it
  // is IN or OUT, so every one of these operations is one of those two facts —
  // and each is a single undoable commit, because each is a single statement a
  // teacher made.

  /** Replace one item, keeping order. */
  const mapItems = useCallback(
    (id: string, fn: (it: NLItem) => NLItem): NLItem[] =>
      itemsRef.current.map((it) => (it.id === id ? fn(it) : it)),
    [],
  )

  /**
   * Add parsed items — one colour, and one GROUP, for the whole answer.
   *
   * "x < −2 or x ≥ 3" is one answer in two pieces. The label used to be given
   * to the first piece only, which put the caption over the left ray and left
   * the right ray with nothing: the label was a property of a piece when it is
   * a property of the answer. It is now stamped on every piece, so it appears
   * over each one rather than being orphaned on whichever came first, and the
   * pieces carry a shared group stamp so the card can still edit and copy the
   * answer as a whole.
   */
  const addItems = useCallback(
    (drafts: NLItemDraft[], label?: string): NLItem[] => {
      if (drafts.length === 0) return []
      const color = pickColor()
      const group = drafts.length > 1 ? nextId() : null
      const made: NLItem[] = drafts.map((d) => ({
        ...d,
        id: nextId(),
        color,
        ...(label ? { label } : {}),
      })) as NLItem[]
      const styles = group === null ? stylesRef.current : { ...stylesRef.current }
      if (group !== null) {
        for (const it of made) styles[it.id] = { ...styles[it.id], group }
      }
      commitState({ items: [...itemsRef.current, ...made], styles })
      setSelectedId(made[0].id)
      return made
    },
    [commitState, pickColor],
  )

  /** Click on the line. A placed point is closed: the value IS in the set. */
  const placePoint = useCallback(
    (x: number): void => {
      addItems([{ kind: 'point', x, closed: true }])
    },
    [addItems],
  )

  const createInterval = useCallback(
    (lo: number, hi: number): void => {
      addItems([{ kind: 'interval', lo, hi, loClosed: true, hiClosed: true }])
    },
    [addItems],
  )

  /** Live endpoint drag. Ends may not cross — they swap roles instead. */
  const moveEndpoint = useCallback(
    (id: string, part: NLPart, x: number): void => {
      applyState({
        items: mapItems(id, (it) => {
          if (it.kind === 'point') return { ...it, x }
          if (part === 'lo') return { ...it, lo: it.hi !== null ? Math.min(x, it.hi) : x }
          if (part === 'hi') return { ...it, hi: it.lo !== null ? Math.max(x, it.lo) : x }
          return it
        }),
      })
    },
    [applyState, mapItems],
  )

  /** The one edit this figure exists for: included <-> excluded. */
  const toggleEnd = useCallback(
    (id: string, part: NLPart): void => {
      commitState({
        items: mapItems(id, (it) => {
          if (it.kind === 'point') return { ...it, closed: !it.closed }
          if (part === 'lo') return { ...it, loClosed: !it.loClosed }
          if (part === 'hi') return { ...it, hiClosed: !it.hiClosed }
          return it
        }),
      })
      setSelectedId(id)
    },
    [commitState, mapItems],
  )

  /** Type an exact endpoint; null means unbounded (drawn as an arrow). */
  const setBound = useCallback(
    (id: string, part: NLPart, value: number | null): void => {
      commitState({
        items: mapItems(id, (it) => {
          if (it.kind === 'point') return value === null ? it : { ...it, x: value }
          if (part === 'lo') {
            // Refusing (-inf, inf) here rather than repairing it later: a set
            // with no ends at all is not something this figure can say.
            if (value === null && it.hi === null) return it
            return { ...it, lo: value === null || it.hi === null ? value : Math.min(value, it.hi) }
          }
          if (part === 'hi') {
            if (value === null && it.lo === null) return it
            return { ...it, hi: value === null || it.lo === null ? value : Math.max(value, it.lo) }
          }
          return it
        }),
      })
    },
    [commitState, mapItems],
  )

  /**
   * Label an answer. Every piece of it takes the label, because a caption that
   * says "solution" belongs over the whole solution set and not over whichever
   * ray happened to be parsed first.
   */
  const setItemLabel = useCallback(
    (id: string, label: string): void => {
      const text = label.trim().slice(0, 60)
      const pieces = new Set(
        answerPieces(itemsRef.current, stylesRef.current, id).map((it) => it.id),
      )
      commitState({
        items: itemsRef.current.map((it) => {
          if (!pieces.has(it.id)) return it
          const { label: _old, ...rest } = it
          return (text ? { ...rest, label: text } : rest) as NLItem
        }),
      })
    },
    [commitState],
  )

  const cycleItemColor = useCallback(
    (id: string): void => {
      commitState({
        items: mapItems(id, (it) => {
          const idx = CURVE_COLORS.indexOf(it.color)
          return { ...it, color: CURVE_COLORS[(idx + 1 + CURVE_COLORS.length) % CURVE_COLORS.length] }
        }),
      })
    },
    [commitState, mapItems],
  )

  const deleteItem = useCallback(
    (id: string): void => {
      const { [id]: _gone, ...restStyles } = stylesRef.current
      commitState({ items: itemsRef.current.filter((it) => it.id !== id), styles: restStyles })
      setSelectedId((sel) => (sel === id ? null : sel))
    },
    [commitState],
  )

  const setItemWidth = useCallback(
    (id: string, width: number): void => {
      applyState({ styles: { ...stylesRef.current, [id]: { ...stylesRef.current[id], width } } })
    },
    [applyState],
  )

  /**
   * Type an inequality. The parser owns what the language accepts and hands
   * back items already sorted and merged, so "x < 1 or x < 3" arrives as one
   * ray rather than two stacked on top of each other.
   */
  const addInequality = useCallback(
    (src: string): string | null => {
      let outcome: ReturnType<typeof parseInequality>
      try {
        outcome = parseInequality(src)
      } catch {
        return 'That couldn’t be read as an inequality'
      }
      if (!outcome.ok) return outcome.error
      if (!Array.isArray(outcome.items) || outcome.items.length === 0) {
        return 'That describes no numbers at all'
      }
      addItems(outcome.items)
      return null
    },
    [addItems],
  )

  /**
   * Restate ONE item from its own card. The parser owns what the language
   * accepts, so this is the same language the "+" box takes — and an answer
   * that is a union ("x < -2 or x >= 3") replaces the item with its parts,
   * in place, keeping the colour and the label the teacher gave it.
   */
  const setItemEquation = useCallback(
    (id: string, src: string): string | null => {
      const at = itemsRef.current.findIndex((it) => it.id === id)
      if (at < 0) return null
      const old = itemsRef.current[at]
      let outcome: ReturnType<typeof parseInequality>
      try {
        outcome = parseInequality(src)
      } catch {
        return 'That couldn’t be read as an inequality'
      }
      if (!outcome.ok) return outcome.error
      if (!Array.isArray(outcome.items) || outcome.items.length === 0) {
        return 'That describes no numbers at all'
      }
      // The first part keeps this item's id, so the selection and the style
      // stay attached to the thing that was being edited. The label goes on
      // every part: it describes the answer, not one of its rays.
      const made: NLItem[] = outcome.items.map((d, i) => ({
        ...d,
        id: i === 0 ? old.id : nextId(),
        color: old.color,
        ...(old.label ? { label: old.label } : {}),
      })) as NLItem[]
      const group = made.length > 1 ? (stylesRef.current[old.id]?.group ?? nextId()) : null
      const styles = { ...stylesRef.current }
      if (group !== null) {
        for (const it of made) styles[it.id] = { ...styles[it.id], group }
      } else if (styles[old.id]?.group !== undefined) {
        const { group: _gone, ...rest } = styles[old.id]
        styles[old.id] = rest
      }
      commitState({
        items: [...itemsRef.current.slice(0, at), ...made, ...itemsRef.current.slice(at + 1)],
        styles,
      })
      setSelectedId(made[0].id)
      return null
    },
    [commitState],
  )

  // ---------------------------------------------------------------- viewport
  const zoomBy = useCallback(
    (factor: number): void => {
      const vp = vpRef.current
      vp.pxPerUnit = clampPpu(vp.pxPerUnit * factor)
      stageRef.current?.redraw()
      nlStageRef.current?.redraw()
      overlayRef.current?.redraw()
      scheduleSave()
    },
    [scheduleSave],
  )

  const resetView = useCallback((): void => {
    const vp = vpRef.current
    vp.center = { x: 0, y: 0 }
    vp.pxPerUnit = 60
    stageRef.current?.redraw()
    nlStageRef.current?.redraw()
    overlayRef.current?.redraw()
    scheduleSave()
  }, [scheduleSave])

  /** Fraction of the frame left as breathing room around the figure. */
  const FIT_MARGIN = 0.12

  /**
   * Frame everything on the board, in one click.
   *
   * Zoom in / zoom out / reset gave a teacher three ways to hunt for a curve
   * they had panned away from and no way to simply be shown it. Reset only
   * goes home; home is not where the work is.
   */
  const fitToContent = useCallback((): void => {
    const vp = vpRef.current
    let box: { min: { x: number; y: number }; max: { x: number; y: number } } | null = null
    if (kindRef.current === 'number-line') {
      const xs: number[] = []
      for (const it of itemsRef.current) {
        if (it.kind === 'point') xs.push(it.x)
        else {
          if (it.lo !== null) xs.push(it.lo)
          if (it.hi !== null) xs.push(it.hi)
        }
      }
      if (xs.length === 0) return
      box = {
        min: { x: Math.min(...xs), y: -0.5 },
        max: { x: Math.max(...xs), y: 0.5 },
      }
    } else {
      const half = vp.widthPx / 2 / vp.pxPerUnit
      const window: [number, number] = [vp.center.x - half, vp.center.x + half]
      box = unionBoxes(
        curvesRef.current
          .filter((c) => c.visible)
          .map((c) => curveBounds(c, modelsRef.current[c.modelId], window)),
      )
    }
    if (!box) {
      showToast('Nothing visible to frame.', { ms: 2000 })
      return
    }
    const w = Math.max(box.max.x - box.min.x, 1e-6)
    const h = Math.max(box.max.y - box.min.y, 1e-6)
    const usableW = vp.widthPx * (1 - 2 * FIT_MARGIN)
    const usableH = vp.heightPx * (1 - 2 * FIT_MARGIN)
    const ppu = clampPpu(Math.min(usableW / w, usableH / h))
    vp.pxPerUnit = ppu
    vp.center = {
      x: (box.min.x + box.max.x) / 2,
      y: kindRef.current === 'number-line' ? 0 : (box.min.y + box.max.y) / 2,
    }
    stageRef.current?.redraw()
    nlStageRef.current?.redraw()
    overlayRef.current?.redraw()
    scheduleSave()
  }, [scheduleSave, showToast])

  /** Pan/zoom happened: the marker layer rides the same viewport. */
  const viewportChanged = useCallback((): void => {
    overlayRef.current?.redraw()
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
  const exportSettingsRef = useRef<FitExportSettings>(exportSettings)
  exportSettingsRef.current = exportSettings
  const showAnalysisRef = useRef(showAnalysis)
  showAnalysisRef.current = showAnalysis
  const canvasThemeRef = useRef(canvasTheme)
  canvasThemeRef.current = canvasTheme
  const contextAnalysisRef = useRef(contextAnalysis)
  contextAnalysisRef.current = contextAnalysis
  const copyTimerRef = useRef(0)

  const boardTheme = canvasTheme === 'light' ? LIGHT_THEME : DARK_THEME

  /**
   * The box every visible thing on the board occupies, in math coords — the
   * same measurement "Fit to curves" makes, so the exported frame and the
   * button that frames the screen agree by construction.
   */
  const exportContent = useCallback(() => {
    const vp = vpRef.current
    const half = vp.widthPx / 2 / vp.pxPerUnit
    return contentBounds({
      kind: kindRef.current,
      curves: curvesRef.current,
      items: itemsRef.current,
      models: modelsRef.current,
      window: [vp.center.x - half, vp.center.x + half],
    })
  }, [])

  const buildExportScene = useCallback(
    (settings: FitExportSettings): BoardScene => {
    const vp = vpRef.current
    const sel = curvesRef.current.find((c) => c.id === selectedRef.current) ?? null
    return {
      // Not the window — the FIGURE. A number line exported as the window was
      // a 40px strip in a 2206x1826 image; a graph was whatever happened to be
      // on screen when Download was pressed.
      vp: exportViewport(
        vp,
        settings,
        settings.fit ? exportContent() : null,
        kindRef.current,
        itemsRef.current,
      ),
      theme: exportTheme(settings, DARK_THEME),
      kind: kindRef.current,
      items: itemsRef.current,
      curves: curvesRef.current,
      styles: stylesRef.current,
      models: modelsRef.current,
      analysis:
        kindRef.current === 'cartesian' &&
        showAnalysisRef.current &&
        sel &&
        sel.visible &&
        analysisRef.current.length > 0
          ? { curve: sel, points: analysisRef.current }
          : null,
      // The screen palette is tuned against near-black and washes out on white
      // (amber lands near 1.7:1 — a copier renders it as nothing), so a light
      // export swaps every curve for its print counterpart.
      printColors: settings.theme === 'light',
      // The PNG is measured the way the screen is. This is the whole point of
      // there being one scene type: a π axis a teacher set for a trig lesson
      // has to be π in the file they paste into the worksheet.
      axisUnits: axisUnitsRef.current,
      chrome: null,
    }
    },
    [exportContent],
  )

  const renderExportCanvas = useCallback((): HTMLCanvasElement | null => {
    const settings = clampFitSettings(exportSettingsRef.current)
    const scene = buildExportScene(settings)
    const out = renderBoardToCanvas(scene, settings)
    if (!out) return null
    // The scene's analysis field describes ONE curve, so the other visible
    // curves' markers are drawn on top of the same picture, in the same
    // geometry — the export says exactly what the screen says.
    const extra = contextAnalysisRef.current
    if (extra.length > 0 && kindRef.current === 'cartesian' && showAnalysisRef.current) {
      const ctx = out.canvas.getContext('2d')
      if (ctx) {
        const geo = out.geometry
        ctx.save()
        ctx.setTransform(geo.scale, 0, 0, geo.scale, geo.margin, geo.margin)
        ctx.beginPath()
        ctx.rect(0, 0, scene.vp.widthPx, scene.vp.heightPx)
        ctx.clip()
        for (const m of extra) {
          const color = settings.theme === 'light' ? toPrintColor(m.curve.color) : m.curve.color
          drawContextMarkers(ctx, scene.vp, m.points, color, scene.theme.bg)
        }
        ctx.restore()
      }
    }
    return out.canvas
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
    const done = (): void => {
      flashCopy({ kind: 'copied' })
      showToast('Copied the figure — paste it into a document.', { ms: 2600 })
    }

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
    (s: FitExportSettings): { w: number; h: number } => {
      const vp = exportViewport(
        vpRef.current,
        s,
        s.fit ? exportContent() : null,
        kindRef.current,
        itemsRef.current,
      )
      const geo = exportGeometry(vp, s)
      return { w: geo.w, h: geo.h }
    },
    [exportContent],
  )

  const changeExportSettings = useCallback((next: FitExportSettings): void => {
    const clean = clampFitSettings(next)
    setExportSettings(clean)
    writeExportSettings(docMetaRef.current.id, clean)
  }, [])

  /**
   * Export settings follow the DOCUMENT: a worksheet's figures have to come out
   * the same size as each other. A document that has none yet inherits the last
   * settings used, so the choice is made once and then stops being a decision.
   */
  const exportDocRef = useRef<string | null>(null)
  const exportKindRef = useRef<BoardKind | null>(null)
  useEffect(() => {
    const sameDoc = exportDocRef.current === docMeta.id
    if (sameDoc && exportKindRef.current === kind) return
    exportDocRef.current = docMeta.id
    exportKindRef.current = kind
    // The kind decides only the FRAMING default (a number line is nearly all
    // whitespace in any window); size, margin and ground still come from the
    // last document worked on, so a worksheet's figures match.
    //
    // A board that CHANGES kind re-reads that default too — a graph turned
    // into a number line would otherwise keep exporting the window, which is
    // the 90%-whitespace strip this option exists to stop. Once the teacher
    // has stated a framing for this document, it is theirs and nothing here
    // overrules it.
    if (sameDoc && hasExportSettings(docMeta.id)) return
    setExportSettings(readExportSettings(docMeta.id, kind))
  }, [docMeta.id, kind])

  /** State one axis. Idempotent — pressing the on segment again changes nothing. */
  const setAxisUnit = useCallback((axis: 'x' | 'y', choice: AxisUnitChoice): void => {
    setAxisUnitChoice((prev) => (prev[axis] === choice ? prev : { ...prev, [axis]: choice }))
  }, [])

  /**
   * Shift+P: the x-axis, round the three states, with the answer said out loud.
   *
   * A cycle rather than a toggle because 'auto' is a state a teacher has to be
   * able to get BACK to, and the shortcut is the only place the control is not
   * on screen. The toast is what makes a three-way key learnable: it names the
   * state it just landed on, including whether the board is deciding.
   */
  const cycleAxisUnitX = useCallback((): void => {
    if (kindRef.current !== 'cartesian') return
    const order: AxisUnitChoice[] = ['auto', 'pi', 'decimal']
    const cur = axisUnitChoiceRef.current.x
    const next = order[(order.indexOf(cur) + 1) % order.length]
    setAxisUnitChoice((prev) => ({ ...prev, x: next }))
    const shown = resolveAxisUnits({ x: next, y: axisUnitChoiceRef.current.y }, {
      x: suggestedXRef.current,
    }).x
    showToast(
      `x axis in ${shown === 'pi' ? 'multiples of π' : 'decimals'}${next === 'auto' ? ' (auto)' : ''}`,
      { ms: 2200 },
    )
  }, [showToast])

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
        if (kindRef.current === 'number-line') deleteItem(selectedRef.current)
        else deleteCurve(selectedRef.current)
      } else if (NUDGE[e.key]) {
        const [ux, uy] = NUDGE[e.key]
        const step = e.shiftKey ? 1 : 0.1
        if (nudgeSelected(ux * step, uy * step)) e.preventDefault()
      } else if (e.key === '\\' && !meta) {
        // The sidebar is half the app and had no key at all.
        e.preventDefault()
        setSidebarOpen((o) => !o)
      } else if (key === 'a' && !meta) {
        setShowAnalysis((v) => {
          const next = !v
          updatePrefs({ showAnalysis: next })
          return next
        })
      } else if (key === 'p' && e.shiftKey && !meta) {
        // The units control lives in the export/settings panel, which is two
        // clicks away mid-lesson; this is the one axis a trig class re-measures.
        e.preventDefault()
        cycleAxisUnitX()
      } else if (key === 'f' && !meta && !e.shiftKey) {
        // One key for the whole mode. A teacher walking to the projector has
        // one hand free and no time to find a menu.
        e.preventDefault()
        setPresentMode((v) => !v)
      } else if (e.key === 'Escape') {
        // Unconditional: leaving a mode you are not in costs nothing, and the
        // alternative is a stale closure deciding whether you are in it.
        setPresentMode(false)
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
  }, [undo, redo, deleteCurve, deleteItem, nudgeSelected, commitWithSnap, cycleAxisUnitX])

  // ------------------------------------------------------------------ render
  const canUndo = undoRef.current.length > 0
  const canRedo = redoRef.current.length > 0

  /**
   * The presentation scaling handed to both stages. Null at 1:1, so a board
   * that is not being presented builds exactly the scene it built before.
   */
  const present = useMemo(
    () => (presentMode ? presentScale(presentType) : null),
    [presentMode, presentType],
  )

  /** Each visible curve's equation, in its own colour, for the legend. */
  const legend = useMemo(
    () =>
      !presentMode
        ? []
        : kind === 'number-line'
          ? itemLegend(items)
          : curveLegend(curves, models, displaySources),
    [presentMode, kind, items, curves, models, displaySources],
  )

  const changePresentType = useCallback((next: number): void => {
    const clean = clampPresentScale(next)
    setPresentType(clean)
    updatePrefs({ presentScale: clean })
  }, [])

  const hasBoardContent = kind === 'number-line' ? items.length > 0 : curves.length > 0

  /** What every number-line card needs to speak for its whole answer. */
  const answerBoard = useMemo(() => ({ items, styles }), [items, styles])

  return (
    <div
      className={`app${canvasTheme === 'light' ? ' canvas-light' : ''}${
        presentMode ? ' present-mode' : ''
      }`}
      data-present={presentMode ? 'on' : 'off'}
    >
      <AnswerContext.Provider value={answerBoard}>
      <Sidebar
        open={sidebarOpen && !presentMode}
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
        curves={curves}
        styles={styles}
        models={models}
        selectedId={selectedId}
        exprOpen={exprOpen}
        snapFlash={snapFlash}
        shake={shake}
        exprSources={exprSources}
        brokenExpr={brokenExpr}
        displaySources={displaySources}
        editedIds={editedIds}
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
        onParamEditStart={() => editStart('move slider')}
        onParamEditEnd={editEnd}
        onParamCommit={(id) => commitWithSnap(id, false)}
        onParamSetExact={setParamExact}
        onApplyCandidate={applyCandidate}
        onCurveEquation={setCurveEquation}
        onStrokeWidth={setStrokeWidth}
        onDash={setDash}
        onOpacity={setOpacity}
        onExprToggle={() => setExprOpen((o) => !o)}
        onExprSubmit={kind === 'number-line' ? addInequality : addExpression}
      />
      </AnswerContext.Provider>

      {sidebarOpen && !presentMode && (
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
        {kind === 'number-line' ? (
          <NumberLineStage
            ref={nlStageRef}
            items={items}
            styles={styles}
            theme={boardTheme}
            selectedId={selectedId}
            mode={MODE}
            inkColor={pickColor()}
            vpRef={vpRef}
            onSelect={setSelectedId}
            onPlacePoint={placePoint}
            onCreateInterval={createInterval}
            onMoveEndpoint={moveEndpoint}
            onToggleEnd={toggleEnd}
            onEditStart={editStart}
            onEditEnd={editEnd}
            onEditCancel={editCancel}
            onViewportChange={viewportChanged}
            present={present}
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
          onSelect={setSelectedId}
          onDrawingChange={setDrawingActive}
          onDragCurve={dragCurveLive}
          onHandleDrag={handleDragLive}
          onOversketch={oversketchApply}
          onOversketchFail={oversketchFail}
          onCurveEditStart={editStart}
          onCurveEditEnd={commitWithSnap}
          onCurveEditCancel={editCancel}
          onViewportChange={viewportChanged}
          onNotice={showNotice}
          analysis={showAnalysis ? analysis : EMPTY_ANALYSIS}
          analysisHighlight={highlight}
          onFeatureEdit={applyFeature}
          theme={boardTheme}
          present={present}
          axisUnits={axisUnits}
        />
        )}

        {kind === 'cartesian' && contextAnalysis.length > 0 && (
          <AnalysisOverlay ref={overlayRef} marked={contextAnalysis} theme={boardTheme} vpRef={vpRef} />
        )}

        {presentMode ? (
          <PresentBar
            scale={presentType}
            canUndo={canUndo}
            onScale={changePresentType}
            onUndo={undo}
            onExit={() => setPresentMode(false)}
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
              hasContent={kind === 'number-line' ? items.length > 0 : curves.length > 0}
              onRename={renameDoc}
              onNew={newDocument}
              onClearBoard={clearAll}
              onOpen={openDocument}
              onDuplicate={duplicateDocument}
              onDelete={deleteDocument}
              onExport={exportDocument}
              onImport={importDocument}
            />
          }
          exportMenu={
            <>
              {/* The presentation switch lives beside Download because both
                  are "the board leaves this window": one to paper, one to a
                  wall. The Toolbar component itself is untouched — it takes
                  this slot as a node. */}
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
                onExport={exportPNG}
                onCopy={copyPNG}
                axisUnits={kind === 'cartesian' ? axisUnitChoice : null}
                resolvedAxisUnits={axisUnits}
                onAxisUnit={setAxisUnit}
              />
            </>
          }
          onToggleSidebar={() => setSidebarOpen((o) => !o)}
          onUndo={undo}
          onRedo={redo}
        />
        )}

        {presentMode && (
          <PresentLegend
            entries={legend}
            type={presentType}
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

        {toast && (
          <div key={toast.key} className="toast" role="status">
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
            <div className="empty-title">Click the line for a point, drag along it for an interval</div>
            <div className="empty-sub">Or press + and type “-2 ≤ x &lt; 5”</div>
          </div>
        )}

        {kind === 'cartesian' && curves.length === 0 && !drawingActive && !loadNotice?.fatal && (
          <div className="empty-hint" aria-hidden="true">
            <div className="empty-glyph">∿</div>
            <div className="empty-title">Draw anything — a wave, a circle, a heart…</div>
            <div className="empty-sub">
              Every stroke becomes a live equation. Select a curve to get handles; drag them, or
              double-click one to type exact values.
            </div>
          </div>
        )}

        {curves.length === 0 && items.length === 0 && !drawingActive && loadNotice?.fatal && (
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
          <button
            className="zoom-btn"
            onClick={fitToContent}
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
    </div>
  )
}

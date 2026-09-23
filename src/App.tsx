import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  BoardKind,
  CurveEnds,
  EndCap,
  FitResult,
  FittedCurve,
  ModelSpec,
  NLItem,
  NLItemDraft,
  ProcessedStroke,
  Vec2,
  Viewport,
} from './core/types'
import { CURVE_COLORS, DARK_THEME, LIGHT_THEME, nextId, toPrintColor } from './core/types'
import { MODELS } from './core/fit/models'
import { parseExpression } from './core/parse'
import { parseInequality } from './core/parse/inequality'
import { applyFeatureEdit, snapParams } from './core/fit/edit'
import { analyzeCurve } from './core/analyze'
import { curveIntersections, derivativeModel, tangentAt } from './core/calculus'
import {
  N_DEFAULT,
  clampN,
  defaultBetweenBounds,
  defaultBounds,
  defaultTangentX,
  dependentsOf,
  fixed as fixedNum,
  isCurveLink,
  labelLegend,
  linkNoun,
  changeLabel,
  countPhrase,
  cardCalc,
  followDomains,
  overlaysFor,
  tangentReadout,
  areaReadout,
  riemannReadout,
} from './ui/calcLinks'
import type { CalcChange, CalcKind, CalcLink, CardCalc } from './ui/calcLinks'
import {
  carryParams,
  compileFields,
  fieldCard,
  fieldLegend,
  looksLikeField,
  readField,
  sceneFields,
  solutionPolylines,
  solveSpan,
  spanCovers,
  countPhrase as fieldCountPhrase,
  throughLabel,
  clampFieldSpacing,
  FIELD_SPACING_DEFAULT,
} from './ui/fieldLinks'
import type { BoardField, CompiledField, FieldCardData } from './ui/fieldLinks'
import {
  compileShapes,
  looksLikeShape,
  moveVertex,
  readShape,
  replaceCoord,
  sceneShapes,
  scanPairs,
  shapeCard,
  shapeLegend,
  pointLabel,
  shapeVertices,
} from './ui/shapeLinks'
import type { BoardShape, CompiledShape, ShapeCardData } from './ui/shapeLinks'
import { POLAR_OFFER, suggestPolarRuling } from './ui/boardGrid'
import { defaultCaption, exportLook, screenLook } from './ui/figureStyle'
import { curveNames, namesInOrder } from './render/curveNames'
import {
  boardIntersections,
  cardIntersections,
  intersectionKey,
  intersectionSpan,
} from './ui/intersections'
import type { BoardIntersection, CurveIntersections } from './ui/intersections'
import { snapCoord, snapPlaced } from './ui/snap'
import { factoredSource } from './core/factored'
import type { FactoredSpec } from './core/factored'
import { moveRoot, rootHandles, safeReadFactored } from './ui/factorLinks'
import type { FactorSide } from './ui/factorLinks'
import { curveBounds, splitNotice, unionBoxes } from './ui/curveState'
import { answerPieces } from './ui/nlText'
import { AnswerContext } from './ui/answerContext'
import { AnalysisOverlay, drawContextMarkers } from './ui/AnalysisOverlay'
import type { AnalysisOverlayHandle } from './ui/AnalysisOverlay'
import type { FeatureEditResult, FigureStyleId, ParsedPlot, SpecialPoint } from './core/types'
import { FIGURE_STYLES } from './core/types'
import { describePoints } from './ui/featureEdit'
import { readCurveEquation } from './ui/equationText'
import { CanvasStage } from './ui/CanvasStage'
import type { CanvasStageHandle, ExtraHandle } from './ui/CanvasStage'
import { NumberLineStage } from './ui/NumberLineStage'
import type { NumberLineStageHandle } from './ui/NumberLineStage'
import type { NLPart } from './render/numberline'
import { Toolbar } from './ui/Toolbar'
import { Sidebar } from './ui/Sidebar'
import type { BetweenInfo } from './ui/CurveCard'
import { DocMenu } from './ui/DocMenu'
import type { SaveState } from './ui/DocMenu'
import { ExportMenu } from './ui/ExportMenu'
import type { CopyState } from './ui/ExportMenu'
import {
  canvasToPngBlob,
  captionHeight,
  exportGeometry,
  exportTheme,
  renderBoardToCanvas,
  suggestAxisUnits,
} from './ui/renderBoard'
import type { AxisUnits, BoardScene, Overlay, Polyline, Shape, SlopeField } from './ui/renderBoard'
import { clampFitSettings, contentBounds, exportViewport } from './ui/exportFit'
import type { FitExportSettings } from './ui/exportFit'
import { PresentBar } from './ui/PresentBar'
import { PresentLegend } from './ui/PresentLegend'
import { DEFAULT_PRESENT_TYPE, curveLegend, itemLegend, presentScale } from './ui/present'
import { copyDocName, nextDocName } from './ui/docName'
import { DERIV_MODEL_PREFIX } from './core/persist'
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
  BoardGrid,
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
import type { WheelPref } from './ui/gestures'

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
/** One array, so a board with nothing crossing re-renders no more than before. */
const EMPTY_CROSSINGS: BoardIntersection[] = []

// ---------------------------------------------------------------- between two
//
// "Area between curves" is one AreaLink with a second curve named in it. The
// mathematics is core's; what the App decides is only how a teacher SAYS which
// second curve they mean, and those decisions are pure — so they live here,
// out of the component, where they can be stated and tested on their own.

/**
 * A fresh area between curves reads |f − g|, not the signed integral.
 *
 * The axis case defaults the other way on purpose: ∫f dx is the thing an AP
 * class is learning to read, sign and all. But "the area between two curves"
 * IS ∫|f − g| — top minus bottom wherever they cross — and a region a teacher
 * can see must never open reading 0.000 because its halves cancelled. The
 * signed integral is still one chip away.
 */
export const BETWEEN_ABS = true

/** What the board says when nobody picked a second curve after all. */
export const BETWEEN_CANCELLED = 'No second curve picked.'

/** Which curves a region on `parentId` could run to: another, on screen, of x. */
export function betweenTargets(
  curves: readonly FittedCurve[],
  models: Record<string, ModelSpec>,
  parentId: string,
): FittedCurve[] {
  return curves.filter(
    (c) => c.id !== parentId && c.visible && models[c.modelId]?.kind === 'explicit',
  )
}

/**
 * What "Area between curves…" does next.
 *
 * With exactly one other curve on the board there is no question to ask — the
 * teacher meant that one, and asking would be a click spent confirming what
 * everyone can see. With two or more, the next tap answers it. With none there
 * is no answer at all, so the offer turns into the reason.
 */
export type BetweenIntent =
  | { act: 'refuse'; say: string }
  | { act: 'create'; otherId: string }
  | { act: 'arm'; say: string }

export function betweenIntent(
  curves: readonly FittedCurve[],
  models: Record<string, ModelSpec>,
  parentId: string,
): BetweenIntent {
  const parent = curves.find((c) => c.id === parentId)
  if (!parent || models[parent.modelId]?.kind !== 'explicit') {
    return { act: 'refuse', say: 'Only a curve that is a function of x can carry calculus objects.' }
  }
  const targets = betweenTargets(curves, models, parentId)
  if (targets.length === 0) return { act: 'refuse', say: 'Draw or type a second curve first.' }
  if (targets.length === 1) return { act: 'create', otherId: targets[0].id }
  return { act: 'arm', say: 'Tap the second curve.' }
}

/** "−1.5", not "−1.50" — the number a teacher would have said out loud. */
function sayX(v: number): string {
  const s = fixedNum(v, 2)
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

/**
 * How a new region introduces itself.
 *
 * Two sentences, because they ask for two different next moves. Bounds that
 * came from where the curves MEET are almost always the region the question
 * is about, and saying so is what stops a teacher hunting for the handles they
 * do not need. Bounds that came from nothing of the sort say exactly that, and
 * name the two chips that fix it.
 */
export function betweenNotice(hits: number, from: number, to: number): string {
  return hits >= 2
    ? `Shaded between the curves from x = ${sayX(from)} to x = ${sayX(to)} (where they meet)`
    : 'No intersection in view — drag a and b to set the region'
}

/**
 * The between-curves facts every card needs, in one pass.
 *
 * Neither is about a curve's own links, which is why they are not in CardCalc:
 * `canAdd` is a question about the BOARD (is there a second curve to point
 * at?), and `notes` is what a curve is owed when it is the far side of a
 * region some OTHER card owns.
 */
export function betweenCardInfo(
  curves: readonly FittedCurve[],
  models: Record<string, ModelSpec>,
  links: readonly CalcLink[],
  nameOf: (curve: FittedCurve) => string,
): Record<string, BetweenInfo> {
  const out: Record<string, BetweenInfo> = {}
  const usable = (c: FittedCurve): boolean =>
    c.visible && models[c.modelId]?.kind === 'explicit'
  const pool = curves.filter(usable).length
  for (const c of curves) {
    // There has to be at least one OTHER curve the region could run to.
    const others = pool - (usable(c) ? 1 : 0)
    out[c.id] = { canAdd: models[c.modelId]?.kind === 'explicit' && others > 0, notes: [] }
  }
  const byId = new Map(curves.map((c) => [c.id, c]))
  for (const l of links) {
    if (l.kind !== 'area' || !l.otherId) continue
    const parent = byId.get(l.parentId)
    const here = out[l.otherId]
    if (!parent || !here) continue
    const name = nameOf(parent)
    here.notes.push(`area between this and ${name} \u2014 see ${name}\u2019s card`)
  }
  return out
}

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
  /**
   * The calculus objects: tangents, derivative curves, shaded integrals,
   * Riemann sums. They are in the SAME history as the curves because they are
   * in the same breath — deleting a curve takes its tangent with it, and one
   * undo has to bring both back or the board comes back half-built.
   */
  calc: CalcLink[]
  /**
   * The slope fields, in the same history for the same reason: a field and the
   * solution curves through it are one object, and one undo has to bring the
   * whole picture back rather than half of it.
   */
  fields: BoardField[]
  /**
   * The shapes, in the same history again: a triangle deleted beside the
   * curve it was measured against has to come back with it, in one undo.
   */
  shapes: BoardShape[]
  /**
   * The LOOK the board is in, and the line printed under the figure.
   *
   * Unlike the ruling and the axis units — which are ways of MEASURING a board
   * and stay out of the history — a style change repaints every pixel of the
   * figure and a caption is words the teacher wrote. Both are therefore one
   * undo each, named after what they did ("figure style: SAT"), because the
   * largest visible change on the board must not be the one thing Cmd+Z will
   * not take back.
   */
  figure: FigureStyleId
  /** The teacher's own caption, or null while the board derives one. */
  caption: string | null
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
  calc?: CalcLink[]
  fields?: BoardField[]
  shapes?: BoardShape[]
  figure?: FigureStyleId
  caption?: string | null
  candidates?: Map<string, FitResult[]>
}

const MIN_PPU = 0.001
const MAX_PPU = 100000
const HISTORY_LIMIT = 100

/** The undo label a run of caption typing folds into. */
const CAPTION_LABEL = 'figure caption'

/** How an end cap names itself in "Undo curve ends: arrow". */
const END_CAP_WORDS: Record<EndCap, string> = {
  auto: 'auto',
  none: 'nothing',
  arrow: 'arrow',
  open: 'open dot',
  closed: 'closed dot',
}

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
  /** "Build from roots" open at the top of the list (src/ui/FactorEditor.tsx). */
  const [factorOpen, setFactorOpen] = useState(false)
  /**
   * Curves built THROUGH A POINT from "Build from roots": curve id → the
   * point. While a curve is in here its leading coefficient is re-solved on
   * every root edit and every root drag, so it keeps passing through the
   * point. UI-side and deliberately not persisted or undone: it is a promise
   * about how edits behave, not part of the function, and the equation on the
   * card is always the whole truth about the curve.
   */
  const [factorThrough, setFactorThrough] = useState<Record<string, Vec2>>({})
  const factorThroughRef = useRef<Record<string, Vec2>>({})
  factorThroughRef.current = factorThrough
  /**
   * The root being dragged: which handle, inside which edit bracket, and the
   * spec it is rewriting. The drag edits THIS spec rather than re-reading the
   * line every frame, so a root dragged past another one stays the root the
   * finger is holding even if the line writes its factors in another order.
   */
  const factorDragRef = useRef<{
    handleId: string
    curveId: string
    bracket: unknown
    spec: FactoredSpec
  } | null>(null)
  const [extraModels, setExtraModels] = useState<Record<string, ModelSpec>>({})
  /**
   * Tangent lines, derivative curves, shaded areas and Riemann sums, as the
   * LINKS that describe them. Nothing here is a result: every number and every
   * pixel they produce is recomputed from the parent curve, which is what lets
   * a slider drag carry all four of them live.
   */
  const [calcLinks, setCalcLinks] = useState<CalcLink[]>([])
  /**
   * Slope fields: dy/dx = f(x, y), and the initial conditions the class threaded
   * solution curves through. Like the calculus links, nothing in here is a
   * result — not the closure, not the lattice, and above all not the integrated
   * curves, which are re-solved from the equation on every change. That is what
   * makes dragging `a` on a logistic field deform every solution curve at once.
   */
  const [fields, setFields] = useState<BoardField[]>([])
  /**
   * The field whose next board click places a solution curve, when the teacher
   * armed one from its menu. Null means the sticky rule instead: a field's card
   * being selected already makes a click on empty board an initial condition.
   */
  const [armedField, setArmedField] = useState<string | null>(null)
  /**
   * The curve whose next TAP ON ANOTHER CURVE completes an "area between
   * curves". Null the rest of the time.
   *
   * One shot, exactly like "+ solution through a point": the teacher has just
   * said what they want, so the very next selection is the answer to the
   * question rather than an ordinary selection. A tap on empty board, a tap
   * back on the same curve, or Escape all cancel — and cancelling costs a
   * sentence, not a state the board is stuck in.
   */
  const [armedBetween, setArmedBetween] = useState<string | null>(null)
  const armedBetweenRef = useRef<string | null>(null)
  armedBetweenRef.current = armedBetween
  /**
   * Points, segments, vectors and polygons. Same declarative rule as the
   * fields: what is held is the LINE THE TEACHER TYPED plus its constants, and
   * every vertex is evaluated out of that on every change — which is why a
   * slider moves a triangle's apex live, and why a dragged vertex rewrites
   * the line rather than being stored beside it.
   */
  const [shapes, setShapes] = useState<BoardShape[]>([])
  /**
   * Which RULING this board is drawn on — the square lattice or the polar one.
   *
   * A property of the DOCUMENT, exactly like the axis units and for the same
   * reason: a polar lesson is a polar lesson on any machine. It is NOT in the
   * undo history, also exactly like the axis units — it is a way of measuring
   * the board, not a thing on it.
   */
  const [boardGrid, setBoardGrid] = useState<BoardGrid>('cartesian')
  /**
   * WHICH LOOK this board is drawn in — the screen, a textbook page, an SAT
   * item, an AP Calculus figure (FIGURE_STYLES in core/types.ts).
   *
   * A property of the DOCUMENT, like the ruling: a figure built for an AP
   * handout is an AP figure tomorrow. Unlike the ruling it IS in the undo
   * history — see Snapshot — because it is the largest single change anything
   * on this board can make to what is drawn.
   *
   * 'screen' is the absence of a style: the scene then carries no `figure` at
   * all and the renderer takes the path it has always taken, theme toggle and
   * curve colours included.
   */
  const [figureStyle, setFigureStyle] = useState<FigureStyleId>('screen')
  /**
   * The caption the teacher WROTE, or null while the board is writing it.
   *
   * Null is the default and the interesting case: the caption then follows the
   * board ("Graph of f", "Graphs of f and g", re-derived on every change to
   * the curves), is never stored, and stops the moment the teacher types over
   * it — at which point this holds their words, '' included, because a caption
   * deliberately cleared is a decision and not an absence.
   */
  const [figureCaption, setFigureCaption] = useState<string | null>(null)
  /**
   * SHOW the chosen style on the board for a minute.
   *
   * The style itself is OUTPUT-only — it is what the PNG and the clipboard
   * copy come out looking like, and the board keeps the teacher's own theme
   * while they sketch on it, because neon on near-black is the one thing a lit
   * board is better at than paper. This switch is how they check the two
   * against each other without giving that up.
   *
   * Deliberately NOT in the document and NOT in the undo history: it is a way
   * of LOOKING at the board, like the sidebar being open. It resets on every
   * document switch (see applyHydrated), so no board is ever opened wearing a
   * look its own file does not describe, and the chip on the canvas turns it
   * off in one click so nobody can be stuck inside it.
   */
  const [previewFigure, setPreviewFigure] = useState(false)
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
  const [wheelPref, setWheelPrefState] = useState<WheelPref>(() => readPrefs().wheel)
  const setWheelPref = useCallback((next: WheelPref): void => {
    setWheelPrefState(next)
    updatePrefs({ wheel: next })
  }, [])
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
  const calcRef = useRef<CalcLink[]>([])
  const fieldsRef = useRef<BoardField[]>([])
  const shapesRef = useRef<BoardShape[]>([])
  const boardGridRef = useRef<BoardGrid>('cartesian')
  boardGridRef.current = boardGrid
  const figureStyleRef = useRef<FigureStyleId>('screen')
  figureStyleRef.current = figureStyle
  const figureCaptionRef = useRef<string | null>(null)
  figureCaptionRef.current = figureCaption
  /**
   * True once this document has been offered the polar ruling, so a board with
   * three roses on it asks once rather than three times. Reset by a load: the
   * next document has not been asked.
   */
  const polarOfferedRef = useRef(false)
  /** Highest dfdx_N registered, so a new derivative cannot collide with one. */
  const derivCounterRef = useRef(0)
  /**
   * linkId -> the parent state the dependent was last rebuilt from. The sync
   * pass compares against it, so a dependent is recomputed exactly when its
   * parent moved — and a derivative curve whose own slider the teacher dragged
   * is left alone until the parent says otherwise.
   */
  const calcSigRef = useRef<Map<string, string>>(new Map())
  /**
   * Each curve's domain the last time the calculus sync ran, so a limit that
   * sat on an end of the sketch can ride that end when it is dragged.
   */
  const calcDomainRef = useRef<Map<string, [number, number] | null>>(new Map())
  /**
   * Links whose curve the BOARD hid because the mathematics went away (a
   * tangent at a corner). Remembered so restoring it can never override a
   * teacher who hid the curve themselves.
   */
  const calcAutoHiddenRef = useRef<Set<string>>(new Set())
  /**
   * linkId -> the parent family a numerically-differentiated derivative's
   * closure was built from. It only has to be rebuilt when THAT changes; on a
   * slider tick the same closure with new params is the same mathematics.
   */
  const calcSpecOriginRef = useRef<Map<string, string>>(new Map())
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
      calc: calcRef.current,
      fields: fieldsRef.current,
      shapes: shapesRef.current,
      figure: figureStyleRef.current,
      caption: figureCaptionRef.current,
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
    if (s.calc) {
      calcRef.current = s.calc
      setCalcLinks(s.calc)
    }
    if (s.fields) {
      fieldsRef.current = s.fields
      setFields(s.fields)
    }
    if (s.shapes) {
      shapesRef.current = s.shapes
      setShapes(s.shapes)
    }
    // Compared against undefined, not truthiness: '' is a caption a teacher
    // deliberately cleared, and an undo has to be able to bring it back.
    if (s.figure !== undefined) {
      figureStyleRef.current = s.figure
      setFigureStyle(s.figure)
    }
    if (s.caption !== undefined) {
      figureCaptionRef.current = s.caption
      setFigureCaption(s.caption)
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
      sel &&
      (prev.curves.some((c) => c.id === sel) ||
        prev.items.some((i) => i.id === sel) ||
        prev.fields.some((f) => f.id === sel) ||
        prev.shapes.some((sh) => sh.id === sel))
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
      sel &&
      (next.curves.some((c) => c.id === sel) ||
        next.items.some((i) => i.id === sel) ||
        next.fields.some((f) => f.id === sel) ||
        next.shapes.some((sh) => sh.id === sel))
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
        pre.styles !== stylesRef.current ||
        // Moving an integral's limit or dragging n changes NO curve — it
        // changes the link. Without this, the one gesture on the board that
        // leaves the curves alone was also the one gesture undo could not
        // take back. A field's slider and a dragged initial condition are the
        // same case: they move no curve at all.
        pre.calc !== calcRef.current ||
        pre.fields !== fieldsRef.current ||
        // And a dragged vertex: it rewrites the shape's own line and touches
        // no curve at all.
        pre.shapes !== shapesRef.current)
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
      calc: [],
      fields: [],
      shapes: [],
      grid: 'cartesian',
      figure: 'screen',
      caption: '',
      captionAuto: true,
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
      fields: fieldsRef.current,
      shapes: shapesRef.current,
      grid: boardGridRef.current,
      figure: figureStyleRef.current,
      // The DERIVED caption is not the document's: it is re-derived from the
      // curves on every load, so storing it would freeze a sentence that is
      // supposed to follow the board — and would change the bytes of every
      // board that never had a caption.
      caption: figureCaptionRef.current ?? '',
      captionAuto: figureCaptionRef.current === null,
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
    // The links come back; everything they DRAW is rebuilt from them by the
    // sync pass below, against the models this load just registered. A
    // reopened board is therefore live, not a photograph.
    calcRef.current = board.calc
    // Same rule: the equations come back, everything they DRAW is re-derived.
    fieldsRef.current = board.fields
    // And the shapes: the lines come back, every vertex is evaluated again.
    shapesRef.current = board.shapes
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
    setCalcLinks(board.calc)
    setFields(board.fields)
    setShapes(board.shapes)
    setBoardGrid(board.grid)
    setFigureStyle(board.figure)
    setFigureCaption(board.captionAuto ? null : board.caption)
    // A view of the board, not a property of it: every document opens on the
    // theme, whatever the last one was being previewed in.
    setPreviewFigure(false)
    setArmedField(null)
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
    // And the ruling, which is a property of the document like the units.
    boardGrid,
    // And the look the figure is in, with its caption: both are the document's
    // and neither touches a curve, so without this a board restyled for an AP
    // handout would come back tomorrow as a screen board.
    figureStyle,
    figureCaption,
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
        : [
            ...curvesRef.current.map((c) => c.color),
            // A slope field is in the same list and the same palette: handing
            // a new field the colour of the curve above it would be the one
            // collision the cycle exists to prevent.
            ...fieldsRef.current.map((f) => f.color),
            // And a shape, for the same reason again: one list, one palette.
            ...shapesRef.current.map((sh) => sh.color),
          ]
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

  /** Everything `ids` owns, transitively: the curves and the links. */
  const removeWithDependents = useCallback(
    (ids: string[], label: string): { curves: FittedCurve[]; lost: CalcLink[] } => {
      const dead = dependentsOf(calcRef.current, ids)
      const lost = calcRef.current.filter((l) => dead.linkIds.has(l.id))
      const curves = curvesRef.current.filter((c) => !dead.curveIds.has(c.id))
      const styles: StyleMap = {}
      for (const [id, st] of Object.entries(stylesRef.current)) {
        if (!dead.curveIds.has(id)) styles[id] = st
      }
      const exprSources: Record<string, string> = {}
      for (const [id, src] of Object.entries(exprSourcesRef.current)) {
        if (!dead.curveIds.has(id)) exprSources[id] = src
      }
      const brokenExpr: Record<string, string> = {}
      for (const [id, why] of Object.entries(brokenExprRef.current)) {
        if (!dead.curveIds.has(id)) brokenExpr[id] = why
      }
      const displaySources: Record<string, string> = {}
      for (const [id, src] of Object.entries(displaySourcesRef.current)) {
        if (!dead.curveIds.has(id)) displaySources[id] = src
      }
      const edits: Record<string, CurveEdit[]> = {}
      for (const [id, list] of Object.entries(editsRef.current)) {
        if (!dead.curveIds.has(id)) edits[id] = list
      }
      commitState(
        {
          curves,
          calc: calcRef.current.filter((l) => !dead.linkIds.has(l.id)),
          styles,
          exprSources,
          brokenExpr,
          displaySources,
          edits,
        },
        label,
      )
      setSelectedId((sel) => (sel && dead.curveIds.has(sel) ? null : sel))
      return { curves, lost }
    },
    [commitState],
  )

  const deleteCurve = useCallback(
    (id: string): void => {
      // Everything the curve owns goes in ONE commit — its styles, its
      // equation text, and the calculus objects that only exist because it
      // does. A tangent left behind pointing at nothing is not a curve the
      // board can draw, and a second undo to finish the job is not an undo.
      const { lost } = removeWithDependents([id], 'delete curve')
      if (lost.length === 0) return
      const kinds = [...new Set(lost.map((l) => linkNoun(l.kind)))].join(', ')
      showToast(
        `Deleted the curve and ${countPhrase(lost.length, 'thing')} that depended on it (${kinds}). Undo brings all of it back.`,
        { ms: 5000, action: { label: 'Undo', run: undo } },
      )
    },
    [removeWithDependents, showToast, undo],
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
    if (
      curvesRef.current.length === 0 &&
      fieldsRef.current.length === 0 &&
      shapesRef.current.length === 0
    ) {
      return
    }
    const styles: StyleMap = {}
    for (const it of itemsRef.current) {
      const st = stylesRef.current[it.id]
      if (st) styles[it.id] = st
    }
    commitState(
      {
        curves: [],
        calc: [],
        fields: [],
        shapes: [],
        styles,
        exprSources: {},
        brokenExpr: {},
        displaySources: {},
        edits: {},
      },
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

  /**
   * One end of one curve gets a cap. 'auto' is not stored — it is the absence
   * of a choice, the state in which the figure style answers — so choosing it
   * REMOVES the end, and a style whose ends are both back to auto loses the
   * key entirely. That keeps the style map saying only what a teacher said.
   */
  const setEnds = useCallback(
    (id: string, which: 'start' | 'end', cap: EndCap): void => {
      const prev = stylesRef.current[id]
      const ends: CurveEnds = { ...prev?.ends }
      if (cap === 'auto') delete ends[which]
      else ends[which] = cap
      const next: CurveStyle = { ...prev }
      if (ends.start === undefined && ends.end === undefined) delete next.ends
      else next.ends = ends
      commitState(
        { styles: { ...stylesRef.current, [id]: next } },
        `curve ends: ${END_CAP_WORDS[cap]}`,
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


  // ======================================================= calculus objects
  //
  // Four things a class does TO a graph — a tangent at a point, f′, the area
  // under it, a Riemann sum — added from the curve's own card.
  //
  // None of them is a new kind of object. A tangent is a `line` curve; a
  // derivative is a curve in f′'s own family (so it arrives with sliders,
  // handles and an analysis table already working); an area and a Riemann sum
  // are overlays the renderer already draws. What the board REMEMBERS is only
  // the link — which curve, at which x, over which interval, with how many
  // rectangles — and everything visible is recomputed from it by syncCalc()
  // below, on every change to the parent. That is why dragging the cubic's
  // slider carries the tangent, the parabola, the shading and 200 rectangles
  // with it: none of them is a stored answer that could go stale.

  /** The derivative's line style: f and f′ read as a pair, not as two curves. */
  const DERIV_DASH = [8, 6]

  /** What a curve is CALLED in a sentence, e.g. "tangent to Cubic at x = 2". */
  const curveLabel = useCallback((curve: FittedCurve): string => {
    const spec = modelsRef.current[curve.modelId]
    if (spec && !curve.modelId.startsWith('expr_') && spec.name) return spec.name
    const typed = exprSourcesRef.current[curve.id] ?? displaySourcesRef.current[curve.id]
    if (typed && typed.trim()) {
      const t = typed.trim()
      return t.length > 24 ? `${t.slice(0, 23)}…` : t
    }
    return spec?.name ?? curve.modelId
  }, [])

  /** The x-range on screen — the fallback a fresh interval is measured in. */
  const viewWindow = useCallback((): [number, number] => {
    const vp = vpRef.current
    const half = vp.widthPx / 2 / vp.pxPerUnit
    return [vp.center.x - half, vp.center.x + half]
  }, [])

  /**
   * The x-range the board hunts intersections over — the window, padded, and
   * SNAPPED to a coarse grid (see intersectionSpan).
   *
   * It is state rather than a ref because it feeds a memo; it changes only
   * when the board has genuinely moved somewhere new, which is what keeps a
   * pan from re-solving every pair on the board on every frame.
   */
  const [crossSpan, setCrossSpan] = useState<[number, number]>(() =>
    intersectionSpan(viewWindow()),
  )
  const crossSpanRef = useRef(crossSpan)
  crossSpanRef.current = crossSpan

  /** Called on every frame of a pan; does nothing at all until the grid moves. */
  const refreshCrossSpan = useCallback((): void => {
    const next = intersectionSpan(viewWindow())
    const now = crossSpanRef.current
    if (next[0] === now[0] && next[1] === now[1]) return
    crossSpanRef.current = next
    setCrossSpan(next)
  }, [viewWindow])

  /** Rename the edit bracket a gesture already opened, so undo says the truth. */
  const relabelEdit = useCallback((label: string): void => {
    const pre = preEditRef.current
    if (pre && pre.label !== label) preEditRef.current = { ...pre, label }
  }, [])

  const addCalcObject = useCallback(
    (parentId: string, kind: CalcKind): void => {
      const parent = curvesRef.current.find((c) => c.id === parentId)
      if (!parent) return
      const models = modelsRef.current
      const spec = models[parent.modelId]
      if (!spec || spec.kind !== 'explicit') {
        showToast('Only a curve that is a function of x can carry calculus objects.')
        return
      }
      const linkId = nextId()
      const win = viewWindow()

      if (kind === 'tangent') {
        const x = defaultTangentX(parent, models, win)
        let t: ReturnType<typeof tangentAt> = null
        try {
          t = tangentAt(parent, models, x)
        } catch {
          t = null
        }
        if (!t) {
          showToast(`This curve has no tangent line at x = ${fixedNum(x, 2)}.`)
          return
        }
        // A REAL line curve: params [b, m], its own card, its own handles, and
        // it exports because every curve does.
        const curve: FittedCurve = {
          id: nextId(),
          modelId: 'line',
          params: [t.b, t.m],
          kind: 'explicit',
          domain: null,
          color: parent.color,
          strokeWidth: 2,
          visible: true,
          error: 0,
        }
        commitState(
          {
            curves: [...curvesRef.current, curve],
            calc: [...calcRef.current, { kind: 'tangent', id: linkId, parentId, curveId: curve.id, x }],
          },
          'add tangent',
        )
        setSelectedId(curve.id)
        return
      }

      if (kind === 'derivative') {
        // The id is only SPENT if the derivative turns out to need a closure of
        // its own; a cubic's derivative is a library parabola and registers
        // nothing at all.
        const n = derivCounterRef.current + 1
        const wantId = `${DERIV_MODEL_PREFIX}${n}`
        let d: ReturnType<typeof derivativeModel> = null
        try {
          d = derivativeModel(parent, models, wantId)
        } catch {
          d = null
        }
        if (!d) {
          showToast('This curve cannot be differentiated.')
          return
        }
        if (d.spec.id === wantId) {
          derivCounterRef.current = n
          const built = d.spec
          setExtraModels((prev) => ({ ...prev, [wantId]: built }))
          calcSpecOriginRef.current.set(linkId, parent.modelId)
        }
        const curve: FittedCurve = {
          id: nextId(),
          modelId: d.spec.id,
          params: d.params.slice(),
          kind: 'explicit',
          domain: d.domain,
          color: parent.color,
          strokeWidth: 2.5,
          visible: true,
          error: 0,
        }
        commitState(
          {
            curves: [...curvesRef.current, curve],
            calc: [...calcRef.current, { kind: 'derivative', id: linkId, parentId, curveId: curve.id }],
            styles: {
              ...stylesRef.current,
              [curve.id]: { ...stylesRef.current[curve.id], dash: DERIV_DASH.slice() },
            },
          },
          'add derivative',
        )
        setSelectedId(curve.id)
        return
      }

      const [from, to] = defaultBounds(parent, win)
      if (kind === 'area') {
        commitState(
          { calc: [...calcRef.current, { kind: 'area', id: linkId, parentId, from, to, abs: false }] },
          'add area',
        )
      } else {
        commitState(
          {
            calc: [
              ...calcRef.current,
              { kind: 'riemann', id: linkId, parentId, from, to, n: N_DEFAULT, method: 'left' },
            ],
          },
          'add Riemann sum',
        )
      }
      setSelectedId(parentId)
    },
    [commitState, showToast, viewWindow],
  )

  // ------------------------------------------------- area between two curves
  //
  // The same AreaLink, with a second curve named in it. Everything that makes
  // it different — the shading running to g instead of to the axis, the
  // readout saying ∫|f − g|, the link dying with EITHER curve — follows from
  // that one field; what the App owns is only how a teacher says which second
  // curve they mean. The decisions themselves are pure, above.

  /**
   * Shade between `parentId` and `otherId`.
   *
   * `abs` starts TRUE, unlike the axis case. "The area between two curves" in
   * an AP class means ∫|f − g| — top minus bottom, wherever they cross — and a
   * region that visibly has area must not open reading 0 because the halves
   * cancelled. The signed integral is one chip away for the lesson that wants
   * it. Returns false when the pair cannot carry one, having said why.
   */
  const createAreaBetween = useCallback(
    (parentId: string, otherId: string): boolean => {
      const parent = curvesRef.current.find((c) => c.id === parentId)
      const other = curvesRef.current.find((c) => c.id === otherId)
      const models = modelsRef.current
      if (!parent || !other || parent.id === other.id) return false
      if (
        models[parent.modelId]?.kind !== 'explicit' ||
        models[other.modelId]?.kind !== 'explicit'
      ) {
        showToast('An area between curves needs two curves that are functions of x.')
        return false
      }
      const win = viewWindow()
      let bounds: [number, number]
      try {
        bounds = defaultBetweenBounds(parent, other, models, win)
      } catch {
        bounds = defaultBounds(parent, win)
      }
      const [from, to] = bounds
      const linkId = nextId()
      // abs TRUE, unlike the axis case — see BETWEEN_ABS.
      const abs = BETWEEN_ABS
      commitState(
        {
          calc: [
            ...calcRef.current,
            { kind: 'area', id: linkId, parentId, otherId, from, to, abs },
          ],
        },
        'area between curves',
      )
      setSelectedId(parentId)
      // Where they MEET is the region the question is almost always about, so
      // say whether the opening bounds are that or merely a guess the teacher
      // now has to fix. Two different sentences, because they ask for two
      // different next moves.
      let hits: number[] = []
      try {
        hits = curveIntersections(parent, other, models, win) ?? []
      } catch {
        hits = []
      }
      showToast(betweenNotice(hits.length, from, to), {
        ms: 5000,
        action: { label: 'Undo', run: undo },
      })
      return true
    },
    [commitState, showToast, undo, viewWindow],
  )

  /**
   * The menu item. With exactly one other curve on the board there is nothing
   * to ask — the teacher meant that one — so it is shaded immediately. With
   * two or more, the next tap says which, and the notice says so.
   */
  const addAreaBetween = useCallback(
    (parentId: string): void => {
      const intent = betweenIntent(curvesRef.current, modelsRef.current, parentId)
      if (intent.act === 'refuse') {
        showToast(intent.say)
        return
      }
      setSelectedId(parentId)
      if (intent.act === 'create') {
        createAreaBetween(parentId, intent.otherId)
        return
      }
      setArmedBetween(parentId)
      showToast(intent.say, { ms: 6000 })
    },
    [createAreaBetween, showToast],
  )

  /** Give up on the pick, in words — an armed board must never be silent. */
  const cancelBetween = useCallback((): void => {
    if (!armedBetweenRef.current) return
    setArmedBetween(null)
    showToast(BETWEEN_CANCELLED, { ms: 2200 })
  }, [showToast])

  /**
   * Selection, as the BOARD and the SIDEBAR state it.
   *
   * Ordinarily this is just setSelectedId. While a second curve is being
   * picked it is the answer to a question instead: the tap that would have
   * selected g shades between f and g, and a tap on empty board (or back on f)
   * is the teacher changing their mind.
   */
  const selectObject = useCallback(
    (id: string | null): void => {
      const armed = armedBetweenRef.current
      if (!armed) {
        setSelectedId(id)
        return
      }
      setArmedBetween(null)
      if (!id || id === armed) {
        showToast(BETWEEN_CANCELLED, { ms: 2200 })
        setSelectedId(armed)
        return
      }
      if (createAreaBetween(armed, id)) return
      setSelectedId(id)
    },
    [createAreaBetween, showToast],
  )

  /**
   * One stated change to one link.
   *
   * `live` is a drag or a slider in flight: the state moves without a history
   * entry of its own, inside the bracket the gesture opened, so a drag from
   * a = 0 to a = 3 is ONE undo called "move area bound" rather than forty.
   */
  const changeCalc = useCallback(
    (change: CalcChange, live = false): void => {
      const links = calcRef.current
      const i = links.findIndex((l) => l.id === change.linkId)
      if (i < 0) return
      const l = links[i]
      let next: CalcLink | null = null
      if (change.kind === 'tangentX' && l.kind === 'tangent') {
        if (!Number.isFinite(change.x) || change.x === l.x) return
        next = { ...l, x: change.x }
      } else if (change.kind === 'bound' && (l.kind === 'area' || l.kind === 'riemann')) {
        if (!Number.isFinite(change.value) || l[change.which] === change.value) return
        next = { ...l, [change.which]: change.value } as CalcLink
      } else if (change.kind === 'abs' && l.kind === 'area') {
        if (l.abs === change.abs) return
        next = { ...l, abs: change.abs }
      } else if (change.kind === 'n' && l.kind === 'riemann') {
        const n = clampN(change.n)
        if (n === l.n) return
        next = { ...l, n }
      } else if (change.kind === 'method' && l.kind === 'riemann') {
        if (l.method === change.method) return
        next = { ...l, method: change.method }
      }
      if (!next) return
      const list = links.slice()
      list[i] = next
      if (live) {
        relabelEdit(changeLabel(change))
        applyState({ calc: list })
      } else {
        commitState({ calc: list }, changeLabel(change))
      }
    },
    [applyState, commitState, relabelEdit],
  )

  /** Take one calculus object off the board, with its curve when it has one. */
  const removeCalcObject = useCallback(
    (linkId: string): void => {
      const link = calcRef.current.find((l) => l.id === linkId)
      if (!link) return
      const label = `remove ${linkNoun(link.kind)}`
      if (isCurveLink(link)) {
        removeWithDependents([link.curveId], label)
        return
      }
      commitState({ calc: calcRef.current.filter((l) => l.id !== linkId) }, label)
    },
    [commitState, removeWithDependents],
  )

  /**
   * Rebuild every dependent whose parent has moved.
   *
   * Runs after any change to the curves, the models or the links, and does
   * nothing at all unless a parent's family, params, domain or colour actually
   * changed — which is what lets a teacher drag the DERIVATIVE's own slider
   * without the parent immediately overruling them.
   *
   * It never pushes history: a dependent moving is not a thing the teacher
   * did, it is the consequence of the thing they did, and it rides inside that
   * action's own undo entry.
   */
  const syncCalc = useCallback((): void => {
    const links = calcRef.current
    const before = curvesRef.current
    // Limits first: an area whose limits sat on the ends of the sketch keeps
    // covering the whole sketch after the teacher drags an end. This is a
    // consequence of their drag, so it rides inside the drag's own undo entry.
    const followed = links.length > 0 ? followDomains(links, calcDomainRef.current, before) : null
    calcDomainRef.current = new Map(before.map((c) => [c.id, c.domain]))
    if (followed) {
      applyState({ calc: followed })
      return // the effect re-runs on the new links and finishes the sync
    }
    if (links.length === 0) return
    const models = modelsRef.current
    const byId = new Map(before.map((c) => [c.id, c]))
    const patches = new Map<string, Partial<FittedCurve>>()
    const register: Record<string, ModelSpec> = {}

    for (const link of links) {
      if (!isCurveLink(link)) continue
      const parent = byId.get(link.parentId)
      const child = byId.get(link.curveId)
      if (!parent || !child) continue
      const sig = `${parent.modelId}|${parent.params.join(',')}|${
        parent.domain ? parent.domain.join(',') : ''
      }|${parent.color}|${link.kind === 'tangent' ? link.x : ''}`
      if (calcSigRef.current.get(link.id) === sig) continue
      calcSigRef.current.set(link.id, sig)

      let patch: Partial<FittedCurve> | null = null
      if (link.kind === 'tangent') {
        let t: ReturnType<typeof tangentAt> = null
        try {
          t = tangentAt(parent, models, link.x)
        } catch {
          t = null
        }
        // No tangent at a corner, a pole or outside the domain: the line HIDES
        // rather than keeping the last one it had. A stale tangent on a
        // projector is a wrong answer that looks like a right one.
        if (t) patch = { params: [t.b, t.m], color: parent.color }
      } else {
        // A library derivative registers nothing; only a closure needs an id,
        // and asking for one under the child's CURRENT id would overwrite a
        // library family (poly2) with a difference quotient if the parent had
        // just been retyped into an expression.
        const fresh = MODELS[child.modelId] !== undefined
        const n = derivCounterRef.current + 1
        const wantId = fresh ? `${DERIV_MODEL_PREFIX}${n}` : child.modelId
        let d: ReturnType<typeof derivativeModel> = null
        try {
          d = derivativeModel(parent, models, wantId)
        } catch {
          d = null
        }
        if (d) {
          if (d.spec.id === wantId) {
            // The closure closes over the PARENT'S spec, so it only has to be
            // rebuilt when the parent changed family — not on every slider tick.
            if (fresh) derivCounterRef.current = n
            if (fresh || calcSpecOriginRef.current.get(link.id) !== parent.modelId) {
              register[wantId] = d.spec
              calcSpecOriginRef.current.set(link.id, parent.modelId)
            }
          }
          patch = {
            modelId: d.spec.id,
            params: d.params.slice(),
            domain: d.domain,
            kind: 'explicit',
            color: parent.color,
          }
        }
      }

      if (!patch) {
        if (child.visible) {
          patches.set(child.id, { visible: false })
          calcAutoHiddenRef.current.add(link.id)
        }
        continue
      }
      if (calcAutoHiddenRef.current.delete(link.id) && !child.visible) patch.visible = true
      patches.set(child.id, patch)
    }

    if (Object.keys(register).length > 0) setExtraModels((prev) => ({ ...prev, ...register }))
    if (patches.size === 0) return
    const after = before.map((c) => {
      const patch = patches.get(c.id)
      if (!patch) return c
      const merged = { ...c, ...patch }
      // Identical values must not produce a new object: a fresh curve array on
      // every frame would re-run every memo the board has for nothing.
      const same =
        merged.modelId === c.modelId &&
        merged.color === c.color &&
        merged.visible === c.visible &&
        merged.params.length === c.params.length &&
        merged.params.every((v, i) => Object.is(v, c.params[i])) &&
        String(merged.domain) === String(c.domain)
      return same ? c : merged
    })
    if (after.every((c, i) => c === before[i])) return
    applyState({ curves: after })
  }, [applyState])

  // The sync is an EFFECT, not a callback on each mutation, because a parent
  // can move in a dozen different ways (slider, handle, typed equation, undo,
  // document load) and every one of them has to carry its dependents. One
  // place that notices the board changed is one place that can be right.
  useEffect(() => {
    syncCalc()
  }, [curves, models, calcLinks, syncCalc])

  // ============================================================== slope fields
  //
  // dy/dx = f(x, y) is not a curve, so it is not a FittedCurve: there is no y
  // to evaluate, only a direction at every point. What the board holds is the
  // sentence the teacher typed, the constants its sliders are at, and the
  // points the class asked a solution curve to pass through. The lattice and
  // every solution curve are recomputed from those — see src/ui/fieldLinks.ts
  // — which is why a slider drag carries all of them live and why a reopened
  // document is live rather than a photograph.

  /** One field, replaced in place. The list order is the sidebar's order. */
  const mapField = useCallback(
    (id: string, fn: (f: BoardField) => BoardField): BoardField[] =>
      fieldsRef.current.map((f) => (f.id === id ? fn(f) : f)),
    [],
  )

  /**
   * Add a differential equation to the board.
   *
   * Returns the parser's own message when it refuses, so the equation box
   * shows a slope field's complaint in exactly the place it shows an
   * equation's.
   */
  const addField = useCallback(
    (src: string): string | null => {
      const outcome = readField(src)
      if (!outcome.ok) return outcome.error
      const field: BoardField = {
        id: nextId(),
        src,
        params: outcome.defaultParams.slice(),
        color: pickColor(),
        spacingPx: FIELD_SPACING_DEFAULT,
        visible: true,
        solutions: [],
      }
      commitState({ fields: [...fieldsRef.current, field] }, 'add slope field')
      setSelectedId(field.id)
      return null
    },
    [commitState, pickColor],
  )

  /**
   * Retype a field's equation.
   *
   * The constants that survive keep their values BY NAME (carryParams): the
   * whole point of turning y' = a*y into y' = a*y*(1 - y/k) mid-lesson is that
   * a is still the a the class just set. The initial conditions survive too —
   * the point (0, 0.2) is a statement about the picture, not about the
   * formula — so the same solution curves are re-integrated through the new
   * field and the class sees what changed.
   */
  const setFieldEquation = useCallback(
    (id: string, src: string): string | null => {
      const field = fieldsRef.current.find((f) => f.id === id)
      if (!field) return null
      if (field.src === src) return null
      const outcome = readField(src)
      if (!outcome.ok) return outcome.error
      const was = readField(field.src)
      const params = carryParams(
        was.ok ? was.paramNames : [],
        field.params,
        outcome.paramNames,
        outcome.defaultParams,
      )
      commitState(
        { fields: mapField(id, (f) => ({ ...f, src, params })) },
        'edit equation',
      )
      setSelectedId(id)
      return null
    },
    [commitState, mapField],
  )

  /** A constant in flight. Inside the bracket the slider's press opened. */
  const setFieldParam = useCallback(
    (id: string, index: number, value: number): void => {
      if (!Number.isFinite(value)) return
      relabelEdit('move slider')
      applyState({
        fields: mapField(id, (f) => {
          const params = f.params.slice()
          params[index] = value
          return { ...f, params }
        }),
      })
    },
    [applyState, mapField, relabelEdit],
  )

  /** A typed exact constant: one commit, one undo entry, full precision. */
  const setFieldParamExact = useCallback(
    (id: string, index: number, value: number): void => {
      if (!Number.isFinite(value)) return
      commitState(
        {
          fields: mapField(id, (f) => {
            const params = f.params.slice()
            params[index] = value
            return { ...f, params }
          }),
        },
        'set value',
      )
      setSelectedId(id)
    },
    [commitState, mapField],
  )

  const setFieldSpacing = useCallback(
    (id: string, px: number): void => {
      const want = clampFieldSpacing(px)
      const now = fieldsRef.current.find((f) => f.id === id)
      if (!now || now.spacingPx === want) return
      commitState(
        { fields: mapField(id, (f) => ({ ...f, spacingPx: want })) },
        'change field spacing',
      )
    },
    [commitState, mapField],
  )

  const toggleFieldVisible = useCallback(
    (id: string): void => {
      const now = fieldsRef.current.find((f) => f.id === id)
      commitState(
        { fields: mapField(id, (f) => ({ ...f, visible: !f.visible })) },
        now && now.visible ? 'hide slope field' : 'show slope field',
      )
    },
    [commitState, mapField],
  )

  const cycleFieldColor = useCallback(
    (id: string): void => {
      const now = fieldsRef.current.find((f) => f.id === id)
      if (!now) return
      const i = CURVE_COLORS.indexOf(now.color)
      const next = CURVE_COLORS[(i + 1) % CURVE_COLORS.length]
      commitState({ fields: mapField(id, (f) => ({ ...f, color: next })) }, 'change colour')
    },
    [commitState, mapField],
  )

  /**
   * Delete a field, and with it every solution curve threaded through it.
   *
   * They are one object: a solution curve is a claim about THIS field, and
   * there is nothing left to integrate once the field is gone. So they go in
   * one commit, the toast says how many went, and one undo brings all of it
   * back — the same contract deleting a curve with a tangent on it has.
   */
  const deleteField = useCallback(
    (id: string): void => {
      const field = fieldsRef.current.find((f) => f.id === id)
      if (!field) return
      commitState(
        { fields: fieldsRef.current.filter((f) => f.id !== id) },
        'delete slope field',
      )
      setArmedField((a) => (a === id ? null : a))
      setSelectedId((sel) => (sel === id ? null : sel))
      const n = field.solutions.length
      showToast(
        n === 0
          ? 'Deleted the slope field. Undo brings it back.'
          : `Deleted the slope field and ${fieldCountPhrase(n, 'solution curve')} through it. Undo brings all of it back.`,
        { ms: 5000, action: { label: 'Undo', run: undo } },
      )
    },
    [commitState, showToast, undo],
  )

  // ------------------------------------------------------- solution curves

  /** A tap on the board while a field is selected, or one its menu armed. */
  const addSolution = useCallback(
    (fieldId: string, at: Vec2): void => {
      if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return
      const field = fieldsRef.current.find((f) => f.id === fieldId)
      if (!field) return
      // A point put down with a finger lands on the grid's own ladder. The tap
      // that used to place (−0.041667, 1.975) places (0, 2), which is what the
      // teacher meant and what the class can copy down. A TYPED initial
      // condition stays exactly as typed — see setSolutionCoord.
      const on = snapPlaced(at, vpRef.current)
      const sol = { id: nextId(), x: on.x, y: on.y }
      commitState(
        { fields: mapField(fieldId, (f) => ({ ...f, solutions: [...f.solutions, sol] })) },
        'add solution curve',
      )
      setSelectedId(fieldId)
    },
    [commitState, mapField],
  )

  /**
   * Move one initial condition. `live` is the drag: the point moves inside the
   * bracket the press opened, so dragging it across the board is ONE undo
   * called "move solution point" rather than one per frame.
   */
  const moveSolution = useCallback(
    (fieldId: string, solutionId: string, to: { x?: number; y?: number }, live = false): void => {
      const field = fieldsRef.current.find((f) => f.id === fieldId)
      const sol = field?.solutions.find((s) => s.id === solutionId)
      if (!field || !sol) return
      const x = to.x !== undefined ? to.x : sol.x
      const y = to.y !== undefined ? to.y : sol.y
      if (!Number.isFinite(x) || !Number.isFinite(y)) return
      if (x === sol.x && y === sol.y) return
      const patch = {
        fields: mapField(fieldId, (f) => ({
          ...f,
          solutions: f.solutions.map((s) => (s.id === solutionId ? { ...s, x, y } : s)),
        })),
      }
      if (live) {
        relabelEdit('move solution point')
        applyState(patch)
      } else {
        commitState(patch, 'move solution point')
      }
    },
    [applyState, commitState, mapField, relabelEdit],
  )

  const removeSolution = useCallback(
    (fieldId: string, solutionId: string): void => {
      commitState(
        {
          fields: mapField(fieldId, (f) => ({
            ...f,
            solutions: f.solutions.filter((s) => s.id !== solutionId),
          })),
        },
        'remove solution curve',
      )
    },
    [commitState, mapField],
  )

  // -------------------------------------------------- what the fields draw

  /** Every field's closure, its LaTeX and its slider names, in one pass. */
  const fieldCompiled = useMemo<Map<string, CompiledField>>(
    () => (kind === 'cartesian' ? compileFields(fields) : new Map()),
    [kind, fields],
  )

  const fieldScene = useMemo<SlopeField[]>(
    () => sceneFields(fields, fieldCompiled),
    [fields, fieldCompiled],
  )

  /**
   * The x-range the solution curves on the board have been integrated across.
   *
   * It is STATE rather than a reading of the viewport because the viewport is
   * a mutable ref that pan and zoom change without re-rendering App — and
   * because it must not move on every frame of a pan. It grows only when the
   * window has actually reached past what was already solved (spanCovers), so
   * zooming in, or panning inside the 50% margin, re-uses curve that is
   * already there instead of re-integrating for an identical picture.
   */
  const [solvedSpan, setSolvedSpan] = useState<[number, number]>(() => [-10, 10])
  const solvedSpanRef = useRef<[number, number]>(solvedSpan)
  solvedSpanRef.current = solvedSpan
  /** True while anything needs solving at all — checked on the pan hot path. */
  const hasSolutionsRef = useRef(false)
  hasSolutionsRef.current = fields.some((f) => f.visible && f.solutions.length > 0)

  /** Re-solve if the window has grown past the margin. Cheap, and idempotent. */
  const refreshSolveSpan = useCallback((): void => {
    if (!hasSolutionsRef.current) return
    const vp = vpRef.current
    const half = vp.widthPx / 2 / vp.pxPerUnit
    const window: [number, number] = [vp.center.x - half, vp.center.x + half]
    if (spanCovers(solvedSpanRef.current, window)) return
    const next = solveSpan(window)
    solvedSpanRef.current = next
    setSolvedSpan(next)
  }, [])

  // The first field on a board was solved across the startup default, which is
  // not this window; a board opened zoomed out would show curves that stopped
  // in mid-air. One check per change to the field list costs nothing.
  useEffect(() => {
    refreshSolveSpan()
  }, [fields, refreshSolveSpan])

  const fieldPolylines = useMemo<Polyline[]>(
    () => solutionPolylines(fields, fieldCompiled, solvedSpan),
    [fields, fieldCompiled, solvedSpan],
  )

  const fieldSceneRef = useRef<SlopeField[]>(fieldScene)
  fieldSceneRef.current = fieldScene
  const fieldPolylinesRef = useRef<Polyline[]>(fieldPolylines)
  fieldPolylinesRef.current = fieldPolylines

  /** Everything each field's card says, computed once for all of them. */
  const fieldCards = useMemo<Record<string, FieldCardData>>(() => {
    const out: Record<string, FieldCardData> = {}
    for (const f of fields) out[f.id] = fieldCard(f, fieldCompiled)
    return out
  }, [fields, fieldCompiled])

  /**
   * Where a click on the board places an initial condition.
   *
   * Two ways in, and they differ only in how long they last. The menu item
   * arms ONE press, anywhere, because the teacher has just said what they
   * want. Simply having a field's card selected arms every tap on EMPTY board
   * — a tap on a curve still selects that curve — because placing six initial
   * conditions in a row is the actual gesture of the lesson.
   */
  const pointPick = useMemo(() => {
    const armed = armedField && fields.some((f) => f.id === armedField) ? armedField : null
    const selectedField = fields.some((f) => f.id === selectedId) ? selectedId : null
    const target = armed ?? selectedField
    if (kind !== 'cartesian' || !target) return null
    return {
      label: 'solution through this point',
      sticky: armed === null,
      onPick: (pos: Vec2): void => {
        setArmedField(null)
        addSolution(target, pos)
      },
    }
  }, [kind, armedField, selectedId, fields, addSolution])

  const fieldCardFor = useCallback(
    (id: string): FieldCardData | undefined => fieldCards[id],
    [fieldCards],
  )

  /** The menu item: the very next press on the board is an initial condition. */
  const armSolution = useCallback(
    (id: string): void => {
      setSelectedId(id)
      setArmedField(id)
      showToast('Click the board where the solution curve should pass through.', { ms: 4000 })
    },
    [showToast],
  )

  /** Type one coordinate of an initial condition exactly. */
  const setSolutionCoord = useCallback(
    (fieldId: string, solutionId: string, to: { x?: number; y?: number }): void => {
      moveSolution(fieldId, solutionId, to, false)
    },
    [moveSolution],
  )

  // A field that is no longer selected is no longer armed: the one-shot was
  // about the card the teacher had open.
  useEffect(() => {
    if (armedField && armedField !== selectedId) setArmedField(null)
  }, [armedField, selectedId])

  // ==================================================================== shapes
  //
  // A point, a segment, a vector, a polygon. Not curves: there is no x
  // sweeping across the board, only a handful of places. What is held is the
  // LINE THE TEACHER TYPED plus the constants its sliders are at; every vertex
  // is evaluated out of that (src/ui/shapeLinks.ts), which is what makes a
  // slider move an apex live and a reopened document a live figure.
  //
  // The consequence that makes shapes different from everything else here: a
  // vertex dragged with a finger REWRITES THE LINE. There is nowhere else for
  // the number to go — a stored vertex beside a source that disagrees with it
  // is a contradiction the next load would resolve the wrong way — so a
  // coordinate written `a` becomes the number, exactly as if it had been
  // typed. Typing one does the same thing. One rule, two gestures.

  const shapeCompiledRef = useRef<Map<string, CompiledShape>>(new Map())

  /** One shape, replaced in place. The list order is the sidebar's order. */
  const mapShape = useCallback(
    (id: string, fn: (s: BoardShape) => BoardShape): BoardShape[] =>
      shapesRef.current.map((s) => (s.id === id ? fn(s) : s)),
    [],
  )

  /**
   * Add a shape to the board.
   *
   * Returns the parser's own message when it refuses, so the equation box
   * shows a triangle's complaint in exactly the place it shows an equation's.
   */
  const addShape = useCallback(
    (src: string): string | null => {
      const outcome = readShape(src)
      if (!outcome.ok) return outcome.error
      const shape: BoardShape = {
        id: nextId(),
        src,
        params: outcome.defaultParams.slice(),
        color: pickColor(),
        fill: false,
        visible: true,
      }
      commitState({ shapes: [...shapesRef.current, shape] }, 'add shape')
      setSelectedId(shape.id)
      return null
    },
    [commitState, pickColor],
  )

  /**
   * Restate a shape from a new line of text — retyped on the card, or
   * rewritten by a drag or a typed coordinate.
   *
   * The constants that survive keep their values BY NAME (carryParams), for
   * the reason a field's do: turning `(a, 0)` into `(a, b)` mid-lesson must
   * leave a where the class just put it.
   */
  const restateShape = useCallback(
    (id: string, src: string, label: string, live: boolean): string | null => {
      const shape = shapesRef.current.find((s) => s.id === id)
      if (!shape) return null
      if (shape.src === src) return null
      const outcome = readShape(src)
      if (!outcome.ok) return outcome.error
      const was = readShape(shape.src)
      const params = carryParams(
        was.ok ? was.paramNames : [],
        shape.params,
        outcome.paramNames,
        outcome.defaultParams,
      )
      const patch = { shapes: mapShape(id, (s) => ({ ...s, src, params })) }
      if (live) {
        relabelEdit(label)
        applyState(patch)
      } else {
        commitState(patch, label)
      }
      return null
    },
    [applyState, commitState, mapShape, relabelEdit],
  )

  const setShapeEquation = useCallback(
    (id: string, src: string): string | null => restateShape(id, src, 'edit shape', false),
    [restateShape],
  )

  /** A constant in flight. Inside the bracket the slider's press opened. */
  const setShapeParam = useCallback(
    (id: string, index: number, value: number): void => {
      if (!Number.isFinite(value)) return
      relabelEdit('move slider')
      applyState({
        shapes: mapShape(id, (s) => {
          const params = s.params.slice()
          params[index] = value
          return { ...s, params }
        }),
      })
    },
    [applyState, mapShape, relabelEdit],
  )

  /** A typed exact constant: one commit, one undo entry, full precision. */
  const setShapeParamExact = useCallback(
    (id: string, index: number, value: number): void => {
      if (!Number.isFinite(value)) return
      commitState(
        {
          shapes: mapShape(id, (s) => {
            const params = s.params.slice()
            params[index] = value
            return { ...s, params }
          }),
        },
        'set value',
      )
      setSelectedId(id)
    },
    [commitState, mapShape],
  )

  const toggleShapeVisible = useCallback(
    (id: string): void => {
      const now = shapesRef.current.find((s) => s.id === id)
      commitState(
        { shapes: mapShape(id, (s) => ({ ...s, visible: !s.visible })) },
        now && now.visible ? 'hide shape' : 'show shape',
      )
    },
    [commitState, mapShape],
  )

  const cycleShapeColor = useCallback(
    (id: string): void => {
      const now = shapesRef.current.find((s) => s.id === id)
      if (!now) return
      const i = CURVE_COLORS.indexOf(now.color)
      const next = CURVE_COLORS[(i + 1) % CURVE_COLORS.length]
      commitState({ shapes: mapShape(id, (s) => ({ ...s, color: next })) }, 'change colour')
    },
    [commitState, mapShape],
  )

  const toggleShapeFill = useCallback(
    (id: string): void => {
      const now = shapesRef.current.find((s) => s.id === id)
      if (!now) return
      commitState(
        { shapes: mapShape(id, (s) => ({ ...s, fill: !s.fill })) },
        now.fill ? 'unfill polygon' : 'fill polygon',
      )
    },
    [commitState, mapShape],
  )

  const deleteShape = useCallback(
    (id: string): void => {
      const shape = shapesRef.current.find((s) => s.id === id)
      if (!shape) return
      commitState({ shapes: shapesRef.current.filter((s) => s.id !== id) }, 'delete shape')
      setSelectedId((cur) => (cur === id ? null : cur))
      showToast('Deleted the shape. Undo brings it back.', {
        action: { label: 'Undo', run: () => undo() },
      })
    },
    [commitState, showToast, undo],
  )

  /**
   * Type one exact coordinate.
   *
   * It REPLACES that coordinate's source text, which is the whole point: a
   * vertex written `a` and then typed as 4 is at 4, not at wherever the slider
   * happens to be. Exact and unsnapped — a typed number is a statement.
   */
  const setShapeCoord = useCallback(
    (id: string, pair: number, axis: 'x' | 'y', value: number): void => {
      if (!Number.isFinite(value)) return
      const shape = shapesRef.current.find((s) => s.id === id)
      if (!shape) return
      const next = replaceCoord(shape.src, pair, axis, value)
      if (!next) return
      restateShape(id, next, 'set coordinate', false)
      setSelectedId(id)
    },
    [restateShape],
  )

  /**
   * Drag one vertex. Inside the bracket the press opened, so a vertex dragged
   * across the board is ONE undo called "move vertex" rather than one a frame.
   *
   * Snapped (src/ui/snap.ts): a corner put down with a finger lands on the
   * grid's own ladder, because "(3.9583, 2.9917)" is not a vertex anybody
   * means and not a number a class can copy down.
   */
  const dragShapeVertex = useCallback(
    (id: string, pair: number, to: Vec2): void => {
      const shape = shapesRef.current.find((s) => s.id === id)
      if (!shape) return
      const compiled = shapeCompiledRef.current.get(id)
      if (!compiled?.shape) return
      const vertex = shapeVertices(compiled.shape, scanPairs(shape.src)).find(
        (v) => v.pair === pair,
      )
      if (!vertex) return
      const next = moveVertex(shape.src, vertex, snapPlaced(to, vpRef.current))
      if (!next) return
      restateShape(id, next, 'move vertex', true)
    },
    [restateShape],
  )

  // ------------------------------------------------ what the shapes draw

  /** Every shape's vertices, its LaTeX and its slider names, in one pass. */
  const shapeCompiled = useMemo<Map<string, CompiledShape>>(
    () => (kind === 'cartesian' ? compileShapes(shapes) : new Map()),
    [kind, shapes],
  )
  shapeCompiledRef.current = shapeCompiled

  const shapeScene = useMemo<Shape[]>(
    () => sceneShapes(shapes, shapeCompiled),
    [shapes, shapeCompiled],
  )
  const shapeSceneRef = useRef<Shape[]>(shapeScene)
  shapeSceneRef.current = shapeScene

  /** Everything each shape's card says, computed once for all of them. */
  const shapeCards = useMemo<Record<string, ShapeCardData>>(() => {
    const out: Record<string, ShapeCardData> = {}
    for (const s of shapes) out[s.id] = shapeCard(s, shapeCompiled)
    return out
  }, [shapes, shapeCompiled])

  const shapeCardFor = useCallback(
    (id: string): ShapeCardData | undefined => shapeCards[id],
    [shapeCards],
  )

  // ------------------------------------------------------- typed expressions
  /** Parse and add a typed expression. Returns an error message, or null on success. */
  const addExpression = useCallback(
    (src: string, label = 'add equation'): string | null => {
      // A differential equation is not an equation: "dy/dx = x - y" would be
      // read by parseExpression as a product of d, y and x set equal to
      // another, and the board would quietly draw an implicit curve nobody
      // asked for. So the field parser is asked FIRST, and anything that even
      // starts like a derivative stays on this branch — with the slope-field
      // parser's own positioned complaint — rather than falling through to a
      // second parser that can only be confused by it.
      const asField = readField(src)
      if (asField.ok) return addField(src)
      if (looksLikeField(src)) return asField.error

      // Then a shape. "(1, 2)" is a point and "ABC = (0,0) (4,0) (4,3)" is a
      // triangle; both are things the expression parser would either refuse or
      // — worse — quietly read as something else.
      const asShape = readShape(src)
      if (asShape.ok) return addShape(src)

      let outcome: ReturnType<typeof parseExpression>
      try {
        outcome = parseExpression(src)
      } catch {
        return 'The parser crashed on this input'
      }
      if (!outcome.ok) {
        // BOTH parsers have now refused it. Which complaint is the useful one
        // depends on what the teacher was evidently writing: the shape parser
        // refuses "y = x" and "(x+1)(x-2)" as loudly as it refuses a malformed
        // triangle, and its "that is a curve" is the last thing someone typing
        // a curve needs to read. So its message surfaces only when the line
        // clearly IS a shape — a shape word, a name and a bracket, or a line
        // that opens with one.
        if (looksLikeShape(src)) return asShape.error
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
        label,
      )
      setSelectedId(curve.id)
      return null
    },
    [addField, addShape, commitState, pickColor],
  )

  /**
   * The one path that makes a curve a TYPED EXPRESSION from a parsed line, in
   * place: same id, colour, style, calculus links and name — only its model,
   * domain and source change. A card's retyped equation takes it, and so does
   * every edit from a Roots section and every dragged root on the board.
   *
   * `live` is a drag in flight: the state moves inside the bracket the press
   * opened (so a whole drag is one undo, named `label`) instead of committing
   * an entry of its own.
   */
  const restateAsExpression = useCallback(
    (
      id: string,
      src: string,
      plot: ParsedPlot,
      label: string,
      live: boolean,
    ): string | null => {
      const curve = curvesRef.current.find((c) => c.id === id)
      if (!curve) return null
      const modelId = `expr_${++exprCounterRef.current}`
      let spec: ModelSpec
      try {
        spec = plot.makeModel(modelId)
      } catch {
        return 'Could not build a plot from this expression'
      }
      setExtraModels((prev) => ({ ...prev, [modelId]: spec }))
      // The ink belonged to the family that just went away; keeping it would
      // let an oversketch try to refit a model that no longer exists. Undo
      // restores the whole curve, ink included.
      const { sourceStroke: _ink, ...bare } = curve
      const { [id]: _wasBroken, ...restBroken } = brokenExprRef.current
      const { [id]: _shown, ...restShown } = displaySourcesRef.current
      const patch: StatePatch = {
        curves: curvesRef.current.map((c) =>
          c.id === id
            ? {
                ...bare,
                modelId,
                kind: plot.kind,
                params: plot.defaultParams.slice(),
                domain: plot.domain,
                error: 0,
              }
            : c,
        ),
        exprSources: { ...exprSourcesRef.current, [id]: src },
        brokenExpr: restBroken,
        displaySources: restShown,
      }
      if (live) {
        relabelEdit(label)
        noteEdit(id, { kind: 'equation' })
        applyState(patch)
      } else {
        commitState({ ...patch, edits: withEdit(id, { kind: 'equation' }) }, label)
        setSelectedId(id)
      }
      return null
    },
    [applyState, commitState, noteEdit, relabelEdit, withEdit],
  )

  /**
   * Rewrite a TYPED curve's line and restate it in place — the Roots
   * section's edits and a dragged root both end here. Refuses (with the
   * parser's words) a line that does not parse, and does nothing for a line
   * that has not changed.
   */
  const restateTypedCurve = useCallback(
    (id: string, src: string, label: string, live = false): string | null => {
      const curve = curvesRef.current.find((c) => c.id === id)
      if (!curve || !curve.modelId.startsWith('expr_')) return null
      if (exprSourcesRef.current[id] === src && brokenExprRef.current[id] === undefined) return null
      let res: ReturnType<typeof readCurveEquation>
      try {
        res = readCurveEquation(src, curve, undefined)
      } catch {
        return 'The parser crashed on this input'
      }
      if (!res.ok) return res.error
      if (res.mode === 'family') return null
      return restateAsExpression(id, src, res.plot, label, live)
    },
    [restateAsExpression],
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
      const lost = isExpr ? null : (familySpec?.name ?? null)
      const err = restateAsExpression(id, src, res.plot, 'edit equation', false)
      if (err) return err
      if (lost) {
        showFeatureNote({
          kind: 'moved',
          key: Date.now(),
          text: `That is no longer a ${lost.toLowerCase()}, so it is a typed equation now — it has no drag handles or fit error. Undo brings the ${lost.toLowerCase()} back.`,
        })
      }
      return null
    },
    [restateAsExpression, commitState, showFeatureNote, withEdit],
  )

  // ======================================================= built from roots
  //
  // A function set by its roots is an ordinary TYPED curve: "Build from roots"
  // writes its line (src/core/factored.ts) and hands it to addExpression, and
  // every later edit — a Roots section on the card, a root dragged on the
  // board — rewrites that line and restates the curve in place through the
  // same path a retyped equation takes. Nothing downstream knows.

  /** "Add to graph": the normal typed-equation path, one undo entry. */
  const buildFromRoots = useCallback(
    (spec: FactoredSpec, through: Vec2 | null): string | null => {
      let src: string
      try {
        src = factoredSource(spec)
      } catch {
        return 'These factors could not be written out.'
      }
      const before = curvesRef.current
      const err = addExpression(src, 'build from roots')
      if (err) return err
      const made = curvesRef.current.find((c) => !before.includes(c))
      if (made && through) {
        setFactorThrough((m) => ({ ...m, [made.id]: { x: through.x, y: through.y } }))
      }
      setFactorOpen(false)
      return null
    },
    [addExpression],
  )

  /** One committed edit from a card's Roots section. */
  const restateFactors = useCallback(
    (id: string, src: string, label: string): string | null =>
      restateTypedCurve(id, src, label, false),
    [restateTypedCurve],
  )

  const dropFactorThrough = useCallback((id: string): void => {
    setFactorThrough((m) => {
      if (!(id in m)) return m
      const { [id]: _gone, ...rest } = m
      return rest
    })
  }, [])

  const factorThroughFor = useCallback(
    (id: string): Vec2 | null => factorThrough[id] ?? null,
    [factorThrough],
  )

  /**
   * Drag one root along the x-axis. Snapped to the grid's own ladder, written
   * as a plain number, restated live inside the bracket the press opened — so
   * the whole drag is one undo. `a` is kept, unless the curve was built
   * through a point, in which case it is re-solved to keep passing through it.
   */
  const dragFactorRoot = useCallback(
    (curveId: string, side: FactorSide, index: number, handleId: string, to: Vec2): void => {
      const bracket = preEditRef.current
      let s = factorDragRef.current
      if (!s || s.handleId !== handleId || s.curveId !== curveId || s.bracket !== bracket || !bracket) {
        const spec = safeReadFactored(exprSourcesRef.current[curveId])
        if (!spec) return
        s = { handleId, curveId, bracket, spec }
        factorDragRef.current = s
      }
      const next = moveRoot(
        s.spec,
        side,
        index,
        snapCoord(to.x, vpRef.current),
        factorThroughRef.current[curveId] ?? null,
      )
      if (!next || next === s.spec) return
      let src: string
      try {
        src = factoredSource(next)
      } catch {
        return
      }
      const err = restateTypedCurve(
        curveId,
        src,
        side === 'num' ? 'move root' : 'move asymptote',
        true,
      )
      if (!err) s.spec = next
    },
    [restateTypedCurve],
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
      refreshSolveSpan()
      scheduleSave()
    },
    [refreshSolveSpan, scheduleSave],
  )

  const resetView = useCallback((): void => {
    const vp = vpRef.current
    vp.center = { x: 0, y: 0 }
    vp.pxPerUnit = 60
    stageRef.current?.redraw()
    nlStageRef.current?.redraw()
    overlayRef.current?.redraw()
    refreshSolveSpan()
    scheduleSave()
  }, [refreshCrossSpan, refreshSolveSpan, scheduleSave])

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
      const boxes = curvesRef.current
        .filter((c) => c.visible)
        .map((c) => curveBounds(c, modelsRef.current[c.modelId], window))
      // A differential-equations board often has no curves on it at all: the
      // figure IS the solution curves threading the lattice, and "Fit to
      // curves" on such a board used to say there was nothing to frame. The
      // field itself fills the plane and has no extent to measure, so it is
      // the polylines that are framed.
      for (const poly of fieldPolylinesRef.current) {
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        for (const pt of poly.pts) {
          if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue
          if (pt.x < minX) minX = pt.x
          if (pt.x > maxX) maxX = pt.x
          if (pt.y < minY) minY = pt.y
          if (pt.y > maxY) maxY = pt.y
        }
        if (minX <= maxX && minY <= maxY) {
          boxes.push({ min: { x: minX, y: minY }, max: { x: maxX, y: maxY } })
        }
      }
      box = unionBoxes(boxes)
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
    refreshSolveSpan()
    scheduleSave()
  }, [refreshSolveSpan, scheduleSave, showToast])

  /** Pan/zoom happened: the marker layer rides the same viewport. */
  const viewportChanged = useCallback((): void => {
    overlayRef.current?.redraw()
    // Where the curves cross is hunted over the window, so panning can bring a
    // crossing into view that was never solved for. Hot path: this is a pair
    // of comparisons unless the board has left the coarse span entirely.
    refreshCrossSpan()
    // A solution curve is integrated across a fixed x-range, so a board panned
    // or zoomed past that range would show it stopping in mid-air. This is the
    // hot path — it fires on every frame of a pan — and refreshSolveSpan does
    // nothing at all unless the window has genuinely left the solved span.
    refreshSolveSpan()
    scheduleSave()
  }, [refreshSolveSpan, scheduleSave])

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

  // ------------------------------------------------- what the board draws
  //
  // The shading and the rectangles are FIGURE, not chrome: they carry the
  // mathematics the lesson is about, so they go into the scene and reach the
  // exported PNG through exactly the same field the screen uses.
  const overlays = useMemo<Overlay[]>(
    () => (kind === 'cartesian' ? overlaysFor(calcLinks, curves, models) : []),
    [kind, calcLinks, curves, models],
  )
  const overlaysRef = useRef<Overlay[]>(overlays)
  overlaysRef.current = overlays

  /** Everything the cards say about calculus, computed once for all of them. */
  const calcCards = useMemo<Record<string, CardCalc>>(
    () => (kind === 'cartesian' ? cardCalc(calcLinks, curves, models, curveLabel) : {}),
    [kind, calcLinks, curves, models, curveLabel],
  )
  const calcFor = useCallback(
    (id: string): CardCalc | undefined => calcCards[id],
    [calcCards],
  )

  /**
   * What each card knows about areas BETWEEN curves.
   *
   * Two separate facts, neither of which is about the curve's own links, which
   * is why they are not in CardCalc: whether the board currently holds a
   * second curve to point at (the menu item's whole condition), and whether
   * this curve is the far side of a region some other card owns.
   */
  const betweenCards = useMemo<Record<string, BetweenInfo>>(
    () =>
      kind === 'cartesian'
        ? betweenCardInfo(curves, models, calcLinks, curveLabel)
        : {},
    [kind, curves, models, calcLinks, curveLabel],
  )

  const betweenFor = useCallback(
    (id: string): BetweenInfo | undefined => betweenCards[id],
    [betweenCards],
  )

  /**
   * The points a teacher can grab that belong to a calculus object rather than
   * to a curve family: a tangent's point (which slides ALONG the parent) and
   * an interval's two ends (which slide along the x-axis).
   *
   * Only the selected curve's, because that is what the board draws handles
   * for — select the cubic to move its interval, select the tangent line to
   * move the point it touches.
   */
  const extraHandles = useMemo<ExtraHandle[]>(() => {
    if (kind !== 'cartesian' || !selectedId) return []
    const out: ExtraHandle[] = []
    const byId = new Map(curves.map((c) => [c.id, c]))
    // A dragged point stays ON the curve it belongs to. Typing a limit outside
    // the domain is still allowed — and still answered with the reason it
    // cannot be integrated — but a drag that runs off the end of the sketch
    // and leaves a dead readout behind is not a statement anyone made.
    const onCurve = (parent: FittedCurve, x: number): number => {
      const d = parent.domain
      if (!d || !Number.isFinite(d[0]) || !Number.isFinite(d[1])) return x
      return Math.min(Math.max(x, Math.min(d[0], d[1])), Math.max(d[0], d[1]))
    }
    for (const link of calcLinks) {
      const parent = byId.get(link.parentId)
      if (!parent) continue
      if (link.kind === 'tangent') {
        // Reachable from either card: the line's own, and the curve it is on.
        if (link.curveId !== selectedId && link.parentId !== selectedId) continue
        let t: ReturnType<typeof tangentAt> = null
        try {
          t = tangentAt(parent, models, link.x)
        } catch {
          t = null
        }
        if (!t) continue
        out.push({
          id: `calc:${link.id}:point`,
          pos: t.point,
          label: 'tangent point',
          onDrag: (pos) =>
            changeCalc({ kind: 'tangentX', linkId: link.id, x: onCurve(parent, pos.x) }, true),
        })
        continue
      }
      if (link.kind !== 'area' && link.kind !== 'riemann') continue
      // Between two curves the interval belongs to BOTH of them, so it is
      // grabbable from either card — a teacher looking at g and wondering why
      // it is shaded can move the region without hunting for f's card.
      const other =
        link.kind === 'area' && link.otherId ? byId.get(link.otherId) : undefined
      if (link.parentId !== selectedId && !(other && other.id === selectedId)) continue
      // A limit that left one curve has left the region: between-curves clamps
      // to the OVERLAP of the two domains, where "the area between them" is a
      // thing that exists at all.
      const clamp = (x: number): number =>
        other ? onCurve(other, onCurve(parent, x)) : onCurve(parent, x)
      // The limits live ON the axis, which is where a teacher points at them.
      out.push({
        id: `calc:${link.id}:from`,
        pos: { x: link.from, y: 0 },
        label: 'a',
        onDrag: (pos) =>
          changeCalc(
            { kind: 'bound', linkId: link.id, which: 'from', value: clamp(pos.x) },
            true,
          ),
      })
      out.push({
        id: `calc:${link.id}:to`,
        pos: { x: link.to, y: 0 },
        label: 'b',
        onDrag: (pos) =>
          changeCalc(
            { kind: 'bound', linkId: link.id, which: 'to', value: clamp(pos.x) },
            true,
          ),
      })
    }
    // A solution curve's initial condition. It is free in BOTH directions —
    // the whole question "what happens if it starts here instead?" is answered
    // by dragging it off the curve it is currently on — so unlike a tangent's
    // point it is not clamped to anything. The label names the point it is:
    // dragging it is the same statement as typing it on the card.
    const field = fields.find((f) => f.id === selectedId)
    if (field && field.visible) {
      for (const sol of field.solutions) {
        out.push({
          id: `field:${field.id}:${sol.id}`,
          pos: { x: sol.x, y: sol.y },
          label: throughLabel(sol.x, sol.y),
          color: field.color,
          onDrag: (pos) => {
            const on = snapPlaced(pos, vpRef.current)
            moveSolution(field.id, sol.id, { x: on.x, y: on.y }, true)
          },
        })
      }
    }
    // A function built from its roots: each real root is a handle ON the
    // x-axis, where a teacher points at it — the numerator's as "root", the
    // denominator's at its asymptote. Mid-drag the handles come from the spec
    // being dragged, so the one under the finger keeps its identity.
    const typed = curves.find((c) => c.id === selectedId)
    if (typed && typed.visible && typed.kind === 'explicit' && typed.modelId.startsWith('expr_')) {
      const drag = factorDragRef.current
      const spec =
        drag && drag.curveId === typed.id && drag.bracket !== null && drag.bracket === preEditRef.current
          ? drag.spec
          : safeReadFactored(exprSources[typed.id])
      if (spec) {
        for (const h of rootHandles(spec)) {
          const id = `factor:${typed.id}:${h.side}:${h.index}`
          out.push({
            id,
            pos: { x: h.x, y: 0 },
            label: h.label,
            onDrag: (pos) => dragFactorRoot(typed.id, h.side, h.index, id, pos),
          })
        }
      }
    }
    // A shape's VERTICES. They are the shape — everything else about a
    // triangle is derived from its three corners — so they are grabbable the
    // moment its card is selected, and a drag rewrites the line that put them
    // there (see dragShapeVertex). A point has one, a segment two, a vector
    // its tip and, when the line writes one, its tail.
    const shape = shapes.find((sh) => sh.id === selectedId)
    if (shape && shape.visible) {
      const built = shapeCompiled.get(shape.id)
      if (built?.shape) {
        for (const v of shapeVertices(built.shape, scanPairs(shape.src))) {
          out.push({
            id: `shape:${shape.id}:${v.pair}`,
            pos: v.pos,
            label: v.label ? `${v.label} ${pointLabel(v.pos)}` : pointLabel(v.pos),
            color: shape.color,
            onDrag: (pos) => dragShapeVertex(shape.id, v.pair, pos),
          })
        }
      }
    }
    return out
  }, [
    kind,
    selectedId,
    calcLinks,
    curves,
    models,
    changeCalc,
    fields,
    moveSolution,
    shapes,
    shapeCompiled,
    dragShapeVertex,
    exprSources,
    dragFactorRoot,
  ])

  const copyTimerRef = useRef(0)

  // ------------------------------------------------------- who is who on the board
  //
  // "Graph of f" is true of a board with one curve and a lie about a board
  // with three: it names a function nothing on the figure points at, and the
  // printed sheet gives a student no way to tell which stroke is f. So the
  // board names its curves — f, g, h …, a typed `g(x) = …` keeping the letter
  // it was given, a derivative keeping its parent's letter and a prime — and
  // the caption and the labels on the figure both read from that ONE map.
  //
  // Derived, never stored: a document that remembered "this one is g" would
  // disagree with the board the moment a curve above it was deleted.
  const boardCurveNames = useMemo(
    () =>
      kind === 'cartesian'
        ? curveNames(curves, { ...displaySources, ...exprSources }, calcLinks)
        : {},
    [kind, curves, displaySources, exprSources, calcLinks],
  )
  const boardCurveNamesRef = useRef(boardCurveNames)
  boardCurveNamesRef.current = boardCurveNames

  /** The caption the board would write for itself, right now. */
  const autoCaption = defaultCaption(figureStyle, namesInOrder(curves, boardCurveNames))
  /**
   * The caption that actually gets printed: the teacher's own words when they
   * have written any, and otherwise the one the board keeps re-deriving.
   */
  const captionText = figureCaption ?? autoCaption
  const captionTextRef = useRef(captionText)
  captionTextRef.current = captionText
  const autoCaptionRef = useRef(autoCaption)
  autoCaptionRef.current = autoCaption

  /** The ground the theme toggle asks for. */
  const screenTheme = canvasTheme === 'light' ? LIGHT_THEME : DARK_THEME
  /**
   * What the board on SCREEN draws — and, since there is one canvas, what the
   * PRESENTED board draws too.
   *
   * The chosen figure style is not in it. A style says what the PNG and the
   * clipboard copy come out looking like; the working board keeps the theme,
   * and presentation mode keeps it whatever the preview switch says, because a
   * presented board is a lit wall and an SAT figure on it is a white rectangle
   * in a dark room. See screenLook / exportLook in ui/figureStyle.ts — two
   * destinations, two answers, so the board cannot quietly pick up the
   * export's ground the way it did before.
   */
  const look = screenLook({
    style: figureStyle,
    caption: captionText,
    screenTheme,
    preview: previewFigure,
    present: presentMode,
    cartesian: kind === 'cartesian',
  })
  const boardFigure = look.figure
  const boardCaption = look.caption
  const boardTheme = look.theme
  /**
   * Whether the toolbar has to read against a LIGHT canvas. A PREVIEW puts the
   * board on white whatever the theme toggle says, and the chrome around it has
   * to follow or it is grey-on-grey.
   */
  const lightBoard = canvasTheme === 'light' || look.previewing

  // ------------------------------------------------- where the curves meet
  //
  // The one analysis point that does not belong to a curve. It is computed for
  // the BOARD rather than for the selection, once per pair, because a crossing
  // has two parents: it is drawn once (a neutral diamond, neither curve's
  // colour) and listed on both cards, from this single list, so the two can
  // never print different answers to "where do f and g cross?".
  //
  // They are computed whether or not the markers are switched on, for the same
  // reason analyzeCurve is: the CARDS state them, and a card's analysis table
  // does not come and go with the board's toggle. What the toggle governs is
  // the BOARD — see the scene below, where the screen look is handed the list
  // only while Analysis is on, exactly as every other marker is.
  //
  // A MARKED figure is the exception, and deliberately: a textbook figure of
  // two graphs is a figure about where they meet, and a PNG that dropped the
  // crossings would be the bug the analysis layer once had, in a new place.
  const markedBoard = boardFigure != null && boardFigure.curveEnds === 'marked'
  const crossingsOn = kind === 'cartesian'

  /**
   * The key the pair solve is memoised on: the curves that can be crossed,
   * their params and domains, and the coarse range — never the identity of the
   * curve array, which a slider drag rebuilds on every frame with the same
   * numbers in it.
   */
  const crossKey = crossingsOn ? intersectionKey(curves, crossSpan) : ''
  const curvesForCross = useRef(curves)
  curvesForCross.current = curves

  const crossings = useMemo<BoardIntersection[]>(() => {
    if (!crossingsOn) return EMPTY_CROSSINGS
    const found = boardIntersections(curvesForCross.current, models, crossSpan)
    return found.length > 0 ? found : EMPTY_CROSSINGS
    // The curve list is tracked through crossKey, not through its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crossingsOn, crossKey, models, crossSpan])
  const crossingsRef = useRef(crossings)
  crossingsRef.current = crossings

  /**
   * What each card lists, named the way the caption names the curves: the
   * board's derived letters (f, g, f′) when it has them, and otherwise the
   * card's own label, which is what a curve is called in every other sentence
   * this app writes about it.
   */
  const crossingsFor = useCallback(
    (id: string): readonly CurveIntersections[] | undefined => {
      if (crossings.length === 0) return undefined
      const got = cardIntersections(
        id,
        crossings,
        (other) => {
          const c = curvesRef.current.find((k) => k.id === other)
          return boardCurveNames[other] ?? (c ? curveLabel(c) : other)
        },
        curvesRef.current.map((c) => c.id),
      )
      return got.length > 0 ? got : undefined
    },
    [crossings, boardCurveNames, curveLabel],
  )

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
    // The LOOK the teacher chose, in full — this is the scene it was chosen
    // FOR. The preview switch has no say here: it is a way of looking at this
    // answer on the board, never a way of changing it.
    const { figure, caption } = exportLook({
      style: figureStyleRef.current,
      caption: captionTextRef.current,
      cartesian: kindRef.current === 'cartesian',
    })
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
        // A caption is drawn inside this rect, so a frame fitted to the curves
        // has to be told to leave room for it.
        caption !== '' ? captionHeight() : 0,
      ),
      // A figure style owns the ground; the Background control is disabled and
      // says so while one is on. Without a style this is exactly what it was.
      theme: figure
        ? figure.theme
        : exportTheme(settings, DARK_THEME),
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
      // Where the curves cross is a fact about the FIGURE, not a note the
      // editor is keeping, so the PNG gets the same list the screen drew, by
      // the same field — there is no second place that could forget it.
      intersections:
        kindRef.current === 'cartesian' &&
        (showAnalysisRef.current || (figure != null && figure.curveEnds === 'marked'))
          ? crossingsRef.current
          : undefined,
      // The screen palette is tuned against near-black and washes out on white
      // (amber lands near 1.7:1 — a copier renders it as nothing), so a light
      // export swaps every curve for its print counterpart.
      printColors: figure ? true : settings.theme === 'light',
      // The PNG is measured the way the screen is. This is the whole point of
      // there being one scene type: a π axis a teacher set for a trig lesson
      // has to be π in the file they paste into the worksheet.
      axisUnits: axisUnitsRef.current,
      // The shaded integral and the Riemann rectangles ARE the figure on a
      // calculus board. A PNG that dropped them would be the same bug the
      // analysis markers once had.
      overlays: overlaysRef.current,
      // A slope field and the solution curves through it ARE the figure on a
      // differential-equations board — there is often nothing else on it at
      // all — so they go into the exported scene by the same field the screen
      // uses rather than by a second code path that could forget them.
      fields: fieldSceneRef.current,
      polylines: fieldPolylinesRef.current,
      // A triangle, a vector, a labelled point ARE the figure on a geometry
      // board — often the only thing on it — so they go into the exported
      // scene by the same field the screen uses rather than by a second code
      // path that could forget them.
      shapes: shapeSceneRef.current,
      // And on the ruling the screen is on: a polar board exported on squares
      // would be a different picture of the same curve.
      grid: boardGridRef.current,
      // The LOOK, and the line printed under the figure. Both are the
      // document's, and both live HERE rather than on the board: the style is
      // what the teacher is exporting, not what they are drawing on. "Preview
      // on board" shows this same answer on the canvas for as long as it is on.
      ...(figure ? { figure } : {}),
      ...(caption !== '' ? { caption } : {}),
      // And who is who: under a marked style with two or more named curves,
      // each one's letter is drawn beside it. Absent under the screen look, so
      // an unstyled PNG is the command stream it always was.
      ...(figure ? { curveNames: boardCurveNamesRef.current } : {}),
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
   * Put the board on a ruling.
   *
   * Not in the undo history, exactly as the axis units are not: it is how the
   * board is MEASURED, not a thing on it. Choosing one also settles the
   * question for this document — the offer below never comes back.
   */
  const setRuling = useCallback((next: BoardGrid): void => {
    polarOfferedRef.current = true
    setBoardGrid((prev) => (prev === next ? prev : next))
  }, [])

  /**
   * Put the board in a figure style.
   *
   * ONE undo entry, named after the style — unlike the ruling, which stays out
   * of the history because it is a way of MEASURING the board. A style repaints
   * the whole figure, and the change a teacher is most likely to want back is
   * the one they made by clicking a picture they had not seen full size yet.
   *
   * The caption is no longer copied into this entry, because it is no longer
   * a constant handed over at the moment a style is picked: while it is AUTO
   * it is derived from the style and the curves together, so choosing AP makes
   * the board write "Graphs of f and g" by itself and choosing Screen makes it
   * write nothing — with one undo, of the style, which is the change that was
   * made. A caption the teacher wrote is theirs and is not touched either way.
   */
  const chooseFigureStyle = useCallback(
    (next: FigureStyleId): void => {
      if (figureStyleRef.current === next) return
      // Back to Screen is back to no style at all, so there is nothing left to
      // preview: leaving the switch armed would mean the next style chosen
      // silently repainted the board.
      if (next === 'screen') setPreviewFigure(false)
      commitState({ figure: next }, `figure style: ${FIGURE_STYLES[next].name}`)
    },
    [commitState],
  )

  /**
   * The caption, as it is typed.
   *
   * One undo entry per RUN of typing rather than per keystroke: consecutive
   * caption edits fold into the entry already on top of the stack, and anything
   * else the teacher does closes the run. Undo then takes back "the caption I
   * just wrote", which is the unit anybody means.
   */
  const setCaption = useCallback(
    (next: string): void => {
      // Typing the board's own sentence back is not an override: it leaves the
      // caption following the curves, which is what it was already doing and
      // what "↺ auto" would put it back to.
      const value: string | null = next === autoCaptionRef.current ? null : next
      if (figureCaptionRef.current === value) return
      const top = undoRef.current[undoRef.current.length - 1]
      if (top?.label === CAPTION_LABEL) {
        redoRef.current = []
        figureCaptionRef.current = value
        setFigureCaption(value)
        return
      }
      commitState({ caption: value }, CAPTION_LABEL)
    },
    [commitState],
  )

  /**
   * Hand the caption back to the board.
   *
   * One undo entry of its own, not folded into a run of typing: it undoes a
   * click, and the words it takes back are the ones the teacher wrote.
   */
  const resetCaption = useCallback((): void => {
    if (figureCaptionRef.current === null) return
    commitState({ caption: null }, 'caption follows the board')
  }, [commitState])

  /**
   * A polar curve has just landed on a square board. OFFER the polar ruling.
   *
   * Deliberately not the axis-units mechanism, which re-rules the board by
   * itself when 'auto' sees a sine. Re-drawing every gridline under a class
   * mid-lesson is a much larger surprise than re-labelling an axis, and it is
   * a surprise in both directions — deleting the rose would have to put the
   * squares back, in the middle of whatever came next. So it is one line at
   * the foot of the board with one tap to accept, asked once per document,
   * and ignoring it IS declining it.
   */
  const wantsPolar = useMemo(
    () => (kind === 'cartesian' ? suggestPolarRuling(curves) : false),
    [kind, curves],
  )
  useEffect(() => {
    if (!wantsPolar || polarOfferedRef.current) return
    if (boardGridRef.current === 'polar') {
      polarOfferedRef.current = true
      return
    }
    polarOfferedRef.current = true
    showToast(POLAR_OFFER, {
      ms: 9000,
      action: { label: 'Polar ruling', run: () => setBoardGrid('polar') },
    })
  }, [wantsPolar, showToast])

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
        else if (fieldsRef.current.some((f) => f.id === selectedRef.current)) {
          deleteField(selectedRef.current)
        } else if (shapesRef.current.some((sh) => sh.id === selectedRef.current)) {
          deleteShape(selectedRef.current)
        } else deleteCurve(selectedRef.current)
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
        // An armed pick is the innermost thing Escape can be about: the
        // teacher asked "which second curve?" and is now saying "never mind".
        // It takes the key, so present mode survives the same press.
        if (armedBetweenRef.current) {
          e.preventDefault()
          cancelBetween()
          return
        }
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
  }, [
    undo,
    redo,
    cancelBetween,
    deleteCurve,
    deleteField,
    deleteShape,
    deleteItem,
    nudgeSelected,
    commitWithSnap,
    cycleAxisUnitX,
  ])

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
          // A derived curve's equation does not say what it IS: two cubic-ish
          // chips on a wall and the class has to guess which is f and which
          // is f′. The chip says so.
          : [
              ...labelLegend(curveLegend(curves, models, displaySources), calcLinks),
              // A lattice says nothing about the equation that drew it, and a
              // field has no card on the wall. Two fields projected side by
              // side would otherwise be two grey textures.
              ...fieldLegend(fields, fieldCompiled),
              // And a shape: △ABC on the wall, so the class knows which
              // triangle the lesson is about when two are on the board.
              ...shapeLegend(shapes, shapeCompiled),
            ],
    [
      presentMode,
      kind,
      items,
      curves,
      models,
      displaySources,
      calcLinks,
      fields,
      fieldCompiled,
      shapes,
      shapeCompiled,
    ],
  )

  const changePresentType = useCallback((next: number): void => {
    const clean = clampPresentScale(next)
    setPresentType(clean)
    updatePrefs({ presentScale: clean })
  }, [])

  const hasBoardContent =
    kind === 'number-line'
      ? items.length > 0
      : curves.length > 0 || fields.length > 0 || shapes.length > 0

  /** What every number-line card needs to speak for its whole answer. */
  const answerBoard = useMemo(() => ({ items, styles }), [items, styles])

  return (
    <div
      className={`app${lightBoard ? ' canvas-light' : ''}${
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
        onExprToggle={() => {
          setFactorOpen(false)
          setExprOpen((o) => !o)
        }}
        factorOpen={factorOpen}
        onFactorToggle={() => {
          setExprOpen(false)
          setFactorOpen((o) => !o)
        }}
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
            onSelect={selectObject}
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
          onNotice={showNotice}
          analysis={showAnalysis ? analysis : EMPTY_ANALYSIS}
          analysisHighlight={highlight}
          intersections={showAnalysis || markedBoard ? crossings : EMPTY_CROSSINGS}
          onFeatureEdit={applyFeature}
          theme={boardTheme}
          present={present}
          wheelPref={wheelPref}
          axisUnits={axisUnits}
          overlays={overlays}
          fields={fieldScene}
          polylines={fieldPolylines}
          shapes={shapeScene}
          grid={boardGrid}
          figure={boardFigure}
          caption={boardCaption}
          curveNames={boardCurveNames}
          extraHandles={extraHandles}
          pointPick={pointPick}
        />
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
              hasContent={hasBoardContent}
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
                grid={kind === 'cartesian' ? boardGrid : null}
                onGrid={setRuling}
                wheel={wheelPref}
                onWheel={setWheelPref}
                figure={kind === 'cartesian' ? figureStyle : null}
                screenTheme={screenTheme}
                caption={captionText}
                captionAuto={figureCaption === null}
                preview={previewFigure}
                onFigure={chooseFigureStyle}
                onCaption={setCaption}
                onCaptionAuto={resetCaption}
                onPreview={setPreviewFigure}
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

        {kind === 'cartesian' &&
          curves.length === 0 &&
          fields.length === 0 &&
          shapes.length === 0 &&
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

// ============================================================================
// src/app/useBoardState.ts — the board's content as React state.
//
// Curves, number-line items and styles; every board object kind (calculus
// links, fields, shapes, tables, sequences, unit circle, related rates, the
// inequality system); the builders' open flags and drag refs; the per-curve
// view switches; the ruling, axes mode and figure style; toasts and confirms.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback, useMemo, useRef, useState } from 'react'
import type { ConicSpec } from '../core/conics'
import type { ExpSpec } from '../core/exponential'
import type { FactoredSpec } from '../core/factored'
import type { LogSpec } from '../core/logarithmic'
import type { LogisticSpec } from '../core/logistic'
import type { BoardGrid, BoardIneqSystem, StyleMap } from '../core/persist'
import type { SinSpec } from '../core/sinusoidal'
import type { TransformSpec } from '../core/transform'
import type { BoardKind, FigureStyleId, FittedCurve, ModelSpec, NLItem, Vec2 } from '../core/types'
import type { CalcLink } from '../ui/calcLinks'
import { collectCurveViews, curveViewsKey } from '../ui/curveViews'
import type { DomainLens, ViewStates } from '../ui/curveViews'
import type { BoardData } from '../ui/dataLinks'
import type { BoardField } from '../ui/fieldLinks'
import type { MotionPlayState } from '../ui/motionLinks'
import type { BoardRelatedRates, RRSpeed } from '../ui/relatedRatesLinks'
import type { BoardStat } from '../ui/statsLinks'
import type { BoardSequence } from '../ui/seqLinks'
import type { BoardShape } from '../ui/shapeLinks'
import type { BoardUnitCircle, PlaySpeed } from '../ui/unitCircleLinks'
import type { AxesMode } from '../ui/viewScale'

export function useBoardState() {
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
   * point. A promise about how edits behave, not part of the function — the
   * equation on the card is always the whole truth about the curve — but one
   * the teacher set up, so it is saved with the document (board.curveViews,
   * src/ui/curveViews.ts). Not an undo step of its own; a curve brought back
   * by undo brings its point back.
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
  /** "Build ▾ → Exponential" open at the top of the list (src/ui/ExpEditor.tsx). */
  const [expOpen, setExpOpen] = useState(false)
  /**
   * The exponential handle being dragged, and the spec it started from. Each
   * handle sets ONE quantity from the pointer's absolute height, so every
   * frame is computed from the spec at the press — never from the previous
   * frame's rounding.
   */
  const expDragRef = useRef<{
    handleId: string
    curveId: string
    bracket: unknown
    spec: ExpSpec
  } | null>(null)
  /** "Build ▾ → Logistic" open at the top of the list (src/ui/LogisticEditor.tsx). */
  const [logisticOpen, setLogisticOpen] = useState(false)
  /** The logistic handle being dragged, and the spec at the press (as expDragRef). */
  const logisticDragRef = useRef<{
    handleId: string
    curveId: string
    bracket: unknown
    spec: LogisticSpec
  } | null>(null)
  /** "Build ▾ → Logarithmic" open at the top of the list (src/ui/LogEditor.tsx). */
  const [logOpen, setLogOpen] = useState(false)
  /** The logarithm handle being dragged, and the spec at the press (as expDragRef). */
  const logDragRef = useRef<{
    handleId: string
    curveId: string
    bracket: unknown
    spec: LogSpec
  } | null>(null)
  /** "Build ▾ → Sinusoidal" open at the top of the list (src/ui/SinEditor.tsx). */
  const [sinOpen, setSinOpen] = useState(false)
  /**
   * The sinusoid handle being dragged, the spec at the press and where the
   * handle was then (as expDragRef) — the handle's x at the press is what a
   * drag that has not really moved sideways stays on.
   */
  const sinDragRef = useRef<{
    handleId: string
    curveId: string
    bracket: unknown
    spec: SinSpec
    anchor: Vec2
  } | null>(null)
  /** "Build ▾ → Transformation" open at the top of the list (src/ui/TransformEditor.tsx). */
  const [transformOpen, setTransformOpen] = useState(false)
  /** "Build ▾ → Piecewise" open at the top of the list (src/ui/PiecewiseEditor.tsx). */
  const [piecewiseOpen, setPiecewiseOpen] = useState(false)
  /** "Build ▾ → Conic section" open at the top of the list (src/ui/ConicEditor.tsx). */
  const [conicOpen, setConicOpen] = useState(false)
  /** The conic handle being dragged and the spec at the press (as sinDragRef). */
  const conicDragRef = useRef<{
    handleId: string
    curveId: string
    bracket: unknown
    spec: ConicSpec
  } | null>(null)
  /**
   * The card's "show construction" switch, per curve: a conic whose foci,
   * directrix, asymptotes and box are FIGURE content — drawn whether or not
   * it is selected, and exported. Like "show parent", a way of looking at the
   * board: saved with the document (board.curveViews), never an undo step.
   */
  const [construction, setConstruction] = useState<Record<string, boolean>>({})
  const constructionRef = useRef(construction)
  constructionRef.current = construction
  /** "Build ▾ → Parametric / polar" open at the top of the list (src/ui/MotionEditor.tsx). */
  const [motionOpen, setMotionOpen] = useState(false)
  /**
   * The Motion section's player, per parametric / polar curve: t, play /
   * pause, speed, the acceleration switch, "show particle in export", and a
   * polar curve's shaded area. The switches and the area are saved with the
   * document (board.curveViews, as "show construction"); t, play / pause and
   * speed are the demonstration in progress and are not.
   */
  const [motionPlay, setMotionPlay] = useState<Record<string, MotionPlayState>>({})
  const motionPlayRef = useRef(motionPlay)
  motionPlayRef.current = motionPlay
  /** The transformation handle being dragged, the spec at the press and the handle's place then. */
  const transformDragRef = useRef<{
    handleId: string
    curveId: string
    bracket: unknown
    spec: TransformSpec
    anchor: Vec2
  } | null>(null)
  /**
   * The card's "show parent" switch, per curve, as the teacher left it —
   * absent means the section's own default (shown when it opens by itself).
   * A way of looking at the board: saved with the document (board.curveViews)
   * as the teacher left it, never an undo step.
   */
  const [showParent, setShowParent] = useState<Record<string, boolean>>({})
  const showParentRef = useRef(showParent)
  showParentRef.current = showParent
  /**
   * The Domain section's board switches, per curve: the cut-off part's ghost,
   * the horizontal line test's height and the reflected point. Ways of
   * looking at the board, like "show parent": saved with the document
   * (board.curveViews), never an undo step.
   */
  const [lens, setLens] = useState<Record<string, DomainLens>>({})
  const lensRef = useRef(lens)
  lensRef.current = lens
  /** The per-curve view maps, as one value (src/ui/curveViews.ts). */
  const readViewStates = useCallback(
    (): ViewStates => ({
      construction: constructionRef.current,
      showParent: showParentRef.current,
      factorThrough: factorThroughRef.current,
      motion: motionPlayRef.current,
      lens: lensRef.current,
    }),
    [],
  )
  /** Replace whichever of the four maps changed — refs now, state for the render. */
  const writeViewStates = useCallback((next: ViewStates): void => {
    if (next.construction !== constructionRef.current) {
      constructionRef.current = next.construction
      setConstruction(next.construction)
    }
    if (next.showParent !== showParentRef.current) {
      showParentRef.current = next.showParent
      setShowParent(next.showParent)
    }
    if (next.factorThrough !== factorThroughRef.current) {
      factorThroughRef.current = next.factorThrough
      setFactorThrough(next.factorThrough)
    }
    if (next.motion !== motionPlayRef.current) {
      motionPlayRef.current = next.motion
      setMotionPlay(next.motion)
    }
    if (next.lens !== lensRef.current) {
      lensRef.current = next.lens
      setLens(next.lens)
    }
  }, [])
  /** What the document's curveViews map says, as a string that ignores the particle. */
  const curveViewsSig = useMemo(
    () => curveViewsKey(collectCurveViews({ construction, showParent, factorThrough, motion: motionPlay, lens })),
    [construction, showParent, factorThrough, motionPlay, lens],
  )
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
   * Data tables: the cells exactly as the teacher typed or pasted them, and
   * the regressions fitted to each one as LINKS to typed curves. The scatter
   * plot and every fit are recomputed from the cells on every change, which
   * is what lets one edited y re-fit every regression in place.
   */
  const [dataSets, setDataSets] = useState<BoardData[]>([])
  /**
   * Sequences: the line as typed, its constants, its index window and two
   * toggles. The dots, the partial sums, the classification and the dashed
   * partner are all recomputed from those on every change (src/ui/seqLinks.ts).
   */
  const [sequences, setSequences] = useState<BoardSequence[]>([])
  /** "Build ▾ → Sequence" open at the top of the list. */
  const [seqOpen, setSeqOpen] = useState(false)
  /**
   * The unit circle (one per board, kept as a list like everything else):
   * its centre, θ, the switches and the inverse question. Every label and
   * exact value is recomputed from those (src/ui/unitCircleLinks.ts).
   */
  const [unitCircles, setUnitCircles] = useState<BoardUnitCircle[]>([])
  /**
   * The related-rates problem (one per board, kept as a list like the unit
   * circle): scenario, givens, t, the when-question. Everything drawn and
   * printed is re-derived from it (src/ui/relatedRatesLinks.ts).
   */
  const [relatedRates, setRelatedRates] = useState<BoardRelatedRates[]>([])
  /** The animation's t while it plays (the document keeps its own), and the speed. */
  const [rrPlay, setRrPlay] = useState<{ t: number } | null>(null)
  const rrPlayRef = useRef(rrPlay)
  rrPlayRef.current = rrPlay
  const [rrSpeed, setRrSpeed] = useState<RRSpeed>(1)
  /**
   * The statistics objects — normal distributions and simulations, as the
   * teacher set them (src/core/statsPersist.ts). Every probability and every
   * simulated statistic is recomputed from these (src/ui/statsLinks.ts).
   */
  const [stats, setStats] = useState<BoardStat[]>([])
  /** A simulation building up under Play: which one, and how many samples show. Session only. */
  const [statsPlay, setStatsPlay] = useState<{ id: string; shown: number } | null>(null)
  const statsPlayRef = useRef(statsPlay)
  statsPlayRef.current = statsPlay
  /**
   * The inequality system (the visible inequalities, taken together): only
   * what the teacher set for it — solution region, test point, objective.
   * Every corner, verdict and table is recomputed from the curves.
   */
  const [ineqSystem, setIneqSystem] = useState<BoardIneqSystem | null>(null)
  /**
   * The animation: θ while playing (the document keeps its own until the
   * animation stops), and the speed. Neither is the document's.
   */
  const [ucPlay, setUcPlay] = useState<{ id: string; theta: number } | null>(null)
  const ucPlayRef = useRef(ucPlay)
  ucPlayRef.current = ucPlay
  const [ucSpeed, setUcSpeed] = useState<PlaySpeed>(1)
  /**
   * Bumped by undo and redo. The Taylor ▶ demo's timer lives in its card
   * (TaylorSection), keyed on this, so a new epoch remounts it — and a
   * remount clears the timer. Undo during the demo must stop it, or the timer
   * keeps stepping n over the state undo just restored.
   */
  const [playEpoch, setPlayEpoch] = useState(0)
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
   * Equal or Independent axes — a mirror of the viewport, never a second
   * source of truth: the view carries pxPerUnitY exactly when the axes are
   * Independent (see ui/viewScale.ts), and that is what persists. Mirrored
   * here only so the settings panel re-renders when a gesture flips it. Like
   * the view itself it is NOT in the undo history.
   */
  const [axesMode, setAxesMode] = useState<AxesMode>('equal')
  /** The WINDOW panel listens here: the view moves without a React render. */
  const viewSubsRef = useRef<Set<() => void>>(new Set())
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
  const [historyTick, bumpHistory] = useState(0)

  return {
    curves, setCurves, kind, setKind, items, setItems, styles, setStyles, selectedId, setSelectedId,
    sidebarOpen, setSidebarOpen, drawingActive, setDrawingActive, exprOpen, setExprOpen, factorOpen,
    setFactorOpen, factorThrough, setFactorThrough, factorThroughRef, factorDragRef, expOpen,
    setExpOpen, expDragRef, logisticOpen, setLogisticOpen, logisticDragRef, logOpen, setLogOpen,
    logDragRef, sinOpen, setSinOpen, sinDragRef, transformOpen, setTransformOpen, piecewiseOpen,
    setPiecewiseOpen, conicOpen, setConicOpen, conicDragRef, construction, setConstruction,
    motionOpen, setMotionOpen, motionPlay, setMotionPlay, motionPlayRef, transformDragRef,
    showParent, setShowParent, lens, setLens, lensRef, readViewStates, writeViewStates,
    curveViewsSig, extraModels, setExtraModels, calcLinks, setCalcLinks, fields, setFields,
    armedField, setArmedField, setArmedBetween, armedBetweenRef, shapes, setShapes, dataSets,
    setDataSets, sequences, setSequences, seqOpen, setSeqOpen, unitCircles, setUnitCircles,
    relatedRates, setRelatedRates, rrPlay, setRrPlay, rrPlayRef, rrSpeed, setRrSpeed, stats,
    setStats, statsPlay, setStatsPlay, statsPlayRef, ineqSystem,
    setIneqSystem, ucPlay, setUcPlay, ucPlayRef, ucSpeed, setUcSpeed, playEpoch, setPlayEpoch,
    boardGrid, setBoardGrid, axesMode, setAxesMode, viewSubsRef, figureStyle, setFigureStyle,
    figureCaption, setFigureCaption, previewFigure, setPreviewFigure, snapFlash, setSnapFlash,
    shake, setShake, toast, setToast, confirmAsk, setConfirmAsk, historyTick, bumpHistory,
  }
}

export type BoardStateApi = ReturnType<typeof useBoardState>

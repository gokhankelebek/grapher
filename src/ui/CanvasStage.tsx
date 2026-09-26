import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import type { MutableRefObject } from 'react'
import type {
  CurveHandle,
  FitResult,
  FittedCurve,
  ModelSpec,
  ProcessedStroke,
  SpecialPoint,
  Vec2,
  Viewport,
} from '../core/types'
import { isStretched, ppuX, ppuY, toMath, toScreen } from '../core/types'
import type { FigureStyle, Theme } from '../core/types'
import { processStroke } from '../core/stroke'
import { recognize } from '../core/fit/recognize'
import {
  getHandles,
  applyHandleDrag,
  dragCurvePoint,
  oversketch,
  nearestOnCurve,
} from '../core/fit/edit'
import { handleHitRadius, hasMarkerGlyph, renderBoard } from './renderBoard'
import type {
  AxisUnits,
  BoardIntersection,
  Overlay,
  Polyline,
  ScatterSet,
  Shape,
  SlopeField,
} from './renderBoard'
import type { BoardGrid } from '../core/persist'
import {
  NEIGHBOURHOOD_PX,
  TOUCH_INK_HOLD_MS,
  TOUCH_PAN_SLOP,
  classifyPointerDown,
  classifyWheel,
  wheelZoomFactor,
  hitRadii,
  penGuardActive,
  pointerKind,
  strokeLeftBand,
  tipPlacement,
  wheelPanDelta,
  wheelStretchAxis,
  wheelStretchDelta,
} from './gestures'
import type { DrawIntent, HitRadii, PointerKind, WheelPref } from './gestures'
import { sampleCurveScreen, distToPolyline } from './sample'
import { formatCoord } from './numeric'
import { axesPhrase, axisKeys, featureAxes } from './featureEdit'
import type { FeatureAxes } from './featureEdit'
import { HandleInput } from './HandleInput'
import type { HandleField } from './HandleInput'
import { paintScale } from '../render/grid'
import type { PaintScale } from '../render/grid'
import type { Mode, StyleMap } from '../App'
import {
  MAX_PPU,
  MIN_PPU,
  axisBandAt,
  dragStretchFactor,
  nearestOnPolyline,
  panBy,
  setAxisScale,
  stretchAbout,
  zoomAbout,
} from './viewScale'
import type { Axis } from './viewScale'

export type { DrawIntent } from './gestures'

/**
 * A draggable point the BOARD owns rather than a model does.
 *
 * getHandles() answers "what can be grabbed on this curve" from the curve's
 * family — a parabola's vertex, a circle's radius. The point a tangent line
 * touches is not one of those: it belongs to the tangent, which is a separate
 * object that happens to live on this curve. So the App passes those points
 * down, and the stage draws them in the SAME handle vocabulary (cored dot,
 * grown when active) and routes their drags straight back out. The stage
 * knows nothing about what they mean; it knows only where they are and who to
 * tell when they move.
 */
export interface ExtraHandle {
  id: string
  pos: Vec2
  /** Shown in the drag tip, e.g. "tangent point" or "a". */
  label: string
  /**
   * The colour to draw it in when there is no selected CURVE to borrow one
   * from — a slope field's initial conditions. Ignored otherwise: a point on a
   * curve is the curve's colour, which is what renderBoard already paints.
   */
  color?: string
  onDrag(pos: Vec2): void
}

export interface CanvasStageHandle {
  /** Schedule a redraw (e.g. after external viewport mutation). */
  redraw(): void
}

interface Props {
  curves: FittedCurve[]
  styles: StyleMap
  models: Record<string, ModelSpec>
  /** Ground the on-screen board is drawn on. Dark by default; light projects. */
  theme: Theme
  /**
   * Presentation scaling for a board read from the back of a room. Absent
   * means 1:1. It reaches renderBoard as the scene's own field, and it scales
   * the HIT radii through renderBoard's handleHitRadius() — a handle drawn
   * twice as big has to be grabbable twice as far out, or the glyph and its
   * target part company the moment a teacher projects.
   */
  present?: PaintScale | null
  /** What a plain mouse wheel does; 'auto' tells a wheel from a trackpad. */
  wheelPref?: WheelPref
  /**
   * How each axis is measured — 'decimal' or 'pi', per axis. Absent means the
   * decimal grid, so a caller that never mentions it draws what it always drew.
   * Threaded exactly like `present`: mirrored into a ref and handed to
   * renderBoard as a field of the SCENE, because the export builds the same
   * scene and the PNG has to be measured the way the screen is.
   */
  axisUnits?: AxisUnits | null
  /**
   * Filled figure content painted between the grid and the curves — the shaded
   * area under a curve, Riemann rectangles. Passed straight through to the
   * scene, exactly as the export does, so the screen and the PNG cannot
   * disagree about what is shaded.
   */
  overlays?: readonly Overlay[] | null
  /**
   * Slope fields — dy/dx = f(x, y) as a lattice of short tangent segments —
   * and the open paths drawn over them, which on a calculus board are the RK4
   * solution curves. Both go straight into the scene beside the overlays, so
   * the screen and the exported PNG cannot disagree about them either.
   */
  fields?: readonly SlopeField[] | null
  polylines?: readonly Polyline[] | null
  /**
   * Points, segments, vectors and polygons — the figure a class MEASURES.
   * Straight into the scene beside the fields, so the screen and the exported
   * PNG cannot disagree about where a vertex is.
   */
  shapes?: readonly Shape[] | null
  /**
   * Data tables as scatter plots, with their residuals. Straight into the
   * scene like the shapes, so the screen and the PNG draw the same points.
   */
  scatter?: readonly ScatterSet[] | null
  /**
   * The RULING: the square lattice, or the circles and spokes a polar curve is
   * read off. Absent means the square one, so a caller that never mentions it
   * draws exactly what it always drew. Threaded exactly like `axisUnits`,
   * because the export builds the same scene.
   */
  grid?: BoardGrid | null
  /**
   * The LOOK the board is drawn in — the screen, a textbook page, an SAT item,
   * an AP figure. Absent (the screen look) means the scene carries no `figure`
   * at all and this stage draws exactly the command stream it always drew,
   * theme toggle included.
   *
   * Threaded exactly like `grid` and for the same reason: the export builds the
   * same scene, so what is on the board IS what goes on the paper.
   */
  figure?: FigureStyle | null
  /** The line printed under the figure. FIGURE, not chrome: it exports. */
  caption?: string | null
  /**
   * What each curve is CALLED — "f", "g", "f′" — keyed by curve id.
   *
   * Threaded exactly like `caption`, and drawn only under a marked figure
   * style (see BoardScene.curveNames), so a previewed board shows the labels
   * the PNG will carry and an unstyled board carries none.
   */
  curveNames?: Readonly<Record<string, string>> | null
  /**
   * Extra grabbable points for the selected object, owned by the App. Drawn as
   * handles; their drags go to `onDrag` instead of applyHandleDrag.
   *
   * They no longer require a selected CURVE. A slope field is selected the
   * same way a curve is and has no FittedCurve behind it, so its solution
   * curves' initial conditions would have been drawn and then refused the
   * pointer — a handle you can see and cannot grab.
   */
  extraHandles?: readonly ExtraHandle[] | null
  /**
   * Arm the next tap on the board to report a math point instead of changing
   * the selection — "+ solution through a point".
   *
   * `sticky` is the difference between the menu item (one shot: the very next
   * press anywhere places the point and disarms) and simply having a field's
   * card selected (every tap on empty board places one, while a tap ON a curve
   * still selects that curve and a stroke is still a stroke). A teacher
   * placing six initial conditions in a row must not have to re-arm six times.
   */
  pointPick?: { label: string; sticky: boolean; onPick(pos: Vec2): void } | null
  selectedId: string | null
  mode: Mode
  inkColor: string
  vpRef: MutableRefObject<Viewport>
  onStrokeRecognized(processed: ProcessedStroke, results: FitResult[]): FittedCurve | null
  onSelect(id: string | null): void
  onDrawingChange(active: boolean): void
  /** Live param/stroke update during rigid (Alt) translate or semantic drag. */
  onDragCurve(id: string, params: number[], stroke?: Vec2[]): void
  /** Live param+domain update during a handle drag. */
  onHandleDrag(id: string, params: number[], domain: [number, number] | null): void
  /** A successful oversketch refit (commit, undoable). */
  onOversketch(id: string, params: number[], error: number): void
  /** Oversketch could not blend the stroke (card shake / toast). */
  onOversketchFail(id: string): void
  /**
   * How the press in progress will be read: 'reshape' blends the stroke into
   * the selected curve, 'new' starts a separate one, null when nothing is
   * pending. Optional — the stage draws the chip itself as well, so the intent
   * is visible whether or not anything outside is listening.
   */
  onIntentChange?(intent: DrawIntent | null): void
  /** Transient notice naming an undoable thing that just happened. */
  onNotice?(text: string): void
  onCurveEditStart(): void
  /** Commit the live edit bracket. skipSnap: Alt was held at release. */
  onCurveEditEnd(curveId: string | null, skipSnap: boolean): void
  /** Abort the live edit bracket, reverting to the pre-edit state. */
  onCurveEditCancel(): void
  /** Pan/zoom changed. Hot: must not trigger a React render on its own. */
  onViewportChange?(): void
  /** Special points of the selected curve. Empty when markers are hidden. */
  analysis: SpecialPoint[]
  /**
   * Where the visible curves cross EACH OTHER — every pair, once, whether or
   * not either curve is selected.
   *
   * `analysis` above is one curve's story and a crossing is not part of it:
   * the point has two parents and goes on being true while neither of them is
   * selected. Straight into the scene, so the screen and the exported PNG say
   * the same thing about where the graphs meet.
   */
  intersections?: readonly BoardIntersection[] | null
  /** Index into `analysis` to emphasise (hovered in the card readout). */
  analysisHighlight: number | null
  /**
   * State an exact position for one special point (double-clicked marker).
   * False means it was refused — the popover stays open, and the board is
   * already showing the solver's reason.
   */
  onFeatureEdit(curveId: string, point: SpecialPoint, to: { x?: number; y?: number }): boolean
}

const FADE_MS = 250
const OVERSKETCH_RADIUS = 12
/** dragPoint → ink conversion threshold (stroke ran away from the curve). */
const ESCAPE_PX = 28
/** Pointer entries older than this are considered stale/phantom. */
const POINTER_STALE_MS = 3000

const noop = (): void => {}

/**
 * An App-owned grab point, in the shape renderBoard already draws.
 *
 * 'feature' is deliberate: it is the cored dot, the glyph that means "a point
 * on this curve you can move", which is exactly what a tangent's point and an
 * integral's limit are. Nothing new had to be invented, and nothing else on
 * the board changed meaning.
 */
function asCurveHandles(extra: readonly ExtraHandle[]): CurveHandle[] {
  const out: CurveHandle[] = []
  for (const h of extra) {
    if (!h || !h.pos || !Number.isFinite(h.pos.x) || !Number.isFinite(h.pos.y)) continue
    out.push({ id: h.id, pos: h.pos, kind: 'feature', label: h.label, cursor: 'grab' })
  }
  return out
}

/**
 * The cored dot, for App-owned points with no curve behind them.
 *
 * renderBoard draws chrome.handles only for the SELECTED CURVE — which is the
 * right rule for a curve's own handles, and leaves nothing to draw the point a
 * slope field's solution curve passes through, because a field is not a curve
 * and the board has no FittedCurve selected while its card is open. The hit
 * test, the drag and the tip all already work; this is only the picture.
 *
 * Deliberately the SAME glyph as renderBoard's 'feature' handle — a filled
 * disc with a ground rim and a ground core ring — because it means the same
 * thing: a point on the figure you can put a finger on.
 */
function drawOwnedPoints(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  theme: Theme,
  handles: readonly ExtraHandle[],
  activeId: string | null,
  fallback: string,
  scale: PaintScale | null | undefined,
): void {
  const { stroke } = paintScale(scale)
  ctx.save()
  for (const h of handles) {
    if (!h.pos || !Number.isFinite(h.pos.x) || !Number.isFinite(h.pos.y)) continue
    const sp = toScreen(h.pos, vp)
    if (
      !Number.isFinite(sp.x) ||
      !Number.isFinite(sp.y) ||
      sp.x < -24 ||
      sp.y < -24 ||
      sp.x > vp.widthPx + 24 ||
      sp.y > vp.heightPx + 24
    ) {
      continue
    }
    const r = (5.5 + (h.id === activeId ? 3 : 0)) * stroke
    ctx.beginPath()
    ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2)
    ctx.fillStyle = h.color ?? fallback
    ctx.fill()
    ctx.lineWidth = 2 * stroke
    ctx.strokeStyle = theme.bg
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(sp.x, sp.y, r * 0.42, 0, Math.PI * 2)
    ctx.lineWidth = 1.4 * stroke
    ctx.strokeStyle = theme.bg
    ctx.stroke()
  }
  ctx.restore()
}

type Gesture =
  | {
      type: 'draw'
      pointerId: number
      kind: PointerKind
      /**
       * Finger ink stays invisible until this moment. The second finger of a
       * pinch arrives tens of ms after the first, and cancels it; holding the
       * first strokes back means that cancelled stroke is never SEEN. The
       * points are collected all along, so a real stroke loses nothing.
       */
      inkHoldUntil: number
    }
  | { type: 'pan'; pointerId: number; kind: PointerKind; lastX: number; lastY: number; moved: number }
  | {
      type: 'dragHandle'
      pointerId: number
      curveId: string
      handleId: string
      label?: string
      moved: number
      /** The App owns this point: its drags go out, not into applyHandleDrag. */
      extra: boolean
    }
  | {
      type: 'dragPoint'
      pointerId: number
      curveId: string
      grab: Vec2
      alt: boolean
      origParams: number[]
      origStroke?: Vec2[]
      raw: Vec2[]
      escapable: boolean
      moved: number
    }
  | {
      type: 'pinch'
      p1: number
      p2: number
      startDist: number
      startPpu: number
      /** The y scale at the start, when the axes are Independent. */
      startPpuY: number | undefined
      startMathMid: Vec2
    }
  | {
      /**
       * A drag along one axis' NUMBERS: stretches that axis about the board
       * centre, the grabbed number staying under the pointer.
       */
      type: 'stretch'
      pointerId: number
      kind: PointerKind
      axis: Axis
      start: Vec2
      startPpu: number
      moved: number
    }

interface Fade {
  curveId: string
  color: string
  pts: Vec2[]
  start: number
}

interface PointerEntry {
  x: number
  y: number
  t: number
}

interface HoverInfo {
  handleId: string | null
  /** Index into `analysis` when the pointer is over an editable marker. */
  markerIndex: number | null
  cursor: string
  /** Hover tooltip anchored on the handle/marker itself (null elsewhere). */
  tip: { x: number; y: number; label: string; hint: string } | null
}

/** Open "type exact values" popover for one handle, or one analysis feature. */
interface HandleEdit {
  curveId: string
  handleId: string
  kind: CurveHandle['kind']
  title: string
  fields: HandleField[]
  /** Handle position, screen px (anchor) and math (target rebuild). */
  anchor: Vec2
  pos: Vec2
  /** Center handle of the same curve, when it has one. */
  center: Vec2 | null
  color: string
  /**
   * Set when this popover is editing an analysis feature rather than a control
   * handle: the commit goes to the feature solver, not applyHandleDrag, and it
   * is never snapped.
   */
  feature?: { point: SpecialPoint; index: number; axes: FeatureAxes }
}

/** Max delay/slop for the touch/pen double-tap fallback. */
const DOUBLE_TAP_MS = 450
const DOUBLE_TAP_PX = 12

// ---------------------------------------------------------------------------
// Analysis markers.
//
// Markers are now editable too (double-click one to state its exact position),
// so "interactive vs informational" no longer separates them from the edit
// handles. The distinction that replaces it is GESTURE, and it is deliberate:
//
//   handles are controls — permanently filled, larger, grabbed with a single
//     press and dragged continuously; they change the curve while you move.
//   markers are values — the hollow ring / diamond / faint dot vocabulary the
//     reader already learned, unchanged at rest, and never draggable. They
//     answer to a double-click only, which opens the same typed editor.
//
// So the canvas at rest still reads as a graph with its features labelled
// rather than a control panel studded with grab points; a marker's editability
// is revealed on approach instead (dashed halo + cursor + tooltip on hover).
//
// The priority rule is unchanged and enforced in two places: markers are
// suppressed wherever a handle sits within the handle hit radius (a parabola's
// vertex is both a handle and a minimum), and markerAt() applies the same mask,
// so a marker that isn't drawn can never be clicked and a handle always wins
// the pointer. Handles are hit-tested first regardless.
// ---------------------------------------------------------------------------




export const CanvasStage = forwardRef<CanvasStageHandle, Props>(function CanvasStage(
  {
    curves,
    styles,
    models,
    theme,
    present,
    wheelPref,
    axisUnits,
    selectedId,
    mode,
    inkColor,
    vpRef,
    onStrokeRecognized,
    onSelect,
    onDrawingChange,
    onDragCurve,
    onHandleDrag,
    onOversketch,
    onOversketchFail,
    onIntentChange = noop,
    onNotice = noop,
    onCurveEditStart,
    onCurveEditEnd,
    onCurveEditCancel,
    onViewportChange,
    analysis,
    analysisHighlight,
    intersections,
    onFeatureEdit,
    overlays,
    fields,
    polylines,
    shapes,
    scatter,
    grid,
    figure,
    caption,
    curveNames,
    extraHandles,
    pointPick,
  },
  handle,
) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)

  // Mutable mirrors for the rAF loop / native listeners.
  const curvesRef = useRef<FittedCurve[]>(curves)
  const stylesRef = useRef<StyleMap>(styles)
  const modelsRef = useRef<Record<string, ModelSpec>>(models)
  const selectedRef = useRef<string | null>(selectedId)
  /**
   * Accepted, mirrored, and deliberately never read: the canvas is modeless.
   * Space/middle/right/two-finger pan, a tap selects, and the pen draws — all
   * at once, in every "mode". Reviewers measured Pan mode as needed once in
   * seven flows while a mode error cost a curve, so the value is ignored here
   * until App drops the toggle.
   */
  const modeRef = useRef<Mode>(mode)
  const inkColorRef = useRef(inkColor)
  const themeRef = useRef<Theme>(theme)
  const presentRef = useRef<PaintScale | null | undefined>(present)
  const axisUnitsRef = useRef<AxisUnits | null | undefined>(axisUnits)
  const overlaysRef = useRef<readonly Overlay[] | null | undefined>(overlays)
  const fieldsRef = useRef<readonly SlopeField[] | null | undefined>(fields)
  const polylinesRef = useRef<readonly Polyline[] | null | undefined>(polylines)
  const shapesRef = useRef<readonly Shape[] | null | undefined>(shapes)
  const scatterRef = useRef<readonly ScatterSet[] | null | undefined>(scatter)
  const gridRef = useRef<BoardGrid | null | undefined>(grid)
  const figureRef = useRef<FigureStyle | null | undefined>(figure)
  const captionRef = useRef<string | null | undefined>(caption)
  const curveNamesRef = useRef<Props['curveNames']>(curveNames)
  const extraHandlesRef = useRef<readonly ExtraHandle[]>(extraHandles ?? [])
  const pointPickRef = useRef<Props['pointPick']>(pointPick)

  const pointersRef = useRef<Map<number, PointerEntry>>(new Map())
  const gestureRef = useRef<Gesture | null>(null)
  const inkRef = useRef<Vec2[]>([])
  const fadeRef = useRef<Fade | null>(null)
  const spaceRef = useRef(false)
  const hoverRef = useRef<HoverInfo | null>(null)
  const viewportChangeRef = useRef(onViewportChange)
  viewportChangeRef.current = onViewportChange
  const analysisRef = useRef<SpecialPoint[]>(analysis)
  const intersectionsRef = useRef<Props['intersections']>(intersections)
  const highlightRef = useRef<number | null>(analysisHighlight)
  const oversketchForRef = useRef<string | null>(null)
  /** Pointer kind that owns the gesture in progress (palm rejection). */
  const gestureKindRef = useRef<PointerKind | null>(null)
  /** When a pen was last seen, so a stray touch can be distrusted after it. */
  const lastPenAtRef = useRef(-Infinity)
  /** Contacts the board has decided do not exist (rejected palms). */
  const ignoredPointersRef = useRef<Set<number>>(new Set())
  /** Running tally of how much of the live stroke sits on the target curve. */
  const bandRef = useRef({ inside: 0, total: 0 })
  /** Hit radii. Fatter for fingers; the drawn sizes never change with them. */
  const hitRef = useRef<HitRadii>(hitRadii(false))
  const coarseRef = useRef(false)
  const intentRef = useRef<DrawIntent | null>(null)

  const rafRef = useRef(0)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [panning, setPanning] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const [draggingCurve, setDraggingCurve] = useState(false)
  /** Which axis a drag on its numbers is stretching, for the cursor. */
  const [stretching, setStretching] = useState<Axis | null>(null)
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null)
  const [dragTip, setDragTip] = useState<{ x: number; y: number; label: string } | null>(null)
  const [intent, setIntentState] = useState<{ x: number; y: number; kind: DrawIntent } | null>(
    null,
  )
  const [handleEdit, setHandleEdit] = useState<HandleEdit | null>(null)
  const handleEditRef = useRef<HandleEdit | null>(null)
  /** Double-tap tracking. `key` is "h:<handleId>" or "m:<markerIndex>". */
  const lastTapRef = useRef<{ t: number; x: number; y: number; key: string } | null>(null)

  const setEditor = useCallback((next: HandleEdit | null): void => {
    handleEditRef.current = next
    setHandleEdit(next)
  }, [])

  /**
   * Keep an open popover ON its handle. The anchor is screen px, so anything
   * that moves the board underneath it — a pan, a zoom, or the stage being
   * reflowed when the sidebar opens — has to re-derive the anchor from the
   * math position the popover was opened on. Without this it detaches and
   * floats over nothing.
   */
  const reanchorEditor = useCallback((): void => {
    const ed = handleEditRef.current
    if (!ed) return
    const a = toScreen(ed.pos, vpRef.current)
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) return
    if (Math.abs(a.x - ed.anchor.x) < 0.5 && Math.abs(a.y - ed.anchor.y) < 0.5) return
    const next: HandleEdit = { ...ed, anchor: a }
    handleEditRef.current = next
    setHandleEdit(next)
  }, [vpRef])

  /**
   * Say — out loud, before the stroke exists — which of the two things a press
   * near the selected curve is going to do. The chip is drawn here so the
   * promise is kept even when nothing outside the stage is listening.
   */
  const setIntent = useCallback(
    (kind: DrawIntent | null, pos: Vec2 | null): void => {
      // Only a CHANGE of mind is worth saying, and the chip stays where the
      // decision was made rather than chasing the pen tip under the hand.
      // That is also what keeps ink cheap: no React render per pointermove.
      if (intentRef.current === kind) return
      intentRef.current = kind
      setIntentState(kind !== null && pos !== null ? { x: pos.x, y: pos.y, kind } : null)
      onIntentChange(kind)
    },
    [onIntentChange],
  )

  // ---------------------------------------------------------------- rendering
  //
  // The stage does not draw the board itself: it BUILDS A SCENE and hands it to
  // renderBoard() — the same routine the PNG export calls. Everything the stage
  // adds on top of the figure (handles, hover/selection halos, live ink) rides
  // in `chrome`, which the export path leaves null. That is the whole reason
  // markers and labels can no longer be present on screen and missing in the
  // file: there is only one place either of them is drawn.
  const draw = useCallback((): void => {
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    if (!canvas || !ctx) return
    const vp = vpRef.current
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const now = performance.now()
    let fade = fadeRef.current
    let fadeT = 1
    if (fade) {
      fadeT = (now - fade.start) / FADE_MS
      if (fadeT >= 1) {
        fadeRef.current = null
        fade = null
        fadeT = 1
      }
    }

    // Handles and markers are hidden for the selected curve while inking or
    // pinching — the pen owns the board then.
    const g = gestureRef.current
    const busy = g?.type === 'draw' || g?.type === 'pinch'
    const sel = curvesRef.current.find((c) => c.id === selectedRef.current && c.visible)
    let handles: CurveHandle[] = []
    if (!busy) {
      if (sel) {
        try {
          handles = getHandles(sel, modelsRef.current)
        } catch {
          /* no handles */
        }
      }
      // The App's own grab points join the family's, in the same glyph
      // vocabulary, so a tangent's point and a parabola's vertex read as the
      // same KIND of thing — which they are: somewhere to put a finger. They
      // are drawn whether or not a CURVE is selected: the point a solution
      // curve passes through belongs to a slope field, which has no curve.
      handles = handles.concat(asCurveHandles(extraHandlesRef.current))
    }

    const openFeature = handleEditRef.current?.feature
    const openIdx =
      sel && openFeature && handleEditRef.current?.curveId === sel.id ? openFeature.index : null

    const overTarget = oversketchForRef.current
      ? curvesRef.current.find((c) => c.id === oversketchForRef.current)
      : undefined

    renderBoard(ctx, {
      vp,
      theme: themeRef.current,
      present: presentRef.current ? paintScale(presentRef.current) : undefined,
      axisUnits: axisUnitsRef.current ?? undefined,
      curves: curvesRef.current,
      styles: stylesRef.current,
      models: modelsRef.current,
      overlays: overlaysRef.current ?? undefined,
      fields: fieldsRef.current ?? undefined,
      polylines: polylinesRef.current ?? undefined,
      shapes: shapesRef.current ?? undefined,
      ...(scatterRef.current && scatterRef.current.length > 0 ? { scatter: scatterRef.current } : {}),
      grid: gridRef.current ?? undefined,
      figure: figureRef.current ?? undefined,
      caption: captionRef.current ?? undefined,
      curveNames: curveNamesRef.current ?? undefined,
      analysis:
        sel && !busy && analysisRef.current.length > 0
          ? { curve: sel, points: analysisRef.current }
          : null,
      // Not gated on the selection, and not gated on `busy`: a crossing
      // belongs to two curves, so it is on the board whenever the App says
      // there are any. It IS gated on the pen — the marker vocabulary gets out
      // of the way while a stroke is being drawn, the same as the rest.
      intersections: busy ? undefined : (intersectionsRef.current ?? undefined),
      chrome: {
        selectedId: selectedRef.current,
        handles,
        activeHandleId:
          g?.type === 'dragHandle'
            ? g.handleId
            : (handleEditRef.current?.handleId ?? hoverRef.current?.handleId ?? null),
        highlight: highlightRef.current,
        openIdx,
        hoverIdx: hoverRef.current?.markerIndex ?? null,
        fade: fade ? { pts: fade.pts, color: fade.color, alpha: Math.max(0, 1 - fadeT) } : null,
        ink:
          inkRef.current.length > 1 && !(g?.type === 'draw' && now < g.inkHoldUntil)
            ? {
                pts: inkRef.current,
                // Oversketch ink borrows the target curve's color.
                color: overTarget ? overTarget.color : inkColorRef.current,
              }
            : null,
        curveAlpha: fade ? { id: fade.curveId, alpha: fadeT } : null,
      },
    })

    // renderBoard paints chrome.handles only for the selected curve. When the
    // selected object is not a curve at all — a slope field — its points have
    // to be drawn here, on top of the same frame, in the same glyph.
    if (!sel && !busy && extraHandlesRef.current.length > 0) {
      drawOwnedPoints(
        ctx,
        vp,
        themeRef.current,
        extraHandlesRef.current,
        g?.type === 'dragHandle'
          ? g.handleId
          : (handleEditRef.current?.handleId ?? hoverRef.current?.handleId ?? null),
        inkColorRef.current,
        presentRef.current,
      )
    }
  }, [vpRef])

  const frame = useCallback((): void => {
    rafRef.current = 0
    draw()
    if (fadeRef.current && !rafRef.current) {
      rafRef.current = requestAnimationFrame(frame)
    }
  }, [draw])

  const scheduleRender = useCallback((): void => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(frame)
  }, [frame])

  useImperativeHandle(handle, () => ({ redraw: scheduleRender }), [scheduleRender])

  // Mirror props into refs, redraw when they change.
  useEffect(() => {
    curvesRef.current = curves
    stylesRef.current = styles
    modelsRef.current = models
    selectedRef.current = selectedId
    modeRef.current = mode
    inkColorRef.current = inkColor
    themeRef.current = theme
    presentRef.current = present
    axisUnitsRef.current = axisUnits
    overlaysRef.current = overlays
    fieldsRef.current = fields
    polylinesRef.current = polylines
    shapesRef.current = shapes
    scatterRef.current = scatter
    gridRef.current = grid
    figureRef.current = figure
    captionRef.current = caption
    curveNamesRef.current = curveNames
    extraHandlesRef.current = extraHandles ?? []
    pointPickRef.current = pointPick
    hitRef.current = hitRadii(coarseRef.current, present)
    analysisRef.current = analysis
    intersectionsRef.current = intersections
    highlightRef.current = analysisHighlight
    scheduleRender()
  }, [
    curves,
    styles,
    models,
    theme,
    present,
    axisUnits,
    overlays,
    fields,
    polylines,
    shapes,
    scatter,
    grid,
    figure,
    caption,
    curveNames,
    extraHandles,
    pointPick,
    selectedId,
    mode,
    inkColor,
    analysis,
    analysisHighlight,
    intersections,
    scheduleRender,
  ])

  // A feature popover is bound to one special point. The moment the point list
  // is rebuilt — the curve reshaped, or markers switched off — that binding is
  // stale, so close it rather than let it edit whatever now sits at that index.
  const analysisIdentityRef = useRef(analysis)
  useEffect(() => {
    if (analysisIdentityRef.current === analysis) return
    analysisIdentityRef.current = analysis
    if (handleEditRef.current?.feature) setEditor(null)
  }, [analysis, setEditor])

  // ------------------------------------------------------------------- sizing
  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    ctxRef.current = canvas.getContext('2d')

    const resize = (): void => {
      const rect = wrap.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const w = Math.max(1, Math.round(rect.width))
      const h = Math.max(1, Math.round(rect.height))
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      vpRef.current.widthPx = w
      vpRef.current.heightPx = h
      // The stage just changed shape (the sidebar opened, the window resized):
      // an open popover's screen anchor is stale the instant this happens.
      reanchorEditor()
      scheduleRender()
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    return () => {
      ro.disconnect()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
  }, [reanchorEditor, scheduleRender, vpRef])

  // --------------------------------------------------------- coarse pointers
  //
  // A fingertip is not a mouse cursor: it lands with ~8mm of slop and hides
  // what it is aiming at. Only the HIT radii grow — every drawn size belongs to
  // renderBoard, and a board that redraws itself fatter on an iPad would be a
  // different figure, not a more reachable one.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    let mq: MediaQueryList
    try {
      mq = window.matchMedia('(pointer: coarse)')
    } catch {
      return
    }
    const apply = (): void => {
      coarseRef.current = mq.matches
      hitRef.current = hitRadii(mq.matches, presentRef.current)
    }
    apply()
    mq.addEventListener?.('change', apply)
    return () => mq.removeEventListener?.('change', apply)
  }, [])

  // ------------------------------------------------------------ space-to-pan
  useEffect(() => {
    /**
     * Space is the activation key for every focused control, so hold-to-pan
     * must yield whenever focus is on something that consumes it. Swallowing it
     * unconditionally meant a keyboard user could Tab to Undo or Export and
     * press Space to no effect at all.
     */
    const consumesSpace = (t: HTMLElement | null): boolean => {
      if (!t) return false
      if (t.isContentEditable) return true
      const role = t.getAttribute('role')
      if (role === 'button' || role === 'menuitem' || role === 'checkbox' || role === 'switch') {
        return true
      }
      return (
        t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'BUTTON' ||
        t.tagName === 'SELECT' ||
        t.tagName === 'A' ||
        t.tagName === 'SUMMARY'
      )
    }

    /**
     * Release the pan grab. A keyup can be lost for good — Cmd-Tab away while
     * Space is down and it is delivered to the other application — which left
     * Draw mode looking active while every stroke panned instead, recoverable
     * only by pressing and releasing Space again. Mirrors the Alt reset in App.
     */
    const release = (): void => {
      if (!spaceRef.current) return
      spaceRef.current = false
      setSpaceHeld(false)
    }

    const down = (e: KeyboardEvent): void => {
      if (e.code !== 'Space') return
      if (consumesSpace(e.target as HTMLElement | null)) return
      e.preventDefault()
      if (!spaceRef.current) {
        spaceRef.current = true
        setSpaceHeld(true)
      }
    }
    const up = (e: KeyboardEvent): void => {
      if (e.code !== 'Space') return
      release()
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') release()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', release)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', release)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  // ------------------------------------------------------------------- wheel
  const wheelPrefRef = useRef<WheelPref>(wheelPref ?? 'auto')
  wheelPrefRef.current = wheelPref ?? 'auto'
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const vp = vpRef.current
      const rect = canvas.getBoundingClientRect()
      const pos = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      // ⇧-wheel stretches x, ⌥-wheel stretches y, anchored on the cursor —
      // except on the polar ruling, which is only drawn on equal axes: there
      // the modifiers keep the meaning they always had.
      const stretch = gridRef.current === 'polar' ? null : wheelStretchAxis(e)
      if (stretch) {
        stretchAbout(vp, stretch, pos, wheelZoomFactor(wheelStretchDelta(e)))
      } else if (classifyWheel(e, wheelPrefRef.current) === 'pan') {
        // A two-finger scroll is a SCROLL. Treating it as zoom meant a Mac
        // trackpad rescaled the whole board while the teacher thought they
        // were moving along the x-axis — and rescaling is not undoable.
        const { dx, dy } = wheelPanDelta(e, vp.heightPx)
        panBy(vp, -dx, -dy)
      } else {
        // Zoom: trackpad pinch (which browsers deliver as a ctrlKey wheel) and
        // the explicit modifier. Still anchored on the cursor, and both axes
        // by the same factor, so a stretched board keeps its stretch.
        zoomAbout(vp, pos, wheelZoomFactor(e))
      }
      reanchorEditor()
      viewportChangeRef.current?.()
      scheduleRender()
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [reanchorEditor, scheduleRender, vpRef])

  // ---------------------------------------------------------------- hit tests
  const curveAt = useCallback(
    (pos: Vec2): FittedCurve | null => {
      const vp = vpRef.current
      const list = curvesRef.current
      for (let i = list.length - 1; i >= 0; i--) {
        const curve = list[i]
        if (!curve.visible) continue
        const poly = sampleCurveScreen(curve, modelsRef.current, vp)
        if (poly.length > 1 && distToPolyline(pos, poly) <= hitRef.current.body) return curve
      }
      return null
    },
    [vpRef],
  )

  /**
   * What a tap MEANS: select the curve under it, otherwise clear the
   * selection — unless a point pick is armed, in which case empty board is
   * where the teacher is pointing at a value rather than at an object.
   *
   * The two are never ambiguous: a tap that lands on a curve still selects
   * that curve while a field's card is selected, so the sticky arming can
   * never trap a board into refusing to select anything.
   */
  const tapAt = useCallback(
    (pos: Vec2): void => {
      const curve = curveAt(pos)
      if (curve) {
        onSelect(curve.id)
        return
      }
      const pick = pointPickRef.current
      if (pick) {
        try {
          pick.onPick(toMath(pos, vpRef.current))
        } catch {
          /* the App refused it — the selection is left exactly as it was */
        }
        return
      }
      onSelect(null)
    },
    [curveAt, onSelect, vpRef],
  )

  const selectedVisible = useCallback((): FittedCurve | null => {
    const sel = curvesRef.current.find((c) => c.id === selectedRef.current)
    return sel && sel.visible ? sel : null
  }, [])

  /** Nearest handle of the selected curve within the handle hit radius (px). */
  const handleAt = useCallback(
    (pos: Vec2): CurveHandle | null => {
      const sel = selectedVisible()
      const vp = vpRef.current
      let hs: CurveHandle[] = []
      if (sel) {
        try {
          hs = getHandles(sel, modelsRef.current)
        } catch {
          hs = []
        }
      }
      // Never gated on a selected curve: see extraHandles in Props.
      hs = hs.concat(asCurveHandles(extraHandlesRef.current))
      if (hs.length === 0) return null
      let best: CurveHandle | null = null
      let bestD = hitRef.current.handle
      for (const h of hs) {
        const sp = toScreen(h.pos, vp)
        const d = Math.hypot(sp.x - pos.x, sp.y - pos.y)
        if (d <= bestD) {
          bestD = d
          best = h
        }
      }
      return best
    },
    [selectedVisible, vpRef],
  )

  /**
   * Nearest editable analysis marker within the marker hit radius.
   *
   * Only ever called once handleAt() has come back empty, and it independently
   * refuses any marker sitting under a handle — the same mask drawAnalysis uses
   * to suppress it — so a marker that is not on screen can never be clicked.
   */
  const markerAt = useCallback(
    (pos: Vec2): { point: SpecialPoint; index: number } | null => {
      const points = analysisRef.current
      if (points.length === 0) return null
      const sel = selectedVisible()
      if (!sel) return null
      const vp = vpRef.current
      let handlePts: Vec2[] = []
      try {
        handlePts = getHandles(sel, modelsRef.current).map((h) => toScreen(h.pos, vp))
      } catch {
        /* no handles — nothing masks the markers */
      }
      for (const h of asCurveHandles(extraHandlesRef.current)) {
        handlePts.push(toScreen(h.pos, vp))
      }
      let best: { point: SpecialPoint; index: number } | null = null
      let bestD = hitRef.current.marker
      for (let i = 0; i < points.length; i++) {
        const p = points[i]
        if (!p || !p.pos || !Number.isFinite(p.pos.x) || !Number.isFinite(p.pos.y)) continue
        // A hole has no marker of its own (the curve layer draws the ring) and
        // no value to move: it is never a click target. Nor is a crossing —
        // its diamond is drawn by the intersection layer, and "put this
        // intersection at x = 3" is not a sentence about either curve, so
        // there is nothing for the feature editor to open. Both questions are
        // the same question, and hasMarkerGlyph is where it is answered.
        if (!hasMarkerGlyph(p.kind)) continue
        const sp = toScreen(p.pos, vp)
        const d = Math.hypot(sp.x - pos.x, sp.y - pos.y)
        if (d > bestD) continue
        // renderBoard suppresses a marker within this radius of a handle, and
        // asks handleHitRadius() for it. A marker it did not draw must never
        // be clickable, so this side has to ask the very same question.
        const maskR = handleHitRadius(presentRef.current)
        const masked = handlePts.some((hp) => Math.hypot(hp.x - sp.x, hp.y - sp.y) <= maskR)
        if (masked) continue
        bestD = d
        best = { point: p, index: i }
      }
      return best
    },
    [selectedVisible, vpRef],
  )

  /** Closest point of the selected curve to pos, with screen-px distance. */
  const nearestOnSelected = useCallback(
    (pos: Vec2): { curve: FittedCurve; distPx: number; mathPos: Vec2 } | null => {
      const sel = selectedVisible()
      if (!sel) return null
      const vp = vpRef.current
      const mp = toMath(pos, vp)
      if (isStretched(vp)) {
        // On a stretched board the nearest point in MATH units is not the
        // nearest on screen, and a math distance times one ppu is no pixel
        // count at all. Measure on screen, then pin the grab to the curve.
        const poly = sampleCurveScreen(sel, modelsRef.current, vp)
        const hit = nearestOnPolyline(pos, poly)
        if (!hit) return null
        let mathPos = toMath(hit.point, vp)
        try {
          const r = nearestOnCurve(sel, modelsRef.current, mathPos)
          if (r && r.pos && Number.isFinite(r.pos.x) && Number.isFinite(r.pos.y)) mathPos = r.pos
        } catch {
          /* the sampled point is close enough to grab by */
        }
        return { curve: sel, distPx: hit.dist, mathPos }
      }
      try {
        const r = nearestOnCurve(sel, modelsRef.current, mp)
        if (r && Number.isFinite(r.dist)) {
          return { curve: sel, distPx: r.dist * vp.pxPerUnit, mathPos: r.pos }
        }
      } catch {
        /* fall back to polyline sampling */
      }
      const poly = sampleCurveScreen(sel, modelsRef.current, vp)
      if (poly.length > 1) {
        return { curve: sel, distPx: distToPolyline(pos, poly), mathPos: mp }
      }
      return null
    },
    [selectedVisible, vpRef],
  )

  /**
   * How far (screen px) a math point is from a curve. On an equal-axes board
   * that is the exact math distance times the one scale; on a stretched board
   * there is no one scale, so it is measured against the curve as drawn.
   */
  const curveDistPx = useCallback(
    (curve: FittedCurve, mp: Vec2): number => {
      const vp = vpRef.current
      if (isStretched(vp)) {
        const poly = sampleCurveScreen(curve, modelsRef.current, vp)
        const hit = nearestOnPolyline(toScreen(mp, vp), poly)
        return hit ? hit.dist : Infinity
      }
      const r = nearestOnCurve(curve, modelsRef.current, mp)
      return r && Number.isFinite(r.dist) ? r.dist * vp.pxPerUnit : Infinity
    },
    [vpRef],
  )

  /**
   * Is this press on an axis' numbers — the band a drag stretches that axis
   * from? Never on the polar ruling, which only exists on equal axes.
   */
  const stretchBandAt = useCallback(
    (pos: Vec2): Axis | null => {
      if (gridRef.current === 'polar') return null
      return axisBandAt(vpRef.current, pos, paintScale(presentRef.current).type)
    },
    [vpRef],
  )

  const setHover = useCallback(
    (info: HoverInfo | null): void => {
      const prev = hoverRef.current
      const same =
        (prev === null && info === null) ||
        (prev !== null &&
          info !== null &&
          prev.handleId === info.handleId &&
          prev.markerIndex === info.markerIndex &&
          prev.cursor === info.cursor)
      if (!same) {
        hoverRef.current = info
        setHoverInfo(info)
        scheduleRender() // handle hover-grow feedback
      }
    },
    [scheduleRender],
  )

  // ------------------------------------------------- exact-value handle input
  /** Field layout adapts to what the handle actually means. */
  const openHandleEditor = useCallback(
    (h: CurveHandle, sel: FittedCurve, anchor: Vec2): void => {
      let center: Vec2 | null = null
      try {
        const all = getHandles(sel, modelsRef.current)
        const c = all.find((x) => x.kind === 'center')
        if (c) center = c.pos
      } catch {
        /* no center handle available */
      }

      const label = h.label ?? h.id
      let fields: HandleField[]
      if (h.kind === 'radius' && center) {
        const len = Math.hypot(h.pos.x - center.x, h.pos.y - center.y)
        // "radius" for a true radius; axis handles read better as a length.
        fields = [{ key: 'r', label: h.id === 'radius' ? 'radius' : 'length', value: len }]
      } else if (h.kind === 'rotation' && center) {
        const deg = (Math.atan2(h.pos.y - center.y, h.pos.x - center.x) * 180) / Math.PI
        fields = [{ key: 'a', label: 'angle', value: deg, suffix: '°' }]
      } else if (h.kind === 'domain-start' || h.kind === 'domain-end') {
        fields = [{ key: 'x', label: 'x', value: h.pos.x }]
      } else {
        fields = [
          { key: 'x', label: 'x', value: h.pos.x },
          { key: 'y', label: 'y', value: h.pos.y },
        ]
      }

      setHover(null)
      setDragTip(null)
      setEditor({
        curveId: sel.id,
        handleId: h.id,
        kind: h.kind,
        title: label,
        fields,
        anchor,
        pos: h.pos,
        center,
        color: sel.color,
      })
      scheduleRender()
    },
    [scheduleRender, setEditor, setHover],
  )

  /**
   * The same popover, anchored on an analysis marker. Which fields it shows is
   * derived from the point's KIND (a zero has no y to choose), never from the
   * curve's family.
   */
  const openFeatureEditor = useCallback(
    (point: SpecialPoint, index: number, sel: FittedCurve, anchor: Vec2): void => {
      const axes = featureAxes(point.kind)
      const fields: HandleField[] = axisKeys(axes).map((k) => ({
        key: k,
        label: k,
        value: point.pos[k],
      }))
      setHover(null)
      setDragTip(null)
      setEditor({
        curveId: sel.id,
        handleId: `feature:${index}`,
        kind: 'feature',
        title: point.label,
        fields,
        anchor,
        pos: point.pos,
        center: null,
        color: sel.color,
        feature: { point, index, axes },
      })
      scheduleRender()
    },
    [scheduleRender, setEditor, setHover],
  )

  /** Rebuild the drag target from typed values, then take the drag commit path. */
  const commitHandleEditor = useCallback(
    (values: number[], skipSnap: boolean): void => {
      const ed = handleEditRef.current
      if (!ed) {
        setEditor(null)
        return
      }

      // Feature edit: state the fact, let the solver decide. A refusal leaves
      // the popover open (and its typed text intact) so the next attempt costs
      // one keystroke, while the board shows the solver's own reason.
      if (ed.feature) {
        const to: { x?: number; y?: number } = {}
        axisKeys(ed.feature.axes).forEach((k, i) => {
          to[k] = values[i]
        })
        if (onFeatureEdit(ed.curveId, ed.feature.point, to)) setEditor(null)
        scheduleRender()
        return
      }

      setEditor(null)
      const curve = curvesRef.current.find((c) => c.id === ed.curveId)
      if (!curve) return

      let target: Vec2
      if (ed.kind === 'radius' && ed.center) {
        let ux = ed.pos.x - ed.center.x
        let uy = ed.pos.y - ed.center.y
        const len = Math.hypot(ux, uy)
        if (len < 1e-12) {
          ux = 1
          uy = 0
        } else {
          ux /= len
          uy /= len
        }
        target = { x: ed.center.x + values[0] * ux, y: ed.center.y + values[0] * uy }
      } else if (ed.kind === 'rotation' && ed.center) {
        const rr = Math.hypot(ed.pos.x - ed.center.x, ed.pos.y - ed.center.y) || 1
        const th = (values[0] * Math.PI) / 180
        target = { x: ed.center.x + rr * Math.cos(th), y: ed.center.y + rr * Math.sin(th) }
      } else if (ed.kind === 'domain-start' || ed.kind === 'domain-end') {
        target = { x: values[0], y: ed.pos.y }
      } else {
        target = { x: values[0], y: values[1] }
      }

      let res: { params: number[]; domain: [number, number] | null }
      try {
        res = applyHandleDrag(curve, modelsRef.current, ed.handleId, target)
      } catch {
        scheduleRender()
        return
      }
      // Same bracket as a drag: one undo entry, and snapParams runs on commit
      // unless Alt was held (matching the "Alt at release keeps it exact" rule).
      onCurveEditStart()
      onHandleDrag(ed.curveId, res.params, res.domain)
      onCurveEditEnd(ed.curveId, skipSnap)
      scheduleRender()
    },
    [onCurveEditEnd, onCurveEditStart, onFeatureEdit, onHandleDrag, scheduleRender, setEditor],
  )

  const cancelHandleEditor = useCallback((): void => {
    setEditor(null)
    scheduleRender()
  }, [scheduleRender, setEditor])

  // ------------------------------------------------------------ stroke finish
  const finishStroke = useCallback(
    (tapPos: Vec2 | null): void => {
      const pts = inkRef.current
      const overFor = oversketchForRef.current
      const band = bandRef.current
      oversketchForRef.current = null
      bandRef.current = { inside: 0, total: 0 }
      inkRef.current = []
      setDrawing(false)
      onDrawingChange(false)
      setIntent(null, null)
      const vp = vpRef.current

      // Degenerate stroke (a tap) — treat as a selection attempt instead.
      let extent = 0
      if (pts.length > 1) {
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        for (const p of pts) {
          if (p.x < minX) minX = p.x
          if (p.y < minY) minY = p.y
          if (p.x > maxX) maxX = p.x
          if (p.y > maxY) maxY = p.y
        }
        extent = Math.max((maxX - minX) * ppuX(vp), (maxY - minY) * ppuY(vp))
      }
      // Extent-based tap test: even a 2-point flick spanning real distance is
      // intentional ink (recognize() handles sparse input; a flick fits a Line).
      if (pts.length < 2 || extent < 6) {
        // A tap is a tap whichever device made it: it selects what is under it
        // and clears the selection on empty board. Refusing to deselect here
        // meant the pen and the finger disagreed about the same gesture.
        if (tapPos) tapAt(tapPos)
        scheduleRender()
        return
      }

      // Oversketch: blend the ink into the targeted (selected) curve — but
      // only while the stroke actually stayed on it.
      //
      // This used to be a hard stop: once a press landed within 12px of the
      // selected curve, that stroke could NEVER become a curve of its own, and
      // a blend the solver refused was dropped without a word. A tangent, an
      // asymptote, a translated copy — everything a teacher draws NEXT to a
      // curve — either vanished or silently rewrote the curve it was drawn
      // beside. So both exits now fall through to recognition instead.
      let blended = false
      if (overFor) {
        const target = curvesRef.current.find((c) => c.id === overFor)
        if (target && !strokeLeftBand(band.inside, band.total)) {
          try {
            const o = oversketch(target, modelsRef.current, pts)
            if (o) {
              onOversketch(target.id, o.params, o.error)
              onNotice('Blended into this curve · Undo')
              fadeRef.current = {
                curveId: target.id,
                color: target.color,
                pts,
                start: performance.now(),
              }
              blended = true
            }
          } catch {
            /* refused — the stroke gets its own curve below */
          }
        }
      }

      let created = false
      if (!blended) {
        try {
          const processed = processStroke(pts, vp)
          const results = recognize(processed, vp)
          if (results && results.length > 0) {
            const curve = onStrokeRecognized(processed, results)
            if (curve) {
              created = true
              fadeRef.current = {
                curveId: curve.id,
                color: curve.color,
                pts: processed.points,
                start: performance.now(),
              }
            }
          }
        } catch (err) {
          console.warn('Stroke recognition failed:', err)
        }
        // Aimed at a curve, blended into nothing, and recognised as nothing:
        // the one case where there is genuinely nothing to show, so say so.
        if (!created && overFor) onOversketchFail(overFor)
      }
      scheduleRender()
    },
    [
      onDrawingChange,
      onNotice,
      onOversketch,
      onOversketchFail,
      onStrokeRecognized,
      scheduleRender,
      setIntent,
      tapAt,
      vpRef,
    ],
  )

  // ---------------------------------------------------------- pointer events
  const getPos = (e: React.PointerEvent): Vec2 => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  /** Try to enter pinch mode from the current pointer map. Prunes stale entries. */
  const startPinch = useCallback((): boolean => {
    const now = performance.now()
    for (const [pid, p] of pointersRef.current) {
      if (now - p.t > POINTER_STALE_MS) pointersRef.current.delete(pid)
    }
    const entries = [...pointersRef.current.entries()]
    if (entries.length < 2) return false
    const [p1, a] = entries[0]
    const [p2, b] = entries[1]
    const vp = vpRef.current
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    gestureRef.current = {
      type: 'pinch',
      p1,
      p2,
      startDist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      startPpu: vp.pxPerUnit,
      startPpuY: vp.pxPerUnitY,
      startMathMid: toMath(mid, vp),
    }
    gestureKindRef.current = 'touch'
    setPanning(true)
    return true
  }, [vpRef])

  /** Cancel whatever gesture is active (reverting edits, discarding ink). */
  const cancelActiveGesture = useCallback((): void => {
    const g = gestureRef.current
    if (!g) return
    if (g.type === 'draw') {
      inkRef.current = []
      oversketchForRef.current = null
      setDrawing(false)
      onDrawingChange(false)
    } else if (g.type === 'dragPoint' || g.type === 'dragHandle') {
      setDraggingCurve(false)
      setDragTip(null)
      onCurveEditCancel()
    } else if (g.type === 'pan' || g.type === 'pinch') {
      setPanning(false)
    } else if (g.type === 'stretch') {
      setStretching(null)
    }
    gestureRef.current = null
    gestureKindRef.current = null
    setIntent(null, null)
  }, [onCurveEditCancel, onDrawingChange, setIntent])

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    // A press on the canvas dismisses an open editor, and is swallowed so that
    // dismissing can never also start a stroke, pan, or drag.
    if (handleEditRef.current) {
      cancelHandleEditor()
      return
    }
    const canvas = e.currentTarget
    const kind = pointerKind(e.pointerType)
    const pos = getPos(e)
    const now = performance.now()
    if (kind === 'pen') lastPenAtRef.current = now

    // A gesture whose pointer entries are missing or stale is itself dead
    // (its pointerup/cancel was lost) — kill it so it can't hijack this one.
    const g0 = gestureRef.current
    if (g0) {
      const ids = g0.type === 'pinch' ? [g0.p1, g0.p2] : [g0.pointerId]
      const dead = ids.some((pid) => {
        const p = pointersRef.current.get(pid)
        return !p || now - p.t > POINTER_STALE_MS
      })
      if (dead) cancelActiveGesture()
    }
    // HARD INVARIANT: with no gesture in progress there can be no legitimate
    // tracked pointers. Clearing here means a missed pointerup/cancel can
    // never permanently hijack drawing into phantom-pinch mode.
    if (gestureRef.current === null) {
      pointersRef.current.clear()
      ignoredPointersRef.current.clear()
    }
    // Defensive: drop stale/phantom entries even mid-gesture.
    for (const [pid, p] of pointersRef.current) {
      if (now - p.t > POINTER_STALE_MS) pointersRef.current.delete(pid)
    }

    // What this contact MEANS is decided before any state moves — see
    // classifyPointerDown. Nothing below may promote a second contact to a
    // pinch on its own again.
    let verdict = classifyPointerDown({
      kind,
      button: e.button,
      spaceHeld: spaceRef.current,
      activeKind: gestureRef.current ? gestureKindRef.current : null,
      contacts: pointersRef.current.size,
      penRecent: penGuardActive(lastPenAtRef.current, now),
    })

    if (verdict === 'ignore') {
      // A palm (or a phantom second pen). It is never captured and never
      // tracked, so it cannot cancel the stroke, pinch the board, or fire an
      // up that ends somebody else's gesture.
      ignoredPointersRef.current.add(e.pointerId)
      return
    }

    try {
      canvas.setPointerCapture(e.pointerId)
    } catch {
      /* pointer already gone (or synthetic) — capture is best-effort */
    }

    if (verdict === 'preempt') {
      // The pen landed on a board a palm had already claimed. Drop the palm,
      // the gesture it started, and any viewport drift it was about to cause —
      // then ask again on the now-empty board what this contact means.
      cancelActiveGesture()
      for (const pid of pointersRef.current.keys()) ignoredPointersRef.current.add(pid)
      pointersRef.current.clear()
      verdict = classifyPointerDown({
        kind,
        button: e.button,
        spaceHeld: spaceRef.current,
        activeKind: null,
        contacts: 0,
        penRecent: penGuardActive(lastPenAtRef.current, now),
      })
    }

    pointersRef.current.set(e.pointerId, { x: pos.x, y: pos.y, t: now })

    if (verdict === 'pinch') {
      // Second finger down: cancel current gesture, switch to pinch.
      cancelActiveGesture()
      if (startPinch()) {
        scheduleRender()
        return
      }
      // Pinch didn't materialize (phantom pruned) — pan with this finger.
      gestureRef.current = {
        type: 'pan',
        pointerId: e.pointerId,
        kind,
        lastX: pos.x,
        lastY: pos.y,
        moved: 0,
      }
      gestureKindRef.current = kind
      setPanning(true)
      scheduleRender()
      return
    }

    setHover(null)

    if (verdict === 'ink') {
      // 0. A one-shot point pick takes the whole press. The teacher asked for
      //    "+ solution through a point" and is now pointing at the point:
      //    nothing else this press could mean is what they meant, so it never
      //    selects, never starts a stroke, and disarms itself by reporting.
      const pick = pointPickRef.current
      if (pick && !pick.sticky) {
        try {
          pick.onPick(toMath(pos, vpRef.current))
        } catch {
          /* refused — nothing on the board changes */
        }
        scheduleRender()
        return
      }

      // 1. Handle grab beats everything (any mode) when a curve is selected.
      //    Markers are only consulted where no handle answered.
      const h = handleAt(pos)
      const sel = selectedVisible()
      const marker = h ? null : markerAt(pos)

      // 1a. Double-click/tap a handle OR a marker: type exact values.
      const ownedByApp =
        h !== null && extraHandlesRef.current.some((x) => x.id === h.id)
      // A family handle opens the exact-value popover on a double tap. An
      // App-owned point has no such editor — its exact value is typed on the
      // card that owns it — so a second tap just starts another drag.
      const tapKey = h && !ownedByApp ? `h:${h.id}` : marker ? `m:${marker.index}` : null
      if (tapKey && sel) {
        const prev = lastTapRef.current
        const isDouble =
          e.detail >= 2 ||
          (prev !== null &&
            prev.key === tapKey &&
            now - prev.t < DOUBLE_TAP_MS &&
            Math.hypot(pos.x - prev.x, pos.y - prev.y) < DOUBLE_TAP_PX)
        lastTapRef.current = { t: now, x: pos.x, y: pos.y, key: tapKey }
        if (isDouble) {
          lastTapRef.current = null
          // Never leave the first click's gesture (or its pointer entry) behind.
          cancelActiveGesture()
          pointersRef.current.clear()
          if (h) openHandleEditor(h, sel, toScreen(h.pos, vpRef.current))
          else if (marker) {
            openFeatureEditor(
              marker.point,
              marker.index,
              sel,
              toScreen(marker.point.pos, vpRef.current),
            )
          }
          return
        }
      } else {
        lastTapRef.current = null
      }
      // A single press on a marker deliberately falls through: the marker sits
      // ON the curve, and dragging the curve there must keep working.

      // An App-owned point is grabbable without a selected curve: it belongs
      // to whatever IS selected, which may be a slope field.
      if (h && (sel || ownedByApp)) {
        gestureRef.current = {
          type: 'dragHandle',
          pointerId: e.pointerId,
          curveId: sel?.id ?? '',
          handleId: h.id,
          label: h.label,
          moved: 0,
          extra: ownedByApp,
        }
        gestureKindRef.current = kind
        onCurveEditStart()
        setDraggingCurve(true)
        if (h.label) setDragTip({ x: pos.x, y: pos.y, label: h.label })
        scheduleRender()
        return
      }

      // 2. Grabbing the selected curve itself: semantic drag (Alt = rigid).
      const near = nearestOnSelected(pos)
      if (near && near.distPx <= hitRef.current.body) {
        gestureRef.current = {
          type: 'dragPoint',
          pointerId: e.pointerId,
          curveId: near.curve.id,
          grab: near.mathPos,
          alt: e.altKey,
          origParams: near.curve.params.slice(),
          origStroke: near.curve.sourceStroke?.map((p) => ({ x: p.x, y: p.y })),
          raw: [toMath(pos, vpRef.current)],
          escapable: !e.altKey,
          moved: 0,
        }
        gestureKindRef.current = kind
        onCurveEditStart()
        setDraggingCurve(true)
        scheduleRender()
        return
      }

      // 2b. On an axis' numbers: stretch that axis. After the handles and the
      //     selected curve (a curve crossing the labels is still grabbable),
      //     before ink — the numbers are not somewhere anybody sketches.
      const band = stretchBandAt(pos)
      if (band) {
        const vp = vpRef.current
        gestureRef.current = {
          type: 'stretch',
          pointerId: e.pointerId,
          kind,
          axis: band,
          start: pos,
          startPpu: band === 'x' ? ppuX(vp) : ppuY(vp),
          moved: 0,
        }
        gestureKindRef.current = kind
        setStretching(band)
        scheduleRender()
        return
      }

      // 3. Ink. Within 12px of the selected curve the stroke aims at that
      //    curve — and the chip says which of the two things that means
      //    BEFORE a single point is drawn, rather than leaving the teacher to
      //    find out from what the board did afterwards.
      const over = near && near.distPx <= OVERSKETCH_RADIUS ? near.curve.id : null
      oversketchForRef.current = over
      bandRef.current = { inside: 0, total: 0 }
      if (sel) setIntent(over ? 'reshape' : 'new', pos)
      gestureRef.current = {
        type: 'draw',
        pointerId: e.pointerId,
        kind,
        inkHoldUntil: kind === 'touch' ? now + TOUCH_INK_HOLD_MS : 0,
      }
      gestureKindRef.current = kind
      inkRef.current = [toMath(pos, vpRef.current)]
      setDrawing(true)
      onDrawingChange(true)
      scheduleRender()
      return
    }

    // 4. Held pan: space, middle/right button, or a single finger.
    gestureRef.current = {
      type: 'pan',
      pointerId: e.pointerId,
      kind,
      lastX: pos.x,
      lastY: pos.y,
      moved: 0,
    }
    gestureKindRef.current = kind
    setPanning(true)
    scheduleRender()
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    // A rejected palm keeps sending moves for as long as it rests there. None
    // of them are allowed to reach the board.
    if (ignoredPointersRef.current.has(e.pointerId)) return
    if (e.pointerType === 'pen') lastPenAtRef.current = performance.now()
    const pos = getPos(e)
    const g = gestureRef.current
    const vp = vpRef.current

    // Idle hover: handle hover-grow + cursor, or 'move' near the selected curve.
    if (!g) {
      if (!spaceRef.current && !handleEditRef.current) {
        const h = handleAt(pos)
        const marker = h ? null : markerAt(pos)
        if (h) {
          const sp = toScreen(h.pos, vp)
          setHover({
            handleId: h.id,
            markerIndex: null,
            // 'pointer', not 'grab': the handle's best trick is the one a
            // grab cursor hides — double-click it and type the exact value.
            cursor: h.cursor ?? 'pointer',
            tip: {
              x: sp.x,
              y: sp.y,
              label: h.label ?? h.id,
              // An App-owned point has no popover of its own — its exact
              // value is typed on the card that owns it — so promising one
              // here would be a hint that does nothing.
              hint: extraHandlesRef.current.some((x) => x.id === h.id)
                ? 'drag to move'
                : 'double-click to type',
            },
          })
        } else if (marker) {
          const sp = toScreen(marker.point.pos, vp)
          setHover({
            handleId: null,
            markerIndex: marker.index,
            // Not 'grab': a marker is never dragged, only stated.
            cursor: 'pointer',
            tip: {
              x: sp.x,
              y: sp.y,
              label: marker.point.label,
              hint: `double-click to set ${axesPhrase(featureAxes(marker.point.kind))}`,
            },
          })
        } else {
          const near = nearestOnSelected(pos)
          const band = near && near.distPx <= hitRef.current.body ? null : stretchBandAt(pos)
          setHover(
            near && near.distPx <= hitRef.current.body
              ? { handleId: null, markerIndex: null, cursor: 'move', tip: null }
              : band
                ? {
                    handleId: null,
                    markerIndex: null,
                    cursor: band === 'x' ? 'ew-resize' : 'ns-resize',
                    tip: null,
                  }
                : null,
          )
        }
      } else {
        setHover(null)
      }
      return
    }

    if (!pointersRef.current.has(e.pointerId)) return
    pointersRef.current.set(e.pointerId, { x: pos.x, y: pos.y, t: performance.now() })

    if (g.type === 'draw' && g.pointerId === e.pointerId) {
      const mp = toMath(pos, vp)
      inkRef.current.push(mp)
      // Keep the running tally of how much of this stroke is actually ON the
      // curve it started beside, so the chip can change its mind out loud —
      // and so finishStroke never has to walk the stroke again.
      const over = oversketchForRef.current
      if (over) {
        const b = bandRef.current
        b.total += 1
        const curve = curvesRef.current.find((c) => c.id === over)
        let distPx = Infinity
        if (curve) {
          try {
            distPx = curveDistPx(curve, mp)
          } catch {
            /* unmeasurable this tick — counts as away from the curve */
          }
        }
        if (distPx <= NEIGHBOURHOOD_PX) b.inside += 1
        setIntent(strokeLeftBand(b.inside, b.total) ? 'new' : 'reshape', pos)
      } else if (intentRef.current) {
        setIntent('new', pos)
      }
      scheduleRender()
    } else if (g.type === 'pan' && g.pointerId === e.pointerId) {
      const dx = pos.x - g.lastX
      const dy = pos.y - g.lastY
      g.moved += Math.abs(dx) + Math.abs(dy)
      g.lastX = pos.x
      g.lastY = pos.y
      // A resting palm jitters by a pixel or two. A finger has to mean it
      // before the board moves under the figure.
      if (g.kind === 'touch' && g.moved < TOUCH_PAN_SLOP) return
      panBy(vp, dx, dy)
      reanchorEditor()
      viewportChangeRef.current?.()
      scheduleRender()
    } else if (g.type === 'dragHandle' && g.pointerId === e.pointerId) {
      g.moved += 1
      if (g.extra) {
        const owner = extraHandlesRef.current.find((x) => x.id === g.handleId)
        if (owner) {
          try {
            owner.onDrag(toMath(pos, vp))
          } catch {
            /* the App refused this position — leave everything as it is */
          }
        }
        if (g.label) setDragTip({ x: pos.x, y: pos.y, label: g.label })
        scheduleRender()
        return
      }
      const curve = curvesRef.current.find((c) => c.id === g.curveId)
      if (curve) {
        try {
          const res = applyHandleDrag(curve, modelsRef.current, g.handleId, toMath(pos, vp))
          onHandleDrag(g.curveId, res.params, res.domain)
        } catch {
          /* handle drag rejected — keep current shape */
        }
      }
      if (g.label) setDragTip({ x: pos.x, y: pos.y, label: g.label })
      scheduleRender()
    } else if (g.type === 'dragPoint' && g.pointerId === e.pointerId) {
      g.moved += 1
      const target = toMath(pos, vp)
      g.raw.push(target)
      const curve = curvesRef.current.find((c) => c.id === g.curveId)
      const spec = curve ? modelsRef.current[curve.modelId] : undefined
      if (curve && spec) {
        if (g.alt && spec.translate) {
          // Rigid translate (Alt): whole-curve move, stroke follows.
          const dx = target.x - g.grab.x
          const dy = target.y - g.grab.y
          try {
            const params = spec.translate(g.origParams, dx, dy)
            const stroke = g.origStroke
              ? g.origStroke.map((p) => ({ x: p.x + dx, y: p.y + dy }))
              : undefined
            onDragCurve(g.curveId, params, stroke)
          } catch {
            /* translate failed — leave curve as-is */
          }
        } else {
          // Semantic drag: move the grabbed curve point to the cursor.
          let freshParams: number[] | null = null
          try {
            freshParams = dragCurvePoint(
              { ...curve, params: g.origParams.slice() },
              modelsRef.current,
              g.grab,
              target,
            )
            onDragCurve(g.curveId, freshParams)
          } catch {
            /* solver failed this tick — keep current shape */
          }
          // Escape hatch (draw mode): the cursor ran away from where the
          // solver could take the curve — the user is sketching, not dragging.
          // Measure against the FRESH shape (the state mirror can lag a frame).
          if (g.escapable) {
            let distPx = Infinity
            try {
              const probe = freshParams ? { ...curve, params: freshParams } : curve
              distPx = curveDistPx(probe, target)
            } catch {
              const near = nearestOnSelected(pos)
              if (near) distPx = near.distPx
            }
            if (distPx > ESCAPE_PX) {
              onCurveEditCancel() // revert live params to pre-drag state
              oversketchForRef.current = g.curveId
              inkRef.current = g.raw.slice()
              bandRef.current = { inside: 0, total: 0 }
              gestureRef.current = {
                type: 'draw',
                pointerId: e.pointerId,
                kind: gestureKindRef.current ?? 'mouse',
                // Already a deliberate, committed gesture — nothing to hold back.
                inkHoldUntil: 0,
              }
              setIntent('new', pos)
              setDraggingCurve(false)
              setDrawing(true)
              onDrawingChange(true)
            }
          }
        }
      }
      scheduleRender()
    } else if (g.type === 'pinch') {
      const a = pointersRef.current.get(g.p1)
      const b = pointersRef.current.get(g.p2)
      if (!a || !b) return
      const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      // Both axes by the same factor: a pinch zooms, it never stretches. The
      // factor is clamped once, for both, so the ratio survives the limits.
      let f = dist / g.startDist
      const sy = g.startPpuY ?? g.startPpu
      const lo = Math.max(MIN_PPU / g.startPpu, MIN_PPU / sy)
      const hi = Math.min(MAX_PPU / g.startPpu, MAX_PPU / sy)
      f = Math.min(hi, Math.max(lo, f))
      vp.pxPerUnit = g.startPpu * f
      if (g.startPpuY !== undefined) vp.pxPerUnitY = g.startPpuY * f
      vp.center = {
        x: g.startMathMid.x - (mid.x - vp.widthPx / 2) / ppuX(vp),
        y: g.startMathMid.y + (mid.y - vp.heightPx / 2) / ppuY(vp),
      }
      reanchorEditor()
      viewportChangeRef.current?.()
      scheduleRender()
    } else if (g.type === 'stretch' && g.pointerId === e.pointerId) {
      const along = g.axis === 'x' ? pos.x : pos.y
      const from = g.axis === 'x' ? g.start.x : g.start.y
      g.moved = Math.max(g.moved, Math.abs(along - from))
      const centre = { x: vp.widthPx / 2, y: vp.heightPx / 2 }
      const f = dragStretchFactor(from, along, g.axis === 'x' ? centre.x : centre.y)
      setAxisScale(vp, g.axis, g.startPpu * f, centre)
      reanchorEditor()
      viewportChangeRef.current?.()
      scheduleRender()
    }
  }

  const endPointer = (e: React.PointerEvent<HTMLCanvasElement>, cancelled: boolean): void => {
    // A rejected palm lifting is not the end of anything.
    if (ignoredPointersRef.current.delete(e.pointerId)) return
    const pos = getPos(e)
    pointersRef.current.delete(e.pointerId)
    const g = gestureRef.current

    if (g?.type === 'pinch') {
      if (e.pointerId === g.p1 || e.pointerId === g.p2) {
        const nowUp = performance.now()
        const remaining = [...pointersRef.current.entries()].filter(
          ([, p]) => nowUp - p.t <= POINTER_STALE_MS,
        )
        if (remaining.length >= 1) {
          const [pid, p] = remaining[0]
          gestureRef.current = {
            type: 'pan',
            pointerId: pid,
            kind: 'touch',
            lastX: p.x,
            lastY: p.y,
            moved: 10,
          }
        } else {
          gestureRef.current = null
          gestureKindRef.current = null
          setPanning(false)
        }
      }
      return
    }

    if (g?.type === 'draw' && g.pointerId === e.pointerId) {
      gestureRef.current = null
      gestureKindRef.current = null
      if (cancelled) {
        inkRef.current = []
        oversketchForRef.current = null
        bandRef.current = { inside: 0, total: 0 }
        setDrawing(false)
        onDrawingChange(false)
        setIntent(null, null)
        scheduleRender()
      } else {
        finishStroke(pos)
      }
      return
    }

    if ((g?.type === 'dragPoint' || g?.type === 'dragHandle') && g.pointerId === e.pointerId) {
      gestureRef.current = null
      gestureKindRef.current = null
      setDraggingCurve(false)
      setDragTip(null)
      if (cancelled || g.moved < 2) {
        // Cancelled, or a plain click on the curve/handle — no edit.
        onCurveEditCancel()
      } else if (g.type === 'dragHandle' && g.extra) {
        // The curve under an App-owned point was never edited, so magnetizing
        // its coefficients here would be an edit nobody asked for.
        onCurveEditEnd(null, true)
      } else {
        onCurveEditEnd(g.curveId, e.altKey)
      }
      scheduleRender()
      return
    }

    if (g?.type === 'stretch' && g.pointerId === e.pointerId) {
      gestureRef.current = null
      gestureKindRef.current = null
      setStretching(null)
      // A press on the numbers that never moved is a tap like any other.
      if (!cancelled && g.moved < 3) tapAt(pos)
      scheduleRender()
      return
    }

    if (g?.type === 'pan' && g.pointerId === e.pointerId) {
      gestureRef.current = null
      gestureKindRef.current = null
      setPanning(false)
      if (!cancelled && g.moved < 4) {
        // A click, not a drag — select the curve under the cursor, or clear
        // the selection on empty board. A tap by a finger that arrived while
        // the pen was in play is a palm, and changes nothing.
        const palm =
          g.kind === 'touch' && penGuardActive(lastPenAtRef.current, performance.now())
        if (!palm) tapAt(pos)
      }
    }
  }

  /** Capture loss (missed pointerup, OS-level interruption): never leave a
   *  stale gesture or pointer entry behind. Fires after normal pointerup too,
   *  by which time the gesture is already null — that path is a no-op. */
  const onLostCapture = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (ignoredPointersRef.current.delete(e.pointerId)) return
    pointersRef.current.delete(e.pointerId)
    const g = gestureRef.current
    if (!g) return
    const involved =
      g.type === 'pinch'
        ? g.p1 === e.pointerId || g.p2 === e.pointerId
        : g.pointerId === e.pointerId
    if (involved) {
      cancelActiveGesture()
      scheduleRender()
    }
  }

  const hoverTip = handleEdit ? null : (hoverInfo?.tip ?? null)

  // The canvas is MODELESS, so the cursor answers for the thing under it, not
  // for a mode: pointer over a handle, move over the curve body, crosshair on
  // empty board, grab only while space is actually held. `mode` is accepted
  // and deliberately not read — drawing, panning and selecting all live here
  // at once, and a mode error used to cost a teacher their last curve.
  const cursor = drawing
    ? 'crosshair'
    : stretching
      ? stretching === 'x'
        ? 'ew-resize'
        : 'ns-resize'
      : draggingCurve
      ? 'grabbing'
      : panning
        ? 'grabbing'
        : hoverInfo
          ? hoverInfo.cursor
          : spaceHeld
            ? 'grab'
            : 'crosshair'

  return (
    <div ref={wrapRef} className="stage">
      <canvas
        ref={canvasRef}
        className="stage-canvas"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endPointer(e, false)}
        onPointerCancel={(e) => endPointer(e, true)}
        onLostPointerCapture={onLostCapture}
        onContextMenu={(e) => e.preventDefault()}
      />
      {intent && (
        <div
          className="intent-chip"
          data-testid="intent-chip"
          data-intent={intent.kind}
          style={{
            position: 'absolute',
            left: intent.x + 16,
            top: intent.y - 34,
            zIndex: 13,
            pointerEvents: 'none',
            padding: '2px 8px',
            borderRadius: 999,
            whiteSpace: 'nowrap',
            fontSize: 11,
            lineHeight: '16px',
            letterSpacing: '0.02em',
            color: '#fff',
            background:
              intent.kind === 'reshape' ? 'rgba(56, 120, 220, 0.94)' : 'rgba(19, 23, 34, 0.94)',
            border: '1px solid rgba(255, 255, 255, 0.22)',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.35)',
          }}
        >
          {intent.kind === 'reshape' ? 'reshape' : 'new curve'}
        </div>
      )}
      {dragTip ? (
        <div style={{ ...tipPlacement(dragTip.x, dragTip.y), position: 'absolute', zIndex: 12 }}>
          <div className="handle-tip" style={{ position: 'static' }}>
            {dragTip.label}
          </div>
        </div>
      ) : (
        hoverTip && (
          <div
            style={{ ...tipPlacement(hoverTip.x, hoverTip.y), position: 'absolute', zIndex: 12 }}
          >
            <div className="handle-tip" data-testid="handle-tip" style={{ position: 'static' }}>
              {hoverTip.label}
              <span className="handle-tip-hint">{hoverTip.hint}</span>
            </div>
          </div>
        )
      )}
      {handleEdit && (
        <HandleInput
          key={`${handleEdit.curveId}:${handleEdit.handleId}`}
          title={handleEdit.title}
          fields={handleEdit.fields}
          anchor={handleEdit.anchor}
          bounds={{ w: vpRef.current.widthPx, h: vpRef.current.heightPx }}
          color={handleEdit.color}
          hint={
            handleEdit.feature
              ? // No ⌥Enter: a stated feature is never magnetized to a rounder
                // number, so offering the modifier would be a lie.
                `Enter puts the ${handleEdit.title} exactly here · Esc cancels`
              : undefined
          }
          onCommit={commitHandleEditor}
          onCancel={cancelHandleEditor}
        />
      )}
    </div>
  )
})

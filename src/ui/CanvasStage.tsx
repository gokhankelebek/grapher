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
import { toMath, toScreen } from '../core/types'
import type { Theme } from '../core/types'
import { processStroke } from '../core/stroke'
import { recognize } from '../core/fit/recognize'
import {
  getHandles,
  applyHandleDrag,
  dragCurvePoint,
  oversketch,
  nearestOnCurve,
} from '../core/fit/edit'
import { HANDLE_HIT_RADIUS, renderBoard } from './renderBoard'
import { sampleCurveScreen, distToPolyline } from './sample'
import { formatCoord } from './numeric'
import { axesPhrase, axisKeys, featureAxes } from './featureEdit'
import type { FeatureAxes } from './featureEdit'
import { HandleInput } from './HandleInput'
import type { HandleField } from './HandleInput'
import type { Mode, StyleMap } from '../App'

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
  /** Index into `analysis` to emphasise (hovered in the card readout). */
  analysisHighlight: number | null
  /**
   * State an exact position for one special point (double-clicked marker).
   * False means it was refused — the popover stays open, and the board is
   * already showing the solver's reason.
   */
  onFeatureEdit(curveId: string, point: SpecialPoint, to: { x?: number; y?: number }): boolean
}

const MIN_PPU = 0.001
const MAX_PPU = 100000
const FADE_MS = 250
const HIT_RADIUS = 8
/**
 * Strictly smaller than HANDLE_HIT_RADIUS, and only ever consulted after
 * handleAt() has already missed: an edit handle keeps first refusal on the
 * pointer everywhere the two vocabularies meet.
 */
const MARKER_HIT_RADIUS = 9
const OVERSKETCH_RADIUS = 12
/** dragPoint → ink conversion threshold (stroke ran away from the curve). */
const ESCAPE_PX = 28
/** Pointer entries older than this are considered stale/phantom. */
const POINTER_STALE_MS = 3000

const noop = (): void => {}

// ---------------------------------------------------------------------------
// Gesture policy — pure, and exported so it can be read and tested without a
// DOM.
//
// Everything here decides WHAT A CONTACT MEANS before any state is touched.
// That separation is the fix for the worst bug the stage had: any second
// pointer was promoted to a pinch, so a palm landing mid-stroke destroyed the
// stroke — no curve, no toast, nothing to undo.
// ---------------------------------------------------------------------------

export type PointerKind = 'pen' | 'touch' | 'mouse'

/** Which way the stroke in progress will be read near the selected curve. */
export type DrawIntent = 'reshape' | 'new'

/** A touch is distrusted this long after the pen was last seen. */
export const PEN_GUARD_MS = 2000
/** Travel a finger must cover before it pans — a resting palm never nudges. */
export const TOUCH_PAN_SLOP = 6
/** How far a stroke may sit from a curve and still count as drawn "on" it. */
export const NEIGHBOURHOOD_PX = 60

export const pointerKind = (t: string | undefined | null): PointerKind =>
  t === 'pen' || t === 'touch' ? t : 'mouse'

export type PointerVerdict =
  /** Ink — or, first, a handle/curve drag: the caller refines this one. */
  | 'ink'
  /** Held pan: space, middle/right button, or a single finger. */
  | 'pan'
  /** Second finger: pinch-zoom. */
  | 'pinch'
  /** Palm rejection — this contact does not exist as far as the board cares. */
  | 'ignore'
  /** Pen/mouse over a touch gesture: drop the touch, the pen wins. */
  | 'preempt'

/**
 * The single place a contact becomes an intention.
 *
 * `contacts` counts the pointers already down, NOT including this one.
 */
export function classifyPointerDown(i: {
  kind: PointerKind
  button: number
  spaceHeld: boolean
  /** Pointer kind owning the gesture in progress; null when idle. */
  activeKind: PointerKind | null
  contacts: number
}): PointerVerdict {
  // Palm rejection: a finger arriving while the pen is working is not a pinch,
  // not a pan, and above all not a reason to throw the stroke away.
  if (i.kind === 'touch' && i.activeKind === 'pen') return 'ignore'
  // The pen outranks a palm that happened to get there first.
  if (i.kind !== 'touch' && i.activeKind === 'touch') return 'preempt'
  if (i.button !== 0) return 'pan'
  if (i.spaceHeld) return 'pan'
  // A finger never inks: it pans alone and pinches in pairs. Ink is the pen's
  // and the mouse's, which is what makes two-finger pinch flash-free.
  if (i.kind === 'touch') return i.contacts >= 1 ? 'pinch' : 'pan'
  // A second pen/mouse contact is a phantom, never a pinch.
  if (i.contacts >= 1) return 'ignore'
  return 'ink'
}

/** True while the pen was seen recently enough to distrust a bare touch. */
export const penGuardActive = (lastPenAt: number, now: number): boolean =>
  now - lastPenAt < PEN_GUARD_MS

/**
 * A plain (or two-axis) wheel is a SCROLL, and must pan. Only a pinch — which
 * browsers deliver as a ctrlKey wheel — or an explicit modifier zooms.
 */
export const classifyWheel = (e: { ctrlKey: boolean; metaKey: boolean }): 'zoom' | 'pan' =>
  e.ctrlKey || e.metaKey ? 'zoom' : 'pan'

/** Wheel deltas in CSS px, whichever unit the event chose to speak in. */
export function wheelPanDelta(
  e: { deltaX: number; deltaY: number; deltaMode?: number },
  pageH: number,
): { dx: number; dy: number } {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? Math.max(1, pageH) : 1
  const fin = (v: number): number => (Number.isFinite(v) ? v : 0)
  return { dx: fin(e.deltaX) * unit, dy: fin(e.deltaY) * unit }
}

/**
 * Did the stroke spend most of itself away from the curve it started on? Then
 * it is a new object drawn NEXT TO that curve — a tangent, an asymptote, a
 * translated copy — and blending it in would rewrite the wrong thing.
 */
export const strokeLeftBand = (inside: number, total: number): boolean =>
  total > 0 && inside * 2 < total

/** Hit radii grow for fingers. The DRAWN sizes are renderBoard's and do not. */
export const hitRadii = (coarse: boolean): { handle: number; marker: number; body: number } =>
  coarse
    ? { handle: 18, marker: 16, body: 14 }
    : { handle: HANDLE_HIT_RADIUS, marker: MARKER_HIT_RADIUS, body: HIT_RADIUS }

/**
 * Tooltips go ABOVE-LEFT of the pointer: down-right is precisely where a
 * right-handed hand and the barrel of the pen already are. Flips at the edges
 * of the stage so it can never be pushed out of the frame.
 */
export function tipPlacement(
  x: number,
  y: number,
): { left: number; top: number; transform: string } {
  const flipX = x < 150
  const flipY = y < 44
  return {
    left: flipX ? x + 14 : x - 12,
    top: flipY ? y + 16 : y - 12,
    transform: `translate(${flipX ? '0' : '-100%'}, ${flipY ? '0' : '-100%'})`,
  }
}

type Gesture =
  | { type: 'draw'; pointerId: number; kind: PointerKind }
  | { type: 'pan'; pointerId: number; kind: PointerKind; lastX: number; lastY: number; moved: number }
  | {
      type: 'dragHandle'
      pointerId: number
      curveId: string
      handleId: string
      label?: string
      moved: number
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
      startMathMid: Vec2
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

const clampPpu = (v: number): number => Math.min(MAX_PPU, Math.max(MIN_PPU, v))

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
// suppressed wherever a handle sits within HANDLE_HIT_RADIUS (a parabola's
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
    onFeatureEdit,
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

  const pointersRef = useRef<Map<number, PointerEntry>>(new Map())
  const gestureRef = useRef<Gesture | null>(null)
  const inkRef = useRef<Vec2[]>([])
  const fadeRef = useRef<Fade | null>(null)
  const spaceRef = useRef(false)
  const hoverRef = useRef<HoverInfo | null>(null)
  const viewportChangeRef = useRef(onViewportChange)
  viewportChangeRef.current = onViewportChange
  const analysisRef = useRef<SpecialPoint[]>(analysis)
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
  const hitRef = useRef(hitRadii(false))
  const intentRef = useRef<DrawIntent | null>(null)

  const rafRef = useRef(0)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [panning, setPanning] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const [draggingCurve, setDraggingCurve] = useState(false)
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
    if (sel && !busy) {
      try {
        handles = getHandles(sel, modelsRef.current)
      } catch {
        /* no handles */
      }
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
      curves: curvesRef.current,
      styles: stylesRef.current,
      models: modelsRef.current,
      analysis:
        sel && !busy && analysisRef.current.length > 0
          ? { curve: sel, points: analysisRef.current }
          : null,
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
          inkRef.current.length > 1
            ? {
                pts: inkRef.current,
                // Oversketch ink borrows the target curve's color.
                color: overTarget ? overTarget.color : inkColorRef.current,
              }
            : null,
        curveAlpha: fade ? { id: fade.curveId, alpha: fadeT } : null,
      },
    })
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
    analysisRef.current = analysis
    highlightRef.current = analysisHighlight
    scheduleRender()
  }, [
    curves,
    styles,
    models,
    theme,
    selectedId,
    mode,
    inkColor,
    analysis,
    analysisHighlight,
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
      hitRef.current = hitRadii(mq.matches)
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
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const vp = vpRef.current
      const rect = canvas.getBoundingClientRect()
      const pos = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      if (classifyWheel(e) === 'pan') {
        // A two-finger scroll is a SCROLL. Treating it as zoom meant a Mac
        // trackpad rescaled the whole board while the teacher thought they
        // were moving along the x-axis — and rescaling is not undoable.
        const { dx, dy } = wheelPanDelta(e, vp.heightPx)
        vp.center = {
          x: vp.center.x + dx / vp.pxPerUnit,
          y: vp.center.y - dy / vp.pxPerUnit,
        }
      } else {
        // Zoom: trackpad pinch (which browsers deliver as a ctrlKey wheel) and
        // the explicit modifier. Still anchored on the cursor.
        const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0018))
        const anchor = toMath(pos, vp)
        vp.pxPerUnit = clampPpu(vp.pxPerUnit * factor)
        vp.center = {
          x: anchor.x - (pos.x - vp.widthPx / 2) / vp.pxPerUnit,
          y: anchor.y + (pos.y - vp.heightPx / 2) / vp.pxPerUnit,
        }
      }
      reanchorEditor()
      viewportChangeRef.current?.()
      scheduleRender()
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [reanchorEditor, scheduleRender, vpRef])

  // ---------------------------------------------------------------- hit tests
  const trySelectAt = useCallback(
    (pos: Vec2, allowDeselect: boolean): void => {
      const vp = vpRef.current
      const list = curvesRef.current
      for (let i = list.length - 1; i >= 0; i--) {
        const curve = list[i]
        if (!curve.visible) continue
        const poly = sampleCurveScreen(curve, modelsRef.current, vp)
        if (poly.length > 1 && distToPolyline(pos, poly) <= hitRef.current.body) {
          onSelect(curve.id)
          return
        }
      }
      if (allowDeselect) onSelect(null)
    },
    [onSelect, vpRef],
  )

  const selectedVisible = useCallback((): FittedCurve | null => {
    const sel = curvesRef.current.find((c) => c.id === selectedRef.current)
    return sel && sel.visible ? sel : null
  }, [])

  /** Nearest handle of the selected curve within HANDLE_HIT_RADIUS (screen px). */
  const handleAt = useCallback(
    (pos: Vec2): CurveHandle | null => {
      const sel = selectedVisible()
      if (!sel) return null
      const vp = vpRef.current
      let hs: CurveHandle[] = []
      try {
        hs = getHandles(sel, modelsRef.current)
      } catch {
        return null
      }
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
   * Nearest editable analysis marker within MARKER_HIT_RADIUS.
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
      let best: { point: SpecialPoint; index: number } | null = null
      let bestD = hitRef.current.marker
      for (let i = 0; i < points.length; i++) {
        const p = points[i]
        if (!p || !p.pos || !Number.isFinite(p.pos.x) || !Number.isFinite(p.pos.y)) continue
        const sp = toScreen(p.pos, vp)
        const d = Math.hypot(sp.x - pos.x, sp.y - pos.y)
        if (d > bestD) continue
        const masked = handlePts.some(
          (hp) => Math.hypot(hp.x - sp.x, hp.y - sp.y) <= HANDLE_HIT_RADIUS,
        )
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
        extent = Math.max(maxX - minX, maxY - minY) * vp.pxPerUnit
      }
      // Extent-based tap test: even a 2-point flick spanning real distance is
      // intentional ink (recognize() handles sparse input; a flick fits a Line).
      if (pts.length < 2 || extent < 6) {
        // A tap is a tap whichever device made it: it selects what is under it
        // and clears the selection on empty board. Refusing to deselect here
        // meant the pen and the finger disagreed about the same gesture.
        if (tapPos) trySelectAt(tapPos, true)
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
      trySelectAt,
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
      // 1. Handle grab beats everything (any mode) when a curve is selected.
      //    Markers are only consulted where no handle answered.
      const h = handleAt(pos)
      const sel = selectedVisible()
      const marker = h ? null : markerAt(pos)

      // 1a. Double-click/tap a handle OR a marker: type exact values.
      const tapKey = h ? `h:${h.id}` : marker ? `m:${marker.index}` : null
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

      if (h && sel) {
        gestureRef.current = {
          type: 'dragHandle',
          pointerId: e.pointerId,
          curveId: sel.id,
          handleId: h.id,
          label: h.label,
          moved: 0,
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

      // 3. Ink. Within 12px of the selected curve the stroke aims at that
      //    curve — and the chip says which of the two things that means
      //    BEFORE a single point is drawn, rather than leaving the teacher to
      //    find out from what the board did afterwards.
      const over = near && near.distPx <= OVERSKETCH_RADIUS ? near.curve.id : null
      oversketchForRef.current = over
      bandRef.current = { inside: 0, total: 0 }
      if (sel) setIntent(over ? 'reshape' : 'new', pos)
      gestureRef.current = { type: 'draw', pointerId: e.pointerId, kind }
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
            tip: { x: sp.x, y: sp.y, label: h.label ?? h.id, hint: 'double-click to type' },
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
          setHover(
            near && near.distPx <= hitRef.current.body
              ? { handleId: null, markerIndex: null, cursor: 'move', tip: null }
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
            const r = nearestOnCurve(curve, modelsRef.current, mp)
            if (r && Number.isFinite(r.dist)) distPx = r.dist * vp.pxPerUnit
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
      vp.center = { x: vp.center.x - dx / vp.pxPerUnit, y: vp.center.y + dy / vp.pxPerUnit }
      reanchorEditor()
      viewportChangeRef.current?.()
      scheduleRender()
    } else if (g.type === 'dragHandle' && g.pointerId === e.pointerId) {
      g.moved += 1
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
              const r = nearestOnCurve(probe, modelsRef.current, target)
              if (r && Number.isFinite(r.dist)) distPx = r.dist * vp.pxPerUnit
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
      const ppu = clampPpu((g.startPpu * dist) / g.startDist)
      vp.pxPerUnit = ppu
      vp.center = {
        x: g.startMathMid.x - (mid.x - vp.widthPx / 2) / ppu,
        y: g.startMathMid.y + (mid.y - vp.heightPx / 2) / ppu,
      }
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
      } else {
        onCurveEditEnd(g.curveId, e.altKey)
      }
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
        if (!palm) trySelectAt(pos, true)
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

// ============================================================================
// src/app/useViewport.ts — the view: zoom, framing, the window panel and fit-to-content.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SolveResult } from '../core/solveInequality'
import { nextId, ppuX } from '../core/types'
import { curveBounds, unionBoxes } from '../ui/curveState'
import { dataBox } from '../ui/dataLinks'
import { eulerFramePoints } from '../ui/eulerLinks'
import { fitRange, graphSources, solveCached, solveXs } from '../ui/nlSolve'
import { relatedRatesBox } from '../ui/relatedRatesLinks'
import { sequenceBox } from '../ui/seqLinks'
import { unitCircleBox } from '../ui/unitCircleLinks'
import {
  applyWindow,
  axesModeOf,
  axesModeRefused,
  calcFramePoints,
  fitBox,
  fitData,
  INDEPENDENT_NEEDS_SQUARE,
  makeIndependent,
  readWindow,
  squareAxes,
  squareToContain,
  withPoints,
  zoomAbout,
} from '../ui/viewScale'
import type { AxesMode, Box, ViewWindow } from '../ui/viewScale'
import type { ViewSettings } from '../ui/WindowPanel'
import type { BoardStateApi } from './useBoardState'
import type { BoardRefsApi } from './useBoardRefs'
import type { ModelsApi } from './useModels'
import type { NoticesApi } from './useNotices'
import type { HistoryApi } from './useHistory'
import type { DocumentPersistenceApi } from './useDocumentPersistence'
import type { DocumentActionsApi } from './useDocumentActions'
import type { CalcLinksApi } from './useCalcLinks'
import type { FieldsApi } from './useFields'
import type { TypedLinesApi } from './useTypedLines'
import type { DataTablesApi } from './useDataTables'
import type { NumberLineApi } from './useNumberLine'
import { statsBox } from '../ui/statsLinks'

/** What useViewport reads from the hooks App calls before it. */
export interface ViewportDeps {
  board: BoardStateApi
  refs: BoardRefsApi
  derived: ModelsApi
  notices: NoticesApi
  history: HistoryApi
  persistence: DocumentPersistenceApi
  docActions: DocumentActionsApi
  calc: CalcLinksApi
  fieldsApi: FieldsApi
  typed: TypedLinesApi
  tables: DataTablesApi
  numberLine: NumberLineApi
}

export function useViewport({ board, refs, derived, notices, history, persistence, docActions, calc, fieldsApi, typed, tables, numberLine }: ViewportDeps) {
  const { setSelectedId, lens, lensRef, boardGrid, axesMode, setAxesMode, viewSubsRef } = board
  const {
    curvesRef, itemsRef, kindRef, exprSourcesRef, calcRef, dataRef, seqRef, ucRef, rrRef, statsRef,
    frameBoxRef, boardGridRef,
  } = refs
  const { modelsRef, vpRef, stageRef, nlStageRef, overlayRef } = derived
  const { showToast } = notices
  const { commitState } = history
  const { scheduleSave } = persistence
  const { setBoardKind } = docActions
  const { refreshCrossSpan, refreshImplicitBox } = calc
  const {
    refreshSolveSpan, refreshGhostFrame, refreshMotionFrame, eulerPathsRef, fieldPolylinesRef,
  } = fieldsApi
  const { addExpression } = typed
  const { seqCompiledRef, refreshPartnerSpan } = tables
  const { frameSolveRef } = numberLine

  // ---------------------------------------------------------------- viewport
  //
  // Every change to the view goes through ui/viewScale.ts, which knows the one
  // rule that matters now that the axes may be scaled apart: a zoom scales both
  // axes by the same factor, a stretch scales one, and pxPerUnitY present is
  // what "Independent" means. None of it is in the undo history — the view is
  // where the teacher is looking, not a thing on the board — and a window
  // change or an Axes switch is no exception.

  /** Pan/zoom happened: the marker layer rides the same viewport. */
  /**
   * Where the horizontal line test's drag handle sits: just inside the left
   * edge of the window. Refreshed on a pan or zoom only while a line is shown,
   * and only once the edge has moved by a few pixels.
   */
  const [hltEdgeX, setHltEdgeX] = useState(0)
  const hltEdgeRef = useRef(hltEdgeX)
  hltEdgeRef.current = hltEdgeX
  const refreshHltEdge = useCallback((force = false): void => {
    if (!force && !Object.values(lensRef.current).some((l) => l.hlt !== undefined)) return
    const vp = vpRef.current
    const px = ppuX(vp)
    if (!(px > 0)) return
    const edge = vp.center.x - vp.widthPx / 2 / px + 26 / px
    if (Math.abs(edge - hltEdgeRef.current) * px < 3) return
    hltEdgeRef.current = edge
    setHltEdgeX(edge)
  }, [])
  useEffect(() => {
    refreshHltEdge(true)
  }, [lens, refreshHltEdge])

  /**
   * Everything that rides the view, redrawn or re-ranged — without saving: the
   * stage calls this alone when it changes SIZE (sidebar, rotation, present),
   * which moves no centre and no scale.
   */
  const viewRefresh = useCallback((): void => {
    overlayRef.current?.redraw()
    refreshHltEdge()
    // Where the curves cross is hunted over the window, so panning can bring a
    // crossing into view that was never solved for. Hot path: this is a pair
    // of comparisons unless the board has left the coarse span entirely.
    refreshCrossSpan()
    // And where an implicit curve's horizontal / vertical tangents are sought.
    refreshImplicitBox()
    // A solution curve is integrated across a fixed x-range, so a board panned
    // or zoomed past that range would show it stopping in mid-air. This is the
    // hot path — it fires on every frame of a pan — and refreshSolveSpan does
    // nothing at all unless the window has genuinely left the solved span.
    refreshSolveSpan()
    // The same for a sequence's dashed continuous partner.
    refreshPartnerSpan()
    // The same for a selected transformation's ghost and arrowheads.
    refreshGhostFrame()
    // And for a selected parametric / polar curve's vectors and arrowheads.
    refreshMotionFrame()
    // A stretch gesture on the stage turns Independent on by itself; the
    // settings panel's segment has to follow. Same value = no render.
    setAxesMode(axesModeOf(vpRef.current))
    viewSubsRef.current.forEach((fn) => fn())
  }, [refreshCrossSpan, refreshImplicitBox, refreshSolveSpan, refreshPartnerSpan, refreshGhostFrame, refreshMotionFrame, refreshHltEdge])

  const viewportChanged = useCallback((): void => {
    viewRefresh()
    scheduleSave()
  }, [viewRefresh, scheduleSave])

  /** The view was changed from outside the stage: redraw everything that rides it. */
  const viewMoved = useCallback((): void => {
    stageRef.current?.redraw()
    nlStageRef.current?.redraw()
    viewportChanged()
  }, [viewportChanged])

  /** The WINDOW panel's subscription to view changes. */
  const subscribeView = useCallback((fn: () => void): (() => void) => {
    viewSubsRef.current.add(fn)
    return () => {
      viewSubsRef.current.delete(fn)
    }
  }, [])

  const zoomBy = useCallback(
    (factor: number): void => {
      const vp = vpRef.current
      // Both axes, by the same factor, about the centre: the ratio between a
      // stretched board's axes survives the zoom buttons.
      zoomAbout(vp, { x: vp.widthPx / 2, y: vp.heightPx / 2 }, factor)
      viewMoved()
    },
    [viewMoved],
  )

  const resetView = useCallback((): void => {
    const vp = vpRef.current
    vp.center = { x: 0, y: 0 }
    vp.pxPerUnit = 60
    // Home is square, but the teacher's Axes choice is theirs: Independent
    // stays on (at an equal scale) until they choose Equal.
    if (vp.pxPerUnitY !== undefined) vp.pxPerUnitY = 60
    viewMoved()
  }, [viewMoved])

  /** Only equal axes can carry the polar ruling (circles must be circles). */
  const keepSquare = useCallback((): boolean => boardGridRef.current === 'polar', [])

  /**
   * Point the board at `box`, with the fit margin all round — per axis when
   * the axes are Independent, square when they are Equal. "Fit to curves"
   * never turns Independent on by itself.
   */
  const frameBox = useCallback(
    (box: Box): void => {
      const vp = vpRef.current
      const nl = kindRef.current === 'number-line'
      fitBox(vp, box, {
        independent: !nl && !keepSquare() && vp.pxPerUnitY !== undefined,
        centreY0: nl,
      })
      viewMoved()
    },
    [keepSquare, viewMoved],
  )

  /**
   * Frame a data table's points. Unlike "Fit to curves", this one may turn
   * Independent on by itself: data that is lopsided against the board (years
   * along x, millions up y) is unreadable on equal axes, and the teacher asked
   * for it to be made readable — out loud, with the way back named.
   */
  const frameData = useCallback(
    (box: Box): void => {
      const vp = vpRef.current
      const { madeIndependent } = fitData(vp, box, { keepSquare: keepSquare() })
      viewMoved()
      if (madeIndependent) {
        showToast('Axes scaled independently to fit the data — Settings → Axes: Equal to undo', {
          ms: 7000,
          action: {
            label: 'Keep axes equal',
            run: () => {
              fitBox(vpRef.current, box, { independent: false })
              viewMoved()
            },
          },
        })
      }
    },
    [keepSquare, showToast, viewMoved],
  )

  /**
   * Settings → Axes. Equal re-squares about the centre keeping the x scale;
   * Independent keeps whatever the view is and lets gestures stretch it. The
   * polar ruling is only meaningful on equal axes, so Independent is refused
   * there (the control is disabled with the reason; this is the backstop).
   */
  const chooseAxesMode = useCallback(
    (next: AxesMode): void => {
      const vp = vpRef.current
      if (next === axesModeOf(vp)) return
      if (next === 'independent') {
        if (axesModeRefused(next, boardGridRef.current)) {
          showToast(INDEPENDENT_NEEDS_SQUARE, { ms: 4000 })
          return
        }
        makeIndependent(vp)
      } else {
        squareAxes(vp)
      }
      viewMoved()
    },
    [keepSquare, showToast, viewMoved],
  )

  /**
   * The WINDOW panel's Apply. Returns an error to show beside the fields, or
   * null once the view is set — and says so when the window needed the axes
   * to become Independent (or, on a polar board, could not have them).
   */
  const applyViewWindow = useCallback(
    (w: ViewWindow): string | null => {
      const vp = vpRef.current
      const probe = { ...vp, center: { ...vp.center } }
      const res = applyWindow(probe, w, { keepSquare: keepSquare() })
      if (!res.ok) return res.error
      vp.center = probe.center
      vp.pxPerUnit = probe.pxPerUnit
      if (probe.pxPerUnitY !== undefined) vp.pxPerUnitY = probe.pxPerUnitY
      else delete vp.pxPerUnitY
      viewMoved()
      if (res.madeIndependent) {
        showToast('Axes scaled independently to show this window — Settings → Axes: Equal to undo', {
          ms: 5000,
        })
      } else if (res.contained) {
        showToast('The polar ruling keeps the axes equal, so the window was fitted inside a square view.', {
          ms: 5000,
        })
      }
      return null
    },
    [keepSquare, showToast, viewMoved],
  )

  /** WINDOW → Square it: equal axes, same centre, the whole window still in view. */
  const squareView = useCallback((): void => {
    squareToContain(vpRef.current)
    viewMoved()
  }, [viewMoved])

  const readViewWindow = useCallback((): ViewWindow => readWindow(vpRef.current), [])

  /** Everything the settings panel's Axes and WINDOW controls need. */
  const viewSettings = useMemo<ViewSettings>(
    () => ({
      mode: axesMode,
      polar: boardGrid === 'polar',
      onMode: chooseAxesMode,
      read: readViewWindow,
      subscribe: subscribeView,
      onApply: applyViewWindow,
      onSquare: squareView,
    }),
    [axesMode, boardGrid, chooseAxesMode, readViewWindow, subscribeView, applyViewWindow, squareView],
  )

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
        else if (it.kind === 'solve') {
          const r = solveCached(it.src)
          const span = r.ok ? fitRange(solveXs(r)) : null
          if (span) xs.push(span.min, span.max)
        } else {
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
      // And a data table's points: a scatter plot with no fit yet is still
      // the figure.
      for (const d of dataRef.current) {
        if (!d.visible) continue
        const b = dataBox(d)
        if (b) boxes.push(b)
      }
      // And a sequence's dots (and rings): a board of sequences is a board of
      // points with nothing else on it.
      for (const q of seqRef.current) {
        if (!q.visible) continue
        const c = seqCompiledRef.current.get(q.id)
        const b = c ? sequenceBox(q, c) : null
        if (b) boxes.push(b)
      }
      // And a unit circle, with its unwrapped graph when it has one.
      for (const u of ucRef.current) if (u.hidden !== true) boxes.push(unitCircleBox(u))
      // And the related-rates picture, with its graph.
      for (const r of rrRef.current) if (r.hidden !== true) boxes.push(relatedRatesBox(r))
      // And each statistics panel, at its place in the stack.
      statsRef.current.forEach((st, i) => {
        if (st.hidden !== true) boxes.push(statsBox(i))
      })
      // And what the lesson is ABOUT, where the curves' extent in this window
      // may not reach: the step points of every Euler path, and the key
      // points of secant, Taylor and limit overlays. None of them: the same
      // box as before.
      let keyPts = eulerFramePoints(eulerPathsRef.current)
      try {
        keyPts = keyPts.concat(calcFramePoints(calcRef.current, curvesRef.current, modelsRef.current))
      } catch {
        /* the key points are extra; the curves still frame */
      }
      box = withPoints(unionBoxes(boxes), keyPts)
    }
    if (!box) {
      showToast('Nothing visible to frame.', { ms: 2000 })
      return
    }
    frameBox(box)
  }, [frameBox, showToast])

  frameBoxRef.current = frameData

  // A newly solved line is framed: its critical values, with margin.
  frameSolveRef.current = (r: SolveResult): void => {
    const span = fitRange(solveXs(r))
    if (!span || kindRef.current !== 'number-line') return
    frameBox({ min: { x: span.min, y: -0.5 }, max: { x: span.max, y: 0.5 } })
  }

  /**
   * "Show on graph": the inequality's picture on the Graph board of the same
   * document. For L R R the method's own h = L − R is graphed (just L when R
   * is 0) with a sign chart of h: the solution is where the graph is above or
   * below the x-axis, and the chart's strip under the graph is exactly the
   * solution intervals marked along the x-axis. A chain a < E < b graphs E and
   * the two levels. The board switches to Graph (one click on Number line
   * switches back — nothing is lost either way); a curve already there is
   * not added twice.
   */
  const graphSolve = useCallback(
    (id: string): string | null => {
      const it = itemsRef.current.find((i) => i.id === id)
      if (!it || it.kind !== 'solve') return null
      const wanted = graphSources(it.src)
      if (!wanted) return 'There is no curve to graph for this line'
      setBoardKind('cartesian')
      const errors: string[] = []
      const graphed: string[] = []
      for (const g of wanted) {
        const existing = Object.entries(exprSourcesRef.current).find(([, src]) => src.trim() === g.src)
        let curveId = existing ? existing[0] : null
        if (!curveId) {
          const before = new Set(curvesRef.current.map((c) => c.id))
          const err = addExpression(g.src)
          if (err) {
            errors.push(err)
            continue
          }
          curveId = curvesRef.current.find((c) => !before.has(c.id))?.id ?? null
        }
        if (!curveId) continue
        graphed.push(g.src)
        if (g.signChart && !calcRef.current.some((l) => l.kind === 'signchart' && l.parentId === curveId)) {
          commitState(
            {
              calc: [
                ...calcRef.current,
                { kind: 'signchart', id: nextId(), parentId: curveId, rows: ['f'], guides: true },
              ],
            },
            'add sign chart',
          )
        }
        setSelectedId(curveId)
      }
      if (graphed.length === 0) {
        setBoardKind('number-line')
        return errors[0] ?? 'Those curves could not be graphed'
      }
      fitToContent()
      showToast(
        `Graphed ${graphed.join(', ')}${wanted.some((g) => g.signChart) ? ' with its sign chart: the solution is where the graph is above / below the x-axis' : ''}. Number line switches back.`,
        { ms: 6000 },
      )
      return null
    },
    [addExpression, commitState, fitToContent, setBoardKind, showToast],
  )

  /** "Zoom to data" on a table's menu: frame its points, nothing else. */
  const zoomToData = useCallback(
    (id: string): void => {
      const d = dataRef.current.find((t) => t.id === id)
      const box = d ? dataBox(d) : null
      if (!box) {
        showToast('This table has no points to frame yet.', { ms: 2000 })
        return
      }
      frameData(box)
    },
    [frameData, showToast],
  )

  /**
   * "Zoom to terms" on a sequence's menu: frame its dots (and its partial
   * sums when shown). Like a table, this may turn Independent axes on by
   * itself — 2, 6, 18, 54 against n = 1…4 is unreadable on equal axes — and
   * says so, with the way back.
   */
  const zoomToSequence = useCallback(
    (id: string): void => {
      const q = seqRef.current.find((s) => s.id === id)
      const c = q ? seqCompiledRef.current.get(id) : undefined
      const box = q && c ? sequenceBox(q, c) : null
      if (!box) {
        showToast('This sequence has no terms to frame.', { ms: 2000 })
        return
      }
      frameData(box)
    },
    [frameData, showToast],
  )

  return {
    hltEdgeX, viewRefresh, viewportChanged, viewMoved, zoomBy, resetView, frameBox, viewSettings,
    fitToContent, graphSolve, zoomToData, zoomToSequence,
  }
}

export type ViewportApi = ReturnType<typeof useViewport>

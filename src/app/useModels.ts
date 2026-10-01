// ============================================================================
// src/app/useModels.ts — models, name resolution and the curve analysis.
//
// The model registry, f(x) by name, the dependency keys, the selected curve's
// special points (gesture-throttled) and the other curves', axis units, and
// the viewport and stage refs.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback, useMemo, useRef } from 'react'
import { analyzeCurve } from '../core/analyze'
import { MODELS } from '../core/fit/models'
import type { FunctionEnv } from '../core/functionEnv'
import { resolveAxisUnits } from '../core/persist'
import type { InverseLink, ResolvedAxisUnits } from '../core/persist'
import type { FittedCurve, ModelSpec, SpecialPoint, Viewport } from '../core/types'
import type { AnalysisOverlayHandle } from '../ui/AnalysisOverlay'
import type { CanvasStageHandle } from '../ui/CanvasStage'
import { ANALYSIS_THROTTLE, GestureThrottle, timed, useGestureKey } from '../ui/gestureThrottle'
import {
  createResolver,
  createSingularityResolver,
  dependencyKeys,
  inverseSpec,
  lineEnv,
} from '../ui/nameLinks'
import type { InverseInfo } from '../ui/nameLinks'
import type { NumberLineStageHandle } from '../ui/NumberLineStage'
import { suggestAxisUnits } from '../ui/renderBoard'
import type { AxisUnits } from '../ui/renderBoard'
import { curveSpecSerial, curveValueKey, sameRecordOr } from '../ui/valueKeys'
import type { BoardStateApi } from './useBoardState'
import type { DocumentStateApi } from './useDocumentState'
import type { SessionStateApi } from './useSessionState'
import type { BoardRefsApi } from './useBoardRefs'

/** What useModels reads from the hooks App calls before it. */
export interface ModelsDeps {
  board: BoardStateApi
  docState: DocumentStateApi
  session: SessionStateApi
  refs: BoardRefsApi
}

export function useModels({ board, docState, session, refs }: ModelsDeps) {
  const { curves, kind, selectedId, extraModels, setExtraModels, calcLinks, unitCircles } = board
  const { exprSources, edits, names, calls } = docState
  const { markersOn, axisUnitChoice } = session
  const { curvesRef, selectedRef, gesturing, namesRef, callsRef } = refs

  const models = useMemo<Record<string, ModelSpec>>(
    () => ({ ...MODELS, ...extraModels }),
    [extraModels],
  )
  const modelsRef = useRef(models)
  modelsRef.current = models
  selectedRef.current = selectedId

  /**
   * Register model closures NOW as well as in state: a name handed out in the
   * same breath (a new line's sliders are reserved from the auto letters) and
   * the resolver both read modelsRef before React has re-rendered.
   */
  const registerModels = useCallback((map: Record<string, ModelSpec>): void => {
    if (Object.keys(map).length === 0) return
    modelsRef.current = { ...modelsRef.current, ...map }
    setExtraModels((prev) => ({ ...prev, ...map }))
  }, [])

  /**
   * f(x) for the curve NAMED f, read off the live board at every call — the
   * one thing every typed line that calls another curve evaluates through
   * (src/ui/nameLinks.ts). Nothing is snapshotted, so dragging f's slider
   * moves g on the very next frame, and a deleted f is NaN until it returns.
   */
  const resolveName = useMemo(
    () =>
      createResolver(() => ({
        curves: curvesRef.current,
        names: namesRef.current,
        models: modelsRef.current,
      })),
    [],
  )
  /**
   * Where the curve NAMED f is undefined — its poles, holes and exclusions —
   * read off the live board (FunctionEnv.singularities). What lets
   * g(x) = 2f(x − 1) + 3 with f = 1/x find its own asymptote at x = 1.
   */
  const singularOf = useMemo(
    () =>
      createSingularityResolver(() => ({
        curves: curvesRef.current,
        names: namesRef.current,
        models: modelsRef.current,
        calls: callsRef.current,
      })),
    [],
  )
  /** The env one typed line is parsed against: its calls, plus its own head. */
  const envFor = useCallback(
    (lineCalls: readonly string[], head: string | null): FunctionEnv | undefined =>
      lineCalls.length > 0 || head ? lineEnv(resolveName, lineCalls, head, singularOf) : undefined,
    [resolveName, singularOf],
  )
  /** linkId -> the inverse relation's facts (sentence, t-range, latex), kept current below. */
  const inverseInfoRef = useRef<Record<string, InverseInfo>>({})
  /** An inverse curve's model: (f(t), t), reading its parent live. */
  const makeInverseSpec = useCallback(
    (modelId: string, link: InverseLink): ModelSpec =>
      inverseSpec(
        modelId,
        link.parentId,
        () => ({ curves: curvesRef.current, models: modelsRef.current }),
        () => inverseInfoRef.current[link.id]?.latex ?? 'x = f\\left(y\\right)',
      ),
    [],
  )

  const selectedCurve = useMemo(
    () => curves.find((c) => c.id === selectedId) ?? null,
    [curves, selectedId],
  )

  /**
   * curveId -> the state of every curve a typed line reaches through its
   * calls (src/ui/nameLinks.ts). g's own params do not move when f's slider
   * does — g does — so every memo that caches a curve by its params appends
   * this.
   */
  const depKeysPrevRef = useRef<Record<string, string> | null>(null)
  const depKeys = useMemo(() => {
    // A called curve's formula identity is part of its callers' keys, so no
    // value-keyed cache has to be keyed on the whole `models` map (see
    // src/ui/valueKeys.ts).
    const keys = dependencyKeys(curves, names, calls, (c) => curveSpecSerial(c, models))
    // A curve a link DRIVES has no params of its own to change: a Taylor
    // polynomial's shape is its link's a and n, an accumulation function's
    // its a and C. Every value-keyed cache (analysis, crossings) reads
    // depKeys, so the link's numbers go in here — or P₃'s zeros stay on the
    // board after n is stepped to 10.
    for (const l of calcLinks) {
      if (l.kind !== 'taylor' && l.kind !== 'accumulation' && l.kind !== 'tangent') continue
      const sig =
        l.kind === 'taylor' ? `T${l.a},${l.n}`
        : l.kind === 'accumulation' ? `A${l.a},${l.C}`
        : `L${l.x}`
      keys[l.curveId] = keys[l.curveId] ? `${keys[l.curveId]};${sig}` : sig
    }
    // Same entries, same object: `models` is a dependency only for the spec
    // identities, and a re-registered model nobody calls changes nothing here.
    const out = sameRecordOr(depKeysPrevRef.current, keys)
    depKeysPrevRef.current = out
    return out
  }, [curves, names, calls, calcLinks, models])
  const depKeysRef = useRef(depKeys)
  depKeysRef.current = depKeys

  // Value-based key: re-analyze only when the curve's shape actually changes,
  // so unrelated re-renders (hover, save state, toasts) never pay the cost.
  // The model's IDENTITY is in the key (curveValueKey), not the `models` map:
  // that map is rebuilt whenever any model is re-registered — a Taylor
  // polynomial's on every frame its parent's slider moves.
  const analysisKey = selectedCurve
    ? curveValueKey(selectedCurve, models, depKeys[selectedCurve.id])
    : ''
  // While a slider or a handle is being dragged the analysis runs at most as
  // often as its own cost allows, and exactly once more on release (see
  // src/ui/gestureThrottle.ts). The ref keeps it per-board, not per-render.
  const analysisThrottle = useRef(new GestureThrottle(ANALYSIS_THROTTLE)).current
  const analysisKeyNow = useGestureKey(analysisKey, gesturing, analysisThrottle)

  const analysisRef = useRef<SpecialPoint[]>([])

  const analysis = useMemo<SpecialPoint[]>(() => {
    if (!selectedCurve) return []
    return timed(analysisThrottle, () => {
      try {
        const pts = analyzeCurve(selectedCurve, models)
        return Array.isArray(pts) ? pts : []
      } catch {
        // An un-analyzable family must never take the board down.
        return []
      }
    })
    // selectedCurve and models are intentionally tracked through the key, not
    // identity: the key carries the curve's values and its own model's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisKeyNow])
  analysisRef.current = analysis

  // ------------------------------------------- analysis for the OTHER curves
  //
  // Markers used to exist only for the selected curve, so switching Analysis on
  // and then deselecting left a lit button over an empty board. The toggle now
  // means every visible curve, and the cost is kept off the hot path by a memo
  // per curve keyed on the only three things that can move a special point.
  //
  // The cache is NOT emptied when `models` changes: each entry's key carries
  // its own curve's model identity (curveValueKey), so a re-registered Taylor
  // model re-analyses the Taylor polynomial and nothing else. Emptying it used
  // to re-analyse every curve on the board on every frame of a slider drag.
  const analysisCacheRef = useRef(new Map<string, SpecialPoint[]>())
  const analysisModelsRef = useRef(models)
  analysisModelsRef.current = models

  const analysisFor = useCallback((curve: FittedCurve): SpecialPoint[] => {
    const key = curveValueKey(curve, analysisModelsRef.current, depKeysRef.current[curve.id])
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
    if (!markersOn || kind !== 'cartesian') return []
    return curves
      .filter((c) => c.visible && c.id !== selectedId)
      .map((curve) => ({ curve, points: analysisFor(curve) }))
      .filter((m) => m.points.length > 0)
    // depKeys and models: a linked curve (Taylor Pₙ) changes shape with no
    // change to `curves` at all — its link moves first (depKeys) and its model
    // is registered a render later (models, which also empties the cache).
    // analysisFor reads both through refs, so they are named here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markersOn, kind, curves, selectedId, analysisFor, depKeys, models])

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
    () =>
      kind !== 'cartesian'
        ? {}
        : // A unit circle's angle is measured in π, and its unwrapped graph is
          // read off a π axis: sin x crosses at π, peaks at π/2.
          unitCircles.some((u) => u.hidden !== true)
          ? { x: 'pi' as const }
          : suggestAxisUnits(curves, exprSources),
    [kind, curves, exprSources, unitCircles],
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

  return {
    models, modelsRef, registerModels, resolveName, singularOf, envFor, inverseInfoRef,
    makeInverseSpec, selectedCurve, depKeys, depKeysRef, analysisRef, analysis, analysisFor,
    editedIds, contextAnalysis, suggestedXRef, axisUnits, axisUnitsRef, vpRef, stageRef, nlStageRef,
    overlayRef,
  }
}

export type ModelsApi = ReturnType<typeof useModels>

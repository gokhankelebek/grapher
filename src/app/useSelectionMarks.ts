// ============================================================================
// src/app/useSelectionMarks.ts — a selected curve's marks, and the screen scene's polylines and shapes.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { ConicSpec } from '../core/conics'
import type { LogisticSpec } from '../core/logistic'
import type { SinSpec } from '../core/sinusoidal'
import type { TransformSpec } from '../core/transform'
import type { SpecialPoint, Vec2 } from '../core/types'
import type { ExtraHandle } from '../ui/CanvasStage'
import {
  conicKeyMarks,
  constructionPolylines,
  constructionShapes,
  safeReadConic,
} from '../ui/conicLinks'
import { explicitF, probeX, reflectProbe } from '../ui/domainLinks'
import { safeReadExponential } from '../ui/expLinks'
import { safeReadFactored } from '../ui/factorLinks'
import {
  fittedLogistic,
  logisticAsymptotes,
  logisticDot,
  logisticMarks,
  safeReadLogistic,
  withLogisticMarks,
} from '../ui/logisticLinks'
import { safeReadLogarithmic } from '../ui/logLinks'
import {
  advanceT,
  clampT,
  defaultPlay,
  directionArrows,
  motionInterval,
  motionKindOf,
  motionMarks,
  motionScales,
  nearestT,
  particleShapes,
  poleRay,
  safeFeatures,
  safeState,
} from '../ui/motionLinks'
import type { MotionPlayState, MotionScales } from '../ui/motionLinks'
import type { Polyline, Shape } from '../ui/renderBoard'
import { midlinePolyline, safeReadSinusoid, sinKeyMarks, withKeyMarks } from '../ui/sinLinks'
import { snapCoord } from '../ui/snap'
import { playClock } from '../ui/motionPref'
import {
  ghostInk,
  keyPointArrows,
  parentGhost,
  safeReadTransform,
  transformKeyMarks,
  transformOpenByDefault,
} from '../ui/transformLinks'
import { EMPTY_ANALYSIS } from './constants'
import type { BoardStateApi } from './useBoardState'
import type { DocumentStateApi } from './useDocumentState'
import type { SessionStateApi } from './useSessionState'
import type { BoardRefsApi } from './useBoardRefs'
import type { ModelsApi } from './useModels'
import type { FieldsApi } from './useFields'
import type { ShapesApi } from './useShapes'
import type { DataTablesApi } from './useDataTables'
import type { BuildersApi } from './useBuilders'
import type { DomainLensApi } from './useDomainLens'
import type { ViewportApi } from './useViewport'
import type { UnitCircleApi } from './useUnitCircle'
import type { InequalitySystemApi } from './useInequalitySystem'
import type { ExtraHandlesApi } from './useExtraHandles'

/** What useSelectionMarks reads from the hooks App calls before it. */
export interface SelectionMarksDeps {
  board: BoardStateApi
  docState: DocumentStateApi
  session: SessionStateApi
  refs: BoardRefsApi
  derived: ModelsApi
  fieldsApi: FieldsApi
  shapesApi: ShapesApi
  tables: DataTablesApi
  builders: BuildersApi
  domain: DomainLensApi
  viewport: ViewportApi
  unitCircle: UnitCircleApi
  system: InequalitySystemApi
  handlesApi: ExtraHandlesApi
}

export function useSelectionMarks({ board, docState, session, refs, derived, fieldsApi, shapesApi, tables, builders, domain, viewport, unitCircle, system, handlesApi }: SelectionMarksDeps) {
  const {
    curves, kind, selectedId, construction, motionPlay, setMotionPlay, showParent, lens,
  } = board
  const { exprSources, calls, inverses } = docState
  const { markersOn, canvasTheme } = session
  const { curvesRef } = refs
  const { models, modelsRef, selectedCurve, depKeys, analysis, vpRef } = derived
  const {
    ghostFrame, ghostActiveRef, refreshGhostFrame, motionFrame, motionActiveRef, refreshMotionFrame,
    fieldPolylines,
  } = fieldsApi
  const { shapeScene } = shapesApi
  const { partnerLines } = tables
  const { patchMotion } = builders
  const { patchLensFor } = domain
  const { hltEdgeX } = viewport
  const { ucHandle } = unitCircle
  const { sysTestHandle } = system
  const { extraHandles } = handlesApi

  // ----------------------------------------------- a selected sinusoid, marked
  //
  // While a typed sinusoid is selected the board marks the five key points of
  // the cycle that starts at x = h — through the analysis path, so they are
  // the same rings and exact-text chips ("(π/4, 1)") as any special point —
  // and draws its midline y = k dashed. Screen only: neither is figure
  // content, and neither reaches an export.
  const selectedSin = useMemo<{ spec: SinSpec; color: string; id: string } | null>(() => {
    if (kind !== 'cartesian' || !selectedCurve) return null
    const c = selectedCurve
    if (!c.visible || c.kind !== 'explicit' || !c.modelId.startsWith('expr_')) return null
    if (calls[c.id]?.length) return null
    const src = exprSources[c.id]
    if (!src) return null
    // The same precedence as the card: a line the Roots, Exponential or
    // Logarithmic section speaks for is not read as a sinusoid.
    if (safeReadFactored(src) || safeReadExponential(src) || safeReadLogarithmic(src)) return null
    const spec = safeReadSinusoid(src)
    return spec ? { spec, color: c.color, id: c.id } : null
  }, [kind, selectedCurve, exprSources, calls])

  const sinMarks = useMemo<SpecialPoint[]>(
    () => (selectedSin ? sinKeyMarks(selectedSin.spec) : []),
    [selectedSin],
  )

  // ----------------------------------------------- a selected logistic, marked
  //
  // While a logistic is selected — typed, or a sketch that fitted the
  // library's logistic — the board draws both horizontal asymptotes dashed,
  // puts a labelled dot on the inflection point ("fastest growth"), and gives
  // the analysis its exact coordinates ("(20/3) ln 7"). Screen only: none of
  // it is figure content, none of it reaches an export.
  const selectedLogistic = useMemo<{ spec: LogisticSpec; color: string; id: string; typed: boolean } | null>(() => {
    if (kind !== 'cartesian' || !selectedCurve) return null
    const c = selectedCurve
    if (!c.visible || c.kind !== 'explicit') return null
    if (c.modelId === 'logistic') {
      const f = fittedLogistic(c.params)
      return f ? { spec: f.spec, color: c.color, id: c.id, typed: false } : null
    }
    if (!c.modelId.startsWith('expr_') || calls[c.id]?.length) return null
    const src = exprSources[c.id]
    if (!src) return null
    // The same precedence as the card.
    if (safeReadFactored(src) || safeReadExponential(src) || safeReadLogarithmic(src) || safeReadSinusoid(src)) {
      return null
    }
    const spec = safeReadLogistic(src)
    return spec ? { spec, color: c.color, id: c.id, typed: true } : null
  }, [kind, selectedCurve, exprSources, calls])

  // A typed logistic's inflection, exact. (A sketch's analysis already marks
  // the library's own closed-form inflection; its rounded spec would only
  // add a second ring next to it.)
  const logisticMarksNow = useMemo<SpecialPoint[]>(
    () => (selectedLogistic?.typed ? logisticMarks(selectedLogistic.spec) : []),
    [selectedLogistic],
  )

  // ----------------------------------------------- a selected conic, marked
  //
  // While a typed conic is selected the board marks its center, vertices,
  // co-vertices and foci through the analysis path (rings and exact chips,
  // "(2 + √5, −1)"), names the foci F₁ and F₂ (labelled points), and draws
  // the construction: a parabola's directrix dashed, a hyperbola's asymptotes
  // dashed and its fundamental rectangle dotted. Screen only — unless the
  // card's "show construction" is on, which makes the construction FIGURE
  // content: drawn selected or not, and exported (see constructionConics).
  const selectedConic = useMemo<{ spec: ConicSpec; color: string; id: string } | null>(() => {
    if (kind !== 'cartesian' || !selectedCurve) return null
    const c = selectedCurve
    if (!c.visible || c.kind !== 'implicit' || !c.modelId.startsWith('expr_')) return null
    if (calls[c.id]?.length) return null
    const spec = safeReadConic(exprSources[c.id])
    return spec ? { spec, color: c.color, id: c.id } : null
  }, [kind, selectedCurve, exprSources, calls])

  const conicMarks = useMemo<SpecialPoint[]>(
    () => (selectedConic ? conicKeyMarks(selectedConic.spec) : []),
    [selectedConic],
  )

  /** The conics whose construction is on: figure content, on screen and in the export. */
  const constructionConics = useMemo<{ spec: ConicSpec; color: string; id: string }[]>(() => {
    if (kind !== 'cartesian') return []
    const out: { spec: ConicSpec; color: string; id: string }[] = []
    for (const c of curves) {
      if (!construction[c.id] || !c.visible || c.kind !== 'implicit' || !c.modelId.startsWith('expr_')) continue
      if (calls[c.id]?.length) continue
      const spec = safeReadConic(exprSources[c.id])
      if (spec) out.push({ spec, color: c.color, id: c.id })
    }
    return out
  }, [kind, curves, construction, exprSources, calls])

  /** The construction as scene content: polylines and labelled points. */
  const constructionScene = useMemo(() => {
    const polylines: Polyline[] = []
    const shapes: Shape[] = []
    for (const c of constructionConics) {
      polylines.push(...constructionPolylines(c.spec, c.color, `construction:${c.id}`))
      shapes.push(...constructionShapes(c.spec, c.color, `construction:${c.id}`, true))
    }
    return { polylines, shapes }
  }, [constructionConics])
  const constructionSceneRef = useRef(constructionScene)
  constructionSceneRef.current = constructionScene
  const constructionConicsRef = useRef(constructionConics)
  constructionConicsRef.current = constructionConics

  // ----------------------------------------- a selected transformation, marked
  //
  // While a typed curve that reads as a transformed parent is selected, the
  // board marks the image of every parent key point (analysis path: rings and
  // exact chips, "(1, −7)"), and — while "show parent" is on — draws the
  // parent itself as a faint dashed ghost and a thin arrow from each parent
  // key point to its image. When another family section speaks for the line
  // (2^(x−1)+3 is an exponential first) nothing is drawn until the teacher
  // turns "show parent" on in the collapsed section. Screen only: none of it
  // is figure content, none of it reaches an export.
  const selectedTransform = useMemo<{
    spec: TransformSpec
    id: string
    /** Mark the image key points: the section opens by itself, or the ghost is on. */
    marks: boolean
    ghost: boolean
  } | null>(() => {
    if (kind !== 'cartesian' || !selectedCurve) return null
    const c = selectedCurve
    if (!c.visible || c.kind !== 'explicit' || !c.modelId.startsWith('expr_')) return null
    if (calls[c.id]?.length) return null
    const src = exprSources[c.id]
    if (!src) return null
    const spec = safeReadTransform(src)
    if (!spec) return null
    const factored = safeReadFactored(src)
    const exponential = !factored && safeReadExponential(src) !== null
    const logarithmic = !factored && !exponential && safeReadLogarithmic(src) !== null
    const sinusoidal =
      !factored && !exponential && !logarithmic && safeReadSinusoid(src) !== null
    const primary = transformOpenByDefault(spec, { factored, exponential, logarithmic, sinusoidal })
    const ghost = showParent[c.id] ?? primary
    if (!primary && !ghost) return null
    return { spec, id: c.id, marks: primary || ghost, ghost }
  }, [kind, selectedCurve, exprSources, showParent, calls])

  ghostActiveRef.current = selectedTransform !== null && selectedTransform.ghost
  useEffect(() => {
    if (selectedTransform?.ghost) refreshGhostFrame(true)
  }, [selectedTransform, refreshGhostFrame])

  const transformMarks = useMemo<SpecialPoint[]>(
    () =>
      selectedTransform?.marks
        ? transformKeyMarks(selectedTransform.spec)
        : [],
    [selectedTransform],
  )

  // ------------------------------------- a selected parametric / polar curve
  //
  // While a parametric or polar curve is selected the board shows it MOVING:
  // the particle at t (a filled dot), its velocity vector (and, switched on,
  // its acceleration) at a stated scale no longer than a quarter of the
  // board, for polar the dashed ray from the pole, and 3–5 arrowheads along
  // the curve in the direction of motion. Its features (horizontal and
  // vertical tangents, singular points, the pole, the start) are marked
  // through the analysis path. Screen only — the particle joins the export
  // only when the card's "show particle in export" is on.
  const selectedMotion = useMemo(() => {
    if (kind !== 'cartesian' || !selectedCurve || !selectedCurve.visible) return null
    const mk = motionKindOf(selectedCurve, models)
    return mk ? { curve: selectedCurve, kind: mk, interval: motionInterval(selectedCurve) } : null
  }, [kind, selectedCurve, models])
  motionActiveRef.current = selectedMotion !== null
  useEffect(() => {
    if (selectedMotion) refreshMotionFrame(true)
  }, [selectedMotion, refreshMotionFrame])

  // Leaving a curve pauses its particle: only the selected curve plays.
  useEffect(() => {
    setMotionPlay((m) => {
      let changed = false
      const next: Record<string, MotionPlayState> = {}
      for (const [id, p] of Object.entries(m)) {
        if (p.playing && id !== selectedId) {
          next[id] = { ...p, playing: false }
          changed = true
        } else next[id] = p
      }
      return changed ? next : m
    })
  }, [selectedId])

  const playingId =
    selectedMotion && motionPlay[selectedMotion.curve.id]?.playing ? selectedMotion.curve.id : null
  // The animation: requestAnimationFrame only while playing, paused when the
  // window loses focus or the tab is hidden.
  useEffect(() => {
    if (!playingId) return
    let raf = 0
    // Reduced motion: Play advances in half-second steps instead of gliding.
    const clock = playClock(performance.now())
    const tick = (now: number): void => {
      const dt = clock(now)
      if (dt === null) {
        raf = requestAnimationFrame(tick)
        return
      }
      const curve = curvesRef.current.find((c) => c.id === playingId)
      if (!curve) return
      const interval = motionInterval(curve)
      setMotionPlay((m) => {
        const cur = m[playingId]
        if (!cur || !cur.playing) return m
        return { ...m, [playingId]: { ...cur, t: advanceT(clampT(cur.t, interval), dt, cur.speed, interval) } }
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const pause = (): void => {
      setMotionPlay((m) => {
        const cur = m[playingId]
        return cur?.playing ? { ...m, [playingId]: { ...cur, playing: false } } : m
      })
    }
    const onVisibility = (): void => {
      if (document.hidden) pause()
    }
    window.addEventListener('blur', pause)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('blur', pause)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [playingId])

  /** The vectors' scales for the selected curve on this board (stated on its card). */
  const selectedMotionScales = useMemo<MotionScales | null>(
    () =>
      selectedMotion
        ? motionScales(selectedMotion.curve, models, selectedMotion.interval, motionFrame)
        : null,
    // depKeys: a line that calls f moves with f while its own params stand still.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedMotion, models, motionFrame, depKeys],
  )
  const motionScalesFor = useCallback(
    (id: string): MotionScales | undefined =>
      selectedMotion && selectedMotion.curve.id === id && selectedMotionScales ? selectedMotionScales : undefined,
    [selectedMotion, selectedMotionScales],
  )

  const selectedMotionPlay = selectedMotion ? motionPlay[selectedMotion.curve.id] : undefined
  /** The particle, its vectors and (polar) the ray from the pole. */
  const motionScene = useMemo(() => {
    if (!selectedMotion || !selectedMotionScales) return null
    const { curve, kind: mk, interval } = selectedMotion
    const play = selectedMotionPlay ?? defaultPlay(interval)
    const s = safeState(curve, models, clampT(play.t, interval))
    if (!s) return null
    const shapes = particleShapes(s, {
      color: curve.color,
      idBase: `motion:${curve.id}`,
      fr: motionFrame,
      scales: selectedMotionScales,
      accel: play.accel,
    })
    const polylines: Polyline[] = []
    if (mk === 'polar') {
      const ray = poleRay(s, curve.color, `motion:${curve.id}:ray`)
      if (ray) polylines.push(ray)
    }
    return { shapes, polylines, pos: s.pos, exportParticle: play.exportParticle, playing: play.playing }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMotion, selectedMotionPlay, selectedMotionScales, models, motionFrame, depKeys])
  /** The particle as figure content, when its card says so (read by the export). */
  const motionExportRef = useRef<{ shapes: Shape[]; polylines: Polyline[] } | null>(null)
  motionExportRef.current = motionScene?.exportParticle ? motionScene : null

  /** Direction-of-motion arrowheads along the selected curve. */
  const motionArrows = useMemo<Shape[]>(
    () =>
      selectedMotion
        ? directionArrows(selectedMotion.curve, models, {
            interval: selectedMotion.interval,
            fr: motionFrame,
            color: selectedMotion.curve.color,
            idBase: `motion-arrow:${selectedMotion.curve.id}`,
          })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedMotion, models, motionFrame, depKeys],
  )

  /** Its features as marks: the analysis path's rings and exact chips. */
  const motionFeatureMarks = useMemo<SpecialPoint[]>(() => {
    if (!selectedMotion) return []
    const f = safeFeatures(selectedMotion.curve, models)
    return f ? motionMarks(f, selectedMotion.kind) : []
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMotion, models, depKeys])

  /** The particle can be dragged along the curve while paused: t follows the nearest point. */
  const motionHandle = useMemo<ExtraHandle | null>(() => {
    if (!selectedMotion || !motionScene || motionScene.playing) return null
    const { curve, interval } = selectedMotion
    const id = `motion:${curve.id}:particle-handle`
    return {
      id,
      pos: motionScene.pos,
      label: selectedMotion.kind === 'polar' ? 'θ' : 't',
      color: curve.color,
      onDrag: (p: Vec2) => {
        const live = curvesRef.current.find((c) => c.id === curve.id) ?? curve
        patchMotion(curve.id, { t: nearestT(live, modelsRef.current, interval, p), playing: false })
      },
    }
  }, [selectedMotion, motionScene, patchMotion])
  /**
   * The Domain section's points: the horizontal line's grip at the left edge
   * (drag it up and down — snapped like every other handle) and the
   * reflected point, which slides along f. Only for the selected curve — or,
   * for the reflected point, f's inverse card too.
   */
  const domainHandles = useMemo<ExtraHandle[]>(() => {
    if (kind !== 'cartesian' || !selectedId) return []
    const link = inverses.find((l) => l.curveId === selectedId)
    const ownerId = link ? link.parentId : selectedId
    const l = lens[ownerId]
    const curve = curves.find((c) => c.id === ownerId)
    if (!l || !curve || !curve.visible || curve.kind !== 'explicit') return []
    const out: ExtraHandle[] = []
    if (l.hlt !== undefined && ownerId === selectedId) {
      out.push({
        id: `domain:${ownerId}:hlt`,
        pos: { x: hltEdgeX, y: l.hlt },
        label: 'y',
        color: curve.color,
        onDrag: (p: Vec2) => patchLensFor(ownerId, { hlt: snapCoord(p.y, vpRef.current, 'y') }),
      })
    }
    if (l.reflect !== undefined) {
      const f = explicitF(curve, models)
      const pr = f ? reflectProbe(f, l.reflect) : null
      if (f && pr) {
        out.push({
          id: `domain:${ownerId}:reflect`,
          pos: pr.p,
          label: 'a',
          color: curve.color,
          onDrag: (p: Vec2) => {
            const vp = vpRef.current
            const live = curvesRef.current.find((c) => c.id === ownerId)
            const g = live ? explicitF(live, modelsRef.current) : null
            if (!g) return
            patchLensFor(ownerId, { reflect: probeX(g, snapCoord(p.x, vp, 'x'), 4 / vp.pxPerUnit) })
          },
        })
      }
    }
    return out
  }, [kind, selectedId, inverses, lens, curves, models, hltEdgeX, patchLensFor])

  const boardHandles = useMemo<ExtraHandle[]>(() => {
    const more = motionHandle ? [motionHandle] : []
    if (domainHandles.length > 0) more.push(...domainHandles)
    if (ucHandle) more.push(ucHandle)
    if (sysTestHandle) more.push(sysTestHandle)
    return more.length > 0 ? [...extraHandles, ...more] : extraHandles
  }, [extraHandles, motionHandle, domainHandles, ucHandle, sysTestHandle])

  /** What the board marks for the selected curve. */
  const boardAnalysis = useMemo<SpecialPoint[]>(() => {
    const base = markersOn ? analysis : EMPTY_ANALYSIS
    const withSin = sinMarks.length > 0 ? withKeyMarks(base, sinMarks) : base
    const withConic = conicMarks.length > 0 ? withKeyMarks(withSin, conicMarks) : withSin
    const withMotion = motionFeatureMarks.length > 0 ? withKeyMarks(withConic, motionFeatureMarks) : withConic
    const withLogistic =
      logisticMarksNow.length > 0 && markersOn ? withLogisticMarks(withMotion, logisticMarksNow) : withMotion
    return transformMarks.length > 0 ? withKeyMarks(withLogistic, transformMarks) : withLogistic
  }, [markersOn, analysis, sinMarks, conicMarks, motionFeatureMarks, transformMarks, logisticMarksNow])

  /**
   * The on-screen polylines: the fields' solutions, a sinusoid's midline, and
   * a transformation's parent ghost with its key-point arrows.
   */
  const screenPolylines = useMemo<Polyline[]>(() => {
    const out = fieldPolylines.slice()
    const mid = selectedSin
      ? midlinePolyline(selectedSin.spec, selectedSin.color, `midline:${selectedSin.id}`)
      : null
    if (mid) out.push(mid)
    // a logistic's two asymptotes
    if (selectedLogistic) {
      out.push(...logisticAsymptotes(selectedLogistic.spec, selectedLogistic.color, `logistic:${selectedLogistic.id}`))
    }
    // a conic's construction: every one that is figure content, and the
    // selected one's while it is selected
    out.push(...constructionScene.polylines)
    if (selectedConic && !construction[selectedConic.id]) {
      out.push(...constructionPolylines(selectedConic.spec, selectedConic.color, `construction:${selectedConic.id}`))
    }
    if (selectedTransform?.ghost) {
      const inkFor = ghostInk(canvasTheme !== 'light')
      out.push(
        parentGhost(selectedTransform.spec.parent, ghostFrame.span, inkFor.ghost, `ghost:${selectedTransform.id}`),
        ...keyPointArrows(selectedTransform.spec, ghostFrame, inkFor.arrow, `arrow:${selectedTransform.id}`),
      )
    }
    // a polar particle's ray from the pole
    if (motionScene) out.push(...motionScene.polylines)
    // a sequence's continuous partner, dashed through its dots
    if (partnerLines.length > 0) out.push(...partnerLines)
    return out.length === fieldPolylines.length ? fieldPolylines : out
  }, [fieldPolylines, selectedSin, selectedLogistic, selectedTransform, ghostFrame, canvasTheme, constructionScene, selectedConic, construction, motionScene, partnerLines])

  /** The on-screen shapes: the board's own, then a conic's named foci (F₁, F₂). */
  const screenShapes = useMemo<Shape[]>(() => {
    const extra: Shape[] = constructionScene.shapes.slice()
    if (selectedConic && !construction[selectedConic.id]) {
      extra.push(...constructionShapes(selectedConic.spec, selectedConic.color, `construction:${selectedConic.id}`))
    }
    // a selected parametric / polar curve: its direction arrowheads, then the
    // particle and its vectors on top
    extra.push(...motionArrows)
    if (motionScene) extra.push(...motionScene.shapes)
    // a logistic's inflection point: "fastest growth"
    if (selectedLogistic) {
      extra.push(...logisticDot(selectedLogistic.spec, selectedLogistic.color, `logistic:${selectedLogistic.id}:dot`))
    }
    return extra.length === 0 ? shapeScene : [...shapeScene, ...extra]
  }, [shapeScene, constructionScene, selectedConic, construction, motionArrows, motionScene, selectedLogistic])

  const copyTimerRef = useRef(0)

  return {
    constructionSceneRef, constructionConicsRef, motionScalesFor, motionExportRef, boardHandles,
    boardAnalysis, screenPolylines, screenShapes, copyTimerRef,
  }
}

export type SelectionMarksApi = ReturnType<typeof useSelectionMarks>

// ============================================================================
// src/app/useBuilders.ts — the Build ▾ families and their handles.
//
// From roots, exponential, logistic, logarithm, sinusoid, transformation,
// piecewise, conic and parametric / polar motion: each builds a typed line and
// drags its handles by rewriting it.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback } from 'react'
import { conicSource } from '../core/conics'
import { expSource } from '../core/exponential'
import type { ExpSpec } from '../core/exponential'
import { factoredSource } from '../core/factored'
import type { FactoredSpec } from '../core/factored'
import type { FunctionEnv } from '../core/functionEnv'
import { logSource } from '../core/logarithmic'
import type { LogSpec } from '../core/logarithmic'
import { logisticSource } from '../core/logistic'
import type { LogisticSpec } from '../core/logistic'
import { parseExpression } from '../core/parse'
import { sinSource } from '../core/sinusoidal'
import type { SinSpec } from '../core/sinusoidal'
import { transformSource } from '../core/transform'
import type { TransformSpec } from '../core/transform'
import { nextId, ppuX, ppuY } from '../core/types'
import type { Vec2 } from '../core/types'
import { typedName } from '../render/curveNames'
import { CONIC_HANDLE_LABEL, dragConicHandle, safeReadConic } from '../ui/conicLinks'
import type { ConicHandleKind } from '../ui/conicLinks'
import { dragExpHandle, EXP_HANDLE_LABEL, safeReadExponential } from '../ui/expLinks'
import type { ExpHandleKind } from '../ui/expLinks'
import { moveRoot, safeReadFactored } from '../ui/factorLinks'
import type { FactorSide } from '../ui/factorLinks'
import { FIELD_SPACING_DEFAULT, readField } from '../ui/fieldLinks'
import type { BoardField } from '../ui/fieldLinks'
import {
  dragLogisticHandle,
  fittedLogistic,
  LOGISTIC_HANDLE_LABEL,
  logisticFieldPlan,
  safeReadLogistic,
} from '../ui/logisticLinks'
import type { LogisticHandleKind } from '../ui/logisticLinks'
import { dragLogHandle, LOG_HANDLE_LABEL, safeReadLogarithmic } from '../ui/logLinks'
import type { LogHandleKind } from '../ui/logLinks'
import {
  defaultPlay,
  motionInterval,
  motionKindOf,
  readIntervalEdit,
  VAR_OF,
  withInterval,
} from '../ui/motionLinks'
import type { MotionPlayState } from '../ui/motionLinks'
import { boardLetters, boundCalls } from '../ui/nameLinks'
import { dragSinHandle, safeReadSinusoid, SIN_HANDLE_LABEL, snapPiX, stickyX } from '../ui/sinLinks'
import type { SinHandleKind } from '../ui/sinLinks'
import { snapCoord } from '../ui/snap'
import {
  dragTransformHandle,
  safeReadTransform,
  sticky,
  TRANSFORM_HANDLE_LABEL,
} from '../ui/transformLinks'
import type { TransformHandleKind } from '../ui/transformLinks'
import type { BoardStateApi } from './useBoardState'
import type { BoardRefsApi } from './useBoardRefs'
import type { ModelsApi } from './useModels'
import type { NoticesApi } from './useNotices'
import type { HistoryApi } from './useHistory'
import type { TypedLinesApi } from './useTypedLines'
import { keepRestriction } from '../ui/familyLine'

/** What useBuilders reads from the hooks App calls before it. */
export interface BuildersDeps {
  board: BoardStateApi
  refs: BoardRefsApi
  derived: ModelsApi
  notices: NoticesApi
  history: HistoryApi
  typed: TypedLinesApi
}

export function useBuilders({ board, refs, derived, notices, history, typed }: BuildersDeps) {
  const {
    setFactorOpen, factorThrough, setFactorThrough, factorThroughRef, factorDragRef, setExpOpen,
    expDragRef, setLogisticOpen, logisticDragRef, setLogOpen, logDragRef, setSinOpen, sinDragRef,
    setTransformOpen, setPiecewiseOpen, setConicOpen, conicDragRef, construction, setConstruction,
    setMotionOpen, motionPlay, setMotionPlay, transformDragRef, showParent, setShowParent,
  } = board
  const { curvesRef, preEditRef, exprSourcesRef, fieldsRef, namesRef, callsRef } = refs
  const { modelsRef, envFor, axisUnitsRef, vpRef } = derived
  const { showFeatureNote } = notices
  const { commitState } = history
  const { addExpression, restateAsExpression, restateTypedCurve } = typed

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

  /**
   * A family section or board handle rewrote a typed line's formula: its
   * domain restriction stays on (d(t) = … {0 <= t <= 24} is still a
   * sinusoid — src/ui/familyLine.ts).
   */
  const restateFamily = useCallback(
    (id: string, src: string, label: string, live: boolean): string | null =>
      restateTypedCurve(id, keepRestriction(exprSourcesRef.current[id], src), label, live),
    [restateTypedCurve],
  )

  /** One committed edit from a card's family section (Roots, Exponential, Sinusoidal …). */
  const restateFactors = useCallback(
    (id: string, src: string, label: string): string | null => restateFamily(id, src, label, false),
    [restateFamily],
  )

  /** One committed edit that states the whole line, restriction included (the Piecewise section). */
  const restateLine = useCallback(
    (id: string, src: string, label: string): string | null => restateTypedCurve(id, src, label, false),
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
      const err = restateFamily(
        curveId,
        src,
        side === 'num' ? 'move root' : 'move asymptote',
        true,
      )
      if (!err) s.spec = next
    },
    [restateFamily],
  )

  // ======================================================= exponentials
  //
  // y = a·b^((x − h)/p) + k, stated the precalculus way, is an ordinary TYPED
  // curve too: "Build ▾ → Exponential" writes its line (src/core/exponential.ts)
  // and hands it to addExpression; the card's Exponential section, its "rate
  // as" rewrite and the three board handles all rewrite that line and restate
  // the curve in place through restateTypedCurve — exactly the roots path.

  /** "Add to graph": the normal typed-equation path, one undo entry. */
  const buildExponential = useCallback(
    (spec: ExpSpec): string | null => {
      let src: string
      try {
        src = expSource(spec)
      } catch {
        return 'This exponential could not be written out.'
      }
      const err = addExpression(src, 'build exponential')
      if (err) return err
      setExpOpen(false)
      return null
    },
    [addExpression],
  )

  /**
   * A SKETCHED curve replaced by a typed line, in place: same id, colour and
   * links, one undo entry. "Convert to typed exponential" takes it — a fitted
   * a·e^{bx} + c becomes y = a(b)^x + k, and from then on it is an ordinary
   * typed exponential with an Exponential section of its own.
   */
  const convertToTyped = useCallback(
    (id: string, src: string, label: string): string | null => {
      let outcome: ReturnType<typeof parseExpression>
      try {
        outcome = parseExpression(src)
      } catch {
        return 'The parser crashed on this input'
      }
      if (!outcome.ok) return outcome.error
      return restateAsExpression(id, src, outcome.plot, label, false)
    },
    [restateAsExpression],
  )

  /**
   * Drag one exponential handle vertically: the asymptote (k, with a kept —
   * the whole curve shifts), the y-intercept (a) or the point one period
   * later (b, with a kept). Snapped to the grid's ladder, restated live inside
   * the press's bracket, so a whole drag is one undo.
   */
  const dragExp = useCallback(
    (curveId: string, which: ExpHandleKind, handleId: string, to: Vec2): void => {
      const bracket = preEditRef.current
      let s = expDragRef.current
      if (!s || s.handleId !== handleId || s.curveId !== curveId || s.bracket !== bracket || !bracket) {
        const spec = safeReadExponential(exprSourcesRef.current[curveId])
        if (!spec) return
        s = { handleId, curveId, bracket, spec }
        expDragRef.current = s
      }
      const next = dragExpHandle(s.spec, which, snapCoord(to.y, vpRef.current, 'y'))
      if (!next) return
      let src: string
      try {
        src = expSource(next)
      } catch {
        return
      }
      restateFamily(curveId, src, EXP_HANDLE_LABEL[which], true)
    },
    [restateFamily],
  )

  // ======================================================= logistics
  //
  // y = L/(1 + A·e^(−kx)) + d is one more ordinary TYPED curve: "Build ▾ →
  // Logistic" writes its line from L, k and y(0) (src/core/logistic.ts) and
  // hands it to addExpression; the card's Logistic section and the three
  // board handles rewrite it in place through restateTypedCurve — the
  // exponential's path. A SKETCHED logistic's section converts it in place.

  /** "Add to graph": the normal typed-equation path, one undo entry. */
  const buildLogistic = useCallback(
    (spec: LogisticSpec): string | null => {
      let src: string
      try {
        src = logisticSource(spec)
      } catch {
        return 'This logistic could not be written out.'
      }
      const err = addExpression(src, 'build logistic')
      if (err) return err
      setLogisticOpen(false)
      return null
    },
    [addExpression],
  )

  /**
   * Drag one logistic handle: the inflection point anywhere (the whole S
   * moves), or one asymptote vertically (that line moves, the other stays).
   * Every frame is computed from the spec at the press, snapped, restated
   * live inside the press's bracket: one undo per drag.
   */
  const dragLogistic = useCallback(
    (curveId: string, which: LogisticHandleKind, handleId: string, to: Vec2): void => {
      const bracket = preEditRef.current
      let s = logisticDragRef.current
      if (!s || s.handleId !== handleId || s.curveId !== curveId || s.bracket !== bracket || !bracket) {
        const spec = safeReadLogistic(exprSourcesRef.current[curveId])
        if (!spec) return
        s = { handleId, curveId, bracket, spec }
        logisticDragRef.current = s
      }
      const vp = vpRef.current
      const next = dragLogisticHandle(s.spec, which, {
        x: snapCoord(to.x, vp, 'x'),
        y: snapCoord(to.y, vp, 'y'),
      })
      if (!next) return
      let src: string
      try {
        src = logisticSource(next)
      } catch {
        return
      }
      restateFamily(curveId, src, LOGISTIC_HANDLE_LABEL[which], true)
    },
    [restateFamily],
  )

  /**
   * "Show slope field" on a Logistic section: the differential equation the
   * curve solves, dy/dx = k(y − d)(1 − (y − d)/L), added as an ordinary slope
   * field (the same object the equation box makes from that line), with the
   * curve's own initial condition (0, y(0)) as its solution — so the class
   * sees the curve IS a solution. One undo entry. The curve stays selected.
   */
  const showLogisticField = useCallback(
    (id: string): void => {
      const curve = curvesRef.current.find((c) => c.id === id)
      if (!curve) return
      const spec = curve.modelId.startsWith('expr_')
        ? safeReadLogistic(exprSourcesRef.current[id])
        : curve.modelId === 'logistic'
          ? fittedLogistic(curve.params)?.spec ?? null
          : null
      const plan = spec ? logisticFieldPlan(spec) : null
      if (!plan) return
      if (fieldsRef.current.some((f) => f.src === plan.src)) {
        showFeatureNote({ kind: 'moved', key: Date.now(), text: `The slope field ${plan.src} is already on the board.` })
        return
      }
      const outcome = readField(plan.src)
      if (!outcome.ok) {
        showFeatureNote({ kind: 'moved', key: Date.now(), text: outcome.error })
        return
      }
      const field: BoardField = {
        id: nextId(),
        src: plan.src,
        params: outcome.defaultParams.slice(),
        color: curve.color,
        spacingPx: FIELD_SPACING_DEFAULT,
        visible: true,
        solutions: plan.through ? [{ id: nextId(), x: plan.through.x, y: plan.through.y }] : [],
      }
      commitState({ fields: [...fieldsRef.current, field] }, 'show slope field')
      showFeatureNote({
        kind: 'moved',
        key: Date.now(),
        text: `Added the slope field ${plan.src}${plan.through ? ' — this curve is its solution through (0, y(0))' : ''}.`,
      })
    },
    [commitState, showFeatureNote],
  )

  // ======================================================= logarithms
  //
  // y = a·log_b(c(x − h)) + k is one more ordinary TYPED curve: "Build ▾ →
  // Logarithmic" writes its line (src/core/logarithmic.ts) and hands it to
  // addExpression; the card's Logarithmic section, its "write in base"
  // switch and the three board handles rewrite that line and restate it in
  // place through restateTypedCurve — exactly the exponential path.

  /** "Add to graph": the normal typed-equation path, one undo entry. */
  const buildLogarithm = useCallback(
    (spec: LogSpec): string | null => {
      let src: string
      try {
        src = logSource(spec)
      } catch {
        return 'This logarithm could not be written out.'
      }
      const err = addExpression(src, 'build logarithm')
      if (err) return err
      setLogOpen(false)
      return null
    },
    [addExpression],
  )

  /**
   * Drag one logarithm handle: the asymptote along the x-axis (h — the curve
   * shifts horizontally), the anchor vertically (k) or the base point
   * vertically (a). Every frame is computed from the spec at the press,
   * snapped, restated live inside the press's bracket: one undo per drag.
   */
  const dragLog = useCallback(
    (curveId: string, which: LogHandleKind, handleId: string, to: Vec2): void => {
      const bracket = preEditRef.current
      let s = logDragRef.current
      if (!s || s.handleId !== handleId || s.curveId !== curveId || s.bracket !== bracket || !bracket) {
        const spec = safeReadLogarithmic(exprSourcesRef.current[curveId])
        if (!spec) return
        s = { handleId, curveId, bracket, spec }
        logDragRef.current = s
      }
      const snapped: Vec2 = {
        x: snapCoord(to.x, vpRef.current, 'x'),
        y: snapCoord(to.y, vpRef.current, 'y'),
      }
      const next = dragLogHandle(s.spec, which, snapped)
      if (!next) return
      let src: string
      try {
        src = logSource(next)
      } catch {
        return
      }
      restateFamily(curveId, src, LOG_HANDLE_LABEL[which], true)
    },
    [restateFamily],
  )

  // ======================================================= sinusoids
  //
  // y = a·sin(b(x − h)) + k (or cos) is one more ordinary TYPED curve: "Build ▾
  // → Sinusoidal" writes its line (src/core/sinusoidal.ts) and hands it to
  // addExpression — so a built sinusoid turns the π axis on exactly as a
  // typed one does (suggestAxisUnits reads the same exprSources). The card's
  // Sinusoidal section, its "write as" and the three board handles rewrite
  // that line and restate it in place through restateTypedCurve.

  /** "Add to graph": the normal typed-equation path, one undo entry. */
  const buildSinusoid = useCallback(
    (spec: SinSpec): string | null => {
      let src: string
      try {
        src = sinSource(spec)
      } catch {
        return 'This sinusoid could not be written out.'
      }
      const err = addExpression(src, 'build sinusoid')
      if (err) return err
      setSinOpen(false)
      return null
    },
    [addExpression],
  )

  /**
   * Drag one sinusoid handle: the midline vertically (k), the first maximum
   * (vertically the amplitude, sideways the phase shift) or the end of the
   * first cycle sideways (the period). Every frame is computed from the spec
   * at the press; x snaps to π/q rungs on a π axis (a phase shift of π/4, not
   * 0.8) and to the grid's ladder otherwise, y to its own axis's ladder; one
   * undo per drag.
   */
  const dragSin = useCallback(
    (curveId: string, which: SinHandleKind, handleId: string, anchor: Vec2, to: Vec2): void => {
      const bracket = preEditRef.current
      let s = sinDragRef.current
      if (!s || s.handleId !== handleId || s.curveId !== curveId || s.bracket !== bracket || !bracket) {
        const spec = safeReadSinusoid(exprSourcesRef.current[curveId])
        if (!spec) return
        s = { handleId, curveId, bracket, spec, anchor: { x: anchor.x, y: anchor.y } }
        sinDragRef.current = s
      }
      const vp = vpRef.current
      const ppu = ppuX(vp)
      const snappedX =
        axisUnitsRef.current.x === 'pi' ? snapPiX(to.x, ppu) : snapCoord(to.x, vp, 'x')
      const snapped: Vec2 = {
        x: stickyX(to.x, s.anchor.x, ppu, snappedX),
        y: snapCoord(to.y, vp, 'y'),
      }
      const next = dragSinHandle(s.spec, which, snapped)
      if (!next) return
      let src: string
      try {
        src = sinSource(next)
      } catch {
        return
      }
      restateFamily(curveId, src, SIN_HANDLE_LABEL[which], true)
    },
    [restateFamily],
  )

  // ======================================================= transformations
  //
  // y = a·f(b(x − h)) + k over a parent library is one more ordinary TYPED
  // curve: "Build ▾ → Transformation" writes its line (src/core/transform.ts)
  // and hands it to addExpression; the card's Transformation section and the
  // two board handles rewrite that line and restate it in place through
  // restateTypedCurve — the sinusoid's path exactly.

  /** "Add to graph": the normal typed-equation path, one undo entry. */
  const buildTransformation = useCallback(
    (spec: TransformSpec): string | null => {
      let src: string
      try {
        src = transformSource(spec)
      } catch {
        return 'This transformation could not be written out.'
      }
      const err = addExpression(src, 'build transformation')
      if (err) return err
      setTransformOpen(false)
      return null
    },
    [addExpression],
  )

  // ======================================================= piecewise
  //
  // A piecewise or step function is one more ordinary TYPED line: "Build ▾ →
  // Piecewise" writes it from a table of pieces (src/core/piecewise.ts) and
  // hands it to addExpression — so a typed head `f(x) = {…}` claims its
  // letter exactly as typing it would. The card's Piecewise section rewrites
  // the line and restates it in place through restateTypedCurve.

  /** "Add to graph": the normal typed-equation path, one undo entry. */
  const buildPiecewise = useCallback(
    (src: string): string | null => {
      const err = addExpression(src, 'build piecewise')
      if (err) return err
      setPiecewiseOpen(false)
      return null
    },
    [addExpression],
  )

  /**
   * The env a piecewise line in the making is parsed against: the letters it
   * calls decided as addExpression (id null) or a restate of curve `id` will
   * decide them, so `g(x) + 1` in a piece is g's values, not a slider g.
   */
  const piecewiseEnvFor = useCallback(
    (id: string | null, src: string): FunctionEnv | undefined => {
      const head = typedName(src)
      const own = id ? namesRef.current[id] : head ?? undefined
      const lineCalls = boundCalls(src, {
        letters: boardLetters(namesRef.current, callsRef.current, own ?? undefined),
        prevCalls: id ? callsRef.current[id] : undefined,
      })
      return envFor(lineCalls, head)
    },
    [envFor],
  )
  const piecewiseBuildEnv = useCallback((src: string) => piecewiseEnvFor(null, src), [piecewiseEnvFor])

  // ======================================================= conic sections
  //
  // A circle, ellipse, hyperbola or parabola is one more ordinary TYPED line —
  // an implicit one: "Build ▾ → Conic section" writes its standard form
  // (src/core/conics.ts) and hands it to addExpression. The card's Conic
  // section (for any typed line the core reads as a conic, general form
  // included), its "write in standard form" and the board handles rewrite
  // that line and restate it in place through restateTypedCurve.

  /** "Add to graph": the normal typed-equation path, one undo entry. */
  const buildConic = useCallback(
    (src: string): string | null => {
      const err = addExpression(src, 'build conic')
      if (err) return err
      setConicOpen(false)
      return null
    },
    [addExpression],
  )

  /**
   * Drag one conic handle: the center (h and k), the end of either semi-axis
   * (a, b; a circle's radius), a focus (c with the major / transverse
   * semi-axis kept; a parabola's p). Every frame is computed from the spec at
   * the press, each coordinate snapped to its own axis's ladder; one undo per
   * drag.
   */
  const dragConic = useCallback(
    (curveId: string, which: ConicHandleKind, handleId: string, to: Vec2): void => {
      const bracket = preEditRef.current
      let s = conicDragRef.current
      if (!s || s.handleId !== handleId || s.curveId !== curveId || s.bracket !== bracket || !bracket) {
        const spec = safeReadConic(exprSourcesRef.current[curveId])
        if (!spec) return
        s = { handleId, curveId, bracket, spec }
        conicDragRef.current = s
      }
      const vp = vpRef.current
      const snapped: Vec2 = { x: snapCoord(to.x, vp, 'x'), y: snapCoord(to.y, vp, 'y') }
      const next = dragConicHandle(s.spec, which, snapped)
      if (!next) return
      let src: string
      try {
        src = conicSource(next)
      } catch {
        return
      }
      restateFamily(curveId, src, CONIC_HANDLE_LABEL[which], true)
    },
    [restateFamily],
  )

  const setConicConstruction = useCallback((id: string, on: boolean): void => {
    setConstruction((m) => (Boolean(m[id]) === on ? m : { ...m, [id]: on }))
  }, [])
  const conicConstructionFor = useCallback((id: string): boolean => construction[id] === true, [construction])

  // ======================================================= parametric / polar motion
  //
  // A parametric or polar curve is one more ordinary TYPED line: "Build ▾ →
  // Parametric / polar" writes it (src/core/motion.ts familySource, or the
  // Custom x(t), y(t) / r(θ)) and hands it to addExpression. The card's
  // Motion section edits its interval — a typed line is restated with the
  // new {a <= t <= b} in place, a sketch's domain changes — and plays a
  // particle along it; the player is session state (motionPlay), never saved.

  /** "Add to graph": the normal typed-equation path, one undo entry. */
  const buildMotion = useCallback(
    (src: string, tab: 'parametric' | 'polar'): string | null => {
      const err = addExpression(src, tab === 'parametric' ? 'build parametric' : 'build polar')
      if (err) return err
      setMotionOpen(false)
      return null
    },
    [addExpression],
  )

  /** One committed interval edit from a Motion section. */
  const commitMotionInterval = useCallback(
    (id: string, lo: string, hi: string): string | null => {
      const curve = curvesRef.current.find((c) => c.id === id)
      if (!curve) return null
      const mk = motionKindOf(curve, modelsRef.current)
      if (!mk) return null
      const iv = readIntervalEdit(lo, hi, mk)
      if ('error' in iv) return iv.error
      const label = `${VAR_OF[mk]}-interval`
      if (curve.modelId.startsWith('expr_')) {
        const src = exprSourcesRef.current[id]
        if (src === undefined) return null
        return restateTypedCurve(id, withInterval(src, mk, iv.lo, iv.hi), label, false)
      }
      commitState(
        { curves: curvesRef.current.map((c) => (c.id === id ? { ...c, domain: [iv.a, iv.b] } : c)) },
        label,
      )
      return null
    },
    [restateTypedCurve, commitState],
  )

  /** One change to a curve's player (t, play / pause, speed, switches, area). */
  const patchMotion = useCallback((id: string, patch: Partial<MotionPlayState>): void => {
    setMotionPlay((m) => {
      const curve = curvesRef.current.find((c) => c.id === id)
      const base = m[id] ?? defaultPlay(curve ? motionInterval(curve) : [0, 2 * Math.PI])
      return { ...m, [id]: { ...base, ...patch } }
    })
  }, [])
  const motionFor = useCallback((id: string): MotionPlayState | undefined => motionPlay[id], [motionPlay])

  /**
   * Drag one transformation handle: the anchor (h and k together) or the
   * other key point (vertically a, sideways b, the anchor held). Every frame
   * is computed from the spec at the press; x snaps to π/q rungs on a π axis
   * and to the grid's ladder otherwise, y to its own ladder; a coordinate
   * that has not really moved stays exactly where it was, so a vertical drag
   * never rewrites b. One undo per drag.
   */
  const dragTransform = useCallback(
    (curveId: string, which: TransformHandleKind, handleId: string, anchor: Vec2, to: Vec2): void => {
      const bracket = preEditRef.current
      let s = transformDragRef.current
      if (!s || s.handleId !== handleId || s.curveId !== curveId || s.bracket !== bracket || !bracket) {
        const spec = safeReadTransform(exprSourcesRef.current[curveId])
        if (!spec) return
        s = { handleId, curveId, bracket, spec, anchor: { x: anchor.x, y: anchor.y } }
        transformDragRef.current = s
      }
      const vp = vpRef.current
      const px = ppuX(vp)
      const py = ppuY(vp)
      const snappedX =
        axisUnitsRef.current.x === 'pi' ? snapPiX(to.x, px) : snapCoord(to.x, vp, 'x')
      const snapped: Vec2 = {
        x: sticky(to.x, s.anchor.x, px, snappedX),
        y: sticky(to.y, s.anchor.y, py, snapCoord(to.y, vp, 'y')),
      }
      const next = dragTransformHandle(s.spec, which, snapped)
      if (!next) return
      let src: string
      try {
        src = transformSource(next)
      } catch {
        return
      }
      restateFamily(curveId, src, TRANSFORM_HANDLE_LABEL[which], true)
    },
    [restateFamily],
  )

  const setTransformShowParent = useCallback((id: string, on: boolean): void => {
    setShowParent((m) => (m[id] === on ? m : { ...m, [id]: on }))
  }, [])

  const transformShowParentFor = useCallback(
    (id: string): boolean | undefined => showParent[id],
    [showParent],
  )

  return {
    buildFromRoots, restateFactors, restateLine, dropFactorThrough, factorThroughFor, dragFactorRoot,
    buildExponential, convertToTyped, dragExp, buildLogistic, dragLogistic, showLogisticField,
    buildLogarithm, dragLog, buildSinusoid, dragSin, buildTransformation, buildPiecewise,
    piecewiseEnvFor, piecewiseBuildEnv, buildConic, dragConic, setConicConstruction,
    conicConstructionFor, buildMotion, commitMotionInterval, patchMotion, motionFor, dragTransform,
    setTransformShowParent, transformShowParentFor,
  }
}

export type BuildersApi = ReturnType<typeof useBuilders>

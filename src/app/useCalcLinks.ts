// ============================================================================
// src/app/useCalcLinks.ts — the calculus objects: tangents, f′, areas, Riemann sums and the rest.
//
// addCalcObject, area between curves, changeCalc, removeCalcObject, and the
// sync that rebuilds every dependent from its parent (syncCalc, with its
// signature cache) whenever the board changes.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  accumulationModel,
  curveIntersections,
  derivativeModel,
  isAccumulationOf,
  tangentAt,
} from '../core/calculus'
import { MODELS } from '../core/fit/models'
import {
  ACCUM_MODEL_PREFIX,
  DERIV_MODEL_PREFIX,
  signRowsFor,
  TAYLOR_MODEL_PREFIX,
} from '../core/persist'
import { nextId, ppuX, ppuY } from '../core/types'
import type { FittedCurve, ModelSpec } from '../core/types'
import {
  accumColor,
  changeLabel,
  clampN,
  defaultAccum,
  defaultBetweenBounds,
  defaultBounds,
  niceBounds,
  defaultTangentX,
  fixed as fixedNum,
  followDomains,
  isCurveLink,
  linkNoun,
  N_DEFAULT,
  specSerial,
} from '../ui/calcLinks'
import type { CalcChange, CalcKind, CalcLink } from '../ui/calcLinks'
import {
  defaultImplicitPoint,
  implicitSearchBox,
  implicitTangent,
  isImplicitCurve,
  settlePoint,
  tangentCurvePatch,
} from '../ui/implicitLinks'
import type { Box as ImplicitBox } from '../ui/implicitLinks'
import { intersectionSpan } from '../ui/intersections'
import { defaultLimitA } from '../ui/limitLinks'
import { motionInterval, motionKindOf } from '../ui/motionLinks'
import {
  applyParamCalcChange,
  defaultParamT,
  defaultPolarBetween,
  isParamCalcChange,
  orientBetween,
  polarPartners,
} from '../ui/paramCalcLinks'
import { defaultSecant } from '../ui/secantLinks'
import { defaultSignRows } from '../ui/signChartLinks'
import type { SignChartLink } from '../ui/signChartLinks'
import {
  clampTaylorN,
  defaultTaylorA,
  safePoly,
  TAYLOR_N_DEFAULT,
  TAYLOR_NEEDS_FORMULA,
  taylorChildModel,
  taylorSourceFor,
} from '../ui/taylorLinks'
import { applyVolumeChange, defaultVolume, isVolumeChange } from '../ui/volumeLinks'
import { BETWEEN_ABS, BETWEEN_CANCELLED, betweenIntent, betweenNotice, sayX } from './between'
import type { BoardStateApi } from './useBoardState'
import type { BoardRefsApi } from './useBoardRefs'
import type { ModelsApi } from './useModels'
import type { NoticesApi } from './useNotices'
import type { HistoryApi } from './useHistory'
import type { CurveEditingApi } from './useCurveEditing'

/** What useCalcLinks reads from the hooks App calls before it. */
export interface CalcLinksDeps {
  board: BoardStateApi
  refs: BoardRefsApi
  derived: ModelsApi
  notices: NoticesApi
  history: HistoryApi
  editing: CurveEditingApi
}

export function useCalcLinks({ board, refs, derived, notices, history, editing }: CalcLinksDeps) {
  const {
    curves, setSelectedId, setExtraModels, calcLinks, setArmedBetween, armedBetweenRef,
  } = board
  const {
    curvesRef, stylesRef, preEditRef, exprSourcesRef, displaySourcesRef, calcRef, callsRef,
    derivCounterRef, calcSigRef, calcDomainRef, calcAutoHiddenRef, calcSpecOriginRef,
  } = refs
  const { models, modelsRef, depKeysRef, vpRef } = derived
  const { showToast } = notices
  const { applyState, commitState, undo } = history
  const { pickColor, removeWithDependents } = editing

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

  /**
   * The box an implicit curve's horizontal and vertical tangents are looked
   * for in: the view padded by half, snapped coarse — state for the same
   * reason crossSpan is, so a pan only re-solves once the board has moved on.
   */
  const viewSearchBox = useCallback((): ImplicitBox => {
    const vp = vpRef.current
    return implicitSearchBox(vp.center, vp.widthPx / 2 / ppuX(vp), vp.heightPx / 2 / ppuY(vp))
  }, [])
  const [implicitBox, setImplicitBox] = useState<ImplicitBox>(() => viewSearchBox())
  const implicitBoxRef = useRef(implicitBox)
  implicitBoxRef.current = implicitBox
  const refreshImplicitBox = useCallback((): void => {
    const next = viewSearchBox()
    const now = implicitBoxRef.current
    if (next.x0 === now.x0 && next.x1 === now.x1 && next.y0 === now.y0 && next.y1 === now.y1) return
    implicitBoxRef.current = next
    setImplicitBox(next)
  }, [viewSearchBox])

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
      if (kind === 'tangent' && isImplicitCurve(parent, models)) {
        // A tangent to an implicit curve: a point ON the curve (a lattice point
        // such as (3, 4) when there is one in view), its tangent a `line` — or
        // a `vline` where the tangent is vertical.
        const vp = vpRef.current
        const hw = vp.widthPx / 2 / ppuX(vp)
        const hh = vp.heightPx / 2 / ppuY(vp)
        const p = defaultImplicitPoint(parent, models, {
          x0: vp.center.x - hw,
          x1: vp.center.x + hw,
          y0: vp.center.y - hh,
          y1: vp.center.y + hh,
        })
        const linkId = nextId()
        const probe = p ? { kind: 'tangent' as const, id: linkId, parentId, curveId: '', x: p.x, y: p.y } : null
        const st = probe ? implicitTangent(probe, parent, models) : null
        const patch = st ? tangentCurvePatch(st.tangent) : null
        if (!p || !st || !patch) {
          showToast('This curve has no point in view to put a tangent line on.')
          return
        }
        const curve: FittedCurve = {
          id: nextId(),
          modelId: patch.modelId,
          params: patch.params.slice(),
          kind: patch.kind,
          domain: null,
          color: parent.color,
          strokeWidth: 2,
          visible: true,
          error: 0,
        }
        commitState(
          {
            curves: [...curvesRef.current, curve],
            calc: [
              ...calcRef.current,
              { kind: 'tangent', id: linkId, parentId, curveId: curve.id, x: st.point.x, y: st.point.y },
            ],
          },
          'add tangent',
        )
        // The implicit curve stays selected: dy/dx, the point and the
        // horizontal / vertical tangents are on ITS card.
        setSelectedId(parentId)
        return
      }
      if (kind === 'pcalc' || kind === 'polarbetween') {
        // Parametric / polar calculus (BC Unit 9): overlays on the curve, like
        // a secant — no curve of their own, and the parent stays selected so
        // its card holds the readouts and the point is a handle to drag.
        const mk = motionKindOf(parent, models)
        if (!mk) {
          showToast('Only a parametric or polar curve carries this.')
          return
        }
        const id = nextId()
        if (kind === 'pcalc') {
          let t = motionInterval(parent)[0]
          try {
            t = defaultParamT(parent, models)
          } catch {
            /* the start of the interval */
          }
          commitState(
            { calc: [...calcRef.current, { kind: 'pcalc', id, parentId, t }] },
            mk === 'polar' ? 'add polar calculus' : 'add parametric calculus',
          )
          setSelectedId(parentId)
          return
        }
        if (mk !== 'polar') {
          showToast('The area between polar curves needs two polar curves.')
          return
        }
        let pick: ReturnType<typeof defaultPolarBetween> = null
        try {
          pick = defaultPolarBetween(parent, curvesRef.current, models)
        } catch {
          pick = null
        }
        if (!pick) {
          showToast(
            polarPartners(parent, curvesRef.current, models).length === 0
              ? 'Type a second polar curve first, e.g. r = 1 + sin(theta).'
              : 'These polar curves do not meet, so there is no region between them.',
          )
          return
        }
        commitState(
          {
            calc: [
              ...calcRef.current,
              { kind: 'polarbetween', id, parentId, otherId: pick.otherId, ...(pick.swap ? { swap: true as const } : {}) },
            ],
          },
          'add area between polar curves',
        )
        setSelectedId(parentId)
        return
      }
      if (!spec || spec.kind !== 'explicit') {
        showToast('Only a curve that is a function of x can carry calculus objects.')
        return
      }
      const linkId = nextId()
      const win = viewWindow()

      if (kind === 'taylor') {
        // Pₙ about a: the Maclaurin polynomial when f is analytic at 0 and 0
        // is in view, otherwise the nearest nice number to the middle of the
        // view. Its own curve, in its own colour, under tay_<link id>.
        const src = taylorSourceFor(parent, models, (callsRef.current[parentId]?.length ?? 0) > 0)
        if (!src) {
          showToast(`${TAYLOR_NEEDS_FORMULA}.`)
          return
        }
        const n = TAYLOR_N_DEFAULT
        const a = defaultTaylorA((t) => safePoly(src, t, n) !== null, win, parent.domain)
        if (a === null) {
          showToast('This curve has no point in view where a Taylor polynomial can be centered.')
          return
        }
        const wantId = `${TAYLOR_MODEL_PREFIX}${linkId}`
        const built = taylorChildModel(safePoly(src, a, n), wantId, n)
        setExtraModels((prev) => ({ ...prev, [wantId]: built }))
        modelsRef.current = { ...modelsRef.current, [wantId]: built }
        const curve: FittedCurve = {
          id: nextId(),
          modelId: wantId,
          params: [],
          kind: 'explicit',
          domain: null,
          color: pickColor(),
          strokeWidth: 2.5,
          visible: true,
          error: 0,
        }
        commitState(
          {
            curves: [...curvesRef.current, curve],
            calc: [...calcRef.current, { kind: 'taylor', id: linkId, parentId, curveId: curve.id, a, n }],
          },
          'add Taylor polynomial',
        )
        // The parent stays selected: its card holds n, a and the probe, and
        // the centre is dragged along it.
        setSelectedId(parentId)
        return
      }

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

      if (kind === 'accumulation') {
        // g(x) = ∫ₐˣ f(t) dt, from a = 0 when the integral can start there,
        // with a probe two units along so the shading and g(x) are on the
        // board from the first frame — the AP picture, ready to be asked about.
        let start: ReturnType<typeof defaultAccum> = null
        try {
          start = defaultAccum(parent, models, win)
        } catch {
          start = null
        }
        const wantId = `${ACCUM_MODEL_PREFIX}${linkId}`
        let acc: ReturnType<typeof accumulationModel> = null
        if (start) {
          try {
            acc = accumulationModel(parent, models, start.a, 0, wantId)
          } catch {
            acc = null
          }
        }
        if (!start || !acc) {
          showToast('This curve has no place an integral can start from.')
          return
        }
        if (acc.spec.id === wantId) {
          const built = acc.spec
          setExtraModels((prev) => ({ ...prev, [wantId]: built }))
        }
        const curve: FittedCurve = {
          id: nextId(),
          modelId: acc.spec.id,
          params: acc.params.slice(),
          kind: 'explicit',
          domain: acc.domain,
          color: accumColor(parent.color),
          strokeWidth: 2.5,
          visible: true,
          error: 0,
        }
        commitState(
          {
            curves: [...curvesRef.current, curve],
            calc: [
              ...calcRef.current,
              {
                kind: 'accumulation',
                id: linkId,
                parentId,
                curveId: curve.id,
                a: start.a,
                C: 0,
                ...(start.x !== undefined ? { x: start.x } : {}),
              },
            ],
          },
          'add accumulation function',
        )
        // The parent stays selected: its card holds a, C and the probe, and
        // its handles are the ones to drag.
        setSelectedId(parentId)
        return
      }

      if (kind === 'limit') {
        // The interesting point in view (a hole, a jump, a pole — nearest the
        // middle), else 0 when f lives there, else the middle of the view. An
        // overlay on f like the secant: f stays selected and carries a's handle.
        let a: number | null = null
        try {
          a = defaultLimitA(parent, models, win, depKeysRef.current[parent.id] ?? '')
        } catch {
          a = null
        }
        if (a === null) {
          showToast('This curve is not a function of x, so it has no limit to take.')
          return
        }
        commitState(
          { calc: [...calcRef.current, { kind: 'limit', id: linkId, parentId, a }] },
          'add limit',
        )
        setSelectedId(parentId)
        return
      }

      if (kind === 'signchart') {
        // One chart per curve: its card already holds every row and switch.
        // f′'s row to start, with its guides — the picture a class is asked
        // to read — and f stays selected so the card shows the statements.
        if (calcRef.current.some((l) => l.kind === 'signchart' && l.parentId === parentId)) {
          showToast('This curve already has a sign chart — its rows are on its card.')
          setSelectedId(parentId)
          return
        }
        commitState(
          {
            calc: [
              ...calcRef.current,
              { kind: 'signchart', id: linkId, parentId, rows: defaultSignRows('f'), guides: true },
            ],
          },
          'add sign chart',
        )
        setSelectedId(parentId)
        return
      }

      if (kind === 'secant') {
        // Two nice numbers in view where f is defined (continuous between
        // them when the view allows it). The secant is an overlay on f — no
        // curve, no letter — so f stays selected and carries the handles.
        let ends: [number, number] | null = null
        try {
          const vp = vpRef.current
          const halfY = vp.heightPx / 2 / ppuY(vp)
          ends = defaultSecant(parent, models, win, [vp.center.y - halfY, vp.center.y + halfY])
        } catch {
          ends = null
        }
        if (!ends) {
          showToast('This curve has no two points in view to draw a secant through.')
          return
        }
        commitState(
          { calc: [...calcRef.current, { kind: 'secant', id: linkId, parentId, a: ends[0], b: ends[1] }] },
          'add secant line',
        )
        setSelectedId(parentId)
        return
      }

      if (kind === 'volume') {
        // The region the area-between link would shade: between f and the one
        // other function it meets twice in view, else between f and the
        // x-axis (between two zeros, or from a lone zero — √x opens on
        // [0, 4]). Disks about the x-axis to start; the card changes the rest.
        // An overlay on f like the secant: f stays selected and carries the
        // handles (a, b and the slice).
        let start: ReturnType<typeof defaultVolume> = null
        try {
          start = defaultVolume(parent, curvesRef.current, models, win)
        } catch {
          start = null
        }
        if (!start) {
          showToast('This curve has no region in view to build a solid on.')
          return
        }
        commitState(
          {
            calc: [
              ...calcRef.current,
              {
                kind: 'volume',
                id: linkId,
                parentId,
                ...(start.otherId !== undefined ? { otherId: start.otherId } : {}),
                a: start.a,
                b: start.b,
                method: 'washer',
              },
            ],
          },
          'add volume',
        )
        setSelectedId(parentId)
        showToast(
          `Solid on the region between ${start.otherId !== undefined ? 'the curves' : 'the curve and the x-axis'} from x = ${sayX(start.a)} to x = ${sayX(start.b)}, about the x-axis`,
          { ms: 4500, action: { label: 'Undo', run: undo } },
        )
        return
      }

      // On screen and in nice numbers: between two zeros in view, else a
      // nice interval the curve stays on the board over (niceBounds).
      let bounds: [number, number]
      try {
        const vp = vpRef.current
        const halfY = vp.heightPx / 2 / ppuY(vp)
        bounds = niceBounds(parent, models, win, [vp.center.y - halfY, vp.center.y + halfY])
      } catch {
        bounds = defaultBounds(parent, win)
      }
      const [from, to] = bounds
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
    [commitState, pickColor, showToast, undo, viewWindow],
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
      if (isParamCalcChange(change)) {
        let c = change
        if (change.kind === 'pbetweenOther' && l.kind === 'polarbetween') {
          // A new partner: the region is turned the way round it exists.
          const otherId = change.otherId
          const par = curvesRef.current.find((cc) => cc.id === l.parentId)
          const oth = curvesRef.current.find((cc) => cc.id === otherId)
          let o: ReturnType<typeof orientBetween> = null
          try {
            o = par && oth ? orientBetween(par, oth, modelsRef.current) : null
          } catch {
            o = null
          }
          c = { ...change, swap: o?.swap ?? false }
        }
        next = applyParamCalcChange(l, c)
      } else if (isVolumeChange(change)) {
        if (l.kind !== 'volume') return
        next = applyVolumeChange(l, change, {
          curves: curvesRef.current,
          models: modelsRef.current,
          window: viewWindow(),
        })
      } else if (change.kind === 'tangentX' && l.kind === 'tangent') {
        if (!Number.isFinite(change.x) || change.x === l.x) return
        const parent = curvesRef.current.find((c) => c.id === l.parentId)
        if (parent && isImplicitCurve(parent, modelsRef.current)) {
          // A typed x on an implicit curve: the point on the branch it was on.
          const p = settlePoint(parent, modelsRef.current, change.x, l.y ?? 0)
          if (!p) {
            showToast(`The curve has no point at x = ${fixedNum(change.x, 2)} on this branch.`)
            return
          }
          next = { ...l, x: p.x, y: p.y }
        } else next = { ...l, x: change.x }
      } else if (change.kind === 'tangentPoint' && l.kind === 'tangent') {
        if (!Number.isFinite(change.x) || !Number.isFinite(change.y)) return
        if (change.x === l.x && change.y === l.y) return
        next = { ...l, x: change.x, y: change.y }
      } else if (change.kind === 'tangentMarks' && l.kind === 'tangent') {
        if ((l.marks === true) === change.on) return
        if (change.on) next = { ...l, marks: true }
        else {
          const { marks: _gone, ...rest } = l
          void _gone
          next = rest
        }
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
      } else if (change.kind === 'accumA' && l.kind === 'accumulation') {
        if (!Number.isFinite(change.a) || change.a === l.a) return
        next = { ...l, a: change.a }
      } else if (change.kind === 'accumC' && l.kind === 'accumulation') {
        if (!Number.isFinite(change.C) || change.C === l.C) return
        next = { ...l, C: change.C }
      } else if (change.kind === 'taylorA' && l.kind === 'taylor') {
        if (!Number.isFinite(change.a) || change.a === l.a) return
        next = { ...l, a: change.a }
      } else if (change.kind === 'taylorN' && l.kind === 'taylor') {
        const n = clampTaylorN(change.n)
        if (n === l.n) return
        next = { ...l, n }
      } else if (change.kind === 'taylorX' && l.kind === 'taylor') {
        if (change.x === null) {
          if (l.x === undefined) return
          const { x: _gone, ...rest } = l
          void _gone
          next = rest
        } else {
          if (!Number.isFinite(change.x) || change.x === l.x) return
          next = { ...l, x: change.x }
        }
      } else if (change.kind === 'taylorBand' && l.kind === 'taylor') {
        if ((l.band === true) === change.on) return
        const { band: _was, ...rest } = l
        void _was
        next = change.on ? { ...rest, band: true } : rest
      } else if (change.kind === 'taylorIoc' && l.kind === 'taylor') {
        if ((l.ioc === true) === change.on) return
        const { ioc: _was, ...rest } = l
        void _was
        next = change.on ? { ...rest, ioc: true } : rest
      } else if (change.kind === 'secantBound' && l.kind === 'secant') {
        if (!Number.isFinite(change.value) || l[change.which] === change.value) return
        next = { ...l, [change.which]: change.value }
      } else if (change.kind === 'secantMvt' && l.kind === 'secant') {
        if ((l.mvt === true) === change.on) return
        const { mvt: _was, ...rest } = l
        void _was
        next = change.on ? { ...rest, mvt: true } : rest
      } else if (change.kind === 'secantAvg' && l.kind === 'secant') {
        if ((l.avg === true) === change.on) return
        const { avg: _was, ...rest } = l
        void _was
        next = change.on ? { ...rest, avg: true } : rest
      } else if (change.kind === 'limitA' && l.kind === 'limit') {
        // ±Infinity is a limit at infinity; NaN is nothing.
        if (Number.isNaN(change.a) || change.a === l.a) return
        const { side: _side, ...rest } = l
        void _side
        // One-sided means nothing at ±∞: the side goes with the finite a.
        next = Number.isFinite(change.a) ? { ...l, a: change.a } : { ...rest, a: change.a }
      } else if (change.kind === 'limitSide' && l.kind === 'limit') {
        const was = l.side ?? 'both'
        if (was === change.side) return
        const { side: _was, ...rest } = l
        void _was
        next = change.side === 'both' ? rest : { ...rest, side: change.side }
      } else if (change.kind === 'limitTable' && l.kind === 'limit') {
        if ((l.table === true) === change.on) return
        const { table: _was, ...rest } = l
        void _was
        next = change.on ? { ...rest, table: true } : rest
      } else if (change.kind === 'limitEpsilon' && l.kind === 'limit') {
        if ((l.epsilon === true) === change.on) return
        const { epsilon: _was, ...rest } = l
        void _was
        next = change.on ? { ...rest, epsilon: true } : rest
      } else if (change.kind === 'limitEps' && l.kind === 'limit') {
        if (!Number.isFinite(change.eps) || !(change.eps > 0) || change.eps === l.eps) return
        next = { ...l, eps: change.eps }
      } else if (change.kind === 'signAs' && l.kind === 'signchart') {
        const was = l.as ?? 'f'
        if (was === change.as) return
        const { as: _was, arrows: _arrows, ...rest } = l
        void _was
        void _arrows
        // The rows that still exist for what the graph now is; none left means
        // the new graph's own row (f′ shown → the f′ row).
        const ok = signRowsFor(change.as)
        const kept = l.rows.filter((r) => ok.includes(r))
        const rows = kept.length > 0 ? kept : defaultSignRows(change.as)
        next = {
          ...rest,
          ...(change.as === 'f' ? {} : { as: change.as }),
          rows,
          ...(l.arrows === true && change.as !== 'f2' ? { arrows: true as const } : {}),
        }
      } else if (change.kind === 'signRows' && l.kind === 'signchart') {
        const ok = signRowsFor(l.as ?? 'f')
        const rows = ok.filter((r) => change.rows.includes(r))
        if (rows.length === l.rows.length && rows.every((r, j) => l.rows[j] === r)) return
        next = { ...l, rows }
      } else if (change.kind === 'signFlag' && l.kind === 'signchart') {
        if ((l[change.flag] === true) === change.on) return
        const rest: SignChartLink = { ...l }
        delete rest[change.flag]
        next = change.on ? { ...rest, [change.flag]: true } : rest
      } else if (change.kind === 'signInterval' && l.kind === 'signchart') {
        const { a: _a, b: _b, ...rest } = l
        void _a
        void _b
        if (change.a === null || change.b === null) {
          if (l.a === undefined) return
          next = rest
        } else {
          if (!Number.isFinite(change.a) || !Number.isFinite(change.b) || change.a === change.b) return
          const a = Math.min(change.a, change.b)
          const b = Math.max(change.a, change.b)
          if (l.a === a && l.b === b) return
          next = { ...rest, a, b }
        }
      } else if (change.kind === 'accumX' && l.kind === 'accumulation') {
        if (change.x === null) {
          if (l.x === undefined) return
          const { x: _gone, ...rest } = l
          void _gone
          next = rest
        } else {
          if (!Number.isFinite(change.x) || change.x === l.x) return
          next = { ...l, x: change.x }
        }
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
    [applyState, commitState, relabelEdit, viewWindow],
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
      const parentSpec = models[parent.modelId]
      // The parent's FORMULA is part of what the dependent was built from: a
      // retyped expression can keep its id and its (empty) params and still be
      // a different function. And a parent whose spec has not been registered
      // yet (a curve and its model arrive in two state updates) is not a
      // parent that has no derivative — it is one to come back to.
      const sig = `${parent.modelId}#${specSerial(parentSpec)}|${parent.params.join(',')}|${
        parent.domain ? parent.domain.join(',') : ''
      }|${depKeysRef.current[parent.id] ?? ''}|${parent.color}|${link.kind === 'tangent' ? `${link.x},${link.y ?? ''}` : ''}|${
        link.kind === 'accumulation' ? `${link.a}|${link.C}` : ''
      }|${link.kind === 'taylor' ? `${link.a}|${link.n}|${(callsRef.current[parent.id]?.length ?? 0) > 0}` : ''}`
      if (!parentSpec) continue
      // A Taylor curve whose model is not registered (a document just loaded,
      // an undo that brought the curve back) is rebuilt whatever the sig says.
      const tayStale =
        link.kind === 'taylor' &&
        (child.modelId !== `${TAYLOR_MODEL_PREFIX}${link.id}` || !models[child.modelId])
      const accStale =
        link.kind === 'accumulation' &&
        !MODELS[child.modelId] &&
        !isAccumulationOf(models[child.modelId], parentSpec, parent.params.length)
      if (calcSigRef.current.get(link.id) === sig && !accStale && !tayStale) continue
      calcSigRef.current.set(link.id, sig)

      let patch: Partial<FittedCurve> | null = null
      if (link.kind === 'taylor') {
        // Always a closure over Pₙ's own coefficients — rebuilt from the
        // parent as it is NOW. No polynomial (a moved onto a pole) is a model
        // that draws nothing, never a hidden curve: the card says why, and a
        // curve the teacher hid stays theirs to show.
        const wantId = `${TAYLOR_MODEL_PREFIX}${link.id}`
        const src = taylorSourceFor(parent, models, (callsRef.current[parent.id]?.length ?? 0) > 0)
        register[wantId] = taylorChildModel(safePoly(src, link.a, link.n), wantId, link.n)
        patch = { modelId: wantId, params: [], kind: 'explicit', domain: null }
        if (calcAutoHiddenRef.current.delete(link.id) && !child.visible) patch.visible = true
        patches.set(child.id, patch)
        continue
      } else if (link.kind === 'accumulation') {
        // F is a library family when its antiderivative is one (x³/3 − x IS a
        // cubic) and otherwise a closure under intf_<link id>. The closure is a
        // pure function of [...f's params, a, C], so it is only re-registered
        // when f's FORMULA changed — a slider tick is new params, not a new
        // closure.
        const wantId = `${ACCUM_MODEL_PREFIX}${link.id}`
        let acc: ReturnType<typeof accumulationModel> = null
        try {
          acc = accumulationModel(parent, models, link.a, link.C, wantId)
        } catch {
          acc = null
        }
        if (acc) {
          // Registered over exactly this formula already? Then the same closure
          // with new params is the same mathematics. isAccumulationOf compares
          // the parent SPEC by identity, not the family id: retyping an
          // expression keeps its expr_N id and swaps the formula under it.
          if (
            acc.spec.id === wantId &&
            !isAccumulationOf(models[wantId], parentSpec, parent.params.length)
          ) {
            register[wantId] = acc.spec
          }
          patch = {
            modelId: acc.spec.id,
            params: acc.params.slice(),
            domain: acc.domain,
            kind: 'explicit',
            color: accumColor(parent.color),
          }
        }
      } else if (link.kind === 'tangent' && isImplicitCurve(parent, models)) {
        // An implicit curve: the point re-found on the curve, its tangent a
        // line or — where it is vertical — a vline. None at a singular point.
        let st: ReturnType<typeof implicitTangent> = null
        try {
          st = implicitTangent(link, parent, models)
        } catch {
          st = null
        }
        const tp = st ? tangentCurvePatch(st.tangent) : null
        if (tp) patch = { modelId: tp.modelId, params: tp.params.slice(), kind: tp.kind, domain: null, color: parent.color }
      } else if (link.kind === 'tangent') {
        let t: ReturnType<typeof tangentAt> = null
        try {
          t = tangentAt(parent, models, link.x)
        } catch {
          t = null
        }
        // No tangent at a corner, a pole or outside the domain: the line HIDES
        // rather than keeping the last one it had. A stale tangent on a
        // projector is a wrong answer that looks like a right one.
        if (t) patch = { modelId: 'line', params: [t.b, t.m], kind: 'explicit', color: parent.color }
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

  return {
    curveLabel, viewWindow, crossSpan, crossSpanRef, refreshCrossSpan, implicitBox,
    refreshImplicitBox, relabelEdit, addCalcObject, addAreaBetween, cancelBetween, selectObject,
    changeCalc, removeCalcObject,
  }
}

export type CalcLinksApi = ReturnType<typeof useCalcLinks>

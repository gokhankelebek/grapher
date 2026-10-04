// ============================================================================
// src/app/useExtraHandles.ts — the selected curve's extra drag handles.
//
// A tangent's point, an interval's ends, a limit's a, the builders' handles,
// an implicit tangent and every other handle a link puts on its curve.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useMemo } from 'react'
import { tangentAt } from '../core/calculus'
import { ppuX, ppuY } from '../core/types'
import type { FittedCurve, Vec2 } from '../core/types'
import type { ExtraHandle } from '../ui/CanvasStage'
import { circlePanel, circlePointHandles, draggedCirclePoint, setCirclePoint } from '../ui/circleLinks'
import { conicHandles, safeReadConic } from '../ui/conicLinks'
import { patchCircleView } from '../ui/curveViews'
import { runColor } from '../ui/eulerLinks'
import { expHandles, safeReadExponential } from '../ui/expLinks'
import { rootHandles, safeReadFactored } from '../ui/factorLinks'
import { throughLabel } from '../ui/fieldLinks'
import { dragImplicitPoint, implicitTangent, isImplicitCurve } from '../ui/implicitLinks'
import { limitSnapPoints, snapLimitA } from '../ui/limitLinks'
import { logisticHandles, safeReadLogistic } from '../ui/logisticLinks'
import { logHandles, safeReadLogarithmic } from '../ui/logLinks'
import { motionKindOf, posAt } from '../ui/motionLinks'
import { betweenBounds, dragBetweenBound, dragParamT, outerOf } from '../ui/paramCalcLinks'
import { pointLabel, scanPairs, shapeVertices } from '../ui/shapeLinks'
import { safeReadSinusoid, sinHandles, snapPiX } from '../ui/sinLinks'
import { snapCoord, snapPlaced } from '../ui/snap'
import { snapCenter, taylorSourceFor } from '../ui/taylorLinks'
import { safeReadTransform, transformHandles } from '../ui/transformLinks'
import { snapSlice, volumeSliceHandle } from '../ui/volumeLinks'
import type { BoardStateApi } from './useBoardState'
import type { DocumentStateApi } from './useDocumentState'
import type { BoardRefsApi } from './useBoardRefs'
import type { ModelsApi } from './useModels'
import type { CalcLinksApi } from './useCalcLinks'
import type { FieldsApi } from './useFields'
import type { ShapesApi } from './useShapes'
import type { BuildersApi } from './useBuilders'

/** What useExtraHandles reads from the hooks App calls before it. */
export interface ExtraHandlesDeps {
  board: BoardStateApi
  docState: DocumentStateApi
  refs: BoardRefsApi
  derived: ModelsApi
  calc: CalcLinksApi
  fieldsApi: FieldsApi
  shapesApi: ShapesApi
  builders: BuildersApi
}

export function useExtraHandles({ board, docState, refs, derived, calc, fieldsApi, shapesApi, builders }: ExtraHandlesDeps) {
  const { curves, kind, selectedId, factorDragRef, calcLinks, fields, shapes, circleViews, circleViewsRef, setCircleViews } = board
  const { exprSources, calls } = docState
  const { curvesRef, preEditRef, calcRef } = refs
  const { models, modelsRef, depKeysRef, axisUnitsRef, vpRef } = derived
  const { changeCalc } = calc
  const { moveSolution, patchEuler } = fieldsApi
  const { dragShapeVertex, shapeCompiled } = shapesApi
  const {
    dragFactorRoot, dragExp, dragLogistic, dragLog, dragSin, dragConic, dragTransform,
  } = builders

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
      if (link.kind === 'pcalc') {
        // The point rides its curve: a drag finds the nearest t, snapped to a
        // whole number or (near one) a multiple of π/12 — "drag to π/4".
        if (link.parentId !== selectedId) continue
        const p = posAt(parent, models, link.t)
        if (!p) continue
        const polar = motionKindOf(parent, models) === 'polar'
        out.push({
          id: `calc:${link.id}:t`,
          pos: p,
          label: polar ? 'θ' : 't',
          onDrag: (pos) => {
            const par = curvesRef.current.find((c) => c.id === link.parentId)
            if (!par) return
            const vp = vpRef.current
            const t = dragParamT(par, modelsRef.current, pos, ppuX(vp), polar || axisUnitsRef.current.x === 'pi')
            changeCalc({ kind: 'pcalcT', linkId: link.id, t }, true)
          },
        })
        continue
      }
      if (link.kind === 'polarbetween') {
        // θ from and θ to ride the OUTER curve, where the rays from the pole meet it.
        const other = byId.get(link.otherId)
        if (!other || (link.parentId !== selectedId && link.otherId !== selectedId)) continue
        const bounds = betweenBounds(link, parent, other, models)
        if (!bounds) continue
        const outer = outerOf(link, parent, other)
        for (const which of [0, 1] as const) {
          const p = posAt(outer, models, bounds[which])
          if (!p) continue
          out.push({
            id: `calc:${link.id}:${which === 0 ? 'a' : 'b'}`,
            pos: p,
            label: which === 0 ? 'θ from' : 'θ to',
            onDrag: (pos) => {
              const live = calcRef.current.find((l) => l.id === link.id)
              const par = curvesRef.current.find((c) => c.id === link.parentId)
              const oth = curvesRef.current.find((c) => c.id === link.otherId)
              if (!live || live.kind !== 'polarbetween' || !par || !oth) return
              const cur = betweenBounds(live, par, oth, modelsRef.current)
              if (!cur) return
              const th = dragBetweenBound(outerOf(live, par, oth), modelsRef.current, pos, ppuX(vpRef.current))
              const nb = which === 0 ? [th, cur[1]] : [cur[0], th]
              changeCalc({ kind: 'pbetweenBounds', linkId: link.id, a: nb[0], b: nb[1] }, true)
            },
          })
        }
        continue
      }
      if (link.kind === 'tangent' && isImplicitCurve(parent, models)) {
        // The point slides along the implicit curve — round a circle, through
        // its vertical tangents — snapping to round coordinates on the way.
        if (link.curveId !== selectedId && link.parentId !== selectedId) continue
        let st: ReturnType<typeof implicitTangent> = null
        try {
          st = implicitTangent(link, parent, models)
        } catch {
          st = null
        }
        if (!st) continue
        out.push({
          id: `calc:${link.id}:point`,
          pos: st.point,
          label: 'tangent point',
          onDrag: (pos) => {
            const live = calcRef.current.find((l) => l.id === link.id)
            const par = curvesRef.current.find((c) => c.id === link.parentId)
            if (!live || live.kind !== 'tangent' || !par) return
            const vp = vpRef.current
            const q = dragImplicitPoint(
              par,
              modelsRef.current,
              { x: live.x, y: live.y ?? 0 },
              pos,
              (v, axis) => snapCoord(v, vp, axis),
              { x: ppuX(vp), y: ppuY(vp) },
            )
            changeCalc({ kind: 'tangentPoint', linkId: link.id, x: q.x, y: q.y }, true)
          },
        })
        continue
      }
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
      if (link.kind === 'taylor') {
        // The centre rides the PARENT at (a, f(a)); the probe at (x, f(x)).
        // Both snap to nice numbers — and, near one, to a multiple of π/12:
        // "drag a to π/6" is the trig lesson.
        if (link.parentId !== selectedId && link.curveId !== selectedId) continue
        const src = taylorSourceFor(parent, models, (calls[parent.id]?.length ?? 0) > 0)
        if (!src) continue
        const yAt = (x: number): number => {
          try {
            const v = src.f(x)
            return Number.isFinite(v) ? v : 0
          } catch {
            return 0
          }
        }
        const snapX = (x: number): number => {
          const vp = vpRef.current
          return snapCenter(
            x,
            ppuX(vp),
            (v) => snapCoord(v, vp, 'x'),
            axisUnitsRef.current.x === 'pi',
            (v) => snapPiX(v, ppuX(vp)),
          )
        }
        out.push({
          id: `calc:${link.id}:a`,
          pos: { x: link.a, y: yAt(link.a) },
          label: 'center a',
          onDrag: (pos) =>
            changeCalc({ kind: 'taylorA', linkId: link.id, a: onCurve(parent, snapX(pos.x)) }, true),
        })
        if (link.x !== undefined) {
          out.push({
            id: `calc:${link.id}:x`,
            pos: { x: link.x, y: yAt(link.x) },
            label: 'probe x',
            onDrag: (pos) =>
              changeCalc({ kind: 'taylorX', linkId: link.id, x: onCurve(parent, snapX(pos.x)) }, true),
          })
        }
        continue
      }
      if (link.kind === 'secant') {
        // Both points ride the curve at (a, f(a)) and (b, f(b)), snapping to
        // nice numbers — and to multiples of π on a π axis — exactly as a
        // Taylor centre does. A drag never leaves the sketch.
        if (link.parentId !== selectedId) continue
        const spec = models[parent.modelId]
        const ev = spec?.evalExplicit
        if (!ev) continue
        const yAt = (x: number): number => {
          try {
            const v = ev.call(spec, parent.params, x)
            return Number.isFinite(v) ? v : 0
          } catch {
            return 0
          }
        }
        const snapX = (x: number): number => {
          const vp = vpRef.current
          return snapCenter(
            x,
            ppuX(vp),
            (v) => snapCoord(v, vp, 'x'),
            axisUnitsRef.current.x === 'pi',
            (v) => snapPiX(v, ppuX(vp)),
          )
        }
        for (const which of ['a', 'b'] as const) {
          out.push({
            id: `calc:${link.id}:${which}`,
            pos: { x: link[which], y: yAt(link[which]) },
            label: which,
            onDrag: (pos) =>
              changeCalc(
                { kind: 'secantBound', linkId: link.id, which, value: onCurve(parent, snapX(pos.x)) },
                true,
              ),
          })
        }
        continue
      }
      if (link.kind === 'limit') {
        // a lives ON the x-axis, where "x → a" points. It snaps to the hole,
        // jump or pole within reach (the point the lesson is about), else to
        // nice numbers — multiples of π/12 near one, or of π on a π axis. A
        // limit at ±∞ has no a to hold.
        if (link.parentId !== selectedId || !Number.isFinite(link.a)) continue
        const vp = vpRef.current
        const half = vp.widthPx / 2 / ppuX(vp)
        const pts = limitSnapPoints(parent, models, [vp.center.x - half, vp.center.x + half], depKeysRef.current[parent.id] ?? '')
        const nice = (x: number): number => {
          const v = vpRef.current
          return snapCenter(
            x,
            ppuX(v),
            (u) => snapCoord(u, v, 'x'),
            axisUnitsRef.current.x === 'pi',
            (u) => snapPiX(u, ppuX(v)),
          )
        }
        out.push({
          id: `calc:${link.id}:a`,
          pos: { x: link.a, y: 0 },
          label: 'a',
          onDrag: (pos) =>
            changeCalc(
              { kind: 'limitA', linkId: link.id, a: snapLimitA(pos.x, pts, ppuX(vpRef.current), nice) },
              true,
            ),
        })
        continue
      }
      if (link.kind === 'accumulation') {
        // a and the probe live ON the x-axis, where "from a to x" is pointed
        // at; reachable from f's card (which owns the numbers) and from g's.
        if (link.parentId !== selectedId && link.curveId !== selectedId) continue
        out.push({
          id: `calc:${link.id}:a`,
          pos: { x: link.a, y: 0 },
          label: 'a',
          onDrag: (pos) =>
            changeCalc({ kind: 'accumA', linkId: link.id, a: onCurve(parent, pos.x) }, true),
        })
        if (link.x !== undefined) {
          out.push({
            id: `calc:${link.id}:x`,
            pos: { x: link.x, y: 0 },
            label: 'x',
            onDrag: (pos) =>
              changeCalc({ kind: 'accumX', linkId: link.id, x: onCurve(parent, pos.x) }, true),
          })
        }
        continue
      }
      if (link.kind === 'volume') {
        // a and b on the x-axis, as for an area — grabbable from either
        // boundary's card — and the representative slice, which rides the
        // middle of the region (the dx methods) or of the horizontal strip
        // (the dy ones) and drags along x or y. Last, so it wins a tie.
        const other = link.otherId ? byId.get(link.otherId) : undefined
        if (link.parentId !== selectedId && !(other && other.id === selectedId)) continue
        const clampX = (x: number): number => (other ? onCurve(other, onCurve(parent, x)) : onCurve(parent, x))
        for (const which of ['a', 'b'] as const) {
          out.push({
            id: `calc:${link.id}:${which}`,
            pos: { x: link[which], y: 0 },
            label: which,
            onDrag: (pos) =>
              changeCalc({ kind: 'volumeBound', linkId: link.id, which, value: clampX(pos.x) }, true),
          })
        }
        let h: ReturnType<typeof volumeSliceHandle> = null
        try {
          h = volumeSliceHandle(link, parent, other, models, depKeysRef.current)
        } catch {
          h = null
        }
        if (h) {
          const sh = h
          // Snapped like every other handle — x to nice numbers and, near
          // one, a multiple of π/12 (as a Taylor centre does); y to nice
          // numbers — then held inside the region.
          const snap = (v: number): number => {
            const vp = vpRef.current
            return sh.axis === 'x'
              ? snapCenter(
                  v,
                  ppuX(vp),
                  (u) => snapCoord(u, vp, 'x'),
                  axisUnitsRef.current.x === 'pi',
                  (u) => snapPiX(u, ppuX(vp)),
                )
              : snapCoord(v, vp, 'y')
          }
          out.push({
            id: `calc:${link.id}:slice`,
            pos: sh.pos,
            label: sh.axis === 'x' ? 'slice x' : 'slice y',
            onDrag: (pos) => {
              const v = sh.axis === 'x' ? pos.x : pos.y
              changeCalc({ kind: 'volumeSlice', linkId: link.id, x: snapSlice(v, sh.lo, sh.hi, snap) }, true)
            },
          })
        }
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
      // Each Euler run's start point. After the solution points on purpose:
      // a run starts at the first solution point by default, and the hit test
      // gives a tie to the LAST handle, so the press moves the run the
      // teacher just added rather than the curve under it.
      ;(field.eulers ?? []).forEach((run, i) => {
        out.push({
          id: `euler:${field.id}:${run.id}`,
          pos: { x: run.x0, y: run.y0 },
          label: `Euler start ${throughLabel(run.x0, run.y0).replace('through ', '')}`,
          color: runColor(field.color, i),
          onDrag: (pos) => {
            const on = snapPlaced(pos, vpRef.current)
            patchEuler(field.id, run.id, { x0: on.x, y0: on.y }, true)
          },
        })
      })
    }
    // A function built from its roots: each real root is a handle ON the
    // x-axis, where a teacher points at it — the numerator's as "root", the
    // denominator's at its asymptote. Mid-drag the handles come from the spec
    // being dragged, so the one under the finger keeps its identity.
    const typed = curves.find((c) => c.id === selectedId)
    // A typed CONIC (an implicit line): its center, the ends of its axes and a
    // focus. Mid-drag the handles come from the line as it now reads — the
    // handle under the finger keeps its id, and the drag computes from the
    // spec at the press, so nothing compounds.
    if (
      typed &&
      typed.visible &&
      typed.kind === 'implicit' &&
      typed.modelId.startsWith('expr_') &&
      !(calls[typed.id]?.length)
    ) {
      const conic = safeReadConic(exprSources[typed.id])
      if (conic) {
        for (const h of conicHandles(conic)) {
          const id = `conic:${typed.id}:${h.which}`
          out.push({
            id,
            pos: h.pos,
            label: h.label,
            onDrag: (p) => dragConic(typed.id, h.which, id, p),
          })
        }
      }
    }
    if (
      typed &&
      typed.visible &&
      typed.kind === 'explicit' &&
      typed.modelId.startsWith('expr_') &&
      // A line that calls another curve reads, without its names, as a
      // product of sliders — no family's handles belong on it.
      !(calls[typed.id]?.length)
    ) {
      const drag = factorDragRef.current
      const spec =
        drag && drag.curveId === typed.id && drag.bracket !== null && drag.bracket === preEditRef.current
          ? drag.spec
          : safeReadFactored(exprSources[typed.id])
      const exp = spec ? null : safeReadExponential(exprSources[typed.id])
      const log = spec || exp ? null : safeReadLogarithmic(exprSources[typed.id])
      const sin = spec || exp || log ? null : safeReadSinusoid(exprSources[typed.id])
      const lg = spec || exp || log || sin ? null : safeReadLogistic(exprSources[typed.id])
      // A transformed parent carries its own two handles only when no family
      // above already has handles on this line (the Roots section's roots,
      // the exponential's asymptote …): one set of handles per curve.
      const tf =
        spec || exp || log || sin || lg ? null : safeReadTransform(exprSources[typed.id])
      if (lg) {
        for (const h of logisticHandles(lg)) {
          const id = `logistic:${typed.id}:${h.which}`
          // An asymptote is a whole line: its handle sits at the board edge
          // the curve approaches it from, read live (the viewport pans
          // without re-rendering App), as the exponential's asymptote does.
          const edge = h.edge
          const pos: Vec2 =
            edge !== null
              ? {
                  get x(): number {
                    const vp = vpRef.current
                    const half = vp.widthPx / 2 / vp.pxPerUnit
                    return edge === 'left'
                      ? vp.center.x - half + 28 / vp.pxPerUnit
                      : vp.center.x + half - 28 / vp.pxPerUnit
                  },
                  y: h.pos.y,
                }
              : h.pos
          out.push({
            id,
            pos,
            label: h.label,
            onDrag: (p) => dragLogistic(typed.id, h.which, id, p),
          })
        }
      }
      if (tf) {
        for (const h of transformHandles(tf)) {
          const id = `transform:${typed.id}:${h.which}`
          out.push({
            id,
            pos: h.pos,
            label: h.label,
            onDrag: (p) => dragTransform(typed.id, h.which, id, h.pos, p),
          })
        }
      }
      if (sin) {
        // Mid-drag the handles come from the line as it now reads — the
        // handle under the finger keeps its id, and the drag computes from
        // the spec at the press, so nothing compounds.
        for (const h of sinHandles(sin)) {
          const id = `sin:${typed.id}:${h.which}`
          // The midline is a whole line: its handle sits at the board's LEFT
          // EDGE, read live (the viewport pans without re-rendering App), as
          // the exponential's asymptote does.
          const pos: Vec2 =
            h.which === 'k'
              ? {
                  get x(): number {
                    const vp = vpRef.current
                    return vp.center.x - vp.widthPx / 2 / vp.pxPerUnit + 28 / vp.pxPerUnit
                  },
                  y: h.pos.y,
                }
              : h.pos
          out.push({
            id,
            pos,
            label: h.label,
            onDrag: (p) => dragSin(typed.id, h.which, id, h.pos, p),
          })
        }
      }
      if (log) {
        // Mid-drag the handles come from the spec at the press, moved — the
        // asymptote handle stays the one under the finger.
        for (const h of logHandles(log)) {
          const id = `log:${typed.id}:${h.which}`
          out.push({
            id,
            pos: h.pos,
            label: h.label,
            onDrag: (p) => dragLog(typed.id, h.which, id, p),
          })
        }
      }
      if (exp) {
        for (const h of expHandles(exp)) {
          const id = `exp:${typed.id}:${h.which}`
          // The asymptote is a whole line, so its handle sits where the eye
          // starts reading it: the board's LEFT EDGE. The viewport pans without
          // re-rendering App, so x is read live, at paint and hit-test time.
          const pos: Vec2 =
            h.which === 'k'
              ? {
                  get x(): number {
                    const vp = vpRef.current
                    return vp.center.x - vp.widthPx / 2 / vp.pxPerUnit + 28 / vp.pxPerUnit
                  },
                  y: h.pos.y,
                }
              : h.pos
          out.push({
            id,
            pos,
            label: h.label,
            onDrag: (p) => dragExp(typed.id, h.which, id, p),
          })
        }
      }
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
    // An image follows its pre-image: it has no vertices of its own to drag.
    if (shape && shape.visible && !shape.xform) {
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
    // A circle's theorem points (P, Q, R …), when its section draws them: each
    // slides ALONG the circle, and the drag rewrites what was typed for it —
    // degrees, or coordinates when it was typed as coordinates (see
    // draggedCirclePoint). A circle's settings are never an undo step, so the
    // drag simply sets them, frame by frame, as a typed edit does.
    const circleCurve = curves.find((c) => c.id === selectedId)
    const cview = circleCurve ? circleViews[circleCurve.id] : undefined
    if (circleCurve && circleCurve.visible && cview?.show && cview.show.length > 0) {
      let panel: ReturnType<typeof circlePanel> = null
      try {
        panel = circlePanel(circleCurve, exprSources[circleCurve.id], cview)
      } catch {
        panel = null
      }
      if (panel) {
        const circle = panel.circle
        const cid = circleCurve.id
        for (const h of circlePointHandles(panel)) {
          out.push({
            id: `circle:${cid}:${h.index}`,
            pos: h.pos,
            label: h.label,
            color: circleCurve.color,
            onDrag: (pos) => {
              const live = circleViewsRef.current[cid]
              const was = live?.pts?.[h.index]
              if (was === undefined) return
              const next = draggedCirclePoint(circle, was, pos, (p) => snapPlaced(p, vpRef.current))
              if (next === null || next === was) return
              const m = patchCircleView(circleViewsRef.current, cid, { pts: setCirclePoint(live, h.index, next).pts })
              if (m === circleViewsRef.current) return
              circleViewsRef.current = m
              setCircleViews(m)
            },
          })
        }
      }
    }
    // A tangent's point on an implicit curve goes LAST: on a tie with a family
    // handle at the same spot — (5, 0) is the circle's r handle and a vertical
    // tangent's point — the later handle wins, and the point is what the
    // teacher is moving.
    const pts = out.filter((h) => h.id.startsWith('calc:') && h.label === 'tangent point')
    if (pts.length === 0) return out
    return [...out.filter((h) => !pts.includes(h)), ...pts]
  }, [
    kind,
    selectedId,
    calcLinks,
    curves,
    models,
    changeCalc,
    fields,
    moveSolution,
    patchEuler,
    shapes,
    shapeCompiled,
    dragShapeVertex,
    circleViews,
    exprSources,
    calls,
    dragFactorRoot,
    dragExp,
    dragLogistic,
    dragLog,
    dragSin,
    dragTransform,
    dragConic,
  ])

  return {
    extraHandles,
  }
}

export type ExtraHandlesApi = ReturnType<typeof useExtraHandles>

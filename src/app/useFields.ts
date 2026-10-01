// ============================================================================
// src/app/useFields.ts — slope fields, solution curves and Euler's method.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CURVE_COLORS, nextId, ppuX, ppuY } from '../core/types'
import type { Vec2 } from '../core/types'
import {
  defaultRun,
  eulerScene,
  needsTrueSolve,
  patchRun,
  withoutRun,
  withRun,
} from '../ui/eulerLinks'
import type { EulerRun, EulerScene, RunPatch } from '../ui/eulerLinks'
import {
  carryParams,
  clampFieldSpacing,
  compileFields,
  countPhrase as fieldCountPhrase,
  FIELD_SPACING_DEFAULT,
  fieldCard,
  readField,
  sceneFields,
  solutionPolylines,
  solveSpan,
  spanCovers,
} from '../ui/fieldLinks'
import type { BoardField, CompiledField, FieldCardData } from '../ui/fieldLinks'
import type { PxFrame } from '../ui/motionLinks'
import type { Polyline, SlopeField } from '../ui/renderBoard'
import { snapPlaced } from '../ui/snap'
import type { ArrowFrame } from '../ui/transformLinks'
import type { BoardStateApi } from './useBoardState'
import type { BoardRefsApi } from './useBoardRefs'
import type { ModelsApi } from './useModels'
import type { NoticesApi } from './useNotices'
import type { HistoryApi } from './useHistory'
import type { CurveEditingApi } from './useCurveEditing'
import type { CalcLinksApi } from './useCalcLinks'

/** What useFields reads from the hooks App calls before it. */
export interface FieldsDeps {
  board: BoardStateApi
  refs: BoardRefsApi
  derived: ModelsApi
  notices: NoticesApi
  history: HistoryApi
  editing: CurveEditingApi
  calc: CalcLinksApi
}

export function useFields({ board, refs, derived, notices, history, editing, calc }: FieldsDeps) {
  const { kind, selectedId, setSelectedId, fields, armedField, setArmedField } = board
  const { fieldsRef } = refs
  const { vpRef } = derived
  const { showToast } = notices
  const { applyState, commitState, undo } = history
  const { pickColor } = editing
  const { relabelEdit } = calc

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

  // ------------------------------------------------------- Euler's method
  //
  // A run is a start point, a step and a count stored on its field
  // (src/ui/eulerLinks.ts); the table, the path, the true value and the
  // verdict are all re-asked of the field on every change.

  /** "+ Euler's method": the first run from the first solution point, later ones with h halved. */
  const addEuler = useCallback(
    (fieldId: string): void => {
      const field = fieldsRef.current.find((f) => f.id === fieldId)
      if (!field) return
      const run: EulerRun = { id: nextId(), ...defaultRun(field) }
      commitState({ fields: mapField(fieldId, (f) => withRun(f, run)) }, 'add Euler’s method')
      setSelectedId(fieldId)
    },
    [commitState, mapField],
  )

  /**
   * Change one run. `live` is the drag of its start point: inside the bracket
   * the press opened, so the whole drag is one undo.
   */
  const patchEuler = useCallback(
    (fieldId: string, runId: string, patch: RunPatch, live = false): void => {
      const field = fieldsRef.current.find((f) => f.id === fieldId)
      if (!field) return
      const next = patchRun(field, runId, patch)
      if (next === field) return
      const change = { fields: mapField(fieldId, () => next) }
      if (live) {
        relabelEdit('move Euler start point')
        applyState(change)
      } else {
        commitState(change, 'edit Euler’s method')
      }
    },
    [applyState, commitState, mapField, relabelEdit],
  )

  const removeEuler = useCallback(
    (fieldId: string, runId: string): void => {
      const field = fieldsRef.current.find((f) => f.id === fieldId)
      if (!field) return
      const next = withoutRun(field, runId)
      if (next === field) return
      commitState({ fields: mapField(fieldId, () => next) }, 'remove Euler’s method')
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
  hasSolutionsRef.current =
    fields.some((f) => f.visible && f.solutions.length > 0) || needsTrueSolve(fields)

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

  /**
   * Where a selected transformation's GHOST (the parent, dashed) is sampled
   * and at what scale its arrowheads are drawn: the window, padded, and the
   * px per unit along each axis. Like the solved span it is refreshed only
   * when the window has left the span or the zoom has moved by a fifth — a
   * pan inside the margin costs two comparisons and no render.
   */
  const [ghostFrame, setGhostFrame] = useState<{ span: [number, number] } & ArrowFrame>(() => ({
    span: [-10, 10],
    ppx: 60,
    ppy: 60,
  }))
  const ghostFrameRef = useRef(ghostFrame)
  ghostFrameRef.current = ghostFrame
  /** True while a transformation's ghost or arrows are on the board. */
  const ghostActiveRef = useRef(false)
  const refreshGhostFrame = useCallback((force = false): void => {
    if (!ghostActiveRef.current && !force) return
    const vp = vpRef.current
    const px = ppuX(vp)
    const py = ppuY(vp)
    if (!(px > 0) || !(py > 0)) return
    const half = vp.widthPx / 2 / px
    const window: [number, number] = [vp.center.x - half, vp.center.x + half]
    const cur = ghostFrameRef.current
    const zoomed = (a: number, b: number): boolean => Math.abs(Math.log(a / b)) > Math.log(1.2)
    if (spanCovers(cur.span, window) && !zoomed(cur.ppx, px) && !zoomed(cur.ppy, py)) return
    const next = { span: solveSpan(window), ppx: px, ppy: py }
    ghostFrameRef.current = next
    setGhostFrame(next)
  }, [])

  /**
   * The px per unit and the board size a selected parametric / polar curve's
   * vectors and direction arrowheads are sized against. Like the ghost frame,
   * refreshed only when the zoom moves by a tenth or the board is resized —
   * a pan costs two comparisons and no render.
   */
  const [motionFrame, setMotionFrame] = useState<PxFrame>(() => ({ ppx: 60, ppy: 60, widthPx: 800, heightPx: 600 }))
  const motionFrameRef = useRef(motionFrame)
  motionFrameRef.current = motionFrame
  /** True while a parametric / polar curve is selected (its particle is on the board). */
  const motionActiveRef = useRef(false)
  const refreshMotionFrame = useCallback((force = false): void => {
    if (!motionActiveRef.current && !force) return
    const vp = vpRef.current
    const px = ppuX(vp)
    const py = ppuY(vp)
    if (!(px > 0) || !(py > 0) || !(vp.widthPx > 0) || !(vp.heightPx > 0)) return
    const cur = motionFrameRef.current
    const zoomed = (a: number, b: number): boolean => Math.abs(Math.log(a / b)) > Math.log(1.1)
    const resized = Math.abs(cur.widthPx - vp.widthPx) > 32 || Math.abs(cur.heightPx - vp.heightPx) > 32
    if (!zoomed(cur.ppx, px) && !zoomed(cur.ppy, py) && !resized) return
    const next = { ppx: px, ppy: py, widthPx: vp.widthPx, heightPx: vp.heightPx }
    motionFrameRef.current = next
    setMotionFrame(next)
  }, [])

  const fieldSolutionPolylines = useMemo<Polyline[]>(
    () => solutionPolylines(fields, fieldCompiled, solvedSpan),
    [fields, fieldCompiled, solvedSpan],
  )

  /** Euler's-method paths and, where asked for, the true solutions through their starts. */
  const eulerFigure = useMemo<EulerScene>(
    () => eulerScene(fields, fieldCompiled, solvedSpan),
    [fields, fieldCompiled, solvedSpan],
  )
  // The true solutions ride along with the solution curves — the same kind of
  // figure, integrated across the same span — so every consumer of the
  // field polylines (screen and export) gets them without a second path.
  const fieldPolylines = useMemo<Polyline[]>(
    () =>
      eulerFigure.polylines.length > 0
        ? [...fieldSolutionPolylines, ...eulerFigure.polylines]
        : fieldSolutionPolylines,
    [fieldSolutionPolylines, eulerFigure],
  )
  const eulerPathsRef = useRef(eulerFigure.paths)
  eulerPathsRef.current = eulerFigure.paths

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

  return {
    addField, setFieldEquation, setFieldParam, setFieldParamExact, setFieldSpacing,
    toggleFieldVisible, cycleFieldColor, deleteField, moveSolution, removeSolution, addEuler,
    patchEuler, removeEuler, fieldCompiled, fieldScene, refreshSolveSpan, ghostFrame,
    ghostActiveRef, refreshGhostFrame, motionFrame, motionActiveRef, refreshMotionFrame,
    eulerFigure, fieldPolylines, eulerPathsRef, fieldSceneRef, fieldPolylinesRef, pointPick,
    fieldCardFor, armSolution, setSolutionCoord,
  }
}

export type FieldsApi = ReturnType<typeof useFields>

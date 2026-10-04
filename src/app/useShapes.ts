// ============================================================================
// src/app/useShapes.ts — points, segments, vectors and polygons.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback, useMemo, useRef } from 'react'
import { CURVE_COLORS, nextId } from '../core/types'
import type { Vec2 } from '../core/types'
import { carryParams } from '../ui/fieldLinks'
import type { Shape } from '../ui/renderBoard'
import {
  compileShapes,
  moveVertex,
  namedPointMap,
  readShape,
  replaceCoord,
  scanPairs,
  sceneShapes,
  shapeCard,
  shapeVertices,
} from '../ui/shapeLinks'
import type { BoardShape, CompiledShape, ShapeCardData } from '../ui/shapeLinks'
import type { ShapeMeasureSettings, ShapeXform } from '../core/persist'
import type { XformAid, XformOp } from '../core/types'
import { looksLikeXformCommand, parseXformCommand, resolveOp } from '../core/parse/xform'
import { imageDependents, imageNumber, imageSrc, retargetImage, shapeByName, withAids } from '../ui/shapeXform'
import { snapPlaced } from '../ui/snap'
import type { BoardStateApi } from './useBoardState'
import type { BoardRefsApi } from './useBoardRefs'
import type { ModelsApi } from './useModels'
import type { NoticesApi } from './useNotices'
import type { HistoryApi } from './useHistory'
import type { CurveEditingApi } from './useCurveEditing'
import type { CalcLinksApi } from './useCalcLinks'

/** What useShapes reads from the hooks App calls before it. */
export interface ShapesDeps {
  board: BoardStateApi
  refs: BoardRefsApi
  derived: ModelsApi
  notices: NoticesApi
  history: HistoryApi
  editing: CurveEditingApi
  calc: CalcLinksApi
}

export function useShapes({ board, refs, derived, notices, history, editing, calc }: ShapesDeps) {
  const { kind, setSelectedId, shapes } = board
  const { shapesRef } = refs
  const { vpRef } = derived
  const { showToast } = notices
  const { applyState, commitState, undo } = history
  const { pickColor } = editing
  const { relabelEdit } = calc

  // ==================================================================== shapes
  //
  // A point, a segment, a vector, a polygon. Not curves: there is no x
  // sweeping across the board, only a handful of places. What is held is the
  // LINE THE TEACHER TYPED plus the constants its sliders are at; every vertex
  // is evaluated out of that (src/ui/shapeLinks.ts), which is what makes a
  // slider move an apex live and a reopened document a live figure.
  //
  // The consequence that makes shapes different from everything else here: a
  // vertex dragged with a finger REWRITES THE LINE. There is nowhere else for
  // the number to go — a stored vertex beside a source that disagrees with it
  // is a contradiction the next load would resolve the wrong way — so a
  // coordinate written `a` becomes the number, exactly as if it had been
  // typed. Typing one does the same thing. One rule, two gestures.

  const shapeCompiledRef = useRef<Map<string, CompiledShape>>(new Map())

  /** One shape, replaced in place. The list order is the sidebar's order. */
  const mapShape = useCallback(
    (id: string, fn: (s: BoardShape) => BoardShape): BoardShape[] =>
      shapesRef.current.map((s) => (s.id === id ? fn(s) : s)),
    [],
  )

  /**
   * Add a shape to the board.
   *
   * Returns the parser's own message when it refuses, so the equation box
   * shows a triangle's complaint in exactly the place it shows an equation's.
   */
  const addShape = useCallback(
    (src: string): string | null => {
      const outcome = readShape(src)
      if (!outcome.ok) return outcome.error
      const shape: BoardShape = {
        id: nextId(),
        src,
        params: outcome.defaultParams.slice(),
        color: pickColor(),
        fill: false,
        visible: true,
      }
      commitState({ shapes: [...shapesRef.current, shape] }, 'add shape')
      setSelectedId(shape.id)
      return null
    },
    [commitState, pickColor],
  )

  /**
   * Restate a shape from a new line of text — retyped on the card, or
   * rewritten by a drag or a typed coordinate.
   *
   * The constants that survive keep their values BY NAME (carryParams), for
   * the reason a field's do: turning `(a, 0)` into `(a, b)` mid-lesson must
   * leave a where the class just put it.
   */
  const restateShape = useCallback(
    (id: string, src: string, label: string, live: boolean): string | null => {
      const shape = shapesRef.current.find((s) => s.id === id)
      if (!shape) return null
      if (shape.src === src) return null
      const outcome = readShape(src)
      if (!outcome.ok) return outcome.error
      const was = readShape(shape.src)
      const params = carryParams(
        was.ok ? was.paramNames : [],
        shape.params,
        outcome.paramNames,
        outcome.defaultParams,
      )
      const patch = { shapes: mapShape(id, (s) => ({ ...s, src, params })) }
      if (live) {
        relabelEdit(label)
        applyState(patch)
      } else {
        commitState(patch, label)
      }
      return null
    },
    [applyState, commitState, mapShape, relabelEdit],
  )

  /** A constant in flight. Inside the bracket the slider's press opened. */
  const setShapeParam = useCallback(
    (id: string, index: number, value: number): void => {
      if (!Number.isFinite(value)) return
      relabelEdit('move slider')
      applyState({
        shapes: mapShape(id, (s) => {
          const params = s.params.slice()
          params[index] = value
          return { ...s, params }
        }),
      })
    },
    [applyState, mapShape, relabelEdit],
  )

  /** A typed exact constant: one commit, one undo entry, full precision. */
  const setShapeParamExact = useCallback(
    (id: string, index: number, value: number): void => {
      if (!Number.isFinite(value)) return
      commitState(
        {
          shapes: mapShape(id, (s) => {
            const params = s.params.slice()
            params[index] = value
            return { ...s, params }
          }),
        },
        'set value',
      )
      setSelectedId(id)
    },
    [commitState, mapShape],
  )

  const toggleShapeVisible = useCallback(
    (id: string): void => {
      const now = shapesRef.current.find((s) => s.id === id)
      commitState(
        { shapes: mapShape(id, (s) => ({ ...s, visible: !s.visible })) },
        now && now.visible ? 'hide shape' : 'show shape',
      )
    },
    [commitState, mapShape],
  )

  const cycleShapeColor = useCallback(
    (id: string): void => {
      const now = shapesRef.current.find((s) => s.id === id)
      if (!now) return
      const i = CURVE_COLORS.indexOf(now.color)
      const next = CURVE_COLORS[(i + 1) % CURVE_COLORS.length]
      commitState({ shapes: mapShape(id, (s) => ({ ...s, color: next })) }, 'change colour')
    },
    [commitState, mapShape],
  )

  const toggleShapeFill = useCallback(
    (id: string): void => {
      const now = shapesRef.current.find((s) => s.id === id)
      if (!now) return
      commitState(
        { shapes: mapShape(id, (s) => ({ ...s, fill: !s.fill })) },
        now.fill ? 'unfill polygon' : 'fill polygon',
      )
    },
    [commitState, mapShape],
  )

  const deleteShape = useCallback(
    (id: string): void => {
      const shape = shapesRef.current.find((s) => s.id === id)
      if (!shape) return
      // Its images go with it, in the same commit — an image of nothing is
      // not a figure the board can draw, and one undo brings all of it back.
      const deps = imageDependents(shapesRef.current, [id])
      commitState({ shapes: shapesRef.current.filter((s) => s.id !== id && !deps.has(s.id)) }, 'delete shape')
      setSelectedId((cur) => (cur === id || (cur !== null && deps.has(cur)) ? null : cur))
      const took =
        deps.size === 0
          ? 'Deleted the shape.'
          : `Deleted the shape and ${deps.size === 1 ? 'its image' : `the ${deps.size} images that depended on it`}.`
      showToast(`${took} Undo brings ${deps.size === 0 ? 'it' : 'all of it'} back.`, {
        action: { label: 'Undo', run: () => undo() },
      })
    },
    [commitState, showToast, undo],
  )

  // ------------------------------------------------ transformations of shapes
  //
  // An image is a shape whose `xform` names its pre-image and the
  // transformation as typed (src/ui/shapeXform.ts). Creating one checks the
  // parameters against the board's named points first, so a typo is said in
  // words on the card instead of becoming a broken card.

  const namedNow = (): Map<string, Vec2> => {
    const compiled = shapeCompiledRef.current
    return namedPointMap(shapesRef.current, compiled)
  }

  /** The image of a shape under a transformation; the problem in words, or null. */
  const addImage = useCallback(
    (parentId: string, op: XformOp): string | null => {
      const parent = shapeCompiledRef.current.get(parentId)?.shape
      if (!parent) return 'That figure cannot be drawn right now, so it has no image'
      const ok = resolveOp(op, namedNow())
      if ('error' in ok) return ok.error
      const n = imageNumber(shapesRef.current, parentId, null)
      const shape: BoardShape = {
        id: nextId(),
        src: imageSrc(op, parent),
        params: [],
        color: pickColor(),
        fill: false,
        visible: true,
        xform: { of: parentId, op, ...(n >= 2 ? { n } : {}) },
      }
      commitState({ shapes: [...shapesRef.current, shape] }, `${op.t} shape`)
      setSelectedId(shape.id)
      return null
    },
    [commitState, pickColor],
  )

  /** "rotate ABC 90° about (0, 0)" typed in the + box. */
  const addImageCommand = useCallback(
    (src: string): string | null => {
      const cmd = parseXformCommand(src)
      if ('error' in cmd) return cmd.error
      const list = [...shapeCompiledRef.current.values()].map((c) => ({ id: c.id, shape: c.shape }))
      const id = shapeByName(cmd.target, list)
      if (!id) return `There is no figure named ${cmd.target} on the board — name one first, e.g. ABC = (0,0) (4,0) (4,3)`
      return addImage(id, cmd.op)
    },
    [addImage],
  )

  /** Change an image's transformation (the card's inputs, or its retyped line). */
  const setImageOp = useCallback(
    (id: string, op: XformOp, of?: string): string | null => {
      const now = shapesRef.current.find((s) => s.id === id)
      if (!now?.xform) return null
      const ok = resolveOp(op, namedNow())
      if ('error' in ok) return ok.error
      const parentId = of ?? now.xform.of
      const parent = shapeCompiledRef.current.get(parentId)?.shape ?? null
      const kindChanged = now.xform.op.t !== op.t
      const xform: ShapeXform = { ...(kindChanged ? {} : now.xform), of: parentId, op }
      if (kindChanged) delete xform.aids
      if (parentId !== now.xform.of) {
        // another figure's image now: numbered among ITS images
        const n = imageNumber(shapesRef.current, parentId, id)
        if (n >= 2) xform.n = n
        else delete xform.n
      } else if (now.xform.n !== undefined) xform.n = now.xform.n
      const src = imageSrc(op, parent)
      commitState({ shapes: mapShape(id, (s) => ({ ...s, src, xform })) }, 'edit transformation')
      setSelectedId(id)
      return null
    },
    [commitState, mapShape],
  )

  const setImageAids = useCallback(
    (id: string, aids: XformAid[]): void => {
      const now = shapesRef.current.find((s) => s.id === id)
      if (!now?.xform) return
      const xform = withAids(now.xform, aids)
      commitState({ shapes: mapShape(id, (s) => ({ ...s, xform })) }, 'change visual aids')
    },
    [commitState, mapShape],
  )

  /** The symmetry overlay of a polygon: written only while it is on. */
  const toggleSymmetry = useCallback(
    (id: string, on?: boolean): void => {
      const now = shapesRef.current.find((s) => s.id === id)
      if (!now) return
      const next = on ?? !now.sym
      if (next === (now.sym === true)) return
      commitState(
        {
          shapes: mapShape(id, (s) => {
            const { sym: _old, ...rest } = s
            return next ? { ...rest, sym: true } : rest
          }),
        },
        next ? 'show symmetry' : 'hide symmetry',
      )
      setSelectedId(id)
    },
    [commitState, mapShape],
  )

  /** The figure a card compares its own with (null: none). */
  const setShapeCompare = useCallback(
    (id: string, other: string | null): void => {
      const now = shapesRef.current.find((s) => s.id === id)
      if (!now || (now.compare ?? null) === other) return
      commitState(
        {
          shapes: mapShape(id, (s) => {
            const { compare: _old, ...rest } = s
            return other ? { ...rest, compare: other } : rest
          }),
        },
        'compare figures',
      )
      setSelectedId(id)
    },
    [commitState, mapShape],
  )

  /**
   * A shape's measurement toggles (what its Measurements section draws on the
   * board) or a point's partner. One commit, one undo entry; written only
   * while something is on, so a shape measured and un-measured saves exactly
   * as it did before.
   */
  const setShapeMeasure = useCallback(
    (id: string, next: ShapeMeasureSettings | undefined, label: string): void => {
      const now = shapesRef.current.find((s) => s.id === id)
      if (!now) return
      commitState(
        {
          shapes: mapShape(id, (s) => {
            const { measure: _old, ...rest } = s
            return next ? { ...rest, measure: next } : rest
          }),
        },
        label,
      )
      setSelectedId(id)
    },
    [commitState, mapShape],
  )

  const setShapeEquation = useCallback(
    (id: string, src: string): string | null => {
      const now = shapesRef.current.find((s) => s.id === id)
      // An image's line is a transformation: retyping it changes the
      // transformation (and, when it names another figure, the pre-image).
      if (now?.xform) {
        if (!looksLikeXformCommand(src)) return 'An image’s line is a transformation, e.g. rotate ABC 90° about (0, 0)'
        const cmd = parseXformCommand(src)
        if ('error' in cmd) return cmd.error
        const list = [...shapeCompiledRef.current.values()].map((c) => ({ id: c.id, shape: c.shape }))
        const to = retargetImage(cmd.target, list, id, now.xform.of)
        if ('error' in to) return to.error
        return setImageOp(id, cmd.op, to.of)
      }
      return restateShape(id, src, 'edit shape', false)
    },
    [restateShape, setImageOp],
  )

  /**
   * Type one exact coordinate.
   *
   * It REPLACES that coordinate's source text, which is the whole point: a
   * vertex written `a` and then typed as 4 is at 4, not at wherever the slider
   * happens to be. Exact and unsnapped — a typed number is a statement.
   */
  const setShapeCoord = useCallback(
    (id: string, pair: number, axis: 'x' | 'y', value: number): void => {
      if (!Number.isFinite(value)) return
      const shape = shapesRef.current.find((s) => s.id === id)
      if (!shape) return
      const next = replaceCoord(shape.src, pair, axis, value)
      if (!next) return
      restateShape(id, next, 'set coordinate', false)
      setSelectedId(id)
    },
    [restateShape],
  )

  /**
   * Drag one vertex. Inside the bracket the press opened, so a vertex dragged
   * across the board is ONE undo called "move vertex" rather than one a frame.
   *
   * Snapped (src/ui/snap.ts): a corner put down with a finger lands on the
   * grid's own ladder, because "(3.9583, 2.9917)" is not a vertex anybody
   * means and not a number a class can copy down.
   */
  const dragShapeVertex = useCallback(
    (id: string, pair: number, to: Vec2): void => {
      const shape = shapesRef.current.find((s) => s.id === id)
      if (!shape) return
      const compiled = shapeCompiledRef.current.get(id)
      if (!compiled?.shape) return
      const vertex = shapeVertices(compiled.shape, scanPairs(shape.src)).find(
        (v) => v.pair === pair,
      )
      if (!vertex) return
      const next = moveVertex(shape.src, vertex, snapPlaced(to, vpRef.current))
      if (!next) return
      restateShape(id, next, 'move vertex', true)
    },
    [restateShape],
  )

  // ------------------------------------------------ what the shapes draw

  /** Every shape's vertices, its LaTeX and its slider names, in one pass. */
  const shapeCompiled = useMemo<Map<string, CompiledShape>>(
    () => (kind === 'cartesian' ? compileShapes(shapes) : new Map()),
    [kind, shapes],
  )
  shapeCompiledRef.current = shapeCompiled

  const shapeScene = useMemo<Shape[]>(
    () => sceneShapes(shapes, shapeCompiled),
    [shapes, shapeCompiled],
  )
  const shapeSceneRef = useRef<Shape[]>(shapeScene)
  shapeSceneRef.current = shapeScene

  /** Everything each shape's card says, computed once for all of them. */
  const shapeCards = useMemo<Record<string, ShapeCardData>>(() => {
    const out: Record<string, ShapeCardData> = {}
    for (const s of shapes) {
      const card = shapeCard(s, shapeCompiled)
      const n = imageNumber(shapes, s.id, null)
      out[s.id] = n >= 2 ? { ...card, nextImage: n } : card
    }
    return out
  }, [shapes, shapeCompiled])

  const shapeCardFor = useCallback(
    (id: string): ShapeCardData | undefined => shapeCards[id],
    [shapeCards],
  )

  return {
    addShape, setShapeEquation, setShapeParam, setShapeParamExact, toggleShapeVisible,
    cycleShapeColor, toggleShapeFill, deleteShape, setShapeCoord, dragShapeVertex, shapeCompiled, setShapeMeasure,
    shapeScene, shapeSceneRef, shapeCardFor,
    addImage, addImageCommand, setImageOp, setImageAids, toggleSymmetry, setShapeCompare,
  }
}

export type ShapesApi = ReturnType<typeof useShapes>

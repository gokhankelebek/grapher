// ============================================================================
// tests/curveViews.test.ts — per-curve view settings in the document, and the
// board's FunctionEnv.singularities.
//
//   - every setting (show construction, show parent, a polar area, the
//     Motion switches, a factored curve's point) survives save → load;
//   - a board that never touched one serialises byte-for-byte as before, and
//     an all-default entry writes nothing;
//   - an unreadable entry, or one for a curve that is gone, is dropped and
//     reported;
//   - deleting a curve forgets its settings, undo brings them back, and an
//     unrelated undo does not switch a live curve's settings back;
//   - the env answers where a NAMED curve is undefined: a typed 1/x, a
//     sketched recip family, an exclusion {x != 2} — and a line that calls
//     f = 1/x as 2f(x − 1) + 3 finds its asymptote at x = 1.
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { FitResult, FittedCurve, ModelSpec } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { parseExpression } from '../src/core/parse'
import { findPoles } from '../src/core/holes'
import {
  boardToStored,
  deserializeDoc,
  docFromBoard,
  serializeDoc,
  type BoardInput,
  type CurveViews,
  type DocMeta,
  type StoredDoc,
} from '../src/core/persist'
import {
  collectCurveViews,
  curveViewsKey,
  emptyViewStates,
  pruneViewStates,
  restoreViewStates,
  viewStatesFrom,
  type ViewStates,
} from '../src/ui/curveViews'
import { defaultPlay } from '../src/ui/motionLinks'
import { createResolver, createSingularityResolver, lineEnv } from '../src/ui/nameLinks'

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function curve(id: string, over: Partial<FittedCurve> = {}): FittedCurve {
  return {
    id,
    modelId: 'poly2',
    params: [0, 0, 1],
    kind: 'explicit',
    domain: null,
    color: '#4f9cf9',
    strokeWidth: 2.5,
    visible: true,
    error: 0,
    ...over,
  }
}

function board(over: Partial<BoardInput> = {}): BoardInput {
  return {
    curves: [curve('c1'), curve('c2'), curve('c3')],
    styles: {},
    candidates: new Map<string, FitResult[]>(),
    exprSources: {},
    viewport: { center: { x: 0, y: 0 }, pxPerUnit: 60 },
    selectedId: null,
    mode: 'draw',
    ...over,
  }
}

const META: DocMeta = { id: 'doc1', name: 'Lesson', createdAt: 1000, modifiedAt: 1000 }

const save = (input: BoardInput): string => serializeDoc(docFromBoard(META, input, 2000))

/** Every field, spread over three curves. */
const EVERY: CurveViews = {
  c1: { construction: true, showParent: false },
  c2: { area: { on: true, a: 'π/6', b: 'pi/2' }, accel: true, exportParticle: true },
  c3: { through: { x: 1.5, y: -2.25 }, showParent: true },
}

// ---------------------------------------------------------------------------
// persistence
// ---------------------------------------------------------------------------

describe('curveViews — document round trip', () => {
  it('round-trips every field', () => {
    const res = deserializeDoc(save(board({ curveViews: EVERY })))
    expect(res.problems).toEqual([])
    expect(res.board!.curveViews).toEqual(EVERY)
  })

  it('round-trips a polar area that was switched off, bounds kept', () => {
    const views: CurveViews = { c2: { area: { on: false, a: '0', b: 'π' } } }
    expect(deserializeDoc(save(board({ curveViews: views }))).board!.curveViews).toEqual(views)
  })

  it('writes one map, curves in board order, the point flat', () => {
    const raw = JSON.parse(save(board({ curveViews: EVERY }))) as StoredDoc
    expect(Object.keys(raw.board.curveViews!)).toEqual(['c1', 'c2', 'c3'])
    expect(raw.board.curveViews!.c3).toEqual({ showParent: true, through: [1.5, -2.25] })
  })

  it('a board with no view settings is byte-identical to one written before the key existed', () => {
    const before = save(board())
    expect(before).not.toContain('curveViews')
    // Empty, all-default and absent all write the same bytes.
    expect(save(board({ curveViews: {} }))).toBe(before)
    expect(save(board({ curveViews: { c1: {}, c2: {} } }))).toBe(before)
    // …and so does a load / save cycle of that document.
    const back = deserializeDoc(before).board!
    expect(back.curveViews).toEqual({})
    expect(save(board({ curves: back.curves, curveViews: back.curveViews }))).toBe(before)
  })

  it('writes nothing for a curve that is no longer on the board', () => {
    const s = boardToStored(board({ curves: [curve('c1')], curveViews: EVERY }))
    expect(Object.keys(s.curveViews!)).toEqual(['c1'])
  })

  it('drops and reports an entry for a curve that is gone', () => {
    const raw = JSON.parse(save(board({ curveViews: EVERY }))) as StoredDoc
    raw.board.curveViews!.ghost = { construction: true }
    const res = deserializeDoc(JSON.stringify(raw))
    expect(res.board!.curveViews).toEqual(EVERY)
    expect(res.degraded).toBe(true)
    expect(res.problems.join(' ')).toMatch(/view settings were dropped/)
  })

  it('drops and reports unreadable fields, keeping the readable rest', () => {
    const raw = JSON.parse(save(board({ curveViews: EVERY }))) as StoredDoc
    const views = raw.board.curveViews as unknown as Record<string, Record<string, unknown>>
    views.c1.construction = 'yes'
    views.c2.area = { on: true, a: 3 }
    views.c3 = 'garbage' as unknown as Record<string, unknown>
    const res = deserializeDoc(JSON.stringify(raw))
    expect(res.board!.curveViews).toEqual({
      c1: { showParent: false },
      c2: { accel: true, exportParticle: true },
    })
    expect(res.degraded).toBe(true)
    expect(res.problems.join(' ')).toMatch(/3 curves’ view settings could not all be read/)
  })

  it('reports a map that is not a map, and loads the board anyway', () => {
    const raw = JSON.parse(save(board())) as Record<string, Record<string, unknown>>
    raw.board.curveViews = [1, 2]
    const res = deserializeDoc(JSON.stringify(raw))
    expect(res.board!.curves).toHaveLength(3)
    expect(res.board!.curveViews).toEqual({})
    expect(res.problems.join(' ')).toMatch(/view settings were unreadable/)
  })

  it('an unknown key from a newer writer is not damage', () => {
    const raw = JSON.parse(save(board({ curveViews: { c1: { construction: true } } }))) as StoredDoc
    ;(raw.board.curveViews!.c1 as Record<string, unknown>).sparkle = true
    const res = deserializeDoc(JSON.stringify(raw))
    expect(res.problems).toEqual([])
    expect(res.board!.curveViews).toEqual({ c1: { construction: true } })
  })
})

// ---------------------------------------------------------------------------
// the App's four maps <-> the document's one
// ---------------------------------------------------------------------------

function states(): ViewStates {
  const s = emptyViewStates()
  s.construction.c1 = true
  s.showParent.c1 = false
  s.showParent.c3 = true
  s.factorThrough.c3 = { x: 1.5, y: -2.25 }
  s.motion.c2 = {
    ...defaultPlay([0, 6]),
    t: 2.5,
    playing: true,
    speed: 2,
    accel: true,
    exportParticle: true,
    area: { on: true, a: 'π/6', b: 'pi/2' },
  }
  return s
}

describe('curveViews — the App side', () => {
  const curves = [curve('c1'), curve('c2'), curve('c3')]

  it('collects every setting and nothing that is at its default', () => {
    const s = states()
    s.construction.c9 = false
    s.motion.c8 = defaultPlay([0, 1])
    expect(collectCurveViews(s)).toEqual(EVERY)
  })

  it('the save key ignores the particle: t, play / pause and speed', () => {
    const a = states()
    const b = states()
    b.motion.c2 = { ...b.motion.c2, t: 5.9, playing: false, speed: 0.5 }
    expect(curveViewsKey(collectCurveViews(a))).toBe(curveViewsKey(collectCurveViews(b)))
    b.motion.c2 = { ...b.motion.c2, accel: false }
    expect(curveViewsKey(collectCurveViews(a))).not.toBe(curveViewsKey(collectCurveViews(b)))
  })

  it('a loaded document opens with its settings, the particle paused at the start', () => {
    const s = viewStatesFrom(EVERY, curves)
    expect(collectCurveViews(s)).toEqual(EVERY)
    expect(s.motion.c2.playing).toBe(false)
    expect(s.motion.c2.speed).toBe(1)
  })

  it('delete forgets a curve’s settings; undo brings them back', () => {
    const live = states()
    // The snapshot the delete pushed, taken with c1 still on the board.
    const snapshot = collectCurveViews(live)
    const afterDelete = pruneViewStates(live, new Set(['c2', 'c3']))
    expect(collectCurveViews(afterDelete).c1).toBeUndefined()
    expect(collectCurveViews(afterDelete).c3).toEqual(EVERY.c3)
    // Undo: c1 arrives back.
    const undone = restoreViewStates(afterDelete, snapshot, new Set(['c2', 'c3']), curves)
    expect(collectCurveViews(undone)).toEqual(EVERY)
  })

  it('an undo that brings nothing back leaves live settings alone', () => {
    const live = states()
    // A snapshot from before c3's point was set, undone after it was.
    const old = collectCurveViews({ ...live, factorThrough: {} })
    const undone = restoreViewStates(live, old, new Set(['c1', 'c2', 'c3']), curves)
    expect(undone).toBe(live)
    expect(undone.factorThrough.c3).toEqual({ x: 1.5, y: -2.25 })
  })

  it('prune hands back the same object when nothing went (a slider frame)', () => {
    const s = states()
    expect(pruneViewStates(s, new Set(['c1', 'c2', 'c3']))).toBe(s)
  })

  it('a deleted curve’s settings live on in the history, never in the file', () => {
    const live = states()
    const pruned = pruneViewStates(live, new Set(['c2', 'c3']))
    const s = boardToStored(
      board({ curves: [curve('c2'), curve('c3')], curveViews: collectCurveViews(pruned) }),
    )
    expect(Object.keys(s.curveViews!)).toEqual(['c2', 'c3'])
  })
})

// ---------------------------------------------------------------------------
// FunctionEnv.singularities on the board
// ---------------------------------------------------------------------------

interface Board {
  curves: FittedCurve[]
  names: Record<string, string>
  models: Record<string, ModelSpec>
  calls: Record<string, string[]>
}

function typedBoard(): Board {
  return { curves: [], names: {}, models: { ...MODELS }, calls: {} }
}

function addTyped(b: Board, id: string, name: string, src: string, calls: string[] = []): void {
  const resolve = createResolver(() => b)
  const sing = createSingularityResolver(() => b)
  const env = calls.length > 0 ? lineEnv(resolve, calls, name, sing) : undefined
  const o = parseExpression(src, env)
  if (!o.ok) throw new Error(`${src}: ${o.error}`)
  const modelId = `expr_${id}`
  b.models[modelId] = o.plot.makeModel(modelId)
  b.curves.push(curve(id, { modelId, params: o.plot.defaultParams.slice() }))
  b.names[id] = name
  if (calls.length > 0) b.calls[id] = calls
}

describe('env.singularities — the board’s answer', () => {
  it('a typed 1/x: its pole', () => {
    const b = typedBoard()
    addTyped(b, 'F', 'f', 'y = 1/x')
    const sing = createSingularityResolver(() => b)
    expect(sing('f', [-5, 5])).toEqual([0])
    expect(sing('f', [1, 5])).toEqual([])
  })

  it('a sketched recip family: the pole at its b, found from its params', () => {
    const b = typedBoard()
    b.curves.push(curve('R', { modelId: 'recip', params: [2, 3, -1], domain: [-6, 10] }))
    b.names.R = 'f'
    const sing = createSingularityResolver(() => b)
    expect(sing('f', [-10, 10])).toEqual([3])
    // A drag of b moves it; the cache is keyed on the params.
    b.curves = [{ ...b.curves[0], params: [2, -1.5, -1] }]
    expect(sing('f', [-10, 10])).toEqual([-1.5])
  })

  it('a sketch’s domain end is an end, not a singularity', () => {
    const b = typedBoard()
    b.curves.push(curve('R', { modelId: 'recip', params: [2, 3, -1], domain: [3, 10] }))
    b.names.R = 'f'
    expect(createSingularityResolver(() => b)('f', [-10, 10])).toEqual([])
  })

  it('an exclusion {x != 2}: the hole', () => {
    const b = typedBoard()
    addTyped(b, 'F', 'f', 'y = x + 1 {x != 2}')
    expect(createSingularityResolver(() => b)('f', [-5, 5])).toEqual([2])
  })

  it('poles and holes together, sorted and once each', () => {
    const b = typedBoard()
    addTyped(b, 'F', 'f', 'y = (x - 1)/((x - 1)(x + 2))')
    expect(createSingularityResolver(() => b)('f', [-5, 5])).toEqual([-2, 1])
  })

  it('nothing for a name nobody holds or a curve that is not y = f(x)', () => {
    const b = typedBoard()
    b.curves.push(curve('C', { modelId: 'circle', kind: 'implicit', params: [0, 0, 1] }))
    b.names.C = 'c'
    const sing = createSingularityResolver(() => b)
    expect(sing('c', [-5, 5])).toEqual([])
    expect(sing('q', [-5, 5])).toEqual([])
  })

  it('g(x) = 2f(x − 1) + 3 with f = 1/x has its vertical asymptote at x = 1', () => {
    const b = typedBoard()
    addTyped(b, 'F', 'f', 'y = 1/x')
    addTyped(b, 'G', 'g', 'g(x) = 2f(x - 1) + 3', ['f'])
    const g = b.curves.find((c) => c.id === 'G')!
    expect(b.models[g.modelId].singularities?.(g.params, [-5, 5])).toEqual([1])
    expect(findPoles(g, b.models, [-5, 5])).toEqual([1])
    // …and through the env, one level further out.
    expect(createSingularityResolver(() => b)('g', [-5, 5])).toEqual([1])
  })

  it('a caller’s answer follows f when f moves (the cache is keyed on its calls)', () => {
    const b = typedBoard()
    b.curves.push(curve('R', { modelId: 'recip', params: [1, 0, 0] }))
    b.names.R = 'f'
    addTyped(b, 'G', 'g', 'g(x) = f(x - 1)', ['f'])
    const sing = createSingularityResolver(() => b)
    expect(sing('g', [-5, 5])).toEqual([1])
    b.curves = b.curves.map((c) => (c.id === 'R' ? { ...c, params: [1, 2, 0] } : c))
    expect(sing('g', [-5, 5])).toEqual([3])
  })
})

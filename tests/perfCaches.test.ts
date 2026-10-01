// ============================================================================
// tests/perfCaches.test.ts — the classroom-device performance pass.
//
// A slider drag on a heavy board (eight curves, a Taylor P₉, a slope field, an
// area, a Riemann sum, a sign chart, analysis on) used to cost ~16 ms of script
// per frame on a fast Mac. The causes, and what pins each fix down here:
//
//   * memo keys on the whole `models` map: a Taylor model is re-registered on
//     every frame its parent moves, so every curve was re-analysed and every
//     pair re-solved, twice a frame — keys now carry each curve's OWN model
//     identity (valueKeys, intersectionKey/dependencyKeys `specOf`);
//   * dear derived values recomputed at full rate during a gesture — now
//     throttled by their own cost, with a final pass on release
//     (GestureThrottle);
//   * every curve re-sampled every frame — unchanged curves now stroke the
//     path they already have (drawCurve's path cache);
//   * Taylor coefficients re-recognised as closed forms on every rebuild;
//   * every curve card re-rendered on every App render (stable handlers +
//     React.memo, data props kept when their contents are unchanged).
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { FittedCurve, ModelSpec, Viewport } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { parseExpression } from '../src/core/parse'
import { GestureThrottle, ANALYSIS_THROTTLE, CROSSINGS_THROTTLE } from '../src/ui/gestureThrottle'
import { cardModelsKey, curveSpecSerial, curveValueKey, sameRecordOr } from '../src/ui/valueKeys'
import { changedKeys, keepStable, keepStableEntries, sameShape, stabilise } from '../src/ui/stableProps'
import { intersectionKey } from '../src/ui/intersections'
import { dependencyKeys } from '../src/ui/nameLinks'
import { clearCurvePathCache, curvePathKey, drawCurve } from '../src/render/curves'
import { taylorPolynomial, taylorSourceOf, taylorText } from '../src/core/taylor'
import { renderBoard } from '../src/ui/renderBoard'
import { MockCtx, MockPath2D, withMockPath2D } from './mockCanvas'
import { heavyModel, heavyScreenScene, installPath2D, nullCtx } from './heavyScene'

type Ctx2D = Parameters<typeof drawCurve>[0]

function typed(id: string, src: string, modelId: string): { curve: FittedCurve; spec: ModelSpec } {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(src)
  return {
    curve: {
      id, modelId, params: o.plot.defaultParams.slice(), kind: o.plot.kind, domain: o.plot.domain,
      color: '#4f9cf9', strokeWidth: 2.5, visible: true, error: 0,
    },
    spec: o.plot.makeModel(modelId),
  }
}

const VP: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 50, widthPx: 1000, heightPx: 700 }

// ---------------------------------------------------------------------------
describe('GestureThrottle — cheap work runs, dear work waits, release is exact', () => {
  it('not in a gesture: always runs now, whatever the last run cost', () => {
    const t = new GestureThrottle({ minGapMs: 50, factor: 6, maxGapMs: 250 })
    t.ran(1000, 40)
    expect(t.wait(1001, false)).toBe(0)
  })

  it('in a gesture: waits factor × the last cost, at least minGap, at most maxGap', () => {
    const t = new GestureThrottle({ minGapMs: 10, factor: 4, maxGapMs: 100 })
    t.ran(1000, 5) // 4 × 5 = 20 ms
    expect(t.gap()).toBe(20)
    expect(t.wait(1005, true)).toBe(15)
    expect(t.wait(1020, true)).toBe(0)
    t.ran(2000, 1) // 4 × 1 = 4 → minGap 10
    expect(t.gap()).toBe(10)
    t.ran(3000, 500) // 2000 → capped at 100
    expect(t.gap()).toBe(100)
    expect(t.wait(3099, true)).toBeCloseTo(1, 6)
    expect(t.wait(3100, true)).toBe(0)
  })

  it('the very first run of a gesture is never held back', () => {
    const t = new GestureThrottle(CROSSINGS_THROTTLE)
    expect(t.wait(0, true)).toBe(0)
  })

  it('a nonsense cost (NaN, negative) never wedges the throttle', () => {
    const t = new GestureThrottle({ minGapMs: 0, factor: 4, maxGapMs: 100 })
    t.ran(10, Number.NaN)
    expect(t.gap()).toBe(0)
    t.ran(10, -5)
    expect(t.gap()).toBe(0)
  })

  it('the shipped settings keep a slow machine under budget: ≤ 1/4 of the time for analysis, ≤ 1/6 for crossings', () => {
    for (const [opts, share] of [[ANALYSIS_THROTTLE, 1 / 4], [CROSSINGS_THROTTLE, 1 / 6]] as const) {
      const t = new GestureThrottle(opts)
      // a Chromebook-ish cost: 12 ms per run
      t.ran(0, 12)
      expect(12 / t.gap()).toBeLessThanOrEqual(share + 1e-9)
      // and a pathological one is still refreshed several times a second
      t.ran(0, 1000)
      expect(t.gap()).toBeLessThanOrEqual(250)
    }
  })
})

// ---------------------------------------------------------------------------
describe('memo keys are values: a re-registered model only moves its own curve', () => {
  const sin = typed('s', 'y = a sin(b x)', 'expr_1')
  const cub = typed('c', 'y = x^3 - x', 'expr_2')

  it('curveValueKey is the same for an equal curve, whatever the map object', () => {
    const m1 = { ...MODELS, expr_1: sin.spec, expr_2: cub.spec }
    const m2 = { ...m1, tay_x: cub.spec } // a NEW map: something else was registered
    expect(curveValueKey(sin.curve, m1, '')).toBe(curveValueKey({ ...sin.curve, params: [...sin.curve.params] }, m2, ''))
  })

  it('…and changes with params, domain, deps, and the model OBJECT behind the id', () => {
    const m = { ...MODELS, expr_1: sin.spec }
    const k = curveValueKey(sin.curve, m, '')
    expect(curveValueKey({ ...sin.curve, params: [2, 1] }, m, '')).not.toBe(k)
    expect(curveValueKey({ ...sin.curve, domain: [0, 1] }, m, '')).not.toBe(k)
    expect(curveValueKey(sin.curve, m, 'f=expr_9#3:1:')).not.toBe(k)
    const retyped = typed('s', 'y = a sin(b x)', 'expr_1').spec // same id, new function object
    expect(curveValueKey(sin.curve, { ...m, expr_1: retyped }, '')).not.toBe(k)
    expect(curveSpecSerial(sin.curve, m)).toBe(curveSpecSerial(sin.curve, { ...m }))
  })

  it('intersectionKey with specOf: stable across a rebuilt map, moves when a curve’s model is replaced', () => {
    const m1: Record<string, ModelSpec> = { ...MODELS, expr_1: sin.spec, expr_2: cub.spec }
    const specOf = (models: Record<string, ModelSpec>) => (c: FittedCurve) => curveSpecSerial(c, models)
    const curves = [sin.curve, cub.curve]
    const k1 = intersectionKey(curves, [-10, 10], {}, specOf(m1))
    expect(intersectionKey(curves, [-10, 10], {}, specOf({ ...m1 }))).toBe(k1)
    const m2 = { ...m1, expr_2: typed('c', 'y = x^3 - x', 'expr_2').spec }
    expect(intersectionKey(curves, [-10, 10], {}, specOf(m2))).not.toBe(k1)
    // without specOf the key is exactly what it always was
    expect(intersectionKey(curves, [-10, 10], {})).toBe(intersectionKey(curves, [-10, 10]))
  })

  it('dependencyKeys with specOf: a caller’s key moves when the callee is retyped under the same id', () => {
    const f = typed('f', 'y = x^2', 'expr_1')
    const g = typed('g', 'y = f(x - 1)', 'expr_2')
    const names = { f: 'f', g: 'g' }
    const calls = { g: ['f'] }
    const m1: Record<string, ModelSpec> = { expr_1: f.spec, expr_2: g.spec }
    const m2: Record<string, ModelSpec> = { ...m1, expr_1: typed('f', 'y = x^2', 'expr_1').spec }
    const so = (m: Record<string, ModelSpec>) => (c: FittedCurve) => curveSpecSerial(c, m)
    const a = dependencyKeys([f.curve, g.curve], names, calls, so(m1))
    const b = dependencyKeys([f.curve, g.curve], names, calls, so({ ...m1 }))
    const c = dependencyKeys([f.curve, g.curve], names, calls, so(m2))
    expect(a.g).toBe(b.g)
    expect(c.g).not.toBe(a.g)
    // and the old three-argument form is unchanged
    expect(dependencyKeys([f.curve, g.curve], names, calls).g).toBe('f=expr_1:' + ':')
  })

  it('sameRecordOr keeps the old object when the entries are equal', () => {
    const a = { x: '1', y: '2' }
    expect(sameRecordOr(a, { y: '2', x: '1' })).toBe(a)
    const b = { x: '1', y: '3' }
    expect(sameRecordOr(a, b)).toBe(b)
    const c = { x: '1' }
    expect(sameRecordOr(a, c)).toBe(c)
    expect(sameRecordOr(null, a)).toBe(a)
  })
})

// ---------------------------------------------------------------------------
describe('drawCurve — an unchanged curve strokes the path it already has', () => {
  const rose = typed('r', 'r = 3cos(4theta)', 'expr_5')
  const folium = typed('f', 'x^3 + y^3 = 3x y', 'expr_4')
  const step = typed('p', 'y = floor(x)', 'expr_6')
  const models = { ...MODELS, expr_4: folium.spec, expr_5: rose.spec, expr_6: step.spec }

  it('same curve, same window, same context: the very same path object, the same geometry', () => {
    withMockPath2D(() => {
      const ctx = new MockCtx()
      drawCurve(ctx as unknown as Ctx2D, rose.curve, models, VP)
      drawCurve(ctx as unknown as Ctx2D, rose.curve, models, VP)
      expect(ctx.strokedPaths).toHaveLength(2)
      expect(ctx.strokedPaths[1]).toBe(ctx.strokedPaths[0])
      expect(ctx.strokedPaths[0].cmds.length).toBeGreaterThan(50)
    })
  })

  it('a moved window, a new param, or a new context samples afresh — and agrees with a cold draw', () => {
    withMockPath2D(() => {
      const ctx = new MockCtx()
      drawCurve(ctx as unknown as Ctx2D, folium.curve, models, VP)
      const panned = { ...VP, center: { x: 0.5, y: 0 } }
      drawCurve(ctx as unknown as Ctx2D, folium.curve, models, panned)
      expect(ctx.strokedPaths[1]).not.toBe(ctx.strokedPaths[0])
      const cold = new MockCtx()
      drawCurve(cold as unknown as Ctx2D, folium.curve, models, panned)
      expect((ctx.strokedPaths[1] as MockPath2D).cmds).toEqual((cold.strokedPaths[0] as MockPath2D).cmds)

      const sin = typed('s', 'y = a sin(b x)', 'expr_1')
      const ms = { ...models, expr_1: sin.spec }
      drawCurve(ctx as unknown as Ctx2D, sin.curve, ms, VP)
      drawCurve(ctx as unknown as Ctx2D, { ...sin.curve, params: [2, 1] }, ms, VP)
      const n = ctx.strokedPaths.length
      expect(ctx.strokedPaths[n - 1]).not.toBe(ctx.strokedPaths[n - 2])
    })
  })

  it('a replaced model under the same id is a different curve (retyped line)', () => {
    withMockPath2D(() => {
      const ctx = new MockCtx()
      drawCurve(ctx as unknown as Ctx2D, rose.curve, models, VP)
      const other = typed('r', 'r = 2cos(3theta)', 'expr_5')
      drawCurve(ctx as unknown as Ctx2D, rose.curve, { ...models, expr_5: other.spec }, VP)
      expect(ctx.strokedPaths[1]).not.toBe(ctx.strokedPaths[0])
      expect(curvePathKey(rose.curve, rose.spec, VP, false)).not.toBe(curvePathKey(rose.curve, other.spec, VP, false))
    })
  })

  it('jumps are replayed on a hit, exactly as the cold pass found them', () => {
    withMockPath2D(() => {
      const ctx = new MockCtx()
      const j1: Parameters<typeof drawCurve>[5] extends infer O ? (O extends { jumps?: infer J } ? NonNullable<J> : never) : never = []
      drawCurve(ctx as unknown as Ctx2D, step.curve, models, VP, false, { jumps: j1 })
      const j2: typeof j1 = []
      drawCurve(ctx as unknown as Ctx2D, step.curve, models, VP, false, { jumps: j2 })
      expect(j1.length).toBeGreaterThan(3)
      expect(j2).toEqual(j1)
      expect(ctx.strokedPaths[1]).toBe(ctx.strokedPaths[0])
    })
  })

  it('the vector recorder never caches: an export is one frame', () => {
    withMockPath2D(() => {
      const made: MockPath2D[] = []
      const ctx = Object.assign(new MockCtx(), {
        createVectorPath: () => {
          const p = new MockPath2D()
          made.push(p)
          return p
        },
      })
      drawCurve(ctx as unknown as Ctx2D, rose.curve, models, VP)
      drawCurve(ctx as unknown as Ctx2D, rose.curve, models, VP)
      expect(made).toHaveLength(2)
      clearCurvePathCache(ctx)
    })
  })
})

// ---------------------------------------------------------------------------
describe('Taylor coefficients: the remembered closed forms are the computed ones', () => {
  it('P₉ of sin and P₆ of eˣ read the same twice, and the same as a cold read', () => {
    const sin = typed('s', 'y = sin(x)', 'expr_1')
    const exp = typed('e', 'y = e^x', 'expr_2')
    const m = { expr_1: sin.spec, expr_2: exp.spec }
    for (const [c, n] of [[sin.curve, 9], [exp.curve, 6]] as const) {
      const src = taylorSourceOf(c, m)!
      const p1 = taylorPolynomial(src, 0, n)!
      const p2 = taylorPolynomial(src, 0, n)!
      expect(p2.coeffs).toEqual(p1.coeffs)
      expect(p2.exact).toEqual(p1.exact)
      expect(taylorText(p2)).toBe(taylorText(p1))
    }
    const p = taylorPolynomial(taylorSourceOf(sin.curve, m)!, 0, 9)!
    expect(taylorText(p)).toContain('x⁵/120')
  })
})

// ---------------------------------------------------------------------------
describe('the heavy classroom board', () => {
  it('loads with nothing lost: 9 curves, the field and its 3 solutions, area + Riemann + sign chart', () => {
    const m = heavyModel()
    expect(m.board.curves).toHaveLength(9)
    expect(m.board.fields).toHaveLength(1)
    expect(m.board.fields[0].solutions).toHaveLength(3)
    expect(m.board.calc.map((l) => l.kind).sort()).toEqual(['area', 'riemann', 'signchart', 'taylor'])
  })

  it('a redraw with nothing changed re-samples nothing (every curve path is reused)', () => {
    installPath2D()
    const scene = heavyScreenScene()
    const ctx = nullCtx()
    let built = 0
    const g = globalThis as unknown as { Path2D: typeof MockPath2D }
    const Real = g.Path2D
    g.Path2D = class extends Real {
      constructor() {
        super()
        built++
      }
    }
    try {
      renderBoard(ctx, scene)
      const first = built
      expect(first).toBeGreaterThanOrEqual(9)
      built = 0
      renderBoard(ctx, scene)
      // the curves' own paths are all reused; anything else (markers, fields)
      // is not a sampled curve and is not this cache's business
      expect(built).toBeLessThanOrEqual(first - 9)
    } finally {
      g.Path2D = Real
    }
  })
})

// ---------------------------------------------------------------------------

describe('memoised cards: stable handlers that still call the latest closure', () => {
  it('a function prop becomes one proxy for the life of the card, calling the newest handler', () => {
    const latest = { current: {} as { onX?: (n: number) => number; v: number } }
    const cache = new Map()
    const calls: string[] = []
    const p1 = stabilise({ onX: (n: number) => (calls.push(`old ${n}`), 1), v: 1 }, latest, cache)
    const p2 = stabilise({ onX: (n: number) => (calls.push(`new ${n}`), 2), v: 1 }, latest, cache)
    expect(p2.onX).toBe(p1.onX)
    expect(changedKeys(p1, p2)).toEqual([])
    // the proxy captured by the FIRST render calls the SECOND render's handler
    expect(p1.onX!(7)).toBe(2)
    expect(calls).toEqual(['new 7'])
  })

  it('data props are untouched, and an absent handler stays absent', () => {
    const latest = { current: {} as { onX?: () => void; v: number } }
    const cache = new Map()
    const a = stabilise({ v: 1 }, latest, cache)
    expect(a.onX).toBeUndefined()
    const b = stabilise({ onX: () => {}, v: 2 }, latest, cache)
    expect(typeof b.onX).toBe('function')
    expect(changedKeys(a, b).sort()).toEqual(['onX', 'v'])
  })

  it('sameShape: plain data by value (NaN included), functions and class instances by identity', () => {
    const f = (): void => {}
    expect(sameShape({ a: [1, NaN, { b: 'x' }], f }, { a: [1, NaN, { b: 'x' }], f })).toBe(true)
    expect(sameShape({ a: [1, 2] }, { a: [1, 3] })).toBe(false)
    expect(sameShape({ a: 1 }, { a: 1, b: undefined })).toBe(false)
    expect(sameShape({ f: () => 1 }, { f: () => 1 })).toBe(false)
    expect(sameShape(new Map([[1, 2]]), new Map([[1, 2]]))).toBe(false)
    expect(sameShape([1, 2], { 0: 1, 1: 2 })).toBe(false)
  })

  it('keepStable / keepStableEntries hand back the previous object when nothing changed', () => {
    const prev = { a: { rows: [1, 2] }, b: { rows: [3] } }
    const next = { a: { rows: [1, 2] }, b: { rows: [4] }, c: { rows: [] as number[] } }
    const out = keepStableEntries(prev, next)
    expect(out.a).toBe(prev.a)
    expect(out.b).not.toBe(prev.b)
    expect(out.c).toBe(next.c)
    expect(keepStable(prev.a, { rows: [1, 2] })).toBe(prev.a)
    expect(keepStable(undefined, prev.a)).toBe(prev.a)
  })

  it('cardModelsKey moves with the card’s own model object and its candidates, not with the map', () => {
    const sin = typed('s', 'y = a sin(b x)', 'expr_1')
    const m: Record<string, ModelSpec> = { ...MODELS, expr_1: sin.spec }
    const k = cardModelsKey(sin.curve, m, [{ modelId: 'linear' }])
    expect(cardModelsKey(sin.curve, { ...m, tay_T: sin.spec }, [{ modelId: 'linear' }])).toBe(k)
    expect(cardModelsKey(sin.curve, { ...m, expr_1: typed('s', 'y = a sin(b x)', 'expr_1').spec }, [{ modelId: 'linear' }])).not.toBe(k)
    expect(cardModelsKey(sin.curve, m, [{ modelId: 'quadratic' }])).not.toBe(k)
  })
})

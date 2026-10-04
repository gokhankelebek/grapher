// "Fit to curves" frames a curve's FEATURES — zeros, turning points,
// inflections, the y-intercept, holes, asymptotes, the ends of a drawn piece —
// never its extent across the window. The bug that asked for it: y = x² − 4 on
// the default ±8.5 board reached y = 72 at the edges, and equal axes then
// zoomed the board OUT to x ∈ [−65, 65].
import { describe, expect, it } from 'vitest'
import type { FittedCurve, ModelSpec, Vec2 } from '../src/core/types'
import { CURVE_COLORS } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { parseExpression } from '../src/core/parse'
import type { CalcLink } from '../src/core/persist'
import { curveFeatureBox, curvesFeatureBox } from '../src/ui/fitFrame'
import type { FitView } from '../src/ui/fitFrame'
import type { Box } from '../src/ui/curveState'
import { calcFramePoints, withPoints } from '../src/ui/viewScale'
import { drawAndRecognize, explicitPath, makeRng, winner } from './helpers'

/** The default board: 1200 × 800 px at 60 px per unit. */
const VIEW: FitView = { x: [-10, 10], y: [-6.67, 6.67] }
const DEFAULT_WINDOW: FitView = { x: [-8.5, 8.5], y: [-5.7, 5.7] }

let n = 0
function typed(src: string, id = 'f'): { f: FittedCurve; models: Record<string, ModelSpec> } {
  const out = parseExpression(src)
  if (!out.ok) throw new Error(out.error)
  const modelId = `expr_${++n}`
  const spec = out.plot.makeModel(modelId)
  return {
    f: {
      id,
      modelId,
      params: out.plot.defaultParams.slice(),
      kind: out.plot.kind,
      domain: out.plot.domain ?? null,
      color: CURVE_COLORS[0],
      strokeWidth: 2.5,
      visible: true,
      error: 0,
    },
    models: { ...MODELS, [modelId]: spec },
  }
}

function frameOf(src: string, view: FitView = DEFAULT_WINDOW): Box {
  const { f, models } = typed(src)
  const box = curveFeatureBox(f, models, view)
  expect(box, src).not.toBeNull()
  return box!
}

const contains = (b: Box, p: Vec2): boolean =>
  p.x >= b.min.x - 1e-9 && p.x <= b.max.x + 1e-9 && p.y >= b.min.y - 1e-9 && p.y <= b.max.y + 1e-9
const width = (b: Box): number => b.max.x - b.min.x
const height = (b: Box): number => b.max.y - b.min.y

describe('curveFeatureBox — polynomials', () => {
  it('y = x² − 4: its zeros and vertex, not ±65 / 80', () => {
    const b = frameOf('y = x^2 - 4')
    for (const p of [{ x: -2, y: 0 }, { x: 2, y: 0 }, { x: 0, y: -4 }]) expect(contains(b, p)).toBe(true)
    expect(b.min.x).toBeGreaterThan(-4.5)
    expect(b.min.x).toBeLessThan(-2.4)
    expect(b.max.x).toBeLessThan(4.5)
    expect(b.max.x).toBeGreaterThan(2.4)
    expect(width(b)).toBeLessThan(20)
    expect(b.min.y).toBeGreaterThan(-6)
    expect(b.min.y).toBeLessThan(-4)
    expect(b.max.y).toBeGreaterThan(3)
    expect(b.max.y).toBeLessThan(8)
  })

  it('the same parabola from a wide window is framed the same way', () => {
    const b = frameOf('y = x^2 - 4', { x: [-65, 65], y: [-43, 43] })
    expect(width(b)).toBeLessThan(10)
    expect(b.max.y).toBeLessThan(8)
  })

  it('y = x³ − 3x: zeros ±√3, turning points (∓1, ±2)', () => {
    const b = frameOf('y = x^3 - 3x')
    const r3 = Math.sqrt(3)
    for (const p of [{ x: -r3, y: 0 }, { x: r3, y: 0 }, { x: -1, y: 2 }, { x: 1, y: -2 }, { x: 0, y: 0 }]) {
      expect(contains(b, p)).toBe(true)
    }
    expect(width(b)).toBeLessThan(8)
    expect(height(b)).toBeLessThan(16)
  })

  it('a line y = 2x + 1: its zero and y-intercept', () => {
    const b = frameOf('y = 2x + 1')
    expect(contains(b, { x: -0.5, y: 0 })).toBe(true)
    expect(contains(b, { x: 0, y: 1 })).toBe(true)
    expect(width(b)).toBeLessThan(8)
    expect(height(b)).toBeLessThan(10)
  })

  it('a constant y = 3: a sensible width, with the x-axis to read it against', () => {
    const b = frameOf('y = 3')
    expect(width(b)).toBeGreaterThanOrEqual(5.9)
    expect(width(b)).toBeLessThan(8)
    expect(contains(b, { x: 0, y: 3 })).toBe(true)
    expect(contains(b, { x: 0, y: 0 })).toBe(true)
    expect(b.max.y).toBeLessThan(5)
  })

  it('y = x² + 100 is framed near y = 100, not down to the axis', () => {
    const b = frameOf('y = x^2 + 100')
    expect(contains(b, { x: 0, y: 100 })).toBe(true)
    expect(b.min.y).toBeGreaterThan(95)
    expect(b.max.y).toBeLessThan(110)
    expect(width(b)).toBeLessThan(8)
  })
})

describe('curveFeatureBox — exponentials and logs', () => {
  it('eˣ: its one key point (0, 1) gets a ~[−3, 3] frame, the tail does not blow it up', () => {
    const b = frameOf('y = e^x')
    expect(contains(b, { x: 0, y: 1 })).toBe(true)
    expect(contains(b, { x: 0, y: 0 })).toBe(true) // the asymptote y = 0
    expect(b.min.x).toBeGreaterThan(-4)
    expect(b.max.x).toBeLessThan(4)
    expect(width(b)).toBeGreaterThanOrEqual(5.9)
    expect(b.max.y).toBeLessThan(8) // e^3 ≈ 20 is clipped
  })

  it('2ˣ − 3: its zero log₂3, y-intercept and asymptote y = −3', () => {
    const b = frameOf('y = 2^x - 3')
    expect(contains(b, { x: Math.log2(3), y: 0 })).toBe(true)
    expect(contains(b, { x: 0, y: -2 })).toBe(true)
    expect(b.min.y).toBeLessThanOrEqual(-3)
    expect(b.min.y).toBeGreaterThan(-5)
    expect(b.max.y).toBeLessThan(8)
    expect(width(b)).toBeLessThan(8)
  })

  it('ln x: framed to the right of its pole, around its zero', () => {
    const b = frameOf('y = ln(x)')
    expect(contains(b, { x: 1, y: 0 })).toBe(true)
    expect(b.min.x).toBeGreaterThan(-1.5)
    expect(b.max.x).toBeGreaterThan(3)
    expect(b.max.x).toBeLessThan(8)
    expect(b.min.y).toBeGreaterThan(-6)
  })

  it('√x: from its end at the origin, to the right', () => {
    const b = frameOf('y = sqrt(x)')
    expect(contains(b, { x: 0, y: 0 })).toBe(true)
    expect(b.min.x).toBeGreaterThan(-1.5)
    expect(b.max.x).toBeGreaterThan(3)
    expect(b.max.y).toBeLessThan(4)
  })
})

describe('curveFeatureBox — poles, holes and periodic curves', () => {
  it('1/(x − 1): both branches near the pole, y clipped', () => {
    const b = frameOf('y = 1/(x - 1)')
    expect(b.min.x).toBeLessThan(0) // the left branch and its y-intercept (0, −1)
    expect(b.max.x).toBeGreaterThan(2) // the right branch
    expect(contains(b, { x: 0, y: -1 })).toBe(true)
    expect(contains(b, { x: 2, y: 1 })).toBe(true)
    expect(width(b)).toBeLessThan(9)
    expect(b.min.y).toBeGreaterThan(-8)
    expect(b.max.y).toBeLessThan(8)
  })

  it('(x² − 1)/(x − 1): the hole (1, 2) and the zero −1', () => {
    const b = frameOf('y = (x^2 - 1)/(x - 1)')
    expect(contains(b, { x: 1, y: 2 })).toBe(true)
    expect(contains(b, { x: -1, y: 0 })).toBe(true)
    expect(width(b)).toBeLessThan(8)
    expect(height(b)).toBeLessThan(10)
  })

  it('sin x: about two periods, y ≈ [−1.5, 1.5]', () => {
    const b = frameOf('y = sin(x)')
    expect(width(b)).toBeGreaterThan(2 * Math.PI)
    expect(width(b)).toBeLessThan(6 * Math.PI)
    expect(contains(b, { x: Math.PI / 2, y: 1 })).toBe(true)
    expect(contains(b, { x: -Math.PI / 2, y: -1 })).toBe(true)
    expect(b.min.y).toBeGreaterThan(-2)
    expect(b.min.y).toBeLessThan(-1)
    expect(b.max.y).toBeGreaterThan(1)
    expect(b.max.y).toBeLessThan(2)
  })

  it('sin x panned to x = 100: two periods there, not the whole search window', () => {
    const b = frameOf('y = sin(x)', { x: [91.5, 108.5], y: [-5.7, 5.7] })
    expect(b.min.x).toBeGreaterThan(85)
    expect(b.max.x).toBeLessThan(115)
    expect(width(b)).toBeLessThan(6 * Math.PI)
  })

  it('tan x: a few branches around the origin, y clipped', () => {
    const b = frameOf('y = tan(x)')
    expect(contains(b, { x: 0, y: 0 })).toBe(true)
    expect(b.min.x).toBeLessThan(-Math.PI / 2) // a pole either side
    expect(b.max.x).toBeGreaterThan(Math.PI / 2)
    expect(width(b)).toBeLessThan(6 * Math.PI)
    expect(height(b)).toBeLessThan(20)
  })
})

describe('curveFeatureBox — restricted, implicit and polar curves', () => {
  it('a typed restricted parabola frames the drawn piece', () => {
    const b = frameOf('y = x^2 {-2 < x < 3}')
    expect(contains(b, { x: -2, y: 4 })).toBe(true)
    expect(contains(b, { x: 3, y: 9 })).toBe(true)
    expect(contains(b, { x: 0, y: 0 })).toBe(true)
    expect(width(b)).toBeLessThan(9)
    expect(b.max.y).toBeLessThan(11)
  })

  it('a sketched parabola frames the ink’s x-range', () => {
    const results = drawAndRecognize(explicitPath((x) => 0.5 * x * x - 2), -3, 2.5, makeRng(7))
    const r = winner(results)
    const f: FittedCurve = {
      id: 'sk', modelId: r.modelId, params: r.params, kind: r.kind, domain: r.domain,
      color: CURVE_COLORS[0], strokeWidth: 2.5, visible: true, error: r.error,
    }
    expect(f.domain).not.toBeNull()
    const b = curveFeatureBox(f, MODELS, DEFAULT_WINDOW)!
    expect(b).not.toBeNull()
    expect(b.min.x).toBeLessThanOrEqual(-2.9)
    expect(b.max.x).toBeGreaterThanOrEqual(2.4)
    expect(width(b)).toBeLessThan(9)
    expect(contains(b, { x: 0, y: -2 })).toBe(true)
    expect(b.max.y).toBeGreaterThan(2.3) // the left end, ≈ (−3, 2.5)
    expect(b.max.y).toBeLessThan(5)
  })

  it('a typed circle x² + y² = 9 frames tightly', () => {
    const b = frameOf('x^2 + y^2 = 9', VIEW)
    expect(b.min.x).toBeCloseTo(-3, 1)
    expect(b.max.x).toBeCloseTo(3, 1)
    expect(b.min.y).toBeCloseTo(-3, 1)
    expect(b.max.y).toBeCloseTo(3, 1)
  })

  it('a sketched circle frames the whole circle, not just its ink', () => {
    const results = drawAndRecognize(
      (t) => ({ x: 1 + 2 * Math.cos(t), y: -1 + 2 * Math.sin(t) }),
      0,
      2 * Math.PI,
      makeRng(11),
    )
    const r = winner(results)
    expect(r.modelId).toBe('circle')
    const f: FittedCurve = {
      id: 'c', modelId: 'circle', params: r.params, kind: r.kind, domain: r.domain,
      color: CURVE_COLORS[0], strokeWidth: 2.5, visible: true, error: r.error,
      // only an arc of ink: the frame is the circle's, not the stroke's
      sourceStroke: [{ x: 3, y: -1 }, { x: 1, y: 1 }],
    }
    const b = curveFeatureBox(f, MODELS, VIEW)!
    expect(b.min.x).toBeCloseTo(-1, 0)
    expect(b.max.x).toBeCloseTo(3, 0)
    expect(b.min.y).toBeCloseTo(-3, 0)
    expect(b.max.y).toBeCloseTo(1, 0)
  })

  it('a polar rose r = 3cos 2θ: its sampled extent', () => {
    const f: FittedCurve = {
      id: 'p', modelId: 'polarRose', params: [3, 2, 0], kind: 'polar', domain: null,
      color: CURVE_COLORS[0], strokeWidth: 2.5, visible: true, error: 0,
    }
    const b = curveFeatureBox(f, MODELS, VIEW)!
    expect(b.min.x).toBeCloseTo(-3, 1)
    expect(b.max.x).toBeCloseTo(3, 1)
    expect(b.min.y).toBeGreaterThan(-3.1)
    expect(b.max.y).toBeLessThan(3.1)
    expect(height(b)).toBeGreaterThan(3)
  })
})

describe('curvesFeatureBox — several curves', () => {
  it('the union of each curve’s frame; hidden curves frame nothing', () => {
    const a = typed('y = x^2 - 4', 'a')
    const c = typed('y = x^2 + 100', 'c')
    const e = typed('y = e^x', 'e')
    const models = { ...a.models, ...c.models, ...e.models }
    const both = curvesFeatureBox([a.f, e.f, { ...c.f, visible: false }], models, DEFAULT_WINDOW)!
    const pa = curveFeatureBox(a.f, models, DEFAULT_WINDOW)!
    const pe = curveFeatureBox(e.f, models, DEFAULT_WINDOW)!
    expect(both.min.x).toBeCloseTo(Math.min(pa.min.x, pe.min.x), 9)
    expect(both.max.x).toBeCloseTo(Math.max(pa.max.x, pe.max.x), 9)
    expect(both.min.y).toBeCloseTo(Math.min(pa.min.y, pe.min.y), 9)
    expect(both.max.y).toBeCloseTo(Math.max(pa.max.y, pe.max.y), 9)
    expect(both.max.y).toBeLessThan(10) // the hidden x² + 100 is not in it
    expect(curvesFeatureBox([{ ...a.f, visible: false }], models, DEFAULT_WINDOW)).toBeNull()
  })
})

describe('the reported board: y = x² − 4 with a Riemann sum on [0, 3]', () => {
  it('frames the parabola and the rectangles, nowhere near ±65', () => {
    const { f, models } = typed('y = x^2 - 4')
    const links: CalcLink[] = [
      { kind: 'riemann', id: 'R', parentId: 'f', from: 0, to: 3, n: 6, method: 'left' },
    ]
    const box = withPoints(curvesFeatureBox([f], models, DEFAULT_WINDOW), calcFramePoints(links, [f], models))!
    expect(contains(box, { x: 3, y: 5 })).toBe(true)
    expect(contains(box, { x: 0, y: -4 })).toBe(true)
    expect(box.min.x).toBeGreaterThan(-5)
    expect(box.max.x).toBeLessThan(5)
    expect(box.max.y).toBeLessThan(8)
  })
})

describe('calcFramePoints — interval links', () => {
  it('an area to the x-axis: both ends on the curve and on the axis', () => {
    const { f, models } = typed('y = x^2')
    const pts = calcFramePoints([{ kind: 'area', id: 'A', parentId: 'f', from: 1, to: 2, abs: false }], [f], models)
    expect(pts).toEqual([{ x: 1, y: 1 }, { x: 2, y: 4 }, { x: 1, y: 0 }, { x: 2, y: 0 }])
  })

  it('an area between curves: both curves’ ends, not the axis', () => {
    const a = typed('y = x^2', 'f')
    const b = typed('y = x + 6', 'g')
    const models = { ...a.models, ...b.models }
    const pts = calcFramePoints(
      [{ kind: 'area', id: 'A', parentId: 'f', otherId: 'g', from: -2, to: 3, abs: false }],
      [a.f, b.f],
      models,
    )
    expect(pts).toEqual([{ x: -2, y: 4 }, { x: 3, y: 9 }, { x: -2, y: 4 }, { x: 3, y: 9 }])
  })

  it('a Riemann sum’s interval reaches the axis', () => {
    const { f, models } = typed('y = x^2 - 4')
    const pts = calcFramePoints(
      [{ kind: 'riemann', id: 'R', parentId: 'f', from: 0, to: 3, n: 4, method: 'left' }],
      [f],
      models,
    )
    expect(pts).toEqual([{ x: 0, y: -4 }, { x: 3, y: 5 }, { x: 0, y: 0 }, { x: 3, y: 0 }])
  })

  it('a solid of revolution about the x-axis: the region and its mirror', () => {
    const { f, models } = typed('y = 1/x')
    const pts = calcFramePoints(
      [{ kind: 'volume', id: 'V', parentId: 'f', a: 1, b: 2, method: 'washer' }],
      [f],
      models,
    )
    const box = withPoints(null, pts)!
    expect(box).toEqual({ min: { x: 1, y: -1 }, max: { x: 2, y: 1 } })
  })

  it('an accumulation: its lower limit and probe, down to the axis', () => {
    const { f, models } = typed('y = x + 1')
    const pts = calcFramePoints(
      [{ kind: 'accumulation', id: 'G', parentId: 'f', curveId: 'g', a: -1, C: 0, x: 4 }],
      [f],
      models,
    )
    expect(pts).toEqual([{ x: -1, y: 0 }, { x: 4, y: 5 }, { x: -1, y: 0 }, { x: 4, y: 0 }])
    const noProbe = calcFramePoints(
      [{ kind: 'accumulation', id: 'G', parentId: 'f', curveId: 'g', a: 2, C: 0 }],
      [f],
      models,
    )
    expect(noProbe).toEqual([{ x: 2, y: 3 }])
  })
})

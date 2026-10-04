// "Fit to curves" frames more than curves: the step points of Euler paths and
// the key points of secant, Taylor and limit overlays — and exactly what it
// always framed when there are none.
import { describe, expect, it } from 'vitest'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { CURVE_COLORS } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { parseExpression } from '../src/core/parse'
import { FIELD_SPACING_DEFAULT } from '../src/core/persist'
import type { BoardField, CalcLink } from '../src/core/persist'
import { compileFields } from '../src/ui/fieldLinks'
import { eulerFramePoints, eulerScene } from '../src/ui/eulerLinks'
import { calcFramePoints, withPoints } from '../src/ui/viewScale'
import type { Box } from '../src/ui/viewScale'
import { unionBoxes } from '../src/ui/curveState'

function typed(src: string, id = 'f'): { f: FittedCurve; models: Record<string, ModelSpec> } {
  const out = parseExpression(src)
  if (!out.ok) throw new Error(out.error)
  const spec = out.plot.makeModel('expr_1')
  return {
    f: {
      id,
      modelId: 'expr_1',
      params: out.plot.defaultParams.slice(),
      kind: 'explicit',
      domain: null,
      color: CURVE_COLORS[0],
      strokeWidth: 2.5,
      visible: true,
      error: 0,
    },
    models: { ...MODELS, expr_1: spec },
  }
}

const field = (over: Partial<BoardField> = {}): BoardField => ({
  id: 'F1',
  src: 'dy/dx = x + y',
  params: [],
  color: CURVE_COLORS[0],
  spacingPx: FIELD_SPACING_DEFAULT,
  visible: true,
  solutions: [],
  ...over,
})

describe('withPoints — the fit box grown to take in extra points', () => {
  const BOX: Box = { min: { x: -2, y: -1 }, max: { x: 2, y: 3 } }

  it('nothing to add: the very same box, and null stays null', () => {
    expect(withPoints(BOX, [])).toBe(BOX)
    expect(withPoints(null, [])).toBeNull()
    expect(withPoints(BOX, [{ x: Number.NaN, y: 1 }, { x: 1, y: Infinity }])).toBe(BOX)
  })

  it('points inside the box change nothing', () => {
    expect(withPoints(BOX, [{ x: 0, y: 0 }, { x: 2, y: 3 }])).toEqual(BOX)
  })

  it('points outside the curves’ extent widen the frame, without touching the input', () => {
    const out = withPoints(BOX, [{ x: 5, y: -4 }])
    expect(out).toEqual({ min: { x: -2, y: -4 }, max: { x: 5, y: 3 } })
    expect(BOX).toEqual({ min: { x: -2, y: -1 }, max: { x: 2, y: 3 } })
  })

  it('an asymptote running away is not part of the figure', () => {
    expect(withPoints(BOX, [{ x: 0, y: 1e9 }])).toBe(BOX)
  })
})

describe('a board with only a slope field and an Euler path', () => {
  it('frames the path', () => {
    // dy/dx = x + y from (0, 1), h = 0.5, n = 4: y = 1, 1.5, 2.5, 4.25, 7.125
    const f = field({ eulers: [{ id: 'E1', x0: 0, y0: 1, h: 0.5, n: 4 }] })
    const { paths, polylines } = eulerScene([f], compileFields([f]), [-10, 10])
    expect(polylines).toEqual([])
    const box = withPoints(unionBoxes([]), eulerFramePoints(paths))
    expect(box).not.toBeNull()
    expect(box!.min.x).toBeCloseTo(0, 12)
    expect(box!.max.x).toBeCloseTo(2, 12)
    expect(box!.min.y).toBeCloseTo(1, 12)
    expect(box!.max.y).toBeCloseTo(7.125, 12)
  })

  it('a hidden field frames nothing', () => {
    const f = field({ visible: false, eulers: [{ id: 'E1', x0: 0, y0: 1, h: 0.5, n: 4 }] })
    const { paths } = eulerScene([f], compileFields([f]), [-10, 10])
    expect(eulerFramePoints(paths)).toEqual([])
  })
})

describe('calcFramePoints — what the overlays are about', () => {
  it('a secant’s two points and a Taylor centre, on the curve', () => {
    const { f, models } = typed('y = x^2')
    const links: CalcLink[] = [
      { kind: 'secant', id: 'S', parentId: 'f', a: 1, b: 9 },
      { kind: 'taylor', id: 'T', parentId: 'f', curveId: 'p', a: -6, n: 2 },
    ]
    expect(calcFramePoints(links, [f], models)).toEqual([
      { x: 1, y: 1 },
      { x: 9, y: 81 },
      { x: -6, y: 36 },
    ])
  })

  it('a limit’s (a, L) — at a hole, L and not f(a)', () => {
    const { f, models } = typed('y = (x^2 - 4)/(x - 2)')
    const pts = calcFramePoints([{ kind: 'limit', id: 'L', parentId: 'f', a: 2 }], [f], models)
    expect(pts).toHaveLength(1)
    expect(pts[0].x).toBe(2)
    expect(pts[0].y).toBeCloseTo(4, 6)
  })

  it('nothing at ±∞, for a hidden curve, or for other links', () => {
    const { f, models } = typed('y = 1/x')
    expect(calcFramePoints([{ kind: 'limit', id: 'L', parentId: 'f', a: Infinity }], [f], models)).toEqual([])
    const hidden = { ...f, visible: false }
    expect(calcFramePoints([{ kind: 'secant', id: 'S', parentId: 'f', a: 1, b: 2 }], [hidden], models)).toEqual([])
    // (a solid's interval IS framed now — tests/fitFrame.test.ts; a sign
    // chart has no point of its own to frame)
    expect(
      calcFramePoints([{ kind: 'signchart', id: 'C', parentId: 'f', rows: ['f'] }], [f], models),
    ).toEqual([])
  })

  it('a secant whose point is off the curves’ window widens the fit', () => {
    const { f, models } = typed('y = x^2')
    const curves: Box = { min: { x: -8, y: 0 }, max: { x: 8, y: 64 } }
    const pts = calcFramePoints([{ kind: 'secant', id: 'S', parentId: 'f', a: 1, b: 12 }], [f], models)
    expect(withPoints(curves, pts)).toEqual({ min: { x: -8, y: 0 }, max: { x: 12, y: 144 } })
  })
})

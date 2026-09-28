// ============================================================================
// tests/mvt.test.ts — the core of the secant link (src/core/mvt.ts): the
// average rate of change, the two hypotheses of the Mean Value Theorem, every
// c with f′(c) = m (Rolle's theorem included), and the average value with its
// c's — on typed lines, library families and polynomials.
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { CURVE_COLORS } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { parseExpression } from '../src/core/parse'
import {
  averageValue,
  continuityOn,
  differentiabilityOn,
  mvtPoints,
  mvtSourceOf,
  polyIntegral,
  secantOf,
} from '../src/core/mvt'
import type { MvtSource } from '../src/core/mvt'

const curve = (modelId: string, params: number[], over: Partial<FittedCurve> = {}): FittedCurve => ({
  id: 'f',
  modelId,
  params,
  kind: 'explicit',
  domain: null,
  color: CURVE_COLORS[0],
  strokeWidth: 2.5,
  visible: true,
  error: 0,
  ...over,
})

/** A typed line, read the way the board reads it. */
function typed(src: string, domain: [number, number] | null = null): MvtSource {
  const out = parseExpression(src)
  if (!out.ok) throw new Error(out.error)
  const spec = out.plot.makeModel('expr_1')
  const models: Record<string, ModelSpec> = { ...MODELS, expr_1: spec }
  const s = mvtSourceOf(curve('expr_1', out.plot.defaultParams.slice(), { domain }), models)
  if (!s) throw new Error('no source')
  return s
}

/** A library family, as a sketch is. */
function family(modelId: string, params: number[], domain: [number, number] | null = null): MvtSource {
  const s = mvtSourceOf(curve(modelId, params, { domain }), MODELS)
  if (!s) throw new Error('no source')
  return s
}

const xs = (points: { x: number }[]): number[] => points.map((p) => p.x)
const texts = (points: { exact: { text: string } | null }[]): (string | null)[] =>
  points.map((p) => (p.exact ? p.exact.text : null))

// ===========================================================================
// The secant
// ===========================================================================

describe('secantOf', () => {
  it('x² on [1, 3]: f(1) = 1, f(3) = 9, slope 4', () => {
    const s = secantOf(typed('y = x^2'), 1, 3)!
    expect(s).toMatchObject({ a: 1, b: 3, fa: 1, fb: 9, m: 4, rolle: false })
  })

  it('sin x on [0, π]: f(π) is exactly 0, so the slope is exactly 0 (Rolle)', () => {
    const s = secantOf(typed('y = sin(x)'), 0, Math.PI)!
    expect(s.rolle).toBe(true)
    expect(s.m).toBe(0)
    expect(s.fb).toBe(0)
  })

  it('refuses where f is undefined at an end, or a = b', () => {
    expect(secantOf(typed('y = 1/x'), 0, 1)).toBeNull()
    expect(secantOf(typed('y = x^2'), 2, 2)).toBeNull()
    expect(secantOf(family('poly2', [0, 0, 1], [-1, 1]), 0, 2)).toBeNull()
  })
})

// ===========================================================================
// The hypotheses
// ===========================================================================

describe('continuityOn [a, b]', () => {
  it('a polynomial is continuous everywhere', () => {
    expect(continuityOn(typed('y = x^3'), -2, 2)).toEqual([])
  })

  it('1/x on [−1, 1]: a vertical asymptote at 0', () => {
    const c = continuityOn(typed('y = 1/x'), -1, 1)
    expect(c).toHaveLength(1)
    expect(c[0].kind).toBe('pole')
    expect(c[0].x).toBe(0)
    expect(c[0].exact?.text).toBe('0')
  })

  it('tan x on [0, 2]: the asymptote at π/2, named exactly', () => {
    const c = continuityOn(typed('y = tan(x)'), 0, 2)
    expect(c.map((f) => f.kind)).toEqual(['pole'])
    expect(c[0].exact?.text).toBe('π/2')
  })

  it('floor x on [0.5, 2.5]: jumps at 1 and 2', () => {
    const c = continuityOn(typed('y = floor(x)'), 0.5, 2.5)
    expect(c.map((f) => [f.kind, f.x])).toEqual([
      ['jump', 1],
      ['jump', 2],
    ])
  })

  it('sin(x)/x on [−1, 2]: undefined at 0 — a removable discontinuity', () => {
    const c = continuityOn(typed('y = sin(x)/x'), -1, 2)
    expect(c.map((f) => [f.kind, f.x])).toEqual([['hole', 0]])
  })

  it('√x on [0, 4] is continuous: at an end only the inside counts', () => {
    expect(continuityOn(typed('y = sqrt(x)'), 0, 4)).toEqual([])
  })

  it('∛x is continuous at 0, however slowly it gets there', () => {
    expect(continuityOn(typed('y = x^(1/3)'), -1, 1)).toEqual([])
  })

  it('ln x on [−1, 2]: undefined over a whole stretch', () => {
    const c = continuityOn(typed('y = ln(x)'), -1, 2)
    expect(c[0].kind).toBe('undefined')
    expect(c[0].x).toBe(-1)
    expect(c[0].to).toBe(0)
  })

  it('an interval past the end of a sketch is outside the domain', () => {
    const c = continuityOn(family('poly3', [0, -1, 0, 1], [-1.7, 2.4]), -2, 2)
    expect(c).toEqual([{ kind: 'domain', x: -2, exact: expect.objectContaining({ text: '−2' }) }])
  })

  it('a continuous piecewise line is continuous; a broken one jumps', () => {
    expect(continuityOn(typed('y = {x^2 if x < 1, 2x - 1 if x >= 1}'), 0, 2)).toEqual([])
    const c = continuityOn(typed('y = {x if x < 1, x + 1 if x >= 1}'), 0, 2)
    expect(c.map((f) => [f.kind, f.x])).toEqual([['jump', 1]])
  })

  it('the recip family: its pole from the params', () => {
    const c = continuityOn(family('recip', [1, 0.3, 0]), -1, 1)
    expect(c.map((f) => f.kind)).toEqual(['pole'])
    expect(c[0].x).toBeCloseTo(0.3, 12)
  })
})

describe('differentiabilityOn (a, b)', () => {
  it('|x| on [−1, 2]: a corner at 0, the one-sided slopes −1 and 1', () => {
    const d = differentiabilityOn(typed('y = abs(x)'), -1, 2)
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ kind: 'corner', x: 0 })
    expect(d[0].left).toBeCloseTo(-1, 6)
    expect(d[0].right).toBeCloseTo(1, 6)
  })

  it('|x² − 1| on [−2, 2]: corners at ±1', () => {
    const d = differentiabilityOn(typed('y = abs(x^2 - 1)'), -2, 2)
    expect(d.map((f) => [f.kind, f.x])).toEqual([
      ['corner', -1],
      ['corner', 1],
    ])
  })

  it('∛x has a vertical tangent at 0; x^(2/3) a cusp', () => {
    expect(differentiabilityOn(typed('y = x^(1/3)'), -1, 1).map((f) => [f.kind, f.x])).toEqual([['vertical', 0]])
    expect(differentiabilityOn(typed('y = x^(2/3)'), -1, 8).map((f) => [f.kind, f.x])).toEqual([['cusp', 0]])
  })

  it('smooth functions have nothing to report', () => {
    for (const [src, a, b] of [
      ['y = x^3', -2, 2],
      ['y = sin(x)', 0, Math.PI],
      ['y = e^x', -1, 3],
      ['y = sqrt(x)', 0, 4],
      ['y = {x^2 if x < 1, 2x - 1 if x >= 1}', 0, 2],
      ['y = 1/(1 + 25x^2)', -1, 1],
    ] as [string, number, number][]) {
      expect(differentiabilityOn(typed(src), a, b), src).toEqual([])
    }
  })

  it('a jump is continuity’s to report, not a corner', () => {
    expect(differentiabilityOn(typed('y = floor(x)'), 0.5, 2.5)).toEqual([])
  })

  it('the abs FAMILY (a sketch) off the grid: the corner at its own vertex', () => {
    const d = differentiabilityOn(family('abs', [1.2, 0.37, -1]), -1, 2)
    expect(d).toHaveLength(1)
    expect(d[0].kind).toBe('corner')
    expect(d[0].x).toBeCloseTo(0.37, 9)
  })
})

// ===========================================================================
// The Mean Value Theorem
// ===========================================================================

describe('mvtPoints', () => {
  it('x² on [1, 3]: c = 2', () => {
    const r = mvtPoints(typed('y = x^2'), 1, 3, 4)
    expect(xs(r.points)).toEqual([2])
    expect(texts(r.points)).toEqual(['2'])
  })

  it('x³ on [−2, 2]: c = ±2√3/3', () => {
    const f = typed('y = x^3')
    const s = secantOf(f, -2, 2)!
    expect(s.m).toBe(4)
    const r = mvtPoints(f, -2, 2, s.m)
    expect(texts(r.points)).toEqual(['−2√3/3', '2√3/3'])
    expect(r.points[1].x).toBeCloseTo(2 / Math.sqrt(3), 14)
  })

  it('sin x on [0, π]: Rolle, c = π/2', () => {
    const f = typed('y = sin(x)')
    const s = secantOf(f, 0, Math.PI)!
    expect(s.rolle).toBe(true)
    const r = mvtPoints(f, 0, Math.PI, s.m)
    expect(texts(r.points)).toEqual(['π/2'])
  })

  it('|x| on [−1, 2]: no c at all — the corner is not a root of f′ − 1/3', () => {
    expect(mvtPoints(typed('y = abs(x)'), -1, 2, 1 / 3).points).toEqual([])
  })

  it('a c that exists without the hypotheses is still reported: ∛x on [−1, 1]', () => {
    const r = mvtPoints(typed('y = x^(1/3)'), -1, 1, 1)
    expect(texts(r.points)).toEqual(['−√3/9', '√3/9'])
  })

  it('c is strictly inside: x³ on [−2, 1] has c = −1 only', () => {
    const r = mvtPoints(typed('y = x^3'), -2, 1, 3)
    expect(xs(r.points)).toEqual([-1])
  })

  it('a line: every c works', () => {
    const r = mvtPoints(typed('y = 2x + 1'), 0, 3, 2)
    expect(r.all).toBe(true)
  })

  it('sketched families: a parabola, a sine, a cube root with surds for c', () => {
    expect(texts(mvtPoints(family('poly2', [0, 0, 1]), 0, 3, 3).points)).toEqual(['3/2'])
    expect(texts(mvtPoints(family('sine', [2, 1, 0, 0]), 0, Math.PI, 0).points)).toEqual(['π/2'])
    const cb = family('cbrt', [1, 0.5, 0])
    const s = secantOf(cb, -1, 2)!
    expect(texts(mvtPoints(cb, -1, 2, s.m).points)).toEqual(['(3−√3)/6', '(3+√3)/6'])
  })

  it('e^x on [0, 1]: c = ln(e − 1), a decimal', () => {
    const r = mvtPoints(typed('y = e^x'), 0, 1, Math.E - 1)
    expect(r.points).toHaveLength(1)
    expect(r.points[0].exact).toBeNull()
    expect(r.points[0].x).toBeCloseTo(Math.log(Math.E - 1), 10)
  })
})

// ===========================================================================
// Average value
// ===========================================================================

describe('averageValue', () => {
  it('x² on [0, 3]: f_avg = 3, exactly, at c = √3', () => {
    const r = averageValue(typed('y = x^2'), 0, 3)!
    expect(r.value).toBe(3)
    expect(r.exact).toBe(true)
    expect(r.integral).toBeCloseTo(9, 12)
    expect(texts(r.points)).toEqual(['√3'])
  })

  it('the parabola family too', () => {
    const r = averageValue(family('poly2', [0, 0, 1]), 0, 3)!
    expect(r.value).toBe(3)
    expect(texts(r.points)).toEqual(['√3'])
  })

  it('x² on [1, 3]: 13/3 at c = √39/3', () => {
    const r = averageValue(typed('y = x^2'), 1, 3)!
    expect(r.form?.text).toBe('13/3')
    expect(texts(r.points)).toEqual(['√39/3'])
  })

  it('sin x on [0, π]: 2/π, measured, at two c', () => {
    const r = averageValue(typed('y = sin(x)'), 0, Math.PI)!
    expect(r.value).toBeCloseTo(2 / Math.PI, 9)
    expect(r.points).toHaveLength(2)
    expect(r.points[0].x).toBeCloseTo(Math.asin(2 / Math.PI), 8)
  })

  it('x³ on [−2, 2]: 0, at c = 0', () => {
    const r = averageValue(typed('y = x^3'), -2, 2)!
    expect(r.value).toBe(0)
    expect(texts(r.points)).toEqual(['0'])
  })

  it('floor x on [0.5, 2.5]: 1, on the whole step [1, 2)', () => {
    const r = averageValue(typed('y = floor(x)'), 0.5, 2.5)!
    expect(r.value).toBeCloseTo(1, 9)
    expect(r.points).toHaveLength(1)
    expect(r.points[0].x).toBe(1)
    expect(r.points[0].to).toBe(2)
  })

  it('no integral across a pole, or off the sketch', () => {
    expect(averageValue(typed('y = 1/x'), -1, 1)).toBeNull()
    expect(averageValue(family('poly2', [0, 0, 1], [-1, 1]), 0, 2)).toBeNull()
  })

  it('polyIntegral is the antiderivative, exactly', () => {
    expect(polyIntegral([0, 0, 1], 0, 3)).toBe(9)
    expect(polyIntegral([1, 2, 3], -1, 2)).toBe(3 + 3 + 9)
  })
})

describe('mvtSourceOf — a piecewise line is not read as its polynomial', () => {
  it('x² with f(2) defined apart: f(2) is the separate value, not 4', async () => {
    const { parseExpression } = await import('../src/core/parse')
    const { mvtSourceOf } = await import('../src/core/mvt')
    const r = parseExpression('y = piecewise(x^2, x != 2, 5, x = 2)')
    if (!r.ok) throw new Error(r.error)
    const models = { m: r.plot.makeModel('m') }
    const src = mvtSourceOf(
      { id: 'c', modelId: 'm', params: [], kind: 'explicit', domain: r.plot.domain, color: '#fff', strokeWidth: 2, visible: true, error: 0 },
      models,
    )!
    expect(src.poly).toBeNull()
    expect(src.f(2)).toBe(5)
    expect(src.f(3)).toBe(9)
  })

  it('a restricted x² is undefined outside its restriction', async () => {
    const { parseExpression } = await import('../src/core/parse')
    const { mvtSourceOf } = await import('../src/core/mvt')
    const r = parseExpression('y = x^2 {x >= 0}')
    if (!r.ok) throw new Error(r.error)
    const models = { m: r.plot.makeModel('m') }
    const src = mvtSourceOf(
      { id: 'c', modelId: 'm', params: [], kind: 'explicit', domain: r.plot.domain, color: '#fff', strokeWidth: 2, visible: true, error: 0 },
      models,
    )!
    expect(src.f(-1)).toBeNaN()
    expect(src.f(2)).toBe(4)
  })
})

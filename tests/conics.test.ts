import { describe, expect, it } from 'vitest'
import {
  classify,
  conicFeatures,
  conicFromCircle,
  conicFromEllipse,
  conicFromFoci,
  conicFromHyperbola,
  conicFromParabola,
  conicSource,
  readConic,
  type Built,
  type ConicSpec,
} from '../src/core/conics'
import { parseExpression } from '../src/core/parse'
import { makeRng } from './helpers'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Constant string → number, through the app's own parser. */
function val(s: string | undefined): number {
  const o = parseExpression(s ?? '0')
  if (!o.ok) throw new Error(`not a constant: ${s}`)
  return o.plot.makeModel('v').evalExplicit!(o.plot.defaultParams, 0)
}

/** A typed source as the implicit F(x, y) the plotter contours. */
function implicitOf(src: string): (x: number, y: number) => number {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(`${src}: ${o.error}`)
  expect(o.plot.kind, src).toBe('implicit')
  expect(o.plot.paramNames, src).toEqual([])
  const m = o.plot.makeModel('t')
  return (x, y) => m.evalImplicit!(o.plot.defaultParams, x, y)
}

/** Points on the conic, straight from the spec's numbers (parametrised). */
function pointsOn(s: ConicSpec): [number, number][] {
  const h = val(s.h), k = val(s.k)
  const ts = Array.from({ length: 16 }, (_, i) => -2.9 + i * 0.39)
  switch (s.kind) {
    case 'circle': {
      const r = val(s.a)
      return ts.map((t) => [h + r * Math.cos(t), k + r * Math.sin(t)])
    }
    case 'ellipse': {
      const a = val(s.a), b = val(s.b)
      return ts.map((t) => [h + a * Math.cos(t), k + b * Math.sin(t)])
    }
    case 'hyperbola': {
      const a = val(s.a), b = val(s.b)
      return ts.flatMap((u): [number, number][] => {
        const ch = Math.cosh(u / 1.5), sh = Math.sinh(u / 1.5)
        return s.opens === 'y'
          ? [[h + b * sh, k + a * ch], [h + b * sh, k - a * ch]]
          : [[h + a * ch, k + b * sh], [h - a * ch, k + b * sh]]
      })
    }
    case 'parabola': {
      const p = val(s.p)
      return ts.map((t) => (s.opens === 'x' ? [h + (t * t) / (4 * p), k + t] : [h + t, k + (t * t) / (4 * p)]))
    }
  }
}

/** conicSource parses as an implicit curve whose zero set is the spec's conic. */
function expectSourceIsConic(s: ConicSpec): string {
  const src = conicSource(s)
  const F = implicitOf(src)
  for (const [x, y] of pointsOn(s)) {
    const v = F(x, y)
    expect(Math.abs(v), `${src} at (${x}, ${y})`).toBeLessThanOrEqual(1e-9 * (1 + x * x + y * y))
  }
  // and a point well off the curve is not on it
  const h = val(s.h), k = val(s.k)
  const off =
    s.kind === 'parabola'
      ? (s.opens === 'x' ? F(h + val(s.p), k) : F(h, k + val(s.p))) // the focus
      : s.kind === 'hyperbola'
        ? F(h, k) // the center
        : F(h + 1.7 * val(s.a), k + 1.3 * val(s.b ?? s.a))
  expect(Math.abs(off), `${src} off the curve`).toBeGreaterThan(1e-3)
  return src
}

const isSpec = (b: Built): b is ConicSpec => !('error' in b)

// ---------------------------------------------------------------------------
// conicSource
// ---------------------------------------------------------------------------

describe('conicSource', () => {
  const table: [ConicSpec, string][] = [
    [{ kind: 'ellipse', h: '2', k: '-1', a: '3', b: '2' }, '(x - 2)^2/9 + (y + 1)^2/4 = 1'],
    [{ kind: 'ellipse', h: '2', k: '-1', a: '2', b: '3' }, '(x - 2)^2/4 + (y + 1)^2/9 = 1'],
    [{ kind: 'ellipse', h: '0', k: '0', a: '1', b: 'sqrt(5)' }, 'x^2 + y^2/5 = 1'],
    [{ kind: 'ellipse', h: '1/2', k: '-3/2', a: '3/2', b: '2.5' }, '(x - 1/2)^2/(9/4) + (y + 3/2)^2/6.25 = 1'],
    [{ kind: 'ellipse', h: '1+sqrt(2)', k: '0', a: '2sqrt(3)', b: '1' }, '(x - (1+sqrt(2)))^2/12 + y^2 = 1'],
    [{ kind: 'circle', h: '1', k: '0', a: '4' }, '(x - 1)^2 + y^2 = 16'],
    [{ kind: 'circle', h: '0', k: '0', a: '5' }, 'x^2 + y^2 = 25'],
    [{ kind: 'circle', h: '-2', k: '3', a: 'sqrt(7)' }, '(x + 2)^2 + (y - 3)^2 = 7'],
    [{ kind: 'hyperbola', h: '0', k: '3', a: '4', b: '3', opens: 'y' }, '(y - 3)^2/16 - x^2/9 = 1'],
    [{ kind: 'hyperbola', h: '2', k: '-1', a: '3', b: '2', opens: 'x' }, '(x - 2)^2/9 - (y + 1)^2/4 = 1'],
    [{ kind: 'hyperbola', h: '0', k: '0', a: '1', b: '1', opens: 'x' }, 'x^2 - y^2 = 1'],
    [{ kind: 'parabola', h: '-2', k: '1', a: '2', opens: 'y', p: '2' }, '(x + 2)^2 = 8(y - 1)'],
    [{ kind: 'parabola', h: '0', k: '0', a: '-3', opens: 'x', p: '-3' }, 'y^2 = -12x'],
    [{ kind: 'parabola', h: '1', k: '-2', a: '-1/4', opens: 'y', p: '-1/4' }, '(x - 1)^2 = -(y + 2)'],
    [{ kind: 'parabola', h: '3', k: '0', a: '1/8', opens: 'x', p: '1/8' }, 'y^2 = (1/2)(x - 3)'],
    [{ kind: 'parabola', h: '0', k: '2', a: '0.3', opens: 'x', p: '0.3' }, '(y - 2)^2 = 1.2x'],
    [{ kind: 'parabola', h: '0', k: '0', a: 'sqrt(2)', opens: 'y', p: 'sqrt(2)' }, 'x^2 = (4sqrt(2))y'],
    // 4p = 1 with k = 0 would read as the FUNCTION y = x²: written 1y
    [{ kind: 'parabola', h: '2', k: '0', a: '1/4', opens: 'y', p: '1/4' }, '(x - 2)^2 = 1y'],
  ]
  it.each(table)('%j → %s', (spec, want) => {
    expect(conicSource(spec)).toBe(want)
    expectSourceIsConic(spec)
  })
})

// ---------------------------------------------------------------------------
// readConic
// ---------------------------------------------------------------------------

describe('readConic', () => {
  const standard: [string, ConicSpec][] = [
    ['(x-2)^2/9 + (y+1)^2/4 = 1', { kind: 'ellipse', h: '2', k: '-1', a: '3', b: '2' }],
    ['(y+1)^2/4 + (x-2)^2/9 = 1', { kind: 'ellipse', h: '2', k: '-1', a: '3', b: '2' }],
    ['1 = x^2/4 + y^2/9', { kind: 'ellipse', h: '0', k: '0', a: '2', b: '3' }],
    ['4(x-1)^2 + 9(y-2)^2 = 36', { kind: 'ellipse', h: '1', k: '2', a: '3', b: '2' }],
    ['x^2 + y^2 = 25', { kind: 'circle', h: '0', k: '0', a: '5' }],
    ['x^2 + y^2 = 5^2', { kind: 'circle', h: '0', k: '0', a: '5' }],
    ['(x - 1)^2 + y^2 = 16', { kind: 'circle', h: '1', k: '0', a: '4' }],
    ['x² + (y − 2)² = 8', { kind: 'circle', h: '0', k: '2', a: '2sqrt(2)' }],
    ['(x-1)^2/4 + (y-2)^2/4 = 1', { kind: 'circle', h: '1', k: '2', a: '2' }],
    ['(y - 3)^2/16 - x^2/9 = 1', { kind: 'hyperbola', h: '0', k: '3', a: '4', b: '3', opens: 'y' }],
    ['-y^2/4 + (x-2)^2/9 = 1', { kind: 'hyperbola', h: '2', k: '0', a: '3', b: '2', opens: 'x' }],
    ['(x + 2)^2 = 8(y - 1)', { kind: 'parabola', h: '-2', k: '1', a: '2', opens: 'y', p: '2' }],
    ['y^2 = -12x', { kind: 'parabola', h: '0', k: '0', a: '-3', opens: 'x', p: '-3' }],
    ['8(x - 2) = (y - 1)^2', { kind: 'parabola', h: '2', k: '1', a: '2', opens: 'x', p: '2' }],
    ['(x-2.5)^2/6.25 + (y+1/2)^2/(9/4) = 1', { kind: 'ellipse', h: '2.5', k: '-1/2', a: '2.5', b: '3/2' }],
    ['(x - sqrt(2))^2 + y^2/5 = 1', { kind: 'ellipse', h: 'sqrt(2)', k: '0', a: '1', b: 'sqrt(5)' }],
    ['(x - 2)^2 = 1y', { kind: 'parabola', h: '2', k: '0', a: '1/4', opens: 'y', p: '1/4' }],
    ['x^2/7.3 + y^2 = 1', { kind: 'ellipse', h: '0', k: '0', a: 'sqrt(7.3)', b: '1' }],
    // far from the origin: Q(h, k) comes from the typed expression, not from D²/4A + E²/4C − F
    ['(x-12345)^2/9 + (y-678)^2/4 = 1', { kind: 'ellipse', h: '12345', k: '678', a: '3', b: '2' }],
    ['(x - 1000)^2 + (y + 500)^2 = 1/100', { kind: 'circle', h: '1000', k: '-500', a: '1/10' }],
  ]
  it.each(standard)('standard form %s', (src, want) => {
    expect(readConic(src)).toEqual(want)
  })

  const general: [string, ConicSpec][] = [
    // the classic: complete the square twice
    ['x^2 + y^2 - 4x + 6y - 3 = 0', { kind: 'circle', h: '2', k: '-3', a: '4' }],
    ['x^2 + y^2 - 4x + 6y - 3', { kind: 'circle', h: '2', k: '-3', a: '4' }],
    ['x^2 - 4x = 3 - y^2 - 6y', { kind: 'circle', h: '2', k: '-3', a: '4' }],
    ['2x^2 + 2y^2 - 8x + 12y - 6 = 0', { kind: 'circle', h: '2', k: '-3', a: '4' }],
    ['9x^2 + 4y^2 - 36x + 8y + 4 = 0', { kind: 'ellipse', h: '2', k: '-1', a: '2', b: '3' }],
    ['4x^2 - 9y^2 - 16x - 18y - 29 = 0', { kind: 'hyperbola', h: '2', k: '-1', a: '3', b: '2', opens: 'x' }],
    ['9y^2 - 4x^2 - 18y - 16x - 43 = 0', { kind: 'hyperbola', h: '-2', k: '1', a: '2', b: '3', opens: 'y' }],
    ['y^2 - 8x - 2y + 17 = 0', { kind: 'parabola', h: '2', k: '1', a: '2', opens: 'x', p: '2' }],
    ['x^2 + 6x - 4y + 1 = 0', { kind: 'parabola', h: '-3', k: '-2', a: '1', opens: 'y', p: '1' }],
    ['x^2 + 3x + y^2 = 0', { kind: 'circle', h: '-3/2', k: '0', a: '3/2' }],
    ['x^2 + 4y^2 - 2x = 0', { kind: 'ellipse', h: '1', k: '0', a: '1', b: '1/2' }],
    ['x^2 + 2y^2 = 6', { kind: 'ellipse', h: '0', k: '0', a: 'sqrt(6)', b: 'sqrt(3)' }],
  ]
  it.each(general)('general form %s', (src, want) => {
    expect(readConic(src)).toEqual(want)
  })

  it('every reading is the typed curve (the source it gives back has the same zero set)', () => {
    for (const [src] of [...standard, ...general]) {
      const s = readConic(src)!
      const F = implicitOf(src.replace(/²/g, '^2').replace(/−/g, '-').replace(/^([^=]*)$/, '$1 = 0'))
      for (const [x, y] of pointsOn(s)) {
        expect(Math.abs(F(x, y)), `${src} at (${x}, ${y})`).toBeLessThanOrEqual(1e-9 * (1 + x * x + y * y) * 40)
      }
    }
  })

  const nulls: [string, string][] = [
    ['xy = 1', 'rotated (B ≠ 0)'],
    ['x^2 + xy + y^2 = 3', 'rotated (B ≠ 0)'],
    ['x^2 + y^2 + 1 = 0', 'no graph'],
    ['x^2 + y^2 - 4x + 6y + 13 = 0', 'a point'],
    ['x^2 - 4y^2 = 0', 'two lines'],
    ['x^2 - 4x + 3 = 0', 'two parallel lines'],
    ['x^3 + y^2 = 1', 'a cubic'],
    ['sin(x) + y^2 = 1', 'not a polynomial'],
    ['x + y = 1', 'a line'],
    ['y = x^2', 'a function, not a conic equation'],
    ['a x^2 + y^2 = 1', 'a slider'],
    ['r = 2', 'polar'],
    ['', 'nothing'],
    ['(x - 2', 'a parse error'],
  ]
  it.each(nulls)('%s → null (%s)', (src) => {
    expect(readConic(src)).toBeNull()
  })

  it('degenerate cases carry their reason from classify', () => {
    expect(classify('x^2 + y^2 + 1 = 0').sentence).toBe('a degenerate conic: no points — the equation has no real solutions')
    expect(classify('x^2 + y^2 - 4x + 6y + 13 = 0').sentence).toBe('a degenerate conic: the single point (2, −3)')
    expect(classify('y^2 = 4x^2').sentence).toBe('a degenerate conic: the two lines y = ±2x')
    expect(classify('x^2 - 4x + 3 = 0').sentence).toBe('a degenerate conic: the two parallel lines x = 1 and x = 3')
    expect(classify('(x - 1)^2 = 0').sentence).toBe('a degenerate conic: the single line x = 1, counted twice')
  })
})

// ---------------------------------------------------------------------------
// classify
// ---------------------------------------------------------------------------

describe('classify', () => {
  it('xy = 1 is a hyperbola rotated 45°', () => {
    const c = classify('xy = 1')
    expect(c.kind).toBe('hyperbola')
    expect(c.rotated).toBe(true)
    expect(c.theta).toBeCloseTo(Math.PI / 4, 14)
    expect(c.discriminant).toBe(1)
    expect(c.sentence).toBe('B² − 4AC = 1 > 0: a hyperbola, rotated 45°')
  })

  it('x² + xy + y² = 3 is an ellipse', () => {
    const c = classify('x^2 + xy + y^2 = 3')
    expect(c.kind).toBe('ellipse')
    expect(c.rotated).toBe(true)
    expect(c.discriminant).toBe(-3)
    expect(c.sentence).toBe('B² − 4AC = −3 < 0: an ellipse, rotated 45°')
  })

  it('5x² + 4xy + 2y² = 1: rotated 26.57°', () => {
    const c = classify('5x^2 + 4xy + 2y^2 = 1')
    expect(c.kind).toBe('ellipse')
    expect(c.theta).toBeCloseTo(0.5 * Math.atan(4 / 3), 14)
    expect(c.sentence).toBe('B² − 4AC = −24 < 0: an ellipse, rotated 26.57°')
  })

  const table: [string, string, string][] = [
    ['x^2 + y^2 - 4x + 6y - 3 = 0', 'circle', 'B² − 4AC = −4 < 0 and A = C: a circle'],
    ['9x^2 + 4y^2 - 36x + 8y + 4 = 0', 'ellipse', 'B² − 4AC = −144 < 0: an ellipse'],
    ['4x^2 - 9y^2 - 16x - 18y - 29 = 0', 'hyperbola', 'B² − 4AC = 144 > 0: a hyperbola'],
    ['y^2 - 8x - 2y + 17 = 0', 'parabola', 'B² − 4AC = 0: a parabola'],
    ['y = x^2', 'parabola', 'B² − 4AC = 0: a parabola'],
    ['x^2 + 2xy + y^2 + x - y = 0', 'parabola', 'B² − 4AC = 0: a parabola, rotated 45°'],
    ['3x^2 - 2xy + 3y^2 = 8', 'ellipse', 'B² − 4AC = −32 < 0: an ellipse, rotated −45°'],
    ['x y + 2x - y = 5', 'hyperbola', 'B² − 4AC = 1 > 0: a hyperbola, rotated 45°'],
    ['x^2 - y^2 = 0', 'degenerate', 'a degenerate conic: the two lines y = ±x'],
    ['xy = 0', 'degenerate', 'a degenerate conic: the two lines y = 0 and x = 0'],
    ['(x - y)(x + y - 2) = 0', 'degenerate', 'a degenerate conic: the two lines y = x and y = −x + 2'],
    ['x^2 + 2xy + y^2 = 1', 'degenerate', 'a degenerate conic: the two parallel lines y = −x − 1 and y = −x + 1'],
    ['x^2 + 2xy + y^2 + 1 = 0', 'degenerate', 'a degenerate conic: no points — the equation has no real solutions'],
    ['2x^2 + xy + y^2 = 0', 'degenerate', 'a degenerate conic: the single point (0, 0)'],
    ['x + y = 1', 'none', 'not a conic: there is no x², xy or y² term, so it is not a quadratic'],
    ['x^3 + y^2 = 1', 'none', 'not a conic: the equation is not a quadratic in x and y'],
    ['y = sin(x)', 'none', 'not a conic: the equation is not a quadratic in x and y'],
    ['x^2 + y^2 = r^2', 'none', 'not a conic: Cannot mix polar variables (r, θ) with x, y, or t — use either \'r = f(θ)\' or a cartesian equation'],
  ]
  it.each(table)('%s → %s', (src, kind, sentence) => {
    const c = classify(src)
    expect(c.kind).toBe(kind)
    expect(c.sentence).toBe(sentence)
  })

  it('a slider is not a conic', () => {
    const c = classify('a x^2 + y^2 = 1')
    expect(c.kind).toBe('none')
    expect(c.sentence).toMatch(/slider/)
  })

  it('any spec, rotated by θ, classifies as its kind with that rotation (60 random)', () => {
    const rng = makeRng(4242)
    const kinds: ConicSpec[] = [
      { kind: 'ellipse', h: '1', k: '-2', a: '3', b: '1' },
      { kind: 'hyperbola', h: '-1', k: '2', a: '2', b: '1', opens: 'x' },
      { kind: 'parabola', h: '2', k: '1', a: '1/2', opens: 'y', p: '1/2' },
    ]
    for (let i = 0; i < 60; i++) {
      const s = kinds[i % 3]
      const th = (rng() - 0.5) * (Math.PI / 2) * 0.98
      const F = implicitOf(conicSource(s))
      // G(x, y) = F(R(−θ)(x, y)): the conic rotated by θ about the origin
      const c = Math.cos(th), sn = Math.sin(th)
      const G = (x: number, y: number) => F(c * x + sn * y, -sn * x + c * y)
      // write G as typed text through its exact quadratic coefficients
      const q = [
        (G(1, 0) + G(-1, 0) - 2 * G(0, 0)) / 2, (G(1, 1) - G(1, -1) - G(-1, 1) + G(-1, -1)) / 4,
        (G(0, 1) + G(0, -1) - 2 * G(0, 0)) / 2, (G(1, 0) - G(-1, 0)) / 2, (G(0, 1) - G(0, -1)) / 2, G(0, 0),
      ].map((v) => v.toPrecision(17))
      const src = `(${q[0]})x^2 + (${q[1]})x*y + (${q[2]})y^2 + (${q[3]})x + (${q[4]})y + (${q[5]}) = 0`
      const cl = classify(src)
      expect(cl.kind, src).toBe(s.kind)
      if (Math.abs(th) > 1e-3) {
        expect(cl.rotated).toBe(true)
        // the axes are determined up to a quarter turn
        const d = (cl.theta - th) / (Math.PI / 2)
        expect(Math.abs(d - Math.round(d)), src).toBeLessThan(1e-6)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// conicFeatures
// ---------------------------------------------------------------------------

describe('conicFeatures', () => {
  it('ellipse (x − 2)²/9 + (y + 1)²/4 = 1', () => {
    const f = conicFeatures({ kind: 'ellipse', h: '2', k: '-1', a: '3', b: '2' })
    expect(f.center).toEqual({ x: 2, y: -1, xText: '2', yText: '−1' })
    expect(f.vertices.map((p) => [p.x, p.y, p.xText, p.yText])).toEqual([[-1, -1, '−1', '−1'], [5, -1, '5', '−1']])
    expect(f.coVertices.map((p) => [p.x, p.y])).toEqual([[2, -3], [2, 1]])
    expect(f.foci.map((p) => p.xText)).toEqual(['2 − √5', '2 + √5'])
    expect(f.foci[1].x).toBeCloseTo(2 + Math.sqrt(5), 14)
    expect(f.eccentricity).toBeCloseTo(Math.sqrt(5) / 3, 14)
    expect(f.asymptotes).toEqual([])
    expect(f.box).toBeNull()
    expect(f.directrix).toBeNull()
    expect(f.sentences).toEqual([
      'center (2, −1)',
      'major axis 6, minor axis 4',
      'the major axis is horizontal, on y = −1',
      'vertices (−1, −1) and (5, −1)',
      'co-vertices (2, −3) and (2, 1)',
      'c² = 9 − 4 = 5, so c = √5',
      'foci (2 ± √5, −1)',
      'eccentricity √5/3',
      'latus rectum 8/3',
    ])
  })

  it('a vertical ellipse: a (along x) is the MINOR semi-axis', () => {
    const f = conicFeatures({ kind: 'ellipse', h: '2', k: '-1', a: '2', b: '3' })
    expect(f.vertices.map((p) => [p.x, p.y])).toEqual([[2, -4], [2, 2]])
    expect(f.coVertices.map((p) => [p.x, p.y])).toEqual([[0, -1], [4, -1]])
    expect(f.foci.map((p) => p.yText)).toEqual(['−1 − √5', '−1 + √5'])
    expect(f.sentences).toContain('foci (2, −1 ± √5)')
    expect(f.sentences).toContain('the major axis is vertical, on x = 2')
  })

  it('hyperbola (x − 2)²/9 − (y + 1)²/4 = 1', () => {
    const f = conicFeatures({ kind: 'hyperbola', h: '2', k: '-1', a: '3', b: '2', opens: 'x' })
    expect(f.vertices.map((p) => [p.x, p.y])).toEqual([[-1, -1], [5, -1]])
    expect(f.foci.map((p) => p.xText)).toEqual(['2 − √13', '2 + √13'])
    expect(f.asymptotes).toEqual([
      { slope: 2 / 3, text: 'y = (2/3)(x − 2) − 1' },
      { slope: -2 / 3, text: 'y = −(2/3)(x − 2) − 1' },
    ])
    expect(f.box).toEqual([{ x: -1, y: -3 }, { x: 5, y: -3 }, { x: 5, y: 1 }, { x: -1, y: 1 }])
    expect(f.eccentricity).toBeCloseTo(Math.sqrt(13) / 3, 14)
    expect(f.sentences).toContain('asymptotes y = ±(2/3)(x − 2) − 1')
    expect(f.sentences).toContain('foci (2 ± √13, −1)')
    expect(f.sentences).toContain('transverse axis 6, conjugate axis 4')
    expect(f.sentences).toContain('eccentricity √13/3')
  })

  it('hyperbola opening up: slopes ±a/b, box a tall', () => {
    const f = conicFeatures({ kind: 'hyperbola', h: '0', k: '3', a: '4', b: '3', opens: 'y' })
    expect(f.asymptotes.map((l) => l.text)).toEqual(['y = (4/3)x + 3', 'y = −(4/3)x + 3'])
    expect(f.foci.map((p) => [p.x, p.y])).toEqual([[0, -2], [0, 8]])
    expect(f.sentences).toContain('foci (0, −2) and (0, 8)')
    expect(f.box).toEqual([{ x: -3, y: -1 }, { x: 3, y: -1 }, { x: 3, y: 7 }, { x: -3, y: 7 }])
    expect(f.eccentricity).toBe(1.25)
  })

  it('x² − y² = 1: asymptotes y = ±x, foci (±√2, 0)', () => {
    const f = conicFeatures({ kind: 'hyperbola', h: '0', k: '0', a: '1', b: '1', opens: 'x' })
    expect(f.sentences).toContain('asymptotes y = ±x')
    expect(f.sentences).toContain('foci (±√2, 0)')
  })

  it('parabola (x + 2)² = 8(y − 1)', () => {
    const f = conicFeatures({ kind: 'parabola', h: '-2', k: '1', a: '2', opens: 'y', p: '2' })
    expect(f.center).toBeNull()
    expect(f.vertices).toEqual([{ x: -2, y: 1, xText: '−2', yText: '1' }])
    expect(f.foci).toEqual([{ x: -2, y: 3, xText: '−2', yText: '3' }])
    expect(f.directrix).toEqual({ axis: 'y', value: -1, text: 'y = −1' })
    expect(f.eccentricity).toBe(1)
    expect(f.sentences).toEqual([
      'vertex (−2, 1)', 'opens up', '4p = 8, so p = 2', 'focus (−2, 3)',
      'directrix y = −1', 'axis of symmetry x = −2', 'latus rectum 8',
    ])
  })

  it('parabola y² = −12x opens left', () => {
    const f = conicFeatures({ kind: 'parabola', h: '0', k: '0', a: '-3', opens: 'x', p: '-3' })
    expect(f.foci.map((p) => [p.x, p.y])).toEqual([[-3, 0]])
    expect(f.directrix).toEqual({ axis: 'x', value: 3, text: 'x = 3' })
    expect(f.sentences).toContain('opens left')
    expect(f.sentences).toContain('latus rectum 12')
  })

  it('circle: the focus is the center', () => {
    const f = conicFeatures({ kind: 'circle', h: '1', k: '0', a: '4' })
    expect(f.center).toEqual({ x: 1, y: 0, xText: '1', yText: '0' })
    expect(f.foci).toEqual([f.center])
    expect(f.eccentricity).toBe(0)
    expect(f.sentences).toEqual(['center (1, 0)', 'radius 4', 'diameter 8'])
  })

  it('surds and decimals keep their shape', () => {
    const f = conicFeatures({ kind: 'ellipse', h: 'sqrt(2)', k: '2.5', a: 'sqrt(5)', b: '1' })
    expect(f.center!.xText).toBe('√2')
    expect(f.center!.yText).toBe('2.5')
    expect(f.sentences).toContain('vertices (√2 ± √5, 2.5)')
    expect(f.sentences).toContain('major axis 2√5, minor axis 2')
    expect(f.sentences).toContain('co-vertices (√2, 1.5) and (√2, 3.5)')
  })
})

// ---------------------------------------------------------------------------
// builders
// ---------------------------------------------------------------------------

describe('builders', () => {
  it('conicFromCircle', () => {
    expect(conicFromCircle({ x: 1, y: 2 }, 3)).toEqual({ kind: 'circle', h: '1', k: '2', a: '3' })
    expect(conicFromCircle({ x: 1, y: 2 }, { x: 4, y: 6 })).toEqual({ kind: 'circle', h: '1', k: '2', a: '5' })
    expect(conicFromCircle({ x: 0, y: 0 }, { x: 1, y: 1 })).toEqual({ kind: 'circle', h: '0', k: '0', a: 'sqrt(2)' })
    expect(conicFromCircle({ x: 0, y: 0 }, -1)).toEqual({ error: 'the radius must be a positive number' })
    expect(conicFromCircle({ x: 1, y: 1 }, { x: 1, y: 1 })).toEqual({ error: "the point on the circle can't be the center" })
  })

  it('conicFromEllipse', () => {
    const c = { x: 2, y: -1 }
    expect(conicFromEllipse({ center: c, vertex: { x: 5, y: -1 }, focus: { x: 2 + Math.sqrt(5), y: -1 } }))
      .toEqual({ kind: 'ellipse', h: '2', k: '-1', a: '3', b: '2' })
    expect(conicFromEllipse({ center: { x: 0, y: 0 }, vertex: { x: 0, y: 5 }, coVertex: { x: 3, y: 0 } }))
      .toEqual({ kind: 'ellipse', h: '0', k: '0', a: '3', b: '5' })
    expect(conicFromEllipse({ center: { x: 0, y: 0 }, vertex: { x: 0, y: 5 }, e: 0.6 }))
      .toEqual({ kind: 'ellipse', h: '0', k: '0', a: '4', b: '5' })
    expect(conicFromEllipse({ center: { x: 0, y: 0 }, vertex: { x: 3, y: 0 }, focus: { x: 1, y: 0 } }))
      .toEqual({ kind: 'ellipse', h: '0', k: '0', a: '3', b: '2sqrt(2)' })
    // refusals, in the teacher's words
    expect(conicFromEllipse({ center: c, vertex: { x: 5, y: -1 }, focus: { x: 6, y: -1 } }))
      .toEqual({ error: 'the focus must be between the center and the vertex for an ellipse' })
    expect(conicFromEllipse({ center: c, vertex: { x: 5, y: -1 }, focus: { x: 2, y: 0 } }))
      .toEqual({ error: 'the focus must be on the major axis, the line through the center and the vertex' })
    expect(conicFromEllipse({ center: c, vertex: { x: 5, y: 1 }, e: 0.5 }).hasOwnProperty('error')).toBe(true)
    expect(conicFromEllipse({ center: c, vertex: c, e: 0.5 })).toEqual({ error: "the vertex can't be the center" })
    expect(conicFromEllipse({ center: { x: 0, y: 0 }, vertex: { x: 3, y: 0 }, coVertex: { x: 0, y: 4 } }))
      .toEqual({ error: 'the co-vertex must be closer to the center than the vertex — the major axis is the longer one' })
    expect(conicFromEllipse({ center: { x: 0, y: 0 }, vertex: { x: 3, y: 0 }, e: 1.2 }))
      .toEqual({ error: "an ellipse's eccentricity is at least 0 and less than 1 (e = 1 is a parabola, e > 1 a hyperbola)" })
    expect(conicFromEllipse({ center: { x: 0, y: 0 }, vertex: { x: 3, y: 0 } }))
      .toEqual({ error: 'give a focus, a co-vertex or the eccentricity as well as the vertex' })
    // equal axes: a circle
    expect(conicFromEllipse({ center: { x: 0, y: 0 }, vertex: { x: 3, y: 0 }, e: 0 }))
      .toEqual({ kind: 'circle', h: '0', k: '0', a: '3' })
  })

  it('conicFromHyperbola', () => {
    const o = { x: 0, y: 0 }
    expect(conicFromHyperbola({ center: o, vertex: { x: 3, y: 0 }, focus: { x: 5, y: 0 } }))
      .toEqual({ kind: 'hyperbola', h: '0', k: '0', a: '3', b: '4', opens: 'x' })
    expect(conicFromHyperbola({ center: o, vertex: { x: 0, y: 3 }, asymptoteSlope: 3 / 4 }))
      .toEqual({ kind: 'hyperbola', h: '0', k: '0', a: '3', b: '4', opens: 'y' })
    expect(conicFromHyperbola({ center: { x: 2, y: -1 }, vertex: { x: 5, y: -1 }, asymptoteSlope: -2 / 3 }))
      .toEqual({ kind: 'hyperbola', h: '2', k: '-1', a: '3', b: '2', opens: 'x' })
    expect(conicFromHyperbola({ center: o, vertex: { x: 3, y: 0 }, e: 5 / 3 }))
      .toEqual({ kind: 'hyperbola', h: '0', k: '0', a: '3', b: '4', opens: 'x' })
    expect(conicFromHyperbola({ center: o, vertex: { x: 3, y: 0 }, focus: { x: 2, y: 0 } }))
      .toEqual({ error: 'the focus must be farther from the center than the vertex for a hyperbola' })
    expect(conicFromHyperbola({ center: o, vertex: { x: 3, y: 0 }, e: 0.5 }))
      .toEqual({ error: "a hyperbola's eccentricity is greater than 1" })
    expect(conicFromHyperbola({ center: o, vertex: { x: 3, y: 0 }, asymptoteSlope: 0 }))
      .toEqual({ error: "the asymptotes' slope must be a nonzero number" })
  })

  it('conicFromParabola', () => {
    expect(conicFromParabola({ vertex: { x: -2, y: 1 }, focus: { x: -2, y: 3 } }))
      .toEqual({ kind: 'parabola', h: '-2', k: '1', a: '2', opens: 'y', p: '2' })
    expect(conicFromParabola({ vertex: { x: 0, y: 0 }, focus: { x: -3, y: 0 } }))
      .toEqual({ kind: 'parabola', h: '0', k: '0', a: '-3', opens: 'x', p: '-3' })
    expect(conicFromParabola({ focus: { x: 0, y: 2 }, directrix: { axis: 'y', value: -2 } }))
      .toEqual({ kind: 'parabola', h: '0', k: '0', a: '2', opens: 'y', p: '2' })
    expect(conicFromParabola({ focus: { x: 1, y: 5 }, directrix: { axis: 'x', value: 4 } }))
      .toEqual({ kind: 'parabola', h: '5/2', k: '5', a: '-3/2', opens: 'x', p: '-3/2' })
    expect(conicFromParabola({ vertex: { x: 0, y: 0 }, point: { x: 2, y: 1 }, opens: 'up' }))
      .toEqual({ kind: 'parabola', h: '0', k: '0', a: '1', opens: 'y', p: '1' })
    expect(conicFromParabola({ vertex: { x: 1, y: 1 }, point: { x: -1, y: 3 }, opens: 'left' }))
      .toEqual({ kind: 'parabola', h: '1', k: '1', a: '-1/2', opens: 'x', p: '-1/2' })
    expect(conicFromParabola({ vertex: { x: 0, y: 0 }, point: { x: 2, y: -1 }, opens: 'up' }))
      .toEqual({ error: "a parabola that opens up can't pass through a point below its vertex" })
    expect(conicFromParabola({ vertex: { x: 0, y: 0 }, point: { x: 0, y: 3 }, opens: 'up' }))
      .toEqual({ error: 'that point is on the axis of symmetry — a parabola meets its axis only at the vertex' })
    expect(conicFromParabola({ vertex: { x: 0, y: 0 }, focus: { x: 1, y: 1 } }))
      .toEqual({ error: 'the focus must be directly above, below, left or right of the vertex — this app draws conics with horizontal and vertical axes' })
    expect(conicFromParabola({ focus: { x: 0, y: 2 }, directrix: { axis: 'y', value: 2 } }))
      .toEqual({ error: "the focus can't be on the directrix" })
  })

  it('conicFromFoci: the locus definitions', () => {
    expect(conicFromFoci({ x: -4, y: 0 }, { x: 4, y: 0 }, { sum: 10 }))
      .toEqual({ kind: 'ellipse', h: '0', k: '0', a: '5', b: '3' })
    expect(conicFromFoci({ x: 1, y: -3 }, { x: 1, y: 5 }, { sum: 10 }))
      .toEqual({ kind: 'ellipse', h: '1', k: '1', a: '3', b: '5' })
    expect(conicFromFoci({ x: -5, y: 0 }, { x: 5, y: 0 }, { difference: 6 }))
      .toEqual({ kind: 'hyperbola', h: '0', k: '0', a: '3', b: '4', opens: 'x' })
    expect(conicFromFoci({ x: -4, y: 0 }, { x: 4, y: 0 }, { sum: 8 }))
      .toEqual({ error: 'the sum of the distances must be more than the distance between the foci (8)' })
    expect(conicFromFoci({ x: -5, y: 0 }, { x: 5, y: 0 }, { difference: 12 }))
      .toEqual({ error: 'the difference of the distances must be less than the distance between the foci (10)' })
    expect(conicFromFoci({ x: 0, y: 0 }, { x: 3, y: 4 }, { sum: 10 }).hasOwnProperty('error')).toBe(true)
  })

  it('every builder result is a conic the definition agrees with', () => {
    // sum of focal distances = 2·(major semi-axis) at points of conicFromFoci's ellipse
    const s = conicFromFoci({ x: -1, y: 2 }, { x: 3, y: 2 }, { sum: 7 })
    expect(isSpec(s)).toBe(true)
    if (!isSpec(s)) return
    for (const [x, y] of pointsOn(s)) {
      expect(Math.hypot(x + 1, y - 2) + Math.hypot(x - 3, y - 2)).toBeCloseTo(7, 9)
    }
    const hy = conicFromFoci({ x: 0, y: -3 }, { x: 0, y: 3 }, { difference: 4 })
    expect(isSpec(hy)).toBe(true)
    if (!isSpec(hy)) return
    for (const [x, y] of pointsOn(hy)) {
      expect(Math.abs(Math.hypot(x, y + 3) - Math.hypot(x, y - 3))).toBeCloseTo(4, 9)
    }
    const pa = conicFromParabola({ focus: { x: 1, y: 5 }, directrix: { axis: 'x', value: 4 } })
    if (!isSpec(pa)) throw new Error('parabola')
    for (const [x, y] of pointsOn(pa)) {
      expect(Math.hypot(x - 1, y - 5)).toBeCloseTo(Math.abs(x - 4), 9)
    }
  })
})

// ---------------------------------------------------------------------------
// round trip
// ---------------------------------------------------------------------------

describe('round trip', () => {
  const H = ['0', '1', '-2', '3', '1/2', '-3/2', '2.5', '-0.5', 'sqrt(2)', '-4']
  const R = ['1', '2', '3', '4', '5', '1/2', '3/2', 'sqrt(2)', 'sqrt(5)', '2sqrt(3)', '2.5', '1.5']
  const P = ['1', '-1', '2', '-3', '1/2', '-1/4', '3/4', '0.3', '-0.3', '5/2']

  it('readConic(conicSource(spec)) is the spec, 200 random specs of all four kinds', () => {
    const rng = makeRng(1618)
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rng() * xs.length)]
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const h = pick(H), k = pick(H)
      let s: ConicSpec
      switch (i % 4) {
        case 0:
          s = { kind: 'circle', h, k, a: pick(R) }
          break
        case 1: {
          const a = pick(R)
          let b = pick(R)
          while (Math.abs(val(b) - val(a)) < 1e-9) b = pick(R)
          s = { kind: 'ellipse', h, k, a, b }
          break
        }
        case 2:
          s = { kind: 'hyperbola', h, k, a: pick(R), b: pick(R), opens: rng() < 0.5 ? 'x' : 'y' }
          break
        default: {
          const p = pick(P)
          s = { kind: 'parabola', h, k, a: p, opens: rng() < 0.5 ? 'x' : 'y', p }
        }
      }
      const src = expectSourceIsConic(s)
      seen.add(s.kind)
      expect(readConic(src), src).toEqual(s)
      expect(classify(src).kind, src).toBe(s.kind)
      expect(conicFeatures(s).sentences.length, src).toBeGreaterThan(0)
    }
    expect(seen.size).toBe(4)
  })

  it('general form survives: expand a spec, read it back', () => {
    const rng = makeRng(99)
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rng() * xs.length)]
    const HI = ['0', '1', '-2', '3', '-4', '1/2']
    const RI = ['1', '2', '3', '4', '5']
    for (let i = 0; i < 40; i++) {
      const h = pick(HI), k = pick(HI)
      const a = pick(RI)
      let b = pick(RI)
      while (b === a) b = pick(RI)
      const s: ConicSpec = i % 2 ? { kind: 'ellipse', h, k, a, b } : { kind: 'hyperbola', h, k, a, b, opens: 'x' }
      const [hv, kv, av, bv] = [val(h), val(k), val(a), val(b)]
      const sg = s.kind === 'ellipse' ? 1 : -1
      // b²(x − h)² ± a²(y − k)² = a²b², expanded (and scaled by 2)
      const A = 2 * bv * bv, C = 2 * sg * av * av
      const D = -2 * A * hv, E = -2 * C * kv
      const F = A * hv * hv + C * kv * kv - 2 * av * av * bv * bv
      const src = `${A}x^2 + ${C}y^2 + ${D}x + ${E}y + ${F} = 0`.replace(/\+ -/g, '- ')
      expect(readConic(src), src).toEqual(s)
    }
  })
})

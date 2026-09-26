import { describe, expect, it } from 'vitest'
import {
  readSinusoid,
  rewriteAs,
  sinFeatures,
  sinFromExtrema,
  sinFromParts,
  sinSource,
  type SinFn,
  type SinSpec,
} from '../src/core/sinusoidal'
import { parseExpression } from '../src/core/parse'
import { makeRng } from './helpers'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Constant string → number, through the app's own parser. */
function val(s: string): number {
  const o = parseExpression(s)
  if (!o.ok) throw new Error(`not a constant: ${s}`)
  return o.plot.makeModel('v').evalExplicit!(o.plot.defaultParams, 0)
}

const spec = (fn: SinFn, a: string, b: string, h = '0', k = '0', name?: string): SinSpec =>
  name ? { name, fn, a, b, h, k } : { fn, a, b, h, k }

/** y = a·f(b(x − h)) + k, straight from the spec. */
function formula(s: SinSpec, x: number): number {
  const u = val(s.b) * (x - val(s.h))
  return val(s.a) * (s.fn === 'cos' ? Math.cos(u) : Math.sin(u)) + val(s.k)
}

/** A typed source as a function of x. */
function fnOf(src: string): (x: number) => number {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(`${src}: ${o.error}`)
  expect(o.plot.kind).toBe('explicit')
  const m = o.plot.makeModel('t')
  return (x) => m.evalExplicit!(o.plot.defaultParams, x)
}

const XS = Array.from({ length: 20 }, (_, i) => -6.3 + i * 0.67)

/** sinSource parses, has no sliders, and equals the formula at 20 points. */
function expectParses(s: SinSpec): string {
  const src = sinSource(s)
  const o = parseExpression(src)
  expect(o.ok, `${src}: ${o.ok ? '' : o.error}`).toBe(true)
  if (!o.ok) return src
  expect(o.plot.kind).toBe('explicit')
  expect(o.plot.paramNames).toEqual([])
  const f = fnOf(src)
  for (const x of XS) {
    const want = formula(s, x)
    expect(Math.abs(f(x) - want), `${src} at x=${x}`).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(want)))
  }
  return src
}

/** Two specs are the same function (sampled). */
function expectSameFunction(p: SinSpec, q: SinSpec): void {
  const f = fnOf(sinSource(p))
  const g = fnOf(sinSource(q))
  for (const x of XS) {
    expect(Math.abs(f(x) - g(x)), `${sinSource(p)} vs ${sinSource(q)} at ${x}`).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(f(x))))
  }
}

const latexOf = (src: string): string => {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(o.error)
  return o.plot.latex
}

// ---------------------------------------------------------------------------
// sinSource
// ---------------------------------------------------------------------------

describe('sinSource', () => {
  const table: Array<[SinSpec, string]> = [
    [spec('sin', '3', '2', 'pi/4', '1'), 'y = 3sin(2(x - pi/4)) + 1'],
    [spec('cos', '-1', '1'), 'y = -cos(x)'],
    [spec('sin', '1', '1'), 'y = sin(x)'],
    [spec('sin', '2', 'pi/6', '0', '-4', 'f'), 'f(x) = 2sin(pi/6 x) - 4'],
    [spec('sin', '1', '1', '-pi/3'), 'y = sin(x + pi/3)'],
    [spec('sin', '1', '2'), 'y = sin(2x)'],
    [spec('cos', '1', '1/2'), 'y = cos(1/2 x)'],
    [spec('cos', '1', '1/2', '1'), 'y = cos((1/2)(x - 1))'],
    [spec('sin', '4', 'pi/6', '2', '50'), 'y = 4sin((pi/6)(x - 2)) + 50'],
    [spec('sin', '1', 'pi'), 'y = sin(pi x)'],
    [spec('cos', '1/2', '3', '0', '-1/2'), 'y = (1/2)cos(3x) - 1/2'],
    [spec('sin', '-sqrt(2)', '-1', '1'), 'y = -sqrt(2)sin(-(x - 1))'],
    [spec('sin', '2pi', '-2'), 'y = 2pi sin(-2x)'],
    [spec('cos', '2', '2pi/3', '-1.5', 'pi'), 'y = 2cos((2pi/3)(x + 1.5)) + pi'],
    [spec('sin', '1', '1', '1+pi'), 'y = sin(x - (1+pi))'],
  ]
  for (const [s, want] of table) {
    it(`${want}`, () => {
      expect(sinSource(s)).toBe(want)
      expectParses(s)
    })
  }

  it('reads like a textbook on the card', () => {
    expect(latexOf(sinSource(spec('sin', '3', '2', 'pi/4', '1')))).toBe(
      'y = 3\\sin\\left(2\\left(x-\\pi/4\\right)\\right)+1',
    )
    expect(latexOf(sinSource(spec('sin', '2', 'pi/6', '0', '-4', 'f')))).toBe(
      'f\\left(x\\right) = 2\\sin\\left(\\frac{\\pi}{6}x\\right)-4',
    )
    expect(latexOf(sinSource(spec('cos', '-40', 'pi/6', '0', '50')))).toBe(
      'y = -40\\cos\\left(\\frac{\\pi}{6}x\\right)+50',
    )
  })
})

// ---------------------------------------------------------------------------
// readSinusoid
// ---------------------------------------------------------------------------

describe('readSinusoid', () => {
  const table: Array<[string, SinSpec]> = [
    ['y = 3sin(2(x - pi/4)) + 1', spec('sin', '3', '2', 'pi/4', '1')],
    ['sin(x)', spec('sin', '1', '1')],
    ['y = sin x', spec('sin', '1', '1')],
    ['y = sin(2x - pi/2)', spec('sin', '1', '2', 'pi/4')],
    ['cos(3x) + 1', spec('cos', '1', '3', '0', '1')],
    ['4 - 2sin(x)', spec('sin', '-2', '1', '0', '4')],
    ['f(x) = sin(x)*3 + 2', spec('sin', '3', '1', '0', '2', 'f')],
    ['y = cos(x)/2', spec('cos', '1/2', '1')],
    ['y = 2sin(3x + 1)', spec('sin', '2', '3', '-1/3')],
    ['y = sin(pi x/6)', spec('sin', '1', 'pi/6')],
    ['y = sin((2pi/12)(x - 3))', spec('sin', '1', '2pi/12', '3')],
    ['y = 1 + cos(x - pi) - 3', spec('cos', '1', '1', 'pi', '-2')],
    ['y = -sin(2x - pi)', spec('sin', '-1', '2', 'pi/2')],
    ['y = 5 + 3cos(pi/6 x)', spec('cos', '3', 'pi/6', '0', '5')],
    ['g(t) = 2sin(t)', spec('sin', '2', '1', '0', '0', 'g')],
  ]
  for (const [src, want] of table) {
    it(src, () => {
      expect(readSinusoid(src)).toEqual(want)
    })
  }

  it('folds a·sin(u) + c·cos(u) into one sinusoid R·sin(u + φ)', () => {
    // sin x + cos x = √2 sin(x + π/4)
    const s1 = readSinusoid('y = sin(x) + cos(x)')
    expect(s1).toEqual(spec('sin', 'sqrt(2)', '1', '-pi/4'))
    expect(sinSource(s1!)).toBe('y = sqrt(2)sin(x + pi/4)')
    // 3 sin x − 4 cos x = 5 sin(x − 0.9273…)
    const s2 = readSinusoid('y = 3sin x - 4cos x')!
    expect(s2.a).toBe('5')
    expect(sinFeatures(s2).amplitude).toBe(5)
    expect(val(s2.h)).toBeCloseTo(Math.atan2(4, 3), 11)
    // √3 sin x + cos x = 2 sin(x + π/6)
    expect(readSinusoid('sqrt(3)sin(x) + cos(x)')).toEqual(spec('sin', '2', '1', '-pi/6'))
    // the same u, written with b ≠ 1 and a shift, and a midline
    const s3 = readSinusoid('y = sin(2x - 1) + cos(2x - 1) + 4')!
    expect(s3.a).toBe('sqrt(2)')
    expect(s3.k).toBe('4')
    // sin(−x) = −sin x
    const s4 = readSinusoid('sin(-x) + cos(x)')!
    for (const x of XS) expect(formula(s4, x)).toBeCloseTo(Math.cos(x) - Math.sin(x), 10)
    // like terms just add
    expect(readSinusoid('sin(x) + 2sin(x)')).toEqual(spec('sin', '3', '1'))
    expect(readSinusoid('cos(x) - 3cos(x) + 1')).toEqual(spec('cos', '-2', '1', '0', '1'))
    // every fold is the function it was read from
    for (const src of ['y = sin(x) + cos(x)', 'y = 3sin x - 4cos x', 'y = 2cos(3x+1) - sin(3x+1) - 2']) {
      const s = readSinusoid(src)!
      const f = fnOf(src)
      for (const x of XS) expect(formula(s, x)).toBeCloseTo(f(x), 9)
    }
  })

  it('refuses anything that is not one sinusoid', () => {
    for (const src of [
      'y = sin(x^2)', 'y = sin(x) + cos(2x)', 'y = sin(x)cos(x)', 'y = tan(x)',
      'y = sin(x)^2', 'y = sin^2(x)', 'y = x + sin(x)', 'y = 1/sin(x)', 'y = a sin(x)',
      'y = sin(x) + cos(x + 1)', 'y = sin(x) - sin(x) + 1', 'y = 3', 'y = x^2',
      'y = sin(1/x)', 'y = sin(abs(x))', 'y = sin(x) {0 < x < 3}', 'x^2 + y^2 = 1',
      'y = sec(x)', 'y = x sin(x)', '', 'y = sin(',
    ]) {
      expect(readSinusoid(src), src).toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// round trip
// ---------------------------------------------------------------------------

describe('round trip', () => {
  const A = ['1', '-1', '2', '-3', '1/2', '-1/2', '0.5', '2.5', 'sqrt(3)', '-sqrt(2)', '2pi', '40']
  const B = ['1', '-1', '2', '3', '1/2', 'pi', 'pi/6', '2pi/3', '0.5', '-2', 'pi/12', '4']
  const H = ['0', 'pi/4', '-pi/3', '1', '-2', '1/2', '2.5', '3pi/4', '-pi']
  const K = ['0', '1', '-4', '1/2', '-1/2', '2.5', 'pi', '50']

  it('readSinusoid(sinSource(spec)) is the spec, 200 random specs', () => {
    const rng = makeRng(2031)
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rng() * xs.length)]
    for (let i = 0; i < 200; i++) {
      const s = spec(
        rng() < 0.5 ? 'sin' : 'cos', pick(A), pick(B), pick(H), pick(K),
        rng() < 0.3 ? pick(['f', 'g', 'h']) : undefined,
      )
      const src = expectParses(s)
      expect(readSinusoid(src), src).toEqual(s)
    }
  })
})

// ---------------------------------------------------------------------------
// sinFeatures
// ---------------------------------------------------------------------------

describe('sinFeatures', () => {
  it('y = 3sin(2(x − π/4)) + 1', () => {
    const f = sinFeatures(spec('sin', '3', '2', 'pi/4', '1'))
    expect(f.amplitude).toBe(3)
    expect(f.period).toBeCloseTo(Math.PI, 14)
    expect(f.frequency).toBeCloseTo(1 / Math.PI, 14)
    expect(f.phaseShift).toBeCloseTo(Math.PI / 4, 14)
    expect(f.midline).toBe(1)
    expect(f.max).toBe(4)
    expect(f.min).toBe(-2)
    expect(f.range).toBe('−2 ≤ y ≤ 4')
    const want = [
      [Math.PI / 4, 1, 'π/4', '1', 'mid'],
      [Math.PI / 2, 4, 'π/2', '4', 'max'],
      [(3 * Math.PI) / 4, 1, '3π/4', '1', 'mid'],
      [Math.PI, -2, 'π', '−2', 'min'],
      [(5 * Math.PI) / 4, 1, '5π/4', '1', 'mid'],
    ] as const
    expect(f.keyPoints).toHaveLength(5)
    f.keyPoints.forEach((p, i) => {
      expect(p.x).toBeCloseTo(want[i][0], 12)
      expect(p.y).toBe(want[i][1])
      expect(p.xText).toBe(want[i][2])
      expect(p.yText).toBe(want[i][3])
      expect(p.kind).toBe(want[i][4])
    })
    expect(f.sentences).toEqual([
      'amplitude 3',
      'period π',
      'phase shift π/4 to the right',
      'midline y = 1',
      'range −2 ≤ y ≤ 4',
    ])
  })

  it('key-point kinds: cos starts at a max, a < 0 flips, b < 0 runs backwards', () => {
    const kinds = (s: SinSpec) => sinFeatures(s).keyPoints.map((p) => p.kind)
    expect(kinds(spec('sin', '1', '1'))).toEqual(['mid', 'max', 'mid', 'min', 'mid'])
    expect(kinds(spec('cos', '1', '1'))).toEqual(['max', 'mid', 'min', 'mid', 'max'])
    expect(kinds(spec('sin', '-2', '1'))).toEqual(['mid', 'min', 'mid', 'max', 'mid'])
    expect(kinds(spec('cos', '-2', '1'))).toEqual(['min', 'mid', 'max', 'mid', 'min'])
    expect(kinds(spec('sin', '1', '-1'))).toEqual(['mid', 'min', 'mid', 'max', 'mid'])
    // and every key point is ON the curve with the kind it claims
    for (const s of [spec('sin', '-2', '3', '1', '4'), spec('cos', '0.5', '-pi/6', '-2', '-1'), spec('sin', '3', '2', 'pi/4', '1')]) {
      const f = sinFeatures(s)
      for (const p of f.keyPoints) {
        expect(formula(s, p.x)).toBeCloseTo(p.y, 10)
        expect(p.y).toBe(p.kind === 'max' ? f.max : p.kind === 'min' ? f.min : f.midline)
      }
    }
  })

  it('a Ferris wheel: period 12, midline 50 — numbers, not π', () => {
    const f = sinFeatures(spec('cos', '-40', 'pi/6', '0', '50'))
    expect(f.period).toBeCloseTo(12, 12)
    expect(f.keyPoints.map((p) => p.xText)).toEqual(['0', '3', '6', '9', '12'])
    expect(f.keyPoints.map((p) => p.yText)).toEqual(['10', '50', '90', '50', '10'])
    expect(f.sentences).toEqual(['amplitude 40', 'period 12', 'no phase shift', 'midline y = 50', 'range 10 ≤ y ≤ 90'])
  })

  it('phase shift to the left, fractions, decimals', () => {
    expect(sinFeatures(spec('sin', '1', '1', '-pi/3')).sentences[2]).toBe('phase shift π/3 to the left')
    const f = sinFeatures(spec('sin', '1/2', '1/2', '1', '-1/2'))
    expect(f.sentences).toEqual(['amplitude 1/2', 'period 4π', 'phase shift 1 to the right', 'midline y = −1/2', 'range −1 ≤ y ≤ 0'])
    const d = sinFeatures(spec('cos', '2.5', '2', '0', '1.5'))
    expect(d.sentences[0]).toBe('amplitude 2.5')
    expect(d.range).toBe('−1 ≤ y ≤ 4')
  })
})

// ---------------------------------------------------------------------------
// sinFromParts / sinFromExtrema
// ---------------------------------------------------------------------------

describe('sinFromParts', () => {
  it('b = 2π/period, simplified', () => {
    const b = (period: string) => sinFromParts({ amplitude: '1', period, phase: '0', midline: '0' }).b
    expect(b('pi')).toBe('2')
    expect(b('2pi')).toBe('1')
    expect(b('12')).toBe('pi/6')
    expect(b('4')).toBe('pi/2')
    expect(b('3')).toBe('2pi/3')
    expect(b('1')).toBe('2pi')
    expect(b('1.5')).toBe('4pi/3')
    expect(b('pi/2')).toBe('4')
    expect(b('3pi')).toBe('2/3')
    expect(b('2pi/3')).toBe('3')
    expect(b('sqrt(2)')).toBe('2pi/sqrt(2)')
    for (const P of ['pi', '12', '3', '1.5', '3pi', 'sqrt(2)', 'e']) {
      expect(val(b(P)) * val(P)).toBeCloseTo(2 * Math.PI, 12)
    }
  })

  it('a Ferris wheel: period 12, starts at the bottom, midline 50', () => {
    const s = sinFromParts({ amplitude: '40', period: '12', phase: '0', midline: '50', start: 'min' })
    expect(s).toEqual(spec('cos', '-40', 'pi/6', '0', '50'))
    expect(sinSource(s)).toBe('y = -40cos(pi/6 x) + 50')
    const f = fnOf(sinSource(s))
    expect(f(0)).toBeCloseTo(10, 12) // boarding at the bottom
    expect(f(6)).toBeCloseTo(90, 12) // the top, half a turn later
    expect(f(12)).toBeCloseTo(10, 12)
  })

  it('start chooses the function and the sign of a', () => {
    const at = (start: 'max' | 'min' | 'mid-up' | 'mid-down', amplitude = '3') =>
      sinFromParts({ amplitude, period: 'pi', phase: 'pi/4', midline: '1', start })
    expect(at('max')).toEqual(spec('cos', '3', '2', 'pi/4', '1'))
    expect(at('min')).toEqual(spec('cos', '-3', '2', 'pi/4', '1'))
    expect(at('mid-up')).toEqual(spec('sin', '3', '2', 'pi/4', '1'))
    expect(at('mid-down')).toEqual(spec('sin', '-3', '2', 'pi/4', '1'))
    // the amplitude is a size: its sign is start's to decide
    expect(at('max', '-3')).toEqual(spec('cos', '3', '2', 'pi/4', '1'))
    expect(at('min', '2pi').a).toBe('-2pi')
    expect(at('max', '-2pi').a).toBe('2pi')
    expect(at('mid-down', '1/2').a).toBe('-1/2')
    expect(at('mid-up', '-1/2').a).toBe('1/2')
    expect(at('min', '-sqrt(2)').a).toBe('-sqrt(2)')
    // and the curve really does start there, at x = phase
    const h = Math.PI / 4
    expect(formula(at('max'), h)).toBeCloseTo(4, 12)
    expect(formula(at('min'), h)).toBeCloseTo(-2, 12)
    expect(formula(at('mid-up'), h)).toBeCloseTo(1, 12)
    expect(formula(at('mid-up'), h + 0.01)).toBeGreaterThan(1)
    expect(formula(at('mid-down'), h + 0.01)).toBeLessThan(1)
  })

  it('without start: the function asked for, a as given', () => {
    expect(sinFromParts({ amplitude: '-2', period: '2pi', phase: '0', midline: '0', fn: 'cos' })).toEqual(spec('cos', '-2', '1'))
    expect(sinFromParts({ amplitude: '2', period: '2pi', phase: '1', midline: '3' })).toEqual(spec('sin', '2', '1', '1', '3'))
  })
})

describe('sinFromExtrema', () => {
  it('an adjacent max and min → cos from the max', () => {
    const s = sinFromExtrema({ x: Math.PI / 2, y: 4 }, { x: Math.PI, y: -2 })!
    expect(s).toEqual(spec('cos', '3', '2', 'pi/2', '1'))
    // the same function as 3sin(2(x − π/4)) + 1
    expectSameFunction(s, spec('sin', '3', '2', 'pi/4', '1'))
    // plain numbers: a Ferris wheel read off its top and bottom
    expect(sinFromExtrema({ x: 6, y: 90 }, { x: 12, y: 10 })).toEqual(spec('cos', '40', 'pi/6', '6', '50'))
    // the min may come first
    const t = sinFromExtrema({ x: 3, y: 1 }, { x: 1, y: -1 })!
    expect(formula(t, 3)).toBeCloseTo(1, 12)
    expect(formula(t, 1)).toBeCloseTo(-1, 12)
    // awkward numbers still come out as the right function
    const u = sinFromExtrema({ x: 0.37, y: 2.2 }, { x: 1.91, y: -0.7 })!
    expect(formula(u, 0.37)).toBeCloseTo(2.2, 9)
    expect(formula(u, 1.91)).toBeCloseTo(-0.7, 9)
  })

  it('null when the points cannot be an adjacent max and min', () => {
    expect(sinFromExtrema({ x: 1, y: 4 }, { x: 1, y: -2 })).toBeNull()
    expect(sinFromExtrema({ x: 1, y: 2 }, { x: 3, y: 2 })).toBeNull()
    expect(sinFromExtrema({ x: 1, y: 1 }, { x: 3, y: 2 })).toBeNull()
    expect(sinFromExtrema({ x: NaN, y: 4 }, { x: 3, y: 2 })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// rewriteAs
// ---------------------------------------------------------------------------

describe('rewriteAs', () => {
  it('sin ⇄ cos by a quarter period, exactly', () => {
    expect(rewriteAs(spec('sin', '1', '1'), 'cos')).toEqual(spec('cos', '1', '1', 'pi/2'))
    expect(rewriteAs(spec('cos', '1', '1'), 'sin')).toEqual(spec('sin', '1', '1', '-pi/2'))
    expect(rewriteAs(spec('sin', '3', '2', 'pi/4', '1'), 'cos')).toEqual(spec('cos', '3', '2', 'pi/2', '1'))
    expect(rewriteAs(spec('cos', '-40', 'pi/6', '0', '50'), 'sin')).toEqual(spec('sin', '-40', 'pi/6', '-3', '50'))
    expect(rewriteAs(spec('sin', '1', '1', '1'), 'cos')).toEqual(spec('cos', '1', '1', '1 + pi/2'))
    expect(rewriteAs(spec('sin', '2', 'pi/6', 'pi/4', '0', 'f'), 'cos')).toEqual(spec('cos', '2', 'pi/6', '3 + pi/4', '0', 'f'))
  })

  it('a positive a by half a period', () => {
    expect(rewriteAs(spec('cos', '-40', 'pi/6', '0', '50'), 'cos', true)).toEqual(spec('cos', '40', 'pi/6', '6', '50'))
    expect(rewriteAs(spec('cos', '-40', 'pi/6', '0', '50'), 'sin', true)).toEqual(spec('sin', '40', 'pi/6', '3', '50'))
    expect(rewriteAs(spec('sin', '-1/2', '2', 'pi/4'), 'sin', true)).toEqual(spec('sin', '1/2', '2', '-pi/4'))
    // already positive, same function: nothing to do
    expect(rewriteAs(spec('sin', '3', '2', 'pi/4', '1'), 'sin', true)).toEqual(spec('sin', '3', '2', 'pi/4', '1'))
  })

  it('is the identical function, every way round, 120 random specs', () => {
    const rng = makeRng(77)
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rng() * xs.length)]
    const A = ['1', '-1', '3', '-2.5', '1/2', '-sqrt(2)']
    const B = ['1', '2', '-3', 'pi/6', '1/2', '0.75', 'e', '-pi']
    const H = ['0', 'pi/4', '-1', '2.5', '-pi/3', 'sqrt(2)', '1 + pi/2']
    const K = ['0', '1', '-4', '1/2']
    for (let i = 0; i < 120; i++) {
      const s = spec(rng() < 0.5 ? 'sin' : 'cos', pick(A), pick(B), pick(H), pick(K))
      for (const fn of ['sin', 'cos'] as const) {
        for (const pos of [false, true]) {
          const r = rewriteAs(s, fn, pos)
          expect(r.fn).toBe(fn)
          if (pos) expect(val(r.a)).toBeGreaterThan(0)
          expectParses(r)
          expectSameFunction(s, r)
        }
      }
    }
  })
})

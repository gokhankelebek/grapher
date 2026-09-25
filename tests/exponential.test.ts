import { describe, expect, it } from 'vitest'
import {
  expFeatures,
  expFromRate,
  expFromTwoPoints,
  expSource,
  rateOf,
  readExponential,
  type ExpSpec,
} from '../src/core/exponential'
import { parseExpression } from '../src/core/parse'
import { makeRng } from './helpers'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Constant string → number, through the app's own parser. */
function val(s: string): number {
  const o = parseExpression(s)
  if (!o.ok) throw new Error(`not a constant: ${s}`)
  const m = o.plot.makeModel('v')
  return m.evalExplicit!(o.plot.defaultParams, 0)
}

const spec = (a: string, b: string, p = '1', h = '0', k = '0', extra: Partial<ExpSpec> = {}): ExpSpec => ({
  a, b, p, h, k, ...extra,
})

/** y = a·b^((x − h)/p) + k, straight from the spec. */
function formula(s: ExpSpec, x: number): number {
  const a = val(s.a)
  const h = val(s.h)
  const k = val(s.k)
  const p = val(s.p)
  if (s.b === 'e') return a * Math.exp((val(s.rate ?? '1') * (x - h)) / p) + k
  return a * Math.pow(val(s.b), (x - h) / p) + k
}

/** Parse the source and compare it with the formula at 20 points. */
function expectParses(s: ExpSpec): string {
  const src = expSource(s)
  const o = parseExpression(src)
  expect(o.ok, `${src}: ${o.ok ? '' : o.error}`).toBe(true)
  if (!o.ok) return src
  expect(o.plot.kind).toBe('explicit')
  expect(o.plot.paramNames).toEqual([])
  const m = o.plot.makeModel('t')
  let checked = 0
  for (let i = 0; i < 20; i++) {
    const x = -4.9 + i * 0.5137
    const want = formula(s, x)
    if (!Number.isFinite(want) || Math.abs(want) > 1e9) continue
    const got = m.evalExplicit!(o.plot.defaultParams, x)
    expect(Math.abs(got - want), `${src} at x=${x}`).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(want)))
    checked++
  }
  expect(checked).toBeGreaterThan(10)
  return src
}

/**
 * The same function, up to normalisation: a negative p reads back as a
 * positive p with the base inverted, 1/n periods and rates may change text.
 */
function expectSameFunction(got: ExpSpec | null, want: ExpSpec, label = '') {
  expect(got, label).not.toBeNull()
  if (!got) return
  expect(got.name, label).toBe(want.name)
  expect(val(got.a), label).toBeCloseTo(val(want.a), 9)
  expect(val(got.k), label).toBeCloseTo(val(want.k), 9)
  expect(rateOf(got).perUnit, label).toBeCloseTo(rateOf(want).perUnit, 9)
  expect(got.b === 'e', label).toBe(want.b === 'e')
  expect(val(got.h), label).toBeCloseTo(val(want.h), 9)
  for (const x of [-2.3, -0.7, 0, 0.9, 2.4]) {
    const w = formula(want, x)
    expect(formula(got, x), `${label} at ${x}`).toBeCloseTo(w, Math.max(0, 9 - Math.ceil(Math.log10(Math.max(1, Math.abs(w))))))
  }
}

// ---------------------------------------------------------------------------
// expSource
// ---------------------------------------------------------------------------

describe('expSource', () => {
  const table: [ExpSpec, string][] = [
    [spec('3', '1.05'), 'y = 3(1.05)^x'],
    [spec('200', '1/2', '5.7', '0', '10'), 'y = 200(1/2)^(x/5.7) + 10'],
    [spec('-2', '3', '1', '1', '-4', { name: 'f' }), 'f(x) = -2(3)^(x - 1) - 4'],
    [spec('1', '2'), 'y = 2^x'],
    [spec('-1', '2'), 'y = -2^x'],
    [spec('-1', '1.05'), 'y = -(1.05)^x'],
    [spec('1', '1/2'), 'y = (1/2)^x'],
    [spec('3', '2'), 'y = 3(2)^x'],
    [spec('1', '2', '1', '-3'), 'y = 2^(x + 3)'],
    [spec('1', '1/2', '2', '-3'), 'y = (1/2)^((x + 3)/2)'],
    [spec('100', '0.8', '1', '0', '-4'), 'y = 100(0.8)^x - 4'],
    [spec('1/2', '3', '1/2', '1', '-1/2'), 'y = 1/2(3)^(2(x - 1)) - 1/2'],
    [spec('2', '3', '1/2'), 'y = 2(3)^(2x)'],
    [spec('1', '3', '-2'), 'y = 3^(-x/2)'],
    [spec('1', '3', '-1', '1'), 'y = 3^(-(x - 1))'],
    [spec('5', '2', '7/3'), 'y = 5(2)^(x/(7/3))'],
    [spec('5', '2', 'pi'), 'y = 5(2)^(x/pi)'],
    [spec('sqrt(3)/2', '2'), 'y = (sqrt(3)/2)(2)^x'],
    [spec('2', '1.05', '12', '1/2', 'sqrt(2)'), 'y = 2(1.05)^((x - 1/2)/12) + sqrt(2)'],
    [spec('1', '2', '1', '1+sqrt(2)', '1+sqrt(2)'), 'y = 2^(x - (1+sqrt(2))) + (1+sqrt(2))'],
    [spec('5', 'e', '1', '0', '0', { rate: '0.2' }), 'y = 5e^(0.2x)'],
    [spec('5', 'e', '1', '1', '3', { rate: '-0.2' }), 'y = 5e^(-0.2(x - 1)) + 3'],
    [spec('1', 'e', '1', '0', '0', { rate: '1' }), 'y = e^x'],
    [spec('-1', 'e', '1', '0', '0', { rate: '-1' }), 'y = -e^(-x)'],
    [spec('1', 'e', '1', '2', '0', { rate: '1' }), 'y = e^(x - 2)'],
    [spec('3', 'e', '1', '0', '0', { rate: '1/2' }), 'y = 3e^(1/2x)'],
    [spec('1/2', 'e', '1', '0', '0', { rate: 'pi' }), 'y = 1/2e^(pi x)'],
    [spec('2', 'e', '1', '-1', '0', { rate: '-1' }), 'y = 2e^(-(x + 1))'],
  ]
  for (const [s, src] of table) {
    it(src, () => {
      expect(expSource(s)).toBe(src)
      expectParses(s)
    })
  }

  it('blank fields read as their defaults', () => {
    expect(expSource({ a: '', b: '2', p: '', h: '', k: '' })).toBe('y = 2^x')
    expect(expSource({ a: '4', b: 'e', p: '1', h: '0', k: '0' })).toBe('y = 4e^x')
  })

  it('renders like a textbook in LaTeX', () => {
    const tex = (s: ExpSpec) => {
      const o = parseExpression(expSource(s))
      return o.ok ? o.plot.latex : o.error
    }
    expect(tex(spec('200', '1/2', '5.7', '0', '10'))).toBe('y = 200\\left(1/2\\right)^{x/5.7}+10')
    expect(tex(spec('1', '1/2', '2', '-3'))).toBe('y = \\left(1/2\\right)^{\\frac{x+3}{2}}')
    expect(tex(spec('1', '2', '1', '1', '5'))).toBe('y = 2^{x-1}+5')
    expect(tex(spec('1', 'e', '1', '0', '0', { rate: '-0.5' }))).toBe('y = e^{-0.5x}')
  })
})

// ---------------------------------------------------------------------------
// readExponential
// ---------------------------------------------------------------------------

describe('readExponential', () => {
  it('reads the canonical examples', () => {
    expect(readExponential('y = 3(1.05)^x')).toEqual(spec('3', '1.05'))
    expect(readExponential('y = 200(1/2)^(x/5.7) + 10')).toEqual(spec('200', '1/2', '5.7', '0', '10'))
    expect(readExponential('f(x) = -2(3)^(x - 1) - 4')).toEqual(spec('-2', '3', '1', '1', '-4', { name: 'f' }))
    expect(readExponential('y = 5e^(0.2x)')).toEqual(spec('5', 'e', '1', '0', '0', { rate: '0.2' }))
    expect(readExponential('y = 5e^(-0.2(x - 1)) + 3')).toEqual(spec('5', 'e', '1', '1', '3', { rate: '-0.2' }))
  })

  // [typed, a, b, p, h, k, rate?]
  const handTyped: [string, string, string, string, string, string, string?][] = [
    // bases without parentheses
    ['y = 5*1.05^x', '5', '1.05', '1', '0', '0'],
    ['5 * 0.8^x', '5', '0.8', '1', '0', '0'],
    ['0.5^x', '1', '0.5', '1', '0', '0'],
    ['1.05^x', '1', '1.05', '1', '0', '0'],
    // products in either order, implicit and explicit
    ['3*2^x', '3', '2', '1', '0', '0'],
    ['2^x*3', '3', '2', '1', '0', '0'],
    ['3 2^x', '3', '2', '1', '0', '0'],
    ['2^x·3', '3', '2', '1', '0', '0'],
    ['2^x/4', '1/4', '2', '1', '0', '0'],
    ['-2^x', '-1', '2', '1', '0', '0'], // −(2^x): ^ binds tighter than unary minus
    ['-(2)^x', '-1', '2', '1', '0', '0'],
    ['y = 3/2^x', '3', '1/2', '1', '0', '0'], // a/b^x → base 1/b
    // exponents
    ['4^(x/2)', '1', '4', '2', '0', '0'],
    ['3*2^(2x)', '3', '2', '1/2', '0', '0'],
    ['2^(x-1)+5', '1', '2', '1', '1', '5'],
    ['2^(x+3)', '1', '2', '1', '-3', '0'], // the shift stays in h
    ['2^(-x)', '1', '1/2', '1', '0', '0'], // textbook reading: (1/2)^x
    ['(1/2)^(-x)', '1', '2', '1', '0', '0'],
    ['0.8^(-x)', '1', '1.25', '1', '0', '0'],
    ['10^(0.1x)', '1', '10', '10', '0', '0'],
    ['2^(0.5x + 1)', '1', '2', '2', '-2', '0'],
    ['2^(x/5.7)', '1', '2', '5.7', '0', '0'],
    ['2^((x - 1)/5.7)', '1', '2', '5.7', '1', '0'],
    ['2^(2x/5)', '1', '2', '2.5', '0', '0'],
    ['2^(3x)', '1', '2', '1/3', '0', '0'],
    ['2^(3x/7)', '1', '2', '2.33333333333', '0', '0'], // 1/c not nice → 12 digits
    ['2^(x/pi)', '1', '2', 'pi', '0', '0'],
    ['2^(-(x - 1)/5.7)', '1', '1/2', '5.7', '1', '0'],
    // base e in every spelling
    ['e^x', '1', 'e', '1', '0', '0', '1'],
    ['50e^(0.3x)', '50', 'e', '1', '0', '0', '0.3'],
    ['exp(0.3x)', '1', 'e', '1', '0', '0', '0.3'],
    ['e^(-x/2)+1', '1', 'e', '1', '0', '1', '-0.5'],
    ['e^(-0.5x)', '1', 'e', '1', '0', '0', '-0.5'],
    ['2/e^x', '2', 'e', '1', '0', '0', '-1'],
    ['e^(0.2x + 1)', '1', 'e', '1', '-5', '0', '0.2'],
    // constants on either side, several folded
    ['4 + 3*2^x', '3', '2', '1', '0', '4'],
    ['3*2^x - 1 + 2', '3', '2', '1', '0', '1'],
    ['y = 10 + 200(1/2)^(x/5.7)', '200', '1/2', '5.7', '0', '10'],
    ['y = -4 - 2(3)^(x - 1)', '-2', '3', '1', '1', '-4'],
    // products of powers with one exponent fold into one base
    ['2^x*3^x', '1', '6', '1', '0', '0'],
    ['2^x/3^x', '1', '2/3', '1', '0', '0'],
    ['e^x*e^x', '1', 'e', '1', '0', '0', '2'],
  ]
  for (const [src, a, b, p, h, k, rate] of handTyped) {
    it(`reads ${src}`, () => {
      const got = readExponential(src)
      const want = spec(a, b, p, h, k, rate !== undefined ? { rate } : {})
      expect(got).toEqual(want)
      // and it really is the typed function
      const o = parseExpression(src)
      expect(o.ok).toBe(true)
      if (!o.ok) return
      const m = o.plot.makeModel('t')
      for (const x of [-1.7, 0, 0.6, 2.3]) {
        expect(formula(got!, x)).toBeCloseTo(m.evalExplicit!(o.plot.defaultParams, x), 8)
      }
    })
  }

  it('f(x) = … and y = … heads', () => {
    expect(readExponential('f(x) = 3(2)^x')).toEqual(spec('3', '2', '1', '0', '0', { name: 'f' }))
    expect(readExponential('g(x) = 2^x - 1')).toEqual(spec('1', '2', '1', '0', '-1', { name: 'g' }))
    expect(readExponential('y = 2^x')).toEqual(spec('1', '2'))
  })

  it('reads t as the variable (the parser plots y = f(t) against the horizontal axis)', () => {
    expect(parseExpression('y = 100(0.8)^t').ok).toBe(true)
    expect(readExponential('y = 100(0.8)^t')).toEqual(spec('100', '0.8'))
    expect(readExponential('A(t) = 100(0.8)^t')).toEqual(spec('100', '0.8', '1', '0', '0', { name: 'A' }))
    // the spec has no variable slot: the canonical source is written in x
    expect(expSource(readExponential('A(t) = 100(0.8)^t')!)).toBe('A(x) = 100(0.8)^x')
    // mixing is still refused
    expect(readExponential('y = 2^t + x')).toBeNull()
  })

  it('keeps the teacher’s number text', () => {
    expect(readExponential('y = 0.50(1.050)^x + 2.0')).toEqual(spec('0.50', '1.050', '1', '0', '2.0'))
    expect(readExponential('y = sqrt(2)(1.05)^x')?.a).toBe('sqrt(2)')
    expect(readExponential('y = 2^(x - 1/2)')?.h).toBe('1/2')
    expect(readExponential('y = 2^(x - 0.5)')?.h).toBe('0.5')
  })

  it('rejects everything else', () => {
    for (const src of [
      'y = 2^x + 3^x',
      'y = x*2^x',
      'y = x 2^x',
      'y = 2^(x^2)',
      'y = 2^(1/x)',
      'y = 2^x*3^(2x)', // different exponents: not folded
      'y = (2^x)^2',
      'y = sqrt(2^x)',
      'y = x^2',
      'y = 2x + 1',
      'y = 3',
      'y = 1^x',
      'y = (-2)^x',
      'y = 0*2^x',
      'y = a*2^x',
      'y = 2^x + y',
      'y = 2^x {x > 0}',
      'x = 2^y',
      'y = sin(2^x)',
      'y = e^x - e^x',
      'y = 2^x/2^x',
      '',
      'y = (',
    ]) {
      expect(readExponential(src), src).toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// round trip
// ---------------------------------------------------------------------------

describe('round trip', () => {
  const BASES = ['1/2', '2', '3', '1.05', '0.8', 'e']
  const A = ['1', '-1', '2', '-3', '1/2', '-2/3', '200', '0.5', '-1.5', 'sqrt(2)']
  const H = ['0', '0', '1', '-3', '1/2', '-2.5', '2', 'pi']
  const K = ['0', '0', '10', '-4', '1/2', '-0.5', '3', '-2/3']
  const P = ['1', '1', '2', '5.7', '1/2', '1/3', '-1', '-2', '7/3', '0.25', '12', '-1/2']
  const RATE = ['0.2', '-0.2', '1', '-1', '0.05', '1/2', '-3', '2']
  const rng = makeRng(20260925)
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]

  it('readExponential(expSource(spec)) is the spec up to normalisation, 200 random specs', () => {
    for (let t = 0; t < 200; t++) {
      const b = pick(BASES)
      const s: ExpSpec = { a: pick(A), b, p: b === 'e' ? '1' : pick(P), h: pick(H), k: pick(K) }
      if (b === 'e') s.rate = pick(RATE)
      if (rng() < 0.3) s.name = pick(['f', 'g', 'h'])
      const src = expectParses(s)
      const back = readExponential(src)
      expectSameFunction(back, s, src)
      // one normalisation later the canonical text is a fixed point
      const again = expSource(back!)
      expectSameFunction(readExponential(again), s, again)
      expect(expSource(readExponential(again)!), src).toBe(again)
    }
  })

  it('positive periods and plain rates are exact fixed points', () => {
    for (const s of [
      spec('200', '1/2', '5.7', '0', '10'),
      spec('-2', '3', '1', '1', '-4', { name: 'f' }),
      spec('3', '1.05', '12', '-1/2', '0'),
      spec('1', '0.8', '7/3', '2', '-0.5'),
      spec('5', 'e', '1', '1', '3', { rate: '-0.2' }),
    ]) {
      const src = expSource(s)
      expect(readExponential(src), src).toEqual(s)
    }
  })
})

// ---------------------------------------------------------------------------
// rateOf
// ---------------------------------------------------------------------------

describe('rateOf', () => {
  it('5% growth per unit', () => {
    const r = rateOf(spec('3', '1.05'))
    expect(r.perUnit).toBeCloseTo(1.05, 12)
    expect(r.percentPerUnit).toBeCloseTo(5, 10)
    expect(r.continuous).toBeCloseTo(Math.log(1.05), 12)
    expect(r.doubling).toBeCloseTo(14.2067, 4)
    expect(r.halfLife).toBeNull()
    expect(r.sentences).toEqual([
      'grows by 5% per unit',
      'growth factor 1.05 per unit',
      'continuous rate 4.879% per unit',
      'doubles every 14.21 units',
    ])
  })

  it('half-life 5.7: the teacher’s period leads, per-unit rates follow', () => {
    const r = rateOf(spec('200', '1/2', '5.7', '0', '10'))
    expect(r.halfLife).toBeCloseTo(5.7, 10)
    expect(r.doubling).toBeNull()
    expect(r.percentPerUnit).toBeCloseTo(-11.4502, 3)
    expect(r.sentences).toEqual([
      'decays by 50% every 5.7 units',
      'decays by 11.45% per unit',
      'decay factor 0.5 every 5.7 units',
      'decay factor 0.8855 per unit',
      'continuous rate −12.16% per unit',
      'half-life 5.7 units',
    ])
  })

  it('base e: the continuous rate is the rate', () => {
    const r = rateOf(spec('5', 'e', '1', '0', '0', { rate: '0.2' }))
    expect(r.continuous).toBeCloseTo(0.2, 12)
    expect(r.perUnit).toBeCloseTo(Math.exp(0.2), 12)
    expect(r.sentences).toContain('continuous rate 20% per unit')
    expect(r.sentences).toContain('doubles every 3.466 units')
    const d = rateOf(spec('5', 'e', '1', '0', '0', { rate: '-0.5' }))
    expect(d.halfLife).toBeCloseTo(Math.LN2 / 0.5, 12)
    expect(d.sentences).toContain('half-life 1.386 units')
  })

  it('negative a flips the graph, not the rate words', () => {
    const up = rateOf(spec('3', '2'))
    const down = rateOf(spec('-3', '2'))
    expect(down.perUnit).toBe(up.perUnit)
    expect(down.sentences.slice(0, up.sentences.length)).toEqual(up.sentences)
    expect(down.sentences.at(-1)).toBe('reflected: a < 0')
    expect(up.sentences).not.toContain('reflected: a < 0')
  })

  it('doubling every 3 units and the singular unit', () => {
    const r = rateOf(spec('1', '2', '3'))
    expect(r.doubling).toBeCloseTo(3, 12)
    expect(r.sentences[0]).toBe('grows by 100% every 3 units')
    expect(r.sentences).toContain('doubles every 3 units')
    expect(rateOf(spec('1', '2')).sentences).toContain('doubles every unit')
  })

  it('base 1 and nonsense bases', () => {
    expect(rateOf(spec('2', '1')).sentences).toEqual(['constant: no growth or decay'])
    const bad = rateOf(spec('2', '-2'))
    expect(bad.perUnit).toBeNaN()
    expect(bad.sentences).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// expFromTwoPoints
// ---------------------------------------------------------------------------

describe('expFromTwoPoints', () => {
  const through = (s: ExpSpec, pts: { x: number; y: number }[]) => {
    for (const q of pts) expect(formula(s, q.x)).toBeCloseTo(q.y, 4)
  }

  it('x1 = 0 gives a = y1 exactly', () => {
    const s = expFromTwoPoints({ x: 0, y: 100 }, { x: 2, y: 110.25 })
    expect(s).toEqual(spec('100', '1.05'))
  })

  it('a point on x = 0 in second place', () => {
    expect(expFromTwoPoints({ x: 3, y: 1 }, { x: 0, y: 8 })).toEqual(spec('8', '0.5'))
  })

  it('whole-number results stay whole', () => {
    const s = expFromTwoPoints({ x: 1, y: 6 }, { x: 3, y: 24 })
    expect(s).toEqual(spec('3', '2'))
  })

  it('a clean a at h = 0 is kept as a fraction', () => {
    const s = expFromTwoPoints({ x: 1, y: 5 }, { x: 2, y: 7 })
    expect(s).toEqual(spec('25/7', '1.4'))
    through(s!, [{ x: 1, y: 5 }, { x: 2, y: 7 }])
  })

  it('an unclean a anchors at the first point instead', () => {
    const s = expFromTwoPoints({ x: 1, y: 7 }, { x: 3, y: 13 }, 4)
    expect(s).toEqual(spec('3', '1.73205', '1', '1', '4'))
    through(s!, [{ x: 1, y: 7 }, { x: 3, y: 13 }])
  })

  it('k ≠ 0, below the asymptote', () => {
    const s = expFromTwoPoints({ x: 0, y: 6 }, { x: 1, y: 8 }, 10)
    expect(s).toEqual(spec('-4', '0.5', '1', '0', '10'))
    through(s!, [{ x: 0, y: 6 }, { x: 1, y: 8 }])
  })

  it('refuses: shared x, opposite sides of k, on k, equal heights, non-finite', () => {
    expect(expFromTwoPoints({ x: 1, y: 2 }, { x: 1, y: 4 })).toBeNull()
    expect(expFromTwoPoints({ x: 0, y: 2 }, { x: 1, y: -4 })).toBeNull()
    expect(expFromTwoPoints({ x: 0, y: 12 }, { x: 1, y: 8 }, 10)).toBeNull()
    expect(expFromTwoPoints({ x: 0, y: 10 }, { x: 1, y: 8 }, 10)).toBeNull()
    expect(expFromTwoPoints({ x: 0, y: 3 }, { x: 1, y: 3 })).toBeNull()
    expect(expFromTwoPoints({ x: 0, y: NaN }, { x: 1, y: 3 })).toBeNull()
  })

  it('the result parses and passes through both points (random)', () => {
    const rng = makeRng(7)
    for (let i = 0; i < 50; i++) {
      const k = Math.round(rng() * 10 - 5)
      const sgn = rng() < 0.5 ? -1 : 1
      const p1 = { x: Math.round(rng() * 8 - 4), y: k + sgn * (0.5 + rng() * 20) }
      const p2 = { x: p1.x + 1 + Math.round(rng() * 4), y: k + sgn * (0.5 + rng() * 20) }
      const s = expFromTwoPoints(p1, p2, k)
      if (p1.y === p2.y) continue
      expect(s).not.toBeNull()
      expectParses(s!)
      // 6 significant digits in b: close, not exact
      for (const q of [p1, p2]) {
        expect(Math.abs(formula(s!, q.x) - q.y)).toBeLessThan(1e-4 * Math.max(1, Math.abs(q.y)) * 10)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// expFromRate
// ---------------------------------------------------------------------------

describe('expFromRate', () => {
  it('factor', () => {
    expect(expFromRate('3', { kind: 'factor', b: '1.05' })).toEqual(spec('3', '1.05'))
    expect(expFromRate('3', { kind: 'factor', b: '2', per: '4' })).toEqual(spec('3', '2', '4'))
  })

  it('percent', () => {
    expect(expFromRate('100', { kind: 'percent', pct: '5', grows: true })).toEqual(spec('100', '1.05'))
    expect(expFromRate('100', { kind: 'percent', pct: '20', grows: false })).toEqual(spec('100', '0.8'))
    expect(expFromRate('100', { kind: 'percent', pct: '12.5', grows: true, per: '12' })).toEqual(spec('100', '1.125', '12'))
    expect(expFromRate('100', { kind: 'percent', pct: '100/3', grows: true })).toEqual(spec('100', '4/3'))
  })

  it('doubling time and half-life', () => {
    expect(expFromRate('50', { kind: 'doubling', time: '3' })).toEqual(spec('50', '2', '3'))
    expect(expFromRate('200', { kind: 'half-life', time: '5.7' })).toEqual(spec('200', '1/2', '5.7'))
    expect(rateOf(expFromRate('200', { kind: 'half-life', time: '5.7' })).halfLife).toBeCloseTo(5.7, 12)
  })

  it('continuous', () => {
    expect(expFromRate('3', { kind: 'continuous', r: '0.04' })).toEqual(spec('3', 'e', '1', '0', '0', { rate: '0.04' }))
    expect(expSource(expFromRate('3', { kind: 'continuous', r: '0.04' }))).toBe('y = 3e^(0.04x)')
  })

  it('"starts at 200" means f(0) = 200, so a = init − k', () => {
    const s = expFromRate('200', { kind: 'half-life', time: '5.7' }, '10')
    expect(s).toEqual(spec('190', '1/2', '5.7', '0', '10'))
    expect(formula(s, 0)).toBeCloseTo(200, 12)
    expect(expFromRate('1.5', { kind: 'factor', b: '2' }, '0.25').a).toBe('1.25')
    expect(expFromRate('1', { kind: 'factor', b: '2' }, '1/3').a).toBe('2/3')
    const sym = expFromRate('pi', { kind: 'factor', b: '2' }, '1')
    expect(val(sym.a)).toBeCloseTo(Math.PI - 1, 12)
    expect(formula(sym, 0)).toBeCloseTo(Math.PI, 12)
  })
})

// ---------------------------------------------------------------------------
// expFeatures
// ---------------------------------------------------------------------------

describe('expFeatures', () => {
  it('decay above the asymptote', () => {
    expect(expFeatures(spec('200', '1/2', '5.7', '0', '10'))).toEqual({
      yIntercept: 210,
      asymptote: 10,
      increasing: false,
      concaveUp: true,
      domain: 'all real numbers',
      range: 'y > 10',
      endBehaviour: 'as x → −∞, y → ∞; as x → ∞, y → 10',
    })
  })

  it('growth reflected below the asymptote', () => {
    const f = expFeatures(spec('-2', '3', '1', '1', '-4'))
    expect(f.yIntercept).toBeCloseTo(-2 / 3 - 4, 12)
    expect(f.asymptote).toBe(-4)
    expect(f.increasing).toBe(false)
    expect(f.concaveUp).toBe(false)
    expect(f.range).toBe('y < −4')
    expect(f.endBehaviour).toBe('as x → −∞, y → −4; as x → ∞, y → −∞')
  })

  it('growth, and reflected decay, increase', () => {
    const g = expFeatures(spec('3', '1.05'))
    expect(g.increasing).toBe(true)
    expect(g.concaveUp).toBe(true)
    expect(g.range).toBe('y > 0')
    expect(g.endBehaviour).toBe('as x → −∞, y → 0; as x → ∞, y → ∞')
    const r = expFeatures(spec('-1', '0.5'))
    expect(r.increasing).toBe(true)
    expect(r.concaveUp).toBe(false)
    expect(r.endBehaviour).toBe('as x → −∞, y → −∞; as x → ∞, y → 0')
  })

  it('base e and a negative p', () => {
    const e = expFeatures(spec('5', 'e', '1', '1', '3', { rate: '-0.2' }))
    expect(e.yIntercept).toBeCloseTo(5 * Math.exp(0.2) + 3, 12)
    expect(e.increasing).toBe(false)
    expect(e.range).toBe('y > 3')
    // 3^(−x/2) is decay
    expect(expFeatures(spec('1', '3', '-2')).increasing).toBe(false)
  })

  it('base 1 is a constant', () => {
    const c = expFeatures(spec('2', '1', '1', '0', '3'))
    expect(c.range).toBe('y = 5')
    expect(c.endBehaviour).toBe('constant: y = 5')
  })
})

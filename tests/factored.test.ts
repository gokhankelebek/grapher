import { describe, expect, it } from 'vitest'
import {
  endBehaviour,
  factoredSource,
  leadingThrough,
  readFactored,
  rootsOf,
  type Factor,
  type FactoredSpec,
} from '../src/core/factored'
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

const r = (root: string, mult = 1): Factor => ({ root, mult })
const cx = (re: string, im: string, mult = 1): Factor => ({ complex: { re, im }, mult })
const poly = (a: string, num: Factor[], name?: string): FactoredSpec =>
  name ? { name, a, num, den: [] } : { a, num, den: [] }

/** The product formula, straight from the spec. */
function formula(spec: FactoredSpec, x: number): number {
  const f = (fs: Factor[]) =>
    fs.reduce((p, g) => {
      const base = g.complex
        ? (x - val(g.complex.re)) ** 2 + val(g.complex.im) ** 2
        : x - val(g.root!)
      return p * base ** g.mult
    }, 1)
  return (val(spec.a) * f(spec.num)) / f(spec.den)
}

/** Parse the source and compare it with the formula at 20 points (poles skipped). */
function expectRoundTrip(spec: FactoredSpec): string {
  const src = factoredSource(spec)
  const o = parseExpression(src)
  expect(o.ok, `${src}: ${o.ok ? '' : o.error}`).toBe(true)
  if (!o.ok) return src
  expect(o.plot.kind).toBe('explicit')
  expect(o.plot.paramNames).toEqual([])
  const m = o.plot.makeModel('t')
  let checked = 0
  for (let i = 0; i < 20; i++) {
    const x = -4.9 + i * 0.5137
    const want = formula(spec, x)
    if (!Number.isFinite(want) || Math.abs(want) > 1e9) continue
    const got = m.evalExplicit!(o.plot.defaultParams, x)
    expect(Math.abs(got - want), `${src} at x=${x}`).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(want)))
    checked++
  }
  expect(checked).toBeGreaterThan(10)
  return src
}

/** Spec equality up to ordering and string normalisation (values compared). */
function expectSameSpec(got: FactoredSpec | null, want: FactoredSpec) {
  expect(got).not.toBeNull()
  if (!got) return
  expect(got.name).toBe(want.name)
  expect(val(got.a)).toBeCloseTo(val(want.a), 10)
  for (const side of ['num', 'den'] as const) {
    const key = (f: Factor) =>
      f.complex ? [1, val(f.complex.re), Math.abs(val(f.complex.im)), f.mult] : [0, val(f.root!), 0, f.mult]
    const sort = (fs: Factor[]) =>
      fs.map(key).sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2])
    const g = sort(got[side])
    const w = sort(want[side])
    expect(g.length, side).toBe(w.length)
    g.forEach((k, i) => {
      expect(k[0]).toBe(w[i][0])
      expect(k[1]).toBeCloseTo(w[i][1], 9)
      expect(k[2]).toBeCloseTo(w[i][2], 9)
      expect(k[3]).toBe(w[i][3])
    })
  }
}

// ---------------------------------------------------------------------------
// factoredSource
// ---------------------------------------------------------------------------

describe('factoredSource', () => {
  const table: [FactoredSpec, string][] = [
    [poly('2', [r('-1', 2), r('3')]), 'y = 2(x + 1)^2(x - 3)'],
    [poly('2', [r('3'), r('-1', 2)]), 'y = 2(x + 1)^2(x - 3)'],
    [poly('-1', [r('0'), r('1/2')]), 'y = -x(x - 1/2)'],
    [poly('1', [r('sqrt(2)'), r('-sqrt(2)')]), 'y = (x + sqrt(2))(x - sqrt(2))'],
    [poly('1', [cx('0', '1')]), 'y = (x^2 + 1)'],
    [poly('1', [cx('1', '2')]), 'y = (x^2 - 2x + 5)'],
    [poly('3', [cx('0', '2', 2)]), 'y = 3(x^2 + 4)^2'],
    [poly('1', [cx('1/2', '1')]), 'y = (x^2 - x + 5/4)'],
    [poly('1', [cx('3/4', '1')]), 'y = (x^2 - 3x/2 + 25/16)'],
    [{ a: '1', num: [r('1')], den: [r('3'), r('-1')] }, 'y = (x - 1)/((x + 1)(x - 3))'],
    [poly('2', [r('-1', 2), r('3')], 'f'), 'f(x) = 2(x + 1)^2(x - 3)'],
    [poly('1', [r('0', 3)]), 'y = x^3'],
    [poly('1', [r('-2'), r('0'), r('1')]), 'y = x(x + 2)(x - 1)'],
    [poly('sqrt(3)', [r('1')]), 'y = sqrt(3)(x - 1)'],
    [poly('-sqrt(3)', [r('1')]), 'y = -sqrt(3)(x - 1)'],
    [poly('sqrt(3)/2', [r('1')]), 'y = (sqrt(3)/2)(x - 1)'],
    [poly('1/2', [r('1')]), 'y = 1/2(x - 1)'],
    [poly('2pi', [r('0')]), 'y = 2pi x'],
    [poly('3', []), 'y = 3'],
    [poly('1', [r('pi/4'), r('-2pi')]), 'y = (x + 2pi)(x - pi/4)'],
    [poly('1', [r('1-sqrt(2)')]), 'y = (x - (1-sqrt(2)))'],
    [poly('1', [r('-1/2'), r('-1/2')]), 'y = (x + 1/2)^2'],
    [{ a: '2', num: [], den: [r('3'), r('-1')] }, 'y = 2/((x + 1)(x - 3))'],
    [{ a: '1', num: [], den: [r('3')] }, 'y = 1/(x - 3)'],
    [{ a: '-1', num: [], den: [r('0', 2)] }, 'y = -1/(x^2)'],
    [{ a: '1', num: [r('1')], den: [r('-2', 2)] }, 'y = (x - 1)/((x + 2)^2)'],
    [{ a: '1', num: [r('1'), r('-2', 2)], den: [r('3'), r('-1')] }, 'y = (x + 2)^2(x - 1)/((x + 1)(x - 3))'],
    [{ a: '4', num: [cx('0', '1')], den: [cx('0', '2')] }, 'y = 4(x^2 + 1)/(x^2 + 4)'],
  ]
  for (const [spec, src] of table) {
    it(src, () => {
      expect(factoredSource(spec)).toBe(src)
      expectRoundTrip(spec)
    })
  }

  it('reads like a textbook in LaTeX', () => {
    const o = parseExpression(factoredSource(poly('2', [r('-1', 2), r('3')])))
    expect(o.ok && o.plot.latex).toBe('y = 2\\left(x+1\\right)^{2}\\left(x-3\\right)')
    const q = parseExpression(factoredSource({ a: '1', num: [r('1')], den: [r('3'), r('-1')] }))
    expect(q.ok && q.plot.latex).toBe('y = \\frac{x-1}{\\left(x+1\\right)\\left(x-3\\right)}')
  })
})

// ---------------------------------------------------------------------------
// readFactored
// ---------------------------------------------------------------------------

describe('readFactored', () => {
  it('reads the canonical examples', () => {
    expect(readFactored('y = 2(x + 1)^2(x - 3)')).toEqual({
      a: '2',
      num: [r('-1', 2), r('3')],
      den: [],
    })
    expect(readFactored('f(x) = -x(x - 1/2)')).toEqual({
      name: 'f',
      a: '-1',
      num: [r('0'), r('1/2')],
      den: [],
    })
    expect(readFactored('y = (x - 1)/((x + 1)(x - 3))')).toEqual({
      a: '1',
      num: [r('1')],
      den: [r('-1'), r('3')],
    })
  })

  it('(3 - x) folds its sign into a', () => {
    expect(readFactored('y = (3 - x)')).toEqual({ a: '-1', num: [r('3')], den: [] })
    expect(readFactored('y = 2(3 - x)(x + 1)')).toEqual({ a: '-2', num: [r('-1'), r('3')], den: [] })
  })

  it('(2x - 3)^2 folds k^m into a and keeps the root exact', () => {
    expect(readFactored('y = (2x - 3)^2')).toEqual({ a: '4', num: [r('3/2', 2)], den: [] })
    expect(readFactored('y = (3x + 1)')).toEqual({ a: '3', num: [r('-1/3')], den: [] })
    expect(readFactored('y = (x/2 - 1)')).toEqual({ a: '1/2', num: [r('2')], den: [] })
  })

  it('powers of x and repeated factors merge', () => {
    expect(readFactored('y = x^3')).toEqual({ a: '1', num: [r('0', 3)], den: [] })
    expect(readFactored('y = (x-1)(x-1)')).toEqual({ a: '1', num: [r('1', 2)], den: [] })
    expect(readFactored('y = x x (x+2)')).toEqual({ a: '1', num: [r('-2'), r('0', 2)], den: [] })
    expect(readFactored('y = (x-1)(x+2)(x-1)^2')).toEqual({ a: '1', num: [r('-2'), r('1', 3)], den: [] })
  })

  it('irreducible quadratics become complex pairs', () => {
    expect(readFactored('y = (x^2+4)')).toEqual({ a: '1', num: [cx('0', '2')], den: [] })
    expect(readFactored('y = (x^2 - 2x + 5)^2')).toEqual({ a: '1', num: [cx('1', '2', 2)], den: [] })
    expect(readFactored('y = (x^2 + x + 1)')).toEqual({ a: '1', num: [cx('-1/2', 'sqrt(3)/2')], den: [] })
    expect(readFactored('y = (x^2 + 2)')).toEqual({ a: '1', num: [cx('0', 'sqrt(2)')], den: [] })
    expect(readFactored('y = 3(2x^2 + 8)')).toEqual({ a: '6', num: [cx('0', '2')], den: [] })
  })

  it('reducible quadratics factor into real roots', () => {
    expect(readFactored('y = (x^2-2)')).toEqual({ a: '1', num: [r('-sqrt(2)'), r('sqrt(2)')], den: [] })
    expect(readFactored('y = 2(x^2 - 1)')).toEqual({ a: '2', num: [r('-1'), r('1')], den: [] })
    expect(readFactored('y = (x^2 - 2x - 1)')).toEqual({
      a: '1',
      num: [r('1-sqrt(2)'), r('1+sqrt(2)')],
      den: [],
    })
    expect(readFactored('y = (x^2 - 4x + 4)')).toEqual({ a: '1', num: [r('2', 2)], den: [] })
    expect(readFactored('y = 1/(x^2 - 9)')).toEqual({ a: '1', num: [], den: [r('-3'), r('3')] })
  })

  it('keeps root and coefficient text', () => {
    expect(readFactored('y = (x - sqrt(2))(x + sqrt(2))')).toEqual({
      a: '1',
      num: [r('-sqrt(2)'), r('sqrt(2)')],
      den: [],
    })
    expect(readFactored('y = sqrt(3)(x - pi/4)')).toEqual({ a: 'sqrt(3)', num: [r('pi/4')], den: [] })
    expect(readFactored('y = 0.5(x - 0.25)')).toEqual({ a: '0.5', num: [r('0.25')], den: [] })
    expect(readFactored('y = -1/2(x + 2pi)')).toEqual({ a: '-1/2', num: [r('-2pi')], den: [] })
    expect(readFactored('y = (sqrt(3)/2)(x - 1)')).toEqual({ a: 'sqrt(3)/2', num: [r('1')], den: [] })
    expect(readFactored('y = (x - 1)/2')).toEqual({ a: '1/2', num: [r('1')], den: [] })
  })

  it('reads hand-typed variants', () => {
    expect(readFactored('(x-1)^2(x+3)')).toEqual({ a: '1', num: [r('-3'), r('1', 2)], den: [] })
    expect(readFactored('y = 5')).toEqual({ a: '5', num: [], den: [] })
    expect(readFactored('y = (x-1)*(x+2)')).toEqual({ a: '1', num: [r('-2'), r('1')], den: [] })
    expect(readFactored('y=3/(x*(x-2)^2)')).toEqual({ a: '3', num: [], den: [r('0'), r('2', 2)] })
    expect(readFactored('y = -(x^2 + 1)')).toEqual({ a: '-1', num: [cx('0', '1')], den: [] })
    expect(readFactored('y = (x - 1)/sqrt(2)')).toEqual({ a: '1/sqrt(2)', num: [r('1')], den: [] })
  })

  it('rejects everything else', () => {
    for (const src of [
      'y = x^2 - 1',
      'y = x - 1',
      'y = x^2 + 1',
      'y = -x^2 + 1',
      'y = sin(x)(x-1)',
      'y = (x-1)^0.5',
      'y = (x-1)^(-1)',
      'y = x^x',
      'y = (x^3 - 1)',
      'y = a(x - 1)',
      'y = (x-1)(x+2) + 1',
      'y = sqrt(x - 1)',
      'y = x^2 {0 < x < 3}',
      'y = { x if x < 0 ; -x if x >= 0 }',
      'x^2 + y^2 = 4',
      'r = 2(theta - 1)',
      'y = (x - 1',
      '',
    ]) {
      expect(readFactored(src), src).toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// round trip, property-tested
// ---------------------------------------------------------------------------

describe('round trip', () => {
  const ROOTS = ['-3', '-2', '-1', '0', '1', '2', '3', '4', '1/2', '-1/2', '3/2', '-5/2', '2/3',
    'sqrt(2)', '-sqrt(2)', 'sqrt(3)', '-sqrt(5)', 'pi', '-pi/2', '2pi', '0.25', '-1.5']
  const COEFS = ['1', '-1', '2', '-3', '1/2', '-2/3', '5', 'sqrt(3)', '-sqrt(2)', '0.5', '2pi', 'sqrt(3)/2']
  const RE = ['0', '1', '-2', '1/2', '3']
  const IM = ['1', '2', '3', '1/2', 'sqrt(2)', 'sqrt(3)']
  const rng = makeRng(20260922)
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]

  function randomSide(maxReal: number, used: Set<string>): Factor[] {
    const out: Factor[] = []
    const n = Math.floor(rng() * (maxReal + 1))
    for (let i = 0; i < n; i++) {
      const root = pick(ROOTS)
      if (used.has(root)) continue
      used.add(root)
      out.push(r(root, 1 + Math.floor(rng() * 3)))
    }
    if (rng() < 0.3) {
      const re = pick(RE)
      const im = pick(IM)
      if (!used.has(`c${re},${im}`)) {
        used.add(`c${re},${im}`)
        out.push(cx(re, im, 1 + Math.floor(rng() * 2)))
      }
    }
    return out
  }

  it('readFactored(factoredSource(spec)) is the spec, 200 random specs', () => {
    for (let t = 0; t < 200; t++) {
      const used = new Set<string>()
      const spec: FactoredSpec = { a: pick(COEFS), num: randomSide(4, used), den: [] }
      if (rng() < 0.5) spec.den = randomSide(3, used)
      if (rng() < 0.3) spec.name = pick(['f', 'g', 'h'])
      const src = expectRoundTrip(spec)
      const back = readFactored(src)
      expect(back, src).not.toBeNull()
      expectSameSpec(back, spec)
      // and the canonical text is a fixed point
      expect(factoredSource(back!)).toBe(src)
    }
  })

  it('shared roots (holes) survive the round trip', () => {
    const spec: FactoredSpec = { a: '2', num: [r('1', 2), r('-3')], den: [r('1'), r('4')] }
    const src = expectRoundTrip(spec)
    expect(src).toBe('y = 2(x + 3)(x - 1)^2/((x - 1)(x - 4))')
    expectSameSpec(readFactored(src), spec)
  })
})

// ---------------------------------------------------------------------------
// rootsOf
// ---------------------------------------------------------------------------

describe('rootsOf', () => {
  it('numerator behaviours: crosses, touches, flattens', () => {
    const roots = rootsOf(poly('1', [r('3'), r('-1', 2), r('0', 3), r('2', 4), cx('0', '1')]))
    expect(roots.map((q) => [q.x, q.side, q.mult, q.behaviour, q.index])).toEqual([
      [-1, 'num', 2, 'touches', 1],
      [0, 'num', 3, 'flattens', 2],
      [2, 'num', 4, 'touches', 3],
      [3, 'num', 1, 'crosses', 0],
    ])
  })

  it('denominator behaviours: odd and even asymptotes', () => {
    const roots = rootsOf({ a: '1', num: [r('sqrt(2)')], den: [r('1'), r('-2', 2)] })
    expect(roots.map((q) => [q.side, q.behaviour, q.index])).toEqual([
      ['den', 'asymptote-even', 1],
      ['den', 'asymptote-odd', 0],
      ['num', 'crosses', 0],
    ])
    expect(roots[2].x).toBeCloseTo(Math.SQRT2, 12)
  })

  it('cancellation: m = n is a hole, m > n a hole on the axis, m < n an asymptote', () => {
    const eq = rootsOf({ a: '1', num: [r('2'), r('5')], den: [r('2')] })
    expect(eq).toEqual([
      { x: 2, side: 'both', mult: 0, behaviour: 'hole', index: 0 },
      { x: 5, side: 'num', mult: 1, behaviour: 'crosses', index: 1 },
    ])
    const more = rootsOf({ a: '1', num: [r('0', 3)], den: [r('0')] })
    expect(more).toEqual([{ x: 0, side: 'both', mult: 2, behaviour: 'hole', index: 0 }])
    const less = rootsOf({ a: '1', num: [r('1')], den: [r('-1'), r('1', 3)] })
    expect(less).toEqual([
      { x: -1, side: 'den', mult: 1, behaviour: 'asymptote-odd', index: 0 },
      { x: 1, side: 'both', mult: 2, behaviour: 'asymptote-even', index: 0 },
    ])
    const lessOdd = rootsOf({ a: '1', num: [r('1')], den: [r('1', 2)] })
    expect(lessOdd[0].behaviour).toBe('asymptote-odd')
  })

  it('agrees with the graph it describes (sign changes)', () => {
    const spec: FactoredSpec = { a: '1', num: [r('-2'), r('1', 2)], den: [r('3'), r('-4', 2)] }
    for (const q of rootsOf(spec)) {
      const lo = formula(spec, q.x - 1e-3)
      const hi = formula(spec, q.x + 1e-3)
      const flips = Math.sign(lo) !== Math.sign(hi)
      const odd = q.behaviour === 'crosses' || q.behaviour === 'flattens' || q.behaviour === 'asymptote-odd'
      expect(flips, `x=${q.x}`).toBe(odd)
    }
  })

  it('lists no complex roots', () => {
    expect(rootsOf(poly('1', [cx('1', '2'), cx('0', '1', 2)]))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// leadingThrough
// ---------------------------------------------------------------------------

describe('leadingThrough', () => {
  it('solves for a', () => {
    const spec = poly('1', [r('-1', 2), r('3')])
    // at x = 1: (2)^2(−2) = −8, so a = 16 / −8 = −2
    expect(leadingThrough(spec, { x: 1, y: 16 })).toBe(-2)
    const rat: FactoredSpec = { a: '1', num: [r('1')], den: [r('3')] }
    // at x = 2: (1)/(−1) = −1
    expect(leadingThrough(rat, { x: 2, y: 5 })).toBe(-5)
    expect(leadingThrough(poly('1', [cx('0', '1')]), { x: 1, y: 6 })).toBe(3)
  })

  it('is null on a root, on a pole, and at non-finite products', () => {
    const spec: FactoredSpec = { a: '1', num: [r('-1', 2), r('3')], den: [r('2')] }
    expect(leadingThrough(spec, { x: 3, y: 1 })).toBeNull()
    expect(leadingThrough(spec, { x: -1, y: 1 })).toBeNull()
    expect(leadingThrough(spec, { x: 2, y: 1 })).toBeNull()
    expect(leadingThrough(spec, { x: NaN, y: 1 })).toBeNull()
    // a hole: the root is in both — the point sits on a denominator root
    expect(leadingThrough({ a: '1', num: [r('2')], den: [r('2')] }, { x: 2, y: 1 })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// endBehaviour
// ---------------------------------------------------------------------------

describe('endBehaviour', () => {
  it('polynomials', () => {
    expect(endBehaviour(poly('2', [r('-1', 2), r('3')]))).toBe(
      'degree 3, leading coefficient positive: falls to the left, rises to the right',
    )
    expect(endBehaviour(poly('-1', [r('0'), r('1/2'), r('2')]))).toBe(
      'degree 3, leading coefficient negative: rises to the left, falls to the right',
    )
    expect(endBehaviour(poly('1', [cx('0', '1'), r('2', 2)]))).toBe(
      'degree 4, leading coefficient positive: rises to the left, rises to the right',
    )
    expect(endBehaviour(poly('-sqrt(2)', [r('1', 2)]))).toBe(
      'degree 2, leading coefficient negative: falls to the left, falls to the right',
    )
    expect(endBehaviour(poly('-3', []))).toBe('degree 0: constant, y = −3')
  })

  it('rational functions', () => {
    expect(endBehaviour({ a: '1', num: [r('1')], den: [r('3'), r('-1')] })).toBe(
      'degrees 1/2: horizontal asymptote y = 0',
    )
    expect(endBehaviour({ a: '-2/3', num: [r('1'), r('2')], den: [r('3'), r('-1')] })).toBe(
      'degrees 2/2: horizontal asymptote y = −0.6667',
    )
    expect(endBehaviour({ a: '2', num: [cx('0', '1')], den: [r('3', 2)] })).toBe(
      'degrees 2/2: horizontal asymptote y = 2',
    )
    expect(endBehaviour({ a: '1', num: [r('1', 3)], den: [r('3'), r('-1')] })).toBe(
      'degrees 3/2: slant asymptote',
    )
    expect(endBehaviour({ a: '2', num: [r('1', 3), cx('0', '1')], den: [r('3')] })).toBe(
      'degrees 5/1: no horizontal or slant asymptote; behaves like 2x^4 at the ends',
    )
    expect(endBehaviour({ a: '-1', num: [r('1', 3)], den: [r('3')] })).toBe(
      'degrees 3/1: no horizontal or slant asymptote; behaves like −x^2 at the ends',
    )
  })
})

import { describe, expect, it } from 'vitest'
import type { FittedCurve } from '../src/core/types'
import {
  expAsInverse,
  logAsInverse,
  logFeatures,
  logFromTwoPoints,
  logSource,
  readLogarithmic,
  rebase,
  type LogSpec,
} from '../src/core/logarithmic'
import { expSource, type ExpSpec } from '../src/core/exponential'
import { parseExpression } from '../src/core/parse'
import { analyzeCurve } from '../src/core/analyze'
import { findAsymptotes } from '../src/core/holes'
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

const spec = (a: string, b: string, c = '1', h = '0', k = '0', name?: string): LogSpec =>
  name ? { name, a, b, c, h, k } : { a, b, c, h, k }

const baseOf = (b: string) => (b === 'e' ? Math.E : val(b))

/** y = a·log_b(c(x − h)) + k, straight from the spec. */
function formula(s: LogSpec, x: number): number {
  return (val(s.a) * Math.log(val(s.c) * (x - val(s.h)))) / Math.log(baseOf(s.b)) + val(s.k)
}

/** A typed source as a function of x. */
function fnOf(src: string): (x: number) => number {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(`${src}: ${o.error}`)
  expect(o.plot.kind).toBe('explicit')
  const m = o.plot.makeModel('t')
  return (x) => m.evalExplicit!(o.plot.defaultParams, x)
}

/** Twenty points inside the spec's domain: x = h + u/c. */
function domainXs(s: LogSpec, n = 20): number[] {
  const c = val(s.c)
  const h = val(s.h)
  const xs: number[] = []
  for (let i = 0; i < n; i++) xs.push(h + (0.07 + i * 0.61) / c)
  return xs
}

/** logSource parses and evaluates equal to the formula at 20 points in the domain. */
function expectParses(s: LogSpec): string {
  const src = logSource(s)
  const o = parseExpression(src)
  expect(o.ok, `${src}: ${o.ok ? '' : o.error}`).toBe(true)
  if (!o.ok) return src
  expect(o.plot.kind).toBe('explicit')
  expect(o.plot.paramNames).toEqual([])
  const f = fnOf(src)
  for (const x of domainXs(s)) {
    const want = formula(s, x)
    expect(Number.isFinite(want), `${src} at ${x}`).toBe(true)
    expect(Math.abs(f(x) - want), `${src} at x=${x}`).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(want)))
  }
  return src
}

/** An exponential spec as a function of x (through its own source). */
const expFn = (e: ExpSpec) => fnOf(expSource(e))
const logFn = (l: LogSpec) => fnOf(logSource(l))

// ---------------------------------------------------------------------------
// logSource
// ---------------------------------------------------------------------------

describe('logSource', () => {
  const table: Array<[LogSpec, string]> = [
    [spec('1', '3'), 'y = log_3(x)'],
    [spec('2', 'e', '1', '1', '4'), 'y = 2ln(x - 1) + 4'],
    [spec('-1', '1/2', '2', '-3', '-1', 'f'), 'f(x) = -log_(1/2)(2(x + 3)) - 1'],
    [spec('1', '10'), 'y = log(x)'],
    [spec('1', 'e'), 'y = ln(x)'],
    [spec('1', '2', '2'), 'y = log_2(2x)'],
    [spec('1', '2', '-1'), 'y = log_2(-x)'],
    [spec('3', '2', '-1', '3'), 'y = 3log_2(-(x - 3))'],
    [spec('1', '2.5', '1', '0.5'), 'y = log_2.5(x - 0.5)'],
    [spec('1', '0.5'), 'y = log_0.5(x)'],
    [spec('1', 'sqrt(2)'), 'y = log_(sqrt(2))(x)'],
    [spec('1', 'pi'), 'y = log_(pi)(x)'],
    [spec('1/2', 'e', '1/3', '0', '-2'), 'y = (1/2)ln((1/3)x) - 2'],
    [spec('-2', '5', '-2', '-1', '1/2'), 'y = -2log_5(-2(x + 1)) + 1/2'],
    [spec('0.5', '3', '1', '1+sqrt(2)'), 'y = 0.5log_3(x - (1+sqrt(2)))'],
    [spec('pi', 'e', '1', '0', '-sqrt(2)'), 'y = pi ln(x) - sqrt(2)'],
    [spec('1', '3', 'pi'), 'y = log_3(pi x)'],
  ]
  for (const [s, want] of table) {
    it(want, () => {
      expect(logSource(s)).toBe(want)
      expectParses(s)
    })
  }

  it('blank fields read as their defaults', () => {
    expect(logSource({ a: '', b: '', c: '', h: '', k: '' })).toBe('y = ln(x)')
    expect(logSource({ a: ' 2 ', b: '3', c: ' ', h: '1', k: '' })).toBe('y = 2log_3(x - 1)')
  })

  it('renders like a textbook in LaTeX', () => {
    const tex = (s: LogSpec) => {
      const o = parseExpression(logSource(s))
      return o.ok ? o.plot.latex : o.error
    }
    expect(tex(spec('1', '3'))).toBe('y = \\log_{3}\\left(x\\right)')
    expect(tex(spec('1', '1/2', '1', '1'))).toBe('y = \\log_{\\frac{1}{2}}\\left(x-1\\right)')
    expect(tex(spec('2', 'e', '1', '1', '4'))).toBe('y = 2\\ln\\left(x-1\\right)+4')
  })
})

// ---------------------------------------------------------------------------
// readLogarithmic
// ---------------------------------------------------------------------------

describe('readLogarithmic', () => {
  const table: Array<[string, LogSpec]> = [
    ['y = log_3(x)', spec('1', '3')],
    ['y = ln(x)', spec('1', 'e')],
    ['y = log(x)', spec('1', '10')],
    ['y = log2(x)', spec('1', '2')],
    ['y = log10(x)', spec('1', '10')],
    ['y = log_e(x)', spec('1', 'e')],
    ['y = log_(1/2)(x - 1)', spec('1', '1/2', '1', '1')],
    ['y = log_(sqrt(2))(x)', spec('1', 'sqrt(2)')],
    ['y = 2ln(x - 1) + 4', spec('2', 'e', '1', '1', '4')],
    ['f(x) = -log_(1/2)(2(x + 3)) - 1', spec('-1', '1/2', '2', '-3', '-1', 'f')],
    // the argument, every linear spelling
    ['y = log_2(2x - 6)', spec('1', '2', '2', '3')],
    ['y = ln(3 - x)', spec('1', 'e', '-1', '3')],
    ['y = ln(x + 3)', spec('1', 'e', '1', '-3')],
    ['y = log_3((x - 1)/2)', spec('1', '3', '1/2', '1')],
    ['y = log_3(0.5x + 2)', spec('1', '3', '0.5', '-4')],
    ['y = log_2 x + 1', spec('1', '2', '1', '0', '1')],
    // constants on either side, products in either order
    ['y = 4 + 2ln(x)', spec('2', 'e', '1', '0', '4')],
    ['y = ln(x)*2 - 1', spec('2', 'e', '1', '0', '-1')],
    ['y = ln(x)/2', spec('1/2', 'e')],
    ['y = -3 - ln(x)', spec('-1', 'e', '1', '0', '-3')],
    ['y = 1/2 + log(x) - 3', spec('1', '10', '1', '0', '-5/2')],
    // change of base: a constant log in the denominator, same base as the variable one
    ['y = ln(x)/ln(3)', spec('1', '3')],
    ['y = log(x)/log(2)', spec('1', '2')],
    ['y = 2ln(x - 1)/ln(1/2) + 4', spec('2', '1/2', '1', '1', '4')],
    ['y = ln(x)/(2ln(3))', spec('1/2', '3')],
    ['y = (1/ln(3))ln(x)', spec('1', '3')],
    ['y = -ln(x + 1)/ln(5) - 2', spec('-1', '5', '1', '-1', '-2')],
    ['y = log_3(x)/log_3(2)', spec('1', '2')],
    ['y = log2(x)/log2(8)', spec('1', '8')],
    ['y = ln(2x)/ln(e)', spec('1', 'e', '2')],
    // a denominator in ANOTHER base is only a constant factor of a
    ['y = ln(x)/log(3)', spec('1/log(3)', 'e')],
    ['y = ln(x) + ln(2)', spec('1', 'e', '1', '0', 'ln(2)')],
  ]
  for (const [src, want] of table) {
    it(`reads ${src}`, () => {
      const got = readLogarithmic(src)
      expect(got).toEqual(want)
      // and the reading IS the typed function, in its whole domain
      const f = fnOf(src)
      for (const x of domainXs(got!)) {
        expect(formula(got!, x)).toBeCloseTo(f(x), 9)
      }
    })
  }

  it('reads t as the variable, and bare expressions', () => {
    expect(readLogarithmic('f(t) = log2(t + 1)')).toEqual(spec('1', '2', '1', '-1', '0', 'f'))
    expect(readLogarithmic('3log_5(t)')).toEqual(spec('3', '5'))
    expect(readLogarithmic('ln(x - 2)')).toEqual(spec('1', 'e', '1', '2'))
  })

  it('keeps the teacher’s number text', () => {
    expect(readLogarithmic('y = 1.5log_2.5(x - 0.25) + 0.75')).toEqual(spec('1.5', '2.5', '1', '0.25', '0.75'))
    expect(readLogarithmic('y = sqrt(3)ln(x) - pi')).toEqual(spec('sqrt(3)', 'e', '1', '0', '-pi'))
  })

  it('a paren-less ln x / ln 3 is ln(x/ln 3), as the parser reads it — not a change of base', () => {
    const r = readLogarithmic('y = ln x / ln 3')
    expect(r).toEqual(spec('1', 'e', '1/ln(3)'))
  })

  it('rejects everything else', () => {
    for (const src of [
      'y = log(x^2)',        // not linear inside
      'y = x ln(x)',         // a product with the variable
      'y = ln(abs(x))',      // ln|x|: two branches, an even function — not this family
      'y = ln|x|',
      'y = 1/ln(x)',
      'y = ln(x)^2',
      'y = ln(x)ln(x)',
      'y = ln(x) + ln(x + 1)',
      'y = ln(x) + x',
      'y = ln(ln(x))',
      'y = sqrt(ln(x))',
      'y = log_b(x)',        // a slider
      'y = a ln(x)',
      'y = 2^x',
      'y = 3',
      'y = ln(1/x)',
      'x = ln(y)',
      'y = ln(x) {x > 1}',
      'y = { ln(x) if x > 0 ; 0 otherwise }',
      'y = ln(0x + 2)',
      'y = 0ln(x)',
      'y = ln(x) - ln(x) + x',
      'not a formula ((',
      '',
    ]) {
      expect(readLogarithmic(src), src).toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// round trip
// ---------------------------------------------------------------------------

describe('round trip', () => {
  const A = ['1', '-1', '2', '-3', '1/2', '-1/2', '0.5', '2.5', 'sqrt(3)', '-sqrt(2)', '2pi']
  const B = ['e', '10', '2', '3', '5', '1/2', '0.5', '2.5', '1/3', 'sqrt(2)', '4/3']
  const Cs = ['1', '-1', '2', '-2', '1/2', '0.5', '3', '-1/2', '1.5']
  const H = ['0', '1', '-3', '2.5', '1/2', '-1/2', '4']
  const K = ['0', '4', '-1', '1/2', '-1/2', '2.5', 'pi']

  it('readLogarithmic(logSource(spec)) is the spec, 200 random specs', () => {
    const rng = makeRng(2024)
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rng() * xs.length)]
    for (let i = 0; i < 200; i++) {
      const s = spec(pick(A), pick(B), pick(Cs), pick(H), pick(K), rng() < 0.3 ? pick(['f', 'g', 'h']) : undefined)
      const src = expectParses(s)
      expect(readLogarithmic(src), src).toEqual(s)
    }
  })
})

// ---------------------------------------------------------------------------
// logFeatures
// ---------------------------------------------------------------------------

describe('logFeatures', () => {
  it('y = log_2(x − 1) + 4: the textbook anchor and base point', () => {
    const f = logFeatures(spec('1', '2', '1', '1', '4'))
    expect(f.asymptote).toBe(1)
    expect(f.domain).toBe('x > 1')
    expect(f.range).toBe('all real numbers')
    expect(f.anchor).toEqual({ x: 2, y: 4 })
    expect(f.basePoint).toEqual({ x: 3, y: 5 })
    expect(f.increasing).toBe(true)
    expect(f.concaveUp).toBe(false)
    expect(f.xIntercept).toBeCloseTo(1 + 2 ** -4, 12)
    expect(f.yIntercept).toBeNull() // x = 0 is left of the asymptote
    expect(f.endBehaviour).toBe('as x → 1⁺, y → −∞; as x → ∞, y → ∞')
    expect(f.sentences).toContain('vertical asymptote x = 1')
    expect(f.sentences).toContain('passes through (2, 4) and (3, 5)')
    expect(f.sentences).toContain('log₂ x = ln x / ln 2')
  })

  it('anchor (h + 1/c, k) and base point (h + b/c, k + a) with c ≠ 1', () => {
    const f = logFeatures(spec('3', '5', '2', '-1', '2'))
    expect(f.anchor.x).toBeCloseTo(-0.5, 12)
    expect(f.anchor.y).toBe(2)
    expect(f.basePoint.x).toBeCloseTo(1.5, 12)
    expect(f.basePoint.y).toBe(5)
    // and the curve really passes through both
    const g = logFn(spec('3', '5', '2', '-1', '2'))
    expect(g(f.anchor.x)).toBeCloseTo(f.anchor.y, 12)
    expect(g(f.basePoint.x)).toBeCloseTo(f.basePoint.y, 12)
    expect(g(f.xIntercept!)).toBeCloseTo(0, 12)
    expect(f.yIntercept).toBeCloseTo(g(0), 12)
  })

  it('increasing / decreasing: flipped by b < 1, by a < 0 and by c < 0 — each on its own', () => {
    const inc = (a: string, b: string, c: string) => logFeatures(spec(a, b, c)).increasing
    expect(inc('1', '2', '1')).toBe(true)
    expect(inc('1', '1/2', '1')).toBe(false)
    expect(inc('-1', '2', '1')).toBe(false)
    expect(inc('1', '2', '-1')).toBe(false)
    expect(inc('-1', '1/2', '1')).toBe(true)
    expect(inc('-1', '2', '-1')).toBe(true)
    expect(inc('1', '1/2', '-1')).toBe(true)
    expect(inc('-1', '1/2', '-1')).toBe(false)
    // concavity ignores c: −a/((x − h)² ln b)
    expect(logFeatures(spec('1', '2', '-1')).concaveUp).toBe(false)
    expect(logFeatures(spec('1', '1/2', '1')).concaveUp).toBe(true)
    expect(logFeatures(spec('-1', '2', '1')).concaveUp).toBe(true)
  })

  it('agrees with the curve: monotonic direction and concavity checked numerically', () => {
    const rng = makeRng(77)
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rng() * xs.length)]
    for (let i = 0; i < 40; i++) {
      const s = spec(pick(['1', '-2', '0.5', '-1/3']), pick(['e', '10', '1/2', '3', '0.2']), pick(['1', '-1', '2', '-0.5']), pick(['0', '2', '-1']), pick(['0', '3']))
      const f = logFeatures(s)
      const g = logFn(s)
      const [x0, x1, x2] = domainXs(s, 3).sort((p, q) => p - q)
      expect(g(x1) > g(x0), JSON.stringify(s)).toBe(f.increasing)
      const mid = g((x0 + x2) / 2)
      expect(mid < (g(x0) + g(x2)) / 2, JSON.stringify(s)).toBe(f.concaveUp)
    }
  })

  it('a reflected log: domain x < h, and the ends', () => {
    const f = logFeatures(spec('1', '1/2', '-1', '3'))
    expect(f.domain).toBe('x < 3')
    expect(f.endBehaviour).toBe('as x → 3⁻, y → ∞; as x → −∞, y → −∞')
    expect(f.anchor).toEqual({ x: 2, y: 0 })
    expect(f.basePoint).toEqual({ x: 2.5, y: 1 })
    expect(f.xIntercept).toBeCloseTo(2, 12)
    expect(f.yIntercept).toBeCloseTo(Math.log(3) / Math.log(0.5), 12)
    expect(f.sentences).toContain('log_(1/2) x = ln x / ln(1/2)')
    expect(logFeatures(spec('1', '1/2', '1', '-2')).domain).toBe('x > −2')
  })

  it('ln says nothing about change of base; log says ln 10', () => {
    expect(logFeatures(spec('1', 'e')).sentences.some((s) => s.includes('/'))).toBe(false)
    expect(logFeatures(spec('1', '10')).sentences).toContain('log x = ln x / ln 10')
  })

  it('a = 0 is a constant', () => {
    const f = logFeatures(spec('0', '2', '1', '0', '3'))
    expect(f.range).toBe('y = 3')
    expect(f.xIntercept).toBeNull()
  })

  it('the parser and analyzer agree: the asymptote and the zero of the typed source', () => {
    const s = spec('2', '3', '1', '1', '-2')
    const f = logFeatures(s)
    const o = parseExpression(logSource(s))
    if (!o.ok) throw new Error(o.error)
    const models = { expr_1: o.plot.makeModel('expr_1') }
    const curve: FittedCurve = {
      id: 'c', modelId: 'expr_1', params: o.plot.defaultParams, kind: 'explicit',
      domain: null, color: '#fff', strokeWidth: 2, visible: true, error: 0,
    }
    expect(findAsymptotes(curve, models, [-10, 10])).toContainEqual({ kind: 'vertical', x: 1 })
    const zeros = analyzeCurve({ ...curve, domain: [-10, 10] }, models).filter((p) => p.kind === 'zero')
    expect(zeros).toHaveLength(1)
    expect(zeros[0].pos.x).toBeCloseTo(f.xIntercept!, 6)
    expect(f.xIntercept).toBeCloseTo(4, 12) // 2log_3(x − 1) = 2 → x − 1 = 3
  })
})

// ---------------------------------------------------------------------------
// logFromTwoPoints
// ---------------------------------------------------------------------------

describe('logFromTwoPoints', () => {
  it('whole numbers stay whole', () => {
    expect(logFromTwoPoints({ x: 2, y: 4 }, { x: 5, y: 6 }, 1, '2')).toEqual(spec('1', '2', '1', '1', '4'))
    expect(logFromTwoPoints({ x: 1, y: 0 }, { x: 100, y: 6 }, 0, '10')).toEqual(spec('3', '10'))
  })

  it('base names are accepted: ln, log', () => {
    expect(logFromTwoPoints({ x: 1, y: 3 }, { x: Math.E, y: 5 }, 0, 'ln')).toEqual(spec('2', 'e', '1', '0', '3'))
    expect(logFromTwoPoints({ x: 1, y: 3 }, { x: 10, y: 5 }, 0, 'log')).toEqual(spec('2', '10', '1', '0', '3'))
    expect(logFromTwoPoints({ x: 1, y: 3 }, { x: 3, y: 1 }, 0, 'log_3')).toEqual(spec('-2', '3', '1', '0', '3'))
  })

  it('both points left of the asymptote: the reflected log, c = −1', () => {
    expect(logFromTwoPoints({ x: -1, y: 0 }, { x: -4, y: 2 }, 0, '2')).toEqual(spec('1', '2', '-1'))
  })

  it('refuses: shared x, on the asymptote, across it, bad base, non-finite', () => {
    expect(logFromTwoPoints({ x: 2, y: 1 }, { x: 2, y: 3 }, 0)).toBeNull()
    expect(logFromTwoPoints({ x: 1, y: 1 }, { x: 3, y: 3 }, 1)).toBeNull()
    expect(logFromTwoPoints({ x: 0, y: 1 }, { x: 3, y: 3 }, 1)).toBeNull()
    expect(logFromTwoPoints({ x: 2, y: 1 }, { x: 3, y: 3 }, 0, '1')).toBeNull()
    expect(logFromTwoPoints({ x: 2, y: 1 }, { x: 3, y: 3 }, 0, '-2')).toBeNull()
    expect(logFromTwoPoints({ x: 2, y: NaN }, { x: 3, y: 3 }, 0)).toBeNull()
  })

  it('the result parses and passes through both points (random)', () => {
    const rng = makeRng(31)
    for (let i = 0; i < 60; i++) {
      const h = Math.round((rng() * 8 - 4) * 10) / 10
      const side = rng() < 0.5 ? 1 : -1
      const x1 = h + side * (0.2 + rng() * 6)
      const x2 = h + side * (0.2 + rng() * 6)
      if (x1 === x2) continue
      const p1 = { x: x1, y: rng() * 10 - 5 }
      const p2 = { x: x2, y: rng() * 10 - 5 }
      const b = ['e', '10', '2', '1/2', '3'][i % 5]
      const s = logFromTwoPoints(p1, p2, h, b)
      expect(s, JSON.stringify([p1, p2, h, b])).not.toBeNull()
      const g = logFn(s!)
      expect(g(p1.x)).toBeCloseTo(p1.y, 8)
      expect(g(p2.x)).toBeCloseTo(p2.y, 8)
      expect(logFeatures(s!).asymptote).toBeCloseTo(h, 12)
    }
  })
})

// ---------------------------------------------------------------------------
// inverses
// ---------------------------------------------------------------------------

describe('inverses', () => {
  it('y = 3·2^(x − 1) − 4 inverts to y = log_2((x + 4)/3) + 1', () => {
    const e: ExpSpec = { a: '3', b: '2', p: '1', h: '1', k: '-4' }
    expect(logAsInverse(e)).toEqual(spec('1', '2', '1/3', '-4', '1'))
  })

  it('y = 2ln(x − 1) + 4 inverts to y = e^(0.5(x − 4)) + 1', () => {
    const l = spec('2', 'e', '1', '1', '4')
    const e = expAsInverse(l)
    expect(e).toEqual({ a: '1', b: 'e', rate: '0.5', p: '1', h: '4', k: '1' })
    expect(logAsInverse(e)).toEqual(spec('2', 'e', '1', '1', '4'))
  })

  it('a base e exponential with a rate and a period: a = p/r', () => {
    const e: ExpSpec = { a: '1/2', b: 'e', rate: '-0.5', p: '1', h: '0', k: '0' }
    expect(logAsInverse(e)).toEqual(spec('-2', 'e', '2'))
    const e2: ExpSpec = { a: '5', b: 'e', rate: '0.2', p: '3', h: '0', k: '1' }
    expect(logAsInverse(e2)).toEqual(spec('15', 'e', '1/5', '1', '0'))
  })

  it('a periodic exponential: y = 200(1/2)^(x/5.7) + 10 → y = 5.7log_(1/2)((x − 10)/200)', () => {
    const e: ExpSpec = { a: '200', b: '1/2', p: '5.7', h: '0', k: '10' }
    expect(logAsInverse(e)).toEqual(spec('5.7', '1/2', '1/200', '10', '0'))
  })

  it('reciprocals keep their text: c = 1/a', () => {
    expect(logAsInverse({ a: '0.5', b: '3', p: '1', h: '0', k: '0' }).c).toBe('2')
    expect(logAsInverse({ a: '0.8', b: '3', p: '1', h: '0', k: '0' }).c).toBe('1.25')
    expect(logAsInverse({ a: '-2', b: '3', p: '1', h: '0', k: '0' }).c).toBe('-1/2')
    expect(logAsInverse({ a: 'sqrt(2)', b: '3', p: '1', h: '0', k: '0' }).c).toBe('1/sqrt(2)')
    expect(logAsInverse({ a: '1/sqrt(2)', b: '3', p: '1', h: '0', k: '0' }).c).toBe('sqrt(2)')
    expect(expAsInverse(spec('1/3', '2')).p).toBe('1/3')
    expect(expAsInverse(spec('3', 'e')).rate).toBe('1/3')
  })

  const LOGS: LogSpec[] = [
    spec('1', '2'), spec('2', 'e', '1', '1', '4'), spec('-1', '1/2', '2', '-3', '-1'),
    spec('3', '10', '-1', '2', '0.5'), spec('0.5', '3', '1/2', '0', '-2'), spec('-2', 'e', '-3', '1', '1'),
    spec('sqrt(2)', '5', '1', '-1', '0'), spec('1/3', '2.5', '4', '0', '1/2'),
  ]
  const EXPS: ExpSpec[] = [
    { a: '1', b: '2', p: '1', h: '0', k: '0' },
    { a: '3', b: '2', p: '1', h: '1', k: '-4' },
    { a: '200', b: '1/2', p: '5.7', h: '0', k: '10' },
    { a: '-2', b: '3', p: '-2', h: '1', k: '4' },
    { a: '5', b: 'e', rate: '0.2', p: '1', h: '0', k: '0' },
    { a: '1/2', b: 'e', rate: '-0.5', p: '2', h: '-1', k: '3' },
    { a: '0.8', b: '1.05', p: '1', h: '0', k: '-1' },
  ]

  for (const l of LOGS) {
    it(`log ∘ exp and exp ∘ log are the identity: ${logSource(l)}`, () => {
      const f = logFn(l)
      const g = expFn(expAsInverse(l))
      // g(x) for any x lands in f's domain: f(g(x)) = x at 10 points
      for (let i = 0; i < 10; i++) {
        const x = -2 + i * 0.47
        expect(f(g(x)), `f(g(${x}))`).toBeCloseTo(x, 8)
      }
      // g(f(x)) = x at 10 points of f's domain
      for (const x of domainXs(l, 10)) expect(g(f(x)), `g(f(${x}))`).toBeCloseTo(x, 8)
      // and inverting twice is the same function
      const back = logFn(logAsInverse(expAsInverse(l)))
      for (const x of domainXs(l, 10)) expect(back(x)).toBeCloseTo(f(x), 9)
    })
  }

  for (const e of EXPS) {
    it(`exp ∘ log and log ∘ exp are the identity: ${expSource(e)}`, () => {
      const g = expFn(e)
      const l = logAsInverse(e)
      const f = logFn(l)
      for (let i = 0; i < 10; i++) {
        const x = -2 + i * 0.47
        expect(f(g(x)), `f(g(${x}))`).toBeCloseTo(x, 7)
      }
      for (const x of domainXs(l, 10)) expect(g(f(x)), `g(f(${x}))`).toBeCloseTo(x, 7)
    })
  }
})

// ---------------------------------------------------------------------------
// rebase
// ---------------------------------------------------------------------------

describe('rebase', () => {
  it('exact when the bases are powers of one another', () => {
    expect(rebase(spec('3', '4'), '2')).toEqual(spec('3/2', '2'))
    expect(rebase(spec('1', '2'), '8')).toEqual(spec('3', '8'))
    expect(rebase(spec('1', '1/2'), 'log_2')).toEqual(spec('-1', '2'))
    expect(rebase(spec('0.3', '8'), '2')).toEqual(spec('0.1', '2'))
    expect(rebase(spec('1', '9', '2', '1', '4'), '3')).toEqual(spec('1/2', '3', '2', '1', '4'))
    expect(rebase(spec('1', '2'), 'sqrt(2)')).toEqual(spec('1/2', 'sqrt(2)'))
    expect(rebase(spec('sqrt(3)', '4'), '2')).toEqual(spec('sqrt(3)/2', '2'))
    expect(rebase(spec('1', '100'), 'log')).toEqual(spec('1/2', '10'))
  })

  it('otherwise a 12-significant-digit decimal (never 1/ln(2), which reads back as base 2)', () => {
    expect(rebase(spec('1', '2'), 'ln')).toEqual(spec('1.44269504089', 'e'))
    expect(rebase(spec('1', 'e'), '10')).toEqual(spec('2.30258509299', '10'))
    expect(rebase(spec('2', '10', '1', '1', '4'), 'e')).toEqual(spec('0.868588963807', 'e', '1', '1', '4'))
    // the rebased source reads back in its new base
    expect(readLogarithmic(logSource(rebase(spec('1', '2'), 'e')))?.b).toBe('e')
  })

  it('the same base, a base name, or an invalid base', () => {
    expect(rebase(spec('2', 'e'), 'ln')).toEqual(spec('2', 'e'))
    expect(rebase(spec('2', '10'), 'log10')).toEqual(spec('2', '10'))
    expect(rebase(spec('2', '10'), '1')).toEqual(spec('2', '10'))
    expect(rebase(spec('2', '10'), '-3')).toEqual(spec('2', '10'))
    expect(rebase(spec('2', '10'), 'banana')).toEqual(spec('2', '10'))
  })

  it('is the same function at sample points, every pair of bases', () => {
    const bases = ['e', '10', '2', '3', '1/2', '0.2', 'sqrt(2)', '4', '2.5']
    const specs = [spec('1', 'e'), spec('-2', '3', '2', '1', '4'), spec('1/2', '1/2', '-1', '0', '-1')]
    for (const s0 of specs) {
      for (const from of bases) {
        const s = { ...s0, b: from }
        const f = logFn(s)
        for (const to of bases) {
          const r = rebase(s, to)
          expect(r.b).toBe(to)
          const g = logFn(r)
          for (const x of domainXs(s, 8)) {
            expect(Math.abs(g(x) - f(x)), `${logSource(s)} → ${logSource(r)} at ${x}`)
              .toBeLessThanOrEqual(1e-10 * Math.max(1, Math.abs(f(x))))
          }
        }
      }
    }
  })
})

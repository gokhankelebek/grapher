import { describe, expect, it } from 'vitest'
import {
  logisticAt,
  logisticFeatures,
  logisticFromInitial,
  logisticFromParams,
  logisticSource,
  logisticToParams,
  logisticValues,
  readLogistic,
  type LogisticSpec,
} from '../src/core/logistic'
import { parseExpression } from '../src/core/parse'
import { parseSlopeField } from '../src/core/parse/slopeField'
import { MODELS } from '../src/core/fit/models'
import { analyzeCurve } from '../src/core/analyze'
import { findEndAsymptotes } from '../src/core/holes'
import type { FittedCurve } from '../src/core/types'
import { drawAndRecognize, explicitPath, makeRng, ranking } from './helpers'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const spec = (L: string, k: string, A: string, h = '0', d = '0', extra: Partial<LogisticSpec> = {}): LogisticSpec => ({
  L, k, A, h, d, ...extra,
})

/** Parse the source and compare it with the spec's own formula at 20 points. */
function expectDrawsSpec(s: LogisticSpec): void {
  const src = logisticSource(s)
  const o = parseExpression(src)
  expect(o.ok, `${src} should parse`).toBe(true)
  if (!o.ok) return
  const m = o.plot.makeModel('m')
  const v = logisticValues(s)!
  for (let i = 0; i < 20; i++) {
    const x = v.x0 + (i - 10) * 0.4 / Math.abs(v.k)
    const want = logisticAt(s, x)
    const got = m.evalExplicit!(o.plot.defaultParams, x)
    expect(Math.abs(got - want), `${src} at x = ${x}`).toBeLessThan(1e-9 * Math.max(1, Math.abs(want)))
  }
}

// ---------------------------------------------------------------------------
// the typed shapes
// ---------------------------------------------------------------------------

describe('readLogistic — the shapes a class types', () => {
  it('L/(1 + A e^(-kx))', () => {
    expect(readLogistic('y = 1000/(1 + 49e^(-0.3x))')).toEqual(spec('1000', '0.3', '49'))
    expect(readLogistic('y = 10/(1 + 4e^(-0.5x))')).toEqual(spec('10', '0.5', '4'))
    expect(readLogistic('y = 10/(1+4*e^(-0.5*x))')).toEqual(spec('10', '0.5', '4'))
    expect(readLogistic('y = 10/(1 + 4exp(-0.5x))')).toEqual(spec('10', '0.5', '4'))
  })

  it('L/(1 + A*e^(-k(x - c)))', () => {
    expect(readLogistic('y = 5/(1 + 2*e^(-0.5(x - 1)))')).toEqual(spec('5', '0.5', '2', '1'))
    expect(readLogistic('y = 5/(1 + 2e^(-0.5(x + 3)))')).toEqual(spec('5', '0.5', '2', '-3'))
  })

  it('L/(1 + e^(-k(x - c))) — the midpoint form', () => {
    expect(readLogistic('y = 10/(1 + e^(-2(x-3)))')).toEqual(spec('10', '2', '1', '3'))
    expect(readLogistic('y = 3/(1 + e^(-x))')).toEqual(spec('3', '1', '1'))
    expect(readLogistic('y = 1/(1 + e^(-(x - 2)))')).toEqual(spec('1', '1', '1', '2'))
  })

  it('L/(1 + A*b^(-x)) keeps its base', () => {
    expect(readLogistic('y = 10/(1 + 3*2^(-x))')).toEqual(spec('10', '', '3', '0', '0', { b: '2' }))
    expect(readLogistic('y = 10/(1 + 3(1/2)^x)')).toEqual(spec('10', '', '3', '0', '0', { b: '2' }))
    expect(readLogistic('y = 8/(1 + 2^(-x))')).toEqual(spec('8', '', '1', '0', '0', { b: '2' }))
    const v = logisticValues(readLogistic('y = 10/(1 + 3*2^(-x))')!)!
    expect(v.k).toBeCloseTo(Math.LN2, 12)
  })

  it('L/(1 + A*e^(-kx)) + d, either sign of d', () => {
    expect(readLogistic('y = 10/(1 + 3e^(-0.5x)) + 2')).toEqual(spec('10', '0.5', '3', '0', '2'))
    expect(readLogistic('y = 10/(1 + 3e^(-0.5x)) - 2')).toEqual(spec('10', '0.5', '3', '0', '-2'))
    expect(readLogistic('y = 2 + 10/(1 + 3e^(-0.5x))')).toEqual(spec('10', '0.5', '3', '0', '2'))
  })

  it('fraction and decimal coefficients', () => {
    expect(readLogistic('y = (1/2)/(1 + (1/3)e^(-x/2))')).toEqual(spec('1/2', '0.5', '1/3'))
    expect(readLogistic('y = 2.5/(1 + 0.25e^(-1.5x)) + 0.75')).toEqual(spec('2.5', '1.5', '0.25', '0', '0.75'))
    expect(readLogistic('y = 12/(1 + 5e^(-(2/3)x))')?.k).toBe('2/3')
  })

  it('f(x) = … and P(t) = … keep their name and variable', () => {
    expect(readLogistic('f(x) = 1000/(1 + 49e^(-0.3x))')).toEqual(spec('1000', '0.3', '49', '0', '0', { name: 'f' }))
    expect(readLogistic('P(t) = 1000/(1 + 49e^(-0.3t))')).toEqual(
      spec('1000', '0.3', '49', '0', '0', { name: 'P', v: 't' }),
    )
    expect(readLogistic('y = 1000/(1 + 49e^(-0.3t))')?.v).toBe('t')
  })

  it('a denominator constant other than 1 is divided out, exactly', () => {
    expect(readLogistic('y = 100/(2 + 3e^(-x))')).toEqual(spec('50', '1', '1.5'))
    expect(readLogistic('y = 100/(3 + e^(-x))')).toEqual(spec('100/3', '1', '1/3'))
  })

  it('a positive exponent is a decreasing logistic (k < 0)', () => {
    const s = readLogistic('y = 1000/(1 + 49e^(0.3x))')!
    expect(s).toEqual(spec('1000', '-0.3', '49'))
    expect(logisticSource(s)).toBe('y = 1000/(1 + 49e^(0.3x))')
    expect(logisticFeatures(s)!.increasing).toBe(false)
  })

  it('e^x/(1 + e^x) IS a logistic: L = 1, A = 1, k = 1', () => {
    expect(readLogistic('y = e^x/(1 + e^x)')).toEqual(spec('1', '1', '1'))
    // and the same curve written with a shift
    expect(readLogistic('y = (1 + 2e^x)/(1 + e^x)')).toEqual(spec('1', '1', '1', '0', '1'))
    expect(readLogistic('y = 5e^(2x)/(3 + e^(2x))')).toEqual(spec('5', '2', '3'))
  })

  it('rejects what is not a logistic', () => {
    for (const src of [
      'y = 1/(1 + x^2)',
      'y = 2^x',
      'y = 3e^(-0.5x) + 1',
      'y = 1/(1 - 49e^(-x))', // A < 0: a pole
      'y = 1/(49e^(-x))', // no constant in the denominator: an exponential
      'y = x/(1 + e^(-x))',
      'y = 1/(1 + e^(-x^2))',
      'y = 10/(1 + e^(-x)) + 1/(1 + e^(-2x))', // two rates
      'y = sin(x)',
      'y = 5',
      'x^2 + y^2 = 1',
      'y = 1/(1 + a e^(-x))', // a slider
    ]) {
      expect(readLogistic(src), src).toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// the source
// ---------------------------------------------------------------------------

describe('logisticSource', () => {
  it('writes the textbook line', () => {
    expect(logisticSource(spec('10', '0.5', '4'))).toBe('y = 10/(1 + 4e^(-0.5x))')
    expect(logisticSource(spec('1000', '0.3', '49', '0', '0', { v: 't', name: 'P' }))).toBe('P(t) = 1000/(1 + 49e^(-0.3t))')
    expect(logisticSource(spec('10', '2', '1', '3'))).toBe('y = 10/(1 + e^(-2(x - 3)))')
    expect(logisticSource(spec('10', '1', '1'))).toBe('y = 10/(1 + e^(-x))')
    expect(logisticSource(spec('10', '-1', '1'))).toBe('y = 10/(1 + e^x)')
    expect(logisticSource(spec('10', '0.5', '3', '0', '2'))).toBe('y = 10/(1 + 3e^(-0.5x)) + 2')
    expect(logisticSource(spec('10', '0.5', '3', '0', '-2'))).toBe('y = 10/(1 + 3e^(-0.5x)) - 2')
    expect(logisticSource(spec('1/2', '1/2', '1/3'))).toBe('y = (1/2)/(1 + (1/3)e^(-(1/2)x))')
    expect(logisticSource(spec('10', '', '3', '0', '0', { b: '2' }))).toBe('y = 10/(1 + 3(2)^(-x))')
    expect(logisticSource(spec('10', '', '1', '1', '0', { b: '2' }))).toBe('y = 10/(1 + 2^(-(x - 1)))')
  })

  it('every written line parses and draws the spec', () => {
    for (const s of [
      spec('10', '0.5', '4'),
      spec('-5', '2', '0.5', '1', '-3'),
      spec('1/2', '1/2', '1/3', '-1/2', '1/4'),
      spec('10', '', '3', '2', '1', { b: '2' }),
      spec('10', '', '3', '0', '0', { b: '1/2' }),
      spec('pi', 'sqrt(2)', '2', '0', '0'),
      spec('1000', '0.3', '49', '0', '0', { v: 't' }),
    ]) {
      expectDrawsSpec(s)
    }
  })
})

// ---------------------------------------------------------------------------
// round trip (property test)
// ---------------------------------------------------------------------------

describe('round trip: spec → text → readLogistic → spec', () => {
  const rng = makeRng(20260928)
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]
  const Ls = ['1000', '10', '1', '-5', '1/2', '2.5', '100', '3/4', '-1/3']
  const ks = ['0.3', '1', '-0.5', '2', '1/2', '-1', '0.05', '3', '-2/3']
  const As = ['49', '1', '4', '0.5', '1/3', '9', '2.25', '100']
  const hs = ['0', '0', '0', '2', '-1', '1/2', '-3/2']
  const ds = ['0', '0', '5', '-3', '1/2', '0.25', '-10']
  const bs = ['2', '3', '1/2', '10', '1.5']

  it('200 random specs come back as the same function, texts kept', () => {
    for (let i = 0; i < 200; i++) {
      const s: LogisticSpec = { L: pick(Ls), k: pick(ks), A: pick(As), h: pick(hs), d: pick(ds) }
      if (rng() < 0.2) {
        s.b = pick(bs)
        s.k = ''
      }
      if (rng() < 0.3) s.name = pick(['f', 'g', 'P'])
      if (rng() < 0.3) s.v = 't'
      const src = logisticSource(s)
      const back = readLogistic(src)
      expect(back, src).not.toBeNull()
      if (!back) continue
      // the same function …
      const v1 = logisticValues(s)!
      const v2 = logisticValues(back)!
      for (const key of ['L', 'k', 'x0', 'd'] as const) {
        expect(v2[key], `${src}: ${key}`).toBeCloseTo(v1[key], 9)
      }
      // … written the same way: the text round-trips exactly, except that a
      // fractional rate with a terminating decimal is read as that decimal
      // (e^(−(1/2)x) → k = 0.5, readExponential's rule), after which the
      // line is a fixed point
      if (!['1/2', '-2/3'].includes(s.k)) expect(logisticSource(back), src).toBe(src)
      else expect(back.k === s.k || back.k === '0.5').toBe(true)
      expect(logisticSource(readLogistic(logisticSource(back))!)).toBe(logisticSource(back))
      // L, A, h and d keep the teacher's text; k keeps it or its decimal
      expect(back.L).toBe(s.L)
      expect(back.A).toBe(s.A)
      expect(back.d).toBe(s.d)
      expect(back.b).toBe(s.b)
      expect(back.name).toBe(s.name)
      expect(back.v).toBe(s.v)
    }
  })

  it('library params → spec → params', () => {
    for (let i = 0; i < 100; i++) {
      const p = [
        (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 20),
        (rng() < 0.5 ? -1 : 1) * (0.2 + rng() * 3),
        rng() * 6 - 3,
        rng() * 10 - 5,
      ]
      const s = logisticFromParams(p, 12)!
      const back = logisticToParams(s)!
      for (let j = 0; j < 4; j++) expect(back[j]).toBeCloseTo(p[j], 6)
      // and the written line draws the library curve
      const src = logisticSource(s)
      const o = parseExpression(src)
      expect(o.ok).toBe(true)
      if (!o.ok) continue
      const m = o.plot.makeModel('m')
      for (const x of [-3, -1, 0, 0.7, 2.5]) {
        const want = MODELS.logistic.evalExplicit!(p, x)
        expect(m.evalExplicit!(o.plot.defaultParams, x)).toBeCloseTo(want, 6)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// features
// ---------------------------------------------------------------------------

describe('logisticFeatures — y = 1000/(1 + 49e^(-0.3x))', () => {
  const f = logisticFeatures(readLogistic('y = 1000/(1 + 49e^(-0.3x))')!)!

  it('inflection at x = ln(49)/0.3, y = 500', () => {
    expect(f.inflection.x.value).toBeCloseTo(Math.log(49) / 0.3, 12)
    expect(f.inflection.y.value).toBe(500)
    expect(f.inflection.x.exact).toBe('(20/3) ln 7')
    expect(f.inflection.x.text).toBe('(20/3) ln 7 ≈ 12.97')
    expect(f.inflection.y.text).toBe('500')
  })

  it('maximum rate L·k/4 = 75, asymptotes y = 0 and y = 1000, y(0) = 20', () => {
    expect(f.maxRate.value).toBeCloseTo(75, 12)
    expect(f.maxRate.text).toBe('75')
    expect(f.lower).toBe(0)
    expect(f.upper).toBe(1000)
    expect(f.yIntercept!.value).toBeCloseTo(20, 12)
    expect(f.yIntercept!.text).toBe('20')
    expect(f.increasing).toBe(true)
  })

  it('the differential equation, as text, KaTeX and a typeable slope field', () => {
    expect(f.de).toBe('dy/dx = 0.3y(1 − y/1000)')
    expect(f.fieldSource).toBe('dy/dx = 0.3*y*(1 - y/1000)')
    expect(f.deTex).toBe('\\frac{dy}{dx} = 0.3\\,y\\left(1 - \\frac{y}{1000}\\right)')
    const field = parseSlopeField(f.fieldSource)
    expect(field.ok).toBe(true)
  })

  it('the curve solves its differential equation', () => {
    const s = readLogistic('y = 1000/(1 + 49e^(-0.3x))')!
    for (const x of [-5, 0, 7, 13, 20]) {
      const y = logisticAt(s, x)
      const h = 1e-5
      const slope = (logisticAt(s, x + h) - logisticAt(s, x - h)) / (2 * h)
      expect(slope).toBeCloseTo(0.3 * y * (1 - y / 1000), 4)
    }
  })

  it('the AP facts: the limit is L, fastest growth at L/2', () => {
    expect(f.apFacts[0]).toMatch(/y\(0\) > 0, y → 1000 as x → ∞/)
    expect(f.apFacts[1]).toMatch(/fastest when y = L\/2 = 500/)
  })
})

describe('logisticFeatures — exact forms and shifts', () => {
  it('ln(4)/0.5 reads 4 ln 2 ≈ 2.773', () => {
    const f = logisticFeatures(spec('10', '0.5', '4'))!
    expect(f.inflection.x.text).toBe('4 ln 2 ≈ 2.773')
    expect(f.inflection.x.tex).toBe('4\\ln 2')
  })

  it('with a shift inside the exponent: 1 + 2 ln 2', () => {
    expect(logisticFeatures(spec('5', '0.5', '2', '1'))!.inflection.x.text).toBe('1 + 2 ln 2 ≈ 2.386')
  })

  it('A < 1 gives a negative ln: −2 ln 3', () => {
    expect(logisticFeatures(spec('1/2', '0.5', '1/3'))!.inflection.x.text).toBe('−2 ln 3 ≈ −2.197')
  })

  it('A = 1 is the midpoint itself; a base form states log_b A', () => {
    expect(logisticFeatures(spec('10', '2', '1', '3'))!.inflection.x.text).toBe('3')
    expect(logisticFeatures(spec('10', '', '3', '0', '0', { b: '2' }))!.inflection.x.text).toBe('log₂ 3 ≈ 1.585')
    expect(logisticFeatures(spec('10', '', '8', '0', '0', { b: '2' }))!.inflection.x.text).toBe('3')
  })

  it('the vertical shift moves both asymptotes, the inflection and the DE', () => {
    const f = logisticFeatures(spec('10', '0.5', '3', '0', '2'))!
    expect(f.lower).toBe(2)
    expect(f.upper).toBe(12)
    expect(f.inflection.y.text).toBe('7')
    expect(f.yIntercept!.text).toBe('4.5')
    expect(f.de).toBe('dy/dx = 0.5(y − 2)(1 − (y − 2)/10)')
    expect(f.fieldSource).toBe('dy/dx = 0.5*(y - 2)*(1 - (y - 2)/10)')
    expect(parseSlopeField(f.fieldSource).ok).toBe(true)
    const neg = logisticFeatures(spec('10', '0.5', '3', '0', '-4'))!
    expect(neg.de).toBe('dy/dx = 0.5(y + 4)(1 − (y + 4)/10)')
  })

  it('dy/dt for a line written in t; L = 1 drops the /1', () => {
    expect(logisticFeatures(spec('1000', '0.3', '49', '0', '0', { v: 't' }))!.de).toBe('dy/dt = 0.3y(1 − y/1000)')
    expect(logisticFeatures(spec('1', '1', '1'))!.de).toBe('dy/dx = y(1 − y)')
  })

  it('a decreasing logistic: negative max rate, limit at −∞', () => {
    const f = logisticFeatures(spec('1000', '-0.3', '49'))!
    expect(f.maxRate.value).toBeCloseTo(-75, 12)
    expect(f.apFacts[0]).toMatch(/y → 1000 as x → −∞/)
  })
})

// ---------------------------------------------------------------------------
// the builder
// ---------------------------------------------------------------------------

describe('logisticFromInitial — P(0) = 20, L = 1000, k = 0.3', () => {
  it('A = L/y(0) − 1 = 49', () => {
    const r = logisticFromInitial('1000', '0.3', '20')
    expect(r.error).toBeNull()
    expect(r.spec).toEqual(spec('1000', '0.3', '49'))
    expect(logisticSource(r.spec!)).toBe('y = 1000/(1 + 49e^(-0.3x))')
    expect(logisticAt(r.spec!, 0)).toBeCloseTo(20, 12)
  })

  it('exact fractions, decimals, a shift and t', () => {
    expect(logisticFromInitial('10', '1', '3').spec!.A).toBe('7/3')
    expect(logisticFromInitial('10', '1', '4').spec!.A).toBe('1.5')
    const shifted = logisticFromInitial('10', '0.5', '5', '2')
    expect(shifted.spec!.A).toBe('7/3')
    expect(logisticAt(shifted.spec!, 0)).toBeCloseTo(5, 12)
    expect(logisticFromInitial('1000', '0.3', '20', '0', 't').spec!.v).toBe('t')
    // an irrational y(0) still solves, numerically
    const r = logisticFromInitial('10', '1', 'pi')
    expect(logisticAt(r.spec!, 0)).toBeCloseTo(Math.PI, 9)
  })

  it('refuses a y(0) that is not strictly between the equilibria', () => {
    expect(logisticFromInitial('1000', '0.3', '0').error).toMatch(/equilibrium/)
    expect(logisticFromInitial('1000', '0.3', '1000').error).toMatch(/equilibrium/)
    expect(logisticFromInitial('1000', '0.3', '1500').error).toMatch(/beyond the carrying capacity/)
    expect(logisticFromInitial('1000', '0.3', '-5').error).toMatch(/between/)
    expect(logisticFromInitial('0', '0.3', '5').error).toMatch(/L can’t be 0/)
    expect(logisticFromInitial('10', '0', '5').error).toMatch(/constant/)
    expect(logisticFromInitial('ten', '1', '5').error).toMatch(/not a number/)
  })
})

// ---------------------------------------------------------------------------
// a SKETCHED S-curve
// ---------------------------------------------------------------------------

describe('a hand-drawn S-curve', () => {
  const f = (x: number) => 4 / (1 + Math.exp(-1.6 * (x - 0.5))) - 1

  it('is recognised as the library logistic, and its analysis marks the inflection and both asymptotes', () => {
    const res = drawAndRecognize(explicitPath(f), -5, 6, makeRng(2811))
    expect(res[0].modelId, ranking(res)).toBe('logistic')
    const p = res[0].params
    const curve: FittedCurve = {
      id: 's',
      modelId: 'logistic',
      params: p,
      kind: 'explicit',
      domain: [-5, 6],
      color: '#4f9cf9',
      strokeWidth: 2.5,
      visible: true,
      error: 0,
    }
    const pts = analyzeCurve(curve, MODELS)
    const infl = pts.find((q) => q.kind === 'inflection')!
    expect(infl.pos.x).toBeCloseTo(0.5, 0)
    expect(infl.pos.y).toBeCloseTo(1, 0)
    const ends = findEndAsymptotes({ ...curve, domain: null } as FittedCurve, MODELS)
    const ys = ends
      .map((a) => (a.kind === 'line' ? a.a.y : NaN))
      .sort((u, w) => u - w)
    expect(ys.length).toBe(2)
    expect(ys[0]).toBeCloseTo(-1, 0)
    expect(ys[1]).toBeCloseTo(3, 0)
    // … and it is stated the AP way
    const s = logisticFromParams(p)!
    const feats = logisticFeatures(s)!
    expect(feats.lower).toBeCloseTo(-1, 0)
    expect(feats.upper).toBeCloseTo(3, 0)
    expect(readLogistic(logisticSource(s))).not.toBeNull()
  })
})

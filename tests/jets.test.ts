// ============================================================================
// tests/jets.test.ts — Taylor-mode automatic differentiation over the parser's
// AST (src/core/parse/jets.ts), reached through ModelSpec.taylor.
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { ExprNode } from '../src/core/parse'
import { parseExpression } from '../src/core/parse'
import { jetAt } from '../src/core/parse/jets'
import { PERF } from './perfBudget'

function jet(src: string, a: number, n: number, params?: number[]): number[] | null {
  const r = parseExpression(src)
  if (!r.ok) throw new Error(`expected "${src}" to parse, got: ${r.error}`)
  const spec = r.plot.makeModel('m')
  expect(spec.taylor).toBeTypeOf('function')
  return spec.taylor!(params ?? r.plot.defaultParams, a, n)
}

function fact(k: number): number {
  let f = 1
  for (let i = 2; i <= k; i++) f *= i
  return f
}

/** c_k within `tol` of want_k, relative to max(|want_k|, scale). */
function expectJet(
  got: number[] | null,
  want: (k: number) => number,
  tol = 1e-12,
  scale: number | ((k: number) => number) = 0,
): void {
  expect(got).not.toBeNull()
  const g = got!
  for (let k = 0; k < g.length; k++) {
    const w = want(k)
    const err = Math.abs(g[k] - w)
    const ref = Math.max(Math.abs(w), typeof scale === 'number' ? scale : scale(k))
    if (!(err <= tol * ref || err <= 1e-300)) {
      throw new Error(`c_${k}: got ${g[k]}, want ${w} (err ${err.toExponential(2)})`)
    }
  }
}

/** The jet of x itself at a: [a, 1, 0, 0, …]. */
const identity = (a: number) => (k: number) => (k === 0 ? a : k === 1 ? 1 : 0)

/** the generalised binomial coefficient C(r, k) */
function binom(r: number, k: number): number {
  let b = 1
  for (let i = 0; i < k; i++) b = (b * (r - i)) / (i + 1)
  return b
}

/** Σ |u_j| |v_{k−j}|: the size of the terms a product coefficient sums */
function absMul(u: number[], v: number[]): (k: number) => number {
  return k => {
    let s = 0
    for (let j = 0; j <= k; j++) s += Math.abs(u[j] * v[k - j])
    return Math.max(1, s)
  }
}

/** (u·v)_k from two jets */
function mulJ(u: number[], v: number[]): number[] {
  return u.map((_, k) => {
    let s = 0
    for (let j = 0; j <= k; j++) s += u[j] * v[k - j]
    return s
  })
}

const POINTS = [-1.3, -0.4, 0.3, 0.9, 2.2]

describe('jetAt — closed-form coefficients', () => {
  it('sin, cos: sin(a + kπ/2)/k!', () => {
    for (const a of POINTS) {
      expectJet(jet('y = sin(x)', a, 20), k => Math.sin(a + (k * Math.PI) / 2) / fact(k), 1e-12, 1 / fact(20))
      expectJet(jet('y = cos(x)', a, 20), k => Math.cos(a + (k * Math.PI) / 2) / fact(k), 1e-12, 1 / fact(20))
    }
  })

  it('exp, e^x, sinh, cosh', () => {
    for (const a of POINTS) {
      expectJet(jet('y = exp(x)', a, 20), k => Math.exp(a) / fact(k))
      expectJet(jet('y = e^x', a, 20), k => Math.exp(a) / fact(k))
      expectJet(jet('y = sinh(x)', a, 20), k => (k % 2 ? Math.cosh(a) : Math.sinh(a)) / fact(k), 1e-12, 1 / fact(20))
      expectJet(jet('y = cosh(x)', a, 20), k => (k % 2 ? Math.sinh(a) : Math.cosh(a)) / fact(k), 1e-12, 1 / fact(20))
    }
  })

  it('ln, log, log2, log10, log_3: (−1)^{k+1}/(k a^k) over ln b', () => {
    for (const a of [0.3, 0.9, 2.2, 7]) {
      const ln = (k: number) => (k === 0 ? Math.log(a) : ((k % 2 ? 1 : -1) / k) * Math.pow(a, -k))
      expectJet(jet('y = ln(x)', a, 20), ln)
      expectJet(jet('y = log(x)', a, 20), k => ln(k) / Math.LN10)
      expectJet(jet('y = log10(x)', a, 20), k => ln(k) / Math.LN10)
      expectJet(jet('y = log2(x)', a, 20), k => ln(k) / Math.LN2)
      expectJet(jet('y = log_3(x)', a, 20), k => ln(k) / Math.log(3))
    }
    // the library's exact values at the centre
    expect(jet('y = log10(x)', 1000, 3)![0]).toBe(3)
    expect(jet('y = log2(x)', 8, 3)![0]).toBe(3)
  })

  it('a logarithm whose base is a jet: log_x(2) = ln 2 / ln x', () => {
    const body: ExprNode = {
      t: 'call',
      fn: 'log_',
      args: [{ t: 'var', name: 'x' }, { t: 'num', v: 2, raw: '2' }],
    }
    const viaDiv = jet('y = ln(2)/ln(x)', 3, 12)!
    expectJet(jetAt(body, [], 3, 12), k => viaDiv[k])
    // base 1 has no logarithm
    expect(jetAt(body, [], 1, 3)).toBeNull()
  })

  it('sqrt, cbrt, real powers: C(r, k) a^{r−k}', () => {
    for (const a of [0.3, 0.9, 2.2, 7]) {
      expectJet(jet('y = sqrt(x)', a, 20), k => binom(0.5, k) * Math.pow(a, 0.5 - k))
      expectJet(jet('y = cbrt(x)', a, 20), k => binom(1 / 3, k) * Math.pow(a, 1 / 3 - k))
      expectJet(jet('y = x^(2.5)', a, 20), k => binom(2.5, k) * Math.pow(a, 2.5 - k))
      expectJet(jet('y = x^(-0.5)', a, 20), k => binom(-0.5, k) * Math.pow(a, -0.5 - k))
    }
    // cbrt is real on the negatives too
    expectJet(jet('y = cbrt(x)', -8, 12), k => -binom(1 / 3, k) * 2 * Math.pow(8, -k) * (k % 2 ? -1 : 1))
  })

  it('integer powers at any centre, including 0 and negatives', () => {
    for (const a of [-2, -0.5, 0, 0.7, 3]) {
      expectJet(jet('y = x^5', a, 10), k => (k <= 5 ? binom(5, k) * Math.pow(a, 5 - k) : 0), 1e-12, 1)
      expectJet(jet('y = (x - 1)^3', a, 6), k => (k <= 3 ? binom(3, k) * Math.pow(a - 1, 3 - k) : 0), 1e-12, 1)
    }
    expect(jet('y = x^2', 0, 4)).toEqual([0, 0, 1, 0, 0])
    expect(jet('y = x^0', 0, 2)).toEqual([1, 0, 0])
    expectJet(jet('y = x^(-2)', -2, 12), k => binom(-2, k) * Math.pow(-2, -2 - k))
    // a slider exponent that is a whole number is one too
    expect(jet('y = x^n', 0, 4, [3])).toEqual([0, 0, 0, 1, 0])
  })

  it('a non-constant exponent: x^x about 1 is 1 + (x−1) + (x−1)² + (x−1)³/2 + …', () => {
    expectJet(jet('y = x^x', 1, 4), k => [1, 1, 1, 0.5, 1 / 3][k])
    expectJet(jet('y = 2^x', 0.5, 12), k => (Math.pow(2, 0.5) * Math.pow(Math.LN2, k)) / fact(k))
  })

  it('tan, sec, csc, cot, tanh satisfy their differential equations to degree 20', () => {
    for (const a of [-1.2, -0.4, 0.3, 0.9, 1.4]) {
      const t = jet('y = tan(x)', a, 21)!
      const t2 = mulJ(t, t)
      const sc = absMul(t, t)
      // tan′ = 1 + tan²
      expectJet(t.slice(1).map((c, k) => (k + 1) * c), k => (k === 0 ? 1 : 0) + t2[k], 1e-11, k => sc(k) * (k + 1))
      // sec² = 1 + tan²
      const s = jet('y = sec(x)', a, 21)!
      expectJet(mulJ(s, s), k => (k === 0 ? 1 : 0) + t2[k], 1e-11, k => Math.max(sc(k), absMul(s, s)(k)))
      // tanh′ = 1 − tanh²
      const h = jet('y = tanh(x)', a, 21)!
      const h2 = mulJ(h, h)
      expectJet(h.slice(1).map((c, k) => (k + 1) * c), k => (k === 0 ? 1 : 0) - h2[k], 1e-11, k => absMul(h, h)(k) * (k + 1))
    }
    for (const a of [-2.5, -0.4, 0.3, 1.4, 2.8]) {
      // cot · tan = 1, csc · sin = 1
      const c = jet('y = cot(x)', a, 20)!
      const t = jet('y = tan(x)', a, 20)!
      expectJet(mulJ(c, t), k => (k === 0 ? 1 : 0), 1e-11, absMul(c, t))
      const cs = jet('y = csc(x)', a, 20)!
      const sn = jet('y = sin(x)', a, 20)!
      expectJet(mulJ(cs, sn), k => (k === 0 ? 1 : 0), 1e-11, absMul(cs, sn))
    }
  })

  it('inverse functions compose back to x', () => {
    // compositions sum terms that grow like (1/ρ)^k: compare at that scale
    const grow = (rho: number) => (k: number) => Math.pow(1 / rho, k)
    for (const a of [-0.8, -0.3, 0.2, 0.6]) {
      expectJet(jet('y = sin(asin(x))', a, 20), identity(a), 1e-12, grow((1 - Math.abs(a)) / 2))
      expectJet(jet('y = cos(acos(x))', a, 20), identity(a), 1e-12, grow((1 - Math.abs(a)) / 2))
      expectJet(jet('y = asin(x) + acos(x)', a, 20), k => (k === 0 ? Math.PI / 2 : 0), 1e-12, grow((1 - Math.abs(a)) / 2))
    }
    for (const a of [-3, -0.5, 0.4, 2]) {
      expectJet(jet('y = tan(atan(x))', a, 20), identity(a), 1e-12, grow(0.25))
      expectJet(jet('y = exp(ln(x))', Math.abs(a), 20), identity(Math.abs(a)), 1e-12, grow(Math.abs(a) / 2))
      expectJet(jet('y = sqrt(x)^2', Math.abs(a), 20), identity(Math.abs(a)), 1e-12, grow(Math.abs(a) / 2))
      expectJet(jet('y = cbrt(x)^3', a, 20), identity(a), 1e-12, grow(Math.abs(a) / 2))
    }
  })

  it('the classic Maclaurin series', () => {
    // atan: x − x³/3 + x⁵/5 − …
    expectJet(jet('y = atan(x)', 0, 21), k => (k % 2 ? ((k - 1) / 2) % 2 ? -1 / k : 1 / k : 0))
    // asin: x + x³/6 + 3x⁵/40 + …
    expectJet(jet('y = asin(x)', 0, 7), k => [0, 1, 0, 1 / 6, 0, 3 / 40, 0, 5 / 112][k])
    // tan: x + x³/3 + 2x⁵/15 + 17x⁷/315
    expectJet(jet('y = tan(x)', 0, 7), k => [0, 1, 0, 1 / 3, 0, 2 / 15, 0, 17 / 315][k])
    // 1/(1 − x), ln(1 + x), e^(−x²)
    expectJet(jet('y = 1/(1-x)', 0, 30), () => 1)
    expectJet(jet('y = ln(1+x)', 0, 30), k => (k === 0 ? 0 : (k % 2 ? 1 : -1) / k))
    expectJet(jet('y = e^(-x^2)', 0, 20), k => (k % 2 ? 0 : ((k / 2) % 2 ? -1 : 1) / fact(k / 2)))
  })

  it('abs, floor, ceil, sign, min, max away from their corners', () => {
    expectJet(jet('y = abs(x)', -2, 5), k => [2, -1, 0, 0, 0, 0][k])
    expectJet(jet('y = abs(x^2 - 1)', 0.5, 4), k => [0.75, -1, -1, 0, 0][k])
    expect(jet('y = floor(x)', 2.5, 3)).toEqual([2, 0, 0, 0])
    expect(jet('y = ceil(x)', -2.5, 3)).toEqual([-2, 0, 0, 0])
    expect(jet('y = sign(x)', -0.1, 3)).toEqual([-1, 0, 0, 0])
    expectJet(jet('y = min(x, x^2)', 2, 4), k => [2, 1, 0, 0, 0][k])
    expectJet(jet('y = max(x, x^2)', 2, 4), k => [4, 4, 1, 0, 0][k])
    expectJet(jet('y = max(x, x^2)', 0.5, 4), k => [0.5, 1, 0, 0, 0][k])
  })

  it('sliders are read from params; constants are constants', () => {
    expectJet(jet('y = a*sin(b*x)', 0, 5, [2, 3]), k => [0, 6, 0, -9, 0, 81 / 20][k])
    expectJet(jet('y = pi*x + tau + e', 1, 2), k => [2 * Math.PI + Math.PI + Math.E, Math.PI, 0][k])
  })

  it('degree 0 is the value; the length is n + 1', () => {
    expect(jet('y = sin(x)', 0.5, 0)).toEqual([Math.sin(0.5)])
    expect(jet('y = e^x', 0, 64)).toHaveLength(65)
  })
})

describe('jetAt — removable singularities cancel', () => {
  // Bernoulli numbers B_0…B_20 for x/(eˣ − 1) = Σ B_k x^k / k!
  const B = [1, -1 / 2, 1 / 6, 0, -1 / 30, 0, 1 / 42, 0, -1 / 30, 0, 5 / 66, 0, -691 / 2730, 0, 7 / 6, 0, -3617 / 510, 0, 43867 / 798, 0, -174611 / 330]

  it('sin(x)/x at 0: 1 − x²/6 + x⁴/120 − …', () => {
    expectJet(jet('y = sin(x)/x', 0, 30), k => (k % 2 ? 0 : ((k / 2) % 2 ? -1 : 1) / fact(k + 1)))
  })

  it('(1 − cos x)/x² at 0: 1/2 − x²/24 + x⁴/720 − …', () => {
    expectJet(jet('y = (1 - cos(x))/x^2', 0, 24), k => (k % 2 ? 0 : ((k / 2) % 2 ? -1 : 1) / fact(k + 2)))
  })

  it('(eˣ − 1)/x at 0: Σ x^k/(k+1)!', () => {
    expectJet(jet('y = (e^x - 1)/x', 0, 30), k => 1 / fact(k + 1))
  })

  it('ln(1 + x)/x at 0: Σ (−1)^k x^k/(k+1)', () => {
    expectJet(jet('y = ln(1+x)/x', 0, 30), k => (k % 2 ? -1 : 1) / (k + 1))
  })

  it('x/(eˣ − 1) at 0: the Bernoulli numbers', () => {
    expectJet(jet('y = x/(e^x - 1)', 0, 20), k => B[k] / fact(k), 1e-11, 1e-5)
  })

  it('at a hole away from 0, and at a double zero', () => {
    // sin(x)/(x − π) at π is −1 + (x − π)²/6 − …
    expectJet(jet('y = sin(x)/(x - pi)', Math.PI, 10), k => (k % 2 ? 0 : ((k / 2) % 2 ? 1 : -1) / fact(k + 1)), 1e-12, 1e-3)
    // (x² − 1)/(x − 1) = x + 1
    expectJet(jet('y = (x^2 - 1)/(x - 1)', 1, 6), k => [2, 1, 0, 0, 0, 0, 0][k], 1e-12, 1)
    // sin²x / x² at 0 = 1 − x²/3 + 2x⁴/45 − …
    expectJet(jet('y = sin(x)^2/x^2', 0, 4), k => [1, 0, -1 / 3, 0, 2 / 45][k])
    // composed: a function of the removable quotient
    expectJet(jet('y = e^(sin(x)/x)', 0, 2), k => [Math.E, 0, -Math.E / 6][k])
  })

  it('all n + 1 coefficients survive at degree 64', () => {
    const j = jet('y = sin(x)/x', 0, 64)!
    expect(j).toHaveLength(65)
    expect(j[64]).toBeCloseTo(1 / fact(65), 100)
  })
})

describe('jetAt — null where the formula is not analytic', () => {
  const nulls: [string, number][] = [
    ['y = abs(x)', 0],
    ['y = abs(sin(x))', Math.PI],
    ['y = sqrt(x)', 0],
    ['y = sqrt(x)', -1],
    ['y = x^(1/2)', 0],
    ['y = x^(2.5)', 0],
    ['y = x^(1/3)', -8],
    ['y = cbrt(x)', 0],
    ['y = ln(x)', 0],
    ['y = ln(x)', -1],
    ['y = ln(sin(x))', Math.PI],
    ['y = 1/x', 0],
    ['y = x^(-2)', 0],
    ['y = 1/(x - 1)', 1],
    ['y = sin(x)/x^2', 0],
    ['y = (1 - cos(x))/x^3', 0],
    ['y = x/(1 - cos(x))', 0],
    ['y = tan(x)', Math.PI / 2],
    ['y = sec(x)', -Math.PI / 2],
    ['y = csc(x)', Math.PI],
    ['y = cot(x)', 0],
    ['y = asin(x)', 1],
    ['y = acos(x)', -1],
    ['y = asin(x)', 2],
    ['y = floor(x)', 2],
    ['y = ceil(x)', -1],
    ['y = floor(10x)', 0.3],
    ['y = sign(x)', 0],
    ['y = sign(sin(x))', Math.PI],
    ['y = min(x, 1)', 1],
    ['y = max(x, x^2)', 1],
    ['y = x^x', 0],
    ['y = log_1(x)', 2],
  ]
  for (const [src, a] of nulls) {
    it(`${src} at ${Number(a.toFixed(4))}`, () => {
      expect(jet(src, a, 5)).toBeNull()
      // even when only the value is asked for
      expect(jet(src, a, 0)).toBeNull()
    })
  }

  it('a variable other than x, and a named call', () => {
    const y: ExprNode = { t: 'bin', op: '+', a: { t: 'var', name: 'x' }, b: { t: 'var', name: 'y' } }
    expect(jetAt(y, [], 1, 3)).toBeNull()
    // a ucall node, as the parser builds it for g(x) = f(x) + 1
    const ucall = {
      t: 'ucall',
      name: 'f',
      arg: { t: 'var', name: 'x' },
      order: 0,
      env: {},
    } as unknown as ExprNode
    expect(jetAt(ucall, [], 1, 3)).toBeNull()
  })

  it('non-finite input answers null', () => {
    expect(jet('y = x', Number.NaN, 3)).toBeNull()
    expect(jet('y = x', Infinity, 3)).toBeNull()
    expect(jet('y = e^x', 800, 3)).toBeNull() // e^800 overflows
  })
})

describe('jetAt — performance', () => {
  it('degree 64 on modest formulas takes well under 1 ms', () => {
    const cases: [string, number][] = [
      ['y = ln(1+x)', 0.3],
      ['y = atan(x)', 0.4],
      ['y = sin(x)/x', 0.7],
      ['y = e^(-x^2)', 0.5],
      ['y = sin(x)/x', 0],
      ['y = (1 - cos(x))/x^2', 0],
    ]
    for (const [src, a] of cases) {
      const r = parseExpression(src)
      if (!r.ok) throw new Error(r.error)
      const spec = r.plot.makeModel('m')
      spec.taylor!([], a, 64) // warm up
      const N = 200
      const t0 = performance.now()
      for (let i = 0; i < N; i++) spec.taylor!([], a, 64)
      const per = (performance.now() - t0) / N
      expect(per).toBeLessThan(0.5 * PERF)
    }
  })
})

// ============================================================================
// tests/taylor.test.ts — Taylor and Maclaurin polynomials, their error bounds,
// and the interval of convergence (src/core/taylor.ts).
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { parseExpression } from '../src/core/parse'
import { MODELS } from '../src/core/fit/models'
import {
  TAYLOR_N_MAX,
  alternatingBound,
  convergence,
  errorBand,
  evalTaylor,
  lagrangeBound,
  taylorLatex,
  taylorModel,
  taylorPolynomial,
  taylorSourceOf,
  taylorText,
  type TaylorPoly,
  type TaylorSource,
} from '../src/core/taylor'

function curve(modelId: string, params: number[], domain: [number, number] | null, kind: FittedCurve['kind']): FittedCurve {
  return {
    id: 'c',
    modelId,
    params,
    kind,
    domain,
    color: '#4f9cf9',
    strokeWidth: 2.5,
    visible: true,
    error: 0,
  }
}

function typed(src: string, domain?: [number, number] | null): { c: FittedCurve; models: Record<string, ModelSpec> } {
  const r = parseExpression(src)
  if (!r.ok) throw new Error(`expected "${src}" to parse, got: ${r.error}`)
  const models = { expr_1: r.plot.makeModel('expr_1') }
  const c = curve('expr_1', r.plot.defaultParams, domain === undefined ? r.plot.domain : domain, r.plot.kind)
  return { c, models }
}

function source(src: string, domain?: [number, number] | null): TaylorSource {
  const { c, models } = typed(src, domain)
  const s = taylorSourceOf(c, models)
  if (!s) throw new Error(`no Taylor source for "${src}"`)
  return s
}

function poly(src: string, a: number, n: number): TaylorPoly {
  const p = taylorPolynomial(source(src), a, n)
  if (!p) throw new Error(`no P_${n} for "${src}" about ${a}`)
  return p
}

const MINUS = '−'

function fact(k: number): number {
  let f = 1
  for (let i = 2; i <= k; i++) f *= i
  return f
}

function binom(j: number, k: number): number {
  let b = 1
  for (let i = 0; i < k; i++) b = (b * (j - i)) / (i + 1)
  return b
}

/** The same source with no singularity list: the bounds fall back on the coefficients. */
function withoutSingularities(s: TaylorSource): TaylorSource {
  return { f: s.f, jet: s.jet, domain: s.domain }
}

// ----------------------------------------------------------------------------

describe('taylorSourceOf', () => {
  it('a typed explicit formula has one; its f and jet are the model’s', () => {
    const s = source('y = sin(x)')
    expect(s.f(0.5)).toBe(Math.sin(0.5))
    expect(s.jet(0, 3)).toEqual([0, 1, 0, -1 / 6])
    expect(s.domain).toBeNull()
  })

  it('the curve’s domain restricts f and the jet', () => {
    const s = source('y = x^2', [-1, 2])
    expect(s.domain).toEqual([-1, 2])
    expect(s.f(3)).toBeNaN()
    expect(s.jet(3, 2)).toBeNull()
    expect(s.jet(2, 2)).toEqual([4, 4, 1])
  })

  it('null for a curve that is not explicit, or a model without jets', () => {
    const circle = typed('x^2 + y^2 = 1')
    expect(taylorSourceOf(circle.c, circle.models)).toBeNull()
    const sketched = curve('poly2', [0, 0, 1], null, 'explicit')
    expect(taylorSourceOf(sketched, MODELS)).toBeNull()
    const missing = curve('nope', [], null, 'explicit')
    expect(taylorSourceOf(missing, {})).toBeNull()
  })
})

describe('taylorPolynomial', () => {
  it('coefficients are f⁽ᵏ⁾(a)/k!, exact where they are exact', () => {
    const p = poly('y = sin(x)', Math.PI / 6, 4)
    expect(p.n).toBe(4)
    expect(p.a).toBe(Math.PI / 6)
    expect(p.exactA?.text).toBe('π/6')
    expect(p.exact.map(e => e?.text)).toEqual(['1/2', '√3/2', MINUS + '1/4', MINUS + '√3/12', '1/48'])
    expect(p.coeffs[0]).toBe(0.5)
    expect(p.coeffs[2]).toBe(-0.25)
    expect(p.coeffs[1]).toBeCloseTo(Math.sqrt(3) / 2, 15)
  })

  it('rounding of a zero is exactly zero (cos about 2π, sin about π)', () => {
    const c = poly('y = cos(x)', 2 * Math.PI, 6)
    expect([1, 3, 5].map(k => c.coeffs[k])).toEqual([0, 0, 0])
    expect(c.coeffs[0]).toBe(1)
    const s = poly('y = sin(x)', Math.PI, 3)
    expect(s.coeffs[0]).toBe(0)
    expect(s.coeffs[2]).toBe(0)
    expect(s.coeffs[1]).toBe(-1)
    // but a large coefficient does not wipe out a genuine small one
    const g = poly('y = 1/(1-x)', 0.9, 30)
    expect(g.coeffs[0]).toBeCloseTo(10, 10)
    expect(g.coeffs[30]).toBeCloseTo(1e31, -20)
  })

  it('n is integerised and clamped', () => {
    expect(poly('y = e^x', 0, 2.6).n).toBe(3)
    expect(poly('y = e^x', 0, 99).n).toBe(TAYLOR_N_MAX)
    expect(poly('y = e^x', 0, -3).n).toBe(0)
    expect(poly('y = e^x', 0, 99).coeffs).toHaveLength(TAYLOR_N_MAX + 1)
  })

  it('null outside the domain, where f is not analytic, and for non-finite input', () => {
    expect(taylorPolynomial(source('y = x^2', [0, 3]), 4, 2)).toBeNull()
    expect(taylorPolynomial(source('y = abs(x)'), 0, 2)).toBeNull()
    expect(taylorPolynomial(source('y = ln(x)'), -1, 2)).toBeNull()
    expect(taylorPolynomial(source('y = tan(x)'), Math.PI / 2, 2)).toBeNull()
    expect(taylorPolynomial(source('y = e^x'), Number.NaN, 2)).toBeNull()
    expect(taylorPolynomial(source('y = e^x'), 0, Infinity)).toBeNull()
    // a closed end of the domain is fine when the jet exists there …
    expect(taylorPolynomial(source('y = x^2', [1, 3]), 1, 2)?.coeffs).toEqual([1, 2, 1])
    // … and not when it does not
    expect(taylorPolynomial(source('y = sqrt(x)', [0, 4]), 0, 2)).toBeNull()
  })

  it('evalTaylor is the polynomial', () => {
    const p = poly('y = e^x', 1, 5)
    const x = 1.7
    let want = 0
    for (let k = 0; k <= 5; k++) want += p.coeffs[k] * Math.pow(x - 1, k)
    expect(evalTaylor(p, x)).toBeCloseTo(want, 13)
    expect(evalTaylor(p, 1)).toBeCloseTo(Math.E, 15)
  })

  it('taylorModel is an explicit, parameterless curve of Pₙ', () => {
    const p = poly('y = sin(x)', 0, 5)
    const m = taylorModel(p, 'taylor_1')
    expect(m.id).toBe('taylor_1')
    expect(m.kind).toBe('explicit')
    expect(m.name).toBe('Taylor polynomial')
    expect(m.paramMeta([])).toEqual([])
    expect(m.evalExplicit!([], 0.5)).toBeCloseTo(0.5 - 0.125 / 6 + 0.03125 / 120, 15)
    expect(m.latex([])).toBe(taylorLatex(p))
  })
})

describe('taylorLatex / taylorText', () => {
  const both = (src: string, a: number, n: number) => {
    const p = poly(src, a, n)
    return [taylorLatex(p), taylorText(p)]
  }

  it('sin x: P₅(x) = x − x³/6 + x⁵/120', () => {
    expect(both('y = sin(x)', 0, 5)).toEqual([
      'P_{5}(x) = x - \\frac{x^{3}}{6} + \\frac{x^{5}}{120}',
      `P₅(x) = x ${MINUS} x³/6 + x⁵/120`,
    ])
  })

  it('cos x: the odd terms are omitted', () => {
    expect(both('y = cos(x)', 0, 6)).toEqual([
      'P_{6}(x) = 1 - \\frac{x^{2}}{2} + \\frac{x^{4}}{24} - \\frac{x^{6}}{720}',
      `P₆(x) = 1 ${MINUS} x²/2 + x⁴/24 ${MINUS} x⁶/720`,
    ])
    expect(both('y = cos(x)', 0, 5)[1]).toBe(`P₅(x) = 1 ${MINUS} x²/2 + x⁴/24`)
  })

  it('e^x', () => {
    expect(both('y = e^x', 0, 2)).toEqual([
      'P_{2}(x) = 1 + x + \\frac{x^{2}}{2}',
      'P₂(x) = 1 + x + x²/2',
    ])
    expect(both('y = e^x', 0, 4)[1]).toBe('P₄(x) = 1 + x + x²/2 + x³/6 + x⁴/24')
  })

  it('ln(1 + x)', () => {
    expect(both('y = ln(1+x)', 0, 4)).toEqual([
      'P_{4}(x) = x - \\frac{x^{2}}{2} + \\frac{x^{3}}{3} - \\frac{x^{4}}{4}',
      `P₄(x) = x ${MINUS} x²/2 + x³/3 ${MINUS} x⁴/4`,
    ])
  })

  it('sin x about π/6: exact coefficients, powers of (x − π/6)', () => {
    expect(both('y = sin(x)', Math.PI / 6, 3)).toEqual([
      'P_{3}(x) = \\frac{1}{2} + \\frac{\\sqrt{3}}{2}\\left(x - \\frac{\\pi}{6}\\right)' +
        ' - \\frac{\\left(x - \\frac{\\pi}{6}\\right)^{2}}{4}' +
        ' - \\frac{\\sqrt{3}}{12}\\left(x - \\frac{\\pi}{6}\\right)^{3}',
      `P₃(x) = 1/2 + (√3/2)(x ${MINUS} π/6) ${MINUS} (x ${MINUS} π/6)²/4 ${MINUS} (√3/12)(x ${MINUS} π/6)³`,
    ])
  })

  it('1/x about 1', () => {
    expect(both('y = 1/x', 1, 3)).toEqual([
      'P_{3}(x) = 1 - \\left(x - 1\\right) + \\left(x - 1\\right)^{2} - \\left(x - 1\\right)^{3}',
      `P₃(x) = 1 ${MINUS} (x ${MINUS} 1) + (x ${MINUS} 1)² ${MINUS} (x ${MINUS} 1)³`,
    ])
  })

  it('a negative centre is (x + 1); a first negative term leads with a minus', () => {
    expect(both('y = x^3', -1, 3)).toEqual([
      'P_{3}(x) = -1 + 3\\left(x + 1\\right) - 3\\left(x + 1\\right)^{2} + \\left(x + 1\\right)^{3}',
      `P₃(x) = ${MINUS}1 + 3(x + 1) ${MINUS} 3(x + 1)² + (x + 1)³`,
    ])
  })

  it('ln x about 1 and atan x about 1: a single (x − a) over a number needs no brackets', () => {
    expect(both('y = ln(x)', 1, 3)[0]).toBe(
      'P_{3}(x) = \\left(x - 1\\right) - \\frac{\\left(x - 1\\right)^{2}}{2} + \\frac{\\left(x - 1\\right)^{3}}{3}',
    )
    expect(both('y = atan(x)', 1, 2)).toEqual([
      'P_{2}(x) = \\frac{\\pi}{4} + \\frac{x - 1}{2} - \\frac{\\left(x - 1\\right)^{2}}{4}',
      `P₂(x) = π/4 + (x ${MINUS} 1)/2 ${MINUS} (x ${MINUS} 1)²/4`,
    ])
  })

  it('binomial series: 5x⁴/128', () => {
    expect(both('y = sqrt(1+x)', 0, 4)).toEqual([
      'P_{4}(x) = 1 + \\frac{x}{2} - \\frac{x^{2}}{8} + \\frac{x^{3}}{16} - \\frac{5x^{4}}{128}',
      `P₄(x) = 1 + x/2 ${MINUS} x²/8 + x³/16 ${MINUS} 5x⁴/128`,
    ])
  })

  it('denominators past a million are written with factorials', () => {
    expect(both('y = sin(x)', 0, 11)[1]).toBe(
      `P₁₁(x) = x ${MINUS} x³/3! + x⁵/5! ${MINUS} x⁷/7! + x⁹/9! ${MINUS} x¹¹/11!`,
    )
    expect(both('y = sin(x)', 0, 11)[0]).toContain('\\frac{x^{11}}{11!}')
    expect(both('y = sin(x)', 0, 9)[1]).toBe(`P₉(x) = x ${MINUS} x³/6 + x⁵/120 ${MINUS} x⁷/5040 + x⁹/362880`)
  })

  it('decimal coefficients use 4 significant digits', () => {
    expect(both('y = e^x', 1, 2)).toEqual([
      'P_{2}(x) = 2.718 + 2.718\\left(x - 1\\right) + 1.359\\left(x - 1\\right)^{2}',
      'P₂(x) = 2.718 + 2.718(x − 1) + 1.359(x − 1)²',
    ])
  })

  it('P is 0 when every coefficient is', () => {
    expect(both('y = x^5', 0, 3)).toEqual(['P_{3}(x) = 0', 'P₃(x) = 0'])
  })

  it('no false closed forms: e, ln 3, sin 1, arctan 0.3 stay decimals', () => {
    for (const [src, a] of [
      ['y = e^x', 1],
      ['y = sin(x)', 1],
      ['y = e^(-x^2)', 0.5],
      ['y = atan(x)', 0.3],
      ['y = tan(x)', 1],
      ['y = x^x', 1.7],
    ] as [string, number][]) {
      const p = poly(src, a, 30)
      expect(p.exact.every(e => e === null), `${src} about ${a}`).toBe(true)
    }
    // and genuine ones at every degree: 1/(k·3^k) for ln x about 3
    const l = poly('y = ln(x)', 3, 20)
    for (let k = 1; k <= 20; k++) expect(l.exact[k]?.value).toBeCloseTo((k % 2 ? 1 : -1) / (k * 3 ** k), 20)
  })
})

describe('convergence — the interval of convergence', () => {
  const table: [string, number, string, number][] = [
    ['y = 1/(1-x)', 0, `(${MINUS}1, 1)`, 1],
    ['y = ln(1+x)', 0, `(${MINUS}1, 1]`, 1],
    ['y = ln(x)', 1, '(0, 2]', 1],
    ['y = atan(x)', 0, `[${MINUS}1, 1]`, 1],
    ['y = sqrt(1+x)', 0, `[${MINUS}1, 1]`, 1],
    ['y = 1/(1+x^2)', 0, `(${MINUS}1, 1)`, 1],
    ['y = 1/(1+x)', 0, `(${MINUS}1, 1)`, 1],
    ['y = 1/(2-x)', 0, `(${MINUS}2, 2)`, 2],
    ['y = x/(1-x)^2', 0, `(${MINUS}1, 1)`, 1],
    ['y = 1/x', 1, '(0, 2)', 1],
    ['y = tan(x)', 0, `(${MINUS}π/2, π/2)`, Math.PI / 2],
    ['y = e^x', 0, `(${MINUS}∞, ∞)`, Infinity],
    ['y = sin(x)', 0, `(${MINUS}∞, ∞)`, Infinity],
    ['y = cos(x)', 0, `(${MINUS}∞, ∞)`, Infinity],
    ['y = x^3 - 2x + 1', 1, `(${MINUS}∞, ∞)`, Infinity],
    ['y = e^(-x^2)', 0, `(${MINUS}∞, ∞)`, Infinity],
    ['y = x*e^x', 2, `(${MINUS}∞, ∞)`, Infinity],
    ['y = ln(x)', 2, '(0, 4]', 2],
    ['y = sqrt(x)', 4, '[0, 8]', 4],
    ['y = asin(x)', 0, `[${MINUS}1, 1]`, 1],
    ['y = ln(1+x^2)', 0, `[${MINUS}1, 1]`, 1],
    ['y = 1/(3-x)', 1, `(${MINUS}1, 3)`, 2],
    ['y = 1/(1+x^2)', 1, '(1−√2, 1+√2)', Math.SQRT2],
  ]
  for (const [src, a, text, R] of table) {
    it(`${src} about ${a}: ${text}`, () => {
      const c = convergence(source(src), a)
      expect(c).not.toBeNull()
      expect(c!.text).toBe(text)
      if (Number.isFinite(R)) expect(c!.R).toBeCloseTo(R, 12)
      else expect(c!.R).toBe(Infinity)
    })
  }

  it('the behaviour at each end, and the KaTeX', () => {
    const ln = convergence(source('y = ln(1+x)'), 0)!
    expect([ln.left, ln.right]).toEqual(['diverges', 'conditional'])
    expect([ln.lo, ln.hi]).toEqual([-1, 1])
    expect(ln.tex).toBe('\\left(-1, 1\\right]')
    const at = convergence(source('y = atan(x)'), 0)!
    expect([at.left, at.right]).toEqual(['conditional', 'conditional'])
    const sq = convergence(source('y = sqrt(1+x)'), 0)!
    expect([sq.left, sq.right]).toEqual(['converges', 'converges'])
    const t = convergence(source('y = tan(x)'), 0)!
    expect([t.left, t.right]).toEqual(['diverges', 'diverges'])
    expect(t.exactR?.text).toBe('π/2')
    expect(t.tex).toBe('\\left(-\\frac{\\pi}{2}, \\frac{\\pi}{2}\\right)')
    const e = convergence(source('y = e^x'), 0)!
    expect([e.lo, e.hi, e.left, e.right]).toEqual([-Infinity, Infinity, 'converges', 'converges'])
    expect(e.tex).toBe('\\left(-\\infty, \\infty\\right)')
  })

  it('a centre in closed form keeps its form: tan about π/4 is (0, π/2)', () => {
    const c = convergence(source('y = tan(x)'), Math.PI / 4)!
    expect(c.text).toBe('(0, π/2)')
    expect(c.exactR?.text).toBe('π/4')
  })

  it('unknown rather than wrong', () => {
    // arctan about 1: the endpoint series are Σ sin(kπ/4)/k-like, neither
    // alternating nor of one sign — no verdict, and no bracket
    const at = convergence(source('y = atan(x)'), 1)!
    expect(at.R).toBeCloseTo(Math.SQRT2, 12)
    expect([at.left, at.right]).toEqual(['unknown', 'unknown'])
    expect(at.text).toBe('(1−√2, 1+√2)')
    // sin(x)/x is entire, but read directly (a source that names no holes)
    // its jet about 0.7 is sin·(1/x): past the degree where the true
    // coefficients sink below rounding, the tail is noise growing at 1/x's
    // rate. Never a finite interval.
    const sx = convergence(withoutSingularities(source('y = sin(x)/x')), 0.7)
    expect(sx === null || sx.R === Infinity).toBe(true)
    // 1/(1 + x²) about 0.5: an irrational rotation, read along its crests —
    // near √1.25, never a closed end
    const q = convergence(source('y = 1/(1+x^2)'), 0.5)
    if (q) {
      expect(q.R).toBeCloseTo(Math.sqrt(1.25), 1)
      expect(q.left === 'converges' || q.left === 'conditional').toBe(false)
      expect(q.right === 'converges' || q.right === 'conditional').toBe(false)
    }
  })

  it('null where there is no series', () => {
    expect(convergence(source('y = abs(x)'), 0)).toBeNull()
    expect(convergence(source('y = x^2', [0, 1]), 2)).toBeNull()
    expect(convergence(source('y = e^x'), Number.NaN)).toBeNull()
  })
})

describe('error bounds', () => {
  it('Lagrange: sin x, a = 0, n = 3, at x = 0.5 — M = sin 0.5, bound ≈ 1.25e-3', () => {
    const b = lagrangeBound(source('y = sin(x)'), 0, 3, 0.5)!
    expect(b.M).toBeCloseTo(Math.sin(0.5), 12)
    expect(b.argMax).toBeCloseTo(0.5, 12)
    expect(b.bound).toBeCloseTo((Math.sin(0.5) * 0.5 ** 4) / 24, 15)
    expect(b.bound).toBeCloseTo(1.2485e-3, 7)
    // and it does bound the error
    const p = poly('y = sin(x)', 0, 3)
    expect(Math.abs(Math.sin(0.5) - evalTaylor(p, 0.5))).toBeLessThanOrEqual(b.bound)
  })

  it('alternating: sin x, a = 0, n = 3, at x = 0.5 — the x⁵/120 term', () => {
    const s = source('y = sin(x)')
    expect(alternatingBound(s, 0, 3, 0.5)).toBeCloseTo(0.5 ** 5 / 120, 18)
    expect(alternatingBound(s, 0, 3, -0.5)).toBeCloseTo(0.5 ** 5 / 120, 18)
    expect(alternatingBound(s, 0, 3, 0.5)!).toBeCloseTo(2.6e-4, 5)
  })

  it('AP classic: e^x about 0, n = 2, at x = 0.1', () => {
    const s = source('y = e^x')
    const b = lagrangeBound(s, 0, 2, 0.1)!
    expect(b.M).toBeCloseTo(Math.exp(0.1), 12)
    expect(b.argMax).toBeCloseTo(0.1, 12)
    expect(b.bound).toBeCloseTo((Math.exp(0.1) * 0.001) / 6, 15)
    // all terms positive at 0.1: no alternating bound; at −0.1 there is one
    expect(alternatingBound(s, 0, 2, 0.1)).toBeNull()
    expect(alternatingBound(s, 0, 2, -0.1)).toBeCloseTo(0.001 / 6, 18)
  })

  it('M is found inside the interval, not only at its ends', () => {
    // |cos⁽⁴⁾| = |cos t| on [−1, 2] peaks at t = 0
    const b = lagrangeBound(source('y = cos(x)'), 2, 3, -1)!
    expect(b.M).toBeCloseTo(1, 12)
    expect(b.argMax).toBeCloseTo(0, 6)
    // |sin⁽⁶⁾| = |sin t| on [0, 3] peaks at π/2
    const s = lagrangeBound(source('y = sin(x)'), 0, 5, 3)!
    expect(s.M).toBeCloseTo(1, 12)
    expect(s.argMax).toBeCloseTo(Math.PI / 2, 5)
  })

  it('no Lagrange bound across a pole or outside the domain; x = a is 0', () => {
    expect(lagrangeBound(source('y = 1/x'), 1, 2, -1)).toBeNull()
    // no sample lands on the pole: the source names it, and without that
    // the samples on either side still see it
    for (const s of [(t: string) => source(t), (t: string) => withoutSingularities(source(t))]) {
      expect(lagrangeBound(s('y = 1/x'), 1, 2, -1.1)).toBeNull()
      expect(lagrangeBound(s('y = 1/(x-0.123)^2'), 1, 2, -0.77)).toBeNull()
      expect(lagrangeBound(s('y = tan(x)'), 0, 3, 2)).toBeNull()
      // a complex pair far from the axis is no reason to refuse
      expect(lagrangeBound(s('y = 1/(1+x^2)'), 0, 3, 4)).not.toBeNull()
    }
    // a pole just past the last sample gap: only the named list is exact
    expect(lagrangeBound(source('y = 1/(x - 0.999999)'), 0, 2, 1)).toBeNull()
    expect(lagrangeBound(source('y = ln(x)', [0.5, 3]), 1, 2, 4)).toBeNull()
    expect(lagrangeBound(source('y = e^x'), 0, 3, 0)).toEqual({ M: 1, argMax: 0, bound: 0 })
  })

  it('alternating bound: ln(1 + x) at the endpoint 1, not past it, not where the terms have one sign', () => {
    const s = source('y = ln(1+x)')
    expect(alternatingBound(s, 0, 3, 1)).toBeCloseTo(0.25, 15)
    expect(alternatingBound(s, 0, 3, 1.01)).toBeNull()
    expect(alternatingBound(s, 0, 3, -0.5)).toBeNull()
  })

  it('error band: monotone in |x − a| for sin, and the Lagrange bound at each x', () => {
    const s = source('y = sin(x)')
    const xs = Array.from({ length: 201 }, (_, i) => -4 + i * 0.04)
    const a = 0.3
    const band = errorBand(s, a, 5, xs)
    expect(band).toHaveLength(201)
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] <= a) expect(band[i]).toBeLessThanOrEqual(band[i - 1])
      if (xs[i - 1] >= a) expect(band[i]).toBeGreaterThanOrEqual(band[i - 1])
    }
    for (const b of band) expect(Number.isFinite(b)).toBe(true)
    // at x = 2 the band is the Lagrange bound (|sin⁽⁶⁾| = |sin t| peaks at π/2 inside)
    const i2 = xs.findIndex(x => Math.abs(x - 2) < 1e-9)
    const lb = lagrangeBound(s, a, 5, 2)!
    expect(band[i2]).toBeCloseTo(lb.bound, 6)
    // and it bounds the actual error everywhere
    const p = poly('y = sin(x)', a, 5)
    xs.forEach((x, i) => expect(Math.abs(Math.sin(x) - evalTaylor(p, x))).toBeLessThanOrEqual(band[i] * (1 + 1e-9) + 1e-15))
  })

  it('error band: NaN past a pole, and outside the domain', () => {
    const xs = [-1, -0.5, 0, 0.5, 1, 1.5, 2]
    const band = errorBand(source('y = 1/x'), 1, 2, xs)
    expect(Array.from(band.slice(0, 3)).every(Number.isNaN)).toBe(true)
    expect(Array.from(band.slice(3)).every(Number.isFinite)).toBe(true)
    expect(band[4]).toBe(0)
    // samples that straddle the pole without touching it
    for (const s of [source('y = 1/x'), withoutSingularities(source('y = 1/x'))]) {
      const straddle = errorBand(s, 1, 2, [-0.95, 0.05, 1, 1.5])
      expect(straddle[0]).toBeNaN()
      expect(Array.from(straddle.slice(1)).every(Number.isFinite)).toBe(true)
    }
    // the named pole stops the band exactly where it is
    const near = errorBand(source('y = 1/(x - 0.5)'), 0, 1, [-0.5, 0, 0.4999, 0.5001, 1])
    expect(Array.from(near).map(Number.isFinite)).toEqual([true, true, true, false, false])
    const d = errorBand(source('y = e^x', [0, 1]), 0.5, 2, xs)
    expect(Array.from(d).map(Number.isFinite)).toEqual([false, false, true, true, true, false, false])
  })
})

describe('removable singularities: the BC classics about 0', () => {
  const classics: [string, string, string][] = [
    ['y = sin(x)/x', 'P_{4}(x) = 1 - \\frac{x^{2}}{6} + \\frac{x^{4}}{120}', `P₄(x) = 1 ${MINUS} x²/6 + x⁴/120`],
    ['y = (1 - cos(x))/x^2', 'P_{4}(x) = \\frac{1}{2} - \\frac{x^{2}}{24} + \\frac{x^{4}}{720}', `P₄(x) = 1/2 ${MINUS} x²/24 + x⁴/720`],
    ['y = (e^x - 1)/x', 'P_{4}(x) = 1 + \\frac{x}{2} + \\frac{x^{2}}{6} + \\frac{x^{3}}{24} + \\frac{x^{4}}{120}', 'P₄(x) = 1 + x/2 + x²/6 + x³/24 + x⁴/120'],
    ['y = ln(1+x)/x', 'P_{4}(x) = 1 - \\frac{x}{2} + \\frac{x^{2}}{3} - \\frac{x^{3}}{4} + \\frac{x^{4}}{5}', `P₄(x) = 1 ${MINUS} x/2 + x²/3 ${MINUS} x³/4 + x⁴/5`],
    ['y = x/(e^x - 1)', 'P_{4}(x) = 1 - \\frac{x}{2} + \\frac{x^{2}}{12} - \\frac{x^{4}}{720}', `P₄(x) = 1 ${MINUS} x/2 + x²/12 ${MINUS} x⁴/720`],
  ]
  for (const [src, tex, text] of classics) {
    it(`${src}: ${text}`, () => {
      const s = source(src)
      // the curve has a hole at 0 …
      expect(s.f(0)).toBeNaN()
      // … and Pₙ about it exists, its c₀ the limit
      const p = taylorPolynomial(s, 0, 4)!
      expect(taylorLatex(p)).toBe(tex)
      expect(taylorText(p)).toBe(text)
    })
  }

  it('sin(x)/x: exact coefficients 1, −1/6, 1/120, −1/5040 …', () => {
    const p = poly('y = sin(x)/x', 0, 8)
    expect(p.exact.map(e => e?.text ?? null)).toEqual(['1', '0', MINUS + '1/6', '0', '1/120', '0', MINUS + '1/5040', '0', '1/362880'])
  })

  it('near the hole the coefficients are still exact to rounding (not sin·(1/x) noise)', () => {
    // sinc about t, from its Maclaurin series re-expanded by hand
    const t = 0.001
    const p = poly('y = sin(x)/x', t, 8)
    const mac = (j: number) => (j % 2 ? 0 : ((j / 2) % 2 ? -1 : 1) / fact(j + 1))
    for (let k = 0; k <= 8; k++) {
      let want = 0
      for (let j = k; j <= 40; j++) want += mac(j) * binom(j, k) * Math.pow(t, j - k)
      expect(p.coeffs[k]).toBeCloseTo(want, 13)
    }
  })

  it('the intervals: entire, (−1, 1], (−2π, 2π)', () => {
    expect(convergence(source('y = sin(x)/x'), 0)!.R).toBe(Infinity)
    expect(convergence(source('y = sin(x)/x'), 0.7)!.R).toBe(Infinity)
    expect(convergence(source('y = (1 - cos(x))/x^2'), 0)!.R).toBe(Infinity)
    expect(convergence(source('y = (e^x - 1)/x'), 0)!.R).toBe(Infinity)
    expect(convergence(source('y = ln(1+x)/x'), 0)!.text).toBe(`(${MINUS}1, 1]`)
    const b = convergence(source('y = x/(e^x - 1)'), 0)!
    expect(b.text).toBe(`(${MINUS}2π, 2π)`)
    expect([b.left, b.right]).toEqual(['diverges', 'diverges'])
  })

  it('the Lagrange and alternating bounds do not trip over the hole', () => {
    const s = source('y = sin(x)/x')
    // |f⁽⁴⁾| on [0, 0.5] peaks at the hole: f⁽⁴⁾(0) = 4!/5! = 1/5
    const b = lagrangeBound(s, 0, 3, 0.5)!
    expect(b.M).toBeCloseTo(0.2, 12)
    expect(b.argMax).toBeCloseTo(0, 6)
    expect(b.bound).toBeCloseTo((0.2 * 0.5 ** 4) / 24, 15)
    expect(alternatingBound(s, 0, 4, 0.5)).toBeCloseTo(0.5 ** 6 / 5040, 18)
    // across the hole from the other side, and at high degree: still a true bound
    for (const [a, n, x] of [[0.3, 5, -0.4], [0, 10, 1.5], [0.2, 20, -2]] as [number, number, number][]) {
      const lb = lagrangeBound(s, a, n, x)!
      const p = poly('y = sin(x)/x', a, n)
      const err = Math.abs(Math.sin(x) / x - evalTaylor(p, x))
      expect(err).toBeLessThanOrEqual(lb.bound * (1 + 1e-6) + 1e-16)
      expect(lb.bound).toBeLessThan(1)
    }
  })

  it('the band is finite and monotone through the hole', () => {
    const s = source('y = sin(x)/x')
    const xs = Array.from({ length: 201 }, (_, i) => -4 + i * 0.04)
    const band = errorBand(s, 0, 9, xs)
    expect(Array.from(band).every(Number.isFinite)).toBe(true)
    expect(band[100]).toBe(0)
    for (let i = 101; i < xs.length; i++) expect(band[i]).toBeGreaterThanOrEqual(band[i - 1])
    for (let i = 99; i >= 0; i--) expect(band[i]).toBeGreaterThanOrEqual(band[i + 1])
    const p = poly('y = sin(x)/x', 0, 9)
    xs.forEach((x, i) => {
      if (x !== 0) expect(Math.abs(Math.sin(x) / x - evalTaylor(p, x))).toBeLessThanOrEqual(band[i] * (1 + 1e-6) + 1e-15)
    })
  })
})

describe('singularities in the source', () => {
  it('taylorSourceOf passes the model’s, with the curve’s params, inside its domain', () => {
    expect(source('y = sin(x)/x').singularities!([-1, 1])).toEqual([0])
    expect(source('y = 1/(x - a)').singularities!([-5, 5])).toEqual([1])
    expect(source('y = 1/x', [0.5, 3]).singularities!([-5, 5])).toEqual([])
  })

  it('a named pole gives the radius to the last bit', () => {
    const c = convergence(source('y = 1/(x - 0.37)'), 0)!
    expect(c.R).toBe(0.37)
    expect(c.text).toBe(`(${MINUS}0.37, 0.37)`)
    expect(convergence(source('y = 1/(x^2 - 2)'), 0)!.text).toBe(`(${MINUS}√2, √2)`)
  })
})

describe('properties', () => {
  it('Pₙ(x) → f(x) inside the interval as n grows', () => {
    const cases: [string, number, number, (x: number) => number][] = [
      ['y = ln(1+x)', 0, 0.5, x => Math.log(1 + x)],
      ['y = e^x', 0, 2, Math.exp],
      ['y = atan(x)', 0, 0.8, Math.atan],
      ['y = 1/(1-x)', 0, -0.6, x => 1 / (1 - x)],
      ['y = sin(x)', Math.PI / 6, 2.5, Math.sin],
      ['y = sqrt(x)', 4, 6, Math.sqrt],
    ]
    for (const [src, a, x, f] of cases) {
      const s = source(src)
      const errs = [2, 6, 10, 20, 30].map(n => Math.abs(f(x) - evalTaylor(taylorPolynomial(s, a, n)!, x)))
      for (let i = 1; i < errs.length; i++) expect(errs[i], `${src} at ${x}`).toBeLessThan(errs[i - 1])
      expect(errs[errs.length - 1], `${src} at ${x}`).toBeLessThan(1e-4)
    }
  })

  it('Pₙ has f’s value and first n derivatives at a, and nothing past n', () => {
    const cases: [string, number, number][] = [
      ['y = sin(x)', Math.PI / 6, 5],
      ['y = e^(-x^2)', 0.4, 6],
      ['y = ln(x)', 2, 4],
      ['y = atan(x)', -1, 7],
    ]
    for (const [src, a, n] of cases) {
      const p = poly(src, a, n)
      // Pₙ typed back in as a formula, and differentiated by its own jets
      const typedP = 'y = ' + p.coeffs.map((c, k) => `(${c.toPrecision(17)})*(x - (${a.toPrecision(17)}))^${k}`).join(' + ')
      const r = parseExpression(typedP)
      if (!r.ok) throw new Error(r.error)
      const pj = r.plot.makeModel('p').taylor!([], a, n + 3)!
      const fj = source(src).jet(a, n)!
      for (let k = 0; k <= n; k++) expect(pj[k]).toBeCloseTo(fj[k], 12)
      for (let k = n + 1; k <= n + 3; k++) expect(Math.abs(pj[k])).toBeLessThan(1e-12)
    }
  })
})

describe('performance', () => {
  const time = (fn: () => void, reps = 20): number => {
    fn()
    const t0 = performance.now()
    for (let i = 0; i < reps; i++) fn()
    return (performance.now() - t0) / reps
  }

  it('a polynomial, the interval and a 200-sample band are slider-cheap', () => {
    const s = source('y = sin(x)')
    const xs = Array.from({ length: 200 }, (_, i) => -5 + i * 0.05)
    expect(time(() => taylorPolynomial(s, Math.PI / 6, 30))).toBeLessThan(15)
    expect(time(() => taylorPolynomial(s, 0, 5))).toBeLessThan(3)
    expect(time(() => convergence(source('y = ln(1+x)'), 0))).toBeLessThan(10)
    expect(time(() => errorBand(s, 0.3, 9, xs))).toBeLessThan(10)
    expect(time(() => lagrangeBound(s, 0, 9, 2))).toBeLessThan(10)
  })
})

describe('taylorLatex — a factorial denominator is written as that factorial', () => {
  it('sin(x)/x about 0, P₁₀: x²/3!, x⁴/5! …, never 3·2!', async () => {
    const { parseExpression } = await import('../src/core/parse')
    const { taylorSourceOf, taylorPolynomial, taylorLatex } = await import('../src/core/taylor')
    const r = parseExpression('y = sin(x)/x')
    if (!r.ok) throw new Error(r.error)
    const models = { m: r.plot.makeModel('m') }
    const src = taylorSourceOf(
      { id: 'c', modelId: 'm', params: [], kind: 'explicit', domain: null, color: '#fff', strokeWidth: 2, visible: true, error: 0 },
      models,
    )!
    const tex = taylorLatex(taylorPolynomial(src, 0, 10)!)
    expect(tex).toBe(
      'P_{10}(x) = 1 - \\frac{x^{2}}{3!} + \\frac{x^{4}}{5!} - \\frac{x^{6}}{7!} + \\frac{x^{8}}{9!} - \\frac{x^{10}}{11!}',
    )
  })
})

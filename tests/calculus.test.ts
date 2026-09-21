// ============================================================================
// tests/calculus.test.ts — tangent lines, derivative curves, definite
// integrals and Riemann sums (src/core/calculus.ts).
//
// Every number here is worked out in closed form by hand, the way it would be
// worked out on the board: the tangent to y = x³ − 3x at x = 2 is y = 9x − 16
// because f′(2) = 3·4 − 3 = 9 and f(2) = 2. Nothing is asserted against
// "whatever the implementation printed".
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { parseExpression } from '../src/core/parse/index'
import {
  tangentAt, derivativeModel, areaUnder, areaBetween, curveIntersections,
  riemann, hasExactDerivative,
  type RiemannMethod,
} from '../src/core/calculus'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function curve(
  modelId: string,
  params: number[],
  domain: [number, number] | null = null,
): FittedCurve {
  return {
    id: 'test-curve',
    modelId,
    params,
    kind: MODELS[modelId]?.kind ?? 'explicit',
    domain,
    color: '#4f9cf9',
    strokeWidth: 2.5,
    visible: true,
    error: 0,
  }
}

/** A typed expression, exactly as App.tsx builds one: expr_N + extra model. */
function typed(
  src: string,
  domain: [number, number] | null = null,
): { curve: FittedCurve; models: Record<string, ModelSpec>; spec: ModelSpec } {
  const out = parseExpression(src)
  if (!out.ok) throw new Error(`parse failed for "${src}": ${out.error}`)
  const spec = out.plot.makeModel('expr_1')
  const models: Record<string, ModelSpec> = { ...MODELS, expr_1: spec }
  const c: FittedCurve = {
    id: 'typed-curve',
    modelId: 'expr_1',
    params: out.plot.defaultParams.slice(),
    kind: out.plot.kind,
    domain: domain ?? out.plot.domain,
    color: '#4f9cf9',
    strokeWidth: 2.5,
    visible: true,
    error: 0,
  }
  return { curve: c, models, spec }
}

/** Every returned field is a real number — never NaN, never Infinity. */
function allFinite(o: Record<string, unknown>): boolean {
  return Object.values(o).every(v =>
    typeof v === 'number' ? Number.isFinite(v) : true,
  )
}

// ---------------------------------------------------------------------------
// 1. Tangent lines
// ---------------------------------------------------------------------------

describe('tangentAt — closed form', () => {
  it('y = x^3 - 3x at x = 2 is y = 9x - 16, touching (2, 2)', () => {
    // f'(x) = 3x² − 3; f'(2) = 9; f(2) = 8 − 6 = 2; b = 2 − 9·2 = −16
    const t = tangentAt(curve('poly3', [0, -3, 0, 1]), MODELS, 2)
    expect(t).not.toBeNull()
    expect(t!.m).toBeCloseTo(9, 12)
    expect(t!.b).toBeCloseTo(-16, 12)
    expect(t!.point.x).toBeCloseTo(2, 12)
    expect(t!.point.y).toBeCloseTo(2, 12)
    expect(t!.exact).toBe(true)
  })

  it('a parabola: y = x^2 at x = 3 is y = 6x - 9', () => {
    const t = tangentAt(curve('poly2', [0, 0, 1]), MODELS, 3)
    expect(t!.m).toBeCloseTo(6, 12)
    expect(t!.b).toBeCloseTo(-9, 12)
    expect(t!.exact).toBe(true)
  })

  it('a line is its own tangent everywhere', () => {
    // params [b, m] ascending: y = 3x − 1
    const t = tangentAt(curve('line', [-1, 3]), MODELS, 7)
    expect(t!.m).toBeCloseTo(3, 14)
    expect(t!.b).toBeCloseTo(-1, 14)
    expect(t!.exact).toBe(true)
  })

  it('sin at pi/2 is horizontal', () => {
    const t = tangentAt(curve('sine', [1, 1, 0, 0]), MODELS, Math.PI / 2)
    expect(t).not.toBeNull()
    expect(t!.m).toBeCloseTo(0, 12)
    expect(t!.point.y).toBeCloseTo(1, 12)
    expect(t!.b).toBeCloseTo(1, 12)
    expect(t!.exact).toBe(true)
  })

  it('e^x at 0 is y = x + 1', () => {
    const t = tangentAt(curve('exp', [1, 1, 0]), MODELS, 0)
    expect(t!.m).toBeCloseTo(1, 14)
    expect(t!.b).toBeCloseTo(1, 14)
    expect(t!.exact).toBe(true)
  })

  it('ln(x) at 1 has slope 1 and passes through (1, 0)', () => {
    const t = tangentAt(curve('log', [1, 0, 0]), MODELS, 1)
    expect(t!.m).toBeCloseTo(1, 14)
    expect(t!.point.y).toBeCloseTo(0, 14)
    expect(t!.b).toBeCloseTo(-1, 14)
    expect(t!.exact).toBe(true)
  })

  it('1/x at x = 2 has slope -1/4', () => {
    const t = tangentAt(curve('recip', [1, 0, 0]), MODELS, 2)
    expect(t!.m).toBeCloseTo(-0.25, 14)
    expect(t!.b).toBeCloseTo(1, 14)
  })

  it('the Gaussian is flat at its peak and steepest at x = b ± c/sqrt(2)', () => {
    const g = curve('gauss', [2, 0, 1, 0])   // 2·e^{−x²}
    expect(tangentAt(g, MODELS, 0)!.m).toBeCloseTo(0, 12)
    // d/dx 2e^{−x²} = −4x·e^{−x²}; at x = 1: −4/e
    expect(tangentAt(g, MODELS, 1)!.m).toBeCloseTo(-4 / Math.E, 12)
  })

  it('the logistic slope at its midpoint is a·b/4', () => {
    const t = tangentAt(curve('logistic', [1, 2, 0, 0]), MODELS, 0)
    expect(t!.m).toBeCloseTo(0.5, 12)
  })

  it('the cube root has a slope away from its branch point', () => {
    // d/dx x^{1/3} = 1/(3x^{2/3}); at x = 8: 1/12
    const t = tangentAt(curve('cbrt', [1, 0, 0]), MODELS, 8)
    expect(t!.m).toBeCloseTo(1 / 12, 12)
    expect(t!.exact).toBe(true)
  })
})

describe('tangentAt — where the derivative does not exist', () => {
  it('refuses the kink of y = |x|', () => {
    expect(tangentAt(curve('abs', [1, 0, 0]), MODELS, 0)).toBeNull()
    // and still answers on either side
    expect(tangentAt(curve('abs', [1, 0, 0]), MODELS, 0.5)!.m).toBeCloseTo(1, 14)
    expect(tangentAt(curve('abs', [1, 0, 0]), MODELS, -0.5)!.m).toBeCloseTo(-1, 14)
  })

  it('refuses the branch point of y = sqrt(x) (vertical tangent)', () => {
    expect(tangentAt(curve('sqrt', [1, 0, 0]), MODELS, 0)).toBeNull()
    expect(tangentAt(curve('sqrt', [1, 0, 0]), MODELS, -1)).toBeNull()
    expect(tangentAt(curve('sqrt', [1, 0, 0]), MODELS, 4)!.m).toBeCloseTo(0.25, 14)
  })

  it('refuses the pole of y = 1/x', () => {
    expect(tangentAt(curve('recip', [1, 0, 0]), MODELS, 0)).toBeNull()
  })

  it('refuses the asymptote of y = ln(x) and everything left of it', () => {
    expect(tangentAt(curve('log', [1, 0, 0]), MODELS, 0)).toBeNull()
    expect(tangentAt(curve('log', [1, 0, 0]), MODELS, -2)).toBeNull()
  })

  it('refuses the cusp of a power curve with p < 1', () => {
    expect(tangentAt(curve('power', [1, 0, 0, 2 / 3]), MODELS, 0)).toBeNull()
    // p > 1 is smooth at the join and has slope 0 there
    expect(tangentAt(curve('power', [1, 0, 0, 2]), MODELS, 0)!.m).toBeCloseTo(0, 14)
  })

  it('refuses outside the curve own domain', () => {
    const c = curve('poly2', [0, 0, 1], [-1, 1])
    expect(tangentAt(c, MODELS, 5)).toBeNull()
    expect(tangentAt(c, MODELS, -1)).not.toBeNull()   // the endpoint counts
  })

  it('refuses curves that are not functions of x', () => {
    expect(tangentAt(curve('circle', [0, 0, 2]), MODELS, 1)).toBeNull()
    expect(tangentAt(curve('polarRose', [1, 3, 0]), MODELS, 1)).toBeNull()
    expect(tangentAt(curve('vline', [2]), MODELS, 2)).toBeNull()
  })

  it('refuses NaN parameters and a NaN x instead of returning NaN fields', () => {
    expect(tangentAt(curve('poly2', [0, Number.NaN, 1]), MODELS, 1)).toBeNull()
    expect(tangentAt(curve('poly2', [0, 0, 1]), MODELS, Number.NaN)).toBeNull()
  })
})

describe('tangentAt — typed expressions (numeric)', () => {
  it('y = x^2 at 3 gives 6 within 1e-8 and says it is not exact', () => {
    const { curve: c, models } = typed('y = x^2')
    const t = tangentAt(c, models, 3)
    expect(t).not.toBeNull()
    expect(t!.exact).toBe(false)
    expect(Math.abs(t!.m - 6)).toBeLessThan(1e-8)
    expect(Math.abs(t!.b - -9)).toBeLessThan(1e-7)
    expect(allFinite(t as unknown as Record<string, unknown>)).toBe(true)
  })

  it('matches the analytic slope of a transcendental expression', () => {
    const { curve: c, models } = typed('y = sin(x)*e^(x/3)')
    // f' = cos x·e^{x/3} + (1/3)·sin x·e^{x/3}
    for (const x of [-2, -0.7, 0, 0.5, 1.3, 2.4]) {
      const want = Math.exp(x / 3) * (Math.cos(x) + Math.sin(x) / 3)
      const t = tangentAt(c, models, x)
      expect(t).not.toBeNull()
      expect(Math.abs(t!.m - want)).toBeLessThan(1e-8)
    }
  })

  it('refuses the corner of a typed absolute value', () => {
    const { curve: c, models } = typed('y = abs(x - 1)')
    expect(tangentAt(c, models, 1)).toBeNull()
    expect(tangentAt(c, models, 2)!.m).toBeCloseTo(1, 6)
  })

  it('does not mistake a very curved smooth function for a corner', () => {
    const { curve: c, models } = typed('y = 1000x^2')
    const t = tangentAt(c, models, 0)
    expect(t).not.toBeNull()
    expect(Math.abs(t!.m)).toBeLessThan(1e-6)
  })

  it('refuses where a typed expression is undefined', () => {
    const { curve: c, models } = typed('y = sqrt(x)')
    expect(tangentAt(c, models, -1)).toBeNull()
    expect(tangentAt(c, models, 0)).toBeNull()      // no room for a symmetric step
    expect(tangentAt(c, models, 4)!.m).toBeCloseTo(0.25, 8)
  })
})

// ---------------------------------------------------------------------------
// 2. Derivative curves
// ---------------------------------------------------------------------------

describe('derivativeModel — closed form inside the library', () => {
  it('a cubic differentiates to a real poly2, coefficient for coefficient', () => {
    // f = 0.35x³ − 0.7x² − 1.75x + 2.1  ->  f' = 1.05x² − 1.4x − 1.75
    const d = derivativeModel(curve('poly3', [2.1, -1.75, -0.7, 0.35]), MODELS, 'd1')
    expect(d).not.toBeNull()
    expect(d!.spec.id).toBe('poly2')
    expect(d!.spec).toBe(MODELS.poly2)            // the library family itself
    expect(d!.kind).toBe('explicit')
    expect(d!.exact).toBe(true)
    expect(d!.params.length).toBe(3)
    expect(d!.params[0]).toBeCloseTo(-1.75, 15)
    expect(d!.params[1]).toBeCloseTo(-1.4, 15)
    expect(d!.params[2]).toBeCloseTo(1.05, 15)
    // and it evaluates as a parabola should
    for (const x of [-2, -0.5, 0, 1.7, 3]) {
      expect(d!.spec.evalExplicit!(d!.params, x)).toBeCloseTo(
        1.05 * x * x - 1.4 * x - 1.75, 12,
      )
    }
  })

  it('a parabola differentiates to a line, a line to a constant', () => {
    const d = derivativeModel(curve('poly2', [5, -4, 3]), MODELS, 'd1')
    expect(d!.spec.id).toBe('line')
    expect(d!.params[0]).toBeCloseTo(-4, 14)   // ascending [b, m]: y = 6x − 4
    expect(d!.params[1]).toBeCloseTo(6, 14)

    const e = derivativeModel(curve('line', [-1, 3]), MODELS, 'd2')
    expect(e!.spec.id).toBe('line')
    expect(e!.params[0]).toBeCloseTo(3, 14)
    expect(e!.params[1]).toBeCloseTo(0, 14)
  })

  it('a quartic differentiates to a cubic', () => {
    const d = derivativeModel(curve('poly4', [1, 2, 3, 4, 5], [-3, 3]), MODELS, 'd1')
    expect(d!.spec.id).toBe('poly3')
    expect(d!.params).toHaveLength(4)
    expect(d!.params[3]).toBeCloseTo(20, 12)   // 4·5
    expect(d!.domain).toEqual([-3, 3])          // the derivative lives where f does
  })

  it('a sinusoid differentiates to a sinusoid, phase-shifted by pi/2', () => {
    const d = derivativeModel(curve('sine', [2, 1.5, 0.3, -1]), MODELS, 'd1')
    expect(d!.spec.id).toBe('sine')
    expect(d!.params[0]).toBeCloseTo(3, 14)                       // a·b
    expect(d!.params[1]).toBeCloseTo(1.5, 14)
    expect(d!.params[2]).toBeCloseTo(0.3 + Math.PI / 2, 14)
    expect(d!.params[3]).toBeCloseTo(0, 14)
    // a·b·sin(bx + c + π/2) IS a·b·cos(bx + c)
    for (const x of [-3, -1, 0, 0.9, 2.2]) {
      expect(d!.spec.evalExplicit!(d!.params, x)).toBeCloseTo(
        2 * 1.5 * Math.cos(1.5 * x + 0.3), 12,
      )
    }
  })

  it('an exponential differentiates to an exponential', () => {
    const d = derivativeModel(curve('exp', [2, 3, 7]), MODELS, 'd1')
    expect(d!.spec.id).toBe('exp')
    expect(d!.params).toEqual([6, 3, 0])
    expect(d!.spec.evalExplicit!(d!.params, 0.4)).toBeCloseTo(6 * Math.exp(1.2), 10)
  })

  it('a logarithm differentiates to the reciprocal family', () => {
    // f = 2·ln(x − 1) + 3  ->  f' = 2/(x − 1)
    const d = derivativeModel(curve('log', [2, 1, 3]), MODELS, 'd1')
    expect(d!.spec.id).toBe('recip')
    expect(d!.params).toEqual([2, 1, 0])
    expect(d!.exact).toBe(true)
    expect(d!.spec.evalExplicit!(d!.params, 3)).toBeCloseTo(1, 14)
  })

  it('the latex names the derivative and prints the real coefficients', () => {
    const d = derivativeModel(curve('poly3', [0, -4, 0, 1]), MODELS, 'd1')
    expect(d!.latex).toBe("f'(x) = 3x^{2} - 4")
    expect(d!.latex.includes('y =')).toBe(false)
  })
})

describe('derivativeModel — closed form as a closure', () => {
  it('1/x differentiates to -1/x^2, with its own sliders', () => {
    const d = derivativeModel(curve('recip', [2, 1, 5]), MODELS, 'dR')
    expect(d).not.toBeNull()
    expect(d!.exact).toBe(true)
    expect(d!.spec.id).toBe('dR')
    expect(d!.spec.kind).toBe('explicit')
    expect(d!.params).toEqual([2, 1])
    for (const x of [-2, 0.5, 1.5, 4]) {
      expect(d!.spec.evalExplicit!(d!.params, x)).toBeCloseTo(-2 / ((x - 1) ** 2), 12)
    }
    expect(Number.isNaN(d!.spec.evalExplicit!(d!.params, 1))).toBe(true)  // the pole
    expect(d!.spec.paramMeta(d!.params).map(m => m.name)).toEqual(['a', 'b'])
    expect(d!.latex.startsWith("f'(x) = -\\frac{2}")).toBe(true)
  })

  it('sqrt, cbrt, abs, gauss, logistic and power all differentiate exactly', () => {
    const cases: Array<{
      id: string
      params: number[]
      at: number
      want: number
    }> = [
      // a·sqrt(x−b)+c -> a/(2 sqrt(x−b));  2/(2·2) = 0.5 at x = 4, b = 0
      { id: 'sqrt', params: [2, 0, 1], at: 4, want: 0.5 },
      // a·cbrt(x−b)+c -> a/(3 (x−b)^{2/3});  3/(3·4) = 0.25 at x = 8
      { id: 'cbrt', params: [3, 0, 0], at: 8, want: 0.25 },
      // a·|x−b|+c
      { id: 'abs', params: [-2, 1, 0], at: 4, want: -2 },
      // a·e^{−((x−b)/c)²}+d -> −2a(x−b)/c²·e^{…}; a=1,b=0,c=1,x=1: −2/e
      { id: 'gauss', params: [1, 0, 1, 0], at: 1, want: -2 / Math.E },
      // a/(1+e^{−b(x−c)})+d -> a·b/4 at the midpoint
      { id: 'logistic', params: [4, 1, 0, 0], at: 0, want: 1 },
      // a|x−b|^p + c -> a·p·|x−b|^{p−1}·sgn;  1·2·3 = 6 at x = 3
      { id: 'power', params: [1, 0, 0, 2], at: 3, want: 6 },
    ]
    for (const c of cases) {
      const d = derivativeModel(curve(c.id, c.params), MODELS, `d_${c.id}`)
      expect(d, c.id).not.toBeNull()
      expect(d!.exact, c.id).toBe(true)
      expect(d!.spec.evalExplicit!(d!.params, c.at), c.id).toBeCloseTo(c.want, 10)
      // the closure agrees with the tangent line at the same point
      const t = tangentAt(curve(c.id, c.params), MODELS, c.at)
      expect(t!.m, c.id).toBeCloseTo(c.want, 10)
      // the latex is a formula, not a promise of one
      expect(d!.latex.startsWith("f'(x) = "), c.id).toBe(true)
      expect(Number.isFinite(d!.spec.paramMeta(d!.params)[0].step), c.id).toBe(true)
    }
  })

  it("abs's derivative is a step that is undefined at the corner", () => {
    const d = derivativeModel(curve('abs', [1, 2, 0]), MODELS, 'dA')
    expect(d!.spec.evalExplicit!(d!.params, 3)).toBe(1)
    expect(d!.spec.evalExplicit!(d!.params, 1)).toBe(-1)
    expect(Number.isNaN(d!.spec.evalExplicit!(d!.params, 2))).toBe(true)
  })
})

describe('derivativeModel — the printed derivative', () => {
  const FAMILIES: Array<[string, number[]]> = [
    ['line', [-1, 3]], ['poly2', [5, -4, 3]], ['poly3', [0, -4, 0, 1]],
    ['poly4', [1, 2, 3, 4, 5]], ['sine', [2, 1.5, 0.3, -1]], ['exp', [2, 3, 7]],
    ['log', [2, 1, 3]], ['recip', [2, 1, 5]], ['recip', [-2, -1, 0]],
    ['gauss', [1, 0, 1, 0]], ['gauss', [-3, 2, 0.5, 1]],
    ['logistic', [4, 1, 0, 0]], ['logistic', [1, -2, 1, 0]],
    ['abs', [1, 2, 0]], ['abs', [-1, 0, 0]], ['sqrt', [2, 0, 1]],
    ['sqrt', [1, 3, 0]], ['cbrt', [3, -1, 0]], ['power', [1, 0, 0, 2]],
    ['power', [-2, 1, 0, 2 / 3]],
  ]

  it('renders as KaTeX for every family, and for typed expressions', async () => {
    const katex = (await import('katex')).default
    for (const [id, params] of FAMILIES) {
      const d = derivativeModel(curve(id, params), MODELS, 'dx')
      expect(d, id).not.toBeNull()
      expect(() => katex.renderToString(d!.latex, { throwOnError: true })).not.toThrow()
    }
    for (const src of ['y = x^2', 'y = sin(x)*e^(x/3)', 'y = a*x^2 + b']) {
      const { curve: c, models } = typed(src)
      const d = derivativeModel(c, models, 'dx')!
      expect(() => katex.renderToString(d.latex, { throwOnError: true })).not.toThrow()
    }
  })

  it('does not print arithmetic it could have done', () => {
    // 2/(2√x) is 1/√x, and (x − b)/1 is x − b
    expect(derivativeModel(curve('sqrt', [2, 0, 1]), MODELS, 'd')!.latex)
      .toBe("f'(x) = \\frac{1}{\\sqrt{x}}")
    expect(derivativeModel(curve('cbrt', [3, -1, 0]), MODELS, 'd')!.latex)
      .toBe("f'(x) = \\frac{1}{\\sqrt[3]{\\left(x + 1\\right)^{2}}}")
    expect(derivativeModel(curve('gauss', [1, 0, 1, 0]), MODELS, 'd')!.latex)
      .toBe("f'(x) = -2xe^{-x^{2}}")
    // …but 1/(2√x) keeps its 2 downstairs, the way it is written on the board
    expect(derivativeModel(curve('sqrt', [1, 0, 0]), MODELS, 'd')!.latex)
      .toBe("f'(x) = \\frac{1}{2\\sqrt{x}}")
  })
})

describe('derivativeModel — typed expressions (numeric)', () => {
  it('evaluates within 1e-8 of the analytic derivative at 20 points', () => {
    const { curve: c, models } = typed('y = x^3 - 2x')
    const d = derivativeModel(c, models, 'expr_d')
    expect(d).not.toBeNull()
    expect(d!.exact).toBe(false)
    expect(d!.kind).toBe('explicit')
    for (let i = 0; i < 20; i++) {
      const x = -2 + (4 * i) / 19
      const got = d!.spec.evalExplicit!(d!.params, x)
      const want = 3 * x * x - 2
      expect(Math.abs(got - want)).toBeLessThan(1e-8)
    }
  })

  it('carries the free constants through as its own sliders', () => {
    const { curve: c, models } = typed('y = a*x^2')
    const d = derivativeModel(c, models, 'expr_d')
    expect(d!.params).toEqual(c.params)                 // [1]
    expect(d!.spec.paramMeta(d!.params).map(m => m.name)).toEqual(['a'])
    // changing the slider changes the derivative: d/dx (3x²) = 6x
    expect(d!.spec.evalExplicit!([3], 2)).toBeCloseTo(12, 6)
  })

  it('says d/dx[...] rather than inventing a formula', () => {
    const { curve: c, models } = typed('y = sin(x)*e^(x/3)')
    const d = derivativeModel(c, models, 'expr_d')
    expect(d!.latex.startsWith('\\frac{d}{dx}\\left[')).toBe(true)
    expect(d!.latex.includes("f'(x) =")).toBe(false)
    expect(d!.latex.includes('y =')).toBe(false)
  })

  it('breaks where the expression does, instead of extrapolating', () => {
    const { curve: c, models } = typed('y = sqrt(x)')
    const d = derivativeModel(c, models, 'expr_d')
    expect(Number.isNaN(d!.spec.evalExplicit!(d!.params, -1))).toBe(true)
    expect(Number.isNaN(d!.spec.evalExplicit!(d!.params, 0))).toBe(true)
    expect(d!.spec.evalExplicit!(d!.params, 9)).toBeCloseTo(1 / 6, 8)
  })

  it('tells the caller in advance which families differentiate exactly', () => {
    for (const id of ['line', 'poly2', 'poly3', 'poly4', 'sine', 'gauss', 'exp',
      'log', 'sqrt', 'cbrt', 'power', 'abs', 'logistic', 'recip']) {
      expect(hasExactDerivative(id), id).toBe(true)
    }
    expect(hasExactDerivative('expr_1')).toBe(false)
    expect(hasExactDerivative('fourier')).toBe(false)
  })

  it('a library-family derivative comes back as that family, not a closure', () => {
    // the caller registers nothing when spec.id is already a library id
    const d = derivativeModel(curve('poly3', [1, 2, 3, 4]), MODELS, 'requested')
    expect(d!.spec.id).toBe('poly2')
    expect(MODELS[d!.spec.id]).toBe(d!.spec)
    // …and does register when the derivative needed its own closure
    const e = derivativeModel(curve('recip', [1, 0, 0]), MODELS, 'requested')
    expect(e!.spec.id).toBe('requested')
    expect(MODELS['requested']).toBeUndefined()
  })

  it('refuses curves with no f(x) at all', () => {
    expect(derivativeModel(curve('circle', [0, 0, 1]), MODELS, 'd')).toBeNull()
    expect(derivativeModel(curve('spiral', [1, 0.2]), MODELS, 'd')).toBeNull()
    expect(derivativeModel(curve('poly2', [0, Number.NaN, 1]), MODELS, 'd')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 3. Definite integrals
// ---------------------------------------------------------------------------

describe('areaUnder — closed form', () => {
  it('x^2 on [0, 3] is 9', () => {
    const r = areaUnder(curve('poly2', [0, 0, 1]), MODELS, 0, 3)
    expect(r).not.toBeNull()
    expect(r!.exact).toBe(true)
    expect(r!.value).toBeCloseTo(9, 12)
  })

  it('sin on [0, pi] is 2', () => {
    const r = areaUnder(curve('sine', [1, 1, 0, 0]), MODELS, 0, Math.PI)
    expect(r!.exact).toBe(true)
    expect(r!.value).toBeCloseTo(2, 12)
  })

  it('e^x on [0, 1] is e - 1', () => {
    const r = areaUnder(curve('exp', [1, 1, 0]), MODELS, 0, 1)
    expect(r!.exact).toBe(true)
    expect(r!.value).toBeCloseTo(Math.E - 1, 12)
  })

  it('1/x on [1, e] is 1', () => {
    const r = areaUnder(curve('recip', [1, 0, 0]), MODELS, 1, Math.E)
    expect(r!.exact).toBe(true)
    expect(r!.value).toBeCloseTo(1, 12)
  })

  it('ln(x) on [1, e] is 1', () => {
    // ∫ ln x = x ln x − x; (e − e) − (0 − 1) = 1
    const r = areaUnder(curve('log', [1, 0, 0]), MODELS, 1, Math.E)
    expect(r!.exact).toBe(true)
    expect(r!.value).toBeCloseTo(1, 12)
  })

  it('x^3 on [-2, 2] is 0 — the area is SIGNED', () => {
    const r = areaUnder(curve('poly3', [0, 0, 0, 1]), MODELS, -2, 2)
    expect(r!.exact).toBe(true)
    expect(r!.value).toBeCloseTo(0, 12)
    // and each half is the negative of the other
    const left = areaUnder(curve('poly3', [0, 0, 0, 1]), MODELS, -2, 0)!
    const right = areaUnder(curve('poly3', [0, 0, 0, 1]), MODELS, 0, 2)!
    expect(left.value).toBeCloseTo(-4, 12)
    expect(right.value).toBeCloseTo(4, 12)
  })

  it('reversing the limits flips the sign', () => {
    const fwd = areaUnder(curve('poly2', [0, 0, 1]), MODELS, 0, 3)!
    const back = areaUnder(curve('poly2', [0, 0, 1]), MODELS, 3, 0)!
    expect(back.value).toBeCloseTo(-fwd.value, 12)
    expect(areaUnder(curve('poly2', [0, 0, 1]), MODELS, 2, 2)!.value).toBe(0)
  })

  it('a sinusoid with an offset: ∫ 2sin(3x) + 1 over [0, pi/3]', () => {
    // −(2/3)[cos π − cos 0] + π/3 = 4/3 + π/3
    const r = areaUnder(curve('sine', [2, 3, 0, 1]), MODELS, 0, Math.PI / 3)
    expect(r!.value).toBeCloseTo(4 / 3 + Math.PI / 3, 12)
  })
})

describe('areaUnder — where the integral does not exist', () => {
  it('refuses 1/x across the pole', () => {
    expect(areaUnder(curve('recip', [1, 0, 0]), MODELS, -1, 1)).toBeNull()
    expect(areaUnder(curve('recip', [1, 0, 0]), MODELS, 1, -1)).toBeNull()
    // and at an endpoint, where the integral diverges just as hard
    expect(areaUnder(curve('recip', [1, 0, 0]), MODELS, 0, 1)).toBeNull()
    // shifted pole, inside
    expect(areaUnder(curve('recip', [1, 2, 0]), MODELS, 1, 3)).toBeNull()
    // …but one branch on its own is fine
    expect(areaUnder(curve('recip', [1, 2, 0]), MODELS, 3, 4)!.value)
      .toBeCloseTo(Math.log(2), 12)
  })

  it('refuses a typed 1/x across the origin rather than cancelling it to 0', () => {
    const { curve: c, models } = typed('y = 1/x')
    expect(areaUnder(c, models, -1, 1)).toBeNull()
  })

  it('refuses ln(x) reaching left of its asymptote', () => {
    expect(areaUnder(curve('log', [1, 0, 0]), MODELS, -1, 2)).toBeNull()
    // from the asymptote itself the integral converges and is allowed
    expect(areaUnder(curve('log', [1, 0, 0]), MODELS, 0, 1)!.value).toBeCloseTo(-1, 12)
  })

  it('refuses outside the curve domain, and non-functions of x', () => {
    expect(areaUnder(curve('poly2', [0, 0, 1], [0, 2]), MODELS, 0, 5)).toBeNull()
    expect(areaUnder(curve('circle', [0, 0, 1]), MODELS, -1, 1)).toBeNull()
    expect(areaUnder(curve('poly2', [0, 0, 1]), MODELS, 0, Number.NaN)).toBeNull()
  })
})

describe('areaUnder — numeric', () => {
  it('integrates the finite run when part of the interval is undefined', () => {
    // y = sqrt(x) on [−1, 4]: nothing left of 0, then ∫₀⁴ √x = 16/3
    const { curve: c, models } = typed('y = sqrt(x)')
    const r = areaUnder(c, models, -1, 4)
    expect(r).not.toBeNull()
    expect(r!.exact).toBe(false)
    expect(r!.value).toBeCloseTo(16 / 3, 6)
    expect(r!.samples).toBeGreaterThan(0)
  })

  it('the sqrt FAMILY takes the same numeric path to the same answer', () => {
    const r = areaUnder(curve('sqrt', [1, 0, 0]), MODELS, -1, 4)
    expect(r!.exact).toBe(false)
    expect(r!.value).toBeCloseTo(16 / 3, 6)
  })

  it('matches closed-form answers it does not know', () => {
    // ∫₀² |x − 1| dx = 1
    expect(areaUnder(curve('abs', [1, 1, 0]), MODELS, 0, 2)!.value).toBeCloseTo(1, 8)
    // ∫₋₁¹ e^{−x²} dx = √π·erf(1) = 1.4936482656248538…
    expect(areaUnder(curve('gauss', [1, 0, 1, 0]), MODELS, -1, 1)!.value)
      .toBeCloseTo(1.4936482656248540, 8)
    // ∫₀¹ x^{3/2} dx = 2/5
    expect(areaUnder(curve('power', [1, 0, 0, 1.5]), MODELS, 0, 1)!.value)
      .toBeCloseTo(0.4, 8)
  })

  it('integrates typed expressions', () => {
    const t1 = typed('y = x^2')
    expect(areaUnder(t1.curve, t1.models, 0, 3)!.value).toBeCloseTo(9, 8)
    expect(areaUnder(t1.curve, t1.models, 0, 3)!.exact).toBe(false)

    const t2 = typed('y = sin(x)')
    expect(areaUnder(t2.curve, t2.models, 0, Math.PI)!.value).toBeCloseTo(2, 9)

    const t3 = typed('y = 1/(1 + x^2)')          // arctan: π/2 over [−1, 1]
    expect(areaUnder(t3.curve, t3.models, -1, 1)!.value).toBeCloseTo(Math.PI / 2, 9)
  })

  it('reports signed area for a typed expression too', () => {
    const { curve: c, models } = typed('y = x^3')
    expect(areaUnder(c, models, -2, 2)!.value).toBeCloseTo(0, 8)
  })
})

// ---------------------------------------------------------------------------
// 4. Riemann sums
// ---------------------------------------------------------------------------

describe('riemann', () => {
  const sq = () => curve('poly2', [0, 0, 1])   // y = x²

  it('x^2 on [0, 2] with n = 4: the four classic sums', () => {
    const want: Record<RiemannMethod, number> = {
      left: 1.75,
      right: 3.75,
      midpoint: 2.625,
      trapezoid: 2.75,
    }
    for (const method of Object.keys(want) as RiemannMethod[]) {
      const r = riemann(sq(), MODELS, 0, 2, 4, method)
      expect(r, method).not.toBeNull()
      expect(r!.value, method).toBeCloseTo(want[method], 12)
      expect(r!.rects.length, method).toBe(4)
      expect(r!.skipped, method).toBe(0)
    }
  })

  it('the rectangles tile the interval and carry the sampled height', () => {
    const r = riemann(sq(), MODELS, 0, 2, 4, 'left')!
    expect(r.rects[0]).toEqual({ x0: 0, x1: 0.5, height: 0 })
    expect(r.rects[3].x1).toBe(2)                       // the last edge is exactly b
    for (let i = 0; i + 1 < r.rects.length; i++) {
      expect(r.rects[i].x1).toBeCloseTo(r.rects[i + 1].x0, 14)
    }
    // Σ height·width IS the reported value
    const sum = r.rects.reduce((s, q) => s + q.height * (q.x1 - q.x0), 0)
    expect(sum).toBeCloseTo(r.value, 12)

    const mid = riemann(sq(), MODELS, 0, 2, 4, 'midpoint')!
    expect(mid.rects[0].height).toBeCloseTo(0.0625, 14)  // f(0.25)
    const trap = riemann(sq(), MODELS, 0, 2, 4, 'trapezoid')!
    expect(trap.rects[0].height).toBeCloseTo((0 + 0.25) / 2, 14)
  })

  it('converges to 8/3 as n grows, from below on the left and above on the right', () => {
    const exact = 8 / 3
    let prevErr = Infinity
    for (const n of [10, 100, 1000, 10000]) {
      const left = riemann(sq(), MODELS, 0, 2, n, 'left')!
      const right = riemann(sq(), MODELS, 0, 2, n, 'right')!
      const mid = riemann(sq(), MODELS, 0, 2, n, 'midpoint')!
      expect(left.rects.length).toBe(n)
      expect(left.value).toBeLessThan(exact)
      expect(right.value).toBeGreaterThan(exact)
      const err = Math.abs(mid.value - exact)
      expect(err).toBeLessThan(prevErr)
      prevErr = err
    }
    expect(riemann(sq(), MODELS, 0, 2, 20000, 'midpoint')!.value).toBeCloseTo(exact, 7)
    expect(riemann(sq(), MODELS, 0, 2, 20000, 'trapezoid')!.value).toBeCloseTo(exact, 7)
  })

  it('agrees with the exact integral it is approximating', () => {
    const area = areaUnder(sq(), MODELS, 0, 2)!.value
    expect(riemann(sq(), MODELS, 0, 2, 5000, 'midpoint')!.value).toBeCloseTo(area, 6)
  })

  it('is signed, and reversible', () => {
    const c = curve('poly3', [0, 0, 0, 1])              // y = x³
    expect(riemann(c, MODELS, -2, 0, 1000, 'midpoint')!.value).toBeLessThan(0)
    const fwd = riemann(sq(), MODELS, 0, 2, 100, 'midpoint')!
    const back = riemann(sq(), MODELS, 2, 0, 100, 'midpoint')!
    expect(back.value).toBeCloseTo(-fwd.value, 10)
  })

  it('skips undefined samples instead of poisoning the sum', () => {
    // y = sqrt(x) on [−1, 4] with n = 5: the first rectangle starts left of 0
    const r = riemann(curve('sqrt', [1, 0, 0]), MODELS, -1, 4, 5, 'midpoint')!
    expect(r.skipped).toBe(1)
    expect(r.rects.length).toBe(4)
    expect(Number.isFinite(r.value)).toBe(true)
    for (const q of r.rects) expect(Number.isFinite(q.height)).toBe(true)
  })

  it('works on typed expressions', () => {
    const { curve: c, models } = typed('y = x^2')
    const r = riemann(c, models, 0, 2, 4, 'left')!
    expect(r.value).toBeCloseTo(1.75, 12)
  })

  it('refuses nonsense rather than returning a shape full of NaN', () => {
    expect(riemann(sq(), MODELS, 0, 2, 0, 'left')).toBeNull()
    expect(riemann(sq(), MODELS, 0, 2, -4, 'left')).toBeNull()
    expect(riemann(sq(), MODELS, 0, 2, 3.5, 'left')).toBeNull()
    expect(riemann(sq(), MODELS, 0, Number.NaN, 4, 'left')).toBeNull()
    expect(riemann(curve('circle', [0, 0, 1]), MODELS, 0, 1, 4, 'left')).toBeNull()
    expect(riemann(curve('poly2', [0, 0, 1], [0, 1]), MODELS, 0, 5, 4, 'left')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Cross-checks — every hand-differentiated formula against a stencil, every
// closed-form integral against a fine midpoint sum. A sign slip in any one of
// the twelve families dies here.
// ---------------------------------------------------------------------------

describe('closed form vs. brute force', () => {
  /** 5-point stencil, independent of anything in src/core/calculus.ts. */
  function stencil(f: (x: number) => number, x: number, h: number): number {
    return (f(x - 2 * h) - 8 * f(x - h) + 8 * f(x + h) - f(x + 2 * h)) / (12 * h)
  }

  const CASES: Array<{ id: string; params: number[]; xs: number[] }> = [
    { id: 'line', params: [-1, 3], xs: [-2, 0.3, 4] },
    { id: 'poly2', params: [1, -2, 0.5], xs: [-3, -0.4, 2.7] },
    { id: 'poly3', params: [2.1, -1.75, -0.7, 0.35], xs: [-2, 0.5, 3] },
    { id: 'poly4', params: [1, 2, 3, 4, 5], xs: [-1.3, 0.2, 1.1] },
    { id: 'sine', params: [2, 1.5, 0.3, -1], xs: [-2, 0, 1.4, 3.3] },
    { id: 'gauss', params: [-3, 2, 0.7, 1], xs: [0.5, 2, 3.4] },
    { id: 'exp', params: [1.5, -0.8, 2], xs: [-1, 0, 2] },
    { id: 'log', params: [2, -1, 0.5], xs: [0.2, 1, 4] },
    { id: 'sqrt', params: [1.4, -2, 1], xs: [0.5, 3, 7] },
    { id: 'cbrt', params: [2, 1, -1], xs: [-3, 0.4, 5] },
    { id: 'power', params: [0.8, 0.5, 1, 2.5], xs: [-2, 1.6, 3] },
    { id: 'abs', params: [-1.2, 0.5, 2], xs: [-2, 1.5] },
    { id: 'logistic', params: [3, 1.4, -0.5, 1], xs: [-2, -0.5, 0.8, 2] },
    { id: 'recip', params: [2, 1, -1], xs: [-1, 0.3, 2.5, 6] },
  ]

  it('every symbolic slope matches a 5-point stencil', () => {
    for (const c of CASES) {
      const spec = MODELS[c.id]
      const f = (x: number) => spec.evalExplicit!(c.params, x)
      for (const x of c.xs) {
        const t = tangentAt(curve(c.id, c.params), MODELS, x)
        expect(t, `${c.id} @ ${x}`).not.toBeNull()
        expect(t!.exact, c.id).toBe(true)
        const want = stencil(f, x, 1e-4)
        expect(Math.abs(t!.m - want), `${c.id} @ ${x}`).toBeLessThan(
          1e-5 * (1 + Math.abs(want)),
        )
        // the tangent touches the curve
        expect(t!.m * x + t!.b).toBeCloseTo(f(x), 9)
      }
    }
  })

  it("every derivative curve's height IS the tangent's slope", () => {
    for (const c of CASES) {
      const d = derivativeModel(curve(c.id, c.params), MODELS, 'd')
      expect(d, c.id).not.toBeNull()
      for (const x of c.xs) {
        const t = tangentAt(curve(c.id, c.params), MODELS, x)!
        expect(d!.spec.evalExplicit!(d!.params, x), `${c.id} @ ${x}`)
          .toBeCloseTo(t.m, 9)
      }
    }
  })

  it('every closed-form integral matches a 20000-rectangle midpoint sum', () => {
    const windows: Record<string, [number, number]> = {
      line: [-2, 3], poly2: [-1, 2], poly3: [-2, 1.5], poly4: [-1, 1],
      sine: [-1, 2.5], exp: [-1, 2], log: [0.3, 4], recip: [1.2, 5],
    }
    for (const c of CASES) {
      const w = windows[c.id]
      if (!w) continue
      const exact = areaUnder(curve(c.id, c.params), MODELS, w[0], w[1])
      expect(exact, c.id).not.toBeNull()
      expect(exact!.exact, c.id).toBe(true)
      const brute = riemann(curve(c.id, c.params), MODELS, w[0], w[1], 20000, 'midpoint')!
      expect(Math.abs(exact!.value - brute.value), c.id).toBeLessThan(
        1e-5 * (1 + Math.abs(exact!.value)),
      )
    }
  })

  it('the numeric path agrees with the closed form where both exist', () => {
    // same function, once as a family and once as text: the two answers must
    // agree to far more digits than anyone reads off a screen
    const pairs: Array<[FittedCurve, Record<string, ModelSpec>, [number, number]]> = []
    const t1 = typed('y = x^3 - 2x')
    pairs.push([t1.curve, t1.models, [-1.5, 2.2]])
    const t2 = typed('y = 2sin(1.5x + 0.3) - 1')
    pairs.push([t2.curve, t2.models, [-2, 3]])
    const famA = areaUnder(curve('poly3', [0, -2, 0, 1]), MODELS, -1.5, 2.2)!
    const famB = areaUnder(curve('sine', [2, 1.5, 0.3, -1]), MODELS, -2, 3)!
    const want = [famA.value, famB.value]
    pairs.forEach(([c, m, w], i) => {
      const got = areaUnder(c, m, w[0], w[1])!
      expect(got.exact).toBe(false)
      expect(Math.abs(got.value - want[i])).toBeLessThan(1e-8)
    })
  })
})

// ---------------------------------------------------------------------------
// Performance — this runs while a slider is being dragged
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Area between two curves
//
// Every number here is an AP exercise done by hand. ∫₀¹ (x − x²) = 1/2 − 1/3
// = 1/6. ∫₀^π (sin − cos) = [−cos − sin]₀^π = (1 − 0) − (−1 − 0) = 2, while
// ∫₀^π |sin − cos| splits at π/4, where the two cross, into (√2 − 1) + (√2 + 1)
// = 2√2 — which is exactly the difference the split makes, since the signed
// integral is 2 and the unsigned one is 2.83.
// ---------------------------------------------------------------------------

describe('areaBetween', () => {
  /** y = x², y = x, y = 2 − x², y = sin x, y = cos x, y = 1/x. */
  const sq = curve('poly2', [0, 0, 1])
  const lin = curve('line', [0, 1])
  const capped = curve('poly2', [2, 0, -1])
  const sin = curve('sine', [1, 1, 0, 0])
  const cos = curve('sine', [1, 1, Math.PI / 2, 0])
  const recip = curve('recip', [1, 0, 0])

  it('x and x² on [0, 1] is 1/6, in closed form', () => {
    const r = areaBetween(lin, sq, MODELS, 0, 1, false)!
    expect(r).not.toBeNull()
    expect(r.value).toBeCloseTo(1 / 6, 14)
    expect(r.exact).toBe(true)
    expect(r.samples).toBeUndefined()
  })

  it('names the parent as f: x² minus x is the same area, negative', () => {
    const r = areaBetween(sq, lin, MODELS, 0, 1, false)!
    expect(r.value).toBeCloseTo(-1 / 6, 14)
    expect(r.exact).toBe(true)
    // |f − g| does not care which curve was asked first.
    expect(areaBetween(sq, lin, MODELS, 0, 1, true)!.value).toBeCloseTo(1 / 6, 14)
    expect(areaBetween(lin, sq, MODELS, 0, 1, true)!.value).toBeCloseTo(1 / 6, 14)
  })

  it('b < a flips the sign, with and without |·|', () => {
    expect(areaBetween(lin, sq, MODELS, 1, 0, false)!.value).toBeCloseTo(-1 / 6, 14)
    expect(areaBetween(lin, sq, MODELS, 1, 0, true)!.value).toBeCloseTo(-1 / 6, 14)
  })

  it('a = b is zero area, not a refusal', () => {
    const r = areaBetween(lin, sq, MODELS, 2, 2, true)!
    expect(r.value).toBe(0)
    expect(r.exact).toBe(true)
  })

  it('∫(sin − cos) on [0, π] is 2, numerically', () => {
    const r = areaBetween(sin, cos, MODELS, 0, Math.PI, false)!
    expect(r).not.toBeNull()
    expect(r.value).toBeCloseTo(2, 9)
    expect(r.exact).toBe(false)
    expect(r.samples).toBeGreaterThan(0)
  })

  it('∫|sin − cos| on [0, π] is 2√2 — the split at π/4 is what makes it so', () => {
    const r = areaBetween(sin, cos, MODELS, 0, Math.PI, true)!
    expect(r.value).toBeCloseTo(2 * Math.SQRT2, 9)
    expect(r.exact).toBe(false)
    // Not the same number as the signed integral, and not |signed| either:
    // the cancellation either side of π/4 is exactly what |·| undoes.
    expect(Math.abs(r.value - 2)).toBeGreaterThan(0.8)
  })

  it('x² and 2 − x² enclose 8/3 between their crossings', () => {
    expect(areaBetween(sq, capped, MODELS, -1, 1, true)!.value).toBeCloseTo(8 / 3, 13)
    // x² is the LOWER curve there, so f − g is negative all the way across.
    expect(areaBetween(sq, capped, MODELS, -1, 1, false)!.value).toBeCloseTo(-8 / 3, 13)
    expect(areaBetween(capped, sq, MODELS, -1, 1, false)!.value).toBeCloseTo(8 / 3, 13)
  })

  it('refuses across a pole of EITHER curve', () => {
    // 1/x blows up at 0; y = x is perfectly well behaved, and does not make
    // the integral exist.
    expect(areaBetween(recip, lin, MODELS, -1, 2, false)).toBeNull()
    expect(areaBetween(recip, lin, MODELS, -1, 2, true)).toBeNull()
    expect(areaBetween(lin, recip, MODELS, -1, 2, false)).toBeNull()
    // Clear of the pole it is an ordinary integral again.
    expect(areaBetween(recip, lin, MODELS, 1, 2, false)).not.toBeNull()
  })

  it('refuses outside either curve’s own domain', () => {
    const half = curve('line', [0, 1], [0, 3])
    expect(areaBetween(sq, half, MODELS, -1, 2, false)).toBeNull()
    expect(areaBetween(half, sq, MODELS, -1, 2, false)).toBeNull()
    expect(areaBetween(half, sq, MODELS, 0, 3, false)).not.toBeNull()
  })

  it('refuses a curve that is not a function of x', () => {
    const circle = curve('circle', [0, 0, 2])
    expect(areaBetween(sq, circle, MODELS, 0, 1, false)).toBeNull()
    expect(areaBetween(circle, sq, MODELS, 0, 1, false)).toBeNull()
  })

  it('works against a typed expression, numerically', () => {
    const { curve: c, models } = typed('y = sin(x)')
    const zero = curve('line', [0, 0])
    const r = areaBetween(c, zero, { ...models }, 0, Math.PI, false)!
    expect(r.value).toBeCloseTo(2, 8)
    expect(r.exact).toBe(false)
    expect(allFinite(r as unknown as Record<string, unknown>)).toBe(true)
  })

  it('agrees with areaUnder when the other curve is the x-axis', () => {
    const axis = curve('line', [0, 0])
    const cubic = curve('poly3', [0, -4, 0, 1])
    for (const [a, b] of [[0, 2], [-2, 2], [1, 3]] as Array<[number, number]>) {
      expect(areaBetween(cubic, axis, MODELS, a, b, false)!.value).toBeCloseTo(
        areaUnder(cubic, MODELS, a, b)!.value,
        12,
      )
    }
  })
})

describe('curveIntersections', () => {
  const sq = curve('poly2', [0, 0, 1])
  const lin = curve('line', [0, 1])
  const capped = curve('poly2', [2, 0, -1])
  const sin = curve('sine', [1, 1, 0, 0])
  const cos = curve('sine', [1, 1, Math.PI / 2, 0])
  const recip = curve('recip', [1, 0, 0])

  it('finds both crossings of x² and 2 − x², sorted', () => {
    const xs = curveIntersections(sq, capped, MODELS, [-4, 4])
    expect(xs).toHaveLength(2)
    expect(xs[0]).toBeCloseTo(-1, 12)
    expect(xs[1]).toBeCloseTo(1, 12)
  })

  it('finds sin = cos at π/4 on [0, π]', () => {
    const xs = curveIntersections(sin, cos, MODELS, [0, Math.PI])
    expect(xs).toHaveLength(1)
    expect(xs[0]).toBeCloseTo(Math.PI / 4, 9)
  })

  it('counts a tangency once', () => {
    // x² and 2x − 1 touch at x = 1 without crossing: (x − 1)².
    const tangentLine = curve('line', [-1, 2])
    const xs = curveIntersections(sq, tangentLine, MODELS, [-4, 4])
    expect(xs).toHaveLength(1)
    expect(xs[0]).toBeCloseTo(1, 9)
  })

  it('reports no crossing where there is none', () => {
    expect(curveIntersections(sq, curve('line', [-3, 0]), MODELS, [-4, 4])).toEqual([])
    // Two identical curves cross everywhere, which is not a list of points.
    expect(curveIntersections(sq, curve('poly2', [0, 0, 1]), MODELS, [-4, 4])).toEqual([])
  })

  it('never reports the pole as a crossing', () => {
    // 1/x = x at ±1. At x = 0 the difference changes sign through infinity,
    // which is the sign change a naive scan would call a root.
    const xs = curveIntersections(recip, lin, MODELS, [-3, 3])
    expect(xs.some((x) => Math.abs(x) < 0.5)).toBe(false)
    expect(xs.map((x) => Math.round(x * 1e6) / 1e6)).toEqual([-1, 1])
  })

  it('clips to both domains', () => {
    const right = curve('line', [0, 1], [0.5, 4])
    // x and x² meet at 0 and 1; only 1 is on the restricted line.
    const xs = curveIntersections(sq, right, MODELS, [-4, 4])
    expect(xs).toHaveLength(1)
    expect(xs[0]).toBeCloseTo(1, 12)
  })

  it('is empty for a curve that is not a function of x', () => {
    expect(curveIntersections(sq, curve('circle', [0, 0, 2]), MODELS, [-4, 4])).toEqual([])
  })
})

describe('performance', () => {
  // Best of five: the budget is about the code, not about what else the test
  // runner is doing on the machine at that instant — a single timing under a
  // parallel full-suite run flaked 1 in 5 while passing alone every time.
  const bestOf = (run: () => void, times = 5): number => {
    let best = Infinity
    for (let k = 0; k < times; k++) {
      const t0 = performance.now()
      run()
      best = Math.min(best, performance.now() - t0)
    }
    return best
  }

  it("a typed expression's derivative closure is built and sampled fast", () => {
    const { curve: c, models } = typed('y = sin(x)*e^(x/3) + x^2')
    // warm the JIT
    for (let i = 0; i < 3; i++) derivativeModel(c, models, 'd')
    const ms = bestOf(() => {
      const d = derivativeModel(c, models, 'd')!
      for (let i = 0; i < 100; i++) d.spec.evalExplicit!(d.params, -5 + i * 0.1)
    })
    expect(ms).toBeLessThan(2)
  })

  it('areaUnder on a typed expression is under 2ms', () => {
    const { curve: c, models } = typed('y = sin(x)*e^(x/3) + x^2')
    for (let i = 0; i < 3; i++) areaUnder(c, models, -3, 3)
    expect(areaUnder(c, models, -3, 3)).not.toBeNull()
    const ms = bestOf(() => areaUnder(c, models, -3, 3))
    expect(ms).toBeLessThan(2)
  })

  it('a closed-form area is essentially free', () => {
    const ms = bestOf(() => {
      for (let i = 0; i < 100; i++) areaUnder(curve('poly3', [1, 2, 3, 4]), MODELS, -2, 2)
    })
    expect(ms).toBeLessThan(2)
  })

  it('areaBetween on a typed expression and a curve is under 2ms', () => {
    const { curve: f, models } = typed('y = sin(x)*e^(x/3) + x^2')
    const g = curve('sine', [2, 1.3, 0.4, 1])
    for (let i = 0; i < 3; i++) areaBetween(f, g, models, -3, 3, false)
    expect(areaBetween(f, g, models, -3, 3, false)).not.toBeNull()
    const ms = bestOf(() => areaBetween(f, g, models, -3, 3, false))
    expect(ms).toBeLessThan(2)
  })

  it('the |f − g| path, split at every crossing, is under 2ms', () => {
    const { curve: f, models } = typed('y = sin(x)*e^(x/3) + x^2')
    const g = curve('sine', [2, 1.3, 0.4, 1])
    for (let i = 0; i < 3; i++) areaBetween(f, g, models, -3, 3, true)
    const r = areaBetween(f, g, models, -3, 3, true)!
    expect(r).not.toBeNull()
    // The split really happened: |f − g| is strictly more than |∫(f − g)|
    // when the curves cross, and these two cross three times on [-3, 3].
    expect(curveIntersections(f, g, models, [-3, 3]).length).toBeGreaterThan(1)
    expect(r.value).toBeGreaterThan(
      Math.abs(areaBetween(f, g, models, -3, 3, false)!.value),
    )
    const ms = bestOf(() => areaBetween(f, g, models, -3, 3, true))
    expect(ms).toBeLessThan(2)
  })

  it('1000 tangent lines on a library family stay under 2ms', () => {
    const c = curve('poly3', [0, -3, 0, 1])
    const ms = bestOf(() => {
      for (let i = 0; i < 1000; i++) tangentAt(c, MODELS, -5 + i * 0.01)
    })
    expect(ms).toBeLessThan(2)
  })
})

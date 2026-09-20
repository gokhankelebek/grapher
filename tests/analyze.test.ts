// ============================================================================
// tests/analyze.test.ts — curve analysis (src/core/analyze.ts).
//
// Every assertion here is against a CLOSED-FORM answer worked out by hand, not
// against whatever the implementation happens to produce. A teacher is going to
// read these numbers off the screen in front of a class.
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { FittedCurve, ModelSpec, SpecialPoint, SpecialPointKind } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { analyzeCurve } from '../src/core/analyze'
import { centerFormToConic, conicToCenterForm } from '../src/core/fit/optimize'
import { parseExpression } from '../src/core/parse'

function curve(
  modelId: string,
  params: number[],
  domain: [number, number] | null,
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
    error: 0.02,
  }
}

const of = (pts: SpecialPoint[], kind: SpecialPointKind) => pts.filter(p => p.kind === kind)
const xsOf = (pts: SpecialPoint[], kind: SpecialPointKind) =>
  of(pts, kind).map(p => p.pos.x).sort((a, b) => a - b)

/** A typed-expression style model built from a bare JS function. */
function fnModel(id: string, f: (x: number) => number): ModelSpec {
  return {
    id,
    kind: 'explicit',
    name: id,
    evalExplicit: (_p, x) => f(x),
    latex: () => `y = ${id}`,
    paramMeta: () => [],
  }
}

// ---------------------------------------------------------------------------
// Polynomials — the bread and butter of an AP Calculus lesson
// ---------------------------------------------------------------------------

describe('analyzeCurve — cubic', () => {
  // (x + 2)(x - 1)(x - 3) = x^3 - 2x^2 - 5x + 6, params ascending
  const CUBIC = [6, -5, -2, 1]
  const c = curve('poly3', CUBIC, [-4, 5])
  const pts = analyzeCurve(c, MODELS)

  it('finds the three roots at exactly -2, 1 and 3', () => {
    const zeros = xsOf(pts, 'zero')
    expect(zeros).toHaveLength(3)
    expect(zeros[0]).toBeCloseTo(-2, 8)
    expect(zeros[1]).toBeCloseTo(1, 8)
    expect(zeros[2]).toBeCloseTo(3, 8)
  })

  it('extrema match the quadratic-formula roots of f’ = 3x^2 - 4x - 5', () => {
    // x = (4 +/- sqrt(76)) / 6
    const s = Math.sqrt(76)
    const xMax = (4 - s) / 6
    const xMin = (4 + s) / 6
    const maxima = of(pts, 'maximum')
    const minima = of(pts, 'minimum')
    expect(maxima).toHaveLength(1)
    expect(minima).toHaveLength(1)
    expect(maxima[0].pos.x).toBeCloseTo(xMax, 10)
    expect(minima[0].pos.x).toBeCloseTo(xMin, 10)
    // and f'' decides which is which: f'' = 6x - 4
    expect(6 * maxima[0].pos.x - 4).toBeLessThan(0)
    expect(6 * minima[0].pos.x - 4).toBeGreaterThan(0)
    // the y values are the real function values
    const f = (x: number) => ((x - 2) * x - 5) * x + 6
    expect(maxima[0].pos.y).toBeCloseTo(f(xMax), 8)
    expect(minima[0].pos.y).toBeCloseTo(f(xMin), 8)
  })

  it('the inflection is at exactly -b/(3a) and is closed form', () => {
    const infl = of(pts, 'inflection')
    expect(infl).toHaveLength(1)
    expect(infl[0].pos.x).toBeCloseTo(2 / 3, 12) // -(-2)/(3*1)
    expect(infl[0].exact).toBe(true)
  })

  it('a cubic is point-symmetric: the inflection is the MIDPOINT of its extrema', () => {
    const infl = of(pts, 'inflection')[0]
    const maxX = of(pts, 'maximum')[0].pos.x
    const minX = of(pts, 'minimum')[0].pos.x
    expect((maxX + minX) / 2).toBeCloseTo(infl.pos.x, 10)
  })

  it('reports the y-intercept at f(0) = 6', () => {
    const yi = of(pts, 'y-intercept')
    expect(yi).toHaveLength(1)
    expect(yi[0].pos.x).toBe(0)
    expect(yi[0].pos.y).toBeCloseTo(6, 12)
  })

  it('returns points ordered left to right', () => {
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].pos.x).toBeGreaterThanOrEqual(pts[i - 1].pos.x)
    }
  })
})

describe('analyzeCurve — parabola', () => {
  it('a parabola’s vertex and roots are exact, and it has NO inflection', () => {
    // 2x^2 - 4x - 6 = 2(x-3)(x+1): roots -1 and 3, vertex at x = 1, y = -8
    const pts = analyzeCurve(curve('poly2', [-6, -4, 2], [-5, 6]), MODELS)
    const zeros = xsOf(pts, 'zero')
    expect(zeros).toHaveLength(2)
    expect(zeros[0]).toBeCloseTo(-1, 12)
    expect(zeros[1]).toBeCloseTo(3, 12)
    const minima = of(pts, 'minimum')
    expect(minima).toHaveLength(1)
    expect(minima[0].pos.x).toBeCloseTo(1, 12)
    expect(minima[0].pos.y).toBeCloseTo(-8, 12)
    expect(minima[0].exact).toBe(true)
    expect(of(pts, 'inflection')).toHaveLength(0)
    expect(of(pts, 'maximum')).toHaveLength(0)
  })

  it('a downward parabola reports a maximum, not a minimum', () => {
    // -(x^2) + 4 -> max at (0, 4), roots at -2 and 2
    const pts = analyzeCurve(curve('poly2', [4, 0, -1], [-5, 5]), MODELS)
    expect(of(pts, 'maximum')).toHaveLength(1)
    expect(of(pts, 'minimum')).toHaveLength(0)
    expect(of(pts, 'maximum')[0].pos.y).toBeCloseTo(4, 12)
    expect(xsOf(pts, 'zero')).toEqual([expect.closeTo(-2, 12), expect.closeTo(2, 12)])
  })
})

describe('analyzeCurve — quartic (numeric extrema and inflections)', () => {
  // x^4 - 4x^2 = x^2(x^2 - 4). f' = 4x(x^2 - 2), f'' = 12x^2 - 8
  const pts = analyzeCurve(curve('poly4', [0, 0, -4, 0, 1], [-3, 3]), MODELS)

  it('finds both minima and the central maximum', () => {
    const minima = xsOf(pts, 'minimum')
    expect(minima).toHaveLength(2)
    expect(minima[0]).toBeCloseTo(-Math.SQRT2, 6)
    expect(minima[1]).toBeCloseTo(Math.SQRT2, 6)
    const maxima = of(pts, 'maximum')
    expect(maxima).toHaveLength(1)
    expect(maxima[0].pos.x).toBeCloseTo(0, 5)
    for (const m of of(pts, 'minimum')) expect(m.pos.y).toBeCloseTo(-4, 6)
  })

  it('locates both inflections at +/- sqrt(2/3)', () => {
    const infl = xsOf(pts, 'inflection')
    expect(infl).toHaveLength(2)
    expect(infl[0]).toBeCloseTo(-Math.sqrt(2 / 3), 5)
    expect(infl[1]).toBeCloseTo(Math.sqrt(2 / 3), 5)
  })

  it('reports the double root at the origin as a tangency, plus the two crossings', () => {
    const zeros = of(pts, 'zero')
    expect(zeros).toHaveLength(3)
    expect(zeros[0].pos.x).toBeCloseTo(-2, 6)
    expect(zeros[1].pos.x).toBeCloseTo(0, 5)
    expect(zeros[1].tangent).toBe(true)
    expect(zeros[2].pos.x).toBeCloseTo(2, 6)
  })
})

describe('analyzeCurve — the numeric core agrees with the closed forms', () => {
  it('the same cubic, analyzed numerically, lands on the analytic answers', () => {
    // identical curve, but as a typed expression: no closed form is available
    const models = { ...MODELS, c: fnModel('c', x => ((x - 2) * x - 5) * x + 6) }
    const num = analyzeCurve(curve('c', [], [-4, 5]), models)
    const exact = analyzeCurve(curve('poly3', [6, -5, -2, 1], [-4, 5]), MODELS)
    for (const kind of ['zero', 'maximum', 'minimum', 'inflection'] as SpecialPointKind[]) {
      const a = xsOf(num, kind)
      const b = xsOf(exact, kind)
      expect(a, `${kind}: different counts`).toHaveLength(b.length)
      for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i], 6)
    }
    // and the numeric ones are honest about not being closed form
    for (const p of num) {
      if (p.kind !== 'y-intercept') expect(p.exact).toBe(false)
    }
  })

  it('a logarithm reports its root and nothing in the undefined half', () => {
    const models = { ...MODELS, lg: fnModel('lg', x => Math.log(x)) }
    const pts = analyzeCurve(curve('lg', [], [-2, 5]), models)
    expect(xsOf(pts, 'zero')).toEqual([expect.closeTo(1, 6)])
    for (const p of pts) expect(p.pos.x).toBeGreaterThan(0)
    expect(of(pts, 'maximum')).toHaveLength(0)
    expect(of(pts, 'y-intercept'), 'log has no value at x = 0').toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Trap 1 — tangency / double roots
// ---------------------------------------------------------------------------

describe('analyzeCurve — tangency', () => {
  it('(x - 2)^2 yields exactly ONE zero, flagged tangent', () => {
    const pts = analyzeCurve(curve('poly2', [4, -4, 1], [-3, 7]), MODELS)
    const zeros = of(pts, 'zero')
    expect(zeros).toHaveLength(1)
    expect(zeros[0].pos.x).toBeCloseTo(2, 10)
    expect(zeros[0].tangent, 'a double root must be flagged tangent').toBe(true)
    // it is also the vertex, so it is a minimum too — both are true statements
    expect(of(pts, 'minimum')).toHaveLength(1)
    expect(of(pts, 'minimum')[0].pos.x).toBeCloseTo(2, 10)
  })

  it('a cubic with a repeated root finds the tangency a sign scan would miss', () => {
    // (x + 1)(x - 2)^2 = x^3 - 3x^2 + 4  -> params ascending [4, 0, -3, 1]
    const pts = analyzeCurve(curve('poly3', [4, 0, -3, 1], [-3, 5]), MODELS)
    const zeros = of(pts, 'zero')
    expect(zeros).toHaveLength(2)
    expect(zeros[0].pos.x).toBeCloseTo(-1, 7)
    expect(zeros[1].pos.x).toBeCloseTo(2, 6)
    expect(zeros[1].tangent, 'the repeated root is a tangency').toBe(true)
    expect(zeros[0].tangent).toBeFalsy()
  })

  it('a generic function tangent to the axis is still caught', () => {
    // (x - 1.3)^2 as a typed expression: no closed form, pure numerics
    const models = { ...MODELS, sq: fnModel('sq', x => (x - 1.3) * (x - 1.3)) }
    const pts = analyzeCurve(curve('sq', [], [-4, 6]), models)
    const zeros = of(pts, 'zero')
    expect(zeros).toHaveLength(1)
    expect(zeros[0].pos.x).toBeCloseTo(1.3, 6)
    expect(zeros[0].tangent).toBe(true)
  })

  it('a curve that never reaches zero reports no zero at all', () => {
    // x^2 + 1
    const models = { ...MODELS, up: fnModel('up', x => x * x + 1) }
    const pts = analyzeCurve(curve('up', [], [-4, 4]), models)
    expect(of(pts, 'zero')).toHaveLength(0)
    expect(of(pts, 'minimum')).toHaveLength(1)
    expect(of(pts, 'minimum')[0].pos.x).toBeCloseTo(0, 6)
  })
})

// ---------------------------------------------------------------------------
// Trap 2 — domain endpoints are not extrema
// ---------------------------------------------------------------------------

describe('analyzeCurve — domain endpoints', () => {
  it('a monotonic curve trimmed to [0, 5] has NO maximum', () => {
    // y = 0.5x + 1 on [0, 5] climbs the whole way; the right end is not a max
    const pts = analyzeCurve(curve('line', [1, 0.5], [0, 5]), MODELS)
    expect(of(pts, 'maximum')).toHaveLength(0)
    expect(of(pts, 'minimum')).toHaveLength(0)
  })

  it('a rising exponential trimmed to a window reports no extrema', () => {
    const pts = analyzeCurve(curve('exp', [0.5, 0.9, 0.3], [0, 5]), MODELS)
    expect(of(pts, 'maximum')).toHaveLength(0)
    expect(of(pts, 'minimum')).toHaveLength(0)
  })

  it('a cubic trimmed to a monotonic stretch loses the extrema outside it', () => {
    // the same cubic as above, but windowed to [3, 5] where it only rises
    const pts = analyzeCurve(curve('poly3', [6, -5, -2, 1], [3, 5]), MODELS)
    expect(of(pts, 'maximum')).toHaveLength(0)
    expect(of(pts, 'minimum')).toHaveLength(0)
    expect(of(pts, 'inflection')).toHaveLength(0)
  })

  it('a numerically analyzed monotonic curve reports no extrema either', () => {
    const models = { ...MODELS, mono: fnModel('mono', x => x * x * x + 5 * x) }
    const pts = analyzeCurve(curve('mono', [], [0, 4]), models)
    expect(of(pts, 'maximum')).toHaveLength(0)
    expect(of(pts, 'minimum')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Trap 3 — non-differentiable points
// ---------------------------------------------------------------------------

describe('analyzeCurve — kinks and branch points', () => {
  it('abs reports its kink as a minimum, with both zeros', () => {
    // y = |x - 0.5| - 1: kink at (0.5, -1), zeros at -0.5 and 1.5
    const pts = analyzeCurve(curve('abs', [1, 0.5, -1], [-4, 5]), MODELS)
    const minima = of(pts, 'minimum')
    expect(minima).toHaveLength(1)
    expect(minima[0].pos.x).toBeCloseTo(0.5, 12)
    expect(minima[0].pos.y).toBeCloseTo(-1, 12)
    expect(minima[0].exact).toBe(true)
    expect(xsOf(pts, 'zero')).toEqual([expect.closeTo(-0.5, 12), expect.closeTo(1.5, 12)])
    // f'' is a delta spike at the kink — it must NOT become an inflection
    expect(of(pts, 'inflection')).toHaveLength(0)
  })

  it('a downward V reports its kink as a maximum', () => {
    const pts = analyzeCurve(curve('abs', [-2, -1, 3], [-5, 4]), MODELS)
    expect(of(pts, 'maximum')).toHaveLength(1)
    expect(of(pts, 'maximum')[0].pos.x).toBeCloseTo(-1, 12)
    expect(of(pts, 'minimum')).toHaveLength(0)
  })

  it('cbrt reports the concavity change at its branch point, where f’’ is unbounded', () => {
    // y = cbrt(x - 1): inflection at (1, 0), which is also the zero
    const pts = analyzeCurve(curve('cbrt', [1, 1, 0], [-6, 8]), MODELS)
    const infl = of(pts, 'inflection')
    expect(infl).toHaveLength(1)
    expect(infl[0].pos.x).toBeCloseTo(1, 12)
    expect(infl[0].exact).toBe(true)
    expect(xsOf(pts, 'zero')).toEqual([expect.closeTo(1, 12)])
    expect(of(pts, 'maximum')).toHaveLength(0)
    expect(of(pts, 'minimum')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Trap 4 — undefined regions
// ---------------------------------------------------------------------------

describe('analyzeCurve — undefined regions', () => {
  it('sqrt reports nothing left of its branch point', () => {
    // y = sqrt(x - 2) - 1: zero where sqrt(x-2) = 1, i.e. x = 3
    const pts = analyzeCurve(curve('sqrt', [1, 2, -1], [2, 11]), MODELS)
    for (const p of pts) {
      expect(p.pos.x, `point at x=${p.pos.x} is left of the branch point`)
        .toBeGreaterThanOrEqual(2 - 1e-9)
      expect(Number.isFinite(p.pos.x) && Number.isFinite(p.pos.y)).toBe(true)
    }
    expect(xsOf(pts, 'zero')).toEqual([expect.closeTo(3, 10)])
    // monotonic and concave throughout: no turning point, no inflection
    expect(of(pts, 'maximum')).toHaveLength(0)
    expect(of(pts, 'minimum')).toHaveLength(0)
    expect(of(pts, 'inflection')).toHaveLength(0)
  })

  it('the sqrt branch point is not reported as a minimum (it is the domain end)', () => {
    const pts = analyzeCurve(curve('sqrt', [1, 0, 0], [0, 9]), MODELS)
    expect(of(pts, 'minimum')).toHaveLength(0)
    expect(xsOf(pts, 'zero')).toEqual([expect.closeTo(0, 10)])
  })

  it('never lets NaN reach a returned coordinate', () => {
    const models = {
      ...MODELS,
      holes: fnModel('holes', x => (x > 0 && x < 1 ? Number.NaN : x * x - 4)),
    }
    const pts = analyzeCurve(curve('holes', [], [-5, 5]), models)
    for (const p of pts) {
      expect(Number.isFinite(p.pos.x)).toBe(true)
      expect(Number.isFinite(p.pos.y)).toBe(true)
    }
    // the real roots at -2 and 2 survive
    const zeros = xsOf(pts, 'zero')
    expect(zeros).toContainEqual(expect.closeTo(-2, 6))
    expect(zeros).toContainEqual(expect.closeTo(2, 6))
  })
})

// ---------------------------------------------------------------------------
// Trap 5 / 6 — duplicates, flat and degenerate cases
// ---------------------------------------------------------------------------

describe('analyzeCurve — degenerate cases', () => {
  it('a line has a root but no extrema and no inflection', () => {
    // y = 1.2x + 0.5 -> root at -5/12
    const pts = analyzeCurve(curve('line', [0.5, 1.2], [-6, 6]), MODELS)
    expect(xsOf(pts, 'zero')).toEqual([expect.closeTo(-0.5 / 1.2, 12)])
    expect(of(pts, 'maximum')).toHaveLength(0)
    expect(of(pts, 'minimum')).toHaveLength(0)
    expect(of(pts, 'inflection'), 'a straight line has no inflection').toHaveLength(0)
    expect(of(pts, 'zero')[0].exact).toBe(true)
  })

  it('a horizontal line reports no extrema and no inflection', () => {
    const pts = analyzeCurve(curve('line', [2, 0], [-5, 5]), MODELS)
    expect(of(pts, 'maximum')).toHaveLength(0)
    expect(of(pts, 'minimum')).toHaveLength(0)
    expect(of(pts, 'inflection')).toHaveLength(0)
    expect(of(pts, 'zero')).toHaveLength(0)
    expect(of(pts, 'y-intercept')[0].pos.y).toBeCloseTo(2, 12)
  })

  it('a constant typed expression invents nothing', () => {
    const models = { ...MODELS, flat: fnModel('flat', () => 1.75) }
    const pts = analyzeCurve(curve('flat', [], [-5, 5]), models)
    expect(of(pts, 'maximum')).toHaveLength(0)
    expect(of(pts, 'minimum')).toHaveLength(0)
    expect(of(pts, 'inflection')).toHaveLength(0)
    expect(of(pts, 'zero')).toHaveLength(0)
  })

  it('a numerically analyzed straight line grows no phantom inflections', () => {
    const models = { ...MODELS, ln: fnModel('ln', x => -0.75 * x + 2) }
    const pts = analyzeCurve(curve('ln', [], [-8, 8]), models)
    expect(of(pts, 'inflection')).toHaveLength(0)
    expect(xsOf(pts, 'zero')).toEqual([expect.closeTo(2 / 0.75, 6)])
  })

  it('lines and parabolas stay inflection-free across slopes, offsets and scales', () => {
    // the curvature floor is scale-relative, so sweep magnitudes: a tiny line
    // and a huge one must both stay clean, or the tan fix has cost us the
    // noise protection it was guarding.
    for (const m of [0, 1e-3, -1e-3, 0.75, -12, 500]) {
      for (const b of [0, -3, 250]) {
        const models = { ...MODELS, l: fnModel('l', x => m * x + b) }
        const pts = analyzeCurve(curve('l', [], [-8, 8]), models)
        expect(of(pts, 'inflection'), `line m=${m} b=${b}`).toHaveLength(0)
        expect(of(pts, 'maximum'), `line m=${m} b=${b}`).toHaveLength(0)
        expect(of(pts, 'minimum'), `line m=${m} b=${b}`).toHaveLength(0)
      }
    }
    for (const a of [1e-3, 0.5, -2, 400]) {
      const models = { ...MODELS, q: fnModel('q', x => a * (x - 1.7) * (x - 1.7) - 3) }
      const pts = analyzeCurve(curve('q', [], [-6, 9]), models)
      expect(of(pts, 'inflection'), `parabola a=${a}`).toHaveLength(0)
      // it still finds the vertex
      expect(of(pts, a > 0 ? 'minimum' : 'maximum')).toHaveLength(1)
    }
  })

  it('an exponential has no zero when the offset has the wrong sign', () => {
    // 0.5 e^{0.9x} + 0.3 is positive everywhere
    const none = analyzeCurve(curve('exp', [0.5, 0.9, 0.3], [-6, 4]), MODELS)
    expect(of(none, 'zero')).toHaveLength(0)
    expect(of(none, 'inflection')).toHaveLength(0)
    // ... and exactly one when it does cross
    const one = analyzeCurve(curve('exp', [0.5, 0.9, -2], [-6, 4]), MODELS)
    const zeros = of(one, 'zero')
    expect(zeros).toHaveLength(1)
    expect(zeros[0].pos.x).toBeCloseTo(Math.log(4) / 0.9, 12)
  })

  it('deduplicates points that land within 1e-6 of each other', () => {
    const pts = analyzeCurve(curve('poly3', [6, -5, -2, 1], [-4, 5]), MODELS)
    for (const kind of ['zero', 'maximum', 'minimum', 'inflection'] as SpecialPointKind[]) {
      const xs = xsOf(pts, kind)
      for (let i = 1; i < xs.length; i++) {
        expect(xs[i] - xs[i - 1]).toBeGreaterThan(1e-6)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Trap 7 — poles must never be reported as zeros
// ---------------------------------------------------------------------------

describe('analyzeCurve — asymptotes', () => {
  it('1/x reports NO zero at the origin, where its sign flips', () => {
    const models = { ...MODELS, inv: fnModel('inv', x => 1 / x) }
    const pts = analyzeCurve(curve('inv', [], [-5, 5]), models)
    expect(of(pts, 'zero'), 'a pole is not a root').toHaveLength(0)
    expect(of(pts, 'maximum')).toHaveLength(0)
    expect(of(pts, 'minimum')).toHaveLength(0)
  })

  it('tan(x) reports no zeros at its poles, but keeps the real ones', () => {
    const models = { ...MODELS, tg: fnModel('tg', x => Math.tan(x)) }
    const pts = analyzeCurve(curve('tg', [], [-4, 4]), models)
    const zeros = xsOf(pts, 'zero')
    // real zeros in [-4, 4]: -pi, 0, pi. Poles at +/-pi/2, +/-3pi/2.
    for (const z of zeros) {
      const nearestPole = Math.round(z / Math.PI - 0.5) * Math.PI + Math.PI / 2
      expect(Math.abs(z - nearestPole), `zero at ${z} sits on a pole`).toBeGreaterThan(0.2)
    }
    expect(zeros).toContainEqual(expect.closeTo(0, 6))
    expect(zeros.length).toBeLessThanOrEqual(3)
  })

  it('tan over [-6, 6] inflects at -pi, 0 and +pi — including the origin', () => {
    // tan'' = 2 sec^2(x) tan(x), zero at every n*pi. At the origin the sampled
    // second difference is EXACTLY zero (tan is odd, so the two neighbours
    // cancel), which is the strongest possible evidence of an inflection —
    // it must not be discarded for being exactly zero.
    const models = { ...MODELS, tg: fnModel('tg', x => Math.tan(x)) }
    const pts = analyzeCurve(curve('tg', [], [-6, 6]), models)
    const infl = xsOf(pts, 'inflection')
    expect(infl).toHaveLength(3)
    expect(infl[0]).toBeCloseTo(-Math.PI, 6)
    expect(infl[1]).toBeCloseTo(0, 6)
    expect(infl[2]).toBeCloseTo(Math.PI, 6)
    // concavity really does flip across the origin
    const f = (x: number) => Math.tan(x)
    const dd = (x: number) => (f(x + 1e-3) - 2 * f(x) + f(x - 1e-3)) / 1e-6
    expect(dd(-0.2)).toBeLessThan(0)
    expect(dd(0.2)).toBeGreaterThan(0)
    // and the poles are still not roots
    for (const z of xsOf(pts, 'zero')) {
      for (const pole of [-3 * Math.PI / 2, -Math.PI / 2, Math.PI / 2, 3 * Math.PI / 2]) {
        expect(Math.abs(z - pole), `zero at ${z} sits on a pole`).toBeGreaterThan(0.2)
      }
    }
  })

  it('the inflection at the origin is reported once, beside the y-intercept', () => {
    const models = { ...MODELS, tg: fnModel('tg', x => Math.tan(x)) }
    const pts = analyzeCurve(curve('tg', [], [-6, 6]), models)
    // exactly one inflection at x = 0 — not duplicated by the near-zero neighbours
    expect(pts.filter(p => p.kind === 'inflection' && Math.abs(p.pos.x) < 0.5)).toHaveLength(1)
    // the y-intercept is a different kind at the same x, and both belong
    const atOrigin = pts.filter(p => Math.abs(p.pos.x) < 1e-9)
    expect(atOrigin.map(p => p.kind).sort()).toEqual(['inflection', 'y-intercept', 'zero'])
  })

  it('1/(x-2) does not report a root at its asymptote', () => {
    const models = { ...MODELS, h: fnModel('h', x => 1 / (x - 2)) }
    const pts = analyzeCurve(curve('h', [], [-3, 7]), models)
    expect(of(pts, 'zero')).toHaveLength(0)
  })

  it('a rational function keeps a genuine root either side of its pole', () => {
    // (x^2 - 1) / (x - 2): roots at -1 and 1, pole at 2
    const models = { ...MODELS, r: fnModel('r', x => (x * x - 1) / (x - 2)) }
    const pts = analyzeCurve(curve('r', [], [-4, 6]), models)
    const zeros = xsOf(pts, 'zero')
    expect(zeros).toContainEqual(expect.closeTo(-1, 6))
    expect(zeros).toContainEqual(expect.closeTo(1, 6))
    for (const z of zeros) expect(Math.abs(z - 2)).toBeGreaterThan(0.1)
  })
})

// ---------------------------------------------------------------------------
// Transcendental families
// ---------------------------------------------------------------------------

describe('analyzeCurve — sine', () => {
  it('sin(x) over [0, 2pi] gives 3 zeros, one crest and one trough', () => {
    const pts = analyzeCurve(curve('sine', [1, 1, 0, 0], [0, 2 * Math.PI]), MODELS)
    const zeros = xsOf(pts, 'zero')
    expect(zeros).toHaveLength(3)
    expect(zeros[0]).toBeCloseTo(0, 10)
    expect(zeros[1]).toBeCloseTo(Math.PI, 10)
    expect(zeros[2]).toBeCloseTo(2 * Math.PI, 10)
    const maxima = of(pts, 'maximum')
    const minima = of(pts, 'minimum')
    expect(maxima).toHaveLength(1)
    expect(minima).toHaveLength(1)
    expect(maxima[0].pos.x).toBeCloseTo(Math.PI / 2, 10)
    expect(maxima[0].pos.y).toBeCloseTo(1, 12)
    expect(minima[0].pos.x).toBeCloseTo(3 * Math.PI / 2, 10)
    expect(minima[0].pos.y).toBeCloseTo(-1, 12)
    expect(maxima[0].exact).toBe(true)
  })

  it('the inflections of a sinusoid sit on its midline', () => {
    // 2 sin(x) + 0.5 on [0, 2pi]: inflections at 0, pi, 2pi with y = 0.5
    const pts = analyzeCurve(curve('sine', [2, 1, 0, 0.5], [0, 2 * Math.PI]), MODELS)
    const infl = of(pts, 'inflection')
    expect(infl).toHaveLength(3)
    for (const p of infl) expect(p.pos.y).toBeCloseTo(0.5, 12)
    expect(infl.map(p => p.pos.x)).toEqual([
      expect.closeTo(0, 10), expect.closeTo(Math.PI, 10), expect.closeTo(2 * Math.PI, 10),
    ])
  })

  it('a higher-frequency sinusoid returns the right COUNT of crests', () => {
    // 3 sin(2x) on [0, 2pi]: period pi, so two crests and two troughs
    const pts = analyzeCurve(curve('sine', [3, 2, 0, 0], [0, 2 * Math.PI]), MODELS)
    expect(of(pts, 'maximum')).toHaveLength(2)
    expect(of(pts, 'minimum')).toHaveLength(2)
    expect(of(pts, 'zero')).toHaveLength(5) // 0, pi/2, pi, 3pi/2, 2pi
  })

  it('a sinusoid lifted clear of the axis has no zeros', () => {
    const pts = analyzeCurve(curve('sine', [1, 1, 0, 3], [0, 2 * Math.PI]), MODELS)
    expect(of(pts, 'zero')).toHaveLength(0)
    expect(of(pts, 'maximum')).toHaveLength(1)
  })

  it('a sinusoid resting on the axis reports its touch as a tangency', () => {
    // sin(x) - 1 touches zero at pi/2 without crossing
    const pts = analyzeCurve(curve('sine', [1, 1, 0, -1], [0, 2 * Math.PI]), MODELS)
    const zeros = of(pts, 'zero')
    expect(zeros).toHaveLength(1)
    expect(zeros[0].pos.x).toBeCloseTo(Math.PI / 2, 8)
    expect(zeros[0].tangent).toBe(true)
  })
})

describe('analyzeCurve — gaussian and logistic', () => {
  it('a gaussian peak and its two inflections are exact', () => {
    // 2 exp(-((x-1)/0.8)^2): peak (1, 2), inflections at 1 +/- 0.8/sqrt2
    const pts = analyzeCurve(curve('gauss', [2, 1, 0.8, 0], [-4, 6]), MODELS)
    const maxima = of(pts, 'maximum')
    expect(maxima).toHaveLength(1)
    expect(maxima[0].pos.x).toBeCloseTo(1, 12)
    expect(maxima[0].pos.y).toBeCloseTo(2, 12)
    const w = 0.8 / Math.SQRT2
    const infl = of(pts, 'inflection')
    expect(infl).toHaveLength(2)
    expect(infl[0].pos.x).toBeCloseTo(1 - w, 10)
    expect(infl[1].pos.x).toBeCloseTo(1 + w, 10)
    for (const p of infl) expect(p.pos.y).toBeCloseTo(2 * Math.exp(-0.5), 10)
    expect(of(pts, 'zero')).toHaveLength(0)
  })

  it('a logistic inflects at its midpoint, at half its amplitude', () => {
    // 4/(1+e^{-2(x-1)}) - 1: inflection at (1, 1), zero where the value is 0
    const pts = analyzeCurve(curve('logistic', [4, 2, 1, -1], [-5, 7]), MODELS)
    const infl = of(pts, 'inflection')
    expect(infl).toHaveLength(1)
    expect(infl[0].pos.x).toBeCloseTo(1, 12)
    expect(infl[0].pos.y).toBeCloseTo(1, 12)
    // 4/(1+E) = 1 -> E = 3 -> x = 1 - ln(3)/2
    const zeros = of(pts, 'zero')
    expect(zeros).toHaveLength(1)
    expect(zeros[0].pos.x).toBeCloseTo(1 - Math.log(3) / 2, 10)
    expect(of(pts, 'maximum')).toHaveLength(0)
  })
})

describe('analyzeCurve — power family', () => {
  it('x^(2/3) reports its cusp as a minimum and a tangent zero', () => {
    const pts = analyzeCurve(curve('power', [1, 0, 0, 2 / 3], [-4, 4]), MODELS)
    const minima = of(pts, 'minimum')
    expect(minima).toHaveLength(1)
    expect(minima[0].pos.x).toBeCloseTo(0, 12)
    const zeros = of(pts, 'zero')
    expect(zeros).toHaveLength(1)
    expect(zeros[0].tangent).toBe(true)
    expect(of(pts, 'inflection')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Non-explicit families
// ---------------------------------------------------------------------------

describe('analyzeCurve — closed and polar families', () => {
  it('a circle reports its four extreme points and its x-axis crossings', () => {
    // centre (1, 1), r = 2 -> crossings where (x-1)^2 = 3
    const pts = analyzeCurve(curve('circle', [1, 1, 2], null), MODELS)
    const ext = of(pts, 'extreme')
    expect(ext).toHaveLength(4)
    const labels = ext.map(p => p.label).sort()
    expect(labels).toEqual(['bottom', 'left', 'right', 'top'])
    expect(ext.find(p => p.label === 'left')!.pos.x).toBeCloseTo(-1, 12)
    expect(ext.find(p => p.label === 'right')!.pos.x).toBeCloseTo(3, 12)
    expect(ext.find(p => p.label === 'top')!.pos.y).toBeCloseTo(3, 12)
    expect(ext.find(p => p.label === 'bottom')!.pos.y).toBeCloseTo(-1, 12)
    const zeros = xsOf(pts, 'zero')
    expect(zeros).toHaveLength(2)
    expect(zeros[0]).toBeCloseTo(1 - Math.sqrt(3), 10)
    expect(zeros[1]).toBeCloseTo(1 + Math.sqrt(3), 10)
  })

  it('a circle clear of the x axis reports no crossings', () => {
    const pts = analyzeCurve(curve('circle', [0, 5, 1], null), MODELS)
    expect(of(pts, 'zero')).toHaveLength(0)
    expect(of(pts, 'extreme')).toHaveLength(4)
  })

  it('an axis-aligned ellipse reports its four vertices', () => {
    // x^2/9 + y^2/4 = 1 -> conic (1/9)x^2 + (1/4)y^2 - 1 = 0
    const pts = analyzeCurve(curve('ellipse', [1 / 9, 0, 1 / 4, 0, 0, -1], null), MODELS)
    const ext = of(pts, 'extreme')
    expect(ext).toHaveLength(4)
    expect(ext.find(p => p.label === 'left')!.pos.x).toBeCloseTo(-3, 8)
    expect(ext.find(p => p.label === 'right')!.pos.x).toBeCloseTo(3, 8)
    expect(ext.find(p => p.label === 'top')!.pos.y).toBeCloseTo(2, 8)
    expect(ext.find(p => p.label === 'bottom')!.pos.y).toBeCloseTo(-2, 8)
  })

  it('a rose reports one tip per petal, at radius |a|', () => {
    // r = 2 cos(3 theta): three petals
    const pts = analyzeCurve(curve('polarRose', [2, 3, 0], [0, 2 * Math.PI]), MODELS)
    const tips = of(pts, 'petal-tip')
    expect(tips).toHaveLength(3)
    for (const t of tips) {
      expect(Math.hypot(t.pos.x, t.pos.y)).toBeCloseTo(2, 10)
    }
  })

  it('a four-petal rose reports four tips', () => {
    const pts = analyzeCurve(curve('polarRose', [1.5, 2, 0], [0, 2 * Math.PI]), MODELS)
    expect(of(pts, 'petal-tip')).toHaveLength(4)
  })

  it('a cardioid reports its single outermost tip', () => {
    // r = 1 + cos(theta): tip at (2, 0)
    const pts = analyzeCurve(curve('limacon', [1, 1], [0, 2 * Math.PI]), MODELS)
    const tips = of(pts, 'petal-tip')
    expect(tips).toHaveLength(1)
    expect(tips[0].pos.x).toBeCloseTo(2, 10)
    expect(tips[0].pos.y).toBeCloseTo(0, 10)
  })

  it('a spiral has no local maximum of |r|, so it reports nothing', () => {
    expect(analyzeCurve(curve('spiral', [0.25, 0.33], [0, 4 * Math.PI]), MODELS)).toEqual([])
  })

  it('a fourier blob reports its four bounding extremes', () => {
    // an ellipse-ish closed curve: x = 2cos t, y = 1.5 sin t
    const pts = analyzeCurve(
      curve('fourier', [0, 0, 2, 0, 0, 1.5], [0, 2 * Math.PI]), MODELS,
    )
    const ext = of(pts, 'extreme')
    expect(ext).toHaveLength(4)
    expect(ext.find(p => p.label === 'left')!.pos.x).toBeCloseTo(-2, 6)
    expect(ext.find(p => p.label === 'right')!.pos.x).toBeCloseTo(2, 6)
    expect(ext.find(p => p.label === 'top')!.pos.y).toBeCloseTo(1.5, 6)
    expect(ext.find(p => p.label === 'bottom')!.pos.y).toBeCloseTo(-1.5, 6)
  })

  it('a vertical line reports nothing rather than inventing a feature', () => {
    expect(analyzeCurve(curve('vline', [2], [-4, 4]), MODELS)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Robustness and performance
// ---------------------------------------------------------------------------

describe('analyzeCurve — robustness', () => {
  it('never throws on unknown models, empty params or absurd domains', () => {
    expect(analyzeCurve(curve('poly3', [6, -5, -2, 1], [-4, 5]), {})).toEqual([])
    expect(analyzeCurve(curve('line', [Number.NaN, 1], [-5, 5]), MODELS)).toEqual([])
    expect(analyzeCurve(curve('line', [1, 1], [5, -5]), MODELS)).toEqual([])
    expect(analyzeCurve(curve('line', [1, 1], [0, 0]), MODELS)).toEqual([])
    const boom = {
      ...MODELS,
      bad: fnModel('bad', () => { throw new Error('kaboom') }),
    }
    expect(analyzeCurve(curve('bad', [], [-3, 3]), boom)).toEqual([])
  })

  it('a curve with no domain still analyzes over the default window', () => {
    const pts = analyzeCurve(curve('poly2', [-4, 0, 1], null), MODELS)
    expect(xsOf(pts, 'zero')).toEqual([expect.closeTo(-2, 10), expect.closeTo(2, 10)])
  })

  it('every returned point carries a finite position and a label', () => {
    for (const [id, params, dom] of [
      ['poly3', [6, -5, -2, 1], [-4, 5]],
      ['sine', [1.5, 1.2, 0.3, 0.4], [-7, 7]],
      ['gauss', [3, 0.5, 1.2, -1], [-6, 7]],
      ['abs', [1.2, 0.7, -2], [-5, 6]],
      ['sqrt', [2, -1, 0.5], [-1, 8]],
      ['cbrt', [1.7, 1, -0.5], [-6, 8]],
      ['power', [1, 0, 0, 2 / 3], [-4, 4]],
      ['logistic', [4, 1.8, 0.5, -2], [-6, 7]],
      ['circle', [0, 0, 2.5], null],
      ['polarRose', [3, 3, 0.7], [0, 2 * Math.PI]],
    ] as Array<[string, number[], [number, number] | null]>) {
      for (const p of analyzeCurve(curve(id, params, dom), MODELS)) {
        expect(Number.isFinite(p.pos.x), `${id}: non-finite x`).toBe(true)
        expect(Number.isFinite(p.pos.y), `${id}: non-finite y`).toBe(true)
        expect(typeof p.label).toBe('string')
        expect(p.label.length).toBeGreaterThan(0)
        expect(typeof p.exact).toBe('boolean')
      }
    }
  })

  it('runs fast enough to re-run on every slider frame (< 2ms)', () => {
    const cases: FittedCurve[] = [
      curve('poly3', [6, -5, -2, 1], [-4, 5]),
      curve('poly4', [1, 2, -3, 0.4, 0.1], [-5, 5]),
      curve('sine', [1.5, 1.2, 0.3, 0.4], [-7, 7]),
      curve('gauss', [3, 0.5, 1.2, -1], [-6, 7]),
    ]
    const models = { ...MODELS, expr: fnModel('expr', x => Math.sin(x) * Math.exp(-0.1 * x * x) + 0.2) }
    cases.push(curve('expr', [], [-8, 8]))
    for (const c of cases) for (let i = 0; i < 20; i++) analyzeCurve(c, models) // warm up

    for (const c of cases) {
      const REPS = 50
      const t0 = performance.now()
      for (let i = 0; i < REPS; i++) analyzeCurve(c, models)
      const ms = (performance.now() - t0) / REPS
      expect(ms, `${c.modelId} took ${ms.toFixed(3)}ms`).toBeLessThan(2)
    }
  })
})

// ---------------------------------------------------------------------------
// P0: a root sitting ON a domain endpoint.
//
// The bracketing scan pairs sample i with sample i + 1, so the LAST sample of a
// run was never a left endpoint and a root there was silently dropped; and the
// "is this sample already a root" test was `y === 0`, which cos(-pi/2) — 6.1e-17
// — fails. Between them, cos(x) on [-pi/2, pi/2] reported no x-intercepts at
// all. Users type exact endpoints, so every one of these is reachable.
// ---------------------------------------------------------------------------

describe('analyzeCurve — roots exactly at a domain endpoint', () => {
  const endpointCases: Array<[string, (x: number) => number, [number, number], number[]]> = [
    ['x^2 - 9 on [-3, 3]', x => x * x - 9, [-3, 3], [-3, 3]],
    ['x^3 - 4x on [-2, 2]', x => x ** 3 - 4 * x, [-2, 2], [-2, 0, 2]],
    ['cos(x) on [-pi/2, pi/2]', Math.cos, [-Math.PI / 2, Math.PI / 2], [-Math.PI / 2, Math.PI / 2]],
    ['sin(x) on [0, 2pi]', Math.sin, [0, 2 * Math.PI], [0, Math.PI, 2 * Math.PI]],
    ['x on [0, 5]', x => x, [0, 5], [0]],
    ['5 - x on [-5, 5]', x => 5 - x, [-5, 5], [5]],
  ]

  it.each(endpointCases)('%s', (label, f, domain, want) => {
    const models = { fn: fnModel('fn', f) }
    const zeros = xsOf(analyzeCurve(curve('fn', [], domain), models), 'zero')
    expect(zeros, `${label}: got ${zeros}`).toHaveLength(want.length)
    for (let i = 0; i < want.length; i++) expect(zeros[i]).toBeCloseTo(want[i], 6)
  })

  it('an endpoint that merely comes close is not a root', () => {
    // f(3) = 0.5, two thirds of the way up the curve's own range — nowhere near
    const models = { fn: fnModel('fn', x => x * x - 8.5) }
    const zeros = xsOf(analyzeCurve(curve('fn', [], [-3, 3]), models), 'zero')
    expect(zeros).toHaveLength(2)
    for (const z of zeros) expect(Math.abs(z)).toBeCloseTo(Math.sqrt(8.5), 6)
  })
})

// ---------------------------------------------------------------------------
// P1: the zero tolerance has to be the curve's OWN magnitude.
//
// `1e-7 * max(1, scale)` put an absolute floor under a relative test, so any
// curve living below 1e-7 was declared to be zero everywhere it dipped. Both
// halves have to keep working: a tolerance loose enough to invent roots is as
// wrong as one tight enough to report a pole as a root.
// ---------------------------------------------------------------------------

describe('analyzeCurve — the zero tolerance scales with the curve', () => {
  it('a curve that never reaches zero has no zeros, however small it is', () => {
    for (const eps of [1e-4, 1e-8, 1e-12]) {
      // min |f| = eps, at y = eps; the curve never touches the axis
      const models = { fn: fnModel('fn', x => eps * Math.cos(x) + 2 * eps) }
      const pts = analyzeCurve(curve('fn', [], [-10, 10]), models)
      expect(xsOf(pts, 'zero'), `eps=${eps}`).toHaveLength(0)
    }
  })

  it('a tiny curve that DOES cross still reports its crossings', () => {
    for (const eps of [1e-4, 1e-8, 1e-12]) {
      const models = { fn: fnModel('fn', x => eps * (x - 1.5)) }
      const zeros = xsOf(analyzeCurve(curve('fn', [], [-4, 4]), models), 'zero')
      expect(zeros, `eps=${eps}`).toHaveLength(1)
      expect(zeros[0]).toBeCloseTo(1.5, 8)
    }
  })

  it('poles are still not roots, and genuine roots beside them survive', () => {
    const inv = { fn: fnModel('fn', x => 1 / x) }
    expect(xsOf(analyzeCurve(curve('fn', [], [-10, 10]), inv), 'zero')).toHaveLength(0)

    const rational = { fn: fnModel('fn', x => (x * x - 1) / (x - 2)) }
    const zeros = xsOf(analyzeCurve(curve('fn', [], [-5, 5]), rational), 'zero')
    expect(zeros).toHaveLength(2)
    expect(zeros[0]).toBeCloseTo(-1, 6)
    expect(zeros[1]).toBeCloseTo(1, 6)
  })
})

// ---------------------------------------------------------------------------
// P0: a conic far from the origin is still an ellipse.
//
// fitConic normalises the conic to unit length, so an ellipse centred 3e4 out
// has A, C ~ 1e-9 and 4AC - B^2 ~ 1e-17. The absolute 1e-16 degeneracy floor
// called that a degenerate conic, so analysis returned nothing, the handles
// vanished, and the printed equation solved to imaginary radii — while marching
// squares kept drawing a perfectly good ellipse and recognition reported a
// healthy fit. MIN_PPU = 0.001 means 1.2e6 units fit across one screen, so
// every distance below is somewhere a student can actually draw.
// ---------------------------------------------------------------------------

describe('analyzeCurve — ellipses far from the origin', () => {
  const distances = [3e4, 2e5, 1e6]
  const angles = [0, 0.4]

  it.each(distances)('an ellipse centred %d units out still analyses', (d) => {
    for (const angle of angles) {
      const cf = { cx: d, cy: -d / 3, rx: 3, ry: 2, angle }
      const conic = centerFormToConic(cf)!
      const back = conicToCenterForm(conic)
      expect(back, `d=${d} angle=${angle}: centre form refused`).not.toBeNull()
      expect(back!.cx).toBeCloseTo(cf.cx, 0)
      expect(back!.cy).toBeCloseTo(cf.cy, 0)
      // semi-axes to within 0.1%, whichever eigenvalue ordering came out
      const got = [back!.rx, back!.ry].sort((p, q) => p - q)
      expect(got[0] / 2 - 1, `d=${d} angle=${angle}: minor axis ${got[0]}`).toBeCloseTo(0, 3)
      expect(got[1] / 3 - 1, `d=${d} angle=${angle}: major axis ${got[1]}`).toBeCloseTo(0, 3)

      const pts = analyzeCurve(curve('ellipse', conic, null), MODELS)
      const extremes = of(pts, 'extreme')
      expect(extremes, `d=${d} angle=${angle}: no extremes`).toHaveLength(4)
      for (const p of extremes) {
        expect(Math.hypot(p.pos.x - cf.cx, p.pos.y - cf.cy)).toBeLessThan(3.01)
        expect(Math.hypot(p.pos.x - cf.cx, p.pos.y - cf.cy)).toBeGreaterThan(1.99)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Logarithms and reciprocals — the two families where the interesting point is
// the one that ISN'T on the curve.
// ---------------------------------------------------------------------------

describe('analyzeCurve — logarithm', () => {
  it('crosses the axis exactly once, at b + e^(-c/a)', () => {
    // y = 1.6 ln(x + 4.5): zero where ln(x + 4.5) = 0, i.e. x = -3.5
    const pts = analyzeCurve(curve('log', [1.6, -4.5, 0], [-4.5, 6]), MODELS)
    expect(xsOf(pts, 'zero')).toHaveLength(1)
    expect(xsOf(pts, 'zero')[0]).toBeCloseTo(-3.5, 9)
    expect(of(pts, 'zero')[0].exact, 'a log root is closed form').toBe(true)
  })

  it('places the zero by the same formula when it is shifted and scaled', () => {
    // y = 2 ln(x - 1) + 1 -> ln(x-1) = -0.5 -> x = 1 + e^{-0.5}
    const pts = analyzeCurve(curve('log', [2, 1, 1], [1, 9]), MODELS)
    expect(xsOf(pts, 'zero')[0]).toBeCloseTo(1 + Math.exp(-0.5), 9)
  })

  it('has no maximum, no minimum and no inflection — ever', () => {
    for (const p of [[1, 0, 0], [-1.4, 1, -0.5], [3, -2, 4]]) {
      const pts = analyzeCurve(curve('log', p, [p[1], p[1] + 10]), MODELS)
      expect(of(pts, 'maximum'), `params ${p}`).toHaveLength(0)
      expect(of(pts, 'minimum'), `params ${p}`).toHaveLength(0)
      expect(of(pts, 'inflection'), `params ${p}`).toHaveLength(0)
    }
  })

  it('never reports anything at the asymptote itself', () => {
    const pts = analyzeCurve(curve('log', [1.6, -4.5, 0], [-4.5, 6]), MODELS)
    for (const p of pts) {
      expect(Math.abs(p.pos.x + 4.5), `${p.kind} sits on the asymptote`).toBeGreaterThan(1e-6)
      expect(Number.isFinite(p.pos.y), `${p.kind} has a non-finite y`).toBe(true)
    }
  })

  it('reports a y-intercept only when the asymptote is left of the y-axis', () => {
    const on = analyzeCurve(curve('log', [1.6, -4.5, 0], [-4.5, 6]), MODELS)
    expect(of(on, 'y-intercept')).toHaveLength(1)
    expect(of(on, 'y-intercept')[0].pos.y).toBeCloseTo(1.6 * Math.log(4.5), 9)
    // y = ln(x - 1) does not exist at x = 0
    const off = analyzeCurve(curve('log', [1, 1, 0], [1, 9]), MODELS)
    expect(of(off, 'y-intercept')).toHaveLength(0)
  })

  it('keeps the zero inside the reported domain', () => {
    // the zero of y = ln(x) is at 1; a curve trimmed to [3, 9] has none showing
    const pts = analyzeCurve(curve('log', [1, 0, 0], [3, 9]), MODELS)
    expect(of(pts, 'zero')).toHaveLength(0)
  })
})

describe('analyzeCurve — reciprocal', () => {
  it('reports the single zero of a/(x - b) + c and NOT the pole', () => {
    // y = 2/(x - 1) + 1: zero where 2/(x-1) = -1, i.e. x = -1. Pole at x = 1.
    const pts = analyzeCurve(curve('recip', [2, 1, 1], [-6, 8]), MODELS)
    const zeros = xsOf(pts, 'zero')
    expect(zeros).toHaveLength(1)
    expect(zeros[0]).toBeCloseTo(-1, 9)
    for (const z of zeros) expect(Math.abs(z - 1), 'the pole is not a root').toBeGreaterThan(0.5)
  })

  it('reports NO zero when the horizontal asymptote is the axis itself', () => {
    // y = a/(x - b) never reaches 0 — and the pole must not be offered instead
    const pts = analyzeCurve(curve('recip', [1, 0, 0], [-5, 5]), MODELS)
    expect(of(pts, 'zero'), 'a hyperbola on the axis has no root').toHaveLength(0)
    expect(of(pts, 'maximum')).toHaveLength(0)
    expect(of(pts, 'minimum')).toHaveLength(0)
    expect(of(pts, 'inflection')).toHaveLength(0)
  })

  it('has no turning point and no inflection on either branch', () => {
    for (const p of [[1.5, -1, 0.5], [-2, 1, -1], [3, 0.5, 2]]) {
      const pts = analyzeCurve(curve('recip', p, [p[1] - 6, p[1] + 6]), MODELS)
      expect(of(pts, 'maximum'), `params ${p}`).toHaveLength(0)
      expect(of(pts, 'minimum'), `params ${p}`).toHaveLength(0)
      expect(of(pts, 'inflection'), `params ${p}`).toHaveLength(0)
    }
  })

  it('never reports a point at the pole, from either side', () => {
    for (const p of [[1, 0, 0], [2, 1, 1], [-1.5, -2, -1], [0.6, 3, 0]]) {
      const pts = analyzeCurve(curve('recip', p, [p[1] - 5, p[1] + 5]), MODELS)
      for (const q of pts) {
        expect(Math.abs(q.pos.x - p[1]), `${q.kind} sits on the pole of ${p}`).toBeGreaterThan(1e-6)
        expect(Number.isFinite(q.pos.y), `${q.kind} has a non-finite y`).toBe(true)
      }
    }
  })

  it('has no y-intercept when the pole is on the y-axis', () => {
    const pts = analyzeCurve(curve('recip', [1, 0, 0], [-5, 5]), MODELS)
    expect(of(pts, 'y-intercept')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Holes — the full story lives in tests/holes.test.ts; these are the two facts
// analyzeCurve itself is responsible for.
// ---------------------------------------------------------------------------

describe('analyzeCurve — removable discontinuities', () => {
  /** A typed expression as the board holds it. */
  function expr(src: string, domain: [number, number]) {
    const r = parseExpression(src)
    if (!r.ok) throw new Error(`expected "${src}" to parse, got: ${r.error}`)
    const models = { expr_1: r.plot.makeModel('expr_1') }
    const c: FittedCurve = {
      ...curve('expr_1', r.plot.defaultParams, domain),
      kind: r.plot.kind,
    }
    return analyzeCurve(c, models)
  }

  it('lists the hole of (x² − 1)/(x − 1) at (1, 2), labelled “hole”', () => {
    const pts = expr('y = (x^2-1)/(x-1)', [-10, 10])
    const holes = of(pts, 'hole')
    expect(holes).toHaveLength(1)
    expect(holes[0].label).toBe('hole')
    expect(holes[0].pos.x).toBe(1)
    expect(holes[0].pos.y).toBeCloseTo(2, 6)
    // the y is a limit, so nothing about this point is claimed exact
    expect(holes[0].exact).toBe(false)
  })

  it('a hole on the x-axis is not also reported as a zero', () => {
    // (x − 1)²/(x − 1) changes sign across x = 1, which is exactly what the
    // sign-change scan calls a root. There is no point on the graph there.
    const pts = expr('y = (x-1)^2/(x-1)', [-10, 10])
    expect(of(pts, 'hole')).toHaveLength(1)
    expect(xsOf(pts, 'zero')).toEqual([])
  })
})

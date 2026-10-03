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
import { analyzeCurve, intersectionPoints, zeroIntervals } from '../src/core/analyze'
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

    // Best of five batches: the budget is about the code, not about what
    // else the machine is running — one batch under a loaded parallel test
    // run once measured 206 ms while the same test alone takes well under 2.
    for (const c of cases) {
      const REPS = 50
      let ms = Infinity
      for (let round = 0; round < 5; round++) {
        const t0 = performance.now()
        for (let i = 0; i < REPS; i++) analyzeCurve(c, models)
        ms = Math.min(ms, (performance.now() - t0) / REPS)
      }
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

  it('x·ln(x) is listed with a hole at (0, 0)', () => {
    // undefined at 0 and left of it, but the product goes to 0: an open point
    const pts = expr('y = x ln(x)', [-10, 10])
    const holes = of(pts, 'hole')
    expect(holes).toHaveLength(1)
    expect(holes[0].pos.x).toBe(0)
    expect(holes[0].pos.y).toBeCloseTo(0, 6)
  })

  it('a logarithm’s asymptote is NOT listed as a hole', () => {
    // y = ln(x) dives to −∞ at 0: a vertical asymptote, and nothing is there
    expect(of(expr('y = ln(x)', [-10, 10]), 'hole')).toEqual([])
    expect(of(expr('y = ln(x^2-4)', [-10, 10]), 'hole')).toEqual([])
    // nor for the library family
    expect(of(analyzeCurve(curve('log', [1.6, -4.5, 0], [-4.5, 6]), MODELS), 'hole')).toEqual([])
  })

  it('a POLAR hole is listed at the Cartesian point it is missing', () => {
    // r = sin(θ)/θ is undefined at θ = 0 and approaches r = 1 from both
    // sides, so the open ring belongs at (1·cos 0, 1·sin 0) = (1, 0).
    const pts = expr('r = sin(theta)/theta', [0, 2 * Math.PI])
    const holes = of(pts, 'hole')
    expect(holes).toHaveLength(1)
    expect(holes[0].label).toBe('hole')
    expect(holes[0].pos.x).toBeCloseTo(1, 9)
    expect(holes[0].pos.y).toBeCloseTo(0, 9)
    expect(holes[0].exact).toBe(false)
  })

  it('a polar curve with nothing undefined is listed as it always was', () => {
    expect(of(expr('r = 2cos(3theta)', [0, 2 * Math.PI]), 'hole')).toEqual([])
    const rose = analyzeCurve(curve('polarRose', [2, 3, 0], [0, 2 * Math.PI]), MODELS)
    expect(of(rose, 'hole')).toEqual([])
    expect(of(rose, 'petal-tip').length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Exact forms (src/core/exact.ts) — the closed form beside the decimal.
//
// A zero at 1.7320508075688772 IS √3 and the card says so; a zero at
// 0.6931471805599454 is ln 2, which this module does not recognise, and the
// card says NOTHING rather than something nearly right. Both halves are here.
//
// The rule these tests hold analyzeCurve to: a form appears only when the
// curve itself agrees with it — |f| ≈ 0 at a zero, |f′| ≈ 0 at an extremum,
// |f″| ≈ 0 at an inflection, evaluated AT the exact value — and when it
// appears, the point has been moved onto it, so the decimal printed beside
// "√2" is the decimal of √2.
// ---------------------------------------------------------------------------

describe('analyzeCurve — exact forms', () => {
  /** A typed expression as the board holds it. */
  function typed(src: string, domain: [number, number]): SpecialPoint[] {
    const r = parseExpression(src)
    if (!r.ok) throw new Error(`expected "${src}" to parse, got: ${r.error}`)
    const models = { expr_1: r.plot.makeModel('expr_1') }
    const c: FittedCurve = {
      ...curve('expr_1', r.plot.defaultParams, domain),
      kind: r.plot.kind,
    }
    return analyzeCurve(c, models)
  }
  const exactXs = (pts: SpecialPoint[], kind: SpecialPointKind) =>
    of(pts, kind).sort((a, b) => a.pos.x - b.pos.x).map(p => p.exactX)

  const MINUS = '−'
  const RT = '√'
  const PI = 'π'

  it('x² − 2 crosses at −√2 and √2', () => {
    const pts = typed('y = x^2 - 2', [-5, 5])
    expect(exactXs(pts, 'zero')).toEqual([MINUS + RT + '2', RT + '2'])
    // and the point IS √2, to the last bit: the card's decimal is the form's
    expect(of(pts, 'zero')[1].pos.x).toBe(Math.SQRT2)
    expect(of(pts, 'zero')[0].pos.x).toBe(-Math.SQRT2)
  })

  it('x³ − 3x: zeros −√3, 0, √3; extrema at ∓1 with y ±2; inflection (0, 0)', () => {
    const pts = typed('y = x^3 - 3x', [-3, 3])
    expect(exactXs(pts, 'zero')).toEqual([MINUS + RT + '3', '0', RT + '3'])

    const max = of(pts, 'maximum')[0]
    const min = of(pts, 'minimum')[0]
    expect(max.exactX).toBe(MINUS + '1')
    expect(max.exactY).toBe('2')
    expect(max.pos.x).toBe(-1)
    expect(max.pos.y).toBe(2)
    expect(min.exactX).toBe('1')
    expect(min.exactY).toBe(MINUS + '2')
    expect(min.pos.x).toBe(1)
    expect(min.pos.y).toBe(-2)

    const infl = of(pts, 'inflection')[0]
    expect(infl.exactX).toBe('0')
    expect(infl.exactY).toBe('0')
  })

  it('x² − x − 1 crosses at the golden ratio and its conjugate', () => {
    const pts = typed('y = x^2 - x - 1', [-5, 5])
    expect(exactXs(pts, 'zero')).toEqual([
      '(1' + MINUS + RT + '5)/2',
      '(1+' + RT + '5)/2',
    ])
    expect(of(pts, 'zero')[1].pos.x).toBeCloseTo((1 + Math.sqrt(5)) / 2, 15)
    // the vertex of the same parabola is a plain fraction
    const min = of(pts, 'minimum')[0]
    expect(min.exactX).toBe('1/2')
    expect(min.exactY).toBe(MINUS + '5/4')
  })

  it('sin(x) crosses at −π, 0, π and crests at π/2 with y = 1', () => {
    const pts = typed('y = sin(x)', [-Math.PI, Math.PI])
    expect(exactXs(pts, 'zero')).toEqual([MINUS + PI, '0', PI])
    const max = of(pts, 'maximum')[0]
    expect(max.exactX).toBe(PI + '/2')
    expect(max.exactY).toBe('1')
    expect(max.pos.x).toBe(Math.PI / 2)
    const min = of(pts, 'minimum')[0]
    expect(min.exactX).toBe(MINUS + PI + '/2')
    expect(min.exactY).toBe(MINUS + '1')
    // the library family reaches the same forms by the closed-form path
    const fam = analyzeCurve(curve('sine', [1, 1, 0, 0], [-Math.PI, Math.PI]), MODELS)
    expect(exactXs(fam, 'zero')).toEqual([MINUS + PI, '0', PI])
    expect(of(fam, 'maximum')[0].exactX).toBe(PI + '/2')
  })

  it('x³ − 6x² + 9x: zeros 0 and 3, extrema (1, 4) and (3, 0), inflection (2, 2)', () => {
    const pts = typed('y = x^3 - 6x^2 + 9x', [-1, 5])
    expect(exactXs(pts, 'zero')).toEqual(['0', '3'])
    const max = of(pts, 'maximum')[0]
    expect([max.exactX, max.exactY]).toEqual(['1', '4'])
    expect([max.pos.x, max.pos.y]).toEqual([1, 4])
    const min = of(pts, 'minimum')[0]
    expect([min.exactX, min.exactY]).toEqual(['3', '0'])
    const infl = of(pts, 'inflection')[0]
    expect([infl.exactX, infl.exactY]).toEqual(['2', '2'])
    expect([infl.pos.x, infl.pos.y]).toEqual([2, 2])
  })

  it('e^x − 2 crosses at ln 2 — read from the FORMULA (e^x = 2), never from the digits', () => {
    // ln 2 is deliberately outside exact.ts's table, so no digit match can
    // propose it. It is written only because the typed formula IS e^x − 2,
    // which src/core/expSolve.ts solves exactly (F-LE.4).
    const pts = typed('y = e^x - 2', [-5, 5])
    const zeros = of(pts, 'zero')
    expect(zeros).toHaveLength(1)
    expect(zeros[0].pos.x).toBeCloseTo(Math.log(2), 9)
    expect(zeros[0].exactX).toBe('ln 2')
    // the y-intercept of the same curve is a clean −1
    expect(of(pts, 'y-intercept')[0].exactY).toBe(MINUS + '1')
  })

  it('a SKETCHED cubic has no exact forms at all, and that is the right answer', () => {
    // params a teacher never typed: nothing here is √3 or π/4, and pretending
    // otherwise would be the worst failure this feature has.
    const pts = analyzeCurve(curve('poly3', [0.13, -3.02, 0.01, 1.43], [-4, 4]), MODELS)
    expect(pts.length).toBeGreaterThan(3)
    for (const p of pts) {
      expect(p.exactX, `${p.kind} at x=${p.pos.x} claimed ${p.exactX}`).toBeUndefined()
      expect(p.exactY, `${p.kind} at x=${p.pos.x} claimed ${p.exactY}`).toBeUndefined()
    }
  })

  it('a hole is listed with both coordinates in closed form', () => {
    const pts = typed('y = (x^2-1)/(x-1)', [-10, 10])
    const hole = of(pts, 'hole')[0]
    expect(hole.exactX).toBe('1')
    expect(hole.exactY).toBe('2')
    expect(hole.pos.x).toBe(1)
    expect(hole.pos.y).toBe(2)
    // `exact` still says false: the y is a limit, whatever it is a limit OF
    expect(hole.exact).toBe(false)
  })

  it('a parabola’s closed-form zeros and vertex carry their forms too', () => {
    // 3x² − 6 = 0 at ±√2, vertex (0, −6)
    const pts = analyzeCurve(curve('poly2', [-6, 0, 3], [-5, 5]), MODELS)
    expect(exactXs(pts, 'zero')).toEqual([MINUS + RT + '2', RT + '2'])
    const v = of(pts, 'minimum')[0]
    expect([v.exactX, v.exactY]).toEqual(['0', MINUS + '6'])
  })

  it('an extremum keeps its decimal when the form is only nearly right', () => {
    // y = x² − 2.0000001x: the minimum is at 1.00000005, NOT at 1. The
    // proposal generator offers 1 (it is inside 1e-6); f′(1) = −1e-7 is not
    // zero for this curve, so the form is refused and nothing is printed.
    const pts = typed('y = x^2 - 2.0000001x', [-3, 3])
    const min = of(pts, 'minimum')[0]
    // golden section places it to ~3e-9; what matters is that it stays there
    expect(min.pos.x).toBeCloseTo(1.00000005, 7)
    expect(min.pos.x).not.toBe(1)
    expect(min.exactX).toBeUndefined()
  })

  it('a sketched sinusoid’s inflection is not handed a quadratic surd', () => {
    // REGRESSION. a·sin(bx + c) + d with b = 0.87, c = 0.21 puts an
    // inflection at (π − 0.21)/0.87 = 3.36964673, and (31 − √307)/4 =
    // 3.36964613 sits 6e-7 away — close enough to be PROPOSED, and it was
    // accepted while the check's f″ was measured with a step tuned for sign
    // changes rather than for size. The middle inflection has no form.
    const pts = analyzeCurve(curve('sine', [1.13, 0.87, 0.21, 0.04], [-7, 7]), MODELS)
    const near = of(pts, 'inflection').filter(p => Math.abs(p.pos.x - 3.3696467) < 1e-4)
    expect(near).toHaveLength(1)
    expect(near[0].exactX).toBeUndefined()
    expect(near[0].pos.x).toBeCloseTo((Math.PI - 0.21) / 0.87, 9)
    // the inflection at −c/b, on the other hand, IS −7/29 — 0.21/0.87 is that
    // fraction exactly, and the curve agrees to the last bit
    const mid = of(pts, 'inflection').filter(p => Math.abs(p.pos.x + 0.2413793) < 1e-4)
    expect(mid[0].exactX).toBe(MINUS + '7/29')
    expect(mid[0].exactY).toBe('1/25')
  })

  it('every exactX that IS printed is the decimal the point now carries', () => {
    for (const src of ['y = x^2 - 2', 'y = sin(x)', 'y = x^3 - 3x']) {
      for (const p of typed(src, [-3, 3])) {
        if (p.exactX === undefined) continue
        // the polish: the point sits ON the form, so card and chip agree
        expect(Number.isFinite(p.pos.x), src).toBe(true)
      }
    }
  })

  it('recognising forms leaves analysis fast enough for a slider (< 3ms)', () => {
    const r = parseExpression('y = x^3 - 3x')
    if (!r.ok) throw new Error('expected x^3 - 3x to parse')
    const models = { expr_1: r.plot.makeModel('expr_1') }
    const c: FittedCurve = {
      ...curve('expr_1', r.plot.defaultParams, [-3, 3]),
      kind: r.plot.kind,
    }
    for (let i = 0; i < 20; i++) analyzeCurve(c, models) // warm up
    const REPS = 50
    const t0 = performance.now()
    for (let i = 0; i < REPS; i++) analyzeCurve(c, models)
    const ms = (performance.now() - t0) / REPS
    expect(ms, `x^3 - 3x took ${ms.toFixed(3)}ms`).toBeLessThan(3)
  })
})

// ---------------------------------------------------------------------------
// Intersections (intersectionPoints) — where one curve meets another.
//
// The point is reported on the PARENT, so pos.y is the parent's f; withId
// names the other curve. `exact` says the location came from a formula — two
// polynomials whose difference is linear or quadratic — and NOT merely that
// the numbers came out round: x³ and x meet at −1, 0 and 1, and those three
// were bisected to. The exact FORM is a separate claim, verified against
// f − g at the candidate exactly as every other point's is.
// ---------------------------------------------------------------------------

describe('analyzeCurve — intersections', () => {
  /** A library-family curve with an id of its own. */
  const named = (
    id: string,
    modelId: string,
    params: number[],
    domain: [number, number] | null = null,
  ): FittedCurve => ({ ...curve(modelId, params, domain), id })

  /** A typed expression as the board holds it, with its own model id. */
  function typedCurve(
    id: string,
    src: string,
    domain: [number, number] | null = null,
  ): { c: FittedCurve; models: Record<string, ModelSpec> } {
    const r = parseExpression(src)
    if (!r.ok) throw new Error(`expected "${src}" to parse, got: ${r.error}`)
    const modelId = `expr_${id}`
    const spec = r.plot.makeModel(modelId)
    return {
      c: {
        ...curve(modelId, r.plot.defaultParams, domain),
        id,
        kind: r.plot.kind,
      },
      models: { [modelId]: spec },
    }
  }

  const MINUS = '−'
  const RT = '√'
  const PI = 'π'
  const xy = (p: SpecialPoint) => [p.pos.x, p.pos.y]
  const forms = (ps: SpecialPoint[]) => ps.map(p => [p.exactX, p.exactY])

  it('x² and 2 − x² meet at (−1, 1) and (1, 1), by formula', () => {
    const f = named('f', 'poly2', [0, 0, 1])
    const g = named('g', 'poly2', [2, 0, -1])
    const pts = intersectionPoints(f, g, MODELS, [-5, 5])
    expect(pts).toHaveLength(2)
    expect(pts.map(xy)).toEqual([[-1, 1], [1, 1]])
    for (const p of pts) {
      expect(p.kind).toBe('intersection')
      expect(p.label).toBe('intersection')
      expect(p.withId).toBe('g')
      // the roots of a quadratic difference come from the quadratic formula
      expect(p.exact).toBe(true)
      expect(p.tangent).toBeUndefined()
    }
    // a plain integer IS a closed form here, as it is everywhere else
    expect(forms(pts)).toEqual([[MINUS + '1', '1'], ['1', '1']])
  })

  it('x² and the line y = 2 meet at ±√2, and the point IS ±√2', () => {
    const pts = intersectionPoints(
      named('f', 'poly2', [0, 0, 1]),
      named('two', 'line', [2, 0]),
      MODELS,
      [-5, 5],
    )
    expect(forms(pts)).toEqual([[MINUS + RT + '2', '2'], [RT + '2', '2']])
    expect(pts[0].pos.x).toBe(-Math.SQRT2)
    expect(pts[1].pos.x).toBe(Math.SQRT2)
    expect(pts.map(p => p.pos.y)).toEqual([2, 2])
  })

  it('sin x and cos x meet at π/4 and 5π/4 on [0, 2π]', () => {
    const s = typedCurve('s', 'y = sin(x)')
    const c = typedCurve('c', 'y = cos(x)')
    const models = { ...s.models, ...c.models }
    const pts = intersectionPoints(s.c, c.c, models, [0, 2 * Math.PI])
    expect(pts).toHaveLength(2)
    expect(forms(pts)).toEqual([
      [PI + '/4', RT + '2/2'],
      ['5' + PI + '/4', MINUS + RT + '2/2'],
    ])
    expect(pts[0].pos.x).toBe(Math.PI / 4)
    expect(pts[1].pos.x).toBe((5 * Math.PI) / 4)
    expect(pts[0].pos.y).toBeCloseTo(Math.SQRT1_2, 15)
    // nothing here was solved: sin − cos was scanned
    expect(pts.every(p => p.exact === false)).toBe(true)
    // the library sinusoids reach the same two points
    const fam = intersectionPoints(
      named('a', 'sine', [1, 1, 0, 0]),
      named('b', 'sine', [1, 1, Math.PI / 2, 0]),
      MODELS,
      [0, 2 * Math.PI],
    )
    expect(forms(fam)).toEqual(forms(pts))
  })

  it('x² and x meet at (0, 0) and (1, 1)', () => {
    const pts = intersectionPoints(
      named('f', 'poly2', [0, 0, 1]),
      named('g', 'line', [0, 1]),
      MODELS,
      [-5, 5],
    )
    expect(pts.map(xy)).toEqual([[0, 0], [1, 1]])
    expect(forms(pts)).toEqual([['0', '0'], ['1', '1']])
    expect(pts.every(p => p.exact)).toBe(true)
  })

  it('x² and x² − 1 never meet', () => {
    expect(
      intersectionPoints(
        named('f', 'poly2', [0, 0, 1]),
        named('g', 'poly2', [-1, 0, 1]),
        MODELS,
        [-5, 5],
      ),
    ).toEqual([])
    // and neither does a curve with itself: "everywhere" is not a list of points
    const f = named('f', 'poly2', [0, 0, 1])
    expect(intersectionPoints(f, { ...f, id: 'copy' }, MODELS, [-5, 5])).toEqual([])
  })

  it('x³ and x meet three times, crossing every time', () => {
    const pts = intersectionPoints(
      named('f', 'poly3', [0, 0, 0, 1]),
      named('g', 'line', [0, 1]),
      MODELS,
      [-5, 5],
    )
    expect(pts.map(xy)).toEqual([[-1, -1], [0, 0], [1, 1]])
    expect(forms(pts)).toEqual([
      [MINUS + '1', MINUS + '1'], ['0', '0'], ['1', '1'],
    ])
    expect(pts.some(p => p.tangent)).toBe(false)
    // a cubic difference has no formula behind it, whatever its roots look like
    expect(pts.every(p => p.exact === false)).toBe(true)
  })

  it('(x − 1)² meets the x-axis once, and is flagged a tangency', () => {
    const p = typedCurve('p', 'y = (x-1)^2')
    const z = typedCurve('z', 'y = 0')
    const pts = intersectionPoints(p.c, z.c, { ...p.models, ...z.models }, [-5, 5])
    expect(pts).toHaveLength(1)
    expect(xy(pts[0])).toEqual([1, 0])
    expect(pts[0].tangent).toBe(true)
    expect(pts[0].exactX).toBe('1')
    expect(pts[0].withId).toBe('z')
    // the same pair as library families: touched, and solved for
    const fam = intersectionPoints(
      named('f', 'poly2', [1, -2, 1]),
      named('axis', 'line', [0, 0]),
      MODELS,
      [-5, 5],
    )
    expect(fam).toHaveLength(1)
    expect(fam[0].tangent).toBe(true)
    expect(fam[0].exact).toBe(true)
  })

  it('1/x and x meet at ∓1 and never at the pole', () => {
    const pts = intersectionPoints(
      named('f', 'recip', [1, 0, 0]),
      named('g', 'line', [0, 1]),
      MODELS,
      [-3, 3],
    )
    expect(pts.map(xy)).toEqual([[-1, -1], [1, 1]])
    expect(pts.some(p => Math.abs(p.pos.x) < 0.5)).toBe(false)
    expect(forms(pts)).toEqual([[MINUS + '1', MINUS + '1'], ['1', '1']])
  })

  it('a meeting off the end of a restricted curve is not a meeting', () => {
    const f = named('f', 'poly2', [0, 0, 1])
    // x and x² meet at 0 and 1; the line only exists from x = 0.5
    expect(
      intersectionPoints(f, named('g', 'line', [0, 1], [0.5, 4]), MODELS, [-5, 5])
        .map(xy),
    ).toEqual([[1, 1]])
    // a typed curve carrying its own domain clips the same way
    const half = typedCurve('h', 'y = x', [-4, 0.5])
    expect(
      intersectionPoints(f, half.c, { ...MODELS, ...half.models }, [-5, 5]).map(xy),
    ).toEqual([[0, 0]])
    // and so does the range itself
    expect(
      intersectionPoints(f, named('g', 'line', [0, 1]), MODELS, [-5, 0.5]).map(xy),
    ).toEqual([[0, 0]])
  })

  it('a curve that is not a function of x is met in the plane (see below)', () => {
    // Once refused outright — which is why a sketched circle and parabola
    // showed no crossings. The plane solver now answers these pairs.
    const f = named('f', 'poly2', [0, 0, 1])
    expect(intersectionPoints(f, named('c', 'circle', [0, 0, 2]), MODELS, [-4, 4])).toHaveLength(2)
    expect(intersectionPoints(named('c', 'circle', [0, 0, 2]), f, MODELS, [-4, 4])).toHaveLength(2)
    expect(intersectionPoints(f, named('r', 'polarRose', [2, 3, 0]), MODELS, [-4, 4]).length).toBeGreaterThan(0)
    // a NaN parameter says nothing
    expect(intersectionPoints(f, named('g', 'line', [Number.NaN, 1]), MODELS, [-4, 4])).toEqual([])
    expect(intersectionPoints(f, named('c', 'circle', [0, Number.NaN, 2]), MODELS, [-4, 4])).toEqual([])
  })

  it('every reported point really is shared by both curves', () => {
    const f = typedCurve('f', 'y = sin(x)*e^(x/3) + x^2')
    const g = typedCurve('g', 'y = 0.5x^2 + 2')
    const models = { ...f.models, ...g.models }
    const F = models.expr_f.evalExplicit!
    const G = models.expr_g.evalExplicit!
    const pts = intersectionPoints(f.c, g.c, models, [-10, 10])
    expect(pts.length).toBeGreaterThan(0)
    for (const p of pts) {
      expect(p.pos.y).toBeCloseTo(F(f.c.params, p.pos.x), 9)
      expect(p.pos.y).toBeCloseTo(G(g.c.params, p.pos.x), 9)
      // sketched curves crossing at nothing in particular: no invented forms
      expect(p.exactX).toBeUndefined()
    }
  })

  it('a pair of typed expressions is intersected in under 2ms', () => {
    const f = typedCurve('f', 'y = sin(x)*e^(x/3) + x^2')
    const g = typedCurve('g', 'y = 0.5x^2 + 2')
    const models = { ...f.models, ...g.models }
    for (let i = 0; i < 5; i++) intersectionPoints(f.c, g.c, models, [-10, 10])
    let best = Infinity
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now()
      intersectionPoints(f.c, g.c, models, [-10, 10])
      best = Math.min(best, performance.now() - t0)
    }
    expect(best, `took ${best.toFixed(3)}ms`).toBeLessThan(2)
  })
})

// ---------------------------------------------------------------------------
// Intersections in the plane — circles, typed conics, polar and parametric
// curves. A sketched circle fits the implicit `circle` family and a typed
// x² + y² = 25 is an implicit expression; neither is a function of x, and the
// teacher's report was exactly that pair: "I sketched a circle and a parabola,
// their intersection points were not viewed."
// ---------------------------------------------------------------------------

describe('intersectionPoints — in the plane', () => {
  const MINUS = '−'
  const RT = '√'
  const named = (
    id: string,
    modelId: string,
    params: number[],
    domain: [number, number] | null = null,
  ): FittedCurve => ({ ...curve(modelId, params, domain), id })

  function typed(id: string, src: string): { c: FittedCurve; models: Record<string, ModelSpec> } {
    const r = parseExpression(src)
    if (!r.ok) throw new Error(`expected "${src}" to parse, got: ${r.error}`)
    const modelId = `expr_${id}`
    return {
      c: { ...curve(modelId, r.plot.defaultParams, r.plot.domain), id, kind: r.plot.kind },
      models: { [modelId]: r.plot.makeModel(modelId) },
    }
  }
  function pair(a: string, b: string, range: [number, number] = [-10, 10]): SpecialPoint[] {
    const A = typed('a', a)
    const B = typed('b', b)
    return intersectionPoints(A.c, B.c, { ...MODELS, ...A.models, ...B.models }, range)
  }
  const xy = (p: SpecialPoint) => [p.pos.x, p.pos.y]
  const forms = (ps: SpecialPoint[]) => ps.map(p => [p.exactX, p.exactY])

  it('x² + y² = 25 and y = x² − 5 meet at (−3, 4), (0, −5), (3, 4), exactly', () => {
    const pts = pair('x^2 + y^2 = 25', 'y = x^2 - 5')
    expect(pts.map(xy)).toEqual([[-3, 4], [0, -5], [3, 4]])
    expect(forms(pts)).toEqual([[MINUS + '3', '4'], ['0', MINUS + '5'], ['3', '4']])
    for (const p of pts) {
      expect(p.kind).toBe('intersection')
      expect(p.label).toBe('intersection')
      expect(p.withId).toBe('b')
    }
    // the vertex sits on the circle's lowest point from inside: a touch
    expect(pts.map(p => p.tangent === true)).toEqual([false, true, false])
    // the same answer asked from the parabola's side
    const rev = pair('y = x^2 - 5', 'x^2 + y^2 = 25')
    expect(rev.map(xy)).toEqual([[-3, 4], [0, -5], [3, 4]])
    expect(rev.every(p => p.withId === 'b')).toBe(true)
  })

  it('x² + y² = 4 and y = x + 2 meet at (−2, 0) and (0, 2)', () => {
    const pts = pair('x^2 + y^2 = 4', 'y = x + 2')
    expect(pts.map(xy)).toEqual([[-2, 0], [0, 2]])
    expect(forms(pts)).toEqual([[MINUS + '2', '0'], ['0', '2']])
    expect(pts.some(p => p.tangent)).toBe(false)
  })

  it('x² + y² = 1 and y = 1 touch once, at (0, 1)', () => {
    const pts = pair('x^2 + y^2 = 1', 'y = 1')
    expect(pts).toHaveLength(1)
    expect(xy(pts[0])).toEqual([0, 1])
    expect(pts[0].tangent).toBe(true)
    expect(forms(pts)).toEqual([['0', '1']])
  })

  it('(x − 1)² + y² = 4 and (x + 1)² + y² = 4 meet at (0, ±√3)', () => {
    const pts = pair('(x-1)^2 + y^2 = 4', '(x+1)^2 + y^2 = 4')
    expect(pts).toHaveLength(2)
    expect(forms(pts)).toEqual([['0', MINUS + RT + '3'], ['0', RT + '3']])
    expect(pts[0].pos.y).toBe(-Math.sqrt(3))
    expect(pts[1].pos.y).toBe(Math.sqrt(3))
    // the sketched version: two circle-family fits
    const fam = intersectionPoints(
      named('a', 'circle', [1, 0, 2]), named('b', 'circle', [-1, 0, 2]), MODELS, [-10, 10],
    )
    expect(forms(fam)).toEqual(forms(pts))
  })

  it('a sketched circle [0, 0, 3] and a fitted parabola y = x² − 3', () => {
    // the teacher's report: a circle-family fit and a poly2 fit
    const pts = intersectionPoints(
      named('c', 'circle', [0, 0, 3]), named('p', 'poly2', [-3, 0, 1]), MODELS, [-10, 10],
    )
    // x² + (x² − 3)² = 9  ->  x²(x² − 5) = 0
    expect(pts.map(xy)).toEqual([[-Math.sqrt(5), 2], [0, -3], [Math.sqrt(5), 2]])
    expect(forms(pts)).toEqual([[MINUS + RT + '5', '2'], ['0', MINUS + '3'], [RT + '5', '2']])
    expect(pts[1].tangent).toBe(true)
    expect(pts.every(p => p.withId === 'p')).toBe(true)
    // and a sketch that meets it nowhere in particular gets no invented forms
    const odd = intersectionPoints(
      named('c', 'circle', [0.31, -0.23, 2.71]), named('p', 'poly2', [-2.1, 0.13, 0.93]),
      MODELS, [-10, 10],
    )
    expect(odd).toHaveLength(2)
    for (const p of odd) {
      expect(p.exactX).toBeUndefined()
      expect(Math.hypot(p.pos.x - 0.31, p.pos.y + 0.23)).toBeCloseTo(2.71, 10)
      expect(p.pos.y).toBeCloseTo(-2.1 + 0.13 * p.pos.x + 0.93 * p.pos.x ** 2, 10)
    }
  })

  it('an ellipse-family general conic and a line', () => {
    // x² + 4y² = 4 and y = x/2 -> x = ±√2
    const E = named('e', 'ellipse', [1, 0, 4, 0, 0, -4])
    const pts = intersectionPoints(E, named('l', 'line', [0, 0.5]), MODELS, [-10, 10])
    expect(forms(pts)).toEqual([[MINUS + RT + '2', MINUS + RT + '2/2'], [RT + '2', RT + '2/2']])
    expect(pts[1].pos.x).toBe(Math.SQRT2)
    // and a circle crossing it: x² + y² = 4 meets x² + 4y² = 9 four times
    const four = intersectionPoints(
      named('c', 'circle', [0, 0, 2]), named('e', 'ellipse', [1, 0, 4, 0, 0, -9]), MODELS, [-10, 10],
    )
    expect(four).toHaveLength(4)
    expect(four.map(p => p.exactY)).toEqual([
      MINUS + RT + '15/3', RT + '15/3', MINUS + RT + '15/3', RT + '15/3',
    ])
  })

  it('r = 1 + cos θ and r = 1 meet at (0, ±1), and not at the pole', () => {
    const pts = pair('r = 1 + cos(theta)', 'r = 1')
    expect(forms(pts)).toEqual([['0', MINUS + '1'], ['0', '1']])
    expect(pts.map(xy)).toEqual([[0, -1], [0, 1]])
  })

  it('r = sin θ and r = cos θ meet at (1/2, 1/2) AND at the pole', () => {
    // the AP pitfall: solving sin θ = cos θ finds only θ = π/4; the pole is
    // reached by each curve at a DIFFERENT θ (0 and π/2) and is shared too
    const pts = pair('r = sin(theta)', 'r = cos(theta)')
    expect(pts.map(xy)).toEqual([[0, 0], [0.5, 0.5]])
    expect(forms(pts)).toEqual([['0', '0'], ['1/2', '1/2']])
  })

  it('the unit circle (cos t, sin t) meets y = x at (±√2/2, ±√2/2)', () => {
    const pts = pair('(cos(t), sin(t))', 'y = x')
    expect(forms(pts)).toEqual([
      [MINUS + RT + '2/2', MINUS + RT + '2/2'],
      [RT + '2/2', RT + '2/2'],
    ])
    expect(pts[1].pos.x).toBe(Math.SQRT1_2)
  })

  it('curves that do not meet report nothing', () => {
    expect(intersectionPoints(
      named('a', 'circle', [0, 0, 1]), named('b', 'circle', [5, 0, 1]), MODELS, [-10, 10],
    )).toEqual([])
    expect(intersectionPoints(
      named('a', 'circle', [0, 0, 1]), named('b', 'poly2', [3, 0, 1]), MODELS, [-10, 10],
    )).toEqual([])
    expect(pair('x^2 + y^2 = 1', 'y = 1.01')).toEqual([])
    expect(pair('r = 1', 'r = 3')).toEqual([])
    expect(pair('(cos(t), sin(t))', 'y = x^2 + 2')).toEqual([])
    // and a curve lying along another is not a list of points
    const T = typed('t', 'x^2 + y^2 = 4')
    expect(intersectionPoints(T.c, named('c', 'circle', [0, 0, 2]), { ...MODELS, ...T.models }, [-10, 10]))
      .toEqual([])
    expect(pair('(2cos(t), 2sin(t))', 'r = 2')).toEqual([])
  })

  it('a meeting off the range or outside a domain is not a meeting', () => {
    // x² + y² = 25 and y = x² − 5 again, with the range stopping at x = 1
    const pts = pair('x^2 + y^2 = 25', 'y = x^2 - 5', [-10, 1])
    expect(pts.map(xy)).toEqual([[-3, 4], [0, -5]])
    // a parabola restricted to x ≥ 1
    const c = named('c', 'circle', [0, 0, 3])
    expect(
      intersectionPoints(c, named('p', 'poly2', [-3, 0, 1], [1, 5]), MODELS, [-10, 10]).map(xy),
    ).toEqual([[Math.sqrt(5), 2]])
    // half of the unit circle: t in [0, π] never reaches y = −x in the lower half
    const half = intersectionPoints(
      { ...named('h', 'fourier', [0, 0, 1, 0, 0, 1]), domain: [0, Math.PI] },
      named('l', 'line', [0, -1]),
      MODELS, [-10, 10],
    )
    expect(forms(half)).toEqual([[MINUS + RT + '2/2', RT + '2/2']])
  })

  it('tangent circles touch once', () => {
    const pts = intersectionPoints(
      named('a', 'circle', [0, 0, 1]), named('b', 'circle', [1.2, 1.6, 1]), MODELS, [-10, 10],
    )
    expect(pts).toHaveLength(1)
    expect(forms(pts)).toEqual([['3/5', '4/5']])
    expect(pts[0].tangent).toBe(true)
  })

  it('every point really is on both curves', () => {
    const rose = named('r', 'polarRose', [2, 3, 0])
    const circ = named('c', 'circle', [0, 0, 1])
    const pts = intersectionPoints(rose, circ, MODELS, [-10, 10])
    expect(pts).toHaveLength(6)
    for (const p of pts) expect(Math.hypot(p.pos.x, p.pos.y)).toBeCloseTo(1, 12)
  })

  it('a circle and a parabola are intersected in under 3ms, two circles in under 5ms', () => {
    const best = (fn: () => void) => {
      for (let i = 0; i < 5; i++) fn()
      let b = Infinity
      for (let k = 0; k < 5; k++) {
        const t0 = performance.now()
        fn()
        b = Math.min(b, performance.now() - t0)
      }
      return b
    }
    const C = typed('c', 'x^2 + y^2 = 25')
    const P = typed('p', 'y = x^2 - 5')
    const D = typed('d', '(x-1)^2 + y^2 = 4')
    const m = { ...MODELS, ...C.models, ...P.models, ...D.models }
    const cp = best(() => intersectionPoints(C.c, P.c, m, [-16, 16]))
    expect(cp, `circle × parabola took ${cp.toFixed(3)}ms`).toBeLessThan(3)
    const cc = best(() => intersectionPoints(C.c, D.c, m, [-16, 16]))
    expect(cc, `circle × circle took ${cc.toFixed(3)}ms`).toBeLessThan(5)
    const fam = best(() => intersectionPoints(
      named('a', 'circle', [0, 0, 3]), named('b', 'poly2', [-3, 0, 1]), MODELS, [-16, 16],
    ))
    expect(fam, `fitted circle × parabola took ${fam.toFixed(3)}ms`).toBeLessThan(3)
  })

  it('two explicit curves give byte-for-byte what they gave before the plane solver', () => {
    type Side = { fam: string; params: number[]; domain?: [number, number] } | { src: string }
    const PAIRS: [Side, Side, [number, number]][] = [
      [{ fam: 'poly2', params: [0, 0, 1] }, { fam: 'poly2', params: [2, 0, -1] }, [-5, 5]],
      [{ fam: 'poly2', params: [0, 0, 1] }, { fam: 'line', params: [2, 0] }, [-5, 5]],
      [{ src: 'y = sin(x)' }, { src: 'y = cos(x)' }, [0, 2 * Math.PI]],
      [{ fam: 'sine', params: [1, 1, 0, 0] }, { fam: 'sine', params: [1, 1, Math.PI / 2, 0] }, [0, 2 * Math.PI]],
      [{ fam: 'poly2', params: [0, 0, 1] }, { fam: 'line', params: [0, 1] }, [-5, 5]],
      [{ fam: 'poly3', params: [0, 0, 0, 1] }, { fam: 'line', params: [0, 1] }, [-5, 5]],
      [{ src: 'y = (x-1)^2' }, { src: 'y = 0' }, [-5, 5]],
      [{ fam: 'poly2', params: [1, -2, 1] }, { fam: 'line', params: [0, 0] }, [-5, 5]],
      [{ fam: 'recip', params: [1, 0, 0] }, { fam: 'line', params: [0, 1] }, [-3, 3]],
      [{ fam: 'poly2', params: [0, 0, 1] }, { fam: 'line', params: [0, 1], domain: [0.5, 4] }, [-5, 5]],
      [{ src: 'y = sin(x)*e^(x/3) + x^2' }, { src: 'y = 0.5x^2 + 2' }, [-10, 10]],
      [{ src: 'y = e^x' }, { src: 'y = 3 - x^2' }, [-8, 8]],
      [{ src: 'y = ln(x)' }, { src: 'y = x - 2' }, [-8, 8]],
      [{ fam: 'exp', params: [1, 1, 0] }, { fam: 'poly3', params: [1, -2, 0, 0.5] }, [-6, 6]],
    ]
    const build = (s: Side, id: string, models: Record<string, ModelSpec>): FittedCurve => {
      if ('fam' in s) return { ...named(id, s.fam, s.params, s.domain ?? null), error: 0 }
      const t = typed(id, s.src)
      Object.assign(models, t.models)
      return { ...t.c, domain: null, error: 0 }
    }
    const got = PAIRS.map(([a, b, range]) => {
      const models: Record<string, ModelSpec> = { ...MODELS }
      const A = build(a, 'a', models)
      const B = build(b, 'b', models)
      return [intersectionPoints(A, B, models, range), intersectionPoints(B, A, models, range)]
    })
    expect(JSON.stringify(got)).toBe(EXPLICIT_SNAPSHOT)
  })
})

/** intersectionPoints on explicit pairs, recorded before the plane solver. */
const EXPLICIT_SNAPSHOT = '[[[{"kind":"intersection","pos":{"x":-1,"y":1},"label":"intersection","exact":true,"withId":"b","exactX":"−1","exactY":"1"},{"kind":"intersection","pos":{"x":1,"y":1},"label":"intersection","exact":true,"withId":"b","exactX":"1","exactY":"1"}],[{"kind":"intersection","pos":{"x":-1,"y":1},"label":"intersection","exact":true,"withId":"a","exactX":"−1","exactY":"1"},{"kind":"intersection","pos":{"x":1,"y":1},"label":"intersection","exact":true,"withId":"a","exactX":"1","exactY":"1"}]],[[{"kind":"intersection","pos":{"x":-1.4142135623730951,"y":2},"label":"intersection","exact":true,"withId":"b","exactX":"−√2","exactY":"2"},{"kind":"intersection","pos":{"x":1.4142135623730951,"y":2},"label":"intersection","exact":true,"withId":"b","exactX":"√2","exactY":"2"}],[{"kind":"intersection","pos":{"x":-1.4142135623730951,"y":2},"label":"intersection","exact":true,"withId":"a","exactX":"−√2","exactY":"2"},{"kind":"intersection","pos":{"x":1.4142135623730951,"y":2},"label":"intersection","exact":true,"withId":"a","exactX":"√2","exactY":"2"}]],[[{"kind":"intersection","pos":{"x":0.7853981633974483,"y":0.7071067811865476},"label":"intersection","exact":false,"withId":"b","exactX":"π/4","exactY":"√2/2"},{"kind":"intersection","pos":{"x":3.9269908169872414,"y":-0.7071067811865476},"label":"intersection","exact":false,"withId":"b","exactX":"5π/4","exactY":"−√2/2"}],[{"kind":"intersection","pos":{"x":0.7853981633974483,"y":0.7071067811865476},"label":"intersection","exact":false,"withId":"a","exactX":"π/4","exactY":"√2/2"},{"kind":"intersection","pos":{"x":3.9269908169872414,"y":-0.7071067811865476},"label":"intersection","exact":false,"withId":"a","exactX":"5π/4","exactY":"−√2/2"}]],[[{"kind":"intersection","pos":{"x":0.7853981633974483,"y":0.7071067811865476},"label":"intersection","exact":false,"withId":"b","exactX":"π/4","exactY":"√2/2"},{"kind":"intersection","pos":{"x":3.9269908169872414,"y":-0.7071067811865476},"label":"intersection","exact":false,"withId":"b","exactX":"5π/4","exactY":"−√2/2"}],[{"kind":"intersection","pos":{"x":0.7853981633974483,"y":0.7071067811865476},"label":"intersection","exact":false,"withId":"a","exactX":"π/4","exactY":"√2/2"},{"kind":"intersection","pos":{"x":3.9269908169872414,"y":-0.7071067811865476},"label":"intersection","exact":false,"withId":"a","exactX":"5π/4","exactY":"−√2/2"}]],[[{"kind":"intersection","pos":{"x":0,"y":0},"label":"intersection","exact":true,"withId":"b","exactX":"0","exactY":"0"},{"kind":"intersection","pos":{"x":1,"y":1},"label":"intersection","exact":true,"withId":"b","exactX":"1","exactY":"1"}],[{"kind":"intersection","pos":{"x":0,"y":0},"label":"intersection","exact":true,"withId":"a","exactX":"0","exactY":"0"},{"kind":"intersection","pos":{"x":1,"y":1},"label":"intersection","exact":true,"withId":"a","exactX":"1","exactY":"1"}]],[[{"kind":"intersection","pos":{"x":-1,"y":-1},"label":"intersection","exact":false,"withId":"b","exactX":"−1","exactY":"−1"},{"kind":"intersection","pos":{"x":0,"y":0},"label":"intersection","exact":false,"withId":"b","exactX":"0","exactY":"0"},{"kind":"intersection","pos":{"x":1,"y":1},"label":"intersection","exact":false,"withId":"b","exactX":"1","exactY":"1"}],[{"kind":"intersection","pos":{"x":-1,"y":-1},"label":"intersection","exact":false,"withId":"a","exactX":"−1","exactY":"−1"},{"kind":"intersection","pos":{"x":0,"y":0},"label":"intersection","exact":false,"withId":"a","exactX":"0","exactY":"0"},{"kind":"intersection","pos":{"x":1,"y":1},"label":"intersection","exact":false,"withId":"a","exactX":"1","exactY":"1"}]],[[{"kind":"intersection","pos":{"x":1,"y":0},"label":"intersection","exact":false,"withId":"b","tangent":true,"exactX":"1","exactY":"0"}],[{"kind":"intersection","pos":{"x":1,"y":0},"label":"intersection","exact":false,"withId":"a","tangent":true,"exactX":"1","exactY":"0"}]],[[{"kind":"intersection","pos":{"x":1,"y":0},"label":"intersection","exact":true,"withId":"b","tangent":true,"exactX":"1","exactY":"0"}],[{"kind":"intersection","pos":{"x":1,"y":0},"label":"intersection","exact":true,"withId":"a","tangent":true,"exactX":"1","exactY":"0"}]],[[{"kind":"intersection","pos":{"x":-1,"y":-1},"label":"intersection","exact":false,"withId":"b","exactX":"−1","exactY":"−1"},{"kind":"intersection","pos":{"x":1,"y":1},"label":"intersection","exact":false,"withId":"b","exactX":"1","exactY":"1"}],[{"kind":"intersection","pos":{"x":-1,"y":-1},"label":"intersection","exact":false,"withId":"a","exactX":"−1","exactY":"−1"},{"kind":"intersection","pos":{"x":1,"y":1},"label":"intersection","exact":false,"withId":"a","exactX":"1","exactY":"1"}]],[[{"kind":"intersection","pos":{"x":1,"y":1},"label":"intersection","exact":true,"withId":"b","exactX":"1","exactY":"1"}],[{"kind":"intersection","pos":{"x":1,"y":1},"label":"intersection","exact":true,"withId":"a","exactX":"1","exactY":"1"}]],[[{"kind":"intersection","pos":{"x":-2.1878409924227546,"y":4.393324104062691},"label":"intersection","exact":false,"withId":"b"},{"kind":"intersection","pos":{"x":1.1498054663679602,"y":2.661026305244821},"label":"intersection","exact":false,"withId":"b"}],[{"kind":"intersection","pos":{"x":-2.1878409924227546,"y":4.3933241040626925},"label":"intersection","exact":false,"withId":"a"},{"kind":"intersection","pos":{"x":1.1498054663679602,"y":2.661026305244821},"label":"intersection","exact":false,"withId":"a"}]],[[{"kind":"intersection","pos":{"x":-1.677232708532538,"y":0.18689044142860645},"label":"intersection","exact":false,"withId":"b"},{"kind":"intersection","pos":{"x":0.8344868653087588,"y":2.3036316716271616},"label":"intersection","exact":false,"withId":"b"}],[{"kind":"intersection","pos":{"x":-1.677232708532538,"y":0.1868904414286061},"label":"intersection","exact":false,"withId":"a"},{"kind":"intersection","pos":{"x":0.8344868653087588,"y":2.303631671627161},"label":"intersection","exact":false,"withId":"a"}]],[[{"kind":"intersection","pos":{"x":0.15859433956303937,"y":-1.8414056604369606},"label":"intersection","exact":false,"withId":"b"},{"kind":"intersection","pos":{"x":3.1461932206205825,"y":1.1461932206205825},"label":"intersection","exact":false,"withId":"b"}],[{"kind":"intersection","pos":{"x":0.15859433956303937,"y":-1.8414056604369606},"label":"intersection","exact":false,"withId":"a"},{"kind":"intersection","pos":{"x":3.1461932206205825,"y":1.1461932206205825},"label":"intersection","exact":false,"withId":"a"}]],[[{"kind":"intersection","pos":{"x":-2.193211046525917,"y":0.11155795509013167},"label":"intersection","exact":false,"withId":"b"},{"kind":"intersection","pos":{"x":0,"y":1},"label":"intersection","exact":false,"withId":"b","exactX":"0","exactY":"1"}],[{"kind":"intersection","pos":{"x":-2.193211046525917,"y":0.11155795509013067},"label":"intersection","exact":false,"withId":"a"},{"kind":"intersection","pos":{"x":0,"y":1},"label":"intersection","exact":false,"withId":"a","exactX":"0","exactY":"1"}]]]'

// ---------------------------------------------------------------------------
// Steps, jumps and flat stretches.
//
// floor(x) is zero on the whole of [0, 1): the zero SET is an interval, and it
// used to come back as sixty "zeros" 1/60 apart, plus a "minimum" at the foot
// of every stair. A constant stretch is reported once, as an interval
// (zeroIntervals), and carries no zeros, extrema or inflections inside it; a
// jump cuts the scans like a pole does, so nothing is bracketed across it.
// ---------------------------------------------------------------------------

describe('analyzeCurve — steps, jumps and flat stretches', () => {
  function typed(src: string, domain?: [number, number] | null) {
    const r = parseExpression(src)
    if (!r.ok) throw new Error(`expected "${src}" to parse, got: ${r.error}`)
    const spec = r.plot.makeModel('expr_step')
    const c: FittedCurve = {
      ...curve('expr_step', r.plot.defaultParams, domain === undefined ? r.plot.domain : domain),
      kind: r.plot.kind,
    }
    const models = { expr_step: spec }
    return { c, models, pts: analyzeCurve(c, models), zi: zeroIntervals(c, models) }
  }

  it('floor(x): one zero interval [0, 1), no point zeros, no extrema, no inflections', () => {
    const { pts, zi } = typed('y = floor(x)')
    expect(zi).toEqual([{ lo: 0, hi: 1, loClosed: true, hiClosed: false }])
    expect(of(pts, 'zero')).toEqual([])
    expect(of(pts, 'minimum')).toEqual([])
    expect(of(pts, 'maximum')).toEqual([])
    expect(of(pts, 'inflection')).toEqual([])
  })

  it('a zero constant on a restricted domain is one open interval', () => {
    const { pts, zi } = typed('y = 0 {0 < x < 3}')
    expect(zi).toEqual([{ lo: 0, hi: 3, loClosed: false, hiClosed: false }])
    expect(of(pts, 'zero')).toEqual([])
  })

  it('floor(x/2) is zero on [0, 2)', () => {
    const { pts, zi } = typed('y = floor(x/2)')
    expect(zi).toEqual([{ lo: 0, hi: 2, loClosed: true, hiClosed: false }])
    expect(of(pts, 'zero')).toEqual([])
    expect(of(pts, 'inflection')).toEqual([])
  })

  it('ceil(x) is zero on (−1, 0]', () => {
    const { pts, zi } = typed('y = ceil(x)')
    expect(zi).toEqual([{ lo: -1, hi: 0, loClosed: false, hiClosed: true }])
    expect(of(pts, 'zero')).toEqual([])
    expect(of(pts, 'minimum')).toEqual([])
    expect(of(pts, 'maximum')).toEqual([])
    expect(of(pts, 'inflection')).toEqual([])
  })

  it('floor(3x) ends its zero interval at exactly 1/3', () => {
    const { zi } = typed('y = floor(3x)')
    expect(zi).toEqual([{ lo: 0, hi: 1 / 3, loClosed: true, hiClosed: false }])
  })

  it('floor(x)² − 4 is zero on two intervals', () => {
    const { pts, zi } = typed('y = floor(x)^2 - 4')
    expect(zi).toEqual([
      { lo: -2, hi: -1, loClosed: true, hiClosed: false },
      { lo: 2, hi: 3, loClosed: true, hiClosed: false },
    ])
    expect(of(pts, 'zero')).toEqual([])
    expect(of(pts, 'inflection')).toEqual([])
  })

  it('sign(x): the single zero 0, no extremum at the jump, no inflection', () => {
    const { pts, zi } = typed('y = sign(x)')
    expect(zi).toEqual([])
    expect(xsOf(pts, 'zero')).toEqual([0])
    expect(of(pts, 'minimum')).toEqual([])
    expect(of(pts, 'maximum')).toEqual([])
    expect(of(pts, 'inflection')).toEqual([])
  })

  it('sign(x − 0.3): the zero AT a jump between samples is still found', () => {
    const { pts } = typed('y = sign(x - 0.3)')
    expect(xsOf(pts, 'zero')).toEqual([0.3])
    expect(of(pts, 'minimum')).toEqual([])
  })

  it('sign(sin x): a zero at EVERY multiple of π, not only 0 (exact value at the jump)', () => {
    const { pts, zi } = typed('y = sign(sin(x))', [-7, 7])
    expect(zi).toEqual([])
    const xs = xsOf(pts, 'zero')
    expect(xs).toHaveLength(5)
    for (const [i, k] of [-2, -1, 0, 1, 2].entries()) expect(xs[i]).toBeCloseTo(k * Math.PI, 12)
    expect(of(pts, 'minimum')).toEqual([])
    expect(of(pts, 'maximum')).toEqual([])
  })

  it('sign(cos x) at ±π/2 and sign(10x − 3) at 0.3 are zeros too', () => {
    const cos = xsOf(typed('y = sign(cos(x))', [-3, 3]).pts, 'zero')
    expect(cos).toHaveLength(2)
    expect(cos[0]).toBeCloseTo(-Math.PI / 2, 12)
    expect(cos[1]).toBeCloseTo(Math.PI / 2, 12)
    // 10 · 0.3 is 3.0000000000000004 in doubles
    expect(xsOf(typed('y = sign(10x - 3)', [0, 1]).pts, 'zero')).toEqual([0.3])
  })

  it('x − floor(x): isolated zeros at the integers, each a genuine minimum; no maxima', () => {
    const { pts, zi } = typed('y = x - floor(x)')
    expect(zi).toEqual([])
    const ints = Array.from({ length: 21 }, (_, k) => k - 10)
    expect(xsOf(pts, 'zero')).toEqual(ints)
    // f(k) = 0 below both sides; the window's own edges are not extrema
    expect(xsOf(pts, 'minimum')).toEqual(ints.slice(1, -1))
    expect(of(pts, 'maximum')).toEqual([]) // the sup 1 is never attained
    expect(of(pts, 'inflection')).toEqual([])
  })

  it('a jump riding on a steep stretch is still a jump: tan(x) + floor(x)', () => {
    const { pts } = typed('y = tan(x) + floor(x)')
    const infl = xsOf(pts, 'inflection')
    expect(infl.length).toBeGreaterThan(0)
    for (const x of infl) {
      // tan's own inflections at kπ, never a riser of floor
      expect(Math.abs(x / Math.PI - Math.round(x / Math.PI)), `inflection at ${x}`).toBeLessThan(1e-6)
    }
  })

  it('exactly zero, not merely small: x¹⁰ keeps its single tangent zero', () => {
    const { pts, zi } = typed('y = x^10', [-2, 2])
    expect(zi).toEqual([])
    const z = of(pts, 'zero')
    expect(z.length).toBe(1)
    expect(z[0].pos.x).toBeCloseTo(0, 6)
  })

  it('underflow is not a zero interval: e^(−1/x²)', () => {
    expect(typed('y = e^(-1/x^2)').zi).toEqual([])
  })

  it('zeroIntervals clips to the range it is given', () => {
    const { c, models } = typed('y = floor(x)')
    expect(zeroIntervals(c, models, [0.5, 5])).toEqual([{ lo: 0.5, hi: 1, loClosed: true, hiClosed: false }])
    expect(zeroIntervals(c, models, [2, 5])).toEqual([])
  })

  it('zeroIntervals is [] for curves that are not y = f(x), and for smooth ones', () => {
    expect(zeroIntervals(curve('circle', [0, 0, 2], null), MODELS)).toEqual([])
    expect(zeroIntervals(curve('poly3', [6, -5, -2, 1], [-4, 5]), MODELS)).toEqual([])
    expect(zeroIntervals(curve('sine', [1, 1, 0, 0], [-7, 7]), MODELS)).toEqual([])
  })

  it('a step function is analysed fast enough for every slider frame (< 2ms)', () => {
    for (const src of ['y = floor(x)', 'y = x - floor(x)', 'y = sign(x)']) {
      const { c, models } = typed(src)
      for (let i = 0; i < 20; i++) analyzeCurve(c, models)
      let ms = Infinity
      for (let round = 0; round < 5; round++) {
        const t0 = performance.now()
        for (let i = 0; i < 20; i++) analyzeCurve(c, models)
        ms = Math.min(ms, (performance.now() - t0) / 20)
      }
      expect(ms, `${src} took ${ms.toFixed(3)}ms`).toBeLessThan(2)
    }
  })
})

describe('analyzeCurve — no zero where a curve only approaches 0 at a pole', () => {
  it('e^(1/x): no zeros (its left branch tends to 0 as x → 0⁻, never reaching it)', () => {
    const r = parseExpression('y = e^(1/x)')
    if (!r.ok) throw new Error(r.error)
    const models = { m: r.plot.makeModel('m') }
    const c: FittedCurve = { ...curve('m', [], null), kind: 'explicit' }
    const zs = analyzeCurve(c, models).filter((p) => p.kind === 'zero')
    expect(zs).toEqual([])
  })
  it('√(4 − x²) still has its zeros at ±2, where its domain stops', () => {
    const r = parseExpression('y = sqrt(4 - x^2)')
    if (!r.ok) throw new Error(r.error)
    const models = { m: r.plot.makeModel('m') }
    const c: FittedCurve = { ...curve('m', [], null), kind: 'explicit' }
    const xs = analyzeCurve(c, models).filter((p) => p.kind === 'zero').map((p) => p.pos.x)
    expect(xs.length).toBe(2)
    expect(xs[0]).toBeCloseTo(-2, 9)
    expect(xs[1]).toBeCloseTo(2, 9)
  })
})

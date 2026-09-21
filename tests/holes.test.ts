// ============================================================================
// tests/holes.test.ts — removable discontinuities and vertical asymptotes
// (src/core/holes.ts, plus ModelSpec.singularities from src/core/parse).
//
// Every expected value is worked out by hand: (x²−1)/(x−1) IS x + 1 away from
// x = 1, so the hole is at (1, 2) and nowhere else. A teacher reads these
// numbers off the board in front of a class.
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { Asymptote, FittedCurve, ModelSpec } from '../src/core/types'
import { parseExpression } from '../src/core/parse'
import { MODELS } from '../src/core/fit/models'
import { findAsymptotes, findEndAsymptotes, findHoles, findPoles } from '../src/core/holes'
import { analyzeCurve } from '../src/core/analyze'
import { asymptoteTexts } from '../src/ui/CurveCard'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

interface Typed {
  curve: FittedCurve
  models: Record<string, ModelSpec>
  spec: ModelSpec
}

/** A typed expression, as the board holds it: one `expr_N` model and a curve. */
function typed(src: string, domain: [number, number] | null = null): Typed {
  const r = parseExpression(src)
  if (!r.ok) throw new Error(`expected "${src}" to parse, got: ${r.error}`)
  const spec = r.plot.makeModel('expr_1')
  const curve: FittedCurve = {
    id: 'test-curve',
    modelId: 'expr_1',
    params: r.plot.defaultParams,
    kind: r.plot.kind,
    domain: domain ?? r.plot.domain,
    color: '#4f9cf9',
    strokeWidth: 2.5,
    visible: true,
    error: 0,
  }
  return { curve, models: { expr_1: spec }, spec }
}

const holesOf = (src: string, range: [number, number] = [-10, 10]) => {
  const t = typed(src)
  return findHoles(t.curve, t.models, range)
}

const polesOf = (src: string, range: [number, number] = [-10, 10]) => {
  const t = typed(src)
  return findPoles(t.curve, t.models, range)
}

const singOf = (src: string, range: [number, number] = [-10, 10]) => {
  const t = typed(src)
  return t.spec.singularities!(t.curve.params, range)
}

const asymptotesOf = (src: string, range: [number, number] = [-10, 10]) => {
  const t = typed(src)
  return findAsymptotes(t.curve, t.models, range)
}

type Line = Extract<Asymptote, { kind: 'line' }>

/**
 * A line as (unit normal, distance from the origin), with the normal oriented
 * so that the distance is not negative. Two spellings of the same line — the
 * same set of points, walked either way round — come out identical, which is
 * what an assertion about "the line x = 1" wants to compare.
 */
function lineForm(l: Line): { nx: number; ny: number; d: number } {
  const len = Math.hypot(l.dir.x, l.dir.y)
  let nx = -l.dir.y / len
  let ny = l.dir.x / len
  let d = nx * l.a.x + ny * l.a.y
  if (d < 0) { nx = -nx; ny = -ny; d = -d }
  return { nx, ny, d }
}

/** Assert that `l` is the line through `d·(nx, ny)` perpendicular to (nx, ny). */
function expectLine(l: Asymptote | undefined, nx: number, ny: number, d: number, digits = 6) {
  expect(l?.kind).toBe('line')
  const f = lineForm(l as Line)
  expect(f.nx).toBeCloseTo(nx, digits)
  expect(f.ny).toBeCloseTo(ny, digits)
  expect(f.d).toBeCloseTo(d, digits)
}

const linesOf = (src: string) => asymptotesOf(src).filter((a): a is Line => a.kind === 'line')

/** The end lines of a typed curve, as the slope/intercept pairs they name. */
const endsOf = (src: string, domain: [number, number] | null = null) => {
  const t = typed(src, domain)
  return findEndAsymptotes(t.curve, t.models).map(asLine)
}

/** The end lines of a library curve, same reading. */
const libEnds = (modelId: string, params: number[], domain: [number, number] | null = null) =>
  findEndAsymptotes(libraryCurve(modelId, params, domain), MODELS).map(asLine)

/** y = m·x + b, read back out of the { a, dir } an Asymptote carries. */
function asLine(a: Asymptote): { m: number; b: number } {
  if (a.kind !== 'line') throw new Error(`expected a line, got ${a.kind}`)
  const m = a.dir.y / a.dir.x
  return { m, b: a.a.y - m * a.a.x }
}

function libraryCurve(
  modelId: string,
  params: number[],
  domain: [number, number] | null = null,
): FittedCurve {
  return {
    id: 'lib-curve',
    modelId,
    params,
    kind: MODELS[modelId].kind,
    domain,
    color: '#4f9cf9',
    strokeWidth: 2.5,
    visible: true,
    error: 0,
  }
}

// ---------------------------------------------------------------------------
// singularities — what the compiled expression knows about itself
// ---------------------------------------------------------------------------

describe('ModelSpec.singularities', () => {
  it('collects every denominator zero', () => {
    expect(singOf('y = (x-2)/((x-2)(x+1))')).toEqual([-1, 2])
  })

  it('finds a denominator that only TOUCHES zero', () => {
    // x² never changes sign, so a sign-change scan alone is blind to it
    expect(singOf('y = 1/x^2')).toEqual([0])
  })

  it('reads a negative power as the denominator it is', () => {
    expect(singOf('y = x^-2')).toEqual([0])
    expect(singOf('y = 2x^(-1) + 1')).toEqual([0])
  })

  it('solves tan for its own poles, not by watching it blow up', () => {
    const xs = singOf('y = tan(x)', [-5, 5])
    expect(xs).toHaveLength(4)
    const want = [-3 * Math.PI / 2, -Math.PI / 2, Math.PI / 2, 3 * Math.PI / 2]
    for (let i = 0; i < 4; i++) expect(xs[i]).toBeCloseTo(want[i], 12)
  })

  it('treats an explicit exclusion as a singularity, not only a note', () => {
    const t = typed('y = x^2 {x != 2}')
    expect(t.spec.latex([])).toContain('\\ne')      // still says so on the card
    expect(singOf('y = x^2 {x != 2}')).toEqual([2]) // and is a real singularity
  })

  it('gives a polynomial none, and stays inside the range it was asked about', () => {
    expect(singOf('y = x^3 - 3x')).toEqual([])
    expect(singOf('y = 1/x', [1, 10])).toEqual([])
  })

  it('a piecewise branch owns only the singularities inside its own set', () => {
    // 0 is where `1/x` stops being that branch's business, not a pole of it
    expect(singOf('y = { 1/x if x < 0 ; x if x >= 0 }')).toEqual([])
    expect(singOf('y = { 1/x if x != 0 }')).toEqual([0])
  })

  it('is carried by a polar plot too, read in θ — but never by an implicit one', () => {
    // r = 1/θ stops being a formula at θ = 0, exactly as y = 1/x does at x = 0.
    const polar = parseExpression('r = 1/theta')
    expect(polar.ok).toBe(true)
    if (!polar.ok) return
    expect(polar.plot.makeModel('e').singularities!([], [0, 2 * Math.PI])).toEqual([0])
    // An implicit plot has no one variable to scan, so it still answers nothing.
    const implicit = parseExpression('x^2 + y^2 = 4')
    expect(implicit.ok && implicit.plot.makeModel('e').singularities).toBeUndefined()
  })

  it('reads the argument of a logarithm as a singular sub-expression', () => {
    expect(singOf('y = ln(x)')).toEqual([0])
    expect(singOf('y = ln(x^2-4)')).toEqual([-2, 2])
    expect(singOf('y = ln(abs(x))')).toEqual([0])
    expect(singOf('y = x ln(x)')).toEqual([0])
  })

  it('every base of logarithm, since the base only scales it', () => {
    expect(singOf('y = log(x-1)')).toEqual([1])
    expect(singOf('y = log2(x+3)')).toEqual([-3])
    expect(singOf('y = log10(2x)')).toEqual([0])
  })

  it('a literal negative NON-integer exponent is a denominator too', () => {
    expect(singOf('y = x^-0.5')).toEqual([0])
    expect(singOf('y = (x-2)^(-1.5)')).toEqual([2])
  })
})

// ---------------------------------------------------------------------------
// logarithms
// ---------------------------------------------------------------------------

describe('logarithmic asymptotes', () => {
  it('ln(x) is a pole at 0 — it dives to −∞ on the only side it has', () => {
    // The ladder never sees 100× growth here: ln steps down by ln 10 ≈ 2.303
    // per rung, from −6.9 to −18.4 over the whole ladder. What gives it away
    // is that the step never shrinks.
    expect(polesOf('y = ln(x)')).toEqual([0])
    expect(holesOf('y = ln(x)')).toEqual([])
    expect(asymptotesOf('y = ln(x)')).toEqual([{ kind: 'vertical', x: 0 }])
  })

  it('ln(x² − 4) has poles at ±2, where its argument has zeros', () => {
    expect(polesOf('y = ln(x^2-4)')).toEqual([-2, 2])
    expect(holesOf('y = ln(x^2-4)')).toEqual([])
  })

  it('ln|x| is a pole at 0 from BOTH sides', () => {
    expect(polesOf('y = ln(abs(x))')).toEqual([0])
    expect(holesOf('y = ln(abs(x))')).toEqual([])
  })

  it('x·ln(x) is a HOLE at (0, 0), not a pole', () => {
    // x·ln(x) → 0: the product beats the logarithm. Only the right side of 0
    // exists at all, and it crawls — −6.9e-3, −9.2e-4, …, −1.8e-7 — so the
    // "last three values agree" test alone would miss it.
    const holes = holesOf('y = x ln(x)')
    expect(holes).toHaveLength(1)
    expect(holes[0].x).toBe(0)
    expect(holes[0].y).toBeCloseTo(0, 6)
    expect(polesOf('y = x ln(x)')).toEqual([])
    expect(asymptotesOf('y = x ln(x)')).toEqual([])
  })

  it('x·ln|x| is a hole at (0, 0) with both sides present', () => {
    const holes = holesOf('y = x ln(abs(x))')
    expect(holes).toHaveLength(1)
    expect(holes[0].x).toBe(0)
    expect(holes[0].y).toBeCloseTo(0, 6)
    expect(polesOf('y = x ln(abs(x))')).toEqual([])
  })

  it('log, log2 and log10 behave exactly as ln does', () => {
    for (const src of ['y = log(x)', 'y = log2(x)', 'y = log10(x)']) {
      expect(polesOf(src), src).toEqual([0])
      expect(holesOf(src), src).toEqual([])
    }
  })

  it('the two listings never disagree: a hole is never also a pole', () => {
    for (const src of [
      'y = ln(x)', 'y = ln(x^2-4)', 'y = ln(abs(x))', 'y = x ln(x)',
      'y = x ln(abs(x))', 'y = ln(x)/x', 'y = log2(x-1)', 'y = 1/ln(x)',
      'y = (x^2-1)/(x-1)', 'y = tan(x)', 'y = abs(x)/x', 'y = x^-0.5',
    ]) {
      const holes = holesOf(src)
      const poles = polesOf(src)
      for (const h of holes) {
        for (const p of poles) {
          expect(Math.abs(h.x - p), `${src}: ${h.x} is listed as both`)
            .toBeGreaterThan(1e-6)
        }
      }
      // and every VERTICAL asymptote of an explicit curve is one of the poles
      // (the list also carries whatever the two ends lean on: |x|/x really
      // does approach y = 1 to the right and y = −1 to the left)
      expect(asymptotesOf(src).filter(a => a.kind === 'vertical')
        .map(a => (a as { x: number }).x)).toEqual(poles)
    }
  })

  it('the library log family names its asymptote from its own parameters', () => {
    // a·ln(x − b) + c: the asymptote is x = b, read off the fit, not scanned for
    const c = libraryCurve('log', [2, -1, 3])
    expect(findPoles(c, MODELS, [-10, 10])).toEqual([-1])
    expect(findHoles(c, MODELS, [-10, 10])).toEqual([])
    expect(findAsymptotes(c, MODELS, [-10, 10])).toEqual([{ kind: 'vertical', x: -1 }])
    // only inside the range asked about
    expect(findPoles(c, MODELS, [0, 10])).toEqual([])
    // and a flat a = 0 is the line y = c, which has no asymptote to name
    expect(findPoles(libraryCurve('log', [0, -1, 3]), MODELS, [-10, 10])).toEqual([])
  })

  it('memoises: the same (params, range) is not scanned twice', () => {
    const t = typed('y = 1/((x-1)(x+3))')
    const a = t.spec.singularities!(t.curve.params, [-10, 10])
    const b = t.spec.singularities!(t.curve.params, [-10, 10])
    expect(b).toEqual(a)
    expect(b).not.toBe(a) // a copy, so a caller cannot poison the cache
  })
})

// ---------------------------------------------------------------------------
// holes
// ---------------------------------------------------------------------------

describe('findHoles', () => {
  it('(x² − 1)/(x − 1) has a hole at (1, 2) and no asymptote', () => {
    const holes = holesOf('y = (x^2-1)/(x-1)')
    expect(holes).toHaveLength(1)
    expect(holes[0].x).toBe(1)
    expect(holes[0].y).toBeCloseTo(2, 6)
    expect(polesOf('y = (x^2-1)/(x-1)')).toEqual([])
  })

  it('sin(x)/x has a hole at (0, 1)', () => {
    const holes = holesOf('y = sin(x)/x')
    expect(holes).toHaveLength(1)
    expect(holes[0].x).toBe(0)
    expect(holes[0].y).toBeCloseTo(1, 9)
    expect(polesOf('y = sin(x)/x')).toEqual([])
  })

  it('a hole whose limit is 0 is still a hole', () => {
    // (x − 1)²/(x − 1) = x − 1: the limit at x = 1 is 0, and 0 is a value like
    // any other. This is the case a "did the values stop changing?" test gets
    // wrong when its tolerance is relative to |f| alone.
    const holes = holesOf('y = (x-1)^2/(x-1)')
    expect(holes).toHaveLength(1)
    expect(holes[0].x).toBe(1)
    expect(holes[0].y).toBeCloseTo(0, 6)
  })

  it('x(x − 1)/(x − 1) has a hole at (1, 1)', () => {
    const holes = holesOf('y = x(x-1)/(x-1)')
    expect(holes).toHaveLength(1)
    expect(holes[0].x).toBe(1)
    expect(holes[0].y).toBeCloseTo(1, 6)
  })

  it('an explicit exclusion on a curve that is fine there is an EXACT hole', () => {
    const holes = holesOf('y = x^2 {x != 2}')
    expect(holes).toHaveLength(1)
    expect(holes[0].x).toBe(2)
    expect(holes[0].y).toBeCloseTo(4, 9)
    expect(holes[0].exact).toBe(true)
    expect(polesOf('y = x^2 {x != 2}')).toEqual([])
  })

  it('one factor cancels and one does not: a hole AND a pole', () => {
    // (x − 2)/((x − 2)(x + 1)) = 1/(x + 1) away from x = 2
    const holes = holesOf('y = (x-2)/((x-2)(x+1))')
    expect(holes).toHaveLength(1)
    expect(holes[0].x).toBe(2)
    expect(holes[0].y).toBeCloseTo(1 / 3, 6)
    expect(polesOf('y = (x-2)/((x-2)(x+1))')).toEqual([-1])
  })

  it('a JUMP is not a hole — and not an asymptote either', () => {
    // |x|/x steps from −1 to +1 at 0. Both one-sided limits exist and are
    // finite; they simply disagree. It belongs in neither list.
    expect(holesOf('y = abs(x)/x')).toEqual([])
    expect(polesOf('y = abs(x)/x')).toEqual([])
  })

  it('an ordinary polynomial has neither', () => {
    expect(holesOf('y = x^3 - 3x')).toEqual([])
    expect(polesOf('y = x^3 - 3x')).toEqual([])
  })

  it('never returns a NaN x or y', () => {
    for (const src of [
      'y = (x^2-1)/(x-1)', 'y = sin(x)/x', 'y = 1/x', 'y = 1/x^2',
      'y = abs(x)/x', 'y = tan(x)', 'y = sqrt(x)/x', 'y = 0/x',
      'y = 1/(x^2+1)', 'y = (x-1)/((x-1)^2)',
    ]) {
      for (const h of holesOf(src)) {
        expect(Number.isFinite(h.x), `${src} x`).toBe(true)
        expect(Number.isFinite(h.y), `${src} y`).toBe(true)
      }
      for (const p of polesOf(src)) expect(Number.isFinite(p), `${src} pole`).toBe(true)
    }
  })

  it('stays inside the curve’s own domain', () => {
    const t = typed('y = (x^2-1)/(x-1)', [2, 8])
    expect(findHoles(t.curve, t.models, [-10, 10])).toEqual([])
  })

  it('a candidate ON a declared domain end is neither hole nor pole', () => {
    // y = (x² − 1)/(x − 1) {−3 < x < 1} stops AT the discontinuity: only one
    // of its sides is on the graph, so there is no two-sided limit to have.
    // The open end cap is what says what happens there.
    const t = typed('y = (x^2-1)/(x-1)', [-3, 1])
    expect(findHoles(t.curve, t.models, [-10, 10])).toEqual([])
    expect(findPoles(t.curve, t.models, [-10, 10])).toEqual([])
    const p = typed('y = 1/x', [0, 5])
    expect(findPoles(p.curve, p.models, [-10, 10])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// poles
// ---------------------------------------------------------------------------

describe('findPoles', () => {
  it('1/x is a pole at 0 with no hole', () => {
    expect(polesOf('y = 1/x')).toEqual([0])
    expect(holesOf('y = 1/x')).toEqual([])
  })

  it('1/x² is a pole at 0 — the denominator only touches zero', () => {
    expect(polesOf('y = 1/x^2')).toEqual([0])
    expect(holesOf('y = 1/x^2')).toEqual([])
  })

  it('tan x has poles at ±π/2 and ±3π/2 on [−5, 5]', () => {
    const poles = polesOf('y = tan(x)', [-5, 5])
    expect(poles).toHaveLength(4)
    const want = [-3 * Math.PI / 2, -Math.PI / 2, Math.PI / 2, 3 * Math.PI / 2]
    for (let i = 0; i < 4; i++) expect(poles[i]).toBeCloseTo(want[i], 12)
    expect(holesOf('y = tan(x)', [-5, 5])).toEqual([])
  })

  it('the recip family answers from its own parameters', () => {
    // a/(x − b) + c: the pole is b, known in closed form, never sampled for
    const c = libraryCurve('recip', [2, 3, 1])
    expect(findPoles(c, MODELS, [-10, 10])).toEqual([3])
    expect(findHoles(c, MODELS, [-10, 10])).toEqual([])
    // and only when it is inside the range asked about
    expect(findPoles(c, MODELS, [-10, 0])).toEqual([])
  })

  it('every other library family has neither', () => {
    for (const [modelId, params] of [
      ['line', [1, 2]],
      ['poly2', [-6, -4, 2]],
      ['poly3', [6, -5, -2, 1]],
      ['sine', [2, 1, 0, 0]],
      ['exp', [1, 0.5, 0]],
      ['power', [1, 0, 0, 2]],
      ['abs', [1, 0, 0]],
      ['sqrt', [1, 0, 0]],
      ['logistic', [1, 1, 0, 0]],
    ] as const) {
      const c = libraryCurve(modelId, [...params])
      expect(findHoles(c, MODELS, [-10, 10]), modelId).toEqual([])
      expect(findPoles(c, MODELS, [-10, 10]), modelId).toEqual([])
    }
  })
})

// ---------------------------------------------------------------------------
// polar
// ---------------------------------------------------------------------------

describe('polar curves', () => {
  it('findPoles stays explicit-only — a slant line has no single x', () => {
    expect(polesOf('r = tan(theta)')).toEqual([])
    expect(polesOf('r = 1/theta')).toEqual([])
  })

  it('r = tan θ has the asymptotes x = 1 and x = −1', () => {
    // d = lim r·sin(θ − θ0) = lim tan θ·(−cos θ) = −sin θ = −1 at θ = π/2,
    // and −1 again at θ = 3π/2 — the same offset on the opposite ray.
    const lines = linesOf('r = tan(theta)')
    expect(lines).toHaveLength(2)
    expectLine(lines[0], 1, 0, 1)   // x = 1
    expectLine(lines[1], -1, 0, 1)  // x = −1
  })

  it('r = sec θ IS the line x = 1, and is still reported as approaching it', () => {
    // At θ = π/2 the curve runs to infinity ALONG itself. The asymptote and
    // the graph coincide; that is a true statement about the graph, and the
    // dashed line simply lands under the curve. The two escapes (θ = π/2 and
    // θ = 3π/2) name the same line and are listed once.
    const lines = linesOf('r = 1/cos(theta)')
    expect(lines).toHaveLength(1)
    expectLine(lines[0], 1, 0, 1)
    expect(holesOf('r = 1/cos(theta)')).toEqual([])
  })

  it('the hyperbolic spiral r = 1/θ approaches y = 1', () => {
    // θ = 0 is an END of the default turn, and it is still probed from both
    // sides: a θ window is a sweep, not a declared stop.
    const lines = linesOf('r = 1/theta')
    expect(lines).toHaveLength(1)
    expectLine(lines[0], 0, 1, 1)
  })

  it('r = 1/(θ − 1) is a line in direction 1 rad at offset 1', () => {
    const lines = linesOf('r = 1/(theta-1)')
    expect(lines).toHaveLength(1)
    expect(lines[0].dir.x).toBeCloseTo(Math.cos(1), 9)
    expect(lines[0].dir.y).toBeCloseTo(Math.sin(1), 9)
    expect(lines[0].a.x).toBeCloseTo(-Math.sin(1), 6)
    expect(lines[0].a.y).toBeCloseTo(Math.cos(1), 6)
    expectLine(lines[0], -Math.sin(1), Math.cos(1), 1)
  })

  it('r = sin(θ)/θ has a hole at the CARTESIAN point (1, 0)', () => {
    const holes = holesOf('r = sin(theta)/theta')
    expect(holes).toHaveLength(1)
    expect(holes[0].x).toBeCloseTo(1, 9)
    expect(holes[0].y).toBeCloseTo(0, 9)
    expect(holes[0].exact).toBe(true) // θ0 = 0 is a number somebody wrote
    expect(asymptotesOf('r = sin(theta)/theta')).toEqual([])
  })

  it('a rose has neither: nothing in r = 2cos(3θ) is ever undefined', () => {
    expect(holesOf('r = 2cos(3theta)')).toEqual([])
    expect(asymptotesOf('r = 2cos(3theta)')).toEqual([])
    expect(findHoles(libraryCurve('polarRose', [2, 3, 0]), MODELS, [-10, 10])).toEqual([])
    expect(findAsymptotes(libraryCurve('polarRose', [2, 3, 0]), MODELS, [-10, 10])).toEqual([])
  })

  it('a PARABOLIC escape has no line: r = 2/(1 − cos θ) is a parabola', () => {
    // r → ∞ at θ = 0, but r·sin θ → ∞ with it: there is no line to draw.
    expect(asymptotesOf('r = 2/(1-cos(theta))')).toEqual([])
    expect(holesOf('r = 2/(1-cos(theta))')).toEqual([])
  })

  it('an explicit θ exclusion is an exact polar hole', () => {
    // r = 2 {θ != 1} is the circle of radius 2 with one point lifted out of it
    const holes = holesOf('r = 2 {theta != 1}')
    expect(holes).toHaveLength(1)
    expect(holes[0].x).toBeCloseTo(2 * Math.cos(1), 9)
    expect(holes[0].y).toBeCloseTo(2 * Math.sin(1), 9)
    expect(holes[0].exact).toBe(true)
  })

  it('a polar curve is never asked about a vertical asymptote', () => {
    for (const src of [
      'r = tan(theta)', 'r = 1/theta', 'r = 1/cos(theta)', 'r = sin(theta)/theta',
      'r = 2/(1-cos(theta))', 'r = 2cos(3theta)', 'r = ln(theta)',
    ]) {
      expect(polesOf(src), src).toEqual([])
      for (const a of asymptotesOf(src)) expect(a.kind, src).toBe('line')
      for (const h of holesOf(src)) {
        expect(Number.isFinite(h.x), `${src} x`).toBe(true)
        expect(Number.isFinite(h.y), `${src} y`).toBe(true)
      }
    }
  })

  it('honours a restricted θ window', () => {
    // the pole of r = 1/θ is outside [1, 5], so there is nothing to approach
    const t = typed('r = 1/theta {1 < theta < 5}')
    expect(findAsymptotes(t.curve, t.models, [-10, 10])).toEqual([])
    expect(findHoles(t.curve, t.models, [-10, 10])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// analyzeCurve
// ---------------------------------------------------------------------------

describe('analyzeCurve — holes', () => {
  it('lists the hole with the label “hole”, after the other features', () => {
    const t = typed('y = (x^2-1)/(x-1)', [-10, 10])
    const pts = analyzeCurve(t.curve, t.models)
    const holes = pts.filter(p => p.kind === 'hole')
    expect(holes).toHaveLength(1)
    expect(holes[0].label).toBe('hole')
    expect(holes[0].pos.x).toBe(1)
    expect(holes[0].pos.y).toBeCloseTo(2, 6)
    // y is a limit, never an exact value, and SpecialPoint has one flag
    expect(holes[0].exact).toBe(false)
    expect(pts[pts.length - 1].kind).toBe('hole')
    // the real zero of x + 1 is still found
    expect(pts.filter(p => p.kind === 'zero').map(p => p.pos.x)).toHaveLength(1)
    expect(pts.filter(p => p.kind === 'zero')[0].pos.x).toBeCloseTo(-1, 9)
  })

  it('a hole ON the axis is a hole, NOT a zero', () => {
    // (x − 1)²/(x − 1) crosses y = 0 at x = 1 in the sampler's eyes: the
    // values on either side have opposite signs, which is exactly what the
    // sign-change scan calls a root. There is no point there at all.
    const t = typed('y = (x-1)^2/(x-1)', [-10, 10])
    const pts = analyzeCurve(t.curve, t.models)
    const holes = pts.filter(p => p.kind === 'hole')
    expect(holes).toHaveLength(1)
    expect(holes[0].pos.x).toBe(1)
    expect(holes[0].pos.y).toBeCloseTo(0, 6)
    for (const p of pts) {
      if (p.kind === 'hole') continue
      expect(Math.abs(p.pos.x - 1), `a ${p.kind} was reported at the hole`)
        .toBeGreaterThan(1e-6)
    }
  })

  it('x(x − 1)/(x − 1) reports the hole at (1, 1) and no feature there', () => {
    const t = typed('y = x(x-1)/(x-1)', [-10, 10])
    const pts = analyzeCurve(t.curve, t.models)
    const holes = pts.filter(p => p.kind === 'hole')
    expect(holes).toHaveLength(1)
    expect(holes[0].pos.x).toBe(1)
    expect(holes[0].pos.y).toBeCloseTo(1, 6)
    expect(pts.filter(p => p.kind === 'maximum' || p.kind === 'minimum')).toEqual([])
  })

  it('an exclusion is listed as a hole on an otherwise ordinary parabola', () => {
    const t = typed('y = x^2 {x != 2}', [-10, 10])
    const pts = analyzeCurve(t.curve, t.models)
    const holes = pts.filter(p => p.kind === 'hole')
    expect(holes).toHaveLength(1)
    expect(holes[0].pos.x).toBe(2)
    expect(holes[0].pos.y).toBeCloseTo(4, 9)
    // the vertex is still there
    const min = pts.filter(p => p.kind === 'minimum')
    expect(min).toHaveLength(1)
    expect(min[0].pos.x).toBeCloseTo(0, 6)
  })

  it('1/x is listed with no hole at all', () => {
    const t = typed('y = 1/x', [-10, 10])
    expect(analyzeCurve(t.curve, t.models).filter(p => p.kind === 'hole')).toEqual([])
  })

  it('lists a POLAR hole at the Cartesian point', () => {
    const t = typed('r = sin(theta)/theta')
    const pts = analyzeCurve(t.curve, t.models)
    const holes = pts.filter(p => p.kind === 'hole')
    expect(holes).toHaveLength(1)
    expect(holes[0].label).toBe('hole')
    expect(holes[0].pos.x).toBeCloseTo(1, 9)
    expect(holes[0].pos.y).toBeCloseTo(0, 9)
    expect(holes[0].exact).toBe(false) // the point is a limit
  })

  it('a polar curve that has none is listed as it always was', () => {
    const rose = libraryCurve('polarRose', [2, 3, 0])
    const pts = analyzeCurve(rose, MODELS)
    expect(pts.filter(p => p.kind === 'hole')).toEqual([])
    expect(pts.filter(p => p.kind === 'petal-tip').length).toBeGreaterThan(0)
    const t = typed('r = 2cos(3theta)')
    expect(analyzeCurve(t.curve, t.models).filter(p => p.kind === 'hole')).toEqual([])
  })

  it('a curve with no singularities is untouched', () => {
    const pts = analyzeCurve(libraryCurve('poly3', [6, -5, -2, 1], [-4, 5]), MODELS)
    expect(pts.filter(p => p.kind === 'hole')).toEqual([])
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].pos.x).toBeGreaterThanOrEqual(pts[i - 1].pos.x)
    }
  })
})


// ---------------------------------------------------------------------------
// end behaviour — the lines a graph leans on as x → ±∞
//
// Every number here is worked out by hand. (2x² + 1)/(x − 1) IS 2x + 2 plus
// 3/(x − 1) by division, so the slant asymptote is y = 2x + 2 and nothing
// else; e^{−x} + 2 flattens onto y = 2 going right and runs away going left,
// so it has ONE asymptote, not two.
// ---------------------------------------------------------------------------

describe('findEndAsymptotes — typed expressions', () => {
  it('(2x² + 1)/(x − 1) leans on y = 2x + 2, and has the pole x = 1', () => {
    const ends = endsOf('y = (2x^2+1)/(x-1)')
    // Both sides name the same line, so it is listed once.
    expect(ends).toHaveLength(1)
    expect(ends[0].m).toBeCloseTo(2, 7)
    expect(ends[0].b).toBeCloseTo(2, 6)
    expect(polesOf('y = (2x^2+1)/(x-1)')).toEqual([1])
    const all = asymptotesOf('y = (2x^2+1)/(x-1)')
    expect(all).toHaveLength(2)
    expect(all[0]).toEqual({ kind: 'vertical', x: 1 })
  })

  it('(3x + 1)/(x − 2) is horizontal at y = 3', () => {
    const ends = endsOf('y = (3x+1)/(x-2)')
    expect(ends).toHaveLength(1)
    expect(ends[0].m).toBe(0)
    expect(ends[0].b).toBeCloseTo(3, 6)
    // A horizontal asymptote points straight along x, exactly.
    const line = findEndAsymptotes(typed('y = (3x+1)/(x-2)').curve, typed('y = (3x+1)/(x-2)').models)[0]
    expect(line).toEqual({ kind: 'line', a: { x: 0, y: (line as Line).a.y }, dir: { x: 1, y: 0 } })
  })

  it('arctan has two of them, y = π/2 and y = −π/2', () => {
    const ends = endsOf('y = atan(x)')
    expect(ends).toHaveLength(2)
    const bs = ends.map((e) => e.b).sort((p, q) => p - q)
    expect(ends.every((e) => e.m === 0)).toBe(true)
    expect(bs[0]).toBeCloseTo(-Math.PI / 2, 6)
    expect(bs[1]).toBeCloseTo(Math.PI / 2, 6)
  })

  it('e^{−x} + 2 leans on y = 2 going RIGHT and on nothing going left', () => {
    const ends = endsOf('y = e^(-x) + 2')
    expect(ends).toHaveLength(1)
    expect(ends[0].m).toBe(0)
    expect(ends[0].b).toBeCloseTo(2, 9)
  })

  it('1/x leans on y = 0 from both sides, which is one line', () => {
    const ends = endsOf('y = 1/x')
    expect(ends).toEqual([{ m: 0, b: 0 }])
    expect(polesOf('y = 1/x')).toEqual([0])
  })

  it('growth, oscillation and slow drift have no end asymptote', () => {
    // x², x³ − 3x: m itself runs away.
    expect(endsOf('y = x^2')).toEqual([])
    expect(endsOf('y = x^3 - 3x')).toEqual([])
    // sin x, x + sin x: m settles (at 0 and at 1) and b never does.
    expect(endsOf('y = sin(x)')).toEqual([])
    expect(endsOf('y = x + sin(x)')).toEqual([])
    // ln x, √x: m → 0 honestly, and then b keeps growing.
    expect(endsOf('y = ln(x)')).toEqual([])
    expect(endsOf('y = sqrt(x)')).toEqual([])
  })

  it('a graph that IS a line is not reported as approaching it', () => {
    expect(endsOf('y = 2x + 3')).toEqual([])
    expect(endsOf('y = 4')).toEqual([])
  })

  it('a curve stopped on both sides has no end to behave at', () => {
    expect(endsOf('y = (2x^2+1)/(x-1)', [-8, 8])).toEqual([])
    expect(endsOf('y = 1/x', [2, 9])).toEqual([])
    // one side still open is still one end
    expect(findEndAsymptotes(
      { ...typed('y = 1/x').curve, domain: [-Infinity, 9] },
      typed('y = 1/x').models,
    ).map(asLine)).toEqual([{ m: 0, b: 0 }])
  })
})

describe('findEndAsymptotes — library families, straight from the params', () => {
  it('recip a/(x − b) + c is horizontal at exactly c', () => {
    expect(libEnds('recip', [2, 3, 1.5])).toEqual([{ m: 0, b: 1.5 }])
    // and the vertical is still the family's own
    expect(findAsymptotes(libraryCurve('recip', [2, 3, 1.5]), MODELS, [-10, 10])).toEqual([
      { kind: 'vertical', x: 3 },
      { kind: 'line', a: { x: 0, y: 1.5 }, dir: { x: 1, y: 0 } },
    ])
  })

  it('logistic names both of its levels', () => {
    // a/(1 + e^{−b(x−c)}) + d: d going left, d + a going right, for b > 0
    const ends = libEnds('logistic', [4, 1.8, 0.5, -2])
    expect(ends).toEqual([{ m: 0, b: -2 }, { m: 0, b: 2 }])
    // a negative b swaps which end is which, and names the same two lines
    const flipped = libEnds('logistic', [4, -1.8, 0.5, -2])
    expect(flipped).toEqual([{ m: 0, b: 2 }, { m: 0, b: -2 }])
  })

  it('exp only flattens on the side where it decays', () => {
    expect(libEnds('exp', [1, -0.5, 3])).toEqual([{ m: 0, b: 3 }])
    expect(libEnds('exp', [1, 0.5, 3])).toEqual([{ m: 0, b: 3 }])
    // b = 0 is the constant a + c — a line, not something approaching one
    expect(libEnds('exp', [1, 0, 3])).toEqual([])
  })

  it('a Gaussian settles onto its baseline at both ends', () => {
    expect(libEnds('gauss', [3, 1, 2, -0.5])).toEqual([{ m: 0, b: -0.5 }])
  })

  it('the families that grow, drift or swing have none', () => {
    for (const [modelId, params] of [
      ['line', [3, 2]],
      ['poly2', [-6, -4, 2]],
      ['poly3', [6, -5, -2, 1]],
      ['poly4', [1, 0, 0, 0, 1]],
      ['sine', [2, 1, 0, 0]],
      ['log', [1, -1, 3]],
      ['sqrt', [1, 0, 0]],
      ['cbrt', [1, 0, 0]],
      ['abs', [1, 0, 0]],
      ['power', [1, 0, 0, 2]],
      ['vline', [2]],
      ['circle', [0, 0, 3]],
      ['polarRose', [2, 3, 0]],
      ['spiral', [0, 1]],
    ] as const) {
      expect(libEnds(modelId, [...params]), modelId).toEqual([])
    }
  })

  it('a family curve stopped on both sides has none either', () => {
    expect(libEnds('recip', [2, 3, 1.5], [-8, 8])).toEqual([])
  })
})


// ---------------------------------------------------------------------------
// the card row — the same lines, in the words a teacher writes them in
//
// src/ui/CurveCard.tsx prints one string per asymptote. The strings are the
// contract: `y = 2x + 2`, not `y = 2.000x + 2.000`, and a true minus sign
// rather than a hyphen.
// ---------------------------------------------------------------------------

describe('the Asymptotes row', () => {
  const rowOf = (src: string, domain: [number, number] | null = null) => {
    const t = typed(src, domain)
    return asymptoteTexts(t.curve, t.models)
  }

  it('reads the slant case as y = 2x + 2, after the vertical one', () => {
    expect(rowOf('y = (2x^2+1)/(x-1)')).toEqual(['x = 1', 'y = 2x + 2'])
  })

  it('writes a negative slope and a negative intercept with a true minus', () => {
    // (−0.5x² − x + 1)/x = −0.5x − 1 + 1/x
    const row = rowOf('y = (-0.5x^2 - x + 1)/x')
    expect(row).toEqual(['x = 0', 'y = −0.5x − 1'])
    expect(row[1].includes('-')).toBe(false)
  })

  it('writes a horizontal one as a level', () => {
    expect(rowOf('y = (3x+1)/(x-2)')).toEqual(['x = 2', 'y = 3'])
    expect(rowOf('y = 1/x')).toEqual(['x = 0', 'y = 0'])
  })

  it('rounds to four significant digits — arctan is ±1.571', () => {
    expect(rowOf('y = atan(x)')).toEqual(['y = −1.571', 'y = 1.571'])
    expect(rowOf('y = 3atan(x)')).toEqual(['y = −4.712', 'y = 4.712'])
  })

  it('drops a unit slope and a zero intercept, as an equation is written', () => {
    expect(rowOf('y = (x^2+1)/x')).toEqual(['x = 0', 'y = x'])
  })

  it('lists a library family from its own parameters', () => {
    expect(asymptoteTexts(libraryCurve('recip', [2, 3, 1.5]), MODELS))
      .toEqual(['x = 3', 'y = 1.5'])
    expect(asymptoteTexts(libraryCurve('logistic', [4, 1.8, 0.5, -2]), MODELS))
      .toEqual(['y = −2', 'y = 2'])
  })

  it('writes a polar curve’s slant lines in the same language', () => {
    // r = tan θ leans on x = 1 and x = −1 — vertical lines, so they name an x
    expect(rowOf('r = tan(theta)')).toEqual(['x = 1', 'x = −1'])
    // r = 1/θ leans on y = 1
    expect(rowOf('r = 1/theta')).toEqual(['y = 1'])
  })

  it('is empty when the curve has none — the row is then not drawn at all', () => {
    expect(rowOf('y = x^2')).toEqual([])
    expect(rowOf('y = sin(x)')).toEqual([])
    expect(rowOf('y = 2x + 3')).toEqual([])
    expect(asymptoteTexts(libraryCurve('poly3', [6, -5, -2, 1]), MODELS)).toEqual([])
  })

  it('reads the vertical ones over the curve’s own domain, or [−10, 10]', () => {
    // tan x has six poles on [−10, 10] and one on [0, 2]
    expect(rowOf('y = tan(x)')).toHaveLength(6)
    expect(rowOf('y = tan(x)', [0, 2])).toEqual(['x = 1.571'])
  })
})

// ---------------------------------------------------------------------------
// cost — the renderer asks for this every frame
// ---------------------------------------------------------------------------

describe('cost', () => {
  it('singularities + findHoles + findPoles cost well under a millisecond', () => {
    const t = typed('y = (x^2-1)/(x-1)')
    const range: [number, number] = [-10, 10]
    const once = () => {
      t.spec.singularities!(t.curve.params, range)
      findHoles(t.curve, t.models, range)
      findPoles(t.curve, t.models, range)
    }
    for (let i = 0; i < 20; i++) once()
    const n = 200
    const t0 = performance.now()
    for (let i = 0; i < n; i++) once()
    const per = (performance.now() - t0) / n
    expect(per, `${per.toFixed(3)} ms per call`).toBeLessThan(1)
  })

  it('findEndAsymptotes costs well under half a millisecond', () => {
    // The renderer asks for this on every frame of every curve: seven
    // evaluations a side, plus the 129 that measure the curve's own
    // magnitude. It has to be free.
    const t = typed('y = (2x^2+1)/(x-1)')
    const once = () => findEndAsymptotes(t.curve, t.models)
    for (let i = 0; i < 20; i++) once()
    const n = 500
    const t0 = performance.now()
    for (let i = 0; i < n; i++) once()
    const per = (performance.now() - t0) / n
    expect(per, `${per.toFixed(4)} ms per call`).toBeLessThan(0.5)
  })

  it('a polar round — holes and slant asymptotes — costs under a millisecond', () => {
    const t = typed('r = tan(theta)')
    const range: [number, number] = [-10, 10]
    const once = () => {
      t.spec.singularities!(t.curve.params, range)
      findHoles(t.curve, t.models, range)
      findAsymptotes(t.curve, t.models, range)
    }
    for (let i = 0; i < 20; i++) once()
    const n = 200
    const t0 = performance.now()
    for (let i = 0; i < n; i++) once()
    const per = (performance.now() - t0) / n
    expect(per, `${per.toFixed(3)} ms per call`).toBeLessThan(1)
  })
})

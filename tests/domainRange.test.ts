// ============================================================================
// tests/domainRange.test.ts — domain, range, the horizontal line test and
// where a level meets the curve (src/core/domainRange.ts).
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { parseExpression } from '../src/core/parse'
import { MODELS } from '../src/core/fit/models'
import {
  curveDomain,
  curveRange,
  describeSet,
  levelCrossings,
  naturalDomain,
  oneToOneInfo,
} from '../src/core/domainRange'
import type { IntervalPart, RealSet } from '../src/core/domainRange'
import { PERF } from './perfBudget'

const PI = Math.PI

let seq = 0
/** A typed line as the board holds it — a fresh model id each time (no memo reuse). */
function typed(src: string, domain?: [number, number] | null): { curve: FittedCurve; models: Record<string, ModelSpec> } {
  const r = parseExpression(src)
  if (!r.ok) throw new Error(`expected "${src}" to parse: ${r.error}`)
  const id = `expr_${++seq}`
  const spec = r.plot.makeModel(id)
  const curve: FittedCurve = {
    id: `c${seq}`,
    modelId: id,
    params: r.plot.defaultParams,
    kind: r.plot.kind,
    domain: domain === undefined ? r.plot.domain : domain,
    color: '#4f9cf9',
    strokeWidth: 2.5,
    visible: true,
    error: 0,
  }
  return { curve, models: { [id]: spec } }
}

function sketch(modelId: string, params: number[], domain: [number, number] | null = null): FittedCurve {
  return {
    id: `s${++seq}`, modelId, params, kind: 'explicit', domain,
    color: '#4f9cf9', strokeWidth: 2.5, visible: true, error: 0,
  }
}

const dom = (src: string): RealSet => {
  const t = typed(src)
  const d = curveDomain(t.curve, t.models)
  if (!d) throw new Error('no domain')
  return d
}
const rng = (src: string): RealSet => {
  const t = typed(src)
  const r = curveRange(t.curve, t.models)
  if (!r) throw new Error('no range')
  return r
}
const one = (src: string) => {
  const t = typed(src)
  const o = oneToOneInfo(t.curve, t.models)
  if (!o) throw new Error('no one-to-one')
  return o
}

/** "[0, ∞)" style: the parts as (lo, hi, closedness) for exact comparison. */
function shape(set: RealSet): string {
  return set.parts
    .map((p) => `${p.loClosed ? '[' : '('}${fmt(p.lo)},${fmt(p.hi)}${p.hiClosed ? ']' : ')'}`)
    .join(' ')
}
const fmt = (v: number) => (v === Infinity ? 'inf' : v === -Infinity ? '-inf' : String(Number(v.toPrecision(12))))

// ---------------------------------------------------------------------------
// domains
// ---------------------------------------------------------------------------

describe('curveDomain — typed formulas', () => {
  it('x² is every real number', () => {
    const d = dom('y = x^2')
    expect(d.kind).toBe('intervals')
    expect(d.text).toBe('(−∞, ∞)')
    expect(d.builder).toBe('all real numbers')
    expect(d.tex).toBe('\\left(-\\infty, \\infty\\right)')
  })

  it('√(x − 2) is [2, ∞): the boundary is closed', () => {
    const d = dom('y = sqrt(x - 2)')
    expect(d.text).toBe('[2, ∞)')
    expect(d.builder).toBe('x ≥ 2')
    expect(d.builderTex).toBe('x \\ge 2')
    expect(d.parts[0].loExact?.text).toBe('2')
  })

  it('√(4 − x²) is [−2, 2]', () => {
    const d = dom('y = sqrt(4 - x^2)')
    expect(d.text).toBe('[−2, 2]')
    expect(d.builder).toBe('−2 ≤ x ≤ 2')
    expect(d.tex).toBe('\\left[-2, 2\\right]')
  })

  it('ln x is (0, ∞): the boundary is open', () => {
    const d = dom('y = ln(x)')
    expect(d.text).toBe('(0, ∞)')
    expect(d.builder).toBe('x > 0')
  })

  it('ln(x² − 1) is (−∞, −1) ∪ (1, ∞)', () => {
    const d = dom('y = ln(x^2 - 1)')
    expect(d.text).toBe('(−∞, −1) ∪ (1, ∞)')
    expect(d.tex).toBe('\\left(-\\infty, -1\\right) \\cup \\left(1, \\infty\\right)')
    expect(d.builder).toBe('x < −1 or x > 1')
  })

  it('1/x excludes 0', () => {
    const d = dom('y = 1/x')
    expect(d.text).toBe('(−∞, 0) ∪ (0, ∞)')
    expect(d.builder).toBe('x ≠ 0')
    expect(d.builderTex).toBe('x \\ne 0')
  })

  it('1/(x² − 4) excludes −2 and 2', () => {
    const d = dom('y = 1/(x^2 - 4)')
    expect(d.builder).toBe('x ≠ −2, 2')
    expect(d.parts).toHaveLength(3)
  })

  it('(x² − 1)/(x − 1) excludes the hole at 1', () => {
    const d = dom('y = (x^2 - 1)/(x - 1)')
    expect(d.builder).toBe('x ≠ 1')
    expect(shape(d)).toBe('(-inf,1) (1,inf)')
  })

  it('tan x excludes π/2 + kπ: a periodic set, parts in a window, "+ kπ" in words', () => {
    const d = dom('y = tan(x)')
    expect(d.kind).toBe('intervals')
    expect(d.builder).toBe('x ≠ π/2 + kπ')
    expect(d.builderTex).toBe('x \\ne \\frac{\\pi}{2} + k\\pi')
    expect(d.text).toBe('… ∪ (−3π/2, −π/2) ∪ (−π/2, π/2) ∪ (π/2, 3π/2) ∪ …')
    expect(d.periodic).toBeDefined()
    expect(d.periodic!.period).toBeCloseTo(PI, 12)
    expect(d.periodic!.left && d.periodic!.right).toBe(true)
    // every listed part is bounded, between consecutive poles
    for (const p of d.parts) {
      expect(Number.isFinite(p.lo) && Number.isFinite(p.hi)).toBe(true)
      expect(p.hi - p.lo).toBeCloseTo(PI, 9)
      expect(p.loClosed || p.hiClosed).toBe(false)
    }
    expect(d.parts.some((p) => p.lo === -PI / 2 && p.hi === PI / 2)).toBe(true)
  })

  it('1/sin x is x ≠ kπ; 1/(sin x − 1/2) has two classes per period', () => {
    expect(dom('y = 1/sin(x)').builder).toBe('x ≠ kπ')
    expect(dom('y = 1/(sin(x) - 1/2)').builder).toBe('x ≠ π/6 + 2kπ, 5π/6 + 2kπ')
  })

  it('tan x on a bounded restriction is an ordinary set again', () => {
    const d = dom('y = tan(x) {-2 < x < 2}')
    expect(d.periodic).toBeUndefined()
    expect(d.text).toBe('(−2, −π/2) ∪ (−π/2, π/2) ∪ (π/2, 2)')
    expect(d.builder).toBe('−2 < x < 2, x ≠ −π/2, π/2')
  })

  it('asin x is [−1, 1]', () => {
    expect(dom('y = asin(x)').text).toBe('[−1, 1]')
  })

  it('cbrt x is every real number', () => {
    expect(dom('y = cbrt(x)').builder).toBe('all real numbers')
  })

  it('x^(1/3) is read as the parser evaluates it (ℝ once odd roots of negatives evaluate)', () => {
    const t = typed('y = x^(1/3)')
    const d = curveDomain(t.curve, t.models)!
    const negDefined = Number.isFinite(t.models[t.curve.modelId].evalExplicit!(t.curve.params, -8))
    // the parser today returns NaN for (−8)^(1/3); the domain follows what is drawn
    expect(d.builder).toBe(negDefined ? 'all real numbers' : 'x ≥ 0')
  })

  it('x^(1/2) is [0, ∞)', () => {
    expect(dom('y = x^(1/2)').text).toBe('[0, ∞)')
  })

  it('a typed restriction keeps its closedness: y = x² {0 ≤ x < 3} is [0, 3)', () => {
    const d = dom('y = x^2 {0 <= x < 3}')
    expect(d.text).toBe('[0, 3)')
    expect(d.builder).toBe('0 ≤ x < 3')
  })

  it('an excluded point typed as {x != 2} is excluded', () => {
    expect(dom('y = x^2 {x != 2}').builder).toBe('x ≠ 2')
    expect(dom('y = sqrt(x)/(x - 2)').builder).toBe('x ≥ 0, x ≠ 2')
  })

  it('eˣ overflowing far out is not a domain boundary', () => {
    expect(dom('y = e^x').builder).toBe('all real numbers')
    expect(dom('y = 2^x - 3').builder).toBe('all real numbers')
  })

  it('a boundary far outside the board is still found', () => {
    expect(dom('y = ln(x - 50)').text).toBe('(50, ∞)')
  })

  it('the natural domain ignores the restriction; the curve domain honours it', () => {
    const t = typed('y = sqrt(x - 2)', [0, 5])
    expect(naturalDomain(t.curve, t.models)!.text).toBe('[2, ∞)')
    expect(curveDomain(t.curve, t.models)!.text).toBe('[2, 5]')
  })

  it('a non-explicit curve has none', () => {
    const t = typed('x^2 + y^2 = 4')
    expect(curveDomain(t.curve, t.models)).toBeNull()
    expect(curveRange(t.curve, t.models)).toBeNull()
    expect(oneToOneInfo(t.curve, t.models)).toBeNull()
  })
})

describe('naturalDomain — the formula as written, without the teacher’s restriction', () => {
  const nat = (src: string): string => {
    const t = typed(src)
    return naturalDomain(t.curve, t.models)!.text
  }
  const cur = (src: string): string => {
    const t = typed(src)
    return curveDomain(t.curve, t.models)!.text
  }

  it('a restriction clause does not shrink the natural domain', () => {
    expect(nat('y = x^2 {x >= 0}')).toBe('(−∞, ∞)')
    expect(cur('y = x^2 {x >= 0}')).toBe('[0, ∞)')
    expect(nat('y = x^2, x >= 0')).toBe('(−∞, ∞)')
    expect(nat('y = x^2 {0 <= x < 3}')).toBe('(−∞, ∞)')
    expect(nat('y = abs(x) {x >= 1}')).toBe('(−∞, ∞)')
    expect(nat('y = floor(x) {x > 0}')).toBe('(−∞, ∞)')
  })

  it('the formula’s own limits still show through', () => {
    expect(nat('y = sqrt(x) {x >= 1}')).toBe('[0, ∞)')
    expect(cur('y = sqrt(x) {x >= 1}')).toBe('[1, ∞)')
    expect(nat('y = ln(x) {x >= 2}')).toBe('(0, ∞)')
    expect(nat('y = 1/x {x > 0}')).toBe('(−∞, 0) ∪ (0, ∞)')
    expect(nat('y = sqrt(4 - x^2) {x >= 0}')).toBe('[−2, 2]')
  })

  it('an excluded point {x != c} is the teacher’s, not the formula’s', () => {
    expect(nat('y = x^2 {x != 2}')).toBe('(−∞, ∞)')
    expect(cur('y = x^2 {x != 2}')).toBe('(−∞, 2) ∪ (2, ∞)')
    // a real hole stays out of both
    expect(nat('y = (x^2 - 1)/(x - 1)')).toBe('(−∞, 1) ∪ (1, ∞)')
  })

  it('tan x restricted to x ≥ 0: natural is every branch, the curve domain starts at 0', () => {
    const t = typed('y = tan(x) {x >= 0}')
    const n = naturalDomain(t.curve, t.models)!
    expect(n.builder).toBe('x ≠ π/2 + kπ')
    const c = curveDomain(t.curve, t.models)!
    expect(c.text).toBe('[0, π/2) ∪ (π/2, 3π/2) ∪ (3π/2, 5π/2) ∪ …')
    expect(c.periodic!.left).toBe(false)
    expect(c.periodic!.right).toBe(true)
  })

  it('a piecewise of several formulas: its natural domain is where some branch applies', () => {
    expect(nat('y = {x if x < 0; 2x if x >= 0}')).toBe('(−∞, ∞)')
    expect(nat('y = {sqrt(x) if x > 1; 0 if x < -1}')).toBe('(−∞, −1) ∪ (1, ∞)')
  })
})

describe('curveDomain — sketched curves', () => {
  it('a sketch with domain [−2, 3] is [−2, 3]', () => {
    const d = curveDomain(sketch('poly2', [0, 0, 1], [-2, 3]), MODELS)!
    expect(d.text).toBe('[−2, 3]')
    expect(d.builder).toBe('−2 ≤ x ≤ 3')
  })

  it('a sqrt family is [h, ∞), intersected with the sketch domain', () => {
    expect(curveDomain(sketch('sqrt', [2, 1, -1]), MODELS)!.text).toBe('[1, ∞)')
    expect(curveDomain(sketch('sqrt', [2, 1, -1], [0, 5]), MODELS)!.text).toBe('[1, 5]')
  })

  it('the log family is (h, ∞); recip excludes h', () => {
    expect(curveDomain(sketch('log', [1, -2, 0]), MODELS)!.text).toBe('(−2, ∞)')
    expect(curveDomain(sketch('recip', [1, 2, 0]), MODELS)!.builder).toBe('x ≠ 2')
  })
})

// ---------------------------------------------------------------------------
// ranges
// ---------------------------------------------------------------------------

describe('curveRange', () => {
  const cases: [string, string, string][] = [
    ['y = x^2', '[0, ∞)', 'y ≥ 0'],
    ['y = -(x - 1)^2 + 4', '(−∞, 4]', 'y ≤ 4'],
    ['y = x^3', '(−∞, ∞)', 'all real numbers'],
    ['y = 1/x', '(−∞, 0) ∪ (0, ∞)', 'y ≠ 0'],
    ['y = (x + 1)/(x - 2)', '(−∞, 1) ∪ (1, ∞)', 'y ≠ 1'],
    ['y = 1/(x^2 + 1)', '(0, 1]', '0 < y ≤ 1'],
    ['y = e^x', '(0, ∞)', 'y > 0'],
    ['y = 2^x - 3', '(−3, ∞)', 'y > −3'],
    ['y = ln(x)', '(−∞, ∞)', 'all real numbers'],
    ['y = sin(x)', '[−1, 1]', '−1 ≤ y ≤ 1'],
    ['y = 3sin(2x) + 1', '[−2, 4]', '−2 ≤ y ≤ 4'],
    ['y = sqrt(4 - x^2)', '[0, 2]', '0 ≤ y ≤ 2'],
    ['y = atan(x)', '(−π/2, π/2)', '−π/2 < y < π/2'],
    ['y = x^2 {0 <= x < 3}', '[0, 9)', '0 ≤ y < 9'],
    ['y = abs(x)', '[0, ∞)', 'y ≥ 0'],
    ['y = (x^2 - 1)/(x - 1)', '(−∞, 2) ∪ (2, ∞)', 'y ≠ 2'],
    ['y = x/(x^2 + 1)', '[−1/2, 1/2]', '−1/2 ≤ y ≤ 1/2'],
    ['y = tan(x)', '(−∞, ∞)', 'all real numbers'],
    ['y = e^(-x^2)', '(0, 1]', '0 < y ≤ 1'],
    ['y = 1/(x^2 - 4)', '(−∞, −1/4] ∪ (0, ∞)', 'y ≤ −1/4 or y > 0'],
    ['y = sec(x)', '(−∞, −1] ∪ [1, ∞)', 'y ≤ −1 or y ≥ 1'],
    ['y = {x if x < 0; x + 1 if x >= 0}', '(−∞, 0) ∪ [1, ∞)', 'y < 0 or y ≥ 1'],
  ]
  for (const [src, text, builder] of cases) {
    it(`${src} → ${text}`, () => {
      const r = rng(src)
      expect(r.kind).toBe('intervals')
      expect(r.text).toBe(text)
      expect(r.builder).toBe(builder)
    })
  }

  it('endpoints carry their exact forms and values', () => {
    const r = rng('y = atan(x)')
    expect(r.parts[0].lo).toBe(-PI / 2)
    expect(r.parts[0].hiExact?.text).toBe('π/2')
    expect(r.tex).toBe('\\left(-\\frac{\\pi}{2}, \\frac{\\pi}{2}\\right)')
    const h = rng('y = x/(x^2 + 1)')
    expect(h.parts[0].lo).toBe(-0.5)
    expect(h.parts[0].hi).toBe(0.5)
  })

  it('a far-away extremum is still found (x/(x² + 10000) turns at ±100)', () => {
    const r = rng('y = x/(x^2 + 10000)')
    expect(r.parts[0].lo).toBeCloseTo(-0.005, 12)
    expect(r.parts[0].hi).toBeCloseTo(0.005, 12)
    expect(rng('y = (x - 100)^2').text).toBe('[0, ∞)')
  })

  it('floor x is all integers', () => {
    const r = rng('y = floor(x)')
    expect(r.kind).toBe('integers')
    expect(r.text).toBe('all integers')
    expect(r.builder).toBe('all integers')
  })

  it('sign x is {−1, 0, 1}', () => {
    const r = rng('y = sign(x)')
    expect(r.kind).toBe('finite')
    expect(r.points).toEqual([-1, 0, 1])
    expect(r.text).toBe('{−1, 0, 1}')
    expect(r.tex).toBe('\\left\\{-1, 0, 1\\right\\}')
  })

  it('restricted steps and piecewise constants are finite sets', () => {
    expect(rng('y = ceil(x) {0 <= x < 3}').text).toBe('{0, 1, 2, 3}')
    expect(rng('y = {1 if x < 0; 2 if x >= 0}').text).toBe('{1, 2}')
    expect(rng('y = abs(x)/x').text).toBe('{−1, 1}')
    const c = rng('y = 5')
    expect(c.kind).toBe('finite')
    expect(c.builder).toBe('y = 5')
  })

  it('sin(1/x) near 0 is unknown rather than a guess; x·sin x is still ℝ', () => {
    expect(rng('y = sin(1/x)').kind).toBe('unknown')
    expect(rng('y = x sin(x)').builder).toBe('all real numbers')
  })

  it('a hole whose value is attained elsewhere is not excluded', () => {
    // (x² − 1)(x − 3)/(x − 1) = (x + 1)(x − 3) off x = 1; its value −4 at 1 is attained again? no: −4 is the vertex, at x = 1 only
    const r = rng('y = (x^2 - 1)(x - 3)/(x - 1)')
    expect(r.text).toBe('(−4, ∞)')
    // shift the hole off the vertex: (x² − 4)(x − 3)/(x − 2) = (x + 2)(x − 3); f(2) = −4 is also f(−1)
    expect(rng('y = (x^2 - 4)(x - 3)/(x - 2)').text).toBe('[−25/4, ∞)')
  })

  it('sketched families read the same way', () => {
    expect(curveRange(sketch('sine', [2, 1, 0, 1]), MODELS)!.text).toBe('[−1, 3]')
    expect(curveRange(sketch('exp', [1, 1, 0]), MODELS)!.text).toBe('(0, ∞)')
    expect(curveRange(sketch('recip', [1, 2, 0]), MODELS)!.builder).toBe('y ≠ 0')
    expect(curveRange(sketch('poly2', [0, 0, 1], [-2, 3]), MODELS)!.text).toBe('[0, 9]')
  })
})

// ---------------------------------------------------------------------------
// one-to-one
// ---------------------------------------------------------------------------

const chip = (p: IntervalPart): string => {
  const lo = Number.isFinite(p.lo) ? p.loExact?.text ?? String(p.lo) : '−∞'
  const hi = Number.isFinite(p.hi) ? p.hiExact?.text ?? String(p.hi) : '∞'
  return `${p.loClosed ? '[' : '('}${lo}, ${hi}${p.hiClosed ? ']' : ')'}`
}

describe('oneToOneInfo', () => {
  it('x³, eˣ, ln x, 1/x and x² on [0, ∞) are one-to-one', () => {
    for (const src of ['y = x^3', 'y = e^x', 'y = ln(x)', 'y = 1/x', 'y = x^2 {x >= 0}', 'y = atan(x)', 'y = (x+1)/(x-2)']) {
      const o = one(src)
      expect(o.oneToOne, src).toBe(true)
      expect(o.witness, src).toBeUndefined()
    }
    expect(one('y = x^3').monotone.map(chip)).toEqual(['(−∞, ∞)'])
    expect(one('y = 1/x').monotone.map(chip)).toEqual(['(0, ∞)', '(−∞, 0)'])
  })

  it('x² fails at y = 1, x = −1 and 1; chips x ≥ 0 then x ≤ 0', () => {
    const o = one('y = x^2')
    expect(o.oneToOne).toBe(false)
    expect(o.witness).toEqual({ y: 1, exactY: expect.objectContaining({ text: '1' }), xs: [-1, 1] })
    expect(o.monotone.map(chip)).toEqual(['[0, ∞)', '(−∞, 0]'])
  })

  it('sin x: the chip containing 0 first, then its neighbours', () => {
    const o = one('y = sin(x)')
    expect(o.oneToOne).toBe(false)
    expect(o.monotone.slice(0, 3).map(chip)).toEqual(['[−π/2, π/2]', '[π/2, 3π/2]', '[−3π/2, −π/2]'])
    expect(o.monotone[0].lo).toBe(-PI / 2)
    expect(o.monotone[0].hi).toBe(PI / 2)
    expect(o.witness!.y).toBe(0)
    expect(o.witness!.xs).toContain(0)
    expect(o.witness!.xs).toContain(PI)
  })

  it('(x − 1)² + 2 gives x ≥ 1, x ≤ 1', () => {
    const o = one('y = (x - 1)^2 + 2')
    expect(o.monotone.map(chip)).toEqual(['[1, ∞)', '(−∞, 1]'])
    expect(o.witness!.y).toBe(3)
    expect(o.witness!.xs).toEqual([0, 2])
  })

  it('cos x gives [0, π] first', () => {
    expect(chip(one('y = cos(x)').monotone[0])).toBe('[0, π]')
  })

  it('x³ − 3x turns at ±1: (−∞, −1], [−1, 1], [1, ∞)', () => {
    const o = one('y = x^3 - 3x')
    expect(o.oneToOne).toBe(false)
    expect(o.monotone.map(chip).sort()).toEqual(['(−∞, −1]', '[−1, 1]', '[1, ∞)'].sort())
    expect(o.witness!.y).toBe(0)
    expect(o.witness!.xs).toEqual([-Math.sqrt(3), 0, Math.sqrt(3)])
  })

  it('tan x: the branches, and the stretches overlap', () => {
    const o = one('y = tan(x)')
    expect(o.oneToOne).toBe(false)
    expect(chip(o.monotone[0])).toBe('(−π/2, π/2)')
  })

  it('a step function is not one-to-one: its treads are the witness', () => {
    const f = one('y = floor(x)')
    expect(f.oneToOne).toBe(false)
    expect(f.monotone).toEqual([])
    expect(f.witness!.y).toBe(0)
    expect(f.witness!.xs).toEqual([0, 0.5])
    const s = one('y = sign(x)')
    expect(s.witness!.y).toBe(1)
    expect(s.witness!.xs).toEqual([1, 2])
  })

  it('a witness height lies inside both pieces and every x on it meets the curve', () => {
    for (const src of ['y = x^2 - 2x + 3', 'y = 1/(x^2 + 1)', 'y = x e^(-x)', 'y = sqrt(4 - x^2)', 'y = sec(x)']) {
      const t = typed(src)
      const o = oneToOneInfo(t.curve, t.models)!
      expect(o.oneToOne, src).toBe(false)
      const f = t.models[t.curve.modelId].evalExplicit!
      expect(o.witness!.xs.length, src).toBeGreaterThanOrEqual(2)
      for (const x of o.witness!.xs) expect(f(t.curve.params, x)).toBeCloseTo(o.witness!.y, 9)
    }
  })

  it('a sketch restricted to one side of its vertex is one-to-one', () => {
    expect(oneToOneInfo(sketch('poly2', [0, 0, 1], [0, 3]), MODELS)!.oneToOne).toBe(true)
    expect(oneToOneInfo(sketch('poly2', [0, 0, 1], [-2, 3]), MODELS)!.oneToOne).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// level crossings
// ---------------------------------------------------------------------------

describe('levelCrossings', () => {
  it('x³ − 3x at y = 0 is −√3, 0, √3 as values', () => {
    const t = typed('y = x^3 - 3x')
    expect(levelCrossings(t.curve, t.models, 0, [-10, 10])).toEqual([-Math.sqrt(3), 0, Math.sqrt(3)])
  })

  it('a touch counts once; a level above the curve meets nothing', () => {
    const t = typed('y = x^3 - 3x')
    expect(levelCrossings(t.curve, t.models, 2, [-10, 10])).toEqual([-1, 2])
    const p = typed('y = x^2')
    expect(levelCrossings(p.curve, p.models, 0, [-5, 5])).toEqual([0])
    expect(levelCrossings(p.curve, p.models, -1, [-5, 5])).toEqual([])
    expect(levelCrossings(p.curve, p.models, 4, [-5, 5])).toEqual([-2, 2])
  })

  it('never reports a pole, a hole, or a point outside the domain', () => {
    const r = typed('y = 1/x')
    expect(levelCrossings(r.curve, r.models, 0, [-5, 5])).toEqual([])
    const h = typed('y = (x^2 - 1)/(x - 1)')
    expect(levelCrossings(h.curve, h.models, 2, [-5, 5])).toEqual([])
    expect(levelCrossings(h.curve, h.models, 3, [-5, 5])).toEqual([2])
    const res = typed('y = x^2 {0 <= x < 3}')
    expect(levelCrossings(res.curve, res.models, 1, [-5, 5])).toEqual([1])
    expect(levelCrossings(res.curve, res.models, 9, [-5, 5])).toEqual([])
  })

  it('periodic crossings are snapped to their exact values', () => {
    const t = typed('y = sin(x)')
    expect(levelCrossings(t.curve, t.models, 0.5, [0, 2 * PI])).toEqual([PI / 6, (5 * PI) / 6])
  })

  it('is fast enough for every pointer move', () => {
    const t = typed('y = x^3 - 3x')
    levelCrossings(t.curve, t.models, 0.3, [-10, 10])
    const t0 = performance.now()
    const N = 200
    for (let i = 0; i < N; i++) levelCrossings(t.curve, t.models, -1 + (2 * i) / N, [-10, 10])
    const each = (performance.now() - t0) / N
    expect(each).toBeLessThan(2 * PERF)
  })
})

// ---------------------------------------------------------------------------
// describeSet
// ---------------------------------------------------------------------------

const P = (lo: number, hi: number, lc: boolean, hc: boolean): IntervalPart => ({
  lo, hi, loClosed: lc, hiClosed: hc, loExact: null, hiExact: null,
})

describe('describeSet', () => {
  it('writes the common Math 3 phrasings', () => {
    expect(describeSet([P(-Infinity, Infinity, false, false)], 'x').builder).toBe('all real numbers')
    expect(describeSet([P(0, Infinity, true, false)], 'x').builder).toBe('x ≥ 0')
    expect(describeSet([P(0, Infinity, false, false)], 'x').builder).toBe('x > 0')
    expect(describeSet([P(-Infinity, 2, false, false), P(2, Infinity, false, false)], 'x').builder).toBe('x ≠ 2')
    expect(
      describeSet([P(-Infinity, -2, false, false), P(-2, 2, false, false), P(2, Infinity, false, false)], 'x').builder,
    ).toBe('x ≠ −2, 2')
    expect(describeSet([P(-1, 1, true, true)], 'x').builder).toBe('−1 ≤ x ≤ 1')
    expect(describeSet([P(-3, Infinity, true, false)], 'y').builder).toBe('y ≥ −3')
    expect(describeSet([P(-Infinity, 1, false, false), P(1, Infinity, false, false)], 'y').builder).toBe('y ≠ 1')
  })

  it('interval notation in Unicode and KaTeX', () => {
    const d = describeSet([P(-1, 1, false, true)], 'x')
    expect(d.text).toBe('(−1, 1]')
    expect(d.tex).toBe('\\left(-1, 1\\right]')
    expect(d.builderTex).toBe('-1 < x \\le 1')
    const u = describeSet([P(-Infinity, 0, false, false), P(0, Infinity, false, false)], 'x')
    expect(u.text).toBe('(−∞, 0) ∪ (0, ∞)')
    expect(u.tex).toBe('\\left(-\\infty, 0\\right) \\cup \\left(0, \\infty\\right)')
  })

  it('a union with no short form is its interval text', () => {
    const d = describeSet([P(-3, -1, true, true), P(1, 2, false, false)], 'x')
    expect(d.builder).toBe('[−3, −1] ∪ (1, 2)')
    expect(describeSet([], 'x').text).toBe('∅')
  })
})

// ---------------------------------------------------------------------------
// performance
// ---------------------------------------------------------------------------

describe('performance', () => {
  it('domain + range + one-to-one together stay under ~15 ms for a typical typed curve', () => {
    const srcs = ['y = x^3 - 3x', 'y = (x+1)/(x-2)', 'y = 3sin(2x) + 1', 'y = sqrt(4 - x^2)', 'y = ln(x^2 - 1)', 'y = e^x']
    // warm the JIT
    for (const s of srcs) { const t = typed(s); curveDomain(t.curve, t.models); curveRange(t.curve, t.models); oneToOneInfo(t.curve, t.models) }
    const times: number[] = []
    for (let round = 0; round < 3; round++) {
      for (const s of srcs) {
        const t = typed(s) // a fresh model: nothing memoised
        const t0 = performance.now()
        curveDomain(t.curve, t.models)
        curveRange(t.curve, t.models)
        oneToOneInfo(t.curve, t.models)
        times.push(performance.now() - t0)
      }
    }
    times.sort((a, b) => a - b)
    const median = times[Math.floor(times.length / 2)]
    expect(median).toBeLessThan(15 * PERF)
  })
})

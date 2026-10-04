// ============================================================================
// tests/motion.test.ts — parametric and polar curves the BC way
// (src/core/motion.ts): the particle's state, the curve's features, polar
// area and arc length, the named families and the polar classifier.
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { parseExpression } from '../src/core/parse'
import {
  describePolar,
  familySource,
  paramArcLength,
  paramFeatures,
  paramState,
  polarArea,
  PARAM_FAMILIES,
  POLAR_FAMILIES,
  type ParamFamily,
} from '../src/core/motion'

const PI = Math.PI
const TWO_PI = 2 * PI

/** A typed line on the board: its curve and the model registry. */
function board(src: string, params?: number[]): { curve: FittedCurve; models: Record<string, ModelSpec> } {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(`expected "${src}" to parse, got: ${o.error}`)
  const spec = o.plot.makeModel('expr_1')
  const curve: FittedCurve = {
    id: 'c1',
    modelId: 'expr_1',
    params: params ?? o.plot.defaultParams.slice(),
    kind: o.plot.kind,
    domain: o.plot.domain,
    color: '#fff',
    strokeWidth: 2,
    visible: true,
    error: 0,
  }
  return { curve, models: { expr_1: spec } }
}

/** Composite Simpson with many panels — a reference, not the thing tested. */
function simpson(f: (t: number) => number, a: number, b: number, n = 20000): number {
  const h = (b - a) / n
  let s = f(a) + f(b)
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(a + i * h)
  return (s * h) / 3
}

// ---------------------------------------------------------------------------

describe('paramState', () => {
  it('the unit circle: speed 1, slope −cot t, d²y/dx² = −1/sin³t', () => {
    const { curve, models } = board('(cos(t), sin(t))')
    for (const t of [0.3, 1, 2.2, 3.9, 5.1]) {
      const s = paramState(curve, models, t)
      expect(s.t).toBe(t)
      expect(s.pos.x).toBeCloseTo(Math.cos(t), 12)
      expect(s.pos.y).toBeCloseTo(Math.sin(t), 12)
      expect(s.velocity.x).toBeCloseTo(-Math.sin(t), 9)
      expect(s.velocity.y).toBeCloseTo(Math.cos(t), 9)
      expect(s.speed).toBeCloseTo(1, 9)
      expect(s.acceleration.x).toBeCloseTo(-Math.cos(t), 7)
      expect(s.acceleration.y).toBeCloseTo(-Math.sin(t), 7)
      expect(s.slope!).toBeCloseTo(-1 / Math.tan(t), 8)
      expect(s.concavity!).toBeCloseTo(-1 / Math.sin(t) ** 3, 6)
      expect(s.r).toBeUndefined()
    }
  })

  it('a vertical tangent has no slope', () => {
    const { curve, models } = board('(cos(t), sin(t))')
    for (const t of [0, PI]) {
      const s = paramState(curve, models, t)
      expect(s.slope).toBeNull()
      expect(s.concavity).toBeNull()
      expect(s.speed).toBeCloseTo(1, 9)
    }
  })

  it("the cycloid's cusp: at rest at t = 2π, slope undefined; moving at 2 at the top", () => {
    const { curve, models } = board('(t - sin(t), 1 - cos(t))')
    const cusp = paramState(curve, models, TWO_PI)
    expect(cusp.speed).toBeLessThan(1e-9)
    expect(cusp.slope).toBeNull()
    expect(cusp.concavity).toBeNull()
    expect(cusp.pos.x).toBeCloseTo(TWO_PI, 12)
    expect(cusp.pos.y).toBeCloseTo(0, 12)
    // the acceleration there points straight up: (sin t, cos t) = (0, 1)
    expect(cusp.acceleration.x).toBeCloseTo(0, 7)
    expect(cusp.acceleration.y).toBeCloseTo(1, 7)
    const top = paramState(curve, models, PI)
    expect(top.velocity.x).toBeCloseTo(2, 9)
    expect(top.speed).toBeCloseTo(2, 9)
    expect(top.slope!).toBeCloseTo(0, 9)
    // dy/dx = sin t/(1 − cos t) = cot(t/2)
    const s = paramState(curve, models, 1.2)
    expect(s.slope!).toBeCloseTo(1 / Math.tan(0.6), 8)
  })

  it('a polar curve: r, dr/dθ and the Cartesian motion of r = 2cos(3θ)', () => {
    const { curve, models } = board('r = 2cos(3theta)')
    for (const th of [0.2, 0.9, 1.7, 2.6, 4.4]) {
      const s = paramState(curve, models, th)
      const r = 2 * Math.cos(3 * th)
      const dr = -6 * Math.sin(3 * th)
      expect(s.r!).toBeCloseTo(r, 12)
      expect(s.drdt!).toBeCloseTo(dr, 8)
      expect(s.pos.x).toBeCloseTo(r * Math.cos(th), 12)
      expect(s.pos.y).toBeCloseTo(r * Math.sin(th), 12)
      const xp = dr * Math.cos(th) - r * Math.sin(th)
      const yp = dr * Math.sin(th) + r * Math.cos(th)
      expect(s.velocity.x).toBeCloseTo(xp, 8)
      expect(s.velocity.y).toBeCloseTo(yp, 8)
      expect(s.speed).toBeCloseTo(Math.hypot(r, dr), 8)
      expect(s.slope!).toBeCloseTo(yp / xp, 6)
    }
  })

  it('never throws: an unknown model or a bad t gives an empty state', () => {
    const { curve } = board('(cos(t), sin(t))')
    const s = paramState(curve, {}, 1)
    expect(Number.isNaN(s.speed)).toBe(true)
    expect(s.slope).toBeNull()
    const { curve: c2, models } = board('(cos(t), sin(t))')
    expect(Number.isNaN(paramState(c2, models, Number.NaN).speed)).toBe(true)
  })
})

// ---------------------------------------------------------------------------

describe('paramFeatures', () => {
  it('x = t², y = t³ − 3t: horizontal tangents at t = ±1, vertical at t = 0', () => {
    const { curve, models } = board('(t^2, t^3 - 3t)')
    const f = paramFeatures(curve, models)
    expect(f.interval).toEqual([-10, 10])
    expect(f.horizontalTangents.map((l) => [l.tText, l.xText, l.yText])).toEqual([
      ['−1', '1', '2'],
      ['1', '1', '−2'],
    ])
    expect(f.horizontalTangents[0].t).toBe(-1)
    expect(f.verticalTangents.map((l) => [l.tText, l.xText, l.yText])).toEqual([['0', '0', '0']])
    expect(f.singular).toEqual([])
    expect(f.atPole).toEqual([])
    expect(f.area).toBeNull()
    expect(f.start!.tText).toBe('−10')
    expect(f.end!.yText).toBe('970')
    const ref = simpson((t) => Math.hypot(2 * t, 3 * t * t - 3), -10, 10)
    expect(f.arcLength).toBeCloseTo(ref, 7)
    expect(f.sentences).toContain('horizontal tangents at t = −1 and 1')
    expect(f.sentences).toContain('vertical tangent at t = 0')
  })

  it('the ellipse (2cos t, 3sin t): its four tangents, its length, counterclockwise', () => {
    const { curve, models } = board('(2cos(t), 3sin(t))')
    const f = paramFeatures(curve, models)
    expect(f.interval).toEqual([0, TWO_PI])
    expect(f.horizontalTangents.map((l) => [l.tText, l.xText, l.yText])).toEqual([
      ['π/2', '0', '3'],
      ['3π/2', '0', '−3'],
    ])
    // t = 2π is t = 0 again on a closed curve: listed once
    expect(f.verticalTangents.map((l) => [l.tText, l.xText, l.yText])).toEqual([
      ['0', '2', '0'],
      ['π', '−2', '0'],
    ])
    expect(f.singular).toEqual([])
    expect(f.arcLength).toBeCloseTo(15.865439589290589, 8)
    expect(f.sentences).toContain('horizontal tangents at t = π/2 and 3π/2')
    expect(f.sentences).toContain('arc length ≈ 15.865 over 0 ≤ t ≤ 2π')
    expect(f.sentences.some((s) => /counterclockwise/.test(s))).toBe(true)
    // run backwards, the same ellipse goes clockwise
    const back = board('(2cos(t), -3sin(t))')
    expect(paramFeatures(back.curve, back.models).sentences.some((s) => /moves clockwise/.test(s))).toBe(true)
  })

  it('the cardioid r = 1 + cos θ: the pole at θ = π, area 3π/2, length 8', () => {
    const { curve, models } = board('r = 1 + cos(theta)')
    const f = paramFeatures(curve, models)
    expect(f.interval).toEqual([0, TWO_PI])
    expect(f.atPole.map((l) => l.tText)).toEqual(['π'])
    expect(f.atPole[0].t).toBe(PI)
    expect(f.area).toEqual({ value: 1.5 * PI, exact: true, text: '3π/2' })
    expect(f.singular.map((l) => l.tText)).toEqual(['π'])
    expect(f.horizontalTangents.map((l) => l.tText)).toEqual(['π/3', '5π/3'])
    expect(f.horizontalTangents[0].xText).toBe('3/4')
    expect(f.horizontalTangents[0].yText).toBe('3√3/4')
    expect(f.verticalTangents.map((l) => l.tText)).toEqual(['0', '2π/3', '4π/3'])
    expect(f.arcLength).toBeCloseTo(8, 9)
    expect(f.sentences).toContain('arc length = 8 over 0 ≤ θ ≤ 2π')
    expect(f.sentences).toContain('area ½∫r² dθ over 0 ≤ θ ≤ 2π = 3π/2')
    expect(f.sentences).toContain('at the pole (r = 0) when θ = π')
    expect(f.sentences).toContain('max |r| = 2 at θ = 0')
  })

  it('the three-petal rose over [0, 2π]: the interval integral, and the retrace sentence', () => {
    const { curve, models } = board('r = 2cos(3theta)')
    const f = paramFeatures(curve, models)
    expect(f.area).toEqual({ value: TWO_PI, exact: true, text: '2π' })
    expect(f.sentences).toContain('area ½∫r² dθ over 0 ≤ θ ≤ 2π = 2π')
    expect(
      f.sentences.some((s) => s.startsWith('traced twice on 0 ≤ θ ≤ 2π; one trace is 0 ≤ θ ≤ π') && s.endsWith('area π')),
    ).toBe(true)
    expect(f.atPole.map((l) => l.tText)).toEqual(['π/6', 'π/2', '5π/6', '7π/6', '3π/2', '11π/6'])
    // restricted to one trace, there is nothing to warn about
    const one = board('r = 2cos(3theta) {0 <= theta <= pi}')
    const g = paramFeatures(one.curve, one.models)
    expect(g.area!.text).toBe('π')
    expect(g.sentences.some((s) => /traced twice/.test(s))).toBe(false)
    // an even rose never retraces
    const four = board('r = 2cos(2theta)')
    expect(paramFeatures(four.curve, four.models).sentences.some((s) => /traced twice/.test(s))).toBe(false)
  })

  it('the cycloid arch: at rest at both ends, the arch is 8 long', () => {
    const { curve, models } = board('(t - sin(t), 1 - cos(t))')
    const f = paramFeatures(curve, models)
    expect(f.singular.map((l) => l.tText)).toEqual(['0', '2π'])
    expect(f.horizontalTangents.map((l) => [l.tText, l.xText, l.yText])).toEqual([['π', 'π', '2']])
    expect(f.verticalTangents).toEqual([])
    expect(f.arcLength).toBeCloseTo(8, 9)
    expect(f.sentences).toContain('arc length = 8 over 0 ≤ t ≤ 2π')
    expect(f.sentences).toContain('displacement = 2π; distance traveled = 8')
  })

  it('a constant component has no isolated tangents', () => {
    const { curve, models } = board('(3, t) {0 <= t <= 2}')
    const f = paramFeatures(curve, models)
    expect(f.verticalTangents).toEqual([])
    expect(f.horizontalTangents).toEqual([])
    expect(f.arcLength).toBeCloseTo(2, 10)
  })
})

// ---------------------------------------------------------------------------

describe('polarArea and paramArcLength', () => {
  it('the 3-petal rose: ½∫₀^π (2cos 3θ)² dθ = π, one petal π/3', () => {
    const { curve, models } = board('r = 2cos(3theta)')
    expect(polarArea(curve, models, 0, PI)).toEqual({ value: PI, exact: true, text: 'π' })
    expect(polarArea(curve, models, -PI / 6, PI / 6)).toEqual({ value: PI / 3, exact: true, text: 'π/3' })
    // the inner loop of r = 1 + 2cos θ: between the zeros 2π/3 and 4π/3
    const lim = board('r = 1 + 2cos(theta)')
    const loop = polarArea(lim.curve, lim.models, (2 * PI) / 3, (4 * PI) / 3)!
    expect(loop.value).toBeCloseTo(PI - (3 * Math.sqrt(3)) / 2, 10)
    expect(loop.exact).toBe(false)
    expect(loop.text).toBe('0.544')
  })

  it('is null for a curve that is not polar', () => {
    const { curve, models } = board('(cos(t), sin(t))')
    expect(polarArea(curve, models, 0, 1)).toBeNull()
  })

  it('the unit circle is 2π long; the cycloid arch 8, two arches 16', () => {
    const c = board('(cos(t), sin(t))')
    expect(paramArcLength(c.curve, c.models, 0, TWO_PI)).toBeCloseTo(TWO_PI, 10)
    expect(paramArcLength(c.curve, c.models, 0, PI / 2)).toBeCloseTo(PI / 2, 10)
    const cy = board('(t - sin(t), 1 - cos(t))')
    expect(paramArcLength(cy.curve, cy.models, 0, TWO_PI)).toBeCloseTo(8, 9)
    expect(paramArcLength(cy.curve, cy.models, 0, 2 * TWO_PI)).toBeCloseTo(16, 9)
    expect(paramArcLength(cy.curve, cy.models, TWO_PI, 0)).toBeCloseTo(8, 9)
    // a polar arc: the cardioid from 0 to π is half of 8
    const card = board('r = 1 + cos(theta)')
    expect(paramArcLength(card.curve, card.models, 0, PI)).toBeCloseTo(4, 9)
  })
})

// ---------------------------------------------------------------------------

describe('families', () => {
  const byId = (id: string): ParamFamily =>
    [...PARAM_FAMILIES, ...POLAR_FAMILIES].find((f) => f.id === id)!

  const deg = PI / 180
  /** The textbook formula of every family, straight from its values. */
  const FORMULA: Record<string, (v: Record<string, number>, t: number) => { x: number; y: number } | number> = {
    line: (v, t) => ({ x: v.x1 + (v.x2 - v.x1) * t, y: v.y1 + (v.y2 - v.y1) * t }),
    circle: (v, t) => ({ x: v.h + v.a * Math.cos(t), y: v.k + v.a * Math.sin(t) }),
    ellipse: (v, t) => ({ x: v.h + v.a * Math.cos(t), y: v.k + v.b * Math.sin(t) }),
    cycloid: (v, t) => ({ x: v.a * (t - Math.sin(t)), y: v.a * (1 - Math.cos(t)) }),
    lissajous: (v, t) => ({ x: v.A * Math.sin(v.a * t + v.delta), y: v.B * Math.sin(v.b * t) }),
    projectile: (v, t) => ({
      x: v.v0 * Math.cos(v.alpha * deg) * t,
      y: v.h + v.v0 * Math.sin(v.alpha * deg) * t - 0.5 * v.g * t * t,
    }),
    involute: (v, t) => ({ x: v.a * (Math.cos(t) + t * Math.sin(t)), y: v.a * (Math.sin(t) - t * Math.cos(t)) }),
    roseCos: (v, t) => v.a * Math.cos(v.k * t),
    roseSin: (v, t) => v.a * Math.sin(v.k * t),
    limacon: (v, t) => v.a + v.b * Math.cos(t),
    limaconSin: (v, t) => v.a + v.b * Math.sin(t),
    circleCos: (v, t) => v.a * Math.cos(t),
    circleSin: (v, t) => v.a * Math.sin(t),
    lemniscate: (v, t) => v.a * Math.sqrt(Math.cos(2 * t)),
    spiral: (v, t) => v.a * t,
  }

  const numeric = (s: string): number => {
    const o = parseExpression(`y = ${s}`)
    if (!o.ok) throw new Error(s)
    return o.plot.makeModel('n').evalExplicit!([], 0)
  }

  function roundTrip(fam: ParamFamily, values: Record<string, string>): void {
    const src = familySource(fam, values)
    const o = parseExpression(src)
    expect(o.ok, `${fam.id}: ${src}`).toBe(true)
    if (!o.ok) return
    expect(o.plot.kind, src).toBe(fam.kind)
    expect(o.plot.paramNames, src).toEqual([])
    const v: Record<string, number> = {}
    for (const p of fam.params) v[p.name] = numeric(values[p.name] ?? p.value)
    const spec = o.plot.makeModel('m')
    const [lo, hi] = o.plot.domain ?? [0, TWO_PI]
    for (let i = 0; i < 20; i++) {
      const t = lo + ((hi - lo) * (i + 0.5)) / 20
      const want = FORMULA[fam.id](v, t)
      if (typeof want === 'number') {
        const got = spec.evalPolar!([], t)
        if (Number.isNaN(want)) expect(Number.isNaN(got), src).toBe(true)
        else expect(got, `${src} at ${t}`).toBeCloseTo(want, 12)
      } else {
        const got = spec.evalParametric!([], t)
        expect(got.x, `${src} at ${t}`).toBeCloseTo(want.x, 11)
        expect(got.y, `${src} at ${t}`).toBeCloseTo(want.y, 11)
      }
    }
  }

  it('every family has an id, named parameters with defaults, and an interval', () => {
    expect(PARAM_FAMILIES.map((f) => f.id)).toEqual(['line', 'circle', 'ellipse', 'cycloid', 'lissajous', 'projectile', 'involute'])
    expect(POLAR_FAMILIES.map((f) => f.id)).toEqual([
      'roseCos', 'roseSin', 'limacon', 'limaconSin', 'circleCos', 'circleSin', 'lemniscate', 'spiral',
    ])
    for (const f of PARAM_FAMILIES) expect(f.kind).toBe('parametric')
    for (const f of POLAR_FAMILIES) expect(f.kind).toBe('polar')
    for (const f of [...PARAM_FAMILIES, ...POLAR_FAMILIES]) {
      expect(f.params.length).toBeGreaterThan(0)
      for (const p of f.params) expect(Number.isFinite(numeric(p.value))).toBe(true)
      expect(numeric(f.interval[1])).toBeGreaterThan(numeric(f.interval[0]))
    }
  })

  it('every default source parses and matches its formula at 20 points', () => {
    for (const fam of [...PARAM_FAMILIES, ...POLAR_FAMILIES]) roundTrip(fam, {})
  })

  it('other values round-trip too — negatives, zeros, decimals, π', () => {
    const cases: Array<[string, Record<string, string>]> = [
      ['line', { x1: '-1', y1: '2', x2: '3', y2: '-2.5' }],
      ['line', { x1: '1', y1: '1', x2: '1', y2: '5' }],
      ['circle', { h: '1', k: '-2', a: '3' }],
      ['ellipse', { h: '-1', k: '0.5', a: '4', b: '1.5' }],
      ['cycloid', { a: '2' }],
      ['lissajous', { A: '3', a: '5', delta: '0', B: '-1', b: '4' }],
      ['projectile', { v0: '64', alpha: '30', h: '5', g: '32' }],
      ['projectile', { v0: '12.5', alpha: '52.5', h: '1.2', g: '9.8' }],
      ['involute', { a: '0.5' }],
      ['roseCos', { a: '-3', k: '5' }],
      ['roseSin', { a: '1', k: '4' }],
      ['limacon', { a: '2', b: '-2' }],
      ['limaconSin', { a: '0', b: '3' }],
      ['circleCos', { a: 'pi' }],
      ['circleSin', { a: '-1' }],
      ['lemniscate', { a: '3' }],
      ['spiral', { a: '2' }],
    ]
    for (const [id, values] of cases) roundTrip(byId(id), values)
  })

  it('writes the sources a teacher would type', () => {
    expect(familySource(byId('circle'), {})).toBe('x = 2cos(t), y = 2sin(t) {0 <= t <= 2pi}')
    expect(familySource(byId('circle'), { h: '1', k: '-2', a: '3' })).toBe('x = 1 + 3cos(t), y = -2 + 3sin(t) {0 <= t <= 2pi}')
    expect(familySource(byId('cycloid'), {})).toBe('x = t - sin(t), y = 1 - cos(t) {0 <= t <= 2pi}')
    expect(familySource(byId('cycloid'), { a: '2' })).toBe('x = 2(t - sin(t)), y = 2(1 - cos(t)) {0 <= t <= 2pi}')
    expect(familySource(byId('projectile'), {})).toBe('x = 20cos(pi/4) t, y = 20sin(pi/4) t - 4.9t^2 {0 <= t <= 2.886}')
    expect(familySource(byId('roseCos'), {})).toBe('r = 2cos(3θ)')
    expect(familySource(byId('roseCos'), {}, ['0', 'pi'])).toBe('r = 2cos(3θ) {0 <= θ <= pi}')
    expect(familySource(byId('limacon'), { a: '1', b: '-2' })).toBe('r = 1 - 2cos(θ)')
    expect(familySource(byId('ellipse'), {}, ['0', 'pi'])).toBe('x = 3cos(t), y = 2sin(t) {0 <= t <= pi}')
  })

  it('the projectile runs until it lands, at the values given', () => {
    const src = familySource(byId('projectile'), { v0: '64', alpha: '30', h: '5', g: '32' })
    const o = parseExpression(src)
    expect(o.ok).toBe(true)
    if (!o.ok) return
    const T = o.plot.domain![1]
    expect(T).toBeCloseTo((32 + Math.sqrt(32 * 32 + 2 * 32 * 5)) / 32, 3)
    expect(Math.abs(o.plot.makeModel('m').evalParametric!([], T).y)).toBeLessThan(0.05)
  })

  it('a value may be a slider letter', () => {
    const src = familySource(byId('circle'), { a: 'c' })
    const o = parseExpression(src)
    expect(o.ok).toBe(true)
    if (!o.ok) return
    expect(o.plot.paramNames).toEqual(['c'])
    const v = o.plot.makeModel('m').evalParametric!([3], 0.5)
    expect(v.x).toBeCloseTo(3 * Math.cos(0.5), 14)
  })

  it('every polar family is recognized by describePolar', () => {
    const want: Record<string, RegExp> = {
      roseCos: /^a rose with 3 petals, each of length 2/,
      roseSin: /^a rose with 4 petals, each of length 2/,
      limacon: /^a limaçon with an inner loop$/,
      limaconSin: /^a cardioid$/,
      circleCos: /^a circle of diameter 2 through the pole, centered at \(1, 0\)$/,
      circleSin: /^a circle of diameter 2 through the pole, centered at \(0, 1\)$/,
      lemniscate: /^a lemniscate with loops of length 2$/,
      spiral: /^an Archimedean spiral$/,
    }
    for (const fam of POLAR_FAMILIES) expect(describePolar(familySource(fam, {})), fam.id).toMatch(want[fam.id])
  })
})

// ---------------------------------------------------------------------------

describe('describePolar', () => {
  const table: Array<[string, string | null]> = [
    ['r = 2cos(3theta)', 'a rose with 3 petals, each of length 2, along θ = 0, 2π/3 and 4π/3'],
    ['r = 2sin(3θ)', 'a rose with 3 petals, each of length 2, along θ = π/6, 5π/6 and 3π/2'],
    ['r = 4cos(2θ)', 'a rose with 4 petals, each of length 4, along θ = 0, π/2, π and 3π/2'],
    ['r = -3cos(5θ)', 'a rose with 5 petals, each of length 3, along θ = π/5, 3π/5, π, 7π/5 and 9π/5'],
    ['r = 1 + cos(theta)', 'a cardioid'],
    ['r = 2 - 2sin θ', 'a cardioid'],
    ['r = 1 + 2cos θ', 'a limaçon with an inner loop'],
    ['r = 2 + 3sin θ', 'a limaçon with an inner loop'],
    ['r = 3 + 2cos θ', 'a dimpled limaçon'],
    ['r = 5 + 2cos θ', 'a convex limaçon'],
    ['r = 4 + 2cos θ', 'a convex limaçon'],
    ['r = 3', 'a circle of radius 3 centered at the pole'],
    ['r = 2cos θ', 'a circle of diameter 2 through the pole, centered at (1, 0)'],
    ['r = -2sin(θ)', 'a circle of diameter 2 through the pole, centered at (0, −1)'],
    ['r = sqrt(cos(2theta))', 'a lemniscate with loops of length 1'],
    ['r = 2sqrt(sin(2θ))', 'a lemniscate with loops of length 2'],
    ['r = θ', 'an Archimedean spiral'],
    ['r = 0.5θ + 1', 'an Archimedean spiral'],
    ['r = θ^2', null],
    ['r = 1/θ', null],
    ['r = e^(θ/4)', null],
    ['y = x^2', null],
    ['(cos(t), sin(t))', null],
    ['not an equation (', null],
  ]
  for (const [src, want] of table) {
    it(`${JSON.stringify(src)} -> ${JSON.stringify(want)}`, () => {
      expect(describePolar(src)).toBe(want)
    })
  }
})

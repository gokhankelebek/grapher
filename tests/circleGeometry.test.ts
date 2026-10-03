import { describe, expect, it } from 'vitest'
import {
  chordsCross,
  inscribedCentral,
  makeCircle,
  radiansOf,
  readCirclePoint,
  sectorOf,
  tangentAt,
  tangentsFrom,
} from '../src/core/circleGeometry'
import type { Circle, CirclePoint } from '../src/core/circleGeometry'
import { circleSquareSteps } from '../src/core/conics'

const pt = (c: Circle, text: string, name: string): CirclePoint => {
  const r = readCirclePoint(text, c, name)
  if (!r.ok) throw new Error(r.error)
  return r.p
}

describe('the circle and points on it', () => {
  it('states the standard form with the centre and radius exact', () => {
    const c = makeCircle(2, -3, 4)!
    expect(c.equation).toBe('(x − 2)² + (y + 3)² = 16')
    expect(c.centreText.text).toBe('(2, −3)')
    expect(c.radius.text).toBe('4')
    expect(makeCircle(0, 0, Math.sqrt(10))!.equation).toBe('x² + y² = 10')
    expect(makeCircle(0, 0, Math.sqrt(10))!.radius.text).toBe('√10')
    expect(makeCircle(0, 0, -1)).toBeNull()
  })

  it('reads degrees, radians and coordinates; exact coordinates at special angles', () => {
    const c = makeCircle(0, 0, 6)!
    const p = pt(c, '30°', 'P')
    expect(p.deg).toBe(30)
    expect(p.coords.text).toBe('(3√3, 3)')
    expect(p.radText).toBe('π/6')
    expect(pt(c, '30', 'P').deg).toBe(30)
    expect(pt(c, 'pi/3', 'P').deg).toBe(60)
    expect(pt(c, '2π/3', 'P').coords.text).toBe('(−3, 3√3)')
    expect(pt(c, '-90', 'P').deg).toBe(270)
    expect(pt(c, '-90', 'P').coords.text).toBe('(0, −6)')
    const q = pt(c, '(0, 6)', 'Q')
    expect(q.deg).toBe(90)
    expect(q.moved).toBe(false)
    // off the circle: moved onto it along the radius
    const m = pt(c, '(0, 2)', 'R')
    expect(m.moved).toBe(true)
    expect(m.coords.text).toBe('(0, 6)')
    expect(readCirclePoint('(0, 0)', c, 'P').ok).toBe(false)
    expect(readCirclePoint('banana', c, 'P').ok).toBe(false)
    // shifted centre: 2 + 3√3
    const c2 = makeCircle(2, 1, 6)!
    expect(pt(c2, '30°', 'P').coords.text).toBe('(2 + 3√3, 4)')
  })

  it('radians of special angles', () => {
    expect(radiansOf(120).text).toBe('2π/3')
    expect(radiansOf(180).text).toBe('π')
    expect(radiansOf(315).text).toBe('7π/4')
    expect(radiansOf(41.3).exact).toBe(false)
  })
})

describe('inscribed and central angles', () => {
  const c = makeCircle(0, 0, 6)!
  it('the inscribed angle is half the central angle on the same arc', () => {
    const r = inscribedCentral(c, pt(c, '30°', 'P'), pt(c, '150°', 'Q'), pt(c, '270°', 'R'))
    if ('error' in r) throw new Error(r.error)
    expect(r.central.text).toBe('120°')
    expect(r.inscribed.text).toBe('60°')
    expect(r.inscribed.deg * 2).toBeCloseTo(r.central.deg, 9)
    expect(r.relation).toBe('∠PRQ = ½·∠POQ: 60° = ½ · 120°')
    expect(r.diameter).toBe(false)
  })
  it('uses the arc the vertex is not on (a reflex central angle)', () => {
    const r = inscribedCentral(c, pt(c, '30°', 'P'), pt(c, '150°', 'Q'), pt(c, '90°', 'R'))
    if ('error' in r) throw new Error(r.error)
    expect(r.central.deg).toBeCloseTo(240, 9)
    expect(r.central.reflex).toBe(true)
    expect(r.inscribed.text).toBe('120°')
  })
  it('an angle inscribed in a semicircle is a right angle', () => {
    const r = inscribedCentral(c, pt(c, '0°', 'P'), pt(c, '180°', 'Q'), pt(c, '(0, -6)', 'R'))
    if ('error' in r) throw new Error(r.error)
    expect(r.diameter).toBe(true)
    expect(r.inscribed.text).toBe('90°')
    expect(r.relation).toContain('is a diameter, so ∠PRQ = ½ · 180° = 90°')
  })
  it('any inscribed angle on the same arc is the same', () => {
    const P = pt(c, '10°', 'P')
    const Q = pt(c, '100°', 'Q')
    for (const d of [140, 200, 250, 330]) {
      const r = inscribedCentral(c, P, Q, pt(c, `${d}`, 'R'))
      if ('error' in r) throw new Error(r.error)
      expect(r.inscribed.deg).toBeCloseTo(45, 9)
    }
  })
  it('refuses coincident points', () => {
    const P = pt(c, '10°', 'P')
    expect('error' in inscribedCentral(c, P, P, pt(c, '50', 'R'))).toBe(true)
  })
})

describe('the tangent at a point', () => {
  it('is perpendicular to the radius, with its equation exact', () => {
    const c = makeCircle(0, 0, 5)!
    const t = tangentAt(c, pt(c, '(3, 4)', 'P'))!
    expect(t.line.slopeIntercept.text).toBe('y = (−3/4)x + 25/4')
    expect(t.radiusSlope.value * t.line.slope.value).toBeCloseTo(-1, 12)
    expect(t.reason).toContain('multiply to −1')
  })
  it('at an irrational point', () => {
    const c = makeCircle(0, 0, 6)!
    const t = tangentAt(c, pt(c, '30°', 'P'))!
    expect(t.line.slopeIntercept.text).toBe('y = −√3x + 12')
  })
  it('vertical and horizontal tangents', () => {
    const c = makeCircle(1, 2, 3)!
    expect(tangentAt(c, pt(c, '0', 'P'))!.line.slopeIntercept.text).toBe('x = 4')
    const top = tangentAt(c, pt(c, '90', 'P'))!
    expect(top.line.slopeIntercept.text).toBe('y = 5')
    expect(top.reason).toContain('vertical')
  })
})

describe('arc length and sector area', () => {
  it('θ = 2π/3, r = 6 → s = 4π, A = 12π', () => {
    const c = makeCircle(0, 0, 6)!
    const s = sectorOf(c, pt(c, '30°', 'P'), pt(c, '150°', 'Q'))
    if ('error' in s) throw new Error(s.error)
    expect(s.theta.text).toBe('2π/3')
    expect(s.arc.text).toBe('4π')
    expect(s.area.text).toBe('12π')
    expect(s.arc.value).toBeCloseTo(4 * Math.PI, 12)
    expect(s.area.value).toBeCloseTo(12 * Math.PI, 12)
    expect(s.arcRadian).toBe('s = rθ = 6 · 2π/3 = 4π')
    expect(s.areaRadian).toBe('A = ½r²θ = ½ · 36 · 2π/3 = 12π')
    expect(s.arcDegree).toBe('s = (120/360) · 2π · 6 = 4π')
    expect(s.areaDegree).toBe('A = (120/360) · π · 6² = 12π')
    expect(s.radianDef).toContain('θ = s/r = 4π ÷ 6 = 2π/3')
  })
  it('counterclockwise from P to Q: the major sector', () => {
    const c = makeCircle(0, 0, 4)!
    const s = sectorOf(c, pt(c, '90', 'P'), pt(c, '0', 'Q'))
    if ('error' in s) throw new Error(s.error)
    expect(s.theta.text).toBe('3π/2')
    expect(s.arc.text).toBe('6π')
    expect(s.area.text).toBe('12π')
  })
  it('a surd radius', () => {
    const c = makeCircle(0, 0, Math.sqrt(2))!
    const s = sectorOf(c, pt(c, '0', 'P'), pt(c, '60', 'Q'))
    if ('error' in s) throw new Error(s.error)
    expect(s.arc.text).toBe('√2π/3')
    expect(s.area.text).toBe('π/3')
  })
  it('an angle that is not a nice multiple of π is a decimal', () => {
    const c = makeCircle(0, 0, 2)!
    const s = sectorOf(c, pt(c, '0', 'P'), pt(c, '(1, 1.7)', 'Q'))
    if ('error' in s) throw new Error(s.error)
    expect(s.arc.exact).toBe(false)
    expect(s.arc.text.startsWith('≈')).toBe(true)
  })
})

describe('chords, tangents and secants', () => {
  it('intersecting chords: PE·EQ = RE·ES = r² − OE²', () => {
    const c = makeCircle(0, 0, 5)!
    const r = chordsCross(c, pt(c, '(-4, 3)', 'P'), pt(c, '(4, 3)', 'Q'), pt(c, '(3, 4)', 'R'), pt(c, '(3, -4)', 'S'))
    if ('error' in r) throw new Error(r.error)
    expect(r.eText.text).toBe('(3, 3)')
    expect(r.product.text).toBe('7')
    expect(r.pe.value * r.eq.value).toBeCloseTo(7, 12)
    expect(r.re.value * r.es.value).toBeCloseTo(7, 12)
    expect(r.left).toBe('PE · EQ = 7 · 1 = 7')
    expect(r.right).toBe('RE · ES = 1 · 7 = 7')
    expect(r.power).toBe('both equal r² − OE² = 25 − 18 = 7')
  })
  it('chords that do not cross say so', () => {
    const c = makeCircle(0, 0, 5)!
    const r = chordsCross(c, pt(c, '0', 'P'), pt(c, '90', 'Q'), pt(c, '180', 'R'), pt(c, '270', 'S'))
    expect('error' in r).toBe(true)
  })
  it('two tangents from an outside point are equal; tangent–secant', () => {
    const c = makeCircle(0, 0, 3)!
    const r = tangentsFrom(c, { x: 5, y: 0 }, pt(c, '(-3, 0)', 'P'))
    if ('error' in r) throw new Error(r.error)
    expect(r.length.text).toBe('4')
    expect(r.lengthText).toBe('TA = TB = √(OT² − r²) = √(25 − 9) = 4')
    const ta = Math.hypot(r.A.x - 5, r.A.y)
    const tb = Math.hypot(r.B.x - 5, r.B.y)
    expect(ta).toBeCloseTo(4, 12)
    expect(tb).toBeCloseTo(4, 12)
    // the radius to each point of tangency is perpendicular to the tangent
    expect(r.A.x * (r.A.x - 5) + r.A.y * r.A.y).toBeCloseTo(0, 12)
    expect(r.secant).not.toBeNull()
    expect(r.secant!.tp.text).toBe('8')
    expect(r.secant!.tp2.text).toBe('2')
    expect(r.secant!.text).toBe('TA² = TP · TP′: 16 = 8 · 2')
  })
  it('a point inside has no tangents', () => {
    const c = makeCircle(0, 0, 3)!
    expect('error' in tangentsFrom(c, { x: 1, y: 1 })).toBe(true)
  })
})

describe('completing the square (G-GPE.1)', () => {
  it('x² + y² − 4x + 6y − 3 = 0 → (x − 2)² + (y + 3)² = 16', () => {
    const s = circleSquareSteps('x^2 + y^2 - 4x + 6y - 3 = 0')!
    expect(s).not.toBeNull()
    expect(s.steps.map((x) => x.tex)).toEqual([
      'x^{2} + y^{2} - 4x + 6y - 3 = 0',
      '\\left(x^{2} - 4x\\right) + \\left(y^{2} + 6y\\right) = 3',
      '\\left(x^{2} - 4x + 4\\right) + \\left(y^{2} + 6y + 9\\right) = 3 + 4 + 9',
      '\\left(x - 2\\right)^{2} + \\left(y + 3\\right)^{2} = 16',
    ])
    expect(s.centreText).toBe('(2, −3)')
    expect(s.radiusText).toBe('4')
    expect(s.steps[2].why).toContain('(−4/2)² = 4, (6/2)² = 9')
  })
  it('divides out a common leading coefficient', () => {
    const s = circleSquareSteps('2x^2 + 2y^2 + 8x - 10 = 0')!
    expect(s.steps[0].tex).toBe('2x^{2} + 2y^{2} + 8x - 10 = 0')
    expect(s.steps[1].tex).toBe('x^{2} + y^{2} + 4x - 5 = 0')
    expect(s.steps[s.steps.length - 1].tex).toBe('\\left(x + 2\\right)^{2} + y^{2} = 9')
    expect(s.radiusText).toBe('3')
  })
  it('a surd radius', () => {
    const s = circleSquareSteps('x^2 + y^2 + 2x - 4y - 5 = 0')!
    expect(s.radiusText).toBe('√10')
    expect(s.r2Text).toBe('10')
  })
  it('not a circle → null', () => {
    expect(circleSquareSteps('x^2 + 4y^2 = 4')).toBeNull()
    expect(circleSquareSteps('x^2 + y^2 + 10 = 0')).toBeNull()
    expect(circleSquareSteps('y = x^2')).toBeNull()
  })
})

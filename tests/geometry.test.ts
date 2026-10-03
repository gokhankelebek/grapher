// ============================================================================
// tests/geometry.test.ts — coordinate geometry for NC Math 1 / Math 2:
// distance, midpoint, endpoint, slope, the line through two points, ‖ and ⊥,
// perimeter, shoelace area, interior angles, classification of triangles and
// quadrilaterals (with the "also a …" rule), right-triangle trig ratios and
// the special right triangles.
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { Vec2 } from '../src/core/types'
import {
  angleAt,
  classifyPolygon,
  classifyQuadrilateral,
  classifyTriangle,
  dec,
  distance,
  endpointFrom,
  equalGroups,
  interiorAngles,
  isSelfIntersecting,
  lineRelativeTo,
  lineThrough,
  midpoint,
  perimeter,
  perpSlope,
  polygonReport,
  pythagoreanTest,
  relation,
  rightTriangle,
  segmentReport,
  shoelace,
  slope,
  sqrtRat,
  surdOf,
  surdText,
  toRat,
  vertexNames,
  withApprox,
} from '../src/core/geometry'

const P = (x: number, y: number): Vec2 => ({ x, y })
const pts = (...xy: number[]): Vec2[] => {
  const out: Vec2[] = []
  for (let i = 0; i < xy.length; i += 2) out.push(P(xy[i], xy[i + 1]))
  return out
}
const ABCD = ['A', 'B', 'C', 'D']
const ABC = ['A', 'B', 'C']

describe('rationals and surds', () => {
  it('reads coordinates as fractions with small denominators only', () => {
    expect(toRat(2.5)).toEqual({ n: 5, d: 2 })
    expect(toRat(-1 / 3)).toEqual({ n: -1, d: 3 })
    expect(toRat(0)).toEqual({ n: 0, d: 1 })
    expect(toRat(3.9583)).toBeNull()
    expect(toRat(Math.SQRT2)).toBeNull()
  })
  it('simplifies square roots of fractions', () => {
    expect(surdText(sqrtRat({ n: 45, d: 4 })!)).toBe('3√5/2')
    expect(surdText(sqrtRat({ n: 12, d: 1 })!)).toBe('2√3')
    expect(surdText(sqrtRat({ n: 25, d: 1 })!)).toBe('5')
    expect(surdText(sqrtRat({ n: 1, d: 2 })!)).toBe('√2/2')
  })
  it('recognises a surd from its square', () => {
    expect(surdText(surdOf(2 * Math.sqrt(3))!)).toBe('2√3')
    expect(surdText(surdOf(-Math.sqrt(3) / 3)!)).toBe('−√3/3')
    expect(surdOf(Math.PI)).toBeNull()
  })
})

describe('distance, midpoint, endpoint', () => {
  it('distance is exact: √13, 5, 2√5', () => {
    expect(distance(P(1, 2), P(3, 5)).text).toBe('√13')
    expect(distance(P(0, 0), P(3, 4)).text).toBe('5')
    expect(distance(P(-1, -1), P(1, 3)).text).toBe('2√5')
    expect(withApprox(distance(P(1, 2), P(3, 5)))).toBe('√13 ≈ 3.61')
    expect(withApprox(distance(P(0, 0), P(3, 4)))).toBe('5')
  })
  it('distance with fractional coordinates', () => {
    expect(distance(P(0, 0), P(0.5, 0.5)).text).toBe('√2/2')
    expect(distance(P(0, 0), P(1.5, 2)).text).toBe('5/2')
  })
  it('distance with irrational coordinates still exact through the square', () => {
    expect(distance(P(0, 0), P(0, 2 * Math.sqrt(3))).text).toBe('2√3')
    expect(distance(P(2, 0), P(0, 2 * Math.sqrt(3))).text).toBe('4')
  })
  it('an unsnapped decimal coordinate gives a decimal, not a monstrous fraction', () => {
    const d = distance(P(0, 0), P(3.9583, 2.9917))
    expect(d.exact).toBe(false)
    expect(withApprox(d)).toBe('≈ 4.96')
  })
  it('midpoint (5/2, 3)', () => {
    const m = midpoint(P(1, 2), P(4, 4))
    expect(m.text).toBe('(5/2, 3)')
    expect(m.pt).toEqual({ x: 2.5, y: 3 })
    expect(midpoint(P(-3, 1), P(-1, -4)).text).toBe('(−2, −3/2)')
    expect(m.tex).toBe('\\left(\\frac{5}{2}, 3\\right)')
  })
  it('the other endpoint from a midpoint and one endpoint: B = 2M − A', () => {
    expect(endpointFrom(P(2, 3), P(-1, 5)).text).toBe('(5, 1)')
    expect(endpointFrom(P(0.5, 0), P(0, 0)).text).toBe('(1, 0)')
    // round trip
    const B = endpointFrom(P(1.5, -2), P(4, 7)).pt
    expect(midpoint(P(4, 7), B).pt).toEqual({ x: 1.5, y: -2 })
  })
})

describe('slopes', () => {
  it('fractions, negatives and zero', () => {
    expect(slope(P(0, 0), P(2, 1)).text).toBe('1/2')
    expect(slope(P(0, 3), P(1, 0)).text).toBe('−3')
    expect(slope(P(-2, 4), P(5, 4)).text).toBe('0')
    expect(slope(P(1, 2), P(4, 4)).text).toBe('2/3')
  })
  it('vertical is undefined', () => {
    const m = slope(P(4, 0), P(4, 3))
    expect(m.vertical).toBe(true)
    expect(m.text).toBe('undefined')
  })
  it('irrational slopes are recognised', () => {
    expect(slope(P(0, 0), P(1, Math.sqrt(3))).text).toBe('√3')
  })
  it('perpendicular slope is the negative reciprocal; horizontal ↔ vertical', () => {
    expect(perpSlope(slope(P(0, 0), P(4, 3))).text).toBe('−4/3')
    expect(perpSlope(slope(P(0, 0), P(4, 0))).vertical).toBe(true)
    expect(perpSlope(slope(P(0, 0), P(0, 4))).text).toBe('0')
  })
  it('the line through two points in slope-intercept and point-slope form', () => {
    const l = lineThrough(P(1, 2), P(3, 3))
    expect(l.slopeIntercept.text).toBe('y = (1/2)x + 3/2')
    expect(l.pointSlope.text).toBe('y − 2 = (1/2)(x − 1)')
    expect(l.slopeIntercept.tex).toBe('y = \\frac{1}{2}x + \\frac{3}{2}')
    expect(lineThrough(P(-2, -1), P(0, 5)).slopeIntercept.text).toBe('y = 3x + 5')
    expect(lineThrough(P(-2, -1), P(0, 5)).pointSlope.text).toBe('y + 1 = 3(x + 2)')
    expect(lineThrough(P(0, 0), P(2, -2)).slopeIntercept.text).toBe('y = −x')
    expect(lineThrough(P(4, 0), P(4, 3)).slopeIntercept.text).toBe('x = 4')
    expect(lineThrough(P(0, 3), P(5, 3)).slopeIntercept.text).toBe('y = 3')
    expect(lineThrough(P(0, 3), P(5, 3)).pointSlope.text).toBe('y − 3 = 0')
  })
})

describe('parallel and perpendicular', () => {
  it('parallel when the slopes are equal', () => {
    expect(relation(P(0, 0), P(4, 1), P(1, 3), P(5, 4))).toBe('parallel')
    expect(relation(P(0, 0), P(0, 4), P(2, -1), P(2, 7))).toBe('parallel')
  })
  it('perpendicular when the slopes multiply to −1, or horizontal meets vertical', () => {
    expect(relation(P(0, 0), P(4, 3), P(0, 0), P(-3, 4))).toBe('perpendicular')
    expect(relation(P(0, 0), P(4, 0), P(1, 1), P(1, 5))).toBe('perpendicular')
  })
  it('the same line, and neither', () => {
    expect(relation(P(0, 0), P(1, 1), P(2, 2), P(5, 5))).toBe('same')
    expect(relation(P(0, 0), P(1, 1), P(0, 0), P(1, 2))).toBe('neither')
  })
  it('a line through P parallel / perpendicular to AB', () => {
    const par = lineRelativeTo('parallel', P(0, 0), P(2, 1), P(1, 3))!
    expect(par.line.slopeIntercept.text).toBe('y = (1/2)x + 5/2')
    const perp = lineRelativeTo('perpendicular', P(0, 0), P(2, 1), P(1, 3))!
    expect(perp.line.slopeIntercept.text).toBe('y = −2x + 5')
    expect(lineRelativeTo('perpendicular', P(0, 0), P(4, 0), P(1, 3))!.line.slopeIntercept.text).toBe('x = 1')
    expect(lineRelativeTo('parallel', P(0, 0), P(0, 4), P(2, 3))!.line.slopeIntercept.text).toBe('x = 2')
  })
})

describe('perimeter and shoelace area', () => {
  it('perimeter collects like radicals', () => {
    expect(perimeter(pts(0, 0, 4, 1, 5, 4, 1, 3)).text).toBe('2√10 + 2√17')
    expect(perimeter(pts(0, 0, 4, 0, 4, 3)).text).toBe('12')
    expect(perimeter(pts(0, 0, 1, 0, 0, 1)).text).toBe('2 + √2')
  })
  const cases: [string, Vec2[], string][] = [
    ['right triangle', pts(0, 0, 4, 0, 4, 3), '6'],
    ['parallelogram', pts(0, 0, 4, 1, 5, 4, 1, 3), '11'],
    ['rectangle', pts(0, 0, 6, 0, 6, 2, 0, 2), '12'],
    ['half-unit triangle', pts(0, 0, 1, 0, 0, 1), '1/2'],
    ['concave arrowhead', pts(0, 0, 4, 2, 0, 4, 1, 2), '6'],
    ['pentagon', pts(0, 0, 4, 0, 5, 3, 2, 5, -1, 3), '21'],
    ['hexagon', pts(1, 0, 3, 0, 4, 2, 3, 4, 1, 4, 0, 2), '12'],
    ['clockwise trapezoid', pts(0, 0, 1, 3, 4, 3, 6, 0), '27/2'],
    ['negative coordinates', pts(-3, -2, 2, -1, 1, 4), '13'],
  ]
  for (const [name, p, area] of cases) {
    it(`shoelace: ${name} = ${area}`, () => {
      expect(shoelace(p).area.text).toBe(area)
    })
  }
  it('shows the working', () => {
    expect(shoelace(pts(0, 0, 4, 1, 5, 4, 1, 3)).working).toBe('½|0 + 11 + 11 + 0| = 11')
  })
})

describe('angles', () => {
  it('interior angles of a right triangle: 90° exact, others to one decimal', () => {
    const a = interiorAngles(pts(0, 0, 4, 0, 4, 3))
    expect(a.map((x) => x.text)).toEqual(['36.9°', '90°', '53.1°'])
    expect(a[1].right).toBe(true)
  })
  it('special angles exactly: 45° and 30/60', () => {
    expect(interiorAngles(pts(0, 0, 1, 0, 1, 1)).map((x) => x.text)).toEqual(['45°', '90°', '45°'])
    const t = interiorAngles([P(0, 0), P(Math.sqrt(3), 0), P(Math.sqrt(3), 1)])
    expect(t.map((x) => x.text)).toEqual(['30°', '90°', '60°'])
  })
  it('a concave vertex reads more than 180°, however the polygon is typed', () => {
    const ccw = interiorAngles(pts(0, 0, 4, 2, 0, 4, 1, 2))
    expect(ccw[3].reflex).toBe(true)
    const cw = interiorAngles(pts(1, 2, 0, 4, 4, 2, 0, 0))
    expect(cw[0].reflex).toBe(true)
    const sum = ccw.reduce((s, x) => s + x.deg, 0)
    expect(sum).toBeCloseTo(360, 9)
  })
  it('the angle sum of any simple polygon is (n − 2)·180°', () => {
    const hex = interiorAngles(pts(1, 0, 3, 0, 4, 2, 3, 4, 1, 4, 0, 2))
    expect(hex.reduce((s, x) => s + x.deg, 0)).toBeCloseTo(720, 9)
  })
  it('angleAt', () => {
    expect(angleAt(P(1, 0), P(0, 0), P(0, 1))).toBeCloseTo(90, 12)
  })
})

describe('triangle classification', () => {
  it('right scalene, with the ⊥ reason', () => {
    const c = classifyTriangle(pts(0, 0, 4, 0, 4, 3), ABC)
    expect(c.name).toBe('right scalene triangle')
    expect(c.sentence).toContain('AB ⊥ BC')
    expect(c.sentence).toContain('So △ABC is a right scalene triangle')
  })
  it('right isosceles', () => {
    expect(classifyTriangle(pts(0, 0, 3, 0, 0, 3), ABC).name).toBe('right isosceles triangle')
  })
  it('acute isosceles and obtuse scalene', () => {
    expect(classifyTriangle(pts(0, 0, 4, 0, 2, 5), ABC).name).toBe('acute isosceles triangle')
    const ob = classifyTriangle(pts(0, 0, 5, 0, -2, 2), ABC)
    expect(ob.name).toBe('obtuse scalene triangle')
    expect(ob.sentence).toContain('is obtuse')
  })
  it('equilateral (irrational coordinates)', () => {
    const c = classifyTriangle([P(0, 0), P(2, 0), P(1, Math.sqrt(3))], ABC)
    expect(c.name).toBe('equilateral triangle')
    expect(c.also).toContain('isosceles triangle')
  })
  it('collinear points are not a triangle', () => {
    expect(classifyTriangle(pts(0, 0, 1, 1, 2, 2), ABC).name).toBe('degenerate triangle')
  })
  it('the converse of Pythagoras for a non-right triangle', () => {
    expect(pythagoreanTest(pts(0, 0, 4, 0, 2, 5), ABC)).toMatch(/so the triangle is acute/)
    expect(pythagoreanTest(pts(0, 0, 5, 0, -2, 2), ABC)).toMatch(/< .* so the triangle is obtuse/)
  })
})

describe('quadrilateral classification', () => {
  const q = (...xy: number[]) => classifyQuadrilateral(pts(...xy), ABCD)

  it('parallelogram, justified in slopes', () => {
    const c = q(0, 0, 4, 1, 5, 4, 1, 3)
    expect(c.name).toBe('parallelogram')
    expect(c.sentence).toBe('AB ‖ DC (slope 1/4) and AD ‖ BC (slope 3), so ABCD is a parallelogram.')
    expect(c.also).toEqual([])
  })
  it('rectangle (tilted): parallel pairs and a right angle', () => {
    const c = q(0, 0, 4, 2, 3, 4, -1, 2)
    expect(c.name).toBe('rectangle')
    expect(c.also).toEqual(['parallelogram'])
    expect(c.sentence).toContain('AB ⊥ BC (their slopes 1/2 and −2 multiply to −1)')
  })
  it('axis-aligned rectangle: horizontal meets vertical', () => {
    const c = q(0, 0, 5, 0, 5, 3, 0, 3)
    expect(c.name).toBe('rectangle')
    expect(c.sentence).toContain('horizontal')
  })
  it('rhombus', () => {
    const c = q(0, 0, 3, 1, 4, 4, 1, 3)
    expect(c.name).toBe('rhombus')
    expect(c.also).toEqual(['parallelogram', 'kite'])
    expect(c.sentence).toContain('all four sides are √10')
  })
  it('a square is reported as a square — and also a rectangle and a rhombus', () => {
    const c = q(0, 0, 3, 1, 2, 4, -1, 3)
    expect(c.name).toBe('square')
    expect(c.also.slice(0, 3)).toEqual(['rectangle', 'rhombus', 'parallelogram'])
    expect(c.sentence).toMatch(/It is also a rectangle, a rhombus, a parallelogram and a kite\.$/)
    expect(q(0, 0, 2, 0, 2, 2, 0, 2).name).toBe('square')
  })
  it('trapezoid, isosceles trapezoid, right trapezoid', () => {
    expect(q(0, 0, 6, 0, 5, 3, 2, 3).name).toBe('trapezoid')
    const iso = q(0, 0, 6, 0, 5, 3, 1, 3)
    expect(iso.name).toBe('isosceles trapezoid')
    expect(iso.also).toEqual(['trapezoid'])
    expect(iso.sentence).toContain('the legs')
    expect(q(0, 0, 6, 0, 4, 3, 0, 3).name).toBe('right trapezoid')
    // bases on the other pair of sides
    expect(q(0, 0, 3, 0, 3, 6, 0, 4).name).toBe('right trapezoid')
    expect(q(0, 0, 3, 1, 3, 5, 0, 7).name).toBe('trapezoid')
  })
  it('kite, and a concave kite (dart)', () => {
    expect(q(0, 0, 2, -1, 4, 0, 2, 3).name).toBe('kite')
    expect(q(0, 3, -2, 0, 0, 1, 2, 0).name).toBe('kite')
  })
  it('a general quadrilateral has no special name', () => {
    const c = q(0, 0, 5, 0, 4, 3, 1, 2)
    expect(c.name).toBe('quadrilateral')
    expect(c.sentence).toContain('no special name')
  })
  it('edge cases: crossed and degenerate', () => {
    expect(q(0, 0, 4, 4, 4, 0, 0, 4).name).toBe('crossed quadrilateral')
    expect(isSelfIntersecting(pts(0, 0, 4, 4, 4, 0, 0, 4))).toBe(true)
    expect(q(0, 0, 1, 0, 2, 0, 3, 0).name).toBe('degenerate quadrilateral')
    expect(q(0, 0, 0, 0, 2, 2, 0, 2).name).toBe('degenerate quadrilateral')
  })
  it('vertex order does not change the verdict (clockwise square)', () => {
    expect(q(0, 0, 0, 2, 2, 2, 2, 0).name).toBe('square')
  })
  it('polygons with more sides: regular, convex, concave', () => {
    const hexR = [0, 1, 2, 3, 4, 5].map((k) => P(Math.cos((k * Math.PI) / 3), Math.sin((k * Math.PI) / 3)))
    expect(classifyPolygon(hexR, vertexNames(6)).name).toBe('regular hexagon')
    expect(classifyPolygon(pts(0, 0, 4, 0, 5, 3, 2, 5, -1, 3), vertexNames(5)).name).toBe('convex pentagon')
    expect(classifyPolygon(pts(0, 0, 4, 0, 4, 4, 2, 1, 0, 4), vertexNames(5)).name).toBe('concave pentagon')
  })
})

describe('right triangles', () => {
  it('finds the right angle and checks Pythagoras: 4² + 3² = 5²', () => {
    const r = rightTriangle(pts(0, 0, 4, 0, 4, 3), ABC)!
    expect(r.right).toBe(1)
    expect(r.pythag.names).toBe('AB² + BC² = CA²')
    expect(r.pythag.values).toBe('4² + 3² = 5²')
    expect(r.pythag.sums).toBe('16 + 9 = 25')
  })
  it('sin, cos and tan of each acute angle as exact ratios', () => {
    const r = rightTriangle(pts(0, 0, 4, 0, 4, 3), ABC)!
    const A = r.trig.find((t) => t.name === 'A')!
    expect(A.sin.ratio).toBe('BC/CA')
    expect(A.sin.value.text).toBe('3/5')
    expect(A.cos.value.text).toBe('4/5')
    expect(A.tan.value.text).toBe('3/4')
    const C = r.trig.find((t) => t.name === 'C')!
    expect(C.sin.value.text).toBe('4/5')
    expect(C.tan.value.text).toBe('4/3')
    // sin A = cos C: complementary angles
    expect(A.sin.value.text).toBe(C.cos.value.text)
  })
  it('irrational ratios are simplified surds', () => {
    const r = rightTriangle(pts(0, 0, 2, 0, 2, 3), ABC)!
    const A = r.trig.find((t) => t.name === 'A')!
    expect(A.sin.value.text).toBe('3√13/13')
    expect(A.tan.value.text).toBe('3/2')
  })
  it('surd sides in the Pythagorean check', () => {
    const r = rightTriangle(pts(0, 0, 2, 0, 2, 3), ABC)!
    expect(r.pythag.values).toBe('2² + 3² = (√13)²')
  })
  it('not right → null', () => {
    expect(rightTriangle(pts(0, 0, 4, 0, 2, 5), ABC)).toBeNull()
  })
})

describe('special right triangles', () => {
  it('45-45-90: 1 : 1 : √2', () => {
    const r = rightTriangle(pts(0, 0, 3, 0, 3, 3), ABC)!
    expect(r.special?.kind).toBe('45-45-90')
    expect(r.special?.text).toBe('AB : BC : CA = 3 : 3 : 3√2')
    expect(r.special?.ratio).toBe('1 : 1 : √2')
    const A = r.trig.find((t) => t.name === 'A')!
    expect(A.sin.value.text).toBe('√2/2')
    expect(A.tan.value.text).toBe('1')
  })
  it('30-60-90: 1 : √3 : 2 (short leg : long leg : hypotenuse)', () => {
    const r = rightTriangle([P(0, 0), P(2 * Math.sqrt(3), 0), P(2 * Math.sqrt(3), 2)], ABC)!
    expect(r.special?.kind).toBe('30-60-90')
    expect(r.special?.text).toBe('BC : AB : CA = 2 : 2√3 : 4')
    const A = r.trig.find((t) => t.name === 'A')!
    expect(A.angle.text).toBe('30°')
    expect(A.sin.value.text).toBe('1/2')
    expect(A.cos.value.text).toBe('√3/2')
    expect(A.tan.value.text).toBe('√3/3')
  })
  it('30-60-90 with the right angle at A, typed the other way round', () => {
    const r = rightTriangle([P(0, 0), P(0, 2), P(2 * Math.sqrt(3), 0)], ABC)!
    expect(r.right).toBe(0)
    expect(r.special?.kind).toBe('30-60-90')
  })
  it('3-4-5 is not special', () => {
    expect(rightTriangle(pts(0, 0, 4, 0, 4, 3), ABC)!.special).toBeNull()
  })
})

describe('reports', () => {
  it('polygonReport bundles everything and groups equal sides and angles', () => {
    const r = polygonReport(pts(0, 0, 4, 1, 5, 4, 1, 3), ABCD)!
    expect(r.sides.map((s) => s.name)).toEqual(['AB', 'BC', 'CD', 'DA'])
    expect(r.sides.map((s) => s.length.text)).toEqual(['√17', '√10', '√17', '√10'])
    expect(r.sides.map((s) => s.slope.text)).toEqual(['1/4', '3', '1/4', '3'])
    expect(r.sideGroups).toEqual([1, 2, 1, 2])
    expect(r.angleGroups).toEqual([1, 2, 1, 2])
    expect(r.area.area.text).toBe('11')
    expect(r.classification.name).toBe('parallelogram')
    expect(r.pairs.map((p) => p.text)).toEqual(['AB ‖ CD (slope 1/4)', 'BC ‖ DA (slope 3)'])
    expect(r.angleSum).toBe('(4 − 2)·180° = 360°')
  })
  it('right angles get squares, not arc marks', () => {
    const r = polygonReport(pts(0, 0, 4, 0, 4, 3, 0, 3), ABCD)!
    expect(r.angleGroups).toEqual([0, 0, 0, 0])
    expect(r.sideGroups).toEqual([1, 2, 1, 2])
  })
  it('unnamed polygons are measured with A, B, C… in the order typed', () => {
    expect(vertexNames(3)).toEqual(['A', 'B', 'C'])
    expect(vertexNames(3, ['P', '', 'R'])).toEqual(['P', 'B', 'R'])
    expect(polygonReport(pts(0, 0, 4, 0, 4, 3))!.classification.short).toBe('△ABC: right scalene triangle')
  })
  it('segmentReport', () => {
    const s = segmentReport(P(1, 2), P(4, 6), ['P', 'Q'])!
    expect(s.length.text).toBe('5')
    expect(s.slope.text).toBe('4/3')
    expect(s.midpoint.text).toBe('(5/2, 4)')
    expect(s.line.slopeIntercept.text).toBe('y = (4/3)x + 2/3')
  })
  it('equalGroups numbers groups in order and leaves singletons 0', () => {
    expect(equalGroups([1, 2, 1, 3, 2, 4], (a, b) => a === b)).toEqual([1, 2, 1, 0, 2, 0])
  })
  it('dec trims and uses a real minus', () => {
    expect(dec(-2.5, 2)).toBe('−2.5')
    expect(dec(-0.001, 2)).toBe('0')
  })
})

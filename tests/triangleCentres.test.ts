import { describe, expect, it } from 'vitest'
import { triangleCentres, centreFacts } from '../src/core/triangleCentres'

const P = (x: number, y: number) => ({ x, y })

describe('triangle centres — exact coordinates', () => {
  it('scalene acute: G, O, H rational, R a surd, Euler HG = 2·GO', () => {
    const t = triangleCentres([P(0, 0), P(6, 0), P(2, 4)])!
    expect(t).not.toBeNull()
    expect(t.kind).toBe('acute')
    expect(t.centroid.pt.text).toBe('(8/3, 4/3)')
    expect(t.circumcentre.pt.text).toBe('(3, 1)')
    expect(t.circumradius.text).toBe('√10')
    expect(t.orthocentre.pt.text).toBe('(2, 2)')
    for (const k of ['centroid', 'circumcentre', 'incentre', 'orthocentre'] as const) expect(t[k].where).toBe('inside')
    expect(t.euler).not.toBeNull()
    expect(t.euler!.go.text).toBe('√2/3')
    expect(t.euler!.hg.text).toBe('2√2/3')
    expect(t.euler!.hg.value / t.euler!.go.value).toBeCloseTo(2, 12)
    expect(t.euler!.ratioText).toBe('HG = 2·GO: 2√2/3 = 2 · √2/3')
    expect(t.notes.some((n) => n.includes('acute, so all four centres lie inside'))).toBe(true)
    // the incentre is irrational here: a decimal (or a clean closed form), never wrong
    const I = t.incentre.pt.pt
    const a = Math.hypot(4, 4) // BC
    const b = Math.hypot(2, 4) // CA
    const c = 6 // AB
    expect(I.x).toBeCloseTo((a * 0 + b * 6 + c * 2) / (a + b + c), 12)
  })

  it('right triangle: O is the midpoint of the hypotenuse, H the right-angle vertex, I and r exact', () => {
    const t = triangleCentres([P(0, 0), P(4, 0), P(0, 3)])!
    expect(t.kind).toBe('right')
    expect(t.special).toBe(0)
    expect(t.circumcentre.pt.text).toBe('(2, 3/2)')
    expect(t.circumcentre.where).toBe('on')
    expect(t.circumradius.text).toBe('5/2')
    expect(t.orthocentre.pt.text).toBe('(0, 0)')
    expect(t.incentre.pt.text).toBe('(1, 1)')
    expect(t.incentre.exact).toBe(true)
    expect(t.inradius.text).toBe('1')
    expect(t.centroid.pt.text).toBe('(4/3, 1)')
    expect(t.notes.join(' ')).toContain('the circumcentre O is the midpoint of the hypotenuse BC and R = BC/2 = 5/2')
    expect(t.notes.join(' ')).toContain('The orthocentre H is the right-angle vertex A')
  })

  it('obtuse triangle: O and H outside, the note says so; altitudes extended', () => {
    const t = triangleCentres([P(0, 0), P(6, 0), P(1, 2)], ['A', 'B', 'C'])!
    expect(t.kind).toBe('obtuse')
    expect(t.special).toBe(2)
    expect(t.circumcentre.pt.text).toBe('(3, −1/4)')
    expect(t.orthocentre.pt.text).toBe('(1, 5/2)')
    expect(t.circumcentre.where).toBe('outside')
    expect(t.orthocentre.where).toBe('outside')
    expect(t.centroid.where).toBe('inside')
    expect(t.incentre.where).toBe('inside')
    expect(t.notes.join(' ')).toContain('obtuse at C')
    expect(t.notes.join(' ')).toContain('lie outside the triangle')
    // feet of the altitudes from the acute vertices land off the opposite sides
    expect(t.footOutside.filter((x) => x).length).toBe(2)
    expect(centreFacts(t, 'orthocentre')[0]).toContain('extended')
    // Euler: H, G, O collinear and HG = 2·GO
    const { centroid: G, circumcentre: O, orthocentre: H } = t
    const cross = (O.pt.pt.x - H.pt.pt.x) * (G.pt.pt.y - H.pt.pt.y) - (O.pt.pt.y - H.pt.pt.y) * (G.pt.pt.x - H.pt.pt.x)
    expect(Math.abs(cross)).toBeLessThan(1e-9)
    expect(t.euler!.hg.value).toBeCloseTo(2 * t.euler!.go.value, 12)
  })

  it('equilateral: all four centres coincide, no Euler line', () => {
    const t = triangleCentres([P(0, 0), P(2, 0), P(1, Math.sqrt(3))])!
    expect(t.equilateral).toBe(true)
    expect(t.euler).toBeNull()
    for (const k of ['centroid', 'circumcentre', 'incentre', 'orthocentre'] as const) {
      expect(t[k].pt.text).toBe('(1, √3/3)')
    }
    expect(t.circumradius.text).toBe('2√3/3')
    expect(t.inradius.text).toBe('√3/3')
    expect(t.notes[0]).toContain('equilateral, so its centroid, circumcentre, incentre and orthocentre are one point')
  })

  it('isosceles: the centres lie on the axis of symmetry', () => {
    const t = triangleCentres([P(0, 4), P(-3, 0), P(3, 0)])!
    expect(t.apex).toBe(0)
    for (const k of ['centroid', 'circumcentre', 'incentre', 'orthocentre'] as const) expect(t[k].pt.pt.x).toBeCloseTo(0, 12)
    expect(t.incentre.pt.text).toBe('(0, 3/2)')
    expect(t.notes.join(' ')).toContain('isosceles (AB = AC)')
  })

  it('collinear points have no centres', () => {
    expect(triangleCentres([P(0, 0), P(1, 1), P(2, 2)])).toBeNull()
    expect(triangleCentres([P(0, 0), P(1, 1)])).toBeNull()
  })

  it('the incentre is equidistant from the sides, the circumcentre from the vertices', () => {
    const pts = [P(-2, 1), P(5, -1), P(1, 6)]
    const t = triangleCentres(pts)!
    const O = t.circumcentre.pt.pt
    const ds = pts.map((p) => Math.hypot(p.x - O.x, p.y - O.y))
    expect(ds[1]).toBeCloseTo(ds[0], 10)
    expect(ds[2]).toBeCloseTo(ds[0], 10)
    expect(t.circumradius.value).toBeCloseTo(ds[0], 10)
    const I = t.incentre.pt.pt
    const dLine = (u: { x: number; y: number }, v: { x: number; y: number }) =>
      Math.abs((v.x - u.x) * (u.y - I.y) - (u.x - I.x) * (v.y - u.y)) / Math.hypot(v.x - u.x, v.y - u.y)
    expect(dLine(pts[0], pts[1])).toBeCloseTo(t.inradius.value, 10)
    expect(dLine(pts[1], pts[2])).toBeCloseTo(t.inradius.value, 10)
    expect(dLine(pts[2], pts[0])).toBeCloseTo(t.inradius.value, 10)
    // the touch points are on the incircle
    for (const p of t.touch) expect(Math.hypot(p.x - I.x, p.y - I.y)).toBeCloseTo(t.inradius.value, 10)
  })
})

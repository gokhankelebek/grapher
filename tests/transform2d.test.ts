// ============================================================================
// tests/transform2d.test.ts — transformations of figures (NC Math 2 G-CO.2–8,
// G-SRT.1–3, F-IF.1–2): exact images, textbook mapping notation, compositions,
// classification, find-the-motion, symmetry, and the triangle criteria.
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { Vec2 } from '../src/core/types'
import {
  applyMotion,
  classifyAffine,
  compareFigures,
  compareTriangles,
  composeMotions,
  criterionFromGivens,
  findMotion,
  identify,
  motionAffine,
  motionName,
  motionRule,
  motionWords,
  preservedChecks,
  primeName,
  primeTex,
  siblingName,
  symmetryOf,
} from '../src/core/transform2d'
import type { Motion } from '../src/core/transform2d'

const O: Vec2 = { x: 0, y: 0 }
const pt = (x: number, y: number): Vec2 => ({ x, y })
const ABC = [pt(1, 2), pt(4, 2), pt(4, 6)]
const img = (m: Motion, pts: readonly Vec2[]) => pts.map((p) => applyMotion(m, p))

describe('every transformation, exactly', () => {
  it('translation by ⟨a, b⟩', () => {
    const m: Motion = { kind: 'translate', v: pt(3, -2) }
    expect(img(m, ABC)).toEqual([pt(4, 0), pt(7, 0), pt(7, 4)])
    expect(motionRule(m).text).toBe('(x, y) → (x + 3, y − 2)')
    expect(motionName(m).text).toBe('T_{⟨3, −2⟩}')
    expect(motionWords(m)).toBe('a translation 3 units right and 2 units down (by ⟨3, −2⟩)')
  })

  it('reflections across the axes, y = ±x, x = k, y = k and any line', () => {
    const P = pt(3, 1)
    const cases: [Motion, Vec2, string, string][] = [
      [{ kind: 'reflect', line: { kind: 'x-axis' } }, pt(3, -1), 'r_{x-axis}', '(x, y) → (x, −y)'],
      [{ kind: 'reflect', line: { kind: 'y-axis' } }, pt(-3, 1), 'r_{y-axis}', '(x, y) → (−x, y)'],
      [{ kind: 'reflect', line: { kind: 'y=x' } }, pt(1, 3), 'r_{y=x}', '(x, y) → (y, x)'],
      [{ kind: 'reflect', line: { kind: 'y=-x' } }, pt(-1, -3), 'r_{y=−x}', '(x, y) → (−y, −x)'],
      [{ kind: 'reflect', line: { kind: 'x=k', k: 2 } }, pt(1, 1), 'r_{x=2}', '(x, y) → (−x + 4, y)'],
      [{ kind: 'reflect', line: { kind: 'y=k', k: -1 } }, pt(3, -3), 'r_{y=−1}', '(x, y) → (x, −y − 2)'],
    ]
    for (const [m, want, name, rule] of cases) {
      expect(applyMotion(m, P)).toEqual(want)
      expect(motionName(m).text).toBe(name)
      expect(motionRule(m).text).toBe(rule)
    }
    // y = 2x through (0,0) and (1,2): (3, 1) → (−1, 3), with rational coefficients
    const line: Motion = { kind: 'reflect', line: { kind: 'line', p: O, q: pt(1, 2) } }
    expect(applyMotion(line, P)).toEqual(pt(-1, 3))
    expect(motionRule(line).text).toBe('(x, y) → (−(3/5)x + (4/5)y, (4/5)x + (3/5)y)')
    expect(motionName(line).text).toBe('r_{y=2x}')
  })

  it('rotations: exact quarter turns, special angles, cos θ written out otherwise', () => {
    const r90: Motion = { kind: 'rotate', deg: 90, center: O }
    expect(img(r90, ABC)).toEqual([pt(-2, 1), pt(-2, 4), pt(-6, 4)])
    expect(motionName(r90).text).toBe('R_{90°, O}')
    expect(motionRule(r90).text).toBe('(x, y) → (−y, x)')
    expect(motionRule({ kind: 'rotate', deg: 180, center: O }).text).toBe('(x, y) → (−x, −y)')
    expect(motionRule({ kind: 'rotate', deg: 270, center: O }).text).toBe('(x, y) → (y, −x)')
    expect(motionRule({ kind: 'rotate', deg: -90, center: O }).text).toBe('(x, y) → (y, −x)')
    // about (1, 1): (x, y) → (−y + 2, x)
    const about: Motion = { kind: 'rotate', deg: 90, center: pt(1, 1) }
    expect(motionRule(about).text).toBe('(x, y) → (−y + 2, x)')
    expect(motionName(about).text).toBe('R_{90°, (1, 1)}')
    expect(applyMotion(about, pt(3, 1))).toEqual(pt(1, 3))
    // 45°: (4, 0) → (2√2, 2√2), and the rule has √2/2
    const r45: Motion = { kind: 'rotate', deg: 45, center: O }
    const q = applyMotion(r45, pt(4, 0))
    expect(q.x).toBeCloseTo(2 * Math.SQRT2, 12)
    expect(motionRule(r45).text).toBe('(x, y) → ((√2/2)x − (√2/2)y, (√2/2)x + (√2/2)y)')
    expect(motionRule({ kind: 'rotate', deg: 30, center: O }).text).toBe('(x, y) → ((√3/2)x − (1/2)y, (1/2)x + (√3/2)y)')
    // 20°: no exact cosine — the textbook's own form
    expect(motionRule({ kind: 'rotate', deg: 20, center: O }).text).toBe('(x, y) → (x cos 20° − y sin 20°, x sin 20° + y cos 20°)')
    expect(motionWords(r90)).toBe('a rotation of 90° counterclockwise about the origin')
    expect(motionWords({ kind: 'rotate', deg: -90, center: pt(1, 1) })).toBe('a rotation of 90° clockwise about (1, 1)')
  })

  it('dilations: whole, fractional and negative scale factors', () => {
    const d2: Motion = { kind: 'dilate', k: 2, center: O }
    expect(motionRule(d2).text).toBe('(x, y) → (2x, 2y)')
    expect(motionName(d2).text).toBe('D_{2, O}')
    const half: Motion = { kind: 'dilate', k: 0.5, center: pt(1, 1) }
    expect(applyMotion(half, pt(5, 3))).toEqual(pt(3, 2))
    expect(motionRule(half).text).toBe('(x, y) → ((1/2)x + 1/2, (1/2)y + 1/2)')
    expect(motionName(half).text).toBe('D_{1/2, (1, 1)}')
    const neg: Motion = { kind: 'dilate', k: -2, center: O }
    expect(applyMotion(neg, pt(1, 3))).toEqual(pt(-2, -6))
    expect(motionRule(neg).text).toBe('(x, y) → (−2x, −2y)')
    // thirds stay exact
    expect(applyMotion({ kind: 'dilate', k: 1 / 3, center: O }, pt(1, 2))).toEqual(pt(1 / 3, 2 / 3))
  })
})

describe('classification: rigid or not, orientation', () => {
  it('isometries and similarities', () => {
    const k = (m: Motion) => classifyAffine(motionAffine(m))
    expect(k({ kind: 'translate', v: pt(1, 2) })).toMatchObject({ rigid: true, preservesOrientation: true })
    expect(k({ kind: 'rotate', deg: 37, center: pt(2, 5) })).toMatchObject({ rigid: true, preservesOrientation: true })
    expect(k({ kind: 'reflect', line: { kind: 'y=x' } })).toMatchObject({ rigid: true, preservesOrientation: false })
    const d = k({ kind: 'dilate', k: 3, center: O })
    expect(d.rigid).toBe(false)
    expect(d.similarity).toBe(true)
    expect(d.scale).toBeCloseTo(3, 12)
  })
})

describe('compositions', () => {
  it('two reflections across parallel lines are a translation by twice the gap', () => {
    const c = composeMotions([
      { kind: 'reflect', line: { kind: 'x=k', k: 1 } },
      { kind: 'reflect', line: { kind: 'x=k', k: 4 } },
    ])
    expect(c.rule.text).toBe('(x, y) → (x + 6, y)')
    expect(c.single).toEqual([{ kind: 'translate', v: pt(6, 0) }])
    expect(c.rigid).toBe(true)
    expect(c.preservesOrientation).toBe(true)
    expect(c.name.text).toBe('r_{x=4} ∘ r_{x=1}')
  })

  it('two reflections across intersecting lines are a rotation by twice the angle', () => {
    const c = composeMotions([
      { kind: 'reflect', line: { kind: 'x-axis' } },
      { kind: 'reflect', line: { kind: 'y=x' } },
    ])
    // r_{y=x}(r_{x-axis}(x, y)) = r_{y=x}(x, −y) = (−y, x): a quarter turn
    expect(c.rule.text).toBe('(x, y) → (−y, x)')
    expect(c.single).toEqual([{ kind: 'rotate', deg: 90, center: O }])
    expect(c.singleWords).toBe('a rotation of 90° counterclockwise about the origin')
  })

  it('a rotation then a reflection is a reflection; the rule and the sequence both read', () => {
    const c = composeMotions([
      { kind: 'rotate', deg: 90, center: O },
      { kind: 'reflect', line: { kind: 'y=x' } },
    ])
    expect(c.rule.text).toBe('(x, y) → (x, −y)')
    expect(c.single).toEqual([{ kind: 'reflect', line: { kind: 'x-axis' } }])
    expect(c.name.text).toBe('r_{y=x} ∘ R_{90°, O}')
    expect(c.steps).toBe('a rotation of 90° counterclockwise about the origin, then a reflection across the line y = x')
  })

  it('a reflection then a translation along the line is a glide reflection', () => {
    const c = composeMotions([
      { kind: 'reflect', line: { kind: 'x-axis' } },
      { kind: 'translate', v: pt(4, 0) },
    ])
    expect(c.single).toEqual([{ kind: 'glide', line: { kind: 'x-axis' }, v: pt(4, 0) }])
  })
})

describe('find the motion', () => {
  it('a translation', () => {
    const r = findMotion(ABC, img({ kind: 'translate', v: pt(-5, 3) }, ABC), ['A', 'B', 'C'])
    expect(r.relation).toBe('congruent')
    expect(r.motions).toEqual([{ kind: 'translate', v: pt(-5, 3) }])
    expect(r.rule?.text).toBe('(x, y) → (x − 5, y + 3)')
  })

  it('a rotation — with the textbook translate-then-turn sequence too', () => {
    const m: Motion = { kind: 'rotate', deg: 90, center: pt(1, -1) }
    const r = findMotion(ABC, img(m, ABC), ['A', 'B', 'C'])
    expect(r.relation).toBe('congruent')
    expect(r.motions).toEqual([m])
    expect(r.words).toBe('a rotation of 90° counterclockwise about (1, −1)')
    expect(r.alternative?.[0].kind).toBe('translate')
    expect(r.alternative?.[1]).toMatchObject({ kind: 'rotate', deg: 90 })
    expect(r.preservesOrientation).toBe(true)
  })

  it('a reflection', () => {
    const m: Motion = { kind: 'reflect', line: { kind: 'y=-x' } }
    const r = findMotion(ABC, img(m, ABC))
    expect(r.motions).toEqual([m])
    expect(r.name?.text).toBe('r_{y=−x}')
    expect(r.preservesOrientation).toBe(false)
  })

  it('a glide reflection when no single reflection does it', () => {
    const r = findMotion(ABC, img({ kind: 'glide', line: { kind: 'y=k', k: 1 }, v: pt(3, 0) }, ABC))
    expect(r.relation).toBe('congruent')
    expect(r.motions).toEqual([{ kind: 'glide', line: { kind: 'y=k', k: 1 }, v: pt(3, 0) }])
    expect(r.alternative).toEqual([
      { kind: 'reflect', line: { kind: 'y=k', k: 1 } },
      { kind: 'translate', v: pt(3, 0) },
    ])
    expect(r.words).toMatch(/^a glide reflection/)
  })

  it('a similarity: a dilation, and a dilation followed by a rigid motion', () => {
    const d = findMotion(ABC, img({ kind: 'dilate', k: 0.5, center: pt(1, 1) }, ABC), ['A', 'B', 'C'])
    expect(d.relation).toBe('similar')
    expect(d.scaleText).toBe('1/2')
    expect(d.motions).toEqual([{ kind: 'dilate', k: 0.5, center: pt(1, 1) }])
    expect(d.reason).toMatch(/scale factor 1\/2/)
    // dilate by 2 about O, then reflect across the y-axis
    const Q = img({ kind: 'reflect', line: { kind: 'y-axis' } }, img({ kind: 'dilate', k: 2, center: O }, ABC))
    const s = findMotion(ABC, Q)
    expect(s.relation).toBe('similar')
    expect(s.preservesOrientation).toBe(false)
    expect(s.motions[0]).toMatchObject({ kind: 'dilate', k: 2 })
    expect(s.motions[1].kind).toBe('reflect')
    // the sequence found really does carry P onto Q
    const back = img(s.motions[1], img(s.motions[0], ABC))
    back.forEach((p, i) => {
      expect(p.x).toBeCloseTo(Q[i].x, 9)
      expect(p.y).toBeCloseTo(Q[i].y, 9)
    })
  })

  it('not congruent, not similar — and says which measurement rules it out', () => {
    const r = findMotion(ABC, [pt(0, 0), pt(3, 0), pt(3, 5)], ['A', 'B', 'C'], ['D', 'E', 'F'])
    expect(r.relation).toBe('neither')
    expect(r.reason).toMatch(/BC = 4 but EF = 5, so the figures are not congruent/)
    expect(r.reason).toMatch(/not similar either/)
    // a rhombus and a square: every side matches, a diagonal does not
    const sq = [pt(0, 0), pt(1, 0), pt(1, 1), pt(0, 1)]
    const rh = [pt(0, 0), pt(1, 0), pt(1.5, Math.sqrt(3) / 2), pt(0.5, Math.sqrt(3) / 2)]
    const q = findMotion(sq, rh)
    expect(q.relation).toBe('neither')
    expect(q.reason).toMatch(/Every side matches, but the diagonal/)
  })

  it('compareFigures finds the correspondence itself', () => {
    const Q = img({ kind: 'rotate', deg: 180, center: pt(5, 5) }, ABC)
    // list the image starting from a different vertex, in the other direction
    const shuffled = [Q[2], Q[1], Q[0]]
    const c = compareFigures(ABC, shuffled, ['A', 'B', 'C'], ['D', 'E', 'F'])
    expect(c.report.relation).toBe('congruent')
    expect(c.correspondence).toBe('A → F, B → E, C → D')
    expect(c.report.motions).toEqual([{ kind: 'rotate', deg: 180, center: pt(5, 5) }])
    expect(c.triangle?.congruent).toBe(true)
  })
})

describe('symmetry', () => {
  const regular = (n: number, r = 2): Vec2[] =>
    Array.from({ length: n }, (_v, i) => pt(r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)))

  it('regular polygons: n lines, order n', () => {
    for (const n of [3, 4, 5, 6, 8]) {
      const s = symmetryOf(regular(n))!
      expect(s.lines.length).toBe(n)
      expect(s.order).toBe(n)
      expect(s.angles[0]).toBeCloseTo(360 / n, 9)
    }
    const tri = symmetryOf([pt(0, 0), pt(4, 0), pt(2, 2 * Math.sqrt(3))])!
    expect(tri.angles).toEqual([120, 240])
    expect(tri.summary).toBe('3 lines · order 3')
  })

  it('a square: 4 lines and quarter turns, with the lines named', () => {
    const s = symmetryOf([pt(0, 0), pt(2, 0), pt(2, 2), pt(0, 2)], ['A', 'B', 'C', 'D'])!
    expect(s.order).toBe(4)
    expect(s.angles).toEqual([90, 180, 270])
    expect(s.point).toBe(true)
    expect(s.lines.map((l) => l.equation).sort()).toEqual(['x = 1', 'y = 1', 'y = x', `y = −x + 2`].sort())
    expect(s.lines.find((l) => l.equation === 'y = x')?.via).toBe('through A and C')
    expect(s.lines.find((l) => l.equation === 'x = 1')?.via).toBe('through the midpoints of AB and CD')
    expect(s.sentence).toMatch(/4 lines of symmetry and rotational symmetry of order 4/)
  })

  it('a rectangle: 2 lines, 180°', () => {
    const s = symmetryOf([pt(0, 0), pt(4, 0), pt(4, 2), pt(0, 2)])!
    expect(s.lines.length).toBe(2)
    expect(s.angles).toEqual([180])
  })

  it('a rhombus: 2 lines (its diagonals), 180°', () => {
    const s = symmetryOf([pt(0, 0), pt(3, 1), pt(4, 4), pt(1, 3)])!
    expect(s.lines.length).toBe(2)
    expect(s.order).toBe(2)
    expect(s.lines.every((l) => /^through [A-D] and [A-D]$/.test(l.via))).toBe(true)
  })

  it('an isosceles triangle and a kite: 1 line, no turn', () => {
    const iso = symmetryOf([pt(0, 0), pt(4, 0), pt(2, 5)], ['A', 'B', 'C'])!
    expect(iso.lines.length).toBe(1)
    expect(iso.lines[0].equation).toBe('x = 2')
    expect(iso.lines[0].via).toBe('through vertex C and the midpoint of AB')
    expect(iso.order).toBe(1)
    const kite = symmetryOf([pt(0, 0), pt(2, -1), pt(5, 0), pt(2, 1)])!
    expect(kite.lines.length).toBe(1)
    expect(kite.lines[0].equation).toBe('x-axis')
    expect(kite.order).toBe(1)
    const scalene = symmetryOf(ABC)!
    expect(scalene.lines.length).toBe(0)
    expect(scalene.summary).toBe('no lines · no turn')
  })
})

describe('triangle congruence and similarity criteria', () => {
  it('congruent triangles: SSS, with SAS, ASA, AAS listed too', () => {
    const Q = img({ kind: 'reflect', line: { kind: 'y-axis' } }, ABC)
    const t = compareTriangles(ABC, Q, ['A', 'B', 'C'], ['D', 'E', 'F'])
    expect(t.congruent).toBe(true)
    expect(t.criteria.map((c) => c.name)).toEqual(['SSS', 'SAS', 'ASA', 'AAS', 'HL'])
    expect(t.criteria[0].parts).toEqual(['AB = DE = 3', 'BC = EF = 4', 'CA = FD = 5'])
    expect(t.sentence).toMatch(/^△ABC ≅ △DEF by SSS/)
  })

  it('similar triangles: AA, SAS~ and SSS~ with the scale factor', () => {
    const Q = img({ kind: 'dilate', k: 2, center: O }, ABC)
    const t = compareTriangles(ABC, Q, ['A', 'B', 'C'], ['D', 'E', 'F'])
    expect(t.congruent).toBe(false)
    expect(t.similar).toBe(true)
    expect(t.kText).toBe('2')
    expect(t.simCriteria.map((c) => c.name)).toEqual(['AA', 'SAS~', 'SSS~'])
  })

  it('SSA is never a congruence criterion', () => {
    // The ambiguous case: ∠A = 30°, AB = 4, BC = 2.5 — two different triangles.
    const A = pt(0, 0)
    const B = pt(4 * Math.cos(Math.PI / 6), 4 * Math.sin(Math.PI / 6))
    // C on the x-axis with |BC| = 2.5: x = Bx ± √(2.5² − By²)
    const h = Math.sqrt(2.5 * 2.5 - B.y * B.y)
    const P = [A, B, pt(B.x + h, 0)]
    const Q = [A, B, pt(B.x - h, 0)]
    const t = compareTriangles(P, Q, ['A', 'B', 'C'], ['D', 'E', 'F'])
    expect(t.congruent).toBe(false)
    expect(t.criteria).toEqual([])
    expect(t.ssa).toMatch(/SSA is not a congruence criterion/)
    // from the givens alone: refused
    const g = criterionFromGivens({ sides: [true, true, false], angles: [true, false, false] })
    expect(g.criterion).toBeNull()
    expect(g.reason).toMatch(/SSA/)
  })

  it('criterionFromGivens names each criterion', () => {
    expect(criterionFromGivens({ sides: [true, true, true], angles: [false, false, false] }).criterion).toBe('SSS')
    // AB, BC and ∠B (vertex 1) between them
    expect(criterionFromGivens({ sides: [true, true, false], angles: [false, true, false] }).criterion).toBe('SAS')
    // ∠A, ∠B and AB between them
    expect(criterionFromGivens({ sides: [true, false, false], angles: [true, true, false] }).criterion).toBe('ASA')
    // ∠A, ∠B and BC
    expect(criterionFromGivens({ sides: [false, true, false], angles: [true, true, false] }).criterion).toBe('AAS')
    // right at C (vertex 2): hypotenuse AB (side 0) and leg BC (side 1)
    expect(criterionFromGivens({ sides: [true, true, false], angles: [false, false, false], right: 2 }).criterion).toBe('HL')
    expect(criterionFromGivens({ sides: [false, false, false], angles: [true, true, true] }).criterion).toBeNull()
  })
})

describe('what a transformation preserves', () => {
  it('rigid: lengths and angles equal, parallel sides still parallel', () => {
    const P = [pt(0, 0), pt(4, 0), pt(5, 2), pt(1, 2)]
    const m: Motion = { kind: 'rotate', deg: 90, center: O }
    const checks = preservedChecks(P, img(m, P), ['A', 'B', 'C', 'D'], ['A′', 'B′', 'C′', 'D′'], m)
    expect(checks.filter((c) => c.ok === false)).toEqual([])
    expect(checks.find((c) => c.kind === 'length')?.text).toBe('A′B′ = AB = 4')
    expect(checks.some((c) => c.kind === 'parallel' && c.text.startsWith('AB ‖ CD'))).toBe(true)
    expect(checks.find((c) => c.kind === 'fixed')?.text).toBe('The center O (the origin) stays fixed')
  })

  it('a dilation scales lengths by k and sends each side to a parallel line', () => {
    const m: Motion = { kind: 'dilate', k: 0.5, center: pt(1, 1) }
    const checks = preservedChecks(ABC, img(m, ABC), ['A', 'B', 'C'], ['A′', 'B′', 'C′'], m)
    expect(checks.filter((c) => c.ok === false)).toEqual([])
    expect(checks[0].text).toBe('A′B′ = 3/2 = 1/2 · AB  (AB = 3)')
    expect(checks.some((c) => c.text.startsWith('Each side maps to a parallel line'))).toBe(true)
    expect(checks.find((c) => c.kind === 'area')?.text).toMatch(/1\/4/)
  })
})

describe('names with primes', () => {
  it('A → A′ → A″ → A‴ → A⁽⁴⁾ → A⁽⁵⁾: primes count the steps; a subscript is carried along', () => {
    expect(primeName('A')).toBe('A′')
    expect(primeName('A′')).toBe('A″')
    expect(primeName('A″')).toBe('A‴')
    expect(primeName('A‴')).toBe('A⁽⁴⁾')
    expect(primeName('A⁽⁹⁾')).toBe('A⁽¹⁰⁾')
    // a second image (A′₂) keeps its number down the chain; a typed A₁ is primed
    expect(primeName('A′₂')).toBe('A″₂')
    expect(primeName('A₁')).toBe('A′₁')
    expect(siblingName('A′', 2)).toBe('A′₂')
    expect(siblingName('A′', 1)).toBe('A′')
    expect(primeTex('A₁₂')).toBe('A_{12}')
    expect(primeTex('A″')).toBe("A''")
    expect(primeTex('A′₂')).toBe("A'_{2}")
    expect(primeTex('A⁽⁴⁾')).toBe('A^{(4)}')
  })

  it('identify: a dilation through 180° is a negative scale factor', () => {
    expect(identify(motionAffine({ kind: 'dilate', k: -2, center: pt(1, 1) }))).toEqual([{ kind: 'dilate', k: -2, center: pt(1, 1) }])
  })
})

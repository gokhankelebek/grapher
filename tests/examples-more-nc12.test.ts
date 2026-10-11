// ============================================================================
// tests/examples-more-nc12.test.ts — the NC Math 1 and NC Math 2 examples in
// src/examples/more/nc12.ts. Every example builds and loads back; every
// number its teacher note claims is checked against the app's own analysis
// (analyzeCurve, intersections, the shape reports, the solver, the data plot
// and probability cards) — not against a second copy of the arithmetic.
// ============================================================================

import { describe, expect, it } from 'vitest'
import { EXAMPLE_DEFS, buildExample, exampleById } from '../src/examples'
import { MORE_NC12 } from '../src/examples/more/nc12'
import { HELP_SECTIONS } from '../src/ui/commands'
import { deserializeDoc } from '../src/core/persist'
import { MODELS } from '../src/core/fit/models'
import { analyzeCurve } from '../src/core/analyze'
import { boardIntersections } from '../src/ui/intersections'
import { compileShapes } from '../src/ui/shapeLinks'
import { dataPlotCard } from '../src/ui/dataPlotLinks'
import { probCard, settleProb } from '../src/ui/probLinks'
import { solveInequality } from '../src/core/solveInequality'
import { fitRegression } from '../src/core/data'
import { dataColumns } from '../src/ui/dataLinks'

const r3 = (v: number): number => Math.round(v * 1000) / 1000

const load = (id: string) => {
  const def = exampleById(id)
  if (!def) throw new Error(`no example ${id}`)
  const res = deserializeDoc(buildExample(def).json)
  if (!res.board) throw new Error(`example ${id} did not load`)
  expect(res.problems).toEqual([])
  return { def, board: res.board, models: { ...MODELS, ...res.board.extraModels } }
}

/** The special points analyzeCurve marks on the board's n-th curve, rounded. */
const marks = (id: string, n = 0): [string, number, number][] => {
  const { board, models } = load(id)
  return analyzeCurve(board.curves[n], models).map((p): [string, number, number] => [p.kind, r3(p.pos.x), r3(p.pos.y)])
}

/** Where the board's curves meet, rounded and sorted by x. */
const meets = (id: string): [number, number][] => {
  const { board, models } = load(id)
  return boardIntersections(board.curves, models, [-300, 300])
    .map((m): [number, number] => [r3(m.point.pos.x), r3(m.point.pos.y)])
    .sort((a, b) => a[0] - b[0])
}

const shapes = (id: string) => {
  const { board } = load(id)
  const compiled = compileShapes(board.shapes)
  return board.shapes.map((s) => ({ s, c: compiled.get(s.id)! }))
}

const NEW_M1 = ['m1-slope-in-context', 'm1-system-in-context', 'm1-projectile', 'm1-right-triangle-coords', 'm1-histogram-skew', 'm1-correlation-causation']
const NEW_M2 = ['m2-quadratic-inequality', 'm2-glide-reflection', 'm2-dilation-center', 'm2-angle-of-elevation', 'm2-venn-addition-rule', 'm2-tree-with-replacement']

describe('the NC Math 1 and 2 additions', () => {
  it('are six per course, tagged M1 / M2, with known help sections and fresh ids', () => {
    expect(MORE_NC12.map((d) => d.id)).toEqual([...NEW_M1, ...NEW_M2])
    const sections = new Set(HELP_SECTIONS.map((s) => s.id))
    for (const d of MORE_NC12) {
      const want = d.id.startsWith('m1-') ? { course: 'math1', unit: 'M1', pre: 'm1-' } : { course: 'math2', unit: 'M2', pre: 'm2-' }
      expect([d.course, d.unit], d.id).toEqual([want.course, want.unit])
      for (const h of d.help) {
        expect(sections.has(h), `${d.id} → ${h}`).toBe(true)
        expect(h.startsWith(want.pre), `${d.id} → ${h}`).toBe(true)
      }
      expect(EXAMPLE_DEFS.filter((e) => e.id === d.id), d.id).toHaveLength(1)
      expect(d.note).not.toMatch(/TODO/)
    }
  })

  it('every one builds and loads back with zero problems', () => {
    for (const d of MORE_NC12) {
      const res = deserializeDoc(buildExample(d).json)
      expect(res.problems, d.id).toEqual([])
      expect(res.board?.kind, d.id).toBe(d.kind ?? 'cartesian')
      expect(res.board?.note, d.id).toBe(d.note)
    }
  })
})

describe('NC Math 1', () => {
  it('the candle: h(t) = 12 − 0.75t on [0, 16], intercepts 12 and 16, h(6) = 7.5, Δh = −3 per 4 hours', () => {
    const { board, models } = load('m1-slope-in-context')
    const h = board.curves[0]
    expect(h.domain).toEqual([0, 16])
    expect(marks('m1-slope-in-context')).toEqual([
      ['y-intercept', 0, 12],
      ['zero', 16, 0],
    ])
    const ev = (t: number): number => models[h.modelId].evalExplicit!(h.params, t)
    expect(ev(6)).toBe(7.5)
    expect([0, 4, 8, 12, 16].map(ev)).toEqual([12, 9, 6, 3, 0])
    expect(ev(1) - ev(0)).toBe(-0.75)
    expect(board.curveViews[h.id]?.table).toEqual({ step: '4', n: 5, cols: ['d1'], ev: 'h(6)' })
    // a 0.5 in/hr candle would burn out at t = 24
    expect(12 / 0.5).toBe(24)
  })

  it('the tickets: x + y = 200 and 8x + 5y = 1210 meet at (70, 130)', () => {
    expect(meets('m1-system-in-context')).toEqual([[70, 130]])
    expect(Object.values(load('m1-system-in-context').board.exprSources)).toEqual(['x + y = 200', '8x + 5y = 1210'])
    // elimination: (8x + 5y) − 5(x + y) = 1210 − 1000
    expect(1210 - 5 * 200).toBe(210)
    expect([8 * 70 + 5 * 130, 70 + 130]).toEqual([1210, 200])
  })

  it('the projectile: (0, 80), vertex (2, 144), lands at t = 5; 128 ft at t = 1 and 3', () => {
    const { board, models } = load('m1-projectile')
    expect(board.curves[0].domain).toEqual([0, 5])
    expect(marks('m1-projectile')).toEqual([
      ['y-intercept', 0, 80],
      ['maximum', 2, 144],
      ['zero', 5, 0],
    ])
    expect(meets('m1-projectile')).toEqual([[1, 128], [3, 128]])
    const h = board.curves[0]
    const ev = (t: number): number => models[h.modelId].evalExplicit!(h.params, t)
    // −16(t − 5)(t + 1) is the same quadratic
    for (const t of [-1, 0, 0.5, 2, 3.7, 5]) expect(ev(t)).toBeCloseTo(-16 * (t - 5) * (t + 1), 9)
  })

  it('the triangle: AB = 10, BC = CA = 5√2, slopes 3/4, 7, −1/7, right isosceles at C, area 25; the bisector y = −(4/3)x + 14 through C', () => {
    const [tri, line] = shapes('m1-right-triangle-coords')
    const poly = tri.c.reports!.poly!
    expect(poly.sides.map((s) => [s.name, s.length.text, s.slope.text])).toEqual([
      ['AB', '10', '3/4'],
      ['BC', '5√2', '7'],
      ['CA', '5√2', '−1/7'],
    ])
    expect(poly.sides[0].midpoint.text).toBe('(6, 6)')
    expect(poly.classification.name).toBe('right isosceles triangle')
    expect(poly.right?.right).toBe(2)
    expect(poly.area.area.value).toBe(25)
    expect(tri.s.measure?.show).toEqual(['lengths', 'slopes', 'right', 'midpoints', 'area', 'classify'])
    const lr = line.c.reports!.line!
    expect(lr.rel).toBe('perpendicular')
    expect(lr.line.slopeIntercept.text).toBe('y = (−4/3)x + 14')
    expect(lr.line.through).toEqual({ x: 6, y: 6 })
    // C (9, 2) is on it
    expect((-4 / 3) * 9 + 14).toBeCloseTo(2, 12)
  })

  it('the homework histogram: skewed right, mean 26.75 > median 17.5, IQR 22.5, 110 beyond the fence 66.25', () => {
    const [p] = load('m1-histogram-skew').board.stats
    if (p.type !== 'data') throw new Error('not a data plot')
    expect([p.dist, p.box, p.binWidth]).toEqual(['hist', true, 10])
    const card = dataPlotCard(p)
    const set = card.sets[0]
    const v = (k: string): string => set.table.find((r) => r.key === k)!.value
    expect([v('n'), v('mean'), v('median'), v('q1'), v('q3'), v('iqr'), v('sdSample')]).toEqual(['20', '26.75', '17.5', '10', '32.5', '22.5', '25.4577'])
    expect(set.fences).toEqual({ lower: '−23.75', upper: '66.25', outliers: ['110'] })
    expect(set.shape).toBe('Homework (min) appears skewed right')
    expect(set.recommend).toMatch(/^Use the median and IQR/)
    expect([card.binWidth, card.binAuto]).toEqual([10, false])
    // leave the outlier out: the mean falls to 425/19 ≈ 22.37, the median to 15
    const out = dataPlotCard({ ...p, dropOutliers: true }).sets[0]
    const w = (k: string): string => out.table.find((r) => r.key === k)!.value
    expect([w('n'), w('mean'), w('median')]).toEqual(['19', '22.3684', '15'])
    expect(r3(425 / 19)).toBe(22.368)
  })

  it('ice cream and sunburns: y = 0.8168x − 2.4699, r ≈ 0.988', () => {
    const { board } = load('m1-correlation-causation')
    const d = board.data[0]
    expect(d.regressions.map((r) => r.kind)).toEqual(['linear'])
    expect(board.exprSources[d.regressions[0].curveId]).toBe('y = 0.8168x - 2.4699')
    const cols = dataColumns(d.rows)
    const fit = fitRegression('linear', cols.xs, cols.ys)
    if (!fit.ok) throw new Error('no fit')
    expect(fit.coef.a).toBeCloseTo(0.8168, 4)
    expect(fit.coef.b).toBeCloseTo(-2.4699, 4)
    expect(r3(fit.r!)).toBe(0.988)
  })
})

describe('NC Math 2', () => {
  it('the ball above 36 ft: −16(t − 1)(t − 2) > 0, open at 1 and 2, tests −32, 4, −32, so 1 < t < 2', () => {
    const { board } = load('m2-quadratic-inequality')
    const item = board.items[0]
    expect(item).toMatchObject({ kind: 'solve', src: '-16t^2 + 48t + 4 > 36', show: { signs: true, tests: true } })
    const s = solveInequality(item.kind === 'solve' ? item.src : '')
    if (!s.ok) throw new Error(s.error)
    expect(s.variable).toBe('t')
    const c = s.clauses[0]
    expect(c.hText).toBe('−16t² + 48t − 32')
    expect(c.factored?.text).toBe('−16(t − 1)(t − 2)')
    expect(c.critical.map((k) => [k.x, k.included])).toEqual([
      [1, false],
      [2, false],
    ])
    expect(c.table.map((r) => [r.tText, r.valueText, r.satisfies])).toEqual([
      ['0', '−32', false],
      ['3/2', '4', true],
      ['3', '−32', false],
    ])
    expect(s.conclusion).toContain('1 < t < 2')
  })

  it('the glide: r_y-axis then T⟨0, 6⟩ is (x, y) → (−x, y + 6), a glide reflection; A(2, −4) → A″(−2, 2)', () => {
    const [abc, one, two] = shapes('m2-glide-reflection')
    expect(abc.s.src).toBe('ABC = (2,-4) (5,-3) (4,-1)')
    expect(one.c.xform!.rule.text).toBe('(x, y) → (−x, y)')
    expect(one.c.xform!.vertexTexts).toEqual(['A′(−2, −4)', 'B′(−5, −3)', 'C′(−4, −1)'])
    expect(two.c.xform!.vertexTexts).toEqual(['A″(−2, 2)', 'B″(−5, 3)', 'C″(−4, 5)'])
    const chain = two.c.xform!.chain!
    expect(chain.rule.text).toBe('(x, y) → (−x, y + 6)')
    expect(chain.single).toBe('a glide reflection: a reflection across the y-axis, then a translation by ⟨0, 6⟩ along it')
    expect(chain.rigid).toBe(true)
    // translating first gives the same image: (x, y + 6) then (−x, y + 6)
    const pre = abc.c.reports!.poly!
    expect(pre.classification.name).toBe('acute scalene triangle')
  })

  it('the dilation about P(−2, 1): (x, y) → (2x + 2, 2y − 1), sides doubled, BC ∥ B′C′ (slope −2/3)', () => {
    const [p, abc, img] = shapes('m2-dilation-center')
    expect(p.s.src).toBe('P = (-2, 1)')
    const x = img.c.xform!
    expect(x.rule.text).toBe('(x, y) → (2x + 2, 2y − 1)')
    expect(x.vertexTexts).toEqual(['A′(4, 3)', 'B′(10, 3)', 'C′(4, 7)'])
    expect(x.rigid).toBe(false)
    const side = (r: typeof abc) => r.c.reports!.poly!.sides.map((s) => [s.length.text, s.slope.text])
    expect(side(abc)).toEqual([
      ['3', '0'],
      ['√13', '−2/3'],
      ['2', 'undefined'],
    ])
    expect(side(img)).toEqual([
      ['6', '0'],
      ['2√13', '−2/3'],
      ['4', 'undefined'],
    ])
    expect(img.s.xform?.aids).toEqual(['rays'])
  })

  it('the angle of elevation: tan A = 5/12, ∠A ≈ 22.6°, ∠C ≈ 67.4°, AC = 26; 24 tan 35° ≈ 16.8', () => {
    const [tri] = shapes('m2-angle-of-elevation')
    const poly = tri.c.reports!.poly!
    expect(poly.sides.map((s) => s.length.text)).toEqual(['24', '10', '26'])
    const rt = poly.right!
    expect(rt.right).toBe(1)
    const a = rt.trig.find((t) => t.name === 'A')!
    expect([a.tan.value.text, a.sin.value.text, a.cos.value.text]).toEqual(['5/12', '5/13', '12/13'])
    expect(poly.angles.map((g) => g.text)).toEqual(['22.6°', '90°', '67.4°'])
    expect(r3((Math.atan(5 / 12) * 180) / Math.PI)).toBe(22.62)
    expect(Math.round(24 * Math.tan((35 * Math.PI) / 180) * 10) / 10).toBe(16.8)
  })

  it('the Venn diagram: P(A ∪ B) = 18/30 + 12/30 − 5/30 = 5/6, and 1 − P(neither) agrees', () => {
    const [p] = load('m2-venn-addition-rule').board.stats
    if (p.type !== 'prob') throw new Error('not a probability object')
    expect(p.view).toBe('venn')
    const v = probCard(p).venn
    expect(v.total).toMatch(/add to 30 outcomes/)
    expect(v.regionLabels.map((r) => r.name)).toEqual(['neither', 'A only', 'B only', 'A and B'])
    expect(p.venn.regions).toEqual(['5', '13', '7', '5'])
    expect(v.event).toBe('A ∪ B')
    expect(v.rule).toBe('P(A ∪ B) = P(A) + P(B) − P(A ∩ B)')
    expect(v.ruleNumbers).toBe('= 3/5 + 2/5 − 1/6 = 5/6')
    expect(v.regions).toBe('(13 + 7 + 5)/30 = 25/30 = 5/6')
    expect(v.p).toMatch(/^5\/6 /)
    // P(A) = 18/30, P(B) = 12/30, P(A ∩ B) = 5/30
    expect(v.basics.map((b) => b.value.split(' ')[0])).toEqual(['3/5', '2/5', '1/6', '3/5'])
  })

  it('the tree with replacement: P(same color) = 9/25 + 4/25 = 13/25; without, 3/10 + 1/10 = 2/5', () => {
    const [p] = load('m2-tree-with-replacement').board.stats
    if (p.type !== 'prob') throw new Error('not a probability object')
    expect([p.view, p.tree.replace, p.tree.draws]).toEqual(['tree', true, 2])
    const t = probCard(p).tree
    expect(t.leaves.map((l) => [l.short, l.p, l.picked])).toEqual([
      ['RR', '9/25', true],
      ['RB', '6/25', false],
      ['BR', '6/25', false],
      ['BB', '4/25', true],
    ])
    expect(t.event).toMatchObject({ name: 'same color', terms: 'P(RR) + P(BB)', numbers: '9/25 + 4/25 = 13/25' })
    const without = probCard(settleProb({ ...p, tree: { ...p.tree, replace: false } })).tree.event!
    expect(without.name).toBe('same color')
    expect(without.numbers).toBe('3/10 + 1/10 = 2/5')
  })
})

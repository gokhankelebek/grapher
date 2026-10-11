// ============================================================================
// tests/examples-more-precalc.test.ts — the AP Precalculus additions to the
// examples gallery (src/examples/more/precalc.ts).
//
// Every example builds and loads with zero problems (tests/examples.test.ts
// does the round trip and the thumbnail for all of them); here, every number
// a teacher note states is checked against the app's own analysis — the
// value table, the secant card, the hole and asymptote finder, the
// regressions and their residual verdicts, the sequence partners, the
// exponential reader, the exact intersection solver, the sinusoid reader,
// the number-line solver, the parametric / polar calculus and the conic
// reader.
// ============================================================================

import { describe, expect, it } from 'vitest'
import { MORE_PRECALC } from '../src/examples/more/precalc'
import { EXAMPLE_DEFS, buildExample, examplesForSection, galleryGroups } from '../src/examples'
import { deserializeDoc } from '../src/core/persist'
import { HELP_SECTIONS } from '../src/ui/commands'
import { MODELS } from '../src/core/fit/models'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { valueTable, tablePattern } from '../src/core/valueTable'
import { secantRow } from '../src/ui/secantLinks'
import { findAsymptotes, findHoles, findPoles } from '../src/core/holes'
import { asymptoteText } from '../src/ui/CurveCard'
import { dataColumns } from '../src/ui/dataLinks'
import { fitRegression } from '../src/core/data'
import { residualPattern } from '../src/core/residuals'
import { compileSequence, partnerFunction, readSequence } from '../src/ui/seqLinks'
import { classify } from '../src/core/sequences'
import { rateOf, readExponential } from '../src/core/exponential'
import { boardIntersections, boardMeetings } from '../src/ui/intersections'
import { readSinusoid, sinFeatures } from '../src/core/sinusoidal'
import { solveInequality } from '../src/core/solveInequality'
import { atParam, paramSymbolic } from '../src/core/paramCalc'
import { paramFeatures } from '../src/core/motion'
import { analyzeCurve } from '../src/core/analyze'
import { conicFeatures, readConic } from '../src/core/conics'
import { compileShapes } from '../src/ui/shapeLinks'

const PI = Math.PI

const load = (id: string) => {
  const def = MORE_PRECALC.find((d) => d.id === id)
  if (!def) throw new Error(`no example ${id}`)
  const res = deserializeDoc(buildExample(def).json)
  if (!res.board) throw new Error(`example ${id} did not load`)
  const board = res.board
  const models: Record<string, ModelSpec> = { ...MODELS, ...board.extraModels }
  const bySrc = (src: string): FittedCurve => {
    const c = board.curves.find((k) => board.exprSources[k.id] === src)
    if (!c) throw new Error(`${id}: no line “${src}”`)
    return c
  }
  const ev = (c: FittedCurve) => (x: number): number => models[c.modelId].evalExplicit!(c.params, x)
  return { def, res, board, models, bySrc, ev }
}

describe('AP Precalculus additions', () => {
  it('every one builds, is a precalc example tagged PC1–PC4, and names help sections that exist', () => {
    const sections = new Set(HELP_SECTIONS.map((s) => s.id))
    expect(MORE_PRECALC).toHaveLength(12)
    for (const def of MORE_PRECALC) {
      expect(def.id.startsWith('pc-u'), def.id).toBe(true)
      expect(def.course).toBe('precalc')
      expect(['PC1', 'PC2', 'PC3', 'PC4']).toContain(def.unit)
      expect(def.help[0], def.id).toBe(`pc-${def.unit.slice(2)}`)
      for (const h of def.help) expect(sections.has(h), `${def.id} → ${h}`).toBe(true)
      const { res } = load(def.id)
      expect(res.problems).toEqual([])
      expect(res.board?.note).toBe(def.note)
      expect(EXAMPLE_DEFS).toContain(def)
    }
  })

  it('covers every unit: at least 3 in Units 1–3 and 2 in Unit 4, each under its own gallery heading', () => {
    const per = (u: string): number => MORE_PRECALC.filter((d) => d.unit === u).length
    expect(per('PC1')).toBeGreaterThanOrEqual(3)
    expect(per('PC2')).toBeGreaterThanOrEqual(3)
    expect(per('PC3')).toBeGreaterThanOrEqual(3)
    expect(per('PC4')).toBeGreaterThanOrEqual(2)
    const pc4 = HELP_SECTIONS.find((s) => s.id === 'pc-4')!
    expect(pc4.course).toBe('AP Precalculus')
    expect(pc4.title).toMatch(/^Unit 4 · /)
    expect(examplesForSection('pc-4').map((d) => d.id)).toEqual(['pc-u4-particle-motion', 'pc-u4-ellipse-parametric'])
    const precalc = galleryGroups().find((g) => g.course === 'precalc')!
    expect(precalc.units.map((u) => u.id)).toEqual(['pc-1', 'pc-2', 'pc-3', 'pc-4'])
  })

  it('PC1 rates: h(t) = −16t² + 64t + 5, average rates 48, 16, −16, −48 falling by 32; secants 48 and −16', () => {
    const { board, models, bySrc, ev } = load('pc-u1-rates-quadratic')
    const h = bySrc('h(t) = -16t^2 + 64t + 5')
    const t = valueTable(ev(h), [0, 1, 2, 3, 4])
    expect(t.y.map((c) => c.v)).toEqual([5, 53, 69, 53, 5])
    expect(t.avg.map((c) => c.v)).toEqual([48, 16, -16, -48])
    expect(t.d2.map((c) => c.v)).toEqual([-32, -32, -32])
    expect(tablePattern(t, ev(h))?.kind).toBe('quadratic')
    expect(board.curveViews[h.id]?.table).toEqual({ n: 5, cols: ['d2', 'avg'], fig: true })
    const secants = board.calc.filter((l) => l.kind === 'secant')
    expect(secants.map((l) => (l.kind === 'secant' ? [l.a, l.b] : null))).toEqual([[0, 1], [2, 3]])
    const values = secants.map((l) => (l.kind === 'secant' ? secantRow(l, h, models, 'h').value : null))
    expect(values).toEqual(['48', '−16'])
  })

  it('PC1 slant: a hole at (−1, 3/2), x = 1 vertical, y = x + 1 slant, zeros ±2', () => {
    const { board, models, ev } = load('pc-u1-slant-asymptote')
    const f = board.curves[0]
    const holes = findHoles(f, models, [-6, 7])
    expect(holes).toHaveLength(1)
    expect(holes[0].x).toBe(-1)
    expect(holes[0].y).toBeCloseTo(1.5, 9)
    expect(findPoles(f, models, [-6, 7])).toEqual([1])
    expect(findAsymptotes(f, models, [-6, 7]).map((a) => asymptoteText(a))).toEqual(['x = 1', 'y = x + 1'])
    // x² − 4 = (x − 1)(x + 1) − 3, so f = x + 1 − 3/(x − 1): below the slant line for x > 1
    for (const x of [-5, -2, 0.5, 2, 3, 6]) expect(ev(f)(x)).toBeCloseTo(x + 1 - 3 / (x - 1), 9)
    expect(ev(f)(2)).toBe(0)
    expect(ev(f)(-2)).toBe(-0)
    expect(ev(f)(6)).toBeLessThan(7)
  })

  it('PC1 model: r ≈ 0.992 but curved residuals (+ − − − − +); the quadratic R² ≈ 0.9999 predicts ≈ 407 ft at 80 mph', () => {
    const { board } = load('pc-u1-model-selection')
    const d = board.data[0]
    expect(d.regressions.map((r) => [r.kind, r.residualPlot === true])).toEqual([
      ['linear', true],
      ['quadratic', false],
    ])
    const { xs, ys } = dataColumns(d.rows)
    const lin = fitRegression('linear', xs, ys)
    const quad = fitRegression('quadratic', xs, ys)
    expect(lin.ok && quad.ok).toBe(true)
    expect(lin.r!).toBeCloseTo(0.992, 3)
    expect(lin.residuals.map(Math.sign)).toEqual([1, -1, -1, -1, -1, 1])
    expect(residualPattern(xs, lin.residuals, 'linear', ys).verdict).toBe('curved')
    expect(quad.r2).toBeGreaterThan(0.9999)
    expect(quad.r2.toFixed(4)).toBe('0.9999')
    expect(residualPattern(xs, quad.residuals, 'quadratic', ys).verdict).toBe('none')
    const { a, b, c } = quad.coef
    expect(Math.round(a * 6400 + b * 80 + c)).toBe(407)
  })

  it('PC2 sequences: both through a₁ = 2 and a₃ = 18; d = 8, r = 3 (and −3); sixth terms 42 and 486; partners 8x − 6 and 2·3^(x − 1)', () => {
    const { board } = load('pc-u2-two-sequences')
    const [a, g] = board.sequences
    expect([a.n0, a.count, a.showPartner, g.n0, g.count, g.showPartner]).toEqual([1, 4, true, 1, 4, true])
    const terms = (src: string, ns: number[]): number[] => {
      const p = readSequence(src)
      if (!p.ok) throw new Error(src)
      return ns.map((n) => p.seq.term(p.seq.defaultParams, n))
    }
    expect(terms(a.src, [1, 2, 3, 4, 6])).toEqual([2, 10, 18, 26, 42])
    expect(terms(g.src, [1, 2, 3, 4, 6])).toEqual([2, 6, 18, 54, 486])
    expect(classify(terms(a.src, [1, 2, 3, 4, 5]))).toMatchObject({ kind: 'arithmetic', d: 8 })
    expect(classify(terms(g.src, [1, 2, 3, 4, 5]))).toMatchObject({ kind: 'geometric', r: 3 })
    // r = −3 also has a₁ = 2 and a₃ = 2·(−3)² = 18
    expect(2 * (-3) ** 2).toBe(18)
    const partner = (q: typeof a): string => {
      const p = compileSequence(q).partner
      if (!p) throw new Error(`${q.src}: no partner`)
      return p
    }
    const pa = partnerFunction(partner(a))!
    const pg = partnerFunction(partner(g))!
    for (const x of [0, 0.5, 1.7, 4]) {
      expect(pa(x)).toBeCloseTo(8 * x - 6, 9)
      expect(pg(x)).toBeCloseTo(2 * 3 ** (x - 1), 9)
    }
  })

  it('PC2 two points: V = 30000(0.8)^x through A (1, 24000) and B (3, 15360); 20% a year, half-life ≈ 3.11', () => {
    const { board, bySrc, ev } = load('pc-u2-exp-two-points')
    const v = bySrc('V(x) = 30000(0.8)^x')
    expect(ev(v)(1)).toBeCloseTo(24000, 6)
    expect(ev(v)(3)).toBeCloseTo(15360, 6)
    expect(15360 / 24000).toBe(0.64)
    expect(24000 / 0.8).toBe(30000)
    const spec = readExponential('V(x) = 30000(0.8)^x')!
    expect([spec.a, spec.b]).toEqual(['30000', '0.8'])
    const rate = rateOf(spec)
    expect(rate.percentPerUnit).toBeCloseTo(-20, 9)
    expect(rate.halfLife!).toBeCloseTo(Math.log(0.5) / Math.log(0.8), 9)
    expect(rate.halfLife!.toFixed(2)).toBe('3.11')
    const shapes = compileShapes(board.shapes)
    expect(board.shapes.map((s) => s.src)).toEqual(['A = (1, 24000)', 'B = (3, 15360)'])
    for (const s of board.shapes) expect(shapes.get(s.id)?.error ?? null).toBeNull()
  })

  it('PC2 residuals: y ≈ 500.19(0.7465)^x, no pattern, 25.3% an hour, ≈ 48 mg at 8 hours; a line would curve', () => {
    const d = load('pc-u2-exp-residuals').board.data[0]
    expect(d.regressions).toHaveLength(1)
    expect(d.regressions[0]).toMatchObject({ kind: 'exponential', residualPlot: true })
    const { xs, ys } = dataColumns(d.rows)
    const fit = fitRegression('exponential', xs, ys)
    expect(fit.ok).toBe(true)
    expect(fit.coef.a.toFixed(2)).toBe('500.19')
    expect(fit.coef.b.toFixed(4)).toBe('0.7465')
    expect(((1 - fit.coef.b) * 100).toFixed(1)).toBe('25.3')
    expect(residualPattern(xs, fit.residuals, 'exponential', ys).verdict).toBe('none')
    expect(Math.round(fit.coef.a * fit.coef.b ** 8)).toBe(48)
    const lin = fitRegression('linear', xs, ys)
    expect(residualPattern(xs, lin.residuals, 'linear', ys).verdict).toBe('curved')
    // the line goes negative before long: no amount of drug is negative
    expect(lin.coef.a * 8 + lin.coef.b).toBeLessThan(0)
  })

  it('PC2 equation: 2ˣ = 3^(x − 1) once, at x = ln 3/(ln 3 − ln 2) ≈ 2.7095, written exactly; 2ˣ is above for x below it', () => {
    const { board, models, bySrc, ev } = load('pc-u2-exp-equation')
    const m = boardIntersections(board.curves, models, [-2, 5])
    expect(m).toHaveLength(1)
    const x = Math.log(3) / (Math.log(3) - Math.log(2))
    expect(m[0].point.pos.x).toBeCloseTo(x, 9)
    expect(m[0].point.pos.x.toFixed(4)).toBe('2.7095')
    expect(m[0].point.exactX).toBe('ln 3/(ln 3 − ln 2)')
    const f = ev(bySrc('f(x) = 2^x'))
    const g = ev(bySrc('g(x) = 3^(x - 1)'))
    for (const t of [-2, 0, 1, 2.7]) expect(f(t)).toBeGreaterThan(g(t))
    for (const t of [2.72, 3, 5]) expect(f(t)).toBeLessThan(g(t))
  })

  it('PC3 Ferris wheel: midline 22, amplitude 20, period 8, min 2 at 0, max 42 at 4; first 32 m at t = 8/3', () => {
    const { board, models } = load('pc-u3-ferris-wheel')
    const spec = readSinusoid('h(t) = 22 - 20cos(pi t/4)')!
    expect(spec).not.toBeNull()
    const f = sinFeatures(spec)
    expect([f.midline, f.amplitude, f.period, f.min, f.max]).toEqual([22, 20, 8, 2, 42])
    expect(f.keyPoints.find((p) => p.kind === 'min')).toMatchObject({ x: 0, y: 2 })
    expect(f.keyPoints.find((p) => p.kind === 'max')).toMatchObject({ x: 4, y: 42 })
    const m = boardIntersections(board.curves, models, [-1, 17])
      .map((p) => p.point)
      .sort((a, b) => a.pos.x - b.pos.x)
    expect(m.map((p) => p.exactX)).toEqual(['8/3', '16/3', '32/3', '40/3'])
    expect(m[0].pos.x).toBeCloseTo(8 / 3, 9)
    expect(22 - 20 * Math.cos((PI * (8 / 3)) / 4)).toBeCloseTo(32, 12)
  })

  it('PC3 inequality: 2cos x + 1 < 0 on one period is (2π/3, 4π/3), with the period note', () => {
    const { board } = load('pc-u3-trig-inequality')
    expect(board.kind).toBe('number-line')
    expect(board.items[0]).toMatchObject({ kind: 'solve', src: '2cos(x) + 1 < 0', show: { signs: true, tests: true } })
    const r = solveInequality('2cos(x) + 1 < 0')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const zeros = r.clauses[0].critical.filter((c) => c.why === 'zero')
    expect(zeros.map((c) => c.exact?.text)).toEqual(['2π/3', '4π/3'])
    expect(zeros.every((c) => !c.included)).toBe(true)
    expect(r.conclusion).toContain('(2π/3, 4π/3)')
    expect(r.notes.join(' ')).toMatch(/every solution plus a multiple of 2π/)
  })

  it('PC3 limaçon: r = 3 at 0, r = 0 at 2π/3 and 4π/3; at π/3, r = 2 and dr/dθ = −√3, toward the pole', () => {
    const { board, models } = load('pc-u3-polar-limacon')
    expect(board.grid).toBe('polar')
    const c = board.curves[0]
    const link = board.calc[0]
    expect(link).toMatchObject({ kind: 'pcalc', t: PI / 3 })
    const sym = paramSymbolic(board.exprSources[c.id], c, models)
    expect(sym).not.toBeNull()
    const at = atParam(c, models, sym, PI / 3)!
    expect(at.r?.text).toBe('2')
    expect(at.dr?.text).toBe('−√3')
    expect(at.drSentence).toMatch(/r is decreasing, so the point is moving toward the pole/)
    expect(atParam(c, models, sym, 0)!.r?.text).toBe('3')
    for (const th of [(2 * PI) / 3, (4 * PI) / 3]) expect(atParam(c, models, sym, th)!.r!.value).toBeCloseTo(0, 12)
    // the distance |r| from the pole grows on (2π/3, π) and (4π/3, 2π), shrinks elsewhere
    const grows = (th: number): boolean => {
      const a = atParam(c, models, sym, th)!
      return a.r!.value * a.dr!.value > 0
    }
    expect([0.5, 1.5, 2.5, 3, 3.5, 4, 4.5, 5.5].map(grows)).toEqual([false, false, true, true, false, false, true, true])
  })

  it('PC4 particle: the figure eight (2cos t, sin 2t) through the origin twice; at π/2 dx/dt = dy/dt = −2, at 3π/2 slope −1; vertical at (±2, 0)', () => {
    const { board, models } = load('pc-u4-particle-motion')
    const c = board.curves[0]
    expect(board.calc[0]).toMatchObject({ kind: 'pcalc', t: PI / 2, marks: true })
    const sym = paramSymbolic(board.exprSources[c.id], c, models)
    const at = atParam(c, models, sym, PI / 2)!
    expect(at.pos.x).toBeCloseTo(0, 12)
    expect(at.pos.y).toBeCloseTo(0, 12)
    expect([at.dx.text, at.dy.text, at.slope?.text]).toEqual(['−2', '−2', '1'])
    const back = atParam(c, models, sym, (3 * PI) / 2)!
    expect(back.pos.x).toBeCloseTo(0, 12)
    expect(back.pos.y).toBeCloseTo(0, 12)
    expect([back.dx.text, back.dy.text, back.slope?.text]).toEqual(['2', '−2', '−1'])
    const f = paramFeatures(c, models)
    expect(f.verticalTangents.map((p) => [p.tText, p.xText, p.yText])).toEqual([['0', '2', '0'], ['π', '−2', '0']])
    // x(t) = 2cos t falls on (0, π) and rises on (π, 2π)
    for (const t of [0.3, 1.5, 3]) expect(atParam(c, models, sym, t)!.dx.value).toBeLessThan(0)
    for (const t of [3.3, 4.7, 6]) expect(atParam(c, models, sym, t)!.dx.value).toBeGreaterThan(0)
    // the board's extremes are the curve's own: (±2, 0) and (±√2, ±1), never past the interval
    const ext = analyzeCurve(c, models).map((p) => [Math.round(p.pos.x * 1e6) / 1e6 + 0, Math.round(p.pos.y * 1e6) / 1e6 + 0])
    expect(ext).toEqual([[-2, 0], [-1.414214, -1], [1.414214, 1], [2, 0]])
  })

  it('PC4 ellipse: vertices (±3, 0), co-vertices (0, ±2), foci (±√5, 0); (3cos t, 2sin t) runs counterclockwise with dy/dx = −2/3 at π/4', () => {
    const { board, models } = load('pc-u4-ellipse-parametric')
    const [e, p] = board.curves
    expect(board.curveViews[e.id]).toEqual({ construction: true })
    const spec = readConic(board.exprSources[e.id])!
    const cf = conicFeatures(spec)
    expect(cf.vertices.map((v) => [v.xText, v.yText])).toEqual([['−3', '0'], ['3', '0']])
    expect(cf.coVertices.map((v) => [v.xText, v.yText])).toEqual([['0', '−2'], ['0', '2']])
    expect(cf.foci.map((v) => v.xText)).toEqual(['−√5', '√5'])
    expect(cf.sentences).toContain('c² = 9 − 4 = 5, so c = √5')
    const sym = paramSymbolic(board.exprSources[p.id], p, models)
    const at = atParam(p, models, sym, PI / 4)!
    expect(at.slope?.text).toBe('−2/3')
    expect(at.dx.value).toBeLessThan(0) // moving left over the top: counterclockwise
    const f = paramFeatures(p, models)
    expect([f.start.xText, f.start.yText, f.end.xText, f.end.yText]).toEqual(['3', '0', '3', '0'])
    const ext = analyzeCurve(p, models).map((q) => [Math.round(q.pos.x * 1e6) / 1e6 + 0, Math.round(q.pos.y * 1e6) / 1e6 + 0])
    expect(ext).toEqual([[-3, 0], [0, 2], [0, -2], [3, 0]])
    for (const t of [0.3, 1, 2.2]) {
      const x = 3 * Math.cos(t)
      const y = 2 * Math.sin(t)
      expect((x / 3) ** 2 + (y / 2) ** 2).toBeCloseTo(1, 12)
    }
    // the parametric curve lies on the ellipse: no false crossings between the two
    expect(boardMeetings(board.curves, models, [-5, 5]).points).toEqual([])
  })
})

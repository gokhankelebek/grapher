// ============================================================================
// tests/examples-more-nc3.test.ts — the NC Math 3 examples in
// src/examples/more/nc3.ts: each builds and loads, its help ids exist, and
// every number its teacher note states is what the app itself computes.
// ============================================================================

import { describe, expect, it } from 'vitest'
import { buildExample, exampleById } from '../src/examples'
import { MORE_NC3 } from '../src/examples/more/nc3'
import { deserializeDoc } from '../src/core/persist'
import { MODELS } from '../src/core/fit/models'
import { HELP_SECTIONS } from '../src/ui/commands'
import { tablePanel } from '../src/ui/valueTableLinks'
import { circlePanel } from '../src/ui/circleLinks'
import { simCard } from '../src/ui/statsLinks'
import { unitCircleCard } from '../src/ui/unitCircleLinks'
import { boardIntersections } from '../src/ui/intersections'
import { inverseInfo } from '../src/ui/nameLinks'
import { solveInequality } from '../src/core/solveInequality'
import { routeOf } from '../src/ui/nlSolve'
import { safeReadPiecewise, verdictsFor } from '../src/ui/piecewiseLinks'
import { keyRows, safeReadSinusoid, safeSinFeatures, sinKeyMarks } from '../src/ui/sinLinks'
import { familyRestriction } from '../src/ui/familyLine'

const load = (id: string) => {
  const def = exampleById(id)
  if (!def) throw new Error(`no example ${id}`)
  const res = deserializeDoc(buildExample(def).json)
  if (!res.board) throw new Error(`example ${id} did not load`)
  const board = res.board
  return { def, res, board, models: { ...MODELS, ...board.extraModels } }
}

const r4 = (v: number): number => Math.round(v * 1e4) / 1e4

describe('NC Math 3 additions', () => {
  it('eight examples, Math 3, tagged M3, m3- ids and help sections that exist', () => {
    expect(MORE_NC3).toHaveLength(8)
    const sections = new Set(HELP_SECTIONS.map((s) => s.id))
    for (const def of MORE_NC3) {
      expect(def.id.startsWith('m3-'), def.id).toBe(true)
      expect(def.course).toBe('math3')
      expect(def.unit).toBe('M3')
      for (const h of def.help) {
        expect(sections.has(h), `${def.id} → ${h}`).toBe(true)
        expect(h.startsWith('m3-'), `${def.id} → ${h}`).toBe(true)
      }
      const { res } = load(def.id)
      expect(res.problems).toEqual([])
      expect(res.degraded).toBe(false)
    }
  })

  it('A-APR.2: x³ − 4x² + x + 6 ÷ (x − 1) leaves x² − 3x − 2, remainder 4 = f(1); a = 2 gives 0', () => {
    const { board, models } = load('m3-remainder-theorem')
    const f = board.curves[0]
    const view = board.curveViews[f.id]!.table!
    expect(view).toMatchObject({ div: '1', ev: 'f(1)' })
    const ctx = { curves: board.curves, models, letters: board.names, sources: board.exprSources }
    const p = tablePanel(f, view, ctx)!
    const w = p.division!.work!
    expect(w.quotient.text).toBe('x² − 3x − 2')
    expect(w.remainder.text).toBe('4')
    expect(w.factor).toBe(false)
    expect(w.statement).toBe('f(1) = remainder = 4')
    expect(p.evaluate).toMatchObject({ ok: true, text: 'f(1) = 4', point: { x: 1, y: 4 } })
    // the class's next try, a = 2: a factor, and the quotient factors on
    const w2 = tablePanel(f, { ...view, div: '2' }, ctx)!.division!.work!
    expect([w2.remainder.text, w2.factor, w2.quotient.text]).toEqual(['0', true, 'x² − 2x − 3'])
    const ev = models[f.modelId].evalExplicit!
    expect([-1, 2, 3].map((x) => ev(f.params, x))).toEqual([0, 0, 0])
  })

  it('A-REI.2: candidates −1 and 3 from x² − 2x − 3 = 0; 3 is extraneous', () => {
    const { board } = load('m3-extraneous-rational')
    expect(board.kind).toBe('number-line')
    const src = (board.items[0] as { src: string }).src
    const solved = solveInequality(src)
    expect(solved.ok).toBe(true)
    if (!solved.ok) return
    const route = routeOf(src, solved)!
    expect(route.method).toBe('Multiply both sides by the LCD')
    expect(route.steps.map((s) => s.text)).toContain('Expand and collect: x² − 2x − 3 = 0')
    expect(route.candidates.map((c) => [c.x, c.ok])).toEqual([
      [-1, true],
      [3, false],
    ])
    expect(route.summary).toBe('x = −1 is the solution; x = 3 is extraneous.')
    // the kept solution checks in the original: −1/−4 + 1/−1 = −3/4 = 3/−4
    expect(-1 / (-1 - 3) + 1 / -1).toBeCloseTo(3 / (-1 - 3), 12)
  })

  it('F-BF.4: (9/5)C + 32 is one-to-one; (10, 50) ↔ (50, 10); f meets y = x at (−40, −40)', () => {
    const { board, models } = load('m3-temperature-inverse')
    const f = board.curves[0]
    expect(board.curveViews[f.id]).toMatchObject({ reflect: 10 })
    expect(board.inverses).toHaveLength(1)
    expect(Object.values(board.exprSources)).toContain('y = x')
    const info = inverseInfo(f, models, board.inverses[0], 'f')
    expect(info.oneToOne).toBe(true)
    const ev = models[f.modelId].evalExplicit!
    expect(ev(f.params, 10)).toBeCloseTo(50, 12)
    // f⁻¹(F) = (5/9)(F − 32) undoes f
    for (const c of [-40, 0, 10, 37, 100]) expect((5 / 9) * (ev(f.params, c) - 32)).toBeCloseTo(c, 10)
    const meets = boardIntersections(board.curves, models, [-200, 200]).map((m) => [r4(m.point.pos.x), r4(m.point.pos.y)])
    expect(meets).toEqual([[-40, -40]])
  })

  it('F-IF.2: C(2.5) = 7, C(3) = 7, C(3.01) = 9, $15 after 6 hours; jumps of 2 at t = 1 … 6', () => {
    const { board, models } = load('m3-parking-piecewise')
    const c = board.curves[0]
    expect(board.exprSources[c.id]).toBe('C(t) = {3 + 2ceil(t - 1) if 0 < t <= 6, 15 if 6 < t <= 12}')
    // a function of t keeps its Piecewise section: the pieces, in t, and the breakpoint sentences
    const spec = safeReadPiecewise(board.exprSources[c.id])!
    expect(spec).toMatchObject({ name: 'C', v: 't' })
    expect(spec.pieces.map((p) => [p.lo, p.hi, p.loClosed, p.hiClosed])).toEqual([
      ['0', '6', false, true],
      ['6', '12', false, true],
    ])
    expect(verdictsFor(spec).map((v) => v.text)).toEqual([
      'C starts at t = 0: right limit 3, C(0) is not defined',
      'jump of 2 at t = 6: left limit 13, right limit 15, C(6) = 13',
      'C ends at t = 12: left limit 15, C(12) = 15',
    ])
    const ctx = { curves: board.curves, models, letters: board.names, sources: board.exprSources }
    const p = tablePanel(c, board.curveViews[c.id]!.table!, ctx)!
    expect(p.evaluate).toMatchObject({ ok: true, text: 'C(2.5) = 7' })
    const C = (x: number): number => models[c.modelId].evalExplicit!(c.params, x)
    expect([C(0.5), C(1), C(2.5), C(3), C(3.01), C(6), C(6.5), C(12)]).toEqual([3, 3, 7, 7, 9, 13, 15, 15])
    for (let k = 1; k <= 6; k++) expect(C(k + 1e-6) - C(k)).toBe(2)
  })

  it('F-TF.1–2: 7π/6 is (−√3/2, −1/2) in Quadrant III, reference angle π/6, ≈ 3.67 of arc', () => {
    const { board } = load('m3-unit-circle-radians')
    const u = board.unitCircles[0]
    expect(u.theta).toBeCloseTo((7 * Math.PI) / 6, 12)
    expect(u.show.astc).toBe(true)
    // centered on the origin, read on a decimal x-axis: P's coordinates are the point's own
    expect([u.cx, u.cy, board.axisUnits.x]).toEqual([0, 0, 'decimal'])
    const card = unitCircleCard(u)
    expect(card.summary).toBe('θ = 7π/6 · (−√3/2, −1/2)')
    expect([card.refText, card.quadrant, card.thetaAlt]).toEqual(['θ′ = π/6', 'Quadrant III', '210°'])
    expect(card.coterminal).toBe('−5π/6 and 19π/6')
    expect(Math.round(u.theta * 100) / 100).toBe(3.67)
  })

  it('F-TF.5: amplitude 3, period 12, midline 8; high 11 at t = 3, low 5 at t = 9; depth 9.5 at t = 1, 5, 13, 17', () => {
    const { board, models } = load('m3-tide-sinusoid')
    const d = board.curves[0]
    // restricted to the day it models, and still a sinusoid on its card
    expect(board.exprSources[d.id]).toBe('d(t) = 3sin(pi t/6) + 8 {0 <= t <= 24}')
    // t is in hours: a decimal axis, not the π axis a line with pi in it would suggest
    expect(board.axisUnits.x).toBe('decimal')
    const sin = safeReadSinusoid(board.exprSources[d.id])!
    expect(sin).toMatchObject({ fn: 'sin', a: '3', b: 'pi/6', h: '0', k: '8' })
    expect(safeSinFeatures(sin)!.sentences.slice(0, 4)).toEqual(['amplitude 3', 'period 12', 'no phase shift', 'midline y = 8'])
    const r = familyRestriction(board.exprSources[d.id])!
    expect([r.lo, r.hi, r.within(0), r.within(24), r.within(24.5)]).toEqual([0, 24, true, true, false])
    expect(keyRows(safeSinFeatures(sin), r).map((k) => `(${k.x}, ${k.y})`)).toEqual(['(0, 8)', '(3, 11)', '(6, 8)', '(9, 5)', '(12, 8)'])
    expect(sinKeyMarks(sin, r)).toHaveLength(5)
    const D = (t: number): number => models[d.modelId].evalExplicit!(d.params, t)
    expect(D(3)).toBeCloseTo(11, 12)
    expect(D(9)).toBeCloseTo(5, 12)
    expect(D(0)).toBeCloseTo(8, 12)
    expect(D(12)).toBeCloseTo(8, 12)
    for (const t of [0.7, 2.3, 4.1, 7.9]) expect(D(t + 12)).toBeCloseTo(D(t), 10)
    const meets = boardIntersections(board.curves, models, [0, 24]).map((m) => r4(m.point.pos.x))
    expect(meets.sort((a, b) => a - b)).toEqual([1, 5, 13, 17])
  })

  it('G-C.2: PQ is a diameter so ∠PRQ = 90°; the tangent at P is y = (−3/4)x + 6, ⟂ OP', () => {
    const { board } = load('m3-tangent-diameter')
    const c = board.curves[0]
    const p = circlePanel(c, board.exprSources[c.id], board.curveViews[c.id]!.circle)!
    expect(p.circle.centre).toEqual({ x: 1, y: -1 })
    expect(p.circle.r).toBe(5)
    const a = p.angles!
    if ('error' in a) throw new Error(a.error)
    expect(a.diameter).toBe(true)
    expect(a.inscribed.deg).toBeCloseTo(90, 9)
    const t = p.tangent!
    if ('error' in t) throw new Error(t.error)
    expect(t.at).toEqual({ x: 4, y: 3 })
    expect(t.line.slopeIntercept.text).toBe('y = (−3/4)x + 6')
    expect(t.radiusSlope.text).toBe('4/3')
    // RP and RQ: slopes 1/7 and −7
    expect((3 - 2) / (4 + 3)).toBeCloseTo(1 / 7, 12)
    expect((-5 - 2) / (-2 + 3)).toBe(-7)
  })

  it('S-IC.4: 1000 samples of 100 at p = 0.58: SD ≈ 0.049, 95% margin ≈ 0.10, interval ≈ 0.48 to 0.68', () => {
    const { board } = load('m3-sampling-margin')
    const s = board.stats[0]
    expect(s.type).toBe('sim')
    if (s.type !== 'sim') return
    expect([s.pop, s.p, s.stat, s.n, s.reps, s.observed]).toEqual(['proportion', 0.58, 'proportion', 100, 1000, 0.58])
    const card = simCard(s).sample!
    expect(card.theorySd).toBe('0.0494')
    expect(Math.abs(Number(card.sd) - 0.0494)).toBeLessThan(0.002)
    expect(Math.abs(Number(card.mean) - 0.58)).toBeLessThan(0.005)
    const me95 = card.me.find((m) => m.label === '95%')!
    expect(Math.round(Number(me95.me) * 100) / 100).toBe(0.1)
    expect(Math.round(Number(me95.lo) * 100) / 100).toBe(0.48)
    expect(Math.round(Number(me95.hi) * 100) / 100).toBe(0.68)
    // halving the margin takes four times the sample: √(pq/400) = ½ √(pq/100)
    expect(Math.sqrt((0.58 * 0.42) / 400)).toBeCloseTo(Math.sqrt((0.58 * 0.42) / 100) / 2, 12)
  })
})

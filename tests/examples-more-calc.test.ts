// ============================================================================
// tests/examples-more-calc.test.ts — the AP Calculus examples in
// src/examples/more/calc.ts: every one builds and loads, links only to help
// sections that exist, and the numbers each teacher note claims are the ones
// the app's own analysis computes on the built board.
// ============================================================================

import { describe, expect, it } from 'vitest'
import { MORE_CALC } from '../src/examples/more/calc'
import { EXAMPLE_DEFS, buildExample, exampleById } from '../src/examples'
import { deserializeDoc } from '../src/core/persist'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { HELP_SECTIONS } from '../src/ui/commands'
import { limitAt, limitSourceOf } from '../src/core/limits'
import { RR_DEFS, rateForm } from '../src/core/relatedRates'
import { readField } from '../src/ui/fieldLinks'
import { solveField } from '../src/core/ode'
import { arcLengthOf, atParam } from '../src/core/paramCalc'
import { alternatingBound, lagrangeBound, taylorSourceOf } from '../src/core/taylor'
import { docModelFromJSON } from '../src/ui/docScene'
import { docAnswerLines } from '../src/ui/docAnswers'

const load = (id: string) => {
  const def = exampleById(id)
  if (!def) throw new Error(`no example ${id}`)
  const built = buildExample(def)
  const res = deserializeDoc(built.json)
  if (!res.board) throw new Error(`example ${id} did not load`)
  const board = res.board
  const models: Record<string, ModelSpec> = { ...MODELS, ...board.extraModels }
  /** The typed line with this source. */
  const typed = (src: string): FittedCurve => {
    const id = Object.keys(board.exprSources).find((k) => board.exprSources[k] === src)
    const c = board.curves.find((k) => k.id === id)
    if (!c) throw new Error(`${id}: no line “${src}”`)
    return c
  }
  /** The tangent line drawn for a tangent link on `parent`, as [b, m]. */
  const tangentLine = (parent: FittedCurve): [number, number] => {
    const link = board.calc.find((l) => l.kind === 'tangent' && l.parentId === parent.id)
    if (!link || link.kind !== 'tangent') throw new Error('no tangent')
    const line = board.curves.find((c) => c.id === link.curveId)!
    expect(line.modelId).toBe('line')
    return [line.params[0], line.params[1]]
  }
  const answers = (): string[] => docAnswerLines(docModelFromJSON(built.json)!).map((l) => `${l.label}: ${l.value}`)
  return { def, built, board, models, typed, tangentLine, answers }
}

const limitOf = (c: FittedCurve, models: Record<string, ModelSpec>, a: number) => {
  const src = limitSourceOf(c, models)
  if (!src) throw new Error('no limit source')
  return limitAt(src, a)
}

describe('more AP Calculus examples', () => {
  it('are all in the gallery, course calc, with U-tags and existing calc help sections', () => {
    const sections = new Set(HELP_SECTIONS.map((s) => s.id))
    expect(MORE_CALC.length).toBe(12)
    for (const def of MORE_CALC) {
      expect(EXAMPLE_DEFS).toContain(def)
      expect(def.course).toBe('calc')
      expect(def.id.startsWith('calc-')).toBe(true)
      expect(def.unit).toMatch(/^U([1-9]|10)$/)
      expect(def.help[0]).toBe(`calc-${def.unit.slice(1)}`)
      for (const h of def.help) expect(sections.has(h), `${def.id} → ${h}`).toBe(true)
    }
    // at least one new example in each of the thin units
    for (const u of ['U2', 'U3', 'U4', 'U7', 'U9']) {
      expect(MORE_CALC.some((d) => d.unit === u), u).toBe(true)
    }
  })

  for (const def of MORE_CALC) {
    it(`${def.id} builds and loads with zero problems`, () => {
      const res = deserializeDoc(buildExample(def).json)
      expect(res.problems).toEqual([])
      expect(res.degraded).toBe(false)
      expect(res.board?.brokenExpr).toEqual({})
    })
  }

  it('U2: lim (√(4 + h) − 2)/h = 1/4, a hole at h = 0', () => {
    const { board, models, typed } = load('calc-u2-difference-quotient')
    const q = typed('q(x) = (sqrt(4 + x) - 2)/x')
    const r = limitOf(q, models, 0)
    expect(r.two.value).toBeCloseTo(0.25, 9)
    expect(r.two.exact?.text).toBe('1/4')
    expect(r.kind).toBe('removable')
    expect(r.fa).toBeNull()
    expect(board.calc[0]).toMatchObject({ kind: 'limit', a: 0, table: true })
    // = f′(4) for f(x) = √x: 1/(2√4)
    expect(1 / (2 * Math.sqrt(4))).toBe(0.25)
  })

  it('U2: |x² − 4| is continuous at 2, but its difference quotient goes to −4 and 4', () => {
    const { models, typed } = load('calc-u2-corner')
    const f = limitOf(typed('f(x) = |x^2 - 4|'), models, 2)
    expect(f.kind).toBe('continuous')
    expect(f.two.value).toBeCloseTo(0, 9)
    expect(f.checklist).toEqual([true, true, true])
    const q = limitOf(typed('q(x) = |x^2 - 4|/(x - 2)'), models, 2)
    expect(q.left?.value).toBeCloseTo(-4, 6)
    expect(q.right?.value).toBeCloseTo(4, 6)
    expect(q.two.value).toBe('DNE')
    expect(q.kind).toBe('jump')
  })

  it('U3: f′(1) = 4 at (1, 3); the inverse x = y³ + y + 1 has slope 1/4 at (3, 1)', () => {
    const { board, typed, tangentLine } = load('calc-u3-inverse-derivative')
    const f = typed('f(x) = x^3 + x + 1')
    expect(tangentLine(f)).toEqual([expect.closeTo(-1, 9), expect.closeTo(4, 9)]) // y = 4x − 1 through (1, 3)
    const inv = typed('x = y^3 + y + 1')
    const link = board.calc.find((l) => l.kind === 'tangent' && l.parentId === inv.id)!
    expect(link.kind === 'tangent' && [link.x, link.y]).toEqual([3, 1])
    const [b, m] = tangentLine(inv)
    expect(m).toBeCloseTo(1 / 4, 9) // = 1/f′(1); implicitly 1/(3y² + 1) at y = 1
    expect(b).toBeCloseTo(1 / 4, 9) // y = (x + 1)/4 through (3, 1): the reflection of y = 4x − 1
    expect(Object.values(board.exprSources)).toContain('y = x')
  })

  it('U3: x² + 4y² = 7 + 3xy: horizontal tangent at (3, 2), d²y/dx² = −2/7, vertical tangents at x = ±4', () => {
    const { board, typed, tangentLine } = load('calc-u3-implicit-ellipse')
    const c = typed('x^2 + 4y^2 = 7 + 3x y')
    expect(board.calc[0]).toMatchObject({ kind: 'tangent', x: 3, y: 2, marks: true })
    const [b, m] = tangentLine(c)
    expect(m).toBeCloseTo(0, 9)
    expect(b).toBeCloseTo(2, 9)
    // the upper branch y = (3x + √(112 − 7x²))/8 through P
    const y = (x: number): number => (3 * x + Math.sqrt(112 - 7 * x * x)) / 8
    expect(y(3)).toBe(2)
    const dydx = (x: number, yy: number): number => (3 * yy - 2 * x) / (8 * yy - 3 * x)
    expect(dydx(3, 2)).toBe(0)
    const h = 1e-4
    expect((y(3 + h) - 2 * y(3) + y(3 - h)) / (h * h)).toBeCloseTo(-2 / 7, 5)
    // x = 3 also meets the curve at y = 1/4, where the slope is 3/4
    expect(dydx(3, 0.25)).toBeCloseTo(0.75, 12)
    // vertical tangents where 8y = 3x: (±4, ±3/2)
    expect(112 - 7 * 16).toBe(0)
    expect(y(4)).toBe(1.5)
  })

  it('U4: the cone, when h = 4: dh/dt = 5/(2π) ft/min', () => {
    const { board } = load('calc-u4-cone')
    const rr = board.relatedRates[0]
    expect(rr.scenario).toBe('cone')
    expect(rr.when).toEqual({ q: 'h', v: 4 })
    expect(rr.params).toMatchObject({ R: 5, H: 10, k: 10 })
    const s = RR_DEFS.cone.state(rr.params, rr.t)
    expect(s.q.h).toBeCloseTo(4, 9)
    expect(s.q.r).toBeCloseTo(2, 9)
    expect(s.unknown).toBeCloseTo(5 / (2 * Math.PI), 12)
    expect(rateForm(s.unknown).exact?.text).toBe('5/(2π)')
    expect(rateForm(s.unknown).decimal).toBe('0.796')
    // V = πh³/12 when r = h/2
    expect((Math.PI / 3) * 2 * 2 * 4).toBeCloseTo((Math.PI * 4 ** 3) / 12, 12)
  })

  it('U4: the tangent to ln x at 1 is y = x − 1; L(1.5) = 0.5 overestimates ln 1.5', () => {
    const { typed, tangentLine } = load('calc-u4-linearization')
    const [b, m] = tangentLine(typed('f(x) = ln(x)'))
    expect(m).toBeCloseTo(1, 9)
    expect(b).toBeCloseTo(-1, 9)
    const L = b + m * 1.5
    expect(L).toBeCloseTo(0.5, 9)
    expect(Math.log(1.5)).toBeCloseTo(0.405, 3)
    expect(L).toBeGreaterThan(Math.log(1.5))
  })

  it("U4: L'Hôpital: arctan 2x / arctan x → 2 at 0, and levels off at 1", () => {
    const { board, models, typed, answers } = load('calc-u4-lhopital')
    const q = typed('q(x) = arctan(2x)/arctan(x)')
    const r = limitOf(q, models, 0)
    expect(r.two.value).toBeCloseTo(2, 9)
    expect(r.kind).toBe('removable')
    expect(board.calc[0]).toMatchObject({ kind: 'limit', a: 0, table: true })
    // N(0) = D(0) = 0, N′(0) = 2, D′(0) = 1
    const h = 1e-6
    expect((Math.atan(2 * h) - Math.atan(-2 * h)) / (2 * h)).toBeCloseTo(2, 6)
    expect((Math.atan(h) - Math.atan(-h)) / (2 * h)).toBeCloseTo(1, 6)
    const a = answers()
    expect(a).toContain('q · hole: (0, 2)')
    expect(a).toContain('q · asymptote: y = 1')
  })

  it('U4: s(t) = t³ − 6t² + 9t: at rest at 1 and 3, moving left on (1, 3), inflection at 2', () => {
    const { board, answers } = load('calc-u4-particle-motion')
    expect(board.calc[0]).toMatchObject({ kind: 'signchart', rows: ['f', 'f1', 'f2'] })
    const chart = answers().find((l) => l.startsWith('s · sign chart'))!
    expect(chart).toContain('s is increasing on (0, 1) and (3, ∞)')
    expect(chart).toContain('s is decreasing on (1, 3)')
    expect(chart).toContain('concave down on (0, 2)')
    expect(chart).toContain('concave up on (2, ∞)')
    // speeding up where v = 3(t − 1)(t − 3) and a = 6(t − 2) share a sign
    const v = (t: number): number => 3 * (t - 1) * (t - 3)
    const acc = (t: number): number => 6 * (t - 2)
    for (const t of [1.5, 4]) expect(v(t) * acc(t)).toBeGreaterThan(0)
    for (const t of [0.5, 2.5]) expect(v(t) * acc(t)).toBeLessThan(0)
  })

  it('U5: the Candidates Test on [−2, 3]: max 8 at −1, min −19 at 2', () => {
    const { board, answers } = load('calc-u5-candidates')
    expect(board.calc[0]).toMatchObject({ kind: 'signchart', a: -2, b: 3 })
    const chart = answers().find((l) => l.startsWith('f · sign chart'))!
    expect(chart).toContain('f(−2) = −3, f(−1) = 8, f(2) = −19, and f(3) = −8')
    expect(chart).toContain('The absolute maximum of f on [−2, 3] is 8, at x = −1.')
    expect(chart).toContain('The absolute minimum of f on [−2, 3] is −19, at x = 2.')
    const f = (x: number): number => 2 * x ** 3 - 3 * x ** 2 - 12 * x + 1
    expect([-2, -1, 2, 3].map(f)).toEqual([-3, 8, -19, -8])
  })

  it('U7: the solution of dy/dx = −x/y through (0, 2) is y = √(4 − x²), ending at x = ±2', () => {
    const { board } = load('calc-u7-separable')
    const field = board.fields[0]
    expect(field.src).toBe('dy/dx = -x/y')
    expect(field.solutions.map((s) => [s.x, s.y])).toEqual([[0, 2]])
    const read = readField(field.src)
    if (!read.ok) throw new Error(read.error)
    const f = read.makeField('t', field.params, '#fff').f
    const pts = solveField(f, { x: 0, y: 2 }, [-3.5, 3.5])
    for (const p of pts) expect(p.x * p.x + p.y * p.y).toBeCloseTo(4, 3)
    const xs = pts.map((p) => p.x)
    expect(Math.min(...xs)).toBeGreaterThan(-2.01)
    expect(Math.max(...xs)).toBeLessThan(2.01)
    expect(Math.max(...xs)).toBeGreaterThan(1.9)
  })

  it('U9: the cycloid: speed √2 and slope 1 at t = π/2; distance 8, displacement 2π', () => {
    const { board, models, typed } = load('calc-u9-cycloid')
    const c = typed('(x, y) = (t - sin(t), 1 - cos(t)) {0 <= t <= 2pi}')
    expect(board.calc[0]).toMatchObject({ kind: 'pcalc', t: Math.PI / 2, marks: true, a: 0, b: 2 * Math.PI })
    const at = atParam(c, models, null, Math.PI / 2)!
    expect(at.dx.value).toBeCloseTo(1, 6)
    expect(at.dy.value).toBeCloseTo(1, 6)
    expect(at.speed.value).toBeCloseTo(Math.SQRT2, 6)
    expect(at.slope?.value).toBeCloseTo(1, 6)
    const arc = arcLengthOf(c, models, null, 0, 2 * Math.PI)!
    expect(arc.length.value).toBeCloseTo(8, 5)
    expect(arc.displacement?.length.value).toBeCloseTo(2 * Math.PI, 6)
  })

  it('U10: P₄ of cos x at 1: error ≈ 0.00136 under Lagrange sin 1/120 and alternating 1/720', () => {
    const { board, models, typed } = load('calc-u10-lagrange')
    const f = typed('f(x) = cos(x)')
    expect(board.calc[0]).toMatchObject({ kind: 'taylor', a: 0, n: 4, x: 1, band: true })
    const src = taylorSourceOf(f, models)!
    const P4 = 1 - 1 / 2 + 1 / 24
    expect(P4).toBeCloseTo(13 / 24, 15)
    const err = Math.abs(Math.cos(1) - P4)
    expect(err).toBeCloseTo(0.00136, 5)
    const lag = lagrangeBound(src, 0, 4, 1)!
    expect(lag.M).toBeCloseTo(Math.sin(1), 6)
    expect(lag.bound).toBeCloseTo(Math.sin(1) / 120, 8)
    expect(lag.bound).toBeCloseTo(0.0070, 4)
    const alt = alternatingBound(src, 0, 4, 1)!
    expect(alt).toBeCloseTo(1 / 720, 10)
    expect(err).toBeLessThan(alt)
    expect(alt).toBeLessThan(lag.bound)
  })
})

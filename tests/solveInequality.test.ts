// ============================================================================
// tests/solveInequality.test.ts — the number-line inequality solver
// (src/core/solveInequality.ts).
//
// Every expected set, critical value, ○/● and test-point sign below is worked
// out by hand, not read back from the implementation.
// ============================================================================

import { describe, it, expect } from 'vitest'
import { solveInequality, type SolveResult, type ClauseWork } from '../src/core/solveInequality'
import { parseInequality } from '../src/core/parse/inequality'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function solve(src: string, opts?: Parameters<typeof solveInequality>[1]): SolveResult {
  const r = solveInequality(src, opts)
  if (!r.ok) throw new Error(`expected "${src}" to solve, got: ${r.error}`)
  return r
}

function err(src: string): { error: string; pos?: number } {
  const r = solveInequality(src)
  if (r.ok) throw new Error(`expected "${src}" to fail, but it solved to ${r.solution.text}`)
  return r
}

/** [lo, hi, loClosed, hiClosed] per part — ±Infinity for unbounded sides */
type P = [number, number, boolean, boolean]
const parts = (r: SolveResult | ClauseWork): P[] =>
  r.solution.parts.map((p) => [p.lo, p.hi, p.loClosed, p.hiClosed])

function expectParts(src: string, want: P[]): SolveResult {
  const r = solve(src)
  const got = parts(r)
  expect(got.length, `${src}: ${r.solution.text}`).toBe(want.length)
  got.forEach((g, i) => {
    const w = want[i]
    for (const k of [0, 1] as const) {
      if (Number.isFinite(w[k])) expect(g[k]).toBeCloseTo(w[k], 10)
      else expect(g[k]).toBe(w[k])
    }
    expect([g[2], g[3]], `${src}: closedness of part ${i}`).toEqual([w[2], w[3]])
  })
  return r
}

const crit = (w: ClauseWork) => w.critical.map((c) => ({ x: c.exact?.text ?? c.x, why: c.why, in: c.included }))
const rows = (w: ClauseWork) => w.table.map((t) => ({ t: t.tText, sign: t.sign, ok: t.satisfies }))

const INF = Infinity

// ---------------------------------------------------------------------------
// Polynomials and rational functions (exact)
// ---------------------------------------------------------------------------

describe('polynomial inequalities', () => {
  it('x² − 4 > 0: critical −2 and 2 both ○, test points −3, 0, 3 with signs + − +', () => {
    const r = expectParts('x^2 - 4 > 0', [[-INF, -2, false, false], [2, INF, false, false]])
    expect(r.solution.text).toBe('(−∞, −2) ∪ (2, ∞)')
    expect(r.combine).toBe('single')
    const w = r.clauses[0]
    expect(w.hText).toBe('x² − 4')
    expect(w.relation).toBe('>')
    expect(crit(w)).toEqual([
      { x: '−2', why: 'zero', in: false },
      { x: '2', why: 'zero', in: false },
    ])
    expect(rows(w)).toEqual([
      { t: '−3', sign: 1, ok: true },
      { t: '0', sign: -1, ok: false },
      { t: '3', sign: 1, ok: true },
    ])
    expect(w.table.map((t) => t.valueText)).toEqual(['5', '−4', '5'])
    expect(w.factored?.text).toBe('(x + 2)(x − 2)')
    expect(r.exact).toBe(true)
    expect(r.conclusion).toBe('x² − 4 > 0 for x < −2 or x > 2, so the solution is (−∞, −2) ∪ (2, ∞)')
  })

  it('x² − 4 ≤ 0 → [−2, 2], both ends ●', () => {
    const r = expectParts('x^2 - 4 <= 0', [[-2, 2, true, true]])
    expect(r.solution.text).toBe('[−2, 2]')
    expect(r.clauses[0].critical.map((c) => c.included)).toEqual([true, true])
  })

  it('x³ ≥ 4x → [−2, 0] ∪ [2, ∞): h = x³ − 4x = x(x + 2)(x − 2)', () => {
    const r = expectParts('x^3 >= 4x', [[-2, 0, true, true], [2, INF, true, false]])
    const w = r.clauses[0]
    expect(w.hText).toBe('x³ − 4x')
    expect(w.factored?.text).toBe('x(x + 2)(x − 2)')
    // h(−3) = −15, h(−1) = 3, h(1) = −3, h(3) = 15
    expect(w.table.map((t) => [t.tText, t.valueText])).toEqual([['−3', '−15'], ['−1', '3'], ['1', '−3'], ['3', '15']])
  })

  it('(x − 3)² > 0 is x ≠ 3: a double root, no sign change, ○', () => {
    const r = expectParts('(x-3)^2 > 0', [[-INF, 3, false, false], [3, INF, false, false]])
    expect(r.solution.builder).toBe('x ≠ 3')
    const w = r.clauses[0]
    expect(w.critical).toHaveLength(1)
    expect(w.critical[0]).toMatchObject({ x: 3, why: 'zero', included: false, multiplicity: 2 })
    expect(w.table.map((t) => t.sign)).toEqual([1, 1])
    expect(r.notes.some((n) => /multiplicity 2/.test(n))).toBe(true)
  })

  it('(x − 3)² ≤ 0 is {3}; (x − 3)² < 0 has no solution', () => {
    const a = expectParts('(x-3)^2 <= 0', [[3, 3, true, true]])
    expect(a.solution.kind).toBe('finite')
    expect(a.solution.text).toBe('{3}')
    const b = expectParts('(x-3)^2 < 0', [])
    expect(b.solution.text).toBe('∅')
    expect(b.conclusion).toMatch(/never true/)
    expect(b.conclusion).toMatch(/no solution/)
  })

  it('x² > 2 has exact ends ±√2', () => {
    const r = expectParts('x^2 > 2', [[-INF, -Math.SQRT2, false, false], [Math.SQRT2, INF, false, false]])
    expect(r.solution.text).toBe('(−∞, −√2) ∪ (√2, ∞)')
    expect(r.clauses[0].critical.map((c) => c.exact?.text)).toEqual(['−√2', '√2'])
    expect(r.exact).toBe(true)
  })

  it('x² − x − 1 < 0 → ((1 − √5)/2, (1 + √5)/2)', () => {
    const lo = (1 - Math.sqrt(5)) / 2
    const hi = (1 + Math.sqrt(5)) / 2
    const r = expectParts('x^2 - x - 1 < 0', [[lo, hi, false, false]])
    expect(r.solution.text).toBe('((1−√5)/2, (1+√5)/2)')
    expect(r.solution.text).not.toMatch(/\d\.\d/)
  })

  it('x² − 4 = 0 is the set {−2, 2}', () => {
    const r = expectParts('x^2 - 4 = 0', [[-2, -2, true, true], [2, 2, true, true]])
    expect(r.solution.kind).toBe('finite')
    expect(r.solution.text).toBe('{−2, 2}')
    expect(r.solution.points).toEqual([-2, 2])
    expect(r.conclusion).toBe('x² − 4 = 0 when x = −2 or x = 2, so the solution set is {−2, 2}')
  })

  it('a biquadratic with irrational roots: x⁴ − 5x² + 6 < 0 → (−√3, −√2) ∪ (√2, √3)', () => {
    const r = expectParts('x^4 - 5x^2 + 6 < 0', [[-Math.sqrt(3), -Math.SQRT2, false, false], [Math.SQRT2, Math.sqrt(3), false, false]])
    expect(r.solution.text).toBe('(−√3, −√2) ∪ (√2, √3)')
  })

  it('a cube root: x³ − 2 > 0 → (∛2, ∞)', () => {
    const r = expectParts('x^3 - 2 > 0', [[Math.cbrt(2), INF, false, false]])
    expect(r.solution.text).toBe('(∛2, ∞)')
    expect(r.exact).toBe(true)
  })

  it('a cubic with no closed form here gives decimals, and says so', () => {
    // x³ − 3x + 1: roots 2cos(2π/9), 2cos(4π/9), 2cos(8π/9)
    const r = solve('x^3 - 3x + 1 > 0')
    const roots = [2 * Math.cos((8 * Math.PI) / 9), 2 * Math.cos((4 * Math.PI) / 9), 2 * Math.cos((2 * Math.PI) / 9)]
    expect(parts(r).length).toBe(2)
    expect(r.solution.parts[0].lo).toBeCloseTo(roots[0], 12)
    expect(r.solution.parts[0].hi).toBeCloseTo(roots[1], 12)
    expect(r.solution.parts[1].lo).toBeCloseTo(roots[2], 12)
    expect(r.exact).toBe(false)
    expect(r.notes.some((n) => /approximate/.test(n))).toBe(true)
  })

  it('x² + 1 > 0 is every real number; x² + 1 < 0 is nothing', () => {
    expectParts('x^2 + 1 > 0', [[-INF, INF, false, false]])
    expect(solve('x^2 + 1 > 0').conclusion).toMatch(/every real number/)
    expectParts('x^2 + 1 < 0', [])
  })
})

describe('rational inequalities', () => {
  it('(x − 1)/(x + 2) ≤ 0 → (−2, 1]: −2 is undefined (○), 1 is ●', () => {
    const r = expectParts('(x-1)/(x+2) <= 0', [[-2, 1, false, true]])
    const w = r.clauses[0]
    expect(crit(w)).toEqual([
      { x: '−2', why: 'undefined', in: false },
      { x: '1', why: 'zero', in: true },
    ])
    // h(−3) = 4, h(0) = −1/2, h(2) = 1/4
    expect(w.table.map((t) => [t.tText, t.valueText, t.sign])).toEqual([['−3', '4', 1], ['0', '−1/2', -1], ['2', '1/4', 1]])
    expect(w.domain?.text).toBe('(−∞, −2) ∪ (−2, ∞)')
  })

  it('1/x > 1 → (0, 1), with the test point 1/2 between 0 and 1', () => {
    const r = expectParts('1/x > 1', [[0, 1, false, false]])
    const w = r.clauses[0]
    expect(crit(w)).toEqual([
      { x: '0', why: 'undefined', in: false },
      { x: '1', why: 'zero', in: false },
    ])
    expect(rows(w)).toEqual([
      { t: '−1', sign: -1, ok: false },
      { t: '1/2', sign: 1, ok: true },
      { t: '2', sign: -1, ok: false },
    ])
  })

  it('x/(x² − 9) ≥ 0 → (−3, 0] ∪ (3, ∞)', () => {
    const r = expectParts('x/(x^2 - 9) >= 0', [[-3, 0, false, true], [3, INF, false, false]])
    expect(crit(r.clauses[0])).toEqual([
      { x: '−3', why: 'undefined', in: false },
      { x: '0', why: 'zero', in: true },
      { x: '3', why: 'undefined', in: false },
    ])
  })

  it('a hole is still not in the domain: (x² − 4)/(x − 2) > 0 → (−2, 2) ∪ (2, ∞)', () => {
    expectParts('(x^2-4)/(x-2) > 0', [[-2, 2, false, false], [2, INF, false, false]])
  })

  it('≥ never includes a pole even though h "= 0" is allowed', () => {
    expectParts('1/(x-1) + 1/(x+1) >= 0', [[-1, 0, false, true], [1, INF, false, false]])
  })
})

// ---------------------------------------------------------------------------
// Absolute value
// ---------------------------------------------------------------------------

describe('absolute value', () => {
  it('|2x − 3| < 5 → (−1, 4), the numbers within 5/2 of 3/2', () => {
    const r = expectParts('|2x - 3| < 5', [[-1, 4, false, false]])
    const d = r.clauses[0].distance
    expect(d).not.toBeNull()
    expect(d!.center).toBe(1.5)
    expect(d!.radius).toBe(2.5)
    expect(d!.centerText).toBe('3/2')
    expect(d!.radiusText).toBe('5/2')
    expect(d!.sentence).toMatch(/within 5\/2 of 3\/2/)
  })

  it('|x − 4| ≥ 2 → (−∞, 2] ∪ [6, ∞), at least 2 from 4', () => {
    const r = expectParts('|x - 4| >= 2', [[-INF, 2, false, true], [6, INF, true, false]])
    expect(r.clauses[0].distance?.sentence).toMatch(/at least 2 from 4/)
  })

  it('isolating the bars: 2|x − 1| + 3 ≥ 7 → (−∞, −1] ∪ [3, ∞)', () => {
    const r = expectParts('2|x - 1| + 3 >= 7', [[-INF, -1, false, true], [3, INF, true, false]])
    expect(r.clauses[0].distance?.sentence).toMatch(/at least 2 from 1/)
  })

  it('a negative coefficient flips: −|x| > −2 → (−2, 2), worked as |x| − 2 < 0', () => {
    const r = expectParts('-|x| > -2', [[-2, 2, false, false]])
    const w = r.clauses[0]
    expect(w.distance?.sentence).toMatch(/within 2 of 0/)
    // the bars are isolated with a positive coefficient, so relation and distance agree
    expect(w.hText).toBe('|x| − 2')
    expect(w.relation).toBe('<')
    expect(w.table.map((t) => t.sign)).toEqual([1, -1, 1])
  })

  it('−2|3 − x| + 1 ≤ −5 → (−∞, 0] ∪ [6, ∞): h = 2|3 − x| − 6 ≥ 0', () => {
    const r = expectParts('-2|3 - x| + 1 <= -5', [[-INF, 0, false, true], [6, INF, true, false]])
    expect(r.clauses[0].hText).toBe('2|3 − x| − 6')
    expect(r.clauses[0].relation).toBe('>=')
    expect(r.clauses[0].distance?.sentence).toMatch(/at least 3 from 3/)
  })

  it('|x − 1| ≤ 0 is {1}; |x − 1| < 0 is ∅', () => {
    expectParts('|x - 1| <= 0', [[1, 1, true, true]])
    expectParts('|x - 1| < 0', [])
  })

  it('a non-linear inside is solved numerically, still exactly: |x² − 4| < 3', () => {
    const r = expectParts('|x^2 - 4| < 3', [[-Math.sqrt(7), -1, false, false], [1, Math.sqrt(7), false, false]])
    expect(r.solution.text).toBe('(−√7, −1) ∪ (1, √7)')
    expect(r.clauses[0].distance).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Radicals, exponentials, logarithms, trig
// ---------------------------------------------------------------------------

describe('transcendental and radical inequalities', () => {
  it('√(x + 1) ≥ x − 1 → [−1, 3]: the domain end −1 is defined and satisfies, so ●', () => {
    // h(−1) = 0 + 2 = 2 ≥ 0 ✓; h(3) = 2 − 2 = 0 ✓; h(0) = 2 > 0; h(4) = √5 − 3 < 0
    const r = expectParts('sqrt(x+1) >= x - 1', [[-1, 3, true, true]])
    const w = r.clauses[0]
    expect(crit(w)).toEqual([
      { x: '−1', why: 'domain-end', in: true },
      { x: '3', why: 'zero', in: true },
    ])
    expect(w.table[0].value).toBeNull() // x < −1: h undefined
    expect(w.table[0].sign).toBeNull()
    expect(w.table.slice(1).map((t) => t.sign)).toEqual([1, -1])
    expect(w.domain?.text).toBe('[−1, ∞)')
  })

  it('√x < 3 → [0, 9): the domain end 0 is ●, 9 is ○', () => {
    expectParts('sqrt(x) < 3', [[0, 9, true, false]])
  })

  it('a √ end that does not satisfy is ○: √(x² − 2) ≥ 1 → (−∞, −√3] ∪ [√3, ∞)', () => {
    const r = expectParts('sqrt(x^2 - 2) >= 1', [[-INF, -Math.sqrt(3), false, true], [Math.sqrt(3), INF, true, false]])
    const ends = r.clauses[0].critical.filter((c) => c.why === 'domain-end')
    expect(ends.map((c) => [c.exact?.text, c.included])).toEqual([['−√2', false], ['√2', false]])
    expect(r.clauses[0].domain?.text).toBe('(−∞, −√2] ∪ [√2, ∞)')
  })

  it('eˣ > 3 → (ln 3, ∞), exactly', () => {
    const r = expectParts('e^x > 3', [[Math.log(3), INF, false, false]])
    expect(r.solution.text).toBe('(ln 3, ∞)')
    expect(r.exact).toBe(true)
    expect(r.clauses[0].critical[0].exact?.text).toBe('ln 3')
  })

  it('more closed forms: 2ˣ < 5, e^(2x) > 3, ln x ≥ 1', () => {
    expect(expectParts('2^x < 5', [[-INF, Math.log2(5), false, false]]).solution.text).toBe('(−∞, log₂ 5)')
    expect(expectParts('e^(2x) > 3', [[Math.log(3) / 2, INF, false, false]]).solution.text).toBe('(ln(3)/2, ∞)')
    expect(expectParts('ln(x) >= 1', [[Math.E, INF, true, false]]).solution.text).toBe('[e, ∞)')
  })

  it('log(x) < 2 → (0, 100): the log end 0 is ○', () => {
    const r = expectParts('log(x) < 2', [[0, 100, false, false]])
    expect(crit(r.clauses[0])).toEqual([
      { x: '0', why: 'domain-end', in: false },
      { x: '100', why: 'zero', in: false },
    ])
  })

  it('sin x ≥ 1/2 on [0, 2π] → [π/6, 5π/6]', () => {
    const r = expectParts('sin(x) >= 1/2 {0 <= x <= 2pi}', [[Math.PI / 6, (5 * Math.PI) / 6, true, true]])
    expect(r.solution.text).toBe('[π/6, 5π/6]')
    expect(r.universe).toMatchObject({ lo: 0, loClosed: true, hiClosed: true })
    expect(r.universe!.hi).toBeCloseTo(2 * Math.PI, 12)
    const w = r.clauses[0]
    // the universe's ends are ends of the domain: sin 0 − 1/2 < 0, so ○
    expect(crit(w)).toEqual([
      { x: '0', why: 'domain-end', in: false },
      { x: 'π/6', why: 'zero', in: true },
      { x: '5π/6', why: 'zero', in: true },
      { x: '2π', why: 'domain-end', in: false },
    ])
    expect(w.table.map((t) => t.sign)).toEqual([-1, 1, -1])
    expect(w.table[1].tText).toBe('π/2')
    expect(r.conclusion).toMatch(/^On 0 ≤ x ≤ 2π, /)
  })

  it('closed universe ends are ● when they satisfy: sin x < 1/3 on [0, 2π]', () => {
    const a = Math.asin(1 / 3)
    const r = expectParts('sin(x) < 1/3 {0<=x<=2pi}', [[0, a, true, false], [Math.PI - a, 2 * Math.PI, false, true]])
    expect(r.solution.text).toBe('[0, arcsin(1/3)) ∪ (π − arcsin(1/3), 2π]')
  })

  it('an unrestricted periodic clause is solved over one period, and says so', () => {
    const r = expectParts('sin(x) > 0', [[0, Math.PI, false, false]])
    expect(r.universe).toMatchObject({ lo: 0, loClosed: true, hiClosed: false })
    expect(r.notes.some((n) => /one period/.test(n))).toBe(true)
  })

  it('the poles of tan are undefined points: tan x ≥ 1 → [π/4, π/2) ∪ [5π/4, 3π/2)', () => {
    const r = expectParts('tan(x) >= 1', [[Math.PI / 4, Math.PI / 2, true, false], [(5 * Math.PI) / 4, (3 * Math.PI) / 2, true, false]])
    expect(r.clauses[0].critical.filter((c) => c.why === 'undefined').map((c) => c.exact?.text)).toEqual(['π/2', '3π/2'])
  })

  it('sin x ≥ 1 touches: {π/2}', () => {
    expect(solve('sin(x) >= 1').solution.text).toBe('{π/2}')
  })

  it('no closed form: sin x > x/10 gives decimals and the window note', () => {
    const r = solve('sin(x) > x/10')
    expect(r.exact).toBe(false)
    expect(r.solution.parts[0].hi).toBeCloseTo(-8.42320393236, 9)
    expect(r.notes.some((n) => /numeric search/.test(n))).toBe(true)
  })

  it('underflow and overflow are not mistaken for zeros or domain ends', () => {
    expectParts('x*e^x > 0', [[0, INF, false, false]])
    expectParts('e^(-x^2) > 0', [[-INF, INF, false, false]])
    expectParts('e^x/(e^x+1) > 1/2', [[0, INF, false, false]])
  })
})

// ---------------------------------------------------------------------------
// Compounds
// ---------------------------------------------------------------------------

describe('compound inequalities', () => {
  it('2 < 3x − 1 ≤ 8 → (1, 3], solved as two clauses joined by and', () => {
    const r = expectParts('2 < 3x - 1 <= 8', [[1, 3, false, true]])
    expect(r.combine).toBe('and')
    expect(r.clauses).toHaveLength(2)
    expect(parts(r.clauses[0])).toEqual([[1, INF, false, false]])
    expect(parts(r.clauses[1])).toEqual([[-INF, 3, false, true]])
  })

  it('x² > 1 and x < 3 → (−∞, −1) ∪ (1, 3)', () => {
    const r = expectParts('x^2 > 1 and x < 3', [[-INF, -1, false, false], [1, 3, false, false]])
    expect(r.combine).toBe('and')
    expect(r.conclusion).toMatch(/Both are true for x < −1 or 1 < x < 3/)
  })

  it('x < −1 or x ≥ 2 → (−∞, −1) ∪ [2, ∞)', () => {
    const r = expectParts('x < -1 or x >= 2', [[-INF, -1, false, false], [2, INF, true, false]])
    expect(r.combine).toBe('or')
  })

  it('|x − 4| ≥ 2 or x = 0', () => {
    expectParts('|x - 4| >= 2 or x = 0', [[-INF, 2, false, true], [6, INF, true, false]])
  })

  it('and binds tighter than or; brackets group', () => {
    expectParts('x < 3 and x > 1 or x > 10', [[1, 3, false, false], [10, INF, false, false]])
    expectParts('(x < -1 or x > 1) and x < 3', [[-INF, -1, false, false], [1, 3, false, false]])
    expectParts('x > 1 and (x < 2 or x > 3)', [[1, 2, false, false], [3, INF, false, false]])
  })

  it('a restriction applies to every clause', () => {
    expectParts('x^2 - 4 > 0 on [0, 5]', [[2, 5, false, true]])
    expectParts('sin x > 0, x ∈ [-π, π]', [[0, Math.PI, false, false]])
    expectParts('cos(2x) < 0 for 0 <= x < pi', [[Math.PI / 4, (3 * Math.PI) / 4, false, false]])
  })
})

// ---------------------------------------------------------------------------
// The old number-line parser's inputs solve to the same sets
// ---------------------------------------------------------------------------

describe('compatibility with the old number-line parser', () => {
  const OLD = [
    'x > 2', '-1 <= x < 3', '[0, 5)', 'x != 4', '{1, 2, 3}',
    'x < 3', 'x > -2', 'x <= 1', 'x >= -2', 'x ≤ 1', 'x ≥ -2', 'x ≠ 3', 'x = 4', '3 > x', '-2 <= x',
    't < 3', 'n >= 0 and n <= 4', '   x   <   3   ', '2 < x <= 7', '5 > x >= -2', '7 >= x > 2', '0 <= x <= 1',
    '3 <= x <= 3', '5 <= x < 2', 'x < -2 or x >= 3', 'x <= 1 and x > -4', 'x < 1 ∪ x > 4', 'x > 0 ∩ x < 9',
    'x < 3 and x > 1 or x > 10', 'x < 1 OR x > 4', '(x < 3)', 'x > 10 or x < -10', '{5, -1, 2}', 'x < 1 or x < 3',
    '[1, 4] or [2, 7]', 'x <= 2 or x > 2', 'x < 2 or x > 2', '[1,3] or [3,5]', '[1,3) or [3,5]', '[1,3) or (3,5]',
    '[1,5] or {3}', 'x <= 5 or x = 5', '[1,5) or {5}', '(1,5) or {1}', '{2, 2, 2}', 'x = 2 or x = 2',
    'x >= 3 and x <= 3', 'x > 3 and x <= 3', 'x != 3 and x > 0', '{1, 2, 3} and {2, 3, 4}', '[-2, 5)', '(-2, 5]',
    '(-inf, 3]', '(-infinity, 3]', '(-∞, 3]', '[0, ∞)', '[0, inf)', '(-inf, inf)', '[-inf, 3]', 'x < inf',
    'x > -infinity', '[3, 3]', '[3, 3)', '(3, 3)', '{-1, 2, 5}', '{}', '{7}', '(-inf, -2] or {0} or [3, 5)',
    'x < -3/4', 'x < 1e2', '[-(1+1), 3^2)', 'x > |-5|', 'x <= 2*pi or x > tau', '[min(1, 2), max(3, 4)]',
    '0 <= theta < pi', 'x > floor(2.7) and x < sqrt(9)', 'x <= sqrt(2)', 'x == 3', 'x <> 3', 'x =< 3',
  ]

  const canon = (src: string): P[] => {
    const r = parseInequality(src)
    if (!r.ok) throw new Error(`old parser rejects ${src}: ${r.error}`)
    return r.items.map((it) =>
      it.kind === 'point'
        ? ([it.x, it.x, true, true] as P)
        : ([it.lo ?? -INF, it.hi ?? INF, it.lo !== null && it.loClosed, it.hi !== null && it.hiClosed] as P),
    )
  }

  for (const src of OLD) {
    it(`same set: ${src.trim()}`, () => {
      const want = canon(src)
      const got = parts(solve(src))
      expect(got.length, `${src}`).toBe(want.length)
      got.forEach((g, i) => {
        for (const k of [0, 1] as const) {
          if (Number.isFinite(want[i][k])) expect(g[k]).toBeCloseTo(want[i][k], 10)
          else expect(g[k]).toBe(want[i][k])
        }
        expect([g[2], g[3]]).toEqual([want[i][2], want[i][3]])
      })
    })
  }

  it('already-solved input is restated, not re-derived', () => {
    expect(solve('x > 2').conclusion).toBe('x > 2 in interval notation is (2, ∞)')
    expect(solve('-1 <= x < 3').conclusion).toBe('−1 ≤ x < 3 in interval notation is [−1, 3)')
    expect(solve('[0, 5)').conclusion).toBe('The solution is [0, 5)')
    expect(solve('{1, 2, 3}').solution.text).toBe('{1, 2, 3}')
  })

  it('keeps the typed variable', () => {
    expect(solve('t < 3').variable).toBe('t')
    expect(solve('0 <= theta < pi').variable).toBe('θ')
    expect(solve('n^2 >= 4').solution.builder).toBe('n ≤ −2 or n ≥ 2')
  })
})

// ---------------------------------------------------------------------------
// Test points, notes, errors, speed
// ---------------------------------------------------------------------------

describe('working details', () => {
  it('test points are integers when there is one, else simple fractions', () => {
    const w = solve('x^2 - x - 1 < 0').clauses[0]
    expect(w.table.map((t) => t.tText)).toEqual(['−1', '0', '2'])
    const v = solve('(2x - 1)(3x - 2) > 0').clauses[0]
    // critical 1/2 and 2/3: a simple fraction between them
    expect(v.table.map((t) => t.tText)).toEqual(['0', '3/5', '1'])
    expect(v.factored?.text).toBe('(2x − 1)(3x − 2)')
  })

  it('every test row lies strictly inside its interval', () => {
    for (const src of ['x^3 >= 4x', 'x/(x^2 - 9) >= 0', 'sqrt(x+1) >= x - 1', 'sin(x) >= 1/2 {0 <= x <= 2pi}', 'log(x) < 2']) {
      for (const t of solve(src).clauses[0].table) {
        expect(t.t > t.lo && t.t < t.hi, `${src}: ${t.tText} in (${t.lo}, ${t.hi})`).toBe(true)
      }
    }
  })

  it('errors carry a message and, where it helps, a position', () => {
    expect(err('').error).toMatch(/Empty/)
    expect(err('x^2 > y').error).toMatch(/Two different letters/)
    expect(err('x < 3 > 1').error).toMatch(/direction/)
    expect(err('0 < 1').error).toMatch(/no variable/)
    const e = err('x^2 + > 4')
    expect(typeof e.error).toBe('string')
    expect(err('2x <').pos).toBe(4)
  })

  it('is fast for typical inputs', () => {
    const inputs = ['x^2 - 4 > 0', '(x-1)/(x+2) <= 0', '|2x - 3| < 5', 'sqrt(x+1) >= x - 1', 'e^x > 3', 'log(x) < 2', 'sin(x) >= 1/2 {0 <= x <= 2pi}']
    for (const s of inputs) solve(s) // warm up
    for (const s of inputs) {
      const t0 = performance.now()
      solve(s)
      expect(performance.now() - t0, s).toBeLessThan(20)
    }
  })

  it('a stretch where h = 0 has ends read from h itself: floor(x) = 2 → [2, 3)', () => {
    expectParts('floor(x) = 2', [[2, 3, true, false]])
  })

  it('an identity is every number in the universe, not rounding noise', () => {
    const r = expectParts('sin(x)^2 + cos(x)^2 = 1', [[0, 2 * Math.PI, true, false]])
    expect(r.clauses[0].critical.filter((c) => c.why === 'zero')).toHaveLength(0)
    expectParts('x = x', [[-INF, INF, false, false]])
  })

  it('multiplicities from the factored form: (x + 1)³(x − 2)²/(x − 5) ≤ 0 → [−1, 5)', () => {
    const r = expectParts('(x+1)^3 (x-2)^2 / (x-5) <= 0', [[-1, 5, true, false]])
    expect(r.clauses[0].critical.map((c) => [c.x, c.why, c.multiplicity ?? null])).toEqual([
      [-1, 'zero', 3], [2, 'zero', 2], [5, 'undefined', null],
    ])
    expect(r.clauses[0].factored?.text).toBe('(x + 1)³(x − 2)²/(x − 5)')
  })

  it('a custom window', () => {
    const r = solve('sin(x) > x/10', { window: [-5, 5] })
    expect(r.notes.some((n) => /−5 ≤ x ≤ 5/.test(n))).toBe(true)
  })
})

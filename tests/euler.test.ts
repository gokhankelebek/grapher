// ============================================================================
// tests/euler.test.ts — Euler's method, the core (src/core/euler.ts).
//
// Every expected value here was worked by hand, not read off the code:
//
//   dy/dx = x + y from (0, 1), h = 0.5:
//     k  x    y      slope = x + y   Δy = h·slope
//     0  0    1      1               0.5
//     1  0.5  1.5    2               1
//     2  1    2.5    3.5             1.75
//     3  1.5  4.25   5.75            2.875 = 23/8
//     4  2    7.125 = 57/8
//   and the true solution is y = 2eˣ − x − 1, so y(1) = 2e − 2 ≈ 3.4366.
//
// The verdicts are read off the concavity of the TRUE solution:
//   y' = y,  y(0) = 1   →  y = eˣ, concave up        →  underestimate, BOTH ways
//   y' = −y, y(0) = 1   →  y = e⁻ˣ, concave up       →  underestimate
//   y' = −y, y(0) = −1  →  y = −e⁻ˣ, concave down    →  overestimate
//   y' = x + y, y(0) = −1 → y = −x − 1, a line      →  exact
// Stepping left does NOT reverse the verdict: a convex curve lies above its
// tangent line on both sides of the point of tangency (see the file header of
// src/core/euler.ts); y' = y with h = −0.5 gives 0.5 < e^(−0.5) ≈ 0.607.
// ============================================================================

import { describe, expect, it } from 'vitest'
import {
  eulerNumber,
  eulerSteps,
  eulerVerdict,
  fieldRhs,
  secondDerivativeAt,
  secondDerivativeOf,
} from '../src/core/euler'

const xPlusY = (x: number, y: number): number => x + y
const yOf = (_x: number, y: number): number => y
const minusY = (_x: number, y: number): number => -y

describe('eulerSteps — the table', () => {
  it('dy/dx = x + y from (0, 1), h = 0.5, n = 2: y = 1, 1.5, 2.5 (by hand)', () => {
    const { rows, stopped } = eulerSteps(xPlusY, 0, 1, 0.5, 2)
    expect(stopped).toBeNull()
    expect(rows.map((r) => r.k)).toEqual([0, 1, 2])
    expect(rows.map((r) => r.x)).toEqual([0, 0.5, 1])
    expect(rows.map((r) => r.y)).toEqual([1, 1.5, 2.5])
    expect(rows.map((r) => r.slope)).toEqual([1, 2, 3.5])
    expect(rows.map((r) => r.dy)).toEqual([0.5, 1, 1.75])
  })

  it('four steps land on 57/8, and print as the fractions they are', () => {
    const { rows } = eulerSteps(xPlusY, 0, 1, 0.5, 4)
    expect(rows[4].y).toBe(57 / 8)
    expect(eulerNumber(rows[3].dy).text).toBe('23/8')
    expect(eulerNumber(rows[4].y).text).toBe('57/8')
    expect(eulerNumber(rows[3].y).text).toBe('4.25')
  })

  it('xₙ is x₀ + n·h, never an accumulated sum', () => {
    const { rows } = eulerSteps(xPlusY, 0, 1, 0.1, 30)
    expect(rows).toHaveLength(31)
    expect(eulerNumber(rows[30].x).text).toBe('3')
    expect(rows[30].x).toBeCloseTo(3, 14)
  })

  it('a negative step walks left', () => {
    const { rows } = eulerSteps(xPlusY, 0, 1, -0.5, 4)
    expect(rows.map((r) => r.x)).toEqual([0, -0.5, -1, -1.5, -2])
    // 1 → 0.5 → 0.5 → 0.75 → 1.125 (slopes 1, 0, −0.5, −0.75)
    expect(rows.map((r) => r.y)).toEqual([1, 0.5, 0.5, 0.75, 1.125])
  })

  it('stops early at an undefined slope, and says where', () => {
    // dy/dx = 1/x from (−1, 0): x₂ = 0 is the pole
    const { rows, stopped } = eulerSteps((x) => 1 / x, -1, 0, 0.5, 4)
    expect(rows).toHaveLength(3)
    expect(stopped?.k).toBe(2)
    expect(stopped?.reason).toMatch(/undefined at \(0, /)
    expect(Number.isNaN(rows[2].slope)).toBe(true)
  })

  it('a slope that is undefined only at the LAST point does not stop anything', () => {
    // from (−1, 0) with h = 0.5, n = 2 the last point is x = 0 — never stepped from
    const { rows, stopped } = eulerSteps((x) => 1 / x, -1, 0, 0.5, 2)
    expect(stopped).toBeNull()
    expect(rows).toHaveLength(3)
  })

  it('stops when the values overflow', () => {
    const { rows, stopped } = eulerSteps((_x, y) => y * y, 0, 1e200, 1, 5)
    expect(stopped).not.toBeNull()
    expect(rows.every((r) => Number.isFinite(r.y))).toBe(true)
  })

  it('refuses h = 0 and a non-finite start', () => {
    expect(eulerSteps(xPlusY, 0, 1, 0, 4).stopped?.reason).toMatch(/nonzero/)
    expect(eulerSteps(xPlusY, NaN, 1, 0.5, 4).rows).toHaveLength(0)
  })

  it('a closure that throws is an undefined slope, not a crash', () => {
    const boom = (): number => {
      throw new Error('x')
    }
    expect(eulerSteps(boom, 0, 1, 0.5, 3).stopped?.k).toBe(0)
  })
})

describe('eulerVerdict — over or under, from the concavity of the true solution', () => {
  it('dy/dx = x + y from (0, 1) to x = 1: concave up → underestimate, true y(1) = 2e − 2', () => {
    const v = eulerVerdict(xPlusY, 0, 1, 1, { yEuler: 2.5 })
    expect(v.kind).toBe('under')
    expect(v.concavity).toBe('up')
    expect(v.trueY!).toBeCloseTo(2 * Math.E - 2, 8)
    expect(v.agrees).toBe(true)
    expect(v.reason).toMatch(/concave up on \[0, 1\]/)
    expect(v.reason).toMatch(/lie below it/)
    expect(v.reason).toMatch(/underestimate/)
  })

  it('dy/dx = y: underestimate stepping right (e^0.5 vs 1.5)', () => {
    const e = eulerSteps(yOf, 0, 1, 0.5, 1).rows[1].y
    expect(e).toBe(1.5)
    const v = eulerVerdict(yOf, 0, 1, 0.5, { yEuler: e })
    expect(v.kind).toBe('under')
    expect(v.trueY!).toBeCloseTo(Math.exp(0.5), 8)
    expect(e).toBeLessThan(v.trueY!)
  })

  it('dy/dx = y: STILL an underestimate stepping left — tangent lines lie below a convex curve on both sides', () => {
    const rows = eulerSteps(yOf, 0, 1, -0.5, 2).rows
    expect(rows.map((r) => r.y)).toEqual([1, 0.5, 0.25])
    const v = eulerVerdict(yOf, 0, 1, -1, { yEuler: 0.25 })
    expect(v.kind).toBe('under')
    expect(v.trueY!).toBeCloseTo(Math.exp(-1), 8)
    expect(v.agrees).toBe(true)
    expect(v.reason).toMatch(/\[−1, 0\]/)
  })

  it('dy/dx = −y from (0, 1) stepping right: y = e⁻ˣ is concave up → underestimate', () => {
    const e = eulerSteps(minusY, 0, 1, 0.5, 4).rows[4].y
    expect(e).toBe(0.0625)
    const v = eulerVerdict(minusY, 0, 1, 2, { yEuler: e })
    expect(v.kind).toBe('under')
    expect(v.trueY!).toBeCloseTo(Math.exp(-2), 8)
    expect(v.agrees).toBe(true)
  })

  it('dy/dx = −y from (0, −1): y = −e⁻ˣ is concave down → overestimate, both directions', () => {
    const right = eulerVerdict(minusY, 0, -1, 1, { yEuler: eulerSteps(minusY, 0, -1, 0.5, 2).rows[2].y })
    expect(right.kind).toBe('over')
    expect(right.agrees).toBe(true)
    expect(right.reason).toMatch(/lie above it/)
    const left = eulerVerdict(minusY, 0, -1, -1, { yEuler: eulerSteps(minusY, 0, -1, -0.5, 2).rows[2].y })
    expect(left.kind).toBe('over')
    expect(left.agrees).toBe(true)
  })

  it('dy/dx = −x/y from (0, 2): the upper semicircle, concave down → overestimate', () => {
    const f = (x: number, y: number): number => -x / y
    const e = eulerSteps(f, 0, 2, 0.5, 2).rows[2].y
    const v = eulerVerdict(f, 0, 2, 1, { yEuler: e })
    expect(v.kind).toBe('over')
    expect(v.trueY!).toBeCloseTo(Math.sqrt(3), 7)
    expect(e).toBeGreaterThan(Math.sqrt(3))
  })

  it('a solution that is a line: Euler is exact', () => {
    // y' = x + y through (0, −1) is y = −x − 1, y'' ≡ 0
    const rows = eulerSteps(xPlusY, 0, -1, 0.5, 4).rows
    expect(rows.map((r) => r.y)).toEqual([-1, -1.5, -2, -2.5, -3])
    const v = eulerVerdict(xPlusY, 0, -1, 2, { yEuler: -3 })
    expect(v.kind).toBe('exact')
    expect(v.trueY!).toBeCloseTo(-3, 8)
  })

  it('a concavity that changes sign cannot tell — and says roughly where', () => {
    // y' = cos x: y'' = −sin x, negative on (0, π) and positive after it
    const v = eulerVerdict((x) => Math.cos(x), 0, 0, 4)
    expect(v.kind).toBe('unknown')
    expect(v.concavity).toBe('mixed')
    expect(v.changeNear!).toBeCloseTo(Math.PI, 1)
    expect(v.reason).toMatch(/cannot tell/)
  })

  it('a solution that blows up first has no true value', () => {
    // y' = y² through (0, 1) is 1/(1 − x): gone at x = 1
    const v = eulerVerdict((_x, y) => y * y, 0, 1, 2)
    expect(v.trueY).toBeNull()
    expect(v.kind).toBe('unknown')
    expect(v.reason).toMatch(/does not reach x = 2/)
  })

  it('flags an unstable step whose error has the other sign', () => {
    // y' = −10y, h = 0.3: 1 → −2 → 4, while y(0.6) = e⁻⁶ ≈ 0.0025 (concave up)
    const f = (_x: number, y: number): number => -10 * y
    const e = eulerSteps(f, 0, 1, 0.3, 2).rows[2].y
    expect(e).toBeCloseTo(4, 12)
    const v = eulerVerdict(f, 0, 1, 0.6, { yEuler: e })
    expect(v.kind).toBe('under')
    expect(v.agrees).toBe(false)
  })

  it('quotes the symbolic second derivative in the sentence when given one', () => {
    const d2 = secondDerivativeOf('dy/dx = x + y')
    const v = eulerVerdict(xPlusY, 0, 1, 1, { d2 })
    expect(v.reason).toContain('d²y/dx² = 1 + dy/dx = 1 + x + y > 0')
  })
})

describe('secondDerivativeAt — y″ = f_x + f_y·f by central differences', () => {
  it('matches the hand derivative', () => {
    // y' = xy: y'' = y + x·(xy); at (1, 2) that is 2 + 2 = 4
    expect(secondDerivativeAt((x, y) => x * y, 1, 2)).toBeCloseTo(4, 6)
    // y' = x + y: y'' = 1 + x + y; at (0.5, 1.5) that is 3
    expect(secondDerivativeAt(xPlusY, 0.5, 1.5)).toBeCloseTo(3, 6)
  })
})

describe('secondDerivativeOf — d²y/dx² in x, y and dy/dx, as the AP answer writes it', () => {
  const d = (src: string) => secondDerivativeOf(src)

  it('the textbook fields', () => {
    expect(d('dy/dx = x + y')).toMatchObject({ text: '1 + dy/dx', inXY: { text: '1 + x + y' } })
    expect(d('dy/dx = y')).toMatchObject({ text: 'dy/dx', inXY: { text: 'y' } })
    expect(d('dy/dx = -y')).toMatchObject({ text: '−dy/dx', inXY: { text: 'y' } })
    expect(d("y' = x*y")).toMatchObject({ text: 'y + x·dy/dx', inXY: { text: 'y + x²·y' } })
    expect(d('dy/dx = x^2')).toMatchObject({ text: '2x', inXY: null })
    expect(d('dy/dx = 2x - 3y + 1')!.text).toBe('2 − 3·dy/dx')
    expect(d('dy/dx = k*y')).toMatchObject({ text: 'k·dy/dx', inXY: { text: 'k²·y' } })
    expect(d('dy/dx = sin(x) + y')!.text).toBe('cos(x) + dy/dx')
    expect(d('dy/dx = x/y')!.text).toBe('(y − x·dy/dx)/y²')
  })

  it('KaTeX for the card', () => {
    expect(d('dy/dx = x + y')!.tex).toBe('1 + \\frac{dy}{dx}')
  })

  it('null where it has no rule, so the sentence falls back to the sign alone', () => {
    expect(d('dy/dx = abs(x)')).toBeNull()
    expect(d('dy/dx = floor(y)')).toBeNull()
    expect(d('nonsense')).toBeNull()
  })

  it('reads the right side the way the field parser splits it', () => {
    expect(fieldRhs('dy/dx = x - y')).toBe(' x - y')
    expect(fieldRhs('dy/dx: x')).toBe(' x')
    expect(fieldRhs('dy/dx')).toBeNull()
  })
})

describe('eulerNumber — exact where exact, decimal otherwise', () => {
  it('prints short fractions as decimals and the rest as fractions', () => {
    const t = (v: number): string => eulerNumber(v).text
    expect(t(2.5)).toBe('2.5')
    expect(t(3.75)).toBe('3.75')
    expect(t(17 / 8)).toBe('17/8')
    expect(t(1 / 3)).toBe('1/3')
    expect(t(-0.125)).toBe('−1/8')
    expect(t(3)).toBe('3')
    expect(t(0)).toBe('0')
    expect(t(1e-14)).toBe('0')
  })

  it('closed forms beyond fractions, at a tight tolerance', () => {
    expect(eulerNumber(Math.PI / 4).text).toBe('π/4')
    expect(eulerNumber(Math.E).text).toBe('2.7183')
    expect(eulerNumber(Math.E).exact).toBe(false)
    expect(eulerNumber(17 / 8).decimal).toBe('2.125')
  })

  it('an undefined value is a dash', () => {
    expect(eulerNumber(NaN).text).toBe('—')
  })
})

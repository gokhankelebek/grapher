// ============================================================================
// tests/inverse.test.ts — f⁻¹ as an equation (src/core/inverse.ts).
// ============================================================================

import { describe, it, expect } from 'vitest'
import { invertFormula } from '../src/core/inverse'
import type { InverseFormula } from '../src/core/inverse'
import type { IntervalPart } from '../src/core/domainRange'
import { compileExpr, parseExpression } from '../src/core/parse'

const PI = Math.PI

const R = (lo: number, hi: number, loClosed = true, hiClosed = true): IntervalPart => ({
  lo, hi,
  loClosed: loClosed && Number.isFinite(lo),
  hiClosed: hiClosed && Number.isFinite(hi),
  loExact: null, hiExact: null,
})

const inv = (src: string, r: IntervalPart | null = null, name = 'f'): InverseFormula => {
  const out = invertFormula(src, r, name)
  if (!out) throw new Error(`expected an inverse for ${src}`)
  return out
}

/** Evaluate a "y = …" source line at x. */
function evalSource(source: string, x: number): number {
  const body = source.replace(/^\s*y\s*=\s*/, '')
  const c = compileExpr(body)
  if (!c.ok) throw new Error(c.error)
  return c.expr.ev([], x, Number.NaN)
}

/** Every returned line reads back through the app's own parser, and is tidy. */
function expectTidy(f: InverseFormula): void {
  const parsed = parseExpression(f.source)
  expect(parsed.ok, f.source).toBe(true)
  for (const s of [f.source, f.text, f.latex]) {
    expect(s, s).not.toMatch(/\+\s*-|\+\s*−/) // no "+ -"
    expect(s, s).not.toMatch(/(^|[^0-9.])1\s*\*/) // no "1*x"
    expect(s, s).not.toMatch(/\*\s*1(?![0-9.])/) // no "x*1"
    expect(s, s).not.toMatch(/--|−−|- -|− −/)
    expect(s, s).not.toMatch(/\(\(x\)\)|\(x\)\^/) // no redundant brackets round x
  }
  expect(f.text).not.toMatch(/-/) // true minus signs only
}

describe('invertFormula — one occurrence of x', () => {
  it('y = 2x + 3 → (x − 3)/2', () => {
    const f = inv('y = 2x + 3')
    expect(f.source).toBe('y = (x - 3)/2')
    expect(f.text).toBe('f⁻¹(x) = (x − 3)/2')
    expect(f.latex).toBe('f^{-1}(x) = \\frac{x-3}{2}')
    expect(f.branch).toBeNull()
    expectTidy(f)
  })

  it('y = (x − 1)³ + 2 → ∛(x − 2) + 1', () => {
    const f = inv('y = (x - 1)^3 + 2')
    expect(f.source).toBe('y = cbrt(x - 2) + 1')
    expect(f.text).toBe('f⁻¹(x) = ∛(x − 2) + 1')
    expect(evalSource(f.source, -6)).toBeCloseTo(-1, 12) // the cube root of a negative
    expectTidy(f)
  })

  it('y = √(x − 2) → x² + 2 (the formula alone; its domain is the UI’s business)', () => {
    const f = inv('y = sqrt(x - 2)')
    expect(f.source).toBe('y = x^2 + 2')
    expect(f.text).toBe('f⁻¹(x) = x² + 2')
    expect(f.latex).toBe('f^{-1}(x) = x^{2}+2')
    expectTidy(f)
  })

  it('y = x² needs a branch: √x on [0, ∞), −√x on (−∞, 0], null without one', () => {
    const p = inv('y = x^2', R(0, Infinity))
    expect(p.source).toBe('y = sqrt(x)')
    expect(p.text).toBe('f⁻¹(x) = √x')
    expect(p.branch).toBe('the branch x ≥ 0')
    const n = inv('y = x^2', R(-Infinity, 0))
    expect(n.source).toBe('y = -sqrt(x)')
    expect(n.text).toBe('f⁻¹(x) = −√x')
    expect(n.branch).toBe('the branch x ≤ 0')
    expect(invertFormula('y = x^2', null)).toBeNull()
    expect(invertFormula('y = x^2', R(-1, 2))).toBeNull() // straddles the vertex
    expectTidy(p)
    expectTidy(n)
  })

  it('y = (x − 1)² + 2 on x ≥ 1 → √(x − 2) + 1', () => {
    const f = inv('y = (x - 1)^2 + 2', R(1, Infinity))
    expect(f.source).toBe('y = sqrt(x - 2) + 1')
    expect(f.text).toBe('f⁻¹(x) = √(x − 2) + 1')
    expect(f.latex).toBe('f^{-1}(x) = \\sqrt{x-2}+1')
    expect(f.branch).toBe('the branch x ≥ 1')
    expectTidy(f)
  })

  it('exponentials and logarithms trade places', () => {
    expect(inv('y = e^x').source).toBe('y = ln(x)')
    const two = inv('y = 2^(x-1)')
    expect(two.source).toBe('y = log_2(x) + 1')
    expect(two.text).toBe('f⁻¹(x) = log₂(x) + 1')
    expect(inv('y = ln(x - 1)').source).toBe('y = e^x + 1')
    expect(inv('y = ln(x - 1)').text).toBe('f⁻¹(x) = eˣ + 1')
    const three = inv('y = log_3(x)')
    expect(three.source).toBe('y = 3^x')
    expect(three.text).toBe('f⁻¹(x) = 3ˣ')
    expect(inv('y = 10^x').source).toBe('y = log(x)')
    expect(inv('y = log(x)').source).toBe('y = 10^x')
    expect(inv('y = e^(2x) + 1').source).toBe('y = ln(x - 1)/2')
    expect(inv('y = 4 - 2^x').source).toBe('y = log_2(4 - x)')
    for (const s of ['y = e^x', 'y = 2^(x-1)', 'y = ln(x - 1)', 'y = log_3(x)']) expectTidy(inv(s))
  })

  it('y = 1/x is its own inverse', () => {
    const f = inv('y = 1/x')
    expect(f.source).toBe('y = 1/x')
    expectTidy(f)
  })

  it('trig on a branch: the principal inverse, or its shift/reflection', () => {
    const s = inv('y = sin(x)', R(-PI / 2, PI / 2))
    expect(s.source).toBe('y = asin(x)')
    expect(s.text).toBe('f⁻¹(x) = arcsin(x)')
    expect(s.branch).toBe('principal branch')
    const s2 = inv('y = sin(x)', R(PI / 2, (3 * PI) / 2))
    expect(s2.source).toBe('y = pi - asin(x)')
    expect(s2.text).toBe('f⁻¹(x) = π − arcsin(x)')
    expect(s2.branch).toBe('the branch π/2 ≤ x ≤ 3π/2')
    const c = inv('y = cos(x)', R(0, PI))
    expect(c.source).toBe('y = acos(x)')
    expect(c.text).toBe('f⁻¹(x) = arccos(x)')
    expect(inv('y = cos(x)', R(PI, 2 * PI)).source).toBe('y = 2pi - acos(x)')
    const t = inv('y = tan(x)', R(-PI / 2, PI / 2, false, false))
    expect(t.source).toBe('y = atan(x)')
    expect(invertFormula('y = sin(x)', null)).toBeNull()
    expect(invertFormula('y = sin(x)', R(0, PI))).toBeNull() // not one branch
    for (const f of [s, s2, c, t]) expectTidy(f)
  })

  it('y = 3sin(2x) + 1 on [−π/4, π/4] → arcsin((x − 1)/3)/2', () => {
    const f = inv('y = 3sin(2x) + 1', R(-PI / 4, PI / 4))
    expect(f.source).toBe('y = asin((x - 1)/3)/2')
    expect(f.text).toBe('f⁻¹(x) = arcsin((x − 1)/3)/2')
    expect(f.branch).toBe('principal branch')
    expectTidy(f)
  })

  it('y = |x − 2| on x ≥ 2 → x + 2', () => {
    const f = inv('y = |x - 2|', R(2, Infinity))
    expect(f.source).toBe('y = x + 2')
    expect(f.branch).toBe('the branch x ≥ 2')
    expect(invertFormula('y = |x - 2|', null)).toBeNull()
    expectTidy(f)
  })

  it('linear forms come out in the tidy form a textbook prints', () => {
    expect(inv('y = 0.5x - 1.5').source).toBe('y = 2x + 3')
    expect(inv('y = 5 - x').source).toBe('y = 5 - x')
    expect(inv('f(x) = x/2 + 1').source).toBe('y = 2(x - 1)')
    expect(inv('y = pi x').source).toBe('y = x/pi')
    expect(inv('y = 3/(x+1) - 2').source).toBe('y = 3/(x + 2) - 1')
  })

  it('odd powers, hyperbolic functions', () => {
    expect(inv('y = x^3').source).toBe('y = cbrt(x)')
    expect(inv('y = sinh(x)').source).toBe('y = ln(x + sqrt(x^2 + 1))')
    expect(inv('y = cosh(x)', R(0, Infinity)).source).toBe('y = ln(x + sqrt(x^2 - 1))')
    expect(invertFormula('y = cosh(x)', null)).toBeNull()
  })
})

describe('invertFormula — x more than once', () => {
  it('a quadratic completes the square on the restriction’s side of the vertex', () => {
    const f = inv('y = x^2 - 2x + 3', R(1, Infinity))
    expect(f.source).toBe('y = sqrt(x - 2) + 1') // the same line as (x − 1)² + 2
    expect(f.text).toBe('f⁻¹(x) = √(x − 2) + 1')
    expect(f.branch).toBe('the branch x ≥ 1')
    const g = inv('y = x^2 - 2x + 3', R(-Infinity, 1))
    expect(g.source).toBe('y = 1 - sqrt(x - 2)')
    expect(inv('y = x^2 + 4x', R(-2, Infinity)).source).toBe('y = sqrt(x + 4) - 2')
    expect(inv('y = 2x^2', R(0, Infinity)).source).toBe('y = sqrt(x/2)')
    expect(inv('y = -x^2 + 3', R(0, Infinity)).source).toBe('y = sqrt(3 - x)')
    expect(invertFormula('y = x^2 - 2x + 3', null)).toBeNull()
    expectTidy(f)
    expectTidy(g)
  })

  it('a linear-fractional (ax + b)/(cx + d) → (dx − b)/(−cx + a), tidied', () => {
    const f = inv('y = (2x+1)/(x-3)')
    expect(f.source).toBe('y = (3x + 1)/(x - 2)')
    expect(f.text).toBe('f⁻¹(x) = (3x + 1)/(x − 2)')
    expect(f.latex).toBe('f^{-1}(x) = \\frac{3x+1}{x-2}')
    expect(inv('y = (x + 1)/(2x - 3)').source).toBe('y = (3x + 1)/(2x - 1)')
    expectTidy(f)
  })

  it('anything else is null', () => {
    expect(invertFormula('y = x + e^x', null)).toBeNull()
    expect(invertFormula('y = x sin(x)', null)).toBeNull()
    expect(invertFormula('y = {x if x < 0; 2x if x >= 0}', null)).toBeNull()
    expect(invertFormula('y = a x + b', null)).toBeNull() // sliders: nothing to verify
    expect(invertFormula('y = 3', null)).toBeNull()
    expect(invertFormula('x^2 + y^2 = 4', null)).toBeNull()
    expect(invertFormula('', null)).toBeNull()
    expect(invertFormula('y = sqrt(', null)).toBeNull()
  })
})

describe('invertFormula — heads, restrictions and verification', () => {
  it('names the head after the curve', () => {
    const g = inv('g(x) = 2x + 3', null, 'g')
    expect(g.text).toBe('g⁻¹(x) = (x − 3)/2')
    expect(g.latex).toBe('g^{-1}(x) = \\frac{x-3}{2}')
    expect(g.source).toBe('y = (x - 3)/2')
  })

  it('reads a restriction typed into the line when none is passed', () => {
    const f = inv('y = x^2 {x >= 0}')
    expect(f.source).toBe('y = sqrt(x)')
  })

  it('takes the restricted line itself and strips the clause', () => {
    expect(inv('y = x^2 {x >= 0}').source).toBe('y = sqrt(x)')
    expect(inv('y = x^2, x <= 0').source).toBe('y = -sqrt(x)')
    expect(inv('y = (x - 1)^2 + 2 {x >= 1}').source).toBe('y = sqrt(x - 2) + 1')
    expect(inv('f(x) = x^2 - 2x + 3 {x >= 1}').text).toBe('f⁻¹(x) = √(x − 2) + 1')
    expect(inv('y = sin(x) {-pi/2 <= x <= pi/2}').source).toBe('y = asin(x)')
    // a restriction passed in wins over the one typed into the line
    expect(inv('y = x^2 {x >= 0}', R(-Infinity, 0)).source).toBe('y = -sqrt(x)')
    // a restriction that is not one interval: no branch to pick
    expect(invertFormula('y = x^2 {x != 0}', null)).toBeNull()
  })

  it('fitted constants: one rounded decimal each, verified at full precision', () => {
    const q = inv('y = 0.4963880332(x + 0.9722994963)^2 + 0.2', R(-0.9722994963, Infinity))
    expect(q.source).toBe('y = sqrt((x - 0.2)/0.4964) - 0.9723')
    expect(q.text).toBe('f⁻¹(x) = √((x − 0.2)/0.4964) − 0.9723')
    expect(q.latex).toBe('f^{-1}(x) = \\sqrt{\\frac{x-0.2}{0.4964}}-0.9723')
    const e = inv('y = 0.4963880332x^2 + 0.9652x + 0.4692', R(-0.9722, Infinity))
    expect(e.source).not.toMatch(/\d{5,}/) // no long decimals
    expect(e.source).not.toMatch(/\d\/\(?\d/) // no constant over constant
    expect(inv('y = 1.2345678x - 0.87654321').source).toBe('y = (x + 0.8765)/1.235')
    expect(inv('y = 1.5e^(0.7x) - 2').source).toBe('y = ln((x + 2)/1.5)/0.7')
    expect(inv('y = 2.3ln(x + 1.1) + 0.4').source).toBe('y = e^((x - 0.4)/2.3) - 1.1')
    const s = inv('y = 2.1sqrt(x - 1.5) + 0.5')
    expect(s.source).toBe('y = ((x - 0.5)/2.1)^2 + 1.5')
    expect(s.latex).toBe('f^{-1}(x) = \\left(\\frac{x-0.5}{2.1}\\right)^{2}+1.5')
    for (const f of [q, e, s]) expectTidy(f)
  })

  it('a sketched family’s equation text works too', () => {
    expect(inv('y = 2sqrt(x - 1.5) + 0.5').source).toBe('y = ((x - 0.5)/2)^2 + 1.5')
  })

  it('every inverse really undoes f on the restriction', () => {
    const cases: [string, IntervalPart | null][] = [
      ['y = 2x + 3', null],
      ['y = (x - 1)^3 + 2', null],
      ['y = sqrt(x - 2)', null],
      ['y = x^2 - 2x + 3', R(1, Infinity)],
      ['y = 2^(x-1)', null],
      ['y = (2x+1)/(x-3)', null],
      ['y = sin(x)', R(PI / 2, (3 * PI) / 2)],
      ['y = 3sin(2x) + 1', R(-PI / 4, PI / 4)],
      ['y = cos(x)', R(PI, 2 * PI)],
    ]
    for (const [src, r] of cases) {
      const f = inv(src, r)
      const body = src.replace(/^\s*y\s*=\s*/, '')
      const c = compileExpr(body)
      if (!c.ok) throw new Error(c.error)
      const lo = r ? r.lo : -3, hi = r ? r.hi : 3
      for (let i = 1; i < 10; i++) {
        const x = Number.isFinite(hi) && Number.isFinite(lo) ? lo + ((hi - lo) * i) / 10 : lo + i
        const y = c.expr.ev([], x, Number.NaN)
        if (!Number.isFinite(y)) continue
        expect(evalSource(f.source, y), `${src} at ${x}`).toBeCloseTo(x, 7)
      }
    }
  })
})

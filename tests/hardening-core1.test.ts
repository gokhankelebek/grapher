// ============================================================================
// tests/hardening-core1.test.ts — regressions for the core fixes of the
// hardening pass: negative fractional powers, overflow and underflow in the
// domain / range / limit readers, x^x, floor(x)/x's one-to-one stretches,
// exact forms of large numbers, a point defined by its own piece, the MVT at
// holes, x·sin(1/x), piecewise MVT stretches and the Euler table's numbers.
//
// Every expected value is worked out by hand in the comment beside it.
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { CURVE_COLORS } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { parseExpression } from '../src/core/parse'
import { curveDomain, curveRange, naturalDomain, oneToOneInfo } from '../src/core/domainRange'
import type { RealSet } from '../src/core/domainRange'
import { exactForm } from '../src/core/exact'
import { limitAt, limitSourceOf, limitTable } from '../src/core/limits'
import type { LimitSource } from '../src/core/limits'
import { averageValue, differentiabilityOn, mvtPoints, mvtSourceOf, secantOf } from '../src/core/mvt'
import type { MvtSource } from '../src/core/mvt'
import { eulerNumber } from '../src/core/euler'

let seq = 0
function typed(src: string): { curve: FittedCurve; models: Record<string, ModelSpec>; spec: ModelSpec } {
  const r = parseExpression(src)
  if (!r.ok) throw new Error(`expected "${src}" to parse: ${r.error}`)
  const id = `hc1_${++seq}`
  const spec = r.plot.makeModel(id)
  const curve: FittedCurve = {
    id: `c${seq}`,
    modelId: id,
    params: r.plot.defaultParams.slice(),
    kind: r.plot.kind,
    domain: r.plot.domain,
    color: CURVE_COLORS[0],
    strokeWidth: 2.5,
    visible: true,
    error: 0,
  }
  return { curve, models: { ...MODELS, [id]: spec }, spec }
}

const dom = (src: string): RealSet => {
  const t = typed(src)
  const d = curveDomain(t.curve, t.models)
  if (!d) throw new Error('no domain')
  return d
}
const rng = (src: string): RealSet => {
  const t = typed(src)
  const r = curveRange(t.curve, t.models)
  if (!r) throw new Error('no range')
  return r
}
const one = (src: string) => {
  const t = typed(src)
  const o = oneToOneInfo(t.curve, t.models)
  if (!o) throw new Error('no one-to-one info')
  return o
}
const lsrc = (src: string): LimitSource => {
  const t = typed(src)
  const s = limitSourceOf(t.curve, t.models)
  if (!s) throw new Error('no limit source')
  return s
}
const msrc = (src: string): MvtSource => {
  const t = typed(src)
  const s = mvtSourceOf(t.curve, t.models)
  if (!s) throw new Error('no mvt source')
  return s
}

// ---------------------------------------------------------------------------
// 1. x^(−p/q) has a pole
// ---------------------------------------------------------------------------

describe('1. a negative fractional power makes its base a denominator', () => {
  it('x^(−2/3) = 1/∛(x²): domain x ≠ 0, range (0, ∞)', () => {
    // ∛(x²) > 0 for x ≠ 0 and = 0 at 0, so 1/∛(x²) is positive, undefined
    // at 0, → ∞ at 0 and → 0 at ±∞: every positive value, nothing else.
    const d = dom('y = x^(-2/3)')
    expect(d.text).toBe('(−∞, 0) ∪ (0, ∞)')
    expect(d.builder).toBe('x ≠ 0')
    expect(rng('y = x^(-2/3)').text).toBe('(0, ∞)')
    const t = typed('y = x^(-2/3)')
    expect(t.spec.singularities!(t.curve.params, [-5, 5])).toEqual([0])
  })

  it('x^(−1/3) = 1/∛x: range y ≠ 0', () => {
    // 1/∛x is odd, runs from 0⁻ down to −∞ on x < 0 and from +∞ down to 0⁺
    // on x > 0: every value but 0.
    const r = rng('y = x^(-1/3)')
    expect(r.text).toBe('(−∞, 0) ∪ (0, ∞)')
    expect(r.builder).toBe('y ≠ 0')
    expect(dom('y = x^(-1/3)').builder).toBe('x ≠ 0')
    // strictly decreasing on each side, the sides' values disjoint
    expect(one('y = x^(-1/3)').oneToOne).toBe(true)
  })

  it('3x^(−2/3) and (x − 1)^(−2/3)', () => {
    // a factor 3 changes no sign; the shift moves the pole to x = 1
    expect(dom('y = 3x^(-2/3)').builder).toBe('x ≠ 0')
    expect(rng('y = 3x^(-2/3)').text).toBe('(0, ∞)')
    expect(dom('y = (x-1)^(-2/3)').builder).toBe('x ≠ 1')
    expect(rng('y = (x-1)^(-2/3)').text).toBe('(0, ∞)')
  })

  it('a lone ±∞ between two values is a pole even when no singularity names it', () => {
    // A hand-made (untyped) model: 1/∛(x²) with the pole written as ∞.
    const spec: ModelSpec = {
      id: 'pole_only',
      name: 'pole',
      kind: 'explicit',
      paramNames: [],
      evalExplicit: (_p: number[], x: number) => (x === 0 ? Infinity : Math.pow(x * x, -1 / 3)),
    } as unknown as ModelSpec
    const curve: FittedCurve = {
      id: 'p', modelId: 'pole_only', params: [], kind: 'explicit', domain: null,
      color: CURVE_COLORS[0], strokeWidth: 2.5, visible: true, error: 0,
    }
    expect(curveDomain(curve, { pole_only: spec })!.text).toBe('(−∞, 0) ∪ (0, ∞)')
  })
})

// ---------------------------------------------------------------------------
// 2. Overflow and underflow are neither domain ends nor attained values
// ---------------------------------------------------------------------------

describe('2. overflow and underflow', () => {
  it('e^(1/x): range (0, 1) ∪ (1, ∞), one-to-one', () => {
    // x < 0: 1/x runs over (−∞, 0), e^(1/x) over (0, 1).
    // x > 0: 1/x runs over (0, ∞), e^(1/x) over (1, ∞). 1 itself would need
    // 1/x = 0: never. Decreasing on both sides, the value sets disjoint.
    expect(rng('y = e^(1/x)').text).toBe('(0, 1) ∪ (1, ∞)')
    expect(one('y = e^(1/x)').oneToOne).toBe(true)
  })

  it('e^(1/x) {x > 0}: domain (0, ∞), range (1, ∞) — never "Infinity]"', () => {
    const d = dom('y = e^(1/x) {x > 0}')
    expect(d.text).toBe('(0, ∞)')
    const r = rng('y = e^(1/x) {x > 0}')
    expect(r.text).toBe('(1, ∞)')
    expect(r.text).not.toContain('Infinity')
    expect(one('y = e^(1/x) {x > 0}').oneToOne).toBe(true)
  })

  it('e^(1/x) {x >= 0.01}: range (1, e¹⁰⁰]', () => {
    // decreasing on [0.01, ∞): the top is f(0.01) = e^(1/0.01) = e¹⁰⁰,
    // attained; the bottom is the limit 1 at ∞, not attained.
    const r = rng('y = e^(1/x) {x >= 0.01}')
    expect(r.parts).toHaveLength(1)
    const p = r.parts[0]
    expect(p.lo).toBe(1)
    expect(p.loClosed).toBe(false)
    expect(p.hi / Math.exp(100)).toBeCloseTo(1, 9)
    expect(p.hiClosed).toBe(true)
  })

  it('e^(1/(x − 1)) and 2^(1/x) have the same shape', () => {
    // the shift moves the gap in the domain, not the values; base 2 > 1
    // keeps 2^(1/x) on (0, 1) for x < 0 and (1, ∞) for x > 0
    expect(rng('y = e^(1/(x-1))').text).toBe('(0, 1) ∪ (1, ∞)')
    expect(rng('y = 2^(1/x)').text).toBe('(0, 1) ∪ (1, ∞)')
    expect(one('y = 2^(1/x)').oneToOne).toBe(true)
  })

  it('e^(−1/x²): range (0, 1), not [0, 1)', () => {
    // −1/x² < 0, so 0 < e^(−1/x²) < 1; → 0 at 0 (excluded), → 1 at ±∞.
    // The doubles hold e^(−900) (x = 1/30) as 0: that is not a value f takes.
    expect(rng('y = e^(-1/x^2)').text).toBe('(0, 1)')
  })

  it('a ratio of exponentials overflowing into NaN far out is still defined there', () => {
    // e^x/(e^x + 1) = 1/(1 + e^(−x)) is defined on ℝ, strictly increasing
    // from 0 to 1; in doubles it is ∞/∞ = NaN past x ≈ 709.78.
    expect(dom('y = e^x/(e^x+1)').text).toBe('(−∞, ∞)')
    expect(rng('y = e^x/(e^x+1)').text).toBe('(0, 1)')
    expect(one('y = e^x/(e^x+1)').oneToOne).toBe(true)
    // (3eˣ + 2)/(eˣ − 5): undefined only at eˣ = 5, x = ln 5; → −2/5 at −∞,
    // → 3 at +∞ (from above), ±∞ at ln 5.
    const d = dom('y = (3e^x+2)/(e^x-5)')
    expect(d.parts).toHaveLength(2)
    expect(d.parts[0].hi).toBeCloseTo(Math.log(5), 12)
    expect(d.parts[1].hi).toBe(Infinity)
    expect(rng('y = (3e^x+2)/(e^x-5)').text).toBe('(−∞, −2/5) ∪ (3, ∞)')
    // (eˣ + 1)/eˣ = 1 + e^(−x): on ℝ, values (1, ∞)
    expect(dom('y = (e^x+1)/e^x').text).toBe('(−∞, ∞)')
    expect(rng('y = (e^x+1)/e^x').text).toBe('(1, ∞)')
  })

  it('a real domain end far out is still an end', () => {
    // √(1000 − x): x ≤ 1000, closed; ln(1000 − x): x < 1000, open
    expect(dom('y = sqrt(1000-x)').text).toBe('(−∞, 1000]')
    expect(dom('y = ln(1000-x)').text).toBe('(−∞, 1000)')
    // ln(x² − 1): the edges at ±1 are open (ln 0 is −∞), exactly at ±1
    expect(dom('y = ln(x^2-1)').text).toBe('(−∞, −1) ∪ (1, ∞)')
  })
})

// ---------------------------------------------------------------------------
// 3. x^x
// ---------------------------------------------------------------------------

describe('3. x^x', () => {
  it('domain (0, ∞): no empty "(a, a)" parts, no "−3.333e-10"', () => {
    // Textbook: x^x = e^(x ln x) needs x > 0; 0⁰ is undefined. The scattered
    // negative rationals with odd denominators the evaluator can raise are
    // not an interval, and are not listed (see the domainRange header).
    const d = dom('y = x^x')
    expect(d.text).toBe('(0, ∞)')
    const t = typed('y = x^x')
    expect(naturalDomain(t.curve, t.models)!.text).toBe('(0, ∞)')
  })

  it('range [e^(−1/e), ∞), not one-to-one', () => {
    // (x^x)′ = x^x (ln x + 1) = 0 at x = 1/e: the minimum (1/e)^(1/e) =
    // e^(−1/e) ≈ 0.692201. → 1 as x → 0⁺ and → ∞ as x → ∞.
    const r = rng('y = x^x')
    expect(r.parts).toHaveLength(1)
    expect(r.parts[0].lo).toBeCloseTo(Math.exp(-1 / Math.E), 9)
    expect(r.parts[0].loClosed).toBe(true)
    expect(r.parts[0].hi).toBe(Infinity)
    const o = one('y = x^x')
    expect(o.oneToOne).toBe(false)
    // falls on (0, 1/e], rises on [1/e, ∞)
    expect(o.monotone).toHaveLength(2)
    for (const p of o.monotone) {
      expect(Math.min(Math.abs(p.lo - 1 / Math.E), Math.abs(p.hi - 1 / Math.E))).toBeLessThan(1e-7)
    }
  })

  it('an honest isolated point stays: √(−x²) is defined at 0 alone', () => {
    expect(dom('y = sqrt(-x^2)').text).toBe('{0}')
  })
})

// ---------------------------------------------------------------------------
// 4. floor(x)/x
// ---------------------------------------------------------------------------

describe('4. floor(x)/x: one-to-one stretches', () => {
  it('no unbounded stretch, and the list is capped', () => {
    // On [n, n + 1) (n ≠ 0) f = n/x is monotone; on [0, 1) it is 0. Every
    // monotone stretch is one tread, bounded — none reaches ±∞ (far out the
    // treads keep sawing between 1 and n/(n + 1)).
    const o = one('y = floor(x)/x')
    expect(o.oneToOne).toBe(false)
    expect(o.monotone.length).toBeGreaterThan(0)
    expect(o.monotone.length).toBeLessThanOrEqual(24)
    for (const p of o.monotone) {
      expect(Number.isFinite(p.lo)).toBe(true)
      expect(Number.isFinite(p.hi)).toBe(true)
    }
    // x ∈ [n, n+1), n ≥ 1: n/x ∈ (n/(n+1), 1] → (1/2, 1] at n = 1;
    // x ∈ [−1, 0): −1/x ∈ [1, ∞); 0 on [0, 1)
    expect(rng('y = floor(x)/x').text).toBe('{0} ∪ (1/2, ∞)')
  })
})

// ---------------------------------------------------------------------------
// 5. exactForm and large numbers
// ---------------------------------------------------------------------------

describe('5. exactForm does not invent forms for large numbers', () => {
  it('e²⁰ and 7.3¹⁰ are no fractions', () => {
    expect(exactForm(Math.exp(20))).toBeNull() // not 8247808322/17
    expect(exactForm(Math.pow(7.3, 10))).toBeNull() // not 14182165238/33
  })

  it('10¹⁵ computed with rounding is not 1000000000000003', () => {
    expect(exactForm(1e15 * (1 + 3e-15))).toBeNull()
    expect(exactForm(1000000000000003)).toBeNull()
  })

  it('exact integers that a double holds are still integers; small forms unchanged', () => {
    expect(exactForm(2 ** 20)!.text).toBe('1048576')
    expect(exactForm(1.5)!.text).toBe('3/2')
    expect(exactForm(Math.sqrt(3))!.text).toBe('√3')
    expect(exactForm(Math.PI / 2)!.text).toBe('π/2')
  })
})

// ---------------------------------------------------------------------------
// 6. Limits at ±∞ of ratios of exponentials
// ---------------------------------------------------------------------------

describe('6. limits at ±∞ read past overflow', () => {
  const at = (src: string, a: number) => limitAt(lsrc(src), a).two

  it('eˣ/(eˣ + 1) → 1, (3eˣ + 2)/(eˣ − 5) → 3, (eˣ + 1)/eˣ → 1, 2ˣ/(2ˣ + 1) → 1', () => {
    // divide top and bottom by eˣ (2ˣ): 1/(1 + e^(−x)) → 1;
    // (3 + 2e^(−x))/(1 − 5e^(−x)) → 3; 1 + e^(−x) → 1; 1/(1 + 2^(−x)) → 1
    for (const [src, L] of [
      ['y = e^x/(e^x+1)', 1],
      ['y = (3e^x+2)/(e^x-5)', 3],
      ['y = (e^x+1)/e^x', 1],
      ['y = 2^x/(2^x+1)', 1],
    ] as const) {
      const o = at(src, Infinity)
      expect(o.value, src).toBe(L)
      expect(o.exact?.text, src).toBe(String(L))
    }
    // and at −∞: eˣ → 0, so eˣ/(eˣ + 1) → 0 and (3eˣ + 2)/(eˣ − 5) → −2/5
    expect(at('y = e^x/(e^x+1)', -Infinity).value).toBe(0)
    expect(at('y = (3e^x+2)/(e^x-5)', -Infinity).exact?.text).toBe('−2/5')
  })

  it('a formula that really stops still has no limit at ∞', () => {
    // √(1000 − x) is undefined for x > 1000
    const o = at('y = sqrt(1000-x)', Infinity)
    expect(o.value).toBe('DNE')
    expect(o.why).toBe('undefined')
  })

  it('the table toward ∞ stops before a row the doubles overflow on', () => {
    // e^1000 ≈ 2·10⁴³⁴ is not ∞: the column ends at x = 100 (e¹⁰⁰ ≈ 2.69·10⁴³)
    const t = limitTable(lsrc('y = e^x'), Infinity)
    expect(t.right!.map((r) => r.xText)).toEqual(['10', '100'])
    expect(t.right!.every((r) => r.yText !== '∞')).toBe(true)
    // e^x/(e^x+1) at 1000 is not "undefined"
    const u = limitTable(lsrc('y = e^x/(e^x+1)'), Infinity)
    expect(u.right!.every((r) => r.yText !== 'undefined')).toBe(true)
    // a real −∞ / undefined keeps its rows: ln(1000 − x) at 1000 is −∞
    const l = limitTable(lsrc('y = ln(1000-x)'), Infinity)
    expect(l.right!.map((r) => r.yText).slice(2)).toEqual(['−∞', 'undefined', 'undefined'])
  })
})

// ---------------------------------------------------------------------------
// 7. A point defined by its own piece
// ---------------------------------------------------------------------------

describe('7. f(a) from a piece of its own', () => {
  it('{x², x ≠ 2; 5, x = 2} at 2: f(2) = 5, the limit 4, a removable discontinuity', () => {
    // lim x→2 x² = 4 from both sides; f(2) = 5 by the second piece.
    // (1) f(2) defined ✓  (2) the limit exists ✓  (3) 4 ≠ 5 ✗
    const r = limitAt(lsrc('y = {x^2, x != 2; 5, x = 2}'), 2)
    expect(r.fa?.value).toBe(5)
    expect(r.two.value).toBe(4)
    expect(r.checklist).toEqual([true, true, false])
    expect(r.kind).toBe('removable')
  })

  it('a written exclusion on a one-formula line is still undefined', () => {
    // x² {x != 2}: f(2) is undefined by the restriction
    const r = limitAt(lsrc('y = x^2 {x != 2}'), 2)
    expect(r.fa).toBeNull()
    expect(r.checklist).toEqual([false, true, false])
  })
})

// ---------------------------------------------------------------------------
// 8. MVT / average value at a removable hole
// ---------------------------------------------------------------------------

describe('8. no c at a hole', () => {
  it('(x³ − x)/x on [−1, 1]: f′ = 2x = 0 only at the hole', () => {
    // f = x² − 1 for x ≠ 0; f(−1) = f(1) = 0, so m = 0; f′(c) = 2c = 0 ⇒
    // c = 0, where f is undefined: no c.
    const s = msrc('y = (x^3-x)/x')
    const sec = secantOf(s, -1, 1)!
    expect(sec.m).toBe(0)
    const p = mvtPoints(s, -1, 1, sec.m)
    expect(p.all).toBe(false)
    expect(p.points.some((q) => Math.abs(q.x) < 1e-6 && q.to === undefined)).toBe(false)
  })

  it('(x² − 1)/(x − 1) on [0, 2]: no "c ≈ 1"', () => {
    // f = x + 1 for x ≠ 1: m = (3 − 1)/2 = 1 = f′ everywhere except the
    // hole at 1 — every c in (0, 1) and in (1, 2), but not 1.
    const s = msrc('y = (x^2-1)/(x-1)')
    const sec = secantOf(s, 0, 2)!
    expect(sec.m).toBe(1)
    const p = mvtPoints(s, 0, 2, sec.m)
    expect(p.all).toBe(false)
    expect(p.points.map((q) => [q.x, q.to])).toEqual([[0, 1], [1, 2]])
    // average value: ∫₀² (x + 1) dx / 2 = (2 + 2)/2 = 2 = f(c) ⇒ c = 1: the hole
    const av = averageValue(s, 0, 2)!
    expect(av.value).toBeCloseTo(2, 9)
    expect(av.points).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 9. x·sin(1/x)
// ---------------------------------------------------------------------------

describe('9. x·sin(1/x)', () => {
  const f = (x: number) => x * Math.sin(1 / x)
  const fp = (x: number) => Math.sin(1 / x) - Math.cos(1 / x) / x

  it('on [0.01, 1]: no corner, and all 32 values of c', () => {
    // f is smooth on [0.01, 1] (no corner anywhere).
    // m = (1·sin 1 − 0.01·sin 100)/0.99 ≈ 0.855085. f′(c) = sin(1/c) −
    // cos(1/c)/c = m has 32 solutions in (0.01, 1) (counted by the sign
    // changes of f′ − m on a 2,000,000-point grid).
    const s = msrc('y = x sin(1/x)')
    expect(differentiabilityOn(s, 0.01, 1)).toEqual([])
    const sec = secantOf(s, 0.01, 1)!
    const m = (f(1) - f(0.01)) / 0.99
    expect(sec.m).toBeCloseTo(m, 12)
    expect(sec.m).toBeCloseTo(0.855085, 5)
    const p = mvtPoints(s, 0.01, 1, sec.m)
    expect(p.all).toBe(false)
    expect(p.points).toHaveLength(32)
    for (const c of p.points) {
      expect(c.x).toBeGreaterThan(0.01)
      expect(c.x).toBeLessThan(1)
      expect(Math.abs(fp(c.x) - m)).toBeLessThan(1e-4 * Math.max(1, 1 / c.x))
    }
  })

  it('on [−1, 1]: no false corners or vertical tangents near 0', () => {
    // f is analytic at every x ≠ 0; at 0 it is undefined (continuityOn's
    // business), so differentiabilityOn has nothing to report.
    expect(differentiabilityOn(msrc('y = x sin(1/x)'), -1, 1)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 10. A piecewise MVT stretch has exact ends
// ---------------------------------------------------------------------------

describe('10. piecewise stretches end on the piece ends', () => {
  it('{x², x < 1; 2x, x ≥ 1} on [0, 2]: every c in (1, 2)', () => {
    // m = (f(2) − f(0))/2 = (4 − 0)/2 = 2. f′ = 2c on (0, 1) (= 2 only at
    // c = 1, which is not in that piece) and 2 on (1, 2): every c in (1, 2).
    const s = msrc('y = {x^2, x<1; 2x, x>=1}')
    const sec = secantOf(s, 0, 2)!
    expect(sec.m).toBe(2)
    const p = mvtPoints(s, 0, 2, sec.m)
    expect(p.points).toHaveLength(1)
    expect(p.points[0].x).toBe(1)
    expect(p.points[0].to).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 11. Euler numbers
// ---------------------------------------------------------------------------

describe('11. eulerNumber prints ×10ⁿ, and a rounding is not exact', () => {
  it('scientific notation the way the app writes it', () => {
    expect(eulerNumber(1e-5).text).toBe('10⁻⁵')
    expect(eulerNumber(-2.5e-8).text).toBe('−2.5×10⁻⁸')
    // 12345678 → 1.2345678·10⁷, four significant: 1.235×10⁷ — rounded
    const big = eulerNumber(12345678)
    expect(big.text).toBe('1.235×10⁷')
    expect(big.tex).toBe('1.235\\times 10^{7}')
    expect(big.exact).toBe(false)
    expect(big.text).not.toMatch(/e[+-]/)
  })

  it('exact only when the printed text is the whole value', () => {
    expect(eulerNumber(1e7).exact).toBe(true) // 10⁷ is all of it
    expect(eulerNumber(1e-14).text).toBe('0')
    expect(eulerNumber(1e-14).exact).toBe(false) // a rounding to 0
    expect(eulerNumber(0).exact).toBe(true)
    expect(eulerNumber(2.5).exact).toBe(true)
  })
})

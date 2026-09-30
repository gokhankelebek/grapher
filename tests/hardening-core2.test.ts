// ============================================================================
// tests/hardening-core2.test.ts — regressions for the reviewers' findings in
// src/core/series.ts, linprog.ts, inequality2d.ts and logistic.ts.
//
// Every expected value is worked by hand in the comment above its assertion.
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { InequalityInfo } from '../src/core/types'
import { parseExpression } from '../src/core/parse'
import { parseSequence } from '../src/core/sequences'
import { analyzeSeries, lnFactorial, lnGamma, partialSumsTo, seriesSource } from '../src/core/series'
import type { SeriesAnalysis, SeriesSource, SeriesTestId } from '../src/core/series'
import { plainFormula } from '../src/ui/seqLinks'
import { feasibleRegion, lineText, optimize, parseObjective } from '../src/core/linprog'
import type { LinConstraint } from '../src/core/linprog'
import { describeInequality } from '../src/core/inequality2d'
import { logisticFeatures } from '../src/core/logistic'
import type { LogisticSpec } from '../src/core/logistic'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function src(line: string, k0?: number, withPlain = true): SeriesSource {
  const p = parseSequence(line)
  if (!p.ok) throw new Error(`${line}: ${p.error}`)
  return seriesSource(p.seq, p.seq.defaultParams, k0 ?? p.seq.start, withPlain ? plainFormula(line) : null)
}

function series(line: string, k0?: number): SeriesAnalysis {
  return analyzeSeries(src(line, k0))
}

function startOf(line: string): number {
  const p = parseSequence(line)
  if (!p.ok) throw new Error(line)
  return p.seq.start
}

function outcome(a: SeriesAnalysis, id: SeriesTestId): string {
  return a.tests.find((t) => t.id === id)?.outcome ?? 'missing'
}

function reason(a: SeriesAnalysis, id: SeriesTestId): string {
  return a.tests.find((t) => t.id === id)?.reason ?? ''
}

/** The series must converge, with no "undefined term" and no divergent nth-term test. */
function expectConverges(a: SeriesAnalysis): void {
  expect(a.problem).toBeNull()
  expect(a.verdict).toMatch(/^converges/)
  expect(outcome(a, 'nth-term')).not.toBe('diverges')
  expect(a.justification).not.toMatch(/grows without bound|undefined/)
}

function ineq(s: string): InequalityInfo {
  const o = parseExpression(s)
  if (!o.ok) throw new Error(`${s}: ${o.error}`)
  const info = o.plot.makeModel('m').inequality?.(o.plot.defaultParams.slice())
  if (!info) throw new Error(`${s}: not an inequality`)
  return info
}

function lin(s: string): LinConstraint[] {
  return ineq(s).parts.map((p) => {
    if (!p.linear) throw new Error(`${s} is not linear`)
    return { ...p.linear, strict: p.strict }
  })
}

function objective(s: string) {
  const o = parseObjective(s)
  if (!o.ok) throw new Error(o.error)
  return o.obj
}

// ---------------------------------------------------------------------------
// 1. Series whose pieces overflow: read in log space, converge by the ratio test
// ---------------------------------------------------------------------------

describe('series whose terms overflow in their pieces', () => {
  it('log-gamma: ln Γ(n + 1) = ln n! (exact products and Stirling agree)', () => {
    // 10! = 3628800; Γ(1/2) = √π; ln 170! is finite while 171! overflows.
    expect(lnFactorial(10)).toBeCloseTo(Math.log(3628800), 12)
    expect(lnGamma(0.5)).toBeCloseTo(0.5 * Math.log(Math.PI), 12)
    let f = 1
    for (let i = 2; i <= 170; i++) f *= i
    expect(lnFactorial(170) / Math.log(f)).toBeCloseTo(1, 13)
    expect(lnGamma(171)).toBeCloseTo(Math.log(f), 9)
  })

  it('every sequence here starts at n = 1 unless told otherwise', () => {
    for (const l of ['a_n = 100^n/n!', 'a_n = (2n)!/(n!)^2/5^n', 'a_n = 2^n/3^n', 'a_n = 10^n/n!', 'a_n = n!/n^n']) {
      expect(startOf(l), l).toBe(1)
    }
  })

  it('Σ 100ⁿ/n! from n = 1 converges by the ratio test to e¹⁰⁰ − 1', () => {
    // Σ_{n≥0} xⁿ/n! = eˣ; the n = 0 term is 1, so from n = 1 it is e¹⁰⁰ − 1
    // ≈ 2.688·10⁴³. 100ⁿ overflows at n = 155 while the term is ~10³⁶, so ∞
    // there is the pieces, not the term. L = lim 100/(n + 1) = 0.
    const a = series('a_n = 100^n/n!')
    expectConverges(a)
    expect(a.decidedBy).toBe('ratio')
    expect(outcome(a, 'ratio')).toBe('converges')
    expect(a.tests.find((t) => t.id === 'ratio')?.limit?.value).toBe(0)
    expect(outcome(a, 'nth-term')).toBe('inconclusive')
    expect(a.sum?.text).toBe('e¹⁰⁰ − 1')
    expect(a.sum?.tex).toBe('e^{100} - 1')
    expect(a.sum!.value / (Math.exp(100) - 1)).toBeCloseTo(1, 12)
    // the term at n = 155 is a number, not ∞: 100¹⁵⁵/155! = e^(155 ln 100 − ln 155!)
    const s = src('a_n = 100^n/n!')
    const want = Math.exp(155 * Math.log(100) - lnFactorial(155))
    expect(s.term(155) / want).toBeCloseTo(1, 9)
  })

  it('Σ (2n)!/((n!)²5ⁿ) from n = 1 converges (L = 4/5) to √5 − 1', () => {
    // Σ_{n≥0} C(2n, n) xⁿ = 1/√(1 − 4x); at x = 1/5 that is 1/√(1/5) = √5, and
    // the n = 0 term is 1. Ratio: (2n + 1)(2n + 2)/((n + 1)²·5) → 4/5.
    const a = series('a_n = (2n)!/(n!)^2/5^n')
    expectConverges(a)
    expect(a.decidedBy).toBe('ratio')
    expect(a.tests.find((t) => t.id === 'ratio')?.limit?.text).toBe('4/5')
    expect(a.sum?.value).toBeCloseTo(Math.sqrt(5) - 1, 10)
    expect(a.sum?.text).toBe('√5 − 1')
  })

  it('Σ 2ⁿ/3ⁿ from n = 1 is geometric: 2', () => {
    // a = 2/3, r = 2/3: (2/3)/(1 − 2/3) = 2. 2¹⁰²⁴/3¹⁰²⁴ is ∞/∞ in doubles.
    const a = series('a_n = 2^n/3^n')
    expectConverges(a)
    expect(a.signs).toBe('positive')
    expect(a.sum?.text).toBe('2')
    expect(outcome(a, 'ratio')).toBe('converges')
  })

  it('Σ (−2)ⁿ/3ⁿ from n = 1 is geometric: −2/5', () => {
    // a = −2/3, r = −2/3: (−2/3)/(1 + 2/3) = (−2/3)/(5/3) = −2/5.
    const a = series('a_n = (-2)^n/3^n')
    expectConverges(a)
    expect(a.verdict).toBe('converges-absolutely')
    expect(a.sum?.value).toBeCloseTo(-0.4, 14)
    expect(a.sum?.text).toBe('−2/5')
  })

  it('Σ 2ⁿ/3ⁿ⁺¹: 1 from n = 0, 2/3 from n = 1', () => {
    // n = 0: a = 1/3, r = 2/3 → (1/3)/(1/3) = 1. n = 1: a = 2/9 → (2/9)/(1/3) = 2/3.
    const a0 = series('a_n = 2^n/3^(n+1)', 0)
    expectConverges(a0)
    expect(a0.sum?.text).toBe('1')
    const a1 = series('a_n = 2^n/3^(n+1)')
    expect(a1.k0).toBe(1)
    expect(a1.sum?.text).toBe('2/3')
  })

  it('Σ 3ⁿ/4ⁿ from n = 1 is geometric: 3', () => {
    // (3/4)/(1 − 3/4) = 3.
    const a = series('a_n = 3^n/4^n')
    expectConverges(a)
    expect(a.sum?.text).toBe('3')
  })

  it('Σ n²2ⁿ/3ⁿ from n = 1 converges (L = 2/3) to 30', () => {
    // Σ n² xⁿ = x(1 + x)/(1 − x)³; x = 2/3: (2/3)(5/3)/(1/27) = (10/9)·27 = 30.
    const a = series('a_n = n^2 2^n/3^n')
    expectConverges(a)
    expect(a.decidedBy).toBe('ratio')
    expect(a.tests.find((t) => t.id === 'ratio')?.limit?.text).toBe('2/3')
    expect(a.sum?.value).toBeCloseTo(30, 9)
  })

  it('Σ 4ⁿ/(5ⁿ + 1) from n = 1 converges (L = 4/5), its sum a number', () => {
    // aₙ₊₁/aₙ = 4(5ⁿ + 1)/(5ⁿ⁺¹ + 1) → 4/5. The sum: terms past n = 400 are
    // below 0.8⁴⁰⁰ ≈ 10⁻³⁹, so the first 400 (all finite in doubles) are it.
    const a = series('a_n = 4^n/(5^n+1)')
    expectConverges(a)
    expect(a.tests.find((t) => t.id === 'ratio')?.limit?.text).toBe('4/5')
    let want = 0
    for (let n = 1; n <= 400; n++) want += 4 ** n / (5 ** n + 1)
    expect(a.sum?.value).toBeCloseTo(want, 9)
    // the term at n = 450: 5ⁿ overflows, 4ⁿ does not — (4/5)⁴⁵⁰ ≈ 3·10⁻⁴⁴, not 0
    const t = src('a_n = 4^n/(5^n+1)').term(450)
    expect(t / Math.exp(450 * Math.log(0.8))).toBeCloseTo(1, 9)
  })

  it('Σ eⁿ/n! from n = 1 converges (L = 0) to eᵉ − 1', () => {
    // Σ_{n≥0} xⁿ/n! = eˣ with x = e, less the n = 0 term: eᵉ − 1 ≈ 14.15426.
    const a = series('a_n = e^n/n!')
    expectConverges(a)
    expect(a.decidedBy).toBe('ratio')
    expect(a.sum?.value).toBeCloseTo(Math.exp(Math.E) - 1, 9)
  })

  it('Σ 10ⁿ/n! from n = 1 converges to e¹⁰ − 1', () => {
    // e¹⁰ − 1 ≈ 22025.4658; 10ⁿ/n! is NaN (∞/∞) in doubles from n = 309.
    const a = series('a_n = 10^n/n!')
    expectConverges(a)
    expect(a.sum?.text).toBe('e¹⁰ − 1')
    expect(a.sum?.value).toBeCloseTo(Math.exp(10) - 1, 8)
  })

  it('Σ n!/nⁿ from n = 1 converges by the ratio test, L = 1/e', () => {
    // aₙ₊₁/aₙ = (n + 1)·nⁿ/(n + 1)ⁿ⁺¹ = (n/(n + 1))ⁿ → 1/e. n!/nⁿ is ∞/∞ at 171.
    const a = series('a_n = n!/n^n')
    expectConverges(a)
    expect(a.decidedBy).toBe('ratio')
    const L = a.tests.find((t) => t.id === 'ratio')?.limit
    expect(L?.text).toBe('1/e')
    expect(L?.value).toBeCloseTo(1 / Math.E, 6)
    // 1 + 1/2 + 2/9 + 3/32 + … ≈ 1.8798538621
    expect(a.sum?.value).toBeCloseTo(1.8798538621, 8)
  })

  it('the partial sums on the board go on past the overflow', () => {
    // S₁₀₂₄ of Σ(2/3)ⁿ = 2(1 − (2/3)¹⁰²⁴) = 2 to double precision — not NaN.
    const s = partialSumsTo(src('a_n = 2^n/3^n'), 1100)
    expect(s[s.length - 1]).toBeCloseTo(2, 12)
  })

  it('a real overflow still diverges: Σ n!/10ⁿ, and a pole is an undefined term', () => {
    const a = series('a_n = n!/10^n')
    expect(a.verdict).toBe('diverges')
    // 1/(n − 5) at n = 5 is 1/0 — a term that does not exist
    const b = series('a_n = 1/(n-5)')
    expect(b.problem).toMatch(/a₅ is undefined/)
    // √(1000 − n) past n = 1000 is truly undefined, even after shrinking terms
    const c = series('a_n = sqrt(1000-n)/n^2')
    expect(c.problem).toMatch(/a₁₀₀₁ is undefined/)
  })

  it('1000ⁿ/n! passes 10³⁰⁸ on its way to 0: not "grows without bound"', () => {
    // max term near n = 1000: e^(1000 − ½ln(2π·1000)) ≈ 10⁴³², too big for a
    // double, and still the series converges (L = 0), to e¹⁰⁰⁰ − 1.
    const a = series('a_n = 1000^n/n!')
    expectConverges(a)
    expect(outcome(a, 'nth-term')).toBe('inconclusive')
    expect(a.sum).toBeNull()
    expect(a.sumNote).toMatch(/e¹⁰⁰⁰ − 1.*too large/)
  })

  it('without a formula to read, an ∞/∞ after shrinking terms is not an undefined term', () => {
    // no plain formula: the log path is off, the prefix ratio is trusted
    for (const l of ['a_n = 2^n/3^n', 'a_n = n!/n^n', 'a_n = 4^n/(5^n+1)']) {
      const a = analyzeSeries(src(l, undefined, false))
      expect(a.problem, l).toBeNull()
      expect(a.verdict, l).toBe('converges')
    }
    const g = analyzeSeries(src('a_n = 2^n/3^n', undefined, false))
    expect(g.sum?.text).toBe('2')
    // and nothing claims divergence for 1000ⁿ/n! or 100ⁿ/n!
    for (const l of ['a_n = 100^n/n!', 'a_n = 1000^n/n!']) {
      const a = analyzeSeries(src(l, undefined, false))
      expect(a.verdict, l).not.toBe('diverges')
      expect(a.problem, l).toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// 2. Conditional convergence stated
// ---------------------------------------------------------------------------

describe('conditional convergence by comparison with the harmonic series', () => {
  it('Σ(−1)ⁿ/ln n from n = 2 converges conditionally', () => {
    // AST: 1/ln n decreases to 0. |aₙ| = 1/ln n ≥ 1/n for n ≥ 2 (ln n < n),
    // and Σ1/n diverges, so Σ|aₙ| diverges by direct comparison.
    const a = series('a_n = (-1)^n/ln(n)', 2)
    expect(a.verdict).toBe('converges-conditionally')
    expect(a.verdictText).toBe('Converges conditionally')
    expect(outcome(a, 'alternating')).toBe('converges')
    expect(outcome(a, 'absolute')).toBe('diverges')
    expect(reason(a, 'absolute')).toMatch(/1\/n > 0 for n ≥ 2/)
    expect(reason(a, 'absolute')).toMatch(/harmonic series/)
    expect(a.justification).toMatch(/converges conditionally/)
  })

  it('Σ(−1)ⁿ ln(n)/n converges conditionally, |aₙ| ≥ 1/n from n = 3', () => {
    // ln 2/2 ≈ 0.347 < 1/2, ln 3/3 ≈ 0.366 ≥ 1/3, and ln n ≥ 1 for all n ≥ 3.
    const a = series('a_n = (-1)^n ln(n)/n')
    expect(a.verdict).toBe('converges-conditionally')
    expect(outcome(a, 'absolute')).toBe('diverges')
    expect(reason(a, 'absolute')).toMatch(/for n ≥ 3/)
  })

  it('an absolutely convergent series is not caught by it: Σ(−1)ⁿ/n²', () => {
    expect(series('a_n = (-1)^n/n^2').verdict).toBe('converges-absolutely')
  })
})

// ---------------------------------------------------------------------------
// 3–4. Linear programming: half-planes, strips, and strict emptiness
// ---------------------------------------------------------------------------

describe('linear programming on a half-plane or a strip', () => {
  it('y ≥ 0 with max P = y: no maximum (unbounded upward); min 0 along y = 0', () => {
    const r = feasibleRegion(lin('y >= 0'))
    expect(r.status).toBe('unbounded')
    expect(r.rays).toContainEqual({ x: 0, y: 1 })
    const max = optimize(r, objective('P = y'), 'max')
    expect(max.status).toBe('none')
    expect(max.sentence).toMatch(/^No maximum/)
    const min = optimize(r, objective('P = y'), 'min')
    expect(min.status).toBe('optimal')
    expect(min.value).toBe(0)
    expect(min.sentence).toBe('Minimum P = 0, at every point of the line y = 0 (multiple optimal solutions).')
  })

  it('the strip 0 ≤ y ≤ 2 with max P = y: P = 2 along the whole line y = 2', () => {
    const r = feasibleRegion([...lin('y >= 0'), ...lin('y <= 2')])
    expect(r.status).toBe('unbounded')
    const max = optimize(r, objective('P = y'), 'max')
    expect(max.status).toBe('optimal')
    expect(max.value).toBe(2)
    expect(max.valueText).toBe('2')
    expect(max.sentence).toBe('Maximum P = 2, at every point of the line y = 2 (multiple optimal solutions).')
    // P = 3y + 1 on the same strip: 3·2 + 1 = 7 at y = 2, 1 at y = 0
    expect(optimize(r, objective('P = 3y + 1'), 'max').value).toBe(7)
    expect(optimize(r, objective('P = 3y + 1'), 'min').value).toBe(1)
    // P = x runs off along the strip either way
    expect(optimize(r, objective('P = x'), 'max').status).toBe('none')
  })

  it('a slanted strip 0 ≤ x + y ≤ 4, max P = 2x + 2y: 8 along y = −x + 4', () => {
    const r = feasibleRegion([...lin('x + y >= 0'), ...lin('x + y <= 4')])
    const max = optimize(r, objective('P = 2x + 2y'), 'max')
    expect(max.value).toBeCloseTo(8, 12)
    expect(max.sentence).toMatch(/line y = −x \+ 4/)
    // a dashed side is approached, never reached
    const open = feasibleRegion([...lin('y >= 0'), ...lin('y < 2')])
    const m = optimize(open, objective('P = y'), 'max')
    expect(m.attained).toBe(false)
    expect(m.sentence).toMatch(/never reaches it/)
  })

  it('lineText solves the line the way a student writes it', () => {
    expect(lineText({ a: 0, b: -1, c: 2, strict: false })).toBe('y = 2')
    expect(lineText({ a: 1, b: 0, c: 3, strict: false })).toBe('x = −3')
    expect(lineText({ a: -2, b: 1, c: -1, strict: false })).toBe('y = 2x + 1')
    expect(lineText({ a: 1, b: 2, c: 0, strict: false })).toBe('y = −(1/2)x')
  })
})

describe('linear programming: strict boundaries that leave nothing', () => {
  it('x > 0, y > 0, x + y < 0 is empty: no solution', () => {
    // x > 0 and y > 0 give x + y > 0; only (0, 0) satisfies the closed system.
    const r = feasibleRegion([...lin('x > 0'), ...lin('y > 0'), ...lin('x + y < 0')])
    expect(r.status).toBe('empty')
    expect(optimize(r, objective('P = x + y'), 'max').sentence).toMatch(/^No solution/)
  })

  it('y > x, y < x, x ≥ 0 is empty', () => {
    const r = feasibleRegion([...lin('y > x'), ...lin('y < x'), ...lin('x >= 0')])
    expect(r.status).toBe('empty')
  })

  it('still feasible: open triangles, and a closed single point', () => {
    // x > 0, y > 0, x + y < 4: (1, 1) is in it.
    expect(feasibleRegion([...lin('x > 0'), ...lin('y > 0'), ...lin('x + y < 4')]).status).toBe('bounded')
    // x ≥ 0, y ≥ 0, x + y ≤ 0: the single point (0, 0), which is allowed.
    const pt = feasibleRegion([...lin('x >= 0'), ...lin('y >= 0'), ...lin('x + y <= 0')])
    expect(pt.status).toBe('bounded')
    expect(pt.vertices.map((v) => v.label)).toEqual(['(0, 0)'])
    // x > 0, y > 0 alone: the open quadrant, unbounded
    expect(feasibleRegion([...lin('x > 0'), ...lin('y > 0')]).status).toBe('unbounded')
  })
})

// ---------------------------------------------------------------------------
// 5–6. Test points: never ±∞, and the note says why the origin was skipped
// ---------------------------------------------------------------------------

describe('inequality test points', () => {
  it('y > ln(x): not "0 > −∞" — (0, 0) is outside the domain of ln x', () => {
    // (1, 0) is on y = ln x (ln 1 = 0), so (1, 1) is tested: 1 > 0 ✓.
    const t = describeInequality(ineq('y > ln(x)')).test!
    expect(t.text).not.toMatch(/∞/)
    expect(t.point).toEqual({ x: 1, y: 1 })
    expect(t.text).toBe('Test (1, 1): 1 > ln(1) → 1 > 0 ✓ → shade the side with (1, 1)')
    expect(t.note).toBe('(0, 0) isn’t in the domain of ln(x), so (1, 1) is tested instead.')
  })

  it('y > 1/x, y > x^-1 and y < log_2(x) + 3 pass over (0, 0) for (1, 0)', () => {
    // (1, 0): 0 > 1/1 = 1 ✗; 0 < log₂ 1 + 3 = 3 ✓.
    for (const s of ['y > 1/x', 'y > x^-1']) {
      const t = describeInequality(ineq(s)).test!
      expect(t.text, s).not.toMatch(/∞|undefined/)
      expect(t.point, s).toEqual({ x: 1, y: 0 })
      expect(t.ok, s).toBe(false)
      expect(t.note, s).toMatch(/^\(0, 0\) isn’t in the domain of .*, so \(1, 0\) is tested instead\.$/)
    }
    const l = describeInequality(ineq('y < log_2(x) + 3')).test!
    expect(l.text).not.toMatch(/∞/)
    expect(l.point).toEqual({ x: 1, y: 0 })
    expect(l.ok).toBe(true)
    expect(l.note).toMatch(/isn’t in the domain/)
  })

  it('y > sqrt(x − 1): (0, 0) is outside the domain, not on the boundary', () => {
    // √(0 − 1) is undefined; (1, 0) is on y = √(x − 1) (√0 = 0); (0, 1) is
    // undefined too; (1, 1): 1 > √0 = 0 ✓.
    const t = describeInequality(ineq('y > sqrt(x - 1)')).test!
    expect(t.point).toEqual({ x: 1, y: 1 })
    expect(t.note).toBe('(0, 0) isn’t in the domain of √(x − 1), so (1, 1) is tested instead.')
    expect(t.note).not.toMatch(/boundary/)
  })

  it('the origin on the boundary still says so, naming the point tested', () => {
    const t = describeInequality(ineq('y > x')).test!
    expect(t.note).toBe('(0, 0) is on the boundary, so (1, 0) is tested instead.')
  })
})

// ---------------------------------------------------------------------------
// 7. Logistic KaTeX: \frac and \log, not a form feed
// ---------------------------------------------------------------------------

describe('logistic inflection in base b', () => {
  it('x₀ = log₂(3/2) typesets as \\log_{2} \\frac{3}{2}', () => {
    // y = 10/(1 + (3/2)·2^(−x)): the midpoint is where 2ˣ = 3/2, x = log₂(3/2) ≈ 0.585.
    const spec: LogisticSpec = { L: '10', k: '', A: '3/2', h: '0', d: '0', b: '2' }
    const f = logisticFeatures(spec)!
    const x = f.inflection.x
    expect(x.value).toBeCloseTo(Math.log2(1.5), 12)
    expect(x.tex).toBe('\\log_{2} \\frac{3}{2}')
    expect(x.tex).not.toMatch(/[\f\b\t\v]/)
    // with a shift h = 1: 1 + log₂(3/2)
    const g = logisticFeatures({ ...spec, h: '1' })!
    expect(g.inflection.x.tex).toBe('1 + \\log_{2} \\frac{3}{2}')
  })
})

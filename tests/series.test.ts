// ============================================================================
// tests/series.test.ts — infinite series (AP Calculus BC Unit 10).
//
// The core (src/core/series.ts): partial sums, the sum where it is known
// (exact: a/(1 − r), π²/6, ln 2, e, telescoping values), and every AP
// convergence test with its written reason — including the honest answers
// ("inconclusive", "can't decide") and Σ 1/(n ln n), which partial sums would
// call finite and the integral test calls divergent.
//
// The board's half (src/ui/seqLinks.ts): the card data, the partial-sum
// squares, the band and the line y = S, the staircase bars, and persistence
// (the `series` fields, written only when set; old documents byte-identical).
// Also n! in the expression engine, which the factorial series need.
// ============================================================================

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { FitResult } from '../src/core/types'
import { parseSequence } from '../src/core/sequences'
import { analyzeExpr, compileExpr } from '../src/core/parse'
import {
  analyzeSeries,
  exactPartialSum,
  partialSumsTo,
  seriesSource,
} from '../src/core/series'
import type { SeriesAnalysis, SeriesSource, SeriesTestId } from '../src/core/series'
import {
  clampSeriesN,
  deserializeDoc,
  docFromBoard,
  serializeDoc,
  sequenceToStored,
  storedToSequence,
} from '../src/core/persist'
import type { BoardInput, BoardSequence, DocMeta } from '../src/core/persist'
import {
  compileSequence,
  compileSequences,
  defaultSeriesView,
  plainFormula,
  sequenceBox,
  sequenceCard,
  sequenceScatter,
  seriesColor,
  seriesOverlays,
  seriesSetId,
  sumsSetId,
} from '../src/ui/seqLinks'
import { SequenceCard } from '../src/ui/SequenceCard'
import { SeriesSection } from '../src/ui/SeriesSection'

function src(line: string, k0?: number): SeriesSource {
  const p = parseSequence(line)
  if (!p.ok) throw new Error(`${line}: ${p.error}`)
  const start = k0 ?? p.seq.start
  return seriesSource(p.seq, p.seq.defaultParams, start, plainFormula(line))
}

function series(line: string, k0?: number): SeriesAnalysis {
  return analyzeSeries(src(line, k0))
}

function outcome(a: SeriesAnalysis, id: SeriesTestId): string {
  const t = a.tests.find((x) => x.id === id)
  if (!t) throw new Error(`no ${id}`)
  return t.outcome
}

function reason(a: SeriesAnalysis, id: SeriesTestId): string {
  return a.tests.find((x) => x.id === id)?.reason ?? ''
}

// ---------------------------------------------------------------------------
// n! in the expression engine
// ---------------------------------------------------------------------------

describe('n! — a postfix factorial in the expression engine', () => {
  it('evaluates n!, (2n)!, 2n! and fact(n), exactly at the whole numbers', () => {
    const f = compileExpr('x!')
    if (!f.ok) throw new Error(f.error)
    expect([0, 1, 5, 10].map((x) => f.expr.ev([], x, 0))).toEqual([1, 1, 120, 3628800])
    expect(f.expr.ev([], 171, 0)).toBe(Infinity)
    expect(f.expr.ev([], -1, 0)).toBeNaN()
    expect(f.expr.ev([], 0.5, 0)).toBeCloseTo(Math.sqrt(Math.PI) / 2, 12) // Γ(3/2)
    const g = compileExpr('(2x)!')
    if (!g.ok) throw new Error(g.error)
    expect(g.expr.ev([], 3, 0)).toBe(720)
    const h = compileExpr('2x!')
    if (!h.ok) throw new Error(h.error)
    expect(h.expr.ev([], 3, 0)).toBe(12)
    const k = compileExpr('fact(4)')
    if (!k.ok) throw new Error(k.error)
    expect(k.expr.ev([], 0, 0)).toBe(24)
  })

  it('typesets n! bare and (n + 1)! in parentheses; != stays an error', () => {
    const a = analyzeExpr('5!')
    expect(a.ok && a.value).toBe(120)
    expect(a.ok && a.latex).toBe('5!')
    const b = compileExpr('(x+1)!')
    expect(b.ok && b.expr.latex).toBe('\\left(x+1\\right)!')
    expect(analyzeExpr('3 != 2').ok).toBe(false)
  })

  it('reads a_n = 1/n! and a_n = n!/10^n as sequences', () => {
    const p = parseSequence('a_n = n!/10^n')
    expect(p.ok).toBe(true)
    if (p.ok) {
      expect(p.seq.term([], 3)).toBeCloseTo(6 / 1000, 15)
      expect(p.seq.latex).toBe('a_{n}=\\frac{n!}{10^{n}}')
    }
  })

  it('wraps a fraction raised to a power: 3(−2/3)ⁿ is not 3·(−2)/3ⁿ', () => {
    const p = parseSequence('a_n = 3(-2/3)^n')
    expect(p.ok && p.seq.latex).toBe('a_{n}=3\\left(\\frac{-2}{3}\\right)^{n}')
  })
})

// ---------------------------------------------------------------------------
// The AP set
// ---------------------------------------------------------------------------

describe('Σ 1/n² — a p-series with p = 2', () => {
  const a = series('a_n = 1/n^2')
  it('converges by the p-series test, to π²/6', () => {
    expect(a.verdict).toBe('converges')
    expect(a.decidedBy).toBe('p-series')
    expect(a.justification).toMatch(/p = 2 > 1/)
    expect(a.sum?.exact).toBe(true)
    expect(a.sum?.text).toBe('π²/6')
    expect(a.sum?.tex).toBe('\\frac{\\pi^{2}}{6}')
    expect(a.sum?.value).toBeCloseTo(Math.PI ** 2 / 6, 14)
  })
  it('typesets the series and agrees with the other tests', () => {
    expect(a.tex).toBe('\\sum_{n=1}^{\\infty} \\frac{1}{n^{2}}')
    expect(outcome(a, 'nth-term')).toBe('inconclusive')
    expect(outcome(a, 'integral')).toBe('converges')
    expect(reason(a, 'integral')).toMatch(/it equals 1/)
    expect(outcome(a, 'direct-comparison')).toBe('converges')
    expect(outcome(a, 'limit-comparison')).toBe('converges')
    expect(outcome(a, 'ratio')).toBe('inconclusive')
    expect(reason(a, 'ratio')).toMatch(/L = lim .* = 1/)
    expect(outcome(a, 'alternating')).toBe('not-applicable')
  })
  it('knows π²/6 from n = 2 as π²/6 − 1', () => {
    const b = series('a_n = 1/n^2', 2)
    expect(b.sum?.text).toBe('π²/6 − 1')
    expect(b.sum?.value).toBeCloseTo(Math.PI ** 2 / 6 - 1, 14)
  })
  it('knows π⁴/90 for p = 4, and gives ζ(3) as a number with its error', () => {
    expect(series('a_n = 1/n^4').sum?.text).toBe('π⁴/90')
    const z3 = series('a_n = 1/n^3')
    expect(z3.verdict).toBe('converges')
    expect(z3.sum?.exact).toBe(false)
    expect(z3.sum?.value).toBeCloseTo(1.2020569031595942, 7)
    expect(z3.sum?.text).toMatch(/^≈ 1\.20205/)
  })
})

describe('Σ 1/n — the harmonic series', () => {
  const a = series('a_n = 1/n')
  it('diverges (p-series, p = 1), and the integral test agrees', () => {
    expect(a.verdict).toBe('diverges')
    expect(a.decidedBy).toBe('p-series')
    expect(a.justification).toMatch(/p = 1 ≤ 1/)
    expect(outcome(a, 'integral')).toBe('diverges')
    expect(reason(a, 'integral')).toMatch(/ln x → ∞/)
    expect(a.sum).toBeNull()
  })
  it('is not rescued by the nth-term test: lim 1/n = 0 is inconclusive', () => {
    expect(outcome(a, 'nth-term')).toBe('inconclusive')
  })
})

describe('Σ (−1)ⁿ⁺¹/n — the alternating harmonic series', () => {
  const a = series('a_n = (-1)^(n+1)/n')
  it('converges conditionally: the AST, and Σ|aₙ| = Σ1/n diverges', () => {
    expect(a.verdict).toBe('converges-conditionally')
    expect(a.verdictText).toBe('Converges conditionally')
    expect(a.decidedBy).toBe('alternating')
    expect(a.justification).toMatch(/alternating series test/)
    expect(a.justification).toMatch(/Σ\|aₙ\| diverges/)
    expect(outcome(a, 'alternating')).toBe('converges')
    expect(outcome(a, 'absolute')).toBe('diverges')
  })
  it('sums to ln 2', () => {
    expect(a.sum?.text).toBe('ln 2')
    expect(a.sum?.value).toBeCloseTo(Math.LN2, 14)
  })
  it('carries the alternating series error bound |S − S_N| ≤ |a_(N+1)|', () => {
    expect(a.boundFrom).toBe(0)
    expect(reason(a, 'alternating')).toMatch(/\|S − S_N\| ≤ \|a_\(N\+1\)\|/)
    const s = src('a_n = (-1)^(n+1)/n')
    for (const N of [5, 10, 50]) {
      const SN = partialSumsTo(s, N)[N - 1]
      expect(Math.abs(Math.LN2 - SN)).toBeLessThanOrEqual(1 / (N + 1))
    }
    expect(exactPartialSum(s, 10)?.text).toBe('1627/2520')
  })
})

describe('Σ (1/2)ⁿ from n = 0 — geometric', () => {
  it('converges to 2, exactly', () => {
    const a = series('a_n = (1/2)^n, n >= 0')
    expect(a.k0).toBe(0)
    expect(a.decidedBy).toBe('geometric')
    expect(a.verdict).toBe('converges')
    expect(a.sum?.text).toBe('2')
    expect(a.justification).toMatch(/r = 1\/2/)
    expect(a.tex).toBe('\\sum_{n=0}^{\\infty} \\left(1/2\\right)^{n}')
  })
  it('the same from the window: a_n = (1/2)^n started at n = 0', () => {
    expect(series('a_n = (1/2)^n', 0).sum?.text).toBe('2')
    expect(series('a_n = (1/2)^n', 1).sum?.text).toBe('1')
  })
  it('a recursive geometric sequence is recognised too', () => {
    const a = series('a_1 = 1, a_(n+1) = a_n/2')
    expect(a.decidedBy).toBe('geometric')
    expect(a.sum?.text).toBe('2')
    expect(a.tex).toBe('\\sum_{n=1}^{\\infty} a_{n}')
    expect(outcome(a, 'integral')).toBe('not-applicable')
  })
})

describe('Σ 3(−2/3)ⁿ — geometric with a negative ratio', () => {
  it('converges (absolutely) to the exact −6/5', () => {
    const a = series('a_n = 3(-2/3)^n')
    expect(a.decidedBy).toBe('geometric')
    expect(a.verdict).toBe('converges-absolutely')
    expect(a.sum?.text).toBe('−6/5')
    expect(a.sum?.exact).toBe(true)
    expect(a.justification).toMatch(/first term −2 and common ratio r = −2\/3/)
  })
  it('|r| ≥ 1 diverges', () => {
    const a = series('a_n = 2^n')
    expect(a.verdict).toBe('diverges')
    expect(a.decidedBy).toBe('geometric')
  })
})

describe('Σ n/(n + 1) — the nth-term test', () => {
  it('diverges: lim aₙ = 1 ≠ 0', () => {
    const a = series('a_n = n/(n+1)')
    expect(a.verdict).toBe('diverges')
    expect(a.decidedBy).toBe('nth-term')
    expect(a.justification).toMatch(/lim aₙ = 1 ≠ 0/)
    expect(a.sum).toBeNull()
  })
  it('an oscillation that never shrinks has no limit either: Σ cos n diverges', () => {
    const a = series('a_n = cos(n)')
    expect(a.verdict).toBe('diverges')
    expect(a.decidedBy).toBe('nth-term')
    expect(a.justification).toMatch(/does not exist/)
  })
})

describe('Σ n!/10ⁿ — the ratio test', () => {
  it('diverges: |aₙ₊₁/aₙ| = (n + 1)/10 → ∞', () => {
    const a = series('a_n = n!/10^n')
    expect(a.verdict).toBe('diverges')
    expect(a.decidedBy).toBe('ratio')
    expect(a.justification).toMatch(/L = ∞ > 1/)
    expect(outcome(a, 'nth-term')).toBe('diverges')
  })
  it('an exact finite L: Σ n/2ⁿ has L = 1/2, and sums to 2', () => {
    const a = series('a_n = n/2^n')
    expect(a.decidedBy).toBe('ratio')
    expect(a.tests.find((t) => t.id === 'ratio')?.limit?.text).toBe('1/2')
    expect(a.sum?.text).toBe('2')
  })
})

describe('Σ 1/n! from n = 0 — e', () => {
  it('converges by the ratio test (L = 0) to e', () => {
    const a = series('a_n = 1/n!, n >= 0')
    expect(a.verdict).toBe('converges')
    expect(a.decidedBy).toBe('ratio')
    expect(a.justification).toMatch(/L = lim .* = 0 < 1/)
    expect(a.sum?.text).toBe('e')
    expect(a.sum?.value).toBeCloseTo(Math.E, 14)
  })
  it('from n = 1 it is e − 1; Σ 2ⁿ/n! is e²', () => {
    expect(series('a_n = 1/n!').sum?.text).toBe('e − 1')
    expect(series('a_n = 2^n/n!, n >= 0').sum?.text).toBe('e²')
  })
})

describe('Σ (n + 1)/(n³ + 2) — limit comparison with 1/n²', () => {
  const a = series('a_n = (n+1)/(n^3+2)')
  it('converges by the limit comparison test, L = 1', () => {
    expect(a.verdict).toBe('converges')
    expect(a.decidedBy).toBe('limit-comparison')
    const lct = a.tests.find((t) => t.id === 'limit-comparison')
    expect(lct?.compare?.text).toBe('1/n²')
    expect(lct?.limit?.text).toBe('1')
    expect(a.justification).toMatch(/1\/n²\) = 1, which is finite and positive/)
  })
  it('direct comparison with 1/n² does not decide (the terms are larger)', () => {
    expect(outcome(a, 'direct-comparison')).toBe('inconclusive')
    expect(reason(a, 'direct-comparison')).toMatch(/larger than a convergent series/)
  })
  it('gives the sum as a number with an error estimate', () => {
    expect(a.sum?.exact).toBe(false)
    expect(a.sum?.error).toBeLessThan(1e-6)
    // Σ (n+1)/(n³+2), summed far and bounded
    let s = 0
    for (let n = 1; n <= 2_000_000; n++) s += (n + 1) / (n ** 3 + 2)
    expect(a.sum?.value).toBeCloseTo(s + 1 / 2_000_000, 6)
  })
})

describe('Σ 1/(n ln n) from n = 2 — never convergent from partial sums', () => {
  const a = series('a_n = 1/(n ln n), n >= 2')
  it('diverges by the integral test', () => {
    expect(a.verdict).toBe('diverges')
    expect(a.decidedBy).toBe('integral')
    expect(a.justification).toMatch(/f\(x\) = 1\/\(x ln x\) is positive, continuous and decreasing for x ≥ 2/)
    expect(a.justification).toMatch(/ln\(ln x\) → ∞/)
    expect(a.sum).toBeNull()
  })
  it('the comparisons honestly fail to decide', () => {
    expect(outcome(a, 'direct-comparison')).toBe('inconclusive')
    expect(outcome(a, 'limit-comparison')).toBe('inconclusive')
    expect(outcome(a, 'ratio')).toBe('inconclusive')
  })
  it('an undefined first term is a problem, not a verdict', () => {
    const b = series('a_n = 1/(n ln n)', 1)
    expect(b.verdict).toBe('unknown')
    expect(b.problem).toMatch(/a₁ is undefined/)
  })
  it('its (ln n)² cousin converges — and no sum is invented for it', () => {
    const c = series('a_n = 1/(n (ln n)^2), n >= 2')
    expect(c.verdict).toBe('converges')
    expect(c.decidedBy).toBe('integral')
    expect(c.sum).toBeNull()
    expect(c.sumNote).toMatch(/too slowly/)
  })
})

describe('Σ 1/(n(n + 1)) — telescoping', () => {
  it('converges to 1', () => {
    const a = series('a_n = 1/(n(n+1))')
    expect(a.verdict).toBe('converges')
    expect(a.decidedBy).toBe('telescoping')
    expect(a.sum?.text).toBe('1')
    expect(a.justification).toMatch(/aₙ = 1\/n − 1\/\(n \+ 1\)/)
    expect(a.justification).toMatch(/S_N = 1 − 1\/\(N \+ 1\)/)
  })
  it('other common forms: 1/(4n² − 1) → 1/2, 1/(n(n + 2)) → 3/4', () => {
    expect(series('a_n = 1/(4n^2-1)').sum?.text).toBe('1/2')
    expect(series('a_n = 1/(n(n+2))').sum?.text).toBe('3/4')
    expect(series('a_n = 1/n - 1/(n+1)').sum?.text).toBe('1')
  })
})

describe('Σ sin(n)/n² — absolute convergence by direct comparison', () => {
  const a = series('a_n = sin(n)/n^2')
  it('converges absolutely: |sin n/n²| ≤ 1/n²', () => {
    expect(a.signs).toBe('mixed')
    expect(a.verdict).toBe('converges-absolutely')
    expect(a.decidedBy).toBe('direct-comparison')
    expect(a.justification).toMatch(/\|aₙ\| ≤ 1\/n²/)
    expect(a.justification).toMatch(/converges absolutely/)
  })
  it('the ratio test does not apply; the AST does not apply', () => {
    expect(outcome(a, 'ratio')).toBe('not-applicable')
    expect(outcome(a, 'alternating')).toBe('not-applicable')
  })
  it('the sum is a number with a proven tail bound', () => {
    expect(a.sum?.exact).toBe(false)
    expect(a.sum?.value).toBeCloseTo(1.0139591323607684, 4)
  })
})

describe('more of the AP picture', () => {
  it('Leibniz: Σ(−1)ⁿ/(2n + 1) from 0 converges conditionally to π/4', () => {
    const a = series('a_n = (-1)^n/(2n+1), n >= 0')
    expect(a.verdict).toBe('converges-conditionally')
    expect(a.sum?.text).toBe('π/4')
  })
  it('Σ(−1)ⁿ/n² converges absolutely (p-series on |aₙ|), to −π²/12', () => {
    const a = series('a_n = (-1)^n/n^2')
    expect(a.verdict).toBe('converges-absolutely')
    expect(a.decidedBy).toBe('p-series')
    expect(a.sum?.text).toBe('−π²/12')
  })
  it('Σ(−1)ⁿ n/(n + 1) diverges by the nth-term test (no limit)', () => {
    const a = series('a_n = (-1)^n n/(n+1)')
    expect(a.verdict).toBe('diverges')
    expect(a.decidedBy).toBe('nth-term')
  })
  it('Σ 1/√n diverges (p = 1/2), Σ 1/(n² + 1) converges by direct comparison', () => {
    expect(series('a_n = 1/sqrt(n)').justification).toMatch(/p = 1\/2 ≤ 1/)
    const b = series('a_n = 1/(n^2+1)')
    expect(b.decidedBy).toBe('direct-comparison')
    expect(b.verdict).toBe('converges')
  })
  it('Σ ln(n)/n² converges by the integral test', () => {
    const a = series('a_n = ln(n)/n^2')
    expect(a.verdict).toBe('converges')
    expect(a.decidedBy).toBe('integral')
  })
  it('a finite list is a finite sum; an open list only knows its terms', () => {
    const f = analyzeSeries(src('1, 2, 3, 4'))
    expect(f.verdict).toBe('finite')
    expect(f.sum?.text).toBe('10')
    const g = analyzeSeries(src('2, 6, 18, 54, …'))
    expect(g.verdict).toBe('diverges')
    expect(g.decidedBy).toBe('geometric')
  })
  it('every test is listed, in the AP order, each with a reason', () => {
    const a = series('a_n = 1/n^2')
    expect(a.tests.map((t) => t.id)).toEqual([
      'nth-term',
      'geometric',
      'p-series',
      'telescoping',
      'integral',
      'direct-comparison',
      'limit-comparison',
      'ratio',
      'alternating',
      'absolute',
    ])
    for (const t of a.tests) expect(t.reason.length).toBeGreaterThan(10)
  })
  it('partial sums are exact fractions while they stay readable', () => {
    const s = src('a_n = 1/n^2')
    expect(exactPartialSum(s, 5)?.text).toBe('5269/3600')
    expect(exactPartialSum(s, 150)).toBeNull()
    expect(partialSumsTo(s, 3)).toEqual([1, 1.25, 1 + 0.25 + 1 / 9])
  })
})

// ---------------------------------------------------------------------------
// The board: card, squares, band, line, bars, frame
// ---------------------------------------------------------------------------

function sq(over: Partial<BoardSequence> = {}): BoardSequence {
  return {
    id: 'S1',
    src: 'a_n = 1/n^2',
    color: '#4f9cf9',
    visible: true,
    n0: 1,
    count: 10,
    showPartner: false,
    showSums: false,
    params: [],
    ...over,
  }
}

describe('the Series section of a sequence card', () => {
  it('is off until switched on, and then starts at the window’s last term', () => {
    const q = sq()
    expect(compileSequence(q).sigma).toBeNull()
    expect(sequenceCard(q, compileSequence(q)).sigma).toBeNull()
    expect(defaultSeriesView(q)).toEqual({ N: 10, connect: false, bars: false })
    expect(defaultSeriesView(sq({ n0: 0, count: 500 }))).toEqual({ N: 199, connect: false, bars: false })
  })

  it('prints Σ, S_N, the sum, the verdict and every test', () => {
    const q = sq({ series: { N: 20, connect: false, bars: false } })
    const card = sequenceCard(q, compileSequence(q)).sigma
    expect(card).not.toBeNull()
    if (!card) return
    expect(card.tex).toBe('\\sum_{n=1}^{\\infty} \\frac{1}{n^{2}}')
    expect(card.N).toBe(20)
    expect([card.Nmin, card.Nmax]).toEqual([1, 200])
    expect(card.sNLabel).toBe('S₂₀')
    expect(card.sNText).toMatch(/^≈ 1\.596163/)
    expect(card.sumText).toBe('S = π²/6 ≈ 1.644934')
    expect(card.verdictText).toBe('Converges')
    expect(card.testName).toBe('p-series')
    expect(card.tests).toHaveLength(10)
    expect(card.bound).toBeNull()
  })

  it('an alternating series states its error bound at N', () => {
    const q = sq({ src: 'a_n = (-1)^(n+1)/n', series: { N: 10, connect: false, bars: false } })
    const card = sequenceCard(q, compileSequence(q)).sigma
    expect(card?.sNText).toBe('1627/2520 ≈ 0.6456349')
    expect(card?.bound).toBe('|S − S₁₀| ≤ |a₁₁| = 1/11 ≈ 0.09090909')
    expect(card?.actual).toMatch(/^actual \|S − S₁₀\| ≈ 0\.04/)
  })

  it('clamps N to 1 … 200 (k₀ … k₀ + 199)', () => {
    const q = sq({ series: { N: 999, connect: false, bars: false } })
    expect(compileSequence(q).sigma?.N).toBe(200)
    const r = sq({ n0: 2, src: 'a_n = 1/(n ln n)', series: { N: -5, connect: false, bars: false } })
    expect(compileSequence(r).sigma?.N).toBe(2)
  })

  it('renders the section with the toggle, the slider and the verdict', () => {
    const q = sq({ series: { N: 20, connect: true, bars: false } })
    const card = sequenceCard(q, compileSequence(q))
    const html = renderToStaticMarkup(
      createElement(SequenceCard, {
        seq: q,
        card,
        selected: true,
        onSelect: () => {},
        onDelete: () => {},
        onDuplicate: () => {},
        onToggleVisible: () => {},
        onCycleColor: () => {},
        onZoom: () => {},
        onParamChange: () => {},
        onParamEditStart: () => {},
        onParamEditEnd: () => {},
        onParamSetExact: () => {},
        onEquationCommit: () => null,
        onWindow: () => null,
        onTogglePartner: () => {},
        onToggleSums: () => {},
      }),
    )
    expect(html).toContain('data-testid="seq-series-toggle"')
    expect(html).toContain('Σ show series')
    expect(html).toContain('data-testid="series-section"')
    expect(html).toContain('data-testid="series-n"')
    expect(html).toContain('S = π²/6 ≈ 1.644934')
    expect(html).toMatch(/series-verdict-word">Converges</)
    expect(html).toContain('Show all tests')
    expect(html).toContain('aria-pressed="true"') // join the sums
  })

  it('the section alone renders a problem instead of numbers', () => {
    const q = sq({ src: 'a_n = 1/(n ln n)', series: { N: 10, connect: false, bars: false } })
    const data = sequenceCard(q, compileSequence(q)).sigma
    if (!data) throw new Error('no card')
    const html = renderToStaticMarkup(
      createElement(SeriesSection, {
        data,
        color: '#f9a825',
        onChange: () => {},
        onRemove: () => {},
        onEditStart: () => {},
        onEditEnd: () => {},
      }),
    )
    expect(html).toContain('a₁ is undefined')
    expect(html).not.toContain('data-testid="series-n"')
  })
})

describe('the series on the board', () => {
  it('draws the partial sums as squares in a companion colour, replacing the rings', () => {
    const q = sq({ showSums: true, series: { N: 15, connect: false, bars: false } })
    const sets = sequenceScatter([q], compileSequences([q]))
    expect(sets.map((s) => s.id)).toEqual(['S1', seriesSetId('S1')])
    expect(sets.some((s) => s.id === sumsSetId('S1'))).toBe(false)
    const sums = sets[1]
    expect(sums.marker).toBe('square')
    expect(sums.color).toBe(seriesColor('#4f9cf9'))
    expect(sums.color).not.toBe('#4f9cf9')
    expect(sums.xs).toHaveLength(15)
    expect(sums.ys[1]).toBeCloseTo(1.25, 14)
  })

  it('a dashed y = S with its chip when the series converges; nothing for a divergent one', () => {
    const q = sq({ series: { N: 20, connect: false, bars: false } })
    const ov = seriesOverlays([q], compileSequences([q]))
    const line = ov.find((o) => o.kind === 'hline')
    expect(line && line.kind === 'hline' && line.dashed).toBe(true)
    expect(line && line.kind === 'hline' && line.y).toBeCloseTo(Math.PI ** 2 / 6, 12)
    expect(ov.some((o) => o.kind === 'label' && o.text === 'S = π²/6')).toBe(true)
    const h = sq({ src: 'a_n = 1/n', series: { N: 20, connect: false, bars: false } })
    expect(seriesOverlays([h], compileSequences([h]))).toEqual([])
  })

  it('the alternating band S ± |a_(N+1)| at N, narrowing as N grows', () => {
    const band = (N: number): number => {
      const q = sq({ src: 'a_n = (-1)^(n+1)/n', series: { N, connect: false, bars: false } })
      const ov = seriesOverlays([q], compileSequences([q]))
      const b = ov.find((o) => o.kind === 'path' && o.closed === true && o.fill !== undefined)
      if (!b || b.kind !== 'path') throw new Error('no band')
      const ys = b.points.map((p) => p.y)
      expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(Math.LN2, 12)
      expect(b.points[0].x).toBe(N - 0.5)
      return Math.max(...ys) - Math.min(...ys)
    }
    expect(band(5)).toBeCloseTo(2 / 6, 12)
    expect(band(20)).toBeCloseTo(2 / 21, 12)
  })

  it('the staircase: one bar per term, each standing on the sum before it', () => {
    const q = sq({ src: 'a_n = (1/2)^n', series: { N: 4, connect: true, bars: true } })
    const ov = seriesOverlays([q], compileSequences([q]))
    const bars = ov.filter((o) => o.kind === 'path' && o.closed === true && o.under === true)
    expect(bars).toHaveLength(4)
    const spans = bars.map((b) => (b.kind === 'path' ? [b.points[0].y, b.points[2].y] : []))
    expect(spans).toEqual([
      [0, 0.5],
      [0.5, 0.75],
      [0.75, 0.875],
      [0.875, 0.9375],
    ])
    expect(ov.some((o) => o.kind === 'path' && !o.closed)).toBe(true) // joined sums
  })

  it('a hidden sequence draws no series; the frame includes the sums and S', () => {
    const q = sq({ visible: false, series: { N: 20, connect: false, bars: true } })
    expect(seriesOverlays([q], compileSequences([q]))).toEqual([])
    const v = sq({ series: { N: 20, connect: false, bars: false } })
    const box = sequenceBox(v, compileSequence(v))
    expect(box && box.max.x).toBeGreaterThanOrEqual(20)
    expect(box && box.max.y).toBeGreaterThanOrEqual(Math.PI ** 2 / 6)
  })

  it('reads the typed formula for the integral test', () => {
    expect(plainFormula('a_n = 1/(n ln n), n >= 2')).toBe('1/(n ln n)')
    expect(plainFormula('a_n = 1/n^2 {1 <= n <= 20}')).toBe('1/n^2')
    expect(plainFormula('a_1 = 1, a_(n+1) = a_n/2')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function board(over: Partial<BoardInput> = {}): BoardInput {
  return {
    curves: [],
    styles: {},
    candidates: new Map<string, FitResult[]>(),
    exprSources: {},
    viewport: { center: { x: 0, y: 0 }, pxPerUnit: 60 },
    selectedId: null,
    mode: 'draw',
    ...over,
  }
}

const META: DocMeta = { id: 'doc1', name: 'Lesson 1', createdAt: 1000, modifiedAt: 1000 }

describe('the series persists per sequence, written only when set', () => {
  it('writes nothing while the series is off', () => {
    expect(sequenceToStored(sq())).toEqual({ id: 'S1', src: 'a_n = 1/n^2', color: '#4f9cf9', n0: 1, count: 10 })
  })

  it('writes N, and each switch only when on', () => {
    expect(sequenceToStored(sq({ series: { N: 20, connect: false, bars: false } })).series).toEqual({ N: 20 })
    expect(sequenceToStored(sq({ series: { N: 7, connect: true, bars: true } })).series).toEqual({
      N: 7,
      connect: true,
      bars: true,
    })
  })

  it('round-trips through a document', () => {
    const qs = [
      sq({ series: { N: 42, connect: true, bars: false } }),
      sq({ id: 'S2', src: 'a_n = (-1)^(n+1)/n', series: { N: 5, connect: false, bars: true } }),
      sq({ id: 'S3', src: 'a_n = 1/n' }),
    ]
    const json = serializeDoc(docFromBoard(META, board({ sequences: qs }), 2000))
    const back = deserializeDoc(json)
    expect(back.degraded).toBe(false)
    expect(back.board!.sequences).toEqual(qs)
  })

  it('an old document is byte-identical after a load and a save', () => {
    const old = [sq(), sq({ id: 'S2', src: 'b_1 = 10, b_(n+1) = 0.5b_n', showSums: true, showPartner: true })]
    const a = serializeDoc(docFromBoard(META, board({ sequences: old }), 2000))
    expect(a).not.toContain('"series"')
    const back = deserializeDoc(a)
    const again = serializeDoc(docFromBoard(META, board({ sequences: back.board!.sequences }), 2000))
    expect(again).toBe(a)
    expect(back.board!.sequences.every((q) => q.series === undefined)).toBe(true)
  })

  it('reads a damaged series field without losing the sequence', () => {
    const r = storedToSequence({ id: 'S1', src: 'a_n = 1/n', n0: 1, count: 10, series: { N: 'x' } })
    expect('sequence' in r && r.sequence.series).toBeUndefined()
    const r2 = storedToSequence({ id: 'S1', src: 'a_n = 1/n', n0: 1, count: 10, series: { N: 12.4, connect: 1 } })
    expect('sequence' in r2 && r2.sequence.series).toEqual({ N: 12, connect: false, bars: false })
    expect(clampSeriesN(1e9)).toBe(100200)
    expect(clampSeriesN(Number.NaN)).toBeNull()
  })
})

describe('the term window follows the series N', () => {
  it('S₁₂ shown: the terms a₁ … a₁₂ are all drawn, not only the card window of 10', async () => {
    const { compileSequence } = await import('../src/ui/seqLinks')
    const q = {
      id: 'q', src: 'a_n = (-1)^(n+1)/n', params: [], color: '#f00', visible: true,
      n0: 1, count: 10, series: { N: 12 },
    } as unknown as Parameters<typeof compileSequence>[0]
    const c = compileSequence(q)
    expect(c.ns[c.ns.length - 1]).toBe(12)
    expect(c.values[11]).toBeCloseTo(-1 / 12, 12)
  })
})

// ============================================================================
// tests/stats.test.ts — NC Math 3 / AP Precalculus statistics.
//
//   core        erf / erfc, the normal pdf / cdf / inverse against tables,
//               the empirical rule, z-scores, the seeded generator, the
//               sampling SDs, the margin of error, the randomisation test
//   links       the normal card (P(…) = P(z…) ≈ …, the working, percentiles)
//               and the simulation card (margins of error, p-value, sentence)
//   persistence settings and seed only; round trip; old documents byte-identical
//   reveal      the stat:<id>:value key, masked panels and their "?"
//   words       describeGraph states what a panel shows (and a student copy not)
//   figures     docScene draws the panels; the student copy says "?"
// ============================================================================

import { describe, expect, it } from 'vitest'
import {
  EMPIRICAL_RULE,
  erf,
  erfc,
  exactRandomizationP,
  invNorm,
  makeRng,
  marginOfError,
  meanSd,
  normalBetween,
  normalCdf,
  normalPdf,
  normalProbability,
  parseNumberList,
  randomizationTest,
  sdOfMean,
  sdOfProportion,
  simulateSamples,
  theoryOf,
  zScore,
  zStar,
} from '../src/core/stats'
import { MAX_STATS, statToStored, storedToStat } from '../src/core/statsPersist'
import type { BoardInput, DocMeta } from '../src/core/persist'
import { deserializeDoc, docFromBoard, serializeDoc } from '../src/core/persist'
import {
  EXAMPLE_GROUP_A,
  EXAMPLE_GROUP_B,
  newNormal,
  newSim,
  normalCard,
  normalFigure,
  panelBox,
  simCard,
  simFigure,
  simPlayStep,
  simResult,
  statsFigures,
} from '../src/ui/statsLinks'
import { REVEAL_OFF, applyReveal, buildInventory, isHidden, maskStats, revealOne, statKey } from '../src/ui/reveal'
import type { RevealState, SceneReveal } from '../src/ui/reveal'
import type { BoardScene } from '../src/ui/renderBoard'
import { DARK_THEME } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { docFigure, docModelFromJSON, recordFigure } from '../src/ui/docScene'
import { describeBoard } from '../src/ui/boardDescription'
import { describeStats } from '../src/core/describeAdapters'
import type { TextItem } from '../src/render/vectorCtx'

// ---------------------------------------------------------------------------
// The normal distribution
// ---------------------------------------------------------------------------

describe('erf and erfc', () => {
  // Reference values to 16+ digits (Abramowitz & Stegun / high-precision tables).
  const ERF: [number, number][] = [
    [0, 0],
    [0.1, 0.1124629160182849],
    [0.5, 0.5204998778130465],
    [1, 0.8427007929497149],
    [1.5, 0.9661051464753108],
    [2, 0.9953222650189527],
    [3, 0.9999779095030014],
  ]
  it('agrees with the tables to 1e-12', () => {
    for (const [x, v] of ERF) {
      expect(Math.abs(erf(x) - v), `erf(${x})`).toBeLessThan(1e-12)
      expect(Math.abs(erf(-x) + v), `erf(${-x})`).toBeLessThan(1e-12)
    }
  })
  it('keeps relative accuracy in the far tail', () => {
    expect(erfc(3) / 2.209049699858544e-5 - 1).toBeLessThan(1e-12)
    expect(Math.abs(erfc(5) / 1.537459794428035e-12 - 1)).toBeLessThan(1e-11)
    expect(Math.abs(erfc(-2) - (2 - 0.004677734981047266))).toBeLessThan(1e-13)
  })
  it('is continuous where the series hands over to the continued fraction', () => {
    expect(Math.abs(erf(2.5 - 1e-12) - erf(2.5 + 1e-12))).toBeLessThan(1e-13)
    expect(Math.abs(erf(2.5) - 0.999593047982555)).toBeLessThan(1e-12)
  })
  it('handles the edges', () => {
    expect(erf(Infinity)).toBe(1)
    expect(erf(-Infinity)).toBe(-1)
    expect(erfc(Infinity)).toBe(0)
    expect(Number.isNaN(erf(NaN))).toBe(true)
  })
})

describe('the normal pdf and cdf', () => {
  it('matches the z table', () => {
    const TABLE: [number, number][] = [
      [0, 0.5],
      [1, 0.8413447460685429],
      [1.645, 0.9500150944608786],
      [1.96, 0.9750021048517795],
      [2, 0.9772498680518208],
      [2.576, 0.995002467684265],
      [3, 0.9986501019683699],
      [-1, 0.15865525393145707],
      [-3, 0.0013498980316300946],
    ]
    for (const [z, p] of TABLE) expect(Math.abs(normalCdf(z) - p), `Φ(${z})`).toBeLessThan(1e-12)
  })
  it('is relatively accurate deep in the lower tail', () => {
    expect(Math.abs(normalCdf(-8) / 6.22096057427178e-16 - 1)).toBeLessThan(1e-10)
  })
  it('scales by μ and σ', () => {
    expect(normalCdf(130, 100, 15)).toBeCloseTo(normalCdf(2), 14)
    expect(normalPdf(0)).toBeCloseTo(1 / Math.sqrt(2 * Math.PI), 15)
    expect(normalPdf(100, 100, 15)).toBeCloseTo(1 / (15 * Math.sqrt(2 * Math.PI)), 15)
    expect(Number.isNaN(normalCdf(1, 0, 0))).toBe(true)
  })
  it('states the four kinds of probability', () => {
    expect(normalProbability('between', 100, 15, 85, 130)).toBeCloseTo(0.8185946141203637, 12)
    expect(normalProbability('below', 100, 15, 85, 0)).toBeCloseTo(0.15865525393145707, 12)
    expect(normalProbability('above', 100, 15, 130, 0)).toBeCloseTo(0.022750131948179195, 12)
    expect(normalProbability('outside', 0, 1, -1.96, 1.96)).toBeCloseTo(0.04999579029644087, 12)
    // the bounds may come in either order
    expect(normalProbability('between', 0, 1, 1, -1)).toBeCloseTo(0.6826894921370859, 12)
    // two upper-tail bounds do not cancel to nothing
    expect(normalBetween(8, 9) / (normalCdf(-8) - normalCdf(-9)) - 1).toBeLessThan(1e-9)
  })
})

describe('the inverse normal', () => {
  it('matches the z table', () => {
    const TABLE: [number, number][] = [
      [0.5, 0],
      [0.975, 1.959963984540054],
      [0.95, 1.6448536269514722],
      [0.9, 1.2815515655446004],
      [0.995, 2.5758293035489004],
      [0.025, -1.959963984540054],
      [0.01, -2.3263478740408408],
    ]
    for (const [p, z] of TABLE) expect(Math.abs(invNorm(p) - z), `invNorm(${p})`).toBeLessThan(1e-12)
  })
  it('round-trips through the cdf from the tails to the middle', () => {
    for (const p of [1e-12, 1e-8, 0.001, 0.02425, 0.1, 0.3, 0.5, 0.7, 0.97575, 0.999]) {
      const z = invNorm(p)
      expect(Math.abs(normalCdf(z) / p - 1), `p = ${p}`).toBeLessThan(1e-12)
    }
  })
  it('scales by μ and σ, and refuses nonsense', () => {
    expect(invNorm(0.9, 100, 15)).toBeCloseTo(100 + 15 * 1.2815515655446004, 10)
    expect(invNorm(0)).toBe(-Infinity)
    expect(invNorm(1)).toBe(Infinity)
    expect(Number.isNaN(invNorm(1.2))).toBe(true)
  })
})

describe('z-scores and the empirical rule', () => {
  it('z = (x − μ)/σ', () => {
    expect(zScore(85, 100, 15)).toBe(-1)
    expect(zScore(130, 100, 15)).toBe(2)
  })
  it('68 / 95 / 99.7 — taught, and exactly', () => {
    expect(EMPIRICAL_RULE.map((r) => r.text)).toEqual(['68%', '95%', '99.7%'])
    expect(EMPIRICAL_RULE[0].exact).toBeCloseTo(0.6826894921370859, 12)
    expect(EMPIRICAL_RULE[1].exact).toBeCloseTo(0.9544997361036416, 12)
    expect(EMPIRICAL_RULE[2].exact).toBeCloseTo(0.9973002039367398, 12)
    for (const r of EMPIRICAL_RULE) expect(Math.abs(r.exact - r.taught)).toBeLessThan(0.006)
  })
})

// ---------------------------------------------------------------------------
// Sampling and simulation
// ---------------------------------------------------------------------------

describe('the seeded generator', () => {
  it('gives the same stream for the same seed, and another for another', () => {
    const a = makeRng(42)
    const b = makeRng(42)
    const c = makeRng(43)
    const xa = Array.from({ length: 20 }, () => a.next())
    const xb = Array.from({ length: 20 }, () => b.next())
    const xc = Array.from({ length: 20 }, () => c.next())
    expect(xa).toEqual(xb)
    expect(xa).not.toEqual(xc)
    for (const v of xa) expect(v >= 0 && v < 1).toBe(true)
  })
  it('makes standard normal variates', () => {
    const r = makeRng(7)
    const xs = Array.from({ length: 20000 }, () => r.normal())
    const { mean, sd } = meanSd(xs)
    expect(Math.abs(mean)).toBeLessThan(0.03)
    expect(Math.abs(sd - 1)).toBeLessThan(0.03)
  })
})

describe('sampling distributions', () => {
  it('σ/√n and √(p(1−p)/n)', () => {
    expect(sdOfMean(15, 25)).toBe(3)
    expect(sdOfProportion(0.5, 100)).toBe(0.05)
    expect(theoryOf({ kind: 'list', values: [1, 0, 1, 1] }, 'proportion', 4)).toEqual({ center: 0.75, sd: Math.sqrt((0.75 * 0.25) / 4) })
  })
  it('z* and the margin of error', () => {
    expect(zStar(0.95)).toBeCloseTo(1.959963984540054, 12)
    expect(zStar(0.9)).toBeCloseTo(1.6448536269514722, 12)
    expect(zStar(0.99)).toBeCloseTo(2.5758293035489004, 12)
    expect(marginOfError(0.95, 0.05)).toBeCloseTo(0.0979981992270027, 12)
  })
  it('a simulation is a pure function of its settings and seed', () => {
    const pop = { kind: 'normal' as const, mu: 100, sigma: 15 }
    const a = simulateSamples(pop, 'mean', 30, 1000, 2024)
    const b = simulateSamples(pop, 'mean', 30, 1000, 2024)
    const c = simulateSamples(pop, 'mean', 30, 1000, 2025)
    expect(Array.from(a)).toEqual(Array.from(b))
    expect(Array.from(a)).not.toEqual(Array.from(c))
  })
  it('the simulated SD of x̄ is σ/√n', () => {
    const s = simulateSamples({ kind: 'normal', mu: 100, sigma: 15 }, 'mean', 30, 10000, 11)
    const { mean, sd } = meanSd(s)
    expect(Math.abs(mean - 100)).toBeLessThan(0.1)
    expect(Math.abs(sd / sdOfMean(15, 30) - 1)).toBeLessThan(0.03)
  })
  it('the simulated SD of p̂ is √(p(1−p)/n)', () => {
    const s = simulateSamples({ kind: 'proportion', p: 0.3 }, 'proportion', 50, 10000, 5)
    const { mean, sd } = meanSd(s)
    expect(Math.abs(mean - 0.3)).toBeLessThan(0.003)
    expect(Math.abs(sd / sdOfProportion(0.3, 50) - 1)).toBeLessThan(0.03)
    // every p̂ is a whole number of successes out of n
    for (const v of s.slice(0, 50)) expect(Math.abs(v * 50 - Math.round(v * 50))).toBeLessThan(1e-9)
  })
  it('samples a pasted list with replacement', () => {
    const values = [2, 4, 4, 4, 5, 5, 7, 9]
    const s = simulateSamples({ kind: 'list', values }, 'mean', 8, 8000, 3)
    const pop = meanSd(values)
    expect(Math.abs(meanSd(s).mean - pop.mean)).toBeLessThan(0.05)
    expect(Math.abs(meanSd(s).sd / sdOfMean(pop.sd, 8) - 1)).toBeLessThan(0.04)
  })
  it('reads pasted numbers', () => {
    expect(parseNumberList('12, 15 18\n21; 9.5\t−3')).toEqual({ values: [12, 15, 18, 21, 9.5, -3], bad: [] })
    expect(parseNumberList('1, two, 3').bad).toEqual(['two'])
  })
})

describe('the randomisation test', () => {
  // Pool {1,…,6}; A = {1,2,3}. Of the C(6,3) = 20 splits, only {1,2,3} and
  // {4,5,6} give a difference as extreme as |−3|: p = 2/20 = 0.1 two-sided,
  // and 1/20 = 0.05 one-sided.
  it('has the exact p-value of a small example', () => {
    expect(exactRandomizationP([1, 2, 3], [4, 5, 6])).toBeCloseTo(0.1, 12)
    expect(exactRandomizationP([1, 2, 3], [4, 5, 6], 'lower')).toBeCloseTo(0.05, 12)
    expect(exactRandomizationP([1, 2, 3], [4, 5, 6], 'upper')).toBeCloseTo(1, 12)
  })
  it('estimates it by shuffling the labels', () => {
    const r = randomizationTest([1, 2, 3], [4, 5, 6], 10000, 99)!
    expect(r.observed).toBe(-3)
    expect(r.diffs.length).toBe(10000)
    expect(Math.abs(r.p - 0.1)).toBeLessThan(0.01)
    expect(r.extreme).toBe(Math.round(r.p * 10000))
    // the same seed, the same answer
    expect(randomizationTest([1, 2, 3], [4, 5, 6], 10000, 99)!.p).toBe(r.p)
    // every re-randomised difference is one the pool can make
    for (const d of r.diffs.slice(0, 200)) expect(Math.abs(d * 3 - Math.round(d * 3))).toBeLessThan(1e-9)
  })
  it('the plant example is significant, but not overwhelmingly', () => {
    const r = randomizationTest(EXAMPLE_GROUP_A, EXAMPLE_GROUP_B, 5000, 1)!
    expect(r.observed).toBeCloseTo(0.82, 10)
    expect(r.p).toBeLessThan(0.05)
    expect(r.p).toBeGreaterThan(0.005)
  })
  it('needs two groups', () => {
    expect(randomizationTest([], [1], 100, 1)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The cards
// ---------------------------------------------------------------------------

describe('the normal card', () => {
  it('states P(85 < X < 130) = P(−1 < Z < 2) ≈ 0.8186 with the working', () => {
    const c = normalCard(newNormal('N'))
    expect(c.pText).toBe('0.8186')
    expect(c.summary).toBe('N(100, 15) · P(85 < X < 130) ≈ 0.8186')
    expect(c.probTex!.question).toBe('P(85 < X < 130) = P(-1.00 < Z < 2.00)')
    expect(c.probTex!.answer).toBe('0.8186')
    expect(c.zWork.map((z) => z.z)).toEqual([-1, 2])
    expect(c.zWork[0].tex).toContain('\\dfrac{85 - 100}{15} = -1.00')
  })
  it('finds the value for a percentile', () => {
    const c = normalCard({ ...newNormal('N'), mode: 'percentile', pct: 90 })
    expect(c.percentile!.z).toBeCloseTo(1.2815515655446004, 10)
    expect(c.percentile!.x).toBeCloseTo(119.2232734831690, 8)
    expect(c.summary).toBe('N(100, 15) · 90th percentile: x ≈ 119.22')
  })
  it('a far tail is not rounded to 0.0000', () => {
    const c = normalCard({ ...newNormal('N'), mode: 'above', a: 200 })
    expect(c.pText).toMatch(/×10\^/)
  })
})

describe('the simulation card', () => {
  it('reports the simulated mean and SD against σ/√n, and margins of error', () => {
    const s = { ...newSim('S', 4242), reps: 2000 }
    const c = simCard(s)
    expect(c.ok).toBe(true)
    const sample = c.sample!
    expect(Number(sample.theorySd)).toBeCloseTo(15 / Math.sqrt(30), 4)
    expect(Math.abs(Number(sample.sd) / (15 / Math.sqrt(30)) - 1)).toBeLessThan(0.06)
    expect(sample.me.map((m) => m.label)).toEqual(['90%', '95%', '99%'])
    const r = simResult(s)!
    expect(r.mode).toBe('sample')
    if (r.mode !== 'sample') return
    expect(Number(sample.me[1].me)).toBeCloseTo(1.959963984540054 * r.sd, 3)
    // centred on sample 1 unless one is typed
    expect(sample.observed).toBe(r.values[0])
    expect(simCard({ ...s, observed: 101 }).sample!.observed).toBe(101)
  })
  it('compares treatments in a sentence', () => {
    const s = { ...newSim('S', 1), mode: 'compare' as const, groupA: [1, 2, 3], groupB: [4, 5, 6], reps: 1000 }
    const c = simCard(s)
    expect(c.compare!.sentence).toMatch(/^In \d+ of 1000 re-randomisations the difference in means was at least as large \(in either direction\) as the observed −3\.00/)
    expect(c.compare!.conclusion).toMatch(/not statistically significant/)
    expect(c.compare!.p).toMatch(/^≈ 0\.\d{3}$/)
    // none as extreme: "p < 0.001", never "p ≈ 0"
    const far = simCard({ ...s, groupA: [100, 101, 102, 103, 104, 105, 106, 107, 108, 109], groupB: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], reps: 1000 })
    expect(far.compare!.p).toBe('< 0.001')
    expect(far.compare!.sentence).toMatch(/In 0 of 1000 .* so p < 0\.001\./)
    const plant = simCard({ ...s, groupA: EXAMPLE_GROUP_A, groupB: EXAMPLE_GROUP_B })
    expect(plant.compare!.conclusion).toMatch(/statistically significant —/)
  })
  it('asks for data it does not have', () => {
    expect(simCard({ ...newSim('S', 1), pop: 'list' }).ok).toBe(false)
    expect(simCard({ ...newSim('S', 1), mode: 'compare' }).error).toMatch(/both groups/)
  })
  it('builds up under Play and stops at the end', () => {
    let shown = 0
    let done = false
    let frames = 0
    while (!done && frames < 10000) {
      const st = simPlayStep(shown, 1 / 60, 1, 1000)
      expect(st.shown).toBeGreaterThan(shown)
      shown = st.shown
      done = st.done
      frames++
    }
    expect(shown).toBe(1000)
    expect(frames).toBeGreaterThan(60)
  })
})

describe('the figures', () => {
  it('a normal panel shades, labels and keeps to its frame', () => {
    const f = normalFigure({ ...newNormal('N'), rule: true }, 0)
    expect(f.title.answer).toBe(' 0.8186')
    expect(f.prims.filter((p) => p.k === 'fill')).toHaveLength(1)
    expect(f.prims.filter((p) => p.k === 'bracket').map((p) => (p.k === 'bracket' ? p.text : ''))).toEqual(['68%', '95%', '99.7%'])
    expect(f.marks.map((m) => m.z)).toEqual(['z = −1.00', 'z = 2.00'])
    const box = panelBox(0)
    for (const p of f.prims) {
      if (p.k !== 'curve') continue
      for (const q of p.pts) {
        expect(q.x).toBeGreaterThanOrEqual(box.x0)
        expect(q.x).toBeLessThanOrEqual(box.x1)
      }
    }
    expect(f.ticks.filter((t) => t.text).map((t) => t.text)).toEqual(['40', '55', '70', '100', '115', '145', '160'])
  })
  it('panels stack downward, one per object', () => {
    const figs = statsFigures([newNormal('A'), newSim('B', 3)])
    expect(figs).toHaveLength(2)
    expect(figs[1].panel.y1).toBeLessThan(figs[0].panel.y0)
  })
  it('a dot plot meets the theoretical curve and builds up', () => {
    const s = newSim('S', 9)
    const all = simFigure(s, 0)
    const dotsOf = (f: typeof all): number => f.prims.reduce((n, p) => n + (p.k === 'dots' ? p.pts.length : 0), 0)
    const half = simFigure(s, 0, { shown: 500 })
    expect(dotsOf(half)).toBeLessThan(dotsOf(all))
    expect(half.title.question).toMatch(/^500 of 1000/)
    expect(all.prims.some((p) => p.k === 'curve' && p.ink === 'theory')).toBe(true)
    // the tallest stack stays inside the plot
    for (const p of all.prims) if (p.k === 'dots') for (const q of p.pts) expect(q.y).toBeLessThanOrEqual(all.plot.y1)
  })
  it('a randomisation panel marks the observed difference and the tail', () => {
    const f = simFigure({ ...newSim('S', 2), mode: 'compare', groupA: EXAMPLE_GROUP_A, groupB: EXAMPLE_GROUP_B }, 0)
    expect(f.marks[0].text).toBe('0.82')
    expect(f.prims.some((p) => p.k === 'chip' && /^p ≈/.test(p.text))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const META: DocMeta = { id: 'd1', name: 'Stats', createdAt: 1, modifiedAt: 2 }

function input(over: Partial<BoardInput> = {}): BoardInput {
  return {
    curves: [],
    styles: {},
    candidates: new Map(),
    exprSources: {},
    viewport: { center: { x: 0, y: 0 }, pxPerUnit: 60 },
    selectedId: null,
    mode: 'draw',
    ...over,
  }
}

describe('persistence', () => {
  it('stores settings and the seed — never a result', () => {
    const s = { ...newSim('S', 31337), mode: 'compare' as const, groupA: [1, 2], groupB: [3] }
    const stored = statToStored(s)
    expect(stored).toEqual({
      id: 'S', type: 'sim', mode: 'compare', pop: 'normal', mu: 100, sigma: 15, p: 0.5, stat: 'mean', n: 30, reps: 1000, seed: 31337, plot: 'dots',
      groupA: [1, 2], groupB: [3],
    })
    expect(JSON.stringify(stored)).not.toMatch(/diffs|values|extreme|"p":0\.\d{3}/)
  })
  it('round-trips through a document, and the results recompute identically', () => {
    const n = { ...newNormal('N1'), rule: true as const, zRow: false as const, mode: 'outside' as const }
    const sim = { ...newSim('S1', 555), pop: 'list' as const, list: [1, 0, 1, 1, 0], stat: 'proportion' as const, theory: false as const, observed: 0.4 }
    const json = serializeDoc(docFromBoard(META, input({ stats: [n, sim], selectedId: 'S1' }), 2))
    const res = deserializeDoc(json)
    expect(res.problems).toEqual([])
    expect(res.board!.stats).toEqual([n, sim])
    expect(res.board!.selectedId).toBe('S1')
    const again = res.board!.stats[1]
    if (again.type !== 'sim') throw new Error('kind')
    expect(Array.from((simResult(again) as { values: Float64Array }).values)).toEqual(Array.from((simResult(sim) as { values: Float64Array }).values))
    // and the same bytes the second time round
    expect(serializeDoc(docFromBoard(META, input({ stats: res.board!.stats, selectedId: 'S1' }), 2))).toBe(json)
  })
  it('a board without statistics serialises byte-for-byte as before', () => {
    const plain = serializeDoc(docFromBoard(META, input(), 2))
    expect(serializeDoc(docFromBoard(META, input({ stats: [] }), 2))).toBe(plain)
    expect(plain).not.toContain('stats')
    expect(deserializeDoc(plain).board!.stats).toEqual([])
  })
  it('repairs damaged values and reports them; drops what it cannot read', () => {
    const problems: string[] = []
    const out = storedToStat({ id: 'N', type: 'normal', mu: 'x', sigma: -2, mode: 'sideways', a: 1, b: 2, pct: 150, color: 'banana' }, problems)
    expect('stat' in out).toBe(true)
    if (!('stat' in out)) return
    expect(out.stat).toMatchObject({ mu: 0, sigma: 1, mode: 'between', pct: 90 })
    expect(problems.length).toBeGreaterThanOrEqual(5)
    expect(storedToStat({ id: 'Q', type: 'pie' })).toEqual({ error: 'its kind was unknown' })
    const sp: string[] = []
    const sim = storedToStat({ id: 'S', type: 'sim', n: 1e6, reps: 3, seed: -1, groupA: ['a', 2] }, sp)
    if (!('stat' in sim) || sim.stat.type !== 'sim') throw new Error('sim')
    expect(sim.stat.n).toBe(30)
    expect(sim.stat.reps).toBe(1000)
    expect(sim.stat.seed).toBe(1)
    expect(sim.stat.groupA).toEqual([2])
  })
  it('loads at most the board’s limit, and reports a duplicate id', () => {
    const many = Array.from({ length: MAX_STATS + 2 }, (_, i) => statToStored(newNormal(`N${i}`)))
    const json = serializeDoc(docFromBoard(META, input(), 2))
    const doc = JSON.parse(json)
    doc.board.stats = [...many, statToStored(newNormal('N0'))]
    const res = deserializeDoc(JSON.stringify(doc))
    expect(res.board!.stats).toHaveLength(MAX_STATS)
    expect(res.problems.join(' ')).toMatch(/Only the first 8 statistics objects/)
  })
})

// ---------------------------------------------------------------------------
// Reveal mode
// ---------------------------------------------------------------------------

function statsScene(): BoardScene {
  return {
    vp: { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 900, heightPx: 600 },
    theme: DARK_THEME,
    curves: [],
    styles: {},
    models: MODELS,
    analysis: null,
    stats: statsFigures([newNormal('N1'), { ...newSim('S1', 8), mode: 'compare', groupA: [1, 2, 3], groupB: [4, 5, 6] }]),
  }
}

function sceneReveal(state: RevealState): SceneReveal {
  const inv = buildInventory({ curves: [], crossings: [], after: [statKey('N1'), statKey('S1')] })
  return { hidden: (k) => isHidden(state, k), positions: true, pointKey: inv.answerKey, crossKey: inv.crossKey }
}

describe('reveal mode', () => {
  const ON: RevealState = { ...REVEAL_OFF, on: true }
  it('keys each statistics object once, in card order', () => {
    const inv = buildInventory({ curves: [], crossings: [], after: [statKey('N1'), statKey('S1')] })
    expect(inv.order).toEqual(['stat:N1:value', 'stat:S1:value'])
  })
  it('masks the answers and marks where they are', () => {
    const scene = statsScene()
    const out = applyReveal(scene, sceneReveal(ON))
    const n = out.stats![0]
    expect(n.title.answer).toBe(' ?')
    expect(n.marks.map((m) => m.z)).toEqual(['z = ?', 'z = ?'])
    expect(n.marks.map((m) => m.text)).toEqual(['85', '130'])
    expect(n.prims.some((p) => p.k === 'chip' && p.text === '0.8186')).toBe(false)
    const s = out.stats![1]
    expect(s.prims.some((p) => p.k === 'chip' && /p ≈ \?/.test(p.text))).toBe(true)
    expect(out.revealMarks!.map((m) => m.key)).toEqual(['stat:N1:value', 'stat:S1:value'])
  })
  it('reveals one at a time', () => {
    const scene = statsScene()
    const out = applyReveal(scene, sceneReveal(revealOne(ON, 'stat:N1:value')))
    expect(out.stats![0].title.answer).toBe(' 0.8186')
    expect(out.stats![1].title.answer).toBe('')
    expect(out.revealMarks!.map((m) => m.key)).toEqual(['stat:S1:value'])
  })
  it('a percentile hides its x', () => {
    const f = maskStats(normalFigure({ ...newNormal('P'), mode: 'percentile' }, 0))
    expect(f.title.answer).toBe(' x ≈ ?')
    expect(f.marks[0].text).toBe('?')
  })
})

// ---------------------------------------------------------------------------
// The board in words, and the figure on a worksheet
// ---------------------------------------------------------------------------

function model(stats: BoardInput['stats']) {
  const json = serializeDoc(docFromBoard(META, input({ stats }), 2))
  const m = docModelFromJSON(json)
  if (!m) throw new Error('load')
  return m
}

describe('describeGraph', () => {
  it('states a normal curve, its shading and (as an answer) the probability', () => {
    const m = model([{ ...newNormal('N1'), rule: true }])
    const key = describeBoard(m, { answers: true })
    expect(key.long).toContain('A normal curve with mean 100 and standard deviation 15 is drawn')
    expect(key.long).toContain('The area between x = 85 and x = 130 is shaded, for P(85 < X < 130)')
    expect(key.long).toContain('P(85 < X < 130) ≈ 0.8186; the z-scores are −1.00 and 2.00')
    expect(key.long).toContain('empirical rule')
    const student = describeBoard(m, { answers: false })
    expect(student.long).toContain('is shaded')
    expect(student.long).not.toContain('0.8186')
    expect(key.summary).not.toBe('Empty graph')
  })
  it('states a simulation and a randomisation test', () => {
    const m = model([newSim('S1', 3), { ...newSim('S2', 4), mode: 'compare', groupA: EXAMPLE_GROUP_A, groupB: EXAMPLE_GROUP_B, plot: 'hist' }])
    const d = describeBoard(m, { answers: true }).long
    expect(d).toContain('A dot plot shows 1000 simulated sample means from samples of 30 drawn from a normal population (μ = 100, σ = 15)')
    expect(d).toMatch(/95% margin of error is about \d/)
    expect(d).toContain('A histogram shows the difference in means after each of 1000 re-randomisations of two groups of 10 and 10')
    expect(d).toMatch(/so the p-value is about 0\.\d{3}/)
  })
  it('covers every kind through the adapter', () => {
    const lines = describeStats([
      { kind: 'normal', mu: 0, sigma: 1, mode: 'percentile', bounds: [1.2816], z: [1.2816], p: 0.9, pct: 90, rule: false },
      { kind: 'normal', mu: 0, sigma: 1, mode: 'outside', bounds: [-2, 2], z: [-2, 2], p: 0.0455, pct: 90, rule: false },
    ])
    expect(lines.map((l) => l.text).join(' ')).toContain('The 90th percentile is x ≈ 1.28')
    expect(lines.map((l) => l.text).join(' ')).toContain('below x = −2 and above x = 2')
    expect(lines.filter((l) => l.answer)).toHaveLength(2)
  })
})

describe('worksheets and exports', () => {
  const texts = (list: ReturnType<typeof recordFigure>): string[] =>
    list.items.filter((i): i is TextItem => i.t === 'text').map((t) => t.text)
  it('the key draws the panel with its answers', () => {
    const m = model([newNormal('N1')])
    const f = docFigure(m, { style: 'textbook', answers: true })
    expect(f.scene.stats).toHaveLength(1)
    const t = texts(recordFigure(f))
    expect(t).toContain('0.8186')
    expect(t.some((s) => s.includes('z = 2.00'))).toBe(true)
  })
  it('the student copy keeps the question and says "?"', () => {
    const m = model([newNormal('N1')])
    const t = texts(recordFigure(docFigure(m, { style: 'textbook', answers: false })))
    expect(t.join(' ')).not.toContain('0.8186')
    expect(t).toContain('z = ?')
    expect(t.some((s) => s.includes('P(85 < X < 130)'))).toBe(true)
  })
  it('a fitted export frames the panel', () => {
    const m0 = model([newNormal('N1'), newSim('S1', 1)])
    const m = { ...m0, settings: { ...m0.settings, fit: true } }
    const f = docFigure(m, { style: 'screen', answers: true })
    const half = f.scene.vp.heightPx / 2 / f.scene.vp.pxPerUnit
    // both panels are inside the framed window
    expect(f.scene.vp.center.y + half).toBeGreaterThan(panelBox(0).y1 - 0.01)
    expect(f.scene.vp.center.y - half).toBeLessThan(panelBox(1).y0 + 0.01)
  })
})

describe('masked chips', () => {
  it('keep how many were run, hide what was found', () => {
    const f = simFigure({ ...newSim('S', 2), mode: 'compare', groupA: EXAMPLE_GROUP_A, groupB: EXAMPLE_GROUP_B }, 0)
    const m = maskStats(f)
    const chip = m.prims.find((p) => p.k === 'chip' && /^p /.test(p.text))
    expect(chip && chip.k === 'chip' ? chip.text : '').toMatch(/^p [≈<] \? \(\? of 1000\)$/)
  })
})

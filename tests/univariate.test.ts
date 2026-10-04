// ============================================================================
// tests/univariate.test.ts — one-variable statistics (src/core/univariate.ts)
// and residual analysis / r in words (src/core/residuals.ts).
//
//   summary     mean, median, mode(s), SDs, range, IQR against hand-computed
//               values: odd n, even n, ties
//   quartiles   the TI-84 / AP method against known calculator outputs
//   outliers    the 1.5·IQR fences, the outliers, the whiskers
//   shape       symmetric / skewed right / skewed left / too few / constant
//   measures    which centre and spread suit the shape
//   bins        the default width, TI edge convention, dot-plot stacking
//   compare     the comparison sentences
//   excluding   the before / after and which measure moved most
//   residuals   pattern detection on a linear vs a quadratic data set
//   r           the strength / direction wording
// ============================================================================

import { describe, expect, it } from 'vitest'
import {
  compareSentence,
  defaultBinWidth,
  dotStacks,
  dotStep,
  exclusionEffect,
  fences,
  fiveNumber,
  histogramBins,
  measuresFor,
  modesOf,
  niceNearest,
  quartiles,
  recommend,
  shapeOf,
  summarize,
} from '../src/core/univariate'
import type { NamedSummary } from '../src/core/univariate'
import { CAUSATION, correlationWords, quadraticR2, residualPattern, signRuns } from '../src/core/residuals'
import { fitRegression } from '../src/core/data'

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps)
const fmt = (v: number) => String(Number(v.toFixed(2)))
const named = (name: string, values: number[]): NamedSummary => {
  const s = summarize(values)
  return { name, s, shape: shapeOf(s), fences: fences(s) }
}

describe('summary statistics', () => {
  it('odd n: 1 … 9', () => {
    const s = summarize([5, 3, 9, 1, 7, 2, 8, 4, 6])
    expect(s.n).toBe(9)
    expect(s.sorted).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    close(s.mean, 5)
    close(s.sum, 45)
    close(s.median, 5)
    close(s.q1, 2.5)
    close(s.q3, 7.5)
    close(s.iqr, 5)
    close(s.min, 1)
    close(s.max, 9)
    close(s.range, 8)
    close(s.sdPop, Math.sqrt(60 / 9)) // 2.5820
    close(s.sdSample, Math.sqrt(60 / 8)) // 2.7386
    expect(s.modes).toEqual([])
    expect(fiveNumber(s)).toEqual([1, 2.5, 5, 7.5, 9])
  })
  it('even n with ties: 2, 4, 4, 4, 5, 5, 7, 9', () => {
    const s = summarize([2, 4, 4, 4, 5, 5, 7, 9])
    close(s.mean, 5)
    close(s.sdPop, 2) // the textbook example: σ = 2
    close(s.sdSample, Math.sqrt(32 / 7)) // 2.1381
    close(s.median, 4.5)
    close(s.q1, 4)
    close(s.q3, 6)
    close(s.iqr, 2)
    expect(s.modes).toEqual([4])
    expect(s.modeCount).toBe(3)
    close(s.range, 7)
  })
  it('two modes, and no mode when every value repeats equally', () => {
    expect(modesOf([1, 1, 2, 2, 3])).toEqual({ modes: [1, 2], count: 2 })
    expect(modesOf([1, 1, 2, 2]).modes).toEqual([])
    expect(modesOf([1, 2, 3]).modes).toEqual([])
  })
  it('one value, and none', () => {
    const one = summarize([4])
    expect([one.mean, one.median, one.q1, one.q3, one.iqr, one.sdPop]).toEqual([4, 4, 4, 4, 0, 0])
    expect(Number.isNaN(one.sdSample)).toBe(true)
    const none = summarize([])
    expect(none.n).toBe(0)
    expect(Number.isNaN(none.mean)).toBe(true)
  })
  it('ignores non-finite values and sums 0.1s without drift', () => {
    const s = summarize([0.1, 0.1, 0.1, NaN, Infinity, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1])
    expect(s.n).toBe(10)
    expect(s.sum).toBe(1)
  })
})

describe('quartiles by the TI-84 / AP method (median excluded from the halves)', () => {
  // Values a TI-84's 1-Var Stats prints for these lists.
  const TI: [number[], number, number, number][] = [
    [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, 5.5, 8],
    [[1, 2, 3, 4, 5, 6, 7, 8, 9], 2.5, 5, 7.5],
    [[6, 7, 15, 36, 39, 40, 41, 42, 43, 47, 49], 15, 40, 43],
    [[7, 15, 36, 39, 40, 41], 15, 37.5, 40],
    [[1, 2, 3, 4, 5], 1.5, 3, 4.5],
    [[3, 7], 3, 5, 7],
    [[12, 15, 15, 18, 21, 21, 21, 30], 15, 19.5, 21],
    [[2.5, 3.1, 4.7, 5.0, 6.2, 7.8, 8.4], 3.1, 5, 7.8],
  ]
  it.each(TI)('%j → Q1 %d, median %d, Q3 %d', (xs, q1, med, q3) => {
    const s = summarize(xs)
    close(s.q1, q1)
    close(s.median, med)
    close(s.q3, q3)
  })
  it('works on the sorted list directly', () => {
    expect(quartiles([1, 2, 3, 4, 5, 6, 7])).toEqual({ q1: 2, q3: 6 })
  })
})

describe('outliers by the 1.5·IQR fences', () => {
  it('flags a low score and stops the whisker at the last value inside', () => {
    const s = summarize([72, 75, 68, 80, 77, 74, 71, 79, 76, 73, 70, 78, 75, 74, 41, 77, 72, 76, 74, 79])
    close(s.q1, 72)
    close(s.q3, 77)
    const f = fences(s)
    close(f.lower, 64.5)
    close(f.upper, 84.5)
    expect(f.outliers).toEqual([41])
    expect(f.whiskerLo).toBe(68)
    expect(f.whiskerHi).toBe(80)
  })
  it('a value exactly on a fence is not an outlier', () => {
    // Q1 = 2, Q3 = 6, IQR 4: fences −4 and 12
    const f = fences(summarize([1, 2, 3, 4, 5, 6, 7, 12]))
    close(f.upper, 12.5)
    expect(f.outliers).toEqual([])
    const g = fences(summarize([0, 2, 2, 3, 4, 6, 6, 12]))
    close(g.upper, 12)
    expect(g.outliers).toEqual([])
    expect(fences(summarize([0, 2, 2, 3, 4, 6, 6, 12.01])).outliers).toEqual([12.01])
  })
  it('outliers on both sides', () => {
    const f = fences(summarize([-50, 10, 11, 12, 13, 14, 15, 16, 80]))
    expect(f.outliers).toEqual([-50, 80])
    expect([f.whiskerLo, f.whiskerHi]).toEqual([10, 16])
  })
})

describe('shape', () => {
  const right = [1, 2, 2, 3, 3, 3, 4, 4, 5, 6, 8, 12, 20]
  it('skewed right: mean above median and the upper quartile stretched', () => {
    const sh = shapeOf(summarize(right))
    expect(sh.kind).toBe('right')
    expect(sh.words).toBe('appears skewed right')
    expect(sh.meanMedian).toBeGreaterThan(0.15)
    expect(sh.quartileSkew).toBeGreaterThan(0.2)
    expect(sh.reason).toMatch(/mean 5\.615 > median 4/)
  })
  it('skewed left (the mirror image)', () => {
    expect(shapeOf(summarize(right.map((v) => -v))).kind).toBe('left')
  })
  it('roughly symmetric', () => {
    expect(shapeOf(summarize([1, 2, 3, 4, 5, 6, 7, 8, 9])).words).toBe('appears roughly symmetric')
    expect(shapeOf(summarize([85, 78, 92, 70, 88, 81, 95, 74, 83, 79, 90, 68, 86, 82, 77, 91, 73, 84, 80, 87])).kind).toBe('symmetric')
  })
  it('one far value on a symmetric bulk: roughly symmetric, with an outlier (so the median and IQR)', () => {
    // the outlier inflates the SD as much as it pulls the mean: d ≈ 0.26, quartiles even
    const s = summarize([1, 2, 3, 4, 5, 6, 7, 8, 9, 40])
    const sh = shapeOf(s)
    expect(sh.kind).toBe('symmetric')
    expect(fences(s).outliers).toEqual([40])
    expect(recommend(s, sh, fences(s)).use).toBe('median-iqr')
  })
  it('one check alone decides only when strong; the two disagreeing is no skew', () => {
    const base = summarize([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
    const at = (o: Partial<typeof base>) => shapeOf({ ...base, ...o }).kind
    // mean = median: the quartile skew alone must reach 0.4
    expect(at({ mean: 50, median: 50, sdSample: 10, q1: 45, q3: 65, iqr: 20 })).toBe('right') // q = 0.5
    expect(at({ mean: 50, median: 50, sdSample: 10, q1: 45, q3: 58, iqr: 13 })).toBe('symmetric') // q ≈ 0.23
    // quartiles even: the mean–median lean alone must reach 0.3 SD
    expect(at({ mean: 46, median: 50, sdSample: 10, q1: 45, q3: 55, iqr: 10 })).toBe('left') // d = −0.4
    expect(at({ mean: 48, median: 50, sdSample: 10, q1: 45, q3: 55, iqr: 10 })).toBe('symmetric') // d = −0.2
    // both lean, opposite ways
    expect(at({ mean: 53, median: 50, sdSample: 10, q1: 40, q3: 54, iqr: 14 })).toBe('symmetric')
  })
  it('too few values, and no spread', () => {
    expect(shapeOf(summarize([1, 2, 3])).kind).toBe('few')
    expect(shapeOf(summarize([5, 5, 5, 5, 5])).kind).toBe('constant')
  })
})

describe('which measures to use (S-ID.2)', () => {
  it('median and IQR for skewed data or outliers; mean and SD for symmetric', () => {
    const sk = summarize([1, 2, 2, 3, 3, 3, 4, 4, 5, 6, 8, 12, 20])
    expect(recommend(sk, shapeOf(sk), fences(sk)).use).toBe('median-iqr')
    const sym = summarize([1, 2, 3, 4, 5, 6, 7, 8, 9])
    const r = recommend(sym, shapeOf(sym), fences(sym))
    expect(r.use).toBe('mean-sd')
    expect(r.sentence).toMatch(/mean and standard deviation/)
    const out = summarize([10, 11, 12, 13, 14, 15, 16, 17, 60])
    expect(recommend(out, shapeOf(out), fences(out)).sentence).toMatch(/outlier/)
  })
  it('a comparison uses the median and IQR as soon as one set calls for them', () => {
    expect(measuresFor([named('A', [1, 2, 3, 4, 5, 6, 7, 8, 9]), named('B', [2, 3, 4, 5, 6, 7, 8, 9, 10])])).toBe('mean-sd')
    expect(measuresFor([named('A', [1, 2, 3, 4, 5, 6, 7, 8, 9]), named('B', [1, 2, 2, 3, 3, 3, 4, 4, 5, 6, 8, 12, 20])])).toBe('median-iqr')
  })
})

describe('comparison sentences', () => {
  const p1 = [72, 75, 68, 80, 77, 74, 71, 79, 76, 73, 70, 78, 75, 74, 41, 77, 72, 76, 74, 79]
  const p2 = [85, 78, 92, 70, 88, 81, 95, 74, 83, 79, 90, 68, 86, 82, 77, 91, 73, 84, 80, 87]
  it('two sets: center and spread, the higher one first', () => {
    const t = compareSentence([named('Period 1', p1), named('Period 2', p2)], fmt)
    expect(t).toMatch(/^Period 2 has a higher median \(82\.5 vs 74\.5\) and a larger IQR \(10 vs 5\) than Period 1/)
    expect(t).toMatch(/Compared by the median and IQR/)
  })
  it('symmetric sets compare by mean and SD', () => {
    const t = compareSentence([named('A', [1, 2, 3, 4, 5, 6, 7, 8, 9]), named('B', [3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7])], fmt)
    expect(t).toMatch(/^B has the same mean \(5\) and a smaller standard deviation \(1\.37 vs 2\.74\) than A/)
    expect(t).toMatch(/more consistent/)
  })
  it('three sets are ranked', () => {
    const t = compareSentence([named('A', [1, 2, 3, 4, 5, 6, 7, 8, 9]), named('B', [11, 12, 13, 14, 15, 16, 17, 18, 19]), named('C', [5, 6, 7, 8, 9, 10, 11, 12, 13])], fmt)
    expect(t).toMatch(/^Means from highest: B 15 > C 9 > A 5\./)
  })
  it('nothing to compare', () => {
    expect(compareSentence([named('A', [1, 2, 3])], fmt)).toBe('')
    expect(compareSentence([named('A', [1, 2, 3]), named('B', [])], fmt)).toBe('')
  })
})

describe('leaving values out (S-ID.3)', () => {
  const p1 = [72, 75, 68, 80, 77, 74, 71, 79, 76, 73, 70, 78, 75, 74, 41, 77, 72, 76, 74, 79]
  it('the before / after of dropping the outlier: the SD and mean move, the median and IQR barely', () => {
    const keep = p1.map((v) => v !== 41)
    const e = exclusionEffect(p1, keep, fmt)
    expect(e.removed).toEqual([41])
    close(e.before.mean, 73.05)
    close(e.after.mean, 1420 / 19)
    close(e.before.median, 74.5)
    close(e.after.median, 75)
    close(e.before.iqr, 5)
    close(e.after.iqr, 5)
    expect(e.ranked.slice(0, 2)).toEqual(['sd', 'mean'])
    expect(e.sentence).toMatch(/^Leaving out 41 lowered the SD \(Sx\) from \d+\.\d+ to \d+\.\d+ and raised the mean from 73\.05 to 74\.74\./)
    expect(e.sentence).toMatch(/The median and IQR barely moved\./)
    expect(e.sentence).toMatch(/not resistant/)
    const iqr = e.rows.find((r) => r.key === 'iqr')!
    expect(iqr.change).toBe(0)
  })
  it('nothing left out; everything left out', () => {
    expect(exclusionEffect([1, 2, 3], [true, true, true], fmt).sentence).toBe('Nothing is left out.')
    expect(exclusionEffect([1, 2], [false, false], fmt).sentence).toMatch(/nothing to summarize/)
  })
})

describe('bins and stacks', () => {
  it('a nice width nearest the raw one', () => {
    expect(niceNearest(6.5)).toBe(5)
    expect(niceNearest(8)).toBe(10)
    expect(niceNearest(0.23)).toBe(0.25)
    expect(niceNearest(1.4)).toBe(1)
  })
  it('the default bin width: about Sturges’ number of bins', () => {
    const scores = [72, 75, 68, 80, 77, 74, 71, 79, 76, 73, 70, 78, 75, 74, 41, 77, 72, 76, 74, 79]
    expect(defaultBinWidth(scores)).toBe(5)
    expect(defaultBinWidth([1, 2, 3, 4, 5, 6])).toBe(1) // whole numbers get whole bins
    expect(defaultBinWidth([0.12, 0.35, 0.4, 0.51, 0.77, 0.9])).toBe(0.2)
  })
  it('bins start on a multiple of the width; an edge value goes right (TI-84)', () => {
    const b = histogramBins([1, 2.5, 3, 5, 5, 7.9, 10], 2.5)
    expect(b.start).toBe(0)
    expect(b.counts).toEqual([1, 2, 2, 1, 1])
    const c = histogramBins([41, 62, 65, 70], 10)
    expect(c.start).toBe(40)
    expect(c.counts).toEqual([1, 0, 2, 1])
    // 0.3 is itself a multiple of 0.3; floating edges (0.9 − 0.3 = 0.6000000000000001) land right
    expect(histogramBins([0.3, 0.6, 0.9], 0.3)).toEqual({ start: 0.3, width: 0.3, counts: [1, 1, 1] })
  })
  it('a bin can start lower than the data (shared bins for several sets)', () => {
    expect(histogramBins([12, 14], 5, 0)).toEqual({ start: 0, width: 5, counts: [0, 0, 2] })
  })
  it('dot plots stack equal values; fine data stacks to a nice step', () => {
    expect(dotStep([72, 75, 41, 80])).toBe(1)
    expect(dotStep([1.5, 2.25, 2])).toBe(0.01) // the data’s own resolution: 75 steps across
    expect(dotStep([1.5, 2.25, 3])).toBe(0.025) // 150 steps: about range / 60 instead
    // a stack sits at its values' mean, never at the rounded step
    expect(dotStacks([2.25, 2.26], 0.025)).toEqual([{ at: 2.255, idx: [0, 1] }])
    expect(dotStep([0, 1000, 37, 512])).toBe(20)
    const st = dotStacks([3, 1, 3, 2, 3], 1)
    expect(st).toEqual([
      { at: 1, idx: [1] },
      { at: 2, idx: [3] },
      { at: 3, idx: [0, 2, 4] },
    ])
  })
})

describe('residual plots (S-ID.6b)', () => {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  const noise = [0.5, -0.3, 0.8, -0.6, 0.2, -0.9, 0.4, 0.7, -0.5, 0.3, -0.8, 0.1]
  it('a linear data set: no clear pattern, so a linear model appears appropriate', () => {
    const ys = xs.map((x, i) => 2 * x + 3 + noise[i])
    const fit = fitRegression('linear', xs, ys)
    const p = residualPattern(xs, fit.residuals)
    expect(p.verdict).toBe('none')
    expect(p.curvature).toBeLessThan(0.4)
    expect(p.sentence).toMatch(/no clear pattern.*a linear model appears appropriate/)
  })
  it('a quadratic data set: a curved pattern, so a linear model may not be appropriate', () => {
    const ys = xs.map((x, i) => x * x + noise[i])
    const fit = fitRegression('linear', xs, ys)
    const p = residualPattern(xs, fit.residuals)
    expect(p.verdict).toBe('curved')
    expect(p.curvature).toBeGreaterThan(0.9)
    expect(p.runs).toBe(3) // + then − then +
    expect(p.runsZ).toBeLessThan(-1.28)
    expect(p.sentence).toMatch(/curved pattern.*a linear model may not be appropriate/)
  })
  it('the quadratic model on the quadratic data has no pattern left', () => {
    const ys = xs.map((x, i) => x * x + noise[i])
    const fit = fitRegression('quadratic', xs, ys)
    expect(residualPattern(xs, fit.residuals, 'this quadratic model').sentence).toMatch(/this quadratic model appears appropriate/)
  })
  it('exponential growth fitted by a line is curved too', () => {
    const ex = [0, 1, 2, 3, 4, 5, 6, 7]
    const fit = fitRegression('linear', ex, ex.map((x) => 3 * 2 ** x))
    expect(residualPattern(ex, fit.residuals).verdict).toBe('curved')
  })
  it('too few points: no verdict', () => {
    expect(residualPattern([1, 2, 3, 4, 5], [1, -1, 1, -1, 1]).verdict).toBe('few')
  })
  it('the runs test and the curvature measure', () => {
    const r = signRuns([1, 2, 3, 4, 5, 6], [1, 1, 1, -1, -1, -1])
    expect(r.runs).toBe(2)
    close(r.expected, 4)
    expect(r.z).toBeLessThan(-1.5)
    close(quadraticR2([-2, -1, 0, 1, 2], [4, 1, 0, 1, 4]), 1)
  })
  it('a fan is mentioned without being called a curve', () => {
    const fx = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const res = fx.map((x, i) => (i % 2 === 0 ? 1 : -1) * x * 0.5)
    const p = residualPattern(fx, res)
    expect(p.verdict).toBe('none')
    expect(p.fan).toBe('out')
    expect(p.sentence).toMatch(/spread out as x increases/)
  })
})

describe('r in words (S-ID.8)', () => {
  it('strength by the AP / NC thresholds, and direction', () => {
    expect(correlationWords(0.94).phrase).toBe('a strong positive linear association')
    expect(correlationWords(0.8).strength).toBe('strong')
    expect(correlationWords(0.7999).strength).toBe('moderate')
    expect(correlationWords(-0.62).phrase).toBe('a moderate negative linear association')
    expect(correlationWords(0.5).strength).toBe('moderate')
    expect(correlationWords(-0.3).phrase).toBe('a weak negative linear association')
    expect(correlationWords(0.1).phrase).toBe('little or no linear association')
  })
  it('the sentence is cautious and in context', () => {
    expect(correlationWords(0.9412, '0.9412', 'study hours', 'score').sentence).toBe(
      'r = 0.9412 suggests a strong positive linear association: as study hours increases, score tends to increase.',
    )
    expect(correlationWords(-0.85).sentence).toMatch(/tends to decrease/)
    expect(CAUSATION).toMatch(/not causation/)
  })
})

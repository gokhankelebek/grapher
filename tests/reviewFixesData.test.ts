// ============================================================================
// tests/reviewFixesData.test.ts — regression tests for the data-features
// review (statistics, residuals, the table of values, probability): one block
// per finding, each pinning the corrected mathematics.
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { DARK_THEME } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { parseExpression } from '../src/core/parse'
import { fitRegression } from '../src/core/data'
import { EXACT_FIT_SENTENCE, exactFit, residualPattern } from '../src/core/residuals'
import { cell, overtake, polynomialCoeffs, scanCrossings, plainGap, tablePattern, tableXs, valueTable } from '../src/core/valueTable'
import { classify, commonPeriod, diffClass, isExponential, polyDegree } from '../src/core/growth'
import type { TableContext } from '../src/ui/valueTableLinks'
import { compareFunctions, evaluateTyped, formulaOf, polyOf, tableKeysOf, tableOverlays, tablePanel } from '../src/ui/valueTableLinks'
import { defaultBinWidth, histogramWidth, modesOf } from '../src/core/univariate'
import type { BagColor } from '../src/core/probPersist'
import { MAX_COLORS, MAX_DRAWS, MAX_TREE_OUTCOMES, MAX_TREE_STAGES, newProb } from '../src/core/probPersist'
import type { Frac } from '../src/core/probability'
import { ONE, add, bagTree, eq, frac, fracText, manualTree, mul, parseEvent, sum, treeEvent, treePresets, ZERO } from '../src/core/probability'
import type { BoardProb } from '../src/core/probPersist'
import { probCard, probFigure, settleProb } from '../src/ui/probLinks'
import { arcSweep } from '../src/render/vectorCtx'
import type { DisplayList, Seg } from '../src/render/vectorCtx'
import { toSvg } from '../src/render/vectorSvg'
import { toPdfString } from '../src/render/vectorPdf'
import { toTikz } from '../src/render/vectorTikz'
import type { BoardInput, DocMeta } from '../src/core/persist'
import { docFromBoard, serializeDoc } from '../src/core/persist'
import { docFigure, docModelFromJSON, recordFigure } from '../src/ui/docScene'
import { emptyViewStates, pruneViewStates, restoreViewStates } from '../src/ui/curveViews'
import { REVEAL_OFF, applyReveal, buildInventory, isHidden, tableKey } from '../src/ui/reveal'
import type { RevealState, SceneReveal } from '../src/ui/reveal'
import type { BoardScene } from '../src/ui/renderBoard'
import type { BoardDataPlot } from '../src/core/statsPersist'
import { dataPlotCard } from '../src/ui/dataPlotLinks'
import type { BoardData } from '../src/ui/dataLinks'
import { dataCard, makeFitCache } from '../src/ui/dataLinks'
import { residualFigure, residualInfo } from '../src/ui/residualLinks'

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const models: Record<string, ModelSpec> = { ...MODELS }
let n = 0

function typed(id: string, src: string): FittedCurve {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(src)
  const modelId = `expr_rf${++n}`
  models[modelId] = o.plot.makeModel(modelId)
  return {
    id,
    modelId,
    params: o.plot.defaultParams.slice(),
    kind: o.plot.kind,
    domain: o.plot.domain,
    color: '#4f9cf9',
    strokeWidth: 2.5,
    visible: true,
    error: 0,
  }
}

/** A board of typed curves, letters a, b, c … in order. */
function board(srcs: string[]): { C: FittedCurve[]; ctx: TableContext } {
  const C = srcs.map((s, i) => typed(`c${i}`, s))
  const letters = Object.fromEntries(C.map((c, i) => [c.id, 'abcdefgh'[i]]))
  const sources = Object.fromEntries(C.map((c, i) => [c.id, srcs[i]]))
  return { C, ctx: { curves: C, models, letters, sources } }
}

const compareOf = (f: string, g: string, start: string, nRows = 6) => {
  const { C, ctx } = board([f, g])
  return tablePanel(C[0], { start, step: '1', n: nRows, vs: C[1].id }, ctx)!.compare!
}

// ---------------------------------------------------------------------------
// 1. Residuals of an exact fit are 0, not a pattern
// ---------------------------------------------------------------------------

describe('1 · an exact fit: every residual is 0', () => {
  it('288 exactly linear textbook sets all read "fits every point exactly"', () => {
    const grids = [
      [1, 2, 3, 4, 5, 6, 7, 8],
      [0, 0.5, 1, 1.5, 2, 2.5, 3],
      [-3, -1, 2, 4, 7, 11, 12, 15, 20],
      [10, 20, 30, 40, 50, 60],
    ]
    let count = 0
    for (const m of [0.5, 1.7, -2.3, 3, 0.1, -0.7, 12.5, 0.01, 4.4, -9, 1 / 3, 2 / 7]) {
      for (const b of [-2.9, 0, 1, 7.25, 100, -0.3]) {
        for (const xs of grids) {
          const ys = xs.map((x) => m * x + b)
          const fit = fitRegression('linear', xs, ys)
          const p = residualPattern(xs, fit.residuals, 'a linear model', ys)
          expect(p.verdict).toBe('none')
          expect(p.exact).toBe(true)
          expect(p.fan).toBeNull()
          expect(p.curvature).toBe(0)
          expect(p.sentence).toBe(EXACT_FIT_SENTENCE)
          count++
        }
      }
    }
    expect(count).toBe(288)
  })
  it('exact quadratics fitted by a quadratic are exact too; noisy data still gets its verdict', () => {
    const xs = [0, 1, 2, 3, 4, 5, 6, 7]
    for (const [a, b, c] of [[1, 0, 0], [0.5, -3, 2], [-2, 7, 0.25], [3.3, 1.1, -4]]) {
      const ys = xs.map((x) => a * x * x + b * x + c)
      const fit = fitRegression('quadratic', xs, ys)
      expect(residualPattern(xs, fit.residuals, 'this quadratic model', ys).sentence).toBe(EXACT_FIT_SENTENCE)
    }
    const noisy = xs.map((x, i) => x * x + [0.4, -0.4, 0.4, -0.4, 0.4, -0.4, 0.4, -0.4][i])
    const lin = fitRegression('linear', xs, noisy)
    expect(exactFit(lin.residuals, noisy)).toBe(false)
    expect(residualPattern(xs, lin.residuals, 'a linear model', noisy).verdict).toBe('curved')
  })
  it('the card and the residual plot: dots on the zero line, a sane scale', () => {
    const XS = [1, 2, 3, 4, 5, 6, 7, 8]
    const data: BoardData = {
      id: 'T1',
      name: 'Exact',
      xLabel: 'x',
      yLabel: 'y',
      color: '#22c55e',
      visible: true,
      rows: XS.map((x) => ({ x: String(x), y: String(1.7 * x - 2.9) })),
      regressions: [{ id: 'r1', kind: 'linear', curveId: 'c1', digits: 4, residuals: false, residualPlot: true }],
    }
    const fit = makeFitCache()
    const card = dataCard(data, {}, new Set(['c1']), fit)
    expect(card.regressions[0].pattern!.sentence).toBe(EXACT_FIT_SENTENCE)
    const info = residualInfo(data, data.regressions[0], fit)!
    expect(info.pattern.exact).toBe(true)
    const figure = residualFigure(data, new Set(['c1']), fit)!
    const dots = figure.prims.find((p) => p.k === 'dots') as { pts: { y: number }[] }
    const zero = figure.prims.find((p) => p.k === 'curve') as { pts: { y: number }[] }
    for (const d of dots.pts) expect(d.y).toBeCloseTo(zero.pts[0].y, 9)
    // tick labels are short numbers, not 16 decimals of rounding noise
    for (const t of figure.yTicks ?? []) expect(t.text.length).toBeLessThan(8)
    expect(figure.title.answer).toBe(' · exact fit')
  })
})

// ---------------------------------------------------------------------------
// 2. "Stays ahead for good" only when the growth classes prove it
// ---------------------------------------------------------------------------

describe('2 · compare: who is ahead for good', () => {
  it('1.001ˣ vs x: the textbook F-LE.3 point near x ≈ 9123, found however far it is', () => {
    const c = compareOf('y = 1.001^x', 'y = x', '1')
    expect(c.sentence).toMatch(/^1\.001ˣ passes x after x ≈ 912\d\.\d\d and stays ahead for good \(an exponential with base > 1 outgrows every power of x\)$/)
  })
  it('ln x vs x^0.1: x^0.1 wins near 3.4 × 10¹⁵', () => {
    const c = compareOf('y = ln(x)', 'y = x^0.1', '1')
    expect(c.sentence).toMatch(/^x\^0\.1 passes ln\(x\) after x ≈ 3\.4\d × 10¹⁵ and stays ahead for good \(a power of x outgrows every power of ln x\)$/)
  })
  it('x^100 vs 1.01ˣ: the exponential wins (both overflow a double long before)', () => {
    const c = compareOf('y = x^100', 'y = 1.01^x', '0')
    expect(c.sentence).toMatch(/^1\.01ˣ passes x\^100 after x ≈ 1\.1\d × 10⁵ and stays ahead for good/)
  })
  it('sin x vs 0.5: no winner, and the crossings are capped', () => {
    const c = compareOf('y = sin(x)', 'y = 0.5', '1')
    expect(c.sentence).toMatch(/^Neither stays ahead/)
    expect(c.sentence).not.toMatch(/for good/)
    expect(c.crossings).toMatch(/^They cross infinitely often/)
    expect(c.crossings!.length).toBeLessThan(160)
    // x·sin x vs 1: oscillation with a growing envelope
    const o = compareOf('y = x*sin(x)', 'y = 1', '0')
    expect(o.sentence).toMatch(/^Neither stays ahead/)
    expect(o.crossings).toMatch(/^They cross infinitely often/)
  })
  it('the growth classes behind it', () => {
    const F = (src: string) => {
      const o = parseExpression(src)
      if (!o.ok) throw new Error(src)
      return { node: o.plot.makeModel('t').formula!, params: o.plot.defaultParams }
    }
    const lead = (f: string, g: string): number => {
      const h = diffClass(F(f), F(g))
      if (!h || h.k !== 'sum' || h.terms.length === 0) throw new Error(`${f} vs ${g}`)
      return Math.sign(h.terms[0].c)
    }
    expect(lead('y = 2^x', 'y = x^50')).toBe(1)
    expect(lead('y = x^0.01', 'y = ln(x)^3')).toBe(1)
    expect(lead('y = 3x^2 - 100x', 'y = 2x^2 + 1000')).toBe(1)
    expect(lead('y = x^2 + 2x', 'y = x^2 + 3x')).toBe(-1) // the next term decides
    expect(lead('y = 0.5^x', 'y = 0.001')).toBe(-1) // base < 1 decays below a constant
    expect(lead('y = 1/(x - 3)', 'y = 1')).toBe(-1)
    expect(diffClass(F('y = sin(x)'), F('y = 0'))!.k).toBe('osc')
    const same = diffClass(F('y = x^2 - 2x - 8'), F('y = (x + 2)(x - 4)'))!
    expect(same.k === 'sum' && same.terms.length === 0 && same.exact).toBe(true)
    expect(commonPeriod([F('y = sin(2x)'), F('y = cos(3x) + 1')])).toBeCloseTo(2 * Math.PI, 9)
    expect(commonPeriod([F('y = sin(x)'), F('y = x')])).toBeNull()
    expect(classify(F('y = x^x'))).toBeNull()
  })
  it('unknown growth: only the table’s window, never "for good"', () => {
    // a restricted curve's formula is not the whole function
    const c = compareOf('y = x^2 {x >= 0}', 'y = x', '-2')
    expect(c.sentence).toMatch(/the end of the table/)
    expect(c.sentence).not.toMatch(/for good/)
  })
  it('the same function says so, and lists no crossings', () => {
    const c = compareOf('y = x^2 - 2x - 8', 'y = (x+2)(x-4)', '0')
    expect(c.sentence).toBe('x² − 2x − 8 and (x + 2)(x − 4) are the same function: they agree for every x')
    expect(c.crossings).toBeNull()
  })
  it('a long list of crossings is capped: first 5 and how many more', () => {
    const f = (x: number) => Math.sin(x)
    const g = () => 0.5
    const o = compareFunctions(f, g, null, null, 0, 300)
    expect(o.kind).toBe('window')
    expect(o.crossings.length).toBeGreaterThan(50)
    const { C, ctx } = board(['y = sin(x)', 'y = 0.5'])
    // sin is periodic: its compare names it as such instead of listing 300 crossings
    const p = tablePanel(C[0], { start: '0', step: '50', n: 7, vs: C[1].id }, ctx)!
    expect(p.compare!.crossings!.split('x ≈').length - 1).toBeLessThanOrEqual(5)
  })
})

// ---------------------------------------------------------------------------
// 3. A pole is not a crossing
// ---------------------------------------------------------------------------

describe('3 · a vertical asymptote is not a crossing', () => {
  it('1/(x − 3) vs 1 crosses once, at x = 4', () => {
    const c = compareOf('y = 1/(x-3)', 'y = 1', '0')
    expect(c.sentence).toBe('1 passes 1/(x − 3) after x = 4 and stays ahead for good (1/(x − 3) tends to 0)')
    expect(c.crossings).toBeNull()
    const r = overtake((x) => 1 / (x - 3), () => 1, 0)!
    expect(r.crossings).toHaveLength(1)
    expect(r.crossings[0]).toBeCloseTo(4, 9)
  })
  it('1/x vs 0 never meet: ahead only after the pole', () => {
    const c = compareOf('y = 1/x', 'y = 0', '-2')
    expect(c.sentence).toMatch(/^1\/x is above 0 for every x after x = 0/)
    const r = overtake((x) => 1 / x, () => 0, -2.3)!
    expect(r.crossings).toEqual([])
  })
  it('the scanner keeps a crossing only where the two values meet', () => {
    const s = scanCrossings(plainGap((x) => Math.tan(x), () => 0), Array.from({ length: 501 }, (_, i) => -1 + i * 0.01))
    // tan crosses 0 at 0 and π; its pole at π/2 is a flip, not a crossing
    expect(s.crossings.map((x) => Number(x.toFixed(6)))).toEqual([0, Number(Math.PI.toFixed(6))])
    expect(s.flips).toHaveLength(1)
    expect(s.flips[0]).toBeCloseTo(Math.PI / 2, 6)
  })
})

// ---------------------------------------------------------------------------
// 4. Restrictions are respected by the table and by Evaluate
// ---------------------------------------------------------------------------

describe('4 · a typed restriction: values outside it are undefined', () => {
  it('y = x² {x ≥ 0} from −2: −2 and −1 are undefined, and no dot is drawn', () => {
    const { C, ctx } = board(['y = x^2 {x >= 0}'])
    const p = tablePanel(C[0], { start: '-2', n: 5 }, ctx)!
    expect(p.rows.map((r) => r.y.text)).toEqual(['undefined', 'undefined', '0', '1', '4'])
    for (const t of ['-2', 'a(-2)']) {
      const e = evaluateTyped(t, C[0], ctx)!
      expect(e.ok && e.text).toBe('a(−2) is undefined')
      expect(e.ok && e.point).toBeNull()
    }
    expect(tableOverlays(C, { [C[0].id]: { ev: '-2' } }, ctx)).toEqual([])
  })
  it('y = 3x + 2 {x > −1}: no "linear" from rows outside the domain', () => {
    const { C, ctx } = board(['y = 3x+2 {x > -1}'])
    const p = tablePanel(C[0], { start: '-2', n: 5, cols: ['d1'] }, ctx)!
    expect(p.rows.slice(0, 2).map((r) => r.y.text)).toEqual(['undefined', 'undefined'])
    expect(p.pattern).toBeNull()
  })
  it('an excluded end is excluded: √x {x > 1} at 1, x² {0 < x < 5} at 0 and 5', () => {
    const { C, ctx } = board(['y = sqrt(x) {x > 1}', 'y = x^2 {0 < x < 5}'])
    expect(tablePanel(C[0], { start: '1', n: 2 }, ctx)!.rows[0].y.text).toBe('undefined')
    const q = tablePanel(C[1], { start: '0', n: 6 }, ctx)!.rows.map((r) => r.y.text)
    expect(q).toEqual(['undefined', '1', '4', '9', '16', 'undefined'])
  })
  it('odd roots of negatives keep their values', () => {
    const { C, ctx } = board(['y = x^(1/3)'])
    expect(tablePanel(C[0], { start: '-8', step: '4', n: 3 }, ctx)!.rows.map((r) => r.y.text)).toEqual(['−2', '−1.587401', '0'])
  })
})

// ---------------------------------------------------------------------------
// 5. ln 0 is undefined, and Δy beside it is blank
// ---------------------------------------------------------------------------

describe('5 · ln 0 is undefined, not −∞', () => {
  it('ln, log and log₂ at 0', () => {
    for (const src of ['y = ln(x)', 'y = log(x)', 'y = log_2(x)', 'y = 1/x^2']) {
      const { C, ctx } = board([src])
      const p = tablePanel(C[0], { start: '-1', n: 4, cols: ['d1', 'ratio', 'avg'] }, ctx)!
      expect(p.rows[1].y.text).toBe('undefined')
      // the differences beside an undefined value are blank
      expect(p.rows[1].d1).toBeUndefined()
      expect(p.rows[2].d1).toBeUndefined()
      expect(p.rows[2].ratio).toBeUndefined()
      expect(p.rows.every((r) => !/∞/.test(r.y.text))).toBe(true)
      const e = evaluateTyped('0', C[0], ctx)!
      expect(e.ok && e.text).toBe('a(0) is undefined')
    }
  })
  it('an overflow is not "undefined" and not ∞', () => {
    const { C, ctx } = board(['y = 2^x'])
    const y = tablePanel(C[0], { start: '1100', n: 2 }, ctx)!.rows[0].y
    expect(y.text).toBe('too large')
    expect(y.exact).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 6. Trees keep every path (up to 4³ = 64)
// ---------------------------------------------------------------------------

/** Every draw sequence of a bag, with its exact probability. */
function bagPaths(bag: readonly BagColor[], draws: number, replace: boolean): { seq: number[]; p: Frac }[] {
  const out: { seq: number[]; p: Frac }[] = []
  const go = (counts: number[], seq: number[], p: Frac): void => {
    if (seq.length === draws) {
      out.push({ seq, p })
      return
    }
    const T = counts.reduce((a, b) => a + b, 0)
    if (T === 0) return
    counts.forEach((c, i) => {
      if (c <= 0) return
      go(replace ? counts : counts.map((x, j) => (j === i ? x - 1 : x)), [...seq, i], mul(p, frac(c, T)))
    })
  }
  go(bag.map((b) => b.count), [], ONE)
  return out
}

describe('6 · tree diagrams: every path, exact', () => {
  const NAMES = ['Red', 'Blue', 'Green', 'Yellow']
  it('2 Red, 2 Blue, 2 Green, 2 Yellow, 3 draws with replacement: 64 paths, events exact', () => {
    const bag = NAMES.map((name) => ({ name, count: 2 }))
    const tree = bagTree(bag, 3, true)
    expect(tree.leaves).toHaveLength(64)
    expect(eq(sum(tree.leaves.map((l) => l.p)), ONE)).toBe(true)
    const presets = treePresets(tree, 'colour')
    const pOf = (id: string) => fracText(treeEvent(tree, presets.find((p) => p.id === id)!.keys).p)
    expect(pOf('atLeast:red')).toBe('37/64')
    expect(pOf('none:red')).toBe('27/64')
    expect(pOf('exactly1:red')).toBe('27/64')
    expect(pOf('all:yellow')).toBe('1/64')
  })
  it('brute force: every preset of every bag the card allows, with and without replacement', () => {
    let checked = 0
    const counts = [0, 1, 2, 3]
    for (let k = 2; k <= MAX_COLORS; k++) {
      // every count vector over a few values is too many for 4 colours: a spread of shapes
      const shapes: number[][] = []
      const rec = (v: number[]): void => {
        if (v.length === k) {
          if (v.some((c) => c > 0)) shapes.push(v)
          return
        }
        for (const c of counts) rec([...v, c])
      }
      rec([])
      for (const shape of shapes.filter((_, i) => k < 4 || i % 7 === 0)) {
        const bag = shape.map((count, i) => ({ name: NAMES[i], count }))
        for (let draws = 1; draws <= MAX_DRAWS; draws++) {
          for (const replace of [true, false]) {
            const tree = bagTree(bag, draws, replace)
            const paths = bagPaths(bag, draws, replace)
            expect(tree.leaves.length).toBe(paths.length)
            if (paths.length === 0) continue
            expect(eq(sum(tree.leaves.map((l) => l.p)), ONE)).toBe(true)
            for (const pre of treePresets(tree, 'colour')) {
              const [kind, low] = pre.id.split(':')
              const idx = low === undefined ? -1 : NAMES.findIndex((nm) => nm.toLowerCase() === low)
              const hits = (seq: number[]): boolean => {
                const c = seq.filter((s) => s === idx).length
                if (kind === 'all') return draws === 1 ? c === 1 : c === draws
                if (kind === 'atLeast') return c >= 1
                if (kind === 'exactly1') return c === 1
                if (kind === 'none') return c === 0
                if (kind === 'same') return seq.every((s) => s === seq[0])
                return !seq.every((s) => s === seq[0])
              }
              const want = paths.filter((p) => hits(p.seq)).reduce((a, p) => add(a, p.p), ZERO)
              expect(fracText(treeEvent(tree, pre.keys).p)).toBe(fracText(want))
              checked++
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000)
  })
  it('a typed tree of 4 outcomes over 3 stages has all 64 paths', () => {
    const outcomes = ['A', 'B', 'C', 'D'].slice(0, MAX_TREE_OUTCOMES)
    const stages = Array.from({ length: MAX_TREE_STAGES }, (_, i) => ({ name: `S${i + 1}`, outcomes, probs: [['1/4', '1/4', '1/4', '1/4']], same: true }))
    const tree = manualTree(stages)
    expect(tree.leaves).toHaveLength(64)
    expect(eq(sum(tree.leaves.map((l) => l.p)), ONE)).toBe(true)
    expect(tree.problems).toEqual([])
  })
  it('the card counts 64 paths, a saved event on a far leaf survives, and the figure says it is too dense to label', () => {
    const base = newProb('P1')
    const p: BoardProb = {
      ...base,
      view: 'tree',
      tree: { ...base.tree, mode: 'bag', bag: NAMES.map((name) => ({ name, count: 2 })), draws: 3, replace: true, pick: ['3.3.3'], event: 'all Yellow' },
    }
    const settled = settleProb(p)
    expect(settled.tree.pick).toContain('3.3.3')
    expect(probCard(settled).summary).toMatch(/1\/64/)
    const fig = probFigure(settled, 0)
    const texts = fig.prims.filter((q) => q.k === 'text').map((q) => (q as { text: string }).text)
    expect(texts.some((t) => /^64 paths: too many to label here/.test(t))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 7. "A|B" is not a union
// ---------------------------------------------------------------------------

describe('7 · Venn events: "|" means given, never ∪', () => {
  it('refuses A|B, P(A|B) and "A given B" with a pointer to the right tool', () => {
    for (const s of ['A|B', 'A | B', 'P(A|B)', 'A given B', 'A ∣ B']) {
      const r = parseEvent(s, 2)
      expect(r.ok).toBe(false)
      expect(!r.ok && r.error).toMatch(/P\(A \| B\).*two-way table/)
    }
    // the unions still parse
    for (const s of ['A ∪ B', 'A + B', 'A or B', 'A U B']) expect(parseEvent(s, 2).ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 8. A piecewise or restricted curve is not a polynomial
// ---------------------------------------------------------------------------

describe('8 · synthetic division only for a polynomial', () => {
  it('a piecewise break outside the sampled range is not a polynomial', () => {
    const { C, ctx } = board(['y = { x^2 if x < 10 ; x otherwise }', 'y = x^2 {x >= 0}', 'y = x^2 {0 < x < 5}', 'y = x^3 - 2x + 4'])
    expect(tablePanel(C[0], { div: '3' }, ctx)!.division).toBeNull()
    expect(tablePanel(C[1], { div: '3' }, ctx)!.division).toBeNull()
    expect(tablePanel(C[2], { div: '3' }, ctx)!.division).toBeNull()
    expect(polyOf(C[0], models)).toBeNull()
    expect(tablePanel(C[3], { div: '1' }, ctx)!.division!.work!.remainder.text).toBe('3')
    // the sampler alone now probes far out too
    expect(polynomialCoeffs((x) => (x < 10 ? x * x : x))).toBeNull()
    expect(polynomialCoeffs((x) => (x > -100 ? x * x : 0))).toBeNull()
  })
  it('coefficients come from the formula: 10⁷ + 0.001x² has c₂ = 0.001 exactly', () => {
    const { C } = board(['y = 10000000 + 0.001x^2'])
    expect(polyOf(C[0], models)!.map((c) => ('d' in c ? c.d : c.p / c.q))).toEqual([0.001, 0, 10000000])
  })
})

// ---------------------------------------------------------------------------
// 9. Pattern notes hold for the function, not only the rows
// ---------------------------------------------------------------------------

describe('9 · |x| is not linear', () => {
  it('|x| from 1 and |x − 3| from 4 name no pattern', () => {
    const { C, ctx } = board(['y = abs(x)', 'y = abs(x-3)', 'y = 3x - 1', 'y = x^2 - 4', 'y = 2*3^x', 'y = sqrt(x^2)'])
    expect(tablePanel(C[0], { start: '1', n: 6, cols: ['d1'] }, ctx)!.pattern).toBeNull()
    expect(tablePanel(C[1], { start: '4', n: 6, cols: ['d1'] }, ctx)!.pattern).toBeNull()
    expect(tablePanel(C[5], { start: '1', n: 6, cols: ['d1'] }, ctx)!.pattern).toBeNull()
    expect(tablePanel(C[2], { start: '0', n: 5 }, ctx)!.pattern!.text).toBe('Δy is constant (3): linear')
    expect(tablePanel(C[3], { start: '0', n: 5 }, ctx)!.pattern!.text).toBe('Δ²y is constant (2): quadratic')
    expect(tablePanel(C[4], { start: '0', n: 5 }, ctx)!.pattern!.text).toBe('the ratio is constant (3): exponential')
  })
  it('structure is read from the formula', () => {
    const F = (src: string) => formulaOf(typed('t', src), models, 'drawn')!
    expect(polyDegree(F('y = (x+1)^3 - x^3'))).toBe(3) // an upper bound; the coefficients settle it
    expect(polyDegree(F('y = abs(x)'))).toBeNull()
    expect(polyDegree(F('y = x^2/x'))).toBeNull()
    expect(isExponential(F('y = 5*2^(3x - 1)'))).toBe(true)
    expect(isExponential(F('y = 2^x + 1'))).toBe(false)
    // even the numeric fallback now probes far from the rows
    const t = valueTable(Math.abs, [1, 2, 3, 4, 5, 6])
    expect(tablePattern(t, Math.abs)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 10. All values equal: the mode is that value
// ---------------------------------------------------------------------------

describe('10 · the mode of 5, 5, 5, 5, 5, 5 is 5', () => {
  it('one value repeated', () => {
    expect(modesOf([5, 5, 5, 5, 5, 5]).modes).toEqual([5])
    // every value equally frequent (more than one value): still no mode
    expect(modesOf([1, 1, 2, 2]).modes).toEqual([])
    const p: BoardDataPlot = { id: 'D', type: 'data', sets: [{ name: 'Set A', values: [5, 5, 5, 5, 5, 5], off: [] }], dist: 'dots', box: false, color: '#888' } as unknown as BoardDataPlot
    expect(dataPlotCard(p).sets[0].table.find((r) => r.key === 'mode')!.value).toBe('5')
  })
})

// ---------------------------------------------------------------------------
// 11. Touching is not "above for every x"
// ---------------------------------------------------------------------------

describe('11 · tangent curves touch', () => {
  it('x² vs 2x − 1 touch at x = 1', () => {
    const c = compareOf('y = x^2', 'y = 2x-1', '-2')
    expect(c.sentence).toBe('x² is above 2x − 1 for every x from x = −2 on, except at x = 1, where they touch, and stays ahead for good (the higher degree wins)')
    const r = overtake((x) => x * x, (x) => 2 * x - 1, -2)!
    expect(r.crossings).toEqual([])
    expect(r.touches).toHaveLength(1)
    expect(r.touches[0]).toBeCloseTo(1, 6)
  })
  it('rounding at huge x is not a touch', () => {
    const c = compareOf('y = x^2 + 3x', 'y = x^2 + 2x', '-5')
    expect(c.sentence).toBe('x² + 3x passes x² + 2x after x = 0 and stays ahead for good (their leading terms are equal, so the next terms decide)')
  })
})

// ---------------------------------------------------------------------------
// 12. Tolerances follow the data's variation, not its size
// ---------------------------------------------------------------------------

describe('12 · large values keep their small differences', () => {
  it('10⁷ + 0.001x²: Δy is 0.001, 0.003, 0.005, 0.007 — quadratic, not linear', () => {
    const { C, ctx } = board(['y = 10000000 + 0.001x^2'])
    const p = tablePanel(C[0], { start: '0', n: 5, cols: ['d1', 'd2'] }, ctx)!
    expect(p.rows.map((r) => r.y.text)).toEqual(['10000000', '10000000.001', '10000000.004', '10000000.009', '10000000.016'])
    expect(p.rows.slice(1).map((r) => r.d1!.text)).toEqual(['0.001', '0.003', '0.005', '0.007'])
    expect(p.pattern!.text).toBe('Δ²y is constant (0.002): quadratic')
  })
  it('a printed value is exact only when it IS the value', () => {
    expect(cell(1000000.0005).text).toBe('1000000.0005')
    expect(cell(1000000.0004999).exact).toBe(false)
    expect(cell(0.1 + 0.2).text).toBe('0.3')
    const big = cell(2 ** 70)
    expect(big.exact).toBe(false)
    expect(cell(2 ** 52 + 1).text).toBe(String(2 ** 52 + 1))
  })
  it('x from 10¹⁵ by 1: every row its own x', () => {
    expect(tableXs({ mode: 'step', start: 1e15, step: 1, n: 3 })).toEqual([1e15, 1e15 + 1, 1e15 + 2])
    expect(tableXs({ mode: 'step', start: 2020, step: 0.1, n: 4 })).toEqual([2020, 2020.1, 2020.2, 2020.3])
    const { C, ctx } = board(['y = 3x - 1'])
    const p = tablePanel(C[0], { start: '1000000000000000', step: '1', n: 3 }, ctx)!
    expect(new Set(p.rows.map((r) => r.x.text)).size).toBe(3)
    expect(p.pattern!.text).toBe('Δy is constant (3): linear')
  })
})

// ---------------------------------------------------------------------------
// 13. Venn holes survive every vector export
// ---------------------------------------------------------------------------

const META: DocMeta = { id: 'd1', name: 'Venn', createdAt: 1, modifiedAt: 2 }

function vennList(expr: string): DisplayList {
  const base = newProb('P1')
  const p: BoardProb = { ...base, view: 'venn', venn: { ...base.venn, expr } }
  const input: BoardInput = {
    curves: [],
    styles: {},
    candidates: new Map(),
    exprSources: {},
    viewport: { center: { x: 0, y: 0 }, pxPerUnit: 60 },
    selectedId: null,
    mode: 'draw',
    stats: [p],
  }
  const m = docModelFromJSON(serializeDoc(docFromBoard(META, input, 2)))
  if (!m) throw new Error('load')
  return recordFigure(docFigure(m, { style: 'screen', answers: true }))
}

/** The nonzero winding number of a recorded path around (px, py), arcs and curves flattened. */
function winding(segs: readonly Seg[], px: number, py: number): number {
  const pts: [number, number][][] = []
  let cur: [number, number][] = []
  let at: [number, number] = [0, 0]
  let start: [number, number] = [0, 0]
  const to = (p: [number, number]): void => {
    cur.push(p)
    at = p
  }
  for (const s of segs) {
    if (s.k === 'M') {
      if (cur.length > 1) pts.push(cur)
      cur = [[s.x, s.y]]
      at = start = [s.x, s.y]
    } else if (s.k === 'L') to([s.x, s.y])
    else if (s.k === 'C') {
      const [x0, y0] = at
      for (let i = 1; i <= 24; i++) {
        const t = i / 24
        const u = 1 - t
        to([
          u * u * u * x0 + 3 * u * u * t * s.x1 + 3 * u * t * t * s.x2 + t * t * t * s.x,
          u * u * u * y0 + 3 * u * u * t * s.y1 + 3 * u * t * t * s.y2 + t * t * t * s.y,
        ])
      }
    } else if (s.k === 'A') {
      for (let i = 1; i <= 96; i++) {
        const a = s.a0 + (s.sweep * i) / 96
        to([s.cx + s.r * Math.cos(a), s.cy + s.r * Math.sin(a)])
      }
    } else if (s.k === 'Z') {
      to(start)
    }
  }
  if (cur.length > 1) pts.push(cur)
  let w = 0
  for (const poly of pts) {
    for (let i = 0; i + 1 < poly.length; i++) {
      const [x1, y1] = poly[i]
      const [x2, y2] = poly[i + 1]
      if (y1 <= py && y2 > py && (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1) > 0) w++
      else if (y1 > py && y2 <= py && (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1) < 0) w--
    }
    // close the subpath
    const [x1, y1] = poly[poly.length - 1]
    const [x2, y2] = poly[0]
    if (y1 <= py && y2 > py && (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1) > 0) w++
    else if (y1 > py && y2 <= py && (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1) < 0) w--
  }
  return w
}

describe('13 · Venn holes in SVG, PDF and TikZ', () => {
  it('arc(0, 2π, anticlockwise) is the whole circle, as a browser draws it', () => {
    expect(arcSweep(0, 2 * Math.PI, true)).toBeCloseTo(-2 * Math.PI, 12)
    expect(arcSweep(2 * Math.PI, 0, false)).toBeCloseTo(2 * Math.PI, 12)
    expect(arcSweep(1, 1, true)).toBe(-0)
    expect(arcSweep(0, Math.PI / 2, true)).toBeCloseTo(-1.5 * Math.PI, 12)
  })
  for (const [expr, holes] of [['A ∩ Bᶜ', 1], ['(A ∪ B)ᶜ', 2]] as const) {
    it(`${expr}: the clip has ${holes} circular hole(s), and a point inside a hole is outside the clip`, () => {
      const list = vennList(expr)
      // a hole clip: the box (a closed rectangle) plus a full circle the other way round
      const holeClips = list.clips.filter((c) => c.segs.some((s) => s.k === 'Z') && c.segs.some((s) => s.k === 'A' && Math.abs(Math.abs(s.sweep) - 2 * Math.PI) < 1e-9))
      expect(holeClips.length).toBeGreaterThanOrEqual(holes)
      for (const c of holeClips) {
        const arc = c.segs.find((s) => s.k === 'A') as Extract<Seg, { k: 'A' }>
        const box = c.segs.filter((s) => s.k === 'M' || s.k === 'L') as { x: number; y: number }[]
        const minX = Math.min(...box.map((p) => p.x))
        const minY = Math.min(...box.map((p) => p.y))
        expect(winding(c.segs, arc.cx, arc.cy)).toBe(0) // the circle's centre is cut out
        expect(winding(c.segs, minX + 2, minY + 2)).not.toBe(0) // the box's corner is kept
      }
      // each back-end writes the hole
      const svg = toSvg(list)
      const clipPaths = [...svg.matchAll(/<clipPath id="clip\d+"><path d="([^"]+)"\/>/g)].map((m) => m[1])
      expect(clipPaths.filter((d) => /Z/.test(d) && (d.match(/A/g) ?? []).length >= 2).length).toBeGreaterThanOrEqual(holes)
      const pdf = toPdfString(list)
      // the rectangle closes with h, then at least four Bézier quarters of the circle before W n
      const pdfClips = pdf.split('\n').join(' ').match(/q [^Q]*? h [^Q]*?W n/g) ?? []
      expect(pdfClips.filter((c) => (c.match(/ c /g) ?? []).length >= 4).length).toBeGreaterThanOrEqual(holes)
      const tikz = toTikz(list)
      const tikzHoles = (tikz.match(/\\clip[^;]*-- cycle[^;]*arc\[start angle=[^,]+, end angle=[^,]+, radius=[^\]]+\]/g) ?? []).filter((c) => {
        const m = /arc\[start angle=([^,]+), end angle=([^,]+),/.exec(c)!
        return Math.abs(Math.abs(Number(m[2]) - Number(m[1])) - 360) < 1e-6
      })
      expect(tikzHoles.length).toBeGreaterThanOrEqual(holes)
    })
  }
})

// ---------------------------------------------------------------------------
// Lower: a dangling compare, the Evaluate guide, the histogram, Evaluate's messages
// ---------------------------------------------------------------------------

describe('lower · a compare with a deleted curve is dropped, and comes back on undo', () => {
  it('prune drops vs; restore brings it back with the curve; reveal skips it', () => {
    const { C } = board(['y = 2^x', 'y = x^3'])
    const s = emptyViewStates()
    s.table[C[0].id] = { vs: C[1].id, n: 8 }
    const pruned = pruneViewStates(s, new Set([C[0].id]))
    expect(pruned.table[C[0].id]).toEqual({ n: 8 })
    const back = restoreViewStates(pruned, { [C[0].id]: { table: { vs: C[1].id, n: 8 } }, [C[1].id]: {} }, new Set([C[0].id]), C)
    expect(back.table[C[0].id]).toEqual({ n: 8, vs: C[1].id })
    expect(tableKeysOf(C[0].id, { vs: C[1].id }, new Set([C[0].id]))).toEqual([tableKey(C[0].id, 'values')])
    expect(tableKeysOf(C[0].id, { vs: C[1].id }, new Set([C[0].id, C[1].id]))).toContain(tableKey(C[0].id, 'compare'))
  })
})

describe('lower · the Evaluate guide hides with its value', () => {
  it('the y-axis guide carries the eval key and goes while it is hidden', () => {
    const { C, ctx } = board(['y = x^2'])
    const ov = tableOverlays(C, { [C[0].id]: { ev: '1.5' } }, ctx)
    const key = tableKey(C[0].id, 'eval')
    const across = ov.find((o) => o.kind === 'segment' && o.from.x === 0)!
    expect(across.kind === 'segment' && across.answer).toBe(key)
    const scene: BoardScene = {
      vp: { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 900, heightPx: 600 },
      theme: DARK_THEME,
      curves: C,
      styles: {},
      models,
      analysis: null,
      overlays: ov,
    }
    const inv = buildInventory({ curves: [{ id: C[0].id, points: [], extra: [key] }], crossings: [] })
    const ON: RevealState = { ...REVEAL_OFF, on: true }
    const sr: SceneReveal = { hidden: (k) => isHidden(ON, k), positions: true, pointKey: inv.answerKey, crossKey: inv.crossKey }
    const out = applyReveal(scene, sr)
    expect(out.overlays!.some((o) => o.kind === 'segment' && o.from.x === 0)).toBe(false)
    expect(out.overlays!.some((o) => o.kind === 'segment' && o.from.y === 0)).toBe(true) // the guide down to x = a stays
  })
})

describe('lower · the histogram never goes blank silently', () => {
  it('a width that makes too many bins is widened, and the card says so', () => {
    const values = Array.from({ length: 50 }, (_, i) => i * 2)
    const w = histogramWidth(values, 0.001)
    expect(w.width).toBeGreaterThanOrEqual(0.5)
    expect(w.note).toMatch(/would make about 98,000 bins: drawn with width/)
    const p = { id: 'D', type: 'data', sets: [{ name: 'Set A', values, off: [] }], dist: 'hist', box: false, binWidth: 0.001, color: '#888' } as unknown as BoardDataPlot
    const card = dataPlotCard(p)
    expect(card.binWidth).toBe(0.001)
    expect(card.binNote).toMatch(/drawn with width/)
  })
  it('all-zero data gets a width of 1, not 10⁻⁹', () => {
    expect(defaultBinWidth([0, 0, 0])).toBe(1)
    expect(defaultBinWidth([5, 5, 5])).toBe(0.5)
  })
})

describe('lower · Evaluate says what it means', () => {
  const { C, ctx } = board(['y = x^2', 'y = 2x'])
  const ev = (s: string) => evaluateTyped(s, C[0], ctx)!
  it('an expression in x depends on x, even where it is undefined at a probe', () => {
    for (const s of ['sqrt(x-1)', 'ln(x-1)', 'x + 1', 'sqrt(-x)']) {
      const r = ev(s)
      expect(r.ok).toBe(false)
      expect(!r.ok && r.error).toMatch(/depends on x/)
    }
  })
  it('sin(2) is worked out, not taken as an x', () => {
    const r = ev('sin(2)')
    expect(r.ok && r.text).toBe('sin(2) ≈ 0.9092974')
    expect(r.ok && r.point).toBeNull()
  })
  it('a(1)^2 reads a(1)², and · for *', () => {
    expect((ev('a(3)^2') as { text: string }).text).toBe('a(3)² = 81')
    expect((ev('a(2)*b(1)') as { text: string }).text).toBe('a(2)·b(1) = 8')
  })
  it('a bare number is still f(a)', () => {
    expect((ev('-1/2') as { text: string }).text).toBe('a(−0.5) = 0.25')
    expect((ev('pi') as { point: unknown }).point).not.toBeNull()
  })
})

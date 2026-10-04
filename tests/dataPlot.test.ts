// ============================================================================
// tests/dataPlot.test.ts — the one-variable data plot (Build ▾ → One-variable
// data) and a data table's residual plot, end to end without React.
//
//   card        summary table, quartile method, fences, shape, measures,
//               comparison, before / after
//   figure      rows on one number line; dots / histogram / box; values left
//               out; the spots a click hits; the bin width
//   persistence what is stored (lists, clicked-out indices, display) — never a
//               result; round trip; old documents byte-identical
//   reveal      the stat:<id>:value key; answers masked
//   words       describeGraph states the plots (a student copy without answers)
//   exports     docScene draws them; the residual plot frames with its table
//   residuals   the table card's residual column, verdict and r in words
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { BoardInput, DocMeta } from '../src/core/persist'
import { deserializeDoc, docFromBoard, serializeDoc } from '../src/core/persist'
import { statToStored, storedToStat } from '../src/core/statsPersist'
import type { BoardDataPlot } from '../src/core/statsPersist'
import {
  EXAMPLE_SETS,
  QUARTILE_METHOD,
  binWidthOf,
  dataPlotCard,
  dataPlotFigure,
  dataPlotSpots,
  newDataPlot,
  toggleOff,
} from '../src/ui/dataPlotLinks'
import { statsFigures } from '../src/ui/statsLinks'
import { REVEAL_OFF, applyReveal, buildInventory, isHidden, maskStats, statKey } from '../src/ui/reveal'
import type { RevealState, SceneReveal } from '../src/ui/reveal'
import type { BoardScene } from '../src/ui/renderBoard'
import { DARK_THEME } from '../src/core/types'
import type { FittedCurve } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { docFigure, docModelFromJSON, recordFigure } from '../src/ui/docScene'
import { describeBoard } from '../src/ui/boardDescription'
import type { TextItem } from '../src/render/vectorCtx'
import { parseExpression } from '../src/core/parse'
import { fitRegression, regressionSource } from '../src/core/data'
import type { BoardData } from '../src/ui/dataLinks'
import { dataBox, dataCard, makeFitCache, pointsBox } from '../src/ui/dataLinks'
import { residFigId, residualFigure, residualInfo } from '../src/ui/residualLinks'

const META: DocMeta = { id: 'd1', name: 'Data', createdAt: 1, modifiedAt: 2 }

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

const twoClasses = (over: Partial<BoardDataPlot> = {}): BoardDataPlot => ({
  ...newDataPlot('D1'),
  sets: EXAMPLE_SETS.map((s) => ({ name: s.name, values: s.values.slice() })),
  ...over,
})

describe('the card', () => {
  it('a new plot is one empty set, a dot plot and a box plot', () => {
    const p = newDataPlot('X')
    expect(p).toMatchObject({ type: 'data', dist: 'dots', box: true, sets: [{ name: 'Set A', values: [] }] })
    const c = dataPlotCard(p)
    expect(c.ok).toBe(false)
    expect(c.summary).toBe('One-variable data · paste a list')
  })
  it('the summary table, one column per set', () => {
    const c = dataPlotCard(twoClasses())
    const col = (i: number) => Object.fromEntries(c.sets[i].table.map((r) => [r.key, r.value]))
    expect(col(0)).toMatchObject({ n: '20', mean: '73.05', min: '41', q1: '72', median: '74.5', q3: '77', max: '80', range: '39', iqr: '5', mode: '74' })
    expect(col(1)).toMatchObject({ n: '20', q1: '77.5', median: '82.5', q3: '87.5', iqr: '10', mode: 'none' })
    expect(Number(col(1).sdSample)).toBeGreaterThan(Number(col(1).sdPop))
    expect(QUARTILE_METHOD).toMatch(/leaving out the median itself when n is odd/)
  })
  it('fences, shape, the measures that suit it, and the comparison', () => {
    const c = dataPlotCard(twoClasses())
    expect(c.sets[0].fences).toEqual({ lower: '64.5', upper: '84.5', outliers: ['41'] })
    // one low score on an otherwise even class: the shape checks see no skew, the fences see the outlier
    expect(c.sets[0].shape).toBe('Period 1 appears roughly symmetric')
    expect(c.sets[0].shapeReason).toMatch(/^mean 73\.05 < median 74\.5/)
    expect(c.sets[0].recommend).toBe('Use the median and IQR to describe its center and spread: it has an outlier, and the median and IQR are resistant to extreme values.')
    expect(c.sets[1].shape).toBe('Period 2 appears roughly symmetric')
    expect(c.sets[1].recommend).toMatch(/mean and standard deviation/)
    expect(c.compare).toMatch(/^Period 2 has a higher median \(82\.5 vs 74\.5\) and a larger IQR \(10 vs 5\) than Period 1/)
    expect(c.summary).toBe('2 sets · medians = 74.5 vs 82.5')
  })
  it('the outlier explorer: leave the outliers out, see before and after', () => {
    const c = dataPlotCard(twoClasses({ dropOutliers: true }))
    const e = c.sets[0].effect!
    expect(e.removed).toEqual([41])
    expect(e.ranked[0]).toBe('sd')
    expect(c.sets[0].leftOut).toEqual([{ i: 14, value: '41', why: 'outlier' }])
    expect(c.sets[0].table.find((r) => r.key === 'n')!.value).toBe('19')
    expect(c.sets[1].effect).toBeNull()
    // the fences shown are the ones the rule used, before anything was dropped
    expect(c.sets[0].fences.outliers).toEqual(['41'])
  })
  it('a clicked value goes out, and comes back', () => {
    const p = twoClasses()
    const out = toggleOff(p, 1, 6) // Period 2's 95
    expect(out.sets[1].off).toEqual([6])
    const c = dataPlotCard(out)
    expect(c.sets[1].leftOut).toEqual([{ i: 6, value: '95', why: 'clicked' }])
    expect(c.sets[1].effect!.sentence).toMatch(/^Leaving out 95 /)
    const back = toggleOff(out, 1, 6)
    expect(back.sets[1].off).toBeUndefined()
    expect(dataPlotCard(back).sets[1].effect).toBeNull()
  })
})

describe('the figure', () => {
  it('stacks the sets on one shared number line, names each row', () => {
    const f = dataPlotFigure(twoClasses(), 0)
    expect(f.kind).toBe('data')
    expect(f.title.question).toBe('Dot plot and box plot · Period 1 vs Period 2')
    expect(f.title.answer).toBe(' · medians = 74.5 vs 82.5')
    const names = f.prims.filter((p) => p.k === 'text' && p.bold).map((p) => (p.k === 'text' ? p.text : ''))
    expect(names).toEqual(['Period 1', 'Period 2'])
    // each set's dots (20), then Period 1's outlier again as a separate point on its box line
    const dots = f.prims.filter((p) => p.k === 'dots')
    expect(dots.map((d) => (d.k === 'dots' ? d.pts.length : 0))).toEqual([20, 1, 20])
    // the outlier is a separate point on the box line; the fences are dashed
    const fences = f.prims.filter((p) => p.k === 'vline' && p.ink === 'rule')
    expect(fences).toHaveLength(2)
    // the five-number labels are answers
    expect(f.prims.filter((p) => p.k === 'text' && p.answer).length).toBe(10)
    expect(f.ticks.length).toBeGreaterThan(3)
  })
  it('a histogram: shared bins, the bin width shown, counts on the bars', () => {
    const p = twoClasses({ dist: 'hist', box: false })
    expect(binWidthOf(p)).toBe(10) // 41 … 95, n = 40: about 7 bins → 10
    const f = dataPlotFigure(p, 0)
    const bars = f.prims.filter((q) => q.k === 'rect')
    const counts = f.prims.filter((q) => q.k === 'text' && /^\d+$/.test(q.text)).map((q) => (q.k === 'text' ? Number(q.text) : 0))
    expect(counts.reduce((a, b) => a + b, 0)).toBe(40)
    expect(bars.length).toBe(counts.length)
    expect(f.prims.some((q) => q.k === 'text' && q.text === 'bin width 10')).toBe(true)
    const narrow = dataPlotFigure({ ...p, binWidth: 2.5 }, 0)
    expect(narrow.prims.filter((q) => q.k === 'rect').length).toBeGreaterThan(bars.length)
    expect(narrow.prims.some((q) => q.k === 'text' && q.text === 'bin width 2.5')).toBe(true)
  })
  it('values left out are dashed rings, not dots', () => {
    const f = dataPlotFigure(toggleOff(twoClasses(), 0, 14), 0)
    const rings = f.prims.filter((p) => p.k === 'ring')
    expect(rings).toHaveLength(1)
    expect(rings[0].k === 'ring' && rings[0].pts.length).toBe(1)
  })
  it('the spots a click can hit: every dot on a dot plot; on a box plot alone, outliers and left-out values', () => {
    const p = twoClasses()
    const spots = dataPlotSpots(p, 0)
    expect(spots).toHaveLength(40)
    expect(spots.find((s) => s.set === 0 && s.i === 14)!.value).toBe(41)
    const box = dataPlotSpots({ ...p, dist: 'none' }, 0)
    expect(box.map((s) => s.value)).toEqual([41])
    expect(dataPlotSpots({ ...p, dist: 'hist', box: false }, 0)).toEqual([])
  })
  it('an empty plot asks for data', () => {
    const f = dataPlotFigure(newDataPlot('E'), 0)
    expect(f.describe).toBeNull()
    expect(f.prims[0].k === 'text' && f.prims[0].text).toBe('Paste the data on the card')
  })
})

describe('persistence', () => {
  it('stores the lists, the clicked-out indices and the display — never a result', () => {
    const p = { ...toggleOff(twoClasses(), 1, 6), dist: 'hist' as const, binWidth: 4, dropOutliers: true as const }
    const stored = statToStored(p)
    expect(stored).toEqual({
      id: 'D1',
      type: 'data',
      sets: [
        { name: 'Period 1', values: EXAMPLE_SETS[0].values },
        { name: 'Period 2', values: EXAMPLE_SETS[1].values, off: [6] },
      ],
      dist: 'hist',
      box: true,
      binWidth: 4,
      dropOutliers: true,
    })
    expect(JSON.stringify(stored)).not.toMatch(/median|mean|q1|outliers"|fence/)
  })
  it('round-trips through a document byte for byte', () => {
    const p = { ...toggleOff(twoClasses(), 0, 3), dist: 'none' as const, color: '#22c55e' }
    const json = serializeDoc(docFromBoard(META, input({ stats: [p], selectedId: 'D1' }), 2))
    const res = deserializeDoc(json)
    expect(res.problems).toEqual([])
    expect(res.board!.stats).toEqual([p])
    expect(serializeDoc(docFromBoard(META, input({ stats: res.board!.stats, selectedId: 'D1' }), 2))).toBe(json)
  })
  it('a board without one serialises exactly as before', () => {
    const plain = serializeDoc(docFromBoard(META, input(), 2))
    expect(plain).not.toContain('"stats"')
    expect(serializeDoc(docFromBoard(META, input({ stats: [] }), 2))).toBe(plain)
  })
  it('repairs what it can and says so', () => {
    const problems: string[] = []
    const out = storedToStat({ id: 'D', type: 'data', sets: [{ name: 7, values: [1, 'x', 3], off: [0, 9, -1] }, 'junk'], dist: 'pie', box: 'yes', binWidth: -2 }, problems)
    if (!('stat' in out) || out.stat.type !== 'data') throw new Error('data plot')
    expect(out.stat.sets).toEqual([{ name: 'Set A', values: [1, 3], off: [0] }])
    expect(out.stat.dist).toBe('dots')
    expect(out.stat.box).toBe(true)
    expect(out.stat.binWidth).toBeUndefined()
    expect(problems.length).toBeGreaterThanOrEqual(5)
  })
})

// ---------------------------------------------------------------------------
// A data table with a linear fit to curved data, and its residual plot
// ---------------------------------------------------------------------------

const XS = [0, 1, 2, 3, 4, 5, 6, 7, 8]
const CURVED = XS.map((x) => x * x + (x % 2 === 0 ? 0.4 : -0.4))

function curveOf(id: string, src: string): FittedCurve {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(src)
  return { id, modelId: 'expr_1', params: o.plot.defaultParams.slice(), kind: o.plot.kind, domain: o.plot.domain, color: '#22c55e', strokeWidth: 2.5, visible: true, error: 0 }
}

function table(ys: number[], residualPlot: boolean): { data: BoardData; src: string } {
  const src = regressionSource(fitRegression('linear', XS, ys))
  const data: BoardData = {
    id: 'T1',
    name: 'Stopping distance',
    xLabel: 'speed',
    yLabel: 'distance',
    color: '#22c55e',
    visible: true,
    rows: XS.map((x, i) => ({ x: String(x), y: String(ys[i]) })),
    regressions: [{ id: 'r1', kind: 'linear', curveId: 'c1', digits: 4, residuals: false, ...(residualPlot ? { residualPlot: true as const } : {}) }],
  }
  return { data, src }
}

describe('the residual plot', () => {
  const fit = makeFitCache()
  it('residuals, the curved verdict and r in words on the table card', () => {
    const { data } = table(CURVED, true)
    const card = dataCard(data, {}, new Set(['c1']), fit)
    const row = card.regressions[0]
    expect(row.pattern!.verdict).toBe('curved')
    expect(row.pattern!.sentence).toMatch(/a linear model may not be appropriate/)
    expect(row.rWords!.phrase).toBe('a strong positive linear association')
    expect(row.rWords!.sentence).toMatch(/as speed increases, distance tends to increase/)
    // the residual column: y − ŷ per row, and they sum to 0
    expect(card.residualCol).toHaveLength(9)
    const sum = card.residualCol!.reduce<number>((a, b) => a + (b ?? 0), 0)
    expect(Math.abs(sum)).toBeLessThan(1e-9)
    expect(card.residualCol![0]!).toBeGreaterThan(0) // a parabola's ends sit above the line
    expect(card.residualCol![4]!).toBeLessThan(0)
  })
  it('a linear data set: no clear pattern', () => {
    const noise = [0.5, -0.3, 0.8, -0.6, 0.2, -0.9, 0.4, 0.7, -0.5]
    const { data } = table(XS.map((x, i) => 3 * x + 2 + noise[i]), true)
    const info = residualInfo(data, data.regressions[0], fit)!
    expect(info.pattern.verdict).toBe('none')
    expect(info.r!).toBeGreaterThan(0.99)
  })
  it('no residual plot, no column, no verdict — and the table box is just the points', () => {
    const { data } = table(CURVED, false)
    const card = dataCard(data, {}, new Set(['c1']), fit)
    expect(card.residualCol).toBeNull()
    expect(card.regressions[0].pattern).toBeUndefined()
    expect(card.regressions[0].rWords).toBeDefined()
    expect(dataBox(data)).toEqual(pointsBox(data))
    expect(residualFigure(data, new Set(['c1']), fit)).toBeNull()
  })
  it('the panel sits under the scatter plot, lined up in x, and the table’s box takes it in', () => {
    const { data } = table(CURVED, true)
    const f = residualFigure(data, new Set(['c1']), fit)!
    const pts = pointsBox(data)!
    expect(f.id).toBe(residFigId('T1'))
    expect(f.kind).toBe('resid')
    expect(f.panel.y1).toBeLessThan(pts.min.y)
    expect(f.plot.x0).toBeLessThan(0)
    expect(f.plot.x1).toBeGreaterThan(8)
    const dots = f.prims.find((p) => p.k === 'dots')!
    expect(dots.k === 'dots' && dots.pts.map((p) => p.x)).toEqual(XS)
    expect(f.yTicks!.some((t) => t.text === '0')).toBe(true)
    expect(f.title).toEqual({ question: 'Residual plot · Linear model', answer: ' · curved pattern' })
    const box = dataBox(data)!
    expect(box.min.y).toBeLessThanOrEqual(f.panel.y0)
    // a detached regression (or one whose curve is gone) shows none
    expect(residualFigure(data, new Set(), fit)).toBeNull()
  })
  it('persists only the switch', () => {
    const { data, src } = table(CURVED, true)
    const json = serializeDoc(docFromBoard(META, input({ curves: [curveOf('c1', src)], exprSources: { c1: src }, data: [data] }), 2))
    expect(json).toContain('"residualPlot":true')
    const back = deserializeDoc(json)
    expect(back.board!.data[0].regressions[0].residualPlot).toBe(true)
    // and an old table writes no new key
    const old = table(CURVED, false)
    expect(serializeDoc(docFromBoard(META, input({ curves: [curveOf('c1', old.src)], exprSources: { c1: old.src }, data: [old.data] }), 2))).not.toContain('residualPlot')
  })
})

// ---------------------------------------------------------------------------
// Reveal mode, words, exports
// ---------------------------------------------------------------------------

function sceneReveal(state: RevealState, keys: string[]): SceneReveal {
  const inv = buildInventory({ curves: [], crossings: [], after: keys })
  return { hidden: (k) => isHidden(state, k), positions: true, pointKey: inv.answerKey, crossKey: inv.crossKey }
}

describe('reveal mode', () => {
  const ON: RevealState = { ...REVEAL_OFF, on: true }
  it('the plot keeps its data and hides its answers', () => {
    const f = dataPlotFigure(twoClasses(), 0)
    const m = maskStats(f)
    expect(m.title.answer).toBe(' · medians = ?')
    expect(m.prims.filter((p) => p.k === 'text' && p.answer).every((p) => p.k === 'text' && p.text === '?')).toBe(true)
    // the mean marks go; the dots stay
    expect(m.prims.some((p) => p.k === 'fill' && p.answer)).toBe(false)
    expect(m.prims.filter((p) => p.k === 'dots').length).toBe(f.prims.filter((p) => p.k === 'dots').length)
  })
  it('one key per data plot and per residual plot, masked on the board until revealed', () => {
    const { data, src } = table(CURVED, true)
    const fit = makeFitCache()
    const scene: BoardScene = {
      vp: { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 900, heightPx: 600 },
      theme: DARK_THEME,
      curves: [],
      styles: {},
      models: MODELS,
      analysis: null,
      stats: [...statsFigures([twoClasses()]), residualFigure(data, new Set(['c1']), fit)!],
    }
    void src
    const keys = [statKey('D1'), statKey(residFigId('T1'))]
    const out = applyReveal(scene, sceneReveal(ON, keys))
    expect(out.stats![1].title.answer).toBe(' ?')
    expect(out.revealMarks!.map((m) => m.key)).toEqual(keys)
  })
})

function model(over: Partial<BoardInput>) {
  const json = serializeDoc(docFromBoard(META, input(over), 2))
  const m = docModelFromJSON(json)
  if (!m) throw new Error('load')
  return m
}

describe('describeGraph', () => {
  it('states the plots and (as answers) the summaries and the comparison', () => {
    const m = model({ stats: [twoClasses()] })
    const key = describeBoard(m, { answers: true }).long
    expect(key).toContain('A dot plot and a box plot of 2 data sets on one number line, one row each: Period 1 (20 values) and Period 2 (20 values).')
    expect(key).toContain('Period 1: minimum 41, Q1 72, median 74.5, Q3 77, maximum 80')
    expect(key).toContain('Outlier: 41.')
    expect(key).toContain('It appears roughly symmetric.')
    expect(key).toContain('Period 2 has a higher median (82.5 vs 74.5)')
    const student = describeBoard(m, { answers: false }).long
    expect(student).toContain('A dot plot and a box plot of 2 data sets')
    expect(student).not.toContain('74.5')
  })
  it('states a histogram with its bin width', () => {
    const d = describeBoard(model({ stats: [twoClasses({ dist: 'hist', box: false, binWidth: 10 })] }), { answers: true }).long
    expect(d).toContain('A histogram (bin width 10) of 2 data sets')
  })
  it('states a residual plot and its verdict', () => {
    const { data, src } = table(CURVED, true)
    const m = model({ curves: [curveOf('c1', src)], exprSources: { c1: src }, data: [data] })
    const key = describeBoard(m, { answers: true }).long
    expect(key).toContain('A residual plot for the linear model fitted to Stopping distance shows the 9 residuals against x')
    expect(key).toContain('a linear model may not be appropriate')
    expect(describeBoard(m, { answers: false }).long).not.toContain('may not be appropriate')
  })
})

describe('worksheets and exports', () => {
  const texts = (list: ReturnType<typeof recordFigure>): string[] => list.items.filter((i): i is TextItem => i.t === 'text').map((t) => t.text)
  it('the key draws the plot with its values; the student copy says "?"', () => {
    const m = model({ stats: [twoClasses()] })
    const key = texts(recordFigure(docFigure(m, { style: 'textbook', answers: true })))
    expect(key).toContain('Period 1')
    expect(key).toContain('74.5')
    expect(key.some((t) => t.includes('medians = 74.5 vs 82.5'))).toBe(true)
    const student = texts(recordFigure(docFigure(m, { style: 'sat', answers: false })))
    expect(student).toContain('Period 2')
    expect(student).not.toContain('74.5')
    expect(student).toContain('?')
  })
  it('the residual plot reaches the export, framed with its table', () => {
    const { data, src } = table(CURVED, true)
    const m0 = model({ curves: [curveOf('c1', src)], exprSources: { c1: src }, data: [data] })
    const m = { ...m0, settings: { ...m0.settings, fit: true } }
    const f = docFigure(m, { style: 'screen', answers: true })
    const resid = f.scene.stats!.find((s) => s.kind === 'resid')!
    expect(resid).toBeDefined()
    const halfY = f.scene.vp.heightPx / 2 / (f.scene.vp.pxPerUnitY ?? f.scene.vp.pxPerUnit)
    expect(f.scene.vp.center.y - halfY).toBeLessThan(resid.panel.y0 + 1e-6)
    expect(texts(recordFigure(f)).some((t) => t.includes('Residual plot'))).toBe(true)
  })
})

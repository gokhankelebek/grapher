// ============================================================================
// tests/statsLabelLayout.test.ts — where a statistics panel's words land.
//
//   box plots   the five-number labels (src/render/stats.ts placeUnderLabels,
//               laid out by src/ui/dataPlotLinks.ts): every label drawn, none
//               on another, on its box, on the axis line or its tick labels,
//               each inside its own row — for the m1-box-plots gallery example
//               and a tight case (Q3 ≈ max), on screen, in Present (1.5×,
//               2.5×) and on a small worksheet figure
//   histograms  a count stays inside its row, the bin width is in the title
//   titles      every panel's title (normal, simulation, data plot,
//               probability) fits the panel at 2.5× and stays clear of the
//               panel's other words (src/render/stats.ts layoutTitle)
//
// The real renderer draws into the vector recorder (src/render/vectorCtx.ts),
// so these are the boxes an SVG / PDF / TikZ export would print.
// ============================================================================

import { describe, expect, it } from 'vitest'
import { buildExample, exampleById } from '../src/examples'
import { deserializeDoc } from '../src/core/persist'
import type { BoardDataPlot, BoardStat } from '../src/core/statsPersist'
import { newProb } from '../src/core/probPersist'
import type { ProbView } from '../src/core/probPersist'
import { DARK_THEME, LIGHT_THEME } from '../src/core/types'
import type { Viewport } from '../src/core/types'
import { dataPlotFigure, dataPlotView } from '../src/ui/dataPlotLinks'
import { newNormal, newSim, statsFigures } from '../src/ui/statsLinks'
import { settleProb } from '../src/ui/probLinks'
import { drawStats, layoutTitle, placeUnderLabels } from '../src/render/stats'
import type { StatsFigure } from '../src/render/stats'
import { VectorCtx } from '../src/render/vectorCtx'
import type { TextItem } from '../src/render/vectorCtx'

interface Box {
  x0: number
  x1: number
  y0: number
  y1: number
}
const hit = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

/** A text item's ink box in px: the em box around its middle line (VectorCtx puts 'middle' 0.3 em above the baseline). */
function boxOf(t: TextItem): Box {
  const left = t.anchor === 'start' ? t.x : t.anchor === 'middle' ? t.x - t.width / 2 : t.x - t.width
  const mid = t.y - 0.3 * t.font.size
  return { x0: left, x1: left + t.width, y0: mid - 0.45 * t.font.size, y1: mid + 0.45 * t.font.size }
}

/** Draw one figure, framed with a little air, at `ppu` px per unit and `type` × the type. */
function paint(f: StatsFigure, ppu: number, type: number, light = false) {
  const p = f.panel
  const vp: Viewport = {
    center: { x: (p.x0 + p.x1) / 2, y: (p.y0 + p.y1) / 2 },
    pxPerUnit: ppu,
    widthPx: Math.ceil((p.x1 - p.x0 + 1) * ppu),
    heightPx: Math.ceil((p.y1 - p.y0 + 1) * ppu),
  }
  const ctx = new VectorCtx(vp.widthPx, vp.heightPx)
  drawStats(ctx as unknown as CanvasRenderingContext2D, [f], {
    vp,
    theme: light ? LIGHT_THEME : DARK_THEME,
    mono: light,
    scale: { type, stroke: type },
  })
  const toPx = (x: number, y: number) => ({ x: vp.widthPx / 2 + (x - vp.center.x) * ppu, y: vp.heightPx / 2 - (y - vp.center.y) * ppu })
  const texts = ctx.list().items.filter((i): i is TextItem => i.t === 'text')
  return { texts, toPx }
}

const exampleDataPlot = (): BoardDataPlot => {
  const res = deserializeDoc(buildExample(exampleById('m1-box-plots')!).json)
  const st = res.board!.stats[0]
  if (st.type !== 'data') throw new Error('m1-box-plots should open on a data plot')
  return st
}

/** Q3 ≈ max on both rows, Q1 ≈ median on the second: the crowded case. */
const tight = (): BoardDataPlot => ({
  id: 'T',
  type: 'data',
  dist: 'dots',
  box: true,
  color: '#f97316',
  sets: [
    { name: 'Set A', values: [10, 20, 30, 40, 50, 60, 70, 71, 72, 72.5] },
    { name: 'Set B', values: [11, 12, 12.5, 13, 30, 31, 31.5, 32, 32.4] },
  ],
})

/**
 * Lay a data plot out and check every five-number label. Returns how many
 * labels were drawn, for the caller to compare with how many there are.
 */
function checkBoxLabels(p: BoardDataPlot, ppu: number, type: number, light = false): { drawn: number; expected: number } {
  const f = dataPlotFigure(p, 0)
  const views = dataPlotView(p)
  const { texts, toPx } = paint(f, ppu, type, light)
  const axisY = toPx(0, f.axisY).y
  const k = views.length
  const rowH = (f.plot.y1 - f.plot.y0) / k
  // the boxes, in set order, each with its whisker caps' height
  const boxes = f.prims.filter((q) => q.k === 'rect' && q.alpha === 0.16) as Extract<StatsFigure['prims'][number], { k: 'rect' }>[]
  expect(boxes).toHaveLength(k)
  const ticks = texts.filter((t) => boxOf(t).y0 > axisY)
  let drawn = 0
  let expected = 0
  const all: Box[] = []
  views.forEach((v, si) => {
    const s = v.live
    const want = [...new Set([s.median, s.q1, s.q3, v.liveFences.whiskerLo, v.liveFences.whiskerHi].map((x) => String(Number(x.toFixed(2)))))]
    expected += want.length
    const b = boxes[si]
    const boxPx: Box = { x0: toPx(b.x0, 0).x, x1: toPx(b.x1, 0).x, y0: toPx(0, b.y1).y, y1: toPx(0, b.y0).y }
    const rowBottom = toPx(0, f.plot.y1 - (si + 1) * rowH).y
    // this row's labels: its numbers, between its box and its row's bottom
    const mine = texts.filter((t) => want.includes(t.text) && boxOf(t).y0 >= boxPx.y1 - 0.5 && boxOf(t).y1 <= rowBottom + 0.5)
    // none of this set's numbers is drawn anywhere else in the plot area (another row, over the axis)
    const strays = texts.filter((t) => want.includes(t.text) && !mine.includes(t) && boxOf(t).y1 < axisY && boxOf(t).y0 > toPx(0, f.plot.y1).y)
    const otherRows = views.flatMap((w, j) => (j === si ? [] : [w])).length
    if (otherRows === 0) expect(strays).toEqual([])
    drawn += mine.length
    for (const t of mine) {
      const r = boxOf(t)
      expect(hit(r, boxPx), `${t.text} on its box`).toBe(false)
      expect(r.y1, `${t.text} reaches the axis line`).toBeLessThan(axisY - 0.7)
      for (const tk of ticks) expect(hit(r, boxOf(tk)), `${t.text} on tick ${tk.text}`).toBe(false)
      all.push(r)
    }
  })
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(hit(all[i], all[j]), 'two labels overlap').toBe(false)
  return { drawn, expected }
}

describe('box plot labels', () => {
  it('m1-box-plots: under each box, clear of the axis, its ticks, the boxes and each other', () => {
    const p = exampleDataPlot()
    // screen at three zooms, Present at 1.5× and 2.5×, a print style
    for (const [ppu, type] of [[65, 1], [40, 1], [120, 1], [65, 1.5], [65, 2.5], [100, 2.5]] as const) {
      const r = checkBoxLabels(p, ppu, type)
      expect(r.drawn, `ppu ${ppu} × ${type}`).toBe(r.expected)
    }
    expect(checkBoxLabels(p, 65, 1, true).drawn).toBe(10)
  })
  it('Period 4 (the bottom row) no longer sits on the axis: its labels are above the axis line', () => {
    const p = exampleDataPlot()
    const f = dataPlotFigure(p, 0)
    const { texts, toPx } = paint(f, 65, 1)
    const axisY = toPx(0, f.axisY).y
    for (const v of ['58', '70', '79.5', '89', '98']) {
      const above = texts.filter((t) => t.text === v && boxOf(t).y1 < axisY - 0.7)
      expect(above, v).toHaveLength(1)
    }
  })
  it('a tight case (Q3 ≈ max): spread or staggered with leaders, never on each other', () => {
    for (const [ppu, type] of [[65, 1], [65, 1.5], [65, 2.5], [40, 1]] as const) {
      const r = checkBoxLabels(tight(), ppu, type)
      expect(r.drawn, `ppu ${ppu} × ${type}`).toBe(r.expected)
    }
  })
  it('a small worksheet figure: smaller type before overlap, still no collisions', () => {
    // an 8 cm figure is about 24 px per unit
    checkBoxLabels(exampleDataPlot(), 24, 1, true)
    checkBoxLabels(tight(), 24, 1, true)
  })
  it('a box plot alone, and six sets: every row keeps its own labels', () => {
    checkBoxLabels({ ...exampleDataPlot(), dist: 'none' }, 65, 1)
    const six: BoardDataPlot = {
      ...tight(),
      sets: Array.from({ length: 6 }, (_, i) => ({ name: `S${i}`, values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((x) => x * (i + 1)) })),
    }
    checkBoxLabels(six, 65, 1)
    checkBoxLabels({ ...six, dist: 'none' }, 65, 1)
  })

  it('placeUnderLabels: crowded values spread apart inside the band, with leaders; a band too shallow places none', () => {
    const band = { top: 100, floor: 140, h: 13, gap: 3, xMin: 0, xMax: 400 }
    const items = [
      { x: 200, w: 30, side: 0 as const },
      { x: 300, w: 22, side: 1 as const },
      { x: 304, w: 22, side: 1 as const },
    ]
    const out = placeUnderLabels(items, band)
    expect(out.every((q) => q !== null)).toBe(true)
    const rs = out.map((q) => ({ x0: q!.cx - q!.w / 2, x1: q!.cx + q!.w / 2, y0: q!.cy - q!.h / 2, y1: q!.cy + q!.h / 2 }))
    expect(hit(rs[1], rs[2])).toBe(false)
    for (const r of rs) {
      expect(r.y0).toBeGreaterThanOrEqual(band.top)
      expect(r.y1).toBeLessThanOrEqual(band.floor)
    }
    expect(out[0]!.leader).toBeNull()
    expect(out[1]!.leader ?? out[2]!.leader).not.toBeNull()
    expect(placeUnderLabels(items, { ...band, floor: 110 })).toEqual([null, null, null])
  })
})

describe('histogram counts', () => {
  it('stay inside their row, and the bin width is stated in the title', () => {
    const p = { ...exampleDataPlot(), dist: 'hist' as const }
    const f = dataPlotFigure(p, 0)
    expect(f.title.question).toMatch(/^Histogram \(bin width 10\) and box plot/)
    for (const type of [1, 2.5]) {
      const { texts, toPx } = paint(f, 65, type)
      const plotTop = toPx(0, f.plot.y1).y
      const rowTop2 = toPx(0, (f.plot.y1 + f.plot.y0) / 2).y
      const counts = texts.filter((t) => /^\d+$/.test(t.text) && boxOf(t).y1 < rowTop2 + 2)
      for (const c of counts) expect(boxOf(c).y0, `count ${c.text} at ${type}×`).toBeGreaterThanOrEqual(plotTop - 1)
    }
  })
})

describe('panel titles', () => {
  const titled = (): [string, StatsFigure][] => {
    const prob = (view: ProbView): BoardStat => settleProb({ ...newProb(`P${view}`), view })
    const sim = { ...newSim('S', 2016), pop: 'proportion' as const, p: 0.58, stat: 'proportion' as const, n: 100, reps: 1000 }
    const stats: BoardStat[] = [newNormal('N'), sim, exampleDataPlot(), { ...exampleDataPlot(), id: 'H', dist: 'hist' }, prob('table'), prob('venn'), prob('tree')]
    const figs = statsFigures(stats)
    expect(figs).toHaveLength(stats.length)
    return figs.map((f, i) => [`${stats[i].type} ${i}`, f])
  }
  it('fit the panel at 2.5× (and 1.5×, 4×) and stay clear of every other word', () => {
    for (const [name, fig] of titled()) {
      for (const type of [1, 1.5, 2.5, 4]) {
        for (const ppu of [65, 40]) {
          const { texts, toPx } = paint(fig, ppu, type)
          const left = toPx(fig.panel.x0, 0).x
          const right = toPx(fig.panel.x1, 0).x
          const full = fig.title.question + fig.title.answer
          const inTitle = (t: TextItem): boolean => full.includes(t.text.replace(/…$/, '')) && t.font.bold && boxOf(t).y1 < toPx(0, fig.plot.y1).y + 2
          const title = texts.filter(inTitle)
          expect(title.length, `${name} has a title at ${type}× / ${ppu}`).toBeGreaterThan(0)
          for (const t of title) {
            const r = boxOf(t)
            expect(r.x0, `${name} “${t.text}” at ${type}× / ${ppu}`).toBeGreaterThanOrEqual(left)
            expect(r.x1, `${name} “${t.text}” at ${type}× / ${ppu}`).toBeLessThanOrEqual(right)
            // (at 4× on a zoomed-out board a two-way table's own words outgrow its cells)
            if (type > 2.5) continue
            for (const o of texts) {
              if (title.includes(o)) continue
              expect(hit(r, boxOf(o)), `${name}: title “${t.text}” on “${o.text}” at ${type}× / ${ppu}`).toBe(false)
            }
          }
        }
      }
    }
  })
  it('layoutTitle: shrinks, then wraps between " · " parts, and only then cuts short', () => {
    const measure = (text: string, px: number): number => text.length * px * 0.55
    const q = 'Dot plot and box plot · Period 1 vs Period 4'
    const a = ' · medians = 83.5 vs 79.5'
    const full = layoutTitle(q, a, 1000, 40, 13, 10, measure)
    expect(full.size).toBe(13)
    expect(full.lines).toHaveLength(1)
    const shrunk = layoutTitle(q, a, 450, 40, 13, 9, measure)
    expect(shrunk.lines).toHaveLength(1)
    expect(shrunk.size).toBeLessThan(13)
    expect(shrunk.width).toBeLessThanOrEqual(450 + 1e-6)
    const two = layoutTitle(q, a, 400, 60, 20, 15, measure)
    expect(two.lines).toHaveLength(2)
    expect(two.width).toBeLessThanOrEqual(400 + 1e-6)
    expect(two.lines[1][0].text.startsWith(' · ')).toBe(false)
    expect(two.lines.flat().some((r) => r.answer)).toBe(true)
    const cut = layoutTitle(q, a, 120, 14, 13, 10, measure)
    expect(cut.lines).toHaveLength(1)
    expect(cut.width).toBeLessThanOrEqual(120 + 1e-6)
    expect(cut.lines[0][cut.lines[0].length - 1].text.endsWith('…')).toBe(true)
  })
})

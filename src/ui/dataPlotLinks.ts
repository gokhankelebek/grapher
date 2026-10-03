// ============================================================================
// src/ui/dataPlotLinks.ts — the App's half of a one-variable data plot.
//
// The document stores a BoardDataPlot (src/core/statsPersist.ts): the lists as
// pasted, the values clicked out, the display and the bin width. This file
// turns that into
//
//   dataPlotView()     each set's summary before and after leaving values out,
//                      its fences, shape and recommended measures (cached)
//   dataPlotFigure()   what the board draws (src/render/stats.ts): the sets
//                      stacked on one shared number line — dot plot or
//                      histogram, and/or the modified box plot with outliers
//                      as separate points and the fences dashed
//   dataPlotSpots()    where each value's dot is, for "click a dot to leave it
//                      out" (and click again to put it back)
//   dataPlotCard()     what the card prints: the summary table, the quartile
//                      method, fences and outliers, shape, measures, the
//                      comparison sentence and the before / after table
//
// so the board, the card, the description and the export read the same
// numbers. Nothing computed here is stored.
// ============================================================================

import type { Vec2 } from '../core/types'
import type { BoardDataPlot, DataPlotSet } from '../core/statsPersist'
import { DATA_PLOT_COLOR_DEFAULT, MAX_SETS, cleanOff } from '../core/statsPersist'
import type { Effect, Fences, NamedSummary, Recommendation, Shape, Summary } from '../core/univariate'
import {
  compareSentence,
  defaultBinWidth,
  dotStacks,
  dotStep,
  exclusionEffect,
  fences,
  histogramBins,
  measuresFor,
  recommend,
  shapeOf,
  summarize,
} from '../core/univariate'
import { niceStep } from '../core/stats'
import type { DescribeStat } from '../core/describeAdapters'
import type { StatPrim, StatsFigure } from '../render/stats'
import { fixed, panelBox } from './statsLinks'
import type { Box } from './statsLinks'

export type { BoardDataPlot, DataPlotSet }

// ---------------------------------------------------------------------------
// New objects and examples
// ---------------------------------------------------------------------------

export function newDataPlot(id: string): BoardDataPlot {
  return { id, type: 'data', sets: [{ name: 'Set A', values: [] }], dist: 'dots', box: true, color: DATA_PLOT_COLOR_DEFAULT }
}

/** Two classes' unit-test scores: the card's ready-made comparison (Period 2 is higher and more spread out). */
export const EXAMPLE_SETS: readonly DataPlotSet[] = [
  { name: 'Period 1', values: [72, 75, 68, 80, 77, 74, 71, 79, 76, 73, 70, 78, 75, 74, 41, 77, 72, 76, 74, 79] },
  { name: 'Period 2', values: [85, 78, 92, 70, 88, 81, 95, 74, 83, 79, 90, 68, 86, 82, 77, 91, 73, 84, 80, 87] },
]

/** Each set's colour: the plot's own for the first, then these. */
export const SET_COLORS = ['#f97316', '#22c55e', '#e879f9', '#facc15', '#38bdf8']

export function setColor(p: BoardDataPlot, i: number): string {
  return i === 0 ? p.color : SET_COLORS[(i - 1) % SET_COLORS.length]
}

/** "Set C": the next letter no set is using. */
export function nextSetName(sets: readonly DataPlotSet[]): string {
  const used = new Set(sets.map((s) => s.name))
  for (let i = 0; i < 26; i++) {
    const n = `Set ${String.fromCharCode(65 + i)}`
    if (!used.has(n)) return n
  }
  return `Set ${sets.length + 1}`
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

const MINUS = '−'

/** Up to `d` decimals, trailing zeros dropped, a real minus: 78.25, 82, −1.5. */
export function short(v: number, d = 2): string {
  if (!Number.isFinite(v)) return '—'
  const t = String(Number(v.toFixed(d)))
  return t === '-0' ? '0' : t.replace('-', MINUS)
}

/** The card's table: up to 4 decimals, like a TI. */
export const four = (v: number): string => short(v, 4)

// ---------------------------------------------------------------------------
// The view: every set, before and after
// ---------------------------------------------------------------------------

export interface SetView {
  name: string
  color: string
  values: number[]
  /** Per value: is it in the analysis? */
  keep: boolean[]
  /** Indices the teacher clicked out. */
  off: Set<number>
  /** Indices the outlier switch dropped (1.5·IQR outliers of the values not clicked out). */
  dropped: Set<number>
  /** Every value. */
  all: Summary
  /** The values not clicked out, and their fences — what the outlier rule is applied to. */
  base: Summary
  baseFences: Fences
  /** What is analysed: the values kept. */
  live: Summary
  liveFences: Fences
  shape: Shape
  rec: Recommendation
}

function setView(p: BoardDataPlot, set: DataPlotSet, i: number): SetView {
  const values = set.values.filter((v) => Number.isFinite(v))
  const off = new Set(cleanOff(set.off, values.length))
  const baseVals = values.filter((_, k) => !off.has(k))
  const base = summarize(baseVals)
  const baseFences = fences(base)
  const dropped = new Set<number>()
  if (p.dropOutliers && baseFences.outliers.length > 0) {
    const tol = 1e-9 * Math.max(1, Math.abs(baseFences.lower), Math.abs(baseFences.upper))
    values.forEach((v, k) => {
      if (!off.has(k) && (v < baseFences.lower - tol || v > baseFences.upper + tol)) dropped.add(k)
    })
  }
  const keep = values.map((_, k) => !off.has(k) && !dropped.has(k))
  const live = summarize(values.filter((_, k) => keep[k]))
  const liveFences = fences(live)
  const shape = shapeOf(live, (v) => short(v))
  return {
    name: set.name || `Set ${String.fromCharCode(65 + i)}`,
    color: setColor(p, i),
    values,
    keep,
    off,
    dropped,
    all: summarize(values),
    base,
    baseFences,
    live,
    liveFences,
    shape,
    rec: recommend(live, shape, liveFences),
  }
}

const viewCache = new Map<string, SetView[]>()

/** Every set's numbers — a pure function of the stored plot, cached. */
export function dataPlotView(p: BoardDataPlot): SetView[] {
  const key = JSON.stringify([p.sets, p.dropOutliers === true, p.color])
  const hit = viewCache.get(key)
  if (hit) return hit
  const out = p.sets.slice(0, MAX_SETS).map((s, i) => setView(p, s, i))
  viewCache.set(key, out)
  if (viewCache.size > 32) {
    const first = viewCache.keys().next().value
    if (first !== undefined) viewCache.delete(first)
  }
  return out
}

/** Any value at all on the plot. */
export const hasData = (p: BoardDataPlot): boolean => p.sets.some((s) => s.values.length > 0)

/** The bin width the histogram uses: the typed one, else the default for every value on the plot. */
export function binWidthOf(p: BoardDataPlot): number {
  if (p.binWidth !== undefined && p.binWidth > 0 && Number.isFinite(p.binWidth)) return p.binWidth
  return defaultBinWidth(p.sets.flatMap((s) => s.values))
}

// ---------------------------------------------------------------------------
// Layout: rows on a shared number line
// ---------------------------------------------------------------------------

interface Row {
  top: number
  bottom: number
  /** The distribution's base line and its top (dot plot / histogram). */
  distBase: number
  distTop: number
  /** The box plot's centre line and half-height. */
  boxY: number
  boxHalf: number
}

interface Layout {
  panel: Box
  plot: Box
  lo: number
  hi: number
  toX(v: number): number
  rows: Row[]
  views: SetView[]
  /** Dot plot: the stacking step and one dot's diameter (board units). */
  step: number
  dot: number
  /** Histogram: shared bins. */
  binStart: number
  binW: number
  bins: number
}

const TITLE_BAND = 0.95
const AXIS_BAND = 0.95

function layout(p: BoardDataPlot, index: number): Layout {
  const panel = panelBox(index)
  const views = dataPlotView(p)
  const named = views.length > 1
  const plot: Box = {
    x0: panel.x0 + (named ? 2.1 : 0.6),
    x1: panel.x1 - 0.5,
    y0: panel.y0 + AXIS_BAND,
    y1: panel.y1 - TITLE_BAND,
  }
  const every = views.flatMap((v) => v.values)
  let lo = Math.min(...every)
  let hi = Math.max(...every)
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = 0
    hi = 10
  }
  const binW = binWidthOf(p)
  let binStart = 0
  let bins = 0
  if (p.dist === 'hist' && every.length > 0) {
    const b = histogramBins(every, binW)
    binStart = b.start
    bins = b.counts.length
    lo = Math.min(lo, binStart)
    hi = Math.max(hi, binStart + bins * binW)
  }
  const span = hi - lo
  const pad = span > 0 ? span * 0.05 : Math.max(1, Math.abs(lo) * 0.1)
  lo -= pad
  hi += pad
  const W = plot.x1 - plot.x0
  const toX = (v: number): number => plot.x0 + ((v - lo) / (hi - lo)) * W

  const k = Math.max(1, views.length)
  const rowH = (plot.y1 - plot.y0) / k
  const rows: Row[] = []
  for (let i = 0; i < k; i++) {
    const top = plot.y1 - i * rowH
    const bottom = top - rowH
    const padY = Math.min(0.12, rowH * 0.06)
    let distBase = bottom + padY
    let boxY = (top + bottom) / 2
    let boxHalf = Math.min(0.3, rowH * 0.2)
    if (p.box && p.dist !== 'none') {
      const band = Math.min(rowH * 0.4, 1.4)
      boxY = bottom + band / 2
      boxHalf = Math.min(band * 0.25, 0.3)
      distBase = bottom + band
    }
    rows.push({ top, bottom, distBase, distTop: top - padY, boxY, boxHalf })
  }

  // Dot plot: one shared step; a dot no wider than its step, no taller than its stack allows.
  const step = dotStep(every)
  let dot = 0.2
  if (p.dist === 'dots' && every.length > 0) {
    let tallest = 1
    for (const v of views) for (const st of dotStacks(v.values, step)) tallest = Math.max(tallest, st.idx.length)
    const across = (step / (hi - lo)) * W
    const H = Math.max(0.05, rows[0].distTop - rows[0].distBase)
    dot = Math.max(0.03, Math.min(across, H / tallest, 0.34))
  }
  return { panel, plot, lo, hi, toX, rows, views, step, dot, binStart, binW, bins }
}

// ---------------------------------------------------------------------------
// Where each value's dot is (for clicking one out)
// ---------------------------------------------------------------------------

export interface DotSpot {
  set: number
  /** Index into the set's values. */
  i: number
  pos: Vec2
  value: number
}

/**
 * Every value's dot on a dot plot; on a box plot alone, the outliers and the
 * values left out (the points a box plot draws one by one). A histogram has
 * no single values to click.
 */
export function dataPlotSpots(p: BoardDataPlot, index: number): DotSpot[] {
  if (!hasData(p)) return []
  const L = layout(p, index)
  const out: DotSpot[] = []
  L.views.forEach((v, si) => {
    const row = L.rows[si]
    if (p.dist === 'dots') {
      for (const st of dotStacks(v.values, L.step)) {
        st.idx.forEach((i, j) => out.push({ set: si, i, value: v.values[i], pos: { x: L.toX(st.at), y: row.distBase + (j + 0.5) * L.dot } }))
      }
    } else if (p.box) {
      const f = v.liveFences
      v.values.forEach((val, i) => {
        const outlier = v.keep[i] && (val < f.lower || val > f.upper)
        if (!v.keep[i] || outlier) out.push({ set: si, i, value: val, pos: { x: L.toX(val), y: row.boxY } })
      })
    }
  })
  return out
}

/** The set with value i clicked out — or back in. */
export function toggleOff(p: BoardDataPlot, set: number, i: number): BoardDataPlot {
  const sets = p.sets.map((s, k) => {
    if (k !== set) return s
    const off = new Set(cleanOff(s.off, s.values.length))
    if (off.has(i)) off.delete(i)
    else off.add(i)
    const list = [...off].sort((a, b) => a - b)
    const next: DataPlotSet = { name: s.name, values: s.values }
    if (list.length > 0) next.off = list
    return next
  })
  return { ...p, sets }
}

// ---------------------------------------------------------------------------
// The figure
// ---------------------------------------------------------------------------

export function dataPlotFigure(p: BoardDataPlot, index: number): StatsFigure {
  const L = layout(p, index)
  const { plot, panel, toX, rows, views } = L
  const prims: StatPrim[] = []
  const base: Omit<StatsFigure, 'prims' | 'ticks' | 'title' | 'axisY' | 'describe' | 'marks'> = {
    id: p.id,
    kind: 'data',
    visible: p.hidden !== true,
    color: p.color,
    panel,
    plot,
    zRow: false,
    axisLabel: '',
  }
  if (!hasData(p)) {
    return {
      ...base,
      prims: [{ k: 'text', at: { x: (plot.x0 + plot.x1) / 2, y: (plot.y0 + plot.y1) / 2 }, text: 'Paste the data on the card', ink: 'axis', rise: 0 }],
      ticks: [],
      marks: [],
      axisY: plot.y0,
      title: { question: 'One-variable data', answer: '' },
      describe: null,
    }
  }

  // Histogram: one count scale for every row, so taller means more.
  let maxCount = 1
  const histCounts: number[][] = []
  if (p.dist === 'hist') {
    for (const v of views) {
      const kept = v.values.filter((_, i) => v.keep[i])
      const b = histogramBins(kept, L.binW, L.binStart)
      // re-index onto the shared bins (histogramBins starts at the same multiple)
      const counts = new Array<number>(L.bins).fill(0)
      const shift = Math.round((b.start - L.binStart) / L.binW)
      b.counts.forEach((c, k) => {
        const j = k + shift
        if (j >= 0 && j < L.bins) counts[j] += c
      })
      histCounts.push(counts)
      for (const c of counts) maxCount = Math.max(maxCount, c)
    }
  }

  views.forEach((v, si) => {
    const row = rows[si]
    const color = v.color
    if (views.length > 1) {
      prims.push({ k: 'text', at: { x: plot.x0 - 0.2, y: (row.top + row.bottom) / 2 }, text: v.name, ink: 'main', color, rise: 0, align: 'end', bold: true })
    }
    if (p.dist !== 'none') {
      prims.push({ k: 'curve', pts: [{ x: plot.x0, y: row.distBase }, { x: plot.x1, y: row.distBase }], ink: 'axis', w: 0.8 })
    }
    if (p.dist === 'dots') {
      const on: Vec2[] = []
      const out: Vec2[] = []
      for (const st of dotStacks(v.values, L.step)) {
        st.idx.forEach((i, j) => {
          const at = { x: toX(st.at), y: row.distBase + (j + 0.5) * L.dot }
          if (v.keep[i]) on.push(at)
          else out.push(at)
        })
      }
      const r = L.dot * 0.42
      if (on.length) prims.push({ k: 'dots', pts: on, r, ink: 'main', color })
      if (out.length) prims.push({ k: 'ring', pts: out, r, ink: 'axis', dash: true })
    } else if (p.dist === 'hist') {
      const counts = histCounts[si]
      const H = row.distTop - row.distBase
      counts.forEach((c, k) => {
        if (c === 0) return
        const a = L.binStart + k * L.binW
        const y1 = row.distBase + (c / maxCount) * H * 0.86
        prims.push({ k: 'rect', x0: toX(a), x1: toX(a + L.binW), y0: row.distBase, y1, ink: 'main', color, alpha: 0.45 })
        if (L.bins <= 30) prims.push({ k: 'text', at: { x: toX(a + L.binW / 2), y: y1 + 0.17 }, text: String(c), ink: 'axis', small: true, rise: 0, avoid: true })
      })
    }
    // the mean, as the balance point under the distribution (an answer)
    if (p.dist !== 'none' && v.live.n > 0) {
      const mx = toX(v.live.mean)
      const h = Math.max(0.08, Math.min(0.16, row.distBase - row.bottom))
      prims.push({ k: 'fill', pts: [{ x: mx, y: row.distBase }, { x: mx - h * 0.6, y: row.distBase - h }, { x: mx + h * 0.6, y: row.distBase - h }], ink: 'obs', alpha: 1, answer: true })
    }
    if (p.box && v.live.n > 0) {
      const s = v.live
      const f = v.liveFences
      const y = row.boxY
      const hh = row.boxHalf
      prims.push({ k: 'rect', x0: toX(s.q1), x1: toX(s.q3), y0: y - hh, y1: y + hh, ink: 'main', color, alpha: 0.16 })
      prims.push({ k: 'vline', x: toX(s.median), y0: y - hh, y1: y + hh, ink: 'main', color, w: 2.6 })
      prims.push({ k: 'curve', pts: [{ x: toX(f.whiskerLo), y }, { x: toX(s.q1), y }], ink: 'main', color, w: 1.6 })
      prims.push({ k: 'curve', pts: [{ x: toX(s.q3), y }, { x: toX(f.whiskerHi), y }], ink: 'main', color, w: 1.6 })
      prims.push({ k: 'vline', x: toX(f.whiskerLo), y0: y - hh * 0.55, y1: y + hh * 0.55, ink: 'main', color, w: 1.6 })
      prims.push({ k: 'vline', x: toX(f.whiskerHi), y0: y - hh * 0.55, y1: y + hh * 0.55, ink: 'main', color, w: 1.6 })
      if (f.outliers.length > 0) {
        prims.push({ k: 'dots', pts: f.outliers.map((o) => ({ x: toX(o), y })), r: Math.min(0.09, hh * 0.45), ink: 'main', color })
      }
      // values left out sit on the box line as dashed rings (dot plots show them in their stacks)
      if (p.dist !== 'dots') {
        const out = v.values.filter((_, i) => !v.keep[i]).map((o) => ({ x: toX(o), y }))
        if (out.length) prims.push({ k: 'ring', pts: out, r: Math.min(0.09, hh * 0.45), ink: 'axis', dash: true })
      }
      // the fences the outlier rule used, dashed, when they flag something
      if (v.baseFences.outliers.length > 0) {
        for (const fx of [v.baseFences.lower, v.baseFences.upper]) {
          if (fx < L.lo || fx > L.hi) continue
          prims.push({ k: 'vline', x: toX(fx), y0: y - hh * 1.5, y1: y + hh * 1.5, ink: 'rule', w: 1.1, dash: [3, 3] })
        }
      }
      // the five-number summary under the box (answers)
      const labelY = y - hh - 0.2
      for (const val of [s.median, s.q1, s.q3, f.whiskerLo, f.whiskerHi]) {
        prims.push({ k: 'text', at: { x: toX(val), y: labelY }, text: short(val), ink: 'main', color, small: true, rise: 0, avoid: true, answer: true })
      }
    }
  })

  // ---- the shared number line
  const step = niceStep((L.hi - L.lo) / 7)
  const ticks: StatsFigure['ticks'] = []
  const dTick = Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
  for (let v = Math.ceil(L.lo / step) * step; v <= L.hi + 1e-9 * step; v += step) {
    ticks.push({ x: toX(v), text: fixed(Math.abs(v) < step * 1e-9 ? 0 : v, dTick), z: '' })
  }
  if (p.dist === 'hist') {
    prims.push({ k: 'text', at: { x: plot.x1, y: plot.y1 }, text: `bin width ${short(L.binW, 6)}`, ink: 'axis', small: true, rise: 0, align: 'right' })
  }

  // ---- the title: what is shown, and its centre / spread (the answer)
  const live = views.filter((v) => v.live.n > 0)
  const shows = [p.dist === 'dots' ? 'Dot plot' : p.dist === 'hist' ? 'Histogram' : '', p.box ? (p.dist === 'none' ? 'Box plot' : 'box plot') : '']
    .filter(Boolean)
    .join(' and ')
  let question: string
  let answer = ''
  if (views.length === 1) {
    const v = views[0]
    question = `${shows || 'Data'} · ${v.name} · n = ${v.live.n}`
    if (v.live.n > 0) {
      answer = v.rec.use === 'median-iqr' ? ` · median = ${short(v.live.median)}, IQR = ${short(v.live.iqr)}` : ` · mean = ${short(v.live.mean)}, SD = ${short(v.live.sdSample)}`
    }
  } else {
    question = `${shows || 'Data'} · ${views.map((v) => v.name).join(' vs ')}`
    if (live.length >= 2) {
      const m = measuresFor(live.map(named))
      answer = ` · ${m === 'median-iqr' ? 'medians' : 'means'} = ${live.map((v) => short(m === 'median-iqr' ? v.live.median : v.live.mean)).join(' vs ')}`
    }
  }
  const describe: DescribeStat = {
    kind: 'data',
    dist: p.dist,
    box: p.box,
    binWidth: p.dist === 'hist' ? L.binW : null,
    sets: views.map((v) => ({
      name: v.name,
      n: v.live.n,
      left: v.values.length - v.live.n,
      five: [v.live.min, v.live.q1, v.live.median, v.live.q3, v.live.max],
      mean: v.live.mean,
      sd: v.live.sdSample,
      outliers: v.liveFences.outliers,
      shape: v.shape.words,
    })),
    compare: compareSentence(live.map(named), (x) => short(x)),
  }
  return { ...base, prims, ticks, marks: [], axisY: plot.y0, title: { question, answer }, describe }
}

const named = (v: SetView): NamedSummary => ({ name: v.name, s: v.live, shape: v.shape, fences: v.liveFences })

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export interface DataPlotCardSet {
  name: string
  color: string
  n: number
  /** The summary table's column: label → value text. */
  table: { key: string; label: string; value: string }[]
  fences: { lower: string; upper: string; outliers: string[] }
  shape: string
  shapeReason: string
  recommend: string
  effect: Effect | null
  /** Values clicked out and dropped as outliers, for the "left out" line. */
  leftOut: { i: number; value: string; why: 'clicked' | 'outlier' }[]
}

export interface DataPlotCardData {
  summary: string
  ok: boolean
  sets: DataPlotCardSet[]
  compare: string
  binWidth: number
  binAuto: boolean
}

/** The quartile method, as the card states it. */
export const QUARTILE_METHOD =
  'Quartiles by the TI-84 / AP method: Q1 and Q3 are the medians of the lower and upper halves, leaving out the median itself when n is odd.'

export function dataPlotCard(p: BoardDataPlot): DataPlotCardData {
  const views = dataPlotView(p)
  const sets: DataPlotCardSet[] = views.map((v) => {
    const s = v.live
    const modes = s.modes.length === 0 ? 'none' : s.modes.length > 4 ? `${s.modes.slice(0, 4).map(four).join(', ')} …` : s.modes.map(four).join(', ')
    const left = v.values.length - s.n
    return {
      name: v.name,
      color: v.color,
      n: s.n,
      table: [
        { key: 'n', label: 'n', value: String(s.n) },
        { key: 'mean', label: 'mean x̄', value: four(s.mean) },
        { key: 'sdSample', label: 'Sx (sample SD)', value: four(s.sdSample) },
        { key: 'sdPop', label: 'σx (population SD)', value: four(s.sdPop) },
        { key: 'min', label: 'min', value: four(s.min) },
        { key: 'q1', label: 'Q1', value: four(s.q1) },
        { key: 'median', label: 'median', value: four(s.median) },
        { key: 'q3', label: 'Q3', value: four(s.q3) },
        { key: 'max', label: 'max', value: four(s.max) },
        { key: 'range', label: 'range', value: four(s.range) },
        { key: 'iqr', label: 'IQR', value: four(s.iqr) },
        { key: 'mode', label: 'mode', value: modes },
      ],
      fences: {
        lower: four(v.baseFences.lower),
        upper: four(v.baseFences.upper),
        outliers: v.baseFences.outliers.map(four),
      },
      shape: `${v.name} ${v.shape.words}`,
      shapeReason: v.shape.reason,
      recommend: v.rec.sentence,
      effect: left > 0 ? exclusionEffect(v.values, v.keep, (x) => short(x)) : null,
      leftOut: v.values.flatMap((val, i) => (v.keep[i] ? [] : [{ i, value: four(val), why: v.off.has(i) ? ('clicked' as const) : ('outlier' as const) }])),
    }
  })
  const live = views.filter((v) => v.live.n > 0)
  const ok = live.length > 0
  let summary: string
  if (!ok) summary = 'One-variable data · paste a list'
  else if (views.length === 1) {
    const v = views[0]
    summary =
      v.rec.use === 'median-iqr'
        ? `n = ${v.live.n} · median = ${short(v.live.median)}, IQR = ${short(v.live.iqr)}`
        : `n = ${v.live.n} · mean = ${short(v.live.mean)}, SD = ${short(v.live.sdSample)}`
  } else {
    const m = measuresFor(live.map(named))
    summary = `${views.length} sets · ${m === 'median-iqr' ? 'medians' : 'means'} = ${live.map((v) => short(m === 'median-iqr' ? v.live.median : v.live.mean)).join(' vs ')}`
  }
  return {
    summary,
    ok,
    sets,
    compare: compareSentence(live.map(named), (x) => short(x)),
    binWidth: binWidthOf(p),
    binAuto: p.binWidth === undefined,
  }
}

/** Short name for a card and a toast. */
export const dataPlotName = 'One-variable data'

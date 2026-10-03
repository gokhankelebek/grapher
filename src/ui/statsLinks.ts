// ============================================================================
// src/ui/statsLinks.ts — the App's half of the statistics objects.
//
// The document stores a BoardStat (src/core/statsPersist.ts): a normal
// distribution's μ, σ, mode and bounds, or a simulation's population, n,
// number of samples, groups and SEED. This file turns that into
//
//   statsFigure()   what the board draws (src/render/stats.ts): a panel with
//                   its own axis — the bell curve and its shading, the
//                   empirical rule, the z row; or a dot plot / histogram of
//                   simulated statistics with the theoretical curve, the
//                   observed difference and the extreme tail
//   normalCard()    what the normal card prints: P(…) = P(z…) ≈ 0.6827, the
//   simCard()       z-score working, the percentile; the simulation's mean
//                   and SD, margins of error, interval, p-value and sentence
//   statsBox()      the panel's frame, for "Zoom to it" and a fitted export
//   simResult()     the simulation itself, cached by settings + seed
//
// so the board, the card, the description and the export read the same
// numbers and cannot disagree. Nothing computed here is stored.
//
// THE PANEL. A statistics figure carries its own axis (raw values, and a z
// row), so it sits in a fixed frame on the board — 12 × 7 units, stacked
// downward by its place in the board's list — with an opaque ground under it.
// ============================================================================

import type { Vec2 } from '../core/types'
import {
  EMPIRICAL_RULE,
  binCounts,
  invNorm,
  marginOfError,
  meanSd,
  niceStep,
  normalPdf,
  normalProbability,
  randomizationTest,
  simulateSamples,
  successShare,
  theoryOf,
  zScore,
  zStar,
} from '../core/stats'
import type { NormalMode, Population, RandomizationResult, Tail } from '../core/stats'
import type { BoardDataPlot, BoardNormal, BoardSim, BoardStat } from '../core/statsPersist'
import { SIM_COLOR_DEFAULT, STAT_COLOR_DEFAULT } from '../core/statsPersist'
import { freshSeed } from '../core/stats'
import type { DescribeStat } from '../core/describeAdapters'
import type { StatPrim, StatsFigure } from '../render/stats'
import { dataPlotFigure, dataPlotName } from './dataPlotLinks'
import { probFigure, probName } from './probLinks'

export type { BoardDataPlot, BoardNormal, BoardSim, BoardStat }

// ---------------------------------------------------------------------------
// New objects
// ---------------------------------------------------------------------------

export function newNormal(id: string): BoardNormal {
  return { id, type: 'normal', mu: 100, sigma: 15, mode: 'between', a: 85, b: 130, pct: 90, color: STAT_COLOR_DEFAULT }
}

/** A plant-growth experiment (cm): the class's ready-made two-group example. */
export const EXAMPLE_GROUP_A = [14.2, 15.1, 13.8, 16.4, 15.9, 14.7, 16.1, 15.3, 14.9, 15.6]
export const EXAMPLE_GROUP_B = [14.1, 15.0, 13.6, 14.8, 13.9, 15.2, 14.4, 13.2, 15.1, 14.5]

export function newSim(id: string, seed: number = freshSeed()): BoardSim {
  return {
    id,
    type: 'sim',
    mode: 'sample',
    pop: 'normal',
    mu: 100,
    sigma: 15,
    p: 0.5,
    list: [],
    stat: 'mean',
    n: 30,
    reps: 1000,
    seed,
    plot: 'dots',
    groupA: [],
    groupB: [],
    tail: 'two',
    color: SIM_COLOR_DEFAULT,
  }
}

// ---------------------------------------------------------------------------
// Numbers as the figure and the card write them
// ---------------------------------------------------------------------------

const MINUS = '−'
const uni = (s: string): string => s.replace(/-/g, MINUS)

/** Fixed decimals, Unicode minus, no "−0.00". */
export function fixed(v: number, d: number): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : v < 0 ? `${MINUS}∞` : '—'
  const s = v.toFixed(d)
  return uni(/^-0(\.0+)?$/.test(s) ? s.slice(1) : s)
}

/** A typed value as the teacher would write it: up to 6 significant digits. */
export function val(v: number): string {
  if (!Number.isFinite(v)) return fixed(v, 0)
  return uni(String(Number(v.toPrecision(6))))
}

/** Probability to 4 decimals; a far tail in scientific form rather than 0.0000. */
export function prob(p: number): string {
  if (!Number.isFinite(p)) return '—'
  if (p > 0 && p < 0.00005) return uni(p.toExponential(2).replace('e', '×10^'))
  return fixed(p, 4)
}

const probTex = (p: number): string => {
  if (p > 0 && p < 0.00005) {
    const [m, e] = p.toExponential(2).split('e')
    return `${m} \\times 10^{${Number(e)}}`
  }
  return fixed(p, 4).replace(/−/g, '-')
}

const tex = (s: string): string => s.replace(/−/g, '-')

/** "90th", "1st", "2.5th". */
export function ordinal(pct: number): string {
  const s = val(pct)
  if (!/^\d+$/.test(s)) return `${s}th`
  const n = Number(s)
  const last2 = n % 100
  const suf = last2 >= 11 && last2 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'
  return `${s}${suf}`
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

export const STAT_W = 12
export const STAT_H = 7
const STAT_GAP = 1.5

/** The panel of the index-th statistics object on the board (stacked downward). */
export function panelBox(index: number): Box {
  const y1 = STAT_H / 2 - Math.max(0, index) * (STAT_H + STAT_GAP)
  return { x0: -STAT_W / 2, x1: STAT_W / 2, y1, y0: y1 - STAT_H }
}

/** The frame "Zoom to it" and a fitted export ask for: the panel with a little air. */
export function statsBox(index: number): { min: Vec2; max: Vec2 } {
  const b = panelBox(index)
  return { min: { x: b.x0 - 0.3, y: b.y0 - 0.3 }, max: { x: b.x1 + 0.3, y: b.y1 + 0.3 } }
}

const TITLE_BAND = 0.95
const SIDE = 0.6

function plotBox(panel: Box, twoRows: boolean): Box {
  return {
    x0: panel.x0 + SIDE,
    x1: panel.x1 - SIDE,
    y0: panel.y0 + (twoRows ? 1.45 : 0.95),
    y1: panel.y1 - TITLE_BAND,
  }
}

/** The value ↔ board mapping of one figure. */
export interface Frame {
  lo: number
  hi: number
  yMax: number
}

export interface Geometry extends Frame {
  panel: Box
  plot: Box
  toX(v: number): number
  toY(d: number): number
  fromX(x: number): number
}

function geometry(panel: Box, plot: Box, f: Frame): Geometry {
  const W = plot.x1 - plot.x0
  const H = plot.y1 - plot.y0
  const span = f.hi - f.lo || 1
  return {
    ...f,
    panel,
    plot,
    toX: (v) => plot.x0 + ((v - f.lo) / span) * W,
    toY: (d) => plot.y0 + (d / (f.yMax || 1)) * H,
    fromX: (x) => f.lo + ((x - plot.x0) / W) * span,
  }
}

// ---------------------------------------------------------------------------
// The normal distribution
// ---------------------------------------------------------------------------

/** The natural frame: μ ± 4.3σ, and room above the peak for the empirical rule's brackets. */
export function normalFrame(n: BoardNormal): Frame {
  const peak = normalPdf(n.mu, n.mu, n.sigma)
  // ±4.3σ: the ±4σ ticks sit inside the axis, clear of the x / z row captions.
  return { lo: n.mu - 4.3 * n.sigma, hi: n.mu + 4.3 * n.sigma, yMax: peak * (n.rule ? 1.5 : 1.16) }
}

export function normalGeometry(n: BoardNormal, index: number, frame: Frame | null = null): Geometry {
  const panel = panelBox(index)
  return geometry(panel, plotBox(panel, n.zRow !== false), frame ?? normalFrame(n))
}

/** The x the percentile mode marks. */
export const percentileX = (n: BoardNormal): number => invNorm(n.pct / 100, n.mu, n.sigma)

/** The bounds the mode uses, in order (one for below / above / percentile). */
export function normalBounds(n: BoardNormal): number[] {
  if (n.mode === 'percentile') return [percentileX(n)]
  if (n.mode === 'below' || n.mode === 'above') return [n.a]
  return [Math.min(n.a, n.b), Math.max(n.a, n.b)]
}

/** P(…) for the card and the figure; for percentile, the share below x (= pct/100). */
export function normalP(n: BoardNormal): number {
  if (n.mode === 'percentile') return n.pct / 100
  return normalProbability(n.mode, n.mu, n.sigma, n.a, n.b)
}

/** "P(85 < X < 130)" — the question, Unicode. */
export function normalQuestion(n: BoardNormal): string {
  const [a, b] = normalBounds(n)
  switch (n.mode) {
    case 'below':
      return `P(X < ${val(a)})`
    case 'above':
      return `P(X > ${val(a)})`
    case 'between':
      return `P(${val(a)} < X < ${val(b)})`
    case 'outside':
      return `P(X < ${val(a)} or X > ${val(b)})`
    case 'percentile':
      return `${ordinal(n.pct)} percentile`
  }
}

const PDF_SAMPLES = 160

function pdfPath(g: Geometry, mu: number, sigma: number, a: number, b: number): Vec2[] {
  const pts: Vec2[] = []
  const lo = Math.max(a, g.lo)
  const hi = Math.min(b, g.hi)
  if (!(hi > lo)) return pts
  const steps = Math.max(8, Math.round((PDF_SAMPLES * (hi - lo)) / (g.hi - g.lo || 1)))
  for (let i = 0; i <= steps; i++) {
    const v = lo + ((hi - lo) * i) / steps
    pts.push({ x: g.toX(v), y: g.toY(normalPdf(v, mu, sigma)) })
  }
  return pts
}

function areaPoly(g: Geometry, mu: number, sigma: number, a: number, b: number): Vec2[] {
  const top = pdfPath(g, mu, sigma, a, b)
  if (top.length < 2) return []
  return [{ x: top[0].x, y: g.toY(0) }, ...top, { x: top[top.length - 1].x, y: g.toY(0) }]
}

export interface FigureOpts {
  /** The frame held still while a handle is dragged. */
  frame?: Frame | null
  /** A simulation's samples shown so far while Play builds it up. */
  shown?: number | null
}

export function normalFigure(n: BoardNormal, index: number, opts: FigureOpts = {}): StatsFigure {
  const g = normalGeometry(n, index, opts.frame ?? null)
  const { mu, sigma } = n
  const prims: StatPrim[] = []
  const peak = normalPdf(mu, mu, sigma)
  const p = normalP(n)
  const bounds = normalBounds(n)
  const zs = bounds.map((v) => zScore(v, mu, sigma))

  // ---- the shaded probability
  const regions: [number, number][] =
    n.mode === 'below' || n.mode === 'percentile'
      ? [[-Infinity, bounds[0]]]
      : n.mode === 'above'
        ? [[bounds[0], Infinity]]
        : n.mode === 'between'
          ? [[bounds[0], bounds[1]]]
          : [[-Infinity, bounds[0]], [bounds[1], Infinity]]
  for (const [a, b] of regions) {
    const poly = areaPoly(g, mu, sigma, a, b)
    if (poly.length > 2) prims.push({ k: 'fill', pts: poly, ink: 'main', alpha: 0.38 })
  }

  // ---- the empirical rule: dashed lines at μ ± kσ, brackets above the curve
  if (n.rule) {
    for (const r of EMPIRICAL_RULE) {
      const level = peak * (0.96 + 0.15 * r.k)
      for (const s of [-1, 1]) {
        const v = mu + s * r.k * sigma
        prims.push({ k: 'vline', x: g.toX(v), y0: g.toY(0), y1: g.toY(level), ink: 'rule', dash: [5, 4], w: 1.2 })
      }
      prims.push({ k: 'bracket', x0: g.toX(mu - r.k * sigma), x1: g.toX(mu + r.k * sigma), y: g.toY(level), text: r.text, ink: 'rule' })
    }
    prims.push({ k: 'vline', x: g.toX(mu), y0: g.toY(0), y1: g.toY(peak), ink: 'rule', dash: [2, 3], w: 1 })
    const bands: [number, number, string][] = [
      [0, 1, '34%'],
      [1, 2, '13.5%'],
      [2, 3, '2.35%'],
      [3, 4, '0.15%'],
    ]
    for (const [k0, k1, text] of bands) {
      for (const s of [-1, 1]) {
        const v = mu + (s * (k0 + k1) * sigma) / 2
        prims.push({ k: 'text', at: { x: g.toX(v), y: g.toY(0) }, text, ink: 'rule', small: true, rise: k0 === 0 ? 0.12 : k0 === 1 ? 0.09 : 0.06 })
      }
    }
  }

  // ---- the curve itself
  prims.push({ k: 'curve', pts: pdfPath(g, mu, sigma, g.lo, g.hi), ink: 'main', w: 2.6 })

  // ---- the bounds: a line up to the curve, and the probability in the region
  const marks: StatsFigure['marks'] = []
  bounds.forEach((v, i) => {
    if (!(v >= g.lo && v <= g.hi)) return
    prims.push({ k: 'vline', x: g.toX(v), y0: g.toY(0), y1: g.toY(normalPdf(v, mu, sigma)), ink: 'main', w: 2 })
    marks.push({ x: g.toX(v), text: n.mode === 'percentile' ? fixed(v, 2) : val(v), z: `z = ${fixed(zs[i], 2)}`, answerZ: true, answerText: n.mode === 'percentile' })
  })
  const center = (() => {
    const [a, b] = regions[0]
    const lo = Math.max(a, g.lo)
    const hi = Math.min(b, g.hi)
    if (n.mode === 'between') return (lo + hi) / 2
    if (n.mode === 'outside') return null
    // a one-sided region: its label sits a third of the way in from the bound
    return n.mode === 'above' ? lo + (hi - lo) * 0.3 : hi - (hi - lo) * 0.3
  })()
  if (center !== null && Number.isFinite(center)) {
    const at = { x: g.toX(center), y: g.toY(Math.min(normalPdf(center, mu, sigma) * 0.42, peak * 0.42)) }
    prims.push({ k: 'chip', at, text: n.mode === 'percentile' ? `${val(n.pct)}%` : prob(p), ink: 'main', answer: n.mode !== 'percentile' })
  } else if (n.mode === 'outside') {
    for (const [a, b] of regions) {
      const lo = Math.max(a, g.lo)
      const hi = Math.min(b, g.hi)
      if (!(hi > lo)) continue
      const v = a === -Infinity ? hi - (hi - lo) * 0.35 : lo + (hi - lo) * 0.35
      const pp = a === -Infinity ? normalProbability('below', mu, sigma, b, b) : normalProbability('above', mu, sigma, a, a)
      prims.push({ k: 'chip', at: { x: g.toX(v), y: g.toY(peak * 0.2) }, text: prob(pp), ink: 'main', answer: true })
    }
  }

  // ---- the axis: μ + kσ for k = −4 … 4 in raw values, and z beneath
  const ticks: StatsFigure['ticks'] = []
  for (let k = -4; k <= 4; k++) {
    const v = mu + k * sigma
    if (v < g.lo - 1e-9 * sigma || v > g.hi + 1e-9 * sigma) continue
    if (bounds.some((b) => Math.abs(b - v) < 0.25 * sigma)) {
      ticks.push({ x: g.toX(v), text: '', z: '' })
      continue
    }
    ticks.push({ x: g.toX(v), text: val(v), z: k === 0 ? '0' : fixed(k, 0) })
  }
  const title =
    n.mode === 'percentile'
      ? { q: `X ~ N(${val(mu)}, ${val(sigma)}) · ${ordinal(n.pct)} percentile:`, a: ` x ≈ ${fixed(bounds[0], 2)}` }
      : { q: `X ~ N(${val(mu)}, ${val(sigma)}) · ${normalQuestion(n)} ≈`, a: ` ${prob(p)}` }
  return {
    id: n.id,
    kind: 'normal',
    visible: n.hidden !== true,
    color: n.color,
    panel: g.panel,
    plot: g.plot,
    prims,
    axisY: g.toY(0),
    ticks,
    marks,
    zRow: n.zRow !== false,
    axisLabel: 'x',
    title: { question: title.q, answer: title.a },
    describe: {
      kind: 'normal',
      mu,
      sigma,
      mode: n.mode,
      bounds,
      z: zs,
      p,
      pct: n.pct,
      rule: n.rule === true,
    },
  }
}

// ---------------------------------------------------------------------------
// The normal card
// ---------------------------------------------------------------------------

export interface NormalCardData {
  /** "N(100, 15) · P(85 < X < 130) ≈ 0.8186". */
  summary: string
  question: string
  /** The probability to 4 decimals (percentile: the share below). */
  p: number
  pText: string
  /** P(85 < X < 130) = P(−1 < Z < 2) ≈ 0.8186 — the question side, then the answer. */
  probTex: { question: string; answer: string } | null
  /** The z-score working, one line per bound. */
  zWork: { tex: string; z: number }[]
  /** Percentile mode: z = invNorm(p), then x = μ + zσ. */
  percentile: { z: number; x: number; zTex: string; xTex: string } | null
  /** The empirical rule's shares, exact and as taught. */
  rule: { k: number; text: string; exact: string; lo: string; hi: string }[]
}

function zSide(mode: Exclude<NormalMode, 'percentile'>, zs: number[], xs: number[]): { x: string; z: string } {
  const v = (s: number[], i: number): string => tex(fixed(s[i], 2))
  const xv = (i: number): string => tex(val(xs[i]))
  switch (mode) {
    case 'below':
      return { x: `P(X < ${xv(0)})`, z: `P(Z < ${v(zs, 0)})` }
    case 'above':
      return { x: `P(X > ${xv(0)})`, z: `P(Z > ${v(zs, 0)})` }
    case 'between':
      return { x: `P(${xv(0)} < X < ${xv(1)})`, z: `P(${v(zs, 0)} < Z < ${v(zs, 1)})` }
    case 'outside':
      return {
        x: `P(X < ${xv(0)} \\text{ or } X > ${xv(1)})`,
        z: `P(Z < ${v(zs, 0)}) + P(Z > ${v(zs, 1)})`,
      }
  }
}

export function normalCard(n: BoardNormal): NormalCardData {
  const bounds = normalBounds(n)
  const zs = bounds.map((v) => zScore(v, n.mu, n.sigma))
  const p = normalP(n)
  const question = normalQuestion(n)
  const zWork = bounds.map((v, i) => {
    const sub = bounds.length > 1 ? `_${i + 1}` : ''
    return {
      z: zs[i],
      tex: `z${sub} = \\dfrac{${tex(val(v))} - ${tex(val(n.mu))}}{${tex(val(n.sigma))}} = ${tex(fixed(zs[i], 2))}`,
    }
  })
  let probTexOut: NormalCardData['probTex'] = null
  let percentile: NormalCardData['percentile'] = null
  let summary: string
  if (n.mode === 'percentile') {
    const z = zScore(bounds[0], n.mu, n.sigma)
    const x = bounds[0]
    percentile = {
      z,
      x,
      zTex: `z = \\text{invNorm}(${tex(val(n.pct / 100))}) \\approx ${tex(fixed(z, 4))}`,
      xTex: `x = \\mu + z\\sigma = ${tex(val(n.mu))} + (${tex(fixed(z, 4))})(${tex(val(n.sigma))}) \\approx ${tex(fixed(x, 2))}`,
    }
    summary = `N(${val(n.mu)}, ${val(n.sigma)}) · ${question}: x ≈ ${fixed(x, 2)}`
  } else {
    const side = zSide(n.mode, zs, bounds)
    probTexOut = { question: `${side.x} = ${side.z}`, answer: probTex(p) }
    summary = `N(${val(n.mu)}, ${val(n.sigma)}) · ${question} ≈ ${prob(p)}`
  }
  return {
    summary,
    question,
    p,
    pText: prob(p),
    probTex: probTexOut,
    zWork: n.mode === 'percentile' ? [] : zWork,
    percentile,
    rule: EMPIRICAL_RULE.map((r) => ({
      k: r.k,
      text: r.text,
      exact: fixed(r.exact * 100, 2),
      lo: val(n.mu - r.k * n.sigma),
      hi: val(n.mu + r.k * n.sigma),
    })),
  }
}

/** A bound or μ snapped to a step that suits σ: 1 for σ = 15, 0.1 for σ = 1. */
export function snapStep(sigma: number): number {
  return niceStep(Math.max(1e-9, sigma) / 10)
}

export function snapTo(v: number, step: number): number {
  const s = Math.round(v / step) * step
  return Number(s.toPrecision(12))
}

// ---------------------------------------------------------------------------
// The simulation
// ---------------------------------------------------------------------------

export function populationOf(s: BoardSim): Population | null {
  if (s.pop === 'normal') return { kind: 'normal', mu: s.mu, sigma: s.sigma }
  if (s.pop === 'proportion') return { kind: 'proportion', p: s.p }
  return s.list.length > 0 ? { kind: 'list', values: s.list } : null
}

/** The statistic actually computed: a normal population gives means, a proportion gives p̂. */
export function statOf(s: BoardSim): 'mean' | 'proportion' {
  if (s.pop === 'normal') return 'mean'
  if (s.pop === 'proportion') return 'proportion'
  return s.stat
}

export type SimResult =
  | {
      mode: 'sample'
      values: Float64Array
      mean: number
      sd: number
      theory: { center: number; sd: number } | null
    }
  | ({ mode: 'compare' } & RandomizationResult)

const cache = new Map<string, SimResult | null>()
const CACHE_MAX = 24

function cacheKey(s: BoardSim): string {
  if (s.mode === 'compare') return JSON.stringify(['c', s.groupA, s.groupB, s.reps, s.seed, s.tail])
  return JSON.stringify(['s', s.pop, s.mu, s.sigma, s.p, s.pop === 'list' ? s.list : 0, statOf(s), s.n, s.reps, s.seed])
}

/** The simulation's results — a pure function of its settings and seed, cached. */
export function simResult(s: BoardSim): SimResult | null {
  const key = cacheKey(s)
  if (cache.has(key)) {
    const hit = cache.get(key) ?? null
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  let out: SimResult | null = null
  if (s.mode === 'compare') {
    const r = randomizationTest(s.groupA, s.groupB, s.reps, s.seed, s.tail)
    out = r ? { mode: 'compare', ...r } : null
  } else {
    const pop = populationOf(s)
    if (pop) {
      const stat = statOf(s)
      const values = simulateSamples(pop, stat, s.n, s.reps, s.seed)
      const { mean, sd } = meanSd(values)
      out = { mode: 'sample', values, mean, sd, theory: theoryOf(pop, stat, s.n) }
    }
  }
  cache.set(key, out)
  while (cache.size > CACHE_MAX) {
    const first = cache.keys().next().value
    if (first === undefined) break
    cache.delete(first)
  }
  return out
}

/** "≈ 0.023", or "< 0.001" when no re-randomisation was as extreme (never "≈ 0"). */
export function pText(extreme: number, reps: number): string {
  if (reps <= 0) return '—'
  if (extreme === 0) return `< ${val(1 / reps)}`
  return `≈ ${fixed(extreme / reps, 3)}`
}

/** "x̄" or "p̂" — the statistic's symbol. */
export const statSymbol = (s: BoardSim): string => (statOf(s) === 'proportion' ? 'p̂' : 'x̄')

const CONFIDENCES = [0.9, 0.95, 0.99] as const

export interface SimCardData {
  summary: string
  ok: boolean
  error: string | null
  /** Sample mode. */
  sample: {
    symbol: string
    mean: string
    sd: string
    theoryCenter: string | null
    theorySd: string | null
    theorySdTex: string | null
    /** The statistic an interval is centred on, and where it came from. */
    observed: number
    observedFrom: 'sample 1' | 'typed'
    me: { c: number; label: string; zStar: string; me: string; lo: string; hi: string }[]
  } | null
  /** Compare mode. */
  compare: {
    nA: number
    nB: number
    meanA: string
    meanB: string
    observed: string
    extreme: number
    reps: number
    p: string
    sentence: string
    conclusion: string
  } | null
}

const popWords = (s: BoardSim): string =>
  s.pop === 'normal'
    ? `a normal population (μ = ${val(s.mu)}, σ = ${val(s.sigma)})`
    : s.pop === 'proportion'
      ? `a population with proportion p = ${val(s.p)}`
      : `the pasted list of ${s.list.length} value${s.list.length === 1 ? '' : 's'}`

export function simCard(s: BoardSim): SimCardData {
  const r = simResult(s)
  if (s.mode === 'compare') {
    if (!r || r.mode !== 'compare') {
      return {
        summary: 'Compare treatments · paste both groups',
        ok: false,
        error: 'Paste the measurements for both groups (at least one value each).',
        sample: null,
        compare: null,
      }
    }
    const mA = meanSd(s.groupA).mean
    const mB = meanSd(s.groupB).mean
    const dirWord = s.tail === 'two' ? 'at least as large (in either direction) as' : s.tail === 'upper' ? 'at least as large as' : 'at most'
    const pWords = pText(r.extreme, r.diffs.length)
    const sentence = `In ${r.extreme} of ${r.diffs.length} re-randomisations the difference in means was ${dirWord} the observed ${fixed(r.observed, 2)}, so p ${pWords}.`
    const conclusion =
      r.p < 0.05
        ? `That rarely happens by chance alone (p < 0.05): the difference is statistically significant — evidence that the treatment made a difference.`
        : `A difference this large happens often by chance alone (p ≥ 0.05): it is not statistically significant — no convincing evidence that the treatment made a difference.`
    return {
      summary: `Compare treatments · difference ${fixed(r.observed, 2)} · p ${pWords}`,
      ok: true,
      error: null,
      sample: null,
      compare: {
        nA: s.groupA.length,
        nB: s.groupB.length,
        meanA: fixed(mA, 3),
        meanB: fixed(mB, 3),
        observed: fixed(r.observed, 3),
        extreme: r.extreme,
        reps: r.diffs.length,
        p: pWords,
        sentence,
        conclusion,
      },
    }
  }
  if (!r || r.mode !== 'sample') {
    return {
      summary: 'Sampling simulation · paste a population',
      ok: false,
      error: 'Paste the population’s values (at least one number).',
      sample: null,
      compare: null,
    }
  }
  const sym = statSymbol(s)
  const observed = s.observed !== undefined && Number.isFinite(s.observed) ? s.observed : r.values[0]
  const prop = statOf(s) === 'proportion'
  const d = prop ? 3 : 2
  const me = CONFIDENCES.map((c) => {
    const m = marginOfError(c, r.sd)
    return {
      c,
      label: `${Math.round(c * 100)}%`,
      zStar: fixed(zStar(c), 3),
      me: fixed(m, d + 1),
      lo: fixed(observed - m, d + 1),
      hi: fixed(observed + m, d + 1),
    }
  })
  const theory = r.theory
  const sdTex = theory
    ? prop
      ? `\\sqrt{\\dfrac{p(1-p)}{n}} = \\sqrt{\\dfrac{${tex(val(theory.center))}(${tex(val(1 - theory.center))})}{${s.n}}} \\approx ${tex(fixed(theory.sd, 4))}`
      : `\\dfrac{\\sigma}{\\sqrt{n}} = \\dfrac{${tex(val(s.pop === 'normal' ? s.sigma : theory.sd * Math.sqrt(s.n)))}}{\\sqrt{${s.n}}} \\approx ${tex(fixed(theory.sd, 4))}`
    : null
  return {
    summary: `${s.reps} sample ${prop ? 'proportions' : 'means'} · n = ${s.n} · mean ${fixed(r.mean, d + 1)}, SD ${fixed(r.sd, d + 1)}`,
    ok: true,
    error: null,
    sample: {
      symbol: sym,
      mean: fixed(r.mean, d + 1),
      sd: fixed(r.sd, d + 1),
      theoryCenter: theory ? val(theory.center) : null,
      theorySd: theory ? fixed(theory.sd, 4) : null,
      theorySdTex: sdTex,
      observed,
      observedFrom: s.observed !== undefined ? 'typed' : 'sample 1',
      me,
    },
    compare: null,
  }
}

/**
 * The spacing of a statistic that only takes values on a lattice (k/n, or a
 * difference of means of data measured to 0.1), or null when it is continuous.
 */
export function latticeStep(values: ArrayLike<number>): number | null {
  const m = Math.min(values.length, 3000)
  if (m < 2) return null
  const xs: number[] = []
  for (let i = 0; i < m; i++) xs.push(values[i])
  xs.sort((a, b) => a - b)
  const range = xs[xs.length - 1] - xs[0]
  if (!(range > 0)) return null
  const tol = 1e-7 * Math.max(1, Math.abs(xs[0]), Math.abs(xs[xs.length - 1]))
  let d = Infinity
  const gaps: number[] = []
  for (let i = 1; i < xs.length; i++) {
    const g = xs[i] - xs[i - 1]
    if (g > tol) {
      gaps.push(g)
      if (g < d) d = g
    }
  }
  if (!Number.isFinite(d) || range / d > 2000) return null
  for (const g of gaps) if (Math.abs(g / d - Math.round(g / d)) > 1e-4) return null
  return d
}

/** The values the plot shows: the sample statistics, or the re-randomised differences. */
function plotted(r: SimResult): Float64Array {
  return r.mode === 'sample' ? r.values : r.diffs
}

function minMax(v: Float64Array): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < v.length; i++) {
    if (v[i] < lo) lo = v[i]
    if (v[i] > hi) hi = v[i]
  }
  return [lo, hi]
}

export function simFigure(s: BoardSim, index: number, opts: FigureOpts = {}): StatsFigure {
  const panel = panelBox(index)
  const plot = plotBox(panel, false)
  const r = simResult(s)
  const prims: StatPrim[] = []
  const base: Omit<StatsFigure, 'prims' | 'ticks' | 'title' | 'axisY' | 'describe' | 'marks'> = {
    id: s.id,
    kind: 'sim',
    visible: s.hidden !== true,
    color: s.color,
    panel,
    plot,
    zRow: false,
    axisLabel: s.mode === 'compare' ? 'difference in means (A − B)' : `sample ${statOf(s) === 'proportion' ? 'proportion p̂' : 'mean x̄'}`,
  }
  if (!r) {
    return {
      ...base,
      prims: [{ k: 'text', at: { x: (plot.x0 + plot.x1) / 2, y: (plot.y0 + plot.y1) / 2 }, text: s.mode === 'compare' ? 'Paste both groups on the card' : 'Paste the population on the card', ink: 'axis', rise: 0 }],
      ticks: [],
      marks: [],
      axisY: plot.y0,
      title: { question: s.mode === 'compare' ? 'Compare treatments' : 'Sampling simulation', answer: '' },
      describe: null,
    }
  }
  const values = plotted(r)
  const N = values.length
  const shown = opts.shown !== undefined && opts.shown !== null ? Math.max(0, Math.min(N, Math.floor(opts.shown))) : N
  const [vmin, vmax] = minMax(values)

  // ---- the value range
  let lo: number
  let hi: number
  if (r.mode === 'sample') {
    const c = r.theory?.center ?? r.mean
    const sd = Math.max(r.theory?.sd ?? 0, r.sd, 1e-9)
    lo = Math.min(c - 4 * sd, vmin)
    hi = Math.max(c + 4 * sd, vmax)
  } else {
    const m = Math.max(Math.abs(vmin), Math.abs(vmax), Math.abs(r.observed)) * 1.12 || 1
    lo = -m
    hi = m
  }
  const pad = 0.02 * (hi - lo || 1)
  lo -= pad
  hi += pad
  const prop = r.mode === 'sample' && statOf(s) === 'proportion'
  let width = niceStep((hi - lo) / (s.plot === 'hist' ? 30 : 110))
  let start = Math.floor(lo / width) * width
  // Discrete statistics (p̂ = k/n; a difference of means of measured data)
  // sit on a lattice. Bins a whole number of lattice steps wide, centred on
  // lattice points, so no bin gets two values and its neighbour none.
  const lattice = latticeStep(values)
  if (lattice !== null && lattice > width / 8) {
    width = lattice * Math.max(1, Math.round(width / lattice))
    const v0 = values[0]
    const edge = v0 - lattice / 2
    start = edge - width * Math.ceil((edge - lo) / width)
  }
  const bins = Math.max(1, Math.ceil((hi - start) / width))
  lo = start
  hi = start + bins * width
  const full = binCounts(values, start, width, bins)
  const counts = shown === N ? full : binCounts(values, start, width, bins, shown)
  const maxCount = Math.max(1, ...full)
  const maxDensity = maxCount / (N * width)
  const theoryPeak =
    r.mode === 'sample' && r.theory && s.theory !== false && r.theory.sd > 0 ? normalPdf(r.theory.center, r.theory.center, r.theory.sd) : 0
  let yMax = Math.max(maxDensity, theoryPeak) * 1.14

  const plotW = plot.x1 - plot.x0
  const plotH = plot.y1 - plot.y0
  const binW = (plotW * width) / (hi - lo)
  // Dots: one dot is `per` statistics, and a dot's height is its share of the
  // density scale — so a stack meets the theoretical curve where it should.
  // `per` grows until a dot is about as tall as its column is wide; with few
  // samples the scale stretches instead, so the dots stack without gaps.
  let per = 1
  if (s.plot === 'dots') {
    const target = binW * 0.92
    per = Math.max(1, Math.floor((target * N * width * yMax) / plotH))
    const fit = (per * plotH) / (N * width * target)
    if (fit > yMax) yMax = fit
  }
  const g = geometry(panel, plot, { lo, hi, yMax })
  const isHot = (v: number): boolean => {
    if (r.mode !== 'compare') return false
    const eps = 1e-9 * Math.max(1, Math.abs(r.observed))
    if (s.tail === 'upper') return v >= r.observed - eps
    if (s.tail === 'lower') return v <= r.observed + eps
    return Math.abs(v) >= Math.abs(r.observed) - eps
  }

  if (s.plot === 'hist') {
    for (let k = 0; k < bins; k++) {
      if (counts[k] === 0) continue
      const a = start + k * width
      const d = counts[k] / (N * width)
      prims.push({ k: 'rect', x0: g.toX(a), x1: g.toX(a + width), y0: g.toY(0), y1: g.toY(d), ink: isHot(a + width / 2) ? 'hot' : 'main', alpha: 0.55 })
    }
  } else {
    const cold: Vec2[] = []
    const hot: Vec2[] = []
    const dotH = (g.toY(per / (N * width)) - g.toY(0))
    for (let k = 0; k < bins; k++) {
      const dots = Math.ceil(counts[k] / per)
      const cx = g.toX(start + (k + 0.5) * width)
      const into = isHot(start + (k + 0.5) * width) ? hot : cold
      for (let j = 0; j < dots; j++) into.push({ x: cx, y: g.toY(0) + (j + 0.5) * dotH })
    }
    const rad = Math.max(0.004, Math.min(binW, dotH) * 0.44)
    if (cold.length) prims.push({ k: 'dots', pts: cold, r: rad, ink: 'main' })
    if (hot.length) prims.push({ k: 'dots', pts: hot, r: rad, ink: 'hot' })
  }

  const marks: StatsFigure['marks'] = []
  let title: StatsFigure['title']
  let describe: DescribeStat
  const done = shown === N
  if (r.mode === 'sample') {
    const sym = statSymbol(s)
    if (r.theory && s.theory !== false && r.theory.sd > 0) {
      prims.push({ k: 'curve', pts: pdfPath(g, r.theory.center, r.theory.sd, lo, hi), ink: 'theory', w: 2.4 })
      prims.push({
        k: 'chip',
        at: { x: g.toX(r.theory.center + 1.6 * r.theory.sd), y: g.toY(normalPdf(r.theory.center + 1.6 * r.theory.sd, r.theory.center, r.theory.sd)) },
        text: `theory: N(${val(r.theory.center)}, ${fixed(r.theory.sd, prop ? 4 : 3)})`,
        ink: 'theory',
        dir: { x: 1, y: -1 },
      })
    }
    if (done) {
      prims.push({ k: 'vline', x: g.toX(r.mean), y0: g.toY(0), y1: g.toY(yMax * 0.94), ink: 'obs', w: 2, dash: [6, 4] })
      for (const sgn of [-1, 1]) {
        const v = r.mean + sgn * r.sd
        prims.push({ k: 'vline', x: g.toX(v), y0: g.toY(0), y1: g.toY(yMax * 0.7), ink: 'obs', w: 1.2, dash: [2, 4] })
      }
      prims.push({
        k: 'chip',
        at: { x: g.toX(r.mean), y: g.toY(yMax * 0.94) },
        text: `mean ${fixed(r.mean, prop ? 4 : 3)} · SD ${fixed(r.sd, prop ? 4 : 3)}`,
        ink: 'obs',
        dir: { x: -1, y: -0.2 },
        answer: true,
      })
    }
    title = {
      question: `${shown < N ? `${shown} of ` : ''}${N} sample ${prop ? 'proportions p̂' : 'means x̄'} · n = ${s.n} from ${s.pop === 'normal' ? `N(${val(s.mu)}, ${val(s.sigma)})` : s.pop === 'proportion' ? `p = ${val(s.p)}` : 'the list'}`,
      answer: '',
    }
    describe = {
      kind: 'sample',
      population: popWords(s),
      stat: statOf(s),
      symbol: sym,
      n: s.n,
      reps: N,
      plot: s.plot,
      theory: r.theory && s.theory !== false ? r.theory : null,
      mean: r.mean,
      sd: r.sd,
      me95: marginOfError(0.95, r.sd),
    }
  } else {
    const obsX = g.toX(r.observed)
    prims.push({ k: 'vline', x: obsX, y0: g.toY(0), y1: g.toY(yMax * 0.95), ink: 'obs', w: 2.2 })
    marks.push({ x: obsX, text: fixed(r.observed, 2), z: '', answerZ: false, answerText: false, ink: 'obs' })
    if (s.tail === 'two' && Math.abs(r.observed) > 1e-12) {
      prims.push({ k: 'vline', x: g.toX(-r.observed), y0: g.toY(0), y1: g.toY(yMax * 0.95), ink: 'obs', w: 1.4, dash: [6, 4] })
    }
    prims.push({
      k: 'chip',
      at: { x: obsX, y: g.toY(yMax * 0.95) },
      text: `observed ${fixed(r.observed, 2)}`,
      ink: 'obs',
      dir: { x: r.observed >= 0 ? 1 : -1, y: -0.3 },
    })
    if (done) {
      prims.push({
        k: 'chip',
        at: { x: g.toX(lo + 0.03 * (hi - lo)), y: g.toY(yMax * 0.82) },
        text: `p ${pText(r.extreme, N)} (${r.extreme} of ${N})`,
        ink: 'hot',
        dir: { x: 1, y: 0 },
        answer: true,
      })
    }
    title = {
      question: `${shown < N ? `${shown} of ` : ''}${N} re-randomisations · groups of ${s.groupA.length} and ${s.groupB.length}`,
      answer: '',
    }
    describe = {
      kind: 'compare',
      nA: s.groupA.length,
      nB: s.groupB.length,
      reps: N,
      plot: s.plot,
      observed: r.observed,
      extreme: r.extreme,
      p: r.p,
      tail: s.tail,
    }
  }

  // ---- the axis: nice ticks across the range
  const step = niceStep((hi - lo) / 6)
  const ticks: StatsFigure['ticks'] = []
  const dTick = Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9 * step; v += step) {
    const x = g.toX(v)
    if (marks.some((m) => Math.abs(m.x - x) < 0.45)) {
      ticks.push({ x, text: '', z: '' })
      continue
    }
    ticks.push({ x, text: fixed(Math.abs(v) < step * 1e-9 ? 0 : v, dTick), z: '' })
  }
  if (s.plot === 'dots' && per > 1) {
    prims.push({ k: 'text', at: { x: plot.x1, y: plot.y1 }, text: `each dot = ${per} samples`, ink: 'axis', small: true, rise: 0, align: 'right' })
  }
  return { ...base, prims, ticks, marks, axisY: g.toY(0), title, describe }
}

// ---------------------------------------------------------------------------
// Either kind
// ---------------------------------------------------------------------------

export function statsFigure(s: BoardStat, index: number, opts: FigureOpts = {}): StatsFigure {
  if (s.type === 'data') return dataPlotFigure(s, index)
  if (s.type === 'prob') return probFigure(s, index)
  return s.type === 'normal' ? normalFigure(s, index, opts) : simFigure(s, index, opts)
}

/** The figures for a board's list, each at its own place in the stack. */
export function statsFigures(list: readonly BoardStat[], opts: (s: BoardStat) => FigureOpts = () => ({})): StatsFigure[] {
  const out: StatsFigure[] = []
  list.forEach((s, i) => {
    try {
      out.push(statsFigure(s, i, opts(s)))
    } catch {
      /* one object failing must not cost the board */
    }
  })
  return out
}

/** Short name for a card and a toast. */
export const statName = (s: BoardStat): string =>
  s.type === 'prob' ? probName : s.type === 'data' ? dataPlotName : s.type === 'normal' ? 'Normal distribution' : s.mode === 'compare' ? 'Compare treatments' : 'Sampling simulation'

// ---------------------------------------------------------------------------
// Play: the simulation builds up
// ---------------------------------------------------------------------------

/** A whole build-up lasts about this many seconds at 1×. */
const BUILD_SECONDS = 5

export function simPlayStep(shown: number, dt: number, speed: number, total: number): { shown: number; done: boolean } {
  const rate = Math.max(total / BUILD_SECONDS, 20)
  // Slow at first so the first dots are seen one by one, then faster.
  const ease = shown < total * 0.05 ? 0.35 : 1
  const next = shown + Math.max(1, dt * speed * rate * ease)
  if (next >= total) return { shown: total, done: true }
  return { shown: next, done: false }
}

/** Successes in a list (1s), for the card's "p = …" of a 0/1 list. */
export const listShare = (s: BoardSim): number => successShare(s.list)

export type { Tail }

// ============================================================================
// src/ui/residualLinks.ts — a data table's residual plot (NC Math 1 S-ID.6b,
// S-ID.8).
//
// A regression on a table can show its RESIDUAL PLOT: residual = y − ŷ against
// x, in a panel right under the scatter plot (the same x, so each residual
// sits under its own point), with a dashed line at 0 — and on the card, the
// verdict ("no clear pattern, so a linear model appears appropriate" / "a
// curved pattern, so a linear model may not be appropriate"), r in words for a
// linear fit, and the reminder that correlation is not causation.
//
// The residuals are the fit's own (full precision, as a TI's RESID list), not
// distances to the rounded curve. The document stores only the switch
// (DataRegression.residualPlot); everything here is recomputed.
// ============================================================================

import type { RegressionKind, RegressionResult } from '../core/data'
import type { CorrelationWords, ResidualPattern } from '../core/residuals'
import { correlationWords, residualPattern, residualZeroTol } from '../core/residuals'
import { niceStep } from '../core/stats'
import type { DescribeStat } from '../core/describeAdapters'
import type { StatPrim, StatsFigure } from '../render/stats'
import type { BoardData, DataColumns, DataRegression } from './dataLinks'
import { KIND_NAME, dataColumns, modelWords, pointsBox, residualPairs, residualPanelOf, residualPlotReg, statText } from './dataLinks'
import { fixed } from './statsLinks'

/** The figure id of a table's residual plot (its reveal key is statKey of this). */
export const residFigId = (dataId: string): string => `resid:${dataId}`

export interface ResidualInfo {
  dataId: string
  regId: string
  kind: RegressionKind
  table: string
  xs: number[]
  residuals: number[]
  /** The y of each residual's point (the data's scale). */
  ys: number[]
  pattern: ResidualPattern
  /** r for a linear fit (and its words); null for the others, which report R². */
  r: number | null
  rWords: CorrelationWords | null
}

export { modelWords }

/** The residuals of `reg` on its table, their verdict and r — null when the fit failed. */
export function residualInfo(
  data: BoardData,
  reg: DataRegression,
  fit: (cols: DataColumns, kind: RegressionKind) => RegressionResult,
): ResidualInfo | null {
  const cols = dataColumns(data.rows)
  if (cols.xs.length === 0) return null
  const res = fit(cols, reg.kind)
  if (!res.ok) return null
  const { xs, residuals, ys } = residualPairs(cols, res)
  const r = reg.kind === 'linear' && res.r !== undefined && Number.isFinite(res.r) ? res.r : null
  return {
    dataId: data.id,
    regId: reg.id,
    kind: reg.kind,
    table: data.name,
    xs,
    residuals,
    ys,
    pattern: residualPattern(xs, residuals, modelWords(reg.kind), ys),
    r,
    rWords: r === null ? null : correlationWords(r, statText(r), data.xLabel || 'x', data.yLabel || 'y'),
  }
}

/** A table's residual plot, or null when it shows none (or the fit failed). */
export function residualFigure(
  data: BoardData,
  curveIds: ReadonlySet<string>,
  fit: (cols: DataColumns, kind: RegressionKind) => RegressionResult,
): StatsFigure | null {
  const reg = residualPlotReg(data, curveIds)
  if (!reg) return null
  const pts = pointsBox(data)
  if (!pts) return null
  const info = residualInfo(data, reg, fit)
  const { panel, plot } = residualPanelOf(pts)
  const id = residFigId(data.id)
  const base: Omit<StatsFigure, 'prims' | 'ticks' | 'title' | 'axisY' | 'describe' | 'marks'> = {
    id,
    kind: 'resid',
    visible: data.visible,
    color: data.color,
    panel,
    plot,
    zRow: false,
    axisLabel: data.xLabel || 'x',
    yLabel: 'residual',
  }
  if (!info) {
    return {
      ...base,
      prims: [{ k: 'text', at: { x: (plot.x0 + plot.x1) / 2, y: (plot.y0 + plot.y1) / 2 }, text: 'The fit is not available for this data', ink: 'axis', rise: 0 }],
      ticks: [],
      marks: [],
      axisY: plot.y0,
      title: { question: `Residual plot · ${KIND_NAME[reg.kind]}`, answer: '' },
      describe: null,
    }
  }
  // The vertical scale never goes below a small share of the data's own
  // scale: an exact fit's 10⁻¹⁵ rounding would otherwise fill the panel and
  // look like a pattern. An exact fit draws every residual ON the zero line.
  const exact = info.pattern.exact === true
  const residuals = exact ? info.residuals.map(() => 0) : info.residuals
  const floor = Math.max(residualZeroTol(info.ys) * 1e5, 1e-300)
  let m = 0
  for (const r of residuals) m = Math.max(m, Math.abs(r))
  if (exact || !(m > 0)) m = residualZeroTol(info.ys) > 0 ? residualZeroTol(info.ys) * 1e7 : 1
  m = Math.max(m, floor)
  const yMax = m * 1.2
  const mid = (plot.y0 + plot.y1) / 2
  const half = (plot.y1 - plot.y0) / 2
  const toY = (r: number): number => mid + (r / yMax) * half
  const prims: StatPrim[] = []
  prims.push({ k: 'curve', pts: [{ x: plot.x0, y: toY(0) }, { x: plot.x1, y: toY(0) }], ink: 'axis', w: 1.3, dash: [6, 4] })
  const w = panel.x1 - panel.x0
  prims.push({ k: 'dots', pts: info.xs.map((x, i) => ({ x, y: toY(residuals[i]) })), r: w * 0.0065, ink: 'main' })

  // the vertical axis: residual ticks symmetric about 0
  const yStep = niceStep(yMax / 2)
  const dY = Math.max(0, -Math.floor(Math.log10(yStep) + 1e-9))
  const yTicks: { y: number; text: string }[] = []
  for (let v = -Math.floor(yMax / yStep) * yStep; v <= yMax + 1e-9 * yStep; v += yStep) {
    yTicks.push({ y: toY(v), text: fixed(Math.abs(v) < yStep * 1e-9 ? 0 : v, dY) })
  }
  // the horizontal axis: the data's x
  const xStep = niceStep((plot.x1 - plot.x0) / 6)
  const dX = Math.max(0, -Math.floor(Math.log10(xStep) + 1e-9))
  const ticks: StatsFigure['ticks'] = []
  for (let v = Math.ceil(plot.x0 / xStep) * xStep; v <= plot.x1 + 1e-9 * xStep; v += xStep) {
    ticks.push({ x: v, text: fixed(Math.abs(v) < xStep * 1e-9 ? 0 : v, dX), z: '' })
  }
  const verdict = info.pattern.verdict
  const describe: DescribeStat = {
    kind: 'resid',
    table: info.table,
    model: KIND_NAME[info.kind].toLowerCase(),
    n: info.residuals.length,
    maxAbs: m,
    verdict,
    sentence: info.pattern.sentence,
    r: info.r,
  }
  return {
    ...base,
    prims,
    ticks,
    marks: [],
    axisY: plot.y0,
    yTicks,
    title: {
      question: `Residual plot · ${KIND_NAME[info.kind]} model`,
      answer: exact ? ' · exact fit' : verdict === 'none' ? ' · no clear pattern' : verdict === 'curved' ? ' · curved pattern' : '',
    },
    describe,
  }
}

/** Every table's residual plot, in table order. */
export function residualFigures(
  list: readonly BoardData[],
  curveIds: ReadonlySet<string>,
  fit: (cols: DataColumns, kind: RegressionKind) => RegressionResult,
): StatsFigure[] {
  const out: StatsFigure[] = []
  for (const d of list) {
    try {
      const f = residualFigure(d, curveIds, fit)
      if (f) out.push(f)
    } catch {
      /* one table failing must not cost the board */
    }
  }
  return out
}

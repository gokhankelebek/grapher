// ============================================================================
// src/render/stats.ts — a statistics figure, drawn.
//
// A normal curve with its shaded probability, the empirical rule's brackets
// and a z row under the raw values; or a dot plot / histogram of simulated
// statistics with the theoretical curve, the observed mean or difference and
// the extreme tail. Each figure sits on its own opaque panel with its own
// axis: the board's grid means nothing to a density, so it does not show
// through. Everything is laid out (in board units) by src/ui/statsLinks.ts;
// this file only paints.
//
// FIGURE, not chrome: every stroke goes through renderBoard, so it reaches the
// PNG / SVG / PDF / TikZ exports, and under a mono figure style (SAT, AP)
// every ink is the axis black and every fill a grey wash.
//
// All lengths are CSS px BEFORE `present.stroke` / `present.type`.
// ============================================================================

import type { Theme, Vec2, Viewport } from '../core/types'
import { ppuX, ppuY } from '../core/types'
import type { DescribeStat } from '../core/describeAdapters'
import { labelFont, paintScale } from './grid'
import type { PaintScale } from './grid'

/** Named inks: the object's own colour, and one per role. */
export type StatInk = 'main' | 'theory' | 'obs' | 'hot' | 'rule' | 'axis'

export const STAT_INK: Record<Exclude<StatInk, 'main' | 'axis'>, string> = {
  theory: '#f9a825',
  obs: '#f95f62',
  hot: '#f95f62',
  rule: '#8b93b0',
}

export interface StatBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * Everything in BOARD units except where a field says px. `color`, where a
 * primitive has it, overrides the named ink with an object's own colour (one
 * per data set on a data plot); a mono figure style still paints it black.
 */
export type StatPrim =
  | { k: 'curve'; pts: Vec2[]; ink: StatInk; w: number; dash?: number[]; color?: string }
  | { k: 'fill'; pts: Vec2[]; ink: StatInk; alpha: number; color?: string; answer?: boolean }
  /** `edge: false`: the wash alone, no outline (a two-way table's highlighted row, column or cell). */
  | { k: 'rect'; x0: number; y0: number; x1: number; y1: number; ink: StatInk; alpha: number; color?: string; edge?: false }
  /**
   * A Venn diagram: the universe `box` and its circles, with the regions in
   * `atoms` shaded — atom m is the region inside circle i exactly when bit i
   * of m is set (0 = outside every circle); `atoms` has bit m set for each
   * shaded atom. Shading is clipped to the circles, so arcs stay arcs in the
   * vector exports.
   */
  | { k: 'venn'; box: StatBox; circles: { x: number; y: number; r: number }[]; atoms: number; ink: StatInk; alpha: number; color?: string }
  /** Many dots of one radius (board units). */
  | { k: 'dots'; pts: Vec2[]; r: number; ink: StatInk; color?: string }
  /** Many hollow rings of one radius (board units): values left out, outliers. */
  | { k: 'ring'; pts: Vec2[]; r: number; ink: StatInk; color?: string; dash?: boolean }
  | { k: 'vline'; x: number; y0: number; y1: number; ink: StatInk; w?: number; dash?: number[]; color?: string }
  /** ←── 68% ──→ between x0 and x1 at height y. */
  | { k: 'bracket'; x0: number; x1: number; y: number; text: string; ink: StatInk }
  /** A value chip stepped off `at` along `dir` (screen, y down). */
  | { k: 'chip'; at: Vec2; text: string; ink: StatInk; dir?: Vec2; answer?: boolean }
  /**
   * Plain text at `at`, raised by `rise` × the plot's height. 'center' and
   * 'right' as before ('right' hangs from its point); 'start' / 'end' are
   * left- / right-aligned on the middle line. `avoid`: skipped when it would
   * overlap text already placed. `answer`: reveal mode masks it.
   *
   * `lift`: the text's BOTTOM sits this many px (before `present.type`) above
   * `at` instead of its middle line on it — a count over a bar, at any zoom.
   * `ceil`: its top never rises above this board y (its row's top edge).
   *
   * `under`: a label hung under a box plot (see UnderSpec) — laid out with
   * the rest of its group in px, not at `at.y`.
   */
  | {
      k: 'text'
      at: Vec2
      text: string
      ink: StatInk
      small?: boolean
      rise: number
      align?: 'center' | 'right' | 'start' | 'end'
      color?: string
      avoid?: boolean
      answer?: boolean
      bold?: boolean
      lift?: number
      ceil?: number
      under?: UnderSpec
    }

/**
 * A box plot's five-number labels. Their room is a band in BOARD units (from
 * `top`, just under the box and its fences, down to `floor`, the row's bottom
 * edge — the axis line on the lowest row), but their size is in PX, so where
 * they go can only be settled at paint time, at the zoom and type scale in
 * force. The labels of one `group` are placed together, in prim order (the
 * first wins any crowding): under their value when there is room, otherwise
 * dropped to a lower tier or nudged to the side (`side`: −1 left, 1 right,
 * 0 either), joined to their value by a hairline leader; they step around
 * any vertical rule that reaches into the band (an outlier fence). A label
 * that fits nowhere is not drawn — a label never lands on the box, the axis,
 * its ticks, another row or another label.
 */
export interface UnderSpec {
  group: string
  top: number
  floor: number
  side: -1 | 0 | 1
  /** Board y a leader starts from: the bottom of the box or whisker cap the label names. */
  from?: number
}

export interface StatsFigure {
  id: string
  kind: 'normal' | 'sim' | 'data' | 'resid' | 'prob'
  visible: boolean
  color: string
  /** The opaque panel. */
  panel: StatBox
  /** Where the data are plotted. */
  plot: StatBox
  prims: StatPrim[]
  /** The axis line's height. */
  axisY: number
  /** No horizontal axis at all (a two-way table, a Venn or a tree diagram). */
  noAxis?: true
  /** Ticks with their raw-value label and (normal) z label. An empty text keeps the tick only. */
  ticks: { x: number; text: string; z: string }[]
  /** Emphasised ticks: the bounds, the observed difference. */
  marks: { x: number; text: string; z: string; answerZ: boolean; answerText: boolean; ink?: StatInk }[]
  /** Draw the z row under the raw values. */
  zRow: boolean
  /** What the axis measures ("x", "sample mean x̄"). */
  axisLabel: string
  /** A vertical axis at the plot's left edge (a residual plot's): ticks and what it measures. */
  yTicks?: { y: number; text: string }[]
  yLabel?: string
  /** The title band: the question, and its answer (masked in reveal mode). */
  title: { question: string; answer: string }
  /** The figure in words (src/core/describeAdapters.ts describeStats). */
  describe: DescribeStat | null
}

export interface StatsPaintOpts {
  vp: Viewport
  theme: Theme
  paint?: (c: string) => string
  mono?: boolean
  scale?: PaintScale | null
  font?: 'sans' | 'serif' | null
}

/** A rectangle in px (y down). */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
export const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** A line segment in px. */
export interface Seg2 {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Does the segment pass through the rectangle's inside? (Liang–Barsky.) */
export function segHitsRect(s: Seg2, r: Rect): boolean {
  const dx = s.x1 - s.x0
  const dy = s.y1 - s.y0
  let t0 = 0
  let t1 = 1
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q > 0
    const t = q / p
    if (p < 0) {
      if (t > t1) return false
      if (t > t0) t0 = t
    } else {
      if (t < t0) return false
      if (t < t1) t1 = t
    }
    return true
  }
  if (!clip(-dx, s.x0 - r.x)) return false
  if (!clip(dx, r.x + r.w - s.x0)) return false
  if (!clip(-dy, s.y0 - r.y)) return false
  if (!clip(dy, r.y + r.h - s.y0)) return false
  return t1 - t0 > 1e-9
}

/** One run of a title line: its text, and whether it is the answer (the object's ink, masked in reveal). */
export interface TitleRun {
  text: string
  answer: boolean
  /** px from the line's left edge. */
  dx: number
  w: number
}

export interface TitleLayout {
  /** Type size in px. */
  size: number
  /** Line height in px. */
  lineH: number
  /** Each line's runs; a line's width is its last run's dx + w. */
  lines: TitleRun[][]
  /** The widest line, px. */
  width: number
}

/**
 * Fit a panel's title (its question, then its answer) into `maxW` px across
 * and `maxH` px down, at `size` px or less: one line at full size if it fits;
 * else one line shrunk, down to `minSize`; else two lines, broken between
 * " · " parts (the break that balances them best), as large as fits, when
 * the band is tall enough; else one line shrunk down to 10px; else one line
 * at 10px cut short with "…". `measure(text, px)` is the bold title face's
 * width. Pure.
 */
export function layoutTitle(
  question: string,
  answer: string,
  maxW: number,
  maxH: number,
  size: number,
  minSize: number,
  measure: (text: string, px: number) => number,
): TitleLayout {
  const LH = 1.22
  // the parts, each " · …" piece separately, tagged question / answer
  const parts: { text: string; answer: boolean }[] = []
  for (const [text, isAnswer] of [[question, false], [answer, true]] as const) {
    if (!text) continue
    for (const bit of text.split(/(?= · )/)) if (bit) parts.push({ text: bit, answer: isAnswer })
  }
  const lineOf = (ps: readonly { text: string; answer: boolean }[], px: number): TitleRun[] => {
    // one run per colour (a line never starts with its separator)
    const merged: { text: string; answer: boolean }[] = []
    ps.forEach((p, i) => {
      const text = i === 0 ? p.text.replace(/^ · /, '') : p.text
      const last = merged[merged.length - 1]
      if (last && last.answer === p.answer) last.text += text
      else merged.push({ text, answer: p.answer })
    })
    const out: TitleRun[] = []
    let dx = 0
    for (const m of merged) {
      // a run's leading space is advanced over, not drawn (an SVG would drop it)
      const text = m.text.replace(/^\s+/, '')
      if (text.length < m.text.length) dx += measure(m.text, px) - measure(text, px)
      const w = measure(text, px)
      out.push({ text, answer: m.answer, dx, w })
      dx += w
    }
    return out
  }
  const widthOf = (l: readonly TitleRun[]): number => (l.length ? l[l.length - 1].dx + l[l.length - 1].w : 0)
  const make = (lines: TitleRun[][], px: number): TitleLayout => ({ size: px, lineH: px * LH, lines, width: Math.max(0, ...lines.map(widthOf)) })
  // sizes in tenths of a px, rounded down, so the font string is exact and never wider than measured
  const tenth = (v: number): number => Math.floor(v * 10 + 1e-9) / 10
  const tallest = maxH / LH
  const top = Math.floor(Math.min(size, tallest) * 10 + 1e-9) / 10
  if (parts.length === 0) return make([], top)

  // The largest size ≤ `from` at which these lines fit `maxW` — re-measured,
  // since type does not scale exactly (a system face tracks by size).
  const fit = (groups: readonly (readonly { text: string; answer: boolean }[])[], from: number): number => {
    let px = from
    for (let k = 0; k < 12; k++) {
      const w = Math.max(...groups.map((g) => widthOf(lineOf(g, px))))
      if (w <= maxW || px <= 1) break
      px = Math.min(tenth((px * maxW) / w), tenth(px - 0.1))
    }
    return px
  }

  // one line: full size, else shrunk
  const one = fit([parts], top)
  if (one >= Math.min(minSize, top) - 1e-9) return make([lineOf(parts, one)], one)

  // two lines, broken between parts
  if (parts.length > 1 && maxH / 2 / LH >= minSize * 0.85) {
    const two = Math.min(size, maxH / 2 / LH)
    let best: { k: number; px: number } | null = null
    for (let k = 1; k < parts.length; k++) {
      const px = fit([parts.slice(0, k), parts.slice(k)], tenth(two))
      if (!best || px > best.px) best = { k, px }
    }
    if (best && best.px >= minSize * 0.85 - 1e-9) {
      return make([lineOf(parts.slice(0, best.k), best.px), lineOf(parts.slice(best.k), best.px)], best.px)
    }
  }

  // one line again, smaller still — down to a size that can still be read
  const floorPx = Math.min(10, top)
  if (one >= floorPx - 1e-9) return make([lineOf(parts, one)], one)

  // last resort: one line at that size, cut short with "…" (never on a bare separator)
  const px = floorPx
  const chars = parts.flatMap((p) => [...p.text].map((ch) => ({ ch, answer: p.answer })))
  const runsOf = (n: number): { text: string; answer: boolean }[] => {
    const out: { text: string; answer: boolean }[] = []
    for (const c of chars.slice(0, n)) {
      const last = out[out.length - 1]
      if (last && last.answer === c.answer) last.text += c.ch
      else out.push({ text: c.ch, answer: c.answer })
    }
    const last = out[out.length - 1]
    if (last) last.text = last.text.replace(/[\s·]+$/, '') + '…'
    return out.filter((r) => r.text.length > 0)
  }
  let n = chars.length
  let out = lineOf(runsOf(n), px)
  while (n > 0 && widthOf(out) > maxW) out = lineOf(runsOf(--n), px)
  return make([out], px)
}

/** One label to hang under a box plot: its value's x and its text width, in px. */
export interface UnderItem {
  x: number
  w: number
  /** Which way it prefers to move when crowded: −1 left, 1 right, 0 either. */
  side: -1 | 0 | 1
  /** Where a leader starts (px y): the bottom of what the label names; the band's top when absent. */
  from?: number
}

/** The band under a box plot, in px (y down). */
export interface UnderBand {
  /** Just under the box and its fences. */
  top: number
  /** The row's bottom edge — the axis line on the lowest row. */
  floor: number
  /** A label's box height. */
  h: number
  /** Air between labels, and between a label and the band's edges. */
  gap: number
  /** How far left / right a label's box may reach. */
  xMin: number
  xMax: number
}

/** Where one label went: its box (centre and size), and its leader to the value (null: right under it). */
export interface UnderPlace {
  cx: number
  cy: number
  w: number
  h: number
  leader: Seg2 | null
}

/**
 * Hang a box plot's labels in the band under it (src/ui/dataPlotLinks.ts).
 *
 * First as ONE ROW: each label under its value, and labels that would touch
 * spread apart just enough (a run of crowded labels centred on its values,
 * order kept, inside xMin…xMax) — a label pushed off its value hangs a little
 * lower and is joined to it by a hairline leader from `from`. The row is
 * kept when every label clears `taken` (other rows' labels, the fences
 * reaching into the band) and no leader crosses a box.
 *
 * Otherwise — or when the row would push a label far off its value and the
 * band has room for more tiers — label by label, in order, the first winning
 * any crowding: right under its value, else nudged a little (still under
 * it), else straight down a tier (staggered), else pushed outward (`side`)
 * on each tier, else inward; leaders as above. A label with no clear place
 * gets null and is not drawn.
 *
 * A place is clear when the label's box (with `gap` of air) meets no box in
 * `taken` and no leader, and its own leader crosses no box. Every box stays
 * inside the band. `taken` and `leaders` are added to. Pure; px only.
 */
export function placeUnderLabels(
  items: readonly UnderItem[],
  band: UnderBand,
  taken: Rect[] = [],
  leaders: Seg2[] = [],
): (UnderPlace | null)[] {
  const row = spreadRow(items, band, taken, leaders)
  const tiers = tierCentres(band)
  if (row && (tiers.length < 2 || row.far <= 0)) return commit(row.places, taken, leaders)
  // a dry run label by label; kept when it states every label (or there is no row)
  const t2 = taken.slice()
  const l2 = leaders.slice()
  const each = placeEach(items, band, tiers, t2, l2)
  if (!row || each.every((q) => q !== null)) return commit(each, taken, leaders)
  return commit(row.places, taken, leaders)
}

function commit(places: (UnderPlace | null)[], taken: Rect[], leaders: Seg2[]): (UnderPlace | null)[] {
  for (const q of places) {
    if (!q) continue
    taken.push({ x: q.cx - q.w / 2, y: q.cy - q.h / 2, w: q.w, h: q.h })
    if (q.leader) leaders.push(q.leader)
  }
  return places
}

function tierCentres(band: UnderBand): number[] {
  const { h, gap } = band
  const tiers: number[] = []
  for (let k = 0; k < 6; k++) {
    const cy = band.top + gap + h / 2 + k * (h + gap)
    if (cy + h / 2 > band.floor - gap + 1e-6) break
    tiers.push(cy)
  }
  return tiers
}

const usable = (it: UnderItem, band: UnderBand): boolean =>
  it.w > 0 && band.xMax - band.xMin >= it.w && Number.isFinite(it.x)

/** Is the box (with air) and its leader clear of everything placed? */
function isClear(r: Rect, lead: Seg2 | null, gap: number, taken: readonly Rect[], leaders: readonly Seg2[]): boolean {
  const air = { x: r.x - gap, y: r.y - gap / 2, w: r.w + 2 * gap, h: r.h + gap }
  if (taken.some((q) => overlaps(q, air))) return false
  if (leaders.some((s) => segHitsRect(s, air))) return false
  if (lead && taken.some((q) => segHitsRect(lead, q))) return false
  return true
}

/** The leader from a value to its label's box: null when the box is right under the value. */
function leaderTo(it: UnderItem, r: Rect, band: UnderBand, under: boolean): Seg2 | null {
  const spans = r.x + 1 <= it.x && it.x <= r.x + r.w - 1
  if (spans && under) return null
  const y0 = Math.min(it.from ?? band.top + 1, r.y - 1)
  // below it: straight down to its top; beside it: to its nearest top corner
  return spans
    ? { x0: it.x, y0, x1: it.x, y1: r.y - 1 }
    : { x0: it.x, y0, x1: it.x < r.x ? r.x + Math.min(2, r.w / 2) : r.x + r.w - Math.min(2, r.w / 2), y1: r.y - 1 }
}

/** The one-row layout, or null when it does not fit or is not clear. `far`: how far past a label width the worst push is. */
function spreadRow(
  items: readonly UnderItem[],
  band: UnderBand,
  taken: readonly Rect[],
  leaders: readonly Seg2[],
): { places: UnderPlace[]; far: number } | null {
  const { h, gap, xMin, xMax } = band
  const room = band.floor - gap - (band.top + gap)
  if (items.length === 0 || room < h - 1e-6 || !items.every((it) => usable(it, band))) return null
  const total = items.reduce((a, it) => a + it.w, 0) + gap * (items.length - 1)
  if (total > xMax - xMin) return null
  const order = items.map((_, i) => i).sort((a, b) => items[a].x - items[b].x)
  // runs of touching labels, each centred on its values, merged until none touch
  let runs = order.map((i) => ({ ids: [i], width: items[i].w, lo: items[i].x - items[i].w / 2 }))
  for (let guard = 0; guard <= items.length; guard++) {
    for (const r of runs) r.lo = Math.max(xMin, Math.min(xMax - r.width, r.lo))
    const k = runs.findIndex((a, j) => j + 1 < runs.length && a.lo + a.width + gap > runs[j + 1].lo)
    if (k < 0) break
    const ids = [...runs[k].ids, ...runs[k + 1].ids]
    let off = 0
    let sum = 0
    for (const i of ids) {
      sum += items[i].x - items[i].w / 2 - off
      off += items[i].w + gap
    }
    runs = [...runs.slice(0, k), { ids, width: off - gap, lo: sum / ids.length }, ...runs.slice(k + 2)]
  }
  const cxs: number[] = new Array(items.length)
  for (const r of runs) {
    let x = r.lo
    for (const i of r.ids) {
      cxs[i] = x + items[i].w / 2
      x += items[i].w + gap
    }
  }
  const pushed = items.map((it, i) => !(cxs[i] - it.w / 2 + 1 <= it.x && it.x <= cxs[i] + it.w / 2 - 1))
  // a pushed label hangs a little lower, so its leader reads as one
  const cy = band.top + gap + h / 2 + (pushed.some(Boolean) ? Math.min(h * 0.6, room - h) : 0)
  const places: UnderPlace[] = []
  let far = 0
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const r = { x: cxs[i] - it.w / 2, y: cy - h / 2, w: it.w, h }
    const lead = pushed[i] ? leaderTo(it, r, band, false) : null
    if (!isClear(r, lead, gap, taken, leaders)) return null
    far = Math.max(far, Math.abs(cxs[i] - it.x) - it.w)
    places.push({ cx: cxs[i], cy, w: it.w, h, leader: lead })
  }
  return { places, far }
}

/** Label by label, in order, onto the tiers (see placeUnderLabels). */
function placeEach(
  items: readonly UnderItem[],
  band: UnderBand,
  tiers: readonly number[],
  taken: Rect[],
  leaders: Seg2[],
): (UnderPlace | null)[] {
  const { h, gap } = band
  return items.map((it) => {
    const w = it.w
    if (tiers.length === 0 || !usable(it, band)) return null
    const step = w / 2 + gap
    const out = it.side === 0 ? [1, -1] : [it.side]
    const cands: { k: number; s: number }[] = []
    // under its value: centred, then nudged a little either way
    cands.push({ k: 0, s: 0 })
    for (const d of [...out, ...out.map((v) => -v)]) cands.push({ k: 0, s: d * w * 0.3 })
    // staggered: straight down a tier
    for (let k = 1; k < tiers.length; k++) cands.push({ k, s: 0 })
    // pushed outward on each tier, then inward
    for (const dirs of [out, it.side === 0 ? [] : [-it.side]])
      tiers.forEach((_, k) => {
        for (let m = 1; m <= 4; m++) for (const d of dirs) cands.push({ k, s: d * m * step })
      })
    for (const { k, s } of cands) {
      const cx = Math.max(band.xMin + w / 2, Math.min(band.xMax - w / 2, it.x + s))
      const cy = tiers[k]
      const r = { x: cx - w / 2, y: cy - h / 2, w, h }
      const lead = leaderTo(it, r, band, k === 0)
      if (!isClear(r, lead, gap, taken, leaders)) continue
      taken.push(r)
      if (lead) leaders.push(lead)
      return { cx, cy, w, h, leader: lead }
    }
    return null
  })
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

interface St {
  stroke: number
  type: number
  mono: boolean
  theme: Theme
  face: { font: 'sans' | 'serif' }
  ink(i: StatInk): string
  /** An object's own colour, painted for the palette (black under mono). */
  own(c: string): string
}

function drawOne(ctx: CanvasRenderingContext2D, f: StatsFigure, toPx: (p: Vec2) => Vec2, st: St): void {
  const s = st.stroke
  const t = st.type
  const P = (x: number, y: number): Vec2 => toPx({ x, y })
  const a = P(f.panel.x0, f.panel.y1)
  const b = P(f.panel.x1, f.panel.y0)
  const panel = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
  if (!(panel.w > 40) || !(panel.h > 30)) return
  const pa = P(f.plot.x0, f.plot.y1)
  const pb = P(f.plot.x1, f.plot.y0)
  const plotH = Math.abs(pb.y - pa.y)

  // ---- the panel: an opaque ground with a hairline frame
  roundRect(ctx, panel.x, panel.y, panel.w, panel.h, 8 * t)
  ctx.fillStyle = st.theme.bg
  ctx.fill()
  ctx.lineWidth = 1 * s
  ctx.strokeStyle = st.mono ? st.theme.axis : st.theme.gridMajor
  ctx.setLineDash([])
  ctx.stroke()

  ctx.save()
  ctx.beginPath()
  ctx.rect(panel.x, panel.y, panel.w, panel.h)
  ctx.clip()

  const placed: Rect[] = []
  const later: (() => void)[] = []

  // ---- the title band's layout (drawn last): it fits the panel at any type
  // scale (layoutTitle), and nothing else is placed on it
  const titlePad = 6 + 2 * t
  // the band ends at the plot's top, or higher where a word of the figure
  // (a tree's "Draw 1", a table's header) reaches above it
  let bandBottom = Math.min(pa.y, panel.y + panel.h)
  for (const p of f.prims) {
    if (p.k !== 'text' || !p.text || p.under) continue
    const th = (p.small ? 12 : 15) * t
    const at = toPx(p.at)
    const y = p.lift !== undefined ? at.y - p.lift * t - th / 2 : at.y - p.rise * plotH
    const top = p.align === 'right' ? y + 4 * t : y - th / 2
    if (top < bandBottom && top > panel.y + 11) bandBottom = top - 1
  }
  // a full-size line sits where it always has; a shallow band starts it higher
  const titleTop = panel.y + Math.max(2, Math.min(7 * t, (bandBottom - panel.y - 13 * t * 1.22) / 2))
  const title = layoutTitle(
    f.title.question,
    f.title.answer,
    panel.w - 2 * titlePad,
    // the band down to the plot's top (at least one 9px line)
    Math.max(11, bandBottom - titleTop - 2),
    13 * t,
    Math.max(9, 13 * t * 0.72),
    (text, px) => {
      ctx.font = `bold ${labelFont(st.face, px)}`
      return ctx.measureText(text).width
    },
  )
  const titleBottom = title.lines.length > 0 ? titleTop + title.lines.length * title.lineH : panel.y
  if (title.lines.length > 0) {
    placed.push({ x: panel.x + panel.w / 2 - title.width / 2 - 2, y: titleTop, w: title.width + 4, h: titleBottom - titleTop })
  }
  const under: { p: Extract<StatPrim, { k: 'text' }>; u: UnderSpec }[] = []
  /** Every vertical rule (a fence, a whisker cap), which a hung label steps around. */
  const vbars: Rect[] = []
  const small = labelFont(st.face, 11 * t)
  const font = labelFont(st.face, 13 * t)
  const bold = `bold ${labelFont(st.face, 13 * t)}`

  const chip = (at: Vec2, text: string, color: string, dir: Vec2 | undefined): void => {
    if (!text || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return
    ctx.font = bold
    const pad = 5 * t
    const w = ctx.measureText(text).width + 2 * pad
    const h = 19 * t
    const d = dir ?? { x: 0, y: 0 }
    const len = Math.hypot(d.x, d.y)
    const u = len > 0 ? { x: d.x / len, y: d.y / len } : { x: 0, y: 0 }
    const off = len > 0 ? Math.abs(u.x) * (w / 2) + Math.abs(u.y) * (h / 2) + 6 * t : 0
    let cx = at.x + u.x * off
    let cy = at.y + u.y * off
    // keep inside the panel, under its title
    const hi = titleBottom + h / 2 + 3
    const lo = panel.y + panel.h - h / 2 - 3
    cx = Math.max(panel.x + w / 2 + 3, Math.min(panel.x + panel.w - w / 2 - 3, cx))
    cy = Math.max(hi, Math.min(lo, cy))
    // crowded: step up while there is room under the title, then down
    const free = (y: number): boolean => !placed.some((q) => overlaps(q, { x: cx - w / 2 - 2, y: y - h / 2 - 2, w: w + 4, h: h + 4 }))
    if (!free(cy)) {
      const steps: number[] = []
      for (let k = 1; k <= 8; k++) steps.push(cy - k * (h + 3))
      for (let k = 1; k <= 8; k++) steps.push(cy + k * (h + 3))
      const ok = steps.find((y) => y >= hi - 1e-6 && y <= lo + 1e-6 && free(y))
      if (ok !== undefined) cy = ok
    }
    placed.push({ x: cx - w / 2 - 2, y: cy - h / 2 - 2, w: w + 4, h: h + 4 })
    roundRect(ctx, cx - w / 2, cy - h / 2, w, h, 4 * t)
    ctx.fillStyle = st.theme.bg
    ctx.fill()
    ctx.lineWidth = 1 * s
    ctx.strokeStyle = color
    ctx.stroke()
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, cx, cy)
  }

  const line = (pts: Vec2[], color: string, w: number, dash?: number[]): void => {
    if (pts.length < 2) return
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
    ctx.strokeStyle = color
    ctx.lineWidth = w * s
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.setLineDash((dash ?? []).map((v) => v * s))
    ctx.stroke()
    ctx.setLineDash([])
  }

  const wash = (alpha: number): number => (st.mono ? Math.min(0.28, alpha * 0.6) : alpha)
  const inkOf = (i: StatInk, c?: string): string => (c ? st.own(c) : st.ink(i))
  const fillInk = (i: StatInk, c?: string): string => (st.mono ? '#777777' : inkOf(i, c))

  for (const p of f.prims) {
    switch (p.k) {
      case 'fill': {
        const pts = p.pts.map(toPx)
        if (pts.length < 3) break
        ctx.beginPath()
        ctx.moveTo(pts[0].x, pts[0].y)
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
        ctx.closePath()
        const prev = ctx.globalAlpha
        ctx.globalAlpha = prev * wash(p.alpha)
        ctx.fillStyle = fillInk(p.ink, p.color)
        ctx.fill()
        ctx.globalAlpha = prev
        break
      }
      case 'rect': {
        const q0 = P(p.x0, p.y1)
        const q1 = P(p.x1, p.y0)
        const x = Math.min(q0.x, q1.x)
        const y = Math.min(q0.y, q1.y)
        const w = Math.abs(q1.x - q0.x)
        const h = Math.abs(q1.y - q0.y)
        if (!(h > 0)) break
        const prev = ctx.globalAlpha
        ctx.globalAlpha = prev * wash(p.alpha)
        ctx.fillStyle = fillInk(p.ink, p.color)
        ctx.fillRect(x, y, w, h)
        ctx.globalAlpha = prev
        if (p.edge === false) break
        ctx.lineWidth = 1 * s
        ctx.strokeStyle = inkOf(p.ink, p.color)
        ctx.strokeRect(x, y, w, h)
        break
      }
      case 'venn': {
        const q0 = P(p.box.x0, p.box.y1)
        const q1 = P(p.box.x1, p.box.y0)
        const bx = Math.min(q0.x, q1.x)
        const by = Math.min(q0.y, q1.y)
        const bw = Math.abs(q1.x - q0.x)
        const bh = Math.abs(q1.y - q0.y)
        if (!(bw > 0) || !(bh > 0)) break
        const ppx = Math.abs(P(1, 0).x - P(0, 0).x)
        const cs = p.circles.map((c) => ({ ...toPx({ x: c.x, y: c.y }), r: c.r * ppx }))
        const n = 1 << cs.length
        for (let atom = 0; atom < n; atom++) {
          if (!(p.atoms & (1 << atom))) continue
          ctx.save()
          // inside each circle the atom is in…
          cs.forEach((c, i) => {
            if (!(atom & (1 << i))) return
            ctx.beginPath()
            ctx.moveTo(c.x + c.r, c.y)
            ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2)
            ctx.clip()
          })
          // …and outside the others: the box with that circle as a hole (opposite winding)
          cs.forEach((c, i) => {
            if (atom & (1 << i)) return
            ctx.beginPath()
            ctx.rect(bx, by, bw, bh)
            ctx.moveTo(c.x + c.r, c.y)
            ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2, true)
            ctx.clip()
          })
          const prev = ctx.globalAlpha
          ctx.globalAlpha = prev * wash(p.alpha)
          ctx.fillStyle = fillInk(p.ink, p.color)
          ctx.fillRect(bx, by, bw, bh)
          ctx.globalAlpha = prev
          ctx.restore()
        }
        ctx.lineWidth = 1.4 * s
        ctx.setLineDash([])
        ctx.strokeStyle = st.theme.axis
        ctx.strokeRect(bx, by, bw, bh)
        ctx.lineWidth = 2 * s
        ctx.strokeStyle = inkOf('main', p.color)
        for (const c of cs) {
          ctx.beginPath()
          ctx.moveTo(c.x + c.r, c.y)
          ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2)
          ctx.stroke()
        }
        break
      }
      case 'dots': {
        const ppx = Math.abs(P(1, 0).x - P(0, 0).x)
        const r = Math.max(0.8, p.r * ppx)
        ctx.fillStyle = inkOf(p.ink, p.color)
        ctx.beginPath()
        for (const q of p.pts) {
          const c = toPx(q)
          ctx.moveTo(c.x + r, c.y)
          ctx.arc(c.x, c.y, r, 0, Math.PI * 2)
        }
        ctx.fill()
        break
      }
      case 'ring': {
        const ppx = Math.abs(P(1, 0).x - P(0, 0).x)
        const r = Math.max(1.2, p.r * ppx)
        ctx.strokeStyle = inkOf(p.ink, p.color)
        ctx.lineWidth = 1.4 * s
        ctx.setLineDash(p.dash ? [2 * s, 2 * s] : [])
        for (const q of p.pts) {
          const c = toPx(q)
          ctx.beginPath()
          ctx.arc(c.x, c.y, r, 0, Math.PI * 2)
          ctx.stroke()
        }
        ctx.setLineDash([])
        break
      }
      case 'curve':
        line(p.pts.map(toPx), inkOf(p.ink, p.color), p.w, p.dash)
        break
      case 'vline': {
        const a = P(p.x, p.y0)
        const b = P(p.x, p.y1)
        line([a, b], inkOf(p.ink, p.color), p.w ?? 1.5, p.dash)
        const half = ((p.w ?? 1.5) * s) / 2 + 0.5
        vbars.push({ x: a.x - half, y: Math.min(a.y, b.y), w: 2 * half, h: Math.abs(b.y - a.y) })
        break
      }
      case 'bracket': {
        const l = P(p.x0, p.y)
        const r = P(p.x1, p.y)
        const color = st.ink(p.ink)
        line([l, r], color, 1.3)
        const k = 5 * t
        line([{ x: l.x + k, y: l.y - k }, l, { x: l.x + k, y: l.y + k }], color, 1.3)
        line([{ x: r.x - k, y: r.y - k }, r, { x: r.x - k, y: r.y + k }], color, 1.3)
        const text = p.text
        later.push(() => {
          ctx.font = bold
          const w = ctx.measureText(text).width + 8 * t
          const cx = (l.x + r.x) / 2
          ctx.fillStyle = st.theme.bg
          ctx.fillRect(cx - w / 2, l.y - 8 * t, w, 16 * t)
          ctx.fillStyle = color
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(text, cx, l.y)
        })
        break
      }
      case 'text': {
        if (p.under) {
          if (p.text) under.push({ p, u: p.under })
          break
        }
        const at = toPx(p.at)
        const th = (p.small ? 12 : 15) * t
        let y = p.lift !== undefined ? at.y - p.lift * t - th / 2 : at.y - p.rise * plotH
        // no room above under the ceiling: just inside the bar's top instead
        if (p.ceil !== undefined && y - th / 2 < P(p.at.x, p.ceil).y + 1) y = p.lift !== undefined ? at.y + p.lift * t + th / 2 : P(p.at.x, p.ceil).y + th / 2 + 1
        const color = inkOf(p.ink, p.color)
        const text = p.text
        const align = p.align ?? 'center'
        later.push(() => {
          if (!text) return
          ctx.font = p.bold ? (p.small ? `bold ${small}` : bold) : p.small ? small : font
          // a word that would run out of the panel (a set's name on a small
          // figure) takes smaller type, down to 60%, rather than being cut
          if (!p.avoid) {
            const w = ctx.measureText(text).width
            const l = panel.x + 3
            const r = panel.x + panel.w - 3
            const room = align === 'end' || align === 'right' ? at.x - l : align === 'start' ? r - at.x : 2 * Math.min(at.x - l, r - at.x)
            if (w > room && room > 0) {
              const px = (p.small ? 11 : 13) * t * Math.max(0.6, room / w)
              ctx.font = `${p.bold ? 'bold ' : ''}${labelFont(st.face, Math.round(px * 10) / 10)}`
            }
          }
          if (p.avoid) {
            const w = ctx.measureText(text).width
            const h = th
            const x0 = align === 'center' ? at.x - w / 2 : align === 'start' ? at.x : at.x - w
            // 'right' hangs from its point (drawn top-aligned 4px below it)
            const r = { x: x0 - 1, y: align === 'right' ? y + 4 * t - 1 : y - h / 2, w: w + 2, h }
            if (placed.some((q) => overlaps(q, r))) return
            placed.push(r)
          }
          ctx.fillStyle = color
          if (align === 'start' || align === 'end') {
            ctx.textAlign = align === 'start' ? 'left' : 'right'
            ctx.textBaseline = 'middle'
            ctx.fillText(text, at.x, y)
            return
          }
          ctx.textAlign = align
          ctx.textBaseline = align === 'right' ? 'top' : 'middle'
          ctx.fillText(text, at.x, align === 'right' ? y + 4 * t : y)
        })
        break
      }
      case 'chip': {
        const at = toPx(p.at)
        const text = p.text
        const color = st.ink(p.ink)
        const dir = p.dir
        later.push(() => chip(at, text, color, dir))
        break
      }
    }
  }

  // ---- the axis, its ticks, the raw row and the z row
  const axisL = P(f.plot.x0, f.axisY)
  const axisR = P(f.plot.x1, f.axisY)
  if (!f.noAxis) line([axisL, axisR], st.theme.axis, 1.4)
  const tickLen = 5 * t
  const row1 = axisL.y + tickLen + 9 * t
  const row2 = row1 + 17 * t
  const taken: Rect[] = []
  const label = (x: number, y: number, text: string, color: string, f2: string): void => {
    if (!text) return
    ctx.font = f2
    const w = ctx.measureText(text).width
    const r = { x: x - w / 2 - 3, y: y - 8 * t, w: w + 6, h: 16 * t }
    if (taken.some((q) => overlaps(q, r))) return
    taken.push(r)
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, x, y)
  }
  // marks first: they win any crowding
  for (const m of f.marks) {
    const x = P(m.x, f.axisY).x
    const color = m.ink ? st.ink(m.ink) : st.ink('main')
    line([{ x, y: axisL.y - tickLen * 1.4 }, { x, y: axisL.y + tickLen * 1.4 }], color, 2.2)
    label(x, row1, m.text, color, bold)
    if (f.zRow && m.z) label(x, row2, m.z, color, bold)
  }
  for (const k of f.ticks) {
    const x = P(k.x, f.axisY).x
    line([{ x, y: axisL.y }, { x, y: axisL.y + tickLen }], st.theme.axis, 1.2)
    label(x, row1, k.text, st.theme.label, font)
    if (f.zRow) label(x, row2, k.z, st.theme.label, small)
  }
  // ---- a vertical axis (a residual plot's), its ticks and what it measures
  if (f.yTicks && f.yTicks.length > 0) {
    const top = P(f.plot.x0, f.plot.y1)
    const bottom = P(f.plot.x0, f.plot.y0)
    line([bottom, top], st.theme.axis, 1.2)
    ctx.font = small
    ctx.fillStyle = st.theme.label
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (const k of f.yTicks) {
      const q = P(f.plot.x0, k.y)
      line([{ x: q.x - tickLen, y: q.y }, q], st.theme.axis, 1.1)
      if (k.text) ctx.fillText(k.text, q.x - tickLen - 3 * t, q.y)
    }
    if (f.yLabel) {
      ctx.save()
      ctx.font = labelFont(st.face, 11 * t, true)
      ctx.translate(panel.x + 9 * t, (top.y + bottom.y) / 2)
      ctx.rotate(-Math.PI / 2)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(f.yLabel, 0, 0)
      ctx.restore()
    }
  }

  ctx.font = labelFont(st.face, 12 * t, true)
  ctx.fillStyle = st.theme.label
  if (f.zRow) {
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText('x', axisL.x - 6 * t, row1)
    ctx.fillText('z', axisL.x - 6 * t, row2)
  } else if (f.axisLabel) {
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.font = labelFont(st.face, 11 * t, true)
    ctx.fillText(f.axisLabel, axisR.x, row2)
  }

  // ---- a box plot's labels, hung in the band under it (placeUnderLabels);
  // first, so the texts that `avoid` crowding step around them
  const groups = new Map<string, typeof under>()
  for (const e of under) {
    const g = groups.get(e.u.group)
    if (g) g.push(e)
    else groups.set(e.u.group, [e])
  }
  const leaders: Seg2[] = []
  for (const g of groups.values()) {
    const top = P(0, g[0].u.top).y
    const floor = P(0, g[0].u.floor).y
    // a band too shallow for the type takes smaller type, and below 6.5px none
    let size = 11 * t
    let gap = 3 * t
    const need = size * 1.15 + 2 * gap
    if (floor - top < need) {
      const k = Math.max(0, floor - top) / need
      size *= k
      gap *= k
    }
    if (size < 6.5) continue
    const face = labelFont(st.face, Math.round(size * 10) / 10)
    ctx.font = face
    const items = g.map((e) => ({
      x: toPx(e.p.at).x,
      w: ctx.measureText(e.p.text).width,
      side: e.u.side,
      from: e.u.from !== undefined ? P(0, e.u.from).y + 1 : undefined,
    }))
    const spots = placeUnderLabels(
      items,
      { top, floor, h: size * 1.15, gap, xMin: panel.x + 3, xMax: panel.x + panel.w - 3 },
      [...placed, ...vbars],
      leaders,
    )
    spots.forEach((spot, i) => {
      if (!spot) return
      placed.push({ x: spot.cx - spot.w / 2, y: spot.cy - spot.h / 2, w: spot.w, h: spot.h })
      const color = inkOf(g[i].p.ink, g[i].p.color)
      if (spot.leader) {
        const prev = ctx.globalAlpha
        ctx.globalAlpha = prev * 0.75
        line([{ x: spot.leader.x0, y: spot.leader.y0 }, { x: spot.leader.x1, y: spot.leader.y1 }], color, 0.9)
        ctx.globalAlpha = prev
      }
      ctx.font = face
      ctx.fillStyle = color
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(g[i].p.text, spot.cx, spot.cy)
    })
  }

  for (const l of later) l()

  // ---- the title band
  ctx.font = `bold ${labelFont(st.face, title.size)}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  title.lines.forEach((runs, i) => {
    const lw = runs.length ? runs[runs.length - 1].dx + runs[runs.length - 1].w : 0
    const x = panel.x + panel.w / 2 - lw / 2
    const y = titleTop + (i + 0.5) * title.lineH
    for (const r of runs) {
      ctx.fillStyle = r.answer ? st.ink('main') : st.mono ? st.theme.axis : st.theme.label
      ctx.fillText(r.text, x + r.dx, y)
    }
  })
  ctx.restore()
}

export function drawStats(ctx: CanvasRenderingContext2D, figs: readonly StatsFigure[], o: StatsPaintOpts): void {
  if (figs.length === 0) return
  const vp = o.vp
  if (vp.widthPx <= 0 || vp.heightPx <= 0 || !(vp.pxPerUnit > 0)) return
  const ppx = ppuX(vp)
  const ppy = ppuY(vp)
  const toPx = (p: Vec2): Vec2 => ({
    x: vp.widthPx / 2 + (p.x - vp.center.x) * ppx,
    y: vp.heightPx / 2 - (p.y - vp.center.y) * ppy,
  })
  const { type, stroke } = paintScale(o.scale)
  const paint = o.paint ?? ((c: string) => c)
  const mono = o.mono === true
  for (const f of figs) {
    if (!f || !f.visible) continue
    const main = paint(f.color)
    const st: St = {
      stroke,
      type,
      mono,
      theme: o.theme,
      face: { font: o.font ?? 'sans' },
      ink: (i) => {
        if (mono || i === 'axis') return o.theme.axis
        if (i === 'main') return main
        if (i === 'rule') return o.theme.label
        return paint(STAT_INK[i])
      },
      own: (c) => (mono ? o.theme.axis : paint(c)),
    }
    ctx.save()
    try {
      drawOne(ctx, f, toPx, st)
    } catch {
      /* one figure failing must not cost the board */
    }
    ctx.globalAlpha = 1
    ctx.setLineDash([])
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.restore()
  }
}

/** The panels in board units, for hit-testing a click on a figure. */
export function statsAt(figs: readonly StatsFigure[], p: Vec2): StatsFigure | null {
  for (let i = figs.length - 1; i >= 0; i--) {
    const f = figs[i]
    if (!f.visible) continue
    if (p.x >= f.panel.x0 && p.x <= f.panel.x1 && p.y >= f.panel.y0 && p.y <= f.panel.y1) return f
  }
  return null
}

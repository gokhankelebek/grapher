// ============================================================================
// src/ui/reveal.ts — Reveal mode: the board projected WITHOUT its answers.
//
// A teacher puts y = x² − 3 on the wall and asks where it crosses the axis.
// Every marker, chip and card value that would answer that question is hidden;
// where a hidden answer sits on the board a small hollow "?" is drawn instead,
// so the class sees WHERE something is but not WHAT it is. The answers then
// come back one at a time — a click on a "?", a Reveal pill on a card, or
// "next" (→ / PageDown, the clicker's forward button), which walks the
// teaching order: per curve zeros → y-intercept → extrema → inflections →
// asymptotes → domain, then where the curves meet, then the calculus tools in
// card order, then everything else (a solved inequality, a unit circle …).
//
// This module is the pure half: answer keys, the teaching order, the state
// transitions, and the scene filter both the screen and the export use.
//
// ANSWER KEYS are stable strings, one per answer:
//
//   curve:<id>:zero:<i>          the i-th zero of that curve, by x
//   curve:<id>:max:<i>  …min, infl, yint, extreme, tip, hole (same rule)
//   curve:<id>:asym:<i>          the i-th asymptote, in the order the card lists them
//   curve:<id>:domain  …range, onetoone, inverse: the Domain rows
//   cross:<a>:<b>:<i>            the i-th crossing of a and b (ids sorted), by x
//   calc:<linkId>:value          every value one calculus tool states
//   solve:<id>:solution          a number-line inequality's solution set
//   uc:<id>:values               a unit circle's exact values
//   rr:<id>:value                a related-rates scenario's unknown rate
//   stat:<id>:value              a statistics figure's probability, z-scores,
//                                percentile, simulated mean / SD, margins of
//                                error and p-value
//   series:<id>:value            a series' verdict and sum
//   euler:<fieldId>:value        a field's Euler approximations
//   system:value                 the inequality system's corners / optimum
//   shape:<id>:<part>            a shape's measurements: lengths, slopes,
//                                angles, marks (congruence ticks / arcs),
//                                midpoints, area (perimeter and area), class
//                                (classification, ∥ / ⊥ pairs), trig (right-
//                                triangle ratios), pair (point to point),
//                                line (an equation)
//
// An index key is the point's rank among the points of its kind sorted by
// x, so the same answer keeps its key across re-renders and recomputation
// (the analyzer may list points in any order). Moving the curve keeps the
// key too: revealing "the left zero" stays revealed while the teacher drags.
//
// STATE is SESSION-ONLY. Reveal mode is a live classroom state — "the class
// has seen the zeros but not the max yet" means nothing tomorrow — so nothing
// here is ever written to a document or to prefs, and every document saves
// byte-identically with or without it.
// ============================================================================

import type { FittedCurve, Shape, ShapeMeasureDraw, SpecialPoint, SpecialPointKind, Vec2 } from '../core/types'
import type { BoardIntersection, BoardScene } from './renderBoard'
import type { Overlay } from '../render/overlays'
import type { UnitCircleFigure } from '../render/unitCircle'
import type { RelatedRatesFigure } from '../render/relatedRates'
import type { StatsFigure } from '../render/stats'
import type { SignChartFigure } from '../render/signChart'

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** The short word each kind of point goes by in a key. */
export const KIND_SLUG: Record<SpecialPointKind, string> = {
  zero: 'zero',
  'y-intercept': 'yint',
  maximum: 'max',
  minimum: 'min',
  inflection: 'infl',
  extreme: 'extreme',
  'petal-tip': 'tip',
  hole: 'hole',
  intersection: 'meet',
}

export const calcKey = (linkId: string): string => `calc:${linkId}:value`
export const solveKey = (itemId: string): string => `solve:${itemId}:solution`
export const asymKey = (curveId: string, i: number): string => `curve:${curveId}:asym:${i}`
export const domainKey = (curveId: string): string => `curve:${curveId}:domain`
export const rangeKey = (curveId: string): string => `curve:${curveId}:range`
export const oneToOneKey = (curveId: string): string => `curve:${curveId}:onetoone`
export const inverseKey = (curveId: string): string => `curve:${curveId}:inverse`
export const ucKey = (id: string): string => `uc:${id}:values`
export const rrKey = (id: string): string => `rr:${id}:value`
export const statKey = (id: string): string => `stat:${id}:value`
export const seriesKey = (id: string): string => `series:${id}:value`
export const eulerKey = (fieldId: string): string => `euler:${fieldId}:value`
export const SYSTEM_KEY = 'system:value'

/** The parts of a shape's measurements that are answers, each revealed on its own. */
export type ShapePart = 'lengths' | 'slopes' | 'angles' | 'marks' | 'midpoints' | 'area' | 'class' | 'trig' | 'pair' | 'line'
export const shapeKey = (id: string, part: ShapePart): string => `shape:${id}:${part}`

const byXY = (a: SpecialPoint, b: SpecialPoint): number =>
  a.pos.x - b.pos.x || a.pos.y - b.pos.y

/** Where a point is, as a lookup string: exact to the bit, because both sides compute it the same way. */
const sig = (kind: string, p: Vec2): string => `${kind}|${p.x}|${p.y}`

/**
 * One key per point, in the order given: `curve:<id>:<kind>:<i>` with i the
 * point's rank among the points of its kind sorted by x (then y).
 */
export function curvePointKeys(curveId: string, points: readonly SpecialPoint[]): string[] {
  const groups = new Map<string, number[]>()
  points.forEach((p, i) => {
    const slug = KIND_SLUG[p.kind] ?? p.kind
    const list = groups.get(slug) ?? []
    list.push(i)
    groups.set(slug, list)
  })
  const out = new Array<string>(points.length)
  for (const [slug, idx] of groups) {
    idx.sort((i, j) => byXY(points[i], points[j]))
    idx.forEach((pi, rank) => {
      out[pi] = `curve:${curveId}:${slug}:${rank}`
    })
  }
  return out
}

/** The two curve ids of a crossing, sorted, so (f, g) and (g, f) are one pair. */
export function crossPair(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a]
}

/** One key per crossing: `cross:<a>:<b>:<i>`, i its rank by x within the pair. */
export function crossingKeys(list: readonly BoardIntersection[]): string[] {
  const groups = new Map<string, number[]>()
  list.forEach((c, i) => {
    const [a, b] = crossPair(c.curveId, c.point.withId ?? '')
    const k = `${a}:${b}`
    const g = groups.get(k) ?? []
    g.push(i)
    groups.set(k, g)
  })
  const out = new Array<string>(list.length)
  for (const [pair, idx] of groups) {
    idx.sort((i, j) => byXY(list[i].point, list[j].point))
    idx.forEach((ci, rank) => {
      out[ci] = `cross:${pair}:${rank}`
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Inventory and teaching order
// ---------------------------------------------------------------------------

/** What the board has to reveal, as the App knows it. */
export interface RevealSource {
  /** Visible curves in card order. */
  curves: readonly {
    id: string
    points: readonly SpecialPoint[]
    /** How many asymptotes the card states. */
    asymptotes?: number
    /** True when the card states a domain / range (the Domain rows). */
    domain?: boolean
    /** …and whether those rows include one-to-one and an inverse. */
    inverse?: boolean
    /** The calculus tools on this curve's card, in card order. */
    calc?: readonly string[]
  }[]
  crossings: readonly BoardIntersection[]
  /** Every other answer key, in the order they should come last. */
  after?: readonly string[]
}

export interface RevealInventory {
  /** Every answer on the board, in teaching order. */
  order: readonly string[]
  /** The key of a point on a curve; the board list decides it. */
  pointKey(curveId: string, p: SpecialPoint): string
  /**
   * The key of a point when it IS one of the curve's answers, else null: a
   * construction mark sharing the marker layer (a transformation's image
   * points, a sinusoid's key points) is drawn whatever reveal mode says.
   */
  answerKey(curveId: string, p: SpecialPoint): string | null
  /** The key of a crossing of a and b at this point. */
  crossKey(a: string, b: string, p: SpecialPoint): string
}

/** Teaching rank of a point kind within one curve. */
const KIND_RANK: Record<string, number> = {
  zero: 0,
  yint: 1,
  max: 2,
  min: 2,
  infl: 3,
  extreme: 4,
  tip: 5,
  hole: 6,
  meet: 7,
}

export function buildInventory(src: RevealSource): RevealInventory {
  const order: string[] = []
  const pointKeys = new Map<string, string>()
  const fallback = new Map<string, readonly SpecialPoint[]>()
  const calc: string[] = []

  for (const c of src.curves) {
    const keys = curvePointKeys(c.id, c.points)
    fallback.set(c.id, c.points)
    const ranked = c.points
      .map((p, i) => ({ p, key: keys[i], rank: KIND_RANK[KIND_SLUG[p.kind]] ?? 8 }))
      .sort((a, b) => a.rank - b.rank || byXY(a.p, b.p))
    for (const r of ranked) {
      pointKeys.set(`${c.id}|${sig(r.p.kind, r.p.pos)}`, r.key)
      order.push(r.key)
    }
    for (let i = 0; i < (c.asymptotes ?? 0); i++) order.push(asymKey(c.id, i))
    if (c.domain) {
      order.push(domainKey(c.id), rangeKey(c.id))
      if (c.inverse) order.push(oneToOneKey(c.id), inverseKey(c.id))
    }
    for (const id of c.calc ?? []) calc.push(calcKey(id))
  }

  const cross = crossingKeys(src.crossings)
  const crossMap = new Map<string, string>()
  const crossOrder = src.crossings
    .map((c, i) => ({ c, key: cross[i] }))
    .sort((a, b) => byXY(a.c.point, b.c.point))
  for (const { c, key } of crossOrder) {
    const [a, b] = crossPair(c.curveId, c.point.withId ?? '')
    crossMap.set(`${a}|${b}|${c.point.pos.x}|${c.point.pos.y}`, key)
    order.push(key)
  }

  order.push(...calc)
  for (const k of src.after ?? []) order.push(k)

  const seen = new Set<string>()
  const unique = order.filter((k) => (seen.has(k) ? false : (seen.add(k), true)))

  return {
    order: unique,
    answerKey(curveId, p) {
      return pointKeys.get(`${curveId}|${sig(p.kind, p.pos)}`) ?? null
    },
    pointKey(curveId, p) {
      const hit = pointKeys.get(`${curveId}|${sig(p.kind, p.pos)}`)
      if (hit) return hit
      // Not on the board list (a card reading its own list): rank it within
      // that list, which is the same rule.
      const list = fallback.get(curveId)
      if (list) {
        const at = list.indexOf(p)
        if (at >= 0) return curvePointKeys(curveId, list)[at]
      }
      return curvePointKeys(curveId, [p])[0]
    },
    crossKey(a, b, p) {
      const [x, y] = crossPair(a, b)
      return crossMap.get(`${x}|${y}|${p.pos.x}|${p.pos.y}`) ?? `cross:${x}:${y}:${p.pos.x.toFixed(6)}`
    },
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface RevealState {
  /** Reveal mode: computed answers are hidden until revealed. */
  on: boolean
  /** What has been revealed, in the order it was revealed (so ← takes back the last). */
  revealed: readonly string[]
  /** "Reveal all": every answer shows, including ones that appear later. */
  all: boolean
  /** Draw "?" where a hidden answer sits. Off: the board shows nothing there at all. */
  positions: boolean
}

export const REVEAL_OFF: RevealState = { on: false, revealed: [], all: false, positions: true }

/** True when this answer must not be shown right now. */
export function isHidden(s: RevealState, key: string): boolean {
  return s.on && !s.all && !s.revealed.includes(key)
}

export function revealOne(s: RevealState, key: string): RevealState {
  return s.revealed.includes(key) ? s : { ...s, revealed: [...s.revealed, key] }
}

/** The next answer in teaching order that is still hidden, or null. */
export function nextHidden(s: RevealState, order: readonly string[]): string | null {
  if (s.all) return null
  const done = new Set(s.revealed)
  for (const k of order) if (!done.has(k)) return k
  return null
}

export function revealNext(s: RevealState, order: readonly string[]): { state: RevealState; key: string | null } {
  const key = nextHidden(s, order)
  return key === null ? { state: s, key } : { state: revealOne(s, key), key }
}

/** Take back the last answer revealed (the clicker's back button). */
export function hideLast(s: RevealState): RevealState {
  if (s.all) return { ...s, all: false }
  if (s.revealed.length === 0) return s
  return { ...s, revealed: s.revealed.slice(0, -1) }
}

export function revealAll(s: RevealState, order: readonly string[]): RevealState {
  const have = new Set(s.revealed)
  return { ...s, all: true, revealed: [...s.revealed, ...order.filter((k) => !have.has(k))] }
}

export function hideAll(s: RevealState): RevealState {
  return { ...s, all: false, revealed: [] }
}

/** How many answers are still hidden / how many there are. */
export function revealCount(s: RevealState, order: readonly string[]): { hidden: number; total: number } {
  if (s.all) return { hidden: 0, total: order.length }
  const done = new Set(s.revealed)
  return { hidden: order.filter((k) => !done.has(k)).length, total: order.length }
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

export type RevealKeyAction = 'toggle' | 'next' | 'back' | null

/**
 * What a key press means to reveal mode.
 *
 * R toggles the mode. It was free: the app's letters are A (analysis), F
 * (present), ⇧P (π axis), ⌘Z / ⌘Y (undo / redo), \ (sidebar) and Space (pan).
 * ⌘R / Ctrl+R stay the browser's reload.
 *
 * While the mode is on, → and PageDown reveal the next answer and ← and
 * PageUp take the last one back — PageDown / PageUp are what a presentation
 * clicker sends. Plain ← / → nudge the selected curve when the mode is off,
 * and still do with Shift held (the 1-unit nudge) while it is on.
 */
export function revealKeyAction(
  e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean },
  on: boolean,
): RevealKeyAction {
  if (e.metaKey || e.ctrlKey || e.altKey) return null
  if ((e.key === 'r' || e.key === 'R') && !e.shiftKey) return 'toggle'
  if (!on) return null
  if (e.key === 'PageDown') return 'next'
  if (e.key === 'PageUp') return 'back'
  if (e.shiftKey) return null
  if (e.key === 'ArrowRight') return 'next'
  if (e.key === 'ArrowLeft') return 'back'
  return null
}

// ---------------------------------------------------------------------------
// The scene filter
// ---------------------------------------------------------------------------

/** A hidden answer's place on the board: a small hollow "?". */
export interface RevealMark {
  key: string
  /** Math coords; on a number line only x is read (the mark sits on the axis). */
  pos: Vec2
  color: string
  /** A number-line mark: on the axis. */
  nl?: boolean
  /** Clickable but not drawn — a chip that already says "?" in its own place. */
  ghost?: boolean
}

/** An answer revealed a moment ago: a ring that opens and fades where it is. */
export interface RevealPulse {
  pos: Vec2
  color: string
  nl?: boolean
  /** 0 at the reveal, 1 when the ring is gone. */
  age: number
}

/** How long a reveal's ring lasts, ms. */
export const PULSE_MS = 450

export interface SceneReveal {
  hidden(key: string): boolean
  /** Draw "?" where a hidden answer sits. */
  positions: boolean
  /** A point's answer key, or null when it is not an answer (it always shows). */
  pointKey(curveId: string, p: SpecialPoint): string | null
  crossKey(a: string, b: string, p: SpecialPoint): string
  /**
   * The other curves' markers. In reveal mode the scene draws them itself,
   * labelled (as an answer key does), and their hidden points become "?".
   */
  context?: readonly { curve: FittedCurve; points: readonly SpecialPoint[] }[]
  /** key → when it was revealed (performance.now()); for the ring. */
  fresh?: ReadonlyMap<string, number>
  now?: number
  /** A number-line solve item's critical values and set ends: where its "?" go. */
  nlMarks?(itemId: string): readonly number[]
}

const NEUTRAL = '#8b93b0'

/** "x = 2" → hidden, kept or ringed: one call per candidate answer. */
function visit(
  r: SceneReveal,
  key: string,
  pos: Vec2,
  color: string,
  marks: RevealMark[],
  pulses: RevealPulse[],
  nl = false,
): boolean {
  if (r.hidden(key)) {
    if (r.positions && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
      marks.push({ key, pos, color, ...(nl ? { nl: true } : {}) })
    }
    return true
  }
  const at = r.fresh?.get(key)
  if (at !== undefined && r.now !== undefined) {
    const age = (r.now - at) / PULSE_MS
    if (age >= 0 && age < 1) pulses.push({ pos, color, age, ...(nl ? { nl: true } : {}) })
  }
  return false
}

/** One curve's points, split into what shows and what hides (with its marks). */
export function splitPoints(
  curve: FittedCurve,
  points: readonly SpecialPoint[],
  r: SceneReveal,
  marks: RevealMark[] = [],
  pulses: RevealPulse[] = [],
): SpecialPoint[] {
  const shown: SpecialPoint[] = []
  for (const p of points) {
    if (!p || !p.pos) continue
    // A hole is ringed by the curve layer whatever happens here: it is a
    // fact about the graph's shape. Only its value (on the card) hides.
    if (p.kind === 'hole') {
      shown.push(p)
      continue
    }
    const key = p.kind === 'intersection' && p.withId ? r.crossKey(curve.id, p.withId, p) : r.pointKey(curve.id, p)
    if (key === null || !visit(r, key, p.pos, curve.color, marks, pulses)) shown.push(p)
  }
  return shown
}

/** "lim f(x) = 6" → the question, without what it equals. Unicode text. */
export function maskAnswerText(text: string, labels: readonly string[]): string {
  let out = text
  for (const label of labels) {
    if (!label) continue
    const esc = label.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
    out = out.replace(new RegExp(`(${esc})\\s*=\\s*[^·]*?(?=\\s*·|$)`, 'g'), '$1 = ?')
  }
  return out
}

/** A unit circle with its exact values replaced by "?". θ — the question — stays. */
export function maskUnitCircle(f: UnitCircleFigure): UnitCircleFigure {
  return {
    ...f,
    pointText: '(?, ?)',
    cosText: f.cosText === null ? null : '?',
    sinText: f.sinText === null ? null : '?',
    refText: f.refText === null ? null : f.refText.replace(/=.*$/, '= ?'),
    tanText: 'tan θ = ?',
    unwrap: f.unwrap ? { ...f.unwrap, pointText: '?' } : null,
    inv: f.inv
      ? { ...f.inv, answerText: f.inv.answerText.replace(/=.*$/, '= ?'), otherText: null }
      : null,
  }
}

/** A related-rates picture with the unknown rate (and any derived rate) as "?". */
export function maskRelatedRates(f: RelatedRatesFigure): RelatedRatesFigure {
  const labels = f.answers ?? []
  if (labels.length === 0) return f
  return {
    ...f,
    prims: f.prims.map((p) => {
      if (p.k === 'arrow' && typeof p.label === 'string') return { ...p, label: maskAnswerText(p.label, labels) }
      if (p.k === 'dim') return { ...p, label: maskAnswerText(p.label, labels) }
      if (p.k === 'label') return { ...p, text: maskAnswerText(p.text, labels) }
      return p
    }),
    // The mini-graph IS the unknown against time.
    graph: null,
    title: f.title ? { ...f.title, text: maskAnswerText(f.title.text, labels) } : null,
  }
}

/**
 * A statistics figure with its answers as "?": the probability chip and the
 * title's answer, the bounds' z-scores, a percentile's x, the simulated mean
 * and SD, the p-value. The shading, the curve and the dots — the question —
 * stay.
 */
export function maskStats(f: StatsFigure): StatsFigure {
  return {
    ...f,
    prims: f.prims.map((p) => (p.k === 'chip' && p.answer ? { ...p, text: maskChip(p.text) } : p)),
    marks: f.marks.map((m) => ({
      ...m,
      text: m.answerText ? '?' : m.text,
      z: m.answerZ && m.z ? m.z.replace(/=.*$/, '= ?') : m.z,
    })),
    title: { question: f.title.question, answer: maskTitle(f.title.answer) },
    // a student describes only what is drawn
    describe: f.describe,
  }
}

/** " x ≈ 119.22" → " x ≈ ?"; " 0.8186" → " ?". */
function maskTitle(a: string): string {
  if (!a) return ''
  const m = /^(.*?[≈=])/.exec(a)
  return m ? `${m[1]} ?` : ' ?'
}

/** "mean 100.02 · SD 2.77" → "mean ? · SD ?"; "0.8186" → "?"; "p ≈ 0.024 (24 of 1000)" → "p ≈ ? (? of 1000)". */
function maskChip(text: string): string {
  // "(23 of 1000)" keeps its 1000: how many were run is the question, not the answer.
  const out = text.replace(/(?<![\d.,])(?<!of )[−-]?\d[\d.,]*(?:×10\^[−-]?\d+)?/g, '?')
  return out === text ? '?' : out
}

/**
 * A shape's measurements with every hidden answer as "?": the chips stay where
 * they are (the class sees WHAT is asked — this side's length, that angle),
 * the congruence ticks and arcs go (they would say which sides are equal).
 * Right-angle squares stay: they are the given of a right-triangle problem.
 */
export function maskShapeMeasure(m: ShapeMeasureDraw, hidden: (part: ShapePart) => boolean): ShapeMeasureDraw {
  const q = (list: readonly (string | null)[] | undefined, text: string) => list?.map((t) => (t === null ? null : text))
  const out: ShapeMeasureDraw = { ...m }
  if (hidden('lengths') && m.lengths) out.lengths = q(m.lengths, '?')
  if (hidden('slopes') && m.slopes) out.slopes = q(m.slopes, 'm = ?')
  if (hidden('angles') && m.angles) out.angles = q(m.angles, '?')
  if (hidden('marks')) {
    delete out.ticks
    delete out.arcs
  }
  if (hidden('midpoints') && m.midpoints) out.midpoints = q(m.midpoints, '(?, ?)')
  if (m.summary) {
    const lines: { part: 'area' | 'class'; text: string }[] = []
    let classDone = false
    for (const l of m.summary) {
      if (l.part === 'area') lines.push(hidden('area') ? { part: 'area', text: 'P = ?   A = ?' } : l)
      else if (!hidden('class')) lines.push(l)
      else if (!classDone) {
        classDone = true
        const at = l.text.indexOf(': ')
        lines.push({ part: 'class', text: at > 0 ? `${l.text.slice(0, at)}: ?` : '?' })
      }
    }
    out.summary = lines
  }
  if (m.pair && hidden('pair')) {
    out.pair = {
      to: m.pair.to,
      length: m.pair.length === null ? null : '?',
      slope: m.pair.slope === null ? null : 'm = ?',
      midpoint: m.pair.midpoint === null ? null : '(?, ?)',
    }
  }
  if (m.equation && hidden('line')) out.equation = 'y = ?'
  return out
}

/** Every shape with its hidden measurement answers masked. */
export function maskShapes(shapes: readonly Shape[], hidden: (key: string) => boolean): Shape[] {
  return shapes.map((s) => {
    if (s.kind === 'vector' || !s.measure) return s
    return { ...s, measure: maskShapeMeasure(s.measure, (part) => hidden(shapeKey(s.id, part))) } as Shape
  })
}

/**
 * A sign chart as a blank to fill in: the strips and their x line stay, the
 * signs, arrows, cups and the critical values' names go ("?" under each tick).
 */
export function maskSignChart(f: SignChartFigure): SignChartFigure {
  return {
    ...f,
    rows: f.rows.map((r) => ({ ...r, marks: [], intervals: r.intervals.map((iv) => ({ ...iv, sign: null })) })),
    ticks: f.ticks.map((t) => ({ ...t, text: '?' })),
  }
}

/**
 * The scene as reveal mode shows it: every hidden answer taken out, and a
 * "?" mark (BoardScene.revealMarks) where it sat. The SAME filter runs on the
 * screen and on every export, so a figure downloaded in reveal mode is the
 * student copy on screen, "?" marks included.
 *
 * Chrome indices (the hovered / highlighted / open analysis row) are remapped
 * onto the filtered list, so a hidden point can never be the one emphasised.
 */
export function applyReveal(scene: BoardScene, r: SceneReveal | null | undefined): BoardScene {
  if (!r) return scene
  const marks: RevealMark[] = []
  const pulses: RevealPulse[] = []
  const out: BoardScene = { ...scene }

  // ---- the selected curve's markers and chips
  const an = scene.analysis
  let remap: ((i: number | null) => number | null) | null = null
  if (an && an.points.length > 0) {
    const kept: number[] = []
    const shown: SpecialPoint[] = []
    an.points.forEach((p, i) => {
      const s = splitPoints(an.curve, [p], r, marks, pulses)
      if (s.length > 0) {
        kept.push(i)
        shown.push(p)
      }
    })
    out.analysis = shown.length > 0 ? { curve: an.curve, points: shown } : null
    const at = new Map(kept.map((old, i) => [old, i]))
    remap = (i) => (i === null ? null : (at.get(i) ?? null))
  }
  if (scene.chrome && remap) {
    out.chrome = {
      ...scene.chrome,
      highlight: remap(scene.chrome.highlight),
      openIdx: remap(scene.chrome.openIdx),
      hoverIdx: remap(scene.chrome.hoverIdx),
    }
  }

  // ---- an answer key's other curves (worksheets), and the screen's context layer
  if (scene.answerKey?.more) {
    out.answerKey = {
      ...scene.answerKey,
      more: scene.answerKey.more.map((m) => ({ curve: m.curve, points: splitPoints(m.curve, m.points, r, marks, pulses) })),
    }
  }
  // The other curves' markers come INTO the scene, labelled the way a printed
  // key labels them (BoardScene.answerKey): a revealed answer has to say
  // what it is, and the screen's rule — labels only on the selected curve —
  // would reveal a bare ring. Their own layer is then left empty by the App.
  const shownContext: { curve: FittedCurve; points: readonly SpecialPoint[] }[] = []
  for (const m of r.context ?? []) {
    if (!m.curve.visible) continue
    const pts = splitPoints(m.curve, m.points, r, marks, pulses)
    if (pts.length > 0) shownContext.push({ curve: m.curve, points: pts })
  }
  if (!scene.answerKey && scene.kind !== 'number-line') {
    out.answerKey = { more: shownContext, unlabelled: [] }
  }

  // ---- where the curves meet
  if (scene.intersections && scene.intersections.length > 0) {
    const shownIds = new Set(scene.curves.filter((c) => c.visible).map((c) => c.id))
    out.intersections = scene.intersections.filter((c) => {
      const other = c.point.withId ?? ''
      const key = r.crossKey(c.curveId, other, c.point)
      // a crossing whose curve is hidden is not drawn, so it has no "?" either
      if (!shownIds.has(c.curveId) || !shownIds.has(other)) return true
      return !visit(r, key, c.point.pos, NEUTRAL, marks, pulses)
    })
  }

  // ---- the calculus tools' chips ("c = 2√3/3", "L = 6", an LP corner)
  if (scene.overlays && scene.overlays.length > 0) {
    const colorOf = (ov: Overlay): string => {
      if (ov.color) return ov.color
      const id = 'curveId' in ov ? ov.curveId : undefined
      return scene.curves.find((c) => c.id === id)?.color ?? NEUTRAL
    }
    out.overlays = scene.overlays.filter((ov) => {
      if (ov.kind !== 'label' || !ov.answer) return true
      return !visit(r, ov.answer, ov.at, colorOf(ov), marks, pulses)
    })
  }

  // ---- unit circles: the chips stay where they are and say "?"
  if (scene.unitCircles && scene.unitCircles.length > 0) {
    out.unitCircles = scene.unitCircles.map((u) => {
      const key = ucKey(u.id)
      const p = { x: u.center.x + Math.cos(u.theta), y: u.center.y + Math.sin(u.theta) }
      if (!r.hidden(key)) {
        visit(r, key, p, u.color, marks, pulses)
        return u
      }
      if (u.visible) marks.push({ key, pos: p, color: u.color, ghost: true })
      return maskUnitCircle(u)
    })
  }

  // ---- related rates: the unknown rate's chips say "?"
  if (scene.relatedRates && scene.relatedRates.length > 0) {
    out.relatedRates = scene.relatedRates.map((f) => {
      const key = rrKey(f.id)
      if (!r.hidden(key)) return f
      if (f.visible && f.title) marks.push({ key, pos: f.title.at, color: f.color, ghost: true })
      return maskRelatedRates(f)
    })
  }

  // ---- statistics: the answers say "?" until revealed
  if (scene.stats && scene.stats.length > 0) {
    out.stats = scene.stats.map((f) => {
      const key = statKey(f.id)
      const at = { x: (f.panel.x0 + f.panel.x1) / 2, y: f.panel.y1 - 0.45 }
      if (!r.hidden(key)) {
        visit(r, key, at, f.color, marks, pulses)
        return f
      }
      if (f.visible) marks.push({ key, pos: at, color: f.color, ghost: true })
      return maskStats(f)
    })
  }

  // ---- sign charts: a blank chart until revealed
  if (scene.signCharts && scene.signCharts.length > 0) {
    out.signCharts = scene.signCharts.map((f) => (r.hidden(calcKey(f.id)) ? maskSignChart(f) : f))
  }

  // ---- number line: a solved inequality draws its bare line until revealed
  if (scene.kind === 'number-line' && scene.items) {
    const hiddenIds = new Set<string>()
    for (const it of scene.items) {
      if (it.kind !== 'solve') continue
      const key = solveKey(it.id)
      const xs = r.nlMarks?.(it.id) ?? []
      if (r.hidden(key)) {
        hiddenIds.add(it.id)
        if (r.positions) for (const x of xs) marks.push({ key, pos: { x, y: 0 }, color: it.color, nl: true })
        else marks.push({ key, pos: { x: xs[0] ?? 0, y: 0 }, color: it.color, nl: true, ghost: true })
      } else {
        for (const x of xs) visit(r, key, { x, y: 0 }, it.color, marks, pulses, true)
      }
    }
    if (hiddenIds.size > 0) out.nlHidden = hiddenIds
  }

  // ---- shapes: their measurement chips say "?" until revealed
  if (scene.shapes && scene.shapes.some((s) => s.kind !== 'vector' && s.measure)) {
    out.shapes = maskShapes(scene.shapes, (k) => r.hidden(k))
    for (const s of scene.shapes) {
      if (s.kind === 'vector' || !s.measure || !s.visible) continue
      for (const { part, pos } of shapeAnswerSpots(s)) {
        const key = shapeKey(s.id, part)
        if (r.hidden(key)) marks.push({ key, pos, color: s.color, ghost: true })
        else visit(r, key, pos, s.color, marks, pulses)
      }
    }
  }

  if (marks.length > 0) out.revealMarks = marks
  if (pulses.length > 0) out.revealPulses = pulses
  return out
}

/**
 * Where a shape's answers sit, in math coords — one spot per part, for the
 * board's click-to-reveal: the middle of the first side for a side readout,
 * the centroid for perimeter / area / classification.
 */
export function shapeAnswerSpots(s: Shape): { part: ShapePart; pos: Vec2 }[] {
  if (s.kind === 'vector' || !s.measure) return []
  const m = s.measure
  const out: { part: ShapePart; pos: Vec2 }[] = []
  const pts: readonly Vec2[] =
    s.kind === 'polygon' ? s.pts : s.kind === 'segment' ? [s.a, s.b] : s.kind === 'point' ? [s.at, m.pair?.to ?? s.at] : [s.through]
  if (pts.length === 0) return out
  const mid = (i: number): Vec2 => {
    const a = pts[i % pts.length]
    const b = pts[(i + 1) % pts.length]
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }
  const centroid = {
    x: pts.reduce((t, p) => t + p.x, 0) / pts.length,
    y: pts.reduce((t, p) => t + p.y, 0) / pts.length,
  }
  if (m.lengths?.some((t) => t)) out.push({ part: 'lengths', pos: mid(0) })
  if (m.slopes?.some((t) => t)) out.push({ part: 'slopes', pos: mid(pts.length > 2 ? 1 : 0) })
  if (m.midpoints?.some((t) => t)) out.push({ part: 'midpoints', pos: mid(pts.length > 2 ? 2 : 0) })
  if (m.angles?.some((t) => t)) out.push({ part: 'angles', pos: { x: (pts[0].x * 3 + centroid.x) / 4, y: (pts[0].y * 3 + centroid.y) / 4 } })
  if (m.summary?.some((l) => l.part === 'area')) out.push({ part: 'area', pos: centroid })
  if (m.summary?.some((l) => l.part === 'class')) out.push({ part: 'class', pos: centroid })
  if (m.pair) out.push({ part: 'pair', pos: mid(0) })
  if (m.equation) out.push({ part: 'line', pos: s.kind === 'segment' ? mid(0) : pts[0] })
  return out.filter((o) => Number.isFinite(o.pos.x) && Number.isFinite(o.pos.y))
}

/** The marks within `radius` px of a screen point, nearest first. */
export function markAt(
  marks: readonly RevealMark[],
  at: Vec2,
  toPx: (m: RevealMark) => Vec2,
  radius: number,
): RevealMark | null {
  let best: RevealMark | null = null
  let bestD = radius
  for (const m of marks) {
    const p = toPx(m)
    const d = Math.hypot(p.x - at.x, p.y - at.y)
    if (d <= bestD) {
      bestD = d
      best = m
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// TeX
// ---------------------------------------------------------------------------

/**
 * "\lim_{x\to 3} f(x) = 6" → ["\lim_{x\to 3} f(x)", "6"]: the question and
 * its answer, split at the first top-level "=" (or \approx). Null when there is
 * no such sign — the whole line is then the answer.
 */
export function splitAnswerTex(tex: string): [string, string] | null {
  let depth = 0
  for (let i = 0; i < tex.length; i++) {
    const ch = tex[i]
    if (ch === '\\') {
      if (depth === 0 && tex.startsWith('\\approx', i)) return [tex.slice(0, i).trimEnd(), tex.slice(i + 7).trimStart()]
      // skip the command name so "\left(" never counts its bracket
      i++
      while (i + 1 < tex.length && /[a-zA-Z]/.test(tex[i + 1])) i++
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') depth--
    else if (ch === '=' && depth === 0) return [tex.slice(0, i).trimEnd(), tex.slice(i + 1).trimStart()]
  }
  return null
}

/** A legend / readout line with its answer replaced by "?". */
export function maskTex(tex: string): string {
  const s = splitAnswerTex(tex)
  return s ? `${s[0]} = \\,?` : '?'
}

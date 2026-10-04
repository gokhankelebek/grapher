// ============================================================================
// src/ui/probLinks.ts — the App's half of a Probability object (Build ▾ →
// Probability; NC Math 2 S-CP.1, 3–8).
//
// The document stores a BoardProb (src/core/probPersist.ts): the table's
// labels and counts, the Venn regions as typed and the event, the bag or the
// typed stages and the leaves picked. This file turns that into
//
//   probFigure()   what the board draws (src/render/stats.ts) in the panel —
//                  the two-way table with the conditional's row or column and
//                  cell washed, the Venn diagram with the event shaded, or the
//                  tree with the event's paths heavy — and the key readouts
//   probSpots()    where a click lands: a table cell (A = its row, B = its
//                  column) or a tree leaf (in or out of the event)
//   probCard()     every string the card prints
//   probDescribe   the figure in words (describeGraph)
//
// so the board, the card, the description and the export read the same exact
// fractions. Nothing computed here is stored.
// ============================================================================

import type { Vec2 } from '../core/types'
import type { BoardProb, ProbStage } from '../core/probPersist'
import type { Frac, Leaf, ParseResult, Preset, RelView, TreeNode, TreeResult, TwoWay, TwoWayFacts, VennWorking } from '../core/probability'
import {
  SET_LETTERS,
  ZERO,
  atomCount,
  atomName,
  atomText,
  bagTree,
  decText,
  eventAtoms,
  eventWords,
  fd,
  frac,
  fracAll,
  fracText,
  independence,
  isZero,
  manualTree,
  parseEvent,
  parseFrac,
  pctText,
  probOfAtoms,
  ratioText,
  regionsFromTable,
  relCell,
  toNum,
  treeEvent,
  treePresets,
  twoWayFacts,
  vennTotals,
  vennWorking,
} from '../core/probability'
import type { DescribeStat } from '../core/describeAdapters'
import type { StatPrim, StatsFigure } from '../render/stats'
import { panelBox } from './statsLinks'
import type { Box } from './statsLinks'

export type { BoardProb }

/** Short name for a card and a toast. */
export const probName = 'Probability'

// ---------------------------------------------------------------------------
// The three models, read from the stored settings
// ---------------------------------------------------------------------------

export function twoWayOf(p: BoardProb): TwoWay {
  return { rows: p.table.rows, cols: p.table.cols, counts: p.table.counts }
}

/** What A and B stand for in the table: its row a and its column b. */
export function tableNames(p: BoardProb): { A: string; B: string } {
  return { A: p.table.rows[p.table.a] ?? 'A', B: p.table.cols[p.table.b] ?? 'B' }
}

export interface VennModel {
  sets: 2 | 3
  values: Frac[]
  /** Regions whose text was not a number (read as 0). */
  bad: number[]
  /** What each letter stands for ('' when nothing). */
  names: string[]
  fromTable: boolean
}

export function vennModel(p: BoardProb): VennModel {
  const v = p.venn
  if (v.fromTable) {
    const n = tableNames(p)
    return { sets: 2, values: regionsFromTable(twoWayOf(p), p.table.a, p.table.b), bad: [], names: [n.A, n.B, ''], fromTable: true }
  }
  const n = atomCount(v.sets)
  const bad: number[] = []
  const values: Frac[] = []
  for (let a = 0; a < n; a++) {
    const f = parseFrac(v.regions[a] ?? '')
    if (!f || f.n < 0n) {
      bad.push(a)
      values.push(ZERO)
    } else values.push(f)
  }
  return { sets: v.sets, values, bad, names: [0, 1, 2].map((i) => v.names[i] ?? ''), fromTable: false }
}

export function vennEvent(p: BoardProb): { parse: ParseResult; working: VennWorking | null } {
  const m = vennModel(p)
  const parse = parseEvent(p.venn.expr, m.sets)
  return { parse, working: parse.ok ? vennWorking(parse.node, { sets: m.sets, values: m.values }) : null }
}

const treeCache = new Map<string, TreeResult>()

export function treeOf(p: BoardProb): TreeResult {
  const t = p.tree
  const key = JSON.stringify(t.mode === 'bag' ? ['bag', t.bag, t.draws, t.replace] : ['manual', t.stages])
  const hit = treeCache.get(key)
  if (hit) return hit
  const out = t.mode === 'bag' ? bagTree(t.bag, t.draws, t.replace) : manualTree(t.stages.map((s: ProbStage) => ({ ...s })))
  treeCache.set(key, out)
  if (treeCache.size > 32) {
    const first = treeCache.keys().next().value
    if (first !== undefined) treeCache.delete(first)
  }
  return out
}

/** The tree's event: its name ("both Red", or E for a hand-picked set) and the leaves in it. */
export function treeEventName(p: BoardProb): string {
  return p.tree.event && p.tree.pick.length > 0 ? p.tree.event : 'E'
}

export function treePresetsOf(p: BoardProb): Preset[] {
  return treePresets(treeOf(p), p.tree.mode === 'bag' ? 'colour' : 'outcome')
}

// ---------------------------------------------------------------------------
// Numbers on the board
// ---------------------------------------------------------------------------

/** A percent for a table cell: "45%", "66.7%" (one decimal when it does not terminate). */
function cellPct(f: Frac): string {
  const t = pctText(f)
  return t.startsWith('≈ ') ? t.slice(2) : t
}

export function cellText(t: TwoWay, view: RelView, i: number, j: number): string {
  const f = relCell(t, twoWayFactsCached(t).totals, view, i, j)
  if (!f) return '—'
  return view === 'count' ? fracText(f) : cellPct(f)
}

const factsCache = new Map<string, TwoWayFacts>()
function twoWayFactsCached(t: TwoWay, a = 0, b = 0): TwoWayFacts {
  const key = JSON.stringify([t.rows.length, t.cols.length, t.counts, a, b])
  const hit = factsCache.get(key)
  if (hit) return hit
  const f = twoWayFacts(t, a, b)
  factsCache.set(key, f)
  if (factsCache.size > 32) {
    const first = factsCache.keys().next().value
    if (first !== undefined) factsCache.delete(first)
  }
  return f
}

export function tableFacts(p: BoardProb): TwoWayFacts {
  return twoWayFactsCached(twoWayOf(p), p.table.a, p.table.b)
}

/** "30/45 = 2/3" or "—" when there is nothing to divide by. */
const rText = (r: { num: number; den: number }): string => (r.den > 0 ? ratioText(r.num, r.den) : '— (none)')

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const TITLE = 1.05
const PAD = 0.35

interface Frame {
  panel: Box
  /** Where the picture goes (left), and the readout column (right). */
  pic: Box
  side: Box
}

function frame(index: number, sideW = 4.6): Frame {
  const panel = panelBox(index)
  const top = panel.y1 - TITLE
  const bottom = panel.y0 + PAD
  const pic: Box = { x0: panel.x0 + PAD, x1: panel.x1 - sideW - 0.2, y0: bottom, y1: top }
  const side: Box = { x0: panel.x1 - sideW, x1: panel.x1 - PAD, y0: bottom, y1: top }
  return { panel, pic, side }
}

function baseFigure(p: BoardProb, f: Frame): Omit<StatsFigure, 'prims' | 'title' | 'describe'> {
  return {
    id: p.id,
    kind: 'prob',
    visible: p.hidden !== true,
    color: p.color,
    panel: f.panel,
    plot: { x0: f.panel.x0 + PAD, x1: f.panel.x1 - PAD, y0: f.panel.y0 + PAD, y1: f.panel.y1 - TITLE },
    axisY: f.panel.y0,
    noAxis: true,
    ticks: [],
    marks: [],
    zRow: false,
    axisLabel: '',
  }
}

/** A readout: the question end-aligned at `x`, the answer start-aligned just after it (reveal mode masks only the answer). */
function readout(prims: StatPrim[], x: number, y: number, q: string, a: string, opts: { bold?: boolean; ink?: 'main' | 'hot' | 'axis'; color?: string } = {}): void {
  prims.push({ k: 'text', at: { x, y }, text: q, ink: 'axis', small: true, rise: 0, align: 'end', bold: opts.bold })
  prims.push({ k: 'text', at: { x: x + 0.1, y }, text: a, ink: opts.ink ?? 'main', small: true, rise: 0, align: 'start', bold: opts.bold, answer: true, color: opts.color })
}

/** A full-width line of words: shown, or (an answer) masked. */
function note(prims: StatPrim[], x: number, y: number, text: string, answer: boolean, opts: { bold?: boolean; ink?: 'main' | 'hot' | 'axis' } = {}): void {
  prims.push({ k: 'text', at: { x, y }, text, ink: opts.ink ?? 'axis', small: true, rise: 0, align: 'start', bold: opts.bold, answer: answer || undefined })
}

/** Split a sentence at ": " so it fits two lines on the board. */
function twoLines(s: string): [string, string] {
  const i = s.indexOf(': ')
  return i < 0 ? [s, ''] : [s.slice(0, i + 1), s.slice(i + 2)]
}

// ---------------------------------------------------------------------------
// The two-way table
// ---------------------------------------------------------------------------

interface TableGeo {
  x: number[]
  y: number[]
  /** Cell centre for row i (R = totals row), column j (C = totals column). */
  at(i: number, j: number): Vec2
  /** Cell box. */
  box(i: number, j: number): Box
}

function tableGeo(p: BoardProb, pic: Box): TableGeo {
  const R = p.table.rows.length
  const C = p.table.cols.length
  const labelW = Math.min(2.2, (pic.x1 - pic.x0) * 0.3)
  const cellW = (pic.x1 - pic.x0 - labelW) / (C + 1)
  const rowH = Math.min(0.62, (pic.y1 - pic.y0 - 1.5) / (R + 2))
  const x = [pic.x0, pic.x0 + labelW]
  for (let j = 1; j <= C + 1; j++) x.push(pic.x0 + labelW + j * cellW)
  const y = [pic.y1]
  for (let i = 1; i <= R + 2; i++) y.push(pic.y1 - i * rowH)
  // header is row −1 → y[0]..y[1]; data row i → y[i+1]..y[i+2]; totals row R → y[R+1]..y[R+2]
  const box = (i: number, j: number): Box => ({ x0: x[j + 1], x1: x[j + 2], y1: y[i + 1], y0: y[i + 2] })
  const at = (i: number, j: number): Vec2 => {
    const b = box(i, j)
    return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }
  }
  return { x, y, at, box }
}

function tableFigure(p: BoardProb, index: number): StatsFigure {
  const f = frame(index)
  const prims: StatPrim[] = []
  const t = twoWayOf(p)
  const facts = tableFacts(p)
  const R = t.rows.length
  const C = t.cols.length
  const g = tableGeo(p, f.pic)
  const { a, b } = facts
  const given = p.table.given
  const view = p.table.rel

  // ---- washes: the given row or column (the denominator), and the cell (the numerator)
  const wash = (bx: Box, ink: 'main' | 'hot', alpha: number): void => {
    prims.push({ k: 'rect', x0: bx.x0, x1: bx.x1, y0: bx.y0, y1: bx.y1, ink, alpha, edge: false })
  }
  if (given === 'B') {
    for (let i = 0; i <= R; i++) wash(g.box(i, b), 'main', 0.16)
    prims.push({ k: 'curve', pts: rectPts({ x0: g.x[b + 1], x1: g.x[b + 2], y0: g.y[R + 2], y1: g.y[1] }), ink: 'main', w: 2 })
  } else {
    for (let j = 0; j <= C; j++) wash(g.box(a, j), 'main', 0.16)
    prims.push({ k: 'curve', pts: rectPts({ x0: g.x[1], x1: g.x[C + 2], y0: g.y[a + 2], y1: g.y[a + 1] }), ink: 'main', w: 2 })
  }
  wash(g.box(a, b), 'hot', 0.42)
  prims.push({ k: 'curve', pts: rectPts(g.box(a, b)), ink: 'hot', w: 2.2 })

  // ---- the grid
  const left = g.x[0]
  const right = g.x[g.x.length - 1]
  const top = g.y[0]
  const bottom = g.y[g.y.length - 1]
  g.y.forEach((yy, k) => {
    const heavy = k === 1 || k === R + 1
    prims.push({ k: 'curve', pts: [{ x: k === 0 ? g.x[1] : left, y: yy }, { x: right, y: yy }], ink: 'axis', w: heavy ? 1.5 : 0.8 })
  })
  g.x.forEach((xx, k) => {
    const heavy = k === 1 || k === C + 1
    prims.push({ k: 'curve', pts: [{ x: xx, y: k === 0 ? g.y[1] : top }, { x: xx, y: bottom }], ink: 'axis', w: heavy ? 1.5 : 0.8 })
  })

  // ---- labels
  t.cols.forEach((c, j) => {
    const at = { x: (g.x[j + 1] + g.x[j + 2]) / 2, y: (g.y[0] + g.y[1]) / 2 }
    prims.push({ k: 'text', at, text: c, ink: j === b ? 'main' : 'axis', small: true, rise: 0, bold: true })
  })
  prims.push({ k: 'text', at: { x: (g.x[C + 1] + g.x[C + 2]) / 2, y: (g.y[0] + g.y[1]) / 2 }, text: 'Total', ink: 'axis', small: true, rise: 0, bold: true })
  t.rows.forEach((r, i) => {
    prims.push({ k: 'text', at: { x: g.x[0] + 0.12, y: (g.y[i + 1] + g.y[i + 2]) / 2 }, text: r, ink: i === a ? 'main' : 'axis', small: true, rise: 0, align: 'start', bold: true })
  })
  prims.push({ k: 'text', at: { x: g.x[0] + 0.12, y: (g.y[R + 1] + g.y[R + 2]) / 2 }, text: 'Total', ink: 'axis', small: true, rise: 0, align: 'start', bold: true })

  // ---- the cells: counts (given) or percentages (derived — answers)
  for (let i = 0; i <= R; i++) {
    for (let j = 0; j <= C; j++) {
      const text = cellText(t, view, i, j)
      // 100% by definition: a row's total in row percentages, a column's in column percentages, the grand total
      const whole = (view === 'row' && j === C) || (view === 'col' && i === R) || (i === R && j === C)
      prims.push({
        k: 'text',
        at: g.at(i, j),
        text,
        ink: i === a && j === b ? 'hot' : 'axis',
        small: view !== 'count' && C > 3,
        rise: 0,
        bold: (i === a && j === b) || (i === R && j === C),
        answer: view !== 'count' && !whole ? true : undefined,
      })
    }
  }
  if (view !== 'count') {
    const what = view === 'joint' ? 'joint relative frequencies (of the grand total)' : view === 'row' ? 'row percentages (each row adds to 100%)' : 'column percentages (each column adds to 100%)'
    note(prims, g.x[0], bottom - 0.3, what, false)
  }

  // ---- the readouts, right
  const names = tableNames(p)
  const s = f.side
  const colX = s.x0 + 1.55
  let y = s.y1 - 0.15
  const step = 0.42
  note(prims, s.x0, y, `A = ${clip(names.A, 22)}`, false, { ink: 'main', bold: true })
  y -= step
  note(prims, s.x0, y, `B = ${clip(names.B, 22)}`, false, { ink: 'main', bold: true })
  y -= step * 1.2
  readout(prims, colX, y, 'P(A and B) =', rText(facts.joint))
  y -= step
  readout(prims, colX, y, 'P(A) =', rText(facts.pA))
  y -= step
  readout(prims, colX, y, 'P(B) =', rText(facts.pB))
  y -= step * 1.2
  const cond = given === 'B' ? facts.aGivenB : facts.bGivenA
  const cq = given === 'B' ? 'P(A | B) =' : 'P(B | A) ='
  readout(prims, colX, y, cq, rText(cond), { bold: true, ink: 'hot' })
  y -= step
  if (cond.p) {
    readout(prims, colX, y, '', `${decText(cond.p).replace(/^≈ /, '≈ ')} · ${pctText(cond.p)}`, { ink: 'hot' })
    y -= step
    note(prims, s.x0, y, given === 'B' ? `${cond.num} of B’s ${cond.den} are in A` : `${cond.num} of A’s ${cond.den} are in B`, true)
  }

  // ---- the independence verdict, under the table
  if (facts.indep) {
    const iv = indepOf(p, facts)
    const [h, rest] = twoLines(iv.verdict)
    const y0 = view !== 'count' ? bottom - 0.75 : bottom - 0.4
    note(prims, g.x[0], y0, 'Are A and B independent?', false, { bold: true })
    const yy = y0 - 0.4
    note(prims, g.x[0], yy, h, true, { bold: true, ink: iv.independent ? 'main' : 'hot' })
    if (rest) note(prims, g.x[0], yy - 0.38, rest.replace(/\.$/, ''), true)
    note(prims, g.x[0], yy - 0.76, iv.product, true)
  }

  const cp = cond.p
  const title = {
    question: `Two-way table · ${given === 'B' ? 'P(A | B)' : 'P(B | A)'}`,
    answer: cp ? ` = ${fracText(cp)}` : '',
  }
  return { ...baseFigure(p, f), prims, title, describe: probDescribe(p) }
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function rectPts(b: Box): Vec2[] {
  return [
    { x: b.x0, y: b.y0 },
    { x: b.x1, y: b.y0 },
    { x: b.x1, y: b.y1 },
    { x: b.x0, y: b.y1 },
    { x: b.x0, y: b.y0 },
  ]
}

/** The table's independence check, with the conditional the card leads with. */
export function indepOf(p: BoardProb, facts: TwoWayFacts = tableFacts(p)) {
  const { pA, pB, joint, aGivenB, bGivenA } = facts
  if (!pA.p || !pB.p || !joint.p) return { independent: false, conditional: '', product: '', verdict: 'Enter some counts to compare.', close: false }
  return p.table.given === 'B'
    ? independence(pA.p, pB.p, joint.p, aGivenB.p, null)
    : independence(pA.p, pB.p, joint.p, null, bGivenA.p)
}

// ---------------------------------------------------------------------------
// The Venn diagram
// ---------------------------------------------------------------------------

export interface VennGeo {
  box: Box
  circles: { x: number; y: number; r: number }[]
  /** Where each atom's value is written. */
  labels: Vec2[]
  /** Where each set's letter goes. */
  letters: Vec2[]
}

export function vennGeo(pic: Box, sets: 2 | 3): VennGeo {
  const box = pic
  const cx = (box.x0 + box.x1) / 2
  const cy = (box.y0 + box.y1) / 2 - 0.05
  const H = box.y1 - box.y0
  const W = box.x1 - box.x0
  let circles: { x: number; y: number; r: number }[]
  if (sets === 2) {
    const r = Math.min(H * 0.36, W * 0.24)
    const d = r * 0.62
    circles = [
      { x: cx - d, y: cy, r },
      { x: cx + d, y: cy, r },
    ]
  } else {
    const r = Math.min(H * 0.29, W * 0.21)
    const d = r * 0.62
    circles = [
      { x: cx - d, y: cy + d * 0.55, r },
      { x: cx + d, y: cy + d * 0.55, r },
      { x: cx, y: cy - d * 0.95, r },
    ]
  }
  // each atom's label: the grid point inside it farthest from every circle's edge
  const n = 1 << sets
  const best: { at: Vec2; score: number }[] = Array.from({ length: n }, () => ({ at: { x: cx, y: cy }, score: -1 }))
  const NX = 70
  const NY = 44
  for (let ix = 1; ix < NX; ix++) {
    for (let iy = 1; iy < NY; iy++) {
      const x = box.x0 + (ix / NX) * W
      const y = box.y0 + (iy / NY) * H
      let atom = 0
      let edge = Infinity
      circles.forEach((c, i) => {
        const dd = Math.hypot(x - c.x, y - c.y)
        if (dd < c.r) atom |= 1 << i
        edge = Math.min(edge, Math.abs(dd - c.r))
      })
      if (atom === 0) continue
      if (edge > best[atom].score) best[atom] = { at: { x, y }, score: edge }
    }
  }
  best[0] = { at: { x: box.x1 - 0.55, y: box.y0 + 0.35 }, score: 1 }
  const letters = circles.map((c, i) => {
    if (sets === 2) return { x: c.x + (i === 0 ? -1 : 1) * c.r * 0.72, y: c.y + c.r * 0.86 }
    if (i < 2) return { x: c.x + (i === 0 ? -1 : 1) * c.r * 0.75, y: c.y + c.r * 0.85 }
    return { x: c.x + c.r * 0.95, y: c.y - c.r * 0.8 }
  })
  return { box, circles, labels: best.map((b) => b.at), letters }
}

function vennFigure(p: BoardProb, index: number): StatsFigure {
  const f = frame(index)
  const prims: StatPrim[] = []
  const m = vennModel(p)
  const geo = vennGeo(f.pic, m.sets)
  const ev = vennEvent(p)
  const mask = ev.working ? ev.working.mask : 0
  prims.push({ k: 'venn', box: geo.box, circles: geo.circles, atoms: mask, ink: 'main', alpha: 0.42 })
  // the sample space and its total
  const tot = vennTotals({ sets: m.sets, values: m.values })
  prims.push({ k: 'text', at: { x: geo.box.x0 + 0.15, y: geo.box.y1 - 0.25 }, text: 'S', ink: 'axis', rise: 0, align: 'start', bold: true })
  prims.push({
    k: 'text',
    at: { x: geo.box.x1 - 0.15, y: geo.box.y1 - 0.25 },
    text: tot.counts ? `total ${fracText(tot.total)}` : `total ${fracText(tot.total)}`,
    ink: 'axis',
    small: true,
    rise: 0,
    align: 'end',
  })
  // letters and what they stand for
  geo.circles.forEach((_, i) => {
    const name = m.names[i] ? `${SET_LETTERS[i]}: ${clip(m.names[i], 16)}` : SET_LETTERS[i]
    prims.push({ k: 'text', at: geo.letters[i], text: name, ink: 'main', small: !!m.names[i], rise: 0, bold: true, align: i === 0 ? 'end' : 'start' })
  })
  // the region values (given)
  for (let a = 0; a < atomCount(m.sets); a++) {
    const bad = m.bad.includes(a)
    prims.push({ k: 'text', at: geo.labels[a], text: bad ? '?' : fracText(m.values[a]), ink: mask & (1 << a) ? 'hot' : 'axis', rise: 0, bold: !!(mask & (1 << a)) })
  }

  // readouts
  const s = f.side
  let y = s.y1 - 0.15
  const step = 0.42
  const w = ev.working
  if (!ev.parse.ok) {
    note(prims, s.x0, y, ev.parse.error, false, { ink: 'hot' })
  } else if (w) {
    note(prims, s.x0, y, `Shaded: ${w.text}`, false, { bold: true, ink: 'main' })
    y -= step * 1.3
    readout(prims, s.x0 + 1.5, y, `P(${clip(w.text, 14)}) =`, w.p ? fracText(w.p) : '—', { bold: true, ink: 'hot' })
    y -= step
    if (w.p && !(w.p.d === 1n)) {
      readout(prims, s.x0 + 1.5, y, '', `${decText(w.p).startsWith('≈') ? decText(w.p) : `= ${decText(w.p)}`} · ${pctText(w.p)}`, { ink: 'hot' })
      y -= step
    }
    y -= step * 0.3
    note(prims, s.x0, y, 'Sum of regions:', false)
    y -= step
    note(prims, s.x0 + 0.2, y, w.regions, true)
    y -= step * 1.3
    if (w.rule && w.rule.length <= 44) {
      note(prims, s.x0, y, w.rule.startsWith(`P(${w.text}) = 1`) ? 'Complement rule:' : 'Addition Rule:', false)
      y -= step
      note(prims, s.x0 + 0.2, y, w.rule, false)
      y -= step
      note(prims, s.x0 + 0.2, y, w.ruleNumbers, true)
    } else if (w.rule) {
      note(prims, s.x0, y, 'Inclusion–exclusion: see the card', false)
    }
  }
  if (m.bad.length > 0) note(prims, s.x0, s.y0 + 0.2, `Some regions are not numbers (read as 0)`, false, { ink: 'hot' })
  else if (tot.offBy) note(prims, s.x0, s.y0 + 0.2, `The regions add to ${fracText(tot.offBy)}, not 1`, false, { ink: 'hot' })

  const title = {
    question: `Venn diagram · P(${w ? w.text : '…'})`,
    answer: w && w.p ? ` = ${fracText(w.p)}` : '',
  }
  return { ...baseFigure(p, f), prims, title, describe: probDescribe(p) }
}

// ---------------------------------------------------------------------------
// The tree diagram
// ---------------------------------------------------------------------------

interface TreeGeo {
  /** Node position by path key ('' = root). */
  pos: Map<string, Vec2>
  /** Leaf text column (names) and product column. */
  leafX: number
  prodX: number
  stageX: number[]
  leafY: Map<string, number>
}

function treeGeo(tree: TreeResult, area: Box): TreeGeo {
  const L = Math.max(1, tree.leaves.length)
  const k = Math.max(1, tree.stages)
  const W = area.x1 - area.x0
  const colW = Math.min(2.3, (W - 4.4) / k)
  const stageX = Array.from({ length: k + 1 }, (_, i) => area.x0 + 0.15 + i * colW)
  const leafX = stageX[k] + 0.45
  const prodX = leafX + Math.max(0.65, 0.22 * k + 0.25)
  const H = area.y1 - area.y0
  const gap = H / L
  const pos = new Map<string, Vec2>()
  const leafY = new Map<string, number>()
  tree.leaves.forEach((l, i) => leafY.set(l.key, area.y1 - gap * (i + 0.5)))
  const place = (node: TreeNode): [number, number] | null => {
    if (node.branches.length === 0) {
      const y = leafY.get(node.key)
      if (y === undefined) return null
      pos.set(node.key, { x: stageX[node.depth], y })
      return [y, y]
    }
    let lo = Infinity
    let hi = -Infinity
    for (const br of node.branches) {
      const r = place(br.child)
      if (!r) continue
      lo = Math.min(lo, r[0])
      hi = Math.max(hi, r[1])
    }
    if (!Number.isFinite(lo)) return null
    pos.set(node.key, { x: stageX[node.depth], y: (lo + hi) / 2 })
    return [lo, hi]
  }
  place(tree.root)
  return { pos, leafX, prodX, stageX, leafY }
}

function treeArea(index: number): { f: Frame; area: Box } {
  const f = frame(index, 0.01)
  const area: Box = { x0: f.panel.x0 + PAD, x1: f.panel.x1 - PAD, y0: f.panel.y0 + PAD + 0.95, y1: f.panel.y1 - TITLE - 0.35 }
  return { f, area }
}

/**
 * The most paths the figure labels one by one. Past it (a 4 × 4 × 4 tree has
 * 64) the rows are too close to read: the figure draws every branch but
 * leaves the last stage's labels and the paths' products to the card, and
 * says so. The arithmetic is always every path.
 */
export const TREE_LABEL_MAX = 27

function treeFigure(p: BoardProb, index: number): StatsFigure {
  const { f, area } = treeArea(index)
  const prims: StatPrim[] = []
  const tree = treeOf(p)
  const geo = treeGeo(tree, area)
  const dense = tree.leaves.length > TREE_LABEL_MAX
  const picked = new Set(p.tree.pick.filter((k) => tree.leaves.some((l) => l.key === k)))
  const onPath = (key: string): boolean => [...picked].some((k) => k === key || k.startsWith(`${key}.`))
  // stage headings
  tree.stageNames.forEach((name, i) => {
    const x0 = geo.stageX[i]
    const x1 = geo.stageX[i + 1]
    prims.push({ k: 'text', at: { x: (x0 + x1) / 2, y: area.y1 + 0.28 }, text: name, ink: 'axis', small: true, rise: 0 })
  })
  prims.push({
    k: 'text',
    at: { x: dense ? geo.leafX : geo.prodX, y: area.y1 + 0.28 },
    text: dense ? `${tree.leaves.length} paths: too many to label here; each is listed on the card` : 'Multiplication Rule',
    ink: 'axis',
    small: true,
    rise: 0,
    align: 'start',
  })
  // branches
  const NODE = 0.26
  const walk = (node: TreeNode): void => {
    const from = geo.pos.get(node.key)
    if (!from) return
    for (const br of node.branches) {
      const to = geo.pos.get(br.child.key)
      if (!to) continue
      const hot = onPath(br.child.key)
      const start = { x: from.x + (node.key === '' ? 0.06 : NODE), y: from.y }
      const end = { x: to.x - NODE, y: to.y }
      prims.push({ k: 'curve', pts: [start, end], ink: hot ? 'hot' : 'main', w: hot ? 2.6 : 1.4 })
      // too dense: the last stage's branches are drawn, not labelled
      if (dense && br.child.depth === tree.stages) {
        walk(br.child)
        continue
      }
      // the outcome at the end of the branch
      const name = shortOf(tree, br.child.depth - 1, br.b.k, br.b.name)
      prims.push({ k: 'text', at: to, text: name, ink: hot ? 'hot' : 'main', small: name.length > 2, rise: 0, bold: true })
      // the probability on the branch (given)
      const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
      const up = end.y >= start.y ? 0.2 : -0.2
      prims.push({ k: 'text', at: { x: mid.x - 0.05, y: mid.y + (Math.abs(end.y - start.y) < 0.05 ? 0.2 : up) }, text: br.b.label, ink: 'axis', small: true, rise: 0, avoid: true })
      walk(br.child)
    }
  }
  prims.push({ k: 'dots', pts: [geo.pos.get('') ?? { x: area.x0, y: (area.y0 + area.y1) / 2 }], r: 0.07, ink: 'main' })
  walk(tree.root)
  // the leaves: the outcome and its product
  for (const l of dense ? [] : tree.leaves) {
    const y = geo.leafY.get(l.key)
    if (y === undefined) continue
    const hot = picked.has(l.key)
    prims.push({ k: 'text', at: { x: geo.leafX, y }, text: l.short, ink: hot ? 'hot' : 'axis', small: true, rise: 0, align: 'start', bold: hot })
    prims.push({ k: 'text', at: { x: geo.prodX, y }, text: l.product, ink: hot ? 'hot' : 'axis', small: true, rise: 0, align: 'start', bold: hot, answer: true })
  }
  // the event, as a sum of paths
  const name = treeEventName(p)
  const ev = treeEvent(tree, [...picked])
  const yEv = f.panel.y0 + PAD + 0.45
  if (tree.problems.length > 0) {
    note(prims, area.x0, yEv, tree.problems[0], false, { ink: 'hot' })
  } else if (picked.size > 0) {
    const q = `P(${name}) =`
    const a = `${ev.terms} = ${ev.numbers}${ev.numbers.includes('=') ? '' : ''}`
    readout(prims, area.x0 + Math.min(3.2, 0.75 + q.length * 0.1), yEv, q, `${a}${isZero(ev.p) ? '' : `  (${decText(ev.p)})`}`, { bold: true, ink: 'hot' })
    if (ev.complement) note(prims, area.x0 + Math.min(3.2, 0.75 + q.length * 0.1) + 0.1, yEv - 0.4, `= ${ev.complement}`, true)
  } else {
    note(prims, area.x0, yEv, 'Pick outcomes on the card (or click a leaf) for an event.', false)
  }
  const title = {
    question: `Tree diagram · ${p.tree.mode === 'bag' ? bagWords(p) : `${tree.stages} stage${tree.stages === 1 ? '' : 's'}`}${picked.size > 0 ? ` · P(${name})` : ''}`,
    answer: picked.size > 0 ? ` = ${fracText(ev.p)}` : '',
  }
  return { ...baseFigure(p, f), prims, title, describe: probDescribe(p) }
}

/** "3 Red, 2 Blue; 2 draws without replacement". */
export function bagWords(p: BoardProb): string {
  const t = p.tree
  return `${t.bag.map((c) => `${c.count} ${c.name}`).join(', ')}; ${t.draws} draw${t.draws === 1 ? '' : 's'} ${t.replace ? 'with' : 'without'} replacement`
}

function shortOf(tree: TreeResult, stage: number, k: number, name: string): string {
  const leaf = tree.leaves.find((l) => l.path[stage]?.k === k)
  if (!leaf) return name
  const sh = leaf.short.includes(', ') ? leaf.short.split(', ') : leaf.short.split('')
  return sh[stage] ?? name
}

// ---------------------------------------------------------------------------
// The figure, and where a click lands
// ---------------------------------------------------------------------------

export function probFigure(p: BoardProb, index: number): StatsFigure {
  if (p.view === 'venn') return vennFigure(p, index)
  if (p.view === 'tree') return treeFigure(p, index)
  return tableFigure(p, index)
}

export type ProbSpot = { kind: 'cell'; row: number; col: number; pos: Vec2 } | { kind: 'leaf'; key: string; pos: Vec2; label: string }

/** Table: every count cell (a click makes its row A and its column B). Tree: every leaf (a click puts it in or out of the event). */
export function probSpots(p: BoardProb, index: number): ProbSpot[] {
  if (p.view === 'table') {
    const g = tableGeo(p, frame(index).pic)
    const out: ProbSpot[] = []
    p.table.rows.forEach((_, i) => p.table.cols.forEach((__, j) => out.push({ kind: 'cell', row: i, col: j, pos: g.at(i, j) })))
    return out
  }
  if (p.view === 'tree') {
    const { area } = treeArea(index)
    const tree = treeOf(p)
    const geo = treeGeo(tree, area)
    return tree.leaves.flatMap((l) => {
      const y = geo.leafY.get(l.key)
      return y === undefined ? [] : [{ kind: 'leaf' as const, key: l.key, pos: { x: geo.leafX + 0.2, y }, label: l.short }]
    })
  }
  return []
}

/** The tree with leaf `key` put in, or taken out of, the event (a hand-picked event is called E). */
export function toggleLeaf(p: BoardProb, key: string): BoardProb {
  const pick = p.tree.pick.includes(key) ? p.tree.pick.filter((k) => k !== key) : [...p.tree.pick, key]
  const tree = { ...p.tree, pick: sortKeys(pick) }
  delete tree.event
  return { ...p, tree }
}

export function sortKeys(keys: readonly string[]): string[] {
  return [...new Set(keys)].sort((a, b) => {
    const x = a.split('.').map(Number)
    const y = b.split('.').map(Number)
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? -1) !== (y[i] ?? -1)) return (x[i] ?? -1) - (y[i] ?? -1)
    return 0
  })
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export interface ReadLine {
  key: string
  label: string
  value: string
  /** Words under it ("30 of B’s 45 are in A"). */
  hint?: string
}

export interface ProbCardData {
  summary: string
  table: {
    /** cells[i][j], with the totals row R and column C, as the view shows them. */
    cells: string[][]
    names: { A: string; B: string }
    lines: ReadLine[]
    conditional: { label: string; words: string; frac: string; dec: string; pct: string } | null
    indep: { independent: boolean; verdict: string; conditional: string; product: string; close: boolean } | null
  }
  venn: {
    regionLabels: { atom: number; name: string; set: string }[]
    total: string
    warn: string
    error: string
    event: string
    words: string
    p: string
    rule: string
    ruleNumbers: string
    regions: string
    basics: ReadLine[]
    indep: string
  }
  tree: {
    leaves: { key: string; short: string; long: string; rule: string; p: string; picked: boolean }[]
    presets: Preset[]
    problems: string[]
    event: { name: string; terms: string; numbers: string; complement: string; all: string } | null
    note: string
    total: string
  }
}

export function probCard(p: BoardProb): ProbCardData {
  // ---- table
  const t = twoWayOf(p)
  const facts = tableFacts(p)
  const R = t.rows.length
  const C = t.cols.length
  const cells: string[][] = []
  for (let i = 0; i <= R; i++) {
    const row: string[] = []
    for (let j = 0; j <= C; j++) row.push(cellText(t, p.table.rel, i, j))
    cells.push(row)
  }
  const names = tableNames(p)
  const given = p.table.given
  const cond = given === 'B' ? facts.aGivenB : facts.bGivenA
  const tableLines: ReadLine[] = [
    { key: 'joint', label: 'P(A and B)', value: rText(facts.joint), hint: `${facts.joint.num} of all ${facts.joint.den} are in both` },
    { key: 'pA', label: 'P(A)', value: rText(facts.pA), hint: `${facts.pA.num} of ${facts.pA.den} are in ${names.A}` },
    { key: 'pB', label: 'P(B)', value: rText(facts.pB), hint: `${facts.pB.num} of ${facts.pB.den} are in ${names.B}` },
    { key: 'union', label: 'P(A or B)', value: unionLine(facts) },
  ]
  const conditional = cond.p
    ? {
        label: given === 'B' ? 'P(A | B)' : 'P(B | A)',
        words:
          given === 'B'
            ? `Of the ${cond.den} outcomes in B (${names.B}), ${cond.num} are also in A (${names.A}): the fraction of B’s outcomes that belong to A.`
            : `Of the ${cond.den} outcomes in A (${names.A}), ${cond.num} are also in B (${names.B}): the fraction of A’s outcomes that belong to B.`,
        frac: ratioText(cond.num, cond.den),
        dec: decText(cond.p),
        pct: pctText(cond.p),
      }
    : null
  const iv = facts.indep ? indepOf(p, facts) : null

  // ---- venn
  const m = vennModel(p)
  const tot = vennTotals({ sets: m.sets, values: m.values })
  const ev = vennEvent(p)
  const w = ev.working
  const pm = (mask: number): Frac | null => probOfAtoms(mask, { sets: m.sets, values: m.values })
  const setMask = (i: number): number => {
    let mm = 0
    for (let a = 0; a < atomCount(m.sets); a++) if (a & (1 << i)) mm |= 1 << a
    return mm
  }
  const basics: ReadLine[] = []
  const pA = pm(setMask(0))
  const pB = pm(setMask(1))
  const pAB = pm(setMask(0) & setMask(1))
  const pAuB = pm(setMask(0) | setMask(1))
  if (pA && pB && pAB && pAuB) {
    basics.push({ key: 'pA', label: 'P(A)', value: fd(pA) })
    basics.push({ key: 'pB', label: 'P(B)', value: fd(pB) })
    if (m.sets === 3) {
      const pC = pm(setMask(2))
      if (pC) basics.push({ key: 'pC', label: 'P(C)', value: fd(pC) })
    }
    basics.push({ key: 'pAB', label: 'P(A ∩ B)', value: fd(pAB) })
    basics.push({ key: 'pAuB', label: 'P(A ∪ B)', value: `${fracText(pA)} + ${fracText(pB)} − ${fracText(pAB)} = ${fd(pAuB)}`, hint: 'Addition Rule' })
  }
  let vennIndep = ''
  if (pA && pB && pAB && !isZero(pB)) {
    vennIndep = independence(pA, pB, pAB, frac(pAB.n * pB.d, pAB.d * pB.n), null, { sample: tot.counts }).verdict
  }
  const total = isZero(tot.total) ? 'The regions add to 0.' : tot.counts ? `The regions add to ${fracText(tot.total)} outcomes; each probability is a region count over ${fracText(tot.total)}.` : `The regions are probabilities adding to ${fracText(tot.total)}.`
  const warn = m.bad.length > 0 ? `Not a number (read as 0): ${m.bad.map((a) => atomName(a, m.sets)).join(', ')}.` : tot.offBy ? `The probabilities add to ${fracText(tot.offBy)}, not 1 — each is divided by ${fracText(tot.offBy)}.` : ''

  // ---- tree
  const tree = treeOf(p)
  const picked = new Set(p.tree.pick)
  const tev = p.tree.pick.length > 0 ? treeEvent(tree, p.tree.pick) : null
  const tname = treeEventName(p)
  const treeTotal = tree.leaves.reduce((acc, l) => acc + toNum(l.p), 0)
  const treeNote =
    p.tree.mode === 'bag'
      ? p.tree.replace
        ? 'With replacement the draws are independent: each draw’s probabilities are the same whatever came before, so P(B | R) = P(B).'
        : 'Without replacement the draws are dependent: after each draw one fewer is left, so P(second | first) changes with the first.'
      : tree.independent
        ? 'Each stage has the same probabilities whatever came before: the stages are independent.'
        : 'Some stage’s probabilities depend on what came before: the stages are dependent.'

  // ---- summary
  let summary: string
  if (p.view === 'table') summary = cond.p ? `Two-way table · ${given === 'B' ? 'P(A | B)' : 'P(B | A)'} = ${fracText(cond.p)}` : 'Two-way table · enter counts'
  else if (p.view === 'venn') summary = w && w.p ? `Venn diagram · P(${w.text}) = ${fracText(w.p)}` : 'Venn diagram'
  else summary = tev ? `Tree diagram · P(${tname}) = ${fracText(tev.p)}` : `Tree diagram · ${tree.leaves.length} outcomes`

  return {
    summary,
    table: {
      cells,
      names,
      lines: tableLines,
      conditional,
      indep: iv && facts.indep ? { independent: iv.independent, verdict: iv.verdict, conditional: iv.conditional, product: iv.product, close: iv.close } : null,
    },
    venn: {
      regionLabels: Array.from({ length: atomCount(m.sets) }, (_, a) => ({ atom: a, name: atomName(a, m.sets), set: atomText(a, m.sets) })),
      total,
      warn,
      error: ev.parse.ok ? '' : ev.parse.error,
      event: w ? w.text : '',
      words: ev.parse.ok ? eventWords(ev.parse.node, letterNames(m)) : '',
      p: w && w.p ? fracAll(w.p) : '',
      rule: w ? w.rule : '',
      ruleNumbers: w ? w.ruleNumbers : '',
      regions: w ? w.regions : '',
      basics,
      indep: vennIndep,
    },
    tree: {
      leaves: tree.leaves.map((l: Leaf) => ({ key: l.key, short: l.short, long: l.long, rule: l.rule, p: fracText(l.p), picked: picked.has(l.key) })),
      presets: treePresetsOf(p),
      problems: tree.problems,
      event: tev ? { name: tname, terms: tev.terms, numbers: tev.numbers, complement: tev.complement, all: fracAll(tev.p) } : null,
      note: treeNote,
      total: tree.leaves.length > 0 ? `The ${tree.leaves.length} path products add to ${Math.abs(treeTotal - 1) < 1e-9 ? '1' : String(Number(treeTotal.toFixed(6)))}.` : '',
    },
  }
}

function unionLine(f: TwoWayFacts): string {
  if (!f.pA.p || !f.pB.p || !f.joint.p || !f.union.p) return '—'
  return `${f.pA.num}/${f.pA.den} + ${f.pB.num}/${f.pB.den} − ${f.joint.num}/${f.joint.den} = ${ratioText(f.union.num, f.union.den)}`
}

/** Letters with what they stand for: "A (Plays sport)". */
function letterNames(m: VennModel): string[] {
  return SET_LETTERS.map((l, i) => (m.names[i] ? `${l} (${m.names[i]})` : l))
}

// ---------------------------------------------------------------------------
// In words (describeGraph)
// ---------------------------------------------------------------------------

export function probDescribe(p: BoardProb): DescribeStat {
  const lines: { text: string; answer?: boolean }[] = []
  if (p.view === 'table') {
    const t = twoWayOf(p)
    const facts = tableFacts(p)
    const n = tableNames(p)
    const rowsText = t.rows.map((r, i) => `${r}: ${t.cols.map((c, j) => `${t.counts[i]?.[j] ?? 0} ${c}`).join(', ')} (total ${facts.totals.rowTotals[i]})`).join('; ')
    lines.push({ text: `A two-way table of counts with rows ${listText(t.rows)} and columns ${listText(t.cols)}, ${facts.totals.grand} in all. ${rowsText}.` })
    const cond = p.table.given === 'B' ? facts.aGivenB : facts.bGivenA
    lines.push({
      text: `Event A is ${n.A} and event B is ${n.B}; the ${p.table.given === 'B' ? `${n.B} column` : `${n.A} row`} and the cell where they meet are highlighted, for ${p.table.given === 'B' ? 'P(A | B)' : 'P(B | A)'}.`,
    })
    if (p.table.rel !== 'count') lines.push({ text: `The cells show ${p.table.rel === 'joint' ? 'joint relative frequencies' : p.table.rel === 'row' ? 'row percentages' : 'column percentages'}.` })
    if (cond.p) {
      lines.push({ text: `P(A and B) = ${rText(facts.joint)}; P(A) = ${rText(facts.pA)}; P(B) = ${rText(facts.pB)}.`, answer: true })
      lines.push({ text: `${p.table.given === 'B' ? 'P(A | B)' : 'P(B | A)'} = ${ratioText(cond.num, cond.den)} ${decText(cond.p).startsWith('≈') ? decText(cond.p) : `= ${decText(cond.p)}`}.`, answer: true })
      lines.push({ text: indepOf(p, facts).verdict, answer: true })
    }
  } else if (p.view === 'venn') {
    const m = vennModel(p)
    const ev = vennEvent(p)
    const regs = Array.from({ length: atomCount(m.sets) }, (_, a) => `${atomName(a, m.sets)} ${fracText(m.values[a])}`).join(', ')
    const named = m.names.slice(0, m.sets).some((x) => x) ? ` (${SET_LETTERS.slice(0, m.sets).map((l, i) => (m.names[i] ? `${l} is ${m.names[i]}` : l)).join(', ')})` : ''
    lines.push({ text: `A Venn diagram of ${m.sets === 2 ? 'two' : 'three'} events${named} in a sample space; the regions hold ${regs}.` })
    const w = ev.working
    if (w && ev.parse.ok) {
      lines.push({ text: `The event ${w.text} — ${eventWords(ev.parse.node)} — is shaded.` })
      if (w.p) lines.push({ text: `P(${w.text}) = ${fracText(w.p)}${w.rule ? `; by ${w.rule.includes(' = 1 − ') ? 'the complement rule' : 'the Addition Rule'}, ${w.rule} ${w.ruleNumbers}` : ''}.`, answer: true })
    }
  } else {
    const tree = treeOf(p)
    const head = p.tree.mode === 'bag' ? `A tree diagram for drawing from a bag of ${bagWords(p)}` : `A tree diagram with ${tree.stages} stage${tree.stages === 1 ? '' : 's'} (${tree.stageNames.join(', ')})`
    lines.push({ text: `${head}: ${tree.leaves.length} outcomes, ${tree.leaves.map((l) => l.long).join('; ')}.` })
    const picked = p.tree.pick.filter((k) => tree.leaves.some((l) => l.key === k))
    if (picked.length > 0) {
      const name = treeEventName(p)
      const set = new Set(picked)
      lines.push({ text: `The paths for ${name} are highlighted: ${tree.leaves.filter((l) => set.has(l.key)).map((l) => l.long).join('; ')}.` })
      const ev = treeEvent(tree, picked)
      lines.push({ text: `By the Multiplication Rule, ${tree.leaves.filter((l) => set.has(l.key)).map((l) => `P(${l.short}) = ${l.product}`).join('; ')}.`, answer: true })
      lines.push({ text: `P(${name}) = ${ev.terms} = ${ev.numbers}.`, answer: true })
    }
  }
  return { kind: 'prob', lines }
}

function listText(xs: readonly string[]): string {
  return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}

/** Re-exported for the card: what an event's mask contains. */
export { eventAtoms }

/**
 * After any change: a named event ("both Red") follows its definition onto the
 * new tree (more red, a third draw); a picked leaf the tree no longer has is
 * dropped, and a name the new tree has no event for goes with it.
 */
export function settleProb(p: BoardProb): BoardProb {
  const tree = treeOf(p)
  const leaves = new Set(tree.leaves.map((l) => l.key))
  const t = { ...p.tree }
  if (t.event) {
    // "both Red" on two draws is "all Red" on three
    const norm = (s: string): string => s.replace(/^(both|all) /, 'every ')
    const want = norm(t.event)
    const pr = treePresetsOf(p).find((x) => norm(x.name) === want)
    if (pr) {
      t.pick = sortKeys(pr.keys)
      t.event = pr.name
    } else {
      delete t.event
      t.pick = t.pick.filter((k) => leaves.has(k))
    }
  } else t.pick = t.pick.filter((k) => leaves.has(k))
  if (t.pick.length === 0) delete t.event
  const same = t.pick.join('|') === p.tree.pick.join('|') && t.event === p.tree.event
  return same ? p : { ...p, tree: t }
}

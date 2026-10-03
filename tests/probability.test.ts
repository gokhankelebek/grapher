// ============================================================================
// tests/probability.test.ts — Build ▾ → Probability (NC Math 2 S-CP.1, 3–8),
// end to end without React.
//
//   exact       fractions parsed, reduced and written (6/20 = 3/10)
//   table       marginal totals, joint / marginal / conditional probabilities,
//               relative frequencies, the independence verdicts
//   venn        the event parser, region sums for two and three sets, the
//               Addition Rule and the complement rule written out
//   tree        with and without replacement (3 red, 2 blue: P(both red) =
//               3/10), typed stages, path products, events as sums of paths
//   figure      what the panel draws in each view; where a click lands
//   persistence settings only; round trip byte for byte; old documents
//               byte-identical; repairs
//   reveal      the stat:<id>:value key; answers masked
//   words       describeGraph (a student copy without answers)
//   exports     docScene draws it; the student copy says "?"
// ============================================================================

import { describe, expect, it } from 'vitest'
import {
  atomCount,
  bagTree,
  decText,
  eventAtoms,
  eventText,
  frac,
  fracText,
  independence,
  manualTree,
  parseEvent,
  parseFrac,
  pctText,
  ratioText,
  regionsFromTable,
  relCell,
  treeEvent,
  treePresets,
  twoWayFacts,
  twoWayTotals,
  vennWorking,
} from '../src/core/probability'
import type { Frac, TwoWay } from '../src/core/probability'
import type { BoardInput, DocMeta } from '../src/core/persist'
import { deserializeDoc, docFromBoard, serializeDoc } from '../src/core/persist'
import { statToStored, storedToStat } from '../src/core/statsPersist'
import type { BoardProb } from '../src/core/probPersist'
import { EXAMPLE_TABLE, EXAMPLE_TABLE_INDEPENDENT, newProb } from '../src/core/probPersist'
import { probCard, probFigure, probSpots, settleProb, toggleLeaf, vennGeo } from '../src/ui/probLinks'
import { statsFigures } from '../src/ui/statsLinks'
import { REVEAL_OFF, applyReveal, buildInventory, isHidden, maskStats, statKey } from '../src/ui/reveal'
import type { RevealState, SceneReveal } from '../src/ui/reveal'
import type { BoardScene } from '../src/ui/renderBoard'
import { DARK_THEME } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { docFigure, docModelFromJSON, recordFigure } from '../src/ui/docScene'
import { describeBoard } from '../src/ui/boardDescription'
import type { TextItem } from '../src/render/vectorCtx'
import { COMMANDS, HELP_SECTIONS } from '../src/ui/commands'

const META: DocMeta = { id: 'd1', name: 'Probability', createdAt: 1, modifiedAt: 2 }

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

const f = (n: number, d = 1): Frac => frac(n, d)
const ft = (x: Frac | null): string => (x ? fracText(x) : 'null')

// ---------------------------------------------------------------------------

describe('exact fractions', () => {
  it('parse counts, decimals, fractions, mixed numbers and percents exactly', () => {
    expect(ft(parseFrac('12'))).toBe('12')
    expect(ft(parseFrac('0.35'))).toBe('7/20')
    expect(ft(parseFrac('.5'))).toBe('1/2')
    expect(ft(parseFrac('6/20'))).toBe('3/10')
    expect(ft(parseFrac('1 1/2'))).toBe('3/2')
    expect(ft(parseFrac('35%'))).toBe('7/20')
    expect(parseFrac('abc')).toBeNull()
    expect(parseFrac('3/0')).toBeNull()
    expect(parseFrac('')).toBeNull()
  })
  it('write the reduction, the decimal and the percent', () => {
    expect(ratioText(6, 20)).toBe('6/20 = 3/10')
    expect(ratioText(3, 10)).toBe('3/10')
    expect(decText(f(3, 10))).toBe('0.30')
    expect(decText(f(9, 20))).toBe('0.45')
    expect(decText(f(2, 3))).toBe('≈ 0.6667')
    expect(pctText(f(9, 20))).toBe('45%')
    expect(pctText(f(2, 3))).toBe('≈ 66.7%')
  })
})

// ---------------------------------------------------------------------------

describe('two-way tables', () => {
  const T: TwoWay = EXAMPLE_TABLE
  it('marginal totals and the grand total', () => {
    const t = twoWayTotals(T)
    expect(t.rowTotals).toEqual([50, 50])
    expect(t.colTotals).toEqual([45, 55])
    expect(t.grand).toBe(100)
    const t3 = twoWayTotals({ rows: ['a', 'b', 'c'], cols: ['x', 'y', 'z'], counts: [[1, 2, 3], [4, 5, 6], [7, 8, 9]] })
    expect(t3.rowTotals).toEqual([6, 15, 24])
    expect(t3.colTotals).toEqual([12, 15, 18])
    expect(t3.grand).toBe(45)
  })
  it('joint, marginal and conditional probabilities as fractions of the right outcomes', () => {
    const k = twoWayFacts(T, 0, 0)
    expect(ft(k.joint.p)).toBe('3/10')
    expect([k.joint.num, k.joint.den]).toEqual([30, 100])
    expect(ft(k.pA.p)).toBe('1/2')
    expect(ft(k.pB.p)).toBe('9/20')
    // P(A|B): of B's 45 outcomes, 30 are in A
    expect([k.aGivenB.num, k.aGivenB.den]).toEqual([30, 45])
    expect(ft(k.aGivenB.p)).toBe('2/3')
    // P(B|A): of A's 50 outcomes, 30 are in B
    expect([k.bGivenA.num, k.bGivenA.den]).toEqual([30, 50])
    expect(ft(k.bGivenA.p)).toBe('3/5')
    // the Addition Rule: 50 + 45 − 30 = 65 of 100
    expect(ft(k.union.p)).toBe('13/20')
    // another cell: Grade 10 and doesn't play
    const k2 = twoWayFacts(T, 1, 1)
    expect(ft(k2.aGivenB.p)).toBe('7/11')
  })
  it('relative frequencies: joint, row and column', () => {
    const tot = twoWayTotals(T)
    expect(ft(relCell(T, tot, 'joint', 0, 0))).toBe('3/10')
    expect(ft(relCell(T, tot, 'row', 0, 0))).toBe('3/5')
    expect(ft(relCell(T, tot, 'row', 0, 2))).toBe('1')
    expect(ft(relCell(T, tot, 'col', 0, 0))).toBe('2/3')
    expect(ft(relCell(T, tot, 'col', 2, 1))).toBe('1')
    expect(ft(relCell(T, tot, 'row', 2, 0))).toBe('9/20')
  })
  it('the independence verdict: not independent, worded for the sample', () => {
    const k = twoWayFacts(T, 0, 0)
    expect(k.indep!.independent).toBe(false)
    expect(k.indep!.verdict).toBe('In this sample, A and B are not independent: P(A|B) = 2/3 ≈ 0.6667 ≠ P(A) = 1/2 = 0.50.')
    expect(k.indep!.product).toBe('P(A and B) = 3/10 = 0.30 ≠ P(A)·P(B) = 1/2 = 0.50 · 9/20 = 0.45 = 9/40 = 0.225')
  })
  it('the independence verdict: independent', () => {
    const k = twoWayFacts(EXAMPLE_TABLE_INDEPENDENT, 0, 0)
    expect(k.indep!.independent).toBe(true)
    expect(k.indep!.verdict).toBe('In this sample, A and B are independent: P(A|B) = 2/5 = 0.40 = P(A) = 2/5 = 0.40.')
    expect(ft(k.joint.p)).toBe('9/50')
  })
  it('the spec’s own example reads as it should', () => {
    const v = independence(f(3, 10), f(1, 2), f(9, 40), f(9, 20), null)
    expect(v.verdict).toBe('In this sample, A and B are not independent: P(A|B) = 9/20 = 0.45 ≠ P(A) = 3/10 = 0.30.')
  })
  it('close but not equal says so; an empty table has no verdict', () => {
    const near: TwoWay = { rows: ['a', 'b'], cols: ['x', 'y'], counts: [[45, 55], [46, 54]] }
    expect(twoWayFacts(near, 0, 0).indep!.close).toBe(true)
    expect(twoWayFacts({ rows: ['a', 'b'], cols: ['x', 'y'], counts: [[0, 0], [0, 0]] }, 0, 0).indep).toBeNull()
  })
})

// ---------------------------------------------------------------------------

describe('Venn diagrams', () => {
  const parse2 = (s: string) => {
    const r = parseEvent(s, 2)
    if (!r.ok) throw new Error(r.error)
    return r.node
  }
  const atoms = (s: string, sets: 2 | 3 = 2): number[] => {
    const r = parseEvent(s, sets)
    if (!r.ok) throw new Error(r.error)
    const m = eventAtoms(r.node, sets)
    return Array.from({ length: atomCount(sets) }, (_, a) => a).filter((a) => m & (1 << a))
  }
  it('parses ∪ ∩ ᶜ, primes, words, typed shortcuts and parentheses', () => {
    // atoms: 0 neither, 1 A only, 2 B only, 3 both
    expect(atoms('A ∪ B')).toEqual([1, 2, 3])
    expect(atoms('A ∩ B')).toEqual([3])
    expect(atoms('Aᶜ')).toEqual([0, 2])
    expect(atoms('A ∩ Bᶜ')).toEqual([1])
    expect(atoms("A ∩ B'")).toEqual([1])
    expect(atoms('A n Bc')).toEqual([1])
    expect(atoms('A and not B')).toEqual([1])
    expect(atoms('A^c U B')).toEqual([0, 2, 3])
    expect(atoms('(A ∪ B)ᶜ')).toEqual([0])
    expect(atoms('not (A or B)')).toEqual([0])
    expect(atoms('(A ∩ B)′')).toEqual([0, 1, 2])
    expect(atoms('A − B')).toEqual([1])
    expect(atoms('S')).toEqual([0, 1, 2, 3])
    // ∩ binds tighter than ∪
    expect(atoms('A ∪ B ∩ Bᶜ')).toEqual([1, 3])
  })
  it('writes the event properly', () => {
    expect(eventText(parse2("a n b'"))).toBe('A ∩ Bᶜ')
    expect(eventText(parse2('not (A or B)'))).toBe('(A ∪ B)ᶜ')
    expect(eventText(parse2('(A ∪ B) ∩ A'))).toBe('(A ∪ B) ∩ A')
  })
  it('says what is wrong', () => {
    const bad = (s: string, sets: 2 | 3 = 2): string => {
      const r = parseEvent(s, sets)
      return r.ok ? 'ok' : r.error
    }
    expect(bad('A ∩ C')).toBe('There is no C in a two-set diagram.')
    expect(bad('A ∩')).toBe('The event ends too soon.')
    expect(bad('(A ∪ B')).toBe('A “(” is not closed.')
    expect(bad('A B')).toBe('Put ∪ or ∩ between the events (before B).')
    expect(bad('A ∩ D')).toMatch(/is not an event here/)
    expect(bad('')).toBe('Type an event, such as A ∩ Bᶜ.')
  })
  it('three sets: the eight regions', () => {
    expect(atoms('A ∩ B ∩ C', 3)).toEqual([7])
    expect(atoms('A ∩ Bᶜ ∩ Cᶜ', 3)).toEqual([1])
    expect(atoms('(A ∪ B ∪ C)ᶜ', 3)).toEqual([0])
    expect(atoms('A ∩ (B ∪ C)', 3)).toEqual([3, 5, 7])
    expect(atoms('C', 3)).toEqual([4, 5, 6, 7])
  })
  it('region sums and the Addition Rule, two sets of counts', () => {
    // neither 7, A only 8, B only 10, both 5 — 30 in all
    const r = { sets: 2 as const, values: [7, 8, 10, 5].map((v) => f(v)) }
    const w = vennWorking(parse2('A ∪ B'), r)
    expect(ft(w.p)).toBe('23/30')
    expect(w.rule).toBe('P(A ∪ B) = P(A) + P(B) − P(A ∩ B)')
    expect(w.ruleNumbers).toBe('= 13/30 + 1/2 − 1/6 = 23/30')
    expect(w.regions).toBe('(8 + 10 + 5)/30 = 23/30')
    const w2 = vennWorking(parse2('A ∩ Bᶜ'), r)
    expect(ft(w2.p)).toBe('4/15')
    expect(w2.regions).toBe('8/30 = 4/15')
    expect(w2.rule).toBe('')
    const w3 = vennWorking(parse2('Aᶜ'), r)
    expect(w3.rule).toBe('P(Aᶜ) = 1 − P(A)')
    expect(w3.ruleNumbers).toBe('= 1 − 13/30 = 17/30')
  })
  it('probabilities as regions, and three sets by inclusion–exclusion', () => {
    const r = { sets: 2 as const, values: ['0.2', '0.3', '0.4', '0.1'].map((v) => parseFrac(v)!) }
    expect(ft(vennWorking(parse2('A ∪ B'), r).p)).toBe('4/5')
    expect(vennWorking(parse2('A ∪ B'), r).regions).toBe('3/10 + 2/5 + 1/10 = 4/5')
    const r3 = { sets: 3 as const, values: [4, 6, 5, 3, 7, 2, 1, 2].map((v) => f(v)) } // 30
    const e = parseEvent('A ∪ B ∪ C', 3)
    if (!e.ok) throw new Error(e.error)
    const w = vennWorking(e.node, r3)
    expect(ft(w.p)).toBe('13/15') // 26/30
    expect(w.rule).toBe('P(A ∪ B ∪ C) = P(A) + P(B) + P(C) − P(A ∩ B) − P(A ∩ C) − P(B ∩ C) + P(A ∩ B ∩ C)')
    // A = 6+3+2+2 = 13, B = 5+3+1+2 = 11, C = 7+2+1+2 = 12, AB = 5, AC = 4, BC = 3, ABC = 2 → 26
    expect(w.ruleNumbers).toBe('= 13/30 + 11/30 + 2/5 − 1/6 − 2/15 − 1/10 + 1/15 = 13/15')
  })
  it('regions from a two-way table', () => {
    expect(regionsFromTable(EXAMPLE_TABLE, 0, 0).map(ft)).toEqual(['35', '20', '15', '30'])
  })
  it('the diagram places every region’s value inside its region', () => {
    for (const sets of [2, 3] as const) {
      const g = vennGeo({ x0: -6, x1: 1, y0: -3, y1: 2.5 }, sets)
      g.labels.forEach((at, atom) => {
        if (atom === 0) return
        const inside = g.circles.reduce((m, c, i) => (Math.hypot(at.x - c.x, at.y - c.y) < c.r ? m | (1 << i) : m), 0)
        expect(inside).toBe(atom)
      })
    }
  })
})

// ---------------------------------------------------------------------------

describe('tree diagrams', () => {
  const bag = [
    { name: 'Red', count: 3 },
    { name: 'Blue', count: 2 },
  ]
  it('without replacement: 3 red, 2 blue, two draws — P(both red) = 3/10', () => {
    const t = bagTree(bag, 2, false)
    expect(t.leaves.map((l) => l.short)).toEqual(['RR', 'RB', 'BR', 'BB'])
    expect(t.leaves.map((l) => l.product)).toEqual(['3/5 · 2/4 = 6/20 = 3/10', '3/5 · 2/4 = 6/20 = 3/10', '2/5 · 3/4 = 6/20 = 3/10', '2/5 · 1/4 = 2/20 = 1/10'])
    expect(t.leaves[0].rule).toBe('P(RR) = P(R)·P(R | R) = 3/5 · 2/4 = 6/20 = 3/10')
    expect(t.independent).toBe(false)
    const both = treePresets(t, 'colour').find((p) => p.name === 'both Red')!
    expect(both.keys).toEqual(['0.0'])
    expect(ft(treeEvent(t, both.keys).p)).toBe('3/10')
  })
  it('with replacement: independent draws', () => {
    const t = bagTree(bag, 2, true)
    expect(t.leaves.map((l) => fracText(l.p))).toEqual(['9/25', '6/25', '6/25', '4/25'])
    expect(t.leaves[0].product).toBe('3/5 · 3/5 = 9/25')
    expect(t.independent).toBe(true)
  })
  it('an event as a sum of paths, with the complement when shorter', () => {
    const t = bagTree(bag, 2, false)
    const atLeast = treePresets(t).find((p) => p.name === 'at least one Red')!
    const e = treeEvent(t, atLeast.keys)
    expect(e.terms).toBe('P(RR) + P(RB) + P(BR)')
    expect(e.numbers).toBe('3/10 + 3/10 + 3/10 = 9/10')
    expect(e.complement).toBe('1 − P(BB) = 1 − 1/10 = 9/10')
    const same = treePresets(t, 'colour').find((p) => p.id === 'same')!
    expect(same.name).toBe('same colour')
    expect(ft(treeEvent(t, same.keys).p)).toBe('2/5')
  })
  it('branches with nothing left are left off', () => {
    const t = bagTree([{ name: 'Red', count: 1 }, { name: 'Blue', count: 2 }], 2, false)
    expect(t.leaves.map((l) => l.short)).toEqual(['RB', 'BR', 'BB'])
    expect(t.leaves.reduce((s, l) => s + Number(l.p.n) / Number(l.p.d), 0)).toBeCloseTo(1, 12)
    expect(bagTree([{ name: 'Red', count: 1 }], 2, false).problems[0]).toBe('Only 1 in the bag, so 2 draws without replacement are impossible.')
  })
  it('three draws', () => {
    const t = bagTree(bag, 3, false)
    const all = treePresets(t).find((p) => p.name === 'all Red')!
    expect(ft(treeEvent(t, all.keys).p)).toBe('1/10')
    expect(t.leaves.find((l) => l.key === '0.0.0')!.product).toBe('3/5 · 2/4 · 1/3 = 6/60 = 1/10')
  })
  it('typed stages: independent and dependent, with checks', () => {
    const indep = manualTree([
      { name: 'Coin', outcomes: ['Heads', 'Tails'], probs: [['1/2', '1/2']], same: true },
      { name: 'Spinner', outcomes: ['Win', 'Lose'], probs: [['1/4', '3/4']], same: true },
    ])
    expect(indep.leaves.map((l) => l.product)).toEqual(['1/2 · 1/4 = 1/8', '1/2 · 3/4 = 3/8', '1/2 · 1/4 = 1/8', '1/2 · 3/4 = 3/8'])
    expect(indep.independent).toBe(true)
    expect(indep.problems).toEqual([])
    const dep = manualTree([
      { name: 'Weather', outcomes: ['Rain', 'Dry'], probs: [['0.3', '0.7']], same: true },
      { name: 'Bus', outcomes: ['Late', 'On time'], probs: [['0.4', '0.6'], ['0.1', '0.9']], same: false },
    ])
    expect(dep.leaves.map((l) => fracText(l.p))).toEqual(['3/25', '9/50', '7/100', '63/100'])
    expect(dep.leaves[0].rule).toBe('P(RL) = P(R)·P(L | R) = 0.3 · 0.4 = 3/25')
    expect(dep.independent).toBe(false)
    const late = treePresets(dep).find((p) => p.name === 'at least one Late')!
    expect(ft(treeEvent(dep, late.keys).p)).toBe('19/100')
    const broken = manualTree([{ name: 'Coin', outcomes: ['H', 'T'], probs: [['1/2', '1/3']], same: true }])
    expect(broken.problems).toEqual(['Coin: the branches add to 5/6, not 1.'])
  })
})

// ---------------------------------------------------------------------------

const prob = (over: Partial<BoardProb> = {}): BoardProb => ({ ...newProb('P1'), ...over })

describe('the figure and the card', () => {
  const texts = (p: BoardProb): string[] => probFigure(p, 0).prims.flatMap((x) => (x.k === 'text' ? [x.text] : []))
  it('the table: counts, totals, the given column and the cell washed, readouts and the verdict', () => {
    const fig = probFigure(prob(), 0)
    expect(fig.kind).toBe('prob')
    expect(fig.noAxis).toBe(true)
    expect(fig.title).toEqual({ question: 'Two-way table · P(A | B)', answer: ' = 2/3' })
    const t = texts(prob())
    for (const s of ['Grade 9', 'Plays sport', 'Total', '30', '45', '100', '30/45 = 2/3', '30/100 = 3/10', 'In this sample, A and B are not independent:']) expect(t).toContain(s)
    expect(fig.prims.filter((x) => x.k === 'rect' && x.ink === 'hot').length).toBe(1)
    expect(fig.prims.filter((x) => x.k === 'rect' && x.ink === 'main').length).toBe(3) // B's column: 2 cells and its total
    const card = probCard(prob())
    expect(card.table.conditional!.frac).toBe('30/45 = 2/3')
    expect(card.table.conditional!.words).toContain('Of the 45 outcomes in B (Plays sport), 30 are also in A (Grade 9)')
    expect(card.table.cells[2][2]).toBe('100')
  })
  it('the relative-frequency views', () => {
    const p = prob({ table: { ...newProb('x').table, rel: 'row' } })
    expect(probCard(p).table.cells.map((r) => r.join(' '))).toEqual(['60% 40% 100%', '30% 70% 100%', '45% 55% 100%'])
    const c = prob({ table: { ...newProb('x').table, rel: 'col' } })
    expect(probCard(c).table.cells[0]).toEqual(['66.7%', '36.4%', '50%'])
  })
  it('the Venn view shades the event and writes the rule', () => {
    const p = prob({ view: 'venn', venn: { ...newProb('x').venn, expr: 'A ∪ B' } })
    const fig = probFigure(p, 0)
    const v = fig.prims.find((x) => x.k === 'venn')
    expect(v && v.k === 'venn' && v.atoms).toBe(0b1110)
    expect(fig.title.answer).toBe(' = 23/30')
    expect(texts(p)).toContain('P(A ∪ B) = P(A) + P(B) − P(A ∩ B)')
    const q = prob({ view: 'venn' }) // A ∩ Bᶜ
    const vq = probFigure(q, 0).prims.find((x) => x.k === 'venn')
    expect(vq && vq.k === 'venn' && vq.atoms).toBe(0b0010)
    expect(probCard(q).venn.p).toBe('4/15 ≈ 0.2667 (≈ 26.7%)')
  })
  it('the tree view: heavy paths for the event, products as answers', () => {
    const p = prob({ view: 'tree' })
    const fig = probFigure(p, 0)
    expect(fig.title).toEqual({ question: 'Tree diagram · 3 Red, 2 Blue; 2 draws without replacement · P(both Red)', answer: ' = 3/10' })
    expect(texts(p)).toContain('3/5 · 2/4 = 6/20 = 3/10')
    expect(fig.prims.filter((x) => x.k === 'curve' && x.ink === 'hot').length).toBe(2)
    expect(probCard(p).tree.event!.all).toBe('3/10 = 0.30 = 30%')
  })
  it('a click on a cell picks A and B; a click on a leaf toggles it', () => {
    const cells = probSpots(prob(), 0)
    expect(cells.length).toBe(4)
    const p = prob({ view: 'tree' })
    const leaves = probSpots(p, 0)
    expect(leaves.map((s) => (s.kind === 'leaf' ? s.label : ''))).toEqual(['RR', 'RB', 'BR', 'BB'])
    const q = toggleLeaf(p, '1.1')
    expect(q.tree.pick).toEqual(['0.0', '1.1'])
    expect(q.tree.event).toBeUndefined()
    expect(probCard(q).tree.event!.name).toBe('E')
    expect(probCard(q).tree.event!.all).toBe('2/5 = 0.40 = 40%')
  })
  it('a named event follows the bag; a hand-picked one keeps its leaves', () => {
    const p = prob({ view: 'tree' })
    const more = settleProb({ ...p, tree: { ...p.tree, bag: [{ name: 'Red', count: 4 }, { name: 'Blue', count: 2 }], draws: 3 } })
    expect(more.tree.pick).toEqual(['0.0.0'])
    expect(probCard(more).tree.event!.all).toBe('1/5 = 0.20 = 20%')
  })
})

// ---------------------------------------------------------------------------

describe('persistence', () => {
  it('stores the counts and settings — never a result', () => {
    const stored = statToStored(prob())
    expect(stored).toEqual({
      id: 'P1',
      type: 'prob',
      view: 'table',
      table: { rows: ['Grade 9', 'Grade 10'], cols: ['Plays sport', 'Doesn’t'], counts: [[30, 20], [15, 35]] },
      venn: { sets: 2, names: ['Plays sport', 'In a club', ''], regions: ['7', '8', '10', '5'], expr: 'A ∩ Bᶜ' },
      tree: {
        mode: 'bag',
        bag: [{ name: 'Red', count: 3 }, { name: 'Blue', count: 2 }],
        draws: 2,
        stages: [
          { name: 'Coin', outcomes: ['Heads', 'Tails'], probs: [['1/2', '1/2']], same: true },
          { name: 'Spinner', outcomes: ['Win', 'Lose'], probs: [['1/4', '3/4']], same: true },
        ],
        pick: ['0.0'],
        event: 'both Red',
      },
    })
    expect(JSON.stringify(stored)).not.toMatch(/total|2\/3|3\/10|independent/)
  })
  it('round-trips through a document byte for byte', () => {
    const p = prob({
      view: 'venn',
      table: { ...newProb('x').table, a: 1, b: 1, given: 'A', rel: 'col' },
      venn: { sets: 3, names: ['', '', ''], regions: ['1', '2', '3', '4', '5', '6', '7', '8'], fromTable: false, expr: 'A ∩ B ∩ C' },
      tree: { ...newProb('x').tree, replace: true, pick: ['1.1'], event: undefined },
      color: '#22c55e',
    })
    delete p.tree.event
    const json = serializeDoc(docFromBoard(META, input({ stats: [p], selectedId: 'P1' }), 2))
    const res = deserializeDoc(json)
    expect(res.problems).toEqual([])
    expect(res.board!.stats).toEqual([p])
    expect(serializeDoc(docFromBoard(META, input({ stats: res.board!.stats, selectedId: 'P1' }), 2))).toBe(json)
  })
  it('a board without one serialises exactly as before', () => {
    const plain = serializeDoc(docFromBoard(META, input(), 2))
    expect(plain).not.toContain('"stats"')
    expect(plain).not.toContain('prob')
    expect(serializeDoc(docFromBoard(META, input({ stats: [] }), 2))).toBe(plain)
  })
  it('repairs what it can and says so', () => {
    const problems: string[] = []
    const out = storedToStat(
      { id: 'P', type: 'prob', view: 'pie', table: { rows: ['a', 'b'], cols: ['x', 'y', 'z'], counts: [[1, -2, 3], [4, 'x']], a: 7 }, venn: { sets: 5, regions: ['1', 2] }, tree: { draws: 9, pick: ['0.1', 'zz'] } },
      problems,
    )
    if (!('stat' in out) || out.stat.type !== 'prob') throw new Error('prob')
    expect(out.stat.view).toBe('table')
    expect(out.stat.table.counts).toEqual([[1, 0, 3], [4, 0, 0]])
    expect(out.stat.table.a).toBe(0)
    expect(out.stat.venn.sets).toBe(2)
    expect(out.stat.venn.regions).toEqual(['1', '2', '0', '0'])
    expect(out.stat.tree.draws).toBe(2)
    expect(out.stat.tree.pick).toEqual(['0.1'])
    expect(problems.length).toBeGreaterThanOrEqual(5)
  })
})

// ---------------------------------------------------------------------------

describe('reveal mode', () => {
  const ON: RevealState = { ...REVEAL_OFF, on: true }
  it('the panel keeps the question and hides the answers', () => {
    for (const view of ['table', 'venn', 'tree'] as const) {
      const fig = probFigure(prob({ view }), 0)
      const m = maskStats(fig)
      expect(m.title.answer).toBe(' = ?')
      const answers = m.prims.filter((x) => x.k === 'text' && x.answer)
      expect(answers.length).toBeGreaterThan(0)
      expect(answers.every((x) => x.k === 'text' && x.text === '?')).toBe(true)
    }
    const t = maskStats(probFigure(prob(), 0)).prims.flatMap((x) => (x.k === 'text' ? [x.text] : []))
    expect(t).toContain('P(A | B) =')
    expect(t).toContain('30')
    expect(t).not.toContain('30/45 = 2/3')
  })
  it('one key per probability object, masked on the board until revealed', () => {
    const scene: BoardScene = {
      vp: { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 900, heightPx: 600 },
      theme: DARK_THEME,
      curves: [],
      styles: {},
      models: MODELS,
      analysis: null,
      stats: statsFigures([prob()]),
    }
    const keys = [statKey('P1')]
    const inv = buildInventory({ curves: [], crossings: [], after: keys })
    const sr: SceneReveal = { hidden: (k) => isHidden(ON, k), positions: true, pointKey: inv.answerKey, crossKey: inv.crossKey }
    const out = applyReveal(scene, sr)
    expect(out.stats![0].title.answer).toBe(' = ?')
    expect(out.revealMarks!.map((m) => m.key)).toEqual(keys)
  })
})

// ---------------------------------------------------------------------------

function model(over: Partial<BoardInput>) {
  const json = serializeDoc(docFromBoard(META, input(over), 2))
  const m = docModelFromJSON(json)
  if (!m) throw new Error('load')
  return m
}

describe('describeGraph', () => {
  it('the table: what is drawn, and (as answers) the probabilities and the verdict', () => {
    const m = model({ stats: [prob()] })
    const key = describeBoard(m, { answers: true }).long
    expect(key).toContain('A two-way table of counts with rows Grade 9 and Grade 10 and columns Plays sport and Doesn’t, 100 in all.')
    expect(key).toContain('Event A is Grade 9 and event B is Plays sport')
    expect(key).toContain('P(A | B) = 30/45 = 2/3 ≈ 0.6667.')
    expect(key).toContain('In this sample, A and B are not independent')
    const student = describeBoard(m, { answers: false }).long
    expect(student).toContain('A two-way table of counts')
    expect(student).not.toContain('2/3')
  })
  it('the Venn and tree diagrams', () => {
    const v = describeBoard(model({ stats: [prob({ view: 'venn', venn: { ...newProb('x').venn, expr: 'A ∪ B' } })] }), { answers: true }).long
    expect(v).toContain('A Venn diagram of two events (A is Plays sport, B is In a club)')
    expect(v).toContain('The event A ∪ B — A or B — is shaded.')
    expect(v).toContain('P(A ∪ B) = 23/30; by the Addition Rule, P(A ∪ B) = P(A) + P(B) − P(A ∩ B) = 13/30 + 1/2 − 1/6 = 23/30.')
    const t = describeBoard(model({ stats: [prob({ view: 'tree' })] }), { answers: true }).long
    expect(t).toContain('A tree diagram for drawing from a bag of 3 Red, 2 Blue; 2 draws without replacement: 4 outcomes')
    expect(t).toContain('P(both Red) = P(RR) = 3/10.')
  })
})

describe('worksheets and exports', () => {
  const texts = (list: ReturnType<typeof recordFigure>): string[] => list.items.filter((i): i is TextItem => i.t === 'text').map((t) => t.text)
  it('the key draws the panel with its answers; the student copy says "?"', () => {
    for (const view of ['table', 'venn', 'tree'] as const) {
      const m = model({ stats: [prob({ view })] })
      const key = texts(recordFigure(docFigure(m, { style: 'textbook', answers: true })))
      const student = texts(recordFigure(docFigure(m, { style: 'sat', answers: false })))
      expect(student).toContain('?')
      if (view === 'table') {
        expect(key).toContain('30/45 = 2/3')
        expect(student).toContain('Grade 9')
        expect(student).not.toContain('30/45 = 2/3')
      } else if (view === 'tree') {
        expect(key).toContain('3/5 · 2/4 = 6/20 = 3/10')
        expect(student).not.toContain('3/5 · 2/4 = 6/20 = 3/10')
        expect(student).toContain('2/4')
      } else {
        expect(key.some((t) => t.includes('8/30 = 4/15'))).toBe(true)
        expect(student).toContain('Shaded: A ∩ Bᶜ')
      }
    }
  })
  it('the Venn shading is clipped to the circles (arcs stay arcs)', () => {
    const m = model({ stats: [prob({ view: 'venn' })] })
    const list = recordFigure(docFigure(m, { style: 'screen', answers: true }))
    expect(list.clips.some((c) => c.segs.some((s) => s.k === 'A'))).toBe(true)
  })
})

describe('the command and the help sheet', () => {
  it('Build ▾ → Probability is a command in the NC Math 2 section', () => {
    expect(COMMANDS.some((c) => c.id === 'build-probability')).toBe(true)
    const sec = HELP_SECTIONS.find((s) => s.id === 'm2-prob')!
    expect(sec.course).toBe('NC Math 2')
    expect(sec.entries.length).toBeGreaterThanOrEqual(4)
  })
})

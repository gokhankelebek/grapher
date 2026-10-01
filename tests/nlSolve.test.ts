// ============================================================================
// tests/nlSolve.test.ts — the number line's SOLVE item, against hand-made
// SolveResult fixtures (the solver itself is tested by the core's own suite).
//
//   persistence   a solve item round-trips storing only src / colour / flags;
//                 an old number-line document is byte-identical
//   the working   steps and "Copy as text" from fixtures
//   layout        the stacked compound (A, B, A ∩ B) shares one x-scale and
//                 its bands never overlap
//   distance      the |x − a| R b bracket's geometry
//   SAT           a solve item under the mono style is drawn in one ink
//   worksheets    a student copy of a number-line document hides the set;
//                 the key draws it — in the same frame
// ============================================================================

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { IntervalPart, RealSet } from '../src/core/domainRange'
import type { ClauseWork, SolveOutcome, SolveResult } from '../src/core/solveInequality'
import type { NLItem, NLSolveItem, Viewport } from '../src/core/types'
import { CURVE_COLORS, DARK_THEME, FIGURE_STYLES, NL_SOLVE_DEFAULTS, toPrintColor } from '../src/core/types'
import type { BoardInput, DocMeta } from '../src/core/persist'
import { deserializeDoc, docFromBoard, serializeDoc } from '../src/core/persist'
import {
  builderText,
  distanceBracket,
  distanceLabel,
  fitRange,
  graphSources,
  markErrorAt,
  setSolverForTests,
  solveBlocks,
  solveCached,
  solveErrorText,
  solveFigureSpec,
  solveHit,
  solveLayout,
  solveXs,
  tableText,
  workingSteps,
  workingText,
} from '../src/ui/nlSolve'
import { SOLVE_BAND } from '../src/render/nlSolve'
import { nlLanes, nlToScreenX, numberLineAxisY } from '../src/render/numberline'
import { renderBoard } from '../src/ui/renderBoard'
import type { BoardScene } from '../src/ui/renderBoard'
import { contentBounds, exportViewport } from '../src/ui/exportFit'
import { docFigure, docModelFromJSON } from '../src/ui/docScene'
import { itemEquationText } from '../src/ui/equationText'
import { itemLegend } from '../src/ui/present'
import { answerClipboardText } from '../src/ui/nlText'
import { MockCtx, withMockPath2D } from './mockCanvas'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ex = (text: string, value: number, tex = text.replace('−', '-')) => ({ text, tex, value })

const part = (lo: number, hi: number, loClosed = false, hiClosed = false): IntervalPart => ({
  lo,
  hi,
  loClosed: Number.isFinite(lo) && loClosed,
  hiClosed: Number.isFinite(hi) && hiClosed,
  loExact: Number.isFinite(lo) ? ex(String(lo).replace('-', '−'), lo) : null,
  hiExact: Number.isFinite(hi) ? ex(String(hi).replace('-', '−'), hi) : null,
})

const set = (parts: IntervalPart[], text: string, builder: string): RealSet => ({
  kind: 'intervals',
  parts,
  text,
  tex: text.replace(/−/g, '-').replace(/∞/g, '\\infty').replace(/∪/g, '\\cup'),
  builder,
  builderTex: builder.replace(/−/g, '-').replace(/≤/g, '\\le'),
})

const REALS = set([part(-Infinity, Infinity)], '(−∞, ∞)', 'all real numbers')

/** x² − 4 > 0 */
const QUAD: SolveResult = {
  ok: true,
  solution: set([part(-Infinity, -2), part(2, Infinity)], '(−∞, −2) ∪ (2, ∞)', 'x < −2 or x > 2'),
  combine: 'single',
  clauses: [
    {
      text: 'x² − 4 > 0',
      tex: 'x^2 - 4 > 0',
      hText: 'x² − 4',
      hTex: 'x^2 - 4',
      relation: '>',
      domain: REALS,
      critical: [
        { x: -2, exact: ex('−2', -2), why: 'zero', included: false },
        { x: 2, exact: ex('2', 2), why: 'zero', included: false },
      ],
      table: [
        { lo: -Infinity, hi: -2, t: -3, tText: '−3', value: 5, valueText: '5', sign: 1, satisfies: true },
        { lo: -2, hi: 2, t: 0, tText: '0', value: -4, valueText: '−4', sign: -1, satisfies: false },
        { lo: 2, hi: Infinity, t: 3, tText: '3', value: 5, valueText: '5', sign: 1, satisfies: true },
      ],
      solution: set([part(-Infinity, -2), part(2, Infinity)], '(−∞, −2) ∪ (2, ∞)', 'x < −2 or x > 2'),
      distance: null,
    },
  ],
  conclusion: 'x² − 4 > 0 for x < −2 or x > 2, so the solution is (−∞, −2) ∪ (2, ∞)',
  conclusionTex: 'x^2-4>0',
  universe: null,
  variable: 'x',
  exact: true,
  notes: [],
}

/** (x − 1)/(x + 2) ≤ 0 — a pole at −2 (open), a zero at 1 (closed). */
const RATIONAL: SolveResult = {
  ok: true,
  solution: set([part(-2, 1, false, true)], '(−2, 1]', '−2 < x ≤ 1'),
  combine: 'single',
  clauses: [
    {
      text: '(x − 1)/(x + 2) ≤ 0',
      tex: '\\frac{x-1}{x+2} \\le 0',
      hText: '(x − 1)/(x + 2)',
      hTex: '\\frac{x-1}{x+2}',
      relation: '<=',
      domain: set([part(-Infinity, -2), part(-2, Infinity)], '(−∞, −2) ∪ (−2, ∞)', 'x ≠ −2'),
      critical: [
        { x: -2, exact: ex('−2', -2), why: 'undefined', included: false },
        { x: 1, exact: ex('1', 1), why: 'zero', included: true },
      ],
      table: [
        { lo: -Infinity, hi: -2, t: -3, tText: '−3', value: 4, valueText: '4', sign: 1, satisfies: false },
        { lo: -2, hi: 1, t: 0, tText: '0', value: -0.5, valueText: '−1/2', sign: -1, satisfies: true },
        { lo: 1, hi: Infinity, t: 2, tText: '2', value: 0.25, valueText: '1/4', sign: 1, satisfies: false },
      ],
      solution: set([part(-2, 1, false, true)], '(−2, 1]', '−2 < x ≤ 1'),
      distance: null,
    },
  ],
  conclusion: '(x − 1)/(x + 2) ≤ 0 for −2 < x ≤ 1, so the solution is (−2, 1]',
  conclusionTex: '',
  universe: null,
  variable: 'x',
  exact: true,
  notes: [],
}

/** |2x − 3| < 5 — the numbers within 5/2 of 3/2. */
const ABS: SolveResult = {
  ok: true,
  solution: set([part(-1, 4)], '(−1, 4)', '−1 < x < 4'),
  combine: 'single',
  clauses: [
    {
      text: '|2x − 3| < 5',
      tex: '|2x-3| < 5',
      hText: '|2x − 3| − 5',
      hTex: '|2x-3| - 5',
      relation: '<',
      domain: REALS,
      critical: [
        { x: -1, exact: ex('−1', -1), why: 'zero', included: false },
        { x: 4, exact: ex('4', 4), why: 'zero', included: false },
      ],
      table: [
        { lo: -Infinity, hi: -1, t: -2, tText: '−2', value: 2, valueText: '2', sign: 1, satisfies: false },
        { lo: -1, hi: 4, t: 0, tText: '0', value: -2, valueText: '−2', sign: -1, satisfies: true },
        { lo: 4, hi: Infinity, t: 5, tText: '5', value: 2, valueText: '2', sign: 1, satisfies: false },
      ],
      solution: set([part(-1, 4)], '(−1, 4)', '−1 < x < 4'),
      distance: {
        center: 1.5,
        centerText: '3/2',
        radius: 2.5,
        radiusText: '5/2',
        sentence: '|2x − 3| < 5 means |x − 3/2| < 5/2: the numbers within 5/2 of 3/2.',
      },
    },
  ],
  conclusion: '|2x − 3| < 5 for −1 < x < 4, so the solution is (−1, 4)',
  conclusionTex: '',
  universe: null,
  variable: 'x',
  exact: true,
  notes: [],
}

const clauseA: ClauseWork = {
  text: 'x² > 1',
  tex: 'x^2 > 1',
  hText: 'x² − 1',
  hTex: 'x^2 - 1',
  relation: '>',
  domain: REALS,
  critical: [
    { x: -1, exact: ex('−1', -1), why: 'zero', included: false },
    { x: 1, exact: ex('1', 1), why: 'zero', included: false },
  ],
  table: [
    { lo: -Infinity, hi: -1, t: -2, tText: '−2', value: 3, valueText: '3', sign: 1, satisfies: true },
    { lo: -1, hi: 1, t: 0, tText: '0', value: -1, valueText: '−1', sign: -1, satisfies: false },
    { lo: 1, hi: Infinity, t: 2, tText: '2', value: 3, valueText: '3', sign: 1, satisfies: true },
  ],
  solution: set([part(-Infinity, -1), part(1, Infinity)], '(−∞, −1) ∪ (1, ∞)', 'x < −1 or x > 1'),
  distance: null,
}
const clauseB: ClauseWork = {
  text: 'x < 3',
  tex: 'x < 3',
  hText: 'x − 3',
  hTex: 'x - 3',
  relation: '<',
  domain: REALS,
  critical: [{ x: 3, exact: ex('3', 3), why: 'zero', included: false }],
  table: [
    { lo: -Infinity, hi: 3, t: 0, tText: '0', value: -3, valueText: '−3', sign: -1, satisfies: true },
    { lo: 3, hi: Infinity, t: 4, tText: '4', value: 1, valueText: '1', sign: 1, satisfies: false },
  ],
  solution: set([part(-Infinity, 3)], '(−∞, 3)', 'x < 3'),
  distance: null,
}
/** x² > 1 and x < 3 */
const AND: SolveResult = {
  ok: true,
  solution: set([part(-Infinity, -1), part(1, 3)], '(−∞, −1) ∪ (1, 3)', 'x < −1 or 1 < x < 3'),
  combine: 'and',
  clauses: [clauseA, clauseB],
  conclusion: 'Both hold for x < −1 or 1 < x < 3, so the solution is (−∞, −1) ∪ (1, 3)',
  conclusionTex: '',
  universe: null,
  variable: 'x',
  exact: true,
  notes: [],
}

const FIXTURES: Record<string, SolveOutcome> = {
  'x^2 - 4 > 0': QUAD,
  '(x-1)/(x+2) <= 0': RATIONAL,
  '|2x - 3| < 5': ABS,
  'x^2 > 1 and x < 3': AND,
}

beforeEach(() => setSolverForTests((src) => FIXTURES[src] ?? { ok: false, error: 'Unexpected “>”', pos: 4 }))
afterEach(() => setSolverForTests(null))

const VP: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 900, heightPx: 700 }
const COLOR = CURVE_COLORS[2]
const solveItem = (src: string, over: Partial<NLSolveItem> = {}): NLSolveItem => ({
  kind: 'solve',
  id: `s-${src.length}`,
  src,
  color: COLOR,
  show: { ...NL_SOLVE_DEFAULTS },
  ...over,
})

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const META: DocMeta = { id: 'nl1', name: 'Number line', createdAt: 1, modifiedAt: 2 }

function boardInput(over: Partial<BoardInput>): BoardInput {
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

describe('solve items — persistence', () => {
  it('round-trips a solve item, storing only its line, colour, label and flags', () => {
    const it0 = solveItem('x^2 - 4 > 0', { id: 'q', label: 'Q1', show: { signs: true, tests: true, distance: false, stacked: true } })
    const items: NLItem[] = [
      it0,
      { kind: 'interval', id: 'i1', lo: -2, hi: 5, loClosed: true, hiClosed: false, color: CURVE_COLORS[0] },
    ]
    const json = serializeDoc(docFromBoard(META, boardInput({ kind: 'number-line', items, styles: { q: { width: 9 } } }), 2))
    const stored = JSON.parse(json).board.items[0]
    expect(stored).toEqual({
      style: { width: 9 },
      kind: 'solve',
      id: 'q',
      src: 'x^2 - 4 > 0',
      color: COLOR,
      label: 'Q1',
      show: { signs: true, tests: true, distance: false, stacked: true },
    })
    // nothing computed reaches the disk
    expect(json).not.toContain('critical')
    expect(json).not.toContain('(−∞')
    const res = deserializeDoc(json)
    expect(res.problems).toEqual([])
    expect(res.board!.items).toEqual(items)
    expect(res.board!.styles.q).toEqual({ width: 9 })
    // and saving what was loaded writes the same bytes
    const again = serializeDoc(docFromBoard(META, boardInput({ kind: 'number-line', items: res.board!.items, styles: res.board!.styles }), 2))
    expect(again).toBe(json)
  })

  it('an old number-line document (points and intervals) is byte-identical', () => {
    const items: NLItem[] = [
      { kind: 'interval', id: 'i1', lo: -2, hi: 5, loClosed: true, hiClosed: false, color: '#4f9cf9', label: 'domain' },
      { kind: 'interval', id: 'i2', lo: null, hi: -3, loClosed: false, hiClosed: true, color: '#4f9cf9' },
      { kind: 'point', id: 'p1', x: 7, closed: false, color: '#f59e0b' },
    ]
    const json = serializeDoc(docFromBoard(META, boardInput({ kind: 'number-line', items, styles: { i1: { width: 8, group: 'g' } } }), 2))
    // the stored shape of a point and an interval is exactly what it was
    expect(JSON.parse(json).board.items).toEqual([
      { style: { width: 8, group: 'g' }, kind: 'interval', id: 'i1', lo: -2, hi: 5, loClosed: true, hiClosed: false, color: '#4f9cf9', label: 'domain' },
      { kind: 'interval', id: 'i2', lo: null, hi: -3, loClosed: false, hiClosed: true, color: '#4f9cf9' },
      { kind: 'point', id: 'p1', x: 7, closed: false, color: '#f59e0b' },
    ])
    expect(json).not.toContain('solve')
    expect(json).not.toContain('show')
    const res = deserializeDoc(json)
    expect(res.problems).toEqual([])
    expect(res.degraded).toBe(false)
    expect(res.board!.items).toEqual(items)
    const again = serializeDoc(docFromBoard(META, boardInput({ kind: 'number-line', items: res.board!.items, styles: res.board!.styles }), 2))
    expect(again).toBe(json)
  })

  it('validates: an empty line is dropped and reported, junk flags are discarded', () => {
    const json = JSON.stringify({
      version: 2,
      id: 'v',
      name: 'v',
      createdAt: 1,
      modifiedAt: 1,
      board: {
        kind: 'number-line',
        curves: [],
        items: [
          { kind: 'solve', id: 'a', src: '   ', color: '#fff', show: {} },
          { kind: 'solve', id: 'b', src: 'x^2 - 4 > 0', color: '#fff', show: { signs: 'yes', tests: true, bogus: 1 } },
          { kind: 'solve', id: 'c', src: 42, color: '#fff' },
          { kind: 'solve', id: 'd', src: 'x > 1' },
        ],
        viewport: { cx: 0, cy: 0, ppu: 60 },
        selectedId: null,
        mode: 'draw',
      },
    })
    const res = deserializeDoc(json)
    expect(res.board!.items.map((i) => i.id)).toEqual(['b', 'd'])
    expect(res.board!.items[0]).toEqual({ kind: 'solve', id: 'b', src: 'x^2 - 4 > 0', color: '#fff', show: { tests: true } })
    expect((res.board!.items[1] as NLSolveItem).show).toEqual({})
    expect(res.problems.join(' ')).toMatch(/2 damaged number-line items/)
  })

  it('restates as its own line, and names itself in the present legend', () => {
    const it0 = solveItem('x^2 - 4 > 0')
    expect(itemEquationText(it0)).toBe('x^2 - 4 > 0')
    const [entry] = itemLegend([it0])
    expect(entry.tex).toContain('x^2 - 4 > 0')
    expect(entry.tex).toContain('\\Longrightarrow')
    expect(answerClipboardText([it0])).toBe('(−∞, −2) ∪ (2, ∞)\nx < −2 or x > 2')
  })
})

// ---------------------------------------------------------------------------
// The working
// ---------------------------------------------------------------------------

describe('solve items — the working', () => {
  it('steps in the taught order: h, domain, critical values, table, conclusion', () => {
    const steps = workingSteps(QUAD)
    expect(steps.map((s) => s.kind)).toEqual(['line', 'line', 'line', 'table', 'conclusion'])
    expect(steps[0]).toMatchObject({ text: 'Let h(x) = x² − 4; solve h(x) > 0.' })
    expect(steps[1]).toMatchObject({ text: 'Domain of h: all real numbers' })
    expect(steps[2]).toMatchObject({ text: 'Critical values: x = −2 (h = 0), x = 2 (h = 0)' })
    const table = steps[3]
    if (table.kind !== 'table') throw new Error('no table')
    expect(table.rows).toEqual([
      { interval: '(−∞, −2)', t: '−3', value: '5', sign: '+', ok: true },
      { interval: '(−2, 2)', t: '0', value: '−4', sign: '−', ok: false },
      { interval: '(2, ∞)', t: '3', value: '5', sign: '+', ok: true },
    ])
  })

  it('says why each critical value is one (zero / undefined)', () => {
    const crit = workingSteps(RATIONAL).find((s) => s.kind === 'line' && s.text.startsWith('Critical'))
    expect(crit).toMatchObject({ text: 'Critical values: x = −2 (h undefined), x = 1 (h = 0)' })
    expect(workingSteps(RATIONAL)[1]).toMatchObject({ text: 'Domain of h: (−∞, −2) ∪ (−2, ∞)' })
  })

  it('copies as text with the table in aligned columns', () => {
    const text = workingText('x^2 - 4 > 0', QUAD)
    expect(text).toBe(
      [
        'Solve x^2 - 4 > 0',
        '1. Let h(x) = x² − 4; solve h(x) > 0.',
        '2. Domain of h: all real numbers',
        '3. Critical values: x = −2 (h = 0), x = 2 (h = 0)',
        '4. Test a point in each interval:',
        '   interval | test point | h(t) | sign | ✓/✗',
        '   ---------+------------+------+------+----',
        '   (−∞, −2) | −3         | 5    | +    | ✓',
        '   (−2, 2)  | 0          | −4   | −    | ✗',
        '   (2, ∞)   | 3          | 5    | +    | ✓',
        '',
        'x² − 4 > 0 for x < −2 or x > 2, so the solution is (−∞, −2) ∪ (2, ∞)',
        'Interval notation: (−∞, −2) ∪ (2, ∞)',
        'Set-builder: {x | x < −2 or x > 2}',
      ].join('\n'),
    )
  })

  it('a compound: each clause under its name, then the combination', () => {
    const steps = workingSteps(AND)
    const heads = steps.filter((s) => s.kind === 'heading').map((s) => s.text)
    expect(heads).toEqual(['A: x² > 1', 'B: x < 3', 'Combine (and)'])
    const text = workingText('x^2 > 1 and x < 3', AND)
    expect(text).toContain('So A = (−∞, −1) ∪ (1, ∞)')
    expect(text).toContain('So B = (−∞, 3)')
    expect(text).toContain('Both must hold, so intersect: A ∩ B = (−∞, −1) ∪ (1, 3)')
  })

  it('the distance form states the distance sentence', () => {
    const text = workingText('|2x - 3| < 5', ABS)
    expect(text).toContain('the numbers within 5/2 of 3/2')
    expect(distanceLabel('<', '5/2', '3/2')).toBe('within 5/2 of 3/2')
    expect(distanceLabel('>=', '2', '4')).toBe('at least 2 from 4')
  })

  it('set-builder wraps a condition and leaves words alone', () => {
    expect(builderText(QUAD.solution)).toBe('{x | x < −2 or x > 2}')
    expect(builderText(REALS)).toBe('all real numbers')
    expect(tableText([], 'h(t)')[0]).toContain('interval')
  })

  it('a refusal keeps its position', () => {
    const out = solveCached('x^2 > > 1')
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.pos).toBe(4)
    expect(markErrorAt('x^2 > > 1', 6)).toBe('x^2 > ▸> 1')
    expect(solveErrorText('x^2 > > 1', { error: 'Unexpected “>”', pos: 6 })).toBe('Unexpected “>” — at character 7: x^2 > ▸> 1')
  })
})

// ---------------------------------------------------------------------------
// Stacked layout
// ---------------------------------------------------------------------------

describe('solve items — stacked layout', () => {
  it('a stacked compound is A, B, then A ∩ B on the board axis', () => {
    const spec = solveFigureSpec(solveItem('x^2 > 1 and x < 3'), AND)
    expect(spec.lines.map((l) => l.label)).toEqual(['A', 'B', 'A ∩ B'])
    expect(spec.lines.map((l) => l.main)).toEqual([false, false, true])
    // the combined line draws the combined set; its dots are its ends
    expect(spec.lines[2].set).toBe(AND.solution)
    expect(spec.lines[2].dots).toEqual([
      { x: -1, closed: false },
      { x: 1, closed: false },
      { x: 3, closed: false },
    ])
    expect(spec.guides).toEqual([-1, 1, 3])
    // only the clauses carry sign rows
    expect(spec.lines.map((l) => l.signs !== null)).toEqual([true, true, false])
  })

  it('unstacked, a compound is just its combined set', () => {
    const spec = solveFigureSpec(solveItem('x^2 > 1 and x < 3', { show: { ...NL_SOLVE_DEFAULTS, stacked: false } }), AND)
    expect(spec.lines).toHaveLength(1)
    expect(spec.lines[0].label).toBe('')
  })

  it('lines go up from the axis; bands stack above their own line and never overlap', () => {
    const spec = solveFigureSpec(solveItem('x^2 > 1 and x < 3', { show: { signs: true, tests: true, stacked: true } }), AND)
    const axisY = 350
    const L = solveLayout(spec, axisY)
    expect(L.lines[2].y).toBe(axisY)
    for (let i = 0; i < L.lines.length; i++) {
      const l = L.lines[i]
      expect(l.top).toBeLessThan(l.y)
      if (l.testsY !== null) expect(l.testsY).toBeLessThan(l.y - SOLVE_BAND.clear + 0.01)
      if (l.signsY !== null && l.testsY !== null) expect(l.signsY).toBeLessThan(l.testsY - SOLVE_BAND.tests / 2)
      if (i > 0) expect(L.lines[i - 1].y).toBeLessThanOrEqual(l.top - SOLVE_BAND.gap)
    }
    expect(L.top).toBe(L.lines[0].top)
    // twice the type, twice the height
    const big = solveLayout(spec, axisY, 2)
    expect(axisY - big.top).toBeCloseTo(2 * (axisY - L.top), 6)
  })

  it('every line keeps the board x-scale: one critical x, one screen x', () => {
    const { blocks } = solveBlocks([solveItem('x^2 > 1 and x < 3')], VP)
    const spec = blocks[0].spec
    const xA = spec.lines[0].dots.find((d) => d.x === 1)!.x
    const xMain = spec.lines[2].dots.find((d) => d.x === 1)!.x
    expect(nlToScreenX(xA, VP)).toBe(nlToScreenX(xMain, VP))
  })

  it('plain items are lifted above the solve stack, and only when there is one', () => {
    const plain: NLItem = { kind: 'point', id: 'p', x: 0, closed: true, color: COLOR }
    const none = solveBlocks([plain], VP)
    expect(none.lift).toBe(0)
    expect(nlLanes([plain], VP, none.lift)[0].y).toBe(numberLineAxisY(VP))
    const some = solveBlocks([solveItem('x^2 - 4 > 0'), plain], VP)
    expect(some.lift).toBeGreaterThan(0)
    expect(nlLanes([solveItem('x^2 - 4 > 0'), plain], VP, some.lift)[0].y).toBeLessThan(some.top)
  })

  it('a second solve item stacks above the first on its own line', () => {
    const { blocks } = solveBlocks([solveItem('x^2 - 4 > 0', { id: 'a' }), solveItem('|2x - 3| < 5', { id: 'b' })], VP)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].spec.lines[0].main).toBe(true)
    expect(blocks[1].spec.lines[0].main).toBe(false)
    expect(blocks[1].layout.lines[0].y).toBeLessThan(blocks[0].layout.top)
  })

  it('frames the critical values with margin, and clicks on the set select it', () => {
    expect(solveXs(QUAD)).toEqual([-2, 2, -2, 2])
    expect(fitRange([-2, 2])).toEqual({ min: -3, max: 3 })
    expect(fitRange([3])).toEqual({ min: 2, max: 4 })
    const box = contentBounds({ kind: 'number-line', curves: [], items: [solveItem('x^2 - 4 > 0')], models: {}, window: [-10, 10] })
    expect(box).toEqual({ min: { x: -3, y: -0.5 }, max: { x: 3, y: 0.5 } })
    const items = [solveItem('x^2 - 4 > 0', { id: 'q' })]
    const y = numberLineAxisY(VP)
    expect(solveHit(items, VP, { x: nlToScreenX(4, VP), y })).toBe('q')
    expect(solveHit(items, VP, { x: nlToScreenX(0, VP), y })).toBe(null)
    expect(solveHit(items, VP, { x: nlToScreenX(4, VP), y: y - 60 })).toBe(null)
  })

  it('the export strip grows to hold a tall stack', () => {
    const settings = { scale: 1, width: null, margin: 0, theme: 'light' as const, fit: true, aspect: 'strip' as const }
    const items = [solveItem('x^2 > 1 and x < 3', { show: { signs: true, tests: true, stacked: true } })]
    const box = contentBounds({ kind: 'number-line', curves: [], items, models: {}, window: [-10, 10] })
    const evp = exportViewport(VP, settings, box, 'number-line', items)
    const { top } = solveBlocks(items, evp)
    expect(top).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Distance bracket
// ---------------------------------------------------------------------------

describe('solve items — the distance bracket', () => {
  it('spans centre ± radius, its ticks drop toward the line, the label sits over the centre', () => {
    const g = distanceBracket({ center: 1.5, radius: 2.5 }, VP, 200, 1, 20)
    expect(g.x0).toBe(nlToScreenX(-1, VP))
    expect(g.xc).toBe(nlToScreenX(1.5, VP))
    expect(g.x1).toBe(nlToScreenX(4, VP))
    expect(g.tickY).toBe(200 + SOLVE_BAND.bracketTick)
    expect(g.labelX).toBe(g.xc)
    expect(g.labelY).toBeLessThan(g.y)
    expect(g.halves).toEqual([
      { x: (g.x0 + g.xc) / 2, y: 200 },
      { x: (g.xc + g.x1) / 2, y: 200 },
    ])
  })

  it('drops the half labels when a half is too narrow to hold one', () => {
    const g = distanceBracket({ center: 0, radius: 0.2 }, VP, 200, 1, 30)
    expect(g.halves).toBeNull()
  })

  it('appears only with the toggle on, labelled in words', () => {
    const on = solveFigureSpec(solveItem('|2x - 3| < 5'), ABS)
    expect(on.lines[0].distance).toMatchObject({ center: 1.5, radius: 2.5, label: 'within 5/2 of 3/2' })
    const off = solveFigureSpec(solveItem('|2x - 3| < 5', { show: { distance: false } }), ABS)
    expect(off.lines[0].distance).toBeNull()
  })

  it('draws the bracket, the sentence, and the radius over each half', () => {
    const ctx = render({ items: [solveItem('|2x - 3| < 5')] })
    const texts = ctx.texts.map((t) => t.text)
    expect(texts).toContain('within 5/2 of 3/2')
    expect(texts.filter((t) => t === '5/2')).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Drawing, SAT mono, student copies
// ---------------------------------------------------------------------------

/** MockCtx that also records the fill style at every fill(). */
class StyleCtx extends MockCtx {
  filled: string[] = []
  arcs: { x: number; y: number }[] = []
  arc(x: number, y: number, r: number): void {
    this.arcs.push({ x, y })
    super.arc(x, y, r)
  }
  fill(): void {
    this.filled.push(this.fillStyle)
    super.fill()
  }
}

function render(over: Partial<BoardScene>): StyleCtx {
  const ctx = new StyleCtx()
  const scene: BoardScene = {
    vp: VP,
    theme: DARK_THEME,
    kind: 'number-line',
    items: [],
    curves: [],
    styles: {},
    models: {},
    ...over,
  }
  withMockPath2D(() => renderBoard(ctx as unknown as CanvasRenderingContext2D, scene))
  return ctx
}

describe('solve items — drawing', () => {
  it('x² − 4 > 0: open dots at ±2, rays to ±∞, signs and exact labels', () => {
    const ctx = render({ items: [solveItem('x^2 - 4 > 0')] })
    const y = numberLineAxisY(VP)
    const at = (x: number) => ctx.arcs.filter((a) => Math.abs(a.x - nlToScreenX(x, VP)) < 0.5 && Math.abs(a.y - y) < 0.5)
    expect(at(-2).length).toBeGreaterThan(0)
    expect(at(2).length).toBeGreaterThan(0)
    // open: the ground fills the centre
    expect(ctx.filled).toContain(DARK_THEME.bg)
    const texts = ctx.texts.map((t) => t.text)
    expect(texts.filter((t) => t === '+')).toHaveLength(2)
    expect(texts).toContain('−')
    expect(texts.filter((t) => t === '0').length).toBeGreaterThanOrEqual(2)
  })

  it('test points are labelled t = … only with the toggle on', () => {
    const off = render({ items: [solveItem('x^2 - 4 > 0')] }).texts.map((t) => t.text)
    expect(off).not.toContain('t = 0')
    const on = render({ items: [solveItem('x^2 - 4 > 0', { show: { tests: true } })] }).texts.map((t) => t.text)
    expect(on).toEqual(expect.arrayContaining(['t = −3', 't = 0', 't = 3']))
  })

  it('a pole is marked und in the sign row and drawn open', () => {
    const ctx = render({ items: [solveItem('(x-1)/(x+2) <= 0')] })
    expect(ctx.texts.map((t) => t.text)).toContain('und')
    const y = numberLineAxisY(VP)
    const fillsAt = (x: number) => {
      const px = nlToScreenX(x, VP)
      return ctx.arcs.some((a) => Math.abs(a.x - px) < 0.5 && Math.abs(a.y - y) < 0.5)
    }
    expect(fillsAt(-2)).toBe(true)
    expect(fillsAt(1)).toBe(true)
  })

  it('a stacked compound names its lines A, B and A ∩ B', () => {
    const texts = render({ items: [solveItem('x^2 > 1 and x < 3')] }).texts.map((t) => t.text)
    expect(texts).toEqual(expect.arrayContaining(['A', 'B', 'A ∩ B']))
  })

  it('under the SAT style every stroke and fill of the solve figure is the one ink', () => {
    const sat = FIGURE_STYLES.sat
    const ctx = render({ items: [solveItem('x^2 > 1 and x < 3', { show: { signs: true, tests: true, stacked: true } })], figure: sat })
    const palette = new Set([COLOR, toPrintColor(COLOR)])
    for (const s of [...ctx.strokeStyles, ...ctx.filled, ...ctx.fillStyles]) expect(palette.has(s)).toBe(false)
    expect(ctx.strokeStyles).toContain(sat.theme.axis)
    expect(ctx.filled).toContain(sat.theme.axis)
    // and on screen, the item keeps its colour
    const screen = render({ items: [solveItem('x^2 > 1 and x < 3')] })
    expect(screen.strokeStyles).toContain(COLOR)
  })

  it('a student scene draws the bare line: no dots, no signs, no labels of the set', () => {
    const key = render({ items: [solveItem('x^2 - 4 > 0')] })
    const student = render({ items: [solveItem('x^2 - 4 > 0')], nlStudent: true })
    expect(key.arcs.length).toBeGreaterThan(0)
    expect(student.arcs).toHaveLength(0)
    expect(student.texts.map((t) => t.text)).not.toContain('+')
    // the axis and its numbers are still there to answer on
    expect(student.texts.map((t) => t.text)).toContain('1')
  })

  it('an item that does not solve draws nothing and breaks nothing', () => {
    const ctx = render({ items: [solveItem('nonsense > >')] })
    expect(ctx.arcs).toHaveLength(0)
  })
})

describe('solve items — worksheets', () => {
  const doc = (): string =>
    serializeDoc(
      docFromBoard(
        META,
        boardInput({ kind: 'number-line', items: [solveItem('x^2 - 4 > 0', { id: 'q' })], viewport: { center: { x: 0, y: 0 }, pxPerUnit: 60 } }),
        2,
      ),
    )

  it('the key draws the set; the student copy hides it in the same frame', () => {
    const m = docModelFromJSON(doc())!
    expect(m.kind).toBe('number-line')
    const key = docFigure(m, { style: 'sat', answers: true })
    const student = docFigure(m, { style: 'sat', answers: false })
    expect(key.scene.nlStudent).toBeUndefined()
    expect(student.scene.nlStudent).toBe(true)
    expect(student.scene.vp).toEqual(key.scene.vp)
    const draw = (scene: BoardScene): StyleCtx => {
      const ctx = new StyleCtx()
      withMockPath2D(() => renderBoard(ctx as unknown as CanvasRenderingContext2D, scene))
      return ctx
    }
    expect(draw(key.scene).arcs.length).toBeGreaterThan(0)
    expect(draw(student.scene).arcs).toHaveLength(0)
  })
})

describe('solve items — show on graph', () => {
  it('graphs h = left − right, or the left side when the right is 0', () => {
    expect(graphSources('x^2 - 4 > 0')).toEqual([{ src: 'y = x^2 - 4', signChart: true }])
    expect(graphSources('x^3 >= 4x')).toEqual([{ src: 'y = x^3 - 4x', signChart: true }])
    expect(graphSources('sqrt(x+1) >= x - 1')).toEqual([{ src: 'y = sqrt(x+1) - (x - 1)', signChart: true }])
    expect(graphSources('(x-1)/(x+2) <= 0')).toEqual([{ src: 'y = (x-1)/(x+2)', signChart: true }])
  })

  it('carries a restriction onto the curve, splits compounds, draws a chain as E and its levels', () => {
    expect(graphSources('sin(x) >= 1/2 {0 <= x <= 2pi}')).toEqual([
      { src: 'y = sin(x) - 1/2 {0 <= x <= 2pi}', signChart: true },
    ])
    expect(graphSources('x^2 > 1 and x < 3')).toEqual([
      { src: 'y = x^2 - 1', signChart: true },
      { src: 'y = x - 3', signChart: true },
    ])
    expect(graphSources('2 < 3x - 1 <= 8')).toEqual([
      { src: 'y = 3x - 1', signChart: false },
      { src: 'y = 2', signChart: false },
      { src: 'y = 8', signChart: false },
    ])
    expect(graphSources('[-2, 5)')).toBeNull()
  })
})

describe('solve items — the documents list', () => {
  it('counts solved inequalities, and leaves an old count unchanged', async () => {
    const { countBoard, boardToStored } = await import('../src/core/persist')
    const { describeCounts } = await import('../src/ui/docName')
    const old = countBoard(boardToStored(boardInput({ kind: 'number-line', items: [{ kind: 'point', id: 'p', x: 1, closed: true, color: COLOR }] })))
    expect(old).toEqual({ curves: 0, points: 1, intervals: 0 })
    const c = countBoard(boardToStored(boardInput({ kind: 'number-line', items: [solveItem('x^2 - 4 > 0')] })))
    expect(c).toEqual({ curves: 0, points: 0, intervals: 0, solved: 1 })
    expect(describeCounts('number-line', c)).toBe('1 inequality')
    expect(describeCounts('number-line', { ...c, points: 1 })).toBe('2 items')
  })
})

describe('solve items — set-builder and universe ends', () => {
  it('builds the condition from the parts when the builder is only interval text', () => {
    const combined = { ...AND.solution, builder: AND.solution.text, builderTex: AND.solution.tex }
    expect(builderText(combined)).toBe('{x | x < −1 or 1 < x < 3}')
    const closed = set([part(-2, 1, false, true)], '(−2, 1]', '(−2, 1]')
    expect(builderText(closed)).toBe('{x | −2 < x ≤ 1}')
  })

  it('a domain end the set does not reach gets no dot, but keeps its exact label', () => {
    const sol = set([part(Math.PI / 6, (5 * Math.PI) / 6, true, true)], '[π/6, 5π/6]', 'π/6 ≤ x ≤ 5π/6')
    sol.parts[0].loExact = ex('π/6', Math.PI / 6, '\\frac{\\pi}{6}')
    sol.parts[0].hiExact = ex('5π/6', (5 * Math.PI) / 6, '\\frac{5\\pi}{6}')
    const r: SolveResult = {
      ...QUAD,
      solution: sol,
      universe: { lo: 0, hi: 2 * Math.PI, loClosed: true, hiClosed: true, loExact: ex('0', 0), hiExact: ex('2π', 2 * Math.PI) },
      clauses: [
        {
          ...QUAD.clauses[0],
          critical: [
            { x: 0, exact: ex('0', 0), why: 'domain-end', included: false },
            { x: Math.PI / 6, exact: ex('π/6', Math.PI / 6), why: 'zero', included: true },
            { x: (5 * Math.PI) / 6, exact: ex('5π/6', (5 * Math.PI) / 6), why: 'zero', included: true },
            { x: 2 * Math.PI, exact: ex('2π', 2 * Math.PI), why: 'domain-end', included: false },
          ],
          solution: sol,
        },
      ],
    }
    const spec = solveFigureSpec(solveItem('sin(x) >= 1/2 {0 <= x <= 2pi}'), r)
    expect(spec.lines[0].dots.map((d) => d.closed)).toEqual([true, true])
    expect(spec.exact.map((e) => e.text)).toEqual(['0', 'π/6', '5π/6', '2π'])
  })
})

describe('working for a set typed as itself', () => {
  it('[0, 5) is stated, not "solved" as h(x) = [0, 5)', async () => {
    const { solveInequality } = await import('../src/core/solveInequality')
    const { workingSteps } = await import('../src/ui/nlSolve')
    const r = solveInequality('[0, 5)')
    if (!r.ok) throw new Error(r.error)
    const text = workingSteps(r).map((s) => ('text' in s ? s.text : '')).join('\n')
    expect(text).not.toMatch(/Let h\(/)
    expect(text).toMatch(/already a set: \[0, 5\)/)
  })
})

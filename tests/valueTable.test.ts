// ============================================================================
// tests/valueTable.test.ts — the Table section of a curve's card.
//
//   - exact values at nice x (π/6, 1/2, √2) and decimals elsewhere;
//   - Δy, Δ²y, ratios and average rates of change;
//   - the pattern note: linear, quadratic, exponential — and nothing for
//     sin x (even sampled where Δy = 0) or a cubic (no Δ³ is shown);
//   - Evaluate with the board's named functions, f(a) on the board;
//   - where one function overtakes another (2ˣ vs x³, eˣ vs x¹⁰);
//   - synthetic division and the Remainder Theorem, exact with a fraction a;
//   - copy to a data table; persistence (old documents byte-identical);
//   - reveal keys, describeGraph, the figure table and its exports.
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { FitResult, FittedCurve, ModelSpec } from '../src/core/types'
import { DARK_THEME } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { parseExpression } from '../src/core/parse'
import type { BoardInput, DocMeta, StoredDoc, ValueTableView } from '../src/core/persist'
import { deserializeDoc, docFromBoard, normalizeTableView, serializeDoc } from '../src/core/persist'
import {
  cell,
  divisorA,
  numValue,
  overtake,
  polynomialCoeffs,
  syntheticDivision,
  tablePattern,
  tableXs,
  toNum,
  valueTable,
} from '../src/core/valueTable'
import {
  evaluateTyped,
  parseXList,
  tableDataRows,
  tableFigures,
  tableKeysOf,
  tableOverlays,
  tablePanel,
  tableSentences,
} from '../src/ui/valueTableLinks'
import type { TableContext } from '../src/ui/valueTableLinks'
import { emptyViewStates, patchTableView, pruneViewStates, viewStatesFrom } from '../src/ui/curveViews'
import { REVEAL_OFF, applyReveal, buildInventory, isHidden, revealOne, tableKey } from '../src/ui/reveal'
import type { RevealState, SceneReveal } from '../src/ui/reveal'
import type { BoardScene } from '../src/ui/renderBoard'
import { docFigure, docModelFromJSON, recordFigure } from '../src/ui/docScene'
import { describeBoard } from '../src/ui/boardDescription'
import { toTikz } from '../src/render/vectorTikz'
import { toPgfplots } from '../src/ui/pgfplotsExport'
import { COMMANDS, HELP_SECTIONS } from '../src/ui/commands'

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const models: Record<string, ModelSpec> = { ...MODELS }
let n = 0

function typed(id: string, src: string): FittedCurve {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(src)
  const modelId = `expr_t${++n}`
  models[modelId] = o.plot.makeModel(modelId)
  return {
    id,
    modelId,
    params: o.plot.defaultParams.slice(),
    kind: o.plot.kind,
    domain: o.plot.domain,
    color: '#4f9cf9',
    strokeWidth: 2.5,
    visible: true,
    error: 0,
  }
}

const SRC: Record<string, string> = {
  f: 'y = 2x + 1',
  g: 'y = 3*2^x',
  q: 'y = x^2',
  s: 'y = sin(x)',
  c: 'y = x^3',
  p2: 'y = 2^x',
  h: 'y = x^3 - 2x + 4',
  e: 'y = e^x',
  t: 'y = x^10',
}
const C: Record<string, FittedCurve> = Object.fromEntries(Object.entries(SRC).map(([id, src]) => [id, typed(id, src)]))
const CURVES = Object.values(C)
const LETTERS: Record<string, string> = { f: 'f', g: 'g', q: 'q', s: 's', c: 'c', p2: 'p', h: 'h', e: 'k', t: 't' }
const ctx: TableContext = { curves: CURVES, models, letters: LETTERS, sources: SRC }

const fOf = (c: FittedCurve) => (x: number): number => {
  const spec = models[c.modelId]
  return spec.evalExplicit!(c.params, x)
}

const ys = (id: string, v: ValueTableView = {}): string[] => tablePanel(C[id], v, ctx)!.rows.map((r) => r.y.text)

// ---------------------------------------------------------------------------
// values
// ---------------------------------------------------------------------------

describe('values: exact where exact, decimals elsewhere', () => {
  it('prints integers, short decimals, closed forms and rounded decimals', () => {
    expect(cell(4.375).text).toBe('4.375')
    expect(cell(-0.5).text).toBe('−0.5')
    expect(cell(1 / 3).text).toBe('1/3')
    expect(cell(Math.SQRT2).text).toBe('√2')
    expect(cell(Math.E).exact).toBe(false)
    expect(cell(Math.E).text).toBe('2.718282')
    expect(cell(Number.NaN).text).toBe('undefined')
    // floating residue is the number the table means
    expect(cell(0.1 + 0.2).text).toBe('0.3')
  })

  it('sin x from π/6 by π/6 is ½, √3/2, 1, … exactly', () => {
    expect(ys('s', { start: 'pi/6', step: 'pi/6', n: 6 })).toEqual(['0.5', '√3/2', '1', '√3/2', '0.5', '0'])
    const xs = tablePanel(C.s, { start: 'π/6', step: 'π/6', n: 3 }, ctx)!.rows.map((r) => r.x.text)
    expect(xs).toEqual(['π/6', 'π/3', 'π/2'])
  })

  it('a decimal step lands on the decimals it prints', () => {
    expect(tableXs({ mode: 'step', start: 0, step: 0.1, n: 4 })).toEqual([0, 0.1, 0.2, 0.3])
    expect(ys('q', { start: '0', step: '0.1', n: 4 })).toEqual(['0', '0.01', '0.04', '0.09'])
  })

  it('reads a typed list of x values, and says which entries are not numbers', () => {
    expect(parseXList('−2, −1/2, 0, π, √2').xs.map((x) => cell(x).text)).toEqual(['−2', '−0.5', '0', 'π', '√2'])
    expect(parseXList('1 2 3').xs).toEqual([1, 2, 3])
    const p = tablePanel(C.f, { list: '1, banana, 3' }, ctx)!
    expect(p.error).toContain('“banana”')
  })

  it('values the doubles cannot certify come from the typed formula: tan x at π/2 is undefined', () => {
    const tan = typed('tan', 'y = tan(x)')
    const p = tablePanel(tan, { start: '0', step: 'pi/4', n: 3 }, { ...ctx, curves: [...CURVES, tan] })!
    expect(p.rows.map((r) => r.y.text)).toEqual(['0', '1', 'undefined'])
  })
})

describe('differences and ratios', () => {
  it('Δy, Δ²y, the ratio and the average rate, from the row above', () => {
    const p = tablePanel(C.q, { cols: ['d1', 'd2', 'ratio', 'avg'] }, ctx)!
    expect(p.rows.map((r) => r.d1?.text ?? '')).toEqual(['', '1', '3', '5', '7', '9'])
    expect(p.rows.map((r) => r.d2?.text ?? '')).toEqual(['', '', '2', '2', '2', '2'])
    expect(p.rows.map((r) => r.ratio?.text ?? '')).toEqual(['', 'undefined', '4', '2.25', '16/9', '1.5625'])
    const half = tablePanel(C.q, { step: '0.5', n: 3, cols: ['avg'] }, ctx)!
    expect(half.rows.map((r) => r.avg?.text ?? '')).toEqual(['', '0.5', '1.5'])
  })

  it('3·2ˣ has ratio 2 between every pair of rows', () => {
    const t = valueTable(fOf(C.g), [0, 1, 2, 3])
    expect(t.ratio.map((c) => c.text)).toEqual(['2', '2', '2'])
    expect(t.d1.map((c) => c.text)).toEqual(['3', '6', '12'])
  })
})

describe('the pattern note', () => {
  const note = (id: string, v: ValueTableView = {}): string | null => tablePanel(C[id], v, ctx)!.pattern?.text ?? null
  it('linear, quadratic, exponential', () => {
    expect(note('f')).toBe('Δy is constant (2): linear')
    expect(note('f', { start: '-1', step: '0.5' })).toBe('Δy is constant (1): linear')
    expect(note('q')).toBe('Δ²y is constant (2): quadratic')
    expect(note('q', { step: '2' })).toBe('Δ²y is constant (8): quadratic')
    expect(note('g')).toBe('the ratio is constant (2): exponential')
    expect(note('g', { step: '-1' })).toBe('the ratio is constant (0.5): exponential')
  })
  it('nothing for sin x, a cubic, unequal steps or too few rows', () => {
    expect(note('s')).toBeNull()
    // sin x at 0, π, 2π, 3π: Δy is 0 every time, but sin x is not linear
    expect(tablePanel(C.s, { step: 'pi', n: 4, cols: ['d1'] }, ctx)!.rows.map((r) => r.y.text)).toEqual(['0', '0', '0', '0'])
    expect(note('s', { step: 'pi', n: 4 })).toBeNull()
    expect(note('c')).toBeNull()
    expect(note('h')).toBeNull()
    expect(note('f', { list: '0, 1, 3' })).toBeNull()
    expect(note('f', { n: 2 })).toBeNull()
  })
  it('a quadratic needs two second differences, and checks f itself', () => {
    const t = valueTable(fOf(C.q), [0, 1, 2])
    expect(tablePattern(t, fOf(C.q))).toBeNull()
    // a table that LOOKS quadratic but is not: |x|·x² sampled at 0, 1, 2, 3 is x³ — and a
    // function equal to x² only at the integers is caught between them
    const fake = (x: number): number => x * x + Math.sin(Math.PI * x)
    expect(tablePattern(valueTable(fake, [0, 1, 2, 3, 4]), fake)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Evaluate
// ---------------------------------------------------------------------------

describe('Evaluate (F-IF.2)', () => {
  it('a bare a means f(a) of this curve, at non-integer inputs too', () => {
    const r = evaluateTyped('1.5', C.h, ctx)!
    expect(r.ok && r.text).toBe('h(1.5) = 4.375')
    expect(r.ok && r.point).toEqual({ curveId: 'h', x: 1.5, y: 4.375 })
    const third = evaluateTyped('h(-1/3)', C.h, ctx)!
    expect(third.ok && third.text).toBe('h(−1/3) = 125/27 ≈ 4.62963')
  })
  it('expressions of the named functions', () => {
    const r = evaluateTyped('f(-3) + g(2)', C.f, ctx)!
    expect(r.ok && r.text).toBe('f(−3) + g(2) = 7')
    expect(r.ok && r.point).toBeNull()
    const k = evaluateTyped('2f(1) - q(3)', C.f, ctx)!
    expect(k.ok && k.value.v).toBe(-3)
    const e = evaluateTyped('k(1)', C.e, ctx)!
    expect(e.ok && e.text).toBe('k(1) ≈ 2.718282')
    const sq = evaluateTyped('p(0.5)', C.p2, ctx)!
    expect(sq.ok && sq.text).toBe('p(0.5) = √2 ≈ 1.414214')
    expect(sq.ok && sq.chip).toBe('p(0.5) = √2')
  })
  it('says what is wrong', () => {
    const bad = evaluateTyped('z(2)', C.f, ctx)!
    expect(bad.ok).toBe(false)
    expect(!bad.ok && bad.error).toContain('z is not a function on this board')
    const dep = evaluateTyped('f(x) + 1', C.f, ctx)!
    expect(!dep.ok && dep.error).toContain('depends on x')
  })
  it('the point on the board: a dot, two dashed guides and the value as an answer chip', () => {
    const ov = tableOverlays(CURVES, { h: { ev: 'h(1.5)' } }, ctx)
    expect(ov.map((o) => o.kind)).toEqual(['segment', 'segment', 'dot', 'label'])
    const chip = ov[3]
    expect(chip.kind === 'label' && chip.text).toBe('h(1.5) = 4.375')
    expect(chip.kind === 'label' && chip.answer).toBe(tableKey('h', 'eval'))
    // switched off: nothing
    expect(tableOverlays(CURVES, { h: { ev: 'h(1.5)', dot: false } }, ctx)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Compare and overtake (F-IF.9, F-LE.3)
// ---------------------------------------------------------------------------

describe('compare and overtake', () => {
  it('2ˣ passes x³ after x ≈ 9.94', () => {
    const r = overtake(fOf(C.p2), fOf(C.c), 0)!
    expect(r.leader).toBe('f')
    expect(r.x!).toBeCloseTo(9.9395, 3)
    expect(r.crossings.length).toBe(2)
    expect(r.crossings[0]).toBeCloseTo(1.3734, 3)
    const p = tablePanel(C.p2, { vs: 'c', n: 12 }, ctx)!
    expect(p.compare!.sentence).toBe('2ˣ passes x³ after x ≈ 9.94 and stays ahead for good (an exponential with base > 1 outgrows every power of x)')
    expect(p.compare!.crossings).toBe('They cross at x ≈ 1.37 and x ≈ 9.94.')
    // side by side, with the row where the lead changes marked
    expect(p.rows[10].g!.text).toBe('1000')
    expect(p.rows.filter((r) => r.flip).map((r) => r.x.text)).toEqual(['2', '10'])
  })
  it('eˣ passes x¹⁰ after x ≈ 35.77', () => {
    const r = overtake(fOf(C.e), fOf(C.t), 0)!
    expect(r.leader).toBe('f')
    expect(r.x!).toBeCloseTo(35.7715, 3)
    expect(r.crossings[0]).toBeCloseTo(1.1183, 3)
  })
  it('an exact crossing is stated exactly; one function ahead throughout says so', () => {
    const lin = typed('lin', 'y = x + 2')
    const r = overtake(fOf(C.f), fOf(lin), -5)!
    expect(r.exact?.text).toBe('1')
    const all = tablePanel(C.g, { vs: 'f' }, { ...ctx, curves: [...CURVES] })!
    expect(all.compare!.sentence).toMatch(/^3·2ˣ is above 2x \+ 1 for every x from x = 0 on, and stays ahead for good/)
  })
})

// ---------------------------------------------------------------------------
// Synthetic division (A-APR.2)
// ---------------------------------------------------------------------------

describe('synthetic division and the Remainder Theorem', () => {
  const div = (id: string, a: string) => tablePanel(C[id], { div: a }, ctx)!.division!
  it('x³ − 2x + 4 by (x + 2): remainder 0, a factor', () => {
    const d = div('h', 'x + 2')
    expect(d.coeffs.map((c) => c.text)).toEqual(['1', '0', '−2', '4'])
    expect(d.work!.products.map((c) => c.text)).toEqual(['−2', '4', '−4'])
    expect(d.work!.bottom.map((c) => c.text)).toEqual(['1', '−2', '2', '0'])
    expect(d.work!.quotient.text).toBe('x² − 2x + 2')
    expect(d.work!.statement).toBe('h(−2) = remainder = 0')
    expect(d.work!.verdict).toBe('(x + 2) is a factor of h(x)')
  })
  it('by (x − 1): remainder 3 = h(1), not a factor', () => {
    const d = div('h', '1')
    expect(d.work!.remainder.text).toBe('3')
    expect(d.work!.statement).toBe('h(1) = remainder = 3')
    expect(d.work!.verdict).toBe('(x − 1) is not a factor of h(x)')
    expect(d.work!.identity).toBe('h(x) = \\left(x - 1\\right)\\left(x^{2} + x - 1\\right) + 3')
  })
  it('a fraction a stays exact: h(1/2) = 25/8', () => {
    const d = div('h', '1/2')
    expect(d.work!.bottom.map((c) => c.text)).toEqual(['1', '1/2', '−7/4', '25/8'])
    expect(d.work!.quotient.text).toBe('x² + (1/2)x − 7/4')
    expect(d.work!.divisor.text).toBe('(x − 1/2)')
    const third = syntheticDivision([toNum(3), toNum(-1), toNum(0), toNum(2)], toNum(1 / 3))!
    // 3x³ − x² + 2 at 1/3: 1/9 − 1/9 + 2
    expect(numValue(third.remainder)).toBe(2)
    expect(third.quotient.map((q) => numValue(q))).toEqual([3, 0, 0])
  })
  it('reads a as a number or as the divisor', () => {
    const p = (s: string) => (s === '1/3' ? 1 / 3 : Number(s))
    expect(divisorA('x - 3', p)).toBe(3)
    expect(divisorA('(x+2)', p)).toBe(-2)
    expect(divisorA('x + 1/3', p)).toBeCloseTo(-1 / 3)
    expect(divisorA('-4', p)).toBe(-4)
    expect(divisorA('banana', () => null)).toBeNull()
  })
  it('only a polynomial gets the subsection; its coefficients are found exactly', () => {
    expect(tablePanel(C.s, {}, ctx)!.division).toBeNull()
    expect(tablePanel(C.g, {}, ctx)!.division).toBeNull()
    expect(polynomialCoeffs((x) => x ** 5 / 3 - 2)!.map(numValue)).toEqual([1 / 3, 0, 0, 0, 0, -2])
    expect(tablePanel(C.f, {}, ctx)!.division!.coeffs.map((c) => c.text)).toEqual(['2', '1'])
  })
})

// ---------------------------------------------------------------------------
// Copy to a data table
// ---------------------------------------------------------------------------

describe('copy to a data table', () => {
  it('writes (x, f(x)) rows a data table can read, exact values in the parser’s spelling', () => {
    expect(tableDataRows(tablePanel(C.f, { n: 3 }, ctx)!)).toEqual([
      { x: '0', y: '1' },
      { x: '1', y: '3' },
      { x: '2', y: '5' },
    ])
    const sin = tableDataRows(tablePanel(C.s, { start: 'pi/6', step: 'pi/6', n: 2 }, ctx)!)
    expect(sin).toEqual([
      { x: 'pi/6', y: '0.5' },
      { x: 'pi/3', y: 'sqrt(3)/2' },
    ])
    // undefined rows are left out
    const tan = typed('tan2', 'y = tan(x)')
    expect(tableDataRows(tablePanel(tan, { step: 'pi/2', n: 2 }, ctx)!)).toEqual([{ x: '0', y: '0' }])
  })
})

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const META: DocMeta = { id: 'doc1', name: 'Tables', createdAt: 1000, modifiedAt: 1000 }

function board(over: Partial<BoardInput> = {}): BoardInput {
  return {
    curves: [C.f, C.h],
    styles: {},
    candidates: new Map<string, FitResult[]>(),
    exprSources: { f: SRC.f, h: SRC.h },
    names: { f: 'f', h: 'h' },
    viewport: { center: { x: 0, y: 0 }, pxPerUnit: 60 },
    selectedId: null,
    mode: 'draw',
    ...over,
  }
}
const save = (b: BoardInput): string => serializeDoc(docFromBoard(META, b, 2000))

describe('persistence', () => {
  const FULL: ValueTableView = {
    start: '-2',
    step: 'pi/6',
    n: 8,
    cols: ['d1', 'ratio'],
    ev: 'h(1.5) + f(2)',
    dot: false,
    vs: 'f',
    div: 'x + 1/2',
    fig: true,
  }
  it('round-trips every setting', () => {
    const res = deserializeDoc(save(board({ curveViews: { h: { table: FULL }, f: { table: { list: '0, 1/2, π' } } } })))
    expect(res.problems).toEqual([])
    expect(res.board!.curveViews.h.table).toEqual(FULL)
    expect(res.board!.curveViews.f.table).toEqual({ list: '0, 1/2, π' })
    const vs = viewStatesFrom(res.board!.curveViews, res.board!.curves)
    expect(vs.table.h).toEqual(FULL)
  })
  it('stores only what was set: defaults write nothing, and an old document is byte-identical', () => {
    const before = save(board())
    expect(before).not.toContain('curveViews')
    expect(save(board({ curveViews: { h: { table: {} } } }))).toBe(before)
    expect(save(board({ curveViews: { h: { table: { start: '0', step: '1', n: 6, cols: [] } } } }))).toBe(before)
    const back = deserializeDoc(before).board!
    expect(save(board({ curves: back.curves, curveViews: back.curveViews }))).toBe(before)
    expect(normalizeTableView({ start: '0', n: 6 })).toBeNull()
    const raw = JSON.parse(save(board({ curveViews: { h: { table: { cols: ['ratio', 'd1'] } } } }))) as StoredDoc
    expect(raw.board.curveViews!.h).toEqual({ table: { cols: ['d1', 'ratio'] } })
  })
  it('an unreadable table is dropped and reported, the rest of the entry kept', () => {
    const raw = JSON.parse(save(board({ curveViews: { h: { hlt: 2 } } }))) as StoredDoc
    ;(raw.board.curveViews!.h as Record<string, unknown>).table = 'nonsense'
    const res = deserializeDoc(JSON.stringify(raw))
    expect(res.board!.curveViews.h).toEqual({ hlt: 2 })
    expect(res.degraded).toBe(true)
  })
  it('patching: a default clears a field, an identical value changes nothing, a deleted curve forgets', () => {
    const m0 = patchTableView({}, 'h', { cols: ['d1'] })
    expect(m0).toEqual({ h: { cols: ['d1'] } })
    expect(patchTableView(m0, 'h', { cols: ['d1'] })).toBe(m0)
    expect(patchTableView(m0, 'h', { cols: undefined })).toEqual({})
    expect(patchTableView(m0, 'h', { n: 6 })).toBe(m0)
    const s = { ...emptyViewStates(), table: { h: { fig: true as const } } }
    expect(pruneViewStates(s, new Set(['f'])).table).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// Reveal, words, the figure and its exports
// ---------------------------------------------------------------------------

describe('reveal mode', () => {
  it('a stored table states its answers under its own keys, after the curve’s tools', () => {
    expect(tableKeysOf('h', { ev: 'h(1)', div: '2', vs: 'f' })).toEqual([
      'table:h:values',
      'table:h:eval',
      'table:h:compare',
      'table:h:divide',
    ])
    expect(tableKeysOf('h', undefined)).toEqual([])
    const inv = buildInventory({ curves: [{ id: 'h', points: [], extra: tableKeysOf('h', { ev: 'h(1)' }) }], crossings: [] })
    expect(inv.order).toEqual(['table:h:values', 'table:h:eval'])
  })
  it('the figure table and the evaluated value are "?" until revealed', () => {
    const tables = { h: { ev: 'h(1.5)', fig: true as const } }
    const scene: BoardScene = {
      vp: { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 900, heightPx: 600 },
      theme: DARK_THEME,
      curves: CURVES,
      styles: {},
      models,
      analysis: null,
      overlays: tableOverlays(CURVES, tables, ctx),
      valueTables: tableFigures(CURVES, tables, ctx),
    }
    expect(scene.valueTables![0].rows[1]).toEqual(['1', '3'])
    const keys = tableKeysOf('h', tables)
    const inv = buildInventory({ curves: [], crossings: [], after: keys })
    const r = (s: RevealState): SceneReveal => ({
      hidden: (k) => isHidden(s, k),
      positions: true,
      pointKey: inv.answerKey,
      crossKey: inv.crossKey,
    })
    const ON: RevealState = { ...REVEAL_OFF, on: true }
    const hidden = applyReveal(scene, r(ON))
    expect(hidden.valueTables![0].rows.map((row) => row[1])).toEqual(['?', '?', '?', '?', '?', '?'])
    expect(hidden.valueTables![0].rows.map((row) => row[0])).toEqual(['0', '1', '2', '3', '4', '5'])
    expect(hidden.overlays!.some((o) => o.kind === 'label')).toBe(false)
    expect(hidden.revealMarks!.map((m) => m.key)).toEqual([tableKey('h', 'eval')])
    const shown = applyReveal(scene, r(revealOne(revealOne(ON, tableKey('h', 'values')), tableKey('h', 'eval'))))
    expect(shown.valueTables![0].rows[5]).toEqual(['5', '119'])
    expect(shown.overlays!.some((o) => o.kind === 'label')).toBe(true)
  })
})

describe('in words, on the figure, in the exports', () => {
  const doc = save(
    board({
      curves: [C.f, C.h],
      curveViews: {
        h: { table: { ev: 'h(1.5)', div: 'x + 2', fig: true, cols: ['d1'] } },
        f: { table: { vs: 'h', n: 3 } },
      },
    }),
  )
  const m = docModelFromJSON(doc)!

  it('describeGraph states the tables, and their values only as answers', () => {
    const key = describeBoard(m, { answers: true }).long
    expect(key).toContain('A table of values for h(x) is drawn on the figure, at x = 0, 1, 2, 3, 4, 5.')
    expect(key).toContain('Its values are h(x) = 4, 3, 8, 25, 60, 119.')
    expect(key).toContain('Evaluated: h(1.5) = 4.375.')
    expect(key).toContain('The quotient is x² − 2x + 2 with remainder 0, so h(−2) = remainder = 0 and (x + 2) is a factor of h(x).')
    expect(key).toContain('The functions f and h are compared side by side in the table.')
    const student = describeBoard(m, { answers: false }).long
    expect(student).toContain('A table of values for h(x) is drawn on the figure')
    expect(student).not.toContain('4, 3, 8, 25')
    expect(student).not.toContain('4.375')
  })

  it('a worksheet figure carries the table and the point; the student copy asks', () => {
    const key = docFigure(m, { style: 'textbook', answers: true })
    expect(key.scene.valueTables![0].heads).toEqual(['x', 'h(x)', 'Δy'])
    expect(key.scene.valueTables![0].rows[2]).toEqual(['2', '8', '5'])
    expect(key.scene.overlays!.some((o) => o.kind === 'label' && o.text === 'h(1.5) = 4.375')).toBe(true)
    const student = docFigure(m, { style: 'textbook', answers: false })
    expect(student.scene.valueTables![0].rows[2]).toEqual(['2', '?', '?'])
    expect(student.scene.overlays!.some((o) => o.kind === 'label')).toBe(false)
  })

  it('TikZ draws the table; pgfplots writes it as a tabular', () => {
    const f = docFigure(m, { style: 'ap', answers: true })
    const tikz = toTikz(recordFigure(f))
    expect(tikz).toContain('119')
    const pgf = toPgfplots(f.scene, { sources: f.sources })
    expect(pgf).toContain('\\begin{tabular}{|r|r|r|}')
    expect(pgf).toContain('$119$')
  })

  it('a document with no table settings draws no table', () => {
    const plain = docModelFromJSON(save(board()))!
    expect(docFigure(plain, { style: 'screen', answers: true }).scene.valueTables).toBeUndefined()
  })
})

describe('commands and help', () => {
  it('registers the table commands and lists them under NC Math 1, 2 and 3', () => {
    const ids = ['curve-table', 'curve-evaluate', 'curve-compare', 'curve-remainder']
    for (const id of ids) expect(COMMANDS.some((c) => c.id === id), id).toBe(true)
    const listed = (course: string): Set<string> =>
      new Set(HELP_SECTIONS.filter((s) => s.course === course).flatMap((s) => s.entries.flatMap((e) => ('id' in e ? [e.id] : []))))
    expect([...listed('NC Math 1')]).toEqual(expect.arrayContaining(['curve-table', 'curve-evaluate', 'curve-compare']))
    expect([...listed('NC Math 2')]).toEqual(expect.arrayContaining(['curve-compare']))
    expect([...listed('NC Math 3')]).toEqual(expect.arrayContaining(['curve-remainder', 'curve-compare']))
  })
})

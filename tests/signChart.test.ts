// ============================================================================
// tests/signChart.test.ts — sign charts of f, f′, f″ and the AP statements
// (src/core/signChart.ts); "the graph of f′ is shown"; the link in a file
// (old documents byte-identical); the card (src/ui/signChartLinks.ts); the
// strips on the board, on screen and under the SAT mono look.
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { CURVE_COLORS, DARK_THEME, FIGURE_STYLES } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { parseExpression } from '../src/core/parse'
import { conclusions, signChart } from '../src/core/signChart'
import type { Conclusion, SignChart } from '../src/core/signChart'
import {
  boardToStored,
  calcLinkToStored,
  calcNoun,
  deserializeDoc,
  docFromBoard,
  serializeDoc,
  storedToCalcLink,
} from '../src/core/persist'
import type { BoardInput, CalcLink, DocMeta, SignChartLink } from '../src/core/persist'
import { cardCalc, changeLabel, dependentsOf, linkNoun } from '../src/ui/calcLinks'
import { signChartFigures, signChartRow, signRange } from '../src/ui/signChartLinks'
import { renderBoard, type BoardScene } from '../src/ui/renderBoard'
import { SIGN_ROW_PX, SIGN_TICK_ROW_PX, signBandHeight } from '../src/render/signChart'
import { MockCtx, withMockPath2D } from './mockCanvas'
import { recordScene } from '../src/ui/vectorExport'
import { toSvg } from '../src/render/vectorSvg'
import { toPdfString } from '../src/render/vectorPdf'
import { toTikz } from '../src/render/vectorTikz'

const curve = (modelId: string, params: number[], over: Partial<FittedCurve> = {}): FittedCurve => ({
  id: 'f',
  modelId,
  params,
  kind: 'explicit',
  domain: null,
  color: CURVE_COLORS[0],
  strokeWidth: 2.5,
  visible: true,
  error: 0,
  ...over,
})

function typed(src: string, over: Partial<FittedCurve> = {}): { f: FittedCurve; models: Record<string, ModelSpec> } {
  const out = parseExpression(src)
  if (!out.ok) throw new Error(out.error)
  const spec = out.plot.makeModel('expr_1')
  return { f: curve('expr_1', out.plot.defaultParams.slice(), over), models: { ...MODELS, expr_1: spec } }
}

const R: [number, number] = [-10, 10]
const marks = (c: SignChart | null): string[] => (c ? c.marks.map((m) => `${m.text}:${m.at}`) : [])
const signs = (c: SignChart | null): (number | null)[] => (c ? c.intervals.map((iv) => iv.sign) : [])
const texts = (cs: Conclusion[], kind?: Conclusion['kind']): string[] =>
  cs.filter((c) => !kind || c.kind === kind).map((c) => c.text)

// ---------------------------------------------------------------------------
// The rows
// ---------------------------------------------------------------------------

describe('signChart: x³ − 3x', () => {
  const { f, models } = typed('y = x^3 - 3x')

  it('f′ = 3x² − 3: critical x = ±1, + − +, running off to ±∞', () => {
    const c = signChart(f, models, 'f1', R)!
    expect(marks(c)).toEqual(['−1:zero', '1:zero'])
    expect(signs(c)).toEqual([1, -1, 1])
    expect(c.lo).toBe(-Infinity)
    expect(c.hi).toBe(Infinity)
    expect(c.truncated).toEqual([false, false])
    expect(c.marks.map((m) => m.x)).toEqual([-1, 1])
  })

  it('f″ = 6x: − then + about 0', () => {
    const c = signChart(f, models, 'f2', R)!
    expect(marks(c)).toEqual(['0:zero'])
    expect(signs(c)).toEqual([-1, 1])
  })

  it('f: zeros at −√3, 0, √3', () => {
    expect(marks(signChart(f, models, 'f', R))).toEqual(['−√3:zero', '0:zero', '√3:zero'])
  })

  it('the AP statements, each with its reason', () => {
    const cs = conclusions(f, models, R)
    expect(texts(cs, 'increasing')).toEqual([
      'f is increasing on (−∞, −1) and (1, ∞) because f′(x) > 0 there.',
    ])
    expect(texts(cs, 'decreasing')).toEqual(['f is decreasing on (−1, 1) because f′(x) < 0 there.'])
    expect(texts(cs, 'relmax')).toEqual([
      'f has a relative maximum at x = −1 because f′ changes from positive to negative there.',
    ])
    expect(texts(cs, 'relmin')).toEqual([
      'f has a relative minimum at x = 1 because f′ changes from negative to positive there.',
    ])
    expect(texts(cs, 'concaveDown')).toEqual(['The graph of f is concave down on (−∞, 0) because f″(x) < 0 there.'])
    expect(texts(cs, 'concaveUp')).toEqual(['The graph of f is concave up on (0, ∞) because f″(x) > 0 there.'])
    expect(texts(cs, 'inflection')).toEqual([
      'The graph of f has a point of inflection at x = 0 because f″ changes from negative to positive there.',
    ])
    expect(texts(cs, 'sdt')).toEqual([
      'f′(−1) = 0 and f″(−1) = −6 < 0, so f has a relative maximum at x = −1 by the Second Derivative Test.',
      'f′(1) = 0 and f″(1) = 6 > 0, so f has a relative minimum at x = 1 by the Second Derivative Test.',
    ])
  })

  it('reads the same from the sketched cubic family (symbolic slopes)', () => {
    const g = curve('poly3', [0, -3, 0, 1])
    expect(marks(signChart(g, MODELS, 'f1', R))).toEqual(['−1:zero', '1:zero'])
    expect(marks(signChart(g, MODELS, 'f2', R))).toEqual(['0:zero'])
    const cs = conclusions(g, MODELS, R, { fName: 'g' })
    expect(texts(cs, 'relmax')[0]).toContain('g has a relative maximum at x = −1')
  })

  it('the Candidates Test on [−2, 3]: max 18 at 3, min −2 at −2 and at 1', () => {
    const cs = conclusions(f, models, R, { interval: [-2, 3] })
    expect(texts(cs, 'candidates')).toEqual([
      'Candidates Test on [−2, 3]: f(−2) = −2, f(−1) = 2, f(1) = −2, and f(3) = 18.',
    ])
    expect(texts(cs, 'absmax')).toEqual(['The absolute maximum of f on [−2, 3] is 18, at x = 3.'])
    expect(texts(cs, 'absmin')).toEqual(['The absolute minimum of f on [−2, 3] is −2, at x = −2 and x = 1.'])
    const min = cs.find((c) => c.kind === 'absmin')!
    expect(min.xs).toEqual([-2, 1])
  })

  it('a closed restricted domain runs the Candidates Test by itself', () => {
    const { f: g, models: m } = typed('y = x^3 - 3x', { domain: [-2, 3] })
    const c = signChart(g, m, 'f1', R)!
    expect(c.lo).toBe(-2)
    expect(c.hi).toBe(3)
    expect(c.marks.filter((mm) => mm.end).map((mm) => mm.end)).toEqual(['left', 'right'])
    expect(texts(conclusions(g, m, R), 'absmax')).toEqual(['The absolute maximum of f on [−2, 3] is 18, at x = 3.'])
  })
})

describe('signChart: critical points that are not f′ = 0, and x′s that are not critical', () => {
  it('x^(2/3): the cusp at 0 is a critical point (f′ undefined), a relative minimum', () => {
    const { f, models } = typed('y = x^(2/3)')
    const c = signChart(f, models, 'f1', R)!
    expect(marks(c)).toEqual(['0:und'])
    expect(c.marks[0].why).toBe('cusp')
    expect(c.marks[0].fOk).toBe(true)
    expect(signs(c)).toEqual([-1, 1])
    const cs = conclusions(f, models, R)
    expect(texts(cs, 'relmin')).toEqual([
      'f has a relative minimum at x = 0 because f′ changes from negative to positive there.',
    ])
    // f″ does not exist at 0 either, and the graph is concave down on both sides
    expect(marks(signChart(f, models, 'f2', R))).toEqual(['0:und'])
    expect(texts(cs, 'concaveDown')).toEqual([
      'The graph of f is concave down on (−∞, 0) and (0, ∞) because f″(x) < 0 there.',
    ])
    expect(texts(cs, 'inflection')).toEqual([])
  })

  it('1/x: no critical points; the pole splits the intervals; decreasing on both', () => {
    const { f, models } = typed('y = 1/x')
    const c = signChart(f, models, 'f1', R)!
    expect(marks(c)).toEqual(['0:und'])
    expect(c.marks[0].why).toBe('pole')
    expect(c.marks[0].fOk).toBe(false)
    expect(signs(c)).toEqual([-1, -1])
    const cs = conclusions(f, models, R)
    expect(texts(cs, 'decreasing')).toEqual(['f is decreasing on (−∞, 0) and (0, ∞) because f′(x) < 0 there.'])
    expect(texts(cs, 'increasing')).toEqual([])
    expect(cs.filter((k) => k.kind === 'relmax' || k.kind === 'relmin' || k.kind === 'noext')).toEqual([])
    expect(texts(cs, 'notcritical')).toEqual(['x = 0 is not a critical point: f is not defined there.'])
    // f changes sign across the pole without a zero
    expect(marks(signChart(f, models, 'f', R))).toEqual(['0:und'])
    expect(signs(signChart(f, models, 'f', R))).toEqual([-1, 1])
  })

  it('x·e^(−x): relative maximum at 1, inflection at 2 — out to ±∞ although e^(−x) overflows', () => {
    const { f, models } = typed('y = x e^(-x)')
    const c1 = signChart(f, models, 'f1', R)!
    expect(marks(c1)).toEqual(['1:zero'])
    expect(c1.truncated).toEqual([false, false])
    expect(marks(signChart(f, models, 'f2', R))).toEqual(['2:zero'])
    const cs = conclusions(f, models, R)
    expect(texts(cs, 'relmax')).toEqual([
      'f has a relative maximum at x = 1 because f′ changes from positive to negative there.',
    ])
    expect(texts(cs, 'inflection')).toEqual([
      'The graph of f has a point of inflection at x = 2 because f″ changes from negative to positive there.',
    ])
    expect(texts(cs, 'sdt')[0]).toContain('f″(1) ≈ −0.368 < 0')
  })

  it('exact forms of the critical x′s: ±√3/3 for x³ − x', () => {
    const { f, models } = typed('y = x^3 - x')
    const c = signChart(f, models, 'f1', R)!
    expect(c.marks.map((m) => m.text)).toEqual(['−√3/3', '√3/3'])
    expect(c.marks[1].exact?.tex).toBe('\\frac{\\sqrt{3}}{3}')
    expect(c.marks[1].x).toBeCloseTo(Math.sqrt(3) / 3, 14)
    expect(texts(conclusions(f, models, R), 'increasing')[0]).toBe(
      'f is increasing on (−∞, −√3/3) and (√3/3, ∞) because f′(x) > 0 there.',
    )
  })

  it('√x: the chart starts at the domain end; f′ is undefined there', () => {
    const { f, models } = typed('y = sqrt(x)')
    const c = signChart(f, models, 'f1', R)!
    expect(marks(c)).toEqual(['0:und'])
    expect(c.marks[0].end).toBe('left')
    expect(signs(c)).toEqual([null, 1])
    expect(texts(conclusions(f, models, R), 'increasing')).toEqual(['f is increasing on (0, ∞) because f′(x) > 0 there.'])
  })

  it('x⁴: f″(0) = 0 without a sign change — no inflection, the Second Derivative Test inconclusive', () => {
    const { f, models } = typed('y = x^4')
    const cs = conclusions(f, models, R)
    expect(texts(cs, 'inflection')).toEqual([])
    expect(texts(cs, 'noinflection')).toEqual([
      'The graph of f has no point of inflection at x = 0 because f″ does not change sign there.',
    ])
    expect(texts(cs, 'sdt')).toEqual(['f′(0) = 0 and f″(0) = 0, so the Second Derivative Test is inconclusive at x = 0.'])
    expect(texts(cs, 'relmin')).toHaveLength(1)
  })

  it('sin x: the signs never stop changing, so the chart stops at the window and says so', () => {
    const { f, models } = typed('y = sin(x)')
    const c = signChart(f, models, 'f1', R)!
    expect(c.truncated).toEqual([true, true])
    expect(c.lo).toBe(-10)
    expect(c.marks.map((m) => m.text)).toEqual(['−5π/2', '−3π/2', '−π/2', 'π/2', '3π/2', '5π/2'])
    expect(texts(conclusions(f, models, R), 'window')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// "The graph of f′ is shown"
// ---------------------------------------------------------------------------

describe('treat this graph as f′', () => {
  const { f, models } = typed('y = (x - 1)(x + 2)^2')

  it('has no f row; the f′ row is the graph’s own signs', () => {
    expect(signChart(f, models, 'f', R, 'f1')).toBeNull()
    const c1 = signChart(f, models, 'f1', R, 'f1')!
    expect(marks(c1)).toEqual(['−2:zero', '1:zero'])
    expect(signs(c1)).toEqual([-1, -1, 1])
    const c2 = signChart(f, models, 'f2', R, 'f1')!
    expect(marks(c2)).toEqual(['−2:zero', '0:zero'])
    expect(signs(c2)).toEqual([1, -1, 1])
  })

  it('a relative minimum at 1, NO extremum at −2 (a touch), inflections where the graph turns', () => {
    const cs = conclusions(f, models, R, { as: 'f1' })
    expect(texts(cs, 'relmin')).toEqual([
      'f has a relative minimum at x = 1 because f′ changes from negative to positive there.',
    ])
    expect(texts(cs, 'relmax')).toEqual([])
    expect(texts(cs, 'noext')).toEqual([
      'f has no relative extremum at x = −2 because f′ does not change sign there (it is negative on both sides).',
    ])
    expect(texts(cs, 'inflection')).toEqual([
      'The graph of f has a point of inflection at x = −2 because f′ changes from increasing to decreasing there.',
      'The graph of f has a point of inflection at x = 0 because f′ changes from decreasing to increasing there.',
    ])
    expect(texts(cs, 'concaveUp')).toEqual([
      'The graph of f is concave up on (−∞, −2) and (0, ∞) because f′ is increasing there.',
    ])
    expect(texts(cs, 'increasing')).toEqual(['f is increasing on (1, ∞) because f′(x) > 0 there.'])
  })

  it('the Candidates Test from ∫ f′: where the absolute extrema are', () => {
    const cs = conclusions(f, models, R, { as: 'f1', interval: [-3, 2] })
    // f(x) − f(−3) = ∫ f′: the minimum is at the relative minimum 1
    expect(texts(cs, 'absmin')).toEqual(['The absolute minimum of f on [−3, 2] is at x = 1.'])
    expect(texts(cs, 'absmax')).toEqual(['The absolute maximum of f on [−3, 2] is at x = −3.'])
    expect(texts(cs, 'candidates')[0]).toContain('using f(x) = f(−3) + ∫ from −3 to x of f′(t) dt')
  })

  it('treat as f″: concavity only', () => {
    const { f: g, models: m } = typed('y = x^2 - 1')
    expect(signChart(g, m, 'f1', R, 'f2')).toBeNull()
    const cs = conclusions(g, m, R, { as: 'f2' })
    expect(cs.some((c) => c.kind === 'increasing' || c.kind === 'relmax' || c.kind === 'relmin')).toBe(false)
    expect(texts(cs, 'inflection')).toEqual([
      'The graph of f has a point of inflection at x = −1 because f″ changes from positive to negative there.',
      'The graph of f has a point of inflection at x = 1 because f″ changes from negative to positive there.',
    ])
  })
})

// ---------------------------------------------------------------------------
// The link in a file
// ---------------------------------------------------------------------------

const META: DocMeta = { id: 'doc1', name: 'Signs', createdAt: 1000, modifiedAt: 1000 }

function board(over: Partial<BoardInput> = {}): BoardInput {
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

const LINK: SignChartLink = { kind: 'signchart', id: 'S', parentId: 'f', rows: ['f1'] }

describe('persistence', () => {
  it('writes only what is set: rows always, `as` only when not f, switches only when on', () => {
    expect(calcLinkToStored(LINK)).toEqual({ kind: 'signchart', id: 'S', parentId: 'f', rows: ['f1'] })
    expect(
      calcLinkToStored({ ...LINK, as: 'f1', rows: ['f', 'f2', 'f1'], guides: true, arrows: true, a: 3, b: -2 }),
    ).toEqual({ kind: 'signchart', id: 'S', parentId: 'f', as: 'f1', rows: ['f1', 'f2'], arrows: true, guides: true, a: -2, b: 3 })
    // f″ shown: no arrow row (f′ is unknown)
    expect(calcLinkToStored({ ...LINK, as: 'f2', rows: ['f2'], arrows: true })).toEqual({
      kind: 'signchart', id: 'S', parentId: 'f', as: 'f2', rows: ['f2'],
    })
  })

  it('reads back what it wrote; junk is the default', () => {
    expect(
      storedToCalcLink({ kind: 'signchart', id: 'S', parentId: 'f', rows: ['f1', 'f9', 'f1'], as: 'g', guides: 'yes', a: 1 }),
    ).toEqual(LINK)
    expect(storedToCalcLink({ kind: 'signchart', id: 'S', parentId: 'f' })).toEqual({ ...LINK, rows: [] })
    expect(storedToCalcLink({ kind: 'signchart', id: '', parentId: 'f', rows: [] })).toBeNull()
  })

  it('round-trips through a whole document', () => {
    const { f } = typed('y = x^3 - 3x')
    const links: CalcLink[] = [
      { kind: 'signchart', id: 'S', parentId: 'f', rows: ['f', 'f1', 'f2'], guides: true, cup: true, a: -2, b: 3 },
    ]
    const input = board({ curves: [f], calc: links, exprSources: { f: 'y = x^3 - 3x' } })
    const res = deserializeDoc(serializeDoc(docFromBoard(META, input, 2000)))
    expect(res.board!.calc).toEqual(links)
    expect(res.degraded).toBe(false)
  })

  it('leaves a document written before sign charts existed byte-identical', () => {
    const f = curve('poly2', [-1, 0, 1])
    const t = curve('line', [0, 1], { id: 't' })
    const old = board({
      curves: [f, t],
      calc: [
        { kind: 'area', id: 'R', parentId: 'f', from: 0, to: 2, abs: false },
        { kind: 'limit', id: 'L', parentId: 'f', a: 1 },
        { kind: 'tangent', id: 'T', parentId: 'f', curveId: 't', x: 1 },
      ],
    })
    const text = serializeDoc(docFromBoard(META, old, 2000))
    expect(text).toContain(
      '"calc":[{"kind":"area","id":"R","parentId":"f","from":0,"to":2},' +
        '{"kind":"limit","id":"L","parentId":"f","a":1},' +
        '{"kind":"tangent","id":"T","parentId":"f","curveId":"t","x":1}]',
    )
    for (const k of ['signchart', '"rows"', '"as"', '"guides"', '"cup"', '"arrows"']) expect(text).not.toContain(k)
    const round = serializeDoc(docFromBoard(META, deserializeDoc(text).board as never, 2000))
    expect(round).toBe(text)
  })

  it('dies with its parent (and says so in words on load)', () => {
    expect(dependentsOf([LINK], ['f']).linkIds.has('S')).toBe(true)
    expect(dependentsOf([LINK], ['g']).linkIds.size).toBe(0)
    const g = curve('poly2', [0, 0, 1], { id: 'g' })
    const stored = boardToStored(board({ curves: [g], calc: [{ ...LINK, parentId: 'gone' }] }))
    const raw = { version: 2, id: 'd', name: 'n', createdAt: 1, modifiedAt: 1, board: { ...stored } }
    const res = deserializeDoc(JSON.stringify(raw))
    expect(res.board!.calc).toEqual([])
    expect(res.problems.join(' ')).toContain('sign chart')
    expect(calcNoun('signchart')).toBe('sign chart')
    expect(linkNoun('signchart')).toBe('sign chart')
    expect(changeLabel({ kind: 'signAs', linkId: 'S', as: 'f1' })).toBe('change what the graph is')
  })
})

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

describe('the card', () => {
  it('rows, the small chart, the statements and the plain text to copy', () => {
    const { f, models } = typed('y = x^3 - 3x')
    const row = signChartRow({ ...LINK, rows: ['f1', 'f2'], arrows: true }, f, models, 'f', '', R)
    expect(row.problem).toBeNull()
    expect(row.available).toEqual(['f', 'f1', 'f2'])
    expect(row.chart.map((r) => r.label)).toEqual(['f′', 'f', 'f″'])
    expect(row.chart[0].cells).toEqual([
      { kind: 'sign', text: '+', sign: 1 },
      { kind: 'mark', x: '−1', at: '0' },
      { kind: 'sign', text: '−', sign: -1 },
      { kind: 'mark', x: '1', at: '0' },
      { kind: 'sign', text: '+', sign: 1 },
    ])
    expect(row.chart[1].cells.filter((c) => c.kind === 'sign').map((c) => (c as { text: string }).text)).toEqual([
      '↗',
      '↘',
      '↗',
    ])
    expect(row.plain).toContain('f′:  +  [−1: 0]  −  [1: 0]  +')
    expect(row.plain).toContain('f has a relative maximum at x = −1')
  })

  it('as f′: no f row offered; the title says what the graph is', () => {
    const { f, models } = typed('y = (x - 1)(x + 2)^2')
    const row = signChartRow({ ...LINK, as: 'f1', rows: ['f', 'f1'] }, f, models, 'f', '', R)
    expect(row.available).toEqual(['f1', 'f2'])
    expect(row.rows).toEqual(['f1'])
    expect(row.title).toBe('This graph is f′')
  })

  it('cardCalc puts the chart on its parent′s card', () => {
    const { f, models } = typed('y = x^3 - 3x')
    const cards = cardCalc([LINK], [f], models, () => 'f', { f: 'g' })
    expect(cards.f.signs).toHaveLength(1)
    expect(cards.f.signs[0].fName).toBe('g')
    expect(cards.f.order).toEqual(['S'])
  })

  it('a missing parent is a problem, not a crash', () => {
    const row = signChartRow(LINK, undefined, MODELS)
    expect(row.problem).toBe('the curve it was drawn for is gone')
  })

  it('signRange: the view joined with [−10, 10]', () => {
    expect(signRange([-4, 4])).toEqual([-10, 10])
    expect(signRange([-40, 4])).toEqual([-40, 10])
    expect(signRange(null)).toEqual([-10, 10])
  })
})

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

const VP = { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 900, heightPx: 700 }
const sxOf = (x: number): number => VP.widthPx / 2 + x * VP.pxPerUnit

function paint(over: Partial<BoardScene>, models: Record<string, ModelSpec>, f: FittedCurve): MockCtx {
  const ctx = new MockCtx()
  const scene: BoardScene = {
    vp: VP,
    theme: DARK_THEME,
    curves: [f],
    styles: {},
    models,
    chrome: null,
    ...over,
  }
  withMockPath2D(() => renderBoard(ctx as unknown as CanvasRenderingContext2D, scene))
  return ctx
}

describe('the strips', () => {
  const { f, models } = typed('y = x^3 - 3x')
  const figs = signChartFigures([{ ...LINK, rows: ['f', 'f1', 'f2'], guides: true }], [f], models, { f: 'f' }, {}, R)

  it('one figure: three strips, the x′s under them in exact form, guides on', () => {
    expect(figs).toHaveLength(1)
    expect(figs[0].rows.map((r) => r.label)).toEqual(['f', 'f′', 'f″'])
    expect(figs[0].ticks.map((t) => t.text)).toEqual(['−√3', '−1', '0', '1', '√3'])
    expect(figs[0].guides).toBe(true)
    expect(signBandHeight(figs)).toBe(3 * SIGN_ROW_PX + SIGN_TICK_ROW_PX + 10)
    expect(signBandHeight(figs, { type: 2 })).toBe(2 * (3 * SIGN_ROW_PX + SIGN_TICK_ROW_PX + 10))
  })

  it('a hidden parent draws nothing', () => {
    expect(signChartFigures([LINK], [{ ...f, visible: false }], models, {}, {}, R)).toEqual([])
  })

  it('on screen: labels, + and − in colour, 0 at the ticks, x′s centred under the board x', () => {
    const ctx = paint({ signCharts: figs }, models, f)
    const t = ctx.texts.map((d) => d.text)
    expect(t).toEqual(expect.arrayContaining(['f', 'f′', 'f″', '+', '−', '0', '−1', '1', '√3']))
    const one = ctx.texts.find((d) => d.text === '1' && Math.abs(d.x - sxOf(1)) < 1)
    expect(one).toBeTruthy()
    // the band's backing is the ground, at the bottom of the board
    const band = signBandHeight(figs)
    expect(ctx.fills.some((r) => r.style === DARK_THEME.bg && Math.abs(r.y - (VP.heightPx - band)) < 1e-6)).toBe(true)
    expect(ctx.fillStyles).toContain(CURVE_COLORS[2])
    expect(ctx.fillStyles).toContain(CURVE_COLORS[1])
  })

  it('SAT: every strip in the one mono ink — no curve colour, no green or red', () => {
    const sat = FIGURE_STYLES.sat
    const ctx = paint({ signCharts: figs, figure: sat }, models, f)
    const signTexts = ctx.texts.filter((d) => ['+', '−', 'f′', 'f″', '−1', '0'].includes(d.text))
    expect(signTexts.length).toBeGreaterThan(5)
    for (const c of [CURVE_COLORS[0], CURVE_COLORS[1], CURVE_COLORS[2]]) {
      expect(ctx.strokeStyles).not.toContain(c)
      expect(ctx.fillStyles).not.toContain(c)
    }
    expect(ctx.fills.some((r) => r.style === sat.theme.bg && r.y > VP.heightPx / 2)).toBe(true)
  })

  it('und on a pole, and a board with no sign chart paints exactly what it did', () => {
    const { f: g, models: m } = typed('y = 1/x')
    const figs2 = signChartFigures([LINK], [g], m, {}, {}, R)
    const ctx = paint({ signCharts: figs2 }, m, g)
    expect(ctx.texts.map((d) => d.text)).toContain('und')
    const a = paint({}, models, f)
    const b = paint({ signCharts: [] }, models, f)
    expect(b.texts.length).toBe(a.texts.length)
    expect(b.strokeCount).toBe(a.strokeCount)
    expect(b.fills.length).toBe(a.fills.length)
  })
})

describe('the strips in the vector exports', () => {
  it('SVG, PDF and TikZ carry the strips: labels, signs, exact x′s, the arrows as paths', () => {
    const { f, models } = typed('y = x^3 - 3x')
    const figs = signChartFigures(
      [{ ...LINK, rows: ['f1', 'f2'], arrows: true, cup: true, guides: true }],
      [f],
      models,
      { f: 'f' },
      {},
      R,
    )
    const scene: BoardScene = {
      vp: VP,
      theme: FIGURE_STYLES.sat.theme,
      figure: FIGURE_STYLES.sat,
      curves: [f],
      styles: {},
      models,
      signCharts: figs,
      chrome: null,
    }
    const list = recordScene(scene, 16)
    const svg = toSvg(list)
    for (const t of ['f′', 'f″', '−1', '0', '1', 'und'].slice(0, 5)) expect(svg).toContain(`>${t}<`)
    expect(svg).toContain('>+<')
    expect(svg).toContain('>−<')
    // mono: no curve colour anywhere in the file
    expect(svg.toLowerCase()).not.toContain(CURVE_COLORS[0].toLowerCase())
    expect(svg.toLowerCase()).not.toContain(CURVE_COLORS[2].toLowerCase())
    expect(toPdfString(list).length).toBeGreaterThan(1000)
    expect(toTikz(list)).toContain("{$f''$}")
  })
})

// ============================================================================
// tests/limitLinks.test.ts — the limit as a board object: the link in a file
// (±∞ as a string sentinel, old documents byte-identical), what dies with its
// parent, where a fresh one opens and what a dragged a snaps to, what the card
// says (the limit, both sides, why, f(a), the classification, the checklist,
// the table, ε–δ) and what it draws — on screen and in the SAT figure.
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { CURVE_COLORS, DARK_THEME, FIGURE_STYLES } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { parseExpression } from '../src/core/parse'
import {
  LIMIT_INF,
  LIMIT_NEG_INF,
  boardToStored,
  calcLinkToStored,
  calcNoun,
  deserializeDoc,
  docFromBoard,
  serializeDoc,
  storedToCalcLink,
} from '../src/core/persist'
import type { BoardInput, CalcLink, DocMeta, LimitLink } from '../src/core/persist'
import { cardCalc, changeLabel, dependentsOf, linkNoun, overlaysFor } from '../src/ui/calcLinks'
import {
  DELTA_BAND_ALPHA,
  EPS_BAND_ALPHA,
  defaultLimitA,
  deltaTint,
  limitOverlays,
  limitRow,
  limitSnapPoints,
  snapLimitA,
} from '../src/ui/limitLinks'
import { renderBoard, type BoardScene, type Overlay } from '../src/ui/renderBoard'
import { hasOverlayMarks } from '../src/render/overlays'
import { MockCtx, MockPath2D, withMockPath2D, type Cmd } from './mockCanvas'

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
  return {
    f: curve('expr_1', out.plot.defaultParams.slice(), over),
    models: { ...MODELS, expr_1: spec },
  }
}

const META: DocMeta = { id: 'doc1', name: 'Limits', createdAt: 1000, modifiedAt: 1000 }

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

const LINK: LimitLink = { kind: 'limit', id: 'L', parentId: 'f', a: 3 }
const kinds = (ovs: readonly Overlay[]): string[] => ovs.map((o) => o.kind)

// ===========================================================================
// The file
// ===========================================================================

describe('the limit link in a file', () => {
  it('writes a, and side / table / epsilon / eps only when they say something', () => {
    expect(calcLinkToStored(LINK)).toEqual({ kind: 'limit', id: 'L', parentId: 'f', a: 3 })
    expect(Object.keys(calcLinkToStored({ ...LINK, side: 'both' }))).toEqual(['kind', 'id', 'parentId', 'a'])
    expect(calcLinkToStored({ ...LINK, side: 'left', table: true, epsilon: true, eps: 0.25 })).toEqual({
      kind: 'limit', id: 'L', parentId: 'f', a: 3, side: 'left', table: true, epsilon: true, eps: 0.25,
    })
    // ε at its default, or with the picture off, is not written
    expect(calcLinkToStored({ ...LINK, epsilon: true, eps: 0.5 })).toEqual({
      kind: 'limit', id: 'L', parentId: 'f', a: 3, epsilon: true,
    })
    expect(calcLinkToStored({ ...LINK, eps: 0.25 })).toEqual({ kind: 'limit', id: 'L', parentId: 'f', a: 3 })
  })

  it('±∞ travels as the string sentinel — JSON has no Infinity', () => {
    expect(calcLinkToStored({ ...LINK, a: Infinity })).toEqual({ kind: 'limit', id: 'L', parentId: 'f', a: LIMIT_INF })
    expect(calcLinkToStored({ ...LINK, a: -Infinity }).a).toBe(LIMIT_NEG_INF)
    expect(LIMIT_INF).toBe('inf')
    expect(LIMIT_NEG_INF).toBe('-inf')
    expect(storedToCalcLink({ kind: 'limit', id: 'L', parentId: 'f', a: 'inf' })).toEqual({ ...LINK, a: Infinity })
    expect(storedToCalcLink({ kind: 'limit', id: 'L', parentId: 'f', a: '-inf' })).toEqual({ ...LINK, a: -Infinity })
    // a one-sided limit at ∞ is just the limit at ∞
    expect(calcLinkToStored({ ...LINK, a: Infinity, side: 'left' })).toEqual({
      kind: 'limit', id: 'L', parentId: 'f', a: 'inf',
    })
  })

  it('reads back what it wrote; junk options are defaults', () => {
    expect(
      storedToCalcLink({ kind: 'limit', id: 'L', parentId: 'f', a: 3, side: 'up', table: 'yes', epsilon: 1, eps: 2 }),
    ).toEqual(LINK)
    expect(storedToCalcLink({ kind: 'limit', id: 'L', parentId: 'f', a: 0, side: 'right', epsilon: true, eps: -1 })).toEqual({
      ...LINK, a: 0, side: 'right', epsilon: true,
    })
  })

  it('refuses a limit without a usable a', () => {
    expect(storedToCalcLink({ kind: 'limit', id: 'L', parentId: 'f' })).toBeNull()
    expect(storedToCalcLink({ kind: 'limit', id: 'L', parentId: 'f', a: null })).toBeNull()
    expect(storedToCalcLink({ kind: 'limit', id: 'L', parentId: 'f', a: 'Infinity' })).toBeNull()
    expect(storedToCalcLink({ kind: 'limit', id: 'L', parentId: 'f', a: Infinity })).toBeNull()
    expect(storedToCalcLink({ kind: 'limit', id: '', parentId: 'f', a: 1 })).toBeNull()
  })

  it('round-trips through a whole document, ∞ and all', () => {
    const { f } = typed('y = (2x^2+1)/(x^2-3)')
    const links: CalcLink[] = [
      { ...LINK, a: Infinity },
      { kind: 'limit', id: 'M', parentId: 'f', a: -Infinity, table: true },
      { kind: 'limit', id: 'N', parentId: 'f', a: Math.PI / 2, side: 'right', epsilon: true, eps: 0.1 },
    ]
    const input = board({ curves: [f], calc: links, exprSources: { f: 'y = (2x^2+1)/(x^2-3)' } })
    const text = serializeDoc(docFromBoard(META, input, 2000))
    expect(text).toContain('"a":"inf"')
    expect(text).toContain('"a":"-inf"')
    expect(text).not.toContain('"a":null')
    const res = deserializeDoc(text)
    expect(res.board!.calc).toEqual(links)
    expect(res.degraded).toBe(false)
  })

  it('leaves a document written before limits existed byte-identical', () => {
    const f = curve('poly2', [-1, 0, 1])
    const t = curve('line', [0, 1], { id: 't' })
    const old = board({
      curves: [f, t],
      calc: [
        { kind: 'area', id: 'R', parentId: 'f', from: 0, to: 2, abs: false },
        { kind: 'secant', id: 'S', parentId: 'f', a: 1, b: 3 },
        { kind: 'tangent', id: 'T', parentId: 'f', curveId: 't', x: 1 },
      ],
    })
    const text = serializeDoc(docFromBoard(META, old, 2000))
    expect(text).toContain(
      '"calc":[{"kind":"area","id":"R","parentId":"f","from":0,"to":2},' +
        '{"kind":"secant","id":"S","parentId":"f","a":1,"b":3},' +
        '{"kind":"tangent","id":"T","parentId":"f","curveId":"t","x":1}]',
    )
    for (const k of ['limit', '"side"', '"table"', '"epsilon"', '"eps"', '"inf"']) expect(text).not.toContain(k)
    const round = serializeDoc(docFromBoard(META, deserializeDoc(text).board as never, 2000))
    expect(round).toBe(text)
  })

  it('a lost parent drops the link, and says so in words', () => {
    const g = curve('poly2', [0, 0, 1], { id: 'g' })
    const stored = boardToStored(board({ curves: [g], calc: [{ ...LINK, parentId: 'gone' }] }))
    const raw = { version: 2, id: 'd', name: 'n', createdAt: 1, modifiedAt: 1, board: { ...stored } }
    const res = deserializeDoc(JSON.stringify(raw))
    expect(res.board!.calc).toEqual([])
    expect(res.degraded).toBe(true)
    expect(res.problems.join(' ')).toContain('limit')
    expect(calcNoun('limit')).toBe('limit')
  })
})

describe('dependents and undo labels', () => {
  it('deleting f takes the limit, and no curve with it', () => {
    const d = dependentsOf([LINK], ['f'])
    expect([...d.linkIds]).toEqual(['L'])
    expect([...d.curveIds]).toEqual(['f'])
    expect([...dependentsOf([LINK], ['g']).linkIds]).toEqual([])
    expect(linkNoun('limit')).toBe('limit')
  })

  it('every change has an undo label in words', () => {
    expect(changeLabel({ kind: 'limitA', linkId: 'L', a: 1 })).toBe('move limit point')
    expect(changeLabel({ kind: 'limitSide', linkId: 'L', side: 'left' })).toBe('change limit side')
    expect(changeLabel({ kind: 'limitTable', linkId: 'L', on: true })).toBe('switch table of values')
    expect(changeLabel({ kind: 'limitEpsilon', linkId: 'L', on: true })).toBe('switch ε–δ')
    expect(changeLabel({ kind: 'limitEps', linkId: 'L', eps: 0.3 })).toBe('change ε')
  })
})

// ===========================================================================
// Where a fresh one opens, and what a drag snaps to
// ===========================================================================

describe('defaultLimitA and snapping', () => {
  it('the interesting point in view first: the hole of (x² − 9)/(x − 3)', () => {
    const { f, models } = typed('y = (x^2-9)/(x-3)')
    expect(defaultLimitA(f, models, [-10, 10])).toBe(3)
  })

  it('the one nearest the middle: tan x opens at ±π/2, 1/x at its pole', () => {
    const t = typed('y = 1/(x-1)')
    expect(defaultLimitA(t.f, t.models, [-10, 10])).toBe(1)
    const tan = typed('y = tan(x)')
    expect(Math.abs(defaultLimitA(tan.f, tan.models, [-10, 10]) as number)).toBeCloseTo(Math.PI / 2, 9)
  })

  it('else 0 when f lives there; else the middle of the view', () => {
    const { f, models } = typed('y = x^2')
    expect(defaultLimitA(f, models, [-10, 10])).toBe(0)
    expect(defaultLimitA(f, models, [3, 11])).toBe(7)
    const nope = curve('poly2', [0, 0, 1], { kind: 'polar' })
    expect(defaultLimitA(nope, { ...MODELS, poly2: { ...MODELS.poly2, kind: 'polar' } }, [-5, 5])).toBeNull()
  })

  it('a dragged a snaps to a hole within reach, else to the nice number', () => {
    const { f, models } = typed('y = (x^2-9)/(x-3)')
    const pts = limitSnapPoints(f, models, [-10, 10])
    expect(pts.map((p) => p.x)).toEqual([3])
    const nice = (x: number): number => Math.round(x * 10) / 10
    expect(snapLimitA(2.9, pts, 60, nice)).toBe(3) // 6 px away
    expect(snapLimitA(2.7, pts, 60, nice)).toBe(2.7) // 18 px away
  })
})

// ===========================================================================
// The card
// ===========================================================================

describe('the card', () => {
  it('(x² − 9)/(x − 3) at 3: the limit, both sides, f(3), a hole, the checklist', () => {
    const { f, models } = typed('y = (x^2-9)/(x-3)')
    const row = limitRow(LINK, f, models)
    expect(row.title).toBe('Limit of f at x = 3')
    expect(row.head.text).toBe('lim x → 3 f(x) = 6')
    expect(row.head.tex).toContain('\\lim_{x \\to 3} f(x) = 6')
    expect(row.sides!.text).toBe('lim x → 3⁻ f(x) = 6,  lim x → 3⁺ f(x) = 6')
    expect(row.sides!.tex).toContain('x \\to {3}^{-}')
    expect(row.fa).toBe('f(3) is undefined')
    expect(row.klass).toBe('Removable discontinuity (a hole) at (3, 6)')
    expect(row.checklist!.map((c) => c.ok)).toEqual([false, true, false])
    expect(row.checklist![0].text).toBe('f(3) is not defined')
    expect(row.verdict).toBe('Condition 1 fails, so f is not continuous at x = 3.')
    expect(row.why).toBeNull()
  })

  it('floor(x) at 2: the sides differ, and the card says so', () => {
    const { f, models } = typed('y = floor(x)')
    const row = limitRow({ ...LINK, a: 2 }, f, models)
    expect(row.head.text).toBe('lim x → 2 f(x) does not exist')
    expect(row.head.tex).toContain('\\text{ does not exist}')
    expect(row.why).toBe('The left-hand limit (1) and the right-hand limit (2) are not equal, so the limit does not exist.')
    expect(row.fa).toBe('f(2) = 2')
    expect(row.klass).toBe('Jump discontinuity at x = 2: the graph jumps from 1 to 2')
    expect(row.verdict).toBe('Condition 2 fails, so f is not continuous at x = 2.')
    // one side asked for: the head is that side
    const left = limitRow({ ...LINK, a: 2, side: 'left' }, f, models)
    expect(left.title).toBe('Left-hand limit of f at x = 2')
    expect(left.head.text).toBe('lim x → 2⁻ f(x) = 1')
  })

  it('1/x at 0, sin(1/x) at 0, √x at 0 — each failure in words', () => {
    const r = typed('y = 1/x')
    const inv = limitRow({ ...LINK, a: 0 }, r.f, r.models)
    expect(inv.sides!.text).toBe('lim x → 0⁻ f(x) = −∞,  lim x → 0⁺ f(x) = ∞')
    expect(inv.why).toContain('vertical asymptote')
    expect(inv.klass).toBe('Infinite discontinuity: x = 0 is a vertical asymptote')
    const s = typed('y = sin(1/x)')
    const osc = limitRow({ ...LINK, a: 0 }, s.f, s.models)
    expect(osc.why).toContain('oscillates')
    expect(osc.klass).toBe('Oscillating discontinuity at x = 0')
    const q = typed('y = sqrt(x)')
    const end = limitRow({ ...LINK, a: 0 }, q.f, q.models)
    expect(end.why).toBe(
      'f is not defined to the left of 0, so only the right-hand limit can exist: lim x→0⁺ f(x) = 0.',
    )
    expect(end.klass).toBe('x = 0 is an endpoint of the domain of f')
    expect(end.verdict).toBe('So f is continuous from the right at x = 0, an endpoint of its domain.')
    const sq = typed('y = 1/x^2')
    const up = limitRow({ ...LINK, a: 0 }, sq.f, sq.models)
    expect(up.head.text).toBe('lim x → 0 f(x) = ∞')
    expect(up.head.tex).toContain('= \\infty')
  })

  it('at ∞: the asymptote in words, no f(a), no checklist', () => {
    const { f, models } = typed('y = (2x^2+1)/(x^2-3)')
    const row = limitRow({ ...LINK, a: Infinity, table: true }, f, models)
    expect(row.aText).toBe('∞')
    expect(row.infinity).toBe(1)
    expect(row.title).toBe('Limit of f as x → ∞')
    expect(row.head.text).toBe('lim x → ∞ f(x) = 2')
    expect(row.head.tex).toContain('x \\to \\infty')
    expect(row.why).toBe('y = 2 is a horizontal asymptote as x → ∞.')
    expect(row.fa).toBeNull()
    expect(row.checklist).toBeNull()
    expect(row.columns!.map((c) => c.title)).toEqual(['x → ∞'])
    expect(row.columns![0].rows.map((r) => r.x)).toEqual(['10', '100', '1000', '10000', '100000'])
  })

  it('the table: two compact columns, x → a⁻ and x → a⁺', () => {
    const { f, models } = typed('y = (x^2-9)/(x-3)')
    const row = limitRow({ ...LINK, table: true }, f, models)
    expect(row.columns!.map((c) => c.title)).toEqual(['x → 3⁻', 'x → 3⁺'])
    expect(row.columns![0].rows[3]).toEqual({ x: '2.9999', y: '5.9999' })
    expect(row.columns![1].rows[0]).toEqual({ x: '3.1', y: '6.1' })
    expect(limitRow(LINK, f, models).columns).toBeNull()
  })

  it('ε–δ: δ for x² at 2, and why there is none without a finite L', () => {
    const { f, models } = typed('y = x^2')
    const row = limitRow({ ...LINK, a: 2, epsilon: true }, f, models)
    expect(row.eps).toBe(0.5)
    expect(row.delta!.value).toBeCloseTo(Math.sqrt(4.5) - 2, 9)
    expect(row.delta!.text).toBe('δ ≈ 0.1213: whenever 0 < |x − 2| < 0.1213, |f(x) − 4| < 0.5.')
    const r = typed('y = 1/x')
    expect(limitRow({ ...LINK, a: 0, epsilon: true }, r.f, r.models).delta!.text).toBe(
      'The ε–δ picture needs a finite limit L.',
    )
  })

  it('refusals in words', () => {
    const { models } = typed('y = x')
    expect(limitRow(LINK, undefined, models).problem).toBe('the curve it was taken on is gone')
  })

  it('cardCalc hands the row to the parent, named by its letter', () => {
    const { f, models } = typed('y = (x^2-9)/(x-3)')
    const cards = cardCalc([LINK], [f], models, () => 'f', { f: 'g' })
    expect(cards.f.limits).toHaveLength(1)
    expect(cards.f.limits[0].head.text).toBe('lim x → 3 g(x) = 6')
    expect(cardCalc([], [f], models, () => 'f').f.limits).toEqual([])
  })
})

// ===========================================================================
// The figure
// ===========================================================================

describe('limitOverlays', () => {
  it('a hole: the guide, an arrow from each side, the ring at (3, 6) — no dot', () => {
    const { f, models } = typed('y = (x^2-9)/(x-3)')
    const ovs = limitOverlays([LINK], [f], models)
    expect(kinds(ovs)).toEqual(['segment', 'approach', 'approach', 'dot'])
    const ring = ovs[3] as Extract<Overlay, { kind: 'dot' }>
    expect(ring.at).toEqual({ x: 3, y: 6 })
    expect(ring.hollow).toBe(true)
    const guide = ovs[0] as Extract<Overlay, { kind: 'segment' }>
    expect(guide.dashed).toBe(true)
    expect(guide.from.x).toBe(3)
    expect(guide.to.x).toBe(3)
  })

  it('a jump: a ring at the side f(a) is not, a dot at f(a); one side only on request', () => {
    const { f, models } = typed('y = floor(x)')
    const ovs = limitOverlays([{ ...LINK, a: 2 }], [f], models)
    const dots = ovs.filter((o): o is Extract<Overlay, { kind: 'dot' }> => o.kind === 'dot')
    expect(dots.map((d) => [d.at.y, d.hollow === true])).toEqual([
      [1, true],
      [2, false],
    ])
    const left = limitOverlays([{ ...LINK, a: 2, side: 'left' }], [f], models)
    const arrows = left.filter((o): o is Extract<Overlay, { kind: 'approach' }> => o.kind === 'approach')
    expect(arrows.map((a) => a.side)).toEqual([-1])
    expect(arrows[0].reach).toBeCloseTo(1, 6)
  })

  it('infinite sides run up and down the asymptote', () => {
    const { f, models } = typed('y = 1/x')
    const ovs = limitOverlays([{ ...LINK, a: 0 }], [f], models)
    const arrows = ovs.filter((o): o is Extract<Overlay, { kind: 'approach' }> => o.kind === 'approach')
    expect(arrows.map((a) => [a.side, a.run])).toEqual([
      [-1, -1],
      [1, 1],
    ])
    expect(ovs.some((o) => o.kind === 'dot')).toBe(false)
  })

  it('at ∞: the asymptote y = L dashed and arrows to the edge; no guide', () => {
    const { f, models } = typed('y = (2x^2+1)/(x^2-3)')
    const ovs = limitOverlays([{ ...LINK, a: Infinity }], [f], models)
    expect(kinds(ovs)).toEqual(['hline', 'approach'])
    expect((ovs[0] as Extract<Overlay, { kind: 'hline' }>).y).toBe(2)
    expect((ovs[1] as Extract<Overlay, { kind: 'approach' }>).a).toBe(Infinity)
  })

  it('ε–δ: two bands under the curves, the box and two chips on them', () => {
    const { f, models } = typed('y = x^2')
    const ovs = limitOverlays([{ ...LINK, a: 2, epsilon: true }], [f], models)
    const regions = ovs.filter((o): o is Extract<Overlay, { kind: 'region' }> => o.kind === 'region')
    expect(regions).toHaveLength(2)
    expect(regions[0].alpha).toBe(EPS_BAND_ALPHA)
    expect(regions[0].color).toBe(CURVE_COLORS[0])
    expect(regions[0].boundary.map((p) => p.y)).toEqual([3.5, 3.5, 4.5, 4.5])
    expect(regions[1].alpha).toBe(DELTA_BAND_ALPHA)
    expect(regions[1].color).toBe(deltaTint(CURVE_COLORS[0]))
    const d = Math.sqrt(4.5) - 2
    expect(regions[1].boundary[0].x).toBeCloseTo(2 - d, 9)
    expect(regions[1].boundary[1].x).toBeCloseTo(2 + d, 9)
    const chips = ovs.filter((o): o is Extract<Overlay, { kind: 'label' }> => o.kind === 'label')
    expect(chips.map((c) => c.text)).toEqual(['δ ≈ 0.1213', 'ε = 0.5'])
    // the fills come first, so they wash UNDER the curve
    expect(ovs[0].kind).toBe('region')
    expect(ovs[1].kind).toBe('region')
  })

  it('a hidden or missing parent draws nothing; overlaysFor carries them as marks', () => {
    const { f, models } = typed('y = x^2')
    expect(limitOverlays([LINK], [{ ...f, visible: false }], models)).toEqual([])
    expect(limitOverlays([{ ...LINK, parentId: 'gone' }], [f], models)).toEqual([])
    const ovs = overlaysFor([LINK], [f], models)
    expect(kinds(ovs)).toContain('approach')
    expect(hasOverlayMarks(ovs)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Painting, on screen and in the SAT figure
// ---------------------------------------------------------------------------

const VP = { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 900, heightPx: 700 }
const sxOf = (x: number): number => VP.widthPx / 2 + x * VP.pxPerUnit
const syOf = (y: number): number => VP.heightPx / 2 - y * VP.pxPerUnit

interface Op {
  op: 'fill' | 'stroke' | 'text'
  style: string
  alpha: number
  pts: Cmd[]
  dash: number[]
  text?: string
}

class LogCtx extends MockCtx {
  log: Op[] = []
  private mark = 0
  private dashNow: number[] = []
  override setLineDash(d: number[]): void {
    this.dashNow = d.slice()
    super.setLineDash?.(d)
  }
  private note(op: 'fill' | 'stroke', style: string): void {
    const pts = this.own.cmds.slice(this.mark) as Cmd[]
    this.mark = this.own.cmds.length
    this.log.push({ op, style, alpha: this.globalAlpha, pts, dash: this.dashNow.slice() })
  }
  override fill(): void {
    this.note('fill', this.fillStyle)
    super.fill()
  }
  override stroke(p?: MockPath2D): void {
    this.note('stroke', this.strokeStyle)
    super.stroke(p)
  }
  override fillText(text: string, x: number, y: number): void {
    this.log.push({ op: 'text', style: this.fillStyle, alpha: this.globalAlpha, pts: [], dash: [], text })
    super.fillText?.(text, x, y)
  }
}

function paint(over: Partial<BoardScene>, models: Record<string, ModelSpec>, f: FittedCurve): LogCtx {
  const ctx = new LogCtx()
  const scene: BoardScene = {
    vp: VP,
    theme: DARK_THEME,
    curves: [f],
    styles: {},
    models,
    analysis: null,
    chrome: null,
    ...over,
  }
  withMockPath2D(() => renderBoard(ctx as unknown as CanvasRenderingContext2D, scene))
  return ctx
}

/**
 * Filled triangles (arrowheads): a moveTo and two lineTo's, then fill — the
 * ones within 200 px of x = a (the curve's own end-cap arrows sit at the
 * board's edges).
 */
const heads = (ctx: LogCtx, style: string, a = 2): Op[] =>
  ctx.log.filter(
    (e) =>
      e.op === 'fill' &&
      e.style === style &&
      e.pts.length >= 3 &&
      e.pts.filter((c) => (c as { op: string }).op === 'lineTo').length === 2 &&
      Math.abs((e.pts[0] as { x: number }).x - sxOf(a)) < 200,
  )

describe('painting the limit', () => {
  it('arrowheads on the curve toward (1, 2) from both sides, the dashed guide at x = 1', () => {
    const { f, models } = typed('y = (x^2-1)/(x-1)')
    const ctx = paint({ overlays: limitOverlays([{ ...LINK, a: 1 }], [f], models) }, models, f)
    const hs = heads(ctx, CURVE_COLORS[0], 1)
    expect(hs.length).toBe(6)
    for (const h of hs) {
      // the tip, and the middle of the base: the head lies ON y = x + 1 and
      // points toward x = 1
      const [tip, b1, b2] = h.pts as { x: number; y: number }[]
      const xm = (tip.x - VP.widthPx / 2) / VP.pxPerUnit
      const ym = (VP.heightPx / 2 - tip.y) / VP.pxPerUnit
      expect(Math.abs(ym - (xm + 1))).toBeLessThan(0.1)
      const baseX = (b1.x + b2.x) / 2
      expect(Math.abs(tip.x - sxOf(1))).toBeLessThan(Math.abs(baseX - sxOf(1)))
    }
    const guide = ctx.log.find(
      (e) =>
        e.op === 'stroke' &&
        e.dash.length > 0 &&
        e.pts.length === 2 &&
        Math.abs((e.pts[0] as { x: number }).x - sxOf(1)) < 1e-6 &&
        Math.abs((e.pts[1] as { x: number }).x - sxOf(1)) < 1e-6,
    )
    expect(guide).toBeTruthy()
  })

  it('floor(x): the arrows stay on the step that runs into x = 2', () => {
    const { f, models } = typed('y = floor(x)')
    const ctx = paint({ overlays: limitOverlays([{ ...LINK, a: 2 }], [f], models) }, models, f)
    const hs = heads(ctx, CURVE_COLORS[0], 2)
    expect(hs.length).toBe(6)
    for (const h of hs) {
      const tip = h.pts[0] as { x: number; y: number }
      const xm = (tip.x - VP.widthPx / 2) / VP.pxPerUnit
      const ym = (VP.heightPx / 2 - tip.y) / VP.pxPerUnit
      if (xm < 2) expect(ym).toBeCloseTo(1, 1)
      else expect(ym).toBeCloseTo(2, 1)
      expect(Math.abs(xm - 2)).toBeLessThan(1)
    }
  })

  it('SAT: guide, arrows, ring and box in the one mono ink; the bands a grey wash', () => {
    const sat = FIGURE_STYLES.sat
    const { f, models } = typed('y = x^2')
    const ovs = limitOverlays([{ ...LINK, a: 2, epsilon: true }], [f], models)
    const ctx = paint({ figure: sat, overlays: ovs }, models, f)
    const tint = deltaTint(CURVE_COLORS[0])
    expect(ctx.log.filter((e) => e.style === CURVE_COLORS[0] || e.style === tint)).toEqual([])
    expect(heads(ctx, sat.theme.axis).length).toBeGreaterThanOrEqual(4)
    // the ε band: a fill from far left at y = 4.5 − … in the axis ink, light
    const band = ctx.log.find(
      (e) =>
        e.op === 'fill' &&
        e.style === sat.theme.axis &&
        e.pts.some((p) => Math.abs((p as { y: number }).y - syOf(4.5)) < 1e-6) &&
        e.pts.some((p) => Math.abs((p as { y: number }).y - syOf(3.5)) < 1e-6),
    )!
    expect(band).toBeTruthy()
    expect(band.alpha).toBeLessThan(0.2)
    const chips = ctx.log.filter((e) => e.op === 'text' && /^[εδ]/.test(e.text ?? ''))
    expect(chips.map((c) => c.text)).toEqual(expect.arrayContaining(['δ ≈ 0.1213', 'ε = 0.5']))
    for (const c of chips) expect(c.style).toBe(sat.theme.axis)
  })

  it('a board with no limit paints exactly what it did', () => {
    const { f, models } = typed('y = x^2')
    const a = paint({}, models, f)
    const b = paint({ overlays: [] }, models, f)
    expect(b.log.length).toBe(a.log.length)
  })
})

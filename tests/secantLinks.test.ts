// ============================================================================
// tests/secantLinks.test.ts — the secant as a board object: the link in a
// file (old documents byte-identical), what dies with its parent, where a
// fresh one opens, what the card says (the difference quotient, the secant in
// point-slope form, the MVT in AP language, Rolle, the average value) and what
// it draws — on screen and in the SAT figure, in the one mono ink.
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { CURVE_COLORS, DARK_THEME, FIGURE_STYLES } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { parseExpression } from '../src/core/parse'
import {
  boardToStored,
  calcLinkToStored,
  calcNoun,
  deserializeDoc,
  docFromBoard,
  serializeDoc,
  storedToCalcLink,
} from '../src/core/persist'
import type { BoardInput, CalcLink, DocMeta, SecantLink } from '../src/core/persist'
import { cardCalc, changeLabel, dependentsOf, linkNoun, overlaysFor } from '../src/ui/calcLinks'
import {
  AVG_RECT_ALPHA,
  SECANT_EXTENSION_ALPHA,
  decimal,
  defaultSecant,
  numText,
  pointSlope,
  quotientOf,
  secantOverlays,
  secantRow,
  solutionsText,
} from '../src/ui/secantLinks'
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

/** A typed line as the board registers it: its curve, and the models with it. */
function typed(src: string, over: Partial<FittedCurve> = {}): { f: FittedCurve; models: Record<string, ModelSpec> } {
  const out = parseExpression(src)
  if (!out.ok) throw new Error(out.error)
  const spec = out.plot.makeModel('expr_1')
  return {
    f: curve('expr_1', out.plot.defaultParams.slice(), over),
    models: { ...MODELS, expr_1: spec },
  }
}

const META: DocMeta = { id: 'doc1', name: 'Secant', createdAt: 1000, modifiedAt: 1000 }

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

const LINK: SecantLink = { kind: 'secant', id: 'S', parentId: 'f', a: 1, b: 3 }

// ===========================================================================
// The file
// ===========================================================================

describe('the secant link in a file', () => {
  it('writes a and b, and mvt / avg only when on', () => {
    expect(calcLinkToStored(LINK)).toEqual({ kind: 'secant', id: 'S', parentId: 'f', a: 1, b: 3 })
    expect(calcLinkToStored({ ...LINK, mvt: true, avg: true })).toEqual({
      kind: 'secant', id: 'S', parentId: 'f', a: 1, b: 3, mvt: true, avg: true,
    })
    // an off switch is not a key
    const off = { ...LINK, mvt: undefined, avg: undefined } as SecantLink
    expect(Object.keys(calcLinkToStored(off))).toEqual(['kind', 'id', 'parentId', 'a', 'b'])
  })

  it('reads back what it wrote; junk switches are simply off', () => {
    expect(storedToCalcLink({ kind: 'secant', id: 'S', parentId: 'f', a: -2, b: 2, mvt: true })).toEqual({
      ...LINK, a: -2, b: 2, mvt: true,
    })
    expect(storedToCalcLink({ kind: 'secant', id: 'S', parentId: 'f', a: 1, b: 3, mvt: 'yes', avg: 1 })).toEqual(LINK)
  })

  it('refuses a secant missing either point, or with a point that is not a number', () => {
    expect(storedToCalcLink({ kind: 'secant', id: 'S', parentId: 'f', a: 1 })).toBeNull()
    expect(storedToCalcLink({ kind: 'secant', id: 'S', parentId: 'f', b: 1 })).toBeNull()
    expect(storedToCalcLink({ kind: 'secant', id: 'S', parentId: 'f', a: 'x', b: 1 })).toBeNull()
    expect(storedToCalcLink({ kind: 'secant', id: 'S', parentId: 'f', a: 1, b: Infinity })).toBeNull()
    expect(storedToCalcLink({ kind: 'secant', id: '', parentId: 'f', a: 1, b: 2 })).toBeNull()
  })

  it('round-trips through a whole document, π and all', () => {
    const { f } = typed('y = sin(x)')
    const links: CalcLink[] = [{ ...LINK, a: 0, b: Math.PI, mvt: true, avg: true }]
    const input = board({ curves: [f], calc: links, exprSources: { f: 'y = sin(x)' } })
    const res = deserializeDoc(serializeDoc(docFromBoard(META, input, 2000)))
    expect(res.board!.calc).toEqual(links)
    expect(res.degraded).toBe(false)
  })

  it('leaves a document written before secants existed byte-identical', () => {
    const f = curve('poly2', [-1, 0, 1])
    const g = curve('poly3', [0, -1, 0, 1 / 3], { id: 'g' })
    const t = curve('line', [0, 1], { id: 't' })
    const old = board({
      curves: [f, g, t],
      calc: [
        { kind: 'area', id: 'R', parentId: 'f', from: 0, to: 2, abs: false },
        { kind: 'riemann', id: 'S', parentId: 'f', from: 0, to: 2, n: 8, method: 'left' },
        { kind: 'accumulation', id: 'A', parentId: 'f', curveId: 'g', a: 0, C: 0, x: 2 },
        { kind: 'tangent', id: 'L', parentId: 'f', curveId: 't', x: 1 },
      ],
    })
    const text = serializeDoc(docFromBoard(META, old, 2000))
    expect(text).toContain(
      '"calc":[{"kind":"area","id":"R","parentId":"f","from":0,"to":2},' +
        '{"kind":"riemann","id":"S","parentId":"f","from":0,"to":2,"n":8,"method":"left"},' +
        '{"kind":"accumulation","id":"A","parentId":"f","curveId":"g","a":0,"x":2},' +
        '{"kind":"tangent","id":"L","parentId":"f","curveId":"t","x":1}]',
    )
    expect(text).not.toContain('secant')
    expect(text).not.toContain('"mvt"')
    expect(text).not.toContain('"avg"')
    expect(text).not.toContain('"b"')
    const round = serializeDoc(docFromBoard(META, deserializeDoc(text).board as never, 2000))
    expect(round).toBe(text)
  })

  it('a lost parent drops the link, and says so in words', () => {
    const g = curve('poly2', [0, 0, 1], { id: 'g' })
    const stored = boardToStored(board({ curves: [g], calc: [{ ...LINK, parentId: 'gone' }] }))
    const raw = { version: 2, id: 'd', name: 'n', createdAt: 1, modifiedAt: 1, board: { ...stored } }
    const res = deserializeDoc(JSON.stringify(raw))
    expect(res.board!.calc).toEqual([])
    expect(res.board!.curves.map((c) => c.id)).toEqual(['g'])
    expect(res.degraded).toBe(true)
    expect(res.problems.join(' ')).toContain('secant line')
    expect(calcNoun('secant')).toBe('secant line')
  })
})

// ===========================================================================
// What dies with what, and the undo labels
// ===========================================================================

describe('dependents', () => {
  it('deleting f takes the secant, and no curve with it', () => {
    const dead = dependentsOf([LINK], ['f'])
    expect([...dead.linkIds]).toEqual(['S'])
    expect([...dead.curveIds]).toEqual(['f'])
  })

  it('deleting another curve leaves it', () => {
    expect([...dependentsOf([LINK], ['g']).linkIds]).toEqual([])
  })

  it('every change has an undo label in words', () => {
    expect(changeLabel({ kind: 'secantBound', linkId: 'S', which: 'a', value: 0 })).toBe('move secant point')
    expect(changeLabel({ kind: 'secantMvt', linkId: 'S', on: true })).toBe('switch Mean Value Theorem')
    expect(changeLabel({ kind: 'secantAvg', linkId: 'S', on: true })).toBe('switch average value')
    expect(linkNoun('secant')).toBe('secant line')
  })
})

// ===========================================================================
// Where a fresh one opens
// ===========================================================================

describe('defaultSecant', () => {
  it('two whole numbers inside the view', () => {
    const { f, models } = typed('y = x^2')
    expect(defaultSecant(f, models, [-8, 8])).toEqual([-4, 4])
  })

  it('both points on screen when the view allows it: x³ in a ±10 × ±7 view', () => {
    const { f, models } = typed('y = x^3')
    const [a, b] = defaultSecant(f, models, [-10, 10], [-7, 7])!
    expect(Math.abs(a ** 3)).toBeLessThan(7)
    expect(Math.abs(b ** 3)).toBeLessThan(7)
    expect(b).toBeGreaterThan(a)
  })

  it('never across a pole when some pair avoids one: 1/x', () => {
    const { f, models } = typed('y = 1/x')
    const [a, b] = defaultSecant(f, models, [-8, 8])!
    expect(a * b).toBeGreaterThan(0)
  })

  it('on a sketch, inside the ink', () => {
    const f = curve('poly2', [0, 0, 1], { domain: [0.5, 2.5] })
    const [a, b] = defaultSecant(f, MODELS, [-10, 10])!
    expect(a).toBeGreaterThanOrEqual(0.5)
    expect(b).toBeLessThanOrEqual(2.5)
  })

  it('nothing for a curve that is not a function of x', () => {
    expect(defaultSecant(curve('circle', [0, 0, 1], { kind: 'implicit' }), MODELS, [-4, 4])).toBeNull()
  })
})

// ===========================================================================
// What the card says
// ===========================================================================

describe('the card', () => {
  it('numbers the way a teacher writes them', () => {
    expect(numText(4)).toBe('4')
    expect(numText(-8)).toBe('−8')
    expect(numText(1 / 3)).toBe('1/3')
    expect(numText(Math.PI)).toBe('π')
    expect(numText(2 / Math.sqrt(3))).toBe('2√3/3')
    expect(decimal(0.2866)).toBe('0.287')
    expect(decimal(-1.5)).toBe('−1.5')
  })

  it('the difference quotient, written out: x² on [1, 3]', () => {
    const { f, models } = typed('y = x^2')
    const row = secantRow(LINK, f, models)
    expect(row.head).toBe('Average rate of change of f over [1, 3]')
    expect(row.value).toBe('4')
    expect(row.quotient!.text).toBe('(f(3) − f(1))/(3 − 1) = (9 − 1)/2 = 4')
    expect(row.quotient!.tex).toContain('\\dfrac{f(3) - f(1)}{3 - 1}')
    expect(row.line!.text).toBe('y − 1 = 4(x − 1)')
    expect(row.problem).toBeNull()
  })

  it('negatives are parenthesised: x³ on [−2, 2]', () => {
    const { f, models } = typed('y = x^3')
    const row = secantRow({ ...LINK, a: -2, b: 2 }, f, models, 'g')
    expect(row.quotient!.text).toBe('(g(2) − g(−2))/(2 − (−2)) = (8 − (−8))/4 = 4')
    expect(row.line!.text).toBe('y + 8 = 4(x + 2)')
  })

  it('point-slope in every shape', () => {
    const base = { a: 1, b: 3, fa: 1, fb: 9, m: 4, rolle: false }
    expect(pointSlope(base).text).toBe('y − 1 = 4(x − 1)')
    expect(pointSlope({ ...base, a: 0, fa: 0 }).text).toBe('y = 4x')
    expect(pointSlope({ ...base, m: 1 }).text).toBe('y − 1 = (x − 1)')
    expect(pointSlope({ ...base, m: -1 }).text).toBe('y − 1 = −(x − 1)')
    expect(pointSlope({ ...base, m: 1 / 3 }).text).toBe('y − 1 = (1/3)(x − 1)')
    expect(pointSlope({ ...base, m: 0, rolle: true }).text).toBe('y = 1')
  })

  it('a decimal slope says ≈', () => {
    const q = quotientOf({ a: 0, b: 1, fa: 1, fb: Math.E, m: Math.E - 1, rolle: false })
    expect(q.text).toBe('(f(1) − f(0))/(1 − 0) = (2.718 − 1)/1 ≈ 1.718')
  })

  it('MVT on x³ over [−2, 2]: both hypotheses, and c = ±2√3/3', () => {
    const { f, models } = typed('y = x^3')
    const t = secantRow({ ...LINK, a: -2, b: 2, mvt: true }, f, models).theorem!
    expect(t.title).toBe('Mean Value Theorem: f′(c) = 4')
    expect(t.hyps).toEqual([
      { ok: true, text: 'f is continuous on [−2, 2]' },
      { ok: true, text: 'f is differentiable on (−2, 2)' },
    ])
    expect(t.ok).toBe(true)
    expect(t.verdict).toBe('By the Mean Value Theorem there is a c in (−2, 2) with f′(c) = 4:')
    expect(t.points).toBe('c = ±2√3/3 ≈ ±1.155')
  })

  it('|x| on [−1, 2]: not differentiable at x = 0, so the MVT does not apply', () => {
    const { f, models } = typed('y = abs(x)')
    const t = secantRow({ ...LINK, a: -1, b: 2, mvt: true }, f, models).theorem!
    expect(t.ok).toBe(false)
    expect(t.hyps[0].ok).toBe(true)
    expect(t.hyps[1]).toEqual({ ok: false, text: 'f is not differentiable at x = 0 (a corner)' })
    expect(t.verdict).toBe('f is not differentiable at x = 0, so the Mean Value Theorem does not apply.')
    expect(t.points).toBe('No c in (−1, 2) has f′(c) = 1/3.')
  })

  it('1/x on [−1, 1]: not continuous, and the c that happens to exist anyway is none', () => {
    const { f, models } = typed('y = 1/x')
    const t = secantRow({ ...LINK, a: -1, b: 1, mvt: true }, f, models).theorem!
    expect(t.hyps[0]).toEqual({
      ok: false,
      text: 'f is not continuous on [−1, 1]: f has a vertical asymptote at x = 0',
    })
    expect(t.verdict).toBe('f is not continuous on [−1, 1], so the Mean Value Theorem does not apply.')
  })

  it('a c that exists without the hypotheses is still reported: ∛x', () => {
    const { f, models } = typed('y = x^(1/3)')
    const t = secantRow({ ...LINK, a: -1, b: 1, mvt: true }, f, models).theorem!
    expect(t.hyps[1].text).toBe('f is not differentiable at x = 0 (a vertical tangent)')
    expect(t.points).toBe('Still, f′(c) = 1 at c = ±√3/9 ≈ ±0.192')
  })

  it("sin x on [0, π]: Rolle's theorem, c = π/2", () => {
    const { f, models } = typed('y = sin(x)')
    const row = secantRow({ ...LINK, a: 0, b: Math.PI, mvt: true }, f, models)
    const t = row.theorem!
    expect(t.rolle).toBe(true)
    expect(t.title).toBe("Rolle's theorem: f′(c) = 0")
    expect(t.hyps[2]).toEqual({ ok: true, text: 'f(0) = f(π) = 0' })
    expect(t.verdict).toBe("By Rolle's theorem there is a c in (0, π) with f′(c) = 0:")
    expect(t.points).toBe('c = π/2 ≈ 1.571')
    expect(row.quotient!.text).toBe('(f(π) − f(0))/(π − 0) = (0 − 0)/π = 0')
  })

  it('average value of x² on [0, 3]: 9/3 = 3, at c = √3', () => {
    const { f, models } = typed('y = x^2')
    const av = secantRow({ ...LINK, a: 0, b: 3, avg: true }, f, models).average!
    expect(av.text).toBe('f_avg = (1/(3 − 0))∫₀³ f(x) dx = 9/3 = 3')
    expect(av.tex).toContain('\\int_{0}^{3} f(x)\\,dx')
    expect(av.points).toBe('f(c) = f_avg at c = √3 ≈ 1.732')
    expect(av.problem).toBeNull()
  })

  it('no average value across a pole — and it says why', () => {
    const { f, models } = typed('y = 1/x')
    const av = secantRow({ ...LINK, a: -1, b: 1, avg: true }, f, models).average!
    expect(av.problem).toContain('vertical asymptote at x = 0')
  })

  it('symmetric pairs are written once with ±; others are listed', () => {
    expect(solutionsText([{ x: -1, exact: { text: '−1', tex: '-1', value: -1 } }, { x: 1, exact: { text: '1', tex: '1', value: 1 } }])).toBe('c = ±1')
    expect(solutionsText([{ x: 0.5, exact: null }, { x: 2, exact: null }])).toBe('c ≈ 0.5; c ≈ 2')
  })

  it('refusals in words', () => {
    const { f, models } = typed('y = 1/x')
    expect(secantRow({ ...LINK, a: 0, b: 1 }, f, models).problem).toBe(
      'f is undefined at x = 0, so there is no secant line there',
    )
    expect(secantRow({ ...LINK, a: 2, b: 2 }, f, models).problem).toContain('same point')
    expect(secantRow(LINK, undefined, models).problem).toContain('gone')
  })

  it('cardCalc hands the row to the parent, and a curve with none gets []', () => {
    const { f, models } = typed('y = x^2')
    const g = curve('line', [0, 1], { id: 'g' })
    const cards = cardCalc([LINK], [f, g], { ...models }, () => 'Parabola', { f: 'f' })
    expect(cards.f.secants).toHaveLength(1)
    expect(cards.f.secants[0].value).toBe('4')
    expect(cards.g.secants).toEqual([])
  })
})

// ===========================================================================
// What it draws
// ===========================================================================

describe('secantOverlays', () => {
  const kinds = (ovs: Overlay[]): string[] => ovs.map((o) => o.kind)

  it('a bare secant: the faint line, the solid segment, the two dots', () => {
    const { f, models } = typed('y = x^2')
    const ovs = secantOverlays([LINK], [f], models)
    expect(kinds(ovs)).toEqual(['line', 'segment', 'dot', 'dot'])
    const line = ovs[0] as Extract<Overlay, { kind: 'line' }>
    expect(line.slope).toBe(4)
    expect(line.alpha).toBe(SECANT_EXTENSION_ALPHA)
    const seg = ovs[1] as Extract<Overlay, { kind: 'segment' }>
    expect(seg.from).toEqual({ x: 1, y: 1 })
    expect(seg.to).toEqual({ x: 3, y: 9 })
    expect(seg.dashed).toBeFalsy()
  })

  it('MVT: a dashed tangent parallel to the secant at each c, a dot and a chip', () => {
    const { f, models } = typed('y = x^3')
    const ovs = secantOverlays([{ ...LINK, a: -2, b: 2, mvt: true }], [f], models)
    const tangents = ovs.filter((o) => o.kind === 'line' && o.dashed) as Extract<Overlay, { kind: 'line' }>[]
    expect(tangents).toHaveLength(2)
    for (const t of tangents) expect(t.slope).toBe(4)
    expect(tangents.map((t) => t.at.x)).toEqual([-2 / Math.sqrt(3), 2 / Math.sqrt(3)].map((v) => expect.closeTo(v, 12)))
    const chips = ovs.filter((o) => o.kind === 'label') as Extract<Overlay, { kind: 'label' }>[]
    expect(chips.map((c) => c.text)).toEqual(['c = −2√3/3', 'c = 2√3/3'])
    // chips go on last, over everything else
    expect(ovs.slice(-2).every((o) => o.kind === 'label')).toBe(true)
  })

  it('a failed hypothesis is marked on the figure: a ring and a chip at the corner', () => {
    const { f, models } = typed('y = abs(x)')
    const ovs = secantOverlays([{ ...LINK, a: -1, b: 2, mvt: true }], [f], models)
    const ring = ovs.find((o) => o.kind === 'dot' && o.hollow) as Extract<Overlay, { kind: 'dot' }>
    expect(ring.at).toEqual({ x: 0, y: 0 })
    expect(ovs.some((o) => o.kind === 'label' && o.text === 'not differentiable')).toBe(true)
    expect(ovs.some((o) => o.kind === 'line' && o.dashed)).toBe(false)
  })

  it('average value: the rectangle under the curves, its lid, the c', () => {
    const { f, models } = typed('y = x^2')
    const ovs = secantOverlays([{ ...LINK, a: 0, b: 3, avg: true }], [f], models)
    expect(ovs[0].kind).toBe('region')
    const rect = ovs[0] as Extract<Overlay, { kind: 'region' }>
    expect(rect.boundary).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 0 },
    ])
    expect(rect.alpha).toBe(AVG_RECT_ALPHA)
    const lid = ovs.find(
      (o) => o.kind === 'segment' && o.from.y === 3 && o.to.y === 3,
    ) as Extract<Overlay, { kind: 'segment' }>
    expect(lid.from.x).toBe(0)
    expect(lid.to.x).toBe(3)
    expect(ovs.some((o) => o.kind === 'label' && o.text === 'c = √3')).toBe(true)
  })

  it('a hidden or missing parent draws nothing; no secant draws nothing', () => {
    const { f, models } = typed('y = 1/x')
    expect(secantOverlays([LINK], [{ ...f, visible: false }], models)).toEqual([])
    expect(secantOverlays([{ ...LINK, parentId: 'gone' }], [f], models)).toEqual([])
    expect(secantOverlays([{ ...LINK, a: 0 }], [f], models)).toEqual([])
  })

  it('overlaysFor carries them, and marks go in the marks pass', () => {
    const { f, models } = typed('y = x^2')
    const ovs = overlaysFor([LINK], [f], models)
    expect(kinds(ovs)).toEqual(['line', 'segment', 'dot', 'dot'])
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

describe('painting the secant', () => {
  it('the extension spans the board along the secant, faint; the tangents dashed', () => {
    const { f, models } = typed('y = x^3')
    const ovs = secantOverlays([{ ...LINK, a: -2, b: 2, mvt: true }], [f], models)
    const ctx = paint({ overlays: ovs }, models, f)
    const faint = ctx.log.find((e) => e.op === 'stroke' && Math.abs(e.alpha - SECANT_EXTENSION_ALPHA) < 1e-9)!
    expect(faint).toBeTruthy()
    const [p, q] = faint.pts as { x: number; y: number }[]
    // slope 4 in math units is −4 in screen units at equal scales, and the line
    // passes through (−2, −8)
    expect((q.y - p.y) / (q.x - p.x)).toBeCloseTo(-4, 9)
    const at = p.y + ((sxOf(-2) - p.x) * (q.y - p.y)) / (q.x - p.x)
    expect(at).toBeCloseTo(syOf(-8), 6)
    const dashed = ctx.log.filter((e) => e.op === 'stroke' && e.dash.length > 0 && e.style === CURVE_COLORS[0])
    expect(dashed.length).toBeGreaterThanOrEqual(2)
    const texts = ctx.log.filter((e) => e.op === 'text').map((e) => e.text)
    expect(texts).toEqual(expect.arrayContaining(['c = −2√3/3', 'c = 2√3/3']))
  })

  it('SAT: every mark in the one mono ink, the rectangle a light grey wash, the chips in the figure', () => {
    const sat = FIGURE_STYLES.sat
    const { f, models } = typed('y = x^2')
    const ovs = secantOverlays([{ ...LINK, a: 0, b: 3, mvt: true, avg: true }], [f], models)
    const ctx = paint({ figure: sat, overlays: ovs }, models, f)
    // nothing in the screen colour
    expect(ctx.log.filter((e) => e.style === CURVE_COLORS[0])).toEqual([])
    // the rectangle: a fill from (0, 0) up to (0, 3) — the wash, in the axis ink
    const rect = ctx.log.find(
      (e) =>
        e.op === 'fill' &&
        e.pts[0]?.op === 'moveTo' &&
        Math.abs((e.pts[0] as { x: number }).x - sxOf(0)) < 1e-6 &&
        Math.abs((e.pts[0] as { y: number }).y - syOf(0)) < 1e-6,
    )!
    expect(rect).toBeTruthy()
    expect(rect.style).toBe(sat.theme.axis)
    expect(rect.alpha).toBeLessThan(0.2)
    // chips are text in the mono ink
    const chips = ctx.log.filter((e) => e.op === 'text' && e.text?.startsWith('c ='))
    expect(chips.map((c) => c.text)).toEqual(expect.arrayContaining(['c = 3/2', 'c = √3']))
    for (const c of chips) expect(c.style).toBe(sat.theme.axis)
  })

  it('a board with no secant paints exactly what it did', () => {
    const { f, models } = typed('y = x^2')
    const a = paint({}, models, f)
    const b = paint({ overlays: [] }, models, f)
    expect(b.log.length).toBe(a.log.length)
  })
})

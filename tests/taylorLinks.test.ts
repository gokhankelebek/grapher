// ============================================================================
// tests/taylorLinks.test.ts — the Taylor polynomial as a board object: the
// link in a file, what dies with its parent, where a fresh one is centred, the
// source a SKETCHED curve is read through, what it puts on the board, and what
// the card and the legend say.
//
// Where a test needs real Taylor numbers without a parser in the way it uses a
// small fake TaylorSource (sin, 1/(1 − x)) whose jets are written out by hand.
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { CURVE_COLORS, DARK_THEME, FIGURE_STYLES } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { parseExpression } from '../src/core/parse'
import type { TaylorSource } from '../src/core/taylor'
import { TAYLOR_N_MAX, TAYLOR_N_MIN, evalTaylor, taylorPolynomial } from '../src/core/taylor'
import {
  TAYLOR_MODEL_PREFIX,
  boardToStored,
  calcLinkToStored,
  deserializeDoc,
  docFromBoard,
  serializeDoc,
  storedToCalcLink,
} from '../src/core/persist'
import type { BoardInput, CalcLink, DocMeta, TaylorLink } from '../src/core/persist'
import { cardCalc, changeLabel, dependentsOf, labelLegend, overlaysFor } from '../src/ui/calcLinks'
import {
  TAYLOR_NEEDS_FORMULA,
  defaultTaylorA,
  iocLine,
  numLabel,
  pName,
  sci,
  snapCenter,
  stripEnd,
  taylorBlocked,
  taylorChildModel,
  taylorOverlays,
  taylorSourceFor,
  withTaylorNames,
} from '../src/ui/taylorLinks'
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

/** A typed line, as the App registers one. */
function typed(src: string, id = 'expr_1'): { spec: ModelSpec; models: Record<string, ModelSpec> } {
  const out = parseExpression(src)
  if (!out.ok) throw new Error(out.error)
  const spec = out.plot.makeModel(id)
  return { spec, models: { ...MODELS, [id]: spec } }
}

const factorial = (k: number): number => (k <= 1 ? 1 : k * factorial(k - 1))

/** sin x, with its jets written out: c_k = sin⁽ᵏ⁾(a)/k!. */
const SIN: TaylorSource = {
  f: Math.sin,
  jet: (a, n) => {
    const d = [Math.sin(a), Math.cos(a), -Math.sin(a), -Math.cos(a)]
    return Array.from({ length: n + 1 }, (_, k) => d[k % 4] / factorial(k))
  },
  domain: null,
}

/** 1/(1 − x): c_k = 1/(1 − a)^{k+1}; nothing at the pole x = 1. */
const GEOM: TaylorSource = {
  f: (x) => (x === 1 ? Number.NaN : 1 / (1 - x)),
  jet: (a, n) => (a === 1 ? null : Array.from({ length: n + 1 }, (_, k) => 1 / Math.pow(1 - a, k + 1))),
  domain: null,
}

/** Is the core past its stubs yet? A few tests need its real numbers. */
const coreLive = taylorPolynomial(SIN, 0, 3) !== null
const live = coreLive ? it : it.skip

const META: DocMeta = { id: 'doc1', name: 'Taylor', createdAt: 1000, modifiedAt: 1000 }

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

const LINK: TaylorLink = { kind: 'taylor', id: 'T', parentId: 'f', curveId: 'p', a: 0, n: 3 }

/** f = sin x typed, and its Taylor curve. */
function sinPair(link: Partial<TaylorLink> = {}) {
  const { models } = typed('y = sin(x)')
  const f = curve('expr_1', [], { id: 'f' })
  const L: TaylorLink = { ...LINK, ...link }
  const p = curve(`${TAYLOR_MODEL_PREFIX}T`, [], { id: 'p', color: CURVE_COLORS[1] })
  return { f, p, L, models }
}

// ===========================================================================
// The file
// ===========================================================================

describe('the Taylor link in a file', () => {
  it('writes a and n, and x / band / ioc only when set', () => {
    expect(calcLinkToStored(LINK)).toEqual({ kind: 'taylor', id: 'T', parentId: 'f', curveId: 'p', a: 0, n: 3 })
    expect(calcLinkToStored({ ...LINK, band: false, ioc: false })).toEqual({
      kind: 'taylor', id: 'T', parentId: 'f', curveId: 'p', a: 0, n: 3,
    })
    expect(calcLinkToStored({ ...LINK, x: 0.5, band: true, ioc: true })).toEqual({
      kind: 'taylor', id: 'T', parentId: 'f', curveId: 'p', a: 0, n: 3, x: 0.5, band: true, ioc: true,
    })
  })

  it('integerises and clamps n, both ways', () => {
    expect(calcLinkToStored({ ...LINK, n: 7.6 }).n).toBe(8)
    expect(calcLinkToStored({ ...LINK, n: 99 }).n).toBe(TAYLOR_N_MAX)
    expect(calcLinkToStored({ ...LINK, n: -4 }).n).toBe(TAYLOR_N_MIN)
    const back = storedToCalcLink({ kind: 'taylor', id: 'T', parentId: 'f', curveId: 'p', a: 1, n: 44.2 })
    expect(back).toEqual({ ...LINK, a: 1, n: TAYLOR_N_MAX })
    // absent n is the default degree
    expect((storedToCalcLink({ kind: 'taylor', id: 'T', parentId: 'f', curveId: 'p', a: 0 }) as TaylorLink).n).toBe(3)
  })

  it('refuses a link with no centre, a junk degree or no curve', () => {
    expect(storedToCalcLink({ kind: 'taylor', id: 'T', parentId: 'f', curveId: 'p', n: 3 })).toBeNull()
    expect(storedToCalcLink({ kind: 'taylor', id: 'T', parentId: 'f', curveId: 'p', a: 0, n: 'x' })).toBeNull()
    expect(storedToCalcLink({ kind: 'taylor', id: 'T', parentId: 'f', a: 0, n: 3 })).toBeNull()
    // junk switches and probe are simply off / absent
    expect(
      storedToCalcLink({ kind: 'taylor', id: 'T', parentId: 'f', curveId: 'p', a: 0, n: 3, x: 'q', band: 1, ioc: 'yes' }),
    ).toEqual(LINK)
  })

  it('round-trips through a whole document', () => {
    const { f, p } = sinPair()
    const links: CalcLink[] = [{ ...LINK, a: Math.PI / 6, n: 5, x: 0.5, band: true, ioc: true }]
    const input = board({ curves: [f, p], calc: links, exprSources: { f: 'y = sin(x)' } })
    const res = deserializeDoc(serializeDoc(docFromBoard(META, input, 2000)))
    expect(res.board!.calc).toEqual(links)
    expect(res.board!.curves.map((c) => c.id)).toEqual(['f', 'p'])
    expect(res.board!.curves[1].modelId).toBe('tay_T')
    expect(res.degraded).toBe(false)
  })

  it('leaves a document written before Taylor existed byte-identical', () => {
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
    // The exact bytes this board always wrote for its links.
    expect(text).toContain(
      '"calc":[{"kind":"area","id":"R","parentId":"f","from":0,"to":2},' +
        '{"kind":"riemann","id":"S","parentId":"f","from":0,"to":2,"n":8,"method":"left"},' +
        '{"kind":"accumulation","id":"A","parentId":"f","curveId":"g","a":0,"x":2},' +
        '{"kind":"tangent","id":"L","parentId":"f","curveId":"t","x":1}]',
    )
    expect(text).not.toContain('taylor')
    expect(text).not.toContain('"band"')
    expect(text).not.toContain('"ioc"')
    const round = serializeDoc(docFromBoard(META, deserializeDoc(text).board as never, 2000))
    expect(round).toBe(text)
  })

  it('a lost parent drops the link AND its curve, and says so', () => {
    const { p } = sinPair()
    const stored = boardToStored(board({ curves: [p], calc: [{ ...LINK, parentId: 'gone' }] }))
    const raw = {
      version: 2, id: 'd', name: 'n', createdAt: 1, modifiedAt: 1,
      board: { ...stored },
    }
    const res = deserializeDoc(JSON.stringify(raw))
    expect(res.board!.calc).toEqual([])
    expect(res.board!.curves).toEqual([])
    expect(res.degraded).toBe(true)
    expect(res.problems.join(' ')).toContain('Taylor polynomial')
  })
})

// ===========================================================================
// What dies with what
// ===========================================================================

describe('dependents', () => {
  it('deleting the parent takes the link and the Taylor curve', () => {
    const dead = dependentsOf([LINK], ['f'])
    expect([...dead.linkIds]).toEqual(['T'])
    expect([...dead.curveIds].sort()).toEqual(['f', 'p'])
  })

  it('deleting the Taylor curve takes only its link', () => {
    const dead = dependentsOf([LINK], ['p'])
    expect([...dead.linkIds]).toEqual(['T'])
    expect([...dead.curveIds]).toEqual(['p'])
  })

  it('and a tangent on the Taylor curve goes with it', () => {
    const tan: CalcLink = { kind: 'tangent', id: 'L', parentId: 'p', curveId: 't', x: 0 }
    const dead = dependentsOf([LINK, tan], ['f'])
    expect([...dead.linkIds].sort()).toEqual(['L', 'T'])
    expect([...dead.curveIds].sort()).toEqual(['f', 'p', 't'])
  })

  it('every change has an undo label in words', () => {
    expect(changeLabel({ kind: 'taylorN', linkId: 'T', n: 5 })).toBe('change Taylor degree')
    expect(changeLabel({ kind: 'taylorA', linkId: 'T', a: 1 })).toBe('move Taylor center')
    expect(changeLabel({ kind: 'taylorX', linkId: 'T', x: null })).toBe('move Taylor probe')
    expect(changeLabel({ kind: 'taylorBand', linkId: 'T', on: true })).toBe('switch error band')
    expect(changeLabel({ kind: 'taylorIoc', linkId: 'T', on: true })).toBe('switch interval of convergence')
  })
})

// ===========================================================================
// Where a fresh one is centred
// ===========================================================================

describe('defaultTaylorA', () => {
  const everywhere = (): boolean => true
  it('0 when f is analytic there and 0 is in view — the Maclaurin polynomial', () => {
    expect(defaultTaylorA(everywhere, [-8, 8])).toBe(0)
    expect(defaultTaylorA(everywhere, [-1, 30])).toBe(0)
  })

  it('0 off-screen: the nearest integer to the middle of the view', () => {
    expect(defaultTaylorA(everywhere, [10, 20])).toBe(15)
    expect(defaultTaylorA(everywhere, [10.2, 13.1])).toBe(12)
  })

  it('ln x: not at 0, so the nearest integer where it is analytic', () => {
    const ln = (a: number): boolean => a > 0
    expect(defaultTaylorA(ln, [-8, 8])).toBe(1)
  })

  it('an integer where it is not analytic is skipped; then halves', () => {
    const noInts = (a: number): boolean => !Number.isInteger(a)
    expect(defaultTaylorA(noInts, [-8, 8])).toBe(-0.5)
    const only = (a: number): boolean => a === 2.5
    expect(defaultTaylorA(only, [-8, 8])).toBe(2.5)
  })

  it("a sketch's domain clips the view: centred on the ink", () => {
    expect(defaultTaylorA(everywhere, [-8, 8], [2.3, 5.1])).toBe(4)
    // a sketch entirely off-screen still gets a centre on it
    expect(defaultTaylorA(everywhere, [-8, 8], [20, 24])).toBe(22)
  })

  it('nothing analytic nearby: null', () => {
    expect(defaultTaylorA(() => false, [-8, 8])).toBeNull()
  })

  it('never throws on a predicate that does', () => {
    expect(
      defaultTaylorA((a) => {
        if (a === 0) throw new Error('no')
        return a === 1
      }, [-8, 8]),
    ).toBe(1)
  })
})

// ===========================================================================
// The source
// ===========================================================================

describe('the Taylor source', () => {
  it('a line that calls another curve has none, and the menu says why', () => {
    const { models } = typed('y = sin(x)')
    const f = curve('expr_1', [])
    expect(taylorSourceFor(f, models, true)).toBeNull()
    expect(taylorBlocked(f, models, true)).toBe(TAYLOR_NEEDS_FORMULA)
  })

  it('nothing for a curve that is not a function of x', () => {
    const c = curve('circle', [0, 0, 1], { kind: 'implicit' })
    expect(taylorSourceFor(c, MODELS)).toBeNull()
    // not offered at all, so no reason either
    expect(taylorBlocked(c, MODELS)).toBeNull()
  })

  live('a typed curve is read through its own jets', () => {
    const { models } = typed('y = sin(x)')
    const src = taylorSourceFor(curve('expr_1', []), models)!
    expect(src).not.toBeNull()
    expect(taylorBlocked(curve('expr_1', []), models)).toBeNull()
    const P = taylorPolynomial(src, 0, 5)!
    expect(P.coeffs[1]).toBeCloseTo(1, 12)
    expect(P.coeffs[3]).toBeCloseTo(-1 / 6, 12)
  })

  live('a sketched cubic: P₃ (and every Pₙ past it) IS the cubic', () => {
    const cubic = curve('poly3', [0.5, -2, 0.25, 1.5], { domain: [-3, 3] })
    const src = taylorSourceFor(cubic, MODELS)
    expect(src).not.toBeNull()
    const f = (x: number) => MODELS.poly3.evalExplicit!(cubic.params, x)
    for (const n of [3, 4, 7]) {
      for (const a of [0, 1, -1.5]) {
        const P = taylorPolynomial(src!, a, n)!
        expect(P).not.toBeNull()
        for (const x of [-2.5, -1, 0, 0.7, 2.9]) expect(evalTaylor(P, x)).toBeCloseTo(f(x), 9)
      }
    }
    // P₂ is not: it is missing the cube
    const P2 = taylorPolynomial(src!, 0, 2)!
    expect(Math.abs(evalTaylor(P2, 2) - f(2))).toBeGreaterThan(1)
  })

  live('a sketched parabola keeps its own domain: no centre outside the ink', () => {
    const para = curve('poly2', [1, 0, -1], { domain: [-2, 2] })
    const src = taylorSourceFor(para, MODELS)!
    expect(src.domain).toEqual([-2, 2])
    expect(taylorPolynomial(src, 5, 3)).toBeNull()
    expect(taylorPolynomial(src, 1, 3)).not.toBeNull()
  })

  live('a sketched sine family reads through its equation text', () => {
    const wave = curve('sine', [2, 1, 0, 0])
    const src = taylorSourceFor(wave, MODELS)
    expect(src).not.toBeNull()
    const P = taylorPolynomial(src!, 0, 3)!
    expect(evalTaylor(P, 0.3)).toBeCloseTo(2 * (0.3 - 0.3 ** 3 / 6), 6)
  })
})

// ===========================================================================
// The board
// ===========================================================================

describe('taylorOverlays', () => {
  const f = curve('poly2', [0, 0, 1], { id: 'f' })
  const p = curve('tay_T', [], { id: 'p', color: CURVE_COLORS[1] })
  const src = (): TaylorSource => SIN
  const kinds = (ovs: Overlay[]) => ovs.map((o) => o.kind)

  live('the centre dot sits on the parent at (a, f(a))', () => {
    const ovs = taylorOverlays([{ ...LINK, a: 1 }], [f, p], MODELS, null, src)
    expect(kinds(ovs)).toEqual(['dot'])
    const d = ovs[0] as Extract<Overlay, { kind: 'dot' }>
    expect(d.curveId).toBe('f')
    expect(d.at.x).toBe(1)
    expect(d.at.y).toBeCloseTo(Math.sin(1), 12)
  })

  live('the probe: a dashed segment from Pₙ(x) to f(x), a dot at each end', () => {
    const ovs = taylorOverlays([{ ...LINK, x: 2 }], [f, p], MODELS, null, src)
    expect(kinds(ovs)).toEqual(['dot', 'segment', 'dot', 'dot'])
    const seg = ovs[1] as Extract<Overlay, { kind: 'segment' }>
    expect(seg.dashed).toBe(true)
    expect(seg.from.x).toBe(2)
    expect(seg.from.y).toBeCloseTo(2 - 8 / 6, 9) // P₃(2) of sin
    expect(seg.to.y).toBeCloseTo(Math.sin(2), 12)
    expect(seg.curveId).toBe('p')
  })

  live('the band: sampled over the span, pinched to nothing at a', () => {
    const ovs = taylorOverlays([{ ...LINK, band: true }], [f, p], MODELS, [-4, 4], src)
    const band = ovs.find((o) => o.kind === 'band') as Extract<Overlay, { kind: 'band' }>
    expect(band).toBeTruthy()
    expect(band.curveId).toBe('p')
    expect(band.xs[0]).toBe(-4)
    expect(band.xs[band.xs.length - 1]).toBe(4)
    const i0 = band.xs.indexOf(0)
    expect(i0).toBeGreaterThan(0)
    expect(band.hi[i0] - band.lo[i0]).toBeCloseTo(0, 12)
    // |sin⁽⁴⁾| ≤ 1: the half-width at x is at most |x|⁴/4!
    const i = band.xs.findIndex((x) => x > 1.9)
    const half = (band.hi[i] - band.lo[i]) / 2
    expect(half).toBeGreaterThan(0)
    expect(half).toBeLessThanOrEqual(band.xs[i] ** 4 / 24 + 1e-9)
    // fills before marks
    expect(ovs.indexOf(band)).toBeLessThan(ovs.findIndex((o) => o.kind === 'dot'))
  })

  live('no span, no band; a hidden Taylor curve, no band and no probe', () => {
    expect(kinds(taylorOverlays([{ ...LINK, band: true }], [f, p], MODELS, null, src))).toEqual(['dot'])
    const hidden = { ...p, visible: false }
    expect(kinds(taylorOverlays([{ ...LINK, band: true, x: 1 }], [f, hidden], MODELS, [-4, 4], src))).toEqual(['dot'])
  })

  live('the interval of convergence: 1/(1 − x) about 0 is (−1, 1), open both ends', () => {
    const ovs = taylorOverlays([{ ...LINK, ioc: true }], [f, p], MODELS, null, () => GEOM)
    const strip = ovs.find((o) => o.kind === 'axisStrip') as Extract<Overlay, { kind: 'axisStrip' }>
    expect(strip).toBeTruthy()
    expect(strip.from).toBeCloseTo(-1, 6)
    expect(strip.to).toBeCloseTo(1, 6)
    expect(strip.left).toBe('open')
    expect(strip.right).toBe('open')
  })

  live('sin x is entire: the strip runs to ±∞', () => {
    const ovs = taylorOverlays([{ ...LINK, ioc: true }], [f, p], MODELS, null, src)
    const strip = ovs.find((o) => o.kind === 'axisStrip') as Extract<Overlay, { kind: 'axisStrip' }>
    expect(strip.from).toBe(-Infinity)
    expect(strip.to).toBe(Infinity)
  })

  it('a hidden parent, or a centre on a pole, puts nothing on the board', () => {
    const hid = { ...f, visible: false }
    expect(taylorOverlays([{ ...LINK, x: 1, band: true, ioc: true }], [hid, p], MODELS, [-4, 4], src)).toEqual([])
    expect(taylorOverlays([{ ...LINK, a: 1, x: 0.5 }], [f, p], MODELS, [-4, 4], () => GEOM)).toEqual([])
  })

  it('overlaysFor appends nothing for a board without Taylor links', () => {
    const area: CalcLink = { kind: 'area', id: 'R', parentId: 'f', from: 0, to: 1, abs: false }
    expect(overlaysFor([area], [f], MODELS, [-4, 4])).toEqual([{ kind: 'area', curveId: 'f', from: 0, to: 1 }])
  })

  it('strip ends from the series: converges or conditional ●, diverges ○, unknown nothing', () => {
    expect(stripEnd('converges')).toBe('closed')
    expect(stripEnd('conditional')).toBe('closed')
    expect(stripEnd('diverges')).toBe('open')
    expect(stripEnd('unknown')).toBe('none')
  })
})

// ---------------------------------------------------------------------------
// Painting the new overlay kinds
// ---------------------------------------------------------------------------

const VP = { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 900, heightPx: 700 }
const sxOf = (x: number): number => VP.widthPx / 2 + x * VP.pxPerUnit
const syOf = (y: number): number => VP.heightPx / 2 - y * VP.pxPerUnit

interface Op {
  op: 'fill' | 'stroke'
  style: string
  alpha: number
  path: boolean
  pts: Cmd[]
}

class LogCtx extends MockCtx {
  log: Op[] = []
  private mark = 0
  private note(op: 'fill' | 'stroke', path: boolean): void {
    const pts = this.own.cmds.slice(this.mark) as Cmd[]
    this.mark = this.own.cmds.length
    this.log.push({ op, style: op === 'fill' ? this.fillStyle : this.strokeStyle, alpha: this.globalAlpha, path, pts })
  }
  override fill(): void {
    this.note('fill', false)
    super.fill()
  }
  override stroke(p?: MockPath2D): void {
    this.note('stroke', p !== undefined)
    super.stroke(p)
  }
}

function paint(over: Partial<BoardScene>): LogCtx {
  const ctx = new LogCtx()
  const scene: BoardScene = {
    vp: VP,
    theme: DARK_THEME,
    curves: [curve('poly2', [0, 0, 1], { id: 'f' }), curve('line', [0, 1], { id: 'p', color: CURVE_COLORS[1] })],
    styles: {},
    models: MODELS,
    analysis: null,
    chrome: null,
    ...over,
  }
  withMockPath2D(() => renderBoard(ctx as unknown as CanvasRenderingContext2D, scene))
  return ctx
}

describe('painting the Taylor overlays', () => {
  it('marks go ON the curves, fills under them', () => {
    const ctx = paint({
      overlays: [
        { kind: 'band', curveId: 'p', xs: [-1, 0, 1], lo: [-2, 0, 0], hi: [0, 0, 2] },
        { kind: 'dot', curveId: 'f', at: { x: 1, y: 1 } },
      ],
    })
    const band = ctx.log.findIndex((e) => e.op === 'fill' && e.style === CURVE_COLORS[1])
    const firstCurve = ctx.log.findIndex((e) => e.op === 'stroke' && e.path)
    const lastCurve = ctx.log.map((e) => e.op === 'stroke' && e.path).lastIndexOf(true)
    const dot = ctx.log.findIndex((e, i) => i > lastCurve && e.op === 'fill' && e.style === CURVE_COLORS[0])
    expect(band).toBeGreaterThanOrEqual(0)
    expect(band).toBeLessThan(firstCurve)
    expect(dot).toBeGreaterThan(lastCurve)
    const arc = ctx.log[dot].pts.find((c) => c.op === 'arc') as Extract<Cmd, { op: 'arc' }>
    expect(arc.x).toBeCloseTo(sxOf(1), 6)
    expect(arc.y).toBeCloseTo(syOf(1), 6)
  })

  it('a board with no marks makes the single overlay call it always made', () => {
    const ovs: Overlay[] = [{ kind: 'area', curveId: 'f', from: 0, to: 1 }]
    expect(hasOverlayMarks(ovs)).toBe(false)
    const a = paint({ overlays: ovs })
    // save/restore pairs: one per drawOverlays call, so the count is unchanged
    const b = paint({ overlays: [...ovs, { kind: 'dot', at: { x: 0, y: 0 }, color: '#ffffff' }] })
    expect(b.saveCount - a.saveCount).toBe(1)
  })

  it('the band breaks where either edge is undefined', () => {
    const ctx = paint({
      overlays: [
        {
          kind: 'band',
          curveId: 'p',
          xs: [-2, -1, 0, 1, 2],
          lo: [-1, -1, Number.NaN, -1, -1],
          hi: [1, 1, 1, 1, 1],
        },
      ],
    })
    expect(ctx.log.filter((e) => e.op === 'fill' && e.style === CURVE_COLORS[1])).toHaveLength(2)
  })

  it('the axis strip: a bar on y = 0, ● and ○ at the ends, arrows at ±∞', () => {
    const closedOpen = paint({
      overlays: [{ kind: 'axisStrip', curveId: 'p', from: -1, to: 1, left: 'open', right: 'closed' }],
    })
    const mine = closedOpen.log.filter((e) => e.style === CURVE_COLORS[1] && !e.path)
    const bar = mine.find((e) => e.op === 'stroke' && e.pts.length === 2 && e.pts[0].op === 'moveTo')
    expect(bar).toBeTruthy()
    const [m, l] = bar!.pts as { x: number; y: number }[]
    expect(m.y).toBeCloseTo(syOf(0), 6)
    expect(m.x).toBeCloseTo(sxOf(-1), 6)
    expect(l.x).toBeCloseTo(sxOf(1), 6)
    // ○ at −1 is a ground-filled centre then a ring; ● at 1 is a fill in the colour
    const groundFill = closedOpen.log.find((e) => e.op === 'fill' && e.style === DARK_THEME.bg && e.pts.some((c) => c.op === 'arc'))
    expect(groundFill).toBeTruthy()
    const solid = mine.find((e) => e.op === 'fill' && e.pts.some((c) => c.op === 'arc' && Math.abs(c.x - sxOf(1)) < 1e-6))
    expect(solid).toBeTruthy()

    const entire = paint({
      overlays: [{ kind: 'axisStrip', curveId: 'p', from: -Infinity, to: Infinity, left: 'none', right: 'none' }],
    })
    const tips = entire.log.filter((e) => e.op === 'fill' && e.style === CURVE_COLORS[1] && e.pts.filter((c) => c.op === 'lineTo').length === 2)
    expect(tips).toHaveLength(2)
    // no endpoint dots on an entire function
    expect(entire.log.some((e) => e.style === CURVE_COLORS[1] && e.pts.some((c) => c.op === 'arc'))).toBe(false)
  })

  it('SAT: every Taylor mark in the one mono ink, the band a light grey wash', () => {
    const sat = FIGURE_STYLES.sat
    const ctx = paint({
      figure: sat,
      overlays: [
        { kind: 'band', curveId: 'p', xs: [-1, 0, 1], lo: [-2, 0, 0], hi: [0, 0, 2] },
        { kind: 'axisStrip', curveId: 'p', from: -1, to: 1, left: 'closed', right: 'open' },
        { kind: 'segment', curveId: 'p', from: { x: 1, y: 0 }, to: { x: 1, y: 1 }, dashed: true },
        { kind: 'dot', curveId: 'f', at: { x: 1, y: 1 } },
      ],
    })
    const colourful = ctx.log.filter((e) => e.style === CURVE_COLORS[0] || e.style === CURVE_COLORS[1])
    expect(colourful).toEqual([])
    // The band is the fill whose outline starts at x = −1, y = 0 and runs to x = 1.
    const band = ctx.log.find(
      (e) =>
        e.op === 'fill' &&
        e.pts.filter((c) => c.op === 'moveTo' || c.op === 'lineTo').length === 6 &&
        e.pts[0].op === 'moveTo' &&
        Math.abs((e.pts[0] as { x: number }).x - sxOf(-1)) < 1e-6,
    )
    expect(band).toBeTruthy()
    expect(band!.style).toBe(sat.theme.axis)
    expect(band!.alpha).toBeLessThan(0.2)
  })
})

// ===========================================================================
// The card and the legend
// ===========================================================================

describe('the card', () => {
  it('numbers the way a teacher writes them', () => {
    expect(numLabel(0)).toBe('0')
    expect(numLabel(-1)).toBe('−1')
    expect(numLabel(0.5)).toBe('0.5')
    expect(numLabel(Math.PI / 6)).toBe('π/6')
    expect(numLabel(1 / 3)).toBe('1/3')
    expect(sci(2.588e-4)).toBe('2.59 × 10⁻⁴')
    expect(sci(0.0123)).toBe('0.0123')
    expect(sci(Infinity)).toBe('∞')
    expect(pName(3)).toBe('P₃')
    expect(pName(12)).toBe('P₁₂')
  })

  it('the interval of convergence line is always honest', () => {
    expect(iocLine(null).text).toBe('Interval of convergence: could not be determined')
    const conv = {
      R: 1, exactR: { text: '1', tex: '1', value: 1 }, lo: -1, hi: 1,
      left: 'diverges' as const, right: 'conditional' as const, text: '(−1, 1]', tex: '(-1, 1]',
    }
    const line = iocLine(conv)
    expect(line.text).toBe('Interval of convergence: (−1, 1] · R = 1')
    expect(line.note).toContain('converges conditionally')
    const unk = iocLine({ ...conv, left: 'unknown' })
    expect(unk.note).toContain('could not be decided')
    const entire = iocLine({ ...conv, R: Infinity, exactR: null, lo: -Infinity, hi: Infinity, text: '(−∞, ∞)' })
    expect(entire.text).toBe('Interval of convergence: (−∞, ∞) · R = ∞')
  })

  it('the menu is greyed on a line that calls another curve, with the reason', () => {
    const { models } = typed('y = sin(x)')
    const f = curve('expr_1', [])
    const cards = cardCalc([], [f], models, () => 'f', {}, { f: ['g'] })
    expect(cards.f.canAdd).toBe(true)
    expect(cards.f.taylorBlocked).toBe(TAYLOR_NEEDS_FORMULA)
  })

  it('a centre outside the domain says so, on both cards', () => {
    const { models } = typed('y = sin(x)')
    const f = curve('expr_1', [], { domain: [-1, 1] })
    const p = curve('tay_T', [], { id: 'p' })
    const cards = cardCalc([{ ...LINK, a: 3 }], [f, p], { ...models, tay_T: taylorChildModel(null, 'tay_T', 3) }, () => 'f', { f: 'f' })
    expect(cards.f.taylors).toHaveLength(1)
    const row = cards.f.taylors[0]
    if (coreLive) expect(row.problem).toBe('a = 3 is outside the domain of f')
    else expect(row.problem).toBeTruthy()
    expect(cards.p.origin!.kind).toBe('taylor')
    expect(cards.p.origin!.problem).toBe(row.problem)
  })

  live('sin x at a = 0, n = 3, probe 0.5: the readouts and the bounds', () => {
    const { f, p, L, models } = sinPair({ x: 0.5 })
    const cards = cardCalc([L], [f, p], models, () => 'f', { f: 'f' })
    const row = cards.f.taylors[0]
    expect(row.problem).toBeNull()
    expect(row.name).toBe('P₃')
    expect(row.aText).toBe('0')
    expect(row.tex).not.toBe('')
    expect(row.iocText).toBe('Interval of convergence: (−∞, ∞) · R = ∞')
    const pr = row.probe!
    expect(pr.p).toBe(`P₃(0.5) = ${Number((0.5 - 0.125 / 6).toPrecision(7))}`)
    expect(pr.f).toBe(`f(0.5) = ${Number(Math.sin(0.5).toPrecision(7))}`)
    expect(pr.error).toContain('|f(0.5) − P₃(0.5)| = ')
    expect(pr.lagrange).toContain('Lagrange')
    expect(pr.alternating).toContain('Alternating series')
    expect(cards.p.origin!.lead).toBe('P₃: Taylor polynomial of f about a = 0')
  })

  it('an empty model draws nothing, never throws', () => {
    const m = taylorChildModel(null, 'tay_T', 4)
    expect(m.id).toBe('tay_T')
    expect(m.kind).toBe('explicit')
    expect(Number.isNaN(m.evalExplicit!([], 1))).toBe(true)
    expect(m.latex([])).toContain('P_{4}')
  })
})

describe('the legend and the names', () => {
  it('the legend says P₃ about a = 0', () => {
    const entries = [{ id: 'p', color: '#fff', tex: 'P_{3}(x) = x', text: 'P₃(x) = x' }]
    const out = labelLegend(entries, [LINK])
    expect(out[0].text).toBe('P₃ about a = 0')
    expect(out[0].tex).toContain('\\text{about }a = 0')
    const pi = labelLegend(entries, [{ ...LINK, a: Math.PI / 6, n: 5 }])
    expect(pi[0].text).toBe('P₅ about a = π/6')
  })

  it('a figure calls the Taylor curve Pₙ, so a caption reads "f and P₃"', () => {
    const names = withTaylorNames({ f: 'f', p: 'g' }, [LINK])
    expect(names).toEqual({ f: 'f', p: 'P₃' })
    // a hidden (unnamed) Taylor curve stays out
    expect(withTaylorNames({ f: 'f' }, [LINK])).toEqual({ f: 'f' })
    expect(withTaylorNames({ f: 'f' }, [LINK], new Set(['f']))).toEqual({ f: 'f' })
    // one the naming left out but that IS on the board is named Pₙ all the same
    expect(withTaylorNames({ f: 'f' }, [LINK], new Set(['f', 'p']))).toEqual({ f: 'f', p: 'P₃' })
    // nothing to rename: the same object back
    const same = { f: 'f' }
    expect(withTaylorNames(same, [])).toBe(same)
  })
})

describe('dragging the centre', () => {
  const dec = (x: number): number => Math.round(x / 0.2) * 0.2
  it('lands on the decimal ladder', () => {
    expect(snapCenter(0.93, 60, dec)).toBeCloseTo(1, 12)
    expect(snapCenter(0.37, 60, dec)).toBeCloseTo(0.4, 12)
  })
  it('near a multiple of π/12 it lands on π/6, π/4 …', () => {
    expect(snapCenter(0.53, 60, dec)).toBe(Math.PI / 6)
    expect(snapCenter(Math.PI / 4 - 0.02, 60, dec)).toBe(Math.PI / 4)
  })
  it('a whole number within reach stays the whole number', () => {
    expect(snapCenter(1.04, 60, dec)).toBeCloseTo(1, 12)
  })
  it('on a π axis the π ladder decides', () => {
    expect(snapCenter(0.4, 60, dec, true, () => Math.PI / 8)).toBe(Math.PI / 8)
  })
})

// ============================================================================
// tests/scatter.render.test.ts — data sets as a scatter plot, and residuals.
//
// What this file exists to hold:
//
//  1. The data sits ON TOP of the fitted curve and UNDER the shapes and the
//     analysis layer — a class judges a fit by the points against the line.
//  2. Each marker kind is the glyph it says, at 3.5 × present.stroke, with a
//     ground rim where the glyph is filled.
//  3. Under a mono figure style the ink is the axis ink; on a light ground it
//     is the print palette — the same ink the curves go through.
//  4. A residual is a vertical segment that ENDS ON THE CURVE, at half alpha,
//     under every marker, and only where the curve is defined.
//  5. Off-board points are culled; NaN rows are skipped; 10 000 points are one
//     path per glyph and draw inside a frame.
//  6. No data (absent, [] or all hidden) is byte-identical to the board
//     before this layer existed.
// ============================================================================

import { describe, it, expect } from 'vitest'
import { renderBoard, type BoardScene, type ScatterSet, type Shape } from '../src/ui/renderBoard'
import {
  SCATTER_CROSS_WIDTH,
  SCATTER_R,
  SCATTER_RESIDUAL_ALPHA,
  SCATTER_RESIDUAL_WIDTH,
  SCATTER_RIM,
  SCATTER_RING_WIDTH,
  SCATTER_SQUARE_HALF,
  drawScatter,
} from '../src/render/scatter'
import { MockCtx, MockPath2D, withMockPath2D, type Cmd } from './mockCanvas'
import { MODELS } from '../src/core/fit/models'
import {
  CURVE_COLORS,
  DARK_THEME,
  FIGURE_STYLES,
  LIGHT_THEME,
  PRINT_CURVE_COLORS,
} from '../src/core/types'
import type { FittedCurve, Vec2, Viewport } from '../src/core/types'

const VP: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 900, heightPx: 700 }

const DATA_COLOR = CURVE_COLORS[2]
const DATA_PRINT = PRINT_CURVE_COLORS[2]

/** y = 0.5x² — the fitted curve the data is judged against. */
const PARA: FittedCurve = {
  id: 'fit', modelId: 'poly2', params: [0, 0, 0.5],
  kind: 'explicit', domain: null,
  color: CURVE_COLORS[0], strokeWidth: 2.5, visible: true, error: 0,
}
const f = (x: number): number => 0.5 * x * x

const px = (p: Vec2, vp: Viewport = VP) => ({
  x: vp.widthPx / 2 + (p.x - vp.center.x) * vp.pxPerUnit,
  y: vp.heightPx / 2 - (p.y - vp.center.y) * vp.pxPerUnit,
})

const XS = [-2, -1, 0, 1, 2]
const YS = [2.3, 0.2, 0.4, 0.3, 1.6]

const set = (over: Partial<ScatterSet> = {}): ScatterSet => ({
  id: 'd', xs: XS, ys: YS, color: DATA_COLOR, visible: true, ...over,
})

// ---------------------------------------------------------------------------
// A MockCtx that logs every paint op in ORDER, with the geometry it consumed
// and the state it was painted in (the device tests/shapes.render.test.ts uses).
// ---------------------------------------------------------------------------

interface Arc { x: number; y: number; r: number }
interface PaintOp {
  op: 'fill' | 'stroke' | 'text'
  style: string
  lw: number
  alpha: number
  path: boolean
  arcs: Arc[]
  runs: Array<Array<{ x: number; y: number }>>
  closes: number
}

class LogCtx extends MockCtx {
  log: PaintOp[] = []
  private mark = 0
  private note(op: PaintOp['op'], path: boolean): void {
    const runs: PaintOp['runs'] = []
    const arcs: Arc[] = []
    let closes = 0
    let cur: Array<{ x: number; y: number }> | null = null
    for (const c of this.own.cmds.slice(this.mark) as Cmd[]) {
      if (c.op === 'moveTo') { cur = [{ x: c.x, y: c.y }]; runs.push(cur) }
      else if (c.op === 'lineTo' && cur) cur.push({ x: c.x, y: c.y })
      else if (c.op === 'arc') arcs.push({ x: c.x, y: c.y, r: c.r })
      else if (c.op === 'closePath') closes++
    }
    this.mark = this.own.cmds.length
    this.log.push({
      op, path, arcs, runs, closes,
      style: op === 'stroke' ? this.strokeStyle : this.fillStyle,
      lw: this.lineWidth, alpha: this.globalAlpha,
    })
  }
  override fill(): void { this.note('fill', false); super.fill() }
  override stroke(p?: MockPath2D): void { this.note('stroke', p !== undefined); super.stroke(p) }
  override fillText(t: string, x: number, y: number): void {
    this.note('text', false); super.fillText(t, x, y)
  }
}

function scene(over: Partial<BoardScene> = {}): BoardScene {
  return {
    vp: VP, theme: DARK_THEME, curves: [PARA], styles: {}, models: MODELS,
    analysis: null, chrome: null, ...over,
  }
}

function render(s: BoardScene): LogCtx {
  const ctx = new LogCtx()
  withMockPath2D(() => renderBoard(ctx as unknown as CanvasRenderingContext2D, s))
  return ctx
}

/** The ops the scatter layer painted: everything in the data ink or the ground, off-path, with arcs/runs. */
const opsIn = (ctx: LogCtx, style: string): PaintOp[] =>
  ctx.log.filter((e) => e.style === style && !e.path)

const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps

// ===========================================================================

describe('scatter — layer order', () => {
  it('draws after the curve stroke and before the shapes', () => {
    const shape: Shape = {
      kind: 'segment', id: 's', a: { x: -3, y: -1 }, b: { x: 3, y: -1 },
      color: CURVE_COLORS[4], visible: true,
    }
    const ctx = render(scene({ scatter: [set()], shapes: [shape] }))
    const curve = ctx.log.findIndex((e) => e.path && e.style === PARA.color)
    const data = ctx.log.findIndex((e) => !e.path && e.style === DATA_COLOR)
    const shp = ctx.log.findIndex((e) => !e.path && e.style === CURVE_COLORS[4])
    expect(curve, 'the curve was never stroked').toBeGreaterThanOrEqual(0)
    expect(data, 'the data was never drawn').toBeGreaterThanOrEqual(0)
    expect(shp, 'the shape was never drawn').toBeGreaterThanOrEqual(0)
    expect(curve, 'the data went under the fitted curve').toBeLessThan(data)
    expect(data, 'the shape went under the data').toBeLessThan(shp)
  })

  it('reaches the export (chrome:null) and is the same with chrome on', () => {
    const fig = render(scene({ scatter: [set()], chrome: null }))
    const edit = render(scene({
      scatter: [set()],
      chrome: { selectedId: null, handles: [], activeHandleId: null, highlight: null, openIdx: null, hoverIdx: null },
    }))
    const dots = (c: LogCtx) => opsIn(c, DATA_COLOR).flatMap((e) => e.arcs)
    expect(dots(fig)).toHaveLength(XS.length)
    expect(dots(edit)).toEqual(dots(fig))
  })

  it('a number-line board ignores it', () => {
    const ctx = render(scene({ kind: 'number-line', items: [], scatter: [set()] }))
    expect(opsIn(ctx, DATA_COLOR)).toHaveLength(0)
  })
})

describe('scatter — marker geometry', () => {
  const at = XS.map((x, i) => px({ x, y: YS[i] }))
  const fills = (ctx: LogCtx, style: string) => ctx.log.filter((e) => e.op === 'fill' && e.style === style && !e.path)
  /** A quad's four corners → its centre line's two ends and its thickness. */
  const armOf = (q: Array<{ x: number; y: number }>) => ({
    a: { x: (q[0].x + q[3].x) / 2, y: (q[0].y + q[3].y) / 2 },
    b: { x: (q[1].x + q[2].x) / 2, y: (q[1].y + q[2].y) / 2 },
    width: Math.hypot(q[0].x - q[3].x, q[0].y - q[3].y),
  })

  it('the layer strokes nothing: every glyph is a fill (see the file header)', () => {
    for (const marker of ['dot', 'ring', 'cross', 'square'] as const) {
      const plain = render(scene())
      const ctx = render(scene({ scatter: [set({ marker, residualsTo: PARA.id })] }))
      expect(ctx.strokeCount, marker).toBe(plain.strokeCount)
      expect(ctx.own.cmds.filter((c) => c.op === 'closePath').length, marker)
        .toBe(plain.own.cmds.filter((c) => c.op === 'closePath').length)
    }
  })

  it("'dot' (the default): a ground rim disc UNDER the ink disc", () => {
    const ctx = render(scene({ scatter: [set()] }))
    const rim = fills(ctx, DARK_THEME.bg).find((e) => e.arcs.length === XS.length)!
    const disc = fills(ctx, DATA_COLOR)[0]
    expect(rim, 'no ground rim').toBeDefined()
    expect(disc, 'no disc').toBeDefined()
    expect(ctx.log.indexOf(rim)).toBeLessThan(ctx.log.indexOf(disc))
    for (const a of rim.arcs) expect(a.r).toBeCloseTo(SCATTER_R + SCATTER_RIM)
    expect(disc.arcs.map((a) => ({ x: a.x, y: a.y }))).toEqual(at)
    for (const a of disc.arcs) expect(a.r).toBeCloseTo(SCATTER_R)
    // one moveTo per disc, so no disc is joined to the next by a chord
    expect(disc.runs).toHaveLength(XS.length)
  })

  it('every radius follows present.stroke', () => {
    const ctx = render(scene({ scatter: [set()], present: { type: 1, stroke: 2 } }))
    for (const a of fills(ctx, DATA_COLOR)[0].arcs) expect(a.r).toBeCloseTo(2 * SCATTER_R)
    const rim = fills(ctx, DARK_THEME.bg).find((e) => e.arcs.length === XS.length)!
    for (const a of rim.arcs) expect(a.r).toBeCloseTo(2 * (SCATTER_R + SCATTER_RIM))
  })

  it("'ring': an ink ring 1.5px wide centred on r, ground inside", () => {
    const ctx = render(scene({ scatter: [set({ marker: 'ring' })] }))
    const ink = fills(ctx, DATA_COLOR)[0]
    const inside = fills(ctx, DARK_THEME.bg).find((e) => e.arcs.length === XS.length)!
    expect(ink).toBeDefined()
    expect(inside).toBeDefined()
    expect(ctx.log.indexOf(ink)).toBeLessThan(ctx.log.indexOf(inside))
    for (const a of ink.arcs) expect(a.r).toBeCloseTo(SCATTER_R + SCATTER_RING_WIDTH / 2)
    for (const a of inside.arcs) expect(a.r).toBeCloseTo(SCATTER_R - SCATTER_RING_WIDTH / 2)
    expect(ink.arcs.map((a) => ({ x: a.x, y: a.y }))).toEqual(at)
  })

  it("'cross': two 2px arms per point, corner to corner of the r-box, over a ground underlay", () => {
    const ctx = render(scene({ scatter: [set({ marker: 'cross' })] }))
    const ink = fills(ctx, DATA_COLOR)[0]
    expect(ink.arcs).toHaveLength(0)
    expect(ink.runs).toHaveLength(2 * XS.length)
    const r = SCATTER_R
    const c = at[0]
    const back = armOf(ink.runs[0])
    const fwd = armOf(ink.runs[1])
    expect(back.width).toBeCloseTo(SCATTER_CROSS_WIDTH)
    expect(fwd.width).toBeCloseTo(SCATTER_CROSS_WIDTH)
    expect(back.a.x).toBeCloseTo(c.x + r); expect(back.a.y).toBeCloseTo(c.y + r)
    expect(back.b.x).toBeCloseTo(c.x - r); expect(back.b.y).toBeCloseTo(c.y - r)
    expect(fwd.a.x).toBeCloseTo(c.x + r); expect(fwd.a.y).toBeCloseTo(c.y - r)
    expect(fwd.b.x).toBeCloseTo(c.x - r); expect(fwd.b.y).toBeCloseTo(c.y + r)
    // both arms wound the same way, so the non-zero fill keeps their overlap
    const area = (q: Array<{ x: number; y: number }>) =>
      q.reduce((s, p, i) => s + p.x * q[(i + 1) % q.length].y - q[(i + 1) % q.length].x * p.y, 0) / 2
    expect(Math.sign(area(ink.runs[0]))).toBe(Math.sign(area(ink.runs[1])))
    // a wider ground underlay first
    const under = fills(ctx, DARK_THEME.bg).find((e) => e.runs.length === 2 * XS.length)!
    expect(under).toBeDefined()
    expect(armOf(under.runs[0]).width).toBeCloseTo(SCATTER_CROSS_WIDTH + 2 * SCATTER_RIM)
    expect(ctx.log.indexOf(under)).toBeLessThan(ctx.log.indexOf(ink))
  })

  it("'square': a filled square of the dot's area, over a ground rim", () => {
    const ctx = render(scene({ scatter: [set({ marker: 'square' })] }))
    const sq = fills(ctx, DATA_COLOR)[0]
    expect(sq.arcs).toHaveLength(0)
    expect(sq.runs).toHaveLength(XS.length)
    const h = SCATTER_SQUARE_HALF * SCATTER_R
    expect((2 * h) ** 2).toBeCloseTo(Math.PI * SCATTER_R ** 2)
    const c = at[1]
    const xs = sq.runs[1].map((p) => p.x)
    const ys = sq.runs[1].map((p) => p.y)
    expect(Math.min(...xs)).toBeCloseTo(c.x - h)
    expect(Math.max(...xs)).toBeCloseTo(c.x + h)
    expect(Math.min(...ys)).toBeCloseTo(c.y - h)
    expect(Math.max(...ys)).toBeCloseTo(c.y + h)
    const rim = fills(ctx, DARK_THEME.bg).find((e) => e.runs.length === XS.length)!
    expect(rim).toBeDefined()
    expect(Math.max(...rim.runs[1].map((p) => p.x))).toBeCloseTo(c.x + h + SCATTER_RIM)
    expect(ctx.log.indexOf(rim)).toBeLessThan(ctx.log.indexOf(sq))
  })
})

describe('scatter — ink', () => {
  it('a light ground maps the data to the print palette', () => {
    const ctx = render(scene({ theme: LIGHT_THEME, scatter: [set()] }))
    expect(opsIn(ctx, DATA_PRINT).length).toBeGreaterThan(0)
    expect(opsIn(ctx, DATA_COLOR)).toHaveLength(0)
  })

  it('a mono figure (SAT, AP) draws the data in the axis ink, as dots', () => {
    for (const fig of [FIGURE_STYLES.sat, FIGURE_STYLES.ap]) {
      const ctx = render(scene({ figure: fig, scatter: [set()] }))
      expect(opsIn(ctx, DATA_COLOR)).toHaveLength(0)
      expect(opsIn(ctx, DATA_PRINT)).toHaveLength(0)
      const disc = ctx.log.find((e) => e.op === 'fill' && e.style === fig.theme.axis && e.arcs.length === XS.length)
      expect(disc, `${fig.id}: no axis-ink dots`).toBeDefined()
      for (const a of disc!.arcs) expect(a.r).toBeCloseTo(SCATTER_R)
    }
  })

  it('an explicit marker survives mono', () => {
    const ctx = render(scene({ figure: FIGURE_STYLES.sat, scatter: [set({ marker: 'cross' })] }))
    const ink = ctx.log.find((e) => e.op === 'fill' && e.style === '#000000' && e.runs.length === 2 * XS.length)
    expect(ink).toBeDefined()
  })
})

describe('scatter — residuals', () => {
  const residualOps = (ctx: LogCtx, color = DATA_COLOR) =>
    ctx.log.filter((e) => e.op === 'fill' && e.style === color && e.alpha === SCATTER_RESIDUAL_ALPHA)
  /** A residual quad → the x of its centre line, its two ends, its width. */
  const seg = (q: Array<{ x: number; y: number }>) => ({
    x: (q[0].x + q[1].x) / 2,
    from: q[0].y,
    to: q[2].y,
    width: Math.abs(q[1].x - q[0].x),
  })

  it('one vertical segment per point, ending ON the curve, under the markers', () => {
    const ctx = render(scene({ scatter: [set({ residualsTo: PARA.id })] }))
    const res = residualOps(ctx)
    expect(res).toHaveLength(1)
    const r = res[0]
    expect(r.runs).toHaveLength(XS.length)
    r.runs.forEach((run, i) => {
      const p = px({ x: XS[i], y: YS[i] })
      const q = px({ x: XS[i], y: f(XS[i]) })
      const s = seg(run)
      expect(run).toHaveLength(4)
      expect(s.width).toBeCloseTo(SCATTER_RESIDUAL_WIDTH)
      expect(s.x).toBeCloseTo(p.x)
      expect(run[0].x).toBeCloseTo(run[3].x)
      expect(run[1].x).toBeCloseTo(run[2].x)
      expect(s.from).toBeCloseTo(p.y)
      expect(s.to, `residual ${i} does not end on the curve`).toBeCloseTo(q.y)
    })
    const disc = ctx.log.findIndex((e) => e.op === 'fill' && e.style === DATA_COLOR && e.alpha === 1)
    expect(ctx.log.indexOf(r)).toBeLessThan(disc)
  })

  it('its width follows present.stroke', () => {
    const ctx = render(scene({ scatter: [set({ residualsTo: PARA.id })], present: { type: 1, stroke: 3 } }))
    expect(seg(residualOps(ctx)[0].runs[0]).width).toBeCloseTo(3 * SCATTER_RESIDUAL_WIDTH)
  })

  it("every set's residuals go under every set's markers", () => {
    const other = set({ id: 'e', color: CURVE_COLORS[5], xs: [0.5], ys: [2], residualsTo: PARA.id })
    const ctx = render(scene({ scatter: [set({ residualsTo: PARA.id }), other] }))
    const lastResidual = Math.max(
      ctx.log.indexOf(residualOps(ctx)[0]),
      ctx.log.indexOf(residualOps(ctx, CURVE_COLORS[5])[0]),
    )
    const firstMarker = ctx.log.findIndex(
      (e) => e.op === 'fill' && e.alpha === 1 && (e.style === DATA_COLOR || e.style === CURVE_COLORS[5] || e.style === DARK_THEME.bg),
    )
    expect(residualOps(ctx, CURVE_COLORS[5])).toHaveLength(1)
    expect(lastResidual).toBeGreaterThanOrEqual(0)
    expect(lastResidual).toBeLessThan(firstMarker)
  })

  it('skips x where the curve is undefined (outside its domain)', () => {
    const half: FittedCurve = { ...PARA, domain: [-0.5, 5] }
    const ctx = render(scene({ curves: [half], scatter: [set({ residualsTo: PARA.id })] }))
    const r = residualOps(ctx)[0]
    // x = -2 and -1 are outside [-0.5, 5]
    expect(r.runs.map((run) => seg(run).x)).toEqual([0, 1, 2].map((x) => px({ x, y: 0 }).x))
  })

  it('draws none to a hidden curve, an unknown id, or a non-explicit curve', () => {
    const hidden = render(scene({ curves: [{ ...PARA, visible: false }], scatter: [set({ residualsTo: PARA.id })] }))
    expect(residualOps(hidden)).toHaveLength(0)
    const unknown = render(scene({ scatter: [set({ residualsTo: 'nope' })] }))
    expect(residualOps(unknown)).toHaveLength(0)
    const circle: FittedCurve = {
      id: 'circ', modelId: 'circle', params: [0, 0, 2], kind: 'parametric', domain: null,
      color: CURVE_COLORS[1], strokeWidth: 2.5, visible: true, error: 0,
    }
    const param = render(scene({ curves: [circle], scatter: [set({ residualsTo: 'circ' })] }))
    expect(residualOps(param)).toHaveLength(0)
    // …and the markers still draw in every case
    expect(opsIn(unknown, DATA_COLOR).length).toBeGreaterThan(0)
  })

  it('a residual to a curve far off the board is clamped, not dropped', () => {
    // x = 7 is on the board; f(7) = 24.5 is far above it
    const ctx = render(scene({ scatter: [set({ xs: [7], ys: [0], residualsTo: PARA.id })] }))
    const s = seg(residualOps(ctx)[0].runs[0])
    expect(s.from).toBeCloseTo(px({ x: 7, y: 0 }).y)
    expect(s.to).toBeLessThan(0)
    expect(s.to).toBeGreaterThan(-10)
  })

  it('under mono ink the residuals are axis ink at half alpha', () => {
    const ctx = render(scene({ figure: FIGURE_STYLES.sat, scatter: [set({ residualsTo: PARA.id })] }))
    expect(residualOps(ctx, '#000000')).toHaveLength(1)
  })
})

describe('scatter — robustness and cost', () => {
  it('skips non-finite rows and a ragged tail', () => {
    const ctx = render(scene({
      scatter: [set({ xs: [0, NaN, 1, 2, Infinity, 3], ys: [0, 1, NaN, 2, 1] })],
    }))
    const disc = ctx.log.find((e) => e.op === 'fill' && e.style === DATA_COLOR)!
    expect(disc.arcs.map((a) => ({ x: a.x, y: a.y }))).toEqual([
      px({ x: 0, y: 0 }), px({ x: 2, y: 2 }),
    ])
  })

  it('culls points off the board, keeps one whose glyph pokes onto it', () => {
    // board is x ∈ [-7.5, 7.5], y ∈ [-5.83, 5.83]
    const xs = [0, 100, -1e9, 0, 7.5 + 2 / 60, 0]
    const ys = [0, 0, 0, 1e12, 0, -5.9]
    const ctx = render(scene({ scatter: [set({ xs, ys })] }))
    const disc = ctx.log.find((e) => e.op === 'fill' && e.style === DATA_COLOR)!
    expect(disc.arcs.map((a) => ({ x: a.x, y: a.y }))).toEqual([
      px({ x: 0, y: 0 }), px({ x: 7.5 + 2 / 60, y: 0 }), px({ x: 0, y: -5.9 }),
    ])
  })

  it('a set that is entirely off the board issues no paint at all', () => {
    const ctx = render(scene({ scatter: [set({ xs: [500, 600], ys: [0, 0] })] }))
    expect(opsIn(ctx, DATA_COLOR)).toHaveLength(0)
  })

  it('10 000 points: one path per glyph, under 8 ms', () => {
    const N = 10_000
    const xs: number[] = []
    const ys: number[] = []
    for (let i = 0; i < N; i++) {
      const x = -7 + (14 * i) / N
      xs.push(x)
      ys.push(f(x) + Math.sin(i * 12.9898) * 0.8)
    }
    const big = set({ xs, ys, residualsTo: PARA.id })

    // Paint-op count is independent of N: the batching is the contract.
    const ctx = render(scene({ scatter: [big] }))
    const dataOps = ctx.log.filter((e) => !e.path && (e.style === DATA_COLOR || e.style === DARK_THEME.bg) && (e.arcs.length > 0 || e.runs.length > 100))
    // residuals (1 fill) + rim (1 fill) + disc (1 fill)
    expect(dataOps).toHaveLength(3)

    // Time the layer against a context that does nothing: the renderer's own
    // cost (cull, transform, residual evaluation, path building). Best of a
    // few runs, so a JIT warm-up or a GC pause is not what is measured.
    const noop = new Proxy({} as Record<string, unknown>, {
      get: (t, k) => (k in t ? t[k] : () => undefined),
      set: (t, k, v) => { t[k as string] = v; return true },
    }) as unknown as CanvasRenderingContext2D
    const curveAt = (id: string) => (id === PARA.id ? (x: number) => f(x) : null)
    let best = Infinity
    for (let run = 0; run < 7; run++) {
      const t0 = performance.now()
      drawScatter(noop, [big], { vp: VP, theme: DARK_THEME, curveAt })
      best = Math.min(best, performance.now() - t0)
    }
    expect(best).toBeLessThan(8)
  })
})

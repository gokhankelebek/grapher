// ============================================================================
// tests/stretchedAxes.render.test.ts — independent x and y scales, the render
// half (see the contract under toScreen/toMath in src/core/types.ts).
//
// What this file holds the renderer to:
//
//  1. BYTE IDENTITY. A viewport that states pxPerUnitY equal to pxPerUnit is
//     the same board as one that does not state it, down to every call and
//     every property assignment on the context, for a scene that exercises
//     every layer, in every figure style.
//  2. The grid rules each axis from its own scale: x ticks every 5 years and
//     y ticks every 100 000 on a years-against-population board.
//  3. Every direction is a SCREEN direction: slope-field segments, vector
//     heads, end-cap arrows, residuals, asymptote lines.
//  4. A stretched board never draws a polar ruling.
//  5. exportFit fits x and y independently when the board is stretched.
// ============================================================================

import { describe, it, expect } from 'vitest'

import { renderBoard, type BoardScene } from '../src/ui/renderBoard'
import { drawGrid, pickTickStep, pickPiTickStep, SCREEN_GRID, type GridStyle } from '../src/render/grid'
import { drawPolarGrid } from '../src/render/polarGrid'
import { drawSlopeFields } from '../src/render/fields'
import { drawShapes, SHAPE_ARROW_LEN } from '../src/render/shapes'
import { drawScatter, SCATTER_RESIDUAL_WIDTH } from '../src/render/scatter'
import { drawCurveEnds, END_ARROW_LEN } from '../src/render/endCaps'
import { drawCurve } from '../src/render/curves'
import { exportViewport, fitViewport, FIT_PAD, type FitExportSettings } from '../src/ui/exportFit'
import { DEFAULT_EXPORT } from '../src/ui/renderBoard'
import { MockCtx, MockPath2D, withMockPath2D, type Cmd } from './mockCanvas'
import { MODELS } from '../src/core/fit/models'
import { parseExpression } from '../src/core/parse'
import { analyzeCurve } from '../src/core/analyze'
import {
  CURVE_COLORS,
  DARK_THEME,
  FIGURE_STYLES,
  ppuX,
  ppuY,
  toMath,
  toScreen,
} from '../src/core/types'
import type { FittedCurve, ModelSpec, Viewport, Vec2 } from '../src/core/types'

// ---------------------------------------------------------------------------
// A context that records EVERYTHING: every method call with its arguments
// (a Path2D argument by its commands) and every property assignment, in order.
// Two renders are the same board exactly when these logs are equal.
// ---------------------------------------------------------------------------

function recordingCtx(): { ctx: CanvasRenderingContext2D; log: unknown[] } {
  const log: unknown[] = []
  const base = new MockCtx()
  const ser = (a: unknown): unknown => (a instanceof MockPath2D ? { path: a.cmds.slice() } : a)
  const proxy = new Proxy(base, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv)
      if (typeof v === 'function' && typeof prop === 'string') {
        return (...args: unknown[]) => {
          log.push([prop, ...args.map(ser)])
          return (v as (...a: unknown[]) => unknown).apply(target, args)
        }
      }
      return v
    },
    set(target, prop, value) {
      log.push(['=', String(prop), value])
      return Reflect.set(target, prop, value)
    },
  })
  return { ctx: proxy as unknown as CanvasRenderingContext2D, log }
}

function curveFrom(
  id: string,
  src: string,
  color: string,
  over: Partial<FittedCurve> = {},
): { curve: FittedCurve; models: Record<string, ModelSpec> } {
  const p = parseExpression(src)
  if (!p.ok) throw new Error(`${src}: ${p.error}`)
  const modelId = `m_${id}`
  return {
    curve: {
      id,
      modelId,
      params: p.plot.defaultParams,
      kind: p.plot.kind,
      domain: p.plot.domain,
      color,
      strokeWidth: 2.5,
      visible: true,
      error: 0,
      ...over,
    },
    models: { [modelId]: p.plot.makeModel(modelId) },
  }
}

// x in [-7.5, 7.5], y in [-5, 5]
const VP: Viewport = { center: { x: 0.25, y: -0.5 }, pxPerUnit: 60, widthPx: 900, heightPx: 600 }

function richScene(vp: Viewport): BoardScene {
  const parts = [
    curveFrom('cub', 'y = x^3/4 - x', CURVE_COLORS[0], { domain: [-3, 2.5] }),
    curveFrom('exp', 'y = 2^x + 1', CURVE_COLORS[1]),
    curveFrom('rat', 'y = (x^2 - 1)/(x - 1)', CURVE_COLORS[2]),
    curveFrom('sla', 'y = x/2 + 1/x', CURVE_COLORS[3]),
    curveFrom('ell', 'x^2/9 + y^2/4 = 1', CURVE_COLORS[4]),
    curveFrom('ros', 'r = 2cos(3θ)', CURVE_COLORS[5]),
    curveFrom('sin', 'y = sin(x)', CURVE_COLORS[0], { domain: [-6, 6] }),
  ]
  const models: Record<string, ModelSpec> = { ...MODELS }
  for (const p of parts) Object.assign(models, p.models)
  const curves = parts.map((p) => p.curve)
  // a parametric library curve and a vertical line
  curves.push({
    id: 'vl', modelId: 'vline', params: [4.5], kind: 'parametric', domain: null,
    color: CURVE_COLORS[2], strokeWidth: 2, visible: true, error: 0,
  })
  const cub = curves[0]
  let points: ReturnType<typeof analyzeCurve> = []
  try {
    points = analyzeCurve(cub, models)
  } catch {
    points = []
  }
  return {
    vp,
    theme: DARK_THEME,
    curves,
    styles: {},
    models,
    analysis: { curve: cub, points },
    overlays: [
      { kind: 'area', curveId: 'cub', from: -2, to: 1 },
      {
        kind: 'rects',
        curveId: 'exp',
        rects: [
          { x0: -2, x1: -1, height: 1.25 },
          { x0: -1, x1: 0, height: 1.5 },
        ],
      },
      { kind: 'region', boundary: [{ x: 3, y: 1 }, { x: 5, y: 1 }, { x: 4, y: 3 }] },
    ],
    fields: [
      {
        id: 'sf', f: (x: number, y: number) => x - y, latex: 'x-y',
        color: CURVE_COLORS[1], visible: true,
      },
    ],
    polylines: [
      { id: 'pl', pts: [{ x: -4, y: -4 }, { x: -2, y: -3 }, { x: 0, y: -3.5 }], color: CURVE_COLORS[3] },
    ],
    shapes: [
      { kind: 'point', id: 'p', at: { x: 1, y: 2 }, color: CURVE_COLORS[0], visible: true, label: 'A' },
      { kind: 'segment', id: 's', a: { x: -1, y: -1 }, b: { x: 2, y: -2 }, color: CURVE_COLORS[1], visible: true, labels: ['B', 'C'] },
      { kind: 'vector', id: 'v', tail: { x: -5, y: 1 }, v: { x: 2, y: 1.5 }, color: CURVE_COLORS[2], visible: true, label: 'u' },
      {
        kind: 'polygon', id: 'g', pts: [{ x: 2, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 4 }],
        color: CURVE_COLORS[3], visible: true, fill: true, labels: ['D', 'E', 'F'],
      },
    ],
    scatter: [
      {
        id: 'd', xs: [-3, -2, -1, 0, 1, 2, 3], ys: [-2, 0.5, 1, 0.2, -0.3, 0.4, 3],
        color: CURVE_COLORS[4], visible: true, residualsTo: 'cub',
      },
      {
        id: 'd2', xs: [4, 5, 6], ys: [1, 2, 1], color: CURVE_COLORS[5], visible: true, marker: 'cross',
      },
    ],
    curveNames: { cub: 'f', exp: 'g' },
    chrome: {
      selectedId: 'cub',
      handles: [{ id: 'domain-start', pos: { x: -3, y: -3.75 }, kind: 'domain-start' }],
      activeHandleId: null,
      highlight: null,
      openIdx: null,
      hoverIdx: null,
    },
  }
}

function streamOf(scene: BoardScene): string {
  const { ctx, log } = recordingCtx()
  withMockPath2D(() => renderBoard(ctx, scene))
  return JSON.stringify(log)
}

const FIGURES = [undefined, ...Object.values(FIGURE_STYLES)]

// ===========================================================================
// 1. Byte identity
// ===========================================================================

describe('an equal-axes board is the board it always was', () => {
  const variants: Array<[string, Partial<BoardScene>]> = [
    ['plain', {}],
    ['π on x', { axisUnits: { x: 'pi' } }],
    ['presented', { present: { type: 1.5, stroke: 2 } }],
    ['captioned', { caption: 'Graph of f' }],
    ['polar ruling', { grid: 'polar', axisUnits: { x: 'pi' } }],
  ]
  for (const fig of FIGURES) {
    for (const [name, over] of variants) {
      it(`${fig ? fig.id : 'no style'} · ${name}: pxPerUnitY === pxPerUnit draws the same stream`, () => {
        const base = richScene(VP)
        const extra: Partial<BoardScene> = fig ? { figure: fig, theme: fig.theme } : {}
        const a = streamOf({ ...base, ...extra, ...over })
        const b = streamOf({
          ...richScene({ ...VP, pxPerUnitY: VP.pxPerUnit }),
          ...extra,
          ...over,
        })
        expect(a.length).toBeGreaterThan(10000) // the scene really did draw
        expect(b === a).toBe(true)
      })
    }
  }

  it('the rich scene actually reaches every layer', () => {
    const fig = FIGURE_STYLES.sat
    const { ctx, log } = recordingCtx()
    withMockPath2D(() => renderBoard(ctx, { ...richScene(VP), figure: fig, theme: fig.theme }))
    const calls = new Set(log.map((e) => (e as unknown[])[0]))
    for (const op of ['fillText', 'arc', 'stroke', 'fill', 'setLineDash', 'closePath']) {
      expect(calls.has(op), op).toBe(true)
    }
    // dashed asymptotes (SAT marks curve ends) were drawn
    const dashes = log.filter(
      (e) => (e as unknown[])[0] === 'setLineDash' && ((e as unknown[])[1] as number[]).length === 2,
    )
    expect(dashes.length).toBeGreaterThan(0)
  })

  it('exportViewport of an equal-axes board has no pxPerUnitY at all', () => {
    const s: FitExportSettings = { ...DEFAULT_EXPORT, fit: false, aspect: 'auto' }
    const a = exportViewport(VP, s, null, 'graph')
    const b = exportViewport({ ...VP, pxPerUnitY: VP.pxPerUnit }, s, null, 'graph')
    expect(b).toStrictEqual(a)
    expect('pxPerUnitY' in b).toBe(false)
    const box = { min: { x: -2, y: -1 }, max: { x: 3, y: 4 } }
    const fit = { ...s, fit: true }
    expect(exportViewport({ ...VP, pxPerUnitY: 60 }, fit, box, 'graph', [], 30)).toStrictEqual(
      exportViewport(VP, fit, box, 'graph', [], 30),
    )
  })
})

// ===========================================================================
// 2. The grid: one ladder per axis
// ===========================================================================

/** Years 1990–2025 across 900px; y 0…600 000 up 600px. */
const YEARS: Viewport = {
  center: { x: 2007.5, y: 275000 },
  pxPerUnit: 900 / 35,
  pxPerUnitY: 0.001,
  widthPx: 900,
  heightPx: 600,
}

function gridTexts(vp: Viewport, style?: GridStyle | null, units?: { x?: 'pi'; y?: 'pi' }): MockCtx {
  const ctx = new MockCtx()
  drawGrid(ctx as unknown as CanvasRenderingContext2D, vp, DARK_THEME, null, units ?? null, style ?? null)
  return ctx
}

describe('the grid on a stretched board', () => {
  it('picks the x ladder from ppuX and the y ladder from ppuY', () => {
    expect(pickTickStep(ppuX(YEARS)).major).toBe(5)
    expect(pickTickStep(ppuY(YEARS)).major).toBe(100000)
  })

  it('labels x every 5 years and y every 100 000', () => {
    const ctx = gridTexts(YEARS)
    const xs = ctx.texts.filter((t) => t.baseline === 'top' && t.align === 'center').map((t) => t.text)
    const ys = ctx.texts.filter((t) => t.baseline === 'middle').map((t) => t.text)
    expect(xs).toEqual(['1995', '2000', '2005', '2010', '2015', '2020'])
    expect(ys).toEqual(['100000', '200000', '300000', '400000', '500000'])
    // each label sits over its own tick, through each axis' own scale
    for (const t of ctx.texts.filter((t) => t.baseline === 'top' && t.align === 'center')) {
      expect(t.x).toBeCloseTo(toScreen({ x: Number(t.text), y: 0 }, YEARS).x, 9)
    }
    for (const t of ctx.texts.filter((t) => t.baseline === 'middle')) {
      expect(t.y).toBeCloseTo(toScreen({ x: 0, y: Number(t.text) }, YEARS).y, 9)
    }
  })

  it('rules major verticals every 5 years and major horizontals every 100 000', () => {
    const ctx = gridTexts(YEARS)
    const segs: Array<[Vec2, Vec2]> = []
    const cmds = ctx.own.cmds as Cmd[]
    for (let i = 0; i + 1 < cmds.length; i++) {
      const a = cmds[i]
      const b = cmds[i + 1]
      if (a.op === 'moveTo' && b.op === 'lineTo') segs.push([{ x: a.x, y: a.y }, { x: b.x, y: b.y }])
    }
    const verticals = segs.filter(([a, b]) => a.x === b.x && a.y === 0 && b.y === 600)
    const horizontals = segs.filter(([a, b]) => a.y === b.y && a.x === 0 && b.x === 900)
    const yearsAt = verticals.map(([a]) => toMath(a, YEARS).x)
    const popAt = horizontals.map(([a]) => toMath(a, YEARS).y)
    // every major year is ruled (the minors, every year, are ruled too)
    for (let yr = 1990; yr <= 2025; yr += 5) {
      expect(yearsAt.some((v) => Math.abs(v - yr) < 1e-6), String(yr)).toBe(true)
    }
    for (let p = 100000; p <= 500000; p += 100000) {
      expect(popAt.some((v) => Math.abs(v - p) < 1e-3), String(p)).toBe(true)
    }
    // and nothing is ruled at a step the OTHER axis would have picked
    expect(yearsAt.every((v) => Math.abs(v - Math.round(v)) < 1e-6)).toBe(true)
    expect(popAt.every((v) => Math.abs(v / 20000 - Math.round(v / 20000)) < 1e-6)).toBe(true)
  })

  it('keeps π per axis: π along x from ppuX, decimals along y from ppuY', () => {
    const vp: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 60, pxPerUnitY: 6, widthPx: 900, heightPx: 600 }
    const ctx = gridTexts(vp, null, { x: 'pi' })
    const xs = ctx.texts.filter((t) => t.baseline === 'top' && t.align === 'center').map((t) => t.text)
    const ys = ctx.texts.filter((t) => t.baseline === 'middle').map((t) => t.text)
    const pi = pickPiTickStep(60, 80)
    expect(pi.num / pi.den).toBe(0.5)
    expect(xs).toContain('π/2')
    expect(xs).toContain('3π/2')
    // y at 6 px/unit: the 1–2–5 ladder says 20
    expect(pickTickStep(6).major).toBe(20)
    expect(ys).toEqual(['−40', '−20', '20', '40'])
  })

  it("figure 'unit' spacing falls back per axis (x ruled every unit, y on the ladder)", () => {
    const vp: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 40, pxPerUnitY: 4, widthPx: 800, heightPx: 600 }
    const style: GridStyle = { ...SCREEN_GRID, grid: 'ticks', spacing: 'unit', numbers: 'major' }
    const ctx = gridTexts(vp, style)
    const cmds = ctx.own.cmds as Cmd[]
    const axisY = toScreen({ x: 0, y: 0 }, vp).y
    const axisX = toScreen({ x: 0, y: 0 }, vp).x
    const xTicks: number[] = []
    const yTicks: number[] = []
    for (let i = 0; i + 1 < cmds.length; i++) {
      const a = cmds[i]
      const b = cmds[i + 1]
      if (a.op !== 'moveTo' || b.op !== 'lineTo') continue
      if (a.x === b.x && Math.abs((a.y + b.y) / 2 - axisY) < 1e-9 && Math.abs(a.y - b.y) < 10) {
        xTicks.push(toMath(a, vp).x)
      }
      if (a.y === b.y && Math.abs((a.x + b.x) / 2 - axisX) < 1e-9 && Math.abs(a.x - b.x) < 10) {
        yTicks.push(toMath(a, vp).y)
      }
    }
    // x: 40px a unit is a unit — a tick at every integer
    expect(xTicks.length).toBeGreaterThan(15)
    for (const v of xTicks) expect(Math.abs(v - Math.round(v))).toBeLessThan(1e-9)
    expect(xTicks.some((v) => Math.abs(v - 1) < 1e-9)).toBe(true)
    // y: 4px a unit is below the 12px floor — the ladder's minors (20/5 = 4)
    const step = pickTickStep(4)
    const minor = step.major / step.minorDiv
    expect(yTicks.length).toBeGreaterThan(10)
    for (const v of yTicks) expect(Math.abs(v / minor - Math.round(v / minor))).toBeLessThan(1e-9)
    expect(yTicks.some((v) => Math.abs(v - 1) < 1e-9)).toBe(false)
  })
})

// ===========================================================================
// 3. Screen-space directions
// ===========================================================================

/** 1:10 — a unit of y is a tenth of a unit of x on screen. */
const SQUASH: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 40, pxPerUnitY: 4, widthPx: 800, heightPx: 600 }

function segments(ctx: MockCtx): Array<[Vec2, Vec2]> {
  const out: Array<[Vec2, Vec2]> = []
  const cmds = ctx.own.cmds as Cmd[]
  for (let i = 0; i + 1 < cmds.length; i++) {
    const a = cmds[i]
    const b = cmds[i + 1]
    if (a.op === 'moveTo' && b.op === 'lineTo') out.push([{ x: a.x, y: a.y }, { x: b.x, y: b.y }])
  }
  return out
}

describe('slope-field segments on a stretched board', () => {
  it('each segment leans at atan(m · ppuY / ppuX) on screen', () => {
    const f = (x: number, y: number): number => 0.3 * x - 0.02 * y
    const ctx = new MockCtx()
    drawSlopeFields(
      ctx as unknown as CanvasRenderingContext2D,
      [{ id: 'sf', f, latex: '', color: '#fff', visible: true }],
      { vp: SQUASH },
    )
    const segs = segments(ctx)
    expect(segs.length).toBeGreaterThan(100)
    const k = ppuY(SQUASH) / ppuX(SQUASH)
    let checked = 0
    for (const [a, b] of segs) {
      const mid = toMath({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, SQUASH)
      const m = f(mid.x, mid.y)
      const drawn = Math.atan2(-(b.y - a.y), b.x - a.x)
      const want = Math.atan(m * k)
      if (a.x === b.x) continue // the vertical limit
      let d = drawn - want
      d = d - Math.PI * Math.round(d / Math.PI) // a segment has no head
      expect(Math.abs(d)).toBeLessThan(1e-9)
      checked++
    }
    expect(checked).toBeGreaterThan(100)
    // and on this board a slope of 1 is NOT drawn at 45°
    expect(Math.atan(1 * k)).toBeLessThan(0.2)
  })
})

/** The filled head triangles (moveTo, lineTo, lineTo, closePath) in a stream. */
function heads(ctx: MockCtx): Array<[Vec2, Vec2, Vec2]> {
  const out: Array<[Vec2, Vec2, Vec2]> = []
  const c = ctx.own.cmds as Cmd[]
  for (let i = 0; i + 3 < c.length; i++) {
    const [a, b, d, e] = [c[i], c[i + 1], c[i + 2], c[i + 3]]
    if (a.op === 'moveTo' && b.op === 'lineTo' && d.op === 'lineTo' && e.op === 'closePath') {
      out.push([{ x: a.x, y: a.y }, { x: b.x, y: b.y }, { x: d.x, y: d.y }])
    }
  }
  return out
}

function expectSymmetricHead(
  [tip, w1, w2]: [Vec2, Vec2, Vec2],
  len: number,
  dir: Vec2,
): void {
  const l1 = Math.hypot(w1.x - tip.x, w1.y - tip.y)
  const l2 = Math.hypot(w2.x - tip.x, w2.y - tip.y)
  expect(l1).toBeCloseTo(len, 9)
  expect(l2).toBeCloseTo(len, 9)
  // the head's axis (base midpoint → tip) is the screen direction of travel
  const ax = tip.x - (w1.x + w2.x) / 2
  const ay = tip.y - (w1.y + w2.y) / 2
  const al = Math.hypot(ax, ay)
  const dl = Math.hypot(dir.x, dir.y)
  expect((ax * dir.x + ay * dir.y) / (al * dl)).toBeCloseTo(1, 9)
}

describe('arrowheads on a stretched board', () => {
  it("a vector's head is symmetric about the vector AS DRAWN", () => {
    const tail = { x: -4, y: -20 }
    const v = { x: 5, y: 30 }
    const ctx = new MockCtx()
    drawShapes(
      ctx as unknown as CanvasRenderingContext2D,
      [{ kind: 'vector', id: 'v', tail, v, color: '#fff', visible: true }],
      { vp: SQUASH, theme: DARK_THEME },
    )
    const t = toScreen(tail, SQUASH)
    const tip = toScreen({ x: tail.x + v.x, y: tail.y + v.y }, SQUASH)
    const hs = heads(ctx)
    expect(hs.length).toBe(1)
    expect(hs[0][0].x).toBeCloseTo(tip.x, 9)
    expect(hs[0][0].y).toBeCloseTo(tip.y, 9)
    expectSymmetricHead(hs[0], SHAPE_ARROW_LEN, { x: tip.x - t.x, y: tip.y - t.y })
  })

  it("an end-cap arrow points along the curve's screen tangent", () => {
    const { curve, models } = curveFrom('ln', 'y = x', '#fff')
    const ctx = new MockCtx()
    drawCurveEnds(
      ctx as unknown as CanvasRenderingContext2D,
      SQUASH,
      curve,
      { ...MODELS, ...models },
      { start: 'arrow', end: 'arrow', auto: { start: false, end: false } } as never,
      { color: '#fff', bg: '#000', stroke: 1, width: 2.5 },
    )
    const hs = heads(ctx)
    expect(hs.length).toBe(2)
    // y = x rises ppuY px per ppuX px on screen: (40, −4), not 45°
    const right = hs.find((h) => h[0].x > 400)!
    const left = hs.find((h) => h[0].x < 400)!
    expectSymmetricHead(right, END_ARROW_LEN, { x: ppuX(SQUASH), y: -ppuY(SQUASH) })
    expectSymmetricHead(left, END_ARROW_LEN, { x: -ppuX(SQUASH), y: ppuY(SQUASH) })
  })
})

describe('residuals on a stretched board', () => {
  it('are vertical, centred on the point, and end on the curve', () => {
    const f = (x: number): number => 3 * x * x - 20
    // every point and every curve value on the board (y within ±75)
    const xs = [-4.5, -3, -1, 0, 2, 4]
    const ys = [70, -5, -30, -10, 0, 50]
    // a recorder that keeps each fill with the subpath it consumed
    class Rec extends MockCtx {
      quads: Vec2[][] = []
      private begin = 0
      override beginPath(): void {
        this.begin = this.own.cmds.length
      }
      override fill(): void {
        if (this.quads.length === 0) {
          const c = (this.own.cmds as Cmd[]).slice(this.begin)
          for (let i = 0; i + 3 < c.length; i += 4) {
            this.quads.push(c.slice(i, i + 4).map((p) => ({ x: (p as { x: number }).x, y: (p as { y: number }).y })))
          }
        }
        super.fill()
      }
    }
    const ctx = new Rec()
    drawScatter(
      ctx as unknown as CanvasRenderingContext2D,
      [{ id: 'd', xs, ys, color: '#fff', visible: true, residualsTo: 'c' }],
      { vp: SQUASH, theme: DARK_THEME, curveAt: () => f },
    )
    expect(ctx.quads.length).toBe(xs.length)
    const w = SCATTER_RESIDUAL_WIDTH / 2
    xs.forEach((x, i) => {
      const q = ctx.quads[i]
      const p = toScreen({ x, y: ys[i] }, SQUASH)
      const onCurve = toScreen({ x, y: f(x) }, SQUASH)
      // vertical: two x's only, symmetric about the point's screen x
      expect(q[0].x).toBeCloseTo(p.x - w, 9)
      expect(q[1].x).toBeCloseTo(p.x + w, 9)
      expect(q[2].x).toBeCloseTo(p.x + w, 9)
      expect(q[3].x).toBeCloseTo(p.x - w, 9)
      // from the point to the curve, through ppuY
      expect(q[0].y).toBeCloseTo(p.y, 9)
      expect(q[2].y).toBeCloseTo(onCurve.y, 9)
    })
  })
})

describe('asymptote lines on a stretched board', () => {
  function dashedRules(scene: BoardScene): Array<[Vec2, Vec2]> {
    const { ctx, log } = recordingCtx()
    withMockPath2D(() => renderBoard(ctx, scene))
    const out: Array<[Vec2, Vec2]> = []
    let dashed = false
    let pending: Vec2[] = []
    for (const e of log as unknown[][]) {
      if (e[0] === 'setLineDash') dashed = (e[1] as number[]).length === 2
      else if (e[0] === 'beginPath') pending = []
      else if (e[0] === 'moveTo' || e[0] === 'lineTo') pending.push({ x: e[1] as number, y: e[2] as number })
      else if (e[0] === 'stroke' && e.length === 1 && dashed && pending.length === 2) {
        out.push([pending[0], pending[1]])
      }
    }
    return out
  }

  function sceneFor(src: string, vp: Viewport): BoardScene {
    const { curve, models } = curveFrom('c', src, CURVE_COLORS[0])
    const fig = FIGURE_STYLES.sat
    return {
      vp, theme: fig.theme, figure: fig, curves: [curve], styles: {},
      models: { ...MODELS, ...models }, analysis: null, chrome: null,
    }
  }

  it("an exponential's horizontal asymptote is ruled at its own height", () => {
    const vp: Viewport = { center: { x: 0, y: 20 }, pxPerUnit: 60, pxPerUnitY: 6, widthPx: 900, heightPx: 600 }
    const rules = dashedRules(sceneFor('y = 2^x + 30', vp))
    const at = toScreen({ x: 0, y: 30 }, vp).y
    const flat = rules.filter(([a, b]) => Math.abs(a.y - at) < 1e-6 && Math.abs(b.y - at) < 1e-6)
    expect(flat.length).toBe(1)
    const [a, b] = flat[0]
    expect(Math.min(a.x, b.x)).toBeCloseTo(0, 6)
    expect(Math.max(a.x, b.x)).toBeCloseTo(900, 6)
  })

  it('a slant asymptote y = x is drawn through the screen images of its own points', () => {
    const rules = dashedRules(sceneFor('y = x + 1/x', SQUASH))
    const slant = rules.filter(([a, b]) => a.x !== b.x)
    expect(slant.length).toBe(1)
    for (const p of slant[0]) {
      const m = toMath(p, SQUASH)
      expect(m.y).toBeCloseTo(m.x, 6)
    }
    // …which on a 1:10 board leans at atan(ppuY/ppuX), not 45°
    const [a, b] = slant[0]
    const lean = Math.atan2(-(b.y - a.y), b.x - a.x)
    const want = Math.atan(ppuY(SQUASH) / ppuX(SQUASH))
    const d = lean - want - Math.PI * Math.round((lean - want) / Math.PI)
    expect(Math.abs(d)).toBeLessThan(1e-9)
  })
})

// ===========================================================================
// 4. The polar ruling is an equal-axes ruling
// ===========================================================================

describe('polar grid on a stretched board', () => {
  it('draws the cartesian grid instead, call for call', () => {
    const a = recordingCtx()
    drawPolarGrid(a.ctx, SQUASH, DARK_THEME, null, { x: 'pi' }, null)
    const b = recordingCtx()
    drawGrid(b.ctx, SQUASH, DARK_THEME, null, { x: 'pi' }, null)
    expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log))
    expect(a.log.some((e) => (e as unknown[])[0] === 'arc')).toBe(false)
  })

  it('through renderBoard too: no rings, no spokes, cartesian labels', () => {
    const scene: BoardScene = {
      vp: SQUASH, theme: DARK_THEME, curves: [], styles: {}, models: MODELS,
      grid: 'polar', analysis: null, chrome: null,
    }
    const polar = streamOf(scene)
    const cart = streamOf({ ...scene, grid: 'cartesian' })
    expect(polar).toBe(cart)
  })

  it('still draws rings on an equal-axes board', () => {
    const a = recordingCtx()
    drawPolarGrid(a.ctx, VP, DARK_THEME, null, null, null)
    expect(a.log.some((e) => (e as unknown[])[0] === 'arc')).toBe(true)
  })
})

// ===========================================================================
// 5. exportFit
// ===========================================================================

describe('exportFit on a stretched board', () => {
  const box = { min: { x: 1990, y: 0 }, max: { x: 2020, y: 3e8 } }
  const live: Viewport = {
    center: { x: 2005, y: 1.5e8 }, pxPerUnit: 25, pxPerUnitY: 1.6e-6, widthPx: 900, heightPx: 600,
  }

  it('fits x and y independently, and the fitted viewport carries pxPerUnitY', () => {
    const vp = fitViewport(live, box, 'graph', 'auto')
    const usableW = 900 * (1 - 2 * FIT_PAD)
    const usableH = 600 * (1 - 2 * FIT_PAD)
    expect(vp.pxPerUnit).toBeCloseTo(usableW / 30, 9)
    expect(vp.pxPerUnitY).toBeCloseTo(usableH / 3e8, 18)
    expect(vp.center).toEqual({ x: 2005, y: 1.5e8 })
    // the content fills the frame on BOTH axes
    const lo = toScreen(box.min, vp)
    const hi = toScreen(box.max, vp)
    expect(lo.x).toBeCloseTo(900 * FIT_PAD, 6)
    expect(hi.x).toBeCloseTo(900 * (1 - FIT_PAD), 6)
    expect(hi.y).toBeCloseTo(600 * FIT_PAD, 6)
    expect(lo.y).toBeCloseTo(600 * (1 - FIT_PAD), 6)
  })

  it('a square board still fits with one scale, the smaller one', () => {
    const sq: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 900, heightPx: 600 }
    const b2 = { min: { x: -2, y: -1 }, max: { x: 3, y: 9 } }
    const vp = fitViewport(sq, b2, 'graph', 'auto')
    expect('pxPerUnitY' in vp).toBe(false)
    expect(vp.pxPerUnit).toBeCloseTo(Math.min((900 * 0.88) / 5, (600 * 0.88) / 10), 9)
  })

  it('a flat extent keeps the live x:y ratio instead of zooming to the clamp', () => {
    const flat = { min: { x: 1990, y: 2e8 }, max: { x: 2020, y: 2e8 } }
    const vp = fitViewport(live, flat, 'graph', 'auto')
    expect(ppuY(vp) / ppuX(vp)).toBeCloseTo(1.6e-6 / 25, 18)
  })

  it('the caption band is measured in y units', () => {
    const s: FitExportSettings = { ...DEFAULT_EXPORT, fit: true, aspect: 'auto' }
    const vp = exportViewport(live, s, box, 'graph', [], 40)
    // the content's bottom sits at least the band above the frame's bottom
    const lo = toScreen(box.min, vp)
    expect(lo.y).toBeLessThan(600 - 40)
    expect(vp.pxPerUnitY).toBeDefined()
  })

  it('an unfitted export copies the live y scale', () => {
    const s: FitExportSettings = { ...DEFAULT_EXPORT, fit: false, aspect: 'auto' }
    expect(exportViewport(live, s, box, 'graph').pxPerUnitY).toBe(1.6e-6)
  })
})

// ===========================================================================
// 6. The samplers put every point where toScreen says it goes
// ===========================================================================

describe('curve samplers on a stretched board', () => {
  function strokedPoints(src: string, vp: Viewport): Vec2[] {
    const { curve, models } = curveFrom('c', src, '#fff')
    const ctx = new MockCtx()
    withMockPath2D(() =>
      drawCurve(ctx as unknown as CanvasRenderingContext2D, curve, { ...MODELS, ...models }, vp),
    )
    expect(ctx.strokedPaths.length).toBe(1)
    return ctx.strokedPaths[0].points()
  }

  it('y = sin(x) on a 1:20 board lies on sin through each axis’ own scale', () => {
    const vp: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 4, pxPerUnitY: 80, widthPx: 900, heightPx: 600 }
    const pts = strokedPoints('y = sin(x)', vp)
    expect(pts.length).toBeGreaterThan(100)
    for (const p of pts) {
      const m = toMath(p, vp)
      if (m.x < -112 || m.x > 112) continue // the overdraw past the edges
      expect(Math.abs(m.y - Math.sin(m.x)) * ppuY(vp)).toBeLessThan(0.5) // half a pixel
    }
    // the peaks reach 80px above the axis, not 4
    const top = Math.min(...pts.map((p) => p.y))
    expect(top).toBeCloseTo(300 - 80, 0)
  })

  it('an implicit ellipse is traced on the curve, with each axis scaled on its own', () => {
    const vp: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 60, pxPerUnitY: 15, widthPx: 900, heightPx: 600 }
    const pts = strokedPoints('x^2/9 + y^2/4 = 1', vp)
    expect(pts.length).toBeGreaterThan(40)
    for (const p of pts) {
      const m = toMath(p, vp)
      expect(Math.abs(m.x * m.x / 9 + m.y * m.y / 4 - 1)).toBeLessThan(0.02)
    }
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(6 * 60, -1)
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(4 * 15, -1)
  })

  it('a polar rose is plotted point by point through toScreen', () => {
    const vp: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 100, pxPerUnitY: 25, widthPx: 900, heightPx: 600 }
    const pts = strokedPoints('r = 2cos(3θ)', vp)
    for (const p of pts) {
      const m = toMath(p, vp)
      expect(Math.hypot(m.x, m.y)).toBeLessThan(2 + 0.01)
    }
    const ys = pts.map((p) => p.y)
    // the rose spans |y| <= 2·sin(…) ≈ 1.73 → at most ~87px tall on this board
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(4 * 25)
  })
})

describe('implicit curves on an extreme stretch', () => {
  it('years against hundreds of millions: the midpoint snap searches across the stroke', () => {
    const vp: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 20, pxPerUnitY: 2e-6, widthPx: 900, heightPx: 600 }
    const { curve, models } = curveFrom('c', 'x^2/100 + y^2/10000000000000000 = 1', '#fff')
    const ctx = new MockCtx()
    withMockPath2D(() =>
      drawCurve(ctx as unknown as CanvasRenderingContext2D, curve, { ...MODELS, ...models }, vp),
    )
    const pts = ctx.strokedPaths[0].points()
    expect(pts.length).toBeGreaterThan(40)
    for (const p of pts) {
      const m = toMath(p, vp)
      expect(Math.abs(m.x * m.x / 100 + m.y * m.y / 1e16 - 1)).toBeLessThan(0.02)
    }
    // …and no chord jumps across the board: each cell's snapped midpoint
    // stays next to the chord it refines (cells are ~10px)
    for (const sub of ctx.strokedPaths[0].subpaths()) {
      for (let i = 1; i < sub.length; i++) {
        expect(Math.hypot(sub[i].x - sub[i - 1].x, sub[i].y - sub[i - 1].y)).toBeLessThan(20)
      }
    }
  })
})

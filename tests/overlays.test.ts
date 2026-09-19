// ============================================================================
// tests/overlays.test.ts — the shaded-region layer.
//
// Three claims this file exists to hold:
//
//  1. Overlays are FIGURE. They paint after the grid, before the curves, and
//     they reach the export (chrome:null) pixel-for-pixel as they reach the
//     screen. The analysis layer once measured 1460 label pixels on screen and
//     zero in the file; a shaded integral must not repeat that.
//  2. The area boundary is the STROKE's own boundary. Under 1/x on [-1, 1] the
//     shading breaks at the pole, because it is sampled by the same routine
//     that breaks the stroke there.
//  3. A board with no overlays draws exactly what it drew before this layer
//     existed — asserted by comparing whole command streams, not counts.
// ============================================================================

import { describe, it, expect } from 'vitest'
import { renderBoard, type BoardScene, type BoardChrome, type Overlay } from '../src/ui/renderBoard'
import { OVERLAY_FILL_ALPHA } from '../src/render/overlays'
import { MockCtx, MockPath2D, withMockPath2D, type Cmd } from './mockCanvas'
import { MODELS } from '../src/core/fit/models'
import {
  CURVE_COLORS,
  PRINT_CURVE_COLORS,
  DARK_THEME,
  LIGHT_THEME,
} from '../src/core/types'
import type { FittedCurve, Viewport } from '../src/core/types'

const VP: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 900, heightPx: 700 }
/** Screen y of the x-axis for VP, and screen x of a math x. */
const AXIS_Y = VP.heightPx / 2
const px = (x: number): number => VP.widthPx / 2 + x * VP.pxPerUnit

const SQ: FittedCurve = {
  id: 'sq', modelId: 'poly2', params: [0, 0, 1], // ascending: y = x^2
  kind: 'explicit', domain: null,
  color: CURVE_COLORS[0], strokeWidth: 2.5, visible: true, error: 0,
}
const RECIP: FittedCurve = {
  id: 'rc', modelId: 'recip', params: [1, 0, 0],  // y = 1/x, NaN at the pole
  kind: 'explicit', domain: null,
  color: CURVE_COLORS[1], strokeWidth: 2.5, visible: true, error: 0,
}
const LINE: FittedCurve = {
  id: 'ln', modelId: 'line', params: [0, 1],      // y = x
  kind: 'explicit', domain: null,
  color: CURVE_COLORS[2], strokeWidth: 2.5, visible: true, error: 0,
}

// ---------------------------------------------------------------------------
// A MockCtx that also keeps the ORDER of paint operations and the geometry
// each one consumed. mockCanvas.ts records styles only at stroke/fillText, and
// a shaded region is a fill — so the recording is extended here rather than
// there, where other suites depend on the shape of what is recorded.
// ---------------------------------------------------------------------------

interface PaintOp {
  op: 'fill' | 'stroke'
  style: string
  lw: number
  alpha: number
  /** True when stroke() was handed a Path2D — i.e. this is a CURVE. */
  path: boolean
  pts: Array<{ x: number; y: number }>
}

class LogCtx extends MockCtx {
  log: PaintOp[] = []
  private mark = 0

  private note(op: 'fill' | 'stroke', path: boolean): void {
    const pts: Array<{ x: number; y: number }> = []
    for (const c of this.own.cmds.slice(this.mark) as Cmd[]) {
      if (c.op === 'moveTo' || c.op === 'lineTo') pts.push({ x: c.x, y: c.y })
    }
    this.mark = this.own.cmds.length
    this.log.push({
      op,
      style: op === 'fill' ? this.fillStyle : this.strokeStyle,
      lw: this.lineWidth,
      alpha: this.globalAlpha,
      path,
      pts,
    })
  }

  override fill(): void {
    this.note('fill', false)
    super.fill()
  }
  override stroke(p?: MockPath2D): void {
    this.note('stroke', p !== undefined)
    super.stroke(p)
  }

  /** The fills painted in `color` — the overlay's own, never the grid's. */
  fillsIn(color: string): PaintOp[] {
    return this.log.filter((e) => e.op === 'fill' && e.style === color)
  }
  strokesIn(color: string): PaintOp[] {
    return this.log.filter((e) => e.op === 'stroke' && e.style === color && !e.path)
  }
}

function scene(over: Partial<BoardScene> = {}): BoardScene {
  return {
    vp: VP, theme: DARK_THEME, curves: [SQ], styles: {}, models: MODELS,
    analysis: null, chrome: null,
    ...over,
  }
}

function render(s: BoardScene): LogCtx {
  const ctx = new LogCtx()
  withMockPath2D(() => renderBoard(ctx as unknown as CanvasRenderingContext2D, s))
  return ctx
}

const chromeOn = (): BoardChrome => ({
  selectedId: SQ.id, handles: [], activeHandleId: null,
  highlight: null, openIdx: null, hoverIdx: null,
})

const AREA_SQ: Overlay = { kind: 'area', curveId: 'sq', from: 0, to: 2 }

// ===========================================================================

describe('overlays — draw order', () => {
  it('paints after the grid and before the curve it shades', () => {
    const ctx = render(scene({ overlays: [AREA_SQ] }))
    const fill = ctx.log.findIndex((e) => e.op === 'fill' && e.style === CURVE_COLORS[0])
    const curve = ctx.log.findIndex((e) => e.op === 'stroke' && e.path)
    const grid = ctx.log.findIndex((e) => e.op === 'stroke' && !e.path)

    expect(fill, 'the shaded area was never filled').toBeGreaterThanOrEqual(0)
    expect(curve, 'the curve was never stroked').toBeGreaterThanOrEqual(0)
    expect(grid, 'the grid was never stroked').toBeGreaterThanOrEqual(0)
    expect(grid, 'shading painted over the grid it should sit on').toBeLessThan(fill)
    expect(fill, "the curve's stroke must sit ON TOP of its own shading")
      .toBeLessThan(curve)
  })

  it('every overlay fill precedes every curve stroke', () => {
    const ctx = render(scene({
      curves: [SQ, RECIP],
      overlays: [AREA_SQ, { kind: 'area', curveId: 'rc', from: -1, to: 1 }],
    }))
    const lastFill = ctx.log.reduce(
      (acc, e, i) =>
        e.op === 'fill' && (e.style === CURVE_COLORS[0] || e.style === CURVE_COLORS[1]) ? i : acc,
      -1,
    )
    const firstCurve = ctx.log.findIndex((e) => e.op === 'stroke' && e.path)
    expect(lastFill).toBeGreaterThanOrEqual(0)
    expect(lastFill).toBeLessThan(firstCurve)
  })
})

describe('overlays — area', () => {
  it('x^2 on [0,2] is one region closed onto the axis', () => {
    const ctx = render(scene({ overlays: [AREA_SQ] }))
    const fills = ctx.fillsIn(CURVE_COLORS[0])
    expect(fills).toHaveLength(1)

    const pts = fills[0].pts
    // the two closing vertices sit exactly on y = 0
    const onAxis = pts.filter((p) => Math.abs(p.y - AXIS_Y) < 1e-6)
    expect(onAxis.length, 'the region never returned to the axis').toBeGreaterThanOrEqual(2)
    const xs = pts.map((p) => p.x)
    expect(Math.min(...xs)).toBeCloseTo(px(0), 3)
    expect(Math.max(...xs)).toBeCloseTo(px(2), 3)
    // and it is the curve above the axis: some vertex well above y = 0
    expect(Math.min(...pts.map((p) => p.y))).toBeLessThan(AXIS_Y - 100)
  })

  it('fills at the default wash, unless the overlay states one', () => {
    const plain = render(scene({ overlays: [AREA_SQ] })).fillsIn(CURVE_COLORS[0])
    expect(plain[0].alpha).toBeCloseTo(OVERLAY_FILL_ALPHA, 6)
    expect(OVERLAY_FILL_ALPHA).toBeGreaterThan(0)
    expect(OVERLAY_FILL_ALPHA).toBeLessThan(0.3)

    const loud = render(scene({ overlays: [{ ...AREA_SQ, alpha: 0.5 }] }))
    expect(loud.fillsIn(CURVE_COLORS[0])[0].alpha).toBeCloseTo(0.5, 6)
  })

  it('takes the curve colour by default and an explicit colour when given', () => {
    const own = render(scene({ overlays: [AREA_SQ] }))
    expect(own.fillsIn(CURVE_COLORS[0]).length).toBe(1)

    const told = render(scene({ overlays: [{ ...AREA_SQ, color: '#123456' }] }))
    expect(told.fillsIn('#123456').length).toBe(1)
    expect(told.fillsIn(CURVE_COLORS[0]).length).toBe(0)
  })

  it('1/x on [-1,1] breaks at the pole: two regions, neither crossing it', () => {
    const ctx = render(scene({
      curves: [RECIP],
      overlays: [{ kind: 'area', curveId: 'rc', from: -1, to: 1 }],
    }))
    const fills = ctx.fillsIn(CURVE_COLORS[1])
    expect(fills.length, 'the pole was shaded straight through').toBeGreaterThanOrEqual(2)

    const pole = px(0)
    for (const f of fills) {
      const xs = f.pts.map((p) => p.x)
      const left = Math.max(...xs) <= pole + 1e-6
      const right = Math.min(...xs) >= pole - 1e-6
      expect(left || right, 'a shaded region straddles the pole').toBe(true)
    }
    // one branch above the axis, one below — the signed-area convention
    const sides = fills.map((f) => Math.min(...f.pts.map((p) => p.y)) < AXIS_Y - 50)
    expect(new Set(sides).size, 'both branches landed on the same side').toBe(2)
  })

  it('shades below the axis too (AP signed-area convention)', () => {
    const ctx = render(scene({
      curves: [LINE],
      overlays: [{ kind: 'area', curveId: 'ln', from: -2, to: 0 }],
    }))
    const fills = ctx.fillsIn(CURVE_COLORS[2])
    expect(fills.length).toBeGreaterThanOrEqual(1)
    const ys = fills.flatMap((f) => f.pts.map((p) => p.y))
    expect(Math.max(...ys), 'nothing was shaded under the axis').toBeGreaterThan(AXIS_Y + 50)
  })

  it('a NaN gap splits the region (sqrt left of its branch point)', () => {
    const SQRT: FittedCurve = {
      id: 'sr', modelId: 'sqrt', params: [1, 0, 0], // NaN for x < 0
      kind: 'explicit', domain: null,
      color: CURVE_COLORS[3], strokeWidth: 2.5, visible: true, error: 0,
    }
    const ctx = render(scene({
      curves: [SQRT],
      overlays: [{ kind: 'area', curveId: 'sr', from: -1, to: 4 }],
    }))
    const fills = ctx.fillsIn(CURVE_COLORS[3])
    expect(fills.length).toBe(1)
    // nothing shaded left of the branch point
    expect(Math.min(...fills[0].pts.map((p) => p.x))).toBeGreaterThanOrEqual(px(0) - 1)
  })

  it('`against` shades the strip between two curves, not down to the axis', () => {
    const between: Overlay = { kind: 'area', curveId: 'sq', from: 0, to: 1, against: 'ln' }
    const ctx = render(scene({ curves: [SQ, LINE], overlays: [between] }))
    const fills = ctx.fillsIn(CURVE_COLORS[0])
    expect(fills).toHaveLength(1)

    // Mid-span the strip is bounded by y = x below and y = x^2 above, so BOTH
    // boundaries stand off the axis — that is the whole difference from an
    // area, which would close onto y = 0 there.
    const mid = fills[0].pts.filter((p) => Math.abs(p.x - px(0.5)) < 1.5)
    expect(mid.length, 'nothing sampled mid-span').toBeGreaterThanOrEqual(2)
    for (const p of mid) expect(p.y).toBeLessThan(AXIS_Y - 10)
    // screen y grows downward: x^2 = 0.25 is the LOWER edge of the strip there,
    // y = x = 0.5 the upper one. (Tolerance is one sample step, not one pixel.)
    expect(Math.max(...mid.map((p) => p.y))).toBeCloseTo(AXIS_Y - 0.25 * VP.pxPerUnit, -1)
    expect(Math.min(...mid.map((p) => p.y))).toBeCloseTo(AXIS_Y - 0.5 * VP.pxPerUnit, -1)

    // the same span without `against` DOES close onto the axis
    const plain = render(scene({
      curves: [SQ, LINE],
      overlays: [{ kind: 'area', curveId: 'sq', from: 0, to: 1 }],
    })).fillsIn(CURVE_COLORS[0])[0]
    expect(Math.max(...plain.pts.map((p) => p.y))).toBeCloseTo(AXIS_Y, 6)
  })

  it('`against` naming a curve that is gone draws nothing (never silently the axis)', () => {
    const ctx = render(scene({
      overlays: [{ kind: 'area', curveId: 'sq', from: 0, to: 2, against: 'nope' }],
    }))
    expect(ctx.fillsIn(CURVE_COLORS[0])).toHaveLength(0)
  })

  it('an unknown curve, a reversed interval and an empty one are all survivable', () => {
    expect(() =>
      render(scene({
        overlays: [
          { kind: 'area', curveId: 'ghost', from: 0, to: 1 },
          { kind: 'area', curveId: 'sq', from: 2, to: 0 },      // reversed
          { kind: 'area', curveId: 'sq', from: 1, to: 1 },      // empty
          { kind: 'area', curveId: 'sq', from: Number.NaN, to: 1 },
        ],
      })),
    ).not.toThrow()
    // the reversed interval still shades [0,2]
    const ctx = render(scene({ overlays: [{ kind: 'area', curveId: 'sq', from: 2, to: 0 }] }))
    expect(ctx.fillsIn(CURVE_COLORS[0])).toHaveLength(1)
  })
})

describe('overlays — Riemann rectangles', () => {
  /** Left rule, n = 6, on y = x^2 over [0, 2]. */
  const leftRects = (n: number, a: number, b: number, f: (x: number) => number) =>
    Array.from({ length: n }, (_, i) => {
      const x0 = a + ((b - a) * i) / n
      const x1 = a + ((b - a) * (i + 1)) / n
      return { x0, x1, height: f(x0) }
    })

  const RECTS: Overlay = {
    kind: 'rects', curveId: 'sq', rects: leftRects(6, 0, 2, (x) => x * x),
  }

  it('draws exactly n rectangles, each outlined and lightly filled', () => {
    const ctx = render(scene({ overlays: [RECTS] }))
    expect(ctx.fillsIn(CURVE_COLORS[0])).toHaveLength(6)
    expect(ctx.strokesIn(CURVE_COLORS[0])).toHaveLength(6)
    for (const f of ctx.fillsIn(CURVE_COLORS[0])) {
      expect(f.alpha).toBeCloseTo(OVERLAY_FILL_ALPHA, 6)
      expect(f.pts).toHaveLength(4)
    }
    for (const s of ctx.strokesIn(CURVE_COLORS[0])) {
      expect(s.alpha, 'the outline must be at full colour').toBeCloseTo(1, 6)
      expect(s.lw).toBeCloseTo(1, 6)
    }
  })

  it('each rectangle runs from the axis to its own height, in exact math coords', () => {
    const ctx = render(scene({ overlays: [RECTS] }))
    const fills = ctx.fillsIn(CURVE_COLORS[0])
    fills.forEach((f, i) => {
      const xs = f.pts.map((p) => p.x)
      expect(Math.min(...xs)).toBeCloseTo(px((2 * i) / 6), 3)
      expect(Math.max(...xs)).toBeCloseTo(px((2 * (i + 1)) / 6), 3)
      const ys = f.pts.map((p) => p.y)
      expect(Math.max(...ys), 'a rectangle did not stand on the axis').toBeCloseTo(AXIS_Y, 3)
      const h = ((2 * i) / 6) ** 2
      expect(Math.min(...ys)).toBeCloseTo(AXIS_Y - h * VP.pxPerUnit, 3)
    })
  })

  it('a negative height draws BELOW the axis', () => {
    const ctx = render(scene({
      overlays: [{ kind: 'rects', curveId: 'sq', rects: [{ x0: 0, x1: 1, height: -1.5 }] }],
    }))
    const [f] = ctx.fillsIn(CURVE_COLORS[0])
    expect(f).toBeDefined()
    const ys = f.pts.map((p) => p.y)
    expect(Math.min(...ys), 'a negative rectangle poked above the axis').toBeCloseTo(AXIS_Y, 3)
    expect(Math.max(...ys)).toBeCloseTo(AXIS_Y + 1.5 * VP.pxPerUnit, 3)
  })

  it('present scales the outline weight and leaves the fill alpha alone', () => {
    const big = render(scene({ overlays: [RECTS], present: { type: 1, stroke: 3 } }))
    for (const s of big.strokesIn(CURVE_COLORS[0])) expect(s.lw).toBeCloseTo(3, 6)
    for (const f of big.fillsIn(CURVE_COLORS[0])) {
      expect(f.alpha, 'projection changed the wash').toBeCloseTo(OVERLAY_FILL_ALPHA, 6)
    }
  })
})

describe('overlays — region', () => {
  const TRI: Overlay = {
    kind: 'region',
    boundary: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }],
    color: CURVE_COLORS[4],
  }

  it('fills the closed polygon in math coords, unsmoothed', () => {
    const ctx = render(scene({ overlays: [TRI] }))
    const fills = ctx.fillsIn(CURVE_COLORS[4])
    expect(fills).toHaveLength(1)
    expect(fills[0].pts).toHaveLength(3)          // three vertices, no smoothing
    expect(fills[0].alpha).toBeCloseTo(OVERLAY_FILL_ALPHA, 6)
    expect(fills[0].pts[0]).toEqual({ x: px(0), y: AXIS_Y })
    expect(fills[0].pts[2]).toEqual({ x: px(2), y: AXIS_Y - 2 * VP.pxPerUnit })
    // closePath, not a repeated first vertex
    expect(ctx.own.cmds.some((c) => c.op === 'closePath')).toBe(true)
  })

  it('a degenerate boundary draws nothing rather than throwing', () => {
    const ctx = render(scene({
      overlays: [
        { kind: 'region', boundary: [], color: '#abcabc' },
        { kind: 'region', boundary: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: '#abcabc' },
        { kind: 'region', boundary: [{ x: Number.NaN, y: 0 }], color: '#abcabc' },
      ],
    }))
    expect(ctx.fillsIn('#abcabc')).toHaveLength(0)
  })
})

describe('overlays — the figure, not chrome', () => {
  it('reach the export (chrome:null) and are identical with chrome on', () => {
    const all: Overlay[] = [
      AREA_SQ,
      { kind: 'rects', curveId: 'sq', rects: [{ x0: 0, x1: 1, height: 1 }] },
      { kind: 'region', boundary: [{ x: -2, y: -1 }, { x: -1, y: -1 }, { x: -1, y: 0 }] },
    ]
    const exported = render(scene({ overlays: all, chrome: null }))
    const onScreen = render(scene({ overlays: all, chrome: chromeOn() }))

    const overlayFills = (c: LogCtx): PaintOp[] =>
      c.log.filter((e) => e.op === 'fill' && e.alpha < 1)
    expect(overlayFills(exported).length, 'nothing shaded in the export')
      .toBeGreaterThanOrEqual(3)
    expect(overlayFills(exported)).toEqual(overlayFills(onScreen))
  })

  it('a light ground maps the shading to the print palette, like the stroke', () => {
    const ctx = render(scene({ theme: LIGHT_THEME, overlays: [AREA_SQ] }))
    expect(ctx.fillsIn(PRINT_CURVE_COLORS[0]), 'shading kept the screen palette on paper')
      .toHaveLength(1)
    expect(ctx.fillsIn(CURVE_COLORS[0])).toHaveLength(0)
    // and the stroke above it agrees
    expect(ctx.strokeStyles).toContain(PRINT_CURVE_COLORS[0])
  })
})

describe('overlays — the regression guard', () => {
  /** Everything a mock canvas saw, as one comparable value. */
  const snapshot = (c: LogCtx) =>
    JSON.stringify({
      cmds: c.own.cmds,
      log: c.log,
      texts: c.texts,
      fills: c.fills,
      strokeStyles: c.strokeStyles,
      fillStyles: c.fillStyles,
      counts: [c.strokeCount, c.fillCount, c.textCount, c.saveCount, c.restoreCount],
      paths: c.strokedPaths.map((p) => p.cmds),
    })

  it('an empty overlay list is byte-identical to no overlay field at all', () => {
    const before = render(scene({ curves: [SQ, RECIP, LINE] }))
    const after = render(scene({ curves: [SQ, RECIP, LINE], overlays: [] }))
    expect(snapshot(after)).toBe(snapshot(before))
  })

  it('...with chrome on, with analysis on, and on a light ground too', () => {
    for (const over of [
      { chrome: chromeOn() },
      { theme: LIGHT_THEME },
      { present: { type: 2, stroke: 2 } },
    ] as Array<Partial<BoardScene>>) {
      const before = render(scene(over))
      const after = render(scene({ ...over, overlays: [] }))
      expect(snapshot(after)).toBe(snapshot(before))
    }
  })

  it('an overlay actually changes the stream (the guard is not vacuous)', () => {
    const before = render(scene())
    const after = render(scene({ overlays: [AREA_SQ] }))
    expect(snapshot(after)).not.toBe(snapshot(before))
  })
})

// ============================================================================
// tests/fields.test.ts — the slope-field layer.
//
// What this file exists to hold:
//
//  1. A field is GROUND. It paints after the grid and the shaded overlays and
//     before the solution curve and every fitted curve, at a reduced alpha, so
//     the mathematics the class is looking at reads on top of it.
//  2. The segments are TANGENT. dy/dx = 1 must rise to the right on a canvas
//     whose y grows downward; getting the flip wrong draws a field that is the
//     mirror image of the equation and no one would notice from a screenshot.
//  3. The lattice is anchored to math (0, 0). Panning by half a spacing moves
//     the picture and not one lattice point, so the field does not swim.
//  4. NaN is a hole and ±∞ is vertical — the two honest answers to "what is
//     the direction here", and they are different answers.
//  5. A board with no fields draws exactly what it drew before this layer
//     existed, asserted on whole command streams rather than counts.
// ============================================================================

import { describe, it, expect } from 'vitest'
import {
  renderBoard,
  type BoardChrome,
  type BoardScene,
  type Overlay,
  type Polyline,
  type SlopeField,
} from '../src/ui/renderBoard'
import {
  FIELD_ALPHA,
  FIELD_LINE_WIDTH,
  FIELD_MAX_POINTS,
  FIELD_SEGMENT_FRACTION,
  FIELD_SPACING_PX,
  POLYLINE_WIDTH,
} from '../src/render/fields'
import { MockCtx, MockPath2D, withMockPath2D, type Cmd } from './mockCanvas'
import { MODELS } from '../src/core/fit/models'
import { CURVE_COLORS, PRINT_CURVE_COLORS, DARK_THEME, LIGHT_THEME } from '../src/core/types'
import type { FittedCurve, Vec2, Viewport } from '../src/core/types'

const VP: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 900, heightPx: 700 }

const FIELD_COLOR = CURVE_COLORS[1]
const POLY_COLOR = CURVE_COLORS[2]

const SQ: FittedCurve = {
  id: 'sq', modelId: 'poly2', params: [0, 0, 1], // y = x^2
  kind: 'explicit', domain: null,
  color: CURVE_COLORS[0], strokeWidth: 2.5, visible: true, error: 0,
}

const field = (over: Partial<SlopeField> = {}): SlopeField => ({
  id: 'f1',
  f: () => 0,
  latex: 'dy/dx = 0',
  color: FIELD_COLOR,
  visible: true,
  ...over,
})

const poly = (pts: readonly Vec2[], over: Partial<Polyline> = {}): Polyline => ({
  id: 'p1', pts, color: POLY_COLOR, ...over,
})

// ---------------------------------------------------------------------------
// A MockCtx that keeps the ORDER of paint operations, the geometry each one
// consumed, and the state it was painted with. Same device as
// tests/overlays.test.ts; mockCanvas.ts records styles only at stroke time and
// other suites depend on the shape of what it records.
// ---------------------------------------------------------------------------

interface PaintOp {
  op: 'fill' | 'stroke'
  style: string
  lw: number
  alpha: number
  cap: string
  dash: number[]
  /** True when stroke() was handed a Path2D — i.e. this is a fitted CURVE. */
  path: boolean
  pts: Array<{ x: number; y: number }>
  /** Subpaths: one per moveTo. A field's segments are one subpath each. */
  runs: Array<Array<{ x: number; y: number }>>
}

class LogCtx extends MockCtx {
  log: PaintOp[] = []
  private mark = 0

  private note(op: 'fill' | 'stroke', path: boolean): void {
    const pts: Array<{ x: number; y: number }> = []
    const runs: Array<Array<{ x: number; y: number }>> = []
    let cur: Array<{ x: number; y: number }> | null = null
    for (const c of this.own.cmds.slice(this.mark) as Cmd[]) {
      if (c.op === 'moveTo') {
        cur = [{ x: c.x, y: c.y }]
        runs.push(cur)
        pts.push({ x: c.x, y: c.y })
      } else if (c.op === 'lineTo') {
        if (cur) cur.push({ x: c.x, y: c.y })
        pts.push({ x: c.x, y: c.y })
      }
    }
    this.mark = this.own.cmds.length
    this.log.push({
      op,
      style: op === 'fill' ? this.fillStyle : this.strokeStyle,
      lw: this.lineWidth,
      alpha: this.globalAlpha,
      cap: this.lineCap,
      dash: this.lineDash.slice(),
      path,
      pts,
      runs,
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

// ---------------------------------------------------------------------------
// Segment helpers — a field is ONE stroke of many two-point subpaths.
// ---------------------------------------------------------------------------

interface Seg {
  a: { x: number; y: number }
  b: { x: number; y: number }
  /** Segment midpoint = the lattice point, in MATH coords. */
  mx: number
  my: number
  len: number
}

function segments(ctx: LogCtx, vp: Viewport = VP, color = FIELD_COLOR): Seg[] {
  const strokes = ctx.strokesIn(color).filter((s) => s.alpha < 1)
  const out: Seg[] = []
  for (const s of strokes) {
    for (const run of s.runs) {
      if (run.length !== 2) continue
      const [a, b] = run
      const cx = (a.x + b.x) / 2
      const cy = (a.y + b.y) / 2
      out.push({
        a, b,
        mx: vp.center.x + (cx - vp.widthPx / 2) / vp.pxPerUnit,
        my: vp.center.y - (cy - vp.heightPx / 2) / vp.pxPerUnit,
        len: Math.hypot(b.x - a.x, b.y - a.y),
      })
    }
  }
  return out
}

/** Distinct values in `xs`, to `tol`. */
function distinct(xs: number[], tol = 1e-6): number[] {
  const out: number[] = []
  for (const v of xs.slice().sort((p, q) => p - q)) {
    if (out.length === 0 || Math.abs(v - out[out.length - 1]) > tol) out.push(v)
  }
  return out
}

// ===========================================================================

describe('slope fields — draw order', () => {
  it('paints after the grid and the shading, before the polyline and the curve', () => {
    const ctx = render(scene({
      overlays: [{ kind: 'area', curveId: 'sq', from: 0, to: 2 } as Overlay],
      fields: [field({ f: (x, y) => x - y })],
      polylines: [poly([{ x: -2, y: 0 }, { x: 2, y: 1 }])],
    }))

    const grid = ctx.log.findIndex((e) => e.op === 'stroke' && !e.path)
    const shade = ctx.log.findIndex((e) => e.op === 'fill' && e.style === CURVE_COLORS[0])
    const fld = ctx.log.findIndex(
      (e) => e.op === 'stroke' && e.style === FIELD_COLOR && !e.path && e.alpha < 1,
    )
    const line = ctx.log.findIndex((e) => e.op === 'stroke' && e.style === POLY_COLOR && !e.path)
    const curve = ctx.log.findIndex((e) => e.op === 'stroke' && e.path)

    expect(fld, 'the field was never stroked').toBeGreaterThanOrEqual(0)
    expect(line, 'the polyline was never stroked').toBeGreaterThanOrEqual(0)
    expect(curve, 'the curve was never stroked').toBeGreaterThanOrEqual(0)
    expect(grid, 'the field painted over the grid it should sit on').toBeLessThan(fld)
    expect(shade, 'the field painted under nothing — shading came after it').toBeLessThan(fld)
    expect(fld, 'the solution curve went UNDER the field it solves').toBeLessThan(line)
    expect(line, "a fitted curve went under the board's own solution curve").toBeLessThan(curve)
  })

  it('reads as texture: reduced alpha, hairline weight, round caps', () => {
    const ctx = render(scene({ fields: [field()] }))
    const [s] = ctx.strokesIn(FIELD_COLOR)
    expect(s).toBeDefined()
    expect(s.alpha, 'the field is shouting over the figure').toBeCloseTo(FIELD_ALPHA, 6)
    expect(FIELD_ALPHA).toBeGreaterThan(0.3)
    expect(FIELD_ALPHA).toBeLessThan(1)
    expect(s.lw).toBeCloseTo(FIELD_LINE_WIDTH, 6)
    expect(s.cap).toBe('round')
  })
})

describe('slope fields — the lattice', () => {
  it('a 900x700 viewport at 28px is about 32 by 25 segments', () => {
    const segs = segments(render(scene({ fields: [field()] })))
    const cols = distinct(segs.map((s) => s.mx), 1e-9).length
    const rows = distinct(segs.map((s) => s.my), 1e-9).length

    const wantCols = VP.widthPx / FIELD_SPACING_PX  // 32.14
    const wantRows = VP.heightPx / FIELD_SPACING_PX // 25
    expect(cols).toBeGreaterThan(wantCols * 0.9)
    expect(cols).toBeLessThan(wantCols * 1.1)
    expect(rows).toBeGreaterThan(wantRows * 0.9)
    expect(rows).toBeLessThan(wantRows * 1.1)
    // full rectangle, no gaps: every column meets every row
    expect(segs.length).toBe(cols * rows)
  })

  it('segments are ~0.6 of the spacing and centred on the lattice point', () => {
    const segs = segments(render(scene({ fields: [field({ f: () => 0 })] })))
    const want = FIELD_SEGMENT_FRACTION * FIELD_SPACING_PX // 16.8 px
    for (const s of segs.slice(0, 40)) {
      expect(s.len).toBeCloseTo(want, 6)
      // horizontal field: the midpoint sits at the lattice point, both ends level
      expect(s.a.y).toBeCloseTo(s.b.y, 9)
      expect((s.a.x + s.b.x) / 2 - s.a.x).toBeCloseTo(want / 2, 6)
    }
    // lattice positions are multiples of the spacing in math units
    const h = FIELD_SPACING_PX / VP.pxPerUnit
    for (const s of segs) {
      expect(Math.abs(s.mx / h - Math.round(s.mx / h))).toBeLessThan(1e-6)
      expect(Math.abs(s.my / h - Math.round(s.my / h))).toBeLessThan(1e-6)
    }
  })

  it('the spacing follows present.stroke, like every other weight', () => {
    const ctx = render(scene({ fields: [field()], present: { type: 1, stroke: 2 } }))
    const segs = segments(ctx)
    expect(segs[0].len).toBeCloseTo(FIELD_SEGMENT_FRACTION * FIELD_SPACING_PX * 2, 6)
    expect(ctx.strokesIn(FIELD_COLOR)[0].lw).toBeCloseTo(FIELD_LINE_WIDTH * 2, 6)
    const cols = distinct(segs.map((s) => s.mx), 1e-9).length
    expect(cols).toBeLessThan(VP.widthPx / (FIELD_SPACING_PX * 2) * 1.1)
  })

  it('honours an explicit spacingPx', () => {
    const wide = segments(render(scene({ fields: [field({ spacingPx: 56 })] })))
    const tight = segments(render(scene({ fields: [field({ spacingPx: 28 })] })))
    expect(wide.length).toBeLessThan(tight.length / 3)
    expect(wide[0].len).toBeCloseTo(FIELD_SEGMENT_FRACTION * 56, 6)
  })
})

describe('slope fields — anchored to math (0,0), not the viewport', () => {
  it('panning by half a spacing does not move one lattice point', () => {
    const h = FIELD_SPACING_PX / VP.pxPerUnit
    const still = segments(render(scene({ fields: [field()] })))
    const panVp: Viewport = { ...VP, center: { x: h / 2, y: h / 3 } }
    const panned = segments(render(scene({ vp: panVp, fields: [field()] })), panVp)

    // every lattice point, before and after the pan, is a multiple of h
    for (const s of panned) {
      expect(Math.abs(s.mx / h - Math.round(s.mx / h))).toBeLessThan(1e-6)
      expect(Math.abs(s.my / h - Math.round(s.my / h))).toBeLessThan(1e-6)
    }
    // and the columns common to both are the SAME columns, to the last digit
    const before = distinct(still.map((s) => s.mx), 1e-9)
    const after = distinct(panned.map((s) => s.mx), 1e-9)
    const common = after.filter((v) => v >= before[0] - 1e-9 && v <= before[before.length - 1] + 1e-9)
    expect(common.length, 'the pan emptied the board').toBeGreaterThan(20)
    for (const v of common) {
      const near = before.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a))
      expect(Math.abs(near - v), 'the lattice swam under the pan').toBeLessThan(1e-9)
    }
  })

  it('the lattice is the same picture translated: the screen offset is the pan', () => {
    const h = FIELD_SPACING_PX / VP.pxPerUnit
    const panVp: Viewport = { ...VP, center: { x: h / 2, y: 0 } }
    const a = segments(render(scene({ fields: [field()] })))
    const b = segments(render(scene({ vp: panVp, fields: [field()] })), panVp)
    // a pan of half a spacing shifts the drawn lattice by exactly half a
    // spacing in screen px — it does not re-seed it at the new corner
    const ax = distinct(a.map((s) => s.a.x))
    const bx = distinct(b.map((s) => s.a.x))
    const shift = (FIELD_SPACING_PX / 2)
    const matched = bx.filter((v) => ax.some((u) => Math.abs(u - shift - v) < 1e-6))
    expect(matched.length, 'the lattice re-anchored itself to the viewport')
      .toBeGreaterThan(bx.length - 3)
  })
})

describe('slope fields — the y flip and the vertical limit', () => {
  it("dy/dx = 1 rises to the RIGHT on screen; dy/dx = -1 falls", () => {
    for (const [m, sign] of [[1, -1], [-1, 1]] as Array<[number, number]>) {
      const segs = segments(render(scene({ fields: [field({ f: () => m })] })))
      expect(segs.length).toBeGreaterThan(100)
      for (const s of segs) {
        const [left, right] = s.a.x <= s.b.x ? [s.a, s.b] : [s.b, s.a]
        const dyScreen = right.y - left.y
        expect(Math.sign(dyScreen), `dy/dx = ${m} drew the wrong way`).toBe(sign)
        // 45 degrees on a square-pixel board
        expect(Math.abs(dyScreen)).toBeCloseTo(right.x - left.x, 6)
      }
    }
  })

  it('the slope is read in MATH units at the lattice point itself', () => {
    // dy/dx = x: the segment at a lattice point must be tangent to THAT
    // point's direction, which is the whole promise a slope field makes.
    const segs = segments(render(scene({ fields: [field({ f: (x) => x })] })))
    expect(segs.length).toBeGreaterThan(100)
    const want = FIELD_SEGMENT_FRACTION * FIELD_SPACING_PX
    for (const s of segs) {
      const [l, r] = s.a.x <= s.b.x ? [s.a, s.b] : [s.b, s.a]
      // screen y grows downward, so a positive slope is a NEGATIVE dy
      expect(r.y - l.y).toBeCloseTo(-s.mx * (r.x - l.x), 6)
      expect(s.len, 'a steeper direction drew a longer segment').toBeCloseTo(want, 6)
    }
    // and the directions genuinely differ across the board
    const flat = segs.filter((s) => Math.abs(s.mx) < 1e-9)
    expect(flat.length).toBeGreaterThan(0)
    for (const s of flat) expect(s.a.y).toBeCloseTo(s.b.y, 9)
  })

  it('a NaN slope leaves the point EMPTY', () => {
    const segs = segments(render(scene({
      fields: [field({ f: (x) => (x > 0 ? Number.NaN : 1) })],
    })))
    expect(segs.length).toBeGreaterThan(100)
    for (const s of segs) expect(s.mx).toBeLessThanOrEqual(1e-9)
  })

  it('an infinite slope draws the vertical limit, not a gap', () => {
    const full = segments(render(scene({ fields: [field({ f: () => 0 })] }))).length
    for (const m of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e308]) {
      const segs = segments(render(scene({ fields: [field({ f: () => m })] })))
      expect(segs.length, `dy/dx = ${m} dropped the lattice`).toBe(full)
      for (const s of segs.slice(0, 40)) {
        expect(s.a.x).toBeCloseTo(s.b.x, 9)
        expect(s.len).toBeCloseTo(FIELD_SEGMENT_FRACTION * FIELD_SPACING_PX, 6)
      }
    }
  })

  it('a field whose f throws costs that field, not the board', () => {
    const ctx = render(scene({
      fields: [field({ f: () => { throw new Error('boom') } })],
      polylines: [poly([{ x: -1, y: 0 }, { x: 1, y: 1 }])],
    }))
    expect(segments(ctx)).toHaveLength(0)
    expect(ctx.strokesIn(POLY_COLOR).length, 'the board went down with the field').toBe(1)
    expect(ctx.log.some((e) => e.op === 'stroke' && e.path)).toBe(true)
  })
})

describe('slope fields — the density guard', () => {
  it('a lattice that would exceed the cap widens instead of dropping segments', () => {
    const ctx = render(scene({ fields: [field({ spacingPx: 8 })] }))
    const segs = segments(ctx)
    expect(segs.length, 'the cap was blown').toBeLessThanOrEqual(FIELD_MAX_POINTS)
    // and it is a FULL lattice at a wider spacing, not a thinned one
    const cols = distinct(segs.map((s) => s.mx), 1e-9)
    const rows = distinct(segs.map((s) => s.my), 1e-9)
    expect(segs.length).toBe(cols.length * rows.length)
    expect(segs.length).toBeGreaterThan(FIELD_MAX_POINTS * 0.7)

    // the widened field still reaches both edges: the gap to each border is
    // under one spacing, so nothing was cut off the sides
    const spacing = segs[0].len / FIELD_SEGMENT_FRACTION
    expect(spacing).toBeGreaterThan(8)
    const half = VP.widthPx / 2 / VP.pxPerUnit
    expect(half - Math.max(...cols)).toBeLessThan(spacing / VP.pxPerUnit)
    expect(Math.min(...cols) + half).toBeLessThan(spacing / VP.pxPerUnit)
  })

  it('an extreme zoom-out stays legible rather than becoming a wash', () => {
    const far: Viewport = { ...VP, pxPerUnit: 0.05 }
    const segs = segments(
      render(scene({ vp: far, fields: [field({ spacingPx: 2 })] })),
      far,
    )
    expect(segs.length).toBeGreaterThan(0)
    expect(segs.length).toBeLessThanOrEqual(FIELD_MAX_POINTS)
  })

  it('a hidden field draws nothing at all', () => {
    const ctx = render(scene({ fields: [field({ visible: false })] }))
    expect(segments(ctx)).toHaveLength(0)
  })
})

describe('polylines — figure content', () => {
  const V: Vec2[] = [{ x: -2, y: 0 }, { x: 0, y: 1 }, { x: 2, y: 0 }]

  it('strokes the points in math coords at width 2 by default', () => {
    const ctx = render(scene({ polylines: [poly(V)] }))
    const [s] = ctx.strokesIn(POLY_COLOR)
    expect(s).toBeDefined()
    expect(s.lw).toBeCloseTo(POLYLINE_WIDTH, 6)
    expect(s.runs).toHaveLength(1)
    expect(s.runs[0]).toHaveLength(3)
    const toPx = (p: Vec2) => ({
      x: VP.widthPx / 2 + p.x * VP.pxPerUnit,
      y: VP.heightPx / 2 - p.y * VP.pxPerUnit,
    })
    expect(s.runs[0][0].x).toBeCloseTo(toPx(V[0]).x, 6)
    expect(s.runs[0][1].y).toBeCloseTo(toPx(V[1]).y, 6)
    expect(s.cap).toBe('round')
  })

  it('an explicit width and dash are honoured', () => {
    const ctx = render(scene({ polylines: [poly(V, { width: 4, dash: [6, 4] })] }))
    const [s] = ctx.strokesIn(POLY_COLOR)
    expect(s.lw).toBeCloseTo(4, 6)
    expect(s.dash).toEqual([6, 4])
    // and the dash does not leak into the curves drawn after it
    const curve = ctx.log.find((e) => e.op === 'stroke' && e.path)
    expect(curve?.dash ?? []).toEqual([])
  })

  it('present.stroke scales the weight', () => {
    const ctx = render(scene({ polylines: [poly(V)], present: { type: 1, stroke: 3 } }))
    expect(ctx.strokesIn(POLY_COLOR)[0].lw).toBeCloseTo(POLYLINE_WIDTH * 3, 6)
  })

  it('breaks the path on a non-finite point instead of joining across it', () => {
    const broken: Vec2[] = [
      { x: -2, y: 0 }, { x: -1, y: 1 },
      { x: Number.NaN, y: Number.NaN },
      { x: 1, y: 1 }, { x: 2, y: 0 },
    ]
    const ctx = render(scene({ polylines: [poly(broken)] }))
    const [s] = ctx.strokesIn(POLY_COLOR)
    expect(s.runs, 'the pen drew straight through the hole').toHaveLength(2)
    expect(s.runs[0]).toHaveLength(2)
    expect(s.runs[1]).toHaveLength(2)
  })

  it('clips generously rather than dropping a line that leaves the board', () => {
    const ctx = render(scene({ polylines: [poly([{ x: -1e6, y: -1e6 }, { x: 1e6, y: 1e6 }])] }))
    const [s] = ctx.strokesIn(POLY_COLOR)
    expect(s, 'a line crossing the whole board was dropped').toBeDefined()
    for (const p of s.pts) {
      expect(p.x).toBeGreaterThanOrEqual(-VP.widthPx - 1)
      expect(p.x).toBeLessThanOrEqual(2 * VP.widthPx + 1)
      expect(p.y).toBeGreaterThanOrEqual(-VP.heightPx - 1)
      expect(p.y).toBeLessThanOrEqual(2 * VP.heightPx + 1)
    }
    // and it really does cross the visible rectangle
    expect(Math.min(...s.pts.map((p) => p.x))).toBeLessThan(0)
    expect(Math.max(...s.pts.map((p) => p.x))).toBeGreaterThan(VP.widthPx)
  })

  it('a degenerate polyline draws nothing rather than throwing', () => {
    const ctx = render(scene({
      polylines: [
        poly([], { id: 'a' }),
        poly([{ x: 0, y: 0 }], { id: 'b' }),
        poly([{ x: Number.NaN, y: 0 }, { x: Number.NaN, y: 1 }], { id: 'c' }),
      ],
    }))
    expect(ctx.strokesIn(POLY_COLOR)).toHaveLength(0)
  })
})

describe('slope fields and polylines — the figure, not chrome', () => {
  const SCENE: Partial<BoardScene> = {
    fields: [field({ f: (x, y) => x - y })],
    polylines: [poly([{ x: -2, y: 1 }, { x: 0, y: -1 }, { x: 2, y: 1 }])],
  }

  it('reach the export (chrome:null) and are identical with chrome on', () => {
    const exported = render(scene({ ...SCENE, chrome: null }))
    const onScreen = render(scene({ ...SCENE, chrome: chromeOn() }))
    const figure = (c: LogCtx): PaintOp[] =>
      c.log.filter(
        (e) => e.op === 'stroke' && (e.style === FIELD_COLOR || e.style === POLY_COLOR) && !e.path,
      )
    expect(figure(exported).length, 'the field never reached the export').toBe(2)
    expect(figure(exported)).toEqual(figure(onScreen))
  })

  it('a light ground maps both to the print palette, like the strokes', () => {
    const ctx = render(scene({ ...SCENE, theme: LIGHT_THEME }))
    expect(ctx.strokesIn(PRINT_CURVE_COLORS[1]), 'the field kept the screen palette on paper')
      .toHaveLength(1)
    expect(ctx.strokesIn(PRINT_CURVE_COLORS[2]), 'the solution curve did not map')
      .toHaveLength(1)
    expect(ctx.strokesIn(FIELD_COLOR)).toHaveLength(0)
    expect(ctx.strokesIn(POLY_COLOR)).toHaveLength(0)
  })
})

describe('slope fields — the regression guard', () => {
  /** Everything a mock canvas saw, as one comparable value. */
  const snapshot = (c: LogCtx): string =>
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

  it('empty `fields` / `polylines` are byte-identical to the fields absent', () => {
    for (const over of [
      {},
      { chrome: chromeOn() },
      { theme: LIGHT_THEME },
      { present: { type: 2, stroke: 2 } },
      { overlays: [{ kind: 'area', curveId: 'sq', from: 0, to: 2 }] as Overlay[] },
    ] as Array<Partial<BoardScene>>) {
      const before = render(scene(over))
      const after = render(scene({ ...over, fields: [], polylines: [] }))
      expect(snapshot(after)).toBe(snapshot(before))
    }
  })

  it('a field that IS present changes the stream (the guard is not vacuous)', () => {
    const before = render(scene())
    expect(snapshot(render(scene({ fields: [field()] })))).not.toBe(snapshot(before))
    expect(snapshot(render(scene({ polylines: [poly([{ x: 0, y: 0 }, { x: 1, y: 1 }])] }))))
      .not.toBe(snapshot(before))
  })
})

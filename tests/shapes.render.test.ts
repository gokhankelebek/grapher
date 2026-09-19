// ============================================================================
// tests/shapes.render.test.ts — points, segments, vectors and polygons.
//
// What this file exists to hold:
//
//  1. A shape sits ON TOP of the curves it is measured against, and UNDER the
//     analysis layer and every piece of chrome. Get that order wrong and a
//     vertex disappears into a 2.5px stroke.
//  2. The arrowhead is the vector's meaning. The tip lands exactly on the
//     vector's tip (not a head-length short of it), the wings sit behind it at
//     22°, and the shaft stops at the wings' base so it cannot poke through.
//  3. A vertex label is OUTSIDE the polygon, for a triangle typed clockwise
//     and for the same triangle typed counter-clockwise — a class types both.
//  4. The wash is only there when `fill` asked for it, and it is a wash.
//  5. A light ground maps shapes to the print palette, exactly as the strokes.
//  6. A board with no shapes draws exactly what it drew before this layer
//     existed, asserted on whole command streams rather than counts.
// ============================================================================

import { describe, it, expect } from 'vitest'
import {
  renderBoard,
  renderBoardToCanvas,
  type BoardChrome,
  type BoardScene,
  type Shape,
} from '../src/ui/renderBoard'
import {
  SHAPE_ARROW_HALF_ANGLE,
  SHAPE_ARROW_LEN,
  SHAPE_DOT_RADIUS,
  SHAPE_FILL_ALPHA,
  SHAPE_LABEL_PAD,
  SHAPE_POINT_RADIUS,
  SHAPE_POINT_RING_WIDTH,
  SHAPE_POLYGON_WIDTH,
  SHAPE_SEGMENT_WIDTH,
  SHAPE_VECTOR_WIDTH,
} from '../src/render/shapes'
import { LABEL_PX } from '../src/render/grid'
import { MockCtx, MockPath2D, withMockPath2D, type Cmd } from './mockCanvas'
import { MODELS } from '../src/core/fit/models'
import { analyzeCurve } from '../src/core/analyze'
import {
  CURVE_COLORS,
  PRINT_CURVE_COLORS,
  DARK_THEME,
  LIGHT_THEME,
} from '../src/core/types'
import type { FittedCurve, Vec2, Viewport } from '../src/core/types'

const VP: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 900, heightPx: 700 }

/** The shape palette slot, kept clear of the curve's own colour. */
const SHAPE_COLOR = CURVE_COLORS[3]
const SHAPE_PRINT = PRINT_CURVE_COLORS[3]

const SQ: FittedCurve = {
  id: 'sq', modelId: 'poly2', params: [0, 0, 1],   // y = x^2
  kind: 'explicit', domain: null,
  color: CURVE_COLORS[0], strokeWidth: 2.5, visible: true, error: 0,
}

/** Math → screen, the mapping every assertion below is written against. */
const px = (p: Vec2, vp: Viewport = VP) => ({
  x: vp.widthPx / 2 + (p.x - vp.center.x) * vp.pxPerUnit,
  y: vp.heightPx / 2 - (p.y - vp.center.y) * vp.pxPerUnit,
})

const point = (at: Vec2, over: Partial<Extract<Shape, { kind: 'point' }>> = {}): Shape => ({
  kind: 'point', id: 'pt', at, color: SHAPE_COLOR, visible: true, ...over,
})
const segment = (a: Vec2, b: Vec2, over: Partial<Extract<Shape, { kind: 'segment' }>> = {}): Shape => ({
  kind: 'segment', id: 'sg', a, b, color: SHAPE_COLOR, visible: true, ...over,
})
const vector = (v: Vec2, tail: Vec2 = { x: 0, y: 0 }, over: Partial<Extract<Shape, { kind: 'vector' }>> = {}): Shape => ({
  kind: 'vector', id: 'vc', tail, v, color: SHAPE_COLOR, visible: true, ...over,
})
const polygon = (pts: readonly Vec2[], over: Partial<Extract<Shape, { kind: 'polygon' }>> = {}): Shape => ({
  kind: 'polygon', id: 'pg', pts, color: SHAPE_COLOR, visible: true, ...over,
})

const TRI: Vec2[] = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }]

// ---------------------------------------------------------------------------
// A MockCtx that keeps the ORDER of paint operations, the geometry each one
// consumed and the state it was painted with. Same device as
// tests/fields.test.ts, plus arcs (every dot and disc here is an arc) and text
// (the label chips), which the ordering assertions need.
// ---------------------------------------------------------------------------

interface Arc { x: number; y: number; r: number }

interface PaintOp {
  op: 'fill' | 'stroke' | 'text'
  style: string
  lw: number
  alpha: number
  cap: string
  join: string
  /** True when stroke() was handed a Path2D — i.e. this is a fitted CURVE. */
  path: boolean
  text: string
  pts: Array<{ x: number; y: number }>
  arcs: Arc[]
  /** Subpaths: one per moveTo. */
  runs: Array<Array<{ x: number; y: number }>>
}

class LogCtx extends MockCtx {
  log: PaintOp[] = []
  private mark = 0

  private note(op: 'fill' | 'stroke' | 'text', path: boolean, text = ''): void {
    const pts: Array<{ x: number; y: number }> = []
    const runs: Array<Array<{ x: number; y: number }>> = []
    const arcs: Arc[] = []
    let cur: Array<{ x: number; y: number }> | null = null
    for (const c of this.own.cmds.slice(this.mark) as Cmd[]) {
      if (c.op === 'moveTo') {
        cur = [{ x: c.x, y: c.y }]
        runs.push(cur)
        pts.push({ x: c.x, y: c.y })
      } else if (c.op === 'lineTo') {
        if (cur) cur.push({ x: c.x, y: c.y })
        pts.push({ x: c.x, y: c.y })
      } else if (c.op === 'arc') {
        arcs.push({ x: c.x, y: c.y, r: c.r })
      }
    }
    this.mark = this.own.cmds.length
    this.log.push({
      op,
      style: op === 'stroke' ? this.strokeStyle : this.fillStyle,
      lw: this.lineWidth,
      alpha: this.globalAlpha,
      cap: this.lineCap,
      join: this.lineJoin,
      path,
      text,
      pts,
      arcs,
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
  override fillText(t: string, x: number, y: number): void {
    this.note('text', false, t)
    super.fillText(t, x, y)
  }

  /** Every op painted in a given colour that is not a fitted curve's path. */
  ops(color: string): PaintOp[] {
    return this.log.filter((e) => e.style === color && !e.path)
  }
  indexOf(pred: (e: PaintOp) => boolean): number {
    return this.log.findIndex(pred)
  }
  lastIndexOf(pred: (e: PaintOp) => boolean): number {
    for (let i = this.log.length - 1; i >= 0; i--) if (pred(this.log[i])) return i
    return -1
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

/**
 * Where a label chip's CENTRE landed, from the text the renderer drew.
 *
 * The chip is the analysis layer's: text at (box.x + pad, box.y + h/2) with
 * box.w = measureText + 2·pad, so the centre is recoverable from the text.
 * mockCanvas measures 6px per character.
 */
function chipCenter(ctx: LogCtx, text: string, type = 1): { x: number; y: number } | null {
  const t = ctx.texts.find((e) => e.text === text)
  if (!t) return null
  const w = text.length * 6 + 2 * SHAPE_LABEL_PAD * type
  return { x: t.x - SHAPE_LABEL_PAD * type + w / 2, y: t.y }
}

/** Ray casting, in screen space. */
function inside(poly: Array<{ x: number; y: number }>, p: { x: number; y: number }): boolean {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      c = !c
    }
  }
  return c
}

// ===========================================================================

describe('shapes — draw order', () => {
  it('paints after every curve and before the analysis layer and the chrome', () => {
    const ctx = render(scene({
      curves: [SQ],
      analysis: { curve: SQ, points: analyzeCurve(SQ, MODELS) },
      shapes: [polygon(TRI, { fill: true, labels: ['A', 'B', 'C'] })],
      chrome: { ...chromeOn(), ink: { pts: [{ x: -1, y: 0 }, { x: 1, y: 1 }], color: '#ffffff' } },
    }))

    const curve = ctx.lastIndexOf((e) => e.op === 'stroke' && e.path)
    const shapeFirst = ctx.indexOf((e) => e.style === SHAPE_COLOR && !e.path)
    const shapeLast = ctx.lastIndexOf((e) => e.style === SHAPE_COLOR && !e.path)
    // analysis labels are coordinates — "(x, y)" / a bare zero — never "A"
    const analysisText = ctx.indexOf((e) => e.op === 'text' && e.text.startsWith('('))
    const ink = ctx.indexOf((e) => e.op === 'stroke' && e.style === '#ffffff')

    expect(shapeFirst, 'the shape was never painted').toBeGreaterThanOrEqual(0)
    expect(curve, 'the curve was never stroked').toBeGreaterThanOrEqual(0)
    expect(analysisText, 'the analysis layer drew no coordinate label').toBeGreaterThanOrEqual(0)
    expect(ink, 'the in-progress ink was never drawn').toBeGreaterThanOrEqual(0)

    expect(curve, 'the figure went UNDER the curve it is measured against')
      .toBeLessThan(shapeFirst)
    expect(shapeLast, 'the analysis labels went under the figure').toBeLessThan(analysisText)
    expect(shapeLast, 'chrome went under the figure').toBeLessThan(ink)
  })

  it('a hidden shape draws nothing at all', () => {
    const ctx = render(scene({ shapes: [polygon(TRI, { visible: false })] }))
    expect(ctx.ops(SHAPE_COLOR)).toHaveLength(0)
  })
})

describe('shapes — point', () => {
  it('is a disc of radius 4 inside a ground-coloured ring', () => {
    const ctx = render(scene({ shapes: [point({ x: 2, y: 1 })] }))
    const p = px({ x: 2, y: 1 })

    const disc = ctx.ops(SHAPE_COLOR).find((e) => e.op === 'fill' && e.arcs.length === 1)
    expect(disc, 'no disc was filled').toBeDefined()
    expect(disc!.arcs[0].x).toBeCloseTo(p.x, 6)
    expect(disc!.arcs[0].y).toBeCloseTo(p.y, 6)
    expect(disc!.arcs[0].r).toBeCloseTo(SHAPE_POINT_RADIUS, 6)

    const ring = ctx.ops(DARK_THEME.bg).find((e) => e.op === 'stroke' && e.arcs.length === 1)
    expect(ring, 'the point has no ring — it vanishes on a curve of its own colour')
      .toBeDefined()
    expect(ring!.lw).toBeCloseTo(SHAPE_POINT_RING_WIDTH, 6)
    // the ring is OUTSIDE the disc: its inner edge is exactly the disc's rim,
    // so the disc keeps its full radius
    expect(ring!.arcs[0].r - SHAPE_POINT_RING_WIDTH / 2).toBeCloseTo(SHAPE_POINT_RADIUS, 6)
  })

  it('labels up and to the right of itself', () => {
    const ctx = render(scene({ shapes: [point({ x: 2, y: 1 }, { label: 'P' })] }))
    const p = px({ x: 2, y: 1 })
    const c = chipCenter(ctx, 'P')
    expect(c, 'the point label was never drawn').not.toBeNull()
    expect(c!.x, 'the label is not to the right').toBeGreaterThan(p.x)
    expect(c!.y, 'the label is not above (screen y grows downward)').toBeLessThan(p.y)
    // and clear of the disc and its ring
    expect(Math.hypot(c!.x - p.x, c!.y - p.y))
      .toBeGreaterThan(SHAPE_POINT_RADIUS + SHAPE_POINT_RING_WIDTH)
  })

  it('a non-finite coordinate skips the item rather than throwing', () => {
    const ctx = render(scene({
      shapes: [point({ x: Number.NaN, y: 1 }), point({ x: 0, y: Number.POSITIVE_INFINITY })],
    }))
    expect(ctx.ops(SHAPE_COLOR)).toHaveLength(0)
  })
})

describe('shapes — segment', () => {
  it('strokes both endpoints in math coords, round-capped, with endpoint dots', () => {
    const a = { x: -2, y: -1 }
    const b = { x: 3, y: 2 }
    const ctx = render(scene({ shapes: [segment(a, b)] }))
    const line = ctx.ops(SHAPE_COLOR).find((e) => e.op === 'stroke' && e.runs.length === 1)
    expect(line, 'the segment was never stroked').toBeDefined()
    expect(line!.lw).toBeCloseTo(SHAPE_SEGMENT_WIDTH, 6)
    expect(line!.cap).toBe('round')
    expect(line!.runs[0]).toHaveLength(2)
    expect(line!.runs[0][0].x).toBeCloseTo(px(a).x, 6)
    expect(line!.runs[0][0].y).toBeCloseTo(px(a).y, 6)
    expect(line!.runs[0][1].x).toBeCloseTo(px(b).x, 6)
    expect(line!.runs[0][1].y).toBeCloseTo(px(b).y, 6)

    const dots = ctx.ops(SHAPE_COLOR).filter((e) => e.op === 'fill' && e.arcs.length === 1)
    expect(dots).toHaveLength(2)
    for (const d of dots) expect(d.arcs[0].r).toBeCloseTo(SHAPE_DOT_RADIUS, 6)
  })

  it('labels each end away from the other, so neither sits on the segment', () => {
    const a = { x: -2, y: 0 }
    const b = { x: 2, y: 0 }
    const ctx = render(scene({ shapes: [segment(a, b, { labels: ['A', 'B'] })] }))
    const ca = chipCenter(ctx, 'A')
    const cb = chipCenter(ctx, 'B')
    expect(ca).not.toBeNull()
    expect(cb).not.toBeNull()
    expect(ca!.x, 'the A chip drifted inside the segment').toBeLessThan(px(a).x)
    expect(cb!.x, 'the B chip drifted inside the segment').toBeGreaterThan(px(b).x)
  })
})

describe('shapes — vector', () => {
  const V = { x: 4, y: 3 }
  const TAIL = { x: 0, y: 0 }

  function parts(ctx: LogCtx) {
    const head = ctx.ops(SHAPE_COLOR).find((e) => e.op === 'fill' && e.pts.length === 3)
    const shaft = ctx.ops(SHAPE_COLOR).find((e) => e.op === 'stroke' && e.runs.length === 1)
    return { head, shaft }
  }

  it('the head lands ON the tip, with both wings behind it at 22 degrees', () => {
    const ctx = render(scene({ shapes: [vector(V, TAIL)] }))
    const tail = px(TAIL)
    const tip = px({ x: TAIL.x + V.x, y: TAIL.y + V.y })
    const { head } = parts(ctx)
    expect(head, 'the arrowhead was never filled').toBeDefined()

    const [t, w1, w2] = head!.pts
    expect(t.x, 'the head does not reach the vector tip').toBeCloseTo(tip.x, 6)
    expect(t.y).toBeCloseTo(tip.y, 6)

    const len = Math.hypot(tip.x - tail.x, tip.y - tail.y)
    const u = { x: (tip.x - tail.x) / len, y: (tip.y - tail.y) / len }
    for (const w of [w1, w2]) {
      const d = Math.hypot(w.x - tip.x, w.y - tip.y)
      expect(d, 'the head is not 12px along its wings').toBeCloseTo(SHAPE_ARROW_LEN, 6)
      // behind the tip: the wing points back along the direction of travel
      const dot = ((w.x - tip.x) * u.x + (w.y - tip.y) * u.y) / d
      expect(dot, 'a wing is in FRONT of the tip').toBeLessThan(0)
      expect(Math.acos(-dot)).toBeCloseTo(SHAPE_ARROW_HALF_ANGLE, 6)
    }
    // one wing each side
    const side = (w: { x: number; y: number }): number =>
      (w.x - tip.x) * u.y - (w.y - tip.y) * u.x
    expect(Math.sign(side(w1)) * Math.sign(side(w2))).toBe(-1)
  })

  it('the shaft stops at the wings’ base and never pokes through the head', () => {
    const ctx = render(scene({ shapes: [vector(V, TAIL)] }))
    const tail = px(TAIL)
    const tip = px({ x: V.x, y: V.y })
    const { shaft } = parts(ctx)
    expect(shaft, 'the shaft was never stroked').toBeDefined()
    expect(shaft!.lw).toBeCloseTo(SHAPE_VECTOR_WIDTH, 6)
    expect(shaft!.cap).toBe('round')

    const [s0, s1] = shaft!.runs[0]
    expect(s0.x).toBeCloseTo(tail.x, 6)
    expect(s0.y).toBeCloseTo(tail.y, 6)
    const back = Math.hypot(tip.x - s1.x, tip.y - s1.y)
    expect(back, 'the shaft ran all the way to the tip').toBeGreaterThan(0)
    expect(back).toBeCloseTo(SHAPE_ARROW_LEN * Math.cos(SHAPE_ARROW_HALF_ANGLE), 6)
    // and it stopped short along the SHAFT, not off to one side
    const len = Math.hypot(tip.x - tail.x, tip.y - tail.y)
    const cross =
      ((s1.x - tail.x) * (tip.y - tail.y) - (s1.y - tail.y) * (tip.x - tail.x)) / len
    expect(Math.abs(cross)).toBeLessThan(1e-9)
  })

  it('a vector shorter than its own head is all head, never a reversed shaft', () => {
    const tiny = { x: 0.05, y: 0 }   // 3px at 60px/unit, head is 12px
    const ctx = render(scene({ shapes: [vector(tiny, TAIL)] }))
    const { head, shaft } = parts(ctx)
    expect(head).toBeDefined()
    const tail = px(TAIL)
    const tip = px(tiny)
    const [s0, s1] = shaft!.runs[0]
    expect(s0.x).toBeCloseTo(tail.x, 6)
    // the shaft end lies between tail and tip, never behind the tail
    expect(s1.x).toBeGreaterThanOrEqual(tail.x - 1e-9)
    expect(s1.x).toBeLessThanOrEqual(tip.x + 1e-9)
  })

  it('the zero vector is a dot at its tail and nothing else', () => {
    const ctx = render(scene({ shapes: [vector({ x: 0, y: 0 }, { x: 1, y: 1 }, { label: 'v' })] }))
    const ops = ctx.ops(SHAPE_COLOR)
    expect(ops.filter((e) => e.op === 'fill' && e.pts.length === 3), 'a head with no direction')
      .toHaveLength(0)
    expect(ops.filter((e) => e.op === 'stroke'), 'a shaft with no direction').toHaveLength(0)
    const dot = ops.find((e) => e.op === 'fill' && e.arcs.length === 1)
    expect(dot).toBeDefined()
    expect(dot!.arcs[0].x).toBeCloseTo(px({ x: 1, y: 1 }).x, 6)
    expect(dot!.arcs[0].r).toBeCloseTo(SHAPE_DOT_RADIUS, 6)
    expect(chipCenter(ctx, 'v'), 'the zero vector lost its name').not.toBeNull()
  })

  it('labels the midpoint on the LEFT-hand side of the direction of travel', () => {
    const ctx = render(scene({ shapes: [vector(V, TAIL, { label: 'v' })] }))
    const tail = px(TAIL)
    const tip = px(V)
    const mid = { x: (tail.x + tip.x) / 2, y: (tail.y + tip.y) / 2 }
    const c = chipCenter(ctx, 'v')
    expect(c).not.toBeNull()
    const len = Math.hypot(tip.x - tail.x, tip.y - tail.y)
    const u = { x: (tip.x - tail.x) / len, y: (tip.y - tail.y) / len }
    // left of travel, in MATH orientation, is screen (u.y, -u.x)
    const off = { x: c!.x - mid.x, y: c!.y - mid.y }
    const onLeft = off.x * u.y - off.y * u.x
    expect(onLeft, 'the label rode the right-hand side').toBeGreaterThan(0)
    // travelling up-and-right, the left hand points up-and-left
    expect(c!.x).toBeLessThan(mid.x)
    expect(c!.y).toBeLessThan(mid.y)
  })
})

describe('shapes — polygon', () => {
  it('closes the path at width 2 with round joins and drops a dot on each vertex', () => {
    const ctx = render(scene({ shapes: [polygon(TRI)] }))
    const line = ctx.ops(SHAPE_COLOR).find((e) => e.op === 'stroke')
    expect(line, 'the polygon was never stroked').toBeDefined()
    expect(line!.lw).toBeCloseTo(SHAPE_POLYGON_WIDTH, 6)
    expect(line!.join).toBe('round')
    // three edges INCLUDING the closing one, as one unbroken run
    expect(line!.runs).toHaveLength(1)
    expect(line!.runs[0]).toHaveLength(4)
    expect(line!.runs[0][3].x).toBeCloseTo(px(TRI[0]).x, 6)
    expect(line!.runs[0][3].y).toBeCloseTo(px(TRI[0]).y, 6)

    const dots = ctx.ops(SHAPE_COLOR).filter((e) => e.op === 'fill' && e.arcs.length === 1)
    expect(dots).toHaveLength(3)
  })

  it('fills at a wash, and ONLY when fill is asked for', () => {
    const on = render(scene({ shapes: [polygon(TRI, { fill: true })] }))
    const wash = on.ops(SHAPE_COLOR).find((e) => e.op === 'fill' && e.pts.length === 3)
    expect(wash, 'the filled polygon has no fill').toBeDefined()
    expect(wash!.alpha).toBeCloseTo(SHAPE_FILL_ALPHA, 6)
    expect(SHAPE_FILL_ALPHA).toBeLessThan(0.3)
    // the outline goes ON TOP of the wash, at full strength
    const outline = on.log.findIndex((e) => e.op === 'stroke' && e.style === SHAPE_COLOR)
    const fillIdx = on.log.findIndex((e) => e.op === 'fill' && e.style === SHAPE_COLOR)
    expect(fillIdx).toBeLessThan(outline)
    expect(on.log[outline].alpha).toBeCloseTo(1, 6)

    for (const off of [polygon(TRI), polygon(TRI, { fill: false })]) {
      const ctx = render(scene({ shapes: [off] }))
      expect(
        ctx.ops(SHAPE_COLOR).filter((e) => e.op === 'fill' && e.alpha < 1),
        'an unfilled polygon was washed anyway',
      ).toHaveLength(0)
    }
  })

  it('puts every vertex label OUTSIDE, whichever way round the triangle is typed', () => {
    for (const [name, pts] of [
      ['counter-clockwise', TRI],
      ['clockwise', TRI.slice().reverse()],
    ] as Array<[string, Vec2[]]>) {
      const labels = ['A', 'B', 'C']
      const ctx = render(scene({ shapes: [polygon(pts, { fill: true, labels })] }))
      const screen = pts.map((p) => px(p))
      for (let i = 0; i < labels.length; i++) {
        const c = chipCenter(ctx, labels[i])
        expect(c, `${name}: label ${labels[i]} was never drawn`).not.toBeNull()
        expect(inside(screen, c!), `${name}: label ${labels[i]} sits INSIDE the triangle`)
          .toBe(false)
        // and it is the label of ITS vertex: nearer that corner than any other
        const d = (q: { x: number; y: number }) => Math.hypot(c!.x - q.x, c!.y - q.y)
        for (let j = 0; j < screen.length; j++) {
          if (j !== i) expect(d(screen[i])).toBeLessThan(d(screen[j]))
        }
      }
    }
  })

  it('a degenerate polygon draws what exists rather than nothing', () => {
    const two = render(scene({ shapes: [polygon([{ x: 0, y: 0 }, { x: 2, y: 1 }], { fill: true, labels: ['A', 'B'] })] }))
    const line = two.ops(SHAPE_COLOR).find((e) => e.op === 'stroke')
    expect(line, 'two points drew no segment').toBeDefined()
    expect(line!.runs[0], 'two points were closed into a degenerate loop').toHaveLength(2)
    expect(two.ops(SHAPE_COLOR).filter((e) => e.op === 'fill' && e.alpha < 1), 'a line was filled')
      .toHaveLength(0)
    expect(chipCenter(two, 'A')).not.toBeNull()
    expect(chipCenter(two, 'B')).not.toBeNull()

    const one = render(scene({ shapes: [polygon([{ x: 1, y: 1 }], { labels: ['A'] })] }))
    const dots = one.ops(SHAPE_COLOR).filter((e) => e.op === 'fill' && e.arcs.length === 1)
    expect(dots, 'a single vertex drew no dot').toHaveLength(1)
    expect(chipCenter(one, 'A')).not.toBeNull()

    const none = render(scene({ shapes: [polygon([])] }))
    expect(none.ops(SHAPE_COLOR)).toHaveLength(0)
  })

  it('one non-finite vertex skips the whole polygon', () => {
    const ctx = render(scene({
      shapes: [polygon([{ x: 0, y: 0 }, { x: Number.NaN, y: 1 }, { x: 2, y: 2 }], { fill: true })],
    }))
    expect(ctx.ops(SHAPE_COLOR)).toHaveLength(0)
  })
})

describe('shapes — the viewport', () => {
  it('clips a huge polygon to the overdraw box instead of rasterising it', () => {
    const ctx = render(scene({
      shapes: [polygon([{ x: -1e6, y: -1e6 }, { x: 1e6, y: -1e6 }, { x: 0, y: 1e6 }], { fill: true })],
    }))
    const ops = ctx.ops(SHAPE_COLOR)
    expect(ops.length, 'a polygon covering the whole board was dropped').toBeGreaterThan(0)
    for (const e of ops) {
      for (const p of e.pts) {
        expect(p.x).toBeGreaterThanOrEqual(-VP.widthPx - 1)
        expect(p.x).toBeLessThanOrEqual(2 * VP.widthPx + 1)
        expect(p.y).toBeGreaterThanOrEqual(-VP.heightPx - 1)
        expect(p.y).toBeLessThanOrEqual(2 * VP.heightPx + 1)
      }
    }
  })

  it('a shape parked far off the board costs nothing', () => {
    const ctx = render(scene({
      shapes: [
        polygon([{ x: 1e5, y: 1e5 }, { x: 1e5 + 1, y: 1e5 }, { x: 1e5, y: 1e5 + 1 }], { fill: true }),
        point({ x: -1e5, y: 0 }, { label: 'Q' }),
      ],
    }))
    expect(ctx.ops(SHAPE_COLOR)).toHaveLength(0)
    expect(ctx.texts.some((t) => t.text === 'Q')).toBe(false)
  })
})

describe('shapes — presentation scale', () => {
  it('every weight and glyph follows present.stroke, and the labels present.type', () => {
    const shapes = [
      polygon(TRI, { fill: true, labels: ['A', 'B', 'C'] }),
      vector({ x: 4, y: 3 }),
      point({ x: -2, y: 1 }),
    ]
    const ctx = render(scene({ shapes, present: { type: 2, stroke: 2 } }))
    const ops = ctx.ops(SHAPE_COLOR)

    const outline = ops.find((e) => e.op === 'stroke' && e.lw > 3)
    expect(outline!.lw).toBeCloseTo(SHAPE_POLYGON_WIDTH * 2, 6)
    const disc = ops.find((e) => e.op === 'fill' && e.arcs.length === 1 && e.arcs[0].r > 6)
    expect(disc!.arcs[0].r).toBeCloseTo(SHAPE_POINT_RADIUS * 2, 6)
    // the arrowhead is the only FULL-strength three-point fill; the polygon's
    // wash is the other one
    const head = ops.find((e) => e.op === 'fill' && e.pts.length === 3 && e.alpha === 1)
    const tip = px({ x: 4, y: 3 })
    expect(Math.hypot(head!.pts[1].x - tip.x, head!.pts[1].y - tip.y))
      .toBeCloseTo(SHAPE_ARROW_LEN * 2, 6)

    // the chip grew with the FONT: 11px * type
    expect(ctx.font.startsWith(`${LABEL_PX * 2}px`), `labels were set in ${ctx.font}`).toBe(true)
    const near = chipCenter(render(scene({ shapes })), 'A')!
    const far = chipCenter(ctx, 'A', 2)!
    const v = px(TRI[0])
    expect(Math.hypot(far.x - v.x, far.y - v.y), 'the chip did not step further out at 2x')
      .toBeGreaterThan(Math.hypot(near.x - v.x, near.y - v.y))
  })
})

describe('shapes — the figure, not chrome', () => {
  const SHAPES: Shape[] = [
    polygon(TRI, { fill: true, labels: ['A', 'B', 'C'] }),
    vector({ x: 4, y: 3 }, { x: 0, y: 0 }, { label: 'v' }),
    segment({ x: -3, y: 2 }, { x: -1, y: -2 }, { labels: ['M', 'N'] }),
    point({ x: 2, y: 4 }, { label: 'P' }),
  ]

  it('reach the export (chrome:null) and are identical with chrome on', () => {
    const exported = render(scene({ shapes: SHAPES, chrome: null }))
    const onScreen = render(scene({ shapes: SHAPES, chrome: chromeOn() }))
    const figure = (c: LogCtx): PaintOp[] => c.ops(SHAPE_COLOR)
    expect(figure(exported).length, 'the shapes never reached the export').toBeGreaterThan(0)
    expect(figure(exported)).toEqual(figure(onScreen))
  })

  it('a light ground maps them to the print palette, like the strokes', () => {
    const ctx = render(scene({ shapes: SHAPES, theme: LIGHT_THEME }))
    expect(ctx.ops(SHAPE_PRINT).length, 'the figure kept the screen palette on paper')
      .toBeGreaterThan(0)
    expect(ctx.ops(SHAPE_COLOR), 'a screen colour leaked into the print figure').toHaveLength(0)
    // the label chips follow the ground too
    expect(ctx.texts.some((t) => t.text === 'A')).toBe(true)
  })

  it('renderBoardToCanvas carries them into the exported image', () => {
    const ctx = new LogCtx()
    const g = globalThis as unknown as { document?: unknown }
    const prev = g.document
    g.document = {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ctx as unknown as CanvasRenderingContext2D,
      }),
    }
    try {
      const out = withMockPath2D(() =>
        renderBoardToCanvas(
          { ...scene({ shapes: SHAPES, theme: LIGHT_THEME, chrome: null }) },
          { scale: 2, width: null, margin: 24, theme: 'light' },
        ),
      )
      expect(out, 'the export produced no canvas').not.toBeNull()
    } finally {
      if (prev === undefined) delete g.document
      else g.document = prev
    }
    expect(ctx.ops(SHAPE_PRINT).length, 'the exported PNG lost the figure').toBeGreaterThan(0)
    expect(ctx.texts.map((t) => t.text)).toEqual(expect.arrayContaining(['A', 'B', 'C', 'v', 'P']))
  })
})

describe('shapes — the regression guard', () => {
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

  it('an empty `shapes` is byte-identical to the field being absent', () => {
    for (const over of [
      {},
      { chrome: chromeOn() },
      { theme: LIGHT_THEME },
      { present: { type: 2, stroke: 2 } },
      { analysis: { curve: SQ, points: analyzeCurve(SQ, MODELS) } },
    ] as Array<Partial<BoardScene>>) {
      const before = render(scene(over))
      const after = render(scene({ ...over, shapes: [] }))
      expect(snapshot(after)).toBe(snapshot(before))
    }
  })

  it('a shape that IS present changes the stream (the guard is not vacuous)', () => {
    const before = render(scene())
    expect(snapshot(render(scene({ shapes: [point({ x: 1, y: 1 })] })))).not.toBe(snapshot(before))
  })
})

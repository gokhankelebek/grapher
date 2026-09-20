// ============================================================================
// tests/holes.render.test.ts — the two marks a broken graph has to carry.
//
// Six claims this file exists to hold:
//
//  1. A hole's ring is the OPEN END CAP'S OWN GLYPH — the same command stream,
//     down to the radius, the ring weight and the order of fill and stroke.
//     Both say "this point is not on the graph", and one fact gets one glyph.
//  2. The ring is drawn in EVERY figure style, the SCREEN included. A hole is
//     not a figure convention: a board that draws (x²−1)/(x−1) as an unbroken
//     line through (1, 2) has stated something false, whatever paper it is on.
//  3. A dashed vertical asymptote is the opposite: a convention, drawn only
//     where the figure MARKS what its curves do (textbook / SAT / AP), only
//     inside the board, full height, and UNDER the curve.
//  4. With both lists empty nothing is issued at all — not a save, not a style
//     assignment — so the board is byte-for-byte the board it was before.
//  5. A hole off the board, and a pole off the board, are not drawn.
//  6. In the analysis layer a hole gets its LABEL and no marker: the ring the
//     curve loop drew is already the marker, and a disc on top of the one mark
//     whose meaning is that it is empty would fill it in.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * src/core/holes.ts is the other half of this feature and is still a stub, so
 * the LISTS are controlled here. That is the seam on purpose: finding a hole
 * is arithmetic and is tested in core, drawing one is ink and is tested here.
 */
const core = vi.hoisted(() => ({
  holes: [] as { x: number; y: number; exact: boolean }[],
  poles: [] as number[],
  holeCalls: [] as [number, number][],
  poleCalls: [] as [number, number][],
}))

vi.mock('../src/core/holes', () => ({
  findHoles: (_c: unknown, _m: unknown, range: [number, number]) => {
    core.holeCalls.push(range)
    return core.holes
  },
  findPoles: (_c: unknown, _m: unknown, range: [number, number]) => {
    core.poleCalls.push(range)
    return core.poles
  },
}))

import { renderBoard, type BoardScene } from '../src/ui/renderBoard'
import {
  ASYMPTOTE_ALPHA,
  ASYMPTOTE_DASH,
  ASYMPTOTE_WIDTH,
  RANGE_PAD,
  drawAsymptotes,
  drawHoles,
  holeRange,
} from '../src/render/holes'
import { END_DOT_R, END_OPEN_RING, curveEndPoints, drawCurveEnds } from '../src/render/endCaps'
import { MockCtx, MockPath2D, withMockPath2D, type Cmd } from './mockCanvas'
import { MODELS } from '../src/core/fit/models'
import { parseExpression } from '../src/core/parse'
import { CURVE_COLORS, DARK_THEME, FIGURE_STYLES, toPrintColor, toScreen } from '../src/core/types'
import type { FittedCurve, ModelSpec, SpecialPoint, Viewport } from '../src/core/types'

// x in [-7.5, 7.5], y in [-5, 5]
const VP: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 900, heightPx: 600 }
const sx = (x: number): number => VP.widthPx / 2 + x * VP.pxPerUnit
const sy = (y: number): number => VP.heightPx / 2 - y * VP.pxPerUnit

function curve(over: Partial<FittedCurve> = {}): FittedCurve {
  return {
    id: 'c1', modelId: 'poly3', params: [0, -3, 0, 1], kind: 'explicit', domain: null,
    color: CURVE_COLORS[0], strokeWidth: 2.5, visible: true, error: 0.01,
    ...over,
  }
}

/** y = x^3 - 3x. */
const CUBIC = curve()
/** y = 0.5x^2 - 1 on [-2, 3]: both ends stop well inside the board. */
const PARABOLA = curve({ modelId: 'poly2', params: [-1, 0, 0.5], domain: [-2, 3] })

// ---------------------------------------------------------------------------
// A recording context that keeps each paint op with the subpath it consumed,
// its style, its weight, its alpha and its DASH — an asymptote is a dash and
// nothing else, so a recorder that drops the dash cannot see it.
// ---------------------------------------------------------------------------

interface Arc { x: number; y: number; r: number }
interface Op {
  kind: 'fill' | 'stroke'
  style: string
  lw: number
  alpha: number
  dash: number[]
  /** True when stroke() was handed a Path2D — i.e. this is a CURVE. */
  path: boolean
  pts: Array<{ x: number; y: number }>
  arcs: Arc[]
}

class RecCtx extends MockCtx {
  ops: Op[] = []
  private begin = 0

  override beginPath(): void {
    this.begin = this.own.cmds.length
  }

  private note(kind: 'fill' | 'stroke', path: boolean): void {
    const pts: Array<{ x: number; y: number }> = []
    const arcs: Arc[] = []
    if (!path) {
      for (const c of this.own.cmds.slice(this.begin) as Cmd[]) {
        if (c.op === 'moveTo' || c.op === 'lineTo') pts.push({ x: c.x, y: c.y })
        else if (c.op === 'arc') arcs.push({ x: c.x, y: c.y, r: c.r })
      }
    }
    this.ops.push({
      kind,
      style: kind === 'fill' ? this.fillStyle : this.strokeStyle,
      lw: this.lineWidth,
      alpha: this.globalAlpha,
      dash: this.lineDash.slice(),
      path,
      pts,
      arcs,
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
}

/**
 * The ink a curve is drawn in under a figure style: black under a mono style,
 * and the PRINT mapping of its own colour on the light ground every exam
 * figure uses. Exactly what renderBoard's own `ink()` resolves to.
 */
function inkOf(fig: { id: string; curveInk: string; theme: { axis: string } }): string {
  if (fig.curveInk === 'mono') return fig.theme.axis
  // A light ground selects the print palette by itself; the screen's near
  // black keeps the curve's own colour.
  return fig.id === 'screen' ? CUBIC.color : toPrintColor(CUBIC.color)
}

function scene(over: Partial<BoardScene> = {}): BoardScene {
  return {
    vp: VP, theme: DARK_THEME, curves: [CUBIC], styles: {}, models: MODELS,
    analysis: null, chrome: null,
    ...over,
  }
}

function render(s: BoardScene): RecCtx {
  const ctx = new RecCtx()
  withMockPath2D(() => renderBoard(ctx as unknown as CanvasRenderingContext2D, s))
  return ctx
}

/** Everything a mock canvas saw, as one comparable value. */
const snapshot = (c: RecCtx): string =>
  JSON.stringify({
    cmds: c.own.cmds,
    ops: c.ops,
    texts: c.texts,
    fills: c.fills,
    strokeStyles: c.strokeStyles,
    fillStyles: c.fillStyles,
    counts: [c.strokeCount, c.fillCount, c.textCount, c.saveCount, c.restoreCount],
    paths: c.strokedPaths.map((p) => p.cmds),
  })

/**
 * Every open ring in a render, read back the way a reader sees it: a disc
 * filled in the GROUND at the end-cap radius, immediately re-stroked in the
 * ink. Position is returned so a test can say WHERE the ring is.
 */
function rings(ctx: RecCtx, ink: string, bg: string, stroke = 1): Arc[] {
  const r = END_DOT_R * stroke
  const out: Arc[] = []
  for (let i = 0; i < ctx.ops.length - 1; i++) {
    const f = ctx.ops[i]
    const s = ctx.ops[i + 1]
    if (f.kind !== 'fill' || f.style !== bg || f.arcs.length !== 1) continue
    if (Math.abs(f.arcs[0].r - r) > 1e-9) continue
    if (s.kind !== 'stroke' || s.style !== ink || s.path) continue
    if (Math.abs(s.lw - END_OPEN_RING * stroke) > 1e-9) continue
    out.push(f.arcs[0])
  }
  return out
}

/** Every full-height dashed vertical rule in a render. */
function asymptotes(ctx: RecCtx): Op[] {
  return ctx.ops.filter(
    (o) =>
      o.kind === 'stroke' &&
      !o.path &&
      o.dash.length === 2 &&
      o.pts.length === 2 &&
      o.pts[0].x === o.pts[1].x &&
      o.pts[0].y === 0 &&
      o.pts[1].y === VP.heightPx,
  )
}

beforeEach(() => {
  core.holes = []
  core.poles = []
  core.holeCalls = []
  core.poleCalls = []
})

// ===========================================================================
// 1. One fact, one glyph
// ===========================================================================

describe('a hole is drawn with the open end cap’s own glyph', () => {
  const paint = { color: '#abcdef', bg: '#101214', stroke: 1 }

  /** The ops of a glyph, with its arcs re-centred so only the SHAPE compares. */
  function shape(ops: Op[], at: { x: number; y: number }): unknown {
    return ops.map((o) => ({
      kind: o.kind,
      style: o.style,
      lw: o.lw,
      alpha: o.alpha,
      arcs: o.arcs.map((a) => ({ dx: a.x - at.x, dy: a.y - at.y, r: a.r })),
      pts: o.pts.map((p) => ({ dx: p.x - at.x, dy: p.y - at.y })),
    }))
  }

  it('the two command streams are identical', () => {
    const pts = curveEndPoints(PARABOLA, MODELS, VP)
    expect(pts.start, 'fixture must have an end on the board').not.toBeNull()
    const at = pts.start!.at

    const capCtx = new RecCtx()
    withMockPath2D(() =>
      drawCurveEnds(
        capCtx as unknown as CanvasRenderingContext2D,
        VP,
        PARABOLA,
        MODELS,
        { start: 'open', end: 'none', startAuto: false, endAuto: false },
        { ...paint, width: 2.5 },
      ),
    )

    const holeCtx = new RecCtx()
    drawHoles(
      holeCtx as unknown as CanvasRenderingContext2D,
      VP,
      // the same SCREEN point, stated in math coordinates
      [{ x: PARABOLA.domain![0], y: 0.5 * PARABOLA.domain![0] ** 2 - 1 }],
      paint,
    )

    expect(holeCtx.ops.length, 'a hole is one ground disc and one ink ring').toBe(2)
    expect(shape(holeCtx.ops, holeCtx.ops[0].arcs[0])).toEqual(shape(capCtx.ops, at))
  })

  it('the ring is the end-cap radius and the end-cap ring weight, scaled', () => {
    for (const stroke of [1, 2.5]) {
      const ctx = new RecCtx()
      drawHoles(
        ctx as unknown as CanvasRenderingContext2D,
        VP,
        [{ x: 1, y: 2 }],
        { ...paint, stroke },
      )
      expect(ctx.ops[0].arcs[0].r).toBeCloseTo(END_DOT_R * stroke, 12)
      expect(ctx.ops[1].lw).toBeCloseTo(END_OPEN_RING * stroke, 12)
      // ground first, ink second: the ring has to sit on clean paper
      expect(ctx.ops[0]).toMatchObject({ kind: 'fill', style: paint.bg })
      expect(ctx.ops[1]).toMatchObject({ kind: 'stroke', style: paint.color })
    }
  })
})

// ===========================================================================
// 2. Every figure style rings a hole
// ===========================================================================

describe('a hole is a fact about the graph, not a figure convention', () => {
  const HOLE = { x: 1, y: 2, exact: true }

  it('every style rings it — Screen included', () => {
    for (const id of ['screen', 'textbook', 'sat', 'ap'] as const) {
      core.holes = [HOLE]
      const fig = FIGURE_STYLES[id]
      const ctx = render(scene({ figure: fig, theme: fig.theme }))
      const ink = inkOf(fig)
      const found = rings(ctx, ink, fig.theme.bg)
      expect(found.length, `${id}: expected exactly one ring`).toBe(1)
      expect(found[0].x).toBeCloseTo(sx(HOLE.x), 9)
      expect(found[0].y).toBeCloseTo(sy(HOLE.y), 9)
    }
  })

  it('the screen board without a figure rings it too', () => {
    core.holes = [HOLE]
    const ctx = render(scene())
    expect(rings(ctx, CUBIC.color, DARK_THEME.bg).length).toBe(1)
  })

  it('rings export: they are drawn with chrome null', () => {
    core.holes = [HOLE]
    const fig = FIGURE_STYLES.ap
    const ctx = render(scene({ figure: fig, theme: fig.theme, chrome: null }))
    expect(rings(ctx, fig.theme.axis, fig.theme.bg).length).toBe(1)
  })

  it('a hidden curve rings nothing, and a faded one fades its rings with it', () => {
    core.holes = [HOLE]
    expect(rings(render(scene({ curves: [curve({ visible: false })] })), CUBIC.color, DARK_THEME.bg))
      .toHaveLength(0)

    const faded = render(scene({ styles: { c1: { opacity: 0.4 } } }))
    const ring = faded.ops.find(
      (o) => o.kind === 'fill' && o.arcs.length === 1 &&
        Math.abs(o.arcs[0].r - END_DOT_R) < 1e-9 && o.style === DARK_THEME.bg,
    )
    expect(ring?.alpha).toBeCloseTo(0.4, 12)
  })
})

// ===========================================================================
// 3. Asymptotes are a convention
// ===========================================================================

describe('vertical asymptotes', () => {
  it('a marked figure rules one at each pole, full height, dashed', () => {
    for (const id of ['textbook', 'sat', 'ap'] as const) {
      core.poles = [-2, 3]
      const fig = FIGURE_STYLES[id]
      const ctx = render(scene({ figure: fig, theme: fig.theme }))
      const found = asymptotes(ctx)
      expect(found.length, id).toBe(2)
      expect(found.map((o) => o.pts[0].x)).toEqual([sx(-2), sx(3)])
      for (const o of found) {
        expect(o.lw).toBeCloseTo(ASYMPTOTE_WIDTH, 12)
        expect(o.dash).toEqual([ASYMPTOTE_DASH[0], ASYMPTOTE_DASH[1]])
        expect(o.alpha).toBeCloseTo(ASYMPTOTE_ALPHA, 12)
        expect(o.style).toBe(inkOf(fig))
      }
    }
  })

  it('the screen rules none, and the stream is the one it always drew', () => {
    const bare = snapshot(render(scene()))
    core.poles = [-2, 3]
    const withPoles = render(scene())
    expect(asymptotes(withPoles)).toHaveLength(0)
    expect(snapshot(withPoles)).toBe(bare)

    // an explicit 'screen' figure is the same statement said out loud
    core.poles = [-2, 3]
    const said = render(scene({ figure: FIGURE_STYLES.screen }))
    expect(asymptotes(said)).toHaveLength(0)
  })

  it('a pole outside the board is not ruled', () => {
    core.poles = [-40, 0, 40]
    const fig = FIGURE_STYLES.sat
    const found = asymptotes(render(scene({ figure: fig, theme: fig.theme })))
    expect(found).toHaveLength(1)
    expect(found[0].pts[0].x).toBeCloseTo(sx(0), 9)
  })

  it('the rule goes down BEFORE the curve it belongs to', () => {
    core.poles = [0]
    const fig = FIGURE_STYLES.sat
    const ctx = render(scene({ figure: fig, theme: fig.theme }))
    const rule = ctx.ops.findIndex((o) => o.dash.length === 2 && o.pts.length === 2 && !o.path)
    const stroke = ctx.ops.findIndex((o) => o.path)
    expect(rule).toBeGreaterThanOrEqual(0)
    expect(stroke).toBeGreaterThanOrEqual(0)
    expect(rule).toBeLessThan(stroke)
  })

  it('its dash does not leak into the curve drawn after it', () => {
    core.poles = [0]
    const fig = FIGURE_STYLES.sat
    const ctx = render(scene({ figure: fig, theme: fig.theme }))
    const curveOp = ctx.ops.find((o) => o.path)
    expect(curveOp?.dash ?? []).toEqual([])
  })

  it('a dashed curve keeps its own dash across the asymptote', () => {
    core.poles = [0]
    const fig = FIGURE_STYLES.sat
    const ctx = render(
      scene({ figure: fig, theme: fig.theme, styles: { c1: { dash: [9, 7] } } }),
    )
    expect(ctx.ops.find((o) => o.path)?.dash).toEqual([9, 7])
  })

  it('weights and dashes scale with present.stroke', () => {
    core.poles = [0]
    const fig = FIGURE_STYLES.sat
    const ctx = render(
      scene({ figure: fig, theme: fig.theme, present: { type: 1, stroke: 2 } }),
    )
    const o = asymptotes(ctx)[0]
    expect(o.lw).toBeCloseTo(ASYMPTOTE_WIDTH * 2, 12)
    expect(o.dash).toEqual([ASYMPTOTE_DASH[0] * 2, ASYMPTOTE_DASH[1] * 2])
  })
})

// ===========================================================================
// 4. Nothing to say, nothing said
// ===========================================================================

describe('an empty list is the board that was there before', () => {
  it('drawHoles and drawAsymptotes issue nothing at all', () => {
    for (const run of [
      (c: CanvasRenderingContext2D) =>
        drawHoles(c, VP, [], { color: '#fff', bg: '#000', stroke: 1 }),
      (c: CanvasRenderingContext2D) =>
        drawAsymptotes(c, VP, [], { color: '#fff', bg: '#000', stroke: 1 }),
    ]) {
      const ctx = new RecCtx()
      run(ctx as unknown as CanvasRenderingContext2D)
      expect(ctx.ops).toEqual([])
      expect(ctx.own.cmds).toEqual([])
      expect([ctx.saveCount, ctx.restoreCount, ctx.strokeCount, ctx.fillCount]).toEqual([0, 0, 0, 0])
      expect(ctx.lineDash).toEqual([])
      expect(ctx.strokeStyle).toBe('')
      expect(ctx.fillStyle).toBe('')
      expect(ctx.globalAlpha).toBe(1)
    }
  })

  it('a board with neither draws the identical command stream in every style', () => {
    for (const id of ['screen', 'textbook', 'sat', 'ap'] as const) {
      const fig = FIGURE_STYLES[id]
      const over = { figure: fig, theme: fig.theme }
      const bare = snapshot(render(scene(over)))
      // holes and poles that are all off the board say the same nothing
      core.holes = [{ x: 400, y: 0, exact: true }]
      core.poles = [400]
      expect(snapshot(render(scene(over))), id).toBe(bare)
      core.holes = []
      core.poles = []
    }
  })
})

// ===========================================================================
// 5. Range
// ===========================================================================

describe('the range holes are looked for in', () => {
  it('is the visible x-range, padded', () => {
    const span = VP.widthPx / VP.pxPerUnit
    expect(holeRange(VP)).toEqual([
      -span / 2 - span * RANGE_PAD,
      span / 2 + span * RANGE_PAD,
    ])
    expect(holeRange({ ...VP, pxPerUnit: 0 })).toBeNull()
    expect(holeRange({ ...VP, widthPx: 0 })).toBeNull()
  })

  it('renderBoard asks core for exactly that range', () => {
    render(scene())
    expect(core.holeCalls[0]).toEqual(holeRange(VP))
  })

  it('a hole outside the padded range is never drawn', () => {
    // -8.25 .. 8.25 is the padded range; 20 is well outside it, and outside
    // the board, so even a core that answered anyway would draw nothing.
    core.holes = [{ x: 20, y: 0, exact: true }]
    expect(rings(render(scene()), CUBIC.color, DARK_THEME.bg)).toHaveLength(0)
    core.holes = [{ x: 0, y: 0, exact: true }]
    expect(rings(render(scene()), CUBIC.color, DARK_THEME.bg)).toHaveLength(1)
  })

  it('a hole a hair off the edge still shows the ink that is on the board', () => {
    const edge = VP.center.x + VP.widthPx / 2 / VP.pxPerUnit
    core.holes = [{ x: edge + 0.01, y: 0, exact: true }]
    expect(rings(render(scene()), CUBIC.color, DARK_THEME.bg)).toHaveLength(1)
  })
})

// ===========================================================================
// 6. The analysis layer: a label, and no second glyph
// ===========================================================================

describe('a hole in the analysis layer', () => {
  // A hole's y is a LIMIT, so it is never exact — that is core's own rule,
  // and the chip prints it at the precision the method actually supports.
  const hole: SpecialPoint = { kind: 'hole', pos: { x: 1, y: 2 }, label: 'hole', exact: false }

  const withPoints = (points: SpecialPoint[]): RecCtx =>
    render(scene({ analysis: { curve: CUBIC, points } }))

  it('gets its coordinates as a chip', () => {
    const ctx = withPoints([hole])
    expect(ctx.texts.map((t) => t.text)).toContain('(1.000, 2.000)')
  })

  it('gets no marker of its own: the ring is the marker', () => {
    const none = withPoints([])
    const one = withPoints([hole])
    // the chip adds text, and its leader line and plate add strokes — but not
    // one more arc, because there is no glyph
    expect(one.textCount).toBeGreaterThan(none.textCount)
    expect(one.arcCount).toBe(none.arcCount)
  })

  it('a hole point does not throw and does not disturb its neighbours', () => {
    const zero: SpecialPoint = {
      kind: 'zero', pos: { x: -2, y: 0 }, label: 'zero', exact: true,
    }
    const withHole = withPoints([zero, hole])
    const without = withPoints([zero])
    // the zero keeps its own glyph
    expect(withHole.arcCount).toBe(without.arcCount)
    expect(withHole.texts.map((t) => t.text)).toContain('(1.000, 2.000)')
  })
})

// ===========================================================================
// 7. The pure drawing functions guard their own inputs
// ===========================================================================

describe('the drawing functions refuse nonsense rather than drawing it', () => {
  const paint = { color: '#fff', bg: '#000', stroke: 1 }

  it('a NaN hole is skipped, not drawn at NaN', () => {
    const ctx = new RecCtx()
    drawHoles(
      ctx as unknown as CanvasRenderingContext2D,
      VP,
      [{ x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: 0, y: 0 }],
      paint,
    )
    expect(ctx.ops.filter((o) => o.kind === 'fill')).toHaveLength(1)
    expect(ctx.ops[0].arcs[0]).toMatchObject({ x: toScreen({ x: 0, y: 0 }, VP).x })
  })

  it('a NaN pole is skipped', () => {
    const ctx = new RecCtx()
    drawAsymptotes(ctx as unknown as CanvasRenderingContext2D, VP, [NaN, 0], paint)
    expect(ctx.ops).toHaveLength(1)
  })

  it('an empty viewport draws nothing', () => {
    const dead = { ...VP, widthPx: 0 }
    const a = new RecCtx()
    drawHoles(a as unknown as CanvasRenderingContext2D, dead, [{ x: 0, y: 0 }], paint)
    const b = new RecCtx()
    drawAsymptotes(b as unknown as CanvasRenderingContext2D, dead, [0], paint)
    expect([a.ops.length, b.ops.length]).toEqual([0, 0])
  })
})

// ===========================================================================
// 8. One fact, one mark: a hole that IS an end is not ringed twice
// ===========================================================================

describe('a hole an open end cap already marks', () => {
  /** y = (x² − 1)/(x − 1): no value at x = 1, limit 2. */
  const SRC = 'y = (x^2 - 1)/(x - 1)'

  function rational(domain: [number, number] | null): {
    curve: FittedCurve
    models: Record<string, ModelSpec>
  } {
    const p = parseExpression(SRC)
    if (!p.ok) throw new Error(p.error)
    return {
      curve: curve({ modelId: 'e', params: p.plot.defaultParams, kind: p.plot.kind, domain }),
      models: { ...MODELS, e: p.plot.makeModel('e') },
    }
  }

  const HOLE = { x: 1, y: 2, exact: true }

  it('is drawn once, not twice, when the graph stops there', () => {
    core.holes = [HOLE]
    const fig = FIGURE_STYLES.sat
    // [-3, 1] makes the hole the RIGHT end: resolveEnds gives it an open dot.
    const t = rational([-3, 1])
    const ctx = render(
      scene({ ...t, curves: [t.curve], figure: fig, theme: fig.theme }),
    )
    const here = rings(ctx, fig.theme.axis, fig.theme.bg).filter(
      (a) => Math.abs(a.x - sx(1)) < 1 && Math.abs(a.y - sy(2)) < 1,
    )
    expect(here.length, 'one hollow circle, not two stacked').toBe(1)
  })

  it('is still drawn where the figure caps nothing at all', () => {
    core.holes = [HOLE]
    const t = rational([-3, 1])
    // the screen draws no end caps, so the ring is the only thing saying it
    const ctx = render(scene({ ...t, curves: [t.curve] }))
    const here = rings(ctx, CUBIC.color, DARK_THEME.bg).filter(
      (a) => Math.abs(a.x - sx(1)) < 1 && Math.abs(a.y - sy(2)) < 1,
    )
    expect(here.length).toBe(1)
  })

  it('is still drawn over a CLOSED cap — that cap says something else', () => {
    core.holes = [HOLE]
    const fig = FIGURE_STYLES.sat
    const t = rational([-3, 1])
    const ctx = render(
      scene({
        ...t,
        curves: [t.curve],
        figure: fig,
        theme: fig.theme,
        // the teacher NAMED a closed dot there; a filled disc at a hole is a
        // lie, and the ring has to go over it
        styles: { c1: { ends: { start: 'auto', end: 'closed' } } },
      }),
    )
    const here = rings(ctx, fig.theme.axis, fig.theme.bg).filter(
      (a) => Math.abs(a.x - sx(1)) < 1 && Math.abs(a.y - sy(2)) < 1,
    )
    expect(here.length).toBe(1)
  })

  it('a hole in the MIDDLE of the graph is ringed whatever the ends do', () => {
    core.holes = [HOLE]
    const fig = FIGURE_STYLES.sat
    const t = rational(null)
    const ctx = render(
      scene({ ...t, curves: [t.curve], figure: fig, theme: fig.theme }),
    )
    const here = rings(ctx, fig.theme.axis, fig.theme.bg).filter(
      (a) => Math.abs(a.x - sx(1)) < 1 && Math.abs(a.y - sy(2)) < 1,
    )
    expect(here.length).toBe(1)
  })
})

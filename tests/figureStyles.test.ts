// ============================================================================
// tests/figureStyles.test.ts — the LOOK of the board.
//
// Four claims this file exists to hold:
//
//  1. A scene that never mentions `figure` draws the board it drew before this
//     feature existed — asserted by comparing whole command streams, not
//     counts, the way the overlays/fields/polar suites do. An explicit
//     FIGURE_STYLES.screen is the same scene said out loud, so it must produce
//     the same stream.
//  2. Each grid mode is a real decision: 'ticks' puts NOTHING across the page,
//     'unit' rules every unit with majors every five, 'positive' arrows the two
//     ends a figure actually arrows.
//  3. Numbers on every unit THIN rather than overlap. A number that touches
//     its neighbour is worse than a tick with no number.
//  4. Mono ink means every curve is the axis colour — one black — and the
//     caption is FIGURE: it reaches the export (chrome:null) like the analysis
//     layer had to be taught to.
// ============================================================================

import { describe, it, expect } from 'vitest'
import {
  renderBoard,
  FILLED_POINT_R,
  MONO_FILL_ALPHA,
  type BoardChrome,
  type BoardScene,
  type Overlay,
  type Shape,
} from '../src/ui/renderBoard'
import {
  drawGrid,
  pickTickStep,
  unitTickStep,
  labelFont,
  UNIT_MIN_PX,
  type GridStyle,
} from '../src/render/grid'
import { MockCtx, MockPath2D, withMockPath2D, type Cmd } from './mockCanvas'
import { MODELS } from '../src/core/fit/models'
import { analyzeCurve } from '../src/core/analyze'
import { getHandles } from '../src/core/fit/edit'
import { CURVE_COLORS, DARK_THEME, LIGHT_THEME, FIGURE_STYLES } from '../src/core/types'
import type { FittedCurve, FigureStyle, Viewport } from '../src/core/types'

const VP: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 900, heightPx: 600 }
const sx = (vp: Viewport, x: number): number => vp.widthPx / 2 + (x - vp.center.x) * vp.pxPerUnit

/** y = x^3 - 3x: two turning points, an inflection, three zeros. */
const CUBIC: FittedCurve = {
  id: 'c1', modelId: 'poly3', params: [0, -3, 0, 1],
  kind: 'explicit', domain: [-2.4, 2.4],
  color: CURVE_COLORS[0], strokeWidth: 2.5, visible: true, error: 0.01,
}
/** A parabola that stops: y = 0.5x^2 - 1 on [-2, 3]. */
const PARABOLA: FittedCurve = {
  id: 'c2', modelId: 'poly2', params: [-1, 0, 0.5],
  kind: 'explicit', domain: [-2, 3],
  color: CURVE_COLORS[1], strokeWidth: 2.5, visible: true, error: 0.01,
}

const TRIANGLE: Shape = {
  kind: 'polygon', id: 's1', visible: true, fill: true,
  pts: [{ x: -2, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 2 }],
  color: CURVE_COLORS[2],
}
const AREA: Overlay = { kind: 'area', curveId: 'c2', from: -2, to: 3 }

// ---------------------------------------------------------------------------
// A MockCtx that keeps the ORDER of paint operations and the geometry each one
// consumed, so a gridline pass can be told from an axis pass and a curve from
// a tick. Same extension tests/overlays.test.ts makes, for the same reason.
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

  strokesIn(color: string): PaintOp[] {
    return this.log.filter((e) => e.op === 'stroke' && e.style === color && !e.path)
  }
  /** Every stroke that came from a Path2D — the curves, and only the curves. */
  curveStrokes(): PaintOp[] {
    return this.log.filter((e) => e.op === 'stroke' && e.path)
  }
}

function scene(over: Partial<BoardScene> = {}): BoardScene {
  return {
    vp: VP, theme: DARK_THEME, curves: [CUBIC], styles: {}, models: MODELS,
    analysis: null, chrome: null,
    ...over,
  }
}

function render(s: BoardScene): LogCtx {
  const ctx = new LogCtx()
  withMockPath2D(() => renderBoard(ctx as unknown as CanvasRenderingContext2D, s))
  return ctx
}

type Ctx2D = Parameters<typeof drawGrid>[0]

function grid(
  style: Partial<GridStyle> | null,
  vp: Viewport = VP,
  scale: { type: number; stroke: number } = { type: 1, stroke: 1 },
): LogCtx {
  const ctx = new LogCtx()
  const st = style === null ? null : { ...FIGURE_STYLES.screen, ...style }
  drawGrid(ctx as unknown as Ctx2D, vp, LIGHT_THEME, scale, null, st)
  return ctx
}

/** The x of every full-height vertical line in a pass. */
function verticals(pts: Array<{ x: number; y: number }>): number[] {
  const out: number[] = []
  for (let i = 0; i + 1 < pts.length; i += 2) {
    if (pts[i].x === pts[i + 1].x) out.push(pts[i].x)
  }
  return out
}

const chromeOn = (): BoardChrome => ({
  selectedId: CUBIC.id,
  handles: getHandles(CUBIC, MODELS),
  activeHandleId: null, highlight: null, openIdx: null, hoverIdx: null,
})

// ===========================================================================
// 1. The regression guard
// ===========================================================================

describe('figure styles — the board without one is the board it always was', () => {
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

  const VARIANTS: Array<Partial<BoardScene>> = [
    {},
    { chrome: chromeOn() },
    { theme: LIGHT_THEME },
    { present: { type: 2, stroke: 2 } },
    { analysis: { curve: CUBIC, points: analyzeCurve(CUBIC, MODELS) } },
    { curves: [CUBIC, PARABOLA], overlays: [AREA], shapes: [TRIANGLE] },
    { axisUnits: { x: 'pi' } },
    { grid: 'polar' },
  ]

  it('an absent `figure` is byte-identical to the board before the field existed', () => {
    // The field is optional, so "before" is simply a scene that omits it: what
    // this pins is that nothing in the new code path runs when it is omitted.
    for (const over of VARIANTS) {
      const a = render(scene(over))
      const b = render(scene({ ...over }))
      expect(snapshot(b)).toBe(snapshot(a))
    }
  })

  it("an explicit FIGURE_STYLES.screen draws the same stream as no figure at all", () => {
    for (const over of VARIANTS) {
      const bare = render(scene(over))
      const said = render(scene({ ...over, figure: FIGURE_STYLES.screen }))
      expect(snapshot(said), JSON.stringify(Object.keys(over))).toBe(snapshot(bare))
    }
  })

  it('an absent caption is byte-identical to an empty one', () => {
    const bare = render(scene())
    expect(snapshot(render(scene({ caption: '' })))).toBe(snapshot(bare))
    expect(snapshot(render(scene({ caption: '   ' })))).toBe(snapshot(bare))
  })

  it('a style actually changes the stream (the guard is not vacuous)', () => {
    const bare = render(scene())
    for (const id of ['textbook', 'sat', 'ap'] as const) {
      expect(snapshot(render(scene({ figure: FIGURE_STYLES[id] })))).not.toBe(snapshot(bare))
    }
  })

  it('drawGrid still takes five arguments and draws the same picture', () => {
    for (const ppu of [7, 23, 60, 140, 900]) {
      const vp = { ...VP, pxPerUnit: ppu }
      const bare = new LogCtx()
      drawGrid(bare as unknown as Ctx2D, vp, DARK_THEME, { type: 1, stroke: 1 }, null)
      const styled = new LogCtx()
      drawGrid(
        styled as unknown as Ctx2D, vp, DARK_THEME, { type: 1, stroke: 1 }, null,
        FIGURE_STYLES.screen,
      )
      expect(styled.own.cmds, `ppu=${ppu}`).toEqual(bare.own.cmds)
      expect(styled.texts, `ppu=${ppu}`).toEqual(bare.texts)
      expect(styled.strokeStyles, `ppu=${ppu}`).toEqual(bare.strokeStyles)
    }
  })
})

// ===========================================================================
// 2. Grid modes
// ===========================================================================

describe('grid mode — lines / ticks / none', () => {
  it("'ticks' emits no gridline strokes at all", () => {
    const lines = grid({ grid: 'lines' })
    const ticks = grid({ grid: 'ticks', spacing: 'unit' })
    expect(lines.strokesIn(LIGHT_THEME.gridMinor).length, 'fixture must rule the page')
      .toBeGreaterThan(0)
    expect(ticks.strokesIn(LIGHT_THEME.gridMinor)).toHaveLength(0)
    expect(ticks.strokesIn(LIGHT_THEME.gridMajor)).toHaveLength(0)
    // and nothing crosses the page: every stroked segment is short or is an axis
    for (const op of ticks.log) {
      if (op.op !== 'stroke') continue
      for (let i = 0; i + 1 < op.pts.length; i += 2) {
        const a = op.pts[i]
        const b = op.pts[i + 1]
        const spansPage = Math.abs(a.y - b.y) > 20 || Math.abs(a.x - b.x) > 20
        const isAxis = a.x === sx(VP, 0) || a.y === VP.heightPx / 2
        expect(spansPage && !isAxis, `a line crossed the page at ${a.x},${a.y}`).toBe(false)
      }
    }
  })

  it("'ticks' marks every spacing step, ~6px x present.stroke, centred on the axis", () => {
    const ctx = grid({ grid: 'ticks', spacing: 'unit' })
    const axisY = VP.heightPx / 2
    const marks = ctx.log
      .filter((e) => e.op === 'stroke')
      .flatMap((e) => e.pts)
      .filter((p, i, all) => i % 2 === 0 && all[i + 1] && all[i + 1].x === p.x && p.x !== sx(VP, 0))
    // ticks on the x axis sit at every integer but the origin: -7..7 minus 0
    expect(marks.length).toBe(14)
    for (const m of marks) {
      expect(Math.abs(m.y - axisY)).toBeCloseTo(3, 6) // half of TICK_PX
    }
    // and they scale with the stroke
    const big = grid({ grid: 'ticks', spacing: 'unit' }, VP, { type: 1, stroke: 2 })
    const tall = big.log
      .filter((e) => e.op === 'stroke')
      .flatMap((e) => e.pts)
      .filter((p) => p.x !== sx(VP, 0) && Math.abs(p.y - axisY) > 0.1)
    expect(Math.abs(tall[0].y - axisY)).toBeCloseTo(6, 6)
  })

  it("'none' draws bare axes: no gridlines, no ticks", () => {
    const ctx = grid({ grid: 'none' })
    expect(ctx.strokesIn(LIGHT_THEME.gridMinor)).toHaveLength(0)
    expect(ctx.strokesIn(LIGHT_THEME.gridMajor)).toHaveLength(0)
    expect(ctx.strokesIn(LIGHT_THEME.axis).length, 'the axes themselves are gone').toBe(2)
  })
})

// ===========================================================================
// 3. Spacing and numbers
// ===========================================================================

describe('spacing — unit vs the ladder', () => {
  it('at 60 px per unit the board is ruled every unit with majors every 5', () => {
    const ctx = grid({ grid: 'lines', spacing: 'unit' })
    const minors = verticals(ctx.strokesIn(LIGHT_THEME.gridMinor)[0].pts)
    const majors = verticals(ctx.strokesIn(LIGHT_THEME.gridMajor)[0].pts)
    // every integer in view except 0 is ruled, exactly once
    const all = [...minors, ...majors].sort((a, b) => a - b)
    const want = [-7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7].map((k) => sx(VP, k))
    expect(all).toEqual(want)
    // and the heavier pass is exactly the multiples of five
    expect(majors.sort((a, b) => a - b)).toEqual([sx(VP, -5), sx(VP, 5)])
  })

  it('the unit step itself is 5-with-5-minors, and falls back below ~12px', () => {
    expect(unitTickStep(60, UNIT_MIN_PX, null)).toEqual({ major: 5, minorDiv: 5 })
    expect(unitTickStep(12, UNIT_MIN_PX, null)).toEqual({ major: 5, minorDiv: 5 })
    // one unit narrower than the threshold: the 1-2-5 ladder takes over
    expect(unitTickStep(11.9, UNIT_MIN_PX, null)).toEqual(pickTickStep(11.9))
    expect(unitTickStep(2, UNIT_MIN_PX, null)).toEqual(pickTickStep(2))
  })

  it('a π axis counts in π/2 under unit spacing, and honours the ladder below it', () => {
    const vp = { ...VP, pxPerUnit: 60 }
    const ctx = grid({ grid: 'lines', spacing: 'unit', numbers: 'unit' }, vp)
    const piCtx = new LogCtx()
    drawGrid(
      piCtx as unknown as Ctx2D, vp, LIGHT_THEME, { type: 1, stroke: 1 }, { x: 'pi' },
      { ...FIGURE_STYLES.screen, grid: 'lines', spacing: 'unit', numbers: 'unit' },
    )
    const texts = piCtx.texts.map((t) => t.text)
    expect(texts, 'a π axis must print π labels, not decimals').toContain('π/2')
    expect(texts).toContain('π')
    expect(texts).toContain('3π/2')
    // the decimal board is untouched by the π one
    expect(ctx.texts.map((t) => t.text)).toContain('1')
  })
})

describe('numbers — every unit, thinned rather than overlapped', () => {
  const labelsAlongX = (ctx: LogCtx): Array<{ text: string; x: number; w: number }> =>
    ctx.texts
      .filter((t) => t.align === 'center')
      .map((t) => ({ text: t.text, x: t.x, w: t.text.length * 6 }))
      .sort((a, b) => a.x - b.x)

  it('labels every unit tick on both axes at 60 px per unit', () => {
    const ctx = grid({ spacing: 'unit', numbers: 'unit' })
    const xs = labelsAlongX(ctx).map((l) => l.text)
    expect(xs).toEqual(
      ['-7', '-6', '-5', '-4', '-3', '-2', '-1', '1', '2', '3', '4', '5', '6', '7'],
    )
    const ys = ctx.texts.filter((t) => t.baseline === 'middle').map((t) => t.text)
    expect(ys).toEqual(['-4', '-3', '-2', '-1', '1', '2', '3', '4'])
  })

  it('thins at 20 px per unit, and no two labels touch', () => {
    const vp = { ...VP, pxPerUnit: 20 }
    const ctx = grid({ spacing: 'unit', numbers: 'unit' }, vp)
    const labels = labelsAlongX(ctx)
    expect(labels.length, 'the row was emptied instead of thinned').toBeGreaterThan(6)
    for (const l of labels) expect(Math.abs(Number(l.text) % 2)).toBe(0) // thinned by 2
    for (let i = 1; i < labels.length; i++) {
      const left = labels[i - 1]
      const right = labels[i]
      expect(
        left.x + left.w / 2,
        `"${left.text}" and "${right.text}" overlap`,
      ).toBeLessThan(right.x - right.w / 2)
    }
  })

  it('thins further when the type is scaled up for a projector', () => {
    const vp = { ...VP, pxPerUnit: 20 }
    const one = labelsAlongX(grid({ spacing: 'unit', numbers: 'unit' }, vp))
    const big = labelsAlongX(
      grid({ spacing: 'unit', numbers: 'unit' }, vp, { type: 3, stroke: 1 }),
    )
    expect(big.length).toBeLessThan(one.length)
    for (let i = 1; i < big.length; i++) {
      expect(big[i - 1].x + big[i - 1].w / 2).toBeLessThan(big[i].x - big[i].w / 2)
    }
  })

  it("'major' still labels exactly what the screen labels", () => {
    const bare = grid(null)
    const major = grid({ numbers: 'major' })
    expect(major.texts).toEqual(bare.texts)
  })
})

// ===========================================================================
// 4. Arrows, axis names, the origin
// ===========================================================================

describe('axis furniture', () => {
  /** Arrowheads are the only closePath() drawGrid issues. */
  const heads = (ctx: LogCtx): number =>
    ctx.own.cmds.filter((c) => c.op === 'closePath').length

  it("'positive' emits exactly two arrowheads, 'four' four, 'none' none", () => {
    expect(heads(grid({ arrows: 'four' }))).toBe(4)
    expect(heads(grid({ arrows: 'positive' }))).toBe(2)
    expect(heads(grid({ arrows: 'none' }))).toBe(0)
  })

  it("'positive' arrows the +x and +y ends and no others", () => {
    const ctx = grid({ arrows: 'positive' })
    const fills = ctx.log.filter((e) => e.op === 'fill' && e.style === LIGHT_THEME.axis)
    const pts = fills.flatMap((f) => f.pts)
    // the +y head is at the top edge, the +x head at the right edge
    expect(pts.some((p) => p.y === 0)).toBe(true)
    expect(pts.some((p) => p.x === VP.widthPx)).toBe(true)
    // and nothing sits at the bottom or left ends
    expect(pts.some((p) => p.y === VP.heightPx)).toBe(false)
    expect(pts.some((p) => p.x === 0)).toBe(false)
  })

  it('axis names and O are present for AP and absent for Textbook', () => {
    const ap = render(scene({ figure: FIGURE_STYLES.ap })).texts.map((t) => t.text)
    const tb = render(scene({ figure: FIGURE_STYLES.textbook })).texts.map((t) => t.text)
    expect(ap).toContain('x')
    expect(ap).toContain('y')
    expect(ap).toContain('O')
    expect(ap, 'an exam figure never prints both O and 0').not.toContain('0')
    expect(tb).not.toContain('x')
    expect(tb).not.toContain('y')
    expect(tb).not.toContain('O')
    expect(tb).toContain('0')
    // SAT names its axes but keeps the zero
    const sat = render(scene({ figure: FIGURE_STYLES.sat })).texts.map((t) => t.text)
    expect(sat).toContain('x')
    expect(sat).toContain('0')
  })

  it('the last number steps aside for the axis name', () => {
    // measured at 1x: "7" at 884 and an italic "x" at 897 read as one token
    const named = grid({ spacing: 'unit', numbers: 'unit', axisNames: true })
    const anon = grid({ spacing: 'unit', numbers: 'unit', axisNames: false })
    const xs = (c: LogCtx): string[] =>
      c.texts.filter((t) => t.align === 'center').map((t) => t.text)
    expect(xs(anon)).toContain('7')
    expect(xs(named), 'the number crowded the name').not.toContain('7')
    expect(xs(named), 'the row was emptied, not trimmed').toContain('6')
    // same at the +y tip: a number 21px from the top used to sit under the y
    const high = { ...VP, center: { x: 0, y: 0.5 } }
    const ys = (c: LogCtx): string[] =>
      c.texts.filter((t) => t.baseline === 'middle').map((t) => t.text)
    expect(ys(grid({ spacing: 'unit', numbers: 'unit' }, high))).toContain('5')
    expect(
      ys(grid({ spacing: 'unit', numbers: 'unit', axisNames: true }, high)),
      'the number crowded the y',
    ).not.toContain('5')
  })

  it('the axis names are italic, and serif when the figure is', () => {
    const apCtx = new LogCtx()
    drawGrid(
      apCtx as unknown as Ctx2D, VP, LIGHT_THEME, { type: 1, stroke: 1 }, null,
      FIGURE_STYLES.ap,
    )
    const fonts = apCtx.texts.map((t) => t.text)
    expect(fonts).toContain('x')
    expect(labelFont(FIGURE_STYLES.ap, 11, true)).toMatch(/^italic 11px "Times New Roman"/)
    expect(labelFont(FIGURE_STYLES.sat, 11)).toBe(labelFont(null, 11))
  })
})

// ===========================================================================
// 5. Ink, points, caption
// ===========================================================================

describe('curve ink', () => {
  it('mono paints every curve in theme.axis', () => {
    const ctx = render(scene({ curves: [CUBIC, PARABOLA], figure: FIGURE_STYLES.sat }))
    const strokes = ctx.curveStrokes()
    expect(strokes.length, 'no curve was drawn').toBeGreaterThanOrEqual(2)
    for (const s of strokes) expect(s.style).toBe(FIGURE_STYLES.sat.theme.axis)
    expect(ctx.strokeStyles).not.toContain(CURVE_COLORS[0])
    expect(ctx.strokeStyles).not.toContain(CURVE_COLORS[1])
  })

  it('a palette style keeps the curves apart (print-mapped on white)', () => {
    const ctx = render(scene({ curves: [CUBIC, PARABOLA], figure: FIGURE_STYLES.textbook }))
    const inks = new Set(ctx.curveStrokes().map((s) => s.style))
    expect(inks.size, 'the textbook look is a COLOUR look').toBeGreaterThan(1)
    expect(inks.has(FIGURE_STYLES.textbook.theme.axis)).toBe(false)
  })

  it('curveWidth replaces the default weight; a per-curve width still wins', () => {
    const preset = render(scene({ curves: [CUBIC], figure: FIGURE_STYLES.ap }))
    expect(preset.curveStrokes()[0].lw).toBe(FIGURE_STYLES.ap.curveWidth)
    const own = render(
      scene({ curves: [CUBIC], styles: { c1: { width: 6 } }, figure: FIGURE_STYLES.ap }),
    )
    expect(own.curveStrokes()[0].lw).toBe(6)
    // and it scales with the projector
    const big = render(
      scene({ curves: [CUBIC], figure: FIGURE_STYLES.ap, present: { type: 2, stroke: 2 } }),
    )
    expect(big.curveStrokes()[0].lw).toBe(FIGURE_STYLES.ap.curveWidth * 2)
  })

  it('no selection halo under mono ink on white', () => {
    const mono = render(
      scene({ figure: FIGURE_STYLES.sat, chrome: chromeOn() }),
    ).curveStrokes()
    const palette = render(
      scene({ figure: FIGURE_STYLES.textbook, chrome: chromeOn() }),
    ).curveStrokes()
    expect(mono.length, 'the halo is a second stroke of the same path').toBe(1)
    expect(palette.length).toBe(2)
  })

  it('a shaded overlay becomes a light grey wash', () => {
    const ctx = render(scene({ curves: [PARABOLA], overlays: [AREA], figure: FIGURE_STYLES.sat }))
    const washes = ctx.log.filter(
      (e) => e.op === 'fill' && e.style === FIGURE_STYLES.sat.theme.axis,
    )
    // (the arrowheads fill in the same ink; the wash is the one that is pale)
    expect(washes.length, 'the area was never shaded').toBeGreaterThan(0)
    expect(washes.some((w) => w.alpha === MONO_FILL_ALPHA), 'no grey wash').toBe(true)
  })
})

describe('points', () => {
  const analysis = { curve: CUBIC, points: analyzeCurve(CUBIC, MODELS) }

  it('filled markers are one disc of one size, where the screen has four glyphs', () => {
    const ring = render(scene({ analysis, curves: [CUBIC] }))
    const disc = render(scene({ analysis, curves: [CUBIC], figure: FIGURE_STYLES.ap }))
    const radii = (c: LogCtx): number[] =>
      Array.from(
        new Set(
          c.own.cmds.filter((x) => x.op === 'arc').map((x) => (x as { r: number }).r),
        ),
      ).sort((a, b) => a - b)
    expect(radii(ring).length, 'the screen marker set is one glyph per kind')
      .toBeGreaterThan(1)
    expect(radii(disc), 'an exam figure states every point the same way')
      .toEqual([FILLED_POINT_R])
    const inked = disc.log.filter(
      (e) => e.op === 'fill' && e.style === FIGURE_STYLES.ap.theme.axis,
    )
    expect(inked.length, 'the markers were never painted').toBeGreaterThan(0)
  })

  it('a restricted domain gets an end dot at each end, filled because it is closed', () => {
    const open = render(scene({ curves: [PARABOLA], figure: FIGURE_STYLES.sat }))
    const arcs = open.own.cmds.filter((c) => c.op === 'arc')
    // y = 0.5x^2 - 1 at x = -2 and x = 3
    const ends = [
      { x: sx(VP, -2), y: VP.heightPx / 2 - 1 * VP.pxPerUnit },
      { x: sx(VP, 3), y: VP.heightPx / 2 - 3.5 * VP.pxPerUnit },
    ]
    for (const e of ends) {
      expect(
        arcs.some((a) => a.op === 'arc' && Math.hypot(a.x - e.x, a.y - e.y) < 0.001),
        `no end dot at ${e.x},${e.y}`,
      ).toBe(true)
    }
    // the screen board says this with a BRACKET handle instead, which is chrome
    const screen = render(scene({ curves: [PARABOLA] }))
    expect(screen.own.cmds.filter((c) => c.op === 'arc')).toHaveLength(0)
  })
})

describe('caption', () => {
  it('reaches the figure with chrome:null, centred under the plot', () => {
    const ctx = render(scene({ figure: FIGURE_STYLES.ap, caption: 'Graph of f', chrome: null }))
    const cap = ctx.texts.find((t) => t.text === 'Graph of f')
    expect(cap, 'the caption never reached the export').toBeTruthy()
    expect(cap!.x).toBe(VP.widthPx / 2)
    expect(cap!.align).toBe('center')
    expect(cap!.y).toBeGreaterThan(VP.heightPx - 30)
    expect(cap!.y).toBeLessThan(VP.heightPx)
  })

  it('reserves its band: the bottom tick number steps aside instead of vanishing', () => {
    // measured: "Graph of f" is centred on the y axis, and its knockout took
    // the -4 with it. The band is reserved, so the number is never drawn there.
    const vp = { ...VP, center: { x: 0, y: 0.5 } }
    const plain = render(scene({ vp, figure: FIGURE_STYLES.ap }))
    const capped = render(scene({ vp, figure: FIGURE_STYLES.ap, caption: 'Graph of f' }))
    const lows = (c: LogCtx): number =>
      c.texts.filter((t) => t.baseline === 'middle' && t.y > VP.heightPx - 46).length
    expect(lows(plain), 'the fixture must have a number in the band').toBeGreaterThan(0)
    expect(lows(capped)).toBe(0)
    expect(capped.texts.some((t) => t.text === 'Graph of f')).toBe(true)
  })

  it('is drawn on any style, and only when it says something', () => {
    expect(
      render(scene({ caption: 'Figure 3' })).texts.some((t) => t.text === 'Figure 3'),
    ).toBe(true)
    expect(render(scene({ caption: '' })).texts.some((t) => t.text === '')).toBe(false)
  })
})

describe('the rest of the board under a style', () => {
  it('the polar ruling still draws, in the style theme', () => {
    const ctx = render(scene({ grid: 'polar', figure: FIGURE_STYLES.textbook }))
    expect(ctx.fills[0].style, 'the ground is the style ground').toBe(
      FIGURE_STYLES.textbook.theme.bg,
    )
    expect(ctx.strokeCount, 'the polar grid drew nothing').toBeGreaterThan(2)
    expect(ctx.texts.length, 'the polar grid lost its labels').toBeGreaterThan(0)
  })

  it("an unruled style takes the polar rings AND their angle labels with it", () => {
    // measured on the AP preset, whose ruling colour IS the ground: the rings
    // vanished and left "2π/3", "3π/4" floating on blank paper.
    const ruled = render(scene({ grid: 'polar', figure: FIGURE_STYLES.textbook }))
    const bare = render(scene({ grid: 'polar', figure: FIGURE_STYLES.ap }))
    expect(ruled.texts.some((t) => t.text.includes('π/'))).toBe(true)
    expect(bare.texts.some((t) => t.text.includes('π/')), 'an angle named no ray')
      .toBe(false)
    expect(bare.strokeCount, 'the axes are still drawn').toBeGreaterThan(0)
  })

  it('the style theme replaces the scene theme everywhere', () => {
    const dark: FigureStyle = FIGURE_STYLES.ap
    const ctx = render(scene({ theme: DARK_THEME, figure: dark, shapes: [TRIANGLE] }))
    expect(ctx.fills[0].style).toBe('#ffffff')
    expect(ctx.strokeStyles, 'the dark theme leaked past the style').not.toContain(
      DARK_THEME.axis,
    )
  })

  it('a number line takes the style theme and its caption too', () => {
    const nl = render(
      scene({
        kind: 'number-line',
        curves: [],
        items: [{ kind: 'point', id: 'p', x: 2, closed: true, color: CURVE_COLORS[0] }],
        figure: FIGURE_STYLES.textbook,
        caption: 'Solution set',
      }),
    )
    expect(nl.fills[0].style).toBe('#ffffff')
    expect(nl.texts.some((t) => t.text === 'Solution set')).toBe(true)
  })
})

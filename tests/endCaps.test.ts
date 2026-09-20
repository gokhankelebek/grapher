// ============================================================================
// tests/endCaps.test.ts — what the ends of a drawn graph say.
//
// Five claims this file exists to hold:
//
//  1. A board with no figure and no `ends` draws the stream it drew before end
//     caps existed: 'auto' on the screen means NOTHING, and the guard is a
//     whole-command-stream comparison, not a count.
//  2. An exam style marks the ends: an arrow where the graph runs off the
//     board — tip ON the edge, head pointing OUT of it — and a dot where a
//     restricted graph stops.
//  3. The teacher's own choice wins over the style's, per END: a half-open
//     interval is one open dot and one closed one.
//  4. A cap marks an END, never a crossing and never a pole. A graph that dips
//     off the bottom and comes back gets two caps, not six; 1/x gets two, not
//     four, and nothing at the asymptote; a circle gets none.
//  5. Caps are FIGURE: they are drawn with chrome:null, so they export, and
//     they scale with present.stroke.
// ============================================================================

import { describe, it, expect } from 'vitest'
import { renderBoard, type BoardChrome, type BoardScene } from '../src/ui/renderBoard'
import {
  END_ARROW_LEN,
  END_DOT_R,
  curveEndPoints,
  resolveEnds,
} from '../src/render/endCaps'
import { traceCurve } from '../src/render/curves'
import { MockCtx, MockPath2D, withMockPath2D, type Cmd } from './mockCanvas'
import { MODELS } from '../src/core/fit/models'
import { getHandles } from '../src/core/fit/edit'
import {
  CURVE_COLORS,
  DARK_THEME,
  FIGURE_STYLES,
  LIGHT_THEME,
  toPrintColor,
} from '../src/core/types'
import type { FittedCurve, Viewport } from '../src/core/types'

// x in [-7.5, 7.5], y in [-5, 5]
const VP: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 900, heightPx: 600 }
const sx = (x: number): number => VP.widthPx / 2 + x * VP.pxPerUnit
const sy = (y: number): number => VP.heightPx / 2 - y * VP.pxPerUnit

function curve(over: Partial<FittedCurve>): FittedCurve {
  return {
    id: 'c1', modelId: 'poly3', params: [0, -3, 0, 1], kind: 'explicit', domain: null,
    color: CURVE_COLORS[0], strokeWidth: 2.5, visible: true, error: 0.01,
    ...over,
  }
}

/** y = x^3 - 3x, unrestricted: off the bottom at x < -2.279, off the top after 2.279. */
const CUBIC = curve({})
/** y = 0.5x^2 - 1 on [-2, 3]: both ends stop well inside the board. */
const PARABOLA = curve({ modelId: 'poly2', params: [-1, 0, 0.5], domain: [-2, 3] })
/** y = x^4 - 8x^2: leaves the board through the bottom TWICE and comes back. */
const QUARTIC = curve({ modelId: 'poly4', params: [0, 0, -8, 0, 1] })
/** y = 1/x: two branches, a pole at x = 0. */
const RECIP = curve({ modelId: 'recip', params: [1, 0, 0] })
/** x^2 + y^2 = 9. */
const CIRCLE = curve({ modelId: 'circle', params: [0, 0, 3], kind: 'implicit' })
/** y = sin x. */
const SINE = curve({ modelId: 'sine', params: [2, 1, 0, 0] })

// ---------------------------------------------------------------------------
// A MockCtx that keeps each paint op together with the SUBPATH it consumed —
// the commands since the last beginPath(), not since the last paint. An
// arrowhead is stroked in the ground and then filled in the ink from one
// path, and both halves have to be visible to a test.
// ---------------------------------------------------------------------------

interface Arc { x: number; y: number; r: number }
interface Op {
  kind: 'fill' | 'stroke'
  style: string
  lw: number
  alpha: number
  /** True when stroke() was handed a Path2D — i.e. this is a CURVE. */
  path: boolean
  pts: Array<{ x: number; y: number }>
  arcs: Arc[]
}

class CapCtx extends MockCtx {
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

function scene(over: Partial<BoardScene> = {}): BoardScene {
  return {
    vp: VP, theme: DARK_THEME, curves: [CUBIC], styles: {}, models: MODELS,
    analysis: null, chrome: null,
    ...over,
  }
}

function render(s: BoardScene): CapCtx {
  const ctx = new CapCtx()
  withMockPath2D(() => renderBoard(ctx as unknown as CanvasRenderingContext2D, s))
  return ctx
}

/** Everything a mock canvas saw, as one comparable value. */
const snapshot = (c: CapCtx): string =>
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

interface Cap {
  kind: 'arrow' | 'closed' | 'open'
  at: { x: number; y: number }
}

/**
 * Every end cap in a render, read back off the canvas the way a reader sees
 * them: a filled triangle in the ink (its first point is the TIP), a filled
 * disc in the ink, a disc filled in the GROUND.
 */
function caps(ctx: CapCtx, ink: string, bg: string, stroke = 1): Cap[] {
  const r = END_DOT_R * stroke
  const out: Cap[] = []
  for (const op of ctx.ops) {
    if (op.kind !== 'fill') continue
    if (op.style === ink && op.arcs.length === 0 && op.pts.length === 3) {
      out.push({ kind: 'arrow', at: op.pts[0] })
    } else if (op.style === ink && op.arcs.length === 1 && Math.abs(op.arcs[0].r - r) < 1e-9) {
      out.push({ kind: 'closed', at: { x: op.arcs[0].x, y: op.arcs[0].y } })
    } else if (op.style === bg && op.arcs.length === 1 && Math.abs(op.arcs[0].r - r) < 1e-9) {
      out.push({ kind: 'open', at: { x: op.arcs[0].x, y: op.arcs[0].y } })
    }
  }
  return out
}

const SAT_INK = FIGURE_STYLES.sat.theme.axis
const SAT_BG = FIGURE_STYLES.sat.theme.bg
const satCaps = (ctx: CapCtx, stroke = 1): Cap[] => caps(ctx, SAT_INK, SAT_BG, stroke)

const chromeOn = (c: FittedCurve): BoardChrome => ({
  selectedId: c.id,
  handles: getHandles(c, MODELS),
  activeHandleId: null, highlight: null, openIdx: null, hoverIdx: null,
})

/** The outward unit normal of the board edge a point sits on. */
function outwardAt(p: { x: number; y: number }): { x: number; y: number } {
  if (Math.abs(p.y) < 1) return { x: 0, y: -1 }
  if (Math.abs(p.y - VP.heightPx) < 1) return { x: 0, y: 1 }
  if (Math.abs(p.x) < 1) return { x: -1, y: 0 }
  if (Math.abs(p.x - VP.widthPx) < 1) return { x: 1, y: 0 }
  throw new Error(`(${p.x}, ${p.y}) is not on the board edge`)
}

// ===========================================================================
// 1. The regression guard
// ===========================================================================

describe('end caps — the board without them is the board it always was', () => {
  const VARIANTS: Array<Partial<BoardScene>> = [
    {},
    { curves: [PARABOLA] },
    { curves: [RECIP] },
    { curves: [CIRCLE] },
    { curves: [CUBIC, PARABOLA] },
    { theme: LIGHT_THEME },
    { present: { type: 2, stroke: 2 } },
    { chrome: chromeOn(CUBIC) },
  ]

  it('an absent `ends` with no figure draws the identical command stream', () => {
    for (const over of VARIANTS) {
      const bare = render(scene(over))
      const said = render(
        scene({ ...over, styles: { c1: { ends: { start: 'auto', end: 'auto' } } } }),
      )
      expect(snapshot(said), JSON.stringify(Object.keys(over))).toBe(snapshot(bare))
      // and an empty `ends` object is the same statement again
      expect(snapshot(render(scene({ ...over, styles: { c1: { ends: {} } } })))).toBe(
        snapshot(bare),
      )
      expect(caps(bare, CURVE_COLORS[0], DARK_THEME.bg)).toHaveLength(0)
    }
  })

  it("the screen figure says nothing either — 'plain' is the screen's answer", () => {
    for (const c of [CUBIC, PARABOLA, RECIP]) {
      const ctx = render(scene({ curves: [c], figure: FIGURE_STYLES.screen }))
      expect(caps(ctx, CURVE_COLORS[0], DARK_THEME.bg), c.modelId).toHaveLength(0)
      expect(caps(ctx, DARK_THEME.axis, DARK_THEME.bg), c.modelId).toHaveLength(0)
    }
  })

  it('the guard is not vacuous: an exam style DOES change the stream', () => {
    const bare = render(scene())
    expect(snapshot(render(scene({ figure: FIGURE_STYLES.sat })))).not.toBe(snapshot(bare))
  })
})

// ===========================================================================
// 2. resolveEnds — which cap each end asks for
// ===========================================================================

describe('resolveEnds', () => {
  it("'auto' with no figure is 'none'", () => {
    expect(resolveEnds(undefined, CUBIC, null)).toMatchObject({ start: 'none', end: 'none' })
    expect(resolveEnds({ ends: { start: 'auto' } }, PARABOLA, null))
      .toMatchObject({ start: 'none', end: 'none' })
    expect(resolveEnds(undefined, CUBIC, FIGURE_STYLES.screen))
      .toMatchObject({ start: 'none', end: 'none' })
  })

  it("'auto' under a marked figure is an arrow off the board, a closed dot at a domain end", () => {
    for (const id of ['textbook', 'sat', 'ap'] as const) {
      const fig = FIGURE_STYLES[id]
      expect(resolveEnds(undefined, CUBIC, fig), id)
        .toMatchObject({ start: 'arrow', end: 'arrow', startAuto: true, endAuto: true })
      expect(resolveEnds(undefined, PARABOLA, fig), id)
        .toMatchObject({ start: 'closed', end: 'closed' })
    }
  })

  it('what the teacher NAMED wins, per end, under any figure', () => {
    const asked = { ends: { start: 'open' as const, end: 'arrow' as const } }
    for (const fig of [null, FIGURE_STYLES.screen, FIGURE_STYLES.sat]) {
      expect(resolveEnds(asked, PARABOLA, fig)).toEqual({
        start: 'open', end: 'arrow', startAuto: false, endAuto: false,
      })
    }
    // 'none' named on one end is a real answer, not "fall back to the style"
    expect(resolveEnds({ ends: { start: 'none' } }, PARABOLA, FIGURE_STYLES.sat))
      .toMatchObject({ start: 'none', end: 'closed' })
  })

  it('an implicit curve has no ends to mark, whatever is asked for', () => {
    expect(resolveEnds({ ends: { start: 'arrow', end: 'closed' } }, CIRCLE, FIGURE_STYLES.sat))
      .toMatchObject({ start: 'none', end: 'none' })
  })
})

// ===========================================================================
// 3. Arrows: where the graph runs off the board
// ===========================================================================

describe('arrows', () => {
  it('a cubic that runs off both sides gets two, tips ON the edge, heads pointing out', () => {
    const ends = curveEndPoints(CUBIC, MODELS, VP)
    expect(ends.start, 'no lower-x end').toBeTruthy()
    expect(ends.end, 'no upper-x end').toBeTruthy()
    expect(ends.start!.kind).toBe('exit')
    expect(ends.end!.kind).toBe('exit')

    // y = x^3 - 3x leaves through the BOTTOM at x ~ -2.279 and the TOP at 2.279
    expect(Math.abs(ends.start!.at.y - VP.heightPx)).toBeLessThan(1)
    expect(Math.abs(ends.start!.at.x - sx(-2.2790))).toBeLessThan(1)
    expect(Math.abs(ends.end!.at.y - 0)).toBeLessThan(1)
    expect(Math.abs(ends.end!.at.x - sx(2.2790))).toBeLessThan(1)

    for (const e of [ends.start!, ends.end!]) {
      const n = outwardAt(e.at)
      expect(e.dir.x * n.x + e.dir.y * n.y, 'the head points back onto the board')
        .toBeGreaterThan(0)
      expect(Math.hypot(e.dir.x, e.dir.y)).toBeCloseTo(1, 9)
    }

    const drawn = satCaps(render(scene({ curves: [CUBIC], figure: FIGURE_STYLES.sat })))
    expect(drawn.map((c) => c.kind)).toEqual(['arrow', 'arrow'])
    // the drawn TIP is the point curveEndPoints named, to the pixel
    expect(drawn[0].at.x).toBeCloseTo(ends.start!.at.x, 9)
    expect(drawn[0].at.y).toBeCloseTo(ends.start!.at.y, 9)
    expect(drawn[1].at.x).toBeCloseTo(ends.end!.at.x, 9)
    expect(drawn[1].at.y).toBeCloseTo(ends.end!.at.y, 9)
  })

  it('a sine runs off the left and right edges, and the heads follow the slope', () => {
    const ends = curveEndPoints(SINE, MODELS, VP)
    expect(Math.abs(ends.start!.at.x - 0)).toBeLessThan(1)
    expect(Math.abs(ends.end!.at.x - VP.widthPx)).toBeLessThan(1)
    expect(ends.start!.dir.x).toBeLessThan(0)
    expect(ends.end!.dir.x).toBeGreaterThan(0)
  })

  it('the head is 11px x present.stroke long, in the curve ink, over a ground knockout', () => {
    for (const stroke of [1, 2]) {
      const ctx = render(
        scene({ curves: [CUBIC], figure: FIGURE_STYLES.sat, present: { type: 1, stroke } }),
      )
      const heads = ctx.ops.filter(
        (o) => o.kind === 'fill' && o.style === SAT_INK && o.arcs.length === 0 && o.pts.length === 3,
      )
      expect(heads, `stroke=${stroke}`).toHaveLength(2)
      for (const h of heads) {
        const tip = h.pts[0]
        const back = Math.max(
          Math.hypot(h.pts[1].x - tip.x, h.pts[1].y - tip.y),
          Math.hypot(h.pts[2].x - tip.x, h.pts[2].y - tip.y),
        )
        expect(back, 'the head does not scale with present.stroke')
          .toBeCloseTo(END_ARROW_LEN * stroke, 6)
      }
      // each head is stroked in the GROUND first, so the curve cannot poke
      // through the tip
      const knockouts = ctx.ops.filter(
        (o) => o.kind === 'stroke' && o.style === SAT_BG && o.pts.length === 3,
      )
      expect(knockouts, `stroke=${stroke}`).toHaveLength(2)
    }
  })

  it('an arrow asked for at a DOMAIN end sits on the domain end, not on an edge', () => {
    const ctx = render(
      scene({
        curves: [PARABOLA],
        figure: FIGURE_STYLES.sat,
        styles: { c1: { ends: { start: 'arrow', end: 'arrow' } } },
      }),
    )
    const drawn = satCaps(ctx)
    expect(drawn.map((c) => c.kind)).toEqual(['arrow', 'arrow'])
    expect(drawn[0].at.x).toBeCloseTo(sx(-2), 6)
    expect(drawn[0].at.y).toBeCloseTo(sy(1), 6) // 0.5*4 - 1
    expect(drawn[1].at.x).toBeCloseTo(sx(3), 6)
    expect(drawn[1].at.y).toBeCloseTo(sy(3.5), 6)
  })
})

// ===========================================================================
// 4. Dots: where a restricted graph stops
// ===========================================================================

describe('dots', () => {
  const at = [
    { x: sx(-2), y: sy(1) },
    { x: sx(3), y: sy(3.5) },
  ]

  it('a restricted parabola closes both ends by default under an exam style', () => {
    for (const id of ['textbook', 'sat', 'ap'] as const) {
      const fig = FIGURE_STYLES[id]
      const ctx = render(scene({ curves: [PARABOLA], figure: fig }))
      const ink = fig.curveInk === 'mono' ? fig.theme.axis : toPrintColor(PARABOLA.color)
      const drawn = caps(ctx, ink, fig.theme.bg)
      expect(drawn.map((c) => c.kind), id).toEqual(['closed', 'closed'])
      drawn.forEach((c, i) => {
        expect(c.at.x, id).toBeCloseTo(at[i].x, 6)
        expect(c.at.y, id).toBeCloseTo(at[i].y, 6)
      })
    }
  })

  it('open when asked, and one of each for a half-open interval', () => {
    const open = satCaps(
      render(scene({
        curves: [PARABOLA], figure: FIGURE_STYLES.sat,
        styles: { c1: { ends: { start: 'open', end: 'open' } } },
      })),
    )
    expect(open.map((c) => c.kind)).toEqual(['open', 'open'])

    const half = satCaps(
      render(scene({
        curves: [PARABOLA], figure: FIGURE_STYLES.sat,
        styles: { c1: { ends: { start: 'open', end: 'closed' } } },
      })),
    )
    expect(half.map((c) => c.kind)).toEqual(['open', 'closed'])
    // "start" is the LOWER-x end: the open one is at x = -2
    expect(half[0].at.x).toBeCloseTo(sx(-2), 6)
    expect(half[1].at.x).toBeCloseTo(sx(3), 6)
  })

  it('a named cap draws with no figure at all — the teacher asked for it', () => {
    const drawn = caps(
      render(scene({
        curves: [PARABOLA],
        styles: { c1: { ends: { start: 'closed', end: 'open' } } },
      })),
      CURVE_COLORS[0], DARK_THEME.bg,
    )
    expect(drawn.map((c) => c.kind)).toEqual(['closed', 'open'])
  })

  it('a domain end BEYOND the board is a run-off, so `auto` arrows it instead', () => {
    // y = x^3 - 3x on [-4, 4]: both domain ends are far off the board
    const wide = curve({ domain: [-4, 4] })
    expect(resolveEnds(undefined, wide, FIGURE_STYLES.sat))
      .toMatchObject({ start: 'closed', startAuto: true })
    const ends = curveEndPoints(wide, MODELS, VP)
    expect(ends.start!.kind).toBe('exit')
    expect(ends.end!.kind).toBe('exit')
    const drawn = satCaps(render(scene({ curves: [wide], figure: FIGURE_STYLES.sat })))
    expect(drawn.map((c) => c.kind), 'a dot was drawn off the paper').toEqual(['arrow', 'arrow'])
  })

  it('the dot radius is 3.5 x present.stroke', () => {
    const ctx = render(
      scene({ curves: [PARABOLA], figure: FIGURE_STYLES.sat, present: { type: 1, stroke: 2 } }),
    )
    expect(satCaps(ctx, 2).map((c) => c.kind)).toEqual(['closed', 'closed'])
    expect(satCaps(ctx, 1), 'the dot did not scale').toHaveLength(0)
  })
})

// ===========================================================================
// 5. A cap marks an END, never a crossing and never a pole
// ===========================================================================

describe('what is not an end', () => {
  it('a graph that leaves and comes back is marked at its OUTERMOST exits only', () => {
    // The fixture has to actually come back, or this test proves nothing:
    // y = x^4 - 8x^2 enters at x = -2.930, dives off the bottom at -2.705,
    // comes back at -0.827, leaves again at 0.827, returns at 2.705, exits at
    // 2.930 — six crossings, of which exactly two are ENDS.
    const run = traceCurve(QUARTIC, MODELS, VP)!.runs[0]
    let crossings = 0
    const on = (p: { x: number; y: number }): boolean =>
      p.x >= 0 && p.x <= VP.widthPx && p.y >= 0 && p.y <= VP.heightPx
    for (let i = 1; i < run.length; i++) if (on(run[i]) !== on(run[i - 1])) crossings++
    expect(crossings, 'the fixture never leaves and comes back').toBe(6)

    const ends = curveEndPoints(QUARTIC, MODELS, VP)
    expect(ends.start!.kind).toBe('exit')
    expect(ends.end!.kind).toBe('exit')
    // the outermost crossings are at x = +-2.930, on the TOP edge
    expect(Math.abs(ends.start!.at.x - sx(-2.9297))).toBeLessThan(1)
    expect(Math.abs(ends.end!.at.x - sx(2.9297))).toBeLessThan(1)
    expect(ends.start!.at.y).toBeLessThan(1)
    expect(ends.end!.at.y).toBeLessThan(1)

    const drawn = satCaps(render(scene({ curves: [QUARTIC], figure: FIGURE_STYLES.sat })))
    expect(drawn, 'every crossing was marked, not just the two ends').toHaveLength(2)
  })

  it('1/x gets two caps at the outer edges and NOTHING at the asymptote', () => {
    const ends = curveEndPoints(RECIP, MODELS, VP)
    // the left branch enters at the left edge, the right one leaves at the right
    expect(Math.abs(ends.start!.at.x - 0)).toBeLessThan(1)
    expect(Math.abs(ends.end!.at.x - VP.widthPx)).toBeLessThan(1)
    expect(ends.start!.dir.x).toBeLessThan(0)
    expect(ends.end!.dir.x).toBeGreaterThan(0)

    const drawn = satCaps(render(scene({ curves: [RECIP], figure: FIGURE_STYLES.sat })))
    expect(drawn, 'the pole was capped').toHaveLength(2)
    for (const c of drawn) {
      expect(Math.abs(c.at.x - sx(0)), 'a cap was drawn at the asymptote')
        .toBeGreaterThan(VP.widthPx / 4)
    }
  })

  it('a restricted 1/x closes its two domain ends and still says nothing at the pole', () => {
    // Both domain ends are on the board, so both close. The break at x = 0 is
    // in the MIDDLE of the graph, and the middle of a graph has no ends.
    const inner = curve({ modelId: 'recip', params: [1, 0, 0], domain: [-6, 6] })
    const ends = curveEndPoints(inner, MODELS, VP)
    expect(ends.start!.kind).toBe('domain')
    expect(ends.start!.at.x).toBeCloseTo(sx(-6), 6)
    expect(ends.end!.kind).toBe('domain')
    expect(ends.end!.at.x).toBeCloseTo(sx(6), 6)
    const drawn = satCaps(render(scene({ curves: [inner], figure: FIGURE_STYLES.sat })))
    expect(drawn.map((c) => c.kind)).toEqual(['closed', 'closed'])
  })

  it('an implicit circle has no ends at all', () => {
    expect(curveEndPoints(CIRCLE, MODELS, VP)).toEqual({ start: null, end: null })
    for (const id of ['sat', 'ap', 'textbook'] as const) {
      const fig = FIGURE_STYLES[id]
      const ctx = render(scene({ curves: [CIRCLE], figure: fig }))
      expect(caps(ctx, fig.theme.axis, fig.theme.bg), id).toHaveLength(0)
      expect(caps(ctx, toPrintColor(CIRCLE.color), fig.theme.bg), id).toHaveLength(0)
    }
  })

  it('a NATURAL domain edge is not a declared domain, and is not capped', () => {
    // y = sqrt(x) stops at (0, 0) and a textbook would close it — but "where
    // the formula stops being defined" is not in FittedCurve.domain, and from
    // the samples alone it is indistinguishable from the pole this file exists
    // to leave alone. It is pinned here so the gap is a decision, not a
    // surprise: the fix is to give the curve the domain it actually has.
    const root = curve({ modelId: 'sqrt', params: [1, 0, 0] })
    const ends = curveEndPoints(root, MODELS, VP)
    expect(ends.start, 'the branch point is not treated as an end').toBeNull()
    expect(ends.end!.kind, 'the far end still runs off the board').toBe('exit')

    const said = curve({ modelId: 'sqrt', params: [1, 0, 0], domain: [0, 7] })
    const drawn = satCaps(render(scene({ curves: [said], figure: FIGURE_STYLES.sat })))
    expect(drawn.map((c) => c.kind), 'a stated domain does get its dots')
      .toEqual(['closed', 'closed'])
    expect(drawn[0].at.x).toBeCloseTo(sx(0), 6)
    expect(drawn[0].at.y).toBeCloseTo(sy(0), 6)
  })

  it('a curve with nothing on the board is capped nowhere', () => {
    const far = curve({ modelId: 'line', params: [900, 0], kind: 'explicit' })
    expect(curveEndPoints(far, MODELS, VP)).toEqual({ start: null, end: null })
  })
})

// ===========================================================================
// 6. Caps are FIGURE, in the figure's own ink
// ===========================================================================

describe('caps are figure, not chrome', () => {
  it('they reach the export (chrome:null) and are identical with chrome on', () => {
    for (const c of [CUBIC, PARABOLA]) {
      const exported = render(scene({ curves: [c], figure: FIGURE_STYLES.sat, chrome: null }))
      const onScreen = render(
        scene({ curves: [c], figure: FIGURE_STYLES.sat, chrome: chromeOn(c) }),
      )
      expect(satCaps(exported), c.modelId).toHaveLength(2)
      expect(satCaps(onScreen)).toEqual(satCaps(exported))
    }
  })

  it('under mono ink a cap is theme.axis, like the curve it ends', () => {
    const ctx = render(scene({ curves: [PARABOLA], figure: FIGURE_STYLES.ap }))
    expect(caps(ctx, FIGURE_STYLES.ap.theme.axis, FIGURE_STYLES.ap.theme.bg)).toHaveLength(2)
    expect(caps(ctx, toPrintColor(PARABOLA.color), FIGURE_STYLES.ap.theme.bg)).toHaveLength(0)
  })

  it("under a palette figure a cap is the curve's own print colour", () => {
    const fig = FIGURE_STYLES.textbook
    const ctx = render(scene({ curves: [PARABOLA], figure: fig }))
    expect(caps(ctx, toPrintColor(PARABOLA.color), fig.theme.bg)).toHaveLength(2)
    expect(caps(ctx, fig.theme.axis, fig.theme.bg)).toHaveLength(0)
  })

  it('only the curve that asked for a cap gets one', () => {
    const other = { ...PARABOLA, id: 'c2' }
    const ctx = render(
      scene({
        curves: [CUBIC, other],
        styles: { c2: { ends: { start: 'closed', end: 'closed' } } },
      }),
    )
    expect(caps(ctx, CURVE_COLORS[0], DARK_THEME.bg).map((c) => c.kind))
      .toEqual(['closed', 'closed'])
  })
})

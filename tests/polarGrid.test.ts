// ============================================================================
// tests/polarGrid.test.ts — the polar ruling.
//
// Same method as tests/render.test.ts: drawPolarGrid is driven against the
// recording spy context (tests/mockCanvas.ts) and the GEOMETRY it emits is
// asserted — circle radii, spoke directions, label text and label quadrant.
//
// The load-bearing test is the last one: a scene that does not mention
// `grid`, and a scene that says 'cartesian' out loud, must produce the same
// command stream, byte for byte. Everything the app already draws depends on
// that and nothing else in this file would catch it.
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { Vec2, Viewport } from '../src/core/types'
import { DARK_THEME } from '../src/core/types'
import type { AxisUnits } from '../src/render/grid'
import { pickPiTickStep, pickTickStep } from '../src/render/grid'
import { drawPolarGrid, polarGeometry } from '../src/render/polarGrid'
import { renderBoard, type BoardScene } from '../src/ui/renderBoard'
import { MockCtx, withMockPath2D } from './mockCanvas'
import { MODELS } from '../src/core/fit/models'

type Ctx2D = Parameters<typeof drawPolarGrid>[0]

function vpAt(pxPerUnit: number, center: Vec2 = { x: 0, y: 0 }): Viewport {
  return { center, pxPerUnit, widthPx: 1200, heightPx: 800 }
}

function run(vp: Viewport, units?: AxisUnits | null, type = 1): MockCtx {
  const ctx = new MockCtx()
  drawPolarGrid(ctx as unknown as Ctx2D, vp, DARK_THEME, { type, stroke: 1 }, units ?? null)
  return ctx
}

/** Radii of every arc the grid emitted, in MATH units, ascending. */
function circleRadii(ctx: MockCtx, vp: Viewport): number[] {
  return ctx.own.cmds
    .filter((c): c is { op: 'arc'; x: number; y: number; r: number } => c.op === 'arc')
    .map((c) => c.r / vp.pxPerUnit)
    .sort((a, b) => a - b)
}

/**
 * The spokes: every straight two-point subpath. Circles contribute a one-point
 * subpath (the moveTo that seats the arc) and the axis arrowheads three, so the
 * length-2 subpaths are exactly the radial rules.
 */
function spokes(ctx: MockCtx): Array<Array<{ x: number; y: number }>> {
  return ctx.own.subpaths().filter((sp) => sp.length === 2)
}

/** Direction of each spoke as a math-space angle in [0, 2π). */
function spokeAngles(ctx: MockCtx): number[] {
  const TWO_PI = Math.PI * 2
  return spokes(ctx)
    .map((sp) => {
      const a = Math.atan2(-(sp[1].y - sp[0].y), sp[1].x - sp[0].x)
      return ((a % TWO_PI) + TWO_PI) % TWO_PI
    })
    .sort((a, b) => a - b)
}

const isAngleText = (s: string): boolean => s.includes('π')
const angleLabels = (ctx: MockCtx): string[] =>
  ctx.texts.filter((t) => isAngleText(t.text)).map((t) => t.text)

// ---------------------------------------------------------------------------
// Circles
// ---------------------------------------------------------------------------

describe('drawPolarGrid — circles', () => {
  it('puts the circles on the cartesian tick ladder, minors and majors', () => {
    for (const ppu of [12, 25, 37, 60, 90, 140, 350]) {
      const vp = vpAt(ppu)
      const step = pickTickStep(ppu)
      const minor = step.major / step.minorDiv
      const radii = circleRadii(run(vp), vp)
      expect(radii.length, `ppu=${ppu} drew no circles`).toBeGreaterThan(0)
      for (const r of radii) {
        const k = r / minor
        expect(
          Math.abs(k - Math.round(k)) < 1e-6,
          `ppu=${ppu}: radius ${r} is not a rung of the ${minor} ladder`,
        ).toBe(true)
        expect(r, `ppu=${ppu}`).toBeGreaterThan(0)
      }
      // every major rung inside the view is present
      const majors = radii.filter((r) => Math.abs(r / step.major - Math.round(r / step.major)) < 1e-6)
      expect(majors.length, `ppu=${ppu} drew no major circles`).toBeGreaterThan(0)
    }
  })

  it('a default board draws the ladder it would have drawn square', () => {
    const vp = vpAt(60)
    const radii = circleRadii(run(vp), vp)
    // pickTickStep(60) = major 2, minorDiv 4 -> every 0.5 out to the far corner
    const rMax = Math.hypot(600, 400) / 60
    const want: number[] = []
    for (let k = 1; k * 0.5 <= rMax + 1e-9; k++) want.push(k * 0.5)
    expect(radii.map((r) => Number(r.toFixed(6)))).toEqual(want.map((r) => Number(r.toFixed(6))))
  })

  it('an off-screen pole draws only the arcs that reach the board', () => {
    // pole far to the LEFT: nothing within 480 units of it is on screen
    const vp = vpAt(60, { x: 500, y: 0 })
    const geo = polarGeometry(vp)
    expect(geo.inside).toBe(false)
    const radii = circleRadii(run(vp), vp)
    expect(radii.length).toBeGreaterThan(0)
    const lo = geo.rMinPx / 60
    const hi = geo.rMaxPx / 60
    for (const r of radii) {
      expect(r, 'arc closer than the nearest visible point').toBeGreaterThanOrEqual(lo - 1e-6)
      expect(r, 'arc beyond the farthest visible point').toBeLessThanOrEqual(hi + 1e-6)
    }
    // and no circle is centred anywhere but the pole
    for (const c of run(vp).own.cmds) {
      if (c.op === 'arc') {
        expect(c.x).toBeCloseTo(geo.ox, 6)
        expect(c.y).toBeCloseTo(geo.oy, 6)
      }
    }
  })

  it('never draws more than the circle budget, however the board is panned', () => {
    for (const ppu of [8, 25, 60, 140, 600]) {
      for (const cx of [0, 3, 40, 300, 5000]) {
        for (const cy of [0, -2, -200, 3000]) {
          const vp = vpAt(ppu, { x: cx, y: cy })
          const n = circleRadii(run(vp), vp).length
          expect(n, `ppu=${ppu} centre=(${cx},${cy}) drew ${n} circles`).toBeLessThanOrEqual(60)
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Spokes
// ---------------------------------------------------------------------------

describe('drawPolarGrid — spokes', () => {
  it('draws 24 spokes, every π/12, at the default zoom', () => {
    const vp = vpAt(60)
    const angles = spokeAngles(run(vp))
    expect(angles.length).toBe(24)
    for (let k = 0; k < 24; k++) {
      expect(angles[k], `spoke ${k}`).toBeCloseTo((k * Math.PI) / 12, 6)
    }
  })

  it('the spoke set does not change with zoom — the ladder already handles that', () => {
    for (const ppu of [4, 25, 60, 240, 2000]) {
      expect(spokeAngles(run(vpAt(ppu))).length, `ppu=${ppu}`).toBe(24)
    }
  })

  it('adds the π/24 rung on a board big enough to fan them apart', () => {
    // 1920x1080: the inscribed circle is 540px, so adjacent π/12 spokes are
    // 141px apart out there — past the 120px subdivision rule.
    const big: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 1920, heightPx: 1080 }
    const angles = spokeAngles(run(big))
    expect(angles.length).toBe(48)
    for (let k = 0; k < 48; k++) expect(angles[k]).toBeCloseTo((k * Math.PI) / 24, 6)
  })

  it('keeps the pole clear: only the axes reach it', () => {
    const vp = vpAt(60)
    const geo = polarGeometry(vp)
    for (const sp of spokes(run(vp))) {
      const d = Math.hypot(sp[0].x - geo.ox, sp[0].y - geo.oy)
      const ang = Math.atan2(-(sp[1].y - sp[0].y), sp[1].x - sp[0].x)
      const onAxis =
        Math.abs(Math.cos(ang)) < 1e-6 || Math.abs(Math.sin(ang)) < 1e-6
      if (onAxis) expect(d, 'an axis must cross the pole').toBeLessThan(1e-6)
      else expect(d, 'a spoke must start clear of the pole').toBeGreaterThan(8)
    }
  })

  it('culls the spokes that point away from a board the pole has left', () => {
    const vp = vpAt(60, { x: 500, y: 0 })
    const drawn = spokes(run(vp))
    expect(drawn.length).toBeGreaterThan(0)
    expect(drawn.length).toBeLessThan(24)
    for (const sp of drawn) {
      for (const p of sp) {
        expect(p.x).toBeGreaterThanOrEqual(-1e-6)
        expect(p.x).toBeLessThanOrEqual(1200 + 1e-6)
        expect(p.y).toBeGreaterThanOrEqual(-1e-6)
        expect(p.y).toBeLessThanOrEqual(800 + 1e-6)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

describe('drawPolarGrid — labels', () => {
  it('labels the angles the way a teacher writes them', () => {
    const labels = angleLabels(run(vpAt(60)))
    for (const want of ['π/6', 'π/4', 'π/3', 'π/2', '3π/4', '5π/6', 'π', '5π/4', '11π/6']) {
      expect(labels, `missing ${want}`).toContain(want)
    }
    // θ = 0 is left to the radius numbers; nothing prints "0π" or "2π" twice
    for (const s of labels) {
      expect(s).not.toMatch(/(^|[^\d])1π/)
      expect(s).not.toMatch(/NaN|Infinity|undefined/)
    }
    expect(new Set(labels).size, 'an angle labelled twice').toBe(labels.length)
  })

  it('puts each angle label in its own quadrant', () => {
    const ctx = run(vpAt(60))
    const geo = polarGeometry(vpAt(60))
    const at = (s: string) => ctx.texts.find((t) => t.text === s)
    const cases: Array<[string, number, number]> = [
      ['π/4', +1, -1],   // up and right  (screen y grows down)
      ['3π/4', -1, -1],
      ['5π/4', -1, +1],
      ['7π/4', +1, +1],
    ]
    for (const [text, sx, sy] of cases) {
      const t = at(text)
      expect(t, `no ${text} label`).toBeTruthy()
      if (!t) continue
      expect(Math.sign(t.x - geo.ox), `${text} horizontal side`).toBe(sx)
      expect(Math.sign(t.y - geo.oy), `${text} vertical side`).toBe(sy)
    }
  })

  it('keeps every label BOX on the board, not just its anchor', () => {
    // A 'bottom' baseline puts the glyphs a whole line above the anchor, which
    // is how a label ends up half off the top edge. The bound is the box.
    const fpx = 11
    for (const ppu of [25, 60, 240]) {
      for (const c of [{ x: 0, y: 0 }, { x: 2, y: -1 }, { x: 9, y: 4 }, { x: 40, y: -40 }]) {
        const ctx = run(vpAt(ppu, c))
        for (const t of ctx.texts) {
          const w = t.text.length * 6 // MockCtx.measureText
          const x0 = t.align === 'left' ? t.x : t.align === 'right' ? t.x - w : t.x - w / 2
          const y0 =
            t.baseline === 'top' ? t.y : t.baseline === 'bottom' ? t.y - fpx : t.y - fpx / 2
          expect(x0, `${t.text} runs off the left edge`).toBeGreaterThanOrEqual(0)
          expect(x0 + w, `${t.text} runs off the right edge`).toBeLessThanOrEqual(1200)
          expect(y0, `${t.text} runs off the top edge`).toBeGreaterThanOrEqual(0)
          expect(y0 + fpx, `${t.text} runs off the bottom edge`).toBeLessThanOrEqual(800)
        }
      }
    }
  })

  it('thins the angle ring rather than letting it overlap itself', () => {
    // A letterboxed board: the outermost fully visible circle is 45px, so the
    // full π/12 ring would stack "5π/6" on "3π/4". Only the quarter turns fit.
    const letterbox: Viewport = {
      center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 1200, heightPx: 90,
    }
    expect(angleLabels(run(letterbox)).sort()).toEqual(['3π/2', 'π', 'π/2'].sort())
    // a board with room keeps the whole ring
    expect(angleLabels(run(vpAt(60))).length).toBe(15)
  })

  it('numbers the radii along θ = 0, in the cartesian format', () => {
    const vp = vpAt(60)
    const ctx = run(vp)
    const geo = polarGeometry(vp)
    // radius numbers are the centre/top run sitting on the pole's own row
    const radii = ctx.texts.filter(
      (t) => t.align === 'center' && t.baseline === 'top' && !isAngleText(t.text),
    )
    // r = 10 lands exactly on the right edge, where the arrowhead lives — the
    // same edge rule the cartesian x ticks use drops it.
    expect(radii.map((t) => t.text)).toEqual(['2', '4', '6', '8'])
    for (const t of radii) {
      expect(t.x, 'a radius number left of the pole').toBeGreaterThan(geo.ox)
      expect(Math.abs(t.y - (geo.oy + 5)), 'radius numbers ride the θ=0 ray').toBeLessThan(1)
    }
    // the pole itself is still a plain 0, exactly as the square grid prints it
    const origin = ctx.texts.filter(
      (t) => t.align === 'right' && t.baseline === 'top' && !isAngleText(t.text),
    )
    expect(origin.map((t) => t.text)).toEqual(['0'])
  })

  it('numbers the radii in π when the board is measured in π', () => {
    const vp = vpAt(60)
    const ctx = run(vp, { x: 'pi' })
    const step = pickPiTickStep(60, 80)
    const radii = ctx.texts.filter((t) => t.align === 'center' && t.baseline === 'top')
    expect(radii.length).toBeGreaterThan(0)
    for (const t of radii) expect(t.text, 'a π board with a decimal radius').toMatch(/π/)
    expect(radii[0].text).toBe('π/2')
    // and the circles themselves moved to the π ladder
    const r0 = circleRadii(ctx, vp)[0]
    expect(r0).toBeCloseTo(step.major / step.minorDiv, 9)
  })

  it('scales the type with present, like every other label on the board', () => {
    const one = run(vpAt(60), null, 1)
    const big = run(vpAt(60), null, 3)
    expect(one.font).toContain('11px')
    expect(big.font).toContain('33px')
  })
})

// ---------------------------------------------------------------------------
// Degenerate inputs
// ---------------------------------------------------------------------------

describe('drawPolarGrid — degenerate viewports', () => {
  it('paints the ground and gives up, the way drawGrid does', () => {
    for (const vp of [
      vpAt(0),
      vpAt(-1),
      { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 0, heightPx: 800 },
      { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 1200, heightPx: 0 },
    ] as Viewport[]) {
      const ctx = new MockCtx()
      expect(() =>
        drawPolarGrid(ctx as unknown as Ctx2D, vp, DARK_THEME),
      ).not.toThrow()
      expect(ctx.own.cmds).toEqual([])
    }
  })

  it('survives a pole 10^9 px away', () => {
    const vp = vpAt(60, { x: 2e7, y: -1e7 })
    const ctx = run(vp)
    for (const c of ctx.own.cmds) {
      if (c.op === 'moveTo' || c.op === 'lineTo' || c.op === 'arc') {
        expect(Number.isFinite(c.x) && Number.isFinite(c.y)).toBe(true)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// The scene field — and the regression it has to not cause
// ---------------------------------------------------------------------------

const VP_SCENE: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 900, heightPx: 700 }

function boardScene(over: Partial<BoardScene> = {}): BoardScene {
  return {
    vp: VP_SCENE,
    theme: DARK_THEME,
    curves: [],
    styles: {},
    models: MODELS,
    chrome: null,
    ...over,
  }
}

function renderScene(s: BoardScene): MockCtx {
  const ctx = new MockCtx()
  withMockPath2D(() => renderBoard(ctx as unknown as CanvasRenderingContext2D, s))
  return ctx
}

function sameStream(a: MockCtx, b: MockCtx, why: string): void {
  expect(a.own.cmds, why).toEqual(b.own.cmds)
  expect(a.texts, why).toEqual(b.texts)
  expect(a.fills, why).toEqual(b.fills)
  expect(a.strokeStyles, why).toEqual(b.strokeStyles)
  expect(a.fillStyles, why).toEqual(b.fillStyles)
  expect(a.strokeCount, why).toBe(b.strokeCount)
  expect(a.fillCount, why).toBe(b.fillCount)
}

describe('BoardScene.grid', () => {
  it("absent and 'cartesian' are the same picture, byte for byte", () => {
    for (const center of [{ x: 0, y: 0 }, { x: 1.3, y: -0.7 }, { x: 40, y: 40 }]) {
      for (const ppu of [7, 60, 350]) {
        const vp = { ...VP_SCENE, center, pxPerUnit: ppu }
        for (const units of [undefined, { x: 'pi' as const }]) {
          const absent = renderScene(boardScene({ vp, axisUnits: units }))
          const said = renderScene(boardScene({ vp, axisUnits: units, grid: 'cartesian' }))
          sameStream(said, absent, `ppu=${ppu} centre=${JSON.stringify(center)}`)
        }
      }
    }
  })

  it("'polar' is a different ruling, and it is the polar one", () => {
    const square = renderScene(boardScene())
    const polar = renderScene(boardScene({ grid: 'polar' }))
    // the square grid draws no arcs at all; the polar one is made of them
    expect(square.own.cmds.some((c) => c.op === 'arc')).toBe(false)
    expect(polar.own.cmds.filter((c) => c.op === 'arc').length).toBeGreaterThan(4)
    expect(polar.texts.some((t) => t.text.includes('π'))).toBe(true)
  })

  it('the ruling is figure, not chrome: it is identical with chrome off', () => {
    const on = renderScene(
      boardScene({
        grid: 'polar',
        chrome: {
          selectedId: null,
          handles: [],
          activeHandleId: null,
          highlight: null,
          openIdx: null,
          hoverIdx: null,
        },
      }),
    )
    const off = renderScene(boardScene({ grid: 'polar' }))
    sameStream(on, off, 'the polar ruling must survive the export path')
  })
})

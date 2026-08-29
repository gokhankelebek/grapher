// ============================================================================
// tests/render.test.ts — the pure-logic parts of src/render.
//
// drawGrid / drawCurve / drawInk need a CanvasRenderingContext2D and (for
// curves) a Path2D, so they are exercised against a recording spy context
// (tests/mockCanvas.ts). No DOM, no real canvas — only the geometry and the
// label text the renderer produces are asserted.
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { FittedCurve, ModelSpec, Vec2, Viewport } from '../src/core/types'
import { DARK_THEME, toMath } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { parseExpression } from '../src/core/parse'
import { drawGrid, formatTick } from '../src/render/grid'
import { drawCurve, drawInk } from '../src/render/curves'
import { MockCtx, MockPath2D, withMockPath2D } from './mockCanvas'
import { VP, makeRng, polarPath, trace } from './helpers'

type Ctx2D = Parameters<typeof drawGrid>[0]

function vpAt(pxPerUnit: number, center: Vec2 = { x: 0, y: 0 }): Viewport {
  return { center, pxPerUnit, widthPx: 1200, heightPx: 800 }
}

function runGrid(vp: Viewport): MockCtx {
  const ctx = new MockCtx()
  drawGrid(ctx as unknown as Ctx2D, vp, DARK_THEME)
  return ctx
}

/** x-axis tick labels are the centre-aligned fillText calls. */
function xTickValues(ctx: MockCtx): number[] {
  return ctx.texts
    .filter(t => t.align === 'center')
    .map(t => Number(t.text))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
}

function curveOf(
  modelId: string, params: number[], kind: FittedCurve['kind'],
  domain: [number, number] | null,
): FittedCurve {
  return {
    id: 'r', modelId, params, kind, domain,
    color: '#4f9cf9', strokeWidth: 2.5, visible: true, error: 0.01,
  }
}

/** Draw one curve and return the Path2D the renderer stroked (or null). */
function pathFor(
  curve: FittedCurve, models: Record<string, ModelSpec>, vp: Viewport,
): MockPath2D | null {
  return withMockPath2D(() => {
    const ctx = new MockCtx()
    drawCurve(ctx as unknown as Ctx2D, curve, models, vp)
    return ctx.strokedPaths.length > 0 ? ctx.strokedPaths[ctx.strokedPaths.length - 1] : null
  })
}

// ---------------------------------------------------------------------------
// formatTick
// ---------------------------------------------------------------------------

describe('grid — formatTick', () => {
  it('never emits floating-point garbage', () => {
    expect(formatTick(0.1 + 0.2)).toBe('0.3')
    expect(formatTick(3 * 0.1)).toBe('0.3')
    expect(formatTick(0.1 * 3 + 0.1)).toBe('0.4')
    expect(formatTick(1 - 0.9)).toBe('0.1')
    expect(formatTick(0.007 * 3)).toBe('0.021')
    for (let k = -40; k <= 40; k++) {
      for (const step of [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50]) {
        const s = formatTick(k * step)
        expect(s, `${k} * ${step} -> ${s}`).not.toMatch(/\d{6,}/)
        expect(s).not.toMatch(/NaN|Infinity|undefined/)
        expect(Number(s.replace('e', 'e')), `${k} * ${step}`).toBeCloseTo(k * step, 9)
      }
    }
  })

  it('formats the usual suspects exactly', () => {
    expect(formatTick(0)).toBe('0')
    expect(formatTick(1)).toBe('1')
    expect(formatTick(-2)).toBe('-2')
    expect(formatTick(2.5)).toBe('2.5')
    expect(formatTick(1000)).toBe('1000')
    expect(formatTick(-0.5)).toBe('-0.5')
  })

  it('switches to exponent form only at the extremes', () => {
    expect(formatTick(1e7)).toMatch(/e7$/)
    expect(formatTick(1e-5)).toMatch(/e-5$/)
    expect(formatTick(99999)).toBe('99999')
    expect(formatTick(0.001)).toBe('0.001')
  })

  it('tolerates non-finite input', () => {
    expect(formatTick(NaN)).toBe('0')
    expect(formatTick(Infinity)).toBe('0')
  })
})

// ---------------------------------------------------------------------------
// drawGrid
// ---------------------------------------------------------------------------

describe('drawGrid', () => {
  const ZOOMS = [4, 7, 12, 18, 25, 37, 60, 90, 140, 220, 350, 600, 1000, 2500, 8000]

  it('never labels a tick with float garbage, at any zoom', () => {
    for (const ppu of ZOOMS) {
      for (const label of runGrid(vpAt(ppu)).texts) {
        expect(label.text, `ppu=${ppu}`).not.toMatch(/\d{6,}/)
        expect(label.text, `ppu=${ppu}`).not.toMatch(/0000\d/)
        expect(label.text, `ppu=${ppu}`).not.toMatch(/NaN|Infinity|undefined/)
      }
    }
  })

  it('the tick step follows the 1-2-5 ladder and targets 70-200 px', () => {
    for (const ppu of ZOOMS) {
      const ticks = xTickValues(runGrid(vpAt(ppu)))
      expect(ticks.length, `ppu=${ppu}: too few ticks`).toBeGreaterThanOrEqual(3)

      // Uniform spacing. The origin gets its own dedicated "0" label and is
      // skipped in this run, so exactly one gap may be a double step.
      const steps: number[] = []
      for (let i = 1; i < ticks.length; i++) steps.push(ticks[i] - ticks[i - 1])
      const step = Math.min(...steps)
      let doubled = 0
      for (const s of steps) {
        if (Math.abs(s - step) < 1e-9 * step) continue
        if (Math.abs(s - 2 * step) < 1e-9 * step) { doubled++; continue }
        throw new Error(`ppu=${ppu}: non-uniform ticks — gap ${s} vs step ${step}`)
      }
      expect(doubled, `ppu=${ppu}: more than one skipped tick`).toBeLessThanOrEqual(1)
      for (const t of ticks) {
        expect(Math.abs(t / step - Math.round(t / step)), `ppu=${ppu}: tick ${t} off-lattice`)
          .toBeLessThan(1e-6)
      }

      // 1-2-5 x 10^n
      const exp = Math.floor(Math.log10(step) + 1e-9)
      const mant = step / Math.pow(10, exp)
      const near = (v: number): boolean => Math.abs(mant - v) < 1e-6
      expect(
        near(1) || near(2) || near(5),
        `ppu=${ppu}: step ${step} has mantissa ${mant}, not 1/2/5`,
      ).toBe(true)

      // pixel spacing in the intended band
      expect(step * ppu, `ppu=${ppu}: ${step * ppu}px between majors`).toBeGreaterThan(70 - 1e-6)
      expect(step * ppu, `ppu=${ppu}: ${step * ppu}px between majors`).toBeLessThan(200)
    }
  })

  it('the tick step is monotone non-increasing as you zoom in', () => {
    let prev = Infinity
    for (const ppu of ZOOMS) {
      const ticks = xTickValues(runGrid(vpAt(ppu)))
      const step = ticks[1] - ticks[0]
      expect(step, `ppu=${ppu}`).toBeLessThanOrEqual(prev + 1e-12)
      prev = step
    }
  })

  it('paints the background, draws both axes and labels the origin once', () => {
    const ctx = runGrid(vpAt(60))
    expect(ctx.fills.length).toBeGreaterThan(0)
    expect(ctx.fills[0].style).toBe(DARK_THEME.bg)
    expect(ctx.fills[0].w).toBe(1200)
    expect(ctx.fills[0].h).toBe(800)
    expect(ctx.texts.filter(t => t.text === '0')).toHaveLength(1)
    expect(ctx.saveCount).toBe(ctx.restoreCount)
    // no tick is labelled twice
    const xs = xTickValues(ctx)
    expect(new Set(xs).size).toBe(xs.length)
    expect(xs).not.toContain(0) // the origin gets its own single label
  })

  it('every emitted coordinate is finite and no label lands outside the canvas', () => {
    for (const ppu of ZOOMS) {
      for (const center of [{ x: 0, y: 0 }, { x: 3.7, y: -2.1 }, { x: -1000, y: 500 }]) {
        const ctx = runGrid(vpAt(ppu, center))
        for (const p of ctx.own.points()) {
          expect(Number.isFinite(p.x) && Number.isFinite(p.y), `ppu=${ppu}`).toBe(true)
        }
        for (const t of ctx.texts) {
          expect(Number.isFinite(t.x) && Number.isFinite(t.y)).toBe(true)
          expect(t.x).toBeGreaterThanOrEqual(0)
          expect(t.x).toBeLessThanOrEqual(1200)
          expect(t.y).toBeGreaterThanOrEqual(0)
          expect(t.y).toBeLessThanOrEqual(800)
        }
      }
    }
  })

  it('degenerate viewports paint the background and bail out', () => {
    for (const vp of [vpAt(0), { ...vpAt(60), widthPx: 0 }, { ...vpAt(60), heightPx: -5 }]) {
      const ctx = new MockCtx()
      expect(() => drawGrid(ctx as unknown as Ctx2D, vp, DARK_THEME)).not.toThrow()
      expect(ctx.texts).toHaveLength(0)
    }
  })

  it('when the origin is off-screen the axis labels slide along the edges', () => {
    const ctx = runGrid(vpAt(60, { x: 500, y: 500 }))
    expect(ctx.texts.filter(t => t.text === '0')).toHaveLength(0)
    for (const t of ctx.texts) {
      expect(t.y).toBeGreaterThanOrEqual(0)
      expect(t.y).toBeLessThanOrEqual(800)
    }
  })
})

// ---------------------------------------------------------------------------
// drawCurve — asymptote breaking
// ---------------------------------------------------------------------------

describe('drawCurve — explicit curves with asymptotes break into subpaths', () => {
  /** tan(x), built through the real expression engine. */
  function tanModel(): Record<string, ModelSpec> {
    const r = parseExpression('tan(x)')
    if (!r.ok) throw new Error(r.error)
    return { tanx: r.plot.makeModel('tanx') }
  }

  it('tan(x) produces MANY subpaths, not one vertical stroke', () => {
    const models = tanModel()
    const vp = vpAt(60) // x in [-10, 10] -> ~7 asymptotes
    const path = pathFor(curveOf('tanx', [], 'explicit', null), models, vp)
    expect(path, 'tan(x) drew nothing').not.toBeNull()

    const moveTos = path!.moveToCount()
    expect(moveTos, `tan(x) drew ${moveTos} subpath(s) — asymptotes were not broken`)
      .toBeGreaterThan(1)
    // one branch per asymptote crossing the ±10 window
    expect(moveTos).toBeGreaterThanOrEqual(5)

    // no subpath may straddle an asymptote: within a branch the screen y must
    // be monotone (tan is increasing on every branch, so screen y decreases)
    for (const sub of path!.subpaths()) {
      if (sub.length < 3) continue
      let up = 0
      let down = 0
      for (let i = 1; i < sub.length; i++) {
        if (sub[i].y > sub[i - 1].y + 1e-9) down++
        else if (sub[i].y < sub[i - 1].y - 1e-9) up++
      }
      expect(Math.min(up, down), 'a subpath reversed direction — it straddles an asymptote')
        .toBeLessThanOrEqual(2)
    }
  })

  it('a smooth explicit curve is ONE continuous subpath', () => {
    const vp = vpAt(60)
    for (const [id, params] of [
      ['line', [-1, 0.8]],
      ['poly3', [0.5, -0.3, 0, 0.05]],
      ['sine', [1.5, 1.2, 0.3, 0.4]],
      ['gauss', [3, 0.5, 1.2, -1]],
    ] as Array<[string, number[]]>) {
      const path = pathFor(curveOf(id, params, 'explicit', null), MODELS, vp)
      expect(path, id).not.toBeNull()
      expect(path!.moveToCount(), `${id} should be one unbroken stroke`).toBe(1)
      expect(path!.points().length).toBeGreaterThan(50)
    }
  })

  it('1/x breaks at the origin', () => {
    const r = parseExpression('1/x')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const path = pathFor(
      curveOf('inv', [], 'explicit', null), { inv: r.plot.makeModel('inv') }, vpAt(60),
    )
    expect(path).not.toBeNull()
    expect(path!.moveToCount()).toBeGreaterThan(1)
  })

  it('every emitted point stays inside the generous clamp box', () => {
    const models = tanModel()
    const vp = vpAt(60)
    const path = pathFor(curveOf('tanx', [], 'explicit', null), models, vp)!
    for (const p of path.points()) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
      expect(p.x).toBeGreaterThanOrEqual(-vp.widthPx)
      expect(p.x).toBeLessThanOrEqual(2 * vp.widthPx)
      expect(p.y).toBeGreaterThanOrEqual(-vp.heightPx)
      expect(p.y).toBeLessThanOrEqual(2 * vp.heightPx)
    }
  })

  it('an invisible curve or an unknown model draws nothing', () => {
    withMockPath2D(() => {
      const ctx = new MockCtx()
      const hidden = { ...curveOf('line', [-1, 0.8], 'explicit', null), visible: false }
      drawCurve(ctx as unknown as Ctx2D, hidden, MODELS, vpAt(60))
      expect(ctx.strokeCount).toBe(0)

      const bogus = { ...curveOf('nope', [1], 'explicit', null) }
      drawCurve(ctx as unknown as Ctx2D, bogus, MODELS, vpAt(60))
      expect(ctx.strokeCount).toBe(0)

      drawCurve(ctx as unknown as Ctx2D, curveOf('line', [-1, 0.8], 'explicit', null), MODELS, vpAt(0))
      expect(ctx.strokeCount).toBe(0)
    })
  })

  it('a selected curve is stroked twice (halo + line)', () => {
    withMockPath2D(() => {
      const ctx = new MockCtx()
      drawCurve(
        ctx as unknown as Ctx2D, curveOf('line', [-1, 0.8], 'explicit', null),
        MODELS, vpAt(60), true,
      )
      expect(ctx.strokeCount).toBe(2)
      expect(ctx.strokedPaths[0]).toBe(ctx.strokedPaths[1]) // same geometry, no double-blend
    })
  })
})

// ---------------------------------------------------------------------------
// drawCurve — implicit marching squares
// ---------------------------------------------------------------------------

describe('drawCurve — marching squares', () => {
  /** Convert recorded screen points back to math coordinates. */
  function mathPoints(path: MockPath2D, vp: Viewport): Vec2[] {
    return path.points().map(p => toMath(p, vp))
  }

  it('a circle is traced with every point within 1% of the radius', () => {
    for (const [cx, cy, r] of [[0, 0, 2.5], [1.5, -1, 3], [-2, 2, 1.25]] as Array<[number, number, number]>) {
      const vp = vpAt(60)
      const path = pathFor(curveOf('circle', [cx, cy, r], 'implicit', null), MODELS, vp)
      expect(path, `circle r=${r}`).not.toBeNull()
      const pts = mathPoints(path!, vp)
      expect(pts.length, `circle r=${r}: too few points`).toBeGreaterThan(100)
      let worst = 0
      for (const p of pts) {
        worst = Math.max(worst, Math.abs(Math.hypot(p.x - cx, p.y - cy) - r))
      }
      expect(worst / r, `circle r=${r}: worst radial error ${worst}`).toBeLessThan(0.01)
    }
  })

  it('the traced circle covers the whole ring, not just an arc', () => {
    const vp = vpAt(60)
    const path = pathFor(curveOf('circle', [0, 0, 2.5], 'implicit', null), MODELS, vp)!
    const seen = new Set<number>()
    for (const p of mathPoints(path, vp)) {
      const b = Math.floor(((Math.atan2(p.y, p.x) + Math.PI) / (2 * Math.PI)) * 24) % 24
      seen.add(b)
    }
    expect(seen.size, 'the marching-squares circle has gaps').toBe(24)
  })

  it('an ellipse is traced within 1% of its own conic zero set', () => {
    const vp = vpAt(60)
    const params = [0.2052, -0.3197, 0.331, 0.0001, 0.001, -0.8638]
    const path = pathFor(curveOf('ellipse', params, 'implicit', null), MODELS, vp)
    expect(path).not.toBeNull()
    const pts = mathPoints(path!, vp)
    expect(pts.length).toBeGreaterThan(100)
    // |Q| / |grad Q| is the approximate geometric distance to the curve
    let worst = 0
    for (const p of pts) {
      const [A, B, C, D, E] = params
      const q = MODELS.ellipse.evalImplicit!(params, p.x, p.y)
      const gx = 2 * A * p.x + B * p.y + D
      const gy = B * p.x + 2 * C * p.y + E
      worst = Math.max(worst, Math.abs(q) / Math.max(Math.hypot(gx, gy), 1e-12))
    }
    expect(worst, `worst geometric deviation ${worst}`).toBeLessThan(0.03)
  })

  it('a circle entirely off-screen draws nothing rather than throwing', () => {
    withMockPath2D(() => {
      const ctx = new MockCtx()
      const c = curveOf('circle', [500, 500, 1], 'implicit', null)
      expect(() => drawCurve(ctx as unknown as Ctx2D, c, MODELS, vpAt(60))).not.toThrow()
      expect(ctx.strokeCount).toBe(0)
    })
  })
})

// ---------------------------------------------------------------------------
// drawCurve — polar / parametric
// ---------------------------------------------------------------------------

describe('drawCurve — polar and parametric', () => {
  it('a rose is traced through the origin with finite coordinates', () => {
    const vp = vpAt(60)
    const path = pathFor(curveOf('polarRose', [3, 3, 0.7], 'polar', [0, 2 * Math.PI]), MODELS, vp)
    expect(path).not.toBeNull()
    const pts = path!.points()
    expect(pts.length).toBeGreaterThan(100)
    for (const p of pts) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
    // the traced radii really do follow r = a cos(k theta + c)
    let worst = 0
    for (const p of pts.map(q => toMath(q, vp))) {
      const t = Math.atan2(p.y, p.x)
      const r = Math.hypot(p.x, p.y)
      worst = Math.max(worst, Math.abs(r - Math.abs(3 * Math.cos(3 * t + 0.7))))
    }
    expect(worst).toBeLessThan(0.05)
  })

  it('a vertical line spans the visible y-range even with a null domain', () => {
    const vp = vpAt(60)
    const path = pathFor(curveOf('vline', [2], 'parametric', null), MODELS, vp)
    expect(path).not.toBeNull()
    const pts = path!.points().map(p => toMath(p, vp))
    const halfH = vp.heightPx / 2 / vp.pxPerUnit
    expect(Math.min(...pts.map(p => p.y))).toBeLessThanOrEqual(-halfH)
    expect(Math.max(...pts.map(p => p.y))).toBeGreaterThanOrEqual(halfH)
    for (const p of pts) expect(p.x).toBeCloseTo(2, 6)
  })

  it('a Fourier curve is closed and smooth', () => {
    const vp = vpAt(60)
    const params = [0, 0, 2, 0, 0, 2, 0.2, 0.1, -0.1, 0.2]
    const path = pathFor(curveOf('fourier', params, 'parametric', [0, 2 * Math.PI]), MODELS, vp)
    expect(path).not.toBeNull()
    expect(path!.moveToCount()).toBe(1)
    const pts = path!.points()
    expect(Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y))
      .toBeLessThan(1) // returns to the start within a pixel
  })
})

// ---------------------------------------------------------------------------
// drawInk
// ---------------------------------------------------------------------------

describe('drawInk', () => {
  it('a single point is drawn as a dot', () => {
    const ctx = new MockCtx()
    drawInk(ctx as unknown as Ctx2D, [{ x: 1, y: 2 }], VP, '#fff')
    expect(ctx.own.cmds.filter(c => c.op === 'arc')).toHaveLength(1)
    expect(ctx.fillCount).toBe(1)
    expect(ctx.saveCount).toBe(ctx.restoreCount)
  })

  it('two points are drawn as a straight segment', () => {
    const ctx = new MockCtx()
    drawInk(ctx as unknown as Ctx2D, [{ x: -1, y: 0 }, { x: 1, y: 1 }], VP, '#fff')
    expect(ctx.own.cmds.filter(c => c.op === 'moveTo')).toHaveLength(1)
    expect(ctx.own.cmds.filter(c => c.op === 'lineTo')).toHaveLength(1)
    expect(ctx.strokeCount).toBe(1)
  })

  it('an empty stroke draws nothing', () => {
    const ctx = new MockCtx()
    drawInk(ctx as unknown as Ctx2D, [], VP, '#fff')
    expect(ctx.own.cmds).toHaveLength(0)
    expect(ctx.strokeCount).toBe(0)
  })

  it('a real stroke is smoothed through segment midpoints, all finite', () => {
    const pts = trace(polarPath(() => 2.5), 0, 2 * Math.PI, makeRng(5150), { n: 120 })
    const ctx = new MockCtx()
    drawInk(ctx as unknown as Ctx2D, pts, VP, '#4f9cf9')
    const quads = ctx.own.cmds.filter(c => c.op === 'quadraticCurveTo')
    expect(quads).toHaveLength(pts.length - 2)
    for (const p of ctx.own.points()) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
    }
    expect(ctx.strokeCount).toBe(1)
    expect(ctx.saveCount).toBe(ctx.restoreCount)
  })
})

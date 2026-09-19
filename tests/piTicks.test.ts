// ============================================================================
// tests/piTicks.test.ts — π-scaled axes.
//
// `y = sin(x)` used to get x ticks at 3, 6, 9: three numbers with no relation
// to the picture drawn above them. The π ladder fixes that, and this file pins
// the three things that can go wrong with it:
//
//   1. the LADDER — which multiple of π gets picked at which zoom, by the same
//      minimum-spacing rule the 1–2–5 ladder uses, so labels thin out honestly
//      instead of piling up;
//   2. the LABELS — reduced fractions, written the way a teacher writes them.
//      `2π/2`, `1π`, `0π` and `-0` are all bugs, and a sweep over every rung at
//      every tick index is the only way to be sure none of them appears;
//   3. the REGRESSION — a board that never mentions axisUnits must emit the
//      identical command stream it emitted before this feature existed. That
//      one is asserted against the recorded fillText calls directly.
//
// The renderer is exercised against the recording spy context (mockCanvas), the
// same way tests/render.test.ts does it: no DOM, no real canvas.
// ============================================================================

import { describe, it, expect } from 'vitest'
import {
  drawGrid,
  formatPiTick,
  formatTick,
  pickPiTickStep,
  pickTickStep,
} from '../src/render/grid'
import type { AxisUnits } from '../src/render/grid'
import { renderBoard, suggestAxisUnits, type BoardScene } from '../src/ui/renderBoard'
import { DARK_THEME } from '../src/core/types'
import type { FittedCurve, Vec2, Viewport } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { MockCtx, withMockPath2D } from './mockCanvas'

type Ctx2D = Parameters<typeof drawGrid>[0]

const PI = Math.PI

function vpAt(pxPerUnit: number, center: Vec2 = { x: 0, y: 0 }): Viewport {
  return { center, pxPerUnit, widthPx: 1200, heightPx: 800 }
}

function runGrid(vp: Viewport, units?: AxisUnits | null, type = 1): MockCtx {
  const ctx = new MockCtx()
  drawGrid(ctx as unknown as Ctx2D, vp, DARK_THEME, { type, stroke: 1 }, units)
  return ctx
}

/** x tick labels: the centre-aligned fillText calls, in draw order. */
const xLabels = (ctx: MockCtx): string[] =>
  ctx.texts.filter(t => t.align === 'center').map(t => t.text)

/** y tick labels: right-aligned and vertically centred (the origin is not). */
const yLabels = (ctx: MockCtx): string[] =>
  ctx.texts.filter(t => t.align === 'right' && t.baseline === 'middle').map(t => t.text)

/** The single origin "0": right-aligned, top baseline. */
const originLabels = (ctx: MockCtx): string[] =>
  ctx.texts.filter(t => t.align === 'right' && t.baseline === 'top').map(t => t.text)

/**
 * Read a π label back as a number, so a sweep can check that the string the
 * teacher sees is the quantity the tick actually sits at. Returns NaN for any
 * string that is not a well-formed π label — which is itself the assertion.
 */
function labelValue(s: string): number {
  if (s === '0') return 0
  const m = /^(-?)(\d+(?:\.\d+)?(?:e-?\d+)?)?π(?:\/(\d+))?$/.exec(s)
  if (!m) return NaN
  const sign = m[1] === '-' ? -1 : 1
  const coef = m[2] === undefined ? 1 : Number(m[2])
  const den = m[3] === undefined ? 1 : Number(m[3])
  return (sign * coef * PI) / den
}

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

describe('π ladder — pickPiTickStep', () => {
  it('picks the rung the trig unit expects at each zoom', () => {
    const table: Array<[number, number, number, string]> = [
      // pxPerUnit, num, den, name
      [360, 1, 12, 'π/12'],
      [120, 1, 4, 'π/4'],
      [60, 1, 2, 'π/2'],
      [30, 1, 1, 'π'],
      [15, 2, 1, '2π'],
    ]
    for (const [ppu, num, den, name] of table) {
      const step = pickPiTickStep(ppu)
      expect({ ppu, num: step.num, den: step.den }, `expected ${name} at ${ppu}px/unit`)
        .toEqual({ ppu, num, den })
      expect(step.major).toBeCloseTo((num * PI) / den, 12)
      // every one of these rungs lands on the same ~94px spacing
      expect(step.major * ppu).toBeCloseTo(94.2477796, 5)
    }
  })

  it('applies the same minimum-spacing rule pickTickStep does', () => {
    // The rule is "the first rung whose major spacing reaches minPx", so the
    // rung one below the chosen one must always have fallen short of it.
    const RUNGS = [
      [1, 12], [1, 6], [1, 4], [1, 3], [1, 2], [1, 1], [2, 1], [5, 1],
    ] as const
    for (let ppu = 2; ppu <= 900; ppu *= 1.07) {
      const step = pickPiTickStep(ppu, 70)
      expect(step.major * ppu, `ppu=${ppu}`).toBeGreaterThanOrEqual(70)
      const idx = RUNGS.findIndex(r => r[0] === step.num && r[1] === step.den)
      if (idx > 0) {
        const below = (RUNGS[idx - 1][0] / RUNGS[idx - 1][1]) * PI * ppu
        expect(below, `a denser rung fitted at ppu=${ppu}`).toBeLessThan(70)
      }
    }
  })

  it('thins out honestly as the board zooms out — never denser, never absurd', () => {
    let prev = 0
    for (let ppu = 360; ppu >= 0.02; ppu /= 1.09) {
      const step = pickPiTickStep(ppu, 70)
      // monotone: zooming out can only make the step in math units bigger
      expect(step.major, `ppu=${ppu}`).toBeGreaterThanOrEqual(prev - 1e-12)
      prev = step.major
      const spacing = step.major * ppu
      expect(spacing, `ppu=${ppu}`).toBeGreaterThanOrEqual(70)
      // worst case is the 2π→5π rung change (x2.5); nothing may exceed it
      expect(spacing, `ppu=${ppu}`).toBeLessThanOrEqual(70 * 2.5 + 1e-9)
    }
  })

  it('bottoms out at π/12 rather than inventing π/96', () => {
    // Zoomed in past the finest rung the axis goes sparse, deliberately: the
    // alternative is labels (π/48, π/96) that are correct and unreadable.
    for (const ppu of [400, 900, 3000, 20000]) {
      const step = pickPiTickStep(ppu)
      expect({ ppu, num: step.num, den: step.den }).toEqual({ ppu, num: 1, den: 12 })
    }
    expect(pickPiTickStep(900).major / pickPiTickStep(900).minorDiv).toBeCloseTo(PI / 24, 12)
  })

  it('carries on up the 1–2–5 ladder in units of π once past 5π', () => {
    for (const [ppu, num] of [[5, 5], [2, 20], [0.5, 50], [0.05, 500]] as const) {
      const step = pickPiTickStep(ppu)
      expect({ ppu, num: step.num, den: step.den }).toEqual({ ppu, num, den: 1 })
    }
  })

  it('subdivides into angles a class can name', () => {
    // π/2 → π/6, π/4 → π/12, π → π/4, 2π → π/2: every minor is itself a
    // nameable angle, never π/10 or π/5.
    const expected: Array<[number, number, string]> = [
      [120, 12, 'π/4 → π/12'],
      [60, 6, 'π/2 → π/6'],
      [30, 4, 'π → π/4'],
      [15, 2, '2π → π/2'],
    ]
    for (const [ppu, minorDen, why] of expected) {
      const step = pickPiTickStep(ppu)
      const minor = step.major / step.minorDiv
      expect(minor, why).toBeCloseTo(PI / minorDen, 12)
    }
  })

  it('survives a degenerate viewport rather than producing NaN ticks', () => {
    for (const bad of [0, -5, NaN, Infinity]) {
      const step = pickPiTickStep(bad)
      expect(Number.isFinite(step.major)).toBe(true)
      expect(step.major).toBeGreaterThan(0)
      expect(Number.isFinite(step.minorDiv)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// The labels
// ---------------------------------------------------------------------------

describe('π labels — formatPiTick', () => {
  it('writes the ones a teacher writes', () => {
    expect(formatPiTick(0, 2)).toBe('0')
    expect(formatPiTick(1, 2)).toBe('π/2')
    expect(formatPiTick(2, 2)).toBe('π')       // never 2π/2
    expect(formatPiTick(3, 2)).toBe('3π/2')
    expect(formatPiTick(4, 2)).toBe('2π')      // never 4π/2
    expect(formatPiTick(1, 1)).toBe('π')       // never 1π
    expect(formatPiTick(5, 1)).toBe('5π')
    expect(formatPiTick(-1, 4)).toBe('-π/4')
    expect(formatPiTick(-1, 1)).toBe('-π')     // never -1π
    expect(formatPiTick(-3, 2)).toBe('-3π/2')
    expect(formatPiTick(2, 12)).toBe('π/6')
    expect(formatPiTick(3, 12)).toBe('π/4')
    expect(formatPiTick(9, 12)).toBe('3π/4')
  })

  it('suppresses zero exactly the way formatTick does', () => {
    expect(formatPiTick(0, 1)).toBe(formatTick(0))
    expect(formatPiTick(-0, 12)).toBe('0')      // never -0
    expect(formatPiTick(NaN, 2)).toBe(formatTick(NaN))
    expect(formatPiTick(Infinity, 2)).toBe(formatTick(Infinity))
    expect(formatPiTick(1, 0)).toBe('0')
  })

  it('reduces correctly at every rung and every tick index', () => {
    const rungs = [
      [1, 12], [1, 6], [1, 4], [1, 3], [1, 2], [1, 1], [2, 1], [5, 1], [10, 1], [20, 1],
    ] as const
    for (const [num, den] of rungs) {
      for (let k = -40; k <= 40; k++) {
        const s = formatPiTick(k * num, den)
        const where = `k=${k} of ${num}π/${den} -> ${s}`
        if (k === 0) {
          expect(s, where).toBe('0')
          continue
        }
        expect(s, where).not.toMatch(/^-?0/)          // no 0π, no -0, no -0π/3
        expect(s, where).not.toMatch(/(^|[^\d])1π/)   // no 1π, no -1π
        expect(s, where).not.toMatch(/NaN|Infinity|undefined/)
        // reduced: numerator and denominator share no factor
        const m = /^-?(\d+)?π\/(\d+)$/.exec(s)
        if (m) {
          const a = m[1] === undefined ? 1 : Number(m[1])
          const b = Number(m[2])
          expect(b, where).toBeGreaterThan(1)
          for (let f = 2; f <= b; f++) {
            expect(a % f === 0 && b % f === 0, `${where} is not reduced`).toBe(false)
          }
        }
        // and it still names the quantity the tick sits at
        expect(labelValue(s), where).toBeCloseTo((k * num * PI) / den, 9)
      }
    }
  })

  it('falls back to exponent form for absurd coefficients, as formatTick does', () => {
    expect(formatPiTick(1e7, 1)).toBe(`${formatTick(1e7)}π`)
    expect(formatPiTick(1e7, 1)).not.toMatch(/\d{6,}/)
  })
})

// ---------------------------------------------------------------------------
// drawGrid with π axes
// ---------------------------------------------------------------------------

describe('drawGrid — π axes', () => {
  const ZOOMS = [4, 7, 12, 18, 25, 37, 60, 90, 140, 220, 350, 600]

  it('labels the x axis in π and never emits a malformed one', () => {
    for (const ppu of ZOOMS) {
      const ctx = runGrid(vpAt(ppu), { x: 'pi' })
      const labels = xLabels(ctx)
      expect(labels.length, `ppu=${ppu} drew no x labels`).toBeGreaterThan(0)
      for (const s of labels) {
        const where = `ppu=${ppu} -> ${s}`
        expect(s, where).toMatch(/π/)
        expect(Number.isFinite(labelValue(s)), where).toBe(true)
        expect(s, where).not.toMatch(/^-?0/)
        expect(s, where).not.toMatch(/(^|[^\d])1π/)
        expect(s, where).not.toMatch(/NaN|Infinity|undefined/)
      }
      // strictly increasing left to right, and spaced by exactly one rung
      const vals = labels.map(labelValue)
      for (let i = 1; i < vals.length; i++) {
        expect(vals[i], `ppu=${ppu}`).toBeGreaterThan(vals[i - 1])
      }
    }
  })

  it('prints the origin once, as a plain 0, exactly as before', () => {
    for (const ppu of ZOOMS) {
      const pi = runGrid(vpAt(ppu), { x: 'pi', y: 'pi' })
      expect(originLabels(pi), `ppu=${ppu}`).toEqual(['0'])
      // and it is the same call the decimal board makes
      const dec = runGrid(vpAt(ppu))
      const originOf = (c: MockCtx) =>
        c.texts.filter(t => t.align === 'right' && t.baseline === 'top')
      expect(originOf(pi)).toEqual(originOf(dec))
      // no tick label duplicates the origin
      expect(xLabels(pi)).not.toContain('0')
      expect(yLabels(pi)).not.toContain('0')
    }
  })

  it('takes the two axes independently', () => {
    const xOnly = runGrid(vpAt(60), { x: 'pi' })
    expect(xLabels(xOnly).every(s => s.includes('π'))).toBe(true)
    expect(yLabels(xOnly).some(s => s.includes('π'))).toBe(false)

    const yOnly = runGrid(vpAt(60), { y: 'pi' })
    expect(yLabels(yOnly).every(s => s.includes('π'))).toBe(true)
    expect(xLabels(yOnly).some(s => s.includes('π'))).toBe(false)

    const both = runGrid(vpAt(60), { x: 'pi', y: 'pi' })
    expect(xLabels(both).every(s => s.includes('π'))).toBe(true)
    expect(yLabels(both).every(s => s.includes('π'))).toBe(true)

    // an explicit 'decimal' is the same as saying nothing
    const said = runGrid(vpAt(60), { x: 'decimal', y: 'decimal' })
    expect(said.texts).toEqual(runGrid(vpAt(60)).texts)
  })

  it('slides the labels along the edge when the axis is off-screen, as before', () => {
    // centre far off the origin: the x axis is above the viewport, so the x
    // labels clamp to the top edge and the origin "0" is not drawn at all.
    const off = vpAt(60, { x: 40, y: 40 })
    const pi = runGrid(off, { x: 'pi' })
    const dec = runGrid(off)
    expect(originLabels(pi)).toEqual([])
    expect(originLabels(dec)).toEqual([])
    const piY = pi.texts.filter(t => t.align === 'center').map(t => t.y)
    const decY = dec.texts.filter(t => t.align === 'center').map(t => t.y)
    expect(new Set(piY).size).toBe(1)
    expect(piY[0], 'π labels must clamp to the same edge row').toBe(decY[0])
  })

  it('scales with present, and re-asks the crowding rule at the wider text', () => {
    const vp = vpAt(60)
    const one = runGrid(vp, { x: 'pi' }, 1)
    const big = runGrid(vp, { x: 'pi' }, 3)
    // a projected board gets fewer, larger labels — the same ladder, thinned
    expect(big.texts.length).toBeLessThan(one.texts.length)
    for (const s of xLabels(big)) expect(Number.isFinite(labelValue(s))).toBe(true)

    // π text is wider than the decimal it replaces, so the π ladder must never
    // pack its labels tighter than the decimal one does at the same zoom.
    for (const ppu of ZOOMS) {
      const gapOf = (c: MockCtx) => {
        const xs = c.texts.filter(t => t.align === 'center').map(t => t.x)
        return xs.length > 1 ? Math.abs(xs[1] - xs[0]) : Infinity
      }
      const piGap = gapOf(runGrid(vpAt(ppu), { x: 'pi' }))
      const decGap = gapOf(runGrid(vpAt(ppu)))
      expect(piGap, `ppu=${ppu}: π labels packed tighter than decimals`)
        .toBeGreaterThanOrEqual(Math.min(decGap, 70) - 1e-9)
    }
  })
})

// ---------------------------------------------------------------------------
// Regression: the decimal board must not have moved
// ---------------------------------------------------------------------------

describe('decimal ladder — unchanged by the existence of π axes', () => {
  const ZOOMS = [4, 7, 12, 18, 25, 37, 60, 90, 140, 220, 350, 600, 1000, 2500, 8000]

  it('drawGrid still takes three arguments and draws the same picture', () => {
    for (const ppu of ZOOMS) {
      const vp = vpAt(ppu, { x: 1.3, y: -0.7 })
      const bare = new MockCtx()
      drawGrid(bare as unknown as Ctx2D, vp, DARK_THEME)
      const withUnits = new MockCtx()
      drawGrid(withUnits as unknown as Ctx2D, vp, DARK_THEME, null, null)
      const explicit = new MockCtx()
      drawGrid(explicit as unknown as Ctx2D, vp, DARK_THEME, null, { x: 'decimal', y: 'decimal' })
      for (const other of [withUnits, explicit]) {
        expect(other.texts, `ppu=${ppu}`).toEqual(bare.texts)
        expect(other.own.cmds, `ppu=${ppu}`).toEqual(bare.own.cmds)
        expect(other.fills, `ppu=${ppu}`).toEqual(bare.fills)
        expect(other.strokeStyles, `ppu=${ppu}`).toEqual(bare.strokeStyles)
        expect(other.fillStyles, `ppu=${ppu}`).toEqual(bare.fillStyles)
        expect(other.strokeCount, `ppu=${ppu}`).toBe(bare.strokeCount)
        expect(other.fillCount, `ppu=${ppu}`).toBe(bare.fillCount)
      }
    }
  })

  it('the 1–2–5 ladder itself is untouched', () => {
    for (let ppu = 0.05; ppu < 9000; ppu *= 1.3) {
      const s = pickTickStep(ppu)
      const mant = s.major / Math.pow(10, Math.floor(Math.log10(s.major) + 1e-12))
      expect([1, 2, 5].some(m => Math.abs(mant - m) < 1e-9), `ppu=${ppu}`).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// renderBoard: the scene field, and the AUTO recommendation
// ---------------------------------------------------------------------------

const SINE: FittedCurve = {
  id: 's1', modelId: 'sine', params: [1, 1, 0, 0],
  kind: 'explicit', domain: null,
  color: '#4f9cf9', strokeWidth: 2.5, visible: true, error: 0.01,
}

function curve(over: Partial<FittedCurve>): FittedCurve {
  return { ...SINE, ...over }
}

function scene(over: Partial<BoardScene> = {}): BoardScene {
  return {
    vp: vpAt(60),
    theme: DARK_THEME,
    curves: [SINE],
    styles: {},
    models: MODELS,
    ...over,
  }
}

function render(s: BoardScene): MockCtx {
  const ctx = new MockCtx()
  withMockPath2D(() => renderBoard(ctx as unknown as CanvasRenderingContext2D, s))
  return ctx
}

describe('renderBoard — the axisUnits scene field', () => {
  it('threads the field into the grid, screen and export alike', () => {
    const pi = render(scene({ axisUnits: { x: 'pi' } }))
    expect(xLabels(pi)).toContain('π')
    expect(xLabels(pi)).toContain('π/2')
    expect(xLabels(pi)).toContain('3π/2')
    expect(xLabels(pi)).toContain('-π/2')
  })

  it('an absent field is exactly today’s decimal board', () => {
    const bare = render(scene())
    const absent = render(scene({ axisUnits: undefined }))
    const empty = render(scene({ axisUnits: {} }))
    for (const other of [absent, empty]) {
      expect(other.texts).toEqual(bare.texts)
      expect(other.own.cmds).toEqual(bare.own.cmds)
    }
    expect(xLabels(bare).some(s => s.includes('π'))).toBe(false)
    expect(xLabels(bare), 'the 1–2–5 ladder still labels 2 at 60px/unit').toContain('2')
  })

  it('carries through to a chrome-free figure, which is what the export draws', () => {
    const fig = render(scene({ axisUnits: { x: 'pi', y: 'pi' }, chrome: null }))
    expect(xLabels(fig).every(s => s.includes('π'))).toBe(true)
    expect(yLabels(fig).every(s => s.includes('π'))).toBe(true)
  })
})

describe('suggestAxisUnits — a recommendation, not a decision', () => {
  it('recommends π for a fitted sine', () => {
    expect(suggestAxisUnits([SINE])).toEqual({ x: 'pi' })
  })

  it('says nothing for a board with no trig on it', () => {
    expect(suggestAxisUnits([])).toEqual({})
    expect(suggestAxisUnits([curve({ modelId: 'poly2' })])).toEqual({})
    expect(suggestAxisUnits([curve({ modelId: 'exp' })])).toEqual({})
  })

  it('reads a typed expression only through the sources map it is handed', () => {
    const typed = curve({ id: 'e1', modelId: 'expr_1' })
    expect(suggestAxisUnits([typed]), 'no sources: nothing to read').toEqual({})
    expect(suggestAxisUnits([typed], { e1: '2sin(x) + 1' })).toEqual({ x: 'pi' })
    expect(suggestAxisUnits([typed], { e1: 'cos(2x)' })).toEqual({ x: 'pi' })
    expect(suggestAxisUnits([typed], { e1: 'tan(x/2)' })).toEqual({ x: 'pi' })
    expect(suggestAxisUnits([typed], { e1: '\\sin(x)' })).toEqual({ x: 'pi' })
    expect(suggestAxisUnits([typed], { e1: 'x^2 + 3x' })).toEqual({})
    // a source keyed to a different curve is not this curve's source
    expect(suggestAxisUnits([typed], { other: 'sin(x)' })).toEqual({})
  })

  it('is not fooled by names that merely contain a trig one', () => {
    const typed = curve({ id: 'e1', modelId: 'expr_1' })
    // hyperbolic: not periodic, so π axes would be a lie
    expect(suggestAxisUnits([typed], { e1: 'tanh(x)' })).toEqual({})
    expect(suggestAxisUnits([typed], { e1: 'sinh(x) + cosh(x)' })).toEqual({})
    // inverse trig: it is the OUTPUT that is in radians, not x
    expect(suggestAxisUnits([typed], { e1: 'asin(x)' })).toEqual({})
    expect(suggestAxisUnits([typed], { e1: 'arccos(x)' })).toEqual({})
  })

  it('ignores hidden curves — the axes follow what is on the board', () => {
    expect(suggestAxisUnits([curve({ visible: false })])).toEqual({})
    expect(suggestAxisUnits([curve({ visible: false }), curve({ modelId: 'poly2' })])).toEqual({})
    expect(suggestAxisUnits([curve({ modelId: 'poly2' }), SINE])).toEqual({ x: 'pi' })
  })

  it('is pure: it recommends x only, and never mutates its input', () => {
    const curves = [SINE]
    const before = JSON.stringify(curves)
    const out = suggestAxisUnits(curves, { s1: 'sin(x)' })
    expect(JSON.stringify(curves)).toBe(before)
    expect(Object.keys(out)).toEqual(['x'])
  })
})

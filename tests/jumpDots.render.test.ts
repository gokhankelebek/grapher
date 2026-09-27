// ============================================================================
// tests/jumpDots.render.test.ts — the filled and open dots at a step
// function's jumps (src/render/jumpDots.ts, fed by analyzeJumps in
// src/render/curves.ts).
//
// Claims:
//  1. Typed step functions get ● at the attained end of each step and ○ at
//     the other: ⌊x⌋, ⌈x⌉, x − ⌊x⌋, ⌊x/2⌋ + 1; sign x gets ○ ● ○; |x|/x gets
//     two ○ and no ●.
//  2. A pole (tan x, 1/x) gets nothing.
//  3. No double drawing: a piecewise curve's piece ends are pieceDots' alone;
//     a restricted ⌊x⌋ gets its ends from pieceDots and its inner steps from
//     this layer, one glyph per point; a hole reported at a jump is not ringed
//     a second time.
//  4. Every figure style, Screen included; mono ink under SAT/AP; present
//     scaling; stretched axes; exported (chrome null).
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

const core = vi.hoisted(() => ({
  holes: [] as { x: number; y: number; exact: boolean }[],
}))

vi.mock('../src/core/holes', () => ({
  findHoles: () => core.holes,
  findPoles: () => [],
  findAsymptotes: () => [],
}))

import { renderBoard, type BoardScene } from '../src/ui/renderBoard'
import { END_CLOSED_RING, END_DOT_R, END_OPEN_RING } from '../src/render/endCaps'
import { curveJumpMarks, jumpMarks } from '../src/render/jumpDots'
import { MockCtx, MockPath2D, withMockPath2D, type Cmd } from './mockCanvas'
import { parseExpression } from '../src/core/parse'
import { CURVE_COLORS, DARK_THEME, FIGURE_STYLES, toPrintColor } from '../src/core/types'
import type { FittedCurve, ModelSpec, Viewport } from '../src/core/types'

// x in [-7.5, 7.5], y in [-5, 5]
const VP: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 900, heightPx: 600 }
// the same board nudged so that no base sample lands on an integer
const VP_OFF: Viewport = { ...VP, center: { x: 0.013, y: 0.007 } }
const sx = (x: number, vp = VP): number =>
  vp.widthPx / 2 + (x - vp.center.x) * vp.pxPerUnit
const sy = (y: number, vp = VP): number =>
  vp.heightPx / 2 - (y - vp.center.y) * (vp.pxPerUnitY ?? vp.pxPerUnit)

function typed(src: string): { curve: FittedCurve; models: Record<string, ModelSpec> } {
  const r = parseExpression(src)
  if (!r.ok) throw new Error(`expected "${src}" to parse, got: ${r.error}`)
  const spec = r.plot.makeModel('t')
  const curve: FittedCurve = {
    id: 'c1', modelId: 't', params: r.plot.defaultParams, kind: 'explicit',
    domain: r.plot.domain, color: CURVE_COLORS[0], strokeWidth: 2.5, visible: true, error: 0,
  }
  return { curve, models: { t: spec } }
}

// ---------------------------------------------------------------------------
// A recording context that keeps each paint op with its arcs and style
// (the same one tests/pieceDots.render.test.ts reads glyphs with).
// ---------------------------------------------------------------------------

interface Arc { x: number; y: number; r: number }
interface Op {
  kind: 'fill' | 'stroke'
  style: string
  lw: number
  alpha: number
  path: boolean
  arcs: Arc[]
}

class RecCtx extends MockCtx {
  ops: Op[] = []
  private begin = 0
  override beginPath(): void { this.begin = this.own.cmds.length }
  private note(kind: 'fill' | 'stroke', path: boolean): void {
    const arcs: Arc[] = []
    if (!path) {
      for (const c of this.own.cmds.slice(this.begin) as Cmd[]) {
        if (c.op === 'arc') arcs.push({ x: c.x, y: c.y, r: c.r })
      }
    }
    this.ops.push({
      kind, style: kind === 'fill' ? this.fillStyle : this.strokeStyle,
      lw: this.lineWidth, alpha: this.globalAlpha, path, arcs,
    })
  }
  override fill(): void { this.note('fill', false); super.fill() }
  override stroke(p?: MockPath2D): void { this.note('stroke', p !== undefined); super.stroke(p) }
}

function scene(src: string, over: Partial<BoardScene> = {}): BoardScene {
  const { curve, models } = typed(src)
  return {
    vp: VP, theme: DARK_THEME, curves: [curve], styles: {}, models,
    analysis: null, chrome: null,
    ...over,
  }
}

function render(s: BoardScene): RecCtx {
  const ctx = new RecCtx()
  withMockPath2D(() => renderBoard(ctx as unknown as CanvasRenderingContext2D, s))
  return ctx
}

/** Open rings: a ground-filled disc at END_DOT_R, re-stroked in the ink. */
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

/** Filled dots: a ground ring outside the disc, then the disc filled in ink. */
function discs(ctx: RecCtx, ink: string, bg: string, stroke = 1): Arc[] {
  const r = END_DOT_R * stroke
  const ring = END_CLOSED_RING * stroke
  const out: Arc[] = []
  for (let i = 0; i < ctx.ops.length - 1; i++) {
    const s = ctx.ops[i]
    const f = ctx.ops[i + 1]
    if (s.kind !== 'stroke' || s.style !== bg || s.path || s.arcs.length !== 1) continue
    if (Math.abs(s.arcs[0].r - (r + ring / 2)) > 1e-9) continue
    if (f.kind !== 'fill' || f.style !== ink || f.arcs.length !== 1) continue
    if (Math.abs(f.arcs[0].r - r) > 1e-9) continue
    out.push(f.arcs[0])
  }
  return out
}

const near = (a: Arc, x: number, y: number, tol = 0.5): boolean =>
  Math.abs(a.x - x) <= tol && Math.abs(a.y - y) <= tol
const has = (arcs: Arc[], x: number, y: number, vp = VP): boolean =>
  arcs.some((a) => near(a, sx(x, vp), sy(y, vp)))
/** No two glyphs of one list at the same point. */
const distinct = (arcs: Arc[]): boolean =>
  arcs.every((a, i) => arcs.every((b, j) => i === j || !near(a, b.x, b.y)))

const INK = CURVE_COLORS[0]
const BG = DARK_THEME.bg

beforeEach(() => {
  core.holes = []
})

// ===========================================================================
// 1. Typed step functions
// ===========================================================================

describe('typed step functions: ● at the attained end, ○ at the other', () => {
  it('⌊x⌋ on [−3, 3): six ● at (n, n) and six ○ at (n + 1, n)', () => {
    // The ends are the restriction's (pieceDots), the inner steps this layer's.
    const ctx = render(scene('y = floor(x) {-3 <= x < 3}'))
    const f = discs(ctx, INK, BG)
    const o = rings(ctx, INK, BG)
    expect(f).toHaveLength(6)
    expect(o).toHaveLength(6)
    for (const n of [-3, -2, -1, 0, 1, 2]) {
      expect(has(f, n, n), `● (${n}, ${n})`).toBe(true)
      expect(has(o, n + 1, n), `○ (${n + 1}, ${n})`).toBe(true)
    }
    expect(distinct(f) && distinct(o)).toBe(true)
  })

  it('⌊x⌋ across the whole board: ● (n, n) and ○ (n, n − 1) at every step, on either sampling grid', () => {
    for (const vp of [VP, VP_OFF]) {
      const ctx = render(scene('y = floor(x)', { vp }))
      const f = discs(ctx, INK, BG)
      const o = rings(ctx, INK, BG)
      for (const n of [-4, -3, -2, -1, 0, 1, 2, 3, 4]) {
        expect(has(f, n, n, vp), `● (${n}, ${n})`).toBe(true)
        expect(has(o, n, n - 1, vp), `○ (${n}, ${n - 1})`).toBe(true)
        expect(has(f, n, n - 1, vp), `no ● (${n}, ${n - 1})`).toBe(false)
      }
      expect(distinct(f) && distinct(o)).toBe(true)
    }
  })

  it('⌈x⌉: ● at the RIGHT end of each step, (n, n), ○ at (n, n + 1)', () => {
    const ctx = render(scene('y = ceil(x)'))
    const f = discs(ctx, INK, BG)
    const o = rings(ctx, INK, BG)
    for (const n of [-3, -2, -1, 0, 1, 2, 3]) {
      expect(has(f, n, n), `● (${n}, ${n})`).toBe(true)
      expect(has(o, n, n + 1), `○ (${n}, ${n + 1})`).toBe(true)
      expect(has(f, n, n + 1)).toBe(false)
    }
  })

  it('sign x: ○ (0, −1), ● (0, 0), ○ (0, 1) — and nothing else', () => {
    for (const vp of [VP, VP_OFF]) {
      const ctx = render(scene('y = sign(x)', { vp }))
      const f = discs(ctx, INK, BG)
      const o = rings(ctx, INK, BG)
      expect(f).toHaveLength(1)
      expect(has(f, 0, 0, vp)).toBe(true)
      expect(o).toHaveLength(2)
      expect(has(o, 0, -1, vp) && has(o, 0, 1, vp)).toBe(true)
    }
  })

  it('|x|/x: ○ at (0, ±1) and no ● (no value at 0)', () => {
    for (const vp of [VP, VP_OFF]) {
      const ctx = render(scene('y = abs(x)/x', { vp }))
      expect(discs(ctx, INK, BG)).toHaveLength(0)
      const o = rings(ctx, INK, BG)
      expect(o).toHaveLength(2)
      expect(has(o, 0, -1, vp) && has(o, 0, 1, vp)).toBe(true)
    }
  })

  it('x − ⌊x⌋: ● (n, 0) and ○ (n, 1)', () => {
    const ctx = render(scene('y = x - floor(x)'))
    const f = discs(ctx, INK, BG)
    const o = rings(ctx, INK, BG)
    for (const n of [-7, -3, -1, 0, 1, 2, 7]) {
      expect(has(f, n, 0), `● (${n}, 0)`).toBe(true)
      expect(has(o, n, 1), `○ (${n}, 1)`).toBe(true)
    }
    expect(f).toHaveLength(15)
    expect(o).toHaveLength(15)
  })

  it('⌊x/2⌋ + 1: ● (2k, k + 1) and ○ (2k, k), nothing at the odd integers', () => {
    const ctx = render(scene('y = floor(x/2) + 1'))
    const f = discs(ctx, INK, BG)
    const o = rings(ctx, INK, BG)
    for (const k of [-3, -2, -1, 0, 1, 2]) {
      expect(has(f, 2 * k, k + 1), `● (${2 * k}, ${k + 1})`).toBe(true)
      expect(has(o, 2 * k, k), `○ (${2 * k}, ${k})`).toBe(true)
    }
    expect(f.some((a) => near(a, sx(1), a.y, 1))).toBe(false)
  })
})

// ===========================================================================
// 2. Poles
// ===========================================================================

describe('a pole is not a jump', () => {
  it('tan x and 1/x: no dots at all', () => {
    for (const src of ['y = tan(x)', 'y = 1/x', 'y = 1/(x-1) + floor(0)']) {
      for (const vp of [VP, VP_OFF]) {
        const ctx = render(scene(src, { vp }))
        expect(discs(ctx, INK, BG), src).toHaveLength(0)
        expect(rings(ctx, INK, BG), src).toHaveLength(0)
      }
    }
  })

  it('a continuous steep curve gets nothing either', () => {
    for (const src of ['y = 50x', 'y = e^(10x)', 'y = x^(1/3)']) {
      const ctx = render(scene(src))
      expect(discs(ctx, INK, BG), src).toHaveLength(0)
      expect(rings(ctx, INK, BG), src).toHaveLength(0)
    }
  })
})

// ===========================================================================
// 3. No double drawing
// ===========================================================================

describe('no double drawing', () => {
  it('a piecewise curve: its piece ends are pieceDots’ alone', () => {
    // {x² + 1 if x < 0; 3 if 0 ≤ x ≤ 2; −x + 5 if x > 2}: ○ (0, 1), ● (0, 3).
    const ctx = render(scene('y = piecewise(x^2+1, x<0, 3, 0<=x<=2, -x+5, x>2)'))
    const f = discs(ctx, INK, BG)
    const o = rings(ctx, INK, BG)
    expect(f).toHaveLength(1)
    expect(o).toHaveLength(1)
    expect(has(f, 0, 3) && has(o, 0, 1)).toBe(true)
  })

  it('a hole the hole layer reports at a jump point is not ringed a second time', () => {
    core.holes = [{ x: 0, y: 1, exact: true }]
    const ctx = render(scene('y = abs(x)/x'))
    const o = rings(ctx, INK, BG)
    expect(o.filter((a) => near(a, sx(0), sy(1)))).toHaveLength(1)
    expect(o).toHaveLength(2)
  })

  it('SAT caps the ends of a restricted ⌊x⌋ once: no jump dot is stacked on a cap', () => {
    const fig = FIGURE_STYLES.sat
    const ink = fig.theme.axis
    const ctx = render(scene('y = floor(x) {-3 <= x < 3}', { figure: fig }))
    const f = discs(ctx, ink, fig.theme.bg)
    const o = rings(ctx, ink, fig.theme.bg)
    expect(distinct(f) && distinct(o)).toBe(true)
    expect(f).toHaveLength(6)
    expect(o).toHaveLength(6)
  })
})

// ===========================================================================
// 4. Styles, ink, scale, stretch, export
// ===========================================================================

describe('every style, mono ink, present scaling, stretched axes', () => {
  it('Screen, Textbook, SAT and AP all draw them; SAT and AP in the axis black', () => {
    for (const id of ['screen', 'textbook', 'sat', 'ap'] as const) {
      const fig = FIGURE_STYLES[id]
      const ink = fig.curveInk === 'mono' ? fig.theme.axis : id === 'screen' ? INK : toPrintColor(INK)
      const ctx = render(scene('y = sign(x)', { figure: fig }))
      expect(discs(ctx, ink, fig.theme.bg), id).toHaveLength(1)
      expect(rings(ctx, ink, fig.theme.bg), id).toHaveLength(2)
    }
    expect(FIGURE_STYLES.sat.curveInk).toBe('mono')
    const sat = render(scene('y = sign(x)', { figure: FIGURE_STYLES.sat }))
    expect(discs(sat, INK, FIGURE_STYLES.sat.theme.bg)).toHaveLength(0)
  })

  it('present.stroke scales the glyphs as it scales every other dot', () => {
    const ctx = render(scene('y = sign(x)', { present: { type: 1, stroke: 2 } }))
    expect(discs(ctx, INK, BG, 2)).toHaveLength(1)
    expect(rings(ctx, INK, BG, 2)).toHaveLength(2)
    expect(discs(ctx, INK, BG, 1)).toHaveLength(0)
  })

  it('a stretched board puts each dot at x by ppuX and y by ppuY', () => {
    const vp: Viewport = { ...VP, pxPerUnitY: 25 }
    const ctx = render(scene('y = floor(x)', { vp }))
    const f = discs(ctx, INK, BG)
    const o = rings(ctx, INK, BG)
    for (const n of [-3, 0, 2, 5]) {
      expect(has(f, n, n, vp), `● (${n}, ${n})`).toBe(true)
      expect(has(o, n, n - 1, vp), `○ (${n}, ${n - 1})`).toBe(true)
    }
  })

  it('exported with chrome null; hidden curves draw nothing', () => {
    const s = scene('y = sign(x)')
    expect(discs(render({ ...s, chrome: null }), INK, BG)).toHaveLength(1)
    const hidden = render({ ...s, curves: [{ ...s.curves[0], visible: false }] })
    expect(discs(hidden, INK, BG)).toHaveLength(0)
    expect(rings(hidden, INK, BG)).toHaveLength(0)
  })

  it('a faded curve fades its jump dots with it', () => {
    const ctx = render(scene('y = sign(x)', { styles: { c1: { opacity: 0.4 } } }))
    const i = ctx.ops.findIndex((o) => o.kind === 'fill' && o.style === INK && o.arcs.length === 1)
    expect(i).toBeGreaterThan(-1)
    expect(ctx.ops[i].alpha).toBeCloseTo(0.4, 9)
  })
})

// ===========================================================================
// 5. The mark rules, directly
// ===========================================================================

describe('jumpMarks', () => {
  it('value on a limit: ● there, ○ at the other; value on neither: ○ ○ and ● at the value', () => {
    const a = jumpMarks([{ x: 1, left: 0, right: 1, value: 1, exact: true }], VP)
    expect(a.map((d) => [d.x, d.y, d.closed])).toEqual([[1, 0, false], [1, 1, true]])
    const b = jumpMarks([{ x: 0, left: -1, right: 1, value: 0, exact: true }], VP)
    expect(b.map((d) => [d.x, d.y, d.closed])).toEqual([[0, -1, false], [0, 1, false], [0, 0, true]])
    const c = jumpMarks([{ x: 0, left: -1, right: 1, value: Number.NaN, exact: true }], VP)
    expect(c.map((d) => [d.x, d.y, d.closed])).toEqual([[0, -1, false], [0, 1, false]])
  })

  it('an unsnapped jump is not marked; a ring under a filled dot is dropped; off-board is dropped', () => {
    expect(jumpMarks([{ x: 1.4142, left: 1, right: 2, value: Number.NaN, exact: false }], VP)).toEqual([])
    // a 1.8 px jump: the ring is covered by the dot
    const tiny = jumpMarks([{ x: 1, left: 1, right: 1.03, value: 1.03, exact: true }], VP)
    expect(tiny.map((d) => d.closed)).toEqual([true])
    expect(jumpMarks([{ x: 20, left: 0, right: 1, value: 1, exact: true }], VP)).toEqual([])
  })

  it('curveJumpMarks samples afresh and agrees with the board', () => {
    const { curve, models } = typed('y = sign(x)')
    const d = curveJumpMarks(curve, models, VP)
    expect(d.map((m) => [m.x, m.y, m.closed])).toEqual([[0, -1, false], [0, 1, false], [0, 0, true]])
    expect(curveJumpMarks({ ...curve, visible: false }, models, VP)).toEqual([])
  })
})

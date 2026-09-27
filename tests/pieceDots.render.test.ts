// ============================================================================
// tests/pieceDots.render.test.ts — the filled and open dots of a piecewise
// graph (src/render/pieceDots.ts).
//
// The parser does not fill ModelSpec.pieces yet, so every model here is made
// by hand: a gated evaluator (NaN outside every piece, exactly as the parser's
// is) and the `pieces` list the contract describes.
//
// Claims:
//  1. Filled where a piece includes its end, open where it does not, at the
//     piece's OWN one-sided value — in every figure style, Screen included.
//  2. A jump gets an open ring at one piece's end and a filled dot at the
//     other's, each at its own y.
//  3. A continuous join draws nothing; an open end under a filled dot draws
//     only the filled dot; an unbounded side draws nothing.
//  4. No double drawing with the end caps (an outermost piece end is the
//     piece layer's; a cap the teacher NAMED wins) or with the holes.
//  5. Mono ink, present scaling, stretched boards.
//  6. Absent pieces: the board is the board it always was.
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
import {
  END_CLOSED_RING,
  END_DOT_R,
  END_OPEN_RING,
  curveEndPoints,
  resolveEnds,
} from '../src/render/endCaps'
import { oneSidedLimit, pieceMarks } from '../src/render/pieceDots'
import { MockCtx, MockPath2D, withMockPath2D, type Cmd } from './mockCanvas'
import { MODELS } from '../src/core/fit/models'
import { CURVE_COLORS, DARK_THEME, FIGURE_STYLES, toPrintColor } from '../src/core/types'
import type { FittedCurve, ModelSpec, PieceInfo, Viewport } from '../src/core/types'

// x in [-7.5, 7.5], y in [-5, 5]
const VP: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 900, heightPx: 600 }
const sx = (x: number, vp = VP): number =>
  vp.widthPx / 2 + (x - vp.center.x) * vp.pxPerUnit
const sy = (y: number, vp = VP): number =>
  vp.heightPx / 2 - (y - vp.center.y) * (vp.pxPerUnitY ?? vp.pxPerUnit)

// ---------------------------------------------------------------------------
// Hand-made piecewise models
// ---------------------------------------------------------------------------

interface Def extends PieceInfo { f: (x: number) => number }

const inside = (d: PieceInfo, x: number): boolean =>
  (x > d.lo || (d.loClosed && x === d.lo)) && (x < d.hi || (d.hiClosed && x === d.hi))

function piecewise(id: string, defs: Def[], withPieces = true): ModelSpec {
  const m: ModelSpec = {
    id,
    kind: 'explicit',
    name: id,
    evalExplicit: (_p, x) => {
      for (const d of defs) if (inside(d, x)) return d.f(x)
      return Number.NaN
    },
    latex: () => '',
    paramMeta: () => [],
  }
  if (withPieces) {
    m.pieces = () => defs.map(({ lo, hi, loClosed, hiClosed }) => ({ lo, hi, loClosed, hiClosed }))
  }
  return m
}

const INF = Number.POSITIVE_INFINITY

/** The header example: x²+1 (x<0); 3 (0≤x≤2); −x+5 (x>2). */
const THREE = piecewise('three', [
  { f: (x) => x * x + 1, lo: -INF, hi: 0, loClosed: false, hiClosed: false },
  { f: () => 3, lo: 0, hi: 2, loClosed: true, hiClosed: true },
  { f: (x) => -x + 5, lo: 2, hi: INF, loClosed: false, hiClosed: false },
])

/** ⌊x⌋ on [−3, 3): six steps [k, k+1). */
const FLOOR = piecewise(
  'floor',
  [-3, -2, -1, 0, 1, 2].map((k) => ({
    f: () => k, lo: k, hi: k + 1, loClosed: true, hiClosed: false,
  })),
)

/** 0.5x² − 1 restricted to [−2, 3): one piece, both ends on the board. */
const HALF = piecewise('half', [
  { f: (x) => 0.5 * x * x - 1, lo: -2, hi: 3, loClosed: true, hiClosed: false },
])

/** |x| as two pieces, joined continuously at 0 (closed on the right). */
const ABS = piecewise('abs', [
  { f: (x) => -x, lo: -INF, hi: 0, loClosed: false, hiClosed: false },
  { f: (x) => x, lo: 0, hi: INF, loClosed: true, hiClosed: false },
])

/** x (x<1), x + 0.03 (x≥1): a jump 1.8 px tall — the ring sits under the dot. */
const NUDGE = piecewise('nudge', [
  { f: (x) => x, lo: -INF, hi: 1, loClosed: false, hiClosed: false },
  { f: (x) => x + 0.03, lo: 1, hi: INF, loClosed: true, hiClosed: false },
])

/** x² everywhere but 1, and 4 at x = 1: a hole AND a lifted point. */
const LIFTED = piecewise('lifted', [
  { f: (x) => x * x, lo: -INF, hi: 1, loClosed: false, hiClosed: false },
  { f: () => 4, lo: 1, hi: 1, loClosed: true, hiClosed: true },
  { f: (x) => x * x, lo: 1, hi: INF, loClosed: false, hiClosed: false },
])

/** x (x<1), x (x>1): a hole at the join, both sides open. */
const PUNCTURED = piecewise('punctured', [
  { f: (x) => x, lo: -INF, hi: 1, loClosed: false, hiClosed: false },
  { f: (x) => x, lo: 1, hi: INF, loClosed: false, hiClosed: false },
])

/** ln x for x > 0, 1 for x ≤ 0: the ln side runs away at 0⁺ and gets no dot. */
const LOG = piecewise('logside', [
  { f: () => 1, lo: -INF, hi: 0, loClosed: false, hiClosed: true },
  { f: (x) => Math.log(x), lo: 0, hi: INF, loClosed: false, hiClosed: false },
])

const HAND: Record<string, ModelSpec> = {
  three: THREE, floor: FLOOR, half: HALF, abs: ABS, nudge: NUDGE,
  lifted: LIFTED, punctured: PUNCTURED, logside: LOG,
}
const MODELS_PW: Record<string, ModelSpec> = { ...MODELS, ...HAND }

function curve(modelId: string, over: Partial<FittedCurve> = {}): FittedCurve {
  return {
    id: 'c1', modelId, params: [], kind: 'explicit', domain: null,
    color: CURVE_COLORS[0], strokeWidth: 2.5, visible: true, error: 0,
    ...over,
  }
}

// ---------------------------------------------------------------------------
// A recording context that keeps each paint op with its arcs and style.
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

function scene(over: Partial<BoardScene> = {}): BoardScene {
  return {
    vp: VP, theme: DARK_THEME, curves: [curve('three')], styles: {}, models: MODELS_PW,
    analysis: null, chrome: null,
    ...over,
  }
}

function render(s: BoardScene): RecCtx {
  const ctx = new RecCtx()
  withMockPath2D(() => renderBoard(ctx as unknown as CanvasRenderingContext2D, s))
  return ctx
}

const snapshot = (c: RecCtx): string =>
  JSON.stringify({
    cmds: c.own.cmds, ops: c.ops, texts: c.texts, fills: c.fills,
    strokeStyles: c.strokeStyles, fillStyles: c.fillStyles,
    counts: [c.strokeCount, c.fillCount, c.textCount, c.saveCount, c.restoreCount],
    paths: c.strokedPaths.map((p) => p.cmds),
  })

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

const SCREEN_INK = CURVE_COLORS[0]
const inkOf = (id: 'textbook' | 'sat' | 'ap'): string => {
  const f = FIGURE_STYLES[id]
  return f.curveInk === 'mono' ? f.theme.axis : toPrintColor(CURVE_COLORS[0])
}

beforeEach(() => {
  core.holes = []
})

// ===========================================================================
// 1. Filled vs open, in every style
// ===========================================================================

describe('filled where a piece includes its end, open where it does not', () => {
  it('the header example: ○ (0, 1), ● (0, 3), nothing at the continuous (2, 3)', () => {
    const ctx = render(scene())
    const o = rings(ctx, SCREEN_INK, DARK_THEME.bg)
    const f = discs(ctx, SCREEN_INK, DARK_THEME.bg)
    expect(o).toHaveLength(1)
    expect(near(o[0], sx(0), sy(1))).toBe(true)
    expect(f).toHaveLength(1)
    expect(near(f[0], sx(0), sy(3))).toBe(true)
  })

  it('a half-open restriction: ● at the included end, ○ at the excluded one', () => {
    const ctx = render(scene({ curves: [curve('half')] }))
    const o = rings(ctx, SCREEN_INK, DARK_THEME.bg)
    const f = discs(ctx, SCREEN_INK, DARK_THEME.bg)
    expect(f.map((a) => [a.x, a.y])).toEqual([[sx(-2), sy(1)]])
    expect(o).toHaveLength(1)
    expect(near(o[0], sx(3), sy(3.5))).toBe(true)
  })

  it('every figure style draws them — Screen included', () => {
    for (const id of ['textbook', 'sat', 'ap'] as const) {
      const fig = FIGURE_STYLES[id]
      const ctx = render(scene({ figure: fig }))
      expect(rings(ctx, inkOf(id), fig.theme.bg), id).toHaveLength(1)
      expect(discs(ctx, inkOf(id), fig.theme.bg), id).toHaveLength(1)
    }
  })

  it('they export: drawn with chrome null, and not with the curve hidden', () => {
    expect(discs(render(scene({ chrome: null })), SCREEN_INK, DARK_THEME.bg)).toHaveLength(1)
    const hidden = render(scene({ curves: [curve('three', { visible: false })] }))
    expect(discs(hidden, SCREEN_INK, DARK_THEME.bg)).toHaveLength(0)
    expect(rings(hidden, SCREEN_INK, DARK_THEME.bg)).toHaveLength(0)
  })

  it('a faded curve fades its dots with it', () => {
    const ctx = render(scene({ styles: { c1: { opacity: 0.4 } } }))
    const i = ctx.ops.findIndex(
      (o) => o.kind === 'fill' && o.style === SCREEN_INK && o.arcs.length === 1,
    )
    expect(i).toBeGreaterThan(-1)
    expect(ctx.ops[i].alpha).toBeCloseTo(0.4, 9)
  })
})

// ===========================================================================
// 2. Jumps
// ===========================================================================

describe('a jump: open at one piece, filled at the other, each at its own y', () => {
  it('⌊x⌋ on [−3, 3): ● (k, k) and ○ (k, k − 1) at every step', () => {
    const ctx = render(scene({ curves: [curve('floor')] }))
    const o = rings(ctx, SCREEN_INK, DARK_THEME.bg)
    const f = discs(ctx, SCREEN_INK, DARK_THEME.bg)
    expect(f).toHaveLength(6)
    expect(o).toHaveLength(6)
    for (const k of [-3, -2, -1, 0, 1, 2]) {
      expect(f.some((a) => near(a, sx(k), sy(k))), `● at ${k}`).toBe(true)
    }
    for (const k of [-2, -1, 0, 1, 2, 3]) {
      expect(o.some((a) => near(a, sx(k), sy(k - 1))), `○ at ${k}`).toBe(true)
    }
  })

  it('rings go down before the filled dots, so a dot covers a ring', () => {
    const ctx = render(scene({ curves: [curve('floor')] }))
    const lastRing = ctx.ops.map((o) => o.kind === 'fill' && o.style === DARK_THEME.bg).lastIndexOf(true)
    const firstDisc = ctx.ops.findIndex(
      (o) => o.kind === 'fill' && o.style === SCREEN_INK && o.arcs.length === 1,
    )
    expect(firstDisc).toBeGreaterThan(lastRing)
  })

  it('a lifted point: ○ where the curve passes, ● where the value is', () => {
    const m = pieceMarks(curve('lifted'), MODELS_PW, VP)!
    expect(m.dots.map((d) => [d.closed, d.x, Math.round(d.y * 1e6) / 1e6])).toEqual([
      [false, 1, 1],
      [true, 1, 4],
    ])
  })
})

// ===========================================================================
// 3. Joins, coincidences, unbounded sides
// ===========================================================================

describe('what is not drawn', () => {
  it('a continuous join draws nothing extra', () => {
    const m = pieceMarks(curve('abs'), MODELS_PW, VP)!
    expect(m.dots).toEqual([])
    expect(m.joins).toHaveLength(1)
    const withJoin = render(scene({ curves: [curve('abs')] }))
    expect(discs(withJoin, SCREEN_INK, DARK_THEME.bg)).toHaveLength(0)
    expect(rings(withJoin, SCREEN_INK, DARK_THEME.bg)).toHaveLength(0)
  })

  it('both sides open at the join is a hole: ONE ring', () => {
    const m = pieceMarks(curve('punctured'), MODELS_PW, VP)!
    expect(m.dots).toHaveLength(1)
    expect(m.dots[0].closed).toBe(false)
    expect(m.dots[0].x).toBe(1)
    expect(m.dots[0].y).toBeCloseTo(1, 6)
  })

  it('an open end under a filled dot draws only the filled dot', () => {
    const ctx = render(scene({ curves: [curve('nudge')] }))
    expect(rings(ctx, SCREEN_INK, DARK_THEME.bg)).toHaveLength(0)
    const f = discs(ctx, SCREEN_INK, DARK_THEME.bg)
    expect(f).toHaveLength(1)
    expect(near(f[0], sx(1), sy(1.03))).toBe(true)
  })

  it('an unbounded side draws nothing, and a side that runs away draws nothing', () => {
    const m = pieceMarks(curve('logside'), MODELS_PW, VP)!
    // the constant piece's closed end at (0, 1); ln x at 0⁺ is a pole
    expect(m.dots.map((d) => [d.closed, d.x, d.y])).toEqual([[true, 0, 1]])
  })

  it('a piece end off the board is not drawn', () => {
    const far: Viewport = { ...VP, center: { x: 20, y: 0 } }
    expect(pieceMarks(curve('three'), MODELS_PW, far)!.dots).toEqual([])
  })

  it('an end outside the curve’s own domain is not drawn', () => {
    const m = pieceMarks(curve('floor', { domain: [-1, 1] }), MODELS_PW, VP)!
    expect(m.dots.every((d) => d.x >= -1 && d.x <= 1)).toBe(true)
  })
})

describe('the one-sided limit', () => {
  it('steps in and extrapolates: exact for a line, a pole is null', () => {
    expect(oneSidedLimit((x) => 2 * x + 1, 3, -1, INF, 60)).toBeCloseTo(7, 9)
    expect(oneSidedLimit((x) => x * x, 0, 1, INF, 60)).toBeCloseTo(0, 9)
    expect(oneSidedLimit((x) => 1 / x, 0, 1, INF, 60)).toBeNull()
    expect(oneSidedLimit(Math.log, 0, 1, INF, 60)).toBeNull()
    expect(oneSidedLimit(() => Number.NaN, 0, 1, INF, 60)).toBeNull()
  })
})

// ===========================================================================
// 4. End caps and holes
// ===========================================================================

describe('no double drawing with the end caps', () => {
  it('an outermost piece end is flagged, and an auto cap there says nothing', () => {
    const c = curve('half', { domain: [-2, 3] })
    const pts = curveEndPoints(c, MODELS_PW, VP)
    expect(pts.start?.piece).toBe(true)
    expect(pts.end?.piece).toBe(true)
    const r = resolveEnds({}, c, FIGURE_STYLES.sat, pts)
    expect([r.start, r.end]).toEqual(['none', 'none'])
  })

  it('in SAT, a half-open restriction is ONE ● and ONE ○ — the piece’s, not the domain’s ●●', () => {
    const fig = FIGURE_STYLES.sat
    const ctx = render(scene({ figure: fig, curves: [curve('half', { domain: [-2, 3] })] }))
    const f = discs(ctx, inkOf('sat'), fig.theme.bg)
    const o = rings(ctx, inkOf('sat'), fig.theme.bg)
    expect(f).toHaveLength(1)
    expect(near(f[0], sx(-2), sy(1))).toBe(true)
    expect(o).toHaveLength(1)
    expect(near(o[0], sx(3), sy(3.5))).toBe(true)
  })

  it('a cap the teacher NAMED wins, and no piece dot is stacked on it', () => {
    const fig = FIGURE_STYLES.sat
    const c = curve('half', { domain: [-2, 3] })
    const ctx = render(scene({ figure: fig, curves: [c], styles: { c1: { ends: { end: 'closed' } } } }))
    const f = discs(ctx, inkOf('sat'), fig.theme.bg)
    expect(f).toHaveLength(2) // the piece's ● at −2, the teacher's ● at 3
    expect(rings(ctx, inkOf('sat'), fig.theme.bg)).toHaveLength(0)
  })

  it('an ordinary curve’s ends carry no piece flag at all', () => {
    const c = curve('poly2', { params: [-1, 0, 0.5], domain: [-2, 3] })
    const pts = curveEndPoints(c, MODELS, VP)
    expect(pts.start).not.toHaveProperty('piece')
    expect(pts.end).not.toHaveProperty('piece')
  })
})

describe('no double drawing with the holes', () => {
  it('a hole at an open piece end is ringed once', () => {
    core.holes = [{ x: 3, y: 3.5, exact: true }]
    const ctx = render(scene({ curves: [curve('half')] }))
    expect(rings(ctx, SCREEN_INK, DARK_THEME.bg)).toHaveLength(1)
  })

  it('a hole under a filled piece dot is not ringed', () => {
    core.holes = [{ x: 0, y: 3, exact: true }]
    const ctx = render(scene())
    const o = rings(ctx, SCREEN_INK, DARK_THEME.bg)
    expect(o.some((a) => near(a, sx(0), sy(3)))).toBe(false)
  })

  it('a hole in the middle of a piece is still ringed', () => {
    core.holes = [{ x: -1, y: 2, exact: true }]
    const ctx = render(scene())
    const o = rings(ctx, SCREEN_INK, DARK_THEME.bg)
    expect(o).toHaveLength(2)
    expect(o.some((a) => near(a, sx(-1), sy(2)))).toBe(true)
  })
})

// ===========================================================================
// 5. Ink, scale, stretch
// ===========================================================================

describe('ink, presentation scale and stretched boards', () => {
  it('mono ink: SAT and AP dots are the axis black, not the curve colour', () => {
    for (const id of ['sat', 'ap'] as const) {
      const fig = FIGURE_STYLES[id]
      expect(fig.curveInk).toBe('mono')
      const ctx = render(scene({ figure: fig }))
      expect(discs(ctx, fig.theme.axis, fig.theme.bg)).toHaveLength(1)
      expect(rings(ctx, fig.theme.axis, fig.theme.bg)).toHaveLength(1)
    }
  })

  it('present.stroke scales the glyphs exactly as it scales the end caps', () => {
    const ctx = render(scene({ present: { type: 1, stroke: 2 } }))
    expect(discs(ctx, SCREEN_INK, DARK_THEME.bg, 2)).toHaveLength(1)
    expect(rings(ctx, SCREEN_INK, DARK_THEME.bg, 2)).toHaveLength(1)
    expect(discs(ctx, SCREEN_INK, DARK_THEME.bg, 1)).toHaveLength(0)
  })

  it('a stretched board puts each dot at its x by ppuX and its y by ppuY', () => {
    const vp: Viewport = { ...VP, pxPerUnitY: 25 }
    const ctx = render(scene({ vp }))
    const f = discs(ctx, SCREEN_INK, DARK_THEME.bg)
    const o = rings(ctx, SCREEN_INK, DARK_THEME.bg)
    expect(f).toHaveLength(1)
    expect(near(f[0], sx(0, vp), sy(3, vp))).toBe(true)
    expect(o).toHaveLength(1)
    expect(near(o[0], sx(0, vp), sy(1, vp))).toBe(true)
  })
})

// ===========================================================================
// 6. Absent pieces
// ===========================================================================

describe('absent pieces: the board it always was', () => {
  it('pieceMarks is null without pieces, with an empty list, or for a non-explicit curve', () => {
    const bare = piecewise('bare', [
      { f: (x) => x, lo: -INF, hi: 1, loClosed: false, hiClosed: false },
    ], false)
    const empty: ModelSpec = { ...bare, id: 'empty', pieces: () => [] }
    const models = { ...MODELS_PW, bare, empty }
    expect(pieceMarks(curve('bare'), models, VP)).toBeNull()
    expect(pieceMarks(curve('empty'), models, VP)).toBeNull()
    expect(pieceMarks(curve('three', { kind: 'parametric' }), models, VP)).toBeNull()
    expect(pieceMarks(curve('poly3', { params: [0, -3, 0, 1] }), MODELS, VP)).toBeNull()
  })

  it('the same gated formula without `pieces` draws the same stream as with an empty list', () => {
    const defs: Def[] = [
      { f: (x) => x * x + 1, lo: -INF, hi: 0, loClosed: false, hiClosed: false },
      { f: () => 3, lo: 0, hi: 2, loClosed: true, hiClosed: true },
    ]
    const bare = piecewise('g', defs, false)
    const empty: ModelSpec = { ...bare, pieces: () => [] }
    for (const fig of [undefined, FIGURE_STYLES.textbook, FIGURE_STYLES.sat]) {
      const a = render(scene({ figure: fig, curves: [curve('g')], models: { ...MODELS, g: bare } }))
      const b = render(scene({ figure: fig, curves: [curve('g')], models: { ...MODELS, g: empty } }))
      expect(snapshot(a)).toBe(snapshot(b))
    }
  })

  it('library curves in every style: no piece-layer save/restore, no extra arcs', () => {
    const lib = curve('poly2', { params: [-1, 0, 0.5], domain: [-2, 3] })
    for (const fig of [undefined, FIGURE_STYLES.screen, FIGURE_STYLES.sat]) {
      const a = render(scene({ figure: fig, curves: [lib], models: MODELS }))
      const b = render(scene({ figure: fig, curves: [lib], models: MODELS_PW }))
      expect(snapshot(a)).toBe(snapshot(b))
    }
  })
})

// ===========================================================================
// 7. With the jump-dot layer (src/render/jumpDots.ts)
// ===========================================================================

describe('piece dots and jump dots share the board without doubling', () => {
  it('⌊x⌋ as ONE piece [−3, 3): ends from this layer, inner steps from the jump layer', () => {
    const one = piecewise('onefloor', [
      { f: (x) => Math.floor(x), lo: -3, hi: 3, loClosed: true, hiClosed: false },
    ])
    const ctx = render(scene({ curves: [curve('onefloor')], models: { ...MODELS_PW, onefloor: one } }))
    const f = discs(ctx, SCREEN_INK, DARK_THEME.bg)
    const o = rings(ctx, SCREEN_INK, DARK_THEME.bg)
    expect(f).toHaveLength(6)
    expect(o).toHaveLength(6)
    for (const k of [-3, -2, -1, 0, 1, 2]) {
      expect(f.filter((a) => near(a, sx(k), sy(k))), `● at ${k}`).toHaveLength(1)
      expect(o.filter((a) => near(a, sx(k + 1), sy(k))), `○ at ${k + 1}`).toHaveLength(1)
    }
  })

  it('six ⌊x⌋ pieces: every step is a piece end, and the jump layer adds nothing', () => {
    const ctx = render(scene({ curves: [curve('floor')] }))
    expect(discs(ctx, SCREEN_INK, DARK_THEME.bg)).toHaveLength(6)
    expect(rings(ctx, SCREEN_INK, DARK_THEME.bg)).toHaveLength(6)
  })
})

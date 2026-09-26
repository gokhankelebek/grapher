// ============================================================================
// tests/curveJumps.test.ts — jumps are pen lifts, not vertical strokes
// (src/render/curves.ts).
//
// A finite jump — a piecewise function's step at a boundary, every riser of
// ⌊x⌋, sign(x), |x|/x — used to be joined by a near-vertical line, because the
// discontinuity probe only ran on gaps taller than twice the board. Two fixes,
// both asserted here:
//   (a) a model that states its pieces is sampled piece by piece, the pen
//       lifted at every piece end where the pieces do not meet;
//   (b) everything else goes through the jump probe, which breaks a gap that
//       HOLDS its height as the interval shrinks to 1e-9 of the span, and
//       joins one that shrinks with it — y = 50x, e^(10x), tan x short of its
//       poles stay single unbroken runs.
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { FittedCurve, ModelSpec, Viewport } from '../src/core/types'
import { parseExpression } from '../src/core/parse'
import { MODELS } from '../src/core/fit/models'
import { drawCurve, sampleExplicitPolylines, traceCurve, type CurveTrace } from '../src/render/curves'
import { MockCtx, withMockPath2D, type MockPath2D } from './mockCanvas'

type Ctx2D = Parameters<typeof drawCurve>[0]

// x in [-7.5, 7.5], y in [-5, 5]
const VP: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 900, heightPx: 600 }
// the same board nudged so that no base sample lands on x = 0 exactly
const VP_OFF: Viewport = { ...VP, center: { x: 0.013, y: 0 } }

function curveOf(modelId: string, params: number[], domain: [number, number] | null = null): FittedCurve {
  return {
    id: 'c', modelId, params, kind: 'explicit', domain,
    color: '#4f9cf9', strokeWidth: 2.5, visible: true, error: 0,
  }
}

function typed(src: string, domain: [number, number] | null = null): { curve: FittedCurve; models: Record<string, ModelSpec> } {
  const r = parseExpression(src)
  if (!r.ok) throw new Error(`expected "${src}" to parse, got: ${r.error}`)
  const spec = r.plot.makeModel('t')
  return { curve: curveOf('t', r.plot.defaultParams, domain ?? r.plot.domain), models: { t: spec } }
}

/** Runs of the trace with at least two samples (a one-sample run is an isolated point). */
function strokes(tr: CurveTrace): CurveTrace['runs'] {
  return tr.runs.filter((r) => r.length >= 2)
}

/**
 * The tallest near-vertical step inside any run: |dy| where |dx| < 0.5 px,
 * counting only steps taller than 1 px (a join sampled 1e-9 inside a piece
 * end is a 1e-7 px step, not a riser).
 */
function worstRiser(runs: { x: number; y: number }[][]): number {
  let worst = 0
  for (const run of runs) {
    for (let i = 1; i < run.length; i++) {
      const dx = Math.abs(run[i].x - run[i - 1].x)
      const dy = Math.abs(run[i].y - run[i - 1].y)
      if (dx < 0.5 && dy > 1 && dy > worst) worst = dy
    }
  }
  return worst
}

function pathFor(curve: FittedCurve, models: Record<string, ModelSpec>, vp: Viewport): MockPath2D | null {
  return withMockPath2D(() => {
    const ctx = new MockCtx()
    drawCurve(ctx as unknown as Ctx2D, curve, models, vp)
    return ctx.strokedPaths.length > 0 ? ctx.strokedPaths[ctx.strokedPaths.length - 1] : null
  })
}

const sx = (x: number, vp: Viewport = VP): number => vp.widthPx / 2 + (x - vp.center.x) * vp.pxPerUnit
const sy = (y: number, vp: Viewport = VP): number => vp.heightPx / 2 - (y - vp.center.y) * vp.pxPerUnit

// {x² + 1 if x < 0; 3 if 0 ≤ x ≤ 2; −x + 5 if x > 2}: a jump of 2 at x = 0,
// a continuous join at (2, 3).
const THREE = 'y = piecewise(x^2+1, x<0, 3, 0<=x<=2, -x+5, x>2)'

/** The same function hand-made, with its pieces stated and an UNGATED evaluator. */
const HAND: ModelSpec = {
  id: 'hand3',
  kind: 'explicit',
  name: 'Three pieces',
  evalExplicit: (_p, x) => (x < 0 ? x * x + 1 : x <= 2 ? 3 : -x + 5),
  pieces: () => [
    { lo: -Infinity, hi: 0, loClosed: false, hiClosed: false },
    { lo: 0, hi: 2, loClosed: true, hiClosed: true },
    { lo: 2, hi: Infinity, loClosed: false, hiClosed: false },
  ],
  latex: () => '',
  paramMeta: () => [],
}

// ---------------------------------------------------------------------------
// (a) stated pieces
// ---------------------------------------------------------------------------

describe('a piecewise curve is sampled piece by piece', () => {
  it('the parsed three-piece line: two runs, broken at the jump, no vertical stroke', () => {
    const { curve, models } = typed(THREE)
    const tr = traceCurve(curve, models, VP)!
    expect(tr.runs).toHaveLength(2)
    expect(worstRiser(tr.runs)).toBe(0)
    // the left run stops at (0⁻, 1); the right starts at (0, 3) and runs
    // through the continuous join at (2, 3) unbroken
    const [left, right] = tr.runs
    const l = left[left.length - 1]
    expect(l.x).toBeCloseTo(sx(0), 4)
    expect(l.y).toBeCloseTo(sy(1), 4)
    expect(right[0].x).toBeCloseTo(sx(0), 6)
    expect(right[0].y).toBeCloseTo(sy(3), 6)
    expect(right.some((s) => Math.abs(s.x - sx(2)) < 1e-6 && Math.abs(s.y - sy(3)) < 1e-4)).toBe(true)
  })

  it('a hand-made ModelSpec with pieces and an ungated evaluator draws the same', () => {
    const tr = traceCurve(curveOf('hand3', []), { hand3: HAND }, VP)!
    expect(tr.runs).toHaveLength(2)
    expect(worstRiser(tr.runs)).toBe(0)
    const left = tr.runs[0]
    // evaluated from INSIDE x < 0: 1, not the 3 the evaluator answers AT 0
    expect(left[left.length - 1].y).toBeCloseTo(sy(1), 4)
  })

  it('the stroked path has exactly two subpaths and no vertical segment', () => {
    for (const [c, m] of [
      [typed(THREE).curve, typed(THREE).models],
      [curveOf('hand3', []), { hand3: HAND }],
    ] as const) {
      const path = pathFor(c, m, VP)!
      const subs = path.subpaths()
      expect(subs).toHaveLength(2)
      expect(worstRiser(subs)).toBe(0)
    }
  })

  it('pieces that meet where NEITHER includes the point stay broken (a hole)', () => {
    const hole: ModelSpec = {
      ...HAND, id: 'hole',
      evalExplicit: (_p, x) => (x === 1 ? Number.NaN : x + 1),
      pieces: () => [
        { lo: -Infinity, hi: 1, loClosed: false, hiClosed: false },
        { lo: 1, hi: Infinity, loClosed: false, hiClosed: false },
      ],
    }
    const tr = traceCurve(curveOf('hole', []), { hole }, VP)!
    expect(tr.runs).toHaveLength(2)
  })

  it('a piece that stops on the board is still a natural (piece) end for the caps', () => {
    // 0.5x² − 1 on [−2, 3): sampled up to 3⁻ and reported AT t = 3
    const half: ModelSpec = {
      ...MODELS.poly2, id: 'halfpw',
      pieces: () => [{ lo: -2, hi: 3, loClosed: true, hiClosed: false }],
    }
    const tr = traceCurve(curveOf('halfpw', [-1, 0, 0.5], [-2, 3]), { halfpw: half }, VP)!
    expect(tr.runs).toHaveLength(1)
    const run = tr.runs[0]
    expect(run[0].t).toBe(-2)
    expect(run[run.length - 1].t).toBe(3)
    expect(run[run.length - 1].y).toBeCloseTo(sy(3.5), 4)
  })
})

// ---------------------------------------------------------------------------
// (b) the jump probe
// ---------------------------------------------------------------------------

describe('jumps without stated pieces are found by the probe', () => {
  it('floor(x) on [−3, 3]: six stroked runs, flat, no risers', () => {
    const { curve, models } = typed('y = floor(x)', [-3, 3])
    const tr = traceCurve(curve, models, VP)!
    const runs = strokes(tr)
    expect(runs).toHaveLength(6)
    expect(worstRiser(tr.runs)).toBe(0)
    // each run is one step: constant y
    for (const r of runs) {
      const ys = r.map((s) => s.y)
      expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1e-9)
    }
    // anything else is the isolated point f(3) = 3 at the closed domain end
    for (const r of tr.runs.filter((r) => r.length < 2)) {
      expect(r[0].t).toBe(3)
      expect(r[0].y).toBeCloseTo(sy(3), 6)
    }
    const path = pathFor(curve, models, VP)!
    expect(path.subpaths().filter((s) => s.length >= 2)).toHaveLength(6)
    expect(worstRiser(path.subpaths())).toBe(0)
  })

  it('floor(x) across the whole board breaks at every integer in view', () => {
    const { curve, models } = typed('y = floor(x)')
    const tr = traceCurve(curve, models, VP_OFF)!
    // x from −7.49 to 7.51 (plus the 8 px pad): risers at −7 … 7
    expect(strokes(tr)).toHaveLength(16)
    expect(worstRiser(tr.runs)).toBe(0)
  })

  for (const src of ['y = sign(x)', 'y = |x|/x']) {
    it(`${src}: two runs, no vertical stroke`, () => {
      for (const vp of [VP, VP_OFF]) {
        const { curve, models } = typed(src)
        const tr = traceCurve(curve, models, vp)!
        expect(strokes(tr), `${src} centre ${vp.center.x}`).toHaveLength(2)
        expect(worstRiser(tr.runs)).toBe(0)
      }
    })
  }

  it('x − floor(x) (sawtooth) and ceil(x): a break per riser', () => {
    const saw = typed('y = x - floor(x)', [-3, 3])
    expect(strokes(traceCurve(saw.curve, saw.models, VP)!)).toHaveLength(6)
    const ceil = typed('y = ceil(x)', [-3, 3])
    const tr = traceCurve(ceil.curve, ceil.models, VP)!
    expect(strokes(tr)).toHaveLength(6)
    expect(worstRiser(tr.runs)).toBe(0)
  })

  it('a jump on a stretched board, and a small one (5 px), still breaks', () => {
    const stretched: Viewport = { ...VP_OFF, pxPerUnitY: 6 } // 1 unit = 6 px tall
    const { curve, models } = typed('y = floor(x)', [-3, 3])
    expect(strokes(traceCurve(curve, models, stretched)!)).toHaveLength(6)
    const small = typed('y = x/10 + 0.041667 sign(x)') // jump of 0.0833 = 5 px
    const tr = traceCurve(small.curve, small.models, VP_OFF)!
    expect(strokes(tr)).toHaveLength(2)
    expect(worstRiser(tr.runs)).toBe(0)
  })

  it('the area overlay sampler breaks at the same jumps', () => {
    const lines = sampleExplicitPolylines((x) => Math.floor(x), VP_OFF, -3, 2.5)
    expect(lines).toHaveLength(6)
  })
})

describe('steep but continuous curves stay connected', () => {
  const single: [string, [number, number] | null][] = [
    ['y = 50x', null],
    ['y = 300x', null],
    ['y = e^(10x)', null],
    ['y = tan(x)', [-1.5, 1.5]],
    ['y = tan(x)', [1.6, 4.7]],
    ['y = x^(1/3)', null],
    ['y = 1/(x - 0.013)', [0.02, 7]],
  ]
  for (const [src, dom] of single) {
    it(`${src}${dom ? ` on [${dom}]` : ''}: one run`, () => {
      for (const vp of [VP, VP_OFF, { ...VP_OFF, pxPerUnitY: 600 }]) {
        const { curve, models } = typed(src, dom)
        const tr = traceCurve(curve, models, vp)!
        expect(tr.runs.length, `${src} @ ppuY ${vp.pxPerUnitY ?? 60}`).toBe(1)
      }
    })
  }

  it('a sketched steep line (library family) stays one stroke', () => {
    const path = pathFor(curveOf('line', [2, 80]), MODELS, VP)!
    expect(path.subpaths()).toHaveLength(1)
  })

  it('tan(x) over the whole board still breaks at its poles, and only there', () => {
    const { curve, models } = typed('y = tan(x)')
    // poles at ±π/2, ±3π/2 in view
    expect(traceCurve(curve, models, VP)!.runs).toHaveLength(5)
  })
})

describe('cost', () => {
  it('tracing floor(x) across the board costs well under a millisecond', () => {
    const { curve, models } = typed('y = floor(x)')
    const N = 50
    const t0 = performance.now()
    for (let i = 0; i < N; i++) traceCurve(curve, models, VP_OFF)
    const per = (performance.now() - t0) / N
    expect(per, `${per.toFixed(3)} ms per trace`).toBeLessThan(2)
  })
})

// ============================================================================
// tests/ode.test.ts — RK4 solution curves (src/core/ode.ts).
//
// Every accuracy test here is against a CLOSED FORM, because "the picture
// looks right" is exactly the failure mode a numerical integrator has. The
// three misbehaving AP classics (y^2 blow-up, -x/y vertical tangent, 1/x
// pole) get their own tests for stopping, not for accuracy.
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { Vec2 } from '../src/core/types'
import { solveField, sampleField } from '../src/core/ode'

/** Largest |y - exact(x)| over the returned path, restricted to x in [a, b]. */
function maxErr(pts: Vec2[], exact: (x: number) => number, a = -Infinity, b = Infinity): number {
  let worst = 0
  for (const p of pts) {
    if (p.x < a || p.x > b) continue
    const d = Math.abs(p.y - exact(p.x))
    if (d > worst) worst = d
  }
  return worst
}

/** The invariants the renderer relies on, checked on every path. */
function wellFormed(pts: Vec2[], through: Vec2): void {
  expect(pts.length).toBeGreaterThan(2)
  for (const p of pts) {
    expect(Number.isFinite(p.x)).toBe(true)
    expect(Number.isFinite(p.y)).toBe(true)
  }
  for (let i = 1; i < pts.length; i++) {
    expect(pts[i].x).toBeGreaterThan(pts[i - 1].x)
  }
  const hit = pts.find((p) => p.x === through.x && p.y === through.y)
  expect(hit, 'the through-point must be in the path').toBeDefined()
}

function span(pts: Vec2[]): [number, number] {
  return [pts[0].x, pts[pts.length - 1].x]
}

// ---------------------------------------------------------------------------
// Closed-form accuracy
// ---------------------------------------------------------------------------

describe('solveField — against closed forms', () => {
  it("y' = y through (0, 1) is e^x on [-2, 3]", () => {
    const through = { x: 0, y: 1 }
    const pts = solveField((_x, y) => y, through, [-2, 3])
    wellFormed(pts, through)
    const [lo, hi] = span(pts)
    expect(lo).toBeCloseTo(-2, 9)
    expect(hi).toBeCloseTo(3, 9)
    const e = maxErr(pts, Math.exp)
    expect(e, `max error ${e}`).toBeLessThan(1e-6)
  })

  it("y' = y(1 - y) through (0, 0.1) is the logistic 1/(1 + 9e^-x)", () => {
    const through = { x: 0, y: 0.1 }
    const pts = solveField((_x, y) => y * (1 - y), through, [-4, 8])
    wellFormed(pts, through)
    const e = maxErr(pts, (x) => 1 / (1 + 9 * Math.exp(-x)))
    expect(e, `max error ${e}`).toBeLessThan(1e-6)
    // the carrying capacity is approached, never overshot
    for (const p of pts) expect(p.y).toBeLessThan(1)
  })

  it("y' = x - y through (0, 0) is x - 1 + e^-x", () => {
    const through = { x: 0, y: 0 }
    const pts = solveField((x, y) => x - y, through, [-3, 4])
    wellFormed(pts, through)
    const e = maxErr(pts, (x) => x - 1 + Math.exp(-x))
    expect(e, `max error ${e}`).toBeLessThan(1e-6)
  })

  it("y' = 1/x through (1, 0) is ln|x| to the right of the pole", () => {
    const through = { x: 1, y: 0 }
    const pts = solveField((x) => 1 / x, through, [-3, 3])
    wellFormed(pts, through)
    const e = maxErr(pts, (x) => Math.log(Math.abs(x)), 0.05, 3)
    expect(e, `max error ${e}`).toBeLessThan(1e-6)
  })

  it('a constant field gives a horizontal line', () => {
    const through = { x: 0.5, y: 2 }
    const pts = solveField(() => 0, through, [-3, 3])
    wellFormed(pts, through)
    expect(maxErr(pts, () => 2)).toBe(0)
    expect(span(pts)[0]).toBeCloseTo(-3, 9)
    expect(span(pts)[1]).toBeCloseTo(3, 9)
  })

  it('a linear field gives a straight line, to the last bit', () => {
    const through = { x: 0, y: 1 }
    const pts = solveField(() => 3, through, [-2, 2])
    expect(maxErr(pts, (x) => 1 + 3 * x)).toBeLessThan(1e-12)
  })
})

// ---------------------------------------------------------------------------
// Stopping: blow-up, vertical tangent, pole
// ---------------------------------------------------------------------------

describe('solveField — stops instead of lying', () => {
  it("y' = -x/y through (0, 2) traces the upper half of x^2 + y^2 = 4", () => {
    const through = { x: 0, y: 2 }
    const pts = solveField((x, y) => -x / y, through, [-5, 5])
    wellFormed(pts, through)
    for (const p of pts) {
      expect(p.y, 'never crosses into the lower half-plane').toBeGreaterThan(0)
      expect(Math.abs(p.x), 'never leaves the circle').toBeLessThanOrEqual(2 + 1e-9)
    }
    const r = maxErr(pts, (x) => Math.sqrt(Math.max(0, 4 - x * x)))
    expect(r, `max radius error ${r}`).toBeLessThan(1e-5)
    // stops essentially at the vertical tangents, not short of them
    const [lo, hi] = span(pts)
    expect(lo).toBeLessThan(-1.999)
    expect(hi).toBeGreaterThan(1.999)
  })

  it("y' = y^2 through (0, 1) is 1/(1 - x) and stops before the asymptote", () => {
    const through = { x: 0, y: 1 }
    const pts = solveField((_x, y) => y * y, through, [-3, 3])
    wellFormed(pts, through)
    const [lo, hi] = span(pts)
    expect(lo).toBeCloseTo(-3, 6) // backward is tame: y -> 0
    expect(hi, 'forward must stop short of the asymptote').toBeLessThan(1)
    expect(hi, 'but should get close to it').toBeGreaterThan(0.99)
    for (const p of pts) {
      expect(p.y, 'no sprayed values').toBeLessThan(1e7)
      expect(p.y).toBeGreaterThan(0)
    }
    const e = maxErr(pts, (x) => 1 / (1 - x), -3, 0.9)
    expect(e, `max error ${e}`).toBeLessThan(1e-6)
  })

  it("y' = 1/x through (1, 0) stops at the pole going backward", () => {
    const pts = solveField((x) => 1 / x, { x: 1, y: 0 }, [-3, 3])
    for (const p of pts) {
      expect(p.x, 'never steps over x = 0').toBeGreaterThan(0)
    }
    const [lo, hi] = span(pts)
    expect(lo).toBeLessThan(0.01)
    expect(hi).toBeCloseTo(3, 6)
  })

  it('a field that is non-finite everywhere yields just the through-point', () => {
    const through = { x: 0, y: 0 }
    const pts = solveField(() => NaN, through, [-2, 2])
    expect(pts).toEqual([through])
  })

  it('never returns NaN, whatever the field does', () => {
    const fields: ((x: number, y: number) => number)[] = [
      (_x, y) => y * y * y,
      (x, y) => Math.tan(x) / y,
      (x, y) => 1 / (x * y),
      (x) => Math.log(x),
      (x, y) => Math.sqrt(-1 * x) + y,
      () => Infinity,
    ]
    for (const f of fields) {
      const pts = solveField(f, { x: 0.5, y: 0.5 }, [-4, 4])
      for (const p of pts) {
        expect(Number.isFinite(p.x), `x from ${f}`).toBe(true)
        expect(Number.isFinite(p.y), `y from ${f}`).toBe(true)
      }
      for (let i = 1; i < pts.length; i++) expect(pts[i].x).toBeGreaterThan(pts[i - 1].x)
    }
  })
})

// ---------------------------------------------------------------------------
// Mechanics: ordering, through-point, options
// ---------------------------------------------------------------------------

describe('solveField — mechanics', () => {
  it('a through-point at the left edge only marches forward', () => {
    const through = { x: -2, y: 1 }
    const pts = solveField((_x, y) => y, through, [-2, 2])
    expect(pts[0]).toEqual(through)
    expect(maxErr(pts, (x) => Math.exp(x + 2))).toBeLessThan(1e-6)
  })

  it('a through-point at the right edge only marches backward', () => {
    const through = { x: 2, y: 1 }
    const pts = solveField((_x, y) => y, through, [-2, 2])
    expect(pts[pts.length - 1]).toEqual(through)
  })

  it('a through-point outside the range still anchors the path', () => {
    const through = { x: 10, y: 1 }
    const pts = solveField(() => 0, through, [-2, 2])
    expect(pts[pts.length - 1]).toEqual(through)
    expect(pts[0].x).toBeCloseTo(-2, 9)
  })

  it('a reversed range is read as an interval, not a direction', () => {
    const a = solveField((_x, y) => y, { x: 0, y: 1 }, [3, -2])
    const b = solveField((_x, y) => y, { x: 0, y: 1 }, [-2, 3])
    expect(a.length).toBe(b.length)
    expect(span(a)[0]).toBeCloseTo(span(b)[0], 12)
  })

  it('a degenerate range gives just the through-point', () => {
    const through = { x: 1, y: 1 }
    expect(solveField((_x, y) => y, through, [2, 2])).toEqual([through])
  })

  it('a non-finite through-point gives nothing', () => {
    expect(solveField((_x, y) => y, { x: NaN, y: 1 }, [-1, 1])).toEqual([])
    expect(solveField((_x, y) => y, { x: 0, y: Infinity }, [-1, 1])).toEqual([])
  })

  it('maxSteps caps the work, and a loose tol shortens the path', () => {
    const tiny = solveField((_x, y) => y, { x: 0, y: 1 }, [-2, 3], { maxSteps: 20 })
    expect(tiny.length).toBeLessThan(30)
    for (const p of tiny) expect(Number.isFinite(p.y)).toBe(true)

    const loose = solveField((_x, y) => y, { x: 0, y: 1 }, [-2, 3], { tol: 1e-4 })
    const tight = solveField((_x, y) => y, { x: 0, y: 1 }, [-2, 3], { tol: 1e-12 })
    expect(loose.length).toBeLessThanOrEqual(tight.length)
    expect(maxErr(tight, Math.exp)).toBeLessThan(1e-7)
  })

  it('a wide range stays within the step budget', () => {
    const pts = solveField((x, y) => Math.sin(x) + 0.1 * y, { x: 0, y: 0 }, [-100, 100])
    expect(pts.length).toBeLessThan(20_001)
    for (let i = 1; i < pts.length; i++) expect(pts[i].x).toBeGreaterThan(pts[i - 1].x)
  })
})

// ---------------------------------------------------------------------------
// sampleField
// ---------------------------------------------------------------------------

describe('sampleField', () => {
  it('is row-major over ys, column-major-free over xs', () => {
    const xs = [0, 1, 2]
    const ys = [10, 20]
    const out = sampleField((x, y) => x + y, xs, ys)
    expect(out).toBeInstanceOf(Float64Array)
    expect(out.length).toBe(6)
    expect([...out]).toEqual([10, 11, 12, 20, 21, 22])
    for (let j = 0; j < ys.length; j++) {
      for (let i = 0; i < xs.length; i++) {
        expect(out[j * xs.length + i]).toBe(xs[i] + ys[j])
      }
    }
  })

  it('writes NaN where the slope is not finite', () => {
    const out = sampleField((x, y) => x / y, [1, 2], [0, 1])
    expect(Number.isNaN(out[0])).toBe(true)
    expect(Number.isNaN(out[1])).toBe(true)
    expect(out[2]).toBe(1)
    expect(out[3]).toBe(2)
  })

  it('handles an empty lattice', () => {
    expect(sampleField(() => 1, [], []).length).toBe(0)
    expect(sampleField(() => 1, [1, 2], []).length).toBe(0)
  })

  it('a 40x30 lattice is one allocation and 1200 evaluations', () => {
    const xs = Array.from({ length: 40 }, (_, i) => -5 + i * 0.25)
    const ys = Array.from({ length: 30 }, (_, j) => -4 + j * 0.25)
    let calls = 0
    const out = sampleField((x, y) => { calls++; return x - y }, xs, ys)
    expect(calls).toBe(1200)
    expect(out.length).toBe(1200)
    expect(out[0]).toBeCloseTo(-5 - -4, 12)
  })
})

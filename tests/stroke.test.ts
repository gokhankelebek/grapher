// ============================================================================
// Stroke preprocessing — endpoint fidelity.
//
// The ends of an open stroke are where the eye checks alignment: that is where
// the ink stops, so any gap between the drawn stroke and the fitted curve is
// visible there. These tests pin the property that used to be violated — the
// smoother must leave the endpoints as faithful to the drawn curve as the
// points beside them, without moving, shortening or extending the stroke.
// ============================================================================

import { describe, it, expect } from 'vitest'
import { processStroke } from '../src/core/stroke'
import { trace, explicitPath, polarPath, makeRng, VP } from './helpers'
import type { Vec2 } from '../src/core/types'

interface Shape { name: string; f: (x: number) => number; a: number; b: number }

const SHAPES: Shape[] = [
  { name: 'symmetric parabola', f: x => 0.5 * x * x - 2, a: -3, b: 3 },
  { name: 'wide parabola', f: x => 0.15 * x * x - 1, a: -4, b: 4 },
  { name: 'offset parabola', f: x => 0.4 * (x - 1) ** 2 - 2, a: -2, b: 4 },
  { name: 'steep parabola', f: x => 2 * x * x - 1, a: -1.5, b: 1.5 },
  { name: 'downward parabola', f: x => -0.6 * x * x + 2, a: -3, b: 3 },
  { name: 'line', f: x => 0.8 * x - 1, a: -4, b: 4 },
  { name: 'sine', f: x => 2 * Math.sin(x), a: -3, b: 3 },
  { name: 'gaussian', f: x => 3 * Math.exp(-x * x / 2) - 1, a: -3, b: 3 },
]

/**
 * Distance from p to the curve y=f(x), to first order. Perpendicular rather
 * than vertical on purpose: at a steep end, vertical distance mostly measures
 * the slope, which would make a well-behaved endpoint look bad and a flat one
 * look good. Perpendicular distance is comparable along the whole stroke.
 */
function perpErr(p: Vec2, f: (x: number) => number): number {
  const slope = (f(p.x + 1e-6) - f(p.x - 1e-6)) / 2e-6
  return Math.abs(p.y - f(p.x)) / Math.hypot(1, slope)
}

/**
 * Endpoint error against the error of the points just inboard of it. Those
 * neighbours share the endpoint's sampling density, so they are the fair
 * yardstick for the boundary estimator: a ratio near 1 means the ends are no
 * worse than the rest of the stroke.
 */
function endpointVsNeighbours(sh: Shape, seeds: number, jitter?: number) {
  let endErr = 0, endN = 0, nbrErr = 0, nbrN = 0
  for (let s = 0; s < seeds; s++) {
    const pts = processStroke(
      trace(explicitPath(sh.f), sh.a, sh.b, makeRng(4100 + s), jitter === undefined ? {} : { jitter }),
      VP,
    ).points
    const n = pts.length
    endErr += perpErr(pts[0], sh.f) + perpErr(pts[n - 1], sh.f)
    endN += 2
    for (let k = 3; k < 12; k++) {
      nbrErr += perpErr(pts[k], sh.f) + perpErr(pts[n - 1 - k], sh.f)
      nbrN += 2
    }
  }
  return { end: endErr / endN, neighbour: nbrErr / nbrN, ratio: (endErr / endN) / (nbrErr / nbrN) }
}

describe('processStroke — open endpoints', () => {
  // Before the boundary fix the smoother overwrote both ends with the raw ink
  // and padded the kernel by replicating them, so the endpoints kept ~100% of
  // the hand jitter while their neighbours kept ~45%: this ratio measured
  // 1.50–2.07 across these shapes. It now sits at 1.04–1.43.
  it('endpoints are no noisier than the points beside them', () => {
    const ratios: string[] = []
    for (const sh of SHAPES) {
      const m = endpointVsNeighbours(sh, 24)
      ratios.push(`${sh.name} ${m.ratio.toFixed(2)}`)
      expect(
        m.ratio,
        `${sh.name}: endpoint error ${m.end.toFixed(4)} vs neighbours ${m.neighbour.toFixed(4)} — ` +
        `the ends of the stroke are markedly worse than the rest of it (${ratios.join(', ')})`,
      ).toBeLessThan(1.6)
    }
  })

  it('endpoint error stays close to the interior across all shapes at once', () => {
    let end = 0, nbr = 0
    for (const sh of SHAPES) {
      const m = endpointVsNeighbours(sh, 24)
      end += m.end
      nbr += m.neighbour
    }
    // pooled: 1.79 before the fix, 1.22 after
    expect(end / nbr, 'pooled endpoint/neighbour error ratio').toBeLessThan(1.4)
  })

  // Guards the choice of a QUADRATIC local fit at the ends. A straight-line fit
  // cannot represent a curved end, so it flattens the last points — and an
  // artificially flattened end is exactly what makes recognition prefer a
  // sinusoid or a gaussian over a parabola. With jitter off, anything left is
  // the estimator's own bias.
  it('does not flatten a genuinely curved end', () => {
    for (const sh of SHAPES) {
      const m = endpointVsNeighbours(sh, 6, 0)
      expect(
        m.end,
        `${sh.name}: endpoint is displaced by ${m.end.toFixed(4)} on noise-free ink — ` +
        `the end smoother is bending the stroke, not just denoising it`,
      ).toBeLessThan(0.008)
    }
  })

  // The reason the old code pinned the raw endpoints at all was to keep the
  // drawn extent honest. Mirror padding — the other obvious boundary fix —
  // would drag each end inward along the tangent by about one sample. This
  // measures that displacement directly, with no ground truth needed.
  it('does not pull the ends inward (or push them outward)', () => {
    for (const sh of SHAPES) {
      let inward = 0, spacing = 0, count = 0
      for (let s = 0; s < 16; s++) {
        const raw = trace(explicitPath(sh.f), sh.a, sh.b, makeRng(4300 + s))
        const st = processStroke(raw, VP)
        const pts = st.points
        const n = pts.length
        const step = st.arcLength / (n - 1)
        // unit tangent pointing INTO the stroke at each end
        for (const [tip, next, rawTip] of [
          [pts[0], pts[3], raw[0]],
          [pts[n - 1], pts[n - 4], raw[raw.length - 1]],
        ] as [Vec2, Vec2, Vec2][]) {
          const d = Math.hypot(next.x - tip.x, next.y - tip.y)
          if (d < 1e-9) continue
          const ux = (next.x - tip.x) / d, uy = (next.y - tip.y) / d
          inward += (tip.x - rawTip.x) * ux + (tip.y - rawTip.y) * uy
          spacing += step
          count++
        }
      }
      const meanInward = inward / count
      const meanStep = spacing / count
      expect(
        Math.abs(meanInward) / meanStep,
        `${sh.name}: ends move ${(meanInward / meanStep).toFixed(2)} sample spacings inward on average — ` +
        `the stroke is being systematically shortened or extended`,
      ).toBeLessThan(0.35)
    }
  })
})

describe('processStroke — invariants the endpoint fix must not disturb', () => {
  it('closed strokes still wrap, and their seam is as clean as the rest', () => {
    let seam = 0, interior = 0, n = 0
    for (let s = 0; s < 12; s++) {
      const st = processStroke(
        trace(polarPath(() => 2), 0, 2 * Math.PI, makeRng(4400 + s)),
        VP,
      )
      expect(st.closed, 'a traced circle must still register as a closed stroke').toBe(true)
      const pts = st.points
      const r = (p: Vec2) => Math.abs(Math.hypot(p.x, p.y) - 2)
      seam += r(pts[0]) + r(pts[pts.length - 1])
      for (let k = 3; k < 12; k++) interior += r(pts[k]) + r(pts[pts.length - 1 - k])
      n++
    }
    // the wrap-around path is untouched by the open-end work; the seam should
    // still be indistinguishable from the rest of the ring
    expect(seam / (2 * n) / (interior / (18 * n))).toBeLessThan(1.6)
  })

  it('preserves closed / multiValuedX / bbox / arcLength semantics', () => {
    const open = processStroke(trace(explicitPath(x => 0.5 * x * x - 2), -3, 3, makeRng(7)), VP)
    expect(open.closed).toBe(false)
    expect(open.multiValuedX).toBe(false)
    expect(open.arcLength).toBeGreaterThan(0)
    expect(open.bbox.min.x).toBeLessThan(open.bbox.max.x)
    // bbox must actually bound the returned points
    for (const p of open.points) {
      expect(p.x).toBeGreaterThanOrEqual(open.bbox.min.x - 1e-9)
      expect(p.x).toBeLessThanOrEqual(open.bbox.max.x + 1e-9)
      expect(p.y).toBeGreaterThanOrEqual(open.bbox.min.y - 1e-9)
      expect(p.y).toBeLessThanOrEqual(open.bbox.max.y + 1e-9)
    }

    const vert = processStroke(
      Array.from({ length: 80 }, (_, i) => ({ x: 0.5, y: -2 + 4 * i / 79 })),
      VP,
    )
    expect(vert.multiValuedX, 'a vertical stroke still fails the vertical line test').toBe(true)
  })

  it('survives degenerate and very short strokes', () => {
    expect(() => processStroke([], VP)).not.toThrow()
    expect(processStroke([], VP).points).toHaveLength(0)
    expect(processStroke([{ x: 1, y: 1 }], VP).points).toHaveLength(1)

    // fewer points than the end-fit window, and fewer than the kernel needs
    for (const count of [2, 3, 5, 9, 17]) {
      const pts = Array.from({ length: count }, (_, i) => ({ x: i * 0.3, y: i * 0.3 }))
      const st = processStroke(pts, VP)
      expect(st.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)),
        `stroke of ${count} points produced a non-finite coordinate`).toBe(true)
      expect(st.points.length).toBeGreaterThan(0)
    }

    // every point identical — zero arc length, must not divide by zero
    const same = processStroke(Array.from({ length: 40 }, () => ({ x: 2, y: 2 })), VP)
    expect(same.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)

    // non-finite input coordinates are filtered, not propagated
    const dirty = processStroke(
      [{ x: 0, y: 0 }, { x: NaN, y: 1 }, { x: 1, y: Infinity }, { x: 2, y: 1 }, { x: 3, y: 2 }],
      VP,
    )
    expect(dirty.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
  })
})

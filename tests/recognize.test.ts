// ============================================================================
// tests/recognize.test.ts — the crown jewels.
//
// Every stroke here is synthesized the way a human draws: ground-truth curve
// + seeded Gaussian hand jitter (~0.03 math units) + whole-pixel quantization
// through a 1200x800 / 60-px-per-unit viewport, then processStroke().
// Assertions cover the winning family, recovered parameters, the reported
// sigma, and degenerate input safety.
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { FitResult, Vec2 } from '../src/core/types'
import { processStroke } from '../src/core/stroke'
import { fitQuality, recognize } from '../src/core/fit/recognize'
import { MODELS } from '../src/core/fit/models'
import {
  VP, JITTER, makeRng, makeGauss, trace, drawStroke, drawAndRecognize,
  explicitPath, polarPath, winner, candidate, ranking, relErr,
} from './helpers'

/** Assert the top-ranked family, printing the whole ranking when it fails. */
function expectWinner(results: FitResult[], modelId: string): FitResult {
  const w = winner(results)
  expect(w.modelId, `expected "${modelId}" to win; ranking: ${ranking(results)}`).toBe(modelId)
  return w
}

// ---------------------------------------------------------------------------
// Ground-truth shapes. Each entry is drawn with a fixed seed so the suite is
// bit-for-bit reproducible.
// ---------------------------------------------------------------------------

describe('recognize — explicit families', () => {
  it('a hand-drawn sinusoid is a sinusoid, with frequency/amplitude within 10%', () => {
    const A = 1.5
    const B = 1.2
    const D = 0.4
    const res = drawAndRecognize(
      explicitPath(x => A * Math.sin(B * x) + D), -7, 7, makeRng(1001),
    )
    const w = expectWinner(res, 'sine')
    expect(w.kind).toBe('explicit')
    // params: [a, b, c, d] -> a·sin(bx + c) + d
    expect(relErr(Math.abs(w.params[0]), A)).toBeLessThan(0.1)
    expect(relErr(Math.abs(w.params[1]), B)).toBeLessThan(0.1)
    expect(Math.abs(w.params[3] - D)).toBeLessThan(0.1)
    expect(w.error).toBeLessThan(3 * JITTER)
  })

  it('a wobbly straight line is a LINE, not a cubic or quartic', () => {
    const res = drawAndRecognize(explicitPath(x => 0.8 * x - 1), -6, 6, makeRng(1002))
    const w = expectWinner(res, 'line')
    // params ascending: [b, m] -> y = m x + b
    expect(relErr(w.params[1], 0.8)).toBeLessThan(0.05)
    expect(Math.abs(w.params[0] + 1)).toBeLessThan(0.1)

    // the explicit guarantee the penalty table exists to provide
    const poly3 = candidate(res, 'poly3')!
    const poly4 = candidate(res, 'poly4')!
    expect(w.score).toBeLessThan(poly3.score)
    expect(w.score).toBeLessThan(poly4.score)
  })

  it('a parabola is a parabola and always outranks the higher-degree polys', () => {
    const res = drawAndRecognize(explicitPath(x => 0.4 * x * x - 1), -5, 5, makeRng(1003))
    const w = expectWinner(res, 'poly2')
    // ascending coefficients [c0, c1, c2]
    expect(relErr(w.params[2], 0.4)).toBeLessThan(0.1)
    expect(Math.abs(w.params[0] + 1)).toBeLessThan(0.15)
    expect(w.score).toBeLessThan(candidate(res, 'poly3')!.score)
    expect(w.score).toBeLessThan(candidate(res, 'poly4')!.score)
  })

  it('poly2 is a top-2 candidate for every parabola shape and seed', () => {
    // NOTE: poly2's *win* over sine is decided by a hair (see the
    // "known scoring weakness" test below), so the robust, seed-independent
    // invariant is top-2 membership. This catches any real polyfit regression.
    const shapes: Array<(x: number) => number> = [
      x => 0.4 * x * x - 1,
      x => 0.15 * x * x - 2,
      x => 1.0 * x * x - 4,
      x => 0.5 * (x - 1) * (x - 1) - 3,
      x => -0.5 * x * x + 3,
    ]
    const spans: Array<[number, number]> = [[-5, 5], [-6, 6], [-3, 3], [-2, 5], [-4, 4]]
    for (let i = 0; i < shapes.length; i++) {
      for (let seed = 1; seed <= 6; seed++) {
        const res = drawAndRecognize(
          explicitPath(shapes[i]), spans[i][0], spans[i][1], makeRng(seed * 7919 + 3),
        )
        const ids = res.slice(0, 2).map(r => r.modelId)
        expect(ids, `shape ${i} seed ${seed}: ${ranking(res.slice(0, 3))}`).toContain('poly2')
      }
    }
  })

  it('a cubic S-curve is a cubic', () => {
    const res = drawAndRecognize(
      explicitPath(x => 0.05 * x * x * x - 0.3 * x + 0.5), -6, 6, makeRng(1004),
    )
    const w = expectWinner(res, 'poly3')
    expect(relErr(w.params[3], 0.05)).toBeLessThan(0.12)
    expect(w.score).toBeLessThan(candidate(res, 'line')!.score)
    expect(w.score).toBeLessThan(candidate(res, 'poly4')!.score)
  })

  it('a bump is a Gaussian, with peak position and width recovered', () => {
    const res = drawAndRecognize(
      explicitPath(x => 3 * Math.exp(-Math.pow((x - 0.5) / 1.2, 2)) - 1), -6, 7, makeRng(1005),
    )
    const w = expectWinner(res, 'gauss')
    // params [a, b, c, d] -> a·exp(-((x-b)/c)^2) + d
    expect(relErr(w.params[0], 3)).toBeLessThan(0.1)
    expect(Math.abs(w.params[1] - 0.5)).toBeLessThan(0.1)
    expect(relErr(Math.abs(w.params[2]), 1.2)).toBeLessThan(0.1)
    expect(Math.abs(w.params[3] + 1)).toBeLessThan(0.15)
  })

  it('a V shape is an absolute value, with the kink located', () => {
    const res = drawAndRecognize(
      explicitPath(x => 1.2 * Math.abs(x - 0.7) - 2), -5, 6, makeRng(1006),
    )
    const w = expectWinner(res, 'abs')
    // params [a, b, c] -> a·|x-b| + c
    expect(relErr(Math.abs(w.params[0]), 1.2)).toBeLessThan(0.1)
    expect(Math.abs(w.params[1] - 0.7)).toBeLessThan(0.15)
    expect(Math.abs(w.params[2] + 2)).toBeLessThan(0.15)
  })

  it('an S-curve that saturates is a logistic', () => {
    const res = drawAndRecognize(
      explicitPath(x => 4 / (1 + Math.exp(-1.8 * (x - 0.5))) - 2), -6, 7, makeRng(1007),
    )
    const w = expectWinner(res, 'logistic')
    // params [a, b, c, d] -> a/(1+exp(-b(x-c))) + d
    expect(relErr(w.params[0], 4)).toBeLessThan(0.1)
    expect(relErr(w.params[1], 1.8)).toBeLessThan(0.15)
    expect(Math.abs(w.params[2] - 0.5)).toBeLessThan(0.15)
  })

  it('a growing exponential is an exponential', () => {
    const res = drawAndRecognize(
      explicitPath(x => 0.4 * Math.exp(0.6 * x) - 1), -6, 4, makeRng(1008),
    )
    const w = expectWinner(res, 'exp')
    // params [a, b, c] -> a·exp(bx) + c
    expect(relErr(w.params[0], 0.4)).toBeLessThan(0.15)
    expect(relErr(w.params[1], 0.6)).toBeLessThan(0.1)
    expect(w.score).toBeLessThan(candidate(res, 'logistic')!.score)
  })

  it('a decaying exponential is an exponential with a negative rate', () => {
    const res = drawAndRecognize(
      explicitPath(x => 3 * Math.exp(-0.8 * x) + 0.5), -0.5, 6, makeRng(1009),
    )
    const w = expectWinner(res, 'exp')
    expect(w.params[1]).toBeLessThan(0)
    expect(relErr(Math.abs(w.params[1]), 0.8)).toBeLessThan(0.15)
    expect(relErr(w.params[0], 3)).toBeLessThan(0.15)
  })
})

describe('recognize — closed / conic families', () => {
  it('a hand-drawn circle is a circle, center and radius within 5%', () => {
    const R = 2.5
    const res = drawAndRecognize(polarPath(() => R), 0, 2 * Math.PI, makeRng(2001))
    const w = expectWinner(res, 'circle')
    expect(w.kind).toBe('implicit')
    // params [a, b, r]
    expect(Math.abs(w.params[0])).toBeLessThan(0.05 * R)
    expect(Math.abs(w.params[1])).toBeLessThan(0.05 * R)
    expect(relErr(w.params[2], R)).toBeLessThan(0.05)
    // a circle must beat the 5-parameter general conic
    expect(w.score).toBeLessThan(candidate(res, 'ellipse')!.score)
  })

  it('a rotated ellipse is an ellipse (and beats the circle)', () => {
    const rx = 3, ry = 1.4, rot = 0.6
    const res = drawAndRecognize(
      (t: number): Vec2 => {
        const u = rx * Math.cos(t), v = ry * Math.sin(t)
        return { x: u * Math.cos(rot) - v * Math.sin(rot), y: u * Math.sin(rot) + v * Math.cos(rot) }
      },
      0, 2 * Math.PI, makeRng(2002),
    )
    const w = expectWinner(res, 'ellipse')
    expect(w.score).toBeLessThan(candidate(res, 'circle')!.score)
    // [A, B, C, D, E, F] must describe a real ellipse
    const [A, B, C] = w.params
    expect(B * B - 4 * A * C).toBeLessThan(0)
    expect(w.params.every(Number.isFinite)).toBe(true)
  })

  it('a heart blob falls back to a Fourier curve, not a conic', () => {
    const s = 0.18
    const res = drawAndRecognize(
      (t: number): Vec2 => ({
        x: s * 16 * Math.pow(Math.sin(t), 3),
        y: s * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)),
      }),
      0, 2 * Math.PI, makeRng(2003),
    )
    const w = expectWinner(res, 'fourier')
    expect(w.kind).toBe('parametric')
    expect(w.domain).toEqual([0, 2 * Math.PI])
    // enough harmonics to actually describe a heart: [cx, cy] + 4 per harmonic
    expect((w.params.length - 2) / 4).toBeGreaterThanOrEqual(3)
    expect(w.score).toBeLessThan(candidate(res, 'circle')!.score)
    expect(w.score).toBeLessThan(candidate(res, 'ellipse')!.score)
  })
})

describe('recognize — polar families', () => {
  /** A circle drawn under identical jitter: the empirical sigma noise floor. */
  function noiseFloor(seed: number): number {
    const res = drawAndRecognize(polarPath(() => 2.5), 0, 2 * Math.PI, makeRng(seed))
    return candidate(res, 'circle')!.error
  }

  // A hand traces a rose petal-by-petal: the pen sweeps out and back through
  // the origin. For odd k that is theta in [0, pi]; k = 2 gives four petals
  // over a full turn. Each is drawn at an arbitrary rotation.
  const roses: Array<[string, number, number, number]> = [
    ['3-petal', 3, Math.PI, 0.7],
    ['4-petal', 2, 2 * Math.PI, 0.5],
    ['5-petal', 5, Math.PI, 0.4],
  ]

  for (const [label, k, span, rot] of roses) {
    it(`a ${label} rose drawn through the origin at a rotation beats Fourier`, () => {
      const A = 3
      const seed = 3000 + k
      const res = drawAndRecognize(
        polarPath(t => A * Math.cos(k * t + rot)), 0, span, makeRng(seed),
      )
      const w = expectWinner(res, 'polarRose')
      expect(w.kind).toBe('polar')
      // params [a, k, c]; petal count is integral
      expect(Math.round(w.params[1])).toBe(k)
      expect(relErr(Math.abs(w.params[0]), A)).toBeLessThan(0.1)
      // rendered curve must match the ink: a·cos(kθ+c) reproduces the tips
      for (let i = 0; i < 8; i++) {
        const t = (i * span) / 8
        const truth = A * Math.cos(k * t + rot)
        const got = w.params[0] * Math.cos(Math.round(w.params[1]) * t + w.params[2])
        expect(Math.abs(Math.abs(got) - Math.abs(truth))).toBeLessThan(0.25)
      }
      // it must actually outrank the universal Fourier fallback
      const four = candidate(res, 'fourier')
      expect(four, `no fourier candidate; ${ranking(res)}`).toBeDefined()
      expect(w.score).toBeLessThan(four!.score)

      // REGRESSION GUARD (Huber IRLS + geometric sigma): the reported error
      // must sit at the injected noise floor, NOT at the radial-residual
      // overestimate near petal boundaries (which ran ~0.5-1.0 math units).
      const floor = noiseFloor(seed)
      expect(w.error, `rose sigma ${w.error} vs circle noise floor ${floor}`)
        .toBeLessThan(2 * floor)
      expect(w.error).toBeLessThan(2 * JITTER)
    })
  }

  it('an inner-loop limacon is a limacon', () => {
    // r = 1 + 2cos(theta): |a| < |b|, so the curve loops through the origin
    const res = drawAndRecognize(
      polarPath(t => 1 + 2 * Math.cos(t)), 0, 2 * Math.PI, makeRng(3100),
    )
    const w = expectWinner(res, 'limacon')
    expect(relErr(Math.abs(w.params[0]), 1)).toBeLessThan(0.15)
    expect(relErr(Math.abs(w.params[1]), 2)).toBeLessThan(0.15)
    expect(Math.abs(w.params[0])).toBeLessThan(Math.abs(w.params[1])) // inner loop
    expect(w.score).toBeLessThan(candidate(res, 'fourier')!.score)
  })

  it('a cardioid is a limacon with |a| = |b|', () => {
    const res = drawAndRecognize(
      polarPath(t => 1.8 * (1 + Math.cos(t))), 0, 2 * Math.PI, makeRng(3101),
    )
    const w = expectWinner(res, 'limacon')
    expect(relErr(Math.abs(w.params[0]), 1.8)).toBeLessThan(0.1)
    expect(relErr(Math.abs(w.params[1]), 1.8)).toBeLessThan(0.1)
    expect(relErr(Math.abs(w.params[1]), Math.abs(w.params[0]))).toBeLessThan(0.1)
    expect(w.score).toBeLessThan(candidate(res, 'circle')!.score)
  })

  it('an Archimedean spiral is a spiral', () => {
    const res = drawAndRecognize(
      polarPath(t => 0.25 + 0.33 * t), 0, 4 * Math.PI, makeRng(3102),
    )
    const w = expectWinner(res, 'spiral')
    expect(w.kind).toBe('polar')
    // params [a, b] -> r = a + b·theta
    expect(relErr(w.params[1], 0.33)).toBeLessThan(0.1)
    expect(Math.abs(w.params[0] - 0.25)).toBeLessThan(0.15)
    expect(w.domain).not.toBeNull()
    expect(w.domain![1] - w.domain![0]).toBeGreaterThan(3 * Math.PI)
  })
})

describe('recognize — degenerate / vertical strokes', () => {
  it('a near-vertical stroke is x = a', () => {
    const res = drawAndRecognize((t: number): Vec2 => ({ x: 2, y: t }), -4, 4, makeRng(4001))
    const w = expectWinner(res, 'vline')
    expect(w.kind).toBe('parametric')
    expect(Math.abs(w.params[0] - 2)).toBeLessThan(0.05)
    expect(w.domain).not.toBeNull()
    expect(w.domain![0]).toBeLessThan(-3.9)
    expect(w.domain![1]).toBeGreaterThan(3.9)
  })

  /** Every candidate must be structurally sound, whatever the input. */
  function expectSane(res: FitResult[]): void {
    expect(Array.isArray(res)).toBe(true)
    for (const c of res) {
      expect(c.params.every(Number.isFinite), `${c.modelId} params ${c.params}`).toBe(true)
      expect(Number.isFinite(c.error), `${c.modelId} error ${c.error}`).toBe(true)
      expect(Number.isFinite(c.score), `${c.modelId} score ${c.score}`).toBe(true)
      expect(c.params.length).toBeGreaterThan(0)
      if (c.domain) {
        expect(Number.isFinite(c.domain[0])).toBe(true)
        expect(Number.isFinite(c.domain[1])).toBe(true)
      }
    }
    // results are sorted best-first
    for (let i = 1; i < res.length; i++) {
      expect(res[i].score).toBeGreaterThanOrEqual(res[i - 1].score)
    }
  }

  it('a single point does not throw', () => {
    const stroke = processStroke([{ x: 1, y: 1 }], VP)
    expect(stroke.points.length).toBeLessThanOrEqual(1)
    expect(() => recognize(stroke, VP)).not.toThrow()
    expectSane(recognize(stroke, VP))
  })

  it('two points do not throw', () => {
    const stroke = processStroke([{ x: -1, y: 0.5 }, { x: 2, y: -0.25 }], VP)
    expect(() => recognize(stroke, VP)).not.toThrow()
    expectSane(recognize(stroke, VP))
  })

  it('a tiny 3-pixel scribble does not throw', () => {
    const rng = makeRng(4002)
    const gauss = makeGauss(rng)
    const px = 1 / VP.pxPerUnit
    const raw: Vec2[] = []
    for (let i = 0; i < 12; i++) {
      raw.push({ x: 1 + 3 * px * gauss(), y: -0.5 + 3 * px * gauss() })
    }
    const stroke = processStroke(raw, VP)
    expect(() => recognize(stroke, VP)).not.toThrow()
    expectSane(recognize(stroke, VP))
  })

  it('a 2000-point slow stroke does not throw and still recognizes the shape', () => {
    const res = drawAndRecognize(
      explicitPath(x => 0.8 * x - 1), -6, 6, makeRng(4003), { n: 2000 },
    )
    expectSane(res)
    expect(winner(res).modelId).toBe('line')
  })

  it('a garbage self-intersecting scribble does not throw and yields finite candidates', () => {
    const rng = makeRng(4004)
    const gauss = makeGauss(rng)
    // a chaotic loop-de-loop: three incommensurate frequencies + heavy noise
    const raw = trace(
      (t: number): Vec2 => ({
        x: 2.4 * Math.cos(t) + 1.3 * Math.cos(3.7 * t) + 0.8 * Math.sin(6.1 * t),
        y: 2.1 * Math.sin(1.3 * t) - 1.4 * Math.cos(2.9 * t) + 0.9 * Math.sin(5.3 * t),
      }),
      0, 9 * Math.PI, rng, { n: 400, jitter: 0.12 },
    )
    for (const p of raw) { p.x += 0.05 * gauss(); p.y += 0.05 * gauss() }
    const stroke = processStroke(raw, VP)
    expect(() => recognize(stroke, VP)).not.toThrow()
    const res = recognize(stroke, VP)
    expectSane(res)
    expect(res.length).toBeGreaterThan(0)
  })

  it('processStroke flags closedness and the vertical line test correctly', () => {
    const circle = drawStroke(polarPath(() => 2.5), 0, 2 * Math.PI, makeRng(4005))
    expect(circle.closed).toBe(true)
    expect(circle.multiValuedX).toBe(true)
    expect(circle.arcLength).toBeGreaterThan(0)

    const line = drawStroke(explicitPath(x => 0.8 * x - 1), -6, 6, makeRng(4006))
    expect(line.closed).toBe(false)
    expect(line.multiValuedX).toBe(false)
    expect(line.points.length).toBeGreaterThan(8)
    expect(line.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
  })
})

describe('recognize — parabola vs sinusoid scoring margin', () => {
  // Regression guard. poly2 used to carry penalty weight 4 against sine's 3,
  // which made their complexity terms tie exactly (2*3*4 == 2*4*3 == 24) and
  // left hand jitter to decide every parabola — a sine hump tracks a parabolic
  // arc to well within it, so sinusoids stole ~40% of them. poly2 now sits at
  // weight 3 (a parabola is as canonical as a line or a sine) and wins on its
  // lower parameter count. These tests fail if that prior drifts back.

  it('a parabola beats a sinusoid by a comfortable margin', () => {
    const res = drawAndRecognize(explicitPath(x => 0.4 * x * x - 1), -5, 5, makeRng(1003))
    const p2 = candidate(res, 'poly2')!
    const sn = candidate(res, 'sine')!
    expect(p2.score).toBeLessThan(sn.score)
    expect(sn.score - p2.score).toBeGreaterThan(5)
  })

  it('parabolas win across shapes and seeds, not just favourable ones', () => {
    const shapes: Array<[(x: number) => number, number, number]> = [
      [x => 0.4 * x * x - 1, -5, 5],
      [x => 0.5 * x * x - 2, -3, 3],
      [x => -0.3 * x * x + 2, -4, 4],
      [x => 0.25 * x * x + 0.5 * x, -5, 3],
      [x => -0.6 * x * x + x + 1, -2, 3.5],
    ]
    let wins = 0
    let total = 0
    for (const [f, a, b] of shapes) {
      for (let i = 0; i < 12; i++) {
        total++
        if (winner(drawAndRecognize(explicitPath(f), a, b, makeRng(1000 + i * 7))).modelId === 'poly2') {
          wins++
        }
      }
    }
    expect(wins).toBe(total)
  })
})

// ---------------------------------------------------------------------------
// Root families. Before these existed a hand-drawn sqrt came back `exp` and a
// cube root came back `logistic`, both at 5-15x the noise floor.
// ---------------------------------------------------------------------------

describe('recognize — root families', () => {
  it('a hand-drawn square root is a sqrt, not an exponential', () => {
    const res = drawAndRecognize(explicitPath(x => Math.sqrt(x)), 0, 9, makeRng(4242))
    const w = expectWinner(res, 'sqrt')
    // params [a, b, c] -> a·sqrt(x - b) + c
    expect(relErr(w.params[0], 1)).toBeLessThan(0.15)
    expect(Math.abs(w.params[1])).toBeLessThan(0.35)  // branch point at the origin
    expect(Math.abs(w.params[2])).toBeLessThan(0.35)
    expect(w.error).toBeLessThan(2 * JITTER)
    expect(w.score).toBeLessThan(candidate(res, 'exp')!.score)
  })

  it('a scaled square root recovers its amplitude', () => {
    const res = drawAndRecognize(explicitPath(x => 2 * Math.sqrt(x)), 0, 9, makeRng(4243))
    const w = expectWinner(res, 'sqrt')
    expect(relErr(w.params[0], 2)).toBeLessThan(0.15)
    expect(w.error).toBeLessThan(2 * JITTER)
  })

  it('a shifted square root locates its branch point', () => {
    const res = drawAndRecognize(
      explicitPath(x => Math.sqrt(x - 1) + 0.5), 1, 9, makeRng(4244),
    )
    const w = expectWinner(res, 'sqrt')
    expect(Math.abs(w.params[1] - 1)).toBeLessThan(0.4)
    expect(w.error).toBeLessThan(2 * JITTER)
  })

  it('a downward square root is a sqrt with a negative coefficient', () => {
    const res = drawAndRecognize(explicitPath(x => -Math.sqrt(x)), 0, 9, makeRng(4245))
    const w = expectWinner(res, 'sqrt')
    expect(w.params[0]).toBeLessThan(0)
    expect(relErr(Math.abs(w.params[0]), 1)).toBeLessThan(0.15)
  })

  it('the sqrt domain starts at the branch point, so nothing is drawn left of it', () => {
    const res = drawAndRecognize(
      explicitPath(x => Math.sqrt(x - 1) + 0.5), 1, 9, makeRng(4246),
    )
    const w = expectWinner(res, 'sqrt')
    expect(w.domain, 'sqrt must carry a domain').not.toBeNull()
    expect(w.domain![0]).toBeCloseTo(w.params[1], 9)
    expect(w.domain![1]).toBeGreaterThan(w.domain![0])
    // and the model is genuinely undefined just left of it
    const ev = MODELS.sqrt.evalExplicit!(w.params, w.domain![0] - 0.5)
    expect(Number.isFinite(ev)).toBe(false)
  })

  it('a hand-drawn cube root is a cbrt, not a logistic', () => {
    const res = drawAndRecognize(explicitPath(x => Math.cbrt(x)), -8, 8, makeRng(4247))
    const w = expectWinner(res, 'cbrt')
    expect(relErr(w.params[0], 1)).toBeLessThan(0.2)
    expect(Math.abs(w.params[1])).toBeLessThan(0.5) // inflection at the origin
    expect(w.error).toBeLessThan(2 * JITTER)
    expect(w.score).toBeLessThan(candidate(res, 'logistic')!.score)
  })

  it('a cube root is defined on both sides of its inflection', () => {
    const res = drawAndRecognize(
      explicitPath(x => 1.7 * Math.cbrt(x - 1)), -6, 8, makeRng(4248),
    )
    const w = expectWinner(res, 'cbrt')
    expect(Math.abs(w.params[1] - 1)).toBeLessThan(0.6)
    expect(relErr(Math.abs(w.params[0]), 1.7)).toBeLessThan(0.2)
  })

  it('x^(2/3) — a cusp — is a power curve with the exponent recovered', () => {
    const res = drawAndRecognize(
      explicitPath(x => Math.cbrt(x * x)), -4, 4, makeRng(4249),
    )
    const w = expectWinner(res, 'power')
    // params [a, b, c, p] -> a·|x - b|^p + c
    expect(relErr(w.params[3], 2 / 3)).toBeLessThan(0.12)
    expect(Math.abs(w.params[1])).toBeLessThan(0.35) // cusp at the origin
    expect(w.error).toBeLessThan(2 * JITTER)
    expect(w.score).toBeLessThan(candidate(res, 'abs')!.score)
  })

  it('the free exponent steals nothing: parabolas, lines and exponentials still win', () => {
    // a genuine parabola — `power` can imitate it exactly at p = 2 and must lose
    const par = drawAndRecognize(explicitPath(x => 0.7 * x * x - 1), -3, 3, makeRng(4250))
    expectWinner(par, 'poly2')
    // a V — power imitates it at p = 1
    const v = drawAndRecognize(
      explicitPath(x => 1.5 * Math.abs(x - 0.5) - 1), -2.5, 3.5, makeRng(4251),
    )
    expectWinner(v, 'abs')
    // an exponential
    const e = drawAndRecognize(
      explicitPath(x => 0.5 * Math.exp(0.9 * x) + 0.3), -2, 2.5, makeRng(4252),
    )
    expectWinner(e, 'exp')
    // a plain square root — the fixed exponent must beat the fitted one
    const s = drawAndRecognize(explicitPath(x => Math.sqrt(x)), 0, 9, makeRng(4253))
    expectWinner(s, 'sqrt')
  })

  it('root families win across seeds, not just favourable ones', () => {
    const shapes: Array<[string, (x: number) => number, number, number]> = [
      ['sqrt', x => Math.sqrt(x), 0, 9],
      ['sqrt', x => 2 * Math.sqrt(x), 0, 9],
      ['sqrt', x => -1.5 * Math.sqrt(x + 1) + 2, -1, 7],
      ['cbrt', x => Math.cbrt(x), -8, 8],
      ['cbrt', x => 1.7 * Math.cbrt(x - 1), -6, 8],
      ['power', x => Math.cbrt(x * x), -4, 4],
    ]
    for (const [want, fn, s0, s1] of shapes) {
      let wins = 0
      const SEEDS = 12
      for (let s = 0; s < SEEDS; s++) {
        const res = drawAndRecognize(explicitPath(fn), s0, s1, makeRng(5300 + s * 137))
        if (winner(res).modelId === want) wins++
      }
      expect(wins, `${want} won only ${wins}/${SEEDS}`).toBeGreaterThanOrEqual(SEEDS - 1)
    }
  })
})

// ---------------------------------------------------------------------------
// Pen-lift flattening.
//
// A hand decelerates and lifts at both ends of a stroke, so the last few
// percent of the ink levels off toward horizontal. It is not noise (smoothing
// cannot remove it) and it cannot be undone in stroke processing (undoing it
// IS the operation that turns a flat-tailed shape into a parabola). Untreated
// it decided the answer: a clean `0.5x² − 2` over [−3, 3] with the last 12% of
// each end eased 30% of the way to horizontal came back `sine` in 90 seeds out
// of 90, because a parabola is the one family RIGIDLY required to keep curving
// and so the one family a levelled-off tail can disqualify.
//
// recognize() now scores every family on the stroke's interior (END_TRIM at
// each end) while still fitting the domain and reporting σ over all the ink.
// ---------------------------------------------------------------------------

/**
 * Ease the last `band` of the x-span at each end toward the horizontal level
 * it had at the band boundary. `amount` = 1 lifts the endpoint fully level.
 */
function penLift(
  f: (x: number) => number,
  x0: number,
  x1: number,
  amount: number,
  band = 0.12,
): (x: number) => number {
  const w = (x1 - x0) * band
  const xa = x0 + w
  const xb = x1 - w
  const ya = f(xa)
  const yb = f(xb)
  return (x: number) => {
    const y = f(x)
    if (x < xa) { const t = (xa - x) / w; return y + amount * t * t * (ya - y) }
    if (x > xb) { const t = (x - xb) / w; return y + amount * t * t * (yb - y) }
    return y
  }
}

describe('recognize — pen-lift flattening does not change the family', () => {
  const SEEDS = 10

  function winRate(
    f: (x: number) => number, a: number, b: number, amount: number, want: string,
  ): { wins: number; note: string } {
    const ff = penLift(f, a, b, amount)
    let wins = 0
    const losers: Record<string, number> = {}
    for (let s = 0; s < SEEDS; s++) {
      const res = drawAndRecognize(explicitPath(ff), a, b, makeRng(11000 + s * 4649))
      if (winner(res).modelId === want) wins++
      else losers[winner(res).modelId] = (losers[winner(res).modelId] ?? 0) + 1
    }
    return { wins, note: JSON.stringify(losers) }
  }

  // The shapes a levelled-off tail can actually mislead, and the ones whose
  // signature lives AT an end and so must survive the trim that fixes them.
  const shapes: Array<[string, string, (x: number) => number, number, number]> = [
    ['parabola', 'poly2', x => 0.5 * x * x - 2, -3, 3],
    ['wide parabola', 'poly2', x => 0.15 * x * x - 2, -6, 6],
    ['tall parabola', 'poly2', x => 1.0 * x * x - 4, -3, 3],
    ['inverted parabola', 'poly2', x => -0.5 * x * x + 3, -4, 4],
    ['V', 'abs', x => 1.2 * Math.abs(x - 0.7) - 2, -5, 6],
    ['line', 'line', x => 0.8 * x - 1, -6, 6],
    ['gaussian', 'gauss', x => 2 * Math.exp(-Math.pow(x / 0.9, 2)), -3, 3],
    ['logistic', 'logistic', x => 4 / (1 + Math.exp(-1.8 * (x - 0.5))) - 2, -6, 7],
    ['sqrt', 'sqrt', x => Math.sqrt(x), 0, 9],
    ['exponential', 'exp', x => 0.4 * Math.exp(0.6 * x) - 1, -6, 4],
    ['cube root', 'cbrt', x => Math.cbrt(x), -8, 8],
    ['sinusoid', 'sine', x => 1.5 * Math.sin(1.2 * x) + 0.4, -7, 7],
  ]

  for (const [label, want, f, a, b] of shapes) {
    it(`a ${label} survives 15% and 30% pen lift`, () => {
      for (const amount of [0, 0.15, 0.3]) {
        const { wins, note } = winRate(f, a, b, amount, want)
        expect(wins, `${label} @${amount * 100}% lift won ${wins}/${SEEDS}, lost to ${note}`)
          .toBe(SEEDS)
      }
    })
  }

  it('a parabola survives even an extreme 60% pen lift', () => {
    // Before end trimming this was 0/90 across every parabola shape tested.
    const { wins, note } = winRate(x => 0.5 * x * x - 2, -3, 3, 0.6, 'poly2')
    expect(wins, `won ${wins}/${SEEDS}, lost to ${note}`).toBe(SEEDS)
  })

  it('the trim is not a thumb on the scale: a real bell is still not a parabola', () => {
    // The whole risk of trimming is that it erodes the tail evidence some
    // families genuinely need. A gaussian's tails ARE its signature, so it
    // must stay emphatically un-parabolic even with its ends discounted.
    const res = drawAndRecognize(
      explicitPath(x => 2 * Math.exp(-Math.pow(x / 0.9, 2))), -3, 3, makeRng(6001),
    )
    const g = expectWinner(res, 'gauss')
    const p2 = candidate(res, 'poly2')!
    expect(p2.error).toBeGreaterThan(8 * g.error)
    expect(p2.score - g.score).toBeGreaterThan(20)
  })

  it('the reported sigma covers ALL the ink, not just the scored interior', () => {
    // The σ the UI shows must answer "how close is this curve to what I drew".
    // A flattened parabola is genuinely off at its tails, so its σ must SAY so
    // even though the tails were excluded from the family decision.
    const flat = penLift(x => 0.5 * x * x - 2, -3, 3, 0.6)
    const res = drawAndRecognize(explicitPath(flat), -3, 3, makeRng(6002))
    const w = expectWinner(res, 'poly2')

    const stroke = drawStroke(explicitPath(flat), -3, 3, makeRng(6002))
    const ev = MODELS.poly2.evalExplicit!
    const rmsOver = (pts: Vec2[]) =>
      Math.sqrt(pts.reduce((s, p) => s + Math.pow(p.y - ev(w.params, p.x), 2), 0) / pts.length)

    const n = stroke.points.length
    const k = Math.floor(n * 0.06)
    const interior = stroke.points.slice(k, n - k)

    // reported σ is the full-ink residual...
    expect(w.error).toBeCloseTo(rmsOver(stroke.points), 6)
    // ...and it is meaningfully larger than the interior residual that ranked
    // the families, i.e. reporting the trimmed number would have understated
    // the misfit the user can see at the ends.
    expect(rmsOver(interior)).toBeLessThan(0.7 * w.error)
  })

  it('a clean stroke reports the same sigma it always did', () => {
    // No flattening => nothing to discount => σ is unchanged by the trim.
    const res = drawAndRecognize(explicitPath(x => 0.4 * x * x - 1), -5, 5, makeRng(1003))
    const w = expectWinner(res, 'poly2')
    expect(w.error).toBeLessThan(2 * JITTER)
  })

  it('closed strokes are not trimmed, and still recognize cleanly', () => {
    // A closed stroke has no dangling tail: its "ends" meet in the middle of a
    // genuine arc, so trimming there would delete real shape.
    for (let s = 0; s < 6; s++) {
      const res = drawAndRecognize(polarPath(() => 2.5), 0, 2 * Math.PI, makeRng(6100 + s))
      expectWinner(res, 'circle')
    }
  })
})

// ---------------------------------------------------------------------------
// Logarithms and reciprocals.
//
// Both were missing, and a missing family is worse than a wrong one: a sketched
// `1.6 ln(x + 4.5)` came back "Exponential, −0.835e^(−0.408x) + 3.344" with no
// "Logarithm" anywhere in the Interpretations list, so there was nothing for
// the teacher to correct it TO.
//
// Their penalty weights were set from the sweep documented in
// src/core/fit/recognize.ts. The invariant those weights have to keep is two-
// sided, and both sides are asserted below: the new families must win their own
// shapes, AND the families they imitate — sqrt, cbrt, exp, logistic for a log;
// abs, power, line for a hyperbola — must keep winning theirs.
// ---------------------------------------------------------------------------

describe('recognize — logarithm and reciprocal', () => {
  it('the curve that started this: 1.6 ln(x + 4.5) is a LOGARITHM', () => {
    const res = drawAndRecognize(
      explicitPath(x => 1.6 * Math.log(x + 4.5)), -4, 6, makeRng(7701),
    )
    const w = expectWinner(res, 'log')
    // params [a, b, c] -> a·ln(x - b) + c
    expect(relErr(w.params[0], 1.6)).toBeLessThan(0.2)
    expect(Math.abs(w.params[1] + 4.5), `asymptote at ${w.params[1]}`).toBeLessThan(0.6)
    expect(w.error).toBeLessThan(2 * JITTER)
    expect(w.score).toBeLessThan(candidate(res, 'exp')!.score)
  })

  it('a logarithm reports a domain that starts at its asymptote', () => {
    const res = drawAndRecognize(explicitPath(x => Math.log(x)), 0.2, 9, makeRng(7702))
    const w = expectWinner(res, 'log')
    expect(w.domain, 'log must carry its own domain').not.toBeNull()
    const [lo, hi] = w.domain as [number, number]
    expect(lo, 'the domain starts at b').toBeCloseTo(w.params[1], 12)
    expect(hi).toBeGreaterThan(8)
    // and nothing left of the asymptote is drawable
    const ev = MODELS.log.evalExplicit!
    expect(Number.isFinite(ev(w.params, lo - 1e-6))).toBe(false)
    expect(Number.isFinite(ev(w.params, lo + 0.1))).toBe(true)
  })

  it('a hand-drawn 1/x is a reciprocal, with the pole located', () => {
    const res = drawAndRecognize(explicitPath(x => 1 / x), 0.25, 6, makeRng(7703))
    const w = expectWinner(res, 'recip')
    expect(Math.abs(w.params[1]), `pole at ${w.params[1]}`).toBeLessThan(0.25)
    // σ is a VERTICAL residual, and next to a pole the curve is nearly
    // vertical: a third of a pixel of horizontal jitter at x = 0.25 is worth
    // 0.05 in y. So the honest scale for this family is the curve's own
    // height (1/0.25 - 1/6 ≈ 3.8), not the absolute jitter.
    expect(w.error).toBeLessThan(0.05 * (1 / 0.25 - 1 / 6))
  })

  it('a shifted hyperbola finds its pole and its horizontal asymptote', () => {
    const res = drawAndRecognize(
      explicitPath(x => 2 / (x - 1) + 1), 1.3, 8, makeRng(7704),
    )
    const w = expectWinner(res, 'recip')
    expect(Math.abs(w.params[1] - 1), `pole at ${w.params[1]}`).toBeLessThan(0.3)
    expect(Math.abs(w.params[2] - 1), `offset ${w.params[2]}`).toBeLessThan(0.4)
  })

  it('the pole never lands inside the ink', () => {
    for (const [f, a, b] of [
      [(x: number) => 1 / x, 0.25, 6],
      [(x: number) => 1 / x, -6, -0.25],
      [(x: number) => -1.5 / (x + 2) - 1, -1.6, 6],
      [(x: number) => 0.6 / (x - 3), 3.2, 9],
    ] as Array<[(x: number) => number, number, number]>) {
      for (let s = 0; s < 8; s++) {
        const res = drawAndRecognize(explicitPath(f), a, b, makeRng(7800 + s * 97))
        const r = candidate(res, 'recip')
        if (!r) continue
        const pole = r.params[1]
        expect(pole < a || pole > b, `pole ${pole} inside the drawn span [${a}, ${b}]`).toBe(true)
      }
    }
  })

  it('both families win their own shapes across seeds', () => {
    const shapes: Array<[string, (x: number) => number, number, number]> = [
      ['log', x => Math.log(x), 0.2, 9],
      ['log', x => 1.6 * Math.log(x + 4.5), -4, 6],
      ['log', x => 2 * Math.log(x - 1) + 1, 1.2, 9],
      ['log', x => -1.2 * Math.log(x + 2) + 3, -1.8, 8],
      ['recip', x => 1 / x, 0.25, 6],
      ['recip', x => 1 / x, -6, -0.25],
      ['recip', x => 2 / (x - 1) + 1, 1.3, 8],
      ['recip', x => 3 / (x + 1) + 2, -0.6, 8],
    ]
    for (const [want, fn, s0, s1] of shapes) {
      let wins = 0
      const SEEDS = 12
      for (let s = 0; s < SEEDS; s++) {
        const res = drawAndRecognize(explicitPath(fn), s0, s1, makeRng(9100 + s * 331))
        if (winner(res).modelId === want) wins++
      }
      expect(wins, `${want} on [${s0}, ${s1}] won only ${wins}/${SEEDS}`)
        .toBeGreaterThanOrEqual(SEEDS - 1)
    }
  })

  it('does not take shapes that belong to the families it imitates', () => {
    // A logarithm over a short span IS a square root to within hand jitter, and
    // a hyperbola branch is an exponential decay. These are the seeds where the
    // penalty weights earn their keep.
    const shapes: Array<[string, (x: number) => number, number, number]> = [
      ['sqrt', x => Math.sqrt(x), 0, 9],
      ['sqrt', x => 2 * Math.sqrt(x), 0, 9],
      ['sqrt', x => -1.5 * Math.sqrt(x + 1) + 2, -1, 7],
      ['sqrt', x => 1.2 * Math.sqrt(x - 2) - 1, 2, 8],
      ['cbrt', x => Math.cbrt(x), -8, 8],
      ['exp', x => 2 * Math.exp(-1.1 * x), 0, 4],
      ['exp', x => 3 * Math.exp(-0.6 * x) + 1, -2, 6],
      ['logistic', x => 4 / (1 + Math.exp(-1.8 * (x - 0.5))) - 2, -5, 6],
      ['abs', x => Math.abs(x - 1) - 2, -5, 6],
      ['line', x => 0.8 * x - 1, -6, 6],
    ]
    for (const [want, fn, s0, s1] of shapes) {
      for (let s = 0; s < 12; s++) {
        const res = drawAndRecognize(explicitPath(fn), s0, s1, makeRng(9100 + s * 331))
        expect(winner(res).modelId, `${want} seed ${s}: ${ranking(res.slice(0, 3))}`).toBe(want)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// What the Interpretations list shows.
//
// The list is sorted by score; the sidebar printed σ. Those are different
// quantities, so the visible column read as unsorted — "1.573, 0.830, 1.335,
// 2.622" down a list labelled best-first — and a number printed beside a
// ranked list is read as the ranking. fitQuality is the number that can sit
// there: monotone by construction, because it is a decreasing function of the
// very score the sort uses.
// ---------------------------------------------------------------------------

describe('fitQuality — the column that CAN sit beside a ranked list', () => {
  const strokes: Array<[string, (x: number) => number, number, number]> = [
    ['sinusoid', x => 1.5 * Math.sin(1.2 * x) + 0.4, -7, 7],
    ['parabola', x => 0.4 * x * x - 1, -5, 5],
    ['logarithm', x => 1.6 * Math.log(x + 4.5), -4, 6],
    ['exponential', x => 0.4 * Math.exp(0.6 * x) - 1, -6, 4],
    ['hyperbola', x => 2 / (x - 1) + 1, 1.3, 8],
    ['V', x => 1.2 * Math.abs(x - 0.7) - 2, -5, 6],
  ]

  it.each(strokes)('%s: quality never rises as the list goes down', (label, fn, a, b) => {
    for (let s = 0; s < 6; s++) {
      const res = drawAndRecognize(explicitPath(fn), a, b, makeRng(3300 + s * 811))
      const q = fitQuality(res)
      expect(q.length).toBe(res.length)
      expect(q[0], `${label}: the winner is not full quality`).toBe(1)
      for (let i = 1; i < q.length; i++) {
        expect(q[i], `${label}: row ${i} (${res[i].modelId}) rose above row ${i - 1}`)
          .toBeLessThanOrEqual(q[i - 1])
        expect(q[i], `${label}: row ${i} out of range`).toBeGreaterThanOrEqual(0)
        expect(q[i]).toBeLessThanOrEqual(1)
      }
    }
  })

  it('σ itself is NOT monotone down the list — which is the whole problem', () => {
    // If this ever starts passing, the column could just be σ and this whole
    // function is unnecessary. It does not pass: a quartic fits a parabola
    // more tightly than the parabola does and is still ranked below it.
    const res = drawAndRecognize(explicitPath(x => 0.4 * x * x - 1), -5, 5, makeRng(1003))
    const sigmas = res.map(r => r.error)
    const sorted = sigmas.every((v, i) => i === 0 || v >= sigmas[i - 1])
    expect(sorted, `σ happened to be sorted here: ${sigmas.map(v => v.toFixed(3)).join(', ')}`)
      .toBe(false)
  })

  it('separates a decisive winner from a close call', () => {
    // a sinusoid is unmistakable; a logarithm and a hyperbola branch are the
    // same shape to within hand jitter, and the list should say so
    const clear = drawAndRecognize(
      explicitPath(x => 1.5 * Math.sin(1.2 * x) + 0.4), -7, 7, makeRng(1001),
    )
    const close = drawAndRecognize(
      explicitPath(x => 1.6 * Math.log(x + 4.5)), -4, 6, makeRng(1001),
    )
    expect(fitQuality(clear)[1], 'a sinusoid has no serious rival').toBeLessThan(0.5)
    expect(fitQuality(close)[1], 'log vs recip is a genuinely close call').toBeGreaterThan(0.7)
  })

  it('is safe on the degenerate inputs recognize() can return', () => {
    expect(fitQuality([])).toEqual([])
    const bogus: FitResult[] = [
      { modelId: 'a', params: [], kind: 'explicit', domain: null, error: 1, score: Number.NaN },
      { modelId: 'b', params: [], kind: 'explicit', domain: null, error: 1, score: -10 },
    ]
    const q = fitQuality(bogus)
    expect(q.every(v => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true)
    expect(q[1]).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// A circle is a circle — not a polar family that happens to draw one.
//
// A circle sketched through or around the origin is also a k = 1 rose
// (r = a·cos(θ + c)), a limaçon with a small b, or a spiral that barely
// climbs. Two things used to hand it to them: a stroke whose ENDPOINTS missed
// the 8% closure window (an overshoot or gap of ~1/15 of a turn) got no
// circle candidate at all, and where it did, the circle beat its polar twins
// by only the ~2-point difference in complexity terms. Measured on 300 random
// circle sketches (the sweep below at N = 300): 189/300 Circle before (22
// rose, 28 limaçon, 8 spiral, 53 Fourier), 300/300 after.
// ---------------------------------------------------------------------------

describe('recognize — a circle in polar dress is a circle', () => {
  const U = (rng: () => number, a: number, b: number) => a + (b - a) * rng()

  /** A hand-drawn circle: centre (cx, cy), radius R, starting at `start`,
   *  going round `turns` times in direction `dir`, with a little wobble. */
  function circleStroke(
    cx: number, cy: number, R: number, rng: () => number,
    o: { start?: number; turns?: number; dir?: number; jitter?: number; n?: number } = {},
  ) {
    const start = o.start ?? 0
    const dir = o.dir ?? 1
    return drawStroke(
      (t: number): Vec2 => ({ x: cx + R * Math.cos(start + dir * t), y: cy + R * Math.sin(start + dir * t) }),
      0, 2 * Math.PI * (o.turns ?? 1), rng, { n: o.n ?? 160, jitter: o.jitter ?? JITTER },
    )
  }

  /** A random circle sketch the way the sweep draws them. */
  function randomCircle(seed: number) {
    const rng = makeRng(seed * 9973 + 17)
    const R = U(rng, 0.6, 4)
    const mode = Math.floor(rng() * 5)
    const d =
      mode === 0 ? U(rng, 0, 0.08) * R         // centred on the origin
        : mode === 1 ? U(rng, 0.93, 1.07) * R  // through the origin
          : mode === 2 ? U(rng, 0.08, 0.93) * R // around it, off-centre
            : mode === 3 ? U(rng, 1.07, 1.6) * R // just missing it
              : U(rng, 0, 2.5) * R
    const phi = U(rng, 0, 2 * Math.PI)
    let cx = d * Math.cos(phi)
    let cy = d * Math.sin(phi)
    const s = Math.max(1, (Math.abs(cx) + R) / 9.3, (Math.abs(cy) + R) / 6.1) // stay on screen
    cx /= s
    cy /= s
    return circleStroke(cx, cy, R / s, rng, {
      start: U(rng, 0, 2 * Math.PI),
      dir: rng() < 0.5 ? 1 : -1,
      turns: 1 + U(rng, -0.04, 0.08), // a small gap … an overshoot
      jitter: U(rng, 0.01, 0.06),
      n: Math.floor(U(rng, 80, 260)),
    })
  }

  it('random circle sketches come back Circle ≥ 99% (seed sweep)', () => {
    const N = 150
    const misses: string[] = []
    for (let seed = 1; seed <= N; seed++) {
      const res = recognize(randomCircle(seed), VP)
      if (winner(res).modelId !== 'circle') misses.push(`seed ${seed}: ${ranking(res.slice(0, 3))}`)
    }
    expect(misses.length, misses.join('\n')).toBeLessThanOrEqual(Math.floor(0.01 * N))
  })

  it('genuine polar sketches and ellipses keep their reading ≥ 97% (seed sweep)', () => {
    const N = 30
    const polar = (f: (t: number) => number, rot = 0) => (t: number): Vec2 => {
      const r = f(t)
      return { x: r * Math.cos(t + rot), y: r * Math.sin(t + rot) }
    }
    type Shape = (rng: () => number) => { fn: (t: number) => Vec2; span: number }
    const rose = (k: number): Shape => rng => {
      const A = U(rng, 2, 5.5)
      const c = U(rng, 0, 2 * Math.PI)
      return { fn: polar(t => A * Math.cos(k * t + c)), span: k % 2 ? Math.PI : 2 * Math.PI }
    }
    // limaçons are drawn from a random starting angle (the family has no phase)
    const limacon = (lo: number, hi: number): Shape => rng => {
      const a = U(rng, 1.2, 3)
      const b = (rng() < 0.5 ? 1 : -1) * U(rng, lo, hi) * a
      const st = U(rng, 0, 2 * Math.PI)
      const sc = Math.max(1, (a + Math.abs(b)) / 6)
      return { fn: polar(t => (a + b * Math.cos(t + st)) / sc, st), span: 2 * Math.PI }
    }
    const spiral: Shape = rng => {
      const span = U(rng, 1.3, 2.2) * 2 * Math.PI
      const a = U(rng, 0, 0.5)
      const b = U(rng, 4.5, 6) / span
      return { fn: polar(t => a + b * t, U(rng, 0, 2 * Math.PI)), span }
    }
    const ellipse: Shape = rng => {
      const rx = U(rng, 1.5, 4)
      const ry = rx * U(rng, 0.45, 0.8)
      const rot = U(rng, 0, Math.PI)
      const cx = U(rng, -1, 1)
      const cy = U(rng, -0.6, 0.6)
      const st = U(rng, 0, 2 * Math.PI)
      return {
        fn: (t: number): Vec2 => {
          const u = rx * Math.cos(t + st), v = ry * Math.sin(t + st)
          return { x: cx + u * Math.cos(rot) - v * Math.sin(rot), y: cy + u * Math.sin(rot) + v * Math.cos(rot) }
        },
        span: 2 * Math.PI * (1 + U(rng, -0.03, 0.06)),
      }
    }
    const suites: Array<[string, Shape, string]> = [
      ['rose k=2', rose(2), 'polarRose'],
      ['rose k=3', rose(3), 'polarRose'],
      ['rose k=4', rose(4), 'polarRose'],
      ['cardioid', limacon(1, 1), 'limacon'],
      ['inner-loop limaçon', limacon(1.6, 2.4), 'limacon'],
      ['dimpled limaçon b/a = 1/2', limacon(0.5, 0.5), 'limacon'],
      ['dimpled limaçon b/a = 2/3', limacon(2 / 3, 2 / 3), 'limacon'],
      ['Archimedean spiral', spiral, 'spiral'],
      ['ellipse', ellipse, 'ellipse'],
    ]
    for (const [label, shape, want] of suites) {
      let hits = 0
      const misses: string[] = []
      for (let seed = 1; seed <= N; seed++) {
        const rng = makeRng(seed * 7919 + label.length * 131)
        const { fn, span } = shape(rng)
        const res = recognize(
          drawStroke(fn, 0, span, rng, { n: Math.floor(U(rng, 140, 280)), jitter: U(rng, 0.01, 0.05) }), VP,
        )
        if (winner(res).modelId === want) hits++
        else misses.push(`seed ${seed}: ${ranking(res.slice(0, 3))}`)
      }
      expect(hits, `${label}\n${misses.join('\n')}`).toBeGreaterThanOrEqual(Math.ceil(0.97 * N))
    }
  })

  function expectCircle(res: FitResult[], cx: number, cy: number, R: number): void {
    const w = expectWinner(res, 'circle')
    expect(Math.abs(w.params[0] - cx)).toBeLessThan(0.05 * R + 0.02)
    expect(Math.abs(w.params[1] - cy)).toBeLessThan(0.05 * R + 0.02)
    expect(relErr(w.params[2], R)).toBeLessThan(0.05)
    // every polar reading that draws a circle ranks BELOW the circle
    for (const c of res) {
      if (c.modelId === 'polarRose' && Math.round(c.params[1]) === 1) {
        expect(c.score).toBeGreaterThan(w.score)
      }
    }
  }

  // Each drawn three ways: closed at the endpoints, overshooting by a tenth
  // of a turn, and stopping a twentieth of a turn short.
  const ways: Array<[string, number]> = [['closed', 1], ['overshoot', 1.1], ['gap', 0.95]]

  for (const [how, turns] of ways) {
    it(`a circle THROUGH the origin is a circle, not a k = 1 rose (${how})`, () => {
      // centre (1.2, 1.6), radius 2: passes through (0, 0)
      const res = recognize(circleStroke(1.2, 1.6, 2, makeRng(5101), { turns, start: 2.5 }), VP)
      expectCircle(res, 1.2, 1.6, 2)
      // …and on the x-axis, where a limaçon r = b·cos θ is also this circle
      const res2 = recognize(circleStroke(2.5, 0, 2.5, makeRng(5102), { turns, start: 1 }), VP)
      expectCircle(res2, 2.5, 0, 2.5)
    })

    it(`a circle CENTRED at the origin is a circle, not a limaçon or spiral (${how})`, () => {
      const res = recognize(circleStroke(0, 0, 3, makeRng(5103), { turns, start: 0.4, dir: -1 }), VP)
      expectCircle(res, 0, 0, 3)
    })

    it(`a SMALL circle near the origin is a circle (${how})`, () => {
      const res = recognize(circleStroke(0.25, -0.15, 0.6, makeRng(5104), { turns, start: 4 }), VP)
      expectCircle(res, 0.25, -0.15, 0.6)
    })
  }

  it('an overshooting circle that misses the closure window still gets a circle reading', () => {
    const st = circleStroke(-0.8, 0.5, 2.2, makeRng(5105), { turns: 1.15, start: 1.3 })
    expect(st.closed).toBe(false)
    expectCircle(recognize(st, VP), -0.8, 0.5, 2.2)
  })

  it('going round is not enough on its own: a figure-eight and an open arc are not circles', () => {
    // a figure-eight turns once each way — never a loop, whatever the centre
    for (let seed = 1; seed <= 8; seed++) {
      const res = drawAndRecognize(
        (t: number): Vec2 => ({ x: 3 * Math.sin(t), y: 3 * Math.sin(t) * Math.cos(t) }),
        0, 2 * Math.PI * 1.06, makeRng(5200 + seed),
      )
      expect(winner(res).modelId, ranking(res.slice(0, 3))).not.toBe('circle')
    }
    // three quarters of a circle is an arc: no circle candidate is offered
    const arc = drawStroke(
      (t: number): Vec2 => ({ x: 1 + 2.5 * Math.cos(t), y: -0.5 + 2.5 * Math.sin(t) }),
      0, 2 * Math.PI * 0.75, makeRng(5210),
    )
    expect(candidate(recognize(arc, VP), 'circle')).toBeUndefined()
  })

  it('a heart drawn with an overshoot is still a Fourier curve, not a circle', () => {
    const s = 0.18
    const res = drawAndRecognize(
      (t: number): Vec2 => ({
        x: s * 16 * Math.pow(Math.sin(t), 3),
        y: s * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)),
      }),
      0.3, 0.3 + 2 * Math.PI * 1.1, makeRng(5220),
    )
    expectWinner(res, 'fourier')
  })
})

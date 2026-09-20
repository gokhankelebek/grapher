// ============================================================================
// tests/holes.test.ts — removable discontinuities and vertical asymptotes
// (src/core/holes.ts, plus ModelSpec.singularities from src/core/parse).
//
// Every expected value is worked out by hand: (x²−1)/(x−1) IS x + 1 away from
// x = 1, so the hole is at (1, 2) and nowhere else. A teacher reads these
// numbers off the board in front of a class.
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { parseExpression } from '../src/core/parse'
import { MODELS } from '../src/core/fit/models'
import { findHoles, findPoles } from '../src/core/holes'
import { analyzeCurve } from '../src/core/analyze'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

interface Typed {
  curve: FittedCurve
  models: Record<string, ModelSpec>
  spec: ModelSpec
}

/** A typed expression, as the board holds it: one `expr_N` model and a curve. */
function typed(src: string, domain: [number, number] | null = null): Typed {
  const r = parseExpression(src)
  if (!r.ok) throw new Error(`expected "${src}" to parse, got: ${r.error}`)
  const spec = r.plot.makeModel('expr_1')
  const curve: FittedCurve = {
    id: 'test-curve',
    modelId: 'expr_1',
    params: r.plot.defaultParams,
    kind: r.plot.kind,
    domain: domain ?? r.plot.domain,
    color: '#4f9cf9',
    strokeWidth: 2.5,
    visible: true,
    error: 0,
  }
  return { curve, models: { expr_1: spec }, spec }
}

const holesOf = (src: string, range: [number, number] = [-10, 10]) => {
  const t = typed(src)
  return findHoles(t.curve, t.models, range)
}

const polesOf = (src: string, range: [number, number] = [-10, 10]) => {
  const t = typed(src)
  return findPoles(t.curve, t.models, range)
}

const singOf = (src: string, range: [number, number] = [-10, 10]) => {
  const t = typed(src)
  return t.spec.singularities!(t.curve.params, range)
}

function libraryCurve(
  modelId: string,
  params: number[],
  domain: [number, number] | null = null,
): FittedCurve {
  return {
    id: 'lib-curve',
    modelId,
    params,
    kind: MODELS[modelId].kind,
    domain,
    color: '#4f9cf9',
    strokeWidth: 2.5,
    visible: true,
    error: 0,
  }
}

// ---------------------------------------------------------------------------
// singularities — what the compiled expression knows about itself
// ---------------------------------------------------------------------------

describe('ModelSpec.singularities', () => {
  it('collects every denominator zero', () => {
    expect(singOf('y = (x-2)/((x-2)(x+1))')).toEqual([-1, 2])
  })

  it('finds a denominator that only TOUCHES zero', () => {
    // x² never changes sign, so a sign-change scan alone is blind to it
    expect(singOf('y = 1/x^2')).toEqual([0])
  })

  it('reads a negative power as the denominator it is', () => {
    expect(singOf('y = x^-2')).toEqual([0])
    expect(singOf('y = 2x^(-1) + 1')).toEqual([0])
  })

  it('solves tan for its own poles, not by watching it blow up', () => {
    const xs = singOf('y = tan(x)', [-5, 5])
    expect(xs).toHaveLength(4)
    const want = [-3 * Math.PI / 2, -Math.PI / 2, Math.PI / 2, 3 * Math.PI / 2]
    for (let i = 0; i < 4; i++) expect(xs[i]).toBeCloseTo(want[i], 12)
  })

  it('treats an explicit exclusion as a singularity, not only a note', () => {
    const t = typed('y = x^2 {x != 2}')
    expect(t.spec.latex([])).toContain('\\ne')      // still says so on the card
    expect(singOf('y = x^2 {x != 2}')).toEqual([2]) // and is a real singularity
  })

  it('gives a polynomial none, and stays inside the range it was asked about', () => {
    expect(singOf('y = x^3 - 3x')).toEqual([])
    expect(singOf('y = 1/x', [1, 10])).toEqual([])
  })

  it('a piecewise branch owns only the singularities inside its own set', () => {
    // 0 is where `1/x` stops being that branch's business, not a pole of it
    expect(singOf('y = { 1/x if x < 0 ; x if x >= 0 }')).toEqual([])
    expect(singOf('y = { 1/x if x != 0 }')).toEqual([0])
  })

  it('is not carried by a polar or implicit plot', () => {
    const polar = parseExpression('r = 1/theta')
    expect(polar.ok && polar.plot.makeModel('e').singularities).toBeUndefined()
    const implicit = parseExpression('x^2 + y^2 = 4')
    expect(implicit.ok && implicit.plot.makeModel('e').singularities).toBeUndefined()
  })

  it('memoises: the same (params, range) is not scanned twice', () => {
    const t = typed('y = 1/((x-1)(x+3))')
    const a = t.spec.singularities!(t.curve.params, [-10, 10])
    const b = t.spec.singularities!(t.curve.params, [-10, 10])
    expect(b).toEqual(a)
    expect(b).not.toBe(a) // a copy, so a caller cannot poison the cache
  })
})

// ---------------------------------------------------------------------------
// holes
// ---------------------------------------------------------------------------

describe('findHoles', () => {
  it('(x² − 1)/(x − 1) has a hole at (1, 2) and no asymptote', () => {
    const holes = holesOf('y = (x^2-1)/(x-1)')
    expect(holes).toHaveLength(1)
    expect(holes[0].x).toBe(1)
    expect(holes[0].y).toBeCloseTo(2, 6)
    expect(polesOf('y = (x^2-1)/(x-1)')).toEqual([])
  })

  it('sin(x)/x has a hole at (0, 1)', () => {
    const holes = holesOf('y = sin(x)/x')
    expect(holes).toHaveLength(1)
    expect(holes[0].x).toBe(0)
    expect(holes[0].y).toBeCloseTo(1, 9)
    expect(polesOf('y = sin(x)/x')).toEqual([])
  })

  it('a hole whose limit is 0 is still a hole', () => {
    // (x − 1)²/(x − 1) = x − 1: the limit at x = 1 is 0, and 0 is a value like
    // any other. This is the case a "did the values stop changing?" test gets
    // wrong when its tolerance is relative to |f| alone.
    const holes = holesOf('y = (x-1)^2/(x-1)')
    expect(holes).toHaveLength(1)
    expect(holes[0].x).toBe(1)
    expect(holes[0].y).toBeCloseTo(0, 6)
  })

  it('x(x − 1)/(x − 1) has a hole at (1, 1)', () => {
    const holes = holesOf('y = x(x-1)/(x-1)')
    expect(holes).toHaveLength(1)
    expect(holes[0].x).toBe(1)
    expect(holes[0].y).toBeCloseTo(1, 6)
  })

  it('an explicit exclusion on a curve that is fine there is an EXACT hole', () => {
    const holes = holesOf('y = x^2 {x != 2}')
    expect(holes).toHaveLength(1)
    expect(holes[0].x).toBe(2)
    expect(holes[0].y).toBeCloseTo(4, 9)
    expect(holes[0].exact).toBe(true)
    expect(polesOf('y = x^2 {x != 2}')).toEqual([])
  })

  it('one factor cancels and one does not: a hole AND a pole', () => {
    // (x − 2)/((x − 2)(x + 1)) = 1/(x + 1) away from x = 2
    const holes = holesOf('y = (x-2)/((x-2)(x+1))')
    expect(holes).toHaveLength(1)
    expect(holes[0].x).toBe(2)
    expect(holes[0].y).toBeCloseTo(1 / 3, 6)
    expect(polesOf('y = (x-2)/((x-2)(x+1))')).toEqual([-1])
  })

  it('a JUMP is not a hole — and not an asymptote either', () => {
    // |x|/x steps from −1 to +1 at 0. Both one-sided limits exist and are
    // finite; they simply disagree. It belongs in neither list.
    expect(holesOf('y = abs(x)/x')).toEqual([])
    expect(polesOf('y = abs(x)/x')).toEqual([])
  })

  it('an ordinary polynomial has neither', () => {
    expect(holesOf('y = x^3 - 3x')).toEqual([])
    expect(polesOf('y = x^3 - 3x')).toEqual([])
  })

  it('never returns a NaN x or y', () => {
    for (const src of [
      'y = (x^2-1)/(x-1)', 'y = sin(x)/x', 'y = 1/x', 'y = 1/x^2',
      'y = abs(x)/x', 'y = tan(x)', 'y = sqrt(x)/x', 'y = 0/x',
      'y = 1/(x^2+1)', 'y = (x-1)/((x-1)^2)',
    ]) {
      for (const h of holesOf(src)) {
        expect(Number.isFinite(h.x), `${src} x`).toBe(true)
        expect(Number.isFinite(h.y), `${src} y`).toBe(true)
      }
      for (const p of polesOf(src)) expect(Number.isFinite(p), `${src} pole`).toBe(true)
    }
  })

  it('stays inside the curve’s own domain', () => {
    const t = typed('y = (x^2-1)/(x-1)', [2, 8])
    expect(findHoles(t.curve, t.models, [-10, 10])).toEqual([])
  })

  it('a candidate ON a declared domain end is neither hole nor pole', () => {
    // y = (x² − 1)/(x − 1) {−3 < x < 1} stops AT the discontinuity: only one
    // of its sides is on the graph, so there is no two-sided limit to have.
    // The open end cap is what says what happens there.
    const t = typed('y = (x^2-1)/(x-1)', [-3, 1])
    expect(findHoles(t.curve, t.models, [-10, 10])).toEqual([])
    expect(findPoles(t.curve, t.models, [-10, 10])).toEqual([])
    const p = typed('y = 1/x', [0, 5])
    expect(findPoles(p.curve, p.models, [-10, 10])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// poles
// ---------------------------------------------------------------------------

describe('findPoles', () => {
  it('1/x is a pole at 0 with no hole', () => {
    expect(polesOf('y = 1/x')).toEqual([0])
    expect(holesOf('y = 1/x')).toEqual([])
  })

  it('1/x² is a pole at 0 — the denominator only touches zero', () => {
    expect(polesOf('y = 1/x^2')).toEqual([0])
    expect(holesOf('y = 1/x^2')).toEqual([])
  })

  it('tan x has poles at ±π/2 and ±3π/2 on [−5, 5]', () => {
    const poles = polesOf('y = tan(x)', [-5, 5])
    expect(poles).toHaveLength(4)
    const want = [-3 * Math.PI / 2, -Math.PI / 2, Math.PI / 2, 3 * Math.PI / 2]
    for (let i = 0; i < 4; i++) expect(poles[i]).toBeCloseTo(want[i], 12)
    expect(holesOf('y = tan(x)', [-5, 5])).toEqual([])
  })

  it('the recip family answers from its own parameters', () => {
    // a/(x − b) + c: the pole is b, known in closed form, never sampled for
    const c = libraryCurve('recip', [2, 3, 1])
    expect(findPoles(c, MODELS, [-10, 10])).toEqual([3])
    expect(findHoles(c, MODELS, [-10, 10])).toEqual([])
    // and only when it is inside the range asked about
    expect(findPoles(c, MODELS, [-10, 0])).toEqual([])
  })

  it('every other library family has neither', () => {
    for (const [modelId, params] of [
      ['line', [1, 2]],
      ['poly2', [-6, -4, 2]],
      ['poly3', [6, -5, -2, 1]],
      ['sine', [2, 1, 0, 0]],
      ['exp', [1, 0.5, 0]],
      ['power', [1, 0, 0, 2]],
      ['abs', [1, 0, 0]],
      ['sqrt', [1, 0, 0]],
      ['logistic', [1, 1, 0, 0]],
    ] as const) {
      const c = libraryCurve(modelId, [...params])
      expect(findHoles(c, MODELS, [-10, 10]), modelId).toEqual([])
      expect(findPoles(c, MODELS, [-10, 10]), modelId).toEqual([])
    }
  })
})

// ---------------------------------------------------------------------------
// analyzeCurve
// ---------------------------------------------------------------------------

describe('analyzeCurve — holes', () => {
  it('lists the hole with the label “hole”, after the other features', () => {
    const t = typed('y = (x^2-1)/(x-1)', [-10, 10])
    const pts = analyzeCurve(t.curve, t.models)
    const holes = pts.filter(p => p.kind === 'hole')
    expect(holes).toHaveLength(1)
    expect(holes[0].label).toBe('hole')
    expect(holes[0].pos.x).toBe(1)
    expect(holes[0].pos.y).toBeCloseTo(2, 6)
    // y is a limit, never an exact value, and SpecialPoint has one flag
    expect(holes[0].exact).toBe(false)
    expect(pts[pts.length - 1].kind).toBe('hole')
    // the real zero of x + 1 is still found
    expect(pts.filter(p => p.kind === 'zero').map(p => p.pos.x)).toHaveLength(1)
    expect(pts.filter(p => p.kind === 'zero')[0].pos.x).toBeCloseTo(-1, 9)
  })

  it('a hole ON the axis is a hole, NOT a zero', () => {
    // (x − 1)²/(x − 1) crosses y = 0 at x = 1 in the sampler's eyes: the
    // values on either side have opposite signs, which is exactly what the
    // sign-change scan calls a root. There is no point there at all.
    const t = typed('y = (x-1)^2/(x-1)', [-10, 10])
    const pts = analyzeCurve(t.curve, t.models)
    const holes = pts.filter(p => p.kind === 'hole')
    expect(holes).toHaveLength(1)
    expect(holes[0].pos.x).toBe(1)
    expect(holes[0].pos.y).toBeCloseTo(0, 6)
    for (const p of pts) {
      if (p.kind === 'hole') continue
      expect(Math.abs(p.pos.x - 1), `a ${p.kind} was reported at the hole`)
        .toBeGreaterThan(1e-6)
    }
  })

  it('x(x − 1)/(x − 1) reports the hole at (1, 1) and no feature there', () => {
    const t = typed('y = x(x-1)/(x-1)', [-10, 10])
    const pts = analyzeCurve(t.curve, t.models)
    const holes = pts.filter(p => p.kind === 'hole')
    expect(holes).toHaveLength(1)
    expect(holes[0].pos.x).toBe(1)
    expect(holes[0].pos.y).toBeCloseTo(1, 6)
    expect(pts.filter(p => p.kind === 'maximum' || p.kind === 'minimum')).toEqual([])
  })

  it('an exclusion is listed as a hole on an otherwise ordinary parabola', () => {
    const t = typed('y = x^2 {x != 2}', [-10, 10])
    const pts = analyzeCurve(t.curve, t.models)
    const holes = pts.filter(p => p.kind === 'hole')
    expect(holes).toHaveLength(1)
    expect(holes[0].pos.x).toBe(2)
    expect(holes[0].pos.y).toBeCloseTo(4, 9)
    // the vertex is still there
    const min = pts.filter(p => p.kind === 'minimum')
    expect(min).toHaveLength(1)
    expect(min[0].pos.x).toBeCloseTo(0, 6)
  })

  it('1/x is listed with no hole at all', () => {
    const t = typed('y = 1/x', [-10, 10])
    expect(analyzeCurve(t.curve, t.models).filter(p => p.kind === 'hole')).toEqual([])
  })

  it('a curve with no singularities is untouched', () => {
    const pts = analyzeCurve(libraryCurve('poly3', [6, -5, -2, 1], [-4, 5]), MODELS)
    expect(pts.filter(p => p.kind === 'hole')).toEqual([])
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].pos.x).toBeGreaterThanOrEqual(pts[i - 1].pos.x)
    }
  })
})

// ---------------------------------------------------------------------------
// cost — the renderer asks for this every frame
// ---------------------------------------------------------------------------

describe('cost', () => {
  it('singularities + findHoles + findPoles cost well under a millisecond', () => {
    const t = typed('y = (x^2-1)/(x-1)')
    const range: [number, number] = [-10, 10]
    const once = () => {
      t.spec.singularities!(t.curve.params, range)
      findHoles(t.curve, t.models, range)
      findPoles(t.curve, t.models, range)
    }
    for (let i = 0; i < 20; i++) once()
    const n = 200
    const t0 = performance.now()
    for (let i = 0; i < n; i++) once()
    const per = (performance.now() - t0) / n
    expect(per, `${per.toFixed(3)} ms per call`).toBeLessThan(1)
  })
})

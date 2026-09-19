// ============================================================================
// tests/models.test.ts — MODELS registry invariants, applied to EVERY family.
//   * the eval* matching `kind` exists and produces finite values
//   * latex() is non-empty, brace-balanced, artifact-free
//   * latex() PRINTS THE CURVE: re-reading the rendered equation reproduces it
//   * paramMeta() is one usable slider per parameter
//   * translate(), where implemented, is EXACT
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { ModelSpec, Vec2 } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { centerFormToConic, conicToCenterForm } from '../src/core/fit/optimize'
import { makeRng } from './helpers'
import {
  compileFourier, compileImplicit, compileLatex, compileRhs, muteValue, valueSpans,
} from './latexEval'

// ---------------------------------------------------------------------------
// Representative parameter sets per family. Each family gets several, chosen
// to exercise sign flips, unit coefficients and zero shifts (the cases the
// term formatter special-cases).
// ---------------------------------------------------------------------------

const SAMPLES: Record<string, number[][]> = {
  line: [[-1, 0.8], [0, 1], [2, -1], [1.2e-6, 1]],
  poly2: [[-1, 0, 0.4], [0, 1, 1], [1, -1, -1]],
  poly3: [[0.5, -0.3, 0, 0.05], [0, 0, 0, 1], [-2, 1, -0.5, 0.25]],
  poly4: [[1, 2, 3, 4, 5], [0, 0, 0, 0, -1], [0.1, -0.2, 0.3, -0.4, 0.5]],
  sine: [[1.5, 1.2, 0.3, 0.4], [1, 1, 0, 0], [-2, -1, -0.5, -1]],
  gauss: [[3, 0.5, 1.2, -1], [1, 0, 1, 0], [-1, -2, 0.5, 1]],
  exp: [[0.4, 0.6, -1], [1, 1, 0], [-2, -0.5, 3]],
  abs: [[1.2, 0.7, -2], [1, 0, 0], [-1, -1, -1]],
  logistic: [[4, 1.8, 0.5, -2], [1, 1, 0, 0], [-1, -2, -1, 1]],
  log: [[1, 0, 0], [1.6, -1, 0.5], [-1.4, 1, -0.5]],
  recip: [[1, 0, 0], [1.5, -1, 0.5], [-2, 1, -1]],
  sqrt: [[1, 0, 0], [2, -1.5, 0.5], [-1.4, 1, -0.5], [1, -4, 0]],
  cbrt: [[1, 0, 0], [1.7, 1, -0.5], [-1, -2, 1]],
  power: [[1, 0, 0, 2 / 3], [0.8, 1.2, -1, 0.25], [-2, -1, 0.5, 1.5]],
  vline: [[2], [0], [-1.5]],
  circle: [[0, 0, 2.5], [1, -2, 3], [0, 0, 1]],
  ellipse: [
    [0.2052, -0.3197, 0.331, 0.0001, 0.001, -0.8638],
    [0.25, 0, 0.5, 0, 0, -1],
    [0.4, 0.15, 0.3, -0.5, 0.2, -1.2],
  ],
  polarRose: [[3, 3, 0.7], [1, 1, 0], [2, 2, -0.5]],
  limacon: [[1, 2], [1.8, 1.8], [1, -1], [0, 1]],
  spiral: [[0.25, 0.33], [0, 1], [1, -1]],
  fourier: [
    [0, 0, 1, 0, 0, 1, 0.2, 0.1, -0.1, 0.2],
    [0.5, -0.5, 1, 1, 1, 1],
  ],
}

/** Families for which translation is not a meaningful operation. */
const NO_TRANSLATE = new Set(['polarRose', 'limacon', 'spiral'])

/**
 * Families that are only defined on part of the x axis. `sqrt` genuinely does
 * not exist left of its branch point b, and says so with NaN — recognition
 * pairs it with a domain starting at b so the renderer never asks. These get
 * the finiteness invariant applied WHERE DEFINED, plus an explicit check that
 * the undefined side really is undefined (see the dedicated test below).
 */
const PARTIAL_DOMAIN: Record<string, (p: number[], x: number) => boolean> = {
  // defined for x >= b
  sqrt: (p, x) => x >= p[1],
  // defined for x > b: AT the asymptote a logarithm is already gone
  log: (p, x) => x > p[1],
  // defined everywhere except the pole itself
  recip: (p, x) => x !== p[1],
}

const IDS = Object.keys(MODELS)

const EVAL_FOR_KIND: Record<string, keyof ModelSpec> = {
  explicit: 'evalExplicit',
  polar: 'evalPolar',
  parametric: 'evalParametric',
  implicit: 'evalImplicit',
}

const SAMPLE_XS = [-3, -2.25, -1.5, -0.75, -0.1, 0, 0.1, 0.75, 1.5, 2.25, 3]
const SAMPLE_TS = [0, 0.4, 1, 1.9, Math.PI, 4.2, 5, 2 * Math.PI]

// ---------------------------------------------------------------------------

describe('MODELS — registry sanity', () => {
  it('every family is registered under its own id and has a human name', () => {
    for (const id of IDS) {
      const spec = MODELS[id]
      expect(spec.id, `${id}: id mismatch`).toBe(id)
      expect(typeof spec.name).toBe('string')
      expect(spec.name.length).toBeGreaterThan(0)
      expect(['explicit', 'polar', 'parametric', 'implicit']).toContain(spec.kind)
    }
  })

  it('every family has a sample parameter set in this test file', () => {
    // guards against a new family sneaking in untested
    for (const id of IDS) {
      expect(SAMPLES[id], `no SAMPLES entry for new model "${id}"`).toBeDefined()
      expect(SAMPLES[id].length).toBeGreaterThan(0)
    }
  })
})

describe.each(IDS)('MODELS.%s', (id) => {
  const spec = MODELS[id]
  const sets = SAMPLES[id]

  it('implements exactly the eval* matching its kind', () => {
    const wanted = EVAL_FOR_KIND[spec.kind]
    expect(typeof spec[wanted], `${id} is ${spec.kind} but has no ${String(wanted)}`).toBe('function')
    for (const [kind, key] of Object.entries(EVAL_FOR_KIND)) {
      if (kind === spec.kind) continue
      expect(spec[key], `${id} (${spec.kind}) must not implement ${String(key)}`).toBeUndefined()
    }
  })

  it('evaluates to finite values on sensible inputs', () => {
    for (const p of sets) {
      if (spec.evalExplicit) {
        const defined = PARTIAL_DOMAIN[id]
        for (const x of SAMPLE_XS) {
          if (defined && !defined(p, x)) continue // legitimately outside the domain
          const v = spec.evalExplicit(p, x)
          expect(Number.isFinite(v), `${id} f(${x}) = ${v} for params ${p}`).toBe(true)
        }
      }
      if (spec.evalPolar) {
        for (const t of SAMPLE_TS) {
          const v = spec.evalPolar(p, t)
          expect(Number.isFinite(v), `${id} r(${t}) = ${v}`).toBe(true)
        }
      }
      if (spec.evalParametric) {
        for (const t of SAMPLE_TS) {
          const v = spec.evalParametric(p, t)
          expect(Number.isFinite(v.x) && Number.isFinite(v.y), `${id} P(${t}) = ${JSON.stringify(v)}`).toBe(true)
        }
      }
      if (spec.evalImplicit) {
        for (const x of SAMPLE_XS) {
          for (const y of [-2, -0.5, 0, 0.5, 2]) {
            const v = spec.evalImplicit(p, x, y)
            expect(Number.isFinite(v), `${id} Q(${x},${y}) = ${v}`).toBe(true)
          }
        }
      }
    }
  })

  it('latex() is non-empty, brace-balanced and artifact-free', () => {
    for (const p of sets) {
      const tex = spec.latex(p)
      expect(typeof tex).toBe('string')
      expect(tex.trim().length, `${id}: empty latex for ${p}`).toBeGreaterThan(0)

      // balanced { }
      let depth = 0
      for (let i = 0; i < tex.length; i++) {
        if (tex[i] === '{' && tex[i - 1] !== '\\') depth++
        else if (tex[i] === '}' && tex[i - 1] !== '\\') depth--
        expect(depth, `${id}: brace underflow at ${i} in ${tex}`).toBeGreaterThanOrEqual(0)
      }
      expect(depth, `${id}: unbalanced braces in ${tex}`).toBe(0)

      // balanced \left ... \right
      const lefts = (tex.match(/\\left/g) ?? []).length
      const rights = (tex.match(/\\right/g) ?? []).length
      expect(rights, `${id}: \\left/\\right mismatch in ${tex}`).toBe(lefts)

      // sign / coefficient artifacts
      expect(tex, `${id}: "+ -" artifact in ${tex}`).not.toMatch(/\+\s*-/)
      expect(tex, `${id}: "- -" artifact in ${tex}`).not.toMatch(/-\s+-/)
      expect(tex, `${id}: redundant "1\\cdot" in ${tex}`).not.toMatch(/(^|[^0-9.])1\s*\\cdot(?!\s*10\^)/)
      expect(tex, `${id}: bare "1x" coefficient in ${tex}`).not.toMatch(/(^|[^0-9.])1x/)
      expect(tex, `${id}: raw JS exponent leaked into ${tex}`).not.toMatch(/[0-9]e[+-][0-9]/)
      expect(tex, `${id}: NaN/Infinity in ${tex}`).not.toMatch(/NaN|Infinity|undefined/)
    }
  })

  it('paramMeta() gives one usable slider per parameter', () => {
    for (const p of sets) {
      const metas = spec.paramMeta(p)
      expect(metas.length, `${id}: ${metas.length} metas for ${p.length} params`).toBe(p.length)
      const seen = new Set<string>()
      for (const m of metas) {
        expect(typeof m.name).toBe('string')
        expect(m.name.length, `${id}: unnamed param`).toBeGreaterThan(0)
        expect(seen.has(m.name), `${id}: duplicate param name "${m.name}"`).toBe(false)
        seen.add(m.name)
        expect(Number.isFinite(m.min), `${id}.${m.name}: min ${m.min}`).toBe(true)
        expect(Number.isFinite(m.max), `${id}.${m.name}: max ${m.max}`).toBe(true)
        expect(m.min, `${id}.${m.name}: min ${m.min} !< max ${m.max}`).toBeLessThan(m.max)
        expect(m.step, `${id}.${m.name}: step ${m.step}`).toBeGreaterThan(0)
        expect(m.step).toBeLessThanOrEqual(m.max - m.min)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// translate() exactness
// ---------------------------------------------------------------------------

describe('MODELS — translate() is exact', () => {
  const SHIFTS: Array<[number, number]> = [
    [1, 0], [0, 1], [-0.7, 2.3], [2.5, -1.25], [0, 0],
  ]

  it('rose, limacon and spiral legitimately omit translate', () => {
    for (const id of NO_TRANSLATE) {
      expect(MODELS[id].translate, `${id} should not implement translate`).toBeUndefined()
    }
  })

  it('every other family implements translate', () => {
    for (const id of IDS) {
      if (NO_TRANSLATE.has(id)) continue
      expect(typeof MODELS[id].translate, `${id} is missing translate`).toBe('function')
    }
  })

  const explicitIds = IDS.filter(
    id => MODELS[id].kind === 'explicit' && MODELS[id].translate,
  )
  it.each(explicitIds)('%s: f_t(x) === f(x - dx) + dy', (id) => {
    const spec = MODELS[id]
    for (const p of SAMPLES[id]) {
      for (const [dx, dy] of SHIFTS) {
        const q = spec.translate!(p, dx, dy)
        expect(q.every(Number.isFinite), `${id}: non-finite translate ${q}`).toBe(true)
        for (const x of SAMPLE_XS) {
          const want = spec.evalExplicit!(p, x - dx) + dy
          const got = spec.evalExplicit!(q, x)
          if (!Number.isFinite(want)) {
            // a partial-domain family must stay undefined at the shifted point
            expect(Number.isFinite(got), `${id}: x=${x} should still be undefined`).toBe(false)
            continue
          }
          expect(got, `${id} params=${p} d=(${dx},${dy}) x=${x}`)
            .toBeCloseTo(want, 9)
        }
      }
    }
  })

  const implicitIds = IDS.filter(
    id => MODELS[id].kind === 'implicit' && MODELS[id].translate,
  )
  it.each(implicitIds)('%s: Q_t(p + d) === Q(p)', (id) => {
    const spec = MODELS[id]
    const rng = makeRng(id.length * 977 + 11)
    for (const p of SAMPLES[id]) {
      for (const [dx, dy] of SHIFTS) {
        const q = spec.translate!(p, dx, dy)
        expect(q.every(Number.isFinite)).toBe(true)
        for (let i = 0; i < 20; i++) {
          const x = -4 + 8 * rng()
          const y = -4 + 8 * rng()
          const want = spec.evalImplicit!(p, x, y)
          const got = spec.evalImplicit!(q, x + dx, y + dy)
          expect(got, `${id} params=${p} d=(${dx},${dy}) at (${x},${y})`)
            .toBeCloseTo(want, 9)
        }
      }
    }
  })

  it('fourier: translate is a rigid shift of the traced point', () => {
    const spec = MODELS.fourier
    for (const p of SAMPLES.fourier) {
      for (const [dx, dy] of SHIFTS) {
        const q = spec.translate!(p, dx, dy)
        for (const t of SAMPLE_TS) {
          const a: Vec2 = spec.evalParametric!(p, t)
          const b: Vec2 = spec.evalParametric!(q, t)
          expect(b.x).toBeCloseTo(a.x + dx, 9)
          expect(b.y).toBeCloseTo(a.y + dy, 9)
        }
      }
    }
  })

  it('vline: translate shifts x and deliberately ignores dy', () => {
    // t IS the y coordinate of an infinite vertical line, so a vertical shift
    // maps the line onto itself; only dx is meaningful.
    const spec = MODELS.vline
    for (const p of SAMPLES.vline) {
      for (const [dx, dy] of SHIFTS) {
        const q = spec.translate!(p, dx, dy)
        expect(q).toHaveLength(1)
        expect(q[0]).toBeCloseTo(p[0] + dx, 12)
        for (const t of SAMPLE_TS) {
          expect(spec.evalParametric!(q, t).x).toBeCloseTo(spec.evalParametric!(p, t).x + dx, 12)
          expect(spec.evalParametric!(q, t).y).toBe(t)
        }
      }
    }
  })

  it('translate composes: translate(translate(p, a), b) === translate(p, a+b)', () => {
    for (const id of IDS) {
      const spec = MODELS[id]
      if (!spec.translate) continue
      for (const p of SAMPLES[id]) {
        const twice = spec.translate(spec.translate(p, 1.3, -0.4), 0.7, 2.1)
        const once = spec.translate(p, 2.0, 1.7)
        for (let i = 0; i < once.length; i++) {
          expect(twice[i], `${id} param ${i}`).toBeCloseTo(once[i], 8)
        }
      }
    }
  })

  it('translate by (0, 0) is the identity', () => {
    for (const id of IDS) {
      const spec = MODELS[id]
      if (!spec.translate) continue
      for (const p of SAMPLES[id]) {
        const q = spec.translate(p, 0, 0)
        expect(q, `${id}`).toHaveLength(p.length)
        for (let i = 0; i < p.length; i++) expect(q[i]).toBeCloseTo(p[i], 12)
      }
    }
  })

  it('translate does not mutate the input array', () => {
    for (const id of IDS) {
      const spec = MODELS[id]
      if (!spec.translate) continue
      for (const p of SAMPLES[id]) {
        const before = p.slice()
        spec.translate(p, 1.5, -2.5)
        expect(p, `${id} mutated its params`).toEqual(before)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Root / power families — the branch point is what makes them what they are.
// ---------------------------------------------------------------------------

describe('MODELS — root families', () => {
  it('sqrt is undefined left of its branch point and finite at/right of it', () => {
    const p = [2, 1, -0.5] // y = 2*sqrt(x - 1) - 0.5
    const ev = MODELS.sqrt.evalExplicit!
    for (const x of [0.999, 0.5, -3, -100]) {
      expect(Number.isFinite(ev(p, x)), `sqrt should be undefined at x=${x}`).toBe(false)
    }
    expect(ev(p, 1)).toBeCloseTo(-0.5, 12)   // exactly at the branch point
    expect(ev(p, 2)).toBeCloseTo(1.5, 12)    // 2*1 - 0.5
    expect(ev(p, 5)).toBeCloseTo(3.5, 12)    // 2*2 - 0.5
  })

  it('sqrt handles a downward branch (a < 0)', () => {
    const ev = MODELS.sqrt.evalExplicit!
    const p = [-1.5, 0, 2]
    expect(ev(p, 0)).toBeCloseTo(2, 12)
    expect(ev(p, 4)).toBeCloseTo(-1, 12)
    expect(ev(p, 1)).toBeLessThan(ev(p, 0)) // decreasing
  })

  it('cbrt is defined on both sides and is odd about its branch point', () => {
    const ev = MODELS.cbrt.evalExplicit!
    const p = [1.7, 1, -0.5]
    for (const d of [0.5, 2, 8, 27]) {
      const up = ev(p, 1 + d) - -0.5
      const dn = ev(p, 1 - d) - -0.5
      expect(up).toBeCloseTo(-dn, 12) // odd symmetry about (b, c)
      expect(Number.isFinite(ev(p, 1 - d))).toBe(true)
    }
    expect(ev(p, 1)).toBeCloseTo(-0.5, 12)
    expect(ev(p, 9)).toBeCloseTo(1.7 * 2 - 0.5, 12) // cbrt(8) = 2
  })

  it('power evaluates the fitted exponent symmetrically about the branch point', () => {
    const ev = MODELS.power.evalExplicit!
    const p = [1, 0.5, -1, 2 / 3]
    expect(ev(p, 0.5)).toBeCloseTo(-1, 12)
    // |x - b|^p is even about b (the cusp a hand actually draws)
    expect(ev(p, 0.5 + 1.3)).toBeCloseTo(ev(p, 0.5 - 1.3), 12)
    // p = 2 degenerates to a parabola
    expect(ev([2, 0, 0, 2], 3)).toBeCloseTo(18, 12)
  })

  it('root latex renders the right radical and formats signs cleanly', () => {
    expect(MODELS.sqrt.latex([1, 0, 0])).toBe('y = \\sqrt{x}')
    expect(MODELS.sqrt.latex([2, 1, -0.5])).toBe('y = 2\\sqrt{x - 1} - 0.5')
    expect(MODELS.sqrt.latex([-1.4, -2, 0])).toBe('y = -1.4\\sqrt{x + 2}')
    expect(MODELS.cbrt.latex([1, 0, 0])).toBe('y = \\sqrt[3]{x}')
    expect(MODELS.cbrt.latex([1.7, 1, -0.5])).toBe('y = 1.7\\sqrt[3]{x - 1} - 0.5')
    // a fitted exponent lands on 0.6667 and should read as a fraction
    expect(MODELS.power.latex([1, 0, 0, 0.6667])).toBe('y = \\left|x\\right|^{\\frac{2}{3}}')
    expect(MODELS.power.latex([1, 0, 0, 0.25])).toBe('y = \\left|x\\right|^{\\frac{1}{4}}')
  })

  it('root families translate exactly: b += dx, c += dy', () => {
    for (const id of ['sqrt', 'cbrt', 'power']) {
      const spec = MODELS[id]
      for (const p of SAMPLES[id]) {
        const q = spec.translate!(p, 1.5, -2.5)
        expect(q[0], `${id} scale changed`).toBeCloseTo(p[0], 12)
        expect(q[1], `${id} branch point`).toBeCloseTo(p[1] + 1.5, 12)
        expect(q[2], `${id} offset`).toBeCloseTo(p[2] - 2.5, 12)
        if (id === 'power') expect(q[3], 'exponent changed').toBeCloseTo(p[3], 12)
        // and the translated curve is the original curve, shifted
        const ev = spec.evalExplicit!
        for (const x of [2, 3.5, 6]) {
          const want = ev(p, x - 1.5) - 2.5
          if (!Number.isFinite(want)) continue
          expect(ev(q, x), `${id} at x=${x}`).toBeCloseTo(want, 10)
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// P0: the printed equation must BE the curve.
//
// fmt() used to round every number to 4 significant figures independently. That
// is a fixed RELATIVE error, and it is the wrong quantity twice over: the terms
// of a polynomial CANCEL, and a coordinate far from the origin carries its own
// magnitude, not the size of the feature it locates. So a parabola five screens
// right of the origin printed an equation deviating 10.3 units from a curve
// whose whole y-range was 9; a circle of radius 2 centred at 12345 printed a
// centre of 12350, a circle that does not meet the drawn one; a far ellipse
// printed a conic with no real solutions at all.
//
// The test below is the invariant, not the implementation: RENDER the latex,
// READ IT BACK (tests/latexEval.ts), and require the equation a student would
// copy off the screen to agree with the plotted curve to inside 1% of that
// curve's own y-range, over that curve's own domain.
// ---------------------------------------------------------------------------

const TWO_PI = 2 * Math.PI

interface Case { params: number[]; domain: [number, number] }

/** One representative, deliberately un-round curve per family. */
const FIDELITY_BASE: Record<string, Case[]> = {
  line: [{ params: [0.4321, 1.2345], domain: [-5, 5] }],
  poly2: [
    { params: [0.4321, -1.2345, 0.7654], domain: [-4, 4] },
    // vertex form, expanded: p'(x0) cancels to 2.2e-16 rather than to 0, which
    // is where "− 2.22·10⁻¹⁶(x − 3)" came from
    { params: [0.7, -1.8, 0.3], domain: [-4, 6] },
  ],
  poly3: [{ params: [0.4321, -1.2345, 0.7654, 0.1234], domain: [-5, 5] }],
  poly4: [{ params: [0.4321, -1.2345, 0.7654, 0.1234, -0.0432], domain: [-4, 4] }],
  sine: [{ params: [1.2345, 1.4321, 0.3456, 0.4321], domain: [-6, 6] }],
  gauss: [{ params: [2.3456, 0.4321, 1.2345, -0.5432], domain: [-6, 6] }],
  exp: [{ params: [1.2345, 0.4321, -0.7654], domain: [-3, 4] }],
  // domain starts right of the branch point, where the family is defined
  sqrt: [{ params: [1.7654, -1.2345, 0.4321], domain: [-0.7345, 8] }],
  // likewise right of the asymptote at b = -1.2345
  log: [{ params: [1.7654, -1.2345, 0.4321], domain: [-0.7345, 8] }],
  // one branch, clear of the pole at b = -1.2345
  recip: [{ params: [1.7654, -1.2345, 0.4321], domain: [-0.7345, 8] }],
  cbrt: [{ params: [1.7654, 0.4321, -0.5432], domain: [-5, 6] }],
  power: [{ params: [1.2345, 0.4321, -0.7654, 0.6667], domain: [-4, 5] }],
  abs: [{ params: [1.2345, 0.4321, -0.7654], domain: [-5, 5] }],
  logistic: [{ params: [3.4321, 1.2345, 0.4321, -0.7654], domain: [-6, 6] }],
  vline: [{ params: [1.2345], domain: [-5, 5] }],
  circle: [{ params: [0.4321, -0.7654, 2.3456], domain: [0, TWO_PI] }],
  ellipse: [
    { params: centerFormToConic({ cx: 0.4321, cy: -0.7654, rx: 3.2345, ry: 2.1234, angle: 0 })!, domain: [0, TWO_PI] },
    { params: centerFormToConic({ cx: 0.4321, cy: -0.7654, rx: 3.2345, ry: 2.1234, angle: 0.4 })!, domain: [0, TWO_PI] },
  ],
  // polar families have no translate(); their far-from-origin case is a large
  // constant next to a small variation, which is the same cancellation
  polarRose: [
    { params: [2.3456, 3, 0.4321], domain: [0, TWO_PI] },
    { params: [2.3456, 3, 1234.5678], domain: [0, TWO_PI] },
  ],
  limacon: [
    { params: [1.2345, 1.7654], domain: [0, TWO_PI] },
    { params: [12345.6789, 1.7654], domain: [0, TWO_PI] },
  ],
  spiral: [
    { params: [0.4321, 0.7654], domain: [0, TWO_PI] },
    { params: [12345.6789, 0.7654], domain: [0, TWO_PI] },
  ],
  fourier: [
    // N = 1: for N > 1 the latex deliberately abbreviates with "+ \cdots"
    { params: [0.4321, -0.7654, 1.2345, 0.3456, -0.4321, 1.1234], domain: [0, TWO_PI] },
  ],
}

/** How far the drawn curve sits from the origin, in math units. */
const FIDELITY_SHIFTS: Array<[number, number]> = [
  [0, 0],
  [123.456, 0],
  [12345.6789, 0],
  [0, 12345.6789],
  [98765.4321, -54321.9876],
  [1234567.89, 0],
]

/**
 * An exponential cannot be carried far in x at all: translating a·e^{bx} by dx
 * scales a by e^{−b·dx}, which underflows to zero past dx ≈ 700/b — the curve
 * itself stops being representable, never mind its equation. So it gets
 * horizontal shifts inside that range, and the full vertical ones.
 */
const EXP_SHIFTS: Array<[number, number]> = [
  [0, 0], [30, 0], [120, 0], [0, 12345.6789], [0, -54321.9876], [120, 98765.4321],
]

/**
 * How far a polynomial can be carried before its own STORAGE, not its
 * equation, loses the curve. Params are ascending coefficients, so evaluating a
 * cubic centred at 1.2e6 sums four terms of ~1e17 that cancel to ~100: at
 * double precision that arithmetic is worth about ±200, which no amount of
 * printed precision can recover. Measured horner noise over the fixture
 * windows: poly3 is 9e-2 at 1e5 and 2e2 at 1.2e6; poly4 is 2e-4 at 1.2e3 and
 * 6.9e-1 at 1.2e4. These caps keep each degree inside its representable range,
 * so a failure here means the FORMATTER lost the curve.
 */
const MAX_SHIFT: Record<string, number> = { poly3: 1e5, poly4: 2e3 }

function fidelityCases(id: string): Case[] {
  const base = FIDELITY_BASE[id]
  const spec = MODELS[id]
  const cap = MAX_SHIFT[id] ?? Infinity
  const shifts = (id === 'exp' ? EXP_SHIFTS : FIDELITY_SHIFTS)
    .filter(([dx]) => Math.abs(dx) <= cap)
  const out: Case[] = []
  for (const c of base) {
    if (!spec.translate) { out.push(c); continue }
    for (const [dx, dy] of shifts) {
      const params = spec.translate(c.params, dx, dy)
      // an explicit family's domain travels with it; a closed or parametric
      // one is swept over the same parameter interval wherever it sits
      const domain: [number, number] = spec.kind === 'explicit'
        ? [c.domain[0] + dx, c.domain[1] + dx]
        : c.domain
      out.push({ params, domain })
    }
  }
  return out
}

function extentY(pts: Vec2[]): number {
  let lo = Infinity
  let hi = -Infinity
  for (const p of pts) {
    if (!Number.isFinite(p.y)) continue
    lo = Math.min(lo, p.y)
    hi = Math.max(hi, p.y)
  }
  return hi > lo ? hi - lo : 0
}

/** Geometric distance from (x, y) to the printed conic Q = 0: |Q| / |grad Q|. */
function conicDistance(Q: (x: number, y: number) => number, x: number, y: number): number {
  const hx = 1e-6 * Math.max(1, Math.abs(x))
  const hy = 1e-6 * Math.max(1, Math.abs(y))
  const q = Q(x, y)
  const gx = (Q(x + hx, y) - Q(x - hx, y)) / (2 * hx)
  const gy = (Q(x, y + hy) - Q(x, y - hy)) / (2 * hy)
  const g = Math.hypot(gx, gy)
  return g > 0 ? Math.abs(q) / g : Infinity
}

/** max deviation of the PRINTED equation from the true curve, and the curve's y-range. */
function fidelity(id: string, c: Case): { dev: number; range: number; tex: string } {
  const spec = MODELS[id]
  const tex = spec.latex(c.params)
  const [lo, hi] = c.domain
  const n = 400
  const at = (i: number) => lo + ((hi - lo) * i) / n

  if (spec.evalExplicit) {
    const printed = compileRhs(tex)
    const pts: Vec2[] = []
    let dev = 0
    for (let i = 0; i <= n; i++) {
      const x = at(i)
      const yTrue = spec.evalExplicit(c.params, x)
      if (!Number.isFinite(yTrue)) continue
      pts.push({ x, y: yTrue })
      const yPrinted = printed(x, 0, 0)
      // undefined where the true curve exists is an infinite deviation
      dev = Math.max(dev, Number.isFinite(yPrinted) ? Math.abs(yPrinted - yTrue) : Infinity)
    }
    return { dev, range: extentY(pts), tex }
  }

  if (spec.evalPolar) {
    const printed = compileRhs(tex)
    const pts: Vec2[] = []
    let dev = 0
    for (let i = 0; i <= n; i++) {
      const t = at(i)
      const rTrue = spec.evalPolar(c.params, t)
      const rPrinted = printed(0, 0, t)
      pts.push({ x: rTrue * Math.cos(t), y: rTrue * Math.sin(t) })
      dev = Math.max(dev, Number.isFinite(rPrinted) ? Math.abs(rPrinted - rTrue) : Infinity)
    }
    return { dev, range: extentY(pts), tex }
  }

  if (id === 'vline') {
    const printed = compileRhs(tex)(0, 0, 0)
    return { dev: Math.abs(printed - c.params[0]), range: hi - lo, tex }
  }

  if (id === 'fourier') {
    const printed = compileFourier(tex)
    const pts: Vec2[] = []
    let dev = 0
    for (let i = 0; i <= n; i++) {
      const t = at(i)
      const a = spec.evalParametric!(c.params, t)
      const b = printed(t)
      pts.push(a)
      dev = Math.max(dev, Math.hypot(b.x - a.x, b.y - a.y))
    }
    return { dev, range: extentY(pts), tex }
  }

  // implicit conics: the deviation is how far the drawn curve lies from the
  // curve the printed equation describes
  const Q = compileImplicit(tex)
  const pts: Vec2[] = []
  if (id === 'circle') {
    const [a, b, r] = c.params
    for (let i = 0; i <= n; i++) {
      const t = at(i)
      pts.push({ x: a + r * Math.cos(t), y: b + r * Math.sin(t) })
    }
  } else {
    const cf = conicToCenterForm(c.params)
    if (!cf) throw new Error(`${id}: conicToCenterForm refused ${c.params}`)
    const co = Math.cos(cf.angle)
    const si = Math.sin(cf.angle)
    for (let i = 0; i <= n; i++) {
      const t = at(i)
      const u = cf.rx * Math.cos(t)
      const v = cf.ry * Math.sin(t)
      pts.push({ x: cf.cx + u * co - v * si, y: cf.cy + u * si + v * co })
    }
  }
  let dev = 0
  for (const p of pts) dev = Math.max(dev, conicDistance(Q, p.x, p.y))
  return { dev, range: extentY(pts), tex }
}

describe('MODELS — the printed equation IS the curve', () => {
  it('every family has a fidelity fixture', () => {
    for (const id of IDS) {
      expect(FIDELITY_BASE[id], `no fidelity fixture for new model "${id}"`).toBeDefined()
    }
  })

  it.each(IDS)('%s: the rendered latex reproduces the curve within 1%% of its y-range', (id) => {
    for (const c of fidelityCases(id)) {
      const { dev, range, tex } = fidelity(id, c)
      expect(range, `${id}: degenerate fixture, no y-range`).toBeGreaterThan(0)
      expect(
        dev / range,
        `${id} params=[${c.params.map(v => String(v)).join(', ')}] domain=[${c.domain}]\n` +
        `  printed: ${tex}\n  deviation ${dev} vs y-range ${range}`,
      ).toBeLessThan(0.01)
    }
  })
})

// ---------------------------------------------------------------------------
// P0, the other half: the printed equation must say NOTHING BUT the curve.
//
// Fidelity above asks whether the printed equation reproduces the curve. It
// cannot catch the opposite failure, because a term worth 1e-16 reproduces the
// curve perfectly — it just makes a teacher's parabola read
//
//     y = 0.3(x − 3)² − 2.22·10⁻¹⁶(x − 3) − 2
//
// in front of a class. So: mute each printed number in turn and require the
// curve to NOTICE. A number the curve cannot feel across its own domain, to
// better than a billionth of its own y-range, is arithmetic residue that
// escaped into the product, and the threshold is relative to the shape rather
// than absolute — an absolute floor is what once erased a real exponential
// amplitude of 1e-23.
// ---------------------------------------------------------------------------

/** Below this fraction of the curve's y-range, a term is not on the graph. */
const INVISIBLE = 1e-9

const EXPLICIT_IDS = IDS.filter((id) => MODELS[id].evalExplicit !== undefined)

describe('MODELS — a printed equation asserts nothing it does not mean', () => {
  it.each(EXPLICIT_IDS)('%s: every number it prints changes the curve it prints', (id) => {
    const spec = MODELS[id]
    for (const c of fidelityCases(id)) {
      const tex = spec.latex(c.params)
      const rhs = tex.slice(tex.indexOf(' = ') + 3)
      const printed = compileLatex(rhs)
      const [lo, hi] = c.domain
      const n = 200
      const xs: number[] = []
      const ys: number[] = []
      for (let i = 0; i <= n; i++) {
        const x = lo + ((hi - lo) * i) / n
        const yTrue = spec.evalExplicit!(c.params, x)
        if (!Number.isFinite(yTrue)) continue
        xs.push(x)
        ys.push(printed(x, 0, 0))
      }
      const range = extentY(xs.map((x, i) => ({ x, y: ys[i] })))
      expect(range, `${id}: degenerate fixture, no y-range`).toBeGreaterThan(0)

      for (const span of valueSpans(rhs)) {
        const muted = compileLatex(muteValue(rhs, span))
        let dev = 0
        for (let i = 0; i < xs.length; i++) {
          const v = muted(xs[i], 0, 0)
          dev = Math.max(dev, Number.isFinite(v) ? Math.abs(v - ys[i]) : Infinity)
        }
        expect(
          dev / range,
          `${id} params=[${c.params.map(String).join(', ')}]\n` +
          `  printed: ${tex}\n` +
          `  the number "${rhs.slice(span[0], span[1])}" is invisible: ` +
          `muting it moves the curve by ${dev} against a y-range of ${range}`,
        ).toBeGreaterThan(INVISIBLE)
      }
    }
  })
})

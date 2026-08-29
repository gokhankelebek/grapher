// ============================================================================
// tests/models.test.ts — MODELS registry invariants, applied to EVERY family.
//   * the eval* matching `kind` exists and produces finite values
//   * latex() is non-empty, brace-balanced, artifact-free
//   * paramMeta() is one usable slider per parameter
//   * translate(), where implemented, is EXACT
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { ModelSpec, Vec2 } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { makeRng } from './helpers'

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
        for (const x of SAMPLE_XS) {
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

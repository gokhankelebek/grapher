// ============================================================================
// tests/edit.test.ts — the editing math (src/core/fit/edit.ts).
//   getHandles / applyHandleDrag / dragCurvePoint / oversketch / snapParams
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { FittedCurve, Vec2 } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { conicToCenterForm } from '../src/core/fit/optimize'
import {
  getHandles, applyHandleDrag, dragCurvePoint, oversketch, snapParams, nearestOnCurve,
  applyFeatureEdit,
} from '../src/core/fit/edit'
import { analyzeCurve } from '../src/core/analyze'
import type { ModelSpec, SpecialPoint, SpecialPointKind } from '../src/core/types'
import { makeRng, makeGauss } from './helpers'

const SQRT_LN2 = Math.sqrt(Math.LN2)

function curve(
  modelId: string,
  params: number[],
  domain: [number, number] | null,
  error = 0.02,
): FittedCurve {
  return {
    id: 'test-curve',
    modelId,
    params,
    kind: MODELS[modelId].kind,
    domain,
    color: '#4f9cf9',
    strokeWidth: 2.5,
    visible: true,
    error,
  }
}

/** One representative curve per family. */
const FAMILY_FIXTURES: Array<[string, number[], [number, number] | null]> = [
  ['line', [-1, 0.8], [-6, 6]],
  ['poly2', [-1, 0, 0.4], [-5, 5]],
  ['poly3', [0.5, -0.3, 0, 0.05], [-6, 6]],
  ['poly4', [1, 2, 3, 4, 0.1], [-3, 3]],
  ['sine', [1.5, 1.2, 0.3, 0.4], [-7, 7]],
  ['gauss', [3, 0.5, 1.2, -1], [-6, 7]],
  ['exp', [0.4, 0.6, -1], [-6, 4]],
  ['abs', [1.2, 0.7, -2], [-5, 6]],
  ['logistic', [4, 1.8, 0.5, -2], [-6, 7]],
  ['log', [1.6, -4.5, 0], [-4.5, 6]],
  ['recip', [1.5, -1, 0.5], [-6, 6]],
  ['sqrt', [2, -1, 0.5], [-1, 8]],
  ['cbrt', [1.7, 1, -0.5], [-6, 8]],
  ['power', [1, 0, 0, 2 / 3], [-4, 4]],
  ['vline', [2], [-4, 4]],
  ['circle', [0, 0, 2.5], null],
  ['ellipse', [0.2052, -0.3197, 0.331, 0.0001, 0.001, -0.8638], null],
  ['polarRose', [3, 3, 0.7], [0, 2 * Math.PI]],
  ['limacon', [1, 2], [0, 2 * Math.PI]],
  ['spiral', [0.25, 0.33], [0, 4 * Math.PI]],
  ['fourier', [0, 0, 1, 0, 0, 1, 0.2, 0.1, -0.1, 0.2], [0, 2 * Math.PI]],
]

// ---------------------------------------------------------------------------
// getHandles
// ---------------------------------------------------------------------------

describe('getHandles', () => {
  it.each(FAMILY_FIXTURES)('%s: returns finite, sensible handles', (id, params, domain) => {
    const hs = getHandles(curve(id, params, domain), MODELS)
    expect(hs.length, `${id}: no handles`).toBeGreaterThan(0)
    const ids = new Set<string>()
    for (const h of hs) {
      expect(Number.isFinite(h.pos.x), `${id}.${h.id}: x = ${h.pos.x}`).toBe(true)
      expect(Number.isFinite(h.pos.y), `${id}.${h.id}: y = ${h.pos.y}`).toBe(true)
      expect(h.id.length).toBeGreaterThan(0)
      expect(ids.has(h.id), `${id}: duplicate handle id "${h.id}"`).toBe(false)
      ids.add(h.id)
      expect(['feature', 'domain-start', 'domain-end', 'center', 'radius', 'rotation'])
        .toContain(h.kind)
    }
  })

  it.each(FAMILY_FIXTURES)('%s: every handle sits on (or meaningfully near) its curve', (id, params, domain) => {
    // Domain / center / rotation handles are deliberately off-curve, and so
    // are the "knob" handles that set a scalar property rather than mark a
    // point (poly2 curvature, sine midline, logistic steepness). `asymptote`
    // is off-curve BY DEFINITION: it marks the line the curve approaches and
    // never reaches — for a log the vertical asymptote x = b, for a hyperbola
    // the crossing point (b, c) of both asymptotes. Every other feature/radius
    // handle must sit ON the curve.
    const KNOBS = new Set(['width', 'midline', 'rate', 'asymptote'])
    const c = curve(id, params, domain)
    const hs = getHandles(c, MODELS)
    for (const h of hs) {
      if (h.kind !== 'feature' && h.kind !== 'radius') continue
      if (KNOBS.has(h.id)) continue
      const near = nearestOnCurve(c, MODELS, h.pos)
      expect(near.dist, `${id}.${h.id} at (${h.pos.x}, ${h.pos.y}) is ${near.dist} off the curve`)
        .toBeLessThan(0.05)
    }
  })

  it('explicit families expose both domain trim handles at the domain ends', () => {
    // `sqrt` is the exception: its domain STARTS at the branch point, which is
    // already draggable as the "branch" handle. A domain-start handle there
    // would offer to trim into a region where the curve does not exist.
    // `log` is the same story one step further: it does not merely start at
    // its asymptote, it is undefined there.
    const NO_DOMAIN_START = new Set(['sqrt', 'log'])
    for (const [id, params, domain] of FAMILY_FIXTURES) {
      const spec = MODELS[id]
      if (spec.kind !== 'explicit' || !domain) continue
      const hs = getHandles(curve(id, params, domain), MODELS)
      const s = hs.find(h => h.id === 'domain-start')
      const e = hs.find(h => h.id === 'domain-end')
      expect(e, `${id}: no domain-end`).toBeDefined()
      expect(e!.pos.x).toBeCloseTo(domain[1], 9)
      if (NO_DOMAIN_START.has(id)) {
        expect(s, `${id}: should not offer domain-start`).toBeUndefined()
        expect(e!.pos.y).toBeCloseTo(spec.evalExplicit!(params, domain[1]), 9)
        continue
      }
      expect(s, `${id}: no domain-start`).toBeDefined()
      expect(s!.pos.x).toBeCloseTo(domain[0], 9)
      expect(e!.pos.x).toBeCloseTo(domain[1], 9)
      expect(s!.pos.y).toBeCloseTo(spec.evalExplicit!(params, domain[0]), 9)
      expect(e!.pos.y).toBeCloseTo(spec.evalExplicit!(params, domain[1]), 9)
    }
  })

  it('specific feature handles land where the math says they should', () => {
    // parabola vertex
    const p2 = getHandles(curve('poly2', [-1, 0, 0.4], [-5, 5]), MODELS)
    const vertex = p2.find(h => h.id === 'vertex')!
    expect(vertex.pos.x).toBeCloseTo(0, 9)
    expect(vertex.pos.y).toBeCloseTo(-1, 9)

    // gauss peak and HWHM width knob
    const g = getHandles(curve('gauss', [3, 0.5, 1.2, -1], [-6, 7]), MODELS)
    expect(g.find(h => h.id === 'peak')!.pos).toEqual({ x: 0.5, y: 2 })
    expect(g.find(h => h.id === 'width')!.pos.x).toBeCloseTo(0.5 + 1.2 * SQRT_LN2, 9)

    // circle center / radius
    const c = getHandles(curve('circle', [1, -2, 3], null), MODELS)
    expect(c.find(h => h.id === 'center')!.pos).toEqual({ x: 1, y: -2 })
    const rh = c.find(h => h.id === 'radius')!
    expect(Math.hypot(rh.pos.x - 1, rh.pos.y + 2)).toBeCloseTo(3, 9)

    // abs vertex is the kink
    const a = getHandles(curve('abs', [1.2, 0.7, -2], [-5, 6]), MODELS)
    expect(a.find(h => h.id === 'vertex')!.pos).toEqual({ x: 0.7, y: -2 })

    // sine crest sits at the midline + amplitude
    const s = getHandles(curve('sine', [1.5, 1.2, 0.3, 0.4], [-7, 7]), MODELS)
    expect(s.find(h => h.id === 'crest')!.pos.y).toBeCloseTo(1.9, 9)
  })

  it('an unknown model yields no handles instead of throwing', () => {
    const bogus = { ...curve('line', [0, 1], [-1, 1]), modelId: 'nope' }
    expect(() => getHandles(bogus, MODELS)).not.toThrow()
    expect(getHandles(bogus, MODELS)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// applyHandleDrag
// ---------------------------------------------------------------------------

describe('applyHandleDrag — closed-form identities', () => {
  it('circle radius drag sets r = |target - center| EXACTLY', () => {
    const c = curve('circle', [1, -2, 2], null)
    for (const target of [{ x: 4.5, y: 1.5 }, { x: -3, y: -2 }, { x: 1, y: 3 }]) {
      const { params } = applyHandleDrag(c, MODELS, 'radius', target)
      expect(params[0]).toBe(1)   // center untouched
      expect(params[1]).toBe(-2)
      expect(params[2]).toBe(Math.hypot(target.x - 1, target.y + 2))
    }
  })

  it('circle center drag is a pure translation of the center', () => {
    const c = curve('circle', [1, -2, 2], null)
    const { params } = applyHandleDrag(c, MODELS, 'center', { x: -3, y: 4 })
    expect(params).toEqual([-3, 4, 2])
  })

  it('a degenerate radius drag onto the center leaves r unchanged', () => {
    const c = curve('circle', [1, -2, 2], null)
    const { params } = applyHandleDrag(c, MODELS, 'radius', { x: 1, y: -2 })
    expect(params[2]).toBe(2)
  })

  it('sine crest vertical drag sets the amplitude (a = target.y - midline)', () => {
    const p = [1.5, 1.2, 0.3, 0.4]
    const c = curve('sine', p, [-7, 7])
    const crest = getHandles(c, MODELS).find(h => h.id === 'crest')!
    for (const y of [3.4, -0.6, 0.9]) {
      const { params } = applyHandleDrag(c, MODELS, 'crest', { x: crest.pos.x, y })
      expect(params[0]).toBeCloseTo(y - p[3], 12)   // amplitude
      expect(params[1]).toBe(p[1])                  // frequency untouched
      expect(params[2]).toBeCloseTo(p[2], 12)       // pure vertical drag: no phase change
      expect(params[3]).toBe(p[3])                  // midline untouched
      // the new crest really is at the dragged height
      const nc = { ...c, params }
      expect(getHandles(nc, MODELS).find(h => h.id === 'crest')!.pos.y).toBeCloseTo(y, 9)
    }
  })

  it('sine crest horizontal drag is a pure phase shift', () => {
    const p = [1.5, 1.2, 0.3, 0.4]
    const c = curve('sine', p, [-7, 7])
    const crest = getHandles(c, MODELS).find(h => h.id === 'crest')!
    const dx = 0.8
    const { params } = applyHandleDrag(c, MODELS, 'crest', { x: crest.pos.x + dx, y: crest.pos.y })
    expect(params[0]).toBeCloseTo(p[0], 12)
    expect(params[1]).toBe(p[1])
    expect(params[2]).toBeCloseTo(p[2] - p[1] * dx, 12)
    // that is exactly the model's own horizontal translation
    const translated = MODELS.sine.translate!(p, dx, 0)
    for (let i = 0; i < 4; i++) expect(params[i]).toBeCloseTo(translated[i], 9)
  })

  it('sine midline drag moves only the offset; wavelength drag sets the period', () => {
    const p = [1.5, 1.2, 0.3, 0.4]
    const c = curve('sine', p, [-7, 7])
    const mid = applyHandleDrag(c, MODELS, 'midline', { x: 0, y: -1.25 })
    expect(mid.params[3]).toBe(-1.25)
    expect(mid.params.slice(0, 3)).toEqual(p.slice(0, 3))

    const crest = getHandles(c, MODELS).find(h => h.id === 'crest')!
    const period = 4
    const wl = applyHandleDrag(c, MODELS, 'wavelength', { x: crest.pos.x + period, y: crest.pos.y })
    expect(wl.params[1]).toBeCloseTo((2 * Math.PI) / period, 12)
    // the reference crest stays put
    const nc = { ...c, params: wl.params }
    expect(getHandles(nc, MODELS).find(h => h.id === 'crest')!.pos.x).toBeCloseTo(crest.pos.x, 6)
  })

  it('gauss width drag uses the HWHM relation c = |dx| / sqrt(ln 2)', () => {
    const p = [3, 0.5, 1.2, -1]
    const c = curve('gauss', p, [-6, 7])
    for (const want of [2, 0.6, 3.5]) {
      const target = { x: p[1] + want * SQRT_LN2, y: 0 }
      const { params } = applyHandleDrag(c, MODELS, 'width', target)
      expect(params[2]).toBeCloseTo(want, 12)
      expect(params[0]).toBe(p[0])
      expect(params[1]).toBe(p[1])
      expect(params[3]).toBe(p[3])
      // round trip: the width handle comes back to the dragged x
      const nh = getHandles({ ...c, params }, MODELS).find(h => h.id === 'width')!
      expect(nh.pos.x).toBeCloseTo(target.x, 9)
      // and it really is the half-maximum point
      expect(MODELS.gauss.evalExplicit!(params, nh.pos.x)).toBeCloseTo(p[3] + p[0] / 2, 9)
    }
  })

  it('gauss peak drag repositions and rescales the bell', () => {
    const p = [3, 0.5, 1.2, -1]
    const { params } = applyHandleDrag(curve('gauss', p, [-6, 7]), MODELS, 'peak', { x: -2, y: 4 })
    expect(params[1]).toBe(-2)
    expect(params[0]).toBeCloseTo(4 - p[3], 12)
    expect(MODELS.gauss.evalExplicit!(params, -2)).toBeCloseTo(4, 9)
  })

  it('ellipse axis drags round-trip through the center form', () => {
    const p = [0.2052, -0.3197, 0.331, 0.0001, 0.001, -0.8638]
    const c = curve('ellipse', p, null)
    const center = getHandles(c, MODELS).find(h => h.id === 'center')!.pos

    for (const [len, phi] of [[3.5, 0.9], [1.1, -0.4], [2.7, 2.2]] as Array<[number, number]>) {
      const target = { x: center.x + len * Math.cos(phi), y: center.y + len * Math.sin(phi) }
      const { params } = applyHandleDrag(c, MODELS, 'axis-a', target)
      expect(params.every(Number.isFinite)).toBe(true)
      // the dragged point must now lie ON the ellipse
      const near = nearestOnCurve({ ...c, params }, MODELS, target)
      expect(near.dist, `axis-a drag to len=${len} phi=${phi}`).toBeLessThan(1e-6)
      // and the center must not have moved
      const nCenter = getHandles({ ...c, params }, MODELS).find(h => h.id === 'center')!.pos
      expect(nCenter.x).toBeCloseTo(center.x, 6)
      expect(nCenter.y).toBeCloseTo(center.y, 6)
    }

    // axis-b likewise
    const target = { x: center.x + 1.9 * Math.cos(2.1), y: center.y + 1.9 * Math.sin(2.1) }
    const { params } = applyHandleDrag(c, MODELS, 'axis-b', target)
    expect(nearestOnCurve({ ...c, params }, MODELS, target).dist).toBeLessThan(1e-6)
  })

  it('ellipse center drag translates without reshaping', () => {
    const p = [0.2052, -0.3197, 0.331, 0.0001, 0.001, -0.8638]
    const c = curve('ellipse', p, null)
    const before = conicToCenterForm(p)!
    const { params } = applyHandleDrag(c, MODELS, 'center', { x: 3, y: -1 })
    const after = conicToCenterForm(params)!
    expect(after.cx).toBeCloseTo(3, 6)
    expect(after.cy).toBeCloseTo(-1, 6)
    expect(after.rx).toBeCloseTo(before.rx, 6)
    expect(after.ry).toBeCloseTo(before.ry, 6)
  })

  it('abs vertex drag sets the kink exactly', () => {
    const { params } = applyHandleDrag(curve('abs', [1.2, 0.7, -2], [-5, 6]), MODELS, 'vertex', { x: -1.5, y: 3 })
    expect(params).toEqual([1.2, -1.5, 3])
  })

  it('vline position drag sets x; domain handles trim vertically', () => {
    const c = curve('vline', [2], [-4, 4])
    expect(applyHandleDrag(c, MODELS, 'position', { x: -1.25, y: 99 }).params).toEqual([-1.25])
    expect(applyHandleDrag(c, MODELS, 'domain-start', { x: 2, y: -1 }).domain).toEqual([-1, 4])
    expect(applyHandleDrag(c, MODELS, 'domain-end', { x: 2, y: 1 }).domain).toEqual([-4, 1])
  })

  it('explicit domain handles trim without touching params', () => {
    for (const [id, params, domain] of FAMILY_FIXTURES) {
      if (MODELS[id].kind !== 'explicit' || !domain) continue
      const c = curve(id, params, domain)
      const trimmed = applyHandleDrag(c, MODELS, 'domain-end', { x: domain[1] - 1, y: 0 })
      expect(trimmed.domain![1], id).toBeCloseTo(domain[1] - 1, 9)
      expect(trimmed.domain![0], id).toBeCloseTo(domain[0], 9)
      if (id !== 'line') expect(trimmed.params, id).toEqual(params) // line pivots by design
    }
  })

  it('a domain handle can never invert the domain', () => {
    const c = curve('poly2', [-1, 0, 0.4], [-5, 5])
    const r = applyHandleDrag(c, MODELS, 'domain-start', { x: 99, y: 0 })
    expect(r.domain![0]).toBeLessThan(r.domain![1])
  })

  it('polarRose petal-tip drag preserves the integral petal count', () => {
    const c = curve('polarRose', [3, 3, 0.7], [0, 2 * Math.PI])
    const { params } = applyHandleDrag(c, MODELS, 'petal-tip', { x: 1.5, y: 1.5 })
    expect(params[1]).toBe(3)
    expect(params[0]).toBeCloseTo(Math.hypot(1.5, 1.5), 12)
  })

  it('an unknown handle id and a non-finite target both leave the curve alone', () => {
    const c = curve('circle', [1, -2, 2], null)
    expect(applyHandleDrag(c, MODELS, 'no-such-handle', { x: 1, y: 1 }).params).toEqual([1, -2, 2])
    expect(applyHandleDrag(c, MODELS, 'radius', { x: NaN, y: 1 }).params).toEqual([1, -2, 2])
    expect(applyHandleDrag(c, MODELS, 'radius', { x: Infinity, y: 1 }).params).toEqual([1, -2, 2])
  })

  it('dragging every handle of every family keeps params finite', () => {
    for (const [id, params, domain] of FAMILY_FIXTURES) {
      const c = curve(id, params, domain)
      for (const h of getHandles(c, MODELS)) {
        for (const d of [{ x: 1.3, y: -0.7 }, { x: -2.5, y: 3.1 }, { x: 0, y: 0 }]) {
          const target = { x: h.pos.x + d.x, y: h.pos.y + d.y }
          const r = applyHandleDrag(c, MODELS, h.id, target)
          expect(r.params.every(Number.isFinite), `${id}.${h.id} -> ${r.params}`).toBe(true)
          expect(r.params.length, `${id}.${h.id}`).toBe(params.length)
          if (r.domain) {
            expect(Number.isFinite(r.domain[0]) && Number.isFinite(r.domain[1]), `${id}.${h.id}`).toBe(true)
          }
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// dragCurvePoint
// ---------------------------------------------------------------------------

/** Largest displacement of the curve at parameter values > half a domain from the grab. */
function farDisplacement(
  c: FittedCurve, oldParams: number[], newParams: number[], grabT: number,
): number {
  const spec = MODELS[c.modelId]
  const dom = c.domain!
  const span = dom[1] - dom[0]
  const cyclic = spec.kind !== 'explicit'
  let worst = 0
  for (let i = 0; i <= 240; i++) {
    const t = dom[0] + (span * i) / 240
    let d = Math.abs(t - grabT)
    if (cyclic) d = Math.min(d, span - d)
    if (d <= 0.5 * span) continue
    if (spec.kind === 'explicit') {
      worst = Math.max(worst, Math.abs(spec.evalExplicit!(newParams, t) - spec.evalExplicit!(oldParams, t)))
    } else {
      const a = spec.evalParametric!(oldParams, t)
      const b = spec.evalParametric!(newParams, t)
      worst = Math.max(worst, Math.hypot(b.x - a.x, b.y - a.y))
    }
  }
  return worst
}

describe('dragCurvePoint — the grabbed point follows the cursor', () => {
  const dragCases: Array<[string, number[], [number, number], number, number]> = [
    // [id, params, domain, grab-x (or grab-t), drag magnitude]
    ['sine', [1.5, Math.PI / 10, 0, 0], [-5, 5], 0, 0.6],
    ['sine', [1.5, 1.2, 0.3, 0.4], [-7, 7], 0, 1],
    ['poly3', [0.5, -0.3, 0, 0.05], [-6, 6], 0, 1],
    ['poly3', [0.5, -0.3, 0, 0.05], [-6, 6], -6, 1],
  ]

  it.each(dragCases)('%s: lands within 2%% of the drag distance', (id, params, domain, gx, dy) => {
    const c = curve(id, params, domain)
    const ev = MODELS[id].evalExplicit!
    for (const sign of [1, -1]) {
      const grab: Vec2 = { x: gx, y: ev(params, gx) }
      const target: Vec2 = { x: gx, y: grab.y + sign * dy }
      const np = dragCurvePoint(c, MODELS, grab, target)
      expect(np.every(Number.isFinite)).toBe(true)
      const landed = Math.abs(ev(np, target.x) - target.y)
      expect(landed / dy, `${id}: landed ${landed} for drag ${dy}`).toBeLessThan(0.02)
    }
  })

  it('fourier: the grabbed point lands within 2% of the drag distance', () => {
    const params = [0, 0, 2, 0, 0, 2, 0.2, 0.1, -0.1, 0.2]
    const c = curve('fourier', params, [0, 2 * Math.PI])
    const ev = MODELS.fourier.evalParametric!
    for (const [dx, dy] of [[1, 0], [0, -0.7], [0.5, 0.5]] as Array<[number, number]>) {
      const grab = ev(params, 0)
      const target = { x: grab.x + dx, y: grab.y + dy }
      const np = dragCurvePoint(c, MODELS, grab, target)
      const dist = Math.hypot(dx, dy)
      expect(nearestOnCurve({ ...c, params: np }, MODELS, target).dist / dist).toBeLessThan(0.02)
    }
  })
})

describe('dragCurvePoint — locality', () => {
  it('sine (up to a half period across the view): a point >50% of the domain away moves <10%', () => {
    const configs: Array<[number[], [number, number]]> = [
      [[1.5, Math.PI / 10, 0, 0], [-5, 5]],
      [[2, Math.PI / 12, 0.4, -0.5], [-6, 6]],
      [[1, 0.25, -0.3, 1], [-6, 6]],
    ]
    for (const [params, domain] of configs) {
      const c = curve('sine', params, domain)
      const ev = MODELS.sine.evalExplicit!
      for (const gx of domain) {
        for (const dy of [0.6, -0.6]) {
          const grab = { x: gx, y: ev(params, gx) }
          const np = dragCurvePoint(c, MODELS, grab, { x: gx, y: grab.y + dy })
          const far = farDisplacement(c, params, np, gx)
          expect(far / Math.abs(dy), `sine ${params} grab@${gx}`).toBeLessThan(0.1)
        }
      }
    }
  })

  it('poly3: a point >50% of the domain away moves <10% of the drag distance', () => {
    const cubics: Array<[number[], [number, number]]> = [
      [[0.5, -0.3, 0, 0.05], [-6, 6]],
      [[0, 0, 0, 0.1], [-5, 5]],
      [[-1, 0.5, -0.1, 0.03], [-4, 7]],
      [[2, -1, 0.2, -0.05], [-6, 4]],
    ]
    for (const [params, domain] of cubics) {
      const c = curve('poly3', params, domain)
      const ev = MODELS.poly3.evalExplicit!
      for (const gx of domain) {
        for (const dy of [1, -1, 0.4]) {
          const grab = { x: gx, y: ev(params, gx) }
          const np = dragCurvePoint(c, MODELS, grab, { x: gx, y: grab.y + dy })
          const far = farDisplacement(c, params, np, gx)
          expect(far / Math.abs(dy), `poly3 ${params} grab@${gx}`).toBeLessThan(0.1)
        }
      }
    }
  })

  it('fourier: the antipodal point moves <10% of the drag distance', () => {
    const params = [0, 0, 2, 0, 0, 2, 0.2, 0.1, -0.1, 0.2]
    const c = curve('fourier', params, [0, 2 * Math.PI])
    const ev = MODELS.fourier.evalParametric!
    for (const [dx, dy] of [[1, 0], [-0.7, 0], [0, 0.8]] as Array<[number, number]>) {
      const grab = ev(params, 0)
      const np = dragCurvePoint(c, MODELS, grab, { x: grab.x + dx, y: grab.y + dy })
      const dist = Math.hypot(dx, dy)
      const a = ev(params, Math.PI)
      const b = ev(np, Math.PI)
      expect(Math.hypot(b.x - a.x, b.y - a.y) / dist).toBeLessThan(0.1)
    }
  })

  it('a rose drag never lets the integral petal count drift', () => {
    const params = [3, 3, 0.7]
    const c = curve('polarRose', params, [0, 2 * Math.PI])
    const geom = (t: number): Vec2 => {
      const r = MODELS.polarRose.evalPolar!(params, t)
      return { x: r * Math.cos(t), y: r * Math.sin(t) }
    }
    const grab = geom(0.2)
    const np = dragCurvePoint(c, MODELS, grab, { x: grab.x + 0.6, y: grab.y - 0.4 })
    expect(np[1]).toBe(3)
  })

  it('a drag never moves any point more than the grabbed point itself', () => {
    // A sinusoid has only 4 global knobs (a, b, c, d), so across several
    // periods it has no local degree of freedom — some global response to the
    // drag is unavoidable and correct. What is NOT acceptable is amplification:
    // the far side of the wave moving further than the point under the cursor.
    // That used to happen (up to 137% of the drag) because the solver satisfied
    // the grab by sliding phase and frequency, which the ridge priced as cheap.
    // Charging parameters for their far-field influence removed it. Since the
    // grabbed point moves by exactly the drag distance, the bound below is the
    // statement "nothing moves more than your cursor did".
    const ev = MODELS.sine.evalExplicit!
    const params = [1.5, 1.2, 0.3, 0.4]
    const domain: [number, number] = [-7, 7]   // ~2.7 periods

    for (const grabX of [0, 3.5]) {
      const c = curve('sine', params, domain)
      const from = { x: grabX, y: ev(params, grabX) }
      const np = dragCurvePoint(c, MODELS, from, { x: grabX, y: from.y + 1 })
      let worst = 0
      for (let i = 0; i <= 400; i++) {
        const x = domain[0] + (14 * i) / 400
        worst = Math.max(worst, Math.abs(ev(np, x) - ev(params, x)))
      }
      expect(worst, `grab at x=${grabX}`).toBeLessThan(1.1)
      expect(np.every(Number.isFinite)).toBe(true)
    }
  })

  it('costs cursor tracking only where the curve would otherwise run away', () => {
    // The displacement cap trades a little grab accuracy for the no-runaway
    // invariant, and it must charge that price ONLY in the pathological case.
    const ev = MODELS.sine.evalExplicit!

    // Gentle curve: the cap never engages, so tracking stays tight.
    const calm = [1.5, 0.5, 0.3, 0.4]
    const cc = curve('sine', calm, [-6, 6])
    const cFrom = { x: 0, y: ev(calm, 0) }
    const cTarget = { x: 0, y: cFrom.y + 1 }
    const cNp = dragCurvePoint(cc, MODELS, cFrom, cTarget)
    expect(nearestOnCurve(curve('sine', cNp, [-6, 6]), MODELS, cTarget).dist).toBeLessThan(0.02)

    // Multi-period sine: reaching the cursor exactly would whip the far side,
    // so the step is shortened. The grab still lands most of the way there.
    const wild = [1.5, 1.2, 0.3, 0.4]
    const wc = curve('sine', wild, [-7, 7])
    const wFrom = { x: 3.5, y: ev(wild, 3.5) }
    const wTarget = { x: 3.5, y: wFrom.y + 1 }
    const wNp = dragCurvePoint(wc, MODELS, wFrom, wTarget)
    expect(nearestOnCurve(curve('sine', wNp, [-7, 7]), MODELS, wTarget).dist).toBeLessThan(0.25)
  })

  it('leaves families that already localize well untouched', () => {
    // gauss and fourier localize naturally (their parameters act near the grab).
    // The influence ridge must not disturb that.
    const gp = [2, 0.4, 0.8, 0]
    const gc = curve('gauss', gp, [-3, 3])
    const gev = MODELS.gauss.evalExplicit!
    const gnp = dragCurvePoint(gc, MODELS, { x: 0.4, y: gev(gp, 0.4) }, { x: 0.4, y: gev(gp, 0.4) + 0.5 })
    let farMotion = 0
    for (const x of [-3, -2.5, -2, 2, 2.5, 3]) {
      farMotion = Math.max(farMotion, Math.abs(gev(gnp, x) - gev(gp, x)))
    }
    expect(farMotion).toBeLessThan(0.05)   // <10% of the 0.5 drag, out in the tails
  })

  it('every family survives a drag with finite params', () => {
    for (const [id, params, domain] of FAMILY_FIXTURES) {
      const c = curve(id, params, domain)
      const h = getHandles(c, MODELS).find(x => x.kind === 'feature' || x.kind === 'radius')
      if (!h) continue
      const np = dragCurvePoint(c, MODELS, h.pos, { x: h.pos.x + 0.9, y: h.pos.y - 0.6 })
      expect(np.every(Number.isFinite), `${id}: ${np}`).toBe(true)
      expect(np.length, id).toBe(params.length)
    }
  })
})

// ---------------------------------------------------------------------------
// oversketch
// ---------------------------------------------------------------------------

/** Ink along r(theta) about the origin, with a little seeded hand jitter. */
function polarInk(
  r: (t: number) => number, t0: number, t1: number, rng: () => number, n = 60,
): Vec2[] {
  const g = makeGauss(rng)
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const t = t0 + ((t1 - t0) * i) / (n - 1)
    const rr = r(t)
    out.push({ x: rr * Math.cos(t) + 0.02 * g(), y: rr * Math.sin(t) + 0.02 * g() })
  }
  return out
}

describe('oversketch', () => {
  it('a +30% half-circle redraw is ACCEPTED and grows the circle', () => {
    const c = curve('circle', [0, 0, 2], null)
    const ink = polarInk(() => 2.6, -Math.PI / 2, Math.PI / 2, makeRng(42))
    const out = oversketch(c, MODELS, ink)
    expect(out, 'a deliberate 30% enlargement must be accepted').not.toBeNull()
    expect(out!.params.every(Number.isFinite)).toBe(true)
    // the refit sits between the old radius and the redrawn one, biased to the ink
    expect(out!.params[2]).toBeGreaterThan(2.05)
    expect(out!.params[2]).toBeLessThanOrEqual(2.6)
    expect(Number.isFinite(out!.error)).toBe(true)
  })

  it('a gentle rim redraw keeps the radius within 0.15', () => {
    for (const [seed, r] of [[42, 2.0], [43, 2.05], [44, 1.96]] as Array<[number, number]>) {
      const c = curve('circle', [0, 0, 2], null)
      const ink = polarInk(() => r, -Math.PI / 2, Math.PI / 2, makeRng(seed))
      const out = oversketch(c, MODELS, ink)
      expect(out, `rim redraw at r=${r} must be accepted`).not.toBeNull()
      expect(Math.abs(out!.params[2] - 2), `r drifted to ${out!.params[2]}`).toBeLessThan(0.15)
      expect(Math.hypot(out!.params[0], out!.params[1])).toBeLessThan(0.15)
    }
  })

  it('a garbage spiral scribbled over a circle is REJECTED', () => {
    const c = curve('circle', [0, 0, 2], null)
    const ink = polarInk(t => 0.3 + 0.55 * (t + Math.PI), -Math.PI, Math.PI, makeRng(45), 90)
    expect(oversketch(c, MODELS, ink)).toBeNull()
  })

  it('a random scribble over a circle is REJECTED', () => {
    const c = curve('circle', [0, 0, 2], null)
    const rng = makeRng(46)
    const g = makeGauss(rng)
    const ink: Vec2[] = []
    for (let i = 0; i < 80; i++) {
      const t = (i / 79) * 2 * Math.PI
      ink.push({ x: 2 * Math.cos(t) + 1.2 * g(), y: 2 * Math.sin(t) + 1.2 * g() })
    }
    expect(oversketch(c, MODELS, ink)).toBeNull()
  })

  it('a sine hump amplitude redraw is ACCEPTED and raises the amplitude', () => {
    const params = [1, 1, 0, 0]
    const c = curve('sine', params, [-7, 7])
    const rng = makeRng(47)
    const g = makeGauss(rng)
    const ink: Vec2[] = []
    for (let i = 0; i < 60; i++) {
      const x = 0.2 + ((Math.PI - 0.4) * i) / 59
      ink.push({ x, y: 1.8 * Math.sin(x) + 0.02 * g() })
    }
    const out = oversketch(c, MODELS, ink)
    expect(out, 'a deliberate amplitude redraw must be accepted').not.toBeNull()
    expect(out!.params[0]).toBeGreaterThan(1.15)
    expect(out!.params[0]).toBeLessThanOrEqual(1.85)
    // frequency must survive a purely-amplitude redraw
    expect(Math.abs(out!.params[1] - 1)).toBeLessThan(0.15)
  })

  it('too little ink is rejected rather than fitted', () => {
    const c = curve('circle', [0, 0, 2], null)
    expect(oversketch(c, MODELS, [])).toBeNull()
    expect(oversketch(c, MODELS, [{ x: 2, y: 0 }])).toBeNull()
    expect(oversketch(c, MODELS, [{ x: 2, y: 0 }, { x: 2, y: 0.1 }])).toBeNull()
  })

  it('an unknown model is rejected rather than throwing', () => {
    const bogus = { ...curve('circle', [0, 0, 2], null), modelId: 'nope' }
    expect(() => oversketch(bogus, MODELS, polarInk(() => 2, 0, Math.PI, makeRng(48)))).not.toThrow()
    expect(oversketch(bogus, MODELS, polarInk(() => 2, 0, Math.PI, makeRng(48)))).toBeNull()
  })

  it('non-finite ink points do not crash the refit', () => {
    const c = curve('circle', [0, 0, 2], null)
    const ink = polarInk(() => 2.1, -Math.PI / 2, Math.PI / 2, makeRng(49))
    ink[10] = { x: NaN, y: 0 }
    ink[20] = { x: 1, y: Infinity }
    expect(() => oversketch(c, MODELS, ink)).not.toThrow()
    const out = oversketch(c, MODELS, ink)
    if (out) expect(out.params.every(Number.isFinite)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// snapParams — the regression guard
// ---------------------------------------------------------------------------

describe('snapParams', () => {
  it('REGRESSION: a cubic with a small leading coefficient keeps its cubic AND quadratic terms', () => {
    // y = 0.018x^3 - 0.012x^2 + 0.4x + 0.1 over [-6, 6], stored ascending.
    // Both 0.018 and -0.012 are within the ABSOLUTE snap floor of zero, but
    // zeroing either one moves the curve by several units at x = 6. The
    // geometric budget check must reject those snaps.
    const params = [0.1, 0.4, -0.012, 0.018]
    const ctx = { spec: MODELS.poly3, domain: [-6, 6] as [number, number], error: 0.03 }
    const out = snapParams('poly3', params, ctx)
    if (out) {
      expect(out.params[3], 'cubic term was zeroed').toBeCloseTo(0.018, 12)
      expect(out.params[2], 'quadratic term was zeroed').toBeCloseTo(-0.012, 12)
      expect(out.snapped[3]).toBe(false)
      expect(out.snapped[2]).toBe(false)
      // whatever else snapped, the curve must barely move
      for (const x of [-6, -3, 0, 3, 6]) {
        const before = MODELS.poly3.evalExplicit!(params, x)
        const after = MODELS.poly3.evalExplicit!(out.params, x)
        expect(Math.abs(after - before), `x=${x}`).toBeLessThan(0.1)
      }
    } else {
      // nothing snapped at all — also correct
      expect(out).toBeNull()
    }
  })

  it('REGRESSION: without a SnapContext, snapping stays conservative', () => {
    const params = [0.1, 0.4, -0.012, 0.018]
    const out = snapParams('poly3', params)
    if (out) {
      expect(out.params[3]).toBeCloseTo(0.018, 12)
      expect(out.params[2]).toBeCloseTo(-0.012, 12)
    } else {
      expect(out).toBeNull()
    }
  })

  it('REGRESSION: no context means no absolute-floor snapping for any small coefficient', () => {
    for (const v of [0.018, -0.012, 0.004, 0.019, -0.0175]) {
      const out = snapParams('poly3', [0, 0, 0, v])
      if (out) expect(out.params[3], `coefficient ${v} was snapped away`).toBeCloseTo(v, 12)
    }
  })

  it('sine amplitude 2.997 still snaps to 3', () => {
    const out = snapParams('sine', [2.997, 1, 0, 0], {
      spec: MODELS.sine, domain: [-6, 6], error: 0.02,
    })
    expect(out).not.toBeNull()
    expect(out!.params[0]).toBe(3)
    expect(out!.snapped[0]).toBe(true)
  })

  it('sine phase 1.5709 snaps to pi/2', () => {
    const out = snapParams('sine', [1, 1, 1.5709, 0], {
      spec: MODELS.sine, domain: [-6, 6], error: 0.02,
    })
    expect(out).not.toBeNull()
    expect(out!.params[2]).toBeCloseTo(Math.PI / 2, 12)
    expect(out!.snapped[2]).toBe(true)
  })

  it('circle radius 2.99 snaps to 3', () => {
    const out = snapParams('circle', [0, 0, 2.99], {
      spec: MODELS.circle, domain: null, error: 0.02,
    })
    expect(out).not.toBeNull()
    expect(out!.params[2]).toBe(3)
    expect(out!.snapped[2]).toBe(true)
  })

  it('a radius far from a nice value is left alone', () => {
    const ctx = { spec: MODELS.circle, domain: null, error: 0.02 }
    expect(snapParams('circle', [0, 0, 2.62], ctx)).toBeNull()
    expect(snapParams('circle', [0, 0, 3.37], ctx)).toBeNull()
  })

  it('ellipse conic coefficients are never snapped (they encode shape jointly)', () => {
    expect(snapParams('ellipse', [0.25, 0, 0.5, 0, 0, -1], {
      spec: MODELS.ellipse, domain: null,
    })).toBeNull()
    expect(snapParams('ellipse', [0.2052, -0.3197, 0.331, 0.0001, 0.001, -0.8638])).toBeNull()
  })

  it('fourier snapping touches only the center, never a harmonic', () => {
    const params = [0.997, -0.004, 1.002, 0.003, -0.998, 1.001]
    const out = snapParams('fourier', params, {
      spec: MODELS.fourier, domain: [0, 2 * Math.PI],
    })
    expect(out).not.toBeNull()
    for (let i = 2; i < params.length; i++) {
      expect(out!.snapped[i], `harmonic ${i} was snapped`).toBe(false)
      expect(out!.params[i]).toBe(params[i])
    }
  })

  it('rose petal count k is never re-snapped', () => {
    const out = snapParams('polarRose', [2.997, 3, 1.5709], {
      spec: MODELS.polarRose, domain: [0, 2 * Math.PI],
    })
    if (out) {
      expect(out.snapped[1]).toBe(false)
      expect(out.params[1]).toBe(3)
    }
  })

  it('returns null when nothing is close to a nice value', () => {
    expect(snapParams('sine', [1.37, 0.83, 0.41, -0.62], {
      spec: MODELS.sine, domain: [-6, 6], error: 0.01,
    })).toBeNull()
  })

  it('snapped output always has one flag per parameter and finite values', () => {
    for (const [id, params, domain] of FAMILY_FIXTURES) {
      const jittered = params.map(v => v + 0.003)
      const out = snapParams(id, jittered, { spec: MODELS[id], domain, error: 0.02 })
      if (!out) continue
      expect(out.params.length, id).toBe(jittered.length)
      expect(out.snapped.length, id).toBe(jittered.length)
      expect(out.params.every(Number.isFinite), id).toBe(true)
      expect(out.snapped.some(Boolean), `${id}: reported a snap with no flags`).toBe(true)
    }
  })

  it('never mutates the caller parameter array', () => {
    const params = [2.997, 1, 1.5709, 0]
    const before = params.slice()
    snapParams('sine', params, { spec: MODELS.sine, domain: [-6, 6], error: 0.02 })
    expect(params).toEqual(before)
  })
})

// ---------------------------------------------------------------------------
// nearestOnCurve
// ---------------------------------------------------------------------------

describe('nearestOnCurve', () => {
  it.each(FAMILY_FIXTURES)('%s: a point taken from the curve maps back to itself', (id, params, domain) => {
    const c = curve(id, params, domain)
    const spec = MODELS[id]
    const dom = domain ?? (spec.kind === 'explicit' ? [-10, 10] : [0, 2 * Math.PI])
    for (const frac of [0.2, 0.5, 0.8]) {
      const t = dom[0] + (dom[1] - dom[0]) * frac
      let p: Vec2
      if (spec.evalExplicit) p = { x: t, y: spec.evalExplicit(params, t) }
      else if (spec.evalParametric) p = spec.evalParametric(params, t)
      else if (spec.evalPolar) {
        const r = spec.evalPolar(params, t)
        p = { x: r * Math.cos(t), y: r * Math.sin(t) }
      } else {
        // circle / ellipse parametrization is handled internally
        continue
      }
      const near = nearestOnCurve(c, MODELS, p)
      expect(near.dist, `${id} at t=${t}`).toBeLessThan(0.01)
      expect(Number.isFinite(near.pos.x) && Number.isFinite(near.pos.y)).toBe(true)
    }
  })

  it('an unknown model reports infinite distance rather than throwing', () => {
    const bogus = { ...curve('circle', [0, 0, 2], null), modelId: 'nope' }
    const near = nearestOnCurve(bogus, MODELS, { x: 1, y: 1 })
    expect(near.dist).toBe(Infinity)
  })
})

// ---------------------------------------------------------------------------
// Root families: the branch point is the handle that matters.
// ---------------------------------------------------------------------------

describe('root-family handles', () => {
  it('every root family exposes a branch-point handle sitting at (b, c)', () => {
    for (const [id, params, dom] of [
      ['sqrt', [2, -1, 0.5], [-1, 8]],
      ['cbrt', [1.7, 1, -0.5], [-6, 8]],
      ['power', [1, 0, 0, 2 / 3], [-4, 4]],
    ] as Array<[string, number[], [number, number]]>) {
      const hs = getHandles(curve(id, params, dom), MODELS)
      const branch = hs.find(h => h.id === 'branch')
      expect(branch, `${id} has no branch handle`).toBeDefined()
      expect(branch!.pos.x).toBeCloseTo(params[1], 9)
      expect(branch!.pos.y).toBeCloseTo(params[2], 9)
    }
  })

  it('sqrt offers no domain-start handle — the curve begins at its branch point', () => {
    const hs = getHandles(curve('sqrt', [2, -1, 0.5], [-1, 8]), MODELS)
    expect(hs.find(h => h.id === 'domain-start')).toBeUndefined()
    expect(hs.find(h => h.id === 'domain-end')).toBeDefined()
    // cbrt is two-sided, so it keeps both
    const cb = getHandles(curve('cbrt', [1.7, 1, -0.5], [-6, 8]), MODELS)
    expect(cb.find(h => h.id === 'domain-start')).toBeDefined()
    expect(cb.find(h => h.id === 'domain-end')).toBeDefined()
  })

  it('dragging the branch point translates the curve rigidly, domain included', () => {
    for (const [id, params] of [
      ['sqrt', [2, -1, 0.5]],
      ['cbrt', [1.7, 1, -0.5]],
      ['power', [1, 0, 0, 2 / 3]],
    ] as Array<[string, number[]]>) {
      const c = curve(id, params, [params[1], params[1] + 6])
      const res = applyHandleDrag(c, MODELS, 'branch', { x: params[1] + 1.5, y: params[2] - 2 })
      expect(res.params[1]).toBeCloseTo(params[1] + 1.5, 9)
      expect(res.params[2]).toBeCloseTo(params[2] - 2, 9)
      expect(res.params[0], `${id} scale changed`).toBeCloseTo(params[0], 9)
      expect(res.domain![0]).toBeCloseTo(c.domain![0] + 1.5, 9)
      // the shape itself is unchanged, just moved
      const ev = MODELS[id].evalExplicit!
      for (const d of [0.5, 2, 4]) {
        const before = ev(params, params[1] + d)
        const after = ev(res.params, params[1] + 1.5 + d)
        expect(after).toBeCloseTo(before - 2, 9)
      }
    }
  })

  it('dragging the scale handle sets the coefficient in closed form', () => {
    const params = [2, -1, 0.5] // y = 2*sqrt(x + 1) + 0.5
    const c = curve('sqrt', params, [-1, 8])
    const hs = getHandles(c, MODELS)
    const scale = hs.find(h => h.id === 'scale')!
    // drag it to a point whose exact coefficient we can compute by hand
    const u = Math.sqrt(scale.pos.x - params[1])
    const wantA = 3.3
    const target = { x: scale.pos.x, y: params[2] + wantA * u }
    const res = applyHandleDrag(c, MODELS, 'scale', target)
    expect(res.params[0]).toBeCloseTo(wantA, 9)
    expect(res.params[1], 'branch point moved').toBeCloseTo(params[1], 12)
    expect(res.params[2], 'offset moved').toBeCloseTo(params[2], 12)
  })

  it('trimming a sqrt never exposes the region left of the branch point', () => {
    const c = curve('sqrt', [2, -1, 0.5], [-1, 8])
    // try to drag the end far past the branch point, to the left
    const res = applyHandleDrag(c, MODELS, 'domain-end', { x: -9, y: 0 })
    expect(res.domain![0]).toBeGreaterThanOrEqual(res.params[1] - 1e-12)
    expect(res.domain![1]).toBeGreaterThan(res.domain![0])
    // the whole reported domain is inside the model's real domain
    const ev = MODELS.sqrt.evalExplicit!
    expect(Number.isFinite(ev(res.params, res.domain![0]))).toBe(true)
    expect(Number.isFinite(ev(res.params, res.domain![1]))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// P1: the displacement cap must hold against the CURVE, not against a grid.
//
// The cap was enforced by sampling the displacement at 48 places. Any feature
// narrower than the resulting spacing hides between samples: a gaussian of
// width 1 on [-10, 10] has 0.426 between samples and its peak sits at x = 0,
// which is not one of them. The drag below measured 0.96x of the drag distance
// at every sample while the peak actually grew from 2 to 3.58 — 1.66x, a third
// again past a cap that reads 1.05. The guard now brackets with the grid and
// maximises properly inside each bracket.
// ---------------------------------------------------------------------------

/** True worst-case displacement anywhere on the curve, densely sampled. */
function trueWorstDisplacement(
  c: FittedCurve, oldParams: number[], newParams: number[], n = 20000,
): { worst: number; at: number } {
  const spec = MODELS[c.modelId]
  const dom = c.domain ?? (spec.kind === 'explicit' ? [-10, 10] : [0, 2 * Math.PI])
  const span = dom[1] - dom[0]
  let worst = 0
  let at = dom[0]
  for (let i = 0; i <= n; i++) {
    const t = dom[0] + (span * i) / n
    let d: number
    if (spec.evalExplicit) {
      d = Math.abs(spec.evalExplicit(newParams, t) - spec.evalExplicit(oldParams, t))
    } else if (spec.evalPolar) {
      const ra = spec.evalPolar(oldParams, t)
      const rb = spec.evalPolar(newParams, t)
      d = Math.hypot(rb * Math.cos(t) - ra * Math.cos(t), rb * Math.sin(t) - ra * Math.sin(t))
    } else if (spec.evalParametric) {
      const a = spec.evalParametric(oldParams, t)
      const b = spec.evalParametric(newParams, t)
      d = Math.hypot(b.x - a.x, b.y - a.y)
    } else {
      const cfA = conicToCenterForm(oldParams)
      const cfB = conicToCenterForm(newParams)
      if (!cfA || !cfB) continue
      const at2 = (cf: NonNullable<ReturnType<typeof conicToCenterForm>>) => ({
        x: cf.cx + cf.rx * Math.cos(t) * Math.cos(cf.angle) - cf.ry * Math.sin(t) * Math.sin(cf.angle),
        y: cf.cy + cf.rx * Math.cos(t) * Math.sin(cf.angle) + cf.ry * Math.sin(t) * Math.cos(cf.angle),
      })
      const a = at2(cfA)
      const b = at2(cfB)
      d = Math.hypot(b.x - a.x, b.y - a.y)
    }
    if (Number.isFinite(d) && d > worst) { worst = d; at = t }
  }
  return { worst, at }
}

describe('dragCurvePoint — the displacement cap survives narrow features', () => {
  it('a gaussian peak between two samples does not slip past the cap', () => {
    // the exact case from the audit: drag 0.954, peak displacement used to be
    // 1.584 (1.66x) because x = 0 is not one of 48 samples on [-10, 10]
    const params = [2, 0, 1, 0]
    const c = curve('gauss', params, [-10, 10])
    const grab = { x: -2.9369, y: 0.00035894 }
    const target = { x: -3.0344, y: 0.9498 }
    const np = dragCurvePoint(c, MODELS, grab, target)
    const drag = Math.hypot(target.x - grab.x, target.y - grab.y)
    const { worst, at } = trueWorstDisplacement(c, params, np)
    expect(at, 'the worst displacement is at the peak, between samples').toBeCloseTo(0, 1)
    expect(worst / drag, `worst ${worst} for drag ${drag}`).toBeLessThanOrEqual(1.05 + 1e-9)
  })

  it('holds for narrow features anywhere in a wide domain', () => {
    // sweep the gaussian's centre so the peak lands on, beside and between the
    // grid points of any fixed sampling
    for (const b of [0, 0.1234, 1.7, -4.3211, 6.05]) {
      for (const width of [0.35, 1, 2.5]) {
        const params = [2, b, width, 0]
        const c = curve('gauss', params, [-10, 10])
        const ev = MODELS.gauss.evalExplicit!
        const gx = b - 3 * width
        const grab = { x: gx, y: ev(params, gx) }
        const target = { x: gx - 0.1, y: grab.y + 0.95 }
        const np = dragCurvePoint(c, MODELS, grab, target)
        const drag = Math.hypot(target.x - grab.x, target.y - grab.y)
        const { worst } = trueWorstDisplacement(c, params, np)
        expect(
          worst / drag, `gauss b=${b} width=${width}: worst ${worst} for drag ${drag}`,
        ).toBeLessThanOrEqual(1.05 + 1e-6)
      }
    }
  })

  it('every family respects the cap on a drag from one of its own handles', () => {
    for (const [id, params, domain] of FAMILY_FIXTURES) {
      const c = curve(id, params, domain)
      const h = getHandles(c, MODELS).find(x => x.kind === 'feature' || x.kind === 'radius')
      if (!h) continue
      const target = { x: h.pos.x + 0.9, y: h.pos.y - 0.6 }
      const np = dragCurvePoint(c, MODELS, h.pos, target)
      const drag = Math.hypot(target.x - h.pos.x, target.y - h.pos.y)
      const { worst } = trueWorstDisplacement(c, params, np, 8000)
      expect(worst / drag, `${id}: worst ${worst} for drag ${drag}`).toBeLessThanOrEqual(1.05 + 1e-6)
    }
  })
})

// ===========================================================================
// applyFeatureEdit
//
// Everything here is checked against closed-form truth — the expanded
// coefficients of a(x−r₁)(x−r₂)(x−r₃), the exact vertex form, the cubic's
// point-symmetry — never against what the solver happens to return.
// ===========================================================================

/** Ascending coefficients of a·∏(x − rᵢ). */
function fromRoots(a: number, roots: number[]): number[] {
  let c = [a]
  for (const r of roots) {
    const out = new Array<number>(c.length + 1).fill(0)
    for (let i = 0; i < c.length; i++) {
      out[i] += -r * c[i]
      out[i + 1] += c[i]
    }
    c = out
  }
  return c
}

function evAt(id: string, p: number[], x: number): number {
  return MODELS[id].evalExplicit!(p, x)
}

/** Exact derivative of an ascending-coefficient polynomial. */
function dPoly(c: number[], x: number): number {
  let s = 0
  for (let k = 1; k < c.length; k++) s += k * c[k] * Math.pow(x, k - 1)
  return s
}

function featuresOf(c: FittedCurve, kind: SpecialPointKind): SpecialPoint[] {
  return analyzeCurve(c, MODELS).filter(p => p.kind === kind)
}

function feat(c: FittedCurve, kind: SpecialPointKind, idx = 0): SpecialPoint {
  const list = featuresOf(c, kind)
  expect(list.length, `expected ${kind} #${idx} to exist`).toBeGreaterThan(idx)
  return list[idx]
}

describe('applyFeatureEdit — polynomial zeros are exact', () => {
  it('a cubic takes three exact integer zeros, set one at a time', () => {
    // a hand-drawn-looking cubic whose roots are nowhere near integers
    let c = curve('poly3', fromRoots(0.5, [-1.7, 0.62, 2.43]), [-5, 5])
    const want = [-2, 1, 3]
    for (let i = 0; i < 3; i++) {
      const res = applyFeatureEdit(c, MODELS, { point: feat(c, 'zero', i), to: { x: want[i] } })
      expect(res.ok, `edit ${i}: ${res.ok ? '' : res.reason}`).toBe(true)
      if (!res.ok) return
      expect(res.exact, 'a polynomial zero is a closed-form edit').toBe(true)
      expect(res.params.every(Number.isFinite)).toBe(true)
      c = { ...c, params: res.params, domain: res.domain }
    }
    const zeros = featuresOf(c, 'zero').map(p => p.pos.x)
    expect(zeros.length).toBe(3)
    for (let i = 0; i < 3; i++) expect(zeros[i]).toBeCloseTo(want[i], 9)

    // and the curve really IS a(x+2)(x−1)(x−3): compare against the expansion
    const a = c.params[3]
    expect(a).toBeGreaterThan(0)
    expect(a).toBeLessThan(4) // the drawn curve had a = 0.5; nothing blew up
    const truth = fromRoots(a, want)
    for (let k = 0; k < 4; k++) {
      expect(c.params[k], `coefficient ${k}`).toBeCloseTo(truth[k], 10)
    }
  })

  it('moving one zero of a cubic leaves the other two exactly where they were', () => {
    const c = curve('poly3', fromRoots(0.8, [-3, 0.5, 2]), [-5, 5])
    const res = applyFeatureEdit(c, MODELS, { point: feat(c, 'zero', 1), to: { x: 1 } })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const after = featuresOf({ ...c, params: res.params, domain: res.domain }, 'zero')
    expect(after.map(p => p.pos.x)[0]).toBeCloseTo(-3, 10)
    expect(after.map(p => p.pos.x)[1]).toBeCloseTo(1, 10)
    expect(after.map(p => p.pos.x)[2]).toBeCloseTo(2, 10)
    // the turning points did move, and the result says so
    const moved = res.alsoMoved ?? []
    expect(moved.some(p => p.kind === 'maximum' || p.kind === 'minimum')).toBe(true)
    expect(moved.some(p => p.kind === 'zero'), 'no zero should be reported as moved').toBe(false)
  })

  it('a parabola takes both of its zeros exactly', () => {
    let c = curve('poly2', fromRoots(-1.3, [-0.4, 2.9]), [-5, 5])
    for (const [i, x] of [-1, 2].entries()) {
      const res = applyFeatureEdit(c, MODELS, { point: feat(c, 'zero', i), to: { x } })
      expect(res.ok).toBe(true)
      if (!res.ok) return
      c = { ...c, params: res.params, domain: res.domain }
    }
    const a = c.params[2]
    expect(a).toBeLessThan(0)
    const truth = fromRoots(a, [-1, 2])
    for (let k = 0; k < 3; k++) expect(c.params[k]).toBeCloseTo(truth[k], 10)
  })

  it('a line takes its zero exactly, keeping its slope', () => {
    const c = curve('line', [-1, 0.8], [-6, 6])
    const res = applyFeatureEdit(c, MODELS, { point: feat(c, 'zero'), to: { x: 3 } })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(evAt('line', res.params, 3)).toBeCloseTo(0, 12)
  })
})

describe('applyFeatureEdit — vertices, turning points and inflections', () => {
  it('a parabola of width a = 0.5 put at (2, −1) is exactly 0.5(x−2)² − 1', () => {
    const c = curve('poly2', [3.5, -1, 0.5], [-5, 5]) // 0.5(x−1)² + 3
    const res = applyFeatureEdit(c, MODELS, { point: feat(c, 'minimum'), to: { x: 2, y: -1 } })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.exact).toBe(true)
    // 0.5(x−2)² − 1 = 0.5x² − 2x + 1
    expect(res.params[2]).toBeCloseTo(0.5, 12)
    expect(res.params[1]).toBeCloseTo(-2, 12)
    expect(res.params[0]).toBeCloseTo(1, 12)
  })

  it('a cubic maximum put at (−1, 5) keeps the point-symmetry invariant', () => {
    const c = curve('poly3', [1, -2, -0.3, 0.5], [-5, 5])
    const res = applyFeatureEdit(c, MODELS, { point: feat(c, 'maximum'), to: { x: -1, y: 5 } })
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)
    if (!res.ok) return
    expect(res.exact).toBe(true)
    const p = res.params
    expect(dPoly(p, -1)).toBeCloseTo(0, 9)
    expect(evAt('poly3', p, -1)).toBeCloseTo(5, 9)
    // the leading coefficient — the curve's scale — is untouched
    expect(p[3]).toBeCloseTo(0.5, 12)

    const after = { ...c, params: p, domain: res.domain }
    const mx = feat(after, 'maximum')
    const mn = feat(after, 'minimum')
    const inf = feat(after, 'inflection')
    expect(mx.pos.x).toBeCloseTo(-1, 9)
    expect(mx.pos.y).toBeCloseTo(5, 9)
    expect(inf.pos.x, 'inflection is the midpoint of the two extrema')
      .toBeCloseTo((mx.pos.x + mn.pos.x) / 2, 9)
    expect(inf.pos.y, 'and the midpoint of their heights, by point symmetry')
      .toBeCloseTo((mx.pos.y + mn.pos.y) / 2, 9)
  })

  it('a cubic takes a maximum and a pinned minimum together, exactly', () => {
    const c = curve('poly3', [1, -2, -0.3, 0.5], [-5, 5])
    const min = feat(c, 'minimum')
    const res = applyFeatureEdit(c, MODELS, {
      point: feat(c, 'maximum'),
      to: { x: -1, y: 5 },
      pinned: [{ ...min, pos: { x: 2, y: -3 } }],
    })
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)
    if (!res.ok) return
    const p = res.params
    expect(dPoly(p, -1)).toBeCloseTo(0, 9)
    expect(dPoly(p, 2)).toBeCloseTo(0, 9)
    expect(evAt('poly3', p, -1)).toBeCloseTo(5, 9)
    expect(evAt('poly3', p, 2)).toBeCloseTo(-3, 9)
    // two critical points determine a cubic uniquely: f'' = 6c₃x + 2c₂ = 0 at
    // the midpoint x = 0.5
    const after = { ...c, params: p, domain: res.domain }
    expect(feat(after, 'inflection').pos.x).toBeCloseTo(0.5, 9)
  })

  it('a cubic inflection move is a rigid slide of the whole curve', () => {
    const c = curve('poly3', [1, -2, -0.3, 0.5], [-5, 5])
    const before = feat(c, 'inflection')
    const res = applyFeatureEdit(c, MODELS, { point: before, to: { x: 1, y: 2 } })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const after = { ...c, params: res.params, domain: res.domain }
    const inf = feat(after, 'inflection')
    expect(inf.pos.x).toBeCloseTo(1, 9)
    expect(inf.pos.y).toBeCloseTo(2, 9)
    expect(res.params[3], 'the cubic keeps its scale').toBeCloseTo(0.5, 12)
    // a slide preserves the gap between the turning points
    const gap = (cc: FittedCurve) =>
      feat(cc, 'minimum').pos.x - feat(cc, 'maximum').pos.x
    expect(gap(after)).toBeCloseTo(gap(c), 9)
  })

  it('a sine crest goes exactly where it is asked', () => {
    const c = curve('sine', [1.5, 1.2, 0.3, 0.4], [-7, 7])
    const res = applyFeatureEdit(c, MODELS, { point: feat(c, 'maximum'), to: { x: 1, y: 4 } })
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)
    if (!res.ok) return
    expect(res.exact).toBe(true)
    expect(evAt('sine', res.params, 1)).toBeCloseTo(4, 12)
    expect(res.params[1], 'the wavelength is left alone').toBeCloseTo(1.2, 12)
    expect(res.params[3], 'and so is the midline').toBeCloseTo(0.4, 12)
    // it is a crest, not a trough
    expect(evAt('sine', res.params, 1.05)).toBeLessThan(4)
    expect(evAt('sine', res.params, 0.95)).toBeLessThan(4)
  })

  it('a gaussian peak goes exactly where it is asked', () => {
    const c = curve('gauss', [3, 0.5, 1.2, -1], [-6, 7])
    const res = applyFeatureEdit(c, MODELS, { point: feat(c, 'maximum'), to: { x: 2, y: 5 } })
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)
    if (!res.ok) return
    expect(res.exact).toBe(true)
    expect(res.params[1]).toBeCloseTo(2, 12)
    expect(evAt('gauss', res.params, 2)).toBeCloseTo(5, 12)
    expect(res.params[2], 'the width is left alone').toBeCloseTo(1.2, 12)
  })

  it('an absolute-value corner goes exactly where it is asked', () => {
    const c = curve('abs', [1.2, 0.7, -2], [-5, 6])
    const res = applyFeatureEdit(c, MODELS, { point: feat(c, 'minimum'), to: { x: -1, y: 1 } })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.params[1]).toBeCloseTo(-1, 12)
    expect(res.params[2]).toBeCloseTo(1, 12)
  })

  it('a y-intercept edit is a pure vertical slide', () => {
    for (const [id, params, domain] of FAMILY_FIXTURES) {
      const c = curve(id, params, domain)
      const yi = featuresOf(c, 'y-intercept')[0]
      if (!yi) continue
      const res = applyFeatureEdit(c, MODELS, { point: yi, to: { y: yi.pos.y + 1.5 } })
      expect(res.ok, `${id}: ${res.ok ? '' : res.reason}`).toBe(true)
      if (!res.ok) continue
      expect(evAt(id, res.params, 0), `${id}: f(0)`).toBeCloseTo(yi.pos.y + 1.5, 9)
      // a slide keeps the shape: the SPACING of the zeros is unchanged in x
      // only for polys, so check the cheap invariant instead — the curve moved
      // by exactly 1.5 everywhere
      const x = (domain![0] + domain![1]) / 2 + 0.37
      expect(evAt(id, res.params, x) - evAt(id, params, x), `${id}: at x=${x}`)
        .toBeCloseTo(1.5, 9)
    }
  })

  it('a circle zero moves without disturbing the other crossing', () => {
    const c = curve('circle', [0, 0, 2.5], null)
    const zeros = featuresOf(c, 'zero')
    expect(zeros.length).toBe(2)
    const res = applyFeatureEdit(c, MODELS, { point: zeros[1], to: { x: 4 } })
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)
    if (!res.ok) return
    const after = featuresOf({ ...c, params: res.params, domain: res.domain }, 'zero')
    expect(after[0].pos.x).toBeCloseTo(-2.5, 9)
    expect(after[1].pos.x).toBeCloseTo(4, 9)
  })
})

describe('applyFeatureEdit — refusals a teacher can read', () => {
  const zeroAt = (x: number): SpecialPoint =>
    ({ kind: 'zero', pos: { x, y: 0 }, label: 'zero', exact: true })

  it('a parabola cannot be given three zeros', () => {
    const params = fromRoots(1, [-1, 2])
    const c = curve('poly2', params, [-5, 5])
    const res = applyFeatureEdit(c, MODELS, {
      point: feat(c, 'zero', 0),
      to: { x: -3 },
      pinned: [zeroAt(2), zeroAt(4)],
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason.length).toBeGreaterThan(0)
    expect(res.reason).toMatch(/parabola/i)
    expect(c.params).toEqual(params) // nothing mutated
  })

  it('a gaussian cannot be given a second extremum', () => {
    const params = [3, 0.5, 1.2, -1]
    const c = curve('gauss', params, [-6, 7])
    const bogus: SpecialPoint = {
      kind: 'maximum', pos: { x: 4.5, y: 0.2 }, label: 'max', exact: false,
    }
    const res = applyFeatureEdit(c, MODELS, { point: bogus, to: { x: 5, y: 2 } })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toMatch(/gaussian has exactly one turning point/i)
    expect(c.params).toEqual(params)
  })

  it('a gaussian cannot hold two peaks at once', () => {
    const params = [3, 0.5, 1.2, -1]
    const c = curve('gauss', params, [-6, 7])
    const peak = feat(c, 'maximum')
    const res = applyFeatureEdit(c, MODELS, {
      point: peak,
      to: { x: 2, y: 5 },
      pinned: [{ ...peak, pos: { x: -3, y: 1 } }],
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toMatch(/one turning point/i)
    expect(c.params).toEqual(params)
  })

  it('a cubic cannot have three zeros AND a chosen maximum', () => {
    const params = fromRoots(0.5, [-2, 1, 3])
    const c = curve('poly3', params, [-5, 5])
    const res = applyFeatureEdit(c, MODELS, {
      point: feat(c, 'maximum'),
      to: { x: -1 },
      pinned: [zeroAt(-2), zeroAt(1), zeroAt(3)],
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toMatch(/three zeros already fix a cubic/i)
    expect(c.params).toEqual(params)
  })

  it('too many pinned features are refused, with the count', () => {
    const params = [1, -2, -0.3, 0.5]
    const c = curve('poly3', params, [-5, 5])
    const res = applyFeatureEdit(c, MODELS, {
      point: feat(c, 'zero', 0),
      to: { x: -3 },
      pinned: [feat(c, 'maximum'), feat(c, 'minimum'), feat(c, 'inflection')],
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toMatch(/conditions at once/i)
    expect(c.params).toEqual(params)
  })

  it('a cubic maximum cannot be asked to sit below its minimum', () => {
    const params = [1, -2, -0.3, 0.5]
    const c = curve('poly3', params, [-5, 5])
    const min = feat(c, 'minimum')
    const res = applyFeatureEdit(c, MODELS, {
      point: feat(c, 'maximum'),
      to: { x: -1, y: -4 },
      pinned: [{ ...min, pos: { x: 2, y: 3 } }],
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toMatch(/maximum is always the higher/i)
    expect(c.params).toEqual(params)
  })

  it('a cubic inflection off the midpoint of the extrema is refused', () => {
    const params = [1, -2, -0.3, 0.5]
    const c = curve('poly3', params, [-5, 5])
    const min = feat(c, 'minimum')
    const inf = feat(c, 'inflection')
    const res = applyFeatureEdit(c, MODELS, {
      point: feat(c, 'maximum'),
      to: { x: -1, y: 5 },
      pinned: [
        { ...min, pos: { x: 2, y: -3 } },
        { ...inf, pos: { x: 1, y: 0 } },
      ],
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toMatch(/point-symmetric/i)
    expect(res.reason).toMatch(/0\.5/)
    expect(c.params).toEqual(params)
  })

  it('a zero cannot be moved where the curve has none', () => {
    const params = [3, 0, 1, 1] // a gaussian sitting entirely above the axis
    const c = curve('gauss', params, [-6, 6])
    expect(featuresOf(c, 'zero').length).toBe(0)
    const res = applyFeatureEdit(c, MODELS, { point: zeroAt(2), to: { x: 3 } })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toMatch(/never crosses the x-axis/i)
    expect(c.params).toEqual(params)
  })

  it('a zero far from any real zero of the curve is refused, not snapped', () => {
    const params = fromRoots(0.5, [-2, 1, 3])
    const c = curve('poly3', params, [-6, 6])
    const res = applyFeatureEdit(c, MODELS, { point: zeroAt(5.5), to: { x: 5 } })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toMatch(/no zero near/i)
    expect(c.params).toEqual(params)
  })

  it('a zero cannot be lifted off the x-axis, and a y-intercept cannot move sideways', () => {
    const c = curve('poly3', fromRoots(0.5, [-2, 1, 3]), [-6, 6])
    const a = applyFeatureEdit(c, MODELS, { point: feat(c, 'zero'), to: { y: 2 } })
    expect(a.ok).toBe(false)
    if (!a.ok) expect(a.reason).toMatch(/y is always 0/i)
    const b = applyFeatureEdit(c, MODELS, { point: feat(c, 'y-intercept'), to: { x: 2 } })
    expect(b.ok).toBe(false)
    if (!b.ok) expect(b.reason).toMatch(/up and down/i)
  })

  it('an absolute-value graph has no inflection to move', () => {
    const c = curve('abs', [1.2, 0.7, -2], [-5, 6])
    const bogus: SpecialPoint = {
      kind: 'inflection', pos: { x: 0.7, y: -2 }, label: 'inflection', exact: false,
    }
    const res = applyFeatureEdit(c, MODELS, { point: bogus, to: { x: 1 } })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason.length).toBeGreaterThan(0)
  })
})

describe('applyFeatureEdit — families with no closed form', () => {
  // What a typed expression looks like: an explicit model whose free constants
  // have no known meaning, so nothing about it can be solved algebraically.
  const TYPED: ModelSpec = {
    id: 'typed',
    kind: 'explicit',
    name: 'Expression',
    evalExplicit: (p, x) => p[0] * Math.sin(x) + p[1] * x + p[2],
    latex: () => 'y = a\\sin x + bx + c',
    paramMeta: p => p.map((v, i) => ({ name: 'abc'[i], min: v - 2, max: v + 2, step: 0.01 })),
  }
  const M = { ...MODELS, typed: TYPED }
  const typedCurve = (params: number[]): FittedCurve => ({
    id: 'typed-curve', modelId: 'typed', params, kind: 'explicit',
    domain: [-6, 6], color: '#4f9cf9', strokeWidth: 2.5, visible: true, error: 0.02,
  })
  const f = (p: number[], x: number) => TYPED.evalExplicit!(p, x)
  const fpp = (p: number[], x: number) => {
    const h = 1e-4
    return (f(p, x + h) - 2 * f(p, x) + f(p, x - h)) / (h * h)
  }
  const rangeOver = (p: number[], lo: number, hi: number) => {
    let mn = Infinity
    let mx = -Infinity
    for (let i = 0; i <= 60; i++) {
      const y = f(p, lo + ((hi - lo) * i) / 60)
      mn = Math.min(mn, y)
      mx = Math.max(mx, y)
    }
    return mx - mn
  }

  it('a zero is put exactly where it is asked, not merely nearby', () => {
    const c = typedCurve([2, 0.3, -0.5])
    const z = analyzeCurve(c, M).filter(p => p.kind === 'zero')[0]
    const target = z.pos.x + 0.5
    const res = applyFeatureEdit(c, M, { point: z, to: { x: target } })
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)
    if (!res.ok) return
    expect(res.exact, 'a numeric solve must not claim to be exact').toBe(false)
    // the soft anchor weighting alone leaves the zero visibly short of target;
    // the projection step is what makes this hold
    expect(Math.abs(f(res.params, target))).toBeLessThan(1e-9)
  })

  it('a maximum stays a maximum, and the curve is not flattened to reach it', () => {
    const params = [2, 0.3, -0.5]
    const c = typedCurve(params)
    const mx = analyzeCurve(c, M).filter(p => p.kind === 'maximum')[0]
    const tx = mx.pos.x + 0.4
    const ty = mx.pos.y + 1
    const res = applyFeatureEdit(c, M, { point: mx, to: { x: tx, y: ty } })
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)
    if (!res.ok) return
    expect(f(res.params, tx)).toBeCloseTo(ty, 6)
    const h = 1e-5
    expect(Math.abs((f(res.params, tx + h) - f(res.params, tx - h)) / (2 * h))).toBeLessThan(1e-5)
    expect(fpp(res.params, tx), 'still turning downwards').toBeLessThan(0)
    // the least-squares optimum here is a horizontal line through the target;
    // the curve has to survive the edit
    expect(rangeOver(res.params, -6, 6)).toBeGreaterThan(0.5 * rangeOver(params, -6, 6))
  })

  it('honours a pin the family has the freedom for', () => {
    const c = curve('sine', [1.5, 1.2, 0.3, 0.4], [-7, 7])
    const infl = analyzeCurve(c, MODELS)
      .filter(p => p.kind === 'inflection')
      .reduce((a, b) => (Math.abs(a.pos.x) < Math.abs(b.pos.x) ? a : b))
    const res = applyFeatureEdit(c, MODELS, {
      point: feat(c, 'maximum'),
      to: { x: 1, y: 3 },
      pinned: [infl],
    })
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)
    if (!res.ok) return
    expect(evAt('sine', res.params, 1)).toBeCloseTo(3, 6)
    expect(evAt('sine', res.params, infl.pos.x), 'the pinned inflection held')
      .toBeCloseTo(infl.pos.y, 6)
  })
})

describe('applyFeatureEdit — the curve keeps its orientation', () => {
  it('a zero dragged far away does not turn the cubic upside down', () => {
    const c = curve('poly3', fromRoots(0.5, [-2, 1, 3]), [-6, 6])
    const res = applyFeatureEdit(c, MODELS, { point: feat(c, 'zero', 1), to: { x: 14 } })
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)
    if (!res.ok) return
    expect(res.params[3], 'still opens upwards').toBeGreaterThan(0)
    // the requested zeros are all there, exactly
    const truth = fromRoots(res.params[3], [-2, 3, 14])
    for (let k = 0; k < 4; k++) expect(res.params[k]).toBeCloseTo(truth[k], 8)
    expect(res.domain, 'the domain grew to reach the new zero').not.toBeNull()
    expect(res.domain![1]).toBeGreaterThan(14)
  })
})

describe('applyFeatureEdit — never produces a broken curve', () => {
  it('every family, every feature, every target: finite params or an honest refusal', () => {
    for (const [id, params, domain] of FAMILY_FIXTURES) {
      const c = curve(id, params, domain)
      const pts = analyzeCurve(c, MODELS)
      for (const pt of pts) {
        const targets = [
          { x: pt.pos.x + 0.7 },
          { y: pt.pos.y - 0.9 },
          { x: pt.pos.x - 1.3, y: pt.pos.y + 2.2 },
          { x: pt.pos.x + 24 },
          { x: pt.pos.x, y: pt.pos.y },
        ]
        for (const to of targets) {
          const res = applyFeatureEdit(c, MODELS, { point: pt, to })
          const where = `${id}/${pt.kind}@${pt.pos.x.toFixed(2)} -> ${JSON.stringify(to)}`
          if (res.ok) {
            expect(res.params.every(Number.isFinite), `${where}: params ${res.params}`).toBe(true)
            expect(res.params.length, where).toBe(params.length)
            if (res.domain) {
              expect(res.domain.every(Number.isFinite), where).toBe(true)
              expect(res.domain[1] > res.domain[0], where).toBe(true)
            }
            for (const q of res.alsoMoved ?? []) {
              expect(Number.isFinite(q.pos.x) && Number.isFinite(q.pos.y), where).toBe(true)
            }
          } else {
            expect(typeof res.reason, where).toBe('string')
            expect(res.reason.length, where).toBeGreaterThan(0)
            if (res.nearest) {
              expect(res.nearest.params.every(Number.isFinite), where).toBe(true)
            }
          }
          expect(c.params, `${where}: params must not be mutated`).toEqual(params)
        }
      }
    }
  })

  it('runs comfortably inside a typed commit, and fast enough to drag', () => {
    const c = curve('poly3', fromRoots(0.5, [-2, 1, 3]), [-6, 6])
    const pt = feat(c, 'zero', 1)
    const N = 200
    const t0 = performance.now()
    for (let i = 0; i < N; i++) {
      applyFeatureEdit(c, MODELS, { point: pt, to: { x: 1 + i / 1000 } })
    }
    const per = (performance.now() - t0) / N
    expect(per, `${per.toFixed(3)} ms per edit`).toBeLessThan(10)
  })
})

// ---------------------------------------------------------------------------
// Asymptote families. The handle a student reaches for is the line the curve
// never touches, so — uniquely — it is not a point of the curve at all.
// ---------------------------------------------------------------------------

describe('logarithm and reciprocal handles', () => {
  it('a logarithm carries its asymptote handle at x = b', () => {
    const params = [1.6, -4.5, 0]
    const hs = getHandles(curve('log', params, [-4.5, 6]), MODELS)
    const a = hs.find(h => h.id === 'asymptote')
    expect(a, 'no asymptote handle').toBeDefined()
    expect(a!.pos.x).toBeCloseTo(-4.5, 12)
    expect(Number.isFinite(a!.pos.y), 'the handle needs a finite height to be grabbed').toBe(true)
    expect(hs.find(h => h.id === 'scale'), 'no scale handle').toBeDefined()
    expect(hs.find(h => h.id === 'domain-start')).toBeUndefined()
  })

  it("a reciprocal's handle sits where its two asymptotes cross", () => {
    const params = [1.5, -1, 0.5]
    const hs = getHandles(curve('recip', params, [-6, 6]), MODELS)
    const a = hs.find(h => h.id === 'asymptote')!
    expect(a.pos.x).toBeCloseTo(-1, 12)
    expect(a.pos.y).toBeCloseTo(0.5, 12)
  })

  it('dragging the asymptote translates the curve rigidly, domain included', () => {
    for (const [id, params, dom] of [
      ['log', [1.6, -4.5, 0], [-4.5, 6]],
      ['recip', [1.5, -1, 0.5], [-6, 6]],
    ] as Array<[string, number[], [number, number]]>) {
      const c = curve(id, params, dom)
      const h = getHandles(c, MODELS).find(q => q.id === 'asymptote')!
      const res = applyHandleDrag(c, MODELS, 'asymptote', { x: h.pos.x + 1.5, y: h.pos.y - 2 })
      expect(res.params[1], `${id}: asymptote`).toBeCloseTo(params[1] + 1.5, 9)
      expect(res.params[2], `${id}: offset`).toBeCloseTo(params[2] - 2, 9)
      expect(res.params[0], `${id}: shape changed`).toBeCloseTo(params[0], 9)
      expect(res.domain![0]).toBeCloseTo(dom[0] + 1.5, 9)
      expect(res.domain![1]).toBeCloseTo(dom[1] + 1.5, 9)
      // the curve is the same curve, moved
      const ev = MODELS[id].evalExplicit!
      for (const d of [0.7, 2, 4]) {
        const before = ev(params, params[1] + d)
        const after = ev(res.params, params[1] + 1.5 + d)
        expect(after, `${id} at +${d}`).toBeCloseTo(before - 2, 9)
      }
    }
  })

  it('dragging the scale handle sets the coefficient in closed form', () => {
    // log: y = a·ln(x - b) + c, so a = (y - c) / ln(x - b)
    const lp = [1.6, -4.5, 0]
    const lc = curve('log', lp, [-4.5, 6])
    const ls = getHandles(lc, MODELS).find(h => h.id === 'scale')!
    const lu = Math.log(ls.pos.x - lp[1])
    const lres = applyHandleDrag(lc, MODELS, 'scale', { x: ls.pos.x, y: lp[2] + 2.75 * lu })
    expect(lres.params[0]).toBeCloseTo(2.75, 9)
    expect(lres.params[1], 'asymptote moved').toBeCloseTo(lp[1], 12)
    expect(lres.params[2], 'offset moved').toBeCloseTo(lp[2], 12)

    // recip: y = a/(x - b) + c, so a = (y - c)·(x - b)
    const rp = [1.5, -1, 0.5]
    const rc = curve('recip', rp, [-6, 6])
    const rs = getHandles(rc, MODELS).find(h => h.id === 'scale')!
    const ru = rs.pos.x - rp[1]
    const rres = applyHandleDrag(rc, MODELS, 'scale', { x: rs.pos.x, y: rp[2] + 3.2 / ru })
    expect(rres.params[0]).toBeCloseTo(3.2, 9)
    expect(rres.params[1], 'pole moved').toBeCloseTo(rp[1], 12)
    expect(rres.params[2], 'offset moved').toBeCloseTo(rp[2], 12)
  })

  it('a logarithm can never be trimmed into the half-plane it does not occupy', () => {
    const c = curve('log', [1.6, -4.5, 0], [-4.5, 6])
    const res = applyHandleDrag(c, MODELS, 'domain-start', { x: -20, y: 0 })
    expect(res.domain![0], 'trimmed left of the asymptote').toBeGreaterThanOrEqual(-4.5)
    const ev = MODELS.log.evalExplicit!
    expect(Number.isFinite(ev(res.params, res.domain![0] + 1e-6))).toBe(true)
  })
})

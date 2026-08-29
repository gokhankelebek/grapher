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
} from '../src/core/fit/edit'
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
    // point (poly2 curvature, sine midline, logistic steepness). Every other
    // feature/radius handle must sit ON the curve.
    const KNOBS = new Set(['width', 'midline', 'rate'])
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
    for (const [id, params, domain] of FAMILY_FIXTURES) {
      const spec = MODELS[id]
      if (spec.kind !== 'explicit' || !domain) continue
      const hs = getHandles(curve(id, params, domain), MODELS)
      const s = hs.find(h => h.id === 'domain-start')
      const e = hs.find(h => h.id === 'domain-end')
      expect(s, `${id}: no domain-start`).toBeDefined()
      expect(e, `${id}: no domain-end`).toBeDefined()
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

  it('DOCUMENTS: a MULTI-period sinusoid does not localize a drag', () => {
    // types.ts promises dragCurvePoint "soft-anchors the rest of the curve".
    // A sinusoid has only 4 global knobs (a, b, c, d), so when the view spans
    // several periods the anchors cannot be satisfied: dragging one point by
    // 1.0 moves an interior point by MORE than 1.0. Reported as a limitation;
    // this test pins the current behaviour so a fix shows up here.
    const params = [1.5, 1.2, 0.3, 0.4]
    const domain: [number, number] = [-7, 7]   // ~2.7 periods
    const c = curve('sine', params, domain)
    const ev = MODELS.sine.evalExplicit!
    const np = dragCurvePoint(c, MODELS, { x: 0, y: ev(params, 0) }, { x: 0, y: ev(params, 0) + 1 })
    let worst = 0
    for (let i = 0; i <= 400; i++) {
      const x = domain[0] + (14 * i) / 400
      worst = Math.max(worst, Math.abs(ev(np, x) - ev(params, x)))
    }
    expect(worst).toBeGreaterThan(1)   // the defect: >100% of the drag distance
    expect(worst).toBeLessThan(2)      // but still bounded — no blow-up
    expect(np.every(Number.isFinite)).toBe(true)
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

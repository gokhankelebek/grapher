// ============================================================================
// tests/reviewFixesGeo.test.ts — regressions for the geometry review
// (measurements, transformations, centres, circle theorems, fitted export).
//
// One describe per finding, in the review's order. The property tests at the
// top are the point of the whole exercise: an exact form printed to a
// student must BE the number, so every exact text below is evaluated and
// compared with the value computed independently in floating point.
// ============================================================================

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Vec2 } from '../src/core/types'
import type { BoardInput, BoardShape, DocMeta } from '../src/core/persist'
import { docFromBoard, normalizeCircleView, serializeDoc, cleanXform } from '../src/core/persist'
import {
  decimalMeasure,
  distance,
  isDegenerate,
  lineThrough,
  measureOf,
  pointText,
  polygonReport,
  toRat,
} from '../src/core/geometry'
import { triangleCentres } from '../src/core/triangleCentres'
import * as T from '../src/core/transform2d'
import * as C from '../src/core/circleGeometry'
import { ssDiv, ssInv, ssMeasure, ssMul, ssRat, ssSqrt, ssValue } from '../src/core/surdSum'
import { circleSquareSteps } from '../src/core/conics'
import { parseAngle, parsePointRef, parseXformCommand, resolveOp } from '../src/core/parse/xform'
import { parseLinkedLine } from '../src/core/parse/shapes'
import { compileShapes, sceneShapes, shapeCard } from '../src/ui/shapeLinks'
import { centreOverlays } from '../src/ui/centreLinks'
import { applyReveal, maskShapes, shapeKey } from '../src/ui/reveal'
import type { SceneReveal } from '../src/ui/reveal'
import { docFigure, docModelFromJSON } from '../src/ui/docScene'
import { aidPoints, shapesBox } from '../src/ui/exportFit'
import { DEFAULT_EXTERNAL, circleOverlays, circlePanel, circlePointHandles, draggedCirclePoint, toggleCircleFlag } from '../src/ui/circleLinks'
import { setMeasureTo } from '../src/ui/shapeMeasure'
import { imageNumber, retargetImage } from '../src/ui/shapeXform'
import { ShapeMeasureSection } from '../src/ui/ShapeMeasureSection'
import { RevealContext, REVEAL_API_OFF } from '../src/ui/RevealAnswer'
import { HELP_SECTIONS } from '../src/ui/commands'
import { exampleById } from '../src/examples'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** The number an exact text says: "9 − 2√5", "(7√5 − 3)/2", "−27√13/13", "3/4". */
function evalExact(text: string): number {
  let s = text.replace(/−/g, '-').replace(/\s+/g, '')
  s = s.replace(/(\d)√(\d+)/g, '$1*Math.sqrt($2)').replace(/√(\d+)/g, 'Math.sqrt($1)')
  if (!/^[-+*/().\d]*(Math\.sqrt\(\d+\)[-+*/().\d]*)*$/.test(s)) throw new Error(`not an exact form: ${text}`)
  return Function(`return (${s})`)() as number
}

/** "(a, b)" → [a, b] at the top-level comma. */
function pair(text: string): [string, string] {
  const inner = text.trim().replace(/^≈\s*/, '').slice(1, -1)
  let depth = 0
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) return [inner.slice(0, i).trim(), inner.slice(i + 1).trim()]
  }
  throw new Error(`not a pair: ${text}`)
}

const agrees = (shown: number, truth: number): boolean => Math.abs(shown - truth) <= 1e-12 * Math.max(1, Math.abs(truth))

let seed = 20261004
const rnd = (): number => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}
const ri = (n: number): number => Math.floor(rnd() * (2 * n + 1)) - n

const META: DocMeta = { id: 'doc-geo', name: 'Geometry review', createdAt: 1000, modifiedAt: 1000 }
const shape = (over: Partial<BoardShape>): BoardShape => ({
  id: 'S1',
  src: 'ABC = (0,0) (2,0) (0,2)',
  params: [],
  color: '#4f9cf9',
  fill: false,
  visible: true,
  ...over,
})
const board = (shapes: BoardShape[]): BoardInput => ({
  curves: [],
  styles: {},
  candidates: new Map(),
  exprSources: {},
  viewport: { center: { x: 0, y: 0 }, pxPerUnit: 40 },
  selectedId: null,
  mode: 'draw',
  shapes,
})
const ROT_IMG = shape({
  id: 'I1',
  src: 'rotate ABC 90° about (5, -5)',
  color: '#f97316',
  xform: { of: 'S1', op: { t: 'rotate', angle: '90', about: '(5, -5)' } },
  measure: { centres: ['centroid', 'circumcentre'] },
})
const reveal = (hidden: (k: string) => boolean): SceneReveal => ({
  hidden,
  positions: true,
  pointKey: () => null,
  crossKey: (a, b) => `cross:${a}:${b}`,
})

// ---------------------------------------------------------------------------
// 1. false exact values
// ---------------------------------------------------------------------------

describe('1. an exact form is the number (no loose recognition)', () => {
  it('reproductions: each now exact and right, or a decimal', () => {
    const c = C.makeCircle(0, 0, 9)!
    const p = C.readCirclePoint('(4, -6)', c, 'P')
    expect(p.ok && p.p.coords.text).toBe('(18√13/13, −27√13/13)')

    const t1 = triangleCentres([{ x: 6, y: 7 }, { x: 3, y: 9 }, { x: 4, y: -9 }])!
    expect(t1.incentre.pt.text).toBe('(9 − 2√5, (7√5 − 3)/2)')
    expect(t1.incentre.exact).toBe(true)
    expect(evalExact(t1.inradius.text)).toBeCloseTo(t1.inradius.value, 12)

    const t2 = triangleCentres([{ x: -3, y: 5 }, { x: 0, y: -5 }, { x: -9, y: -4 }])!
    expect(t2.inradius.exact).toBe(false)
    expect(t2.inradius.text).not.toMatch(/√/)

    const t3 = triangleCentres([{ x: -6, y: 4 }, { x: 5, y: -4 }, { x: 3, y: 5 }])!
    expect(t3.incentre.pt.y.exact).toBe(false)
    expect(t3.incentre.pt.text).not.toMatch(/\//)

    const img = T.applyMotion({ kind: 'rotate', deg: -28, center: { x: 5, y: -2 } }, { x: 5, y: 5 })
    const truth = 5 + 7 * Math.sin((28 * Math.PI) / 180)
    expect(img.x).toBeCloseTo(truth, 13) // clean no longer moves the vertex
    expect(T.numForm(img.x).exact).toBe(false)
    expect(T.numForm(img.x).text).not.toBe('2245/537')
  })

  it('the right isosceles triangle keeps its exact incentre 2 − √2, and a 3-4-5 its 1', () => {
    expect(triangleCentres([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }])!.incentre.pt.text).toBe('(2 − √2, 2 − √2)')
    expect(triangleCentres([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }])!.inradius.text).toBe('1')
  })

  it('typed decimals are still read exactly', () => {
    expect(pointText({ x: 0.1, y: -2.75 }).text).toBe('(1/10, −11/4)')
    expect(distance({ x: 0, y: 0 }, { x: 0.3, y: 0.4 }).text).toBe('1/2')
    expect(toRat(0.1)).toEqual({ n: 1, d: 10 })
    expect(toRat(4.180633150012)).toBeNull()
  })

  it('surd-sum arithmetic is exact: 1/(6√13 + 2√65), (√6 + √2)/4', () => {
    const P = ssMul(ssSqrt({ n: 13, d: 1 }), ssRat({ n: 6, d: 1 }))
    const inv = ssInv(P)!
    expect(ssValue(inv)).toBeCloseTo(1 / (6 * Math.sqrt(13)), 14)
    const q = ssDiv(ssSqrt({ n: 2, d: 1 }), ssSqrt({ n: 8, d: 1 }))!
    expect(ssMeasure(q)!.text).toBe('1/2')
  })

  it('PROPERTY: random integer triangles never print an incentre or inradius that disagrees with the float', () => {
    let exact = 0
    for (let it = 0; it < 4000; it++) {
      const pts = [0, 1, 2].map(() => ({ x: ri(9), y: ri(9) }))
      const t = triangleCentres(pts)
      if (!t) continue
      const [A, B, C2] = pts
      const a = Math.hypot(B.x - C2.x, B.y - C2.y)
      const b = Math.hypot(C2.x - A.x, C2.y - A.y)
      const c = Math.hypot(A.x - B.x, A.y - B.y)
      const per = a + b + c
      const Ix = (a * A.x + b * B.x + c * C2.x) / per
      const Iy = (a * A.y + b * B.y + c * C2.y) / per
      const area = Math.abs((B.x - A.x) * (C2.y - A.y) - (B.y - A.y) * (C2.x - A.x)) / 2
      const r = area / (per / 2)
      for (const [m, truth] of [[t.incentre.pt.x, Ix], [t.incentre.pt.y, Iy], [t.inradius, r]] as const) {
        if (!m.exact) continue
        exact++
        expect(agrees(evalExact(m.text), truth), `${JSON.stringify(pts)} ${m.text} vs ${truth}`).toBe(true)
      }
    }
    expect(exact).toBeGreaterThan(100)
  })

  it('PROPERTY: rotation images at non-special angles are never printed as a wrong exact value', () => {
    const special = new Set([0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330])
    for (let it = 0; it < 4000; it++) {
      const deg = ri(179)
      if (special.has(((deg % 360) + 360) % 360)) continue
      const p = { x: ri(9), y: ri(9) }
      const c = { x: ri(5), y: ri(5) }
      const q = T.applyMotion({ kind: 'rotate', deg, center: c }, p)
      const t = (deg * Math.PI) / 180
      const tx = c.x + (p.x - c.x) * Math.cos(t) - (p.y - c.y) * Math.sin(t)
      const ty = c.y + (p.x - c.x) * Math.sin(t) + (p.y - c.y) * Math.cos(t)
      for (const [got, truth] of [[q.x, tx], [q.y, ty]]) {
        expect(Math.abs(got - truth)).toBeLessThan(1e-12 * Math.max(1, Math.abs(truth)))
        const nf = T.numForm(got)
        if (nf.exact) expect(agrees(evalExact(nf.text), truth), `${deg}° ${JSON.stringify(p)} → ${nf.text}`).toBe(true)
      }
    }
  })

  it('PROPERTY: points typed off a circle are projected exactly, never onto a wrong form', () => {
    let exact = 0
    for (let it = 0; it < 3000; it++) {
      const k = 1 + Math.abs(ri(30))
      const r = Math.sqrt(k)
      const h = ri(4)
      const kk = ri(4)
      const circle = C.makeCircle(h, kk, r)!
      const x = ri(9)
      const y = ri(9)
      if (x === h && y === kk) continue
      const got = C.readCirclePoint(`(${x}, ${y})`, circle, 'P')
      if (!got.ok) continue
      const d = Math.hypot(x - h, y - kk)
      const truth = [h + (r * (x - h)) / d, kk + (r * (y - kk)) / d]
      const [sx, sy] = pair(got.p.coords.text)
      for (const [m, s, tv] of [[got.p.coords.x, sx, truth[0]], [got.p.coords.y, sy, truth[1]]] as const) {
        if (!m.exact) continue
        exact++
        expect(agrees(evalExact(s), tv), `${k} (${x}, ${y}) → ${s}`).toBe(true)
      }
    }
    expect(exact).toBeGreaterThan(1000)
  })

  it('PROPERTY: measureOf never calls an irrational float an exact form it is not', () => {
    for (let it = 0; it < 3000; it++) {
      const v = (ri(50) + rnd()) * Math.sqrt(2 + Math.abs(ri(40))) * (1 + rnd() * 1e-6)
      const m = measureOf(v)
      if (m.exact) expect(agrees(evalExact(m.text), v), `${v} → ${m.text}`).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// 2. brackets on sums
// ---------------------------------------------------------------------------

describe('2. a sum used as a coefficient is bracketed', () => {
  it('the tangent at 22.5° on x² + y² = 16, both forms and TeX', () => {
    const c = C.makeCircle(0, 0, 4)!
    const P = C.readCirclePoint('22.5', c, 'P')
    const t = C.tangentAt(c, (P as Extract<typeof P, { ok: true }>).p)!
    expect(t.line.slopeIntercept.text).toBe('y ≈ (−1 − √2)x + 10.45')
    expect(t.line.pointSlope.text).toBe('y − 1.53 ≈ (−1 − √2)(x − 3.7)')
    expect(t.line.slopeIntercept.tex).toContain('\\left(-1 - \\sqrt{2}\\right)x')
  })

  it('regular octagon symmetry lines and a point-slope line', () => {
    const oct = Array.from({ length: 8 }, (_, i) => ({ x: Math.cos(i * Math.PI / 4 + Math.PI / 8), y: Math.sin(i * Math.PI / 4 + Math.PI / 8) }))
    const eqs = T.symmetryOf(oct)!.lines.map((l) => l.equation)
    expect(eqs).toEqual(expect.arrayContaining(['y = (√2 − 1)x', 'y = (1 + √2)x', 'y = (−1 − √2)x', 'y = (1 − √2)x']))
    expect(lineThrough({ x: 0, y: 1 }, { x: 1, y: Math.SQRT2 }).pointSlope.text).toBe('y − 1 = (√2 − 1)x')
  })

  it('dilate by 1 + √2 and reflect across y = (1 + √2)x', () => {
    const d = resolveOp({ t: 'dilate', k: '1+sqrt(2)', about: '(1, 0)' })
    expect('motion' in d && T.motionRule(d.motion).text).toBe('(x, y) → ((1 + √2)x − √2, (1 + √2)y)')
    const r = resolveOp({ t: 'reflect', line: 'y = (1+sqrt(2))x' })
    expect('motion' in r && T.motionName(r.motion).text).toBe('r_{y=(1+√2)x}')
  })
})

// ---------------------------------------------------------------------------
// 3. degenerate polygons
// ---------------------------------------------------------------------------

describe('3. a vertex on a straight angle makes the polygon degenerate', () => {
  it('ABCD with B on AC is really the triangle ACD, not a kite', () => {
    const r = polygonReport([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 2 }])!
    expect(r.classification.name).toBe('degenerate quadrilateral')
    expect(r.classification.sentence).toBe('B lies on AC (∠B = 180°), so ABCD is really the triangle ACD, not a quadrilateral.')
  })

  it('a pentagon with a straight angle is not a convex pentagon', () => {
    const r = polygonReport([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }])!
    expect(r.classification.name).toBe('degenerate pentagon')
    expect(r.classification.sentence).toContain('really the quadrilateral ACDE')
  })

  it('a real kite and a real pentagon are untouched', () => {
    expect(polygonReport([{ x: 0, y: 0 }, { x: 2, y: 1 }, { x: 4, y: 0 }, { x: 2, y: 4 }])!.classification.name).toBe('kite')
    expect(isDegenerate([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 2, y: 1 }, { x: 0, y: 4 }])).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 4. a hidden image's centres
// ---------------------------------------------------------------------------

describe('4. the centres of a hidden image go with it', () => {
  const shapes = [shape({}), ROT_IMG]
  const compiled = compileShapes(shapes)

  it('an image’s centre overlays carry its image key', () => {
    const ov = centreOverlays(shapes, compiled)
    expect(ov.length).toBeGreaterThan(10)
    expect(ov.every((o) => o.hideWith === shapeKey('I1', 'image'))).toBe(true)
    // a pre-image's own centres are not tied to anything
    const own = centreOverlays([shape({ measure: { centres: ['centroid'] } })], compileShapes([shape({ measure: { centres: ['centroid'] } })]))
    expect(own.some((o) => o.hideWith)).toBe(false)
  })

  it('reveal mode (and an export made from it) drops them while the image is hidden', () => {
    const overlays = centreOverlays(shapes, compiled)
    const scene = { shapes: sceneShapes(shapes, compiled), curves: [], overlays } as never
    const hiddenOut = applyReveal(scene, reveal((k) => k === shapeKey('I1', 'image')))
    expect(hiddenOut.overlays).toEqual([])
    const shown = applyReveal(scene, reveal(() => false))
    expect(shown.overlays!.length).toBe(overlays.length)
  })

  it('the worksheet student copy draws none of them; the key does', () => {
    const m = docModelFromJSON(serializeDoc(docFromBoard(META, board(shapes), 2000)), { screen: { widthPx: 800, heightPx: 600 } })!
    const student = docFigure(m, { style: 'textbook', answers: false }).scene
    const key = docFigure(m, { style: 'textbook', answers: true }).scene
    expect((student.overlays ?? []).filter((o) => o.hideWith).length).toBe(0)
    expect((key.overlays ?? []).filter((o) => o.hideWith).length).toBeGreaterThan(10)
  })
})

// ---------------------------------------------------------------------------
// 5. smaller leaks
// ---------------------------------------------------------------------------

describe('5. smaller leaks', () => {
  it('a hidden translation’s vector is drawn clear of the figure: its tip is no image vertex', () => {
    const list = [shape({}), shape({ id: 'T', src: 'image', xform: { of: 'S1', op: { t: 'translate', by: ['3', '-2'] } } })]
    const all = sceneShapes(list, compileShapes(list))
    const img = all[1]
    const masked = maskShapes(all, (k) => k === shapeKey('T', 'image'))[1]
    if (img.kind !== 'polygon' || masked.kind !== 'polygon') throw new Error('polygons')
    const v = masked.aids!.vector!
    expect(v.label).toBe('⟨3, −2⟩')
    expect(v.v).toEqual({ x: 3, y: -2 })
    const tip = { x: v.tail.x + v.v.x, y: v.tail.y + v.v.y }
    for (const p of img.pts) expect(Math.hypot(tip.x - p.x, tip.y - p.y)).toBeGreaterThan(0.5)
    expect(v.tail).not.toEqual({ x: 0, y: 0 })
    // revealed: the vector runs from A to A′ again
    expect(maskShapes(all, () => false)[1]).toEqual(img)
  })

  it('“Right angle at A” and the section title wait for the classification', () => {
    const list = [shape({ src: 'ABC = (0,0) (4,0) (0,3)' })]
    const data = shapeCard(list[0], compileShapes(list)).measure!
    const el = createElement(ShapeMeasureSection, { shapeId: 'S1', data, settings: undefined, onMeasure: () => {}, onAddShape: () => null })
    const render = (hidden: boolean): string =>
      renderToStaticMarkup(createElement(RevealContext.Provider, { value: { ...REVEAL_API_OFF, on: true, hidden: () => hidden } }, el))
    const hid = render(true)
    expect(hid).not.toContain('Right angle at')
    expect(hid).not.toContain('Right triangle')
    expect(hid).not.toMatch(/right (scalene )?triangle/)
    expect(hid).toContain('reveal-pill')
    const shown = render(false)
    expect(shown).toContain('Right angle at A')
    expect(shown).toContain('Right triangle')
  })

  it('the Measurements summary states the area; the classification is its own answer', () => {
    const list = [shape({ src: 'ABC = (0,0) (4,0) (0,3)' })]
    const data = shapeCard(list[0], compileShapes(list)).measure!
    expect(data.summary).toBe('A = 6')
    expect(data.summaryPart).toBe('area')
    expect(data.summaryClass).toBe('right scalene triangle')
  })
})

// ---------------------------------------------------------------------------
// 6. export framing
// ---------------------------------------------------------------------------

describe('6. the fitted frame takes in the construction aids', () => {
  it('the centre (5, −5) and the whole rotation arc are inside the shapes box', () => {
    const list = [shape({}), { ...ROT_IMG, measure: undefined }]
    const box = shapesBox(sceneShapes(list, compileShapes(list)))!
    expect(box.max.x).toBeGreaterThanOrEqual(5)
    expect(box.min.y).toBeLessThanOrEqual(-10)
    // the arc from B (2, 0) about (5, −5) through 90° bulges past both ends
    const arcR = Math.hypot(2 - 5, 0 + 5)
    expect(box.max.y).toBeGreaterThanOrEqual(-5 + Math.hypot(3, 5) * Math.sin(Math.atan2(5, -3)) - 1e-9)
    expect(arcR).toBeGreaterThan(5)
  })

  it('a dilation’s rays and centre, a vector’s ends, a mirror’s anchor', () => {
    expect(aidPoints({ center: { at: { x: 9, y: 9 }, label: '' }, rays: [[{ x: 9, y: 9 }, { x: -3, y: -3 }]] })).toEqual([
      { x: 9, y: 9 }, { x: -3, y: -3 }, { x: 9, y: 9 },
    ])
    expect(aidPoints({ vector: { tail: { x: 1, y: 1 }, v: { x: 3, y: -2 }, label: '' } })).toEqual([{ x: 1, y: 1 }, { x: 4, y: -1 }])
  })
})

// ---------------------------------------------------------------------------
// 7. persistence
// ---------------------------------------------------------------------------

describe('7. on then off stores what was stored before', () => {
  const c = C.makeCircle(0, 0, 5)
  it('Tangents from T: the default T goes with the figure', () => {
    const on = toggleCircleFlag(undefined, 'external', c)
    expect(on.ext).toBe(DEFAULT_EXTERNAL(c!))
    expect(normalizeCircleView(toggleCircleFlag(on, 'external', c))).toBeNull()
  })

  it('Inscribed & central angle: the default points go; typed ones stay', () => {
    expect(normalizeCircleView(toggleCircleFlag(toggleCircleFlag(undefined, 'angles', c), 'angles', c))).toBeNull()
    const typed = { pts: ['45°'] }
    expect(normalizeCircleView(toggleCircleFlag(toggleCircleFlag(typed, 'angles', c), 'angles', c))).toEqual(typed)
    // a figure still on keeps the points it needs
    const two = toggleCircleFlag(toggleCircleFlag(undefined, 'sector', c), 'angles', c)
    expect(toggleCircleFlag(two, 'angles', c).pts).toEqual(['30°', '150°'])
  })

  it('a point’s partner set then cleared stores nothing', () => {
    expect(setMeasureTo(setMeasureTo(undefined, 'S2'), null)).toBeUndefined()
    // toggles the teacher changed are kept
    expect(setMeasureTo({ show: ['lengths'], to: 'S2' }, null)).toEqual({ show: ['lengths'] })
  })
})

// ---------------------------------------------------------------------------
// 8. the low items
// ---------------------------------------------------------------------------

describe('8. tiny, huge and near-degenerate figures', () => {
  it('a tiny value is never an exact 0', () => {
    expect(measureOf(2e-5).exact).toBe(false)
    expect(measureOf(2e-5).text).toBe('2 × 10⁻⁵')
    expect(distance({ x: 0, y: 0 }, { x: 0.00001, y: 0.00002 }).text).not.toBe('0')
    expect(decimalMeasure(0.0012).text).toBe('0.0012')
    expect(measureOf(1e-17).text).toBe('0') // rounding noise is still 0
  })

  it('a triangle 10⁻⁷ across is a triangle, with R and r that are not 0', () => {
    const pts = [{ x: 0, y: 0 }, { x: 1e-7, y: 0 }, { x: 0, y: 1e-7 }]
    expect(isDegenerate(pts)).toBe(false)
    expect(polygonReport(pts)!.classification.name).toBe('right isosceles triangle')
    const t = triangleCentres(pts)!
    expect(t.circumradius.text).not.toBe('0')
    expect(t.inradius.text).not.toBe('0')
    expect(t.notes[0]).not.toContain('= 0')
  })

  it('coordinates of 10⁸ print in scientific notation, not as rounding digits', () => {
    const r = polygonReport([{ x: 0, y: 0 }, { x: 1e8, y: 0 }, { x: 0, y: 1e8 }])!
    expect(r.right!.pythag.sums).toBe('1 × 10¹⁶ + 1 × 10¹⁶ = 2 × 10¹⁶')
  })

  it('a near-straight angle is "≈ 180.0°", never an exact-looking 180°', () => {
    const t = triangleCentres([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 1e-7 }])!
    expect(t.notes[0]).toContain('(≈ 180.0°)')
  })

  it('retyping an image with an unknown figure name is an error, not a silent no-op', () => {
    const list = compileShapes([shape({}), ROT_IMG])
    const entries = [...list.values()].map((c) => ({ id: c.id, shape: c.shape }))
    expect(retargetImage('XYZ', entries, 'I1', 'S1')).toEqual({ error: 'There is no figure named XYZ on the board — this is the image of ABC' })
    expect(retargetImage('ABC', entries, 'I1', 'S1')).toEqual({ of: 'S1' })
    expect(retargetImage('A′B′C′', entries, 'I1', 'S1')).toEqual({ error: 'A figure cannot be the image of itself' })
  })
})

// ---------------------------------------------------------------------------
// 9. the cosmetic list
// ---------------------------------------------------------------------------

describe('9. notation and wording', () => {
  it('R_{30°, (1, 1)}: no double sign, surds spaced', () => {
    const r = T.motionRule({ kind: 'rotate', deg: 30, center: { x: 1, y: 1 } }).text
    expect(r).toBe('(x, y) → ((√3/2)x − (1/2)y + (3 − √3)/2, (1/2)x + (√3/2)y − (√3 − 1)/2)')
  })

  it('a decimal makes an equation, a rule, a centre approximate — and it says so', () => {
    const seg = lineThrough({ x: 0.1234, y: 1.5 }, { x: 1.7, y: 4.43 })
    expect(seg.slopeIntercept.text).toMatch(/^y ≈ 1\.86x \+ 1\.27$/)
    const mirror = T.motionName({ kind: 'reflect', line: { kind: 'line', p: { x: 0, y: 0 }, q: { x: 1, y: Math.PI / 9 } } }).text
    expect(mirror).toBe('r_{y≈0.35x}')
    const rule = T.ruleOfAffine(T.motionAffine({ kind: 'rotate', deg: 40, center: { x: 0, y: 0 } }))
    expect(rule.text.startsWith('(x, y) → ≈ (')).toBe(true)
    expect(T.centreName({ x: Math.PI / 16, y: 1.4005 }).text).toBe('≈ (0.196, 1.401)')
  })

  it('“1/2 unit”, “1 unit”, “3 units”', () => {
    expect(T.motionWords({ kind: 'translate', v: { x: -0.5, y: 3 } })).toBe('a translation 1/2 unit left and 3 units up (by ⟨−1/2, 3⟩)')
  })

  it('sector working never says “= ≈”', () => {
    const c = C.makeCircle(0, 0, 4)!
    const P = C.readCirclePoint('0', c, 'P')
    const Q = C.readCirclePoint('(3, 4)', c, 'Q')
    const s = C.sectorOf(c, (P as Extract<typeof P, { ok: true }>).p, (Q as Extract<typeof Q, { ok: true }>).p)
    if ('error' in s) throw new Error(s.error)
    expect(s.arcRadian).toBe('s = rθ ≈ 4 · 0.927 ≈ 3.71')
    expect(s.areaRadian).toBe('A = ½r²θ ≈ ½ · 16 · 0.927 ≈ 7.42')
    for (const t of [s.arcRadian, s.areaRadian, s.arcDegree, s.areaDegree]) expect(t).not.toContain('= ≈')
  })

  it('completing the square: no repeated step, and a fractional coefficient halved in words', () => {
    const plain = circleSquareSteps('4x^2+4y^2=9')!
    const texs = plain.steps.map((s) => s.tex)
    expect(new Set(texs).size).toBe(texs.length)
    const frac = circleSquareSteps('2x^2+2y^2+3x-5y=1')!
    const why = frac.steps.map((s) => s.why).join(' ')
    expect(why).toContain('(3/2 ÷ 2)² = 9/16')
    expect(why).not.toContain('3/2/2')
  })

  it('a reflex central angle is the major arc, not ∠POQ', () => {
    const c = C.makeCircle(0, 0, 4)!
    const at = (s: string, n: string) => (C.readCirclePoint(s, c, n) as { ok: true; p: C.CirclePoint }).p
    const r = C.inscribedCentral(c, at('0', 'P'), at('120', 'Q'), at('60', 'R'))
    expect('relation' in r && r.relation).toBe('∠PRQ = ½·arc PQ (the major arc): 120° = ½ · 240°')
  })

  it('parser gaps: about centre C, counter clockwise, rad, primed names in linked lines', () => {
    const cmd = parseXformCommand('rotate ABC 90 about centre C')
    expect('op' in cmd && cmd.op.t === 'rotate' && parsePointRef(cmd.op.about, new Map([['C', { x: 1, y: 2 }]]))).toEqual({ p: { x: 1, y: 2 } })
    expect(parseAngle('90 counter clockwise')).toEqual({ deg: 90 })
    expect(parseAngle('90 anti clockwise')).toEqual({ deg: 90 })
    const rad = parseAngle('1.5708 rad')
    expect('deg' in rad && rad.deg).toBeCloseTo(90, 3)
    const ll = parseLinkedLine("parallel to A'B' through P")
    expect(ll && ll.ok && ll.link).toEqual({ rel: 'parallel', to: ['A′', 'B′'], through: 'P' })
  })

  it('a second image of ABC is A′₂B′₂C′₂ and keeps that name when the first goes', () => {
    const first = shape({ id: 'I1', src: 'image', xform: { of: 'S1', op: { t: 'rotate', angle: '90', about: '(0, 0)' } } })
    const second = shape({ id: 'I2', src: 'image', xform: { of: 'S1', op: { t: 'translate', by: ['1', '1'] }, n: 2 } })
    const both = compileShapes([shape({}), first, second])
    const lab = (m: ReturnType<typeof compileShapes>, id: string) => {
      const s = m.get(id)!.shape!
      return s.kind === 'polygon' ? s.labels : null
    }
    expect(lab(both, 'I1')).toEqual(['A′', 'B′', 'C′'])
    expect(lab(both, 'I2')).toEqual(['A′₂', 'B′₂', 'C′₂'])
    expect(lab(compileShapes([shape({}), second]), 'I2')).toEqual(['A′₂', 'B′₂', 'C′₂'])
    expect(imageNumber([shape({}), first], 'S1', null)).toBe(2)
    expect(imageNumber([shape({}), second], 'S1', null)).toBe(1)
    expect(cleanXform({ of: 'S1', op: { t: 'translate', by: ['1', '1'] }, n: 2 })?.n).toBe(2)
    expect(cleanXform({ of: 'S1', op: { t: 'translate', by: ['1', '1'] }, n: 1 })?.n).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Dragging a point along a circle
// ---------------------------------------------------------------------------

describe('a circle point dragged on the board', () => {
  const c = C.makeCircle(1, -1, 5)!
  const snap = (p: Vec2): Vec2 => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })

  it('an angle stays an angle (whole degrees), measured about the centre; radians become degrees', () => {
    expect(draggedCirclePoint(c, '30°', { x: 1 + 9, y: -1 + 9 }, snap)).toBe('45°')
    expect(draggedCirclePoint(c, 'pi/3', { x: 1, y: -10 }, snap)).toBe('270°')
    expect(draggedCirclePoint(c, '30°', { x: 1, y: -1 }, snap)).toBeNull()
  })

  it('a point typed as coordinates keeps coordinates, on the circle', () => {
    // pointer well outside the circle, toward (4, 3) from the centre: lands on (4, 3)
    expect(draggedCirclePoint(c, '(6, -1)', { x: 1 + 6, y: -1 + 8 }, snap)).toBe('(4, 3)')
    const text = draggedCirclePoint(c, '(6, -1)', { x: 3.3, y: 2.2 }, snap)!
    const back = C.readCirclePoint(text, c, 'P')
    expect(back.ok && Math.hypot(back.p.pt.x - 1, back.p.pt.y + 1)).toBeCloseTo(5, 9)
  })

  it('a dragged-to angle that is not exact reads "≈ 66.9°" on the board, never "= ≈"', () => {
    const curve = { id: 'c1', kind: 'implicit', visible: true, params: [], modelId: 'implicit', color: '#fff' } as never
    const p = circlePanel(curve, 'x^2 + y^2 = 25', { pts: ['60°', '(-3, 4)', '270°'], show: ['angles', 'sector'] })!
    const labels = circleOverlays([curve], { c1: 'x^2 + y^2 = 25' }, { c1: p.view }).flatMap((o) => (o.kind === 'label' ? [o.text] : []))
    expect(labels.some((t) => t.includes('≈'))).toBe(true)
    for (const t of labels) expect(t).not.toContain('= ≈')
  })

  it('each drawn point offers a handle where it is', () => {
    const curve = { id: 'c1', kind: 'implicit', visible: true, params: [], modelId: 'implicit' } as never
    const p = circlePanel(curve, '(x-1)^2 + (y+1)^2 = 25', { pts: ['0°', '(1, 4)'], show: ['tangent'] })!
    const hs = circlePointHandles(p)
    expect(hs.map((h) => [h.index, h.name])).toEqual([[0, 'P'], [1, 'Q']])
    expect(hs[0].pos.x).toBeCloseTo(6, 12)
    expect(hs[1].pos).toEqual({ x: 1, y: 4 })
  })
})

// ---------------------------------------------------------------------------
// The help sheet's standard codes (2016 NC SCOS)
// ---------------------------------------------------------------------------

describe('help-sheet standard codes', () => {
  it('triangle centres are NC Math 3 (NC.M3.G-CO.10), the gallery example with them', () => {
    const sec = HELP_SECTIONS.find((s) => s.id === 'm3-centres')!
    expect(sec.course).toBe('NC Math 3')
    expect(sec.title).toContain('NC.M3.G-CO.10')
    const ex = exampleById('m2-triangle-centres')!
    expect([ex.course, ex.unit, ex.help[0]]).toEqual(['math3', 'M3', 'm3-centres'])
  })

  it('right-triangle trig cites NC.M2.G-SRT.6 and 8, never the folded G-SRT.7', () => {
    const sec = HELP_SECTIONS.find((s) => s.id === 'm2-trig')!
    const all = [sec.title, ...sec.entries.map((e) => ('note' in e ? e.note ?? '' : ''))].join(' ')
    expect(all).toContain('NC.M2.G-SRT.6')
    expect(all).toContain('NC.M2.G-SRT.8')
    expect(all).not.toMatch(/SRT\.6–8|SRT\.7/)
  })

  it('normal distributions are filed honestly as NC Math 4 S-ID.4; simulation as NC.M3.S-IC', () => {
    const sec = HELP_SECTIONS.find((s) => s.id === 'm3-stats')!
    expect(sec.title).toContain('NC Math 4')
    expect(sec.title).toContain('S-ID.4')
    expect(sec.title).toContain('NC.M3.S-IC')
  })
})

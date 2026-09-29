// ============================================================================
// tests/implicitDiff.test.ts — implicit differentiation (AP Calculus Unit 3).
//
// The symbolic partials and dy/dx = −F_x/F_y in the form a student writes
// them; d²y/dx² with the relation used; the value at a point; horizontal and
// vertical tangents (worked by hand below); the drag that carries a tangent's
// point round a circle and through its vertical tangents; the card row; and
// persistence (an explicit tangent's record is byte-for-byte what it was).
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { FitResult, FittedCurve, ModelSpec } from '../src/core/types'
import {
  coordForm,
  dragOnCurve,
  implicitDiffOf,
  implicitFn,
  onCurve,
  pointSlopeText,
  pointText,
  reproject,
  specialTangents,
  tangentAt,
} from '../src/core/implicitDiff'
import { secondDerivativeOf } from '../src/core/euler'
import { implicitRow, implicitOverlays, defaultImplicitPoint, dragImplicitPoint } from '../src/ui/implicitLinks'
import type { TangentLink } from '../src/core/persist'
import { calcLinkToStored, deserializeDoc, docFromBoard, serializeDoc, storedToCalcLink } from '../src/core/persist'
import type { BoardInput, DocMeta } from '../src/core/persist'

const d = (src: string) => {
  const r = implicitDiffOf(src)
  if (!r) throw new Error(`no derivative for ${src}`)
  return r
}

describe('symbolic partials and dy/dx', () => {
  it('the circle x² + y² = 25: F_x = 2x, F_y = 2y, dy/dx = −x/y', () => {
    const r = d('x^2 + y^2 = 25')
    expect(r.Fx.text).toBe('2x')
    expect(r.Fy.text).toBe('2y')
    expect(r.dydx.text).toBe('−x/y')
    expect(r.dydx.tex).toBe('-\\frac{x}{y}')
  })

  it('the folium x³ + y³ = 6xy: dy/dx = (2y − x²)/(y² − 2x)', () => {
    const r = d('x^3 + y^3 = 6xy')
    expect(r.Fx.text).toBe('3x² − 6y')
    expect(r.Fy.text).toBe('3y² − 6x')
    expect(r.dydx.text).toBe('(2y − x²)/(y² − 2x)')
  })

  it('x² − xy + y² = 3: dy/dx = (y − 2x)/(2y − x)', () => {
    const r = d('x^2 - xy + y^2 = 3')
    expect(r.Fx.text).toBe('2x − y')
    expect(r.Fy.text).toBe('2y − x')
    expect(r.dydx.text).toBe('(y − 2x)/(2y − x)')
  })

  it('an ellipse x²/9 + y²/4 = 1: dy/dx = −4x/(9y), whatever form it is typed in', () => {
    expect(d('x^2/9 + y^2/4 = 1').dydx.text).toBe('−4x/(9y)')
    expect(d('4x^2 + 9y^2 - 36 = 0').dydx.text).toBe('−4x/(9y)')
    expect(d('x^2/9 + y^2/4 = 1').Fx.text).toBe('2x/9')
  })

  it('e^(xy) = x + y: dy/dx = (1 − y·e^(xy))/(x·e^(xy) − 1), and it is right', () => {
    const r = d('e^(xy) = x + y')
    expect(r.dydx.text).toBe('(1 − y·e^(xy))/(x·e^(xy) − 1)')
    // Against differences of F itself at a few points.
    const F = (x: number, y: number) => Math.exp(x * y) - x - y
    for (const [x, y] of [[0.3, -0.4], [1.1, 0.2], [-0.7, 0.9]]) {
      const h = 1e-6
      const fx = (F(x + h, y) - F(x - h, y)) / (2 * h)
      const fy = (F(x, y + h) - F(x, y - h)) / (2 * h)
      expect(r.slope(x, y)).toBeCloseTo(-fx / fy, 6)
    }
  })

  it('a slider rides along as a letter and evaluates at its value', () => {
    const r = implicitDiffOf('x^2 + y^2 = a^2', { a: 5 })!
    expect(r.dydx.text).toBe('−x/y')
    expect(r.slope(3, 4)).toBeCloseTo(-0.75, 12)
  })

  it('refuses what is not an equation in x and y', () => {
    expect(implicitDiffOf('x^2 + 1')).toBeNull()
    expect(implicitDiffOf('x = 3')).toBeNull()
    expect(implicitDiffOf('abs(y) = x')).toBeNull()
  })
})

describe('d²y/dx², with the relation used', () => {
  it('the circle: −(x² + y²)/y³ = −25/y³', () => {
    const r = d('x^2 + y^2 = 25')
    expect(r.d2!.raw.text).toBe('−(x² + y²)/y³')
    expect(r.d2!.onCurve!.text).toBe('−25/y³')
    expect(r.d2At(3, 4)).toBeCloseTo(-25 / 64, 12)
  })

  it('x² − xy + y² = 3: −18/(2y − x)³', () => {
    const r = d('x^2 - xy + y^2 = 3')
    expect(r.d2!.raw.text).toBe('−6(x² − xy + y²)/(2y − x)³')
    expect(r.d2!.onCurve!.text).toBe('−18/(2y − x)³')
  })

  it('the folium: −16xy/(y² − 2x)³', () => {
    const r = d('x^3 + y^3 = 6xy')
    expect(r.d2!.onCurve!.text).toBe('−16xy/(y² − 2x)³')
    // at (3, 3): −144/27 = −16/3
    expect(r.d2At(3, 3)).toBeCloseTo(-16 / 3, 10)
  })

  it('y² = x: −1/(4y³), no relation needed', () => {
    const r = d('y^2 = x')
    expect(r.d2!.raw.text).toBe('−1/(4y³)')
    expect(r.d2!.onCurve).toBeNull()
  })

  it('Euler’s d²y/dx² is unchanged by the move to src/core/symbolic.ts', () => {
    expect(secondDerivativeOf('dy/dx = x + y')).toEqual({
      text: '1 + dy/dx',
      tex: '1 + \\frac{dy}{dx}',
      inXY: { text: '1 + x + y', tex: '1 + x + y' },
    })
    expect(secondDerivativeOf('dy/dx = 0.5y(1 - y/5)')?.text).toBe('0.5(1 − 2y/5)·dy/dx')
  })
})

describe('numbers on the curve', () => {
  const circle = implicitFn((x, y) => x * x + y * y - 25)

  it('the value at (3, 4) is −3/4, exactly, and the tangent is y − 4 = −3/4 (x − 3)', () => {
    const r = d('x^2 + y^2 = 25')
    expect(coordForm(r.slope(3, 4)).text).toBe('−3/4')
    const t = tangentAt(circle, { x: 3, y: 4 })
    expect(t.kind).toBe('line')
    if (t.kind === 'line') expect(t.m).toBeCloseTo(-0.75, 9)
    expect(pointSlopeText({ x: 3, y: 4 }, -0.75).text).toBe('y − 4 = −3/4 (x − 3)')
    expect(pointSlopeText({ x: 5, y: 0 }, null).text).toBe('x = 5')
    expect(pointSlopeText({ x: 0, y: 5 }, 0).text).toBe('y = 5')
    expect(tangentAt(circle, { x: 5, y: 0 }).kind).toBe('vertical')
  })

  // x² − xy + y² = 3.  F_x = 2x − y, F_y = 2y − x.
  //   Horizontal: F_x = 0 ⇒ y = 2x ⇒ x² − 2x² + 4x² = 3x² = 3 ⇒ (1, 2), (−1, −2).
  //   Vertical:   F_y = 0 ⇒ x = 2y ⇒ 4y² − 2y² + y² = 3y² = 3 ⇒ (2, 1), (−2, −1).
  // Check (1, 2): 1 − 2 + 4 = 3 ✓, dy/dx = (2 − 2)/(4 − 1) = 0 ✓.
  // Check (2, 1): 4 − 2 + 1 = 3 ✓, dy/dx = (1 − 4)/(2 − 2): undefined ✓.
  it('x² − xy + y² = 3: horizontal tangents where y = 2x, vertical where x = 2y', () => {
    const r = d('x^2 - xy + y^2 = 3')
    const f = implicitFn((x, y) => x * x - x * y + y * y - 3, (x, y) => [r.fx(x, y), r.fy(x, y)])
    const box = { x0: -4, x1: 4, y0: -4, y1: 4 }
    const h = specialTangents(f, box, 'h')
    const v = specialTangents(f, box, 'v')
    expect(h.points).toEqual([{ x: -1, y: -2 }, { x: 1, y: 2 }])
    expect(v.points).toEqual([{ x: -2, y: -1 }, { x: 2, y: 1 }])
    expect(h.singular).toEqual([])
    expect(Math.abs(r.slope(1, 2))).toBe(0)
    expect(Math.abs(r.slope(2, 1))).toBe(Infinity)
  })

  it('the folium: (2∛2, 2∛4) horizontal, (2∛4, 2∛2) vertical, (0, 0) singular', () => {
    const f = implicitFn((x, y) => x ** 3 + y ** 3 - 6 * x * y)
    const box = { x0: -6, x1: 6, y0: -6, y1: 6 }
    const h = specialTangents(f, box, 'h')
    const v = specialTangents(f, box, 'v')
    expect(h.points.map((p) => pointText(p).text)).toEqual(['(2∛2, 2∛4)'])
    expect(v.points.map((p) => pointText(p).text)).toEqual(['(2∛4, 2∛2)'])
    expect(h.singular).toEqual([{ x: 0, y: 0 }])
    expect(h.points[0].x).toBeCloseTo(2 * Math.cbrt(2), 12)
  })

  it('a drag carries the point round the circle and straight through its vertical tangents', () => {
    let p = { x: 3, y: 4 }
    let prevAngle = Math.atan2(4, 3)
    let passedRight = false
    let passedLeft = false
    for (let k = 1; k <= 96; k++) {
      // The pointer runs clockwise round a slightly bigger circle.
      const a = Math.atan2(4, 3) - (k * 2 * Math.PI) / 96
      const next = dragOnCurve(circle, p, { x: 5.4 * Math.cos(a), y: 5.4 * Math.sin(a) })
      expect(onCurve(circle, next.x, next.y, 1e-10)).toBe(true)
      const got = Math.atan2(next.y, next.x)
      const diff = Math.atan2(Math.sin(got - a), Math.cos(got - a))
      expect(Math.abs(diff)).toBeLessThan(1e-9)
      // Crossing the vertical tangents: y changes sign at x ≈ ±5.
      if (p.y > 0 && next.y <= 0 && next.x > 0) passedRight = true
      if (p.y < 0 && next.y >= 0 && next.x < 0) passedLeft = true
      prevAngle = got
      p = next
    }
    expect(passedRight && passedLeft).toBe(true)
    expect(p.x).toBeCloseTo(3, 9)
    expect(p.y).toBeCloseTo(4, 9)
    void prevAngle
    // Onto the vertical tangent itself, and off again.
    const at5 = dragOnCurve(circle, p, { x: 5.3, y: 0 })
    expect(at5).toEqual({ x: 5, y: 0 })
    expect(tangentAt(circle, at5).kind).toBe('vertical')
    const below = dragOnCurve(circle, at5, { x: 5.2, y: -0.8 })
    expect(below.y).toBeLessThan(0)
  })

  it('re-projection keeps x and the branch when the curve changes; projects at a vertical tangent', () => {
    const r6 = implicitFn((x, y) => x * x + y * y - 36)
    const up = reproject(r6, 3, 4)!
    expect(up.x).toBe(3)
    expect(up.y).toBeCloseTo(Math.sqrt(27), 12)
    const down = reproject(r6, 3, -4)!
    expect(down.y).toBeCloseTo(-Math.sqrt(27), 12)
    const side = reproject(r6, 5, 0)!
    expect(side.x).toBeCloseTo(6, 12)
    expect(side.y).toBeCloseTo(0, 12)
  })
})

// ---------------------------------------------------------------------------
// The card row and the board, through a typed-curve stand-in
// ---------------------------------------------------------------------------

function typedModel(F: (x: number, y: number) => number): ModelSpec {
  return {
    id: 'expr_t',
    kind: 'implicit',
    name: 'Expression',
    evalImplicit: (_p, x, y) => F(x, y),
    latex: () => '',
    paramMeta: () => [],
  }
}

const curve = (color = '#4f9cf9'): FittedCurve => ({
  id: 'C',
  modelId: 'expr_t',
  params: [],
  kind: 'implicit',
  domain: null,
  color,
  strokeWidth: 2.5,
  visible: true,
  error: 0,
})

describe('the implicit tangent on the card and the board', () => {
  const models = { expr_t: typedModel((x, y) => x * x + y * y - 25) }
  const link: TangentLink = { kind: 'tangent', id: 'T', parentId: 'C', curveId: 'L', x: 3, y: 4 }
  const box = { x0: -8, x1: 8, y0: -8, y1: 8 }

  it('reads dy/dx, the exact value at (3, 4), the line, H/V tangents and d²y/dx²', () => {
    const row = implicitRow(link, curve(), models, 'x^2 + y^2 = 25', box)
    expect(row.problem).toBeNull()
    expect(row.dydx?.text).toBe('−x/y')
    expect(row.pointText).toBe('(3, 4)')
    expect(row.slopeText).toBe('−3/4')
    expect(row.line?.text).toBe('y − 4 = −3/4 (x − 3)')
    expect(row.horizontal).toEqual(['(0, −5)', '(0, 5)'])
    expect(row.vertical).toEqual(['(−5, 0)', '(5, 0)'])
    expect(row.d2?.onCurve?.text).toBe('−25/y³')
    expect(row.d2?.value).toBe('−25/64')
  })

  it('at a vertical tangent the slope is undefined and the line is x = 5', () => {
    const row = implicitRow({ ...link, x: 5, y: 0 }, curve(), models, 'x^2 + y^2 = 25', box)
    expect(row.slopeText).toMatch(/undefined/)
    expect(row.line?.text).toBe('x = 5')
  })

  it('marks the H/V tangents on the board only when asked', () => {
    expect(implicitOverlays([link], [curve()], models, {}, box)).toEqual([])
    const marks = implicitOverlays([{ ...link, marks: true }], [curve()], models, {}, box)
    const dots = marks.filter((o) => o.kind === 'dot')
    expect(dots).toHaveLength(4)
    expect(marks.filter((o) => o.kind === 'label').map((o) => (o as { text: string }).text)).toEqual([
      '(0, −5)',
      '(0, 5)',
      '(−5, 0)',
      '(5, 0)',
    ])
  })

  it('a new tangent starts at a lattice point: (3, 4) on the circle, (3, 3) on the folium', () => {
    expect(defaultImplicitPoint(curve(), models, { x0: -7, x1: 7, y0: -6, y1: 6 })).toEqual({ x: 3, y: 4 })
    const fol = { expr_t: typedModel((x, y) => x ** 3 + y ** 3 - 6 * x * y) }
    expect(defaultImplicitPoint(curve(), fol, { x0: -7, x1: 7, y0: -6, y1: 6 })).toEqual({ x: 3, y: 3 })
  })

  it('a drag near (3, 4) snaps onto it', () => {
    const snap = (v: number) => Math.round(v * 2) / 2
    const q = dragImplicitPoint(curve(), models, { x: 4, y: 3 }, { x: 3.04, y: 4.07 }, snap, { x: 40, y: 40 })
    expect(q).toEqual({ x: 3, y: 4 })
  })
})

describe('persistence', () => {
  const META: DocMeta = { id: 'd', name: 'Implicit', createdAt: 1, modifiedAt: 1 }
  const board = (over: Partial<BoardInput> = {}): BoardInput => ({
    curves: [],
    styles: {},
    candidates: new Map<string, FitResult[]>(),
    exprSources: {},
    viewport: { center: { x: 0, y: 0 }, pxPerUnit: 60 },
    selectedId: null,
    mode: 'draw',
    ...over,
  })

  it('an explicit tangent stores exactly what it always did', () => {
    const l: TangentLink = { kind: 'tangent', id: 'T', parentId: 'P', curveId: 'L', x: 2 }
    expect(JSON.stringify(calcLinkToStored(l))).toBe('{"kind":"tangent","id":"T","parentId":"P","curveId":"L","x":2}')
    expect(storedToCalcLink(calcLinkToStored(l))).toEqual(l)
  })

  it('an implicit tangent keeps its branch and its marks switch', () => {
    const l: TangentLink = { kind: 'tangent', id: 'T', parentId: 'P', curveId: 'L', x: 3, y: -4, marks: true }
    expect(calcLinkToStored(l)).toEqual({ kind: 'tangent', id: 'T', parentId: 'P', curveId: 'L', x: 3, y: -4, marks: true })
    expect(storedToCalcLink(calcLinkToStored(l))).toEqual(l)
    expect(storedToCalcLink({ ...calcLinkToStored(l), y: 'up', marks: 'yes' })).toEqual({
      kind: 'tangent',
      id: 'T',
      parentId: 'P',
      curveId: 'L',
      x: 3,
    })
  })

  it('a document without implicit tangents serialises byte-for-byte as before', () => {
    const plain = serializeDoc(docFromBoard(META, board(), 5))
    expect(plain).not.toContain('marks')
    const back = deserializeDoc(plain)
    expect(serializeDoc(docFromBoard(META, board({ calc: back.board!.calc }), 5))).toBe(plain)
  })
})

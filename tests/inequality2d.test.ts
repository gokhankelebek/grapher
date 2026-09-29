// ============================================================================
// tests/inequality2d.test.ts — two-variable inequalities, systems and linear
// programming.
//
// Parsing every form a teacher types, which side is shaded, strict → dashed,
// implicit inside / outside, the region polygons, the test-point sentences,
// the feasible polygon and the objective (worked by hand below), the card's
// words, persistence (old documents byte-identical) and the SAT mono wash.
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { FitResult, FittedCurve, InequalityInfo, ModelSpec, Vec2 } from '../src/core/types'
import { DARK_THEME, FIGURE_STYLES } from '../src/core/types'
import { parseExpression } from '../src/core/parse'
import {
  describeInequality,
  holdsAt,
  pointVerdict,
  regionPolygons,
  contourPolylines,
  testSentence,
} from '../src/core/inequality2d'
import { feasibleRegion, optimize, parseObjective, toFrac } from '../src/core/linprog'
import type { LinConstraint } from '../src/core/linprog'
import { prettyMath } from '../src/core/ineqText'
import {
  deserializeDoc,
  docFromBoard,
  serializeDoc,
  storedToSystem,
  systemToStored,
} from '../src/core/persist'
import type { BoardInput, DocMeta } from '../src/core/persist'
import { renderBoard } from '../src/ui/renderBoard'
import type { BoardScene } from '../src/ui/renderBoard'
import { MockCtx, withMockPath2D } from './mockCanvas'
import { INEQ_DASH, INEQ_MONO_ALPHA, clearInequalityCache } from '../src/render/inequalities'
import { systemCard, systemOverlays } from '../src/ui/systemLinks'
import { recordScene } from '../src/ui/vectorExport'
import { toSvg } from '../src/render/vectorSvg'
import { toPgfplots } from '../src/ui/pgfplotsExport'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function parse(src: string): { spec: ModelSpec; info: InequalityInfo; params: number[]; kind: string } {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(`${src}: ${o.error}`)
  const spec = o.plot.makeModel('m')
  const params = o.plot.defaultParams.slice()
  const info = spec.inequality?.(params)
  if (!info) throw new Error(`${src}: not an inequality`)
  return { spec, info, params, kind: o.plot.kind }
}

function inPoly(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

const inRegion = (p: Vec2, polys: readonly Vec2[][]): boolean => polys.some((poly) => inPoly(p, poly))

const BOX = { x0: -10, x1: 10, y0: -10, y1: 10 }
const OPTS = { cols: 400, rows: 200 }

function lin(src: string): LinConstraint[] {
  const { info } = parse(src)
  return info.parts.map((p) => {
    if (!p.linear) throw new Error(`${src} is not linear`)
    return { ...p.linear, strict: p.strict }
  })
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

describe('parsing two-variable inequalities', () => {
  it('y < f(x), y >= f(x), y ≤ …, y > … are explicit boundaries with a side', () => {
    const a = parse('y < x^2 - 4')
    expect(a.kind).toBe('explicit')
    expect(a.info.parts).toHaveLength(1)
    expect(a.info.parts[0].boundary.kind).toBe('y')
    expect(a.info.parts[0].side).toBe('below')
    expect(a.info.parts[0].strict).toBe(true)
    expect(a.spec.evalExplicit!(a.params, 3)).toBe(5)
    expect(a.info.parts[0].boundaryText).toBe('y = x² − 4')

    const b = parse('y >= 2x + 1')
    expect(b.info.parts[0].side).toBe('above')
    expect(b.info.parts[0].strict).toBe(false)
    expect(parse('y ≤ x').info.parts[0].side).toBe('below')
    expect(parse('y > -x').info.parts[0].side).toBe('above')
    // written the other way round
    expect(parse('x^2 > y').info.parts[0].side).toBe('below')
  })

  it('reads every spelling of ≤ and ≥', () => {
    for (const s of ['y <= x', 'y =< x', 'y ≤ x', 'y ⩽ x']) {
      const p = parse(s).info.parts[0]
      expect([p.side, p.strict], s).toEqual(['below', false])
    }
    for (const s of ['y >= x', 'y => x', 'y ≥ x', 'y ⩾ x']) {
      const p = parse(s).info.parts[0]
      expect([p.side, p.strict], s).toEqual(['above', false])
    }
  })

  it('x > 3 and x <= -1 are vertical boundaries', () => {
    const a = parse('x > 3').info.parts[0]
    expect(a.boundary).toEqual({ kind: 'x', c: 3 })
    expect(a.side).toBe('right')
    expect(a.strict).toBe(true)
    const b = parse('x <= -1').info.parts[0]
    expect(b.boundary).toEqual({ kind: 'x', c: -1 })
    expect(b.side).toBe('left')
    expect(b.strict).toBe(false)
    const c = parse('2x - 1 >= 5').info.parts[0]
    expect(c.boundary).toEqual({ kind: 'x', c: 3 })
    expect(c.side).toBe('right')
  })

  it('solves a line that is linear in y for y (and flips the side on a negative coefficient)', () => {
    const a = parse('x + 2y <= 8')
    expect(a.kind).toBe('explicit')
    const p = a.info.parts[0]
    expect(p.boundary.kind).toBe('y')
    expect(p.side).toBe('below')
    expect(a.spec.evalExplicit!(a.params, 2)).toBe(3)
    expect(p.boundaryLatex).toContain('\\frac{1}{2}')
    const b = parse('3x - y < 6')
    expect(b.info.parts[0].side).toBe('above') // y > 3x − 6
    expect(b.spec.evalExplicit!(b.params, 1)).toBe(-3)
  })

  it('x² + y² < 9 is an implicit boundary, shaded inside; > 9 outside', () => {
    const a = parse('x^2 + y^2 < 9')
    expect(a.kind).toBe('implicit')
    expect(a.info.parts[0].boundary.kind).toBe('implicit')
    expect(a.info.parts[0].side).toBe('inside')
    expect(parse('x^2 + y^2 >= 9').info.parts[0].side).toBe('outside')
    // neither: a parabola opening right
    expect(parse('y^2 < x').info.parts[0].side).toBe('where')
  })

  it('2 < y < x + 3 is a band between two boundaries', () => {
    const a = parse('2 < y < x + 3')
    expect(a.info.parts).toHaveLength(2)
    expect(a.info.parts.map((p) => [p.side, p.boundaryText])).toEqual([
      ['above', 'y = 2'],
      ['below', 'y = x + 3'],
    ])
    // mixed strictness stays per part
    const b = parse('-1 <= x < 2')
    expect(b.info.parts.map((p) => [p.boundary, p.strict])).toEqual([
      [{ kind: 'x', c: -1 }, false],
      [{ kind: 'x', c: 2 }, true],
    ])
  })

  it('refuses what it cannot shade, in words, with a position', () => {
    const bad = (s: string): string => {
      const o = parseExpression(s)
      if (o.ok) throw new Error(`${s} parsed`)
      return o.error
    }
    expect(bad('2 < y > x')).toMatch(/points one way/)
    expect(bad('x < 1 < y < 3')).toMatch(/At most two/)
    expect(bad('y <')).toMatch(/Nothing after/)
    expect(bad('y < x {x > 0}')).toMatch(/restriction/)
    expect(bad('r < 2')).toMatch(/x and y/)
  })

  it('leaves equations with conditions exactly as they were', () => {
    const a = parseExpression('y = x^2 {x < 2}')
    expect(a.ok && a.plot.kind).toBe('explicit')
    expect(a.ok && a.plot.makeModel('q').inequality).toBeUndefined()
    const b = parseExpression('y = x for x > 0')
    expect(b.ok && b.plot.makeModel('q').inequality).toBeUndefined()
  })

  it('sliders work: y < a x + b has sliders a, b and the side follows them', () => {
    const o = parseExpression('y < a x + b')
    expect(o.ok).toBe(true)
    if (!o.ok) return
    expect(o.plot.paramNames).toEqual(['a', 'b'])
    const spec = o.plot.makeModel('m')
    expect(spec.evalExplicit!([2, -1], 3)).toBe(5)
    const info = spec.inequality!([2, -1])
    expect(holdsAt(info.parts, 3, 4.9)).toBe(true)
    expect(holdsAt(info.parts, 3, 5.1)).toBe(false)
    // the coefficient of y is a slider: its sign decides the side
    const k = parseExpression('k y < x')
    if (!k.ok) throw new Error('k y < x')
    const ks = k.plot.makeModel('k')
    expect(ks.inequality!([2]).parts[0].side).toBe('below')
    expect(ks.inequality!([-2]).parts[0].side).toBe('above')
  })
})

// ---------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------

describe('the shaded region', () => {
  it('y < x² − 4 shades below the parabola', () => {
    const polys = regionPolygons(parse('y < x^2 - 4').info.parts, BOX, OPTS)
    expect(inRegion({ x: 0, y: -5 }, polys)).toBe(true)
    expect(inRegion({ x: 0, y: 0 }, polys)).toBe(false)
    expect(inRegion({ x: 3, y: 4.5 }, polys)).toBe(true)
    expect(inRegion({ x: 3, y: 5.5 }, polys)).toBe(false)
  })

  it('x > 3 shades exactly right of x = 3', () => {
    const polys = regionPolygons(parse('x > 3').info.parts, BOX, OPTS)
    expect(inRegion({ x: 3.01, y: 7 }, polys)).toBe(true)
    expect(inRegion({ x: 2.99, y: 7 }, polys)).toBe(false)
    const xs = polys.flat().map((p) => p.x)
    expect(Math.min(...xs)).toBe(3)
  })

  it('implicit inside and outside, by the sign of F down every column', () => {
    const inside = regionPolygons(parse('x^2 + y^2 < 9').info.parts, BOX, OPTS)
    expect(inRegion({ x: 0, y: 0 }, inside)).toBe(true)
    expect(inRegion({ x: 2, y: 2 }, inside)).toBe(true) // r ≈ 2.83
    expect(inRegion({ x: 2.2, y: 2.2 }, inside)).toBe(false) // r ≈ 3.11
    const outside = regionPolygons(parse('x^2 + y^2 > 9').info.parts, BOX, OPTS)
    expect(inRegion({ x: 0, y: 0 }, outside)).toBe(false)
    expect(inRegion({ x: 0, y: 3.2 }, outside)).toBe(true)
    expect(inRegion({ x: 0, y: -3.2 }, outside)).toBe(true)
    expect(inRegion({ x: 5, y: 0 }, outside)).toBe(true)
  })

  it('a compound band, and a system as the intersection of its parts', () => {
    const band = regionPolygons(parse('2 < y < x + 3').info.parts, BOX, OPTS)
    expect(inRegion({ x: 2, y: 3 }, band)).toBe(true)
    expect(inRegion({ x: 2, y: 1 }, band)).toBe(false)
    expect(inRegion({ x: -2, y: 2.5 }, band)).toBe(false) // above x + 3 there
    const sys = [...parse('y < x^2 - 4').info.parts, ...parse('y >= 2x + 1').info.parts]
    const polys = regionPolygons(sys, BOX, OPTS)
    expect(inRegion({ x: -3, y: 0 }, polys)).toBe(true) // 0 < 5 and 0 ≥ −5
    expect(inRegion({ x: 4, y: 9.5 }, polys)).toBe(true) // 9.5 < 12, 9.5 ≥ 9
    expect(inRegion({ x: 0, y: 0 }, polys)).toBe(false)
  })

  it('an implicit boundary comes out as chained polylines — one closed circle', () => {
    const F = parse('x^2 + y^2 < 9').info.parts[0].s
    const lines = contourPolylines(F, BOX, 80, 80)
    expect(lines).toHaveLength(1)
    const c = lines[0]
    expect(c.length).toBeGreaterThan(50)
    for (const p of c) expect(Math.hypot(p.x, p.y)).toBeCloseTo(3, 2)
    expect(Math.hypot(c[0].x - c[c.length - 1].x, c[0].y - c[c.length - 1].y)).toBeLessThan(1e-9)
  })
})

// ---------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------

describe('test-point sentences', () => {
  it('writes the substitution out, then the values, then ✓ or ✗', () => {
    expect(testSentence(parse('y < x^2 - 4').info, { x: 1, y: 2 }).text).toBe('(1, 2): 2 < 1² − 4 → 2 < −3 ✗')
    expect(testSentence(parse('y >= 2x + 1').info, { x: 1, y: 2 }).text).toBe('(1, 2): 2 ≥ 2·1 + 1 → 2 ≥ 3 ✗')
    expect(testSentence(parse('y >= 2x + 1').info, { x: -1, y: 0 }).text).toBe('(−1, 0): 0 ≥ 2·(−1) + 1 → 0 ≥ −1 ✓')
    expect(testSentence(parse('x > 3').info, { x: 4, y: 0 }).text).toBe('(4, 0): 4 > 3 ✓')
    expect(testSentence(parse('x^2 + y^2 < 9').info, { x: 1, y: 2 }).text).toBe('(1, 2): 1² + 2² < 9 → 5 < 9 ✓')
    expect(testSentence(parse('2 < y < x + 3').info, { x: 1, y: 2 }).text).toBe('(1, 2): 2 < 2 < 1 + 3 → 2 < 2 < 4 ✗')
  })

  it('substitutes the sliders too, and a point on a ≤ boundary passes', () => {
    const o = parseExpression('y < a x + 1')
    if (!o.ok) throw new Error('parse')
    const info = o.plot.makeModel('m').inequality!([2])
    expect(testSentence(info, { x: 1, y: 2 }).text).toBe('(1, 2): 2 < 2·1 + 1 → 2 < 3 ✓')
    const v = pointVerdict(parse('y <= x').info, { x: 2, y: 2 })
    expect(v.ok).toBe(true)
    expect(v.onBoundary).toBe(true)
    expect(pointVerdict(parse('y < x').info, { x: 2, y: 2 }).ok).toBe(false)
  })

  it('prettifies typed math', () => {
    expect(prettyMath('x^2 - 4')).toBe('x² − 4')
    expect(prettyMath('2*x+1')).toBe('2x + 1')
    expect(prettyMath('-x^(-1)')).toBe('−x⁻¹')
    expect(prettyMath('sqrt(x) <= pi')).toBe('√(x) ≤ π')
  })

  it('the card: boundary, side, dash, and the classic origin test', () => {
    const d = describeInequality(parse('y < x^2 - 4').info)
    expect(d.shade).toBe('Shaded below y = x² − 4, boundary dashed (strict)')
    expect(d.boundaries).toEqual([{ latex: 'y = x^{2}-4', text: 'y = x² − 4', dashed: true }])
    expect(d.test?.text).toBe('Test (0, 0): 0 < 0² − 4 → 0 < −4 ✗ → shade the side without the origin')
    expect(d.test?.note).toBeNull()

    const e = describeInequality(parse('y >= 2x + 1').info)
    expect(e.shade).toBe('Shaded above y = 2x + 1, boundary solid (included)')
    expect(e.test?.text).toBe('Test (0, 0): 0 ≥ 2·0 + 1 → 0 ≥ 1 ✗ → shade the side without the origin')

    expect(describeInequality(parse('x^2 + y^2 < 9').info).shade).toBe('Shaded inside x² + y² = 9, boundary dashed (strict)')
    expect(describeInequality(parse('x > 3').info).shade).toBe('Shaded right of x = 3, boundary dashed (strict)')
    expect(describeInequality(parse('2 < y <= x + 3').info).shade).toBe(
      'Shaded above y = 2 and below y = x + 3, y = 2 dashed, y = x + 3 solid',
    )
  })

  it('the origin on the boundary: another point is tested and the card says why', () => {
    const d = describeInequality(parse('y > x').info)
    expect(d.test?.point).toEqual({ x: 1, y: 0 })
    expect(d.test?.text).toBe('Test (1, 0): 0 > 1 ✗ → shade the side without (1, 0)')
    expect(d.test?.note).toMatch(/on the boundary/)
  })
})

// ---------------------------------------------------------------------------
// Linear programming
// ---------------------------------------------------------------------------

describe('linear programming', () => {
  // x ≥ 0, y ≥ 0, x + y ≤ 4, x + 3y ≤ 6.
  // By hand: x + y = 4 meets x + 3y = 6 where 2y = 2, y = 1, x = 3 → (3, 1);
  // x + y = 4 meets y = 0 at (4, 0) (and 4 + 0 ≤ 6 ✓); x + 3y = 6 meets
  // x = 0 at (0, 2) (0 + 2 ≤ 4 ✓); the origin. (6, 0) fails x + y ≤ 4 and
  // (0, 4) fails x + 3y ≤ 6, so they are not corners.
  const SYS = [...lin('x >= 0'), ...lin('y >= 0'), ...lin('x + y <= 4'), ...lin('x + 3y <= 6')]

  it('the feasible polygon: (0, 0), (4, 0), (3, 1), (0, 2), bounded', () => {
    const r = feasibleRegion(SYS)
    expect(r.status).toBe('bounded')
    const labels = r.vertices.map((v) => v.label).sort()
    expect(labels).toEqual(['(0, 0)', '(0, 2)', '(3, 1)', '(4, 0)'])
    // in order round the boundary: every consecutive pair shares a line
    expect(r.vertices).toHaveLength(4)
  })

  it('exact corners where rational: 2x + y ≤ 4 and x + 2y ≤ 4 meet at (4/3, 4/3)', () => {
    const r = feasibleRegion([...lin('x >= 0'), ...lin('y >= 0'), ...lin('2x + y <= 4'), ...lin('x + 2y <= 4')])
    expect(r.vertices.map((v) => v.label)).toContain('(4/3, 4/3)')
    const v = r.vertices.find((q) => q.label === '(4/3, 4/3)')!
    expect(v.exact).toEqual({ x: { n: 4, d: 3 }, y: { n: 4, d: 3 } })
    // and one with a thirds corner: x + y ≤ 4, x − 2y ≥ 0 → (8/3, 4/3)
    const s = feasibleRegion([...lin('y >= 0'), ...lin('x + y <= 4'), ...lin('x - 2y >= 0')])
    expect(s.vertices.map((q) => q.label)).toContain('(8/3, 4/3)')
    expect(toFrac(0.1)).toEqual({ n: 1, d: 10 })
  })

  it('P = 3x + 2y: maximum 12 at (4, 0), minimum 0 at (0, 0)', () => {
    // By hand: P(0,0) = 0, P(4,0) = 12, P(3,1) = 11, P(0,2) = 4.
    const r = feasibleRegion(SYS)
    const o = parseObjective('P = 3x + 2y')
    expect(o.ok).toBe(true)
    if (!o.ok) return
    const max = optimize(r, o.obj, 'max')
    expect(max.status).toBe('optimal')
    expect(max.value).toBe(12)
    expect(max.at?.map((v) => v.label)).toEqual(['(4, 0)'])
    expect(max.sentence).toBe('Maximum P = 12 at (4, 0).')
    const byCorner = Object.fromEntries(max.rows.map((row) => [row.vertex.label, row.value]))
    expect(byCorner).toEqual({ '(0, 0)': 0, '(4, 0)': 12, '(3, 1)': 11, '(0, 2)': 4 })
    expect(max.rows.find((row) => row.vertex.label === '(3, 1)')!.work).toBe('3(3) + 2(1) = 11')
    const min = optimize(r, o.obj, 'min')
    expect(min.value).toBe(0)
    expect(min.at?.map((v) => v.label)).toEqual(['(0, 0)'])
  })

  it('multiple optima: P = x + y is 4 along the whole edge from (4, 0) to (3, 1)', () => {
    const o = parseObjective('x + y')
    if (!o.ok) throw new Error('objective')
    const res = optimize(feasibleRegion(SYS), o.obj, 'max')
    expect(res.status).toBe('optimal')
    expect(res.along).toBe('edge')
    expect(res.at?.map((v) => v.label).sort()).toEqual(['(3, 1)', '(4, 0)'])
    expect(res.sentence).toMatch(/every point of the edge/)
  })

  it('unbounded: x ≥ 0, y ≥ 0, x + y ≥ 2 has no maximum but a minimum', () => {
    const r = feasibleRegion([...lin('x >= 0'), ...lin('y >= 0'), ...lin('x + y >= 2')])
    expect(r.status).toBe('unbounded')
    expect(r.vertices.map((v) => v.label).sort()).toEqual(['(0, 2)', '(2, 0)'])
    const o = parseObjective('C = 3x + 2y')
    if (!o.ok) throw new Error('objective')
    const max = optimize(r, o.obj, 'max')
    expect(max.status).toBe('none')
    expect(max.sentence).toMatch(/^No maximum/)
    const min = optimize(r, o.obj, 'min')
    expect(min.status).toBe('optimal')
    expect(min.value).toBe(4)
    expect(min.at?.map((v) => v.label)).toEqual(['(0, 2)'])
  })

  it('infeasible: no solution, whether the lines are parallel or not', () => {
    const par = feasibleRegion([...lin('x + y <= 1'), ...lin('x + y >= 3')])
    expect(par.status).toBe('empty')
    const tri = feasibleRegion([...lin('x >= 3'), ...lin('y >= 0'), ...lin('x + y <= 2')])
    expect(tri.status).toBe('empty')
    const o = parseObjective('P = x')
    if (!o.ok) throw new Error('objective')
    expect(optimize(tri, o.obj, 'max').sentence).toMatch(/^No solution/)
  })

  it('a corner on a dashed boundary is approached, not attained', () => {
    const r = feasibleRegion([...lin('x >= 0'), ...lin('y >= 0'), ...lin('x + y < 4')])
    const o = parseObjective('P = x')
    if (!o.ok) throw new Error('objective')
    const res = optimize(r, o.obj, 'max')
    expect(res.attained).toBe(false)
    expect(res.sentence).toMatch(/never reaches it/)
  })

  it('refuses a non-linear objective', () => {
    expect(parseObjective('P = x^2 + y').ok).toBe(false)
    expect(parseObjective('P = x y').ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Board, card, persistence, drawing
// ---------------------------------------------------------------------------

function typed(id: string, src: string, color = '#4f9cf9'): { curve: FittedCurve; spec: ModelSpec } {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(src)
  const spec = o.plot.makeModel(`expr_${id}`)
  return {
    spec,
    curve: {
      id,
      modelId: `expr_${id}`,
      params: o.plot.defaultParams.slice(),
      kind: o.plot.kind,
      domain: o.plot.domain,
      color,
      strokeWidth: 2.5,
      visible: true,
      error: 0,
    },
  }
}

function boardOf(srcs: string[]): { curves: FittedCurve[]; models: Record<string, ModelSpec> } {
  const curves: FittedCurve[] = []
  const models: Record<string, ModelSpec> = {}
  srcs.forEach((s, i) => {
    const t = typed(`c${i + 1}`, s)
    curves.push(t.curve)
    models[t.curve.modelId] = t.spec
  })
  return { curves, models }
}

describe('the system card', () => {
  it('lists each inequality’s test verdict and the LP table', () => {
    const { curves, models } = boardOf(['x >= 0', 'y >= 0', 'x + y <= 4', 'x + 3y <= 6'])
    const card = systemCard(curves, models, { solution: true, test: { x: 1, y: 2 }, objective: { src: 'P = 3x + 2y', goal: 'max' } })!
    expect(card.members).toHaveLength(4)
    expect(card.test?.rows.map((r) => r.text)).toEqual([
      '1 ≥ 0 ✓',
      '2 ≥ 0 ✓',
      '1 + 2 ≤ 4 → 3 ≤ 4 ✓',
      '1 + 3·2 ≤ 6 → 7 ≤ 6 ✗',
    ])
    expect(card.test?.all).toBe(false)
    expect(card.lp?.status).toBe('Bounded feasible region with 4 corners.')
    expect(card.lp?.objective?.result?.sentence).toBe('Maximum P = 12 at (4, 0).')
    const ov = systemOverlays(card, { solution: true, objective: { src: 'P = 3x + 2y', goal: 'max' }, iso: true, test: { x: 1, y: 2 } })
    expect(ov.filter((o) => o.kind === 'label').map((o) => (o as { text: string }).text)).toEqual(
      expect.arrayContaining(['(4, 0)  max P = 12', '(3, 1)', '(1, 2) ✗']),
    )
    expect(ov.some((o) => o.kind === 'line' && o.dashed)).toBe(true)
  })

  it('a non-linear member means no linear programming, said in words; hidden curves leave the system', () => {
    const { curves, models } = boardOf(['y < x^2 - 4', 'y >= 2x + 1'])
    const card = systemCard(curves, models, null)!
    expect(card.lp).toBeNull()
    expect(card.notLinear).toMatch(/linear/)
    const hidden = curves.map((c, i) => (i === 0 ? { ...c, visible: false } : c))
    expect(systemCard(hidden, models, null)!.members).toHaveLength(1)
  })
})

const META: DocMeta = { id: 'doc1', name: 'Ineq', createdAt: 1000, modifiedAt: 1000 }

function input(over: Partial<BoardInput> = {}): BoardInput {
  return {
    curves: [],
    styles: {},
    candidates: new Map<string, FitResult[]>(),
    exprSources: {},
    viewport: { center: { x: 0, y: 0 }, pxPerUnit: 60 },
    selectedId: null,
    mode: 'draw',
    ...over,
  }
}

describe('persistence', () => {
  it('a board without a system serialises byte-for-byte as before', () => {
    const a = serializeDoc(docFromBoard(META, input(), 2000))
    expect(serializeDoc(docFromBoard(META, input({ system: null }), 2000))).toBe(a)
    expect(serializeDoc(docFromBoard(META, input({ system: {} }), 2000))).toBe(a)
    expect(a).not.toContain('"system"')
    const back = deserializeDoc(a)
    expect(back.board!.system).toBeNull()
    expect(serializeDoc(docFromBoard(META, input({ system: back.board!.system }), 2000))).toBe(a)
  })

  it('an inequality persists as its typed line and comes back shading the same side', () => {
    const t = typed('e1', 'y < a x + 1')
    t.curve.params = [2]
    const json = serializeDoc(docFromBoard(META, input({ curves: [t.curve], exprSources: { e1: 'y < a x + 1' } }), 2000))
    const back = deserializeDoc(json)
    expect(back.board!.exprSources.e1).toBe('y < a x + 1')
    const spec = back.board!.extraModels[t.curve.modelId]
    expect(spec.inequality).toBeDefined()
    const info = spec.inequality!(back.board!.curves[0].params)
    expect(info.parts[0].side).toBe('below')
    expect(spec.evalExplicit!(back.board!.curves[0].params, 3)).toBe(7)
  })

  it('the system’s settings round-trip, only what is set is written, junk is dropped', () => {
    const sys = { solution: true as const, test: { x: 1, y: 2 }, objective: { src: 'P = 3x + 2y', goal: 'min' as const }, iso: true as const }
    const json = serializeDoc(docFromBoard(META, input({ system: sys }), 2000))
    expect(deserializeDoc(json).board!.system).toEqual(sys)
    expect(systemToStored({ test: { x: 1, y: 2 } })).toEqual({ test: { x: 1, y: 2 } })
    expect(storedToSystem({ solution: 'yes', test: { x: 'a' }, objective: { src: '' }, iso: 1 })).toBeNull()
  })
})

class DashCtx extends MockCtx {
  dashes: number[][] = []
  fillAlphas: { style: string; alpha: number }[] = []
  stroke(path?: never): void {
    this.dashes.push(this.lineDash.slice())
    super.stroke(path)
  }
  fill(): void {
    this.fillAlphas.push({ style: this.fillStyle, alpha: this.globalAlpha })
    super.fill()
  }
}

const VP = { center: { x: 0, y: 0 }, pxPerUnit: 40, widthPx: 600, heightPx: 400 }

function scene(srcs: string[], over: Partial<BoardScene> = {}): BoardScene {
  const { curves, models } = boardOf(srcs)
  return { vp: VP, theme: DARK_THEME, curves, styles: {}, models, analysis: null, chrome: null, ...over }
}

function render(s: BoardScene): DashCtx {
  clearInequalityCache()
  const ctx = new DashCtx()
  withMockPath2D(() => renderBoard(ctx as unknown as CanvasRenderingContext2D, s))
  return ctx
}

describe('drawing', () => {
  it('strict → dashed boundary, inclusive → solid', () => {
    const strict = render(scene(['y < x^2 - 4']))
    expect(strict.dashes.some((d) => d.length === 2 && d[0] === INEQ_DASH[0])).toBe(true)
    const incl = render(scene(['y <= x^2 - 4']))
    expect(incl.dashes.some((d) => d.length > 0)).toBe(false)
    const circle = render(scene(['x^2 + y^2 < 9']))
    expect(circle.dashes.some((d) => d[0] === INEQ_DASH[0])).toBe(true)
    const vert = render(scene(['x > 3']))
    expect(vert.dashes.some((d) => d[0] === INEQ_DASH[0])).toBe(true)
  })

  it('shades in the curve colour on screen, and a grey mono wash under SAT', () => {
    const screen = render(scene(['y < x^2 - 4']))
    expect(screen.fillAlphas.some((f) => f.style === '#4f9cf9' && f.alpha > 0.1 && f.alpha < 0.3)).toBe(true)
    const sat = FIGURE_STYLES.sat
    const mono = render(scene(['y < x^2 - 4'], { figure: sat, theme: sat.theme }))
    expect(mono.fillAlphas.some((f) => f.style === sat.theme.axis && f.alpha === INEQ_MONO_ALPHA)).toBe(true)
    expect(mono.fillAlphas.some((f) => f.style === '#4f9cf9' || f.style === '#1a5fb4')).toBe(false)
  })

  it('the solution region dims each wash and adds the common region', () => {
    const plain = render(scene(['y < x^2 - 4', 'y >= 2x + 1']))
    const sol = render(scene(['y < x^2 - 4', 'y >= 2x + 1'], { inequalitySolution: true }))
    expect(sol.fillAlphas.length).toBe(plain.fillAlphas.length + 1)
    expect(Math.max(...sol.fillAlphas.filter((f) => f.style === '#4f9cf9').map((f) => f.alpha))).toBeLessThan(
      Math.max(...plain.fillAlphas.filter((f) => f.style === '#4f9cf9').map((f) => f.alpha)),
    )
  })

  it('a board with no inequality draws exactly what it drew before', () => {
    const a = render(scene(['y = x^2 - 4']))
    const b = render(scene(['y = x^2 - 4'], { inequalitySolution: true }))
    expect(b.fillAlphas).toEqual(a.fillAlphas)
    expect(b.strokeCount).toBe(a.strokeCount)
  })

  it('reaches the SVG and pgfplots exports', () => {
    const s = scene(['y < x^2 - 4', 'y >= 2x + 1'], { inequalitySolution: true })
    const svg = toSvg(recordScene(s, 16))
    expect(svg).toContain('stroke-dasharray')
    expect(svg).toMatch(/fill-opacity="0\.2"/)
    const tex = toPgfplots(s, { sources: { c1: 'y < x^2 - 4', c2: 'y >= 2x + 1' } })
    expect(tex).toContain('% inequality region: y < x^2 - 4')
    expect(tex).toContain('% solution region of the system')
    expect(tex).toMatch(/\\addplot\[[^\]]*dashed/)
  })
})

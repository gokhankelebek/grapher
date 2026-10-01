// ============================================================================
// tests/paramCalc.test.ts — parametric and polar calculus (AP Calculus BC
// Unit 9): the derivatives written out, everything at a chosen t exact, the
// horizontal / vertical tangents and the cusp, arc length, displacement vs
// distance, the polar area and the area between two polar curves — and the
// two links in a file (old documents byte-identical), what dies with a
// curve, what the card says and what the board draws.
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { parseExpression } from '../src/core/parse'
import {
  arcLengthOf,
  atParam,
  betweenRegion,
  defaultBetweenBounds,
  derivativeLines,
  drSentence,
  formulaOf,
  paramSymbolic,
  polarAreaFormula,
  polarBetween,
  polarIntersections,
  tangentLists,
  tangentText,
} from '../src/core/paramCalc'
import { polarArea } from '../src/core/motion'
import {
  boardToStored,
  calcLinkToStored,
  calcNoun,
  deserializeDoc,
  docFromBoard,
  serializeDoc,
  storedToCalcLink,
} from '../src/core/persist'
import type { BoardInput, CalcLink, DocMeta, ParamCalcLink, PolarBetweenLink } from '../src/core/persist'
import { cardCalc, changeLabel, dependentsOf, linkNoun, overlaysFor } from '../src/ui/calcLinks'
import {
  applyParamCalcChange,
  defaultParamT,
  defaultPolarBetween,
  orientBetween,
  paramCalcOverlays,
  paramCalcRow,
  polarBetweenOverlays,
  polarBetweenRow,
  snapParamT,
} from '../src/ui/paramCalcLinks'
import { CALC_GROUPS } from '../src/ui/CurveCard'

const PI = Math.PI

/** A typed line as the board registers it. */
function typed(src: string, id = 'f', modelId = `expr_${id}`): { c: FittedCurve; models: Record<string, ModelSpec> } {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(o.error)
  const spec = o.plot.makeModel(modelId)
  return {
    c: {
      id,
      modelId,
      params: o.plot.defaultParams.slice(),
      kind: o.plot.kind,
      domain: o.plot.domain,
      color: '#4f9cf9',
      strokeWidth: 2.5,
      visible: true,
      error: 0,
    },
    models: { [modelId]: spec },
  }
}

function sym(src: string) {
  const { c, models } = typed(src)
  const s = paramSymbolic(src, c, models)
  return { c, models, s }
}

// ===========================================================================
// x = t², y = t³
// ===========================================================================

describe('x = t², y = t³', () => {
  const SRC = 'x = t^2, y = t^3'
  it('dy/dx = 3t/2 and d²y/dx² = 3/(4t), written out', () => {
    const { s } = sym(SRC)
    expect(s).not.toBeNull()
    expect(formulaOf('parametric', s!.dX).text).toBe('2t')
    expect(formulaOf('parametric', s!.dY).text).toBe('3t²')
    expect(formulaOf('parametric', s!.slope).text).toBe('3t/2')
    expect(formulaOf('parametric', s!.second!).text).toBe('3/(4t)')
    expect(formulaOf('parametric', s!.slope).tex).toBe('\\frac{3t}{2}')
    const lines = derivativeLines(s!).map((l) => l.text)
    expect(lines).toEqual([
      'dx/dt = 2t',
      'dy/dt = 3t²',
      'dy/dx = (dy/dt)/(dx/dt) = 3t/2',
      'd²y/dx² = (d/dt(dy/dx))/(dx/dt) = 3/(4t)',
    ])
  })

  it('at t = 1: the point, slope 3/2, d²y/dx² = 3/4 and the tangent y − 1 = 3/2 (x − 1)', () => {
    const { c, models, s } = sym(SRC)
    const at = atParam(c, models, s, 1)!
    expect(at.point.text).toBe('(1, 1)')
    expect(at.slope!.text).toBe('3/2')
    expect(at.second!.text).toBe('3/4')
    expect(at.tangent!.text).toBe('y − 1 = 3/2 (x − 1)')
    expect(at.speed.text).toBe('√13')
    expect(at.velocity.map((v) => v.text)).toEqual(['2', '3'])
    expect(at.acceleration!.map((v) => v.text)).toEqual(['2', '6'])
    expect(at.symbolic).toBe(true)
    expect(at.drawSlope).toBeCloseTo(1.5, 12)
  })

  it('at t = 0 both derivatives vanish: 0/0, the simplified limit, and a cusp', () => {
    const { c, models, s } = sym(SRC)
    const at = atParam(c, models, s, 0)!
    expect(at.singular).toBe(true)
    expect(at.slope).toBeNull()
    expect(at.tangent).toBeNull()
    expect(at.notes[0]).toContain('dy/dx = 0/0 there: undetermined')
    expect(at.notes[1]).toBe('The simplified dy/dx = 3t/2 → 0 as t → 0.')
    expect(at.notes[2]).toContain('cusp')
    const tl = tangentLists(c, models, s)
    expect(tl.horizontal).toEqual([])
    expect(tl.vertical).toEqual([])
    expect(tl.singular.map((p) => [p.tText, p.point])).toEqual([['0', '(0, 0)']])
    expect(tl.singular[0].notes!.join(' ')).toContain('cusp')
  })

  it('a sketch (no typed line) still gets every number, measured', () => {
    const { c, models } = typed(SRC)
    const at = atParam(c, models, null, 1)!
    expect(at.symbolic).toBe(false)
    expect(at.slope!.value).toBeCloseTo(1.5, 6)
    expect(at.tangent!.text).toContain('y − 1 =')
  })
})

// ===========================================================================
// The circle and the cycloid
// ===========================================================================

describe('the unit circle (cos t, sin t)', () => {
  const SRC = '(cos(t), sin(t))'
  it('speed 1; at π/4 the slope is −1 and d²y/dx² = −1/sin³t = −2√2', () => {
    const { c, models, s } = sym(SRC)
    expect(formulaOf('parametric', s!.slope).text).toBe('−cos(t)/sin(t)')
    expect(formulaOf('parametric', s!.second!).text).toBe('−1/sin(t)³')
    const at = atParam(c, models, s, PI / 4)!
    expect(at.speed.text).toBe('1')
    expect(at.slope!.text).toBe('−1')
    expect(at.second!.text).toBe('−2√2')
    expect(at.point.text).toBe('(√2/2, √2/2)')
    expect(at.tangent!.text).toBe('y − √2/2 = −(x − √2/2)')
  })

  it('arc length over [0, 2π] is 2π, and the particle comes home: displacement 0', () => {
    const { c, models, s } = sym(SRC)
    const arc = arcLengthOf(c, models, s, 0, 2 * PI)!
    expect(arc.length.text).toBe('2π')
    expect(arc.length.exact).toBe(true)
    expect(arc.integral.text).toBe('L = ∫ from 0 to 2π of √((−sin(t))² + cos(t)²) dt = 2π ≈ 6.283')
    expect(arc.displacement!.length.text).toBe('0')
    expect(arc.compare).toContain('ends where it started')
  })

  it('horizontal tangents at t = π/2, 3π/2; vertical at 0, π', () => {
    const { c, models, s } = sym(SRC)
    const tl = tangentLists(c, models, s)
    expect(tl.horizontal.map((p) => [p.tText, p.point])).toEqual([
      ['π/2', '(0, 1)'],
      ['3π/2', '(0, −1)'],
    ])
    expect(tl.vertical.map((p) => p.tText)).toEqual(['0', 'π'])
    expect(tl.singular).toEqual([])
  })

  it('displacement vs distance: half a turn is displacement 2, distance π', () => {
    const { c, models, s } = sym(SRC)
    const arc = arcLengthOf(c, models, s, 0, PI)!
    expect(arc.displacement!.dx.text).toBe('−2')
    expect(arc.displacement!.dy.text).toBe('0')
    expect(arc.displacement!.length.text).toBe('2')
    expect(arc.length.text).toBe('π')
    expect(arc.compare).toContain('more than the length of the displacement')
  })

  it('a straight run: distance = |displacement|', () => {
    const { c, models, s } = sym('x = 3t, y = 4t {0 <= t <= 2}')
    const arc = arcLengthOf(c, models, s, 0, 2)!
    expect(arc.length.text).toBe('10')
    expect(arc.displacement!.length.text).toBe('10')
    expect(arc.compare).toContain('one straight direction')
  })
})

describe('the cycloid x = t − sin t, y = 1 − cos t', () => {
  const SRC = 'x = t - sin(t), y = 1 - cos(t) {0 <= t <= 2pi}'
  it('arc length over [0, 2π] is 8', () => {
    const { c, models, s } = sym(SRC)
    const arc = arcLengthOf(c, models, s, 0, 2 * PI)!
    expect(arc.length.text).toBe('8')
    expect(arc.integral.text).toBe('L = ∫ from 0 to 2π of √((1 − cos(t))² + sin(t)²) dt = 8')
    expect(arc.integral.tex).toContain('\\int_{0}^{2\\pi}')
  })

  it('dy/dx = sin t/(1 − cos t); d²y/dx² cancels to −1/(1 − cos t)²', () => {
    const { s } = sym(SRC)
    expect(formulaOf('parametric', s!.slope).text).toBe('sin(t)/(1 − cos(t))')
    expect(formulaOf('parametric', s!.second!).text).toBe('−1/(1 − cos(t))²')
  })

  it('cusps at t = 0 and 2π with a vertical tangent direction; a horizontal tangent at π', () => {
    const { c, models, s } = sym(SRC)
    const tl = tangentLists(c, models, s)
    expect(tl.horizontal.map((p) => [p.tText, p.point])).toEqual([['π', '(π, 2)']])
    expect(tl.singular.map((p) => p.tText)).toEqual(['0', '2π'])
    expect(tl.singular[0].notes!.join(' ')).toContain('|dy/dx| → ∞')
    expect(tl.singular[0].notes!.join(' ')).toContain('cusp')
  })
})

// ===========================================================================
// Polar
// ===========================================================================

describe('the cardioid r = 1 + cos θ', () => {
  const SRC = 'r = 1 + cos(theta)'
  it('area ½∫₀²π (1 + cos θ)² dθ = 3π/2, written out', () => {
    const { c, models, s } = sym(SRC)
    const A = polarArea(c, models, 0, 2 * PI)!
    expect(A.text).toBe('3π/2')
    const f = polarAreaFormula(s, 0, 2 * PI, A.value)
    expect(f.text).toBe('½∫ from 0 to 2π of (1 + cos(θ))² dθ = 3π/2 ≈ 4.712')
    expect(f.tex).toContain('\\frac{1}{2}\\int_{0}^{2\\pi}')
    // no formula: r² itself
    expect(polarAreaFormula(null, 0, 2 * PI, A.value).text).toBe('½∫ from 0 to 2π of r² dθ = 3π/2 ≈ 4.712')
  })

  it('arc length ∫√(r² + r′²) dθ over [0, 2π] is 8', () => {
    const { c, models, s } = sym(SRC)
    const arc = arcLengthOf(c, models, s, 0, 2 * PI)!
    expect(arc.length.text).toBe('8')
    expect(arc.integral.text).toBe('L = ∫ from 0 to 2π of √((1 + cos(θ))² + (−sin(θ))²) dθ = 8')
    expect(arc.displacement).toBeUndefined()
  })

  it('r′ written; the polar dy/dx formula; at π/3 a horizontal tangent and r moving toward the pole', () => {
    const { c, models, s } = sym(SRC)
    const lines = derivativeLines(s!).map((l) => l.text)
    expect(lines[0]).toBe('r = 1 + cos(θ)')
    expect(lines[1]).toBe('r′ = dr/dθ = −sin(θ)')
    expect(lines[2]).toBe('dy/dx = (r′ sin θ + r cos θ)/(r′ cos θ − r sin θ)')
    const at = atParam(c, models, s, PI / 3)!
    expect(at.r!.text).toBe('3/2')
    expect(at.dr!.text).toBe('−√3/2')
    expect(at.slope!.text).toBe('0')
    expect(at.tangent!.text).toBe('y = 3√3/4')
    expect(at.drSentence).toBe('dr/dθ < 0 and r > 0: r is decreasing, so the point is moving toward the pole.')
  })

  it('the cusp at the pole (θ = π) is said', () => {
    const { c, models, s } = sym(SRC)
    const tl = tangentLists(c, models, s)
    expect(tl.singular.map((p) => p.tText)).toEqual(['π'])
    expect(tl.singular[0].notes!.join(' ')).toContain('cusp')
  })

  it('a compound slope is bracketed in the tangent line', () => {
    const { c, models, s } = sym(SRC)
    const at = atParam(c, models, s, PI / 4)!
    expect(at.slope!.text).toBe('1−√2')
    expect(at.tangent!.text).toMatch(/^y − 1\.207 = \(1−√2\)\(x − 1\.207\)$/)
    expect(tangentText({ x: 0, y: 1 }, 1 - Math.SQRT2).text).toBe('y − 1 = (1−√2)x')
  })
})

describe('r = 2 sin θ (the circle x² + (y − 1)² = 1), by hand', () => {
  // r = 2 sin θ, r′ = 2 cos θ
  //   dx/dθ = r′cos θ − r sin θ = 2cos²θ − 2sin²θ
  //   dy/dθ = r′sin θ + r cos θ = 4 sin θ cos θ
  // θ = π/4: r = r′ = √2, dx/dθ = 1 − 1 = 0, dy/dθ = 2 → VERTICAL tangent at
  //   (r cos θ, r sin θ) = (1, 1), the circle's rightmost point: x = 1.
  // θ = π/6: r = 1, r′ = √3, dx/dθ = 3/2 − 1/2 = 1, dy/dθ = √3/2 + √3/2 = √3,
  //   so dy/dx = √3 at (√3/2, 1/2).
  const SRC = 'r = 2sin(theta)'
  it('at π/4: dy/dx undefined, the tangent x = 1, r increasing away from the pole', () => {
    const { c, models, s } = sym(SRC)
    expect(formulaOf('polar', s!.slope).text).toBe('(2cos(θ)·sin(θ))/(cos(θ)² − sin(θ)²)')
    const at = atParam(c, models, s, PI / 4)!
    expect(at.point.text).toBe('(1, 1)')
    expect(at.vertical).toBe(true)
    expect(at.slope).toBeNull()
    expect(at.dx.text).toBe('0')
    expect(at.dy.text).toBe('2')
    expect(at.tangent!.text).toBe('x = 1')
    expect(at.drawSlope).toBe(Infinity)
    expect(at.r!.text).toBe('√2')
    expect(at.dr!.text).toBe('√2')
    expect(at.drSentence).toContain('moving away from the pole')
    expect(at.notes[0]).toContain('tangent line is vertical')
  })

  it('at π/6: dy/dx = √3', () => {
    const { c, models, s } = sym(SRC)
    const at = atParam(c, models, s, PI / 6)!
    expect(at.slope!.text).toBe('√3')
    expect(at.point.text).toBe('(√3/2, 0.5)') // a point prefers a short decimal
  })

  it('what r′ says, every case', () => {
    expect(drSentence(0, 1)).toContain('at the pole')
    expect(drSentence(1, 0)).toContain('neither toward nor away')
    expect(drSentence(-1, 1)).toContain('|r| is decreasing, so the point is moving toward the pole')
    expect(drSentence(-1, -1)).toContain('|r| is increasing, so the point is moving away from the pole')
  })
})

describe('inside r = 3 sin θ, outside r = 1 + sin θ', () => {
  const outer = typed('r = 3sin(theta)', 'f')
  const inner = typed('r = 1 + sin(theta)', 'g')
  const models = { ...outer.models, ...inner.models }
  const sO = paramSymbolic('r = 3sin(theta)', outer.c, models)
  const sI = paramSymbolic('r = 1 + sin(theta)', inner.c, models)

  it('they meet at θ = π/6 and 5π/6', () => {
    expect(polarIntersections(outer.c, inner.c, models).map((m) => m.text)).toEqual(['π/6', '5π/6'])
    const b = defaultBetweenBounds(outer.c, inner.c, models)!
    expect(b[0]).toBeCloseTo(PI / 6, 12)
    expect(b[1]).toBeCloseTo((5 * PI) / 6, 12)
  })

  it('½∫(9 sin²θ − (1 + sin θ)²) dθ from π/6 to 5π/6 = π', () => {
    // by hand: 8sin²θ − 2sin θ − 1 → 4(2π/3) + 2√3 − 2√3 − 2π/3 = 2π; half is π
    const r = polarBetween(outer.c, inner.c, models, sO, sI, PI / 6, (5 * PI) / 6)!
    expect(r.area.text).toBe('π')
    expect(r.area.exact).toBe(true)
    expect(r.integral.text).toBe('A = ½∫ from π/6 to 5π/6 of ((3sin(θ))² − (1 + sin(θ))²) dθ = π ≈ 3.142')
    expect(r.notes).toEqual([])
  })

  it('opened from either card, the region is inside 3 sin θ (1 + sin θ reaches the pole at 3π/2)', () => {
    expect(orientBetween(outer.c, inner.c, models)).toEqual({ swap: false })
    expect(orientBetween(inner.c, outer.c, models)).toEqual({ swap: true })
    expect(defaultBetweenBounds(inner.c, outer.c, models)).toBeNull()
  })

  it('the shaded polygon runs out along 3 sin θ and back along 1 + sin θ', () => {
    const poly = betweenRegion(outer.c, inner.c, models, PI / 6, (5 * PI) / 6, 60)
    expect(poly.length).toBe(122)
    expect(poly[30].y).toBeCloseTo(3, 9) // θ = π/2 on the outer circle
    expect(poly[91].y).toBeCloseTo(2, 9) // θ = π/2 on the inner curve
  })
})

describe('the symbolic trees are checked against the curve', () => {
  it('a line that is not the curve (a named call read as a product) gives no formula', () => {
    const { c, models } = typed('x = 2t, y = t')
    expect(paramSymbolic('x = t, y = t', c, models)).toBeNull()
    expect(paramSymbolic('x = 2t, y = t', c, models)).not.toBeNull()
    expect(paramSymbolic(null, c, models)).toBeNull()
  })

  it('sliders are values, and print as letters', () => {
    const { c, models } = typed('x = a cos(t), y = b sin(t)')
    const s = paramSymbolic('x = a cos(t), y = b sin(t)', c, models)!
    expect(formulaOf('parametric', s.slope).text).toContain('b')
    const at = atParam(c, models, s, PI / 2)!
    expect(at.slope!.value).toBeCloseTo(0, 12)
  })
})

// ===========================================================================
// The links
// ===========================================================================

const META: DocMeta = { id: 'doc1', name: 'Unit 9', createdAt: 1000, modifiedAt: 1000 }

function board(over: Partial<BoardInput> = {}): BoardInput {
  return {
    curves: [],
    styles: {},
    candidates: new Map(),
    exprSources: {},
    viewport: { center: { x: 0, y: 0 }, pxPerUnit: 60 },
    selectedId: null,
    mode: 'draw',
    ...over,
  }
}

const PC: ParamCalcLink = { kind: 'pcalc', id: 'P', parentId: 'f', t: 1 }
const PB: PolarBetweenLink = { kind: 'polarbetween', id: 'B', parentId: 'f', otherId: 'g' }

describe('the links in a file', () => {
  it('write t always, marks only when on, a and b only as a pair', () => {
    expect(calcLinkToStored(PC)).toEqual({ kind: 'pcalc', id: 'P', parentId: 'f', t: 1 })
    expect(calcLinkToStored({ ...PC, marks: true, a: 2, b: 0 })).toEqual({
      kind: 'pcalc', id: 'P', parentId: 'f', t: 1, marks: true, a: 0, b: 2,
    })
    expect(Object.keys(calcLinkToStored({ ...PC, a: 1 } as ParamCalcLink))).toEqual(['kind', 'id', 'parentId', 't'])
    expect(calcLinkToStored(PB)).toEqual({ kind: 'polarbetween', id: 'B', parentId: 'f', otherId: 'g' })
    expect(calcLinkToStored({ ...PB, swap: true, a: 1, b: 2 })).toEqual({ ...PB, swap: true, a: 1, b: 2 })
  })

  it('read back what they wrote; junk switches are off; missing essentials refuse', () => {
    expect(storedToCalcLink({ kind: 'pcalc', id: 'P', parentId: 'f', t: 1, marks: 'yes', a: 1 })).toEqual(PC)
    expect(storedToCalcLink({ kind: 'pcalc', id: 'P', parentId: 'f' })).toBeNull()
    expect(storedToCalcLink({ kind: 'pcalc', id: 'P', parentId: 'f', t: 'pi' })).toBeNull()
    expect(storedToCalcLink({ ...PB, swap: 1 })).toEqual(PB)
    expect(storedToCalcLink({ kind: 'polarbetween', id: 'B', parentId: 'f' })).toBeNull()
    expect(storedToCalcLink({ kind: 'polarbetween', id: 'B', parentId: 'f', otherId: 'f' })).toBeNull()
  })

  it('round-trip through a whole document', () => {
    const f = typed('r = 3sin(theta)', 'f').c
    const g = typed('r = 1 + sin(theta)', 'g').c
    const links: CalcLink[] = [
      { ...PC, t: PI / 4, marks: true, a: 0, b: PI },
      { ...PB, swap: true, a: PI / 6, b: (5 * PI) / 6 },
    ]
    const input = board({
      curves: [f, g],
      calc: links,
      exprSources: { f: 'r = 3sin(theta)', g: 'r = 1 + sin(theta)' },
    })
    const res = deserializeDoc(serializeDoc(docFromBoard(META, input, 2000)))
    expect(res.board!.calc).toEqual(links)
    expect(res.degraded).toBe(false)
  })

  it('leaves a document written before Unit 9 byte-identical', () => {
    const f = typed('x = t^2, y = t^3', 'f').c
    const old = board({
      curves: [f],
      exprSources: { f: 'x = t^2, y = t^3' },
      calc: [],
    })
    const text = serializeDoc(docFromBoard(META, old, 2000))
    expect(text).not.toContain('pcalc')
    expect(text).not.toContain('polarbetween')
    expect(text).not.toContain('"swap"')
    const round = serializeDoc(docFromBoard(META, deserializeDoc(text).board as never, 2000))
    expect(round).toBe(text)
  })

  it('a lost second curve drops the area between, and says so', () => {
    const f = typed('r = 3sin(theta)', 'f').c
    const stored = boardToStored(board({ curves: [f], exprSources: { f: 'r = 3sin(theta)' }, calc: [PB, PC] }))
    const raw = { version: 2, id: 'd', name: 'n', createdAt: 1, modifiedAt: 1, board: { ...stored } }
    const res = deserializeDoc(JSON.stringify(raw))
    expect(res.board!.calc).toEqual([PC])
    expect(res.degraded).toBe(true)
    expect(res.problems.join(' ')).toContain('area between polar curves')
    expect(calcNoun('pcalc')).toBe('parametric / polar calculus point')
  })
})

describe('the links on the board', () => {
  it('die with either curve', () => {
    expect([...dependentsOf([PB, PC], ['g']).linkIds]).toEqual(['B'])
    expect([...dependentsOf([PB, PC], ['f']).linkIds].sort()).toEqual(['B', 'P'])
    expect(linkNoun('polarbetween')).toBe('area between polar curves')
  })

  it('changes: t, marks, the arc interval, the bounds, swap, the other curve', () => {
    expect(applyParamCalcChange(PC, { kind: 'pcalcT', linkId: 'P', t: 2 })).toEqual({ ...PC, t: 2 })
    expect(applyParamCalcChange(PC, { kind: 'pcalcT', linkId: 'P', t: 1 })).toBeNull()
    expect(applyParamCalcChange(PC, { kind: 'pcalcMarks', linkId: 'P', on: true })).toEqual({ ...PC, marks: true })
    expect(applyParamCalcChange({ ...PC, marks: true }, { kind: 'pcalcMarks', linkId: 'P', on: false })).toEqual(PC)
    expect(applyParamCalcChange(PC, { kind: 'pcalcArc', linkId: 'P', a: 3, b: 1 })).toEqual({ ...PC, a: 1, b: 3 })
    expect(applyParamCalcChange({ ...PC, a: 1, b: 3 }, { kind: 'pcalcArc', linkId: 'P', a: null, b: null })).toEqual(PC)
    expect(applyParamCalcChange(PB, { kind: 'pbetweenBounds', linkId: 'B', a: 1, b: 2 })).toEqual({ ...PB, a: 1, b: 2 })
    expect(applyParamCalcChange({ ...PB, a: 1, b: 2 }, { kind: 'pbetweenSwap', linkId: 'B', on: true })).toEqual({ ...PB, swap: true })
    expect(applyParamCalcChange(PB, { kind: 'pbetweenOther', linkId: 'B', otherId: 'h', swap: true })).toEqual({
      ...PB, otherId: 'h', swap: true,
    })
    expect(applyParamCalcChange(PB, { kind: 'pbetweenOther', linkId: 'B', otherId: 'f', swap: false })).toBeNull()
    expect(changeLabel({ kind: 'pcalcT', linkId: 'P', t: 2 })).toBe('move the point on the curve')
  })

  it('a fresh one opens at a nice t; a drag snaps to it', () => {
    const p = typed('x = t^2, y = t^3', 'f')
    expect(defaultParamT(p.c, p.models)).toBe(1)
    const cyc = typed('x = t - sin(t), y = 1 - cos(t) {0 <= t <= 2pi}', 'f')
    expect(defaultParamT(cyc.c, cyc.models)).toBeCloseTo(PI / 2, 12)
    const card = typed('r = 1 + cos(theta)', 'f')
    expect(defaultParamT(card.c, card.models)).toBeCloseTo(PI / 4, 12)
    expect(snapParamT(0.79, card.c, card.models, 60, true)).toBeCloseTo(PI / 4, 12)
    expect(snapParamT(1.02, p.c, p.models, 60, false)).toBe(1)
    expect(snapParamT(1.37, p.c, p.models, 60, false)).toBeCloseTo(1.37, 12)
  })

  it('the card: written lines, the point, the tangents and the arc', () => {
    const { c, models } = typed('x = t^2, y = t^3', 'f')
    const row = paramCalcRow(PC, c, models, 'x = t^2, y = t^3')
    expect(row.symbolic).toBe(true)
    expect(row.lines).toHaveLength(4)
    expect(row.at!.tangent!.text).toBe('y − 1 = 3/2 (x − 1)')
    expect(row.summary).toBe('at t = 1: dy/dx = 3/2')
    expect(row.tangents.singular).toHaveLength(1)
    expect(row.arc!.custom).toBe(false)
    expect(row.arc!.aVal.text).toBe('−10')
    const off = paramCalcRow({ ...PC, t: 99 }, { ...c, domain: [0, 2] }, models, 'x = t^2, y = t^3')
    expect(off.arc!.bVal.text).toBe('2')
    const gone = paramCalcRow(PC, undefined, models, null)
    expect(gone.problem).toContain('gone')
  })

  it('cardCalc offers Unit 9 on a parametric / polar curve and lists the rows', () => {
    const f = typed('r = 3sin(theta)', 'f')
    const g = typed('r = 1 + sin(theta)', 'g')
    const models = { ...f.models, ...g.models }
    const cards = cardCalc(
      [PB, { ...PC, t: PI / 6 }],
      [f.c, g.c],
      models,
      (c) => c.id,
      { f: 'f', g: 'g' },
      {},
      { f: 'r = 3sin(theta)', g: 'r = 1 + sin(theta)' },
    )
    expect(cards.f.canAdd).toBe(true)
    expect(cards.f.motion).toBe('polar')
    expect(cards.f.polarPartner).toBe(true)
    expect(cards.f.order).toEqual(['B', 'P'])
    expect(cards.f.pbetweens![0].result!.area.text).toBe('π')
    expect(cards.f.pbetweens![0].meetings.map((m) => m.text)).toEqual(['π/6', '5π/6'])
    expect(cards.f.pbetweens![0].outerLabel).toBe('f')
    expect(cards.f.pcalcs![0].at!.slope!.text).toBe('√3')
    // the menu: the Unit 9 group holds both items
    expect(CALC_GROUPS.find((gr) => gr.title === 'Parametric & polar')!.items.map((i) => i.kind)).toEqual([
      'pcalc',
      'polarbetween',
    ])
    // the default partner and the row
    expect(defaultPolarBetween(f.c, [f.c, g.c], models)).toEqual({ otherId: 'g', swap: false })
    const row = polarBetweenRow({ ...PB, swap: true }, f.c, g.c, models, [f.c, g.c], (c) => c.id)
    expect(row.outerLabel).toBe('g')
    expect(row.problem === null || row.problem.length > 0).toBe(true)
  })

  it('draws the tangent, the point, its chip and the polar ray; marks on request; the region', () => {
    const p = typed('x = t^2, y = t^3', 'f')
    const ov = paramCalcOverlays([PC], [p.c], p.models)
    expect(ov.filter((o) => o.kind === 'line')).toHaveLength(1)
    expect(ov.find((o) => o.kind === 'label' && o.text === 't = 1')).toBeTruthy()
    expect(ov.filter((o) => o.kind === 'segment')).toHaveLength(0)
    const marked = paramCalcOverlays([{ ...PC, marks: true }], [p.c], p.models)
    expect(marked.find((o) => o.kind === 'label' && o.text === 'cusp')).toBeTruthy()
    // polar at π/4 on r = 2 sin θ: the vertical tangent is a segment, plus the dashed ray
    const r = typed('r = 2sin(theta)', 'f')
    const pv = paramCalcOverlays([{ ...PC, t: PI / 4 }], [r.c], r.models)
    const segs = pv.filter((o) => o.kind === 'segment')
    expect(segs).toHaveLength(2)
    expect(segs.some((o) => o.kind === 'segment' && o.dashed === true && o.from.x === 0 && o.from.y === 0)).toBe(true)
    expect(segs.some((o) => o.kind === 'segment' && Math.abs(o.from.x - 1) < 1e-9 && Math.abs(o.to.x - 1) < 1e-9)).toBe(true)
    // hidden: nothing
    expect(paramCalcOverlays([PC], [{ ...p.c, visible: false }], p.models)).toEqual([])
    // the region between, through overlaysFor
    const f = typed('r = 3sin(theta)', 'f')
    const g = typed('r = 1 + sin(theta)', 'g')
    const models = { ...f.models, ...g.models }
    const all = overlaysFor([PB], [f.c, g.c], models)
    expect(all[0].kind).toBe('region')
    expect(all.filter((o) => o.kind === 'label').map((o) => (o.kind === 'label' ? o.text : ''))).toEqual([
      'θ = π/6',
      'θ = 5π/6',
    ])
    expect(polarBetweenOverlays([PB], [f.c, { ...g.c, visible: false }], models)).toEqual([])
  })
})

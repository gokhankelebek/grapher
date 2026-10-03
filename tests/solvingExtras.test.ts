// ============================================================================
// tests/solvingExtras.test.ts — the solving extras:
//   complex zeros (src/core/complexZeros.ts, N-CN.9 / A-REI.4b),
//   the algebraic route and extraneous solutions (src/core/equationRoute.ts,
//   A-REI.2), exact logarithms for exponential equations
//   (src/core/expSolve.ts, F-LE.4), curves that coincide
//   (src/core/analyze.ts pairMeeting), and the fitted export frame that now
//   includes a triangle's centres and a circle's theorems.
// ============================================================================

import { describe, expect, it } from 'vitest'
import { complexZeros, curveComplexZeros, zeroLine } from '../src/core/complexZeros'
import type { ComplexZeros } from '../src/core/complexZeros'
import { toNum } from '../src/core/valueTable'
import { equationRoute } from '../src/core/equationRoute'
import { expShapeOf, solveExpEquation } from '../src/core/expSolve'
import { parseAst, parseExpression } from '../src/core/parse'
import { analyzeCurve, curveCoincidence, pairMeeting } from '../src/core/analyze'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { solveInequality } from '../src/core/solveInequality'
import { graphNote, graphSources, routeOf, solveCached, workingText } from '../src/ui/nlSolve'
import { boardMeetings, cardIntersections, coincideText } from '../src/ui/intersections'
import { complexKeysOf, complexSummary, complexZerosOf } from '../src/ui/complexLinks'
import { buildInventory, coincideKey, complexKey } from '../src/ui/reveal'
import { overlaysBox, shapesBox } from '../src/ui/exportFit'
import { centreOverlays } from '../src/ui/centreLinks'
import { compileShapes, sceneShapes } from '../src/ui/shapeLinks'
import { buildExample, exampleById } from '../src/examples'
import { deserializeDoc, docFromBoard, serializeDoc } from '../src/core/persist'
import { docFigure, docModelFromJSON } from '../src/ui/docScene'
import { describeBoard } from '../src/ui/boardDescription'
import { MODELS } from '../src/core/fit/models'
import { COMMAND_BY_ID, HELP_SECTIONS } from '../src/ui/commands'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RevealContext, REVEAL_API_OFF } from '../src/ui/RevealAnswer'
import { ComplexZerosSection } from '../src/ui/ComplexZerosSection'
import { SolveCard } from '../src/ui/SolveCard'

const MINUS = '−'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const models: Record<string, ModelSpec> = {}
let serial = 0
function typed(src: string): FittedCurve {
  const r = parseExpression(src)
  if (!r.ok) throw new Error(`${src}: ${r.error}`)
  const id = `se${++serial}`
  models[id] = r.plot.makeModel(id)
  return {
    id: `c${serial}`,
    modelId: id,
    params: r.plot.defaultParams,
    kind: r.plot.kind,
    domain: r.plot.domain,
    color: '#4f9cf9',
    strokeWidth: 2,
    visible: true,
    error: 0,
  }
}

const zerosOf = (f: (x: number) => number): ComplexZeros => {
  const z = curveComplexZeros(f)
  if (!z) throw new Error('not a polynomial')
  return z
}
const texts = (z: ComplexZeros): string[] => z.zeros.map((e) => e.text)

/** Expand Π (x − zᵢ) over every zero (with multiplicity) back into coefficients, ascending. */
function multiplyBack(z: ComplexZeros): [number, number][] {
  let poly: [number, number][] = [[1, 0]]
  const times = (re: number, im: number): void => {
    const next: [number, number][] = Array.from({ length: poly.length + 1 }, () => [0, 0] as [number, number])
    for (let i = 0; i < poly.length; i++) {
      const [a, b] = poly[i]
      next[i + 1][0] += a
      next[i + 1][1] += b
      // − (re + i·im)(a + i·b)
      next[i][0] -= re * a - im * b
      next[i][1] -= re * b + im * a
    }
    poly = next
  }
  for (const e of z.zeros) {
    for (let m = 0; m < e.mult; m++) {
      if (e.kind === 'real') times(e.re, 0)
      else if (e.kind === 'real-pair') {
        times(e.re + e.im, 0)
        times(e.re - e.im, 0)
      } else {
        times(e.re, e.im)
        times(e.re, -e.im)
      }
    }
  }
  return poly
}

function sides(src: string): [ReturnType<typeof parseAst>, ReturnType<typeof parseAst>] {
  const [l, r] = src.split('=')
  return [parseAst(l), parseAst(r)]
}
function route(src: string) {
  const [L, R] = sides(src)
  if (!L.ok || !R.ok) throw new Error(src)
  return equationRoute(L.lhs, R.lhs, 'x')
}
function expSolve(src: string, v = 'x') {
  const [L, R] = sides(src)
  if (!L.ok || !R.ok) throw new Error(src)
  const isVar = (n: { t: string; name?: string }) => (n.t === 'var' || n.t === 'param') && n.name === v
  const f = expShapeOf(L.lhs, isVar as never)
  const g = expShapeOf(R.lhs, isVar as never)
  return f && g ? solveExpEquation(f, g, v) : null
}

const load = (id: string) => {
  const def = exampleById(id)
  if (!def) throw new Error(id)
  const built = buildExample(def)
  const res = deserializeDoc(built.json)
  if (!res.board) throw new Error(id)
  return { built, board: res.board }
}

// ---------------------------------------------------------------------------
// 1. Complex zeros
// ---------------------------------------------------------------------------

describe('Zeros over ℂ: quadratics, exactly, as a ± bi', () => {
  it('x² − 4x + 13 → 2 ± 3i, with the discriminant −36 and its verdict', () => {
    const z = zerosOf((x) => x * x - 4 * x + 13)
    expect(texts(z)).toEqual(['2 ± 3i'])
    expect(z.zeros[0]).toMatchObject({ kind: 'complex-pair', re: 2, im: 3, exact: true, count: 2 })
    expect(z.discriminant).toMatchObject({ value: -36, verdict: 'two-non-real' })
    expect(z.discriminant!.text).toBe(`b² − 4ac = (${MINUS}4)² − 4(1)(13) = ${MINUS}36`)
    expect([z.degree, z.real, z.nonReal, z.pairs]).toEqual([2, 0, 2, 1])
  })

  it('x² + 2x + 4 → −1 ± i√3 (b in simplest radical form)', () => {
    expect(texts(zerosOf((x) => x * x + 2 * x + 4))).toEqual([`${MINUS}1 ± i√3`])
  })

  it('more forms: ±3i, ±(√3/2)i, −3/4 ± (√31/4)i, ±(1/2)i', () => {
    expect(texts(zerosOf((x) => x * x + 9))).toEqual(['±3i'])
    expect(texts(zerosOf((x) => 4 * x * x + 3))).toEqual(['±(√3/2)i'])
    expect(texts(zerosOf((x) => 2 * x * x + 3 * x + 5))).toEqual([`${MINUS}3/4 ± (√31/4)i`])
    expect(texts(zerosOf((x) => x * x + 0.25))).toEqual(['±(1/2)i'])
  })

  it('the discriminant verdict: two real, one repeated real, two non-real', () => {
    expect(zerosOf((x) => x * x - 2 * x - 1).discriminant!.verdict).toBe('two-real')
    expect(texts(zerosOf((x) => x * x - 2 * x - 1))).toEqual(['1 ± √2'])
    expect(texts(zerosOf((x) => x * x - x - 1))).toEqual(['(1 ± √5)/2'])
    const sq = zerosOf((x) => x * x - 6 * x + 9)
    expect(sq.discriminant!.verdict).toBe('one-repeated')
    expect(sq.zeros).toEqual([expect.objectContaining({ text: '3', mult: 2, kind: 'real' })])
    expect(zerosOf((x) => x * x + x + 1).discriminant!.verdict).toBe('two-non-real')
    expect(zerosOf((x) => x * x + x + 1).discriminant!.sentence).toMatch(/^−3 < 0: two non-real zeros/)
  })

  it('decimal coefficients that are rational are exact: 0.5x² + 1.25 → ±(√10/2)i', () => {
    expect(texts(zerosOf((x) => 0.5 * x * x + 1.25))).toEqual(['±(√10/2)i'])
  })
})

describe('Zeros over ℂ: higher degree, by the rational root theorem and synthetic division', () => {
  it('x³ − 1 → 1, −1/2 ± (√3/2)i, with the FTA count', () => {
    const z = zerosOf((x) => x ** 3 - 1)
    expect(texts(z)).toEqual(['1', `${MINUS}1/2 ± (√3/2)i`])
    expect(z.fta).toBe('Degree 3: 3 zeros counted with multiplicity — 1 real, 2 non-real (1 conjugate pair).')
    expect(z.steps.some((s) => /synthetic division by \(x − 1\) leaves x² \+ x \+ 1/.test(s))).toBe(true)
    expect(z.graphNote).toMatch(/2 non-real zeros do not appear on the graph/)
  })

  it('x⁴ − 1 → ±1, ±i and x³ + x → 0, ±i', () => {
    expect(texts(zerosOf((x) => x ** 4 - 1))).toEqual([`${MINUS}1`, '1', '±i'])
    expect(texts(zerosOf((x) => x ** 3 + x))).toEqual(['0', '±i'])
  })

  it('multiplicities: double and triple zeros, and a repeated quadratic factor', () => {
    const a = zerosOf((x) => (x - 1) ** 2 * (x + 2))
    expect(a.zeros.map((e) => [e.text, e.mult])).toEqual([[`${MINUS}2`, 1], ['1', 2]])
    expect(a.zeros.map(zeroLine)).toEqual([`x = ${MINUS}2`, 'x = 1 (double)'])
    const b = zerosOf((x) => (x - 2) ** 3)
    expect(b.zeros.map(zeroLine)).toEqual(['x = 2 (triple)'])
    const c = zerosOf((x) => (x * x + 1) ** 2)
    expect(c.zeros.map(zeroLine)).toEqual(['x = ±i (double)'])
    expect([c.real, c.nonReal, c.pairs]).toEqual([0, 4, 2])
  })

  it('rational quadratic factors found from numeric pairs are exact: x⁴ + 5x² + 6 → ±i√2, ±i√3', () => {
    expect(texts(zerosOf((x) => x ** 4 + 5 * x * x + 6))).toEqual(['±i√2', '±i√3'])
    expect(texts(zerosOf((x) => x ** 4 - 5 * x * x + 6))).toEqual(['±√2', '±√3'])
    expect(texts(zerosOf((x) => x ** 6 - 1))).toEqual([`${MINUS}1`, '1', `${MINUS}1/2 ± (√3/2)i`, '1/2 ± (√3/2)i'])
  })

  it('degree 5 with no rational zeros: numeric (≈, 4 decimals), and they multiply back to the polynomial', () => {
    const z = zerosOf((x) => x ** 5 - x - 1)
    expect(z.exact).toBe(false)
    expect([z.degree, z.real, z.nonReal]).toEqual([5, 1, 4])
    expect(z.zeros.every((e) => !e.exact)).toBe(true)
    expect(z.zeros.map(zeroLine)[0]).toBe('x ≈ 1.1673')
    for (const e of z.zeros) expect(e.text).toMatch(/\d\.\d{4}/)
    const back = multiplyBack(z)
    const want = [-1, -1, 0, 0, 0, 1]
    back.forEach(([re, im], i) => {
      expect(re).toBeCloseTo(want[i], 9)
      expect(im).toBeCloseTo(0, 9)
    })
  })

  it('a degree-5 polynomial with exact zeros multiplies back exactly too', () => {
    // (x − 1)(x + 2)(x² + 2x + 5)·x
    const z = zerosOf((x) => x * (x - 1) * (x + 2) * (x * x + 2 * x + 5))
    expect(texts(z)).toEqual([`${MINUS}2`, '0', '1', `${MINUS}1 ± 2i`])
    const back = multiplyBack(z)
    const want = [0, -10, 1, 5, 3, 1] // x⁵ + 3x⁴ + 5x³ + x² − 10x
    back.forEach(([re], i) => expect(re).toBeCloseTo(want[i], 12))
  })

  it('takes coefficients as valueTable Nums, and refuses degree 0 and degree > 8', () => {
    expect(complexZeros([toNum(1), toNum(0), toNum(4)])!.zeros[0].text).toBe('±2i')
    expect(complexZeros([toNum(5)])).toBeNull()
    expect(curveComplexZeros((x) => x ** 9 + 1)).toBeNull()
    expect(curveComplexZeros((x) => Math.sin(x))).toBeNull()
    expect(curveComplexZeros((x) => 2 * x + 1)).toBeNull()
  })
})

describe('Zeros over ℂ on the card', () => {
  it('a typed polynomial has the section; a restricted or non-polynomial curve does not', () => {
    const z = complexZerosOf(typed('y = x^3 - 1'), models)
    expect(z && texts(z)).toEqual(['1', `${MINUS}1/2 ± (√3/2)i`])
    expect(complexSummary(z!)).toBe('degree 3 = 1 real + 2 non-real')
    expect(complexZerosOf(typed('y = x^2 + 1 {0 <= x <= 2}'), models)).toBeNull()
    expect(complexZerosOf(typed('y = sin(x)'), models)).toBeNull()
    expect(complexZerosOf(typed('y = 2x + 1'), models)).toBeNull()
  })

  it('is one reveal answer, in the curve’s extra keys', () => {
    const c = typed('y = x^2 - 4x + 13')
    expect(complexKeysOf(c, models)).toEqual([complexKey(c.id)])
    const inv = buildInventory({ curves: [{ id: c.id, points: [], extra: complexKeysOf(c, models) }], crossings: [] })
    expect(inv.order).toContain(`curve:${c.id}:complex`)
  })

  it('has a palette command and help entries (m2-quad, m3-poly)', () => {
    expect(COMMAND_BY_ID.get('curve-complex-zeros')?.title).toBe('Zeros over ℂ (complex zeros)')
    const ids = (sec: string) => HELP_SECTIONS.find((h) => h.id === sec)!.entries.map((e) => ('id' in e ? e.id : null))
    expect(ids('m2-quad')).toContain('curve-complex-zeros')
    expect(ids('m3-poly')).toContain('curve-complex-zeros')
  })
})

// ---------------------------------------------------------------------------
// 2. Extraneous solutions
// ---------------------------------------------------------------------------

describe('the algebraic route: radical equations', () => {
  it('√(x + 7) = x − 5: square, candidates 2 and 9, 2 extraneous with the reason', () => {
    const r = route('sqrt(x+7) = x - 5')!
    expect(r.kind).toBe('radical')
    expect(r.steps.map((s) => s.text)).toEqual([
      'Square both sides: x + 7 = (x − 5)²',
      'Expand and collect: x² − 11x + 18 = 0',
      'Candidates: x = 2, x = 9',
    ])
    expect(r.candidates.map((c) => [c.text, c.ok])).toEqual([['2', false], ['9', true]])
    expect(r.candidates[0].reason).toBe(`√(x + 7) = 3 but x − 5 = ${MINUS}3: squaring lost the sign`)
    expect(r.candidates[1].reason).toBe('√(x + 7) = 4 and x − 5 = 4')
    expect(r.summary).toBe('x = 9 is the solution; x = 2 is extraneous.')
  })

  it('√(2x + 3) = x: −1 is extraneous; √x + 2 = x isolates first', () => {
    const r = route('sqrt(2x+3) = x')!
    expect(r.candidates.map((c) => [c.text, c.ok])).toEqual([[`${MINUS}1`, false], ['3', true]])
    const s = route('sqrt(x) + 2 = x')!
    expect(s.steps[0].text).toBe('Isolate the square root: √x = x − 2')
    expect(s.candidates.map((c) => [c.text, c.ok])).toEqual([['1', false], ['4', true]])
  })

  it('a zero of both sides is a solution, not an extraneous root: 2√(x + 1) = x + 1', () => {
    const r = route('2sqrt(x+1) = x + 1')!
    expect(r.candidates.map((c) => [c.text, c.ok])).toEqual([[`${MINUS}1`, true], ['3', true]])
  })

  it('two square roots: square twice; √(x + 5) − √x = 1 gives 4', () => {
    const r = route('sqrt(x+5) - sqrt(x) = 1')!
    expect(r.steps.map((s) => s.text)).toContain('Square again: 4x = 16')
    expect(r.candidates.map((c) => [c.text, c.ok])).toEqual([['4', true]])
    const t = route('sqrt(x) + sqrt(x-5) = 5')!
    expect(t.candidates.map((c) => [c.text, c.ok])).toEqual([['9', true]])
  })

  it('no real candidate: √(x − 3) = −√(x + 1) collapses to 1 = 0', () => {
    const r = route('sqrt(x-3) = -sqrt(x+1)')!
    expect(r.candidates).toEqual([])
    expect(r.summary).toMatch(/no real solutions/)
  })
})

describe('the algebraic route: rational and log equations', () => {
  it('x/(x − 2) = 2/(x − 2) + 5: multiply by the LCD; x = 2 makes a denominator 0', () => {
    const r = route('x/(x-2) = 2/(x-2) + 5')!
    expect(r.kind).toBe('rational')
    expect(r.steps[0].text).toBe('Excluded values (a denominator would be 0): x ≠ 2')
    expect(r.steps[1].text).toBe('Multiply both sides by the LCD, x − 2')
    expect(r.candidates.map((c) => [c.text, c.ok])).toEqual([['2', false]])
    expect(r.candidates[0].reason).toBe('x = 2 makes a denominator 0 (x − 2 = 0)')
    expect(r.summary).toBe('There is no solution; x = 2 is extraneous.')
  })

  it('1/x + 1/(x + 1) = 5/6: LCD x(x + 1), both candidates solutions', () => {
    const r = route('1/x + 1/(x+1) = 5/6')!
    expect(r.steps[1].text).toBe('Multiply both sides by the LCD, x(x + 1)')
    expect(r.candidates.map((c) => [c.text, c.ok])).toEqual([[`${MINUS}3/5`, true], ['2', true]])
  })

  it('an identity: x/(x − 2) = 2/(x − 2) + 1 holds for every x except 2', () => {
    const r = route('x/(x-2) = 2/(x-2) + 1')!
    expect(r.identity).toBe(true)
    expect(r.summary).toBe('The equation holds for every x except the excluded values 2.')
  })

  it('log x + log(x − 3) = 1: combine, x(x − 3) = 10, −2 is the log of a negative', () => {
    const r = route('log(x) + log(x-3) = 1')!
    expect(r.kind).toBe('log')
    expect(r.steps.map((s) => s.text)).toEqual([
      'Each logarithm needs a positive argument: x > 0, x − 3 > 0',
      'Combine the logs: log(x(x − 3)) = 1',
      'Rewrite without logs: x(x − 3) = 10',
      'Expand and collect: x² − 3x − 10 = 0',
      `Candidates: x = ${MINUS}2, x = 5`,
    ])
    expect(r.candidates.map((c) => [c.text, c.ok])).toEqual([[`${MINUS}2`, false], ['5', true]])
    expect(r.candidates[0].reason).toBe(`log(x) would be the log of ${MINUS}2, a negative number`)
  })

  it('ln x + ln(x − 2) = ln 3, log₂ and a quotient of logs', () => {
    expect(route('ln(x) + ln(x-2) = ln(3)')!.candidates.map((c) => [c.text, c.ok])).toEqual([[`${MINUS}1`, false], ['3', true]])
    expect(route('log_2(x) + log_2(x+2) = 3')!.steps[2].text).toBe('Rewrite without logs: x(x + 2) = 2³ = 8')
    expect(route('log(x+3) - log(x) = 1')!.steps[1].text).toBe('Combine the logs: log((x + 3)/x) = 1')
  })

  it('no route where no step adds roots: x² = 4, a polynomial', () => {
    expect(route('x^2 = 4')).toBeNull()
    expect(route('2x + 1 = 7')).toBeNull()
  })
})

describe('the route on the number line card', () => {
  it('routeOf reads a single equation; an inequality or a compound has none', () => {
    const r = solveCached('sqrt(x+7) = x - 5')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.solution.text).toBe('{9}')
    expect(routeOf('sqrt(x+7) = x - 5', r)?.summary).toBe('x = 9 is the solution; x = 2 is extraneous.')
    const ineq = solveCached('sqrt(x+7) > x - 5')
    expect(routeOf('sqrt(x+7) > x - 5', ineq.ok ? ineq : null)).toBeNull()
    expect(routeOf('√(x+7) = x − 5', (solveCached('√(x+7) = x − 5') as never))?.kind).toBe('radical')
  })

  it('“Show on graph” draws both sides of an equation; the note names the extraneous candidate', () => {
    expect(graphSources('sqrt(x+7) = x - 5')).toEqual([
      { src: 'y = sqrt(x+7)', signChart: false },
      { src: 'y = x - 5', signChart: false },
    ])
    expect(graphSources('√(x+7) = x − 5')![0].src).toBe('y = sqrt(x+7)')
    expect(graphNote('sqrt(x+7) = x - 5')).toBe('x = 2 is extraneous — the graphs do not meet there.')
    // an equation with 0 on one side keeps its sign-chart picture
    expect(graphSources('x^2 - 4 = 0')).toEqual([{ src: 'y = x^2 - 4', signChart: true }])
  })

  it('the graphs of both sides meet only at the true solution', () => {
    const a = typed('y = sqrt(x+7)')
    const b = typed('y = x - 5')
    const pts = pairMeeting(a, b, models, [-10, 20]).points
    expect(pts.map((p) => [p.pos.x, p.pos.y])).toEqual([[9, 4]])
  })

  it('copy as text carries the route', () => {
    const r = solveCached('sqrt(x+7) = x - 5')
    if (!r.ok) throw new Error()
    const t = workingText('sqrt(x+7) = x - 5', r)
    expect(t).toContain('Algebraic route — Square both sides:')
    expect(t).toContain(`✗ x = 2 (extraneous): √(x + 7) = 3 but x − 5 = ${MINUS}3: squaring lost the sign`)
  })
})

// ---------------------------------------------------------------------------
// 3. Exact logarithms
// ---------------------------------------------------------------------------

describe('exponential equations solved exactly with logarithms', () => {
  it('3·2ˣ = 7 → log₂(7/3) = ln(7/3)/ln 2 ≈ 1.2224', () => {
    const s = expSolve('3*2^x = 7')!
    expect(s.kind).toBe('one')
    if (s.kind !== 'one') return
    expect(s.forms.map((f) => f.text)).toEqual(['log₂(7/3)', 'ln(7/3)/ln 2'])
    expect(s.x).toBeCloseTo(Math.log(7 / 3) / Math.log(2), 14)
    expect(s.x.toFixed(4)).toBe('1.2224')
    expect(s.steps.map((f) => f.text)).toEqual(['2ˣ = 7/3', 'x = log₂(7/3)'])
  })

  it('5e^(0.2t) = 20 → t = 5 ln 4 = 10 ln 2 ≈ 6.9315', () => {
    const s = expSolve('5e^(0.2t) = 20', 't')!
    if (s.kind !== 'one') throw new Error()
    expect(s.forms.map((f) => f.text)).toEqual(['5 ln 4', '10 ln 2'])
    expect(s.x.toFixed(4)).toBe('6.9315')
    expect(s.steps.map((f) => f.text)).toEqual(['e^(0.2t) = 4', '0.2t = ln 4', 't = 5 ln 4'])
  })

  it('2ˣ = 3^(x − 1) → x = ln 3/(ln 3 − ln 2)', () => {
    const s = expSolve('2^x = 3^(x-1)')!
    if (s.kind !== 'one') throw new Error()
    expect(s.forms[0].text).toBe('ln 3/(ln 3 − ln 2)')
    expect(s.forms[0].tex).toBe('\\frac{\\ln 3}{\\ln 3 - \\ln 2}')
    expect(s.x).toBeCloseTo(Math.log(3) / (Math.log(3) - Math.log(2)), 14)
  })

  it('rational answers stay rational; no solution when the power would be negative', () => {
    expect(expSolve('2^x = 8')).toMatchObject({ kind: 'one', x: 3, rational: true })
    expect(expSolve('4^x = 8')).toMatchObject({ kind: 'one', x: 1.5 })
    expect(expSolve('(1/2)^x = 8')).toMatchObject({ kind: 'one', x: -3 })
    expect(expSolve('2^x = -3')).toMatchObject({ kind: 'none' })
  })

  it('more shapes: shifts, coefficients in the exponent, growth factors as typed', () => {
    const f = (src: string, v = 'x') => {
      const s = expSolve(src, v)
      return s && s.kind === 'one' ? s.forms.map((t) => t.text) : null
    }
    expect(f('e^(2x+1) = 5')).toEqual(['(ln 5 − 1)/2'])
    expect(f('2^(x-1) = 5')).toEqual(['log₂ 5 + 1', 'ln 5/ln 2 + 1'])
    expect(f('3^(2x) = 10')).toEqual(['(1/2) log₃ 10', 'ln 10/(2 ln 3)'])
    expect(f('100(1.05)^t = 200', 't')).toEqual(['log_1.05 2', 'ln 2/ln 1.05'])
  })

  it('never fakes one: sums of different powers, x outside the power, π or √2 as a number', () => {
    expect(expSolve('2^x + 3^x = 10')).toBeNull()
    expect(expSolve('x*2^x = 5')).toBeNull()
    expect(expSolve('2^x = x + 3')).toBeNull()
    expect(expSolve('pi*2^x = 5')).toBeNull()
    expect(expSolve('2^x = sqrt(2)')).toBeNull()
    expect(expSolve('2^x + 1 = 3^x')).toBeNull()
  })

  it('the number-line solver writes the zero as the logarithm (and inequalities too)', () => {
    const r = solveInequality('3*2^x = 7')
    if (!r.ok) throw new Error()
    expect(r.solution.text).toBe('{log₂(7/3)}')
    expect(r.clauses[0].exp?.forms.map((f) => f.text)).toEqual(['log₂(7/3)', 'ln(7/3)/ln 2'])
    const q = solveInequality('5e^(0.2x) > 20')
    if (!q.ok) throw new Error()
    expect(q.solution.text).toBe('(5 ln 4, ∞)')
    const route2 = routeOf('3*2^x = 7', r)
    expect(route2?.kind).toBe('exp')
    expect(route2?.summary).toBe('x = log₂(7/3) = ln(7/3)/ln 2 ≈ 1.2224')
  })

  it('on the graph: zeros and intersections carry the log form and its equal', () => {
    const z = analyzeCurve(typed('y = 3*2^x - 7'), models).filter((p) => p.kind === 'zero')
    expect(z.map((p) => [p.exactX, p.exactAlt])).toEqual([['log₂(7/3)', 'ln(7/3)/ln 2']])
    const meet = pairMeeting(typed('y = 3*2^x'), typed('y = 7'), models, [-10, 10]).points
    expect(meet.map((p) => [p.exactX, p.exactY, p.exactAlt])).toEqual([['log₂(7/3)', '7', 'ln(7/3)/ln 2']])
    const two = pairMeeting(typed('y = 2^x'), typed('y = 3^(x-1)'), models, [-16, 16]).points
    expect(two).toHaveLength(1)
    expect(two[0].exactX).toBe('ln 3/(ln 3 − ln 2)')
    const e = analyzeCurve(typed('y = 5e^(0.2x) - 20'), models).filter((p) => p.kind === 'zero')
    expect(e.map((p) => [p.exactX, p.exactAlt])).toEqual([['5 ln 4', '10 ln 2']])
  })

  it('no form where the structure is not one: 2ˣ + x − 3, a sketched exponential', () => {
    const z = analyzeCurve(typed('y = 2^x + x - 3'), models).filter((p) => p.kind === 'zero')
    expect(z).toHaveLength(1)
    expect(z[0].exactAlt).toBeUndefined()
    expect(z[0].exactX ?? '').not.toMatch(/ln|log/)
    const sketched = Object.values(MODELS).find((m) => m.kind === 'explicit' && /exp/i.test(m.id))
    expect(sketched?.expShape).toBeUndefined()
    // a slider dragged off a short decimal is not an exact number
    const c = typed('y = a*2^x - 7')
    expect(models[c.modelId].expShape!([3])).not.toBeNull()
    expect(models[c.modelId].expShape!([3.0000001234567])).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 4. Curves that coincide
// ---------------------------------------------------------------------------

describe('identical curves: the same function, not dozens of crossings', () => {
  it('three forms of one quadratic coincide everywhere, decided exactly; no crossing points', () => {
    const f = typed('y = x^2 - 2x - 8')
    const g = typed('y = (x+2)(x-4)')
    const h = typed('y = (x-1)^2 - 9')
    for (const [a, b] of [[f, g], [f, h], [g, h]]) {
      const m = pairMeeting(a, b, models, [-20, 20])
      expect(m.points).toEqual([])
      expect(m.coincide).toEqual({ everywhere: true, intervals: [], exact: true })
    }
    const all = boardMeetings([f, g, h], models, [-20, 20])
    expect(all.points).toEqual([])
    expect(all.coincide).toHaveLength(3)
    const card = cardIntersections(f.id, all.points, (id) => (id === g.id ? 'g' : 'h'), [f.id, g.id, h.id], all.coincide)
    expect(card.map((c) => [c.name, c.points.length, c.coincide?.text])).toEqual([
      ['g', 0, 'the same function — they coincide everywhere'],
      ['h', 0, 'the same function — they coincide everywhere'],
    ])
  })

  it('x² and x² + 10⁻⁹ are DIFFERENT polynomials (decided exactly): no coincidence and no crossing', () => {
    const m = pairMeeting(typed('y = x^2'), typed('y = x^2 + 0.000000001'), models, [-10, 10])
    expect(m.coincide).toBeNull()
    expect(m.points).toEqual([])
  })

  it('non-polynomial identities are sampled: sin²x + cos²x = 1, 2 sin x cos x = sin 2x, √(x²) = |x|', () => {
    expect(curveCoincidence(typed('y = sin(x)^2 + cos(x)^2'), typed('y = 1'), models, [-10, 10])?.everywhere).toBe(true)
    expect(curveCoincidence(typed('y = 2sin(x)cos(x)'), typed('y = sin(2x)'), models, [-10, 10])?.everywhere).toBe(true)
    expect(curveCoincidence(typed('y = sqrt(x^2)'), typed('y = abs(x)'), models, [-10, 10])?.everywhere).toBe(true)
    expect(curveCoincidence(typed('y = 2^x'), typed('y = 3^(x-1)'), models, [-16, 16])).toBeNull()
  })

  it('a piecewise curve sharing a piece: the overlap interval, and the crossing outside it', () => {
    const p = typed('y = {x^2 if x < 0; x if x >= 0}')
    const q = typed('y = x^2')
    const m = pairMeeting(p, q, models, [-10, 10])
    expect(m.coincide).toMatchObject({ everywhere: false, exact: false })
    expect(m.coincide!.intervals).toEqual([{ lo: -Infinity, hi: 0, hiExact: '0' }])
    expect(coincideText(m.coincide!)).toBe('they coincide for x ≤ 0')
    expect(m.points.map((pt) => [pt.pos.x, pt.pos.y])).toEqual([[1, 1]])
    const abs = pairMeeting(typed('y = abs(x)'), typed('y = x'), models, [-10, 10])
    expect(coincideText(abs.coincide!)).toBe('they coincide for x ≥ 0')
    expect(abs.points).toEqual([])
  })

  it('a duplicated sketched curve coincides with its copy', () => {
    const a: FittedCurve = { id: 's1', modelId: 'poly2', params: [1.2345, -0.3, 2.1], kind: 'explicit', domain: null, color: '#f00', strokeWidth: 2, visible: true, error: 0 }
    const b: FittedCurve = { ...a, id: 's2' }
    const m = pairMeeting(a, b, MODELS, [-10, 10])
    expect(m.points).toEqual([])
    expect(m.coincide?.everywhere).toBe(true)
  })

  it('is one reveal answer per pair', () => {
    const inv = buildInventory({ curves: [], crossings: [], coincide: [['b', 'a']] })
    expect(inv.order).toEqual([coincideKey('a', 'b')])
    expect(coincideKey('b', 'a')).toBe('cross:a:b:same')
  })

  it('the gallery’s three forms are all drawn now, and the description says they are one function', () => {
    const { board, built } = load('m2-quadratic-forms')
    expect(board.curves.every((c) => c.visible)).toBe(true)
    const m = docModelFromJSON(built.json)!
    expect(describeBoard(m, { answers: true }).long).toMatch(/are the same function/)
    expect(describeBoard(m, { answers: false }).long).not.toMatch(/same function/)
  })
})

// ---------------------------------------------------------------------------
// 5. The fitted export frame includes the geometry
// ---------------------------------------------------------------------------

describe('fit-to-content export bounds include a triangle’s centres', () => {
  it('the circumcircle of the obtuse triangle reaches past the triangle and into the box', () => {
    const { board } = load('m2-triangle-centres')
    const compiled = compileShapes(board.shapes)
    const tri = shapesBox(sceneShapes(board.shapes, compiled))!
    expect(tri).toEqual({ min: { x: -2, y: 0 }, max: { x: 6, y: 2 } })
    const marks = overlaysBox(centreOverlays(board.shapes, compiled))!
    // O = (2, −2), R = 2√5
    const R = 2 * Math.sqrt(5)
    expect(marks.min.x).toBeCloseTo(2 - R, 2)
    expect(marks.max.x).toBeCloseTo(2 + R, 2)
    expect(marks.min.y).toBeCloseTo(-2 - R, 2)
    expect(marks.max.y).toBeGreaterThanOrEqual(6) // H = (0, 6)
  })

  it('a fitted export of the document frames the whole circumcircle', () => {
    const { built } = load('m2-triangle-centres')
    const m = docModelFromJSON(built.json)!
    const fig = docFigure({ ...m, settings: { ...m.settings, fit: true } }, { style: 'screen', answers: true, caption: '' })
    const vp = fig.scene.vp
    const halfW = vp.widthPx / 2 / vp.pxPerUnit
    const halfH = vp.heightPx / 2 / (vp.pxPerUnitY ?? vp.pxPerUnit)
    const R = 2 * Math.sqrt(5)
    expect(vp.center.x - halfW).toBeLessThanOrEqual(2 - R)
    expect(vp.center.x + halfW).toBeGreaterThanOrEqual(2 + R)
    expect(vp.center.y - halfH).toBeLessThanOrEqual(-2 - R)
    expect(vp.center.y + halfH).toBeGreaterThanOrEqual(6)
  })
})

// ---------------------------------------------------------------------------
// 6. Gallery, persistence, description
// ---------------------------------------------------------------------------

describe('the new gallery examples', () => {
  it('m3-complex-cubic: 1 and 1 ± i, one crossing on the graph', () => {
    const { board } = load('m3-complex-cubic')
    const f = board.curves[0]
    const z = complexZerosOf(f, { ...MODELS, ...board.extraModels })!
    expect(texts(z)).toEqual(['1', '1 ± i'])
    expect(z.discriminant!.value).toBe(-4)
  })

  it('m2-extraneous-radical: the solve item, 9 kept and 2 rejected', () => {
    const { board } = load('m2-extraneous-radical')
    expect(board.items[0]).toMatchObject({ kind: 'solve', src: 'sqrt(x + 7) = x - 5' })
    const r = solveCached('sqrt(x + 7) = x - 5')
    if (!r.ok) throw new Error()
    expect(routeOf('sqrt(x + 7) = x - 5', r)!.candidates.map((c) => [c.text, c.ok])).toEqual([['2', false], ['9', true]])
  })

  it('m3-exp-equation: f and g meet at log₂(7/3) = ln(7/3)/ln 2', () => {
    const { board } = load('m3-exp-equation')
    const all = boardMeetings(board.curves, { ...MODELS, ...board.extraModels }, [-8, 8])
    expect(all.points.map((p) => [p.point.exactX, p.point.exactAlt])).toEqual([['log₂(7/3)', 'ln(7/3)/ln 2']])
  })

  it('old documents load and save byte for byte: nothing computed is stored', () => {
    for (const id of ['m2-quadratic-forms', 'm2-extraneous-radical', 'm3-complex-cubic', 'm3-exp-equation', 'm3-rational-inequality']) {
      const { built } = load(id)
      const res = deserializeDoc(built.json)
      const again = serializeDoc(docFromBoard(res.meta!, res.board!, JSON.parse(built.json).v))
      // the save stamps its own time; every other byte is the document's
      const unstamped = (j: string): string => j.replace(/"modifiedAt":\d+/, '"modifiedAt":0')
      expect(unstamped(again), id).toBe(unstamped(built.json))
      expect(built.json).not.toMatch(/"(complex\w*|exactAlt|coincide\w*|route|candidates)":/)
    }
  })

  it('the description states non-real zeros as answers, and the route on the number line', () => {
    const cubic = docModelFromJSON(load('m3-complex-cubic').built.json)!
    expect(describeBoard(cubic, { answers: true }).long).toMatch(/Over the complex numbers f has 3 zeros counted with multiplicity, 1 real and 2 non-real: x = 1; x = 1 ± i/)
    expect(describeBoard(cubic, { answers: false }).long).not.toMatch(/complex numbers/)
    const nl = docModelFromJSON(load('m2-extraneous-radical').built.json)!
    expect(describeBoard(nl, { answers: true }).long).toMatch(/x = 2 is extraneous/)
    expect(describeBoard(nl, { answers: false }).long).not.toMatch(/extraneous/)
  })
})

// ---------------------------------------------------------------------------
// Reveal mode on the cards
// ---------------------------------------------------------------------------

describe('reveal mode hides the new answers', () => {
  const render = (el: ReturnType<typeof createElement>, hidden: boolean): string =>
    renderToStaticMarkup(
      createElement(RevealContext.Provider, { value: { ...REVEAL_API_OFF, on: true, hidden: () => hidden } }, el),
    )

  it('Zeros over ℂ: a pill and the generic note while hidden; the count and the zeros once revealed', () => {
    const c = typed('y = x^2 - 4x + 13')
    const z = complexZerosOf(c, models)!
    const el = createElement(ComplexZerosSection, { curveId: c.id, zeros: z })
    const hid = render(el, true)
    expect(hid).toContain('reveal-pill')
    expect(hid).not.toContain('2 non-real')
    expect(hid).not.toContain('b² − 4ac')
    expect(hid).toContain('non-real zeros do not appear on the graph')
    const shown = render(el, false)
    expect(shown).toContain('Degree 2: 2 zeros counted with multiplicity — 0 real, 2 non-real (1 conjugate pair).')
    expect(shown).toContain('b² − 4ac = (−4)² − 4(1)(13) = −36')
  })

  it('the solve card’s route is hidden with the solution', () => {
    const item = { kind: 'solve' as const, id: 'q1', src: 'sqrt(x+7) = x - 5', color: '#4f9cf9' }
    const props = {
      item, style: undefined, selected: false, onSelect() {}, onDelete() {}, onCycleColor() {}, onLabel() {},
      onEquationCommit: () => null, onShow() {}, onShowOnGraph: () => null, onWidth() {}, onStyleEditStart() {}, onStyleEditEnd() {},
    }
    const hid = render(createElement(SolveCard, props), true)
    expect(hid).toContain('Algebraic route')
    expect(hid).not.toContain('squaring lost the sign')
    const shown = render(createElement(SolveCard, props), false)
    expect(shown).toContain('squaring lost the sign')
    expect(shown).toContain('data-ok="no"')
    expect(shown).toContain('x = 9 is the solution; x = 2 is extraneous.')
  })
})

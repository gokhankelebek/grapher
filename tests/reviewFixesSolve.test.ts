// ============================================================================
// tests/reviewFixesSolve.test.ts — regressions for the solving-extras review:
//   1. coincidence: no "they coincide" where the arithmetic merely cannot see a
//      difference (∞ = ∞, 2ˣ vs 2ˣ + 3 past x ≈ 35, far samples)
//   2. Zeros over ℂ: repeated irrational real zeros stay real (exact
//      square-free decomposition)
//   3. holes and gaps in a coincidence ((x² − 1)/(x − 1) vs x + 1, ln(x²) vs
//      2 ln x, √(x² − 4) vs √(x − 2)√(x + 2))
//   4. intersections at a curve's own domain end are kept
//   5. the rational root step never says "none is a zero" untested
//   6. printed working that cannot be misread ((−2)², (1/4)x, log_(1/2), −x ln 2)
//   7. reveal mode: the folded Intersections summary, Show on graph's note,
//      and the extraneous candidate's marks on the graph
//   8. wording: significant figures for a tiny discriminant, −1 before ln,
//      no combining logs that are never both defined
//   9. the m1-inequality-system gallery note
//  10. the number-line solver: eˣ = 2ˣ is {0}, 2ˣ = 2ˣ + 1 has no solution
//  and the two help-sheet standard codes.
// ============================================================================

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { curveComplexZeros, zeroLine } from '../src/core/complexZeros'
import type { ComplexZeros } from '../src/core/complexZeros'
import { equationRoute } from '../src/core/equationRoute'
import { expShapeOf, solveExpEquation } from '../src/core/expSolve'
import { parseAst, parseExpression } from '../src/core/parse'
import { pairMeeting } from '../src/core/analyze'
import type { FittedCurve, ModelSpec, NLItem, SpecialPoint } from '../src/core/types'
import { solveInequality } from '../src/core/solveInequality'
import { coincideText, cardIntersections, boardMeetings } from '../src/ui/intersections'
import { extraneousOverlays, graphNote, graphNoteShown } from '../src/ui/nlSolve'
import { applyReveal, coincideKey, REVEAL_OFF, solveKey } from '../src/ui/reveal'
import type { SceneReveal } from '../src/ui/reveal'
import type { BoardScene } from '../src/ui/renderBoard'
import { exampleById } from '../src/examples'
import { HELP_SECTIONS } from '../src/ui/commands'
import { CurveCard } from '../src/ui/CurveCard'
import { rememberSection } from '../src/ui/CardSection'
import { RevealContext, REVEAL_API_OFF } from '../src/ui/RevealAnswer'

const MINUS = '−'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const models: Record<string, ModelSpec> = {}
let serial = 0
function typed(src: string): FittedCurve {
  const r = parseExpression(src)
  if (!r.ok) throw new Error(`${src}: ${r.error}`)
  const id = `rf${++serial}`
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
const meet = (a: string, b: string, range: [number, number]) => pairMeeting(typed(a), typed(b), models, range)
const xsOf = (pts: readonly SpecialPoint[]): number[] => pts.map((p) => p.pos.x)

const zerosOf = (f: (x: number) => number): ComplexZeros => {
  const z = curveComplexZeros(f)
  if (!z) throw new Error('no zeros')
  return z
}

function route(src: string) {
  const [l, r] = src.split('=')
  const L = parseAst(l)
  const R = parseAst(r)
  if (!L.ok || !R.ok) throw new Error(src)
  return equationRoute(L.lhs, R.lhs, 'x')
}
function expSolve(src: string) {
  const [l, r] = src.split('=')
  const L = parseAst(l)
  const R = parseAst(r)
  if (!L.ok || !R.ok) throw new Error(src)
  const isVar = (n: { t: string; name?: string }) => (n.t === 'var' || n.t === 'param') && n.name === 'x'
  const f = expShapeOf(L.lhs, isVar as never)
  const g = expShapeOf(R.lhs, isVar as never)
  return f && g ? solveExpEquation(f, g, 'x') : null
}
const solved = (src: string): string => {
  const r = solveInequality(src)
  if (!r.ok) throw new Error(r.error)
  return r.solution.text
}

// ---------------------------------------------------------------------------
// 1. false coincidences
// ---------------------------------------------------------------------------

describe('1. coincidence is never claimed where the arithmetic cannot see a difference', () => {
  it('a vertical shift of an exponential never coincides with it', () => {
    for (const [a, b] of [
      ['y = 2^x', 'y = 2^x + 3'],
      ['y = e^x', 'y = e^x + 1'],
      ['y = 10^x', 'y = 10^x + 1'],
      ['y = 10^x', 'y = 2*10^x'],
    ]) {
      const m = meet(a, b, [-10, 10])
      expect(m.coincide, `${a} vs ${b}`).toBeNull()
      expect(m.points, `${a} vs ${b}`).toEqual([])
    }
    // both ∞ past 709 is not agreement
    expect(meet('y = e^x', 'y = 2e^x', [-20, 20]).coincide).toBeNull()
  })

  it('10ˣ and 10ˣ + 1 do not "cross" where 1 is below the last bit of 10ˣ', () => {
    const m = meet('y = 10^x', 'y = 10^x + 1', [-20, 20])
    expect(m.coincide).toBeNull()
    expect(m.points).toEqual([])
  })

  it('2ˣ and 3^(x − 1) cross once on any window, and never coincide', () => {
    for (const range of [[-30, 30], [-100, 100], [-60, 10]] as [number, number][]) {
      const m = meet('y = 2^x', 'y = 3^(x-1)', range)
      expect(m.coincide, JSON.stringify(range)).toBeNull()
      // no spurious meeting at the window's left edge
      expect(m.points.every((p) => Math.abs(p.pos.x - 2.7095112913514547) < 1e-6), JSON.stringify(range)).toBe(true)
    }
    expect(xsOf(meet('y = 2^x', 'y = 3^(x-1)', [-30, 30]).points)).toHaveLength(1)
  })

  it('high powers (sampled, not compared by coefficients) are not "the same" far out', () => {
    expect(meet('y = x^10', 'y = x^10 + 1', [-10, 10]).coincide).toBeNull()
    expect(meet('y = x^9', 'y = x^9 + 1', [-10, 10]).coincide).toBeNull()
  })

  it('true identities still coincide, on any window', () => {
    expect(meet('y = sin(x)', 'y = sin(x + 2pi)', [-1000, 1000]).coincide?.everywhere).toBe(true)
    expect(meet('y = cos(x)', 'y = sin(x + pi/2)', [-50, 50]).coincide?.everywhere).toBe(true)
    const e = meet('y = e^(2x)', 'y = (e^x)^2', [-10, 10]).coincide!
    expect(coincideText(e)).toBe('the same function — they coincide everywhere')
    expect(coincideText(meet('y = x', 'y = sqrt(x^2)', [-10, 10]).coincide!)).toBe('they coincide for x ≥ 0')
  })
})

// ---------------------------------------------------------------------------
// 2. Zeros over ℂ: repeated irrational zeros
// ---------------------------------------------------------------------------

describe('2. Zeros over ℂ: a triple irrational zero is real', () => {
  it('(x² − 2)³, (x² − 5)³ and (x² − x − 1)³: every zero real, each triple, exact', () => {
    const cases: [(x: number) => number, string][] = [
      [(x) => (x * x - 2) ** 3, 'x = ±√2 (triple)'],
      [(x) => (x * x - 5) ** 3, 'x = ±√5 (triple)'],
      [(x) => (x * x - x - 1) ** 3, 'x = (1 ± √5)/2 (triple)'],
    ]
    for (const [f, line] of cases) {
      const z = zerosOf(f)
      expect(z.zeros.map(zeroLine)).toEqual([line])
      expect([z.real, z.nonReal, z.pairs]).toEqual([6, 0, 0])
      expect(z.exact).toBe(true)
      expect(z.graphNote).toMatch(/^Every zero is real/)
      expect(z.fta).toBe('Degree 6: 6 zeros counted with multiplicity — 6 real, 0 non-real.')
    }
    expect(zerosOf((x) => (x * x - 2) ** 3).steps).toContain(
      'Repeated factors, found exactly from gcd(p, p′): x⁶ − 6x⁴ + 12x² − 8 = (x² − 2)³.',
    )
  })

  it('mixed: (x − 1)⁴(x² + 1), (x² + 1)², (x² − 2)³(x − 1) and (x² − 2)³(x² + 1)', () => {
    const a = zerosOf((x) => (x - 1) ** 4 * (x * x + 1))
    expect(a.zeros.map(zeroLine)).toEqual(['x = 1 (multiplicity 4)', 'x = ±i'])
    expect([a.real, a.nonReal]).toEqual([4, 2])
    const b = zerosOf((x) => (x * x + 1) ** 2)
    expect(b.zeros.map(zeroLine)).toEqual(['x = ±i (double)'])
    expect([b.real, b.nonReal, b.pairs]).toEqual([0, 4, 2])
    const c = zerosOf((x) => (x * x - 2) ** 3 * (x - 1))
    expect([c.real, c.nonReal]).toEqual([7, 0])
    const d = zerosOf((x) => (x * x - 2) ** 3 * (x * x + 1))
    expect([d.real, d.nonReal]).toEqual([6, 2])
    expect(d.zeros.map(zeroLine)).toEqual(['x = ±√2 (triple)', 'x = ±i'])
  })

  it('never prints a "pair" with imaginary part 0.0000', () => {
    for (const f of [(x: number) => (x * x - 2) ** 4, (x: number) => (x * x + x + 1) ** 4, (x: number) => (x ** 3 - 2) ** 2]) {
      const z = curveComplexZeros(f)
      if (z) expect(z.zeros.every((e) => !/± 0\.0000i/.test(e.text))).toBe(true)
    }
    const z = zerosOf((x) => (x ** 3 - 2) ** 2)
    expect(z.zeros.map(zeroLine)).toEqual(['x ≈ 1.2599 (double)', 'x ≈ −0.6300 ± 1.0911i (double)'])
  })
})

// ---------------------------------------------------------------------------
// 3. holes and gaps
// ---------------------------------------------------------------------------

describe('3. coincidence with holes and undefined regions', () => {
  it('(x² − 1)/(x − 1) and x + 1 coincide everywhere EXCEPT at the hole x = 1', () => {
    const m = meet('y = (x^2-1)/(x-1)', 'y = x+1', [-10, 10])
    expect(m.coincide?.everywhere).toBe(false)
    expect(m.coincide?.except).toEqual([{ x: 1, exact: '1' }])
    expect(coincideText(m.coincide!)).toBe(
      'they coincide everywhere except at x = 1 (only one of them is defined there), so they are not quite the same function',
    )
    expect(m.points).toEqual([])
    const z = meet('y = x^2/x', 'y = x', [-10, 10])
    expect(z.coincide?.except).toEqual([{ x: 0, exact: '0' }])
  })

  it('the card summary does not say "same function" for a pair with a hole', () => {
    const f = typed('y = (x^2-1)/(x-1)')
    const g = typed('y = x+1')
    const all = boardMeetings([f, g], models, [-10, 10])
    const card = cardIntersections(f.id, all.points, () => 'g', [f.id, g.id], all.coincide)
    expect(card[0].coincide?.everywhere).toBe(false)
    expect(card[0].coincide?.text).toMatch(/except at x = 1/)
  })

  it('√(x² − 4) and √(x − 2)·√(x + 2) coincide for x ≥ 2, not across the gap (−2, 2)', () => {
    const m = meet('y = sqrt(x^2-4)', 'y = sqrt(x-2)*sqrt(x+2)', [-10, 10])
    expect(m.coincide?.intervals).toEqual([{ lo: 2, hi: Infinity, loExact: '2' }])
    expect(coincideText(m.coincide!)).toBe('they coincide for x ≥ 2')
  })

  it('ln(x²) and 2 ln x coincide for x > 0 (open: neither is defined at 0)', () => {
    const m = meet('y = ln(x^2)', 'y = 2ln(x)', [-10, 10])
    expect(m.coincide?.intervals).toEqual([{ lo: 0, hi: Infinity, loExact: '0', loOpen: true }])
    expect(coincideText(m.coincide!)).toBe('they coincide for x > 0')
  })

  it('a shared gap is "wherever they are defined"', () => {
    expect(coincideText(meet('y = sqrt(x)', 'y = x^(1/2)', [-10, 10]).coincide!)).toBe(
      'the same function — they coincide wherever they are defined',
    )
  })
})

// ---------------------------------------------------------------------------
// 4. intersections at a domain end
// ---------------------------------------------------------------------------

describe('4. a meeting point at a curve’s own domain end is kept', () => {
  const close = (got: number[], want: number[]): void => {
    expect(got).toHaveLength(want.length)
    got.forEach((x, i) => expect(x).toBeCloseTo(want[i], 9))
  }
  it('sin x on [π, 2π] meets y = 0 at π and 2π; on [0, π] at 0 and π', () => {
    close(xsOf(meet('y = sin(x) {pi <= x <= 2pi}', 'y = 0', [-10, 10]).points), [Math.PI, 2 * Math.PI])
    close(xsOf(meet('y = sin(x) {0 <= x <= pi}', 'y = 0', [-10, 10]).points), [0, Math.PI])
  })
  it('x² − 2 on [√2, 3] meets y = 0 at √2, exactly', () => {
    const pts = meet('y = x^2 - 2 {sqrt(2) <= x <= 3}', 'y = 0', [-10, 10]).points
    close(xsOf(pts), [Math.SQRT2])
    expect(pts[0].exactX).toBe('√2')
  })
  it('a real crossing on the window edge is kept: cos x and 0 on [−π/2, π/2]', () => {
    close(xsOf(meet('y = cos(x)', 'y = 0', [-Math.PI / 2, Math.PI / 2]).points), [-Math.PI / 2, Math.PI / 2])
  })
})

// ---------------------------------------------------------------------------
// 5. the rational root step
// ---------------------------------------------------------------------------

describe('5. "none is a zero" is never said of an untested list', () => {
  it('x² + 3x, x³ + 3x², x⁴ − x³: the linear leftover is solved, out loud', () => {
    const cases: [(x: number) => number, string][] = [
      [(x) => x * x + 3 * x, `x + 3 = 0 gives x = ${MINUS}3.`],
      [(x) => x ** 3 + 3 * x * x, `x + 3 = 0 gives x = ${MINUS}3.`],
      [(x) => x ** 4 - x ** 3, 'x − 1 = 0 gives x = 1.'],
    ]
    for (const [f, step] of cases) {
      const z = zerosOf(f)
      expect(z.steps.some((s) => /none is a zero/.test(s))).toBe(false)
      expect(z.steps).toContain(step)
    }
  })
})

// ---------------------------------------------------------------------------
// 6. printed working
// ---------------------------------------------------------------------------

describe('6. printed working that cannot be misread', () => {
  it('a negative constant squared is (−2)², and its check does not say "−2 = −2"', () => {
    const r = route('sqrt(x) = -2')!
    expect(r.steps[0].text).toBe(`Square both sides: x = (${MINUS}2)²`)
    expect(r.steps[0].tex).toBe('x = \\left(-2\\right)^{2}')
    expect(r.candidates[0].reason).toBe(`√x = 2 but the other side is ${MINUS}2: squaring lost the sign`)
  })

  it('a fractional coefficient is (1/4)x and (1/4)(x − 3), never 1/4x', () => {
    expect(route('0.5sqrt(x) = 1')!.steps[0].text).toBe('Square both sides: (1/4)x = 1²')
    const r = route('x = 5 + sqrt(x - 3)/2')!
    expect(r.steps.map((s) => s.text)).toContain('Square both sides: (1/4)(x − 3) = (x − 5)²')
  })

  it('a fractional log base is in parentheses: log_(1/2), (1/2)⁻¹, (1/2)²', () => {
    const a = route('log_(1/2)(x) + log_(1/2)(x+1) = -1')!
    const t = a.steps.map((s) => s.text)
    expect(t).toContain(`Combine the logs: log_(1/2)(x(x + 1)) = ${MINUS}1`)
    expect(t).toContain('Rewrite without logs: x(x + 1) = (1/2)⁻¹ = 2')
    expect(route('log_0.5(x) = 2')!.steps.map((s) => s.text)).toContain('Rewrite without logs: x = (1/2)² = 1/4')
    expect(route('log(x) - log(x+1) = -1')!.steps.map((s) => s.text)).toContain('Rewrite without logs: x = (1/10)(x + 1)')
  })

  it('a product of logs’ arguments keeps each factor whole: x(2x)', () => {
    const t = route('log(x) + log(2x) = 1')!.steps
    expect(t.map((s) => s.text)).toContain('Combine the logs: log(x(2x)) = 1')
    expect(t.find((s) => s.text.startsWith('Combine'))!.tex).toBe('\\log\\left(x\\left(2x\\right)\\right) = 1')
  })

  it('a negative single log is written −x ln 2, not x −ln 2', () => {
    const r = expSolve('2^x = 4^(x-1)')!
    expect(r.steps.map((s) => s.text)).toContain(`Collect the x terms: ${MINUS}x ln 2 = ${MINUS}2 ln 2`)
  })
})

// ---------------------------------------------------------------------------
// 7. reveal leaks, and the extraneous candidate on the graph
// ---------------------------------------------------------------------------

const NOOP = (): void => {}
function renderCard(curve: FittedCurve, intersections: unknown, hidden: boolean): string {
  const props = {
    curve, models, selected: true, candidates: [], snapMask: null, snapKey: 0, shaking: false, edited: false,
    analysis: [] as SpecialPoint[], intersections,
    onAnalysisHover: NOOP, onFeatureEdit: () => false, onSelect: NOOP, onDelete: NOOP, onDuplicate: NOOP,
    onToggleVisible: NOOP, onCycleColor: NOOP, onParamChange: NOOP, onParamEditStart: NOOP, onParamEditEnd: NOOP,
    onParamCommit: NOOP, onParamSetExact: NOOP, onApplyCandidate: NOOP, onEquationCommit: () => null,
    onStrokeWidth: NOOP, onDash: NOOP, onEnds: NOOP, onOpacity: NOOP, onAddCalc: NOOP, onAddAreaBetween: NOOP,
    onCalcChange: NOOP, onCalcRemove: NOOP,
  }
  return renderToStaticMarkup(
    createElement(
      RevealContext.Provider,
      { value: { ...REVEAL_API_OFF, on: true, hidden: () => hidden } },
      createElement(CurveCard, props as unknown as Parameters<typeof CurveCard>[0]),
    ),
  )
}

describe('7. reveal mode', () => {
  it('the folded Intersections summary hides "(same function)" with the coincidence answer', () => {
    const f = typed('y = x^2 - 2x - 8')
    const g = typed('y = (x+2)(x-4)')
    const all = boardMeetings([f, g], models, [-10, 10])
    const groups = cardIntersections(f.id, all.points, () => 'g', [f.id, g.id], all.coincide)
    rememberSection('intersections', false)
    try {
      const hid = renderCard(f, groups, true)
      expect(hid).toContain('Intersection')
      expect(hid).not.toContain('same function')
      const shown = renderCard(f, groups, false)
      expect(shown).toContain('with g (same function)')
    } finally {
      rememberSection('intersections', true)
    }
    expect(coincideKey(f.id, g.id)).toMatch(/:same$/)
  })

  it('Show on graph’s note names the extraneous candidate only when the route is not hidden', () => {
    const item = { id: 'q7', src: 'sqrt(x+7) = x - 5' }
    expect(graphNoteShown(item, null)).toBe(graphNote(item.src))
    expect(graphNoteShown(item, REVEAL_OFF)).toBe('x = 2 is extraneous — the graphs do not meet there.')
    expect(graphNoteShown(item, { ...REVEAL_OFF, on: true })).toBeNull()
    expect(graphNoteShown(item, { ...REVEAL_OFF, on: true, revealed: [solveKey('q7')] })).toBe(
      'x = 2 is extraneous — the graphs do not meet there.',
    )
  })

  it('the extraneous candidate is a hollow dot on each side’s graph with the chip “x = 2 (extraneous)”', () => {
    const items: NLItem[] = [{ kind: 'solve', id: 'q8', src: 'sqrt(x+7) = x - 5', color: '#e0a030' } as NLItem]
    const a = typed('y = sqrt(x+7)')
    const b = typed('y = x - 5')
    const sources = { [a.id]: 'y = sqrt(x+7)', [b.id]: 'y = x - 5' }
    const ev = (id: string, x: number): number => {
      const c = id === a.id ? a : b
      return models[c.modelId].evalExplicit!(c.params, x)
    }
    const ovs = extraneousOverlays(items, [a, b], sources, ev)
    expect(ovs).toEqual([
      { kind: 'dot', curveId: a.id, at: { x: 2, y: 3 }, hollow: true, answer: solveKey('q8') },
      { kind: 'dot', curveId: b.id, at: { x: 2, y: -3 }, hollow: true, answer: solveKey('q8') },
      { kind: 'label', at: { x: 2, y: 3 }, text: 'x = 2 (extraneous)', dir: { x: 0, y: -1 }, color: '#e0a030', answer: solveKey('q8') },
    ])
    // only one side on the board: nothing to mark
    expect(extraneousOverlays(items, [a], { [a.id]: 'y = sqrt(x+7)' }, ev)).toEqual([])
    // a log candidate where neither side is defined sits on the x-axis
    const logItems: NLItem[] = [{ kind: 'solve', id: 'q9', src: 'log(x) + log(x-3) = 1', color: '#000' } as NLItem]
    const l = typed('y = log(x) + log(x-3)')
    const one = typed('y = 1')
    const ev2 = (id: string, x: number): number => {
      const c = id === l.id ? l : one
      return models[c.modelId].evalExplicit!(c.params, x)
    }
    const logOv = extraneousOverlays(logItems, [l, one], { [l.id]: 'y = log(x) + log(x-3)', [one.id]: 'y = 1' }, ev2)
    expect(logOv.find((o) => o.kind === 'label')).toMatchObject({ text: `x = ${MINUS}2 (extraneous)` })
  })

  it('the marks are hidden while the solution is, and shown once it is revealed', () => {
    const key = solveKey('q8')
    const overlays = [
      { kind: 'dot' as const, at: { x: 2, y: 3 }, hollow: true, answer: key },
      { kind: 'label' as const, at: { x: 2, y: 3 }, text: 'x = 2 (extraneous)', answer: key },
      { kind: 'dot' as const, at: { x: 0, y: 0 } },
    ]
    const scene = { curves: [], overlays } as unknown as BoardScene
    const r = (hidden: boolean): SceneReveal => ({
      hidden: () => hidden, positions: true, pointKey: () => null, crossKey: () => '',
    })
    expect(applyReveal(scene, r(true)).overlays).toEqual([{ kind: 'dot', at: { x: 0, y: 0 } }])
    expect(applyReveal(scene, r(false)).overlays).toEqual(overlays)
  })
})

// ---------------------------------------------------------------------------
// 8. wording
// ---------------------------------------------------------------------------

describe('8. wording', () => {
  it('a tiny discriminant is written in significant figures, never "0.0000 < 0"', () => {
    const z = zerosOf((x) => x * x + 0.000001)
    expect(z.discriminant!.text).toBe('b² − 4ac = 0² − 4(1)(0.000001) ≈ −4×10⁻⁶')
    expect(z.discriminant!.sentence).toBe('−4×10⁻⁶ < 0: two non-real zeros, a complex conjugate pair')
    expect(z.discriminant!.tex).toBe('b^2 - 4ac = \\approx -4 \\times 10^{-6}')
    const w = zerosOf((x) => x * x + 2 * x + 1.0000001)
    expect(w.discriminant!.sentence).not.toMatch(/0\.0000/)
    expect(w.discriminant!.verdict).toBe('two-non-real')
  })

  it('two negative sides are multiplied by −1 before ln is taken', () => {
    const r = expSolve('-3*2^x = -5*3^x')!
    const t = r.steps.map((s) => s.text)
    expect(t[0]).toBe(`Multiply both sides by ${MINUS}1: 3·2ˣ = 5·3ˣ`)
    expect(t[1]).toBe('Take ln of both sides: ln 3 + x ln 2 = ln 5 + x ln 3')
  })

  it('log x = log(−x): no combining — no x makes both sides defined', () => {
    const r = route('log(x) = log(-x)')!
    expect(r.candidates).toEqual([])
    expect(r.summary).toBe('There is no solution: no x makes both sides defined.')
    expect(r.steps.some((s) => /Combine|x\/−x/.test(s.text))).toBe(false)
    expect(r.steps[r.steps.length - 1].text).toMatch(/no x makes both sides defined/)
  })
})

// ---------------------------------------------------------------------------
// 9. the gallery note
// ---------------------------------------------------------------------------

describe('9. m1-inequality-system: the corner (2, 1)', () => {
  it('is on both boundary lines and is not a solution', () => {
    const note = exampleById('m1-inequality-system')!.note
    expect(note).toContain('(2, 1), which lies on both boundary lines, is not a solution')
    expect(note).not.toContain('belongs to one boundary and not the other')
    // the maths of the note: on both lines, satisfies ≤ but not the strict >
    expect(2 * 2 - 3).toBe(1)
    expect(-2 / 2 + 2).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 10. the number-line solver
// ---------------------------------------------------------------------------

describe('10. the solver at large and tiny magnitudes', () => {
  it('eˣ = 2ˣ is {0}, not (−∞, 0]', () => {
    expect(solved('e^x = 2^x')).toBe('{0}')
    expect(solved('e^x < 2^x')).toBe(`(${MINUS}∞, 0)`)
    expect(solved('e^(-x) = 2^(-x)')).toBe('{0}')
  })
  it('2ˣ = 2ˣ + 1 has no solution, and 2ˣ < 2ˣ + 1 holds everywhere', () => {
    expect(solved('2^x = 2^x + 1')).toBe('∅')
    expect(solved('2^x < 2^x + 1')).toBe(`(${MINUS}∞, ∞)`)
    expect(solved('10^x = 10^x + 1')).toBe('∅')
    expect(solved('e^x = e^x + 0.001')).toBe('∅')
  })
  it('identities and true zero stretches are unchanged', () => {
    expect(solved('floor(x) = 2')).toBe('[2, 3)')
    expect(solved('x^2 = 4')).toBe(`{${MINUS}2, 2}`)
  })
})

// ---------------------------------------------------------------------------
// help-sheet standard codes (2016 NC SCOS)
// ---------------------------------------------------------------------------

describe('help-sheet standard codes', () => {
  const section = (id: string) => HELP_SECTIONS.find((s) => s.id === id)!
  const all = (id: string): string => {
    const s = section(id)
    return [s.title, ...s.entries.map((e) => ('note' in e && e.note ? e.note : 'text' in e ? e.text : ''))].join(' | ')
  }
  it('m1-linexp: no F-LE.2 (not a 2016 NC Math 1 standard); building from two points is F-BF.1a', () => {
    const t = all('m1-linexp')
    expect(t).not.toMatch(/F-LE\.2|F-LE\.1, 2/)
    expect(section('m1-linexp').title).toContain('F-BF.1a, 2; F-LE.1, 5')
  })
  it('m2-quad: N-CN.9 only as the Math 3 code', () => {
    const t = all('m2-quad')
    expect(t.replace(/NC\.M3\.N-CN\.9/g, '')).not.toContain('N-CN.9')
    expect(t).toContain('A-REI.4b')
  })
})

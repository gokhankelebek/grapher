// ============================================================================
// tests/cardFixes.test.ts — three card bugs the gallery agents found.
//
//   1. A piecewise function of t (C(t) = {3 if 0 < t <= 1, …}) lost its
//      Piecewise section: the reading, its jumps and breakpoint values only
//      knew x.
//   2. A family line with a domain restriction (d(t) = 3 sin(πt/6) + 8
//      {0 <= t <= 24}) lost its family section. Now every family section
//      (sinusoid, exponential, logarithm, logistic, roots, transformation)
//      reads the formula, states only what lies in the domain, and every
//      rewrite keeps the restriction. (Conics are implicit: the parser
//      refuses a restriction on them.)
//   3. Reveal mode: see tests/revealLeak.test.ts.
// ============================================================================

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { parseExpression } from '../src/core/parse'
import { piecewiseSource, readPiecewise } from '../src/core/piecewise'
import { CurveCard } from '../src/ui/CurveCard'
import {
  boundProblem,
  commitTable,
  exprProblem,
  tableFromSource,
  tableProblems,
  verdictsFor,
} from '../src/ui/piecewiseLinks'
import { factsWithin, familyBase, familyRestriction, keepRestriction, pointX } from '../src/ui/familyLine'
import {
  dragSinHandle,
  keyRows,
  safeReadSinusoid,
  safeSinFeatures,
  safeSinSource,
  sinKeyMarks,
  writeAs,
} from '../src/ui/sinLinks'
import { safeReadExponential } from '../src/ui/expLinks'
import { safeReadLogarithmic } from '../src/ui/logLinks'
import { safeReadLogistic } from '../src/ui/logisticLinks'
import { safeReadFactored } from '../src/ui/factorLinks'
import { safeReadTransform } from '../src/ui/transformLinks'
import { familyMarks } from '../src/ui/familyMarks'
import { familyKeyOf, hasFamilyFacts } from '../src/ui/familyFacts'
import { REVEAL_OFF, familyKey, isHidden } from '../src/ui/reveal'

const NOOP = (): void => {}

function typed(src: string): { curve: FittedCurve; models: Record<string, ModelSpec> } {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(o.error)
  return {
    curve: {
      id: 'c1',
      modelId: 'expr_1',
      params: o.plot.defaultParams.slice(),
      kind: o.plot.kind,
      domain: o.plot.domain,
      color: '#4f9cf9',
      strokeWidth: 2.5,
      visible: true,
      error: 0,
    },
    models: { expr_1: o.plot.makeModel('expr_1') },
  }
}

/** The selected card of a typed line, as static HTML. */
function card(src: string): string {
  const { curve, models } = typed(src)
  const restate = (): null => null
  const props = {
    curve,
    models,
    selected: true,
    candidates: [],
    snapMask: null,
    snapKey: 0,
    shaking: false,
    exprSource: src,
    edited: true,
    analysis: [],
    onAnalysisHover: NOOP,
    onFeatureEdit: () => false,
    onSelect: NOOP,
    onDelete: NOOP,
    onDuplicate: NOOP,
    onToggleVisible: NOOP,
    onCycleColor: NOOP,
    onParamChange: NOOP,
    onParamEditStart: NOOP,
    onParamEditEnd: NOOP,
    onParamCommit: NOOP,
    onParamSetExact: NOOP,
    onApplyCandidate: NOOP,
    onEquationCommit: () => null,
    onStrokeWidth: NOOP,
    onDash: NOOP,
    onEnds: NOOP,
    onOpacity: NOOP,
    onAddCalc: NOOP,
    onAddAreaBetween: NOOP,
    onCalcChange: NOOP,
    onCalcRemove: NOOP,
    onFactorRestate: restate,
    onExpRestate: restate,
    onLogRestate: restate,
    onSinRestate: restate,
    onLogisticRestate: restate,
    onTransformRestate: restate,
    onPiecewiseRestate: restate,
    onConvertTyped: restate,
  }
  return renderToStaticMarkup(createElement(CurveCard, props as unknown as Parameters<typeof CurveCard>[0]))
}

const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/\s+/g, ' ')

// ---------------------------------------------------------------------------
// 1. piecewise in any variable the parser accepts
// ---------------------------------------------------------------------------

describe('a piecewise function of t has its Piecewise section', () => {
  const PARK = 'C(t) = {3 if 0 < t <= 1, 5 if 1 < t <= 2, 7 if 2 < t <= 3}'

  it('reads in t: the pieces, the variable, the same line back', () => {
    const spec = readPiecewise(PARK)!
    expect(spec).toEqual({
      name: 'C',
      v: 't',
      pieces: [
        { expr: '3', lo: '0', hi: '1', loClosed: false, hiClosed: true },
        { expr: '5', lo: '1', hi: '2', loClosed: false, hiClosed: true },
        { expr: '7', lo: '2', hi: '3', loClosed: false, hiClosed: true },
      ],
    })
    expect(piecewiseSource(spec)).toBe(PARK)
    // a y = … line written in t, and a restricted formula in t
    expect(readPiecewise('y = {t^2 if t < 0, t otherwise}')).toMatchObject({ v: 't' })
    expect(piecewiseSource(readPiecewise('h(t) = t^2 {0 <= t < 3}')!)).toBe('h(t) = t^2 {0 <= t < 3}')
    // x lines are unchanged: no v, the same text
    const x = readPiecewise('C(x) = {3 if 0 < x <= 1, 5 if 1 < x <= 2}')!
    expect(x.v).toBeUndefined()
    expect(piecewiseSource(x)).toBe('C(x) = {3 if 0 < x <= 1, 5 if 1 < x <= 2}')
  })

  it('its jumps and breakpoint values, said in t', () => {
    expect(verdictsFor(readPiecewise(PARK)!).map((v) => v.text)).toEqual([
      'C starts at t = 0: right limit 3, C(0) is not defined',
      'jump of 2 at t = 1: left limit 3, right limit 5, C(1) = 3',
      'jump of 2 at t = 2: left limit 5, right limit 7, C(2) = 5',
      'C ends at t = 3: left limit 7, C(3) = 7',
    ])
  })

  it('the table edits in t and writes the line back in t', () => {
    const t = tableFromSource(PARK)!
    expect(t.v).toBe('t')
    expect(tableProblems(t.table, undefined, 't')).toEqual([])
    expect(commitTable(t.table, t.name, undefined, t.v)).toEqual({ src: PARK, error: null })
    expect(exprProblem('2t + 1', undefined, 't')).toBeNull()
    expect(exprProblem('2x + 1', undefined, 't')).toBe('A piece is a formula in t — x cannot appear in it')
    expect(exprProblem('2t + 1')).toBe('A piece is a formula in x — t cannot appear in it')
    expect(boundProblem('t', 't')).toBe('A bound is a number, not a formula in t')
  })

  it('on the card: the section, its t column and its verdicts', () => {
    const html = card(PARK)
    expect(html).toContain('data-testid="piecewise-section"')
    const words = text(html)
    expect(words).toContain('jump of 2 at t = 1')
    expect(words).toContain('C ends at t = 3')
    expect(html).toContain('formula in t')
  })
})

// ---------------------------------------------------------------------------
// 2. a restriction keeps the family section
// ---------------------------------------------------------------------------

describe('a restricted line keeps its family section', () => {
  const TIDE = 'd(t) = 3sin(pi t/6) + 8 {0 <= t <= 24}'

  it('every family reader reads the formula under the restriction', () => {
    expect(familyBase(TIDE)).toBe('d(t) = 3sin(pi t/6) + 8')
    expect(safeReadSinusoid(TIDE)).toMatchObject({ name: 'd', fn: 'sin', a: '3', b: 'pi/6', h: '0', k: '8' })
    expect(safeReadExponential('y = 200(1/2)^(x/5.7) + 10 {0 <= x <= 20}')).toMatchObject({ a: '200', k: '10' })
    expect(safeReadLogarithmic('y = ln(x - 1) + 2 {2 <= x <= 9}')).not.toBeNull()
    expect(safeReadLogistic('P(t) = 1000/(1 + 49e^(-0.3t)) {t >= 0}')).not.toBeNull()
    expect(safeReadFactored('y = (x + 1)(x - 3) {0 <= x <= 5}')).not.toBeNull()
    expect(safeReadTransform('y = (x - 2)^2 + 1, 0 <= x <= 4')).toMatchObject({ parent: 'quadratic', h: '2', k: '1' })
    // a line of several pieces is a piecewise function, not a family
    expect(familyBase('y = {x if x < 0, x^2 otherwise}')).toBe('y = {x if x < 0, x^2 otherwise}')
    expect(safeReadSinusoid('y = {sin(x) if x < 0, 0 otherwise}')).toBeNull()
  })

  it('the domain: closed ends included (to a hair), the rest out', () => {
    const r = familyRestriction(TIDE)!
    expect(r.cond).toBe('0 <= t <= 24')
    expect([r.lo, r.hi]).toEqual([0, 24])
    expect([0, 12, 24, 24 + 1e-12, -0.01, 24.01].map((x) => r.within(x))).toEqual([true, true, true, true, false, false])
    const open = familyRestriction('y = 2^x {0 < x < 3}')!
    expect([open.within(0), open.within(1), open.within(3)]).toEqual([false, true, false])
    expect(familyRestriction('y = 2^x')).toBeNull()
    // a slider bound: nothing is filtered
    expect(familyRestriction('y = x^2 {0 <= x <= a}')!.within(100)).toBe(true)
  })

  it('every rewrite keeps the restriction: a field, "write as", a dragged handle', () => {
    const spec = safeReadSinusoid(TIDE)!
    expect(keepRestriction(TIDE, safeSinSource({ ...spec, a: '4' })!)).toBe('d(t) = 4sin(pi/6 t) + 8 {0 <= t <= 24}')
    const asCos = keepRestriction(TIDE, safeSinSource(writeAs(spec, 'cos')!)!)
    expect(asCos).toMatch(/^d\(t\) = 3cos\(.*\) \+ 8 \{0 <= t <= 24\}$/)
    const dragged = dragSinHandle(spec, 'a', { x: 3, y: 12 })!
    expect(keepRestriction(TIDE, safeSinSource(dragged)!)).toBe('d(t) = 4sin(pi/6 t) + 8 {0 <= t <= 24}')
    // "for" and comma spellings come back in braces; a line with its own condition is left alone
    expect(keepRestriction('y = 2^x for x > 0', 'y = 3^x')).toBe('y = 3^x {x > 0}')
    expect(keepRestriction(TIDE, 'y = x {x < 1}')).toBe('y = x {x < 1}')
    expect(keepRestriction('y = 2^x', 'y = 3^x')).toBe('y = 3^x')
    // the family cores write x; a line typed in t stays in t, restricted or not
    expect(safeSinSource({ ...spec, a: '4' })).toBe('d(x) = 4sin(pi/6 x) + 8')
    expect(keepRestriction('d(t) = 3sin(pi t/6) + 8', 'd(x) = 4sin(pi/6 x) + 8')).toBe('d(t) = 4sin(pi/6 t) + 8')
    expect(keepRestriction('y = 2^t', 'y = 3^x')).toBe('y = 3^t')
  })

  it('key points: only the ones in the domain, from the first cycle that starts in it', () => {
    const tide = safeReadSinusoid(TIDE)!
    expect(keyRows(safeSinFeatures(tide), familyRestriction(TIDE)).map((k) => `(${k.x}, ${k.y})`)).toEqual([
      '(0, 8)', '(3, 11)', '(6, 8)', '(9, 5)', '(12, 8)',
    ])
    const src = 'y = sin(x) {pi <= x <= 3pi}'
    const spec = safeReadSinusoid(src)!
    const r = familyRestriction(src)!
    // the cycle at h = 0 is outside; the one starting at 2π is the first in the domain
    expect(keyRows(safeSinFeatures(spec), r).map((k) => `(${k.x}, ${k.y})`)).toEqual(['(2π, 0)', '(5π/2, 1)', '(3π, 0)'])
    expect(sinKeyMarks(spec, r).map((p) => p.exactX)).toEqual(['2π', '5π/2', '3π'])
    // the board's marks, through the same path the App takes
    const { curve } = typed(src)
    expect(familyMarks(curve, src).sin.map((p) => p.pos.x)).toEqual([2 * Math.PI, 2.5 * Math.PI, 3 * Math.PI])
  })

  it('facts about the whole line go: domain, range, end behaviour, a point outside', () => {
    const r = familyRestriction('y = 2^x + 1 {1 <= x <= 4}')!
    expect(
      factsWithin(
        ['Horizontal asymptote y = 1', 'y-intercept (0, 2)', 'Range: y > 1', 'Increasing, concave up', 'as x → −∞, y → 1; as x → ∞, y → ∞', 'domain: all real numbers'],
        r,
      ),
    ).toEqual(['Horizontal asymptote y = 1', 'Increasing, concave up'])
    expect(pointX('vertex: (π/2, 1)')).toBeCloseTo(Math.PI / 2, 12)
    expect(pointX('(−√3, 0)')).toBeCloseTo(-Math.sqrt(3), 12)
    expect(factsWithin(['Range: y > 1'], null)).toEqual(['Range: y > 1'])
  })

  it('on the card: the Sinusoidal section, its key points, no range of its own', () => {
    const words = text(card(TIDE))
    expect(card(TIDE)).toContain('data-testid="sin-section"')
    expect(words).toContain('amplitude 3')
    expect(words).toContain('period 12')
    expect(words).toContain('midline y = 8')
    expect(words).not.toContain('range 5 ≤ y ≤ 11')
    // the Piecewise section is there too, folded: a teacher may add a piece
    expect(card(TIDE)).toContain('data-testid="piecewise-section"')
  })

  it('on the card: every other family section under a restriction', () => {
    expect(card('y = 200(1/2)^(x/5.7) + 10 {0 <= x <= 20}')).toContain('data-testid="exp-section"')
    expect(card('y = 3log(2x) {1 <= x <= 8}')).toContain('data-testid="log-section"')
    expect(card('P(t) = 1000/(1 + 49e^(-0.3t)) {t >= 0}')).toContain('data-testid="logistic-section"')
    expect(card('y = (x + 1)^2(x - 3) {-2 <= x <= 4}')).toContain('data-testid="roots-section"')
    expect(card('y = |x - 2| + 1 {0 <= x <= 5}')).toContain('data-testid="transform-section"')
    // a conic cannot be restricted at all: the parser says so
    const c = parseExpression('(x - 1)^2 + y^2 = 4 {x > 0}')
    expect(c.ok).toBe(false)
  })

  it('reveal mode: a restricted sinusoid has family facts, and its marks hide with them', () => {
    const { curve, models } = typed(TIDE)
    expect(hasFamilyFacts('explicit', TIDE)).toBe(true)
    expect(familyKeyOf(curve, TIDE, models)).toBe(familyKey('c1'))
    const ON = { ...REVEAL_OFF, on: true }
    expect(familyMarks(curve, TIDE, { hidden: (k) => isHidden(ON, k) }).sin).toEqual([])
    expect(familyMarks(curve, TIDE, { hidden: (k) => isHidden({ ...ON, revealed: [familyKey('c1')] }, k) }).sin).toHaveLength(5)
    // sin x + cos x is no transformed parent, but its Sinusoidal facts are still answers
    expect(hasFamilyFacts('explicit', 'y = sin(x) + cos(x)')).toBe(true)
  })
})

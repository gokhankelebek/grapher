// ============================================================================
// tests/analysisEnds.test.ts — the second round of analysis bugs:
//
//   1. y = tan(x)/x read its domain as "(−∞, −1301000) ∪ …": a sparse sample
//      of tan's poles listed as points, because the hole at 0 broke the
//      periodic pattern. Now x ≠ 0, π/2 + kπ; no domain lists a sampled
//      pattern; a periodic domain's range is the window's only when f
//      repeats with it.
//   2. e^x/(e^x + 7) lost its asymptote y = 1: e^x overflows on the far rungs
//      of the end ladder. The ladder now stops short of the overflow.
//   3. x·ln x showed a "hole" at (0, −1.84e−7): 0 is an END of its domain,
//      and the limit is 0. It is an open end, "y → 0 as x → 0⁺".
//   4. (e^(2x) − 1)/ln(1 + x) had an unknown range: its end at −1 crawls in
//      like 1/ln h. The limit laws on the formula read it: (0, 2) ∪ (2, ∞).
//   5. A function of t (C(t)) had x in its Domain rows and its Table.
// ============================================================================

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { parseExpression } from '../src/core/parse'
import { curveDomain, curveRange, oneToOneInfo } from '../src/core/domainRange'
import { analyzeCurve } from '../src/core/analyze'
import { findAsymptotes, findHoles } from '../src/core/holes'
import { formulaLimit } from '../src/core/endLimit'
import { CurveCard, asymptoteTexts } from '../src/ui/CurveCard'
import { openEndText } from '../src/ui/numeric'
import { lineVariable } from '../src/ui/familyLine'
import { inCurveVariable, oneToOneChips, oneToOneText } from '../src/ui/domainLinks'
import type { DomainPanel } from '../src/ui/domainLinks'
import { DomainSection } from '../src/ui/DomainSection'
import { TableSection } from '../src/ui/TableSection'
import { panelFigure, tablePanel } from '../src/ui/valueTableLinks'
import { rememberSection } from '../src/ui/CardSection'
import { PERF } from './perfBudget'

let seq = 0
function typed(src: string): { curve: FittedCurve; models: Record<string, ModelSpec>; spec: ModelSpec } {
  const r = parseExpression(src)
  if (!r.ok) throw new Error(`expected "${src}" to parse: ${r.error}`)
  const id = `ends_${++seq}`
  const spec = r.plot.makeModel(id)
  const curve: FittedCurve = {
    id: `c${seq}`, modelId: id, params: r.plot.defaultParams, kind: r.plot.kind,
    domain: r.plot.domain, color: '#4f9cf9', strokeWidth: 2.5, visible: true, error: 0,
  }
  return { curve, models: { [id]: spec }, spec }
}

const domainOf = (src: string) => { const t = typed(src); return curveDomain(t.curve, t.models) }
const rangeOf = (src: string) => { const t = typed(src); return curveRange(t.curve, t.models) }
const lines = (src: string) => {
  const t = typed(src)
  return findAsymptotes(t.curve, t.models, [-10, 10]).map((a) =>
    a.kind === 'vertical' ? `x = ${+a.x.toFixed(9)}` : a.kind === 'line' && a.dir.y === 0 ? `y = ${+a.a.y.toFixed(9)}` : 'slant')
}
const text = (html: string): string =>
  html.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ')

// ---------------------------------------------------------------------------
// 1. infinitely many excluded points, in closed form
// ---------------------------------------------------------------------------

describe('a periodic domain with a few extra points is stated in closed form', () => {
  it('tan(x)/x: x ≠ 0, π/2 + kπ — not a list of sampled poles', () => {
    const d = domainOf('y = tan(x)/x')!
    expect(d.kind).toBe('intervals')
    expect(d.builder).toBe('x ≠ 0, π/2 + kπ')
    expect(d.text).toBe('… ∪ (−π/2, 0) ∪ (0, π/2) ∪ (π/2, 3π/2) ∪ …')
    expect(d.periodic?.extra?.map((e) => e.value)).toEqual([0])
    expect(d.builderTex).toBe('x \\ne 0, \\frac{\\pi}{2} + k\\pi')
    // the hole is still a hole, at (0, 1)
    const t = typed('y = tan(x)/x')
    expect(findHoles(t.curve, t.models, [-10, 10])).toEqual([{ x: 0, y: 1, exact: true }])
  })

  it('the extra points may be several, or far out, and are listed once', () => {
    expect(domainOf('y = tan(x)/(x - 1)')!.builder).toBe('x ≠ 1, π/2 + kπ')
    expect(domainOf('y = tan(x)/(x^2 - 1)')!.builder).toBe('x ≠ −1, 1, π/2 + kπ')
    expect(domainOf('y = sec(x)/x')!.builder).toBe('x ≠ 0, π/2 + kπ')
    expect(domainOf('y = tan(x)/(x - 100)')!.builder).toBe('x ≠ 100, π/2 + kπ')
    // the ordinary periodic sets are unchanged
    expect(domainOf('y = tan(x)')!.builder).toBe('x ≠ π/2 + kπ')
    expect(domainOf('y = 1/(2sin(x) - 1)')!.builder).toBe('x ≠ π/6 + 2kπ, 5π/6 + 2kπ')
  })

  it('a periodic set of INTERVALS is never written "x ≠ …"', () => {
    // ln(sin x) names its zeros kπ, but its domain is (2kπ, (2k + 1)π)
    const d = domainOf('y = ln(sin(x))')!
    expect(d.builder).not.toMatch(/≠/)
    expect(d.text).toBe('… ∪ (−2π, −π) ∪ (0, π) ∪ (2π, 3π) ∪ …')
  })

  it('exclusions the scan cannot follow are not listed: the domain is not stated', () => {
    // tan(eˣ): poles at ln(π/2 + kπ), crowding faster than any sampling
    expect(domainOf('y = tan(e^x)')!.kind).toBe('unknown')
    expect(rangeOf('y = tan(e^x)')!.kind).toBe('unknown')
    // a far point the formula writes is still listed
    expect(domainOf('y = 1/(x - 200000)')!.builder).toBe('x ≠ 200000')
  })

  it('tan(x)/x: its range is ℝ, read quickly (no stretch past the window)', () => {
    const t = typed('y = tan(x)/x')
    const t0 = performance.now()
    const r = curveRange(t.curve, t.models)!
    const ms = performance.now() - t0
    expect(r.text).toBe('(−∞, ∞)')
    expect(ms).toBeLessThan(150 * PERF)
  })

  it('a periodic domain whose f does not repeat: the window is not the range', () => {
    // 1/(x sin x) flattens toward 0 as |x| grows — its range is ℝ \ {0}, not
    // the window's (−∞, −0.0578] ∪ [0.0706, ∞)
    expect(rangeOf('y = 1/(x sin(x))')!.kind).toBe('unknown')
    expect(rangeOf('y = sec(x)/x')!.kind).toBe('unknown')
    // f repeating with a multiple of the domain's period still reads the window
    expect(rangeOf('y = sec(x)')!.text).toBe('(−∞, −1] ∪ [1, ∞)')
    expect(rangeOf('y = csc(2x)')!.text).toBe('(−∞, −1] ∪ [1, ∞)')
    expect(rangeOf('y = tan(x/3)')!.text).toBe('(−∞, ∞)')
    expect(rangeOf('y = sqrt(sin(x))')!.text).toBe('[0, 1]')
  })
})

// ---------------------------------------------------------------------------
// 2. a horizontal asymptote past the overflow
// ---------------------------------------------------------------------------

describe('an end whose terms overflow still has its horizontal asymptote', () => {
  it('eˣ/(eˣ + 7) → 1 and → 0', () => {
    expect(lines('y = e^x/(e^x + 7)')).toEqual(['y = 0', 'y = 1'])
    const t = typed('y = e^x/(e^x + 7)')
    expect(asymptoteTexts(t.curve, t.models)).toEqual(['y = 0', 'y = 1'])
  })

  it('eˣ/(1 + eˣ) → 1, (2eˣ + 3)/(eˣ − 1) → 2, x/eˣ → 0', () => {
    expect(lines('y = e^x/(1 + e^x)')).toEqual(['y = 0', 'y = 1'])
    expect(lines('y = (2e^x + 3)/(e^x - 1)')).toEqual(['x = 0', 'y = -3', 'y = 2'])
    expect(lines('y = (3e^x + 2)/(e^x - 5)')).toEqual(['x = 1.609437912', 'y = -0.4', 'y = 3'])
    // x/eˣ: 0 to the right; to the left it runs off to −∞
    expect(lines('y = x/e^x')).toEqual(['y = 0'])
  })

  it('a tail that does not settle before the overflow reports nothing (never a wrong line)', () => {
    expect(lines('y = sin(x) + e^x/(e^x + 1)')).toEqual([])
    expect(lines('y = e^x')).toEqual(['y = 0'])
  })
})

// ---------------------------------------------------------------------------
// 3. an open end of the domain, and no float noise as a y
// ---------------------------------------------------------------------------

describe('x·ln x at 0 is an open end, and its limit is 0', () => {
  it('the one-sided limit is read to where it is going: 0, not −1.84e−7', () => {
    const t = typed('y = x ln(x)')
    expect(findHoles(t.curve, t.models, [-10, 10])).toEqual([{ x: 0, y: 0, exact: true, side: 1 }])
    const u = typed('y = x^x')
    expect(findHoles(u.curve, u.models, [-10, 10])).toEqual([{ x: 0, y: 1, exact: true, side: 1 }])
    const v = typed('y = x^2 ln(x)')
    expect(findHoles(v.curve, v.models, [-10, 10])[0].y).toBe(0)
    // a real value keeps its digits; a two-sided hole has no side
    const w = typed('y = (x^2 - 2x)/(x - 2) + 0.123456789')
    expect(findHoles(w.curve, w.models, [-10, 10])).toEqual([{ x: 2, y: 2.123456789, exact: true }])
    const s = typed('y = sin(x)/x')
    expect(findHoles(s.curve, s.models, [-10, 10])).toEqual([{ x: 0, y: 1, exact: true }])
  })

  it('the analysis calls it an open end, and the card says where it heads', () => {
    const t = typed('y = x ln(x)')
    const end = analyzeCurve(t.curve, t.models).find((p) => p.kind === 'hole')!
    expect(end).toMatchObject({ label: 'open end', side: 1, pos: { x: 0, y: 0 } })
    expect(openEndText(end)).toBe('y → 0 as x → 0⁺')
    expect(openEndText({ ...end, side: -1 }, {}, 't')).toBe('y → 0 as t → 0⁻')
    // the sin(x)/x hole is still a hole
    const s = typed('y = sin(x)/x')
    expect(analyzeCurve(s.curve, s.models).find((p) => p.kind === 'hole')).toMatchObject({ label: 'hole', pos: { x: 0, y: 1 } })
    expect(analyzeCurve(s.curve, s.models).find((p) => p.kind === 'hole')!.side).toBeUndefined()
  })

  it('on the card: an "Open end" row, never a noise value', () => {
    const t = typed('y = x ln(x)')
    const noop = (): void => {}
    const props = new Proxy({
      curve: t.curve, models: t.models, selected: true, candidates: [], snapMask: null, snapKey: 0,
      shaking: false, exprSource: 'y = x ln(x)', edited: true, analysis: analyzeCurve(t.curve, t.models),
    } as Record<string, unknown>, { get: (o, k: string) => (k in o ? o[k] : k.startsWith('on') ? noop : undefined), has: () => true })
    const html = renderToStaticMarkup(createElement(CurveCard, props as unknown as Parameters<typeof CurveCard>[0]))
    const words = text(html)
    expect(words).toContain('Open end y → 0 as x → 0⁺')
    expect(words).not.toMatch(/Hole/)
    expect(words).not.toMatch(/e-7|×\s*10/)
  })
})

// ---------------------------------------------------------------------------
// 4. ends read off the formula
// ---------------------------------------------------------------------------

describe('an end too slow for samples is read by the limit laws', () => {
  const lim = (src: string, e: number, side: 1 | -1) => {
    const t = typed(src)
    return formulaLimit(t.spec.formula!, t.curve.params, e, side)
  }

  it('the laws: what they decide, and what they leave to the samples', () => {
    expect(lim('y = (e^(2x) - 1)/ln(1 + x)', -1, 1)).toEqual({ kind: 'fin', v: 0 })
    expect(lim('y = ln(x)', 0, 1)).toEqual({ kind: 'inf', sign: -1 })
    expect(lim('y = 1/x', 0, -1)).toEqual({ kind: 'inf', sign: -1 })
    expect(lim('y = 1/x', 0, 1)).toEqual({ kind: 'inf', sign: 1 })
    expect(lim('y = sqrt(x)/ln(x)', 0, 1)).toEqual({ kind: 'fin', v: 0 })
    expect(lim('y = 1/ln(x)', Infinity, -1)).toEqual({ kind: 'fin', v: 0 })
    expect(lim('y = atan(x)', -Infinity, 1)).toEqual({ kind: 'fin', v: -Math.PI / 2 })
    expect(lim('y = e^(1/x)', 0, -1)).toEqual({ kind: 'fin', v: 0 })
    expect(lim('y = e^(1/x)', 0, 1)).toEqual({ kind: 'inf', sign: 1 })
    // indeterminate forms and rounding are not the laws' to decide
    expect(lim('y = sin(x)/x', 0, 1)).toBeNull()
    expect(lim('y = x ln(x)', 0, 1)).toBeNull()
    expect(lim('y = e^x/(e^x + 7)', Infinity, -1)).toBeNull()
    expect(lim('y = 1/sin(x)', Math.PI, -1)).toBeNull()
    expect(lim('y = ln(sin(x))', Math.PI, -1)).toBeNull()
    expect(lim('y = floor(x)', 2, -1)).toBeNull()
    expect(lim('y = sin(1/x)', 0, 1)).toBeNull()
  })

  it('(e²ˣ − 1)/ln(1 + x): range (0, 2) ∪ (2, ∞), and one-to-one', () => {
    const r = rangeOf('y = (e^(2x) - 1)/ln(1 + x)')!
    expect(r.kind).toBe('intervals')
    expect(r.text).toBe('(0, 2) ∪ (2, ∞)')
    expect(r.builder).toBe('y > 0, y ≠ 2')
    const t = typed('y = (e^(2x) - 1)/ln(1 + x)')
    expect(oneToOneInfo(t.curve, t.models)?.oneToOne).toBe(true)
  })

  it('slow logarithmic tails, both kinds of end', () => {
    expect(rangeOf('y = 1/ln(x)')!.text).toBe('(−∞, 0) ∪ (0, ∞)')
    expect(rangeOf('y = 1/ln(1 + x^2)')!.text).toBe('(0, ∞)')
    expect(rangeOf('y = sqrt(x)/ln(x)')!.text).toBe('(−∞, 0) ∪ [1.359, ∞)')
    // the ordinary ones are as they were
    expect(rangeOf('y = e^(1/x)')!.text).toBe('(0, 1) ∪ (1, ∞)')
    expect(rangeOf('y = ln(x)/x')!.text).toBe('(−∞, 0.3679]')
    expect(rangeOf('y = x^2 {x < 2}')!.text).toBe('[0, ∞)')
    expect(rangeOf('y = sin(x)/x')!.text).toBe('[−0.2172, 1)')
  })
})

// ---------------------------------------------------------------------------
// 5. a function of t speaks t
// ---------------------------------------------------------------------------

describe('a function of t: the Domain rows and the Table say t', () => {
  const PARK = 'C(t) = {3 + 2ceil(t - 1) if 0 < t <= 6, 15 if 6 < t <= 12}'
  const TIDE = 'd(t) = 3sin(pi t/6) + 8 {0 <= t <= 24}'

  it('the variable is read off the line as typed', () => {
    expect(lineVariable(PARK)).toBe('t')
    expect(lineVariable(TIDE)).toBe('t')
    expect(lineVariable('y = {t if 0 < t <= 1, 2 otherwise}')).toBe('t')
    expect(lineVariable('y = tan(x)')).toBe('x')
    expect(lineVariable('y = sqrt(x)')).toBe('x')
    expect(lineVariable(undefined)).toBe('x')
  })

  it('the sets, the chips and the one-to-one sentence', () => {
    const t = typed(PARK)
    const d = curveDomain(t.curve, t.models)!
    expect(inCurveVariable(d, 't')!.builder).toBe('0 < t ≤ 12')
    expect(inCurveVariable(d, 'x')).toBe(d)
    // a periodic set keeps its closed form, in t
    expect(inCurveVariable(domainOf('y = tan(x)/x'), 't')!.builder).toBe('t ≠ 0, π/2 + kπ')
    const s = typed(TIDE)
    const one = oneToOneInfo(s.curve, s.models)!
    expect(one.oneToOne).toBe(false)
    expect(oneToOneText(one, 't')).toMatch(/\(t = /)
    expect(oneToOneChips(one, undefined, 't').every((c) => /\bt\b/.test(c.label) && !/\bx\b/.test(c.label))).toBe(true)
  })

  it('the Domain section, rendered', () => {
    const t = typed(PARK)
    const panel: DomainPanel = {
      role: 'function', ownerId: t.curve.id, name: 'C',
      domain: inCurveVariable(curveDomain(t.curve, t.models), 't'),
      range: curveRange(t.curve, t.models),
      oneToOne: oneToOneInfo(t.curve, t.models),
      restrict: { kind: 'typed', cond: null }, current: null, restricted: false,
      chips: oneToOneChips(oneToOneInfo(t.curve, t.models), undefined, 't'),
      ghost: false, hlt: null, reflect: false, inverse: null, variable: 't',
    }
    const noop = () => null
    const actions = { onRestrict: noop, onGhost: noop, onHlt: noop, onReflect: noop, onShowInverse: noop, onAddInverse: noop, onNotation: noop }
    const builder = text(renderToStaticMarkup(createElement(DomainSection, { panel, actions, notation: 'builder' })))
    expect(builder).toContain('0 < t ≤ 12')
    expect(builder).toContain('(t = 1/2, 1)')
    const interval = renderToStaticMarkup(createElement(DomainSection, { panel, actions, notation: 'interval' }))
    expect(text(interval)).toContain('(0, 12]')
    // the chip that switches to set-builder says t, and so does its hint
    expect(text(interval)).toContain('t ≥')
    expect(interval).toContain('Write as set-builder (t ≥ 0)')
    for (const w of [builder, text(interval)]) expect(w).not.toMatch(/(^|[^A-Za-z])x([^A-Za-z]|$)/)
  })

  it('the Table: its column, its fields and its figure', () => {
    const t = typed(PARK)
    const ctx = { curves: [t.curve], models: t.models, letters: { [t.curve.id]: 'C' }, sources: { [t.curve.id]: PARK } }
    const panel = tablePanel(t.curve, { ev: 'C(2.5)' } as never, ctx)!
    expect(panel.variable).toBe('t')
    expect(panel.summary).toMatch(/^t = /)
    expect(panelFigure(panel, '#fff')!.heads.slice(0, 2)).toEqual(['t', 'C(t)'])
    const actions = new Proxy({}, { get: () => () => null }) as never
    rememberSection('table', true) // drawn open
    const html = renderToStaticMarkup(createElement(TableSection, { panel, actions }))
    expect(html).toContain('<th>t</th>')
    expect(html).toContain('<th>C(t)</th>')
    const words = text(html)
    expect(words).toContain('t from')
    expect(words).not.toContain('x from')
    // a function of x is as it was
    const u = typed('y = x^2')
    const p2 = tablePanel(u.curve, undefined, { curves: [u.curve], models: u.models, letters: { [u.curve.id]: 'f' }, sources: { [u.curve.id]: 'y = x^2' } })!
    expect(p2.variable).toBe('x')
    expect(panelFigure(p2, '#fff')!.heads.slice(0, 2)).toEqual(['x', 'f(x)'])
  })
})

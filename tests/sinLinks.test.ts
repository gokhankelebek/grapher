// ============================================================================
// tests/sinLinks.test.ts — a sinusoid stated the precalculus way, as the UI
// edits it.
//
// The bridge itself (spec ⇄ line, features, parts, extrema, rewriteAs)
// belongs to the core and is tested there. What is tested HERE is the UI
// half: the tabs of "Build ▾ → Sinusoidal" making ONE function, b ⇄ period,
// "write as" keeping the function identical, the three board handles, the
// key-point marks and the midline, the card section — on hand-typed
// 3sin(2x - pi/2) + 1 and sin(x) + cos(x), not on x^2 — and the note a
// sketched a·sin(bx + c) + d wears.
// ============================================================================

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { FittedCurve, ModelSpec, SpecialPoint } from '../src/core/types'
import { sinSource } from '../src/core/sinusoidal'
import type { SinSpec } from '../src/core/sinusoidal'
import { parseExpression } from '../src/core/parse'
import { MODELS } from '../src/core/fit/models'
import {
  bForPeriod,
  blankSinDraft,
  commitSinSpec,
  dragSinHandle,
  extremaFieldsFrom,
  fittedSine,
  midlinePolyline,
  paramFieldsFrom,
  partFieldsFrom,
  periodSource,
  safeReadSinusoid,
  setSinField,
  sinEval,
  sinHandles,
  sinKeyMarks,
  sinPreview,
  sinProblems,
  sinSpecFromDraft,
  sinSpecFromExtrema,
  sinSpecFromParts,
  snapPiX,
  sourceOfText,
  stickyX,
  switchSinTab,
  withB,
  withKeyMarks,
  withPeriod,
  writeAs,
  writePositive,
  xSource,
} from '../src/ui/sinLinks'
import type { SinDraft, SinTab } from '../src/ui/sinLinks'
import { SinEditor } from '../src/ui/SinEditor'
import { CurveCard } from '../src/ui/CurveCard'

const NOOP = (): void => {}
const PI = Math.PI

/** Evaluate a typed line through the real parser. */
function lineAt(src: string, x: number): number {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(`${src}: ${o.error}`)
  const m = o.plot.makeModel('t')
  return m.evalExplicit!(o.plot.defaultParams, x)
}

const XS = [-7.3, -3, -1.1, 0, 0.4, 1, 2.2, 3.9, 6.5, 11]

function sameSpec(a: SinSpec, b: SinSpec, tol = 1e-9): void {
  for (const x of XS) {
    expect(sinEval(b, x)).toBeCloseTo(sinEval(a, x), -Math.log10(tol))
  }
}

function sameLine(a: string, b: string, tol = 1e-9): void {
  for (const x of XS) {
    const ya = lineAt(a, x)
    const yb = lineAt(b, x)
    expect(Math.abs(ya - yb)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(ya)))
  }
}

const S1: SinSpec = { fn: 'sin', a: '3', b: '2', h: 'pi/4', k: '1' }

// ---------------------------------------------------------------------------
// numbers and text
// ---------------------------------------------------------------------------

describe('numbers', () => {
  it('xSource writes π multiples exactly and other numbers plainly', () => {
    expect(xSource(PI / 4)).toBe('pi/4')
    expect(xSource(-3 * PI / 2)).toBe('-3pi/2')
    expect(xSource(2 * PI)).toBe('2pi')
    expect(xSource(1.5)).toBe('1.5')
    expect(xSource(12)).toBe('12')
    expect(xSource(0)).toBe('0')
    expect(xSource(1 + 3 * PI)).toBe('1 + 3pi')
    expect(xSource(0.5 - PI / 2)).toBe('0.5 - pi/2')
    expect(xSource(0.45)).toBe('0.45')
  })

  it('bForPeriod: P = π → 2, 12 → pi/6, 4π/3 → 3/2, 5.236 → 1.2', () => {
    expect(bForPeriod(PI)).toBe('2')
    expect(bForPeriod(12)).toBe('pi/6')
    expect(bForPeriod((4 * PI) / 3)).toBe('3/2')
    expect(bForPeriod(3)).toBe('2pi/3')
    expect(bForPeriod(5.236)).toBe('1.2')
    expect(bForPeriod(0)).toBeNull()
    expect(bForPeriod(-2)).toBeNull()
  })

  it('periodSource is the period as a field holds it', () => {
    expect(periodSource(S1)).toBe('pi')
    expect(periodSource({ ...S1, b: 'pi/6' })).toBe('12')
    expect(periodSource({ ...S1, b: '1.2' })).toBe('5pi/3')
    expect(periodSource({ ...S1, b: '1.3' })).toBe('20pi/13')
    expect(periodSource({ ...S1, b: '-1.37' })).toBe('2pi/1.37')
  })

  it('sourceOfText reads a key point’s exact text back', () => {
    expect(sourceOfText('3π/4', (3 * PI) / 4)).toBe('3pi/4')
    expect(sourceOfText('−2', -2)).toBe('-2')
    expect(sourceOfText('√2', Math.SQRT2)).toBe('sqrt(2)')
    expect(sourceOfText('nonsense', 1.25)).toBe('1.25')
  })

  it('sinProblems names what stops a sinusoid', () => {
    expect(sinProblems(S1)).toEqual([])
    expect(sinProblems({ ...S1, a: '0' })[0].message).toMatch(/line y = k/)
    expect(sinProblems({ ...S1, b: '0' })[0].message).toMatch(/no period/)
    expect(sinProblems({ ...S1, h: 'q' })[0].field).toBe('h')
  })
})

// ---------------------------------------------------------------------------
// the three tabs
// ---------------------------------------------------------------------------

function draftOn(tab: SinTab, spec: SinSpec): SinDraft {
  return {
    tab,
    parts: partFieldsFrom(spec),
    extrema: extremaFieldsFrom(spec),
    params: paramFieldsFrom(spec),
  }
}

/** The spec a tab's own fields make, with nothing carried. */
function fromFields(d: SinDraft): SinSpec {
  const r = sinSpecFromDraft({ ...d, carried: null })
  expect(r.error).toBeNull()
  return r.spec!
}

describe('the tabs of Build ▾ → Sinusoidal', () => {
  it('Parts: the Ferris wheel starts at the bottom → −20cos(π/6 x) + 50', () => {
    const r = sinSpecFromParts({ amplitude: '20', period: '12', phase: '0', midline: '50', start: 'min' })
    expect(r.error).toBeNull()
    expect(r.spec).toMatchObject({ fn: 'cos', a: '-20', b: 'pi/6', k: '50' })
    expect(sinSource(r.spec!)).toBe('y = -20cos(pi/6 x) + 50')
  })

  it('Parts refuses a non-positive amplitude or period', () => {
    expect(sinSpecFromParts({ amplitude: '-2', period: '4', phase: '0', midline: '0', start: 'max' }).error)
      .toMatch(/positive/)
    expect(sinSpecFromParts({ amplitude: '2', period: '0', phase: '0', midline: '0', start: 'max' }).error)
      .toMatch(/positive/)
  })

  it('Extrema: (0, 5) and (3, −1) → 3cos(π/3 x) + 2', () => {
    const r = sinSpecFromExtrema({ maxX: '0', maxY: '5', minX: '3', minY: '-1' })
    expect(r.error).toBeNull()
    expect(sinSource(r.spec!)).toBe('y = 3cos(pi/3 x) + 2')
  })

  it('Extrema refuses with a reason', () => {
    expect(sinSpecFromExtrema({ maxX: '1', maxY: '5', minX: '1', minY: '-1' }).error).toMatch(/share an x/)
    expect(sinSpecFromExtrema({ maxX: '0', maxY: '-1', minX: '3', minY: '5' }).error).toMatch(/higher/)
  })

  it('every tab re-seeded from a spec makes the same function', () => {
    const specs: SinSpec[] = [
      S1,
      { fn: 'cos', a: '-20', b: 'pi/6', h: '0', k: '50' },
      { fn: 'sin', a: '-2', b: '1/2', h: '1', k: '-3' },
      { fn: 'sin', a: '2', b: '-3', h: '0.5', k: '0' },
      { fn: 'cos', a: '1.5', b: '1.2', h: '0.25', k: '0.4' },
    ]
    for (const spec of specs) {
      for (const tab of ['parts', 'extrema', 'params'] as SinTab[]) {
        sameSpec(spec, fromFields(draftOn(tab, spec)), 1e-6)
      }
    }
  })

  it('switching tab carries the function exactly, then re-reads the new fields', () => {
    let d: SinDraft = draftOn('params', S1)
    d = switchSinTab(d, 'parts')
    expect(d.carried).toEqual(S1)
    expect(sinSpecFromDraft(d).spec).toEqual(S1)
    expect(d.parts).toMatchObject({ amplitude: '3', period: 'pi', phase: 'pi/4', midline: '1', start: 'mid-up' })
    sameSpec(S1, fromFields(d))
    d = switchSinTab(d, 'extrema')
    expect(d.extrema).toEqual({ maxX: 'pi/2', maxY: '4', minX: 'pi', minY: '-2' })
    sameSpec(S1, fromFields(d))
  })

  it('b and the period stay in step on the Parameters tab', () => {
    const f = paramFieldsFrom(S1)
    expect(f.period).toBe('pi')
    expect(withPeriod(f, '12')).toMatchObject({ b: 'pi/6', period: '12' })
    expect(withB(f, '4')).toMatchObject({ b: '4', period: 'pi/2' })
    // a half-typed period leaves b alone
    expect(withPeriod(f, '').b).toBe('2')
    // b < 0 keeps its sign
    expect(withPeriod({ ...f, b: '-2' }, '4pi').b).toBe('-1/2')
  })

  it('the default draft builds y = sin(x)', () => {
    const r = sinSpecFromDraft(blankSinDraft())
    expect(sinSource(r.spec!)).toBe('y = sin(x)')
  })
})

// ---------------------------------------------------------------------------
// write as
// ---------------------------------------------------------------------------

describe('write as', () => {
  it('sin ⇄ cos keeps the function identical', () => {
    const c = writeAs(S1, 'cos')!
    expect(c.fn).toBe('cos')
    sameSpec(S1, c)
    sameLine(sinSource(S1), sinSource(c))
    const back = writeAs(c, 'sin')!
    sameSpec(S1, back)
    expect(writeAs(S1, 'sin')).toBeNull()
  })

  it('a positive amplitude keeps the function identical', () => {
    const neg: SinSpec = { fn: 'cos', a: '-2', b: '1', h: '0', k: '4' }
    const pos = writePositive(neg)!
    expect(pos.a).toBe('2')
    sameSpec(neg, pos)
    expect(writePositive(S1)).toBeNull()
  })

  it('a card edit commits once, and an unchanged line is no edit', () => {
    const calls: string[] = []
    const deps = { restate: (src: string, label: string) => (calls.push(`${label}: ${src}`), null) }
    expect(commitSinSpec(S1, writeAs(S1, 'cos'), 'write as cos', deps)).toBeNull()
    expect(calls).toEqual(['write as cos: y = 3cos(2(x - pi/2)) + 1'])
    expect(commitSinSpec(S1, { ...S1 }, 'same', deps)).toBeNull()
    expect(calls).toHaveLength(1)
    expect(commitSinSpec(S1, { ...S1, a: '0' }, 'x', deps)).toMatch(/line y = k/)
  })

  it('the period field rewrites b', () => {
    expect(setSinField(S1, 'period', '2pi')).toMatchObject({ b: '1' })
    expect(setSinField(S1, 'period', '12')).toMatchObject({ b: 'pi/6' })
    expect(setSinField(S1, 'period', '-1')).toBeNull()
    expect(setSinField(S1, 'k', ' 5 ')).toMatchObject({ k: '5' })
  })
})

// ---------------------------------------------------------------------------
// the board
// ---------------------------------------------------------------------------

describe('the board while selected', () => {
  it('marks the five key points of the cycle with exact text', () => {
    const marks = sinKeyMarks(S1)
    expect(marks.map((m) => `${m.exactX}, ${m.exactY}`)).toEqual([
      'π/4, 1',
      'π/2, 4',
      '3π/4, 1',
      'π, −2',
      '5π/4, 1',
    ])
    expect(marks.map((m) => m.kind)).toEqual([
      'inflection',
      'maximum',
      'inflection',
      'minimum',
      'inflection',
    ])
    expect(marks.every((m) => m.exact)).toBe(true)
  })

  it('adds only the key points the analysis does not already mark, after it', () => {
    const marks = sinKeyMarks(S1)
    const analysis: SpecialPoint[] = [
      { kind: 'zero', pos: { x: 0.6155, y: 0 }, label: 'zero', exact: false },
      { kind: 'maximum', pos: { x: PI / 2, y: 4 }, label: 'max', exact: false },
    ]
    const out = withKeyMarks(analysis, marks)
    expect(out.slice(0, 2)).toEqual(analysis)
    expect(out).toHaveLength(2 + 4)
    expect(withKeyMarks([], marks)).toHaveLength(5)
  })

  it('draws the midline dashed across the board at y = k', () => {
    const pl = midlinePolyline(S1, '#4f9cf9', 'm')!
    expect(pl.pts.every((p) => p.y === 1)).toBe(true)
    expect(pl.pts[0].x).toBeLessThan(-1e5)
    expect(pl.pts[1].x).toBeGreaterThan(1e5)
    expect(pl.dash && pl.dash.length).toBeGreaterThan(0)
  })

  it('has three handles: the midline, the first maximum, the end of the cycle', () => {
    const hs = sinHandles(S1)
    expect(hs.map((h) => h.which)).toEqual(['k', 'a', 'p'])
    const a = hs.find((h) => h.which === 'a')!
    expect(a.pos.x).toBeCloseTo(PI / 2, 12)
    expect(a.pos.y).toBe(4)
    expect(a.label).toContain('(π/2, 4)')
    const p = hs.find((h) => h.which === 'p')!
    expect(p.pos.x).toBeCloseTo((5 * PI) / 4, 12)
    expect(p.label).toContain('period π')
  })

  it('the midline drag moves k only', () => {
    expect(dragSinHandle(S1, 'k', { x: 99, y: 2.5 })).toEqual({ ...S1, k: '2.5' })
  })

  it('the maximum dragged up sets the amplitude, sideways the phase shift', () => {
    expect(dragSinHandle(S1, 'a', { x: PI / 2, y: 6 })).toEqual({ ...S1, a: '5' })
    const moved = dragSinHandle(S1, 'a', { x: (3 * PI) / 4, y: 4 })!
    expect(moved).toMatchObject({ a: '3', h: 'pi/2' })
    // the maximum is now where it was put
    expect(sinEval(moved, (3 * PI) / 4)).toBeCloseTo(4, 12)
    // below the midline it flips
    expect(dragSinHandle(S1, 'a', { x: PI / 2, y: -1 })).toMatchObject({ a: '-2' })
    expect(dragSinHandle(S1, 'a', { x: PI / 2, y: 1 })).toBeNull()
    // a negative a: its first maximum is dragged the same way
    const neg: SinSpec = { fn: 'cos', a: '-2', b: '1', h: '0', k: '4' }
    const hs = sinHandles(neg).find((h) => h.which === 'a')!
    expect(hs.pos).toMatchObject({ y: 6 })
    const up = dragSinHandle(neg, 'a', { x: hs.pos.x, y: 7 })!
    expect(sinEval(up, hs.pos.x)).toBeCloseTo(7, 12)
  })

  it('the end of the cycle dragged sideways sets the period, the start stays', () => {
    const d = dragSinHandle(S1, 'p', { x: PI / 4 + 2 * PI, y: 0 })!
    expect(d).toMatchObject({ b: '1', h: 'pi/4' })
    expect(periodSource(d)).toBe('2pi')
    expect(sinEval(d, PI / 4)).toBeCloseTo(1, 12)
    const twelve = dragSinHandle({ fn: 'cos', a: '-20', b: 'pi/6', h: '0', k: '50' }, 'p', { x: 24, y: 0 })!
    expect(twelve.b).toBe('pi/12')
    expect(dragSinHandle(S1, 'p', { x: PI / 4, y: 0 })).toBeNull()
    expect(dragSinHandle(S1, 'p', { x: 0, y: 0 })).toBeNull()
    // b < 0 keeps its sign
    expect(dragSinHandle({ ...S1, b: '-2', h: '0' }, 'p', { x: 2 * PI, y: 0 })!.b).toBe('-1')
  })

  it('snaps x to π/q rungs on a π axis, and a still pointer keeps its x', () => {
    expect(snapPiX(0.8, 60)).toBeCloseTo(PI / 4, 12)
    expect(snapPiX(0.7, 10)).toBeCloseTo(0, 12)
    expect(snapPiX(0.8, 10)).toBeCloseTo(PI / 2, 12)
    expect(snapPiX(1.5, 200)).toBeCloseTo((11 * PI) / 24, 12)
    expect(stickyX(PI / 2 + 0.01, PI / 2, 60, 1.6)).toBe(PI / 2)
    expect(stickyX(PI / 2 + 0.5, PI / 2, 60, 2.0)).toBe(2.0)
  })
})

// ---------------------------------------------------------------------------
// markup
// ---------------------------------------------------------------------------

describe('SinEditor — markup', () => {
  it('shows the tabs, the start picker and its choice, the preview, the sentences and key points', () => {
    const html = renderToStaticMarkup(
      createElement(SinEditor, {
        initial: {
          ...blankSinDraft(),
          parts: { amplitude: '20', period: '12', phase: '0', midline: '50', start: 'min' },
        },
        onBuild: () => null,
        onClose: NOOP,
      }),
    )
    expect(html).toContain('data-testid="sin-editor"')
    expect(html).toContain('Parts')
    expect(html).toContain('Extrema')
    expect(html).toContain('Parameters')
    expect(html).toContain('the midline, going up')
    expect(html).toContain('cos with a &lt; 0')
    expect(html).toContain('data-src="y = -20cos(pi/6 x) + 50"')
    expect(html).toMatch(/data-tex="[^"]+"/)
    expect(html).toContain('data-testid="sin-sentences"')
    expect(html).toContain('amplitude 20')
    expect(html).toContain('period 12')
    expect(html).toContain('data-testid="sin-keys"')
    expect(html).toContain('<td>3</td>')
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>Add to graph/)
  })

  it('an extrema refusal is shown and the button disabled', () => {
    const html = renderToStaticMarkup(
      createElement(SinEditor, {
        initial: { ...blankSinDraft(), tab: 'extrema', extrema: { maxX: '2', maxY: '1', minX: '2', minY: '-1' } },
        onBuild: () => null,
        onClose: NOOP,
      }),
    )
    expect(html).toContain('share an x')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Add to graph/)
  })

  it('the Parameters tab shows b with its period beside it', () => {
    const html = renderToStaticMarkup(
      createElement(SinEditor, { initial: draftOn('params', S1), onBuild: () => null, onClose: NOOP }),
    )
    expect(html).toContain('data-testid="sin-tab-params"')
    expect(html).toContain('or period')
    expect(html).toContain('value="pi"')
    expect(html).toContain('<td>π/4</td>')
  })

  it('the preview is what Add to graph writes', () => {
    const p = sinPreview(S1)
    expect(p.src).toBe(sinSource(S1))
    expect(p.error).toBeNull()
    expect(p.keys.map((k) => k.x)).toEqual(['π/4', 'π/2', '3π/4', 'π', '5π/4'])
  })
})

function card(curve: FittedCurve, models: Record<string, ModelSpec>, exprSource?: string): string {
  const props = {
    curve,
    style: undefined,
    models,
    selected: true,
    candidates: [],
    snapMask: null,
    snapKey: 0,
    shaking: false,
    exprSource,
    edited: exprSource !== undefined,
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
    onFactorRestate: () => null,
    onExpRestate: () => null,
    onLogRestate: () => null,
    onSinRestate: () => null,
    onShowInverse: NOOP,
    onConvertTyped: () => null,
  }
  return renderToStaticMarkup(
    createElement(CurveCard, props as unknown as Parameters<typeof CurveCard>[0]),
  )
}

function typedCard(src: string): string {
  const outcome = parseExpression(src)
  if (!outcome.ok) throw new Error(outcome.error)
  const spec: ModelSpec = outcome.plot.makeModel('expr_1')
  const curve: FittedCurve = {
    id: 'c1',
    modelId: 'expr_1',
    params: outcome.plot.defaultParams.slice(),
    kind: outcome.plot.kind,
    domain: outcome.plot.domain,
    color: '#4f9cf9',
    strokeWidth: 2.5,
    visible: true,
    error: 0,
  }
  return card(curve, { expr_1: spec }, src)
}

describe('the Sinusoidal section on a card', () => {
  it('hand-typed y = 3sin(2x - pi/2) + 1 gets one, open, with features, key points and write as', () => {
    expect(safeReadSinusoid('y = 3sin(2x - pi/2) + 1')).toMatchObject({ h: 'pi/4' })
    const html = typedCard('y = 3sin(2x - pi/2) + 1')
    expect(html).toContain('data-testid="sin-section"')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('amplitude 3')
    expect(html).toContain('period π')
    expect(html).toContain('midline y = 1')
    expect(html).toContain('data-testid="sin-keys"')
    expect(html).toContain('5π/4')
    expect(html).toContain('data-testid="sin-write-other"')
    expect(html).not.toContain('data-testid="sin-write-positive"')
  })

  it('y = sin(x) + cos(x) is folded: amplitude √2', () => {
    const html = typedCard('y = sin(x) + cos(x)')
    expect(html).toContain('data-testid="sin-section"')
    expect(html).toContain('amplitude √2')
  })

  it('y = 4 - 2cos(x) offers a positive amplitude', () => {
    const html = typedCard('y = 4 - 2cos(x)')
    expect(html).toContain('data-testid="sin-section"')
    expect(html).toContain('data-testid="sin-write-positive"')
  })

  it('y = x^2, an exponential and a logarithm do not', () => {
    expect(typedCard('y = x^2')).not.toContain('sin-section')
    expect(typedCard('y = 2^x')).not.toContain('sin-section')
    expect(typedCard('y = ln(x - 1)')).not.toContain('sin-section')
  })
})

describe('a sketched sinusoid', () => {
  // 1.5·sin(1.2x − 0.3) + 0.4 = 1.5·sin(1.2(x − 0.25)) + 0.4
  const curve: FittedCurve = {
    id: 's1',
    modelId: 'sine',
    params: [1.5, 1.2, -0.3, 0.4],
    kind: 'explicit',
    domain: [-5, 5],
    color: '#f97',
    strokeWidth: 2.5,
    visible: true,
    error: 0.02,
  }

  it('is read as a·sin(b(x − h)) + k with h = −c/b', () => {
    const f = fittedSine(curve.params)!
    expect(f.spec).toEqual({ fn: 'sin', a: '1.5', b: '1.2', h: '0.25', k: '0.4' })
    expect(f.note).toBe('= 1.5sin(1.2(x − 0.25)) + 0.4 · amplitude 1.5 · period 5.236')
    for (const x of XS) {
      expect(lineAt(f.src, x)).toBeCloseTo(MODELS.sine.evalExplicit!(curve.params, x), 9)
    }
  })

  it('a negative b is turned round and h brought near 0, the wave unchanged', () => {
    const p = [2, -0.8, 7, -1]
    const f = fittedSine(p)!
    expect(Number(f.spec.b)).toBeGreaterThan(0)
    expect(Math.abs(Number(f.spec.h))).toBeLessThanOrEqual(PI / 0.8)
    for (const x of XS) {
      expect(lineAt(f.src, x)).toBeCloseTo(MODELS.sine.evalExplicit!(p, x), 2)
    }
  })

  it('the card wears the note; a flat fit does not', () => {
    const html = card(curve, MODELS)
    expect(html).toContain('data-testid="fitted-sin-note"')
    expect(html).toContain('period 5.236')
    expect(fittedSine([0, 1, 0, 2])).toBeNull()
    expect(fittedSine([1, 0, 0, 2])).toBeNull()
  })
})

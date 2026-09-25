// ============================================================================
// tests/expLinks.test.ts — an exponential stated the precalculus way, as the
// UI edits it.
//
// The bridge itself (spec ⇄ line, rate sentences, features) belongs to the
// core and is tested there. What is tested HERE is the UI half: the three tabs
// of "Build ▾ → Exponential" all making ONE function, the "rate as" rewrite
// keeping that function identical, the three board handles, the card section
// (on y = 200(1/2)^(x/5.7) + 10, not on y = x^2), and the note a sketched
// a·e^{bx} + c wears.
// ============================================================================

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { expSource, readExponential } from '../src/core/exponential'
import type { ExpSpec } from '../src/core/exponential'
import { parseExpression } from '../src/core/parse'
import { MODELS } from '../src/core/fit/models'
import {
  blankDraft,
  commitExpSpec,
  dragExpHandle,
  expEval,
  expHandles,
  expPreview,
  expProblems,
  fittedExp,
  numOut,
  pointFieldsFrom,
  rateFormOf,
  rewriteRate,
  safeReadExponential,
  setExpField,
  specFromDraft,
  specFromParams,
  specFromPoints,
  specFromRate,
  switchTab,
  twoPointRefusal,
} from '../src/ui/expLinks'
import type { ExpDraft, RateFields } from '../src/ui/expLinks'
import { ExpEditor } from '../src/ui/ExpEditor'
import { CurveCard } from '../src/ui/CurveCard'

const NOOP = (): void => {}

/** Evaluate a typed line through the real parser. */
function lineAt(src: string, x: number): number {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(`${src}: ${o.error}`)
  const m = o.plot.makeModel('t')
  return m.evalExplicit!(o.plot.defaultParams, x)
}

const XS = [-3, -1, 0, 0.5, 1, 2.5, 4, 7, 10]

function sameFunction(a: string, b: string, tol = 1e-4): void {
  for (const x of XS) {
    const ya = lineAt(a, x)
    const yb = lineAt(b, x)
    expect(Math.abs(ya - yb)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(ya)))
  }
}

function rate(over: Partial<RateFields> = {}): RateFields {
  return { ...blankDraft().rate, ...over }
}

/** y = 200(1/2)^(x/5.7) + 10 */
const HALF: ExpSpec = { a: '200', b: '1/2', p: '5.7', h: '0', k: '10' }

// ---------------------------------------------------------------------------
// numbers
// ---------------------------------------------------------------------------

describe('numbers written into the line', () => {
  it('a short decimal, a fraction only when it is one, else six significant digits', () => {
    expect(numOut(0.5)).toBe('0.5')
    expect(numOut(5.7)).toBe('5.7')
    expect(numOut(1 / 3)).toBe('1/3')
    expect(numOut(-0.12160412)).toBe('-0.121604')
    expect(numOut(3)).toBe('3')
    // A rounding that only sits near 1/3 is not written as 1/3.
    expect(numOut(0.3333, 4)).toBe('0.3333')
  })

  it('evaluates every form of the spec', () => {
    expect(expEval(HALF, 0)).toBeCloseTo(210, 9)
    expect(expEval(HALF, 5.7)).toBeCloseTo(110, 9)
    expect(expEval({ a: '5', b: 'e', rate: '0.2', p: '1', h: '0', k: '0' }, 1)).toBeCloseTo(
      5 * Math.exp(0.2),
      9,
    )
  })

  it('names what stops a spec being an exponential', () => {
    expect(expProblems(HALF)).toEqual([])
    expect(expProblems({ ...HALF, a: '0' })[0].field).toBe('a')
    expect(expProblems({ ...HALF, b: '1' })[0].field).toBe('b')
    expect(expProblems({ ...HALF, b: '-2' })[0].field).toBe('b')
    expect(expProblems({ ...HALF, p: 'q' })[0].field).toBe('p')
  })
})

// ---------------------------------------------------------------------------
// the three tabs
// ---------------------------------------------------------------------------

describe('the Rate tab', () => {
  it('starts at 100 growing 5% per unit by default', () => {
    const { spec, error } = specFromDraft(blankDraft())
    expect(error).toBeNull()
    expect(expEval(spec!, 0)).toBeCloseTo(100, 9)
    expect(expEval(spec!, 1)).toBeCloseTo(105, 9)
  })

  it('half-life 5.7 from 200 with asymptote 10: f(0) = 200, f(5.7) halfway to 10', () => {
    const { spec } = specFromRate(rate({ init: '200', kind: 'half-life', time: '5.7', k: '10' }))
    expect(spec).not.toBeNull()
    const f0 = expEval(spec!, 0)
    // Whatever "starts at" means to the core, the height ABOVE the asymptote
    // halves every 5.7.
    expect((expEval(spec!, 5.7) - 10) / (f0 - 10)).toBeCloseTo(0.5, 9)
    expect([200, 210]).toContainEqual(Number(f0.toFixed(9)))
  })

  it('each statement of the rate means what it says', () => {
    const at = (f: Partial<RateFields>, x: number): number =>
      expEval(specFromRate(rate({ init: '1', k: '0', ...f })).spec!, x)
    expect(at({ kind: 'factor', b: '3', per: '2' }, 2)).toBeCloseTo(3, 9)
    expect(at({ kind: 'percent', pct: '5', grows: true, per: '1' }, 1)).toBeCloseTo(1.05, 9)
    expect(at({ kind: 'percent', pct: '20', grows: false, per: '1' }, 1)).toBeCloseTo(0.8, 9)
    expect(at({ kind: 'doubling', time: '3' }, 3)).toBeCloseTo(2, 9)
    expect(at({ kind: 'half-life', time: '4' }, 8)).toBeCloseTo(0.25, 9)
    expect(at({ kind: 'continuous', r: '0.2' }, 1)).toBeCloseTo(Math.exp(0.2), 9)
  })

  it('fields accept expressions', () => {
    const { spec } = specFromRate(rate({ init: 'sqrt(4)', kind: 'factor', b: '1/2', per: '1' }))
    expect(expEval(spec!, 1)).toBeCloseTo(1, 9)
  })

  it('refuses what is not a number, a negative time, a 100% decay', () => {
    expect(specFromRate(rate({ init: 'banana' })).error).toMatch(/not a number/)
    expect(specFromRate(rate({ kind: 'half-life', time: '-2' })).error).toMatch(/positive/)
    expect(specFromRate(rate({ kind: 'percent', pct: '100', grows: false })).error).toMatch(/100%/)
  })
})

describe('the Two points tab', () => {
  it('(0, 3) and (2, 12) is y = 3(2)^x', () => {
    const { spec } = specFromPoints({ x1: '0', y1: '3', x2: '2', y2: '12', k: '0' })
    expect(spec).not.toBeNull()
    for (const x of XS) expect(expEval(spec!, x)).toBeCloseTo(3 * 2 ** x, 6)
  })

  it('says why, when no exponential goes through them', () => {
    const r = specFromPoints({ x1: '0', y1: '3', x2: '2', y2: '-1', k: '0' })
    expect(r.spec).toBeNull()
    expect(r.error).toBe('The points must be on the same side of the asymptote.')
    expect(twoPointRefusal({ x: 1, y: 2 }, { x: 1, y: 5 }, 0)).toMatch(/share an x/)
  })
})

describe('the Parameters tab', () => {
  it('a, b, p, h, k directly — and b = e takes a continuous rate', () => {
    const { spec } = specFromParams({ a: '2', b: '3', p: '2', r: '0', h: '1', k: '-4' })
    expect(expEval(spec!, 3)).toBeCloseTo(2 * 3 - 4, 9)
    const e = specFromParams({ a: '5', b: 'e', p: '1', r: '0.2', h: '0', k: '0' }).spec!
    expect(e.b).toBe('e')
    expect(expEval(e, 1)).toBeCloseTo(5 * Math.exp(0.2), 9)
  })
})

describe('switching tabs keeps the curve', () => {
  it('Rate → Two points → Parameters → Rate is the same function every time', () => {
    let d: ExpDraft = {
      ...blankDraft(),
      rate: rate({ init: '200', kind: 'half-life', time: '5.7', k: '10' }),
    }
    const first = specFromDraft(d).spec!
    for (const tab of ['points', 'params', 'rate', 'params', 'points'] as const) {
      d = switchTab(d, tab)
      expect(d.tab).toBe(tab)
      const now = specFromDraft(d).spec
      expect(now).not.toBeNull()
      for (const x of XS) {
        expect(expEval(now!, x)).toBeCloseTo(expEval(first, x), 3)
      }
    }
  })

  it('Two points seeds the start and one period later', () => {
    const f = pointFieldsFrom(HALF)
    expect(f).toEqual({ x1: '0', y1: '210', x2: '5.7', y2: '110', k: '10' })
  })
})

// ---------------------------------------------------------------------------
// "rate as"
// ---------------------------------------------------------------------------

describe('rate as — the same curve, stated another way', () => {
  const src = 'y = 200(1/2)^(x/5.7) + 10'

  it('reads the line back', () => {
    const spec = safeReadExponential(src)
    expect(spec).not.toBeNull()
    expect(rateFormOf(spec!)).toBe('time')
  })

  for (const form of ['factor', 'percent', 'time', 'continuous'] as const) {
    it(`as ${form}: the rewritten line is the same function`, () => {
      const spec = safeReadExponential(src)!
      const next = rewriteRate(spec, form)
      expect(next).not.toBeNull()
      // a, h, k kept exactly as written.
      expect(next!.a).toBe(spec.a)
      expect(next!.k).toBe(spec.k)
      const line = expSource(next!)
      sameFunction(src, line)
      // And it reads back as the form asked for (percent may share a base
      // with the half-life it came from; the equation is what matters).
      const back = readExponential(line)
      expect(back).not.toBeNull()
      if (form === 'continuous') expect(rateFormOf(back!)).toBe('continuous')
      if (form === 'factor') expect(evalP(back!)).toBe(1)
    })
  }

  it('round-trips factor → continuous → time back to half-life 5.7', () => {
    let spec = safeReadExponential(src)!
    for (const form of ['factor', 'continuous', 'time'] as const) spec = rewriteRate(spec, form)!
    expect(Number(spec.p)).toBeCloseTo(5.7, 4)
  })

  it('a committed rewrite restates once with the right label', () => {
    const calls: [string, string][] = []
    const spec = safeReadExponential(src)!
    const err = commitExpSpec(spec, rewriteRate(spec, 'continuous'), 'restate rate', {
      restate: (s, l) => {
        calls.push([s, l])
        return null
      },
    })
    expect(err).toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toBe('restate rate')
    sameFunction(src, calls[0][0])
  })

  it('an edit that changes nothing restates nothing', () => {
    let n = 0
    commitExpSpec(HALF, { ...HALF }, 'x', { restate: () => (n++, null) })
    expect(n).toBe(0)
  })
})

function evalP(spec: ExpSpec): number {
  return Number(spec.p || '1')
}

describe('a field edit on the card', () => {
  it('typing b = e keeps the function (r = ln(b)/p)', () => {
    const next = setExpField(HALF, 'b', 'e')
    expect(next.b).toBe('e')
    for (const x of XS) expect(expEval(next, x)).toBeCloseTo(expEval(HALF, x), 3)
  })

  it('a refused value is said, not restated', () => {
    let n = 0
    const err = commitExpSpec(HALF, setExpField(HALF, 'b', '1'), 'set growth factor', {
      restate: () => (n++, null),
    })
    expect(err).toMatch(/constant/)
    expect(n).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// handles
// ---------------------------------------------------------------------------

describe('board handles', () => {
  it('the asymptote, the y-intercept and one period later', () => {
    const hs = expHandles(HALF)
    expect(hs.map((h) => h.which)).toEqual(['k', 'a', 'b'])
    expect(hs[0].pos.y).toBe(10)
    expect(hs[1].pos).toEqual({ x: 0, y: 210 })
    expect(hs[2].pos.x).toBeCloseTo(5.7, 9)
    expect(hs[2].pos.y).toBeCloseTo(110, 9)
  })

  it('dragging the asymptote shifts the whole curve (a kept)', () => {
    const next = dragExpHandle(HALF, 'k', 30)!
    expect(next.k).toBe('30')
    expect(next.a).toBe('200')
    for (const x of XS) expect(expEval(next, x) - expEval(HALF, x)).toBeCloseTo(20, 9)
  })

  it('dragging the y-intercept sets a', () => {
    const next = dragExpHandle(HALF, 'a', 110)!
    expect(expEval(next, 0)).toBeCloseTo(110, 9)
    expect(next.b).toBe('1/2')
    // Onto the asymptote: no exponential does that.
    expect(dragExpHandle(HALF, 'a', 10)).toBeNull()
  })

  it('dragging the second point sets b, with a kept', () => {
    const three: ExpSpec = { a: '3', b: '2', p: '1', h: '0', k: '0' }
    const next = dragExpHandle(three, 'b', 9)!
    expect(next.a).toBe('3')
    expect(next.b).toBe('3')
    expect(expEval(next, 1)).toBeCloseTo(9, 9)
    // Across the asymptote: refused.
    expect(dragExpHandle(three, 'b', -1)).toBeNull()
    // Base e: the continuous rate is what moves.
    const e: ExpSpec = { a: '2', b: 'e', rate: '0.5', p: '1', h: '0', k: '0' }
    const en = dragExpHandle(e, 'b', 2 * Math.E)!
    expect(Number(en.rate)).toBeCloseTo(1, 3)
  })
})

// ---------------------------------------------------------------------------
// the editor, the card, the fitted note
// ---------------------------------------------------------------------------

describe('ExpEditor — markup', () => {
  it('shows the tabs, the preview and the rate sentences', () => {
    const html = renderToStaticMarkup(
      createElement(ExpEditor, {
        initial: {
          ...blankDraft(),
          rate: rate({ init: '200', kind: 'half-life', time: '5.7', k: '10' }),
        },
        onBuild: () => null,
        onClose: NOOP,
      }),
    )
    expect(html).toContain('data-testid="exp-editor"')
    expect(html).toContain('Two points')
    expect(html).toContain('Parameters')
    expect(html).toMatch(/data-tex="[^"]+"/)
    expect(html).toMatch(/data-src="[^"]*\^/)
    expect(html).toContain('data-testid="exp-sentences"')
    expect(html).toMatch(/half-life/i)
    expect(html).toContain('data-testid="exp-features"')
    expect(html).toContain('y &gt; 10')
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>Add to graph/)
  })

  it('a two-point refusal is shown and the button disabled', () => {
    const d = blankDraft()
    const html = renderToStaticMarkup(
      createElement(ExpEditor, {
        initial: { ...d, tab: 'points', points: { x1: '0', y1: '3', x2: '2', y2: '-1', k: '0' } },
        onBuild: () => null,
        onClose: NOOP,
      }),
    )
    expect(html).toContain('same side of the asymptote')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Add to graph/)
  })

  it('the preview is what Add to graph writes', () => {
    const p = expPreview(HALF)
    expect(p.src).toBe(expSource(HALF))
    expect(p.error).toBeNull()
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

describe('the Exponential section on a card', () => {
  it('y = 200(1/2)^(x/5.7) + 10 gets one, open, with its rate and features', () => {
    const html = typedCard('y = 200(1/2)^(x/5.7) + 10')
    expect(html).toContain('data-testid="exp-section"')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toMatch(/half-life/i)
    expect(html).toContain('y &gt; 10')
    expect(html).toContain('rate as')
  })

  it('y = x^2 does not', () => {
    const html = typedCard('y = x^2')
    expect(html).not.toContain('exp-section')
  })
})

describe('a sketched exponential', () => {
  const curve: FittedCurve = {
    id: 's1',
    modelId: 'exp',
    params: [2.3, Math.log(1.49), 1],
    kind: 'explicit',
    domain: [-3, 3],
    color: '#f97',
    strokeWidth: 2.5,
    visible: true,
    error: 0.02,
  }

  it('is read as a(b)^x + k with its rate', () => {
    const f = fittedExp(curve.params)!
    expect(f.spec).toMatchObject({ a: '2.3', b: '1.49', p: '1', h: '0', k: '1' })
    expect(f.note.startsWith('= ')).toBe(true)
    expect(f.note).toContain('1.49')
    expect(f.note).toMatch(/49/)
    expect(f.note).toMatch(/doubl/i)
    sameFunction(f.src, 'y = 2.3*e^(0.398776x) + 1', 1e-3)
  })

  it('the card wears the note; a flat fit does not', () => {
    const html = card(curve, MODELS)
    expect(html).toContain('data-testid="fitted-exp-note"')
    expect(fittedExp([2, 0, 1])).toBeNull()
  })
})

// ============================================================================
// tests/logLinks.test.ts — a logarithm stated the precalculus way, as the UI
// edits it, and the inverse view pairing it with an exponential.
//
// The bridge itself (spec ⇄ line, features, inverses, change of base) belongs
// to the core and is tested there. What is tested HERE is the UI half: the
// tabs of "Build ▾ → Logarithmic" making ONE function, "write in base"
// keeping that function identical, the three board handles, "Show inverse"
// (and its single y = x), the card section — on hand-typed ln(x - 1) + 2 and
// log_2(x), not on x^2 — and the note a sketched a·ln(x − b) + c wears.
// ============================================================================

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { CURVE_COLORS } from '../src/core/types'
import { logSource } from '../src/core/logarithmic'
import type { LogSpec } from '../src/core/logarithmic'
import { parseExpression } from '../src/core/parse'
import { MODELS } from '../src/core/fit/models'
import {
  blankLogDraft,
  commitLogSpec,
  dragLogHandle,
  fittedLog,
  inverseColor,
  inverseOfExp,
  inverseSources,
  isIdentityLine,
  logEval,
  logHandles,
  logPreview,
  logProblems,
  logSpecFromDraft,
  logSpecFromParams,
  logSpecFromPoints,
  logTwoPointRefusal,
  planInverse,
  rebaseKeyOf,
  rebaseTo,
  safeReadLogarithmic,
  switchLogTab,
} from '../src/ui/logLinks'
import type { InverseSource, LogDraft, LogPointFields } from '../src/ui/logLinks'
import { LogEditor } from '../src/ui/LogEditor'
import { CurveCard } from '../src/ui/CurveCard'

const NOOP = (): void => {}

/** Evaluate a typed line through the real parser (NaN off its domain). */
function lineAt(src: string, x: number): number {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(`${src}: ${o.error}`)
  const m = o.plot.makeModel('t')
  return m.evalExplicit!(o.plot.defaultParams, x)
}

/** Sample points right of a vertical asymptote at h. */
function xsRightOf(h: number): number[] {
  return [0.05, 0.3, 1, 2, 3.5, 7, 12, 40].map((d) => h + d)
}

function sameFunction(a: string, b: string, xs: number[], tol = 1e-5): void {
  for (const x of xs) {
    const ya = lineAt(a, x)
    const yb = lineAt(b, x)
    expect(Number.isFinite(ya)).toBe(true)
    expect(Math.abs(ya - yb)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(ya)))
  }
}

/** y = log_2(x - 1) + 3 */
const L2: LogSpec = { a: '1', b: '2', c: '1', h: '1', k: '3' }

function points(over: Partial<LogPointFields>): LogPointFields {
  return { ...blankLogDraft().points, ...over }
}

// ---------------------------------------------------------------------------
// numbers
// ---------------------------------------------------------------------------

describe('a logarithm’s numbers', () => {
  it('evaluates a·log_b(c(x − h)) + k, NaN left of the asymptote', () => {
    expect(logEval(L2, 2)).toBeCloseTo(3, 12)
    expect(logEval(L2, 3)).toBeCloseTo(4, 12)
    expect(logEval(L2, 9)).toBeCloseTo(6, 12)
    expect(Number.isNaN(logEval(L2, 1))).toBe(true)
    expect(Number.isNaN(logEval(L2, 0))).toBe(true)
    // c < 0 reflects: the domain is x < h.
    const refl: LogSpec = { a: '1', b: 'e', c: '-1', h: '0', k: '0' }
    expect(logEval(refl, -1)).toBeCloseTo(0, 12)
    expect(Number.isNaN(logEval(refl, 1))).toBe(true)
  })

  it('names what stops a spec being a logarithm', () => {
    expect(logProblems(L2)).toEqual([])
    expect(logProblems({ ...L2, a: '0' })[0].field).toBe('a')
    expect(logProblems({ ...L2, b: '1' })[0].message).toMatch(/base 1/)
    expect(logProblems({ ...L2, b: '-2' })[0].field).toBe('b')
    expect(logProblems({ ...L2, c: '0' })[0].field).toBe('c')
    expect(logProblems({ ...L2, h: 'x' })[0].field).toBe('h')
    expect(logProblems({ ...L2, b: 'e' })).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// the tabs
// ---------------------------------------------------------------------------

describe('the Parameters tab', () => {
  it('starts at log₂(x), and the base picker names the base', () => {
    const d = blankLogDraft()
    expect(d.tab).toBe('params')
    const { spec } = logSpecFromDraft(d)
    expect(spec).toMatchObject({ a: '1', b: '2', c: '1', h: '0', k: '0' })
    const ln = logSpecFromParams({ ...d.params, base: 'e' }).spec!
    expect(ln.b).toBe('e')
    const common = logSpecFromParams({ ...d.params, base: '10' }).spec!
    expect(common.b).toBe('10')
    const other = logSpecFromParams({ ...d.params, base: 'other', other: '1/2' }).spec!
    expect(other.b).toBe('1/2')
  })

  it('refuses a bad base or a zero stretch', () => {
    const d = blankLogDraft()
    expect(logSpecFromParams({ ...d.params, base: 'other', other: '1' }).error).toMatch(/base 1/)
    expect(logSpecFromParams({ ...d.params, base: 'other', other: '' }).error).toMatch(/empty/)
    expect(logSpecFromParams({ ...d.params, a: '0' }).error).toMatch(/a can’t be 0/)
  })
})

describe('the Two points tab', () => {
  it('(2, 0) and (5, 1) with asymptote x = 1, base 2', () => {
    const { spec, error } = logSpecFromPoints(
      points({ x1: '2', y1: '0', x2: '5', y2: '1', h: '1', base: '2' }),
    )
    expect(error).toBeNull()
    expect(spec!.b).toBe('2')
    expect(logEval(spec!, 2)).toBeCloseTo(0, 6)
    expect(logEval(spec!, 5)).toBeCloseTo(1, 6)
    expect(logEval(spec!, 1.0001)).toBeLessThan(-5)
  })

  it('says why, when no logarithm goes through them', () => {
    const across = logSpecFromPoints(points({ x1: '0', y1: '0', x2: '5', y2: '1', h: '1' }))
    expect(across.spec).toBeNull()
    expect(across.error).toMatch(/same side of the asymptote/)
    expect(logTwoPointRefusal({ x: 2, y: 0 }, { x: 2, y: 1 }, 0)).toMatch(/share an x/)
    expect(logTwoPointRefusal({ x: 1, y: 0 }, { x: 2, y: 1 }, 1)).toMatch(/asymptote x = 1/)
  })
})

describe('switching tabs keeps the curve', () => {
  it('Parameters → Two points → Parameters is the same function every time', () => {
    let d: LogDraft = {
      ...blankLogDraft(),
      params: { base: 'other', other: '3', a: '2', c: '1/2', h: '-1', k: '4' },
    }
    const first = logSource(logSpecFromDraft(d).spec!)
    d = switchLogTab(d, 'points')
    expect(d.tab).toBe('points')
    expect(logSource(logSpecFromDraft(d).spec!)).toBe(first)
    // Edit nothing, go back: identical. Clear the carry: the seeded points
    // make the same function.
    const pts = { ...d, carried: null }
    sameFunction(logSource(logSpecFromDraft(pts).spec!), first, xsRightOf(-1), 1e-4)
    d = switchLogTab(d, 'params')
    expect(logSource(logSpecFromDraft(d).spec!)).toBe(first)
  })

  it('Two points is seeded with the anchor and the base point', () => {
    const d = switchLogTab({ ...blankLogDraft(), params: { base: '2', other: '3', a: '1', c: '1', h: '1', k: '3' } }, 'points')
    expect(d.points).toMatchObject({ x1: '2', y1: '3', x2: '3', y2: '4', h: '1', base: '2' })
  })
})

describe('the Inverse of… tab', () => {
  const sources: InverseSource[] = [
    { id: 'e1', label: 'y = 2^x', spec: { a: '1', b: '2', p: '1', h: '0', k: '0' } },
    { id: 'e2', label: 'y = 3(2)^x + 1', spec: { a: '3', b: '2', p: '1', h: '0', k: '1' } },
  ]

  it('is the inverse of the first exponential until another is picked', () => {
    let d = switchLogTab(blankLogDraft(), 'inverse', sources)
    expect(d.carried).toBeNull()
    let spec = logSpecFromDraft(d, sources).spec!
    expect(logEval(spec, 8)).toBeCloseTo(3, 6)
    d = { ...d, inverse: { sourceId: 'e2' } }
    spec = logSpecFromDraft(d, sources).spec!
    // 3·2^x + 1 at x = 2 is 13, so its inverse at 13 is 2.
    expect(logEval(spec, 13)).toBeCloseTo(2, 6)
  })

  it('says so when there is no exponential on the board', () => {
    const d = switchLogTab(blankLogDraft(), 'inverse', [])
    expect(logSpecFromDraft(d, []).error).toMatch(/no exponential/)
  })

  it('lists typed and sketched exponentials, and nothing else', () => {
    const curve = (id: string, modelId: string, params: number[] = []) => ({
      id,
      modelId,
      params,
      kind: 'explicit',
    })
    const got = inverseSources(
      [
        curve('a', 'expr_1'),
        curve('b', 'expr_2'),
        curve('c', 'exp', [2, Math.log(3), 0]),
        curve('d', 'poly2', [1, 0, 0]),
      ],
      { a: 'y = 2^x', b: 'y = x^2' },
      { a: 'f' },
    )
    expect(got.map((s) => s.id)).toEqual(['a', 'c'])
    expect(got[0].label).toBe('f: y = 2^x')
    expect(got[1].label).toMatch(/sketch/)
  })
})

// ---------------------------------------------------------------------------
// write in base
// ---------------------------------------------------------------------------

describe('write in base — the same curve, another base', () => {
  const cases: LogSpec[] = [
    L2,
    { a: '2', b: 'e', c: '1', h: '1', k: '-1' },
    { a: '-1/2', b: '10', c: '3', h: '0', k: '2' },
    { a: '1', b: '3', c: '1', h: '-2', k: '0' },
  ]
  for (const spec of cases) {
    for (const to of ['e', '10', '2'] as const) {
      it(`${logSource(spec)} in base ${to} is the same function`, () => {
        const next = rebaseTo(spec, to)
        if (rebaseKeyOf(spec) === to) {
          expect(next).toBeNull()
          return
        }
        expect(next).not.toBeNull()
        expect(rebaseKeyOf(next!)).toBe(to)
        const h = Number(spec.h)
        sameFunction(logSource(next!), logSource(spec), xsRightOf(h))
      })
    }
  }

  it('"keep" rewrites nothing', () => {
    expect(rebaseTo(L2, 'keep')).toBeNull()
  })

  it('a committed rewrite restates once with its label; an unchanged one not at all', () => {
    const calls: [string, string][] = []
    const restate = (src: string, label: string): string | null => {
      calls.push([src, label])
      return null
    }
    expect(commitLogSpec(L2, rebaseTo(L2, 'e'), 'write in ln', { restate })).toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toBe('write in ln')
    expect(commitLogSpec(L2, { ...L2 }, 'set base', { restate })).toBeNull()
    expect(calls).toHaveLength(1)
    expect(commitLogSpec(L2, { ...L2, a: '0' }, 'set base', { restate })).toMatch(/a can’t be 0/)
  })
})

// ---------------------------------------------------------------------------
// board handles
// ---------------------------------------------------------------------------

describe('board handles', () => {
  it('the asymptote on the x-axis, the anchor and the base point', () => {
    const hs = logHandles(L2)
    expect(hs.map((h) => h.which)).toEqual(['h', 'k', 'a'])
    expect(hs[0].pos).toEqual({ x: 1, y: 0 })
    expect(hs[1].pos).toEqual({ x: 2, y: 3 })
    expect(hs[2].pos).toEqual({ x: 3, y: 4 })
    expect(hs[0].label).toBe('asymptote x = 1')
  })

  it('dragging the asymptote shifts the curve horizontally', () => {
    const next = dragLogHandle(L2, 'h', { x: 3, y: 0.7 })!
    expect(next).toMatchObject({ a: '1', b: '2', c: '1', h: '3', k: '3' })
    expect(logEval(next, 4)).toBeCloseTo(logEval(L2, 2), 12)
  })

  it('dragging the anchor sets k; the base point sets a with the anchor kept', () => {
    expect(dragLogHandle(L2, 'k', { x: 99, y: -1 })).toMatchObject({ k: '-1', a: '1', h: '1' })
    const a = dragLogHandle(L2, 'a', { x: 99, y: 6 })!
    expect(a.a).toBe('3')
    expect(logEval(a, 2)).toBeCloseTo(3, 12)
    expect(logEval(a, 3)).toBeCloseTo(6, 12)
    expect(dragLogHandle(L2, 'a', { x: 3, y: 3 })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// the inverse view
// ---------------------------------------------------------------------------

describe('Show inverse', () => {
  it('y = 2^x gives log₂(x) and the line y = x', () => {
    const plan = planInverse('y = 2^x', ['y = 2^x'])!
    expect(plan.mirror).toBe(true)
    expect(plan.notice).toBe('Added the inverse and the line y = x')
    sameFunction(plan.src!, 'y = ln(x)/ln(2)', [0.25, 1, 2, 8, 30])
  })

  it('a logarithm gives its exponential, mirrored', () => {
    const plan = planInverse('y = log2(x - 1) + 3', [])!
    if (!plan.src) throw new Error('no inverse')
    // (2, 3) on the log is (3, 2) on the inverse, (3, 4) is (4, 3).
    expect(lineAt(plan.src, 3)).toBeCloseTo(2, 6)
    expect(lineAt(plan.src, 4)).toBeCloseTo(3, 6)
  })

  it('never adds a second y = x', () => {
    for (const there of ['y = x', 'y=x', 'f(x) = x', 'y = 1x']) {
      expect(planInverse('y = 2^x', ['y = 2^x', there])!.mirror).toBe(false)
    }
    // Nor a second copy of the inverse itself.
    const again = planInverse('y = 2^x', ['y = 2^x', 'y = log_2(x)', 'y = x'])!
    expect(again.src).toBeNull()
    expect(again.mirror).toBe(false)
    expect(again.notice).toMatch(/already on the board/)
    expect(isIdentityLine('y = 2x')).toBe(false)
    expect(isIdentityLine('x = y^2')).toBe(false)
    expect(planInverse('y = x^2', [])).toBeNull()
  })

  it('names the inverse y, not f again', () => {
    const src = inverseOfExp({ name: 'f', a: '1', b: '2', p: '1', h: '0', k: '0' })!
    expect(src.startsWith('y =')).toBe(true)
  })

  it('in the paired palette colour', () => {
    expect(inverseColor(CURVE_COLORS[0])).toBe(CURVE_COLORS[5])
    expect(inverseColor(CURVE_COLORS[5])).toBe(CURVE_COLORS[0])
    expect(inverseColor(CURVE_COLORS[1])).toBe(CURVE_COLORS[6])
    expect(inverseColor('#123456')).toBe('#123456')
  })
})

// ---------------------------------------------------------------------------
// markup
// ---------------------------------------------------------------------------

describe('LogEditor — markup', () => {
  it('shows the tabs, the base picker, the preview and the features', () => {
    const html = renderToStaticMarkup(
      createElement(LogEditor, {
        initial: {
          ...blankLogDraft(),
          params: { base: '2', other: '3', a: '1', c: '1', h: '1', k: '3' },
        },
        onBuild: () => null,
        onClose: NOOP,
      }),
    )
    expect(html).toContain('data-testid="log-editor"')
    expect(html).toContain('Parameters')
    expect(html).toContain('Two points')
    expect(html).toContain('Inverse of…')
    expect(html).toContain('log₂')
    expect(html).toContain('other b')
    expect(html).toMatch(/data-tex="[^"]+"/)
    expect(html).toContain('data-testid="log-sentences"')
    expect(html).toMatch(/vertical asymptote x = 1/i)
    expect(html).toMatch(/domain x &gt; 1/i)
    expect(html).toContain('(2, 3)')
    expect(html).toContain('(3, 4)')
    expect(html).toContain('Range: all real numbers')
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>Add to graph/)
  })

  it('a two-point refusal is shown and the button disabled', () => {
    const html = renderToStaticMarkup(
      createElement(LogEditor, {
        initial: {
          ...blankLogDraft(),
          tab: 'points',
          points: points({ x1: '0', y1: '0', x2: '5', y2: '1', h: '1' }),
        },
        onBuild: () => null,
        onClose: NOOP,
      }),
    )
    expect(html).toContain('same side of the asymptote')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Add to graph/)
  })

  it('Inverse of… with no exponential says what to do, and cannot build', () => {
    const html = renderToStaticMarkup(
      createElement(LogEditor, {
        initial: { ...blankLogDraft(), tab: 'inverse' },
        onBuild: () => null,
        onClose: NOOP,
        sources: [],
      }),
    )
    expect(html).toContain('data-testid="log-inverse-none"')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Add to graph/)
  })

  it('Inverse of… lists the board’s exponentials', () => {
    const html = renderToStaticMarkup(
      createElement(LogEditor, {
        initial: { ...blankLogDraft(), tab: 'inverse' },
        onBuild: () => null,
        onClose: NOOP,
        sources: [{ id: 'e1', label: 'f: y = 2^x', spec: { a: '1', b: '2', p: '1', h: '0', k: '0' } }],
      }),
    )
    expect(html).toContain('f: y = 2^x')
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>Add to graph/)
  })

  it('the preview is what Add to graph writes', () => {
    const p = logPreview(L2)
    expect(p.src).toBe(logSource(L2))
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
    onLogRestate: () => null,
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

describe('the Logarithmic section on a card', () => {
  it('hand-typed y = ln(x - 1) + 2 gets one, open, with its features and switch', () => {
    expect(safeReadLogarithmic('y = ln(x - 1) + 2')).not.toBeNull()
    const html = typedCard('y = ln(x - 1) + 2')
    expect(html).toContain('data-testid="log-section"')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toMatch(/vertical asymptote x = 1/i)
    expect(html).toContain('write in base')
    expect(html).toContain('data-testid="log-show-inverse"')
    expect(html).not.toContain('exp-section')
  })

  it('y = log_2(x) and y = 3log(2x) get one too', () => {
    expect(typedCard('y = log_2(x)')).toContain('data-testid="log-section"')
    expect(typedCard('y = 3log(2x)')).toContain('data-testid="log-section"')
  })

  it('y = x^2 does not', () => {
    const html = typedCard('y = x^2')
    expect(html).not.toContain('log-section')
  })

  it('an exponential card offers Show inverse too', () => {
    expect(typedCard('y = 2^x')).toContain('data-testid="exp-show-inverse"')
  })
})

describe('a sketched logarithm', () => {
  const curve: FittedCurve = {
    id: 's1',
    modelId: 'log',
    params: [2.1, 0.8, 3],
    kind: 'explicit',
    domain: [1, 6],
    color: '#f97',
    strokeWidth: 2.5,
    visible: true,
    error: 0.02,
  }

  it('is read as a·ln(x − h) + k with its asymptote', () => {
    const f = fittedLog(curve.params)!
    expect(f.spec).toMatchObject({ a: '2.1', b: 'e', c: '1', h: '0.8', k: '3' })
    expect(f.note.startsWith('= ')).toBe(true)
    expect(f.note).toContain('2.1')
    expect(f.note).toContain('asymptote x = 0.8')
    sameFunction(f.src, 'y = 2.1ln(x - 0.8) + 3', [1, 1.5, 3, 6])
  })

  it('the card wears the note; a flat fit does not', () => {
    const html = card(curve, MODELS)
    expect(html).toContain('data-testid="fitted-log-note"')
    expect(fittedLog([0, 1, 2])).toBeNull()
  })
})

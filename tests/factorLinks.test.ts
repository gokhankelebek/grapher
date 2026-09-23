// ============================================================================
// tests/factorLinks.test.ts — a function set by its roots, as the UI edits it.
//
// The bridge itself (spec ⇄ line, roots, end behaviour) belongs to the core and
// is tested there. What is tested HERE is the UI half: the spec edits a row or
// a stepper makes, the "through a point" promise, what each row says, the
// preview the "Build from roots" card shows, and that a card for a factored
// typed curve grows a Roots section — and one for y = x^2 - 1 does not.
// ============================================================================

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { factoredSource, readFactored } from '../src/core/factored'
import type { FactoredSpec } from '../src/core/factored'
import { parseExpression } from '../src/core/parse'
import {
  BEHAVIOUR_TEXT,
  MULT_MAX,
  applyFactorOp,
  clampMult,
  commitFactorOp,
  factorOpLabel,
  factorPreview,
  freshRoot,
  keepThrough,
  moveRoot,
  niceNumber,
  rootHandles,
  rowBehaviour,
  specProblems,
  throughA,
} from '../src/ui/factorLinks'
import { FactorEditor } from '../src/ui/FactorEditor'
import { CurveCard } from '../src/ui/CurveCard'

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

/** y = (x + 1)^2(x - 3) */
function cubic(over: Partial<FactoredSpec> = {}): FactoredSpec {
  return {
    a: '1',
    num: [
      { root: '-1', mult: 2 },
      { root: '3', mult: 1 },
    ],
    den: [],
    ...over,
  }
}

const NOOP = (): void => {}

// ---------------------------------------------------------------------------
// spec edits
// ---------------------------------------------------------------------------

describe('spec edits', () => {
  it('+ root adds a multiplicity-1 root no row already uses', () => {
    const s = applyFactorOp(cubic(), { kind: 'addRoot', side: 'num' })
    expect(s.num).toHaveLength(3)
    expect(s.num[2]).toEqual({ root: '0', mult: 1 })
    expect(freshRoot({ a: '1', num: [{ root: '0', mult: 1 }], den: [] })).toBe('1')
    expect(freshRoot({ a: '1', num: [{ root: '0', mult: 1 }, { root: '1', mult: 1 }], den: [] })).toBe('-1')
  })

  it('+ root can be given its value', () => {
    const s = applyFactorOp(cubic(), { kind: 'addRoot', side: 'den', root: 'sqrt(2)' })
    expect(s.den).toEqual([{ root: 'sqrt(2)', mult: 1 }])
  })

  it('+ complex pair adds 0 ± 1i', () => {
    const s = applyFactorOp(cubic(), { kind: 'addComplex', side: 'num' })
    expect(s.num[2]).toEqual({ complex: { re: '0', im: '1' }, mult: 1 })
    const t = applyFactorOp(s, { kind: 'setComplex', side: 'num', index: 2, part: 'im', text: '2' })
    expect(t.num[2].complex).toEqual({ re: '0', im: '2' })
  })

  it('× removes exactly that row', () => {
    const s = applyFactorOp(cubic(), { kind: 'remove', side: 'num', index: 0 })
    expect(s.num).toEqual([{ root: '3', mult: 1 }])
    // Out of range is not an edit.
    const same = cubic()
    expect(applyFactorOp(same, { kind: 'remove', side: 'num', index: 5 })).toBe(same)
  })

  it('a multiplicity is a whole number from 1 to 9', () => {
    expect(clampMult(0)).toBe(1)
    expect(clampMult(12)).toBe(MULT_MAX)
    expect(clampMult(2.6)).toBe(3)
    const s = applyFactorOp(cubic(), { kind: 'setMult', side: 'num', index: 1, mult: 3 })
    expect(s.num[1].mult).toBe(3)
    const down = cubic()
    // Stepping below 1 changes nothing — and says so by returning the same spec.
    const low = applyFactorOp(down, { kind: 'stepMult', side: 'num', index: 1, delta: -1 })
    expect(low).toBe(down)
    const up = applyFactorOp(down, { kind: 'stepMult', side: 'num', index: 1, delta: 1 })
    expect(up.num[1].mult).toBe(2)
  })

  it('a typed root replaces the text, exactly as written', () => {
    const s = applyFactorOp(cubic(), { kind: 'setRoot', side: 'num', index: 1, root: 'pi/4' })
    expect(s.num[1]).toEqual({ root: 'pi/4', mult: 1 })
  })

  it('"Make it rational" opens the denominator WITH a row, and closes it again', () => {
    const on = applyFactorOp(cubic(), { kind: 'toggleRational' })
    expect(on.den).toHaveLength(1)
    // Not on a numerator root: that would open as a hole.
    expect(['-1', '3']).not.toContain(on.den[0].root)
    const off = applyFactorOp(on, { kind: 'toggleRational' })
    expect(off.den).toEqual([])
    expect(factorOpLabel({ kind: 'toggleRational' }, cubic())).toBe('make rational')
    expect(factorOpLabel({ kind: 'toggleRational' }, on)).toBe('make polynomial')
  })

  it('names each edit for undo', () => {
    expect(factorOpLabel({ kind: 'stepMult', side: 'num', index: 0, delta: 1 })).toBe(
      'set multiplicity',
    )
    expect(factorOpLabel({ kind: 'addRoot', side: 'num' })).toBe('add root')
    expect(factorOpLabel({ kind: 'remove', side: 'den', index: 0 })).toBe('remove root')
  })
})

// ---------------------------------------------------------------------------
// numbers, problems, and the through-a-point promise
// ---------------------------------------------------------------------------

describe('numbers written back', () => {
  it('a computed coefficient is a small fraction when it is one', () => {
    expect(niceNumber(0.5)).toBe('1/2')
    expect(niceNumber(-1.25)).toBe('-5/4')
    expect(niceNumber(1 / 3)).toBe('1/3')
    expect(niceNumber(3)).toBe('3')
    expect(niceNumber(Math.PI)).toBe('3.14159')
  })
})

describe('what does not evaluate', () => {
  it('a buildable spec has no problems', () => {
    expect(specProblems(cubic())).toEqual([])
    expect(specProblems(cubic({ a: 'sqrt(3)' }))).toEqual([])
  })

  it('names the field that is not a number', () => {
    const p = specProblems(cubic({ num: [{ root: 'banana', mult: 1 }] }))
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ side: 'num', index: 0, field: 'root' })
    expect(p[0].message).toContain('banana')
  })

  it('a = 0 and a ± 0i are refused', () => {
    expect(specProblems(cubic({ a: '0' }))[0].field).toBe('a')
    const p = specProblems(cubic({ num: [{ complex: { re: '1', im: '0' }, mult: 1 }] }))
    expect(p[0].field).toBe('im')
  })
})

describe('through a point', () => {
  it('solves a so the curve passes through the point', () => {
    // (x + 1)^2(x − 3) at x = 0 is −3, so a = −1 puts it through (0, 3).
    expect(throughA(cubic(), { x: 0, y: 3 })).toBe('-1')
    // A root cannot be passed through at a nonzero height.
    expect(throughA(cubic(), { x: 3, y: 1 })).toBeNull()
  })

  it('a dragged root keeps a — unless the curve was built through a point', () => {
    const kept = moveRoot(cubic({ a: '2' }), 'num', 1, 2)!
    expect(kept.a).toBe('2')
    expect(kept.num[1].root).toBe('2')
    const through = moveRoot(cubic({ a: '-1' }), 'num', 1, 2, { x: 0, y: 3 })!
    // (x + 1)^2(x − 2) at 0 is −2: a = −3/2 keeps (0, 3).
    expect(through.a).toBe('-3/2')
  })

  it('a dragged sqrt(2) becomes the snapped decimal', () => {
    const s = cubic({ num: [{ root: 'sqrt(2)', mult: 1 }] })
    expect(moveRoot(s, 'num', 0, 1.4)!.num[0].root).toBe('1.4')
  })

  it('an edit that puts a root ON the point keeps a rather than refusing', () => {
    const s = cubic({ a: '-1' })
    expect(keepThrough({ ...s, num: [{ root: '0', mult: 1 }] }, { x: 0, y: 3 }).a).toBe('-1')
  })
})

// ---------------------------------------------------------------------------
// what each row says
// ---------------------------------------------------------------------------

describe('row behaviour', () => {
  it('crosses / touches / flattens', () => {
    expect(rowBehaviour(cubic(), 'num', 0)).toBe('touches')
    expect(rowBehaviour(cubic(), 'num', 1)).toBe('crosses')
    const flat = applyFactorOp(cubic(), { kind: 'setMult', side: 'num', index: 1, mult: 3 })
    expect(rowBehaviour(flat, 'num', 1)).toBe('flattens')
  })

  it('a denominator root is a vertical asymptote, and says which kind', () => {
    const r = cubic({ den: [{ root: '1', mult: 1 }] })
    expect(rowBehaviour(r, 'den', 0)).toBe(BEHAVIOUR_TEXT['asymptote-odd'])
    const e = cubic({ den: [{ root: '1', mult: 2 }] })
    expect(rowBehaviour(e, 'den', 0)).toBe('vertical asymptote — same sign')
  })

  it('a root on both sides cancels — both rows say so', () => {
    const r = cubic({ den: [{ root: '1', mult: 1 }, { root: '-1', mult: 1 }] })
    expect(rowBehaviour(r, 'num', 0)).toBe('hole')
    expect(rowBehaviour(r, 'den', 1)).toBe('hole')
  })

  it('a complex pair has no x-intercept', () => {
    const s = applyFactorOp(cubic(), { kind: 'addComplex', side: 'num' })
    expect(rowBehaviour(s, 'num', 2)).toBe('no real zero')
  })
})

// ---------------------------------------------------------------------------
// the preview, and one committed edit
// ---------------------------------------------------------------------------

describe('preview', () => {
  it('is the line it will create, its LaTeX and the end behaviour', () => {
    const p = factorPreview(cubic())
    expect(p.error).toBeNull()
    expect(p.src).toBe('y = (x + 1)^2(x - 3)')
    expect(p.latex).toBeTruthy()
    expect(p.end).toMatch(/degree 3/)
  })

  it('a field that does not evaluate is an error line, not a crash', () => {
    const p = factorPreview(cubic({ num: [{ root: '2x', mult: 1 }] }))
    expect(p.src).toBeNull()
    expect(p.error).toContain('2x')
  })
})

describe('one committed edit on a card', () => {
  it('a multiplicity change restates the curve with the new line', () => {
    const restate = vi.fn((_src: string, _label: string): string | null => null)
    const err = commitFactorOp(
      cubic(),
      { kind: 'setMult', side: 'num', index: 1, mult: 3 },
      { restate },
    )
    expect(err).toBeNull()
    expect(restate).toHaveBeenCalledTimes(1)
    expect(restate).toHaveBeenCalledWith('y = (x + 1)^2(x - 3)^3', 'set multiplicity')
  })

  it('an edit that changes nothing restates nothing', () => {
    const restate = vi.fn(() => null)
    commitFactorOp(cubic(), { kind: 'setMult', side: 'num', index: 1, mult: 1 }, { restate })
    expect(restate).not.toHaveBeenCalled()
  })

  it('keeps the point: a is re-solved; typing a ends the promise', () => {
    const restate = vi.fn((_src: string, _label: string): string | null => null)
    const dropThrough = vi.fn()
    commitFactorOp(
      cubic({ a: '-1' }),
      { kind: 'setRoot', side: 'num', index: 1, root: '2' },
      { restate, through: { x: 0, y: 3 }, dropThrough },
    )
    expect(restate.mock.calls[0][0]).toBe(factoredSource(cubic({ a: '-3/2', num: [{ root: '-1', mult: 2 }, { root: '2', mult: 1 }] })))
    expect(dropThrough).not.toHaveBeenCalled()
    commitFactorOp(cubic(), { kind: 'setA', a: '5' }, { restate, through: { x: 0, y: 3 }, dropThrough })
    expect(dropThrough).toHaveBeenCalledTimes(1)
    expect(restate.mock.calls[1][0]).toBe('y = 5(x + 1)^2(x - 3)')
  })

  it('names each root handle for the board', () => {
    const r = cubic({ den: [{ root: '1', mult: 1 }], num: [{ root: '-1', mult: 2 }, { complex: { re: '0', im: '1' }, mult: 1 }] })
    expect(rootHandles(r)).toEqual([
      { side: 'num', index: 0, x: -1, label: 'root' },
      { side: 'den', index: 0, x: 1, label: 'asymptote' },
    ])
  })
})

// ---------------------------------------------------------------------------
// markup
// ---------------------------------------------------------------------------

describe('Build from roots — markup', () => {
  const html = renderToStaticMarkup(
    createElement(FactorEditor, { initial: cubic(), onBuild: () => null, onClose: NOOP }),
  )

  it('shows each row with what the graph does there', () => {
    expect(html).toContain('touches')
    expect(html).toContain('crosses')
    expect(html).toContain('value="-1"')
    expect(html).toContain('value="3"')
  })

  it('previews the equation it will create', () => {
    expect(html).toContain('data-src="y = (x + 1)^2(x - 3)"')
    expect(html).toMatch(/data-tex="[^"]+"/)
    expect(html).toContain('Add to graph')
    expect(html).toMatch(/degree 3/)
  })

  it('keeps the denominator behind "+ Make it rational"', () => {
    expect(html).toContain('+ Make it rational')
    expect(html).not.toContain('Denominator roots')
    const rational = renderToStaticMarkup(
      createElement(FactorEditor, {
        initial: cubic({ den: [{ root: '1', mult: 1 }] }),
        onBuild: () => null,
        onClose: NOOP,
      }),
    )
    expect(rational).toContain('Denominator roots')
    expect(rational).toContain('vertical asymptote — sign changes')
  })

  it('solves a from a point and shows it', () => {
    const through = renderToStaticMarkup(
      createElement(FactorEditor, {
        initial: cubic(),
        initialThrough: { x: '0', y: '3' },
        onBuild: () => null,
        onClose: NOOP,
      }),
    )
    expect(through).toContain('data-src="y = -(x + 1)^2(x - 3)"')
  })

  it('an unevaluable field is an error line and a disabled button', () => {
    const bad = renderToStaticMarkup(
      createElement(FactorEditor, {
        initial: cubic({ num: [{ root: 'q', mult: 1 }] }),
        onBuild: () => null,
        onClose: NOOP,
      }),
    )
    expect(bad).toContain('expr-error')
    expect(bad).toMatch(/<button[^>]*disabled[^>]*>Add to graph/)
  })
})

describe('the Roots section on a card', () => {
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
    const props = {
      curve,
      style: undefined,
      models: { expr_1: spec },
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
      onFactorRestate: () => null,
    }
    return renderToStaticMarkup(
      createElement(CurveCard, props as unknown as Parameters<typeof CurveCard>[0]),
    )
  }

  it('a factored typed curve gets one, open, with its rows', () => {
    const src = 'f(x) = (x-2)^2(x+1)'
    expect(readFactored(src)).not.toBeNull()
    const html = typedCard(src)
    expect(html).toContain('data-testid="roots-section"')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('touches')
    expect(html).toContain('crosses')
    expect(html).toContain('+ Make it rational')
  })

  it('a rational one lists its denominator', () => {
    const html = typedCard('y = (x + 1)^2(x - 3)/(x - 1)')
    expect(html).toContain('data-testid="roots-section"')
    expect(html).toContain('Denominator')
    expect(html).toContain('vertical asymptote')
  })

  it('y = x^2 - 1 is not factored, and shows nothing new', () => {
    const html = typedCard('y = x^2 - 1')
    expect(html).not.toContain('roots-section')
    expect(html).not.toContain('Make it rational')
  })
})

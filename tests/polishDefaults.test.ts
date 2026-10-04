// ============================================================================
// tests/polishDefaults.test.ts — the launch polish pass (2026-10-04): the
// first-five-minutes defaults a product review found rough.
//
//   1  export style: Textbook for NEW documents; stored documents unchanged
//   2  Riemann / area open on a nice interval on screen, n = 4
//   3  "Fit to curves" frames features (more in tests/fitFrame.test.ts)
//   4  number fields: Enter / Tab / blur commit, one display format
//   5  a sketch's card: the function's domain + "drawn on", Tidy, Read as,
//      one kind label
//   6  the Transformation section folded, its board marks following it
//   7  the empty-state hint above the axis
//   8  set-builder notation that wraps between clauses
//   9  "L₃ = −7 (exact ∫₀³ = −3)" instead of "→ ∫ ="
//  10  the sidebar back at the top on a document switch
// ============================================================================

import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FittedCurve, ModelSpec, Vec2 } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { parseExpression } from '../src/core/parse'
import {
  NEW_DOC_FIGURE,
  deserializeDoc,
  emptyBoard,
  newDocBoard,
  createDoc,
  serializeDoc,
} from '../src/core/persist'
import { EXAMPLE_DEFS, buildExample } from '../src/examples'
import {
  N_DEFAULT,
  N_STORED_DEFAULT,
  closedForm,
  defaultBounds,
  integralLimits,
  niceBounds,
  riemannReadout,
  trimmed,
} from '../src/ui/calcLinks'
import { curveFeatureBox } from '../src/ui/fitFrame'
import { entryHandlers } from '../src/ui/fieldEntry'
import { drawnExtent } from '../src/ui/domainLinks'
import { ALSO_FITS_MIN, CurveCard, readingsShown } from '../src/ui/CurveCard'
import { kindLabel } from '../src/ui/kindLabel'
import { tidyOffer } from '../src/core/tidy'
import { resetSectionMemory, sectionOpenNow } from '../src/ui/CardSection'
import { builderTex } from '../src/ui/nlSolve'
import { appSource } from './appSource'

const NOOP = (): void => {}

function typed(src: string, id = 'f'): { curve: FittedCurve; models: Record<string, ModelSpec> } {
  const out = parseExpression(src)
  if (!out.ok) throw new Error(out.error)
  const modelId = `expr_${id}`
  const spec = out.plot.makeModel(modelId)
  return {
    curve: {
      id,
      modelId,
      params: out.plot.defaultParams.slice(),
      kind: out.plot.kind,
      domain: out.plot.domain,
      color: '#4f9cf9',
      strokeWidth: 2.5,
      visible: true,
      error: 0,
    },
    models: { ...MODELS, [modelId]: spec },
  }
}

/** A seeded wobble, so the "hand-drawn" ink is the same every run. */
function wobble(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32 - 0.5
  }
}

/** The motivating sketch: y = 0.99251x² + 0.03295x − 3.9329 drawn over [−3, 3]. */
function sketchedParabola(): FittedCurve {
  const params = [-3.9329, 0.03295, 0.99251]
  const rnd = wobble(7)
  const ink: Vec2[] = []
  for (let i = 0; i <= 120; i++) {
    const x = -3 + (6 * i) / 120
    ink.push({ x, y: params[2] * x * x + params[1] * x + params[0] + 0.04 * rnd() })
  }
  return {
    id: 's',
    modelId: 'poly2',
    params,
    kind: 'explicit',
    domain: [-3.3, 3.3],
    color: '#4f9cf9',
    strokeWidth: 2.5,
    visible: true,
    error: 0.012,
    sourceStroke: ink,
  }
}

function card(curve: FittedCurve, models: Record<string, ModelSpec>, over: Record<string, unknown> = {}): string {
  const props = {
    curve,
    style: undefined,
    models,
    selected: true,
    candidates: [],
    snapMask: null,
    snapKey: 0,
    shaking: false,
    edited: false,
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
    onTransformRestate: () => null,
    onTransformShowParent: NOOP,
    onShowInverse: NOOP,
    onConvertTyped: () => null,
    ...over,
  }
  return renderToStaticMarkup(createElement(CurveCard, props as unknown as Parameters<typeof CurveCard>[0]))
}

beforeEach(() => resetSectionMemory())
afterEach(() => resetSectionMemory())

// ---------------------------------------------------------------------------
// 1. export style
// ---------------------------------------------------------------------------

describe('1 · a new document exports in the Textbook style', () => {
  it('a document created now states Textbook; emptyBoard (the placeholder) still states nothing', () => {
    expect(NEW_DOC_FIGURE).toBe('textbook')
    expect(newDocBoard().figure).toBe('textbook')
    expect(newDocBoard('number-line')).toMatchObject({ kind: 'number-line', figure: 'textbook' })
    expect('figure' in emptyBoard()).toBe(false)
  })

  it('a stored document that names no style still opens in the screen style, byte for byte', () => {
    const old = createDoc('Old', emptyBoard(), 1_700_000_000_000)
    const json = serializeDoc(old)
    expect(json).not.toContain('figure')
    const res = deserializeDoc(json)
    expect(res.board?.figure).toBe('screen')
  })

  it('a new document round-trips as Textbook', () => {
    const doc = createDoc('New', newDocBoard(), 1_700_000_000_000)
    expect(deserializeDoc(serializeDoc(doc)).board?.figure).toBe('textbook')
  })

  it('an opened example is a new document: Textbook', () => {
    const def = EXAMPLE_DEFS[0]
    const built = buildExample(def)
    expect(deserializeDoc(built.json).board?.figure).toBe('textbook')
  })

  it('the App creates New and first-run boards through the new-document style', () => {
    const src = appSource()
    expect(src).toContain('newDocBoard(nextKind)')
    expect(src).toContain('figure: NEW_DOC_FIGURE')
    expect(src).toMatch(/setFigureStyle\(NEW_DOC_FIGURE\)/)
  })
})

// ---------------------------------------------------------------------------
// 2. the Riemann sum / area interval
// ---------------------------------------------------------------------------

describe('2 · a fresh Riemann sum or area opens on a nice interval on screen', () => {
  const VIEW: [number, number] = [-8.5, 8.5]
  const Y: [number, number] = [-6.4, 6.4]

  it('n = 4 for a new sum; a stored sum without n still reads as before', () => {
    expect(N_DEFAULT).toBe(4)
    expect(N_STORED_DEFAULT).toBe(8)
  })

  it('x² − 4: between its two zeros, [−2, 2] (not the whole window)', () => {
    const { curve, models } = typed('y = x^2 - 4')
    expect(niceBounds(curve, models, VIEW, Y)).toEqual([-2, 2])
    expect(defaultBounds(curve, VIEW)).toEqual([-8.5, 8.5]) // what it used to open on
  })

  it('sin x: the pair of zeros to the right of the middle, [0, π]', () => {
    const { curve, models } = typed('y = sin(x)')
    const [a, b] = niceBounds(curve, models, VIEW, Y)
    expect(a).toBeCloseTo(0, 6)
    expect(b).toBeCloseTo(Math.PI, 5)
  })

  it('x² (one tangent zero): a nice interval whose bars stay on the board, [0, 2]', () => {
    const { curve, models } = typed('y = x^2')
    expect(niceBounds(curve, models, VIEW, Y)).toEqual([0, 2])
  })

  it('eˣ: [0, 1] — e³ = 20 would run off the top', () => {
    const { curve, models } = typed('y = e^x')
    expect(niceBounds(curve, models, VIEW, Y)).toEqual([0, 1])
  })

  it('1/x: an interval that does not cross the pole', () => {
    const { curve, models } = typed('y = 1/x')
    const [a, b] = niceBounds(curve, models, VIEW, Y)
    expect(a > 0 || b < 0).toBe(true)
    expect(b - a).toBeGreaterThan(0.5)
  })

  it('a sketch: between its zeros, inside the drawn piece', () => {
    const s = sketchedParabola()
    const [a, b] = niceBounds(s, MODELS, VIEW, Y)
    expect(a).toBeCloseTo(-2, 1)
    expect(b).toBeCloseTo(2, 1)
    expect(a).toBeGreaterThanOrEqual(-3.3)
    expect(b).toBeLessThanOrEqual(3.3)
  })

  it('every fresh interval is on screen: the curve stays inside the y-window over it', () => {
    for (const src of ['y = x^2 - 4', 'y = x^3 - 3x', 'y = e^x', 'y = 2^x - 3', 'y = sin(x)', 'y = x^2', 'y = sqrt(x)', 'y = ln(x)']) {
      const { curve, models } = typed(src)
      const [a, b] = niceBounds(curve, models, VIEW, Y)
      const f = models[curve.modelId].evalExplicit!
      for (let i = 0; i <= 40; i++) {
        const y = f(curve.params, a + ((b - a) * i) / 40)
        expect(Number.isFinite(y), src).toBe(true)
        expect(Math.abs(y), src).toBeLessThan(6.4)
      }
    }
  })

  it('a section added from the ⋯ menu is scrolled to and its first field focused', () => {
    const src = readFileSync(new URL('../src/ui/CurveCard.tsx', import.meta.url), 'utf8')
    expect(src).toContain('revealToolRef.current = true')
    expect(src).toContain('export function revealSection')
    expect(src).toMatch(/data-tool=\{t\.id\}/)
  })
})

// ---------------------------------------------------------------------------
// 3. Fit to curves
// ---------------------------------------------------------------------------

describe('3 · Fit frames features, not tails', () => {
  const width = (b: { min: Vec2; max: Vec2 }): number => b.max.x - b.min.x
  const height = (b: { min: Vec2; max: Vec2 }): number => b.max.y - b.min.y

  it('x² − 4 on a ±8.5 board: about [−3.5, 3.5] × [−4.5, 5], never ±65 / 80', () => {
    const { curve, models } = typed('y = x^2 - 4')
    const b = curveFeatureBox(curve, models, [-8.5, 8.5])!
    expect(width(b)).toBeLessThan(10)
    expect(b.max.y).toBeLessThan(8)
    expect(b.min.y).toBeLessThanOrEqual(-4)
  })

  it('x³ − 3x: its turning points with room, not ±8 of tail', () => {
    const { curve, models } = typed('y = x^3 - 3x')
    const b = curveFeatureBox(curve, models, [-8.5, 8.5])!
    expect(b.min.y).toBeLessThanOrEqual(-2)
    expect(b.max.y).toBeGreaterThanOrEqual(2)
    expect(height(b)).toBeLessThan(12)
  })

  it('tan x: about two periods around the middle, symmetric', () => {
    const { curve, models } = typed('y = tan(x)')
    const b = curveFeatureBox(curve, models, [-8.5, 8.5])!
    expect(width(b)).toBeLessThan(16)
    expect(Math.abs(b.min.x + b.max.x)).toBeLessThan(1)
  })
})

// ---------------------------------------------------------------------------
// 4. number fields
// ---------------------------------------------------------------------------

/** Just enough of an <input> and its events for entryHandlers. */
function fakeField(initial: string) {
  const el = {
    value: initial,
    dataset: {} as Record<string, string | undefined>,
    isConnected: true,
    closest: () => null,
  }
  const ev = (key = '') => {
    let prevented = false
    return {
      key,
      shiftKey: false,
      currentTarget: el,
      preventDefault: () => {
        prevented = true
      },
      stopPropagation: NOOP,
      get prevented() {
        return prevented
      },
    }
  }
  return { el, ev }
}

describe('4 · number fields commit on Enter, Tab and blur', () => {
  it('Enter commits; Esc cancels', () => {
    const calls: string[] = []
    const h = entryHandlers(() => calls.push('commit'), () => calls.push('cancel'))
    const { el, ev } = fakeField('0')
    h.onFocus(ev() as never)
    el.value = '1/2'
    h.onKeyDown(ev('Enter') as never)
    expect(calls).toEqual(['commit'])
    const g = fakeField('0')
    const calls2: string[] = []
    const h2 = entryHandlers(() => calls2.push('commit'), () => calls2.push('cancel'))
    h2.onKeyDown(g.ev('Escape') as never)
    expect(calls2).toEqual(['cancel'])
  })

  it('blur commits a changed, readable value — and only that', () => {
    const run = (from: string, to: string): string[] => {
      const calls: string[] = []
      const h = entryHandlers(() => calls.push('commit'), () => calls.push('cancel'))
      const { el, ev } = fakeField(from)
      h.onFocus(ev() as never)
      el.value = to
      el.isConnected = false // the field closes on commit/cancel
      h.onBlur(ev() as never)
      return calls
    }
    expect(run('0', '3')).toEqual(['commit'])
    expect(run('0', 'pi/2')).toEqual(['commit'])
    expect(run('3', '3')).toEqual(['cancel'])
    expect(run('0', '3x+')).toEqual(['cancel'])
  })

  it('Tab commits a changed value (and keeps the browser from tabbing out of a field it is about to remove)', () => {
    const calls: string[] = []
    const h = entryHandlers(() => calls.push('commit'), () => calls.push('cancel'))
    const { el, ev } = fakeField('0')
    h.onFocus(ev() as never)
    el.value = '3'
    const tab = ev('Tab')
    // no document in a node test: the scope lookup falls back gracefully
    ;(globalThis as { document?: unknown }).document = { body: { querySelectorAll: () => [] } }
    try {
      h.onKeyDown(tab as never)
    } finally {
      delete (globalThis as { document?: unknown }).document
    }
    expect(tab.prevented).toBe(true)
    expect(calls).toEqual(['commit'])
  })

  it('a bound reads the way it was typed: "0" and "3", not "0" and "3.000"', () => {
    expect(trimmed(0)).toBe('0')
    expect(trimmed(3)).toBe('3')
    expect(trimmed(-2)).toBe('−2')
    expect(trimmed(1.75)).toBe('1.75')
    expect(trimmed(-1.98741)).toBe('−1.987')
  })

  it('every click-to-type number field in a card section uses the shared handlers', () => {
    for (const f of ['EulerSection', 'ImplicitSection', 'LimitSection', 'ParamCalcSection', 'TaylorSection', 'SignChartSection', 'VolumeSection', 'SecantSection', 'CurveCard']) {
      const src = readFileSync(new URL(`../src/ui/${f}.tsx`, import.meta.url), 'utf8')
      expect(src, f).toContain('entryHandlers(')
      expect(src, f).not.toMatch(/onBlur=\{\(\) => setEdit\(null\)\}/)
    }
  })
})

// ---------------------------------------------------------------------------
// 5. the card of a sketched curve
// ---------------------------------------------------------------------------

describe('5a · a sketch is a function drawn on a piece', () => {
  it('drawnExtent: the ink extent with the fitter’s run-out is the drawn piece', () => {
    const s = sketchedParabola()
    expect(drawnExtent(s)).toEqual([-3.3, 3.3])
  })

  it('a domain the teacher set (restricted, or an end dragged) is not', () => {
    const s = { ...sketchedParabola(), domain: [0, 3.3] as [number, number] }
    expect(drawnExtent(s)).toBeNull()
  })

  it('typed curves and sketches without ink are never "drawn"', () => {
    expect(drawnExtent(typed('y = x^2').curve)).toBeNull()
    const { sourceStroke: _ink, ...bare } = sketchedParabola()
    expect(drawnExtent(bare)).toBeNull()
  })

  it('the Domain row says "drawn on [a, b]" with an Extend to all x', () => {
    const s = sketchedParabola()
    const panel = {
      role: 'function',
      ownerId: 's',
      name: 'f',
      domain: null,
      range: null,
      oneToOne: null,
      restrict: { kind: 'sketch', domain: s.domain },
      current: null,
      restricted: true,
      chips: [],
      ghost: false,
      hlt: null,
      reflect: false,
      inverse: null,
      drawn: [-3.3, 3.3],
    }
    const actions = { onRestrict: () => null, onGhost: NOOP, onHlt: NOOP, onReflect: NOOP, onShowInverse: NOOP, onAddInverse: NOOP, onNotation: NOOP }
    const html = card(s, MODELS, { domainPanel: panel, domainActions: actions, setNotation: 'interval' })
    expect(html).toContain('data-testid="drawn-extent"')
    expect(html).toContain('drawn on [−3.3, 3.3]')
    expect(html).toContain('Extend to all x')
  })

  it('the App reads a drawn sketch’s facts on its natural domain', () => {
    const src = appSource()
    expect(src).toContain('if (drawnExtent(curve)) curve = { ...curve, domain: null }')
    expect(src).toContain("drawn: restrict.kind === 'sketch' ? drawnExtent(owner) : null")
  })
})

describe('5b · Tidy to nice numbers', () => {
  it('the motivating sketch is offered y = x² − 4, and the card shows the chip', () => {
    const s = sketchedParabola()
    const offer = tidyOffer(s)
    expect(offer?.text).toBe('y = x² − 4')
    expect(offer?.src).toBe('y = x^2 - 4')
    const html = card(s, MODELS)
    expect(html).toContain('data-testid="tidy-offer"')
    expect(html).toContain('Tidy to y = x² − 4')
  })

  it('a typed curve has no Tidy chip', () => {
    const { curve, models } = typed('y = x^2 - 4')
    expect(card(curve, models, { exprSource: 'y = x^2 - 4' })).not.toContain('tidy-offer')
  })
})

describe('5c · Read as: the reading in force, two that fit, the rest behind a disclosure', () => {
  it('at most two alternatives, each fitting at least ALSO_FITS_MIN', () => {
    const q = [1, 0.9, 0.86, 0.61, 0.36, 0.13, 0.06, 0.05]
    expect(readingsShown(q, 0)).toEqual({ also: [1, 2], more: [3, 4, 5, 6, 7] })
    expect(readingsShown([1, 0.4, 0.2], 0)).toEqual({ also: [], more: [1, 2] })
    expect(ALSO_FITS_MIN).toBe(0.5)
  })

  it('the reading in force is never offered as its own alternative', () => {
    expect(readingsShown([1, 0.9, 0.8], 1)).toEqual({ also: [0, 2], more: [] })
  })

  it('fit σ is a tooltip on the reading, not a chip in the header', () => {
    const s = sketchedParabola()
    const cands = [
      { modelId: 'poly2', params: s.params, kind: 'explicit', domain: s.domain, error: 0.012, score: 1 },
      { modelId: 'poly3', params: [s.params[0], s.params[1], s.params[2], 0], kind: 'explicit', domain: s.domain, error: 0.0119, score: 0.9 },
    ]
    const html = card(s, MODELS, { candidates: cands })
    const head = html.slice(0, html.indexOf('card-eq-line'))
    // no "fit σ 0.012" chip in the header any more (a tooltip on the kind label instead)
    expect(head).not.toMatch(/class="err-badge"[^>]*>fit σ/)
    expect(head).toMatch(/class="model-name"[^>]*title="fit σ 0\.012/)
    expect(html).toMatch(/data-testid="readas-current"[^>]*title="[^"]*fit σ 0\.012/)
    expect(html).not.toContain('readas-select')
  })
})

describe('5d · one kind label for sketched and typed curves', () => {
  it('a typed quadratic is a Parabola, like a sketched one', () => {
    const { curve, models } = typed('y = x^2 - 4')
    expect(kindLabel(curve, models[curve.modelId], models, 'y = x^2 - 4')).toBe('Parabola')
    expect(kindLabel(sketchedParabola(), MODELS.poly2, MODELS, null)).toBe('Parabola')
  })

  it('families by their names, and "Function" — never "Expression" — otherwise', () => {
    const cases: [string, string][] = [
      ['y = 2x + 1', 'Line'],
      ['y = x^3 - 3x', 'Cubic'],
      ['y = 2sin(3x) + 1', 'Sinusoid'],
      ['y = e^x', 'Exponential'],
      ['y = ln(x - 1)', 'Logarithm'],
      ['y = sqrt(x)', 'Square root'],
      ['y = |x - 1|', 'Absolute value'],
      ['y = 1/(x - 1)', 'Rational'],
      ['x^2 + y^2 = 9', 'Circle'],
      ['y = x sin(x) + e^x', 'Function'],
    ]
    for (const [src, want] of cases) {
      const { curve, models } = typed(src)
      expect(kindLabel(curve, models[curve.modelId], models, src), src).toBe(want)
    }
  })

  it('the card heading uses it', () => {
    const { curve, models } = typed('y = x^2 - 4')
    const html = card(curve, models, { exprSource: 'y = x^2 - 4' })
    expect(html).toMatch(/class="model-name"[^>]*>Parabola</)
    expect(html).not.toMatch(/class="model-name"[^>]*>Expression</)
  })
})

// ---------------------------------------------------------------------------
// 6. the Transformation section
// ---------------------------------------------------------------------------

describe('6 · the Transformation section is folded and its board marks follow it', () => {
  it('folded by default on a typed x² − 4', () => {
    const { curve, models } = typed('y = x^2 - 4')
    const html = card(curve, models, { exprSource: 'y = x^2 - 4' })
    const t = html.slice(html.indexOf('data-testid="transform-section"'))
    expect(t.match(/aria-expanded="(true|false)"/)?.[1]).toBe('false')
  })

  it('a kind of section nobody has opened reads as closed to the board', () => {
    expect(sectionOpenNow('transform', false)).toBe(false)
  })

  it('the board draws the ghost and marks only while the section is open (or show parent is set)', () => {
    const src = readFileSync(new URL('../src/app/useSelectionMarks.ts', import.meta.url), 'utf8')
    expect(src).toContain("useSectionOpenNow('transform', false)")
    expect(src).toContain('const open = primary && transformSectionOpen')
    expect(src).toContain('const ghost = showParent[c.id] ?? open')
  })

  it('every gallery example that relies on the parent states it explicitly', () => {
    const cat = readFileSync(new URL('../src/examples/catalog.ts', import.meta.url), 'utf8')
    for (const id of ['m3-transformations', 'm2-function-transformations']) {
      const at = cat.indexOf(`id: '${id}'`)
      expect(at, id).toBeGreaterThan(-1)
      const body = cat.slice(at, cat.indexOf('\n  },', at))
      expect(body, id).toContain('showParent: true')
    }
  })
})

// ---------------------------------------------------------------------------
// 7. the empty-state hint
// ---------------------------------------------------------------------------

describe('7 · the empty-state hint sits above the axis on a backing', () => {
  it('upper half, translucent card, not centred on the stage', () => {
    const css = readFileSync(new URL('../src/ui/styles.css', import.meta.url), 'utf8')
    const rule = css.slice(css.indexOf('.empty-hint {'), css.indexOf('}', css.indexOf('.empty-hint {')))
    expect(rule).toContain('top: 25%')
    expect(rule).toContain('translate: -50% -50%')
    expect(rule).toMatch(/background: color-mix/)
    expect(rule).not.toContain('inset: 0')
  })
})

// ---------------------------------------------------------------------------
// 8. set-builder notation
// ---------------------------------------------------------------------------

describe('8 · set-builder notation wraps between clauses', () => {
  it('each clause is one group, with a break allowed after "or"', () => {
    const set = {
      kind: 'intervals',
      parts: [
        { lo: -Infinity, hi: -2, loClosed: false, hiClosed: false, loExact: null, hiExact: null },
        { lo: 2, hi: Infinity, loClosed: false, hiClosed: false, loExact: null, hiExact: null },
      ],
      text: '(−∞, −2) ∪ (2, ∞)',
      tex: '',
      builder: '',
      builderTex: '',
    }
    const tex = builderTex(set as never)
    expect(tex).toContain('{x < -2} \\text{ or } \\allowbreak {x > 2}')
  })

  it('the row lets the formula wrap', () => {
    const css = readFileSync(new URL('../src/ui/styles.css', import.meta.url), 'utf8')
    const rule = css.slice(css.indexOf('.solve-tex {'), css.indexOf('}', css.indexOf('.solve-tex {')))
    expect(rule).toContain('white-space: normal')
  })
})

// ---------------------------------------------------------------------------
// 9. the Riemann wording
// ---------------------------------------------------------------------------

describe('9 · "L₃ = −7 (exact ∫₀³ = −3)"', () => {
  it('x² − 4 on [0, 3] with n = 3', () => {
    const { curve, models } = typed('y = x^2 - 4')
    for (const [method, want] of [
      ['left', 'L₃ = −7 (exact ∫₀³ = −3)'],
      ['right', 'R₃ = 2 (exact ∫₀³ = −3)'],
      ['midpoint', 'M₃ = −3.25 (exact ∫₀³ = −3)'],
      ['trapezoid', 'T₃ = −2.5 (exact ∫₀³ = −3)'],
    ] as const) {
      const r = riemannReadout({ kind: 'riemann', id: 'r', parentId: 'f', from: 0, to: 3, n: 3, method }, curve, models)
      expect(r.text).toBe(want)
      expect(r.text).not.toContain('→')
    }
  })

  it('limits: whole numbers as sub/superscripts, signs included; ∫ₐᵇ otherwise', () => {
    expect(integralLimits(0, 3)).toBe('∫₀³')
    expect(integralLimits(-2, 2)).toBe('∫₋₂²')
    expect(integralLimits(0.5, 3)).toBe('∫ₐᵇ')
  })

  it('"exact" only beside a closed form', () => {
    expect(closedForm(-3)).toBe('−3')
    expect(closedForm(-32 / 3)).toBe('−32/3')
    expect(closedForm(1.2345678)).toBeNull()
    const { curve, models } = typed('y = e^x')
    const r = riemannReadout({ kind: 'riemann', id: 'r', parentId: 'f', from: 0, to: 1, n: 4, method: 'left' }, curve, models)
    expect(r.text).not.toContain('exact')
    expect(r.text).toMatch(/\(∫₀¹ ≈ 1\.718\)$/)
  })
})

// ---------------------------------------------------------------------------
// 10. the sidebar on a document switch
// ---------------------------------------------------------------------------

describe('10 · another document opens at the top of the sidebar', () => {
  it('the App tells the sidebar which document is open; the sidebar scrolls to the top when it changes', () => {
    expect(appSource()).toContain('docId={docMeta.id}')
    const side = readFileSync(new URL('../src/ui/Sidebar.tsx', import.meta.url), 'utf8')
    expect(side).toMatch(/listRef\.current\.scrollTop = 0[\s\S]{0,200}\}, \[docId\]\)/)
  })
})

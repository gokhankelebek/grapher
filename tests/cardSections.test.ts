// ============================================================================
// tests/cardSections.test.ts — the card tidy-up: one section frame
// (src/ui/CardSection.tsx), remembered per KIND in the person's preferences,
// the order of a card (family → Analysis → attached tools in the order they
// were added → Intersections), no domain/range said twice, and the ⋯ menu's
// calculus grouped the way an AP course meets it.
// ============================================================================

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { parseExpression } from '../src/core/parse'
import type { CalcLink } from '../src/core/persist'
import { cardCalc } from '../src/ui/calcLinks'
import type { CalcKind } from '../src/ui/calcLinks'
import { CALC_GROUPS, CurveCard } from '../src/ui/CurveCard'
import {
  CardSection,
  rememberSection,
  resetSectionMemory,
  sectionOpen,
  withoutDomainRange,
} from '../src/ui/CardSection'
import { rootsSummary } from '../src/ui/FactorEditor'
import { limitSummary } from '../src/ui/LimitSection'
import { safeReadFactored } from '../src/ui/factorLinks'
import { safeReadTransform } from '../src/ui/transformLinks'
import { TransformSection } from '../src/ui/TransformEditor'
import { readPrefs, updatePrefs } from '../src/ui/storage'

const NOOP = (): void => {}
const models: Record<string, ModelSpec> = MODELS

/** A Map-backed localStorage, so preferences can be written and read back. */
function stubStorage(): Map<string, string> {
  const m = new Map<string, string>()
  const s = {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size
    },
  }
  ;(globalThis as { localStorage?: unknown }).localStorage = s
  return m
}

beforeEach(() => resetSectionMemory())
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
  resetSectionMemory()
})

// ---------------------------------------------------------------------------
// the frame
// ---------------------------------------------------------------------------

const section = (props: Record<string, unknown>): string =>
  renderToStaticMarkup(
    createElement(
      CardSection,
      { kind: 'taylor', title: 'Taylor', summary: 'P₃ about 0', ...props } as Parameters<typeof CardSection>[0],
      createElement('div', { className: 'inside' }, 'body'),
    ),
  )

describe('CardSection', () => {
  it('is a button with aria-expanded, open by default, the body shown and no summary', () => {
    const html = section({})
    expect(html).toMatch(/<button[^>]*class="cs-toggle"[^>]*aria-expanded="true"/)
    expect(html).toContain('>Taylor<')
    expect(html).toContain('class="inside"')
    expect(html).not.toContain('cs-summary')
  })

  it('collapsed: aria-expanded false, no body, and the summary in the header', () => {
    const html = section({ defaultOpen: false })
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('class="inside"')
    expect(html).toContain('<span class="cs-summary">P₃ about 0</span>')
  })

  it('actions sit beside the toggle, never inside it', () => {
    const html = section({ actions: createElement('button', { className: 'calc-drop' }, '×') })
    const toggle = html.slice(html.indexOf('<button'), html.indexOf('</button>'))
    expect(toggle).not.toContain('calc-drop')
    expect(html).toContain('calc-drop')
  })

  it('a remembered choice for the KIND wins over the default, for every section of that kind', () => {
    rememberSection('taylor', false)
    expect(sectionOpen('taylor', true)).toBe(false)
    expect(section({ defaultOpen: true })).toContain('aria-expanded="false"')
    // Another kind is untouched.
    expect(sectionOpen('limit', true)).toBe(true)
  })

  it('the choice is kept in the preferences, and read back on the next page', () => {
    stubStorage()
    rememberSection('analysis', false)
    expect(readPrefs().sections).toEqual({ analysis: false })
    resetSectionMemory()
    expect(sectionOpen('analysis', true)).toBe(false)
  })

  it('preferences with no section choices, or junk in their place, read as none', () => {
    const m = stubStorage()
    updatePrefs({ showAnalysis: false })
    expect(readPrefs().sections).toEqual({})
    m.set('grapher.v1.prefs', JSON.stringify({ sections: { taylor: 'yes', limit: false, '': true } }))
    expect(readPrefs().sections).toEqual({ limit: false })
  })
})

describe('summaries and filters', () => {
  it('drops only the domain and range lines', () => {
    expect(
      withoutDomainRange(['domain: all real numbers', 'range: y ≥ 0', 'vertex: (0, 0)', 'Range: 2 < y < 12', 'range −1 ≤ y ≤ 1']),
    ).toEqual(['vertex: (0, 0)'])
  })

  it('a folded Roots section still names its zeros and poles', () => {
    expect(rootsSummary(safeReadFactored('y = x^2')!)).toBe('zeros 0 (×2)')
    expect(rootsSummary(safeReadFactored('y = (x-1)/((x+2)(x-3))')!)).toBe('zeros 1 · poles −2, 3')
  })

  it('a folded limit reads "x → 3 = 6"', () => {
    expect(limitSummary({ head: { text: 'lim x→3 f(x) = 6', tex: '' } })).toBe('x → 3 = 6')
    expect(limitSummary({ head: { text: 'lim x→∞ g(x) = 0', tex: '' } })).toBe('x → ∞ = 0')
  })
})

// ---------------------------------------------------------------------------
// the card
// ---------------------------------------------------------------------------

function typedCurve(src: string): { curve: FittedCurve; models: Record<string, ModelSpec> } {
  const outcome = parseExpression(src)
  if (!outcome.ok) throw new Error(outcome.error)
  const spec = outcome.plot.spec as ModelSpec
  return {
    curve: {
      id: 'f',
      modelId: 'expr_1',
      params: outcome.plot.defaultParams.slice(),
      kind: outcome.plot.kind,
      domain: outcome.plot.domain,
      color: '#4f9cf9',
      strokeWidth: 2.5,
      visible: true,
      error: 0,
    },
    models: { expr_1: spec },
  }
}

function card(curve: FittedCurve, m: Record<string, ModelSpec>, over: Record<string, unknown> = {}): string {
  const props = {
    curve,
    style: undefined,
    models: m,
    selected: true,
    candidates: [],
    snapMask: null,
    snapKey: 0,
    shaking: false,
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

const sectionsIn = (html: string): string[] => [...html.matchAll(/data-section="([^"]+)"/g)].map((m) => m[1])

describe('the order of a card', () => {
  it('y = x²: Roots open, the Transformation reading second and folded', () => {
    const { curve, models: m } = typedCurve('y = x^2')
    const html = card(curve, m, { exprSource: 'y = x^2' })
    const kinds = sectionsIn(html)
    expect(kinds.slice(0, 2)).toEqual(['roots', 'transform:secondary'])
    const t = html.slice(html.indexOf('data-testid="transform-section"'))
    expect(t.match(/aria-expanded="(true|false)"/)?.[1]).toBe('false')
  })

  it('y = -2(x-3)^2+1 has no other family: its Transformation opens, as before', () => {
    const src = 'y = -2(x-3)^2+1'
    const { curve, models: m } = typedCurve(src)
    const html = card(curve, m, { exprSource: src })
    expect(sectionsIn(html)[0]).toBe('transform')
    const t = html.slice(html.indexOf('data-testid="transform-section"'))
    expect(t.match(/aria-expanded="(true|false)"/)?.[1]).toBe('true')
  })

  it('attached tools list in the order they were added, not by kind', () => {
    const f: FittedCurve = {
      id: 'f',
      modelId: 'poly2',
      params: [0, 0, 1],
      kind: 'explicit',
      domain: null,
      color: '#4f9cf9',
      strokeWidth: 2.5,
      visible: true,
      error: 0,
    }
    const links: CalcLink[] = [
      { kind: 'riemann', id: 'R', parentId: 'f', from: 0, to: 2, n: 4, method: 'left' },
      { kind: 'secant', id: 'S', parentId: 'f', a: -1, b: 2 },
      { kind: 'limit', id: 'L', parentId: 'f', a: 1 },
      { kind: 'area', id: 'A', parentId: 'f', from: 0, to: 1, abs: false },
    ]
    const calc = cardCalc(links, [f], models, () => 'Parabola').f
    expect(calc.order).toEqual(['R', 'S', 'L', 'A'])
    const html = card(f, models, { calc })
    const tools = sectionsIn(html).filter((k) => ['riemann', 'secant', 'limit', 'area'].includes(k))
    expect(tools).toEqual(['riemann', 'secant', 'limit', 'area'])
    // Each is its own section, with its own × beside the header.
    expect(html.match(/class="calc-drop"/g)?.length).toBe(4)
  })

  it('a CardCalc without an order (an old one) still lists every tool', () => {
    const f: FittedCurve = {
      id: 'f',
      modelId: 'poly2',
      params: [0, 0, 1],
      kind: 'explicit',
      domain: null,
      color: '#4f9cf9',
      strokeWidth: 2.5,
      visible: true,
      error: 0,
    }
    const links: CalcLink[] = [
      { kind: 'secant', id: 'S', parentId: 'f', a: -1, b: 2 },
      { kind: 'riemann', id: 'R', parentId: 'f', from: 0, to: 2, n: 4, method: 'left' },
    ]
    const { order: _o, ...calc } = cardCalc(links, [f], models, () => 'Parabola').f
    void _o
    const html = card(f, models, { calc })
    expect(sectionsIn(html).filter((k) => k === 'secant' || k === 'riemann')).toEqual(['secant', 'riemann'])
  })
})

describe('no domain or range said twice', () => {
  const spec = safeReadTransform('y = -2(x-3)^2+1')!
  const render = (hide: boolean): string =>
    renderToStaticMarkup(
      createElement(TransformSection, {
        spec,
        defaultOpen: true,
        showParent: true,
        onRestate: () => null,
        hideDomainRange: hide,
      }),
    )

  it('the Transformation section keeps its vertex but drops domain and range when Analysis states them', () => {
    const shown = render(false)
    expect(shown).toContain('range: y ≤ 1')
    const hidden = render(true)
    expect(hidden).not.toContain('range: y ≤ 1')
    expect(hidden).not.toContain('domain:')
    expect(hidden).toContain('vertex: (3, 1)')
  })
})

describe('the ⋯ menu', () => {
  it('offers every calculus tool once, grouped in AP order', () => {
    expect(CALC_GROUPS.map((g) => g.title)).toEqual(['Limits & derivatives', 'Integrals', 'Series'])
    const kinds = CALC_GROUPS.flatMap((g) => g.items.map((i) => i.kind))
    const all: CalcKind[] = ['limit', 'secant', 'tangent', 'derivative', 'riemann', 'area', 'accumulation', 'volume', 'taylor']
    for (const k of all) expect(kinds.filter((x) => x === k)).toHaveLength(1)
    expect(kinds).toContain('between')
    expect(kinds.indexOf('limit')).toBeLessThan(kinds.indexOf('tangent'))
    expect(kinds.indexOf('riemann')).toBeLessThan(kinds.indexOf('area'))
    expect(kinds.indexOf('area')).toBeLessThan(kinds.indexOf('volume'))
    expect(kinds[kinds.length - 1]).toBe('taylor')
  })
})

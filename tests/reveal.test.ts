// ============================================================================
// tests/reveal.test.ts — Reveal mode (src/ui/reveal.ts, src/ui/RevealAnswer.tsx).
//
//   keys      stable across re-renders, recomputation and list order
//   order     "reveal next" walks zeros → y-int → extrema → inflections →
//             asymptotes → domain, per curve; then crossings; then calc tools
//   state     next / back / all / reset
//   keyboard  R toggles; → / PageDown, ← / PageUp step only while it is on;
//             no clash with the app's existing letters
//   scene     hidden → a "?" mark in its place; revealed → drawn as before
//   cards     limit, secant, solve, domain: a pill while hidden, the value after
//   export    a figure recorded in reveal mode carries the "?" marks
// ============================================================================

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FittedCurve, ModelSpec, NLSolveItem, SpecialPoint, Viewport } from '../src/core/types'
import { DARK_THEME } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { analyzeCurve } from '../src/core/analyze'
import type { CalcLink } from '../src/core/persist'
import type { RealSet } from '../src/core/domainRange'
import { cardCalc } from '../src/ui/calcLinks'
import { LimitSection } from '../src/ui/LimitSection'
import { SecantSection } from '../src/ui/SecantSection'
import { SolveCard } from '../src/ui/SolveCard'
import { DomainSection } from '../src/ui/DomainSection'
import type { DomainActions, DomainPanel } from '../src/ui/domainLinks'
import type { BoardIntersection, BoardScene } from '../src/ui/renderBoard'
import { renderBoard } from '../src/ui/renderBoard'
import { recordScene } from '../src/ui/vectorExport'
import { toPgfplots } from '../src/ui/pgfplotsExport'
import type { RevealApi } from '../src/ui/RevealAnswer'
import { REVEAL_API_OFF, RevealContext } from '../src/ui/RevealAnswer'
import type { RevealState, SceneReveal } from '../src/ui/reveal'
import {
  REVEAL_OFF,
  applyReveal,
  buildInventory,
  calcKey,
  crossingKeys,
  curvePointKeys,
  domainKey,
  hideAll,
  hideLast,
  isHidden,
  maskSignChart,
  maskTex,
  maskUnitCircle,
  rangeKey,
  revealAll,
  revealCount,
  revealKeyAction,
  revealNext,
  revealOne,
  solveKey,
  splitAnswerTex,
  ucKey,
} from '../src/ui/reveal'
import { MockCtx, withMockPath2D } from './mockCanvas'

const NOOP = (): void => {}

const curve = (id: string, modelId: string, params: number[], color: string): FittedCurve => ({
  id,
  modelId,
  params,
  kind: 'explicit',
  domain: null,
  color,
  strokeWidth: 2.5,
  visible: true,
  error: 0,
})

/** f(x) = x² − 3 and g(x) = x + 1 (ascending coefficients). */
const models: Record<string, ModelSpec> = MODELS
const f = curve('f', 'poly2', [-3, 0, 1], '#4f9cf9')
const g = curve('g', 'line', [1, 1], '#f95f62')

const pt = (kind: SpecialPoint['kind'], x: number, y: number, extra: Partial<SpecialPoint> = {}): SpecialPoint => ({
  kind,
  pos: { x, y },
  label: kind,
  exact: false,
  ...extra,
})

const VP: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 40, widthPx: 800, heightPx: 600 }

// ---------------------------------------------------------------------------
// keys
// ---------------------------------------------------------------------------

describe('answer keys', () => {
  it('rank each point within its kind by x, whatever order the list is in', () => {
    const pts = [pt('zero', 2, 0), pt('maximum', 0, 4), pt('zero', -2, 0), pt('minimum', 1, 1)]
    expect(curvePointKeys('f', pts)).toEqual(['curve:f:zero:1', 'curve:f:max:0', 'curve:f:zero:0', 'curve:f:min:0'])
    const reversed = pts.slice().reverse()
    const keyOf = (list: SpecialPoint[]): Map<number, string> => {
      const keys = curvePointKeys('f', list)
      return new Map(list.map((p, i) => [p.pos.x * 10 + p.pos.y, keys[i]]))
    }
    expect(keyOf(reversed)).toEqual(keyOf(pts))
  })

  it('are the same across re-renders and a fresh analysis of the same curve', () => {
    const a = analyzeCurve(f, models)
    const b = analyzeCurve({ ...f, params: f.params.slice() }, models)
    expect(a.length).toBeGreaterThan(0)
    expect(curvePointKeys('f', a)).toEqual(curvePointKeys('f', b))
    expect(curvePointKeys('f', a)).toContain('curve:f:zero:0')
    expect(curvePointKeys('f', a)).toContain('curve:f:zero:1')
    // the inventory finds a recomputed point (a different object) by where it is
    const inv = buildInventory({ curves: [{ id: 'f', points: a }], crossings: [] })
    const zero = b.find((p) => p.kind === 'zero' && p.pos.x > 0)!
    expect(inv.pointKey('f', zero)).toBe('curve:f:zero:1')
    expect(inv.answerKey('f', zero)).toBe('curve:f:zero:1')
    // a construction mark that is not one of the analyzer's points is no answer
    expect(inv.answerKey('f', pt('extreme', 9, 9))).toBeNull()
  })

  it('name a crossing by its pair, in either order, ranked by x', () => {
    const cross: BoardIntersection[] = [
      { curveId: 'g', point: pt('intersection', 2.56, 3.56, { withId: 'f' }) },
      { curveId: 'f', point: pt('intersection', -1.56, -0.56, { withId: 'g' }) },
    ]
    expect(crossingKeys(cross)).toEqual(['cross:f:g:1', 'cross:f:g:0'])
    const inv = buildInventory({ curves: [], crossings: cross })
    expect(inv.crossKey('g', 'f', cross[1].point)).toBe('cross:f:g:0')
    expect(inv.crossKey('f', 'g', cross[0].point)).toBe('cross:f:g:1')
  })
})

// ---------------------------------------------------------------------------
// teaching order
// ---------------------------------------------------------------------------

describe('reveal next: the teaching order', () => {
  const inv = buildInventory({
    curves: [
      {
        id: 'f',
        points: [pt('inflection', 0, 0), pt('maximum', -1, 2), pt('zero', 1.7, 0), pt('y-intercept', 0, 0), pt('minimum', 1, -2), pt('zero', -1.7, 0)],
        asymptotes: 1,
        domain: true,
        calc: ['L1', 'S1'],
      },
      { id: 'g', points: [pt('zero', -1, 0), pt('y-intercept', 0, 1)], calc: ['T1'] },
    ],
    crossings: [
      { curveId: 'f', point: pt('intersection', 2, 3, { withId: 'g' }) },
      { curveId: 'f', point: pt('intersection', -1, 0.5, { withId: 'g' }) },
    ],
    after: ['solve:n1:solution', 'uc:u1:values'],
  })

  it('per curve: zeros, y-intercept, extrema, inflections, asymptotes, domain; then crossings, calc, the rest', () => {
    expect(inv.order).toEqual([
      'curve:f:zero:0',
      'curve:f:zero:1',
      'curve:f:yint:0',
      'curve:f:max:0',
      'curve:f:min:0',
      'curve:f:infl:0',
      'curve:f:asym:0',
      'curve:f:domain',
      'curve:f:range',
      'curve:g:zero:0',
      'curve:g:yint:0',
      'cross:f:g:0',
      'cross:f:g:1',
      'calc:L1:value',
      'calc:S1:value',
      'calc:T1:value',
      'solve:n1:solution',
      'uc:u1:values',
    ])
  })

  it('next walks that order, back takes the last one back, all and reset', () => {
    let s: RevealState = { ...REVEAL_OFF, on: true }
    const seen: string[] = []
    for (let i = 0; i < 3; i++) {
      const r = revealNext(s, inv.order)
      s = r.state
      seen.push(r.key!)
    }
    expect(seen).toEqual(['curve:f:zero:0', 'curve:f:zero:1', 'curve:f:yint:0'])
    // a click out of order is skipped by next
    s = revealOne(s, 'curve:f:min:0')
    expect(revealNext(s, inv.order).key).toBe('curve:f:max:0')
    s = hideLast(s)
    expect(isHidden(s, 'curve:f:min:0')).toBe(true)
    expect(revealCount(s, inv.order)).toEqual({ hidden: inv.order.length - 3, total: inv.order.length })
    s = revealAll(s, inv.order)
    expect(revealCount(s, inv.order).hidden).toBe(0)
    expect(isHidden(s, 'some:key:that:appeared:later')).toBe(false)
    expect(revealNext(s, inv.order).key).toBeNull()
    s = hideAll(s)
    expect(revealCount(s, inv.order).hidden).toBe(inv.order.length)
    expect(isHidden({ ...s, on: false }, 'curve:f:zero:0')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// keyboard
// ---------------------------------------------------------------------------

describe('the keys', () => {
  const k = (key: string, mods: Record<string, boolean> = {}) => ({ key, ...mods })

  it('R toggles; ⌘R / Ctrl+R stay the browser’s reload', () => {
    expect(revealKeyAction(k('r'), false)).toBe('toggle')
    expect(revealKeyAction(k('R'), true)).toBe('toggle')
    expect(revealKeyAction(k('r', { metaKey: true }), false)).toBeNull()
    expect(revealKeyAction(k('r', { ctrlKey: true }), false)).toBeNull()
  })

  it('→ / PageDown and ← / PageUp step only while reveal mode is on; Shift+arrow still nudges', () => {
    expect(revealKeyAction(k('ArrowRight'), false)).toBeNull()
    expect(revealKeyAction(k('PageDown'), false)).toBeNull()
    expect(revealKeyAction(k('ArrowRight'), true)).toBe('next')
    expect(revealKeyAction(k('PageDown'), true)).toBe('next')
    expect(revealKeyAction(k('ArrowLeft'), true)).toBe('back')
    expect(revealKeyAction(k('PageUp'), true)).toBe('back')
    expect(revealKeyAction(k('ArrowRight', { shiftKey: true }), true)).toBeNull()
    expect(revealKeyAction(k('ArrowUp'), true)).toBeNull()
  })

  it('takes none of the app’s other keys', () => {
    for (const key of ['a', 'f', 'P', 'z', 'y', '\\', ' ', 'Escape', 'Delete', 'Backspace']) {
      expect(revealKeyAction(k(key), true)).toBeNull()
    }
    // and no other shortcut in the App is bound to R
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
    const letters = [...app.matchAll(/key === '([a-z])'/g)].map((m) => m[1])
    expect(letters).not.toContain('r')
    expect(new Set(letters)).toEqual(new Set(['z', 'y', 'a', 'p', 'f']))
  })
})

// ---------------------------------------------------------------------------
// the scene
// ---------------------------------------------------------------------------

function sceneOf(over: Partial<BoardScene> = {}): BoardScene {
  return {
    vp: VP,
    theme: DARK_THEME,
    curves: [f, g],
    styles: {},
    models,
    analysis: { curve: f, points: analyzeCurve(f, models) },
    intersections: [
      { curveId: 'f', point: pt('intersection', (1 - Math.sqrt(17)) / 2, (3 - Math.sqrt(17)) / 2, { withId: 'g' }) },
      { curveId: 'f', point: pt('intersection', (1 + Math.sqrt(17)) / 2, (3 + Math.sqrt(17)) / 2, { withId: 'g' }) },
    ],
    ...over,
  }
}

function sceneReveal(state: RevealState, scene: BoardScene, extra: Partial<SceneReveal> = {}): SceneReveal {
  const inv = buildInventory({
    curves: [{ id: 'f', points: scene.analysis!.points }],
    crossings: scene.intersections ?? [],
  })
  return {
    hidden: (key) => isHidden(state, key),
    positions: state.positions,
    pointKey: inv.answerKey,
    crossKey: inv.crossKey,
    ...extra,
  }
}

describe('the scene filter', () => {
  const ON: RevealState = { ...REVEAL_OFF, on: true }

  it('takes a hidden answer out and puts a "?" where it was', () => {
    const scene = sceneOf()
    const n = scene.analysis!.points.length
    const out = applyReveal(scene, sceneReveal(ON, scene))
    expect(out.analysis).toBeNull()
    expect(out.intersections).toEqual([])
    expect(out.revealMarks?.length).toBe(n + 2)
    const zero = out.revealMarks!.find((m) => m.key === 'curve:f:zero:1')!
    expect(zero.pos.x).toBeCloseTo(Math.sqrt(3), 6)
    expect(zero.color).toBe(f.color)
  })

  it('a revealed answer is drawn exactly as before, and keeps its place in the list', () => {
    const scene = sceneOf()
    const s = revealOne(revealOne(ON, 'curve:f:zero:1'), 'cross:f:g:0')
    const out = applyReveal(scene, sceneReveal(s, scene))
    expect(out.analysis!.points.map((p) => p.kind)).toEqual(['zero'])
    expect(out.analysis!.points[0]).toBe(scene.analysis!.points.find((p) => p.kind === 'zero' && p.pos.x > 0))
    expect(out.intersections).toEqual([scene.intersections![0]])
    expect(out.revealMarks!.some((m) => m.key === 'curve:f:zero:1')).toBe(false)
  })

  it('"hide positions" leaves no "?" at all', () => {
    const scene = sceneOf()
    const out = applyReveal(scene, sceneReveal({ ...ON, positions: false }, scene))
    expect(out.revealMarks).toBeUndefined()
    expect(out.analysis).toBeNull()
  })

  it('reveal mode off (no filter) is the very same scene', () => {
    const scene = sceneOf()
    expect(applyReveal(scene, null)).toBe(scene)
  })

  it('remaps the hovered / highlighted row onto the filtered list', () => {
    const scene = sceneOf({
      chrome: { selectedId: 'f', handles: [], activeHandleId: null, highlight: null, openIdx: null, hoverIdx: null },
    })
    const pts = scene.analysis!.points
    const zi = pts.findIndex((p) => p.kind === 'zero' && p.pos.x > 0)
    const other = pts.findIndex((p, i) => i !== zi)
    const s = revealOne(ON, 'curve:f:zero:1')
    const out = applyReveal(
      { ...scene, chrome: { ...scene.chrome!, highlight: zi, hoverIdx: other } },
      sceneReveal(s, scene),
    )
    expect(out.chrome!.highlight).toBe(0)
    expect(out.chrome!.hoverIdx).toBeNull()
  })

  it('a calculus chip that states an answer becomes a "?"; one that names a thing stays', () => {
    const scene = sceneOf({
      overlays: [
        { kind: 'label', curveId: 'f', at: { x: 1, y: -2 }, text: 'c = 1', answer: calcKey('S1') },
        { kind: 'label', curveId: 'f', at: { x: 0, y: 0 }, text: 'R' },
        { kind: 'dot', curveId: 'f', at: { x: 1, y: -2 } },
      ],
    })
    const out = applyReveal(scene, sceneReveal(ON, scene))
    expect(out.overlays!.map((o) => o.kind)).toEqual(['label', 'dot'])
    expect(out.revealMarks!.some((m) => m.key === 'calc:S1:value' && m.pos.x === 1)).toBe(true)
    const back = applyReveal(scene, sceneReveal(revealOne(ON, 'calc:S1:value'), scene))
    expect(back.overlays!.length).toBe(3)
  })

  it('a unit circle keeps θ and says "?" for its exact values; a sign chart becomes a blank', () => {
    const uc = maskUnitCircle({
      id: 'u',
      visible: true,
      center: { x: 0, y: 0 },
      theta: (5 * Math.PI) / 6,
      color: '#fff',
      pointText: '(−√3/2, 1/2)',
      cosText: '−√3/2',
      sinText: '1/2',
      thetaText: 'θ = 5π/6',
      refText: 'θ′ = π/6',
      tanValue: -0.577,
      tanText: 'tan θ = −√3/3',
      show: { triangle: true, ref: true, astc: false, tan: true },
      unwrap: null,
      inv: null,
    })
    expect(uc.thetaText).toBe('θ = 5π/6')
    expect([uc.pointText, uc.cosText, uc.sinText, uc.refText, uc.tanText]).toEqual(['(?, ?)', '?', '?', 'θ′ = ?', 'tan θ = ?'])
    expect(ucKey('u')).toBe('uc:u:values')
    const chart = maskSignChart({
      id: 'S',
      color: '#fff',
      rows: [{ label: 'f′', kind: 'sign', marks: [], intervals: [{ from: -Infinity, to: 0, sign: -1 }, { from: 0, to: Infinity, sign: 1 }] }],
      ticks: [{ x: 0, text: '0' }],
      guides: false,
    })
    expect(chart.rows[0].intervals.map((i) => i.sign)).toEqual([null, null])
    expect(chart.ticks[0].text).toBe('?')
  })

  it('a number line draws a hidden solve as its bare line, with "?" at its critical values', () => {
    const item: NLSolveItem = { kind: 'solve', id: 'n1', src: 'x^2 - 4 > 0', color: '#4f9cf9', show: {} }
    const scene: BoardScene = { vp: VP, theme: DARK_THEME, kind: 'number-line', items: [item], curves: [], styles: {}, models: {} }
    const r: SceneReveal = {
      hidden: (key) => isHidden(ON, key),
      positions: true,
      pointKey: () => null,
      crossKey: () => '',
      nlMarks: () => [-2, 2],
    }
    const out = applyReveal(scene, r)
    expect([...(out.nlHidden ?? [])]).toEqual(['n1'])
    expect(out.revealMarks!.map((m) => [m.key, m.pos.x, m.nl])).toEqual([
      [solveKey('n1'), -2, true],
      [solveKey('n1'), 2, true],
    ])
    const open = applyReveal(scene, { ...r, hidden: () => false })
    expect(open.nlHidden).toBeUndefined()
  })

  it('the renderer draws a "?" for each mark, and nothing new without them', () => {
    const scene = sceneOf()
    const draw = (s: BoardScene): MockCtx =>
      withMockPath2D(() => {
        const ctx = new MockCtx()
        renderBoard(ctx as unknown as CanvasRenderingContext2D, s)
        return ctx
      })
    const marked = draw(applyReveal(scene, sceneReveal(ON, scene)))
    const plain = draw(scene)
    const q = (c: MockCtx): number => c.texts.filter((t) => t.text === '?').length
    expect(q(marked)).toBe(scene.analysis!.points.length + 2)
    expect(q(plain)).toBe(0)
  })

  it('a just-revealed answer gets a fading ring, a stale one none', () => {
    const scene = sceneOf()
    const s = revealOne(ON, 'curve:f:zero:1')
    const fresh = new Map([['curve:f:zero:1', 1000]])
    const now = applyReveal(scene, sceneReveal(s, scene, { fresh, now: 1100 }))
    expect(now.revealPulses?.length).toBe(1)
    expect(now.revealPulses![0].age).toBeCloseTo(100 / 450, 6)
    const later = applyReveal(scene, sceneReveal(s, scene, { fresh, now: 5000 }))
    expect(later.revealPulses).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

describe('an export taken in reveal mode is the student copy', () => {
  const ON: RevealState = { ...REVEAL_OFF, on: true }
  const figure = (): BoardScene => ({ ...sceneOf(), printColors: true, chrome: null })

  it('SVG / PDF / TikZ (the display list) carry the "?" marks and none of the hidden values', () => {
    const scene = figure()
    const s = revealOne(ON, 'curve:f:zero:1')
    const list = recordScene(applyReveal(scene, sceneReveal(s, scene)), 24)
    const texts = list.items.filter((i) => i.t === 'text').map((i) => (i as { text: string }).text)
    expect(texts.filter((t) => t === '?').length).toBe(scene.analysis!.points.length - 1 + 2)
    expect(texts.some((t) => t.includes('√3'))).toBe(true)
    expect(texts.some((t) => t.includes('−√3'))).toBe(false)
    const plain = recordScene(scene, 24).items.filter((i) => i.t === 'text').map((i) => (i as { text: string }).text)
    expect(plain).not.toContain('?')
  })

  it('pgfplots writes each "?" as a node at its point', () => {
    const scene = figure()
    const tex = toPgfplots(applyReveal(scene, sceneReveal(ON, scene)), { widthCm: 8, sources: { f: 'y = x^2 - 3', g: 'y = x + 1' } })
    expect(tex).toMatch(/\\node\[circle[^\]]*\] at \(axis cs:1\.732\d*,0\) \{\?\};/)
    expect(toPgfplots(scene, { widthCm: 8 })).not.toContain('{?}')
  })
})

// ---------------------------------------------------------------------------
// cards
// ---------------------------------------------------------------------------

function api(state: RevealState): RevealApi {
  return { ...REVEAL_API_OFF, on: state.on, hidden: (key) => isHidden(state, key) }
}
const inReveal = (state: RevealState | null, el: ReactElement): string =>
  renderToStaticMarkup(state ? createElement(RevealContext.Provider, { value: api(state) }, el) : el)

describe('cards: a Reveal pill while hidden, the value once revealed', () => {
  const ON: RevealState = { ...REVEAL_OFF, on: true }
  const links: CalcLink[] = [
    { kind: 'limit', id: 'L', parentId: 'f', a: 1 },
    { kind: 'secant', id: 'S', parentId: 'f', a: -1, b: 2 },
  ]
  const calc = cardCalc(links, [f], models, () => 'f').f

  it('limit', () => {
    const row = calc.limits[0]
    const el = createElement(LimitSection, { row, onCalcChange: NOOP, onRemove: NOOP, onEditStart: NOOP, onEditEnd: NOOP })
    const off = inReveal(null, el)
    expect(inReveal(REVEAL_OFF, el)).toBe(off)
    const hidden = inReveal(ON, el)
    expect(hidden).toContain('data-testid="reveal-pill"')
    expect(hidden).toContain('data-reveal-key="calc:L:value"')
    expect(hidden).not.toContain(row.fa ?? '§')
    const shown = inReveal(revealOne(ON, 'calc:L:value'), el)
    expect(shown).not.toContain('reveal-pill')
    expect(shown).toContain('reveal-in')
    if (row.fa) expect(shown).toContain(row.fa)
  })

  it('secant: the question stays, the value hides', () => {
    const row = calc.secants[0]
    const el = createElement(SecantSection, { row, onCalcChange: NOOP, onRemove: NOOP })
    const hidden = inReveal(ON, el)
    expect(hidden).toContain('data-reveal-key="calc:S:value"')
    // a and b are the teacher's: still there to read
    expect(hidden).toContain(`>${row.aText}<`)
    expect(hidden).toContain(`>${row.bText}<`)
    const shown = inReveal(revealOne(ON, 'calc:S:value'), el)
    expect(shown).not.toContain('reveal-pill')
  })

  it('solve: the inequality as typed stays, the solution set hides', () => {
    const item: NLSolveItem = { kind: 'solve', id: 'n1', src: 'x^2 - 4 > 0', color: '#4f9cf9', show: {} }
    const el = createElement(SolveCard, {
      item,
      style: undefined,
      selected: false,
      onSelect: NOOP,
      onDelete: NOOP,
      onCycleColor: NOOP,
      onLabel: NOOP,
      onEquationCommit: () => null,
      onShow: NOOP,
      onShowOnGraph: () => null,
      onWidth: NOOP,
      onStyleEditStart: NOOP,
      onStyleEditEnd: NOOP,
    })
    const off = inReveal(null, el)
    expect(off).toContain('solve-tex')
    const hidden = inReveal(ON, el)
    expect(hidden).toContain(`data-reveal-key="${solveKey('n1')}"`)
    expect(hidden).not.toContain('solve-tex')
    expect(hidden).toContain('card-latex')
    const shown = inReveal(revealOne(ON, solveKey('n1')), el)
    expect(shown).toContain('solve-tex')
  })

  it('domain: domain and range are separate answers', () => {
    const set = (text: string): RealSet => ({ kind: 'intervals', parts: [], text, tex: text, builder: text, builderTex: text })
    const panel: DomainPanel = {
      role: 'function',
      ownerId: 'f',
      name: 'f',
      domain: set('(−∞, ∞)'),
      range: set('[−3, ∞)'),
      oneToOne: null,
      restrict: { kind: 'typed', cond: null },
      current: null,
      restricted: false,
      chips: [],
      ghost: false,
      hlt: null,
      reflect: false,
      inverse: null,
    }
    const actions = new Proxy({}, { get: () => () => null }) as DomainActions
    const el = createElement(DomainSection, { panel, actions, notation: 'interval' })
    const hidden = inReveal(revealOne(ON, domainKey('f')), el)
    expect(hidden).toContain('(−∞, ∞)')
    expect(hidden).not.toContain('[−3, ∞)')
    expect(hidden).toContain(`data-reveal-key="${rangeKey('f')}"`)
    const shown = inReveal(revealOne(revealOne(ON, domainKey('f')), rangeKey('f')), el)
    expect(shown).toContain('[−3, ∞)')
  })
})

describe('TeX', () => {
  it('splits a line at its first top-level "=", never inside braces', () => {
    expect(splitAnswerTex('\\lim_{x\\to 3} f(x) = 6')).toEqual(['\\lim_{x\\to 3} f(x)', '6'])
    expect(splitAnswerTex('\\frac{a=b}{c} = 2')).toEqual(['\\frac{a=b}{c}', '2'])
    expect(splitAnswerTex('\\int_0^1 f \\approx 0.33')).toEqual(['\\int_0^1 f', '0.33'])
    expect(splitAnswerTex('x^2')).toBeNull()
    expect(maskTex('P_3(x) = 1 + x')).toBe('P_3(x) = \\,?')
  })
})

describe('persistence: session-only', () => {
  it('nothing about reveal mode reaches a document or the prefs', () => {
    const src = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8')
    for (const p of ['../src/ui/reveal.ts', '../src/ui/RevealAnswer.tsx', '../src/ui/RevealControls.tsx']) {
      expect(src(p)).not.toMatch(/from '\.\/(storage|persist)'|from '\.\.\/core\/persist'(?!.*type)/)
    }
    // the App keeps it in React state and a session Map, and never names it to storage
    const app = src('../src/App.tsx')
    expect(app).not.toMatch(/updatePrefs\([^)]*reveal/i)
    expect(app).not.toMatch(/serializeDoc\([^)]*reveal/i)
    expect(src('../src/core/persist.ts')).not.toMatch(/reveal/i)
  })
})

// ============================================================================
// tests/relatedRates.test.ts — related rates (AP Calculus Unit 4).
//
// The five scenarios against answers worked by hand, "when x = 6" solved for
// t, the unknown rate checked against a difference quotient of the motion
// itself, the play clock (and its pause at the instant), persistence (old
// documents byte-for-byte unchanged), and the drawing — in colour, all black
// under SAT, and in the SVG export.
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { FitResult } from '../src/core/types'
import { DARK_THEME, FIGURE_STYLES } from '../src/core/types'
import { RR_DEFS, cleanParams, defaultParams, rateForm, rrState, solveWhen } from '../src/core/relatedRates'
import type { RRScenario } from '../src/core/relatedRates'
import {
  RR_COLOR_DEFAULT,
  deserializeDoc,
  docFromBoard,
  relatedRatesToStored,
  serializeDoc,
  storedToRelatedRates,
} from '../src/core/persist'
import type { BoardInput, BoardRelatedRates, DocMeta, StoredDoc } from '../src/core/persist'
import {
  newRelatedRates,
  relatedRatesBox,
  relatedRatesCard,
  relatedRatesFigure,
  rrPlayStart,
  rrPlayStep,
  switchScenario,
} from '../src/ui/relatedRatesLinks'
import { renderBoard } from '../src/ui/renderBoard'
import type { BoardScene } from '../src/ui/renderBoard'
import { MODELS } from '../src/core/fit/models'
import { MockCtx, withMockPath2D } from './mockCanvas'
import { recordScene } from '../src/ui/vectorExport'
import { toSvg } from '../src/render/vectorSvg'

/** The state at the instant `q = v`. */
function at(s: RRScenario, p: Record<string, number>, q: string, v: number) {
  const w = solveWhen(s, p, q, v)
  if (!w.ok) throw new Error(w.error)
  return rrState(s, p, w.t)
}

describe('the five scenarios, worked by hand', () => {
  // x² + y² = 100 at x = 6: y = 8.  2x x′ + 2y y′ = 0 ⇒ y′ = −(6/8)(2) = −3/2.
  it('ladder: L = 10, dx/dt = 2, at x = 6 → y = 8, dy/dt = −3/2', () => {
    const s = at('ladder', { ...defaultParams('ladder'), L: 10, c: 2 }, 'x', 6)
    expect(s.q.x).toBeCloseTo(6, 12)
    expect(s.q.y).toBeCloseTo(8, 12)
    expect(s.unknown).toBeCloseTo(-1.5, 12)
    expect(rateForm(s.unknown).exact?.text).toBe('−3/2')
  })

  // r/h = 2/4 ⇒ at h = 2, r = 1.  dV/dt = πr² dh/dt ⇒ dh/dt = 3/(π·1²) = 3/π.
  it('cone: R = 2, H = 4, dV/dt = 3, at h = 2 → r = 1, dh/dt = 3/π', () => {
    const s = at('cone', { ...defaultParams('cone'), R: 2, H: 4, k: 3 }, 'h', 2)
    expect(s.q.h).toBeCloseTo(2, 10)
    expect(s.q.r).toBeCloseTo(1, 10)
    expect(s.unknown).toBeCloseTo(3 / Math.PI, 10)
    expect(rateForm(s.unknown).exact?.text).toBe('3/π')
    expect(rateForm(-3 / Math.PI).exact?.text).toBe('−3/π')
  })

  it('cone, draining: dh/dt = −3/π at h = 2, and the depth falls', () => {
    const p = { ...defaultParams('cone'), k: -3, h0: 3.6 }
    const s = at('cone', p, 'h', 2)
    expect(s.unknown).toBeCloseTo(-3 / Math.PI, 10)
    expect(rrState('cone', p, 1).q.h).toBeLessThan(rrState('cone', p, 0).q.h)
  })

  // (H − p) s′ = p x′ ⇒ s′ = 6·5/9 = 10/3;  (x + s)′ = H x′/(H − p) = 75/9 = 25/3.
  it('shadow: H = 15, p = 6, v = 5 → ds/dt = 10/3, the tip at 25/3', () => {
    const s = rrState('shadow', { ...defaultParams('shadow'), H: 15, p: 6, v: 5 }, 1)
    expect(s.unknown).toBeCloseTo(10 / 3, 12)
    expect(s.extra).toBeCloseTo(25 / 3, 12)
    expect(rateForm(s.unknown).exact?.text).toBe('10/3')
    expect(rateForm(s.extra!).exact?.text).toBe('25/3')
    // s/p = (x + s)/H holds on the model.
    expect(s.q.s / 6).toBeCloseTo((s.q.x + s.q.s) / 15, 12)
  })

  // dA/dt = 2π·5·2 = 20π.
  it('ripple: dr/dt = 2 at r = 5 → dA/dt = 20π', () => {
    const s = at('ripple', { c: 2, r0: 1 }, 'r', 5)
    expect(s.unknown).toBeCloseTo(20 * Math.PI, 10)
    expect(rateForm(s.unknown).exact?.text).toBe('20π')
  })

  // dr/dt = 100/(4π·25) = 1/π.
  it('balloon: dV/dt = 100 at r = 5 → dr/dt = 1/π', () => {
    const s = at('balloon', { k: 100, r0: 1 }, 'r', 5)
    expect(s.unknown).toBeCloseTo(1 / Math.PI, 10)
    expect(rateForm(s.unknown).exact?.text).toBe('1/π')
  })

  it('every unknown rate is the derivative of the motion itself', () => {
    const checks: [RRScenario, string][] = [
      ['ladder', 'y'],
      ['cone', 'h'],
      ['shadow', 's'],
      ['ripple', 'A'],
      ['balloon', 'r'],
    ]
    for (const [sc, q] of checks) {
      const p = defaultParams(sc)
      const T = RR_DEFS[sc].tMax(p)
      for (const f of [0.2, 0.5, 0.8]) {
        const t = f * T
        const h = 1e-5 * Math.max(1, T)
        const num = (rrState(sc, p, t + h).q[q] - rrState(sc, p, t - h).q[q]) / (2 * h)
        expect(rrState(sc, p, t).unknown, `${sc} at t = ${t}`).toBeCloseTo(num, 4)
      }
    }
  })

  it('"when" says so when the quantity never gets there', () => {
    const w = solveWhen('ladder', defaultParams('ladder'), 'x', 50)
    expect(w.ok).toBe(false)
    if (!w.ok) expect(w.error).toMatch(/never equals 50/)
    expect(solveWhen('ladder', defaultParams('ladder'), 'z', 1).ok).toBe(false)
  })

  it('cleans untrusted givens: unknown keys dropped, out of range clamped, junk defaulted', () => {
    expect(cleanParams('ladder', { L: 1e9, c: 'fast', x0: 2, extra: 5 })).toEqual({ L: 100, c: 2, x0: 2 })
  })
})

describe('the card', () => {
  it('a new problem is the AP ladder, already at x = 6', () => {
    const rr = newRelatedRates('R1')
    const card = relatedRatesCard(rr)
    expect(card.state.q.x).toBeCloseTo(6, 10)
    expect(card.unknown?.text).toBe('−3/2')
    expect(card.answer).toBe('When x = 6 ft, dy/dt = −3/2 ft/s: y is decreasing at 3/2 ft/s.')
    expect(card.relationWith.text).toBe('x² + y² = 100')
    expect(card.def.derivative.text).toBe('2x·dx/dt + 2y·dy/dt = 0')
    expect(card.substituted?.text).toBe('dy/dt = −(6/8)(2)')
  })

  it('switching scenario brings that scenario’s own givens and question', () => {
    const cone = switchScenario({ ...newRelatedRates('R1'), graph: false }, 'cone')
    expect(cone.params).toEqual(defaultParams('cone'))
    expect(cone.when).toEqual({ q: 'h', v: 2 })
    expect(cone.graph).toBe(false)
    expect(relatedRatesCard(cone).unknown?.text).toBe('3/π')
  })
})

describe('play', () => {
  it('runs 0 → tMax in about eight seconds at 1×, and stops at the end', () => {
    const T = 4.4
    let t = 0
    let frames = 0
    for (;;) {
      const s = rrPlayStep(t, 1 / 60, 1, T)
      t = s.t
      frames++
      if (s.done) break
    }
    expect(t).toBe(T)
    expect(frames / 60).toBeGreaterThan(3)
    expect(frames / 60).toBeLessThan(9)
  })

  it('pauses exactly at the instant when asked', () => {
    expect(rrPlayStep(2.49, 0.1, 1, 4.4, 2.5)).toEqual({ t: 2.5, done: true })
    expect(rrPlayStep(2.5, 0.1, 1, 4.4, 2.5).done).toBe(false)
    expect(rrPlayStart(4.4, 4.4)).toBe(0)
    expect(rrPlayStart(1, 4.4)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const META: DocMeta = { id: 'doc1', name: 'Rates', createdAt: 1000, modifiedAt: 1000 }

function board(over: Partial<BoardInput> = {}): BoardInput {
  return {
    curves: [],
    styles: {},
    candidates: new Map<string, FitResult[]>(),
    exprSources: {},
    viewport: { center: { x: 0, y: 0 }, pxPerUnit: 60 },
    selectedId: null,
    mode: 'draw',
    ...over,
  }
}

describe('persistence', () => {
  it('writes the scenario, givens, t and question — defaults omitted', () => {
    const rr = newRelatedRates('R1')
    expect(relatedRatesToStored(rr)).toEqual({
      id: 'R1',
      scenario: 'ladder',
      params: { L: 10, c: 2, x0: 1 },
      t: rr.t,
      when: { q: 'x', v: 6 },
    })
    expect(rr.color).toBe(RR_COLOR_DEFAULT)
  })

  it('a document without one serialises byte-for-byte as before', () => {
    const plain = board()
    const a = serializeDoc(docFromBoard(META, plain, 2000))
    expect(serializeDoc(docFromBoard(META, { ...plain, relatedRates: [] }, 2000))).toBe(a)
    expect(a).not.toContain('relatedRates')
    const back = deserializeDoc(a)
    expect(back.board!.relatedRates).toEqual([])
    expect(serializeDoc(docFromBoard(META, { ...plain, relatedRates: back.board!.relatedRates }, 2000))).toBe(a)
  })

  it('round-trips every field, as a single object on the board', () => {
    const rr: BoardRelatedRates = {
      ...switchScenario(newRelatedRates('R1'), 'cone'),
      params: { R: 2, H: 4, k: -3, h0: 3.6 },
      t: 1.2345678901234,
      pause: true,
      graph: false,
      color: '#f95f62',
      hidden: true,
    }
    const json = serializeDoc(docFromBoard(META, board({ relatedRates: [rr], selectedId: 'R1' }), 2000))
    const raw = JSON.parse(json) as StoredDoc
    expect(Array.isArray(raw.board.relatedRates)).toBe(false)
    const back = deserializeDoc(json)
    expect(back.degraded).toBe(false)
    expect(back.board!.relatedRates).toEqual([rr])
    expect(back.board!.selectedId).toBe('R1')
  })

  it('drops an unreadable record and says so', () => {
    const json = serializeDoc(docFromBoard(META, board({ relatedRates: [newRelatedRates('R1')] }), 2000))
    const raw = JSON.parse(json) as StoredDoc
    ;(raw.board as unknown as Record<string, unknown>).relatedRates = { id: 'R1', scenario: 'trebuchet', params: {}, t: 0 }
    const back = deserializeDoc(JSON.stringify(raw))
    expect(back.board!.relatedRates).toEqual([])
    expect(back.degraded).toBe(true)
    expect(back.problems.join(' ')).toMatch(/related-rates problem could not be restored/)
    expect(storedToRelatedRates(null)).toEqual({ error: 'it was not readable' })
    const odd = storedToRelatedRates({ id: 'R', scenario: 'ladder', params: { L: -5 }, t: 'soon', when: { q: 'h', v: 2 } })
    expect('rr' in odd && odd.rr).toMatchObject({ params: { L: 1, c: 2, x0: 1 }, t: 0 })
    expect('rr' in odd && odd.rr.when).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

const VP = { center: { x: 8, y: 5 }, pxPerUnit: 30, widthPx: 1000, heightPx: 600 }

function scene(rr: BoardRelatedRates, over: Partial<BoardScene> = {}): BoardScene {
  return {
    vp: VP,
    theme: DARK_THEME,
    curves: [],
    styles: {},
    models: MODELS,
    analysis: null,
    chrome: null,
    relatedRates: [relatedRatesFigure(rr)],
    ...over,
  }
}

function render(s: BoardScene): MockCtx {
  const ctx = new MockCtx()
  withMockPath2D(() => renderBoard(ctx as unknown as CanvasRenderingContext2D, s))
  return ctx
}

describe('drawing', () => {
  it('the ladder at x = 6: live values and rates on the picture, and the mini-graph', () => {
    const texts = render(scene(newRelatedRates('R1'))).texts.map((t) => t.text)
    for (const t of ['x = 6.0 ft', 'y = 8.0 ft', 'L = 10.0 ft', 'dx/dt = 2 ft/s', 'dy/dt = −3/2 ft/s', 't = 2.50 s · dy/dt = −3/2 ft/s']) {
      expect(texts, t).toContain(t)
    }
    expect(texts.some((t) => t.startsWith('dy/dt (ft/s)'))).toBe(true)
  })

  it('every scenario draws, and a hidden one draws nothing', () => {
    for (const sc of ['cone', 'shadow', 'ripple', 'balloon'] as const) {
      const rr = switchScenario(newRelatedRates('R1'), sc)
      const ctx = render(scene(rr))
      expect(ctx.texts.length, sc).toBeGreaterThan(3)
    }
    const hidden = render(scene({ ...newRelatedRates('R1'), hidden: true }))
    const none = render(scene(newRelatedRates('R1'), { relatedRates: undefined }))
    expect(hidden.texts).toEqual(none.texts)
  })

  it('under SAT: every stroke and word is black (or the white ground)', () => {
    const sat = FIGURE_STYLES.sat
    const ctx = render(scene(switchScenario(newRelatedRates('R1'), 'cone'), { figure: sat, theme: sat.theme }))
    const allowed = new Set([sat.theme.axis, sat.theme.bg, sat.theme.gridMinor, sat.theme.gridMajor, sat.theme.label, '#888888'])
    const off = [...ctx.strokeStyles, ...ctx.fillStyles].filter((c) => !allowed.has(c))
    expect(off).toEqual([])
  })

  it('reaches the SVG export through the same renderer', () => {
    const svg = toSvg(recordScene(scene(newRelatedRates('R1'), { figure: FIGURE_STYLES.sat, theme: FIGURE_STYLES.sat.theme }), 16))
    expect(svg).toContain('dy/dt = −3/2 ft/s')
    expect(svg).toContain('x = 6.0 ft')
  })

  it('the frame holds the whole run and the graph', () => {
    const b = relatedRatesBox(newRelatedRates('R1'))
    expect(b.min.x).toBeLessThan(0)
    expect(b.max.x).toBeGreaterThan(10)
    expect(b.max.y).toBeGreaterThan(10)
  })
})

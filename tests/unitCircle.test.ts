// ============================================================================
// tests/unitCircle.test.ts — the unit circle as a board object.
//
// Persistence (defaults omitted, old documents byte-for-byte unchanged, a
// round trip, a hostile blob), the strings the board and the card read (the
// same strings, exact where θ is special), the frame, the animation helpers,
// and the drawing: in colour on the screen, all black under SAT, and in the
// SVG export.
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { FitResult } from '../src/core/types'
import { DARK_THEME, FIGURE_STYLES } from '../src/core/types'
import {
  UC_SHOW_DEFAULT,
  deserializeDoc,
  docFromBoard,
  serializeDoc,
  storedToUnitCircle,
  unitCircleToStored,
} from '../src/core/persist'
import type { BoardInput, BoardUnitCircle, DocMeta, StoredDoc } from '../src/core/persist'
import {
  PLAY_RATE,
  newUnitCircle,
  playStart,
  playStep,
  unitCircleBox,
  unitCircleCard,
  unitCircleFigure,
} from '../src/ui/unitCircleLinks'
import { STEP, TWO_PI } from '../src/core/trig'
import { renderBoard } from '../src/ui/renderBoard'
import type { BoardScene } from '../src/ui/renderBoard'
import { MODELS } from '../src/core/fit/models'
import { MockCtx, withMockPath2D } from './mockCanvas'
import { recordScene } from '../src/ui/vectorExport'
import { toSvg } from '../src/render/vectorSvg'
import { UC_INK } from '../src/render/unitCircle'

const META: DocMeta = { id: 'doc1', name: 'Trig', createdAt: 1000, modifiedAt: 1000 }

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

function uc(over: Partial<BoardUnitCircle> = {}): BoardUnitCircle {
  return { ...newUnitCircle('U1'), ...over }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

describe('a unit circle survives a save and a load', () => {
  it('defaults: centre (−2, 0), θ = π/6, and nothing else written', () => {
    const u = newUnitCircle('U1')
    expect(u).toMatchObject({ cx: -2, cy: 0, theta: Math.PI / 6 })
    expect(unitCircleToStored(u)).toEqual({ id: 'U1', cx: -2, cy: 0, theta: Math.PI / 6 })
  })

  it('writes only the switches that differ from the defaults', () => {
    const u = uc({
      deg: true,
      show: { ...UC_SHOW_DEFAULT, astc: true, triangle: false },
      unwrap: 'sin',
      inv: { fn: 'cos', v: -0.5 },
      color: '#f95f62',
      hidden: true,
    })
    expect(unitCircleToStored(u)).toEqual({
      id: 'U1',
      cx: -2,
      cy: 0,
      theta: Math.PI / 6,
      deg: true,
      show: { triangle: false, astc: true },
      unwrap: 'sin',
      inv: { fn: 'cos', v: -0.5 },
      color: '#f95f62',
      hidden: true,
    })
  })

  it('serialises a document without a unit circle byte-for-byte as it did before', () => {
    const plain = board({ exprSources: {} })
    const a = serializeDoc(docFromBoard(META, plain, 2000))
    const withEmpty = serializeDoc(docFromBoard(META, { ...plain, unitCircles: [] }, 2000))
    expect(withEmpty).toBe(a)
    expect(a).not.toContain('unitCircles')
    const back = deserializeDoc(a)
    expect(back.board!.unitCircles).toEqual([])
    const again = serializeDoc(docFromBoard(META, { ...plain, unitCircles: back.board!.unitCircles }, 2000))
    expect(again).toBe(a)
  })

  it('round-trips centre, θ (to the last bit), mode, switches, unwrap and question', () => {
    const u = uc({
      cx: 1.5,
      cy: -0.25,
      theta: 13 * STEP * 2,
      deg: true,
      show: { ...UC_SHOW_DEFAULT, tan: true, recip: true, other: false },
      unwrap: 'tan',
      inv: { fn: 'tan', v: -Math.sqrt(3) },
    })
    const json = serializeDoc(docFromBoard(META, board({ unitCircles: [u], selectedId: 'U1' }), 2000))
    const back = deserializeDoc(json)
    expect(back.degraded).toBe(false)
    expect(back.board!.unitCircles).toEqual([u])
    expect(back.board!.selectedId).toBe('U1')
  })

  it('drops an unreadable record and says so; survives a hostile blob', () => {
    const json = serializeDoc(docFromBoard(META, board({ unitCircles: [uc()] }), 2000))
    const raw = JSON.parse(json) as StoredDoc
    ;(raw.board.unitCircles as unknown[]).push(
      { id: 'U9', cx: 'x', cy: 0, theta: 1 },
      { id: 'U1', cx: 0, cy: 0, theta: 1 },
      { id: 'U8', cx: 0, cy: 0, theta: 1, unwrap: 'sec', inv: { fn: 'sin', v: 'half' }, show: { astc: 'yes' } },
    )
    const back = deserializeDoc(JSON.stringify(raw))
    expect(back.board!.unitCircles.map((u) => u.id)).toEqual(['U1', 'U8'])
    const u8 = back.board!.unitCircles[1]
    expect(u8.unwrap).toBeUndefined()
    expect(u8.inv).toBeUndefined()
    expect(u8.show).toEqual(UC_SHOW_DEFAULT)
    expect(back.degraded).toBe(true)
    expect(back.problems.join(' ')).toMatch(/unit circle could not be restored/)
    expect(back.problems.join(' ')).toMatch(/two objects claimed the same id/)
    expect(storedToUnitCircle(null)).toEqual({ error: 'it was not readable' })
    expect(storedToUnitCircle({ id: 'a', cx: 0, cy: 0, theta: Infinity })).toEqual({
      error: 'its angle was unreadable',
    })
  })
})

// ---------------------------------------------------------------------------
// What the board and the card say
// ---------------------------------------------------------------------------

describe('the strings the board draws', () => {
  it('θ = 5π/6: exact legs, P, θ and θ′', () => {
    const f = unitCircleFigure(uc({ theta: 10 * STEP }))
    expect(f.pointText).toBe('(−√3/2, 1/2)')
    expect(f.cosText).toBe('−√3/2')
    expect(f.sinText).toBe('1/2')
    expect(f.thetaText).toBe('θ = 5π/6')
    expect(f.refText).toBe('θ′ = π/6')
    expect(f.tanText).toBe('tan θ = −√3/3')
  })

  it('folds θ′ into θ in quadrant I, and says tan is undefined at π/2', () => {
    expect(unitCircleFigure(uc()).thetaText).toBe('θ = θ′ = π/6')
    const up = unitCircleFigure(uc({ theta: 6 * STEP }))
    expect(up.tanValue).toBeNull()
    expect(up.tanText).toBe('tan θ undefined')
    expect(up.cosText).toBeNull() // no horizontal leg on the y-axis
    expect(up.refText).toBeNull()
  })

  it('degrees on the board in degree mode; decimals off the lattice', () => {
    expect(unitCircleFigure(uc({ theta: 10 * STEP, deg: true })).thetaText).toBe('θ = 150°')
    expect(unitCircleFigure(uc({ theta: 1 })).pointText).toBe('(0.54, 0.841)')
  })

  it('the unwrap point, and a ghost that goes away while playing', () => {
    const f = unitCircleFigure(uc({ theta: 10 * STEP, unwrap: 'sin' }))
    expect(f.unwrap).toMatchObject({ fn: 'sin', ghost: true, value: 0.5, pointText: '(5π/6, 1/2)' })
    const playing = unitCircleFigure(uc({ unwrap: 'sin' }), { playTheta: 2 })
    expect(playing.theta).toBe(2)
    expect(playing.unwrap!.ghost).toBe(false)
  })

  it('the inverse: principal answer, range, and the other solution greyed (or not)', () => {
    const f = unitCircleFigure(uc({ inv: { fn: 'cos', v: -0.5 } }))
    expect(f.inv!.answerText).toBe('cos⁻¹(−1/2) = 2π/3')
    expect(f.inv!.range).toMatchObject({ lo: 0, hi: Math.PI })
    expect(f.inv!.otherText).toBe('4π/3 — not the principal value')
    const off = unitCircleFigure(uc({ inv: { fn: 'cos', v: -0.5 }, show: { ...UC_SHOW_DEFAULT, other: false } }))
    expect(off.inv!.other).toBeNull()
    expect(off.inv!.otherText).toBeNull()
  })
})

describe('the card', () => {
  it('reads sin, cos, tan exactly, and the reciprocals', () => {
    const c = unitCircleCard(uc({ theta: 10 * STEP }))
    expect(c.lines.map((l) => l.text)).toEqual([
      'sin(5π/6) = 1/2',
      'cos(5π/6) = −√3/2',
      'tan(5π/6) = −√3/3',
    ])
    expect(c.recip.map((l) => l.text)).toEqual(['csc(5π/6) = 2', 'sec(5π/6) = −2√3/3', 'cot(5π/6) = −√3'])
    expect(c.refText).toBe('θ′ = π/6')
    expect(c.quadrant).toBe('Quadrant II')
    expect(c.signs).toBe('sin +, cos −, tan −')
    expect(c.coterminal).toBe('−7π/6 and 17π/6')
    expect(c.thetaAlt).toBe('150°')
  })

  it('tan(π/2) undefined; degree mode; an approximate reading says ≈', () => {
    expect(unitCircleCard(uc({ theta: 6 * STEP })).lines[2].text).toBe('tan(π/2) undefined')
    expect(unitCircleCard(uc({ theta: 10 * STEP, deg: true })).lines[0].text).toBe('sin(150°) = 1/2')
    expect(unitCircleCard(uc({ theta: 1 })).lines[0].text).toBe('sin(1) ≈ 0.8415')
    expect(unitCircleCard(uc({ theta: 40 * STEP })).principal).toBe('4π/3')
  })

  it('the inverse block', () => {
    const c = unitCircleCard(uc({ inv: { fn: 'sin', v: -Math.SQRT2 / 2 } }))
    expect(c.inv).toMatchObject({ ok: true, question: 'sin⁻¹(−√2/2)', answer: '−π/4' })
    const bad = unitCircleCard(uc({ inv: { fn: 'sin', v: 2 } }))
    expect(bad.inv!.ok).toBe(false)
  })
})

describe('frames and playing', () => {
  it('frames the circle, and the graph when it is unwrapped', () => {
    const plain = unitCircleBox(uc())
    expect(plain.min.x).toBeCloseTo(-3.5)
    expect(plain.max.x).toBeCloseTo(-0.5)
    const wide = unitCircleBox(uc({ unwrap: 'sin' }))
    expect(wide.max.x).toBeGreaterThan(TWO_PI)
  })

  it('plays from 0 to 2π and stops there', () => {
    expect(playStart(10 * STEP)).toBe(10 * STEP)
    expect(playStart(TWO_PI)).toBe(0)
    expect(playStep(1, 1, 1).theta).toBeCloseTo(1 + PLAY_RATE)
    expect(playStep(1, 1, 2).theta).toBeCloseTo(1 + 2 * PLAY_RATE)
    expect(playStep(TWO_PI - 0.01, 0.1, 1)).toEqual({ theta: TWO_PI, done: true })
  })
})

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

const VP = { center: { x: 1, y: 0 }, pxPerUnit: 90, widthPx: 1000, heightPx: 500 }

function scene(over: Partial<BoardScene> = {}): BoardScene {
  const u = uc({
    theta: 10 * STEP,
    unwrap: 'sin',
    show: { ...UC_SHOW_DEFAULT, astc: true, tan: true },
    inv: { fn: 'cos', v: -0.5 },
  })
  return {
    vp: VP,
    theme: DARK_THEME,
    curves: [],
    styles: {},
    models: MODELS,
    analysis: null,
    chrome: null,
    unitCircles: [unitCircleFigure(u)],
    ...over,
  }
}

function render(s: BoardScene): MockCtx {
  const ctx = new MockCtx()
  withMockPath2D(() => renderBoard(ctx as unknown as CanvasRenderingContext2D, s))
  return ctx
}

describe('drawing the unit circle', () => {
  it('on the screen: its labels, in each quantity’s own ink', () => {
    const ctx = render(scene())
    const texts = ctx.texts.map((t) => t.text)
    for (const t of ['(−√3/2, 1/2)', '−√3/2', '1/2', 'θ = 5π/6', 'θ′ = π/6', 'tan θ = −√3/3', '(5π/6, 1/2)', 'cos⁻¹(−1/2) = 2π/3', 'S', 'A', 'T', 'C']) {
      expect(texts, t).toContain(t)
    }
    const inks = new Set([...ctx.strokeStyles, ...ctx.fillStyles])
    for (const c of [UC_INK.sin, UC_INK.cos, UC_INK.tan, UC_INK.theta]) expect(inks.has(c), c).toBe(true)
  })

  it('under SAT: every stroke and every word is black (or the white ground)', () => {
    const sat = FIGURE_STYLES.sat
    const ctx = render(scene({ figure: sat }))
    const allowed = new Set([sat.theme.axis, sat.theme.bg, sat.theme.gridMinor, sat.theme.gridMajor, sat.theme.label])
    const used = [...ctx.strokeStyles, ...ctx.fillStyles]
    const off = used.filter((c) => !allowed.has(c))
    expect(off).toEqual([])
    expect(ctx.texts.map((t) => t.text)).toContain('(−√3/2, 1/2)')
  })

  it('draws nothing at all for a hidden circle', () => {
    const hidden = unitCircleFigure(uc({ hidden: true }))
    const a = render(scene({ unitCircles: [hidden] }))
    const b = render(scene({ unitCircles: undefined }))
    expect(a.texts).toEqual(b.texts)
    expect(a.strokeCount).toBe(b.strokeCount)
  })

  it('reaches the SVG export through the same renderer', () => {
    const svg = toSvg(recordScene(scene({ figure: FIGURE_STYLES.sat, theme: FIGURE_STYLES.sat.theme }), 16))
    expect(svg).toContain('(−√3/2, 1/2)')
    expect(svg).toContain('cos⁻¹(−1/2) = 2π/3')
    expect(svg).toContain('4π/3 — not the principal value')
  })
})

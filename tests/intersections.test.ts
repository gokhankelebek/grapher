// ============================================================================
// tests/intersections.test.ts — where two curves MEET, on the board and on the
// cards.
//
// An intersection is the one analysis point that does not belong to a curve,
// and almost everything this file pins follows from that:
//
//   * it is drawn ONCE for the pair, in a NEUTRAL ink — f's blue would say the
//     point is f's, which is the one thing that is untrue about it;
//   * it is not a marker of either curve, so it is never a click target and
//     the context layer must not stack a coloured dot on it;
//   * both cards list it, from ONE computation, so they cannot disagree;
//   * and a board with no crossings draws exactly the picture it drew before
//     any of this existed.
// ============================================================================

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MODELS } from '../src/core/fit/models'
import { intersectionPoints } from '../src/core/analyze'
import { CURVE_COLORS, DARK_THEME, LIGHT_THEME } from '../src/core/types'
import type { FittedCurve, SpecialPoint, Viewport } from '../src/core/types'
import {
  FIGURE_STYLES,
  drawIntersections,
  hasMarkerGlyph,
  intersectionInk,
  renderBoard,
  type BoardIntersection,
  type BoardScene,
} from '../src/ui/renderBoard'
import { drawContextMarkers } from '../src/ui/AnalysisOverlay'
import { CurveCard } from '../src/ui/CurveCard'
import {
  MAX_PAIRS,
  boardIntersections,
  cardIntersections,
  intersectionKey,
  intersectionPairs,
  intersectionSpan,
} from '../src/ui/intersections'
import { MockCtx, withMockPath2D } from './mockCanvas'

const VP: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 900, heightPx: 700 }
const ROOT2 = Math.SQRT2

/** y = x² — poly params are ascending, so [c, b, a]. */
const PARABOLA: FittedCurve = {
  id: 'f', modelId: 'poly2', params: [0, 0, 1],
  kind: 'explicit', domain: null,
  color: CURVE_COLORS[0], strokeWidth: 2.5, visible: true, error: 0,
}

/** y = 2 — a line, params ascending: [b, m]. */
const TWO: FittedCurve = {
  id: 'g', modelId: 'line', params: [2, 0],
  kind: 'explicit', domain: null,
  color: CURVE_COLORS[1], strokeWidth: 2.5, visible: true, error: 0,
}

const RANGE: [number, number] = [-10, 10]

function render(s: BoardScene): MockCtx {
  const ctx = new MockCtx()
  withMockPath2D(() => renderBoard(ctx as unknown as CanvasRenderingContext2D, s))
  return ctx
}

function scene(over: Partial<BoardScene> = {}): BoardScene {
  return {
    vp: VP, theme: DARK_THEME, curves: [PARABOLA, TWO], styles: {}, models: MODELS,
    analysis: null, chrome: null,
    ...over,
  }
}

const marks = (): BoardIntersection[] => boardIntersections([PARABOLA, TWO], MODELS, RANGE)

// ---------------------------------------------------------------------------
// the core half, as this half consumes it
// ---------------------------------------------------------------------------

describe('boardIntersections — one entry per meeting point, per pair', () => {
  it('y = x² meets y = 2 at ±√2, named from both sides', () => {
    const got = marks()
    expect(got).toHaveLength(2)
    expect(got.map((m) => m.curveId)).toEqual(['f', 'f'])
    expect(got.map((m) => m.point.withId)).toEqual(['g', 'g'])
    expect(got.map((m) => m.point.kind)).toEqual(['intersection', 'intersection'])
    const xs = got.map((m) => m.point.pos.x).sort((a, b) => a - b)
    expect(xs[0]).toBeCloseTo(-ROOT2, 9)
    expect(xs[1]).toBeCloseTo(ROOT2, 9)
  })

  it('the closed form comes through, because that is the answer being asked for', () => {
    const forms = marks()
      .map((m) => m.point.exactX)
      .sort()
    expect(forms).toEqual(['√2', '−√2'].sort())
  })

  it('a pair is solved ONCE — (f, g) and never also (g, f)', () => {
    const pairs = intersectionPairs([PARABOLA, TWO])
    expect(pairs).toHaveLength(1)
    expect(pairs[0].map((c) => c.id)).toEqual(['f', 'g'])
  })

  it('a hidden curve is not crossed, and a non-function is not either', () => {
    expect(intersectionPairs([PARABOLA, { ...TWO, visible: false }])).toHaveLength(0)
    expect(intersectionPairs([PARABOLA, { ...TWO, kind: 'polar' }])).toHaveLength(0)
  })

  it('a crowd of curves is capped rather than solved n² deep', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...TWO, id: `c${i}`, params: [i, 0] }))
    expect(intersectionPairs(many)).toHaveLength(MAX_PAIRS)
  })
})

// ---------------------------------------------------------------------------
// the memo: what actually moves a crossing
// ---------------------------------------------------------------------------

describe('the pair memo — a param moves a crossing, a small pan does not', () => {
  const span = intersectionSpan([-7.5, 7.5])

  it('a param change is a new key', () => {
    const before = intersectionKey([PARABOLA, TWO], span)
    const after = intersectionKey([PARABOLA, { ...TWO, params: [3, 0] }], span)
    expect(after).not.toBe(before)
  })

  it('a domain change is a new key', () => {
    const before = intersectionKey([PARABOLA, TWO], span)
    const after = intersectionKey([{ ...PARABOLA, domain: [-2, 2] }, TWO], span)
    expect(after).not.toBe(before)
  })

  it('rebuilding the array with the same numbers is the SAME key', () => {
    // This is a slider drag: a fresh array every frame, saying the same thing.
    const before = intersectionKey([PARABOLA, TWO], span)
    const after = intersectionKey([{ ...PARABOLA }, { ...TWO }], span)
    expect(after).toBe(before)
  })

  it('a small pan does not move the coarse span, so it does not re-solve', () => {
    const a = intersectionSpan([-7.5, 7.5])
    const b = intersectionSpan([-7.45, 7.55]) // three pixels of pan
    expect(b).toEqual(a)
    expect(intersectionKey([PARABOLA, TWO], b)).toBe(intersectionKey([PARABOLA, TWO], a))
  })

  it('a pan that genuinely leaves the span does re-solve', () => {
    const a = intersectionSpan([-7.5, 7.5])
    const b = intersectionSpan([12.5, 27.5])
    expect(b).not.toEqual(a)
  })

  it('the span is padded, so a crossing just off screen is already solved', () => {
    const [lo, hi] = intersectionSpan([-7.5, 7.5])
    expect(lo).toBeLessThanOrEqual(-7.5)
    expect(hi).toBeGreaterThanOrEqual(7.5)
  })
})

// ---------------------------------------------------------------------------
// the board
// ---------------------------------------------------------------------------

/** Diamonds are four lineTo's around a point; count the ones centred on `sx`. */
function diamondsAt(ctx: MockCtx, sx: number, sy: number): number {
  let n = 0
  for (const sub of ctx.own.subpaths()) {
    if (sub.length < 4) continue
    const top = sub[0]
    if (Math.abs(top.x - sx) > 0.5) continue
    // the top vertex sits directly above the centre
    if (top.y >= sy) continue
    if (Math.abs(top.y - sy) > 20) continue
    const left = sub.find((p) => p.x < sx - 0.5)
    const right = sub.find((p) => p.x > sx + 0.5)
    if (left && right && Math.abs(left.y - sy) < 0.5 && Math.abs(right.y - sy) < 0.5) n++
  }
  return n
}

describe('renderBoard — the crossings are drawn once, and labelled', () => {
  it('a board with no crossings is BYTE-IDENTICAL to one that never heard of them', () => {
    const before = render(scene())
    const after = render(scene({ intersections: [] }))
    expect(after.own.cmds).toEqual(before.own.cmds)
    expect(after.texts).toEqual(before.texts)
    expect(after.strokeStyles).toEqual(before.strokeStyles)
    expect(after.fillStyles).toEqual(before.fillStyles)
  })

  it('each crossing gets one glyph and one chip', () => {
    const ctx = render(scene({ intersections: marks() }))
    const labels = ctx.texts.map((t) => t.text)
    expect(labels.filter((t) => t.startsWith('(√2'))).toHaveLength(1)
    expect(labels.filter((t) => t.startsWith('(−√2'))).toHaveLength(1)
    // The chip says the closed form and stops — it is a name, not a table.
    expect(labels.some((t) => t.includes('≈'))).toBe(false)
  })

  it('the glyph is a diamond on a ground ring — two of them, at the crossing', () => {
    const ctx = render(scene({ intersections: marks() }))
    const sx = VP.widthPx / 2 + ROOT2 * VP.pxPerUnit
    const sy = VP.heightPx / 2 - 2 * VP.pxPerUnit
    // the ring and the filled diamond, and nothing else at that point
    expect(diamondsAt(ctx, sx, sy)).toBe(2)
  })

  it('the ink is NEUTRAL: the point belongs to both curves, so to neither colour', () => {
    const ctx = render(scene({ intersections: marks() }))
    const ink = intersectionInk(DARK_THEME)
    expect(ctx.fillStyles).toContain(ink)
    expect(ink).not.toBe(PARABOLA.color)
    expect(ink).not.toBe(TWO.color)
  })

  it('under mono ink it is the axis ink, not the one grey on a black-and-white figure', () => {
    const ap = FIGURE_STYLES.ap
    expect(ap.curveInk).toBe('mono')
    expect(intersectionInk(ap.theme, true)).toBe(ap.theme.axis)
    const ctx = render(scene({ figure: ap, intersections: marks() }))
    expect(ctx.fillStyles).toContain(ap.theme.axis)
  })

  it('a marked figure draws them too — a crossing is a fact about the picture', () => {
    const ctx = render(scene({ figure: FIGURE_STYLES.ap, intersections: marks() }))
    expect(ctx.texts.map((t) => t.text).filter((t) => t.startsWith('(√2'))).toHaveLength(1)
  })

  it('a crossing whose partner has been hidden is dropped', () => {
    const ctx = render(
      scene({ curves: [PARABOLA, { ...TWO, visible: false }], intersections: marks() }),
    )
    expect(ctx.texts.map((t) => t.text).some((t) => t.startsWith('(√2'))).toBe(false)
  })

  it('three curves through one point is one diamond, not two', () => {
    const third: FittedCurve = { ...TWO, id: 'h', params: [2, 0] }
    const all = boardIntersections([PARABOLA, TWO, third], MODELS, RANGE)
    expect(all.length).toBeGreaterThan(2) // the pairs really do repeat the point
    const ctx = new MockCtx()
    withMockPath2D(() =>
      drawIntersections(
        ctx as unknown as CanvasRenderingContext2D,
        VP,
        all.map((m) => m.point),
        { theme: DARK_THEME, color: intersectionInk(DARK_THEME) },
      ),
    )
    const sx = VP.widthPx / 2 + ROOT2 * VP.pxPerUnit
    const sy = VP.heightPx / 2 - 2 * VP.pxPerUnit
    expect(diamondsAt(ctx, sx, sy)).toBe(2) // ring + fill, once
  })

  it('a busy selected curve does not starve the crossings of their chips', () => {
    // The crowding budget is per LAYER. Shared, the selected curve's own eight
    // labels would drop every crossing from the board — on exactly the kind of
    // board (several graphs) that has a crossing to show in the first place.
    const full = Array.from({ length: 8 }, (_, i) => ({ x: 5 + i * 60, y: 600, w: 50, h: 16 }))
    const ctx = new MockCtx()
    withMockPath2D(() =>
      drawIntersections(
        ctx as unknown as CanvasRenderingContext2D,
        VP,
        marks().map((m) => m.point),
        { theme: DARK_THEME, color: intersectionInk(DARK_THEME), reserve: full },
      ),
    )
    expect(ctx.texts.map((t) => t.text).filter((t) => t.startsWith('(√2'))).toHaveLength(1)
  })

  it('the plate is measured with the string it actually draws', () => {
    const ctx = new MockCtx()
    withMockPath2D(() =>
      drawIntersections(
        ctx as unknown as CanvasRenderingContext2D,
        VP,
        marks().map((m) => m.point),
        { theme: LIGHT_THEME, color: intersectionInk(LIGHT_THEME) },
      ),
    )
    const chip = ctx.texts.find((t) => t.text.startsWith('(√2'))
    expect(chip).toBeTruthy()
    // MockCtx measures 6px per character; the plate has to be that wide.
    const plate = ctx.own
      .subpaths()
      .map((s) => Math.max(...s.map((p) => p.x)) - Math.min(...s.map((p) => p.x)))
    expect(Math.max(...plate)).toBeGreaterThan((chip as { text: string }).text.length * 6)
  })
})

// ---------------------------------------------------------------------------
// never a click target, never a second glyph
// ---------------------------------------------------------------------------

describe('a crossing is read-only, and has exactly one glyph', () => {
  it('hasMarkerGlyph says no — the one question CanvasStage and the overlay ask', () => {
    // markerAt() refuses any kind without a glyph, so this is the hit test.
    expect(hasMarkerGlyph('intersection')).toBe(false)
    expect(hasMarkerGlyph('hole')).toBe(false)
    expect(hasMarkerGlyph('zero')).toBe(true)
    expect(hasMarkerGlyph('maximum')).toBe(true)
  })

  it('the context layer draws nothing on top of the diamond', () => {
    const ctx = new MockCtx()
    const points = marks().map((m) => m.point)
    drawContextMarkers(
      ctx as unknown as CanvasRenderingContext2D,
      VP,
      points,
      PARABOLA.color,
      DARK_THEME.bg,
    )
    expect(ctx.own.cmds).toHaveLength(0)
    expect(ctx.fillCount).toBe(0)
  })

  it('the analysis layer would not draw a second marker for one either', () => {
    // Belt and braces: the App never puts a crossing in `analysis`, but if it
    // ever did, the curve-coloured marker must not appear under the diamond.
    const ctx = new MockCtx()
    const pts = marks().map((m) => m.point)
    withMockPath2D(() => renderBoard(
      ctx as unknown as CanvasRenderingContext2D,
      scene({ analysis: { curve: PARABOLA, points: pts } }),
    ))
    const sx = VP.widthPx / 2 + ROOT2 * VP.pxPerUnit
    const sy = VP.heightPx / 2 - 2 * VP.pxPerUnit
    const dots = ctx.own.cmds.filter(
      (c) => c.op === 'arc' && Math.abs(c.x - sx) < 1 && Math.abs(c.y - sy) < 1,
    )
    expect(dots).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// the cards — both of them, from one list
// ---------------------------------------------------------------------------

describe('cardIntersections — the same points, read from either side', () => {
  const nameOf = (id: string): string => (id === 'f' ? 'f' : 'g')

  it("f's card lists them under g, and g's card under f", () => {
    const all = marks()
    const onF = cardIntersections('f', all, nameOf)
    const onG = cardIntersections('g', all, (id) => (id === 'f' ? 'f' : 'g'))
    expect(onF).toHaveLength(1)
    expect(onF[0].id).toBe('g')
    expect(onG).toHaveLength(1)
    expect(onG[0].id).toBe('f')
    // ONE computation, so the two cards cannot print different answers.
    expect(onG[0].points.map((p) => p.pos.x)).toEqual(onF[0].points.map((p) => p.pos.x))
  })

  it('they read left to right, like every other row', () => {
    const [group] = cardIntersections('f', marks(), nameOf)
    expect(group.points[0].pos.x).toBeLessThan(group.points[1].pos.x)
  })

  it('a curve that crosses nothing has no row at all', () => {
    expect(cardIntersections('zzz', marks(), nameOf)).toEqual([])
  })
})

const NOOP = (): void => {}

function renderCard(curve: FittedCurve, intersections: unknown): string {
  const props = {
    curve,
    models: MODELS,
    selected: true,
    candidates: [],
    snapMask: null,
    snapKey: 0,
    shaking: false,
    edited: false,
    analysis: [] as SpecialPoint[],
    intersections,
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
  }
  return renderToStaticMarkup(
    createElement(CurveCard, props as unknown as Parameters<typeof CurveCard>[0]),
  )
}

/** The row as a reader sees it, with the markup taken back out. */
const plain = (html: string): string => html.replace(/<[^>]+>/g, '')

describe('CurveCard — the Intersections row', () => {
  it('names the other curve and states both readings', () => {
    const groups = cardIntersections('f', marks(), () => 'g')
    const text = plain(renderCard(PARABOLA, groups))
    expect(text).toContain('Intersections')
    expect(text).toContain('with g: (−√2, 2) ≈ (−1.414, 2),')
    expect(text).toContain('(√2, 2) ≈ (1.414, 2)')
  })

  it('the closed form is its own element, so the decimal can step back a tone', () => {
    const html = renderCard(PARABOLA, cardIntersections('f', marks(), () => 'g'))
    expect(html).toContain('an-exact')
    expect(html).toContain('an-approx')
    // Stated, never offered: there is no value an editor could move.
    expect(html).toContain('an-value-static')
  })

  it("the OTHER curve's card says the same thing, with this curve's name on it", () => {
    const text = plain(renderCard(TWO, cardIntersections('g', marks(), () => 'f')))
    expect(text).toContain('with f: (−√2, 2) ≈ (−1.414, 2),')
  })

  it('no crossings, no row — and the card is what it always was', () => {
    const html = renderCard(PARABOLA, undefined)
    expect(html).not.toContain('Intersection')
    expect(html).not.toContain('an-with')
  })
})

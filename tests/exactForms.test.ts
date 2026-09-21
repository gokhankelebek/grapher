// ============================================================================
// tests/exactForms.test.ts — a zero at √3 is not "1.732".
//
// analyzeCurve fills in SpecialPoint.exactX / exactY whenever it can VERIFY a
// closed form. What is pinned here is what the UI then does with it, in the
// three places a special point is printed, and — just as much — what it does
// NOT do to a point that has no closed form, which is the common case and must
// come out character for character as before.
//
//   pointText     the one formatter; the card, the chip and the overlay all
//                 read the same rule out of it
//   CurveCard     "√3 ≈ 1.732": exact first, decimal beside it, quieter
//   drawAnalysis  "(√3, 0)" on the plate and no decimal — a chip is a name for
//                 the point, not a table of it
//
// The points here are hand made. The core half fills these fields in for real;
// this file is about the printing, so it states its own inputs rather than
// waiting on a solver to produce one.
// ============================================================================

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FittedCurve, ModelSpec, SpecialPoint, Viewport } from '../src/core/types'
import { DARK_THEME } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { formatCoord, pointParts, pointText } from '../src/ui/numeric'
import { parseNumeric } from '../src/ui/numeric'
import { drawAnalysis } from '../src/ui/renderBoard'
import { CurveCard } from '../src/ui/CurveCard'
import { MockCtx } from './mockCanvas'

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const ROOT3 = Math.sqrt(3)

function pt(over: Partial<SpecialPoint> & Pick<SpecialPoint, 'kind' | 'pos'>): SpecialPoint {
  return { label: over.kind, exact: true, ...over } as SpecialPoint
}

/** A zero the analyzer knows exactly: x = √3. */
const ZERO_ROOT3 = pt({
  kind: 'zero',
  pos: { x: ROOT3, y: 0 },
  label: 'zero',
  exactX: '√3',
})

/** y = x³ − x at its minimum: (√3/3, −2√3/9). Both coordinates closed. */
const MIN_BOTH = pt({
  kind: 'minimum',
  pos: { x: ROOT3 / 3, y: (-2 * ROOT3) / 9 },
  label: 'minimum',
  exactX: '√3/3',
  exactY: '−2√3/9',
})

/** sin at its peak: x is π/2, y is just 1 — one coordinate closed, one not. */
const MAX_HALF = pt({
  kind: 'maximum',
  pos: { x: Math.PI / 2, y: 1 },
  label: 'maximum',
  exactX: 'π/2',
})

/** A point located numerically, which is most of them. */
const PLAIN = pt({
  kind: 'maximum',
  pos: { x: 1.2, y: -3.4 },
  label: 'maximum',
  exact: false,
})

/** A double root at x = √3: the pair case, with an exact x and a bare 0. */
const TANGENT_ROOT3 = pt({
  kind: 'maximum',
  pos: { x: ROOT3, y: 0 },
  label: 'maximum',
  exactX: '√3',
})

// ---------------------------------------------------------------------------
// the rule
// ---------------------------------------------------------------------------

describe('pointText — exact form first, decimal beside it', () => {
  it('a zero with a closed form prints both readings', () => {
    expect(pointText(ZERO_ROOT3)).toBe('√3 ≈ 1.732')
  })

  it('a pair with two closed forms prints two well-formed pairs', () => {
    const dx = formatCoord(MIN_BOTH.pos.x, { exact: true })
    const dy = formatCoord(MIN_BOTH.pos.y, { exact: true })
    expect(pointText(MIN_BOTH)).toBe(`(√3/3, −2√3/9) ≈ (${dx}, ${dy})`)
    expect(pointText(MIN_BOTH)).toBe('(√3/3, −2√3/9) ≈ (0.5774, −0.3849)')
  })

  it('a pair with ONE closed form keeps the other coordinate decimal, in place', () => {
    // Rule 1: each coordinate prints the form it has. The pair stays a pair —
    // a closed form is never invented for the coordinate that has none.
    expect(pointText(MAX_HALF)).toBe('(π/2, 1.000) ≈ (1.571, 1.000)')
  })

  it('a point with no closed form is exactly what it was before', () => {
    expect(pointText(PLAIN)).toBe('(1.200, −3.400)')
    expect(pointParts(PLAIN).exact).toBeNull()
  })

  it('a plain numeral is not a closed form: it is the same value twice', () => {
    // y = x³ − 3x has its maximum at exactly (−1, 2). Saying so twice on
    // every polynomial row is noise, so the row stays the decimal column.
    const vertex = pt({
      kind: 'maximum',
      pos: { x: -1, y: 2 },
      label: 'maximum',
      exactX: '−1',
      exactY: '2',
    })
    expect(pointText(vertex)).toBe('(−1.000, 2.000)')
    expect(pointParts(vertex).exact).toBeNull()
    // The chip is the decimal too — there is no other reading to prefer.
    expect(pointText(vertex, { decimal: false })).toBe('(−1.000, 2.000)')
  })

  it('a numeral alongside a real form drops out of the exact side only', () => {
    // MAX_HALF's y is plainly 1; its x is not plainly anything.
    const both = { ...MAX_HALF, exactY: '1' } as SpecialPoint
    expect(pointText(both)).toBe(pointText(MAX_HALF))
  })

  it('a fraction or a radical is kept, however short', () => {
    const half = pt({ kind: 'zero', pos: { x: 1.5, y: 0 }, label: 'zero', exactX: '3/2' })
    expect(pointText(half)).toBe('3/2 ≈ 1.500')
  })

  it('a chip drops the decimal — it is a label, not a table', () => {
    expect(pointText(ZERO_ROOT3, { decimal: false })).toBe('√3')
    expect(pointText(TANGENT_ROOT3, { decimal: false })).toBe('(√3, 0)')
    expect(pointText(MAX_HALF, { decimal: false })).toBe('(π/2, 1.000)')
    // ...but a point with nothing exact still says the number it has.
    expect(pointText(PLAIN, { decimal: false })).toBe('(1.200, −3.400)')
  })

  it("formatCoord's zero floor still governs the decimal", () => {
    const residue = pt({
      kind: 'inflection',
      pos: { x: 1.662e-14, y: -3e-15 },
      label: 'inflection',
      exactX: '0',
    })
    // The decimal is snapped to 0, and an exact "0" beside a decimal 0 is the
    // same character twice with a hedge between them, so it is dropped.
    expect(pointText(residue)).toBe('(0, 0)')
    expect(pointParts(residue).exact).toBeNull()
  })

  it('a blank or missing form reads as no form at all', () => {
    const blank = pt({ kind: 'zero', pos: { x: 2, y: 0 }, label: 'zero', exactX: '   ' })
    expect(pointText(blank)).toBe('2.000')
  })

  it('the parts are kept apart so the card can set the decimal quieter', () => {
    const parts = pointParts(ZERO_ROOT3)
    expect(parts.exact).toBe('√3')
    expect(parts.decimal).toBe('1.732')
    expect(parts.text).toBe('√3 ≈ 1.732')
  })

  it('the scale the row is drawn at reaches the decimal', () => {
    const tiny = pt({
      kind: 'maximum',
      pos: { x: 5.09e-4, y: 3.27 },
      label: 'maximum',
      exact: false,
      exactY: '3.27',
    })
    expect(pointParts(tiny, { scale: 6.5 }).decimal).toBe('(0, 3.270)')
  })
})

// ---------------------------------------------------------------------------
// the card
// ---------------------------------------------------------------------------

const NOOP = (): void => {}

function cubic(): FittedCurve {
  return {
    id: 'f',
    modelId: 'poly3',
    params: [0, -1, 0, 1], // y = x³ − x
    kind: 'explicit',
    domain: null,
    color: '#4f9cf9',
    strokeWidth: 2.5,
    visible: true,
    error: 0,
  }
}

const models: Record<string, ModelSpec> = MODELS

/** The real card, rendered to markup — a row that "would" say √3 says nothing. */
function renderCard(analysis: SpecialPoint[]): string {
  const props = {
    curve: cubic(),
    models,
    selected: true,
    candidates: [],
    snapMask: null,
    snapKey: 0,
    shaking: false,
    edited: false,
    analysis,
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
    calc: undefined,
    between: undefined,
    onAddCalc: NOOP,
    onAddAreaBetween: NOOP,
    onCalcChange: NOOP,
    onCalcRemove: NOOP,
  }
  return renderToStaticMarkup(
    createElement(CurveCard, props as unknown as Parameters<typeof CurveCard>[0]),
  )
}

describe('CurveCard — the analysis row states the closed form', () => {
  it('prints "√3 ≈ 1.732" for a zero that has one', () => {
    const html = renderCard([ZERO_ROOT3])
    expect(html).toContain('√3 ≈ 1.732')
    // ...and as two elements, so the decimal can step back a tone.
    expect(html).toContain('an-exact')
    expect(html).toContain('an-approx')
  })

  it('hovering the closed form offers the decimal it stands for', () => {
    const html = renderCard([ZERO_ROOT3])
    expect(html).toContain('√3 = 1.732051')
  })

  it('a pair prints both readings as pairs', () => {
    const html = renderCard([MIN_BOTH])
    expect(html).toContain('(√3/3, −2√3/9)')
    expect(html).toContain('≈ (0.5774, −0.3849)')
  })

  it('a row with no closed form is byte-identical to before', () => {
    const html = renderCard([PLAIN])
    // One text node in the button, no wrapper spans, no attribute, no ≈.
    expect(html).toContain('>(1.200, −3.400)</button>')
    expect(html).not.toContain('an-approx')
    expect(html).not.toContain('an-exact')
    expect(html).not.toContain('data-value')
    expect(html).not.toContain('≈')
  })

  it('a hole is still stated rather than offered, closed form or not', () => {
    const hole = pt({
      kind: 'hole',
      pos: { x: ROOT3, y: 2 },
      label: 'hole',
      exactX: '√3',
    })
    const html = renderCard([hole])
    expect(html).toContain('an-value-static')
    expect(html).toContain('(√3, 2.000) ≈ (1.732, 2.000)')
    // Read-only: no button, so nothing promises a click that cannot commit.
    expect(html).not.toMatch(/<button[^>]*an-value/)
  })

  it('the editor still edits the decimal, and takes an expression for it', () => {
    // The click-to-edit field is unchanged: it opens on the decimal. It has
    // always gone through parseNumeric, which reads a constant expression —
    // so typing the closed form back in already works.
    expect(parseNumeric('sqrt(3)')).toBeCloseTo(ROOT3, 12)
    expect(parseNumeric('pi/4')).toBeCloseTo(Math.PI / 4, 12)
    expect(parseNumeric('(1+sqrt(5))/2')).toBeCloseTo((1 + Math.sqrt(5)) / 2, 12)
  })
})

// ---------------------------------------------------------------------------
// the board
// ---------------------------------------------------------------------------

const VP: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 900, heightPx: 700 }

function chips(points: SpecialPoint[]): string[] {
  const ctx = new MockCtx()
  drawAnalysis(ctx as unknown as CanvasRenderingContext2D, VP, points, {
    color: '#4f9cf9',
    theme: DARK_THEME,
    handles: [],
    highlight: null,
    openIdx: null,
    hoverIdx: null,
    halos: false,
  })
  return ctx.texts.map((t) => t.text)
}

/** The face each plate was set in — the figure style's, or the screen's mono. */
class FontCtx extends MockCtx {
  fonts: { text: string; font: string }[] = []
  fillText(text: string, x: number, y: number): void {
    this.fonts.push({ text, font: this.font })
    super.fillText(text, x, y)
  }
}

function chipFonts(points: SpecialPoint[], font: 'sans' | 'serif' | null) {
  const ctx = new FontCtx()
  drawAnalysis(ctx as unknown as CanvasRenderingContext2D, VP, points, {
    color: '#4f9cf9',
    theme: DARK_THEME,
    handles: [],
    highlight: null,
    openIdx: null,
    hoverIdx: null,
    halos: false,
    font,
  })
  return ctx.fonts
}

describe('drawAnalysis — the plate says the closed form and stops', () => {
  it("an exam figure sets the closed form in the figure's own serif", () => {
    // The face was already plumbed through drawAnalysis; what is pinned is
    // that the exact form rides it rather than going out in the screen's mono.
    const serif = chipFonts([TANGENT_ROOT3], 'serif').find((t) => t.text === '(√3, 0)')
    expect(serif, 'the chip was not drawn at all').toBeTruthy()
    expect(serif!.font).toContain('Times')
    const screen = chipFonts([TANGENT_ROOT3], null).find((t) => t.text === '(√3, 0)')
    expect(screen!.font).toContain('Mono')
  })

  it('prints "(√3, 0)" rather than the decimal pair', () => {
    expect(chips([TANGENT_ROOT3])).toContain('(√3, 0)')
    expect(chips([TANGENT_ROOT3]).join('|')).not.toContain('1.732')
  })

  it('a zero along the axis reads "√3", not "1.732"', () => {
    expect(chips([ZERO_ROOT3])).toContain('√3')
  })

  it('a tangency still says so', () => {
    expect(chips([{ ...ZERO_ROOT3, tangent: true }])).toContain('√3 (touches)')
  })

  it('a point with no closed form is unchanged', () => {
    expect(chips([PLAIN])).toContain('(1.200, −3.400)')
  })

  it('the plate is measured with the string it actually draws', () => {
    // MockCtx.measureText is width ∝ length, so a shorter label means a
    // narrower plate: the clearance and collision logic sees the real text.
    const exact = chips([TANGENT_ROOT3])[0]
    const plain = chips([{ ...TANGENT_ROOT3, exactX: undefined }])[0]
    expect(exact.length).toBeLessThan(plain.length)
  })
})

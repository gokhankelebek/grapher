// ============================================================================
// Parametric and polar motion — the App half: src/ui/motionLinks.ts (pure),
// the "Build ▾ → Parametric / polar" editor and the card's Motion section
// (src/ui/MotionEditor.tsx).
// ============================================================================

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { parseExpression } from '../src/core/parse'
import {
  ARROW_PX,
  CUSTOM,
  advanceT,
  areaOverlayFor,
  blankMotionDraft,
  capPx,
  clampT,
  curveFromSource,
  defaultAreaBounds,
  directionArrowTs,
  directionArrows,
  draftSource,
  drawnVector,
  intervalCondition,
  isParametricPair,
  motionInterval,
  motionKindOf,
  motionMarks,
  motionPreview,
  motionReadouts,
  motionScales,
  nearestT,
  particleShapes,
  poleRay,
  polarAreaText,
  polarRegion,
  pxLength,
  readAreaBounds,
  readIntervalEdit,
  retraceCount,
  safeFeatures,
  safePolarArea,
  safeState,
  setDraftInterval,
  setDraftValue,
  stripInterval,
  textToSource,
  tRate,
  valueSource,
  valueText,
  vectorScale,
  withInterval,
} from '../src/ui/motionLinks'
import type { MotionDraft, PxFrame } from '../src/ui/motionLinks'
import { POLAR_FAMILIES, PARAM_FAMILIES } from '../src/core/motion'
import { MotionEditor, MotionSection } from '../src/ui/MotionEditor'
import { CurveCard } from '../src/ui/CurveCard'

const NOOP = (): void => {}
const PI = Math.PI

function read(src: string): { curve: FittedCurve; models: Record<string, ModelSpec> } {
  const r = curveFromSource(src)
  if ('error' in r) throw new Error(r.error)
  return r
}

const ELLIPSE = '(2cos(t), 3sin(t)) {0 <= t <= 2pi}'
const ROSE = 'r = 2cos(3θ)'
const FRAME: PxFrame = { ppx: 50, ppy: 50, widthPx: 800, heightPx: 600 }

// ---------------------------------------------------------------------------
// which curves move
// ---------------------------------------------------------------------------

describe('which curves are a particle’s path', () => {
  it('a typed parametric line and a typed polar line; never y = x², a vertical line or a Fourier sketch', () => {
    const e = read(ELLIPSE)
    expect(motionKindOf(e.curve, e.models)).toBe('parametric')
    const r = read(ROSE)
    expect(motionKindOf(r.curve, r.models)).toBe('polar')
    const p = read('y = x^2')
    expect(motionKindOf(p.curve, p.models)).toBeNull()
    const base = { id: 'c', color: '#fff', strokeWidth: 2, visible: true, error: 0 }
    expect(motionKindOf({ ...base, modelId: 'vline', kind: 'parametric', params: [1], domain: null }, MODELS)).toBeNull()
    expect(motionKindOf({ ...base, modelId: 'fourier', kind: 'parametric', params: [], domain: null }, MODELS)).toBeNull()
  })

  it('a sketched polar family moves too', () => {
    const rose: FittedCurve = {
      id: 'c', modelId: 'polarRose', kind: 'polar', params: [2, 3, 0], domain: null,
      color: '#fff', strokeWidth: 2, visible: true, error: 0,
    }
    expect(motionKindOf(rose, MODELS)).toBe('polar')
    expect(motionInterval(rose)).toEqual([0, 2 * PI])
  })

  it('a pair of formulas in t is a curve; a pair with t once is still a point', () => {
    expect(isParametricPair('(2cos(t), 3sin(t))')).toBe(true)
    expect(isParametricPair('(t, t^2)')).toBe(true)
    expect(isParametricPair('(t, 1)')).toBe(false)
    expect(isParametricPair('(1, 2)')).toBe(false)
    expect(isParametricPair('(max(t, 1), 2)')).toBe(false)
    expect(isParametricPair('P = (t, t)')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// numbers and intervals
// ---------------------------------------------------------------------------

describe('interval text and edits', () => {
  it('values as a class writes them, and as the parser reads them', () => {
    expect(valueText(2 * PI)).toBe('2π')
    expect(valueText(PI / 3)).toBe('π/3')
    expect(valueText(0)).toBe('0')
    expect(valueSource(2 * PI)).toBe('2pi')
    expect(valueSource(-PI / 2)).toBe('-pi/2')
    expect(textToSource('−π/6')).toBe('-pi/6')
    expect(textToSource('2π')).toBe('2pi')
    expect(textToSource('√2/2')).toBe('sqrt(2)/2')
  })

  it('stripInterval finds {…} and for …, never a piecewise body', () => {
    expect(stripInterval(ELLIPSE)).toEqual({ body: '(2cos(t), 3sin(t))', cond: '0 <= t <= 2pi' })
    expect(stripInterval('r = 1 + cos(θ) for 0 <= θ <= pi')).toEqual({ body: 'r = 1 + cos(θ)', cond: '0 <= θ <= pi' })
    expect(stripInterval('r = {θ < pi: 1, 2}').cond).toBeNull()
    expect(stripInterval('x = t, y = t^2').cond).toBeNull()
  })

  it('withInterval restates the line, and the new line reads the new interval', () => {
    const next = withInterval(ELLIPSE, 'parametric', '0', '4π')
    expect(next).toBe('(2cos(t), 3sin(t)) {0 <= t <= 4pi}')
    const o = parseExpression(next)
    expect(o.ok && o.plot.domain?.[1]).toBeCloseTo(4 * PI, 12)
    const polar = withInterval(ROSE, 'polar', '0', 'π/3')
    expect(polar).toBe('r = 2cos(3θ) {0 <= θ <= pi/3}')
    const p = parseExpression(polar)
    expect(p.ok && p.plot.kind).toBe('polar')
    expect(p.ok && p.plot.domain?.[1]).toBeCloseTo(PI / 3, 12)
    expect(intervalCondition('parametric', '−1', '1')).toBe('{-1 <= t <= 1}')
  })

  it('readIntervalEdit refuses in words', () => {
    expect(readIntervalEdit('0', '2π', 'polar')).toMatchObject({ lo: '0', hi: '2pi', a: 0 })
    expect(readIntervalEdit('3', '1', 'parametric')).toEqual({
      error: 'The t-interval must run from a smaller t to a larger one.',
    })
    expect(readIntervalEdit('x', '1', 'polar')).toEqual({ error: 'The start of the θ-interval is not a number.' })
  })
})

// ---------------------------------------------------------------------------
// the builder draft
// ---------------------------------------------------------------------------

describe('the Build ▾ → Parametric / polar draft', () => {
  it('a family writes its line; a field and the interval edit it', () => {
    const d: MotionDraft = { ...blankMotionDraft('polar'), polarFamily: 'roseCos' }
    expect(draftSource(d).src).toBe('r = 2cos(3θ)')
    const rose = POLAR_FAMILIES.find((f) => f.id === 'roseCos')!
    const k5 = setDraftValue(d, rose, 'k', '5')
    expect(draftSource(k5).src).toBe('r = 2cos(5θ)')
    const third = setDraftInterval(d, 1, 'pi/3')
    expect(draftSource(third).src).toBe('r = 2cos(3θ) {0 <= θ <= pi/3}')
    const cyc: MotionDraft = { ...blankMotionDraft('parametric'), paramFamily: 'cycloid' }
    expect(draftSource(cyc).src).toBe('x = t - sin(t), y = 1 - cos(t) {0 <= t <= 2pi}')
  })

  it('Custom: x(t), y(t) in the two-equation spelling; r(θ) as a polar line', () => {
    const p: MotionDraft = { ...blankMotionDraft('parametric'), paramFamily: CUSTOM }
    expect(draftSource(p).src).toBe('x = 2cos(t), y = 3sin(t) {0 <= t <= 2pi}')
    const r: MotionDraft = { ...blankMotionDraft('polar'), polarFamily: CUSTOM, customR: '1 + 2cos(θ)' }
    expect(draftSource(r).src).toBe('r = 1 + 2cos(θ) {0 <= θ <= 2pi}')
    expect(draftSource({ ...p, customX: '' }).src).toBeNull()
    expect(draftSource(setDraftInterval(p, 0, '9')).error).toMatch(/smaller t/)
  })

  it('the preview: KaTeX, the sentences, the polar sentence, and a refusal for the wrong kind', () => {
    const rose = motionPreview('r = 2cos(3θ)', 'polar')
    expect(rose.latex).toBeTruthy()
    expect(rose.describe).toMatch(/rose with 3 petals/)
    expect(rose.sentences.join(' ')).toMatch(/traced twice/)
    const ell = motionPreview('x = 2cos(t), y = 3sin(t) {0 <= t <= 2pi}', 'parametric')
    expect(ell.kind).toBe('parametric')
    expect(ell.sentences.join(' ')).toMatch(/counterclockwise/)
    expect(motionPreview('y = x^2', 'polar').error).toMatch(/not a polar curve/)
  })
})

// ---------------------------------------------------------------------------
// the particle
// ---------------------------------------------------------------------------

describe('the particle', () => {
  const e = read(ELLIPSE)

  it('its state at t, and the readouts under the slider', () => {
    const s = safeState(e.curve, e.models, PI / 2)!
    expect(s.pos.x).toBeCloseTo(0, 9)
    expect(s.pos.y).toBeCloseTo(3, 9)
    expect(s.velocity.x).toBeCloseTo(-2, 6)
    expect(s.velocity.y).toBeCloseTo(0, 6)
    const rows = motionReadouts(s, 'parametric')
    expect(rows.map((r) => r.key)).toEqual(['t', 'pos', 'velocity', 'speed', 'slope'])
    expect(rows[0].value).toBe('1.571')
    expect(rows[1].value).toBe('(0, 3)')
    expect(rows[2].value).toBe('⟨−2, 0⟩')
    const at0 = motionReadouts(safeState(e.curve, e.models, 0), 'parametric')
    expect(at0.find((r) => r.key === 'slope')!.value).toBe('vertical tangent')
  })

  it('polar readouts carry r and dr/dθ', () => {
    const r = read(ROSE)
    const rows = motionReadouts(safeState(r.curve, r.models, 0), 'polar')
    expect(rows.find((x) => x.key === 'r')!.value).toBe('2')
    expect(rows.find((x) => x.key === 'drdt')!.value).toBe('0')
  })

  it('play: 1× is one unit of t per second, wrapping at the end; long intervals take 12 s', () => {
    expect(tRate([0, 2 * PI])).toBe(1)
    expect(tRate([0, 120])).toBe(10)
    expect(advanceT(1, 0.5, 2, [0, 2 * PI])).toBeCloseTo(2, 12)
    expect(advanceT(6.2, 0.2, 1, [0, 2 * PI])).toBeCloseTo(6.4 - 2 * PI, 12)
    expect(clampT(99, [0, 1])).toBe(1)
    expect(clampT(Number.NaN, [0, 1])).toBe(0)
  })

  it('a dragged particle takes the t of the nearest point', () => {
    expect(nearestT(e.curve, e.models, [0, 2 * PI], { x: 0, y: 3.2 })).toBeCloseTo(PI / 2, 6)
  })

  it('vector scale: ×1 when it fits, else the largest nice step that does', () => {
    expect(vectorScale(100, 150)).toBe(1)
    expect(vectorScale(1000, 150)).toBe(0.1)
    expect(vectorScale(400, 150)).toBe(0.25)
    expect(vectorScale(5, 150)).toBe(10)
    expect(capPx(800, 600)).toBe(150)
  })

  it('a drawn vector is never longer than the cap, and keeps its direction', () => {
    const v = drawnVector({ x: 30, y: 40 }, 1, FRAME, 150)
    expect(pxLength(v, FRAME)).toBeCloseTo(150, 9)
    expect(v.y / v.x).toBeCloseTo(4 / 3, 12)
    const short = drawnVector({ x: 1, y: 0 }, 0.5, FRAME, 150)
    expect(short).toEqual({ x: 0.5, y: 0 })
  })

  it('particle shapes: the dot last, the velocity arrow from it, acceleration only when asked', () => {
    const s = safeState(e.curve, e.models, 1.25)!
    const scales = motionScales(e.curve, e.models, [0, 2 * PI], FRAME)
    expect(scales.velocity).toBe(1)
    const without = particleShapes(s, { color: '#4f9cf9', idBase: 'm', fr: FRAME, scales, accel: false })
    expect(without.map((x) => x.kind)).toEqual(['vector', 'point'])
    const vec = without[0]
    if (vec.kind !== 'vector') throw new Error('vector')
    expect(vec.tail).toEqual(s.pos)
    expect(vec.label).toBe('v')
    const withA = particleShapes(s, { color: '#4f9cf9', idBase: 'm', fr: FRAME, scales, accel: true })
    expect(withA.map((x) => x.kind)).toEqual(['vector', 'vector', 'point'])
    // a board so small that ×1 would overrun a quarter of it
    const tiny: PxFrame = { ppx: 50, ppy: 50, widthPx: 200, heightPx: 200 }
    const small = motionScales(e.curve, e.models, [0, 2 * PI], tiny)
    expect(small.velocity).toBeLessThan(1)
    for (const sh of particleShapes(s, { color: '#fff', idBase: 'm', fr: tiny, scales: small, accel: true })) {
      if (sh.kind === 'vector') expect(pxLength(sh.v, tiny)).toBeLessThanOrEqual(capPx(200, 200) + 1e-9)
    }
  })

  it('the polar ray runs dashed from the pole to the point', () => {
    const r = read(ROSE)
    const ray = poleRay(safeState(r.curve, r.models, 0.2)!, '#f00', 'ray')!
    expect(ray.pts[0]).toEqual({ x: 0, y: 0 })
    expect(ray.dash).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// direction arrows and marks
// ---------------------------------------------------------------------------

describe('direction arrows', () => {
  it('3–5 evenly spaced t, clear of the ends', () => {
    expect(directionArrowTs([0, 4], 4)).toEqual([0.5, 1.5, 2.5, 3.5])
    expect(directionArrowTs([0, 1], 1)).toHaveLength(3)
    expect(directionArrowTs([0, 1], 9)).toHaveLength(5)
  })

  it('heads along the tangent, counterclockwise round the ellipse, one arrow long, centred on the curve', () => {
    const e = read(ELLIPSE)
    const arrows = directionArrows(e.curve, e.models, { fr: FRAME, color: '#fff', idBase: 'a' })
    expect(arrows).toHaveLength(4)
    for (const a of arrows) {
      if (a.kind !== 'vector') throw new Error('vector')
      expect(pxLength(a.v, FRAME)).toBeCloseTo(ARROW_PX, 9)
      const mid = { x: a.tail.x + a.v.x / 2, y: a.tail.y + a.v.y / 2 }
      // on the ellipse
      expect((mid.x / 2) ** 2 + (mid.y / 3) ** 2).toBeCloseTo(1, 9)
      // counterclockwise: position × direction > 0
      expect(mid.x * a.v.y - mid.y * a.v.x).toBeGreaterThan(0)
    }
  })

  it('the features as marks: tangents, singular points (a cycloid’s cusps), the start', () => {
    const cyc = read('x = t - sin(t), y = 1 - cos(t) {0 <= t <= 2pi}')
    const marks = motionMarks(safeFeatures(cyc.curve, cyc.models)!, 'parametric')
    const singular = marks.filter((m) => m.label.startsWith('singular point'))
    expect(singular.map((m) => m.exactX)).toEqual(['0', '2π'])
    expect(marks.some((m) => m.label.startsWith('horizontal tangent (t = π)'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// polar area
// ---------------------------------------------------------------------------

describe('polar area', () => {
  const r = read(ROSE)

  it('the region is fanned from the pole: pole, r(θ) from a to b, pole', () => {
    const poly = polarRegion(r.curve, r.models, 0, PI / 3, 60)
    expect(poly[0]).toEqual({ x: 0, y: 0 })
    expect(poly[poly.length - 1]).toEqual({ x: 0, y: 0 })
    expect(poly[1].x).toBeCloseTo(2, 12)
    expect(poly).toHaveLength(63)
    expect(polarRegion(r.curve, r.models, 1, 1)).toEqual([])
  })

  it('the default is one petal; the readout is exact', () => {
    const [a, b] = defaultAreaBounds(r.curve, r.models)
    expect(a).toBeCloseTo(PI / 6, 9)
    expect(b).toBeCloseTo(PI / 2, 9)
    expect(polarAreaText(safePolarArea(r.curve, r.models, a, b))).toBe('½∫ r² dθ = π/3 ≈ 1.047')
    expect(polarAreaText(safePolarArea(r.curve, r.models, 0, PI / 3))).toBe('½∫ r² dθ = π/3 ≈ 1.047')
  })

  it('a cardioid (no petal) defaults to one trace; a rose retraces twice over 2π', () => {
    const c = read('r = 1 + cos(θ)')
    const [a, b] = defaultAreaBounds(c.curve, c.models)
    expect(a).toBe(0)
    expect(b).toBeCloseTo(2 * PI, 12)
    expect(retraceCount(r.curve, r.models)).toBe(2)
    expect(retraceCount(c.curve, c.models)).toBe(1)
  })

  it('the area state becomes a region overlay, or nothing when off or unreadable', () => {
    expect(areaOverlayFor(r.curve, r.models, { on: true, a: '0', b: 'π/3' })!.boundary.length).toBeGreaterThan(10)
    expect(areaOverlayFor(r.curve, r.models, { on: false, a: '0', b: 'π/3' })).toBeNull()
    expect(areaOverlayFor(r.curve, r.models, { on: true, a: 'x', b: '1' })).toBeNull()
    expect(readAreaBounds('π/2', 'π/6')).toEqual({ a: PI / 6, b: PI / 2 })
  })
})

// ---------------------------------------------------------------------------
// markup
// ---------------------------------------------------------------------------

describe('MotionEditor markup', () => {
  const editor = (initial: MotionDraft): string =>
    renderToStaticMarkup(createElement(MotionEditor, { onBuild: () => null, onClose: NOOP, initial }))

  it('Parametric: the family picker with every family and Custom, the line, the sentences', () => {
    const html = editor({ ...blankMotionDraft('parametric'), paramFamily: 'ellipse' })
    expect(html).toContain('data-testid="motion-editor"')
    for (const f of PARAM_FAMILIES) expect(html).toContain(`value="${f.id}"`)
    expect(html).toContain('value="custom"')
    expect(html).toContain('data-src="x = 3cos(t), y = 2sin(t) {0 &lt;= t &lt;= 2pi}"')
    expect(html).toContain('data-testid="motion-sentences"')
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Add to graph/)
  })

  it('Polar: a rose a = 2, k = 3 is described in words', () => {
    const html = editor({ ...blankMotionDraft('polar'), polarFamily: 'roseCos' })
    expect(html).toContain('data-testid="motion-tab-polar"')
    expect(html).toContain('data-src="r = 2cos(3θ)"')
    expect(html).toContain('a rose with 3 petals')
  })

  it('Custom fields, and a bad interval disables Add', () => {
    const d = { ...blankMotionDraft('parametric'), paramFamily: CUSTOM }
    const html = editor(d)
    expect(html).toContain('aria-label="x as a formula in t"')
    expect(html).toContain('aria-label="y as a formula in t"')
    const bad = editor(setDraftInterval(d, 1, '-1'))
    expect(bad).toContain('class="expr-error"')
    expect(bad).toMatch(/<button[^>]*disabled=""[^>]*>Add to graph/)
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
    onMotionPlay: NOOP,
    onMotionInterval: () => null,
  }
  return renderToStaticMarkup(createElement(CurveCard, props as unknown as Parameters<typeof CurveCard>[0]))
}

function typedCard(line: string): string {
  const outcome = parseExpression(line)
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
  return card(curve, { expr_1: spec }, line)
}

describe('the Motion section on a card', () => {
  it('a parametric line: interval, features, the player, the readouts', () => {
    const html = typedCard(ELLIPSE)
    expect(html).toContain('data-testid="motion-section"')
    expect(html).toContain('data-kind="parametric"')
    expect(html).toContain('Motion · parametric')
    expect(html).toContain('value="2π"')
    expect(html).toContain('(0, 3) at t = π/2')
    expect(html).toContain('data-testid="motion-play"')
    expect(html).toContain('data-testid="motion-slider"')
    expect(html).toContain('0.5×')
    expect(html).toContain('t =')
    expect(html).toContain('vertical tangent')
    expect(html).not.toContain('data-testid="motion-area"')
  })

  it('a polar line: the polar sentence, r and dr/dθ, the area switch', () => {
    const html = typedCard(ROSE)
    expect(html).toContain('data-kind="polar"')
    expect(html).toContain('a rose with 3 petals')
    expect(html).toContain('dr/dθ =')
    expect(html).toContain('data-testid="motion-area"')
    expect(html).toContain('traced twice')
  })

  it('y = x² has no Motion section', () => {
    expect(typedCard('y = x^2')).not.toContain('data-testid="motion-section"')
  })

  it('the section with a player: the shaded area readout and the vectors’ scale', () => {
    const r = read(ROSE)
    const html = renderToStaticMarkup(
      createElement(MotionSection, {
        curve: r.curve,
        models: r.models,
        kind: 'polar',
        src: ROSE,
        play: {
          t: 0.5, playing: true, speed: 2, accel: true, exportParticle: false,
          area: { on: true, a: '0', b: 'π/3' },
        },
        scales: { velocity: 0.5, acceleration: 0.1 },
        onPlay: NOOP,
        onInterval: () => null,
      }),
    )
    expect(html).toContain('½∫ r² dθ = π/3 ≈ 1.047')
    expect(html).toContain('Velocity drawn ×0.5, acceleration ×0.1')
    expect(html).toContain('aria-label="Pause"')
    expect(html).toMatch(/aria-pressed="true"[^>]*>2×/)
  })
})

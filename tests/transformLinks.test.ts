// ============================================================================
// tests/transformLinks.test.ts — a curve read as a transformed parent, as the
// UI edits it.
//
// The bridge itself (readTransform, transformSource, describe, mapPoints,
// transformFeatures) belongs to the core and is tested there. What is tested
// HERE is the UI half: the gallery draft (picking a parent keeps a, b, h, k),
// the sliders' texts, the preview, the two board handles and their drags, the
// ghost of the parent and the key-point arrows, the coexistence rule with the
// Roots / Exponential / Logarithmic / Sinusoidal sections, the editor's markup
// and the card section — on hand-typed -2(x-3)^2+1 and sqrt(4-x), collapsed
// on 2^(x-1)+3, absent on x^3 - x.
// ============================================================================

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { FittedCurve, ModelSpec, Vec2 } from '../src/core/types'
import { DARK_THEME } from '../src/core/types'
import { mapPoints, transformSource } from '../src/core/transform'
import type { TransformSpec } from '../src/core/transform'
import { parseExpression } from '../src/core/parse'
import {
  PARENT_IDS,
  blankTransformDraft,
  commitTransformSpec,
  dragTransformHandle,
  featureLines,
  handlePoint,
  keyPointArrows,
  parentGhost,
  parentThumbScene,
  pointRows,
  safeReadTransform,
  sliderText,
  sliderValue,
  specFromDraft,
  sticky,
  transformEval,
  transformHandles,
  transformKeyMarks,
  transformOpenByDefault,
  transformOwnsHandles,
  transformPreview,
  withParent,
} from '../src/ui/transformLinks'
import type { OtherReadings } from '../src/ui/transformLinks'
import { safeReadFactored } from '../src/ui/factorLinks'
import { TransformEditor } from '../src/ui/TransformEditor'
import { CurveCard } from '../src/ui/CurveCard'

const NOOP = (): void => {}

/** Evaluate a typed line through the real parser. */
function lineAt(src: string, x: number): number {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(`${src}: ${o.error}`)
  const m = o.plot.makeModel('t')
  return m.evalExplicit!(o.plot.defaultParams, x)
}

const VERTEX: TransformSpec = safeReadTransform('y = -2(x - 3)^2 + 1')!

const NONE: OtherReadings = { factored: null, exponential: false, logarithmic: false, sinusoidal: false }

// ---------------------------------------------------------------------------

describe('the draft of Build ▾ → Transformation', () => {
  it('picking another parent keeps a, b, h, k exactly as typed', () => {
    const d = { ...blankTransformDraft(), a: '2', b: '1/2', h: 'pi/4', k: '-3' }
    const e = withParent(d, 'sqrt')
    expect(e).toEqual({ parent: 'sqrt', a: '2', b: '1/2', h: 'pi/4', k: '-3' })
    expect(withParent(e, 'sqrt')).toBe(e)
    for (const id of PARENT_IDS) {
      const f = withParent(d, id)
      expect([f.a, f.b, f.h, f.k]).toEqual(['2', '1/2', 'pi/4', '-3'])
    }
  })

  it('starts on y = x² and refuses a = 0, b = 0 and non-numbers', () => {
    expect(specFromDraft(blankTransformDraft()).spec).toMatchObject({ parent: 'quadratic', a: '1' })
    expect(specFromDraft({ ...blankTransformDraft(), a: '0' }).error).toMatch(/a can’t be 0/)
    expect(specFromDraft({ ...blankTransformDraft(), b: '0' }).error).toMatch(/b can’t be 0/)
    expect(specFromDraft({ ...blankTransformDraft(), h: 'banana' }).error).toMatch(/not a number/)
    expect(specFromDraft({ ...blankTransformDraft(), k: '' }).spec?.k).toBe('0')
  })

  it('sliders: a text puts the slider where it evaluates, the slider writes a clean text', () => {
    expect(sliderValue('a', '-2')).toBe(-2)
    expect(sliderValue('h', 'pi')).toBeCloseTo(Math.PI, 12)
    expect(sliderValue('a', 'banana')).toBe(1)
    expect(sliderValue('k', '40')).toBe(10)
    expect(sliderText('a', 0.30000000000000004)).toBe('0.3')
    expect(sliderText('h', -2.5)).toBe('-2.5')
    expect(sliderText('b', 0)).toBe('0')
  })

  it('√x with a = 2, h = 1, k = 3: the line, and (4, 2) goes to (5, 7)', () => {
    const { spec } = specFromDraft({ parent: 'sqrt', a: '2', b: '1', h: '1', k: '3' })
    const p = transformPreview(spec)
    expect(p.src).toBe('y = 2sqrt(x - 1) + 3')
    expect(p.error).toBeNull()
    expect(p.latex).toBeTruthy()
    expect(p.steps).toEqual(['shift right 1', 'vertical stretch by a factor of 2', 'shift up 3'])
    expect(p.rows).toContainEqual({ from: '(4, 2)', to: '(5, 7)', anchor: false })
    expect(p.rows[0]).toEqual({ from: '(0, 0)', to: '(1, 3)', anchor: true })
    expect(p.features).toContain('domain: x ≥ 1')
    expect(p.features).toContain('starting point: (1, 3)')
    expect(lineAt(p.src!, 5)).toBeCloseTo(7, 12)
  })
})

describe('the card: reading, table, features, one commit', () => {
  it('-2(x-3)^2+1 reads as x², the table maps (−2, 4) to (1, −7)', () => {
    expect(VERTEX).toMatchObject({ parent: 'quadratic', a: '-2', b: '1', h: '3', k: '1' })
    const rows = pointRows(VERTEX)
    expect(rows[0]).toEqual({ from: '(−2, 4)', to: '(1, −7)', anchor: false })
    expect(rows.find((r) => r.anchor)).toEqual({ from: '(0, 0)', to: '(3, 1)', anchor: true })
    expect(featureLines(VERTEX)).toEqual(['domain: all real numbers', 'range: y ≤ 1', 'vertex: (3, 1)'])
  })

  it('x^2 - 6x + 8 is read in vertex form', () => {
    expect(safeReadTransform('y = x^2 - 6x + 8')).toMatchObject({ parent: 'quadratic', a: '1', h: '3', k: '-1' })
  })

  it('a field edit restates the whole line once; an unchanged one does nothing', () => {
    const said: string[] = []
    const deps = { restate: (src: string) => (said.push(src), null) }
    expect(commitTransformSpec(VERTEX, { ...VERTEX, k: '5' }, 'set vertical shift', deps)).toBeNull()
    expect(said).toEqual(['y = -2(x - 3)^2 + 5'])
    expect(commitTransformSpec(VERTEX, { ...VERTEX }, 'x', deps)).toBeNull()
    expect(said).toHaveLength(1)
    expect(commitTransformSpec(VERTEX, { ...VERTEX, b: '0' }, 'x', deps)).toMatch(/b can’t be 0/)
  })
})

describe('coexistence with the other family sections', () => {
  const others = (src: string, extra: Partial<OtherReadings> = {}): OtherReadings => ({
    ...NONE,
    factored: safeReadFactored(src),
    ...extra,
  })

  it('opens by itself on the parents no other section speaks for', () => {
    for (const src of ['y = x^2', 'y = |x|', 'y = sqrt(x)', 'y = cbrt(x)', 'y = 1/x', 'y = 1/x^2', 'y = x^3', 'y = floor(x)', 'y = tan(x)', 'y = -2(x - 3)^2 + 1']) {
      const spec = safeReadTransform(src)!
      expect(spec, src).not.toBeNull()
      expect(transformOpenByDefault(spec, others(src)), src).toBe(true)
    }
  })

  it('collapsed when Exponential / Logarithmic / Sinusoidal applies, or two roots, or a line', () => {
    const exp = safeReadTransform('y = 2^(x-1)+3')!
    expect(transformOpenByDefault(exp, { ...NONE, exponential: true })).toBe(false)
    expect(transformOpenByDefault(safeReadTransform('y = ln(x - 1)')!, { ...NONE, logarithmic: true })).toBe(false)
    expect(transformOpenByDefault(safeReadTransform('y = sin(x)')!, { ...NONE, sinusoidal: true })).toBe(false)
    const two = 'y = (x - 2)(x - 4)'
    expect(safeReadFactored(two)).not.toBeNull()
    expect(transformOpenByDefault(safeReadTransform(two)!, others(two))).toBe(false)
    expect(transformOpenByDefault(safeReadTransform('y = 2x + 3')!, NONE)).toBe(false)
  })

  it('the transformation handles belong to the line only when no other family has handles on it', () => {
    expect(transformOwnsHandles(NONE)).toBe(true)
    expect(transformOwnsHandles({ ...NONE, exponential: true })).toBe(false)
    expect(transformOwnsHandles(others('y = x^2'))).toBe(false)
  })
})

describe('the board while selected: marks, ghost, arrows', () => {
  it('every image key point is marked, the vertex as the maximum of a downward parabola', () => {
    const marks = transformKeyMarks(VERTEX)
    expect(marks).toHaveLength(5)
    const v = marks.find((m) => m.label === 'vertex')!
    expect(v).toMatchObject({ kind: 'maximum', pos: { x: 3, y: 1 }, exactX: '3', exactY: '1', exact: true })
    expect(marks[0]).toMatchObject({ pos: { x: 1, y: -7 }, exactX: '1', exactY: '−7' })
  })

  it('the ghost is the PARENT, dashed, lifting the pen at a pole, between steps and outside a domain', () => {
    const q = parentGhost('quadratic', [-4, 4], 'grey', 'g', 80)
    expect(q.dash && q.dash.length).toBeGreaterThan(0)
    for (const p of q.pts) expect(p.y).toBeCloseTo(p.x * p.x, 12)

    const r = parentGhost('reciprocal', [-2, 2], 'grey', 'g', 81)
    const gapAt = r.pts.findIndex((p) => !Number.isFinite(p.x))
    expect(gapAt).toBeGreaterThan(0)
    expect(r.pts[gapAt - 1].x).toBeLessThan(0)
    expect(r.pts.slice(gapAt + 1).find((p) => Number.isFinite(p.x))!.x).toBeGreaterThanOrEqual(0)

    const f = parentGhost('floor', [-1.5, 1.5], 'grey', 'g')
    const steps = f.pts.filter((p) => Number.isFinite(p.x))
    expect(steps).toContainEqual({ x: 0, y: 0 })
    expect(steps).toContainEqual({ x: 1, y: 0 })
    expect(f.pts.filter((p) => !Number.isFinite(p.x)).length).toBeGreaterThanOrEqual(3)

    const s = parentGhost('sqrt', [-3, 3], 'grey', 'g', 60)
    expect(s.pts.filter((p) => Number.isFinite(p.x)).every((p) => p.x >= 0)).toBe(true)
  })

  it('one arrow per key point, from the parent point to its image, with a head at screen size', () => {
    const frame = { ppx: 40, ppy: 20 }
    const arrows = keyPointArrows(VERTEX, frame, 'grey', 'a')
    const mapped = mapPoints(VERTEX)
    expect(arrows).toHaveLength(mapped.length)
    arrows.forEach((a, i) => {
      const { from, to } = mapped[i]
      const [tail, tip, gap, b1, tip2, b2] = a.pts
      const px = (u: Vec2, w: Vec2) => Math.hypot((u.x - w.x) * frame.ppx, (u.y - w.y) * frame.ppy)
      expect(px(tail, from)).toBeCloseTo(4, 9)
      expect(px(tip, to)).toBeCloseTo(6, 9)
      expect(Number.isFinite(gap.x)).toBe(false)
      expect(tip2).toEqual(tip)
      expect(px(b1, tip)).toBeCloseTo(9, 9)
      expect(px(b2, tip)).toBeCloseTo(9, 9)
      // the shaft points from the parent point toward the image
      const d0 = { x: (to.x - from.x) * frame.ppx, y: (to.y - from.y) * frame.ppy }
      const d1 = { x: (tip.x - tail.x) * frame.ppx, y: (tip.y - tail.y) * frame.ppy }
      expect(d0.x * d1.x + d0.y * d1.y).toBeGreaterThan(0)
    })
  })

  it('a point that does not move gets no arrow (the parent itself: none at all)', () => {
    expect(keyPointArrows(safeReadTransform('y = x^2')!, { ppx: 40, ppy: 40 }, 'grey', 'a')).toEqual([])
    // x² shifted up 1: every point moves exactly 1 unit
    expect(keyPointArrows(safeReadTransform('y = x^2 + 1')!, { ppx: 40, ppy: 40 }, 'grey', 'a')).toHaveLength(5)
  })
})

describe('the two handles', () => {
  it('-2(x-3)^2+1: the vertex, and the image of (1, 1)', () => {
    const hs = transformHandles(VERTEX)
    expect(hs.map((h) => h.which)).toEqual(['anchor', 'point'])
    expect(hs[0].pos).toEqual({ x: 3, y: 1 })
    expect(hs[0].label).toMatch(/^vertex \(3, 1\)/)
    expect(hs[1].from).toEqual({ x: 1, y: 1 })
    expect(hs[1].pos).toEqual({ x: 4, y: -1 })
  })

  it('the second handle is off the anchor on both axes, one unit right where the table has it', () => {
    expect(handlePoint('quadratic')).toEqual({ x: 1, y: 1 })
    expect(handlePoint('exp2')).toEqual({ x: 1, y: 2 })
    expect(handlePoint('log2')).toEqual({ x: 2, y: 1 })
    expect(handlePoint('reciprocal')).toEqual({ x: 1, y: 1 })
    expect(handlePoint('sin')!.x).toBeCloseTo(Math.PI / 2, 12)
    expect(handlePoint('cos')).toMatchObject({ y: -1 })
    for (const id of PARENT_IDS) expect(handlePoint(id), id).not.toBeNull()
  })

  it('dragging the vertex moves h and k together', () => {
    const next = dragTransformHandle(VERTEX, 'anchor', { x: 5, y: -2 })!
    expect(next).toMatchObject({ a: '-2', b: '1', h: '5', k: '-2' })
    expect(transformSource(next)).toBe('y = -2(x - 5)^2 - 2')
  })

  it('a vertical drag of the anchor leaves h’s text alone', () => {
    const spec = safeReadTransform('y = (x - pi/4)^2')!
    const next = dragTransformHandle(spec, 'anchor', { x: Math.PI / 4, y: 2 })!
    expect(next.h).toBe(spec.h)
    expect(next.k).toBe('2')
  })

  it('the point: vertically a (the vertex held), sideways b', () => {
    const up = dragTransformHandle(VERTEX, 'point', { x: 4, y: -3 })!
    expect(up).toMatchObject({ a: '-4', b: '1', h: '3', k: '1' })
    const side = dragTransformHandle(VERTEX, 'point', { x: 5, y: -1 })!
    expect(side).toMatchObject({ a: '-2', b: '0.5', h: '3', k: '1' })
    // the dragged point is where it was put, the vertex where it was
    expect(transformEval(side, 5)).toBeCloseTo(-1, 12)
    expect(transformEval(side, 3)).toBeCloseTo(1, 12)
    // across the vertex: an even parent is the same curve with |b|
    expect(dragTransformHandle(VERTEX, 'point', { x: 2, y: -1 })).toMatchObject({ b: '1' })
    // onto the vertex's level: a = 0 is no transformation
    expect(dragTransformHandle(VERTEX, 'point', { x: 4, y: 1 })).toBeNull()
  })

  it('2^(x-1)+3: the anchor (1, 4) holds while (2, 5) is dragged up — a and k both move', () => {
    const exp = safeReadTransform('y = 2^(x-1)+3')!
    const hs = transformHandles(exp)
    expect(hs[0].pos).toEqual({ x: 1, y: 4 })
    expect(hs[1].pos).toEqual({ x: 2, y: 5 })
    const next = dragTransformHandle(exp, 'point', { x: 2, y: 7 })!
    expect(transformEval(next, 1)).toBeCloseTo(4, 12)
    expect(transformEval(next, 2)).toBeCloseTo(7, 12)
    expect(next).toMatchObject({ a: '3', k: '1' })
  })

  it('log₂: dragging (2, 1)’s image sideways keeps the anchor (1, 0) in place', () => {
    const log = safeReadTransform('y = log_2(x)')!
    const next = dragTransformHandle(log, 'point', { x: 5, y: 1 })!
    expect(transformEval(next, 1)).toBeCloseTo(0, 12)
    expect(transformEval(next, 5)).toBeCloseTo(1, 12)
  })

  it('a line: the y-intercept moves k only, the other point the slope only', () => {
    const line = safeReadTransform('y = 2x + 3')!
    const hs = transformHandles(line)
    expect(hs[0].label).toMatch(/^y-intercept/)
    expect(dragTransformHandle(line, 'anchor', { x: 4, y: 1 })).toMatchObject({ a: '2', h: '0', k: '1' })
    expect(dragTransformHandle(line, 'point', { x: 9, y: 7 })).toMatchObject({ a: '4', b: '1', k: '3' })
  })

  it('sticky: a pointer that has not really moved along an axis stays exactly put', () => {
    expect(sticky(3.04, 3, 60, 3.1)).toBe(3)
    expect(sticky(3.5, 3, 60, 3.5)).toBe(3.5)
  })
})

describe('gallery thumbnails', () => {
  it('a scene per parent: the parent itself as a curve, framed on its key points', () => {
    for (const id of PARENT_IDS) {
      const s = parentThumbScene(id, DARK_THEME, 64, 40)
      expect(s.curves, id).toHaveLength(1)
      const c = s.curves[0]
      expect(s.models[c.modelId], id).toBeDefined()
      expect(s.vp.widthPx).toBe(64)
      expect(s.vp.pxPerUnitY).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------

describe('TransformEditor — markup', () => {
  it('a gallery of sixteen parents, the formula, the fields and sliders, the steps and the table', () => {
    const html = renderToStaticMarkup(
      createElement(TransformEditor, {
        initial: { parent: 'sqrt', a: '2', b: '1', h: '1', k: '3' },
        onBuild: () => null,
        onClose: NOOP,
      }),
    )
    expect(html).toContain('data-testid="transform-editor"')
    expect(html).toContain('data-testid="parent-gallery"')
    expect(html.match(/role="radio"/g)).toHaveLength(16)
    expect(html.match(/data-testid="parent-thumb-/g)).toHaveLength(16)
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1)
    expect(html).toMatch(/data-testid="parent-sqrt"[^>]*>|aria-checked="true"[^>]*data-testid="parent-sqrt"/)
    expect(html).toContain('Square root: y = √x')
    expect(html.match(/type="range"/g)).toHaveLength(4)
    expect(html).toContain('data-src="y = 2sqrt(x - 1) + 3"')
    expect(html).toMatch(/data-tex="[^"]+"/)
    expect(html).toContain('<ol class="te-steps" data-testid="transform-steps">')
    expect(html).toContain('<li>shift right 1</li><li>vertical stretch by a factor of 2</li><li>shift up 3</li>')
    expect(html).toContain('data-testid="transform-map"')
    expect(html).toContain('<td>(4, 2)</td>')
    expect(html).toContain('<td>(5, 7)</td>')
    expect(html).toContain('domain: x ≥ 1')
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>Add to graph/)
  })

  it('a = 0 is refused and the button disabled', () => {
    const html = renderToStaticMarkup(
      createElement(TransformEditor, {
        initial: { parent: 'quadratic', a: '0', b: '1', h: '0', k: '0' },
        onBuild: () => null,
        onClose: NOOP,
      }),
    )
    expect(html).toContain('a can’t be 0')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Add to graph/)
  })
})

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
    onExpRestate: () => null,
    onLogRestate: () => null,
    onSinRestate: () => null,
    onTransformRestate: () => null,
    onTransformShowParent: NOOP,
    onShowInverse: NOOP,
    onConvertTyped: () => null,
  }
  return renderToStaticMarkup(
    createElement(CurveCard, props as unknown as Parameters<typeof CurveCard>[0]),
  )
}

/** The Transformation section's own markup. */
function section(html: string): string {
  const at = html.indexOf('data-testid="transform-section"')
  return at < 0 ? '' : html.slice(at)
}

describe('the Transformation section on a card', () => {
  it('y = -2(x-3)^2+1: open, of y = x², numbered steps, the table, features, show parent on', () => {
    const s = section(typedCard('y = -2(x-3)^2+1'))
    expect(s).not.toBe('')
    expect(s.indexOf('aria-expanded="true"')).toBeGreaterThan(-1)
    expect(s).toContain('of y = x²')
    expect(s).toContain(
      '<li>shift right 3</li><li>vertical stretch by a factor of 2</li><li>reflection across the x-axis</li><li>shift up 1</li>',
    )
    expect(s).toContain('<td>(−2, 4)</td>')
    expect(s).toContain('<td>(1, −7)</td>')
    expect(s).toContain('range: y ≤ 1')
    expect(s).toContain('vertex: (3, 1)')
    expect(s).toMatch(/data-testid="transform-show-parent"[^>]*checked=""|checked=""[^>]*data-testid="transform-show-parent"/)
    expect(s).toContain('Drag the vertex')
  })

  it('y = sqrt(4-x): open, a reflection across the y-axis', () => {
    const s = section(typedCard('y = sqrt(4-x)'))
    expect(s).not.toBe('')
    expect(s).toContain('of y = √x')
    expect(s).toContain('reflection across the y-axis')
    expect(s).toContain('domain: x ≤ 4')
  })

  it('y = 2^(x-1)+3: there as well as the Exponential section, but collapsed', () => {
    const html = typedCard('y = 2^(x-1)+3')
    expect(html).toContain('exp-section')
    const s = section(html)
    expect(s).not.toBe('')
    expect(s).toContain('of y = 2ˣ')
    const first = s.match(/aria-expanded="(true|false)"/)
    expect(first?.[1]).toBe('false')
    expect(s).not.toContain('transform-steps')
  })

  it('y = x^3 - x has none', () => {
    expect(typedCard('y = x^3 - x')).not.toContain('transform-section')
  })
})

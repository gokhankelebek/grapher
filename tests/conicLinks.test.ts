// ============================================================================
// Conic sections — the App half: src/ui/conicLinks.ts (pure), the
// "Build ▾ → Conic section" editor and the card's Conic section
// (src/ui/ConicEditor.tsx), and the sketched circle / ellipse notes.
// ============================================================================

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { conicFeatures, conicSource, readConic } from '../src/core/conics'
import type { ConicSpec } from '../src/core/conics'
import { parseExpression } from '../src/core/parse'
import { MODELS } from '../src/core/fit/models'
import {
  blankConicDraft,
  commitConicSpec,
  conicHandles,
  conicKeyMarks,
  conicProblems,
  conicSectionInfo,
  conicSpecFromCircle,
  conicSpecFromDraft,
  conicSpecFromEllipse,
  conicSpecFromEquation,
  conicSpecFromFoci,
  conicSpecFromHyperbola,
  conicSpecFromParabola,
  constructionPolylines,
  constructionShapes,
  dragConicHandle,
  fittedCircle,
  fittedEllipse,
  constructionPoints,
  isStandardForm,
  rotationOf,
  safeReadConic,
  safeReadRotated,
  lengthSource,
  parabolaOpens,
  parseDirectrix,
  parsePoint,
  setConicField,
  setParabolaOpens,
  writeStandard,
} from '../src/ui/conicLinks'
import type { ConicDraft, ConicHandleKind } from '../src/ui/conicLinks'
import { ConicEditor } from '../src/ui/ConicEditor'
import { CurveCard } from '../src/ui/CurveCard'

const NOOP = (): void => {}

const src = (r: { spec: ConicSpec | null; error: string | null }): string => {
  if (!r.spec) throw new Error(r.error ?? 'no spec')
  return conicSource(r.spec)
}

const ELLIPSE: ConicSpec = { kind: 'ellipse', h: '2', k: '-1', a: '3', b: '2' }
const HYPERBOLA: ConicSpec = { kind: 'hyperbola', h: '0', k: '0', a: '3', b: '4', opens: 'x' }
const PARABOLA: ConicSpec = { kind: 'parabola', h: '0', k: '0', a: '2', opens: 'y', p: '2' }
const CIRCLE: ConicSpec = { kind: 'circle', h: '2', k: '-3', a: '4' }

// ---------------------------------------------------------------------------
// points and numbers
// ---------------------------------------------------------------------------

describe('point fields', () => {
  it('read "(2, -1)", "2,-1", a Unicode minus and expressions', () => {
    expect(parsePoint('(2, -1)').pt).toEqual({ x: 2, y: -1 })
    expect(parsePoint('2,-1').pt).toEqual({ x: 2, y: -1 })
    expect(parsePoint('(−2, 3)').pt).toEqual({ x: -2, y: 3 })
    const p = parsePoint('(1 + sqrt(2), -3/2)').pt!
    expect(p.x).toBeCloseTo(1 + Math.SQRT2, 12)
    expect(p.y).toBe(-1.5)
    // a comma inside a call is not the point's comma
    expect(parsePoint('(max(1, 4), 2)').pt).toEqual({ x: 4, y: 2 })
  })

  it('refuse what is not a point, in words', () => {
    expect(parsePoint('(2)').error).toMatch(/as \(x, y\)/)
    expect(parsePoint('(a, 1)', 'center').error).toMatch(/center .* not a number/)
    expect(parsePoint('  ', 'vertex').error).toBe('The vertex is empty.')
  })

  it('lengthSource writes a length from its square exactly', () => {
    expect(lengthSource(9)).toBe('3')
    expect(lengthSource(6.25)).toBe('2.5')
    expect(lengthSource(5)).toBe('sqrt(5)')
    expect(lengthSource(0)).toBeNull()
  })

  it('the directrix is a line y = c or x = c', () => {
    expect(parseDirectrix('y = -2').line).toEqual({ axis: 'y', value: -2 })
    expect(parseDirectrix('x=3').line).toEqual({ axis: 'x', value: 3 })
    expect(parseDirectrix('-1/2 = y').line).toEqual({ axis: 'y', value: -0.5 })
    expect(parseDirectrix('y = 2x').line).toBeNull()
    expect(parseDirectrix('3').error).toMatch(/y = −2 or x = 3/)
  })
})

// ---------------------------------------------------------------------------
// the six tabs
// ---------------------------------------------------------------------------

describe('the tabs of Build ▾ → Conic section', () => {
  it('Circle: center and radius, or center and a point on it', () => {
    expect(src(conicSpecFromCircle({ center: '(2, -1)', by: 'radius', radius: '3', point: '' }))).toBe(
      '(x - 2)^2 + (y + 1)^2 = 9',
    )
    expect(src(conicSpecFromCircle({ center: '(0, 0)', by: 'point', radius: '', point: '(3, 4)' }))).toBe(
      'x^2 + y^2 = 25',
    )
    // the teacher's own radius text is kept
    expect(src(conicSpecFromCircle({ center: '(0,0)', by: 'radius', radius: 'sqrt(5)', point: '' }))).toBe(
      'x^2 + y^2 = 5',
    )
    expect(conicSpecFromCircle({ center: '(0,0)', by: 'radius', radius: '-2', point: '' }).error).toMatch(
      /^The radius must be a positive number\.$/,
    )
  })

  it('Ellipse: center and vertex with a focus, a co-vertex or e', () => {
    const base = { center: '(0, 0)', vertex: '(5, 0)', focus: '(3, 0)', coVertex: '(0, 4)', e: '3/5' }
    expect(src(conicSpecFromEllipse({ ...base, by: 'focus' }))).toBe('x^2/25 + y^2/16 = 1')
    expect(src(conicSpecFromEllipse({ ...base, by: 'coVertex' }))).toBe('x^2/25 + y^2/16 = 1')
    expect(src(conicSpecFromEllipse({ ...base, by: 'e' }))).toBe('x^2/25 + y^2/16 = 1')
    const out = conicSpecFromEllipse({ ...base, by: 'focus', focus: '(6, 0)' })
    expect(out.spec).toBeNull()
    expect(out.error).toMatch(/^The focus must be between the center and the vertex/)
  })

  it('Hyperbola: center and vertex with a focus, an asymptote slope or e', () => {
    const base = { center: '(0, 0)', vertex: '(3, 0)', focus: '(5, 0)', slope: '4/3', e: '5/3' }
    for (const by of ['focus', 'slope', 'e'] as const) {
      expect(src(conicSpecFromHyperbola({ ...base, by }))).toBe('x^2/9 - y^2/16 = 1')
    }
    const f = conicFeatures(conicSpecFromHyperbola({ ...base, by: 'focus' }).spec!)
    expect(f.asymptotes.map((a) => a.text)).toEqual(['y = (4/3)x', 'y = −(4/3)x'])
    expect(conicSpecFromHyperbola({ ...base, by: 'e', e: '1/2' }).error).toMatch(/greater than 1/)
  })

  it('Parabola: vertex + focus, focus + directrix, vertex + point + opens', () => {
    const base = { vertex: '(0, 0)', focus: '(0, 2)', directrix: 'y = -2', point: '(4, 2)', opens: 'up' as const }
    expect(src(conicSpecFromParabola({ ...base, by: 'vertex-focus' }))).toBe('x^2 = 8y')
    expect(src(conicSpecFromParabola({ ...base, by: 'focus-directrix' }))).toBe('x^2 = 8y')
    expect(src(conicSpecFromParabola({ ...base, by: 'vertex-point' }))).toBe('x^2 = 8y')
    expect(conicSpecFromParabola({ ...base, by: 'focus-directrix', directrix: 'y = 2' }).error).toMatch(
      /can't be on the directrix/,
    )
    expect(conicSpecFromParabola({ ...base, by: 'vertex-point', opens: 'down' }).error).toMatch(
      /opens down can't pass through a point above/,
    )
  })

  it('Foci: the sum is an ellipse, the difference a hyperbola', () => {
    const base = { f1: '(-5, 0)', f2: '(5, 0)', sum: '12', difference: '8' }
    expect(src(conicSpecFromFoci({ ...base, by: 'sum' }))).toBe('x^2/36 + y^2/11 = 1')
    expect(src(conicSpecFromFoci({ ...base, by: 'difference' }))).toBe('x^2/16 - y^2/9 = 1')
    expect(conicSpecFromFoci({ ...base, by: 'sum', sum: '8' }).error).toMatch(/more than the distance between the foci/)
  })

  it('Equation: a general form is completed to standard form, with the discriminant sentence', () => {
    const r = conicSpecFromEquation({ text: '9x^2 + 4y^2 - 36x + 8y + 4 = 0' })
    expect(src(r)).toBe('(x - 2)^2/4 + (y + 1)^2/9 = 1')
    expect(r.classSentence).toMatch(/B² − 4AC = −144 < 0: an ellipse/)
    // a function y = f(x) is read as the equation it is
    expect(src(conicSpecFromEquation({ text: 'y = x^2 - 4x + 1' }))).toBe('(x - 2)^2 = y + 3')
  })

  it('Equation: a rotated or degenerate quadratic is refused in words', () => {
    const rot = conicSpecFromEquation({ text: 'x^2 + xy + y^2 = 3' })
    expect(rot.spec).toBeNull()
    expect(rot.error).toMatch(/rotated 45°.*horizontal and vertical axes/)
    const deg = conicSpecFromEquation({ text: 'x^2 - y^2 = 0' })
    expect(deg.error).toMatch(/two lines y = ±x/)
    expect(conicSpecFromEquation({ text: 'y = x^3' }).error).toMatch(/^That is not a conic/)
  })

  it('every default tab builds', () => {
    const d = blankConicDraft()
    for (const tab of ['circle', 'ellipse', 'hyperbola', 'parabola', 'foci', 'equation'] as const) {
      const r = conicSpecFromDraft({ ...d, tab })
      expect(r.error, tab).toBeNull()
      expect(r.spec, tab).not.toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// the card
// ---------------------------------------------------------------------------

describe('standard form on the card', () => {
  it('detects a general-form line and writes it in standard form', () => {
    expect(writeStandard('x^2 + y^2 - 4x + 6y - 3 = 0')).toBe('(x - 2)^2 + (y + 3)^2 = 16')
    expect(writeStandard('4x^2 + 9y^2 = 36')).toBe('x^2/9 + y^2/4 = 1')
    // already standard (spacing aside): nothing to do
    expect(writeStandard('(x-2)^2/9 + (y+1)^2/4 = 1')).toBeNull()
    expect(writeStandard('x^2 = 8y')).toBeNull()
    expect(isStandardForm('(x − 2)² + (y + 3)² = 16', CIRCLE)).toBe(true)
  })

  it('conicSectionInfo: implicit conics only; rotated and degenerate get the sentence', () => {
    expect(conicSectionInfo('y = x^2', 'explicit')).toBeNull()
    expect(conicSectionInfo('x^2 + y^2 - 4x + 6y - 3 = 0', 'implicit')).toMatchObject({
      kind: 'conic',
      general: true,
      spec: { kind: 'circle', h: '2', k: '-3', a: '4' },
    })
    // a rotated conic is now READ (in its own axes x′, y′), still with the sentence
    const rot = conicSectionInfo('x^2 + xy + y^2 = 3', 'implicit')
    expect(rot).toMatchObject({ kind: 'rotated', sentence: 'B² − 4AC = −3 < 0: an ellipse, rotated 45°.' })
    expect(conicSectionInfo('xy = 0', 'implicit')).toEqual({
      kind: 'class',
      sentence: 'A degenerate conic: the two lines y = 0 and x = 0.',
    })
    expect(conicSectionInfo('x^3 + y^3 = 1', 'implicit')).toBeNull()
  })

  it('a field edit restates through the one path, and refuses a zero length', () => {
    const seen: string[] = []
    const deps = { restate: (s: string) => (seen.push(s), null) }
    expect(commitConicSpec(ELLIPSE, setConicField(ELLIPSE, 'a', '4'), 'set a', deps)).toBeNull()
    expect(seen).toEqual(['(x - 2)^2/16 + (y + 1)^2/4 = 1'])
    expect(commitConicSpec(ELLIPSE, setConicField(ELLIPSE, 'b', '0'), 'set b', deps)).toMatch(/positive/)
    expect(commitConicSpec(PARABOLA, setConicField(PARABOLA, 'p', '0'), 'set p', deps)).toMatch(/can’t be 0/)
    expect(seen).toHaveLength(1)
  })

  it('a parabola turned another way keeps |p|', () => {
    expect(parabolaOpens(PARABOLA)).toBe('up')
    const down = setParabolaOpens(PARABOLA, 'down')
    expect(conicSource(down)).toBe('x^2 = -8y')
    const left = setParabolaOpens(down, 'left')
    expect(conicSource(left)).toBe('y^2 = -8x')
    expect(conicSource(setParabolaOpens(left, 'right'))).toBe('y^2 = 8x')
  })
})

// ---------------------------------------------------------------------------
// the board
// ---------------------------------------------------------------------------

describe('the board while a conic is selected', () => {
  it('marks center, vertices, co-vertices and foci with exact text', () => {
    const m = conicKeyMarks(ELLIPSE)
    expect(m.map((p) => p.label)).toEqual([
      'center', 'vertex', 'vertex', 'co-vertex', 'co-vertex', 'focus F₁', 'focus F₂',
    ])
    const f2 = m.find((p) => p.label === 'focus F₂')!
    expect(f2.exactX).toBe('2 + √5')
    expect(f2.pos.x).toBeCloseTo(2 + Math.sqrt(5), 12)
    // a circle's "focus" is its center: not marked twice
    expect(conicKeyMarks(CIRCLE).map((p) => p.label)).toEqual(['center'])
  })

  it('draws the directrix, the asymptotes and the box; names the foci', () => {
    expect(constructionPolylines(ELLIPSE, '#f00', 'c')).toEqual([])
    const par = constructionPolylines(PARABOLA, '#f00', 'c')
    expect(par).toHaveLength(1)
    expect(par[0].pts.every((p) => p.y === -2)).toBe(true)
    expect(par[0].dash).toBeDefined()
    const hyp = constructionPolylines(HYPERBOLA, '#f00', 'c')
    expect(hyp.map((p) => p.id)).toEqual(['c:asymptote:0', 'c:asymptote:1', 'c:box'])
    const a0 = hyp[0].pts
    expect((a0[1].y - a0[0].y) / (a0[1].x - a0[0].x)).toBeCloseTo(4 / 3, 9)
    expect(hyp[2].pts).toHaveLength(5)
    const named = constructionShapes(HYPERBOLA, '#f00', 'c')
    expect(named.map((s) => (s.kind === 'point' ? s.label : null))).toEqual(['F₁', 'F₂'])
    expect(constructionShapes(PARABOLA, '#f00', 'c').map((s) => (s.kind === 'point' ? s.label : null))).toEqual(['F'])
    // the whole construction, as a figure: center, vertices and co-vertices too
    expect(constructionShapes(HYPERBOLA, '#f00', 'c', true)).toHaveLength(7)
  })

  it('handles: center, the two semi-axes, a focus (a parabola: vertex and focus)', () => {
    expect(conicHandles(ELLIPSE).map((h) => h.which)).toEqual(['center', 'a', 'b', 'focus'])
    expect(conicHandles(CIRCLE).map((h) => h.which)).toEqual(['center', 'a'])
    expect(conicHandles(PARABOLA).map((h) => [h.which, h.pos])).toEqual([
      ['center', { x: 0, y: 0 }],
      ['focus', { x: 0, y: 2 }],
    ])
  })

  it('every drag keeps the conic valid and of its kind', () => {
    const cases: [ConicSpec, ConicHandleKind, { x: number; y: number }][] = [
      [ELLIPSE, 'center', { x: -1, y: 2.5 }],
      [ELLIPSE, 'a', { x: 6, y: 7 }],
      [ELLIPSE, 'b', { x: 0, y: 0.5 }],
      [ELLIPSE, 'focus', { x: 4, y: -1 }],
      [HYPERBOLA, 'a', { x: 2, y: 0 }],
      [HYPERBOLA, 'b', { x: 0, y: -1 }],
      [HYPERBOLA, 'focus', { x: 6, y: 0 }],
      [{ ...HYPERBOLA, opens: 'y' }, 'a', { x: 9, y: 2 }],
      [PARABOLA, 'focus', { x: 5, y: -3 }],
      [PARABOLA, 'center', { x: 1, y: 1 }],
      [CIRCLE, 'a', { x: 5, y: 1 }],
    ]
    for (const [spec, which, to] of cases) {
      const next = dragConicHandle(spec, which, to)
      expect(next, `${spec.kind} ${which}`).not.toBeNull()
      expect(conicProblems(next!)).toEqual([])
      const back = readConic(conicSource(next!))
      expect(back?.kind, `${spec.kind} ${which}`).toBe(spec.kind)
    }
  })

  it('a focus drag sets c and keeps a: b follows exactly', () => {
    // ellipse a = 3: focus at 2 + 2 → c = 2, b = √5
    const e = dragConicHandle(ELLIPSE, 'focus', { x: 4, y: -1 })!
    expect(e).toMatchObject({ a: '3', b: 'sqrt(5)' })
    expect(conicFeatures(e).foci.map((f) => f.x)).toEqual([0, 4])
    // hyperbola a = 3: focus at 6 → b² = 27
    const h = dragConicHandle(HYPERBOLA, 'focus', { x: 6, y: 0 })!
    expect(conicSource(h)).toBe('x^2/9 - y^2/27 = 1')
    // parabola: the focus sets p (and across the vertex it opens the other way)
    expect(conicSource(dragConicHandle(PARABOLA, 'focus', { x: 0, y: 3 })!)).toBe('x^2 = 12y')
    expect(conicSource(dragConicHandle(PARABOLA, 'focus', { x: 0, y: -1 })!)).toBe('x^2 = -4y')
  })

  it('a drag that makes no conic of this kind is refused', () => {
    expect(dragConicHandle(ELLIPSE, 'focus', { x: 5.5, y: -1 })).toBeNull() // beyond the vertex
    expect(dragConicHandle(ELLIPSE, 'focus', { x: 2, y: -1 })).toBeNull() // c = 0: a circle
    expect(dragConicHandle(ELLIPSE, 'b', { x: 2, y: 2 })).toBeNull() // b = a = 3: a circle
    expect(dragConicHandle(HYPERBOLA, 'focus', { x: 2, y: 0 })).toBeNull() // inside the vertex
    expect(dragConicHandle(HYPERBOLA, 'a', { x: 0, y: 5 })).toBeNull() // a = 0
    expect(dragConicHandle(PARABOLA, 'focus', { x: 3, y: 0 })).toBeNull() // p = 0
  })
})

// ---------------------------------------------------------------------------
// markup
// ---------------------------------------------------------------------------

describe('ConicEditor — markup', () => {
  const editor = (initial?: ConicDraft): string =>
    renderToStaticMarkup(createElement(ConicEditor, { onBuild: () => null, onClose: NOOP, initial }))

  it('opens on Circle with six tabs and a live preview of the standard form', () => {
    const html = editor()
    expect(html).toContain('data-testid="conic-editor"')
    for (const t of ['circle', 'ellipse', 'hyperbola', 'parabola', 'foci', 'equation']) {
      expect(html).toContain(`data-tab="${t}"`)
    }
    expect(html).toContain('data-testid="conic-tab-circle"')
    expect(html).toContain('data-src="x^2 + y^2 = 9"')
    expect(html).toContain('radius 3')
    expect(html).toContain('Add to graph')
  })

  it('Hyperbola: the asymptotes in exact text', () => {
    const html = editor({ ...blankConicDraft(), tab: 'hyperbola' })
    expect(html).toContain('data-src="x^2/9 - y^2/16 = 1"')
    expect(html).toContain('asymptotes y = ±(4/3)x')
    expect(html).toContain('data-testid="conic-kind"')
  })

  it('Equation: the sentence, the standard form, and a refusal in words', () => {
    const html = editor({ ...blankConicDraft(), tab: 'equation' })
    expect(html).toContain('data-testid="conic-class-sentence"')
    expect(html).toContain('an ellipse')
    expect(html).toContain('data-src="(x - 2)^2/4 + (y + 1)^2/9 = 1"')
    const rot = editor({ ...blankConicDraft(), tab: 'equation', equation: { text: 'x^2 + xy + y^2 = 3' } })
    expect(rot).toContain('rotated 45°')
    expect(rot).toContain('class="expr-error"')
    expect(rot).toMatch(/<button[^>]*disabled=""[^>]*>Add to graph/)
  })

  it('a bad point field is marked', () => {
    const html = editor({ ...blankConicDraft(), circle: { ...blankConicDraft().circle, center: '(2' } })
    expect(html).toContain('fe-input-bad')
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
    onConicRestate: () => null,
    onConicConstruction: NOOP,
    onConvertTyped: () => null,
  }
  return renderToStaticMarkup(
    createElement(CurveCard, props as unknown as Parameters<typeof CurveCard>[0]),
  )
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

describe('the Conic section on a card', () => {
  it('(x-2)^2/9 + (y+1)^2/4 = 1: an ellipse, its foci in exact text, already standard', () => {
    const html = typedCard('(x-2)^2/9 + (y+1)^2/4 = 1')
    expect(html).toContain('data-testid="conic-section"')
    expect(html).toContain('Conic · Ellipse')
    expect(html).toContain('foci (2 ± √5, −1)')
    expect(html).toContain('c² = 9 − 4 = 5, so c = √5')
    expect(html).toContain('data-testid="conic-construction"')
    expect(html).not.toContain('data-testid="conic-write-standard"')
  })

  it('hand-typed x^2 + y^2 - 4x + 6y - 3 = 0 is recognised: circle (2, −3), r = 4, write in standard form', () => {
    const html = typedCard('x^2 + y^2 - 4x + 6y - 3 = 0')
    expect(html).toContain('Conic · Circle')
    expect(html).toContain('center (2, −3)')
    expect(html).toContain('radius 4')
    expect(html).toContain('value="-3"')
    expect(html).toContain('data-testid="conic-write-standard"')
    expect(html).toContain('(x - 2)^2 + (y + 3)^2 = 16')
  })

  it('x^2 + xy + y^2 = 3: the rotated conic gets the classify sentence, read-only', () => {
    // typed with the product written out: the parser reads `xy` as one name
    const html = typedCard('x^2 + x*y + y^2 = 3')
    expect(html).toContain('data-testid="conic-class"')
    expect(html).toContain('B² − 4AC = −3 &lt; 0: an ellipse, rotated 45°.')
    expect(html).not.toContain('conic-write-standard')
  })

  it('a function y = x^2 has no Conic section', () => {
    expect(typedCard('y = x^2')).not.toContain('conic-section')
  })
})

describe('a sketched circle or ellipse', () => {
  const sketched = (modelId: string, params: number[]): FittedCurve => ({
    id: 's1',
    modelId,
    params,
    kind: 'implicit',
    color: '#f97',
    strokeWidth: 2.5,
    visible: true,
    error: 0.02,
  })

  it('a circle [a, b, r] is stated in standard form', () => {
    const f = fittedCircle([1.2, -0.5, 3.1])!
    expect(f.src).toBe('(x - 1.2)^2 + (y + 0.5)^2 = 9.61')
    expect(f.note).toBe('(x − 1.2)² + (y + 0.5)² = 9.61 · center (1.2, −0.5) · radius 3.1')
    const html = card(sketched('circle', [1.2, -0.5, 3.1]), MODELS)
    expect(html).toContain('data-testid="fitted-conic-note"')
    expect(html).toContain('data-testid="conic-convert"')
    expect(html).toContain('Convert to typed conic')
  })

  it('an axis-aligned ellipse [A … F] is completed to standard form', () => {
    // 9(x − 1)² + 4(y − 2)² = 36
    const f = fittedEllipse([9, 0, 4, -18, -16, -11])!
    expect(f.src).toBe('(x - 1)^2/4 + (y - 2)^2/9 = 1')
    expect(f.note).toContain('major axis 6, minor axis 4')
    const back = readConic(f.src)!
    expect(back).toMatchObject({ kind: 'ellipse', h: '1', k: '2', a: '2', b: '3' })
  })

  it('a tilted ellipse is written in general form, and says how far it is rotated', () => {
    const f = fittedEllipse([2, 2, 2, 0, 0, -6])!
    expect(f.src).toBe('x^2 + x*y + y^2 = 3')
    expect(f.note).toContain('rotated 45°')
    const html = card(sketched('ellipse', [2, 2, 2, 0, 0, -6]), MODELS)
    expect(html).toContain('data-testid="fitted-conic-note"')
  })

  it('nothing for a degenerate fit', () => {
    expect(fittedCircle([0, 0, 0])).toBeNull()
    expect(fittedEllipse([1, 0, 1, 0, 0, 1])).toBeNull() // no real points
  })
})

describe('zero intervals on the card', () => {
  it('y = floor(x): the Zeros row states 0 ≤ x < 1', () => {
    const html = typedCard('y = floor(x)')
    expect(html).toContain('data-testid="zero-interval"')
    expect(html).toContain('0 ≤ x &lt; 1')
  })
})

// ---------------------------------------------------------------------------
// rotated conics: read in x′, y′, drawn in x, y
// ---------------------------------------------------------------------------

describe('a rotated conic on the board and the card', () => {
  const S2 = Math.SQRT2
  const close = (p: { x: number; y: number }, x: number, y: number) =>
    Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9

  it('safeReadConic reads xy = 1 as its x′, y′ spec, marked rotated; no handles, no drags', () => {
    const spec = safeReadConic('xy = 1')
    expect(spec).toEqual({ kind: 'hyperbola', h: '0', k: '0', a: 'sqrt(2)', b: 'sqrt(2)', opens: 'x' })
    expect(rotationOf(spec!)?.thetaText).toBe('π/4')
    // the same line gives the same object (App's memos stay put)
    expect(safeReadConic('xy = 1')).toBe(spec)
    expect(conicHandles(spec!)).toEqual([])
    for (const which of ['center', 'a', 'b', 'focus'] as ConicHandleKind[]) {
      expect(dragConicHandle(spec!, which, { x: 3, y: 3 })).toBeNull()
    }
    // an axis-aligned spec of the same numbers is not rotated
    expect(rotationOf({ ...spec! })).toBeNull()
    expect(safeReadRotated('x^2/2 - y^2/2 = 1')).toBeNull()
    expect(writeStandard('xy = 1')).toBeNull()
  })

  it('xy = 1: marks and named foci at (±√2, ±√2), vertices (±1, ±1), in exact text', () => {
    const spec = safeReadConic('xy = 1')!
    const m = conicKeyMarks(spec)
    const at = (label: string) => m.filter((p) => p.label.startsWith(label))
    expect(at('vertex').map((p) => `(${p.exactX}, ${p.exactY})`)).toEqual(['(−1, −1)', '(1, 1)'])
    expect(at('focus').map((p) => `(${p.exactX}, ${p.exactY})`)).toEqual(['(−√2, −√2)', '(√2, √2)'])
    expect(close(at('focus')[1].pos, S2, S2)).toBe(true)
    const named = constructionShapes(spec, '#f00', 'c')
    expect(named.map((s) => (s.kind === 'point' ? s.label : null))).toEqual(['F₁', 'F₂'])
    expect(named.every((s) => s.kind === 'point' && Math.abs(Math.abs(s.at.x) - S2) < 1e-9 && Math.abs(s.at.y - s.at.x) < 1e-12)).toBe(true)
  })

  it('xy = 1: the asymptotes are the axes (one vertical), the box a diamond', () => {
    const lines = constructionPolylines(safeReadConic('xy = 1')!, '#f00', 'c')
    const asym = lines.filter((l) => l.id.includes('asymptote'))
    expect(asym).toHaveLength(2)
    const vertical = asym.find((l) => l.pts[0].x === l.pts[1].x)!
    const horizontal = asym.find((l) => l.pts[0].y === l.pts[1].y)!
    expect(vertical.pts[0].x).toBe(0)
    expect(horizontal.pts[0].y).toBe(0)
    const box = lines.find((l) => l.id.endsWith(':box'))!
    expect(box.pts).toHaveLength(5)
    for (const p of box.pts) expect(Math.abs(p.x) + Math.abs(p.y)).toBeCloseTo(2, 12)
    expect(constructionPoints(safeReadConic('xy = 1')!).length).toBeGreaterThan(4)
  })

  it('a rotated parabola: the directrix is drawn on x − y = −2', () => {
    const spec = safeReadConic('x^2 + 2xy + y^2 - 8x + 8y = 0')!
    expect(spec.kind).toBe('parabola')
    const d = constructionPolylines(spec, '#f00', 'c').find((l) => l.id.endsWith(':directrix'))!
    expect(d).toBeDefined()
    for (const p of d.pts) expect(Math.abs(p.x - p.y + 2)).toBeLessThan(1e-6 * Math.max(1, Math.abs(p.x)))
    expect(constructionShapes(spec, '#f00', 'c').map((s) => (s.kind === 'point' ? s.label : null))).toEqual(['F'])
    const f = conicKeyMarks(spec).find((p) => p.label === 'focus')!
    expect(`(${f.exactX}, ${f.exactY})`).toBe('(1, −1)')
  })

  it('conicSectionInfo and the Equation tab give the rotated reading', () => {
    const info = conicSectionInfo('5x^2 - 6xy + 5y^2 = 8', 'implicit')
    expect(info?.kind).toBe('rotated')
    if (info?.kind !== 'rotated') return
    expect(info.rot.primeText).toBe('x′²/4 + y′² = 1')
    expect(info.sentence).toBe('B² − 4AC = −64 < 0: an ellipse, rotated 45°.')
    const eq = conicSpecFromEquation({ text: 'x^2 + xy + y^2 = 3' })
    expect(eq.spec).toBeNull()
    expect(eq.error).toContain('In axes x′, y′ turned 45° it is x′²/2 + y′²/6 = 1.')
  })

  it('the card: θ and h′, k′, a, b read-only, the features in x, y, the construction toggle', () => {
    const html = typedCard('5x^2 - 6xy + 5y^2 = 8')
    expect(html).toContain('data-rotated="true"')
    expect(html).toContain('Conic · Ellipse, rotated 45°')
    expect(html).toContain('data-testid="conic-class"')
    expect(html).toContain('data-testid="conic-rotated-theta"')
    expect(html).toContain('value="π/4"')
    expect(html).toMatch(/data-testid="conic-rotated-a"[^>]*value="2"|value="2"[^>]*data-testid="conic-rotated-a"/)
    expect(html).toContain('rotated 45°: in axes x′, y′ this is x′²/4 + y′² = 1')
    expect(html).toContain('vertices (−√2, −√2) and (√2, √2)')
    expect(html).toContain('data-testid="conic-construction"')
    expect(html).not.toContain('conic-write-standard')
  })
})

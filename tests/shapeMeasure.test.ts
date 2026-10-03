// ============================================================================
// tests/shapeMeasure.test.ts — measurements on shapes, as the BOARD holds
// them: the linked line "parallel to AB through P" (parsed, resolved,
// following its points), the draw data each toggle produces, the toggles'
// persistence (written only when set — old documents byte-identical), reveal
// keys and masking, the student copy, the screen-reader description and the
// pgfplots export.
// ============================================================================

import { describe, expect, it } from 'vitest'
import { parseLinkedLine, parseShape } from '../src/core/parse/shapes'
import type { BoardInput, BoardShape, DocMeta } from '../src/core/persist'
import { cleanMeasure, deserializeDoc, docFromBoard, serializeDoc, shapeToStored, storedToShape } from '../src/core/persist'
import { compileShapes, looksLikeShape, readShape, sceneShapes, shapeCard } from '../src/ui/shapeLinks'
import { measureAnswerParts, measureToggles, setAllMeasure, setMeasureTo, toggleMeasure } from '../src/ui/shapeMeasure'
import { applyReveal, maskShapeMeasure, maskShapes, REVEAL_OFF, shapeAnswerSpots, shapeKey } from '../src/ui/reveal'
import type { SceneReveal } from '../src/ui/reveal'
import { docFigure, docModelFromJSON } from '../src/ui/docScene'
import { describeShapes } from '../src/core/describeAdapters'
import { describeBoard } from '../src/ui/boardDescription'
import { toPgfplots } from '../src/ui/pgfplotsExport'
import type { Shape } from '../src/core/types'

const META: DocMeta = { id: 'doc1', name: 'Measure', createdAt: 1000, modifiedAt: 1000 }

function shape(over: Partial<BoardShape> = {}): BoardShape {
  return { id: 'S1', src: 'ABCD = (0,0) (4,1) (5,4) (1,3)', params: [], color: '#4f9cf9', fill: false, visible: true, ...over }
}

function board(over: Partial<BoardInput> = {}): BoardInput {
  return {
    curves: [],
    styles: {},
    candidates: new Map(),
    exprSources: {},
    viewport: { center: { x: 2, y: 2 }, pxPerUnit: 50 },
    selectedId: null,
    mode: 'draw',
    ...over,
  }
}

const ALL_POLY = { show: ['lengths', 'slopes', 'angles', 'right', 'marks', 'midpoints', 'area', 'classify'] } as BoardShape['measure']

function built(list: BoardShape[], id: string): Shape {
  const c = compileShapes(list).get(id)
  if (!c?.shape) throw new Error(`no shape ${id}: ${c?.error}`)
  return c.shape
}

// ---------------------------------------------------------------------------

describe('linked lines: parallel to AB through P', () => {
  it('parses the forms a teacher writes', () => {
    for (const src of [
      'parallel to AB through P',
      'perpendicular to AB through P',
      'perp to BC through (1, 2)',
      'line through P parallel to AB',
      'line through (0, -1) perpendicular to segment AC',
      'Parallel to side AB through P',
    ]) {
      const o = parseShape(src)
      expect(o.ok, src).toBe(true)
      if (o.ok) {
        expect(o.kind).toBe('line')
        expect(o.link).toBeDefined()
      }
      expect(looksLikeShape(src), src).toBe(true)
    }
    const o = parseShape('line through (0, -1) perpendicular to segment AC')
    expect(o.ok && o.link).toEqual({ rel: 'perpendicular', to: ['A', 'C'], through: { x: 0, y: -1 } })
  })

  it('refuses a half-written one in words', () => {
    expect(parseLinkedLine('parallel to AB')).toMatchObject({ ok: false, error: expect.stringContaining('through') })
    expect(parseLinkedLine('parallel to A through P')).toMatchObject({ ok: false })
    expect(parseLinkedLine('parallel to AA through P')).toMatchObject({ ok: false, error: expect.stringContaining('twice') })
    expect(parseLinkedLine('parallel to AB through (a, 1)')).toMatchObject({ ok: false })
    expect(parseLinkedLine('y = 2x')).toBeNull()
  })

  it('resolves the names against the board and follows them', () => {
    const tri = shape({ id: 'T', src: 'ABC = (0,0) (4,0) (4,3)' })
    const P = shape({ id: 'P', src: 'P = (1, 3)' })
    const par = shape({ id: 'L1', src: 'parallel to AC through P' })
    const perp = shape({ id: 'L2', src: 'perpendicular to AB through P' })
    const list = [tri, P, par, perp]
    const l1 = built(list, 'L1')
    expect(l1.kind).toBe('line')
    if (l1.kind === 'line') {
      expect(l1.through).toEqual({ x: 1, y: 3 })
      expect(l1.dir.y / l1.dir.x).toBeCloseTo(3 / 4, 12)
    }
    const card = shapeCard(par, compileShapes(list)).measure!
    expect(card.reports.line?.line.slopeIntercept.text).toBe('y = (3/4)x + 9/4')
    expect(card.reports.line?.reason).toBe('ℓ ‖ AC: both have slope 3/4')
    const perpCard = shapeCard(perp, compileShapes(list)).measure!
    expect(perpCard.reports.line?.line.slopeIntercept.text).toBe('x = 1')
    // move C: the parallel line turns with AC
    const moved = [shape({ id: 'T', src: 'ABC = (0,0) (4,0) (2,4)' }), P, par]
    const l1b = built(moved, 'L1')
    if (l1b.kind === 'line') expect(l1b.dir.y / l1b.dir.x).toBeCloseTo(2, 12)
  })

  it('says which name is missing', () => {
    const c = compileShapes([shape({ id: 'L', src: 'parallel to AB through Q' })]).get('L')!
    expect(c.shape).toBeNull()
    expect(c.error).toMatch(/no point named A or B or Q/)
  })

  it('has no draggable vertices and a "Line" card', () => {
    const list = [shape({ id: 'P', src: 'P = (1, 3)' }), shape({ id: 'S', src: 'AB = (0,0) (2,1)' }), shape({ id: 'L', src: 'parallel to AB through P' })]
    const card = shapeCard(list[2], compileShapes(list))
    expect(card.noun).toBe('Line')
    expect(card.vertices).toEqual([])
  })
})

describe('what each toggle draws', () => {
  it('nothing at all until a toggle is on', () => {
    const s = built([shape()], 'S1')
    expect('measure' in s).toBe(false)
  })

  it('a parallelogram with every toggle', () => {
    const s = built([shape({ measure: ALL_POLY })], 'S1')
    expect(s.kind).toBe('polygon')
    const m = s.kind === 'polygon' ? s.measure! : null
    expect(m?.lengths).toEqual(['√17', '√10', '√17', '√10'])
    expect(m?.slopes).toEqual(['m = 1/4', 'm = 3', 'm = 1/4', 'm = 3'])
    expect(m?.angles).toEqual(['57.5°', '122.5°', '57.5°', '122.5°'])
    expect(m?.ticks).toEqual([1, 2, 1, 2])
    expect(m?.arcs).toEqual([1, 2, 1, 2])
    expect(m?.right).toBeUndefined()
    expect(m?.midpoints).toEqual(['(2, 1/2)', '(9/2, 5/2)', '(3, 7/2)', '(1/2, 3/2)'])
    expect(m?.summary?.map((l) => l.text)).toEqual([
      'P = 2√10 + 2√17 ≈ 14.57   A = 11',
      'ABCD: parallelogram',
      'AB ‖ DC (slope 1/4) and AD ‖ BC (slope 3)',
    ])
  })

  it('right-angle squares only where an angle is 90°; special triangles named', () => {
    const s = built([shape({ src: 'ABC = (0,0) (2sqrt(3),0) (2sqrt(3),2)', measure: ALL_POLY })], 'S1')
    const m = s.kind === 'polygon' ? s.measure! : null
    expect(m?.right).toEqual([false, true, false])
    expect(m?.summary?.[1].text).toBe('△ABC: right scalene triangle (30-60-90)')
  })

  it('a segment: length, slope, midpoint, equation', () => {
    const s = built([shape({ src: 'AB = (1,2) (4,6)', measure: { show: ['lengths', 'slopes', 'midpoints', 'equation'] } })], 'S1')
    expect(s.kind === 'segment' && s.measure).toEqual({
      lengths: ['5'],
      slopes: ['m = 4/3'],
      midpoints: ['(5/2, 4)'],
      equation: 'y = (4/3)x + 2/3',
    })
  })

  it('a point measured to another point (the point-pair tool)', () => {
    const list = [
      shape({ id: 'P', src: 'P = (1, 2)', measure: { show: ['lengths', 'slopes', 'midpoints'], to: 'Q' } }),
      shape({ id: 'Q', src: 'Q = (4, 6)' }),
    ]
    const p = built(list, 'P')
    expect(p.kind === 'point' && p.measure?.pair).toEqual({ to: { x: 4, y: 6 }, length: '5', slope: 'm = 4/3', midpoint: '(5/2, 4)' })
    const card = shapeCard(list[0], compileShapes(list)).measure!
    expect(card.choices.map((c) => c.ref)).toEqual(['Q'])
    expect(card.reports.pair?.endpointIfMid.text).toBe('(−2, −2)')
    expect(card.reports.pair?.endpointIfPartnerMid.text).toBe('(7, 10)')
  })

  it('a vertex of another shape can be the partner ("id#k")', () => {
    const list = [shape({ id: 'P', src: 'P = (0, 0)', measure: { to: 'T#2' } }), shape({ id: 'T', src: 'ABC = (0,0) (4,0) (4,3)' })]
    const card = shapeCard(list[0], compileShapes(list)).measure!
    expect(card.choices.map((c) => c.label)).toEqual(['A (0, 0)', 'B (4, 0)', 'C (4, 3)'])
    expect(card.reports.pair?.length.text).toBe('5')
  })

  it('recomputes from the vertices: a dragged vertex turns a parallelogram into a rectangle', () => {
    const before = shapeCard(shape({ measure: ALL_POLY }), compileShapes([shape({ measure: ALL_POLY })]))
    expect(before.measure?.reports.poly?.classification.name).toBe('parallelogram')
    const s2 = shape({ src: 'ABCD = (0,0) (8,2) (7,6) (-1,4)', measure: ALL_POLY })
    const after = shapeCard(s2, compileShapes([s2]))
    expect(after.measure?.reports.poly?.classification.name).toBe('rectangle')
    const drawn = built([s2], 'S1')
    expect(drawn.kind === 'polygon' && drawn.measure?.right).toEqual([true, true, true, true])
  })

  it('‖ / ⊥ against the rest of the board', () => {
    const list = [shape({ id: 'S', src: 'AB = (0,0) (2,1)' }), shape({ id: 'T', src: 'CDE = (0,3) (4,5) (5,3)' })]
    const card = shapeCard(list[0], compileShapes(list)).measure!
    expect(card.others.map((o) => o.text)).toContain('AB ‖ CD of △CDE (slope 1/2)')
    expect(card.others.map((o) => o.text).some((t) => t.startsWith('AB ⊥ DE of △CDE'))).toBe(true)
  })
})

describe('toggles', () => {
  it('the card offers the toggles that fit the kind', () => {
    expect(measureToggles('polygon', undefined).map((t) => t.flag)).toEqual([
      'lengths', 'slopes', 'angles', 'right', 'marks', 'midpoints', 'area', 'classify',
    ])
    expect(measureToggles('segment', undefined).map((t) => t.flag)).toEqual(['lengths', 'slopes', 'midpoints', 'equation'])
    expect(measureToggles('line', undefined).map((t) => t.flag)).toEqual(['slopes', 'equation'])
  })
  it('toggle on, toggle off — nothing left means undefined', () => {
    const a = toggleMeasure(undefined, 'angles')
    expect(a).toEqual({ show: ['angles'] })
    const b = toggleMeasure(a, 'lengths')
    expect(b).toEqual({ show: ['lengths', 'angles'] })
    expect(toggleMeasure(toggleMeasure(b, 'angles'), 'lengths')).toBeUndefined()
    expect(setAllMeasure('segment', undefined, true)).toEqual({ show: ['lengths', 'slopes', 'midpoints', 'equation'] })
    expect(setAllMeasure('segment', { show: ['lengths'] }, false)).toBeUndefined()
    expect(setMeasureTo(undefined, 'Q')).toEqual({ show: ['lengths', 'slopes', 'midpoints'], to: 'Q' })
    expect(setMeasureTo({ show: ['lengths'], to: 'Q' }, null)).toEqual({ show: ['lengths'] })
  })
})

describe('persistence', () => {
  it('writes the toggles only when one is on', () => {
    expect('measure' in shapeToStored(shape())).toBe(false)
    expect('measure' in shapeToStored(shape({ measure: { show: [] } }))).toBe(false)
    expect(shapeToStored(shape({ measure: { show: ['classify', 'lengths'] } })).measure).toEqual({ show: ['lengths', 'classify'] })
  })

  it('a document that never measured anything is byte-identical', () => {
    const plain = board({ shapes: [shape()] })
    const a = serializeDoc(docFromBoard(META, plain, 2000))
    const b = serializeDoc(docFromBoard(META, board({ shapes: [{ ...shape(), measure: undefined }] }), 2000))
    expect(b).toBe(a)
    expect(a).not.toContain('measure')
    // measured, then un-measured: the same bytes again
    const off = toggleMeasure(toggleMeasure(undefined, 'lengths'), 'lengths')
    const c = serializeDoc(docFromBoard(META, board({ shapes: [{ ...shape(), ...(off ? { measure: off } : {}) }] }), 2000))
    expect(c).toBe(a)
  })

  it('round-trips the toggles and a point partner; drops junk', () => {
    const list = [shape({ measure: { show: ['angles', 'lengths'] } }), shape({ id: 'P', src: 'P = (1, 1)', measure: { show: ['lengths'], to: 'S1#2' } })]
    const back = deserializeDoc(serializeDoc(docFromBoard(META, board({ shapes: list }), 2000)))
    expect(back.board?.shapes[0].measure).toEqual({ show: ['lengths', 'angles'] })
    expect(back.board?.shapes[1].measure).toEqual({ show: ['lengths'], to: 'S1#2' })
    expect(cleanMeasure({ show: ['nonsense', 'area'], to: 7 })).toEqual({ show: ['area'] })
    expect(cleanMeasure({ show: 'lengths' })).toBeUndefined()
    const got = storedToShape({ id: 'X', src: 'P = (1, 1)', color: '#fff', measure: { show: [] } })
    expect('shape' in got && 'measure' in got.shape).toBe(false)
  })

  it('a linked line survives a save and a load', () => {
    const list = [shape({ id: 'P', src: 'P = (1, 3)' }), shape({ id: 'S', src: 'AB = (0,0) (2,1)' }), shape({ id: 'L', src: 'perpendicular to AB through P', measure: { show: ['equation'] } })]
    const back = deserializeDoc(serializeDoc(docFromBoard(META, board({ shapes: list }), 2000)))
    expect(back.degraded).toBe(false)
    const l = built(back.board!.shapes, 'L')
    expect(l.kind === 'line' && l.measure?.equation).toBe('y = −2x + 5')
  })
})

describe('reveal mode', () => {
  it('keys, in teaching order, for the toggles that are on', () => {
    const s = shape({ src: 'ABC = (0,0) (4,0) (4,3)', measure: ALL_POLY })
    const c = compileShapes([s]).get('S1')!
    expect(measureAnswerParts('polygon', s.measure, c.reports)).toEqual([
      'lengths', 'slopes', 'midpoints', 'angles', 'marks', 'trig', 'area', 'class',
    ])
    expect(measureAnswerParts('polygon', { show: ['lengths'] }, c.reports)).toEqual(['lengths'])
    expect(measureAnswerParts('point', { show: ['lengths'] }, {})).toEqual([])
    expect(shapeKey('S1', 'trig')).toBe('shape:S1:trig')
  })

  it('masks every hidden answer with "?" and drops the congruence marks; right-angle squares stay', () => {
    const s = built([shape({ src: 'ABC = (0,0) (4,0) (4,3)', measure: ALL_POLY })], 'S1')
    const m = s.kind === 'polygon' ? s.measure! : null
    const masked = maskShapeMeasure(m!, () => true)
    expect(masked.lengths).toEqual(['?', '?', '?'])
    expect(masked.slopes).toEqual(['m = ?', 'm = ?', 'm = ?'])
    expect(masked.angles).toEqual(['?', '?', '?'])
    expect(masked.midpoints).toEqual(['(?, ?)', '(?, ?)', '(?, ?)'])
    expect(masked.ticks).toBeUndefined()
    expect(masked.right).toEqual([false, true, false])
    expect(masked.summary).toEqual([
      { part: 'area', text: 'P = ?   A = ?' },
      { part: 'class', text: '△ABC: ?' },
    ])
    // one part revealed, the rest still hidden
    const some = maskShapeMeasure(m!, (p) => p !== 'lengths')
    expect(some.lengths).toEqual(['4', '3', '5'])
    expect(some.angles).toEqual(['?', '?', '?'])
  })

  it('applyReveal masks the scene and puts a clickable spot for each hidden part', () => {
    const shapes = sceneShapes([shape({ measure: { show: ['lengths', 'area'] } })], compileShapes([shape({ measure: { show: ['lengths', 'area'] } })]))
    const hidden = new Set(['shape:S1:lengths', 'shape:S1:area'])
    const r: SceneReveal = {
      hidden: (k) => hidden.has(k),
      positions: true,
      pointKey: () => null,
      crossKey: (a, b) => `cross:${a}:${b}`,
    }
    const scene = applyReveal({ shapes, curves: [] } as never, r)
    const out = scene.shapes![0]
    expect(out.kind === 'polygon' && out.measure?.lengths).toEqual(['?', '?', '?', '?'])
    expect(scene.revealMarks?.map((m) => m.key).sort()).toEqual(['shape:S1:area', 'shape:S1:lengths'])
    expect(scene.revealMarks?.every((m) => m.ghost)).toBe(true)
    expect(shapeAnswerSpots(shapes[0]).map((s) => s.part)).toEqual(['lengths', 'area'])
    expect(REVEAL_OFF.on).toBe(false)
  })

  it('maskShapes leaves vectors and unmeasured shapes alone', () => {
    const v = built([shape({ src: 'v = <3, 4>' })], 'S1')
    const plain = built([shape()], 'S1')
    expect(maskShapes([v, plain], () => true)).toEqual([v, plain])
  })
})

describe('student copies, descriptions and exports', () => {
  const doc = (shapes: BoardShape[]) => docModelFromJSON(serializeDoc(docFromBoard(META, board({ shapes }), 2000)), { screen: { widthPx: 800, heightPx: 600 } })!

  it('the student copy asks for every measurement; the key states it', () => {
    const m = doc([shape({ measure: ALL_POLY })])
    const student = docFigure(m, { style: 'textbook', answers: false })
    const key = docFigure(m, { style: 'textbook', answers: true })
    const s = student.scene.shapes![0]
    const k = key.scene.shapes![0]
    expect(s.kind === 'polygon' && s.measure?.lengths).toEqual(['?', '?', '?', '?'])
    expect(k.kind === 'polygon' && k.measure?.lengths).toEqual(['√17', '√10', '√17', '√10'])
  })

  it('describes the figure, and the measurements only as answers', () => {
    const shapes = sceneShapes([shape({ measure: ALL_POLY })], compileShapes([shape({ measure: ALL_POLY })]))
    const d = describeShapes(shapes)
    expect(d[0]).toEqual({ text: 'Quadrilateral ABCD has vertices A(0, 0), B(4, 1), C(5, 4) and D(1, 3).' })
    expect(d.filter((x) => x.answer).map((x) => x.text)).toContain('The perimeter is 2√10 + 2√17 ≈ 14.57 and the area is 11.')
    expect(d.some((x) => x.text.startsWith('AB ‖ DC (slope 1/4) and AD ‖ BC (slope 3), so ABCD is a parallelogram.'))).toBe(true)
    const m = doc([shape({ measure: ALL_POLY })])
    expect(describeBoard(m, { answers: true }).long).toContain('parallelogram')
    const student = describeBoard(m, { answers: false }).long
    expect(student).toContain('Quadrilateral ABCD has vertices')
    expect(student).not.toContain('parallelogram')
    expect(student).not.toContain('√17')
  })

  it('pgfplots draws a linked line and states the measurement chips', () => {
    const list = [
      shape({ id: 'P', src: 'P = (1, 3)' }),
      shape({ id: 'T', src: 'ABC = (0,0) (4,0) (4,3)', measure: { show: ['lengths', 'angles', 'right', 'classify'] } }),
      shape({ id: 'L', src: 'parallel to AC through P', measure: { show: ['equation'] } }),
    ]
    const m = doc(list)
    const tex = toPgfplots(docFigure(m, { style: 'textbook', answers: true }).scene)
    expect(tex).toMatch(/36\.9/)
    expect(tex).toMatch(/right scalene triangle/)
    expect(tex).toContain('(3/4)x + 9/4')
    expect(tex).toContain('$\\triangle$ABC')
    expect(tex).not.toContain('U+')
  })
})

describe('the shared equation box', () => {
  it('readShape accepts linked lines; curves still go to the expression parser', () => {
    expect(readShape('parallel to AB through P').ok).toBe(true)
    expect(readShape('y = x').ok).toBe(false)
    expect(looksLikeShape('perpendicular bisector')).toBe(true)
    expect(readShape('perpendicular bisector').ok).toBe(false)
  })
})

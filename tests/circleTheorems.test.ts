// ============================================================================
// tests/circleTheorems.test.ts — triangle centres and circle theorems on the
// board: the overlays, persistence (written only when set — old documents
// byte-identical), reveal mode, the description, the examples and commands.
// The pure maths is in tests/triangleCentres.test.ts and
// tests/circleGeometry.test.ts.
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { DARK_THEME } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { parseExpression } from '../src/core/parse'
import type { BoardInput, BoardShape, DocMeta, StoredDoc } from '../src/core/persist'
import { cleanMeasure, deserializeDoc, docFromBoard, normalizeCircleView, serializeDoc } from '../src/core/persist'
import { compileShapes } from '../src/ui/shapeLinks'
import { centreOverlays, toggleCentre } from '../src/ui/centreLinks'
import { circleKeysOf, circleOf, circleOverlays, circlePanel, toggleCircleFlag, setCirclePoint } from '../src/ui/circleLinks'
import { measureAnswerParts, setAllMeasure, toggleMeasure } from '../src/ui/shapeMeasure'
import { patchCircleView, pruneViewStates, emptyViewStates, viewStatesFrom } from '../src/ui/curveViews'
import { REVEAL_OFF, applyReveal, buildInventory, circleKey, isHidden, revealOne, shapeKey } from '../src/ui/reveal'
import type { RevealState, SceneReveal } from '../src/ui/reveal'
import type { BoardScene } from '../src/ui/renderBoard'
import type { Overlay } from '../src/render/overlays'
import { docFigure, docModelFromJSON } from '../src/ui/docScene'
import { describeBoard } from '../src/ui/boardDescription'
import { toPgfplots } from '../src/ui/pgfplotsExport'
import { COMMANDS, HELP_SECTIONS } from '../src/ui/commands'
import { buildExample, exampleById } from '../src/examples'

const META: DocMeta = { id: 'D1', name: 'Centres', createdAt: 1000, modifiedAt: 1000 }
const models: Record<string, ModelSpec> = { ...MODELS }
let n = 0

function typed(id: string, src: string): FittedCurve {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(src)
  const modelId = `expr_c${++n}`
  models[modelId] = o.plot.makeModel(modelId)
  return { id, modelId, params: o.plot.defaultParams.slice(), kind: o.plot.kind, domain: o.plot.domain, color: '#4f9cf9', strokeWidth: 2.5, visible: true, error: 0 }
}

function board(over: Partial<BoardInput> = {}): BoardInput {
  return {
    curves: [],
    styles: {},
    candidates: new Map(),
    exprSources: {},
    viewport: { center: { x: 0, y: 0 }, pxPerUnit: 40 },
    selectedId: null,
    mode: 'draw',
    ...over,
  }
}
const save = (b: BoardInput): string => serializeDoc(docFromBoard(META, b, 2000))

const tri = (over: Partial<BoardShape> = {}): BoardShape => ({
  id: 'T',
  src: 'ABC = (-2,0) (6,0) (0,2)',
  params: [],
  color: '#4f9cf9',
  fill: false,
  visible: true,
  ...over,
})
const ALL = ['centroid', 'circumcentre', 'incentre', 'orthocentre', 'euler'] as const

const labels = (ovs: readonly Overlay[]) =>
  ovs.filter((o): o is Extract<Overlay, { kind: 'label' }> => o.kind === 'label')

// ---------------------------------------------------------------------------
// Triangle centres
// ---------------------------------------------------------------------------

describe('triangle centres on the board', () => {
  it('compiles the centres of every triangle; the flags say what is drawn', () => {
    const shapes = [tri({ measure: { centres: [...ALL] } })]
    const c = compileShapes(shapes).get('T')!
    expect(c.centres!.circumcentre.pt.text).toBe('(2, −2)')
    expect(c.centres!.orthocentre.pt.text).toBe('(0, 6)')
    expect(c.centres!.centroid.pt.text).toBe('(4/3, 2/3)')
    expect(c.centres!.circumradius.text).toBe('2√5')
    expect(c.shape!.kind === 'polygon' && c.shape!.centres).toEqual([...ALL])
    // a plain triangle has its centres computed but draws none
    const plain = compileShapes([tri()]).get('T')!
    expect(plain.centres).not.toBeNull()
    expect(plain.shape!.kind === 'polygon' && plain.shape!.centres).toBeUndefined()
    expect(centreOverlays([tri()], compileShapes([tri()]))).toEqual([])
  })

  it('draws each centre with its lines and an answer chip; the Euler line through O, G, H', () => {
    const shapes = [tri({ measure: { centres: [...ALL] } })]
    const ovs = centreOverlays(shapes, compileShapes(shapes))
    const chips = labels(ovs)
    expect(chips.find((l) => l.answer === shapeKey('T', 'centroid'))!.text).toBe('G (4/3, 2/3)')
    expect(chips.filter((l) => l.answer === shapeKey('T', 'circumcentre')).map((l) => l.text)).toEqual(['O (2, −2)', 'R = 2√5 ≈ 4.47'])
    expect(chips.find((l) => l.answer === shapeKey('T', 'orthocentre'))!.text).toBe('H (0, 6)')
    expect(chips.find((l) => l.answer === shapeKey('T', 'incentre'))!.text).toBe('I ≈ (0.25, 0.93)')
    expect(chips.find((l) => l.answer === shapeKey('T', 'euler'))!.text).toBe('Euler line · HG = 2·GO')
    const line = ovs.find((o) => o.kind === 'line')!
    expect(line.kind === 'line' && line.slope).toBeCloseTo(-4, 12)
    // medians (3), bisectors (3), angle bisectors (3), altitudes with the
    // obtuse extensions, radii: all segments
    expect(ovs.filter((o) => o.kind === 'segment').length).toBeGreaterThanOrEqual(12)
    // the circumcircle and the incircle
    expect(ovs.filter((o) => o.kind === 'path' && o.closed).length).toBe(2)
  })

  it('an isosceles triangle’s Euler line is its vertical axis', () => {
    const shapes = [tri({ src: 'DEF = (-3,0) (3,0) (0,4)', measure: { centres: ['euler'] } })]
    const line = centreOverlays(shapes, compileShapes(shapes)).find((o) => o.kind === 'line')!
    expect(line.kind === 'line' && line.slope).toBe(Infinity)
    expect(line.kind === 'line' && line.at.x).toBeCloseTo(0, 12)
  })

  it('an equilateral triangle says the centres coincide', () => {
    const shapes = [tri({ src: 'ABC = (0,0) (2,0) (1,sqrt(3))', measure: { centres: ['euler'] } })]
    const chips = labels(centreOverlays(shapes, compileShapes(shapes)))
    expect(chips.map((l) => l.text)).toContain('G = O = I = H')
  })

  it('dragging a vertex moves every centre (recomputed from the vertices)', () => {
    const a = compileShapes([tri({ measure: { centres: ['circumcentre'] } })]).get('T')!.centres!
    const b = compileShapes([tri({ src: 'ABC = (-2,0) (6,0) (0,6)', measure: { centres: ['circumcentre'] } })]).get('T')!.centres!
    expect(a.circumcentre.where).toBe('outside')
    expect(b.circumcentre.where).toBe('inside')
    expect(b.circumcentre.pt.text).toBe('(2, 2)')
  })

  it('toggles keep the measurements, and the measurements keep the centres', () => {
    const m = toggleCentre(undefined, 'centroid')
    expect(m).toEqual({ centres: ['centroid'] })
    expect(toggleCentre(m, 'centroid')).toBeUndefined()
    const both = toggleMeasure(toggleCentre({ show: ['lengths'] }, 'euler'), 'angles')
    expect(both).toEqual({ show: ['lengths', 'angles'], centres: ['euler'] })
    expect(setAllMeasure('polygon', both, false)).toEqual({ centres: ['euler'] })
    expect(toggleCentre(undefined, 'all')!.centres).toEqual([...ALL])
    expect(toggleCentre({ show: ['area'], centres: ['euler'] }, 'none')).toEqual({ show: ['area'] })
  })
})

describe('triangle centres: persistence', () => {
  it('writes the centres only when one is on; old documents are byte-identical', () => {
    const before = save(board({ shapes: [tri()] }))
    expect(before).not.toContain('centres')
    const on = toggleCentre(undefined, 'orthocentre')
    const withOn = save(board({ shapes: [tri({ measure: on })] }))
    expect(JSON.parse(withOn).board.shapes[0].measure).toEqual({ centres: ['orthocentre'] })
    const off = toggleCentre(on, 'orthocentre')
    expect(save(board({ shapes: [tri(off ? { measure: off } : {})] }))).toBe(before)
  })
  it('round-trips in canonical order and drops junk', () => {
    const back = deserializeDoc(save(board({ shapes: [tri({ measure: { centres: ['euler', 'centroid'], show: ['area'] } })] })))
    expect(back.problems).toEqual([])
    expect(back.board!.shapes[0].measure).toEqual({ show: ['area'], centres: ['centroid', 'euler'] })
    expect(cleanMeasure({ centres: ['nonsense', 'incentre', 'incentre'] })).toEqual({ centres: ['incentre'] })
    expect(cleanMeasure({ centres: 'euler' })).toBeUndefined()
  })
})

describe('triangle centres: reveal, words, exports', () => {
  const shapes = [tri({ measure: { centres: [...ALL] } })]
  it('each centre is an answer, in card order', () => {
    expect(measureAnswerParts('polygon', { centres: [...ALL] }, undefined)).toEqual([...ALL])
    expect(measureAnswerParts('polygon', { show: ['area'], centres: ['euler'] }, undefined)).toEqual(['area', 'euler'])
  })
  it('the chips are "?" until revealed', () => {
    const scene: BoardScene = {
      vp: { center: { x: 2, y: 0 }, pxPerUnit: 30, widthPx: 900, heightPx: 600 },
      theme: DARK_THEME,
      curves: [],
      styles: {},
      models,
      analysis: null,
      overlays: centreOverlays(shapes, compileShapes(shapes)),
    }
    const keys = ALL.map((f) => shapeKey('T', f))
    const inv = buildInventory({ curves: [], crossings: [], after: keys })
    const r = (s: RevealState): SceneReveal => ({ hidden: (k) => isHidden(s, k), positions: true, pointKey: inv.answerKey, crossKey: inv.crossKey })
    const ON: RevealState = { ...REVEAL_OFF, on: true }
    const hidden = applyReveal(scene, r(ON))
    expect(labels(hidden.overlays!).filter((l) => l.answer).length).toBe(0)
    expect([...new Set(hidden.revealMarks!.map((m) => m.key))].sort()).toEqual([...keys].sort())
    const shown = applyReveal(scene, r(revealOne(ON, shapeKey('T', 'orthocentre'))))
    expect(labels(shown.overlays!).map((l) => l.text)).toContain('H (0, 6)')
    expect(labels(shown.overlays!).map((l) => l.text)).not.toContain('G (4/3, 2/3)')
  })
  it('describes what is drawn always, and where the centres are only as answers', () => {
    const m = docModelFromJSON(save(board({ shapes })), { screen: { widthPx: 800, heightPx: 600 } })!
    const key = describeBoard(m, { answers: true }).long
    expect(key).toContain('The medians and the centroid G')
    expect(key).toContain('the circumcentre O is at (2, −2), outside the triangle with circumradius 2√5 ≈ 4.47')
    expect(key).toContain('Euler line y = −4x + 6')
    const student = describeBoard(m, { answers: false }).long
    expect(student).toContain('The medians and the centroid G')
    expect(student).not.toContain('(2, −2)')
  })
  it('the figure carries the construction; a student copy keeps the lines and asks for the points', () => {
    const m = docModelFromJSON(save(board({ shapes })), { screen: { widthPx: 800, heightPx: 600 } })!
    const key = docFigure(m, { style: 'sat', answers: true })
    expect(labels(key.scene.overlays!).map((l) => l.text)).toContain('H (0, 6)')
    const student = docFigure(m, { style: 'sat', answers: false })
    expect(labels(student.scene.overlays!).some((l) => l.answer)).toBe(false)
    expect(student.scene.overlays!.some((o) => o.kind === 'line')).toBe(true)
    const pgf = toPgfplots(key.scene, { sources: key.sources })
    expect(pgf).toContain('$H\\ (0, 6)$')
    expect(pgf).toContain('$R = 2\\sqrt{5} \\approx 4.47$')
  })
})

// ---------------------------------------------------------------------------
// Circle theorems
// ---------------------------------------------------------------------------

const C36 = typed('C', 'x^2 + y^2 = 36')
const SRC = { C: 'x^2 + y^2 = 36' }

describe('circle theorems on the board', () => {
  it('reads the circle from a typed line (standard or general form) or a sketch', () => {
    expect(circleOf(C36, SRC.C)!.equation).toBe('x² + y² = 36')
    const g = typed('G', 'x^2 + y^2 - 4x + 6y - 3 = 0')
    expect(circleOf(g, 'x^2 + y^2 - 4x + 6y - 3 = 0')!.equation).toBe('(x − 2)² + (y + 3)² = 16')
    const sketch: FittedCurve = { ...C36, id: 'S', modelId: 'circle', params: [1, 2, 3], kind: 'implicit' }
    expect(circleOf(sketch, undefined)!.centreText.text).toBe('(1, 2)')
    expect(circleOf(typed('E', 'x^2/9 + y^2/4 = 1'), 'x^2/9 + y^2/4 = 1')).toBeNull()
    expect(circleOf(typed('L', 'y = 2x'), 'y = 2x')).toBeNull()
  })

  it('switching a figure on adds the points it needs (P 30°, Q 150°, R 270°, S 90°)', () => {
    const c = circleOf(C36, SRC.C)
    const v1 = toggleCircleFlag(undefined, 'angles', c)
    expect(v1).toEqual({ show: ['angles'], pts: ['30°', '150°', '270°'] })
    const v2 = toggleCircleFlag(v1, 'chords', c)
    expect(v2.pts).toEqual(['30°', '150°', '270°', '90°'])
    expect(toggleCircleFlag(v2, 'angles', c).show).toEqual(['chords'])
    expect(toggleCircleFlag(undefined, 'external', c).ext).toBe('(12, 0)')
    expect(setCirclePoint({ pts: ['1', '2'], at: 1 }, 1, null)).toEqual({ pts: ['1'] })
  })

  it('the panel: inscribed = ½ central, the tangent ⟂ the radius, s = 4π and A = 12π', () => {
    const p = circlePanel(C36, SRC.C, { pts: ['30°', '150°', '270°'], show: ['angles', 'tangent', 'sector'] })!
    expect(p.angles && 'relation' in p.angles && p.angles.relation).toBe('∠PRQ = ½·∠POQ: 60° = ½ · 120°')
    expect(p.tangent && 'line' in p.tangent && p.tangent.line.slopeIntercept.text).toBe('y = −√3x + 12')
    expect(p.sector && 'arc' in p.sector && p.sector.arc.text).toBe('4π')
    expect(p.sector && 'area' in p.sector && p.sector.area.text).toBe('12π')
    const bad = circlePanel(C36, SRC.C, { pts: ['30°'], show: ['angles'] })!
    expect(bad.angles && 'error' in bad.angles && bad.angles.error).toContain('needs 3 points')
  })

  it('draws the figures with every value an answer chip', () => {
    const ovs = circleOverlays([C36], SRC, { C: { pts: ['30°', '150°', '270°', '90°'], show: ['angles', 'tangent', 'sector', 'chords'] } })
    const chips = labels(ovs)
    const ans = (part: Parameters<typeof circleKey>[1]) => chips.filter((l) => l.answer === circleKey('C', part)).map((l) => l.text)
    expect(ans('angles')).toEqual(['∠POQ = 120°', '∠PRQ = 60°'])
    expect(ans('tangent')).toEqual(['y = −√3x + 12'])
    expect(ans('sector')).toEqual(['s = 4π', 'A = 12π'])
    expect(ans('chords')[0]).toMatch(/^PE·EQ = RE·ES = /)
    // the givens are named, not answers
    expect(chips.filter((l) => !l.answer).map((l) => l.text)).toEqual(expect.arrayContaining(['O', 'P', 'Q', 'R', 'S', 'E', 'θ = 2π/3']))
    // the sector is shaded under the curves
    expect(ovs.some((o) => o.kind === 'path' && o.closed && o.under === true)).toBe(true)
    // a hidden circle draws nothing
    expect(circleOverlays([{ ...C36, visible: false }], SRC, { C: { pts: ['30°'], show: ['tangent'] } })).toEqual([])
  })

  it('a vertical tangent is a vertical line', () => {
    const ovs = circleOverlays([C36], SRC, { C: { pts: ['0'], show: ['tangent'] } })
    const line = ovs.find((o) => o.kind === 'line')!
    expect(line.kind === 'line' && Math.abs(line.slope)).toBe(Infinity)
    expect(labels(ovs).find((l) => l.answer)!.text).toBe('x = 6')
  })
})

describe('circle theorems: persistence', () => {
  it('writes the section only when set; an untouched circle is byte-identical', () => {
    const before = save(board({ curves: [C36], exprSources: SRC }))
    expect(before).not.toContain('circle"')
    expect(save(board({ curves: [C36], exprSources: SRC, curveViews: { C: { circle: {} } } }))).toBe(before)
    const v = toggleCircleFlag(undefined, 'sector', null)
    const on = save(board({ curves: [C36], exprSources: SRC, curveViews: { C: { circle: v } } }))
    expect((JSON.parse(on) as StoredDoc).board.curveViews!.C).toEqual({ circle: { pts: ['30°', '150°'], show: ['sector'] } })
    const off = toggleCircleFlag(v, 'sector', null)
    // the points stay (what the teacher typed); with them removed, the bytes are the old ones
    const cleared = setCirclePoint(setCirclePoint(off, 1, null), 0, null)
    expect(save(board({ curves: [C36], exprSources: SRC, curveViews: { C: { circle: cleared } } }))).toBe(before)
  })
  it('round-trips and drops junk', () => {
    const view = { pts: ['30°', '(3, 4)', 'pi/2'], show: ['external' as const, 'angles' as const], at: 2, ext: '(9, 1)' }
    const res = deserializeDoc(save(board({ curves: [C36], exprSources: SRC, curveViews: { C: { circle: view } } })))
    expect(res.problems).toEqual([])
    expect(res.board!.curveViews.C.circle).toEqual({ ...view, show: ['angles', 'external'] })
    expect(viewStatesFrom(res.board!.curveViews, res.board!.curves).circle.C.ext).toBe('(9, 1)')
    expect(normalizeCircleView({ pts: [3, 'x'], show: ['nope'], at: -1, ext: '' })).toEqual({ pts: ['x'] })
    expect(normalizeCircleView({ at: 0 })).toBeNull()
  })
  it('patching is idempotent and a deleted curve forgets its section', () => {
    const m0 = patchCircleView({}, 'C', { show: ['tangent'], pts: ['0'] })
    expect(m0).toEqual({ C: { pts: ['0'], show: ['tangent'] } })
    expect(patchCircleView(m0, 'C', { show: ['tangent'], pts: ['0'] })).toBe(m0)
    const s = { ...emptyViewStates(), circle: m0 }
    expect(pruneViewStates(s, new Set(['other'])).circle).toEqual({})
  })
})

describe('circle theorems: reveal, words, exports', () => {
  const view = { pts: ['30°', '150°', '270°'], show: ['angles' as const, 'sector' as const] }
  it('the section’s answers are in the reveal order, with a general-form circle’s completed square first', () => {
    expect(circleKeysOf(C36, SRC.C, view)).toEqual([circleKey('C', 'angles'), circleKey('C', 'sector')])
    const g = typed('G', 'x^2 + y^2 - 4x + 6y - 3 = 0')
    expect(circleKeysOf(g, 'x^2 + y^2 - 4x + 6y - 3 = 0', undefined)).toEqual([circleKey('G', 'square')])
    expect(circleKeysOf(C36, SRC.C, undefined)).toEqual([])
    const inv = buildInventory({ curves: [{ id: 'C', points: [], extra: circleKeysOf(C36, SRC.C, view) }], crossings: [] })
    expect(inv.order).toEqual(['circle:C:angles', 'circle:C:sector'])
  })
  it('the angle and sector chips are "?" until revealed', () => {
    const scene: BoardScene = {
      vp: { center: { x: 0, y: 0 }, pxPerUnit: 30, widthPx: 900, heightPx: 600 },
      theme: DARK_THEME,
      curves: [C36],
      styles: {},
      models,
      analysis: null,
      overlays: circleOverlays([C36], SRC, { C: view }),
    }
    const inv = buildInventory({ curves: [], crossings: [], after: circleKeysOf(C36, SRC.C, view) })
    const r = (s: RevealState): SceneReveal => ({ hidden: (k) => isHidden(s, k), positions: true, pointKey: inv.answerKey, crossKey: inv.crossKey })
    const ON: RevealState = { ...REVEAL_OFF, on: true }
    const hidden = applyReveal(scene, r(ON))
    expect(labels(hidden.overlays!).some((l) => /60°|4π|12π/.test(l.text))).toBe(false)
    const shown = applyReveal(scene, r(revealOne(ON, circleKey('C', 'sector'))))
    expect(labels(shown.overlays!).map((l) => l.text)).toEqual(expect.arrayContaining(['s = 4π', 'A = 12π']))
    expect(labels(shown.overlays!).map((l) => l.text)).not.toContain('∠PRQ = 60°')
  })
  it('describes the figures always and their values only as answers', () => {
    const m = docModelFromJSON(save(board({ curves: [C36], exprSources: SRC, curveViews: { C: { circle: view } } })))!
    const key = describeBoard(m, { answers: true }).long
    expect(key).toContain('On the circle x² + y² = 36 (centre O(0, 0), radius 6) the points P(3√3, 3), Q(−3√3, 3), R(0, −6) are marked.')
    expect(key).toContain('the central angle is 120° and the inscribed angle is 60°')
    expect(key).toContain('The arc length is 4π and the sector area is 12π.')
    const student = describeBoard(m, { answers: false }).long
    expect(student).toContain('is shaded and its arc highlighted')
    expect(student).not.toContain('12π')
  })
  it('the worksheet figure draws it; the student copy asks', () => {
    const m = docModelFromJSON(save(board({ curves: [C36], exprSources: SRC, curveViews: { C: { circle: view } } })))!
    const key = docFigure(m, { style: 'textbook', answers: true })
    expect(labels(key.scene.overlays!).map((l) => l.text)).toContain('A = 12π')
    const student = docFigure(m, { style: 'textbook', answers: false })
    expect(labels(student.scene.overlays!).map((l) => l.text)).not.toContain('A = 12π')
    expect(labels(student.scene.overlays!).map((l) => l.text)).toContain('P')
  })
})

// ---------------------------------------------------------------------------
// Examples, commands, help
// ---------------------------------------------------------------------------

describe('examples', () => {
  const load = (id: string) => {
    const def = exampleById(id)!
    const built = buildExample(def)
    const res = deserializeDoc(built.json)
    expect(res.problems, id).toEqual([])
    return res.board!
  }
  it('the obtuse triangle: O (2, −2) and H (0, 6) outside, G (4/3, 2/3), Euler y = −4x + 6, OA = 2√5', () => {
    const b = load('m2-triangle-centres')
    const t = compileShapes(b.shapes).get(b.shapes[0].id)!.centres!
    expect(t.kind).toBe('obtuse')
    expect(t.circumcentre.pt.text).toBe('(2, −2)')
    expect(t.orthocentre.pt.text).toBe('(0, 6)')
    expect(t.centroid.pt.text).toBe('(4/3, 2/3)')
    expect(t.circumcentre.where).toBe('outside')
    expect(t.orthocentre.where).toBe('outside')
    expect(t.incentre.where).toBe('inside')
    expect(t.circumradius.text).toBe('2√5')
    expect(t.euler!.line.slopeIntercept.text).toBe('y = −4x + 6')
    expect(b.shapes[0].measure!.centres).toEqual([...ALL])
  })
  it('the inscribed angle: ∠POQ = 90°, ∠PRQ = 45°; R at 100° gives 135°', () => {
    const b = load('m3-inscribed-central')
    const c = b.curves[0]
    const p = circlePanel(c, b.exprSources[c.id], b.curveViews[c.id].circle)!
    expect(p.angles && 'central' in p.angles && p.angles.central.text).toBe('90°')
    expect(p.angles && 'inscribed' in p.angles && p.angles.inscribed.text).toBe('45°')
    expect(p.rows.map((r) => (r.ok ? r.p.coords.text : r.error))).toEqual(['(3, 4)', '(−4, 3)', '(0, −5)'])
    const moved = circlePanel(c, b.exprSources[c.id], { ...b.curveViews[c.id].circle, pts: ['(3, 4)', '(-4, 3)', '100'] })!
    expect(moved.angles && 'inscribed' in moved.angles && moved.angles.inscribed.text).toBe('135°')
  })
  it('the sector: θ = 2π/3, s = 4π, A = 12π', () => {
    const b = load('m3-arc-sector')
    const c = b.curves[0]
    const p = circlePanel(c, b.exprSources[c.id], b.curveViews[c.id].circle)!
    expect(p.sector && 'theta' in p.sector && [p.sector.theta.text, p.sector.arc.text, p.sector.area.text]).toEqual(['2π/3', '4π', '12π'])
  })
})

describe('commands and help', () => {
  it('registers the new commands and lists them in the help sheet', () => {
    const ids = ['shape-centres', 'circle-angles', 'circle-tangent', 'circle-sector']
    for (const id of ids) expect(COMMANDS.some((c) => c.id === id), id).toBe(true)
    const listed = (course: string): string[] =>
      HELP_SECTIONS.filter((s) => s.course === course).flatMap((s) => s.entries.flatMap((e) => ('id' in e ? [e.id] : [])))
    expect(listed('NC Math 3')).toEqual(expect.arrayContaining(['circle-angles', 'circle-tangent', 'circle-sector', 'shape-centres']))
    // 2016 NC SCOS: the centres of a triangle are Math 3 (NC.M3.G-CO.10)
    expect(HELP_SECTIONS.find((s) => s.id === 'm3-centres')!.title).toContain('NC.M3.G-CO.10')
    expect(HELP_SECTIONS.find((s) => s.id === 'm3-centres')!.course).toBe('NC Math 3')
    expect(HELP_SECTIONS.some((s) => s.id === 'm2-centres')).toBe(false)
  })
})

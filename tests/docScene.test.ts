// ============================================================================
// tests/docScene.test.ts — a stored document's figure carries what the
// document's own export carries, for the kinds the per-card pipelines build:
//
//   sequences and series     dots, rings, squares, bars, band, y = S, partner
//   related rates            the picture, its title, the mini-graph
//   inequality system        the solution region, test point, LP corners
//   conic constructions      directrix / asymptotes / box, foci, framing
//   particle motion          the selected curve's particle in the export
//   polar area               the shaded petal
//   Domain section           ghost, horizontal line test, reflected point
//   implicit tangents        horizontal / vertical tangent marks
//
// Each: the scene's fields, the recorded display list, and the student copy
// against the key. `omitted` is empty for every one of them.
// ============================================================================

import { describe, expect, it } from 'vitest'
import { parseExpression } from '../src/core/parse'
import type { FittedCurve } from '../src/core/types'
import type { BoardInput, BoardSequence, CurveViews, DocMeta } from '../src/core/persist'
import { docFromBoard, serializeDoc } from '../src/core/persist'
import { docFigure, docModelFromJSON, recordFigure } from '../src/ui/docScene'
import type { DocModel } from '../src/ui/docScene'
import { newRelatedRates } from '../src/ui/relatedRatesLinks'
import type { DisplayList, TextItem } from '../src/render/vectorCtx'
import type { Overlay } from '../src/render/overlays'
import { OPTIMUM_COLOR } from '../src/ui/systemLinks'
import { DEFAULT_EXPORT } from '../src/ui/renderBoard'
import { defaultFit } from '../src/ui/exportFit'

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function typed(id: string, src: string, modelId: string, color = '#4f9cf9'): FittedCurve {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(`fixture failed to parse: ${src}: ${o.error}`)
  return {
    id,
    modelId,
    params: o.plot.defaultParams.slice(),
    kind: o.plot.kind,
    domain: o.plot.domain,
    color,
    strokeWidth: 2.5,
    visible: true,
    error: 0,
  }
}

function input(over: Partial<BoardInput>): BoardInput {
  return {
    curves: [],
    styles: {},
    candidates: new Map(),
    exprSources: {},
    viewport: { center: { x: 0, y: 0 }, pxPerUnit: 60 },
    selectedId: null,
    mode: 'draw',
    ...over,
  }
}

function docJSON(id: string, b: BoardInput): string {
  const meta: DocMeta = { id, name: id, createdAt: 1, modifiedAt: 1 }
  return serializeDoc(docFromBoard(meta, b, 2))
}

/** Typed lines, by id → source, each its own expr_N model. */
function lines(srcs: Record<string, string>): { curves: FittedCurve[]; exprSources: Record<string, string> } {
  const curves = Object.entries(srcs).map(([id, src], i) => typed(id, src, `expr_${i + 1}`))
  return { curves, exprSources: { ...srcs } }
}

/** Loaded with the document's export settings at the app defaults — or "fit to content" on. */
function load(json: string, fit = false): DocModel {
  const m = docModelFromJSON(json, fit ? { settings: { ...DEFAULT_EXPORT, ...defaultFit('cartesian'), fit: true } } : {})
  if (!m) throw new Error('document did not load')
  expect(m.problems).toEqual([])
  expect(m.omitted).toEqual([])
  return m
}

const texts = (l: DisplayList): string[] => l.items.filter((i): i is TextItem => i.t === 'text').map((i) => i.text)
const allText = (l: DisplayList): string => texts(l).join(' | ')
const figure = (m: DocModel, answers: boolean, style: 'textbook' | 'sat' | 'screen' = 'textbook') =>
  docFigure(m, { style, answers, widthCm: 9, caption: '' })
const ofKind = <K extends Overlay['kind']>(ovs: readonly Overlay[] | undefined, k: K) =>
  (ovs ?? []).filter((o): o is Extract<Overlay, { kind: K }> => o.kind === k)
/** The number of filled paths in a display list: what a wash or a bar draws. */
const filled = (l: DisplayList): number => l.items.filter((i) => i.t === 'path' && i.fill !== null).length

// ---------------------------------------------------------------------------
// sequences and series
// ---------------------------------------------------------------------------

describe('sequences and series', () => {
  const seq = (over: Partial<BoardSequence> = {}): BoardSequence => ({
    id: 'q1',
    src: 'a_n = 3 + 4(n - 1)',
    color: '#4f9cf9',
    visible: true,
    n0: 1,
    count: 6,
    showPartner: true,
    showSums: true,
    params: [],
    ...over,
  })

  it('an arithmetic sequence: its dots, its partial-sum rings, its dashed partner, framed', () => {
    const m = load(docJSON('dSeq', input({ sequences: [seq()] })), true)
    const key = figure(m, true)
    const sc = key.scene
    const dots = sc.scatter!.find((s) => s.id === 'q1')!
    expect(dots.ys.slice(0, 4)).toEqual([3, 7, 11, 15])
    const rings = sc.scatter!.find((s) => s.id === 'q1:sums')!
    expect(rings.marker).toBe('ring')
    expect(rings.ys.slice(0, 3)).toEqual([3, 10, 21])
    // the partner y = 4x − 1, sampled across the frame
    const partner = sc.polylines!.find((p) => p.id === 'partner:q1')!
    expect(partner.dash).toBeTruthy()
    const mid = partner.pts[Math.floor(partner.pts.length / 2)]
    expect(mid.y).toBeCloseTo(4 * mid.x - 1, 6)
    // a fitted export frames every term: (6, 23) and S₆ = 78 are on the figure
    const half = sc.vp.heightPx / 2 / (sc.vp.pxPerUnitY ?? sc.vp.pxPerUnit)
    expect(sc.vp.center.y + half).toBeGreaterThan(78)
    // drawn: six dots and six rings at least
    const list = recordFigure(key)
    expect(list.items.filter((i) => i.t === 'path').length).toBeGreaterThan(12)
  })

  it('a hidden sequence draws nothing and frames nothing', () => {
    const m = load(docJSON('dSeqHidden', input({ sequences: [seq({ visible: false })] })))
    const sc = figure(m, true).scene
    expect(sc.scatter!.every((s) => s.visible === false)).toBe(true)
    expect(sc.polylines!.some((p) => p.id === 'partner:q1')).toBe(false)
  })

  it('a geometric series: squares, bars and the sum on the key; the student copy has no sum', () => {
    const q = seq({
      id: 'g',
      src: 'a_n = (1/2)^(n - 1)',
      count: 8,
      showPartner: false,
      showSums: false,
      series: { N: 8, connect: true, bars: true },
    })
    const m = load(docJSON('dSeries', input({ sequences: [q] })))
    const key = figure(m, true)
    const student = figure(m, false)

    // the partial sums as squares, in the companion colour
    const sq = key.scene.scatter!.find((s) => s.id === 'g:series')!
    expect(sq.marker).toBe('square')
    expect(sq.ys[sq.ys.length - 1]).toBeCloseTo(2 - 2 ** -7, 9)
    // the staircase: one bar per partial sum, filled, under the curves
    const paths = ofKind(key.scene.overlays, 'path')
    expect(paths.filter((p) => p.closed && p.under).length).toBeGreaterThanOrEqual(8)
    // the line joining the sums
    expect(paths.some((p) => !p.closed && p.points.length === 8)).toBe(true)
    // the sum: y = 2, dashed, and its chip
    const S = ofKind(key.scene.overlays, 'hline')
    expect(S).toHaveLength(1)
    expect(S[0].y).toBeCloseTo(2, 9)
    const label = ofKind(key.scene.overlays, 'label')
    expect(label.map((l) => l.text)).toEqual(['S = 2'])
    expect(allText(recordFigure(key))).toContain('S = 2')

    // the student copy: the same squares and bars, no y = S, no "S = 2"
    expect(student.scene.scatter!.find((s) => s.id === 'g:series')!.ys).toEqual(sq.ys)
    expect(ofKind(student.scene.overlays, 'path').length).toBe(paths.length)
    expect(ofKind(student.scene.overlays, 'hline')).toHaveLength(0)
    expect(ofKind(student.scene.overlays, 'label')).toHaveLength(0)
    const s = recordFigure(student)
    expect(allText(s)).not.toContain('S =')
    expect(filled(s)).toBeGreaterThanOrEqual(8)
  })

  it('sequences on a number line draw nothing (the App draws them on a graph only)', () => {
    const m = load(docJSON('dSeqNL', input({ kind: 'number-line', items: [], sequences: [seq()] })))
    expect(figure(m, true).scene.scatter).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// related rates
// ---------------------------------------------------------------------------

describe('related rates', () => {
  it('the ladder: picture, title and mini-graph on the key; "?" and no graph on the student copy', () => {
    const rr = newRelatedRates('R1')
    const m = load(docJSON('dRR', input({ relatedRates: [rr] })))
    const key = figure(m, true)
    const f = key.scene.relatedRates!
    expect(f).toHaveLength(1)
    expect(f[0].id).toBe('R1')
    expect(f[0].graph).not.toBeNull()
    expect(f[0].title!.text).toMatch(/dy\/dt = −?[\d./]+ ft\/s/)
    const k = allText(recordFigure(key))
    expect(k).toMatch(/dy\/dt = −?[\d./]+ ft\/s/)

    const student = figure(m, false)
    const g = student.scene.relatedRates![0]
    expect(g.graph).toBeNull()
    expect(g.title!.text).toContain('dy/dt = ?')
    const s = allText(recordFigure(student))
    expect(s).toContain('dy/dt = ?')
    expect(s).not.toMatch(/dy\/dt = −?\d/)
    // the givens are the question, and stay
    expect(s).toContain('dx/dt')
  })

  it('frames the picture: a fitted export holds the ladder and its graph', () => {
    const rr = newRelatedRates('R1')
    // a board framed far away from the picture
    const m = load(docJSON('dRRfar', input({ relatedRates: [rr], viewport: { center: { x: 200, y: 200 }, pxPerUnit: 60 } })), true)
    const sc = figure(m, true).scene
    const halfX = sc.vp.widthPx / 2 / sc.vp.pxPerUnit
    expect(Math.abs(sc.vp.center.x)).toBeLessThan(halfX + 50)
    expect(sc.vp.center.x - halfX).toBeLessThan(0.5)
  })

  it('a hidden scenario is in the scene but not drawn, and not framed', () => {
    const rr = { ...newRelatedRates('R1'), hidden: true as const }
    const m = load(docJSON('dRRhidden', input({ relatedRates: [rr] })))
    const key = figure(m, true)
    expect(key.scene.relatedRates![0].visible).toBe(false)
    expect(allText(recordFigure(key))).not.toContain('dy/dt')
  })
})

// ---------------------------------------------------------------------------
// the inequality system
// ---------------------------------------------------------------------------

describe('the inequality system', () => {
  const LP = () =>
    lines({
      i1: 'y <= -x + 4',
      i2: 'x >= 0',
      i3: 'y >= 0',
    })

  it('the solution region, the corners and the optimum on the key', () => {
    const { curves, exprSources } = LP()
    const json = docJSON(
      'dLP',
      input({
        curves,
        exprSources,
        system: { solution: true, objective: { src: 'P = 3x + 2y', goal: 'max' }, iso: true, test: { x: 1, y: 1 } },
      }),
    )
    const m = load(json)
    const key = figure(m, true)
    expect(key.scene.inequalitySolution).toBe(true)
    const labels = ofKind(key.scene.overlays, 'label').map((l) => l.text)
    expect(labels).toContain('(0, 0)')
    expect(labels).toContain('(0, 4)')
    expect(labels.some((t) => t.startsWith('(4, 0)') && t.includes('max P = 12'))).toBe(true)
    // the test point and its verdict
    expect(labels.some((t) => t.startsWith('(1, 1)') && t.endsWith('✓'))).toBe(true)
    // the optimum in its colour, and the iso-profit line through it
    expect(ofKind(key.scene.overlays, 'dot').some((d) => d.color === OPTIMUM_COLOR)).toBe(true)
    expect(ofKind(key.scene.overlays, 'line')).toHaveLength(1)
    const k = allText(recordFigure(key))
    expect(k).toContain('max P = 12')
    expect(k).toContain('(0, 4)')
  })

  it('the student copy: the region, the corner dots and the test point; no coordinates, no optimum', () => {
    const { curves, exprSources } = LP()
    const json = docJSON(
      'dLPs',
      input({
        curves,
        exprSources,
        system: { solution: true, objective: { src: 'P = 3x + 2y', goal: 'max' }, iso: true, test: { x: 1, y: 1 } },
      }),
    )
    const student = figure(load(json), false)
    expect(student.scene.inequalitySolution).toBe(true)
    const dots = ofKind(student.scene.overlays, 'dot')
    // three corners and the test point
    expect(dots).toHaveLength(4)
    expect(dots.some((d) => d.color === OPTIMUM_COLOR)).toBe(false)
    expect(ofKind(student.scene.overlays, 'line')).toHaveLength(0)
    const labels = ofKind(student.scene.overlays, 'label').map((l) => l.text)
    expect(labels).toEqual(['(1, 1) ✓'])
    const s = allText(recordFigure(student))
    expect(s).not.toContain('max P')
    expect(s).not.toContain('(0, 4)')
  })

  it('no system set: each inequality shades alone and nothing is marked', () => {
    const { curves, exprSources } = LP()
    const sc = figure(load(docJSON('dIneq', input({ curves, exprSources }))), true).scene
    expect(sc.inequalitySolution).toBeUndefined()
    expect(ofKind(sc.overlays, 'label')).toHaveLength(0)
  })

  it('the solution region is drawn only with two or more inequalities', () => {
    const { curves, exprSources } = lines({ i1: 'y <= -x + 4' })
    const sc = figure(load(docJSON('dIneq1', input({ curves, exprSources, system: { solution: true } }))), true).scene
    expect(sc.inequalitySolution).toBeUndefined()
  })

  it('the region changes the drawing: the solution draws differently from the separate shadings', () => {
    const { curves, exprSources } = LP()
    const on = recordFigure(figure(load(docJSON('dOn', input({ curves, exprSources, system: { solution: true } }))), true))
    const off = recordFigure(figure(load(docJSON('dOff', input({ curves, exprSources }))), true))
    expect(JSON.stringify(on.items)).not.toBe(JSON.stringify(off.items))
  })
})

// ---------------------------------------------------------------------------
// conic constructions
// ---------------------------------------------------------------------------

describe('conic constructions', () => {
  const ELLIPSE = '(x - 1)^2/25 + (y - 2)^2/9 = 1'
  const HYPERBOLA = 'x^2/9 - y^2/16 = 1'

  it('an ellipse with its construction on: foci F₁ F₂, centre and vertices, framed', () => {
    const { curves, exprSources } = lines({ c1: ELLIPSE })
    const views: CurveViews = { c1: { construction: true } }
    // framed somewhere else: the fitted export finds the ellipse and its foci
    const m = load(docJSON('dEll', input({ curves, exprSources, curveViews: views, viewport: { center: { x: 50, y: 50 }, pxPerUnit: 60 } })), true)
    const sc = figure(m, true).scene
    const pts = sc.shapes!.filter((s) => s.kind === 'point' && s.id.startsWith('construction:c1'))
    const named = pts.filter((s) => s.kind === 'point' && s.label).map((s) => (s.kind === 'point' ? s.label : ''))
    expect(named).toEqual(['F₁', 'F₂'])
    // foci at (1 ± 4, 2)
    const foci = pts.filter((s) => s.kind === 'point' && s.label).map((s) => (s.kind === 'point' ? s.at : null))
    expect(foci.map((p) => p!.x).sort((a, b) => a - b)).toEqual([-3, 5])
    // centre + 2 vertices + 2 co-vertices + 2 foci
    expect(pts).toHaveLength(7)
    const halfX = sc.vp.widthPx / 2 / sc.vp.pxPerUnit
    expect(sc.vp.center.x - halfX).toBeLessThan(-4)
    expect(sc.vp.center.x + halfX).toBeGreaterThan(6)
    const t = allText(recordFigure(figure(m, false)))
    expect(t).toContain('F₁')
    expect(t).toContain('F₂')
  })

  it('a hyperbola: its two asymptotes and its box as dashed polylines', () => {
    const { curves, exprSources } = lines({ h1: HYPERBOLA })
    const m = load(docJSON('dHyp', input({ curves, exprSources, curveViews: { h1: { construction: true } } })))
    const pl = figure(m, true).scene.polylines!.filter((p) => p.id.startsWith('construction:h1'))
    expect(pl.map((p) => p.id).sort()).toEqual(['construction:h1:asymptote:0', 'construction:h1:asymptote:1', 'construction:h1:box'])
    expect(pl.every((p) => p.dash && p.dash.length > 0)).toBe(true)
    const a = pl.find((p) => p.id.endsWith('asymptote:0'))!
    const slope = (a.pts[1].y - a.pts[0].y) / (a.pts[1].x - a.pts[0].x)
    expect(Math.abs(slope)).toBeCloseTo(4 / 3, 9)
  })

  it('construction off: nothing extra, as the App’s export (the selected conic’s marks are screen only)', () => {
    const { curves, exprSources } = lines({ c1: ELLIPSE })
    const sc = figure(load(docJSON('dEllOff', input({ curves, exprSources, selectedId: 'c1' }))), true).scene
    expect(sc.polylines!.some((p) => p.id.startsWith('construction:'))).toBe(false)
    expect(sc.shapes!.some((s) => s.id.startsWith('construction:'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// particle motion and the polar area
// ---------------------------------------------------------------------------

describe('particle motion', () => {
  const ROSE = 'r = 2cos(3θ)'

  it('the selected polar curve with "show particle in export": dot, velocity, ray from the pole', () => {
    const { curves, exprSources } = lines({ p1: ROSE })
    const m = load(
      docJSON('dRose', input({ curves, exprSources, selectedId: 'p1', curveViews: { p1: { exportParticle: true, accel: true } } })),
    )
    const sc = figure(m, true).scene
    const motion = sc.shapes!.filter((s) => s.id.startsWith('motion:p1'))
    expect(motion.map((s) => s.id).sort()).toEqual(['motion:p1:acceleration', 'motion:p1:particle', 'motion:p1:velocity'])
    // t starts at the interval's start (θ = 0): r = 2, the point (2, 0)
    const dot = motion.find((s) => s.id === 'motion:p1:particle')!
    expect(dot.kind === 'point' && dot.at.x).toBeCloseTo(2, 9)
    const ray = sc.polylines!.find((p) => p.id === 'motion:p1:ray')!
    expect(ray.pts[0]).toEqual({ x: 0, y: 0 })
    expect(ray.pts[1].x).toBeCloseTo(2, 9)
    const t = texts(recordFigure(figure(m, false)))
    expect(t).toContain('v')
    expect(t).toContain('a')
  })

  it('a parametric particle: no ray', () => {
    const { curves, exprSources } = lines({ p1: '(3cos(t), 2sin(t))' })
    expect(curves[0].kind).toBe('parametric')
    const m = load(docJSON('dPar', input({ curves, exprSources, selectedId: 'p1', curveViews: { p1: { exportParticle: true } } })))
    const sc = figure(m, true).scene
    expect(sc.shapes!.map((s) => s.id).sort()).toEqual(['motion:p1:particle', 'motion:p1:velocity'])
    expect(sc.polylines!.some((p) => p.id.startsWith('motion:'))).toBe(false)
  })

  it('the switch off, or the curve not selected: no particle (screen only, as the App’s export)', () => {
    const { curves, exprSources } = lines({ p1: ROSE })
    const off = load(docJSON('dRoseOff', input({ curves, exprSources, selectedId: 'p1' })))
    expect(figure(off, true).scene.shapes!.some((s) => s.id.startsWith('motion:'))).toBe(false)
    const notSel = load(docJSON('dRoseNS', input({ curves, exprSources, curveViews: { p1: { exportParticle: true } } })))
    expect(figure(notSel, true).scene.shapes!.some((s) => s.id.startsWith('motion:'))).toBe(false)
  })

  it('a polar area: one petal shaded, selected or not', () => {
    const { curves, exprSources } = lines({ p1: ROSE })
    const m = load(
      docJSON('dPetal', input({ curves, exprSources, curveViews: { p1: { area: { on: true, a: '-pi/6', b: 'pi/6' } } } })),
    )
    const key = figure(m, true)
    const regions = ofKind(key.scene.overlays, 'region')
    expect(regions).toHaveLength(1)
    // the petal reaches r = 2 at θ = 0
    expect(Math.max(...regions[0].boundary.map((p) => p.x))).toBeCloseTo(2, 2)
    expect(filled(recordFigure(key))).toBeGreaterThan(filled(recordFigure(figure(load(docJSON('dRose0', input({ curves, exprSources }))), true))))
    // figure content, not an answer: on the student copy too
    expect(ofKind(figure(m, false).scene.overlays, 'region')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// the Domain section
// ---------------------------------------------------------------------------

describe('the Domain section on the figure', () => {
  it('the ghost of a restricted line, the horizontal line test and the reflected point', () => {
    const { curves, exprSources } = lines({ f: 'y = x^2 {x >= 0}' })
    const m = load(docJSON('dDom', input({ curves, exprSources, curveViews: { f: { ghost: true, hlt: 1, reflect: 1 } } })))
    for (const answers of [true, false]) {
      const sc = figure(m, answers).scene
      const ghost = ofKind(sc.overlays, 'ghost')
      expect(ghost).toHaveLength(1)
      // the body without its restriction: defined on the left too
      expect(ghost[0].f(-2)).toBeCloseTo(4, 12)
      // the ghost sits under everything: first
      expect(sc.overlays![0].kind).toBe('ghost')
      const hl = ofKind(sc.overlays, 'hline')
      expect(hl).toHaveLength(1)
      expect(hl[0].y).toBe(1)
      // one crossing on the restricted curve (x = 1): passes
      const dots = ofKind(sc.overlays, 'dot')
      expect(dots.filter((d) => d.at.y === 1 && Math.abs(d.at.x - 1) < 1e-6).length).toBeGreaterThanOrEqual(1)
      // the reflected point: (1, 1) on f and (1, 1) mirrored, joined across y = x
      expect(ofKind(sc.overlays, 'segment')).toHaveLength(1)
    }
    // drawn: the ghost is a dashed path across the whole frame
    const list = recordFigure(figure(m, true))
    expect(list.items.some((i) => i.t === 'path' && i.stroke && i.stroke.dash.length > 0)).toBe(true)
  })

  it('the horizontal line test failing: y = x² unrestricted at y = 1 has two crossings', () => {
    const { curves, exprSources } = lines({ f: 'y = x^2' })
    const m = load(docJSON('dHlt', input({ curves, exprSources, curveViews: { f: { hlt: 1 } } })))
    const sc = figure(m, true).scene
    const dots = ofKind(sc.overlays, 'dot')
    expect(dots.map((d) => Math.round(d.at.x * 1e6) / 1e6).sort((a, b) => a - b)).toEqual([-1, 1])
    // the warning colour at two or more
    expect(new Set(dots.map((d) => d.color)).size).toBe(1)
    expect(dots[0].color).toBe(ofKind(sc.overlays, 'hline')[0].color)
  })

  it('a ghost on a line that calls another: parsed against the board’s names', () => {
    const { curves, exprSources } = lines({ f: 'f(x) = x^2', g: 'g(x) = f(x) + 1 {x >= 0}' })
    const m = load(
      docJSON('dDomCalls', input({ curves, exprSources, names: { f: 'f', g: 'g' }, calls: { g: ['f'] }, curveViews: { g: { ghost: true } } })),
    )
    const ghost = ofKind(figure(m, true).scene.overlays, 'ghost')
    expect(ghost).toHaveLength(1)
    expect(ghost[0].curveId).toBe('g')
    expect(ghost[0].f(-2)).toBeCloseTo(5, 9)
  })
})

// ---------------------------------------------------------------------------
// implicit tangents' marks
// ---------------------------------------------------------------------------

describe('implicit tangents', () => {
  it('a circle’s tangent with "mark horizontal / vertical tangents": the four marks', () => {
    const { curves, exprSources } = lines({ P: 'x^2 + y^2 = 25' })
    const line = typed('L', 'y = (3/4)x + 25/4', 'expr_9')
    const json = docJSON(
      'dImp',
      input({
        curves: [...curves, { ...line, modelId: 'line', params: [0.75, 6.25], kind: 'explicit', domain: null }],
        exprSources,
        calc: [{ kind: 'tangent', id: 'T', parentId: 'P', curveId: 'L', x: -3, y: 4, marks: true }],
      }),
    )
    const m = load(json)
    const key = figure(m, true)
    const labels = ofKind(key.scene.overlays, 'label').map((l) => l.text)
    for (const p of ['(0, 5)', '(0, −5)', '(5, 0)', '(−5, 0)']) expect(labels).toContain(p)
    // the marks' coordinates are answers: the student copy keeps the dots, not the chips
    const student = figure(m, false)
    expect(ofKind(student.scene.overlays, 'label')).toHaveLength(0)
    expect(allText(recordFigure(student))).not.toContain('(0, 5)')
  })
})

// ---------------------------------------------------------------------------
// nothing is listed as missing
// ---------------------------------------------------------------------------

describe('omitted', () => {
  it('is empty for a document that has everything at once', () => {
    const { curves, exprSources } = lines({
      c1: '(x - 1)^2/25 + (y - 2)^2/9 = 1',
      p1: 'r = 2cos(3θ)',
      i1: 'y <= -x + 4',
      i2: 'x >= 0',
      f: 'y = x^2 {x >= 0}',
    })
    const json = docJSON(
      'dAll',
      input({
        curves,
        exprSources,
        selectedId: 'p1',
        sequences: [
          { id: 'q', src: 'a_n = 2n', color: '#4f9cf9', visible: true, n0: 1, count: 5, showPartner: true, showSums: false, params: [] },
        ],
        relatedRates: [newRelatedRates('R1')],
        system: { solution: true, test: { x: 1, y: 1 } },
        curveViews: { c1: { construction: true, showParent: true }, p1: { exportParticle: true }, f: { ghost: true } },
      }),
    )
    const m = load(json)
    const sc = figure(m, true).scene
    expect(sc.relatedRates).toHaveLength(1)
    expect(sc.inequalitySolution).toBe(true)
    expect(sc.scatter!.some((s) => s.id === 'q')).toBe(true)
    expect(sc.shapes!.some((s) => s.id === 'motion:p1:particle')).toBe(true)
    expect(sc.shapes!.some((s) => s.id.startsWith('construction:c1'))).toBe(true)
    expect(ofKind(sc.overlays, 'ghost')).toHaveLength(1)
    // and it records, in every format's source
    expect(recordFigure(figure(m, false)).items.length).toBeGreaterThan(50)
  })
})

// ============================================================================
// tests/examples.test.ts — the examples gallery (src/examples).
//
// Every example is built from its recipe, stored the way the App stores a
// document, and loaded back through deserializeDoc — the path a teacher's
// documents take — with ZERO load problems. Each renders a thumbnail scene
// (docScene, as the gallery draws it) and carries a teacher note of two or
// three sentences that survives the round trip. A document with no note is
// byte-for-byte what it was before notes existed.
// ============================================================================

import { describe, expect, it } from 'vitest'
import {
  COURSE_ORDER,
  EXAMPLE_DEFS,
  ExampleBoard,
  buildExample,
  exampleById,
  exampleCopyName,
  exampleDocName,
  exampleMatches,
  examplesForSection,
  galleryGroups,
} from '../src/examples'
import type { BoardInput, DocMeta } from '../src/core/persist'
import { MAX_NOTE_CHARS, deserializeDoc, docFromBoard, serializeDoc } from '../src/core/persist'
import { docFigure, docModelFromJSON, recordFigure } from '../src/ui/docScene'
import { HELP_SECTIONS } from '../src/ui/commands'
import { safeReadConic } from '../src/ui/conicLinks'
import { safeReadFactored } from '../src/ui/factorLinks'
import { safeReadLogistic } from '../src/ui/logisticLinks'
import { safeReadPiecewise } from '../src/ui/piecewiseLinks'
import { safeReadSinusoid } from '../src/ui/sinLinks'
import { safeReadTransform } from '../src/ui/transformLinks'
import { heavyJSON } from './heavyDoc'
import { MODELS } from '../src/core/fit/models'
import { readTransform } from '../src/core/transform'
import { readFactored } from '../src/core/factored'
import { fitRegression } from '../src/core/data'
import { boardIntersections, boardMeetings } from '../src/ui/intersections'
import { compileShapes } from '../src/ui/shapeLinks'
import { compareCard } from '../src/ui/shapeXform'
import { dataPlotCard } from '../src/ui/dataPlotLinks'
import { probCard } from '../src/ui/probLinks'
import { readSequence } from '../src/ui/seqLinks'
import { dataColumns } from '../src/ui/dataLinks'
import { classify } from '../src/core/sequences'

const sentences = (s: string): number => s.split(/[.?!](?:\s|$)/).filter((t) => t.trim() !== '').length

const load = (id: string) => {
  const def = exampleById(id)
  if (!def) throw new Error(`no example ${id}`)
  const built = buildExample(def)
  const res = deserializeDoc(built.json)
  if (!res.board) throw new Error(`example ${id} did not load`)
  return { def, built, res, board: res.board }
}

describe('every example', () => {
  it('has a unique id, a course, a known help section and a unique document name', () => {
    const ids = new Set<string>()
    const names = new Set<string>()
    const sections = new Set(HELP_SECTIONS.map((s) => s.id))
    for (const def of EXAMPLE_DEFS) {
      expect(ids.has(def.id), def.id).toBe(false)
      ids.add(def.id)
      expect(COURSE_ORDER).toContain(def.course)
      expect(def.help.length, def.id).toBeGreaterThan(0)
      for (const h of def.help) expect(sections.has(h), `${def.id} → ${h}`).toBe(true)
      const name = exampleDocName(def)
      expect(name.startsWith(`Example: ${def.unit} — `)).toBe(true)
      expect(names.has(name), name).toBe(false)
      names.add(name)
    }
    expect(EXAMPLE_DEFS.length).toBeGreaterThanOrEqual(30)
  })

  for (const def of EXAMPLE_DEFS) {
    describe(def.id, () => {
      it('loads through deserializeDoc with zero problems, its note intact', () => {
        const built = buildExample(def)
        const res = deserializeDoc(built.json)
        expect(res.problems).toEqual([])
        expect(res.degraded).toBe(false)
        expect(res.meta?.name).toBe(exampleDocName(def))
        expect(res.board?.kind).toBe(def.kind ?? 'cartesian')
        expect(res.board?.note).toBe(def.note)
        // nothing the loader had to rebuild came back broken
        expect(res.board?.brokenExpr).toEqual({})
      })

      it('has a teacher note of two or three sentences', () => {
        expect(def.note.length).toBeGreaterThan(80)
        expect(def.note.length).toBeLessThanOrEqual(MAX_NOTE_CHARS)
        const n = sentences(def.note)
        expect(n, def.note).toBeGreaterThanOrEqual(2)
        expect(n, def.note).toBeLessThanOrEqual(3)
      })

      it('renders a thumbnail scene with something on it', () => {
        const built = buildExample(def)
        const m = docModelFromJSON(built.json)
        expect(m).not.toBeNull()
        expect(m!.problems).toEqual([])
        for (const answers of [false, true]) {
          const f = docFigure(m!, { style: 'screen', answers, widthCm: 6, caption: '' })
          const sc = f.scene
          const drawn =
            sc.curves.filter((c) => c.visible).length +
            (sc.items?.length ?? 0) +
            (sc.fields?.length ?? 0) +
            (sc.scatter?.length ?? 0) +
            (sc.unitCircles?.length ?? 0) +
            (sc.relatedRates?.length ?? 0) +
            (sc.shapes?.filter((x) => x.visible).length ?? 0) +
            (sc.stats?.filter((x) => x.visible).length ?? 0)
          expect(drawn).toBeGreaterThan(0)
          const list = recordFigure(f)
          expect(list.items.length).toBeGreaterThan(3)
          expect(list.width).toBeGreaterThan(100)
        }
      })

      it('round-trips: load and save writes the same bytes', () => {
        const built = buildExample(def)
        const res = deserializeDoc(built.json)
        const b = res.board!
        const input: BoardInput = {
          curves: b.curves,
          kind: b.kind,
          items: b.items,
          styles: b.styles,
          candidates: b.candidates,
          exprSources: b.exprSources,
          displaySources: b.displaySources,
          axisUnits: b.axisUnits,
          calc: b.calc,
          names: b.names,
          calls: b.calls,
          inverses: b.inverses,
          fields: b.fields,
          shapes: b.shapes,
          data: b.data,
          sequences: b.sequences,
          unitCircles: b.unitCircles,
          relatedRates: b.relatedRates,
          stats: b.stats,
          system: b.system,
          grid: b.grid,
          figure: b.figure,
          caption: b.caption,
          captionAuto: b.captionAuto,
          curveViews: b.curveViews,
          note: b.note,
          viewport: b.viewport,
          selectedId: b.selectedId,
          mode: b.mode,
        }
        expect(serializeDoc(docFromBoard(res.meta!, input, 0))).toBe(built.json)
      })
    })
  }
})

describe('what the examples put on the board', () => {
  it('U1: two limits with their tables, one at a hole and one at a jump', () => {
    const { board } = load('calc-u1-holes-jumps')
    const limits = board.calc.filter((l) => l.kind === 'limit')
    expect(limits.map((l) => (l.kind === 'limit' ? [l.a, l.table] : null))).toEqual([
      [2, true],
      [3, true],
    ])
  })

  it('U2: f, its derivative (dashed), a tangent at 1 and the secant over [1, 3]', () => {
    const { board } = load('calc-u2-secant-tangent')
    expect(board.calc.map((l) => l.kind).sort()).toEqual(['derivative', 'secant', 'tangent'])
    const d = board.calc.find((l) => l.kind === 'derivative')!
    expect(d.kind === 'derivative' && board.styles[d.curveId]?.dash).toBeTruthy()
    const t = board.curves.find((c) => c.modelId === 'line')!
    expect(t.params[1]).toBeCloseTo(2, 6)
  })

  it('U3: the circle’s tangent at (3, 4) with slope −3/4 and the H/V marks', () => {
    const { board } = load('calc-u3-implicit-circle')
    const t = board.calc.find((l) => l.kind === 'tangent')!
    expect(t.kind === 'tangent' && [t.x, t.y, t.marks]).toEqual([3, 4, true])
    const line = board.curves.find((c) => c.modelId === 'line')!
    expect(line.params[1]).toBeCloseTo(-0.75, 6)
  })

  it('U4: the ladder at the instant x = 6', () => {
    const { board } = load('calc-u4-ladder')
    expect(board.relatedRates).toHaveLength(1)
    expect(board.relatedRates[0].when).toEqual({ q: 'x', v: 6 })
  })

  it('U5: the sign chart reads the graph as f′; the MVT is on', () => {
    const fp = load('calc-u5-graph-of-fprime').board.calc[0]
    expect(fp.kind === 'signchart' && [fp.as, fp.rows]).toEqual(['f1', ['f1', 'f2']])
    const mvt = load('calc-u5-mvt').board.calc[0]
    expect(mvt.kind === 'secant' && [mvt.a, mvt.b, mvt.mvt]).toEqual([-2, 2, true])
  })

  it('U6: n = 4 and n = 50; an accumulation function of a piecewise f', () => {
    const r = load('calc-u6-riemann').board.calc.map((l) => (l.kind === 'riemann' ? l.n : 0)).sort((a, b) => a - b)
    expect(r).toEqual([4, 50])
    const { board } = load('calc-u6-accumulation')
    expect(safeReadPiecewise(Object.values(board.exprSources)[0])).not.toBeNull()
    expect(board.calc.some((l) => l.kind === 'accumulation' && l.a === 0 && l.x === 3)).toBe(true)
  })

  it('U7: Euler with h = 0.5 and h = 0.25; the logistic with its field', () => {
    const f = load('calc-u7-euler').board.fields[0]
    expect(f.src).toBe('dy/dx = x + y')
    expect(f.eulers?.map((e) => e.h)).toEqual([0.5, 0.25])
    const { board } = load('calc-u7-logistic')
    expect(safeReadLogistic(Object.values(board.exprSources)[0])).not.toBeNull()
    expect(board.fields).toHaveLength(1)
    expect(board.fields[0].solutions).toHaveLength(1)
  })

  it('U8: area between, washers about y = 2, square sections', () => {
    expect(load('calc-u8-area-between').board.calc[0]).toMatchObject({ kind: 'area', from: -2, to: 1, abs: true })
    expect(load('calc-u8-washers').board.calc[0]).toMatchObject({ kind: 'volume', axis: { dir: 'h', at: 2 } })
    const sec = load('calc-u8-cross-sections').board.calc[0]
    // a square is the default section, so the link leaves it unsaid
    expect(sec).toMatchObject({ kind: 'volume', method: 'section' })
    expect(sec.kind === 'volume' && (sec.section ?? 'square')).toBe('square')
  })

  it('U9: a polar area on the polar ruling; a parametric curve with its marks', () => {
    const p = load('calc-u9-polar-area').board
    expect(p.grid).toBe('polar')
    expect(p.calc[0].kind).toBe('polarbetween')
    expect(load('calc-u9-parametric-cusp').board.calc[0]).toMatchObject({ kind: 'pcalc', t: 1, marks: true })
  })

  it('U10: Taylor polynomials, an interval of convergence, a series with its sums', () => {
    const t = load('calc-u10-taylor-sin').board.calc.map((l) => (l.kind === 'taylor' ? l.n : 0))
    expect(t).toEqual([3, 7])
    expect(load('calc-u10-ln-convergence').board.calc[0]).toMatchObject({ kind: 'taylor', ioc: true })
    const q = load('calc-u10-alternating').board.sequences[0]
    expect(q.series).toBeDefined()
  })

  it('Precalc: the cards read the lines as the families they are', () => {
    const src = (id: string): string => Object.values(load(id).board.exprSources)[0]
    expect(safeReadFactored(src('pc-u1-zeros'))).not.toBeNull()
    expect(safeReadFactored(src('pc-u1-rational'))).not.toBeNull()
    expect(safeReadSinusoid(src('pc-u3-sinusoid'))).not.toBeNull()
    expect(safeReadTransform(src('m3-transformations'))).not.toBeNull()
    expect(safeReadConic(src('m3-circle'))).not.toBeNull()
  })

  it('Precalc: the restricted parabola’s linked inverse; 2ˣ and its exact inverse log₂ x', () => {
    const r = load('pc-u1-inverse-restricted').board
    expect(r.inverses).toHaveLength(1)
    expect(Object.values(r.exprSources)).toContain('y = x')
    const e = load('pc-u2-exp-log').board
    expect(Object.values(e.exprSources)).toEqual(['f(x) = 2^x', 'y = log_2(x)', 'y = x'])
  })

  it('Precalc: a logistic regression linked to its table; the unit circle unwrapping sine', () => {
    const d = load('pc-u2-logistic-regression').board.data[0]
    expect(d.regressions.map((r) => r.kind)).toEqual(['logistic'])
    const uc = load('pc-u3-unit-circle').board
    expect(uc.unitCircles[0].unwrap).toBe('sin')
    expect(uc.axisUnits.x).toBe('pi')
  })

  it('Math 3: a solved inequality with its working; the LP system; the circle’s construction', () => {
    const nl = load('m3-rational-inequality').board
    expect(nl.items[0]).toMatchObject({ kind: 'solve', show: { signs: true, tests: true } })
    const lp = load('m3-linear-programming').board
    expect(lp.system?.objective).toEqual({ src: 'P = 3x + 2y', goal: 'max' })
    const c = load('m3-circle').board
    expect(Object.values(c.curveViews)[0]).toEqual({ construction: true })
  })
})

describe('NC Math 1 and NC Math 2', () => {
  const r3 = (v: number): number => Math.round(v * 1000) / 1000
  /** Where the visible curves meet, rounded and sorted by x. */
  const meets = (id: string): [number, number][] => {
    const { board } = load(id)
    const models = { ...MODELS, ...board.extraModels }
    return boardIntersections(board.curves, models, [-20, 20])
      .map((m): [number, number] => [r3(m.point.pos.x), r3(m.point.pos.y)])
      .sort((a, b) => a[0] - b[0])
  }
  const shapesOf = (id: string) => {
    const { board } = load(id)
    return { board, compiled: compileShapes(board.shapes) }
  }

  it('every NC Math 1 and NC Math 2 help section has an example, and every example is tagged M1 / M2', () => {
    for (const s of HELP_SECTIONS.filter((h) => h.course === 'NC Math 1' || h.course === 'NC Math 2')) {
      expect(examplesForSection(s.id).length, s.id).toBeGreaterThan(0)
    }
    for (const d of EXAMPLE_DEFS) {
      if (d.course === 'math1') expect(d.unit).toBe('M1')
      if (d.course === 'math2') expect(d.unit).toBe('M2')
      if (d.course === 'math1') for (const h of d.help) expect(h.startsWith('m1-'), `${d.id} → ${h}`).toBe(true)
      if (d.course === 'math2') for (const h of d.help) expect(h.startsWith('m2-'), `${d.id} → ${h}`).toBe(true)
    }
    expect(EXAMPLE_DEFS.filter((d) => d.course === 'math1').length).toBeGreaterThanOrEqual(8)
    expect(EXAMPLE_DEFS.filter((d) => d.course === 'math2').length).toBeGreaterThanOrEqual(8)
  })

  it('M1: 3x + 5 adds 3, 2ˣ doubles, and 2ˣ passes 3x + 5 between x = 4 and 5', () => {
    const { board } = load('m1-linear-vs-exponential')
    const [f, g] = board.curves
    expect(board.curveViews[f.id]?.table).toMatchObject({ cols: ['d1'], vs: g.id, fig: true })
    expect(board.curveViews[g.id]?.table).toMatchObject({ cols: ['ratio'] })
    const m = meets('m1-linear-vs-exponential')
    expect(m).toHaveLength(2)
    expect(m[1][0]).toBeGreaterThan(4)
    expect(m[1][0]).toBeLessThan(5)
  })

  it('M1: the sequences are arithmetic (d = 4) and geometric (r = 1.5)', () => {
    const [a, b] = load('m1-sequences').board.sequences
    const terms = (src: string): number[] => {
      const p = readSequence(src)
      if (!p.ok) throw new Error(src)
      return [1, 2, 3, 4, 5].map((n) => p.seq.term(p.seq.defaultParams, n))
    }
    expect(classify(terms(a.src))).toMatchObject({ kind: 'arithmetic', d: 4 })
    expect(classify(terms(b.src))).toMatchObject({ kind: 'geometric', r: 1.5 })
    expect([a.showPartner, b.showPartner]).toEqual([true, true])
  })

  it('M1: −x² + 2x + 8 has its vertex at (1, 9) and its axis x = 1 drawn', () => {
    const { board } = load('m1-quadratic-features')
    const src = Object.values(board.exprSources)
    expect(src).toContain('x = 1')
    const t = readTransform('f(x) = -x^2 + 2x + 8')!
    expect([t.parent, t.a, t.h, t.k]).toEqual(['quadratic', '-1', '1', '9'])
    const f = board.curves[1]
    const y = (x: number): number => ({ ...MODELS, ...board.extraModels })[f.modelId].evalExplicit!(f.params, x)
    expect([y(-2), y(4), y(0), y(1)]).toEqual([0, 0, 8, 9])
  })

  it('M1: the two lines meet at (2, 3); |x − 1| − 2 = 1 at x = −2 and 4', () => {
    expect(meets('m1-system-of-lines')).toEqual([[2, 3]])
    expect(meets('m1-absolute-value')).toEqual([[-2, 1], [4, 1]])
  })

  it('M1: the inequality system shades the overlap, with the test point at the origin', () => {
    const { board } = load('m1-inequality-system')
    expect(board.system).toEqual({ solution: true, test: { x: 0, y: 0 } })
    expect(Object.values(board.exprSources)).toEqual(['y > 2x - 3', 'y <= -x/2 + 2'])
  })

  it('M1: ABCD is a parallelogram by slopes, perimeter 2√26 + 4√5, area 18', () => {
    const { board, compiled } = shapesOf('m1-parallelogram')
    expect(board.shapes[0].measure?.show).toEqual(['lengths', 'slopes', 'area', 'classify'])
    const poly = compiled.get(board.shapes[0].id)!.reports!.poly!
    expect(poly.classification.name).toBe('parallelogram')
    expect(poly.sides.map((s) => s.slope.text)).toEqual(['1/5', '2', '1/5', '2'])
    expect(poly.area.area.value).toBe(18)
    expect(poly.perimeter.value).toBeCloseTo(2 * Math.sqrt(26) + 4 * Math.sqrt(5), 9)
    expect(poly.right).toBeNull()
    expect(poly.pairs.filter((p) => p.rel === 'parallel')).toHaveLength(2)
  })

  it('M1: Period 1 has one outlier (42) and Period 4 none', () => {
    const p = load('m1-box-plots').board.stats[0]
    expect(p.type).toBe('data')
    if (p.type !== 'data') return
    const card = dataPlotCard(p)
    expect(card.sets.map((s) => s.fences?.outliers)).toEqual([['42'], []])
  })

  it('M1: the least squares line has slope ≈ 3.78, r ≈ 0.996, and its residual plot is on', () => {
    const d = load('m1-scatter-residuals').board.data[0]
    expect(d.regressions).toHaveLength(1)
    expect(d.regressions[0]).toMatchObject({ kind: 'linear', residualPlot: true, residuals: false })
    const cols = dataColumns(d.rows)
    const fit = fitRegression('linear', cols.xs, cols.ys)
    expect(fit.ok).toBe(true)
    if (!fit.ok) return
    expect(fit.coef.a).toBeCloseTo(311.5 / 82.5, 9)
    expect(fit.coef.b).toBeCloseTo(76.5 - (311.5 / 82.5) * 5.5, 9)
    expect(fit.r).toBeCloseTo(311.5 / Math.sqrt(82.5 * 1184.5), 9)
    expect(fit.r!).toBeGreaterThan(0.99)
  })

  it('M2: the three forms are one function: zeros 4 and −2, vertex (1, −9); all drawn, no false crossings', () => {
    const { board } = load('m2-quadratic-forms')
    expect(board.curves.map((c) => c.visible)).toEqual([true, true, true])
    const models = { ...MODELS, ...board.extraModels }
    const same = boardMeetings(board.curves, models, [-20, 20]).coincide
    expect(same).toHaveLength(3)
    for (const c of same) expect(c.coincide).toMatchObject({ everywhere: true, exact: true })
    const src = Object.values(board.exprSources)
    const fac = readFactored(src[1])!
    expect(fac.num.map((r) => r.root)).toEqual(['-2', '4'])
    for (const s of src) {
      const t = readTransform(s)!
      expect([t.parent, t.a, t.h, t.k]).toEqual(['quadratic', '1', '1', '-9'])
    }
    expect(meets('m2-quadratic-forms')).toEqual([])
  })

  it('M2: the line meets the parabola at (−1, 0) and (4, 5)', () => {
    expect(meets('m2-line-parabola')).toEqual([[-1, 0], [4, 5]])
  })

  it('M2: the square root starts at (−3, −1); inverse variation has xy = 12 down its table', () => {
    const t = readTransform('f(x) = 2sqrt(x + 3) - 1')!
    expect([t.parent, t.a, t.h, t.k]).toEqual(['sqrt', '2', '-3', '-1'])
    expect(load('m2-square-root').board.curveViews).toMatchObject({ [load('m2-square-root').board.curves[0].id]: { showParent: true } })
    const { board } = load('m2-inverse-variation')
    const f = board.curves[0]
    const ev = { ...MODELS, ...board.extraModels }[f.modelId].evalExplicit!
    const xs = board.curveViews[f.id]!.table!.list!.split(',').map(Number)
    expect(xs).toEqual([1, 2, 3, 4, 6, 12])
    for (const x of xs) expect(x * ev(f.params, x)).toBeCloseTo(12, 12)
  })

  it('M2: −2|x − 3| + 1 is the parent |x| reflected, stretched by 2, right 3 and up 1', () => {
    const src = Object.values(load('m2-function-transformations').board.exprSources)[0]
    const t = readTransform(src)!
    expect([t.parent, t.a, t.b, t.h, t.k]).toEqual(['absolute', '-2', '1', '3', '1'])
  })

  it('M2: a rotation then a reflection compose to the reflection across y = x', () => {
    const { board, compiled } = shapesOf('m2-rotate-reflect')
    expect(board.shapes.map((s) => s.xform?.op.t ?? null)).toEqual([null, 'rotate', 'reflect'])
    const rot = compiled.get(board.shapes[1].id)!
    expect(rot.xform!.rule.text).toBe('(x, y) → (−y, x)')
    const two = compiled.get(board.shapes[2].id)!
    expect(two.xform!.chain!.single).toBe('a reflection across the line y = x')
    const sh = two.shape!
    expect(sh.kind === 'polygon' && sh.pts.map((p) => [r3(p.x), r3(p.y)])).toEqual([[1, 2], [1, 5], [3, 2]])
  })

  it('M2: the dilation by 2 is similar to ABC with scale factor 2, not congruent', () => {
    const { board, compiled } = shapesOf('m2-dilation-similarity')
    const [abc, img] = board.shapes
    expect(abc.compare).toBe(img.id)
    const list = [...compiled.values()].map((c) => ({ id: c.id, shape: c.shape }))
    const card = compareCard(compiled.get(abc.id)!.shape!, abc.id, list, abc.compare)
    const tri = card.result!.triangle!
    expect([tri.similar, tri.congruent]).toEqual([true, false])
    expect(tri.k).toBeCloseTo(2, 12)
  })

  it('M2: the 3-4-5 triangle: right angle at B, sin A = 3/5, cos A = 4/5, tan A = 3/4', () => {
    const { board, compiled } = shapesOf('m2-right-triangle-trig')
    const rt = compiled.get(board.shapes[0].id)!.reports!.poly!.right!
    expect(rt.right).toBe(1)
    const a = rt.trig.find((t) => t.name === 'A')!
    expect([a.sin.value.text, a.cos.value.text, a.tan.value.text]).toEqual(['3/5', '4/5', '3/4'])
    expect(r3(a.angle.deg)).toBe(36.87)
  })

  it('M2: junior and driving are independent; at least one green in two draws is 2/3', () => {
    const [t] = load('m2-two-way-table').board.stats
    expect(t.type === 'prob' && t.view).toBe('table')
    if (t.type !== 'prob') return
    const c = probCard(t)
    expect(c.table.indep?.independent).toBe(true)
    expect(c.table.indep?.conditional).toBe('P(A|B) = 3/5 = 0.60 = P(A) = 3/5 = 0.60')
    const [tr] = load('m2-tree-without-replacement').board.stats
    if (tr.type !== 'prob') throw new Error('not a probability object')
    expect(tr.view).toBe('tree')
    expect(tr.tree.replace).toBe(false)
    const e = probCard(tr).tree.event!
    expect(e.name).toBe('at least one Green')
    expect(e.numbers).toBe('2/15 + 4/15 + 4/15 = 2/3')
    expect(e.complement).toBe('1 − P(YY) = 1 − 1/3 = 2/3')
  })
})

describe('the gallery', () => {
  it('groups by course in order, units in catalog order', () => {
    const g = galleryGroups()
    expect(g.map((x) => x.course)).toEqual(['calc', 'precalc', 'math1', 'math2', 'math3'])
    expect(g[0].units[0].id).toBe('calc-1')
    expect(g[0].units[0].title).toMatch(/^Unit 1 · Limits/)
    expect(g[2].units.map((u) => u.id)).toEqual(['m1-linexp', 'm1-quad', 'm1-systems', 'm1-functions', 'm1-coord', 'm1-stats', 'm1-bivariate'])
    expect(g[3].units.map((u) => u.id)).toEqual(['m2-quad', 'm2-radical', 'm2-functions', 'm2-xform', 'm2-centres', 'm2-trig', 'm2-prob'])
    expect(g[4].units.map((u) => u.id)).toEqual(['m3-ineq', 'm3-functions', 'm3-poly', 'm3-explog', 'm3-geo'])
    expect(g.flatMap((x) => x.units.flatMap((u) => u.examples)).length).toBe(EXAMPLE_DEFS.length)
  })

  it('searches every word across title, unit, course and note', () => {
    const hit = (q: string): string[] => EXAMPLE_DEFS.filter((d) => exampleMatches(d, q)).map((d) => d.id)
    expect(hit('mvt')).toContain('calc-u5-mvt')
    expect(hit('U8 washer')).toEqual(['calc-u8-washers'])
    expect(hit('polar area')).toContain('calc-u9-polar-area')
    expect(hit('linear programming')).toEqual(['m3-linear-programming'])
    expect(hit('')).toHaveLength(EXAMPLE_DEFS.length)
    expect(hit('zzzz')).toEqual([])
    expect(galleryGroups('zzzz')).toEqual([])
  })

  it('the help sheet’s units link to their examples', () => {
    expect(examplesForSection('calc-5').map((d) => d.id)).toEqual(['calc-u5-graph-of-fprime', 'calc-u5-mvt'])
    for (const s of ['calc-1', 'calc-2', 'calc-3', 'calc-4', 'calc-5', 'calc-6', 'calc-7', 'calc-8', 'calc-9', 'calc-10', 'pc-1', 'pc-2', 'pc-3']) {
      expect(examplesForSection(s).length, s).toBeGreaterThan(0)
    }
  })

  it('a second copy of the same example takes the next number', () => {
    const def = exampleById('calc-u5-graph-of-fprime')!
    expect(exampleCopyName(def, [])).toBe('Example: U5 — graph of f′')
    expect(exampleCopyName(def, ['Example: U5 — graph of f′'])).toBe('Example: U5 — graph of f′ (2)')
    expect(exampleCopyName(def, ['example: u5 — graph of f′', 'Example: U5 — graph of f′ (2)'])).toBe(
      'Example: U5 — graph of f′ (3)',
    )
  })
})

describe('the teacher note in a document', () => {
  const meta: DocMeta = { id: 'dn', name: 'Note', createdAt: 1, modifiedAt: 1 }
  const base = (): BoardInput => ({
    curves: [],
    styles: {},
    candidates: new Map(),
    exprSources: {},
    viewport: { center: { x: 0, y: 0 }, pxPerUnit: 60 },
    selectedId: null,
    mode: 'draw',
  })

  it('is written only when there is one: a document without one is byte-identical', () => {
    const without = serializeDoc(docFromBoard(meta, base(), 2))
    expect(without).not.toContain('"note"')
    expect(serializeDoc(docFromBoard(meta, { ...base(), note: '   ' }, 2))).toBe(without)
    // the heavy classroom document, load → save: still no note, same bytes
    const heavy = heavyJSON()
    expect(heavy).not.toContain('"note"')
    expect(deserializeDoc(heavy).board?.note).toBeUndefined()
  })

  it('comes back as written, trimmed and capped', () => {
    const json = serializeDoc(docFromBoard(meta, { ...base(), note: '  Ask why.  ' }, 2))
    expect(json.endsWith('"note":"Ask why."}}')).toBe(true)
    expect(deserializeDoc(json).board?.note).toBe('Ask why.')
    const long = serializeDoc(docFromBoard(meta, { ...base(), note: 'x'.repeat(5000) }, 2))
    expect(deserializeDoc(long).board?.note?.length).toBe(MAX_NOTE_CHARS)
  })

  it('a note that is not text is reported, not silently kept', () => {
    const raw = JSON.parse(serializeDoc(docFromBoard(meta, base(), 2)))
    raw.board.note = { evil: true }
    const res = deserializeDoc(JSON.stringify(raw))
    expect(res.board?.note).toBeUndefined()
    expect(res.problems.join(' ')).toMatch(/teacher note/)
  })

  it('a builder refuses what the App would refuse', () => {
    const b = new ExampleBoard()
    expect(() => b.line('y = (x')).toThrow(/does not parse/)
    const f = b.line('f(x) = x^2')
    expect(() => b.line('f(x) = x^3')).toThrow(/letter f/)
    expect(() => b.line('g(x) = f(x) + 1')).toThrow(/calls f/)
    expect(() => b.paramCalc(f, 1)).toThrow(/parametric or polar/)
    expect(() => new ExampleBoard('number-line').line('y = x')).toThrow(/graph/)
    expect(() => b.solve('x > 1')).toThrow(/number line/)
  })
})

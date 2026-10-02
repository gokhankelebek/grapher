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
            (sc.relatedRates?.length ?? 0)
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

describe('the gallery', () => {
  it('groups by course in order, units in catalog order', () => {
    const g = galleryGroups()
    expect(g.map((x) => x.course)).toEqual(['calc', 'precalc', 'math3'])
    expect(g[0].units[0].id).toBe('calc-1')
    expect(g[0].units[0].title).toMatch(/^Unit 1 · Limits/)
    expect(g[2].units.map((u) => u.id)).toEqual(['m3-ineq', 'm3-functions', 'm3-geo'])
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

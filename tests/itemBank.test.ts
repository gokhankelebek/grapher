// ============================================================================
// tests/itemBank.test.ts — the AP item-bank bridge (src/ui/itemBank.ts).
//
//   Grapher → bank   the block's exact header lines; the figuredesc is the
//                    STUDENT description whichever version is copied; house
//                    style forces mono ink and tells curves apart by dash; the
//                    student figure has no answer chips but a labelled point.
//   bank → Grapher   realistic stems (a cases piecewise, "the graph of f′ is
//                    shown", a given g′, a polar curve, a slope field, a
//                    parametric pair, a domain hint, a figure=needed record)
//                    open as the documents a teacher would have built by hand.
// ============================================================================

import { describe, expect, it } from 'vitest'
import { ExampleBoard } from '../src/examples/builder'
import { serializeDoc } from '../src/core/persist'
import type { FigureStyleId } from '../src/core/types'
import type { DocModel } from '../src/ui/docScene'
import { docModelFromJSON } from '../src/ui/docScene'
import { describeCurves } from '../src/core/describeAdapters'
import {
  ADDED_POINT_ID,
  DEFAULT_BANK_OPTIONS,
  HOUSE_DASHES,
  bankFigure,
  buildItemDoc,
  describeInputOf,
  figureHasLabelledPoint,
  houseStyleId,
  itemDocName,
  planItem,
  readItemRecord,
} from '../src/ui/itemBank'
import { pgfDash } from '../src/ui/pgfplotsExport'

function model(name: string, build: (b: ExampleBoard) => void): DocModel {
  const b = new ExampleBoard()
  build(b)
  const m = docModelFromJSON(serializeDoc(b.toDoc(`doc-${name}`, name)))
  if (!m) throw new Error(`${name} did not load`)
  return m
}

const cubic = (style: FigureStyleId = 'screen'): DocModel =>
  model('Cubic', (b) => {
    b.frame([-3, 3], [-4, 4])
    b.line('f(x) = x^3 - 3x')
    b.figure(style)
  })

const STUDENT = DEFAULT_BANK_OPTIONS

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

describe('readItemRecord', () => {
  it('reads the id, the fields and a free-text figuredesc', () => {
    const r = readItemRecord(
      [
        '%%% ITEM AB-0044',
        '%%% status=captured secure=true',
        '%%% source=apclassroom year=2025 unit=5 topic=graph-analysis',
        '%%% type=mcq calc=no dok=3',
        '%%% figure=described',
        '%%% figuredesc=Graph of f′ on [−3, 4]; x = 2 is a zero.',
        '\\begin{stem} … \\end{stem}',
        '%%% END',
      ].join('\n'),
    )
    expect(r.id).toBe('AB-0044')
    expect(r.isRecord).toBe(true)
    expect(r.figure).toBe('described')
    expect(r.figuredesc).toBe('Graph of f′ on [−3, 4]; x = 2 is a zero.')
    expect(r.fields).toMatchObject({ status: 'captured', secure: 'true', unit: '5', calc: 'no', dok: '3' })
  })

  it('reads back the quoted figuredesc a block writes (bank.py needs the quotes)', () => {
    const b = bankFigure(cubic(), STUDENT)
    const r = readItemRecord(`%%% ITEM AB-0001\n${b.descriptionBlock}%%% END`)
    expect(r.figure).toBe('described')
    expect(r.figuredesc).toBe(b.figuredesc)
    // bank.py's KV_RE: (\w+)=("[^"]*"|\S+) — the whole description is one value
    const kv = [...b.descriptionBlock.split('\n')[1].replace(/^%%%\s+/, '').matchAll(/(\w+)=("[^"]*"|\S+)/g)]
    expect(kv.map((m) => [m[1], m[2].replace(/^"|"$/g, '')])).toEqual([['figuredesc', b.figuredesc]])
  })

  it('a bare stem is not a record', () => {
    const r = readItemRecord('Let $f(x) = x^2$.')
    expect(r).toMatchObject({ id: null, isRecord: false, figure: null, figuredesc: null })
  })
})

// ---------------------------------------------------------------------------
// Grapher → bank: the block
// ---------------------------------------------------------------------------

describe('the block', () => {
  const m = cubic()
  const tikz = bankFigure(m, STUDENT)
  const lines = tikz.block.trimEnd().split('\n')

  it('starts with exactly the header lines', () => {
    expect(lines[0]).toBe('%%% figure=tikz')
    expect(lines[1]).toBe(`%%% figuredesc="${tikz.figuredesc}"`)
    expect(lines[2]).toBe('% Grapher figure "Cubic" — preamble: \\usepackage{tikz}')
    expect(lines[3]).toBe('\\begin{center}')
    expect(lines[4]).toMatch(/^\\begin\{tikzpicture\}/)
    expect(lines.at(-2)).toBe('\\end{tikzpicture}')
    expect(lines.at(-1)).toBe('\\end{center}')
    // the picture's own comment header is gone: nothing but the block's own % lines
    expect(lines.slice(3).filter((l) => /^\s*%/.test(l))).toEqual([])
  })

  it('the figuredesc is one line, the student description, at most 300 characters', () => {
    expect(tikz.figuredesc).not.toMatch(/\n/)
    expect(tikz.figuredesc.length).toBeLessThanOrEqual(300)
    expect(tikz.figuredesc).toMatch(/^Graph of f on /)
    // no answers: no zeros, extrema or equation
    expect(tikz.figuredesc).not.toMatch(/√3|relative|x³|zero/)
    const scene = tikz.scene
    const direct = describeCurves(describeInputOf(m, scene, tikz.added), { answers: false })
    expect(tikz.figuredesc).toBe(direct.figuredesc)
  })

  it('the key figure carries the same (student) figuredesc', () => {
    const key = bankFigure(m, { ...STUDENT, answers: true })
    expect(key.figuredesc).toBe(tikz.figuredesc)
    expect(key.block.split('\n')[1]).toBe(`%%% figuredesc="${tikz.figuredesc}"`)
    expect(key.block).not.toBe(tikz.block)
  })

  it('pgfplots names its preamble in the comment line', () => {
    const p = bankFigure(m, { ...STUDENT, format: 'pgfplots' })
    const pl = p.block.split('\n')
    expect(pl[0]).toBe('%%% figure=tikz')
    expect(pl[2]).toBe(
      '% Grapher figure "Cubic" — preamble: \\usepackage{tikz} (pgfplots: \\usepackage{pgfplots} \\pgfplotsset{compat=1.18})',
    )
    expect(p.block).toContain('\\begin{axis}')
    expect(p.block).toContain('{x^3 - 3*x}')
    expect(p.preamble).toEqual(['\\usepackage{pgfplots}', '\\pgfplotsset{compat=1.18}'])
  })

  it('"Copy description only" is the figure=described form of the same text', () => {
    expect(tikz.descriptionBlock).toBe(`%%% figure=described\n%%% figuredesc="${tikz.figuredesc}"\n`)
  })

  it('the width is the stated width', () => {
    const w = (o: typeof STUDENT): number => {
      const box = /\\useasboundingbox \(0,0\) rectangle \(([\d.]+),/.exec(bankFigure(m, o).block)
      return Number(box?.[1]) / (72 / 2.54)
    }
    expect(w(STUDENT)).toBeCloseTo(7, 1)
    expect(w({ ...STUDENT, widthCm: 10 })).toBeCloseTo(10, 1)
  })
})

// ---------------------------------------------------------------------------
// House style
// ---------------------------------------------------------------------------

describe('house style', () => {
  const three = model('Three', (b) => {
    b.frame([-4, 4], [-4, 4])
    b.line('f(x) = x^2 - 2')
    b.line('g(x) = x + 1')
    b.line('h(x) = 2 - x^2 / 4')
    b.figure('textbook')
  })

  it('draws in a mono style with named axes, whatever the document chose', () => {
    expect(houseStyleId('screen')).toBe('ap')
    expect(houseStyleId('ap')).toBe('ap')
    expect(houseStyleId('textbook')).toBe('textbook')
    const r = bankFigure(three, STUDENT)
    expect(r.style).toBe('textbook')
    expect(r.scene.figure?.curveInk).toBe('mono')
    expect(r.scene.figure?.axisNames).toBe(true)
    expect(bankFigure(cubic('screen'), STUDENT).scene.figure?.id).toBe('ap')
  })

  it('tells the curves apart by dash: solid, dashed, dotted', () => {
    const r = bankFigure(three, STUDENT)
    const dashes = r.scene.curves.map((c) => r.scene.styles[c.id]?.dash ?? [])
    expect(dashes).toEqual([HOUSE_DASHES[0], HOUSE_DASHES[1], HOUSE_DASHES[2]].map((d) => d.slice()))
    const pgf = bankFigure(three, { ...STUDENT, format: 'pgfplots' }).block
    expect(pgf).toMatch(/\\addplot\[black, thick, (?!dashed|dotted)[^\]]*\] \{x\^2 - 2\}/)
    expect(pgf).toMatch(/\\addplot\[black, thick, dashed[^\]]*\] \{x \+ 1\}/)
    expect(pgf).toMatch(/\\addplot\[black, thick, dotted[^\]]*\] \{2 - x\^2\/4\}/)
  })

  it('a curve the teacher dashed keeps its dash, and nobody else gets it', () => {
    const m = model('Dashed', (b) => {
      b.frame([-4, 4], [-4, 4])
      b.line('f(x) = x^2 - 2', { dash: [8, 6] })
      b.line('g(x) = x + 1')
    })
    const r = bankFigure(m, STUDENT)
    const [f, g] = r.scene.curves
    expect(r.scene.styles[f.id]?.dash).toEqual([8, 6])
    expect(r.scene.styles[g.id]?.dash).toBeUndefined()
  })

  it('every color in the TikZ is a gray', () => {
    const tex = bankFigure(three, { ...STUDENT, answers: true }).block
    const colours = [...tex.matchAll(/\\definecolor\{[^}]+\}\{HTML\}\{([0-9A-F]{6})\}/g)].map((m) => m[1])
    expect(colours.length).toBeGreaterThan(0)
    for (const c of colours) expect(c.slice(0, 2) === c.slice(2, 4) && c.slice(2, 4) === c.slice(4, 6), c).toBe(true)
    // …and without house style the palette is back
    const plain = bankFigure(three, { ...STUDENT, house: false }).block
    const coloured = [...plain.matchAll(/\\definecolor\{[^}]+\}\{HTML\}\{([0-9A-F]{6})\}/g)].map((m) => m[1])
    expect(coloured.some((c) => !(c.slice(0, 2) === c.slice(2, 4) && c.slice(2, 4) === c.slice(4, 6)))).toBe(true)
  })

  it('pgfplots keeps the dash presets apart', () => {
    expect(pgfDash([8, 6])).toBe('dashed')
    expect(pgfDash([2, 5])).toBe('dotted')
    expect(pgfDash([10, 4, 2, 4])).toBe('dash dot')
  })
})

// ---------------------------------------------------------------------------
// The student figure: no answers, one labelled point
// ---------------------------------------------------------------------------

describe('the student figure', () => {
  it('has no answer chips, and labels one neutral point', () => {
    const r = bankFigure(cubic(), STUDENT)
    const s = r.scene
    expect(s.analysis).toBeNull()
    expect(s.intersections).toBeUndefined()
    expect(s.answerKey).toBeUndefined()
    expect((s.overlays ?? []).some((o) => o.kind === 'label' && o.answer)).toBe(false)
    expect(figureHasLabelledPoint(s)).toBe(true)
    // the origin is a zero and the inflection point, ±1 are extrema: (2, 2) gives nothing away
    expect(r.added).toMatchObject({ x: 2, y: 2, label: '(2, 2)', curveName: 'f' })
    expect(r.notes.join(' ')).toContain('(2, 2) is labeled')
    expect(r.block).toContain('$(2, 2)$')
    expect(r.figuredesc).toContain('labeled point (2, 2)')
  })

  it('prefers a y-intercept that is not an answer', () => {
    const m = model('Line', (b) => {
      b.frame([-4, 4], [-4, 4])
      b.line('f(x) = x^2 - 3x + 2')
    })
    expect(bankFigure(m, STUDENT).added).toMatchObject({ x: 0, y: 2, why: 'the y-intercept of f' })
  })

  it('adds nothing when the document labels a point of its own', () => {
    const m = model('Labeled', (b) => {
      b.frame([-3, 3], [-4, 4])
      b.line('f(x) = x^3 - 3x')
      b.shape('A = (2, 2)')
    })
    const r = bankFigure(m, STUDENT)
    expect(r.added).toBeNull()
    expect(r.labelled).toBe(true)
    expect(r.scene.shapes?.some((sh) => sh.id === ADDED_POINT_ID)).toBe(false)
  })

  it('house style off adds nothing', () => {
    const r = bankFigure(cubic(), { ...STUDENT, house: false })
    expect(r.added).toBeNull()
    expect(r.scene.figure).toBeUndefined()
  })

  it('the key figure has the answers, and the same labeled point', () => {
    const r = bankFigure(cubic(), { ...STUDENT, answers: true })
    expect(r.scene.analysis?.points.length).toBeGreaterThan(0)
    expect(r.scene.shapes?.some((sh) => sh.id === ADDED_POINT_ID)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// bank → Grapher
// ---------------------------------------------------------------------------

function graphed(src: string, follow = true): { m: DocModel; built: ReturnType<typeof buildItemDoc>; plan: ReturnType<typeof planItem> } {
  const plan = planItem(src, { followGraphOf: follow })
  const built = buildItemDoc(plan, plan.baseName)
  const m = docModelFromJSON(built.json)
  if (!m) throw new Error('the item document did not load')
  expect(m.problems).toEqual([])
  expect(built.problems).toEqual([])
  return { m, built, plan }
}

const evalAt = (m: DocModel, curveIndex: number, x: number): number => {
  const c = m.board.curves[curveIndex]
  return m.models[c.modelId].evalExplicit!(c.params, x)
}

const AB0044 = [
  '%%% ITEM AB-0044',
  '%%% status=captured secure=true',
  '%%% source=apclassroom year=2025 unit=5 topic=graph-analysis',
  '%%% skills=AN.2.1',
  '%%% type=mcq calc=no dok=3',
  '%%% figure=needed',
  '%%% answer=D',
  '%%% added=2026-07-31',
  "\\begin{stem} The graph of $f'$, the derivative of $f$, is shown above for $-3 \\le x \\le 4$, where",
  '$f(x) = x^3 - 3x$. At which value of $x$ does $f$ attain a relative maximum? \\end{stem}',
  '%%% END',
].join('\n')

describe('Graph from item', () => {
  it('a cases piecewise', () => {
    const { m, plan } = graphed(
      "\\begin{stem} Let $f$ be the function defined by $f(x)=\\begin{cases} x^2+1 & x<1 \\\\ 3-x & x\\ge 1\\end{cases}$. Is $f$ continuous at $x=1$? \\end{stem}",
    )
    expect(plan.baseName).toBe('Item figure')
    expect(m.board.curves).toHaveLength(1)
    expect(m.sources[m.board.curves[0].id]).toBe('f(x) = { x^2 + 1 if x < 1 ; 3 - x if x >= 1 }')
    expect(evalAt(m, 0, 0)).toBe(1)
    expect(evalAt(m, 0, 2)).toBe(1)
    expect(m.board.figure).toBe('ap')
  })

  it('"the graph of f′ is shown" with only f defined: f′ via the derivative link, f hidden', () => {
    const { m, built, plan } = graphed(AB0044)
    expect(plan.baseName).toBe('AB-0044')
    expect(plan.needsFigure).toBe(true)
    expect(plan.graphOf).toBe('f′')
    expect(plan.notes[0]).toContain('only f is defined — graphing f′')
    const [f, fp] = m.board.curves
    expect(f.visible).toBe(false)
    expect(fp.visible).toBe(true)
    expect(m.board.calc.some((l) => l.kind === 'derivative' && l.parentId === f.id && l.curveId === fp.id)).toBe(true)
    expect(evalAt(m, 1, 2)).toBeCloseTo(9, 6) // 3x² − 3
    expect(m.board.caption).toBe('Graph of f′')
    expect(m.board.figure).toBe('ap')
    // framed to the interval, with the axes in view
    expect(built.window.x[0]).toBeLessThan(-3)
    expect(built.window.x[1]).toBeGreaterThan(4)
    expect(built.window.x[1] - built.window.x[0]).toBeLessThan(9)
    expect(built.window.y![0]).toBeLessThan(-3)
    expect(built.window.y![1]).toBeGreaterThanOrEqual(45)
    expect(built.window.independent).toBe(true)
    // the bank figure of it is described as f′, not as a letter of its own
    const r = bankFigure(m, STUDENT)
    expect(r.figuredesc).toMatch(/^Graph of f′ on /)
  })

  it('…or graphs f as written when the teacher says no', () => {
    const { m, plan } = graphed(AB0044, false)
    expect(plan.derive).toBeNull()
    expect(m.board.curves).toHaveLength(1)
    expect(m.board.curves[0].visible).toBe(true)
    expect(m.board.caption).toBe('')
  })

  it('a given g′ is graphed as it stands, restricted to its domain', () => {
    const { m, plan } = graphed("The graph of $g'$ is shown above. $g'(x) = \\sin x$ for $0 \\le x \\le 2\\pi$.")
    expect(plan.derive).toBeNull()
    expect(m.board.curves).toHaveLength(1)
    const c = m.board.curves[0]
    expect(c.domain?.[0]).toBeCloseTo(0, 9)
    expect(c.domain?.[1]).toBeCloseTo(2 * Math.PI, 9)
    expect(evalAt(m, 0, Math.PI / 2)).toBeCloseTo(1, 9)
    expect(m.board.caption).toBe('Graph of g′')
  })

  it('a polar curve, framed whole', () => {
    const { m, built } = graphed('The polar curve $r = 2 + \\cos\\theta$ for $0\\le\\theta\\le 2\\pi$ is shown.')
    expect(m.board.curves[0].kind).toBe('polar')
    expect(built.window.x[0]).toBeLessThan(-1)
    expect(built.window.x[1]).toBeGreaterThan(3)
    expect(built.window.y![0]).toBeLessThan(-2)
    expect(built.window.y![1]).toBeGreaterThan(2)
    expect(built.window.independent).toBeUndefined()
  })

  it('a slope field', () => {
    const { m } = graphed('Consider the differential equation $\\frac{dy}{dx} = x - y$. On the axes provided, sketch a slope field.')
    expect(m.board.curves).toHaveLength(0)
    expect(m.board.fields).toHaveLength(1)
    expect(m.board.fields[0].src).toBe('dy/dx = x - y')
  })

  it('a parametric pair takes the stem’s interval as its t-range', () => {
    const { m, plan } = graphed('A particle moves with $x(t) = t^2 - 1$ and $y(t) = 2t$ for $0 \\le t \\le 3$.')
    expect(plan.lines[0].def.typed).toBe('(x, y) = (t^2 - 1, 2t) {0 <= t <= 3}')
    const c = m.board.curves[0]
    expect(c.kind).toBe('parametric')
    expect(c.domain).toEqual([0, 3])
  })

  it('a domain hint becomes a restriction', () => {
    const { m, plan } = graphed('Let $h(x) = \\sqrt{x}\\ln x$ for $x > 0$.')
    expect(plan.lines[0].def.restriction).toBe('x > 0')
    expect(m.sources[m.board.curves[0].id]).toBe('h(x) = sqrt(x)ln(x) {x > 0}')
    expect(evalAt(m, 0, 1)).toBe(0)
  })

  it('a record with nothing to graph says so, and still says it needs a figure', () => {
    const plan = planItem('%%% ITEM BC-0101\n%%% figure=needed\n\\begin{stem} Which of the following is true? \\end{stem}')
    expect(plan.empty).toBe(true)
    expect(plan.needsFigure).toBe(true)
    expect(plan.baseName).toBe('BC-0101')
  })

  it('names a second copy of the same item (2)', () => {
    expect(itemDocName('AB-0044', ['Cubic'])).toBe('AB-0044')
    expect(itemDocName('AB-0044', ['ab-0044', 'AB-0044 (2)'])).toBe('AB-0044 (3)')
  })
})

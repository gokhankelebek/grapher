// ============================================================================
// tests/worksheet.test.ts — the worksheet builder.
//
//   persistence     validation, repair, round trip, storage beside documents
//   docScene        a stored document's export scene, rebuilt with no App:
//                   typed lines, a sketched family, calculus links (derivative,
//                   area, Taylor), inverse relations
//   layout          cell rectangles for 1/2/3 columns, letter vs A4, pages
//   PDF             multi-page structure: xref offsets, /Count, page objects
//   LaTeX           balanced braces, (a)(b)(c), no control characters, one
//                   tikzpicture per figure; the pgfplots variant
//   answer key      analysis markers present / absent in the display lists
// ============================================================================

import { afterEach, describe, expect, it } from 'vitest'
import { parseExpression } from '../src/core/parse'
import { MODELS } from '../src/core/fit/models'
import { derivativeModel } from '../src/core/calculus'
import type { FittedCurve } from '../src/core/types'
import type { BoardInput, CalcLink, DocMeta, InverseLink, Worksheet } from '../src/core/persist'
import {
  MAX_SHEET_ITEMS,
  deserializeWorksheets,
  docFromBoard,
  newWorksheet,
  serializeDoc,
  serializeWorksheets,
  storedToWorksheet,
} from '../src/core/persist'
import { docFigure, docModelFromJSON, recordFigure, unplacedAnswers } from '../src/ui/docScene'
import { answerLabel } from '../src/ui/renderBoard'
import { toScreen } from '../src/core/types'
import type { DocModel } from '../src/ui/docScene'
import { autoLabel, cellWidth, layoutSheet, pageSize, SHEET_MARGIN_PT, GUTTER_PT } from '../src/ui/worksheetLayout'
import { buildSheet, sheetLatex, sheetPdf } from '../src/ui/worksheetExport'
import { toPdfPagesString } from '../src/render/vectorPdf'
import type { DisplayList, TextItem } from '../src/render/vectorCtx'
import { placeList, emptyPage } from '../src/render/vectorPage'
import { listWorksheets, removeWorksheet, writeDoc, writeWorksheet } from '../src/ui/storage'
import { newRelatedRates } from '../src/ui/relatedRatesLinks'

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function typed(id: string, src: string, modelId: string, color = '#4f9cf9'): FittedCurve {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(`fixture failed to parse: ${src}`)
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

function docJSON(id: string, name: string, b: BoardInput): string {
  const meta: DocMeta = { id, name, createdAt: 1, modifiedAt: 1 }
  return serializeDoc(docFromBoard(meta, b, 2))
}

/** y = x² − 3, typed and selected. */
const PARABOLA = (): string => {
  const c = typed('e1', 'y = x^2 - 3', 'expr_1')
  return docJSON('dParab', 'Parabola', input({ curves: [c], exprSources: { e1: 'y = x^2 - 3' }, selectedId: 'e1' }))
}
const SINE = (): string => {
  const c = typed('e1', 'y = sin(x)', 'expr_1', '#f59e0b')
  return docJSON('dSine', 'Sine', input({ curves: [c], exprSources: { e1: 'y = sin(x)' }, selectedId: 'e1' }))
}
const RATIONAL = (): string => {
  const c = typed('e1', 'y = 1/(x - 2)', 'expr_1', '#a78bfa')
  return docJSON('dRat', 'Rational', input({ curves: [c], exprSources: { e1: 'y = 1/(x - 2)' }, selectedId: 'e1' }))
}

/** A sketched parabola: a library family with its ink, no typed source. */
const SKETCH = (): string => {
  const stroke = Array.from({ length: 30 }, (_, i) => {
    const x = -2 + (4 * i) / 29
    return { x, y: 0.5 * x * x - 1 }
  })
  const c: FittedCurve = {
    id: 's1',
    modelId: 'poly2',
    params: [-1, 0, 0.5],
    kind: 'explicit',
    domain: [-2, 2],
    color: '#22c55e',
    strokeWidth: 2.5,
    visible: true,
    error: 0.01,
    sourceStroke: stroke,
  }
  return docJSON('dSketch', 'Sketch', input({ curves: [c], selectedId: 's1' }))
}

/** f(x) = x³ − 3x typed, with f′ (derivative link), ∫₀² f (area) and P₃ about 0 of sin. */
const CALC = (): string => {
  const f = typed('f', 'y = x^3 - 3x', 'expr_1')
  const d = derivativeModel(f, { ...MODELS, expr_1: parseOk('y = x^3 - 3x').makeModel('expr_1') }, 'dfdx_1')!
  const deriv: FittedCurve = {
    id: 'd',
    modelId: d.spec.id,
    params: d.params.slice(),
    kind: 'explicit',
    domain: d.domain,
    color: '#ef4444',
    strokeWidth: 2.5,
    visible: true,
    error: 0,
  }
  const s = typed('s', 'y = sin(x)', 'expr_2', '#0ea5e9')
  const p: FittedCurve = { ...s, id: 'p', modelId: 'tay_T', params: [], color: '#f59e0b' }
  const links: CalcLink[] = [
    { kind: 'derivative', id: 'L1', parentId: 'f', curveId: 'd' },
    { kind: 'area', id: 'L2', parentId: 'f', from: 0, to: 1, abs: false },
    { kind: 'taylor', id: 'T', parentId: 's', curveId: 'p', a: 0, n: 3 },
  ]
  return docJSON(
    'dCalc',
    'Calculus',
    input({
      curves: [f, deriv, s, p],
      exprSources: { f: 'y = x^3 - 3x', s: 'y = sin(x)' },
      calc: links,
      selectedId: 'f',
    }),
  )
}

function parseOk(src: string) {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(src)
  return o.plot
}

const texts = (l: DisplayList): string[] => l.items.filter((i): i is TextItem => i.t === 'text').map((i) => i.text)

function models(): Map<string, DocModel> {
  const m = new Map<string, DocModel>()
  for (const json of [PARABOLA(), SINE(), RATIONAL()]) {
    const model = docModelFromJSON(json)!
    m.set(model.id, model)
  }
  return m
}

function sheetOf(over: Partial<Worksheet> = {}): Worksheet {
  return {
    ...newWorksheet('Quiz 3', 100),
    id: 'ws1',
    title: 'Quiz 3 — Graphs {of} f & g',
    items: [
      { docId: 'dParab', caption: 'y = x² − 3' },
      { docId: 'dSine', caption: 'One period' },
      { docId: 'dRat' },
    ],
    style: 'sat',
    ...over,
  }
}

// ---------------------------------------------------------------------------
// persistence
// ---------------------------------------------------------------------------

describe('worksheet persistence', () => {
  it('round-trips every field exactly', () => {
    const s = sheetOf({ showAnswers: true, numbering: '1', cols: 3, page: 'a4', orientation: 'landscape', nameLine: false })
    s.items[0].label = '7.'
    s.items[1].style = 'ap'
    const back = deserializeWorksheets(serializeWorksheets([s]))
    expect(back.problems).toEqual([])
    expect(back.sheets).toEqual([s])
  })

  it('repairs bad fields instead of refusing the sheet', () => {
    const w = storedToWorksheet({
      id: 'x',
      name: 'Bad\u0007 name\n',
      page: 'tabloid',
      orientation: 'sideways',
      cols: 7,
      numbering: 'roman',
      style: 'neon',
      showAnswers: 'yes',
      items: [
        { docId: 'a', caption: 'line\u0000one\ttwo', style: 'ap', label: '   ' },
        { docId: '' },
        { nope: 1 },
        'junk',
        { docId: 'b', style: 'weird' },
      ],
      createdAt: -5,
      modifiedAt: 'soon',
    })!
    expect(w.name).toBe('Bad name')
    expect(w.page).toBe('letter')
    expect(w.orientation).toBe('portrait')
    expect(w.cols).toBe(2)
    expect(w.numbering).toBe('a')
    expect(w.style).toBe('textbook')
    expect(w.showAnswers).toBe(false)
    expect(w.items).toEqual([{ docId: 'a', caption: 'line one two', style: 'ap' }, { docId: 'b' }])
    expect(w.createdAt).toBe(0)
    expect(w.modifiedAt).toBe(0)
  })

  it('rejects what is not a worksheet, caps the item count, and never throws', () => {
    expect(storedToWorksheet(null)).toBeNull()
    expect(storedToWorksheet({ name: 'no id' })).toBeNull()
    const many = storedToWorksheet({ id: 'm', items: Array.from({ length: 500 }, (_, i) => ({ docId: `d${i}` })) })!
    expect(many.items.length).toBe(MAX_SHEET_ITEMS)
    expect(deserializeWorksheets('{oops').sheets).toEqual([])
    expect(deserializeWorksheets('{oops').problems.length).toBe(1)
    expect(deserializeWorksheets(null)).toEqual({ sheets: [], problems: [] })
    expect(deserializeWorksheets('{"sheets": 3}').sheets).toEqual([])
  })

  it('skips an unreadable sheet, keeps the first of a duplicate id, notes a newer version', () => {
    const a = sheetOf()
    const json = JSON.stringify({ version: 99, sheets: [a, { junk: true }, { ...a, name: 'dupe' }] })
    const res = deserializeWorksheets(json)
    expect(res.sheets.map((s) => s.name)).toEqual(['Quiz 3'])
    expect(res.problems.some((p) => /newer version/.test(p))).toBe(true)
    expect(res.problems.some((p) => /unreadable worksheet/.test(p))).toBe(true)
  })

  describe('storage', () => {
    const map = new Map<string, string>()
    const stub = (): void => {
      map.clear()
      ;(globalThis as { localStorage?: unknown }).localStorage = {
        getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
        setItem: (k: string, v: string) => void map.set(k, String(v)),
        removeItem: (k: string) => void map.delete(k),
        clear: () => map.clear(),
        key: (i: number) => [...map.keys()][i] ?? null,
        get length() {
          return map.size
        },
      }
    }
    afterEach(() => {
      delete (globalThis as { localStorage?: unknown }).localStorage
    })

    it('lives under its own key, beside the documents, which it never touches', () => {
      stub()
      const json = PARABOLA()
      writeDoc(JSON.parse(json))
      const before = new Map(map)
      const s = sheetOf()
      expect(writeWorksheet(s).ok).toBe(true)
      expect(listWorksheets()).toEqual([s])
      // every key that existed is byte-identical; exactly one key was added
      for (const [k, v] of before) expect(map.get(k)).toBe(v)
      expect([...map.keys()].filter((k) => !before.has(k))).toEqual(['grapher.v1.worksheets'])
      const s2 = { ...sheetOf(), id: 'ws2', name: 'Second', modifiedAt: 500 }
      writeWorksheet(s2)
      expect(listWorksheets().map((w) => w.id)).toEqual(['ws2', 'ws1'])
      writeWorksheet({ ...s, name: 'Renamed', modifiedAt: 900 })
      expect(listWorksheets().map((w) => w.name)).toEqual(['Renamed', 'Second'])
      removeWorksheet('ws1')
      expect(listWorksheets().map((w) => w.id)).toEqual(['ws2'])
      for (const [k, v] of before) expect(map.get(k)).toBe(v)
    })
  })
})

// ---------------------------------------------------------------------------
// scene from a stored document
// ---------------------------------------------------------------------------

describe('scene from a stored document', () => {
  it('rebuilds a typed line’s model and draws it', () => {
    const m = docModelFromJSON(PARABOLA())!
    expect(m.name).toBe('Parabola')
    expect(m.omitted).toEqual([])
    const spec = m.models.expr_1
    expect(spec.evalExplicit!(m.board.curves[0].params, 2)).toBeCloseTo(1, 12)
    const f = docFigure(m, { style: 'textbook', answers: false, widthCm: 8 })
    expect(f.scene.curves.map((c) => c.id)).toEqual(['e1'])
    expect(f.scene.figure?.id).toBe('textbook')
    expect(f.scene.theme.bg.toLowerCase()).toMatch(/^#fff(fff)?$/)
    // laid out at 8 cm: CSS px = 8 · 96 / 2.54, margins included
    const list = recordFigure(f)
    expect(list.width).toBeCloseTo((8 * 96) / 2.54, 0)
    expect(list.items.some((i) => i.t === 'path' && i.segs.length > 20)).toBe(true)
  })

  it('draws a sketched library family from its params', () => {
    const m = docModelFromJSON(SKETCH())!
    expect(m.board.curves[0].modelId).toBe('poly2')
    expect(m.models.poly2).toBe(MODELS.poly2)
    const f = docFigure(m, { style: 'sat', answers: true, widthCm: 6 })
    expect(f.scene.curves).toHaveLength(1)
    expect(f.scene.analysis?.curve.id).toBe('s1')
    // y = 0.5x² − 1: the vertex (0, −1) is among the analysis points
    expect(f.scene.analysis!.points.some((p) => p.kind === 'minimum' && Math.abs(p.pos.y + 1) < 1e-6)).toBe(true)
  })

  it('rebuilds calculus links: derivative and Taylor models, and the area overlay', () => {
    const m = docModelFromJSON(CALC())!
    expect(m.models.dfdx_1.evalExplicit!(m.board.curves.find((c) => c.id === 'd')!.params, 2)).toBeCloseTo(9, 6)
    // P₃ of sin about 0 is x − x³/6
    const p = m.board.curves.find((c) => c.id === 'p')!
    expect(p.modelId).toBe('tay_T')
    expect(m.models.tay_T.evalExplicit!(p.params, 0.5)).toBeCloseTo(0.5 - 0.125 / 6, 9)
    const f = docFigure(m, { style: 'ap', answers: false, widthCm: 8 })
    expect(f.scene.overlays!.some((o) => o.kind === 'area')).toBe(true)
    // the AP caption names the curves the board names
    expect(f.scene.caption).toMatch(/^Graphs of f/)
    expect(f.scene.curveNames?.p).toBe('P₃')
  })

  it('draws an inverse relation from its link', () => {
    const f = typed('f', 'y = x^3', 'expr_1')
    const inv: FittedCurve = { ...f, id: 'g', modelId: 'inv_L', kind: 'parametric', params: [], domain: [-2, 2] }
    const link: InverseLink = { id: 'L', parentId: 'f', curveId: 'g', from: -2, to: 2 }
    const json = docJSON('dInv', 'Inverse', input({ curves: [f, inv], exprSources: { f: 'y = x^3' }, inverses: [link] }))
    const m = docModelFromJSON(json)!
    const spec = m.models.inv_L
    expect(spec.kind).toBe('parametric')
    const pt = spec.evalParametric!([], 2)
    expect(pt.x).toBeCloseTo(8, 9)
    expect(pt.y).toBe(2)
  })

  it('a caption override replaces the document’s own; "" removes it', () => {
    const m = docModelFromJSON(PARABOLA())!
    expect(docFigure(m, { style: 'ap', answers: false }).scene.caption).toBe('Graph of f')
    expect(docFigure(m, { style: 'ap', answers: false, caption: '' }).scene.caption).toBeUndefined()
    expect(docFigure(m, { style: 'ap', answers: false, caption: 'Figure 1' }).scene.caption).toBe('Figure 1')
  })

  it('returns null for something that is not a document', () => {
    expect(docModelFromJSON('{oops')).toBeNull()
    expect(docModelFromJSON('[]')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

describe('worksheet layout (points)', () => {
  const base = { orientation: 'portrait' as const, hasTitle: true, nameLine: true, hasCaptions: true }

  it('knows the paper', () => {
    expect(pageSize('letter', 'portrait')).toEqual({ w: 612, h: 792 })
    expect(pageSize('letter', 'landscape')).toEqual({ w: 792, h: 612 })
    expect(pageSize('a4', 'portrait').w).toBeCloseTo(595.28, 2)
    expect(pageSize('a4', 'portrait').h).toBeCloseTo(841.89, 2)
  })

  for (const page of ['letter', 'a4'] as const) {
    for (const cols of [1, 2, 3] as const) {
      it(`${page}, ${cols} column${cols > 1 ? 's' : ''}: cells tile the content width inside the margins`, () => {
        const L = layoutSheet({ ...base, page, cols, count: cols * 2 })
        const { w, h } = pageSize(page, 'portrait')
        const contentW = w - 2 * SHEET_MARGIN_PT
        expect(L.contentW).toBeCloseTo(contentW, 6)
        expect(L.cellW).toBeCloseTo((contentW - (cols - 1) * GUTTER_PT) / cols, 6)
        const cells = L.pages.flatMap((p) => p.cells)
        expect(cells).toHaveLength(cols * 2)
        for (const c of cells) {
          expect(c.cell.x).toBeGreaterThanOrEqual(SHEET_MARGIN_PT - 1e-9)
          expect(c.cell.x + c.cell.w).toBeLessThanOrEqual(w - SHEET_MARGIN_PT + 1e-6)
          expect(c.cell.y + c.cell.h).toBeLessThanOrEqual(h - SHEET_MARGIN_PT + 1e-6)
          // the figure box sits inside its cell, under the label band
          expect(c.figure.y).toBeGreaterThan(c.cell.y)
          expect(c.figure.x).toBe(c.cell.x)
          expect(c.figure.w).toBeCloseTo(c.cell.w, 9)
        }
        // first row: column c starts at margin + c·(cellW + gutter)
        const row = cells.slice(0, cols)
        row.forEach((c, i) => expect(c.cell.x).toBeCloseTo(SHEET_MARGIN_PT + i * (L.cellW + GUTTER_PT), 6))
        // no two cells on a page overlap
        for (const pg of L.pages)
          for (let i = 0; i < pg.cells.length; i++)
          for (let j = i + 1; j < pg.cells.length; j++) {
            const a = pg.cells[i].cell
            const b = pg.cells[j].cell
            const apart = a.x + a.w <= b.x + 1e-6 || b.x + b.w <= a.x + 1e-6 || a.y + a.h <= b.y + 1e-6 || b.y + b.h <= a.y + 1e-6
            expect(apart).toBe(true)
          }
      })
    }
  }

  it('states the cell widths in points', () => {
    expect(cellWidth(504, 1)).toBe(504)
    expect(cellWidth(504, 2)).toBe(243)
    expect(cellWidth(504, 3)).toBe(156)
    expect(cellWidth(595.28 - 108, 2)).toBeCloseTo(234.64, 6)
  })

  it('puts the header on page 1 only and flows the rest onto further pages', () => {
    const L = layoutSheet({ ...base, page: 'letter', cols: 2, count: 13 })
    expect(L.rowsFirst).toBeLessThanOrEqual(L.rowsRest)
    expect(L.pages.reduce((n, p) => n + p.cells.length, 0)).toBe(13)
    expect(L.pages.length).toBeGreaterThan(1)
    expect(L.pages[0].cells[0].cell.y).toBeGreaterThan(L.pages[1].cells[0].cell.y)
    // indices are in order across pages
    expect(L.pages.flatMap((p) => p.cells.map((c) => c.index))).toEqual([...Array(13).keys()])
  })

  it('one column still fits two rows on a page', () => {
    for (const page of ['letter', 'a4'] as const) {
      const L = layoutSheet({ ...base, page, cols: 1, count: 4 })
      expect(L.rowsFirst).toBeGreaterThanOrEqual(2)
      expect(L.rowsRest).toBeGreaterThanOrEqual(2)
    }
  })

  it('labels (a)…(z), (aa); 1., 2.; or nothing', () => {
    expect([0, 1, 2].map((i) => autoLabel(i, 'a'))).toEqual(['(a)', '(b)', '(c)'])
    expect(autoLabel(25, 'a')).toBe('(z)')
    expect(autoLabel(26, 'a')).toBe('(aa)')
    expect(autoLabel(2, '1')).toBe('3.')
    expect(autoLabel(2, 'none')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/** Parse the xref table and check every in-use offset lands on "n 0 obj". */
function checkPdf(pdf: string): number {
  expect(pdf.startsWith('%PDF-1.4\n')).toBe(true)
  const sx = /startxref\n(\d+)\n%%EOF\n$/.exec(pdf)
  expect(sx).not.toBeNull()
  const xrefAt = Number(sx![1])
  expect(pdf.slice(xrefAt, xrefAt + 5)).toBe('xref\n')
  const head = /^xref\n0 (\d+)\n/.exec(pdf.slice(xrefAt))!
  const count = Number(head[1])
  let at = xrefAt + head[0].length
  for (let i = 0; i < count; i++) {
    const entry = pdf.slice(at, at + 20)
    expect(entry).toMatch(/^\d{10} \d{5} [nf] \n$/)
    if (i > 0) {
      const off = Number(entry.slice(0, 10))
      expect(pdf.slice(off, off + `${i} 0 obj`.length)).toBe(`${i} 0 obj`)
    }
    at += 20
  }
  expect(pdf.slice(at)).toMatch(new RegExp(`^trailer\\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>`))
  const re = /<< \/Length (\d+) >>\nstream\n/g
  let m: RegExpExecArray | null
  while ((m = re.exec(pdf)) !== null) {
    const start = m.index + m[0].length
    expect(pdf.slice(start + Number(m[1]), start + Number(m[1]) + 10)).toBe('endstream\n')
  }
  return count - 1
}

describe('multi-page PDF', () => {
  it('writes N pages with valid xref offsets and a /Count of N', () => {
    const lists: DisplayList[] = [1, 2, 3].map((n) => {
      const p = emptyPage(612, 792)
      p.items.push({ t: 'text', text: `Page ${n} − π`, x: 72, y: 72, anchor: 'start', font: { family: 'serif', generic: 'serif', size: 12, italic: false, bold: false }, color: { r: 0, g: 0, b: 0, a: 1 }, width: 50, clip: 0 })
      return p
    })
    const pdf = toPdfPagesString(lists, { ptPerPx: 1, title: 'Sheet' })
    checkPdf(pdf)
    expect(pdf).toContain('/Type /Pages /Kids [4 0 R 6 0 R 8 0 R] /Count 3')
    expect(pdf.match(/\/Type \/Page /g)).toHaveLength(3)
    expect(pdf).toContain('/MediaBox [0 0 612 792]')
    // the fonts are shared: one Times-Roman object for all three pages
    expect(pdf.match(/\/BaseFont \/Times-Roman/g)).toHaveLength(1)
  })

  it('a whole sheet: three figures on letter, two columns, one page; thirteen flow to more', () => {
    const ms = models()
    const lookup = (id: string): DocModel | null => ms.get(id) ?? null
    const bytes = sheetPdf(sheetOf(), lookup, false)
    const pdf = Array.from(bytes, (b) => String.fromCharCode(b)).join('')
    checkPdf(pdf)
    expect(pdf).toMatch(/\/Count 1 >>/)
    expect(pdf).toContain('/MediaBox [0 0 612 792]')

    const many = sheetOf({ items: Array.from({ length: 13 }, (_, i) => ({ docId: ['dParab', 'dSine', 'dRat'][i % 3] })) })
    const big = Array.from(sheetPdf(many, lookup, true), (b) => String.fromCharCode(b)).join('')
    const pages = (big.match(/\/Type \/Page /g) ?? []).length
    expect(pages).toBeGreaterThan(1)
    expect(big).toMatch(new RegExp(`/Count ${pages} >>`))
    checkPdf(big)

    const a4 = Array.from(sheetPdf(sheetOf({ page: 'a4' }), lookup, false), (b) => String.fromCharCode(b)).join('')
    expect(a4).toContain('/MediaBox [0 0 595.28 841.89]')
  })

  it('a missing document is a placeholder, not a failure', () => {
    const ms = models()
    const built = buildSheet(sheetOf({ items: [{ docId: 'gone' }, { docId: 'dSine' }] }), (id) => ms.get(id) ?? null, false)
    expect(built.figures[0].figure).toBeNull()
    expect(texts(built.pages[0])).toContain('This document is no longer saved.')
    expect(built.figures[1].list).not.toBeNull()
  })

  it('places a figure through one uniform scale, clips and all', () => {
    const ms = models()
    const fig = recordFigure(docFigure(ms.get('dParab')!, { style: 'sat', answers: false, widthCm: 6 }))
    const page = emptyPage(612, 792)
    placeList(page, fig, { x: 100, y: 200, scale: 0.5 }, 0)
    expect(page.items).toHaveLength(fig.items.length)
    expect(page.clips).toHaveLength(fig.clips.length)
    const a = fig.items.find((i): i is TextItem => i.t === 'text')!
    const b = page.items[fig.items.indexOf(a)] as TextItem
    expect(b.x).toBeCloseTo(100 + a.x * 0.5, 9)
    expect(b.y).toBeCloseTo(200 + a.y * 0.5, 9)
    expect(b.font.size).toBeCloseTo(a.font.size * 0.5, 9)
  })
})

// ---------------------------------------------------------------------------
// LaTeX
// ---------------------------------------------------------------------------

/** Braces balance once escaped braces (\{ \}) are set aside, and never go negative. */
function balanced(tex: string): boolean {
  let depth = 0
  const body = tex
    .split('\n')
    .map((l) => l.replace(/(^|[^\\])%.*$/, '$1')) // comments
    .join('\n')
    .replace(/\\[{}]/g, '')
  for (const ch of body) {
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth < 0) return false
    }
  }
  return depth === 0
}

describe('worksheet LaTeX', () => {
  const ms = models()
  const lookup = (id: string): DocModel | null => ms.get(id) ?? null

  it('is balanced, labelled (a)(b)(c), free of control characters, one tikzpicture per figure', () => {
    const sheet = sheetOf({ title: 'Quiz\u0007 3: {f} & $g$ 100% #1 x_1 ^ ~' })
    const { figures } = buildSheet(sheet, lookup, false)
    const tex = sheetLatex(sheet, figures, false)
    expect(balanced(tex)).toBe(true)
    // eslint-disable-next-line no-control-regex
    expect(tex).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/)
    for (const l of ['(a)', '(b)', '(c)']) expect(tex).toContain(`{\\bfseries ${l}}`)
    expect(tex.match(/\\begin\{tikzpicture\}/g)).toHaveLength(3)
    expect(tex.match(/\\end\{tikzpicture\}/g)).toHaveLength(3)
    expect(tex.match(/\\begin\{minipage\}/g)).toHaveLength(3)
    expect(tex).toContain('\\usepackage{tikz}')
    expect(tex).toContain('Student version')
    // the title is escaped prose
    expect(tex).toContain('$\\{$f$\\}$ \\& \\$g\\$ 100\\% \\#1 x\\_1')
    // two columns: a gutter between (a) and (b), a row break after (b)
    expect(tex).toContain('\\dimexpr(\\linewidth-18pt)/2\\relax')
    // captions under their figures
    expect(tex).toContain('{\\small One period}')
    // no blank line inside any \resizebox argument (it would end a paragraph)
    expect(tex).not.toMatch(/\\resizebox[^\n]*\n(?:[^\n]+\n)*?\n/)
  })

  it('each figure is that document’s TikZ at the cell width', () => {
    const sheet = sheetOf()
    const { figures } = buildSheet(sheet, lookup, false)
    for (const f of figures) {
      expect(f.widthCm).toBeGreaterThan(3)
      // ≤ the cell width of a two-column letter page (243 pt)
      expect(f.widthCm).toBeLessThanOrEqual((243 / 72) * 2.54 + 1e-9)
    }
    const tex = sheetLatex(sheet, figures, false)
    const box = /\\useasboundingbox \(0,0\) rectangle \(([\d.]+),([\d.]+)\);/.exec(tex)!
    expect(Number(box[1])).toBeLessThanOrEqual(243 + 0.5)
  })

  it('the pgfplots variant writes one axis per figure, with the equations', () => {
    const sheet = sheetOf()
    const { figures } = buildSheet(sheet, lookup, true)
    const tex = sheetLatex(sheet, figures, true, { pgfplots: true })
    expect(balanced(tex)).toBe(true)
    expect(tex.match(/\\begin\{axis\}/g)).toHaveLength(3)
    expect(tex).toContain('\\usepackage{pgfplots}')
    expect(tex).toContain('ANSWER KEY')
  })

  it('1 and 3 columns, numbered 1. 2. 3.', () => {
    for (const cols of [1, 3] as const) {
      const sheet = sheetOf({ cols, numbering: '1' })
      const tex = sheetLatex(sheet, buildSheet(sheet, lookup, false).figures, false)
      expect(balanced(tex)).toBe(true)
      for (const l of ['1.', '2.', '3.']) expect(tex).toContain(`{\\bfseries ${l}}`)
      expect(tex).toContain(cols === 1 ? '\\begin{minipage}[t]{\\linewidth}' : '/3\\relax')
    }
  })
})

// ---------------------------------------------------------------------------
// the answer key
// ---------------------------------------------------------------------------

describe('answer key', () => {
  it('off: no analysis, no intersections, no marker labels; on: all of them', () => {
    const m = docModelFromJSON(PARABOLA())!
    const student = docFigure(m, { style: 'sat', answers: false, widthCm: 8 })
    const key = docFigure(m, { style: 'sat', answers: true, widthCm: 8 })
    expect(student.scene.analysis).toBeNull()
    expect(student.scene.intersections).toBeUndefined()
    expect(key.scene.analysis!.points.map((p) => p.kind)).toEqual(expect.arrayContaining(['minimum', 'zero', 'zero']))
    const s = recordFigure(student)
    const k = recordFigure(key)
    expect(texts(s)).not.toContain('√3')
    expect(texts(k)).toContain('√3')
    expect(texts(k)).toContain('−√3')
    expect(texts(k)).toContain('(0, −3)')
    expect(k.items.length).toBeGreaterThan(s.items.length)
  })

  it('marks every visible curve on the key and their crossings', () => {
    const a = typed('a', 'y = x', 'expr_1')
    const b = typed('b', 'y = 4 - x', 'expr_2', '#ef4444')
    const json = docJSON('dTwo', 'Two', input({ curves: [a, b], exprSources: { a: 'y = x', b: 'y = 4 - x' }, selectedId: 'a' }))
    const m = docModelFromJSON(json)!
    const key = docFigure(m, { style: 'textbook', answers: true, widthCm: 8 })
    expect(key.scene.intersections!.length).toBe(1)
    expect(key.scene.intersections![0].point.pos.x).toBeCloseTo(2, 9)
    expect(key.context.map((c) => c.curve.id)).toEqual(['b'])
    const student = docFigure(m, { style: 'textbook', answers: false, widthCm: 8 })
    expect(student.scene.intersections).toBeUndefined()
    expect(student.context).toEqual([])
  })

  it('reaches the page: the key sheet carries the labels, the student sheet does not', () => {
    const ms = models()
    const lookup = (id: string): DocModel | null => ms.get(id) ?? null
    const s = buildSheet(sheetOf(), lookup, false).pages[0]
    const k = buildSheet(sheetOf(), lookup, true).pages[0]
    expect(texts(s)).not.toContain('√3')
    expect(texts(k)).toContain('√3')
    // labels and captions are on both
    for (const page of [s, k]) {
      expect(texts(page)).toEqual(expect.arrayContaining(['(a)', '(b)', '(c)', 'One period', 'Name:', 'Date:']))
    }
  })
})

// ---------------------------------------------------------------------------
// the key states every answer, near its point
// ---------------------------------------------------------------------------

describe('answer key labels', () => {
  const docs = (): [string, string][] => [
    ['parabola', PARABOLA()],
    ['sine', SINE()],
    ['rational', RATIONAL()],
    ['sketch', SKETCH()],
    ['calculus', CALC()],
  ]

  /** Every answer point of a key figure, with the curve it belongs to. */
  const answers = (f: ReturnType<typeof docFigure>) => [
    ...(f.scene.analysis ? f.scene.analysis.points : []),
    ...f.context.flatMap((c) => c.points),
    ...(f.scene.intersections ?? []).map((i) => i.point),
  ]

  for (const widthCm of [5, 6.5, 8, 16]) {
    it(`at ${widthCm} cm, every analysis point's label is in the display list (chip or text line)`, () => {
      for (const [name, json] of docs()) {
        const m = docModelFromJSON(json)!
        const f = docFigure(m, { style: 'sat', answers: true, widthCm })
        const list = recordFigure(f)
        const all = texts(list).join('\n')
        const pts = answers(f)
        expect(pts.length, name).toBeGreaterThan(0)
        for (const p of pts) {
          const s = toScreen(p.pos, f.scene.vp)
          if (s.x < -30 || s.y < -30 || s.x > f.scene.vp.widthPx + 30 || s.y > f.scene.vp.heightPx + 30) continue
          // A point standing exactly on another answer (a minimum that is also
          // the y-intercept, a zero that is an inflection) is stated once.
          const twins = pts.filter((q) => Math.abs(q.pos.x - p.pos.x) < 1e-6 && Math.abs(q.pos.y - p.pos.y) < 1e-6)
          const stated = twins.some((q) => all.includes(answerLabel(q)))
          expect(stated, `${name} @${widthCm}cm: ${p.kind} ${answerLabel(p)}`).toBe(true)
        }
      }
    })
  }

  it('the zeros of x² − 3 get chips in a worksheet cell, and the vertex is stated once', () => {
    const m = docModelFromJSON(PARABOLA())!
    const f = docFigure(m, { style: 'sat', answers: true, widthCm: 6.5 })
    const t = texts(recordFigure(f))
    expect(t).toContain('√3')
    expect(t).toContain('−√3')
    expect(t.filter((x) => x === '(0, −3)')).toHaveLength(1)
    expect(f.scene.answerKey!.unlabelled).toEqual([])
  })

  it('a chip stays near its point: short leaders, also for the rational’s y-intercept', () => {
    for (const json of [PARABOLA(), RATIONAL(), SINE()]) {
      const m = docModelFromJSON(json)!
      const f = docFigure(m, { style: 'sat', answers: true, widthCm: 6.5 })
      const list = recordFigure(f)
      const pts = answers(f)
      const margin = f.margin
      for (const it of list.items) {
        if (it.t !== 'text') continue
        const p = pts.find((q) => answerLabel(q) === it.text)
        if (!p) continue
        const s = toScreen(p.pos, f.scene.vp)
        // the chip's text sits inside a plate whose nearest edge is a short
        // step from the marker: the text's centre is within a chip's width
        const cx = it.x + it.width / 2 - margin
        const cy = it.y - margin
        expect(Math.hypot(cx - s.x, cy - s.y), it.text).toBeLessThan(it.width / 2 + 40)
      }
    }
  })

  it('a small figure caps its chips and states the rest in one line under the figure', () => {
    const m = docModelFromJSON(SINE())!
    const f = docFigure(m, { style: 'sat', answers: true, widthCm: 6.5 })
    const list = recordFigure(f)
    // coordinate chips (a bare "π" could be a tick label as well as a zero's chip)
    const chipTexts = texts(list).filter((t) => t.startsWith('(') && answers(f).some((p) => answerLabel(p) === t))
    expect(chipTexts.length).toBeGreaterThan(0)
    expect(chipTexts.length).toBeLessThanOrEqual(6)
    const left = f.scene.answerKey!.unlabelled
    expect(left.length).toBeGreaterThan(0)
    // the line is grouped by kind and never breaks a coordinate pair
    const line = unplacedAnswers(left)
    expect(line).toMatch(/inflection: /)
    const lines = texts(list).filter((t) => /^(max|min|inflection|zeros|y-int)/.test(t) || /\(.*\)/.test(t))
    for (const l of lines) expect((l.match(/\(/g) ?? []).length).toBe((l.match(/\)/g) ?? []).length)
    // the band grew the figure; the student figure has no band
    const student = recordFigure(docFigure(m, { style: 'sat', answers: false, widthCm: 6.5 }))
    expect(list.height).toBeGreaterThan(student.height)
  })

  it('no two key chips overlap', () => {
    for (const json of [SINE(), CALC(), PARABOLA()]) {
      const m = docModelFromJSON(json)!
      const f = docFigure(m, { style: 'textbook', answers: true, widthCm: 6.5 })
      const list = recordFigure(f)
      const pts = answers(f)
      const chips = list.items.filter((i): i is TextItem => i.t === 'text' && pts.some((p) => answerLabel(p) === i.text))
      const boxes = chips.map((c) => ({ x: c.x - 4, y: c.y - c.font.size, w: c.width + 8, h: c.font.size * 1.4 }))
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]
          const b = boxes[j]
          const overlap = a.x < b.x + b.w - 1 && a.x + a.w > b.x + 1 && a.y < b.y + b.h - 1 && a.y + a.h > b.y + 1
          expect(overlap, `${chips[i].text} / ${chips[j].text}`).toBe(false)
        }
    }
  })
})

describe('the key states asymptotes and holes', () => {
  it('y = 1/(x − 2): "asymptotes: x = 2, y = 0" on the key, nothing on the student version', () => {
    const m = docModelFromJSON(RATIONAL())!
    const key = docFigure(m, { style: 'sat', answers: true, widthCm: 6.5 })
    expect(key.asymptotes).toEqual(['x = 2', 'y = 0'])
    const all = texts(recordFigure(key)).join(' ')
    expect(all).toContain('asymptotes: x = 2, y = 0')
    const student = docFigure(m, { style: 'sat', answers: false, widthCm: 6.5 })
    expect(student.asymptotes).toEqual([])
    const s = texts(recordFigure(student)).join(' ')
    expect(s).not.toContain('x = 2')
    expect(s).not.toContain('asymptotes')
  })

  it('y = (x² − 1)/(x − 1): "hole: (1, 2)" on the key only', () => {
    const c = typed('e1', 'y = (x^2 - 1)/(x - 1)', 'expr_1')
    const json = docJSON('dHole', 'Hole', input({ curves: [c], exprSources: { e1: 'y = (x^2 - 1)/(x - 1)' }, selectedId: 'e1' }))
    const m = docModelFromJSON(json)!
    const all = texts(recordFigure(docFigure(m, { style: 'textbook', answers: true, widthCm: 6.5 }))).join(' ')
    expect(all).toContain('hole: (1, 2)')
    const s = texts(recordFigure(docFigure(m, { style: 'textbook', answers: false, widthCm: 6.5 }))).join(' ')
    expect(s).not.toContain('hole')
  })

  it('a slant asymptote is written as its line', () => {
    const c = typed('e1', 'y = (x^2 + 1)/x', 'expr_1')
    const json = docJSON('dSlant', 'Slant', input({ curves: [c], exprSources: { e1: 'y = (x^2 + 1)/x' }, selectedId: 'e1' }))
    const key = docFigure(docModelFromJSON(json)!, { style: 'textbook', answers: true, widthCm: 8 })
    expect(key.asymptotes).toEqual(['x = 0', 'y = x'])
  })
})

// ---------------------------------------------------------------------------
// every kind of document reaches the sheet (the per-card pipelines)
// ---------------------------------------------------------------------------

describe('series, related rates and an LP system on one sheet', () => {
  const SERIES = (): string =>
    docJSON(
      'dSeries',
      'Series',
      input({
        sequences: [
          {
            id: 'g',
            src: 'a_n = (1/2)^(n - 1)',
            color: '#4f9cf9',
            visible: true,
            n0: 1,
            count: 8,
            showPartner: false,
            showSums: false,
            params: [],
            series: { N: 8, connect: true, bars: true },
          },
        ],
      }),
    )
  const RATES = (): string => docJSON('dRates', 'Ladder', input({ relatedRates: [newRelatedRates('R1')] }))
  const LP = (): string => {
    const srcs: Record<string, string> = { i1: 'y <= -x + 4', i2: 'x >= 0', i3: 'y >= 0' }
    const curves = Object.entries(srcs).map(([id, src], i) => typed(id, src, `expr_${i + 1}`))
    return docJSON(
      'dLP',
      'LP',
      input({ curves, exprSources: srcs, system: { solution: true, objective: { src: 'P = 3x + 2y', goal: 'max' } } }),
    )
  }
  const lookup = (): ((id: string) => DocModel | null) => {
    const ms = new Map<string, DocModel>()
    for (const json of [SERIES(), RATES(), LP()]) {
      const m = docModelFromJSON(json)!
      ms.set(m.id, m)
    }
    return (id) => ms.get(id) ?? null
  }
  const sheet = (): Worksheet =>
    sheetOf({ items: [{ docId: 'dSeries' }, { docId: 'dRates' }, { docId: 'dLP' }], style: 'textbook' })

  it('none of them lists anything as "Not included"', () => {
    const look = lookup()
    for (const id of ['dSeries', 'dRates', 'dLP']) expect(look(id)!.omitted).toEqual([])
  })

  it('the key states the sum, the rate and the optimum; the student sheet states none of them', () => {
    const key = texts(buildSheet(sheet(), lookup(), true).pages[0]).join(' | ')
    const student = texts(buildSheet(sheet(), lookup(), false).pages[0]).join(' | ')
    expect(key).toContain('S = 2')
    expect(key).toMatch(/dy\/dt = −?\d/)
    expect(key).toContain('max P = 12')
    expect(student).not.toContain('S = 2')
    expect(student).not.toMatch(/dy\/dt = −?\d/)
    expect(student).toContain('dy/dt = ?')
    expect(student).not.toContain('max P')
    expect(student).not.toContain('(0, 4)')
  })

  it('the figures are drawn, not placeholders, in the PDF and the LaTeX', () => {
    const built = buildSheet(sheet(), lookup(), false)
    for (const f of built.figures) {
      expect(f.figure).not.toBeNull()
      expect(f.list!.items.length).toBeGreaterThan(20)
    }
    const tex = sheetLatex(sheet(), built.figures, false)
    expect((tex.match(/\\begin\{tikzpicture\}/g) ?? []).length).toBe(3)
    const pdf = Array.from(sheetPdf(sheet(), lookup(), true), (b) => String.fromCharCode(b)).join('')
    expect(pdf.startsWith('%PDF')).toBe(true)
  })
})

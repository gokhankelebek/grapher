// ============================================================================
// tests/answerKey.test.ts — the worksheet answer key, worthy of the name.
//
//   header      every key output says ANSWER KEY (PDF pages, PDF bytes,
//               LaTeX / .tex, and the PNG, which replays the same pages);
//               no student output does
//   answers     under each figure, every answer reveal mode would hide on its
//               document, in reveal order, in Present's own words — for a
//               Riemann sum, calculus on a table, a sign chart, probability
//               and zeros; nothing dropped when a cell is too small
//   student     the student copy carries none of them
//   tables      a figure's data table prints in both copies, on by default
//               for a figure that relies on one, off when the teacher says;
//               a long one wraps into column groups; headers keep their units
//   glyphs      every answer string sets in the PDF's standard fonts
//   file names  from the title, safe on every file system
//   storage     the new option is stored only when set; old sheets stay
//               byte-identical
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { Worksheet } from '../src/core/persist'
import { deserializeWorksheets, newWorksheet, serializeWorksheets } from '../src/core/persist'
import type { DisplayList, TextItem } from '../src/render/vectorCtx'
import { pdfTextRuns } from '../src/render/vectorPdf'
import type { DocModel } from '../src/ui/docScene'
import { docAnswerLines, docDataTables, relyOnTable } from '../src/ui/docAnswers'
import { answerSourcesOf, calcLinesOf } from '../src/ui/answerSources'
import type { AnswerInputs } from '../src/ui/answerSources'
import { answerLine } from '../src/ui/revealedAnswers'
import { calcLinesOf as presentCalcLines } from '../src/app/usePresentAnswers'
import { KEY_UNREADABLE, headerLines, keyAnswerText, keyAnswers } from '../src/ui/sheetBlocks'
import {
  KEY_MARK,
  MORE_HEADING,
  buildSheet,
  fileBase,
  includeTable,
  sheetFileName,
  sheetLatex,
  sheetPdf,
  texValue,
} from '../src/ui/worksheetExport'
import { layoutSheet } from '../src/ui/worksheetLayout'
import { corpusDocs, loadModels } from './latexCorpus'
import { buildExample, exampleById } from '../src/examples'
import { docModelFromJSON } from '../src/ui/docScene'
import { analysisTitle } from '../src/ui/CurveCard'
import type { CardCalc } from '../src/ui/calcLinks'

const models = loadModels(corpusDocs())
const lookup = (id: string): DocModel | null => models.get(id) ?? null

const texts = (l: DisplayList): string[] => l.items.filter((i): i is TextItem => i.t === 'text').map((i) => i.text)
/** Every word printed on a set of pages, in order, whitespace collapsed. */
const pageText = (pages: readonly DisplayList[]): string =>
  pages.flatMap(texts).join(' ').replace(/\s+/g, ' ')
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** The representative set: a Riemann sum, calculus on a table, a sign chart, probability, zeros. */
const SET = ['areas', 'tablecalc', 'signchart', 'probtable', 'explicit'] as const

function sheet(over: Partial<Worksheet> = {}): Worksheet {
  return {
    ...newWorksheet('Worksheet 1', 1),
    id: 'wsk',
    title: 'Riemann sums quiz',
    items: SET.map((docId) => ({ docId })),
    ...over,
  }
}

describe('docAnswerLines: a stored document’s answers, in reveal order', () => {
  it('states each family’s answer in Present’s words', () => {
    const value = (id: string, label: RegExp): string =>
      docAnswerLines(models.get(id)!).find((l) => label.test(l.label))?.value ?? ''
    expect(value('areas', /Riemann sum/)).toBe('M₆ = 5.362 (exact ∫₀⁴ = 16/3)')
    expect(value('tablecalc', /trapezoidal sum/)).toMatch(/^L₄ = \(2\)\(4\.3\) \+ \(3\)\(5\.0\) \+ \(4\)\(5\.9\) \+ \(3\)\(7\.1\) = 68\.5/)
    expect(value('tablecalc', /average value/)).toContain('≈ 6.242 gal/min')
    // a sign chart's answer is its conclusions, each with its justification
    expect(value('signchart', /sign chart/)).toContain('f has a relative maximum at x = −1 because f′ changes from positive to negative there.')
    expect(value('probtable', /Two-way table/)).toBe('= 3/10')
    expect(docAnswerLines(models.get('explicit')!).filter((l) => l.label === 'f · zero').map((l) => l.value)).toEqual(['−√3', '0', '√3'])
  })

  it('walks the teaching order: zeros, intercept, extrema … then crossings, then tools', () => {
    const labels = docAnswerLines(models.get('explicit')!).map((l) => l.label)
    expect(labels.indexOf('f · zero')).toBeLessThan(labels.indexOf('f · maximum'))
    expect(labels.indexOf('f · maximum')).toBeLessThan(labels.indexOf('f and g meet'))
    expect(labels.indexOf('g · zero')).toBeLessThan(labels.indexOf('f and g meet'))
  })

  it('Present and the key read sign charts, sums and tools through one function', () => {
    expect(presentCalcLines).toBe(calcLinesOf)
  })

  it('a number line states its solution set', () => {
    expect(docAnswerLines(models.get('nldistance')!).map((l) => l.value)).toEqual(['(−1, 4)'])
  })

  it('gathers answers under one label, in reveal order, and never prints a blank one', () => {
    const k = keyAnswers([
      { key: 'a', label: 'f · zero', value: '−2', color: null, place: 'board' },
      { key: 'b', label: 'f · maximum', value: '(0, 4)', color: null, place: 'board' },
      { key: 'c', label: 'f · zero', value: '2', color: null, place: 'board' },
      { key: 'd', label: 'centroid', value: 'revealed (no value to show)', color: null, place: 'board' },
      { key: 'e', label: 'sim', value: 'revealed (no value to show)', color: null, place: 'panel' },
    ])
    expect(k.map(keyAnswerText)).toEqual(['f · zero: −2, 2', 'f · maximum: (0, 4)', `centroid: ${KEY_UNREADABLE}`])
    expect(keyAnswerText({ label: 'P(B | A)', value: '= 3/10' })).toBe('P(B | A) = 3/10')
    expect(keyAnswerText({ label: '97.5th percentile:', value: 'x ≈ 1.96' })).toBe('97.5th percentile: x ≈ 1.96')
  })
})

describe('the key PDF', () => {
  const key = buildSheet(sheet(), lookup, true)
  const student = buildSheet(sheet(), lookup, false)
  const keyText = pageText(key.pages)
  const studentText = pageText(student.pages)

  it('says ANSWER KEY beside the title, and over every later page', () => {
    expect(texts(key.pages[0]).slice(0, 2)).toEqual(['Riemann sums quiz', KEY_MARK])
    expect(key.pages.length).toBeGreaterThan(1)
    for (const p of key.pages) expect(texts(p)).toContain(KEY_MARK)
    for (const p of student.pages) expect(texts(p)).not.toContain(KEY_MARK)
    const bytes = Array.from(sheetPdf(sheet(), lookup, true), (b) => String.fromCharCode(b)).join('')
    expect(bytes).toContain(`(${KEY_MARK})`)
    expect(Array.from(sheetPdf(sheet(), lookup, false), (b) => String.fromCharCode(b)).join('')).not.toContain(KEY_MARK)
  })

  it('a key without a title still says what it is', () => {
    const pages = buildSheet(sheet({ title: undefined }), lookup, true).pages
    expect(texts(pages[0])[0]).toBe(KEY_MARK)
  })

  it('prints every answer of every figure, in reveal order, and the student copy none of them', () => {
    for (const f of key.figures) {
      const lines = docAnswerLines(models.get(f.item.docId)!)
      expect(lines.length, f.item.docId).toBeGreaterThan(0)
      let at = -1
      for (const a of keyAnswers(lines)) {
        const said = squash(keyAnswerText(a))
        expect(keyText.includes(said), `${f.item.docId}: ${said}`).toBe(true)
        // in reveal order, figure by figure: each after the one before it
        const i = keyText.indexOf(said, at + 1)
        expect(i, `${f.item.docId}: ${said} (order)`).toBeGreaterThan(at)
        at = i
        expect(studentText.includes(said), `student copy states ${said}`).toBe(false)
      }
      // …and each answer's value, word for word (the strings Present shows)
      for (const l of lines) {
        if (l.value.startsWith('revealed')) continue
        expect(keyText.includes(squash(l.value)), `${f.item.docId}: ${l.value}`).toBe(true)
        if (l.value.length >= 4) expect(studentText.includes(squash(l.value)), `student copy states ${l.value}`).toBe(false)
      }
    }
  })

  it('every answer string sets in the standard fonts: no glyph becomes "?"', () => {
    for (const f of key.figures) {
      for (const a of f.key) {
        const t = keyAnswerText(a)
        const runs = pdfTextRuns(t, { family: 'Helvetica', generic: 'sans-serif', size: 9, italic: false, bold: false })
        const q = runs.reduce((n, r) => n + r.codes.filter((c) => c === 63).length, 0)
        expect(q, t).toBe((t.match(/\?/g) ?? []).length)
      }
    }
  })

  it('answers too long for their cell go on after the figures, never dropped', () => {
    const narrow = sheet({ cols: 3, items: ['piaxes', 'signchart', 'sketch', 'valuetable'].map((docId) => ({ docId })) })
    const built = buildSheet(narrow, lookup, true)
    const all = pageText(built.pages)
    expect(built.figures.some((f) => f.more.length > 0)).toBe(true)
    expect(all).toContain(MORE_HEADING)
    for (const f of built.figures) {
      for (const a of f.key) {
        // a cut answer prints its two halves; each word of it is printed
        for (const word of a.value.split(/\s+/).filter((w) => w.length > 3)) expect(all, word).toContain(word)
      }
    }
    // nothing overruns the page
    for (const p of built.pages) for (const t of p.items.filter((i): i is TextItem => i.t === 'text')) expect(t.y).toBeLessThanOrEqual(p.height)
  })
})

describe('the key in LaTeX', () => {
  it('has the badge, the answers in math mode where they are maths, and the student copy has neither', () => {
    const s = sheet()
    const key = sheetLatex(s, buildSheet(s, lookup, true).figures, true)
    const student = sheetLatex(s, buildSheet(s, lookup, false).figures, false)
    expect(key).toContain(`\\fbox{\\bfseries ${KEY_MARK}}`)
    expect(student).not.toContain(KEY_MARK + '}')
    expect(key).toContain('\\textbf{$f \\cdot$ zero:} $-\\sqrt{3}$, $0$, $\\sqrt{3}$')
    expect(key).toMatch(/\$M_\{6\} = 5\.362/)
    for (const id of SET) {
      for (const a of keyAnswers(docAnswerLines(models.get(id)!))) {
        const tex = texValue(a.value)
        expect(key, `${id}: ${a.value}`).toContain(tex)
        if (a.value.length >= 4) expect(student.includes(tex), `student LaTeX states ${a.value}`).toBe(false)
      }
    }
  })

  it('breaks a long list between its parts, each its own math', () => {
    expect(texValue('(−1, 2), (1, −2)')).toBe('$(-1, 2)$, $(1, -2)$')
    expect(texValue('x = 0; x = ±√3')).toBe('$x = 0$; $x = \\pm\\sqrt{3}$')
    // the article is a word, not the variable a
    expect(texValue('f has a relative maximum at x = −1')).toBe('$f$ has a relative maximum at $x = -1$')
  })
})

describe('data tables', () => {
  const tc = models.get('tablecalc')!

  it('print on both copies by default for a figure that relies on a table, off when switched off', () => {
    expect(relyOnTable(tc)).toBe(true)
    expect(relyOnTable(models.get('explicit')!)).toBe(false)
    expect(includeTable({ docId: 'tablecalc' }, tc)).toBe(true)
    expect(includeTable({ docId: 'tablecalc', table: false }, tc)).toBe(false)
    for (const answers of [false, true]) {
      const on = pageText(buildSheet(sheet({ items: [{ docId: 'tablecalc' }] }), lookup, answers).pages)
      // headers with their units, and the cells
      for (const w of ['t', '(min)', 'r(t)', '(gal/min)', '4.3', '5.0', '5.9', '7.1', '8.4']) expect(on).toContain(w)
      const off = buildSheet(sheet({ items: [{ docId: 'tablecalc', table: false }] }), lookup, answers)
      expect(off.figures[0].tables).toEqual([])
    }
    // a figure with no table prints none, even when asked
    expect(buildSheet(sheet({ items: [{ docId: 'explicit', table: true }] }), lookup, false).figures[0].tables).toEqual([])
  })

  it('a scatter plot’s table is a table too', () => {
    expect(docDataTables(models.get('data')!)[0].rows.length).toBeGreaterThan(3)
  })

  it('wraps many rows into side-by-side groups, each with its header', () => {
    const built = buildSheet(sheet({ items: [{ docId: 'longtable' }] }), lookup, false)
    const t = built.figures[0].tables[0]
    expect(t.groups.length).toBeGreaterThan(1)
    expect(t.groups.flat().length).toBe(20)
    expect(t.head).toEqual([['t', '(hours)'], ['T(t)', '(°C & 50%)']])
    const words = texts(built.pages[0])
    expect(words.filter((w) => w === '(hours)').length).toBe(t.groups.length)
  })

  it('a header stays on one line when it is no wider than its values', () => {
    expect(headerLines('x', ['1', '2'], 9)).toEqual(['x'])
    expect(headerLines('r(t) (gallons per hour)', ['4.3'], 9)).toEqual(['r(t)', '(gallons per hour)'])
  })

  it('a row grows to its tallest block; without blocks the layout is what it always was', () => {
    const base = { page: 'letter' as const, orientation: 'portrait' as const, cols: 2 as const, count: 5, hasTitle: true, nameLine: true, hasCaptions: false }
    const plain = layoutSheet(base)
    const zero = layoutSheet({ ...base, extra: [0, 0, 0, 0, 0] })
    expect(zero.pages.map((p) => p.cells.map((c) => c.cell))).toEqual(plain.pages.map((p) => p.cells.map((c) => c.cell)))
    const grown = layoutSheet({ ...base, extra: [0, 120, 0, 0, 0] })
    const [a, b] = grown.pages[0].cells
    expect(a.cell.h).toBe(plain.cellH + 120)
    expect(b.extra.h).toBe(120)
    expect(grown.pages[0].cells[2].cell.y).toBeCloseTo(a.cell.y + a.cell.h + 14, 6)
  })
})

describe('file names come from the title', () => {
  it('names the Student and Key files after the title, falling back to the name', () => {
    expect(sheetFileName({ title: 'Riemann sums quiz', name: 'Worksheet 1' }, false, 'pdf')).toBe('Riemann sums quiz - Student.pdf')
    expect(sheetFileName({ title: 'Riemann sums quiz', name: 'Worksheet 1' }, true, 'pdf')).toBe('Riemann sums quiz - Key.pdf')
    expect(sheetFileName({ title: 'Unit 6 Quiz: Riemann sums', name: 'W' }, true, 'tex')).toBe('Unit 6 Quiz - Riemann sums - Key.tex')
    expect(sheetFileName({ title: 'Quiz', name: 'W' }, false, 'png', 2)).toBe('Quiz - Student p2.png')
    expect(sheetFileName({ title: undefined, name: 'Worksheet 1' }, false, 'pdf')).toBe('Worksheet 1 - Student.pdf')
    expect(sheetFileName({ title: '   ', name: '***' }, true, 'pdf')).toBe('worksheet - Key.pdf')
  })

  it('keeps every script and drops what a file system refuses', () => {
    expect(fileBase('Ünité 2 — Türev / İntegral')).toBe('Ünité 2 — Türev-İntegral')
    expect(fileBase('a<b>c|d?e*f"g')).toBe('abcdefg')
    expect(fileBase('..hidden. ')).toBe('hidden')
    expect(fileBase('tab\there\nnewline')).toBe('tab here newline')
    expect(fileBase('CON')).toBe('CON_')
    expect(fileBase('x'.repeat(300)).length).toBe(100)
    expect(fileBase('a\\b')).toBe('a-b')
  })
})

describe('storage', () => {
  it('an old worksheet round-trips byte-identically', () => {
    const old = JSON.stringify({
      version: 1,
      sheets: [
        {
          id: 'w1', name: 'Quiz', page: 'letter', orientation: 'portrait', cols: 2,
          items: [{ docId: 'a' }, { docId: 'b', caption: 'c', style: 'ap' }],
          numbering: 'a', title: 'T', showAnswers: true, style: 'textbook', nameLine: true, createdAt: 1, modifiedAt: 2,
        },
      ],
    })
    expect(serializeWorksheets(deserializeWorksheets(old).sheets)).toBe(old)
  })

  it('stores the data-table switch only when set, either way, and drops a bad one', () => {
    const s = sheet({ items: [{ docId: 'a' }, { docId: 'b', table: false }, { docId: 'c', table: true }] })
    const json = serializeWorksheets([s])
    expect(json).not.toMatch(/"docId":"a","table"/)
    const back = deserializeWorksheets(json).sheets[0]
    expect(back.items).toEqual([{ docId: 'a' }, { docId: 'b', table: false }, { docId: 'c', table: true }])
    const saved = serializeWorksheets([back])
    expect(serializeWorksheets(deserializeWorksheets(saved).sheets)).toBe(saved)
    const bad = deserializeWorksheets(JSON.stringify({ version: 1, sheets: [{ id: 'x', items: [{ docId: 'a', table: 'yes' }] }] }))
    expect(bad.sheets[0].items).toEqual([{ docId: 'a' }])
  })
})

describe('a board where the graph of f′ is shown', () => {
  const m = docModelFromJSON(buildExample(exampleById('calc-u5-graph-of-fprime')!).json)!
  const sheetOf = (): Worksheet => sheet({ items: [{ docId: m.id }] })
  const look = (id: string): DocModel | null => (id === m.id ? m : null)

  it('names the plotted curve’s own facts f′, while the sign chart’s conclusions are about f', () => {
    const lines = docAnswerLines(m)
    const labels = lines.map((l) => l.label)
    expect(labels).toContain('f′ · zero')
    expect(labels).toContain('f′ · maximum')
    expect(labels).toContain('f′ · minimum')
    expect(labels).toContain('f′ · domain')
    expect(labels.filter((l) => l.startsWith('f · '))).toEqual([])
    // its Domain rows speak of f′ too — never "f isn’t one-to-one"
    const inverse = lines.find((l) => l.label === 'f′ · inverse')!.value
    expect(inverse.startsWith('f′')).toBe(true)
    expect(inverse).not.toMatch(/^f[ ’⁻]/)
    // …and the chart still concludes about f
    expect(lines.find((l) => l.label === 'f′ · sign chart')!.value).toContain('f has a relative maximum at x = −3')
  })

  it('the key says so on paper: f′ labels, no "f · " label for that curve', () => {
    const built = buildSheet(sheetOf(), look, true)
    const said = built.figures[0].key.map(keyAnswerText)
    expect(said).toContain('f′ · zero: −3, 1, 4')
    expect(said.some((t) => t.startsWith('f′ · maximum: (1, 0)'))).toBe(true)
    expect(said.filter((t) => t.startsWith('f · '))).toEqual([])
    const text = pageText(built.pages)
    expect(text).not.toMatch(/(^| )f · (zero|maximum|minimum|inverse|domain)/)
    expect(text).toContain('f′ · zero: −3, 1, 4')
  })

  it('the card heads its Analysis "Analysis of f′"', () => {
    const calc = { signs: [{ as: 'f1' }] } as unknown as CardCalc
    expect(analysisTitle('f', calc)).toBe('Analysis of f′')
    expect(analysisTitle('f', { signs: [{ as: 'f2' }] } as unknown as CardCalc)).toBe('Analysis of f″')
    expect(analysisTitle('f', { signs: [{ as: 'f' }] } as unknown as CardCalc)).toBe('Analysis')
    expect(analysisTitle(undefined, calc)).toBe('Analysis')
  })
})

describe('Present reads the same names (answerSourcesOf)', () => {
  it('a curve a sign chart takes as f′ is f′ in every line, its Domain rows included', () => {
    const curve = { id: 'c', modelId: 'expr_1', params: [], kind: 'explicit', domain: null, color: '#000', strokeWidth: 2, visible: true, error: 0 }
    const none = (): null => null
    const input = {
      curves: [curve], models: {}, boardNames: { c: 'f' }, names: {}, exprSources: {},
      pointOf: () => ({ kind: 'zero', pos: { x: 1, y: 0 } }),
      domainRows: () => ({ domain: '(−∞, ∞)', range: null, oneToOne: 'No', inverse: 'f isn’t one-to-one — restrict its domain first' }),
      calcLines: new Map(), tablePanelFor: none, circlePanelFor: none, overlays: [], ucFigures: [], rrFigures: [], statsFigs: [],
      seqCardFor: () => undefined, fieldCardFor: () => undefined, sysCard: null, screenShapes: [], shapes: [], dataSets: [], items: [],
    } as unknown as AnswerInputs
    const f1 = answerSourcesOf({ ...input, signAs: () => 'f1' })
    expect(answerLine('curve:c:zero:0', f1).label).toBe('f′ · zero')
    expect(answerLine('curve:c:inverse', f1)).toMatchObject({ label: 'f′ · inverse', value: 'f′ isn’t one-to-one — restrict its domain first' })
    expect(answerLine('curve:c:zero:0', answerSourcesOf({ ...input, signAs: () => 'f2' })).label).toBe('f″ · zero')
    // a curve that is f itself keeps its name
    expect(answerLine('curve:c:inverse', answerSourcesOf(input)).value).toBe('f isn’t one-to-one — restrict its domain first')
  })
})

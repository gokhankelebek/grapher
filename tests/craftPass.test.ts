// ============================================================================
// tests/craftPass.test.ts — the teacher-beta craft pass.
//
//   * The saved-documents list shows an opened example by what tells it apart
//     ("U6 — Riemann sums converging"), never "Example: U6 — Riema…"; the
//     stored name is untouched.
//   * "Start from an example worksheet": two or three gallery figures for the
//     teacher's courses, as NEW documents (valid, loadable, nothing omitted
//     from a figure) and a worksheet that points at them.
//   * US spelling on screen, British spelling still found by every search.
// ============================================================================

import { describe, expect, it } from 'vitest'
import { docListName } from '../src/ui/docName'
import { EXAMPLE_DEFS, exampleDocName } from '../src/examples'
import { SAMPLE_SHEET_PICKS, buildSampleSheet, sampleSheetDefs } from '../src/examples/sampleWorksheet'
import { COURSE_ORDER } from '../src/examples/catalog'
import { deserializeDoc, deserializeWorksheets, serializeDoc, serializeWorksheets } from '../src/core/persist'
import { docFigure, docModelFromJSON } from '../src/ui/docScene'
import { buildSheet } from '../src/ui/worksheetExport'
import { COMMANDS, normalize, scoreCommand } from '../src/ui/commands'
import { exampleMatches } from '../src/examples'

describe('the saved-documents list name', () => {
  it('drops the "Example: " prefix, and only that', () => {
    expect(docListName('Example: U6 — Riemann sums, n = 4 and n = 50')).toBe('U6 — Riemann sums, n = 4 and n = 50')
    expect(docListName('Example: PC3 — sinusoid (2)')).toBe('PC3 — sinusoid (2)')
    expect(docListName('example:   M1 — box plots')).toBe('M1 — box plots')
    expect(docListName('Graph 3')).toBe('Graph 3')
    expect(docListName('Quiz: Example: derivatives')).toBe('Quiz: Example: derivatives')
    expect(docListName('My example: derivatives')).toBe('My example: derivatives')
    // nothing after the prefix: the name as it is
    expect(docListName('Example:')).toBe('Example:')
    expect(docListName('Example:   ')).toBe('Example:   ')
  })

  it('every example’s list name is its unit and short title', () => {
    for (const def of EXAMPLE_DEFS) expect(docListName(exampleDocName(def))).toBe(`${def.unit} — ${def.short}`)
  })
})

describe('the example worksheet', () => {
  const screen = { widthPx: 1366, heightPx: 768 }

  it('every pick is a real example of its own course', () => {
    for (const c of COURSE_ORDER) {
      expect(SAMPLE_SHEET_PICKS[c].length).toBeGreaterThanOrEqual(3)
      for (const id of SAMPLE_SHEET_PICKS[c]) {
        const def = EXAMPLE_DEFS.find((d) => d.id === id)
        expect(def, id).toBeDefined()
        expect(def!.course).toBe(c)
      }
    }
  })

  it('takes three figures from one course, in turn from several, AP Calculus when none is chosen', () => {
    expect(sampleSheetDefs(['precalc']).map((d) => d.id)).toEqual(SAMPLE_SHEET_PICKS.precalc.slice(0, 3))
    expect(sampleSheetDefs(['math1', 'calc']).map((d) => d.id)).toEqual([
      SAMPLE_SHEET_PICKS.calc[0],
      SAMPLE_SHEET_PICKS.math1[0],
      SAMPLE_SHEET_PICKS.calc[1],
    ])
    expect(sampleSheetDefs(['calc', 'precalc', 'math1', 'math2']).map((d) => d.course)).toEqual(['calc', 'precalc', 'math1'])
    expect(sampleSheetDefs(null).map((d) => d.id)).toEqual(SAMPLE_SHEET_PICKS.calc.slice(0, 3))
    expect(sampleSheetDefs([]).map((d) => d.course)).toEqual(['calc', 'calc', 'calc'])
  })

  it('makes new documents and a worksheet that points at them, all loadable', () => {
    const made = buildSampleSheet({ courses: ['calc'], existingNames: ['Graph 1'], screen, now: 1_700_000_000_000 })
    expect(made.docs).toHaveLength(3)
    const ids = new Set(made.docs.map((d) => d.id))
    expect(ids.size).toBe(3)
    for (const id of ids) expect(id.startsWith('example_')).toBe(false)
    expect(made.sheet.items.map((i) => i.docId)).toEqual(made.docs.map((d) => d.id))
    expect(made.sheet.items.every((i) => typeof i.caption === 'string' && i.caption !== '')).toBe(true)
    expect(made.sheet.name).toBe('Example worksheet')
    expect(made.sheet.title).toBe('Example worksheet — AP Calculus AB / BC')
    expect(made.sheet.createdAt).toBe(1_700_000_000_000)
    // each document: named like an opened example, carrying its note, zero load problems
    for (const [i, doc] of made.docs.entries()) {
      const def = sampleSheetDefs(['calc'])[i]
      expect(doc.name).toBe(exampleDocName(def))
      expect(doc.createdAt).toBe(1_700_000_000_000)
      const res = deserializeDoc(serializeDoc(doc))
      expect(res.problems).toEqual([])
      expect(res.board?.note).toBe(def.note)
    }
    // the worksheet survives its own storage round trip unchanged
    const back = deserializeWorksheets(serializeWorksheets([made.sheet]))
    expect(back.problems).toEqual([])
    expect(back.sheets[0]).toEqual(made.sheet)
  })

  it('numbers a figure whose example the teacher already opened', () => {
    const def = sampleSheetDefs(['calc'])[0]
    const made = buildSampleSheet({ courses: ['calc'], existingNames: [exampleDocName(def)], screen })
    expect(made.docs[0].name).toBe(`${exampleDocName(def)} (2)`)
  })

  it('every pick prints: nothing left off its figure, and the sheet builds', () => {
    for (const c of COURSE_ORDER) {
      const made = buildSampleSheet({ courses: [c], existingNames: [], screen })
      const byId = new Map(made.docs.map((d) => [d.id, docModelFromJSON(serializeDoc(d), { screen })]))
      for (const [id, model] of byId) {
        expect(model, `${c} ${id}`).not.toBeNull()
        expect(model!.omitted, made.docs.find((d) => d.id === id)!.name).toEqual([])
        expect(() => docFigure(model!, { style: 'textbook', answers: false, widthCm: 8 })).not.toThrow()
      }
      const sheet = buildSheet(made.sheet, (id) => byId.get(id) ?? null, false)
      expect(sheet.figures).toHaveLength(3)
      expect(sheet.pages.length).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('US spelling on screen, British spelling still searchable', () => {
  const cmd = (id: string) => COMMANDS.find((c) => c.id === id)!

  it('folds British spellings in every search', () => {
    expect(normalize('Colour-blind safe colours')).toBe('color-blind safe colors')
    expect(normalize('Triangle centres, centred at O')).toBe('triangle centers, centered at o')
    expect(normalize('end behaviour, labelled, randomisation, analysed, grey')).toBe(
      'end behavior, labeled, randomization, analyzed, gray',
    )
  })

  it('"colour" and "centre" still find the renamed commands', () => {
    const safe = cmd('view-colour-safe')
    expect(safe.title).toBe('Color-blind-safe curve colors')
    expect(scoreCommand(safe, safe.title, 'colour')).toBeGreaterThan(0)
    expect(scoreCommand(safe, safe.title, 'colour blind')).toBeGreaterThan(0)
    const centres = cmd('shape-centres')
    expect(centres.title).toBe('Triangle centers')
    expect(scoreCommand(centres, centres.title, 'triangle centres')).toBeGreaterThan(0)
    expect(scoreCommand(centres, centres.title, 'circumcentre')).toBeGreaterThan(0)
  })

  it('the gallery search finds an example by its British spelling', () => {
    const centres = EXAMPLE_DEFS.find((d) => d.id === 'm2-triangle-centres')!
    expect(centres.title).toBe('Centers of an obtuse triangle and the Euler line')
    expect(exampleMatches(centres, 'centres euler')).toBe(true)
    expect(exampleMatches(centres, 'centers euler')).toBe(true)
  })
})

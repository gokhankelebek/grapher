// ============================================================================
// tests/studentShare.test.ts — a share link a student can open safely.
//
// A view-only link opened in reveal mode is a STUDENT's view: no teacher note
// (it held "44/3 ≈ 14.67"), no All / Reset / Reveal-off, no teacher tools.
// A view-only link without reveal hides the note too unless the teacher
// ticked "Include teacher note". An optional one-line "Question for
// students" rides in the link as a banner. Links made before any of this
// still open exactly as they did.
// ============================================================================

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { appSource } from './appSource'
import { deserializeDoc, docFromBoard, serializeDoc } from '../src/core/persist'
import type { BoardInput, DocMeta } from '../src/core/persist'
import {
  QUESTION_MAX,
  buildShareLink,
  cleanQuestion,
  decodeSharePayload,
  isStudentView,
  parseShareHash,
  shareDocJson,
  shareFragment,
  shareShowsNote,
  shareViewOf,
} from '../src/core/share'
import type { ShareFlags } from '../src/core/share'
import { openShare } from '../src/ui/shareOpen'
import { RevealControls } from '../src/ui/RevealControls'
import type { RevealControlsProps } from '../src/ui/RevealControls'
import { Toolbar } from '../src/ui/Toolbar'
import { COMMANDS, STUDENT_COMMANDS, availability } from '../src/ui/commands'
import type { CommandActions, CommandContext } from '../src/ui/commands'
import { ShareDialog, docHasNote } from '../src/ui/ShareDialog'
import { REVEAL_API_OFF, RevealContext, FamilyAnswerContext } from '../src/ui/RevealAnswer'
import type { RevealApi } from '../src/ui/RevealAnswer'
import { TransformSection } from '../src/ui/TransformEditor'
import { ExpFacts } from '../src/ui/ExpEditor'
import { safeReadTransform } from '../src/ui/transformLinks'
import { familyKey } from '../src/ui/reveal'

const META: DocMeta = { id: 'teacher-doc-1', name: 'Riemann sums converging', createdAt: 1000, modifiedAt: 2000 }
const NOTE = 'f(x) = x²/2 + 1 is symmetric, so both regions have area 44/3 ≈ 14.67. Ask why both sums underestimate.'

function boardWith(over: Partial<BoardInput> = {}): BoardInput {
  return {
    curves: [],
    styles: {},
    candidates: new Map(),
    exprSources: {},
    viewport: { center: { x: 0, y: 0 }, pxPerUnit: 40 },
    selectedId: null,
    mode: 'draw',
    ...over,
  } as BoardInput
}

const withNote = serializeDoc(docFromBoard(META, boardWith({ note: NOTE }), META.modifiedAt))
const noNote = serializeDoc(docFromBoard(META, boardWith(), META.modifiedAt))
const NO_STREAMS = {}

async function opened(url: string) {
  let n = 0
  const out = await openShare(new URL(url).hash, { load: deserializeDoc, newId: () => `fresh-${++n}`, now: () => 5000 }, NO_STREAMS)
  if (out.kind !== 'open') throw new Error('did not open')
  return out
}

// ---------------------------------------------------------------------------

describe('a view-only link in reveal mode is a student view', () => {
  const STUDENT: ShareFlags = { view: true, reveal: true }

  it('is recognised from the flags — old links included', () => {
    expect(isStudentView(STUDENT)).toBe(true)
    expect(isStudentView({ view: true, reveal: false })).toBe(false)
    expect(isStudentView({ view: false, reveal: true })).toBe(false)
    // a link made before this change: #view=1&reveal=1&doc=…
    const old = parseShareHash('#view=1&reveal=1&doc=zAAAA')
    expect(old.kind === 'share' && isStudentView(old.flags)).toBe(true)
  })

  it('hides the teacher note — even when the link asks for it', () => {
    expect(shareShowsNote(STUDENT)).toBe(false)
    expect(shareShowsNote({ ...STUDENT, note: true })).toBe(false)
    expect(shareViewOf(STUDENT)).toEqual({ viewOnly: true, student: true, noteHidden: true })
  })

  it('the link does not carry the note at all', async () => {
    const link = await buildShareLink('https://x/', withNote, STUDENT, NO_STREAMS)
    const out = await opened(link.url)
    expect(out.board.note ?? '').toBe('')
    const payload = parseShareHash(new URL(link.url).hash)
    if (payload.kind !== 'share') throw new Error('not a share')
    const json = await decodeSharePayload(payload.payload, NO_STREAMS)
    expect(json.ok && json.json.includes('14.67')).toBe(false)
  })

  it('the App hides the note, the teacher tools and the copy for a student', () => {
    const src = appSource()
    expect(src).toMatch(/shared\?\.noteHidden \? null/)
    expect(src).toMatch(/<RevealControls \{\.\.\.revealControls\} student=\{student\} \/>/)
    expect(src).toMatch(/student \? undefined : \(/) // the toolbar's Reveal / Present / Download
    expect(src).toMatch(/onMakeCopy=\{student \? undefined/)
    expect(src).toMatch(/onShare=\{student \? undefined/)
  })
})

const CONTROLS: RevealControlsProps = {
  on: true,
  hidden: 9,
  total: 9,
  positions: true,
  onToggle: () => {},
  onNext: () => {},
  onAll: () => {},
  onReset: () => {},
  onPositions: () => {},
}

describe('the reveal bar a student gets: Next and the counter', () => {
  it('no All, no Reset, no way to turn reveal mode off', () => {
    const html = renderToStaticMarkup(createElement(RevealControls, { ...CONTROLS, student: true }))
    expect(html).toContain('data-testid="reveal-next"')
    expect(html).toContain('0 of 9 revealed')
    expect(html).not.toContain('reveal-all')
    expect(html).not.toContain('reveal-reset')
    expect(html).not.toContain('reveal-toggle')
    expect(html).not.toContain('reveal-positions')
  })

  it('the teacher keeps every control', () => {
    const html = renderToStaticMarkup(createElement(RevealControls, CONTROLS))
    for (const id of ['reveal-toggle', 'reveal-next', 'reveal-all', 'reveal-reset', 'reveal-positions']) {
      expect(html).toContain(`data-testid="${id}"`)
    }
  })

  it('the toolbar drops Analysis and Undo / Redo for a student', () => {
    const props = {
      sidebarOpen: false,
      canUndo: true,
      canRedo: true,
      showAnalysis: false,
      onToggleAnalysis: () => {},
      canvasTheme: 'dark' as const,
      onToggleCanvasTheme: () => {},
      onToggleSidebar: () => {},
      onUndo: () => {},
      onRedo: () => {},
    }
    const teacher = renderToStaticMarkup(createElement(Toolbar, props))
    const student = renderToStaticMarkup(createElement(Toolbar, { ...props, student: true }))
    expect(teacher).toContain('Analysis')
    expect(teacher).toContain('Undo')
    expect(student).not.toContain('Analysis')
    expect(student).not.toContain('Undo')
    expect(student).not.toContain('Redo')
  })

  it('the command palette offers a student only looking and stepping', () => {
    const actions = new Proxy({} as CommandActions, { get: () => () => {} })
    const ctx: CommandContext = {
      board: 'cartesian',
      readOnly: true,
      shared: true,
      student: true,
      selectedId: null,
      curves: [],
      fields: [],
      sequences: [],
      solves: [],
      canUndo: false,
      canRedo: false,
      hasContent: true,
      showAnalysis: false,
      canvasTheme: 'dark',
      presentMode: false,
      revealOn: true,
      sidebarOpen: false,
      figure: 'screen',
      previewFigure: false,
      exportFormat: 'png',
      axisX: 'auto',
      grid: 'cartesian',
      actions,
    }
    const offered = COMMANDS.filter((c) => availability(c, ctx).state !== 'hidden').map((c) => c.id)
    expect(offered).toContain('view-reveal-next')
    for (const id of ['view-reveal', 'view-present', 'view-analysis', 'export-download', 'doc-share', 'doc-make-copy', 'undo']) {
      expect(offered, id).not.toContain(id)
    }
    for (const id of offered) expect(STUDENT_COMMANDS.has(id), id).toBe(true)
    // every allowed id is a real command
    const ids = new Set(COMMANDS.map((c) => c.id))
    for (const id of STUDENT_COMMANDS) expect(ids.has(id), id).toBe(true)
    // and a teacher still has them all
    expect(availability(COMMANDS.find((c) => c.id === 'view-reveal')!, { ...ctx, student: false }).state).not.toBe('hidden')
  })

  it('R, A and F do nothing in a student view', () => {
    const src = appSource()
    expect(src).toMatch(/if \(!student\) toggleReveal\(\)/)
    expect(src).toMatch(/student && !meta && !e\.altKey && \(key === 'a' \|\| key === 'f'\)/)
  })
})

// ---------------------------------------------------------------------------

describe('"Include teacher note" (view only, without reveal)', () => {
  it('off by default: a view-only link hides the note and does not carry it', async () => {
    const flags: ShareFlags = { view: true, reveal: false }
    expect(shareShowsNote(flags)).toBe(false)
    expect(shareViewOf(flags)).toEqual({ viewOnly: true, noteHidden: true })
    const out = await opened((await buildShareLink('https://x/', withNote, flags, NO_STREAMS)).url)
    expect(out.board.note ?? '').toBe('')
    expect(out.flags).toEqual({ view: true, reveal: false })
  })

  it('ticked: the note travels and shows (note=1 before doc=)', async () => {
    const flags: ShareFlags = { view: true, reveal: false, note: true }
    expect(shareFragment('zAAA', flags)).toBe('#view=1&note=1&doc=zAAA')
    expect(shareShowsNote(flags)).toBe(true)
    expect(shareViewOf(flags)).toEqual({ viewOnly: true })
    const out = await opened((await buildShareLink('https://x/', withNote, flags, NO_STREAMS)).url)
    expect(out.board.note).toBe(NOTE)
    expect(out.flags).toEqual({ view: true, reveal: false, note: true })
  })

  it('an editable link is teacher to teacher: the note always travels', async () => {
    const flags: ShareFlags = { view: false, reveal: false }
    expect(shareShowsNote(flags)).toBe(true)
    expect(shareViewOf(flags)).toEqual({ viewOnly: false })
    const out = await opened((await buildShareLink('https://x/', withNote, flags, NO_STREAMS)).url)
    expect(out.board.note).toBe(NOTE)
  })

  it('stripping touches only the note: the rest of the document is byte-for-byte the same', () => {
    const stripped = shareDocJson(withNote, { view: true, reveal: false })
    expect(stripped).not.toContain('14.67')
    const a = deserializeDoc(stripped)
    const b = deserializeDoc(noNote)
    expect(a.problems).toEqual([])
    expect(serializeDoc(docFromBoard(META, a.board as never, META.modifiedAt))).toBe(
      serializeDoc(docFromBoard(META, b.board as never, META.modifiedAt)),
    )
    // nothing to strip, or not a document: passed through untouched
    expect(shareDocJson(noNote, { view: true, reveal: true })).toBe(noNote)
    expect(shareDocJson('not json', { view: true, reveal: true })).toBe('not json')
  })

  it('the dialog offers the checkbox only for a document that has a note, with View only on', () => {
    expect(docHasNote(withNote)).toBe(true)
    expect(docHasNote(noNote)).toBe(false)
    expect(docHasNote('garbage')).toBe(false)
    // first render: View only is off, so no checkbox yet; the question field is there
    const html = renderToStaticMarkup(
      createElement(ShareDialog, { name: 'Riemann', json: withNote, baseHref: 'https://x/', onClose: () => {} }),
    )
    expect(html).not.toContain('data-testid="share-note"')
    expect(html).toContain('data-testid="share-question"')
    expect(html).toContain(`maxLength="${QUESTION_MAX}"`)
  })
})

// ---------------------------------------------------------------------------

describe('"Question for students": one line, in the link only', () => {
  it('rides before doc=, percent-encoded, and comes back as typed', async () => {
    const q = 'Which sum is closer to 44/3 — and why? (n = 4 & n = 50)'
    const frag = shareFragment('zAAA', { view: true, reveal: true, question: q })
    expect(frag.indexOf('q=')).toBeLessThan(frag.indexOf('doc='))
    const parsed = parseShareHash(frag)
    expect(parsed).toMatchObject({ kind: 'share', flags: { view: true, reveal: true, question: q } })
    const out = await opened((await buildShareLink('https://x/', withNote, { view: true, reveal: true, question: q }, NO_STREAMS)).url)
    expect(out.flags.question).toBe(q)
    expect(shareViewOf(out.flags)).toEqual({ viewOnly: true, student: true, noteHidden: true, question: q })
  })

  it('is never in the document', async () => {
    const out = await opened((await buildShareLink('https://x/', noNote, { view: true, reveal: false, question: 'Find the zeros.' }, NO_STREAMS)).url)
    expect(JSON.stringify(out.board)).not.toContain('Find the zeros')
  })

  it('is one clean line of at most QUESTION_MAX characters', () => {
    expect(cleanQuestion('  Where\n does f\tcross\u0000 the axis?  ')).toBe('Where does f cross the axis?')
    expect(cleanQuestion('x'.repeat(500))).toHaveLength(QUESTION_MAX)
    expect(cleanQuestion(42)).toBe('')
    expect(cleanQuestion('   ')).toBe('')
    expect(shareFragment('zAAA', { view: false, reveal: false, question: '   ' })).toBe('#doc=zAAA')
    // a hand-edited link with a monstrous question is cut down, not refused
    const long = parseShareHash(`#q=${'a'.repeat(5000)}&doc=zAA`)
    expect(long.kind === 'share' && long.flags.question?.length).toBe(QUESTION_MAX)
  })

  it('the App shows it as a banner, under the Shared banner', () => {
    const src = appSource()
    expect(src).toMatch(/shared\.question && \(/)
    expect(src).toMatch(/data-testid="share-question-banner"/)
  })
})

// ---------------------------------------------------------------------------

describe('old links still open', () => {
  it('flags are exactly the two they always were', () => {
    expect(parseShareHash('#doc=zAA')).toEqual({ kind: 'share', payload: 'zAA', flags: { view: false, reveal: false } })
    expect(parseShareHash('#view=1&reveal=1&doc=zAA')).toEqual({
      kind: 'share',
      payload: 'zAA',
      flags: { view: true, reveal: true },
    })
  })

  it('an old view-only link that carried a note opens, with the note kept in the document but hidden', async () => {
    // Built the way the old dialog built it: the note inside, no note=1.
    const { encodeSharePayload } = await import('../src/core/share')
    const { payload } = await encodeSharePayload(withNote, NO_STREAMS)
    const out = await opened(`https://x/#view=1&doc=${payload}`)
    expect(out.board.note).toBe(NOTE) // nothing about the document changed
    expect(shareViewOf(out.flags)).toEqual({ viewOnly: true, noteHidden: true }) // …but it is not shown
  })

  it('an old editable link opens as it did, note and all', async () => {
    const { encodeSharePayload } = await import('../src/core/share')
    const { payload } = await encodeSharePayload(withNote, NO_STREAMS)
    const out = await opened(`https://x/#doc=${payload}`)
    expect(out.board.note).toBe(NOTE)
    expect(shareViewOf(out.flags)).toEqual({ viewOnly: false })
  })
})

// ---------------------------------------------------------------------------

const ON: RevealApi = {
  ...REVEAL_API_OFF,
  on: true,
  hidden: () => true,
}

function section(api: RevealApi, key: string | null): string {
  const spec = safeReadTransform('y = (1/2)x^2 + 1')
  if (!spec) throw new Error('fixture did not read as a transformation')
  return renderToStaticMarkup(
    createElement(
      RevealContext.Provider,
      { value: api },
      createElement(
        FamilyAnswerContext.Provider,
        { value: key },
        createElement(TransformSection, { spec, defaultOpen: true, showParent: false, onRestate: () => null }),
      ),
    ),
  )
}

describe('the Transformation section is masked like every other answer', () => {
  it('reveal mode: the image column says "?" and the vertex and features are one pill', () => {
    const html = section(ON, familyKey('f'))
    expect(html).toContain('data-testid="transform-map"')
    expect(html).not.toContain('(−2, 3)')
    expect(html).not.toContain('vertex: (0, 1)')
    expect(html).toContain('data-testid="transform-facts-hidden"')
    expect(html).toContain(`data-reveal-key="${familyKey('f')}"`)
    // what was typed still shows: the parent column and the steps
    expect(html).toContain('(−2, 4)')
    expect(html).toContain('shift up 1')
  })

  it('revealed, or reveal mode off: everything shows', () => {
    for (const api of [REVEAL_API_OFF, { ...ON, hidden: () => false }]) {
      const html = section(api, familyKey('f'))
      expect(html).toContain('(−2, 3)')
      expect(html).toContain('vertex: (0, 1)')
    }
  })

  it('a Build preview (no card, no key) is never masked', () => {
    expect(section(ON, null)).toContain('(−2, 3)')
  })

  it('the family facts lists beside it (Exponential, Sinusoidal …) hide under the same key', () => {
    const facts = (api: RevealApi, key: string | null): string =>
      renderToStaticMarkup(
        createElement(
          RevealContext.Provider,
          { value: api },
          createElement(
            FamilyAnswerContext.Provider,
            { value: key },
            createElement(ExpFacts, { sentences: ['grows by a factor of 2 per unit'], features: ['asymptote: y = 3'] }),
          ),
        ),
      )
    expect(facts(ON, familyKey('f'))).not.toContain('asymptote')
    expect(facts(ON, familyKey('f'))).toContain('data-reveal-key')
    expect(facts(ON, null)).toContain('asymptote: y = 3')
    expect(facts(REVEAL_API_OFF, familyKey('f'))).toContain('asymptote: y = 3')
  })

  it('the board keeps the image marks and arrows off while the facts are hidden', () => {
    const src = appSource()
    expect(src).toMatch(/isHidden\(reveal, familyKey\(selectedTransform\.id\)\)/)
    expect(src).toMatch(/selectedTransform\?\.marks && !transformHidden/)
    expect(src).toMatch(/if \(!transformHidden\) \{\s*out\.push\(\.\.\.keyPointArrows/)
  })
})

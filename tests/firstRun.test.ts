// ============================================================================
// tests/firstRun.test.ts — the first run, course focus and honest storage:
// who sees the course chooser, how Build ▾ is grouped and ordered by course,
// the gallery's default filter, where the help sheet opens, the settings
// menu, the backup round-trip (byte-identical), the backup reminder and the
// new optional preferences.
// ============================================================================

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  BACKUP_REMIND_MS,
  BUILD_SECTIONS,
  COURSES,
  DAY_MS,
  backupReminderDue,
  buildSectionOrder,
  cleanCourses,
  coursesLabel,
  coursesTipDue,
  galleryFilterFor,
  helpOpensOn,
  shouldShowFirstRun,
} from '../src/ui/courses'
import type { CourseId } from '../src/ui/courses'
import { BuildFocus, BuildMenu, buildRows } from '../src/ui/BuildMenu'
import { FirstRun } from '../src/ui/FirstRun'
import { Toolbar } from '../src/ui/Toolbar'
import { AboutDialog } from '../src/ui/AboutDialog'
import { ExampleGallery } from '../src/ui/ExampleGallery'
import { COURSE_ORDER, EXAMPLE_DEFS, buildExample, galleryGroups, hiddenMatches } from '../src/examples'
import { HELP_COURSES, COMMAND_BY_ID, availability, paletteRows } from '../src/ui/commands'
import type { CommandActions, CommandContext } from '../src/ui/commands'
import {
  BACKUP_APP,
  makeBackup,
  parseBackup,
  restoreBackup,
  restoreSummary,
  serializeBackup,
} from '../src/ui/backup'
import type { BackupIO } from '../src/ui/backup'
import type { StoredDoc, Worksheet } from '../src/core/persist'
import { serializeDoc } from '../src/core/persist'
import { listWorksheets, readDocJSON, readIndex, readPrefs, updatePrefs, writeDoc, writePrefs } from '../src/ui/storage'
import { storageBackupIO, feedbackHref } from '../src/app/useCourseFocus'
import { ISSUES_URL, FEEDBACK_URL, PRIVACY_LINE } from '../src/brand'

// ---------------------------------------------------------------------------
// A localStorage of our own (node has none) — never the user's.
// ---------------------------------------------------------------------------

let saved: unknown
let store: Map<string, string>
function stubStorage(): void {
  saved = (globalThis as { localStorage?: unknown }).localStorage
  store = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size
    },
  }
}
function restoreStorage(): void {
  ;(globalThis as { localStorage?: unknown }).localStorage = saved
}

const SHARE_HASH = '#doc=eyJhIjoxfQ'

// ---------------------------------------------------------------------------
// First-run gating
// ---------------------------------------------------------------------------

describe('first run: who sees "What do you teach?"', () => {
  const base = { savedDocs: 0, courses: undefined, search: '?app=1', hash: '' }

  it('a new teacher (no documents, never asked) does', () => {
    expect(shouldShowFirstRun(base)).toBe(true)
  })

  it('an existing teacher with saved documents never does', () => {
    expect(shouldShowFirstRun({ ...base, savedDocs: 1 })).toBe(false)
    expect(shouldShowFirstRun({ ...base, savedDocs: 174 })).toBe(false)
  })

  it('a teacher who already answered (or skipped) is not asked again', () => {
    expect(shouldShowFirstRun({ ...base, courses: [] })).toBe(false)
    expect(shouldShowFirstRun({ ...base, courses: ['calc'] })).toBe(false)
  })

  it('a share link never shows it — edit, view-only or a student in reveal mode', () => {
    for (const hash of [SHARE_HASH, `#view=1&${SHARE_HASH.slice(1)}`, `#view=1&reveal=1&${SHARE_HASH.slice(1)}`]) {
      expect(shouldShowFirstRun({ ...base, hash }), hash).toBe(false)
    }
  })

  it('the landing page’s gallery link (?app=1&gallery=1) opens the gallery instead', () => {
    expect(shouldShowFirstRun({ ...base, search: '?app=1&gallery=1' })).toBe(false)
    expect(shouldShowFirstRun({ ...base, search: '?gallery=1&app=1' })).toBe(false)
  })

  it('the existing teacher gets a one-time settings tip instead, until they choose or dismiss it', () => {
    expect(coursesTipDue(undefined, false)).toBe(true)
    expect(coursesTipDue(undefined, true)).toBe(false)
    expect(coursesTipDue([], false)).toBe(false)
    expect(coursesTipDue(['calc'], false)).toBe(false)
  })

  it('the chooser offers the six courses as toggle chips, and Skip', () => {
    const html = renderToStaticMarkup(createElement(FirstRun, { mode: 'first', onFinish: () => {} }))
    expect(html).toContain('What do you teach?')
    for (const c of COURSES) expect(html).toContain(`data-course="${c.id}"`)
    expect(html.match(/aria-pressed="false"/g)?.length).toBe(6)
    expect(html).toContain('data-testid="first-run-skip"')
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(COURSES.map((c) => c.name)).toEqual([
      'AP Calculus AB/BC', 'AP Precalculus', 'NC Math 1', 'NC Math 2', 'NC Math 3', 'Other / just exploring',
    ])
  })

  it('step two: sketch, an example, a worksheet', () => {
    const html = renderToStaticMarkup(createElement(FirstRun, { mode: 'first', startStep: 2, onFinish: () => {} }))
    for (const s of ['sketch', 'examples', 'worksheet']) expect(html).toContain(`data-start="${s}"`)
    expect(html).toContain('Sketch a curve')
    expect(html).toContain('Open an example')
    expect(html).toContain('Make a worksheet')
  })

  it('settings mode is only the chips, with the current choice pressed, and Save', () => {
    const html = renderToStaticMarkup(
      createElement(FirstRun, { mode: 'settings', initial: ['precalc'], onSave: () => {}, onCancel: () => {} }),
    )
    expect(html).toContain('Your courses')
    expect(html).toMatch(/aria-pressed="true"[^>]*data-course="precalc"/)
    expect(html).toContain('data-testid="courses-save"')
    expect(html).not.toContain('data-start=')
  })
})

// ---------------------------------------------------------------------------
// Build ▾: grouped, ordered by course, nothing out of reach
// ---------------------------------------------------------------------------

const ALL_TOGGLES = {
  factorOpen: false,
  expOpen: false,
  onFactorToggle: () => {},
  onExpToggle: () => {},
  onLogisticToggle: () => {},
  onLogToggle: () => {},
  onSinToggle: () => {},
  onTransformToggle: () => {},
  onPiecewiseToggle: () => {},
  onConicToggle: () => {},
  onMotionToggle: () => {},
  onSeqToggle: () => {},
  onDataAdd: () => {},
  onUnitCircleAdd: () => {},
  onRelatedRatesAdd: () => {},
  onNormalAdd: () => {},
  onSimulationAdd: () => {},
  onDataPlotAdd: () => {},
  onProbabilityAdd: () => {},
}
const FOCUS_ACTIONS = { onTypeLine: () => {}, onSolveInequality: () => {} }

function menuFor(courses: CourseId[] | undefined): string {
  return renderToStaticMarkup(
    createElement(
      BuildFocus.Provider,
      { value: { courses, ...FOCUS_ACTIONS } },
      createElement(BuildMenu, { ...ALL_TOGGLES, initialOpen: true }),
    ),
  )
}
const sectionsIn = (html: string): string[] => [...html.matchAll(/data-section="([a-z]+)"/g)].map((m) => m[1])

describe('Build ▾: sections by course', () => {
  it('has the five sections, in this order', () => {
    expect(BUILD_SECTIONS.map((s) => s.title)).toEqual([
      'Functions', 'Calculus', 'Geometry', 'Statistics & probability', 'Number line',
    ])
  })

  it('no courses (every existing user, or skipped): everything shown as before, only grouped', () => {
    for (const c of [undefined, [] as CourseId[], ['other'] as CourseId[]]) {
      expect(buildSectionOrder(c)).toEqual({
        shown: ['functions', 'calculus', 'geometry', 'stats', 'numberline'],
        more: [],
      })
      const html = menuFor(c)
      expect(sectionsIn(html)).toEqual(['functions', 'calculus', 'geometry', 'stats', 'numberline'])
      expect(html).not.toContain('data-testid="build-more"')
    }
  })

  it('AP Calculus: Calculus first, then Functions; the rest under More…', () => {
    expect(buildSectionOrder(['calc'])).toEqual({
      shown: ['calculus', 'functions'],
      more: ['geometry', 'stats', 'numberline'],
    })
    const html = menuFor(['calc'])
    expect(sectionsIn(html)).toEqual(['calculus', 'functions'])
    expect(html).toContain('data-testid="build-more"')
    expect(html).toContain('More…')
    expect(html).toContain('Geometry · Statistics &amp; probability · Number line')
    // the tucked-away items wait behind More…, they are not gone
    expect(html).not.toContain('data-testid="build-normal"')
  })

  it('AP Precalculus: Functions and the number line', () => {
    expect(buildSectionOrder(['precalc']).shown).toEqual(['functions', 'numberline'])
  })

  it('NC Math 1, 2 and 3 bring their own sections; several courses merge in course order', () => {
    expect(buildSectionOrder(['math1']).shown).toEqual(['functions', 'stats', 'geometry', 'numberline'])
    expect(buildSectionOrder(['math2']).shown).toEqual(['functions', 'geometry', 'stats'])
    expect(buildSectionOrder(['math3']).shown).toEqual(['functions', 'geometry', 'numberline', 'stats'])
    expect(buildSectionOrder(['calc', 'precalc'])).toEqual({
      shown: ['calculus', 'functions', 'numberline'],
      more: ['geometry', 'stats'],
    })
  })

  it('“Other / just exploring” with a course: that course first, nothing tucked away', () => {
    expect(buildSectionOrder(['calc', 'other'])).toEqual({
      shown: ['calculus', 'functions', 'geometry', 'stats', 'numberline'],
      more: [],
    })
  })

  it('every course can reach every item: shown + more is always all five sections', () => {
    const all = BUILD_SECTIONS.map((s) => s.id).sort()
    const combos: (CourseId[] | undefined)[] = [undefined, [], ...COURSES.map((c) => [c.id]), ['calc', 'math2']]
    for (const c of combos) {
      const { shown, more } = buildSectionOrder(c)
      expect([...shown, ...more].sort(), JSON.stringify(c)).toEqual(all)
    }
  })

  it('keeps every item the flat menu had (same test ids), each in one section', () => {
    const rows = buildRows(ALL_TOGGLES, FOCUS_ACTIONS)
    const ids = rows.map((r) => r.testId)
    for (const id of [
      'build-roots', 'build-exp', 'build-logistic', 'build-log', 'build-sin', 'build-transform', 'build-piecewise',
      'build-conic', 'build-motion', 'build-seq', 'build-data', 'build-unit-circle', 'build-related-rates',
      'build-normal', 'build-simulation', 'build-data-plot', 'build-probability',
    ]) {
      expect(ids, id).toContain(id)
    }
    expect(new Set(ids).size).toBe(ids.length)
    const sectionOf = (id: string): string | undefined => rows.find((r) => r.testId === id)?.section
    expect(sectionOf('build-logistic')).toBe('calculus')
    expect(sectionOf('build-related-rates')).toBe('calculus')
    expect(sectionOf('build-slope-field')).toBe('calculus')
    expect(sectionOf('build-log')).toBe('functions')
    expect(sectionOf('build-simulation')).toBe('stats')
    expect(sectionOf('build-conic')).toBe('geometry')
    expect(sectionOf('build-nl-solve')).toBe('numberline')
    // the + box seeds and the solver only appear when the App wires them
    expect(buildRows(ALL_TOGGLES).map((r) => r.testId)).not.toContain('build-slope-field')
  })

  it('a builder stays a radio item that is ticked when open; an action is a plain item', () => {
    const rows = buildRows({ ...ALL_TOGGLES, expOpen: true })
    expect(rows.find((r) => r.testId === 'build-exp')?.on).toBe(true)
    expect(rows.find((r) => r.testId === 'build-normal')?.on).toBeUndefined()
  })

  it('takes the keyboard like the other menus', () => {
    const html = menuFor(['calc'])
    expect(html).toContain('role="menu"')
    expect(html).toContain('role="group"')
  })
})

// ---------------------------------------------------------------------------
// Gallery and help sheet
// ---------------------------------------------------------------------------

describe('the examples gallery opens on the teacher’s courses', () => {
  it('maps the chosen courses to the catalog’s own course ids', () => {
    for (const c of COURSES) if (c.id !== 'other') expect(COURSE_ORDER).toContain(c.id)
    expect(galleryFilterFor(undefined)).toBeNull()
    expect(galleryFilterFor([])).toBeNull()
    expect(galleryFilterFor(['other'])).toBeNull()
    expect(galleryFilterFor(['precalc', 'calc'])).toEqual(['calc', 'precalc'])
    expect(galleryFilterFor(['math2', 'other'])).toEqual(['math2'])
  })

  it('a filter keeps only those courses; null keeps them all', () => {
    expect(galleryGroups('', ['calc']).map((g) => g.course)).toEqual(['calc'])
    expect(galleryGroups('', ['math1', 'precalc']).map((g) => g.course)).toEqual(['precalc', 'math1'])
    expect(galleryGroups('', null).map((g) => g.course)).toEqual([...COURSE_ORDER])
    const n = galleryGroups('', null).reduce((k, g) => k + g.units.reduce((m, u) => m + u.examples.length, 0), 0)
    expect(n).toBe(EXAMPLE_DEFS.length)
  })

  it('says how many matches the filter hides', () => {
    expect(hiddenMatches('probability', null)).toBe(0)
    expect(hiddenMatches('', ['calc'])).toBe(EXAMPLE_DEFS.filter((d) => d.course !== 'calc').length)
  })

  it('renders with the chosen courses pressed and the others out of the list', () => {
    const html = renderToStaticMarkup(
      createElement(ExampleGallery, { defaultCourses: ['calc'], onOpen: () => {}, onClose: () => {} }),
    )
    expect(html).toMatch(/aria-pressed="true"[^>]*data-course-filter="calc"/)
    expect(html).toMatch(/aria-pressed="false"[^>]*data-course-filter="all"/)
    expect(html).toContain('data-course="calc"')
    expect(html).not.toContain('data-course="math1"')
  })

  it('with no courses chosen it shows every course, as before', () => {
    const html = renderToStaticMarkup(createElement(ExampleGallery, { onOpen: () => {}, onClose: () => {} }))
    expect(html).toMatch(/aria-pressed="true"[^>]*data-course-filter="all"/)
    for (const c of COURSE_ORDER) expect(html).toContain(`data-course="${c}"`)
  })

  it('a link to one unit’s examples ignores the filter (the unit may be in any course)', () => {
    const html = renderToStaticMarkup(
      createElement(ExampleGallery, { defaultCourses: ['calc'], focusSection: 'm2-prob', onOpen: () => {}, onClose: () => {} }),
    )
    expect(html).toContain('data-course="math2"')
  })
})

describe('the help sheet opens on the first chosen course', () => {
  it('names a heading the sheet has', () => {
    for (const c of COURSES) {
      const home = helpOpensOn([c.id])
      if (c.id === 'other') expect(home).toBeNull()
      else expect(HELP_COURSES).toContain(home)
    }
    expect(helpOpensOn(undefined)).toBeNull()
    expect(helpOpensOn(['math3', 'precalc'])).toBe('AP Precalculus') // the chooser's order
  })

  it('labels the choice', () => {
    expect(coursesLabel(['calc', 'precalc'])).toBe('AP Calculus · AP Precalculus')
    expect(coursesLabel([])).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Toolbar: Examples, and one settings menu
// ---------------------------------------------------------------------------

const TOOLBAR = {
  sidebarOpen: true,
  canUndo: true,
  canRedo: false,
  showAnalysis: true,
  onToggleAnalysis: () => {},
  canvasTheme: 'dark' as const,
  onToggleCanvasTheme: () => {},
  onToggleSidebar: () => {},
  onUndo: () => {},
  onRedo: () => {},
  onExamples: () => {},
  onDescribe: () => {},
  onCurvePalette: () => {},
}

describe('the toolbar', () => {
  it('has an Examples button and a settings gear — no moon, no ⋯', () => {
    const html = renderToStaticMarkup(createElement(Toolbar, TOOLBAR))
    expect(html).toContain('data-testid="toolbar-examples"')
    expect(html).toContain('data-testid="toolbar-settings"')
    expect(html).not.toContain('data-testid="toolbar-more"')
    expect(html).not.toContain('Toggle canvas background')
  })

  it('a student keeps the gear but gets no Examples button', () => {
    const html = renderToStaticMarkup(createElement(Toolbar, { ...TOOLBAR, student: true }))
    expect(html).toContain('data-testid="toolbar-settings"')
    expect(html).not.toContain('data-testid="toolbar-examples"')
  })

  it('the tip puts a dot on the gear', () => {
    const html = renderToStaticMarkup(
      createElement(Toolbar, { ...TOOLBAR, settings: { tipDue: true, onCourses: () => {} } }),
    )
    expect(html).toContain('tb-tip-dot')
    expect(html).toContain('a tip is waiting')
  })
})

describe('About & privacy, and feedback', () => {
  it('says the promise and the same privacy line as the landing page', () => {
    const html = renderToStaticMarkup(createElement(AboutDialog, { onClose: () => {} }))
    expect(html).toContain('Free for teachers. No account. Nothing leaves your device.')
    expect(html).toContain(PRIVACY_LINE.replace(/&/g, '&amp;'))
    expect(html).toContain('github.com/gokhankelebek/grapher')
  })

  it('feedback goes to the issue tracker until FEEDBACK_URL is set', () => {
    expect(feedbackHref()).toBe(FEEDBACK_URL || ISSUES_URL)
    if (!FEEDBACK_URL) expect(feedbackHref()).toBe('https://github.com/gokhankelebek/grapher/issues')
  })
})

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function recorder(): { actions: CommandActions; calls: string[] } {
  const calls: string[] = []
  const actions = new Proxy({} as CommandActions, {
    get: (_t, name: string) => () => void calls.push(name),
  })
  return { actions, calls }
}
function ctxOf(over: Partial<CommandContext> = {}): CommandContext {
  return {
    board: 'cartesian', readOnly: false, shared: false, selectedId: null, curves: [], fields: [], sequences: [],
    solves: [], canUndo: false, canRedo: false, hasContent: false, showAnalysis: true, canvasTheme: 'dark',
    presentMode: false, revealOn: false, sidebarOpen: true, figure: 'screen', previewFigure: false,
    exportFormat: 'png', axisX: 'auto', grid: 'cartesian', actions: recorder().actions, ...over,
  }
}

describe('commands: Your courses, Save a backup, Restore from backup, About', () => {
  const IDS = ['settings-courses', 'backup-save', 'backup-restore', 'about', 'feedback']

  it('are in the registry and run the App’s callbacks', () => {
    const rec = recorder()
    const ctx = ctxOf({ actions: rec.actions })
    for (const id of IDS) {
      const cmd = COMMAND_BY_ID.get(id)
      expect(cmd, id).toBeDefined()
      expect(availability(cmd!, ctx).state, id).toBe('ready')
      cmd!.run(ctx)
    }
    expect(rec.calls).toEqual(['openCourses', 'backupAll', 'restoreBackup', 'about', 'feedback'])
  })

  it('a teacher’s words find them', () => {
    const ctx = ctxOf()
    const first = (q: string): string => paletteRows(ctx, q)[0]?.cmd.id ?? '(none)'
    expect(first('your courses')).toBe('settings-courses')
    expect(first('what i teach')).toBe('settings-courses')
    expect(first('restore')).toBe('backup-restore')
    expect(first('privacy')).toBe('about')
    expect(first('feedback')).toBe('feedback')
    expect(paletteRows(ctx, 'backup').map((r) => r.cmd.id)).toContain('backup-save')
  })

  it('a student can read About, nothing else of these', () => {
    const ctx = ctxOf({ student: true, readOnly: true, shared: true })
    expect(availability(COMMAND_BY_ID.get('about')!, ctx).state).toBe('ready')
    for (const id of ['settings-courses', 'backup-save', 'backup-restore', 'feedback']) {
      expect(availability(COMMAND_BY_ID.get(id)!, ctx).state, id).toBe('hidden')
    }
  })
})

// ---------------------------------------------------------------------------
// Backup round-trip
// ---------------------------------------------------------------------------

function exampleDocs(n: number): StoredDoc[] {
  return EXAMPLE_DEFS.slice(0, n).map((d) => JSON.parse(buildExample(d).json) as StoredDoc)
}

function memoryIO(docs: StoredDoc[] = [], sheets: Worksheet[] = []): BackupIO & { raw: Map<string, string>; sheets: Worksheet[] } {
  const raw = new Map(docs.map((d) => [d.id, serializeDoc(d)]))
  const io = {
    raw,
    sheets: sheets.slice(),
    docIds: () => [...raw.keys()],
    readDoc: (id: string) => raw.get(id) ?? null,
    writeDoc: (doc: StoredDoc) => {
      raw.set(doc.id, serializeDoc(doc))
      return true
    },
    worksheets: () => io.sheets,
    writeWorksheet: (w: Worksheet) => {
      io.sheets = [w, ...io.sheets.filter((x) => x.id !== w.id)]
      return true
    },
  }
  return io
}

const SHEET: Worksheet = {
  id: 'ws_1',
  name: 'Unit 6 quiz',
  page: 'letter',
  orientation: 'portrait',
  cols: 2,
  items: [],
  numbering: 'letters',
  createdAt: 1,
  modifiedAt: 2,
} as unknown as Worksheet

describe('backup: every document out and back, byte-identical', () => {
  it('round-trips through a file into an empty browser', () => {
    const docs = exampleDocs(12)
    const from = memoryIO(docs, [SHEET])
    const { backup, skipped } = makeBackup(from, 1_700_000_000_000)
    expect(skipped).toBe(0)
    expect(backup.app).toBe(BACKUP_APP)
    const text = serializeBackup(backup)
    const parsed = parseBackup(text)
    expect(parsed.kind).toBe('backup')
    if (parsed.kind !== 'backup') return
    const to = memoryIO()
    const report = restoreBackup(parsed.backup, to)
    expect(report).toMatchObject({ added: 12, restoredBeside: 0, kept: 0, failed: 0 })
    for (const d of docs) expect(to.raw.get(d.id)).toBe(from.raw.get(d.id))
    expect(restoreSummary(report)).toMatch(/^Restored 12 documents/)
  })

  it('restoring twice changes nothing the second time', () => {
    const docs = exampleDocs(3)
    const b = makeBackup(memoryIO(docs)).backup
    const to = memoryIO()
    restoreBackup(b, to)
    const before = new Map(to.raw)
    const again = restoreBackup(b, to)
    expect(again).toMatchObject({ added: 0, restoredBeside: 0, kept: 3 })
    expect(to.raw).toEqual(before)
  })

  it('never overwrites: newer work here is kept; a newer backup copy comes back beside it', () => {
    const [a, b] = exampleDocs(2)
    const backup = makeBackup(memoryIO([a, b])).backup
    const here = memoryIO([
      { ...a, name: 'edited since', modifiedAt: a.modifiedAt + 1000 }, // newer here
      { ...b, name: 'older here', modifiedAt: b.modifiedAt - 1000 }, // older here
    ])
    const hereA = here.raw.get(a.id)
    const hereB = here.raw.get(b.id)
    const report = restoreBackup(backup, here)
    expect(report).toMatchObject({ added: 0, kept: 1, restoredBeside: 1 })
    expect(here.raw.get(a.id)).toBe(hereA)
    expect(here.raw.get(b.id)).toBe(hereB)
    const beside = [...here.raw.values()].map((s) => JSON.parse(s) as StoredDoc).find((d) => d.name.endsWith('(restored)'))
    expect(beside?.name).toBe(`${b.name} (restored)`)
    expect(beside?.id).not.toBe(b.id)
    expect(JSON.stringify(beside?.board)).toBe(JSON.stringify(b.board))
  })

  it('adds worksheets it does not have, keeps the ones it does', () => {
    const b = makeBackup(memoryIO([], [SHEET])).backup
    const to = memoryIO([], [])
    expect(restoreBackup(b, to).worksheets).toBe(1)
    expect(restoreBackup(b, to).worksheets).toBe(0)
  })

  it('a single document file is not a backup (the ordinary import takes it); junk is reported', () => {
    const one = serializeDoc(exampleDocs(1)[0])
    expect(parseBackup(one).kind).toBe('not-backup')
    expect(parseBackup('not json').kind).toBe('not-backup')
    expect(parseBackup(JSON.stringify({ app: BACKUP_APP, version: 1 })).kind).toBe('error')
    const mixed = parseBackup(JSON.stringify({ app: BACKUP_APP, version: 1, savedAt: 1, docs: [exampleDocs(1)[0], { nope: 1 }] }))
    expect(mixed.kind).toBe('backup')
    if (mixed.kind === 'backup') {
      expect(mixed.backup.docs).toHaveLength(1)
      expect(mixed.problems.join(' ')).toMatch(/1 damaged document was skipped/)
    }
  })

  describe('through this browser’s storage', () => {
    beforeEach(stubStorage)
    afterEach(restoreStorage)

    it('stored documents come back with the same bytes under the same keys', () => {
      const docs = exampleDocs(6)
      for (const d of docs) expect(writeDoc(d).ok).toBe(true)
      const before = docs.map((d) => readDocJSON(d.id))
      const file = serializeBackup(makeBackup(storageBackupIO).backup)
      // a cleared browser
      store.clear()
      expect(readIndex().docs).toHaveLength(0)
      const parsed = parseBackup(file)
      if (parsed.kind !== 'backup') throw new Error('not a backup')
      expect(restoreBackup(parsed.backup, storageBackupIO).added).toBe(6)
      expect(docs.map((d) => readDocJSON(d.id))).toEqual(before)
      expect(readIndex().docs.map((d) => d.id).sort()).toEqual(docs.map((d) => d.id).sort())
      expect(listWorksheets()).toEqual([])
    })
  })
})

describe('the backup reminder: every two weeks with more than five documents', () => {
  const now = 1_800_000_000_000
  const old = now - 30 * DAY_MS

  it('not with five documents or fewer', () => {
    expect(backupReminderDue({ now, docs: 5, oldestCreatedAt: old })).toBe(false)
  })

  it('due two weeks after the first document, the last backup or the last “Not now”', () => {
    expect(backupReminderDue({ now, docs: 6, oldestCreatedAt: old })).toBe(true)
    expect(backupReminderDue({ now, docs: 6, oldestCreatedAt: now - 3 * DAY_MS })).toBe(false)
    expect(backupReminderDue({ now, docs: 6, oldestCreatedAt: old, lastBackupAt: now - DAY_MS })).toBe(false)
    expect(backupReminderDue({ now, docs: 6, oldestCreatedAt: old, backupRemindAt: now - DAY_MS })).toBe(false)
    expect(backupReminderDue({ now, docs: 6, oldestCreatedAt: old, lastBackupAt: now - BACKUP_REMIND_MS })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

describe('preferences: the new keys are optional', () => {
  beforeEach(stubStorage)
  afterEach(restoreStorage)

  it('a prefs record from before reads exactly as it did — no new keys appear', () => {
    const old = {
      showAnalysis: false, canvasTheme: 'light', exportByDoc: {}, presentScale: 3, wheel: 'pan',
      setNotation: 'builder', exportFormat: 'pdf', latexWidthCm: 10, sections: {}, recentCommands: ['help'],
      curvePalette: 'safe',
    }
    store.set('grapher.v1.prefs', JSON.stringify(old))
    const p = readPrefs()
    for (const k of ['courses', 'coursesTipDone', 'storageNoticeDone', 'lastBackupAt', 'backupRemindAt']) {
      expect(k in p, k).toBe(false)
    }
    expect(p.canvasTheme).toBe('light')
    expect(p.recentCommands).toEqual(['help'])
    // writing it back adds nothing either
    writePrefs(p)
    expect(Object.keys(JSON.parse(store.get('grapher.v1.prefs')!))).not.toContain('courses')
  })

  it('courses, the tip and the backup timestamps persist, and survive other updates', () => {
    updatePrefs({ courses: ['calc', 'precalc'] })
    updatePrefs({ coursesTipDone: true, storageNoticeDone: true, lastBackupAt: 123, backupRemindAt: 456 })
    updatePrefs({ showAnalysis: false })
    const p = readPrefs()
    expect(p.courses).toEqual(['calc', 'precalc'])
    expect(p).toMatchObject({ coursesTipDone: true, storageNoticeDone: true, lastBackupAt: 123, backupRemindAt: 456 })
  })

  it('an empty choice (skipped) is kept as empty, not as “never asked”', () => {
    updatePrefs({ courses: [] })
    expect(readPrefs().courses).toEqual([])
  })

  it('junk is cleaned: unknown courses dropped, repeats removed, the chooser’s order kept', () => {
    store.set(
      'grapher.v1.prefs',
      JSON.stringify({ courses: ['math3', 'nope', 'calc', 'calc', 7], lastBackupAt: 'x', backupRemindAt: -5 }),
    )
    const p = readPrefs()
    expect(p.courses).toEqual(['calc', 'math3'])
    expect('lastBackupAt' in p).toBe(false)
    expect('backupRemindAt' in p).toBe(false)
    expect(cleanCourses('calc')).toBeUndefined()
  })
})

// ============================================================================
// tests/betaFixes.test.ts — the last classroom issues before the teacher beta
// (scratchpad/pm/review2.md §3, items 2–9).
//
//   * the teacher note folds by itself while Reveal is on, and comes back as
//     it was when Reveal turns off;
//   * Present: the view makes room for the "Revealed" panel; the legend is
//     the axis numbers' size and keeps off the x axis;
//   * below 900 px the sidebar drawer starts closed and has its own ×;
//   * board chips and restriction chips round like the card, never e-notation
//     for a value tiny against the window;
//   * a view-only page shows no dead editing controls, and its title drops
//     "Example: ";
//   * Build → Calculus → "Riemann sum from a table";
//   * "Open an AP example" opens the gallery on AP courses, stored nowhere;
//   * the landing demo tells the current story and imports no app code.
// ============================================================================

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TeacherNote, noteFoldedNow } from '../src/ui/TeacherNote'
import { DRAWER_MAX_W, isDrawerWidth, sidebarStartsOpen } from '../src/ui/drawer'
import { boardLabelScale, boardPointText } from '../src/ui/renderBoard'
import { oneToOneChips, partRestriction } from '../src/ui/domainLinks'
import { EDIT_CONTROLS, LOOK_CONTROLS, readOnlyBlocks } from '../src/ui/readOnlyLock'
import { buildRows } from '../src/ui/BuildMenu'
import { COMMAND_BY_ID } from '../src/ui/commands'
import { dataBox } from '../src/ui/dataLinks'
import { turnOn } from '../src/ui/tableCalcLinks'
import { AP_GALLERY_COURSES, galleryDefaultCourses } from '../src/ui/courses'
import { docListName } from '../src/ui/docName'
import {
  applyClearance,
  contentRect,
  panelClearance,
  restoreView,
  sameView,
  snapView,
} from '../src/ui/presentClearance'
import { legendNudge, legendPx, xAxisBand, xLabelBand } from '../src/ui/present'
import type { SpecialPoint, Viewport } from '../src/core/types'
import type { BoardData } from '../src/core/persist'

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const CSS = read('src/ui/styles.css').replace(/\/\*[\s\S]*?\*\//g, '')

/** The bodies of every @media block whose condition matches `cond`. */
function mediaBodies(cond: RegExp): string {
  const out: string[] = []
  const re = /@media\s*([^{]+)\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(CSS))) {
    if (!cond.test(m[1])) continue
    let depth = 1
    let i = re.lastIndex
    for (; i < CSS.length && depth > 0; i++) {
      if (CSS[i] === '{') depth++
      else if (CSS[i] === '}') depth--
    }
    out.push(CSS.slice(re.lastIndex, i - 1))
  }
  return out.join('\n')
}

/** Declarations of every rule (anywhere) whose selector list contains `sel`. */
function rulesFor(src: string, sel: string): string {
  const re = /([^{}]+)\{([^{}]*)\}/g
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    if (m[1].split(',').map((s) => s.trim()).includes(sel)) out.push(m[2])
  }
  return out.join('\n')
}

// ---------------------------------------------------------------------------

describe('the teacher note during Reveal (item 3)', () => {
  it('folds while Reveal is on, unless the teacher unfolded it on purpose', () => {
    // outside reveal mode: the teacher's own choice
    expect(noteFoldedNow(false, false, false)).toBe(false)
    expect(noteFoldedNow(true, false, false)).toBe(true)
    // reveal on: folded either way…
    expect(noteFoldedNow(false, true, false)).toBe(true)
    expect(noteFoldedNow(true, true, false)).toBe(true)
    // …until "Show note"
    expect(noteFoldedNow(false, true, true)).toBe(false)
    expect(noteFoldedNow(true, true, true)).toBe(false)
  })

  it('the folded line says why and shows none of the note’s words', () => {
    const note = 'The card writes L₄ = (2)(4.3) + (3)(5.0) + (4)(5.9) + (3)(7.1) = 68.5 gallons'
    const html = renderToStaticMarkup(createElement(TeacherNote, { note, folded: true, onFold: () => {}, revealing: true }))
    expect(html).toContain('hidden while revealing')
    expect(html).toContain('Show note')
    expect(html).not.toContain('68.5')
    // folded outside reveal mode: the first words, as before
    const plain = renderToStaticMarkup(createElement(TeacherNote, { note, folded: true, onFold: () => {} }))
    expect(plain).toContain('68.5')
    expect(plain).not.toContain('hidden while revealing')
  })

  it('the teacher’s own fold is never written while revealing (useNoteFold)', () => {
    const hook = read('src/app/useNoteFold.ts')
    // in reveal mode the "opened" set changes, setNoteFolded is not called
    expect(hook).toMatch(/if \(!revealing\) \{\s*setNoteFolded\(docId, folded\)\s*return/)
    const app = read('src/App.tsx')
    expect(app).toMatch(/useNoteFold\(foldedNotes, setNoteFolded, reveal\.on\)/)
    expect(app).toMatch(/revealing=\{reveal\.on\}/)
    // Present hides the sidebar, and the note with it
    expect(app).toMatch(/open=\{sidebarOpen && !presentMode\}/)
  })
})

// ---------------------------------------------------------------------------

describe('Present: the Revealed panel never covers the figure (item 5)', () => {
  const vp = (cx: number, cy: number, ppu: number, w = 1366, h = 681): Viewport => ({
    center: { x: cx, y: cy },
    pxPerUnit: ppu,
    widthPx: w,
    heightPx: h,
  })
  // The review's board: the U6 rate table, 0 ≤ t ≤ 12, 0 ≤ r ≤ 8.4, at 2.5×,
  // the panel at the right a third of the board wide.
  const board = vp(7.5, 4.5, 44)
  const box = { min: { x: 0, y: 0 }, max: { x: 12, y: 8.4 } }
  const panel = { left: 890, top: 76, right: 1354, bottom: 360 }
  /** A content rectangle with `m` px of label room each side of its features. */
  const cr = (left: number, top: number, right: number, bottom: number, m = 0) => ({
    left, top, right, bottom, innerLeft: left + m, innerRight: right - m,
  })

  it('the content (with room for its labels) meets the panel, so the view moves', () => {
    const content = contentRect(box, board, 2.5)
    expect(content.right).toBeGreaterThan(panel.left)
    const move = panelClearance(content, panel, board.widthPx)
    expect(move).not.toBeNull()
  })

  it('a pan when the content fits beside the panel, at the same scale', () => {
    const content = cr(300, 100, 1000, 600, 150)
    const move = panelClearance(content, panel, 1366)!
    expect(move.s).toBe(1)
    expect(content.right + move.dx).toBeLessThanOrEqual(panel.left - 12 + 1e-9)
    expect(content.left + move.dx).toBeGreaterThanOrEqual(12)
  })

  it('a shrink when it does not: the features shrink, their labels’ room stays, all beside the panel', () => {
    const m = 150
    const content = cr(0, 50, 1366, 600, m)
    const move = panelClearance(content, panel, 1366)!
    expect(move.s).toBeLessThan(1)
    const wi = (content.innerRight - content.innerLeft) * move.s
    const center = (content.innerLeft + content.innerRight) / 2 + move.dx
    expect(center - wi / 2 - m).toBeGreaterThanOrEqual(12 - 1e-6)
    expect(center + wi / 2 + m).toBeLessThanOrEqual(panel.left - 12 + 1e-6)
  })

  it('a panel on the left moves the content right; clear content is left alone', () => {
    const left = { left: 12, top: 76, right: 470, bottom: 360 }
    const move = panelClearance(cr(200, 100, 800, 500), left, 1366)!
    expect(move.dx).toBeGreaterThan(0)
    expect(panelClearance(cr(100, 400, 800, 600), panel, 1366)).toBeNull()
    expect(panelClearance(cr(100, 100, 800, 600), panel, 1366)).toBeNull()
  })

  it('applied to the view, the figure lands clear of the panel — and the view comes back', () => {
    // wide enough to need a shrink at 2.5×
    const v = vp(7.5, 4.5, 60)
    const before = snapView(v)
    const content = contentRect(box, v, 2.5)
    const move = panelClearance(content, panel, v.widthPx)!
    applyClearance(v, content, move)
    const after = contentRect(box, v, 2.5)
    expect(after.right).toBeLessThanOrEqual(panel.left - 12 + 1)
    expect(after.left).toBeGreaterThanOrEqual(0)
    expect(sameView(snapView(v), before)).toBe(false)
    restoreView(v, before)
    expect(sameView(snapView(v), before)).toBe(true)
  })

  it('App runs it in Present + Reveal on a graph board, while the panel lists answers', () => {
    const app = read('src/App.tsx')
    expect(app).toMatch(/usePresentClearance\(\{\s*active: presentMode && reveal\.on && kind === 'cartesian' && presentAnswers\.length > 0/)
  })

  it('the legend is the axis numbers’ size, not bigger', () => {
    expect(legendPx(1)).toBe(13)
    expect(legendPx(1.5)).toBe(17)
    expect(legendPx(2.5)).toBe(28) // was 33
    expect(read('src/ui/PresentLegend.tsx')).toMatch(/fontSize: `\$\{legendPx\(type\)\}px`/)
  })

  it('a bottom legend stops above the x axis LINE, not only above its numbers', () => {
    const H = 681
    const axisY = 546
    const band = xAxisBand(axisY, H, 2.5, 11)
    expect(band.top).toBeLessThanOrEqual(axisY - 10)
    expect(band.bottom).toBe(xLabelBand(axisY, H, 2.5, 11).bottom)
    // the review's legend: 445 … 548, on the axis line
    const dy = legendNudge('bottom-left', { top: 445, bottom: 548 }, band, H)
    expect(548 + dy).toBeLessThan(axisY)
    // an axis off the board: only the numbers, slid along the edge
    expect(xAxisBand(2000, H, 2.5, 11)).toEqual(xLabelBand(2000, H, 2.5, 11))
  })

  it('the legend’s move control sits in its corner, not on a row of its own', () => {
    const rule = rulesFor(CSS, '.present-legend-move')
    expect(rule).toMatch(/position:\s*absolute/)
  })
})

// ---------------------------------------------------------------------------

describe('iPad portrait: the drawer starts closed (item 6)', () => {
  it('closed at and below 900 px, open above', () => {
    expect(DRAWER_MAX_W).toBe(900)
    for (const w of [375, 540, 768, 900]) {
      expect(isDrawerWidth(w), String(w)).toBe(true)
      expect(sidebarStartsOpen(w), String(w)).toBe(false)
    }
    for (const w of [901, 1024, 1366, 1920]) {
      expect(isDrawerWidth(w), String(w)).toBe(false)
      expect(sidebarStartsOpen(w), String(w)).toBe(true)
    }
  })

  it('the stylesheet’s drawer breakpoint is the same 900 px', () => {
    expect(CSS).toMatch(/@media \(max-width: 900px\)/)
    expect(read('src/app/useBoardState.ts')).toMatch(/useState\(\(\) => sidebarStartsOpen\(viewportWidth\(\)\)\)/)
  })

  it('the drawer has its own ×, shown only where the sidebar is a drawer', () => {
    expect(read('src/ui/Sidebar.tsx')).toMatch(/data-testid="sidebar-close"/)
    expect(read('src/App.tsx')).toMatch(/onClose=\{\(\) => setSidebarOpen\(false\)\}/)
    const top = CSS.replace(/@media[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
    expect(rulesFor(top, '.sidebar-drawer-bar')).toMatch(/display:\s*none/)
    expect(rulesFor(mediaBodies(/max-width: 900px/), '.sidebar .sidebar-drawer-bar')).toMatch(/display:\s*flex/)
  })

  it('the question is in the drawer too, and Next is above a phone’s docked toolbar', () => {
    expect(read('src/App.tsx')).toMatch(/data-testid="sidebar-question"/)
    expect(rulesFor(mediaBodies(/max-width: 900px/), '.sidebar .sidebar-question')).toMatch(/display:\s*block/)
    expect(rulesFor(mediaBodies(/max-width: 540px/), '.canvas-area .reveal-bar')).toMatch(
      /inset-block-end:\s*calc\(var\(--toolbar-reserve\)/,
    )
  })
})

// ---------------------------------------------------------------------------

describe('board labels round like the card (item 7)', () => {
  const pt = (kind: SpecialPoint['kind'], x: number, y: number): SpecialPoint => ({ kind, pos: { x, y }, label: kind })
  const board: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 1020, heightPx: 600 }

  it('the review’s sketched vertex: "(0, −3.958)" on the board, as on the card', () => {
    // card scales of that sketch: x over [−3.065, 3.076], y over [−3.958, 5.4]
    const at = { scale: 9.4, xScale: 6.14, ...boardLabelScale(board) }
    const text = boardPointText(pt('minimum', -2.32e-4, -3.958), at)
    expect(text).toBe('(0, −3.958)')
    expect(text).not.toMatch(/e[−-]/)
  })

  it('never e-notation for a value tiny against the window', () => {
    // a curve one unit wide: the card's rounding would print 8.50e−4
    const at = { scale: 1, xScale: 1, ...boardLabelScale(board) }
    const text = boardPointText(pt('maximum', 8.5e-4, 0.5), at)
    expect(text).not.toMatch(/e[−-]/)
    expect(text.startsWith('(0,')).toBe(true)
  })

  it('a real small value keeps its digits (no zero-snap) — the card’s reading when it has no exponent', () => {
    const at = { scale: 8, xScale: 6.3, ...boardLabelScale(board) }
    expect(boardPointText(pt('minimum', -0.001345, -3.969), at)).toBe('(−0.001345, −3.969)')
    // zoomed in to its size, a tiny value is shown
    const zoomed: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 1e6, widthPx: 1000, heightPx: 600 }
    const z = boardPointText(pt('maximum', 8.5e-4, 0.0005), { scale: 1, xScale: 1, ...boardLabelScale(zoomed) })
    expect(z).not.toMatch(/^\(0,/)
  })

  it('the restriction chips read "x ≥ 0", while restricting to the true value', () => {
    const v = -0.0002324
    const info = {
      oneToOne: false,
      monotone: [
        { lo: v, hi: Infinity, loClosed: true, hiClosed: false, loExact: null, hiExact: null },
        { lo: -Infinity, hi: v, loClosed: false, hiClosed: true, loExact: null, hiExact: null },
      ],
    }
    const chips = oneToOneChips(info, 6.14)
    expect(chips.map((c) => c.label)).toEqual(['x ≥ 0', 'x ≤ 0'])
    expect(partRestriction(chips[0].part).lo?.value).toBe(v)
    // without a scale: as before
    expect(oneToOneChips(info).map((c) => c.label)).toEqual(['x ≥ −0.0002324', 'x ≤ −0.0002324'])
  })

  it('the board passes each curve’s card scale to its chips', () => {
    const src = read('src/ui/renderBoard.ts')
    expect(src).toMatch(/labelScale: boardLabelScale\(vp, an\.curve, models\)/)
    expect(read('src/app/useDomainPanel.ts')).toMatch(/oneToOneChips\(facts\.one, chipScale\(owner\)\)/)
  })
})

// ---------------------------------------------------------------------------

describe('the view-only page shows no dead controls (item 8)', () => {
  /** A stand-in element: `closest` matches when the selector names one of its classes or tags. */
  const el = (...names: string[]) => ({
    closest: (sel: string): object | null =>
      sel
        .split(',')
        .map((s) => s.trim())
        .some((s) => names.includes(s))
        ? {}
        : null,
  })

  it('edits are stopped: buttons, fields, selects, sliders; and paste or drop anywhere', () => {
    for (const t of ['button', 'input', 'select', 'textarea', '[role="slider"]']) {
      expect(readOnlyBlocks('click', el(t)), t).toBe(true)
      expect(readOnlyBlocks('pointerdown', el(t)), t).toBe(true)
      expect(readOnlyBlocks('keydown', el(t), { key: '9' }), t).toBe(true)
    }
    expect(readOnlyBlocks('paste', el('div'))).toBe(true)
    expect(readOnlyBlocks('drop', el('div'))).toBe(true)
  })

  it('looking is not: a card frame, a section toggle, a "? Reveal" pill, Tab', () => {
    expect(readOnlyBlocks('click', el('div'))).toBe(false)
    expect(readOnlyBlocks('click', el('button', '.reveal-pill'))).toBe(false)
    expect(readOnlyBlocks('click', el('button', '.cs-toggle'))).toBe(false)
    expect(readOnlyBlocks('keydown', el('input'), { key: 'Tab' })).toBe(false)
    expect(readOnlyBlocks('scroll', el('input'))).toBe(false)
    expect(LOOK_CONTROLS).toContain('.reveal-pill')
    expect(EDIT_CONTROLS).toContain('select')
  })

  it('the list is locked, not inert — inert also stopped Reveal on a card', () => {
    const sidebar = read('src/ui/Sidebar.tsx')
    expect(sidebar).toMatch(/return lockReadOnly\(el\)/)
    expect(sidebar).not.toMatch(/\.inert = readOnly/)
  })

  it('the stylesheet hides Paste data, Regression, point styles, off chips, sliders and the ⋯ menu', () => {
    const hidden = rulesFor(CSS, '.sidebar-readonly .data-actions')
    expect(hidden).toMatch(/display:\s*none/)
    for (const sel of [
      '.sidebar-readonly .data-marker-pick',
      '.sidebar-readonly .card-menu-wrap',
      '.sidebar-readonly .data-row-new',
      ".sidebar-readonly .sidebar-list-body input[type='range']",
      '.sidebar-readonly .sidebar-list-body .calc-chip:not(.calc-chip-on)',
    ]) {
      expect(rulesFor(CSS, sel), sel).toMatch(/display:\s*none/)
    }
    // a choice that is on (L, "Σ sum") and a from/to read as text
    expect(rulesFor(CSS, '.sidebar-readonly .sidebar-list-body .calc-chip-on')).toMatch(/background:\s*transparent/)
    expect(rulesFor(CSS, '.sidebar-readonly .sidebar-list-body select')).toMatch(/appearance:\s*none/)
    expect(read('src/ui/DataCard.tsx')).toMatch(/className="field-spacing data-marker-pick"/)
  })

  it('a shared title drops "Example: " (display only)', () => {
    expect(docListName('Example: U6 — Riemann sums from a rate table')).toBe('U6 — Riemann sums from a rate table')
    expect(read('src/ui/DocMenu.tsx')).toMatch(/\{shared \? docListName\(name\) : name\}/)
  })
})

// ---------------------------------------------------------------------------

describe('Build → Calculus → "Riemann sum from a table" (item 9)', () => {
  it('is in the Calculus section, and only when the App wires it', () => {
    const run = (): void => {}
    const rows = buildRows({ factorOpen: false, expOpen: false }, { onTableRiemann: run })
    const row = rows.find((r) => r.testId === 'build-table-riemann')
    expect(row?.section).toBe('calculus')
    expect(row?.label).toBe('Riemann sum from a table')
    expect(row?.run).toBe(run)
    expect(buildRows({ factorOpen: false, expOpen: false }, {}).some((r) => r.testId === 'build-table-riemann')).toBe(false)
  })

  it('runs what the ⌘K command of that name runs', () => {
    const cmd = COMMAND_BY_ID.get('table-riemann')
    expect(cmd?.title).toBe('Riemann sum from a table')
    const calls: string[] = []
    cmd!.run({ actions: { openTableCalc: (t: string) => calls.push(t) } } as never)
    expect(calls).toEqual(['sum'])
    expect(read('src/app/useCommands.ts')).toMatch(/tableRiemann: \(\): void => commandActions\.openTableCalc\?\.\('sum'\)/)
    expect(read('src/App.tsx')).toMatch(/onTableRiemann: \(\) => tableRiemannRef\.current\(\)/)
  })

  it('a new table starts with the Σ sum on, so pasted rows are framed down to y = 0', () => {
    expect(read('src/app/useCommands.ts')).toMatch(/addDataTable\(startsOn \? turnOn\(EMPTY_TABLE, tool\) : undefined\)/)
    const empty: BoardData = { id: 't', name: 'Table 1', xLabel: 'x', yLabel: 'y', rows: [], color: '#4f9cf9', visible: true, regressions: [] }
    const calc = turnOn(empty, 'sum')
    expect(calc.sum).toBeDefined()
    const pasted: BoardData = {
      ...empty,
      calc,
      rows: [
        { x: '0', y: '4.3' },
        { x: '2', y: '5.0' },
        { x: '5', y: '5.9' },
        { x: '9', y: '7.1' },
        { x: '12', y: '8.4' },
      ],
    }
    const box = dataBox(pasted)!
    expect(box.min.y).toBeLessThanOrEqual(0)
    // without the sum the frame hugs the points (the review's hidden baseline)
    expect(dataBox({ ...pasted, calc: undefined })!.min.y).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------

describe('"Open an AP example" (§4 next)', () => {
  it('a gallery link with no courses ever chosen opens on AP Calc + AP Precalc', () => {
    expect(AP_GALLERY_COURSES).toEqual(['calc', 'precalc'])
    expect(galleryDefaultCourses(undefined, true)).toEqual(['calc', 'precalc'])
  })

  it('the teacher’s own courses win; otherwise every course, as before', () => {
    expect(galleryDefaultCourses(['math1'], true)).toEqual(['math1'])
    expect(galleryDefaultCourses(['calc', 'math2'], false)).toEqual(['calc', 'math2'])
    expect(galleryDefaultCourses(undefined, false)).toBeNull()
    // "No courses — show everything" was a choice: kept
    expect(galleryDefaultCourses([], true)).toBeNull()
    expect(galleryDefaultCourses(['other'], true)).toBeNull()
  })

  it('stores nothing: the filter is only the gallery’s opening state', () => {
    const hook = read('src/app/useGalleryLink.ts')
    expect(hook).not.toMatch(/updatePrefs|chooseCourses|localStorage/)
    expect(read('src/App.tsx')).toMatch(/defaultCourses=\{galleryDefaultCourses\(focus\.courses, galleryFromLink\)\}/)
  })
})

// ---------------------------------------------------------------------------

describe('the landing hero demo (item 2)', () => {
  const demo = read('src/platform/Demo.tsx')

  it('tells the current story: Sketch, Snap, Tidy, Print', () => {
    const steps = [...demo.matchAll(/step: '([^']+)'/g)].map((m) => m[1])
    expect(steps).toEqual(['Sketch', 'Snap', 'Tidy', 'Print'])
    expect(demo).toMatch(/Tidy to y = x² − 4/)
    expect(demo).not.toMatch(/Type exact values/)
    expect(demo).not.toMatch(/fit σ|0\.00268|−0\.001345/)
  })

  it('imports images and React only — no app code', () => {
    const imports = [...demo.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1])
    for (const spec of imports) expect(spec === 'react' || /^\.\/img\/demo-\d\.webp$/.test(spec), spec).toBe(true)
  })
})

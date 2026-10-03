// ============================================================================
// tests/commands.test.ts — the command palette's registry (src/ui/commands.ts):
// its integrity, what is on offer on each kind of board and curve (the same
// answer the curve's ⋯ menu gives), the search a teacher types, the recently
// used order, and the keys.
// ============================================================================

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { appSource } from './appSource'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { parseExpression } from '../src/core/parse'
import { cardCalc } from '../src/ui/calcLinks'
import { CALC_GROUPS, calcMenuOffers } from '../src/ui/calcMenu'
import type { CalcMenuKind } from '../src/ui/calcMenu'
import { betweenCardInfo } from '../src/App'
import {
  COMMANDS,
  COMMAND_BY_ID,
  GROUP_ORDER,
  HELP_SECTIONS,
  RESERVED_KEYS,
  availability,
  canonicalKey,
  keyParts,
  filterTargets,
  formatShortcut,
  matchesKey,
  paletteRows,
  pushRecent,
  scoreCommand,
  shortcutRows,
} from '../src/ui/commands'
import type { Command, CommandActions, CommandContext, CurveFacts } from '../src/ui/commands'
import { CommandPalette } from '../src/ui/CommandPalette'
import { HelpSheet } from '../src/ui/HelpSheet'
import { readPrefs, updatePrefs } from '../src/ui/storage'

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

function typed(src: string, id: string): { c: FittedCurve; models: Record<string, ModelSpec> } {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(o.error)
  const modelId = `expr_${id}`
  return {
    c: {
      id,
      modelId,
      params: o.plot.defaultParams.slice(),
      kind: o.plot.kind,
      domain: o.plot.domain,
      color: '#4f9cf9',
      strokeWidth: 2.5,
      visible: true,
      error: 0,
    },
    models: { [modelId]: o.plot.makeModel(modelId) },
  }
}

/** The facts the App hands the palette, computed the way the App computes them. */
function curveFacts(lines: Record<string, string>): CurveFacts[] {
  const built = Object.entries(lines).map(([id, src]) => ({ id, src, ...typed(src, id) }))
  const curves = built.map((b) => b.c)
  const models: Record<string, ModelSpec> = Object.assign({}, ...built.map((b) => b.models))
  const sources = Object.fromEntries(built.map((b) => [b.id, b.src]))
  const cards = cardCalc([], curves, models, (c) => c.id, {}, {}, sources)
  const between = betweenCardInfo(curves, models, [], (c) => c.id)
  return built.map((b) => {
    const calc = cards[b.id]
    return {
      id: b.id,
      name: b.id,
      text: b.src,
      kind: b.c.kind,
      calc: calc
        ? {
            canAdd: calc.canAdd,
            implicitOnly: calc.implicitOnly,
            motion: calc.motion,
            polarPartner: calc.polarPartner,
            taylorBlocked: calc.taylorBlocked,
          }
        : null,
      between: between[b.id]?.canAdd === true,
      inverse: b.c.kind === 'explicit',
      domain: b.c.kind === 'explicit' && typeof models[b.c.modelId]?.inequality !== 'function',
      hlt: false,
    }
  })
}

/** Actions that record what was called. */
function recorder(): { actions: CommandActions; calls: string[] } {
  const calls: string[] = []
  const actions = new Proxy({} as CommandActions, {
    get: (_t, name: string) => (...args: unknown[]) => {
      calls.push(`${name}(${args.map((a) => JSON.stringify(a)).join(', ')})`)
    },
  })
  return { actions, calls }
}

function ctxOf(over: Partial<CommandContext> = {}): CommandContext {
  return {
    board: 'cartesian',
    readOnly: false,
    shared: false,
    selectedId: null,
    curves: [],
    fields: [],
    sequences: [],
    solves: [],
    canUndo: true,
    canRedo: false,
    hasContent: true,
    showAnalysis: true,
    canvasTheme: 'dark',
    presentMode: false,
    revealOn: false,
    sidebarOpen: true,
    figure: 'screen',
    previewFigure: false,
    exportFormat: 'png',
    axisX: 'auto',
    grid: 'cartesian',
    actions: recorder().actions,
    ...over,
  }
}

const CUBIC = 'y = x^3 - 3x'
const explicitCurves = curveFacts({ f: CUBIC })
const twoExplicit = curveFacts({ f: CUBIC, g: 'y = x' })
const implicitCurves = curveFacts({ c: 'x^2 + y^2 = 25' })
const polarCurves = curveFacts({ p: 'r = 3sin(theta)' })
const twoPolar = curveFacts({ p: 'r = 3sin(theta)', q: 'r = 1 + sin(theta)' })
const paramCurves = curveFacts({ m: 'x = t^2, y = t^3' })

const empty = ctxOf({ curves: [], hasContent: false })
const noSel = ctxOf({ curves: explicitCurves })
const explicitSel = ctxOf({ curves: explicitCurves, selectedId: 'f' })
const implicitSel = ctxOf({ curves: implicitCurves, selectedId: 'c' })
const polarSel = ctxOf({ curves: polarCurves, selectedId: 'p' })
const paramSel = ctxOf({ curves: paramCurves, selectedId: 'm' })
const nl = ctxOf({
  board: 'number-line',
  figure: null,
  axisX: null,
  grid: null,
  solves: [{ id: 's1', name: 'Inequality 1', text: 'x^2 - 4 > 0', signs: true, tests: false }],
})

const cmd = (id: string): Command => {
  const c = COMMAND_BY_ID.get(id)
  if (!c) throw new Error(`no command ${id}`)
  return c
}
const state = (id: string, ctx: CommandContext): string => availability(cmd(id), ctx).state

// ---------------------------------------------------------------------------
// Integrity
// ---------------------------------------------------------------------------

describe('the registry', () => {
  it('has unique ids, a group, keywords, a description and a menu path for every command', () => {
    const ids = COMMANDS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of COMMANDS) {
      expect(GROUP_ORDER, c.id).toContain(c.group)
      expect(c.keywords.length, c.id).toBeGreaterThan(0)
      expect(c.title.trim(), c.id).not.toBe('')
      expect(c.description.trim(), c.id).not.toBe('')
      expect(c.path.trim(), c.id).not.toBe('')
      if (c.target) expect(c.accepts, `${c.id} acts on a ${c.target} but never says which`).toBeTypeOf('function')
    }
  })

  it('covers every calculus item of the ⋯ menu', () => {
    const kinds = CALC_GROUPS.flatMap((g) => g.items.map((i) => i.kind))
    const byKind: Record<string, string> = {
      limit: 'calc-limit',
      secant: 'calc-secant',
      tangent: 'calc-tangent',
      derivative: 'calc-derivative',
      signchart: 'calc-signchart',
      riemann: 'calc-riemann',
      area: 'calc-area',
      between: 'calc-between',
      accumulation: 'calc-accumulation',
      volume: 'calc-volume',
      taylor: 'calc-taylor',
      pcalc: 'calc-pcalc',
      polarbetween: 'calc-polarbetween',
    }
    for (const k of kinds) expect(COMMAND_BY_ID.has(byKind[k]), k).toBe(true)
  })

  it('covers the Build ▾ menu, the document menu, export and the toolbar', () => {
    for (const id of [
      'build-roots', 'build-exp', 'build-logistic', 'build-log', 'build-sin', 'build-transform', 'build-piecewise',
      'build-conic', 'build-motion', 'build-seq', 'build-data', 'build-unit-circle', 'build-related-rates',
      'doc-new-graph', 'doc-new-nl', 'doc-worksheet', 'doc-share', 'doc-backup', 'doc-import', 'doc-duplicate',
      'export-download', 'export-png', 'export-svg', 'export-pdf', 'export-tikz', 'export-pgfplots', 'export-copy',
      'style-screen', 'style-textbook', 'style-sat', 'style-ap', 'axis-pi',
      'view-analysis', 'view-theme', 'view-present', 'view-reveal', 'undo', 'redo', 'view-zoom-fit', 'help',
      'field-euler', 'seq-series', 'nl-solve', 'build-unit-circle', 'build-related-rates', 'build-inequality',
    ]) {
      expect(COMMAND_BY_ID.has(id), id).toBe(true)
    }
  })

  it('every help-sheet line that names a command names one that exists', () => {
    for (const s of HELP_SECTIONS) {
      for (const e of s.entries) if ('id' in e) expect(COMMAND_BY_ID.has(e.id), `${s.id}: ${e.id}`).toBe(true)
    }
  })

  it('the help sheet covers AP Calculus units 1–10 and AP Precalculus units 1–3', () => {
    const titles = HELP_SECTIONS.map((s) => s.title)
    for (let u = 1; u <= 10; u++) expect(titles.some((t) => t.startsWith(`Unit ${u} ·`) && t.length > 0)).toBe(true)
    const pc = HELP_SECTIONS.filter((s) => s.course === 'AP Precalculus').map((s) => s.title)
    expect(pc.map((t) => t.slice(0, 6))).toEqual(['Unit 1', 'Unit 2', 'Unit 3'])
    expect(HELP_SECTIONS.some((s) => s.course === 'NC Math 3')).toBe(true)
    for (const course of ['NC Math 1', 'NC Math 2']) {
      const n = HELP_SECTIONS.filter((s) => s.course === course).length
      expect(n, course).toBeGreaterThanOrEqual(4)
      expect(n, course).toBeLessThanOrEqual(7)
    }
  })
})

// ---------------------------------------------------------------------------
// What is on offer
// ---------------------------------------------------------------------------

describe('availability: the palette offers what the ⋯ menu offers', () => {
  const CALC_IDS: [CalcMenuKind, string][] = [
    ['limit', 'calc-limit'],
    ['secant', 'calc-secant'],
    ['tangent', 'calc-tangent'],
    ['derivative', 'calc-derivative'],
    ['signchart', 'calc-signchart'],
    ['riemann', 'calc-riemann'],
    ['area', 'calc-area'],
    ['between', 'calc-between'],
    ['accumulation', 'calc-accumulation'],
    ['volume', 'calc-volume'],
    ['taylor', 'calc-taylor'],
    ['pcalc', 'calc-pcalc'],
    ['polarbetween', 'calc-polarbetween'],
  ]

  it.each([
    ['explicit', ctxOf({ curves: twoExplicit, selectedId: 'f' })],
    ['explicit alone', explicitSel],
    ['implicit', implicitSel],
    ['polar', polarSel],
    ['two polar', ctxOf({ curves: twoPolar, selectedId: 'p' })],
    ['parametric', paramSel],
  ])('%s: a calculus command is hidden exactly when the menu leaves it out', (_name, ctx) => {
    const sel = ctx.curves.find((c) => c.id === ctx.selectedId)!
    for (const [kind, id] of CALC_IDS) {
      const offered = calcMenuOffers(kind, sel.calc, sel.between)
      expect(state(id, ctx) !== 'hidden', `${id} on ${sel.text}`).toBe(offered)
    }
  })

  it('no selection: a calculus command asks which curve, among the curves that take it', () => {
    const av = availability(cmd('calc-taylor'), noSel)
    expect(av.state).toBe('pick')
    if (av.state === 'pick') expect(av.candidates.map((c) => c.id)).toEqual(['f'])
    const mixed = ctxOf({ curves: [...explicitCurves, ...polarCurves] })
    const r = availability(cmd('calc-riemann'), mixed)
    expect(r.state === 'pick' && r.candidates.map((c) => c.id)).toEqual(['f'])
    const p = availability(cmd('calc-pcalc'), mixed)
    expect(p.state === 'pick' && p.candidates.map((c) => c.id)).toEqual(['p'])
  })

  it('an empty board: calculus is greyed out with what to do first', () => {
    const av = availability(cmd('calc-limit'), empty)
    expect(av).toEqual({ state: 'disabled', reason: 'Draw or type a curve first' })
    expect(state('field-euler', empty)).toBe('disabled')
    expect(state('seq-series', empty)).toBe('disabled')
  })

  it('explicit selected: calculus runs on it; inverse and domain are offered', () => {
    expect(availability(cmd('calc-derivative'), explicitSel)).toEqual({ state: 'ready', targetId: 'f' })
    for (const id of ['show-inverse', 'hlt', 'domain-range', 'domain-restrict']) expect(state(id, explicitSel), id).toBe('ready')
    // a lone curve has nothing to shade between
    expect(state('calc-between', explicitSel)).toBe('hidden')
    expect(state('calc-between', ctxOf({ curves: twoExplicit, selectedId: 'f' }))).toBe('ready')
  })

  it('implicit selected: the tangent line only; no inverse, no domain rows', () => {
    expect(state('calc-tangent', implicitSel)).toBe('ready')
    for (const id of ['calc-derivative', 'calc-area', 'calc-taylor', 'calc-limit', 'show-inverse', 'domain-range', 'hlt']) {
      expect(state(id, implicitSel), id).toBe('hidden')
    }
  })

  it('polar / parametric selected: only their own calculus', () => {
    expect(state('calc-pcalc', polarSel)).toBe('ready')
    expect(state('calc-polarbetween', polarSel)).toBe('hidden')
    expect(state('calc-polarbetween', ctxOf({ curves: twoPolar, selectedId: 'p' }))).toBe('ready')
    expect(state('calc-pcalc', paramSel)).toBe('ready')
    for (const id of ['calc-riemann', 'calc-tangent', 'calc-taylor', 'show-inverse']) {
      expect(state(id, polarSel), id).toBe('hidden')
      expect(state(id, paramSel), id).toBe('hidden')
    }
  })

  it('a blocked Taylor is listed, greyed out with the menu’s reason', () => {
    const blocked = explicitCurves.map((c) => ({ ...c, calc: { ...c.calc!, taylorBlocked: 'f calls g' } }))
    expect(availability(cmd('calc-taylor'), ctxOf({ curves: blocked, selectedId: 'f' }))).toEqual({
      state: 'disabled',
      reason: 'f calls g',
    })
  })

  it('the number line: its own tools; no curve calculus, builders, figure styles or π axis', () => {
    expect(state('nl-solve', nl)).toBe('ready')
    expect(state('doc-switch-graph', nl)).toBe('ready')
    expect(state('nl-signs', nl)).toBe('pick')
    for (const id of [
      'calc-limit', 'calc-derivative', 'build-exp', 'build-unit-circle', 'type-equation', 'style-sat', 'axis-pi',
      'export-pgfplots', 'grid-polar', 'doc-switch-nl',
    ]) {
      expect(state(id, nl), id).toBe('hidden')
    }
    for (const id of ['view-present', 'view-reveal', 'doc-share', 'doc-worksheet', 'export-pdf', 'undo']) {
      expect(state(id, nl), id).not.toBe('hidden')
    }
    expect(state('nl-solve', explicitSel)).toBe('hidden')
    expect(state('nl-signs', explicitSel)).toBe('hidden')
  })

  it('a view-only shared graph: nothing that changes the board', () => {
    const ro = ctxOf({ curves: explicitCurves, selectedId: 'f', readOnly: true, shared: true })
    for (const id of ['calc-derivative', 'build-exp', 'type-equation', 'undo', 'delete-selected', 'style-sat']) {
      expect(state(id, ro), id).toBe('hidden')
    }
    for (const id of ['view-present', 'view-reveal', 'doc-make-copy', 'export-download', 'help']) {
      expect(state(id, ro), id).not.toBe('hidden')
    }
  })

  it('greys out what cannot happen now', () => {
    expect(state('undo', ctxOf({ canUndo: false }))).toBe('disabled')
    expect(state('redo', ctxOf({ canRedo: false }))).toBe('disabled')
    expect(state('export-download', empty)).toBe('disabled')
    expect(state('style-screen', ctxOf())).toBe('disabled')
    expect(state('style-sat', ctxOf())).toBe('ready')
    expect(state('view-reveal-next', ctxOf())).toBe('hidden')
    expect(state('view-reveal-next', ctxOf({ revealOn: true }))).toBe('ready')
  })

  it('runs the App callbacks the menus call', () => {
    const rec = recorder()
    const ctx = { ...explicitSel, actions: rec.actions }
    cmd('calc-taylor').run(ctx, 'f')
    cmd('calc-between').run(ctx, 'f')
    cmd('style-sat').run(ctx)
    cmd('build-slope-field').run(ctx)
    cmd('export-pdf').run(ctx)
    cmd('view-present').run(ctx)
    cmd('nl-signs').run(nl, 's1')
    expect(rec.calls).toEqual([
      'addCalc("f", "taylor")',
      'addAreaBetween("f")',
      'setFigure("sat")',
      'typeLine("dy/dx = ")',
      'downloadAs("pdf")',
      'setPresent(true)',
    ])
  })
})

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

describe('search: a teacher’s words find the tool', () => {
  const seqCtx = ctxOf({
    curves: twoExplicit,
    selectedId: 'f',
    fields: [{ id: 'F', name: 'Slope field', text: 'dy/dx = x - y' }],
  })
  const first = (q: string, ctx: CommandContext = seqCtx, recent: string[] = []): string =>
    paletteRows(ctx, q, recent)[0]?.cmd.id ?? '(none)'

  it.each([
    ['derivative', 'calc-derivative'],
    ["f'", 'calc-derivative'],
    ['f prime', 'calc-derivative'],
    ['integral', 'calc-area'],
    ['area', 'calc-area'],
    ['area between', 'calc-between'],
    ['riemann', 'calc-riemann'],
    ['rectangles', 'calc-riemann'],
    ['trapezoid', 'calc-riemann'],
    ['inverse', 'show-inverse'],
    ['domain', 'domain-range'],
    ['range', 'domain-range'],
    ['restrict', 'domain-restrict'],
    ['tangent', 'calc-tangent'],
    ['secant', 'calc-secant'],
    ['average rate', 'calc-secant'],
    ['mvt', 'calc-secant'],
    ['mean value theorem', 'calc-secant'],
    ['limit', 'calc-limit'],
    ['taylor', 'calc-taylor'],
    ['maclaurin', 'calc-taylor'],
    ['series', 'calc-taylor'],
    ['volume', 'calc-volume'],
    ['disk method', 'calc-volume'],
    ['washer', 'calc-volume'],
    ['shell', 'calc-volume'],
    ['sign chart', 'calc-signchart'],
    ['concavity', 'calc-signchart'],
    ['ftc', 'calc-accumulation'],
    ['euler', 'field-euler'],
    ['slope field', 'build-slope-field'],
    ['unit circle', 'build-unit-circle'],
    ['related rates', 'build-related-rates'],
    ['inequality', 'build-inequality'],
    ['worksheet', 'doc-worksheet'],
    ['share', 'doc-share'],
    ['qr', 'doc-share'],
    ['export', 'export-download'],
    ['pdf', 'export-pdf'],
    ['tikz', 'export-tikz'],
    ['latex', 'export-copy-latex'],
    ['sat', 'style-sat'],
    ['sat style', 'style-sat'],
    ['ap', 'style-ap'],
    ['textbook', 'style-textbook'],
    ['reveal', 'view-reveal'],
    ['present', 'view-present'],
    ['projector', 'view-present'],
    ['undo', 'undo'],
    ['zoom fit', 'view-zoom-fit'],
    ['π axis', 'axis-pi'],
    ['pi axis', 'axis-pi'],
    ['dark', 'view-theme'],
    ['light', 'view-theme'],
    ['horizontal line test', 'hlt'],
    ['regression', 'build-data'],
    ['hyperbola', 'build-conic'],
    ['logistic', 'build-logistic'],
    ['help', 'help'],
    ['keyboard shortcuts', 'help'],
    ['new graph', 'doc-new-graph'],
    ['copy png', 'export-copy'],
    ['tngnt', 'calc-tangent'],
  ])('“%s” → %s', (q, id) => {
    expect(first(q)).toBe(id)
  })

  it('on the number line, “inequality” and “sign chart” mean the solver', () => {
    expect(first('inequality', nl)).toBe('nl-solve')
    expect(first('sign chart', nl)).toBe('nl-signs')
    expect(first('solve', nl)).toBe('nl-solve')
  })

  it('nothing for nonsense; the empty query lists everything on offer', () => {
    expect(paletteRows(seqCtx, 'zzqqxx')).toEqual([])
    const all = paletteRows(seqCtx, '')
    expect(all.length).toBeGreaterThan(50)
    expect(all.every((r) => r.avail.state !== ('hidden' as string))).toBe(true)
    expect(all.some((r) => r.cmd.id === 'palette')).toBe(false)
  })

  it('results are gathered under their group headings, best group first', () => {
    const rows = paletteRows(seqCtx, 'copy')
    const headings = rows.map((r) => r.heading)
    // each heading's rows are contiguous
    const seen: string[] = []
    for (const h of headings) {
      if (seen[seen.length - 1] !== h) {
        expect(seen).not.toContain(h)
        seen.push(h)
      }
    }
  })

  it('scoreCommand prefers a title over a keyword over the description', () => {
    const c = cmd('calc-area')
    expect(scoreCommand(c, c.title, 'area under the curve')).toBeGreaterThan(scoreCommand(c, c.title, 'integral'))
    expect(scoreCommand(c, c.title, 'integral')).toBeGreaterThan(scoreCommand(c, c.title, 'exact value'))
  })

  it('the curve picker filters by name or equation', () => {
    const t = twoExplicit
    expect(filterTargets(t, 'g').map((x) => x.id)).toEqual(['g'])
    expect(filterTargets(t, 'x^3').map((x) => x.id)).toEqual(['f'])
    expect(filterTargets(t, '').map((x) => x.id)).toEqual(['f', 'g'])
  })
})

// ---------------------------------------------------------------------------
// Recently used
// ---------------------------------------------------------------------------

describe('recently used commands float to the top', () => {
  it('pushRecent moves to the front, drops repeats and caps the list', () => {
    expect(pushRecent([], 'a')).toEqual(['a'])
    expect(pushRecent(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
    const long = Array.from({ length: 8 }, (_, i) => `c${i}`)
    expect(pushRecent(long, 'new')).toHaveLength(8)
    expect(pushRecent(long, 'new')[0]).toBe('new')
    expect(pushRecent(long, 'new')).not.toContain('c7')
  })

  it('with nothing typed, recent commands come first under “Recent”, in order', () => {
    const rows = paletteRows(explicitSel, '', ['view-present', 'calc-taylor', 'doc-share'])
    expect(rows.slice(0, 3).map((r) => r.cmd.id)).toEqual(['view-present', 'calc-taylor', 'doc-share'])
    expect(rows.slice(0, 3).every((r) => r.heading === 'Recent')).toBe(true)
    // and not listed twice
    expect(rows.filter((r) => r.cmd.id === 'view-present')).toHaveLength(1)
    expect(rows[3].heading).not.toBe('Recent')
  })

  it('a recent command that is hidden, greyed out or unknown is skipped', () => {
    const rows = paletteRows(implicitSel, '', ['calc-taylor', 'gone-command', 'style-screen', 'doc-share'])
    expect(rows[0].cmd.id).toBe('doc-share')
    expect(rows.filter((r) => r.heading === 'Recent')).toHaveLength(1)
  })

  it('at most five recent rows head the list', () => {
    const recent = ['help', 'doc-share', 'view-present', 'view-reveal', 'undo', 'doc-worksheet', 'view-theme']
    expect(paletteRows(explicitSel, '', recent).filter((r) => r.heading === 'Recent')).toHaveLength(5)
  })

  it('with a query, recency breaks a tie', () => {
    // “new”: New graph and New number line match equally well
    expect(paletteRows(explicitSel, 'new', [])[0].cmd.id).toBe('doc-new-graph')
    expect(paletteRows(explicitSel, 'new', ['doc-new-nl'])[0].cmd.id).toBe('doc-new-nl')
    // but never lifts a weak match over a strong one
    expect(paletteRows(explicitSel, 'derivative', ['view-theme', 'calc-signchart'])[0].cmd.id).toBe('calc-derivative')
  })

  it('“series” is Taylor until there is a sequence on the board to sum', () => {
    const ctx = ctxOf({
      curves: explicitCurves,
      selectedId: 'f',
      sequences: [{ id: 'S', name: 'a', text: 'a_n = 1/n^2', series: false, sums: false }],
    })
    expect(paletteRows(explicitSel, 'series')[0].cmd.id).toBe('calc-taylor')
    expect(paletteRows(ctx, 'series')[0].cmd.id).toBe('seq-series')
    expect(paletteRows(ctx, 'taylor series')[0].cmd.id).toBe('calc-taylor')
  })

  describe('are remembered in Prefs', () => {
    let saved: unknown
    beforeEach(() => {
      saved = (globalThis as { localStorage?: unknown }).localStorage
      const m = new Map<string, string>()
      ;(globalThis as { localStorage?: unknown }).localStorage = {
        getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
        setItem: (k: string, v: string) => void m.set(k, String(v)),
        removeItem: (k: string) => void m.delete(k),
        clear: () => m.clear(),
        key: () => null,
        length: 0,
      }
    })
    afterEach(() => {
      ;(globalThis as { localStorage?: unknown }).localStorage = saved
    })

    it('round-trips, defaults to empty, and drops junk', () => {
      expect(readPrefs().recentCommands).toEqual([])
      updatePrefs({ recentCommands: ['calc-taylor', 'doc-share'] })
      expect(readPrefs().recentCommands).toEqual(['calc-taylor', 'doc-share'])
      // other preferences are untouched by it
      expect(readPrefs().exportFormat).toBe('png')
      updatePrefs({ recentCommands: ['a', 'a', 7, '', 'b'] as unknown as string[] })
      expect(readPrefs().recentCommands).toEqual(['a', 'b'])
    })
  })
})

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

const APP_SRC = appSource()
const REVEAL_SRC = readFileSync(fileURLToPath(new URL('../src/ui/reveal.ts', import.meta.url)), 'utf8')

describe('keys: one owner each, no clashes', () => {
  const all = COMMANDS.flatMap((c) => (c.shortcuts ?? []).map((k) => ({ id: c.id, key: canonicalKey(k) })))

  it('no two commands share a shortcut', () => {
    const seen = new Map<string, string>()
    for (const { id, key } of all) {
      expect(seen.get(key), `${key}: ${seen.get(key)} and ${id}`).toBeUndefined()
      seen.set(key, id)
    }
  })

  it('no command shortcut is one of the board’s gesture keys', () => {
    const reserved = new Set(RESERVED_KEYS.map((r) => canonicalKey(r.keys)))
    for (const { id, key } of all) expect(reserved.has(key), `${id}: ${key}`).toBe(false)
  })

  it('every single key the App handles belongs to a command or is a gesture key, and vice versa', () => {
    // the letters App.tsx compares e.key (lower-cased) against, and the
    // characters it compares e.key against directly
    const handled = new Set<string>()
    for (const src of [APP_SRC, REVEAL_SRC]) {
      for (const m of src.matchAll(/\bkey(?:\.toLowerCase\(\))? === '([a-z])'/g)) handled.add(m[1].toUpperCase())
      for (const m of src.matchAll(/e\.key === '([^a-zA-Z'\\]|\\\\)'/g)) handled.add(m[1] === '\\\\' ? '\\' : m[1])
    }
    const owned = new Set(
      all.map(({ key }) => keyParts(key).pop() as string).filter((k) => k.length === 1),
    )
    for (const k of handled) expect(owned.has(k), `App handles “${k}” but no command owns it`).toBe(true)
    for (const k of owned) expect(handled.has(k), `“${k}” is a command shortcut the App never handles`).toBe(true)
  })

  it('the palette is ⌘K and /, help is ?', () => {
    expect(cmd('palette').shortcuts).toEqual(['Mod+K', '/'])
    expect(cmd('help').shortcuts).toEqual(['?'])
  })

  it('matchesKey reads ⌘ and Ctrl alike, and minds Shift on letters', () => {
    expect(matchesKey({ key: 'k', metaKey: true }, 'Mod+K')).toBe(true)
    expect(matchesKey({ key: 'K', ctrlKey: true }, 'Mod+K')).toBe(true)
    expect(matchesKey({ key: 'k' }, 'Mod+K')).toBe(false)
    expect(matchesKey({ key: 'z', metaKey: true, shiftKey: true }, 'Shift+Mod+Z')).toBe(true)
    expect(matchesKey({ key: 'z', metaKey: true }, 'Shift+Mod+Z')).toBe(false)
    expect(matchesKey({ key: '?', shiftKey: true }, '?')).toBe(true)
    expect(matchesKey({ key: 'P', shiftKey: true }, 'Shift+P')).toBe(true)
    expect(matchesKey({ key: 'p' }, 'Shift+P')).toBe(false)
  })

  it('formats for the platform', () => {
    expect(formatShortcut('Mod+K', true)).toBe('⌘K')
    expect(formatShortcut('Mod+K', false)).toBe('Ctrl+K')
    expect(formatShortcut('Shift+Mod+Z', true)).toBe('⇧⌘Z')
    expect(formatShortcut('Shift+Mod+Z', false)).toBe('Ctrl+Shift+Z')
    expect(formatShortcut('PageDown', true)).toBe('Page Down')
  })

  it('the help sheet’s keyboard section is generated from the registry', () => {
    const rows = shortcutRows()
    expect(rows.map((r) => r.id)).toEqual(COMMANDS.filter((c) => c.shortcuts?.length).map((c) => c.id))
    expect(rows.find((r) => r.id === 'view-reveal')?.keys).toEqual(['R'])
  })
})

// ---------------------------------------------------------------------------
// The two dialogs, rendered
// ---------------------------------------------------------------------------

describe('the palette and the help sheet render accessibly', () => {
  const noop = (): void => {}

  it('the palette is a dialog with a combobox that owns a listbox of grouped options', () => {
    const html = renderToStaticMarkup(
      createElement(CommandPalette, { ctx: explicitSel, recent: ['doc-share'], mac: true, onRun: noop, onClose: noop }),
    )
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('role="combobox"')
    expect(html).toContain('role="listbox"')
    expect(html).toContain('role="option"')
    expect(html).toContain('aria-activedescendant=')
    expect(html).toContain('>Recent<')
    expect(html).toContain('Calculus · for <span class="cmdk-heading-name">f</span>')
    expect(html).toContain('⌘Z')
    expect(html).toContain('role="status"')
  })

  it('opened for one command with nothing selected, the palette asks which curve', () => {
    const html = renderToStaticMarkup(
      createElement(CommandPalette, { ctx: noSel, recent: [], pickFor: 'calc-limit', mac: true, onRun: noop, onClose: noop }),
    )
    expect(html).toContain('Which curve?')
    expect(html).toContain('Limit at a point')
    expect(html).toContain('data-target="f"')
  })

  it('the help sheet lists every course, the keyboard section and “Do it” buttons', () => {
    const html = renderToStaticMarkup(
      createElement(HelpSheet, { ctx: explicitSel, mac: false, onDo: noop, onPalette: noop, onClose: noop }),
    )
    for (const t of [
      'What Grapher can do',
      'AP Calculus AB / BC',
      'Unit 10 · Infinite sequences and series (BC)',
      'AP Precalculus',
      'NC Math 1',
      'Coordinate geometry: distance, midpoint, slope, polygons (G-GPE.4–6)',
      'NC Math 2',
      'Right triangle trigonometry (G-SRT.6–8, 12)',
      'NC Math 3',
      'Drawing &amp; editing',
      'Exports &amp; worksheets',
      'In class',
      'Keyboard shortcuts',
      'Ctrl+K',
      'Curve ⋯ → Series → Taylor polynomial Pₙ',
    ]) {
      expect(html, t).toContain(t)
    }
    expect(html).toContain('data-command="calc-taylor"')
    expect((html.match(/>Do it</g) ?? []).length).toBeGreaterThan(40)
  })
})

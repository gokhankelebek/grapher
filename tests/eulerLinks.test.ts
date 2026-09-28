// ============================================================================
// tests/eulerLinks.test.ts — Euler's method as the BOARD holds it.
//
// The maths is tested in tests/euler.test.ts. Here: the document (a field
// without runs is byte-for-byte what it was before Euler existed; runs survive
// a save and a load; a damaged run is dropped and reported, n is clamped), the
// pure card logic (defaults, edits, the table and verdict handed to the card),
// the scene (paths, tags, labels, the true solution) and the figure (it
// exports, it goes mono under SAT, and an empty list changes no pixel).
// ============================================================================

import { describe, expect, it } from 'vitest'
import {
  deserializeDoc,
  docFromBoard,
  fieldToStored,
  serializeDoc,
  storedToEulers,
  storedToField,
  FIELD_SPACING_DEFAULT,
} from '../src/core/persist'
import type { BoardField, BoardInput, DocMeta, EulerRun } from '../src/core/persist'
import { compileFields, fieldCard } from '../src/ui/fieldLinks'
import {
  EULER_N_MAX,
  RUN_DASHES,
  TRUE_DASH,
  defaultRun,
  eulerCards,
  eulerLegend,
  eulerScene,
  eulerTarget,
  needsTrueSolve,
  patchRun,
  pointName,
  runCaption,
  runColor,
  stepPhrase,
  withRun,
  withoutRun,
} from '../src/ui/eulerLinks'
import { renderBoard, type BoardChrome, type BoardScene, type EulerPath } from '../src/ui/renderBoard'
import { MockCtx, withMockPath2D } from './mockCanvas'
import { MODELS } from '../src/core/fit/models'
import { CURVE_COLORS, DARK_THEME, FIGURE_STYLES } from '../src/core/types'
import type { FittedCurve, Viewport } from '../src/core/types'

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const META: DocMeta = { id: 'doc1', name: 'Euler', createdAt: 1000, modifiedAt: 1000 }

function field(over: Partial<BoardField> = {}): BoardField {
  return {
    id: 'F1',
    src: 'dy/dx = x + y',
    params: [],
    color: CURVE_COLORS[0],
    spacingPx: FIELD_SPACING_DEFAULT,
    visible: true,
    solutions: [],
    ...over,
  }
}

const run = (over: Partial<EulerRun> = {}): EulerRun => ({ id: 'E1', x0: 0, y0: 1, h: 0.5, n: 2, ...over })

function board(over: Partial<BoardInput> = {}): BoardInput {
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

const save = (input: BoardInput): string => serializeDoc(docFromBoard(META, input, 2000))
const roundTrip = (input: BoardInput) => deserializeDoc(save(input))

/** A stored document with this raw field record, as a hand-edited file would be. */
function rawDoc(fieldRecord: unknown): string {
  return JSON.stringify({
    version: 2,
    id: 'd',
    name: 'n',
    createdAt: 1,
    modifiedAt: 1,
    board: {
      curves: [],
      viewport: { cx: 0, cy: 0, ppu: 60 },
      selectedId: null,
      mode: 'draw',
      fields: [fieldRecord],
    },
  })
}

// ===========================================================================
// The document
// ===========================================================================

describe('Euler runs in the document', () => {
  it('a field without runs is byte-for-byte what it was before Euler existed', () => {
    const plain = board({ fields: [field()] })
    const withEmpty = board({ fields: [field({ eulers: [] })] })
    expect(save(withEmpty)).toBe(save(plain))
    expect(save(plain)).not.toContain('eulers')
    expect('eulers' in fieldToStored(field({ eulers: [] }))).toBe(false)
  })

  it('an old record loads back as exactly the object it always did — no eulers key', () => {
    const built = storedToField({ id: 'F1', src: 'dy/dx = x + y', color: '#4f9cf9', through: [0, 1] })
    expect('field' in built).toBe(true)
    if ('field' in built) {
      expect('eulers' in built.field).toBe(false)
      expect(built.problems).toBeUndefined()
    }
  })

  it('writes a run as its four numbers, flags only when on, and no id', () => {
    const stored = fieldToStored(
      field({ eulers: [run(), run({ id: 'E2', h: -0.25, n: 8, showTrue: true, labels: true })] }),
    )
    expect(stored.eulers).toEqual([
      { x0: 0, y0: 1, h: 0.5, n: 2 },
      { x0: 0, y0: 1, h: -0.25, n: 8, true: true, labels: true },
    ])
  })

  it('round-trips, at full precision, and a second save changes no byte', () => {
    const f = field({
      eulers: [run({ x0: 1 / 3, y0: Math.PI, h: 0.1, n: 7, showTrue: true }), run({ id: 'E2', h: -1 })],
    })
    const res = roundTrip(board({ fields: [f] }))
    expect(res.degraded).toBe(false)
    const back = res.board!.fields[0]
    expect(back.eulers!.map(({ x0, y0, h, n, showTrue, labels }) => ({ x0, y0, h, n, showTrue, labels }))).toEqual([
      { x0: 1 / 3, y0: Math.PI, h: 0.1, n: 7, showTrue: true, labels: undefined },
      { x0: 0, y0: 1, h: -1, n: 2, showTrue: undefined, labels: undefined },
    ])
    expect(back.eulers![0].id).toBeTruthy()
    expect(back.eulers![0].id).not.toBe(back.eulers![1].id)
    // load → save is a fixed point
    const again = serializeDoc(docFromBoard(META, { ...board(), fields: res.board!.fields }, 2000))
    expect(again).toBe(save(board({ fields: [f] })))
  })

  it('drops a run it cannot step, reports it, and clamps n', () => {
    const res = deserializeDoc(
      rawDoc({
        id: 'F1',
        src: 'dy/dx = x + y',
        color: '#4f9cf9',
        eulers: [
          { x0: 0, y0: 1, h: 0.5, n: 80 }, // n clamped to 50
          { x0: 0, y0: 1, h: 0, n: 4 }, // h = 0: dropped
          { x0: 'a', y0: 1, h: 0.5, n: 4 }, // no start: dropped
          { x0: 0, y0: 1, h: 0.5, n: 0 }, // n clamped to 1
          { x0: 0, y0: 1, h: 0.5, n: 2.6 }, // n rounded to 3
          { x0: 0, y0: 1, h: 0.5, n: 'four' }, // no count: dropped
          null,
        ],
      }),
    )
    const f = res.board!.fields[0]
    expect(f.eulers!.map((r) => r.n)).toEqual([50, 1, 3])
    expect(res.degraded).toBe(true)
    expect(res.problems.join(' ')).toMatch(/4 Euler’s-method runs .* were removed/)
    expect(res.problems.join(' ')).toContain('dy/dx = x + y')
  })

  it('a field whose runs are all bad keeps the field and loses only the key', () => {
    const res = deserializeDoc(
      rawDoc({ id: 'F1', src: 'dy/dx = x + y', color: '#4f9cf9', eulers: [{ x0: 0, y0: 1, h: 0, n: 4 }] }),
    )
    expect(res.board!.fields).toHaveLength(1)
    expect('eulers' in res.board!.fields[0]).toBe(false)
    expect(res.degraded).toBe(true)
  })

  it('an unreadable list is reported, not thrown', () => {
    expect(storedToEulers('nope').problems).toHaveLength(1)
    expect(storedToEulers(undefined)).toEqual({ runs: [], problems: [] })
  })
})

// ===========================================================================
// The pure card logic
// ===========================================================================

describe('adding and editing runs', () => {
  it('the first run starts at the first solution point, else (0, 1); h = 0.5, n = 4', () => {
    expect(defaultRun(field())).toEqual({ x0: 0, y0: 1, h: 0.5, n: 4 })
    expect(defaultRun(field({ solutions: [{ id: 'S', x: 2, y: -1 }] }))).toEqual({
      x0: 2,
      y0: -1,
      h: 0.5,
      n: 4,
    })
  })

  it('a later run halves h and doubles n — same target, finer step', () => {
    const f = field({ eulers: [run({ x0: 1, y0: 2, h: 0.5, n: 4 })] })
    const next = defaultRun(f)
    expect(next).toEqual({ x0: 1, y0: 2, h: 0.25, n: 8 })
    expect(eulerTarget(next)).toBe(eulerTarget(f.eulers![0]))
    // past the cap it keeps h and n rather than landing somewhere else
    expect(defaultRun(field({ eulers: [run({ n: 40 })] }))).toMatchObject({ h: 0.5, n: 40 })
  })

  it('patchRun refuses h = 0 and non-numbers, clamps n, and writes flags only when on', () => {
    const f = field({ eulers: [run()] })
    expect(patchRun(f, 'E1', { h: 0 })).toBe(f)
    expect(patchRun(f, 'E1', { x0: NaN })).toBe(f)
    expect(patchRun(f, 'E1', { n: 2 })).toBe(f) // no change, same object
    expect(patchRun(f, 'E1', { n: 99 }).eulers![0].n).toBe(EULER_N_MAX)
    expect(patchRun(f, 'E1', { n: 0 }).eulers![0].n).toBe(1)
    const on = patchRun(f, 'E1', { showTrue: true, labels: true })
    expect(on.eulers![0]).toMatchObject({ showTrue: true, labels: true })
    const off = patchRun(on, 'E1', { showTrue: false, labels: false })
    expect(off.eulers![0]).toEqual(run())
    expect(fieldToStored(off)).toEqual(fieldToStored(f))
  })

  it('withRun / withoutRun, and the key goes with the last run', () => {
    const f = withRun(field(), run())
    expect(f.eulers).toHaveLength(1)
    const g = withoutRun(f, 'E1')
    expect('eulers' in g).toBe(false)
    expect(withoutRun(f, 'nope')).toBe(f)
  })
})

describe('what the card is handed', () => {
  const card = (f: BoardField) => eulerCards(f, compileFields([f]))

  it('the table, the approximation, the true value and the verdict', () => {
    const [c] = card(field({ eulers: [run()] }))
    expect(c.rows.map((r) => [r.k, r.x.text, r.y.text, r.slope.text, r.dy.text])).toEqual([
      [0, '0', '1', '1', '0.5'],
      [1, '0.5', '1.5', '2', '1'],
      [2, '1', '2.5', '3.5', '1.75'],
    ])
    expect(c.rows[2].last).toBe(true)
    expect(c.target.text).toBe('1')
    expect(c.approx).toEqual({ lhs: 'y(1)', value: expect.objectContaining({ text: '2.5' }) })
    expect(c.trueY!.text).toBe('3.4366')
    expect(c.error!.text).toBe('−0.9366')
    expect(c.verdict!.kind).toBe('under')
    expect(c.verdict!.label).toBe('Underestimate')
    expect(c.verdict!.d2tex).toBe('1 + \\frac{dy}{dx}')
    expect(c.verdict!.caution).toBeNull()
    expect(c.caption).toBe('Euler’s method, h = 0.5')
  })

  it('a table that stops early says so and offers no approximation', () => {
    const [c] = card(field({ src: 'dy/dx = 1/x', eulers: [run({ x0: -1, y0: 0, h: 0.5, n: 4 })] }))
    expect(c.rows).toHaveLength(3)
    expect(c.stopped).toMatch(/^Stopped after P₂: dy\/dx is undefined/)
    expect(c.approx).toBeNull()
    expect(c.verdict).toBeNull()
  })

  it('a field that no longer parses still lists its runs, with no table', () => {
    const f = field({ src: 'dy/dx = ???', eulers: [run()] })
    const [c] = eulerCards(f, new Map())
    expect(c.rows).toEqual([])
    expect(c.stopped).toMatch(/cannot be read/)
  })

  it('reaches the card through fieldCard', () => {
    const f = field({ eulers: [run()] })
    expect(fieldCard(f, compileFields([f])).eulers).toHaveLength(1)
    expect(fieldCard(field(), compileFields([field()])).eulers).toEqual([])
  })

  it('words', () => {
    expect(pointName(0)).toBe('P₀')
    expect(pointName(12)).toBe('P₁₂')
    expect(stepPhrase(-0.25)).toBe('h = −0.25')
    expect(stepPhrase(1 / 3)).toBe('h = 1/3')
    expect(runCaption({ h: 0.5 })).toBe('Euler’s method, h = 0.5')
  })
})

// ===========================================================================
// The scene
// ===========================================================================

describe('what the board draws', () => {
  const SPAN: [number, number] = [-10, 10]

  it('one path per run: the points, the tag, a dash from the second run on', () => {
    const f = field({ eulers: [run(), run({ id: 'E2', h: 0.25, n: 4, labels: true })] })
    const { paths, polylines } = eulerScene([f], compileFields([f]), SPAN)
    expect(paths).toHaveLength(2)
    expect(paths[0].pts).toEqual([
      { x: 0, y: 1 },
      { x: 0.5, y: 1.5 },
      { x: 1, y: 2.5 },
    ])
    expect(paths[0].tag).toBe('h = 0.5')
    expect(paths[0].dash).toBeUndefined()
    expect(paths[0].labels).toBeUndefined()
    expect(paths[1].dash).toEqual(RUN_DASHES[1])
    expect(paths[1].labels).toEqual(['P₀', 'P₁', 'P₂', 'P₃', 'P₄'])
    expect(polylines).toEqual([])
  })

  it('"Show the actual solution" adds the true solution through the start, dotted', () => {
    const f = field({ eulers: [run({ showTrue: true })] })
    const { polylines } = eulerScene([f], compileFields([f]), SPAN)
    expect(polylines).toHaveLength(1)
    expect(polylines[0].dash).toEqual(TRUE_DASH)
    // it passes through (0, 1) and is y = 2eˣ − x − 1
    const at1 = polylines[0].pts.reduce((a, p) => (Math.abs(p.x - 1) < Math.abs(a.x - 1) ? p : a))
    expect(at1.y).toBeCloseTo(2 * Math.exp(at1.x) - at1.x - 1, 6)
    expect(needsTrueSolve([f])).toBe(true)
    expect(needsTrueSolve([field({ eulers: [run()] })])).toBe(false)
  })

  it('a hidden field draws no runs', () => {
    const f = field({ visible: false, eulers: [run({ showTrue: true })] })
    expect(eulerScene([f], compileFields([f]), SPAN)).toEqual({ paths: [], polylines: [] })
  })

  it('each run gets a palette colour that is not the field’s', () => {
    for (const fc of CURVE_COLORS) {
      const cs = [0, 1, 2, 3, 4, 5, 6].map((i) => runColor(fc, i))
      expect(cs).not.toContain(fc)
      expect(new Set(cs.slice(0, 4)).size).toBe(4)
      for (const c of cs) expect(CURVE_COLORS).toContain(c)
    }
  })

  it('the legend names each run by its step', () => {
    const f = field({ eulers: [run(), run({ id: 'E2', h: 0.25 })] })
    expect(eulerLegend([f], compileFields([f])).map((e) => e.text)).toEqual([
      'Euler’s method, h = 0.5',
      'Euler’s method, h = 0.25',
    ])
  })
})

// ===========================================================================
// The figure
// ===========================================================================

describe('Euler paths are figure content', () => {
  const VP: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 900, heightPx: 700 }
  const SQ: FittedCurve = {
    id: 'sq', modelId: 'poly2', params: [0, 0, 1], kind: 'explicit', domain: null,
    color: CURVE_COLORS[0], strokeWidth: 2.5, visible: true, error: 0,
  }
  const COLOR = CURVE_COLORS[3]
  const PATH: EulerPath = {
    id: 'euler:E1',
    pts: [{ x: 0, y: 1 }, { x: 0.5, y: 1.5 }, { x: 1, y: 2.5 }],
    color: COLOR,
    tag: 'h = 0.5',
    labels: ['P₀', 'P₁', 'P₂'],
  }
  const chromeOn = (): BoardChrome => ({
    selectedId: SQ.id, handles: [], activeHandleId: null, highlight: null, openIdx: null, hoverIdx: null,
  })
  const scene = (over: Partial<BoardScene> = {}): BoardScene => ({
    vp: VP, theme: DARK_THEME, curves: [SQ], styles: {}, models: MODELS, analysis: null, chrome: null,
    ...over,
  })
  const render = (s: BoardScene): MockCtx => {
    const ctx = new MockCtx()
    withMockPath2D(() => renderBoard(ctx as unknown as CanvasRenderingContext2D, s))
    return ctx
  }
  const snapshot = (c: MockCtx): string =>
    JSON.stringify({
      cmds: c.own.cmds,
      texts: c.texts,
      strokeStyles: c.strokeStyles,
      fillStyles: c.fillStyles,
      counts: [c.strokeCount, c.fillCount, c.textCount, c.saveCount, c.restoreCount],
    })

  it('reaches the export (chrome: null) exactly as the screen draws it', () => {
    const exported = render(scene({ eulers: [PATH] }))
    const onScreen = render(scene({ eulers: [PATH], chrome: chromeOn() }))
    expect(exported.strokeStyles).toContain(COLOR)
    expect(exported.texts.map((t) => t.text)).toEqual(expect.arrayContaining(['P₀', 'P₁', 'P₂', 'h = 0.5']))
    const mine = (c: MockCtx): string[] => c.strokeStyles.filter((s) => s === COLOR)
    expect(mine(onScreen)).toEqual(mine(exported))
  })

  it('a dot at each step and a ring at the start', () => {
    const ctx = render(scene({ eulers: [{ ...PATH, labels: undefined, tag: undefined }] }))
    const before = render(scene())
    // two dots (halo + disc each) and the start ring
    expect(ctx.arcCount - before.arcCount).toBe(5)
  })

  it('goes mono under SAT: every stroke of it in the axis ink', () => {
    const sat = FIGURE_STYLES.sat
    const ctx = render(scene({ eulers: [PATH], figure: sat, theme: sat.theme }))
    expect(ctx.strokeStyles).not.toContain(COLOR)
    expect(ctx.strokeStyles).toContain(sat.theme.axis)
  })

  it('an empty list draws exactly what the board drew before Euler existed', () => {
    for (const over of [{}, { chrome: chromeOn() }, { figure: FIGURE_STYLES.sat }] as Array<Partial<BoardScene>>) {
      expect(snapshot(render(scene({ ...over, eulers: [] })))).toBe(snapshot(render(scene(over))))
    }
    expect(snapshot(render(scene({ eulers: [PATH] })))).not.toBe(snapshot(render(scene())))
  })

  it('a run that runs off to infinity draws what it can and does not throw', () => {
    const wild: EulerPath = { id: 'w', pts: [{ x: 0, y: 1 }, { x: 1, y: 1e300 }, { x: 2, y: NaN }], color: COLOR }
    expect(() => render(scene({ eulers: [wild] }))).not.toThrow()
  })
})

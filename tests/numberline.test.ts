// ============================================================================
// tests/numberline.test.ts — the figure Algebra 1/2 draws most, and the one
// thing it has to get right: a filled dot INCLUDES its endpoint and a hollow
// one EXCLUDES it.
//
// Two failure modes are pinned here because both have shipped in real tools:
//
//   1. the hollow dot drawn as a hole rather than as an opaque disc, so the
//      interval bar runs straight through it and it reads as filled — on paper
//      and through a copier, that is a wrong answer printed on a worksheet;
//   2. the export growing its own render path, so what a teacher sees is not
//      what lands in the PNG. Number lines go through renderBoard() like
//      everything else, and these tests assert that from the outside.
// ============================================================================

import { describe, it, expect } from 'vitest'
import { renderBoard } from '../src/ui/renderBoard'
import type { BoardScene } from '../src/ui/renderBoard'
import { MockCtx, withMockPath2D } from './mockCanvas'
import { DARK_THEME, LIGHT_THEME, CURVE_COLORS, PRINT_CURVE_COLORS } from '../src/core/types'
import { intervalNotation } from '../src/core/types'
import type { NLItem, Viewport } from '../src/core/types'
import {
  nlHitTest,
  nlLanes,
  nlSnapX,
  nlToScreenX,
  numberLineAxisY,
} from '../src/render/numberline'
import {
  SCHEMA_VERSION,
  boardToStored,
  createDoc,
  deserializeDoc,
  docFromBoard,
  emptyBoard,
  hydrateDoc,
  serializeDoc,
} from '../src/core/persist'
import type { BoardInput, DocMeta } from '../src/core/persist'

const VP: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 900, heightPx: 700 }
const AXIS_Y = numberLineAxisY(VP)
const COLOR = CURVE_COLORS[0]

/** −2 ≤ x < 5 : closed at −2, open at 5. */
const HALF_OPEN: NLItem = {
  kind: 'interval',
  id: 'i1',
  lo: -2,
  hi: 5,
  loClosed: true,
  hiClosed: false,
  color: COLOR,
}

interface Circle {
  x: number
  y: number
  r: number
  op: 'fill' | 'stroke'
  style: string
}

/**
 * MockCtx, plus the one thing asserting dots needs: which style each circle was
 * painted with. The base recorder notes styles at stroke/fillText time only.
 */
class NLCtx extends MockCtx {
  circles: Circle[] = []
  private pending: { x: number; y: number; r: number } | null = null

  beginPath(): void {
    this.pending = null
    super.beginPath()
  }
  arc(x: number, y: number, r: number): void {
    this.pending = { x, y, r }
    super.arc(x, y, r)
  }
  fill(): void {
    if (this.pending) this.circles.push({ ...this.pending, op: 'fill', style: this.fillStyle })
    super.fill()
  }
  stroke(path?: never): void {
    if (this.pending) this.circles.push({ ...this.pending, op: 'stroke', style: this.strokeStyle })
    super.stroke(path)
  }

  /** Circles painted within 1.5px of (x, y). */
  at(x: number, y: number): Circle[] {
    return this.circles.filter((c) => Math.hypot(c.x - x, c.y - y) <= 1.5)
  }

  /** Horizontal segments drawn along `y`, as [from, to] in screen px. */
  bars(y: number): Array<[number, number]> {
    const out: Array<[number, number]> = []
    for (const sp of this.own.subpaths()) {
      for (let i = 1; i < sp.length; i++) {
        const a = sp[i - 1]
        const b = sp[i]
        if (Math.abs(a.y - y) > 1.5 || Math.abs(b.y - y) > 1.5) continue
        if (Math.abs(b.x - a.x) < 2) continue
        out.push([Math.min(a.x, b.x), Math.max(a.x, b.x)])
      }
    }
    return out
  }
}

function scene(over: Partial<BoardScene> = {}): BoardScene {
  return {
    vp: VP,
    theme: DARK_THEME,
    kind: 'number-line',
    items: [HALF_OPEN],
    curves: [],
    styles: {},
    models: {},
    ...over,
  }
}

function render(s: BoardScene): NLCtx {
  const ctx = new NLCtx()
  withMockPath2D(() => renderBoard(ctx as unknown as CanvasRenderingContext2D, s))
  return ctx
}

// ---------------------------------------------------------------------------

describe('number line — the axis', () => {
  it('draws one horizontal line across the board, with an arrowhead at each end', () => {
    const ctx = render(scene({ items: [] }))
    const spans = ctx.bars(AXIS_Y)
    expect(spans.some(([a, b]) => a <= 1 && b >= VP.widthPx - 1)).toBe(true)
    // Two arrowheads: closed triangles pointing off each end.
    const closes = ctx.own.cmds.filter((c) => c.op === 'closePath').length
    expect(closes).toBeGreaterThanOrEqual(2)
  })

  it('labels ticks on the 1–2–5 ladder the grid uses, at the right pixels', () => {
    const ctx = render(scene({ items: [] }))
    const labels = ctx.texts.map((t) => t.text)
    // At 60 px per unit the ladder puts a major tick on every integer.
    for (const v of ['-3', '-1', '0', '2', '5']) expect(labels).toContain(v)
    const two = ctx.texts.find((t) => t.text === '2')
    expect(two!.x).toBeCloseTo(nlToScreenX(2, VP), 6)
    expect(two!.y).toBeGreaterThan(AXIS_Y) // labels sit under the line
  })

  it('coarsens the ladder as it zooms out instead of piling up labels', () => {
    const far = { ...VP, pxPerUnit: 4 }
    const ctx = render(scene({ vp: far, items: [] }))
    const nums = ctx.texts.map((t) => Number(t.text)).filter((n) => Number.isFinite(n))
    expect(nums.length).toBeLessThan(40)
    const gaps = nums.slice(1).map((n, i) => Math.abs(n - nums[i]))
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(10)
  })
})

describe('number line — closed vs open, the whole point of the figure', () => {
  it('-2 <= x < 5 draws a filled dot at -2, a hollow dot at 5, and a bar between', () => {
    const ctx = render(scene())
    const loX = nlToScreenX(-2, VP)
    const hiX = nlToScreenX(5, VP)
    expect(loX).toBeCloseTo(330, 6)
    expect(hiX).toBeCloseTo(750, 6)

    // closed end: painted solid in the item's own colour
    const lo = ctx.at(loX, AXIS_Y)
    expect(lo.some((c) => c.op === 'fill' && c.style === COLOR)).toBe(true)

    // open end: a ring in the item's colour, NOT a disc of it
    const hi = ctx.at(hiX, AXIS_Y)
    expect(hi.some((c) => c.op === 'stroke' && c.style === COLOR)).toBe(true)
    expect(hi.some((c) => c.op === 'fill' && c.style === COLOR)).toBe(false)

    // the bar joins them
    const spans = ctx.bars(AXIS_Y)
    expect(
      spans.some(([a, b]) => Math.abs(a - loX) <= 1 && Math.abs(b - hiX) <= 1),
    ).toBe(true)
  })

  it('the hollow dot has an OPAQUE centre, so the bar cannot show through it', () => {
    const ctx = render(scene())
    const hi = ctx.at(nlToScreenX(5, VP), AXIS_Y)
    const centre = hi.find((c) => c.op === 'fill')
    expect(centre, 'the open endpoint was drawn as a hole, not a disc').toBeTruthy()
    expect(centre!.style).toBe(DARK_THEME.bg)
  })

  it('survives the print theme: the centre becomes white, never transparent', () => {
    const ctx = render(scene({ theme: LIGHT_THEME, printColors: true }))
    const hi = ctx.at(nlToScreenX(5, VP), AXIS_Y)
    const centre = hi.find((c) => c.op === 'fill')
    expect(centre!.style).toBe('#ffffff')
    // and the ring is the print counterpart of the screen colour
    expect(hi.some((c) => c.op === 'stroke' && c.style === PRINT_CURVE_COLORS[0])).toBe(true)
  })

  it('a closed dot and an open dot are never painted the same way', () => {
    const both: NLItem[] = [
      { kind: 'point', id: 'p1', x: -1, closed: true, color: COLOR },
      { kind: 'point', id: 'p2', x: 1, closed: false, color: COLOR },
    ]
    const ctx = render(scene({ items: both }))
    const a = ctx.at(nlToScreenX(-1, VP), AXIS_Y)
    const b = ctx.at(nlToScreenX(1, VP), AXIS_Y)
    const solid = (cs: Circle[]): boolean => cs.some((c) => c.op === 'fill' && c.style === COLOR)
    expect(solid(a)).toBe(true)
    expect(solid(b)).toBe(false)
  })

  it('an unbounded end is an arrow, and has no dot at all', () => {
    const ray: NLItem = {
      kind: 'interval',
      id: 'r1',
      lo: null,
      hi: 3,
      loClosed: false,
      hiClosed: true,
      color: COLOR,
    }
    const ctx = render(scene({ items: [ray] }))
    expect(ctx.at(nlToScreenX(3, VP), AXIS_Y).length).toBeGreaterThan(0)
    // nothing is drawn as an endpoint out at the left edge
    expect(ctx.circles.filter((c) => c.x < 20)).toHaveLength(0)
    expect(intervalNotation(ray)).toBe('(-\\infty, 3]')
  })
})

describe('number line — labels', () => {
  it('draws the item label above the item', () => {
    const ctx = render(scene({ items: [{ ...HALF_OPEN, label: 'domain of f' }] }))
    const label = ctx.texts.find((t) => t.text === 'domain of f')
    expect(label, 'the label never reached the figure').toBeTruthy()
    expect(label!.y).toBeLessThan(AXIS_Y)
    expect(label!.x).toBeGreaterThan(nlToScreenX(-2, VP))
    expect(label!.x).toBeLessThan(nlToScreenX(5, VP))
  })
})

describe('number line — the export is the same picture without the chrome', () => {
  const exportScene = (): BoardScene =>
    scene({ theme: LIGHT_THEME, printColors: true, chrome: null })

  it('is drawn on white, edge to edge', () => {
    const ctx = render(exportScene())
    const ground = ctx.fills[0]
    expect(ground.style).toBe('#ffffff')
    expect(ground.w).toBe(VP.widthPx)
    expect(ground.h).toBe(VP.heightPx)
  })

  it('still contains the items, the axis and the ticks', () => {
    const ctx = render(exportScene())
    expect(ctx.at(nlToScreenX(-2, VP), AXIS_Y).length).toBeGreaterThan(0)
    expect(ctx.at(nlToScreenX(5, VP), AXIS_Y).length).toBeGreaterThan(0)
    expect(ctx.texts.map((t) => t.text)).toContain('0')
    expect(ctx.bars(AXIS_Y).length).toBeGreaterThan(1)
  })

  it('contains no selection wash and no in-progress item', () => {
    const withChrome = render(
      scene({
        chrome: {
          selectedId: HALF_OPEN.id,
          handles: [],
          activeHandleId: null,
          highlight: null,
          openIdx: null,
          hoverIdx: null,
          activePart: { itemId: HALF_OPEN.id, part: 'hi' },
          pending: {
            kind: 'interval',
            id: '__pending__',
            lo: 7,
            hi: 9,
            loClosed: true,
            hiClosed: true,
            color: COLOR,
          },
        },
      }),
    )
    const bare = render(scene({ chrome: null }))
    // The pending interval exists on screen and nowhere else.
    expect(withChrome.at(nlToScreenX(7, VP), AXIS_Y).length).toBeGreaterThan(0)
    expect(bare.at(nlToScreenX(7, VP), AXIS_Y)).toHaveLength(0)
    // Chrome strictly adds; it never replaces any part of the figure.
    expect(withChrome.fillCount).toBeGreaterThan(bare.fillCount)
    expect(bare.at(nlToScreenX(-2, VP), AXIS_Y).length).toBeGreaterThan(0)
  })

  it('a cartesian scene is completely unaffected by the number-line branch', () => {
    const cart = render({ ...scene(), kind: 'cartesian', items: [HALF_OPEN] })
    const noKind = render({ ...scene(), kind: undefined, items: [HALF_OPEN] })
    // No items are drawn on a cartesian board, and an absent kind means
    // cartesian — every existing caller keeps the picture it had.
    expect(cart.at(nlToScreenX(-2, VP), AXIS_Y)).toHaveLength(0)
    expect(noKind.at(nlToScreenX(-2, VP), AXIS_Y)).toHaveLength(0)
    expect(noKind.texts.length).toBe(cart.texts.length)
  })
})

describe('number line — layout and hit testing', () => {
  it('keeps a disjoint union on the line itself, and lifts only what overlaps', () => {
    const a: NLItem = { ...HALF_OPEN, id: 'a', lo: -6, hi: -3 }
    const b: NLItem = { ...HALF_OPEN, id: 'b', lo: 1, hi: 4 }
    const overlapping: NLItem = { ...HALF_OPEN, id: 'c', lo: 0, hi: 5 }
    const flat = nlLanes([a, b], VP)
    expect(flat.map((l) => l.lane)).toEqual([0, 0])
    const stacked = nlLanes([a, b, overlapping], VP)
    expect(stacked[2].lane).toBe(1)
    expect(stacked[2].y).toBeLessThan(stacked[0].y)
  })

  it('finds an endpoint before the bar it belongs to', () => {
    const hit = nlHitTest([HALF_OPEN], VP, { x: nlToScreenX(5, VP) + 2, y: AXIS_Y })
    expect(hit).toEqual({ id: 'i1', part: 'hi' })
    const body = nlHitTest([HALF_OPEN], VP, { x: nlToScreenX(1, VP), y: AXIS_Y })
    expect(body).toEqual({ id: 'i1', part: 'body' })
    expect(nlHitTest([HALF_OPEN], VP, { x: nlToScreenX(9, VP), y: AXIS_Y })).toBeNull()
  })

  it('snaps a click to a tick, exactly — an endpoint at "-2" must BE -2', () => {
    expect(nlSnapX(-2.01, VP)).toBe(-2)
    expect(nlSnapX(0.004, VP)).toBe(0)
    // Far from any tick, the exact value is kept rather than dragged to one.
    expect(nlSnapX(2.5, { ...VP, pxPerUnit: 400 })).toBeCloseTo(2.5, 9)
  })
})

// ---------------------------------------------------------------------------
// Persistence: the board kind rides along, and nothing that existed before it
// changes shape.
// ---------------------------------------------------------------------------

const META: DocMeta = { id: 'doc1', name: 'Solution sets', createdAt: 1000, modifiedAt: 1000 }

function boardInput(over: Partial<BoardInput> = {}): BoardInput {
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

describe('number line — persistence', () => {
  it('round-trips a number-line board through JSON', () => {
    const items: NLItem[] = [
      { ...HALF_OPEN, label: 'domain' },
      { kind: 'point', id: 'p1', x: 7, closed: false, color: CURVE_COLORS[1] },
    ]
    const doc = docFromBoard(META, boardInput({ kind: 'number-line', items, selectedId: 'i1' }))
    const res = deserializeDoc(serializeDoc(doc))
    expect(res.problems).toEqual([])
    expect(res.degraded).toBe(false)
    expect(res.board!.kind).toBe('number-line')
    expect(res.board!.items).toEqual(items)
    expect(res.board!.selectedId).toBe('i1')
  })

  it('carries an item style with the item, not in a second map', () => {
    const doc = docFromBoard(
      META,
      boardInput({
        kind: 'number-line',
        items: [HALF_OPEN],
        styles: { i1: { width: 9, opacity: 0.5, dash: [10, 7] } },
      }),
    )
    const res = deserializeDoc(serializeDoc(doc))
    expect(res.board!.styles.i1).toEqual({ dash: [10, 7], opacity: 0.5, width: 9 })
  })

  it('a cartesian board still serialises with no kind and no items at all', () => {
    const stored = boardToStored(boardInput())
    expect('kind' in stored).toBe(false)
    expect('items' in stored).toBe(false)
    expect(JSON.parse(JSON.stringify(stored))).toEqual({
      curves: [],
      viewport: { cx: 0, cy: 0, ppu: 60 },
      selectedId: null,
      mode: 'draw',
    })
  })

  it('a document saved by the previous format loads with nothing reported', () => {
    // Exactly what version 1 wrote: no kind, no items, no version bump.
    const legacy = {
      version: 1,
      id: 'old',
      name: 'Lesson 3',
      createdAt: 10,
      modifiedAt: 20,
      board: {
        curves: [{ id: 'c1', modelId: 'line', kind: 'explicit', params: [1, 2], domain: null, color: '#4f9cf9', strokeWidth: 2.5, visible: true, error: 0 }],
        viewport: { cx: 1.5, cy: -2, ppu: 42 },
        selectedId: 'c1',
        mode: 'pan',
      },
    }
    const res = deserializeDoc(JSON.stringify(legacy))
    expect(res.problems, 'an unchanged upgrade must not warn the user').toEqual([])
    expect(res.degraded).toBe(false)
    expect(res.board!.kind).toBe('cartesian')
    expect(res.board!.items).toEqual([])
    expect(res.board!.curves).toHaveLength(1)
    expect(res.board!.viewport).toEqual({ center: { x: 1.5, y: -2 }, pxPerUnit: 42 })
    expect(res.board!.selectedId).toBe('c1')
    expect(res.board!.mode).toBe('pan')
  })

  it('an empty number-line document is created with its kind already set', () => {
    const doc = createDoc('NL', emptyBoard('number-line'))
    expect(doc.version).toBe(SCHEMA_VERSION)
    expect(doc.board.kind).toBe('number-line')
    const res = hydrateDoc(doc)
    expect(res.board!.kind).toBe('number-line')
  })

  it('refuses a stored item that claims every number, and says so', () => {
    const res = hydrateDoc({
      version: SCHEMA_VERSION,
      board: {
        curves: [],
        kind: 'number-line',
        items: [
          { kind: 'interval', id: 'bad', lo: null, hi: null, loClosed: false, hiClosed: false, color: '#fff' },
          { kind: 'point', id: 'ok', x: 3, closed: true, color: '#fff' },
        ],
      },
    })
    expect(res.board!.items.map((i) => i.id)).toEqual(['ok'])
    expect(res.degraded).toBe(true)
    expect(res.problems.join(' ')).toMatch(/damaged number-line item/i)
  })

  it('keeps both boards when a document has been switched between kinds', () => {
    const curve = {
      id: 'c1',
      modelId: 'line',
      params: [1, 2],
      kind: 'explicit' as const,
      domain: null,
      color: '#4f9cf9',
      strokeWidth: 2.5,
      visible: true,
      error: 0,
    }
    const doc = docFromBoard(
      META,
      boardInput({ kind: 'number-line', items: [HALF_OPEN], curves: [curve] }),
    )
    const res = deserializeDoc(serializeDoc(doc))
    expect(res.board!.curves).toHaveLength(1)
    expect(res.board!.items).toHaveLength(1)
  })
})

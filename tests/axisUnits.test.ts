// ============================================================================
// tests/axisUnits.test.ts — the per-document axis-units choice.
//
// The renderer already knows how to draw a π axis (tests/piTicks.test.ts) and
// how to RECOMMEND one (suggestAxisUnits). This file covers the half the App
// owns: turning a recommendation plus a teacher's choice into the units the
// board is actually drawn in, and carrying that choice in the document.
//
// Three things can go wrong, and each has its own block:
//
//   1. AUTO — the default. It has to follow the board: a sine lands and the
//      x-axis becomes π, the last trig curve goes and it becomes decimal
//      again. A teacher never asked for either, so getting it wrong is the
//      board arguing with them.
//   2. AN OVERRIDE STICKS. The whole reason 'decimal' exists as a state
//      distinct from 'auto' is a trig board a teacher wants in plain numbers;
//      if a recommendation could overrule it, the setting would be a no-op
//      the moment the next sketch landed.
//   3. PERSISTENCE IS ADDITIVE. A board on automatic must serialise
//      byte-for-byte as it did before this field existed — that is the reason
//      there is no schema bump — and a stored value must survive a round trip
//      while a hostile one degrades silently to auto.
//
// Node only: no DOM, no real canvas. The render check goes through the same
// recording spy the other renderer tests use.
// ============================================================================

import { describe, expect, it } from 'vitest'
import {
  AUTO_AXIS_UNITS,
  boardToStored,
  createDoc,
  deserializeDoc,
  hydrateDoc,
  resolveAxisUnits,
  serializeDoc,
} from '../src/core/persist'
import type { AxisUnitChoices, BoardInput } from '../src/core/persist'
import { renderBoard, suggestAxisUnits } from '../src/ui/renderBoard'
import type { BoardScene } from '../src/ui/renderBoard'
import { DARK_THEME } from '../src/core/types'
import type { FitResult, FittedCurve, Viewport } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { MockCtx, withMockPath2D } from './mockCanvas'

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const SINE: FittedCurve = {
  id: 's1',
  modelId: 'sine',
  params: [1, 1, 0, 0],
  kind: 'explicit',
  domain: null,
  color: '#4f9cf9',
  strokeWidth: 2.5,
  visible: true,
  error: 0.01,
}

const PARABOLA: FittedCurve = { ...SINE, id: 'p1', modelId: 'poly2', params: [1, 0, 0] }

const TYPED: FittedCurve = { ...SINE, id: 'e1', modelId: 'expr_1', params: [] }

function board(over: Partial<BoardInput> = {}): BoardInput {
  return {
    curves: [],
    styles: {},
    candidates: new Map<string, FitResult[]>(),
    exprSources: {},
    viewport: { center: { x: 0, y: 0 }, pxPerUnit: 60 },
    selectedId: null,
    mode: 'draw',
    ...over,
  }
}

/**
 * The App's rule in one function: ask the renderer what it would like, then
 * let the document's choice settle it. Written out here rather than imported
 * because it is precisely the composition App.tsx performs on every curve
 * change, and it is what these tests are about.
 */
function unitsFor(
  choice: AxisUnitChoices,
  curves: readonly FittedCurve[],
  sources: Record<string, string> = {},
): { x: string; y: string } {
  return resolveAxisUnits(choice, suggestAxisUnits(curves, sources))
}

const auto = (): AxisUnitChoices => ({ ...AUTO_AXIS_UNITS })

// ---------------------------------------------------------------------------
// 1. auto follows the board
// ---------------------------------------------------------------------------

describe('auto — the axes follow what is on the board', () => {
  it('an empty board is decimal, which is the grid every board has always had', () => {
    expect(unitsFor(auto(), [])).toEqual({ x: 'decimal', y: 'decimal' })
  })

  it('a sine turns the x-axis into π, and deleting it turns it back', () => {
    expect(unitsFor(auto(), [SINE])).toEqual({ x: 'pi', y: 'decimal' })
    // the same board with the sine deleted — the thing that has to flip BACK
    expect(unitsFor(auto(), [])).toEqual({ x: 'decimal', y: 'decimal' })
    expect(unitsFor(auto(), [PARABOLA])).toEqual({ x: 'decimal', y: 'decimal' })
  })

  it('a typed y = sin(x) does it too, read through the sources map', () => {
    expect(unitsFor(auto(), [TYPED], { e1: 'sin(x)' })).toEqual({ x: 'pi', y: 'decimal' })
    expect(unitsFor(auto(), [TYPED], { e1: 'x^2 - 4' })).toEqual({ x: 'decimal', y: 'decimal' })
    // deleting the curve takes its source with it
    expect(unitsFor(auto(), [], { e1: 'sin(x)' })).toEqual({ x: 'decimal', y: 'decimal' })
  })

  it('a hidden trig curve is not on the board, so it does not move the axes', () => {
    expect(unitsFor(auto(), [{ ...SINE, visible: false }])).toEqual({
      x: 'decimal',
      y: 'decimal',
    })
  })

  it('never puts y in π on its own: nothing recommends it', () => {
    // suggestAxisUnits speaks about x only, so an automatic y is always the
    // decimal ladder however trigonometric the board is.
    expect(unitsFor(auto(), [SINE]).y).toBe('decimal')
  })
})

// ---------------------------------------------------------------------------
// 2. an explicit choice sticks
// ---------------------------------------------------------------------------

describe('an explicit choice overrules the recommendation', () => {
  it('decimal stays decimal on a board full of sines', () => {
    expect(unitsFor({ x: 'decimal', y: 'auto' }, [SINE])).toEqual({
      x: 'decimal',
      y: 'decimal',
    })
    expect(unitsFor({ x: 'decimal', y: 'auto' }, [TYPED], { e1: '3cos(2x)' }).x).toBe('decimal')
  })

  it('π stays π on a board with no trig on it at all', () => {
    expect(unitsFor({ x: 'pi', y: 'auto' }, [PARABOLA]).x).toBe('pi')
    expect(unitsFor({ x: 'pi', y: 'auto' }, []).x).toBe('pi')
  })

  it('the two axes are independent — y in π while x is automatic', () => {
    expect(unitsFor({ x: 'auto', y: 'pi' }, [PARABOLA])).toEqual({ x: 'decimal', y: 'pi' })
    expect(unitsFor({ x: 'auto', y: 'pi' }, [SINE])).toEqual({ x: 'pi', y: 'pi' })
  })

  it('handing an axis back to auto returns it to the board’s recommendation', () => {
    const board = [SINE]
    expect(unitsFor({ x: 'decimal', y: 'auto' }, board).x).toBe('decimal')
    expect(unitsFor({ x: 'auto', y: 'auto' }, board).x).toBe('pi')
  })

  it('is total: junk, a missing side and a missing object all mean decimal', () => {
    expect(resolveAxisUnits(null)).toEqual({ x: 'decimal', y: 'decimal' })
    expect(resolveAxisUnits(undefined, { x: 'pi' })).toEqual({ x: 'pi', y: 'decimal' })
    expect(resolveAxisUnits({ x: 'nonsense', y: 'auto' } as unknown as AxisUnitChoices)).toEqual({
      x: 'decimal',
      y: 'decimal',
    })
  })
})

// ---------------------------------------------------------------------------
// 3. the document carries it, additively
// ---------------------------------------------------------------------------

describe('persistence — additive, and byte-identical when automatic', () => {
  it('a board on automatic writes no axisUnits key at all', () => {
    const plain = boardToStored(board())
    const withAuto = boardToStored(board({ axisUnits: auto() }))
    expect('axisUnits' in withAuto).toBe(false)
    // the whole serialisation, byte for byte: this is why there is no schema bump
    expect(JSON.stringify(withAuto)).toBe(JSON.stringify(plain))
  })

  it('writes only the sides that were actually chosen', () => {
    expect(boardToStored(board({ axisUnits: { x: 'pi', y: 'auto' } })).axisUnits).toEqual({
      x: 'pi',
    })
    expect(boardToStored(board({ axisUnits: { x: 'auto', y: 'decimal' } })).axisUnits).toEqual({
      y: 'decimal',
    })
    expect(boardToStored(board({ axisUnits: { x: 'decimal', y: 'pi' } })).axisUnits).toEqual({
      x: 'decimal',
      y: 'pi',
    })
  })

  it('round-trips an explicit choice through a full document', () => {
    const doc = createDoc('Trig 1', boardToStored(board({ axisUnits: { x: 'pi', y: 'auto' } })))
    const res = deserializeDoc(serializeDoc(doc))
    expect(res.board!.axisUnits).toEqual({ x: 'pi', y: 'auto' })
    expect(res.degraded).toBe(false)
    expect(res.problems).toEqual([])
  })

  it('a document written before the field existed loads as auto, with no complaint', () => {
    const doc = createDoc('Lesson', boardToStored(board()))
    const res = deserializeDoc(serializeDoc(doc))
    expect(res.board!.axisUnits).toEqual({ x: 'auto', y: 'auto' })
    expect(res.problems).toEqual([])
    expect(res.degraded).toBe(false)
  })

  it('a hostile value degrades to auto rather than to a broken axis', () => {
    for (const junk of [42, 'PI', 'Pi ', null, ['pi'], { x: { x: 'pi' } }, 'auto']) {
      const doc = createDoc('x', boardToStored(board()))
      const raw = JSON.parse(serializeDoc(doc)) as Record<string, unknown>
      ;(raw.board as Record<string, unknown>).axisUnits = junk
      const res = deserializeDoc(JSON.stringify(raw))
      expect(res.board!.axisUnits, `axisUnits: ${JSON.stringify(junk)}`).toEqual({
        x: 'auto',
        y: 'auto',
      })
      // an unreadable units field is not damage: nothing is lost by defaulting
      expect(res.problems).toEqual([])
    }
  })

  it('a half-junk object keeps the side that is readable', () => {
    const doc = createDoc('x', boardToStored(board()))
    const raw = JSON.parse(serializeDoc(doc)) as Record<string, unknown>
    ;(raw.board as Record<string, unknown>).axisUnits = { x: 'pi', y: 7 }
    expect(hydrateDoc(raw).board!.axisUnits).toEqual({ x: 'pi', y: 'auto' })
  })

  it('survives the save → load → save cycle unchanged', () => {
    const first = boardToStored(board({ axisUnits: { x: 'decimal', y: 'pi' } }))
    const loaded = hydrateDoc(createDoc('x', first)).board!
    const again = boardToStored(board({ axisUnits: loaded.axisUnits }))
    expect(JSON.stringify(again)).toBe(JSON.stringify(first))
  })
})

// ---------------------------------------------------------------------------
// 4. the resolved units reach the grid
// ---------------------------------------------------------------------------

const vp: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 1200, heightPx: 800 }

function draw(scene: Partial<BoardScene>): MockCtx {
  const ctx = new MockCtx()
  withMockPath2D(() => {
    renderBoard(ctx as unknown as CanvasRenderingContext2D, {
      vp,
      theme: DARK_THEME,
      curves: [],
      styles: {},
      models: MODELS,
      ...scene,
    })
  })
  return ctx
}

/** x tick labels: the centre-aligned fillText calls, in draw order. */
const xLabels = (ctx: MockCtx): string[] =>
  ctx.texts.filter((t) => t.align === 'center').map((t) => t.text)

describe('what the App resolves is what the board draws', () => {
  it('a sine on an automatic board gets π/2, π, 3π/2 on the x-axis', () => {
    const units = unitsFor(auto(), [SINE])
    const labels = xLabels(draw({ curves: [SINE], axisUnits: units }))
    expect(labels).toContain('π')
    expect(labels).toContain('π/2')
    expect(labels).toContain('3π/2')
    expect(labels.some((t) => /^-?\d+$/.test(t) && t !== '0')).toBe(false)
  })

  it('and decimal labels the moment the sine is gone', () => {
    const units = unitsFor(auto(), [])
    const labels = xLabels(draw({ axisUnits: units }))
    expect(labels.some((t) => t.includes('π'))).toBe(false)
    expect(labels).toContain('2')
  })

  it('an explicit π on a board with no trig is honoured all the way to the ticks', () => {
    const units = unitsFor({ x: 'pi', y: 'auto' }, [PARABOLA])
    expect(xLabels(draw({ curves: [PARABOLA], axisUnits: units }))).toContain('π')
  })

  it('an explicit decimal on a trig board keeps plain numbers', () => {
    const units = unitsFor({ x: 'decimal', y: 'auto' }, [SINE])
    const labels = xLabels(draw({ curves: [SINE], axisUnits: units }))
    expect(labels.some((t) => t.includes('π'))).toBe(false)
  })
})

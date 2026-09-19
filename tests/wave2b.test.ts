// ============================================================================
// tests/wave2b.test.ts — the wave-2b fixes, checked in numbers.
//
// Every describe here corresponds to a measured complaint:
//
//   export framing   a number line came out as a 40px strip in a 2206x1826
//                    image — about 90% whitespace
//   presentation     nothing on the board rendered above 13.65px
//   document names   "Untitled / Untitled copy / Untitled copy copy"
//   number lines     a union's label bound to its first piece; "3 <= x"
//   persistence      a typed factored form was lost on reload
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { FittedCurve, ModelSpec, NLItem, Viewport } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import type { StyleMap } from '../src/core/persist'
import {
  boardToStored,
  countBoard,
  docFromBoard,
  hydrateDoc,
  serializeDoc,
} from '../src/core/persist'
import type { BoardInput, DocMeta } from '../src/core/persist'
import {
  aspectRatio,
  clampFitSettings,
  contentBounds,
  defaultFit,
  exportViewport,
  fitViewport,
  numberLineStripHeight,
  FIT_PAD,
} from '../src/ui/exportFit'
import type { FitExportSettings } from '../src/ui/exportFit'
import { exportGeometry } from '../src/ui/renderBoard'
import { copyDocName, describeCounts, nextDocName } from '../src/ui/docName'
import {
  answerClipboardText,
  answerInequalityText,
  answerNotationText,
  answerPieces,
  nlInequality,
  nlInequalityText,
  nlNotationText,
} from '../src/ui/nlText'
import { curveLegend, itemLegend, presentScale } from '../src/ui/present'
import { readCurveEquation } from '../src/ui/equationText'
import { ENDPOINT_TIP, resetTips, takeTip } from '../src/ui/coach'

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const VP: Viewport = {
  center: { x: 0, y: 0 },
  pxPerUnit: 60,
  widthPx: 1100,
  heightPx: 900,
}

const SETTINGS: FitExportSettings = {
  scale: 2,
  width: null,
  margin: 24,
  theme: 'light',
  fit: true,
  aspect: 'strip',
}

function interval(
  id: string,
  lo: number | null,
  hi: number | null,
  over: Partial<Extract<NLItem, { kind: 'interval' }>> = {},
): NLItem {
  return {
    kind: 'interval',
    id,
    lo,
    hi,
    loClosed: false,
    hiClosed: false,
    color: '#4f9cf9',
    ...over,
  }
}

function curve(over: Partial<FittedCurve> & Pick<FittedCurve, 'id' | 'modelId'>): FittedCurve {
  return {
    params: [1, 0, 0],
    kind: 'explicit',
    domain: [-3, 3],
    color: '#4f9cf9',
    strokeWidth: 2.5,
    visible: true,
    error: 0.01,
    ...over,
  } as FittedCurve
}

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

const META: DocMeta = { id: 'd1', name: 'Graph 1', createdAt: 1, modifiedAt: 1 }

/** A cubic a teacher wrote in factored form, and the params it reads back to. */
const FACTORED = 'y = 0.25(x+2)(x-1)(x-3)'
const FACTORED_PARAMS = (() => {
  const read = readCurveEquation(FACTORED, curve({ id: 'c', modelId: 'poly3', params: [0, 0, 0, 1] }), MODELS.poly3)
  if (!read.ok || read.mode !== 'family') throw new Error('the factored cubic is not a cubic')
  return read.params
})()

// ===========================================================================
// 2. export: crop to content
// ===========================================================================

describe('export framing: a number line fills its frame', () => {
  const items: NLItem[] = [
    interval('a', null, -2),
    interval('b', 3, null, { loClosed: true }),
    { kind: 'point', id: 'c', x: 7, closed: true, color: '#f95f62' },
  ]

  const box = contentBounds({
    kind: 'number-line',
    curves: [],
    items,
    models: MODELS,
    window: [-8, 8],
  })

  it('measures the items, not the window', () => {
    expect(box).not.toBeNull()
    expect(box!.min.x).toBe(-2)
    expect(box!.max.x).toBe(7)
  })

  it('the LINE spans most of the width, not 40px in the middle', () => {
    const fitted = fitViewport(VP, box!, 'number-line', 'strip', 1)
    const span = (box!.max.x - box!.min.x) * fitted.pxPerUnit
    const fraction = span / fitted.widthPx
    // The old export put a 9-unit answer inside a window showing ~18 units on
    // a canvas nearly twice as tall as the figure needed.
    expect(fraction).toBeGreaterThan(0.7)
    expect(fraction).toBeCloseTo(1 - 2 * FIT_PAD, 5)
  })

  it('and the frame stops being 90% whitespace', () => {
    const fitted = fitViewport(VP, box!, 'number-line', 'strip', 1)
    const geo = exportGeometry(fitted, SETTINGS)
    const unfitted = exportGeometry(VP, SETTINGS)
    expect(geo.h).toBeLessThan(unfitted.h / 3)
    // the width a teacher stated is untouched — only the frame's shape moved
    expect(geo.w).toBe(unfitted.w)
  })

  it('the strip is as tall as the stack, not as tall as the paper is wide', () => {
    // one lane is the floor; each extra lane buys exactly two lane heights,
    // because the renderer centres the axis and stacks upward from it
    expect(numberLineStripHeight(1, 1100)).toBe(96)
    expect(numberLineStripHeight(2, 1100)).toBe(140)
    expect(numberLineStripHeight(3, 1100)).toBe(184)
    // and it can never grow taller than a third of the width
    expect(numberLineStripHeight(40, 1100)).toBe(Math.round(1100 / 3))
  })

  it('the lane count comes from the items, through exportViewport', () => {
    // the point at 7 sits inside the ray [3, inf), so this answer needs two
    const crowded = exportViewport(VP, SETTINGS, box!, 'number-line', items)
    expect(crowded.heightPx).toBe(140)
    // two rays that do not overlap share one lane
    const rays: NLItem[] = [interval('p', null, -2), interval('q', 3, null)]
    const raysBox = contentBounds({
      kind: 'number-line',
      curves: [],
      items: rays,
      models: MODELS,
      window: [-8, 8],
    })
    expect(exportViewport(VP, SETTINGS, raysBox, 'number-line', rays).heightPx).toBe(96)
    // two intervals covering the same span cannot
    const stacked: NLItem[] = [interval('x', -2, 7), interval('y', -2, 7)]
    const stackedBox = contentBounds({
      kind: 'number-line',
      curves: [],
      items: stacked,
      models: MODELS,
      window: [-8, 8],
    })
    const vp = exportViewport(VP, SETTINGS, stackedBox, 'number-line', stacked)
    expect(vp.heightPx).toBe(140)
  })

  it('keeps the line centred in x and pinned at y = 0', () => {
    const fitted = fitViewport(VP, box!, 'number-line', 'strip', 1)
    expect(fitted.center.x).toBeCloseTo(2.5, 10)
    expect(fitted.center.y).toBe(0)
  })
})

describe('export framing: aspect presets letterbox the fitted content', () => {
  const box = { min: { x: -2, y: -1 }, max: { x: 2, y: 1 } }

  it('every preset keeps the stated width and changes only the height', () => {
    const shapes = (['auto', 'square', '4:3', 'wide', 'strip'] as const).map((a) => {
      const vp = fitViewport(VP, box, 'cartesian', a)
      return { a, w: vp.widthPx, h: vp.heightPx }
    })
    for (const s of shapes) expect(s.w).toBe(1100)
    const byKey = Object.fromEntries(shapes.map((s) => [s.a, s.h]))
    expect(byKey.square).toBe(1100)
    expect(byKey['4:3']).toBe(825)
    expect(byKey.wide).toBe(619)
    expect(byKey.strip).toBe(220) // a GRAPH strip is a plain 5:1 ratio
    expect(byKey.auto).toBe(900) // the shape the board has on screen
  })

  it('a cartesian fit is limited by whichever axis runs out first', () => {
    // a wide, flat figure in a square frame is scaled by its width
    const flat = { min: { x: -10, y: -0.2 }, max: { x: 10, y: 0.2 } }
    const vp = fitViewport(VP, flat, 'cartesian', 'square')
    expect((flat.max.x - flat.min.x) * vp.pxPerUnit).toBeCloseTo(
      vp.widthPx * (1 - 2 * FIT_PAD),
      5,
    )
  })

  it('aspectRatio("auto") answers with the board on screen', () => {
    expect(aspectRatio('auto', VP)).toBeCloseTo(1100 / 900, 10)
  })

  it('fitting off, or nothing to fit, leaves the live viewport alone', () => {
    const off = exportViewport(VP, { ...SETTINGS, fit: false }, null, 'cartesian')
    expect(off).toEqual({ center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 1100, heightPx: 900 })
    const nothing = exportViewport(VP, SETTINGS, null, 'number-line')
    expect(nothing.heightPx).toBe(900)
  })

  it('a graph frames its curves rather than the window', () => {
    const c = curve({ id: 'c1', modelId: 'line', params: [1, 0], domain: [4, 6] })
    const box2 = contentBounds({
      kind: 'cartesian',
      curves: [c],
      items: [],
      models: MODELS,
      window: [-8, 8],
    })
    expect(box2).not.toBeNull()
    const vp = exportViewport(VP, { ...SETTINGS, aspect: 'auto' }, box2, 'cartesian')
    expect(vp.center.x).toBeCloseTo(5, 6)
  })
})

describe('export framing: the defaults follow the kind of board', () => {
  it('on for a number line, off for a graph', () => {
    expect(defaultFit('number-line')).toEqual({ fit: true, aspect: 'strip' })
    expect(defaultFit('cartesian')).toEqual({ fit: false, aspect: 'auto' })
  })

  it('clamping keeps the two new fields instead of dropping them', () => {
    const clean = clampFitSettings({ ...SETTINGS, scale: 99, aspect: 'nope' as never })
    expect(clean.fit).toBe(true)
    expect(clean.aspect).toBe('auto')
    expect(clean.scale).toBe(8)
  })
})

// ===========================================================================
// 1. presentation mode
// ===========================================================================

describe('presentation: the scale ladder', () => {
  it('type grows faster than line weight — 2.5x type, 1.6x strokes', () => {
    expect(presentScale(2.5)).toEqual({ type: 2.5, stroke: 1.6 })
  })

  it('1x is the identity, so a board not being presented is unchanged', () => {
    expect(presentScale(1)).toEqual({ type: 1, stroke: 1 })
  })

  it('an 11px axis label clears 25px at the default', () => {
    expect(11 * presentScale(2.5).type).toBeGreaterThan(25)
  })

  it('absurd values are clamped rather than obeyed', () => {
    expect(presentScale(500).type).toBe(6)
    expect(presentScale(Number.NaN).type).toBe(1)
  })
})

describe('presentation: the legend says what the sidebar used to', () => {
  const spec = MODELS.poly2 as ModelSpec

  it('one chip per VISIBLE curve, in the curve"s own colour', () => {
    const entries = curveLegend(
      [
        curve({ id: 'a', modelId: 'poly2', params: [1, 0, 0], color: '#4f9cf9' }),
        curve({ id: 'b', modelId: 'poly2', params: [2, 0, 0], color: '#f95f62', visible: false }),
      ],
      MODELS,
      {},
    )
    expect(entries.map((e) => e.id)).toEqual(['a'])
    expect(entries[0].color).toBe('#4f9cf9')
    expect(entries[0].tex).toBe(spec.latex([1, 0, 0]))
  })

  it('a typed factored form is projected factored, not expanded', () => {
    const c = curve({ id: 'a', modelId: 'poly3', params: FACTORED_PARAMS })
    const entries = curveLegend([c], MODELS, { a: FACTORED })
    expect(entries[0].tex).toContain('x+2')
    expect(entries[0].tex).not.toBe((MODELS.poly3 as ModelSpec).latex(c.params))
  })

  it('and reverts to the generated form once the params stop meaning it', () => {
    const moved = curve({ id: 'a', modelId: 'poly3', params: FACTORED_PARAMS.map((v) => v + 1) })
    const entries = curveLegend([moved], MODELS, { a: FACTORED })
    expect(entries[0].tex).toBe((MODELS.poly3 as ModelSpec).latex(moved.params))
  })

  it('a number line legends its sets and their inequalities', () => {
    const entries = itemLegend([interval('a', null, -2)])
    expect(entries[0].tex).toContain('\\infty')
    expect(entries[0].tex).toContain('x <')
  })

  it('an un-latexable family still gets a chip rather than throwing', () => {
    const broken: Record<string, ModelSpec> = {
      bad: {
        ...(MODELS.line as ModelSpec),
        latex() {
          throw new Error('nope')
        },
      },
    }
    const entries = curveLegend([curve({ id: 'a', modelId: 'bad' })], broken, {})
    expect(entries).toHaveLength(1)
    expect(entries[0].tex).toBe('bad')
  })
})

// ===========================================================================
// 3. document naming and the list
// ===========================================================================

describe('document names: a board is named for what it is', () => {
  it('numbers from one, per kind', () => {
    expect(nextDocName('cartesian', [])).toBe('Graph 1')
    expect(nextDocName('number-line', [])).toBe('Number line 1')
  })

  it('takes the next FREE number, so deleting Graph 2 gives Graph 2 back', () => {
    expect(nextDocName('cartesian', ['Graph 1', 'Graph 3'])).toBe('Graph 2')
  })

  it('counts the two kinds separately', () => {
    const names = ['Graph 1', 'Graph 2', 'Number line 1']
    expect(nextDocName('cartesian', names)).toBe('Graph 3')
    expect(nextDocName('number-line', names)).toBe('Number line 2')
  })

  it('a name that merely starts with the base is not in the sequence', () => {
    expect(nextDocName('cartesian', ['Graph of f', 'Graphs'])).toBe('Graph 1')
  })

  it('a copy of a numbered board is the next number, not "copy copy"', () => {
    expect(copyDocName('cartesian', 'Graph 2', ['Graph 1', 'Graph 2'])).toBe('Graph 3')
  })

  it('a copy of a named board gains one "copy", then counts', () => {
    expect(copyDocName('cartesian', 'Tangents', ['Tangents'])).toBe('Tangents copy')
    expect(copyDocName('cartesian', 'Tangents', ['Tangents', 'Tangents copy'])).toBe(
      'Tangents copy 2',
    )
  })

  it('copying a copy does not grow the word "copy"', () => {
    expect(copyDocName('cartesian', 'Tangents copy', ['Tangents', 'Tangents copy'])).toBe(
      'Tangents copy 2',
    )
  })
})

describe('document list: what is actually on a board', () => {
  it('says curves for a graph and the item kind for a line', () => {
    expect(describeCounts('cartesian', { curves: 4, points: 0, intervals: 0 })).toBe('4 curves')
    expect(describeCounts('cartesian', { curves: 1, points: 0, intervals: 0 })).toBe('1 curve')
    expect(describeCounts('number-line', { curves: 0, points: 0, intervals: 2 })).toBe(
      '2 intervals',
    )
    expect(describeCounts('number-line', { curves: 0, points: 3, intervals: 0 })).toBe('3 points')
    expect(describeCounts('number-line', { curves: 0, points: 1, intervals: 1 })).toBe('2 items')
    expect(describeCounts('cartesian', { curves: 0, points: 0, intervals: 0 })).toBe('empty')
  })

  it('counting a stored board never touches its stroke data', () => {
    const stored = boardToStored(
      boardInput({
        kind: 'number-line',
        items: [interval('a', 0, 1), { kind: 'point', id: 'p', x: 3, closed: true, color: '#fff' }],
      }),
    )
    expect(countBoard(stored)).toEqual({ curves: 0, points: 1, intervals: 1 })
  })
})

// ===========================================================================
// 4. number lines
// ===========================================================================

describe('number line: a restatement keeps x on the left', () => {
  it('"3 <= x" is written "x >= 3"', () => {
    expect(nlInequality(interval('a', 3, null, { loClosed: true }))).toBe('x \\ge 3')
    expect(nlInequalityText(interval('a', 3, null, { loClosed: true }))).toBe('x ≥ 3')
  })

  it('a strict lower bound too', () => {
    expect(nlInequalityText(interval('a', -2, null))).toBe('x > −2')
  })

  it('an upper bound was already on the left and stays there', () => {
    expect(nlInequalityText(interval('a', null, -2))).toBe('x < −2')
  })

  it('a two-sided interval keeps the canonical compound form', () => {
    expect(nlInequalityText(interval('a', -2, 5, { loClosed: true }))).toBe('−2 ≤ x < 5')
  })

  it('a point states equality, an excluded one states inequality', () => {
    const p: NLItem = { kind: 'point', id: 'p', x: 4, closed: true, color: '#fff' }
    expect(nlInequalityText(p)).toBe('x = 4')
    expect(nlInequalityText({ ...p, closed: false })).toBe('x ≠ 4')
  })
})

describe('number line: the answer, as text for an answer key', () => {
  const items: NLItem[] = [interval('a', null, -2), interval('b', 3, null, { loClosed: true })]
  const styles: StyleMap = { a: { group: 'g1' }, b: { group: 'g1' } }

  it('a union copies as a union, from either of its pieces', () => {
    for (const id of ['a', 'b']) {
      const pieces = answerPieces(items, styles, id)
      expect(answerNotationText(pieces)).toBe('(−∞, −2) ∪ [3, ∞)')
      expect(answerInequalityText(pieces)).toBe('x < −2 or x ≥ 3')
    }
  })

  it('both notations go on the clipboard, one per line', () => {
    const text = answerClipboardText(answerPieces(items, styles, 'a'))
    expect(text.split('\n')).toEqual(['(−∞, −2) ∪ [3, ∞)', 'x < −2 or x ≥ 3'])
  })

  it('an ungrouped item is an answer of one', () => {
    const pieces = answerPieces(items, {}, 'a')
    expect(pieces.map((p) => p.id)).toEqual(['a'])
    expect(answerNotationText(pieces)).toBe('(−∞, −2)')
  })

  it('brackets follow closed/open, and minus is a minus sign', () => {
    expect(nlNotationText(interval('a', -2, 5, { loClosed: true, hiClosed: true }))).toBe(
      '[−2, 5]',
    )
  })
})

describe('number line: the endpoint tip is shown once, across both surfaces', () => {
  it('the card and the canvas share one budget', () => {
    resetTips()
    expect(takeTip(ENDPOINT_TIP)).toBe(true)
    expect(takeTip(ENDPOINT_TIP)).toBe(false)
    expect(takeTip(ENDPOINT_TIP)).toBe(false)
  })
})

// ===========================================================================
// 6. the typed display form survives a reload
// ===========================================================================

describe('persistence: a typed factored form comes back factored', () => {
  const c = curve({ id: 'c1', modelId: 'poly3', params: FACTORED_PARAMS })

  it('round-trips through save and load', () => {
    const doc = docFromBoard(META, boardInput({ curves: [c], displaySources: { c1: FACTORED } }))
    const res = hydrateDoc(JSON.parse(serializeDoc(doc)))
    expect(res.board!.displaySources).toEqual({ c1: FACTORED })
  })

  it('does NOT become an expression on the way back', () => {
    const doc = docFromBoard(META, boardInput({ curves: [c], displaySources: { c1: FACTORED } }))
    const res = hydrateDoc(JSON.parse(serializeDoc(doc)))
    // the family is intact: no rebuilt expr_N model, no exprSource entry
    expect(res.board!.curves[0].modelId).toBe('poly3')
    expect(res.board!.exprSources).toEqual({})
    expect(res.board!.extraModels).toEqual({})
    expect(res.board!.brokenExpr).toEqual({})
  })

  it('an absent source writes no field, so old documents are byte-identical', () => {
    const without = serializeDoc(docFromBoard(META, boardInput({ curves: [c] }), 5))
    const blank = serializeDoc(
      docFromBoard(META, boardInput({ curves: [c], displaySources: {} }), 5),
    )
    expect(without).toBe(blank)
    expect(without).not.toContain('displaySource')
  })

  it('an empty-string source is not a source', () => {
    const doc = docFromBoard(META, boardInput({ curves: [c], displaySources: { c1: '   ' } }))
    expect(serializeDoc(doc)).not.toContain('displaySource')
  })

  it('a hostile displaySource is ignored rather than trusted', () => {
    const res = hydrateDoc({
      version: 2,
      id: 'x',
      name: 'x',
      createdAt: 1,
      modifiedAt: 1,
      board: {
        curves: [
          {
            id: 'c1',
            modelId: 'poly3',
            params: [1, 0, 0, 0],
            kind: 'explicit',
            domain: null,
            color: '#fff',
            strokeWidth: 2,
            visible: true,
            error: 0,
            displaySource: 42,
          },
        ],
        viewport: { cx: 0, cy: 0, ppu: 60 },
        selectedId: null,
        mode: 'draw',
      },
    })
    expect(res.board!.displaySources).toEqual({})
    expect(res.board!.curves).toHaveLength(1)
  })
})

describe('persistence: an answer keeps its pieces together', () => {
  it('the group stamp round-trips on a number-line item', () => {
    const input = boardInput({
      kind: 'number-line',
      items: [interval('a', null, -2), interval('b', 3, null)],
      styles: { a: { group: 'g1' }, b: { group: 'g1' } },
    })
    const res = hydrateDoc(JSON.parse(serializeDoc(docFromBoard(META, input))))
    expect(res.board!.styles.a.group).toBe('g1')
    expect(res.board!.styles.b.group).toBe('g1')
    expect(answerPieces(res.board!.items, res.board!.styles, 'b').map((i) => i.id)).toEqual([
      'a',
      'b',
    ])
  })

  it('an item with no group writes no style block at all', () => {
    const input = boardInput({
      kind: 'number-line',
      items: [interval('a', null, -2)],
    })
    expect(serializeDoc(docFromBoard(META, input))).not.toContain('"style"')
  })
})

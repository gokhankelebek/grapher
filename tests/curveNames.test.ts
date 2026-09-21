// ============================================================================
// tests/curveNames.test.ts — WHICH CURVE IS f.
//
// A board with one curve could say "Graph of f" and be right by luck. With
// three it was saying something false: the caption named a function nothing on
// the figure pointed at, and a printed AP figure gave a student no way to tell
// which stroke was f. Three claims hold the fix:
//
//  1. the NAMES are a rule, not a guess — a typed `g(x) = …` keeps its letter,
//     everything else takes the next free one in sidebar order, a derivative
//     keeps its parent's letter and a prime, and a tangent line is not named;
//  2. the CAPTION follows the board until the teacher writes their own, and an
//     auto caption is stored NOWHERE — a document that never had one comes out
//     byte-for-byte as it always did;
//  3. the names are on the FIGURE under a marked style, off the curve, off the
//     axis and off each other — and nowhere at all under the screen look,
//     where the sidebar cards say it in colour.
// ============================================================================

import { describe, it, expect } from 'vitest'
import { curveNames, namesInOrder, primed, typedName } from '../src/render/curveNames'
import { defaultCaption, DEFAULT_CAPTION } from '../src/ui/figureStyle'
import { renderBoard, type BoardScene } from '../src/ui/renderBoard'
import {
  boardToStored,
  deserializeDoc,
  docFromBoard,
  serializeDoc,
  type BoardInput,
  type CalcLink,
  type DocMeta,
} from '../src/core/persist'
import { MockCtx, withMockPath2D } from './mockCanvas'
import { MODELS } from '../src/core/fit/models'
import { CURVE_COLORS, FIGURE_STYLES, DARK_THEME } from '../src/core/types'
import type { FittedCurve, Viewport } from '../src/core/types'

const VP: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 900, heightPx: 600 }

function curve(over: Partial<FittedCurve> = {}): FittedCurve {
  return {
    id: 'c1',
    modelId: 'poly2',
    params: [-1, 0, 0.5],
    kind: 'explicit',
    domain: null,
    color: CURVE_COLORS[0],
    strokeWidth: 2.5,
    visible: true,
    error: 0.01,
    ...over,
  }
}

// ---------------------------------------------------------------------------
// the names
// ---------------------------------------------------------------------------

describe('curveNames — what each curve is called', () => {
  it('hands out f, g, h … in sidebar order', () => {
    const cs = [curve({ id: 'a' }), curve({ id: 'b' }), curve({ id: 'c' })]
    expect(curveNames(cs)).toEqual({ a: 'f', b: 'g', c: 'h' })
    expect(namesInOrder(cs, curveNames(cs))).toEqual(['f', 'g', 'h'])
  })

  it('a typed name is the teacher’s, and nothing else may take that letter', () => {
    const cs = [curve({ id: 'a' }), curve({ id: 'b' })]
    // 'b' calls itself f, so 'a' — first in the sidebar — has to move on to g.
    expect(curveNames(cs, { b: 'f(x) = sin(x)' })).toEqual({ a: 'g', b: 'f' })
  })

  it('reads the head the teacher typed, in x, t or θ', () => {
    expect(typedName('g(x) = x^2')).toBe('g')
    expect(typedName('  h(t)=2t+1')).toBe('h')
    expect(typedName('p(θ) = 1 + cos(θ)')).toBe('p')
    // Not a definition, and not a letter that may name one.
    expect(typedName('y = x^2')).toBe(null)
    expect(typedName('x(t) = 3')).toBe(null)
    expect(typedName('sin(x) = 0')).toBe(null)
    expect(typedName(undefined)).toBe(null)
  })

  it('a derivative keeps its parent: f′, then f″', () => {
    const cs = [curve({ id: 'a' }), curve({ id: 'd1' }), curve({ id: 'd2' })]
    const links: CalcLink[] = [
      { kind: 'derivative', id: 'l1', parentId: 'a', curveId: 'd1' },
      { kind: 'derivative', id: 'l2', parentId: 'd1', curveId: 'd2' },
    ]
    expect(curveNames(cs, {}, links)).toEqual({ a: 'f', d1: 'f′', d2: 'f″' })
    // And it does NOT eat a letter: the next plain curve is still g.
    const more = [...cs, curve({ id: 'z' })]
    expect(curveNames(more, {}, links).z).toBe('g')
  })

  it('primes past the fourth become f⁽⁵⁾ rather than a row of ticks', () => {
    expect(primed('f', 0)).toBe('f')
    expect(primed('f', 4)).toBe('f⁗')
    expect(primed('f', 5)).toBe('f⁽⁵⁾')
  })

  it('a tangent line is not named — it is a measurement of a curve', () => {
    const cs = [curve({ id: 'a' }), curve({ id: 'tan', modelId: 'line', params: [0, 1] })]
    const links: CalcLink[] = [
      { kind: 'tangent', id: 'l1', parentId: 'a', curveId: 'tan', x: 1 },
    ]
    const names = curveNames(cs, {}, links)
    expect(names).toEqual({ a: 'f' })
    expect(names.tan).toBeUndefined()
  })

  it('a hidden curve is skipped, and does not hold a letter back', () => {
    const cs = [curve({ id: 'a', visible: false }), curve({ id: 'b' })]
    expect(curveNames(cs)).toEqual({ b: 'f' })
  })

  it('an implicit curve is not a graph of a function, so it gets no letter', () => {
    const cs = [curve({ id: 'circ', modelId: 'circle', kind: 'implicit' }), curve({ id: 'b' })]
    expect(curveNames(cs)).toEqual({ b: 'f' })
  })

  it('polar and parametric curves are named like any other', () => {
    const cs = [curve({ id: 'a', kind: 'polar' }), curve({ id: 'b', kind: 'parametric' })]
    expect(curveNames(cs)).toEqual({ a: 'f', b: 'g' })
  })

  it('a derivative of a hidden parent still gets a letter of its own', () => {
    const cs = [curve({ id: 'a', visible: false }), curve({ id: 'd1' })]
    const links: CalcLink[] = [{ kind: 'derivative', id: 'l1', parentId: 'a', curveId: 'd1' }]
    expect(curveNames(cs, {}, links)).toEqual({ d1: 'f' })
  })

  it('runs out of letters quietly rather than inventing one', () => {
    const cs = Array.from({ length: 10 }, (_, i) => curve({ id: `c${i}` }))
    const names = curveNames(cs)
    expect(Object.keys(names)).toHaveLength(8)
    expect(namesInOrder(cs, names)).toEqual(['f', 'g', 'h', 'k', 'p', 'q', 'r', 's'])
  })

  it('the board the teacher will actually build: y = …, g(x) = …, and f′', () => {
    const cs = [curve({ id: 'a' }), curve({ id: 'b' }), curve({ id: 'd' })]
    const links: CalcLink[] = [{ kind: 'derivative', id: 'l1', parentId: 'a', curveId: 'd' }]
    const names = curveNames(cs, { b: 'g(x) = sin(x)' }, links)
    expect(namesInOrder(cs, names)).toEqual(['f', 'g', 'f′'])
  })
})

// ---------------------------------------------------------------------------
// the caption
// ---------------------------------------------------------------------------

describe('defaultCaption — the sentence the board writes about itself', () => {
  it('counts the curves, with the Oxford comma', () => {
    expect(defaultCaption('ap', [])).toBe('')
    expect(defaultCaption('ap', ['f'])).toBe('Graph of f')
    expect(defaultCaption('ap', ['f', 'g'])).toBe('Graphs of f and g')
    expect(defaultCaption('ap', ['f', 'g', 'h'])).toBe('Graphs of f, g, and h')
    expect(defaultCaption('ap', ['f', 'g', 'h', 'k'])).toBe('Graphs of f, g, h, and k')
  })

  it('names the curves it was given, primes included', () => {
    expect(defaultCaption('ap', ['f', 'g', 'f′'])).toBe('Graphs of f, g, and f′')
  })

  it('only the AP figure proposes words', () => {
    for (const style of ['screen', 'textbook', 'sat'] as const) {
      expect(defaultCaption(style, ['f', 'g'])).toBe('')
    }
  })

  it('agrees with the one-curve constant it replaces', () => {
    expect(defaultCaption('ap', ['f'])).toBe(DEFAULT_CAPTION.ap)
  })
})

// ---------------------------------------------------------------------------
// auto vs the teacher's own words, through a save and a load
// ---------------------------------------------------------------------------

const META: DocMeta = { id: 'doc1', name: 'Figure', createdAt: 1000, modifiedAt: 1000 }

function board(over: Partial<BoardInput> = {}): BoardInput {
  return {
    curves: [curve()],
    styles: {},
    candidates: new Map(),
    exprSources: {},
    viewport: { center: { x: 0, y: 0 }, pxPerUnit: 60 },
    selectedId: null,
    mode: 'draw',
    ...over,
  }
}

describe('an auto caption is stored nowhere at all', () => {
  it('writes the same bytes it wrote before captions followed the board', () => {
    const before = serializeDoc(docFromBoard(META, board({ figure: 'ap' }), 2000))
    const auto = serializeDoc(
      docFromBoard(META, board({ figure: 'ap', caption: 'Graph of f', captionAuto: true }), 2000),
    )
    expect(auto).toBe(before)
    expect(auto).not.toContain('"caption"')
  })

  it('a document that says nothing about its caption loads as auto', () => {
    const back = deserializeDoc(serializeDoc(docFromBoard(META, board({ figure: 'ap' }), 2000)))
    expect(back.board?.captionAuto).toBe(true)
    expect(back.board?.caption).toBe('')
    expect(back.degraded).toBe(false)
  })

  it('the teacher’s own words are stored, and come back as theirs', () => {
    const input = board({ figure: 'ap', caption: 'Figure 3', captionAuto: false })
    expect(boardToStored(input).caption).toBe('Figure 3')
    const back = deserializeDoc(serializeDoc(docFromBoard(META, input, 2000)))
    expect(back.board?.caption).toBe('Figure 3')
    expect(back.board?.captionAuto).toBe(false)
  })

  it('a caption deliberately CLEARED stays cleared across a reload', () => {
    // The one thing silence cannot say. An empty string written out loud is
    // what tells the loader these words — none — are the teacher's.
    const input = board({ figure: 'ap', caption: '', captionAuto: false })
    expect(boardToStored(input).caption).toBe('')
    const back = deserializeDoc(serializeDoc(docFromBoard(META, input, 2000)))
    expect(back.board?.caption).toBe('')
    expect(back.board?.captionAuto).toBe(false)
  })

  it('a caller that never mentions captionAuto writes exactly what it used to', () => {
    const plain = serializeDoc(docFromBoard(META, board({ figure: 'ap' }), 2000))
    expect(plain).not.toContain('"caption"')
    const written = serializeDoc(
      docFromBoard(META, board({ figure: 'ap', caption: 'Graph of f' }), 2000),
    )
    expect(written).toContain('"caption":"Graph of f"')
  })
})

// ---------------------------------------------------------------------------
// the names on the figure
// ---------------------------------------------------------------------------

/** y = 0.5x² − 1: above the axis at the right of the board. */
const PARABOLA = curve({ id: 'a' })
/** y = x: crosses the parabola, so their labels compete for the same corner. */
const LINE = curve({ id: 'b', modelId: 'line', params: [0, 1], color: CURVE_COLORS[1] })

function scene(over: Partial<BoardScene> = {}): BoardScene {
  return {
    vp: VP,
    theme: DARK_THEME,
    curves: [PARABOLA, LINE],
    styles: {},
    models: MODELS,
    chrome: null,
    ...over,
  }
}

function render(s: BoardScene): MockCtx {
  const ctx = new MockCtx()
  withMockPath2D(() => renderBoard(ctx as unknown as CanvasRenderingContext2D, s))
  return ctx
}

const NAMES = { a: 'f', b: 'g' }

describe('the names on the figure', () => {
  it('draws each curve’s name under a marked style', () => {
    const ctx = render(scene({ figure: FIGURE_STYLES.sat, curveNames: NAMES }))
    expect(ctx.texts.some((t) => t.text === 'f')).toBe(true)
    expect(ctx.texts.some((t) => t.text === 'g')).toBe(true)
  })

  it('draws nothing under the screen look — the cards say it there', () => {
    const ctx = render(scene({ curveNames: NAMES }))
    expect(ctx.texts.some((t) => t.text === 'f' || t.text === 'g')).toBe(false)
  })

  it('a scene that never mentions names draws none', () => {
    const ctx = render(scene({ figure: FIGURE_STYLES.sat }))
    expect(ctx.texts.some((t) => t.text === 'f' || t.text === 'g')).toBe(false)
  })

  it('one named curve needs no label: the caption already says which it is', () => {
    const ctx = render(scene({ figure: FIGURE_STYLES.sat, curveNames: { a: 'f' } }))
    expect(ctx.texts.some((t) => t.text === 'f')).toBe(false)
  })

  it('a hidden curve takes its label with it', () => {
    const ctx = render(
      scene({
        figure: FIGURE_STYLES.sat,
        curves: [PARABOLA, { ...LINE, visible: false }],
        curveNames: NAMES,
      }),
    )
    expect(ctx.texts.some((t) => t.text === 'g')).toBe(false)
  })

  it('is italic, and serif under the AP look', () => {
    const ap = render(scene({ figure: FIGURE_STYLES.ap, curveNames: NAMES }))
    const f = ap.texts.find((t) => t.text === 'f')
    expect(f).toBeDefined()
    expect(f?.font).toContain('italic')
    expect(f?.font).toContain('Times')
  })

  it('reaches the export: it is figure, not chrome', () => {
    // chrome is already null in every scene here — this states the claim the
    // analysis layer had to be taught, so a later refactor cannot lose it.
    const ctx = render(scene({ figure: FIGURE_STYLES.ap, curveNames: NAMES, chrome: null }))
    expect(ctx.texts.filter((t) => t.text === 'f' || t.text === 'g')).toHaveLength(2)
  })

  it('puts the label on the side of the curve away from the x axis', () => {
    // The parabola is well above the axis at the right of this board, so its
    // letter goes ABOVE it (smaller screen y) rather than down among the ticks.
    const ctx = render(scene({ figure: FIGURE_STYLES.sat, curveNames: NAMES }))
    const f = ctx.texts.find((t) => t.text === 'f')
    const axisY = VP.heightPx / 2
    expect(f).toBeDefined()
    expect(f!.y).toBeLessThan(axisY)
  })

  it('two curves that cross do not label each other’s corner', () => {
    const ctx = render(scene({ figure: FIGURE_STYLES.sat, curveNames: NAMES }))
    const f = ctx.texts.find((t) => t.text === 'f')
    const g = ctx.texts.find((t) => t.text === 'g')
    expect(f).toBeDefined()
    expect(g).toBeDefined()
    // The boxes are centred on the reported point; 6px per character is what
    // the mock measures, and the labels are one character wide.
    const apart = Math.hypot(f!.x - g!.x, f!.y - g!.y)
    expect(apart).toBeGreaterThan(12)
  })

  it('a label that cannot be placed is dropped, not stacked', () => {
    // A board so short that there is no room off the curve on either side.
    const flat: Viewport = { ...VP, heightPx: 8 }
    const ctx = render(scene({ vp: flat, figure: FIGURE_STYLES.sat, curveNames: NAMES }))
    expect(ctx.texts.filter((t) => t.text === 'f' || t.text === 'g')).toHaveLength(0)
  })
})

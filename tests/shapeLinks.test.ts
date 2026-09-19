// ============================================================================
// tests/shapeLinks.test.ts — shapes as the BOARD holds them, the ruling the
// board is drawn on, and where a point put down with a finger lands.
//
// The grammar is already tested in tests/shapes.test.ts and the drawing in
// tests/shapes.render.test.ts. What is tested HERE is the wiring between them
// and the document: that a shape typed into the shared equation box is
// recognised as one AND that a curve typed into it is not mistaken for a
// broken shape; that a dragged vertex really does rewrite the line that put it
// there; that a shape says the same thing after a save and a load; and that a
// document without one is byte-for-byte the document it was before shapes
// existed.
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { FittedCurve, Viewport } from '../src/core/types'
import {
  boardToStored,
  deserializeDoc,
  docFromBoard,
  serializeDoc,
  shapeToStored,
  storedGrid,
  storedToShape,
} from '../src/core/persist'
import type { BoardInput, BoardShape, DocMeta } from '../src/core/persist'
import {
  canFill,
  compileShapes,
  isExprCoord,
  looksLikeShape,
  moveVertex,
  numText,
  readShape,
  replaceCoord,
  sceneShapes,
  scanPairs,
  shapeCard,
  shapeChipTex,
  shapeLegend,
  shapeNoun,
  shapeVertices,
} from '../src/ui/shapeLinks'
import { snapCoord, snapPlaced, snapStep } from '../src/ui/snap'
import { isPolarCurve, suggestPolarRuling, RULINGS } from '../src/ui/boardGrid'

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const META: DocMeta = { id: 'doc1', name: 'Shapes', createdAt: 1000, modifiedAt: 1000 }

function shape(over: Partial<BoardShape> = {}): BoardShape {
  return {
    id: 'S1',
    src: 'ABC = (0,0) (4,0) (4,3)',
    params: [],
    color: '#4f9cf9',
    fill: false,
    visible: true,
    ...over,
  }
}

function curve(over: Partial<FittedCurve> = {}): FittedCurve {
  return {
    id: 'c1',
    modelId: 'poly2',
    params: [0, 0, 1],
    kind: 'explicit',
    domain: null,
    color: '#f97362',
    strokeWidth: 2.5,
    visible: true,
    error: 0,
    ...over,
  }
}

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

const vp = (pxPerUnit: number): Viewport => ({
  center: { x: 0, y: 0 },
  pxPerUnit,
  widthPx: 800,
  heightPx: 600,
})

const compiled = (s: BoardShape) => compileShapes([s])

// ---------------------------------------------------------------------------
// Entry: one box, three parsers
// ---------------------------------------------------------------------------

describe('a shape is recognised in the shared equation box', () => {
  it('claims the lines a teacher writes for a figure', () => {
    for (const src of [
      'point (1, 2)',
      'P = (1, 2)',
      'P(1, 2)',
      '(1, 2)',
      'segment (0,0) (3,4)',
      'AB = (0,0) (3,4)',
      'vector <3, 4>',
      'v = <3, 4> from (1, 1)',
      'triangle (0,0) (4,0) (4,3)',
      'ABC = (0,0) (4,0) (4,3)',
    ]) {
      expect(readShape(src).ok, src).toBe(true)
    }
  })

  it('refuses a curve, so the expression parser gets it', () => {
    for (const src of ['y = x', 'r = 2cos(3θ)', 'y = x^2 - 1', '(x+1)(x-2)']) {
      expect(readShape(src).ok, src).toBe(false)
    }
  })

  /**
   * THE ONE THAT MATTERS. The shape parser refuses "y = x" as loudly as it
   * refuses a malformed triangle, and its "that is a curve" must never be what
   * someone typing a curve reads. looksLikeShape is the gate: it says nothing
   * about validity, only about what the line was evidently trying to be.
   */
  it('does not claim a curve just because the shape parser refused it', () => {
    expect(looksLikeShape('y = x')).toBe(false)
    expect(looksLikeShape('y = 2sin(3x)')).toBe(false)
    expect(looksLikeShape('r = 2cos(3theta)')).toBe(false)
    expect(looksLikeShape('dy/dx = x - y')).toBe(false)
  })

  it('claims a line that is clearly a figure, valid or not', () => {
    expect(looksLikeShape('triangle (0,0) (4,0)')).toBe(true)
    expect(looksLikeShape('ABC = (0,0) (4,0) (4,3)')).toBe(true)
    expect(looksLikeShape('(1, 2)')).toBe(true)
    expect(looksLikeShape('<3, 4>')).toBe(true)
    expect(looksLikeShape('  polygon')).toBe(true)
  })

  it('a bracketed product is a curve, not a broken point', () => {
    // It LOOKS like a shape by the bracket rule, which is exactly why the App
    // asks the expression parser first and only falls back to this message.
    expect(looksLikeShape('(x+1)(x-2)')).toBe(true)
    const outcome = readShape('(x+1)(x-2)')
    expect(outcome.ok).toBe(false)
  })

  it('memoises: the same text is the same answer', () => {
    expect(readShape('P = (1, 2)')).toBe(readShape('P = (1, 2)'))
  })
})

// ---------------------------------------------------------------------------
// Compiling
// ---------------------------------------------------------------------------

describe('compiling a shape', () => {
  it('evaluates every vertex out of the line', () => {
    const c = compiled(shape()).get('S1')!
    expect(c.error).toBeNull()
    expect(c.shape?.kind).toBe('polygon')
    expect(c.shape && c.shape.kind === 'polygon' ? c.shape.pts : []).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
    ])
  })

  it('drives a vertex from a slider', () => {
    const s = shape({ src: 'ABC = (0,0) (4,0) (a,3)', params: [2.5] })
    const c = compiled(s).get('S1')!
    const pts = c.shape && c.shape.kind === 'polygon' ? c.shape.pts : []
    expect(pts[2]).toEqual({ x: 2.5, y: 3 })
    expect(c.paramNames).toEqual(['a'])
  })

  it('pads a retyped line rather than leaving a slider undefined', () => {
    const s = shape({ src: 'AB = (a,0) (b,3)', params: [2] })
    const c = compiled(s).get('S1')!
    expect(c.shape && c.shape.kind === 'segment' ? c.shape.b : null).toEqual({ x: 1, y: 3 })
  })

  it('keeps a shape whose line no longer parses, and says why', () => {
    const c = compiled(shape({ src: 'triangle (0,0) (4,0)' })).get('S1')!
    expect(c.shape).toBeNull()
    expect(c.error).toMatch(/vertices/)
    expect(c.latex).toBe('triangle (0,0) (4,0)')
  })

  it('carries the board’s own visibility and fill onto the drawn shape', () => {
    const on = compiled(shape({ fill: true })).get('S1')!
    expect(on.shape && on.shape.kind === 'polygon' ? on.shape.fill : null).toBe(true)
    const hidden = compiled(shape({ visible: false })).get('S1')!
    expect(hidden.shape?.visible).toBe(false)
  })

  it('a hidden shape draws nothing at all', () => {
    const s = shape({ visible: false })
    expect(sceneShapes([s], compiled(s))).toEqual([])
  })

  it('a shape that cannot be read draws nothing at all', () => {
    const s = shape({ src: 'triangle (0,0) (4,0)' })
    expect(sceneShapes([s], compiled(s))).toEqual([])
  })

  it('only a polygon has an interior', () => {
    expect(canFill('polygon')).toBe(true)
    expect(canFill('point')).toBe(false)
    expect(shapeNoun('vector')).toBe('Vector')
  })
})

// ---------------------------------------------------------------------------
// Where the coordinates live IN THE TEXT
// ---------------------------------------------------------------------------

describe('finding the coordinates in the line', () => {
  it('reads the pairs in the parser’s own order', () => {
    const pairs = scanPairs('ABC = (0,0) (4,0) (4,3)')
    expect(pairs).toHaveLength(3)
    expect(pairs.map((p) => `${p.x.text},${p.y.text}`)).toEqual(['0,0', '4,0', '4,3'])
    expect(pairs.every((p) => !p.angle)).toBe(true)
  })

  it('knows an angle-bracket pair from a location', () => {
    const pairs = scanPairs('v = <2a, a> from (1,1)')
    expect(pairs.map((p) => p.angle)).toEqual([true, false])
    expect(pairs[0].x.text).toBe('2a')
  })

  it('does not split a nested call', () => {
    const pairs = scanPairs('<f(1, 2), 3>')
    expect(pairs).toHaveLength(1)
    expect(pairs[0].x.text).toBe('f(1, 2)')
    expect(pairs[0].y.text).toBe('3')
  })

  it('yields nothing rather than guessing at a line it cannot read', () => {
    expect(scanPairs('(1, 2')).toEqual([])
    expect(scanPairs('polygon')).toEqual([])
  })

  it('tells a formula from a number', () => {
    expect(isExprCoord('2a')).toBe(true)
    expect(isExprCoord('1/3')).toBe(true)
    expect(isExprCoord('-2.5')).toBe(false)
    expect(isExprCoord(' 4 ')).toBe(false)
  })
})

describe('rewriting one coordinate', () => {
  it('replaces a constant with the number, leaving everything else alone', () => {
    expect(replaceCoord('ABC = (0,0) (4,0) (a,3)', 2, 'x', 2.5)).toBe(
      'ABC = (0,0) (4,0) (2.5,3)',
    )
  })

  it('keeps the spacing the teacher typed', () => {
    expect(replaceCoord('P = ( 1, 2 )', 0, 'y', 5)).toBe('P = ( 1, 5 )')
  })

  it('writes a number the parser can read back', () => {
    const next = replaceCoord('P = (a, 2)', 0, 'x', -0.2)!
    expect(next).toBe('P = (-0.2, 2)')
    expect(readShape(next).ok).toBe(true)
    // ASCII only: a typographic minus is not a number to the parser.
    expect(next).not.toContain('−')
  })

  it('does not invent float noise', () => {
    expect(numText(0.1 + 0.2)).toBe('0.3')
    expect(numText(-0)).toBe('0')
    expect(numText(2)).toBe('2')
  })

  it('says nothing to do when the pair is not there', () => {
    expect(replaceCoord('P = (1, 2)', 3, 'x', 1)).toBeNull()
    expect(replaceCoord('P = (1, 2)', 0, 'x', 1)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Vertices
// ---------------------------------------------------------------------------

describe('a shape’s vertices', () => {
  const verticesOf = (src: string) => {
    const s = shape({ src })
    const c = compiled(s).get('S1')!
    return shapeVertices(c.shape!, scanPairs(src))
  }

  it('a point has one, named as the teacher named it', () => {
    const v = verticesOf('P = (1, 2)')
    expect(v).toHaveLength(1)
    expect(v[0]).toMatchObject({ pair: 0, label: 'P', mode: 'absolute', pos: { x: 1, y: 2 } })
  })

  it('a segment has both ends, named by its two letters', () => {
    const v = verticesOf('AB = (0,0) (3,4)')
    expect(v.map((p) => p.label)).toEqual(['A', 'B'])
    expect(v[1].pos).toEqual({ x: 3, y: 4 })
  })

  it('a polygon has every vertex', () => {
    const v = verticesOf('ABC = (0,0) (4,0) (4,3)')
    expect(v.map((p) => p.label)).toEqual(['A', 'B', 'C'])
    expect(v.map((p) => p.pair)).toEqual([0, 1, 2])
  })

  /**
   * The subtlety of the vector. "<2, 3> from (1, 1)" has a TIP at (3, 4), but
   * the text that puts it there is the COMPONENTS pair — so a drag to (5, 5)
   * has to write <4, 4>. Getting this wrong moves the tail instead.
   */
  it('a vector’s tip is written as components, measured from its tail', () => {
    const v = verticesOf('v = <2, 3> from (1, 1)')
    const tip = v.find((p) => p.label === 'tip')!
    expect(tip.pos).toEqual({ x: 3, y: 4 })
    expect(tip.mode).toBe('components')
    expect(tip.origin).toEqual({ x: 1, y: 1 })
    expect(v.find((p) => p.label === 'tail')?.pos).toEqual({ x: 1, y: 1 })
  })

  it('a vector with no tail has no tail to grab', () => {
    const v = verticesOf('vector <3, 4>')
    expect(v.map((p) => p.label)).toEqual(['tip'])
    expect(v[0].pos).toEqual({ x: 3, y: 4 })
  })

  it('a tail-to-tip vector moves both ends directly', () => {
    const v = verticesOf('vector (1,1) to (4,5)')
    expect(v.map((p) => p.label)).toEqual(['tail', 'tip'])
    expect(v.every((p) => p.mode === 'absolute')).toBe(true)
  })
})

describe('dragging a vertex rewrites the line', () => {
  it('a coordinate that was a constant becomes the number', () => {
    const src = 'ABC = (0,0) (4,0) (a,3)'
    const c = compiled(shape({ src, params: [4] })).get('S1')!
    const v = shapeVertices(c.shape!, scanPairs(src)).find((p) => p.pair === 2)!
    expect(moveVertex(src, v, { x: 2.5, y: 1.5 })).toBe('ABC = (0,0) (4,0) (2.5,1.5)')
  })

  it('a vector’s tip writes components, not the position', () => {
    const src = 'v = <2, 3> from (1, 1)'
    const c = compiled(shape({ src })).get('S1')!
    const tip = shapeVertices(c.shape!, scanPairs(src)).find((p) => p.mode === 'components')!
    expect(moveVertex(src, tip, { x: 5, y: 5 })).toBe('v = <4, 4> from (1, 1)')
  })

  it('the rewritten line is still a shape', () => {
    const src = 'v = <2a, a> from (1, 1)'
    const c = compiled(shape({ src, params: [1] })).get('S1')!
    const tip = shapeVertices(c.shape!, scanPairs(src)).find((p) => p.mode === 'components')!
    const next = moveVertex(src, tip, { x: 4, y: 3 })!
    expect(next).toBe('v = <3, 2> from (1, 1)')
    const after = readShape(next)
    expect(after.ok).toBe(true)
    // The slider is gone with the letter that named it: the line no longer
    // mentions `a`, so there is nothing left to drag.
    expect(after.ok && after.paramNames).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// What a card is handed
// ---------------------------------------------------------------------------

describe('a shape’s card', () => {
  it('prints one line per vertex, with the source behind each coordinate', () => {
    const s = shape({ src: 'ABC = (0,0) (4,0) (a,3)', params: [2.5] })
    const data = shapeCard(s, compiled(s))
    expect(data.noun).toBe('Polygon')
    expect(data.vertices).toHaveLength(3)
    expect(data.vertices[2]).toMatchObject({ label: 'C', x: 2.5, y: 3, xSrc: 'a', xExpr: true })
    expect(data.vertices[2].yExpr).toBe(false)
  })

  it('offers one slider per free constant, on the shared rule', () => {
    const s = shape({ src: 'v = <2a, a>', params: [1.5] })
    const data = shapeCard(s, compiled(s))
    expect(data.params.map((p) => p.name)).toEqual(['a'])
    expect(data.params[0].value).toBe(1.5)
    expect(data.params[0].meta.min).toBeLessThan(1.5)
    expect(data.params[0].meta.max).toBeGreaterThan(1.5)
  })

  it('offers fill only where there is an interior', () => {
    const poly = shape()
    expect(shapeCard(poly, compiled(poly)).fillable).toBe(true)
    const pt = shape({ src: 'P = (1, 2)' })
    expect(shapeCard(pt, compiled(pt)).fillable).toBe(false)
  })

  it('says what is wrong rather than pretending there is nothing there', () => {
    const s = shape({ src: 'triangle (0,0) (4,0)' })
    const data = shapeCard(s, compiled(s))
    expect(data.error).toMatch(/vertices/)
    expect(data.vertices).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The legend
// ---------------------------------------------------------------------------

describe('the projected legend', () => {
  it('shows a named figure by name', () => {
    expect(shapeChipTex('\\triangle ABC: (0,0),(4,0),(4,3)')).toBe('\\triangle ABC')
    expect(shapeChipTex('\\overline{AB}: (0,0)\\to(3,4)')).toBe('\\overline{AB}')
    expect(shapeChipTex('ABCD: (0,0),(1,0),(1,1),(0,1)')).toBe('ABCD')
  })

  it('keeps the coordinates of anything that has no name to show', () => {
    const tex = '\\text{polygon}: (0,0),(4,0),(4,3)'
    expect(shapeChipTex(tex)).toBe(tex)
    expect(shapeChipTex('P = (1, 2)')).toBe('P = (1, 2)')
    expect(shapeChipTex('\\vec{v} = \\langle 3, 4 \\rangle')).toBe(
      '\\vec{v} = \\langle 3, 4 \\rangle',
    )
  })

  it('leaves out what is not on the board', () => {
    const hidden = shape({ visible: false })
    expect(shapeLegend([hidden], compiled(hidden))).toEqual([])
    const broken = shape({ src: 'triangle (0,0) (4,0)' })
    expect(shapeLegend([broken], compiled(broken))).toEqual([])
    const ok = shape()
    expect(shapeLegend([ok], compiled(ok))).toEqual([
      { id: 'S1', color: '#4f9cf9', tex: '\\triangle ABC', text: ok.src },
    ])
  })
})

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

describe('a shape survives a save and a load', () => {
  it('omits every default, so an untouched control changes no bytes', () => {
    const stored = shapeToStored(shape())
    expect(stored).toEqual({ id: 'S1', src: 'ABC = (0,0) (4,0) (4,3)', color: '#4f9cf9' })
    expect('params' in stored).toBe(false)
    expect('fill' in stored).toBe(false)
    expect('hidden' in stored).toBe(false)
  })

  it('writes what a teacher actually chose', () => {
    const stored = shapeToStored(shape({ params: [2.5], fill: true, visible: false }))
    expect(stored.params).toEqual([2.5])
    expect(stored.fill).toBe(true)
    expect(stored.hidden).toBe(true)
  })

  it('serialises a document without them byte-for-byte as it did before', () => {
    const plain = board({ curves: [curve()] })
    const a = serializeDoc(docFromBoard(META, plain, 2000))
    const withEmpty = serializeDoc(docFromBoard(META, { ...plain, shapes: [] }, 2000))
    expect(withEmpty).toBe(a)
    expect(a).not.toContain('"shapes"')
  })

  it('comes back live, with its constants where they were left', () => {
    const s = shape({ src: 'ABC = (0,0) (4,0) (a,3)', params: [2.5], fill: true })
    const json = serializeDoc(docFromBoard(META, board({ shapes: [s] }), 2000))
    const back = deserializeDoc(json)
    expect(back.degraded).toBe(false)
    expect(back.board?.shapes).toHaveLength(1)
    const got = back.board!.shapes[0]
    expect(got).toMatchObject({ id: 'S1', src: s.src, params: [2.5], fill: true, visible: true })
    // Live, not a photograph: the vertices are evaluated again on load.
    const c = compileShapes([got]).get('S1')!
    const pts = c.shape && c.shape.kind === 'polygon' ? c.shape.pts : []
    expect(pts[2]).toEqual({ x: 2.5, y: 3 })
  })

  it('drops a shape it can no longer read, and SAYS so', () => {
    const json = serializeDoc(
      docFromBoard(META, board({ shapes: [shape({ src: 'ABC = (0,0) (4,0) (4,3)' })] }), 2000),
    )
    const wrecked = json.replace('ABC = (0,0) (4,0) (4,3)', 'ABC = (0,0) (4,0)')
    const back = deserializeDoc(wrecked)
    expect(back.board?.shapes).toEqual([])
    expect(back.degraded).toBe(true)
    expect(back.problems.join(' ')).toMatch(/could not be restored/)
  })

  it('survives a hostile blob without taking the board down', () => {
    expect(storedToShape(null)).toEqual({ error: 'it was not readable' })
    expect(storedToShape({ src: 'P = (1,2)' })).toEqual({ error: 'it had no id' })
    expect(storedToShape({ id: 'x', src: '   ' })).toEqual({
      error: 'it had nothing typed in it',
    })
    const odd = storedToShape({ id: 'x', src: 'P = (a, 2)', params: ['no'], color: 42 })
    expect('shape' in odd && odd.shape.params).toEqual([1])
    expect('shape' in odd && odd.shape.color).toBe('#4f9cf9')
  })

  it('a shape that claims another object’s id is dropped', () => {
    const json = serializeDoc(
      docFromBoard(
        META,
        board({ curves: [curve()], shapes: [shape({ id: 'c1' })] }),
        2000,
      ),
    )
    const back = deserializeDoc(json)
    expect(back.board?.shapes).toEqual([])
    expect(back.degraded).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The ruling
// ---------------------------------------------------------------------------

describe('the board’s ruling', () => {
  it('writes nothing at all for the square one', () => {
    const plain = board({ curves: [curve()] })
    const a = serializeDoc(docFromBoard(META, plain, 2000))
    const said = serializeDoc(docFromBoard(META, { ...plain, grid: 'cartesian' }, 2000))
    expect(said).toBe(a)
    expect(a).not.toContain('"grid"')
  })

  it('writes and reads back the polar one', () => {
    const stored = boardToStored(board({ grid: 'polar' }))
    expect(stored.grid).toBe('polar')
    const back = deserializeDoc(serializeDoc(docFromBoard(META, board({ grid: 'polar' }), 2000)))
    expect(back.board?.grid).toBe('polar')
    expect(back.degraded).toBe(false)
  })

  it('anything else is the square ruling, and that is not a repair', () => {
    expect(storedGrid(undefined)).toBe('cartesian')
    expect(storedGrid('nonsense')).toBe('cartesian')
    expect(storedGrid(7)).toBe('cartesian')
    expect(storedGrid('polar')).toBe('polar')
  })

  it('offers itself for a polar curve, by family or by kind', () => {
    expect(isPolarCurve(curve({ modelId: 'polarRose', kind: 'polar' }))).toBe(true)
    expect(isPolarCurve(curve({ modelId: 'limacon', kind: 'polar' }))).toBe(true)
    expect(isPolarCurve(curve({ modelId: 'spiral', kind: 'polar' }))).toBe(true)
    // A typed r = 2cos(3θ) is `expr_N`; what says it is polar is its kind.
    expect(isPolarCurve(curve({ modelId: 'expr_1', kind: 'polar' }))).toBe(true)
    expect(isPolarCurve(curve())).toBe(false)
  })

  it('never offers itself for a board with nothing polar on it', () => {
    expect(suggestPolarRuling([curve(), curve({ id: 'c2', modelId: 'sine' })])).toBe(false)
    expect(suggestPolarRuling([curve({ modelId: 'polarRose', kind: 'polar' })])).toBe(true)
    // A hidden curve is not on the board.
    expect(
      suggestPolarRuling([curve({ modelId: 'polarRose', kind: 'polar', visible: false })]),
    ).toBe(false)
  })

  it('offers exactly two rulings', () => {
    expect(RULINGS.map((r) => r.value)).toEqual(['cartesian', 'polar'])
  })
})

// ---------------------------------------------------------------------------
// Nice numbers for placed points
// ---------------------------------------------------------------------------

describe('where a point put down with a finger lands', () => {
  it('turns the tap that used to place (−0.041667, 1.975) into (0, 2)', () => {
    expect(snapPlaced({ x: -0.041667, y: 1.975 }, vp(60))).toEqual({ x: 0, y: 2 })
  })

  it('comes off the grid’s own ladder, so it tightens as the board zooms in', () => {
    const wide = snapStep(vp(20))
    const near = snapStep(vp(300))
    expect(near).toBeLessThan(wide)
    expect(snapStep(vp(90))).toBeCloseTo(0.1, 12)
  })

  it('never produces float noise', () => {
    // Math.round(1.975 / 0.2) * 0.2 is 2.0000000000000004 before cleaning.
    expect(String(snapCoord(1.975, vp(60)))).toBe('2')
    expect(String(snapCoord(-0.0001, vp(60)))).toBe('0')
  })

  it('lands ON the ladder, whatever the zoom', () => {
    for (const ppu of [12, 37, 60, 145, 400, 2000]) {
      const v = vp(ppu)
      const step = snapStep(v)
      const got = snapCoord(3.14159, v)
      expect(Math.abs(got / step - Math.round(got / step)), `ppu ${ppu}`).toBeLessThan(1e-6)
      // And within half a rung of where the finger actually was.
      expect(Math.abs(got - 3.14159), `ppu ${ppu}`).toBeLessThanOrEqual(step / 2 + 1e-9)
    }
  })

  it('leaves a value it cannot place alone', () => {
    expect(snapCoord(Number.NaN, vp(60))).toBeNaN()
    expect(snapCoord(Number.POSITIVE_INFINITY, vp(60))).toBe(Number.POSITIVE_INFINITY)
  })
})

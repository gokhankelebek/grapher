// ============================================================================
// tests/fieldLinks.test.ts — slope fields as the BOARD holds them.
//
// The grammar is already tested in tests/slopeField.test.ts, the integrator in
// tests/ode.test.ts and the lattice in tests/fields.test.ts. What is tested
// HERE is the wiring between them and the document: that a differential
// equation entered in the shared equation box is recognised as one, that the
// solution curves really do follow the directions the lattice draws, that a
// field says the same thing after a save and a load, and that a document
// without one is byte-for-byte the document it was before fields existed.
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { FittedCurve } from '../src/core/types'
import {
  boardToStored,
  deserializeDoc,
  docFromBoard,
  fieldToStored,
  serializeDoc,
  storedToField,
  FIELD_SPACINGS,
  FIELD_SPACING_DEFAULT,
} from '../src/core/persist'
import type { BoardField, BoardInput, DocMeta } from '../src/core/persist'
import {
  carryParams,
  clampFieldSpacing,
  compileFields,
  coord,
  fieldCard,
  fieldLegend,
  fieldParamMeta,
  looksLikeField,
  readField,
  sceneFields,
  solutionPolylines,
  solveSpan,
  spacingKey,
  spanCovers,
  throughLabel,
  SOLUTION_WIDTH,
} from '../src/ui/fieldLinks'

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const META: DocMeta = { id: 'doc1', name: 'Slope fields', createdAt: 1000, modifiedAt: 1000 }

function field(over: Partial<BoardField> = {}): BoardField {
  return {
    id: 'F1',
    src: 'dy/dx = x - y',
    params: [],
    color: '#4f9cf9',
    spacingPx: FIELD_SPACING_DEFAULT,
    visible: true,
    solutions: [],
    ...over,
  }
}

function curve(id = 'c1'): FittedCurve {
  return {
    id,
    modelId: 'poly2',
    params: [0, 0, 1],
    kind: 'explicit',
    domain: null,
    color: '#f97362',
    strokeWidth: 2.5,
    visible: true,
    error: 0,
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

// ---------------------------------------------------------------------------
// Entry: one box, two parsers
// ---------------------------------------------------------------------------

describe('a differential equation is recognised in the equation box', () => {
  it('accepts every left-hand side a teacher writes', () => {
    for (const src of [
      'dy/dx = x - y',
      'd y / d x = x*y',
      'dydx = 2',
      "y' = sin(x) + y",
      "y'(x) = -x/y",
      "f' = y",
      'dy/dx: x - y',
    ]) {
      expect(readField(src).ok, src).toBe(true)
    }
  })

  it('claims anything that STARTS like a derivative, parse or no parse', () => {
    // These are the ones the shared box must not hand to parseExpression: it
    // reads "dy/dx" as a product of three letters and draws a curve for it.
    for (const src of ['dy/dx = x - ', 'dz/dx = x', "y' = ", 'dydx = ', "g'(t) = t"]) {
      expect(looksLikeField(src), src).toBe(true)
      expect(readField(src).ok, src).toBe(false)
    }
  })

  it('leaves ordinary equations alone', () => {
    for (const src of ['y = 2sin(3x) + 1', 'x^2 + y^2 = 4', 'r = 1 + cos(theta)', 'd = 4']) {
      expect(looksLikeField(src), src).toBe(false)
    }
  })

  it('explains dz/dx rather than silently drawing it', () => {
    const out = readField('dz/dx = x')
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toContain('Only dy/dx makes a slope field')
  })

  it('reports the parser position for a broken right side', () => {
    const out = readField('dy/dx = x +')
    expect(out.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Compiling
// ---------------------------------------------------------------------------

describe('compiling a field', () => {
  it('builds a closure that evaluates the equation at the stored constants', () => {
    const f = field({ src: "y' = a*y", params: [2.5] })
    const c = compileFields([f]).get('F1')!
    expect(c.error).toBeNull()
    expect(c.paramNames).toEqual(['a'])
    expect(c.field!.f(0, 4)).toBeCloseTo(10, 12)
    expect(c.latex).toContain('\\frac{dy}{dx}')
  })

  it('carries the field its colour, its spacing and its visibility', () => {
    const f = field({ color: '#abcdef', spacingPx: FIELD_SPACINGS.dense, visible: false })
    const c = compileFields([f]).get('F1')!
    expect(c.field!.color).toBe('#abcdef')
    expect(c.field!.spacingPx).toBe(FIELD_SPACINGS.dense)
    expect(c.field!.visible).toBe(false)
  })

  it('draws nothing, and says why, when the equation cannot be read', () => {
    const c = compileFields([field({ src: 'dy/dx = x +' })]).get('F1')!
    expect(c.field).toBeNull()
    expect(c.error).toBeTruthy()
  })

  it('fills in a constant the stored params do not have yet', () => {
    // y' = a*y retyped as y' = a*y*(1 - y/k): k has no stored value.
    const f = field({ src: "y' = a*y*(1 - y/k)", params: [2] })
    const c = compileFields([f]).get('F1')!
    expect(c.paramNames).toEqual(['a', 'k'])
    // a = 2 kept, k defaulted to 1 -> f(0, 0.5) = 2*0.5*(1 - 0.5) = 0.5
    expect(c.field!.f(0, 0.5)).toBeCloseTo(0.5, 12)
  })

  it('keeps a hidden field out of the scene without forgetting it', () => {
    const fields = [field(), field({ id: 'F2', src: "y' = y", visible: false })]
    const compiled = compileFields(fields)
    expect(compiled.size).toBe(2)
    expect(sceneFields(fields, compiled).map((f) => f.id)).toEqual(['F1'])
  })

  it('keeps an unreadable field out of the scene', () => {
    const fields = [field({ src: 'dy/dx = )' })]
    expect(sceneFields(fields, compileFields(fields))).toEqual([])
  })
})

describe('a free constant gets the same slider a typed curve would give it', () => {
  it('centres a small value in a ±10 window', () => {
    expect(fieldParamMeta('a', 1)).toEqual({ name: 'a', min: -9, max: 11, step: 0.01 })
  })

  it('widens with magnitude once the value is large', () => {
    const m = fieldParamMeta('k', 50)
    expect(m.min).toBe(-50)
    expect(m.max).toBe(150)
    expect(m.step).toBeLessThan(1)
  })
})

// ---------------------------------------------------------------------------
// Solution curves
// ---------------------------------------------------------------------------

describe('solution curves follow the field', () => {
  const span: [number, number] = [-6, 6]

  it('threads the point it was asked to pass through', () => {
    const f = field({ solutions: [{ id: 'S1', x: 0, y: 2 }] })
    const [poly] = solutionPolylines([f], compileFields([f]), span)
    expect(poly.id).toBe('sol:S1')
    expect(poly.color).toBe('#4f9cf9')
    expect(poly.width).toBe(SOLUTION_WIDTH)
    expect(poly.pts.some((p) => p.x === 0 && p.y === 2)).toBe(true)
  })

  it('is tangent to the direction the lattice draws, everywhere along it', () => {
    // dy/dx = x - y through (0, 2) is y = x - 1 + 3e^(-x); the test does not
    // use that, it checks the polyline against the FIELD it was drawn in.
    const f = field({ solutions: [{ id: 'S1', x: 0, y: 2 }] })
    const compiled = compileFields([f])
    const fn = compiled.get('F1')!.field!.f
    const [poly] = solutionPolylines([f], compiled, [-2, 4])
    const pts = poly.pts
    let checked = 0
    for (let i = 0; i < pts.length - 1; i++) {
      const dx = pts[i + 1].x - pts[i].x
      if (dx < 1e-6) continue
      // The chord of one step, against the direction at that step's MIDPOINT:
      // the steps are adaptive, so a centred difference across two of them
      // straddles two different step sizes and is only first-order accurate.
      const slope = (pts[i + 1].y - pts[i].y) / dx
      const want = fn((pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2)
      if (Math.abs(want) > 20) continue // near-vertical: a chord says nothing
      expect(Math.abs(slope - want)).toBeLessThanOrEqual(1e-3 * Math.max(1, Math.abs(want)))
      checked++
    }
    expect(checked).toBeGreaterThan(20)
  })

  it('matches the closed form of the AP classic to four places', () => {
    const f = field({ solutions: [{ id: 'S1', x: 0, y: 2 }] })
    const [poly] = solutionPolylines([f], compileFields([f]), [-2, 4])
    const exact = (x: number): number => x - 1 + 3 * Math.exp(-x)
    for (const p of poly.pts) {
      expect(p.y).toBeCloseTo(exact(p.x), 4)
    }
  })

  it('flattens a logistic curve at its carrying capacity', () => {
    const f = field({
      src: "y' = a*y*(1 - y/k)",
      params: [1, 3],
      solutions: [{ id: 'S1', x: 0, y: 0.2 }],
    })
    const [poly] = solutionPolylines([f], compileFields([f]), [-10, 20])
    const last = poly.pts[poly.pts.length - 1]
    expect(last.x).toBeGreaterThan(15)
    expect(last.y).toBeCloseTo(3, 3)
    // and it is an S: below k the whole way, and rising
    expect(poly.pts.every((p) => p.y > 0 && p.y <= 3.0001)).toBe(true)
    for (let i = 1; i < poly.pts.length; i++) {
      expect(poly.pts[i].y).toBeGreaterThanOrEqual(poly.pts[i - 1].y - 1e-9)
    }
  })

  it('deforms every solution curve when a constant moves', () => {
    const base = field({
      src: "y' = a*y*(1 - y/k)",
      params: [1, 3],
      solutions: [
        { id: 'S1', x: 0, y: 0.2 },
        { id: 'S2', x: 0, y: 2.5 },
      ],
    })
    const slow = solutionPolylines([base], compileFields([base]), [0, 4])
    const fast = field({ ...base, params: [4, 3] })
    const quick = solutionPolylines([fast], compileFields([fast]), [0, 4])
    expect(slow).toHaveLength(2)
    expect(quick).toHaveLength(2)
    // A larger growth rate reaches the capacity sooner, on BOTH curves.
    const at = (poly: (typeof slow)[number], x: number): number => {
      let best = poly.pts[0]
      for (const p of poly.pts) if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p
      return best.y
    }
    expect(at(quick[0], 2)).toBeGreaterThan(at(slow[0], 2))
    expect(at(quick[1], 2)).toBeGreaterThan(at(slow[1], 2))
  })

  it('draws nothing for a hidden field, or for one that cannot be read', () => {
    const hidden = field({ visible: false, solutions: [{ id: 'S1', x: 0, y: 2 }] })
    expect(solutionPolylines([hidden], compileFields([hidden]), span)).toEqual([])
    const broken = field({ src: 'dy/dx = )', solutions: [{ id: 'S1', x: 0, y: 2 }] })
    expect(solutionPolylines([broken], compileFields([broken]), span)).toEqual([])
  })

  it('drops an initial condition that is not a point', () => {
    const f = field({
      solutions: [
        { id: 'S1', x: Number.NaN, y: 2 },
        { id: 'S2', x: 0, y: 1 },
      ],
    })
    expect(solutionPolylines([f], compileFields([f]), span).map((p) => p.id)).toEqual(['sol:S2'])
  })

  it('never emits a non-finite point, even on a field that blows up', () => {
    const f = field({ src: 'dy/dx = y^2', solutions: [{ id: 'S1', x: 0, y: 1 }] })
    const [poly] = solutionPolylines([f], compileFields([f]), [-4, 4])
    for (const p of poly.pts) {
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
    }
    // y' = y² through (0, 1) blows up at x = 1; the curve must stop short.
    expect(poly.pts[poly.pts.length - 1].x).toBeLessThan(1.01)
  })
})

// ---------------------------------------------------------------------------
// The solved span
// ---------------------------------------------------------------------------

describe('how far a solution curve is integrated', () => {
  it('pads the window by half its width each side', () => {
    expect(solveSpan([-4, 4])).toEqual([-8, 8])
    expect(solveSpan([0, 2])).toEqual([-1, 3])
  })

  it('reads a reversed or degenerate window without producing nonsense', () => {
    expect(solveSpan([4, -4])).toEqual([-8, 8])
    expect(solveSpan([2, 2])).toEqual([-10, 10])
    expect(solveSpan([Number.NaN, 4])).toEqual([-10, 10])
  })

  it('re-solves only when the window has left what was already solved', () => {
    const span = solveSpan([-4, 4]) // [-8, 8]
    expect(spanCovers(span, [-4, 4])).toBe(true) // unmoved
    expect(spanCovers(span, [-1, 1])).toBe(true) // zoomed in
    expect(spanCovers(span, [-7, 7])).toBe(true) // panned inside the margin
    expect(spanCovers(span, [-9, 1])).toBe(false) // panned past it
    expect(spanCovers(span, [-20, 20])).toBe(false) // zoomed out past it
  })
})

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

describe('what a field card is handed', () => {
  it('names every slider and gives it a range around its own value', () => {
    const f = field({ src: "y' = a*y*(1 - y/k)", params: [2, 3] })
    const card = fieldCard(f, compileFields([f]))
    expect(card.params.map((p) => p.name)).toEqual(['a', 'k'])
    expect(card.params[1].value).toBe(3)
    expect(card.params[1].meta.min).toBeLessThan(3)
    expect(card.params[1].meta.max).toBeGreaterThan(3)
    expect(card.error).toBeNull()
  })

  it('writes each solution curve as the point it goes through', () => {
    const f = field({
      solutions: [
        { id: 'S1', x: 0, y: 2 },
        { id: 'S2', x: -1.5, y: 0.25 },
      ],
    })
    const card = fieldCard(f, compileFields([f]))
    expect(card.solutions.map((s) => s.text)).toEqual([
      'through (0, 2)',
      'through (−1.5, 0.25)',
    ])
  })

  it('says which spacing is lit', () => {
    expect(fieldCard(field({ spacingPx: FIELD_SPACINGS.sparse }), new Map()).spacing).toBe('sparse')
    expect(spacingKey(FIELD_SPACINGS.dense)).toBe('dense')
    // and an off-list spacing from a hand-edited file still lights something
    expect(spacingKey(31)).toBe('normal')
  })

  it('shows the source, and the reason, when the equation cannot be read', () => {
    const f = field({ src: 'dy/dx = )' })
    const card = fieldCard(f, compileFields([f]))
    expect(card.error).toBeTruthy()
    expect(card.latex).toBe('dy/dx = )')
    expect(card.params).toEqual([])
  })

  it('prints a real minus sign and no floating-point dust', () => {
    expect(coord(-1.5)).toBe('−1.5')
    expect(coord(0.1 + 0.2)).toBe('0.3')
    expect(throughLabel(0, 2)).toBe('through (0, 2)')
  })
})

describe('retyping an equation keeps the constants it still has', () => {
  it('matches by NAME, not by position', () => {
    // y' = a*y with a = 2.4, retyped as y' = a*y*(1 - y/k)
    expect(carryParams(['a'], [2.4], ['a', 'k'], [1, 1])).toEqual([2.4, 1])
    // and the other way round: k goes, a stays
    expect(carryParams(['a', 'k'], [2.4, 3], ['k', 'a'], [1, 1])).toEqual([3, 2.4])
  })

  it('falls back to the parser’s own defaults for a brand-new name', () => {
    expect(carryParams(['a'], [2.4], ['b'], [7])).toEqual([7])
  })
})

describe('the presentation legend', () => {
  it('gives each visible field a chip carrying its equation', () => {
    const fields = [
      field(),
      field({ id: 'F2', src: "y' = a*y", color: '#f97362' }),
      field({ id: 'F3', src: "y' = y", visible: false }),
    ]
    const chips = fieldLegend(fields, compileFields(fields))
    expect(chips.map((c) => c.id)).toEqual(['F1', 'F2'])
    expect(chips[0].tex).toContain('\\frac{dy}{dx}')
    expect(chips[0].text).toBe('dy/dx = x - y')
    expect(chips[1].color).toBe('#f97362')
  })
})

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

describe('a slope field survives a save and a load', () => {
  const roundTrip = (input: BoardInput) =>
    deserializeDoc(serializeDoc(docFromBoard(META, input, 2000)))

  it('comes back with its equation, constants, colour, spacing and points', () => {
    const f = field({
      src: "y' = a*y*(1 - y/k)",
      params: [2.5, 3],
      color: '#f97362',
      spacingPx: FIELD_SPACINGS.dense,
      visible: false,
      solutions: [
        { id: 'S1', x: 0, y: 0.2 },
        { id: 'S2', x: -1, y: 4 },
      ],
    })
    const res = roundTrip(board({ fields: [f] }))
    expect(res.degraded).toBe(false)
    const back = res.board!.fields[0]
    expect(back.id).toBe('F1')
    expect(back.src).toBe("y' = a*y*(1 - y/k)")
    expect(back.params).toEqual([2.5, 3])
    expect(back.color).toBe('#f97362')
    expect(back.spacingPx).toBe(FIELD_SPACINGS.dense)
    expect(back.visible).toBe(false)
    expect(back.solutions.map((s) => [s.x, s.y])).toEqual([
      [0, 0.2],
      [-1, 4],
    ])
    // and it draws the same picture it drew before the reload
    expect(compileFields([back]).get('F1')!.field!.f(0, 1)).toBeCloseTo(
      compileFields([f]).get('F1')!.field!.f(0, 1),
      12,
    )
  })

  it('keeps an initial condition at full double precision', () => {
    // A logistic curve started a millionth away from an equilibrium is a
    // visibly different picture; rounding it would change the lesson.
    const y = 2.7264301234567
    const f = field({ solutions: [{ id: 'S1', x: 1 / 3, y }] })
    const back = roundTrip(board({ fields: [f] })).board!.fields[0]
    expect(back.solutions[0].y).toBe(y)
    expect(back.solutions[0].x).toBe(1 / 3)
  })

  it('writes no key at all for a board with no fields', () => {
    expect('fields' in boardToStored(board({ curves: [curve()] }))).toBe(false)
    expect('fields' in boardToStored(board({ curves: [curve()], fields: [] }))).toBe(false)
  })

  it('serialises a document without them byte-for-byte as it did before', () => {
    const plain = board({ curves: [curve()] })
    const a = serializeDoc(docFromBoard(META, plain, 2000))
    const withEmpty = serializeDoc(docFromBoard(META, { ...plain, fields: [] }, 2000))
    expect(withEmpty).toBe(a)
    expect(a).not.toContain('"fields"')
  })

  it('omits every default, so an untouched control changes no bytes', () => {
    const stored = fieldToStored(field())
    expect(stored).toEqual({ id: 'F1', src: 'dy/dx = x - y', color: '#4f9cf9' })
    expect('params' in stored).toBe(false)
    expect('spacing' in stored).toBe(false)
    expect('hidden' in stored).toBe(false)
    expect('through' in stored).toBe(false)
  })

  it('drops a field whose equation no longer parses, and says so', () => {
    const res = deserializeDoc(
      JSON.stringify({
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
          fields: [
            { id: 'F1', src: 'dy/dx = x - y', color: '#4f9cf9' },
            { id: 'F2', src: 'dy/dx = ???', color: '#f97362' },
          ],
        },
      }),
    )
    expect(res.board!.fields.map((f) => f.id)).toEqual(['F1'])
    expect(res.degraded).toBe(true)
    expect(res.problems.join(' ')).toContain('dy/dx = ???')
  })

  it('repairs a hand-edited record rather than refusing the document', () => {
    const built = storedToField({
      id: 'F1',
      src: "y' = a*y",
      color: '#4f9cf9',
      params: [],
      spacing: 33,
      through: [0, 2, 'x', 4, 1],
    })
    expect('field' in built).toBe(true)
    if ('field' in built) {
      // no stored constant -> the parser's default
      expect(built.field.params).toEqual([1])
      // an off-list spacing snaps to the nearest offered one
      expect(built.field.spacingPx).toBe(FIELD_SPACINGS.normal)
      // the unreadable pair goes; the odd trailing number is not half a point
      expect(built.field.solutions.map((s) => [s.x, s.y])).toEqual([[0, 2]])
      expect(built.field.solutions[0].id).toBeTruthy()
    }
  })

  it('refuses a record with nothing to rebuild from', () => {
    expect('error' in storedToField({ id: 'F1', color: '#fff' })).toBe(true)
    expect('error' in storedToField({ src: 'dy/dx = x', color: '#fff' })).toBe(true)
    expect('error' in storedToField(null)).toBe(true)
  })

  it('lets a field be the selected object across a reload', () => {
    const res = roundTrip(board({ fields: [field()], selectedId: 'F1' }))
    expect(res.board!.selectedId).toBe('F1')
  })

  it('clamps a spacing the way the card does', () => {
    expect(clampFieldSpacing(FIELD_SPACINGS.sparse)).toBe(FIELD_SPACINGS.sparse)
    expect(clampFieldSpacing(19)).toBe(FIELD_SPACINGS.dense)
    expect(clampFieldSpacing('nonsense')).toBe(FIELD_SPACING_DEFAULT)
    expect(clampFieldSpacing(Number.NaN)).toBe(FIELD_SPACING_DEFAULT)
  })
})

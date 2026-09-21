// ============================================================================
// tests/calcLinks.test.ts — the calculus objects a teacher adds to a curve.
//
// The mathematics is already tested in tests/calculus.test.ts and the drawing
// in tests/overlays.test.ts. What is tested HERE is the wiring between them:
// that a link says the same thing after a save and a load, that a dependent
// dies with the curve it depends on, that a tangent which does not exist is
// refused in words rather than drawn stale, and that a Riemann sum on a card
// really does walk onto the integral as n grows.
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { areaUnder, derivativeModel, tangentAt } from '../src/core/calculus'
import {
  boardToStored,
  createDoc,
  deserializeDoc,
  docFromBoard,
  serializeDoc,
} from '../src/core/persist'
import type { AreaLink, BoardInput, CalcLink, DocMeta } from '../src/core/persist'
import {
  areaReadout,
  cardCalc,
  countPhrase,
  defaultBetweenBounds,
  defaultBounds,
  dependentsOf,
  followDomains,
  fixed,
  integralSymbol,
  labelLegend,
  overlaysFor,
  riemannReadout,
  riemannSymbol,
  tangentReadout,
} from '../src/ui/calcLinks'

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const META: DocMeta = { id: 'doc1', name: 'Calculus 1', createdAt: 1000, modifiedAt: 1000 }

/** y = x³ − 4x, stored ascending: [0, −4, 0, 1]. */
function cubic(id = 'f'): FittedCurve {
  return {
    id,
    modelId: 'poly3',
    params: [0, -4, 0, 1],
    kind: 'explicit',
    domain: null,
    color: '#4f9cf9',
    strokeWidth: 2.5,
    visible: true,
    error: 0,
  }
}

/** y = x², the board's own "2.667 on [0, 2]" example. */
function square(id = 'g'): FittedCurve {
  return {
    id,
    modelId: 'poly2',
    params: [0, 0, 1],
    kind: 'explicit',
    domain: null,
    color: '#38c976',
    strokeWidth: 2.5,
    visible: true,
    error: 0,
  }
}

function line(id: string, b: number, m: number): FittedCurve {
  return {
    id,
    modelId: 'line',
    params: [b, m],
    kind: 'explicit',
    domain: null,
    color: '#4f9cf9',
    strokeWidth: 2,
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

const nameOf = (c: FittedCurve): string => MODELS[c.modelId]?.name ?? c.modelId

// ---------------------------------------------------------------------------

describe('links survive a save and a load', () => {
  /** A cubic carrying one of each of the four objects. */
  function fullBoard(): { input: BoardInput; links: CalcLink[] } {
    const f = cubic()
    const t = tangentAt(f, MODELS, 2)!
    const tan = line('t', t.b, t.m)
    const d = derivativeModel(f, MODELS, 'dfdx_1')!
    const deriv: FittedCurve = {
      id: 'd',
      modelId: d.spec.id,
      params: d.params.slice(),
      kind: 'explicit',
      domain: d.domain,
      color: f.color,
      strokeWidth: 2.5,
      visible: true,
      error: 0,
    }
    const links: CalcLink[] = [
      { kind: 'tangent', id: 'L1', parentId: 'f', curveId: 't', x: 2 },
      { kind: 'derivative', id: 'L2', parentId: 'f', curveId: 'd' },
      { kind: 'area', id: 'L3', parentId: 'f', from: 0, to: 2, abs: false },
      { kind: 'riemann', id: 'L4', parentId: 'f', from: 0, to: 2, n: 8, method: 'left' },
    ]
    return { input: board({ curves: [f, tan, deriv], calc: links }), links }
  }

  it('round-trips all four kinds with identical numbers', () => {
    const { input, links } = fullBoard()
    const res = deserializeDoc(serializeDoc(docFromBoard(META, input, 2000)))
    expect(res.problems).toEqual([])
    expect(res.board!.calc).toEqual(links)
  })

  it('brings the tangent and derivative curves back with the same params', () => {
    const { input } = fullBoard()
    const res = deserializeDoc(serializeDoc(docFromBoard(META, input, 2000)))
    const back = res.board!.curves
    expect(back.map((c) => c.id)).toEqual(['f', 't', 'd'])
    expect(back[1].params).toEqual(input.curves[1].params)
    expect(back[2].params).toEqual(input.curves[2].params)
    expect(back[2].modelId).toBe('poly2')
  })

  it('rebuilds the same overlays from the loaded links', () => {
    const { input } = fullBoard()
    const before = overlaysFor(input.calc!, input.curves, MODELS)
    const res = deserializeDoc(serializeDoc(docFromBoard(META, input, 2000)))
    const after = overlaysFor(res.board!.calc, res.board!.curves, MODELS)
    expect(after).toEqual(before)
    expect(after.map((o) => o.kind)).toEqual(['area', 'rects'])
  })

  it('rebuilds the closure a numerically-differentiated derivative needs', () => {
    // A typed expression's derivative has no library family; its model is a
    // closure, and only its LINK can bring it back.
    const src = 'y = sin(x) * x'
    const parsed = MODELS // placeholder so the import stays honest
    expect(parsed).toBeTruthy()
    const spec: ModelSpec = {
      id: 'expr_1',
      kind: 'explicit',
      name: 'Expression',
      evalExplicit: (_p, x) => Math.sin(x) * x,
      latex: () => 'y = x\\sin x',
      paramMeta: () => [],
    }
    const parent: FittedCurve = {
      id: 'p',
      modelId: 'expr_1',
      params: [],
      kind: 'explicit',
      domain: null,
      color: '#4f9cf9',
      strokeWidth: 2.5,
      visible: true,
      error: 0,
    }
    const d = derivativeModel(parent, { ...MODELS, expr_1: spec }, 'dfdx_1')!
    expect(d.spec.id).toBe('dfdx_1')
    const child: FittedCurve = { ...parent, id: 'c', modelId: 'dfdx_1', params: d.params.slice() }
    const input = board({
      curves: [parent, child],
      exprSources: { p: src },
      calc: [{ kind: 'derivative', id: 'L1', parentId: 'p', curveId: 'c' }],
    })
    const res = deserializeDoc(serializeDoc(docFromBoard(META, input, 2000)))
    const rebuilt = res.board!.extraModels['dfdx_1']
    expect(rebuilt).toBeTruthy()
    // x·sin(x) differentiates to sin x + x cos x; at x = 1 that is ~1.3818.
    expect(rebuilt.evalExplicit!([], 1)).toBeCloseTo(Math.sin(1) + Math.cos(1), 6)
    expect(res.board!.derivCounter).toBe(1)
  })

  it('a board with no calculus objects writes no key at all', () => {
    const stored = boardToStored(board({ curves: [cubic()] }))
    expect('calc' in stored).toBe(false)
    // and an empty list is the same as none
    expect('calc' in boardToStored(board({ curves: [cubic()], calc: [] }))).toBe(false)
  })

  it('serialises a document without them byte-for-byte as it did before', () => {
    const plain = board({ curves: [cubic(), square()] })
    const a = serializeDoc(docFromBoard(META, plain, 2000))
    const withEmpty = serializeDoc(docFromBoard(META, { ...plain, calc: [] }, 2000))
    expect(withEmpty).toBe(a)
    expect(a).not.toContain('"calc"')
  })

  it('keeps a limit dragged exactly onto the end of a domain', () => {
    // Rounding this to six places pushed it a millionth PAST the domain end,
    // and areaUnder — correctly — refused an interval that leaves the curve.
    // The integral was therefore on screen before a reload and gone after it.
    const end = 2.7264301234567
    const clipped: FittedCurve = { ...square(), domain: [0, end] }
    const links: CalcLink[] = [
      { kind: 'area', id: 'A', parentId: 'g', from: 0, to: end, abs: false },
    ]
    const res = deserializeDoc(
      serializeDoc(docFromBoard(META, board({ curves: [clipped], calc: links }), 2000)),
    )
    const back = res.board!.calc[0]
    expect(back.kind === 'area' && back.to).toBe(end)
    expect(areaReadout(back as never, res.board!.curves[0], MODELS).value).toBeCloseTo(
      end ** 3 / 3,
      9,
    )
  })

  it('does not write the |area| flag when it was never switched on', () => {
    const stored = boardToStored(
      board({
        curves: [cubic()],
        calc: [{ kind: 'area', id: 'L1', parentId: 'f', from: 0, to: 2, abs: false }],
      }),
    )
    expect(stored.calc![0]).toEqual({ kind: 'area', id: 'L1', parentId: 'f', from: 0, to: 2 })
  })
})

describe('a link whose parent is gone is dropped, and says so', () => {
  it('reports the loss instead of loading a tangent to nothing', () => {
    const doc = createDoc(
      'Lesson',
      boardToStored(
        board({
          curves: [line('t', 1, 2)],
          calc: [{ kind: 'tangent', id: 'L1', parentId: 'missing', curveId: 't', x: 2 }],
        }),
      ),
    )
    const res = deserializeDoc(serializeDoc(doc))
    expect(res.board!.calc).toEqual([])
    expect(res.degraded).toBe(true)
    expect(res.problems.join(' ')).toContain('tangent line')
  })

  it('drops a link whose own curve is gone', () => {
    const res = deserializeDoc(
      serializeDoc(
        createDoc(
          'Lesson',
          boardToStored(
            board({
              curves: [cubic()],
              calc: [{ kind: 'derivative', id: 'L1', parentId: 'f', curveId: 'vanished' }],
            }),
          ),
        ),
      ),
    )
    expect(res.board!.calc).toEqual([])
    expect(res.problems.join(' ')).toContain('derivative curve')
  })

  it('reads a hostile blob without throwing, keeping only what is whole', () => {
    const raw = {
      version: 2,
      id: 'd',
      name: 'n',
      createdAt: 1,
      modifiedAt: 1,
      board: {
        curves: [{ ...cubic(), params: [0, -4, 0, 1] }],
        viewport: { cx: 0, cy: 0, ppu: 60 },
        selectedId: null,
        mode: 'draw',
        calc: [
          null,
          { kind: 'area', id: 'ok', parentId: 'f', from: 0, to: 2 },
          { kind: 'area', id: 'no-from', parentId: 'f', to: 2 },
          { kind: 'riemann', id: 'r', parentId: 'f', from: 0, to: 2, n: 1e9, method: 'nope' },
          'not an object',
        ],
      },
    }
    const res = deserializeDoc(JSON.stringify(raw))
    expect(res.board!.calc.map((l) => l.id)).toEqual(['ok', 'r'])
    const r = res.board!.calc[1]
    expect(r.kind === 'riemann' && r.n).toBe(200)
    expect(r.kind === 'riemann' && r.method).toBe('left')
  })
})

describe('dependents go with the curve they depend on', () => {
  const links: CalcLink[] = [
    { kind: 'tangent', id: 'L1', parentId: 'f', curveId: 't', x: 2 },
    { kind: 'derivative', id: 'L2', parentId: 'f', curveId: 'd' },
    { kind: 'area', id: 'L3', parentId: 'f', from: 0, to: 2, abs: false },
    // a tangent ON the derivative — the case that needs the transitive pass
    { kind: 'tangent', id: 'L4', parentId: 'd', curveId: 't2', x: 1 },
    // and something on an unrelated curve, which must survive
    { kind: 'area', id: 'L5', parentId: 'g', from: 0, to: 1, abs: false },
  ]

  it('takes everything reachable from the deleted curve, transitively', () => {
    const dead = dependentsOf(links, ['f'])
    expect([...dead.linkIds].sort()).toEqual(['L1', 'L2', 'L3', 'L4'])
    expect([...dead.curveIds].sort()).toEqual(['d', 'f', 't', 't2'])
  })

  it("leaves another curve's objects alone", () => {
    const dead = dependentsOf(links, ['g'])
    expect([...dead.linkIds]).toEqual(['L5'])
    expect([...dead.curveIds].sort()).toEqual(['g'])
  })

  it('deleting the tangent LINE takes only its own link', () => {
    const dead = dependentsOf(links, ['t'])
    expect([...dead.linkIds]).toEqual(['L1'])
    expect([...dead.curveIds].sort()).toEqual(['t'])
  })
})

describe('a tangent that does not exist is refused, not drawn', () => {
  // a·|x − b| + c, so [1, 0, 0] is y = |x| and the corner is at the origin
  const abs: FittedCurve = {
    id: 'a',
    modelId: 'abs',
    params: [1, 0, 0],
    kind: 'explicit',
    domain: null,
    color: '#f95f62',
    strokeWidth: 2.5,
    visible: true,
    error: 0,
  }

  it('has no params at the corner of |x|, and says why', () => {
    // guard: the core really does refuse here
    expect(tangentAt(abs, MODELS, 0)).toBeNull()
    const r = tangentReadout(
      { kind: 'tangent', id: 'L', parentId: 'a', curveId: 't', x: 0 },
      abs,
      MODELS,
      'Absolute value',
    )
    expect(r.params).toBeNull()
    expect(r.slope).toBeNull()
    expect(r.problem).toContain('corner')
  })

  it('names the domain when the point is outside it', () => {
    const clipped: FittedCurve = { ...cubic(), domain: [-1, 1] }
    const r = tangentReadout(
      { kind: 'tangent', id: 'L', parentId: 'f', curveId: 't', x: 3 },
      clipped,
      MODELS,
      'Cubic',
    )
    expect(r.params).toBeNull()
    expect(r.problem).toContain('outside')
  })

  it('carries the slope and the line itself when it does exist', () => {
    const r = tangentReadout(
      { kind: 'tangent', id: 'L', parentId: 'f', curveId: 't', x: 2 },
      cubic(),
      MODELS,
      'Cubic',
    )
    // f(x) = x³ − 4x, f′(2) = 3·4 − 4 = 8, f(2) = 0 -> y = 8x − 16
    expect(r.slope).toBeCloseTo(8, 9)
    expect(r.params![1]).toBeCloseTo(8, 9)
    expect(r.params![0]).toBeCloseTo(-16, 9)
    expect(r.text).toBe('tangent to Cubic at x = 2.00 · slope 8.00')
    expect(r.problem).toBeNull()
  })

  it("the card marks the curve's own card, not the parent's", () => {
    const parent = cubic()
    const tan = line('t', -16, 8)
    const cards = cardCalc(
      [{ kind: 'tangent', id: 'L', parentId: 'f', curveId: 't', x: 2 }],
      [parent, tan],
      MODELS,
      nameOf,
    )
    expect(cards['t'].origin!.kind).toBe('tangent')
    expect(cards['t'].origin!.lead).toBe('tangent to Cubic at')
    expect(cards['t'].origin!.x).toBe(2)
    // the parent's card is offered the menu, but says nothing about being one
    expect(cards['f'].origin).toBeNull()
    expect(cards['f'].canAdd).toBe(true)
  })
})

describe('the derivative of a cubic is a real parabola', () => {
  it('lands in the poly2 family, with the differentiated coefficients', () => {
    const d = derivativeModel(cubic(), MODELS, 'dfdx_1')!
    // a LIBRARY family: the caller registers nothing and the curve inherits
    // sliders, handles and analysis from poly2.
    expect(d.spec.id).toBe('poly2')
    expect(d.exact).toBe(true)
    // d/dx (x³ − 4x) = 3x² − 4, ascending [−4, 0, 3]
    expect(d.params).toEqual([-4, 0, 3])
  })

  it('gives the child a card that says whose derivative it is', () => {
    const parent = cubic()
    const child: FittedCurve = { ...square('d'), params: [-4, 0, 3], color: parent.color }
    const cards = cardCalc(
      [{ kind: 'derivative', id: 'L', parentId: 'f', curveId: 'd' }],
      [parent, child],
      MODELS,
      nameOf,
    )
    expect(cards['d'].origin!.text).toBe('f′ of Cubic')
    expect(cards['d'].origin!.problem).toBeNull()
  })
})

describe('the Riemann readout converges on the integral', () => {
  const g = square()
  const link = (n: number, method: 'left' | 'right' | 'midpoint' | 'trapezoid' = 'left') =>
    ({ kind: 'riemann', id: 'L', parentId: 'g', from: 0, to: 2, n, method }) as const

  it('reads the left sum and the integral it is heading for, on one line', () => {
    // L₄ on x² over [0, 2] is the 1.750 an AP class works out by hand;
    // L₈ is 0.25 · (0² + 0.25² + … + 1.75²) = 2.1875.
    expect(riemannReadout(link(4), g, MODELS).value).toBeCloseTo(1.75, 9)
    expect(riemannReadout(link(4), g, MODELS).text).toBe('L₄ = 1.750 → ∫ = 2.667')
    const r = riemannReadout(link(8), g, MODELS)
    expect(r.value).toBeCloseTo(2.1875, 9)
    expect(r.text).toBe('L₈ = 2.188 → ∫ = 2.667')
  })

  it('n = 200 lands on areaUnder, where n = 8 does not', () => {
    const exact = areaUnder(g, MODELS, 0, 2)!.value
    expect(exact).toBeCloseTo(8 / 3, 9)
    const coarse = riemannReadout(link(8), g, MODELS).value!
    const fine = riemannReadout(link(200), g, MODELS).value!
    expect(Math.abs(coarse - exact)).toBeGreaterThan(0.4)
    expect(Math.abs(fine - exact)).toBeLessThan(0.02)
    // and it is monotone in the right direction for a left sum on a rising curve
    expect(fine).toBeGreaterThan(coarse)
  })

  it('every method reaches the integral by n = 200', () => {
    const exact = areaUnder(g, MODELS, 0, 2)!.value
    for (const m of ['left', 'right', 'midpoint', 'trapezoid'] as const) {
      const v = riemannReadout(link(200, m), g, MODELS).value!
      expect(Math.abs(v - exact), m).toBeLessThan(0.03)
    }
  })

  it('names the rule and the count the way the board writes it', () => {
    expect(riemannSymbol('left', 8)).toBe('L₈')
    expect(riemannSymbol('midpoint', 200)).toBe('M₂₀₀')
    expect(riemannSymbol('trapezoid', 1)).toBe('T₁')
  })

  it('draws exactly n rectangles', () => {
    const overlays = overlaysFor([link(8)], [g], MODELS)
    expect(overlays).toHaveLength(1)
    const o = overlays[0]
    expect(o.kind === 'rects' && o.rects.length).toBe(8)
  })

  it('an area and a Riemann sum coexist on one curve', () => {
    const links: CalcLink[] = [
      { kind: 'area', id: 'A', parentId: 'g', from: 0, to: 2, abs: false },
      link(8),
    ]
    const overlays = overlaysFor(links, [g], MODELS)
    // the wash first, the outlines on top of it
    expect(overlays.map((o) => o.kind)).toEqual(['area', 'rects'])
    const cards = cardCalc(links, [g], MODELS, nameOf)
    expect(cards['g'].areas).toHaveLength(1)
    expect(cards['g'].riemanns).toHaveLength(1)
  })
})

describe('the area readout', () => {
  it('states a closed form with = and the AP sign', () => {
    const r = areaReadout(
      { kind: 'area', id: 'L', parentId: 'g', from: 0, to: 2, abs: false },
      square(),
      MODELS,
    )
    expect(r.text).toBe('∫₀² = 2.667')
    expect(r.samples).toBeNull()
  })

  it('keeps the sign when the region is below the axis, and drops it for |area|', () => {
    const f = cubic() // x³ − 4x is negative on (0, 2)
    const signed = areaReadout(
      { kind: 'area', id: 'L', parentId: 'f', from: 0, to: 2, abs: false },
      f,
      MODELS,
    )
    expect(signed.value!).toBeLessThan(0)
    expect(signed.text.startsWith('∫₀² = −')).toBe(true)
    const magnitude = areaReadout(
      { kind: 'area', id: 'L', parentId: 'f', from: 0, to: 2, abs: true },
      f,
      MODELS,
    )
    expect(magnitude.value).toBeCloseTo(Math.abs(signed.value!), 9)
    expect(magnitude.text.startsWith('|∫₀²| =')).toBe(true)
  })

  it('refuses across a pole and names where it is', () => {
    const recip: FittedCurve = {
      id: 'r',
      modelId: 'recip',
      params: [1, 0, 0],
      kind: 'explicit',
      domain: null,
      color: '#f9a825',
      strokeWidth: 2.5,
      visible: true,
      error: 0,
    }
    const r = areaReadout(
      { kind: 'area', id: 'L', parentId: 'r', from: -1, to: 1, abs: false },
      recip,
      MODELS,
    )
    expect(r.value).toBeNull()
    expect(r.problem).toContain('pole')
    expect(r.problem).toContain('x =')
  })

  it('falls back to a bare integral sign when a limit is not a whole number', () => {
    expect(integralSymbol(0, 2)).toBe('∫₀²')
    expect(integralSymbol(0.5, 2)).toBe('∫')
    expect(integralSymbol(-1, 2)).toBe('∫')
  })

  it('an overlay is not drawn for a hidden curve', () => {
    const hidden = { ...square(), visible: false }
    expect(
      overlaysFor(
        [{ kind: 'area', id: 'A', parentId: 'g', from: 0, to: 2, abs: false }],
        [hidden],
        MODELS,
      ),
    ).toEqual([])
  })
})

describe('numbers a teacher reads', () => {
  it('uses a real minus sign and never prints a negative zero', () => {
    expect(fixed(-0.0001, 3)).toBe('0.000')
    expect(fixed(-1.5, 2)).toBe('−1.50')
    expect(fixed(2.6666666, 3)).toBe('2.667')
  })
})

describe('the projected legend says what a derived curve is', () => {
  const entries = [
    { id: 'f', color: '#4f9cf9', tex: 'y = x^{3} - 4x', text: 'Cubic' },
    { id: 'd', color: '#4f9cf9', tex: 'y = 3x^{2} - 4', text: 'Parabola' },
    { id: 't', color: '#4f9cf9', tex: 'y = 8x - 16', text: 'Line' },
  ]
  const links: CalcLink[] = [
    { kind: 'derivative', id: 'L2', parentId: 'f', curveId: 'd' },
    { kind: 'tangent', id: 'L1', parentId: 'f', curveId: 't', x: 2 },
  ]

  it("labels f′ and the tangent's point, and leaves f alone", () => {
    const out = labelLegend(entries, links)
    expect(out[0]).toEqual(entries[0])
    expect(out[1].tex).toContain("f'")
    expect(out[1].tex).toContain('3x^{2} - 4')
    expect(out[2].tex).toContain('tangent at }x = 2.00')
    expect(out[2].text).toBe('tangent at x = 2.00')
  })

  it('is a no-op on a board with no calculus objects', () => {
    expect(labelLegend(entries, [])).toEqual(entries)
  })
})

// ---------------------------------------------------------------------------
// defaultBounds — a fresh area must start on a window the curve is ON
// ---------------------------------------------------------------------------

describe('defaultBounds', () => {
  const sketched = (domain: [number, number]): FittedCurve => ({ ...cubic(), domain })

  it('opens on the whole of a sketched domain, end to end', () => {
    // Used to round outward to [-3.5, 4.5], which areaUnder refused as
    // "undefined on [-3.50, 4.50]".
    const [a, b] = defaultBounds(sketched([-3.42, 4.47]), [-10, 10])
    expect([a, b]).toEqual([-3.42, 4.47])
    expect(areaUnder(sketched([-3.42, 4.47]), MODELS, a, b)).not.toBeNull()
  })

  it('rounds the visible window INWARD to halves for a curve that is everywhere', () => {
    expect(defaultBounds(cubic(), [-3.42, 4.47])).toEqual([-3, 4])
    expect(defaultBounds(cubic(), [1.0000000001, 2.9999999999])).toEqual([1, 3])
  })

  it('falls back to the raw window when the halves inside it would collapse', () => {
    const [a, b] = defaultBounds(cubic(), [1.1, 1.4])
    expect(a).toBeCloseTo(1.1, 6)
    expect(b).toBeCloseTo(1.4, 6)
  })

  it('always yields limits the integral exists on', () => {
    for (const d of [[-3.42, 4.47], [0.26, 0.74], [-0.49, 5.01], [2.5, 2.51]] as [number, number][]) {
      const [a, b] = defaultBounds(sketched(d), [-10, 10])
      expect(areaUnder(sketched(d), MODELS, a, b)).not.toBeNull()
    }
  })
})

describe('followDomains — limits ride the ends of the sketch', () => {
  const sketched = (domain: [number, number] | null): FittedCurve => ({ ...cubic(), domain })
  const area = (from: number, to: number): AreaLink =>
    ({ kind: 'area', id: 'A', parentId: 'f', from, to, abs: false }) as AreaLink
  const prev = (d: [number, number] | null) => new Map([['f', d]])

  it('carries a limit that sat on an end when that end is dragged out', () => {
    const next = followDomains([area(-3.42, 4.47)], prev([-3.42, 4.47]), [sketched([-3.42, 6.1])])
    expect(next?.[0]).toMatchObject({ from: -3.42, to: 6.1 })
  })

  it('carries both ends, and a limit dragged in with the end', () => {
    const next = followDomains([area(-3.42, 4.47)], prev([-3.42, 4.47]), [sketched([-5, 2])])
    expect(next?.[0]).toMatchObject({ from: -5, to: 2 })
  })

  it('leaves a limit the teacher chose inside the sketch alone', () => {
    const next = followDomains([area(0, 2)], prev([-3.42, 4.47]), [sketched([-3.42, 6.1])])
    expect(next).toBeNull()
  })

  it('pulls an interior limit back when the sketch shrinks past it', () => {
    const next = followDomains([area(0, 4)], prev([-3.42, 4.47]), [sketched([-3.42, 3])])
    expect(next?.[0]).toMatchObject({ from: 0, to: 3 })
  })

  it('does nothing for a curve it has not seen before, or whose domain did not change', () => {
    expect(followDomains([area(-3.42, 4.47)], new Map(), [sketched([0, 1])])).toBeNull()
    expect(followDomains([area(-3.42, 4.47)], prev([-3.42, 4.47]), [sketched([-3.42, 4.47])])).toBeNull()
  })

  it('applies to Riemann sums and ignores tangents', () => {
    const r = { kind: 'riemann', id: 'R', parentId: 'f', from: -3.42, to: 4.47, n: 8, method: 'left' } as CalcLink
    const t = { kind: 'tangent', id: 'T', parentId: 'f', curveId: 't', x: -3.42 } as CalcLink
    const next = followDomains([r, t], prev([-3.42, 4.47]), [sketched([-4, 5])])
    expect(next?.[0]).toMatchObject({ from: -4, to: 5 })
    expect(next?.[1]).toBe(t)
  })
})

describe('areaReadout — a limit off the end of a sketch', () => {
  it('names the limit and the domain instead of a bare "undefined"', () => {
    const parent: FittedCurve = { ...cubic(), domain: [-3.42, 4.47] }
    const link = { kind: 'area', id: 'A', parentId: parent.id, from: -3.5, to: 4.5 } as AreaLink
    const r = areaReadout(link, parent, MODELS)
    expect(r.value).toBeNull()
    expect(r.problem).toBe("a = −3.50 is outside this curve's domain [−3.42, 4.47]")
  })
})


// ===========================================================================
// Area between two curves
//
// The mathematics is tested in tests/calculus.test.ts. What is tested here is
// the LINK: that a second curve reaches the readout, the shading, the card,
// the dependents and the file — and that losing it is reported rather than
// quietly turning the region into the area under f, which is a different
// region with a different number.
// ===========================================================================

/** y = 2 − x², the other half of the board's ±1 example. */
function capped(id = 'h'): FittedCurve {
  return {
    id,
    modelId: 'poly2',
    params: [2, 0, -1],
    kind: 'explicit',
    domain: null,
    color: '#f5a524',
    strokeWidth: 2.5,
    visible: true,
    error: 0,
  }
}

const between = (over: Partial<AreaLink> = {}): AreaLink => ({
  kind: 'area',
  id: 'B',
  parentId: 'g',
  otherId: 'h',
  from: -1,
  to: 1,
  abs: true,
  ...over,
})

describe('areaReadout between two curves', () => {
  it('reads ∫ (f − g) for the signed integral and ∫ |f − g| for the area', () => {
    const f = square()          // y = x²
    const g = capped()          // y = 2 − x²
    const signed = areaReadout(between({ abs: false }), f, MODELS, g)
    expect(signed.problem).toBeNull()
    expect(signed.text).toBe('∫ (f − g) = −2.667')
    expect(signed.value).toBeCloseTo(-8 / 3, 12)

    const area = areaReadout(between({ abs: true }), f, MODELS, g)
    expect(area.text).toBe('∫ |f − g| = 2.667')
    expect(area.value).toBeCloseTo(8 / 3, 12)
  })

  it('writes the bounds into the symbol when they are small whole numbers', () => {
    const r = areaReadout(between({ from: 0, to: 2, abs: false }), square(), MODELS, capped())
    expect(r.text.startsWith('∫₀² (f − g)')).toBe(true)
  })

  it('says ≈ and counts samples when the pair had to be integrated', () => {
    const sin: FittedCurve = { ...square(), id: 's', modelId: 'sine', params: [1, 1, 0, 0] }
    const cos: FittedCurve = { ...square(), id: 'c', modelId: 'sine', params: [1, 1, Math.PI / 2, 0] }
    const link = between({ parentId: 's', otherId: 'c', from: 0, to: Math.PI, abs: true })
    const r = areaReadout(link, sin, MODELS, cos)
    expect(r.text).toBe('∫ |f − g| ≈ 2.828')
    expect(r.value).toBeCloseTo(2 * Math.SQRT2, 9)
    expect(r.samples).toBeGreaterThan(0)
  })

  it('names the missing curve rather than reading out the area under f', () => {
    const r = areaReadout(between(), square(), MODELS, undefined)
    expect(r.value).toBeNull()
    expect(r.problem).toBe('the second curve is gone')
    expect(r.text).toBe('∫ |f − g| = —')
  })

  it('names WHICH domain a limit left', () => {
    const f = square()
    const g: FittedCurve = { ...capped(), domain: [-0.5, 0.5] }
    const r = areaReadout(between({ abs: false }), f, MODELS, g)
    expect(r.value).toBeNull()
    expect(r.problem).toBe("a = −1.00 is outside the second curve's domain [−0.50, 0.50]")
  })

  it('refuses across a pole of the second curve, naming it', () => {
    const recip: FittedCurve = { ...capped(), id: 'h', modelId: 'recip', params: [1, 0, 0] }
    const r = areaReadout(between({ from: -1, to: 2, abs: false }), square(), MODELS, recip)
    expect(r.value).toBeNull()
    expect(r.problem).toContain('pole at x = 0.00')
  })

  it('leaves the area-to-the-axis sentence exactly as it was', () => {
    const plain = { kind: 'area', id: 'A', parentId: 'g', from: 0, to: 2, abs: false } as AreaLink
    expect(areaReadout(plain, square(), MODELS).text).toBe('∫₀² = 2.667')
  })
})

describe('the overlay is shaded BETWEEN the curves', () => {
  it('passes the second curve through as the overlay’s other boundary', () => {
    const f = square()
    const g = capped()
    const out = overlaysFor([between()], [f, g], MODELS)
    expect(out).toEqual([{ kind: 'area', curveId: 'g', from: -1, to: 1, against: 'h' }])
  })

  it('draws nothing when the second curve is gone or hidden', () => {
    const f = square()
    expect(overlaysFor([between()], [f], MODELS)).toEqual([])
    const hidden: FittedCurve = { ...capped(), visible: false }
    expect(overlaysFor([between()], [f, hidden], MODELS)).toEqual([])
  })

  it('still shades to the axis for a link with no second curve', () => {
    const plain = { kind: 'area', id: 'A', parentId: 'g', from: 0, to: 2, abs: false } as AreaLink
    const out = overlaysFor([plain], [square()], MODELS)
    expect(out[0]).toEqual({ kind: 'area', curveId: 'g', from: 0, to: 2 })
    expect('against' in out[0]).toBe(false)
  })
})

describe('a between-link is a dependent of BOTH curves', () => {
  const links: CalcLink[] = [
    between(),
    { kind: 'area', id: 'A', parentId: 'g', from: 0, to: 1, abs: false },
  ]

  it('dies when the second curve is deleted', () => {
    const dead = dependentsOf(links, ['h'])
    expect([...dead.linkIds]).toEqual(['B'])
    expect([...dead.curveIds].sort()).toEqual(['h'])
  })

  it('still dies with its parent', () => {
    expect([...dependentsOf(links, ['g']).linkIds].sort()).toEqual(['A', 'B'])
  })

  it('is counted by the toast, like any other object', () => {
    const n = dependentsOf(links, ['h']).linkIds.size
    expect(countPhrase(n, 'object')).toBe('1 object')
  })
})

describe('defaultBetweenBounds', () => {
  const win: [number, number] = [-6, 6]

  it('opens on the outermost crossings in view', () => {
    const b = defaultBetweenBounds(square(), capped(), MODELS, win)
    expect(b[0]).toBeCloseTo(-1, 9)
    expect(b[1]).toBeCloseTo(1, 9)
  })

  it('gives one crossing a unit of room on each side', () => {
    // x and x² meet at 0 and 1; a window of [0.5, 6] sees only x = 1.
    const b = defaultBetweenBounds(square(), line('g', 0, 1), MODELS, [0.5, 6])
    expect(b).toEqual([0, 2])
  })

  it('clips that room to both domains', () => {
    const short: FittedCurve = { ...line('g', 0, 1), domain: [0.6, 1.4] }
    const b = defaultBetweenBounds(square(), short, MODELS, [0.5, 6])
    expect(b[0]).toBeCloseTo(0.6, 9)
    expect(b[1]).toBeCloseTo(1.4, 9)
  })

  it('falls back to the overlap of both domains, rounded inward to halves', () => {
    const a: FittedCurve = { ...square(), domain: [-3.42, 4.47] }
    const b: FittedCurve = { ...line('g', -1, 0), domain: [-1.2, 9] }  // y = −1: never met
    expect(defaultBetweenBounds(a, b, MODELS, win)).toEqual([-1, 4])
  })

  it('never opens on a window either curve is not on', () => {
    const a: FittedCurve = { ...square(), domain: [0, 2] }
    const b: FittedCurve = { ...line('g', -1, 0), domain: [1, 5] }
    const [from, to] = defaultBetweenBounds(a, b, MODELS, win)
    expect(from).toBeGreaterThanOrEqual(1)
    expect(to).toBeLessThanOrEqual(2)
  })
})

describe('followDomains clamps a between-link into both domains', () => {
  const dom = (f: [number, number] | null, g: [number, number] | null) => [
    { ...square(), domain: f },
    { ...capped(), domain: g },
  ]
  const prev2 = (
    f: [number, number] | null,
    g: [number, number] | null,
  ): Map<string, [number, number] | null> => new Map([['g', f], ['h', g]])

  it('pulls a limit back when the SECOND sketch shrinks past it', () => {
    const next = followDomains(
      [between({ from: -1, to: 1, abs: true })],
      prev2([-3, 3], [-3, 3]),
      dom([-3, 3], [-3, 0.4]),
    )
    expect(next?.[0]).toMatchObject({ from: -1, to: 0.4 })
  })

  it('carries a limit sitting on the edge of the overlap', () => {
    // b was ON the overlap's right end (the second curve's); extending that
    // curve takes b with it, up to where the FIRST curve now ends.
    const next = followDomains(
      [between({ from: -2, to: 2, abs: true })],
      prev2([-4, 4], [-2, 2]),
      dom([-4, 4], [-2, 3]),
    )
    expect(next?.[0]).toMatchObject({ from: -2, to: 3 })
  })

  it('does nothing while it has not seen both curves before', () => {
    const links = [between({ from: -1, to: 1 })]
    expect(followDomains(links, new Map([['g', [-3, 3] as [number, number]]]), dom([-3, 3], [-3, 0.4]))).toBeNull()
  })

  it('does nothing when neither domain moved', () => {
    expect(
      followDomains([between({ from: -1, to: 1 })], prev2([-3, 3], [-3, 3]), dom([-3, 3], [-3, 3])),
    ).toBeNull()
  })
})

describe('the card says which two curves', () => {
  it('hands the other curve’s label to the area row', () => {
    const f = square()
    const g = capped()
    const cards = cardCalc([between()], [f, g], MODELS, nameOf)
    const row = cards['g'].areas[0]
    expect(row.otherLabel).toBe(nameOf(g))
    expect(row.text).toBe('∫ |f − g| = 2.667')
    expect(row.problem).toBeNull()
    // The row lives on the PARENT's card, as every area row does.
    expect(cards['h'].areas).toEqual([])
  })

  it('leaves otherLabel off an ordinary area, and off a lost second curve', () => {
    const plain = { kind: 'area', id: 'A', parentId: 'g', from: 0, to: 2, abs: false } as AreaLink
    expect(cardCalc([plain], [square()], MODELS, nameOf)['g'].areas[0].otherLabel).toBeUndefined()
    const orphan = cardCalc([between()], [square()], MODELS, nameOf)['g'].areas[0]
    expect(orphan.otherLabel).toBeUndefined()
    expect(orphan.problem).toBe('the second curve is gone')
  })
})

describe('otherId survives the file', () => {
  it('round-trips with the second curve named', () => {
    const links: CalcLink[] = [between({ from: -1, to: 1, abs: true })]
    const input = board({ curves: [square(), capped()], calc: links })
    const res = deserializeDoc(serializeDoc(docFromBoard(META, input, 2000)))
    expect(res.problems).toEqual([])
    expect(res.board!.calc).toEqual(links)
  })

  it('writes otherId only when it is there', () => {
    const stored = boardToStored(
      board({
        curves: [square(), capped()],
        calc: [
          between({ id: 'B', from: -1, to: 1, abs: true }),
          { kind: 'area', id: 'A', parentId: 'g', from: 0, to: 2, abs: false },
        ],
      }),
    )
    expect(stored.calc![0]).toEqual({
      kind: 'area',
      id: 'B',
      parentId: 'g',
      otherId: 'h',
      from: -1,
      to: 1,
      abs: true,
    })
    expect('otherId' in stored.calc![1]).toBe(false)
  })

  it('is byte-identical for a document that never had one', () => {
    const plain = board({
      curves: [cubic(), square()],
      calc: [{ kind: 'area', id: 'A', parentId: 'g', from: 0, to: 2, abs: false }],
    })
    const before = '{"kind":"area","id":"A","parentId":"g","from":0,"to":2}'
    const text = serializeDoc(docFromBoard(META, plain, 2000))
    expect(text).toContain(before)
    expect(text).not.toContain('otherId')
  })

  it('drops the link and reports it when the second curve is not in the document', () => {
    const res = deserializeDoc(
      serializeDoc(
        createDoc(
          'Lesson',
          boardToStored(
            board({ curves: [square()], calc: [between({ otherId: 'vanished' })] }),
          ),
        ),
      ),
    )
    expect(res.board!.calc).toEqual([])
    expect(res.degraded).toBe(true)
    expect(res.problems.join(' ')).toContain('shaded area')
    expect(res.problems.join(' ')).toContain('second curve')
  })

  it('ignores an otherId that is not a usable id, keeping the area under f', () => {
    const raw = {
      version: 2,
      id: 'd',
      name: 'n',
      createdAt: 1,
      modifiedAt: 1,
      board: {
        curves: [square()],
        viewport: { cx: 0, cy: 0, ppu: 60 },
        selectedId: null,
        mode: 'draw',
        calc: [{ kind: 'area', id: 'A', parentId: 'g', otherId: 42, from: 0, to: 2 }],
      },
    }
    const res = deserializeDoc(JSON.stringify(raw))
    expect(res.board!.calc).toEqual([
      { kind: 'area', id: 'A', parentId: 'g', from: 0, to: 2, abs: false },
    ])
  })
})

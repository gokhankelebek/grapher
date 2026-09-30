// ============================================================================
// tests/accumulation.test.ts — F(x) = C + ∫ₐˣ f(t) dt, the AP free-response
// picture: the core model (closed form and closure), the link that stores it,
// and the sentences the cards say about it.
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { accumulationModel, tangentAt } from '../src/core/calculus'

const curve = (modelId: string, params: number[], over: Partial<FittedCurve> = {}): FittedCurve => ({
  id: 'f',
  modelId,
  params,
  kind: 'explicit',
  domain: null,
  color: '#4f9cf9',
  strokeWidth: 2.5,
  visible: true,
  error: 0,
  ...over,
})

/** A typed-expression-like model with no family: forces the closure. */
function exprSpec(id: string, f: (x: number) => number): ModelSpec {
  return {
    id,
    kind: 'explicit',
    name: 'Expression',
    evalExplicit: (_p, x) => f(x),
    latex: () => 'y = f(x)',
    paramMeta: () => [],
  }
}

function closureOf(f: (x: number) => number, a: number, C = 0, domain: [number, number] | null = null) {
  const spec = exprSpec('expr_1', f)
  const models = { ...MODELS, expr_1: spec }
  const parent = curve('expr_1', [], { domain })
  const acc = accumulationModel(parent, models, a, C, 'intf_L1')
  return { acc, models, parent }
}

describe('accumulationModel — closed form', () => {
  it('∫₀ˣ t² dt is x³/3 exactly, as a cubic', () => {
    const acc = accumulationModel(curve('poly2', [0, 0, 1]), MODELS, 0, 0, 'intf_L')!
    expect(acc.exact).toBe(true)
    expect(acc.spec.id).toBe('poly3')
    expect(acc.params).toEqual([0, 0, 0, 1 / 3])
  })

  it('x² − 1 from 0 is x³/3 − x', () => {
    const acc = accumulationModel(curve('poly2', [-1, 0, 1]), MODELS, 0, 0, 'intf_L')!
    expect(acc.spec.id).toBe('poly3')
    expect(acc.spec.evalExplicit!(acc.params, 2)).toBeCloseTo(2 / 3, 14)
  })

  it('honours the lower limit and C', () => {
    // g(x) = 5 + ∫₋₂ˣ 2t dt = 5 + x² − 4
    const acc = accumulationModel(curve('line', [0, 2]), MODELS, -2, 5, 'intf_L')!
    expect(acc.spec.id).toBe('poly2')
    for (const x of [-3, -2, 0, 1.5, 4]) {
      expect(acc.spec.evalExplicit!(acc.params, x)).toBeCloseTo(5 + x * x - 4, 12)
    }
    expect(acc.spec.evalExplicit!(acc.params, -2)).toBeCloseTo(5, 14)
  })

  it('a constant integrates to a line', () => {
    const acc = accumulationModel(curve('line', [3, 0]), MODELS, 1, 0, 'intf_L')!
    expect(acc.spec.id).toBe('line')
    expect(acc.spec.evalExplicit!(acc.params, 4)).toBeCloseTo(9, 14)
  })

  it('a TYPED polynomial integrates in closed form too: y = x^2 − 1 -> x³/3 − x', () => {
    const { acc } = closureOf((x) => x ** 2 - 1, 0)
    expect(acc!.exact).toBe(true)
    expect(acc!.spec.id).toBe('poly3')
    expect(acc!.params).toEqual([0, -1, 0, 1 / 3])
    // and a typed non-polynomial, or a piecewise one, is not mistaken for one
    expect(closureOf((x) => Math.sin(x), 0).acc!.exact).toBe(false)
    expect(closureOf((x) => (x < 50 ? x * x : 0), 0).acc!.exact).toBe(false)
    // a typed quartic is a polynomial, but its antiderivative is not in the library
    expect(closureOf((x) => x ** 4, 0).acc!.exact).toBe(false)
  })

  it('a quartic leaves the library (no poly5), so it is a closure — still right', () => {
    const acc = accumulationModel(curve('poly4', [0, 0, 0, 0, 1]), MODELS, 0, 0, 'intf_L')!
    expect(acc.exact).toBe(false)
    expect(acc.spec.id).toBe('intf_L')
    expect(acc.spec.evalExplicit!(acc.params, 1.7)).toBeCloseTo(1.7 ** 5 / 5, 9)
  })

  it('a·sin(bx + c) with no midline is a sinusoid; with one it is a closure', () => {
    const pure = accumulationModel(curve('sine', [2, 3, 0.5, 0]), MODELS, 0.25, 1, 'intf_L')!
    expect(pure.spec.id).toBe('sine')
    const F = (x: number) => 1 - (2 / 3) * (Math.cos(3 * x + 0.5) - Math.cos(3 * 0.25 + 0.5))
    for (const x of [-2, 0, 1.3]) expect(pure.spec.evalExplicit!(pure.params, x)).toBeCloseTo(F(x), 12)
    const lifted = accumulationModel(curve('sine', [2, 3, 0.5, 1]), MODELS, 0, 0, 'intf_L')!
    expect(lifted.exact).toBe(false)
    const G = (x: number) => -(2 / 3) * (Math.cos(3 * x + 0.5) - Math.cos(0.5)) + x
    expect(lifted.spec.evalExplicit!(lifted.params, 1.3)).toBeCloseTo(G(1.3), 9)
  })

  it('a·e^{bx} is an exponential; a/(x − b) right of its pole is a logarithm', () => {
    const e = accumulationModel(curve('exp', [1, 1, 0]), MODELS, 0, 0, 'intf_L')!
    expect(e.spec.id).toBe('exp')
    expect(e.spec.evalExplicit!(e.params, 2)).toBeCloseTo(Math.exp(2) - 1, 12)
    const r = accumulationModel(curve('recip', [1, 0, 0]), MODELS, 1, 0, 'intf_L')!
    expect(r.spec.id).toBe('log')
    expect(r.spec.evalExplicit!(r.params, 3)).toBeCloseTo(Math.log(3), 12)
    // and nothing at all across the pole
    expect(Number.isNaN(r.spec.evalExplicit!(r.params, -1))).toBe(true)
  })
})

describe('accumulationModel — the closure', () => {
  const cases: Array<[string, (t: number) => number, (x: number) => number]> = [
    ['sin t → 1 − cos x', Math.sin, (x) => 1 - Math.cos(x)],
    ['eᵗ → eˣ − 1', Math.exp, (x) => Math.exp(x) - 1],
    ['1/(1 + t²) → arctan x', (t) => 1 / (1 + t * t), Math.atan],
  ]
  for (const [name, f, F] of cases) {
    it(`${name}, to 1e-8 over [−5, 5]`, () => {
      const { acc } = closureOf(f, 0)
      expect(acc!.exact).toBe(false)
      let worst = 0
      for (let i = 0; i <= 400; i++) {
        const x = -5 + (10 * i) / 400 + 1e-3 * Math.sin(i) // off-grid too
        const got = acc!.spec.evalExplicit!(acc!.params, x)
        worst = Math.max(worst, Math.abs(got - F(x)) / Math.max(1, Math.abs(F(x))))
      }
      expect(worst).toBeLessThan(1e-8)
    })
  }

  it('F′ = f: a tangent to F (Richardson) has slope f(x)', () => {
    const f = (t: number) => Math.sin(t) + 0.3 * t * t
    const { acc } = closureOf(f, 0)
    const models = { ...MODELS, expr_1: exprSpec('expr_1', f), intf_L1: acc!.spec }
    const F = curve('intf_L1', acc!.params, { id: 'F' })
    for (const x of [-3.1, -0.7, 0.4, 1.9, 4.2]) {
      const t = tangentAt(F, models, x)
      expect(t).not.toBeNull()
      expect(t!.m).toBeCloseTo(f(x), 6)
    }
  })

  it('honours a and C', () => {
    const { acc } = closureOf(Math.cos, -1, 2.5)
    for (const x of [-4, -1, 0, 2]) {
      expect(acc!.spec.evalExplicit!(acc!.params, x)).toBeCloseTo(2.5 + Math.sin(x) - Math.sin(-1), 9)
    }
    expect(acc!.spec.evalExplicit!(acc!.params, -1)).toBe(2.5)
  })

  it('refuses the far side of a pole: ∫₁ˣ dt/t is NaN for x ≤ 0', () => {
    const { acc } = closureOf((t) => 1 / t, 1)
    const at = (x: number) => acc!.spec.evalExplicit!(acc!.params, x)
    expect(at(2)).toBeCloseTo(Math.log(2), 9)
    expect(at(0.25)).toBeCloseTo(Math.log(0.25), 8)
    for (const x of [0, -0.001, -0.5, -1, -3]) expect(Number.isNaN(at(x))).toBe(true)
  })

  it('refuses the far side of a pole it never samples exactly', () => {
    const { acc } = closureOf((t) => 1 / (t - 0.3001), 1)
    const at = (x: number) => acc!.spec.evalExplicit!(acc!.params, x)
    expect(at(0.5)).toBeCloseTo(Math.log((0.5 - 0.3001) / (1 - 0.3001)), 7)
    for (const x of [0.2, 0, -2]) expect(Number.isNaN(at(x))).toBe(true)
  })

  it('stops at a gap: ∫₁ˣ √t dt does not exist left of 0', () => {
    const { acc } = closureOf(Math.sqrt, 1)
    const at = (x: number) => acc!.spec.evalExplicit!(acc!.params, x)
    expect(at(4)).toBeCloseTo((2 / 3) * (8 - 1), 8)
    expect(Number.isNaN(at(-1))).toBe(true)
  })

  it('fills a removable hole: ∫₀ˣ sin(t)/t dt exists', () => {
    const { acc } = closureOf((t) => Math.sin(t) / t, 0)
    expect(acc).not.toBeNull()
    // Si(2) = 1.6054129768026948
    expect(acc!.spec.evalExplicit!(acc!.params, 2)).toBeCloseTo(1.6054129768026948, 8)
    expect(acc!.spec.evalExplicit!(acc!.params, -2)).toBeCloseTo(-1.6054129768026948, 8)
  })

  it('refuses a non-explicit parent, a outside the domain, and a at a pole', () => {
    expect(accumulationModel(curve('circle', [0, 0, 1], { kind: 'implicit' }), MODELS, 0, 0, 'i')).toBeNull()
    expect(accumulationModel(curve('poly2', [0, 0, 1], { domain: [1, 3] }), MODELS, 0, 0, 'i')).toBeNull()
    expect(closureOf((t) => 1 / t, 0).acc).toBeNull()
    expect(accumulationModel(curve('poly2', [0, 0, 1]), MODELS, Number.NaN, 0, 'i')).toBeNull()
  })

  it('rebuilds its table when the params change, and only then', () => {
    // f(t) = k·cos t, params [k] — a family-less model with one parameter
    const spec: ModelSpec = {
      id: 'expr_2',
      kind: 'explicit',
      name: 'Expression',
      evalExplicit: (p, x) => p[0] * Math.cos(x),
      latex: () => 'y = k\\cos x',
      paramMeta: () => [],
    }
    const models = { ...MODELS, expr_2: spec }
    const acc = accumulationModel(curve('expr_2', [2]), models, 0, 0, 'intf_K')!
    expect(acc.params).toEqual([2, 0, 0])
    const ev = (p: number[], x: number) => acc.spec.evalExplicit!(p, x)
    expect(ev(acc.params, 3)).toBeCloseTo(2 * Math.sin(3), 10)
    const b0 = acc.stats!().builds
    ev(acc.params, 1)
    ev(acc.params, -2)
    expect(acc.stats!().builds).toBe(b0)
    // k = 4 (same a, C): a new table, the new integral
    expect(ev([4, 0, 0], 3)).toBeCloseTo(4 * Math.sin(3), 10)
    expect(acc.stats!().builds).toBe(b0 + 1)
    // a moved to 1: ∫₁³ 4 cos t dt
    expect(ev([4, 1, 0], 3)).toBeCloseTo(4 * (Math.sin(3) - Math.sin(1)), 10)
    // and C is honoured
    expect(ev([4, 1, 10], 3)).toBeCloseTo(10 + 4 * (Math.sin(3) - Math.sin(1)), 10)
  })

  it('extends lazily, and coarsens rather than stalling far away', () => {
    const { acc } = closureOf(Math.cos, 0)
    const at = (x: number) => acc!.spec.evalExplicit!(acc!.params, x)
    expect(at(1)).toBeCloseTo(Math.sin(1), 10)
    const small = acc!.stats!().cells
    expect(at(40)).toBeCloseTo(Math.sin(40), 9)
    expect(acc!.stats!().cells).toBeGreaterThan(small)
    const t0 = performance.now()
    expect(at(900)).toBeCloseTo(Math.sin(900), 5)
    expect(performance.now() - t0).toBeLessThan(400)
  })

  it('is fast: build < 5 ms, 1000 points < 2 ms (best of several, as the other perf tests)', () => {
    const f = (t: number) => Math.sin(t) * Math.exp(-0.1 * t * t) + 0.2 * t
    const xs = Array.from({ length: 1000 }, (_, i) => -8 + (16 * i) / 999)
    let build = Infinity
    let run = Infinity
    for (let round = 0; round < 8; round++) {
      // a fresh closure each round (a different a), so every build is a real one
      const { acc } = closureOf(f, round * 0.01)
      let t0 = performance.now()
      acc!.spec.evalExplicit!(acc!.params, -8)
      acc!.spec.evalExplicit!(acc!.params, 8)
      build = Math.min(build, performance.now() - t0)
      t0 = performance.now()
      let s = 0
      for (const x of xs) s += acc!.spec.evalExplicit!(acc!.params, x)
      run = Math.min(run, performance.now() - t0)
      expect(Number.isFinite(s)).toBe(true)
    }
    expect(build, `build took ${build.toFixed(2)}ms`).toBeLessThan(5)
    expect(run, `1000 points took ${run.toFixed(3)}ms`).toBeLessThan(2)
  })
})

// ---------------------------------------------------------------------------
// The link, the file, the cards
// ---------------------------------------------------------------------------

import {
  boardToStored,
  createDoc,
  deserializeDoc,
  docFromBoard,
  serializeDoc,
} from '../src/core/persist'
import type { AccumulationLink, BoardInput, CalcLink, DocMeta } from '../src/core/persist'
import {
  accumColor,
  accumFacts,
  accumHead,
  accumReadout,
  cardCalc,
  defaultAccum,
  dependentsOf,
  labelLegend,
  overlaysFor,
  short,
} from '../src/ui/calcLinks'

const META: DocMeta = { id: 'doc1', name: 'Accumulation', createdAt: 1000, modifiedAt: 1000 }

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

/** f(x) = x² − 1, and g = ∫₀ˣ f as the cubic accumulationModel makes of it. */
function parabolaPair(link: Partial<AccumulationLink> = {}) {
  const f = curve('poly2', [-1, 0, 1])
  const L: AccumulationLink = { kind: 'accumulation', id: 'A', parentId: 'f', curveId: 'g', a: 0, C: 0, x: 2, ...link }
  const acc = accumulationModel(f, MODELS, L.a, L.C, 'intf_A')!
  const g = curve(acc.spec.id, acc.params, { id: 'g', color: accumColor(f.color) })
  return { f, g, L }
}

const nameOf = (c: FittedCurve): string => MODELS[c.modelId]?.name ?? c.modelId

describe('the accumulation link in a file', () => {
  it('round-trips, closed form and closure alike', () => {
    const { f, g, L } = parabolaPair({ C: 1.5, a: -2 })
    const s = exprSpec('expr_1', Math.cos)
    const p2 = curve('expr_1', [], { id: 'p2' })
    const acc2 = accumulationModel(p2, { ...MODELS, expr_1: s }, 0, 0, 'intf_B')!
    const g2 = curve('intf_B', acc2.params, { id: 'g2' })
    const links: CalcLink[] = [
      { ...L, a: -2, C: 1.5 },
      { kind: 'accumulation', id: 'B', parentId: 'p2', curveId: 'g2', a: 0, C: 0 },
    ]
    const input = board({ curves: [f, g, p2, g2], calc: links, exprSources: { p2: 'y = cos(x)' } })
    const res = deserializeDoc(serializeDoc(docFromBoard(META, input, 2000)))
    expect(res.board!.calc).toEqual(links)
    // the closure came back from the link alone, and means the same thing
    const rebuilt = res.board!.extraModels['intf_B']
    expect(rebuilt).toBeTruthy()
    expect(rebuilt.evalExplicit!(acc2.params, 1.2)).toBeCloseTo(Math.sin(1.2), 9)
  })

  it('writes only what it needs: no C when 0, no x when absent', () => {
    const { f, g } = parabolaPair()
    const stored = boardToStored(
      board({
        curves: [f, g],
        calc: [{ kind: 'accumulation', id: 'A', parentId: 'f', curveId: 'g', a: 0, C: 0 }],
      }),
    )
    expect(stored.calc![0]).toEqual({ kind: 'accumulation', id: 'A', parentId: 'f', curveId: 'g', a: 0 })
  })

  it('leaves a document without one byte-identical', () => {
    const f = curve('poly2', [-1, 0, 1])
    const plain = board({
      curves: [f],
      calc: [{ kind: 'area', id: 'R', parentId: 'f', from: 0, to: 2, abs: false }],
    })
    const text = serializeDoc(docFromBoard(META, plain, 2000))
    expect(text).toContain('{"kind":"area","id":"R","parentId":"f","from":0,"to":2}')
    expect(text).not.toContain('accumulation')
    expect(text).not.toContain('"a":')
    const round = serializeDoc(docFromBoard(META, deserializeDoc(text).board as never, 2000))
    expect(round).toBe(text)
  })

  it('validates on load: C and x default, a missing or junk is damage', () => {
    const raw = {
      version: 2,
      id: 'd',
      name: 'n',
      createdAt: 1,
      modifiedAt: 1,
      board: {
        // Each link draws its own curve: two links on one curve are refused
        // on load (tests/hardening-app.test.ts).
        curves: [
          curve('poly2', [-1, 0, 1]),
          curve('poly3', [0, -1, 0, 1 / 3], { id: 'g' }),
          curve('poly3', [0, -1, 0, 1 / 3], { id: 'h' }),
        ],
        viewport: { cx: 0, cy: 0, ppu: 60 },
        selectedId: null,
        mode: 'draw',
        calc: [
          { kind: 'accumulation', id: 'ok', parentId: 'f', curveId: 'g', a: 0 },
          { kind: 'accumulation', id: 'noA', parentId: 'f', curveId: 'g' },
          { kind: 'accumulation', id: 'badC', parentId: 'f', curveId: 'g', a: 0, C: 'x' },
          { kind: 'accumulation', id: 'badX', parentId: 'f', curveId: 'h', a: 0, x: 'nope' },
        ],
      },
    }
    const res = deserializeDoc(JSON.stringify(raw))
    expect(res.board!.calc).toEqual([
      { kind: 'accumulation', id: 'ok', parentId: 'f', curveId: 'g', a: 0, C: 0 },
      { kind: 'accumulation', id: 'badX', parentId: 'f', curveId: 'h', a: 0, C: 0 },
    ])
    expect(res.problems.join(' ')).toContain('2 damaged calculus objects')
  })

  it('a lost parent drops the link and says so', () => {
    const { g } = parabolaPair()
    const res = deserializeDoc(
      serializeDoc(
        createDoc(
          'Lesson',
          boardToStored(
            board({
              curves: [g],
              calc: [{ kind: 'accumulation', id: 'A', parentId: 'gone', curveId: 'g', a: 0, C: 0 }],
            }),
          ),
        ),
      ),
    )
    expect(res.board!.calc).toEqual([])
    expect(res.degraded).toBe(true)
    expect(res.problems.join(' ')).toContain('accumulation function')
  })
})

describe('the accumulation on the cards', () => {
  it('f = x² − 1 from 0: the head, and g(2) = 2/3 exactly', () => {
    const { f, g, L } = parabolaPair()
    expect(accumHead(L)).toBe('g(x) = ∫₀ˣ f(t) dt')
    expect(accumHead({ ...L, a: -2, C: 3 })).toBe('g(x) = 3 + ∫₋₂ˣ f(t) dt')
    const r = accumReadout(L, f, MODELS)
    expect(r.value).toBeCloseTo(2 / 3, 14)
    expect(r.text).toBe('g(2) = 2/3 (0.667)')
    // g(3) = 9 − 3 = 6: a number the decimal says exactly is not decorated
    expect(accumReadout({ ...L, x: 3 }, f, MODELS).text).toBe('g(3) = 6')
    const cards = cardCalc([L], [f, g], MODELS, nameOf, { f: 'f', g: 'g' })
    expect(cards['f'].accums).toHaveLength(1)
    expect(cards['f'].accums[0].text).toBe('g(2) = 2/3 (0.667)')
    expect(cards['g'].origin!.kind).toBe('accumulation')
    expect(cards['g'].origin!.lead).toBe('g(x) = ∫₀ˣ f(t) dt')
  })

  it('a closure reads ≈', () => {
    const s = exprSpec('expr_1', (t) => Math.sin(t) / t)
    const models = { ...MODELS, expr_1: s }
    const p = curve('expr_1', [])
    const L: AccumulationLink = { kind: 'accumulation', id: 'A', parentId: 'f', curveId: 'g', a: 0, C: 0, x: 2 }
    expect(accumReadout(L, p, models).text).toBe('g(2) ≈ 1.605')
  })

  it('the probe across a pole is refused in words', () => {
    const p = curve('recip', [1, 0, 0])
    const L: AccumulationLink = { kind: 'accumulation', id: 'A', parentId: 'f', curveId: 'g', a: 1, C: 0, x: -1 }
    const r = accumReadout(L, p, MODELS)
    expect(r.value).toBeNull()
    expect(r.problem).toContain('pole')
  })

  it('the AP connections for f = x² − 1', () => {
    const { f, L } = parabolaPair()
    const facts = accumFacts(L, f, MODELS)
    expect(facts[0]).toBe('g′(x) = f(x)')
    expect(facts).toContain('g increases where f > 0: (−∞, −1) ∪ (1, ∞)')
    expect(facts).toContain('g decreases where f < 0: (−1, 1)')
    expect(facts).toContain('relative max of g at x = −1 (f changes + to −)')
    expect(facts).toContain('relative min of g at x = 1 (f changes − to +)')
    expect(facts).toContain('g concave up where f is increasing: (0, ∞)')
    expect(facts).toContain('g concave down where f is decreasing: (−∞, 0)')
    expect(facts).toContain('inflection point of g at x = 0 (extrema of f)')
  })

  it('facts use the board letters and stop at a pole', () => {
    const p = curve('recip', [1, 0, 0])
    const L: AccumulationLink = { kind: 'accumulation', id: 'A', parentId: 'f', curveId: 'g', a: 1, C: 0 }
    const facts = accumFacts(L, p, MODELS, 'h', 'k')
    expect(facts[0]).toBe('h′(x) = k(x)')
    // 1/x > 0 everywhere h exists, which is (0, …) — never across the pole
    const inc = facts.find((s) => s.startsWith('h increases'))!
    expect(inc).toMatch(/^h increases where k > 0: \(0, /)
    expect(facts.some((s) => s.startsWith('h decreases'))).toBe(false)
  })

  it('shades a to x, split where f crosses the axis', () => {
    const { f, g, L } = parabolaPair()
    const ovs = overlaysFor([L], [f, g], MODELS)
    expect(ovs.map((o) => o.kind)).toEqual(['area', 'area'])
    const [neg, pos] = ovs as Array<{ from: number; to: number; alpha?: number }>
    expect(neg.from).toBe(0)
    expect(neg.to).toBeCloseTo(1, 9)
    expect(pos.to).toBe(2)
    expect(pos.alpha!).toBeGreaterThan(neg.alpha!)
    // no probe, no shading
    expect(overlaysFor([{ ...L, x: undefined }], [f, g], MODELS)).toEqual([])
    // backwards from a: f > 0 on [−2, −1] TAKES AWAY from g
    const back = overlaysFor([{ ...L, x: -2 }], [f, g], MODELS) as Array<{ from: number; alpha?: number }>
    expect(back[0].from).toBe(-2)
    expect(back[0].alpha!).toBeLessThan(back[1].alpha!)
  })

  it('the legend says what g is', () => {
    const { L } = parabolaPair()
    const out = labelLegend([{ id: 'g', color: '#fff', tex: 'y', text: 'y' }], [L])
    expect(out[0].text).toBe('∫ from 0 of f — y')
  })

  it('defaults to a = 0 and a probe at 2', () => {
    expect(defaultAccum(curve('poly2', [-1, 0, 1]), MODELS, [-8, 8])).toEqual({ a: 0, x: 2 })
    // 1/x cannot start at 0
    expect(defaultAccum(curve('recip', [1, 0, 0]), MODELS, [-8, 8])!.a).toBe(1)
    // a sketch on [1.2, 4.5] starts inside it
    const d = defaultAccum(curve('poly2', [0, 0, 1], { domain: [1.2, 4.5] }), MODELS, [-8, 8])!
    expect(d.a).toBeGreaterThanOrEqual(1.2)
  })

  it('goes with its parent, curve and all', () => {
    const links: CalcLink[] = [
      { kind: 'accumulation', id: 'A', parentId: 'f', curveId: 'g', a: 0, C: 0 },
      { kind: 'tangent', id: 'T', parentId: 'g', curveId: 't', x: 1 },
    ]
    const dead = dependentsOf(links, ['f'])
    expect([...dead.linkIds].sort()).toEqual(['A', 'T'])
    expect([...dead.curveIds].sort()).toEqual(['f', 'g', 't'])
  })

  it('lightens the colour and formats like a teacher', () => {
    expect(accumColor('#000000')).toBe('#737373')
    expect(accumColor('rgb(1,2,3)')).toBe('rgb(1,2,3)')
    expect(short(2)).toBe('2')
    expect(short(-1.5)).toBe('−1.5')
    expect(short(2 / 3)).toBe('2/3')
  })
})

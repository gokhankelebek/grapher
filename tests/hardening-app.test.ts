// ============================================================================
// tests/hardening-app.test.ts — regressions for the hardening pass over the
// calculus links, the loader and the card menu (2026-09-29 review).
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { parseExpression } from '../src/core/parse'
import {
  boundCalls,
  boardLetters,
  createResolver,
  dependencyKeys,
  lineEnv,
} from '../src/ui/nameLinks'
import {
  cardCalc,
  inverseTypedLine,
  labelLegend,
  overlaysFor,
  plainNumber,
  taylorTypedLine,
} from '../src/ui/calcLinks'
import type { BoardInput, CalcLink, LimitLink, SecantLink, TangentLink, VolumeLink } from '../src/core/persist'
import { boardToStored, deserializeDoc, storedToCalcLink, storedToRelatedRates, storedToSystem } from '../src/core/persist'
import { secantRow, solutionTex, solutionText } from '../src/ui/secantLinks'
import { limitRow } from '../src/ui/limitLinks'
import { volumeRow } from '../src/ui/volumeLinks'

// ---------------------------------------------------------------------------
// a tiny board: typed lines with live models, the way the App keeps them
// ---------------------------------------------------------------------------

function curve(id: string, over: Partial<FittedCurve> = {}): FittedCurve {
  return {
    id,
    modelId: 'poly2',
    params: [0, 0, 1],
    kind: 'explicit',
    domain: null,
    color: '#4f9cf9',
    strokeWidth: 2.5,
    visible: true,
    error: 0,
    ...over,
  }
}

function makeBoard() {
  const b = {
    curves: [] as FittedCurve[],
    names: {} as Record<string, string>,
    calls: {} as Record<string, string[]>,
    models: { ...MODELS } as Record<string, ModelSpec>,
    sources: {} as Record<string, string>,
  }
  const resolve = createResolver(() => ({ curves: b.curves, names: b.names, models: b.models }))
  let n = 0
  return Object.assign(b, {
    type(id: string, src: string, name: string): void {
      const lineCalls = boundCalls(src, { letters: boardLetters(b.names, b.calls, name) })
      const o = parseExpression(src, lineEnv(resolve, lineCalls, null))
      if (!o.ok) throw new Error(o.error)
      const modelId = `expr_${++n}`
      b.models = { ...b.models, [modelId]: o.plot.makeModel(modelId) }
      const old = b.curves.findIndex((c) => c.id === id)
      const next = curve(id, { modelId, params: o.plot.defaultParams.slice() })
      if (old >= 0) b.curves = b.curves.map((c) => (c.id === id ? next : c))
      else b.curves = [...b.curves, next]
      b.sources = { ...b.sources, [id]: src }
      if (lineCalls.length > 0) b.calls = { ...b.calls, [id]: lineCalls }
      b.names = { ...b.names, [id]: name }
    },
    deps(): Record<string, string> {
      return dependencyKeys(b.curves, b.names, b.calls)
    },
  })
}

// ---------------------------------------------------------------------------
// 1. a curve that calls another: every calc cache follows the callee
// ---------------------------------------------------------------------------

describe('calc answers on a curve that calls another curve', () => {
  it('the secant on p(x) = h(x) + 1 is re-measured when h is retyped', () => {
    const b = makeBoard()
    b.type('h', 'y = x^2', 'h')
    b.type('p', 'y = h(x) + 1', 'p')
    const link: SecantLink = { kind: 'secant', id: 's1', parentId: 'p', a: -2, b: 2 }
    const p = () => b.curves.find((c) => c.id === 'p')!
    const before = secantRow(link, p(), b.models, 'p', b.deps().p ?? '')
    expect(before.value).toBe('0')
    b.type('h', 'y = x^3', 'h')
    const after = secantRow(link, p(), b.models, 'p', b.deps().p ?? '')
    // (p(2) − p(−2))/4 = (9 − (−7))/4 = 4, and the secant is y = 4x + 1
    expect(after.value).toBe('4')
    expect(after.quotient?.text).toContain('(9 − (−7))')
    expect(after.line?.text.replace(/\s/g, '')).toContain('4')
  })

  it('cardCalc threads depKeys: card and overlays follow a retyped callee', () => {
    const b = makeBoard()
    b.type('h', 'y = x^2', 'h')
    b.type('p', 'y = h(x) + 1', 'p')
    const links: CalcLink[] = [
      { kind: 'secant', id: 's1', parentId: 'p', a: -2, b: 2 },
      { kind: 'limit', id: 'l1', parentId: 'p', a: 2 },
    ]
    const letters = { h: 'h', p: 'p' }
    const first = cardCalc(links, b.curves, b.models, () => 'p', letters, b.calls, {}, null, b.deps())
    expect(first.p.secants[0].value).toBe('0')
    expect(first.p.limits[0].head.text).toContain('= 5')
    b.type('h', 'y = x^3', 'h')
    const second = cardCalc(links, b.curves, b.models, () => 'p', letters, b.calls, {}, null, b.deps())
    expect(second.p.secants[0].value).toBe('4')
    expect(second.p.limits[0].head.text).toContain('= 9')
    // the board's secant line: through (−2, −7) and (2, 9)
    const ov = overlaysFor(links, b.curves, b.models, null, null, b.deps())
    const line = ov.find((o) => o.kind === 'line') as { at: { x: number; y: number }; slope: number } | undefined
    expect(line?.slope).toBe(4)
    expect(line?.at).toEqual({ x: -2, y: -7 })
  })

  it('the limit and its δ follow the callee', () => {
    const b = makeBoard()
    b.type('h', 'y = x^2', 'h')
    b.type('p', 'y = h(x) + 1', 'p')
    const link: LimitLink = { kind: 'limit', id: 'l1', parentId: 'p', a: 1, epsilon: true, eps: 0.5 }
    const p = () => b.curves.find((c) => c.id === 'p')!
    expect(limitRow(link, p(), b.models, 'p', b.deps().p ?? '').head.text).toContain('= 2')
    b.type('h', 'y = 3x', 'h')
    const r = limitRow(link, p(), b.models, 'p', b.deps().p ?? '')
    expect(r.head.text).toContain('= 4')
    // |3x + 1 − 4| < 0.5 ⇔ |x − 1| < 1/6
    expect(r.delta?.value).toBeCloseTo(1 / 6, 3)
  })

  it('the volume follows the callee (and the other curve of a region between)', () => {
    const b = makeBoard()
    b.type('h', 'y = x', 'h')
    b.type('p', 'y = h(x)', 'p')
    const link: VolumeLink = { kind: 'volume', id: 'v1', parentId: 'p', a: 0, b: 1, method: 'washer' }
    const p = () => b.curves.find((c) => c.id === 'p')!
    const v1 = volumeRow(link, p(), undefined, b.models, { deps: b.deps() })
    b.type('h', 'y = 2x', 'h')
    const v2 = volumeRow(link, p(), undefined, b.models, { deps: b.deps() })
    // π∫₀¹ x² = π/3, π∫₀¹ 4x² = 4π/3
    expect(v1.value).not.toEqual(v2.value)
  })
})

// ---------------------------------------------------------------------------
// 2. limit headlines: = only when the digits are the value
// ---------------------------------------------------------------------------

describe('limit headlines never print a rounding with "="', () => {
  const b = makeBoard()
  b.type('e', 'y = e^x', 'g')
  const g = b.curves[0]
  const row = (a: number) => limitRow({ kind: 'limit', id: 'l', parentId: g.id, a }, g, b.models, 'g')

  it('lim x→10 e^x is ≈ 22026.466, in the text and in the LaTeX', () => {
    const r = row(10)
    expect(r.head.text).not.toMatch(/= 22030/)
    expect(r.head.text).toContain('≈')
    expect(r.head.tex).toContain('\\approx')
    expect(r.head.tex).not.toContain('22030')
    expect(r.fa).not.toMatch(/= 22030/)
    expect(r.fa).toMatch(/≈ 22026\.46/)
  })

  it('f(15) is ≈ 3269017.372, not "= 3269000"', () => {
    const r = row(15)
    expect(r.fa).not.toContain('3269000')
    expect(r.fa).toContain('≈')
  })

  it('lim x→1 e^x ≈ 2.718 — never "= 2.718"', () => {
    const r = row(1)
    expect(r.head.text).not.toMatch(/= 2\.718/)
    expect(r.head.tex).not.toMatch(/= 2\.718/)
    expect(r.head.tex).toContain('\\approx 2.718')
  })

  it('an exact value keeps its =', () => {
    const c = makeBoard()
    c.type('q', 'y = x^2', 'f')
    const q = c.curves[0]
    const r = limitRow({ kind: 'limit', id: 'l', parentId: q.id, a: 3 }, q, c.models, 'f')
    expect(r.head.text).toContain('= 9')
    expect(r.head.tex).toContain('= 9')
    expect(r.fa).toBe('f(3) = 9')
  })
})

// ---------------------------------------------------------------------------
// 3. the secant names the endpoint that is actually undefined
// ---------------------------------------------------------------------------

describe('secant at a hole', () => {
  it('(x^2 − 1)/(x − 1) on [1, 3] is undefined at x = 1, not x = 3', () => {
    const b = makeBoard()
    b.type('f', 'y = (x^2-1)/(x-1)', 'f')
    const f = b.curves[0]
    const r = secantRow({ kind: 'secant', id: 's', parentId: f.id, a: 1, b: 3 }, f, b.models, 'f')
    expect(r.problem).toContain('undefined at x = 1')
    expect(r.problem).not.toContain('x = 3')
    const r2 = secantRow({ kind: 'secant', id: 's', parentId: f.id, a: 3, b: 1 }, f, b.models, 'f')
    expect(r2.problem).toContain('undefined at x = 1')
  })
})

// ---------------------------------------------------------------------------
// 4. a duplicate of a derived curve is frozen as a typed line
// ---------------------------------------------------------------------------

describe('frozen copies', () => {
  const evalLine = (line: string, x: number): number => {
    const o = parseExpression(line)
    if (!o.ok) throw new Error(`${line}: ${o.error}`)
    const spec = o.plot.makeModel('probe')
    return spec.evalExplicit!(o.plot.defaultParams, x)
  }

  it('plainNumber never writes an exponent', () => {
    expect(plainNumber(3)).toBe('3')
    expect(plainNumber(-0.25)).toBe('-0.25')
    expect(plainNumber(1.5e-7)).not.toMatch(/e/i)
    expect(Number(plainNumber(1.5e-7))).toBeCloseTo(1.5e-7, 20)
    expect(plainNumber(1e22)).not.toMatch(/e/i)
  })

  it('P₅ of sin about 0 is the same polynomial', () => {
    const coeffs = [0, 1, 0, -1 / 6, 0, 1 / 120]
    const line = taylorTypedLine({ a: 0, coeffs })
    expect(line).toBe('y = x - x^3/6 + x^5/120')
    for (const x of [-2, -0.5, 0, 0.7, 1.9]) {
      expect(evalLine(line, x)).toBeCloseTo(x - x ** 3 / 6 + x ** 5 / 120, 12)
    }
  })

  it('P₃ about a = 1 and a = π/6 read back exactly, decimals at full precision', () => {
    const c1 = [Math.E, Math.E, Math.E / 2, Math.E / 6]
    const l1 = taylorTypedLine({ a: 1, coeffs: c1 })
    const p1 = (x: number) => c1.reduce((s, c, k) => s + c * (x - 1) ** k, 0)
    for (const x of [-1, 0, 1, 2.5]) expect(evalLine(l1, x)).toBeCloseTo(p1(x), 10)
    const a = Math.PI / 6
    const c2 = [0.5, Math.sqrt(3) / 2, -0.25, -Math.sqrt(3) / 12]
    const l2 = taylorTypedLine({ a, coeffs: c2 })
    expect(l2).toContain('pi/6')
    const p2 = (x: number) => c2.reduce((s, c, k) => s + c * (x - a) ** k, 0)
    for (const x of [-1, 0, 0.5, 2]) expect(evalLine(l2, x)).toBeCloseTo(p2(x), 10)
    expect(taylorTypedLine({ a: -2, coeffs: [0, 0, 0] })).toBe('y = 0')
    expect(taylorTypedLine({ a: -2, coeffs: [1, -3] })).toBe('y = 1 - 3(x + 2)')
  })

  it('an inverse relation freezes as a parametric (f(t), t)', () => {
    const line = inverseTypedLine('y = x^2 + 1', [-2, 2])
    expect(line).toBe('(t^2 + 1, t) {-2 <= t <= 2}')
    const o = parseExpression(line!)
    expect(o.ok).toBe(true)
    if (o.ok) expect(o.plot.kind).toBe('parametric')
    expect(inverseTypedLine('f(x) = exp(x)', [0, 1])).toBe('(exp(t), t) {0 <= t <= 1}')
    expect(inverseTypedLine('x^2 + y^2 = 4', [0, 1])).toBeNull()
    expect(inverseTypedLine('y = x^2', null)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 6. a hidden parent keeps its own letter
// ---------------------------------------------------------------------------

describe('a hidden parent is not "f"', () => {
  it('secant, limit and volume on a hidden h say h', () => {
    const b = makeBoard()
    b.type('f0', 'y = x', 'f')
    b.type('h', 'y = x^2', 'h')
    b.curves = b.curves.map((c) => (c.id === 'h' ? { ...c, visible: false } : c))
    const links: CalcLink[] = [
      { kind: 'secant', id: 's', parentId: 'h', a: 0, b: 2 },
      { kind: 'limit', id: 'l', parentId: 'h', a: 1 },
      { kind: 'volume', id: 'v', parentId: 'h', a: 0, b: 1, method: 'washer' },
    ]
    // the board's letters leave the hidden h out; the card's names keep it
    const cards = cardCalc(links, b.curves, b.models, () => 'x', { f0: 'f' }, {}, {}, null, {}, { f0: 'f', h: 'h' })
    expect(cards.h.secants[0].fName).toBe('h')
    expect(cards.h.limits[0].fName).toBe('h')
    expect(cards.h.volumes[0].fName).toBe('h')
  })
})

// ---------------------------------------------------------------------------
// 12. an implicit tangent's legend names the point
// ---------------------------------------------------------------------------

describe('implicit tangent legend', () => {
  it('reads "tangent at (1, 2)", not "tangent at x = 1.00"', () => {
    const link: TangentLink = { kind: 'tangent', id: 't', parentId: 'c', curveId: 'L', x: 1, y: 2 }
    const [e] = labelLegend([{ id: 'L', color: '#fff', tex: 'y = x', text: 'y = x' }], [link])
    expect(e.text).toBe('tangent at (1, 2)')
    expect(e.tex).not.toContain('x = 1.00')
    const explicit: TangentLink = { kind: 'tangent', id: 't', parentId: 'c', curveId: 'L', x: 1 }
    const [e2] = labelLegend([{ id: 'L', color: '#fff', tex: 'y = x', text: 'y = x' }], [explicit])
    expect(e2.text).toBe('tangent at x = 1.00')
  })
})

// ---------------------------------------------------------------------------
// the loader: 5 (self / shared curve links), 9 (damaged related rates and
// system fields reported), 10 (ε and the slice held in range)
// ---------------------------------------------------------------------------

function input(over: Partial<BoardInput> = {}): BoardInput {
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

function load(board: Record<string, unknown>) {
  return deserializeDoc(JSON.stringify({ version: 2, id: 'd', name: 'n', createdAt: 1, modifiedAt: 1, board }))
}

describe('the loader refuses curve links that would fight over a curve', () => {
  const f = curve('f', { modelId: 'poly2', params: [0, 0, 1] })
  const p = curve('p', { modelId: 'poly2', params: [0, 0, 1] })

  it('a Taylor link whose curveId is its own parentId is dropped, and the parent survives', () => {
    const stored = boardToStored(input({ curves: [f] }))
    const res = load({ ...stored, calc: [{ kind: 'taylor', id: 'T', parentId: 'f', curveId: 'f', a: 0, n: 3 }] })
    expect(res.board!.calc).toEqual([])
    expect(res.board!.curves.map((c) => c.id)).toEqual(['f'])
    expect(res.board!.curves[0].modelId).toBe('poly2')
    expect(res.degraded).toBe(true)
    expect(res.problems.join(' ')).toMatch(/Taylor polynomial was dropped/)
  })

  it('two curve links on one curveId: the second is dropped and reported', () => {
    const stored = boardToStored(input({ curves: [f, p] }))
    const res = load({
      ...stored,
      calc: [
        { kind: 'derivative', id: 'D', parentId: 'f', curveId: 'p' },
        { kind: 'tangent', id: 'L', parentId: 'f', curveId: 'p', x: 1 },
      ],
    })
    expect(res.board!.calc.map((l) => l.id)).toEqual(['D'])
    expect(res.degraded).toBe(true)
    expect(res.problems.join(' ')).toMatch(/already drawn by another calculus object/)
  })
})

describe('ε and the volume slice are held in range on load', () => {
  it('ε = 1e300 is clamped to the card’s 2; a tiny ε to 0.01', () => {
    const big = storedToCalcLink({ kind: 'limit', id: 'l', parentId: 'f', a: 1, epsilon: true, eps: 1e300 }) as LimitLink
    expect(big.eps).toBe(2)
    const tiny = storedToCalcLink({ kind: 'limit', id: 'l', parentId: 'f', a: 1, epsilon: true, eps: 1e-9 }) as LimitLink
    expect(tiny.eps).toBe(0.01)
    const ok = storedToCalcLink({ kind: 'limit', id: 'l', parentId: 'f', a: 1, epsilon: true, eps: 0.25 }) as LimitLink
    expect(ok.eps).toBe(0.25)
  })

  it('a slice in dx is clamped into [a, b]; a slice in dy (a height) is left for the board', () => {
    const v = storedToCalcLink({ kind: 'volume', id: 'v', parentId: 'f', a: 0, b: 2, method: 'washer', x: 50 }) as VolumeLink
    expect(v.x).toBe(2)
    const w = storedToCalcLink({ kind: 'volume', id: 'v', parentId: 'f', a: 2, b: 0, method: 'washer', x: -3 }) as VolumeLink
    expect(w.x).toBe(0)
    const shellsAboutY = storedToCalcLink({
      kind: 'volume', id: 'v', parentId: 'f', a: 0, b: 2, method: 'shell', axis: { dir: 'v', at: 0 }, x: 9,
    }) as VolumeLink
    expect(shellsAboutY.x).toBe(2)
    const washersAboutV = storedToCalcLink({
      kind: 'volume', id: 'v', parentId: 'f', a: 0, b: 2, method: 'washer', axis: { dir: 'v', at: 0 }, x: 9,
    }) as VolumeLink
    expect(washersAboutV.x).toBe(9)
  })
})

describe('damaged related-rates and system fields are reported, not fixed silently', () => {
  const good = { id: 'r', scenario: 'ladder', params: {}, t: 1 }

  it('a clean problem reports nothing', () => {
    const problems: string[] = []
    const out = storedToRelatedRates(good, problems)
    expect('rr' in out).toBe(true)
    expect(problems).toEqual([])
  })

  it('bad t, when, pause, graph, colour and givens are each reported', () => {
    const problems: string[] = []
    const out = storedToRelatedRates(
      { ...good, t: 'soon', when: { q: 'nope', v: 1 }, pause: 'yes', graph: 0, color: 'banana', params: 'x' },
      problems,
    )
    expect('rr' in out).toBe(true)
    if ('rr' in out) {
      expect(out.rr.t).toBe(0)
      expect(out.rr.color).toBe('#38bdf8')
      expect(out.rr.when).toBeUndefined()
    }
    const all = problems.join(' ')
    for (const word of ['instant t', '“when”', 'pause', 'graph', 'colour', 'givens']) expect(all).toContain(word)
  })

  it('a colour must be a colour; a real one is kept', () => {
    const p1: string[] = []
    const a = storedToRelatedRates({ ...good, color: 'url(javascript:1)' }, p1)
    expect('rr' in a && a.rr.color).toBe('#38bdf8')
    expect(p1.length).toBe(1)
    const p2: string[] = []
    const b = storedToRelatedRates({ ...good, color: '#ff8800' }, p2)
    expect('rr' in b && b.rr.color).toBe('#ff8800')
    expect(p2).toEqual([])
  })

  it('an out-of-range given is clamped and reported', () => {
    const problems: string[] = []
    storedToRelatedRates({ ...good, params: { L: 1e9 } }, problems)
    expect(problems.join(' ')).toMatch(/out of range/)
  })

  it('the system reports a bad test point, objective, and switches', () => {
    const problems: string[] = []
    const sys = storedToSystem(
      { solution: 'on', test: { x: 'a', y: 1 }, objective: { src: 'P = x + y', goal: 'most' }, iso: 1 },
      problems,
    )
    expect(sys).toEqual({ objective: { src: 'P = x + y', goal: 'max' } })
    const all = problems.join(' ')
    for (const word of ['solution-region', 'test point', 'goal', 'iso-profit']) expect(all).toContain(word)
    const clean: string[] = []
    storedToSystem({ solution: true, test: { x: 1, y: 2 } }, clean)
    expect(clean).toEqual([])
  })

  it('a whole document marks itself degraded when those fields are damaged', () => {
    const stored = boardToStored(input())
    const res = load({ ...stored, relatedRates: { ...good, color: 'banana' }, system: { iso: 'yes' } })
    expect(res.degraded).toBe(true)
    expect(res.problems.join(' ')).toMatch(/related-rates problem’s colour/)
    expect(res.problems.join(' ')).toMatch(/inequality system’s iso-profit/)
  })
})

// ---------------------------------------------------------------------------
// a piecewise MVT stretch is an open interval
// ---------------------------------------------------------------------------

describe('a stretch of c is written as an open interval', () => {
  it('{x², x < 1; 2x, x ≥ 1} on [0, 2]: "every c in (1, 2)"', () => {
    const b = makeBoard()
    b.type('f', 'y = {x^2, x<1; 2x, x>=1}', 'f')
    const f = b.curves[0]
    const r = secantRow({ kind: 'secant', id: 's', parentId: f.id, a: 0, b: 2, mvt: true }, f, b.models, 'f')
    expect(r.theorem?.points).toContain('every c in (1, 2)')
    expect(r.theorem?.points).not.toContain('from 1 to 2')
  })

  it('text and TeX agree', () => {
    const s = { x: 1, exact: { text: '1', tex: '1', value: 1 }, to: 2, toExact: { text: '2', tex: '2', value: 2 } }
    expect(solutionText(s, 'every c')).toBe('every c in (1, 2)')
    expect(solutionTex(s, 'every c')).toBe('\\text{every } c \\in \\left(1, 2\\right)')
    expect(solutionText({ x: 0.5, exact: null })).toBe('c ≈ 0.5')
    expect(solutionTex({ x: -0.5, exact: null })).toBe('c \\approx -0.5')
  })
})

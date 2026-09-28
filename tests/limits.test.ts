// ============================================================================
// tests/limits.test.ts — the limits engine (src/core/limits.ts): one-sided and
// two-sided limits, f(a), the classification, the AP checklist, limits at ±∞,
// the table of values and ε–δ.
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { FittedCurve } from '../src/core/types'
import { CURVE_COLORS } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { parseExpression } from '../src/core/parse'
import {
  deltaFor,
  limitAt,
  limitPoints,
  limitSourceOf,
  limitTable,
  reachFrom,
  tableNumber,
} from '../src/core/limits'
import type { LimitOutcome, LimitSource } from '../src/core/limits'

function src(expr: string, domain: [number, number] | null = null): LimitSource {
  const out = parseExpression(expr)
  if (!out.ok) throw new Error(out.error)
  const spec = out.plot.makeModel('expr_1')
  const curve: FittedCurve = {
    id: 'f',
    modelId: 'expr_1',
    params: out.plot.defaultParams.slice(),
    kind: 'explicit',
    domain,
    color: CURVE_COLORS[0],
    strokeWidth: 2.5,
    visible: true,
    error: 0,
  }
  const s = limitSourceOf(curve, { ...MODELS, expr_1: spec })
  if (!s) throw new Error('no source')
  return s
}

/** "6", "1/4", "π/2", "+∞", "−∞", "DNE:oscillates", "unknown", "≈0.693" */
function say(o: LimitOutcome | null): string {
  if (!o) return '—'
  if (o.value === 'DNE') return `DNE:${o.why}`
  if (o.value === 'unknown') return 'unknown'
  if (o.value === Infinity) return '+∞'
  if (o.value === -Infinity) return '−∞'
  if (o.exact) return o.exact.text
  return `≈${o.value.toFixed(3)}`
}

describe('limits at a point — the AP list', () => {
  it('sin(x)/x at 0 → 1 (the jet’s c₀ across 0/0): a hole', () => {
    const r = limitAt(src('y = sin(x)/x'), 0)
    expect([say(r.left), say(r.right), say(r.two)]).toEqual(['1', '1', '1'])
    expect(r.two.approx).toBe(false)
    expect(r.fa).toBeNull()
    expect(r.kind).toBe('removable')
    expect(r.checklist).toEqual([false, true, false])
  })

  it('(x² − 9)/(x − 3) at 3 → 6', () => {
    const r = limitAt(src('y = (x^2-9)/(x-3)'), 3)
    expect(say(r.two)).toBe('6')
    expect(r.kind).toBe('removable')
  })

  it('(1 − cos x)/x at 0 → 0, and (1 − cos x)/x² → 1/2', () => {
    expect(say(limitAt(src('y = (1-cos(x))/x'), 0).two)).toBe('0')
    expect(say(limitAt(src('y = (1-cos(x))/x^2'), 0).two)).toBe('1/2')
  })

  it('(√(x+4) − 2)/x at 0 → 1/4', () => {
    const r = limitAt(src('y = (sqrt(x+4)-2)/x'), 0)
    expect(say(r.two)).toBe('1/4')
    expect(r.two.value).toBe(0.25)
  })

  it('floor(x) at 2: left 1, right 2, DNE — a jump; f(2) = 2', () => {
    const r = limitAt(src('y = floor(x)'), 2)
    expect([say(r.left), say(r.right), say(r.two)]).toEqual(['1', '2', 'DNE:sides-differ'])
    expect(r.fa?.value).toBe(2)
    expect(r.kind).toBe('jump')
    expect(r.checklist).toEqual([true, false, false])
  })

  it('1/x² at 0 → +∞ from both sides: infinite', () => {
    const r = limitAt(src('y = 1/x^2'), 0)
    expect([say(r.left), say(r.right), say(r.two)]).toEqual(['+∞', '+∞', '+∞'])
    expect(r.kind).toBe('infinite')
    expect(r.fa).toBeNull()
  })

  it('1/x at 0: −∞ from the left, +∞ from the right, DNE', () => {
    const r = limitAt(src('y = 1/x'), 0)
    expect([say(r.left), say(r.right), say(r.two)]).toEqual(['−∞', '+∞', 'DNE:infinite-signs'])
    expect(r.kind).toBe('infinite')
  })

  it('x·sin(1/x) at 0 → 0 (squeezed), sin(1/x) at 0 oscillates', () => {
    expect(say(limitAt(src('y = x*sin(1/x)'), 0).two)).toBe('0')
    const r = limitAt(src('y = sin(1/x)'), 0)
    expect([say(r.left), say(r.right), say(r.two)]).toEqual(['DNE:oscillates', 'DNE:oscillates', 'DNE:oscillates'])
    expect(r.two.bounded).toBe(true)
    expect(r.kind).toBe('oscillating')
  })

  it('√x at 0: undefined on the left — an endpoint, continuous from the right', () => {
    const r = limitAt(src('y = sqrt(x)'), 0)
    expect([say(r.left), say(r.right), say(r.two)]).toEqual(['DNE:undefined', '0', 'DNE:one-sided'])
    expect(r.kind).toBe('endpoint')
    expect(r.liveSide).toBe(1)
    expect(r.checklist).toEqual([true, true, true])
  })

  it('outside the domain entirely: √x at −1', () => {
    const r = limitAt(src('y = sqrt(x)'), -1)
    expect(say(r.two)).toBe('DNE:undefined')
    expect(r.kind).toBe('undefined')
  })

  it('continuous points: x² at 2, |x| at 0, ∛x at 0, sin x at π', () => {
    for (const [e, a, L] of [
      ['y = x^2', 2, '4'],
      ['y = abs(x)', 0, '0'],
      ['y = x^(1/3)', 0, '0'],
      ['y = sin(x)', Math.PI, '0'],
    ] as const) {
      const r = limitAt(src(e), a)
      expect(say(r.two)).toBe(L)
      expect(r.kind).toBe('continuous')
      expect(r.checklist).toEqual([true, true, true])
    }
  })

  it('a written exclusion is undefined there, and a defined point that differs is still removable', () => {
    const ex = limitAt(src('y = x^2 {x != 2}'), 2)
    expect(ex.fa).toBeNull()
    expect(ex.kind).toBe('removable')
    const moved = limitAt(src('y = {x^2 if x < 2, 1 if x = 2, x^2 if x > 2}'), 2)
    expect(say(moved.two)).toBe('4')
    expect(moved.fa?.value).toBe(1)
    expect(moved.kind).toBe('removable')
    expect(moved.checklist).toEqual([true, true, false])
  })

  it('a piecewise jump, and a limit with no closed form says ≈', () => {
    const j = limitAt(src('y = {x if x < 1, x + 2 if x >= 1}'), 1)
    expect([say(j.left), say(j.right)]).toEqual(['1', '3'])
    expect(j.fa?.value).toBe(3)
    const ln2 = limitAt(src('y = (2^x - 1)/x'), 0).two
    expect(ln2.value as number).toBeCloseTo(Math.LN2, 9)
    expect(ln2.exact).toBeNull()
  })

  it('honest when the numbers do not settle: 1/ln|x| at 0 is unknown, not 0', () => {
    const r = limitAt(src('y = 1/ln(abs(x))'), 0)
    expect(r.two.value).toBe('unknown')
    expect(r.kind).toBe('unknown')
  })

  it('ln x at 0⁺ → −∞ at the domain’s end', () => {
    const r = limitAt(src('y = ln(x)'), 0)
    expect(say(r.right)).toBe('−∞')
    expect(r.kind).toBe('infinite')
  })
})

describe('limits at ±∞', () => {
  it('(2x² + 1)/(x² − 3) → 2', () => {
    const r = limitAt(src('y = (2x^2+1)/(x^2-3)'), Infinity)
    expect(say(r.two)).toBe('2')
    expect(r.kind).toBe('infinity')
    expect(r.left).toBeNull()
    expect(r.checklist).toBeNull()
    expect(say(limitAt(src('y = (2x^2+1)/(x^2-3)'), -Infinity).two)).toBe('2')
  })

  it('e^(−x) → 0 at ∞ and → +∞ at −∞; e^x → 0 at −∞', () => {
    expect(say(limitAt(src('y = e^(-x)'), Infinity).two)).toBe('0')
    expect(say(limitAt(src('y = e^(-x)'), -Infinity).two)).toBe('+∞')
    expect(say(limitAt(src('y = e^x'), -Infinity).two)).toBe('0')
  })

  it('sin x oscillates (bounded); x·sin x oscillates without bound; ln x → ∞', () => {
    const s = limitAt(src('y = sin(x)'), Infinity).two
    expect(say(s)).toBe('DNE:oscillates')
    expect(s.bounded).toBe(true)
    const xs = limitAt(src('y = x*sin(x)'), Infinity).two
    expect(say(xs)).toBe('DNE:oscillates')
    expect(xs.bounded).toBe(false)
    expect(say(limitAt(src('y = ln(x)'), Infinity).two)).toBe('+∞')
  })

  it('closed forms at ∞: arctan → π/2, √(x² + x) − x → 1/2, x³ at −∞ → −∞', () => {
    expect(say(limitAt(src('y = atan(x)'), Infinity).two)).toBe('π/2')
    expect(say(limitAt(src('y = sqrt(x^2+x)-x'), Infinity).two)).toBe('1/2')
    expect(say(limitAt(src('y = x^3'), -Infinity).two)).toBe('−∞')
  })

  it('a bounded domain has no ∞ to approach', () => {
    expect(say(limitAt(src('y = x', [0, 5]), Infinity).two)).toBe('DNE:undefined')
  })
})

describe('the table of values', () => {
  it('(x² − 9)/(x − 3) at 3: a ± 0.1 … 0.0001, farthest first', () => {
    const t = limitTable(src('y = (x^2-9)/(x-3)'), 3)
    expect(t.left!.map((r) => [r.xText, r.yText])).toEqual([
      ['2.9', '5.9'],
      ['2.99', '5.99'],
      ['2.999', '5.999'],
      ['2.9999', '5.9999'],
    ])
    expect(t.right!.map((r) => [r.xText, r.yText])).toEqual([
      ['3.1', '6.1'],
      ['3.01', '6.01'],
      ['3.001', '6.001'],
      ['3.0001', '6.0001'],
    ])
  })

  it('one side only, when asked; negatives with a real minus', () => {
    const t = limitTable(src('y = 1/x'), 0, 'left')
    expect(t.right).toBeNull()
    expect(t.left!.map((r) => [r.xText, r.yText])).toEqual([
      ['−0.1', '−10'],
      ['−0.01', '−100'],
      ['−0.001', '−1000'],
      ['−0.0001', '−10000'],
    ])
  })

  it('never rounds an approach onto its limit: sin(x)/x near 0', () => {
    const t = limitTable(src('y = sin(x)/x'), 0)
    expect(t.right!.map((r) => r.yText)).toEqual(['0.9983342', '0.9999833', '0.9999998', '0.999999998'])
    // x² at 2: 1.999² = 3.996001, all of it
    expect(limitTable(src('y = x^2'), 2).left![2].yText).toBe('3.996001')
  })

  it('toward ∞: x = 10, 100, … 10⁵; toward −∞ the negatives', () => {
    const t = limitTable(src('y = (2x^2+1)/(x^2-3)'), Infinity)
    expect(t.left).toBeNull()
    expect(t.right!.map((r) => r.xText)).toEqual(['10', '100', '1000', '10000', '100000'])
    expect(t.right![0].yText).toBe('2.072165')
    const n = limitTable(src('y = e^x'), -Infinity)
    expect(n.right).toBeNull()
    expect(n.left!.map((r) => r.xText)).toEqual(['−10', '−100', '−1000', '−10000', '−100000'])
  })

  it('undefined cells say so; big and tiny values go to e-notation', () => {
    expect(limitTable(src('y = sqrt(x)'), 0).left!.every((r) => r.yText === 'undefined')).toBe(true)
    expect(tableNumber(1.5e9)).toBe('1.5e9')
    expect(tableNumber(-2.5e-8)).toBe('−2.5e−8')
    expect(tableNumber(0)).toBe('0')
  })
})

describe('ε–δ', () => {
  it('x² at 2 with ε = 0.5: δ = √4.5 − 2 ≈ 0.1213', () => {
    const d = deltaFor(src('y = x^2'), 2, 4, 0.5)!
    expect(d.capped).toBe(false)
    expect(d.delta).toBeCloseTo(Math.sqrt(4.5) - 2, 9)
    expect(d.delta.toFixed(4)).toBe('0.1213')
  })

  it('one side: from the left the binding edge is 2 − √3.5', () => {
    const d = deltaFor(src('y = x^2'), 2, 4, 0.5, 'left')!
    expect(d.delta).toBeCloseTo(2 - Math.sqrt(3.5), 9)
  })

  it('a hole is not in the domain: (x² − 9)/(x − 3) at 3 gives δ = ε', () => {
    const d = deltaFor(src('y = (x^2-9)/(x-3)'), 3, 6, 0.25)!
    expect(d.delta).toBeCloseTo(0.25, 9)
  })

  it('a constant never violates: the scan is capped', () => {
    const d = deltaFor(src('y = 3'), 1, 3, 0.1)!
    expect(d.capped).toBe(true)
  })

  it('nonsense in, null out', () => {
    expect(deltaFor(src('y = x'), 0, 0, 0)).toBeNull()
    expect(deltaFor(src('y = x'), Infinity, 0, 1)).toBeNull()
  })
})

describe('where the limits are interesting', () => {
  it('holes, jumps and poles within the range, leftmost first', () => {
    const pts = limitPoints(src('y = (x^2-9)/(x-3)'), [-10, 10])
    expect(pts.map((p) => [p.kind, p.x])).toEqual([['hole', 3]])
    const poles = limitPoints(src('y = 1/((x-1)(x+2))'), [-10, 10])
    expect(poles.map((p) => [p.kind, p.x])).toEqual([
      ['pole', -2],
      ['pole', 1],
    ])
    const steps = limitPoints(src('y = floor(x)'), [-0.5, 2.5])
    expect(steps.map((p) => [p.kind, p.x])).toEqual([
      ['jump', 0],
      ['jump', 1],
      ['jump', 2],
    ])
  })

  it('a written exclusion is found too', () => {
    const pts = limitPoints(src('y = x^2 {x != 2}'), [-5, 5])
    expect(pts.map((p) => [p.kind, p.x])).toEqual([['hole', 2]])
  })

  it('reachFrom: how far the curve runs unbroken from a', () => {
    expect(reachFrom(src('y = floor(x)'), 2, 1)).toBeCloseTo(1, 6)
    expect(reachFrom(src('y = floor(x)'), 2, -1)).toBeCloseTo(1, 6)
    expect(reachFrom(src('y = x^2'), 0, 1, 5)).toBe(5)
    expect(reachFrom(src('y = sqrt(x)'), 1, -1)).toBeCloseTo(1, 6)
  })
})

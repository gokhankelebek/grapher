// ============================================================================
// tests/exactEval.test.ts — a typed formula evaluated exactly at p/q or pπ/q
// (src/core/parse/exactEval.ts, reached through ModelSpec.evalExact).
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { ExactPoint, ModelSpec } from '../src/core/types'
import { parseExpression } from '../src/core/parse'

function model(src: string): { spec: ModelSpec; params: number[] } {
  const r = parseExpression(src)
  if (!r.ok) throw new Error(`expected "${src}" to parse, got: ${r.error}`)
  return { spec: r.plot.makeModel('m'), params: r.plot.defaultParams }
}

const q = (p: number, qq = 1): ExactPoint => ({ p, q: qq, pi: false })
const pi = (p: number, qq = 1): ExactPoint => ({ p, q: qq, pi: true })

function exact(src: string, x: ExactPoint, params?: number[]): number | undefined {
  const m = model(src)
  expect(m.spec.evalExact).toBeTypeOf('function')
  return m.spec.evalExact!(params ?? m.params, x)
}

describe('evalExact — the values the nearest double gets wrong', () => {
  it('trig at multiples of π', () => {
    expect(exact('y = sin(x)', pi(1))).toBe(0)
    expect(exact('y = sin(x)', pi(-2))).toBe(0)
    expect(exact('y = cos(x)', pi(1, 2))).toBe(0)
    expect(exact('y = sin(x)', pi(1, 6))).toBe(0.5)
    expect(exact('y = cos(x)', pi(2, 3))).toBe(-0.5)
    expect(exact('y = tan(x)', pi(1, 4))).toBe(1)
    expect(exact('y = tan(x)', pi(3, 4))).toBe(-1)
    expect(exact('y = tan(x)', pi(1, 2))).toBeNaN()
    expect(exact('y = cot(x)', pi(1, 2))).toBe(0)
    expect(exact('y = csc(x)', pi(1))).toBeNaN()
    expect(exact('y = sec(x)', pi(1))).toBe(-1)
    expect(exact('y = sin(2x)', pi(1, 2))).toBe(0)
  })

  it('step functions of them', () => {
    expect(exact('y = sign(sin(x))', pi(1))).toBe(0)
    expect(exact('y = sign(sin(x))', pi(1, 2))).toBe(1)
    expect(exact('y = floor(sin(x))', pi(1))).toBe(0)
    expect(exact('y = floor(x/pi)', pi(1))).toBe(1)
    expect(exact('y = floor(x/pi)', pi(-1))).toBe(-1)
  })

  it('decimal literals are the decimals as typed', () => {
    expect(exact('y = ceil(10x)', q(3, 10))).toBe(3)
    expect(exact('y = floor(x/0.1)', q(3, 10))).toBe(3)
    expect(exact('y = floor(0.1x + 0.2)', q(8))).toBe(1)
  })

  it('rationals, powers, abs, min/max, sqrt of perfect squares', () => {
    expect(exact('y = abs(x)/x', q(0))).toBeNaN()
    expect(exact('y = sign(x)', q(0))).toBe(0)
    expect(exact('y = floor(x^2)', q(3, 2))).toBe(2)
    expect(exact('y = x^-1', q(0))).toBeNaN()
    expect(exact('y = max(x, 1/3)', q(1, 4))).toBeCloseTo(1 / 3, 15)
    expect(exact('y = sqrt(x)', q(9, 4))).toBe(1.5)
    expect(exact('y = sqrt(x)', q(-1))).toBeNaN()
    expect(exact('y = floor(x + pi)', q(0))).toBe(3)
  })

  it('sliders are read as the short decimals they are', () => {
    expect(exact('y = ceil(a*x)', q(3, 10), [10])).toBe(3)
    expect(exact('y = floor(a*x)', q(2), [0.5])).toBe(1)
  })

  it('cannot certify: e, ln, irrational trig values, products of π', () => {
    expect(exact('y = e^x', q(1))).toBeUndefined()
    expect(exact('y = ln(x)', q(2))).toBeUndefined()
    expect(exact('y = sin(x)', pi(1, 4))).toBeUndefined()
    expect(exact('y = sin(x)', q(1))).toBeUndefined()
    expect(exact('y = x*x', pi(1))).toBeUndefined()
    expect(exact('y = sqrt(x)', q(2))).toBeUndefined()
  })

  it('a restriction keeps it; an excluded point and a piecewise do not offer it', () => {
    expect(model('y = floor(x) {-3 <= x < 3}').spec.evalExact).toBeTypeOf('function')
    expect(model('y = 1/x {x != 2}').spec.evalExact).toBeUndefined()
    expect(model('y = piecewise(x, x < 0, 2, x >= 0)').spec.evalExact).toBeUndefined()
    expect(model('r = sin(theta)').spec.evalExact).toBeUndefined()
  })
})

// ============================================================================
// tests/trig.test.ts — the unit circle's mathematics (src/core/trig.ts).
//
// The exact table for every multiple of π/12 (all six functions, checked
// against Math and against its own text read back), reference angles and
// quadrants in every quadrant and on every axis — negatives and angles past a
// turn included — the principal values of the inverses, typed angles and
// values, and the snapping a drag of P goes through.
// ============================================================================

import { describe, expect, it } from 'vitest'
import {
  STEP,
  TWO_PI,
  angleText,
  coterminal,
  dragTheta,
  evalConst,
  exactTrig,
  inverseTrig,
  parseAngle,
  parseTrigValue,
  quadrantOf,
  referenceAngle,
  snapTheta,
  specialIndex,
  specialRows,
  trigAt,
} from '../src/core/trig'
import type { TrigFn } from '../src/core/trig'

const FNS: TrigFn[] = ['sin', 'cos', 'tan', 'csc', 'sec', 'cot']

function truth(fn: TrigFn, t: number): number | null {
  const s = Math.sin(t)
  const c = Math.cos(t)
  const zs = Math.abs(s) < 1e-9
  const zc = Math.abs(c) < 1e-9
  switch (fn) {
    case 'sin':
      return s
    case 'cos':
      return c
    case 'tan':
      return zc ? null : s / c
    case 'cot':
      return zs ? null : c / s
    case 'sec':
      return zc ? null : 1 / c
    case 'csc':
      return zs ? null : 1 / s
  }
}

describe('the exact table: all 24 multiples of π/12, six functions each', () => {
  for (let k = 0; k < 24; k++) {
    it(`kπ/12 with k = ${k}`, () => {
      const t = k * STEP
      for (const fn of FNS) {
        const e = exactTrig(fn, k)
        const want = truth(fn, t)
        if (want === null) {
          expect(e, `${fn}(${k}π/12) is undefined`).toBeNull()
          continue
        }
        expect(e, `${fn}(${k}π/12)`).not.toBeNull()
        expect(e!.value).toBeCloseTo(want, 12)
        // The text says what the value is: read it back.
        const back = evalConst(e!.text)
        expect(back, `${fn}(${k}π/12) = ${e!.text}`).not.toBeNull()
        expect(back!).toBeCloseTo(want, 12)
        expect(e!.text).not.toContain('-') // a true minus, never a hyphen
      }
    })
  }

  it('prints the π/12 family the way a textbook does', () => {
    expect(exactTrig('sin', 1)!.text).toBe('(√6−√2)/4')
    expect(exactTrig('cos', 1)!.text).toBe('(√6+√2)/4')
    expect(exactTrig('tan', 1)!.text).toBe('2−√3')
    expect(exactTrig('tan', 5)!.text).toBe('2+√3')
    expect(exactTrig('sec', 1)!.text).toBe('√6−√2')
    expect(exactTrig('csc', 1)!.text).toBe('√6+√2')
    expect(exactTrig('sin', 13)!.text).toBe('(√2−√6)/4')
    expect(exactTrig('cot', 11)!.text).toBe('−2−√3')
    expect(exactTrig('cos', 11)!.text).toBe('−(√6+√2)/4')
  })

  it('and the π/6, π/4 multiples', () => {
    expect(exactTrig('sin', 10)!.text).toBe('1/2')
    expect(exactTrig('cos', 10)!.text).toBe('−√3/2')
    expect(exactTrig('tan', 10)!.text).toBe('−√3/3')
    expect(exactTrig('cos', 9)!.text).toBe('−√2/2')
    expect(exactTrig('sin', 14)!.text).toBe('−1/2')
    expect(exactTrig('tan', 8)!.text).toBe('−√3')
    expect(exactTrig('csc', 10)!.text).toBe('2')
    expect(exactTrig('sec', 10)!.text).toBe('−2√3/3')
    expect(exactTrig('tan', 6)).toBeNull()
    expect(exactTrig('cot', 0)).toBeNull()
    expect(exactTrig('cos', 12)!.text).toBe('−1')
  })

  it('works for any k, negative or past a turn', () => {
    expect(exactTrig('sin', -2)!.text).toBe('−1/2')
    expect(exactTrig('sin', 26)!.text).toBe('1/2')
    expect(trigAt('sin', (13 * Math.PI) / 6).text).toBe('1/2')
  })

  it('reads an angle off the lattice as a decimal, and says undefined', () => {
    const r = trigAt('sin', 1)
    expect(r.exact).toBe(false)
    expect(r.text).toBe('0.8415')
    expect(trigAt('tan', Math.PI / 2).text).toBe('undefined')
    expect(trigAt('tan', (3 * Math.PI) / 2).value).toBeNull()
  })

  it('the 16-angle chart', () => {
    const rows = specialRows()
    expect(rows).toHaveLength(16)
    expect(rows.map((r) => r.rad)).toEqual([
      '0', 'π/6', 'π/4', 'π/3', 'π/2', '2π/3', '3π/4', '5π/6',
      'π', '7π/6', '5π/4', '4π/3', '3π/2', '5π/3', '7π/4', '11π/6',
    ])
    expect(rows[7]).toMatchObject({ deg: '150°', cos: '−√3/2', sin: '1/2' })
  })
})

describe('reference angle and quadrant', () => {
  const cases: [number, number, string][] = [
    [Math.PI / 6, Math.PI / 6, 'Q1'],
    [(5 * Math.PI) / 6, Math.PI / 6, 'Q2'],
    [(7 * Math.PI) / 6, Math.PI / 6, 'Q3'],
    [(11 * Math.PI) / 6, Math.PI / 6, 'Q4'],
    [-Math.PI / 4, Math.PI / 4, 'Q4'],
    [(-3 * Math.PI) / 4, Math.PI / 4, 'Q3'],
    [(-5 * Math.PI) / 4, Math.PI / 4, 'Q2'],
    [(13 * Math.PI) / 6, Math.PI / 6, 'Q1'],
    [(17 * Math.PI) / 4, Math.PI / 4, 'Q1'],
    [(19 * Math.PI) / 6, Math.PI / 6, 'Q3'],
    [2.5, Math.PI - 2.5, 'Q2'],
    [0, 0, '+x'],
    [Math.PI / 2, Math.PI / 2, '+y'],
    [Math.PI, 0, '-x'],
    [(3 * Math.PI) / 2, Math.PI / 2, '-y'],
    [-Math.PI / 2, Math.PI / 2, '-y'],
    [(5 * Math.PI) / 2, Math.PI / 2, '+y'],
    [4 * Math.PI, 0, '+x'],
    [-3 * Math.PI, 0, '-x'],
  ]
  for (const [theta, ref, where] of cases) {
    it(`θ = ${angleText(theta)}: θ′ = ${angleText(ref)}, ${where}`, () => {
      expect(referenceAngle(theta)).toBeCloseTo(ref, 12)
      const q = quadrantOf(theta)
      const got = q.kind === 'quadrant' ? `Q${q.q}` : q.axis
      expect(got).toBe(where)
    })
  }

  it('prints a reference angle on the lattice exactly', () => {
    expect(angleText(referenceAngle((5 * Math.PI) / 6))).toBe('π/6')
    expect(angleText(referenceAngle((-3 * Math.PI) / 4))).toBe('π/4')
  })

  it('coterminal angles', () => {
    const c = coterminal((5 * Math.PI) / 6)
    expect(angleText(c.minus)).toBe('−7π/6')
    expect(angleText(c.plus)).toBe('17π/6')
    expect(angleText(coterminal((-Math.PI) / 3).principal)).toBe('5π/3')
  })
})

describe('inverse trig: the principal value', () => {
  it('arcsin(−√2/2) = −π/4', () => {
    const r = inverseTrig('sin', -Math.SQRT2 / 2)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(angleText(r.principal)).toBe('−π/4')
    expect(angleText(r.other!)).toBe('5π/4')
    expect(r.range.text).toBe('[−π/2, π/2]')
  })

  it('arccos(−1/2) = 2π/3', () => {
    const r = inverseTrig('cos', -0.5)
    if (!r.ok) throw new Error('refused')
    expect(angleText(r.principal)).toBe('2π/3')
    expect(angleText(r.other!)).toBe('4π/3')
    expect(r.range).toMatchObject({ lo: 0, hi: Math.PI, loOpen: false, hiOpen: false })
  })

  it('arctan(−√3) = −π/3', () => {
    const r = inverseTrig('tan', -Math.sqrt(3))
    if (!r.ok) throw new Error('refused')
    expect(angleText(r.principal)).toBe('−π/3')
    expect(angleText(r.other!)).toBe('2π/3')
    expect(r.range.loOpen && r.range.hiOpen).toBe(true)
  })

  it('arcsin(1/2) = π/6, the other solution 5π/6; arcsin(1) has none', () => {
    const r = inverseTrig('sin', 0.5)
    if (!r.ok) throw new Error('refused')
    expect(angleText(r.principal)).toBe('π/6')
    expect(angleText(r.other!)).toBe('5π/6')
    const one = inverseTrig('sin', 1)
    if (!one.ok) throw new Error('refused')
    expect(one.other).toBeNull()
    const cos1 = inverseTrig('cos', 1)
    if (!cos1.ok) throw new Error('refused')
    expect(cos1.principal).toBe(0)
    expect(cos1.other).toBeNull()
  })

  it('refuses a value outside [−1, 1] for sin⁻¹ and cos⁻¹, not for tan⁻¹', () => {
    expect(inverseTrig('sin', 2).ok).toBe(false)
    expect(inverseTrig('cos', -1.5).ok).toBe(false)
    expect(inverseTrig('tan', 40).ok).toBe(true)
  })

  it('reads values as typed', () => {
    expect(parseTrigValue('-√2/2')).toBeCloseTo(-Math.SQRT2 / 2, 14)
    expect(parseTrigValue('−sqrt(3)/2')).toBeCloseTo(-Math.sqrt(3) / 2, 14)
    expect(parseTrigValue('1/2')).toBe(0.5)
    expect(parseTrigValue('-√3')).toBeCloseTo(-Math.sqrt(3), 14)
    expect(parseTrigValue('2√3/3')).toBeCloseTo((2 * Math.sqrt(3)) / 3, 14)
    expect(parseTrigValue('abc')).toBeNull()
    expect(parseTrigValue('')).toBeNull()
  })
})

describe('typed angles', () => {
  it('radians, degrees, and the mode deciding a bare number', () => {
    expect(parseAngle('5pi/6', false)).toBe(10 * STEP)
    expect(parseAngle('5π/6', true)).toBe(10 * STEP)
    expect(parseAngle('-pi/4', false)).toBe(-3 * STEP)
    expect(parseAngle('150°', false)).toBe(10 * STEP)
    expect(parseAngle('150', true)).toBe(10 * STEP)
    expect(parseAngle('150', false)).toBe(150)
    expect(parseAngle('2.4', false)).toBe(2.4)
    expect(parseAngle('θ = 7pi/6', false)).toBe(14 * STEP)
    expect(parseAngle('nonsense', false)).toBeNull()
  })

  it('prints angles the way a teacher writes them', () => {
    expect(angleText((5 * Math.PI) / 6)).toBe('5π/6')
    expect(angleText(-Math.PI / 4)).toBe('−π/4')
    expect(angleText(TWO_PI)).toBe('2π')
    expect(angleText(Math.PI)).toBe('π')
    expect(angleText((13 * Math.PI) / 6)).toBe('13π/6')
    expect(angleText((5 * Math.PI) / 6, true)).toBe('150°')
    expect(angleText(-Math.PI / 4, true)).toBe('−45°')
    expect(angleText(2.4)).toBe('2.4')
    expect(angleText(1, true)).toBe('57.3°')
  })
})

describe('snapping P', () => {
  const R = 100 // px
  it('takes π/4 and π/6 multiples first, within ~10 px along the arc', () => {
    expect(snapTheta(Math.PI / 6 + 0.05, R)).toBe(2 * STEP)
    expect(snapTheta(Math.PI / 4 - 0.09, R)).toBe(3 * STEP)
    expect(snapTheta((5 * Math.PI) / 6 + 0.08, R)).toBe(10 * STEP)
  })
  it('then any multiple of π/12, within ~6 px', () => {
    expect(snapTheta(Math.PI / 12 + 0.05, R)).toBe(Math.PI / 12)
    expect(snapTheta(5 * STEP - 0.04, R)).toBe(5 * STEP)
  })
  it('and leaves everything else alone', () => {
    expect(snapTheta(Math.PI / 12 + 0.07, R)).toBe(Math.PI / 12 + 0.07)
    expect(snapTheta(1.18, R)).toBe(1.18)
    // A bigger circle on screen: the same angle is further away in px.
    expect(snapTheta(Math.PI / 6 + 0.05, 400)).toBe(Math.PI / 6 + 0.05)
  })
  it('a drag keeps counting past a full turn (coterminal), and snaps there too', () => {
    const past = dragTheta(TWO_PI - 0.2, 0.19, R)
    expect(past).toBeCloseTo(TWO_PI + 0.19, 12)
    expect(dragTheta(TWO_PI - 0.2, Math.PI / 6 + 0.02, R)).toBe(26 * STEP)
    expect(specialIndex(dragTheta(0.1, -Math.PI / 4 + 0.01, R))).toBe(-3)
    // Backwards through 0 goes negative, not to 2π.
    expect(dragTheta(0.2, -0.4, 100)).toBeCloseTo(-0.4, 12)
  })
})

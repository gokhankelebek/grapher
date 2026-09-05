// ============================================================================
// tests/formatCoord.test.ts — analysis coordinates must not print noise.
//
// A cubic's inflection at the origin arrives as 1.662e-14 and a cosine's peak
// as 1.05e-8. Printing those instead of 0 reads as the tool being unable to do
// arithmetic, which is exactly the kind of thing that costs a teacher's trust.
// ============================================================================

import { describe, it, expect } from 'vitest'
import { formatCoord } from '../src/ui/numeric'

describe('formatCoord — values that are zero print as zero', () => {
  it('reports floating-point residue as 0', () => {
    for (const v of [1.662e-14, -8.88e-16, 2.66e-15, 0, -0, 1e-13, -4.3e-14]) {
      expect(formatCoord(v), `${v} should read as zero`).toBe('0')
    }
  })

  it('reports a numerically located value at solver resolution as 0', () => {
    // golden-section / bisection bottom out near sqrt(eps); these are zero
    for (const v of [1.05e-8, -1.49e-8, 7.45e-9]) {
      expect(formatCoord(v, { exact: false }), `${v} is solver slop`).toBe('0')
    }
  })

  it('does NOT swallow a value that is merely small but real', () => {
    expect(formatCoord(0.001)).not.toBe('0')
    expect(formatCoord(-0.0025)).not.toBe('0')
    expect(formatCoord(1e-5)).not.toBe('0')
    // a closed-form value at solver scale is real precision, not slop
    expect(formatCoord(1.05e-8, { exact: true })).not.toBe('0')
  })

  it('scales the floor with the curve it belongs to', () => {
    // on a curve spanning ~1e6, 1e-3 is noise; on an order-1 curve it is not
    expect(formatCoord(1e-3, { exact: false, scale: 1e6 })).toBe('0')
    expect(formatCoord(1e-3, { exact: false, scale: 1 })).not.toBe('0')
  })

  it('uses a real minus sign on the value, never on the exponent', () => {
    expect(formatCoord(-2.5)).toBe('−2.500')
    const tiny = formatCoord(-3.7e-7, { exact: true })
    expect(tiny.startsWith('−'), `${tiny} should lead with a real minus`).toBe(true)
    // the exponent's own hyphen must survive as ASCII so the text stays parseable
    expect(tiny).toContain('e-')
  })

  it('still formats ordinary coordinates unchanged', () => {
    expect(formatCoord(2)).toBe('2.000')
    expect(formatCoord(3.14159)).toBe('3.142')
    expect(formatCoord(-0.7789)).toBe('−0.7789')
  })

  it('handles non-finite input', () => {
    expect(formatCoord(NaN)).toBe('—')
    expect(formatCoord(Infinity)).toBe('—')
  })
})

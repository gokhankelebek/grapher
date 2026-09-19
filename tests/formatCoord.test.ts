// ============================================================================
// tests/formatCoord.test.ts — readouts must not print noise.
//
// A cubic's inflection at the origin arrives as 1.662e-14, a cosine's peak as
// 1.05e-8, and a fitted coefficient as −2.93e-16. Printing those instead of 0
// reads as the tool being unable to do arithmetic, which is exactly the kind
// of thing that costs a teacher's trust. Coordinates (formatCoord) and
// coefficient fields (formatSig) share one floor so they cannot disagree about
// which numbers are zero.
// ============================================================================

import { describe, it, expect } from 'vitest'
import { formatCoord, formatSig } from '../src/ui/numeric'

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

  // -------------------------------------------------------------------------
  // Scale-aware rounding. Distinct from zero-snapping: the value below is
  // CORRECT — 5.09e-4 really is where the midline of 3.27·sin(…) + 0.0005 sits
  // — but a column showing four significant figures of a curve 6.5 tall cannot
  // carry it, and printing it anyway claims nine digits of precision beside
  // neighbours that have four. At that resolution it is zero.
  // -------------------------------------------------------------------------
  it('rounds away what the readout cannot show at the curve\'s scale', () => {
    const waveScale = 6.54 // 3.27·sin(…), peak to trough
    expect(formatCoord(5.09e-4, { scale: waveScale })).toBe('0')
    // the same number on a curve small enough to show it stays
    expect(formatCoord(5.09e-4, { scale: 1 })).not.toBe('0')
    expect(formatCoord(5.09e-4)).not.toBe('0')
    // and a value the curve's own scale CAN resolve survives on a big curve
    expect(formatCoord(3.27, { scale: waveScale })).toBe('3.270')
    expect(formatCoord(0.0042, { scale: waveScale })).not.toBe('0')
  })

  it('never widens the floor when no scale is offered', () => {
    // the card passes a scale only when it knows one; without it the only
    // things snapped are residue and (for a numeric solve) solver slop
    expect(formatCoord(1e-5)).not.toBe('0')
    expect(formatCoord(1e-5, { exact: false })).not.toBe('0')
  })
})

describe('formatSig — the same zero, in a coefficient field', () => {
  it('reports a coefficient that cancelled as 0', () => {
    for (const v of [-2.93e-16, -2.36e-15, 1.662e-14, 0, -0, 4.4e-13]) {
      expect(formatSig(v), `${v} should read as zero`).toBe('0')
    }
  })

  it('keeps a small coefficient that is real', () => {
    expect(formatSig(1e-5)).not.toBe('0')
    expect(formatSig(-0.0025)).toBe('-0.0025')
    expect(formatSig(1e-9)).not.toBe('0')
  })

  it('takes an optional scale, and is unchanged without one', () => {
    // one argument: exactly what the card calls today
    expect(formatSig(3.14159)).toBe('3.142')
    expect(formatSig(2)).toBe('2')
    expect(formatSig(1234567)).toBe('1.235e+6')
    // with a scale, a coefficient below the curve's display precision is zero
    expect(formatSig(5.09e-4, { scale: 6.54 })).toBe('0')
    expect(formatSig(5.09e-4)).not.toBe('0')
    expect(formatSig(-3.2, { scale: 6.54 })).toBe('-3.2')
  })

  it('handles non-finite input', () => {
    expect(formatSig(NaN)).toBe('0')
    expect(formatSig(Infinity)).toBe('0')
  })
})

// ============================================================================
// tests/displayEquation.test.ts — the card prints what the teacher wrote.
//
// Typing "y = 0.25(x+2)(x-1)(x-3)" into a cubic's card gives back a CUBIC —
// handles, interpretations and feature editing all survive the round trip,
// which is the whole point of equationText's family route. What must ALSO
// survive is the writing: a lesson whose subject is factored form cannot have
// its equation expanded on the spot.
//
// The rule is "while it is still true". The moment a slider moves, the typed
// line is a statement about a curve that no longer exists, and the card goes
// back to the form the family generates.
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { FittedCurve } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import {
  curveEquationText,
  displayEquationLatex,
  isEquationEditable,
  readCurveEquation,
} from '../src/ui/equationText'

function curve(modelId: string, params: number[], over: Partial<FittedCurve> = {}): FittedCurve {
  return {
    id: 'c1',
    modelId,
    params: params.slice(),
    kind: MODELS[modelId].kind,
    domain: null,
    color: '#4f9cf9',
    strokeWidth: 2.5,
    visible: true,
    error: 0.01,
    ...over,
  }
}

/** The cubic 0.25(x+2)(x−1)(x−3) in the ascending storage poly3 uses. */
const FACTORED = 'y = 0.25(x+2)(x-1)(x-3)'
const FACTORED_PARAMS = (() => {
  const read = readCurveEquation(FACTORED, curve('poly3', [0, 0, 0, 1]), MODELS.poly3)
  if (!read.ok || read.mode !== 'family') throw new Error('the factored cubic is not a cubic')
  return read.params
})()

describe('a typed equation that is still a family', () => {
  it('comes back as the same family, not as a typed expression', () => {
    expect(FACTORED_PARAMS).toHaveLength(4)
    // 0.25(x+2)(x-1)(x-3) = 0.25x³ − 0.5x² − 1.25x + 1.5
    expect(FACTORED_PARAMS[3]).toBeCloseTo(0.25, 9)
    expect(FACTORED_PARAMS[0]).toBeCloseTo(1.5, 9)
  })

  it("keeps the teacher's own writing on the card", () => {
    const c = curve('poly3', FACTORED_PARAMS)
    const shown = displayEquationLatex(FACTORED, c, MODELS.poly3)
    expect(shown).not.toBeNull()
    // the factors are still there, and nothing has been multiplied out
    expect(shown).toContain('x+2')
    expect(shown).not.toMatch(/x\^\{?3/)
    // ...while the family's own form is the expanded one it would have printed
    expect(MODELS.poly3.latex(FACTORED_PARAMS)).toMatch(/x\^\{?3/)
  })

  it('drops the typed form the moment the params stop saying it', () => {
    const moved = curve('poly3', [...FACTORED_PARAMS.slice(0, 3), 0.65])
    expect(displayEquationLatex(FACTORED, moved, MODELS.poly3)).toBeNull()
  })

  it('has nothing to say about a curve with no source, or an unreadable one', () => {
    const c = curve('poly3', FACTORED_PARAMS)
    expect(displayEquationLatex(undefined, c, MODELS.poly3)).toBeNull()
    expect(displayEquationLatex('   ', c, MODELS.poly3)).toBeNull()
    expect(displayEquationLatex('y = ((((', c, MODELS.poly3)).toBeNull()
    expect(displayEquationLatex(FACTORED, c, undefined)).toBeNull()
  })

  it('never speaks for a typed expression, which already prints its own source', () => {
    const expr = curve('poly3', FACTORED_PARAMS, { modelId: 'expr_1' })
    expect(displayEquationLatex(FACTORED, expr, MODELS.poly3)).toBeNull()
  })

  it('refuses a source that describes a different curve of the same family', () => {
    const c = curve('poly3', FACTORED_PARAMS)
    expect(displayEquationLatex('y = 0.25(x+2)(x-1)(x-4)', c, MODELS.poly3)).toBeNull()
  })
})

describe('the two families that had no typed form until this wave', () => {
  it('gives a logarithm one, and reads it back as a logarithm', () => {
    const c = curve('log', [1.6, -1, 0.5])
    const text = curveEquationText(c, MODELS.log)
    expect(text).toBe('y = 1.6ln(x + 1) + 0.5')
    expect(isEquationEditable(c, MODELS.log)).toBe(true)
    const read = readCurveEquation(text as string, c, MODELS.log)
    expect(read.ok && read.mode).toBe('family')
    if (read.ok && read.mode === 'family') {
      expect(read.params[0]).toBeCloseTo(1.6, 9)
      expect(read.params[1]).toBeCloseTo(-1, 9)
      expect(read.params[2]).toBeCloseTo(0.5, 9)
    }
  })

  it('gives a reciprocal one, and reads it back as a reciprocal', () => {
    const c = curve('recip', [-2, 1, -1])
    const text = curveEquationText(c, MODELS.recip)
    expect(text).toBe('y = -2/(x - 1) - 1')
    const read = readCurveEquation(text as string, c, MODELS.recip)
    expect(read.ok && read.mode).toBe('family')
    if (read.ok && read.mode === 'family') {
      expect(read.params[0]).toBeCloseTo(-2, 9)
      expect(read.params[1]).toBeCloseTo(1, 9)
      expect(read.params[2]).toBeCloseTo(-1, 9)
    }
  })

  it('does not mistake one for the other', () => {
    const log = curve('log', [1, 0, 0])
    const asRecip = readCurveEquation('y = 1/(x - 0) + 0', log, MODELS.log)
    // the text is not a logarithm, so the family route refuses it and it
    // becomes a typed expression rather than silently redrawing something else
    expect(asRecip.ok && asRecip.mode).toBe('typed')
  })
})

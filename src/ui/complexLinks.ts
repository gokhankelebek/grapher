// ============================================================================
// src/ui/complexLinks.ts — which curves get a "Zeros over ℂ" section, and what
// it says in a sentence.
//
//   complexZerosOf(curve, models)    the zeros, when the curve is a polynomial
//                                    of degree 2–8 drawn over all of ℝ
//   complexSummary(z)                the folded section's one line
//   complexKeysOf(curve, models)     its reveal key, when it has one
//   complexSentences(...)            the description's sentences
//
// Nothing here is stored: the section is a reading of the formula, recomputed
// whenever the curve changes, so old documents are untouched.
// ============================================================================

import type { FittedCurve, ModelSpec } from '../core/types'
import type { ComplexZeros } from '../core/complexZeros'
import { curveComplexZeros, zeroLine } from '../core/complexZeros'
import { complexKey } from './reveal'

/**
 * The zeros over ℂ of an explicit curve whose formula is a polynomial of
 * degree 2–8, or null. A restricted or piecewise curve has none: the
 * Fundamental Theorem of Algebra is about a polynomial on all of ℂ, and the
 * picture of a piece of it is not its graph.
 */
export function complexZerosOf(curve: FittedCurve, models: Record<string, ModelSpec>): ComplexZeros | null {
  if (curve.kind !== 'explicit' || curve.domain) return null
  const spec = models[curve.modelId]
  if (!spec || !spec.evalExplicit || spec.pieces) return null
  if (!curve.params.every(Number.isFinite)) return null
  const ev = spec.evalExplicit
  const params = curve.params
  try {
    return curveComplexZeros((x) => ev.call(spec, params, x))
  } catch {
    return null
  }
}

/** "degree 3 = 1 real + 2 non-real" — the question (the degree), then the answer. */
export function complexSummary(z: ComplexZeros): string {
  return `degree ${z.degree} = ${z.real} real + ${z.nonReal} non-real`
}

/** The section's reveal key, for a curve that has one. */
export function complexKeysOf(curve: FittedCurve, models: Record<string, ModelSpec>): string[] {
  return complexZerosOf(curve, models) ? [complexKey(curve.id)] : []
}

/** One sentence per polynomial curve for the description (answers only). */
export function complexSentences(
  curves: readonly FittedCurve[],
  models: Record<string, ModelSpec>,
  nameOf: (c: FittedCurve) => string,
): { text: string; answer: boolean }[] {
  const out: { text: string; answer: boolean }[] = []
  for (const c of curves) {
    if (!c.visible) continue
    const z = complexZerosOf(c, models)
    if (!z || z.nonReal === 0) continue
    const list = z.zeros.map(zeroLine).join('; ')
    out.push({
      text: `Over the complex numbers ${nameOf(c)} has ${z.degree} zeros counted with multiplicity, ${z.real} real and ${z.nonReal} non-real: ${list}. The non-real zeros do not appear on the graph.`,
      answer: true,
    })
  }
  return out
}

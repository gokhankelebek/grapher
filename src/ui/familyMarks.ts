// ============================================================================
// src/ui/familyMarks.ts — the marks a selected typed curve's FAMILY adds to
// the board's markers, and how they join the analysis.
//
// While a typed curve is selected the board marks what its family section
// works out from the numbers typed: a sinusoid's five key points, a conic's
// centre, vertices and foci, a logistic's inflection, a transformation's
// image points, a parametric or polar curve's features (tangent points, the
// pole, the start — its Motion section's). They are drawn through the analysis path (the same rings and
// exact chips as any special point), but they are not the analyzer's answers
// — they are the card's FAMILY FACTS (src/ui/familyFacts.ts), one reveal key
// per curve, curve:<id>:family. So in reveal mode none of them is drawn until
// that key is revealed: a key point at (12, 8) beside a hidden inflection
// would say the answer the "?" stands for.
//
// On a restricted line (d(t) = … {0 <= t <= 24}) only the marks inside the
// domain are drawn (src/ui/familyLine.ts).
//
// Pure: src/app/useSelectionMarks.ts calls these for the board, and
// tests/revealLeak.test.ts for every gallery example.
// ============================================================================

import type { FittedCurve, SpecialPoint } from '../core/types'
import { conicKeyMarks, safeReadConic } from './conicLinks'
import { safeReadExponential } from './expLinks'
import { safeReadFactored } from './factorLinks'
import { familyRestriction, pointsWithin } from './familyLine'
import { logisticMarks, safeReadLogistic, withLogisticMarks } from './logisticLinks'
import { safeReadLogarithmic } from './logLinks'
import { familyKey } from './reveal'
import { safeReadSinusoid, sinKeyMarks, withKeyMarks } from './sinLinks'
import { safeReadTransform, transformKeyMarks } from './transformLinks'

/** The layers of marks the board adds to a selected curve's analysis. */
export interface MarkLayers {
  sin: readonly SpecialPoint[]
  conic: readonly SpecialPoint[]
  motion: readonly SpecialPoint[]
  logistic: readonly SpecialPoint[]
  transform: readonly SpecialPoint[]
}

export const NO_MARKS: MarkLayers = { sin: [], conic: [], motion: [], logistic: [], transform: [] }

export interface FamilyMarkOpts {
  /** The line calls another curve: no family reading (the card shows none). */
  calls?: boolean
  /** Is this answer key hidden right now (reveal mode)? Absent: nothing is. */
  hidden?: (key: string) => boolean
  /** The Transformation section's image marks are on (its section is open, or the parent is shown). */
  transform?: boolean
  /** A parametric / polar curve's features as marks (src/ui/motionLinks.ts motionMarks): the Motion section's facts. */
  motion?: readonly SpecialPoint[]
}

/**
 * The family marks of one selected curve, in the card's precedence: a line
 * the Roots, Exponential or Logarithmic section speaks for is not read as a
 * sinusoid, and a sinusoid not as a logistic. Empty while the curve's family
 * facts are hidden.
 */
export function familyMarks(
  curve: Pick<FittedCurve, 'id' | 'kind' | 'modelId' | 'visible'>,
  src: string | undefined,
  opts: FamilyMarkOpts = {},
): MarkLayers {
  if (!curve.visible || opts.hidden?.(familyKey(curve.id))) return NO_MARKS
  const none: MarkLayers = { ...NO_MARKS, motion: opts.motion ?? [] }
  if (!curve.modelId.startsWith('expr_') || opts.calls || !src) return none
  if (curve.kind === 'implicit') {
    const spec = safeReadConic(src)
    return { ...none, conic: spec ? conicKeyMarks(spec) : [] }
  }
  if (curve.kind !== 'explicit') return none
  const r = familyRestriction(src)
  const at = (p: SpecialPoint): number => p.pos.x
  const earlier = safeReadFactored(src) || safeReadExponential(src) || safeReadLogarithmic(src)
  const sinSpec = earlier ? null : safeReadSinusoid(src)
  const lgSpec = earlier || sinSpec ? null : safeReadLogistic(src)
  const tSpec = opts.transform ? safeReadTransform(src) : null
  return {
    sin: sinSpec ? sinKeyMarks(sinSpec, r) : [],
    conic: [],
    motion: none.motion,
    logistic: lgSpec ? pointsWithin(logisticMarks(lgSpec), at, r) : [],
    transform: tSpec ? pointsWithin(transformKeyMarks(tSpec), at, r) : [],
  }
}

/**
 * What the board marks for the selected curve: the analysis (when markers
 * are on), then each layer's marks the analysis does not already have — a
 * logistic's exact coordinates taking the place of the numeric ones.
 */
export function boardMarks(
  analysis: SpecialPoint[],
  layers: MarkLayers,
  markersOn: boolean,
  /** What markers-off starts from (the App's one empty list, so a memo keeps its identity). */
  empty: SpecialPoint[] = [],
): SpecialPoint[] {
  const base = markersOn ? analysis : empty
  const withSin = layers.sin.length > 0 ? withKeyMarks(base, layers.sin) : base
  const withConic = layers.conic.length > 0 ? withKeyMarks(withSin, layers.conic) : withSin
  const withMotion = layers.motion.length > 0 ? withKeyMarks(withConic, layers.motion) : withConic
  const withLogistic =
    layers.logistic.length > 0 && markersOn ? withLogisticMarks(withMotion, layers.logistic) : withMotion
  return layers.transform.length > 0 ? withKeyMarks(withLogistic, layers.transform) : withLogistic
}

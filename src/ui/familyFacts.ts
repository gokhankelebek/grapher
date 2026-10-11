// ============================================================================
// src/ui/familyFacts.ts — reveal mode's "family facts" answer, one per curve.
//
// A typed line that reads back as a family is shown on its card with what the
// typed numbers GIVE: the Transformation section's image of every parent key
// point (and the same images marked on the board), the vertex, asymptotes,
// domain and range; a conic's centre, vertices, foci and directrix. Those are
// answers — "where does the vertex go?" is the question — so in reveal mode
// they hide behind one key, curve:<id>:family (src/ui/reveal.ts familyKey).
// What was typed (a, b, h, k, the steps "shift up 1") always shows.
//
//   familyKeyOf(curve, src, models, depKey)   the key, or null — the card's
//                                             own test for these sections
//   familyFactLines(curve, src)               the facts as short lines, for
//                                             the presentation answer panel
//
// Pure: no React, no App state.
// ============================================================================

import type { FittedCurve, ModelSpec } from '../core/types'
import { familyKey } from './reveal'
import { featureLines, pointRows, safeReadTransform } from './transformLinks'
import { conicSectionInfo, safeConicFeatures } from './conicLinks'
import { featureLines as expFeatureLines, safeFeatures as safeExpFeatures, safeRate, safeReadExponential } from './expLinks'
import { logFacts, safeLogFeatures, safeReadLogarithmic } from './logLinks'
import { safeReadSinusoid, safeSinFeatures } from './sinLinks'
import { defaultForm, logisticFactLines, safeReadLogistic } from './logisticLinks'
import { factsWithin, familyRestriction, pointX } from './familyLine'
import { motionKindOf, motionMarks, safeFeatures as safeMotionFeatures } from './motionLinks'

type CurveLike = Pick<FittedCurve, 'id' | 'kind' | 'modelId'>

/**
 * The family-facts key for a curve, or null when its card has no such facts:
 * a typed line that calls no other curve and is not an inequality, read back
 * as a transformed parent (explicit) or an axis-aligned / rotated conic
 * (implicit). The same test the card makes before it shows those sections.
 */
export function familyKeyOf(
  curve: CurveLike | FittedCurve,
  src: string | undefined,
  models: Record<string, ModelSpec>,
  depKey?: string,
): string | null {
  // A parametric or polar curve — typed, or a sketched polar family — has
  // its Motion section's features: tangent points, the pole, the start.
  if ((curve.kind === 'parametric' || curve.kind === 'polar') && 'params' in curve) {
    return motionKindOf(curve, models) !== null ? familyKey(curve.id) : null
  }
  if (!curve.modelId.startsWith('expr_') || depKey !== undefined || !src) return null
  if (typeof models[curve.modelId]?.inequality === 'function') return null
  return hasFamilyFacts(curve.kind, src) ? familyKey(curve.id) : null
}

/**
 * True when a line of this kind has family facts on its card (familyKeyOf,
 * without the model checks): any family section's reading — Transformation,
 * Exponential, Logarithmic, Sinusoidal, Logistic — or a conic. Each of those
 * sections works its facts out from the numbers typed, and the card hides
 * them behind this one key (CurveCard's FamilyAnswerContext), as the board
 * hides its key-point marks (src/app/useSelectionMarks.ts).
 */
export function hasFamilyFacts(kind: string, src: string | undefined): boolean {
  if (kind === 'explicit') {
    return (
      safeReadTransform(src) !== null ||
      safeReadExponential(src) !== null ||
      safeReadLogarithmic(src) !== null ||
      safeReadSinusoid(src) !== null ||
      safeReadLogistic(src) !== null
    )
  }
  if (kind === 'implicit') {
    let info: ReturnType<typeof conicSectionInfo> = null
    try {
      info = conicSectionInfo(src, 'implicit')
    } catch {
      info = null
    }
    return info !== null && info.kind !== 'class'
  }
  return false
}

/**
 * What the facts say, as short lines: "images (−2, 3), (−1, 3/2), (0, 1) …",
 * "vertex: (0, 1)", "range: y ≥ 1"; for a conic its feature sentences. Empty
 * when the line has no family reading.
 */
export function familyFactLines(
  kind: string,
  src: string | undefined,
  /** For a parametric or polar curve: the curve and its models (its Motion section's features). */
  curve?: FittedCurve,
  models?: Record<string, ModelSpec>,
): string[] {
  if ((kind === 'parametric' || kind === 'polar') && curve && models) {
    const mk = motionKindOf(curve, models)
    const f = mk ? safeMotionFeatures(curve, models) : null
    return f && mk ? motionMarks(f, mk).map((p) => `${p.label}: (${p.exactX ?? p.pos.x}, ${p.exactY ?? p.pos.y})`) : []
  }
  if (kind === 'explicit') {
    const r = familyRestriction(src)
    const spec = safeReadTransform(src)
    if (!spec) return familySectionLines(src, r)
    const out: string[] = []
    const rows = pointRows(spec).filter((row) => {
      const x = r ? pointX(row.to) : null
      return x === null || r === null || r.within(x)
    })
    if (rows.length > 0) out.push(`images: ${rows.map((row) => row.to).join(', ')}`)
    // Domain and range are answers of their own (the card's Domain rows), so
    // the projector says them once, under their own names.
    out.push(...factsWithin(featureLines(spec), r).filter((l) => !/^(domain|range):/.test(l)))
    return out
  }
  if (kind === 'implicit') {
    let info: ReturnType<typeof conicSectionInfo> = null
    try {
      info = conicSectionInfo(src, 'implicit')
    } catch {
      info = null
    }
    if (!info || info.kind === 'class') return []
    const f = info.kind === 'conic' ? safeConicFeatures(info.spec) : info.rot.features
    if (!f) return []
    const pts = (list: readonly { xText: string; yText: string }[]): string =>
      list.map((p) => `(${p.xText}, ${p.yText})`).join(', ')
    const out: string[] = []
    if (f.center) out.push(`center: ${pts([f.center])}`)
    if (f.vertices.length > 0) out.push(`vertices: ${pts(f.vertices)}`)
    if (f.foci.length > 0) out.push(`foci: ${pts(f.foci)}`)
    if (f.directrix) out.push(`directrix: ${f.directrix.text}`)
    if (f.asymptotes.length > 0) out.push(`asymptotes: ${f.asymptotes.map((a) => a.text).join(', ')}`)
    out.push(...f.sentences)
    return out
  }
  return []
}

/**
 * The facts of the one family section that speaks for a line no
 * Transformation reading covers (sin x + cos x, 1000/(1 + 49e^(−0.3x)),
 * 3 log(2x)), in the card's precedence: exponential, logarithm, sinusoid,
 * logistic. Domain and range are left to their own answers.
 */
function familySectionLines(src: string | undefined, r: ReturnType<typeof familyRestriction>): string[] {
  const keep = (lines: readonly string[]): string[] =>
    factsWithin(lines, r).filter((l) => !/^\s*(domain|range)\b/i.test(l))
  const exp = safeReadExponential(src)
  if (exp) return keep([...(safeRate(exp)?.sentences ?? []), ...expFeatureLines(safeExpFeatures(exp))])
  const log = safeReadLogarithmic(src)
  if (log) {
    const f = logFacts(safeLogFeatures(log))
    return keep([...f.sentences, ...f.features])
  }
  const sin = safeReadSinusoid(src)
  if (sin) return keep(safeSinFeatures(sin)?.sentences ?? [])
  const lg = safeReadLogistic(src)
  if (lg) return keep(logisticFactLines(lg, defaultForm(lg)))
  return []
}

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

type CurveLike = Pick<FittedCurve, 'id' | 'kind' | 'modelId'>

/**
 * The family-facts key for a curve, or null when its card has no such facts:
 * a typed line that calls no other curve and is not an inequality, read back
 * as a transformed parent (explicit) or an axis-aligned / rotated conic
 * (implicit). The same test the card makes before it shows those sections.
 */
export function familyKeyOf(
  curve: CurveLike,
  src: string | undefined,
  models: Record<string, ModelSpec>,
  depKey?: string,
): string | null {
  if (!curve.modelId.startsWith('expr_') || depKey !== undefined || !src) return null
  if (typeof models[curve.modelId]?.inequality === 'function') return null
  return hasFamilyFacts(curve.kind, src) ? familyKey(curve.id) : null
}

/** True when a line of this kind has family facts on its card (familyKeyOf, without the model checks). */
export function hasFamilyFacts(kind: string, src: string | undefined): boolean {
  if (kind === 'explicit') return safeReadTransform(src) !== null
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
export function familyFactLines(kind: string, src: string | undefined): string[] {
  if (kind === 'explicit') {
    const spec = safeReadTransform(src)
    if (!spec) return []
    const out: string[] = []
    const rows = pointRows(spec)
    if (rows.length > 0) out.push(`images: ${rows.map((r) => r.to).join(', ')}`)
    // Domain and range are answers of their own (the card's Domain rows), so
    // the projector says them once, under their own names.
    out.push(...featureLines(spec).filter((l) => !/^(domain|range):/.test(l)))
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

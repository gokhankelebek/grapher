// ============================================================================
// src/ui/dashes.ts — one dash pattern per curve, so meaning never rides on
// colour alone.
//
// The AP item bank's house style draws every curve of a figure in one black
// ink and tells them apart by dash (src/ui/itemBank.ts); the colour-blind-safe
// palette (src/core/a11yPalette.ts) borrows the same assignment on screen and
// in every export, through renderBoard's scene field `inkPalette`.
// ============================================================================

import type { FittedCurve } from '../core/types'
import type { CurveStyle, StyleMap } from '../core/persist'

/**
 * Dash patterns, in the order curves take them under house style: solid,
 * dashed, dotted, dash-dot — the Curve ⋯ → Line presets first, so a curve the
 * teacher dashed by hand reads the same as one dashed here.
 */
export const HOUSE_DASHES: readonly (readonly number[])[] = [[], [8, 6], [2, 5], [10, 4, 2, 4]]

/**
 * The colour-blind-safe palette's patterns: the house four first (so a figure
 * reads the same in both), then two more, so six curves on one board never
 * share a pattern. All six differ in rhythm, not only in length.
 */
export const A11Y_DASHES: readonly (readonly number[])[] = [
  ...HOUSE_DASHES,
  [18, 6], // long dash
  [10, 4, 2, 4, 2, 4], // dash-dot-dot
]

/** The styles a scene draws with under the safe palette: every visible curve its own pattern. */
export function paletteDashes(curves: readonly FittedCurve[], styles: StyleMap): StyleMap {
  return houseDashes(curves, styles, A11Y_DASHES)
}

const sameDash = (a: readonly number[] | undefined, b: readonly number[]): boolean =>
  (a?.length ?? 0) === b.length && (a ?? []).every((v, i) => v === b[i])

/**
 * One dash pattern per visible curve: a curve the teacher dashed keeps its
 * dash; every other takes the next house pattern nobody has yet. With more
 * curves than patterns the cycle repeats (and the curves' names tell them apart).
 */
export function houseDashes(
  curves: readonly FittedCurve[],
  styles: StyleMap,
  patterns: readonly (readonly number[])[] = HOUSE_DASHES,
): StyleMap {
  const out: StyleMap = { ...styles }
  const shown = curves.filter((c) => c.visible)
  const used: (readonly number[])[] = []
  for (const c of shown) {
    const d = styles[c.id]?.dash
    if (d && d.length > 0) used.push(d)
  }
  let next = 0
  for (const c of shown) {
    const own = styles[c.id]?.dash
    if (own && own.length > 0) continue
    let pick: readonly number[] | null = null
    for (let k = 0; k < patterns.length; k++) {
      const cand = patterns[(next + k) % patterns.length]
      if (!used.some((u) => sameDash(u, cand))) {
        pick = cand
        next = (next + k + 1) % patterns.length
        break
      }
    }
    if (!pick) {
      pick = patterns[next % patterns.length]
      next++
    }
    used.push(pick)
    const style: CurveStyle = { ...(styles[c.id] ?? {}) }
    if (pick.length > 0) style.dash = pick.slice()
    else delete style.dash
    out[c.id] = style
  }
  return out
}


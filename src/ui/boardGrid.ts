// ============================================================================
// src/ui/boardGrid.ts — which RULING a cartesian board is drawn on.
//
// A rose read off a square lattice is a picture of a rose. Read off circles
// and spokes it is a rose you can measure: r = 2cos(3θ) has petals of length 2
// and the circle labelled 2 is right there. The renderer has drawn both since
// a7a046b; this is the half that decides which one a board is on.
//
// It is a property of the BOARD, like the axis units and for the same reason:
// a polar lesson is a polar lesson on any machine, and a teacher who put the
// board back on squares must find it on squares tomorrow.
//
// The one thing this does NOT do is decide for anybody. `suggestPolarRuling`
// is a recommendation the App offers in a line at the foot of the board with
// one tap to accept — a board that silently re-ruled itself under a curve
// mid-lesson would be the worst possible moment for a surprise.
//
// Pure: no React, no DOM, no canvas.
// ============================================================================

import type { FittedCurve } from '../core/types'
import type { BoardGrid } from '../core/persist'

export type { BoardGrid }

/** The two rulings, in the order the control shows them. */
export const RULINGS: ReadonlyArray<{ value: BoardGrid; label: string; title: string }> = [
  {
    value: 'cartesian',
    label: 'Square',
    title: 'The square lattice: x across, y up',
  },
  {
    value: 'polar',
    label: 'Polar',
    title: 'Circles of constant r and spokes of constant θ — how a polar curve is read',
  },
]

/**
 * The curve families that are POLAR — the ones whose equation is r in terms
 * of θ, and which therefore have a natural reading on circles and spokes.
 *
 * A fitted rose, limaçon or spiral is self-identifying by family. A typed
 * `r = 2cos(3θ)` is not: its family is `expr_N`, and what says it is polar is
 * the kind the parser gave it — which is on the curve itself.
 */
const POLAR_MODELS = new Set(['polarRose', 'limacon', 'spiral'])

export function isPolarCurve(curve: FittedCurve): boolean {
  return curve.kind === 'polar' || POLAR_MODELS.has(curve.modelId)
}

/**
 * Should this board be OFFERED the polar ruling?
 *
 * True exactly when something visible on it is polar. Deliberately shaped
 * like `suggestAxisUnits` — a recommendation, re-asked whenever the curve set
 * changes, never a decision.
 */
export function suggestPolarRuling(curves: readonly FittedCurve[]): boolean {
  for (const c of curves) {
    if (!c.visible) continue
    if (isPolarCurve(c)) return true
  }
  return false
}

/** How a toast names the ruling it is offering. */
export const POLAR_OFFER =
  'That curve is polar. Rule the board in circles and spokes?'

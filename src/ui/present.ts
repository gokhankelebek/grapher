// ============================================================================
// src/ui/present.ts — the board, read from the back of a room.
//
// Measured before this existed: nothing in the UI rendered above 13.65px, and
// the axis tick labels were 11px. Projected at 1280x720 across an 8m room that
// is roughly 15mm of cap height — under a third of what a person at the back
// can read. There was no presentation affordance of any kind, and the one
// thing that looked like one (hiding the sidebar) made it WORSE: the equations
// live on the cards, so hiding them left four anonymous coloured curves.
//
// So presentation mode is three things together, and it is not useful as any
// one of them alone:
//
//   scale    every font, stroke, marker, handle and hit target grows at once
//            (renderBoard's `present`, which CanvasStage already routes
//            through handleHitRadius so a bigger handle is grabbable further
//            out rather than drawn away from its own target)
//   quiet    the sidebar goes, and the toolbar shrinks to a corner cluster
//            that fades when the pointer stops — it sat over the top 12% of
//            the plot, which is exactly where a maximum is
//   legend   each visible curve's equation, in its own colour, ON the board,
//            because that is what hiding the sidebar took away
//
// This module is the pure half: the scale ladder and what the legend says.
// ============================================================================

import type { FittedCurve, ModelSpec, NLItem } from '../core/types'
import { displayEquationLatex } from './equationText'
import { nlInequality, nlNotation } from './nlText'

export interface PresentScale {
  type: number
  stroke: number
}

/**
 * The stroke scale that goes with a type scale.
 *
 * Not the same number: type has to grow faster than line weight or a projected
 * board turns into a poster of thick ribbons. At the 2.5x default this gives
 * 1.6x strokes, which is the pairing the audit asked for.
 */
export function presentScale(type: number): PresentScale {
  const t = Number.isFinite(type) && type > 0 ? Math.min(6, Math.max(0.5, type)) : 1
  return { type: t, stroke: 1 + (t - 1) * 0.4 }
}

/** The default: 11px axis labels become 27.5px, which reads across a room. */
export const DEFAULT_PRESENT_TYPE = 2.5

/** How long the corner cluster stays up after the pointer stops moving. */
export const TOOLBAR_IDLE_MS = 2000

export interface LegendEntry {
  id: string
  color: string
  /** KaTeX source — the equation exactly as the card prints it. */
  tex: string
  /** A plain-text fallback for the accessible name. */
  text: string
}

/**
 * What the legend says for a graph board.
 *
 * The same rule the card uses: a typed source that still matches the params
 * wins over the family's generated latex, so a lesson about factored form
 * projects the factored form rather than having it expanded on the wall.
 */
export function curveLegend(
  curves: readonly FittedCurve[],
  models: Record<string, ModelSpec>,
  displaySources: Record<string, string>,
): LegendEntry[] {
  const out: LegendEntry[] = []
  for (const c of curves) {
    if (!c.visible) continue
    const spec = models[c.modelId]
    let tex: string | null = null
    if (!c.modelId.startsWith('expr_')) {
      try {
        tex = displayEquationLatex(displaySources[c.id], c, spec)
      } catch {
        tex = null
      }
    }
    if (tex === null) {
      try {
        tex = spec ? spec.latex(c.params) : c.modelId
      } catch {
        tex = c.modelId
      }
    }
    out.push({ id: c.id, color: c.color, tex, text: spec?.name ?? c.modelId })
  }
  return out
}

/** What the legend says for a number line: the set, and the same set as an
 *  inequality, which is the pair a worksheet asks for. */
export function itemLegend(items: readonly NLItem[]): LegendEntry[] {
  return items.map((it) => ({
    id: it.id,
    color: it.color,
    tex: `${nlNotation(it)}\\quad ${nlInequality(it)}`,
    text: it.label ?? (it.kind === 'point' ? 'point' : 'interval'),
  }))
}

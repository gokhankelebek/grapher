// ============================================================================
// src/ui/calcMenu.ts — WHICH calculus a curve's ⋯ menu offers.
//
// One rule, two readers: the curve card's ⋯ menu (src/ui/CurveCard.tsx) and
// the command palette (src/ui/commands.ts). Kept here, free of React, so the
// palette can never offer a tool the menu would not — and a test can ask the
// question without rendering a card.
// ============================================================================

import type { CalcKind, CardCalc } from './calcLinks'

/** A menu item's kind: a calculus link, or "Area between curves…" (which arms a pick). */
export type CalcMenuKind = CalcKind | 'between'

/**
 * The calculus the ⋯ menu offers, grouped the way an AP course meets it:
 * limits and derivatives (Units 1–2, and the secant of Unit 5's MVT), then
 * integrals (Riemann sums and the definite integral of Unit 6, the areas and
 * volumes of Unit 8), then series (BC Unit 10).
 */
export const CALC_GROUPS: { title: string; items: { kind: CalcMenuKind; label: string }[] }[] = [
  {
    title: 'Limits & derivatives',
    items: [
      { kind: 'limit', label: 'Limit at a point' },
      { kind: 'secant', label: 'Average rate of change (secant)' },
      { kind: 'tangent', label: 'Tangent line' },
      { kind: 'derivative', label: 'Derivative f′' },
      { kind: 'signchart', label: 'Sign chart (f′, f″)' },
    ],
  },
  {
    title: 'Integrals',
    items: [
      { kind: 'riemann', label: 'Riemann sum' },
      { kind: 'area', label: 'Area under curve' },
      { kind: 'between', label: 'Area between curves…' },
      { kind: 'accumulation', label: 'Accumulation function ∫ₐˣ f' },
      { kind: 'volume', label: 'Volume of a solid…' },
    ],
  },
  {
    title: 'Series',
    items: [{ kind: 'taylor', label: 'Taylor polynomial Pₙ' }],
  },
  {
    // BC Unit 9: offered only on a parametric or polar curve, and there alone
    title: 'Parametric & polar',
    items: [
      { kind: 'pcalc', label: 'Calculus at t (dy/dx, speed, arc length)' },
      { kind: 'polarbetween', label: 'Area between polar curves' },
    ],
  },
]

/** The menu items that belong to parametric and polar curves only. */
export const MOTION_ITEMS: ReadonlySet<string> = new Set(['pcalc', 'polarbetween'])

/** The parts of a card's CardCalc the menu's decision reads. */
export type CalcMenuFacts = Pick<CardCalc, 'canAdd' | 'implicitOnly' | 'motion' | 'polarPartner' | 'taylorBlocked'>

/**
 * Whether the ⋯ menu lists this item for a curve. `calc` is the curve's
 * CardCalc (null/undefined: no Calculus group at all); `betweenCanAdd` is
 * whether another curve is there to shade between.
 *
 * An implicit curve (x² + y² = 25) offers the tangent line only; a parametric
 * or polar curve offers only its own calculus (and the polar area between two
 * curves when a partner is on the board). Taylor is LISTED even when blocked —
 * the menu greys it out with the reason (see calcMenuBlocked).
 */
export function calcMenuOffers(
  kind: CalcMenuKind,
  calc: CalcMenuFacts | null | undefined,
  betweenCanAdd: boolean | undefined,
): boolean {
  if (!calc || !calc.canAdd) return false
  if (calc.motion) return kind === 'pcalc' || (kind === 'polarbetween' && calc.polarPartner === true)
  if (MOTION_ITEMS.has(kind)) return false
  if (calc.implicitOnly) return kind === 'tangent'
  return kind !== 'between' || betweenCanAdd === true
}

/** Why an offered item is greyed out, or null when it can be chosen. */
export function calcMenuBlocked(kind: CalcMenuKind, calc: CalcMenuFacts | null | undefined): string | null {
  if (kind === 'taylor' && calc?.taylorBlocked) return calc.taylorBlocked
  return null
}

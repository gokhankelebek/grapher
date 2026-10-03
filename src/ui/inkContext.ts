// ============================================================================
// src/ui/inkContext.ts — the colour a card shows for its object.
//
// Curve colours are stored in the standard palette; the colour-blind-safe
// palette (src/core/a11yPalette.ts) maps them at paint time. The sidebar's
// swatches and card accents read the same mapping through this context, so a
// card's dot is the colour of the curve the board draws. The sidebar is dark
// in every theme, so it is always the screen half of the palette.
// ============================================================================

import { createContext, useContext } from 'react'

const identity = (c: string): string => c

export const InkContext = createContext<(color: string) => string>(identity)

/** The colour to show for a stored object colour. */
export function useInk(): (color: string) => string {
  return useContext(InkContext)
}

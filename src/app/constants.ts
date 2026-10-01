// ============================================================================
// src/app/constants.ts — App's module-level constants.
//
// Stable identities (the empty lists) and the tuning numbers the App hooks
// share. Moved out of App.tsx unchanged.
// ============================================================================

import type { EndCap, FitResult, FittedCurve, SpecialPoint } from '../core/types'
import type { BoardIntersection } from '../ui/intersections'
import type { Mode } from './types'

/** The shared "no alternative fits" list (see candidatesFor). */
export const NO_CANDIDATES: FitResult[] = []

/** The one value. Nothing sets it any more. */
export const MODE: Mode = 'draw'

/** How long the board sits idle before it is written to storage. */
export const AUTOSAVE_MS = 400

/** Stable identity — avoids re-rendering the canvas when markers are hidden. */
export const EMPTY_CONTEXT: { curve: FittedCurve; points: SpecialPoint[] }[] = []

export const EMPTY_ANALYSIS: SpecialPoint[] = []

/** One array, so a board with nothing crossing re-renders no more than before. */
export const EMPTY_CROSSINGS: BoardIntersection[] = []

export const HISTORY_LIMIT = 100

/** The undo label a run of caption typing folds into. */
export const CAPTION_LABEL = 'figure caption'

/** How an end cap names itself in "Undo curve ends: arrow". */
export const END_CAP_WORDS: Record<EndCap, string> = {
  auto: 'auto',
  none: 'nothing',
  arrow: 'arrow',
  open: 'open dot',
  closed: 'closed dot',
}

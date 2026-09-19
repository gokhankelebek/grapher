// ============================================================================
// src/ui/answerContext.ts — "which pieces are this answer?", available to a
// card that was only handed one of them.
//
// A solution set like "x < −2 or x ≥ 3" is ONE answer in TWO items. A card is
// rendered per item, so on its own it can only ever speak for its own ray —
// which is exactly the bug the label had, and would be the bug Copy had if it
// copied "[3, ∞)" when the answer is "(−∞, −2) ∪ [3, ∞)".
//
// The board already knows the whole picture, so it publishes it here rather
// than threading two more props through a list component that has no opinion
// about either. Empty by default: a card outside a board is an answer of one,
// which is what it is.
// ============================================================================

import { createContext } from 'react'
import type { NLItem } from '../core/types'
import type { StyleMap } from '../core/persist'

export interface AnswerBoard {
  items: readonly NLItem[]
  styles: StyleMap
}

export const AnswerContext = createContext<AnswerBoard>({ items: [], styles: {} })

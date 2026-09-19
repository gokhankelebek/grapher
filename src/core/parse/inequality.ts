// ============================================================================
// Inequality / solution-set parser for number-line boards.
//   export function parseInequality(src: string): InequalityOutcome
//
// Implements the parseInequality contract at the bottom of src/core/types.ts.
//
// The comparison grammar, the interval algebra and the normalisation all live
// in ./condition.ts, because a restricted domain (`y = x^2 {0 <= x < 3}`) and
// a piecewise branch condition are the same question asked by ./index.ts —
// "which parts of the line does this name?" — and one answer is enough.
// This module is what turns that answer into number-line items.
//
// Bounds are parsed by the expression engine in ./index.ts (via analyzeExpr),
// so anything that engine accepts as a constant works as a bound: 2*pi,
// sqrt(2), -3/4, |−5|, 10^-2.
// ============================================================================

import type { InequalityOutcome } from '../types'
import { analyzeExpr } from './index'
import {
  CondError,
  newCtx,
  parseCondition,
  setLatex,
  toItems,
  type NLItemDraft,
} from './condition'

export type { NLItemDraft }

export function parseInequality(src: string): InequalityOutcome {
  try {
    if (!src || src.trim() === '') {
      return { ok: false, error: 'Empty input — write something like x < 3 or [-2, 5)' }
    }
    const ctx = newCtx(analyzeExpr)
    const pieces = parseCondition(src, ctx)
    const items: NLItemDraft[] = toItems(pieces)
    return { ok: true, items, latex: setLatex(pieces, ctx.tex) }
  } catch (err) {
    if (err instanceof CondError) {
      return err.pos !== undefined
        ? { ok: false, error: err.message, pos: err.pos }
        : { ok: false, error: err.message }
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

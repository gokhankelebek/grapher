// ============================================================================
// src/ui/nlText.ts — what a solution set SAYS, in the two notations a
// worksheet asks for, as KaTeX and as plain text.
//
// Two things made this a module of its own.
//
// 1. Copy was PNG-only. The thing that actually goes into an answer key is the
//    notation — "(−∞, −2) ∪ [3, ∞)" — and it could not be got out of the app
//    except by retyping it. Plain text is therefore a first-class rendering
//    here, not a by-product of the LaTeX one.
//
// 2. "3 ≤ x". Every restatement puts the variable on the LEFT, because that is
//    where a teacher writes it: x ≥ 3, never 3 ≤ x. The two-sided form keeps
//    its canonical shape (−2 ≤ x < 5) — there the variable is in the middle on
//    purpose, and flipping it into two clauses is not how anyone writes it.
//
// An ANSWER may be several items: "x < −2 or x ≥ 3" is one answer in two
// pieces. Both notations join across the pieces, so what comes out of Copy is
// the whole answer rather than the piece that happened to be selected.
// ============================================================================

import type { NLItem } from '../core/types'
import { intervalNotation } from '../core/types'
import type { CurveStyle, StyleMap } from '../core/persist'

/** Six significant digits, trailing zeros trimmed — the number as written. */
function trimNum(v: number): string {
  const s = v.toPrecision(6)
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

/** A minus sign, not a hyphen. Plain text only; LaTeX sets its own. */
const minus = (s: string): string => s.replace(/-/g, '−')

// ---------------------------------------------------------------- one item

/** What this item says, in the notation the worksheet asks for (KaTeX). */
export function nlNotation(item: NLItem): string {
  return item.kind === 'point' ? `\\{${trimNum(item.x)}\\}` : intervalNotation(item)
}

/**
 * The same thing as an inequality (KaTeX), with x on the left.
 *
 * A single bound reads "x ≥ 3". A two-sided interval keeps the compound form
 * "−2 ≤ x < 5", which is the canonical way it is written and still has the
 * variable in one place rather than two.
 */
export function nlInequality(item: NLItem): string {
  if (item.kind === 'point') return `x ${item.closed ? '=' : '\\neq'} ${trimNum(item.x)}`
  const { lo, hi, loClosed, hiClosed } = item
  if (lo !== null && hi !== null) {
    return `${trimNum(lo)} ${loClosed ? '\\le' : '<'} x ${hiClosed ? '\\le' : '<'} ${trimNum(hi)}`
  }
  if (lo !== null) return `x ${loClosed ? '\\ge' : '>'} ${trimNum(lo)}`
  if (hi !== null) return `x ${hiClosed ? '\\le' : '<'} ${trimNum(hi)}`
  return 'x \\in \\mathbb{R}'
}

/** Interval notation as text, ready to paste: "[3, ∞)". */
export function nlNotationText(item: NLItem): string {
  if (item.kind === 'point') return `{${minus(trimNum(item.x))}}`
  const lo = item.lo === null ? '−∞' : minus(trimNum(item.lo))
  const hi = item.hi === null ? '∞' : minus(trimNum(item.hi))
  const l = item.lo === null ? '(' : item.loClosed ? '[' : '('
  const r = item.hi === null ? ')' : item.hiClosed ? ']' : ')'
  return `${l}${lo}, ${hi}${r}`
}

/** The inequality as text, ready to paste: "x ≥ 3". */
export function nlInequalityText(item: NLItem): string {
  if (item.kind === 'point') return `x ${item.closed ? '=' : '≠'} ${minus(trimNum(item.x))}`
  const { lo, hi, loClosed, hiClosed } = item
  if (lo !== null && hi !== null) {
    return `${minus(trimNum(lo))} ${loClosed ? '≤' : '<'} x ${
      hiClosed ? '≤' : '<'
    } ${minus(trimNum(hi))}`
  }
  if (lo !== null) return `x ${loClosed ? '≥' : '>'} ${minus(trimNum(lo))}`
  if (hi !== null) return `x ${hiClosed ? '≤' : '<'} ${minus(trimNum(hi))}`
  return 'x ∈ ℝ'
}

// ------------------------------------------------------------- whole answer

/**
 * The pieces of the answer this item belongs to, in board order.
 *
 * Pieces are tied together by a group stamp written when the answer was parsed
 * (see persist.ts / CurveStyle.group). An item with no stamp — every item that
 * existed before answers had pieces, and every point placed by hand — is an
 * answer of one, which is exactly what it is.
 */
export function answerPieces(
  items: readonly NLItem[],
  styles: StyleMap,
  id: string,
): NLItem[] {
  const self = items.find((it) => it.id === id)
  if (!self) return []
  const group = groupOf(styles[id])
  if (group === undefined) return [self]
  return items.filter((it) => groupOf(styles[it.id]) === group)
}

/** The group stamp on a style record, if it carries one. */
export function groupOf(style: CurveStyle | undefined): string | undefined {
  const g = style?.group
  return typeof g === 'string' && g !== '' ? g : undefined
}

/** Interval notation for a whole answer: "(−∞, −2) ∪ [3, ∞)". */
export function answerNotationText(pieces: readonly NLItem[]): string {
  return pieces.map(nlNotationText).join(' ∪ ')
}

/** The same answer as inequalities: "x < −2 or x ≥ 3". */
export function answerInequalityText(pieces: readonly NLItem[]): string {
  return pieces.map(nlInequalityText).join(' or ')
}

/**
 * Both notations, one per line — what Copy puts on the clipboard.
 *
 * Both, because which one the worksheet wants is not knowable from here, and
 * a teacher deleting the line they don't need costs one keystroke where
 * retyping the one they do costs a minute and a bracket mistake.
 */
export function answerClipboardText(pieces: readonly NLItem[]): string {
  if (pieces.length === 0) return ''
  return `${answerNotationText(pieces)}\n${answerInequalityText(pieces)}`
}

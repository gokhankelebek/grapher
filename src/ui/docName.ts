// ============================================================================
// src/ui/docName.ts — naming a new document.
//
// The saved list read:
//
//   Untitled            just now
//   Untitled copy       4 min ago
//   Untitled copy copy  11 min ago
//
// Three documents distinguished by nothing but a relative timestamp, in an app
// where a teacher's boards differ by what KIND they are and what is on them. A
// new board is now named for its kind and numbered, so the list says something
// before it is opened: "Graph 3", "Number line 2".
//
// Pure, so the numbering can be tested without storage.
// ============================================================================

import type { BoardKind } from '../core/types'

export const KIND_BASE: Record<BoardKind, string> = {
  cartesian: 'Graph',
  'number-line': 'Number line',
}

/**
 * The next free name for a board of this kind.
 *
 * "Next free" rather than "one more than the highest": deleting Graph 2 and
 * making another should give Graph 2 back, not Graph 4. Names that merely
 * start with the base ("Graph of f") are not in the sequence and are ignored.
 */
export function nextDocName(kind: BoardKind, existing: readonly string[]): string {
  const base = KIND_BASE[kind]
  const taken = new Set<number>()
  const pattern = new RegExp(`^${base}\\s+(\\d+)$`, 'i')
  for (const name of existing) {
    const m = pattern.exec(typeof name === 'string' ? name.trim() : '')
    if (m) taken.add(Number(m[1]))
  }
  let n = 1
  while (taken.has(n)) n++
  return `${base} ${n}`
}

/**
 * The name a copy of `name` should take.
 *
 * "Untitled copy copy copy" was the old answer. A copy of a numbered board
 * takes the next free number of its kind instead, and anything else gains one
 * "copy" and then starts counting.
 */
export function copyDocName(
  kind: BoardKind,
  name: string,
  existing: readonly string[],
): string {
  const base = KIND_BASE[kind]
  if (new RegExp(`^${base}\\s+\\d+$`, 'i').test(name.trim())) {
    return nextDocName(kind, existing)
  }
  const stem = name.replace(/\s+copy(\s+\d+)?$/i, '').trim() || name.trim() || base
  const used = new Set(existing.map((n) => n.trim().toLowerCase()))
  const first = `${stem} copy`
  if (!used.has(first.toLowerCase())) return first
  let n = 2
  while (used.has(`${first} ${n}`.toLowerCase())) n++
  return `${first} ${n}`
}

/** What a board holds, counted by the things a teacher would name. */
export interface DocCounts {
  curves: number
  points: number
  intervals: number
}

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`

/**
 * "4 curves", "2 intervals" — what is actually on a board, for the list.
 *
 * A number line says which KIND of thing it holds while it holds only one
 * kind, because "2 intervals" is a description of the answer and "2 items" is
 * a description of the data structure.
 */
export function describeCounts(kind: BoardKind, c: DocCounts): string {
  if (kind === 'number-line') {
    const { points, intervals } = c
    if (points === 0 && intervals === 0) return 'empty'
    if (points === 0) return plural(intervals, 'interval')
    if (intervals === 0) return plural(points, 'point')
    return plural(points + intervals, 'item')
  }
  return c.curves === 0 ? 'empty' : plural(c.curves, 'curve')
}

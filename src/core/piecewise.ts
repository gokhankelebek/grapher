// ============================================================================
// Piecewise and step functions, built and read the way a teacher states them
// (src/core/piecewise.ts)
//
//     f(x) = { x² + 1   if x < 0
//            { 3        if 0 ≤ x ≤ 2
//            { −x + 5   if x > 2
//
// The parser already reads piecewise lines ({expr if cond, expr if cond}
// and restricted domains) — see src/core/parse/index.ts and condition.ts —
// so, like every sibling (factored, exponential, logarithmic, sinusoidal,
// transform), a spec becomes a TYPED EXPRESSION. This module is the bridge
// between that text and a table of pieces a card can edit, plus the
// analysis a piecewise question asks for: what happens at each breakpoint.
//
// The PARSER, in the same wave, fills ModelSpec.pieces (src/core/types.ts)
// with each piece's interval and closed/open ends, so the renderer can draw
// the filled and open dots every textbook piecewise graph has.
//
//   export function piecewiseSource(spec): string
//       canonical parseable source in the parser's piecewise syntax.
//   export function readPiecewise(src): PiecewiseSpec | null
//       any typed piecewise line (or a single restricted expression) → the
//       table; null for anything else. Verified numerically.
//   export function breakpoints(spec, evalPiece): Breakpoint[]
//       at every boundary between consecutive pieces and at every bounded
//       end: the left and right limits, the value (from whichever piece
//       includes the point, or none), and the verdict: 'continuous',
//       'jump' (size), 'removable' (limits agree, value missing or
//       different), 'infinite' (a side runs away), 'gap' (the pieces do not
//       meet — x in neither), 'overlap' (both include it — an error in the
//       definition, named); with a teacher sentence ("jump of 2 at x = 0:
//       left limit 1, right limit 3, f(0) = 3").
//   export function stepSpec(kind, opts): PiecewiseSpec | string
//       step functions: 'floor' ⌊x⌋, 'ceil' ⌈x⌉, 'round', and a 'table' of
//       constant values on intervals (a postage / parking / tax table) —
//       returns a spec when a table is given, or the one-line typed source
//       a·⌊b(x − h)⌋ + k for the greatest-integer family.
// ============================================================================

export interface PieceSpec {
  /** The expression in x, as typed: "x^2 + 1", "3", "-x + 5". */
  expr: string
  /** Lower bound as typed, absent for −∞. */
  lo?: string
  /** Upper bound as typed, absent for +∞. */
  hi?: string
  loClosed: boolean
  hiClosed: boolean
}

export interface PiecewiseSpec {
  /** The function's name when typed as f(x) = …; absent for y = … */
  name?: string
  pieces: PieceSpec[]
}

export type BreakKind = 'continuous' | 'jump' | 'removable' | 'infinite' | 'gap' | 'overlap' | 'end'

export interface Breakpoint {
  x: number
  xText: string
  leftLimit: number | null
  rightLimit: number | null
  value: number | null
  kind: BreakKind
  sentence: string
}

// TODO(core agent): implement.
export function piecewiseSource(_spec: PiecewiseSpec): string {
  return 'y = 0'
}

export function readPiecewise(_src: string): PiecewiseSpec | null {
  return null
}

export function breakpoints(
  _spec: PiecewiseSpec,
  _evalPiece: (index: number, x: number) => number,
): Breakpoint[] {
  return []
}

export function stepSpec(
  kind: 'floor' | 'ceil' | 'round' | 'table',
  _opts: { a?: string; b?: string; h?: string; k?: string; table?: { lo: string; hi: string; value: string; loClosed: boolean; hiClosed: boolean }[] },
): PiecewiseSpec | string {
  return kind === 'table' ? { pieces: [] } : 'y = floor(x)'
}

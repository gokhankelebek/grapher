// ============================================================================
// Functions built from their roots (src/core/factored.ts)
//
// A teacher sets a polynomial by its zeros and their multiplicities, and a
// rational function by the zeros of its numerator and its denominator:
//
//     y = 2(x + 1)²(x − 3)                    roots −1 (×2), 3 (×1), a = 2
//     y = (x − 1)(x + 2)² / ((x − 3)(x + 1))   num 1, −2 (×2); den 3, −1
//
// Everything visible is still a TYPED EXPRESSION: a factored spec is turned
// into source text and goes through the ordinary parser, so analysis, holes,
// vertical/horizontal/slant asymptotes, exact forms, intersections, end caps
// and figure styles all apply unchanged. This module is the two-way bridge
// between that text and a list of factors a card can edit.
//
//   export function factoredSource(spec): string
//       spec → "y = 2(x + 1)^2(x - 3)", canonical, parseable by
//       parseExpression. Roots keep the text the teacher gave them, so
//       sqrt(2) stays sqrt(2) and 1/2 stays 1/2 in the equation.
//   export function readFactored(src): FactoredSpec | null
//       the inverse, for ANY typed explicit expression that is a product of
//       a constant and powers of linear factors (x − r), (x + r), (ax − b),
//       bare x, and irreducible quadratics, over another such product —
//       so a curve typed by hand as y = (x-1)^2(x+3) gets the root editor
//       too. null for anything else (sums of products, x^2 − 1 unfactored).
//   export function rootsOf(spec): FactoredRoot[]
//       the numeric value, side and multiplicity of every real root, with
//       what the graph does there: 'crosses' (odd multiplicity), 'touches'
//       (even), 'flattens' (odd ≥ 3, crosses with an inflection); for the
//       denominator 'asymptote-odd' (sign changes across) / 'asymptote-even'
//       (same sign both sides); a root shared by numerator and denominator
//       cancels down to min(m, n) and is 'hole' when the numerator's
//       multiplicity is ≥ the denominator's, else still an asymptote of the
//       leftover multiplicity.
//   export function leadingThrough(spec, point): number | null
//       the leading coefficient a that makes the curve pass through `point`
//       (null when the point is a root, a pole, or the product is 0 there).
//   export function endBehaviour(spec): string
//       one teacher sentence: "degree 3, a > 0: falls to the left, rises to
//       the right", "degrees 2/2: horizontal asymptote y = 2",
//       "degrees 3/2: slant asymptote".
// ============================================================================

/** One factor of the numerator or the denominator. */
export interface Factor {
  /**
   * A real root, as the teacher wrote it: "3", "-1", "1/2", "sqrt(2)",
   * "-2pi". Evaluated with the app's numeric expression parser.
   */
  root?: string
  /**
   * Instead of a real root, a complex-conjugate pair p ± qi, written as the
   * irreducible quadratic (x² − 2px + p² + q²). Both as strings, as above.
   */
  complex?: { re: string; im: string }
  /** Multiplicity, a whole number ≥ 1. */
  mult: number
}

export interface FactoredSpec {
  /** The function's name when typed as f(x) = …; absent for y = … */
  name?: string
  /** Leading coefficient, as written ("2", "-1/2", "sqrt(3)"). */
  a: string
  num: Factor[]
  /** Empty for a polynomial. */
  den: Factor[]
}

export type RootBehaviour =
  | 'crosses'
  | 'touches'
  | 'flattens'
  | 'asymptote-odd'
  | 'asymptote-even'
  | 'hole'

export interface FactoredRoot {
  x: number
  /** Which list it came from; a cancelled root reports 'both'. */
  side: 'num' | 'den' | 'both'
  /** The multiplicity that decides the behaviour (after cancelling). */
  mult: number
  behaviour: RootBehaviour
  /** Index into spec.num / spec.den (the numerator's for 'both'). */
  index: number
}

// TODO(core agent): implement.
export function factoredSource(_spec: FactoredSpec): string {
  return 'y = 0'
}

export function readFactored(_src: string): FactoredSpec | null {
  return null
}

export function rootsOf(_spec: FactoredSpec): FactoredRoot[] {
  return []
}

export function leadingThrough(
  _spec: FactoredSpec,
  _point: { x: number; y: number },
): number | null {
  return null
}

export function endBehaviour(_spec: FactoredSpec): string {
  return ''
}

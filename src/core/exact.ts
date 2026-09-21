// ============================================================================
// Exact forms for the numbers a graph produces (src/core/exact.ts)
//
//   export function exactForm(v: number, opts?): ExactForm | null
//   export function verifiedExact(v, check, opts?): ExactForm | null
//
// A zero at 1.7320508075688772 IS √3, and a teacher wants to read √3. This
// module recognises the closed forms that occur in high-school mathematics
// and nothing else:
//     integers and small fractions      p/q            q ≤ 64
//     square roots and their multiples  a√n/b          n square-free ≤ 400, b ≤ 32
//     rational multiples of π           pπ/q           q ≤ 24
//     quadratic surds                   (a ± b√n)/c    c ≤ 12 — the roots of ax²+bx+c
//
// Two rules keep it honest:
//   * `exactForm` accepts only a match within `tol` (default 1e-11 relative),
//     which is what a bisected root or a closed-form vertex carries;
//   * `verifiedExact` is for values located less precisely (an extremum from
//     a golden-section search is good to ~1e-8): it proposes candidates at a
//     looser tolerance and returns the first whose exact value passes the
//     caller's `check` — |f(c)| ≈ 0 for a zero, |f′(c)| ≈ 0 for an extremum,
//     |f″(c)| ≈ 0 for an inflection — evaluated at the candidate itself.
//     A form that fails the check is a coincidence, and is never shown.
//
// `text` is plain Unicode for the card and the board chip ("2√3/9",
// "−π/4", "(1+√5)/2"); `tex` is KaTeX for anything typeset ("\frac{2\sqrt{3}}{9}").
// `value` is the form evaluated in double precision, so callers can polish
// the point onto it.
//
// analyzeCurve attaches the results as SpecialPoint.exactX / exactY.
// ============================================================================

export interface ExactForm {
  text: string
  tex: string
  value: number
}

export interface ExactOpts {
  /** relative tolerance for a direct match; default 1e-11 */
  tol?: number
}

// TODO(core agent): implement.
export function exactForm(_v: number, _opts?: ExactOpts): ExactForm | null {
  return null
}

export function verifiedExact(
  _v: number,
  _check: (candidate: number) => boolean,
  _opts?: ExactOpts,
): ExactForm | null {
  return null
}

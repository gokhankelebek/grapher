// Numeric entry helpers shared by the on-canvas handle editor.
import { parseExpression } from '../core/parse'

const PLAIN_NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/

/** Probe points used to prove an expression is constant (doesn't depend on x). */
const PROBES = [0, 1, 7.3]

/**
 * Parse a typed value: a plain number, or a constant expression the shared
 * parser understands ("2*pi", "sqrt(2)", "3/4"). Returns null when the input
 * isn't a finite constant — an expression that varies with x (like "2x") is
 * rejected, since a coordinate field needs a single value.
 */
export function parseNumeric(src: string): number | null {
  const s = src.trim()
  if (!s) return null

  const plain = Number(s)
  if (PLAIN_NUMBER.test(s) && Number.isFinite(plain)) return plain

  try {
    const outcome = parseExpression(s)
    if (outcome.ok && outcome.plot.paramNames.length === 0) {
      const model = outcome.plot.makeModel('__const__')
      const evalExplicit = model.evalExplicit
      if (evalExplicit) {
        const params = outcome.plot.defaultParams
        const vals = PROBES.map((x) => evalExplicit.call(model, params, x))
        const [v0] = vals
        const constant =
          vals.every((v) => Number.isFinite(v)) &&
          vals.every((v) => Math.abs(v - v0) <= 1e-9 * Math.max(1, Math.abs(v0)))
        if (constant) return v0
      }
    }
  } catch {
    /* parser unavailable or threw — fall through to the plain reading */
  }

  return Number.isFinite(plain) ? plain : null
}

/**
 * 4-significant-digit coordinate for analysis readouts — keeps trailing zeros
 * so a column of values lines up (1.009, 3.002, −1.990), and uses a real minus
 * sign rather than a hyphen.
 */
/** Pure floating-point residue: arithmetic that should have cancelled to zero. */
const HARD_ZERO = 1e-12
/**
 * Resolution of a numerically located feature. Bisection and golden-section
 * bottom out near sqrt(eps) relative to the search interval, so a maximum
 * "at 1.05e-8" is at zero and the digits past that are noise, not precision.
 */
const SOLVER_SLOP = 1e-7
/**
 * Significant digits these readouts carry. A value smaller than one unit in
 * the last place of the curve's own scale is BELOW WHAT THE COLUMN CAN SHOW:
 * printing "5.09e-4" beside a wave of height 6.5 states a midline to nine
 * digits of precision that the row next to it does not have. That value is not
 * wrong — it is simply zero at the resolution this table is drawn at.
 */
const DISPLAY_SIG = 4
const DISPLAY_FLOOR = Math.pow(10, -DISPLAY_SIG)

/**
 * The floor below which a value is reported as 0, for a value of this
 * provenance living on a curve of this size. Shared by formatCoord and
 * formatSig so a coefficient and a coordinate never disagree about zero.
 *
 * `scale` is opt-in: with no scale there is no curve to be small against, and
 * only pure arithmetic residue (and, for a numeric solve, the solver's own
 * resolution) is snapped. That is what keeps a deliberate 1e-5 readable.
 */
function zeroFloor(scale: number | undefined, exact: boolean | undefined): number {
  const known = scale !== undefined && Number.isFinite(scale) && scale > 0
  const s = known ? (scale as number) : 1
  let floor = exact === false ? Math.max(HARD_ZERO, SOLVER_SLOP * s) : HARD_ZERO * s
  if (known) floor = Math.max(floor, DISPLAY_FLOOR * s)
  return floor
}

/**
 * Format an analysis coordinate.
 *
 * A cubic's inflection at the origin arrives as 1.662e-14 and a cosine's peak
 * as 1.05e-8. Printing those instead of 0 makes the tool look like it cannot do
 * arithmetic, and it is the kind of thing that costs a teacher's trust in front
 * of a class. Anything below the floor is reported as the zero it is.
 *
 * @param opts.scale  magnitude the value lives at (a curve's extent), so the
 *                    floor tracks the graph rather than assuming order 1.
 * @param opts.exact  false when the value came from a numeric solve rather than
 *                    closed form — SpecialPoint.exact carries exactly this.
 */
export function formatCoord(
  v: number,
  opts?: { scale?: number; exact?: boolean },
): string {
  if (!Number.isFinite(v)) return '—'
  if (Math.abs(v) <= zeroFloor(opts?.scale, opts?.exact)) return '0'
  const abs = Math.abs(v)
  const s = abs >= 1e5 || abs < 1e-3 ? v.toExponential(2) : v.toPrecision(4)
  // NB: replace only the LEADING sign — a replace('-','−') on "1e-14" would
  // convert the exponent's hyphen instead and leave the sign ASCII.
  return s.startsWith('-') ? '−' + s.slice(1) : s
}

/**
 * Compact 4-significant-digit rendering for pre-filled input values.
 *
 * Same floors as formatCoord, for the same reason: a coefficient readout of
 * "b = −2.93e−16" is a fit that cancelled to zero, and a card that shows it
 * next to a curve drawn through the origin is showing its own arithmetic. The
 * scale is optional and the one-argument call is unchanged, so a field with no
 * curve behind it still only snaps genuine residue.
 */
export function formatSig(v: number, opts?: { scale?: number }): string {
  if (!Number.isFinite(v)) return '0'
  if (Math.abs(v) <= zeroFloor(opts?.scale, undefined)) return '0'
  const abs = Math.abs(v)
  if (abs >= 1e6 || abs < 1e-4) return v.toExponential(3)
  return String(Number(v.toPrecision(4)))
}

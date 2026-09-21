// Numeric entry helpers shared by the on-canvas handle editor.
import type { SpecialPoint } from '../core/types'
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

// ---------------------------------------------------------------------------
// Exact forms
//
// A zero at √3 is not "1.732". The decimal is the answer a calculator gives;
// the closed form is the answer the question was asking for, and on an AP free
// response it is the one that earns the point. analyzeCurve fills in
// SpecialPoint.exactX / exactY whenever it can VERIFY one (src/core/exact.ts),
// and leaves them absent otherwise — so this file's job is only to decide how
// the two readings sit next to each other, once, for every surface that prints
// a special point: the card row, the on-board chip, the overlay.
//
// THE RULE, stated once:
//
//   1. Each coordinate prints its exact form when it has one, and its decimal
//      when it does not. That is what makes a mixed pair read "(π/2, 1.000)"
//      rather than forcing a closed form onto a coordinate that has none.
//   2. When ANY coordinate of the point has an exact form, the whole value is
//      printed twice — the exact reading, then "≈", then the ordinary decimal
//      reading. Both sides stay well-formed values, so the decimal column still
//      lines up and either side can be read on its own.
//   3. When NO coordinate has one, the value is the decimal alone — byte for
//      byte what this app printed before exact forms existed. A form that is
//      no more than a plain numeral for the number already on the row ("2"
//      beside 2.000) counts as no form at all, by rule 3 and not as an
//      exception to it: it is one value written twice — except that a
//      coordinate CONFIRMED to be a whole number prints bare on both sides,
//      "(−1, 2)" and "(√2, 2) ≈ (1.414, 2)", never padded to "2.000".
//
// A chip asks for rule 2 to be dropped (`decimal: false`): a label on the board
// is a name for the point, not a table of it, and "(√3, 0) ≈ (1.732, 0)" on a
// plate beside the curve is two answers where a reader wanted one.
// ---------------------------------------------------------------------------


/** The sign this app uses between a closed form and its decimal. */
export const APPROX = '≈'

export interface PointTextOpts {
  /** Magnitude the point lives at — formatCoord's zero floor. */
  scale?: number
  /**
   * Print the decimal beside the exact form (rule 2). Default true, which is
   * the card. False is the chip: the exact form alone, decimal only as the
   * fallback for a coordinate that has no closed form.
   */
  decimal?: boolean
  /**
   * Which coordinates are printed. Default follows the readout: a zero is a
   * single x (its y is 0 by definition), everything else is a pair.
   */
  axes?: 'x' | 'y' | 'pair'
}

export interface PointParts {
  /** The exact reading, or null when no coordinate of this point has one. */
  exact: string | null
  /** The decimal reading — always well formed, always the pre-exact string. */
  decimal: string
  /** The two of them, per the rule above. */
  text: string
}

/** A closed form that is a plain numeral: "2", "−1", "1.5". */
const PLAIN_FORM = /^[-−+]?(\d+\.?\d*|\.\d+)$/
/** A closed form that is a whole number: "2", "−1". */
const INT_FORM = /^[-−+]?\d+$/

/**
 * A coordinate the curve has CONFIRMED to be a whole number prints bare —
 * "(−1, 2)", "(√2, 2)" — not padded to the decimal column "(−1.000, 2.000)".
 * The padding exists so that a column of measured decimals lines up; a value
 * that is known to be exactly 2 is not a measurement, and "2.000" would claim
 * a precision it does not have while hiding the one it does. Only a verified
 * integer form qualifies: a sketched vertex that merely rounds to 2.000 keeps
 * its decimals.
 */
function bareInteger(s: string | undefined, v: number): string | null {
  if (typeof s !== 'string') return null
  const t = s.trim()
  if (!INT_FORM.test(t)) return null
  const n = Number(t.replace(/−/g, '-'))
  if (!Number.isFinite(n) || Math.abs(n - v) > 1e-9 * Math.max(1, Math.abs(v))) return null
  return n === 0 ? '0' : `${n < 0 ? '−' : ''}${Math.abs(n)}`
}

/**
 * A stored exact form, or null — where "no form" also covers a form with
 * nothing to say.
 *
 * Defensive about the shape rather than trusting it: these strings survive a
 * round trip through a saved document, and a blank one must read as "no closed
 * form" rather than printing "  ≈ 1.732" with a hole where the answer was.
 *
 * And a cubic's maximum at exactly (−1, 2) is the case that would otherwise
 * make this feature LOUD for no gain: "(−1, 2) ≈ (−1.000, 2.000)" is the same
 * two numbers twice, on every polynomial row, in a sidebar a teacher reads at
 * a glance. A form that is a plain numeral for the value already being printed
 * is dropped, and the row stays the aligned decimal column it has always been.
 * √3, π/4 and 3/2 are not plain numerals, and are kept.
 */
function exactForm(s: string | undefined, v: number): string | null {
  if (typeof s !== 'string') return null
  const t = s.trim()
  if (t.length === 0) return null
  if (PLAIN_FORM.test(t)) {
    const n = Number(t.replace(/−/g, '-'))
    if (Number.isFinite(n) && Math.abs(n - v) <= 1e-9 * Math.max(1, Math.abs(v))) return null
  }
  return t
}

/** Which coordinates a point's readout shows, when the caller doesn't say. */
function defaultAxes(kind: SpecialPoint['kind']): 'x' | 'pair' {
  return kind === 'zero' ? 'x' : 'pair'
}

/**
 * The two readings of a special point, kept apart so the card can set the
 * decimal in a lighter tone than the closed form it approximates.
 */
export function pointParts(p: SpecialPoint, opts: PointTextOpts = {}): PointParts {
  const o = { scale: opts.scale, exact: p.exact }
  const axes = opts.axes ?? defaultAxes(p.kind)
  const dx = bareInteger(p.exactX, p.pos.x) ?? formatCoord(p.pos.x, o)
  const dy = bareInteger(p.exactY, p.pos.y) ?? formatCoord(p.pos.y, o)
  const ex = exactForm(p.exactX, p.pos.x)
  const ey = exactForm(p.exactY, p.pos.y)

  let decimal: string
  let exact: string | null
  if (axes === 'x') {
    decimal = dx
    exact = ex
  } else if (axes === 'y') {
    decimal = dy
    exact = ey
  } else {
    decimal = `(${dx}, ${dy})`
    exact = ex || ey ? `(${ex ?? dx}, ${ey ?? dy})` : null
  }

  // "0 ≈ 0" is not a closed form beside its decimal, it is the same character
  // twice with a hedge between them. A form that already reads as the decimal
  // has nothing to add.
  if (exact === decimal) exact = null

  const wantDecimal = opts.decimal !== false
  const text =
    exact === null ? decimal : wantDecimal ? `${exact} ${APPROX} ${decimal}` : exact
  return { exact, decimal, text }
}

/**
 * One special point, as every surface in the app prints it.
 *
 * `pointText(p)` is the card: "√3 ≈ 1.732", "(√3/3, −2√3/9) ≈ (0.577, −0.385)",
 * and plain "(1.200, −3.400)" for a point with no closed form.
 * `pointText(p, { decimal: false })` is the board chip: "√3", "(√3, 0)".
 */
export function pointText(p: SpecialPoint, opts: PointTextOpts = {}): string {
  return pointParts(p, opts).text
}

/** Digits the hover tooltip spends on a value the row prints in closed form. */
const DETAIL_PLACES = 6

/**
 * The decimal a closed form stands for, at tooltip precision.
 *
 * The row prints four significant digits because it is a column; a teacher who
 * stops on "√3" and wants to check it against a calculator wants more than
 * that, and the tooltip is the one place that costs nothing to read.
 */
export function exactDetail(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const s = v.toFixed(DETAIL_PLACES)
  return s.startsWith('-') ? '−' + s.slice(1) : s
}

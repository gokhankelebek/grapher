// ============================================================================
// Data tables and regression (src/core/data.ts)
//
// A teacher pastes or types (x, y) data — from a Google Sheet, Excel, a
// DeltaMath item, a lab — plots it as a scatter plot and fits the models an
// AP Precalculus / Statistics course names. A regression becomes an ORDINARY
// TYPED CURVE (its source is a typed expression), linked to its table so it
// re-fits whenever the data changes, and so every analysis feature applies.
//
// Answers must MATCH A TI-84 / Desmos, because students check against their
// calculators: linear, quadratic, cubic, quartic are ordinary least squares;
// exponential (y = a·b^x), power (y = a·x^b) and logarithmic (y = a + b·ln x)
// are fitted the calculator way — least squares on the LINEARISED data
// (ln y vs x, ln y vs ln x, y vs ln x) — and say so; logistic and sinusoidal
// are nonlinear least squares, as the calculator's are.
//
//   export function parseDataText(text): DataParse
//       tab / comma / semicolon / whitespace separated columns, optional
//       header row (names become the column labels), CRLF, a trailing empty
//       line, a thousands comma inside quotes, a decimal comma when the
//       separator is ';' — the shapes a spreadsheet paste produces. Two
//       columns → x, y; one column → y with x = 1, 2, 3 …; more → the first
//       two, with a note naming the ignored ones.
//   export function fitRegression(kind, xs, ys): RegressionResult
//   export function regressionSource(result, digits = 4): string
//       the typed expression for the curve, coefficients rounded the way
//       the card prints them (TI-style 4 decimals by default):
//       "y = 1.2345x + 0.5", "y = 3.1(1.0512)^x", "y = 2.3x^1.5",
//       "y = 1.1 + 2.04ln(x)", "y = 10/(1 + 4.5e^(-0.8x))",
//       "y = 2.5sin(1.047(x - 0.3)) + 4" — each parseable by parseExpression.
//   export function suggestModels(xs, ys): RegressionKind[]
//       the kinds that CAN be fitted to this data (exponential needs y all
//       one sign, power and log need x > 0, polynomial degree n needs n + 1
//       distinct x, sinusoidal needs ≥ 5 points), best first by r² among
//       the cheap ones — a hint, never an automatic choice.
// ============================================================================

export type RegressionKind =
  | 'linear'
  | 'quadratic'
  | 'cubic'
  | 'quartic'
  | 'exponential'
  | 'power'
  | 'logarithmic'
  | 'logistic'
  | 'sinusoidal'

export interface DataParse {
  ok: boolean
  xs: number[]
  ys: number[]
  /** Column labels from a header row, else "x" / "y". */
  xLabel: string
  yLabel: string
  /** Rows that could not be read, 1-based, with the reason. */
  skipped: { row: number; reason: string }[]
  /** Anything worth telling the teacher ("ignored columns C, D"). */
  notes: string[]
  error?: string
}

export interface RegressionResult {
  ok: boolean
  kind: RegressionKind
  /**
   * Coefficients by name, full precision: linear {a, b} for y = ax + b;
   * polynomial {a, b, c, …} highest power first; exponential {a, b};
   * power {a, b}; logarithmic {a, b} for y = a + b ln x; logistic {c, a, b}
   * for y = c/(1 + a e^(−bx)); sinusoidal {a, b, c, d} for y = a sin(bx + c) + d.
   */
  coef: Record<string, number>
  /** Coefficient of determination on the ORIGINAL data (what the card shows). */
  r2: number
  /** Correlation coefficient r — linear and the linearised fits only, as a TI. */
  r?: number
  /** For the linearised fits, r² on the transformed data (the TI's number). */
  r2Linearised?: number
  residuals: number[]
  /** Why a fit is not possible: "exponential needs every y positive". */
  error?: string
  /** "fitted like a TI-84: least squares on ln y" and similar. */
  notes: string[]
}

// TODO(core agent): implement.
export function parseDataText(_text: string): DataParse {
  return { ok: false, xs: [], ys: [], xLabel: 'x', yLabel: 'y', skipped: [], notes: [] }
}

export function fitRegression(kind: RegressionKind, _xs: number[], _ys: number[]): RegressionResult {
  return { ok: false, kind, coef: {}, r2: NaN, residuals: [], notes: [] }
}

export function regressionSource(_result: RegressionResult, _digits = 4): string {
  return 'y = 0'
}

export function suggestModels(_xs: number[], _ys: number[]): RegressionKind[] {
  return []
}

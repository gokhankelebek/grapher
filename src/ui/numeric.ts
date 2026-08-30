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
export function formatCoord(v: number): string {
  if (!Number.isFinite(v)) return '—'
  if (v === 0) return '0'
  const abs = Math.abs(v)
  const s = abs >= 1e5 || abs < 1e-3 ? v.toExponential(2) : v.toPrecision(4)
  return s.replace('-', '−')
}

/** Compact 4-significant-digit rendering for pre-filled input values. */
export function formatSig(v: number): string {
  if (!Number.isFinite(v)) return '0'
  if (v === 0) return '0'
  const abs = Math.abs(v)
  if (abs >= 1e6 || abs < 1e-4) return v.toExponential(3)
  return String(Number(v.toPrecision(4)))
}

// ============================================================================
// src/ui/kindLabel.ts — the word at the top of a curve's card: what it IS.
//
// A sketched parabola said "Parabola" and the same curve typed as x^2 - 4 said
// "Expression" — the parser's name for every typed line. One vocabulary for
// both: a sketch keeps its family's name, and a typed line is named by what
// its formula is (a polynomial by its degree, a conic by its kind, otherwise
// by the one family of function it uses), falling back to "Function".
//
// Pure: no React, no DOM.
// ============================================================================

import { polynomialOf } from '../core/calculus'
import { readConic } from '../core/conics'
import { MODELS } from '../core/fit/models'
import type { FittedCurve, ModelSpec } from '../core/types'

/** A polynomial's name by degree — the sketch families' own words where they exist. */
const POLY_LABELS = ['Constant', 'Line', 'Parabola', 'Cubic', 'Quartic']

const CONIC_LABELS: Record<string, string> = {
  circle: 'Circle',
  ellipse: 'Ellipse',
  hyperbola: 'Hyperbola',
  parabola: 'Parabola',
}

function safe<T>(f: () => T): T | null {
  try {
    return f()
  } catch {
    return null
  }
}

/** The one family a typed right-hand side uses, when it uses exactly one. */
function familyOf(src: string): string | null {
  const rhs = src.slice(src.indexOf('=') + 1)
  const word = (w: string): RegExp => new RegExp(`(?<![A-Za-z])(?:${w})(?![A-Za-z])`)
  const has = {
    sinusoid: word('sin|cos').test(rhs),
    trig: word('tan|sec|csc|cot').test(rhs),
    inverseTrig: word('asin|acos|atan|arcsin|arccos|arctan').test(rhs),
    log: word('ln|log(?:_\\w+)?').test(rhs) || /(?<![A-Za-z])log_/.test(rhs),
    exp: word('exp').test(rhs) || /(?<![A-Za-z])e\s*\^|\d\s*\^\s*\(?[^)]*x/.test(rhs),
    sqrt: word('sqrt').test(rhs),
    cbrt: word('cbrt').test(rhs),
    abs: /\||(?<![A-Za-z])abs(?![A-Za-z])/.test(rhs),
  }
  const on = Object.entries(has)
    .filter(([, v]) => v)
    .map(([k]) => k)
  if (on.length !== 1) {
    // sin with tan is still trigonometric
    if (on.length === 2 && has.sinusoid && has.trig) return 'Trigonometric'
    return null
  }
  switch (on[0]) {
    case 'sinusoid':
      return 'Sinusoid'
    case 'trig':
      return 'Trigonometric'
    case 'inverseTrig':
      return 'Inverse trig'
    case 'log':
      return 'Logarithm'
    case 'exp':
      return /\/\s*\(?\s*\d*\s*\+|\/\s*\(\s*1\s*\+/.test(rhs) ? 'Logistic' : 'Exponential'
    case 'sqrt':
      return 'Square root'
    case 'cbrt':
      return 'Cube root'
    case 'abs':
      return 'Absolute value'
  }
  return null
}

/**
 * The card's kind label. `source` is a typed curve's line (exprSources);
 * `spec` its model. Never throws.
 */
export function kindLabel(
  curve: FittedCurve,
  spec: ModelSpec | undefined,
  models: Record<string, ModelSpec>,
  source?: string | null,
): string {
  const own = spec?.name ?? curve.modelId
  // A sketch, or a curve built FROM another (a tangent, f′, Pₙ): its model's name.
  if (!curve.modelId.startsWith('expr_') || MODELS[curve.modelId]) return own
  if (!spec) return own
  if (typeof spec.inequality === 'function') return 'Inequality'
  if (curve.kind === 'polar') return 'Polar curve'
  if (curve.kind === 'parametric') return 'Parametric curve'
  const src = (source ?? '').trim()
  if (curve.kind === 'implicit') {
    const conic = src ? safe(() => readConic(src)) : null
    return (conic && CONIC_LABELS[conic.kind]) || 'Implicit curve'
  }
  const pieces = spec.pieces ? safe(() => spec.pieces!(curve.params)) : null
  if (pieces && pieces.length > 1) return 'Piecewise'
  const poly = safe(() => polynomialOf(curve, models))
  if (poly) {
    let deg = poly.length - 1
    while (deg > 0 && Math.abs(poly[deg]) < 1e-12) deg--
    return POLY_LABELS[deg] ?? 'Polynomial'
  }
  if (src) {
    const fam = familyOf(src)
    if (fam) return fam
    const sing = spec.singularities ? safe(() => spec.singularities!(curve.params, [-50, 50])) : null
    if (sing && sing.length > 0 && /\//.test(src)) return 'Rational'
  }
  return 'Function'
}

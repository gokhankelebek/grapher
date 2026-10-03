// ============================================================================
// src/core/residuals.ts — assessing a fit by its residuals (NC Math 1
// S-ID.6b) and the correlation coefficient in words (S-ID.8).
//
//   residualPattern(xs, residuals)
//       "no clear pattern" or "a curved pattern", by two simple checks on the
//       residuals taken in x order:
//         CURVATURE  how much of the residuals' variation a parabola in x
//                    explains (R² of residual ~ a + b·x + c·x²). A line's
//                    residuals have no linear trend left by construction, so
//                    what a parabola explains is the bend the model missed.
//         RUNS       the Wald–Wolfowitz runs test on the signs: a bend gives
//                    long runs of + then − then +, far fewer runs than chance.
//       "Curved" needs a strong curvature, or a moderate one that the runs
//       test backs up. Fewer than six points: no verdict. Worded cautiously:
//       "appears", "may not be".
//   correlationWords(r)
//       strength and direction in the AP / NC wording: |r| ≥ 0.8 strong,
//       ≥ 0.5 moderate, ≥ 0.3 weak, below that little or no linear association.
//   CAUSATION — the one-line reminder that r says nothing about cause.
//
// Pure: no DOM, no React.
// ============================================================================

export type ResidualVerdict = 'none' | 'curved' | 'few'

export interface ResidualPattern {
  verdict: ResidualVerdict
  /** R² of the residuals on a parabola in x (0 … 1). */
  curvature: number
  /** Sign runs in x order, and what chance would give. */
  runs: number
  expectedRuns: number
  /** (runs − expected) / SD; strongly negative = too few runs = a pattern. */
  runsZ: number
  /** The residuals spread out (or in) along x. */
  fan: 'out' | 'in' | null
  /** The sentence for the card: cautious, and about THIS model. */
  sentence: string
}

/** Fewer points than this: no verdict on a pattern. */
export const RESID_MIN_N = 6
/** A parabola explaining this share of the residuals' variation is a curve on its own… */
export const CURVE_STRONG = 0.75
/** …and this share is one when the runs test agrees. */
export const CURVE_MODERATE = 0.4
/** The runs test's z at or below this backs a moderate curvature up. */
export const RUNS_Z = -1.28

/** Solve a small linear system (Gaussian elimination with partial pivoting). */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-12) return null
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((row, i) => row[n] / row[i])
}

/** R² of y on a + b·u + c·u² (u: x centred and scaled, so the normal equations are well conditioned). */
export function quadraticR2(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length
  if (n < 4) return 0
  let mx = 0
  for (const x of xs) mx += x
  mx /= n
  let sx = 0
  for (const x of xs) sx = Math.max(sx, Math.abs(x - mx))
  if (!(sx > 0)) return 0
  const u = xs.map((x) => (x - mx) / sx)
  const S = [0, 0, 0, 0, 0]
  const T = [0, 0, 0]
  for (let i = 0; i < n; i++) {
    let p = 1
    for (let k = 0; k < 5; k++) {
      S[k] += p
      if (k < 3) T[k] += p * ys[i]
      p *= u[i]
    }
  }
  const coef = solve(
    [
      [S[0], S[1], S[2]],
      [S[1], S[2], S[3]],
      [S[2], S[3], S[4]],
    ],
    T,
  )
  if (!coef) return 0
  let my = 0
  for (const y of ys) my += y
  my /= n
  let sse = 0
  let sst = 0
  for (let i = 0; i < n; i++) {
    const f = coef[0] + coef[1] * u[i] + coef[2] * u[i] * u[i]
    sse += (ys[i] - f) ** 2
    sst += (ys[i] - my) ** 2
  }
  if (!(sst > 1e-300)) return 0
  return Math.max(0, Math.min(1, 1 - sse / sst))
}

/** The sign runs of the residuals in x order (zeros skipped), with the runs test's expectation and z. */
export function signRuns(xs: readonly number[], res: readonly number[]): { runs: number; expected: number; z: number } {
  const order = xs.map((x, i) => i).sort((a, b) => xs[a] - xs[b] || a - b)
  const scale = Math.max(1e-300, ...res.map((r) => Math.abs(r)))
  const signs: number[] = []
  for (const i of order) {
    const r = res[i]
    if (Math.abs(r) <= 1e-9 * scale) continue
    signs.push(r > 0 ? 1 : -1)
  }
  const n1 = signs.filter((s) => s > 0).length
  const n2 = signs.length - n1
  let runs = signs.length > 0 ? 1 : 0
  for (let i = 1; i < signs.length; i++) if (signs[i] !== signs[i - 1]) runs++
  const N = n1 + n2
  if (n1 === 0 || n2 === 0 || N < 2) return { runs, expected: runs, z: 0 }
  const expected = 1 + (2 * n1 * n2) / N
  const variance = (2 * n1 * n2 * (2 * n1 * n2 - N)) / (N * N * (N - 1))
  const z = variance > 0 ? (runs - expected) / Math.sqrt(variance) : 0
  return { runs, expected, z }
}

function corr(a: readonly number[], b: readonly number[]): number {
  const n = a.length
  if (n < 3) return 0
  let ma = 0
  let mb = 0
  for (let i = 0; i < n; i++) {
    ma += a[i]
    mb += b[i]
  }
  ma /= n
  mb /= n
  let sab = 0
  let saa = 0
  let sbb = 0
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb)
    saa += (a[i] - ma) ** 2
    sbb += (b[i] - mb) ** 2
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0
}

/**
 * The verdict on a residual plot. `model` names the fit in the sentence
 * ("a linear model", "this quadratic model").
 */
export function residualPattern(xs: readonly number[], residuals: readonly number[], model = 'a linear model'): ResidualPattern {
  const pts: { x: number; r: number }[] = []
  for (let i = 0; i < Math.min(xs.length, residuals.length); i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(residuals[i])) pts.push({ x: xs[i], r: residuals[i] })
  }
  const X = pts.map((p) => p.x)
  const R = pts.map((p) => p.r)
  const { runs, expected, z } = signRuns(X, R)
  if (pts.length < RESID_MIN_N) {
    return {
      verdict: 'few',
      curvature: 0,
      runs,
      expectedRuns: expected,
      runsZ: z,
      fan: null,
      sentence: `With only ${pts.length} point${pts.length === 1 ? '' : 's'} there are too few residuals to judge a pattern.`,
    }
  }
  const curvature = quadraticR2(X, R)
  const curved = curvature >= CURVE_STRONG || (curvature >= CURVE_MODERATE && z <= RUNS_Z)
  // A fan: the size of the residuals tracks x. Only said alongside "no clear curve".
  const fc = corr(X, R.map((r) => Math.abs(r)))
  const fan = !curved && pts.length >= 8 && Math.abs(fc) >= 0.7 ? (fc > 0 ? 'out' : 'in') : null
  let sentence: string
  if (curved) {
    sentence = `The residuals show a curved pattern — runs of positive and negative residuals along x — so ${model} may not be appropriate; a curve may fit the data better.`
  } else {
    sentence = `The residuals show no clear pattern — they scatter randomly above and below 0 — so ${model} appears appropriate.`
    if (fan) {
      sentence += ` (They do ${fan === 'out' ? 'spread out' : 'narrow'} as x increases, so predictions are less reliable ${fan === 'out' ? 'for larger' : 'for smaller'} x.)`
    }
  }
  return { verdict: curved ? 'curved' : 'none', curvature, runs, expectedRuns: expected, runsZ: z, fan, sentence }
}

// ---------------------------------------------------------------------------
// r in words
// ---------------------------------------------------------------------------

export type Strength = 'strong' | 'moderate' | 'weak' | 'none'

export interface CorrelationWords {
  strength: Strength
  direction: 'positive' | 'negative' | null
  /** "a strong positive linear association". */
  phrase: string
  /** "r = 0.94 suggests a strong positive linear association: as x increases, y tends to increase." */
  sentence: string
}

/** The thresholds, as the card states them. */
export const R_THRESHOLDS = '|r| ≥ 0.8 strong · 0.5 to 0.8 moderate · 0.3 to 0.5 weak · below 0.3 little or no linear association'

export function correlationWords(r: number, rText: string = r.toFixed(4).replace('-', '−'), x = 'x', y = 'y'): CorrelationWords {
  if (!Number.isFinite(r)) {
    return { strength: 'none', direction: null, phrase: 'no correlation', sentence: 'r is not defined for this data.' }
  }
  const a = Math.abs(r)
  const strength: Strength = a >= 0.8 ? 'strong' : a >= 0.5 ? 'moderate' : a >= 0.3 ? 'weak' : 'none'
  if (strength === 'none') {
    return {
      strength,
      direction: null,
      phrase: 'little or no linear association',
      sentence: `r = ${rText} suggests little or no linear association between ${x} and ${y}.`,
    }
  }
  const direction = r > 0 ? 'positive' : 'negative'
  const phrase = `a ${strength} ${direction} linear association`
  const trend = r > 0 ? `as ${x} increases, ${y} tends to increase` : `as ${x} increases, ${y} tends to decrease`
  return { strength, direction, phrase, sentence: `r = ${rText} suggests ${phrase}: ${trend}.` }
}

/** The one-line reminder under every r. */
export const CAUSATION = 'Correlation is not causation: a strong r alone does not show that x causes y.'

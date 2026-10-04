// ============================================================================
// Infinite series: partial sums, the sum, and the AP convergence tests
// (src/core/series.ts) — AP Calculus BC Unit 10.
//
// A series here is ALWAYS a sequence the board already has, summed from the
// index its window starts at:
//
//        Σ_{n=k₀}^{∞} aₙ          aₙ from src/core/sequences.ts
//
// explicit (a_n = 1/n^2), recursive (a_1 = 1, a_(n+1) = a_n/2) or a typed
// list. Nothing here parses; everything reads the terms (and, for an explicit
// formula, the same formula at a REAL index — the integral test's f(x)).
//
//   export function seriesSource(seq, params, k0, plain?): SeriesSource
//   export function analyzeSeries(src): SeriesAnalysis
//   export function partialSumsTo(src, N): number[]          S_k₀ … S_N
//   export function exactPartialSum(src, N): SeriesNumber | null
//
// WHAT IT ANSWERS, in the AP order (the list a "Show all tests" prints):
//
//   nth-term test         lim aₙ ≠ 0 ⇒ diverges; = 0 ⇒ inconclusive
//   geometric series      |r| < 1 converges to a/(1 − r), else diverges
//   p-series              C/nᵖ: p > 1 converges, p ≤ 1 diverges
//   telescoping           1/((n − r₁)(n − r₂)) with r₂ − r₁ a whole number
//   integral test         f positive, continuous, decreasing; ∫ f dx decides
//   direct comparison     against the dominant-term p-series (or geometric)
//   limit comparison      L = lim aₙ/bₙ with 0 < L < ∞
//   ratio test            L = lim |aₙ₊₁/aₙ|: < 1, > 1, = 1 inconclusive
//   alternating series    |aₙ| decreasing → 0, and |S − S_N| ≤ |a_(N+1)|
//   absolute convergence  Σ|aₙ| — absolute vs conditional
//
// THE VERDICT names the test an AP solution would write, which is not always
// the first one in that list: a recognised geometric or p-series says so
// first; a ratio test that decides (L ≠ 1 — the factorials and exponentials)
// comes before the nth-term test, because that is the test the exam expects
// for n!/10ⁿ; then the nth-term test (divergence only), telescoping, direct
// comparison, limit comparison and the integral test. Alternating and
// mixed-sign series go through absolute convergence first and the
// alternating series test second, so Σ(−1)ⁿ⁺¹/n reads "converges
// conditionally". Every test carries its own written reason, in AP words.
//
// HONESTY. Every limit here is read numerically — the terms far out (to
// n ≈ 1.6·10⁷ for a formula, 10⁴ for a recursion), extrapolated in 1/n — and
// a limit that does not settle is reported as "can't decide numerically",
// never guessed. Partial sums never decide convergence: Σ 1/(n ln n) looks
// finite to any computer and diverges, and it is the integral test (the
// logarithmic scale 1/(x (ln x)^q), q = 1) that says so. A sum is given only
// once convergence is established: exact where the series is recognised
// (a/(1 − r), ζ(2) = π²/6, ζ(4) = π⁴/90, ln 2, e, telescoping values),
// otherwise a number with an error estimate — or nothing, when the terms
// shrink too slowly to pin it down.
//
// Pure: no DOM, no React. Never throws.
// ============================================================================

import type { SeqKind, SequenceDef } from './sequences'
import { classify, continuousTerm, indexLetter, listTerms, niceNumber, termFormulaTex } from './sequences'
import { exactForm } from './exact'
import { parseAst } from './parse'
import type { ExprNode } from './parse'

const MINUS = '−'
/** A recursion is iterated this far (src/core/sequences.ts TERM_CAP). */
const RECURSIVE_CAP = 10_000
/** Terms read one by one from k₀: signs, monotonicity, patterns. */
const DENSE = 2000
/** How far out a formula's terms are read (2²⁴ ≈ 1.7·10⁷). */
const LADDER_TOP = 2 ** 24
/** A window of terms read at every far-out index: oscillation shows in it. */
const WINDOW = 16

// ============================================================================
// Public types
// ============================================================================

export type SeriesTestId =
  | 'nth-term'
  | 'geometric'
  | 'p-series'
  | 'telescoping'
  | 'integral'
  | 'direct-comparison'
  | 'limit-comparison'
  | 'ratio'
  | 'alternating'
  | 'absolute'

/**
 * What one test says. 'inconclusive' is the test's own answer (L = 1, lim = 0);
 * 'not-applicable' means its hypotheses fail (not positive, not alternating);
 * 'undecided' means the numbers could not settle what the test needs.
 */
export type SeriesOutcome = 'converges' | 'diverges' | 'inconclusive' | 'not-applicable' | 'undecided'

export const SERIES_TEST_NAMES: Readonly<Record<SeriesTestId, string>> = {
  'nth-term': 'nth-term test',
  geometric: 'Geometric series',
  'p-series': 'p-series',
  telescoping: 'Telescoping',
  integral: 'Integral test',
  'direct-comparison': 'Direct comparison test',
  'limit-comparison': 'Limit comparison test',
  ratio: 'Ratio test',
  alternating: 'Alternating series test',
  absolute: 'Absolute convergence',
}

/** The order "Show all tests" lists them in: the AP flow. */
export const SERIES_TEST_ORDER: readonly SeriesTestId[] = [
  'nth-term',
  'geometric',
  'p-series',
  'telescoping',
  'integral',
  'direct-comparison',
  'limit-comparison',
  'ratio',
  'alternating',
  'absolute',
]

export const OUTCOME_TEXT: Readonly<Record<SeriesOutcome, string>> = {
  converges: 'converges',
  diverges: 'diverges',
  inconclusive: 'inconclusive',
  'not-applicable': 'does not apply',
  undecided: 'can’t decide numerically',
}

/** A number as the card writes it: exact text and KaTeX where known. */
export interface SeriesNumber {
  value: number
  /** "π²/6", "1/2", "≈ 1.202057" */
  text: string
  tex: string
  exact: boolean
}

export interface SeriesTest {
  id: SeriesTestId
  name: string
  outcome: SeriesOutcome
  /** The written justification, AP style. */
  reason: string
  /** L of the ratio / limit comparison test, lim aₙ of the nth-term test. */
  limit?: SeriesNumber
  /** The comparison series bₙ ("1/n²"), for the comparison tests. */
  compare?: { text: string; tex: string }
}

export type SeriesVerdict =
  | 'converges'
  | 'converges-absolutely'
  | 'converges-conditionally'
  | 'diverges'
  | 'unknown'
  | 'finite'

export interface SeriesSum extends SeriesNumber {
  /** An error estimate for a numeric sum; 0 for an exact one. */
  error: number
  /** How it was found: "geometric: a/(1 − r)", "ζ(2) = π²/6", "numeric". */
  how: string
}

export type SignPattern = 'positive' | 'negative' | 'alternating' | 'mixed' | 'zero'

export interface SeriesAnalysis {
  k0: number
  /** "aₙ" in the sequence's letter. */
  termName: string
  /** KaTeX of Σ: \sum_{n=1}^{\infty} \frac{1}{n^{2}} */
  tex: string
  signs: SignPattern
  verdict: SeriesVerdict
  /** "Converges", "Converges conditionally", "Diverges", "Can't decide". */
  verdictText: string
  decidedBy: SeriesTestId | null
  /** The whole written argument for the verdict. */
  justification: string
  /** Every test, in SERIES_TEST_ORDER. */
  tests: SeriesTest[]
  sum: SeriesSum | null
  /** Why no sum is given although the series converges, when that needs saying. */
  sumNote: string | null
  /**
   * The alternating series error bound applies from here on: for every
   * N ≥ boundFrom, |S − S_N| ≤ |a_(N+1)|. Null for any other series.
   */
  boundFrom: number | null
  /** Why nothing can be said at all (an undefined term), or null. */
  problem: string | null
}

/** A sequence, as the series module reads it: terms with the sliders bound. */
export interface SeriesSource {
  /** The sequence letter: a, b, u … */
  name: string
  /** The index letter: n (k, i, j, m when typed so). */
  letter: string
  k0: number
  term(n: number): number
  /** The explicit formula at a real index, for the integral test; else null. */
  fx: ((x: number) => number) | null
  kind: SeqKind
  /** The largest index term() reaches. */
  maxIndex: number
  /** A typed list without "…": a finite sum, not an infinite series. */
  finite: boolean
  /** KaTeX of one term: \frac{1}{n^{2}}, or a_{n} for a rule. */
  termTex: string
  /** The formula as typed, plain ("1/(n ln n)"), for "f(x) = 1/(x ln x)"; else null. */
  plain: string | null
  /**
   * The term in log space — sign and ln|aₙ| — read off the typed formula
   * (factorials by log-gamma, bⁿ as n·ln b), so 2ⁿ/3ⁿ at n = 1024 is (2/3)¹⁰²⁴
   * and not ∞/∞. Null when there is no formula to read or it could not be
   * read faithfully; the term itself (term) already falls back to it.
   */
  logTerm?: ((n: number) => LogValue | null) | null
}

/** A number as sign and ln|v|: s ∈ {−1, 0, 1} (NaN: undefined), l = ln|v| (−∞ for 0). */
export interface LogValue {
  s: number
  l: number
  /** The plain value, when it is an ordinary finite double (kept exact: n = 1023, not e^(ln 1023)). */
  v?: number
}

// ============================================================================
// Building the source
// ============================================================================

/** Does this KaTeX have a + or − at the top level (so Σ needs parentheses)? */
function needsParens(tex: string): boolean {
  let depth = 0
  for (let i = 0; i < tex.length; i++) {
    const c = tex[i]
    if (c === '{' || c === '(' || c === '[') depth++
    else if (c === '}' || c === ')' || c === ']') depth--
    else if (tex.startsWith('\\left', i)) {
      depth++
      i += 4
    } else if (tex.startsWith('\\right', i)) {
      depth--
      i += 5
    } else if ((c === '+' || c === '-') && depth === 0 && i > 0) return true
  }
  return false
}

// ============================================================================
// Terms in log space: a term whose pieces overflow (100ⁿ, n!, 3ⁿ⁺¹) while the
// term itself is an ordinary number
// ============================================================================

const LN_2PI_HALF = 0.5 * Math.log(2 * Math.PI)

/** ln Γ(z) for z > 0: shifted up to z ≥ 15, then Stirling's series. */
export function lnGamma(z: number): number {
  if (!(z > 0)) return Number.NaN
  if (!Number.isFinite(z)) return Infinity
  let shift = 0
  while (z < 15) {
    shift += Math.log(z)
    z += 1
  }
  const z2 = z * z
  const series = 1 / (12 * z) - 1 / (360 * z * z2) + 1 / (1260 * z * z2 * z2) - 1 / (1680 * z * z2 * z2 * z2)
  return (z - 0.5) * Math.log(z) - z + LN_2PI_HALF + series - shift
}

/** ln(n!) — exact products while they are small, log-gamma beyond. */
export function lnFactorial(n: number): number {
  if (!(n >= 0)) return Number.NaN
  if (Number.isInteger(n) && n <= 20) {
    let f = 1
    for (let i = 2; i <= n; i++) f *= i
    return Math.log(f)
  }
  return lnGamma(n + 1)
}

const LV_NAN: LogValue = { s: Number.NaN, l: Number.NaN }
const LV_ZERO: LogValue = { s: 0, l: -Infinity }

function lvOf(v: number): LogValue {
  if (Number.isNaN(v)) return LV_NAN
  if (v === 0) return LV_ZERO
  const out: LogValue = { s: Math.sign(v), l: Math.log(Math.abs(v)) }
  if (Number.isFinite(v)) out.v = v
  return out
}

function lvNum(a: LogValue): number {
  if (Number.isNaN(a.s)) return Number.NaN
  if (a.v !== undefined) return a.v
  return a.s === 0 ? 0 : a.s * Math.exp(a.l)
}

/** A plain result of two plain values, when it is an ordinary nonzero double. */
function plainPair(a: LogValue, b: LogValue, op: (x: number, y: number) => number): LogValue | null {
  if (a.v === undefined || b.v === undefined) return null
  const r = op(a.v, b.v)
  return Number.isFinite(r) && r !== 0 ? lvOf(r) : null
}

function lvAdd(a: LogValue, b: LogValue): LogValue {
  if (Number.isNaN(a.s) || Number.isNaN(b.s)) return LV_NAN
  if (a.s === 0) return b
  if (b.s === 0) return a
  const [hi, lo] = a.l >= b.l ? [a, b] : [b, a]
  if (hi.l === Infinity) return lo.l === Infinity && lo.s !== hi.s ? LV_NAN : hi
  const d = lo.l - hi.l
  if (hi.s === lo.s) return { s: hi.s, l: hi.l + Math.log1p(Math.exp(d)) }
  if (d === 0) return LV_ZERO
  return { s: hi.s, l: hi.l + Math.log1p(-Math.exp(d)) }
}

/** Functions read on a plain (finite) argument. */
const LV_PLAIN: Record<string, (a: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  sec: (a) => 1 / Math.cos(a),
  csc: (a) => 1 / Math.sin(a),
  cot: (a) => Math.cos(a) / Math.sin(a),
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  floor: Math.floor,
  ceil: Math.ceil,
  sign: Math.sign,
}

class LvFail extends Error {}

/**
 * The typed formula as a log-space evaluator, or null when it cannot be read:
 * the index letter and the sliders bound, everything else refused.
 */
function logEvaluator(
  plain: string | null,
  letter: string,
  names: readonly string[],
  params: readonly number[],
): ((n: number) => LogValue | null) | null {
  if (!plain) return null
  const ast = parseAst(plain)
  if (!ast.ok || ast.rhs !== null) return null
  const slider = (name: string): number => {
    const i = names.indexOf(name)
    if (i < 0 || i >= params.length) throw new LvFail()
    return params[i]
  }
  const plainOf = (a: LogValue): number => {
    const v = lvNum(a)
    if (!Number.isFinite(v) && !Number.isNaN(v)) throw new LvFail()
    return v
  }
  const ev = (node: ExprNode, n: number): LogValue => {
    switch (node.t) {
      case 'num':
        return lvOf(node.v)
      case 'const':
        return lvOf(node.name === 'pi' ? Math.PI : node.name === 'tau' ? 2 * Math.PI : Math.E)
      case 'param':
        return lvOf(node.name === letter ? n : slider(node.name))
      case 'var':
        return lvOf(slider(node.name))
      case 'neg': {
        const a = ev(node.a, n)
        return a.v !== undefined ? lvOf(-a.v) : { s: -a.s, l: a.l }
      }
      case 'bin': {
        const a = ev(node.a, n)
        const b = ev(node.b, n)
        if (Number.isNaN(a.s) || Number.isNaN(b.s)) return LV_NAN
        switch (node.op) {
          case '+':
            return plainPair(a, b, (x, y) => x + y) ?? lvAdd(a, b)
          case '-':
            return plainPair(a, b, (x, y) => x - y) ?? lvAdd(a, { s: -b.s, l: b.l })
          case '*':
            if (a.s === 0 || b.s === 0) return LV_ZERO
            return plainPair(a, b, (x, y) => x * y) ?? { s: a.s * b.s, l: a.l + b.l }
          case '/':
            if (b.s === 0) return a.s === 0 ? LV_NAN : { s: a.s, l: Infinity }
            if (a.s === 0) return LV_ZERO
            return plainPair(a, b, (x, y) => x / y) ?? { s: a.s * b.s, l: a.l - b.l }
          case '^': {
            const pp = plainPair(a, b, Math.pow)
            if (pp) return pp
            const e = plainOf(b)
            if (Number.isNaN(e)) return LV_NAN
            if (a.s === 0) return e > 0 ? LV_ZERO : e === 0 ? lvOf(1) : { s: 1, l: Infinity }
            if (e === 0) return lvOf(1)
            if (a.s > 0) return { s: 1, l: e * a.l }
            if (!Number.isInteger(e)) throw new LvFail()
            return { s: e % 2 === 0 ? 1 : -1, l: e * a.l }
          }
        }
        throw new LvFail()
      }
      case 'call': {
        const args = node.args.map((x) => ev(x, n))
        const a = args[0]
        if (!a || args.some((x) => Number.isNaN(x.s))) return LV_NAN
        switch (node.fn) {
          case 'fact': {
            const x = plainOf(a)
            if (!(x >= 0)) throw new LvFail()
            if (Number.isInteger(x) && x <= 170) {
              let f = 1
              for (let i = 2; i <= x; i++) f *= i
              return lvOf(f)
            }
            return { s: 1, l: lnFactorial(x) }
          }
          case 'ln':
          case 'log':
          case 'log2':
          case 'log10': {
            if (a.s < 0) return LV_NAN
            if (a.s === 0) return { s: -1, l: Infinity }
            const div = node.fn === 'ln' ? 1 : node.fn === 'log2' ? Math.LN2 : Math.LN10
            return lvOf(a.l / div)
          }
          case 'log_': {
            const base = plainOf(a)
            const u = args[1]
            if (!u || !(base > 0) || base === 1) throw new LvFail()
            if (u.s < 0) return LV_NAN
            if (u.s === 0) return { s: base > 1 ? -1 : 1, l: Infinity }
            return lvOf(u.l / Math.log(base))
          }
          case 'sqrt':
            if (a.s < 0) return LV_NAN
            if (a.v !== undefined) return lvOf(Math.sqrt(a.v))
            return a.s === 0 ? LV_ZERO : { s: 1, l: a.l / 2 }
          case 'cbrt':
            if (a.v !== undefined) return lvOf(Math.cbrt(a.v))
            return a.s === 0 ? LV_ZERO : { s: a.s, l: a.l / 3 }
          case 'abs':
            return a.v !== undefined ? lvOf(Math.abs(a.v)) : { s: Math.abs(a.s), l: a.l }
          case 'exp': {
            const x = lvNum(a)
            if (Number.isNaN(x)) return LV_NAN
            if (x === -Infinity) return LV_ZERO
            if (x === Infinity) throw new LvFail()
            return { s: 1, l: x }
          }
          case 'min':
          case 'max': {
            const x = plainOf(a)
            const y = plainOf(args[1] ?? LV_NAN)
            return lvOf(node.fn === 'min' ? Math.min(x, y) : Math.max(x, y))
          }
          default: {
            const f = LV_PLAIN[node.fn]
            if (!f || node.args.length !== 1) throw new LvFail()
            return lvOf(f(plainOf(a)))
          }
        }
      }
      default:
        throw new LvFail()
    }
  }
  const root = ast.lhs
  return (n: number): LogValue | null => {
    try {
      return ev(root, n)
    } catch {
      return null
    }
  }
}

/**
 * The series of `seq` at these slider values, summed from index `k0`.
 * `plain` is the formula as typed (the part after "aₙ ="), when there is one.
 */
export function seriesSource(
  seq: SequenceDef,
  params: readonly number[],
  k0: number,
  plain: string | null = null,
): SeriesSource {
  const p = params.slice() as number[]
  const letter = indexLetter(seq)
  const fx0 = continuousTerm(seq)
  const list = listTerms(seq)
  let maxIndex: number
  if (seq.kind === 'recursive') maxIndex = seq.start + RECURSIVE_CAP - 1
  else if (seq.kind === 'list') maxIndex = seq.start + (list ? list.values.length : 0) - 1
  else maxIndex = 1e12
  const rhs = termFormulaTex(seq)
  const name = seq.name || 'a'
  const termTex = rhs ? (needsParens(rhs) ? `\\left(${rhs}\\right)` : rhs) : `${name}_{${letter}}`
  const plainTrim = plain && plain.trim() !== '' ? plain.trim() : null
  const raw = (n: number): number => {
    try {
      const v = seq.term(p, n)
      return typeof v === 'number' ? v : Number.NaN
    } catch {
      return Number.NaN
    }
  }
  // The log-space reading of the formula, trusted only where it agrees with
  // the terms themselves at the first few indexes.
  let logTerm: ((n: number) => LogValue | null) | null = null
  if (seq.kind === 'explicit' && plainTrim) {
    const cand = logEvaluator(plainTrim, letter, seq.paramNames, p)
    if (cand) {
      let agree = 0
      let bad = false
      for (let n = k0; n < k0 + 12 && !bad; n++) {
        const v = raw(n)
        if (!Number.isFinite(v) || v === 0 || Math.abs(v) > 1e300 || Math.abs(v) < 1e-300) continue
        const lv = cand(n)
        if (!lv) continue
        const w = lvNum(lv)
        if (Math.abs(w - v) <= 1e-8 * Math.abs(v)) agree++
        else bad = true
      }
      if (!bad && agree >= 2) logTerm = cand
    }
  }
  return {
    name,
    letter,
    k0,
    term: (n: number) => {
      const v = raw(n)
      if (!logTerm || (Number.isFinite(v) && v !== 0)) return v
      // ∞/∞, ∞·0 or a finite/∞ = 0 in the pieces: read the term in log space
      const lv = logTerm(n)
      if (!lv) return v
      if (Number.isNaN(lv.s)) return Number.isFinite(v) ? v : Number.NaN
      return lvNum(lv)
    },
    logTerm,
    fx: fx0
      ? (x: number) => {
          try {
            const v = fx0(p, x)
            return typeof v === 'number' ? v : Number.NaN
          } catch {
            return Number.NaN
          }
        }
      : null,
    kind: seq.kind,
    maxIndex,
    finite: seq.kind === 'list' && !!list && !list.ellipsis,
    termTex,
    plain: plainTrim,
  }
}

// ============================================================================
// Text helpers
// ============================================================================

const SUB: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '−': '₋', n: 'ₙ', k: 'ₖ', i: 'ᵢ', j: 'ⱼ', m: 'ₘ', N: 'N',
}
const SUP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '−': '⁻', n: 'ⁿ', k: 'ᵏ', i: 'ⁱ', j: 'ʲ', m: 'ᵐ',
}
const sub = (s: string | number): string => [...String(s)].map((c) => SUB[c] ?? c).join('')
const sup = (s: string | number): string => [...String(s)].map((c) => SUP[c] ?? c).join('')

/** 6 significant digits, true minus; scientific outside [1e-4, 1e7). */
export function approxText(v: number, digits = 6): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : v < 0 ? `${MINUS}∞` : 'undefined'
  if (v === 0) return '0'
  const a = Math.abs(v)
  let s: string
  if (a >= 1e7 || a < 1e-4) {
    const [m, e] = v.toExponential(Math.max(0, digits - 3)).split('e')
    const mant = m.includes('.') ? m.replace(/\.?0+$/, '') : m
    s = `${mant}×10${sup(String(Number(e)))}`
  } else {
    s = String(Number(v.toPrecision(digits)))
  }
  return s.replace(/-/g, MINUS)
}

function approxTex(v: number, digits = 6): string {
  return approxText(v, digits).replace(/×10(.*)$/, (_, e: string) => {
    const plain = [...e].map((c) => Object.keys(SUP).find((k) => SUP[k] === c) ?? c).join('').replace('−', '-')
    return `\\times 10^{${plain}}`
  }).replace(/−/g, '-')
}

/** A rational as text: "3/4", "−2", "5269/3600". */
function fracText(p: bigint, q: bigint): string {
  const neg = (p < 0n) !== (q < 0n) && p !== 0n
  const ap = p < 0n ? -p : p
  const aq = q < 0n ? -q : q
  const body = aq === 1n ? `${ap}` : `${ap}/${aq}`
  return neg ? `${MINUS}${body}` : body
}

function fracTex(p: bigint, q: bigint): string {
  const neg = (p < 0n) !== (q < 0n) && p !== 0n
  const ap = p < 0n ? -p : p
  const aq = q < 0n ? -q : q
  const body = aq === 1n ? `${ap}` : `\\frac{${ap}}{${aq}}`
  return neg ? `-${body}` : body
}

// ============================================================================
// Exact rationals (BigInt), for partial sums and structural sums
// ============================================================================

interface Frac {
  p: bigint
  q: bigint
}

function bgcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a
  let y = b < 0n ? -b : b
  while (y > 0n) {
    const t = x % y
    x = y
    y = t
  }
  return x
}

function mk(p: bigint, q: bigint): Frac {
  if (q < 0n) {
    p = -p
    q = -q
  }
  const g = bgcd(p, q) || 1n
  return { p: p / g, q: q / g }
}
const fadd = (a: Frac, b: Frac): Frac => mk(a.p * b.q + b.p * a.q, a.q * b.q)
const fmul = (a: Frac, b: Frac): Frac => mk(a.p * b.p, a.q * b.q)
const fneg = (a: Frac): Frac => ({ p: -a.p, q: a.q })
const fval = (a: Frac): number => Number(a.p) / Number(a.q)
const ZERO: Frac = { p: 0n, q: 1n }
const ONE: Frac = { p: 1n, q: 1n }

/**
 * The fraction a double IS, when it is one with a denominator ≤ maxDen:
 * continued fractions, accepted only at (nearly) the last bit.
 */
function toFrac(v: number, maxDen = 1e7): Frac | null {
  if (!Number.isFinite(v) || Math.abs(v) > 1e12) return null
  if (Number.isInteger(v)) return { p: BigInt(v), q: 1n }
  const tol = 4e-15 * Math.abs(v)
  let h0 = 0
  let h1 = 1
  let k0 = 1
  let k1 = 0
  let x = v
  for (let i = 0; i < 64; i++) {
    const a = Math.floor(x)
    const h2 = a * h1 + h0
    const k2 = a * k1 + k0
    if (Math.abs(k2) > maxDen || !Number.isSafeInteger(h2)) break
    h0 = h1
    h1 = h2
    k0 = k1
    k1 = k2
    if (Math.abs(v - h1 / k1) <= tol) return mk(BigInt(h1), BigInt(k1))
    const f = x - a
    if (f === 0) break
    x = 1 / f
  }
  return null
}

/** A small rational only (the numbers a lesson types: 2/3, −1/2, 3). */
function smallFrac(v: number): Frac | null {
  return toFrac(v, 1e4)
}

// ============================================================================
// Recognising a number
// ============================================================================

interface Base {
  value: number
  text: string
  tex: string
  /** Written after a coefficient as "(3/2) ln 2" (word) or "3π²/2" (symbol). */
  word: boolean
}

const B_PI2: Base = { value: Math.PI ** 2, text: 'π²', tex: '\\pi^{2}', word: false }
const B_PI4: Base = { value: Math.PI ** 4, text: 'π⁴', tex: '\\pi^{4}', word: false }
const B_PI6: Base = { value: Math.PI ** 6, text: 'π⁶', tex: '\\pi^{6}', word: false }
const B_PI8: Base = { value: Math.PI ** 8, text: 'π⁸', tex: '\\pi^{8}', word: false }
const B_LN2: Base = { value: Math.LN2, text: 'ln 2', tex: '\\ln 2', word: true }
const B_LN3: Base = { value: Math.log(3), text: 'ln 3', tex: '\\ln 3', word: true }
const B_E: Base = { value: Math.E, text: 'e', tex: 'e', word: false }
const B_EINV: Base = { value: 1 / Math.E, text: '1/e', tex: '\\frac{1}{e}', word: true }

/** Constants the numeric recogniser may name (beyond exact.ts's √ and π). */
const NAMED: readonly Base[] = [B_LN2, B_LN3, B_E, B_EINV, B_PI2, B_PI4]

/** coef·base + offset, as text and KaTeX: "π²/6", "π²/6 − 1", "(1/2) ln 2", "e − 1". */
function linear(coef: Frac, base: Base, offset: Frac): { text: string; tex: string } {
  const neg = coef.p < 0n
  const ap = neg ? -coef.p : coef.p
  let t: string
  let x: string
  if (base.word) {
    const c = ap === 1n && coef.q === 1n ? '' : coef.q === 1n ? `${ap}` : `(${ap}/${coef.q})`
    t = c ? `${c} ${base.text}` : base.text
    x = coef.q === 1n ? `${ap === 1n ? '' : ap}${base.tex}` : `\\frac{${ap}}{${coef.q}}${base.tex}`
  } else {
    const num = ap === 1n ? base.text : `${ap}${base.text}`
    t = coef.q === 1n ? num : `${num}/${coef.q}`
    const numTex = ap === 1n ? base.tex : `${ap}${base.tex}`
    x = coef.q === 1n ? numTex : `\\frac{${numTex}}{${coef.q}}`
  }
  if (neg) {
    t = `${MINUS}${t}`
    x = `-${x}`
  }
  if (offset.p !== 0n) {
    const oneg = offset.p < 0n
    const o = oneg ? fneg(offset) : offset
    t += ` ${oneg ? MINUS : '+'} ${fracText(o.p, o.q)}`
    x += ` ${oneg ? '-' : '+'} ${fracTex(o.p, o.q)}`
  }
  return { text: t, tex: x }
}

/**
 * The closed form of a CONVERGED numeric value, or null: exact.ts's forms
 * (fractions, surds, multiples of π), then (p/q)·K + s for the constants a
 * series sum is made of (ln 2, e, π², …; q ≤ 12, s a small whole number).
 * Only for values good to ~1e-11: the caller vouches for the precision.
 */
function recognize(v: number, tol = 1e-11): { text: string; tex: string } | null {
  if (!Number.isFinite(v)) return null
  const ef = exactForm(v, { tol })
  if (ef) {
    // "−1+√5" reads as a sum written backwards: say √5 − 1
    const t = /^−(\d+)\+([^+−-]+)$/.exec(ef.text)
    const x = /^-(\d+)\+([^+-]+)$/.exec(ef.tex)
    if (t && x) return { text: `${t[2]} − ${t[1]}`, tex: `${x[2]} - ${x[1]}` }
    return { text: ef.text, tex: ef.tex }
  }
  const eps = tol * Math.max(1, Math.abs(v))
  for (const K of NAMED) {
    for (let s = 0; s <= 3; s = s <= 0 ? -s + 1 : -s) {
      for (let q = 1; q <= 12; q++) {
        const p = Math.round(((v - s) * q) / K.value)
        if (p === 0 || Math.abs(p) > 60) continue
        if (Math.abs((p / q) * K.value + s - v) <= eps) {
          return linear(mk(BigInt(p), BigInt(q)), K, { p: BigInt(s), q: 1n })
        }
      }
    }
  }
  return null
}

/** A number: exact when recognised at `tol`, else "≈ 0.123457". */
function numberOf(v: number, tol = 1e-11, digits = 6): SeriesNumber {
  if (!Number.isFinite(v)) {
    const t = v > 0 ? '∞' : v < 0 ? `${MINUS}∞` : 'undefined'
    return { value: v, text: t, tex: v > 0 ? '\\infty' : v < 0 ? '-\\infty' : '\\text{undefined}', exact: false }
  }
  const r = recognize(v, tol)
  if (r) return { value: v, text: r.text, tex: r.tex, exact: true }
  return { value: v, text: `≈ ${approxText(v, digits)}`, tex: `\\approx ${approxTex(v, digits)}`, exact: false }
}

/** A small number as a lesson writes it (a ratio, a p, a coefficient). */
function niceText(v: number): string {
  try {
    return niceNumber(v).text
  } catch {
    return approxText(v)
  }
}

function numberFromFrac(f: Frac): SeriesNumber {
  return { value: fval(f), text: fracText(f.p, f.q), tex: fracTex(f.p, f.q), exact: true }
}

// ============================================================================
// Numeric helpers
// ============================================================================

/**
 * Polynomial extrapolation to h = 0 through (h_i, y_i) (Neville): a limit
 * read off values at n = N₁ < N₂ < N₃ with h = 1/n kills the 1/n and 1/n²
 * terms of the approach.
 */
function extrapolate(hs: readonly number[], ys: readonly number[]): number {
  const m = hs.length
  const p = ys.slice()
  for (let k = 1; k < m; k++) {
    for (let i = m - 1; i >= k; i--) {
      p[i] = (hs[i - k] * p[i] - hs[i] * p[i - 1]) / (hs[i - k] - hs[i])
    }
  }
  return p[m - 1]
}

/** Kahan-compensated running sum. */
class Kahan {
  s = 0
  c = 0
  add(x: number): void {
    const y = x - this.c
    const t = this.s + y
    this.c = t - this.s - y
    this.s = t
  }
}

const relDiff = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300)

// ============================================================================
// Reading the terms
// ============================================================================

/**
 * Why the terms stop being read: they outgrew a double ('overflow'), shrank
 * below one ('underflow'), a term is truly undefined ('undefined'), or — with
 * no formula to read in log space — a shrinking run met ∞/∞ in the pieces of
 * its formula ('lost': a precision limit, never evidence about the series).
 */
type Cut = 'none' | 'overflow' | 'underflow' | 'undefined' | 'lost'

/**
 * Why aₙ is not a finite number. With the formula in log space the answer is
 * exact: a finite ln|aₙ| too large for a double is an overflow, anything else
 * (a pole, ln 0, √ of a negative) is undefined. Without it: next to the
 * largest double it is an overflow; after a shrinking run, or a term still far
 * from that limit (1000ⁿ/n! at n = 103 is 10¹⁴⁵ while 1000ⁿ is already ∞), the
 * formula's pieces overflowed and not the term ('lost'); else undefined.
 */
function badCut(src: SeriesSource, n: number, v: number, shrinking: boolean, prev: number): Cut {
  const lv = src.logTerm ? src.logTerm(n) : null
  if (lv) {
    if (!Number.isNaN(lv.s) && lv.s !== 0 && Number.isFinite(lv.l)) return lv.l > 0 ? 'overflow' : 'underflow'
    return 'undefined'
  }
  void v
  if (prev > 1e250) return 'overflow'
  if (shrinking || prev > 1e100) return 'lost'
  return 'undefined'
}

/**
 * The last `k` values strictly shrink in size — read before any trailing
 * zeros, which a finite/∞ in the formula's pieces also produces.
 */
function shrinks(xs: readonly number[], k: number): boolean {
  let end = xs.length
  while (end > 0 && xs[end - 1] === 0) end--
  if (end < k) return false
  for (let i = end - k + 1; i < end; i++) if (!(Math.abs(xs[i]) < Math.abs(xs[i - 1]))) return false
  return true
}

interface Level {
  n: number
  /** max |a| over the window n … n + 15 */
  M: number
  /** min |a| over the window */
  m: number
  a: number
}

interface Ctx {
  src: SeriesSource
  a(n: number): number
  /** a_k₀, a_k₀₊₁ … while finite (and before an underflow to 0). */
  vals: number[]
  cut: Cut
  /** Far-out windows: n = k₀ + 16, 32, 64, … */
  levels: Level[]
  levelCut: Cut
  an: string
  an1: string
  L: string
}

function makeCtx(src: SeriesSource): Ctx {
  const memo = new Map<number, number>()
  const a = (n: number): number => {
    if (!Number.isInteger(n) || n < src.k0 || n > src.maxIndex) return Number.NaN
    const hit = memo.get(n)
    if (hit !== undefined) return hit
    const v = src.term(n)
    if (memo.size < 60_000) memo.set(n, v)
    return v
  }
  const vals: number[] = []
  let cut: Cut = 'none'
  const top = Math.min(src.k0 + DENSE - 1, src.maxIndex)
  for (let n = src.k0; n <= top; n++) {
    const v = a(n)
    if (!Number.isFinite(v)) {
      const prev = vals.length ? Math.abs(vals[vals.length - 1]) : 0
      cut = vals.length > 0 ? badCut(src, n, v, shrinks(vals, 6), prev) : 'undefined'
      break
    }
    if (v === 0 && vals.length > 0 && Math.abs(vals[vals.length - 1]) < 1e-250 && vals[vals.length - 1] !== 0) {
      cut = 'underflow'
      break
    }
    vals.push(v)
  }
  // A lost run's trailing zeros are finite/∞ in the formula's pieces, not terms.
  if (cut === 'lost') while (vals.length > 1 && vals[vals.length - 1] === 0) vals.pop()
  const levels: Level[] = []
  let levelCut: Cut = 'none'
  if (src.kind !== 'list') {
    for (let j = 4; ; j++) {
      const n = src.k0 + 2 ** j
      if (n + WINDOW > src.maxIndex || 2 ** j > LADDER_TOP) break
      let M = 0
      let m = Infinity
      let bad: Cut = 'none'
      for (let i = 0; i < WINDOW; i++) {
        const v = a(n + i)
        if (!Number.isFinite(v)) {
          const Ms = levels.map((l) => l.M)
          const shrinking = Ms.length >= 2 ? shrinks(Ms, Math.min(3, Ms.length)) : shrinks(vals, 6)
          bad = badCut(src, n + i, v, shrinking, levels.length > 0 ? levels[levels.length - 1].M : 0)
          break
        }
        M = Math.max(M, Math.abs(v))
        m = Math.min(m, Math.abs(v))
      }
      if (bad !== 'none') {
        levelCut = bad
        break
      }
      if (M === 0 || M < 1e-290) {
        levelCut = 'underflow'
        break
      }
      levels.push({ n, M, m, a: a(n) })
    }
  }
  const L = src.letter
  return {
    src,
    a,
    vals,
    cut,
    levels,
    levelCut,
    an: `${src.name}${sub(L)}`,
    an1: `${src.name}${sub(L)}${sub('+1')}`,
    L,
  }
}

// ============================================================================
// Facts read once and shared by the tests
// ============================================================================

interface SignFacts {
  kind: SignPattern
  /** The pattern holds from this index on. */
  from: number
}

function signFacts(ctx: Ctx): SignFacts {
  const v = ctx.vals
  const k0 = ctx.src.k0
  const n = v.length
  if (n === 0) return { kind: 'mixed', from: k0 }
  const suffix = (ok: (i: number) => boolean): number => {
    let i = n - 1
    while (i >= 0 && ok(i)) i--
    return i + 1
  }
  const allow = n >= 40 ? 30 : 0
  const zero = suffix((i) => v[i] === 0)
  if (zero <= n - 20 && ctx.cut !== 'underflow' && zero <= allow) return { kind: 'zero', from: k0 + zero }
  const pos = suffix((i) => v[i] > 0)
  const neg = suffix((i) => v[i] < 0)
  const alt = suffix((i) => v[i] !== 0 && (i === n - 1 || v[i] * v[i + 1] < 0))
  const best = Math.min(pos, neg, alt)
  if (best > allow) return { kind: 'mixed', from: k0 }
  const kind: SignPattern = best === pos ? 'positive' : best === neg ? 'negative' : 'alternating'
  // the far-out terms must agree
  for (const lv of ctx.levels) {
    const x = ctx.a(lv.n)
    const y = ctx.a(lv.n + 1)
    if (kind === 'positive' && !(x > 0 && y > 0)) return { kind: 'mixed', from: k0 }
    if (kind === 'negative' && !(x < 0 && y < 0)) return { kind: 'mixed', from: k0 }
    if (kind === 'alternating' && !(x * y < 0)) return { kind: 'mixed', from: k0 }
  }
  return { kind, from: k0 + best }
}

type NthState = 'zero' | 'limit' | 'nolimit' | 'unbounded' | 'unknown' | 'short'

interface NthFacts {
  state: NthState
  /** lim aₙ when it exists and is not 0. */
  limit?: number
  /** The size the terms keep returning to (no limit). */
  size?: number
}

/** ln|aₙ| at n = k₀ + 2ʲ (j = 4 … 16), read in log space; null without a formula. */
function logLadder(ctx: Ctx): number[] | null {
  const lt = ctx.src.logTerm
  if (!lt) return null
  const out: number[] = []
  for (let j = 4; j <= 16; j++) {
    const n = ctx.src.k0 + 2 ** j
    if (n > ctx.src.maxIndex) break
    const v = lt(n)
    if (!v || Number.isNaN(v.s) || Number.isNaN(v.l)) return null
    out.push(v.s === 0 ? -Infinity : v.l)
  }
  return out
}

function nthFacts(ctx: Ctx): NthFacts {
  const lv = ctx.levels
  if (ctx.cut === 'overflow' || ctx.levelCut === 'overflow') {
    // Too big for a double somewhere is not "grows without bound": 1000ⁿ/n!
    // passes 10³⁰⁸ on its way to 0. The log-space terms say which it is.
    const lg = logLadder(ctx)
    if (!lg) return { state: 'unbounded' }
    if (lg.length < 4) return { state: 'unknown' }
    const t = lg.slice(-4)
    if (t.every((x, i) => i === 0 || x > t[i - 1])) return { state: 'unbounded' }
    if (t.every((x, i) => i === 0 || x < t[i - 1]) && t[3] < -40) return { state: 'zero' }
    return { state: 'unknown' }
  }
  if (ctx.levelCut === 'underflow' || (ctx.cut === 'underflow' && lv.length < 3)) return { state: 'zero' }
  if (lv.length < 4) return { state: ctx.src.kind === 'list' ? 'short' : 'unknown' }
  const last = lv.slice(-4).map((l) => l.M)
  const maxM = Math.max(...lv.map((l) => l.M))
  const up = last.every((m, i) => i === 0 || m >= last[i - 1] * 1.02) && last[3] >= last[0] * 1.2
  if (up) return { state: 'unbounded' }
  const down =
    last[3] < 1e-12 * maxM ||
    (last.every((m, i) => i === 0 || m <= last[i - 1] * (1 + 1e-12)) && last[3] <= last[0] * 0.9)
  if (down) return { state: 'zero' }
  // Bounded away from 0 without settling (cos n, 2 + sin n): the far-out
  // windows stay within 20% of each other and do NOT shrink level by level
  // (a slow steady decrease such as 1/ln(ln n) is left undecided instead).
  const six = lv.slice(-6).map((l) => l.M)
  const steadyDown = six.every((m, i) => i === 0 || m < six[i - 1])
  if (six.length === 6 && Math.min(...six) > 0.8 * Math.max(...six) && !steadyDown) {
    const top = lv[lv.length - 1]
    if ((top.M - top.m) / top.M >= 1e-3) return { state: 'nolimit', size: top.M }
  }
  const l3 = last.slice(1)
  const spread = (Math.max(...l3) - Math.min(...l3)) / Math.max(...l3)
  if (spread < 1e-3) {
    const top = lv[lv.length - 1]
    const settled = (top.M - top.m) / top.M < 1e-3
    if (settled) {
      const tail = lv.slice(-3)
      const sgn = Math.sign(tail[2].a)
      if (tail.every((t) => Math.sign(t.a) === sgn)) {
        const L = extrapolate(tail.map((t) => 1 / t.n), tail.map((t) => t.a))
        return { state: 'limit', limit: L }
      }
    }
    return { state: 'nolimit', size: top.M }
  }
  return { state: 'unknown' }
}

type RatioState = 'limit' | 'zero' | 'infinite' | 'oscillates' | 'unknown'

interface RatioFacts {
  state: RatioState
  L?: number
}

function ratioFacts(ctx: Ctx): RatioFacts {
  const rows: { n: number; r: number; spread: number }[] = []
  let starts = ctx.levels.map((l) => l.n)
  const lt = ctx.src.logTerm
  // Terms that under- or overflow a double still have ratios: read them in
  // log space, out to n = k₀ + 2¹⁶ (where ln|aₙ| is still good to ~1e-10).
  const extend = !!lt && (ctx.levelCut === 'underflow' || ctx.levelCut === 'overflow')
  if (extend) {
    starts = []
    for (let j = 4; j <= 16; j++) {
      const n = ctx.src.k0 + 2 ** j
      if (n + 5 > ctx.src.maxIndex) break
      starts.push(n)
    }
  }
  const ratioAt = (n: number): number => {
    const x = ctx.a(n)
    const y = ctx.a(n + 1)
    if (Number.isFinite(x) && Number.isFinite(y) && x !== 0 && y !== 0) return Math.abs(y / x)
    if (!extend || !lt) return Number.isFinite(x) && Number.isFinite(y) && x !== 0 ? Math.abs(y / x) : Number.NaN
    const lx = lt(n)
    const ly = lt(n + 1)
    if (!lx || !ly || !(lx.s !== 0 && Math.abs(lx.s) === 1) || !(Math.abs(ly.s) === 1)) return Number.NaN
    if (!Number.isFinite(lx.l) || !Number.isFinite(ly.l)) return Number.NaN
    return Math.exp(ly.l - lx.l)
  }
  for (const n of starts) {
    const rs: number[] = []
    for (let j = 0; j < 4; j++) {
      const r = ratioAt(n + j)
      if (!Number.isFinite(r)) break
      rs.push(r)
    }
    if (rs.length < 4) break
    const mx = Math.max(...rs)
    const mn = Math.min(...rs)
    rows.push({ n, r: rs[0], spread: mn > 0 ? mx / mn : Infinity })
  }
  if (rows.length < 3) return { state: 'unknown' }
  const tail = rows.slice(-2)
  if (tail.every((t) => t.spread > 1.05)) return { state: 'oscillates' }
  const rs = rows.map((t) => t.r)
  const k = rs.length
  if (rs[k - 1] > 2 && rs[k - 1] > rs[k - 2] * 1.3 && rs[k - 2] > rs[k - 3]) return { state: 'infinite', L: Infinity }
  if (rs[k - 1] < 0.05 && rs[k - 1] < rs[k - 2] * 0.75 && rs[k - 2] < rs[k - 3]) return { state: 'zero', L: 0 }
  if (k >= 4) {
    const t3 = rows.slice(-3)
    const p3 = rows.slice(-4, -1)
    const L1 = extrapolate(t3.map((t) => 1 / t.n), t3.map((t) => t.r))
    const L0 = extrapolate(p3.map((t) => 1 / t.n), p3.map((t) => t.r))
    if (Math.abs(L1 - L0) <= 1e-6 * Math.max(1, Math.abs(L1))) {
      return { state: 'limit', L: Math.abs(L1 - 1) <= 1e-6 ? 1 : L1 }
    }
  }
  return { state: 'unknown' }
}

interface GeoFacts {
  r: number
  a0: number
}

function geoFacts(ctx: Ctx): GeoFacts | null {
  const v = ctx.vals
  if (v.length < 3) return null
  const head = v.slice(0, 12)
  let cls
  try {
    cls = classify(head, ctx.src.k0, ctx.src.name)
  } catch {
    return null
  }
  if (cls.kind !== 'geometric') return null
  const r = cls.r
  // the whole dense run agrees, not just the first twelve
  const upto = Math.min(v.length, 200)
  for (let i = 1; i < upto; i++) {
    if (v[i - 1] === 0) return null
    if (Math.abs(v[i] / v[i - 1] - r) > 1e-9 * Math.max(1, Math.abs(r))) return null
  }
  return { r, a0: v[0] }
}

interface PFacts {
  p: number
  /** |aₙ| = C/nᵖ, C > 0 */
  C: number
  /** The sign: +1 / −1 for a positive / negative series, and for an alternating one σ with aₙ = σ(−1)ⁿ C/nᵖ. */
  sigma: number
  alt: boolean
}

function pFacts(ctx: Ctx, signs: SignFacts): PFacts | null {
  const k0 = ctx.src.k0
  const v = ctx.vals
  if (k0 < 1 || v.length < 8 || signs.from !== k0) return null
  if (signs.kind !== 'positive' && signs.kind !== 'negative' && signs.kind !== 'alternating') return null
  const a1 = Math.abs(v[0])
  const a2 = Math.abs(ctx.a(2 * k0))
  if (!(a1 > 0) || !(a2 > 0)) return null
  let p = Math.log(a1 / a2) / Math.LN2
  if (!Number.isFinite(p)) return null
  const pn = niceNumber(p).value
  if (Math.abs(pn - p) < 1e-9 * Math.max(1, Math.abs(p))) p = pn
  const C = a1 * Math.pow(k0, p)
  const upto = Math.min(v.length, 300)
  for (let i = 0; i < upto; i++) {
    const n = k0 + i
    if (Math.abs(Math.abs(v[i]) * Math.pow(n, p) - C) > 1e-9 * C) return null
  }
  const alt = signs.kind === 'alternating'
  const sigma = alt ? Math.sign(v[0]) * (k0 % 2 === 0 ? 1 : -1) : Math.sign(v[0])
  return { p, C, sigma, alt }
}

interface ExpFacts {
  /** aₙ = C·xⁿ/n! */
  x: number
  C: number
}

function expFacts(ctx: Ctx): ExpFacts | null {
  const k0 = ctx.src.k0
  const v = ctx.vals
  if (k0 < 0 || v.length < 24) return null
  if (v.slice(0, 24).some((t) => t === 0)) return null
  const t0 = ((k0 + 1) * v[1]) / v[0]
  if (!Number.isFinite(t0) || t0 === 0) return null
  for (let i = 1; i < 22; i++) {
    const t = ((k0 + i + 1) * v[i + 1]) / v[i]
    if (Math.abs(t - t0) > 1e-9 * Math.max(1, Math.abs(t0))) return null
  }
  let fact = 1
  for (let i = 2; i <= k0; i++) fact *= i
  const C = (v[0] * fact) / Math.pow(t0, k0)
  const xs = niceNumber(t0).value
  const x = Math.abs(xs - t0) < 1e-9 * Math.max(1, Math.abs(t0)) ? xs : t0
  const Cs = niceNumber(C).value
  return { x, C: Math.abs(Cs - C) < 1e-9 * Math.max(1, Math.abs(C)) ? Cs : C }
}

interface TeleFacts {
  /** aₙ = K·[1/(d·n + e₂) − 1/(d·n + e₁)], e₁ = e₂ + d·m */
  K: number
  d: number
  e2: number
  m: number
  sum: number
  sumFrac: Frac | null
}

function teleFacts(ctx: Ctx): TeleFacts | null {
  const k0 = ctx.src.k0
  const v = ctx.vals
  if (v.length < 40) return null
  const Q = v.slice(0, 40).map((t) => 1 / t)
  if (!Q.every(Number.isFinite)) return null
  const d1 = Q.slice(1).map((q, i) => q - Q[i])
  const d2 = d1.slice(1).map((q, i) => q - d1[i])
  const maxQ = Math.max(...Q.map(Math.abs))
  if (!d2.every((x) => Math.abs(x - d2[0]) <= 1e-9 * maxQ)) return null
  const A = d2[0] / 2
  if (Math.abs(A) <= 1e-12 * maxQ) return null
  // Q(n) = A n² + B n + C₀
  const B = d1[0] - A * (2 * k0 + 1)
  const C0 = Q[0] - A * k0 * k0 - B * k0
  const disc = B * B - 4 * A * C0
  if (!(disc > 0)) return null
  const s = Math.sqrt(disc)
  const ra = (-B - s) / (2 * A)
  const rb = (-B + s) / (2 * A)
  const r1 = Math.min(ra, rb)
  const r2 = Math.max(ra, rb)
  const m = Math.round(r2 - r1)
  if (m < 1 || Math.abs(r2 - r1 - m) > 1e-7 * Math.max(1, m)) return null
  if (r2 >= k0) return null // a factor would vanish at or after k₀
  // the smallest d with d·r₁, d·r₂ whole
  let d = 0
  for (let q = 1; q <= 12; q++) {
    if (Math.abs(q * r2 - Math.round(q * r2)) < 1e-7) {
      d = q
      break
    }
  }
  if (d === 0) return null
  const e2 = -Math.round(d * r2)
  // aₙ = (1/(A m))·[1/(n − r₂) − 1/(n − r₁)] = (d/(A m))·[1/(dn + e₂) − 1/(dn + e₁)]
  const K = d / (A * m)
  const Kf = toFrac(K, 1e6)
  let total = 0
  let acc: Frac = ZERO
  for (let j = 0; j < m; j++) {
    const den = d * (k0 + j) + e2
    total += 1 / den
    acc = fadd(acc, mk(1n, BigInt(den)))
  }
  return { K, d, e2, m, sum: K * total, sumFrac: Kf ? fmul(Kf, acc) : null }
}

interface PowerFacts {
  /** The decay exponent read off the far-out terms: |aₙ| ~ C/nᵖ. */
  p: number
  /** The comparison exponent chosen from it (a whole number, a half, a third, a quarter). */
  pc: number
  stable: boolean
}

function powerFacts(ctx: Ctx): PowerFacts | null {
  const lv = ctx.levels
  const s = 6
  if (lv.length < s + 3) return null
  const est = (j: number): number => Math.log(lv[j].M / lv[j + s].M) / Math.log(lv[j + s].n / lv[j].n)
  const j = lv.length - 1 - s
  const p = est(j)
  const prev = est(j - 1)
  if (!Number.isFinite(p)) return null
  let pc = Math.round(2 * p) / 2
  for (const q of [1, 2, 3, 4]) {
    const k = Math.round(p * q)
    if (Math.abs(p - k / q) < 0.02) {
      pc = k / q
      break
    }
  }
  return { p, pc, stable: Math.abs(p - prev) < 0.01 }
}

/** |aₙ| is non-increasing from this index on (dense run and far-out windows), or null. */
function decreasingFrom(ctx: Ctx): number | null {
  const v = ctx.vals
  if (v.length < 3) return null
  let last = -1
  for (let i = 0; i + 1 < v.length; i++) {
    if (Math.abs(v[i + 1]) > Math.abs(v[i]) * (1 + 1e-12)) last = i
  }
  const from = ctx.src.k0 + last + 1
  if (last + 1 > 50) return null
  const lv = ctx.levels
  for (let i = 1; i < lv.length; i++) if (lv[i].M > lv[i - 1].M * (1 + 1e-12)) return null
  // inside each far-out window the FIRST term is the largest when |a| decreases
  for (const l of lv) if (Math.abs(ctx.a(l.n)) < l.M * (1 - 1e-12)) return null
  return from
}

// ============================================================================
// Texts for series and comparisons
// ============================================================================

/** nᵖ as text: "n", "n²", "√n", "n^(3/2)". */
function powText(L: string, p: number): string {
  if (p === 1) return L
  if (p === 0.5) return `√${L}`
  if (Number.isInteger(p) && p > 0) return `${L}${sup(p)}`
  return `${L}^(${niceText(p)})`
}

function powTex(L: string, p: number): string {
  if (p === 1) return L
  if (p === 0.5) return `\\sqrt{${L}}`
  if (Number.isInteger(p)) return `${L}^{${p}}`
  const f = smallFrac(p)
  return f ? `${L}^{${f.p}/${f.q}}` : `${L}^{${approxText(p, 4)}}`
}

interface Compare {
  kind: 'power' | 'geometric'
  /** p for 1/nᵖ, r for rⁿ */
  k: number
  text: string
  tex: string
  b(n: number): number
  converges: boolean
  /** "p-series, p = 2 > 1" */
  why: string
}

function powerCompare(L: string, p: number): Compare {
  const pt = niceText(p)
  return {
    kind: 'power',
    k: p,
    text: `1/${powText(L, p)}`,
    tex: `\\frac{1}{${powTex(L, p)}}`,
    b: (n) => Math.pow(n, -p),
    converges: p > 1,
    why: p > 1 ? `p-series, p = ${pt} > 1` : `p-series, p = ${pt} ≤ 1`,
  }
}

function geometricCompare(L: string, r: number): Compare {
  const rt = niceText(r)
  const L2 = L === 'n' ? 'ⁿ' : `^${L}`
  return {
    kind: 'geometric',
    k: r,
    text: `(${rt})${L2}`,
    tex: `\\left(${recognize(r, 1e-12)?.tex ?? approxTex(r)}\\right)^{${L}}`,
    b: (n) => Math.pow(r, n),
    converges: r < 1,
    why: r < 1 ? `geometric, r = ${rt} < 1` : `geometric, r = ${rt} ≥ 1`,
  }
}

/** The comparison series: the dominant-term p-series, or a geometric one. */
function chooseCompare(ctx: Ctx, ratio: RatioFacts, power: PowerFacts | null): Compare | null {
  if (ratio.state === 'limit' && ratio.L !== undefined && ratio.L > 0 && ratio.L < 1) {
    const f = smallFrac(ratio.L)
    if (f && f.q <= 100n) return geometricCompare(ctx.L, fval(f))
  }
  if (power && ctx.src.k0 >= 1) return powerCompare(ctx.L, power.pc)
  if (power && ctx.src.k0 < 1) return powerCompare(ctx.L, power.pc)
  return null
}

// ============================================================================
// The tests
// ============================================================================

function test(id: SeriesTestId, outcome: SeriesOutcome, reason: string, extra: Partial<SeriesTest> = {}): SeriesTest {
  return { id, name: SERIES_TEST_NAMES[id], outcome, reason, ...extra }
}

interface Facts {
  signs: SignFacts
  nth: NthFacts
  ratio: RatioFacts
  geo: GeoFacts | null
  pser: PFacts | null
  expo: ExpFacts | null
  tele: TeleFacts | null
  power: PowerFacts | null
  dec: number | null
  compare: Compare | null
}

function nthTest(ctx: Ctx, F: Facts): SeriesTest {
  const { an } = ctx
  const s = F.nth
  switch (s.state) {
    case 'zero':
      return test(
        'nth-term',
        'inconclusive',
        `lim ${an} = 0, so the nth-term test is inconclusive — it can only show divergence, never convergence.`,
        { limit: numberOf(0) },
      )
    case 'limit': {
      const L = numberOf(s.limit ?? Number.NaN, 1e-9)
      const eq = L.exact ? `= ${L.text}` : L.text
      return test('nth-term', 'diverges', `lim ${an} ${eq} ≠ 0, so Σ${an} diverges by the nth-term test.`, { limit: L })
    }
    case 'nolimit': {
      const size = approxText(s.size ?? Number.NaN, 3)
      const why =
        F.signs.kind === 'alternating'
          ? `The terms alternate near ±${size}, so lim ${an} does not exist (it is not 0).`
          : `The terms keep coming back to a size of about ${size}, so lim ${an} does not exist (it is not 0).`
      return test('nth-term', 'diverges', `${why} Σ${an} diverges by the nth-term test.`)
    }
    case 'unbounded':
      return test(
        'nth-term',
        'diverges',
        `|${an}| grows without bound, so lim ${an} ≠ 0 and Σ${an} diverges by the nth-term test.`,
        { limit: numberOf(Infinity) },
      )
    case 'short':
      return test('nth-term', 'undecided', 'Only the listed terms are known, so lim aₙ cannot be read.')
    default:
      return test(
        'nth-term',
        'undecided',
        `The terms neither settle nor clearly approach 0 as far out as they were computed — can’t decide lim ${an} numerically.`,
      )
  }
}

function geometricTest(ctx: Ctx, F: Facts): SeriesTest {
  const g = F.geo
  if (!g) {
    return test('geometric', 'not-applicable', `The ratio ${ctx.an1}/${ctx.an} is not constant, so this is not a geometric series.`)
  }
  const r = niceText(g.r)
  const a0 = niceText(g.a0)
  const absR = niceText(Math.abs(g.r))
  if (Math.abs(g.r) < 1) {
    const S = geometricSum(g)
    return test(
      'geometric',
      'converges',
      `Geometric, with first term ${a0} and common ratio r = ${r}. Since |r| = ${absR} < 1, it converges to ${a0}/(1 ${MINUS} ${g.r < 0 ? `(${r})` : r}) = ${S.text}.`,
      { limit: numberOf(g.r, 1e-12) },
    )
  }
  return test(
    'geometric',
    'diverges',
    `Geometric, with common ratio r = ${r}. Since |r| = ${absR} ≥ 1, it diverges.`,
    { limit: numberOf(g.r, 1e-12) },
  )
}

function geometricSum(g: GeoFacts): SeriesNumber {
  const a = toFrac(g.a0, 1e6)
  const r = toFrac(g.r, 1e6)
  if (a && r) {
    const den = fadd(ONE, fneg(r))
    const f = mk(a.p * den.q, a.q * den.p)
    if (f.q <= 10n ** 12n) return numberFromFrac(f)
  }
  return numberOf(g.a0 / (1 - g.r))
}

function pTest(ctx: Ctx, F: Facts): SeriesTest {
  const ps = F.pser
  const { an, L } = ctx
  if (!ps) {
    return test('p-series', 'not-applicable', `${an} is not of the form C/${L}ᵖ, so this is not a p-series.`)
  }
  const pt = niceText(ps.p)
  const Ct = niceText(ps.C)
  const form = `${ps.C === 1 ? '1' : Ct}/${powText(L, ps.p)}`
  if (ps.alt) {
    return test(
      'p-series',
      'not-applicable',
      `The terms alternate in sign, so Σ${an} is not a p-series itself; |${an}| = ${form} is one (p = ${pt}) — see absolute convergence.`,
    )
  }
  const lead = ps.C === 1 ? `Σ ${form} is a p-series` : `${an} = ${form} is ${Ct} times a p-series`
  const neg = ps.sigma < 0 ? ` (every term is negative: ${an} = ${MINUS}${form})` : ''
  if (ps.p > 1) return test('p-series', 'converges', `${lead}${neg} with p = ${pt} > 1, so it converges.`)
  const harm = ps.p === 1 ? ' (the harmonic series)' : ''
  return test('p-series', 'diverges', `${lead}${neg} with p = ${pt} ≤ 1${harm}, so it diverges.`)
}

function linText(d: number, e: number, L: string): string {
  const lead = d === 1 ? L : `${d}${L}`
  if (e === 0) return lead
  return `${lead} ${e < 0 ? MINUS : '+'} ${Math.abs(e)}`
}

function recip(lin: string): string {
  return /\s/.test(lin) ? `1/(${lin})` : `1/${lin}`
}

function teleTest(ctx: Ctx, F: Facts): SeriesTest {
  const t = F.tele
  const { an, L } = ctx
  if (!t) {
    return test('telescoping', 'not-applicable', `${an} is not recognized as a difference that telescopes.`)
  }
  const e1 = t.e2 + t.d * t.m
  const inner = `${recip(linText(t.d, t.e2, L))} ${MINUS} ${recip(linText(t.d, e1, L))}`
  const Kt = niceText(t.K)
  const split = t.K === 1 ? inner : `${/\//.test(Kt) ? `(${Kt})` : Kt}[${inner}]`
  const S = t.sumFrac && t.sumFrac.q < 10n ** 12n ? numberFromFrac(t.sumFrac) : numberOf(t.sum)
  const k0 = ctx.src.k0
  let middle: string
  if (t.m === 1) {
    const first = 1 / (t.d * k0 + t.e2)
    const firstT = niceText(t.K * first)
    const tail = recip(linText(t.d, t.e2 + t.d, 'N'))
    const Kp = t.K === 1 ? '' : `${/\//.test(Kt) ? `(${Kt})` : Kt}·`
    middle = `the partial sums collapse to S_N = ${firstT} ${MINUS} ${Kp}${tail}, which approaches ${S.text}`
  } else {
    middle = `each term cancels with the one ${t.m} places later, so only the first ${t.m} pieces survive: S = ${S.text}`
  }
  return test('telescoping', 'converges', `${an} = ${split}; ${middle}. The series converges to ${S.text}.`, { limit: S })
}

function ratioTest(ctx: Ctx, F: Facts, forAbs = false): SeriesTest {
  const { an, an1 } = ctx
  const r = F.ratio
  const what = forAbs ? `Σ|${an}|` : `Σ${an}`
  switch (r.state) {
    case 'zero':
      return test('ratio', 'converges', `L = lim |${an1}/${an}| = 0 < 1, so ${what} converges${F.signs.kind === 'positive' || F.signs.kind === 'negative' || forAbs ? '' : ' absolutely'} by the ratio test.`, { limit: numberOf(0) })
    case 'infinite':
      return test('ratio', 'diverges', `|${an1}/${an}| grows without bound (L = ∞ > 1), so ${what} diverges by the ratio test.`, { limit: numberOf(Infinity) })
    case 'limit': {
      const Lv = r.L ?? Number.NaN
      const Ln = numberOf(Lv, 1e-7)
      const eq = Ln.exact ? `= ${Ln.text}` : Ln.text
      if (Lv === 1) {
        return test('ratio', 'inconclusive', `L = lim |${an1}/${an}| = 1, so the ratio test is inconclusive.`, { limit: numberOf(1) })
      }
      if (Lv < 1) {
        return test('ratio', 'converges', `L = lim |${an1}/${an}| ${eq} < 1, so ${what} converges${F.signs.kind === 'positive' || F.signs.kind === 'negative' || forAbs ? '' : ' absolutely'} by the ratio test.`, { limit: Ln })
      }
      return test('ratio', 'diverges', `L = lim |${an1}/${an}| ${eq} > 1, so ${what} diverges by the ratio test.`, { limit: Ln })
    }
    case 'oscillates':
      return test('ratio', 'not-applicable', `|${an1}/${an}| keeps jumping around and approaches no limit, so the ratio test does not apply.`)
    default:
      return test('ratio', 'undecided', `The ratios |${an1}/${an}| do not settle as far out as they were computed — can’t decide L numerically.`)
  }
}

/** The indexes a comparison is checked at: the dense run and every far-out window. */
function checkPoints(ctx: Ctx): number[] {
  const out: number[] = []
  for (let i = 0; i < ctx.vals.length; i++) out.push(ctx.src.k0 + i)
  for (const l of ctx.levels) for (let j = 0; j < 4; j++) out.push(l.n + j)
  return out
}

function directTest(ctx: Ctx, F: Facts, forAbs: boolean): SeriesTest {
  const { an } = ctx
  const pos = F.signs.kind === 'positive' || F.signs.kind === 'negative'
  if (!forAbs && !pos) {
    return test('direct-comparison', 'not-applicable', 'The terms are not all positive, so direct comparison applies to Σ|aₙ| (see absolute convergence).'.replace('aₙ', an))
  }
  const c = F.compare
  if (!c) return test('direct-comparison', 'undecided', 'No comparison series could be chosen from the terms computed.')
  const g = (n: number): number => Math.abs(ctx.a(n))
  const lhs = forAbs || F.signs.kind === 'negative' ? `|${an}|` : an
  const what = forAbs || F.signs.kind === 'negative' ? `Σ|${an}|` : `Σ${an}`
  const pts = checkPoints(ctx).filter((n) => n >= 1 || c.kind === 'geometric')
  if (pts.length === 0) return test('direct-comparison', 'undecided', 'No terms to compare.')
  let lastAbove = -Infinity // last n with g > b
  let lastBelow = -Infinity // last n with g < b
  for (const n of pts) {
    const gv = g(n)
    const bv = c.b(n)
    if (!Number.isFinite(gv) || !Number.isFinite(bv)) continue
    if (gv > bv * (1 + 1e-12)) lastAbove = Math.max(lastAbove, n)
    if (gv < bv * (1 - 1e-12)) lastBelow = Math.max(lastBelow, n)
  }
  const k0 = Math.max(ctx.src.k0, pts[0])
  const holds = (last: number): number | null => (last === -Infinity ? k0 : last + 1 <= k0 + 10 ? last + 1 : null)
  const cmp = { text: c.text, tex: c.tex }
  const le = holds(lastAbove)
  const ge = holds(lastBelow)
  if (c.converges && le !== null) {
    const fromTxt = `for ${ctx.L} ≥ ${le}`
    return test(
      'direct-comparison',
      'converges',
      `0 ≤ ${lhs} ≤ ${c.text} ${fromTxt}, and Σ ${c.text} converges (${c.why}), so ${what} converges by direct comparison.`,
      { compare: cmp },
    )
  }
  if (!c.converges && ge !== null && pos) {
    return test(
      'direct-comparison',
      'diverges',
      `${lhs} ≥ ${c.text} > 0 for ${ctx.L} ≥ ${ge}, and Σ ${c.text} diverges (${c.why}), so ${what} diverges by direct comparison.`,
      { compare: cmp },
    )
  }
  if (c.converges && ge !== null) {
    return test(
      'direct-comparison',
      'inconclusive',
      `${lhs} > ${c.text} for large ${ctx.L}, and being larger than a convergent series decides nothing — direct comparison with Σ ${c.text} is inconclusive.`,
      { compare: cmp },
    )
  }
  if (!c.converges && le !== null) {
    return test(
      'direct-comparison',
      'inconclusive',
      `${lhs} ≤ ${c.text}, but Σ ${c.text} diverges (${c.why}), and being smaller than a divergent series decides nothing — direct comparison is inconclusive.`,
      { compare: cmp },
    )
  }
  return test(
    'direct-comparison',
    'inconclusive',
    `${lhs} is neither always ≤ nor always ≥ ${c.text}, so direct comparison with Σ ${c.text} is inconclusive.`,
    { compare: cmp },
  )
}

function limitCompTest(ctx: Ctx, F: Facts, forAbs: boolean): SeriesTest {
  const { an } = ctx
  const pos = F.signs.kind === 'positive' || F.signs.kind === 'negative'
  if (!forAbs && !pos) {
    return test('limit-comparison', 'not-applicable', `The terms are not all positive, so limit comparison applies to Σ|${an}| (see absolute convergence).`)
  }
  const c = F.compare
  if (!c) return test('limit-comparison', 'undecided', 'No comparison series could be chosen from the terms computed.')
  const cmp = { text: c.text, tex: c.tex }
  const lhs = forAbs || F.signs.kind === 'negative' ? `|${an}|` : an
  const what = forAbs || F.signs.kind === 'negative' ? `Σ|${an}|` : `Σ${an}`
  const rows: { n: number; c: number; osc: boolean }[] = []
  for (const l of ctx.levels) {
    if (l.n < 1 && c.kind === 'power') continue
    const cs: number[] = []
    for (let j = 0; j < 4; j++) {
      const v = Math.abs(ctx.a(l.n + j)) / c.b(l.n + j)
      if (!Number.isFinite(v)) break
      cs.push(v)
    }
    if (cs.length < 4) break
    const mx = Math.max(...cs)
    const mn = Math.min(...cs)
    rows.push({ n: l.n, c: cs[0], osc: mx > 0 && (mx - mn) / mx > 0.02 })
  }
  const name = `lim ${lhs}/(${c.text})`
  if (rows.length < 4) return test('limit-comparison', 'undecided', `Too few terms to read ${name}.`, { compare: cmp })
  if (rows.slice(-2).every((r) => r.osc)) {
    return test('limit-comparison', 'not-applicable', `${lhs}/(${c.text}) keeps oscillating, so ${name} does not exist and the limit comparison test does not apply.`, { compare: cmp })
  }
  const cs = rows.map((r) => r.c)
  const k = cs.length
  const back = Math.max(0, k - 7)
  const mono = (dir: 1 | -1): boolean => {
    for (let i = back + 1; i < k; i++) if ((cs[i] - cs[i - 1]) * dir < 0) return false
    return true
  }
  if (cs[k - 1] < 1e-12 * Math.max(...cs) || (mono(-1) && cs[k - 1] <= 0.8 * cs[back])) {
    return test(
      'limit-comparison',
      'inconclusive',
      `${name} = 0, and the test needs a finite positive limit — limit comparison with Σ ${c.text} is inconclusive.`,
      { compare: cmp, limit: numberOf(0) },
    )
  }
  if (mono(1) && cs[k - 1] >= 1.25 * cs[back]) {
    return test(
      'limit-comparison',
      'inconclusive',
      `${name} = ∞, and the test needs a finite positive limit — limit comparison with Σ ${c.text} is inconclusive.`,
      { compare: cmp, limit: numberOf(Infinity) },
    )
  }
  if (k >= 4) {
    const t3 = rows.slice(-3)
    const p3 = rows.slice(-4, -1)
    const L1 = extrapolate(t3.map((t) => 1 / t.n), t3.map((t) => t.c))
    const L0 = extrapolate(p3.map((t) => 1 / t.n), p3.map((t) => t.c))
    if (L1 > 0 && Math.abs(L1 - L0) <= 1e-6 * L1) {
      const Ln = numberOf(L1, 1e-8)
      const eq = Ln.exact ? `= ${Ln.text}` : Ln.text
      const verb = c.converges ? 'converges' : 'diverges'
      return test(
        'limit-comparison',
        c.converges ? 'converges' : 'diverges',
        `${name} ${eq}, which is finite and positive, and Σ ${c.text} ${verb} (${c.why}), so ${what} ${verb} by the limit comparison test.`,
        { compare: cmp, limit: Ln },
      )
    }
  }
  return test('limit-comparison', 'undecided', `${name} does not settle as far out as the terms were computed — can’t decide numerically.`, { compare: cmp })
}

function altTest(ctx: Ctx, F: Facts): SeriesTest {
  const { an } = ctx
  if (F.signs.kind !== 'alternating') {
    return test('alternating', 'not-applicable', 'The terms do not alternate in sign, so the alternating series test does not apply.')
  }
  if (F.nth.state !== 'zero') {
    return test(
      'alternating',
      'not-applicable',
      F.nth.state === 'unknown' || F.nth.state === 'short'
        ? `It is not clear numerically that |${an}| → 0, which the alternating series test needs.`
        : `|${an}| does not approach 0, so the alternating series test does not apply (the nth-term test shows divergence).`,
    )
  }
  if (F.dec === null) {
    return test('alternating', 'inconclusive', `|${an}| is not eventually decreasing, so the alternating series test does not apply as stated.`)
  }
  const from = Math.max(F.dec, F.signs.from)
  return test(
    'alternating',
    'converges',
    `The terms alternate in sign, |${an}| decreases for ${ctx.L} ≥ ${from}, and lim |${an}| = 0, so Σ${an} converges by the alternating series test. The error after N terms is at most the next term: |S ${MINUS} S_N| ≤ |${ctx.src.name}_(N+1)|.`,
  )
}

// ---------------------------------------------------------------------------
// The integral test
// ---------------------------------------------------------------------------

function xText(plain: string | null, letter: string): string | null {
  if (!plain) return null
  const re = new RegExp(`(?<![A-Za-z])${letter}(?![A-Za-z])`, 'g')
  return plain
    .replace(re, 'x')
    .replace(/\^(\d+)/g, (_, d: string) => sup(d))
    .replace(/sqrt\(/g, '√(')
    .replace(/-/g, MINUS)
    .replace(/\*/g, '·')
}

function integralTest(ctx: Ctx, F: Facts): SeriesTest {
  const src = ctx.src
  const { an } = ctx
  if (!src.fx) {
    return test(
      'integral',
      'not-applicable',
      src.kind === 'recursive'
        ? 'The terms come from a recursive rule, not a formula f(n), so there is no f(x) to integrate.'
        : src.kind === 'list'
          ? 'The terms are a list, not a formula f(n), so there is no f(x) to integrate.'
          : 'This formula has no single f(x) behind every term, so the integral test does not apply.',
    )
  }
  if (F.signs.kind !== 'positive' && F.signs.kind !== 'negative') {
    return test('integral', 'not-applicable', 'The terms are not all positive, so the integral test does not apply.')
  }
  const sg = F.signs.kind === 'negative' ? -1 : 1
  const f = (x: number): number => sg * (src.fx as (x: number) => number)(x)
  const k0 = Math.max(src.k0, 1)
  // positive, continuous, decreasing: sampled finely near the start, then out to 10⁸
  const xs: number[] = []
  for (let x = k0; x <= k0 + 60; x += 0.25) xs.push(x)
  for (let e = Math.log10(k0 + 61); e <= 8; e += 0.05) xs.push(10 ** e)
  let badAt = -Infinity
  let prev = Number.NaN
  for (let i = 0; i < xs.length; i++) {
    const y = f(xs[i])
    if (!Number.isFinite(y) || y <= 0 || (i > 0 && Number.isFinite(prev) && y > prev * (1 + 1e-12))) badAt = xs[i]
    prev = y
  }
  const x0 = badAt === -Infinity ? k0 : Math.ceil(badAt + 1e-9)
  const fName = xText(src.plain, ctx.L)
  const fDef = fName ? `f(x) = ${fName}` : `f(x), the formula for ${an} with x in place of ${ctx.L},`
  if (x0 > k0 + 50) {
    const y = f(badAt)
    return test(
      'integral',
      'not-applicable',
      !Number.isFinite(y) || y <= 0
        ? `${fDef} is not positive and continuous for every x ≥ ${k0}, so the integral test does not apply.`
        : `${fDef} is not decreasing for large x, so the integral test does not apply.`,
    )
  }
  const hyp = `${fDef} is positive, continuous and decreasing for x ≥ ${x0}`
  const conclude = (conv: boolean, why: string): SeriesTest =>
    test(
      'integral',
      conv ? 'converges' : 'diverges',
      `${hyp}, and ∫_${x0}^∞ f(x) dx ${conv ? 'converges' : 'diverges'} (${why}). By the integral test, Σ${an} ${conv ? 'converges' : 'diverges'}.`,
    )
  // an exact p-series: the integral itself
  if (F.pser && !F.pser.alt) {
    const { p, C } = F.pser
    const pt = niceText(p)
    if (p > 1) {
      const val = numberOf((C * Math.pow(x0, 1 - p)) / (p - 1), 1e-11)
      return conclude(true, `∫ ${C === 1 ? '1' : niceText(C)}/${powText('x', p)} dx with p = ${pt} > 1; it equals ${val.text}`)
    }
    if (p === 1) return conclude(false, `∫ dx/x = ln x → ∞`)
    return conclude(false, `∫ dx/${powText('x', p)} grows like x^(1 ${MINUS} p) → ∞, p = ${pt} ≤ 1`)
  }
  // the power scale: p̂(x) = log₂ f(x)/f(2x)
  const ps: number[] = []
  for (let e = 2; e <= 12; e++) {
    const x = Math.max(x0, 10 ** e)
    const a = f(x)
    const b = f(2 * x)
    if (!(a > 0) || !(b > 0) || !Number.isFinite(a) || !Number.isFinite(b)) break
    ps.push(Math.log(a / b) / Math.LN2)
  }
  const k = ps.length
  if (k >= 2 && (ps[k - 1] > 30 || (ps[k - 1] > ps[k - 2] + 1 && ps[k - 1] > 4))) {
    return conclude(true, 'f(x) shrinks faster than every power of x, faster than 1/x²')
  }
  if (k < 3) {
    // f underflowed early: faster than any power
    const a = f(1e3)
    if (a === 0 || (Number.isFinite(a) && a < 1e-200)) return conclude(true, 'f(x) shrinks faster than every power of x, faster than 1/x²')
    return test('integral', 'undecided', `${hyp}, but ∫_${x0}^∞ f(x) dx could not be decided numerically.`)
  }
  const pl = ps[k - 1]
  const stable = Math.abs(ps[k - 1] - ps[k - 2]) < 2e-3 && Math.abs(ps[k - 2] - ps[k - 3]) < 5e-3
  if (stable && pl > 1.01) return conclude(true, `f(x) behaves like C/${powText('x', Math.round(pl * 100) / 100)} for large x, and ∫ dx/xᵖ converges for p > 1`)
  if (stable && pl < 0.99) return conclude(false, `f(x) behaves like C/x^(${approxText(pl, 3)}) for large x, and ∫ dx/xᵖ diverges for p ≤ 1`)
  if (!stable && Math.min(...ps.slice(-3)) > 1.2 && Math.abs(ps[k - 1] - ps[k - 2]) <= Math.abs(ps[k - 2] - ps[k - 3]) + 1e-9) {
    return conclude(true, `f(x) ≤ 1/x^(1.2) for large x, and ∫ dx/x^(1.2) converges`)
  }
  if (!stable && Math.max(...ps.slice(-3)) < 0.8 && Math.abs(ps[k - 1] - ps[k - 2]) <= Math.abs(ps[k - 2] - ps[k - 3]) + 1e-9) {
    return conclude(false, `f(x) ≥ 1/x^(0.8) for large x, and ∫ dx/x^(0.8) diverges`)
  }
  if (Math.abs(pl - 1) < 0.25) {
    // the logarithmic scale: x·f(x) ~ 1/(ln x)^q, read as log₂ G(x)/G(x²)
    const qs: number[] = []
    for (const x of [10, 30, 100, 300, 1000, 3000, 10000]) {
      if (x < x0 || x * x > 1e9) continue
      const G1 = x * f(x)
      const G2 = x * x * f(x * x)
      if (!(G1 > 0) || !(G2 > 0)) continue
      qs.push(Math.log(G1 / G2) / Math.LN2)
    }
    const m = qs.length
    if (m >= 3 && Math.abs(qs[m - 1] - qs[m - 2]) < 1e-3 && Math.abs(qs[m - 2] - qs[m - 3]) < 2e-3) {
      const q = qs[m - 1]
      if (Math.abs(q) < 1e-3) return conclude(false, `f(x) behaves like C/x for large x, and ∫ dx/x = ln x → ∞`)
      if (Math.abs(q - 1) < 1e-3) {
        return conclude(false, `f(x) behaves like 1/(x ln x) for large x, and ∫ dx/(x ln x) = ln(ln x) → ∞`)
      }
      const qt = approxText(Math.round(q * 1000) / 1000, 4)
      if (q < 1) return conclude(false, `f(x) behaves like 1/(x (ln x)^${qt}) with ${qt} < 1, and that integral grows like (ln x)^(1 ${MINUS} ${qt}) → ∞`)
      return conclude(true, `f(x) behaves like 1/(x (ln x)^${qt}) with ${qt} > 1, and ∫ dx/(x (ln x)^q) converges for q > 1`)
    }
  }
  return test('integral', 'undecided', `${hyp}, but whether ∫_${x0}^∞ f(x) dx converges could not be decided numerically.`)
}

// ---------------------------------------------------------------------------
// Absolute convergence
// ---------------------------------------------------------------------------

interface AbsResult {
  test: SeriesTest
  /** The sub-test that decided Σ|aₙ| (for the verdict's wording). */
  by: SeriesTestId | null
  reason: string
}

/**
 * The index from which |aₙ| ≥ 1/n at every term read (the dense run and every
 * far-out window), or null: it must start inside the dense run and hold out to
 * the last window.
 */
function harmonicFrom(ctx: Ctx): number | null {
  if (ctx.levels.length < 6 || ctx.levelCut !== 'none') return null
  let lastBelow = -Infinity
  for (const n of checkPoints(ctx)) {
    if (n < 1) continue
    const g = Math.abs(ctx.a(n))
    if (!Number.isFinite(g)) return null
    if (g < (1 / n) * (1 - 1e-12)) lastBelow = Math.max(lastBelow, n)
  }
  const from = lastBelow === -Infinity ? Math.max(ctx.src.k0, 1) : lastBelow + 1
  return from < ctx.src.k0 + ctx.vals.length ? from : null
}

function absTest(ctx: Ctx, F: Facts): AbsResult {
  const { an } = ctx
  if (F.signs.kind === 'positive' || F.signs.kind === 'negative' || F.signs.kind === 'zero') {
    return {
      test: test('absolute', 'not-applicable', 'Every term has the same sign, so absolute convergence is the same as convergence.'),
      by: null,
      reason: '',
    }
  }
  const tries: { id: SeriesTestId; outcome: SeriesOutcome; reason: string }[] = []
  if (F.geo) {
    const conv = Math.abs(F.geo.r) < 1
    tries.push({ id: 'geometric', outcome: conv ? 'converges' : 'diverges', reason: `Σ|${an}| is geometric with ratio |r| = ${niceText(Math.abs(F.geo.r))} ${conv ? '< 1' : '≥ 1'}` })
  }
  if (F.pser) {
    const pt = niceText(F.pser.p)
    const form = `${F.pser.C === 1 ? '1' : niceText(F.pser.C)}/${powText(ctx.L, F.pser.p)}`
    tries.push({
      id: 'p-series',
      outcome: F.pser.p > 1 ? 'converges' : 'diverges',
      reason: `Σ|${an}| = Σ ${form} is a p-series with p = ${pt} ${F.pser.p > 1 ? '> 1' : '≤ 1'}`,
    })
  }
  const r = ratioTest(ctx, F, true)
  if (r.outcome === 'converges' || r.outcome === 'diverges') tries.push({ id: 'ratio', outcome: r.outcome, reason: r.reason.replace(/\.$/, '') })
  const d = directTest(ctx, F, true)
  if (d.outcome === 'converges') tries.push({ id: 'direct-comparison', outcome: d.outcome, reason: d.reason.replace(/\.$/, '') })
  const l = limitCompTest(ctx, F, true)
  if (l.outcome === 'converges' || l.outcome === 'diverges') tries.push({ id: 'limit-comparison', outcome: l.outcome, reason: l.reason.replace(/\.$/, '') })
  // |aₙ| ≥ 1/n from some n on: Σ|aₙ| diverges by direct comparison with the
  // harmonic series — 1/ln n and ln(n)/n, which the tests above leave open.
  const h = harmonicFrom(ctx)
  if (h !== null) {
    tries.push({
      id: 'direct-comparison',
      outcome: 'diverges',
      reason: `by direct comparison with the harmonic series, |${an}| ≥ 1/${ctx.L} > 0 for ${ctx.L} ≥ ${h} and Σ 1/${ctx.L} diverges (p = 1)`,
    })
  }
  const hit = tries.find((t) => t.outcome === 'converges' || t.outcome === 'diverges')
  if (!hit) {
    return {
      test: test('absolute', 'undecided', `Whether Σ|${an}| converges could not be decided by the tests here.`),
      by: null,
      reason: '',
    }
  }
  if (hit.outcome === 'converges') {
    return {
      test: test('absolute', 'converges', `${hit.reason}, so Σ${an} converges absolutely — and a series that converges absolutely converges.`),
      by: hit.id,
      reason: hit.reason,
    }
  }
  return {
    test: test('absolute', 'diverges', `${hit.reason[0].toUpperCase()}${hit.reason.slice(1)}, so Σ|${an}| diverges: the series does not converge absolutely.`),
    by: hit.id,
    reason: hit.reason,
  }
}

// ============================================================================
// Sums
// ============================================================================

/** ζ(2k) = r·π^(2k) for the p-series an AP class meets. */
const ZETA: Record<number, { r: Frac; base: Base }> = {
  2: { r: mk(1n, 6n), base: B_PI2 },
  4: { r: mk(1n, 90n), base: B_PI4 },
  6: { r: mk(1n, 945n), base: B_PI6 },
  8: { r: mk(1n, 9450n), base: B_PI8 },
}

/** η(p) = Σ(−1)ⁿ⁺¹/nᵖ: ln 2, π²/12, 7π⁴/720. */
const ETA: Record<number, { r: Frac; base: Base }> = {
  1: { r: ONE, base: B_LN2 },
  2: { r: mk(1n, 12n), base: B_PI2 },
  4: { r: mk(7n, 720n), base: B_PI4 },
}

function exactSum(coef: Frac, base: Base, offset: Frac, how: string): SeriesSum | null {
  if (coef.q > 10n ** 9n || offset.q > 10n ** 12n) return null
  const value = fval(coef) * base.value + fval(offset)
  const t = linear(coef, base, offset)
  return { value, text: t.text, tex: t.tex, exact: true, error: 0, how }
}

function pSeriesSum(ctx: Ctx, ps: PFacts): SeriesSum | null {
  const k0 = ctx.src.k0
  const C = toFrac(ps.C, 1e6)
  if (!C || !Number.isInteger(ps.p) || k0 > 12) return null
  const p = ps.p
  if (!ps.alt) {
    const z = ZETA[p]
    if (!z) return null
    // σC(ζ(p) − Σ_{n<k₀} 1/nᵖ)
    let head: Frac = ZERO
    for (let n = 1; n < k0; n++) head = fadd(head, mk(1n, BigInt(n) ** BigInt(p)))
    const s = mk(BigInt(ps.sigma), 1n)
    return exactSum(fmul(fmul(s, C), z.r), z.base, fneg(fmul(fmul(s, C), head)), `ζ(${p}) = ${linear(z.r, z.base, ZERO).text}`)
  }
  const e = ETA[p]
  if (!e) return null
  // aₙ = σC(−1)ⁿ/nᵖ; Σ_{n≥1}(−1)ⁿ/nᵖ = −η(p)
  let head: Frac = ZERO
  for (let n = 1; n < k0; n++) head = fadd(head, mk(n % 2 === 0 ? 1n : -1n, BigInt(n) ** BigInt(p)))
  const sC = fmul(mk(BigInt(ps.sigma), 1n), C)
  const how = p === 1 ? 'the alternating harmonic series: ln 2' : `η(${p}) = ${linear(e.r, e.base, ZERO).text}`
  return exactSum(fneg(fmul(sC, e.r)), e.base, fneg(fmul(sC, head)), how)
}

function expSum(ctx: Ctx, ex: ExpFacts): SeriesSum | null {
  const k0 = ctx.src.k0
  const x = toFrac(ex.x, 1e4)
  const C = toFrac(ex.C, 1e6)
  if (!x || !C || x.q !== 1n || k0 > 12) return null
  const xi = Number(x.p)
  // C(eˣ − Σ_{n<k₀} xⁿ/n!)
  let head: Frac = ZERO
  let fact = 1n
  for (let n = 0; n < k0; n++) {
    if (n > 0) fact *= BigInt(n)
    head = fadd(head, mk(x.p ** BigInt(n), fact))
  }
  let base: Base
  if (xi === 1) base = B_E
  else if (xi === -1) base = B_EINV
  else base = { value: Math.exp(xi), text: `e${sup(xi)}`, tex: `e^{${xi}}`, word: xi < 0 }
  return exactSum(C, base, fneg(fmul(C, head)), `Σ xⁿ/n! = eˣ with x = ${xi}`)
}

/** Partial sums S_N at N = k₀ … top (Kahan). */
function sumsTo(ctx: Ctx, top: number): number[] {
  const out: number[] = []
  const k = new Kahan()
  for (let n = ctx.src.k0; n <= top; n++) {
    k.add(ctx.a(n))
    out.push(k.s)
  }
  return out
}

function numericSum(ctx: Ctx, F: Facts, verdictBy: SeriesTestId | null): { sum: SeriesSum | null; note: string | null } {
  const k0 = ctx.src.k0
  const slow = 'The series converges, but its terms shrink too slowly to pin the sum down numerically.'
  // 1. geometric-rate: the ratio test says L < 1
  if (F.ratio.state === 'zero' || (F.ratio.state === 'limit' && (F.ratio.L ?? 1) < 1)) {
    const k = new Kahan()
    let n = k0
    let err = Infinity
    for (; n < k0 + 200_000 && n <= ctx.src.maxIndex; n++) {
      const v = ctx.a(n)
      if (!Number.isFinite(v)) break
      k.add(v)
      if (n > k0 + 20 && Math.abs(v) <= 1e-17 * Math.max(Math.abs(k.s), 1e-300)) {
        err = Math.abs(v) * 4
        break
      }
    }
    if (!Number.isFinite(err)) {
      const lastRatio = Math.abs(ctx.a(n) / ctx.a(n - 1))
      const tail = Math.abs(ctx.a(n))
      err = lastRatio < 1 ? tail / (1 - lastRatio) : Infinity
    }
    if (!Number.isFinite(err)) return { sum: null, note: slow }
    return { sum: finish(k.s, err, 'numeric: the terms shrink geometrically'), note: null }
  }
  // 2. alternating: repeated averaging of partial sums (Euler), bound by |a_(N+1)|
  if (F.signs.kind === 'alternating' && F.dec !== null) {
    const N0 = Math.max(F.dec, F.signs.from, k0) + 60
    if (N0 + 40 > ctx.src.maxIndex) return { sum: null, note: slow }
    const S = sumsTo(ctx, N0 + 40).slice(N0 - k0)
    let row = S.slice()
    let prevEst = Number.NaN
    let est = row[row.length - 1]
    for (let lvl = 0; lvl < 30 && row.length > 1; lvl++) {
      prevEst = est
      row = row.slice(1).map((s, i) => (s + row[i]) / 2)
      est = row[row.length - 1]
    }
    const err = Math.max(Math.abs(est - prevEst) * 10, 4e-16 * Math.abs(est))
    return { sum: finish(est, err, 'numeric: alternating series, accelerated'), note: null }
  }
  // 3. positive, power-like: Richardson on S_N
  const P = F.power
  if ((F.signs.kind === 'positive' || F.signs.kind === 'negative') && F.dec !== null && P && P.stable && P.pc > 1) {
    const p = P.pc
    const Ns = [1024, 2048, 4096, 8192, 16384].map((m) => k0 + m).filter((N) => N <= ctx.src.maxIndex)
    if (Ns.length >= 4) {
      const all = sumsTo(ctx, Ns[Ns.length - 1])
      let row = Ns.map((N) => all[N - k0])
      const exps = [p - 1, p, p + 1, p + 2]
      const ests: number[] = []
      for (let lvl = 0; lvl < exps.length && row.length > 1; lvl++) {
        const f = 2 ** exps[lvl]
        row = row.slice(1).map((s, i) => (f * s - row[i]) / (f - 1))
        ests.push(row[row.length - 1])
      }
      const est = ests[ests.length - 1]
      const err = ests.length > 1 ? Math.abs(est - ests[ests.length - 2]) * 10 : Infinity
      if (Number.isFinite(err) && err < 1e-4 * Math.max(1, Math.abs(est))) {
        return { sum: finish(est, Math.max(err, 1e-15 * Math.abs(est)), 'numeric: partial sums extrapolated'), note: null }
      }
    }
  }
  // 4. absolutely convergent by comparison with 1/nᵖ: sum far, bound the tail
  if (P && P.pc > 1 && (verdictBy === 'direct-comparison' || verdictBy === 'limit-comparison' || verdictBy === 'absolute')) {
    const N = Math.min(k0 + 131_072, ctx.src.maxIndex)
    const all = sumsTo(ctx, N)
    const s = all[all.length - 1]
    // Σ_{n>N} |aₙ| ≲ C·N^(1−p)/(p − 1), C read off the last window
    const lv = ctx.levels[ctx.levels.length - 1]
    const C = lv ? lv.M * Math.pow(lv.n, P.pc) : 1
    const err = (C * Math.pow(N, 1 - P.pc)) / (P.pc - 1)
    if (Number.isFinite(s) && Number.isFinite(err) && err < 0.01 * Math.max(1, Math.abs(s))) {
      return { sum: finish(s, err, `numeric: ${N - k0 + 1} terms, the tail bounded by comparison`), note: null }
    }
  }
  return { sum: null, note: slow }
}

function finish(v: number, err: number, how: string): SeriesSum {
  if (err < 1e-11 * Math.max(1, Math.abs(v))) {
    const r = recognize(v, Math.max(err / Math.max(1, Math.abs(v)), 1e-13) * 4)
    if (r) return { value: v, text: r.text, tex: r.tex, exact: true, error: err, how }
  }
  const digits = Math.max(3, Math.min(10, Math.floor(-Math.log10(Math.max(err, 1e-16) / Math.max(1, Math.abs(v)))) + 1))
  return {
    value: v,
    text: `≈ ${approxText(v, digits)}`,
    tex: `\\approx ${approxTex(v, digits)}`,
    exact: false,
    error: err,
    how,
  }
}

// ============================================================================
// analyzeSeries
// ============================================================================

const VERDICT_TEXT: Record<SeriesVerdict, string> = {
  converges: 'Converges',
  'converges-absolutely': 'Converges absolutely',
  'converges-conditionally': 'Converges conditionally',
  diverges: 'Diverges',
  unknown: 'Can’t decide',
  finite: 'A finite sum',
}

function seriesTex(src: SeriesSource): string {
  return `\\sum_{${src.letter}=${src.k0}}^{\\infty} ${src.termTex}`
}

function blank(src: SeriesSource, problem: string, termName: string): SeriesAnalysis {
  return {
    k0: src.k0,
    termName,
    tex: seriesTex(src),
    signs: 'mixed',
    verdict: 'unknown',
    verdictText: VERDICT_TEXT.unknown,
    decidedBy: null,
    justification: problem,
    tests: [],
    sum: null,
    sumNote: null,
    boundFrom: null,
    problem,
  }
}

const decisive = (t: SeriesTest | undefined): t is SeriesTest => !!t && (t.outcome === 'converges' || t.outcome === 'diverges')

/** Everything the card says about Σ aₙ. Never throws. */
export function analyzeSeries(src: SeriesSource): SeriesAnalysis {
  const termName = `${src.name}${sub(src.letter)}`
  try {
    return analyzeInner(src, termName)
  } catch {
    return blank(src, 'This series could not be analyzed.', termName)
  }
}

function analyzeInner(src: SeriesSource, termName: string): SeriesAnalysis {
  const ctx = makeCtx(src)
  const k0 = src.k0
  if (ctx.vals.length === 0) {
    return blank(src, `${src.name}${sub(k0)} is undefined, so the series cannot start at ${src.letter} = ${k0} — start it later (n from … on the card).`, termName)
  }
  if (ctx.cut === 'undefined' && ctx.vals.length < DENSE && src.kind !== 'list') {
    const bad = k0 + ctx.vals.length
    return blank(src, `${src.name}${sub(bad)} is undefined, so the series has an undefined term.`, termName)
  }
  // a finite list: a finite sum
  if (src.finite) {
    let acc: Frac | null = ZERO
    let s = 0
    for (const v of ctx.vals) {
      s += v
      const f = toFrac(v, 1e6)
      acc = acc && f ? fadd(acc, f) : null
    }
    const S: SeriesNumber = acc && acc.q < 10n ** 12n ? numberFromFrac(acc) : numberOf(s)
    const why = `A finite list: its ${ctx.vals.length} terms add up to ${S.text}. Only an infinite series needs a convergence test.`
    return {
      k0,
      termName,
      tex: seriesTex(src),
      signs: 'mixed',
      verdict: 'finite',
      verdictText: VERDICT_TEXT.finite,
      decidedBy: null,
      justification: why,
      tests: [],
      sum: { ...S, error: 0, how: 'the terms added' },
      sumNote: null,
      boundFrom: null,
      problem: null,
    }
  }

  const signs = signFacts(ctx)
  const ratio = ratioFacts(ctx)
  const power = powerFacts(ctx)
  const F: Facts = {
    signs,
    nth: nthFacts(ctx),
    ratio,
    geo: geoFacts(ctx),
    pser: pFacts(ctx, signs),
    expo: null,
    tele: null,
    power,
    dec: decreasingFrom(ctx),
    compare: chooseCompare(ctx, ratio, power),
  }
  F.expo = expFacts(ctx)
  F.tele = F.geo || F.pser ? null : teleFacts(ctx)

  const byId = new Map<SeriesTestId, SeriesTest>()
  byId.set('nth-term', nthTest(ctx, F))
  byId.set('geometric', geometricTest(ctx, F))
  byId.set('p-series', pTest(ctx, F))
  byId.set('telescoping', teleTest(ctx, F))
  byId.set('ratio', ratioTest(ctx, F))
  byId.set('direct-comparison', directTest(ctx, F, false))
  byId.set('limit-comparison', limitCompTest(ctx, F, false))
  byId.set('integral', integralTest(ctx, F))
  byId.set('alternating', altTest(ctx, F))
  const abs = absTest(ctx, F)
  byId.set('absolute', abs.test)
  const T = (id: SeriesTestId): SeriesTest => byId.get(id) as SeriesTest

  let verdict: SeriesVerdict = 'unknown'
  let decidedBy: SeriesTestId | null = null
  let justification = ''
  const take = (t: SeriesTest, v?: SeriesVerdict): boolean => {
    verdict = v ?? (t.outcome === 'converges' ? 'converges' : 'diverges')
    decidedBy = t.id
    justification = t.reason
    return true
  }
  const an = ctx.an

  if (signs.kind === 'zero') {
    verdict = 'converges'
    justification = `Every term from ${src.letter} = ${signs.from} on is 0, so the series is really a finite sum.`
  } else if (signs.kind === 'positive' || signs.kind === 'negative') {
    const geo = T('geometric')
    const ps = T('p-series')
    const rt = T('ratio')
    const nth = T('nth-term')
    const order: (SeriesTest | undefined)[] = [
      decisive(geo) ? geo : undefined,
      decisive(ps) && (F.pser?.p ?? 0) > 0 ? ps : undefined,
      decisive(rt) ? rt : undefined,
      nth.outcome === 'diverges' ? nth : undefined,
      T('telescoping'),
      T('direct-comparison'),
      T('limit-comparison'),
      T('integral'),
      decisive(ps) ? ps : undefined,
    ]
    const hit = order.find(decisive)
    if (hit) take(hit)
  } else {
    // alternating or mixed signs
    const geo = T('geometric')
    const nth = T('nth-term')
    const rt = T('ratio')
    const ast = T('alternating')
    if (decisive(geo)) take(geo, geo.outcome === 'converges' ? 'converges-absolutely' : 'diverges')
    else if (nth.outcome === 'diverges') take(nth)
    else if (decisive(rt)) take(rt, rt.outcome === 'converges' ? 'converges-absolutely' : 'diverges')
    else if (abs.test.outcome === 'converges') {
      take(abs.test, 'converges-absolutely')
      decidedBy = abs.by ?? 'absolute'
    } else if (ast.outcome === 'converges') {
      if (abs.test.outcome === 'diverges') {
        verdict = 'converges-conditionally'
        decidedBy = 'alternating'
        justification = `${ast.reason.replace(/ The error after.*$/, '')} But ${abs.reason}, so Σ|${an}| diverges. The series converges conditionally.`
      } else {
        take(ast, 'converges')
      }
    }
  }
  if ((verdict as SeriesVerdict) === 'unknown') {
    justification =
      signs.kind === 'mixed' && src.kind === 'list'
        ? 'Only the listed terms are known — type a formula to test the infinite series.'
        : 'None of the tests could decide this series from the terms computed, so no verdict is given. Partial sums alone never prove convergence.'
  }

  // the sum, only once convergence is established
  let sum: SeriesSum | null = null
  let sumNote: string | null = null
  const vd = verdict as SeriesVerdict
  const converges = vd === 'converges' || vd === 'converges-absolutely' || vd === 'converges-conditionally'
  if (converges) {
    if (signs.kind === 'zero') {
      const all = sumsTo(ctx, signs.from)
      sum = finish(all[all.length - 1], 1e-16, 'the nonzero terms added')
    } else if (F.geo && Math.abs(F.geo.r) < 1) {
      const S = geometricSum(F.geo)
      sum = { ...S, error: 0, how: 'geometric: a/(1 − r)' }
    } else if (F.pser) {
      sum = pSeriesSum(ctx, F.pser)
    }
    if (!sum && F.expo) sum = expSum(ctx, F.expo)
    if (!sum && F.tele) {
      const t = F.tele
      const S = t.sumFrac && t.sumFrac.q < 10n ** 12n ? numberFromFrac(t.sumFrac) : numberOf(t.sum)
      sum = { ...S, error: 0, how: 'telescoping' }
    }
    if (!sum) {
      const r = numericSum(ctx, F, decidedBy)
      sum = r.sum
      sumNote = r.note
    }
    if (sum && !Number.isFinite(sum.value)) {
      // Σ 1000ⁿ/n! = e¹⁰⁰⁰ − 1: exact, but past the largest double
      sumNote = sum.exact
        ? `The series converges to ${sum.text}, a number too large to write out as a decimal.`
        : 'The series converges, but its sum is too large to write out as a decimal.'
      sum = null
    }
  }

  const boundFrom = signs.kind === 'alternating' && T('alternating').outcome === 'converges' && F.dec !== null
    ? Math.max(F.dec, signs.from) - 1
    : null

  return {
    k0,
    termName,
    tex: seriesTex(src),
    signs: signs.kind,
    verdict,
    verdictText: VERDICT_TEXT[verdict],
    decidedBy,
    justification,
    tests: SERIES_TEST_ORDER.map((id) => T(id)),
    sum,
    sumNote,
    boundFrom,
    problem: null,
  }
}

// ============================================================================
// Partial sums
// ============================================================================

/** S_k₀, S_k₀₊₁, … S_N (Kahan). NaN from the first undefined term on. */
export function partialSumsTo(src: SeriesSource, N: number): number[] {
  const out: number[] = []
  if (!Number.isFinite(N) || N < src.k0) return out
  const k = new Kahan()
  let dead = false
  for (let n = src.k0; n <= Math.min(N, src.k0 + 100_000); n++) {
    const v = src.term(n)
    if (!Number.isFinite(v)) dead = true
    if (dead) {
      out.push(Number.NaN)
      continue
    }
    k.add(v)
    out.push(k.s)
  }
  return out
}

/**
 * S_N as an exact fraction ("5269/3600") when every term is a fraction the
 * double represents exactly enough and the result stays readable; else null.
 */
export function exactPartialSum(src: SeriesSource, N: number): SeriesNumber | null {
  if (!Number.isFinite(N) || N < src.k0 || N - src.k0 > 400) return null
  let acc: Frac = ZERO
  for (let n = src.k0; n <= N; n++) {
    const v = src.term(n)
    const f = toFrac(v, 1e7)
    if (!f) return null
    acc = fadd(acc, f)
    if (acc.q > 10n ** 10n || (acc.p < 0n ? -acc.p : acc.p) > 10n ** 14n) return null
  }
  return numberFromFrac(acc)
}

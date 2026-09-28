// ============================================================================
// Logistic functions, the way AP Calculus BC and AP Precalculus state them
// (src/core/logistic.ts)
//
//     y = L / (1 + A·e^(−k(x − h))) + d
//
//   L  carrying capacity: the curve climbs from y = d to y = L + d
//      (AP Precalc calls it a: y = a/(1 + b·e^(−kx)) + d)
//   k  growth constant: dy/dx = k(y − d)(1 − (y − d)/L)
//   A  the constant in the denominator (AP Precalc's b). With h = 0 it is the
//      AP Calc A = L/y(0) − 1, and A = e^(k·x0)
//   h  a shift INSIDE the exponent — only for a line typed that way,
//      L/(1 + e^(−k(x − x0))) (the midpoint form, A = 1, h = x0)
//   d  vertical shift: both asymptotes and the inflection move with it
//
//   The midpoint (inflection) is x0 = h + ln(A)/k, at height L/2 + d, and the
//   curve's steepest slope there is L·k/4.
//
// The spec keeps A and h rather than one x0 because a teacher types both
// shapes — 1000/(1 + 49e^(−0.3t)) and 10/(1 + e^(−2(x − 3))) — and each must
// come back as it was written. x0 is always derived (logisticValues).
//
// A third writing, L/(1 + A·b^(−x)), keeps its base in `b` (then k = ln b and
// the `k` text is unused).
//
// Like every family module, a spec only ever becomes an ordinary TYPED line:
// the parser draws it, the analysis marks it, the exports print it.
//
//   export function logisticSource(spec): string
//       "y = 1000/(1 + 49e^(-0.3x))", "f(t) = 10/(1 + e^(-2(t - 3))) + 1",
//       "y = 10/(1 + 3(2)^(-x))". Numbers keep the teacher's text.
//   export function readLogistic(src): LogisticSpec | null
//       the inverse for a typed logistic in any of the common shapes (see
//       "Reading" below), verified numerically: a misread is never returned.
//   export function logisticValues(spec) / logisticAt(spec, x)
//   export function logisticToParams(spec)   → the library's [a, b, c, d]
//   export function logisticFromParams(p)    ← a sketch's fitted params
//   export function logisticFromInitial(L, k, y0, d?) — "P(0) = 20, L = 1000,
//       k = 0.3": A = L/(y(0) − d) − 1, exact when the numbers are.
//   export function logisticFeatures(spec) — asymptotes, inflection (with an
//       exact "4 ln 2" when the numbers allow), maximum rate, y-intercept, the
//       differential equation it solves, and the AP facts.
// ============================================================================

import { evalAst, parseAst, type ExprNode } from './parse'
import {
  bareCoefficient,
  cNeg,
  cOf,
  cSum,
  cText,
  coefficientText,
  constantTail,
  dec12,
  exactOf,
  hasVar,
  isExactly,
  joinSep,
  negText,
  nodeOf,
  onlyVar,
  prec,
  ratDecText,
  readExponential,
  shifted,
  snapRat,
  srcOf,
  sumTerms,
  usesVar,
  valueOf,
} from './exponential'
import type { ConstText, Rat } from './exponential'

export interface LogisticSpec {
  /** The function's name when typed as f(x) = …; absent for y = … */
  name?: string
  /** 't' when the line is written in t (AP Calc's P(t)); absent = x. */
  v?: 't'
  /** Carrying capacity L (AP Precalc's a), as written. */
  L: string
  /** Growth constant k, as written (unused when `b` is set). */
  k: string
  /** The denominator's constant A (AP Precalc's b), as written. */
  A: string
  /** Shift inside the exponent, default "0". */
  h: string
  /** Vertical shift d, default "0". */
  d: string
  /** The base of L/(1 + A·b^(−x)); k = ln b. Absent for base e. */
  b?: string
}

export interface LogisticValues {
  L: number
  k: number
  A: number
  h: number
  d: number
  /** A with the shift folded in: y = L/(1 + Aeff·e^(−kx)) + d. */
  Aeff: number
  /** The midpoint / inflection x. */
  x0: number
  /** The base when written with one, else null. */
  base: number | null
}

/** A number the card prints: its value, and a closed form when there is one. */
export interface ExactNumber {
  value: number
  /** "4 ln 2", "(20/3) ln 7", "500", "20/3" — plain Unicode, true minus. */
  exact: string | null
  /** KaTeX of the exact form. */
  tex: string | null
  /** "4 ln 2 ≈ 2.773", or the 4-digit decimal when there is no exact form. */
  text: string
}

export interface LogisticFeatures {
  values: LogisticValues
  /** y = d */
  lower: number
  /** y = L + d */
  upper: number
  /** The inflection point — the midpoint, where the curve is steepest. */
  inflection: { x: ExactNumber; y: ExactNumber }
  /** dy/dx at the inflection, L·k/4 (signed). */
  maxRate: ExactNumber
  /** y(0), or null when it does not exist. */
  yIntercept: ExactNumber | null
  increasing: boolean
  /** "dy/dx = 0.3y(1 − y/1000)", with (y − d) when shifted. */
  de: string
  /** The same as KaTeX. */
  deTex: string
  /** The same as a line the slope-field parser reads. */
  fieldSource: string
  /** The AP Calculus BC facts, as sentences. */
  apFacts: string[]
}

// ============================================================================
// Implementation
// ============================================================================

const MINUS = '−'

/** Blank or missing → the default. */
const txt = (s: string | undefined, dflt: string): string => {
  const t = (s ?? '').trim()
  return t === '' ? dflt : t
}

const hasBase = (spec: LogisticSpec): boolean => spec.b !== undefined && spec.b.trim() !== ''

/** 4 significant digits, trailing zeros dropped, true minus. */
function fmt4(v: number): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : `${MINUS}∞`
  if (Math.abs(v) < 1e-12) return '0'
  return String(Number(v.toPrecision(4))).replace('-', MINUS)
}

/**
 * A computed number as text: a small fraction or terminating decimal when it
 * IS one, otherwise 12 significant digits (the reading is verified against
 * the typed line at 1e-7, so twelve digits is never the reason it fails).
 */
function niceNum(v: number): string {
  if (Math.abs(v) < 1e-300) return '0'
  const r = snapRat(v, 100, 1e-10)
  return r ? ratDecText(r) : dec12(v)
}

// ----------------------------------------------------------------------------
// values
// ----------------------------------------------------------------------------

export function logisticValues(spec: LogisticSpec): LogisticValues | null {
  const L = valueOf(txt(spec.L, '1'))
  const A = valueOf(txt(spec.A, '1'))
  const h = valueOf(txt(spec.h, '0'))
  const d = valueOf(txt(spec.d, '0'))
  let k: number
  let base: number | null = null
  if (hasBase(spec)) {
    base = valueOf(spec.b)
    if (!(base > 0) || base === 1) return null
    k = Math.log(base)
  } else {
    k = valueOf(txt(spec.k, '1'))
  }
  if (![L, A, h, d, k].every(Number.isFinite)) return null
  if (L === 0 || k === 0 || !(A > 0)) return null
  const Aeff = A * Math.exp(k * h)
  const x0 = h + Math.log(A) / k
  if (!Number.isFinite(x0)) return null
  return { L, k, A, h, d, Aeff, x0, base }
}

/** The spec's function at x (NaN when a part is not a number). */
export function logisticAt(spec: LogisticSpec, x: number): number {
  const v = logisticValues(spec)
  if (!v) return NaN
  return v.L / (1 + v.A * Math.exp(-v.k * (x - v.h))) + v.d
}

// ----------------------------------------------------------------------------
// the library family: [a, b, c, d] → a/(1 + e^(−b(x − c))) + d
// ----------------------------------------------------------------------------

/** The library params of the same curve: [L, k, x0, d]. */
export function logisticToParams(spec: LogisticSpec): [number, number, number, number] | null {
  const v = logisticValues(spec)
  return v ? [v.L, v.k, v.x0, v.d] : null
}

/** `sig` significant digits as text (tiny values next to `ref` become 0). */
function sigText(v: number, sig: number, ref = 1): string {
  if (!Number.isFinite(v) || Math.abs(v) < 1e-9 * Math.max(1, Math.abs(ref))) return '0'
  const r = snapRat(v, 12, 1e-9)
  if (r) return ratDecText(r)
  return String(Number(v.toPrecision(sig)))
}

/**
 * A sketch's fitted params stated the AP way, L/(1 + A·e^(−kx)) + d, to `sig`
 * significant digits (a hand-drawn curve is not measured closer). Null when
 * the params are not a logistic (a = 0, b = 0).
 */
export function logisticFromParams(p: readonly number[], sig = 4): LogisticSpec | null {
  const [a, b, c, d] = p
  if (![a, b, c, d].every((v) => typeof v === 'number' && Number.isFinite(v))) return null
  if (Math.abs(a) < 1e-12 || Math.abs(b) < 1e-9) return null
  const A = Math.exp(b * c)
  if (!(A > 0) || !Number.isFinite(A)) return null
  const spec: LogisticSpec = {
    L: sigText(a, sig),
    k: sigText(b, sig),
    A: sigText(A, sig),
    h: '0',
    d: sigText(d, sig, a),
  }
  return logisticValues(spec) ? spec : null
}

// ----------------------------------------------------------------------------
// logisticSource
//
//   head      `y = `, or `name(v) = `
//   numerator L bare when it is one atom or a negated one (1000, -5, pi,
//             sqrt(2)); otherwise parenthesised: (1/2)/(1 + …)
//   exponent  −k·X with X = v or (v − h): e^(-0.3x), e^(-x), e^(-2(x - 3)),
//             e^(0.3x) for k = −0.3, e^x for k = −1, e^(-(1/2)x) for k = 1/2
//   A         omitted for 1, else in front of the power: 49e^(…), 0.5e^(…),
//             (1/3)e^(…)
//   base b    A(b)^(-x), b^(-x) bare for an integer base ≥ 2 with A = 1
//   d         constantTail: " + 5", " - 3", nothing for 0
// ----------------------------------------------------------------------------

/** One atom (optionally negated) the parser reads the same in front of `/`. */
function bareAtom(s: string): boolean {
  const n = nodeOf(s)
  if (!n) return false
  const m = n.t === 'neg' ? n.a : n
  return prec(m) >= 4
}

/** "x", "x - 1", "t + 3" … */
function shiftedIn(h: string, v: string): string {
  const s = shifted(h)
  return v + s.slice(1)
}

/** The coefficient text of A in front of a power ("49", "(1/3)"). */
function frontCoefficient(a: string): string {
  return bareCoefficient(a) && !a.includes('/') ? a : `(${a})`
}

export function logisticSource(spec: LogisticSpec): string {
  const v = spec.v ?? 'x'
  const head = spec.name ? `${spec.name}(${v}) = ` : 'y = '
  const L = txt(spec.L, '1')
  const A = txt(spec.A, '1')
  const X = shiftedIn(txt(spec.h, '0'), v)
  const grouped = X === v ? v : `(${X})`
  const unitA = isExactly(A, 1)

  let pow: string
  if (hasBase(spec)) {
    const b = spec.b!.trim()
    const base = unitA && /^\d+$/.test(b) && Number(b) >= 2 ? b : `(${b})`
    pow = `${base}^(-${grouped})`
  } else {
    // the exponent is −k·X; its coefficient is written with the sign in front
    const c = negRate(txt(spec.k, '1'))
    let exponent: string
    if (isExactly(c, 1)) exponent = X
    else if (isExactly(c, -1)) exponent = `-${grouped}`
    else {
      const neg = c.startsWith('-')
      const mag = neg ? c.slice(1).trim() : c
      const coef = bareCoefficient(mag) && !mag.includes('/') && !mag.startsWith('-') ? mag : `(${mag})`
      exponent = `${neg ? '-' : ''}${coef}${joinSep(coef, grouped)}${grouped}`
    }
    pow = exponent === v ? `e^${v}` : `e^(${exponent})`
  }
  let term: string
  if (unitA) term = pow
  else {
    const coef = frontCoefficient(A)
    term = `${coef}${joinSep(coef, pow)}${pow}`
  }
  const num = bareAtom(L) ? L : `(${L})`
  return `${head}${num}/(1 + ${term})${constantTail(txt(spec.d, '0'))}`
}

// ----------------------------------------------------------------------------
// readLogistic
//
// The body (after `y =`, `f(x) =`, `f(t) =`, or bare) is read two ways.
//
// 1. STRUCTURALLY, keeping the teacher's text: a sum of constant terms (d)
//    and ONE term that is constant factors (L) over ONE denominator that is
//    a sum of constants (c₀ > 0) and ONE exponential term — the denominator's
//    exponential is read by readExponential, so every way of typing it
//    (49e^(-0.3x), 3*2^(-x), exp(-x/2), e^(-2(x - 3))) is understood the
//    same way the Exponential section understands it. c₀ = 1 keeps every
//    text (L, A, k, h); any other c₀ is divided out (exactly when rational).
//    A base other than e keeps its base: 3(2)^(-x) is A = 3, b = 2.
//
// 2. NUMERICALLY, for everything else that is still a logistic — e^x/(1+e^x),
//    (1 + 2e^x)/(1 + e^x), 5 - 3/(2 + e^(x/2)) written oddly: every variable
//    in the line must sit in the exponent of ONE rate m of exponentials
//    (b^u, e^u, exp(u), u linear), and then f is a Möbius function of
//    u = e^(−mx), (p + q·u)/(1 + r·u), whose three coefficients three
//    samples determine. r > 0 and p ≠ q/r make it a logistic: d = q/r,
//    L = p − d, A = r, k = m. Numbers are written as small fractions or
//    12-digit decimals.
//
// Either reading is then checked against the typed line at fourteen points
// — nine fixed and five spread across the S itself — and any disagreement
// is null. Rejected: 1/(1 + x²) (the variable is not in an exponent), a
// plain exponential (r = 0), 1 − 49e^(−x) in a denominator (A < 0: a pole,
// not an S), tanh(x) (no exponential in the line, though it IS a logistic).
// ----------------------------------------------------------------------------

const SAMPLES = [-2.71, -1.13, -0.37, 0, 0.29, 0.83, 1.61, 2.2, 3.07]

/**
 * −s as text, for a rate: "-0.3" → "0.3", "-2/3" → "2/3", "0.3" → "-0.3",
 * anything else through negText.
 */
function negRate(s: string): string {
  const t = s.trim()
  const v = valueOf(t)
  if (t.startsWith('-')) {
    let rest = t.slice(1).trim()
    if (rest.startsWith('(') && rest.endsWith(')') && nodeOf(rest.slice(1, -1))) rest = rest.slice(1, -1).trim()
    if (nodeOf(rest) && Math.abs(valueOf(rest) + v) <= 1e-12 * Math.max(1, Math.abs(v))) return rest
  }
  const n = nodeOf(t)
  if (n && (prec(n) >= 4 || (n.t === 'bin' && n.op === '/' && n.a.t === 'num' && n.b.t === 'num'))) return `-${t}`
  return negText(t)
}

/** s / c as text: exact when both are rational. */
function divText(s: string, c: ConstText): string {
  const r = exactOf(s)
  if (r && c.r) {
    const q = ratDiv(r, c.r)
    if (q) return ratDecText(q)
  }
  return niceNum(valueOf(s) / c.v)
}

/** 1/b as text: "1/2" → "2", "3" → "1/3", "2/3" → "1.5". */
function invText(s: string): string {
  const r = exactOf(s)
  if (r && r[0] !== 0) {
    const q = ratDiv([1, 1], r)
    // a unit fraction stays a fraction: 1/2 is how a base is written, not 0.5
    if (q) return q[0] === 1 && q[1] > 1 ? `1/${q[1]}` : ratDecText(q)
  }
  const m = /^1\s*\/\s*(.+)$/.exec(s.trim())
  if (m && nodeOf(m[1])) return m[1].trim()
  return niceNum(1 / valueOf(s))
}

function structural(body: ExprNode): LogisticSpec | null {
  // ---- the outer sum: constants (d) and one term with the variable -------
  const terms: { n: ExprNode; s: 1 | -1 }[] = []
  sumTerms(body, 1, terms)
  const constants: ConstText[] = []
  let term: { n: ExprNode; s: 1 | -1 } | null = null
  for (const t of terms) {
    if (!hasVar(t.n)) constants.push(t.s < 0 ? cNeg(cOf(t.n)) : cOf(t.n))
    else if (term) return null
    else term = t
  }
  if (!term) return null

  // ---- the term: constant factors over one denominator -------------------
  let sign = term.s as number
  const consts: { c: ConstText; p: number }[] = []
  let den: ExprNode | null = null
  const flatten = (n: ExprNode, p: 1 | -1): boolean => {
    if (!hasVar(n)) {
      consts.push({ c: cOf(n), p })
      return true
    }
    if (n.t === 'neg') { sign = -sign; return flatten(n.a, p) }
    if (n.t === 'bin' && n.op === '*') return flatten(n.a, p) && flatten(n.b, p)
    if (n.t === 'bin' && n.op === '/') return flatten(n.a, p) && flatten(n.b, -p as 1 | -1)
    if (n.t === 'bin' && n.op === '^' && !hasVar(n.b) && evalAst(n.b, NaN) === -1) {
      return flatten(n.a, -p as 1 | -1) // (1 + e^(-x))^(-1)
    }
    if (p === -1 && den === null) {
      den = n
      return true
    }
    return false
  }
  if (!flatten(term.n, 1) || den === null) return null

  // ---- the denominator: c₀ + one exponential -----------------------------
  const dts: { n: ExprNode; s: 1 | -1 }[] = []
  sumTerms(den, 1, dts)
  const c0s: ConstText[] = []
  let E: { n: ExprNode; s: 1 | -1 } | null = null
  for (const t of dts) {
    if (!hasVar(t.n)) c0s.push(t.s < 0 ? cNeg(cOf(t.n)) : cOf(t.n))
    else if (E) return null
    else E = t
  }
  if (!E || c0s.length === 0) return null
  const c0 = cSum(c0s)
  if (!(c0.v > 0) || !Number.isFinite(c0.v)) return null
  const eNode: ExprNode = E.s < 0 ? { t: 'neg', a: E.n } : E.n
  const exp = readExponential(srcOf(eNode))
  if (!exp || !isExactly(exp.k, 0)) return null

  // ---- assemble ------------------------------------------------------------
  const Ltext = coefficientText(sign, consts)
  if (Ltext === null || Ltext === '0') return null
  const unit = c0.r !== null && c0.r[0] === 1 && c0.r[1] === 1
  const spec: LogisticSpec = {
    L: unit ? Ltext : divText(Ltext, c0),
    k: '',
    A: unit ? exp.a : divText(exp.a, c0),
    h: exp.h,
    d: constants.length === 0 ? '0' : cText(cSum(constants)),
  }
  if (exp.b === 'e') {
    spec.k = negRate(exp.rate ?? '1')
  } else if (isExactly(exp.p, 1)) {
    // readExponential reads 2^(−x) as (1/2)^x; the logistic keeps the 2
    spec.b = invText(exp.b)
  } else {
    // (1/2)^(x/5.7) in a denominator: stated as its continuous rate
    spec.k = niceNum(-Math.log(valueOf(exp.b)) / valueOf(exp.p))
  }
  return spec
}

/** The rate (per unit of the variable) of an exponential leaf, or null. */
function leafRate(base: number, u: ExprNode): number | null {
  const u0 = evalAst(u, 0)
  const u1 = evalAst(u, 1)
  const u2 = evalAst(u, 2)
  if (![u0, u1, u2].every(Number.isFinite)) return null
  const s = u1 - u0
  if (Math.abs(u2 - u1 - s) > 1e-9 * Math.max(1, Math.abs(s))) return null // not linear
  const r = Math.log(base) * s
  return Number.isFinite(r) && r !== 0 ? r : null
}

/** Solve the 3×3 system M·z = y (Cramer), or null when singular. */
function solve3(M: number[][], y: number[]): number[] | null {
  const det = (m: number[][]): number =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  const D = det(M)
  if (!Number.isFinite(D) || Math.abs(D) < 1e-14) return null
  const out: number[] = []
  for (let c = 0; c < 3; c++) {
    const m = M.map((row, i) => row.map((v, j) => (j === c ? y[i] : v)))
    out.push(det(m) / D)
  }
  return out.every(Number.isFinite) ? out : null
}

function numeric(body: ExprNode): LogisticSpec | null {
  const rates: number[] = []
  const walk = (n: ExprNode): boolean => {
    switch (n.t) {
      case 'num':
      case 'const':
        return true
      case 'neg':
        return walk(n.a)
      case 'bin':
        if (n.op === '^' && !hasVar(n.a) && hasVar(n.b)) {
          const b = n.a.t === 'const' && n.a.name === 'e' ? Math.E : evalAst(n.a, NaN)
          if (!(b > 0) || b === 1) return false
          const r = leafRate(b, n.b)
          if (r === null) return false
          rates.push(r)
          return true
        }
        if (n.op === '^' && !hasVar(n.b)) {
          const e = evalAst(n.b, NaN)
          return Number.isInteger(e) && Math.abs(e) <= 4 && walk(n.a)
        }
        return walk(n.a) && walk(n.b)
      case 'call':
        if (!hasVar(n)) return true
        if (n.fn === 'exp' && n.args.length === 1) {
          const r = leafRate(Math.E, n.args[0])
          if (r === null) return false
          rates.push(r)
          return true
        }
        return false
      default:
        return false // the variable outside an exponent, a slider
    }
  }
  if (!walk(body) || rates.length === 0) return null
  const m = Math.abs(rates[0])
  if (!rates.every((r) => Math.abs(Math.abs(r) - m) <= 1e-9 * m)) return null

  // f = (p + q·u)/(1 + r·u), u = e^(−m·x): p + q·u − r·f·u = f
  const xs = [-1 / m, 0.13 / m, 1.21 / m]
  const M: number[][] = []
  const y: number[] = []
  for (const x of xs) {
    const f = evalAst(body, x)
    const u = Math.exp(-m * x)
    if (!Number.isFinite(f)) return null
    M.push([1, u, -f * u])
    y.push(f)
  }
  const z = solve3(M, y)
  if (!z) return null
  const [p, q, r] = z
  if (!(r > 1e-12)) return null
  const d = q / r
  const L = p - d
  if (!(Math.abs(L) > 1e-9 * Math.max(1, Math.abs(d)))) return null
  return { L: niceNum(L), k: niceNum(m), A: niceNum(r), h: '0', d: niceNum(d) }
}

export function readLogistic(src: string): LogisticSpec | null {
  if (!src || src.includes('{') || /\b(for|if|where|when)\b/.test(src)) return null
  const ast = parseAst(src)
  if (!ast.ok) return null

  // ---- head: y = …, f(x) = … / f(t) = …, or a bare expression ------------
  let name: string | undefined
  let body: ExprNode
  let head: 'x' | 't' | null = null
  if (ast.rhs === null) body = ast.lhs
  else if (ast.lhs.t === 'var' && ast.lhs.name === 'y') body = ast.rhs
  else if (
    ast.lhs.t === 'bin' && ast.lhs.op === '*' &&
    ast.lhs.a.t === 'param' && ast.lhs.b.t === 'var' &&
    (ast.lhs.b.name === 'x' || ast.lhs.b.name === 't')
  ) {
    name = ast.lhs.a.name
    head = ast.lhs.b.name
    body = ast.rhs
  } else return null
  const v = head ?? (usesVar(body, 't') && !usesVar(body, 'x') ? 't' : 'x')
  if (!onlyVar(body, v) || !usesVar(body, v)) return null

  let spec: LogisticSpec | null = null
  try {
    spec = structural(body)
  } catch {
    spec = null
  }
  if (spec && !verify(spec, body)) spec = null
  if (!spec) {
    spec = numeric(body)
    if (spec && !verify(spec, body)) spec = null
  }
  if (!spec) return null
  if (name) spec.name = name
  if (v === 't') spec.v = 't'
  return spec
}

/** The reading IS the typed function: nine fixed points and five across the S. */
function verify(spec: LogisticSpec, body: ExprNode): boolean {
  const vals = logisticValues(spec)
  if (!vals) return false
  const w = 1 / Math.abs(vals.k)
  const xs = [...SAMPLES, ...[-2, -1, 0, 1, 2].map((i) => vals.x0 + i * w)]
  let compared = 0
  for (const x of xs) {
    const want = evalAst(body, x)
    if (!Number.isFinite(want) || Math.abs(want) > 1e12) continue
    const got = logisticAt(spec, x)
    if (!Number.isFinite(got)) return false
    if (Math.abs(want - got) > 1e-7 * Math.max(1, Math.abs(want), Math.abs(vals.L))) return false
    compared++
  }
  return compared >= 5
}

// ----------------------------------------------------------------------------
// logisticFromInitial — "P(0) = 20, L = 1000, k = 0.3"
// ----------------------------------------------------------------------------

export type InitialResult = { spec: LogisticSpec; error: null } | { spec: null; error: string }

/**
 * The logistic with carrying capacity L above y = d, growth constant k, and
 * y(0) = y0: A = L/(y0 − d) − 1, exact when the numbers are rational
 * (1000/20 − 1 = 49). Refused — with the reason a BC student is taught —
 * when y(0) is not strictly between the two equilibria.
 */
export function logisticFromInitial(
  L: string,
  k: string,
  y0: string,
  d = '0',
  v?: 't',
): InitialResult {
  const Lv = valueOf(txt(L, ''))
  const kv = valueOf(txt(k, ''))
  const yv = valueOf(txt(y0, ''))
  const dv = valueOf(txt(d, '0'))
  if (!Number.isFinite(Lv)) return { spec: null, error: 'The carrying capacity L is not a number.' }
  if (!Number.isFinite(kv)) return { spec: null, error: 'The growth constant k is not a number.' }
  if (!Number.isFinite(yv)) return { spec: null, error: 'The initial value y(0) is not a number.' }
  if (!Number.isFinite(dv)) return { spec: null, error: 'The shift d is not a number.' }
  if (Lv === 0) return { spec: null, error: 'L can’t be 0 — there would be nothing to grow toward.' }
  if (kv === 0) return { spec: null, error: 'k = 0 means dy/dt = 0: a constant, not a logistic.' }
  const frac = (yv - dv) / Lv
  const eq = (w: number) => fmt4(w)
  if (Math.abs(yv - dv) < 1e-12) {
    return { spec: null, error: `y(0) = ${eq(dv)} is an equilibrium (y = d): the solution stays there.` }
  }
  if (Math.abs(frac - 1) < 1e-12) {
    return { spec: null, error: `y(0) = ${eq(yv)} is the carrying capacity — an equilibrium: the solution is constant.` }
  }
  if (frac > 1) {
    return {
      spec: null,
      error: `y(0) = ${eq(yv)} is beyond the carrying capacity ${eq(Lv + dv)}: that solution moves back toward it without an S — not a logistic curve.`,
    }
  }
  if (frac < 0) {
    return { spec: null, error: `y(0) must be between ${eq(Math.min(dv, Lv + dv))} and ${eq(Math.max(dv, Lv + dv))} for an S-shaped solution.` }
  }
  // A = L/(y0 − d) − 1, exactly when every number is rational
  const Lr = exactOf(txt(L, ''))
  const yr = exactOf(txt(y0, ''))
  const dr = exactOf(txt(d, '0'))
  let A: string | null = null
  if (Lr && yr && dr) {
    const diff = ratAdd(yr, ratNeg(dr))
    const q = diff && ratDiv(Lr, diff)
    const a = q && ratAdd(q, [-1, 1])
    if (a) A = ratDecText(a)
  }
  const spec: LogisticSpec = {
    L: txt(L, ''),
    k: txt(k, ''),
    A: A ?? niceNum(Lv / (yv - dv) - 1),
    h: '0',
    d: txt(d, '0'),
  }
  if (v === 't') spec.v = 't'
  return logisticValues(spec) ? { spec, error: null } : { spec: null, error: 'That logistic could not be written out.' }
}

// ----------------------------------------------------------------------------
// exact forms: rationals and rational multiples of ln r
//
// exact.ts deliberately never recognises ln 2 from a decimal (0.693… is too
// easy to hit by accident). Here nothing is recognised from a decimal: the
// logarithm is DERIVED from the numbers the teacher typed. x0 = h + ln(A)/k
// with A = 49 and k = 0.3 is (20/3)·ln 7 because 49 = 7², and that is known,
// not guessed. The value is then checked against the computed x0 anyway.
// ----------------------------------------------------------------------------

function gcd(a: number, b: number): number {
  a = Math.abs(a); b = Math.abs(b)
  while (b) { const t = a % b; a = b; b = t }
  return a
}

function rat(n: number, d: number): Rat | null {
  if (!Number.isInteger(n) || !Number.isInteger(d) || d === 0) return null
  if (Math.abs(n) > 1e12 || Math.abs(d) > 1e12) return null
  if (d < 0) { n = -n; d = -d }
  const g = gcd(n, d) || 1
  return [n / g + 0, d / g]
}
const ratAdd = (a: Rat, b: Rat): Rat | null => rat(a[0] * b[1] + b[0] * a[1], a[1] * b[1])
const ratMul = (a: Rat, b: Rat): Rat | null => rat(a[0] * b[0], a[1] * b[1])
const ratDiv = (a: Rat, b: Rat): Rat | null => (b[0] === 0 ? null : rat(a[0] * b[1], a[1] * b[0]))
const ratNeg = (a: Rat): Rat => [-a[0] + 0, a[1]]
const ratVal = (a: Rat): number => a[0] / a[1]

/** The integer m-th root of n ≥ 0, or null. */
function intRoot(n: number, m: number): number | null {
  const r = Math.round(Math.pow(n, 1 / m))
  for (const c of [r - 1, r, r + 1]) if (c >= 0 && Math.pow(c, m) === n) return c
  return null
}

/** ln q = coef·ln(arg) with arg > 1 as small as possible (arg 1: ln q = 0). */
function lnForm(q: Rat): { coef: Rat; arg: Rat } | null {
  if (q[0] <= 0) return null
  if (q[0] === q[1]) return { coef: [0, 1], arg: [1, 1] }
  let a: Rat = q
  let sgn = 1
  if (q[0] < q[1]) { a = [q[1], q[0]]; sgn = -1 }
  for (let m = 40; m >= 2; m--) {
    const n = intRoot(a[0], m)
    const d = intRoot(a[1], m)
    if (n !== null && d !== null) return { coef: [sgn * m, 1], arg: [n, d] }
  }
  // ln(202577/25) is not a form anybody reads: small arguments only
  if (a[0] > 10000 || a[1] > 1000) return null
  return { coef: [sgn, 1], arg: a }
}

const uMinus = (s: string): string => s.replace(/-/g, MINUS)

function ratU(r: Rat): string {
  return uMinus(r[1] === 1 ? String(r[0]) : `${r[0]}/${r[1]}`)
}

function ratTex(r: Rat): string {
  if (r[1] === 1) return String(r[0])
  return `${r[0] < 0 ? '-' : ''}\\frac{${Math.abs(r[0])}}{${r[1]}}`
}

/** c + coef·ln(arg) as {text, tex}; c or the log part may be absent. */
function logText(c: Rat | null, coef: Rat, arg: Rat): { text: string; tex: string } {
  const argT = arg[1] === 1 ? `ln ${arg[0]}` : `ln(${arg[0]}/${arg[1]})`
  const argX = arg[1] === 1 ? `\\ln ${arg[0]}` : `\\ln\\frac{${arg[0]}}{${arg[1]}}`
  const neg = coef[0] < 0
  const mag: Rat = [Math.abs(coef[0]), coef[1]]
  const magT = mag[0] === 1 && mag[1] === 1 ? argT : mag[1] === 1 ? `${mag[0]} ${argT}` : `(${mag[0]}/${mag[1]}) ${argT}`
  const magX = mag[0] === 1 && mag[1] === 1 ? argX : `${ratTex(mag)}${argX}`
  if (!c || c[0] === 0) return { text: `${neg ? MINUS : ''}${magT}`, tex: `${neg ? '-' : ''}${magX}` }
  return {
    text: `${ratU(c)} ${neg ? MINUS : '+'} ${magT}`,
    tex: `${ratTex(c)} ${neg ? '-' : '+'} ${magX}`,
  }
}

/** A number with an optional exact form; the form is dropped if it disagrees. */
function exactNumber(value: number, form: { text: string; tex: string } | null, check: number | null): ExactNumber {
  let exact = form
  if (exact && check !== null && Math.abs(check - value) > 1e-9 * Math.max(1, Math.abs(value))) exact = null
  const dec = fmt4(value)
  let text = dec
  if (exact && exact.text !== dec) text = `${exact.text} ≈ ${dec}`
  return { value, exact: exact?.text ?? null, tex: exact?.tex ?? null, text }
}

function ratNumber(value: number, r: Rat | null): ExactNumber {
  // 35323400/174117 is not a form anybody reads: small denominators only
  if (!r || r[1] > 100) return exactNumber(value, null, null)
  // a terminating decimal is its own exact form
  const dec = ratDecText(r)
  if (!dec.includes('/')) {
    // 1.0125 is exact and short: it is its own text, with no "≈ 1.012"
    const n = exactNumber(value, { text: uMinus(dec), tex: dec }, ratVal(r))
    return n.exact ? { ...n, text: n.exact } : n
  }
  return exactNumber(value, { text: ratU(r), tex: ratTex(r) }, ratVal(r))
}

// ----------------------------------------------------------------------------
// logisticFeatures
// ----------------------------------------------------------------------------

/** A spec's text wrapped for use as a factor or a divisor. */
function factorText(s: string): string {
  return bareAtom(s) && !s.trim().startsWith('-') ? s.trim() : `(${s.trim()})`
}

/** The DE's pieces for the spec. */
function deParts(spec: LogisticSpec): { k: string; kTex: string; L: string; Y: string; YTex: string; bare: boolean } {
  const b = hasBase(spec) ? spec.b!.trim() : null
  const k = b ? `ln(${b})` : txt(spec.k, '1')
  const kTex = b ? `\\ln ${b}` : txt(spec.k, '1')
  const d = txt(spec.d, '0')
  const dr = exactOf(d)
  const zero = dr !== null && dr[0] === 0
  let Y = 'y'
  if (!zero) {
    const tail = constantTail(negText(d)).trim() // "- 5", "+ 3"
    Y = `(y ${tail})`
  }
  return { k, kTex, L: txt(spec.L, '1'), Y, YTex: Y, bare: zero }
}

export function logisticFeatures(spec: LogisticSpec): LogisticFeatures | null {
  const vals = logisticValues(spec)
  if (!vals) return null
  const { L, k, d, x0 } = vals
  const Lr = exactOf(txt(spec.L, '1'))
  const Ar = exactOf(txt(spec.A, '1'))
  const hr = exactOf(txt(spec.h, '0'))
  const dr = exactOf(txt(spec.d, '0'))
  const br = hasBase(spec) ? exactOf(spec.b!) : null
  const kr = hasBase(spec) ? null : exactOf(txt(spec.k, '1'))

  // ---- inflection x = h + ln(A)/k ----------------------------------------
  let xForm: { text: string; tex: string } | null = null
  let xCheck: number | null = null
  if (Ar && hr) {
    const lnA = lnForm(Ar)
    if (lnA && lnA.coef[0] === 0) {
      xForm = { text: ratU(hr), tex: ratTex(hr) }
      xCheck = ratVal(hr)
    } else if (lnA && kr) {
      const coef = ratDiv(lnA.coef, kr)
      // (20/3) ln 7 reads; (1000/1593) ln(2169/1000) — a sketch's digits — does not
      if (coef && Math.abs(coef[0]) <= 1000 && coef[1] <= 100 && lnA.arg[1] <= 100) {
        xForm = logText(hr, coef, lnA.arg)
        xCheck = ratVal(hr) + ratVal(coef) * Math.log(ratVal(lnA.arg))
      }
    } else if (lnA && br) {
      const lnB = lnForm(br)
      if (lnB && lnB.arg[0] === lnA.arg[0] && lnB.arg[1] === lnA.arg[1] && lnB.coef[0] !== 0) {
        const q = ratDiv(lnA.coef, lnB.coef)
        const s = q && ratAdd(hr, q)
        if (s) {
          xForm = { text: ratU(s), tex: ratTex(s) }
          xCheck = ratVal(s)
        }
      } else if (br[1] === 1 && br[0] >= 2 && br[0] <= 10) {
        // x0 = h + log_b(A): "log₂ 3", the AP Precalc way of saying it
        const a = Ar[1] === 1 ? String(Ar[0]) : `(${Ar[0]}/${Ar[1]})`
        const aX = Ar[1] === 1 ? String(Ar[0]) : `\frac{${Ar[0]}}{${Ar[1]}}`
        const lg = `log${String(br[0]).replace(/\d/g, (c) => '₀₁₂₃₄₅₆₇₈₉'[Number(c)])} ${a}`
        const lgX = `\log_{${br[0]}} ${aX}`
        xForm = hr[0] === 0 ? { text: lg, tex: lgX } : { text: `${ratU(hr)} + ${lg}`, tex: `${ratTex(hr)} + ${lgX}` }
        xCheck = ratVal(hr) + Math.log(ratVal(Ar)) / Math.log(br[0])
      }
    }
  }
  const half = Lr && dr ? ratAdd(ratMul(Lr, [1, 2])!, dr) : null
  const inflection = {
    x: exactNumber(x0, xForm, xCheck),
    y: ratNumber(L / 2 + d, half),
  }

  // ---- the steepest slope, L·k/4 -----------------------------------------
  let maxRate: ExactNumber
  if (Lr && kr) {
    maxRate = ratNumber((L * k) / 4, ratMul(Lr, kr) && ratMul(ratMul(Lr, kr)!, [1, 4]))
  } else if (Lr && br) {
    const lnB = lnForm(br)
    const coef = lnB && ratMul(ratMul(Lr, [1, 4])!, lnB.coef)
    maxRate = coef && lnB
      ? exactNumber((L * k) / 4, logText(null, coef, lnB.arg), ratVal(coef) * Math.log(ratVal(lnB.arg)))
      : exactNumber((L * k) / 4, null, null)
  } else {
    maxRate = exactNumber((L * k) / 4, null, null)
  }

  // ---- y(0) ----------------------------------------------------------------
  const y0 = logisticAt(spec, 0)
  let yIntercept: ExactNumber | null = null
  if (Number.isFinite(y0)) {
    let r: Rat | null = null
    if (Lr && Ar && dr && hr && hr[0] === 0) {
      const den = ratAdd([1, 1], Ar)
      const q = den && ratDiv(Lr, den)
      r = q && ratAdd(q, dr)
    }
    yIntercept = ratNumber(y0, r)
  }

  // ---- the differential equation -----------------------------------------
  const t = spec.v === 't' ? 't' : 'x'
  const p = deParts(spec)
  const kIsOne = !hasBase(spec) && isExactly(p.k, 1)
  const kIsMinusOne = !hasBase(spec) && isExactly(p.k, -1)
  const kLead = kIsOne ? '' : kIsMinusOne ? '-' : bareAtom(p.k) ? p.k.trim() : `(${p.k.trim()})`
  const kLeadU = kIsOne ? '' : kIsMinusOne ? MINUS : uMinus(hasBase(spec) ? `(ln ${spec.b!.trim()})` : kLead)
  const Ldiv = factorText(p.L)
  const Lone = isExactly(p.L, 1)
  const Yu = uMinus(p.Y)
  const de = `dy/d${t} = ${kLeadU}${Yu}(1 ${MINUS} ${Lone ? Yu : `${Yu}/${uMinus(Ldiv)}`})`
  const texY = p.bare ? 'y' : `\\left(${p.Y.slice(1, -1)}\\right)`
  const texYin = p.bare ? 'y' : p.Y.slice(1, -1)
  const deTex =
    `\\frac{dy}{d${t}} = ${kIsOne ? '' : kIsMinusOne ? '-' : `${hasBase(spec) ? p.kTex : factorTex(p.k)}\\,`}` +
    `${texY}\\left(1 - ${Lone ? (p.bare ? 'y' : texY) : `\\frac{${texYin}}{${factorTex(p.L)}}`}\\right)`
  const star = kLead === '' || kLead === '-' ? kLead : `${kLead}*`
  const fieldSource = `dy/dx = ${star}${p.Y}*(1 - ${Lone ? p.Y : `${p.Y}/${Ldiv}`})`

  // ---- the AP facts ----------------------------------------------------------
  const upper = L + d
  const apFacts: string[] = []
  const deGeneric = p.bare ? `dy/d${t} = k·y·(1 ${MINUS} y/L)` : `dy/d${t} = k(y ${MINUS} d)(1 ${MINUS} (y ${MINUS} d)/L)`
  if (k > 0 && L > 0) {
    const start = p.bare ? 'y(0) > 0' : `y(0) > ${fmt4(d)}`
    apFacts.push(`${deGeneric}: for every ${start}, y → ${fmt4(upper)} as ${t} → ∞ (the carrying capacity).`)
    apFacts.push(`Growth is fastest when y = ${p.bare ? 'L/2' : 'L/2 + d'} = ${inflection.y.text}, at ${t} = ${inflection.x.text}.`)
  } else {
    const far = k > 0 ? '∞' : `${MINUS}∞`
    apFacts.push(`${deGeneric}: y → ${fmt4(upper)} as ${t} → ${far}.`)
    apFacts.push(`The slope is steepest at y = ${inflection.y.text}, at ${t} = ${inflection.x.text}.`)
  }

  return {
    values: vals,
    lower: Math.min(d, upper),
    upper: Math.max(d, upper),
    inflection,
    maxRate,
    yIntercept,
    increasing: L * k > 0,
    de,
    deTex,
    fieldSource,
    apFacts,
  }
}

/** A constant's text as a KaTeX factor. */
function factorTex(s: string): string {
  const r = exactOf(s)
  if (r && r[1] !== 1 && !/\./.test(s)) return ratTex(r)
  return bareAtom(s) ? s.trim() : `\\left(${s.trim()}\\right)`
}

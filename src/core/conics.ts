// ============================================================================
// Conic sections, the way Math 3 / Precalculus states them (src/core/conics.ts)
//
//   circle      (x − h)² + (y − k)² = r²
//   ellipse     (x − h)²/a² + (y − k)²/b² = 1          (either axis major)
//   hyperbola   (x − h)²/a² − (y − k)²/b² = 1           (opens left/right)
//               (y − k)²/a² − (x − h)²/b² = 1           (opens up/down)
//   parabola    (x − h)² = 4p(y − k)   (opens up/down)
//               (y − k)² = 4p(x − h)   (opens left/right)
//
// Like every sibling module (factored, exponential, logarithmic, sinusoidal,
// transform, piecewise), a spec becomes a TYPED EXPRESSION — here an
// IMPLICIT equation the parser already plots — so the curve is an ordinary
// typed curve; this module is the bridge to the quantities a teacher states,
// and the source of the figure's construction lines (foci, directrix,
// asymptotes, the hyperbola's box).
//
//   export function conicSource(spec): string
//       standard form, parseable: "(x - 2)^2/9 + (y + 1)^2/4 = 1",
//       "(x - 1)^2 + y^2 = 16", "(y - 3)^2/16 - x^2/9 = 1",
//       "(x + 2)^2 = 8(y - 1)", "y^2 = -12x".
//   export function readConic(src): ConicSpec | null
//       any typed conic in STANDARD form, and in GENERAL form
//       Ax² + Cy² + Dx + Ey + F = 0 (completing the square — the classic
//       exercise), axis-aligned; B·xy ≠ 0 → null here (see classify).
//       Degenerate cases (a point, two lines, no graph) → null with a
//       reason from classify. Verified numerically.
//   export function classify(src): ConicClass
//       the discriminant test for ANY general quadratic in x and y, incl.
//       a rotated one (B ≠ 0): circle / ellipse / parabola / hyperbola /
//       degenerate, with the rotation angle θ = ½·atan(B/(A − C)) and a
//       sentence ("B² − 4AC = −16 < 0: an ellipse, rotated 26.57°").
//   export function conicFeatures(spec): ConicFeatures
//       center, vertices, co-vertices, foci, directrix, asymptotes, the
//       hyperbola's fundamental rectangle, eccentricity, the lengths of the
//       axes and the latus rectum — numbers and exact text (√5, 2 + √13).
//   export function readRotatedConic(src): RotatedConic | null
//       a ROTATED conic (B·xy ≠ 0): the angle θ (cot 2θ = (A − C)/B, 0 < θ
//       < 90°), the conic in its own axes x′, y′ as an ordinary ConicSpec
//       (so conicSource / conicFeatures read it there), and its features
//       mapped back to x, y — vertices, foci, asymptotes, the directrix as
//       a general line "x − y = −2". Degenerate or B = 0 → null. See below.
//   builders — each returns a spec or a refusal reason:
//     conicFromCircle(center, radius | pointOnCircle)
//     conicFromEllipse({center, vertex, focus? | coVertex? | e?})
//     conicFromHyperbola({center, vertex, focus? | asymptoteSlope? | e?})
//     conicFromParabola({vertex, focus} | {focus, directrix} | {vertex, point, opens})
//     conicFromFoci(f1, f2, {sum} | {difference})   the locus definitions
// ============================================================================

import { exactForm } from './exact'
import { evalAst, parseAst, parseExpression, type ExprNode } from './parse'
import type { Vec2 } from './types'

export type ConicKind = 'circle' | 'ellipse' | 'hyperbola' | 'parabola'

export interface ConicSpec {
  kind: ConicKind
  /** Center (vertex, for a parabola), as written. */
  h: string
  k: string
  /** circle: r; ellipse: semi-axis along x; hyperbola: the transverse semi-axis. */
  a: string
  /** ellipse: semi-axis along y; hyperbola: the conjugate semi-axis. Unused otherwise. */
  b?: string
  /** hyperbola/parabola: which way it opens. Ellipse: absent (a, b say). */
  opens?: 'x' | 'y'
  /** parabola: the focal parameter p (signed: negative opens down/left). */
  p?: string
}

export interface ConicClass {
  kind: ConicKind | 'degenerate' | 'none'
  rotated: boolean
  /** Rotation angle of the axes in radians (0 when B = 0). */
  theta: number
  discriminant: number
  sentence: string
}

export interface Labeled {
  x: number
  y: number
  xText: string
  yText: string
}

export interface ConicFeatures {
  center: Labeled | null
  vertices: Labeled[]
  coVertices: Labeled[]
  foci: Labeled[]
  /** Parabola: the directrix as "y = −2" / "x = 3" with its value. */
  directrix: { axis: 'x' | 'y'; value: number; text: string } | null
  /**
   * Hyperbola: the two asymptotes as lines through the center. A rotated
   * conic's asymptote can be vertical: its slope is then ±Infinity and its
   * text "x = h".
   */
  asymptotes: { slope: number; text: string }[]
  /** Hyperbola: corners of the fundamental rectangle. */
  box: Vec2[] | null
  eccentricity: number
  /** "major axis 6, minor axis 4, focal distance √5", "latus rectum 8". */
  sentences: string[]
  /**
   * A rotated parabola's directrix (its `directrix` is then null: the line
   * is neither horizontal nor vertical). Absent for an axis-aligned conic.
   */
  directrixLine?: ConicLine | null
}

/** The line a·x + b·y = c, its text ("x − y = −2") and two points on it, one unit apart. */
export interface ConicLine {
  a: number
  b: number
  c: number
  text: string
  pts: [Vec2, Vec2]
}

/**
 * A conic with an xy term, read in its own axes. x′ = x cos θ + y sin θ,
 * y′ = −x sin θ + y cos θ; `spec` is the standard form in x′, y′ (its h, k
 * are the center's x′, y′ coordinates), `features` are in the ORIGINAL x, y.
 */
export interface RotatedConic {
  kind: 'ellipse' | 'hyperbola' | 'parabola'
  /** Radians, 0 < θ < π/2 (cot 2θ = (A − C)/B, the textbook choice). */
  theta: number
  /** "π/4" when θ is a multiple of π/12 or of π/8, else "26.57°". */
  thetaText: string
  /** Always degrees: "45°", "26.57°". */
  degreesText: string
  /** cos θ and sin θ as text: "√2/2", "2√5/5", else 6 digits. */
  cosText: string
  sinText: string
  /** Ellipse / hyperbola: the center (x, y). Parabola: null. */
  center: Labeled | null
  /** The conic in its own axes: conicSource(spec) is its equation in x′, y′. */
  spec: ConicSpec
  /** That equation as display text: "x′²/2 + y′²/6 = 1". */
  primeText: string
  features: ConicFeatures
  /** classify's sentence, stated with this θ: "B² − 4AC = −64 < 0: an ellipse, rotated 45°". */
  classSentence: string
}

export type Built = ConicSpec | { error: string }

// ============================================================================
// Implementation
//
// CONVENTIONS
//   * a is ALWAYS the semi-axis along x and b the one along y for an ellipse
//     (as the spec says), so a vertical ellipse has a < b: (x − 2)²/4 +
//     (y + 1)²/9 = 1 is { a: '2', b: '3' }. The features and sentences speak
//     of the MAJOR axis, whichever letter carries it.
//   * hyperbola: a is the transverse semi-axis (the one under the positive
//     square), b the conjugate; `opens` says which: 'x' left/right, 'y'
//     up/down. Slopes of the asymptotes are ±b/a ('x') and ±a/b ('y').
//   * parabola: `opens` 'y' is (x − h)² = 4p(y − k) (p < 0 opens down), 'x'
//     is (y − k)² = 4p(x − h) (p < 0 opens left). `a` mirrors p's text (the
//     contract gives a parabola no use for a); conicSource never reads it.
//   * circle: a is r; b and opens are absent.
//   * Every text field is SOURCE text the parser reads ("2", "-3/2", "2.5",
//     "sqrt(5)", "2sqrt(3)"), never Unicode; the features carry the Unicode
//     display text ("−3/2", "√5", "2 ± √5").
//
// SOURCE (conicSource): a² / b² / r² / 4p are written as their VALUE in the
// style of the text they came from: "3" → 9, "3/2" → 9/4 (parenthesised as
// a denominator), "2.5" → 6.25, "sqrt(5)" → 5, "2sqrt(3)" → 12; a denominator
// of 1 is dropped. Shifts keep the teacher's text with the sign folded:
// h = "2" → (x - 2), h = "-3/2" → (x + 3/2), h = "0" → x^2, a sum →
// (x - (1+sqrt(2))). 4p: 8 → 8(y - 1) / 8y, −1 → -(y - 1) / -y, a fraction
// or surd in parentheses ((1/2)(y - 1), (4sqrt(2))y). ONE wrinkle: 4p = 1
// with k = 0 would print `x^2 = y`, which the parser reads as the FUNCTION
// y = x²; it is written `x^2 = 1y` so that it stays an implicit curve.
//
// COEFFICIENTS (readConic, classify): the typed line goes through the
// parser (parseExpression — the very F(x, y) the plotter contours), and F is
// sampled on the 3 × 3 integer grid {−1, 0, 1}²:
//     A = (F(1,0) + F(−1,0) − 2F(0,0))/2      D = (F(1,0) − F(−1,0))/2
//     C = (F(0,1) + F(0,−1) − 2F(0,0))/2      E = (F(0,1) − F(0,−1))/2
//     B = (F(1,1) − F(1,−1) − F(−1,1) + F(−1,−1))/4                F = F(0,0)
// which is exact for a quadratic (integer points; no solve to condition).
// The candidate Ax² + Bxy + Cy² + Dx + Ey + F is then checked against F at
// twelve off-grid points out to |x|, |y| ≈ 40 (relative 1e-9 of the sum of
// the term magnitudes) — anything that is not a quadratic (x³, |x|, sin,
// 1/x, a slider) fails there. Each coefficient is snapped to a fraction
// with denominator ≤ 1000 when one is within 1e-11 of the largest
// coefficient, so typed rationals come back exactly (and B is exactly 0).
//
// READING (readConic): implicit lines only (y = f(x) is a function, not a
// conic card), axis-aligned (B = 0), completing the square numerically:
//     A(x − h)² + C(y − k)² = R  with h = −D/2A, k = −E/2C
//         R = 0 → degenerate; A, C same sign: R/A > 0 → ellipse (circle
//         when a² = b²), else no graph; opposite signs → hyperbola, opening
//         along the axis whose R/coefficient is positive.
//     A(x − h)² + Ey + F′ = 0 → (x − h)² = −(E/A)(y − k): parabola, 4p = −E/A
//         (and the mirror image for C with A = 0); E = 0 → degenerate.
// Text: h and k keep the teacher's text when a constant sits beside a bare
// x (or y) in a sum — (x - 2.5), (x + 1/2), (y - sqrt(2)) — else they are
// written exactly (fraction, surd, 12 digits as a last resort). a, b, r use
// the base of a typed constant square (5^2) when there is one, else √ of
// the computed square: a perfect square of a fraction → the fraction
// (decimal when the typed square was a decimal: 6.25 → 2.5), else a surd
// (sqrt(5), 2sqrt(3), 3sqrt(5)/2), else sqrt(73/10) / sqrt(7.3). p is
// decimal when the typed 4p was (1.2 → 0.3), else a fraction. The result is
// then VERIFIED: the spec's own coefficients must be proportional to the
// extracted ones (1e-9), or the answer is null.
//
// CLASSIFYING: discriminant Δ = B² − 4AC (of the coefficients of
// lhs − rhs as typed); for Δ ≠ 0 the center (x₀, y₀) solves ∇Q = 0 and
// F′ = Q(x₀, y₀) = det(M) / (AC − B²/4) — F′ = 0 (relative to the terms it
// cancels) is degenerate: a point (Δ < 0) or two lines through the center
// (Δ > 0); Δ < 0 with F′ of the same sign as A + C has no points. For
// Δ = 0 the quadratic part is s(αx + βy)²; the conic is degenerate exactly
// when the linear part has no component across that direction, and then it
// is s·u² + λu + F = 0 in u = αx + βy: two parallel lines, one line, or no
// points. θ = ½·atan(B/(A − C)) (±45° when A = C), in (−45°, 45°].
// ============================================================================

// ----------------------------------------------------------------------------
// Rationals and number text
// ----------------------------------------------------------------------------

type Rat = readonly [number, number]
type Q6 = [number, number, number, number, number, number]

const MINUS = '−'
const RAT_LIMIT = 1e12

function gcd(a: number, b: number): number {
  a = Math.abs(a); b = Math.abs(b)
  while (b) { const t = a % b; a = b; b = t }
  return a
}

function rat(n: number, d: number): Rat | null {
  if (!Number.isInteger(n) || !Number.isInteger(d) || d === 0) return null
  if (Math.abs(n) > RAT_LIMIT || Math.abs(d) > RAT_LIMIT) return null
  if (d < 0) { n = -n; d = -d }
  const g = gcd(n, d) || 1
  return [n / g + 0, d / g]
}

const rMul = (a: Rat, b: Rat) => rat(a[0] * b[0], a[1] * b[1])
const rAdd = (a: Rat, b: Rat) => rat(a[0] * b[1] + b[0] * a[1], a[1] * b[1])
const rDiv = (a: Rat, b: Rat) => (b[0] === 0 ? null : rat(a[0] * b[1], a[1] * b[0]))
const rNeg = (a: Rat): Rat => [-a[0] + 0, a[1]]

function rPow(a: Rat, e: number): Rat | null {
  let out: Rat | null = [1, 1]
  const base = e < 0 ? rDiv([1, 1], a) : a
  if (!base) return null
  for (let i = 0; i < Math.abs(e) && out; i++) out = rMul(out, base)
  return out
}

/** Nearest fraction with denominator ≤ maxDen within `tol`·max(1, |v|). */
function snapRat(v: number, maxDen = 1000, tol = 1e-11): Rat | null {
  if (!Number.isFinite(v)) return null
  const eps = tol * Math.max(1, Math.abs(v))
  for (let d = 1; d <= maxDen; d++) {
    const n = Math.round(v * d)
    if (Math.abs(n / d - v) <= eps) return rat(n, d)
  }
  return null
}

/** A terminating decimal (≤ 6 places) when the denominator is 2^i·5^j. */
function terminating(r: Rat, places = 6): string | null {
  let d = r[1]
  let twos = 0
  let fives = 0
  while (d % 2 === 0) { d /= 2; twos++ }
  while (d % 5 === 0) { d /= 5; fives++ }
  if (d !== 1 || Math.max(twos, fives) > places) return null
  return String(r[0] / r[1])
}

/** "3", "-3/2", or "-1.5" when `dec` asks for a decimal and it terminates. */
function ratSrc(r: Rat, dec = false): string {
  if (r[1] === 1) return String(r[0])
  return (dec ? terminating(r) : null) ?? `${r[0]}/${r[1]}`
}

const isqrt = (n: number): number | null => {
  if (n < 0) return null
  const s = Math.round(Math.sqrt(n))
  return s * s === n ? s : null
}

/** 12 significant digits, no trailing zeros. */
const dec12 = (v: number): string => String(Number(v.toPrecision(12)))

const near = (u: number, w: number, tol = 1e-11): boolean =>
  Math.abs(u - w) <= tol * Math.max(1, Math.abs(u), Math.abs(w))

// ----------------------------------------------------------------------------
// AST helpers (the parser's own nodes; srcOf etc. as in sinusoidal.ts)
// ----------------------------------------------------------------------------

function hasVar(n: ExprNode): boolean {
  switch (n.t) {
    case 'var': return true
    case 'param': return true
    case 'neg': return hasVar(n.a)
    case 'bin': return hasVar(n.a) || hasVar(n.b)
    case 'call': return n.args.some(hasVar)
    default: return false
  }
}

function prec(n: ExprNode): number {
  switch (n.t) {
    case 'neg': return 1
    case 'bin': return n.op === '+' || n.op === '-' ? 1 : n.op === '^' ? 3 : 2
    default: return 4
  }
}

function joinSep(l: string, r: string): string {
  if (/^[0-9.]/.test(r)) return '*'
  if (/[0-9]$/.test(l) && /^e(?!\^)/.test(r)) return '*'
  if (/[A-Za-z]$/.test(l) && /^[A-Za-z]/.test(r)) return ' '
  return ''
}

/** Print a node back to source the parser reads the same way. */
function srcOf(n: ExprNode): string {
  switch (n.t) {
    case 'num': return n.raw
    case 'const': return n.name
    case 'var': return n.name
    case 'param': return n.name
    case 'call': {
      if (n.fn === 'log_') return `log_(${srcOf(n.args[0])})(${srcOf(n.args[1])})`
      return `${n.fn}(${n.args.map(srcOf).join(', ')})`
    }
    case 'neg': {
      const s = srcOf(n.a)
      return prec(n.a) < 2 || s.startsWith('-') ? `-(${s})` : `-${s}`
    }
    case 'bin': {
      const ls = srcOf(n.a)
      const rs = srcOf(n.b)
      const rWrap = (min: number) => (prec(n.b) < min || rs.startsWith('-') ? `(${rs})` : rs)
      switch (n.op) {
        case '+': return `${ls}+${rWrap(1)}`
        case '-': return `${ls}-${rWrap(2)}`
        case '*': {
          const l = prec(n.a) < 2 && n.a.t !== 'neg' ? `(${ls})` : ls
          const r = rWrap(2)
          return `${l}${joinSep(l, r)}${r}`
        }
        case '/': {
          const l = prec(n.a) < 2 && n.a.t !== 'neg' ? `(${ls})` : ls
          return `${l}/${rWrap(3)}`
        }
        case '^': {
          const b = prec(n.a) < 4 ? `(${ls})` : ls
          const e = prec(n.b) < 4 ? `(${rs})` : rs
          return `${b}^${e}`
        }
      }
    }
  }
  return ''
}

/** −n, removing a minus where there is one: −(−u) = u, −((−3)/2) = 3/2. */
function negNode(n: ExprNode): ExprNode {
  if (n.t === 'neg') return n.a
  if (n.t === 'bin' && (n.op === '*' || n.op === '/')) {
    const left = leftNeg(n)
    if (left) return left
  }
  return { t: 'neg', a: n }
}

function leftNeg(n: ExprNode): ExprNode | null {
  if (n.t === 'neg') return n.a
  if (n.t === 'bin' && (n.op === '*' || n.op === '/')) {
    const a = leftNeg(n.a)
    return a ? { ...n, a } : null
  }
  return null
}

/** Exact value of a node built from integers, decimals and + − × ÷ ^int. */
function ratOf(n: ExprNode): Rat | null {
  switch (n.t) {
    case 'num': {
      if (/^\d+$/.test(n.raw)) return rat(Number(n.raw), 1)
      const m = /^(\d*)\.(\d+)$/.exec(n.raw)
      if (m && m[2].length <= 9) return rat(Number(m[1] + m[2]), Math.pow(10, m[2].length))
      return Number.isInteger(n.v) ? rat(n.v, 1) : null
    }
    case 'neg': {
      const a = ratOf(n.a)
      return a && rNeg(a)
    }
    case 'bin': {
      const a = ratOf(n.a)
      if (!a) return null
      if (n.op === '^') {
        const e = ratOf(n.b)
        return e && e[1] === 1 && Math.abs(e[0]) <= 16 ? rPow(a, e[0]) : null
      }
      const b = ratOf(n.b)
      if (!b) return null
      switch (n.op) {
        case '+': return rAdd(a, b)
        case '-': return rAdd(a, rNeg(b))
        case '*': return rMul(a, b)
        case '/': return rDiv(a, b)
      }
      return null
    }
    default:
      return null
  }
}

/** Typed-text normalisation: x², Unicode minus, and xy / yx as products. */
function prep(src: string): string {
  return src
    .replace(/²/g, '^2')
    .replace(/[−–]/g, '-')
    // a whole run of letters that is only x's and y's: no lookbehind (older Safari)
    .replace(/[A-Za-z]+/g, (w) => (/^[xy]{2,}$/.test(w) ? w.split('').join('*') : w))
}

function nodeOf(s: string): ExprNode | null {
  const ast = parseAst(prep(s.trim()))
  return ast.ok && ast.rhs === null && !hasVar(ast.lhs) ? ast.lhs : null
}

const valueCache = new Map<string, number>()

/** Numeric value of a constant text ("sqrt(5)", "-3/2", "2.5"); NaN if not one. */
function valueOf(s: string | undefined): number {
  const key = (s ?? '').trim()
  const hit = valueCache.get(key)
  if (hit !== undefined) return hit
  const n = key === '' ? null : nodeOf(key)
  let v = n ? evalAst(n, NaN) : NaN
  if (!Number.isFinite(v)) v = NaN
  if (valueCache.size > 500) valueCache.clear()
  valueCache.set(key, v)
  return v
}

const txt = (s: string | undefined, dflt = '0'): string => {
  const t = (s ?? '').trim()
  return t === '' ? dflt : t.replace(/[−–]/g, '-')
}

/** An exactForm text ("−2√3/9", "(1+√5)/2") as parseable source. */
function exactSource(text: string): string {
  return text
    .replace(/−/g, '-')
    .replace(/(\d*)√(\d+)/g, (_m, k: string, n: string) => `${k}sqrt(${n})`)
    .replace(/(\d)π/g, '$1pi')
    .replace(/π/g, 'pi')
}

/** A computed number as source: a fraction (decimal if asked), a surd, else 12 digits. */
function numSrc(v: number, dec = false): string {
  if (!Number.isFinite(v)) return 'NaN'
  if (Math.abs(v) < 1e-300) return '0'
  const r = snapRat(v)
  if (r) return ratSrc(r, dec)
  const e = exactForm(v)
  if (e) {
    const src = exactSource(e.text)
    if (near(valueOf(src), v)) return src
  }
  return dec12(v)
}

/** √sq as source: a fraction when sq is a square of one, else a surd, else sqrt(…). */
function sqrtSrc(sq: number, dec = false): string {
  if (!(sq >= 0)) return 'NaN'
  if (sq === 0) return '0'
  const r = snapRat(sq)
  if (r) {
    const n = isqrt(r[0])
    const d = isqrt(r[1])
    if (n !== null && d !== null) return ratSrc(rat(n, d)!, dec)
  }
  const e = exactForm(Math.sqrt(sq))
  if (e) {
    const src = exactSource(e.text)
    if (near(valueOf(src), Math.sqrt(sq))) return src
  }
  if (r) return `sqrt(${ratSrc(r, dec)})`
  return dec12(Math.sqrt(sq))
}

/** The Unicode text of a number: 3, −3/2 (−1.5 when `dec`), √5, 2+√13, else 6 digits. */
function uni(v: number, dec = false): string {
  if (!Number.isFinite(v)) return String(v)
  if (Math.abs(v) < 1e-12) return '0'
  const r = snapRat(v)
  if (r) return ratSrc(r, dec).replace('-', MINUS)
  const e = exactForm(v)
  if (e) return e.text
  return String(Number(v.toPrecision(6))).replace('-', MINUS)
}

/** Is v exactly written by uni (a fraction or a closed form), not a decimal guess? */
const isExactNum = (v: number): boolean => Math.abs(v) < 1e-12 || snapRat(v) !== null || exactForm(v) !== null
const isRatNum = (v: number): boolean => Math.abs(v) < 1e-12 || snapRat(v) !== null

/** √sq in Unicode: 3, 3/2, √5, 2√3, √(73/10). */
function sqrtUni(sq: number, dec = false): string {
  if (!(sq >= 0)) return 'NaN'
  const r = snapRat(sq)
  if (r) {
    const n = isqrt(r[0])
    const d = isqrt(r[1])
    if (n !== null && d !== null) return uni(n / d, dec)
  }
  const e = exactForm(Math.sqrt(sq))
  if (e) return e.text
  if (r) return `√(${ratSrc(r, dec)})`
  return uni(Math.sqrt(sq), dec)
}

/** base + off as display text: "5", "2 + √5", "2 − √5", "−√5". */
function sumUni(base: number, off: number, dec = false): string {
  if (Math.abs(off) < 1e-12) return uni(base, dec)
  if (Math.abs(base) < 1e-12) return uni(off, dec)
  if (isRatNum(base) && isRatNum(off)) return uni(base + off, dec)
  if (isExactNum(base) && isExactNum(off)) {
    return `${uni(base, dec)} ${off > 0 ? '+' : MINUS} ${uni(Math.abs(off), dec)}`
  }
  return uni(base + off, dec)
}

/** "(2, −1)" */
const pt = (l: Labeled): string => `(${l.xText}, ${l.yText})`

function lab(x: number, y: number, xText: string, yText: string): Labeled {
  return { x: x + 0, y: y + 0, xText, yText }
}

/** Degrees, 2 decimals: "45°", "−26.57°". */
function degText(theta: number): string {
  const d = Math.round((theta * 180) / Math.PI * 100) / 100
  return `${String(d + 0).replace('-', MINUS)}°`
}

// ----------------------------------------------------------------------------
// The typed line as F(x, y), and its quadratic coefficients
// ----------------------------------------------------------------------------

type Fxy = (x: number, y: number) => number

type Got = { ok: true; f: Fxy; implicit: boolean } | { ok: false; why: string }

function functionOf(src: string): Got {
  if (typeof src !== 'string' || src.trim() === '') return { ok: false, why: 'nothing typed' }
  const o = parseExpression(prep(src))
  if (!o.ok) return { ok: false, why: o.error }
  const plot = o.plot
  if (plot.paramNames.length) {
    return { ok: false, why: `${plot.paramNames.join(', ')} would be a slider — a conic needs numbers` }
  }
  const m = plot.makeModel('conic')
  const params = plot.defaultParams
  if (plot.kind === 'implicit' && m.evalImplicit) {
    const ev = m.evalImplicit
    return { ok: true, implicit: true, f: (x, y) => ev(params, x, y) }
  }
  if (plot.kind === 'explicit' && m.evalExplicit) {
    const ev = m.evalExplicit
    return { ok: true, implicit: false, f: (x, y) => y - ev(params, x) }
  }
  return { ok: false, why: 'not an equation in x and y' }
}

/** Off-grid check points, out to |x|, |y| ≈ 40. */
const PROBES: readonly (readonly [number, number])[] = [
  [0.37, -1.21], [2.9, 3.3], [-4.1, 1.7], [7.3, -5.9], [-11.2, -8.6], [13.1, 17.9],
  [-2.5, 6.5], [25.3, -19.7], [-40.1, 33.3], [0.5, 0.5], [3.7, -0.2], [-0.9, -3.4],
]

/** Ax² + Bxy + Cy² + Dx + Ey + F, or null when f is not a quadratic. */
function quadOf(f: Fxy): Q6 | null {
  const g = (x: number, y: number): number => {
    try { return f(x, y) } catch { return NaN }
  }
  const f00 = g(0, 0)
  const f10 = g(1, 0), fm10 = g(-1, 0), f01 = g(0, 1), f0m1 = g(0, -1)
  const f11 = g(1, 1), f1m1 = g(1, -1), fm11 = g(-1, 1), fm1m1 = g(-1, -1)
  const all = [f00, f10, fm10, f01, f0m1, f11, f1m1, fm11, fm1m1]
  if (!all.every(Number.isFinite)) return null
  let q: Q6 = [
    (f10 + fm10 - 2 * f00) / 2,
    (f11 - f1m1 - fm11 + fm1m1) / 4,
    (f01 + f0m1 - 2 * f00) / 2,
    (f10 - fm10) / 2,
    (f01 - f0m1) / 2,
    f00,
  ]
  const verify = (c: Q6): boolean => {
    for (const [x, y] of PROBES) {
      const v = g(x, y)
      if (!Number.isFinite(v)) return false
      const terms = [c[0] * x * x, c[1] * x * y, c[2] * y * y, c[3] * x, c[4] * y, c[5]]
      const w = terms.reduce((s, t) => s + t, 0)
      const scale = terms.reduce((s, t) => s + Math.abs(t), 0) + Math.abs(v)
      if (Math.abs(v - w) > 1e-9 * scale) return false
    }
    return true
  }
  if (!verify(q)) return null
  const S = Math.max(...q.map(Math.abs))
  if (S === 0) return q
  const snapped = q.map((c) => {
    if (Math.abs(c) <= 1e-12 * S) return 0
    for (let d = 1; d <= 1000; d++) {
      const n = Math.round(c * d)
      if (Math.abs(n / d - c) <= 1e-11 * S) return n / d
    }
    return c
  }) as Q6
  if (verify(snapped)) q = snapped
  return q
}

/** v as the fraction it is (to 1e-11), else v. */
function snapped(v: number): number {
  const r = snapRat(v)
  return r ? r[0] / r[1] : v
}

/** f(x, y) when it is finite, else the coefficient formula's value. */
function valueAt(f: Fxy, x: number, y: number, fallback: number): number {
  let v = NaN
  try { v = f(x, y) } catch { v = NaN }
  return Number.isFinite(v) ? v : fallback
}

// ----------------------------------------------------------------------------
// classify
// ----------------------------------------------------------------------------

function noneClass(why: string): ConicClass {
  return { kind: 'none', rotated: false, theta: 0, discriminant: 0, sentence: `not a conic: ${why}` }
}

/** "y = 2x + 1", "y = −x", "y = (2/3)x − 1", "x = 3" */
function lineText(m: number | null, c: number): string {
  if (m === null) return `x = ${uni(c)}`
  let mx: string
  if (Math.abs(m) < 1e-12) mx = ''
  else if (near(m, 1)) mx = 'x'
  else if (near(m, -1)) mx = `${MINUS}x`
  else mx = `${coefText(m)}x`
  if (mx === '') return `y = ${uni(c)}`
  if (Math.abs(c) < 1e-12) return `y = ${mx}`
  return `y = ${mx} ${c > 0 ? '+' : MINUS} ${uni(Math.abs(c))}`
}

/** A coefficient in front of x or (x − h): 2, −2, (2/3), −(2/3), √2 (with a space before a bare x). */
function coefText(m: number): string {
  const t = uni(Math.abs(m))
  const sign = m < 0 ? MINUS : ''
  if (t.includes('/') || t.includes('+') || t.includes(MINUS)) return `${sign}(${t})`
  if (t.includes('√')) return `${sign}${t} `
  return `${sign}${t}`
}

/** The two lines through (x0, y0) with slopes m1, m2 (null = vertical). */
function twoLines(x0: number, y0: number, m1: number | null, m2: number | null): string {
  const line = (m: number | null) => (m === null ? lineText(null, x0) : lineText(m, y0 - m * x0))
  if (m1 !== null && m2 !== null && near(m1, -m2, 1e-9) && Math.abs(m1) > 1e-12) {
    const m = Math.abs(m1)
    const c = y0 - m1 * x0
    const c2 = y0 - m2 * x0
    if (near(c, c2, 1e-9)) {
      const mx = near(m, 1) ? 'x' : `${coefText(m)}x`
      const tail = Math.abs(c) < 1e-12 ? '' : ` ${c > 0 ? '+' : MINUS} ${uni(Math.abs(c))}`
      return `the two lines y = ±${mx}${tail}`
    }
  }
  return `the two lines ${line(m1)} and ${line(m2)}`
}

function classifyQuad(q: Q6, f: Fxy): ConicClass {
  const [A, B, C, D, E, F] = q
  const S2 = Math.max(Math.abs(A), Math.abs(B), Math.abs(C))
  if (S2 === 0) return noneClass('there is no x², xy or y² term, so it is not a quadratic')
  const disc0 = B * B - 4 * A * C
  const dz = Math.abs(disc0) <= 1e-10 * S2 * S2
  const disc = dz ? 0 : disc0
  const bz = Math.abs(B) <= 1e-12 * S2
  const rotated = !bz
  const theta = !rotated
    ? 0
    : Math.abs(A - C) <= 1e-12 * S2
      ? Math.sign(B) * Math.PI / 4
      : 0.5 * Math.atan(B / (A - C))
  const base = { rotated, theta: theta + 0, discriminant: disc + 0 }
  const rot = rotated ? `, rotated ${degText(theta)}` : ''
  const dSentence = dz ? 'B² − 4AC = 0' : `B² − 4AC = ${uni(disc)} ${disc < 0 ? '<' : '>'} 0`
  const degenerate = (what: string): ConicClass => ({ kind: 'degenerate', ...base, sentence: `a degenerate conic: ${what}` })

  if (!dz) {
    const det2 = 4 * A * C - B * B
    const x0 = snapped((B * E - 2 * C * D) / det2)
    const y0 = snapped((B * D - 2 * A * E) / det2)
    // Q at the center, from the typed expression (see aligned)
    const Fp = valueAt(f, x0, y0, F + (D * x0 + E * y0) / 2)
    const scaleF = Math.abs(F) + Math.abs(D * x0) / 2 + Math.abs(E * y0) / 2
    const flat = Math.abs(Fp) <= 1e-12 * scaleF
    if (disc < 0) {
      if (flat) return degenerate(`the single point (${uni(x0)}, ${uni(y0)})`)
      if (Fp * (A + C) > 0) return degenerate('no points — the equation has no real solutions')
      if (bz && Math.abs(A - C) <= 1e-12 * S2) {
        return { kind: 'circle', ...base, sentence: `${dSentence} and A = C: a circle` }
      }
      return { kind: 'ellipse', ...base, sentence: `${dSentence}: an ellipse${rot}` }
    }
    if (flat) {
      // C m² + B m + A = 0 are the slopes of the two lines
      let m1: number | null
      let m2: number | null
      if (Math.abs(C) > 1e-12 * S2) {
        const r = Math.sqrt(disc)
        m1 = (-B + r) / (2 * C)
        m2 = (-B - r) / (2 * C)
        if (m1 < m2) [m1, m2] = [m2, m1]
      } else {
        m1 = -A / B
        m2 = null
      }
      return degenerate(twoLines(x0, y0, m1, m2))
    }
    return { kind: 'hyperbola', ...base, sentence: `${dSentence}: a hyperbola${rot}` }
  }

  // Δ = 0: the quadratic part is s(αx + βy)²
  const s = A + C
  const alpha = Math.sqrt(Math.max(0, A / s))
  const beta = (B / s < 0 ? -1 : 1) * Math.sqrt(Math.max(0, C / s))
  const across = -beta * D + alpha * E
  const lin = Math.abs(D) + Math.abs(E)
  if (lin > 0 && Math.abs(across) > 1e-10 * lin) {
    return { kind: 'parabola', ...base, sentence: `${dSentence}: a parabola${rot}` }
  }
  // s·u² + λu + F = 0 in u = αx + βy
  const lam = D * alpha + E * beta
  const dd = lam * lam - 4 * s * F
  const lineU = (t: number): string =>
    Math.abs(beta) <= 1e-12 ? lineText(null, t / alpha) : lineText(-alpha / beta, t / beta)
  if (Math.abs(dd) <= 1e-10 * (lam * lam + Math.abs(4 * s * F))) {
    return degenerate(`the single line ${lineU(-lam / (2 * s))}, counted twice`)
  }
  if (dd < 0) return degenerate('no points — the equation has no real solutions')
  const r = Math.sqrt(dd)
  const t1 = (-lam - r) / (2 * s)
  const t2 = (-lam + r) / (2 * s)
  // the lower (or left) line first
  const key = (t: number) => (Math.abs(beta) <= 1e-12 ? t / alpha : t / beta)
  const [lo, hi] = key(t1) <= key(t2) ? [t1, t2] : [t2, t1]
  return degenerate(`the two parallel lines ${lineU(lo)} and ${lineU(hi)}`)
}

export function classify(src: string): ConicClass {
  const got = functionOf(src)
  if (!got.ok) return noneClass(got.why)
  const q = quadOf(got.f)
  if (!q) return noneClass('the equation is not a quadratic in x and y')
  return classifyQuad(q, got.f)
}

// ----------------------------------------------------------------------------
// Spec ↔ coefficients
// ----------------------------------------------------------------------------

interface Vals { h: number; k: number; a: number; b: number; p: number; opens: 'x' | 'y' }

function valsOf(spec: ConicSpec): Vals {
  const opensDefault = spec.kind === 'parabola' ? 'y' : 'x'
  return {
    h: valueOf(txt(spec.h)),
    k: valueOf(txt(spec.k)),
    a: Math.abs(valueOf(txt(spec.a, '1'))),
    b: Math.abs(valueOf(txt(spec.b, spec.a ?? '1'))),
    p: valueOf(txt(spec.p ?? spec.a, '1')),
    opens: spec.opens ?? opensDefault,
  }
}

/** The spec's own Ax² + Bxy + Cy² + Dx + Ey + F (as its standard form, lhs − rhs). */
function specQuad(spec: ConicSpec): Q6 {
  const { h, k, a, b, p, opens } = valsOf(spec)
  switch (spec.kind) {
    case 'circle':
      return [1, 0, 1, -2 * h, -2 * k, h * h + k * k - a * a]
    case 'ellipse': {
      const ia = 1 / (a * a), ib = 1 / (b * b)
      return [ia, 0, ib, -2 * h * ia, -2 * k * ib, h * h * ia + k * k * ib - 1]
    }
    case 'hyperbola': {
      const ia = 1 / (a * a), ib = 1 / (b * b)
      return opens === 'y'
        ? [-ib, 0, ia, 2 * h * ib, -2 * k * ia, k * k * ia - h * h * ib - 1]
        : [ia, 0, -ib, -2 * h * ia, 2 * k * ib, h * h * ia - k * k * ib - 1]
    }
    case 'parabola':
      return opens === 'x'
        ? [0, 0, 1, -4 * p, -2 * k, k * k + 4 * p * h]
        : [1, 0, 0, -2 * h, -4 * p, h * h + 4 * p * k]
  }
}

/** q ∝ s (a nonzero multiple), to 1e-9 of the largest coefficient. */
function proportional(q: Q6, s: Q6): boolean {
  if (![...q, ...s].every(Number.isFinite)) return false
  const qs = q.reduce((t, c, i) => t + c * s[i], 0)
  const ss = s.reduce((t, c) => t + c * c, 0)
  if (ss === 0) return false
  const lam = qs / ss
  if (lam === 0) return false
  const S = Math.max(...q.map(Math.abs))
  return q.every((c, i) => Math.abs(c - lam * s[i]) <= 1e-9 * S)
}

// ----------------------------------------------------------------------------
// conicSource
// ----------------------------------------------------------------------------

const PLAIN = /^\d+(?:\.\d+)?$/

/** "x - 2", "x + 3/2", "x - (1+sqrt(2))", "x" — the teacher's text, sign folded. */
function shiftLin(v: 'x' | 'y', t: string): string {
  const hv = valueOf(t)
  if (hv === 0) return v
  const n = nodeOf(t)
  if (!n) return `${v} - (${t})`
  const simple = prec(n) >= 2 || (n.t === 'neg' && prec(n.a) >= 2)
  if (!simple) return `${v} - (${t})`
  if (hv < 0) return `${v} + ${srcOf(negNode(n))}`
  return `${v} - ${t}`
}

function shiftSq(v: 'x' | 'y', t: string): string {
  return valueOf(t) === 0 ? `${v}^2` : `(${shiftLin(v, t)})^2`
}

/** The source of s² for a length text s: "3" → "9", "3/2" → "9/4", "2.5" → "6.25", "sqrt(5)" → "5". */
function sqText(t: string): string {
  const n = nodeOf(t)
  if (n) {
    const r = ratOf(n)
    if (r) {
      const sq = rMul(r, r)
      if (sq) return ratSrc(sq, t.includes('.'))
    }
    if (n.t === 'call' && n.fn === 'sqrt' && n.args.length === 1 && valueOf(srcOf(n.args[0])) >= 0) {
      return srcOf(n.args[0])
    }
  }
  const v = valueOf(t)
  return numSrc(v * v, t.includes('.'))
}

/** "/9", "/(9/4)", "" for 1. */
function denom(t2: string): string {
  if (valueOf(t2) === 1) return ''
  return PLAIN.test(t2) ? `/${t2}` : `/(${t2})`
}

/** 4p as source, in the style of p's text. */
function fourPText(t: string): string {
  const n = nodeOf(t)
  const r = n ? ratOf(n) : null
  if (r) {
    const f = rMul(r, [4, 1])
    if (f) return ratSrc(f, t.includes('.'))
  }
  return numSrc(4 * valueOf(t), t.includes('.'))
}

export function conicSource(spec: ConicSpec): string {
  const h = txt(spec.h)
  const k = txt(spec.k)
  switch (spec.kind) {
    case 'circle':
      return `${shiftSq('x', h)} + ${shiftSq('y', k)} = ${sqText(txt(spec.a, '1'))}`
    case 'ellipse': {
      const a = txt(spec.a, '1')
      const b = txt(spec.b, a)
      return `${shiftSq('x', h)}${denom(sqText(a))} + ${shiftSq('y', k)}${denom(sqText(b))} = 1`
    }
    case 'hyperbola': {
      const a = txt(spec.a, '1')
      const b = txt(spec.b, a)
      const X = shiftSq('x', h)
      const Y = shiftSq('y', k)
      return spec.opens === 'y'
        ? `${Y}${denom(sqText(a))} - ${X}${denom(sqText(b))} = 1`
        : `${X}${denom(sqText(a))} - ${Y}${denom(sqText(b))} = 1`
    }
    case 'parabola': {
      const p = txt(spec.p ?? spec.a, '1')
      const opensX = spec.opens === 'x'
      const sq = opensX ? shiftSq('y', k) : shiftSq('x', h)
      const lin = opensX ? shiftLin('x', h) : shiftLin('y', k)
      const bare = lin === 'x' || lin === 'y'
      const f = fourPText(p)
      const fv = valueOf(f)
      let rhs: string
      if (fv === 1) rhs = bare ? (lin === 'y' ? '1y' : lin) : lin
      else if (fv === -1) rhs = bare ? `-${lin}` : `-(${lin})`
      else {
        const neg = fv < 0
        const n = nodeOf(f)
        const mag = neg && n ? srcOf(negNode(n)) : f
        const c = PLAIN.test(mag) ? mag : `(${mag})`
        rhs = `${neg ? '-' : ''}${c}${bare ? lin : `(${lin})`}`
      }
      return `${sq} = ${rhs}`
    }
  }
  return 'x^2 + y^2 = 1'
}

// ----------------------------------------------------------------------------
// readConic
// ----------------------------------------------------------------------------

type Aligned =
  | { kind: 'circle' | 'ellipse'; h: number; k: number; a2: number; b2: number }
  | { kind: 'hyperbola'; h: number; k: number; a2: number; b2: number; opens: 'x' | 'y' }
  | { kind: 'parabola'; h: number; k: number; p: number; opens: 'x' | 'y' }

/** Complete the square of an axis-aligned quadratic; null when degenerate or not a conic. */
function aligned(q: Q6, f: Fxy): Aligned | null {
  const [A, B, C, D, E, F] = q
  const S = Math.max(...q.map(Math.abs))
  const zero = (c: number) => Math.abs(c) <= 1e-12 * S
  if (!zero(B)) return null
  if (!zero(A) && !zero(C)) {
    const h = snapped(-D / (2 * A))
    const k = snapped(-E / (2 * C))
    const tx = (D * D) / (4 * A)
    const ty = (E * E) / (4 * C)
    // −Q(h, k), from the typed expression itself: no cancellation for a
    // standard form far from the origin (the coefficient formula loses ~1e-9)
    const R = -valueAt(f, h, k, F - tx - ty)
    if (Math.abs(R) <= 1e-12 * (Math.abs(tx) + Math.abs(ty) + Math.abs(F))) return null
    const a2 = R / A
    const b2 = R / C
    if (a2 > 0 && b2 > 0) {
      return { kind: near(a2, b2, 1e-12) ? 'circle' : 'ellipse', h, k, a2, b2 }
    }
    if (a2 < 0 && b2 < 0) return null
    return a2 > 0
      ? { kind: 'hyperbola', h, k, a2, b2: -b2, opens: 'x' }
      : { kind: 'hyperbola', h, k, a2: b2, b2: -a2, opens: 'y' }
  }
  if (!zero(A) && zero(C)) {
    if (zero(E)) return null
    const h = snapped(-D / (2 * A))
    const Fp = valueAt(f, h, 0, F - (D * D) / (4 * A))
    return { kind: 'parabola', h, k: -Fp / E, p: -E / (4 * A), opens: 'y' }
  }
  if (zero(A) && !zero(C)) {
    if (zero(D)) return null
    const k = snapped(-E / (2 * C))
    const Fp = valueAt(f, 0, k, F - (E * E) / (4 * C))
    return { kind: 'parabola', h: -Fp / D, k, p: -D / (4 * C), opens: 'x' }
  }
  return null
}

interface Cand { v: number; text: string }

interface Texts {
  /** constants beside a bare x in a sum, as the h they imply */
  hx: Cand[]
  hy: Cand[]
  /** every constant subtree */
  lits: Cand[]
  /** constant bases of a constant ^2 */
  bases: Cand[]
}

function textsOf(src: string): Texts {
  const out: Texts = { hx: [], hy: [], lits: [], bases: [] }
  const ast = parseAst(prep(src))
  if (!ast.ok) return out
  const cand = (n: ExprNode, neg: boolean): Cand => {
    const text = srcOf(neg ? negNode(n) : n)
    return { v: valueOf(text), text }
  }
  const walk = (n: ExprNode): void => {
    if (!hasVar(n)) out.lits.push(cand(n, false))
    if (n.t === 'neg') walk(n.a)
    else if (n.t === 'call') n.args.forEach(walk)
    else if (n.t === 'bin') {
      if (n.op === '^' && !hasVar(n.a) && !hasVar(n.b) && valueOf(srcOf(n.b)) === 2) out.bases.push(cand(n.a, false))
      if (n.op === '+' || n.op === '-') {
        for (const [vn, cn] of [[n.a, n.b], [n.b, n.a]] as const) {
          if (vn.t === 'var' && (vn.name === 'x' || vn.name === 'y') && !hasVar(cn)) {
            // x − c, c − x → h = c;  x + c, c + x → h = −c
            ;(vn.name === 'x' ? out.hx : out.hy).push(cand(cn, n.op === '+'))
          }
        }
      }
      walk(n.a)
      walk(n.b)
    }
  }
  walk(ast.lhs)
  if (ast.rhs) walk(ast.rhs)
  return out
}

const findCand = (cs: Cand[], v: number): Cand | undefined => cs.find((c) => near(c.v, v, 1e-12))

function shiftText(v: number, cs: Cand[]): string {
  if (Math.abs(v) < 1e-12) return '0'
  return findCand(cs, v)?.text ?? numSrc(v)
}

/** a from a²: a typed base (5^2), else √ in the style of a typed a² (6.25 → 2.5). */
function lengthText(sq: number, t: Texts): string {
  const base = t.bases.find((c) => c.v > 0 && near(c.v, Math.sqrt(sq), 1e-12))
  if (base) return base.text
  const lit = findCand(t.lits, sq)
  return sqrtSrc(sq, lit ? lit.text.includes('.') : false)
}

function pText(p: number, t: Texts): string {
  const lit = findCand(t.lits, 4 * p)
  return numSrc(p, lit ? lit.text.includes('.') : false)
}

export function readConic(src: string): ConicSpec | null {
  const got = functionOf(src)
  if (!got.ok || !got.implicit) return null
  const q = quadOf(got.f)
  if (!q) return null
  const al = aligned(q, got.f)
  if (!al) return null
  const t = textsOf(src)
  const h = shiftText(al.h, t.hx)
  const k = shiftText(al.k, t.hy)
  let spec: ConicSpec
  switch (al.kind) {
    case 'circle':
      spec = { kind: 'circle', h, k, a: lengthText(al.a2, t) }
      break
    case 'ellipse':
      spec = { kind: 'ellipse', h, k, a: lengthText(al.a2, t), b: lengthText(al.b2, t) }
      break
    case 'hyperbola':
      spec = { kind: 'hyperbola', h, k, a: lengthText(al.a2, t), b: lengthText(al.b2, t), opens: al.opens }
      break
    case 'parabola': {
      const p = pText(al.p, t)
      spec = { kind: 'parabola', h, k, a: p, opens: al.opens, p }
      break
    }
  }
  return proportional(q, specQuad(spec)) ? spec : null
}

// ----------------------------------------------------------------------------
// conicFeatures
// ----------------------------------------------------------------------------

const EMPTY: ConicFeatures = {
  center: null, vertices: [], coVertices: [], foci: [], directrix: null,
  asymptotes: [], box: null, eccentricity: 0, sentences: [],
}

const isDec = (s: string | undefined): boolean => (s ?? '').includes('.')

/** "(2 ± √5, −1)" when the offset is irrational, else "(−1, −1) and (5, −1)". */
function pairText(p: Labeled[], off: number, along: 'x' | 'y', c: Labeled): string {
  if (!isRatNum(off) && isExactNum(off)) {
    const o = uni(Math.abs(off))
    const centerText = along === 'x' ? c.xText : c.yText
    const pm = centerText === '0' ? `±${o}` : `${centerText} ± ${o}`
    return along === 'x' ? `(${pm}, ${c.yText})` : `(${c.xText}, ${pm})`
  }
  return `${pt(p[0])} and ${pt(p[1])}`
}

export function conicFeatures(spec: ConicSpec): ConicFeatures {
  const v = valsOf(spec)
  const { h, k } = v
  if (![h, k].every(Number.isFinite)) return { ...EMPTY, sentences: [] }
  const hd = isDec(spec.h)
  const kd = isDec(spec.k)
  const center = lab(h, k, uni(h, hd), uni(k, kd))
  const xAt = (off: number, dec = hd) => sumUni(h, off, dec)
  const yAt = (off: number, dec = kd) => sumUni(k, off, dec)

  if (spec.kind === 'circle') {
    const r = v.a
    const rd = isDec(spec.a)
    return {
      ...EMPTY,
      center,
      foci: [center],
      eccentricity: 0,
      sentences: [
        `center ${pt(center)}`,
        `radius ${uni(r, rd)}`,
        `diameter ${uni(2 * r, rd)}`,
      ],
    }
  }

  if (spec.kind === 'parabola') {
    const p = v.p
    const pd = isDec(spec.p ?? spec.a)
    const vertex = center
    const opensX = v.opens === 'x'
    const focus = opensX
      ? lab(h + p, k, xAt(p, hd || pd), center.yText)
      : lab(h, k + p, center.xText, yAt(p, kd || pd))
    const dv = opensX ? h - p : k - p
    const dText = `${opensX ? 'x' : 'y'} = ${opensX ? xAt(-p, hd || pd) : yAt(-p, kd || pd)}`
    const way = opensX ? (p > 0 ? 'right' : 'left') : (p > 0 ? 'up' : 'down')
    return {
      ...EMPTY,
      center: null,
      vertices: [vertex],
      foci: [focus],
      directrix: { axis: opensX ? 'x' : 'y', value: dv + 0, text: dText },
      eccentricity: 1,
      sentences: [
        `vertex ${pt(vertex)}`,
        `opens ${way}`,
        `4p = ${uni(4 * p, pd)}, so p = ${uni(p, pd)}`,
        `focus ${pt(focus)}`,
        `directrix ${dText}`,
        `axis of symmetry ${opensX ? `y = ${center.yText}` : `x = ${center.xText}`}`,
        `latus rectum ${uni(Math.abs(4 * p), pd)}`,
      ],
    }
  }

  // ellipse / hyperbola: squares from the texts, so √5 squares to exactly 5
  const sqOf = (s: string | undefined, dflt: string): number => {
    const t = txt(s, dflt)
    return valueOf(sqText(t))
  }
  const a2 = sqOf(spec.a, '1')
  const b2 = sqOf(spec.b, txt(spec.a, '1'))
  const ad = isDec(spec.a)
  const bd = isDec(spec.b)

  if (spec.kind === 'ellipse') {
    const horizontal = a2 >= b2
    const M2 = horizontal ? a2 : b2
    const m2 = horizontal ? b2 : a2
    const Md = horizontal ? ad : bd
    const md = horizontal ? bd : ad
    const M = Math.sqrt(M2)
    const m = Math.sqrt(m2)
    const c2 = M2 - m2
    const c = Math.sqrt(Math.max(0, c2))
    const Mt = (sign: 1 | -1) => (horizontal ? xAt(sign * M, hd || Md) : yAt(sign * M, kd || Md))
    const mt = (sign: 1 | -1) => (horizontal ? yAt(sign * m, kd || md) : xAt(sign * m, hd || md))
    const vertices = horizontal
      ? [lab(h - M, k, Mt(-1), center.yText), lab(h + M, k, Mt(1), center.yText)]
      : [lab(h, k - M, center.xText, Mt(-1)), lab(h, k + M, center.xText, Mt(1))]
    const coVertices = horizontal
      ? [lab(h, k - m, center.xText, mt(-1)), lab(h, k + m, center.xText, mt(1))]
      : [lab(h - m, k, mt(-1), center.yText), lab(h + m, k, mt(1), center.yText)]
    const foci = horizontal
      ? [lab(h - c, k, xAt(-c), center.yText), lab(h + c, k, xAt(c), center.yText)]
      : [lab(h, k - c, center.xText, yAt(-c)), lab(h, k + c, center.xText, yAt(c))]
    const e = c / M
    const along = horizontal ? 'x' : 'y'
    return {
      ...EMPTY,
      center,
      vertices,
      coVertices,
      foci,
      eccentricity: e,
      sentences: [
        `center ${pt(center)}`,
        `major axis ${uni(2 * M, Md)}, minor axis ${uni(2 * m, md)}`,
        `the major axis is ${horizontal ? `horizontal, on y = ${center.yText}` : `vertical, on x = ${center.xText}`}`,
        `vertices ${pairText(vertices, M, along, center)}`,
        `co-vertices ${pairText(coVertices, m, horizontal ? 'y' : 'x', center)}`,
        `c² = ${uni(M2, Md)} − ${uni(m2, md)} = ${uni(c2)}, so c = ${sqrtUni(c2)}`,
        `foci ${pairText(foci, c, along, center)}`,
        `eccentricity ${uni(e)}`,
        `latus rectum ${uni((2 * m2) / M)}`,
      ],
    }
  }

  // hyperbola
  const opensY = v.opens === 'y'
  const a = Math.sqrt(a2)
  const b = Math.sqrt(b2)
  const c2 = a2 + b2
  const c = Math.sqrt(c2)
  const vertices = opensY
    ? [lab(h, k - a, center.xText, yAt(-a, kd || ad)), lab(h, k + a, center.xText, yAt(a, kd || ad))]
    : [lab(h - a, k, xAt(-a, hd || ad), center.yText), lab(h + a, k, xAt(a, hd || ad), center.yText)]
  const coVertices = opensY
    ? [lab(h - b, k, xAt(-b, hd || bd), center.yText), lab(h + b, k, xAt(b, hd || bd), center.yText)]
    : [lab(h, k - b, center.xText, yAt(-b, kd || bd)), lab(h, k + b, center.xText, yAt(b, kd || bd))]
  const foci = opensY
    ? [lab(h, k - c, center.xText, yAt(-c)), lab(h, k + c, center.xText, yAt(c))]
    : [lab(h - c, k, xAt(-c), center.yText), lab(h + c, k, xAt(c), center.yText)]
  const slope = opensY ? a / b : b / a
  const dx = opensY ? b : a
  const dy = opensY ? a : b
  const box: Vec2[] = [
    { x: h - dx, y: k - dy }, { x: h + dx, y: k - dy },
    { x: h + dx, y: k + dy }, { x: h - dx, y: k + dy },
  ]
  const asym = (sign: string): string => {
    const coef = near(slope, 1) ? '' : coefText(slope)
    const xPart = Math.abs(h) < 1e-12
      ? `${coef}x`
      : `${coef.trimEnd()}(x ${h > 0 ? MINUS : '+'} ${uni(Math.abs(h), hd)})`
    const kPart = Math.abs(k) < 1e-12 ? '' : ` ${k > 0 ? '+' : MINUS} ${uni(Math.abs(k), kd)}`
    return `y = ${sign}${xPart}${kPart}`
  }
  const along = opensY ? 'y' : 'x'
  return {
    ...EMPTY,
    center,
    vertices,
    coVertices,
    foci,
    asymptotes: [
      { slope, text: asym('') },
      { slope: -slope, text: asym(MINUS) },
    ],
    box,
    eccentricity: c / a,
    sentences: [
      `center ${pt(center)}`,
      `opens ${opensY ? 'up and down' : 'left and right'}`,
      `vertices ${pairText(vertices, a, along, center)}`,
      `co-vertices ${pairText(coVertices, b, opensY ? 'x' : 'y', center)}`,
      `transverse axis ${uni(2 * a, ad)}, conjugate axis ${uni(2 * b, bd)}`,
      `c² = ${uni(a2, ad)} + ${uni(b2, bd)} = ${uni(c2)}, so c = ${sqrtUni(c2)}`,
      `foci ${pairText(foci, c, along, center)}`,
      `asymptotes ${asym('±')}`,
      `eccentricity ${uni(c / a)}`,
      `latus rectum ${uni((2 * b2) / a)}`,
    ],
  }
}

// ----------------------------------------------------------------------------
// readRotatedConic
//
// METHOD. The coefficients come from quadOf exactly as for classify (exact
// differences on the integer grid, snapped rationals). The angle is the
// textbook one, cot 2θ = (A − C)/B with 0 < θ < 90° — i.e. θ = ½·atan2(B,
// A − C), plus 90° when B < 0 — so xy = 1, x² + xy + y² = 3 and 5x² − 6xy +
// 5y² = 8 are all turned by 45°. cos θ and sin θ come from the half-angle
// formulas on cos 2θ = ±(A − C)/R, sin 2θ = |B|/R, R = √((A − C)² + B²),
// whichever of the two is not a cancellation (A = C: exactly √½ each).
//
// The typed F is then COMPOSED with the rotation, F′(x′, y′) = F(x′cos θ −
// y′sin θ, x′sin θ + y′cos θ), and F′ goes through the very same machinery
// as a typed axis-aligned line: quadOf (its B′ snaps to 0), `aligned`
// (completing the square: the center solves ∇ = 0, h′ = −D′/2A′,
// k′ = −E′/2C′), and conicFeatures. The spec's texts are numSrc / sqrtSrc of
// the numbers (fractions, surds, else 12 digits) and the spec is VERIFIED
// like readConic's: its own coefficients must be proportional to F′'s.
//
// Each feature point is mapped back, x = x′cos θ − y′sin θ, y = x′sin θ +
// y′cos θ, and its coordinates written EXACTLY when they are a fraction or a
// closed form of exact.ts (never a multiple of π: a coordinate that "is"
// 3π/4 is a coincidence) — the point is then placed at that exact value. A
// vertex's exact pair must also satisfy F = 0 (relative 1e-9 of the terms),
// else both coordinates fall back to 6 digits. The center is the solution of
// the 2 × 2 gradient system in x, y (a fraction for a rational F).
//
// Lines: an asymptote is the rotated direction (1, ±m′) through the center —
// "y = 0", "x = 0" for xy = 1, "y = (2+√3)x" elsewhere; the directrix is
// n·(x, y) = d for the unit normal n of its rotated axis, scaled to integer
// coefficients when b/a is a fraction ("x − y = −2"), else x + (b/a)y = c/a.
// ----------------------------------------------------------------------------

/** A coordinate as exact text when it is one (fraction, surd, quadratic surd), with that exact value. */
function exactCoord(v: number): { text: string; value: number; exact: boolean } {
  if (Math.abs(v) < 1e-12) return { text: '0', value: 0, exact: true }
  const r = snapRat(v)
  if (r) return { text: ratSrc(r).replace('-', MINUS), value: r[0] / r[1], exact: true }
  const e = exactForm(v)
  if (e && !e.text.includes('π')) return { text: e.text, value: e.value, exact: true }
  return { text: decText(v), value: v, exact: false }
}

/** 6 significant digits, Unicode minus. */
const decText = (v: number): string => String(Number(v.toPrecision(6)) + 0).replace('-', MINUS)

/** A number as a coefficient/constant: exact when it is one (no π), else 6 digits. */
const numText = (v: number): string => exactCoord(v).text

/** The line through p with direction d: "y = −x + 2", "x = 3". */
function lineThrough(p: Vec2, d: Vec2): string {
  const L = Math.hypot(d.x, d.y)
  if (Math.abs(d.x) <= 1e-12 * L) return `x = ${numText(p.x)}`
  let m = d.y / d.x
  if (Math.abs(m) <= 1e-12) m = 0
  const mm = exactCoord(m)
  const slope = mm.exact ? mm.value : m
  return lineText(slope, snapped(p.y - slope * p.x))
}

/** a·x + b·y = c as text, scaled to integer coefficients when b/a (or a/b) is a small fraction. */
function generalLineText(a: number, b: number, c: number): string {
  const S = Math.max(Math.abs(a), Math.abs(b))
  if (Math.abs(b) <= 1e-12 * S) return `x = ${numText(c / a)}`
  if (Math.abs(a) <= 1e-12 * S) return `y = ${numText(c / b)}`
  let A: number, B: number, G: number
  const r = snapRat(b / a, 100, 1e-10)
  if (r) {
    A = r[1]; B = r[0]; G = (c * r[1]) / a
  } else {
    A = 1; B = b / a; G = c / a
  }
  if (A < 0) { A = -A; B = -B; G = -G }
  const term = (k: number, v: string, first: boolean): string => {
    const mag = Math.abs(k)
    const t = near(mag, 1) ? v : `${numText(mag)}${v}`
    if (first) return k < 0 ? `${MINUS}${t}` : t
    return ` ${k < 0 ? MINUS : '+'} ${t}`
  }
  return `${term(A, 'x', true)}${term(B, 'y', false)} = ${numText(snapped(G))}`
}

/** Standard-form source in x, y as display text in x′, y′: "x′²/2 + y′²/6 = 1". */
function primeOf(src: string): string {
  return src
    .replace(/= 1y$/, '= y')
    .replace(/\((\d*sqrt\(\d+\))\)([xy])/g, '$1$2')
    .replace(/sqrt\(([^()]*)\)/g, (_m, inner: string) => (/^[\w.]+$/.test(inner) ? `√${inner}` : `√(${inner})`))
    .replace(/\^2/g, '²')
    .replace(/\*/g, '·')
    .replace(/-/g, MINUS)
    .replace(/x/g, 'x′')
    .replace(/y/g, 'y′')
}

/**
 * A semi-axis from its square: sqrtSrc (3, sqrt(5), 2sqrt(3)), or — when the
 * square is a closed form whose root is not one (a² = −2 + 2√2 for x² + xy
 * = 1) — sqrt of that closed form, which conicSource squares back exactly.
 */
function lenSrc(sq: number): string {
  const t = sqrtSrc(sq)
  if (!/^-?[\d.]+(e[-+]?\d+)?$/.test(t) || snapRat(Math.sqrt(sq))) return t
  const inner = numSrc(sq)
  return /^-?[\d.]+(e[-+]?\d+)?$/.test(inner) ? t : `sqrt(${inner})`
}

/** θ as "π/4" when it is a multiple of π/12 or π/8 (π/24 in all), else null. */
function piTheta(theta: number): string | null {
  const n = (theta * 24) / Math.PI
  const r = Math.round(n)
  if (r <= 0 || Math.abs(n - r) > 1e-9) return null
  if (r % 2 !== 0 && r % 3 !== 0) return null // 7.5°, 37.5°: not a textbook angle
  const g = gcd(r, 24)
  const p = r / g
  const q = 24 / g
  return `${p === 1 ? '' : p}π${q === 1 ? '' : `/${q}`}`
}

export function readRotatedConic(src: string): RotatedConic | null {
  const got = functionOf(src)
  if (!got.ok || !got.implicit) return null
  const f = got.f
  const q = quadOf(f)
  if (!q) return null
  const cls = classifyQuad(q, f)
  if (!cls.rotated) return null
  if (cls.kind !== 'ellipse' && cls.kind !== 'hyperbola' && cls.kind !== 'parabola') return null
  const kind = cls.kind
  const [A, B, C, D, E, F] = q
  const S2 = Math.max(Math.abs(A), Math.abs(B), Math.abs(C))
  const dAC = A - C

  // ---- the angle: cot 2θ = (A − C)/B, 0 < θ < 90°
  let c: number
  let s: number
  if (Math.abs(dAC) <= 1e-12 * S2) {
    c = Math.SQRT1_2
    s = Math.SQRT1_2
  } else {
    const R = Math.hypot(dAC, B)
    const cos2 = (B > 0 ? dAC : -dAC) / R
    const sin2 = Math.abs(B) / R
    if (cos2 >= 0) {
      c = Math.sqrt((1 + cos2) / 2)
      s = sin2 / (2 * c)
    } else {
      s = Math.sqrt((1 - cos2) / 2)
      c = sin2 / (2 * s)
    }
  }
  const theta = Math.atan2(s, c)
  if (!(theta > 0 && theta < Math.PI / 2)) return null
  const toXY = (u: number, v: number): Vec2 => ({ x: u * c - v * s, y: u * s + v * c })

  // ---- the conic in x′, y′, through the axis-aligned machinery
  const fr: Fxy = (u, v) => {
    const p = toXY(u, v)
    return f(p.x, p.y)
  }
  const qr = quadOf(fr)
  if (!qr) return null
  const al = aligned(qr, fr)
  if (!al || al.kind !== kind) return null
  const h = numSrc(al.h)
  const k = numSrc(al.k)
  let spec: ConicSpec
  if (al.kind === 'parabola') {
    const p = numSrc(al.p)
    spec = { kind: 'parabola', h, k, a: p, opens: al.opens, p }
  } else if (al.kind === 'ellipse') {
    spec = { kind: 'ellipse', h, k, a: lenSrc(al.a2), b: lenSrc(al.b2) }
  } else if (al.kind === 'hyperbola') {
    spec = { kind: 'hyperbola', h, k, a: lenSrc(al.a2), b: lenSrc(al.b2), opens: al.opens }
  } else {
    return null
  }
  if (!proportional(qr, specQuad(spec))) return null
  const rf = conicFeatures(spec)

  // ---- back to x, y
  const onCurve = (x: number, y: number): boolean => {
    let v = NaN
    try { v = f(x, y) } catch { v = NaN }
    const scale = Math.abs(A * x * x) + Math.abs(B * x * y) + Math.abs(C * y * y) + Math.abs(D * x) + Math.abs(E * y) + Math.abs(F)
    return Number.isFinite(v) && Math.abs(v) <= 1e-9 * Math.max(scale, 1e-300)
  }
  const mapLab = (l: Labeled, vertex = false): Labeled => {
    const p = toXY(l.x, l.y)
    const X = exactCoord(p.x)
    const Y = exactCoord(p.y)
    if (!X.exact || !Y.exact || (vertex && !onCurve(X.value, Y.value))) {
      // one inexact coordinate: keep the exact one if it verifies alone (a vertex needs both)
      if (vertex) return lab(p.x, p.y, decText(p.x), decText(p.y))
      return lab(X.exact ? X.value : p.x, Y.exact ? Y.value : p.y, X.text, Y.text)
    }
    return lab(X.value, Y.value, X.text, Y.text)
  }

  let center: Labeled | null = null
  if (kind !== 'parabola') {
    // the 2 × 2 gradient system: 2A x + B y = −D, B x + 2C y = −E
    const det = 4 * A * C - B * B
    const x0 = snapped((B * E - 2 * C * D) / det)
    const y0 = snapped((B * D - 2 * A * E) / det)
    const X = exactCoord(x0)
    const Y = exactCoord(y0)
    center = lab(X.exact ? X.value : x0, Y.exact ? Y.value : y0, X.text, Y.text)
  }
  const vertices = rf.vertices.map((l) => mapLab(l, true))
  const coVertices = rf.coVertices.map((l) => mapLab(l))
  const foci = rf.foci.map((l) => mapLab(l))
  const box = rf.box ? rf.box.map((b) => {
    const p = toXY(b.x, b.y)
    return { x: exactCoord(p.x).value, y: exactCoord(p.y).value }
  }) : null

  const asymptotes: { slope: number; text: string }[] = []
  if (center) {
    for (const a of rf.asymptotes) {
      const d = toXY(1, a.slope)
      const L = Math.hypot(d.x, d.y)
      const vertical = Math.abs(d.x) <= 1e-12 * L
      const m = d.y / d.x
      const slope = vertical ? Infinity : Math.abs(m) <= 1e-12 ? 0 : exactCoord(m).value
      asymptotes.push({ slope, text: lineThrough(center, d) })
    }
  }

  let directrixLine: ConicLine | null = null
  if (rf.directrix && vertices[0]) {
    // x′ = d has unit normal (cos θ, sin θ); y′ = d has (−sin θ, cos θ)
    const n = rf.directrix.axis === 'x' ? { x: c, y: s } : { x: -s, y: c }
    const d = rf.directrix.value
    const v0 = vertices[0]
    const off = d - (n.x * v0.x + n.y * v0.y)
    const foot = { x: v0.x + off * n.x, y: v0.y + off * n.y }
    directrixLine = {
      a: n.x,
      b: n.y,
      c: d,
      text: generalLineText(n.x, n.y, d),
      pts: [
        { x: foot.x + n.y, y: foot.y - n.x },
        { x: foot.x - n.y, y: foot.y + n.x },
      ],
    }
  }

  // ---- words
  const degreesText = degText(theta)
  const pi = piTheta(theta)
  const thetaText = pi ?? degreesText
  const cosText = numText(c)
  const sinText = numText(s)
  const primeText = primeOf(conicSource(spec))
  const cot = numText(snapped(dAC / B))
  const keep = (prefix: string) => rf.sentences.filter((t) => t.startsWith(prefix))
  const pairOf = (ps: Labeled[]) => ps.map(pt).join(' and ')
  const sentences: string[] = [
    `rotated ${degreesText}: in axes x′, y′ this is ${primeText}`,
    `cot 2θ = (A − C)/B = ${cot}, so θ = ${pi ? `${pi} (${degreesText})` : `½·arccot(${cot}) ≈ ${degreesText}`}`,
    `cos θ = ${cosText}, sin θ = ${sinText}: x = x′cos θ − y′sin θ, y = x′sin θ + y′cos θ`,
  ]
  if (kind === 'parabola') {
    const v0 = vertices[0]
    const f0 = foci[0]
    const p = valueOf(txt(spec.p))
    const axisDir = rf.directrix?.axis === 'x' ? { x: c, y: s } : { x: -s, y: c }
    if (v0) sentences.push(`vertex ${pt(v0)}`)
    if (f0) sentences.push(`focus ${pt(f0)}, ${sqrtUni(p * p)} from the vertex (p = ${uni(p)} along the ${rf.directrix?.axis === 'x' ? 'x′' : 'y′'}-axis)`)
    if (directrixLine) sentences.push(`directrix ${directrixLine.text}`)
    if (v0) sentences.push(`axis of symmetry ${lineThrough(v0, axisDir)}`)
    sentences.push(...keep('latus rectum'))
  } else {
    const ell = kind === 'ellipse'
    if (center) sentences.push(`center ${pt(center)}`)
    sentences.push(...keep(ell ? 'major axis' : 'transverse axis'))
    if (center && vertices.length === 2) {
      const dir = { x: vertices[1].x - vertices[0].x, y: vertices[1].y - vertices[0].y }
      sentences.push(`the ${ell ? 'major' : 'transverse'} axis is on the line ${lineThrough(center, dir)}`)
    }
    sentences.push(`vertices ${pairOf(vertices)}`)
    sentences.push(`co-vertices ${pairOf(coVertices)}`)
    sentences.push(...keep('c² ='))
    sentences.push(`foci ${pairOf(foci)}`)
    if (asymptotes.length === 2) sentences.push(`asymptotes ${asymptotes[0].text} and ${asymptotes[1].text}`)
    sentences.push(...keep('eccentricity'), ...keep('latus rectum'))
  }

  return {
    kind,
    theta,
    thetaText,
    degreesText,
    cosText,
    sinText,
    center,
    spec,
    primeText,
    features: {
      center,
      vertices,
      coVertices,
      foci,
      directrix: null,
      directrixLine,
      asymptotes,
      box,
      eccentricity: rf.eccentricity,
      sentences,
    },
    classSentence: cls.sentence.replace(/, rotated [^,]*$/, `, rotated ${degreesText}`),
  }
}

// ----------------------------------------------------------------------------
// Builders
// ----------------------------------------------------------------------------

const finitePt = (...ps: (Vec2 | undefined)[]): boolean =>
  ps.every((p) => p === undefined || (Number.isFinite(p.x) && Number.isFinite(p.y)))

const BAD_POINT = { error: 'every point needs finite coordinates' }

/** Is d along x, along y, or neither (relative 1e-9)? */
function axisOf(d: Vec2): 'x' | 'y' | 'zero' | null {
  const s = Math.max(Math.abs(d.x), Math.abs(d.y))
  if (s === 0) return 'zero'
  if (Math.abs(d.y) <= 1e-9 * s) return 'x'
  if (Math.abs(d.x) <= 1e-9 * s) return 'y'
  return null
}

const sub = (p: Vec2, q: Vec2): Vec2 => ({ x: p.x - q.x, y: p.y - q.y })

function circleSpec(c: Vec2, r2: number): ConicSpec {
  return { kind: 'circle', h: numSrc(c.x), k: numSrc(c.y), a: sqrtSrc(r2) }
}

/** Ellipse with major semi-axis² M2 along `along`, minor² m2. */
function ellipseSpec(c: Vec2, along: 'x' | 'y', M2: number, m2: number): ConicSpec {
  if (near(M2, m2, 1e-12)) return circleSpec(c, M2)
  const Mt = sqrtSrc(M2)
  const mt = sqrtSrc(m2)
  return along === 'x'
    ? { kind: 'ellipse', h: numSrc(c.x), k: numSrc(c.y), a: Mt, b: mt }
    : { kind: 'ellipse', h: numSrc(c.x), k: numSrc(c.y), a: mt, b: Mt }
}

function hyperbolaSpec(c: Vec2, opens: 'x' | 'y', a2: number, b2: number): ConicSpec {
  return { kind: 'hyperbola', h: numSrc(c.x), k: numSrc(c.y), a: sqrtSrc(a2), b: sqrtSrc(b2), opens }
}

function parabolaSpec(vx: number, vy: number, opens: 'x' | 'y', p: number): ConicSpec {
  const pt = numSrc(p)
  return { kind: 'parabola', h: numSrc(vx), k: numSrc(vy), a: pt, opens, p: pt }
}

export function conicFromCircle(center: Vec2, radiusOrPoint: number | Vec2): Built {
  if (!finitePt(center)) return BAD_POINT
  if (typeof radiusOrPoint === 'number') {
    if (!Number.isFinite(radiusOrPoint) || radiusOrPoint <= 0) return { error: 'the radius must be a positive number' }
    return { kind: 'circle', h: numSrc(center.x), k: numSrc(center.y), a: numSrc(radiusOrPoint) }
  }
  if (!finitePt(radiusOrPoint)) return BAD_POINT
  const d = sub(radiusOrPoint, center)
  const r2 = d.x * d.x + d.y * d.y
  if (r2 === 0) return { error: "the point on the circle can't be the center" }
  return circleSpec(center, r2)
}

const AXIS_ONLY = 'this app draws conics with horizontal and vertical axes'

export function conicFromEllipse(o: { center: Vec2; vertex: Vec2; focus?: Vec2; coVertex?: Vec2; e?: number }): Built {
  if (!o || !finitePt(o.center, o.vertex, o.focus, o.coVertex)) return BAD_POINT
  const d = sub(o.vertex, o.center)
  const along = axisOf(d)
  if (along === 'zero') return { error: "the vertex can't be the center" }
  if (along === null) {
    return { error: `the vertex must be level with the center or directly above or below it — ${AXIS_ONLY}` }
  }
  const M = along === 'x' ? Math.abs(d.x) : Math.abs(d.y)
  const M2 = M * M
  const beside = along === 'x' ? 'beside' : 'above or below'
  if (o.focus) {
    const f = sub(o.focus, o.center)
    const fa = axisOf(f)
    if (fa === 'zero') return ellipseSpec(o.center, along, M2, M2) // c = 0: a circle
    if (fa !== along) return { error: 'the focus must be on the major axis, the line through the center and the vertex' }
    const c = along === 'x' ? Math.abs(f.x) : Math.abs(f.y)
    if (c >= M * (1 - 1e-12)) return { error: 'the focus must be between the center and the vertex for an ellipse' }
    return ellipseSpec(o.center, along, M2, M2 - c * c)
  }
  if (o.coVertex) {
    const w = sub(o.coVertex, o.center)
    const wa = axisOf(w)
    if (wa === 'zero') return { error: "the co-vertex can't be the center" }
    if (wa === along || wa === null) {
      return { error: `the co-vertex must be on the minor axis — ${along === 'x' ? 'directly above or below' : 'level with'} the center, since the vertex is ${beside} it` }
    }
    const m = along === 'x' ? Math.abs(w.y) : Math.abs(w.x)
    if (m > M * (1 + 1e-12)) {
      return { error: 'the co-vertex must be closer to the center than the vertex — the major axis is the longer one' }
    }
    return ellipseSpec(o.center, along, M2, m * m)
  }
  if (o.e !== undefined) {
    const e = o.e
    if (!Number.isFinite(e) || e < 0 || e >= 1) {
      return { error: "an ellipse's eccentricity is at least 0 and less than 1 (e = 1 is a parabola, e > 1 a hyperbola)" }
    }
    return ellipseSpec(o.center, along, M2, M2 * (1 - e * e))
  }
  return { error: 'give a focus, a co-vertex or the eccentricity as well as the vertex' }
}

export function conicFromHyperbola(o: { center: Vec2; vertex: Vec2; focus?: Vec2; asymptoteSlope?: number; e?: number }): Built {
  if (!o || !finitePt(o.center, o.vertex, o.focus)) return BAD_POINT
  const d = sub(o.vertex, o.center)
  const opens = axisOf(d)
  if (opens === 'zero') return { error: "the vertex can't be the center" }
  if (opens === null) {
    return { error: `the vertex must be level with the center or directly above or below it — ${AXIS_ONLY}` }
  }
  const a = opens === 'x' ? Math.abs(d.x) : Math.abs(d.y)
  const a2 = a * a
  if (o.focus) {
    const f = sub(o.focus, o.center)
    const fa = axisOf(f)
    if (fa !== opens) return { error: 'the focus must be on the transverse axis, the line through the center and the vertex' }
    const c = opens === 'x' ? Math.abs(f.x) : Math.abs(f.y)
    if (c <= a * (1 + 1e-12)) return { error: 'the focus must be farther from the center than the vertex for a hyperbola' }
    return hyperbolaSpec(o.center, opens, a2, c * c - a2)
  }
  if (o.asymptoteSlope !== undefined) {
    const m = Math.abs(o.asymptoteSlope)
    if (!Number.isFinite(m) || m === 0) return { error: "the asymptotes' slope must be a nonzero number" }
    // opens 'x': slopes ±b/a; opens 'y': slopes ±a/b
    const b = opens === 'x' ? m * a : a / m
    return hyperbolaSpec(o.center, opens, a2, b * b)
  }
  if (o.e !== undefined) {
    const e = o.e
    if (!Number.isFinite(e) || e <= 1) return { error: "a hyperbola's eccentricity is greater than 1" }
    return hyperbolaSpec(o.center, opens, a2, a2 * (e * e - 1))
  }
  return { error: 'give a focus, the slope of an asymptote or the eccentricity as well as the vertex' }
}

export function conicFromParabola(
  o: { vertex: Vec2; focus: Vec2 } | { focus: Vec2; directrix: { axis: 'x' | 'y'; value: number } } | { vertex: Vec2; point: Vec2; opens: 'up' | 'down' | 'left' | 'right' },
): Built {
  if (!o) return { error: 'give a vertex and a focus, a focus and a directrix, or a vertex, a point and a direction' }
  if ('directrix' in o) {
    const { focus, directrix } = o
    if (!finitePt(focus) || !Number.isFinite(directrix?.value)) return BAD_POINT
    // axis 'y' is the line y = value (horizontal): the parabola opens along y
    const opens = directrix.axis === 'x' ? 'x' : 'y'
    const fv = opens === 'y' ? focus.y : focus.x
    const dist = fv - directrix.value
    if (Math.abs(dist) <= 1e-12 * Math.max(1, Math.abs(fv))) return { error: "the focus can't be on the directrix" }
    const mid = (fv + directrix.value) / 2
    const p = fv - mid
    return opens === 'y' ? parabolaSpec(focus.x, mid, 'y', p) : parabolaSpec(mid, focus.y, 'x', p)
  }
  if ('point' in o) {
    const { vertex, point, opens } = o
    if (!finitePt(vertex, point)) return BAD_POINT
    const d = sub(point, vertex)
    if (d.x === 0 && d.y === 0) return { error: "the point can't be the vertex" }
    const vertical = opens === 'up' || opens === 'down'
    const along = vertical ? d.y : d.x
    const across = vertical ? d.x : d.y
    const sign = opens === 'up' || opens === 'right' ? 1 : -1
    const S = Math.max(Math.abs(d.x), Math.abs(d.y))
    if (Math.abs(across) <= 1e-12 * S) {
      return { error: `that point is on the axis of symmetry — a parabola meets its axis only at the vertex` }
    }
    if (Math.abs(along) <= 1e-12 * S) {
      return { error: `a parabola that opens ${opens} can't pass through a point ${vertical ? 'level with' : 'directly above or below'} its vertex` }
    }
    if (Math.sign(along) !== sign) {
      const where = { up: 'below', down: 'above', right: 'to the left of', left: 'to the right of' }[opens]
      return { error: `a parabola that opens ${opens} can't pass through a point ${where} its vertex` }
    }
    const p = (across * across) / (4 * along)
    return parabolaSpec(vertex.x, vertex.y, vertical ? 'y' : 'x', p)
  }
  const { vertex, focus } = o
  if (!finitePt(vertex, focus)) return BAD_POINT
  const d = sub(focus, vertex)
  const ax = axisOf(d)
  if (ax === 'zero') return { error: "the focus can't be the vertex" }
  if (ax === null) {
    return { error: `the focus must be directly above, below, left or right of the vertex — ${AXIS_ONLY}` }
  }
  return parabolaSpec(vertex.x, vertex.y, ax, ax === 'y' ? d.y : d.x)
}

export function conicFromFoci(f1: Vec2, f2: Vec2, o: { sum: number } | { difference: number }): Built {
  if (!finitePt(f1, f2) || !o) return BAD_POINT
  const d = sub(f2, f1)
  const ax = axisOf(d)
  const center = { x: (f1.x + f2.x) / 2, y: (f1.y + f2.y) / 2 }
  const c = Math.hypot(d.x, d.y) / 2
  if ('sum' in o) {
    const s = o.sum
    if (!Number.isFinite(s) || s <= 0) return { error: 'the sum of the distances must be a positive number' }
    if (ax === 'zero') return circleSpec(center, (s / 2) * (s / 2))
    if (ax === null) return { error: `the foci must be level with each other or one directly above the other — ${AXIS_ONLY}` }
    if (s <= 2 * c * (1 + 1e-12)) {
      return { error: `the sum of the distances must be more than the distance between the foci (${uni(2 * c)})` }
    }
    const A = s / 2
    return ellipseSpec(center, ax, A * A, A * A - c * c)
  }
  const diff = Math.abs(o.difference)
  if (!Number.isFinite(diff) || diff === 0) return { error: 'the difference of the distances must be a nonzero number' }
  if (ax === 'zero') return { error: 'a hyperbola needs two different foci' }
  if (ax === null) return { error: `the foci must be level with each other or one directly above the other — ${AXIS_ONLY}` }
  if (diff >= 2 * c * (1 - 1e-12)) {
    return { error: `the difference of the distances must be less than the distance between the foci (${uni(2 * c)})` }
  }
  const A = diff / 2
  return hyperbolaSpec(center, ax, A * A, c * c - A * A)
}

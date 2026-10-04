// ============================================================================
// src/core/geometry.ts — coordinate geometry, worked the way a Math 1 / Math 2
// class works it: exactly, with the reason written down.
//
//   distance(a, b)            √13, 5, 2√5 — and ≈ 3.61 beside an irrational one
//   midpoint(a, b)            (5/2, 3)
//   endpointFrom(mid, end)    the other end of a segment, 2M − A
//   slope(a, b)               1/2, −3, 0 or "undefined"
//   lineThrough(a, b)         y = mx + b and y − y₁ = m(x − x₁)  (x = 4 when vertical)
//   lineThroughSlope(p, m)    the same, for a line through p with a known slope
//   relation(a1, a2, b1, b2)  'parallel' | 'perpendicular' | 'same' | 'neither'
//   perimeter(pts)            2√10 + 2√17 — like radicals collected
//   shoelace(pts)             the area, exactly, with its working
//   interiorAngles(pts)       degrees: exact for special angles, else 1 decimal
//   classifyTriangle / classifyQuadrilateral / polygonReport
//   rightTriangle(pts)        the right angle, a² + b² = c², sin/cos/tan of each
//                             acute angle as exact ratios, 45-45-90 / 30-60-90
//
// HOW IT STAYS EXACT. A coordinate a teacher types or a vertex a finger drops
// on the grid is a rational number, so every quantity in Math 1 coordinate
// geometry is either rational (a slope, a midpoint, an area) or the square
// root of one (a length, a ratio of lengths). Coordinates are read as
// fractions (small denominators only — a dragged 3.9583 is a decimal, not
// 39583/10000), the squares are formed in rational arithmetic, and the root
// is simplified by pulling out square factors: √(45/4) = 3√5/2. Nothing is
// recognised from a float when it can be computed.
//
// When a coordinate is irrational — a 30-60-90 triangle typed with 2√3 — the
// squares usually are not (|AC|² = 12), so a squared quantity is RECOGNISED
// as a fraction with a small denominator, and its root simplified the same
// way. Anything else is a decimal, and says so with "≈".
//
// Pure: no DOM, no React, no canvas.
// ============================================================================

import type { Vec2 } from './types'
import { exactForm } from './exact'

export const MINUS = '−'

// ---------------------------------------------------------------------------
// Rationals
// ---------------------------------------------------------------------------

/** n/d in lowest terms, d > 0. */
export interface Rat {
  n: number
  d: number
}

const safe = (v: number): boolean => Number.isSafeInteger(v)

function gcd(a: number, b: number): number {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b) [a, b] = [b, a % b]
  return a || 1
}

export function rat(n: number, d = 1): Rat | null {
  if (!safe(n) || !safe(d) || d === 0) return null
  if (d < 0) {
    n = -n
    d = -d
  }
  const g = gcd(n, d)
  return { n: n / g || 0, d: d / g }
}

const ratValue = (r: Rat): number => r.n / r.d

export function ratAdd(a: Rat | null, b: Rat | null): Rat | null {
  if (!a || !b) return null
  return rat(a.n * b.d + b.n * a.d, a.d * b.d)
}
export function ratSub(a: Rat | null, b: Rat | null): Rat | null {
  if (!a || !b) return null
  return rat(a.n * b.d - b.n * a.d, a.d * b.d)
}
export function ratMul(a: Rat | null, b: Rat | null): Rat | null {
  if (!a || !b) return null
  return rat(a.n * b.n, a.d * b.d)
}
export function ratDiv(a: Rat | null, b: Rat | null): Rat | null {
  if (!a || !b || b.n === 0) return null
  return rat(a.n * b.d, a.d * b.n)
}
const ratEq = (a: Rat, b: Rat): boolean => a.n === b.n && a.d === b.d

/** Largest denominator a coordinate (or a recognised square) is read with. */
export const MAX_DEN = 1000

/**
 * How close a float has to be to p/q to BE p/q: relative to |v| (floored at
 * 1). A typed 0.1 is within 1e-17 of 1/10 and a value computed in a few
 * floating-point steps is within ~1e-15 of what it should be, so 1e-12 keeps
 * every honest fraction. It is the dishonest ones it stops: at the 1e-9 this
 * once used, about one computed irrational in 150 (an incentre, a 28° turn, a
 * point projected onto a circle) sat that close to SOME fraction with a
 * three-digit denominator and was printed as it — 2245/537 for 4.1806331500.
 */
export const RAT_TOL = 1e-12

/**
 * Below this a computed value is rounding noise around 0 (1 − 0.1·10, a
 * cos 90° of 6e-17), and is read as 0. Anything larger is a number, however
 * small, and is never printed as an exact 0.
 */
export const ZERO_TOL = 1e-13

/**
 * The fraction with denominator ≤ maxDen within a hair of v, or null.
 *
 * Continued fractions: the convergents are the best approximations there are,
 * so the first one within tolerance is the simplest fraction that fits.
 *
 * The denominator is also capped by the tolerance: fractions with q ≤ Q are
 * about 1/Q² apart, and a match is only evidence when that gap dwarfs the
 * window. For |v| up to ~10⁴ the cap is above 1000 and changes nothing; for
 * large |v| (where 1e-12·|v| is wide) it keeps 123456.789 from "being" a
 * fraction with denominator 800.
 */
export function toRat(v: number, maxDen = MAX_DEN): Rat | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1e9) return null
  if (Number.isInteger(v)) return { n: v === 0 ? 0 : v, d: 1 }
  const tol = RAT_TOL * Math.max(1, Math.abs(v))
  const qMax = Math.min(maxDen, Math.floor(1 / Math.sqrt(2e3 * tol)))
  let h0 = 0
  let h1 = 1
  let k0 = 1
  let k1 = 0
  let x = v
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(x)
    const h2 = a * h1 + h0
    const k2 = a * k1 + k0
    if (k2 > qMax || !safe(h2)) break
    h0 = h1
    h1 = h2
    k0 = k1
    k1 = k2
    if (Math.abs(v - h1 / k1) <= tol) {
      // never 0 for a value that is not 0: a tiny length, or the square of
      // one, is a number (measureOf reads rounding noise as 0 on its own)
      if (h1 === 0) return null
      return rat(h1, k1)
    }
    const f = x - a
    if (f < 1e-14) break
    x = 1 / f
  }
  return null
}

export function ratText(r: Rat): string {
  const s = r.n < 0 ? MINUS : ''
  const n = Math.abs(r.n)
  return r.d === 1 ? `${s}${n}` : `${s}${n}/${r.d}`
}

export function ratTex(r: Rat): string {
  const s = r.n < 0 ? '-' : ''
  const n = Math.abs(r.n)
  return r.d === 1 ? `${s}${n}` : `${s}\\frac{${n}}{${r.d}}`
}

// ---------------------------------------------------------------------------
// Surds: c·√k, c rational, k square-free
// ---------------------------------------------------------------------------

export interface Surd {
  c: Rat
  k: number
}

/** Largest radicand printed; past it a root is a decimal nobody reads exactly. */
const MAX_RADICAND = 100000

/** m = a²·k with k square-free, or null when m is too large to factor here. */
export function squareFree(m: number): [number, number] | null {
  if (!safe(m) || m < 0 || m > 1e10) return null
  if (m === 0) return [0, 1]
  let a = 1
  let k = 1
  let r = m
  for (let p = 2; p * p <= r; p++) {
    let e = 0
    while (r % p === 0) {
      r /= p
      e++
    }
    if (e >= 2) a *= p ** Math.floor(e / 2)
    if (e % 2) k *= p
  }
  k *= r
  return [a, k]
}

/** √r for a rational r ≥ 0, simplified: √(45/4) = 3√5/2. */
export function sqrtRat(r: Rat | null): Surd | null {
  if (!r || r.n < 0) return null
  if (r.n === 0) return { c: { n: 0, d: 1 }, k: 1 }
  const m = r.n * r.d
  const sf = squareFree(m)
  if (!sf) return null
  const [a, k] = sf
  if (k > MAX_RADICAND) return null
  const c = rat(a, r.d)
  return c ? { c, k } : null
}

export const surdValue = (s: Surd): number => ratValue(s.c) * Math.sqrt(s.k)

export function surdText(s: Surd): string {
  if (s.k === 1 || s.c.n === 0) return ratText(s.c)
  const sign = s.c.n < 0 ? MINUS : ''
  const n = Math.abs(s.c.n)
  const head = n === 1 ? '' : String(n)
  return s.c.d === 1 ? `${sign}${head}√${s.k}` : `${sign}${head}√${s.k}/${s.c.d}`
}

export function surdTex(s: Surd): string {
  if (s.k === 1 || s.c.n === 0) return ratTex(s.c)
  const sign = s.c.n < 0 ? '-' : ''
  const n = Math.abs(s.c.n)
  const head = `${n === 1 ? '' : n}\\sqrt{${s.k}}`
  return s.c.d === 1 ? `${sign}${head}` : `${sign}\\frac{${head}}{${s.c.d}}`
}

/**
 * v as ±c√k, recognised through its SQUARE (rational with a small denominator)
 * — the route for quantities computed from irrational coordinates.
 *
 * The square is matched at RAT_TOL and the surd is then checked against v
 * itself, so a tiny v (whose square is within any absolute window of 0) is
 * never "0", and nothing is accepted that does not reproduce v.
 */
export function surdOf(v: number): Surd | null {
  if (!Number.isFinite(v)) return null
  if (Math.abs(v) < ZERO_TOL) return { c: { n: 0, d: 1 }, k: 1 }
  const direct = toRat(v)
  if (direct) return { c: direct, k: 1 }
  const sq = toRat(v * v)
  if (!sq || sq.n === 0) return null
  const s = sqrtRat(sq)
  if (!s) return null
  const out = v < 0 ? { c: { n: -s.c.n, d: s.c.d }, k: s.k } : s
  return Math.abs(surdValue(out) - v) <= RAT_TOL * Math.max(1, Math.abs(v)) ? out : null
}

/**
 * A sum of rational multiples of square roots, written the way a class
 * writes it: over one denominator, a positive term first when there is one,
 * binary signs spaced — "9 − 2√5", "(√3 − 1)/2", "−1 − √2", "3√5/2".
 */
export function formatSurdTerms(terms: readonly Surd[]): { text: string; tex: string } | null {
  const live = terms.filter((t) => t.c.n !== 0)
  if (live.length === 0) return { text: '0', tex: '0' }
  let L = 1
  for (const t of live) {
    L = (L / gcd(L, t.c.d)) * t.c.d
    if (!safe(L)) return null
  }
  const ordered = [...live].sort((a, b) => a.k - b.k)
  if (ordered[0].c.n < 0) {
    const i = ordered.findIndex((t) => t.c.n > 0)
    if (i > 0) ordered.unshift(...ordered.splice(i, 1))
  }
  const nums = ordered.map((t) => ({ n: (t.c.n * L) / t.c.d, k: t.k }))
  if (!nums.every((t) => safe(t.n))) return null
  const head = (n: number, k: number): string => (k === 1 ? String(n) : `${n === 1 ? '' : n}√${k}`)
  const headTex = (n: number, k: number): string => (k === 1 ? String(n) : `${n === 1 ? '' : n}\\sqrt{${k}}`)
  let text = ''
  let tex = ''
  nums.forEach((t, i) => {
    const a = Math.abs(t.n)
    if (i === 0) {
      text = `${t.n < 0 ? MINUS : ''}${head(a, t.k)}`
      tex = `${t.n < 0 ? '-' : ''}${headTex(a, t.k)}`
    } else {
      text += ` ${t.n < 0 ? MINUS : '+'} ${head(a, t.k)}`
      tex += ` ${t.n < 0 ? '-' : '+'} ${headTex(a, t.k)}`
    }
  })
  if (L === 1) return { text, tex }
  if (nums.length === 1) {
    const neg = nums[0].n < 0
    const body = headTex(Math.abs(nums[0].n), nums[0].k)
    return { text: `${text}/${L}`, tex: `${neg ? '-' : ''}\\frac{${body}}{${L}}` }
  }
  return { text: `(${text})/${L}`, tex: `\\frac{${tex}}{${L}}` }
}

// ---------------------------------------------------------------------------
// A measured number: exact when it can be, a decimal (with ≈) when not
// ---------------------------------------------------------------------------

export interface Measure {
  value: number
  /** "√13", "5/2", or a decimal "4.12" when no exact form exists. */
  text: string
  tex: string
  /** True when text/tex are exact. */
  exact: boolean
  /** The decimal to 2 places, for "≈ 3.61" beside an irrational or fractional value. */
  approx: string
  /** For an exact SUM of surds ("9 − 2√5"): its terms, so it can be negated exactly. */
  terms?: Surd[]
}

/** Superscript digits, for "× 10¹⁶". */
const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' }

/** v in scientific notation, 3 significant figures: "2 × 10¹⁶", "7.07 × 10⁻⁸". */
export function sciText(v: number): string {
  const [m, e] = v.toExponential(2).split('e')
  const mant = String(Number(m)).replace('-', MINUS)
  const exp = String(Number(e)).split('').map((ch) => SUP[ch] ?? ch).join('')
  return `${mant} × 10${exp}`
}

/** Past this a decimal's digits are rounding, not a measurement: written in scientific notation. */
const BIG_DEC = 1e12

/** A decimal, trimmed: dec(2.50, 2) = "2.5", dec(-0.004, 2) = "0"; 2e16 is "2 × 10¹⁶". */
export function dec(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '—'
  if (Math.abs(v) >= BIG_DEC) return sciText(v)
  const f = 10 ** digits
  let r = Math.round(v * f) / f
  if (Object.is(r, -0) || Math.abs(r) < 0.5 / f) r = 0
  const s = String(r)
  return s.startsWith('-') ? `${MINUS}${s.slice(1)}` : s
}

export function measureOfSurd(s: Surd): Measure {
  const value = surdValue(s)
  return { value, text: surdText(s), tex: surdTex(s), exact: true, approx: dec(value, 2) }
}

/**
 * A decimal measure. A value that is not 0 but rounds to it is given in
 * significant figures instead ("0.0012", "7.07 × 10⁻⁸"): "≈ 0" for the
 * circumradius of a triangle 10⁻⁷ across says nothing.
 */
export function decimalMeasure(v: number, digits = 2): Measure {
  let t = dec(v, digits)
  if (t === '0' && v !== 0 && Number.isFinite(v)) {
    t = Math.abs(v) >= 1e-4 ? dec(Number(v.toPrecision(2)), 6) : sciText(v)
  }
  return { value: v, text: t, tex: texOfDec(t), exact: false, approx: t }
}

/** "7.07 × 10⁻⁸" → "7.07 \times 10^{-8}"; "−2.5" → "-2.5". */
function texOfDec(t: string): string {
  const m = /^(.*) × 10([⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+)$/.exec(t)
  if (!m) return t.replace(MINUS, '-')
  const back: Record<string, string> = {}
  for (const [k, v] of Object.entries(SUP)) back[v] = k
  const e = m[2].split('').map((ch) => back[ch] ?? ch).join('')
  return `${m[1].replace(MINUS, '-')} \\times 10^{${e}}`
}

/**
 * exactForm's (a ± b√n)/c in the house style: the positive term first and
 * the binary sign spaced — "(√3 − 1)/2", not "(−1+√3)/2", which reads as a
 * double sign after a minus.
 */
function tidyQuad(text: string): { text: string; tex: string; terms: Surd[] } | null {
  const m = /^\(?(−?\d+)([+−])(\d*)√(\d+)\)?(?:\/(\d+))?$/.exec(text)
  if (!m) return null
  const a = Number(m[1].replace(MINUS, '-'))
  const b = (m[3] === '' ? 1 : Number(m[3])) * (m[2] === '+' ? 1 : -1)
  const n = Number(m[4])
  const c = m[5] ? Number(m[5]) : 1
  const ra = rat(a, c)
  const rb = rat(b, c)
  if (!ra || !rb) return null
  const terms = [{ c: ra, k: 1 }, { c: rb, k: n }]
  const f = formatSurdTerms(terms)
  return f ? { ...f, terms } : null
}

/** The measure of a sum of surds, or null when it cannot be written. */
export function measureOfTerms(terms: readonly Surd[], value: number): Measure | null {
  const live = terms.filter((t) => t.c.n !== 0)
  if (live.length <= 1) return measureOfSurd(live[0] ?? { c: { n: 0, d: 1 }, k: 1 })
  const f = formatSurdTerms(live)
  return f ? { value, text: f.text, tex: f.tex, exact: true, approx: dec(value, 2), terms: [...live] } : null
}

/** −m, exactly: a sum is negated term by term ("9 − 2√5" → "2√5 − 9"), not by dropping its first sign. */
export function negMeasure(m: Measure): Measure {
  if (m.exact && m.terms && m.terms.length > 1) {
    const neg = measureOfTerms(m.terms.map((t) => ({ c: { n: -t.c.n || 0, d: t.c.d }, k: t.k })), -m.value)
    if (neg) return neg
  }
  if (isSum(m.text)) return measureOf(-m.value)
  if (m.text.startsWith(MINUS)) return { ...m, value: -m.value, text: m.text.slice(1), tex: m.tex.replace(/^-/, ''), approx: dec(-m.value, 2) }
  if (m.value === 0) return m
  return { ...m, value: -m.value, text: `${MINUS}${m.text}`, tex: `-${m.tex}`, approx: dec(-m.value, 2) }
}

/** Is this text a sum ("√3 − 1"), as opposed to a single signed term ("−√3/2")? */
export const isSum = (t: string): boolean => /.[−+]/.test(t.replace(/^\(/, ''))

/**
 * A measure of a value with no algebra behind it: recognised, else a decimal.
 *
 * In order: a fraction (RAT_TOL), then exactForm — which charges a
 * complicated form for its complexity, so a junk surd cannot beat a clean
 * closed form — then a surd recognised through its square, each checked
 * against v at RAT_TOL. Anything else is a decimal, shown with "≈".
 */
export function measureOf(v: number): Measure {
  if (!Number.isFinite(v)) return decimalMeasure(v)
  if (Math.abs(v) < ZERO_TOL) return measureOfSurd({ c: { n: 0, d: 1 }, k: 1 })
  const r = toRat(v)
  if (r) return measureOfSurd({ c: r, k: 1 })
  const ef = exactForm(v, { tol: RAT_TOL })
  if (ef && !/π/.test(ef.text)) {
    const tidy = tidyQuad(ef.text)
    if (tidy) return { value: v, text: tidy.text, tex: tidy.tex, exact: true, approx: dec(v, 2), terms: tidy.terms }
    return { value: v, text: ef.text.replace(/-/g, MINUS), tex: ef.tex, exact: true, approx: dec(v, 2) }
  }
  const s = surdOf(v)
  if (s) return measureOfSurd(s)
  return decimalMeasure(v)
}

/** Does this measure deserve "≈ 3.61" beside it (a root or a fraction)? */
export const needsApprox = (m: Measure): boolean => m.exact && /[√/]/.test(m.text)

/** "√13 ≈ 3.61", "5", "≈ 4.12" — how a card states a measure in one go. */
export function withApprox(m: Measure): string {
  if (!m.exact) return `≈ ${m.text}`
  return needsApprox(m) ? `${m.text} ≈ ${m.approx}` : m.text
}

// ---------------------------------------------------------------------------
// Points, as numbers and (when they are) as fractions
// ---------------------------------------------------------------------------

interface QPt {
  x: number
  y: number
  rx: Rat | null
  ry: Rat | null
}

const qpt = (p: Vec2): QPt => ({ x: p.x, y: p.y, rx: toRat(p.x), ry: toRat(p.y) })

const finitePt = (p: Vec2 | undefined | null): p is Vec2 =>
  !!p && Number.isFinite(p.x) && Number.isFinite(p.y)

/** |AB|² exactly when the coordinates are fractions, else recognised, else null. */
function dist2Rat(a: QPt, b: QPt): Rat | null {
  if (a.rx && a.ry && b.rx && b.ry) {
    const dx = ratSub(b.rx, a.rx)
    const dy = ratSub(b.ry, a.ry)
    const r = ratAdd(ratMul(dx, dx), ratMul(dy, dy))
    if (r) return r
  }
  const d2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2
  return toRat(d2)
}

const dist2 = (a: Vec2, b: Vec2): number => (b.x - a.x) ** 2 + (b.y - a.y) ** 2

/** The length of AB: √13 (≈ 3.61), 5, or ≈ 4.12. */
export function distance(a: Vec2, b: Vec2): Measure {
  const qa = qpt(a)
  const qb = qpt(b)
  const s = sqrtRat(dist2Rat(qa, qb))
  if (s) return measureOfSurd(s)
  return decimalMeasure(Math.sqrt(dist2(a, b)))
}

/** One coordinate as a measure: exact fraction, recognised surd, or decimal. */
function coordMeasure(v: number, r: Rat | null): Measure {
  if (r) return measureOfSurd({ c: r, k: 1 })
  return measureOf(v)
}

export interface PointMeasure {
  pt: Vec2
  x: Measure
  y: Measure
  /** "(5/2, 3)" */
  text: string
  /** "\left(\frac{5}{2}, 3\right)" */
  tex: string
}

export function pointMeasure(pt: Vec2, rx: Rat | null, ry: Rat | null): PointMeasure {
  const x = coordMeasure(pt.x, rx)
  const y = coordMeasure(pt.y, ry)
  return { pt, x, y, text: `(${x.text}, ${y.text})`, tex: `\\left(${x.tex}, ${y.tex}\\right)` }
}

/** The midpoint of AB, exactly: ((x₁ + x₂)/2, (y₁ + y₂)/2). */
export function midpoint(a: Vec2, b: Vec2): PointMeasure {
  const qa = qpt(a)
  const qb = qpt(b)
  const half = { n: 1, d: 2 }
  const rx = ratMul(ratAdd(qa.rx, qb.rx), half)
  const ry = ratMul(ratAdd(qa.ry, qb.ry), half)
  return pointMeasure({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, rx, ry)
}

/** The other endpoint B of a segment whose midpoint is M and one end is A: B = 2M − A. */
export function endpointFrom(mid: Vec2, end: Vec2): PointMeasure {
  const qm = qpt(mid)
  const qa = qpt(end)
  const two = { n: 2, d: 1 }
  const rx = ratSub(ratMul(qm.rx, two), qa.rx)
  const ry = ratSub(ratMul(qm.ry, two), qa.ry)
  return pointMeasure({ x: 2 * mid.x - end.x, y: 2 * mid.y - end.y }, rx, ry)
}

/** "(4, −1)" — a point, its coordinates exact where they are. */
export function pointText(p: Vec2): PointMeasure {
  const q = qpt(p)
  return pointMeasure(p, q.rx, q.ry)
}

// ---------------------------------------------------------------------------
// Slope and the line through two points
// ---------------------------------------------------------------------------

export interface SlopeInfo {
  /** True for a vertical line: the slope is undefined. */
  vertical: boolean
  /** Infinity when vertical. */
  value: number
  /** The exact slope when it is a fraction. */
  rat: Rat | null
  /** "1/2", "−3", "0", "undefined" */
  text: string
  tex: string
  /** "1/2" or "≈ 0.58" or "undefined" — for running text. */
  words: string
}

const VERT_EPS = 1e-12

function slopeFromRat(r: Rat): SlopeInfo {
  return { vertical: false, value: ratValue(r), rat: r, text: ratText(r), tex: ratTex(r), words: ratText(r) }
}

function slopeFromValue(m: number): SlopeInfo {
  const ms = measureOf(m)
  return {
    vertical: false,
    value: m,
    rat: toRat(m),
    text: ms.text,
    tex: ms.tex,
    words: ms.exact ? ms.text : `≈ ${ms.text}`,
  }
}

export const VERTICAL: SlopeInfo = {
  vertical: true,
  value: Infinity,
  rat: null,
  text: 'undefined',
  tex: '\\text{undefined}',
  words: 'undefined',
}

/** The slope of AB, rise over run: exact as a fraction, "undefined" when vertical. */
export function slope(a: Vec2, b: Vec2): SlopeInfo {
  const qa = qpt(a)
  const qb = qpt(b)
  const span = Math.max(1, Math.abs(a.x), Math.abs(b.x), Math.abs(b.y - a.y))
  if (Math.abs(b.x - a.x) <= VERT_EPS * span) return VERTICAL
  if (qa.rx && qa.ry && qb.rx && qb.ry) {
    const r = ratDiv(ratSub(qb.ry, qa.ry), ratSub(qb.rx, qa.rx))
    if (r) return slopeFromRat(r)
  }
  return slopeFromValue((b.y - a.y) / (b.x - a.x))
}

/** The slope perpendicular to m: −1/m, 0 for vertical, undefined for horizontal. */
export function perpSlope(m: SlopeInfo): SlopeInfo {
  if (m.vertical) return slopeFromRat({ n: 0, d: 1 })
  if (Math.abs(m.value) < 1e-15) return VERTICAL
  if (m.rat) {
    const r = ratDiv({ n: -1, d: 1 }, m.rat)
    if (r) return slopeFromRat(r)
  }
  return slopeFromValue(-1 / m.value)
}

export interface LineEq {
  slope: SlopeInfo
  /** A point the line passes through. */
  through: Vec2
  /** "y = (1/2)x + 3/2", "x = 4" */
  slopeIntercept: { text: string; tex: string }
  /** "y − 1 = (1/2)(x − 4)", or "x = 4" for a vertical line */
  pointSlope: { text: string; tex: string }
  /** y-intercept (null when vertical). */
  intercept: Measure | null
}

/** "x − 4", "x + 2", "x" — the bracket of point-slope form. */
function shiftText(v: string, varName: string, value: number, m: Measure): { text: string; tex: string } {
  if (Math.abs(value) < 1e-12) return { text: varName, tex: varName }
  if (value < 0) {
    const n = negMeasure(m)
    return { text: `${v} + ${n.text}`, tex: `${v} + ${n.tex}` }
  }
  return isSum(m.text)
    ? { text: `${v} ${MINUS} (${m.text})`, tex: `${v} - \\left(${m.tex}\\right)` }
    : { text: `${v} ${MINUS} ${m.text}`, tex: `${v} - ${m.tex}` }
}

/**
 * Does a coefficient need brackets before a variable? A fraction, a decimal,
 * an approximation — or a SUM: "−1 − √2" glued to x reads as −1 − √2·x.
 * A leading sign is not a sum; a binary + or − anywhere after it is.
 */
export function needsBrackets(t: string): boolean {
  // one number, whole or decimal, is never bracketed: 3x, −0.64x
  if (/^[−-]?\d+(\.\d+)?$/.test(t)) return false
  return /[/≈.+]/.test(t) || /.[−-]/.test(t)
}

/** The TeX of a coefficient, bracketed when it is a sum (a fraction is one unit already). */
export function coefTex(tex: string): string {
  return /.[+-]/.test(tex.replace(/^\s*-/, '')) ? `\\left(${tex}\\right)` : tex
}

/** "(1/2)x", "−x", "3x", "√3x", "(−1 − √2)x" — the slope as a coefficient of x. */
function coefText(m: SlopeInfo): { text: string; tex: string } {
  if (m.rat && m.rat.d === 1 && Math.abs(m.rat.n) === 1) {
    return m.rat.n < 0 ? { text: `${MINUS}x`, tex: '-x' } : { text: 'x', tex: 'x' }
  }
  const t = m.text
  const wrap = needsBrackets(t) ? `(${t})` : t
  return { text: `${wrap}x`, tex: `${coefTex(m.tex)}x` }
}

/** The line through p with slope m, in both forms. */
export function lineThroughSlope(p: Vec2, m: SlopeInfo): LineEq {
  const q = qpt(p)
  if (m.vertical) {
    const xm = coordMeasure(p.x, q.rx)
    const rel = xm.exact ? '=' : '≈'
    const t = { text: `x ${rel} ${xm.text}`, tex: `x ${xm.exact ? '=' : '\\approx'} ${xm.tex}` }
    return { slope: m, through: p, slopeIntercept: t, pointSlope: t, intercept: null }
  }
  // b = y₁ − m·x₁
  const bRat = m.rat && q.rx && q.ry ? ratSub(q.ry, ratMul(m.rat, q.rx)) : null
  const bVal = p.y - m.value * p.x
  const b = bRat ? measureOfSurd({ c: bRat, k: 1 }) : measureOf(bVal)
  const isZeroM = m.rat ? m.rat.n === 0 : Math.abs(m.value) < 1e-15
  // a decimal anywhere makes the equation approximate, and it says so
  const mExact = !!m.rat || !/[≈.]/.test(m.text)
  const siExact = (isZeroM || mExact) && (b.exact || Math.abs(b.value) < 1e-12)
  const siRel = siExact ? '=' : '≈'
  const siRelTex = siExact ? '=' : '\\approx'
  let si: { text: string; tex: string }
  if (isZeroM) si = { text: `y ${siRel} ${b.text}`, tex: `y ${siRelTex} ${b.tex}` }
  else {
    const c = coefText(m)
    if (Math.abs(b.value) < 1e-12) si = { text: `y ${siRel} ${c.text}`, tex: `y ${siRelTex} ${c.tex}` }
    else {
      const neg = b.value < 0
      const mag = neg ? negMeasure(b) : b
      // a sum keeps its own signs: y = 2x + √3 − 1, y = 2x − 1 − √2
      const op = neg && !isSum(mag.text) ? MINUS : neg ? MINUS : '+'
      const term = neg && isSum(mag.text) ? `(${mag.text})` : mag.text
      const termTex = neg && isSum(mag.text) ? `\\left(${mag.tex}\\right)` : mag.tex
      si = { text: `y ${siRel} ${c.text} ${op} ${term}`, tex: `y ${siRelTex} ${c.tex} ${op === '+' ? '+' : '-'} ${termTex}` }
    }
  }
  // y − y₁ = m(x − x₁)
  const ym = coordMeasure(p.y, q.ry)
  const xm = coordMeasure(p.x, q.rx)
  const left = shiftText('y', 'y', p.y, ym)
  const right = shiftText('x', 'x', p.x, xm)
  const psExact = (isZeroM || mExact) && ym.exact && xm.exact
  const psRel = psExact ? '=' : '≈'
  const psRelTex = psExact ? '=' : '\\approx'
  let ps: { text: string; tex: string }
  if (isZeroM) ps = { text: `${left.text} ${psRel} 0`, tex: `${left.tex} ${psRelTex} 0` }
  else {
    const one = m.rat && m.rat.d === 1 && Math.abs(m.rat.n) === 1
    const mt = one ? (m.rat!.n < 0 ? MINUS : '') : needsBrackets(m.text) ? `(${m.text})` : m.text
    const mtex = one ? (m.rat!.n < 0 ? '-' : '') : coefTex(m.tex)
    const rt = Math.abs(p.x) < 1e-12 ? 'x' : `(${right.text})`
    const rtex = Math.abs(p.x) < 1e-12 ? 'x' : `\\left(${right.tex}\\right)`
    ps = { text: `${left.text} ${psRel} ${mt}${rt}`, tex: `${left.tex} ${psRelTex} ${mtex}${rtex}` }
  }
  return { slope: m, through: p, slopeIntercept: si, pointSlope: ps, intercept: b }
}

/** The line through A and B. Point-slope form is written at A. */
export function lineThrough(a: Vec2, b: Vec2): LineEq {
  return lineThroughSlope(a, slope(a, b))
}

// ---------------------------------------------------------------------------
// Parallel and perpendicular
// ---------------------------------------------------------------------------

export type Relation = 'parallel' | 'perpendicular' | 'same' | 'neither'

const REL_TOL = 1e-9

/** How line AB stands to line CD: parallel, perpendicular, the same line, or neither. */
export function relation(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Relation {
  const ux = a2.x - a1.x
  const uy = a2.y - a1.y
  const vx = b2.x - b1.x
  const vy = b2.y - b1.y
  const lu = Math.hypot(ux, uy)
  const lv = Math.hypot(vx, vy)
  if (!(lu > 0) || !(lv > 0)) return 'neither'
  const cross = ux * vy - uy * vx
  if (Math.abs(cross) <= REL_TOL * lu * lv) {
    // same direction: is C on line AB?
    const off = ux * (b1.y - a1.y) - uy * (b1.x - a1.x)
    return Math.abs(off) <= REL_TOL * lu * Math.max(1, Math.hypot(b1.x - a1.x, b1.y - a1.y)) ? 'same' : 'parallel'
  }
  if (Math.abs(ux * vx + uy * vy) <= REL_TOL * lu * lv) return 'perpendicular'
  return 'neither'
}

/** "slope 1/2", "slope 0", "undefined slope" */
export function slopePhrase(m: SlopeInfo): string {
  return m.vertical ? 'undefined slope' : `slope ${m.words}`
}

/**
 * Why two lines are perpendicular, in slope terms: "their slopes 3/4 and −4/3
 * multiply to −1", or "one is horizontal and the other vertical".
 */
export function perpReason(m1: SlopeInfo, m2: SlopeInfo, n1?: string, n2?: string): string {
  if (m1.vertical || m2.vertical) {
    if (n1 && n2) return m1.vertical ? `${n1} is vertical and ${n2} is horizontal` : `${n1} is horizontal and ${n2} is vertical`
    return m1.vertical ? 'the first is vertical and the second horizontal' : 'the first is horizontal and the second vertical'
  }
  return `their slopes ${m1.words} and ${m2.words} multiply to ${MINUS}1`
}

// ---------------------------------------------------------------------------
// Perimeter and area
// ---------------------------------------------------------------------------

/** Σ of surds with like radicals collected: 2√10 + 2√17; null if any term is inexact. */
function sumSurds(terms: readonly (Surd | null)[]): { text: string; tex: string; value: number } | null {
  const by = new Map<number, Rat>()
  for (const t of terms) {
    if (!t) return null
    const had = by.get(t.k) ?? { n: 0, d: 1 }
    const next = ratAdd(had, t.c)
    if (!next) return null
    by.set(t.k, next)
  }
  const ks = [...by.keys()].sort((a, b) => a - b)
  const parts = ks.map((k) => ({ c: by.get(k)!, k })).filter((s) => s.c.n !== 0)
  if (parts.length === 0) return { text: '0', tex: '0', value: 0 }
  let text = ''
  let tex = ''
  let value = 0
  parts.forEach((s, i) => {
    value += surdValue(s)
    const neg = s.c.n < 0
    const abs = { c: { n: Math.abs(s.c.n), d: s.c.d }, k: s.k }
    if (i === 0) {
      text = surdText(s)
      tex = surdTex(s)
    } else {
      text += ` ${neg ? MINUS : '+'} ${surdText(abs)}`
      tex += ` ${neg ? '-' : '+'} ${surdTex(abs)}`
    }
  })
  return { text, tex, value }
}

/** The perimeter, exact when every side is: 2√10 + 2√17 (≈ 14.57). */
export function perimeter(pts: readonly Vec2[], closed = true): Measure {
  const n = pts.length
  const surds: (Surd | null)[] = []
  let total = 0
  const edges = closed ? n : n - 1
  for (let i = 0; i < edges; i++) {
    const a = qpt(pts[i])
    const b = qpt(pts[(i + 1) % n])
    surds.push(sqrtRat(dist2Rat(a, b)))
    total += Math.sqrt(dist2(pts[i], pts[(i + 1) % n]))
  }
  const sum = sumSurds(surds)
  if (sum) return { value: sum.value, text: sum.text, tex: sum.tex, exact: true, approx: dec(sum.value, 2) }
  return decimalMeasure(total)
}

export interface AreaResult {
  /** The area (always ≥ 0). */
  area: Measure
  /** Twice the signed area: positive counter-clockwise. */
  signed2: number
  /** "½|0 + 11 + 11 + 0| = 11" — the shoelace working, one cross term per edge. */
  working: string
}

/** The area by the shoelace formula: ½|Σ (xᵢ·yᵢ₊₁ − xᵢ₊₁·yᵢ)|, exactly. */
export function shoelace(pts: readonly Vec2[]): AreaResult {
  const n = pts.length
  const qs = pts.map(qpt)
  let s2 = 0
  let exact: Rat | null = { n: 0, d: 1 }
  const termTexts: string[] = []
  for (let i = 0; i < n; i++) {
    const p = qs[i]
    const q = qs[(i + 1) % n]
    const t = p.x * q.y - q.x * p.y
    s2 += t
    const tr = p.rx && p.ry && q.rx && q.ry ? ratSub(ratMul(p.rx, q.ry), ratMul(q.rx, p.ry)) : null
    exact = tr ? ratAdd(exact, tr) : null
    termTexts.push(tr ? ratText(tr) : dec(t, 2))
  }
  const half = exact ? ratMul(exact, { n: 1, d: 2 }) : null
  const areaV = Math.abs(s2) / 2
  // a figure 10⁻⁷ across has an area of 10⁻¹⁵: a number, not an exact 0
  const tiny = areaV > 0 && Math.abs(areaV) < ZERO_TOL
  const area = half ? measureOfSurd({ c: { n: Math.abs(half.n), d: half.d }, k: 1 }) : tiny ? decimalMeasure(areaV) : measureOf(areaV)
  const sumText = termTexts
    .map((t, i) => (i === 0 ? t : t.startsWith(MINUS) ? `${MINUS} ${t.slice(1)}` : `+ ${t}`))
    .join(' ')
  const working = `½|${sumText}| = ${area.exact ? area.text : `≈ ${area.text}`}`
  return { area, signed2: s2, working }
}

// ---------------------------------------------------------------------------
// Angles
// ---------------------------------------------------------------------------

export interface AngleInfo {
  /** Interior angle in degrees (0, 360). */
  deg: number
  /** "90°", "36.9°", "22.5°" */
  text: string
  /** True when the degree count is exact (an integer or a half). */
  exact: boolean
  right: boolean
  /** Interior angle > 180°: a reflex vertex of a concave polygon. */
  reflex: boolean
}

const ANGLE_EPS = 1e-7

/** Degrees as a class writes them: exact for special angles, else one decimal. */
export function degText(deg: number): { text: string; exact: boolean } {
  const twice = Math.round(deg * 2)
  if (Math.abs(deg * 2 - twice) < ANGLE_EPS * 2) {
    const v = twice / 2
    return { text: `${Number.isInteger(v) ? v : v.toFixed(1)}°`, exact: true }
  }
  // one decimal always: an inexact 36.04° must not print as the exact-looking
  // "36°", nor 179.99999977° as "180°"
  const t = dec(deg, 1)
  return { text: `${t.includes('.') ? t : `${t}.0`}°`, exact: false }
}

/** Twice the signed area: > 0 counter-clockwise. */
export function signedArea2(pts: readonly Vec2[]): number {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    s += p.x * q.y - q.x * p.y
  }
  return s
}

/** The angle at B in triangle ABC (degrees, 0…180). */
export function angleAt(a: Vec2, b: Vec2, c: Vec2): number {
  const ux = a.x - b.x
  const uy = a.y - b.y
  const vx = c.x - b.x
  const vy = c.y - b.y
  return (Math.atan2(Math.abs(ux * vy - uy * vx), ux * vx + uy * vy) * 180) / Math.PI
}

/**
 * Every interior angle, from the polygon's own orientation — so a concave
 * vertex reads 270°, not 90°, however the polygon was typed.
 */
export function interiorAngles(pts: readonly Vec2[]): AngleInfo[] {
  const n = pts.length
  const orient = signedArea2(pts) >= 0 ? 1 : -1
  const out: AngleInfo[] = []
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]
    const cur = pts[i]
    const next = pts[(i + 1) % n]
    const base = angleAt(prev, cur, next)
    // turn at cur: cross of (cur − prev) and (next − cur); a turn against the
    // polygon's orientation is a reflex vertex
    const turn = (cur.x - prev.x) * (next.y - cur.y) - (cur.y - prev.y) * (next.x - cur.x)
    const reflex = turn * orient < -1e-12 * Math.max(1, Math.abs(turn))
    const deg = reflex ? 360 - base : base
    const t = degText(deg)
    out.push({ deg, text: t.text, exact: t.exact, right: Math.abs(deg - 90) < ANGLE_EPS, reflex })
  }
  return out
}

// ---------------------------------------------------------------------------
// The polygon's sides, compared
// ---------------------------------------------------------------------------

export interface SideInfo {
  /** "AB" */
  name: string
  from: number
  to: number
  length: Measure
  /** |side|² exactly, when known — the honest test for "equal". */
  len2: Rat | null
  slope: SlopeInfo
  midpoint: PointMeasure
}

/** Vertex names: the labels typed, else A, B, C… in the order typed. */
export function vertexNames(n: number, labels?: readonly string[] | null): string[] {
  const out: string[] = []
  const used = new Set<string>()
  for (let i = 0; i < n; i++) {
    const own = labels?.[i]
    if (own && !used.has(own)) {
      out.push(own)
      used.add(own)
      continue
    }
    let k = i
    let name = String.fromCharCode(65 + (k % 26))
    while (used.has(name)) {
      k++
      name = String.fromCharCode(65 + (k % 26)) + (k >= 26 ? String(Math.floor(k / 26)) : '')
    }
    out.push(name)
    used.add(name)
  }
  return out
}

export function sidesOf(pts: readonly Vec2[], names: readonly string[], closed = true): SideInfo[] {
  const n = pts.length
  const out: SideInfo[] = []
  const edges = closed ? n : n - 1
  for (let i = 0; i < edges; i++) {
    const j = (i + 1) % n
    const a = pts[i]
    const b = pts[j]
    out.push({
      name: `${names[i]}${names[j]}`,
      from: i,
      to: j,
      length: distance(a, b),
      len2: dist2Rat(qpt(a), qpt(b)),
      slope: slope(a, b),
      midpoint: midpoint(a, b),
    })
  }
  return out
}

/** Two sides equal in length — exactly when both squares are known. */
export function sameLength(a: SideInfo, b: SideInfo): boolean {
  if (a.len2 && b.len2) return ratEq(a.len2, b.len2)
  const x = a.length.value
  const y = b.length.value
  return Math.abs(x - y) <= 1e-9 * Math.max(1, x, y)
}

/**
 * Groups of equal values, for congruence marks: group[i] is 1, 2, 3… for a
 * member of the 1st, 2nd, 3rd group of two or more equals, and 0 for a value
 * equal to nothing else. Groups are numbered in order of first appearance.
 */
export function equalGroups<T>(items: readonly T[], eq: (a: T, b: T) => boolean, skip?: (t: T, i: number) => boolean): number[] {
  const group = items.map(() => 0)
  let next = 1
  for (let i = 0; i < items.length; i++) {
    if (group[i] !== 0 || skip?.(items[i], i)) continue
    const members = [i]
    for (let j = i + 1; j < items.length; j++) {
      if (group[j] === 0 && !skip?.(items[j], j) && eq(items[i], items[j])) members.push(j)
    }
    if (members.length >= 2) {
      for (const m of members) group[m] = next
      next++
    }
  }
  return group
}

const sameAngle = (a: AngleInfo, b: AngleInfo): boolean => Math.abs(a.deg - b.deg) < 1e-7

/** Do two closed edges (i, j) cross, other than at a shared vertex? */
function segmentsCross(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): boolean {
  const o = (a: Vec2, b: Vec2, c: Vec2): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  const d1 = o(q1, q2, p1)
  const d2 = o(q1, q2, p2)
  const d3 = o(p1, p2, q1)
  const d4 = o(p1, p2, q2)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/** A polygon whose edges cross itself (a bow-tie) has no interior to classify. */
export function isSelfIntersecting(pts: readonly Vec2[]): boolean {
  const n = pts.length
  if (n < 4) return false
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue
      if (segmentsCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true
    }
  }
  return false
}

/** The figure's size: its longest side (0 when every vertex is one point). */
function figureScale(pts: readonly Vec2[]): number {
  let L = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    L = Math.max(L, Math.hypot(b.x - a.x, b.y - a.y))
  }
  return L
}

/**
 * The first vertex that is not a corner: it lies on the line through its two
 * neighbours (a straight angle, B on AC; or a spike, where the boundary
 * turns straight back). −1 when every vertex is a corner. Relative to the
 * two sides there, so a triangle 10⁻⁷ across is as much a triangle as one
 * 10 across.
 */
export function straightVertex(pts: readonly Vec2[]): number {
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const p = pts[(i - 1 + n) % n]
    const c = pts[i]
    const q = pts[(i + 1) % n]
    const ux = c.x - p.x
    const uy = c.y - p.y
    const vx = q.x - c.x
    const vy = q.y - c.y
    const lu = Math.hypot(ux, uy)
    const lv = Math.hypot(vx, vy)
    if (!(lu > 0) || !(lv > 0)) continue
    if (Math.abs(ux * vy - uy * vx) <= 1e-10 * lu * lv) return i
  }
  return -1
}

/** Two consecutive vertices in one place: the index of the first, else −1. */
function repeatedVertex(pts: readonly Vec2[]): number {
  const L = figureScale(pts)
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    if (!(L > 0) || Math.hypot(b.x - a.x, b.y - a.y) <= 1e-12 * L) return i
  }
  return -1
}

/** Three consecutive vertices on one line, or two vertices in one place. */
export function isDegenerate(pts: readonly Vec2[]): boolean {
  const n = pts.length
  if (n < 3) return true
  const L = figureScale(pts)
  if (!(L > 0)) return true
  if (repeatedVertex(pts) >= 0) return true
  if (Math.abs(signedArea2(pts)) <= 1e-12 * L * L) return true
  return straightVertex(pts) >= 0
}

/**
 * Why a polygon is degenerate, in words: "B lies on AC, so ABCD is really
 * the triangle ACD", "A and B are the same point", "the vertices are
 * collinear". `fig` is the polygon's own name ("ABCD").
 */
export function degenerateWhy(pts: readonly Vec2[], names: readonly string[], fig: string): { sentence: string; short: string; because: string } {
  const n = pts.length
  const rep = repeatedVertex(pts)
  if (rep >= 0) {
    const a = names[rep]
    const b = names[(rep + 1) % n]
    return {
      sentence: `${a} and ${b} are the same point, so ${fig} is degenerate.`,
      short: `${fig}: ${a} = ${b}`,
      because: `${a} and ${b} coincide`,
    }
  }
  const L = figureScale(pts)
  const st = straightVertex(pts)
  if (st >= 0 && !(L > 0 && Math.abs(signedArea2(pts)) <= 1e-12 * L * L)) {
    const p = (st - 1 + n) % n
    const q = (st + 1) % n
    const [P, C, Q] = [pts[p], pts[st], pts[q]]
    const on = (C.x - P.x) * (Q.x - C.x) + (C.y - P.y) * (Q.y - C.y) > 0
    const rest = names.filter((_v, i) => i !== st)
    const kinds: Record<number, string> = { 3: 'triangle', 4: 'quadrilateral', 5: 'pentagon', 6: 'hexagon', 7: 'heptagon', 8: 'octagon' }
    const really = rest.join('')
    const what = kinds[rest.length] ?? `${rest.length}-gon`
    if (on) {
      return {
        sentence: `${names[st]} lies on ${names[p]}${names[q]} (∠${names[st]} = 180°), so ${fig} is really the ${what} ${really}, not a ${n === 4 ? 'quadrilateral' : (kinds[n] ?? `${n}-gon`)}.`,
        short: `${fig}: ${names[st]} lies on ${names[p]}${names[q]}`,
        because: `${names[st]} lies on ${names[p]}${names[q]}`,
      }
    }
    return {
      sentence: `${names[p]}${names[st]} and ${names[st]}${names[q]} overlap (the boundary turns straight back at ${names[st]}), so ${fig} is degenerate.`,
      short: `${fig}: ${names[p]}${names[st]} and ${names[st]}${names[q]} overlap`,
      because: `the sides at ${names[st]} overlap`,
    }
  }
  return {
    sentence: `The vertices of ${fig} all lie on one line, so it has no area and is degenerate.`,
    short: `${fig}: collinear vertices`,
    because: 'its vertices are collinear',
  }
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export interface Classification {
  /** The most specific name: "parallelogram", "right isosceles triangle". */
  name: string
  /** Everything else it also is, most specific first: ["rectangle", "rhombus", …]. */
  also: string[]
  /** The full reason, in slope and length terms. */
  sentence: string
  /** A short version for the board chip. */
  short: string
  /** The justification without the name, for the board's second line. */
  because: string
}

const article = (w: string): string => (/^[aeiou]/i.test(w) ? `an ${w}` : `a ${w}`)

/** "a rectangle, a rhombus and a parallelogram" */
export function listWords(words: readonly string[]): string {
  const a = words.map(article)
  if (a.length <= 1) return a.join('')
  return `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`
}

function withAlso(sentence: string, also: readonly string[]): string {
  return also.length === 0 ? sentence : `${sentence} It is also ${listWords(also)}.`
}

/** "AB ⊥ BC" justification for the right angle at vertex i of a polygon. */
function perpAt(sides: readonly SideInfo[], i: number): string {
  const n = sides.length
  const before = sides[(i - 1 + n) % n]
  const after = sides[i]
  return `${before.name} ⊥ ${after.name} (${perpReason(before.slope, after.slope, before.name, after.name)})`
}

export function classifyTriangle(pts: readonly Vec2[], names: readonly string[]): Classification {
  const tri = names.join('')
  if (isDegenerate(pts)) {
    return {
      name: 'degenerate triangle',
      also: [],
      sentence: `The three points are collinear, so ${tri} is not a triangle.`,
      short: `${tri}: collinear points`,
      because: 'the three points are collinear',
    }
  }
  const sides = sidesOf(pts, names)
  const angles = interiorAngles(pts)
  const [ab, bc, ca] = sides
  const eqAB_BC = sameLength(ab, bc)
  const eqBC_CA = sameLength(bc, ca)
  const eqCA_AB = sameLength(ca, ab)
  let bySides: 'equilateral' | 'isosceles' | 'scalene'
  let sideWhy: string
  let sideShort: string
  if (eqAB_BC && eqBC_CA) {
    bySides = 'equilateral'
    sideWhy = `all three sides are ${ab.length.text}`
    sideShort = `${ab.name} = ${bc.name} = ${ca.name}`
  } else if (eqAB_BC || eqBC_CA || eqCA_AB) {
    bySides = 'isosceles'
    const [p, q] = eqAB_BC ? [ab, bc] : eqBC_CA ? [bc, ca] : [ca, ab]
    sideWhy = `${p.name} = ${q.name} = ${p.length.text}`
    sideShort = `${p.name} = ${q.name}`
  } else {
    bySides = 'scalene'
    sideWhy = `no two sides are equal (${sides.map((s) => `${s.name} = ${s.length.exact ? s.length.text : `≈ ${s.length.text}`}`).join(', ')})`
    sideShort = 'no equal sides'
  }
  const rightAt = angles.findIndex((a) => a.right)
  const obtuseAt = angles.findIndex((a) => a.deg > 90 + ANGLE_EPS)
  let byAngles: 'right' | 'obtuse' | 'acute'
  let angleWhy: string
  let angleShort: string
  if (rightAt >= 0) {
    byAngles = 'right'
    angleWhy = `${perpAt(sides, rightAt)}, so ∠${names[rightAt]} = 90°`
    const n = sides.length
    angleShort = `${sides[(rightAt - 1 + n) % n].name} ⊥ ${sides[rightAt].name}`
  } else if (obtuseAt >= 0) {
    byAngles = 'obtuse'
    angleWhy = `∠${names[obtuseAt]} = ${angles[obtuseAt].text} is obtuse`
    angleShort = `∠${names[obtuseAt]} = ${angles[obtuseAt].text} > 90°`
  } else {
    byAngles = 'acute'
    angleWhy = `every angle is less than 90° (${angles.map((a, i) => `∠${names[i]} = ${a.text}`).join(', ')})`
    angleShort = 'every angle < 90°'
  }
  const name = bySides === 'equilateral' ? 'equilateral triangle' : `${byAngles} ${bySides} triangle`
  const also: string[] = []
  if (bySides === 'equilateral') also.push('acute triangle', 'isosceles triangle')
  const because = `${angleShort}; ${sideShort}`
  const sentence = withAlso(`${capital(angleWhy)}; ${sideWhy}. So △${tri} is ${article(name)}.`, also)
  return { name, also, sentence, short: `△${tri}: ${name}`, because }
}

const capital = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** "AB ‖ DC (slope 1/4)" */
function parText(s1: string, s2: string, m: SlopeInfo): string {
  return `${s1} ‖ ${s2} (${m.vertical ? 'both vertical' : `slope ${m.words}`})`
}

/** The side between vertices i and j, named in that direction. */
const named = (names: readonly string[], i: number, j: number): string => `${names[i]}${names[j]}`

export function classifyQuadrilateral(pts: readonly Vec2[], names: readonly string[]): Classification {
  const q = names.join('')
  if (isDegenerate(pts) && !isSelfIntersecting(pts)) {
    return { name: 'degenerate quadrilateral', also: [], ...degenerateWhy(pts, names, q) }
  }
  if (isSelfIntersecting(pts)) {
    return {
      name: 'crossed quadrilateral',
      also: [],
      sentence: `Two sides of ${q} cross each other, so it is a crossed (self-intersecting) quadrilateral, not a simple one.`,
      short: `${q}: crossed quadrilateral`,
      because: 'two of its sides cross',
    }
  }
  const sides = sidesOf(pts, names)
  const [ab, bc, cd, da] = sides
  const angles = interiorAngles(pts)
  const AB = named(names, 0, 1)
  const DC = named(names, 3, 2)
  const AD = named(names, 0, 3)
  const BC = named(names, 1, 2)
  const par1 = relation(pts[0], pts[1], pts[3], pts[2]) === 'parallel'
  const par2 = relation(pts[0], pts[3], pts[1], pts[2]) === 'parallel'
  const allEqual = sameLength(ab, bc) && sameLength(bc, cd) && sameLength(cd, da)
  const rightB = angles[1].right
  const perpABBC = `${AB} ⊥ ${BC} (${perpReason(ab.slope, bc.slope, AB, BC)})`

  if (par1 && par2) {
    const pars = `${parText(AB, DC, ab.slope)} and ${parText(AD, BC, da.slope)}`
    if (allEqual && rightB) {
      const why = `${pars}, all four sides are ${ab.length.text}, and ${perpABBC}`
      return done('square', ['rectangle', 'rhombus', 'parallelogram', 'kite'], why, `${pars}; sides ${ab.length.text}; ${AB} ⊥ ${BC}`)
    }
    if (rightB) {
      const why = `${pars}, and ${perpABBC}`
      return done('rectangle', ['parallelogram'], why, `${pars}; ${AB} ⊥ ${BC}`)
    }
    if (allEqual) {
      const why = `${pars}, and all four sides are ${ab.length.text}`
      return done('rhombus', ['parallelogram', 'kite'], why, `${pars}; sides ${ab.length.text}`)
    }
    return done('parallelogram', [], pars, pars)
  }
  if (par1 || par2) {
    // bases and legs
    const [b1, b2, m] = par1 ? [AB, DC, ab.slope] : [AD, BC, da.slope]
    const [l1, l2, legA, legB] = par1 ? [AD, BC, da, bc] : [AB, DC, ab, cd]
    const legsNot = `${l1} ∦ ${l2} (${l1Slope(legA)} and ${l1Slope(legB)})`
    const base = `${parText(b1, b2, m)} but ${legsNot}`
    if (sameLength(legA, legB)) {
      const why = `${base}, and the legs ${l1} = ${l2} = ${legA.length.text}`
      return done('isosceles trapezoid', ['trapezoid'], why, `${parText(b1, b2, m)}; ${l1} = ${l2}`)
    }
    const legPerp = relation(pts[legA.from], pts[legA.to], pts[par1 ? 0 : 0], pts[par1 ? 1 : 3]) === 'perpendicular' ||
      relation(pts[legB.from], pts[legB.to], pts[par1 ? 3 : 1], pts[par1 ? 2 : 2]) === 'perpendicular'
    if (legPerp) {
      const why = `${base}, and a leg is perpendicular to the bases`
      return done('right trapezoid', ['trapezoid'], why, `${parText(b1, b2, m)}; a leg ⊥ the bases`)
    }
    return done('trapezoid', [], base, parText(b1, b2, m))
  }
  // kites: two distinct pairs of adjacent equal sides
  const kiteAt = (v: number): boolean => {
    // the sides meeting at v equal, and the two at the opposite vertex equal
    const s1 = sides[(v + 3) % 4]
    const s2 = sides[v]
    const o1 = sides[(v + 1) % 4]
    const o2 = sides[(v + 2) % 4]
    return sameLength(s1, s2) && sameLength(o1, o2)
  }
  const kv = [0, 1].find((v) => kiteAt(v))
  if (kv !== undefined) {
    const v = kv
    const w = (v + 2) % 4
    const p1 = named(names, v, (v + 1) % 4)
    const p2 = named(names, v, (v + 3) % 4)
    const o1 = named(names, w, (w + 1) % 4)
    const o2 = named(names, w, (w + 3) % 4)
    const L1 = sides[v].length.text
    const L2 = sides[(v + 1) % 4].length.text
    const why = `${p1} = ${p2} = ${L1} and ${o1} = ${o2} = ${L2} — two pairs of adjacent equal sides — and no sides are parallel`
    return done('kite', [], why, `${p1} = ${p2}; ${o1} = ${o2}`)
  }
  return done(
    'quadrilateral',
    [],
    'no sides are parallel and no two pairs of adjacent sides are equal',
    'no parallel sides, no equal adjacent pairs',
    true,
  )

  function done(name: string, also: string[], why: string, short: string, plain = false): Classification {
    const sentence = plain
      ? `${capital(why)}, so ${q} is a quadrilateral with no special name.`
      : withAlso(`${capital(why)}, so ${q} is ${article(name)}.`, also)
    return { name, also, sentence, short: plain ? `${q}: quadrilateral` : `${q}: ${name}`, because: short }
  }
}

function l1Slope(s: SideInfo): string {
  return s.slope.vertical ? 'undefined slope' : `slope ${s.slope.words}`
}

const POLY_NAMES: Record<number, string> = {
  5: 'pentagon',
  6: 'hexagon',
  7: 'heptagon',
  8: 'octagon',
  9: 'nonagon',
  10: 'decagon',
  12: 'dodecagon',
}

export function classifyPolygon(pts: readonly Vec2[], names: readonly string[]): Classification {
  if (pts.length === 3) return classifyTriangle(pts, names)
  if (pts.length === 4) return classifyQuadrilateral(pts, names)
  const nm = names.join('')
  const base = POLY_NAMES[pts.length] ?? `${pts.length}-gon`
  if (isDegenerate(pts) && !isSelfIntersecting(pts)) {
    return { name: `degenerate ${base}`, also: [], ...degenerateWhy(pts, names, nm) }
  }
  if (isSelfIntersecting(pts)) {
    return { name: `crossed ${base}`, also: [], sentence: `Two sides of ${nm} cross, so it is a crossed (self-intersecting) ${base}.`, short: `${nm}: crossed ${base}`, because: 'two sides cross' }
  }
  const sides = sidesOf(pts, names)
  const angles = interiorAngles(pts)
  const concave = angles.some((a) => a.reflex)
  const eqSides = sides.every((s) => sameLength(s, sides[0]))
  const eqAngles = angles.every((a) => sameAngle(a, angles[0]))
  if (!concave && eqSides && eqAngles) {
    const name = `regular ${base}`
    const why = `all ${pts.length} sides are ${sides[0].length.text} and every angle is ${angles[0].text}`
    return { name, also: [], sentence: `${capital(why)}, so ${nm} is ${article(name)}.`, short: `${nm}: ${name}`, because: why }
  }
  const name = `${concave ? 'concave' : 'convex'} ${base}`
  const why = concave
    ? `∠${names[angles.findIndex((a) => a.reflex)]} = ${angles.find((a) => a.reflex)!.text} is greater than 180°`
    : 'every interior angle is less than 180°'
  return { name, also: [], sentence: `${capital(why)}, so ${nm} is ${article(name)}.`, short: `${nm}: ${name}`, because: why }
}

// ---------------------------------------------------------------------------
// Right triangles: Pythagoras, trig ratios, special triangles
// ---------------------------------------------------------------------------

export interface TrigRatio {
  /** "sin A" */
  name: string
  /** "BC/AC" */
  ratio: string
  /** "opposite/hypotenuse" */
  words: string
  value: Measure
  tex: string
}

export interface TrigAngle {
  vertex: number
  name: string
  angle: AngleInfo
  sin: TrigRatio
  cos: TrigRatio
  tan: TrigRatio
}

export interface RightTriangleInfo {
  /** Vertex index of the right angle. */
  right: number
  /** Side indices (in sidesOf order) of the two legs and the hypotenuse. */
  legs: [number, number]
  hyp: number
  /** "AB² + BC² = AC²" and "4² + 3² = 5²  (16 + 9 = 25)" */
  pythag: { names: string; values: string; sums: string; tex: string }
  trig: TrigAngle[]
  special: { kind: '45-45-90' | '30-60-90'; text: string; ratio: string } | null
}

/** "(√13)²", "5²" — a length squared, as a class writes it. */
function sq(m: Measure): string {
  return m.exact && /^\d+$/.test(m.text) ? `${m.text}²` : `(${m.text})²`
}

function sqTex(m: Measure): string {
  return m.exact && /^\d+$/.test(m.text) ? `${m.tex}^2` : `\\left(${m.tex}\\right)^2`
}

function sqValue(s: SideInfo): string {
  if (s.len2) return ratText(s.len2)
  return decimalMeasure(s.length.value ** 2).text
}

/** The ratio of two sides, exactly: √(p²/q²) simplified. */
function sideRatio(p: SideInfo, q: SideInfo): Measure {
  const r = p.len2 && q.len2 ? ratDiv(p.len2, q.len2) : null
  const s = r ? sqrtRat(r) : null
  if (s) return measureOfSurd(s)
  return measureOf(p.length.value / q.length.value)
}

export function rightTriangle(pts: readonly Vec2[], names: readonly string[]): RightTriangleInfo | null {
  if (pts.length !== 3 || isDegenerate(pts)) return null
  const angles = interiorAngles(pts)
  const r = angles.findIndex((a) => a.right)
  if (r < 0) return null
  const sides = sidesOf(pts, names)
  // side i joins vertex i and i+1: the hypotenuse is the side not touching r
  const hyp = (r + 1) % 3
  const legs: [number, number] = [(r + 2) % 3, r]
  const [l1, l2] = [sides[legs[0]], sides[legs[1]]]
  const h = sides[hyp]
  const pythag = {
    names: `${l1.name}² + ${l2.name}² = ${h.name}²`,
    values: `${sq(l1.length)} + ${sq(l2.length)} = ${sq(h.length)}`,
    sums: `${sqValue(l1)} + ${sqValue(l2)} = ${sqValue(h)}`,
    tex: `${sqTex(l1.length)} + ${sqTex(l2.length)} = ${sqTex(h.length)}`,
  }
  const trig: TrigAngle[] = []
  for (const v of [0, 1, 2]) {
    if (v === r) continue
    // opposite: the side not touching v; adjacent: the leg touching v
    const opp = sides[(v + 1) % 3]
    const adj = legs.map((i) => sides[i]).find((s) => s.from === v || s.to === v)!
    const nm = names[v]
    const mk = (fn: string, p: SideInfo, q: SideInfo, words: string): TrigRatio => {
      const value = sideRatio(p, q)
      return {
        name: `${fn} ${nm}`,
        ratio: `${p.name}/${q.name}`,
        words,
        value,
        tex: `\\${fn} ${nm} = \\frac{${p.name}}{${q.name}} = ${value.exact ? value.tex : `\\approx ${value.tex}`}`,
      }
    }
    trig.push({
      vertex: v,
      name: nm,
      angle: angles[v],
      sin: mk('sin', opp, h, 'opposite/hypotenuse'),
      cos: mk('cos', adj, h, 'adjacent/hypotenuse'),
      tan: mk('tan', opp, adj, 'opposite/adjacent'),
    })
  }
  let special: RightTriangleInfo['special'] = null
  const acute = trig.map((t) => t.angle.deg)
  if (acute.every((d) => Math.abs(d - 45) < 1e-7)) {
    special = {
      kind: '45-45-90',
      text: `${l1.name} : ${l2.name} : ${h.name} = ${l1.length.text} : ${l2.length.text} : ${h.length.text}`,
      ratio: '1 : 1 : √2',
    }
  } else if (acute.some((d) => Math.abs(d - 30) < 1e-7)) {
    const t30 = trig.find((t) => Math.abs(t.angle.deg - 30) < 1e-7)!
    const short = sides[(t30.vertex + 1) % 3]
    const long = legs.map((i) => sides[i]).find((s) => s !== short)!
    special = {
      kind: '30-60-90',
      text: `${short.name} : ${long.name} : ${h.name} = ${short.length.text} : ${long.length.text} : ${h.length.text}`,
      ratio: '1 : √3 : 2',
    }
  }
  return { right: r, legs, hyp, pythag, trig, special }
}

/**
 * For a triangle that is NOT right: the converse of Pythagoras on its longest
 * side — "AB² + BC² = 25 > AC² = 20, so the triangle is acute".
 */
export function pythagoreanTest(pts: readonly Vec2[], names: readonly string[]): string | null {
  if (pts.length !== 3 || isDegenerate(pts)) return null
  const sides = sidesOf(pts, names)
  let li = 0
  for (let i = 1; i < 3; i++) if (sides[i].length.value > sides[li].length.value) li = i
  const c = sides[li]
  const [a, b] = sides.filter((_s, i) => i !== li)
  const lhsR = a.len2 && b.len2 ? ratAdd(a.len2, b.len2) : null
  const lhsV = a.length.value ** 2 + b.length.value ** 2
  const rhsV = c.length.value ** 2
  const lhs = lhsR ? ratText(lhsR) : decimalMeasure(lhsV).text
  const rhs = c.len2 ? ratText(c.len2) : decimalMeasure(rhsV).text
  const cmp = lhsR && c.len2 ? Math.sign(ratValue(lhsR) - ratValue(c.len2)) : Math.abs(lhsV - rhsV) <= 1e-9 * rhsV ? 0 : Math.sign(lhsV - rhsV)
  const verdict = cmp === 0 ? 'right' : cmp > 0 ? 'acute' : 'obtuse'
  const sign = cmp === 0 ? '=' : cmp > 0 ? '>' : '<'
  return `${a.name}² + ${b.name}² = ${lhs} ${sign} ${c.name}² = ${rhs}, so the triangle is ${verdict}.`
}

// ---------------------------------------------------------------------------
// Everything about one polygon, once
// ---------------------------------------------------------------------------

export interface PairRelation {
  a: string
  b: string
  rel: 'parallel' | 'perpendicular'
  /** "AB ‖ DC (slope 1/4)" / "AB ⊥ BC (their slopes … multiply to −1)" */
  text: string
}

export interface PolygonReport {
  names: string[]
  sides: SideInfo[]
  angles: AngleInfo[]
  perimeter: Measure
  area: AreaResult
  classification: Classification
  right: RightTriangleInfo | null
  /** For a non-right triangle: the converse-of-Pythagoras test. */
  pythagTest: string | null
  /** Equal-side groups (tick marks): 0 none, 1…3 the group. */
  sideGroups: number[]
  /** Equal-angle groups (arc marks), right angles excluded. */
  angleGroups: number[]
  /** Every parallel and perpendicular pair of sides. */
  pairs: PairRelation[]
  /** The angle sum, "(n − 2)·180° = 360°". */
  angleSum: string
}

/** Pairs of sides that are parallel or perpendicular, in reading order. */
export function sidePairs(pts: readonly Vec2[], sides: readonly SideInfo[]): PairRelation[] {
  const out: PairRelation[] = []
  for (let i = 0; i < sides.length; i++) {
    for (let j = i + 1; j < sides.length; j++) {
      const a = sides[i]
      const b = sides[j]
      const rel = relation(pts[a.from], pts[a.to], pts[b.from], pts[b.to])
      if (rel === 'parallel') out.push({ a: a.name, b: b.name, rel, text: parText(a.name, b.name, a.slope) })
      else if (rel === 'perpendicular') {
        out.push({ a: a.name, b: b.name, rel, text: `${a.name} ⊥ ${b.name} (${perpReason(a.slope, b.slope, a.name, b.name)})` })
      }
    }
  }
  return out
}

export function polygonReport(pts: readonly Vec2[], labels?: readonly string[] | null): PolygonReport | null {
  if (pts.length < 3 || !pts.every(finitePt)) return null
  const names = vertexNames(pts.length, labels)
  const sides = sidesOf(pts, names)
  const angles = interiorAngles(pts)
  const right = rightTriangle(pts, names)
  return {
    names,
    sides,
    angles,
    perimeter: perimeter(pts),
    area: shoelace(pts),
    classification: classifyPolygon(pts, names),
    right,
    pythagTest: pts.length === 3 && !right ? pythagoreanTest(pts, names) : null,
    sideGroups: equalGroups(sides, sameLength),
    angleGroups: equalGroups(angles, sameAngle, (a) => a.right),
    pairs: sidePairs(pts, sides),
    angleSum: `(${pts.length} ${MINUS} 2)·180° = ${(pts.length - 2) * 180}°`,
  }
}

/** Everything about one segment AB. */
export interface SegmentReport {
  names: [string, string]
  length: Measure
  slope: SlopeInfo
  midpoint: PointMeasure
  line: LineEq
}

export function segmentReport(a: Vec2, b: Vec2, labels?: readonly string[] | null): SegmentReport | null {
  if (!finitePt(a) || !finitePt(b)) return null
  const names = vertexNames(2, labels) as [string, string]
  return { names, length: distance(a, b), slope: slope(a, b), midpoint: midpoint(a, b), line: lineThrough(a, b) }
}

// ---------------------------------------------------------------------------
// The line through P parallel / perpendicular to AB
// ---------------------------------------------------------------------------

export interface LinkedLine {
  through: Vec2
  /** A direction vector along the line. */
  dir: Vec2
  line: LineEq
}

export function lineRelativeTo(rel: 'parallel' | 'perpendicular', a: Vec2, b: Vec2, p: Vec2): LinkedLine | null {
  if (!finitePt(a) || !finitePt(b) || !finitePt(p)) return null
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (!(Math.hypot(dx, dy) > 0)) return null
  const m = slope(a, b)
  const mm = rel === 'parallel' ? m : perpSlope(m)
  const dir = rel === 'parallel' ? { x: dx, y: dy } : { x: -dy, y: dx }
  return { through: p, dir, line: lineThroughSlope(p, mm) }
}

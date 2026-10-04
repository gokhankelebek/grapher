// ============================================================================
// src/core/complexZeros.ts — every zero of a polynomial, over ℂ
// (NC.M2/M3.N-CN.9: the Fundamental Theorem of Algebra; NC.M2.A-REI.4b:
// complex solutions of a quadratic written a ± bi).
//
//   complexZeros(desc)          desc = [cₙ … c₀] (valueTable's Num, the
//                               coefficients polynomialCoeffs reads off a curve)
//   curveComplexZeros(f)        the same for y = f(x), when f IS a polynomial
//
// The method is the one a class is taught, in its order:
//   1. x = 0 as often as x factors out;
//   2. the rational root theorem: ±p/q with p | c₀ and q | cₙ, each tried by
//      SYNTHETIC DIVISION (valueTable.syntheticDivision — the Remainder
//      Theorem's own tableau): a remainder of 0 is a zero, and the quotient
//      is what is left, divided again for a repeated zero;
//   3. a quadratic left over: the quadratic formula, exactly — simplified
//      radicals, a ± bi with b in simplest radical form (2 ± 3i, −1 ± i√3,
//      −1/2 ± (√3/2)i), and the discriminant's verdict;
//   4. a cubic or higher left over with no rational zeros: its zeros found
//      numerically (Aberth's method, polished by Newton on the polynomial),
//      and any PAIR of them whose sum and product are rational tried as a
//      quadratic factor by exact division (x⁴ + 5x² + 6 = (x² + 2)(x² + 3)
//      gives ±i√2, ±i√3 exactly); whatever is still left is printed to four
//      decimals and marked ≈.
//
// Coefficients that are not rational (a sketched curve's fitted doubles) skip
// straight to step 4 and every zero is ≈.
//
// Pure: no DOM, nothing from src/ui.
// ============================================================================

import type { Num } from './valueTable'
import { divisorText, numCell, numValue, polyText, polynomialCoeffs, syntheticDivision } from './valueTable'

const MINUS = '−'

export type ZeroKind = 'real' | 'real-pair' | 'complex-pair'

/** One entry of the list: a real zero, or a ± pair (two zeros). */
export interface CZero {
  kind: ZeroKind
  /** the real part (the zero itself for 'real'; the centre of a ± pair) */
  re: number
  /** for a pair: the ± offset (imaginary part for complex, real offset for a real pair); 0 for 'real' */
  im: number
  mult: number
  /** the text is the exact value */
  exact: boolean
  /** "1", "1 ± √2", "−1/2 ± (√3/2)i", "0.3090 ± 0.9511i" (≈ when not exact) */
  text: string
  tex: string
  /** how many zeros this entry stands for, with multiplicity */
  count: number
}

export interface Discriminant {
  /** the quadratic it belongs to: "x² − 4x + 13" */
  of: { text: string; tex: string }
  value: number
  /** "b² − 4ac = (−4)² − 4(1)(13) = −36" */
  text: string
  tex: string
  verdict: 'two-real' | 'one-repeated' | 'two-non-real'
  /** "−36 < 0: two non-real (complex conjugate) zeros" */
  sentence: string
  exact: boolean
}

export interface ComplexZeros {
  degree: number
  poly: { text: string; tex: string }
  zeros: CZero[]
  /** counted with multiplicity */
  real: number
  nonReal: number
  /** conjugate pairs, counted with multiplicity */
  pairs: number
  /** every zero is written exactly */
  exact: boolean
  /** the quadratic's discriminant: the polynomial's own (degree 2), or the quadratic left after the rational zeros */
  discriminant: Discriminant | null
  /** the working, one line each */
  steps: string[]
  /** "Degree 3: 3 zeros counted with multiplicity — 1 real, 2 non-real (1 conjugate pair)." */
  fta: string
  /** "Real zeros are where the graph crosses or touches the x-axis; the non-real zeros do not appear on the graph." */
  graphNote: string
}

// ---------------------------------------------------------------------------
// Rationals in the valueTable's Num, and bigint helpers
// ---------------------------------------------------------------------------

const isRat = (n: Num): n is { p: number; q: number } => !('d' in n)
const ratOf = (p: number, q: number): Num => {
  if (q < 0) {
    p = -p
    q = -q
  }
  const g = gcdN(Math.abs(p), q) || 1
  return { p: p / g + 0, q: q / g }
}
function gcdN(a: number, b: number): number {
  while (b) [a, b] = [b, a % b]
  return a
}
const babs = (a: bigint): bigint => (a < 0n ? -a : a)
function bgcd(a: bigint, b: bigint): bigint {
  a = babs(a)
  b = babs(b)
  while (b !== 0n) [a, b] = [b, a % b]
  return a
}

/** Integer coefficients (bigint) with the same zeros, positive leading coefficient. */
function integerize(desc: readonly Num[]): bigint[] | null {
  if (!desc.every(isRat)) return null
  let L = 1n
  for (const c of desc as { p: number; q: number }[]) {
    const q = BigInt(c.q)
    L = (L / bgcd(L, q)) * q
  }
  let ints = (desc as { p: number; q: number }[]).map((c) => (BigInt(c.p) * L) / BigInt(c.q))
  let g = 0n
  for (const c of ints) g = bgcd(g, c)
  if (g > 1n) ints = ints.map((c) => c / g)
  if (ints[0] < 0n) ints = ints.map((c) => -c)
  return ints
}

function divisors(n: bigint): bigint[] | null {
  n = babs(n)
  if (n === 0n || n > 10_000_000_000n) return null
  const out: bigint[] = []
  for (let i = 1n; i * i <= n; i++) {
    if (n % i === 0n) {
      out.push(i)
      if (i * i !== n) out.push(n / i)
    }
  }
  return out.sort((a, b) => (a < b ? -1 : 1))
}

/** n = s²·m with m square-free (trial division). */
function splitSquare(n: bigint): { s: bigint; m: bigint } {
  let s = 1n
  let m = n
  for (let p = 2n; p * p <= m && p < 100000n; p++) {
    while (m % (p * p) === 0n) {
      m /= p * p
      s *= p
    }
  }
  return { s, m }
}

function fracText(n: bigint, d: bigint): string {
  const g = bgcd(n, d) || 1n
  n /= g
  d /= g
  if (d < 0n) {
    n = -n
    d = -d
  }
  const sign = n < 0n ? MINUS : ''
  return d === 1n ? `${sign}${babs(n)}` : `${sign}${babs(n)}/${d}`
}
function fracTex(n: bigint, d: bigint): string {
  const g = bgcd(n, d) || 1n
  n /= g
  d /= g
  if (d < 0n) {
    n = -n
    d = -d
  }
  const sign = n < 0n ? '-' : ''
  return d === 1n ? `${sign}${babs(n)}` : `${sign}\\frac{${babs(n)}}{${d}}`
}

const sup = (n: number): string => String(n).split('').map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(c)] ?? c).join('')

/** "double", "triple", "multiplicity 4". */
export function multiplicityWord(m: number): string {
  return m === 2 ? 'double' : m === 3 ? 'triple' : `multiplicity ${m}`
}

// ---------------------------------------------------------------------------
// Exact quadratics: A x² + B x + C with integers, A > 0
// ---------------------------------------------------------------------------

/** The zeros of an integer quadratic, exactly. */
function quadraticZeros(A: bigint, B: bigint, C: bigint, mult: number): CZero[] {
  const D = B * B - 4n * A * C
  const two = 2n * A
  const reV = Number(-B) / Number(two)
  if (D === 0n) {
    return [{ kind: 'real', re: reV, im: 0, mult: 2 * mult, exact: true, text: fracText(-B, two), tex: fracTex(-B, two), count: 2 * mult }]
  }
  const { s, m } = splitSquare(babs(D))
  if (m === 1n && D > 0n) {
    // rational zeros (a perfect-square discriminant)
    const r1 = { n: -B - s, d: two }
    const r2 = { n: -B + s, d: two }
    return [r1, r2]
      .map((r) => ({ kind: 'real' as const, re: Number(r.n) / Number(r.d), im: 0, mult, exact: true, text: fracText(r.n, r.d), tex: fracTex(r.n, r.d), count: mult }))
      .sort((a, b) => a.re - b.re)
  }
  const offV = (Number(s) * Math.sqrt(Number(m))) / Number(two)
  if (D > 0n) {
    // (−B ± s√m)/(2A), reduced: 1 ± √2, (1 ± √5)/2
    let a = -B
    let k = s
    let d = two
    const g = bgcd(bgcd(a, k), d)
    a /= g
    k /= g
    d /= g
    const kT = `${k === 1n ? '' : k}√${m}`
    const kX = `${k === 1n ? '' : k}\\sqrt{${m}}`
    const inner = a === 0n ? `±${kT}` : `${a < 0n ? MINUS : ''}${babs(a)} ± ${kT}`
    const innerX = a === 0n ? `\\pm ${kX}` : `${a < 0n ? '-' : ''}${babs(a)} \\pm ${kX}`
    const text = d === 1n ? inner : a === 0n ? `±${kT}/${d}` : `(${inner})/${d}`
    const tex = d === 1n ? innerX : a === 0n ? `\\pm\\frac{${kX}}{${d}}` : `\\frac{${innerX}}{${d}}`
    return [{ kind: 'real-pair', re: reV, im: offV, mult, exact: true, text, tex, count: 2 * mult }]
  }
  // D < 0: a ± bi, b = s√m/(2A) in simplest radical form
  const re = fracText(-B, two)
  const reX = fracTex(-B, two)
  const g = bgcd(s, two)
  const bn = s / g
  const bd = two / g
  let imT: string
  let imX: string
  if (m === 1n) {
    if (bd === 1n) {
      imT = bn === 1n ? 'i' : `${bn}i`
      imX = bn === 1n ? 'i' : `${bn}i`
    } else {
      imT = `(${bn}/${bd})i`
      imX = `\\frac{${bn}}{${bd}}i`
    }
  } else if (bd === 1n) {
    imT = bn === 1n ? `i√${m}` : `${bn}i√${m}`
    imX = bn === 1n ? `i\\sqrt{${m}}` : `${bn}i\\sqrt{${m}}`
  } else {
    imT = `(${bn === 1n ? '' : bn}√${m}/${bd})i`
    imX = `\\frac{${bn === 1n ? '' : bn}\\sqrt{${m}}}{${bd}}i`
  }
  const text = B === 0n ? `±${imT}` : `${re} ± ${imT}`
  const tex = B === 0n ? `\\pm ${imX}` : `${reX} \\pm ${imX}`
  return [{ kind: 'complex-pair', re: B === 0n ? 0 : reV, im: offV, mult, exact: true, text, tex, count: 2 * mult }]
}

/** The discriminant of a·x² + b·x + c, written out from the coefficients as they are. */
function discriminantOf(q: readonly Num[], exact: boolean): Discriminant {
  const [a, b, c] = q
  const cellOf = (n: Num): string => numCell(n, true).text
  const paren = (n: Num): string => {
    const t = cellOf(n)
    return numValue(n) < 0 || t.includes('/') ? `(${t})` : t
  }
  let valueText: string
  let valueTex: string | null = null
  let value: number
  if (exact && isRat(a) && isRat(b) && isRat(c)) {
    // b² − 4ac in exact fractions
    const n = BigInt(b.p) * BigInt(b.p) * BigInt(a.q) * BigInt(c.q) - 4n * BigInt(a.p) * BigInt(c.p) * BigInt(b.q) * BigInt(b.q)
    const d = BigInt(b.q) * BigInt(b.q) * BigInt(a.q) * BigInt(c.q)
    valueText = fracText(n, d)
    value = Number(n) / Number(d)
  } else {
    value = numValue(b) ** 2 - 4 * numValue(a) * numValue(c)
    // significant figures, not four decimals: 0² − 4(1)(0.000001) is
    // ≈ −4×10⁻⁶, and "≈ 0.0000 < 0" would be a false sentence on its face
    const sv = sigFigs(value)
    valueText = `≈ ${sv.text}`
    valueTex = sv.tex
  }
  const verdict: Discriminant['verdict'] = Math.abs(value) <= (exact ? 0 : 1e-12) ? 'one-repeated' : value > 0 ? 'two-real' : 'two-non-real'
  const words = {
    'two-real': 'two real zeros',
    'one-repeated': 'one repeated real zero (a double zero)',
    'two-non-real': 'two non-real zeros, a complex conjugate pair',
  }[verdict]
  const rel = verdict === 'one-repeated' ? '= 0' : verdict === 'two-real' ? '> 0' : '< 0'
  const vShort = valueText.startsWith('≈') ? valueText.slice(2) : valueText
  return {
    of: polyText(q),
    value,
    text: `b² − 4ac = ${paren(b)}² − 4(${cellOf(a)})(${cellOf(c)}) ${valueText.startsWith('≈') ? valueText : `= ${valueText}`}`,
    tex: `b^2 - 4ac = ${valueText.startsWith('≈') ? `\\approx ${valueTex ?? vShort.replace(MINUS, '-')}` : vShort.replace(MINUS, '-')}`,
    verdict,
    sentence: `${vShort} ${rel}: ${words}`,
    exact,
  }
}

// ---------------------------------------------------------------------------
// Numeric zeros: Aberth–Ehrlich, polished
// ---------------------------------------------------------------------------

type C = [number, number]
const cadd = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]]
const csub = (a: C, b: C): C => [a[0] - b[0], a[1] - b[1]]
const cmul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]
const cdiv = (a: C, b: C): C => {
  const d = b[0] * b[0] + b[1] * b[1]
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]
}
const cabs = (a: C): number => Math.hypot(a[0], a[1])

/** p(z) and p′(z) for descending double coefficients. */
function hornerC(c: readonly number[], z: C): { p: C; dp: C } {
  let p: C = [c[0], 0]
  let dp: C = [0, 0]
  for (let i = 1; i < c.length; i++) {
    dp = cadd(cmul(dp, z), p)
    p = cadd(cmul(p, z), [c[i], 0])
  }
  return { p, dp }
}

function aberth(c: readonly number[]): C[] {
  const n = c.length - 1
  if (n < 1) return []
  const lead = c[0]
  const mono = c.map((v) => v / lead)
  let R = 0
  for (let i = 1; i <= n; i++) R = Math.max(R, Math.pow(Math.abs(mono[i]), 1 / i))
  R = Math.max(R, 1e-3)
  const z: C[] = []
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n + 0.4
    z.push([R * Math.cos(t), R * Math.sin(t)])
  }
  for (let iter = 0; iter < 800; iter++) {
    let moved = 0
    for (let k = 0; k < n; k++) {
      const { p, dp } = hornerC(mono, z[k])
      if (cabs(p) === 0) continue
      const ratio = cdiv(p, dp)
      let s: C = [0, 0]
      for (let j = 0; j < n; j++) if (j !== k) s = cadd(s, cdiv([1, 0], csub(z[k], z[j])))
      const w = cdiv(ratio, csub([1, 0], cmul(ratio, s)))
      if (!Number.isFinite(w[0]) || !Number.isFinite(w[1])) continue
      z[k] = csub(z[k], w)
      moved = Math.max(moved, cabs(w) / Math.max(1, cabs(z[k])))
    }
    if (moved < 1e-15) break
  }
  // Newton polish
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < 3; i++) {
      const { p, dp } = hornerC(mono, z[k])
      if (cabs(dp) === 0) break
      const step = cdiv(p, dp)
      if (!Number.isFinite(step[0]) || !Number.isFinite(step[1])) break
      z[k] = csub(z[k], step)
    }
  }
  return z
}

/** Four significant figures: "−36", "0.1235", "−4×10⁻⁶" (text) and its LaTeX. */
function sigFigs(v: number): { text: string; tex: string } {
  if (v === 0 || !Number.isFinite(v)) return { text: '0', tex: '0' }
  const a = Math.abs(v)
  if (a >= 1e-3 && a < 1e7) {
    const t = String(Number(v.toPrecision(4)))
    return { text: t.replace('-', MINUS), tex: t }
  }
  const [m, e] = v.toExponential(3).split('e')
  const mt = String(Number(m))
  const ev = Number(e)
  const supE = String(ev).split('').map((ch) => (ch === '-' ? '⁻' : '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(ch)] ?? ch)).join('')
  return { text: `${mt.replace('-', MINUS)}×10${supE}`, tex: `${mt} \\times 10^{${ev}}` }
}

function dec4(v: number): string {
  const r = Math.abs(v) < 5e-5 ? 0 : v
  const s = r.toFixed(4)
  return s.startsWith('-') ? MINUS + s.slice(1) : s
}

/**
 * Numeric zeros as entries: real ones and conjugate pairs, clustered into
 * multiplicities. Null — no section rather than a wrong one — when the zeros
 * do not sort cleanly into real zeros and conjugate pairs.
 *
 * A repeated zero converges to a small RING around it (radius ~ε^(1/m)), so a
 * cluster is real when its mean's imaginary part is inside that ring, not
 * only when it is below 10⁻⁷: a triple zero at √2 is real even though its
 * three approximations are not. A non-real cluster needs a conjugate partner
 * within the same tolerance, or nothing is said.
 */
function numericEntries(c: readonly number[]): CZero[] | null {
  const zs = aberth(c)
  if (zs.some((z) => !Number.isFinite(z[0]) || !Number.isFinite(z[1]))) return null
  const scale = Math.max(1, ...zs.map(cabs))
  const near = 1e-4 * scale
  // cluster (a repeated zero converges to a small ring)
  const used = new Array(zs.length).fill(false)
  const groups: { z: C; m: number; radius: number }[] = []
  for (let i = 0; i < zs.length; i++) {
    if (used[i]) continue
    const members = [zs[i]]
    used[i] = true
    for (let j = i + 1; j < zs.length; j++) {
      if (!used[j] && cabs(csub(zs[i], zs[j])) <= near) {
        members.push(zs[j])
        used[j] = true
      }
    }
    const m = members.length
    const mean: C = [members.reduce((s, z) => s + z[0], 0) / m, members.reduce((s, z) => s + z[1], 0) / m]
    const radius = m > 1 ? Math.max(...members.map((z) => cabs(csub(z, mean)))) : 0
    groups.push({ z: mean, m, radius })
  }
  const out: CZero[] = []
  const taken = new Array(groups.length).fill(false)
  for (let i = 0; i < groups.length; i++) {
    if (taken[i]) continue
    const { z, m, radius } = groups[i]
    if (Math.abs(z[1]) <= Math.max(1e-7 * Math.max(1, cabs(z)), 2 * radius)) {
      taken[i] = true
      out.push({ kind: 'real', re: z[0], im: 0, mult: m, exact: false, text: dec4(z[0]), tex: dec4(z[0]).replace(MINUS, '-'), count: m })
      continue
    }
    // its conjugate: the same multiplicity, at [re, −im]
    let best = -1
    let bestD = Infinity
    for (let j = 0; j < groups.length; j++) {
      if (j === i || taken[j] || groups[j].m !== m) continue
      const d = cabs(csub(groups[j].z, [z[0], -z[1]]))
      if (d < bestD) {
        bestD = d
        best = j
      }
    }
    if (best < 0 || bestD > near) return null
    taken[i] = true
    taken[best] = true
    const re = z[0]
    const im = Math.abs(z[1])
    // an imaginary part that prints as 0.0000 is not a pair anyone should be shown
    if (im < 5e-5) return null
    const reT = dec4(re)
    const reZero = reT === '0.0000'
    const text = `${reZero ? '' : `${reT} `}±${reZero ? '' : ' '}${dec4(im)}i`
    const tex = `${reZero ? '' : `${reT.replace(MINUS, '-')} `}\\pm ${dec4(im)}i`
    out.push({ kind: 'complex-pair', re, im, mult: m, exact: false, text, tex, count: 2 * m })
  }
  return out
}

// ---------------------------------------------------------------------------
// Exact division by a quadratic, for the pairs found numerically
// ---------------------------------------------------------------------------

/** a/b for descending rational coefficients; null unless the remainder is exactly 0. */
function divideExact(a: readonly Num[], b: readonly Num[]): Num[] | null {
  if (!a.every(isRat) || !b.every(isRat)) return null
  const A = (a as { p: number; q: number }[]).map((x) => ({ n: BigInt(x.p), d: BigInt(x.q) }))
  const Bq = (b as { p: number; q: number }[]).map((x) => ({ n: BigInt(x.p), d: BigInt(x.q) }))
  const norm = (x: { n: bigint; d: bigint }) => {
    const g = bgcd(x.n, x.d) || 1n
    let n = x.n / g
    let d = x.d / g
    if (d < 0n) {
      n = -n
      d = -d
    }
    return { n, d }
  }
  const r = A.slice()
  const q: { n: bigint; d: bigint }[] = []
  for (let i = 0; i + Bq.length <= r.length; i++) {
    const c = norm({ n: r[i].n * Bq[0].d, d: r[i].d * Bq[0].n })
    q.push(c)
    for (let j = 0; j < Bq.length; j++) {
      const t = norm({ n: c.n * Bq[j].n, d: c.d * Bq[j].d })
      r[i + j] = norm({ n: r[i + j].n * t.d - t.n * r[i + j].d, d: r[i + j].d * t.d })
    }
  }
  for (let i = q.length; i < r.length; i++) if (r[i].n !== 0n) return null
  const out: Num[] = []
  for (const c of q) {
    if (babs(c.n) > 2n ** 50n || c.d > 2n ** 50n) return null
    out.push(ratOf(Number(c.n), Number(c.d)))
  }
  return out
}

/** A double as a fraction with a small denominator, when it is one. */
function smallFraction(v: number): Num | null {
  for (let q = 1; q <= 1000; q++) {
    const p = Math.round(v * q)
    if (Math.abs(p / q - v) <= 1e-7 * Math.max(1, Math.abs(v))) return ratOf(p, q)
  }
  return null
}

// ---------------------------------------------------------------------------
// Repeated factors, exactly: the square-free decomposition over ℚ
//
// A zero of multiplicity 3 or more is where a numeric root finder is at its
// worst — Aberth spreads a triple zero √2 into a ring of radius ~10⁻⁵, whose
// mean keeps a stray imaginary part, and (x² − 2)³ came out "6 non-real".
// So repeated factors are split off EXACTLY first, the way a CAS does it:
// gcd(p, p′) holds every repeated factor once less often, and the chain
//     G₀ = p,  Gₖ = gcd(Gₖ₋₁, G′ₖ₋₁)
// gives sₖ = Gₖ₋₁/Gₖ (each factor of multiplicity ≥ k, once), and sₖ/sₖ₊₁ is
// the product of the factors of multiplicity exactly k. Every polynomial
// handed on from here is square-free, so its zeros are simple.
// ---------------------------------------------------------------------------

type BPoly = bigint[]

function btrim(a: BPoly): BPoly {
  let i = 0
  while (i < a.length - 1 && a[i] === 0n) i++
  return a.slice(i)
}
const bzero = (a: BPoly): boolean => a.every((c) => c === 0n)
const bdeg = (a: BPoly): number => btrim(a).length - 1

/** Divide out the content; leading coefficient positive. */
function bprimitive(a0: BPoly): BPoly {
  const a = btrim(a0)
  let g = 0n
  for (const c of a) g = bgcd(g, c)
  if (g === 0n) return [0n]
  const out = a.map((c) => c / g)
  return out[0] < 0n ? out.map((c) => -c) : out
}

function bderiv(a: BPoly): BPoly {
  const n = a.length - 1
  if (n < 1) return [0n]
  return a.slice(0, n).map((c, i) => c * BigInt(n - i))
}

/** lc(b)^(da − db + 1)·a = q·b + r, deg r < deg b: pseudo-division, in integers. */
function bpdiv(a0: BPoly, b0: BPoly): { q: BPoly; r: BPoly } {
  const b = btrim(b0)
  const db = b.length - 1
  const lb = b[0]
  let r = btrim(a0)
  const n = r.length - 1 - db
  if (n < 0) return { q: [0n], r }
  let q: BPoly = new Array(n + 1).fill(0n)
  for (let k = 0; k <= n; k++) {
    // r is of degree deg a − k here; lb·r − r₀·x^(n − k)·b kills its leading term
    const lead = r[0]
    r = r.map((c) => c * lb)
    q = q.map((c) => c * lb)
    q[k] += lead
    for (let j = 0; j <= db; j++) r[j] -= lead * b[j]
    r = r.slice(1)
  }
  return { q, r: r.length > 0 ? btrim(r) : [0n] }
}

function bpgcd(a0: BPoly, b0: BPoly): BPoly {
  let a = bprimitive(a0)
  let b = bprimitive(b0)
  if (bdeg(a) < bdeg(b)) [a, b] = [b, a]
  while (!bzero(b)) {
    const { r } = bpdiv(a, b)
    a = b
    b = bzero(r) ? [0n] : bprimitive(r)
  }
  return bprimitive(a)
}

/** a/b when b divides a exactly (as primitive integer polynomials), else null. */
function bexact(a: BPoly, b: BPoly): BPoly | null {
  const { q, r } = bpdiv(a, b)
  return bzero(r) ? bprimitive(q) : null
}

/**
 * The square-free decomposition of an integer polynomial: [{ poly, mult }],
 * p = c·∏ polyₖ^multₖ with each polyₖ square-free and primitive. Null when the
 * arithmetic fails (it does not, for degree ≤ 8 with sane coefficients).
 */
function squareFreeParts(p: BPoly): { poly: BPoly; mult: number }[] | null {
  const G: BPoly[] = [bprimitive(p)]
  while (bdeg(G[G.length - 1]) > 0 && G.length < 12) {
    const g = G[G.length - 1]
    G.push(bpgcd(g, bderiv(g)))
  }
  const S: BPoly[] = []
  for (let k = 1; k < G.length; k++) {
    const s = bexact(G[k - 1], G[k])
    if (!s) return null
    S.push(s)
  }
  S.push([1n])
  const out: { poly: BPoly; mult: number }[] = []
  for (let k = 0; k + 1 < S.length; k++) {
    const part = bexact(S[k], S[k + 1])
    if (!part) return null
    if (bdeg(part) > 0) out.push({ poly: part, mult: k + 1 })
  }
  return out
}

/** A bigint polynomial as the valueTable's Num coefficients (null past 2⁵³). */
function bToNum(a: BPoly): Num[] | null {
  const lim = 2n ** 53n
  if (a.some((c) => babs(c) >= lim)) return null
  return a.map((c) => ({ p: Number(c), q: 1 }))
}

// ---------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------

/** Trim leading zero coefficients. */
function trimDesc(desc: readonly Num[]): Num[] {
  const out = desc.slice()
  while (out.length > 1 && numValue(out[0]) === 0) out.shift()
  return out
}

/** Every zero of the polynomial with descending coefficients `desc` (degree 1–8), or null. */
export function complexZeros(desc0: readonly Num[]): ComplexZeros | null {
  const desc = trimDesc(desc0)
  const n = desc.length - 1
  if (n < 1 || n > 8) return null
  if (!desc.every((c) => Number.isFinite(numValue(c)))) return null
  const zeros: CZero[] = []
  const steps: string[] = []
  let disc: Discriminant | null = null
  const exactCoeffs = desc.every(isRat)
  let cur: Num[] = desc.slice()
  let failed = false

  const pushQuadratic = (q: Num[], mult: number): void => {
    const ints = integerize(q)
    if (!ints) return
    const [A, B, Cc] = ints
    const zs = quadraticZeros(A, B, Cc, mult)
    zeros.push(...zs)
  }

  if (exactCoeffs) {
    // 1. x = 0
    let m0 = 0
    while (cur.length > 1 && numValue(cur[cur.length - 1]) === 0) {
      cur = cur.slice(0, -1)
      m0++
    }
    if (m0 > 0) {
      zeros.push({ kind: 'real', re: 0, im: 0, mult: m0, exact: true, text: '0', tex: '0', count: m0 })
      steps.push(`${m0 === 1 ? 'x' : `x${sup(m0)}`} factors out: x = 0${m0 > 1 ? ` (${multiplicityWord(m0)})` : ''}, leaving ${polyText(cur).text}.`)
    }
    // 2. rational zeros by synthetic division
    // (a linear or quadratic leftover is solved directly below: no candidates to try)
    if (cur.length - 1 >= 3) {
      const ints = integerize(cur)
      const d0 = ints ? divisors(ints[ints.length - 1]) : null
      const dn = ints ? divisors(ints[0]) : null
      if (ints && d0 && dn && d0.length * dn.length <= 4000) {
        const cands: { p: bigint; q: bigint }[] = []
        const seen = new Set<string>()
        for (const p of d0) for (const q of dn) {
          if (bgcd(p, q) !== 1n) continue
          for (const s of [1n, -1n]) {
            const key = `${s * p}/${q}`
            if (seen.has(key)) continue
            seen.add(key)
            cands.push({ p: s * p, q })
          }
        }
        cands.sort((a, b) => Math.abs(Number(a.p) / Number(a.q)) - Math.abs(Number(b.p) / Number(b.q)) || Number(b.p) - Number(a.p))
        const shown = cands.slice(0, 12).map((c) => fracText(c.p, c.q))
        const tested: string[] = []
        for (const c of cands) {
          if (cur.length - 1 <= 2) break
          const a = ratOf(Number(c.p), Number(c.q))
          let mult = 0
          for (;;) {
            if (cur.length - 1 < 1) break
            const sd = syntheticDivision(cur, a)
            if (!sd || !isRat(sd.remainder) || numValue(sd.remainder) !== 0 || !sd.quotient.every(isRat)) break
            cur = sd.quotient
            mult++
          }
          if (mult === 0) continue
          const xt = fracText(c.p, c.q)
          tested.push(xt)
          zeros.push({ kind: 'real', re: Number(c.p) / Number(c.q), im: 0, mult, exact: true, text: xt, tex: fracTex(c.p, c.q), count: mult })
          const div = divisorText(a, true).text
          steps.push(
            `x = ${xt} is a zero${mult > 1 ? ` (${multiplicityWord(mult)})` : ''}: synthetic division by ${div}${mult > 1 ? ` ${mult} times` : ''} leaves ${polyText(cur, true).text}.`,
          )
        }
        if (steps.length === (m0 > 0 ? 1 : 0)) {
          steps.push(`Rational root theorem: the candidates ${shown.join(', ')}${cands.length > 12 ? ', …' : ''} — none is a zero.`)
        } else {
          steps.unshift(`Rational root theorem: candidates ±p/q with p dividing ${babs(ints[ints.length - 1])} and q dividing ${ints[0]}: ${shown.join(', ')}${cands.length > 12 ? ', …' : ''}.`)
        }
      }
    }
    // 4. a cubic or higher with no rational zeros: rational quadratic factors from numeric pairs
    const solveRest = (start: Num[], k: number): void => {
      let rest0 = start
      let guard = 0
      while (rest0.length - 1 >= 3 && guard++ < 4) {
        const zs = aberth(rest0.map(numValue))
        let found = false
        for (let i = 0; i < zs.length && !found; i++) {
          for (let j = i + 1; j < zs.length && !found; j++) {
            const s = cadd(zs[i], zs[j])
            const p = cmul(zs[i], zs[j])
            if (Math.abs(s[1]) > 1e-6 * Math.max(1, cabs(s)) || Math.abs(p[1]) > 1e-6 * Math.max(1, cabs(p))) continue
            const sq = smallFraction(s[0])
            const pq = smallFraction(p[0])
            if (!sq || !pq) continue
            const quad: Num[] = [{ p: 1, q: 1 }, ratOf(-(sq as { p: number; q: number }).p, (sq as { p: number; q: number }).q), pq]
            const first = divideExact(rest0, quad)
            if (!first) continue
            let rest: Num[] = first
            let mult = 1
            for (;;) {
              const again: Num[] | null = rest.length - 1 >= 2 ? divideExact(rest, quad) : null
              if (!again) break
              rest = again
              mult++
            }
            const m = mult * k
            steps.push(`${polyText(quad, true).text} is a factor${m > 1 ? ` (${multiplicityWord(m)})` : ''} — found from the numeric zeros, confirmed by exact division — leaving ${polyText(rest, true).text}.`)
            pushQuadratic(quad, m)
            rest0 = rest
            found = true
          }
        }
        if (!found) break
      }
      // 3. what is left
      const deg = rest0.length - 1
      const each = k > 1 ? ` (each ${multiplicityWord(k)})` : ''
      if (deg === 1) {
        const a = rest0[0] as { p: number; q: number }
        const b = rest0[1] as { p: number; q: number }
        const x = ratOf(-b.p * a.q, b.q * a.p) as { p: number; q: number }
        const xt = fracText(BigInt(x.p), BigInt(x.q))
        zeros.push({ kind: 'real', re: x.p / x.q, im: 0, mult: k, exact: true, text: xt, tex: fracTex(BigInt(x.p), BigInt(x.q)), count: k })
        if (n > 1) steps.push(`${polyText(rest0, true).text} = 0 gives x = ${xt}${k > 1 ? ` (${multiplicityWord(k)})` : ''}.`)
      } else if (deg === 2) {
        disc = discriminantOf(rest0, true)
        const before = zeros.length
        pushQuadratic(rest0, k)
        const added = zeros.slice(before).map((z) => z.text).join(', ')
        if (n > 2) steps.push(`${polyText(rest0, true).text} = 0 by the quadratic formula: ${disc.sentence}, x = ${added}${each}.`)
      } else if (deg >= 3) {
        steps.push(`${polyText(rest0, true).text} has no rational zeros; its zeros are found numerically (≈, to 4 decimals)${each}.`)
        const got = numericEntries(rest0.map(numValue))
        if (!got) {
          failed = true
          return
        }
        zeros.push(...got.map((z) => ({ ...z, mult: z.mult * k, count: z.count * k })))
      }
    }
    // Repeated factors come off exactly first (see "Repeated factors" above):
    // what is handed on is square-free, its zeros simple.
    const ints = cur.length - 1 >= 3 ? integerize(cur) : null
    const parts = ints ? squareFreeParts(ints) : null
    const partNums = parts ? parts.map((q) => ({ poly: bToNum(q.poly), mult: q.mult })) : null
    if (partNums && parts!.some((q) => q.mult > 1) && partNums.every((q) => q.poly !== null)) {
      const factors = partNums
        .map((q) => `(${polyText(q.poly!, true).text})${q.mult > 1 ? sup(q.mult) : ''}`)
        .join('')
      const lead = numValue(cur[0]) / partNums.reduce((acc, q) => acc * numValue(q.poly![0]) ** q.mult, 1)
      const leadText = Math.abs(lead - 1) < 1e-12 ? '' : numCell(smallFraction(lead) ?? { d: lead }, true).text
      steps.push(`Repeated factors, found exactly from gcd(p, p′): ${polyText(cur, true).text} = ${leadText}${factors}.`)
      for (const q of partNums) solveRest(q.poly!, q.mult)
    } else {
      solveRest(cur, 1)
    }
    if (failed) return null
  } else {
    // decimals that are not rational: the quadratic formula in doubles, or numerically
    if (n === 2) disc = discriminantOf(cur, false)
    steps.push('The coefficients are decimals, so the zeros are found numerically (≈, to 4 decimals).')
    const got = numericEntries(cur.map(numValue))
    if (!got) return null
    zeros.push(...got)
  }

  // order: real zeros left to right, then the pairs
  const rank = (z: CZero): number => (z.kind === 'complex-pair' ? 1 : 0)
  zeros.sort((a, b) => rank(a) - rank(b) || a.re - b.re || a.im - b.im)
  // the same exact zero from two routes (a quadratic factor met twice) is one entry
  const merged: CZero[] = []
  for (const z of zeros) {
    const prev = merged.find((m) => m.exact && z.exact && m.text === z.text)
    if (prev) {
      prev.mult += z.mult
      prev.count += z.count
    } else merged.push({ ...z })
  }
  const real = merged.filter((z) => z.kind !== 'complex-pair').reduce((s, z) => s + z.count, 0)
  const nonReal = merged.filter((z) => z.kind === 'complex-pair').reduce((s, z) => s + z.count, 0)
  if (real + nonReal !== n) return null
  const pairs = nonReal / 2
  const exact = merged.every((z) => z.exact)
  const fta =
    `Degree ${n}: ${n} zero${n === 1 ? '' : 's'} counted with multiplicity` +
    ` — ${real} real, ${nonReal} non-real${pairs > 0 ? ` (${pairs} conjugate pair${pairs > 1 ? 's' : ''})` : ''}.`
  const graphNote =
    nonReal === 0
      ? 'Every zero is real: each one is where the graph crosses or touches the x-axis.'
      : real === 0
        ? `The graph never meets the x-axis: all ${nonReal} zeros are non-real, and non-real zeros do not appear on the graph.`
        : `The real zeros are where the graph crosses or touches the x-axis; the ${nonReal} non-real zero${nonReal > 1 ? 's do' : ' does'} not appear on the graph.`
  if (n === 2 && !disc) disc = discriminantOf(desc, exactCoeffs)
  return { degree: n, poly: polyText(desc, true), zeros: merged, real, nonReal, pairs, exact, discriminant: disc, steps, fta, graphNote }
}

/** The zeros over ℂ of y = f(x) when f is a polynomial of degree 2–8; null otherwise. */
export function curveComplexZeros(f: (x: number) => number): ComplexZeros | null {
  const desc = polynomialCoeffs(f)
  if (!desc || desc.length - 1 < 2) return null
  return complexZeros(desc)
}

/** One entry as the card prints it: "x = 1 (double)", "x = −1/2 ± (√3/2)i", "x ≈ 0.3090 ± 0.9511i". */
export function zeroLine(z: CZero): string {
  const m = z.mult > 1 ? ` (${multiplicityWord(z.mult)})` : ''
  return `x ${z.exact ? '=' : '≈'} ${z.text}${m}`
}

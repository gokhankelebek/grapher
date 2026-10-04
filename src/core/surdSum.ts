// ============================================================================
// src/core/surdSum.ts — exact arithmetic on sums of square roots.
//
//   A SurdSum is c₁ + c₂√k₂ + c₃√k₃ + … with rational cᵢ and square-free kᵢ:
//   an element of the field Q(√k₂, √k₃, …). Sums, products and — what makes
//   it worth having — QUOTIENTS stay in it, so the incentre of a triangle
//   with integer vertices, I = (aA + bB + cC)/(a + b + c) with a = |BC| …,
//   is computed exactly rather than recognised from a float:
//
//     △(6,7),(3,9),(4,−9):  a + b + c = 6√13 + 2√65,  Iₓ = 9 − 2√5
//
//   The inverse rationalises one prime at a time: write x = u + v√p with u
//   and v free of √p, multiply by the conjugate u − v√p, and √p is gone from
//   the denominator (u² − p·v²). Each step removes a prime and adds none, so
//   it ends; a numerator or denominator past the safe integers gives null,
//   and the caller falls back to a decimal.
//
// Pure: no DOM.
// ============================================================================

import type { Measure, Rat, Surd } from './geometry'
import { measureOfTerms, rat, ratAdd, ratDiv, ratMul, sqrtRat, squareFree } from './geometry'

/** Square-free radicand → its (nonzero) coefficient; radicand 1 is the rational part. */
export type SurdSum = ReadonlyMap<number, Rat>

export const SS_ZERO: SurdSum = new Map()

export function ssRat(r: Rat | null): SurdSum | null {
  if (!r) return null
  return r.n === 0 ? SS_ZERO : new Map([[1, r]])
}

export function ssSurd(s: Surd | null): SurdSum | null {
  if (!s) return null
  return s.c.n === 0 ? SS_ZERO : new Map([[s.k, s.c]])
}

/** √r for a rational r ≥ 0, as a SurdSum. */
export const ssSqrt = (r: Rat | null): SurdSum | null => ssSurd(sqrtRat(r))

export function ssAdd(a: SurdSum | null, b: SurdSum | null): SurdSum | null {
  if (!a || !b) return null
  const out = new Map(a)
  for (const [k, c] of b) {
    const had = out.get(k)
    const next = had ? ratAdd(had, c) : c
    if (!next) return null
    if (next.n === 0) out.delete(k)
    else out.set(k, next)
  }
  return out
}

export function ssScale(a: SurdSum | null, r: Rat | null): SurdSum | null {
  if (!a || !r) return null
  if (r.n === 0) return SS_ZERO
  const out = new Map<number, Rat>()
  for (const [k, c] of a) {
    const m = ratMul(c, r)
    if (!m) return null
    out.set(k, m)
  }
  return out
}

export const ssNeg = (a: SurdSum | null): SurdSum | null => ssScale(a, { n: -1, d: 1 })
export const ssSub = (a: SurdSum | null, b: SurdSum | null): SurdSum | null => ssAdd(a, ssNeg(b))

export function ssMul(a: SurdSum | null, b: SurdSum | null): SurdSum | null {
  if (!a || !b) return null
  let out: SurdSum | null = SS_ZERO
  for (const [k1, c1] of a) {
    for (const [k2, c2] of b) {
      // √k₁·√k₂ = √(k₁k₂) = s√k with k square-free
      const sf = squareFree(k1 * k2)
      if (!sf) return null
      const [sq, k] = sf
      const c = ratMul(ratMul(c1, c2), rat(sq))
      if (!c) return null
      out = ssAdd(out, new Map([[k, c]]))
      if (!out) return null
    }
  }
  return out
}

function smallestPrime(m: number): number {
  for (let p = 2; p * p <= m; p++) if (m % p === 0) return p
  return m
}

/** 1/x, exactly; null for 0 or when the numbers outgrow the safe integers. */
export function ssInv(x: SurdSum | null): SurdSum | null {
  if (!x || x.size === 0) return null
  let num: SurdSum | null = new Map([[1, { n: 1, d: 1 }]])
  let den: SurdSum | null = x
  for (let guard = 0; guard < 12 && den; guard++) {
    const ks: number[] = [...den.keys()].filter((k) => k !== 1)
    if (ks.length === 0) {
      const c = den.get(1)
      if (!c) return null
      return ssScale(num, ratDiv({ n: 1, d: 1 }, c))
    }
    const p = smallestPrime(Math.min(...ks))
    // the conjugate in √p: every term whose radicand holds p changes sign
    const conj = new Map<number, Rat>()
    for (const [k, c] of den) conj.set(k, k % p === 0 ? { n: -c.n, d: c.d } : c)
    num = ssMul(num, conj)
    den = ssMul(den, conj)
  }
  return null
}

export const ssDiv = (a: SurdSum | null, b: SurdSum | null): SurdSum | null => ssMul(a, ssInv(b))

export function ssValue(a: SurdSum): number {
  let v = 0
  for (const [k, c] of a) v += (c.n / c.d) * Math.sqrt(k)
  return v
}

/** The terms, rational part first. */
export const ssTerms = (a: SurdSum): Surd[] => [...a.entries()].sort((x, y) => x[0] - y[0]).map(([k, c]) => ({ c, k }))

/** More terms than this is exact but unreadable: a decimal says more. */
export const SS_MAX_TERMS = 3

/**
 * The measure of an exact value: "9 − 2√5", "(√3 − 1)/2", "3√5/2". Null when
 * it has more than SS_MAX_TERMS terms or a numeral past 10⁶ — the caller
 * then shows a decimal (with "≈"), never a recognised float.
 */
export function ssMeasure(a: SurdSum | null): Measure | null {
  if (!a) return null
  if (a.size > SS_MAX_TERMS) return null
  for (const c of a.values()) if (Math.abs(c.n) > 1e6 || c.d > 1e6) return null
  return measureOfTerms(ssTerms(a), ssValue(a))
}

/** Is it rational (no surd term)? */
export const ssIsRat = (a: SurdSum): boolean => [...a.keys()].every((k) => k === 1)

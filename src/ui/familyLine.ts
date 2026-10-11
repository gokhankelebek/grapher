// ============================================================================
// src/ui/familyLine.ts — a family section on a line with a domain RESTRICTION.
//
//     d(t) = 3 sin(πt/6) + 8 {0 <= t <= 24}
//
// is still a sinusoid: amplitude 3, period 12, midline 8. The family readers
// (sinusoid, exponential, logarithm, logistic, factored, transformation — the
// safeRead* functions in the *Links.ts modules) read the formula WITHOUT its
// restriction (familyBase), every rewrite a family section or a board handle
// makes puts the restriction back on — and keeps the line in t when it was
// typed in t (keepRestriction) — and whatever a section
// states as a point — a key point, an image, a y-intercept — is shown only
// when it lies in the domain (familyRestriction(src).within). Facts about the
// whole real line (domain, range, end behaviour) are left to the card's own
// Domain rows, which read the restricted line itself (factsWithin).
//
// Only a SINGLE restricted formula counts: a line of several pieces is a
// piecewise function, and its Piecewise section speaks for it. Conics are
// implicit, and the parser refuses a restriction on an implicit line, so a
// conic never has one.
//
// Pure: no React, no App state.
// ============================================================================

import { analyzeExpr, compileExpr, parseExpression, piecewiseParts } from '../core/parse'
import { newCtx, parseCondition } from '../core/parse/condition'
import type { Piece } from '../core/parse/condition'

/** A single formula's restriction, read. */
export interface FamilyRestriction {
  /** The condition as typed: "0 <= t <= 24". */
  cond: string
  /** Is this value of the independent variable in the domain? Always true for a slider bound. */
  within(x: number): boolean
  /** The domain's ends (±∞ when open-ended; NaN for a slider bound). */
  lo: number
  hi: number
}

interface Split {
  base: string
  cond: string
}

const splitCache = new Map<string, Split | null>()

/** One restricted formula → its formula line and its condition; null for anything else. */
function split(src: string): Split | null {
  const hit = splitCache.get(src)
  if (hit !== undefined) return hit
  let out: Split | null = null
  try {
    const parts = piecewiseParts(src)
    if (parts && parts.restricted && parts.branches.length === 1) {
      const b = parts.branches[0]
      if (!b.otherwise && b.cond.trim() !== '' && b.expr.trim() !== '') {
        out = { base: parts.head ? `${parts.head} = ${b.expr}` : b.expr, cond: b.cond.trim() }
      }
    }
  } catch {
    out = null
  }
  if (splitCache.size > 500) splitCache.clear()
  splitCache.set(src, out)
  return out
}

/**
 * The line a family section reads: a single restricted formula without its
 * restriction ("d(t) = 3sin(pi t/6) + 8"); any other line as it is.
 */
export function familyBase<T extends string | undefined | null>(src: T): T {
  if (typeof src !== 'string') return src
  const s = split(src)
  return (s ? s.base : src) as T
}

const contains = (q: Piece, x: number): boolean =>
  (x > q.lo || (x === q.lo && q.loC)) && (x < q.hi || (x === q.hi && q.hiC))

/** The restriction of a single restricted formula, or null (none, or a piecewise line). */
export function familyRestriction(src: string | undefined | null): FamilyRestriction | null {
  if (typeof src !== 'string') return null
  const s = split(src)
  if (!s) return null
  let pieces: Piece[] | null = null
  try {
    pieces = parseCondition(s.cond, newCtx(analyzeExpr))
  } catch {
    pieces = null // a slider bound (x <= a): nothing is filtered
  }
  if (!pieces || pieces.length === 0) {
    return { cond: s.cond, within: () => true, lo: Number.NaN, hi: Number.NaN }
  }
  const ps = pieces
  // Tolerant at a closed end: a key point computed as 24.000000000000004 is the end.
  const tol = (x: number): number => 1e-9 * Math.max(1, Math.abs(x))
  return {
    cond: s.cond,
    within: (x) =>
      Number.isFinite(x) &&
      ps.some(
        (q) =>
          contains(q, x) ||
          (q.loC && Math.abs(x - q.lo) <= tol(x)) ||
          (q.hiC && Math.abs(x - q.hi) <= tol(x)),
      ),
    lo: Math.min(...ps.map((q) => q.lo)),
    hi: Math.max(...ps.map((q) => q.hi)),
  }
}

/** The variable a function line is written in: its head's (d(t) = …), else t when only t appears. */
function lineVar(src: string): 'x' | 't' {
  const eq = src.indexOf('=')
  const head = eq >= 0 ? src.slice(0, eq) : ''
  const m = /^\s*[A-Za-z]\s*\(\s*([xt])\s*\)\s*$/.exec(head)
  if (m) return m[1] === 't' ? 't' : 'x'
  const c = compileExpr(eq >= 0 ? src.slice(eq + 1) : src)
  return c.ok && c.expr.vars.includes('t') && !c.expr.vars.includes('x') ? 't' : 'x'
}

/**
 * The independent variable of a function curve, from the line as typed:
 * 't' for C(t) = {…} or d(t) = 3sin(πt/6) + 8 {0 <= t <= 24}, else 'x' (a
 * sketch, a library family, anything without a source). The Domain rows,
 * the Restrict editor and the Table speak in it.
 */
export function lineVariable(src: string | undefined | null): 'x' | 't' {
  if (typeof src !== 'string' || src.trim() === '') return 'x'
  try {
    const s = split(src)
    if (lineVar(s ? s.base : src) === 't') return 't'
    // a piecewise body the expression compiler does not read: y = {… if 0 < t <= 1, …}
    return /(?<![A-Za-z_])t(?![A-Za-z_(])/.test(src) && !/(?<![A-Za-z_])x(?![A-Za-z_(])/.test(src) ? 't' : 'x'
  } catch {
    return 'x'
  }
}

/** `next` written in t: f(x) = … → f(t) = …, every x → t. Null when that does not parse as a function. */
function inT(next: string): string | null {
  const out = next.replace(/\bx\b/g, 't')
  const o = parseExpression(out)
  return o.ok && o.plot.kind === 'explicit' ? out : null
}

/**
 * A family section or a board handle rewrote `prev`'s formula as `next`.
 * What the teacher typed around the formula stays: its variable (the family
 * cores write x — d(t) = 3sin(pi t/6) + 8 stays a function of t) and its
 * restriction (put back on in braces). A `next` that already has a
 * condition, or a `prev` that is neither, is returned as it is.
 */
export function keepRestriction(prev: string | undefined | null, next: string): string {
  if (typeof prev !== 'string') return next
  try {
    if (piecewiseParts(next) !== null) return next
  } catch {
    return next
  }
  const s = split(prev)
  const base = s ? s.base : prev
  let line = next.trimEnd()
  if (lineVar(base) === 't' && lineVar(line) === 'x') line = inT(line) ?? line
  return s ? `${line} {${s.cond}}` : line
}

// ----------------------------------------------------------------------------
// what a section states, on a restricted line
// ----------------------------------------------------------------------------

/** "(−2, 3)", "(π/4, 1)" → the x it names, or null. */
export function pointX(text: string): number | null {
  const m = /\(\s*([^,()]+(?:\([^()]*\)[^,()]*)*)\s*,/.exec(text)
  if (!m) return null
  const t = m[1]
    .trim()
    .replace(/−/g, '-')
    .replace(/π/g, 'pi')
    .replace(/√\(/g, 'sqrt(')
    .replace(/√([\d.]+)/g, 'sqrt($1)')
    .replace(/∞/g, 'inf')
  const a = analyzeExpr(t)
  return a.ok && a.free.length === 0 && Number.isFinite(a.value) ? a.value : null
}

/**
 * A family section's facts on a restricted line: the domain, the range and
 * the end behaviour are the card's Domain rows' to state (they read the
 * restriction; these would not), and a stated point outside the domain is
 * not a point of this function. Unrestricted: as they are.
 */
export function factsWithin(lines: readonly string[], r: FamilyRestriction | null | undefined): string[] {
  if (!r) return lines.slice()
  return lines.filter((t) => {
    if (/^\s*(domain|range)\b/i.test(t)) return false
    if (/→\s*[−-]?\s*∞/.test(t)) return false
    const x = pointX(t)
    return x === null || r.within(x)
  })
}

/** Points (anything with an x) inside the domain; all of them when unrestricted. */
export function pointsWithin<T>(points: readonly T[], x: (p: T) => number, r: FamilyRestriction | null | undefined): T[] {
  return r ? points.filter((p) => r.within(x(p))) : points.slice()
}

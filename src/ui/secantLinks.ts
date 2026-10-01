// ============================================================================
// src/ui/secantLinks.ts — the secant link: the average rate of change of f over
// [a, b], the Mean Value Theorem (and Rolle's) on the same interval, and the
// average value of f there.
//
// src/core/mvt.ts owns the mathematics (the secant, the two hypotheses, every
// c, f_avg). This module owns what a teacher SEES of it: the sentences on the
// card, in AP language and with exact numbers where they are exact —
//
//     (f(3) − f(1))/(3 − 1) = (9 − 1)/2 = 4
//     secant line: y − 1 = 4(x − 1)
//     f is not differentiable at x = 0, so the MVT does not apply.
//     f_avg = (1/(3 − 0))∫₀³ f(x) dx = 9/3 = 3
//
// — and the figure: the secant (solid between its two points, faint beyond
// them), the tangent at each c (dashed, parallel to it), the rectangle whose
// area is the integral and its lid y = f_avg, and a chip naming each c.
//
// Everything is recomputed from the link { a, b, mvt?, avg? } on every change;
// nothing computed is stored. One analysis per (curve, a, b) is cached, so the
// card and the board — both built on every frame of a drag — share it.
//
// Pure: no React, no DOM, no canvas.
// ============================================================================

import type { FittedCurve, ModelSpec, Vec2 } from '../core/types'
import type { Overlay } from '../render/overlays'
import type { SecantLink } from '../core/persist'
import type { ExactForm } from '../core/exact'
import { exactForm } from '../core/exact'
import {
  averageValue,
  continuityOn,
  differentiabilityOn,
  mvtPoints,
  mvtSourceOf,
  secantOf,
} from '../core/mvt'
import type {
  AverageValue,
  ContinuityFailure,
  MvtPoints,
  MvtSource,
  Secant,
  SmoothnessFailure,
  Solution,
} from '../core/mvt'
import { calcKey } from './reveal'

export type { SecantLink }

/** The secant's extension beyond its two points: this much of the colour. */
export const SECANT_EXTENSION_ALPHA = 0.42
/** The secant between its points, and the lid y = f_avg: stroke weights in CSS px. */
export const SECANT_WIDTH = 2.5
export const AVG_LINE_WIDTH = 2
/** The rectangle of height f_avg: its wash. */
export const AVG_RECT_ALPHA = 0.16
/** At most this many c's get a tangent line / dot, and this many get a chip. */
const MAX_MARKED = 24
const MAX_CHIPS = 8

// ---------------------------------------------------------------------------
// Numbers, the way a teacher writes them
// ---------------------------------------------------------------------------

const MINUS = '−'

/** "3", "−1/2", "π/2", "2√3/3" — a closed form when it is one, else three places. */
export function numText(v: number): string {
  if (!Number.isFinite(v)) return '—'
  if (v === 0) return '0'
  const ex = exactForm(v)
  if (ex) return ex.text
  return decimal(v)
}

/** Three places, trailing zeros dropped, a real minus sign. */
export function decimal(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const mag = Math.abs(v)
  if (mag !== 0 && (mag >= 1e7 || mag < 5e-4)) {
    return v.toExponential(2).replace('-', MINUS)
  }
  const s = v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
  return (s === '-0' ? '0' : s).replace('-', MINUS)
}

/** The same number in LaTeX. */
function numTex(v: number): string {
  if (!Number.isFinite(v)) return '\\text{—}'
  if (v === 0) return '0'
  const ex = exactForm(v)
  if (ex) return ex.tex
  return decimal(v).replace(MINUS, '-')
}

/** True when numText(v) states v exactly (a closed form, or a short decimal that IS v). */
export function isExactText(v: number): boolean {
  if (!Number.isFinite(v)) return false
  if (v === 0 || exactForm(v)) return true
  const t = Math.round(v * 1000) / 1000
  return Math.abs(t - v) <= 1e-12 * Math.max(1, Math.abs(v))
}

/** A value inside an expression: negatives are parenthesised, "−(−8)" never. */
const paren = (t: string): string => (t.startsWith(MINUS) ? `(${t})` : t)
const parenTex = (t: string): string => (t.startsWith('-') ? `\\left(${t}\\right)` : t)

/**
 * "c = √3", "c ≈ 0.541" — and a whole stretch as the open interval it is,
 * "every c in (1, 2)": c is strictly between a and b in the theorem, and a
 * stretch's ends are where a piece starts or stops (the core makes them exact).
 */
export function solutionText(s: Solution, name = 'c'): string {
  if (s.to !== undefined) {
    return `${name} in (${s.exact ? s.exact.text : decimal(s.x)}, ${s.toExact ? s.toExact.text : decimal(s.to)})`
  }
  return s.exact ? `${name} = ${s.exact.text}` : `${name} ≈ ${decimal(s.x)}`
}

/** The same in LaTeX: "c = \\sqrt{3}", "c \\approx 0.541", "\\text{every } c \\in (1, 2)". */
export function solutionTex(s: Solution, name = 'c'): string {
  const dec = (v: number): string => decimal(v).replace(MINUS, '-')
  if (s.to !== undefined) {
    const lo = s.exact ? s.exact.tex : dec(s.x)
    const hi = s.toExact ? s.toExact.tex : dec(s.to)
    const who = name.startsWith('every ') ? `\\text{every } ${name.slice(6)}` : name
    return `${who} \\in \\left(${lo}, ${hi}\\right)`
  }
  return s.exact ? `${name} = ${s.exact.tex}` : `${name} \\approx ${dec(s.x)}`
}

/**
 * Every c, as the card says them: "c = ±2√3/3 ≈ ±1.155", "c = π/2 ≈ 1.571",
 * "c ≈ 0.541", "every c in (1, 2)". A symmetric pair is written once with ±.
 */
export function solutionsText(points: readonly Solution[]): string {
  if (points.length === 0) return ''
  const withDec = (s: Solution): string => {
    if (s.to !== undefined) return solutionText(s, 'every c')
    if (!s.exact) return `c ≈ ${decimal(s.x)}`
    const dec = decimal(s.x)
    return s.exact.text === dec ? `c = ${dec}` : `c = ${s.exact.text} ≈ ${dec}`
  }
  if (
    points.length === 2 &&
    points[0].to === undefined &&
    points[1].to === undefined &&
    points[0].x !== 0 &&
    Math.abs(points[0].x + points[1].x) <= 1e-9 * Math.max(1, Math.abs(points[1].x))
  ) {
    const pos = points[1].x > 0 ? points[1] : points[0]
    const dec = decimal(pos.x)
    if (pos.exact) {
      return pos.exact.text === dec ? `c = ±${dec}` : `c = ±${pos.exact.text} ≈ ±${dec}`
    }
    return `c ≈ ±${dec}`
  }
  const shown = points.slice(0, 6).map(withDec)
  const more = points.length > 6 ? ` … (${points.length} in all)` : ''
  // "c = 1/2 ≈ 0.5, c = 3/2 ≈ 1.5" reads as two answers; so does a list.
  return shown.join('; ') + more
}

const SUB = '₀₁₂₃₄₅₆₇₈₉'
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹'
const small = (v: number): boolean => Number.isInteger(v) && v >= 0 && v < 1000
const script = (v: number, table: string): string =>
  String(v)
    .split('')
    .map((d) => table[Number(d)])
    .join('')

/** "∫₀³", or "∫ from −1 to 2" when a bound is not a small whole number. */
function integralText(a: number, b: number): string {
  if (small(a) && small(b)) return `∫${script(a, SUB)}${script(b, SUP)} f(x) dx`
  return `∫ from ${numText(a)} to ${numText(b)} of f(x) dx`
}

// ---------------------------------------------------------------------------
// The analysis, cached
// ---------------------------------------------------------------------------

export interface SecantAnalysis {
  src: MvtSource | null
  sec: Secant | null
  cont: ContinuityFailure[]
  diff: SmoothnessFailure[]
  mvt: MvtPoints | null
  avg: AverageValue | null
}

const SERIALS = new WeakMap<object, number>()
let serialNext = 1
const serialOf = (o: object | undefined): number => {
  if (!o) return 0
  let n = SERIALS.get(o)
  if (n === undefined) {
    n = serialNext++
    SERIALS.set(o, n)
  }
  return n
}

/**
 * f(x) the way secantOf reads it: the exact value when the source has one
 * (NaN at the hole of (x² − 1)/(x − 1)), else f as drawn.
 */
function valueAt(src: MvtSource, x: number): number {
  if (src.exactAt) {
    try {
      const e = src.exactAt(x)
      if (typeof e === 'number') return e
    } catch {
      /* fall through */
    }
  }
  try {
    return src.f(x)
  } catch {
    return NaN
  }
}

const CACHE = new Map<string, SecantAnalysis>()
const CACHE_MAX = 64

/**
 * The secant, the hypotheses, every c and the average value — for this curve
 * as it is now, over [a, b]. `want` skips the parts nobody asked for (the
 * hypotheses and c's without the MVT switch, f_avg without its switch), which
 * is what keeps a bare secant cheap to drag.
 */
export function analyzeSecant(
  link: Pick<SecantLink, 'a' | 'b' | 'mvt' | 'avg'>,
  parent: FittedCurve,
  models: Record<string, ModelSpec>,
  /**
   * The state of every curve this one calls (App's depKeys[parent.id]): p(x)
   * = h(x) + 1 changes when h is retyped although p's own model, params and
   * domain do not.
   */
  dep = '',
): SecantAnalysis {
  const spec = models[parent.modelId]
  const wantMvt = link.mvt === true
  const wantAvg = link.avg === true
  const key = [
    parent.modelId,
    serialOf(spec),
    parent.params.join(','),
    parent.domain ? parent.domain.join(',') : '',
    dep,
    link.a,
    link.b,
    wantMvt ? 1 : 0,
    wantAvg ? 1 : 0,
  ].join('|')
  const hit = CACHE.get(key)
  if (hit) {
    CACHE.delete(key)
    CACHE.set(key, hit)
    return hit
  }
  const out: SecantAnalysis = { src: null, sec: null, cont: [], diff: [], mvt: null, avg: null }
  try {
    out.src = mvtSourceOf(parent, models)
  } catch {
    out.src = null
  }
  const src = out.src
  if (src) {
    try {
      out.sec = secantOf(src, link.a, link.b)
    } catch {
      out.sec = null
    }
    if (wantMvt || wantAvg) {
      try {
        out.cont = continuityOn(src, link.a, link.b)
      } catch {
        out.cont = []
      }
    }
    if (wantMvt) {
      try {
        out.diff = differentiabilityOn(src, link.a, link.b)
      } catch {
        out.diff = []
      }
      if (out.sec) {
        try {
          out.mvt = mvtPoints(src, link.a, link.b, out.sec.m)
        } catch {
          out.mvt = null
        }
      }
    }
    if (wantAvg && !out.cont.some(blocksIntegral)) {
      try {
        out.avg = averageValue(src, link.a, link.b)
      } catch {
        out.avg = null
      }
    }
  }
  CACHE.set(key, out)
  while (CACHE.size > CACHE_MAX) {
    const oldest = CACHE.keys().next().value
    if (oldest === undefined) break
    CACHE.delete(oldest)
  }
  return out
}

/** A failure the integral cannot get past (a jump or a hole it can). */
const blocksIntegral = (c: ContinuityFailure): boolean =>
  c.kind === 'pole' || c.kind === 'domain' || (c.kind === 'undefined' && c.to !== undefined)

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export interface Hypothesis {
  ok: boolean
  text: string
}

export interface TheoremRows {
  /** "Mean Value Theorem: f′(c) = 4" / "Rolle's theorem: f′(c) = 0" */
  title: string
  rolle: boolean
  hyps: Hypothesis[]
  /** Both hypotheses hold. */
  ok: boolean
  /** The conclusion, or why the theorem does not apply. */
  verdict: string
  /** "c = ±2√3/3 ≈ ±1.155", "Still, f′(c) = 1/3 at c ≈ …", or "No c in … has …" */
  points: string | null
}

export interface AverageRows {
  /** "f_avg = (1/(3 − 0))∫₀³ f(x) dx = 9/3 = 3" */
  text: string
  tex: string
  /** "f(c) = f_avg at c = √3 ≈ 1.732" */
  points: string | null
  /** A caveat that does not stop the number (a jump: c is not guaranteed). */
  note: string | null
  /** Set instead of text when there is no average value. */
  problem: string | null
}

/** One secant, as its PARENT's card shows it. */
export interface SecantRow {
  linkId: string
  a: number
  b: number
  aText: string
  bText: string
  fName: string
  mvt: boolean
  avg: boolean
  /** "Average rate of change of f over [1, 3]" */
  head: string
  /** "4", "≈ 0.287" — null when there is no secant */
  value: string | null
  /** "(f(3) − f(1))/(3 − 1) = (9 − 1)/2 = 4" */
  quotient: { text: string; tex: string } | null
  /** "y − 1 = 4(x − 1)" */
  line: { text: string; tex: string } | null
  /** Why there is no secant at all. */
  problem: string | null
  theorem: TheoremRows | null
  average: AverageRows | null
}

/** "(f(3) − f(1))/(3 − 1) = (9 − 1)/2 = 4", and its LaTeX. */
export function quotientOf(sec: Secant, fName = 'f'): { text: string; tex: string } {
  const { a, b, fa, fb, m } = sec
  const at = numText(a)
  const bt = numText(b)
  const fat = numText(fa)
  const fbt = numText(fb)
  const width = b - a
  const wt = numText(width)
  const mt = numText(m)
  const exact = [a, b, fa, fb, width, m].every(isExactText)
  const eq = exact ? '=' : '≈'
  const text =
    `(${fName}(${bt}) − ${fName}(${at}))/(${bt} − ${paren(at)}) = ` +
    `(${fbt} − ${paren(fat)})/${paren(wt)} ${eq} ${mt}`
  const t = (v: number): string => numTex(v)
  const tex =
    `\\dfrac{${fName}(${t(b)}) - ${fName}(${t(a)})}{${t(b)} - ${parenTex(t(a))}} = ` +
    `\\dfrac{${t(fb)} - ${parenTex(t(fa))}}{${t(width)}} ${exact ? '=' : '\\approx'} ${t(m)}`
  return { text, tex }
}

/** "y − 1 = 4(x − 1)", "y + 8 = 4(x + 2)", "y = 4x", "y = 1" — point-slope at (a, f(a)). */
export function pointSlope(sec: Secant): { text: string; tex: string } {
  const { a, fa, m } = sec
  if (m === 0) return { text: `y = ${numText(fa)}`, tex: `y = ${numTex(fa)}` }
  const lhs = fa === 0 ? 'y' : fa < 0 ? `y + ${numText(-fa)}` : `y − ${numText(fa)}`
  const lhsTex = fa === 0 ? 'y' : fa < 0 ? `y + ${numTex(-fa)}` : `y - ${numTex(fa)}`
  const mt = numText(m)
  const coef = m === 1 ? '' : m === -1 ? MINUS : /[/]/.test(mt) ? `(${mt})` : mt
  const coefTex = m === 1 ? '' : m === -1 ? '-' : numTex(m)
  const inner = a === 0 ? 'x' : a < 0 ? `(x + ${numText(-a)})` : `(x − ${numText(a)})`
  const innerTex = a === 0 ? 'x' : a < 0 ? `\\left(x + ${numTex(-a)}\\right)` : `\\left(x - ${numTex(a)}\\right)`
  return { text: `${lhs} = ${coef}${inner}`, tex: `${lhsTex} = ${coefTex}${innerTex}` }
}

const where = (f: { x: number; exact: ExactForm | null }): string =>
  `x = ${f.exact ? f.exact.text : decimal(f.x)}`

/** "a vertical asymptote at x = 0" — what went wrong, as a noun phrase. */
function continuityPhrase(c: ContinuityFailure, fName: string): string {
  switch (c.kind) {
    case 'domain':
      return `${where(c)} is outside the domain of ${fName}`
    case 'pole':
      return `${fName} has a vertical asymptote at ${where(c)}`
    case 'jump':
      return `${fName} has a jump discontinuity at ${where(c)}`
    case 'hole':
      return `${fName} is undefined at ${where(c)} (a removable discontinuity)`
    case 'removable':
      return `${fName}(${c.exact ? c.exact.text : decimal(c.x)}) is not the limit there (a removable discontinuity)`
    case 'undefined':
      return c.to !== undefined
        ? `${fName} is undefined from ${where(c)} to x = ${numText(c.to)}`
        : `${fName} is undefined at ${where(c)}`
  }
}

function smoothnessPhrase(d: SmoothnessFailure): string {
  const noun = d.kind === 'corner' ? 'a corner' : d.kind === 'cusp' ? 'a cusp' : 'a vertical tangent'
  return `${where(d)} (${noun})`
}

/** "[1, 3]" */
const closed = (a: string, b: string): string => `[${a}, ${b}]`
const open = (a: string, b: string): string => `(${a}, ${b})`

/**
 * What the card says about one secant: the average rate of change and its
 * difference quotient, the secant line, and — switched on — the theorem and
 * the average value.
 */
export function secantRow(
  link: SecantLink,
  parent: FittedCurve | undefined,
  models: Record<string, ModelSpec>,
  fName = 'f',
  /** depKeys[parent.id]: the curves this one calls, as they are now. */
  dep = '',
): SecantRow {
  const lo = Math.min(link.a, link.b)
  const hi = Math.max(link.a, link.b)
  const aText = numText(link.a)
  const bText = numText(link.b)
  const loT = numText(lo)
  const hiT = numText(hi)
  const row: SecantRow = {
    linkId: link.id,
    a: link.a,
    b: link.b,
    aText,
    bText,
    fName,
    mvt: link.mvt === true,
    avg: link.avg === true,
    head: `Average rate of change of ${fName} over ${closed(loT, hiT)}`,
    value: null,
    quotient: null,
    line: null,
    problem: null,
    theorem: null,
    average: null,
  }
  if (!parent) {
    row.problem = 'the curve it was measured on is gone'
    return row
  }
  if (link.a === link.b) {
    row.problem = 'a and b are the same point, so there is no secant line'
    return row
  }
  const an = analyzeSecant(link, parent, models, dep)
  if (!an.src) {
    row.problem = `${fName} is not a function of x`
    return row
  }
  const src = an.src
  const sec = an.sec
  if (!sec) {
    // Which end is missing, in words.
    const d = src.domain
    const outside = (x: number): boolean => d !== null && (x < d[0] - 1e-9 || x > d[1] + 1e-9)
    const bad = outside(link.a) ? link.a : outside(link.b) ? link.b : null
    if (bad !== null && d) {
      row.problem = `x = ${numText(bad)} is outside the domain of ${fName} [${numText(d[0])}, ${numText(d[1])}]`
    } else {
      // The same evaluator secantOf used: src.f may be a polynomial fill-in
      // that is finite at a hole, where the exact value is not.
      const fa = valueAt(src, link.a)
      const at = Number.isFinite(fa) ? link.b : link.a
      row.problem = `${fName} is undefined at x = ${numText(at)}, so there is no secant line there`
    }
    return row
  }
  // Oriented left to right, whichever way round a and b were dragged.
  const ordered: Secant =
    sec.a <= sec.b ? sec : { ...sec, a: sec.b, b: sec.a, fa: sec.fb, fb: sec.fa }
  row.value = isExactText(sec.m) ? numText(sec.m) : `≈ ${decimal(sec.m)}`
  row.quotient = quotientOf(ordered, fName)
  row.line = pointSlope(ordered)

  if (link.mvt === true) row.theorem = theoremRows(an, ordered, fName, loT, hiT)
  if (link.avg === true) row.average = averageRows(an, fName, lo, hi, loT, hiT)
  return row
}

function theoremRows(
  an: SecantAnalysis,
  sec: Secant,
  fName: string,
  loT: string,
  hiT: string,
): TheoremRows {
  const fp = `${fName}′`
  const rolle = sec.rolle
  const mT = numText(sec.m)
  const name = rolle ? "Rolle's theorem" : 'the Mean Value Theorem'
  const title = rolle ? `Rolle's theorem: ${fp}(c) = 0` : `Mean Value Theorem: ${fp}(c) = ${mT}`
  const cont = an.cont
  const diff = an.diff
  const hyps: Hypothesis[] = []
  hyps.push(
    cont.length === 0
      ? { ok: true, text: `${fName} is continuous on ${closed(loT, hiT)}` }
      : {
          ok: false,
          text: `${fName} is not continuous on ${closed(loT, hiT)}: ${continuityPhrase(cont[0], fName)}${
            cont.length > 1 ? ` (and ${cont.length - 1} more)` : ''
          }`,
        },
  )
  // A discontinuity inside (a, b) is a point of non-differentiability too.
  const inner = cont.filter((c) => c.x > sec.a && c.x < sec.b && c.kind !== 'domain')
  if (diff.length === 0 && inner.length === 0) {
    hyps.push({ ok: true, text: `${fName} is differentiable on ${open(loT, hiT)}` })
  } else if (diff.length > 0) {
    hyps.push({
      ok: false,
      text: `${fName} is not differentiable at ${diff.slice(0, 3).map(smoothnessPhrase).join(', ')}${
        diff.length > 3 ? ` and ${diff.length - 3} more` : ''
      }`,
    })
  } else {
    hyps.push({ ok: false, text: `${fName} is not differentiable at ${where(inner[0])}, where it is not continuous` })
  }
  if (rolle) {
    hyps.push({ ok: true, text: `${fName}(${loT}) = ${fName}(${hiT}) = ${numText(sec.fa)}` })
  }
  const ok = hyps.every((h) => h.ok)
  const mvt = an.mvt
  let verdict: string
  if (ok) {
    verdict = rolle
      ? `By Rolle's theorem there is a c in ${open(loT, hiT)} with ${fp}(c) = 0:`
      : `By the Mean Value Theorem there is a c in ${open(loT, hiT)} with ${fp}(c) = ${mT}:`
  } else if (!hyps[0].ok) {
    verdict = `${fName} is not continuous on ${closed(loT, hiT)}, so ${name} does not apply.`
  } else {
    const at = diff[0] ?? inner[0]
    verdict = `${fName} is not differentiable at ${where(at)}, so ${name} does not apply.`
  }
  let points: string | null = null
  if (mvt) {
    if (mvt.all) {
      points = `${fp}(x) = ${mT} at every x in ${open(loT, hiT)}: ${fName} is linear there`
    } else if (mvt.points.length > 0) {
      const list = solutionsText(mvt.points)
      points = ok ? list : `Still, ${fp}(c) = ${mT} at ${list}`
    } else {
      points = ok
        ? `No c was found in ${open(loT, hiT)} (numerically)`
        : `No c in ${open(loT, hiT)} has ${fp}(c) = ${mT}.`
    }
  }
  return { title, rolle, hyps, ok, verdict, points }
}

function averageRows(
  an: SecantAnalysis,
  fName: string,
  lo: number,
  hi: number,
  loT: string,
  hiT: string,
): AverageRows {
  const width = hi - lo
  const wT = numText(width)
  const lead = `${fName}_avg = (1/(${hiT} − ${paren(loT)}))${integralText(lo, hi).replace(/f\(x\)/, `${fName}(x)`)}`
  const tLo = numTex(lo)
  const tHi = numTex(hi)
  const leadTex = `${fName}_{\\text{avg}} = \\dfrac{1}{${tHi} - ${parenTex(tLo)}}\\int_{${tLo}}^{${tHi}} ${fName}(x)\\,dx`
  const blocked = an.cont.find(blocksIntegral)
  const miss = (problem: string): AverageRows => ({
    text: `${lead} = —`,
    tex: `${leadTex} = \\text{—}`,
    points: null,
    note: null,
    problem,
  })
  if (blocked) {
    return miss(`${continuityPhrase(blocked, fName)}, so the integral — and the average value — does not exist`)
  }
  const avg = an.avg
  if (!avg) return miss(`the integral of ${fName} over ${closed(loT, hiT)} does not exist`)
  // "=" only when every number shown IS the number: a sketched parabola's
  // integral is exact, and still prints as a rounded decimal.
  const stated = avg.exact && isExactText(avg.value) && isExactText(avg.integral) && isExactText(width)
  const eq = stated ? '=' : '≈'
  const eqTex = stated ? '=' : '\\approx'
  const vT = avg.exact ? numText(avg.value) : avg.form ? avg.form.text : decimal(avg.value)
  const vTex = avg.exact ? numTex(avg.value) : avg.form ? avg.form.tex : decimal(avg.value).replace(MINUS, '-')
  const iT = avg.exact ? numText(avg.integral) : decimal(avg.integral)
  const iTex = avg.exact ? numTex(avg.integral) : decimal(avg.integral).replace(MINUS, '-')
  // "= 9/3 = 3" — the integral over the width, then the value.
  const showsSteps = width !== 1
  const text = showsSteps
    ? `${lead} ${eq} ${paren(iT)}/${paren(wT)} ${eq} ${vT}`
    : `${lead} ${eq} ${vT}`
  const tex = showsSteps
    ? `${leadTex} ${eqTex} \\dfrac{${iTex}}{${numTex(width)}} ${eqTex} ${vTex}`
    : `${leadTex} ${eqTex} ${vTex}`
  let points: string | null = null
  if (avg.points.length > 0) {
    const stretch = avg.points.find((p) => p.to !== undefined)
    points = stretch
      ? `${fName}(c) = ${fName}_avg for ${solutionText(stretch, 'every c')}`
      : `${fName}(c) = ${fName}_avg at ${solutionsText(avg.points)}`
  } else {
    points = `${fName} never equals ${fName}_avg on ${closed(loT, hiT)}`
  }
  const jumpy = an.cont.find((c) => !blocksIntegral(c))
  const note = jumpy
    ? `${continuityPhrase(jumpy, fName)}, so the Mean Value Theorem for integrals does not promise a c`
    : null
  return { text, tex, points, note, problem: null }
}

// ---------------------------------------------------------------------------
// The figure
// ---------------------------------------------------------------------------

/** f″ at x, from three values — enough to say which side a chip is clear on. */
function bend(f: (x: number) => number, x: number, h: number): number {
  const v = f(x + h) - 2 * f(x) + f(x - h)
  return Number.isFinite(v) ? v : 0
}

/**
 * Everything the secants draw, fills first (the average-value rectangle, under
 * the curves) then marks (lines, dots, chips, on them). A hidden or missing
 * parent draws nothing.
 */
export function secantOverlays(
  links: readonly SecantLink[],
  curves: readonly FittedCurve[],
  models: Record<string, ModelSpec>,
  /** App's depKeys: curve id → the state of the curves it calls. */
  deps: Readonly<Record<string, string>> = {},
): Overlay[] {
  const fills: Overlay[] = []
  const lines: Overlay[] = []
  const dots: Overlay[] = []
  const chips: Overlay[] = []
  for (const link of links) {
    const parent = curves.find((c) => c.id === link.parentId)
    if (!parent || !parent.visible) continue
    let an: SecantAnalysis
    try {
      an = analyzeSecant(link, parent, models, deps[parent.id] ?? '')
    } catch {
      continue
    }
    const src = an.src
    const sec = an.sec
    if (!src || !sec) continue
    const id = parent.id
    const A: Vec2 = { x: sec.a, y: sec.fa }
    const B: Vec2 = { x: sec.b, y: sec.fb }
    const span = Math.abs(sec.b - sec.a)
    const h = Math.max(1e-4, span / 200)

    // The average value: the rectangle whose area is the integral, and its lid.
    if (link.avg === true && an.avg) {
      const lo = Math.min(sec.a, sec.b)
      const hi = Math.max(sec.a, sec.b)
      const v = an.avg.value
      fills.push({
        kind: 'region',
        boundary: [
          { x: lo, y: 0 },
          { x: lo, y: v },
          { x: hi, y: v },
          { x: hi, y: 0 },
        ],
        color: parent.color,
        alpha: AVG_RECT_ALPHA,
      })
      lines.push({ kind: 'segment', curveId: id, from: { x: lo, y: v }, to: { x: hi, y: v }, width: AVG_LINE_WIDTH })
      let chipsLeft = MAX_CHIPS
      for (const p of an.avg.points.slice(0, MAX_MARKED)) {
        if (p.to !== undefined) continue
        const at = { x: p.x, y: v }
        dots.push({ kind: 'dot', curveId: id, at })
        if (chipsLeft-- > 0) {
          // Off the side of f's own crossing that the lid does not run along:
          // perpendicular to f there, below-right of a rising crossing.
          const slope = (src.f(p.x + h) - src.f(p.x - h)) / (2 * h)
          chips.push({
            kind: 'label',
            curveId: id,
            at,
            text: solutionText(p),
            answer: calcKey(link.id),
            ...(Number.isFinite(slope) ? { across: { slope, below: true } } : { dir: { x: 1, y: 1 } }),
          })
        }
      }
    }

    // The secant: faint across the board, solid between its two points.
    lines.push({ kind: 'line', curveId: id, at: A, slope: sec.m, alpha: SECANT_EXTENSION_ALPHA, width: 1.5 })
    lines.push({ kind: 'segment', curveId: id, from: A, to: B, width: SECANT_WIDTH })
    dots.push({ kind: 'dot', curveId: id, at: A })
    dots.push({ kind: 'dot', curveId: id, at: B })

    // Where the theorem's second hypothesis fails, said on the figure too: a
    // ring at the corner and a chip — the point the class is meant to look at.
    if (link.mvt === true) {
      for (const d of an.diff.slice(0, MAX_CHIPS)) {
        const y = src.f(d.x)
        if (!Number.isFinite(y)) continue
        const at = { x: d.x, y }
        dots.push({ kind: 'dot', curveId: id, at, hollow: true })
        // Below a corner that opens upward (|x|), above one that opens down.
        const opensUp = d.left !== undefined && d.right !== undefined ? d.left < d.right : true
        chips.push({ kind: 'label', curveId: id, at, text: 'not differentiable', dir: { x: 0, y: opensUp ? 1 : -1 }, answer: calcKey(link.id) })
      }
    }

    // The Mean Value Theorem: the tangent at each c, parallel to the secant.
    if (link.mvt === true && an.mvt && !an.mvt.all) {
      let chipsLeft = MAX_CHIPS
      for (const p of an.mvt.points.slice(0, MAX_MARKED)) {
        if (p.to !== undefined) continue
        const y = src.f(p.x)
        if (!Number.isFinite(y)) continue
        const at = { x: p.x, y }
        lines.push({ kind: 'line', curveId: id, at, slope: sec.m, dashed: true, width: 1.75 })
        dots.push({ kind: 'dot', curveId: id, at })
        if (chipsLeft-- > 0) {
          // Concave up: the curve bends away ABOVE its tangent, so the chip
          // steps off the tangent on the side below it; concave down, above.
          const below = bend(src.f, p.x, h) >= 0
          chips.push({ kind: 'label', curveId: id, at, text: solutionText(p), across: { slope: sec.m, below }, answer: calcKey(link.id) })
        }
      }
    }
  }
  return [...fills, ...lines, ...dots, ...chips]
}

// ---------------------------------------------------------------------------
// Where a fresh one opens
// ---------------------------------------------------------------------------

const round6 = (v: number): number => Math.round(v * 1e6) / 1e6

/** Where this curve lives in x: its domain, its ink, or the visible window. */
function spanOf(curve: FittedCurve, window: [number, number]): [number, number] {
  const d = curve.domain
  const [wlo, whi] =
    Number.isFinite(window[0]) && Number.isFinite(window[1]) && window[1] > window[0] ? window : [-4, 4]
  if (d && Number.isFinite(d[0]) && Number.isFinite(d[1]) && d[1] > d[0]) {
    const lo = Math.max(d[0], wlo)
    const hi = Math.min(d[1], whi)
    return hi > lo ? [lo, hi] : [d[0], d[1]]
  }
  const ink = curve.sourceStroke
  if (ink && ink.length > 1) {
    let lo = Infinity
    let hi = -Infinity
    for (const p of ink) {
      if (!Number.isFinite(p.x)) continue
      if (p.x < lo) lo = p.x
      if (p.x > hi) hi = p.x
    }
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) return [lo, hi]
  }
  return [wlo, whi]
}

/**
 * [a, b] for a fresh secant: two nice numbers inside the part of the view the
 * curve occupies, where f is defined — preferring, in order, a pair whose two
 * points are both on screen (`yWindow`) with f continuous between them, then
 * any pair with f continuous between them, then any pair at all. Whole numbers
 * a quarter of the way in from each side when there is room, then pairs around
 * the middle of the view (x³ in a ±10 view opens on [−2, 2], not [−5, 5] with
 * both points off the top and bottom of the board). Null when f is defined
 * nowhere nearby.
 */
export function defaultSecant(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  window: [number, number],
  yWindow: [number, number] | null = null,
): [number, number] | null {
  const src = mvtSourceOf(curve, models)
  if (!src) return null
  const [lo, hi] = spanOf(curve, window)
  const width = hi - lo
  if (!(width > 0)) return null
  const grid = width >= 4 ? 1 : width >= 1 ? 0.5 : 0
  const nice = (v: number): number => (grid > 0 ? Math.round(v / grid) * grid : round6(v))
  const pairs: [number, number][] = []
  const add = (a0: number, b0: number): void => {
    let a = a0
    let b = b0
    if (a < lo) a = round6(lo)
    if (b > hi) b = round6(hi)
    if (b > a && !pairs.some(([p, q]) => p === a && q === b)) pairs.push([a + 0, b + 0])
  }
  for (const [p, q] of [
    [0.25, 0.75],
    [0.3, 0.7],
    [0.2, 0.8],
    [0.35, 0.65],
    [0.1, 0.9],
    [0.4, 0.6],
    [0.05, 0.95],
  ]) {
    const a = nice(lo + p * width)
    const b = nice(lo + q * width)
    if (b > a) add(a, b)
    else add(round6(lo + p * width), round6(lo + q * width))
  }
  // Around the middle of the view, in steps of the grid (or of a tenth of the span).
  const mid = nice((lo + hi) / 2)
  const g = grid > 0 ? grid : width / 10
  for (const [p, q] of [
    [-2, 2],
    [0, 2],
    [-1, 1],
    [1, 3],
    [0, 1],
    [-1, 2],
    [-0.5, 0.5],
    [0, 0.5],
  ]) {
    add(round6(mid + p * g), round6(mid + q * g))
  }
  const onScreen = (sec: Secant): boolean => {
    if (!yWindow) return true
    const ylo = Math.min(yWindow[0], yWindow[1])
    const yhi = Math.max(yWindow[0], yWindow[1])
    const pad = 0.08 * (yhi - ylo)
    const ok = (y: number): boolean => y >= ylo + pad && y <= yhi - pad
    return ok(sec.fa) && ok(sec.fb)
  }
  let continuous: [number, number] | null = null
  let fallback: [number, number] | null = null
  for (const [a, b] of pairs) {
    let sec: Secant | null = null
    try {
      sec = secantOf(src, a, b)
    } catch {
      sec = null
    }
    if (!sec) continue
    fallback ??= [a, b]
    let fine = false
    try {
      fine = continuityOn(src, a, b).length === 0
    } catch {
      fine = false
    }
    if (!fine) continue
    if (onScreen(sec)) return [a, b]
    continuous ??= [a, b]
  }
  return continuous ?? fallback
}

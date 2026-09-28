// ============================================================================
// src/core/domainRange.ts — the domain and range of a function, whether it is
// one-to-one, and where a horizontal line meets it.
//
//   export function naturalDomain(curve, models): RealSet | null
//   export function curveDomain(curve, models): RealSet | null
//   export function curveRange(curve, models): RealSet | null
//   export function oneToOneInfo(curve, models): OneToOne | null
//   export function levelCrossings(curve, models, y, span): number[]
//   export function describeSet(parts, variable): Pick<RealSet, 'text' | 'tex' | 'builder' | 'builderTex'>
//
// NATURAL DOMAIN — where the formula as written has a value. For a typed
// formula: every √ / even root argument ≥ 0, every ln/log argument > 0,
// every denominator ≠ 0, asin/acos arguments in [−1, 1], tan/sec/cot/csc off
// their poles, a real power of a negative base undefined — read by a scan of
// the formula's own evaluator over a wide window (±1e6 and a fine scan of the
// board-scale range), with every boundary refined by bisection, snapped to
// an exact form (exactForm, tight), and its closedness decided by evaluating
// AT the snapped boundary (√(x−2) has 2 closed; ln x has 0 open). Isolated
// excluded points (1/(x−2), and ModelSpec.singularities) are open-open
// splits. A library family (sketched curve) reports its family's own natural
// domain (sqrt family [h, ∞), log family (h, ∞), recip x ≠ h, everything
// else ℝ) through the same scan.
//
// CURVE DOMAIN — the natural domain intersected with what the teacher set:
// curve.domain for a sketch (closed, both ends) and ModelSpec.pieces for a
// typed restriction or piecewise (their loClosed/hiClosed as written).
//
// RANGE — the union over each continuous stretch of the curve domain (split
// at poles, jumps and domain gaps) of the values it takes: candidates are the
// local extrema (analyzeCurve), the values at closed ends (attained), the
// limits at open ends and at ±∞ (approached, not attained — unless the value
// is attained elsewhere on the stretch), and ±∞ at a pole or where f grows
// without bound. 1/x is (−∞, 0) ∪ (0, ∞); (x+1)/(x−2) is y ≠ 1; x² is
// [0, ∞); eˣ is (0, ∞); sin is [−1, 1]; √(4 − x²) is [0, 2]. A step function
// (floor, ceil, sign, and a piecewise of constants) has a discrete range:
// kind 'integers' ("all integers") when every value is an integer and the
// set is unbounded, kind 'finite' with `points` when it takes finitely many
// values ({−1, 0, 1} for sign). Endpoints snapped to exact forms. A range
// that cannot be read honestly (a curve that oscillates without settling at
// ±∞, x·sin x, is still (−∞, ∞) — but e.g. sin(1/x) near 0) is kind
// 'unknown' rather than a guess.
//
// ONE-TO-ONE — passes the horizontal line test on its curve domain: strictly
// monotone on each continuous stretch, and the stretches' ranges do not
// overlap (1/x IS one-to-one; x² is not; x³ is; a constant piece is not).
// When not, a WITNESS: a height y the teacher can see fail — the nicest y
// (exact form preferred, inside the view span if one is given) with two or
// more crossings, and those crossings. `monotone` lists the maximal stretches
// on which f IS one-to-one, widest first, each with exact ends — the chips a
// teacher clicks to restrict the domain: x² → x ≥ 0, x ≤ 0; sin → the one
// containing 0, [−π/2, π/2], then its neighbours; (x−1)² + 2 → x ≥ 1, x ≤ 1.
// Each stretch's ends are closed where f is defined there.
//
// Pure TypeScript: no DOM, no imports from src/ui. Owned by the core agent.
//
// ---------------------------------------------------------------------------
// HOW IT IS READ (implementation notes — the contract above is unchanged)
//
// Everything is read from the curve's own evaluator; nothing here re-parses a
// formula. The pieces:
//
//   * The CORE is the board-scale window [−20, 20] (a stretch that lies
//     beyond it gets a 40-unit core of its own at its near end), sampled
//     finely. Beyond the core a stretch is followed out by DOUBLING to
//     ~7e14 (the tails), and toward an open finite end by a LADDER that
//     closes in by ×10 per rung to within ~1e-12 of the end.
//   * A tail or ladder is read the way src/core/holes.ts reads a limit:
//     a final monotone run whose steps collapse CONVERGES (the limit is the
//     Aitken extrapolation of the last three rungs, exact for the geometric
//     errors 1/x and eˣ produce); a monotone run whose steps refuse to shrink
//     DIVERGES (ln x climbs ln 2 per doubling for ever); anything else
//     OSCILLATES. An oscillating tail at ±∞ contributes the values it takes
//     (sin's are inside [−1, 1] already; x·sin x's run away both ways, so the
//     range is ℝ); an oscillating approach to a finite end (sin(1/x) at 0)
//     makes the range 'unknown'.
//   * Extrema are located on the samples and refined by golden section (then
//     on f′'s sign change where f is smooth) and snapped with verifiedExact —
//     a candidate is accepted only when f there is at least as extreme as at
//     the refined point.
//   * Jumps (floor, sign, a piecewise) are found where one sample step moves
//     f far more than its neighbours do, and confirmed by bisecting the step
//     until it is an ulp wide and f still jumps across it.
//
// PERIODIC EXCLUSIONS. tan x is undefined at π/2 + kπ for every integer k —
// infinitely many parts. When the domain's boundary events inside the core
// repeat with a period P (at least three periods of them, reaching both
// edges), the set is PERIODIC: `parts` lists only the parts that lie wholly
// inside the core window, `periodic` says so (an optional field; absent for
// every ordinary set), `text` shows the three parts nearest 0 between "…"
// ("… ∪ (−3π/2, −π/2) ∪ (−π/2, π/2) ∪ (π/2, 3π/2) ∪ …"), and `builder` is
// "x ≠ π/2 + kπ" when the exclusions are points (several offsets:
// "x ≠ π/6 + 2kπ, 5π/6 + 2kπ"); a periodic set of intervals (√(sin x))
// keeps the "…" text as its builder. Intersected with a bounded restriction
// the set is ordinary again, read over the restriction itself. The range and
// the horizontal line test of a periodic domain are read over the parts in
// the window (right for tan, sec, and every periodic formula).
//
// HONEST LIMITS. A gap in the domain narrower than one core sample step
// (1/60 unit) that no singularity names is not seen; domain structure beyond
// ±1.3e6 is not examined (the far tail is assumed to continue as the last
// sample says); a limit that converges slower than any power of x (1/ln x)
// may be read as diverging. A range is 'unknown' when an open end oscillates
// without settling, or a stretch cannot be sampled. x^(1/3) is read as the
// parser evaluates it (see the report: a negative base with an odd-root
// exponent is NaN there today, so its domain reads [0, ∞) until the parser
// evaluates odd roots of negatives; cbrt(x) reads ℝ).
// ============================================================================

import type { ExactPoint, FittedCurve, ModelSpec } from './types'
import type { ExactForm } from './exact'
import { exactForm, verifiedExact } from './exact'
import { richardsonD1 } from './parse'

/** One interval of reals. lo/hi are ±Infinity for an unbounded side (never closed). */
export interface IntervalPart {
  lo: number
  hi: number
  loClosed: boolean
  hiClosed: boolean
  /** the ends as closed forms when they are ("√2", "π/2", "−1/3"), else null */
  loExact: ExactForm | null
  hiExact: ExactForm | null
}

/**
 * A domain that repeats (tan x): the parts listed are those inside the core
 * window, and the pattern continues on the flagged sides with this period.
 * Optional on RealSet — absent for every set that is not periodic.
 */
export interface PeriodicInfo {
  period: number
  periodExact: ExactForm | null
  /** the pattern continues past the listed parts to the left / right */
  left: boolean
  right: boolean
  /** for a pattern of excluded POINTS: one representative of each class mod P */
  offsets: { value: number; exact: ExactForm | null }[] | null
}

/** A set of reals, and how a textbook writes it. */
export interface RealSet {
  kind: 'intervals' | 'integers' | 'finite' | 'unknown'
  /** 'intervals': disjoint, ascending, merged where they touch */
  parts: IntervalPart[]
  /** 'finite': the values, ascending */
  points?: number[]
  /** interval notation, Unicode: "(−∞, 0) ∪ (0, ∞)", "[0, ∞)", "all integers", "{−1, 0, 1}" */
  text: string
  tex: string
  /**
   * set-builder / words for the same set, in the given variable:
   * "all real numbers", "x ≥ 0", "x ≠ 2", "−1 ≤ x ≤ 1", "y > 0", "x ≠ −2, 2"
   * (the common Math 3 phrasing; falls back to the interval text when there
   * is no short form)
   */
  builder: string
  builderTex: string
  /** set only for a periodic domain (see "PERIODIC EXCLUSIONS" above) */
  periodic?: PeriodicInfo
}

export interface OneToOne {
  oneToOne: boolean
  /** when not one-to-one: a height that fails the test and the x's it meets */
  witness?: { y: number; exactY: ExactForm | null; xs: number[] }
  /** maximal stretches of the curve domain on which f is one-to-one, widest first */
  monotone: IntervalPart[]
}

// ============================================================================
// Tuning
// ============================================================================

const MINUS = '−'

/** Half-width of the board-scale core window. */
const CORE_W = 20
/** Samples across a core (per stretch). */
const CORE_N = 1200
/** Samples across the natural-domain window [−CORE_W, CORE_W]. */
const DOMAIN_N = 2400
/** Doublings past the natural-domain window: 20·2^16 ≈ 1.3e6. */
const DOMAIN_TAIL_K = 16
/** Doublings along a tail of a stretch: 20·2^45 ≈ 7e14. */
const TAIL_K = 45
/** Rungs of a ladder toward an open finite end: ×10 each. */
const LADDER_K = 12
/** A tail whose last this-many steps agree in direction is monotone out there. */
const TAIL_RUN = 10
const LADDER_RUN = 5
/** Steps shrinking slower than this per rung are not converging. */
const DIVERGE_RATIO = 0.97
/** A step smaller than this fraction of the core's spread is rounding. */
const NOISE_REL = 1e-15
/** A domain window wider than this is not rescanned for a restriction. */
const MAX_WINDOW = 2000
/** Two x's (or y's) this close (relative) are the same number. */
const SAME = 1e-9
/** More parts than this and a domain is not worth listing. */
const MAX_PARTS = 400
/** The internal memo lives this long (ms): one card render, not one drag. */
const MEMO_MS = 60

// ============================================================================
// Small helpers
// ============================================================================

type Fn = (x: number) => number

interface Ctx {
  spec: ModelSpec
  params: number[]
  f: Fn
}

const same = (a: number, b: number): boolean =>
  a === b ||
  (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= SAME * Math.max(1, Math.abs(a), Math.abs(b)))

function ctxOf(curve: FittedCurve, models: Record<string, ModelSpec>): Ctx | null {
  if (!curve || curve.kind !== 'explicit' || !models) return null
  const spec = models[curve.modelId]
  if (!spec || !spec.evalExplicit) return null
  if (!Array.isArray(curve.params) || !curve.params.every(Number.isFinite)) return null
  const ev = spec.evalExplicit
  const params = curve.params.slice()
  const f: Fn = (x) => {
    let v: unknown
    try { v = ev.call(spec, params, x) } catch { return Number.NaN }
    return typeof v === 'number' ? v : Number.NaN
  }
  return { spec, params, f }
}

/** A nice x as ModelSpec.evalExact wants it, when the form is p/q or pπ/q. */
function exactPointOf(form: ExactForm | null): ExactPoint | null {
  if (!form || form.text.includes('√')) return null
  const pi = form.text.includes('π')
  const v = pi ? form.value / Math.PI : form.value
  for (let q = 1; q <= 64; q++) {
    const p = Math.round(v * q)
    if (Math.abs(p - v * q) <= 1e-9 * q * Math.max(1, Math.abs(v))) return { p, q, pi }
  }
  return null
}

/** f at x, exactly when x is a nice number and the formula can say (sin π = 0). */
function valueAt(ctx: Ctx, x: number, form: ExactForm | null): number {
  const pt = form && ctx.spec.evalExact ? exactPointOf(form) : null
  if (pt) {
    let r: number | undefined
    try { r = ctx.spec.evalExact!(ctx.params, pt) } catch { r = undefined }
    if (typeof r === 'number') return r
  }
  return ctx.f(x)
}

/** A boundary / extremum x snapped to a closed form, or left as it is. */
function snapX(x: number, tol = 1e-10): { x: number; exact: ExactForm | null } {
  if (!Number.isFinite(x)) return { x, exact: null }
  if (Math.abs(x) < 1e-13) return { x: 0, exact: exactForm(0) }
  const form = exactForm(x, { tol })
  if (form && Math.abs(form.value - x) <= 1e-8 * Math.max(1, Math.abs(x))) return { x: form.value, exact: form }
  return { x, exact: null }
}

/** A value (a y) snapped to a closed form. */
function snapY(v: number, tol = 1e-9): { v: number; exact: ExactForm | null } {
  if (!Number.isFinite(v)) return { v, exact: null }
  if (Math.abs(v) < 1e-12) return { v: 0, exact: exactForm(0) }
  const form = exactForm(v, { tol })
  if (form) return { v: form.value, exact: form }
  return { v, exact: null }
}

const part = (
  lo: number,
  hi: number,
  loClosed: boolean,
  hiClosed: boolean,
  loExact: ExactForm | null = null,
  hiExact: ExactForm | null = null,
): IntervalPart => ({
  lo,
  hi,
  loClosed: Number.isFinite(lo) && loClosed,
  hiClosed: Number.isFinite(hi) && hiClosed,
  loExact: Number.isFinite(lo) ? loExact : null,
  hiExact: Number.isFinite(hi) ? hiExact : null,
})

const WHOLE = (): IntervalPart => part(-Infinity, Infinity, false, false)

/** Sort and merge intervals that overlap or touch at a point one of them owns. */
function mergeParts(input: readonly IntervalPart[]): IntervalPart[] {
  const ps = input
    .filter((p) => p.lo < p.hi || (p.lo === p.hi && p.loClosed && p.hiClosed))
    .map((p) => ({ ...p }))
    .sort((a, b) => a.lo - b.lo || (a.loClosed === b.loClosed ? 0 : a.loClosed ? -1 : 1))
  const out: IntervalPart[] = []
  for (const p of ps) {
    const last = out[out.length - 1]
    if (last) {
      const touch = same(last.hi, p.lo)
      if ((p.lo < last.hi && !touch) || (touch && (last.hiClosed || p.loClosed))) {
        // one interval now: extend the end if p reaches further
        if (same(p.hi, last.hi)) last.hiClosed = last.hiClosed || p.hiClosed
        else if (p.hi > last.hi) { last.hi = p.hi; last.hiClosed = p.hiClosed; last.hiExact = p.hiExact }
        continue
      }
    }
    out.push(p)
  }
  return out
}

/** A ∩ B for two ascending lists of disjoint intervals. */
function intersectParts(a: readonly IntervalPart[], b: readonly IntervalPart[]): IntervalPart[] {
  const out: IntervalPart[] = []
  for (const p of a) {
    for (const q of b) {
      let lo: number, loClosed: boolean, loExact: ExactForm | null
      if (same(p.lo, q.lo) && Number.isFinite(p.lo)) {
        lo = p.loExact ? p.lo : q.lo
        loClosed = p.loClosed && q.loClosed
        loExact = p.loExact ?? q.loExact
      } else if (p.lo > q.lo) {
        lo = p.lo; loClosed = p.loClosed; loExact = p.loExact
      } else {
        lo = q.lo; loClosed = q.loClosed; loExact = q.loExact
      }
      let hi: number, hiClosed: boolean, hiExact: ExactForm | null
      if (same(p.hi, q.hi) && Number.isFinite(p.hi)) {
        hi = p.hiExact ? p.hi : q.hi
        hiClosed = p.hiClosed && q.hiClosed
        hiExact = p.hiExact ?? q.hiExact
      } else if (p.hi < q.hi) {
        hi = p.hi; hiClosed = p.hiClosed; hiExact = p.hiExact
      } else {
        hi = q.hi; hiClosed = q.hiClosed; hiExact = q.hiExact
      }
      if (lo < hi && !same(lo, hi)) out.push(part(lo, hi, loClosed, hiClosed, loExact, hiExact))
      else if (same(lo, hi) && loClosed && hiClosed && Number.isFinite(lo)) out.push(part(lo, lo, true, true, loExact, loExact))
    }
  }
  return mergeParts(out)
}

/** Remove the points `xs` from a list of intervals. */
function removePoints(ps: readonly IntervalPart[], xs: readonly { x: number; exact: ExactForm | null }[]): IntervalPart[] {
  let cur = ps.map((p) => ({ ...p }))
  for (const { x, exact } of xs) {
    const next: IntervalPart[] = []
    for (const p of cur) {
      const inside = x > p.lo && x < p.hi && !same(x, p.lo) && !same(x, p.hi)
      if (inside) {
        next.push(part(p.lo, x, p.loClosed, false, p.loExact, exact))
        next.push(part(x, p.hi, false, p.hiClosed, exact, p.hiExact))
        continue
      }
      if (same(x, p.lo) && Number.isFinite(p.lo)) {
        if (p.lo === p.hi) continue
        next.push({ ...p, loClosed: false })
        continue
      }
      if (same(x, p.hi) && Number.isFinite(p.hi)) {
        next.push({ ...p, hiClosed: false })
        continue
      }
      next.push(p)
    }
    cur = next
  }
  return cur
}

// ============================================================================
// Formatting — Unicode, KaTeX, set-builder
// ============================================================================

/** A plain decimal for a card: 4 significant digits, a true minus. */
function numText(v: number): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : `${MINUS}∞`
  if (Math.abs(v) < 1e-12) return '0'
  const s = String(Number(v.toPrecision(4)) + 0)
  return s.startsWith('-') ? MINUS + s.slice(1) : s
}

function numTex(v: number): string {
  if (!Number.isFinite(v)) return v > 0 ? '\\infty' : '-\\infty'
  if (Math.abs(v) < 1e-12) return '0'
  const s = String(Number(v.toPrecision(4)) + 0)
  if (/e/.test(s)) {
    const [m, e] = s.split('e')
    return `${m}\\cdot 10^{${Number(e)}}`
  }
  return s
}

const endTxt = (v: number, ex: ExactForm | null): string => (ex && Number.isFinite(v) ? ex.text : numText(v))
const endTex = (v: number, ex: ExactForm | null): string => (ex && Number.isFinite(v) ? ex.tex : numTex(v))

function partText(p: IntervalPart): string {
  if (p.lo === p.hi) return `{${endTxt(p.lo, p.loExact)}}`
  const l = p.loClosed ? '[' : '('
  const r = p.hiClosed ? ']' : ')'
  return `${l}${endTxt(p.lo, p.loExact)}, ${endTxt(p.hi, p.hiExact)}${r}`
}

function partTex(p: IntervalPart): string {
  if (p.lo === p.hi) return `\\left\\{${endTex(p.lo, p.loExact)}\\right\\}`
  const l = p.loClosed ? '[' : '('
  const r = p.hiClosed ? ']' : ')'
  return `\\left${l}${endTex(p.lo, p.loExact)}, ${endTex(p.hi, p.hiExact)}\\right${r}`
}

/** Set-builder for ONE interval, or null for the whole line. */
function oneBuilder(p: IntervalPart, v: string): { t: string; tex: string } | null {
  const loF = Number.isFinite(p.lo)
  const hiF = Number.isFinite(p.hi)
  const lo = endTxt(p.lo, p.loExact)
  const hi = endTxt(p.hi, p.hiExact)
  const loT = endTex(p.lo, p.loExact)
  const hiT = endTex(p.hi, p.hiExact)
  if (loF && hiF) {
    if (p.lo === p.hi) return { t: `${v} = ${lo}`, tex: `${v} = ${loT}` }
    return {
      t: `${lo} ${p.loClosed ? '≤' : '<'} ${v} ${p.hiClosed ? '≤' : '<'} ${hi}`,
      tex: `${loT} ${p.loClosed ? '\\le' : '<'} ${v} ${p.hiClosed ? '\\le' : '<'} ${hiT}`,
    }
  }
  if (loF) return { t: `${v} ${p.loClosed ? '≥' : '>'} ${lo}`, tex: `${v} ${p.loClosed ? '\\ge' : '>'} ${loT}` }
  if (hiF) return { t: `${v} ${p.hiClosed ? '≤' : '<'} ${hi}`, tex: `${v} ${p.hiClosed ? '\\le' : '<'} ${hiT}` }
  return null
}

/** text / tex / builder / builderTex for a union of intervals, in `variable` ('x' or 'y'). */
export function describeSet(
  parts: readonly IntervalPart[],
  variable: string,
): Pick<RealSet, 'text' | 'tex' | 'builder' | 'builderTex'> {
  const v = variable || 'x'
  const ps = (parts ?? []).filter(
    (p) => p && typeof p.lo === 'number' && typeof p.hi === 'number' && !(p.hi < p.lo),
  )
  if (ps.length === 0) {
    return { text: '∅', tex: '\\varnothing', builder: 'no real numbers', builderTex: '\\text{no real numbers}' }
  }
  const text = ps.map(partText).join(' ∪ ')
  const tex = ps.map(partTex).join(' \\cup ')
  const fallback = { text, tex, builder: text, builderTex: tex }

  if (ps.length === 1) {
    const b = oneBuilder(ps[0], v)
    if (!b) return { text, tex, builder: 'all real numbers', builderTex: '\\text{all real numbers}' }
    return { text, tex, builder: b.t, builderTex: b.tex }
  }

  // the line (or one interval) with finitely many points taken out
  let allPoints = true
  for (let i = 0; i + 1 < ps.length; i++) {
    const a = ps[i], b = ps[i + 1]
    if (!(same(a.hi, b.lo) && !a.hiClosed && !b.loClosed && a.lo !== a.hi && b.lo !== b.hi)) { allPoints = false; break }
  }
  if (allPoints) {
    const holes = ps.slice(0, -1).map((p) => ({ t: endTxt(p.hi, p.hiExact), tex: endTex(p.hi, p.hiExact) }))
    const base = part(ps[0].lo, ps[ps.length - 1].hi, ps[0].loClosed, ps[ps.length - 1].hiClosed, ps[0].loExact, ps[ps.length - 1].hiExact)
    const nb = oneBuilder(base, v)
    const ne = `${v} ≠ ${holes.map((h) => h.t).join(', ')}`
    const neTex = `${v} \\ne ${holes.map((h) => h.tex).join(', ')}`
    if (!nb) return { text, tex, builder: ne, builderTex: neTex }
    return { text, tex, builder: `${nb.t}, ${ne}`, builderTex: `${nb.tex},\\ ${neTex}` }
  }

  // two rays: x < a or x > b
  if (ps.length === 2 && !Number.isFinite(ps[0].lo) && !Number.isFinite(ps[1].hi)) {
    const a = oneBuilder(ps[0], v)
    const b = oneBuilder(ps[1], v)
    if (a && b) return { text, tex, builder: `${a.t} or ${b.t}`, builderTex: `${a.tex} \\text{ or } ${b.tex}` }
  }
  return fallback
}

function setOf(parts: IntervalPart[], variable: string): RealSet {
  return { kind: 'intervals', parts, ...describeSet(parts, variable) }
}

function unknownSet(): RealSet {
  return {
    kind: 'unknown',
    parts: [],
    text: 'unknown',
    tex: '\\text{unknown}',
    builder: 'could not be determined',
    builderTex: '\\text{could not be determined}',
  }
}

/** "kπ", "2kπ", "kπ/2", "k", "3k" — the multiples of a period. */
function kMultiple(P: number, ex: ExactForm | null): { t: string; tex: string } {
  const form = ex ?? exactForm(P)
  if (form) {
    const m = /^(\d*)(π?)(?:\/(\d+))?$/.exec(form.text)
    if (m) {
      const coef = m[1] === '' ? '' : m[1]
      const pi = m[2]
      const den = m[3]
      const t = `${coef}k${pi}${den ? '/' + den : ''}`
      const texHead = `${coef}k${pi ? '\\pi' : ''}`
      const tex = den ? `\\frac{${texHead}}{${den}}` : texHead
      return { t, tex }
    }
  }
  return { t: `${numText(P)}k`, tex: `${numTex(P)}k` }
}

function periodicDescription(
  parts: IntervalPart[],
  per: PeriodicInfo,
  variable: string,
): Pick<RealSet, 'text' | 'tex' | 'builder' | 'builderTex'> {
  // the three parts nearest 0, between ellipses on the sides that continue
  const dist = (p: IntervalPart): number =>
    p.lo <= 0 && p.hi >= 0 ? 0 : Math.min(Math.abs(p.lo), Math.abs(p.hi))
  const order = parts.map((p, i) => ({ i, d: dist(p) })).sort((a, b) => a.d - b.d || parts[b.i].lo - parts[a.i].lo)
  const keep = new Set(order.slice(0, 3).map((o) => o.i))
  const shown = parts.filter((_, i) => keep.has(i))
  const first = shown.length > 0 ? parts.indexOf(shown[0]) : 0
  const last = shown.length > 0 ? parts.indexOf(shown[shown.length - 1]) : -1
  const moreLeft = per.left || first > 0
  const moreRight = per.right || last < parts.length - 1
  const body = shown.map(partText).join(' ∪ ')
  const bodyTex = shown.map(partTex).join(' \\cup ')
  const text = `${moreLeft ? '… ∪ ' : ''}${body}${moreRight ? ' ∪ …' : ''}`
  const tex = `${moreLeft ? '\\cdots \\cup ' : ''}${bodyTex}${moreRight ? ' \\cup \\cdots' : ''}`
  if (per.offsets && per.left && per.right) {
    const k = kMultiple(per.period, per.periodExact)
    const terms = per.offsets.map((o) => {
      if (Math.abs(o.value) < 1e-12) return { t: k.t, tex: k.tex }
      const ot = o.exact ? o.exact.text : numText(o.value)
      const oTex = o.exact ? o.exact.tex : numTex(o.value)
      return { t: `${ot} + ${k.t}`, tex: `${oTex} + ${k.tex}` }
    })
    return {
      text,
      tex,
      builder: `${variable} ≠ ${terms.map((x) => x.t).join(', ')}`,
      builderTex: `${variable} \\ne ${terms.map((x) => x.tex).join(', ')}`,
    }
  }
  return { text, tex, builder: text, builderTex: tex }
}

// ============================================================================
// The memo — one card render asks for the domain, the range and the test in
// a row; each of them needs the domain, and the last two the stretch analysis.
// ============================================================================

interface Memo<T> { spec: ModelSpec; key: string; at: number; value: T }
const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()

function memoKey(curve: FittedCurve, tag: string): string {
  return `${tag}|${curve.modelId}|${curve.params.join(',')}|${curve.domain ? curve.domain.join(',') : '-'}`
}

const memos = new Map<string, Memo<unknown>>()

function memo<T>(spec: ModelSpec, key: string, make: () => T): T {
  const hit = memos.get(key)
  const t = now()
  if (hit && hit.spec === spec && t - hit.at <= MEMO_MS) return hit.value as T
  const value = make()
  if (memos.size > 64) memos.clear()
  memos.set(key, { spec, key, at: t, value })
  return value
}

// ============================================================================
// NATURAL DOMAIN
// ============================================================================

interface DomainInfo {
  parts: IntervalPart[]
  periodic: PeriodicInfo | null
  /** too fragmented to list honestly */
  unknown?: boolean
}

/** The families of src/core/fit/models.ts, answered from their parameters. */
function libraryDomain(curve: FittedCurve): IntervalPart[] | null {
  const p = curve.params
  const hx = (b: number) => snapX(b, 1e-12)
  switch (curve.modelId) {
    case 'sqrt': {
      const h = hx(p[1])
      return [part(h.x, Infinity, true, false, h.exact)]
    }
    case 'log': {
      const h = hx(p[1])
      return [part(h.x, Infinity, false, false, h.exact)]
    }
    case 'recip': {
      const h = hx(p[1])
      return [part(-Infinity, h.x, false, false, null, h.exact), part(h.x, Infinity, false, false, h.exact)]
    }
    case 'power': {
      if (!(p[3] < 0)) return [WHOLE()]
      const h = hx(p[1])
      return [part(-Infinity, h.x, false, false, null, h.exact), part(h.x, Infinity, false, false, h.exact)]
    }
    case 'line': case 'poly2': case 'poly3': case 'poly4': case 'sine': case 'gauss':
    case 'exp': case 'cbrt': case 'abs': case 'logistic':
      return [WHOLE()]
    default:
      return null
  }
}

const isTyped = (spec: ModelSpec): boolean =>
  typeof spec.evalExact === 'function' || typeof spec.taylor === 'function' ||
  typeof spec.pieces === 'function' || typeof spec.singularities === 'function'

/** Bisect a definedness boundary between a (defined = da) and b. */
function bisectDefined(f: Fn, a: number, b: number): number {
  const ok = (x: number) => Number.isFinite(f(x))
  let lo = a, hi = b
  const dLo = ok(lo)
  for (let i = 0; i < 200; i++) {
    const m = 0.5 * (lo + hi)
    if (m === lo || m === hi) break
    if (ok(m) === dLo) lo = m
    else hi = m
  }
  // the defined side's last point
  return dLo ? lo : hi
}

/**
 * Is x (a snapped boundary) in the domain? Evaluated AT the exact number when
 * the formula can do exact arithmetic there; else by the double; else, for a
 * boundary that is no closed form, by where f heads as it arrives (√ settles:
 * closed; ln dives: open).
 */
function definedAt(ctx: Ctx, x: number, exact: ExactForm | null, towardInside: number): boolean {
  const pt = exact && ctx.spec.evalExact ? exactPointOf(exact) : null
  if (pt) {
    let r: number | undefined
    try { r = ctx.spec.evalExact!(ctx.params, pt) } catch { r = undefined }
    if (typeof r === 'number') return Number.isFinite(r)
  }
  const v = ctx.f(x)
  if (!Number.isFinite(v)) return false
  if (exact) return true
  // a located boundary: approach it and see whether f settles
  const scale = Math.max(1, Math.abs(x))
  const vals: number[] = []
  for (let k = 3; k <= 12; k++) {
    const y = ctx.f(x + towardInside * scale * Math.pow(10, -k))
    if (!Number.isFinite(y)) return false
    vals.push(y)
  }
  const n = vals.length
  const s1 = Math.abs(vals[n - 1] - vals[n - 2])
  const s0 = Math.abs(vals[n - 3] - vals[n - 4])
  return s1 <= 0.5 * s0 + 1e-9 * (1 + Math.abs(vals[n - 1]))
}

interface Event { x: number; kind: 'start' | 'end' | 'point'; closed: boolean; exact: ExactForm | null }

/** Scan the formula over [wLo, wHi] (finely) and its doublings out to ±1e6. */
/**
 * 'curve': every singularity the model names is out, the teacher's {x != c}
 * included, and the evaluator is read as it is (gated by a restriction).
 * 'natural': the formula as written — a named singularity is out only where
 * the formula itself breaks (non-finite, a pole's spike, or certified
 * undefined by exact arithmetic), so {x != 2} on x² leaves 2 in.
 */
type ScanMode = 'curve' | 'natural'

function scanDomain(ctx: Ctx, wLo: number, wHi: number, mode: ScanMode = 'curve'): DomainInfo {
  const { f, spec, params } = ctx
  const width = wHi - wLo
  const n = Math.min(40000, Math.max(DOMAIN_N, Math.round((DOMAIN_N * width) / (2 * CORE_W))))
  const xs: number[] = []
  // left tail (ascending), window, right tail
  const edge = Math.max(CORE_W, Math.abs(wLo), Math.abs(wHi))
  for (let k = DOMAIN_TAIL_K; k >= 1; k--) {
    const x = wLo - edge * (Math.pow(2, k) - 1)
    xs.push(x)
  }
  for (let i = 0; i <= n; i++) xs.push(wLo + (width * i) / n)
  for (let k = 1; k <= DOMAIN_TAIL_K; k++) xs.push(wHi + edge * (Math.pow(2, k) - 1))
  // ±∞ at a sample between two samples that have values is overflow (e^x
  // far out) or a pole the singularities name; next to a NaN it is the edge
  // of the domain (ln(x² − 1) at −1). The boundary bisection itself is strict.
  const vs = xs.map((x) => f(x))
  const def = vs.map((v, i) =>
    Number.isFinite(v) ||
    (!Number.isNaN(v) && !Number.isNaN(vs[Math.max(0, i - 1)]) && !Number.isNaN(vs[Math.min(vs.length - 1, i + 1)])))

  const events: Event[] = []
  // runs of definedness → boundaries
  for (let i = 0; i + 1 < xs.length; i++) {
    if (def[i] === def[i + 1]) continue
    const b = bisectDefined(f, xs[i], xs[i + 1])
    const s = snapX(b)
    const kind: 'start' | 'end' = def[i + 1] ? 'start' : 'end'
    const inside = kind === 'start' ? 1 : -1
    // the snapped form must still be on the boundary: inside its own bracket
    let x = s.x
    let exact = s.exact
    if (!(x >= xs[i] && x <= xs[i + 1])) { x = b; exact = null }
    const closed = definedAt(ctx, x, exact, inside)
    events.push({ x, kind, closed, exact })
  }

  // singularities: every point the formula names as undefined (a pole, a
  // hole, an explicit `{x != c}`), unless exact arithmetic certifies a value
  const sing: number[] = []
  if (typeof spec.singularities === 'function') {
    const ask = (r: [number, number]): number[] => {
      let out: unknown
      try { out = spec.singularities!(params, r) } catch { out = [] }
      return Array.isArray(out) ? out.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)) : []
    }
    const inner = ask([wLo, wHi])
    sing.push(...inner)
    const outerLo = wLo - edge * (Math.pow(2, DOMAIN_TAIL_K) - 1)
    const outerHi = wHi + edge * (Math.pow(2, DOMAIN_TAIL_K) - 1)
    for (const s of ask([outerLo, outerHi])) if (s < wLo || s > wHi) sing.push(s)
  }
  const pointEvents: Event[] = []
  for (const s0 of sing) {
    const s = snapX(s0, 1e-9)
    const pt = s.exact && spec.evalExact ? exactPointOf(s.exact) : null
    let certified: number | undefined
    if (pt) {
      try { certified = spec.evalExact!(params, pt) } catch { certified = undefined }
      if (typeof certified === 'number' && Number.isFinite(certified)) continue // certified: defined there
    }
    if (mode === 'natural' && typeof certified !== 'number') {
      // out only where the formula itself breaks
      const v = f(s.x)
      const d = 1e-6 * Math.max(1, Math.abs(s.x))
      const near = Math.abs(f(s.x - d)) + Math.abs(f(s.x + d))
      const breaks = !Number.isFinite(v) || !(Math.abs(v) <= 1e8 * (1 + (Number.isFinite(near) ? near : 0)))
      if (!breaks) continue
    }
    pointEvents.push({ x: s.x, kind: 'point', closed: false, exact: s.exact })
  }

  // assemble the parts
  let parts: IntervalPart[] = []
  let open: { x: number; closed: boolean; exact: ExactForm | null } | null = def[0]
    ? { x: -Infinity, closed: false, exact: null }
    : null
  const sorted = events.slice().sort((a, b) => a.x - b.x)
  for (const e of sorted) {
    if (e.kind === 'start') {
      if (open) continue
      open = { x: e.x, closed: e.closed, exact: e.exact }
    } else if (e.kind === 'end') {
      if (!open) continue
      if (e.x > open.x || (same(e.x, open.x) && open.closed && e.closed)) {
        parts.push(part(open.x, e.x, open.closed, e.closed, open.exact, e.exact))
      }
      open = null
    }
  }
  if (open) parts.push(part(open.x, Infinity, open.closed, false, open.exact))
  const base = parts

  // periodic? — every boundary event repeating across the whole window
  // (√(sin x)), or the excluded points alone repeating out to one or both
  // edges (tan x; tan x {x >= 0}, whose gate at 0 is not part of the pattern)
  const inWin = (x: number) => x >= wLo && x <= wHi
  const winPoints = pointEvents.filter((e) => inWin(e.x)).sort((a, b) => a.x - b.x)
  const dedup: Event[] = []
  for (const e of sorted.filter((q) => inWin(q.x)).concat(winPoints).sort((a, b) => a.x - b.x)) {
    const last = dedup[dedup.length - 1]
    if (last && same(last.x, e.x)) {
      // a point at a boundary: the boundary says it all
      if (last.kind === 'point' && e.kind !== 'point') dedup[dedup.length - 1] = e
      continue
    }
    dedup.push(e)
  }
  const per = detectPeriod(dedup, wLo, wHi) ?? detectPointPeriod(winPoints, wLo, wHi)
  if (per) {
    // the far singularities on a periodic side are the pattern (or aliasing
    // of it): only the window's own points are taken out
    const keep = pointEvents.filter((e) => inWin(e.x) || (e.x < wLo && !per.left) || (e.x > wHi && !per.right))
    let ps = removePoints(base, keep.map((e) => ({ x: e.x, exact: e.exact })))
    ps = ps.filter((p) => p.lo < p.hi || (p.lo === p.hi && p.loClosed))
    // on a side that continues, only the parts wholly inside the window
    ps = ps.filter((p) => (!per.left || p.lo >= wLo) && (!per.right || p.hi <= wHi))
    return { parts: ps, periodic: per }
  }
  parts = removePoints(base, pointEvents.map((e) => ({ x: e.x, exact: e.exact })))
  // a lone non-analytic sample (|x| at 0 read through jets) splits nothing
  parts = mergeParts(parts.filter((p) => p.lo < p.hi || (p.lo === p.hi && p.loClosed)))
  if (parts.length > MAX_PARTS) return { parts: [], periodic: null, unknown: true }
  return { parts, periodic: null }
}

/** Excluded points alone repeating with a period, out to one or both window edges. */
function detectPointPeriod(points: Event[], wLo: number, wHi: number): PeriodicInfo | null {
  if (points.length < 4) return null
  const xs = points.map((e) => e.x)
  const width = wHi - wLo
  for (let j = 1; j < Math.min(xs.length, 7); j++) {
    const P0 = xs[j] - xs[0]
    if (!(P0 > 0) || P0 > width / 3) continue
    const tol = 1e-7 * Math.max(1, P0)
    const has = (x: number) => xs.some((q) => Math.abs(q - x) <= tol * Math.max(1, Math.abs(x)))
    if (!xs.every((x) => x + P0 > wHi - tol || has(x + P0))) continue
    const left = xs[0] - wLo <= P0 + tol
    const right = wHi - xs[xs.length - 1] <= P0 + tol
    if (!left && !right) continue
    // at least three periods of the pattern inside the window
    if (xs[xs.length - 1] - xs[0] < 3 * P0 - tol) continue
    const Ps = snapX(P0, 1e-9)
    return { period: Ps.x, periodExact: Ps.exact, left, right, offsets: offsetsOf(points, Ps.x) }
  }
  return null
}

/** One representative per class mod P, the one nearest 0 (π/2 before −π/2). */
function offsetsOf(events: Event[], P: number): PeriodicInfo['offsets'] {
  const reps: { value: number; exact: ExactForm | null }[] = []
  for (const e of events) {
    let r = e.x - Math.round(e.x / P) * P
    if (Math.abs(Math.abs(r) - P / 2) < 1e-9 * P) r = P / 2
    const sn = snapX(r, 1e-9)
    if (!reps.some((q) => Math.abs(q.value - sn.x) <= 1e-7 * Math.max(1, P))) reps.push({ value: sn.x, exact: sn.exact })
  }
  return reps.sort((a, b) => a.value - b.value)
}

/** A period of the boundary events, when they repeat across the whole window. */
function detectPeriod(events: Event[], wLo: number, wHi: number): PeriodicInfo | null {
  if (events.length < 4) return null
  const e0 = events[0]
  const tries: number[] = []
  for (let j = 1; j < events.length && tries.length < 8; j++) {
    if (events[j].kind === e0.kind && events[j].closed === e0.closed) tries.push(events[j].x - e0.x)
  }
  const width = wHi - wLo
  for (const P0 of tries) {
    if (!(P0 > 0) || P0 > width / 3) continue
    const tol = 1e-7 * Math.max(1, P0)
    const match = (x: number, kind: string, closed: boolean): boolean =>
      events.some((e) => Math.abs(e.x - x) <= tol * Math.max(1, Math.abs(x)) && e.kind === kind && e.closed === closed)
    let ok = true
    for (const e of events) {
      if (e.x + P0 > wHi - tol) continue
      if (!match(e.x + P0, e.kind, e.closed)) { ok = false; break }
    }
    if (!ok) continue
    // it has to reach both edges of the window, or it is not a pattern that goes on
    if (events[0].x - wLo > P0 + tol || wHi - events[events.length - 1].x > P0 + tol) continue
    const Ps = snapX(P0, 1e-9)
    const P = Ps.x
    const offsets = events.every((e) => e.kind === 'point') ? offsetsOf(events, P) : null
    return { period: P, periodExact: Ps.exact, left: true, right: true, offsets }
  }
  return null
}

function naturalInfo(ctx: Ctx, curve: FittedCurve, mode: ScanMode = 'curve'): DomainInfo {
  if (!isTyped(ctx.spec)) {
    const lib = libraryDomain(curve)
    if (lib) return { parts: lib, periodic: null }
  }
  return scanDomain(mode === 'natural' ? formulaCtx(ctx) : ctx, -CORE_W, CORE_W, mode)
}

/**
 * The formula as written, without the teacher's restriction. A typed line
 * with ONE formula and a restriction (`x^2 {x >= 0}`) is evaluated through a
 * gate that answers NaN outside the restriction; the same line's `taylor`
 * (Taylor-mode AD over the formula itself, src/core/parse/jets.ts) is not
 * gated, so its 0th coefficient is f wherever the formula has a value (and
 * null where it has none, or at the few points it is not analytic — √ at 0,
 * |x| at 0 — which the boundary logic settles by exact arithmetic). A
 * piecewise of several formulas has no `taylor`, and its natural domain is
 * the union of its branches: the evaluator as it is.
 */
function formulaCtx(ctx: Ctx): Ctx {
  const { spec, params, f } = ctx
  if (typeof spec.pieces !== 'function' || typeof spec.taylor !== 'function') return ctx
  const jet = spec.taylor
  const j0 = (x: number): number => {
    let c: number[] | null
    try { c = jet.call(spec, params, x, 0) } catch { c = null }
    const c0 = Array.isArray(c) ? c[0] : Number.NaN
    return typeof c0 === 'number' && Number.isFinite(c0) ? c0 : Number.NaN
  }
  const fNat: Fn = (x) => {
    const v = f(x)
    if (Number.isFinite(v)) return v
    const c0 = j0(x)
    if (Number.isFinite(c0)) return c0
    // not analytic AT x but defined around it — a step's edge (floor at an
    // integer) or a kink — is still in the domain; a pole is not: its
    // neighbours dwarf the values a little further out
    const s = Math.max(1, Math.abs(x))
    const a = j0(x - 1e-9 * s), b = j0(x + 1e-9 * s)
    const A = j0(x - 1e-3 * s), B = j0(x + 1e-3 * s)
    if ([a, b, A, B].every(Number.isFinite) && Math.abs(a) <= 10 * (1 + Math.abs(A)) && Math.abs(b) <= 10 * (1 + Math.abs(B))) {
      return b
    }
    return v
  }
  return { spec, params, f: fNat }
}

/** What the teacher set: the typed pieces and the sketch's domain. */
function restrictionParts(curve: FittedCurve, spec: ModelSpec, params: number[]): IntervalPart[] {
  let ps: IntervalPart[] = [WHOLE()]
  if (typeof spec.pieces === 'function') {
    let raw: unknown
    try { raw = spec.pieces(params) } catch { raw = null }
    if (Array.isArray(raw) && raw.length > 0) {
      const got: IntervalPart[] = []
      for (const q of raw) {
        if (!q || typeof q.lo !== 'number' || typeof q.hi !== 'number' || q.hi < q.lo) continue
        const lo = snapX(q.lo, 1e-12)
        const hi = snapX(q.hi, 1e-12)
        got.push(part(lo.x, hi.x, !!q.loClosed, !!q.hiClosed, lo.exact, hi.exact))
      }
      if (got.length > 0) ps = mergeParts(got)
    }
  }
  if (curve.domain) {
    const a = Math.min(curve.domain[0], curve.domain[1])
    const b = Math.max(curve.domain[0], curve.domain[1])
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
      const lo = snapX(a, 1e-12)
      const hi = snapX(b, 1e-12)
      ps = intersectParts(ps, [part(lo.x, hi.x, true, true, lo.exact, hi.exact)])
    }
  }
  return ps
}

function domainInfo(ctx: Ctx, curve: FittedCurve): DomainInfo {
  return memo(ctx.spec, memoKey(curve, 'dom'), () => {
    const R = restrictionParts(curve, ctx.spec, ctx.params)
    if (R.length === 0) return { parts: [], periodic: null }
    const rLo = R[0].lo
    const rHi = R[R.length - 1].hi
    let nat = naturalInfo(ctx, curve)
    if (nat.periodic && (Number.isFinite(rLo) || Number.isFinite(rHi))) {
      // read the pattern over the restriction itself where it is bounded
      const lo = Number.isFinite(rLo) ? Math.min(-CORE_W, rLo - 1) : -CORE_W
      const hi = Number.isFinite(rHi) ? Math.max(CORE_W, rHi + 1) : CORE_W
      if (hi - lo <= MAX_WINDOW) {
        const wide = scanDomain(ctx, lo, hi)
        nat = wide
      }
    }
    if (nat.unknown) return nat
    const parts = intersectParts(nat.parts, R)
    let periodic: PeriodicInfo | null = null
    if (nat.periodic) {
      const left = nat.periodic.left && !Number.isFinite(rLo)
      const right = nat.periodic.right && !Number.isFinite(rHi)
      if (left || right) periodic = { ...nat.periodic, left, right }
    }
    return { parts, periodic }
  })
}

function realSetOfDomain(info: DomainInfo): RealSet {
  if (info.unknown) return unknownSet()
  if (info.periodic) {
    return { kind: 'intervals', parts: info.parts, ...periodicDescription(info.parts, info.periodic, 'x'), periodic: info.periodic }
  }
  return setOf(info.parts, 'x')
}

/** Where the formula as written has a value (see the header). Null for a non-explicit curve. */
export function naturalDomain(curve: FittedCurve, models: Record<string, ModelSpec>): RealSet | null {
  try {
    const ctx = ctxOf(curve, models)
    if (!ctx) return null
    const info = memo(ctx.spec, memoKey(curve, 'nat'), () => naturalInfo(ctx, curve, 'natural'))
    return realSetOfDomain(info)
  } catch {
    return null
  }
}

/** The natural domain ∩ the teacher's restriction. Null for a non-explicit curve. */
export function curveDomain(curve: FittedCurve, models: Record<string, ModelSpec>): RealSet | null {
  try {
    const ctx = ctxOf(curve, models)
    if (!ctx) return null
    return realSetOfDomain(domainInfo(ctx, curve))
  } catch {
    return null
  }
}

// ============================================================================
// STRETCH ANALYSIS — the values f takes on one continuous stretch
// ============================================================================

type EndKind =
  | { kind: 'closed'; v: number }
  | { kind: 'conv'; L: number; wobbly?: boolean }
  | { kind: 'div'; sign: 1 | -1; wobbly?: boolean }
  | { kind: 'osc'; min: number; max: number; unbounded: boolean }
  | { kind: 'none' } // the core reaches this end: nothing more to say

interface MonoPiece {
  lo: number
  hi: number
  loClosed: boolean
  hiClosed: boolean
  loExact: ExactForm | null
  hiExact: ExactForm | null
  /** +1 increasing, −1 decreasing, 0 constant */
  dir: 1 | -1 | 0
  /** the values at the two ends (limits or ±∞), and whether each is attained */
  vLo: number
  vHi: number
  vLoIn: boolean
  vHiIn: boolean
  /** samples on the piece, ascending x (for solving f = y on it) */
  xs: number[]
  vs: number[]
  /** the piece runs into an end that oscillates: it is not resolved */
  unresolved: boolean
}

interface Stretch {
  lo: number
  hi: number
  loClosed: boolean
  hiClosed: boolean
  loExact: ExactForm | null
  hiExact: ExactForm | null
  unknown: boolean
  /** range of values */
  inf: number
  sup: number
  infIn: boolean
  supIn: boolean
  pieces: MonoPiece[]
}

interface Analysis {
  stretches: Stretch[]
  /** values attained at isolated points (a jump's own value that belongs to neither side) */
  points: number[]
  /** a step function: its values, and whether they run off to ±∞ */
  step: { values: number[]; unboundedLo: boolean; unboundedHi: boolean } | null
  unknown: boolean
}

interface Sampled { x: number; v: number }

/**
 * Read a sequence that walks away from the core toward an end. seq[0] is the
 * core's edge value. Returns what the end does, and where its final monotone
 * run begins (samples before it may hold extrema; after it, none).
 */
function classifyEnd(
  seq: number[],
  noise: number,
  minRun: number,
  coreMin: number,
  coreMax: number,
): { end: EndKind; runStart: number } {
  const n = seq.length
  if (n < 2) return { end: { kind: 'none' }, runStart: 0 }
  for (let i = 1; i < n; i++) {
    if (!Number.isFinite(seq[i])) {
      if (Number.isNaN(seq[i])) break
      return { end: { kind: 'div', sign: seq[i] > 0 ? 1 : -1 }, runStart: i }
    }
  }
  const vals: number[] = []
  for (const v of seq) { if (!Number.isFinite(v)) break; vals.push(v) }
  const m = vals.length
  const dir = (i: number): number => {
    const d = vals[i + 1] - vals[i]
    const nz = Math.max(noise, 1e-13 * Math.max(Math.abs(vals[i]), Math.abs(vals[i + 1])))
    return Math.abs(d) <= nz ? 0 : d > 0 ? 1 : -1
  }
  // the final run: back from the end while the direction agrees
  let runDir = 0
  let runStart = m - 1
  for (let i = m - 2; i >= 0; i--) {
    const d = dir(i)
    if (d === 0) { runStart = i; continue }
    if (runDir === 0) { runDir = d; runStart = i; continue }
    if (d !== runDir) break
    runStart = i
  }
  const runLen = m - 1 - runStart
  const spread = Math.max(1, coreMax - coreMin, Math.abs(coreMax), Math.abs(coreMin))
  if (runLen >= minRun) {
    // turns before the settled run: three or more and the tail was
    // oscillating on its way in (sin(x)/x), so its samples locate nothing
    let turns = 0
    let prev = 0
    for (let i = 0; i < runStart; i++) {
      const d = dir(i)
      if (d === 0) continue
      if (prev !== 0 && d !== prev) turns++
      prev = d
    }
    const wobbly = turns >= 3
    const r = classifyRun(vals, m, runStart, runDir, dir, spread)
    if (r.kind === 'conv' || r.kind === 'div') return { end: wobbly ? { ...r, wobbly } : r, runStart }
    return { end: r, runStart }
  }
  return oscEnd(vals, m, spread)
}

function classifyRun(
  vals: number[],
  m: number,
  runStart: number,
  runDir: number,
  dir: (i: number) => number,
  spread: number,
): EndKind {
  const tailDiffs: number[] = []
  for (let i = Math.max(runStart, m - 6); i + 1 < m; i++) tailDiffs.push(Math.abs(vals[i + 1] - vals[i]))
  const last = vals[m - 1]
  const k = tailDiffs.length
  const lastNoisy = k === 0 || dir(m - 2) === 0
  if (runDir === 0 || (lastNoisy && k >= 2 && dir(m - 3) === 0)) {
    return { kind: 'conv', L: last }
  }
  if (Math.abs(last) > 1e12 * spread) return { kind: 'div', sign: runDir > 0 ? 1 : -1 }
  // ratio of successive steps over the last few rungs
  let ratio = 0
  let cnt = 0
  for (let i = 1; i < k; i++) {
    if (tailDiffs[i - 1] > 0) { ratio += tailDiffs[i] / tailDiffs[i - 1]; cnt++ }
  }
  ratio = cnt > 0 ? ratio / cnt : 0
  if (ratio >= DIVERGE_RATIO) return { kind: 'div', sign: runDir > 0 ? 1 : -1 }
  // converging: Aitken on the last three
  const a = vals[m - 3], b = vals[m - 2], c = vals[m - 1]
  const den = c - 2 * b + a
  let L = c
  if (m >= 3 && den !== 0 && Number.isFinite(den)) {
    const cand = c - ((c - b) * (c - b)) / den
    if (Number.isFinite(cand) && Math.abs(cand - c) <= 10 * Math.abs(c - b) + 1e-300) L = cand
  }
  return { kind: 'conv', L }
}

function oscEnd(vals: number[], m: number, spread: number): { end: EndKind; runStart: number } {
  // no settled run: it oscillates — unless the swings are collapsing
  let min = Infinity, max = -Infinity
  for (let i = 1; i < m; i++) { if (vals[i] < min) min = vals[i]; if (vals[i] > max) max = vals[i] }
  const lastFew = vals.slice(Math.max(1, m - 4))
  const swing = Math.max(...lastFew) - Math.min(...lastFew)
  const earlier = vals.slice(1, Math.max(2, m - 4))
  const swing0 = earlier.length > 0 ? Math.max(...earlier) - Math.min(...earlier) : Infinity
  if (m >= 6 && swing <= 1e-6 * spread && swing <= 1e-3 * swing0) {
    return { end: { kind: 'conv', L: vals[m - 1], wobbly: true }, runStart: m }
  }
  const unbounded = Math.max(Math.abs(max), Math.abs(min)) > 1e6 * spread
  return { end: { kind: 'osc', min, max, unbounded }, runStart: m }
}

/** Golden-section search for a max (sg = 1) or min (sg = −1) of f on [a, b]. */
function golden(f: Fn, a: number, b: number, sg: 1 | -1): number {
  const phi = 0.6180339887498949
  const g = (x: number) => {
    const v = f(x)
    return Number.isFinite(v) ? -sg * v : Infinity
  }
  let lo = a, hi = b
  let x1 = hi - (hi - lo) * phi, x2 = lo + (hi - lo) * phi
  let g1 = g(x1), g2 = g(x2)
  for (let i = 0; i < 100; i++) {
    if (g1 < g2) { hi = x2; x2 = x1; g2 = g1; x1 = hi - (hi - lo) * phi; g1 = g(x1) }
    else { lo = x1; x1 = x2; g1 = g2; x2 = lo + (hi - lo) * phi; g2 = g(x2) }
    if (hi - lo <= 1e-15 * Math.max(1, Math.abs(lo))) break
  }
  return 0.5 * (lo + hi)
}

/** An extremum near x0 (found on [a, b]), polished on f′ and snapped. */
function refineExtremum(ctx: Ctx, a: number, b: number, sg: 1 | -1): { x: number; exact: ExactForm | null; v: number } {
  const { f } = ctx
  let x = golden(f, a, b, sg)
  // polish on f′'s sign change where f is smooth there
  const h = 1e-6 * Math.max(1, Math.abs(x), b - a)
  const dl = richardsonD1(f, Math.max(a, x - h))
  const dr = richardsonD1(f, Math.min(b, x + h))
  if (Number.isFinite(dl) && Number.isFinite(dr) && dl * sg > 0 && dr * sg < 0) {
    let lo = Math.max(a, x - h), hi = Math.min(b, x + h)
    for (let i = 0; i < 80; i++) {
      const m = 0.5 * (lo + hi)
      if (m === lo || m === hi) break
      const d = richardsonD1(f, m)
      if (!Number.isFinite(d)) break
      if (d * sg > 0) lo = m
      else hi = m
    }
    const xp = 0.5 * (lo + hi)
    if (sg * f(xp) >= sg * f(x)) x = xp
  }
  const fx = f(x)
  const tol = 1e-12 * Math.max(1, Math.abs(fx))
  const form = Math.abs(x) < 1e-12
    ? exactForm(0)
    : verifiedExact(x, (c) => {
        const vc = f(c)
        return Number.isFinite(vc) && sg * vc >= sg * fx - tol && c >= a && c <= b
      })
  if (form) return { x: form.value, exact: form, v: valueAt(ctx, form.value, form) }
  return { x, exact: null, v: fx }
}

/** Build the samples of a stretch and read its ends. */
function sampleStretch(ctx: Ctx, s: IntervalPart): {
  core: Sampled[]
  left: Sampled[]
  right: Sampled[]
  leftEnd: EndKind
  rightEnd: EndKind
  /** how many tail samples (counted from the core outward) precede the final settled run */
  leftRun: number
  rightRun: number
  coreMin: number
  coreMax: number
  noise: number
} {
  const { f } = ctx
  const { lo, hi } = s
  // the core
  let cLo: number, cHi: number
  if (Number.isFinite(lo) && Number.isFinite(hi) && hi - lo <= 4 * CORE_W) { cLo = lo; cHi = hi }
  else if (lo <= 0 && hi >= 0) { cLo = Math.max(lo, -CORE_W); cHi = Math.min(hi, CORE_W) }
  else if (lo > 0) { cLo = lo; cHi = Math.min(hi, lo + 2 * CORE_W) }
  else { cHi = hi; cLo = Math.max(lo, hi - 2 * CORE_W) }
  const N = CORE_N
  const core: Sampled[] = []
  for (let i = 0; i <= N; i++) {
    const x = i === N ? cHi : cLo + ((cHi - cLo) * i) / N
    if (i === 0 && x === lo && !s.loClosed) continue
    if (i === N && x === hi && !s.hiClosed) continue
    const v = i === 0 && x === lo ? valueAt(ctx, x, s.loExact) : i === N && x === hi ? valueAt(ctx, x, s.hiExact) : f(x)
    if (!Number.isFinite(v)) continue
    core.push({ x, v })
  }
  let coreMin = Infinity, coreMax = -Infinity
  for (const p of core) { if (p.v < coreMin) coreMin = p.v; if (p.v > coreMax) coreMax = p.v }
  if (!(coreMax >= coreMin)) { coreMin = 0; coreMax = 0 }
  const noise = NOISE_REL * (coreMax - coreMin)

  const side = (sgn: 1 | -1): { pts: Sampled[]; end: EndKind; run: number } => {
    const edgeX = sgn > 0 ? cHi : cLo
    const e = sgn > 0 ? hi : lo
    const eClosed = sgn > 0 ? s.hiClosed : s.loClosed
    const eExact = sgn > 0 ? s.hiExact : s.loExact
    const edgeSample = sgn > 0 ? core[core.length - 1] : core[0]
    if (!edgeSample) return { pts: [], end: { kind: 'none' }, run: 0 }
    if (edgeX === e) {
      if (!Number.isFinite(e)) return { pts: [], end: { kind: 'none' }, run: 0 }
      if (eClosed) return { pts: [], end: { kind: 'closed', v: edgeSample.v }, run: 0 }
      // open finite end at the core's edge: a ladder from the nearest sample
      const from = edgeSample.x
      const d = from - e
      const seq = [edgeSample.v]
      for (let k = 1; k <= LADDER_K; k++) {
        const x = e + d * Math.pow(10, -k)
        if (x === e) break
        seq.push(f(x))
      }
      const c = classifyEnd(seq, noise, LADDER_RUN, coreMin, coreMax)
      return { pts: [], end: c.end, run: 0 }
    }
    // doubling out from the core's edge
    const scale = Math.max(1, Math.abs(edgeX), (cHi - cLo) / 2)
    const pts: Sampled[] = []
    const seq = [edgeSample.v]
    for (let k = 1; k <= TAIL_K; k++) {
      const x = edgeX + sgn * scale * (Math.pow(2, k) - 1)
      if (Number.isFinite(e) && (sgn > 0 ? x >= e : x <= e)) break
      const v = f(x)
      pts.push({ x, v })
      seq.push(v)
      if (!Number.isFinite(v)) break
    }
    if (!Number.isFinite(e)) {
      const c = classifyEnd(seq, noise, TAIL_RUN, coreMin, coreMax)
      const good = pts.filter((p) => Number.isFinite(p.v))
      // seq[j] is pts[j − 1]: the samples up to the start of the final run
      const run = c.end.kind === 'osc' ? good.length : Math.min(good.length, c.runStart + 1)
      return { pts: good, end: c.end, run }
    }
    // a finite end past the tail
    if (eClosed) {
      const v = valueAt(ctx, e, eExact)
      if (Number.isFinite(v)) pts.push({ x: e, v })
      return { pts: pts.filter((p) => Number.isFinite(p.v)), end: { kind: 'closed', v }, run: pts.length }
    }
    const last = pts.length > 0 ? pts[pts.length - 1] : edgeSample
    const d = last.x - e
    const lseq = [last.v]
    for (let k = 1; k <= LADDER_K; k++) {
      const x = e + d * Math.pow(10, -k)
      if (x === e) break
      lseq.push(f(x))
    }
    const c = classifyEnd(lseq, noise, LADDER_RUN, coreMin, coreMax)
    return { pts: pts.filter((p) => Number.isFinite(p.v)), end: c.end, run: pts.length }
  }
  const L = side(-1)
  const R = side(1)
  return {
    core,
    left: L.pts.slice().reverse(),
    right: R.pts,
    leftEnd: L.end,
    rightEnd: R.end,
    leftRun: L.run,
    rightRun: R.run,
    coreMin,
    coreMax,
    noise,
  }
}

interface Jump { x: number; exact: ExactForm | null; v: number; vl: number; vr: number }

/** Steps of the core that are jumps of f, confirmed by bisection. */
function findJumps(ctx: Ctx, core: Sampled[], noise: number): Jump[] {
  const { f } = ctx
  const out: Jump[] = []
  const n = core.length
  if (n < 3) return out
  const d = (i: number) => Math.abs(core[i + 1].v - core[i].v)
  let tries = 0
  for (let i = 0; i + 1 < n; i++) {
    const di = d(i)
    if (!(di > noise) || di === 0) continue
    const before = i > 0 ? d(i - 1) : i + 2 < n ? d(i + 1) : 0
    const after = i + 2 < n ? d(i + 1) : before
    if (!(di > 3 * Math.min(before, after))) continue
    if (++tries > 400) break
    let a = core[i].x, b = core[i + 1].x
    let fa = core[i].v, fb = core[i + 1].v
    for (let k = 0; k < 200; k++) {
      const m = 0.5 * (a + b)
      if (m === a || m === b) break
      const fm = f(m)
      if (!Number.isFinite(fm)) { a = m; fa = fm; break }
      if (Math.abs(fm - fa) >= Math.abs(fb - fm)) { b = m; fb = fm } else { a = m; fa = fm }
    }
    if (!Number.isFinite(fa) || !Number.isFinite(fb)) continue
    if (Math.abs(fb - fa) < 0.25 * di) continue // continuous after all
    const mid = 0.5 * (a + b)
    // snap to the nice number the jump sits on (floor at 1, not 0.9999999999999999)
    let x = b
    let exact: ExactForm | null = null
    const s = snapX(mid, 1e-9)
    if (s.exact && Math.abs(s.x - mid) <= 1e-9 * Math.max(1, Math.abs(mid))) { x = s.x; exact = s.exact }
    const v = valueAt(ctx, x, exact)
    out.push({ x, exact, v, vl: fa, vr: fb })
  }
  return out
}

/** The monotone pieces of one stretch, read off its samples. */
function piecesOf(
  ctx: Ctx,
  s: IntervalPart,
  pts: Sampled[],
  allPts: Sampled[],
  noise: number,
  leftEnd: EndKind,
  rightEnd: EndKind,
): { pieces: MonoPiece[]; extremaVals: number[] } {
  const pieces: MonoPiece[] = []
  const extremaVals: number[] = []
  const n = pts.length
  if (n === 0) return { pieces, extremaVals }
  const dirOf = (i: number): number => {
    const d = pts[i + 1].v - pts[i].v
    if (d === 0) return 0
    const nz = Math.max(noise, 1e-12 * Math.max(Math.abs(pts[i].v), Math.abs(pts[i + 1].v)))
    return Math.abs(d) <= nz ? NaN : d > 0 ? 1 : -1
  }
  // cuts: { index where the new piece starts (a sample), x, exact, closed }
  interface Cut { x: number; exact: ExactForm | null; v: number; i: number }
  const cuts: Cut[] = []
  const flats: { from: number; to: number }[] = []
  let cur = 0
  let curStart = 0
  let flatStart = -1
  for (let i = 0; i + 1 < n; i++) {
    const d = dirOf(i)
    if (Number.isNaN(d)) continue
    if (d === 0) {
      if (flatStart < 0) flatStart = i
      continue
    }
    if (flatStart >= 0) {
      // a flat run from flatStart to i (inclusive samples)
      if (i - flatStart >= 2) flats.push({ from: flatStart, to: i })
      flatStart = -1
    }
    if (cur !== 0 && d !== cur) {
      // the extremum sits at the extreme sample between curStart and i+1
      const sg: 1 | -1 = cur > 0 ? 1 : -1
      let p = i
      for (let j = curStart; j <= i + 1; j++) if (sg * pts[j].v > sg * pts[p].v) p = j
      const a = pts[Math.max(0, p - 1)].x
      const b = pts[Math.min(n - 1, p + 1)].x
      const e = refineExtremum(ctx, a, b, sg)
      cuts.push({ x: e.x, exact: e.exact, v: e.v, i: p })
      extremaVals.push(e.v)
      curStart = i
    }
    if (cur !== d) curStart = cur === 0 ? curStart : curStart
    cur = d
  }
  if (flatStart >= 0 && n - 1 - flatStart >= 2) flats.push({ from: flatStart, to: n - 1 })

  // assemble pieces between cuts (flats become their own constant pieces)
  interface Bound { x: number; exact: ExactForm | null; closed: boolean; v: number; vIn: boolean; idx: number }
  const endVal = (e: EndKind, fallback: number): { v: number; vIn: boolean } => {
    switch (e.kind) {
      case 'closed': return { v: e.v, vIn: true }
      case 'conv': return { v: e.L, vIn: false }
      case 'div': return { v: e.sign * Infinity, vIn: false }
      default: return { v: fallback, vIn: false }
    }
  }
  const lv = endVal(leftEnd, pts[0].v)
  const rv = endVal(rightEnd, pts[n - 1].v)
  const bounds: Bound[] = [{ x: s.lo, exact: s.loExact, closed: s.loClosed, v: lv.v, vIn: lv.vIn, idx: 0 }]
  // flat runs: their ends are cuts too
  const flatCuts: Cut[] = []
  for (const fl of flats) {
    flatCuts.push({ x: pts[fl.from].x, exact: null, v: pts[fl.from].v, i: fl.from })
    flatCuts.push({ x: pts[fl.to].x, exact: null, v: pts[fl.to].v, i: fl.to })
  }
  const allCuts = cuts.concat(flatCuts).sort((a, b) => a.x - b.x)
  for (const c of allCuts) {
    const last = bounds[bounds.length - 1]
    if (same(c.x, last.x)) continue
    bounds.push({ x: c.x, exact: c.exact, closed: true, v: c.v, vIn: true, idx: c.i })
  }
  bounds.push({ x: s.hi, exact: s.hiExact, closed: s.hiClosed, v: rv.v, vIn: rv.vIn, idx: n - 1 })
  if (bounds.length >= 2 && same(bounds[bounds.length - 1].x, bounds[bounds.length - 2].x) && bounds.length > 2) {
    bounds.splice(bounds.length - 2, 1)
  }
  for (let k = 0; k + 1 < bounds.length; k++) {
    const A = bounds[k], B = bounds[k + 1]
    if (!(B.x > A.x)) continue
    const xs: number[] = []
    const vs: number[] = []
    for (const p of allPts) if (p.x >= A.x && p.x <= B.x) { xs.push(p.x); vs.push(p.v) }
    let dir: 1 | -1 | 0 = 0
    if (vs.length >= 2) {
      const lo = Math.min(...vs), hi = Math.max(...vs)
      if (hi === lo) dir = 0
      else dir = vs[vs.length - 1] - vs[0] >= 0 ? 1 : -1
    } else {
      dir = B.v > A.v ? 1 : B.v < A.v ? -1 : 0
    }
    const isFlat = flats.some((fl) => same(pts[fl.from].x, A.x) && same(pts[fl.to].x, B.x))
    if (isFlat) dir = 0
    const wobbles = (e: EndKind) => e.kind === 'osc' || ((e.kind === 'conv' || e.kind === 'div') && !!e.wobbly)
    const unresolved =
      (k === 0 && wobbles(leftEnd)) || (k + 1 === bounds.length - 1 && wobbles(rightEnd))
    pieces.push({
      lo: A.x,
      hi: B.x,
      loClosed: A.closed,
      hiClosed: B.closed,
      loExact: A.exact,
      hiExact: B.exact,
      dir,
      vLo: A.v,
      vHi: B.v,
      vLoIn: A.vIn,
      vHiIn: B.vIn,
      xs,
      vs,
      unresolved,
    })
  }
  return { pieces, extremaVals }
}

/** Everything about one continuous stretch (no jumps inside). */
function analyzeStretch(ctx: Ctx, s: IntervalPart): Stretch {
  const smp = sampleStretch(ctx, s)
  const out: Stretch = {
    lo: s.lo, hi: s.hi, loClosed: s.loClosed, hiClosed: s.hiClosed, loExact: s.loExact, hiExact: s.hiExact,
    unknown: false, inf: Infinity, sup: -Infinity, infIn: false, supIn: false, pieces: [],
  }
  if (smp.core.length === 0) {
    // a single point, or nothing that evaluates
    if (s.lo === s.hi && s.loClosed) {
      const v = valueAt(ctx, s.lo, s.loExact)
      if (Number.isFinite(v)) { out.inf = out.sup = v; out.infIn = out.supIn = true; return out }
    }
    out.unknown = true
    return out
  }
  const finiteEnd = (e: EndKind, x: number) => Number.isFinite(x) && e.kind === 'osc'
  if (finiteEnd(smp.leftEnd, s.lo) || finiteEnd(smp.rightEnd, s.hi)) out.unknown = true

  // samples for extrema and flats: the core, plus the part of a tail before
  // it settles (a settled run is monotone by construction, and may sit on
  // the floor of the arithmetic — e^x far left is 0, 0, 0 — which is not a
  // flat stretch of f). A tail that wobbles is not read for pieces at all.
  const wob = (e: EndKind) => e.kind === 'osc' || ((e.kind === 'conv' || e.kind === 'div') && !!e.wobbly)
  const lAll = wob(smp.leftEnd) ? [] : smp.left
  const rAll = wob(smp.rightEnd) ? [] : smp.right
  const lPre = lAll.slice(lAll.length - Math.min(lAll.length, smp.leftRun))
  const rPre = rAll.slice(0, smp.rightRun)
  const { pieces, extremaVals } = piecesOf(
    ctx, s, lPre.concat(smp.core, rPre), lAll.concat(smp.core, rAll), smp.noise, smp.leftEnd, smp.rightEnd,
  )
  out.pieces = pieces

  // the range: attained values and approached ones
  let sup = -Infinity, inf = Infinity
  let supIn = false, infIn = false
  const attained = (v: number) => {
    if (!Number.isFinite(v)) return
    if (v > sup) { sup = v; supIn = true } else if (v === sup) supIn = true
    if (v < inf) { inf = v; infIn = true } else if (v === inf) infIn = true
  }
  // every sample is a value f takes — except the settled run of a tail that
  // converges: those crowd the limit, and the limit is what they say
  for (const p of smp.core) attained(p.v)
  // (the last pre-run sample is the run's first: it located the turn, but on
  // a tail that settles by underflow — e^(−x²) far out is 0 — it is not a value)
  for (const p of wob(smp.leftEnd) ? smp.left : lPre.slice(1)) attained(p.v)
  for (const p of wob(smp.rightEnd) ? smp.right : rPre.slice(0, -1)) attained(p.v)
  for (const v of extremaVals) attained(v)
  const approached: number[] = []
  const spread = Math.max(1e-300, smp.coreMax - smp.coreMin)
  const end = (e: EndKind) => {
    switch (e.kind) {
      case 'closed': attained(e.v); break
      case 'conv': approached.push(Math.abs(e.L) <= 1e-12 * spread ? 0 : snapY(e.L).v); break
      case 'div': approached.push(e.sign * Infinity); break
      case 'osc':
        if (e.unbounded) {
          if (e.max > 0) approached.push(Infinity)
          if (e.min < 0) approached.push(-Infinity)
        }
        break
      default: break
    }
  }
  end(smp.leftEnd)
  end(smp.rightEnd)
  const eq = (a: number, b: number) =>
    a === b || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-11 * Math.max(Math.abs(a), Math.abs(b)))
  for (const L of approached) {
    if (L > sup && !eq(L, sup)) { sup = L; supIn = false }
    if (L < inf && !eq(L, inf)) { inf = L; infIn = false }
  }
  out.sup = sup
  out.inf = inf
  out.supIn = supIn
  out.infIn = infIn
  return out
}

/** Split a domain part at the jumps inside its core and analyze each stretch. */
function analyzePart(ctx: Ctx, p: IntervalPart, points: number[]): Stretch[] {
  const smp = sampleStretch(ctx, p)
  const jumps = findJumps(ctx, smp.core, smp.noise)
  if (jumps.length === 0 || jumps.length > 60) return [analyzeStretch(ctx, p)]
  const out: Stretch[] = []
  let lo = p.lo, loClosed = p.loClosed, loExact = p.loExact
  for (const j of jumps) {
    if (!(j.x > lo) || !(j.x < p.hi)) continue
    const tolV = 1e-9 * Math.max(1, Math.abs(j.v))
    const joinsLeft = Number.isFinite(j.v) && Math.abs(j.v - j.vl) <= tolV
    const joinsRight = Number.isFinite(j.v) && Math.abs(j.v - j.vr) <= tolV
    out.push(analyzeStretch(ctx, part(lo, j.x, loClosed, joinsLeft, loExact, j.exact)))
    if (!joinsLeft && !joinsRight && Number.isFinite(j.v)) points.push(j.v)
    lo = j.x
    loClosed = joinsRight && !joinsLeft
    loExact = j.exact
  }
  out.push(analyzeStretch(ctx, part(lo, p.hi, loClosed, p.hiClosed, loExact, p.hiExact)))
  return out
}

/**
 * A step function: the core is flat almost everywhere, broken only at jumps.
 * Its values, and whether they run off (floor) or stay put (sign).
 */
function stepValues(ctx: Ctx, parts: IntervalPart[]): Analysis['step'] {
  const values = new Set<number>()
  let pairs = 0, equal = 0
  let unboundedLo = false, unboundedHi = false
  for (const p of parts) {
    const smp = sampleStretch(ctx, p)
    const core = smp.core
    for (let i = 0; i + 1 < core.length; i++) {
      pairs++
      if (core[i].v === core[i + 1].v) equal++
    }
    if (core.length === 1) values.add(core[0].v)
    // every value in the core must sit in a run of equal samples (or on a jump)
    const jumps = findJumps(ctx, core, 0)
    const jumpXs = jumps.map((j) => j.x)
    for (let i = 0; i < core.length; i++) {
      const v = core[i].v
      const run = (i > 0 && core[i - 1].v === v) || (i + 1 < core.length && core[i + 1].v === v)
      if (!run) {
        const nearJump = jumpXs.some((x) => {
          const step = core.length > 1 ? Math.abs(core[1].x - core[0].x) : 1
          return Math.abs(x - core[i].x) <= 1.01 * step
        })
        if (!nearJump) return null
      }
      values.add(v)
    }
    for (const j of jumps) if (Number.isFinite(j.v)) values.add(j.v)
    for (const [tail, sgn] of [[smp.left, -1], [smp.right, 1]] as const) {
      if (tail.length === 0) continue
      const edge = sgn < 0 ? core[0]?.v : core[core.length - 1]?.v
      const constant = tail.every((q) => q.v === edge)
      if (constant) continue
      if (!tail.every((q) => Number.isInteger(q.v))) return null
      const far = sgn < 0 ? tail[0].v : tail[tail.length - 1].v
      if (Math.abs(far) > 1e6) {
        if (far < 0) unboundedLo = true
        else unboundedHi = true
      } else {
        for (const q of tail) values.add(q.v)
      }
    }
    // closed ends past the core
    for (const e of [smp.leftEnd, smp.rightEnd]) if (e.kind === 'closed') values.add(e.v)
  }
  if (pairs === 0 || equal < 0.8 * pairs) return null
  const vals = [...values].filter(Number.isFinite).sort((a, b) => a - b)
  if (vals.length === 0) return null
  return { values: vals, unboundedLo, unboundedHi }
}

function analysisOf(ctx: Ctx, curve: FittedCurve): Analysis {
  return memo(ctx.spec, memoKey(curve, 'ana'), () => {
    const dom = domainInfo(ctx, curve)
    if (dom.unknown) return { stretches: [], points: [], step: null, unknown: true }
    const parts = dom.parts
    const step = parts.length > 0 ? stepValues(ctx, parts) : null
    if (step) return { stretches: [], points: [], step, unknown: false }
    const stretches: Stretch[] = []
    const points: number[] = []
    for (const p of parts) stretches.push(...analyzePart(ctx, p, points))
    return { stretches, points, step: null, unknown: stretches.some((s) => s.unknown) }
  })
}

// ============================================================================
// RANGE
// ============================================================================

function rangeSet(an: Analysis): RealSet {
  if (an.unknown) return unknownSet()
  if (an.step) {
    const { values, unboundedLo, unboundedHi } = an.step
    const allInt = values.every((v) => Number.isInteger(v))
    if (unboundedLo && unboundedHi && allInt) {
      return {
        kind: 'integers', parts: [], text: 'all integers', tex: '\\mathbb{Z}',
        builder: 'all integers', builderTex: '\\text{all integers}',
      }
    }
    if (!unboundedLo && !unboundedHi) {
      const snapped = values.map((v) => snapY(v))
      const uniq: { v: number; exact: ExactForm | null }[] = []
      for (const s of snapped) if (!uniq.some((u) => same(u.v, s.v))) uniq.push(s)
      const t = `{${uniq.map((u) => endTxt(u.v, u.exact)).join(', ')}}`
      const tex = `\\left\\{${uniq.map((u) => endTex(u.v, u.exact)).join(', ')}\\right\\}`
      const one = uniq.length === 1
      return {
        kind: 'finite',
        parts: uniq.map((u) => part(u.v, u.v, true, true, u.exact, u.exact)),
        points: uniq.map((u) => u.v),
        text: t,
        tex,
        builder: one ? `y = ${endTxt(uniq[0].v, uniq[0].exact)}` : t,
        builderTex: one ? `y = ${endTex(uniq[0].v, uniq[0].exact)}` : tex,
      }
    }
    // integers running off one way: {0, 1, 2, …}
    if (allInt) {
      const firsts = unboundedHi ? values.slice(0, 3) : values.slice(-3)
      const listed = firsts.map((v) => numText(v)).join(', ')
      const text = unboundedHi ? `{${listed}, …}` : `{…, ${listed}}`
      const texList = firsts.map((v) => numTex(v)).join(', ')
      const tex = unboundedHi ? `\\left\\{${texList}, \\ldots\\right\\}` : `\\left\\{\\ldots, ${texList}\\right\\}`
      return { kind: 'unknown', parts: [], text, tex, builder: text, builderTex: tex }
    }
    return unknownSet()
  }
  const parts: IntervalPart[] = []
  for (const s of an.stretches) {
    if (!(s.sup >= s.inf)) continue
    const a = snapY(s.inf)
    const b = snapY(s.sup)
    parts.push(part(a.v, b.v, s.infIn, s.supIn, a.exact, b.exact))
  }
  for (const v of an.points) {
    const a = snapY(v)
    parts.push(part(a.v, a.v, true, true, a.exact, a.exact))
  }
  const merged = mergeParts(parts)
  return setOf(merged, 'y')
}

/** The values f takes on its curve domain (see the header). Null for a non-explicit curve. */
export function curveRange(curve: FittedCurve, models: Record<string, ModelSpec>): RealSet | null {
  try {
    const ctx = ctxOf(curve, models)
    if (!ctx) return null
    return rangeSet(analysisOf(ctx, curve))
  } catch {
    return null
  }
}

// ============================================================================
// ONE-TO-ONE
// ============================================================================

/** The x on a monotone piece where f = y, or null. */
function solveOnPiece(ctx: Ctx, pc: MonoPiece, y: number): number | null {
  const { f } = ctx
  const xs = pc.xs, vs = pc.vs
  // the piece's own ends first (an attained end value)
  const tol = 1e-12 * Math.max(1, Math.abs(y))
  if (pc.loClosed && Math.abs(pc.vLo - y) <= tol && pc.vLoIn) return pc.lo
  if (pc.hiClosed && Math.abs(pc.vHi - y) <= tol && pc.vHiIn) return pc.hi
  for (let i = 0; i < xs.length; i++) if (vs[i] === y) return xs[i]
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = vs[i] - y, b = vs[i + 1] - y
    if (a * b < 0) return bisectLevel(f, xs[i], xs[i + 1], y)
  }
  // between an end and the nearest sample (the ladder side)
  const tryEnd = (xEnd: number, vEnd: number, xIn: number, vIn: number): number | null => {
    if (!Number.isFinite(xEnd)) return null
    if ((vEnd - y) * (vIn - y) >= 0 && Number.isFinite(vEnd)) return null
    if (!Number.isFinite(vEnd) && Math.sign(vEnd) === Math.sign(vIn - y)) return null
    // bisect between the end (nudged inside) and the sample
    let a = xEnd, b = xIn
    for (let k = 0; k < 200; k++) {
      const m = 0.5 * (a + b)
      if (m === a || m === b) break
      const fm = f(m) - y
      if (!Number.isFinite(fm)) { a = m; continue }
      if (fm === 0) return m
      if ((fm > 0) === (vIn - y > 0)) b = m
      else a = m
    }
    return 0.5 * (a + b)
  }
  if (xs.length > 0) {
    const r1 = tryEnd(pc.lo, pc.vLo, xs[0], vs[0])
    if (r1 !== null) return r1
    const r2 = tryEnd(pc.hi, pc.vHi, xs[xs.length - 1], vs[vs.length - 1])
    if (r2 !== null) return r2
  }
  return null
}

function bisectLevel(f: Fn, a: number, b: number, y: number): number {
  let lo = a, hi = b
  let flo = f(lo) - y
  for (let i = 0; i < 200; i++) {
    const m = 0.5 * (lo + hi)
    if (m === lo || m === hi) break
    const fm = f(m) - y
    if (fm === 0) return m
    if (!Number.isFinite(fm)) break
    if ((fm > 0) === (flo > 0)) { lo = m; flo = fm } else hi = m
  }
  return 0.5 * (lo + hi)
}

/** Snap a crossing to an exact form the curve agrees with. */
function snapCrossing(ctx: Ctx, x: number, y: number): number {
  if (Math.abs(x) < 1e-13) {
    const v0 = ctx.f(0)
    if (Number.isFinite(v0) && Math.abs(v0 - y) <= 1e-9 * Math.max(1, Math.abs(y))) return 0
  }
  const form = exactForm(x, { tol: 1e-10 })
  if (!form) return x
  const v = valueAt(ctx, form.value, form)
  if (Number.isFinite(v) && Math.abs(v - y) <= 1e-9 * Math.max(1, Math.abs(y))) return form.value
  return x
}

/** The nicest number strictly inside (a, b): 0, a small integer, then the roundest decimal. */
function nicestIn(a: number, b: number): number | null {
  if (!(b > a)) return null
  const inside = (v: number) => v > a && v < b && !same(v, a) && !same(v, b)
  if (inside(0)) return 0
  const lo = Number.isFinite(a) ? a : Math.min(b - 1, -1)
  const hi = Number.isFinite(b) ? b : Math.max(a + 1, 1)
  // the coarsest grid of 1, 2 or 5 × 10^k that lands inside, nearest 0
  const width = Number.isFinite(b - a) ? b - a : Math.max(1, Math.abs(lo), Math.abs(hi))
  for (let k = Math.ceil(Math.log10(Math.max(width, 1e-300))) + 1; k >= -15; k--) {
    for (const m of [5, 2, 1]) {
      const step = m * Math.pow(10, k)
      if (step > Math.max(Math.abs(lo), Math.abs(hi)) * 4 && k > 0) continue
      const first = Math.ceil(lo / step)
      const last = Math.floor(hi / step)
      let best: number | null = null
      for (let p = first; p <= last && p - first < 64; p++) {
        const v = Number((p * step).toPrecision(12))
        if (inside(v) && (best === null || Math.abs(v) < Math.abs(best) || (Math.abs(v) === Math.abs(best) && v > best))) best = v
      }
      if (best === null && last - first >= 64) {
        const v = Number((first * step).toPrecision(12))
        if (inside(v)) best = v
      }
      if (best !== null) return best
    }
  }
  return 0.5 * (lo + hi)
}

/** The interval of values of a monotone piece: [lo, hi] with ownership. */
function pieceValues(pc: MonoPiece): { lo: number; hi: number; loIn: boolean; hiIn: boolean } {
  if (pc.dir === 0) {
    const v = pc.vs.length > 0 ? pc.vs[0] : pc.vLo
    return { lo: v, hi: v, loIn: true, hiIn: true }
  }
  const aIn = pc.vLoIn && pc.loClosed
  const bIn = pc.vHiIn && pc.hiClosed
  return pc.vLo <= pc.vHi
    ? { lo: pc.vLo, hi: pc.vHi, loIn: aIn, hiIn: bIn }
    : { lo: pc.vHi, hi: pc.vLo, loIn: bIn, hiIn: aIn }
}

/** The chips' order: widest first; rays pointing right before left; nearest 0; positive side. */
function chipOrder(a: IntervalPart, b: IntervalPart): number {
  const wa = a.hi - a.lo, wb = b.hi - b.lo
  const infA = !Number.isFinite(wa), infB = !Number.isFinite(wb)
  if (infA !== infB) return infA ? -1 : 1
  if (infA && infB) {
    const ra = !Number.isFinite(a.hi) && Number.isFinite(a.lo)
    const rb = !Number.isFinite(b.hi) && Number.isFinite(b.lo)
    if (ra !== rb) return ra ? -1 : 1
  } else if (!same(wa, wb)) {
    return wb - wa
  }
  const d = (p: IntervalPart) => (p.lo <= 0 && p.hi >= 0 ? 0 : Math.min(Math.abs(p.lo), Math.abs(p.hi)))
  const da = d(a), db = d(b)
  if (!same(da, db)) return da - db
  const mid = (p: IntervalPart) => (Number.isFinite(p.lo) ? p.lo : 0) + (Number.isFinite(p.hi) ? p.hi : 0)
  return mid(b) - mid(a)
}

/** The horizontal line test (see the header). Null for a non-explicit curve. */
export function oneToOneInfo(curve: FittedCurve, models: Record<string, ModelSpec>): OneToOne | null {
  try {
    const ctx = ctxOf(curve, models)
    if (!ctx) return null
    const an = analysisOf(ctx, curve)
    if (an.step) {
      // flat treads: not one-to-one; the witness is the widest tread's level
      const dom = domainInfo(ctx, curve)
      return { oneToOne: false, witness: stepWitness(ctx, dom.parts), monotone: [] }
    }
    const all: MonoPiece[] = []
    for (const s of an.stretches) all.push(...s.pieces)
    const mono = all.filter((p) => p.dir !== 0 && !p.unresolved && p.hi > p.lo)
    const flats = all.filter((p) => p.dir === 0 && p.hi > p.lo)

    let oneToOne = !an.unknown && flats.length === 0 && an.stretches.every((s) => s.pieces.length === 1 && !s.pieces[0].unresolved)
    if (oneToOne) {
      // the stretches' values must not overlap
      const rs = an.stretches.map((s) => ({ lo: s.inf, hi: s.sup, loIn: s.infIn, hiIn: s.supIn }))
      for (const v of an.points) rs.push({ lo: v, hi: v, loIn: true, hiIn: true })
      outer: for (let i = 0; i < rs.length; i++) {
        for (let j = i + 1; j < rs.length; j++) {
          if (overlaps(rs[i], rs[j])) { oneToOne = false; break outer }
        }
      }
    }
    const monotone = mono.map((p) => part(p.lo, p.hi, p.loClosed, p.hiClosed, p.loExact, p.hiExact)).sort(chipOrder)
    if (oneToOne) return { oneToOne: true, monotone }

    // a witness: the nicest height two pieces share
    let best: { y: number; score: number } | null = null
    const consider = (y: number | null) => {
      if (y === null || !Number.isFinite(y)) return
      const score = niceScore(y)
      if (!best || score < best.score) best = { y, score }
    }
    for (let i = 0; i < mono.length; i++) {
      for (let j = i + 1; j < mono.length; j++) {
        const a = pieceValues(mono[i]), b = pieceValues(mono[j])
        const lo = Math.max(a.lo, b.lo), hi = Math.min(a.hi, b.hi)
        if (hi > lo && !same(hi, lo)) consider(nicestIn(lo, hi))
      }
    }
    let witness: OneToOne['witness']
    const chosen = best as { y: number; score: number } | null
    if (chosen) {
      const y = snapY(chosen.y)
      const xs: number[] = []
      for (const pc of mono) {
        const r = pieceValues(pc)
        const inside =
          (y.v > r.lo || (r.loIn && same(y.v, r.lo))) && (y.v < r.hi || (r.hiIn && same(y.v, r.hi)))
        if (!inside) continue
        const x = solveOnPiece(ctx, pc, y.v)
        if (x === null) continue
        const xx = snapCrossing(ctx, x, y.v)
        if (!xs.some((q) => same(q, xx))) xs.push(xx)
      }
      xs.sort((p, q) => p - q)
      // a periodic curve crosses in every period: keep the six nearest 0
      const near = xs.length > 6 ? xs.slice().sort((p, q) => Math.abs(p) - Math.abs(q) || q - p).slice(0, 6).sort((p, q) => p - q) : xs
      if (near.length >= 2) witness = { y: y.v, exactY: y.exact, xs: near }
    }
    if (!witness && flats.length > 0) {
      const fl = flats.slice().sort((a, b) => (b.hi - b.lo) - (a.hi - a.lo))[0]
      const v = fl.vs.length > 0 ? fl.vs[0] : fl.vLo
      const y = snapY(v)
      const x0 = fl.loClosed ? fl.lo : fl.xs[0] ?? fl.lo
      const x1 = fl.xs.length > 1 ? fl.xs[Math.floor(fl.xs.length / 2)] : fl.hi
      witness = { y: y.v, exactY: y.exact, xs: [x0, x1].sort((p, q) => p - q) }
    }
    return witness ? { oneToOne: false, witness, monotone } : { oneToOne: false, monotone }
  } catch {
    return null
  }
}

function overlaps(
  a: { lo: number; hi: number; loIn: boolean; hiIn: boolean },
  b: { lo: number; hi: number; loIn: boolean; hiIn: boolean },
): boolean {
  const lo = Math.max(a.lo, b.lo)
  const hi = Math.min(a.hi, b.hi)
  if (hi > lo && !same(hi, lo)) return true
  if (same(hi, lo) && Number.isFinite(lo)) {
    const inA = (v: number) => (v > a.lo || (a.loIn && same(v, a.lo))) && (v < a.hi || (a.hiIn && same(v, a.hi)))
    const inB = (v: number) => (v > b.lo || (b.loIn && same(v, b.lo))) && (v < b.hi || (b.hiIn && same(v, b.hi)))
    return inA(lo) && inB(lo)
  }
  return false
}

/** Lower is nicer: 0, then small integers, then halves, then the rest. */
function niceScore(y: number): number {
  if (y === 0) return 0
  const neg = y < 0 ? 1e-6 : 0
  if (Number.isInteger(y)) return Math.abs(y) + (y < 0 ? 0.5 : 0)
  if (Number.isInteger(2 * y)) return 1000 + Math.abs(y) + neg
  if (Number.isInteger(10 * y)) return 2000 + Math.abs(y) + neg
  return 10000 + Math.abs(y) + neg
}

function stepWitness(ctx: Ctx, parts: IntervalPart[]): OneToOne['witness'] {
  // the level nearest 0 that f holds on a whole stretch
  const lv = levelSamples(ctx, parts)
  let best: { y: number; xs: number[]; all: number[] } | null = null
  for (const [y, list] of lv.levels) {
    if (list.length < 2) continue
    if (!best || Math.abs(y) < Math.abs(best.y) || (Math.abs(y) === Math.abs(best.y) && y > best.y)) best = { y, xs: list, all: lv.all }
  }
  if (!best) return undefined
  const y = snapY(best.y)
  // the first unbroken run of the tread, and the two nicest x's on it
  const list = best.xs
  const step = list.length > 1 ? Math.min(...list.slice(1).map((x, i) => x - list[i])) : 1
  let end = 0
  while (end + 1 < list.length && list[end + 1] - list[end] <= 1.5 * step) end++
  const all = best.all
  const ia = all.indexOf(list[0]), ib = all.indexOf(list[end])
  const a = ia > 0 ? all[ia - 1] : list[0]
  const b = ib >= 0 && ib + 1 < all.length ? all[ib + 1] : list[end]
  const cands: number[] = []
  for (const q of [1, 2, 4, 10]) {
    for (let p = Math.ceil(a * q); p <= Math.floor(b * q) && cands.length < 400; p++) {
      const x = p / q + 0
      if (!cands.some((c) => same(c, x))) cands.push(x)
    }
  }
  const ok = cands.filter((x) => ctxValueIs(ctx, x, best!.y)).sort((p, q) => niceScore(p) - niceScore(q))
  const xs = ok.length >= 2 ? ok.slice(0, 2) : [list[0], list[Math.floor(end / 2)]]
  if (same(xs[0], xs[1])) return undefined
  return { y: y.v, exactY: y.exact, xs: xs.sort((p, q) => p - q) }
}

const ctxValueIs = (ctx: Ctx, x: number, y: number): boolean => ctx.f(x) === y

function levelSamples(ctx: Ctx, parts: IntervalPart[]): { levels: Map<number, number[]>; all: number[] } {
  const m = new Map<number, number[]>()
  const all: number[] = []
  for (const p of parts) {
    const lo = Number.isFinite(p.lo) ? p.lo : -CORE_W
    const hi = Number.isFinite(p.hi) ? p.hi : CORE_W
    const a = Math.max(lo, -CORE_W), b = Math.min(hi, CORE_W)
    const n = 400
    for (let i = 0; i <= n; i++) {
      const x = a + ((b - a) * i) / n
      if ((x === p.lo && !p.loClosed) || (x === p.hi && !p.hiClosed)) continue
      const v = ctx.f(x)
      if (!Number.isFinite(v)) continue
      all.push(x)
      const list = m.get(v)
      if (list) list.push(x)
      else m.set(v, [x])
    }
  }
  return { levels: m, all }
}

// ============================================================================
// LEVEL CROSSINGS — every frame of a dragged horizontal line
// ============================================================================

/**
 * Every x in `span` (and the curve domain) where f(x) = y, ascending —
 * crossings and touches, refined to double precision, snapped to exact
 * forms' values where they are one. Cheap enough to run on every pointer
 * move of a dragged horizontal line (~1 ms for a typed curve on a 1000-sample
 * scan).
 *
 * Where f equals y on a whole stretch (a tread of floor), the stretch's two
 * ends inside the span are reported (its first and last point the scan saw).
 */
export function levelCrossings(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  y: number,
  span: [number, number],
): number[] {
  try {
    const ctx = ctxOf(curve, models)
    if (!ctx || !Number.isFinite(y) || !span) return []
    let lo = Math.min(span[0], span[1])
    let hi = Math.max(span[0], span[1])
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return []
    const R = restrictionParts(curve, ctx.spec, ctx.params)
    const windows = intersectParts(R, [part(lo, hi, true, true)])
    const out: number[] = []
    const scale = Math.max(1, Math.abs(y))
    const g = (x: number) => ctx.f(x) - y
    const total = windows.reduce((s, w) => s + (w.hi - w.lo), 0)
    for (const w of windows) {
      lo = w.lo
      hi = w.hi
      if (lo === hi) {
        if (w.loClosed && Math.abs(g(lo)) <= 1e-9 * scale) out.push(lo)
        continue
      }
      const n = Math.max(16, Math.round((1000 * (hi - lo)) / (total || 1)))
      const xs = new Array<number>(n + 1)
      const gs = new Array<number>(n + 1)
      for (let i = 0; i <= n; i++) {
        let x = i === n ? hi : lo + ((hi - lo) * i) / n
        if (i === 0 && !w.loClosed) x = lo + (hi - lo) * 1e-9
        if (i === n && !w.hiClosed) x = hi - (hi - lo) * 1e-9
        xs[i] = x
        gs[i] = g(x)
      }
      // spread of the sampled values, for the pole guard
      let mag = 0
      for (const v of gs) if (Number.isFinite(v)) mag = Math.max(mag, Math.abs(v + y))
      const zeroTol = 1e-7 * Math.max(scale, 1)
      let run = -1
      for (let i = 0; i <= n; i++) {
        if (gs[i] === 0) {
          if (run < 0) run = i
          continue
        }
        if (run >= 0) {
          out.push(xs[run])
          if (i - 1 > run) out.push(xs[i - 1])
          run = -1
        }
      }
      if (run >= 0) { out.push(xs[run]); if (n > run) out.push(xs[n]) }
      for (let i = 0; i < n; i++) {
        const a = gs[i], b = gs[i + 1]
        if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0 || b === 0) continue
        if ((a > 0) === (b > 0)) continue
        const r = bisectLevel(ctx.f, xs[i], xs[i + 1], y)
        const gr = g(r)
        if (!Number.isFinite(gr) || Math.abs(gr) > zeroTol * Math.max(1, 1e-3 * mag)) continue // a pole or a jump
        out.push(r)
      }
      // touches: |g| dips to 0 without a sign change
      for (let i = 1; i < n; i++) {
        const a = gs[i - 1], b = gs[i], c = gs[i + 1]
        if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) continue
        if (a === 0 || b === 0 || c === 0) continue
        if ((a > 0) !== (c > 0) || (a > 0) !== (b > 0)) continue
        if (!(Math.abs(b) <= Math.abs(a) && Math.abs(b) <= Math.abs(c))) continue
        const sg: 1 | -1 = b > 0 ? -1 : 1 // toward zero: a min of g>0 is a min
        const xm = golden(ctx.f, xs[i - 1], xs[i + 1], sg)
        const gm = g(xm)
        if (Number.isFinite(gm) && Math.abs(gm) <= 1e-10 * scale) out.push(xm)
      }
    }
    out.sort((a, b) => a - b)
    const res: number[] = []
    for (const x of out) {
      const s = snapCrossing(ctx, x, y)
      const v = ctx.f(s)
      // a snapped crossing at a hole is no crossing at all
      if (!Number.isFinite(v) && s !== x) continue
      if (!Number.isFinite(ctx.f(x))) continue
      if (res.length > 0 && same(res[res.length - 1], s)) continue
      res.push(s)
    }
    return res
  } catch {
    return []
  }
}

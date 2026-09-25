// ============================================================================
// src/ui/expLinks.ts — an exponential function, edited the way it is STATED.
//
// src/core/exponential.ts is the bridge between a typed line and the numbers
// a precalculus class states — y = a·b^((x − h)/p) + k — and every way of
// stating its rate. Everything here sits on top of that bridge and is pure
// (no React, no DOM, no App state):
//
//   * the three tabs of the "Build ▾ → Exponential" card — Rate, Two points,
//     Parameters — as field sets that each turn into ONE ExpSpec, and are each
//     re-seeded from that spec when the teacher switches tab, so switching
//     tabs never changes the curve;
//   * the "rate as" rewrite on a card: the same function, re-stated as a
//     factor per unit, a percent, a doubling time / half-life or a continuous
//     rate;
//   * one committed field edit on a card's Exponential section;
//   * the board handles — the asymptote, the y-intercept, the point one
//     period later — and what a vertical drag of each one rewrites;
//   * the note a SKETCHED curve that fitted the library's a·e^{bx} + c wears,
//     and the typed line "Convert to typed exponential" replaces it with.
//
// Every result is an ordinary typed curve. Nothing downstream knows.
// ============================================================================

import type { Vec2 } from '../core/types'
import {
  expFeatures,
  expFromRate,
  expFromTwoPoints,
  expSource,
  rateOf,
  readExponential,
} from '../core/exponential'
import type { ExpFeatures, ExpRate, ExpSpec, RateStatement } from '../core/exponential'
import { parseExpression } from '../core/parse'
import { evalText, niceNumber } from './factorLinks'

// ---------------------------------------------------------------------------
// numbers
// ---------------------------------------------------------------------------

/** v rounded to n significant digits, as a number. */
export function roundSig(v: number, n: number): number {
  if (!Number.isFinite(v) || v === 0) return v
  return Number(v.toPrecision(n))
}

/**
 * A computed number written into the line: a small fraction when it is one,
 * otherwise `sig` significant digits (6 keeps a rewritten curve identical to
 * the eye and to four decimal places at any sample point a class will read).
 */
export function numOut(v: number, sig = 6, relTol = EXP_TOL): string {
  if (!Number.isFinite(v)) return '0'
  if (Math.abs(v) < 1e-12) return '0'
  // A fraction the arithmetic produced (1/3, −5/7) — written as one only when
  // it IS that fraction, and only when no short decimal says it (0.5, 5.7).
  const t = niceNumber(v)
  const back = evalText(t)
  const exactFraction =
    t.includes('/') && back !== null && Math.abs(back - v) <= 1e-9 * Math.max(1, Math.abs(v))
  // The shortest decimal within a hair of v: a number that went through one
  // six-digit rounding already (a factor per unit, then a half-life from it)
  // comes back as 5.69999 — it is 5.7, to 2 parts in a million.
  for (let n = 1; n <= sig; n++) {
    const r = roundSig(v, n)
    if (Math.abs(r - v) <= relTol * Math.abs(v)) {
      const dec = String(r)
      if (dec.includes('e')) return niceNumber(r)
      const places = (dec.split('.')[1] ?? '').length
      if (exactFraction && places > 4) return t
      return dec
    }
  }
  if (exactFraction) return t
  const r = roundSig(v, sig)
  const dec = String(r)
  return dec.includes('e') ? niceNumber(r) : dec
}

/**
 * A growth factor written back. What the curve feels is ln b, not b — near
 * b = 1 a tiny change in b is a large change in the rate — so the tolerance
 * is on ln b: 0.8854983 is 0.885498, never 0.8855.
 */
export function baseOut(b: number): string {
  if (!(b > 0)) return numOut(b)
  return numOut(b, 8, EXP_TOL * Math.min(1, Math.abs(Math.log(b))))
}

/** A percent change written back, with the same care as its base. */
export function pctOut(pct: number, beta: number): string {
  if (!(pct > 0) || !(beta > 0)) return numOut(pct)
  const rel = (EXP_TOL * Math.min(1, Math.abs(Math.log(beta))) * beta * 100) / pct
  return numOut(pct, 8, Math.min(EXP_TOL, rel))
}

/**
 * How close a written-back number has to be to what it stands for: three
 * parts in a million, below anything a board or a class can read.
 */
export const EXP_TOL = 3e-6

/** The numbers of a spec, every form reduced to f(x) = a·β^((x − h)/P) + k. */
export interface ExpValues {
  a: number
  /** The factor per period P (for base e, e^r with P = 1). */
  beta: number
  /** The period β applies over. */
  P: number
  h: number
  k: number
  /** Growth factor per one unit of x. */
  perUnit: number
}

export function isBaseE(spec: ExpSpec): boolean {
  return spec.b.trim() === 'e'
}

/** Every field evaluated, or null while one does not. */
export function expValues(spec: ExpSpec): ExpValues | null {
  const a = evalText(spec.a)
  const h = evalText(spec.h || '0')
  const k = evalText(spec.k || '0')
  if (a === null || h === null || k === null) return null
  let beta: number
  let P: number
  if (isBaseE(spec)) {
    const r = evalText(spec.rate ?? '')
    if (r === null) return null
    const pe = evalText(spec.p || '1') ?? 1
    beta = Math.exp(r)
    P = pe === 0 ? 1 : pe
  } else {
    const b = evalText(spec.b)
    const p = evalText(spec.p || '1')
    if (b === null || p === null) return null
    beta = b
    P = p
  }
  if (!(beta > 0) || P === 0) return null
  const perUnit = Math.pow(beta, 1 / P)
  if (!Number.isFinite(perUnit)) return null
  return { a, beta, P, h, k, perUnit }
}

/** f(x) for a spec, or NaN. */
export function expEval(spec: ExpSpec, x: number): number {
  const v = expValues(spec)
  if (!v) return NaN
  return v.a * Math.pow(v.beta, (x - v.h) / v.P) + v.k
}

// ---------------------------------------------------------------------------
// what is wrong
// ---------------------------------------------------------------------------

export type ExpField = 'a' | 'b' | 'p' | 'rate' | 'h' | 'k'

export interface ExpProblem {
  field: ExpField
  message: string
}

/** Every field that stops the spec being an exponential. Empty = buildable. */
export function expProblems(spec: ExpSpec): ExpProblem[] {
  const out: ExpProblem[] = []
  const num = (field: ExpField, text: string | undefined, what: string): number | null => {
    const t = (text ?? '').trim()
    const v = t === '' ? null : evalText(t)
    if (v === null) {
      out.push({
        field,
        message: t === '' ? `The ${what} is empty.` : `The ${what} “${t}” is not a number.`,
      })
    }
    return v
  }
  const a = num('a', spec.a, 'initial value a')
  if (a === 0) out.push({ field: 'a', message: 'a can’t be 0 — that is the line y = k.' })
  if (isBaseE(spec)) {
    const r = num('rate', spec.rate, 'continuous rate r')
    if (r === 0) out.push({ field: 'rate', message: 'A continuous rate of 0 is a constant.' })
  } else {
    const b = num('b', spec.b, 'growth factor b')
    if (b !== null) {
      if (b <= 0) out.push({ field: 'b', message: 'The growth factor b must be positive.' })
      else if (b === 1) out.push({ field: 'b', message: 'b = 1 never changes — that is a constant.' })
    }
    const p = num('p', spec.p || '1', 'period p')
    if (p === 0) out.push({ field: 'p', message: 'The period p can’t be 0.' })
  }
  num('h', spec.h || '0', 'shift h')
  num('k', spec.k || '0', 'asymptote k')
  return out
}

// ---------------------------------------------------------------------------
// the core, never throwing
// ---------------------------------------------------------------------------

export function safeReadExponential(src: string | undefined): ExpSpec | null {
  if (!src || !src.trim()) return null
  try {
    const s = readExponential(src)
    return s && expValues(s) ? s : null
  } catch {
    return null
  }
}

export function safeSource(spec: ExpSpec): string | null {
  if (expProblems(spec).length > 0) return null
  try {
    return expSource(spec)
  } catch {
    return null
  }
}

export function safeRate(spec: ExpSpec): ExpRate | null {
  if (expProblems(spec).length > 0) return null
  try {
    return rateOf(spec)
  } catch {
    return null
  }
}

export function safeFeatures(spec: ExpSpec): ExpFeatures | null {
  if (expProblems(spec).length > 0) return null
  try {
    return expFeatures(spec)
  } catch {
    return null
  }
}

/** The features as the card lists them: asymptote, range, direction, ends. */
export function featureLines(f: ExpFeatures | null): string[] {
  if (!f) return []
  const out: string[] = []
  out.push(`Horizontal asymptote y = ${minus(numOut(f.asymptote, 4))}`)
  if (f.yIntercept !== null && Number.isFinite(f.yIntercept)) {
    out.push(`y-intercept (0, ${minus(numOut(f.yIntercept, 4))})`)
  }
  if (f.range) out.push(`Range: ${f.range}`)
  out.push(
    `${f.increasing ? 'Increasing' : 'Decreasing'}, concave ${f.concaveUp ? 'up' : 'down'}`,
  )
  if (f.endBehaviour) out.push(f.endBehaviour)
  return out
}

/** A true minus sign for display. */
export function minus(t: string): string {
  return t.replace(/^-/, '−')
}

// ---------------------------------------------------------------------------
// "starts at"
// ---------------------------------------------------------------------------

/**
 * The value the Rate tab's "Starts at" field shows for a spec: the value at
 * the start of the clock, f(h) = a + k — so "starts at 200 with asymptote 10"
 * is a = 190. It is whatever expFromRate reads its `init` as: the rule is
 * asked of the core (with the asymptote at 10, does init 100 give a = 90 or
 * a = 100?) rather than assumed here, so the two can never disagree.
 */
export function startsAtIsValue(): boolean {
  try {
    const s = expFromRate('100', { kind: 'factor', b: '2' }, '10')
    const a = evalText(s.a)
    return a !== null && Math.abs(a - 90) < 1e-9
  } catch {
    return true
  }
}

export function startsAtOf(spec: ExpSpec): string {
  const v = expValues(spec)
  if (!v) return spec.a
  if (!startsAtIsValue() || v.k === 0) return spec.a
  return numOut(v.a + v.k)
}

// ---------------------------------------------------------------------------
// the three tabs
// ---------------------------------------------------------------------------

export type ExpTab = 'rate' | 'points' | 'params'

export type RateKind = 'factor' | 'percent' | 'doubling' | 'half-life' | 'continuous'

export const RATE_KINDS: { kind: RateKind; label: string }[] = [
  { kind: 'factor', label: 'growth factor b' },
  { kind: 'percent', label: 'percent change' },
  { kind: 'doubling', label: 'doubles every' },
  { kind: 'half-life', label: 'half-life' },
  { kind: 'continuous', label: 'continuous rate r' },
]

export interface RateFields {
  init: string
  kind: RateKind
  b: string
  per: string
  pct: string
  grows: boolean
  time: string
  r: string
  h: string
  k: string
}

export interface PointFields {
  x1: string
  y1: string
  x2: string
  y2: string
  k: string
}

export interface ParamFields {
  a: string
  b: string
  p: string
  /** The continuous rate, used when b is "e". */
  r: string
  h: string
  k: string
}

export interface ExpDraft {
  tab: ExpTab
  rate: RateFields
  points: PointFields
  params: ParamFields
  /**
   * The function carried over by a tab switch, EXACTLY as it was. A tab's
   * fields are re-seeded from it, but re-deriving it from those (rounded)
   * fields would drift — a half-life of 5.7 becomes 5.69999 after a trip
   * through a factor per unit — so until a field on the new tab is edited,
   * the curve IS the carried spec. Any edit clears it.
   */
  carried?: ExpSpec | null
}

export function blankDraft(): ExpDraft {
  const rate: RateFields = {
    init: '100',
    kind: 'percent',
    b: '2',
    per: '1',
    pct: '5',
    grows: true,
    time: '1',
    r: '0.05',
    h: '0',
    k: '0',
  }
  const spec = specFromRate(rate).spec ?? { a: '100', b: '1.05', p: '1', h: '0', k: '0' }
  return {
    tab: 'rate',
    rate,
    points: pointFieldsFrom(spec),
    params: paramFieldsFrom(spec),
  }
}

export interface SpecResult {
  spec: ExpSpec | null
  error: string | null
}

function need(text: string, what: string): string | null {
  const t = text.trim()
  if (t === '') return `The ${what} is empty.`
  if (evalText(t) === null) return `The ${what} “${t}” is not a number.`
  return null
}

/** The rate statement the Rate tab's fields make. */
export function rateStatement(f: RateFields): RateStatement {
  switch (f.kind) {
    case 'factor':
      return { kind: 'factor', b: f.b.trim(), per: f.per.trim() || '1' }
    case 'percent':
      return { kind: 'percent', pct: f.pct.trim(), grows: f.grows, per: f.per.trim() || '1' }
    case 'doubling':
      return { kind: 'doubling', time: f.time.trim() }
    case 'half-life':
      return { kind: 'half-life', time: f.time.trim() }
    case 'continuous':
      return { kind: 'continuous', r: f.r.trim() }
  }
}

export function specFromRate(f: RateFields): SpecResult {
  const checks: (string | null)[] = [need(f.init, 'starting value')]
  switch (f.kind) {
    case 'factor':
      checks.push(need(f.b, 'growth factor'), need(f.per || '1', 'period'))
      break
    case 'percent':
      checks.push(need(f.pct, 'percent'), need(f.per || '1', 'period'))
      break
    case 'doubling':
    case 'half-life':
      checks.push(need(f.time, f.kind === 'doubling' ? 'doubling time' : 'half-life'))
      break
    case 'continuous':
      checks.push(need(f.r, 'continuous rate'))
      break
  }
  checks.push(need(f.h || '0', 'shift h'), need(f.k || '0', 'asymptote'))
  const first = checks.find((c) => c !== null)
  if (first) return { spec: null, error: first }
  if (f.kind === 'doubling' || f.kind === 'half-life') {
    const t = evalText(f.time)!
    if (t <= 0) return { spec: null, error: `The ${f.kind === 'doubling' ? 'doubling time' : 'half-life'} must be positive.` }
  }
  if (f.kind === 'percent') {
    const pct = evalText(f.pct)!
    if (pct <= 0) return { spec: null, error: 'The percent must be positive — choose grows or decays.' }
    if (!f.grows && pct >= 100) return { spec: null, error: 'A decay of 100% or more leaves nothing to decay.' }
  }
  let spec: ExpSpec
  try {
    spec = expFromRate(f.init.trim(), rateStatement(f), (f.k || '0').trim())
  } catch {
    return { spec: null, error: 'That rate could not be written out.' }
  }
  spec = { ...spec, h: (f.h || '0').trim() || '0' }
  const p = expProblems(spec)
  return p.length > 0 ? { spec: null, error: p[0].message } : { spec, error: null }
}

export function specFromPoints(f: PointFields): SpecResult {
  const first = [
    need(f.x1, 'x₁'),
    need(f.y1, 'y₁'),
    need(f.x2, 'x₂'),
    need(f.y2, 'y₂'),
    need(f.k || '0', 'asymptote'),
  ].find((c) => c !== null)
  if (first) return { spec: null, error: first }
  const p1 = { x: evalText(f.x1)!, y: evalText(f.y1)! }
  const p2 = { x: evalText(f.x2)!, y: evalText(f.y2)! }
  const k = evalText(f.k || '0')!
  let spec: ExpSpec | null = null
  try {
    spec = expFromTwoPoints(p1, p2, k)
  } catch {
    spec = null
  }
  if (!spec) return { spec: null, error: twoPointRefusal(p1, p2, k) }
  const p = expProblems(spec)
  return p.length > 0 ? { spec: null, error: p[0].message } : { spec, error: null }
}

/** Why no exponential with asymptote y = k goes through both points. */
export function twoPointRefusal(p1: Vec2, p2: Vec2, k: number): string {
  if (p1.x === p2.x) return 'The two points share an x — a function can’t go through both.'
  if (p1.y === k || p2.y === k) return `A point on the asymptote y = ${minus(numOut(k, 4))} is never reached.`
  if ((p1.y - k) * (p2.y - k) < 0) {
    return 'The points must be on the same side of the asymptote.'
  }
  if (p1.y === p2.y) return 'Two points at the same height make a constant, not an exponential.'
  return 'No exponential goes through those two points.'
}

export function specFromParams(f: ParamFields): SpecResult {
  const base = f.b.trim()
  const spec: ExpSpec =
    base === 'e'
      ? { a: f.a.trim(), b: 'e', rate: f.r.trim(), p: '1', h: f.h.trim() || '0', k: f.k.trim() || '0' }
      : { a: f.a.trim(), b: base, p: f.p.trim() || '1', h: f.h.trim() || '0', k: f.k.trim() || '0' }
  const p = expProblems(spec)
  return p.length > 0 ? { spec: null, error: p[0].message } : { spec, error: null }
}

export function specFromDraft(d: ExpDraft): SpecResult {
  if (d.carried && expProblems(d.carried).length === 0) return { spec: d.carried, error: null }
  return d.tab === 'rate'
    ? specFromRate(d.rate)
    : d.tab === 'points'
      ? specFromPoints(d.points)
      : specFromParams(d.params)
}

/** Seed the Rate tab from a spec, keeping the statement kind the teacher chose. */
export function rateFieldsFrom(spec: ExpSpec, prev: RateFields): RateFields {
  const v = expValues(spec)
  if (!v) return prev
  const kind = prev.kind
  const next: RateFields = {
    ...prev,
    init: startsAtOf(spec),
    h: spec.h || '0',
    k: spec.k || '0',
  }
  const grows = v.perUnit > 1
  switch (kind) {
    case 'factor':
      if (isBaseE(spec)) {
        next.b = baseOut(v.perUnit)
        next.per = '1'
      } else {
        next.b = spec.b
        next.per = spec.p || '1'
      }
      break
    case 'percent': {
      const per = isBaseE(spec) ? '1' : spec.p || '1'
      const beta = isBaseE(spec) ? v.perUnit : v.beta
      next.pct = pctOut(Math.abs(beta - 1) * 100, beta)
      next.grows = beta > 1
      next.per = per
      break
    }
    case 'doubling':
    case 'half-life': {
      const t = Math.abs(Math.log(2) / Math.log(v.perUnit))
      next.kind = grows ? 'doubling' : 'half-life'
      next.time = numOut(t)
      break
    }
    case 'continuous':
      next.r = isBaseE(spec) ? spec.rate ?? numOut(Math.log(v.perUnit)) : numOut(Math.log(v.perUnit))
      break
  }
  return next
}

/** Seed the Two points tab: the start (x = h) and one period later. */
export function pointFieldsFrom(spec: ExpSpec): PointFields {
  const v = expValues(spec)
  if (!v) return { x1: '0', y1: '1', x2: '1', y2: '2', k: '0' }
  const x1 = v.h
  const x2 = v.h + v.P
  return {
    x1: spec.h || '0',
    y1: numOut(expEval(spec, x1)),
    x2: numOut(x2),
    y2: numOut(expEval(spec, x2)),
    k: spec.k || '0',
  }
}

export function paramFieldsFrom(spec: ExpSpec): ParamFields {
  const v = expValues(spec)
  return {
    a: spec.a,
    b: spec.b,
    p: spec.p || '1',
    r: isBaseE(spec) ? spec.rate ?? '0' : v ? numOut(Math.log(v.perUnit)) : '0',
    h: spec.h || '0',
    k: spec.k || '0',
  }
}

/**
 * Switch tab. The curve does not change: the new tab's fields are re-seeded
 * from the spec the old tab made. A tab whose fields are broken hands on
 * nothing, and the new tab keeps what it last had.
 */
export function switchTab(d: ExpDraft, tab: ExpTab): ExpDraft {
  if (tab === d.tab) return d
  const { spec } = specFromDraft(d)
  if (!spec) return { ...d, tab }
  return {
    tab,
    rate: tab === 'rate' ? rateFieldsFrom(spec, d.rate) : d.rate,
    points: tab === 'points' ? pointFieldsFrom(spec) : d.points,
    params: tab === 'params' ? paramFieldsFrom(spec) : d.params,
    carried: spec,
  }
}

// ---------------------------------------------------------------------------
// the preview
// ---------------------------------------------------------------------------

export interface ExpPreview {
  src: string | null
  latex: string | null
  sentences: string[]
  features: string[]
  error: string | null
}

export function expPreview(spec: ExpSpec | null, error: string | null = null): ExpPreview {
  if (!spec) return { src: null, latex: null, sentences: [], features: [], error }
  const src = safeSource(spec)
  if (!src) {
    const p = expProblems(spec)
    return {
      src: null,
      latex: null,
      sentences: [],
      features: [],
      error: p[0]?.message ?? 'This exponential could not be written out.',
    }
  }
  let latex: string | null = null
  let err: string | null = null
  try {
    const o = parseExpression(src)
    if (o.ok) latex = o.plot.latex
    else err = o.error
  } catch {
    err = 'The parser crashed on this equation.'
  }
  return {
    src,
    latex,
    sentences: safeRate(spec)?.sentences ?? [],
    features: featureLines(safeFeatures(spec)),
    error: err,
  }
}

// ---------------------------------------------------------------------------
// "rate as": the same function, stated another way
// ---------------------------------------------------------------------------

/** How a rate can be stated on a card. Doubling / half-life is one choice. */
export type RateForm = 'factor' | 'percent' | 'time' | 'continuous'

export function rateFormOptions(spec: ExpSpec): { form: RateForm; label: string }[] {
  const v = expValues(spec)
  const grows = v ? v.perUnit > 1 : true
  return [
    { form: 'factor', label: 'factor per unit' },
    { form: 'percent', label: 'percent' },
    { form: 'time', label: grows ? 'doubling time' : 'half-life' },
    { form: 'continuous', label: 'continuous rate' },
  ]
}

function near(x: number, y: number): boolean {
  return Math.abs(x - y) < 1e-9 * Math.max(1, Math.abs(y))
}

/**
 * Which form the spec is written in now. The line alone cannot always tell —
 * y = 100(1.05)^x is "factor 1.05" and "grows 5%" at once — so this is the
 * best reading of the TEXT, and a card remembers what the teacher picked:
 *
 *   base e                              → continuous
 *   base "2" / "1/2" over a period ≠ 1  → doubling time / half-life (that is
 *                                          how expFromRate writes them)
 *   any other base over a period ≠ 1    → percent ("decays 50% every 5.7")
 *   per one unit                        → factor
 */
export function rateFormOf(spec: ExpSpec): RateForm {
  if (isBaseE(spec)) return 'continuous'
  const p = evalText(spec.p || '1')
  const perOne = p !== null && near(p, 1)
  const b = spec.b.replace(/\s+/g, '')
  if (!perOne && (b === '2' || b === '1/2')) return 'time'
  if (!perOne) return 'percent'
  return 'factor'
}

/**
 * The same curve written in another statement of its rate: a, h, k and the
 * function name are kept exactly as written; only the base and its period
 * (or the continuous rate) are re-derived, through expFromRate so the line
 * is written the way the core writes that statement.
 */
export function rewriteRate(spec: ExpSpec, form: RateForm): ExpSpec | null {
  const v = expValues(spec)
  if (!v || near(v.perUnit, 1)) return null
  const grows = v.perUnit > 1
  let st: RateStatement
  switch (form) {
    case 'factor':
      st = { kind: 'factor', b: baseOut(v.perUnit), per: '1' }
      break
    case 'percent': {
      // Keep the period the curve is stated over ("decays 50% every 5.7").
      const P = isBaseE(spec) ? 1 : v.P
      const beta = isBaseE(spec) ? v.perUnit : v.beta
      st = {
        kind: 'percent',
        pct: pctOut(Math.abs(beta - 1) * 100, beta),
        grows: beta > 1,
        per: numOut(P),
      }
      break
    }
    case 'time': {
      const t = Math.abs(Math.log(2) / Math.log(v.perUnit))
      st = grows ? { kind: 'doubling', time: numOut(t) } : { kind: 'half-life', time: numOut(t) }
      break
    }
    case 'continuous':
      st = { kind: 'continuous', r: numOut(Math.log(v.perUnit)) }
      break
  }
  let made: ExpSpec
  try {
    made = expFromRate('1', st, '0')
  } catch {
    return null
  }
  const out: ExpSpec = { ...spec, b: made.b, p: made.p || '1' }
  if (made.rate !== undefined) out.rate = made.rate
  else delete out.rate
  return expProblems(out).length === 0 ? out : null
}

// ---------------------------------------------------------------------------
// one committed edit on a card
// ---------------------------------------------------------------------------

export const EXP_FIELD_LABEL: Record<ExpField, string> = {
  a: 'set initial value',
  b: 'set growth factor',
  p: 'set period',
  rate: 'set continuous rate',
  h: 'set horizontal shift',
  k: 'set asymptote',
}

/** The spec with one field retyped. */
export function setExpField(spec: ExpSpec, field: ExpField, text: string): ExpSpec {
  const t = text.trim()
  if (field === 'b' && t === 'e' && !isBaseE(spec)) {
    // Switching to the natural base keeps the function: r = ln(b)/p.
    const v = expValues(spec)
    return { ...spec, b: 'e', p: '1', rate: v ? numOut(Math.log(v.perUnit)) : '1' }
  }
  if (field === 'b' && isBaseE(spec) && t !== 'e') {
    const { rate: _r, ...rest } = spec
    return { ...rest, b: t, p: '1' }
  }
  return { ...spec, [field]: t }
}

export interface ExpCommitDeps {
  restate(src: string, label: string): string | null
}

/** Apply a field edit and restate. The refusal, or null. */
export function commitExpSpec(
  spec: ExpSpec,
  next: ExpSpec | null,
  label: string,
  deps: ExpCommitDeps,
): string | null {
  if (!next) return 'That can’t be written as this exponential.'
  const p = expProblems(next)
  if (p.length > 0) return p[0].message
  const src = safeSource(next)
  if (!src) return 'This exponential could not be written out.'
  const before = safeSource(spec)
  if (src === before) return null
  return deps.restate(src, label)
}

// ---------------------------------------------------------------------------
// board handles
// ---------------------------------------------------------------------------

export type ExpHandleKind = 'k' | 'a' | 'b'

export interface ExpHandle {
  which: ExpHandleKind
  /** For 'k' only y is meaningful: the board puts it at its left edge. */
  pos: Vec2
  label: string
}

/**
 * The three things a teacher grabs: the asymptote (as a handle on y = k at
 * the board's left edge), the y-intercept, and the point one period later
 * (x = P, the p of the base, 1 for base e).
 */
export function expHandles(spec: ExpSpec): ExpHandle[] {
  const v = expValues(spec)
  if (!v) return []
  const out: ExpHandle[] = [
    { which: 'k', pos: { x: NaN, y: v.k }, label: `asymptote y = ${minus(numOut(v.k, 4))}` },
  ]
  const y0 = expEval(spec, 0)
  if (Number.isFinite(y0)) out.push({ which: 'a', pos: { x: 0, y: y0 }, label: 'y-intercept' })
  const yP = expEval(spec, v.P)
  if (Number.isFinite(yP) && !near(v.P, 0)) {
    out.push({ which: 'b', pos: { x: v.P, y: yP }, label: 'one period later' })
  }
  return out
}

/**
 * A handle dragged vertically to height y (already snapped).
 *
 *   k — the asymptote moves and a is KEPT, so the whole curve shifts up or
 *       down with it: that is what a vertical shift is (the y-intercept moves
 *       by the same amount).
 *   a — the y-intercept moves; a is re-solved, b, h and k kept.
 *   b — the point at x = P moves; the base is re-solved with a kept, so the
 *       intercept (when h = 0) stays put and the curve bends through it.
 *
 * Null when no exponential of that shape passes there (the intercept on the
 * asymptote, the second point across it).
 */
export function dragExpHandle(spec: ExpSpec, which: ExpHandleKind, y: number): ExpSpec | null {
  const v = expValues(spec)
  if (!v || !Number.isFinite(y)) return null
  switch (which) {
    case 'k':
      return { ...spec, k: numOut(y) }
    case 'a': {
      const d = y - v.k
      if (Math.abs(d) < 1e-12) return null
      const a = d / Math.pow(v.beta, (0 - v.h) / v.P)
      if (!Number.isFinite(a) || a === 0) return null
      return { ...spec, a: numOut(a) }
    }
    case 'b': {
      const ratio = (y - v.k) / v.a
      if (!(ratio > 0) || near(v.P, v.h)) return null
      const beta = Math.pow(ratio, v.P / (v.P - v.h))
      if (!Number.isFinite(beta) || beta <= 0 || near(beta, 1)) return null
      if (isBaseE(spec)) return { ...spec, rate: numOut(Math.log(beta) / v.P, 4) }
      return { ...spec, b: numOut(beta, 4) }
    }
  }
}

export const EXP_HANDLE_LABEL: Record<ExpHandleKind, string> = {
  k: 'move asymptote',
  a: 'set initial value',
  b: 'set growth factor',
}

// ---------------------------------------------------------------------------
// a SKETCHED exponential: the library family a·e^{bx} + c
// ---------------------------------------------------------------------------

export interface FittedExp {
  spec: ExpSpec
  /** The typed line "Convert to typed exponential" writes. */
  src: string
  /** "= 2.3(1.49)^x + 1 · grows 49% per unit · doubles every 1.74" */
  note: string
}

/**
 * The fitted params [a, b, c] of y = a·e^{bx} + c, stated the precalculus way:
 * a·(e^b)^x + c, four significant digits (a sketch is not measured closer).
 */
export function fittedExp(params: readonly number[]): FittedExp | null {
  const [a, b, c] = params
  if (![a, b, c].every((v) => typeof v === 'number' && Number.isFinite(v))) return null
  if (a === 0 || Math.abs(b) < 1e-6) return null
  const base = Math.exp(b)
  if (!Number.isFinite(base) || base <= 0) return null
  const spec: ExpSpec = {
    a: numOut(a, 4),
    // Four digits of RATE, not of base: 1.01392 is a 1.39% growth, and
    // rounding it to 1.014 would print a doubling time 0.6% off.
    b: numOut(base, 8, 5e-4 * Math.min(1, Math.abs(b))),
    p: '1',
    h: '0',
    k: numOut(Math.abs(c) < 1e-9 * Math.max(1, Math.abs(a)) ? 0 : c, 4),
  }
  if (expProblems(spec).length > 0) return null
  const src = safeSource(spec)
  if (!src) return null
  const rhs = src.replace(/^[^=]*=\s*/, '')
  const sentences = safeRate(spec)?.sentences ?? []
  const pick = (re: RegExp): string | undefined => sentences.find((s) => re.test(s))
  const parts = [
    `= ${rhs.replace(/-/g, '−').replace(/\*/g, '·')}`,
    pick(/%/),
    pick(/doubl|half/i),
  ].filter((s): s is string => Boolean(s))
  return { spec, src, note: parts.join(' · ') }
}

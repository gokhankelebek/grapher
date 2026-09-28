// ============================================================================
// src/ui/domainLinks.ts — domain, range, one-to-one and the inverse, as the
// CARD says them and as the teacher changes them.
//
// The mathematics lives in src/core/domainRange.ts (sets, the horizontal line
// test, where a level meets the curve) and src/core/inverse.ts (f⁻¹ as an
// equation). This file is the text between those answers and the card:
//
//   * how a restriction is WRITTEN back into a typed line — `y = x^2` becomes
//     `y = x^2 {x >= 0}` or `y = x^2 {-2 < x <= 3}`; an existing restriction is
//     replaced, the body kept; a piecewise line is not offered one at all;
//   * how a sketched curve's restriction is read into `curve.domain` (closed
//     ends only — a sketch's domain is two numbers);
//   * the "make it one-to-one" chips: a monotone stretch as the text a
//     teacher writes (x ≥ 0, −π/2 ≤ x ≤ π/2) and as the parser's spelling;
//   * which stretch f⁻¹ inverts (`inverseRestriction`) and the line "Add f⁻¹
//     as its own curve" types, restricted to f's range so the new curve's
//     domain is honest;
//   * f⁻¹'s domain and range: f's range and domain, the variable swapped;
//   * the horizontal line test's verdict and where the line starts;
//   * the reflected-point probe.
//
// Pure: no React, no DOM.
// ============================================================================

import type { FittedCurve, ModelSpec, Vec2 } from '../core/types'
import type { IntervalPart, OneToOne, RealSet } from '../core/domainRange'
import { describeSet } from '../core/domainRange'
import { piecewiseParts } from '../core/parse'
import { exactForm } from '../core/exact'
import { parseNumeric } from './numeric'

const MINUS = '−'

// ---------------------------------------------------------------------------
// numbers, in both spellings
// ---------------------------------------------------------------------------

/** A plain number for the card: up to 4 significant digits, a real minus. */
export function plainText(v: number): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : `${MINUS}∞`
  if (Math.abs(v) < 1e-12) return '0'
  const r = Number(v.toPrecision(4))
  const s = String(r)
  return s.startsWith('-') ? MINUS + s.slice(1) : s
}

/**
 * The Unicode an exact form is printed in, rewritten in the parser's own
 * spelling: "−π/2" → "-pi/2", "2√3/9" → "2sqrt(3)/9". Null when the result
 * does not read back as the same number (the caller then writes a decimal).
 */
export function parserSpelling(text: string, value: number): string | null {
  const s = text
    .replace(/−/g, '-')
    .replace(/π/g, 'pi')
    .replace(/√(\d+)/g, 'sqrt($1)')
    .replace(/√\(/g, 'sqrt(')
    .replace(/\s+/g, '')
  const back = parseNumeric(s)
  if (back === null || !Number.isFinite(back)) return null
  const tol = 1e-9 * Math.max(1, Math.abs(value))
  return Math.abs(back - value) <= tol ? s : null
}

/** A decimal the parser reads back: at most 12 significant digits, no exponent. */
function decimalSpelling(v: number): string {
  if (Math.abs(v) < 1e-12) return '0'
  const r = Number(v.toPrecision(12))
  const s = Math.abs(r) >= 1e-6 && Math.abs(r) < 1e15 ? String(r) : r.toFixed(12)
  return s
}

/** One end, for the card (Unicode) and for the line (the parser's spelling). */
export interface EndText {
  show: string
  line: string
}

/** How one finite end of a stretch is written. */
export function endText(v: number, exact: { text: string } | null | undefined): EndText {
  const form = exact ?? (Number.isFinite(v) ? exactForm(v) : null)
  if (form) {
    const line = parserSpelling(form.text, v)
    if (line !== null) return { show: form.text, line }
  }
  return { show: plainText(v), line: decimalSpelling(v) }
}

// ---------------------------------------------------------------------------
// a stretch of x, as a teacher writes it
// ---------------------------------------------------------------------------

/**
 * "x ≥ 0", "x < 3", "−π/2 ≤ x ≤ π/2", "all real numbers" — set-builder for
 * one interval, in `v`. Used for the chips (always one interval) and as the
 * fallback when the core has no words for a set.
 */
export function partBuilder(p: IntervalPart, v = 'x'): string {
  const loF = Number.isFinite(p.lo)
  const hiF = Number.isFinite(p.hi)
  const lo = loF ? endText(p.lo, p.loExact).show : ''
  const hi = hiF ? endText(p.hi, p.hiExact).show : ''
  if (loF && hiF) {
    if (p.lo === p.hi) return `${v} = ${lo}`
    return `${lo} ${p.loClosed ? '≤' : '<'} ${v} ${p.hiClosed ? '≤' : '<'} ${hi}`
  }
  if (loF) return `${v} ${p.loClosed ? '≥' : '>'} ${lo}`
  if (hiF) return `${v} ${p.hiClosed ? '≤' : '<'} ${hi}`
  return 'all real numbers'
}

/** "[0, ∞)", "(−π/2, π/2]" — interval notation for one stretch. */
export function partInterval(p: IntervalPart): string {
  const lo = Number.isFinite(p.lo) ? endText(p.lo, p.loExact).show : `${MINUS}∞`
  const hi = Number.isFinite(p.hi) ? endText(p.hi, p.hiExact).show : '∞'
  const l = Number.isFinite(p.lo) && p.loClosed ? '[' : '('
  const r = Number.isFinite(p.hi) && p.hiClosed ? ']' : ')'
  return `${l}${lo}, ${hi}${r}`
}

/**
 * A set's two spellings for a given variable — the core's describeSet when it
 * answers, else interval notation joined with ∪ and set-builder joined with
 * "or" (the core's words are the better ones; these only keep a card honest).
 */
export function describeParts(
  parts: readonly IntervalPart[],
  v: string,
): { text: string; builder: string; tex: string; builderTex: string } {
  let d: ReturnType<typeof describeSet> | null = null
  try {
    d = describeSet(parts, v)
  } catch {
    d = null
  }
  if (d && d.text) return d
  if (parts.length === 0) return { text: '∅', builder: 'no real numbers', tex: '\\varnothing', builderTex: '' }
  const text = parts.map(partInterval).join(' ∪ ')
  const builder = parts.map((p) => partBuilder(p, v)).join(' or ')
  return { text, builder, tex: '', builderTex: '' }
}

/** A set, restated in another variable (f's range is f⁻¹'s domain, in x). */
export function inVariable(set: RealSet | null, v: string): RealSet | null {
  if (!set) return null
  if (set.kind !== 'intervals') return set
  const d = describeParts(set.parts, v)
  return { ...set, text: d.text, tex: d.tex, builder: d.builder, builderTex: d.builderTex }
}

/** One row's text: interval notation, or set-builder when the teacher asked for it. */
export function setRowText(set: RealSet | null, form: SetNotation): string | null {
  if (!set || set.kind === 'unknown') return null
  const t = form === 'builder' ? set.builder || set.text : set.text || set.builder
  return t || null
}

/** How the Domain / Range rows are written: a global preference. */
export type SetNotation = 'interval' | 'builder'

/** Is this ONE interval, and not the whole line? */
export function singleProperInterval(set: RealSet | null): IntervalPart | null {
  if (!set || set.kind !== 'intervals' || set.parts.length !== 1) return null
  const p = set.parts[0]
  if (!Number.isFinite(p.lo) && !Number.isFinite(p.hi)) return null
  return p
}

const sameEnd = (a: number, b: number): boolean =>
  a === b || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)))

/** Do two sets name the same numbers (end by end, closedness included)? */
export function sameSet(a: RealSet | null, b: RealSet | null): boolean {
  if (!a || !b) return false
  if (a.kind !== b.kind) return false
  if (a.kind !== 'intervals') return a.text === b.text
  if (a.parts.length !== b.parts.length) return false
  return a.parts.every((p, i) => {
    const q = b.parts[i]
    return (
      sameEnd(p.lo, q.lo) &&
      sameEnd(p.hi, q.hi) &&
      (p.loClosed === q.loClosed || !Number.isFinite(p.lo)) &&
      (p.hiClosed === q.hiClosed || !Number.isFinite(p.hi))
    )
  })
}

/**
 * The stretch f⁻¹ inverts: f's curve domain when that is ONE interval the
 * teacher chose (it differs from the natural domain); null when f lives on
 * its whole natural domain, which is invertFormula's "no restriction".
 */
export function inverseRestriction(domain: RealSet | null, natural: RealSet | null): IntervalPart | null {
  const one = domain && domain.kind === 'intervals' && domain.parts.length === 1 ? domain.parts[0] : null
  if (!one) return null
  if (natural && sameSet(domain, natural)) return null
  if (!Number.isFinite(one.lo) && !Number.isFinite(one.hi)) return null
  return one
}

// ---------------------------------------------------------------------------
// restrictions, written into a typed line
// ---------------------------------------------------------------------------

/** One bound as the editor holds it: the typed text ('' = unbounded) and [ vs (. */
export interface BoundDraft {
  text: string
  closed: boolean
}

export interface RestrictDraft {
  lo: BoundDraft
  hi: BoundDraft
}

/** A restriction ready to apply: finite ends in both spellings, or null for ±∞. */
export interface Restriction {
  lo: { value: number; line: string; closed: boolean } | null
  hi: { value: number; line: string; closed: boolean } | null
}

/** A typed line, split into what it computes and what it is restricted to. */
export interface TypedSplit {
  /** the line without its restriction: "y = x^2" */
  base: string
  /** the restriction as typed ("0 <= x < 3"), or null */
  cond: string | null
}

/**
 * Where a typed line's restriction is, or why it has none to replace:
 * 'piecewise' for a line of several branches (restricting one of them would
 * change a different function). Null for an empty line.
 */
export function splitTyped(src: string | undefined): TypedSplit | 'piecewise' | null {
  const text = (src ?? '').trim()
  if (text === '') return null
  const parts = piecewiseParts(text)
  if (!parts) return { base: text, cond: null }
  if (!parts.restricted || parts.branches.length !== 1) return 'piecewise'
  const b = parts.branches[0]
  const base = parts.head ? `${parts.head} = ${b.expr}` : b.expr
  return { base, cond: b.cond || null }
}

/** The condition text a restriction is written as, in the parser's spelling. */
export function conditionText(r: Restriction, v = 'x'): string | null {
  const { lo, hi } = r
  if (lo && hi) return `${lo.line} ${lo.closed ? '<=' : '<'} ${v} ${hi.closed ? '<=' : '<'} ${hi.line}`
  if (lo) return `${v} ${lo.closed ? '>=' : '>'} ${lo.line}`
  if (hi) return `${v} ${hi.closed ? '<=' : '<'} ${hi.line}`
  return null
}

/**
 * The typed line with `r` as its restriction: the body kept, any existing
 * restriction replaced; `r` with no finite end clears it. Null for a line
 * that cannot take one (a piecewise).
 */
export function restrictedLine(src: string, r: Restriction, v = 'x'): string | null {
  const split = splitTyped(src)
  if (split === null || split === 'piecewise') return null
  const cond = conditionText(r, v)
  return cond === null ? split.base : `${split.base} {${cond}}`
}

/** Unicode a teacher may paste into a bound, read the way the parser reads it. */
function asciiBound(text: string): string {
  return text
    .trim()
    .replace(/−/g, '-')
    .replace(/π/g, 'pi')
    .replace(/√(\d+)/g, 'sqrt($1)')
    .replace(/√\(/g, 'sqrt(')
    .replace(/∞/g, 'inf')
}

/** Is this bound text "no bound" — blank, ∞ or −∞? */
function unbounded(text: string): boolean {
  const t = asciiBound(text).toLowerCase()
  return t === '' || t === 'inf' || t === '-inf' || t === '+inf' || t === 'infinity' || t === '-infinity'
}

/**
 * Read the editor's two bounds. Every finite bound must be a constant the
 * parser reads (`-pi/2`, `sqrt(2)`, `1/3`); lo < hi; a single point is not a
 * domain anyone restricts to. Returns the restriction or the sentence to show.
 */
export function readRestriction(d: RestrictDraft): { ok: true; r: Restriction } | { ok: false; error: string; which?: 'lo' | 'hi' } {
  const read = (b: BoundDraft, which: 'lo' | 'hi') => {
    if (unbounded(b.text)) return { ok: true as const, end: null }
    const line = asciiBound(b.text)
    const v = parseNumeric(line)
    if (v === null || !Number.isFinite(v)) {
      return { ok: false as const, error: `“${b.text.trim()}” isn’t a number — try -2, 1/3, pi/2 or sqrt(2)`, which }
    }
    return { ok: true as const, end: { value: v, line, closed: b.closed } }
  }
  const lo = read(d.lo, 'lo')
  if (!lo.ok) return lo
  const hi = read(d.hi, 'hi')
  if (!hi.ok) return hi
  if (lo.end && hi.end && !(lo.end.value < hi.end.value)) {
    return { ok: false, error: 'The left end has to be less than the right end.', which: 'hi' }
  }
  return { ok: true, r: { lo: lo.end, hi: hi.end } }
}

/** A stretch (a chip, f's range) as a restriction, each finite end in the parser's spelling. */
export function partRestriction(p: IntervalPart): Restriction {
  return {
    lo: Number.isFinite(p.lo) ? { value: p.lo, line: endText(p.lo, p.loExact).line, closed: p.loClosed } : null,
    hi: Number.isFinite(p.hi) ? { value: p.hi, line: endText(p.hi, p.hiExact).line, closed: p.hiClosed } : null,
  }
}

/** The editor, prefilled from a stretch (or blank for none). */
export function draftOf(p: IntervalPart | null): RestrictDraft {
  if (!p) return { lo: { text: '', closed: true }, hi: { text: '', closed: true } }
  const r = partRestriction(p)
  return {
    lo: { text: r.lo ? r.lo.line : '', closed: r.lo ? r.lo.closed : true },
    hi: { text: r.hi ? r.hi.line : '', closed: r.hi ? r.hi.closed : true },
  }
}

/**
 * A sketched curve's domain from a restriction: two finite numbers. An
 * unbounded side keeps where the sketch ends now, or — for a sketch that
 * runs across the whole board — the edge of the window.
 */
export function sketchDomain(
  r: Restriction,
  current: [number, number] | null,
  window: [number, number],
): [number, number] | null {
  const lo = r.lo ? r.lo.value : current ? Math.min(current[0], current[1]) : window[0]
  const hi = r.hi ? r.hi.value : current ? Math.max(current[0], current[1]) : window[1]
  if (!(Number.isFinite(lo) && Number.isFinite(hi) && hi > lo)) return null
  return [lo, hi]
}

// ---------------------------------------------------------------------------
// one-to-one
// ---------------------------------------------------------------------------

/** One "make it one-to-one" chip. */
export interface OneToOneChip {
  /** "x ≥ 0", "−π/2 ≤ x ≤ π/2" */
  label: string
  part: IntervalPart
}

/** At most this many chips — the widest stretches, as the core ranks them. */
export const MAX_CHIPS = 4

/** The chips for a function that is not one-to-one; none for one that is. */
export function oneToOneChips(info: OneToOne | null): OneToOneChip[] {
  if (!info || info.oneToOne) return []
  const out: OneToOneChip[] = []
  const seen = new Set<string>()
  for (const p of info.monotone) {
    if (!p || !(p.hi > p.lo)) continue
    const label = partBuilder(p, 'x')
    if (seen.has(label) || label === 'all real numbers') continue
    seen.add(label)
    out.push({ label, part: p })
    if (out.length >= MAX_CHIPS) break
  }
  return out
}

/** At most this many of the witness's x's are listed. */
export const MAX_WITNESS_XS = 3

/** "Yes" / "No — fails at y = 1 (x = −1, 1)". */
export function oneToOneText(info: OneToOne | null): string | null {
  if (!info) return null
  if (info.oneToOne) return 'Yes'
  const w = info.witness
  if (!w || !Number.isFinite(w.y)) return 'No'
  const y = w.exactY ? w.exactY.text : plainText(w.y)
  // A periodic function meets its witness line over and over: three of them
  // make the point, and the rest is "…".
  const all = w.xs.filter(Number.isFinite)
  const xs = all.slice(0, MAX_WITNESS_XS).map((x) => endText(x, null).show)
  if (all.length > MAX_WITNESS_XS) xs.push('…')
  return xs.length > 0 ? `No — fails at y = ${y} (x = ${xs.join(', ')})` : `No — fails at y = ${y}`
}

// ---------------------------------------------------------------------------
// the horizontal line test on the board
// ---------------------------------------------------------------------------

/** The line's colour when it meets f at two or more points (screen). */
export const HLT_FAIL_COLOR = '#ff7a45'
/** And when it meets f once or not at all. */
export const HLT_PASS_COLOR = '#3ecf8e'

export interface HltVerdict {
  count: number
  fails: boolean
  /** "2 points — not one-to-one", "1 point", "no points" */
  chip: string
  color: string
}

export function hltVerdict(xs: readonly number[]): HltVerdict {
  const count = xs.length
  const fails = count >= 2
  const chip = fails
    ? `${count} points — not one-to-one`
    : count === 1
      ? '1 point'
      : 'no points'
  return { count, fails, chip, color: fails ? HLT_FAIL_COLOR : HLT_PASS_COLOR }
}

/**
 * Where the line starts when the switch goes on: the core's witness (a
 * height that fails, so the class SEES it fail), else f(0), else the middle
 * of the view.
 */
export function hltStart(info: OneToOne | null, f0: number, viewMidY: number): number {
  if (info && !info.oneToOne && info.witness && Number.isFinite(info.witness.y)) return info.witness.y
  if (Number.isFinite(f0)) return f0
  return Number.isFinite(viewMidY) ? viewMidY : 0
}

// ---------------------------------------------------------------------------
// f, as a function of x, for the board's probes
// ---------------------------------------------------------------------------

/** y = f(x) with the curve's params and its own domain; NaN outside. */
export function explicitF(curve: FittedCurve, models: Record<string, ModelSpec>): ((x: number) => number) | null {
  if (curve.kind !== 'explicit') return null
  const spec = models[curve.modelId]
  const ev = spec?.evalExplicit
  if (!ev) return null
  const d = curve.domain
  const lo = d ? Math.min(d[0], d[1]) : -Infinity
  const hi = d ? Math.max(d[0], d[1]) : Infinity
  return (x: number): number => {
    if (x < lo || x > hi) return Number.NaN
    try {
      const v = ev.call(spec, curve.params, x)
      return typeof v === 'number' ? v : Number.NaN
    } catch {
      return Number.NaN
    }
  }
}

/** The family itself, EVERYWHERE — a sketch's ghost beyond its own ends. */
export function familyF(curve: FittedCurve, models: Record<string, ModelSpec>): ((x: number) => number) | null {
  if (curve.kind !== 'explicit') return null
  return explicitF({ ...curve, domain: null }, models)
}

/**
 * The reflected-point probe: (a, f(a)) on f, its image (f(a), a) on f⁻¹,
 * and the segment between them — perpendicular to y = x by construction,
 * since it joins a point to its mirror image. Null where f(a) is undefined.
 */
export function reflectProbe(f: (x: number) => number, a: number): { p: Vec2; q: Vec2 } | null {
  if (!Number.isFinite(a)) return null
  const y = f(a)
  if (!Number.isFinite(y)) return null
  return { p: { x: a, y }, q: { x: y, y: a } }
}

/**
 * Keep a dragged probe on f: the nearest x in [lo, hi] where f is defined,
 * searching outward from the pointer's x a little way.
 */
export function probeX(f: (x: number) => number, x: number, step: number): number {
  if (Number.isFinite(f(x))) return x
  const h = Math.abs(step) > 0 ? Math.abs(step) : 0.01
  for (let k = 1; k <= 400; k++) {
    if (Number.isFinite(f(x + k * h))) return x + k * h
    if (Number.isFinite(f(x - k * h))) return x - k * h
  }
  return x
}

// ---------------------------------------------------------------------------
// f⁻¹ as its own curve
// ---------------------------------------------------------------------------

/**
 * The line "Add f⁻¹(x) as its own curve" types: the inverse's `source`,
 * restricted to f's range when that range is one interval and not all of ℝ —
 * `y = x^2 + 2 {x >= 0}` for √(x − 2) — so the new curve's domain is exactly
 * the inverse function's domain, not whatever its formula happens to accept.
 */
export function inverseCurveLine(source: string, fRange: RealSet | null): string {
  const p = singleProperInterval(fRange)
  if (!p) return source
  return restrictedLine(source, partRestriction(p)) ?? source
}

// ---------------------------------------------------------------------------
// what the card is handed
// ---------------------------------------------------------------------------

/** How the card may restrict this curve's domain. */
export type RestrictMode =
  | { kind: 'typed'; cond: string | null }
  | { kind: 'sketch'; domain: [number, number] | null }
  | { kind: 'none'; why: string }

/** Why a row reads "—". */
export const WHY_NO_DOMAIN =
  'The domain couldn’t be read for this curve — its formula is not one the analysis can scan.'
export const WHY_NO_RANGE =
  'The range couldn’t be read honestly — the curve does not settle down enough to say which values it takes.'
export const WHY_NO_ONE_TO_ONE = 'Whether this curve passes the horizontal line test couldn’t be decided.'
export const WHY_PIECEWISE =
  'A piecewise function is restricted by its pieces — edit the conditions in its Piecewise section.'
export const WHY_SKETCH_OPEN =
  'A sketched curve’s domain is where the sketch starts and stops, so both ends are included. Type the equation to leave an end out.'

/** The inverse, as f's card and f⁻¹'s card say it. */
export interface InversePanel {
  /** f⁻¹(x) = …, when there is a formula */
  latex: string | null
  text: string | null
  /** "the branch x ≥ 1" / "principal branch" */
  branch: string | null
  /** why there is no formula (then the reflection is all there is) */
  why: string | null
  /** the line "Add f⁻¹(x) as its own curve" types; null = no formula to type */
  addLine: string | null
  /** an inverse of f is on the board (linked reflection) */
  shown: boolean
}

/** Everything the Domain rows and their tools show for the selected card. */
export interface DomainPanel {
  /** 'function': f's own card. 'inverse': the card of f's reflection, f⁻¹. */
  role: 'function' | 'inverse'
  /** The curve the actions act on: f itself (also for f⁻¹'s card). */
  ownerId: string
  /** "f" or "f⁻¹" — the head of the rows. */
  name: string
  domain: RealSet | null
  range: RealSet | null
  /** function role only */
  oneToOne: OneToOne | null
  restrict: RestrictMode
  /** What the editor opens prefilled with: the current restriction, if one. */
  current: IntervalPart | null
  /** A restriction is in force (the ghost has something to show). */
  restricted: boolean
  chips: OneToOneChip[]
  ghost: boolean
  hlt: { y: number; verdict: HltVerdict } | null
  reflect: boolean
  inverse: InversePanel | null
}

/** What the rows can do. Every id is the panel's `ownerId`. */
export interface DomainActions {
  /** Apply a restriction (null clears it). The error to show, or null. */
  onRestrict(id: string, r: Restriction | null): string | null
  onGhost(id: string, on: boolean): void
  onHlt(id: string, on: boolean): void
  onReflect(id: string, on: boolean): void
  onShowInverse(id: string): void
  onAddInverse(id: string): void
  onNotation(n: SetNotation): void
}

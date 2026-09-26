// ============================================================================
// src/ui/sinLinks.ts — a sinusoid, edited the way it is STATED.
//
//     y = a·sin(b(x − h)) + k        or        y = a·cos(b(x − h)) + k
//
// src/core/sinusoidal.ts is the bridge between a typed line and the numbers a
// precalculus class states — amplitude, period, phase shift, midline — and it
// writes the line. Everything here sits on top of that bridge and is pure (no
// React, no DOM, no App state), mirroring expLinks.ts and logLinks.ts:
//
//   * the three tabs of "Build ▾ → Sinusoidal" — Parts, Extrema, Parameters —
//     as field sets that each turn into ONE SinSpec, re-seeded from that spec
//     on a tab switch so switching tabs never moves the curve;
//   * the Parameters tab's two ways to state b: b itself, or the period P
//     (b = 2π/P) — editing either rewrites the other;
//   * the card's "write as": the same function with the other of sin/cos, or
//     with a positive amplitude;
//   * one committed field edit on a card's Sinusoidal section;
//   * what the board shows while it is selected — the five key points of the
//     cycle that starts at x = h (as analysis marks, exact text on the chip),
//     the dashed midline — and the three handles: the midline (k), the first
//     maximum (amplitude, and phase shift sideways) and the end of the first
//     cycle (period);
//   * the note a SKETCHED curve that fitted the library's a·sin(bx + c) + d
//     wears, and the line "Convert to typed sinusoid" replaces it with.
//
// Every result is an ordinary typed curve. Nothing downstream knows.
// ============================================================================

import type { Polyline, SpecialPoint, Vec2 } from '../core/types'
import {
  readSinusoid,
  rewriteAs,
  sinFeatures,
  sinFromExtrema,
  sinFromParts,
  sinSource,
} from '../core/sinusoidal'
import type { SinFeatures, SinFn, SinSpec, SinStart } from '../core/sinusoidal'
import { parseExpression } from '../core/parse'
import { evalText } from './factorLinks'
import { minus, numOut } from './expLinks'

// ---------------------------------------------------------------------------
// numbers
// ---------------------------------------------------------------------------

export interface SinValues {
  a: number
  b: number
  h: number
  k: number
}

/** Every field evaluated, or null while one does not (or b is 0). */
export function sinValues(spec: SinSpec): SinValues | null {
  const a = evalText(spec.a || '1')
  const b = evalText(spec.b || '1')
  const h = evalText(spec.h || '0')
  const k = evalText(spec.k || '0')
  if (a === null || b === null || h === null || k === null) return null
  if (b === 0) return null
  return { a, b, h, k }
}

/** f(x) for a spec. */
export function sinEval(spec: SinSpec, x: number): number {
  const v = sinValues(spec)
  if (!v) return NaN
  const u = v.b * (x - v.h)
  return v.a * (spec.fn === 'cos' ? Math.cos(u) : Math.sin(u)) + v.k
}

/** The period 2π/|b|, or NaN. */
export function periodOf(spec: SinSpec): number {
  const v = sinValues(spec)
  return v ? (2 * Math.PI) / Math.abs(v.b) : NaN
}

/** gcd of two positive integers. */
function gcd(a: number, b: number): number {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b) {
    const t = a % b
    a = b
    b = t
  }
  return a
}

/** v = p/q with q ≤ maxDen, when it IS one (to a hair), else null. */
function smallRatio(v: number, maxDen: number): [number, number] | null {
  if (!Number.isFinite(v)) return null
  for (let q = 1; q <= maxDen; q++) {
    const p = Math.round(v * q)
    if (Math.abs(p / q - v) <= 1e-9 * Math.max(1, Math.abs(v))) {
      const g = gcd(p, q) || 1
      return [p / g, q / g]
    }
  }
  return null
}

/** (p/q)·π as source: pi, -pi, 2pi, pi/4, 3pi/4, -3pi/2. */
export function piSource(p: number, q: number): string {
  if (p === 0) return '0'
  const sign = p < 0 ? '-' : ''
  const n = Math.abs(p)
  const top = n === 1 ? 'pi' : `${n}pi`
  return q === 1 ? `${sign}${top}` : `${sign}${top}/${q}`
}

/**
 * A computed x-coordinate (a phase shift, a period, a key point) as source,
 * exact whenever the number IS something a class writes:
 *   a multiple of π        "pi/4", "3pi/2"
 *   a short decimal        "1.5", "12", "0.45"
 *   a number plus π's      "1 + 3pi", "0.5 + pi/2"
 * and otherwise 12 significant digits — never a rounding that would move a
 * curve when the text is read back.
 */
export function xSource(v: number): string {
  if (!Number.isFinite(v)) return '0'
  if (Math.abs(v) < 1e-12) return '0'
  const near = (t: string): boolean => {
    const back = evalText(t)
    return back !== null && Math.abs(back - v) <= 1e-9 * Math.max(1, Math.abs(v))
  }
  const r = smallRatio(v / Math.PI, 24)
  if (r && Math.abs(r[0]) <= 96) return piSource(r[0], r[1])
  const plain = numOut(v, 6)
  if (near(plain)) return plain
  for (let q = 1; q <= 12; q++) {
    for (let p = 1; p <= 8 * q; p++) {
      if (gcd(p, q) !== 1) continue
      for (const sp of [p, -p]) {
        const rest = smallRatio(v - (sp * Math.PI) / q, 12)
        if (!rest || rest[0] === 0) continue
        const rText = numOut(rest[0] / rest[1], 6)
        const t = `${rText} ${sp < 0 ? '-' : '+'} ${piSource(Math.abs(sp), q)}`
        if (near(t)) return t
      }
    }
  }
  return String(Number(v.toPrecision(12)))
}

/** Source text as a class writes it: pi → π, - → −, sqrt(2) → √2. */
export function prettyText(src: string): string {
  return src
    .replace(/sqrt\(([^()]+)\)/g, '√$1')
    .replace(/\bpi\b/g, 'π')
    .replace(/(\d)\s*π/g, '$1π')
    .replace(/-/g, '−')
}

/**
 * A key point's exact text back into source the fields can hold: "3π/4" →
 * "3pi/4", "−2" → "-2", "√2" → "sqrt(2)". Checked by evaluating it back; a
 * text that does not come back as `v` gives the plain number instead.
 */
export function sourceOfText(text: string, v: number): string {
  const s = text
    .replace(/−/g, '-')
    .replace(/√(\d+(?:\.\d+)?)/g, 'sqrt($1)')
    .replace(/(\d)π/g, '$1pi')
    .replace(/π/g, 'pi')
    .trim()
  const back = s === '' ? null : evalText(s)
  if (back !== null && Math.abs(back - v) <= 1e-9 * Math.max(1, Math.abs(v))) return s
  return xSource(v)
}

/**
 * b = 2π/P for a period stated as a number, written the way a class would:
 *   P a rational multiple of π → b a fraction    (P = π → 2, 4π/3 → 3/2)
 *   P a simple fraction        → b a π multiple  (P = 12 → pi/6, 3 → 2pi/3)
 *   otherwise                  → six significant digits (P = 5.236 → 1.2)
 * Null when P is not a positive number.
 */
export function bForPeriod(P: number): string | null {
  if (!Number.isFinite(P) || !(P > 0)) return null
  const t = smallRatio(P / Math.PI, 24)
  if (t && t[0] > 0) {
    const g = gcd(2 * t[1], t[0]) || 1
    const n = (2 * t[1]) / g
    const d = t[0] / g
    return d === 1 ? String(n) : `${n}/${d}`
  }
  const r = smallRatio(P, 12)
  if (r && r[0] > 0) {
    // 2/P = 2q/p
    const g = gcd(2 * r[1], r[0]) || 1
    return piSource((2 * r[1]) / g, r[0] / g)
  }
  return numOut((2 * Math.PI) / P, 6)
}

/**
 * The period as a field holds it, for b as written: b = 2 → "pi", b = pi/6 →
 * "12", and when the period is neither a π multiple nor a simple number, the
 * exact quotient a class writes down, b = 1.2 → "2pi/1.2" — never a rounded
 * 5.23599 that would move the curve when it is read back.
 */
export function periodForB(bText: string): string {
  const b = evalText(bText)
  if (b === null || b === 0) return ''
  const P = (2 * Math.PI) / Math.abs(b)
  if (smallRatio(P / Math.PI, 24) || smallRatio(P, 12)) return xSource(P)
  const t = bText.trim().replace(/^-\s*/, '')
  if (/^\d+(?:\.\d+)?$/.test(t)) return `2pi/${t}`
  return numOut(P, 6)
}

/** The period field's text for a spec: b = 2 → "pi", b = pi/6 → "12". */
export function periodSource(spec: SinSpec): string {
  return periodForB(spec.b || '1')
}

/** A negated text: "2" → "-2", "-pi/6" → "pi/6", "1+x" → "-(1+x)". */
function negSource(t: string): string {
  const s = t.trim()
  if (s.startsWith('-')) {
    const rest = s.slice(1).trim()
    if (!/[-+]/.test(rest)) return rest
  }
  return /^[\w.()/]+$/.test(s) && !/[-+]/.test(s) ? `-${s}` : `-(${s})`
}

/** |a| as text, keeping the teacher's own writing where it can. */
function absSource(t: string): string {
  const s = t.trim()
  const v = evalText(s)
  if (v === null) return s
  if (v >= 0) return s
  if (s.startsWith('-')) {
    const rest = s.slice(1).trim()
    const back = evalText(rest)
    if (back !== null && Math.abs(back + v) <= 1e-12 * Math.max(1, Math.abs(v))) return rest
  }
  return numOut(-v, 6)
}

// ---------------------------------------------------------------------------
// what is wrong
// ---------------------------------------------------------------------------

export type SinField = 'a' | 'b' | 'h' | 'k'

export interface SinProblem {
  field: SinField
  message: string
}

/** Every field that stops the spec being a sinusoid. Empty = buildable. */
export function sinProblems(spec: SinSpec): SinProblem[] {
  const out: SinProblem[] = []
  const num = (field: SinField, text: string | undefined, what: string): number | null => {
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
  const a = num('a', spec.a, 'amplitude a')
  if (a === 0) out.push({ field: 'a', message: 'a can’t be 0 — that is the line y = k.' })
  const b = num('b', spec.b, 'frequency b')
  if (b === 0) out.push({ field: 'b', message: 'b can’t be 0 — there would be no period.' })
  num('h', spec.h || '0', 'phase shift h')
  num('k', spec.k || '0', 'midline k')
  return out
}

// ---------------------------------------------------------------------------
// the core, never throwing
// ---------------------------------------------------------------------------

export function safeReadSinusoid(src: string | undefined): SinSpec | null {
  if (!src || !src.trim()) return null
  try {
    const s = readSinusoid(src)
    return s && sinProblems(s).length === 0 ? s : null
  } catch {
    return null
  }
}

export function safeSinSource(spec: SinSpec): string | null {
  if (sinProblems(spec).length > 0) return null
  try {
    return sinSource(spec)
  } catch {
    return null
  }
}

export function safeSinFeatures(spec: SinSpec): SinFeatures | null {
  if (sinProblems(spec).length > 0) return null
  try {
    return sinFeatures(spec)
  } catch {
    return null
  }
}

/** "period π" out of the core's sentences, else the number. */
export function periodText(spec: SinSpec, f: SinFeatures | null = safeSinFeatures(spec)): string {
  const s = f?.sentences.find((t) => t.startsWith('period '))
  if (s) return s.slice('period '.length)
  const P = periodOf(spec)
  return Number.isFinite(P) ? prettyText(xSource(P)) : '—'
}

/** One row of the key-point table. */
export interface KeyRow {
  x: string
  y: string
  kind: 'max' | 'min' | 'mid'
}

export function keyRows(f: SinFeatures | null): KeyRow[] {
  if (!f) return []
  return f.keyPoints.map((p) => ({ x: p.xText, y: p.yText, kind: p.kind }))
}

export const KIND_WORD: Record<KeyRow['kind'], string> = {
  max: 'max',
  min: 'min',
  mid: 'midline',
}

// ---------------------------------------------------------------------------
// the three tabs
// ---------------------------------------------------------------------------

export type SinTab = 'parts' | 'extrema' | 'params'

export const START_CHOICES: { start: SinStart; label: string }[] = [
  { start: 'max', label: 'a maximum' },
  { start: 'min', label: 'a minimum' },
  { start: 'mid-up', label: 'the midline, going up' },
  { start: 'mid-down', label: 'the midline, going down' },
]

/** Which function and sign a start chooses, as sinFromParts does. */
export function startChoice(start: SinStart): string {
  switch (start) {
    case 'max':
      return 'cos with a > 0'
    case 'min':
      return 'cos with a < 0'
    case 'mid-up':
      return 'sin with a > 0'
    case 'mid-down':
      return 'sin with a < 0'
  }
}

export interface SinPartFields {
  amplitude: string
  period: string
  /** Phase shift: where the cycle starts. */
  phase: string
  midline: string
  start: SinStart
}

export interface SinExtremaFields {
  maxX: string
  maxY: string
  minX: string
  minY: string
}

export interface SinParamFields {
  fn: SinFn
  a: string
  b: string
  /** The period P, kept in step with b (b = 2π/P). */
  period: string
  h: string
  k: string
}

export interface SinDraft {
  tab: SinTab
  parts: SinPartFields
  extrema: SinExtremaFields
  params: SinParamFields
  /**
   * The function carried over by a tab switch, EXACTLY as it was, until a
   * field on the new tab is edited (see ExpDraft.carried).
   */
  carried?: SinSpec | null
}

/** y = sin(x): the sinusoid a class meets first. */
export const DEFAULT_SIN: SinSpec = { fn: 'sin', a: '1', b: '1', h: '0', k: '0' }

export function blankSinDraft(): SinDraft {
  return {
    tab: 'parts',
    parts: partFieldsFrom(DEFAULT_SIN),
    extrema: extremaFieldsFrom(DEFAULT_SIN),
    params: paramFieldsFrom(DEFAULT_SIN),
  }
}

export interface SinSpecResult {
  spec: SinSpec | null
  error: string | null
}

function need(text: string, what: string): string | null {
  const t = text.trim()
  if (t === '') return `The ${what} is empty.`
  if (evalText(t) === null) return `The ${what} “${t}” is not a number.`
  return null
}

function checked(spec: SinSpec): SinSpecResult {
  const p = sinProblems(spec)
  return p.length > 0 ? { spec: null, error: p[0].message } : { spec, error: null }
}

export function sinSpecFromParts(f: SinPartFields): SinSpecResult {
  const first = [
    need(f.amplitude, 'amplitude'),
    need(f.period, 'period'),
    need(f.phase || '0', 'phase shift'),
    need(f.midline || '0', 'midline'),
  ].find((c) => c !== null)
  if (first) return { spec: null, error: first }
  const amp = evalText(f.amplitude)!
  const P = evalText(f.period)!
  if (amp === 0) return { spec: null, error: 'An amplitude of 0 is the line y = k, not a wave.' }
  if (amp < 0) return { spec: null, error: 'The amplitude is a distance — it must be positive.' }
  if (P <= 0) return { spec: null, error: 'The period is a length of time — it must be positive.' }
  let spec: SinSpec
  try {
    spec = sinFromParts({
      amplitude: f.amplitude.trim(),
      period: f.period.trim(),
      phase: f.phase.trim() || '0',
      midline: f.midline.trim() || '0',
      start: f.start,
    })
  } catch {
    return { spec: null, error: 'Those parts could not be made into a sinusoid.' }
  }
  return checked(spec)
}

/** Why no sinusoid has these as an adjacent maximum and minimum. */
export function extremaRefusal(max: Vec2, min: Vec2): string {
  if (max.x === min.x) return 'The maximum and the minimum share an x — they can’t be adjacent.'
  if (max.y === min.y) return 'The maximum and the minimum are at the same height — that is a line.'
  if (max.y < min.y) return 'The maximum has to be higher than the minimum.'
  return 'No sinusoid has those two points as a maximum and the next minimum.'
}

export function sinSpecFromExtrema(f: SinExtremaFields): SinSpecResult {
  const first = [
    need(f.maxX, 'maximum’s x'),
    need(f.maxY, 'maximum’s y'),
    need(f.minX, 'minimum’s x'),
    need(f.minY, 'minimum’s y'),
  ].find((c) => c !== null)
  if (first) return { spec: null, error: first }
  const max = { x: evalText(f.maxX)!, y: evalText(f.maxY)! }
  const min = { x: evalText(f.minX)!, y: evalText(f.minY)! }
  let spec: SinSpec | null = null
  try {
    spec = sinFromExtrema(max, min)
  } catch {
    spec = null
  }
  if (!spec) return { spec: null, error: extremaRefusal(max, min) }
  return checked(spec)
}

export function sinSpecFromParams(f: SinParamFields): SinSpecResult {
  return checked({
    fn: f.fn,
    a: f.a.trim(),
    b: f.b.trim(),
    h: f.h.trim() || '0',
    k: f.k.trim() || '0',
  })
}

export function sinSpecFromDraft(d: SinDraft): SinSpecResult {
  if (d.carried && sinProblems(d.carried).length === 0) return { spec: d.carried, error: null }
  return d.tab === 'parts'
    ? sinSpecFromParts(d.parts)
    : d.tab === 'extrema'
      ? sinSpecFromExtrema(d.extrema)
      : sinSpecFromParams(d.params)
}

/**
 * The Parts a spec states. The start is read off the function and the sign
 * the way a textbook chooses them — with b < 0 a sine runs the other way, so
 * its start flips (a cosine is even and does not care).
 */
export function partFieldsFrom(spec: SinSpec): SinPartFields {
  const v = sinValues(spec)
  const base = {
    amplitude: absSource(spec.a || '1'),
    period: periodSource(spec) || '2pi',
    phase: spec.h || '0',
    midline: spec.k || '0',
  }
  if (!v) return { ...base, start: 'mid-up' }
  const up = v.a * (spec.fn === 'sin' && v.b < 0 ? -1 : 1) > 0
  const start: SinStart =
    spec.fn === 'cos' ? (up ? 'max' : 'min') : up ? 'mid-up' : 'mid-down'
  // A negative b written as the phase the other way round would change h;
  // Parts states a positive period, so with b < 0 a cosine keeps h (even) and
  // a sine's flip is the start above.
  return { ...base, start }
}

/** The first maximum of the cycle and the minimum next to it. */
export function extremaFieldsFrom(spec: SinSpec): SinExtremaFields {
  const f = safeSinFeatures(spec)
  const max = f?.keyPoints.find((p) => p.kind === 'max')
  const min = f?.keyPoints.find((p) => p.kind === 'min')
  if (!max || !min) return { maxX: '0', maxY: '1', minX: 'pi', minY: '-1' }
  return {
    maxX: sourceOfText(max.xText, max.x),
    maxY: sourceOfText(max.yText, max.y),
    minX: sourceOfText(min.xText, min.x),
    minY: sourceOfText(min.yText, min.y),
  }
}

export function paramFieldsFrom(spec: SinSpec): SinParamFields {
  return {
    fn: spec.fn === 'cos' ? 'cos' : 'sin',
    a: spec.a || '1',
    b: spec.b || '1',
    period: periodSource(spec) || '2pi',
    h: spec.h || '0',
    k: spec.k || '0',
  }
}

/** The Parameters tab with b retyped: the period beside it follows. */
export function withB(f: SinParamFields, b: string): SinParamFields {
  return { ...f, b, period: periodForB(b) || f.period }
}

/** The Parameters tab with the period retyped: b = 2π/P follows. */
export function withPeriod(f: SinParamFields, period: string): SinParamFields {
  const P = evalText(period)
  const b = P !== null ? bForPeriod(P) : null
  if (!b) return { ...f, period }
  const old = evalText(f.b)
  return { ...f, period, b: old !== null && old < 0 ? negSource(b) : b }
}

/**
 * Switch tab. The curve does not change: the new tab's fields are re-seeded
 * from the spec the old tab made, and that spec is carried exactly until a
 * field on the new tab is edited.
 */
export function switchSinTab(d: SinDraft, tab: SinTab): SinDraft {
  if (tab === d.tab) return d
  const { spec } = sinSpecFromDraft(d)
  if (!spec) return { ...d, tab, carried: null }
  return {
    ...d,
    tab,
    parts: tab === 'parts' ? partFieldsFrom(spec) : d.parts,
    extrema: tab === 'extrema' ? extremaFieldsFrom(spec) : d.extrema,
    params: tab === 'params' ? paramFieldsFrom(spec) : d.params,
    carried: spec,
  }
}

// ---------------------------------------------------------------------------
// the preview
// ---------------------------------------------------------------------------

export interface SinPreview {
  src: string | null
  latex: string | null
  sentences: string[]
  keys: KeyRow[]
  error: string | null
}

export function sinPreview(spec: SinSpec | null, error: string | null = null): SinPreview {
  if (!spec) return { src: null, latex: null, sentences: [], keys: [], error }
  const src = safeSinSource(spec)
  if (!src) {
    const p = sinProblems(spec)
    return {
      src: null,
      latex: null,
      sentences: [],
      keys: [],
      error: p[0]?.message ?? 'This sinusoid could not be written out.',
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
  const f = safeSinFeatures(spec)
  return {
    src,
    latex,
    sentences: f ? f.sentences.filter((t) => t.trim() !== '') : [],
    keys: keyRows(f),
    error: err,
  }
}

// ---------------------------------------------------------------------------
// "write as": the same function, stated another way
// ---------------------------------------------------------------------------

/** The same function with the other of sin/cos. Null when it already is. */
export function writeAs(spec: SinSpec, fn: SinFn): SinSpec | null {
  if ((spec.fn === 'cos' ? 'cos' : 'sin') === fn) return null
  try {
    const out = rewriteAs(spec, fn)
    return sinProblems(out).length === 0 ? out : null
  } catch {
    return null
  }
}

/** The same function with a positive amplitude. Null when a is already > 0. */
export function writePositive(spec: SinSpec): SinSpec | null {
  const v = sinValues(spec)
  if (!v || v.a > 0) return null
  try {
    const out = rewriteAs(spec, spec.fn === 'cos' ? 'cos' : 'sin', true)
    return sinProblems(out).length === 0 ? out : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// one committed edit on a card
// ---------------------------------------------------------------------------

export type SinEdit = SinField | 'period'

export const SIN_FIELD_LABEL: Record<SinEdit, string> = {
  a: 'set amplitude',
  b: 'set frequency',
  period: 'set period',
  h: 'set phase shift',
  k: 'set midline',
}

/** The spec with one field retyped. The period rewrites b = 2π/P. */
export function setSinField(spec: SinSpec, field: SinEdit, text: string): SinSpec | null {
  const t = text.trim()
  if (field !== 'period') return { ...spec, [field]: t }
  const P = evalText(t)
  const b = P !== null ? bForPeriod(P) : null
  if (!b) return null
  const old = evalText(spec.b)
  return { ...spec, b: old !== null && old < 0 ? negSource(b) : b }
}

/** Switch sin ⇄ cos without rewriting h: a DIFFERENT function (the card's picker). */
export function setSinFn(spec: SinSpec, fn: SinFn): SinSpec {
  return { ...spec, fn }
}

export interface SinCommitDeps {
  restate(src: string, label: string): string | null
}

/** Apply an edit and restate. The refusal, or null. */
export function commitSinSpec(
  spec: SinSpec,
  next: SinSpec | null,
  label: string,
  deps: SinCommitDeps,
): string | null {
  if (!next) return 'That can’t be written as this sinusoid.'
  const p = sinProblems(next)
  if (p.length > 0) return p[0].message
  const src = safeSinSource(next)
  if (!src) return 'This sinusoid could not be written out.'
  const before = safeSinSource(spec)
  if (src === before) return null
  return deps.restate(src, label)
}

// ---------------------------------------------------------------------------
// what the board shows while it is selected
// ---------------------------------------------------------------------------

const MARK_KIND: Record<KeyRow['kind'], SpecialPoint['kind']> = {
  max: 'maximum',
  min: 'minimum',
  mid: 'inflection',
}

/**
 * The five key points of the cycle that starts at x = h, as analysis marks —
 * the ring and the exact-text chip the board already draws for a special
 * point ("(π/4, 1)").
 */
export function sinKeyMarks(spec: SinSpec): SpecialPoint[] {
  const f = safeSinFeatures(spec)
  if (!f) return []
  return f.keyPoints
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({
      kind: MARK_KIND[p.kind],
      pos: { x: p.x, y: p.y },
      label: p.kind === 'mid' ? 'key point (midline)' : `key point (${p.kind})`,
      exactX: p.xText,
      exactY: p.yText,
      exact: true,
    }))
}

/**
 * The board's marks for a selected sinusoid: whatever the analysis already
 * shows (its indices kept, so the card's hover still points at the right
 * marker), then the key points it does not already mark.
 */
export function withKeyMarks(
  analysis: readonly SpecialPoint[],
  marks: readonly SpecialPoint[],
): SpecialPoint[] {
  const out = analysis.slice()
  for (const m of marks) {
    const tol = 1e-6 * Math.max(1, Math.abs(m.pos.x), Math.abs(m.pos.y))
    const there = analysis.some(
      (p) => Math.abs(p.pos.x - m.pos.x) <= tol && Math.abs(p.pos.y - m.pos.y) <= tol,
    )
    if (!there) out.push(m)
  }
  return out
}

/** The midline y = k: a dashed horizontal line in the curve's colour. */
export const MIDLINE_DASH = [6, 5]

export function midlinePolyline(spec: SinSpec, color: string, id: string): Polyline | null {
  const v = sinValues(spec)
  if (!v || !Number.isFinite(v.k)) return null
  // Far enough that no pan or zoom reaches an end; the renderer clips.
  const reach = 1e6 + Math.abs(v.h)
  return {
    id,
    pts: [
      { x: v.h - reach, y: v.k },
      { x: v.h + reach, y: v.k },
    ],
    color,
    width: 1.25,
    dash: MIDLINE_DASH,
  }
}

// ---------------------------------------------------------------------------
// board handles
// ---------------------------------------------------------------------------

export type SinHandleKind = 'k' | 'a' | 'p'

export interface SinHandle {
  which: SinHandleKind
  pos: Vec2
  label: string
}

function pt(x: number, y: number, xText?: string, yText?: string): string {
  return `(${xText ?? minus(numOut(x, 4))}, ${yText ?? minus(numOut(y, 4))})`
}

/**
 * The three things a teacher grabs:
 *   k — the midline (the App puts its handle at the board's left edge, as the
 *       exponential's asymptote; here it sits half a period after h);
 *   a — the first maximum of the cycle that starts at x = h;
 *   p — the end of that cycle, x = h + period.
 */
export function sinHandles(spec: SinSpec): SinHandle[] {
  const v = sinValues(spec)
  const f = safeSinFeatures(spec)
  if (!v || !f || f.keyPoints.length < 5) return []
  const P = f.period
  const out: SinHandle[] = [
    {
      which: 'k',
      pos: { x: v.h + P / 2, y: v.k },
      label: `midline y = ${minus(numOut(v.k, 4))}`,
    },
  ]
  const max = f.keyPoints.find((p) => p.kind === 'max')
  if (max) {
    out.push({
      which: 'a',
      pos: { x: max.x, y: max.y },
      label: `maximum ${pt(max.x, max.y, max.xText, max.yText)}`,
    })
  }
  const end = f.keyPoints[4]
  out.push({
    which: 'p',
    pos: { x: end.x, y: end.y },
    label: `end of cycle ${pt(end.x, end.y, end.xText, end.yText)} · period ${periodText(spec, f)}`,
  })
  return out
}

/**
 * A pointer x that has not really moved sideways stays exactly where it was:
 * a vertical drag of the maximum must not nudge the phase shift by the
 * distance between the maximum and the nearest snap rung.
 */
export function stickyX(raw: number, anchor: number, pxPerUnit: number, snapped: number): number {
  if (Number.isFinite(anchor) && Math.abs(raw - anchor) * pxPerUnit < 6) return anchor
  return snapped
}

/**
 * A handle dragged to `to` (already snapped), computed from the spec at the
 * press:
 *
 *   k — the midline moves vertically: k = y; the wave rides with it.
 *   a — the first maximum: vertically sets the amplitude (a = y − k, keeping
 *       which way the wave starts; dragged below the midline it flips), and
 *       sideways sets the phase shift (the maximum is where it is put).
 *   p — the end of the first cycle, sideways: period = x − h (b = 2π/P, its
 *       sign kept), the start of the cycle stays put.
 *
 * Null when that makes no sinusoid (a = 0, a period ≤ 0).
 */
export function dragSinHandle(spec: SinSpec, which: SinHandleKind, to: Vec2): SinSpec | null {
  const v = sinValues(spec)
  if (!v) return null
  switch (which) {
    case 'k':
      if (!Number.isFinite(to.y)) return null
      return { ...spec, k: numOut(to.y) }
    case 'a': {
      if (!Number.isFinite(to.y) || !Number.isFinite(to.x)) return null
      const f = safeSinFeatures(spec)
      const max = f?.keyPoints.find((p) => p.kind === 'max')
      if (!max) return null
      // the unit wave's value at the maximum: +1 when a > 0 there, −1 when a < 0
      const s = (max.y - v.k) / v.a
      const a = (to.y - v.k) / s
      if (!Number.isFinite(a) || Math.abs(a) < 1e-12) return null
      const next: SinSpec = { ...spec, a: numOut(a) }
      const dx = to.x - max.x
      if (Math.abs(dx) > 1e-12) next.h = xSource(v.h + dx)
      return next
    }
    case 'p': {
      if (!Number.isFinite(to.x)) return null
      const P = to.x - v.h
      if (!(P > 1e-9)) return null
      const b = bForPeriod(P)
      if (!b) return null
      return { ...spec, b: v.b < 0 ? negSource(b) : b }
    }
  }
}

export const SIN_HANDLE_LABEL: Record<SinHandleKind, string> = {
  k: 'move midline',
  a: 'move maximum',
  p: 'set period',
}

/**
 * Where a pointer's x lands on a π-labelled axis: the nearest multiple of
 * π/q, q the finest of 24, 12, 6, 4, 2, 1 whose rung is at least 8 px apart
 * on screen — so a phase shift dragged on a trig board is π/4, not 0.8.
 */
export function snapPiX(x: number, pxPerUnit: number): number {
  if (!Number.isFinite(x)) return x
  const ppu = Number.isFinite(pxPerUnit) && pxPerUnit > 0 ? pxPerUnit : 60
  let q = 1
  for (const cand of [24, 12, 6, 4, 2, 1]) {
    if ((Math.PI / cand) * ppu >= 8) {
      q = cand
      break
    }
  }
  const step = Math.PI / q
  const n = Math.round(x / step)
  return n === 0 ? 0 : n * step
}

// ---------------------------------------------------------------------------
// a SKETCHED sinusoid: the library family a·sin(bx + c) + d
// ---------------------------------------------------------------------------

export interface FittedSin {
  spec: SinSpec
  /** The typed line "Convert to typed sinusoid" writes. */
  src: string
  /** "= 1.5sin(1.2(x − 0.25)) + 0.4 · amplitude 1.5 · period 5.236" */
  note: string
}

/**
 * The fitted params [a, b, c, d] of y = a·sin(bx + c) + d, stated the
 * precalculus way: bx + c = b(x − h) with h = −c/b. A negative b is turned
 * round first (sin(−u) = −sin u, so a and c change sign with it), and h is
 * brought into the cycle nearest 0 (h ± a whole period is the same wave).
 * Four significant digits, as the other fitted notes.
 */
export function fittedSine(params: readonly number[]): FittedSin | null {
  let [a, b, c] = params
  const d = params[3]
  if (![a, b, c, d].every((v) => typeof v === 'number' && Number.isFinite(v))) return null
  if (Math.abs(a) < 1e-9 || Math.abs(b) < 1e-9) return null
  if (b < 0) {
    a = -a
    b = -b
    c = -c
  }
  const P = (2 * Math.PI) / b
  let h = -c / b
  h -= P * Math.round(h / P)
  const spec: SinSpec = {
    fn: 'sin',
    a: numOut(a, 4),
    b: numOut(b, 4),
    h: Math.abs(h) < 1e-9 * P ? '0' : numOut(h, 4),
    k: Math.abs(d) < 1e-9 * Math.max(1, Math.abs(a)) ? '0' : numOut(d, 4),
  }
  if (sinProblems(spec).length > 0) return null
  const src = safeSinSource(spec)
  if (!src) return null
  const rhs = src.replace(/^[^=]*=\s*/, '')
  const note = [
    `= ${rhs.replace(/-/g, '−').replace(/\*/g, '·')}`,
    `amplitude ${numOut(Math.abs(a), 4)}`,
    `period ${numOut(P, 4)}`,
  ].join(' · ')
  return { spec, src, note }
}

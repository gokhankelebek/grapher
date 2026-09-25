// ============================================================================
// src/ui/logLinks.ts — a logarithmic function, edited the way it is STATED.
//
// src/core/logarithmic.ts is the bridge between a typed line and the numbers
// a precalculus class states — y = a·log_b(c(x − h)) + k — and the inverse
// pairing with src/core/exponential.ts. Everything here sits on top of that
// bridge and is pure (no React, no DOM, no App state), mirroring expLinks.ts:
//
//   * the three tabs of "Build ▾ → Logarithmic" — Parameters, Two points,
//     Inverse of… — as field sets that each turn into ONE LogSpec, re-seeded
//     from that spec on a tab switch so switching tabs never moves the curve
//     (Inverse of… is the exception: it is a CHOICE of curve, not a statement
//     of this one, so it seeds the others but is not seeded by them);
//   * the card's "write in base" switch: the same function in another base;
//   * one committed field edit on a card's Logarithmic section;
//   * the board handles — the vertical asymptote on the x-axis, the anchor
//     (argument 1) and the base point (argument b) — and what each drag writes;
//   * "Show inverse": the exact inverse of an exponential or a logarithm, and
//     the mirror line y = x once per board;
//   * the note a SKETCHED curve that fitted the library's a·ln(x − b) + c
//     wears, and the line "Convert to typed logarithm" replaces it with.
//
// Every result is an ordinary typed curve. Nothing downstream knows.
// ============================================================================

import type { Vec2 } from '../core/types'
import { CURVE_COLORS } from '../core/types'
import {
  expAsInverse,
  logAsInverse,
  logFeatures,
  logFromTwoPoints,
  logSource,
  readLogarithmic,
  rebase,
} from '../core/logarithmic'
import type { LogFeatures, LogSpec } from '../core/logarithmic'
import type { ExpSpec } from '../core/exponential'
import { expSource } from '../core/exponential'
import { parseExpression } from '../core/parse'
import { evalText } from './factorLinks'
import { fittedExp, minus, numOut, safeReadExponential } from './expLinks'

// ---------------------------------------------------------------------------
// numbers
// ---------------------------------------------------------------------------

/** The numbers of a spec. */
export interface LogValues {
  a: number
  b: number
  c: number
  h: number
  k: number
}

/** The base as a number: "e" is e (evalText reads it), "10", "1/2", "3". */
export function baseValue(b: string): number | null {
  return evalText(b.trim())
}

/** Every field evaluated, or null while one does not (or it is no log). */
export function logValues(spec: LogSpec): LogValues | null {
  const a = evalText(spec.a)
  const b = baseValue(spec.b)
  const c = evalText(spec.c || '1')
  const h = evalText(spec.h || '0')
  const k = evalText(spec.k || '0')
  if (a === null || b === null || c === null || h === null || k === null) return null
  if (!(b > 0) || b === 1 || c === 0) return null
  return { a, b, c, h, k }
}

/** f(x) for a spec: NaN off the domain. */
export function logEval(spec: LogSpec, x: number): number {
  const v = logValues(spec)
  if (!v) return NaN
  const u = v.c * (x - v.h)
  if (!(u > 0)) return NaN
  return (v.a * Math.log(u)) / Math.log(v.b) + v.k
}

// ---------------------------------------------------------------------------
// what is wrong
// ---------------------------------------------------------------------------

export type LogField = 'a' | 'b' | 'c' | 'h' | 'k'

export interface LogProblem {
  field: LogField
  message: string
}

/** Every field that stops the spec being a logarithm. Empty = buildable. */
export function logProblems(spec: LogSpec): LogProblem[] {
  const out: LogProblem[] = []
  const num = (field: LogField, text: string | undefined, what: string): number | null => {
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
  const a = num('a', spec.a, 'stretch a')
  if (a === 0) out.push({ field: 'a', message: 'a can’t be 0 — that is the line y = k.' })
  const b = num('b', spec.b, 'base b')
  if (b !== null) {
    if (b <= 0) out.push({ field: 'b', message: 'The base b must be positive.' })
    else if (b === 1) out.push({ field: 'b', message: 'There is no logarithm base 1.' })
  }
  const c = num('c', spec.c || '1', 'horizontal scale c')
  if (c === 0) out.push({ field: 'c', message: 'c can’t be 0 — log(0) is undefined everywhere.' })
  num('h', spec.h || '0', 'asymptote h')
  num('k', spec.k || '0', 'shift k')
  return out
}

// ---------------------------------------------------------------------------
// the core, never throwing
// ---------------------------------------------------------------------------

export function safeReadLogarithmic(src: string | undefined): LogSpec | null {
  if (!src || !src.trim()) return null
  try {
    const s = readLogarithmic(src)
    return s && logValues(s) ? s : null
  } catch {
    return null
  }
}

export function safeLogSource(spec: LogSpec): string | null {
  if (logProblems(spec).length > 0) return null
  try {
    return logSource(spec)
  } catch {
    return null
  }
}

export function safeLogFeatures(spec: LogSpec): LogFeatures | null {
  if (logProblems(spec).length > 0) return null
  try {
    return logFeatures(spec)
  } catch {
    return null
  }
}

function pt(p: { x: number; y: number }): string {
  return `(${minus(numOut(p.x, 4))}, ${minus(numOut(p.y, 4))})`
}

/**
 * The features as the card lists them: asymptote, domain, range, the anchor
 * and base points, intercepts, direction and bend, ends.
 */
export function logFeatureLines(f: LogFeatures | null): string[] {
  if (!f) return []
  const out: string[] = []
  out.push(`Vertical asymptote x = ${minus(numOut(f.asymptote, 4))}`)
  if (f.domain) out.push(`Domain: ${f.domain.replace(/-/g, '−')}`)
  if (f.range) out.push(`Range: ${f.range}`)
  out.push(`Anchor ${pt(f.anchor)} · base point ${pt(f.basePoint)}`)
  if (f.xIntercept !== null && Number.isFinite(f.xIntercept)) {
    out.push(`x-intercept (${minus(numOut(f.xIntercept, 4))}, 0)`)
  }
  if (f.yIntercept !== null && Number.isFinite(f.yIntercept)) {
    out.push(`y-intercept (0, ${minus(numOut(f.yIntercept, 4))})`)
  }
  out.push(
    `${f.increasing ? 'Increasing' : 'Decreasing'}, concave ${f.concaveUp ? 'up' : 'down'}`,
  )
  if (f.endBehaviour) out.push(f.endBehaviour)
  return out
}

/**
 * What a preview or a card shows: the core's teacher sentences first, then
 * only those features the sentences do not already say (the range, the end
 * behaviour, a y-intercept) — one list never repeats the other. Without
 * sentences, the feature lines stand alone.
 */
export function logFacts(f: LogFeatures | null): { sentences: string[]; features: string[] } {
  if (!f) return { sentences: [], features: [] }
  const sentences = f.sentences.filter((t) => t.trim() !== '')
  if (sentences.length === 0) return { sentences: [], features: logFeatureLines(f) }
  const said = sentences.join(' · ').toLowerCase()
  const features: string[] = []
  if (!/asymptote/.test(said)) features.push(`Vertical asymptote x = ${minus(numOut(f.asymptote, 4))}`)
  if (!/domain/.test(said) && f.domain) features.push(`Domain: ${f.domain.replace(/-/g, '−')}`)
  if (!/range/.test(said) && f.range) features.push(`Range: ${f.range}`)
  if (!/passes through|anchor/.test(said)) {
    features.push(`Anchor ${pt(f.anchor)} · base point ${pt(f.basePoint)}`)
  }
  if (!/x-intercept/.test(said) && f.xIntercept !== null && Number.isFinite(f.xIntercept)) {
    features.push(`x-intercept (${minus(numOut(f.xIntercept, 4))}, 0)`)
  }
  if (!/y-intercept/.test(said) && f.yIntercept !== null && Number.isFinite(f.yIntercept)) {
    features.push(`y-intercept (0, ${minus(numOut(f.yIntercept, 4))})`)
  }
  if (!/increasing|decreasing/.test(said)) {
    features.push(`${f.increasing ? 'Increasing' : 'Decreasing'}, concave ${f.concaveUp ? 'up' : 'down'}`)
  }
  if (f.endBehaviour && !said.includes(f.endBehaviour.toLowerCase())) features.push(f.endBehaviour)
  return { sentences, features }
}

// ---------------------------------------------------------------------------
// the base
// ---------------------------------------------------------------------------

/** The base picker: the three named logs and "other b". */
export type BaseKey = 'e' | '10' | '2' | 'other'

export const BASE_CHOICES: { key: BaseKey; label: string }[] = [
  { key: 'e', label: 'ln' },
  { key: '10', label: 'log' },
  { key: '2', label: 'log₂' },
  { key: 'other', label: 'other b' },
]

/** Which picker entry a base as written is. */
export function baseKeyOf(b: string): BaseKey {
  const t = b.replace(/\s+/g, '')
  if (t === 'e') return 'e'
  if (t === '10') return '10'
  if (t === '2') return '2'
  return 'other'
}

/** The base text a picker entry plus its "other" field stand for. */
export function baseText(key: BaseKey, other: string): string {
  return key === 'other' ? other.trim() : key
}

/** How the base is named in prose: ln, log, log₂, log_3. */
export function baseName(b: string): string {
  const key = baseKeyOf(b)
  if (key === 'e') return 'ln'
  if (key === '10') return 'log'
  if (key === '2') return 'log₂'
  return `log base ${b.trim()}`
}

// ---------------------------------------------------------------------------
// the three tabs
// ---------------------------------------------------------------------------

export type LogTab = 'params' | 'points' | 'inverse'

export interface LogParamFields {
  base: BaseKey
  /** The base when `base` is "other". */
  other: string
  a: string
  c: string
  h: string
  k: string
}

export interface LogPointFields {
  x1: string
  y1: string
  x2: string
  y2: string
  /** The asymptote x = h. */
  h: string
  base: BaseKey
  other: string
}

export interface LogInverseFields {
  /** The chosen exponential curve's id, or null for the first one listed. */
  sourceId: string | null
}

/** An exponential on the board that "Inverse of…" can pick. */
export interface InverseSource {
  id: string
  /** "f: y = 2^x" — what the dropdown shows. */
  label: string
  spec: ExpSpec
}

export interface LogDraft {
  tab: LogTab
  params: LogParamFields
  points: LogPointFields
  inverse: LogInverseFields
  /**
   * The function carried over by a tab switch, EXACTLY as it was, until a
   * field on the new tab is edited (see ExpDraft.carried).
   */
  carried?: LogSpec | null
}

/** y = log₂(x): the log a class meets first. */
export const DEFAULT_LOG: LogSpec = { a: '1', b: '2', c: '1', h: '0', k: '0' }

export function blankLogDraft(): LogDraft {
  return {
    tab: 'params',
    params: logParamFieldsFrom(DEFAULT_LOG),
    points: logPointFieldsFrom(DEFAULT_LOG),
    inverse: { sourceId: null },
  }
}

export interface LogSpecResult {
  spec: LogSpec | null
  error: string | null
}

function need(text: string, what: string): string | null {
  const t = text.trim()
  if (t === '') return `The ${what} is empty.`
  if (evalText(t) === null) return `The ${what} “${t}” is not a number.`
  return null
}

function baseError(key: BaseKey, other: string): string | null {
  if (key !== 'other') return null
  const e = need(other, 'base b')
  if (e) return e
  const b = evalText(other)!
  if (b <= 0) return 'The base b must be positive.'
  if (b === 1) return 'There is no logarithm base 1.'
  return null
}

export function logSpecFromParams(f: LogParamFields): LogSpecResult {
  const be = baseError(f.base, f.other)
  if (be) return { spec: null, error: be }
  const spec: LogSpec = {
    a: f.a.trim(),
    b: baseText(f.base, f.other),
    c: f.c.trim() || '1',
    h: f.h.trim() || '0',
    k: f.k.trim() || '0',
  }
  const p = logProblems(spec)
  return p.length > 0 ? { spec: null, error: p[0].message } : { spec, error: null }
}

export function logSpecFromPoints(f: LogPointFields): LogSpecResult {
  const first = [
    need(f.x1, 'x₁'),
    need(f.y1, 'y₁'),
    need(f.x2, 'x₂'),
    need(f.y2, 'y₂'),
    need(f.h || '0', 'asymptote'),
    baseError(f.base, f.other),
  ].find((c) => c !== null)
  if (first) return { spec: null, error: first }
  const p1 = { x: evalText(f.x1)!, y: evalText(f.y1)! }
  const p2 = { x: evalText(f.x2)!, y: evalText(f.y2)! }
  const h = evalText(f.h || '0')!
  let spec: LogSpec | null = null
  try {
    spec = logFromTwoPoints(p1, p2, h, baseText(f.base, f.other))
  } catch {
    spec = null
  }
  if (!spec) return { spec: null, error: logTwoPointRefusal(p1, p2, h) }
  const p = logProblems(spec)
  return p.length > 0 ? { spec: null, error: p[0].message } : { spec, error: null }
}

/** Why no logarithm with asymptote x = h goes through both points. */
export function logTwoPointRefusal(p1: Vec2, p2: Vec2, h: number): string {
  if (p1.x === p2.x) return 'The two points share an x — a function can’t go through both.'
  if (p1.x === h || p2.x === h) {
    return `A point on the asymptote x = ${minus(numOut(h, 4))} is never reached.`
  }
  if ((p1.x - h) * (p2.x - h) < 0) {
    return 'The points must be on the same side of the asymptote.'
  }
  if (p1.y === p2.y) return 'Two points at the same height make a constant, not a logarithm.'
  return 'No logarithm goes through those two points.'
}

/** The exponential "Inverse of…" has chosen: the one named, else the first. */
export function chosenSource(
  f: LogInverseFields,
  sources: readonly InverseSource[],
): InverseSource | null {
  return sources.find((s) => s.id === f.sourceId) ?? sources[0] ?? null
}

export function logSpecFromInverse(
  f: LogInverseFields,
  sources: readonly InverseSource[],
): LogSpecResult {
  const src = chosenSource(f, sources)
  if (!src) return { spec: null, error: 'There is no exponential on the board to invert.' }
  let spec: LogSpec
  try {
    spec = unnamed(logAsInverse(src.spec))
  } catch {
    return { spec: null, error: 'That exponential could not be inverted.' }
  }
  const p = logProblems(spec)
  return p.length > 0 ? { spec: null, error: p[0].message } : { spec, error: null }
}

export function logSpecFromDraft(
  d: LogDraft,
  sources: readonly InverseSource[] = [],
): LogSpecResult {
  if (d.carried && logProblems(d.carried).length === 0) return { spec: d.carried, error: null }
  return d.tab === 'params'
    ? logSpecFromParams(d.params)
    : d.tab === 'points'
      ? logSpecFromPoints(d.points)
      : logSpecFromInverse(d.inverse, sources)
}

export function logParamFieldsFrom(spec: LogSpec): LogParamFields {
  const key = baseKeyOf(spec.b)
  return {
    base: key,
    other: key === 'other' ? spec.b : '3',
    a: spec.a,
    c: spec.c || '1',
    h: spec.h || '0',
    k: spec.k || '0',
  }
}

/**
 * Seed the Two points tab: the anchor (argument 1) and the base point
 * (argument b) — the two points a class plots first.
 */
export function logPointFieldsFrom(spec: LogSpec): LogPointFields {
  const key = baseKeyOf(spec.b)
  const base = { h: spec.h || '0', base: key, other: key === 'other' ? spec.b : '3' }
  const v = logValues(spec)
  if (!v) return { x1: '1', y1: '0', x2: '2', y2: '1', ...base }
  return {
    x1: numOut(v.h + 1 / v.c),
    y1: numOut(v.k),
    x2: numOut(v.h + v.b / v.c),
    y2: numOut(v.k + v.a),
    ...base,
  }
}

/**
 * Switch tab. The curve does not change: the new tab's fields are re-seeded
 * from the spec the old tab made. "Inverse of…" is a choice of curve, so it
 * is never re-seeded, and landing on it drops whatever was carried.
 */
export function switchLogTab(
  d: LogDraft,
  tab: LogTab,
  sources: readonly InverseSource[] = [],
): LogDraft {
  if (tab === d.tab) return d
  if (tab === 'inverse') return { ...d, tab, carried: null }
  const { spec } = logSpecFromDraft(d, sources)
  if (!spec) return { ...d, tab, carried: null }
  return {
    ...d,
    tab,
    params: tab === 'params' ? logParamFieldsFrom(spec) : d.params,
    points: tab === 'points' ? logPointFieldsFrom(spec) : d.points,
    carried: spec,
  }
}

// ---------------------------------------------------------------------------
// the preview
// ---------------------------------------------------------------------------

export interface LogPreview {
  src: string | null
  latex: string | null
  sentences: string[]
  features: string[]
  error: string | null
}

export function logPreview(spec: LogSpec | null, error: string | null = null): LogPreview {
  if (!spec) return { src: null, latex: null, sentences: [], features: [], error }
  const src = safeLogSource(spec)
  if (!src) {
    const p = logProblems(spec)
    return {
      src: null,
      latex: null,
      sentences: [],
      features: [],
      error: p[0]?.message ?? 'This logarithm could not be written out.',
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
  const facts = logFacts(safeLogFeatures(spec))
  return { src, latex, sentences: facts.sentences, features: facts.features, error: err }
}

// ---------------------------------------------------------------------------
// "write in base": the same function, in another base
// ---------------------------------------------------------------------------

/** The switch on a card: the three named bases, and "keep" (no rewrite). */
export type RebaseKey = 'e' | '10' | '2' | 'keep'

export const REBASE_CHOICES: { key: RebaseKey; label: string }[] = [
  { key: 'e', label: 'ln' },
  { key: '10', label: 'log' },
  { key: '2', label: 'log₂' },
  { key: 'keep', label: 'keep' },
]

/** What the switch shows for a line: its base, when it is a named one. */
export function rebaseKeyOf(spec: LogSpec): RebaseKey {
  const k = baseKeyOf(spec.b)
  return k === 'other' ? 'keep' : k
}

/**
 * The same curve written in another base (change of base folds 1/ln b into
 * a). "keep" — and the base it is already in — is no rewrite: null.
 */
export function rebaseTo(spec: LogSpec, key: RebaseKey): LogSpec | null {
  if (key === 'keep' || baseKeyOf(spec.b) === key) return null
  let out: LogSpec
  try {
    out = rebase(spec, key)
  } catch {
    return null
  }
  return logProblems(out).length === 0 ? out : null
}

// ---------------------------------------------------------------------------
// one committed edit on a card
// ---------------------------------------------------------------------------

export const LOG_FIELD_LABEL: Record<LogField, string> = {
  a: 'set vertical stretch',
  b: 'set base',
  c: 'set horizontal scale',
  h: 'move asymptote',
  k: 'set vertical shift',
}

/** The spec with one field retyped. */
export function setLogField(spec: LogSpec, field: LogField, text: string): LogSpec {
  return { ...spec, [field]: text.trim() }
}

export interface LogCommitDeps {
  restate(src: string, label: string): string | null
}

/** Apply an edit and restate. The refusal, or null. */
export function commitLogSpec(
  spec: LogSpec,
  next: LogSpec | null,
  label: string,
  deps: LogCommitDeps,
): string | null {
  if (!next) return 'That can’t be written as this logarithm.'
  const p = logProblems(next)
  if (p.length > 0) return p[0].message
  const src = safeLogSource(next)
  if (!src) return 'This logarithm could not be written out.'
  const before = safeLogSource(spec)
  if (src === before) return null
  return deps.restate(src, label)
}

// ---------------------------------------------------------------------------
// board handles
// ---------------------------------------------------------------------------

export type LogHandleKind = 'h' | 'k' | 'a'

export interface LogHandle {
  which: LogHandleKind
  pos: Vec2
  label: string
}

/**
 * The three things a teacher grabs: the vertical asymptote (a handle ON the
 * x-axis at x = h), the anchor (h + 1/c, k) where the argument is 1, and the
 * base point (h + b/c, k + a) where the argument is b.
 */
export function logHandles(spec: LogSpec): LogHandle[] {
  const v = logValues(spec)
  if (!v) return []
  const anchor = { x: v.h + 1 / v.c, y: v.k }
  const basePt = { x: v.h + v.b / v.c, y: v.k + v.a }
  const out: LogHandle[] = [
    { which: 'h', pos: { x: v.h, y: 0 }, label: `asymptote x = ${minus(numOut(v.h, 4))}` },
  ]
  if (Number.isFinite(anchor.x)) out.push({ which: 'k', pos: anchor, label: `anchor ${pt(anchor)}` })
  if (Number.isFinite(basePt.x) && Number.isFinite(basePt.y)) {
    out.push({ which: 'a', pos: basePt, label: `base point ${pt(basePt)}` })
  }
  return out
}

/**
 * A handle dragged to `to` (already snapped).
 *
 *   h — the asymptote slides along the x-axis: h = x, everything else kept,
 *       so the whole curve shifts horizontally with it.
 *   k — the anchor moves vertically: k = y, a kept, the curve shifts up/down.
 *   a — the base point moves vertically: a = y − k, the anchor stays put and
 *       the curve stretches through it.
 *
 * Null when that makes no logarithm (the base point dragged onto the anchor's
 * height is a = 0).
 */
export function dragLogHandle(spec: LogSpec, which: LogHandleKind, to: Vec2): LogSpec | null {
  const v = logValues(spec)
  if (!v) return null
  switch (which) {
    case 'h':
      if (!Number.isFinite(to.x)) return null
      return { ...spec, h: numOut(to.x) }
    case 'k':
      if (!Number.isFinite(to.y)) return null
      return { ...spec, k: numOut(to.y) }
    case 'a': {
      if (!Number.isFinite(to.y)) return null
      const a = to.y - v.k
      if (Math.abs(a) < 1e-12) return null
      return { ...spec, a: numOut(a) }
    }
  }
}

export const LOG_HANDLE_LABEL: Record<LogHandleKind, string> = {
  h: 'move asymptote',
  k: 'set vertical shift',
  a: 'set vertical stretch',
}

// ---------------------------------------------------------------------------
// the inverse view
// ---------------------------------------------------------------------------

/** A spec without its function name: an inverse is not "f" too. */
function unnamed<T extends { name?: string }>(spec: T): T {
  const { name: _n, ...rest } = spec
  return rest as T
}

/** The line of the exact inverse of an exponential: a logarithm. */
export function inverseOfExp(spec: ExpSpec): string | null {
  try {
    const inv = unnamed(logAsInverse(spec))
    return safeLogSource(inv)
  } catch {
    return null
  }
}

/** The line of the exact inverse of a logarithm: an exponential. */
export function inverseOfLog(spec: LogSpec): string | null {
  try {
    return expSource(unnamed(expAsInverse(spec)))
  } catch {
    return null
  }
}

export const MIRROR_SRC = 'y = x'

/** A typed line that IS y = x (however it is written: f(x) = x, y=1x …). */
export function isIdentityLine(src: string | undefined): boolean {
  if (!src || !/=/.test(src)) return false
  const t = src.replace(/\s+/g, '')
  if (!/^(y|[A-Za-z]\w*\(x\))=/.test(t)) return false
  try {
    const o = parseExpression(src)
    if (!o.ok || o.plot.kind !== 'explicit') return false
    const m = o.plot.makeModel('mirror_probe')
    if (!m.evalExplicit) return false
    return [-3.7, -1, 0, 0.5, 2, 9.25].every((x) => {
      const y = m.evalExplicit!(o.plot.defaultParams, x)
      return Math.abs(y - x) < 1e-9 * Math.max(1, Math.abs(x))
    })
  } catch {
    return false
  }
}

/**
 * The palette colour paired with this one — blue ↔ teal, red ↔ pink,
 * green ↔ lime, amber ↔ purple — so an inverse reads as "related to that
 * curve" and still prints in its own paper colour. A colour outside the
 * palette keeps itself.
 */
export function inverseColor(color: string): string {
  const i = CURVE_COLORS.indexOf(color)
  if (i < 0) return color
  const pair: Record<number, number> = { 0: 5, 5: 0, 1: 6, 6: 1, 2: 7, 7: 2, 3: 4, 4: 3 }
  return CURVE_COLORS[pair[i] ?? i] ?? color
}

/** The mirror line's colour: a quiet grey, so the pair stays the subject. */
export const MIRROR_COLOR = '#9aa4b2'
/** And its dash — the derivative dash, a known "helper line" look. */
export const MIRROR_DASH = [8, 6]

export interface InversePlan {
  /** The inverse's typed line; null when that exact line is already there. */
  src: string | null
  /** Also add y = x (none on the board yet). */
  mirror: boolean
  notice: string
}

/**
 * What "Show inverse" adds for a curve whose line is `src`: its exact
 * inverse, and y = x unless one of `existing` already is. Null when the line
 * is neither an exponential nor a logarithm (or cannot be inverted).
 */
export function planInverse(src: string, existing: readonly string[]): InversePlan | null {
  const exp = safeReadExponential(src)
  const log = exp ? null : safeReadLogarithmic(src)
  const inv = exp ? inverseOfExp(exp) : log ? inverseOfLog(log) : null
  if (!inv) return null
  const mirror = !existing.some(isIdentityLine)
  // A second click is not a request for a second copy.
  const there = existing.some((line) => line.trim() === inv)
  return {
    src: there ? null : inv,
    mirror,
    notice: there
      ? mirror
        ? 'The inverse is already on the board — added the line y = x'
        : 'The inverse and the line y = x are already on the board'
      : mirror
        ? 'Added the inverse and the line y = x'
        : 'Added the inverse — y = x is already on the board',
  }
}

// ---------------------------------------------------------------------------
// "Inverse of…": the exponentials on the board
// ---------------------------------------------------------------------------

export interface BoardCurveLike {
  id: string
  modelId: string
  kind: string
  params: readonly number[]
  visible?: boolean
}

/**
 * Every exponential a logarithm can be the inverse of: typed lines
 * readExponential accepts, and sketches fitted as the library's a·e^{bx} + c
 * (read the way their card's note reads them).
 */
export function inverseSources(
  curves: readonly BoardCurveLike[],
  sources: Readonly<Record<string, string>>,
  names: Readonly<Record<string, string>> = {},
): InverseSource[] {
  const out: InverseSource[] = []
  for (const c of curves) {
    if (c.kind !== 'explicit') continue
    let spec: ExpSpec | null = null
    let line: string | null = null
    if (c.modelId.startsWith('expr_')) {
      spec = safeReadExponential(sources[c.id])
      line = spec ? (sources[c.id] ?? null) : null
    } else if (c.modelId === 'exp') {
      const f = fittedExp(c.params)
      if (f) {
        spec = f.spec
        line = `${f.src} (sketch)`
      }
    }
    if (!spec || !line) continue
    const name = names[c.id]
    out.push({ id: c.id, label: name ? `${name}: ${line}` : line, spec })
  }
  return out
}

// ---------------------------------------------------------------------------
// a SKETCHED logarithm: the library family a·ln(x − b) + c
// ---------------------------------------------------------------------------

export interface FittedLog {
  spec: LogSpec
  /** The typed line "Convert to typed logarithm" writes. */
  src: string
  /** "= 2.1ln(x − 0.8) + 3 · asymptote x = 0.8" */
  note: string
}

/** The fitted params [a, b, c] of y = a·ln(x − b) + c, four significant digits. */
export function fittedLog(params: readonly number[]): FittedLog | null {
  const [a, b, c] = params
  if (![a, b, c].every((v) => typeof v === 'number' && Number.isFinite(v))) return null
  if (Math.abs(a) < 1e-9) return null
  const spec: LogSpec = {
    a: numOut(a, 4),
    b: 'e',
    c: '1',
    h: numOut(Math.abs(b) < 1e-9 ? 0 : b, 4),
    k: numOut(Math.abs(c) < 1e-9 * Math.max(1, Math.abs(a)) ? 0 : c, 4),
  }
  if (logProblems(spec).length > 0) return null
  const src = safeLogSource(spec)
  if (!src) return null
  const rhs = src.replace(/^[^=]*=\s*/, '')
  const note = [
    `= ${rhs.replace(/-/g, '−').replace(/\*/g, '·')}`,
    `asymptote x = ${minus(spec.h)}`,
  ].join(' · ')
  return { spec, src, note }
}

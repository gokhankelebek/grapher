// ============================================================================
// src/ui/logisticLinks.ts — a logistic function, edited the way it is STATED.
//
// src/core/logistic.ts is the bridge between a typed line and the numbers an
// AP Calculus BC or AP Precalculus class states — y = L/(1 + A·e^(−kx)) + d,
// "P(0) = 20, L = 1000, k = 0.3". Everything here sits on top of that bridge
// and is pure (no React, no DOM, no App state):
//
//   * the "Build ▾ → Logistic" draft: L, k, y(0) (and an optional shift d),
//     turned into one spec with A = L/(y(0) − d) − 1;
//   * the card's Logistic section: its two vocabularies (AP Calc: L, k, A,
//     y(0); AP Precalc: a, b, k, d), the fact lines each one prints, and one
//     committed field edit;
//   * the board handles — the inflection point, the upper asymptote y = L + d
//     and the lower one y = d — and what a drag of each rewrites;
//   * the dashed asymptotes and the "fastest growth" dot a selected logistic
//     wears on screen, and the exact inflection chip;
//   * a SKETCHED curve that fitted the library's a/(1 + e^(−b(x − c))) + d,
//     stated the same way, and the typed line "Convert to typed logistic"
//     writes;
//   * the slope field "Show slope field" adds: the differential equation the
//     curve solves, with the curve's own y(0) as a solution through (0, y(0)).
//
// Every result is an ordinary typed curve. Nothing downstream knows.
// ============================================================================

import type { Polyline, Shape, SpecialPoint, Vec2 } from '../core/types'
import {
  logisticAt,
  logisticFeatures,
  logisticFromInitial,
  logisticFromParams,
  logisticSource,
  logisticValues,
  readLogistic,
} from '../core/logistic'
import type { LogisticFeatures, LogisticSpec, LogisticValues } from '../core/logistic'
import { parseExpression } from '../core/parse'
import { evalText } from './factorLinks'
import { minus, numOut } from './expLinks'

// ---------------------------------------------------------------------------
// the core, never throwing
// ---------------------------------------------------------------------------

export function safeReadLogistic(src: string | undefined): LogisticSpec | null {
  if (!src || !src.trim()) return null
  try {
    const s = readLogistic(src)
    return s && logisticValues(s) ? s : null
  } catch {
    return null
  }
}

export function safeLogisticSource(spec: LogisticSpec): string | null {
  if (logisticProblems(spec).length > 0) return null
  try {
    return logisticSource(spec)
  } catch {
    return null
  }
}

export function safeLogisticFeatures(spec: LogisticSpec): LogisticFeatures | null {
  if (logisticProblems(spec).length > 0) return null
  try {
    return logisticFeatures(spec)
  } catch {
    return null
  }
}

export function safeValues(spec: LogisticSpec): LogisticValues | null {
  try {
    return logisticValues(spec)
  } catch {
    return null
  }
}

const hasBase = (spec: LogisticSpec): boolean => spec.b !== undefined && spec.b.trim() !== ''

// ---------------------------------------------------------------------------
// what is wrong
// ---------------------------------------------------------------------------

export type LogisticField = 'L' | 'k' | 'A' | 'b' | 'x0' | 'y0' | 'd'

export interface LogisticProblem {
  field: LogisticField
  message: string
}

/** Every field that stops the spec being a logistic. Empty = buildable. */
export function logisticProblems(spec: LogisticSpec): LogisticProblem[] {
  const out: LogisticProblem[] = []
  const num = (field: LogisticField, text: string | undefined, what: string): number | null => {
    const t = (text ?? '').trim()
    const v = t === '' ? null : evalText(t)
    if (v === null) {
      out.push({ field, message: t === '' ? `The ${what} is empty.` : `The ${what} “${t}” is not a number.` })
    }
    return v
  }
  const L = num('L', spec.L, 'carrying capacity L')
  if (L === 0) out.push({ field: 'L', message: 'L can’t be 0 — there would be nothing to grow toward.' })
  if (hasBase(spec)) {
    const b = num('b', spec.b, 'base b')
    if (b !== null && (b <= 0 || b === 1)) out.push({ field: 'b', message: 'The base must be positive and not 1.' })
  } else {
    const k = num('k', spec.k, 'growth constant k')
    if (k === 0) out.push({ field: 'k', message: 'k = 0 is a constant, not a logistic.' })
  }
  const A = num('A', spec.A, 'constant A')
  if (A !== null && A <= 0) {
    out.push({ field: 'A', message: 'A must be positive: with A ≤ 0 the denominator reaches 0 — a pole, not an S.' })
  }
  num('x0', spec.h || '0', 'shift h')
  num('d', spec.d || '0', 'shift d')
  return out
}

// ---------------------------------------------------------------------------
// the two vocabularies
// ---------------------------------------------------------------------------

/** AP Calculus: L, k, A, y(0). AP Precalculus: a, b, k, d. The same line. */
export type LogisticForm = 'ap' | 'precalc'

export const LOGISTIC_FORMS: { form: LogisticForm; label: string; title: string }[] = [
  { form: 'ap', label: 'AP Calc', title: 'y = L/(1 + A·e^(−kt)): carrying capacity, growth constant, y(0)' },
  { form: 'precalc', label: 'Precalc', title: 'y = a/(1 + b·e^(−kx)) + d: asymptotes, midpoint, range' },
]

/** Which vocabulary a card opens in: a shifted line is a precalculus line. */
export function defaultForm(spec: LogisticSpec): LogisticForm {
  const d = evalText(spec.d || '0')
  return d !== null && d !== 0 ? 'precalc' : 'ap'
}

const t4 = (v: number): string => minus(numOut(v, 4))

/** The fact lines under the fields, in the chosen vocabulary. */
export function logisticFactLines(spec: LogisticSpec, form: LogisticForm): string[] {
  const f = safeLogisticFeatures(spec)
  if (!f) return []
  const { L, d } = f.values
  const v = spec.v === 't' ? 't' : 'x'
  const inflection = `(${f.inflection.x.text}, ${f.inflection.y.text})`
  const out: string[] = []
  const lowerLine = t4(d)
  const upperLine = t4(L + d)
  const steep = f.increasing ? 'fastest growth' : 'fastest decrease'
  if (form === 'ap') {
    out.push(`Carrying capacity L = ${t4(L)}${d !== 0 ? ` (upper asymptote y = ${upperLine})` : ''}`)
    out.push(`Horizontal asymptotes y = ${lowerLine} and y = ${upperLine}`)
    out.push(`Inflection point ${inflection}: ${steep}`)
    out.push(`Maximum growth rate L·k/4 = ${f.maxRate.text}`)
    if (f.yIntercept) out.push(`Initial value y(0) = ${f.yIntercept.text}`)
  } else {
    out.push(`Horizontal asymptotes y = d = ${lowerLine} and y = a + d = ${upperLine}`)
    out.push(`Inflection (midpoint) ${inflection}, halfway between them`)
    out.push(`Range: ${t4(f.lower)} < y < ${t4(f.upper)}`)
    const x0 = f.inflection.x.text.replace(/^.*≈ /, '')
    // an increasing S is always concave up, then down; a decreasing one the reverse
    const [before, after] = f.increasing ? ['up', 'down'] : ['down', 'up']
    out.push(
      `${f.increasing ? 'Increasing' : 'Decreasing'}; concave ${before} for ${v} < ${x0}, concave ${after} for ${v} > ${x0}`,
    )
    if (f.yIntercept) out.push(`y-intercept (0, ${f.yIntercept.text})`)
    out.push(`Maximum rate of change a·k/4 = ${f.maxRate.text}`)
    const leftEnd = f.values.k > 0 ? lowerLine : upperLine
    const rightEnd = f.values.k > 0 ? upperLine : lowerLine
    out.push(`As ${v} → −∞, y → ${leftEnd}; as ${v} → ∞, y → ${rightEnd}`)
  }
  return out
}

// ---------------------------------------------------------------------------
// the inflection point, rewritten
// ---------------------------------------------------------------------------

/**
 * The same curve with its midpoint at x0, keeping the way it is written:
 * the midpoint form L/(1 + e^(−k(x − x0))) moves its shift, a base form
 * re-solves A = b^(x0 − h), and the AP form re-solves A = e^(k(x0 − h)).
 */
export function withMidpoint(spec: LogisticSpec, x0: number): LogisticSpec | null {
  const v = safeValues(spec)
  if (!v || !Number.isFinite(x0)) return null
  const unitA = evalText(spec.A) === 1
  if (unitA && !hasBase(spec)) return { ...spec, h: numOut(x0) }
  const A = hasBase(spec) ? Math.pow(v.base!, x0 - v.h) : Math.exp(v.k * (x0 - v.h))
  if (!(A > 0) || !Number.isFinite(A)) return null
  return { ...spec, A: numOut(A) }
}

// ---------------------------------------------------------------------------
// one committed edit on a card
// ---------------------------------------------------------------------------

export const LOGISTIC_FIELD_LABEL: Record<LogisticField, string> = {
  L: 'set carrying capacity',
  k: 'set growth constant',
  A: 'set A',
  b: 'set base',
  x0: 'move inflection point',
  y0: 'set initial value',
  d: 'set vertical shift',
}

/** The spec with one field retyped, or null when that can't be a logistic. */
export function setLogisticField(spec: LogisticSpec, field: LogisticField, text: string): LogisticSpec | null {
  const t = text.trim()
  switch (field) {
    case 'L':
    case 'A':
    case 'd':
      return { ...spec, [field]: t }
    case 'k': {
      // retyping k on a base form states it as a continuous rate instead
      const { b: _b, ...rest } = spec
      return { ...rest, k: t }
    }
    case 'b':
      return hasBase(spec) ? { ...spec, b: t } : null
    case 'x0': {
      const x = evalText(t)
      return x === null ? null : withMidpoint(spec, x)
    }
    case 'y0': {
      const r = logisticFromInitial(spec.L, hasBase(spec) ? '1' : spec.k, t, spec.d || '0')
      if (!r.spec) return null
      return { ...spec, A: r.spec.A, h: '0' }
    }
  }
}

/** Why a y(0) edit was refused (the core's sentence), or null. */
export function initialRefusal(spec: LogisticSpec, text: string): string | null {
  const r = logisticFromInitial(spec.L, hasBase(spec) ? '1' : spec.k, text.trim(), spec.d || '0')
  return r.error
}

export interface LogisticCommitDeps {
  restate(src: string, label: string): string | null
}

/** Apply an edit and restate. The refusal, or null. */
export function commitLogisticSpec(
  spec: LogisticSpec,
  next: LogisticSpec | null,
  label: string,
  deps: LogisticCommitDeps,
): string | null {
  if (!next) return 'That can’t be written as this logistic.'
  const p = logisticProblems(next)
  if (p.length > 0) return p[0].message
  const src = safeLogisticSource(next)
  if (!src) return 'This logistic could not be written out.'
  if (src === safeLogisticSource(spec)) return null
  return deps.restate(src, label)
}

/** What each field shows on a card. */
export function logisticFieldValues(spec: LogisticSpec): Record<LogisticField, string> {
  const v = safeValues(spec)
  const y0 = v ? logisticAt(spec, 0) : NaN
  return {
    L: spec.L,
    k: hasBase(spec) ? (v ? numOut(v.k) : '') : spec.k,
    A: spec.A,
    b: spec.b ?? '',
    x0: v ? (evalText(spec.A) === 1 && !hasBase(spec) ? spec.h || '0' : numOut(v.x0)) : '',
    y0: Number.isFinite(y0) ? numOut(y0) : '',
    d: spec.d || '0',
  }
}

// ---------------------------------------------------------------------------
// board handles
// ---------------------------------------------------------------------------

/** 'mid' the inflection point, 'L' the asymptote y = L + d, 'd' the asymptote y = d. */
export type LogisticHandleKind = 'mid' | 'L' | 'd'

export interface LogisticHandle {
  which: LogisticHandleKind
  /** For 'L' and 'd' only y is meaningful: the board puts them at an edge. */
  pos: Vec2
  /** The board edge an asymptote's handle sits at: the side the curve approaches it from. */
  edge: 'left' | 'right' | null
  label: string
}

export function logisticHandles(spec: LogisticSpec): LogisticHandle[] {
  const v = safeValues(spec)
  if (!v) return []
  const upper = v.L + v.d
  const yMid = v.L / 2 + v.d
  // y → L + d as x → +∞ when k > 0: that line's handle sits at the right edge
  const rightIsUpper = v.k > 0
  return [
    {
      which: 'mid',
      pos: { x: v.x0, y: yMid },
      edge: null,
      label: 'inflection point (fastest growth)',
    },
    {
      which: 'L',
      pos: { x: NaN, y: upper },
      edge: rightIsUpper ? 'right' : 'left',
      label: 'carrying capacity y = L + d',
    },
    {
      which: 'd',
      pos: { x: NaN, y: v.d },
      edge: rightIsUpper ? 'left' : 'right',
      label: 'lower asymptote y = d',
    },
  ]
}

export const LOGISTIC_HANDLE_LABEL: Record<LogisticHandleKind, string> = {
  mid: 'move inflection point',
  L: 'move carrying capacity',
  d: 'move lower asymptote',
}

/**
 * A handle dragged to `to` (already snapped).
 *
 *   mid — the inflection point moves to `to`: x0 = to.x, and the whole S
 *         moves up or down with it (d = to.y − L/2; L and k kept, so the
 *         shape is the same S, translated).
 *   L   — the asymptote y = L + d moves; d is kept, so L = to.y − d. The
 *         midpoint's x and k are kept: the S stretches vertically.
 *   d   — the asymptote y = d moves; the OTHER asymptote stays, so L is
 *         re-solved as (L + d) − to.y. x0 and k are kept.
 *
 * An asymptote dragged onto or past the other one is refused (null): the
 * curve would flip over, and that is never what a drag of one line means.
 */
export function dragLogisticHandle(spec: LogisticSpec, which: LogisticHandleKind, to: Vec2): LogisticSpec | null {
  const v = safeValues(spec)
  if (!v) return null
  const tiny = 1e-9 * Math.max(1, Math.abs(v.L))
  switch (which) {
    case 'mid': {
      if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) return null
      const moved = withMidpoint(spec, to.x)
      if (!moved) return null
      return { ...moved, d: numOut(to.y - v.L / 2) }
    }
    case 'L': {
      if (!Number.isFinite(to.y)) return null
      const L = to.y - v.d
      if (Math.sign(L) !== Math.sign(v.L) || Math.abs(L) <= tiny) return null
      return { ...spec, L: numOut(L) }
    }
    case 'd': {
      if (!Number.isFinite(to.y)) return null
      const L = v.L + v.d - to.y
      if (Math.sign(L) !== Math.sign(v.L) || Math.abs(L) <= tiny) return null
      return { ...spec, L: numOut(L), d: numOut(to.y) }
    }
  }
}

// ---------------------------------------------------------------------------
// what the board shows while it is selected (screen only)
// ---------------------------------------------------------------------------

export const LOGISTIC_DASH = [6, 5]

/** The two horizontal asymptotes, dashed in the curve's colour. */
export function logisticAsymptotes(spec: LogisticSpec, color: string, idBase: string): Polyline[] {
  const v = safeValues(spec)
  if (!v) return []
  const reach = 1e6 + Math.abs(v.x0)
  return [v.d, v.L + v.d]
    .filter(Number.isFinite)
    .map((y, i) => ({
      id: `${idBase}:${i === 0 ? 'lower' : 'upper'}`,
      pts: [
        { x: v.x0 - reach, y },
        { x: v.x0 + reach, y },
      ],
      color,
      width: 1.25,
      dash: LOGISTIC_DASH,
    }))
}

/** The inflection point as a labelled dot: "fastest growth". */
export function logisticDot(spec: LogisticSpec, color: string, id: string): Shape[] {
  const v = safeValues(spec)
  if (!v) return []
  const y = v.L / 2 + v.d
  if (!Number.isFinite(v.x0) || !Number.isFinite(y)) return []
  const growing = v.L * v.k > 0
  return [{ kind: 'point', id, at: { x: v.x0, y }, color, visible: true, label: growing ? 'fastest growth' : 'fastest decrease' }]
}

/** The inflection as an analysis mark, with its exact coordinates. */
export function logisticMarks(spec: LogisticSpec): SpecialPoint[] {
  const f = safeLogisticFeatures(spec)
  if (!f) return []
  const { x, y } = f.inflection
  if (!Number.isFinite(x.value) || !Number.isFinite(y.value)) return []
  return [
    {
      kind: 'inflection',
      pos: { x: x.value, y: y.value },
      label: 'inflection',
      ...(x.exact ? { exactX: x.exact } : {}),
      ...(y.exact ? { exactY: y.exact } : {}),
      exact: true,
    },
  ]
}

/**
 * The analysis with the logistic's marks: a mark the analysis already has
 * (found numerically, so without the "4 ln 2") takes the exact coordinates in
 * place — its index kept, so a card's hover still points at it; one it lacks
 * is appended.
 */
export function withLogisticMarks(
  analysis: readonly SpecialPoint[],
  marks: readonly SpecialPoint[],
): SpecialPoint[] {
  const out = analysis.slice()
  for (const m of marks) {
    const tol = 1e-6 * Math.max(1, Math.abs(m.pos.x), Math.abs(m.pos.y))
    const i = out.findIndex(
      (p) => Math.abs(p.pos.x - m.pos.x) <= tol && Math.abs(p.pos.y - m.pos.y) <= tol,
    )
    if (i < 0) out.push(m)
    else {
      out[i] = {
        ...out[i],
        ...(m.exactX ? { exactX: m.exactX } : {}),
        ...(m.exactY ? { exactY: m.exactY } : {}),
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// "Show slope field"
// ---------------------------------------------------------------------------

export interface FieldPlan {
  /** The line the slope-field parser reads: "dy/dx = 0.3*y*(1 - y/1000)". */
  src: string
  /** The curve's own initial condition, drawn as the field's solution. */
  through: Vec2 | null
}

export function logisticFieldPlan(spec: LogisticSpec): FieldPlan | null {
  const f = safeLogisticFeatures(spec)
  if (!f) return null
  const y0 = logisticAt(spec, 0)
  return { src: f.fieldSource, through: Number.isFinite(y0) ? { x: 0, y: y0 } : null }
}

// ---------------------------------------------------------------------------
// "Build ▾ → Logistic": L, k, y(0)
// ---------------------------------------------------------------------------

export interface LogisticDraft {
  L: string
  k: string
  y0: string
  d: string
  /** Write the line in t (AP Calc's P(t)) or x. */
  v: 'x' | 't'
}

export function blankLogisticDraft(): LogisticDraft {
  return { L: '1000', k: '0.3', y0: '20', d: '0', v: 'x' }
}

export interface LogisticSpecResult {
  spec: LogisticSpec | null
  error: string | null
}

function need(text: string, what: string): string | null {
  const t = text.trim()
  if (t === '') return `The ${what} is empty.`
  if (evalText(t) === null) return `The ${what} “${t}” is not a number.`
  return null
}

export function specFromLogisticDraft(dr: LogisticDraft): LogisticSpecResult {
  const first = [
    need(dr.L, 'carrying capacity L'),
    need(dr.k, 'growth constant k'),
    need(dr.y0, 'initial value y(0)'),
    need(dr.d || '0', 'shift d'),
  ].find((c) => c !== null)
  if (first) return { spec: null, error: first }
  let r: ReturnType<typeof logisticFromInitial>
  try {
    r = logisticFromInitial(dr.L.trim(), dr.k.trim(), dr.y0.trim(), (dr.d || '0').trim() || '0', dr.v === 't' ? 't' : undefined)
  } catch {
    return { spec: null, error: 'That logistic could not be written out.' }
  }
  if (!r.spec) return { spec: null, error: r.error }
  const p = logisticProblems(r.spec)
  return p.length > 0 ? { spec: null, error: p[0].message } : { spec: r.spec, error: null }
}

export interface LogisticPreview {
  src: string | null
  latex: string | null
  facts: string[]
  deTex: string | null
  error: string | null
}

export function logisticPreview(spec: LogisticSpec | null, error: string | null = null): LogisticPreview {
  if (!spec) return { src: null, latex: null, facts: [], deTex: null, error }
  const src = safeLogisticSource(spec)
  if (!src) {
    const p = logisticProblems(spec)
    return { src: null, latex: null, facts: [], deTex: null, error: p[0]?.message ?? 'This logistic could not be written out.' }
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
  const f = safeLogisticFeatures(spec)
  return {
    src,
    latex,
    facts: logisticFactLines(spec, 'ap'),
    deTex: f?.deTex ?? null,
    error: err,
  }
}

// ---------------------------------------------------------------------------
// a SKETCHED logistic: the library family a/(1 + e^(−b(x − c))) + d
// ---------------------------------------------------------------------------

export interface FittedLogistic {
  spec: LogisticSpec
  /** The typed line "Convert to typed logistic" writes. */
  src: string
}

/** The fitted params stated the AP way, four significant digits. */
export function fittedLogistic(params: readonly number[]): FittedLogistic | null {
  let spec: LogisticSpec | null
  try {
    spec = logisticFromParams(params, 4)
  } catch {
    spec = null
  }
  if (!spec || logisticProblems(spec).length > 0) return null
  const src = safeLogisticSource(spec)
  return src ? { spec, src } : null
}

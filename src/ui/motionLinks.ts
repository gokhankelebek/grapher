// ============================================================================
// src/ui/motionLinks.ts — parametric and polar curves as MOTION, the App half.
//
//   parametric   x = x(t), y = y(t),  a ≤ t ≤ b      a particle in the plane
//   polar        r = r(θ),            α ≤ θ ≤ β
//
// src/core/motion.ts owns the calculus (paramState, paramFeatures, polarArea)
// and the families a teacher names (PARAM_FAMILIES, POLAR_FAMILIES,
// familySource, describePolar). Everything here sits on top of it and is pure
// (no React, no DOM, no App state), mirroring conicLinks.ts:
//
//   * the "Build ▾ → Parametric / polar" draft — a family with its named
//     fields, or Custom x(t), y(t) / r(θ), and the interval — as ONE typed
//     line, previewed (KaTeX, the features' sentences, the polar sentence);
//   * the card's Motion section: its interval (a typed line is RESTATED with
//     the new {a ≤ t ≤ b}; a sketch's domain changes), what it reads, the
//     particle's state at t and the readouts under the slider;
//   * what the board shows while it is selected — the particle, its velocity
//     (and acceleration) vector at a stated scale that never runs longer than
//     a quarter of the board, the dashed ray from the pole, 3–5 direction
//     arrowheads along the curve, the features as analysis marks — and the
//     polar area ½∫r²dθ as a region fanned from the pole.
//
// Every built curve is an ordinary typed line. Nothing downstream knows.
// ============================================================================

import type { FittedCurve, ModelSpec, Polyline, Shape, SpecialPoint, Vec2 } from '../core/types'
import {
  PARAM_FAMILIES,
  POLAR_FAMILIES,
  describePolar,
  familySource,
  paramFeatures,
  paramState,
  polarArea,
} from '../core/motion'
import type { Labeled, ParamFamily, ParamFeatures, ParamState } from '../core/motion'
import { parseExpression } from '../core/parse'
import { exactForm } from '../core/exact'
import { evalText } from './factorLinks'
import { formatCoord } from './numeric'

const TWO_PI = Math.PI * 2

// ---------------------------------------------------------------------------
// which curves move
// ---------------------------------------------------------------------------

export type MotionKind = 'parametric' | 'polar'

/**
 * Sketch families whose parameter means nothing to a class: a vertical line
 * (t IS y) and a freehand Fourier loop. Their cards get no Motion section.
 */
const NOT_MOTION = new Set(['vline', 'fourier'])

/** Whether this curve is a particle's path: a parametric or a polar curve the model can evaluate. */
export function motionKindOf(curve: FittedCurve, models: Record<string, ModelSpec>): MotionKind | null {
  if (NOT_MOTION.has(curve.modelId)) return null
  const spec = models[curve.modelId]
  if (!spec) return null
  if (curve.kind === 'parametric' && typeof spec.evalParametric === 'function') return 'parametric'
  if (curve.kind === 'polar' && typeof spec.evalPolar === 'function') return 'polar'
  return null
}

/** The parameter's name as a class writes it. */
export const VAR_OF: Record<MotionKind, string> = { parametric: 't', polar: 'θ' }

/** The curve's parameter interval: its domain, or the renderer's own default [0, 2π]. */
export function motionInterval(curve: FittedCurve): [number, number] {
  const d = curve.domain
  if (d && Number.isFinite(d[0]) && Number.isFinite(d[1]) && d[0] !== d[1]) {
    return d[0] < d[1] ? [d[0], d[1]] : [d[1], d[0]]
  }
  return [0, TWO_PI]
}

/** Position at t, straight from the model (polar: (r cos θ, r sin θ)). */
export function posAt(curve: FittedCurve, models: Record<string, ModelSpec>, t: number): Vec2 | null {
  const spec = models[curve.modelId]
  if (!spec) return null
  try {
    if (curve.kind === 'parametric' && spec.evalParametric) {
      const p = spec.evalParametric(curve.params, t)
      return Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null
    }
    if (curve.kind === 'polar' && spec.evalPolar) {
      const r = spec.evalPolar(curve.params, t)
      return Number.isFinite(r) ? { x: r * Math.cos(t), y: r * Math.sin(t) } : null
    }
  } catch {
    return null
  }
  return null
}

/** r(θ) of a polar curve, NaN when it has none. */
export function rAt(curve: FittedCurve, models: Record<string, ModelSpec>, th: number): number {
  const spec = models[curve.modelId]
  if (!spec?.evalPolar) return Number.NaN
  try {
    return spec.evalPolar(curve.params, th)
  } catch {
    return Number.NaN
  }
}

// ---------------------------------------------------------------------------
// numbers as text
// ---------------------------------------------------------------------------

const neg = (s: string): string => (s.startsWith('-') ? '−' + s.slice(1) : s)

/** A value as a class writes it: its closed form (2π, π/3, √2) or four digits. */
export function valueText(v: number): string {
  if (!Number.isFinite(v)) return '—'
  if (Math.abs(v) < 1e-12) return '0'
  const e = exactForm(v)
  if (e) return e.text
  return formatCoord(v)
}

/**
 * A value as the PARSER reads it: "2pi", "pi/3", "-pi/2", "sqrt(2)/2", or a
 * plain decimal. Used to write an interval end back into a typed line.
 */
export function valueSource(v: number): string {
  if (!Number.isFinite(v)) return '0'
  if (Math.abs(v) < 1e-12) return '0'
  const e = exactForm(v)
  if (e) {
    const src = textToSource(e.text)
    const back = evalText(src)
    if (back !== null && Math.abs(back - v) <= 1e-9 * Math.max(1, Math.abs(v))) return src
  }
  return String(Number(v.toPrecision(12)))
}

/** Unicode math as typed source: − → -, π → pi, √n → sqrt(n), θ → theta-free. */
export function textToSource(text: string): string {
  return text
    .trim()
    .replace(/−/g, '-')
    .replace(/·/g, '*')
    .replace(/√\(([^()]*)\)/g, 'sqrt($1)')
    .replace(/√(\d+(?:\.\d+)?)/g, 'sqrt($1)')
    .replace(/(\d)π/g, '$1pi')
    .replace(/π/g, 'pi')
}

/** A short number for a readout: four significant digits, a real minus sign. */
export function num(v: number): string {
  if (!Number.isFinite(v)) return '—'
  if (Math.abs(v) < 5e-10) return '0'
  const a = Math.abs(v)
  const s = a >= 1e5 || a < 1e-3 ? v.toExponential(2) : String(Number(v.toPrecision(4)))
  return neg(s)
}

// ---------------------------------------------------------------------------
// the interval, written into a typed line
// ---------------------------------------------------------------------------

/** A trailing `{0 <= t <= 2pi}` — no colon, no comma (a piecewise body has both). */
const TRAIL_BRACE = /\s*\{([^{}]*)\}\s*$/
/** A trailing `for 0 <= t <= 2pi`. */
const TRAIL_FOR = /\s+for\s+([^{}]*)$/i
const MENTIONS_VAR = /(^|[^A-Za-z])(t|θ|theta)([^A-Za-z]|$)/

/** The line without its parameter interval, and the interval's text when it had one. */
export function stripInterval(src: string): { body: string; cond: string | null } {
  const b = TRAIL_BRACE.exec(src)
  if (b && !/[:,]/.test(b[1]) && MENTIONS_VAR.test(b[1]) && /[<>≤≥]/.test(b[1])) {
    return { body: src.slice(0, b.index).trimEnd(), cond: b[1].trim() }
  }
  const f = TRAIL_FOR.exec(src)
  if (f && MENTIONS_VAR.test(f[1]) && /[<>≤≥]/.test(f[1])) {
    return { body: src.slice(0, f.index).trimEnd(), cond: f[1].trim() }
  }
  return { body: src.trimEnd(), cond: null }
}

/** `{lo <= t <= hi}` for a parametric line, `{lo <= θ <= hi}` for a polar one. */
export function intervalCondition(kind: MotionKind, lo: string, hi: string): string {
  return `{${textToSource(lo)} <= ${VAR_OF[kind]} <= ${textToSource(hi)}}`
}

/** The typed line with its interval replaced (or added): one restate. */
export function withInterval(src: string, kind: MotionKind, lo: string, hi: string): string {
  const { body } = stripInterval(src)
  return `${body} ${intervalCondition(kind, lo, hi)}`
}

/**
 * One interval edit on the card, as text: both ends must be numbers and the
 * start below the end. Returns the two ends as source text, or a refusal.
 */
export function readIntervalEdit(
  lo: string,
  hi: string,
  kind: MotionKind,
): { lo: string; hi: string; a: number; b: number } | { error: string } {
  const a = evalText(textToSource(lo))
  const b = evalText(textToSource(hi))
  const v = VAR_OF[kind]
  if (a === null) return { error: `The start of the ${v}-interval is not a number.` }
  if (b === null) return { error: `The end of the ${v}-interval is not a number.` }
  if (!(a < b)) return { error: `The ${v}-interval must run from a smaller ${v} to a larger one.` }
  if (b - a > 1e4) return { error: `That ${v}-interval is too long to draw.` }
  return { lo: textToSource(lo), hi: textToSource(hi), a, b }
}

// ---------------------------------------------------------------------------
// the "Build ▾ → Parametric / polar" draft
// ---------------------------------------------------------------------------

export type MotionTab = 'parametric' | 'polar'

export const MOTION_TABS: { tab: MotionTab; label: string }[] = [
  { tab: 'parametric', label: 'Parametric' },
  { tab: 'polar', label: 'Polar' },
]

/** The family id that means "type your own". */
export const CUSTOM = 'custom'

export interface MotionDraft {
  tab: MotionTab
  /** A PARAM_FAMILIES id, or CUSTOM. */
  paramFamily: string
  /** A POLAR_FAMILIES id, or CUSTOM. */
  polarFamily: string
  /** Field text per family id, per parameter name; absent = the family's default. */
  values: Record<string, Record<string, string>>
  /** The interval per family id (CUSTOM keyed by tab: 'custom:parametric'); absent = the default. */
  intervals: Record<string, [string, string]>
  customX: string
  customY: string
  customR: string
}

export function familiesOf(tab: MotionTab): ParamFamily[] {
  return tab === 'parametric' ? PARAM_FAMILIES : POLAR_FAMILIES
}

export function blankMotionDraft(tab: MotionTab = 'parametric'): MotionDraft {
  return {
    tab,
    paramFamily: PARAM_FAMILIES[0]?.id ?? CUSTOM,
    polarFamily: POLAR_FAMILIES[0]?.id ?? CUSTOM,
    values: {},
    intervals: {},
    customX: '2cos(t)',
    customY: '3sin(t)',
    customR: '2cos(3θ)',
  }
}

/** The chosen family on the draft's tab, or null for Custom. */
export function draftFamily(d: MotionDraft): ParamFamily | null {
  const id = d.tab === 'parametric' ? d.paramFamily : d.polarFamily
  if (id === CUSTOM) return null
  return familiesOf(d.tab).find((f) => f.id === id) ?? null
}

/** The key the draft's interval is stored under. */
export function intervalKey(d: MotionDraft): string {
  const fam = draftFamily(d)
  return fam ? fam.id : `${CUSTOM}:${d.tab}`
}

/** The family's fields with the draft's text over the defaults. */
export function familyValues(d: MotionDraft, fam: ParamFamily): Record<string, string> {
  const out: Record<string, string> = {}
  const mine = d.values[fam.id] ?? {}
  for (const p of fam.params) out[p.name] = mine[p.name] ?? p.value
  return out
}

/** The draft's interval as text: stored, else the family's default, else [0, 2π]. */
export function draftInterval(d: MotionDraft): [string, string] {
  const stored = d.intervals[intervalKey(d)]
  if (stored) return stored
  const fam = draftFamily(d)
  if (fam) return fam.interval
  return ['0', '2pi']
}

/** One draft field's text changed. */
export function setDraftValue(d: MotionDraft, fam: ParamFamily, name: string, text: string): MotionDraft {
  return { ...d, values: { ...d.values, [fam.id]: { ...(d.values[fam.id] ?? {}), [name]: text } } }
}

export function setDraftInterval(d: MotionDraft, end: 0 | 1, text: string): MotionDraft {
  const cur = draftInterval(d)
  const next: [string, string] = end === 0 ? [text, cur[1]] : [cur[0], text]
  return { ...d, intervals: { ...d.intervals, [intervalKey(d)]: next } }
}

/**
 * A Custom parametric line: `x = x(t), y = y(t) {a <= t <= b}` — the
 * two-equation spelling, never the bare pair, which the shape reader could
 * take for a point.
 */
export function customParamSource(x: string, y: string, lo: string, hi: string): string | null {
  if (x.trim() === '' || y.trim() === '') return null
  return `x = ${x.trim()}, y = ${y.trim()} ${intervalCondition('parametric', lo, hi)}`
}

/** Split `(a, b)` at its top-level comma: the two coordinates, or null. */
function pairParts(src: string): [string, string] | null {
  const m = /^\s*\((.*)\)\s*$/.exec(src)
  if (!m) return null
  const body = m[1]
  let depth = 0
  let at = -1
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') {
      depth--
      if (depth < 0) return null
    } else if (c === ',' && depth === 0) {
      if (at >= 0) return null
      at = i
    }
  }
  if (at < 0 || depth !== 0) return null
  return [body.slice(0, at), body.slice(at + 1)]
}

const HAS_T = /(^|[^A-Za-z])t([^A-Za-z]|$)/

/**
 * A bare ordered pair that is a parametric CURVE, not a point: both
 * coordinates are formulas in t — (2cos(t), 3sin(t)), (t, t^2). A pair with t
 * in only one place, (t, 1), stays the point it has always been (a slider t).
 */
export function isParametricPair(src: string): boolean {
  const parts = pairParts(src)
  return parts !== null && HAS_T.test(parts[0]) && HAS_T.test(parts[1])
}

/** A Custom polar line: `r = r(θ) {a <= θ <= b}`. */
export function customPolarSource(r: string, lo: string, hi: string): string | null {
  if (r.trim() === '') return null
  return `r = ${r.trim()} ${intervalCondition('polar', lo, hi)}`
}

/** The typed line the draft stands for, or a refusal in words. */
export function draftSource(d: MotionDraft): { src: string | null; error: string | null } {
  const [lo, hi] = draftInterval(d)
  const kind: MotionKind = d.tab
  const iv = readIntervalEdit(lo, hi, kind)
  if ('error' in iv) return { src: null, error: iv.error }
  const fam = draftFamily(d)
  if (!fam) {
    const src =
      d.tab === 'parametric' ? customParamSource(d.customX, d.customY, lo, hi) : customPolarSource(d.customR, lo, hi)
    return src ? { src, error: null } : { src: null, error: null }
  }
  const values = familyValues(d, fam)
  for (const p of fam.params) {
    if (values[p.name].trim() === '') return { src: null, error: `${p.label} is empty.` }
  }
  try {
    const src = familySource(fam, values, [iv.lo, iv.hi])
    return src ? { src, error: null } : { src: null, error: null }
  } catch (err) {
    return { src: null, error: err instanceof Error ? err.message : 'This curve could not be written out.' }
  }
}

// ---------------------------------------------------------------------------
// a line, read: its curve, its KaTeX, its features
// ---------------------------------------------------------------------------

const PREVIEW_ID = 'expr_motion_preview'

/** A typed line as a curve the calculus can read (the builder's preview, the tests). */
export function curveFromSource(
  src: string,
): { curve: FittedCurve; models: Record<string, ModelSpec>; latex: string } | { error: string } {
  let o: ReturnType<typeof parseExpression>
  try {
    o = parseExpression(src)
  } catch {
    return { error: 'The parser crashed on this curve.' }
  }
  if (!o.ok) return { error: o.error }
  const spec = o.plot.makeModel(PREVIEW_ID)
  const curve: FittedCurve = {
    id: 'motion-preview',
    modelId: PREVIEW_ID,
    params: o.plot.defaultParams.slice(),
    kind: o.plot.kind,
    domain: o.plot.domain,
    color: '#4f9cf9',
    strokeWidth: 2.5,
    visible: true,
    error: 0,
  }
  return { curve, models: { [PREVIEW_ID]: spec }, latex: o.plot.latex }
}

/** paramFeatures that never throws. */
export function safeFeatures(curve: FittedCurve, models: Record<string, ModelSpec>): ParamFeatures | null {
  try {
    return paramFeatures(curve, models)
  } catch {
    return null
  }
}

/** paramState that never throws and never hands back a non-finite position. */
export function safeState(curve: FittedCurve, models: Record<string, ModelSpec>, t: number): ParamState | null {
  try {
    const s = paramState(curve, models, t)
    if (!s || !Number.isFinite(s.pos.x) || !Number.isFinite(s.pos.y)) return null
    return s
  } catch {
    return null
  }
}

/** describePolar that never throws. */
export function safeDescribePolar(src: string | undefined): string | null {
  if (!src) return null
  try {
    return describePolar(src)
  } catch {
    return null
  }
}

export interface MotionPreview {
  src: string | null
  latex: string | null
  kind: MotionKind | null
  /** The polar sentence: "a rose with 3 petals of length 2". */
  describe: string | null
  sentences: string[]
  error: string | null
}

/** Everything the builder shows under its fields. */
export function motionPreview(src: string | null, tab: MotionTab, error: string | null = null): MotionPreview {
  const none: MotionPreview = { src: null, latex: null, kind: null, describe: null, sentences: [], error }
  if (!src) return none
  const read = curveFromSource(src)
  if ('error' in read) return { ...none, error: read.error }
  const kind = motionKindOf(read.curve, read.models)
  if (kind !== tab) {
    return {
      ...none,
      error:
        tab === 'parametric'
          ? 'That is not a parametric curve — write x(t) and y(t) in t.'
          : 'That is not a polar curve — write r as a formula in θ.',
    }
  }
  const f = safeFeatures(read.curve, read.models)
  return {
    src,
    latex: read.latex,
    kind,
    describe: tab === 'polar' ? safeDescribePolar(src) : null,
    sentences: f ? f.sentences.filter((s) => s.trim() !== '') : [],
    error,
  }
}

// ---------------------------------------------------------------------------
// the features, as rows and as board marks
// ---------------------------------------------------------------------------

/** "(2, 0) at t = 0" — a labelled point as the card prints it. */
export function labeledText(p: Labeled, v: string): string {
  return `(${p.xText}, ${p.yText}) at ${v} = ${p.tText}`
}

/**
 * How many times the path retraces itself over the interval: 2 for
 * r = 2cos(3θ) on [0, 2π] (its period is π), 1 when it does not. The area
 * ½∫r²dθ over the whole interval counts each trace.
 */
export function retraceCount(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  interval: [number, number] = motionInterval(curve),
): number {
  const [a, b] = interval
  let ext = 0
  const probe: Vec2[] = []
  for (let i = 0; i <= 64; i++) {
    const p = posAt(curve, models, a + ((b - a) * i) / 64)
    if (p) {
      probe.push(p)
      ext = Math.max(ext, Math.abs(p.x), Math.abs(p.y))
    }
  }
  if (probe.length < 8 || !(ext > 0)) return 1
  const tol = 1e-6 * ext
  for (let n = 6; n >= 2; n--) {
    const T = (b - a) / n
    let ok = true
    for (let i = 0; i < 48 && ok; i++) {
      const t = a + ((b - a - T) * (i + 0.37)) / 48
      const p = posAt(curve, models, t)
      const q = posAt(curve, models, t + T)
      if (!p || !q) continue
      if (Math.hypot(p.x - q.x, p.y - q.y) > tol) ok = false
    }
    if (ok) return n
  }
  return 1
}

/** A mark on the board for each feature — the analysis path's rings and exact chips. */
export function motionMarks(f: ParamFeatures, kind: MotionKind): SpecialPoint[] {
  const out: SpecialPoint[] = []
  const add = (p: Labeled | null, label: string): void => {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return
    out.push({
      kind: 'extreme',
      pos: { x: p.x, y: p.y },
      label,
      exactX: p.xText,
      exactY: p.yText,
      exact: true,
    })
  }
  const v = VAR_OF[kind]
  for (const p of f.horizontalTangents) add(p, `horizontal tangent (${v} = ${p.tText})`)
  for (const p of f.verticalTangents) add(p, `vertical tangent (${v} = ${p.tText})`)
  for (const p of f.singular) add(p, `singular point (${v} = ${p.tText})`)
  if (kind === 'polar') for (const p of f.atPole) add(p, `at the pole (θ = ${p.tText})`)
  add(f.start, `start (${v} = ${f.start?.tText ?? ''})`)
  return out
}

// ---------------------------------------------------------------------------
// the particle
// ---------------------------------------------------------------------------

export type MotionSpeed = 0.5 | 1 | 2
export const SPEEDS: MotionSpeed[] = [0.5, 1, 2]

/**
 * How far t runs per second at 1×: t IS time, so one unit per second — unless
 * the interval is long, when a full run takes 12 s.
 */
export function tRate(interval: [number, number]): number {
  const span = interval[1] - interval[0]
  return span <= 12 ? 1 : span / 12
}

/** t after `dt` seconds of play at `speed`; past the end it starts over. */
export function advanceT(t: number, dt: number, speed: number, interval: [number, number]): number {
  const [a, b] = interval
  const span = b - a
  if (!(span > 0)) return a
  let next = t + dt * speed * tRate(interval)
  if (next > b) next = a + ((next - a) % span)
  if (next < a) next = a
  return next
}

/** Keep t inside the interval. */
export function clampT(t: number, interval: [number, number]): number {
  if (!Number.isFinite(t)) return interval[0]
  return Math.min(interval[1], Math.max(interval[0], t))
}

/** The t whose point is nearest `to` (a dragged particle). */
export function nearestT(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  interval: [number, number],
  to: Vec2,
): number {
  const [a, b] = interval
  const n = 600
  let best = Infinity
  let bt = a
  for (let i = 0; i <= n; i++) {
    const t = a + ((b - a) * i) / n
    const p = posAt(curve, models, t)
    if (!p) continue
    const d = (p.x - to.x) ** 2 + (p.y - to.y) ** 2
    if (d < best) {
      best = d
      bt = t
    }
  }
  // refine on the neighbouring steps
  const h = (b - a) / n
  let lo = Math.max(a, bt - h)
  let hi = Math.min(b, bt + h)
  const dist = (t: number): number => {
    const p = posAt(curve, models, t)
    return p ? (p.x - to.x) ** 2 + (p.y - to.y) ** 2 : Infinity
  }
  const g = (Math.sqrt(5) - 1) / 2
  for (let k = 0; k < 40; k++) {
    const m1 = hi - g * (hi - lo)
    const m2 = lo + g * (hi - lo)
    if (dist(m1) <= dist(m2)) hi = m2
    else lo = m1
  }
  return (lo + hi) / 2
}

/** Nice multipliers a vector is drawn at, largest first. */
export const SCALE_LADDER = [10, 5, 2, 1, 0.5, 0.25, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001]

/**
 * The multiplier a vector is drawn at so its LONGEST (over the interval) is
 * at most `capPx` on screen: ×1 whenever that fits and is not too small to
 * read, else the largest ladder step that fits (or the smallest step that
 * makes a tiny one readable). `maxPx` is the longest at ×1, in px.
 */
export function vectorScale(maxPx: number, capPx: number): number {
  if (!(maxPx > 0) || !(capPx > 0)) return 1
  if (maxPx <= capPx && maxPx >= capPx / 8) return 1
  for (const s of SCALE_LADDER) if (maxPx * s <= capPx) return s
  return SCALE_LADDER[SCALE_LADDER.length - 1]
}

/** "×0.5", "×1", "×2". */
export function scaleText(s: number): string {
  return `×${num(s)}`
}

/** The on-screen length cap: a quarter of the board's smaller side, in px. */
export function capPx(widthPx: number, heightPx: number): number {
  return Math.max(24, Math.min(widthPx, heightPx) / 4)
}

export interface PxFrame {
  /** px per unit along x and y */
  ppx: number
  ppy: number
  widthPx: number
  heightPx: number
}

/** Length of a math vector on screen. */
export function pxLength(v: Vec2, fr: PxFrame): number {
  return Math.hypot(v.x * fr.ppx, v.y * fr.ppy)
}

/** The longest velocity and acceleration over the interval, in px at ×1. */
export function maxVectorPx(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  interval: [number, number],
  fr: PxFrame,
): { velocity: number; acceleration: number } {
  const [a, b] = interval
  const n = 120
  let mv = 0
  let ma = 0
  for (let i = 0; i <= n; i++) {
    const s = safeState(curve, models, a + ((b - a) * i) / n)
    if (!s) continue
    const lv = pxLength(s.velocity, fr)
    const la = pxLength(s.acceleration, fr)
    if (Number.isFinite(lv)) mv = Math.max(mv, lv)
    if (Number.isFinite(la)) ma = Math.max(ma, la)
  }
  return { velocity: mv, acceleration: ma }
}

/** A math vector drawn at `scale`, shortened (direction kept) to at most `cap` px. */
export function drawnVector(v: Vec2, scale: number, fr: PxFrame, cap: number): Vec2 {
  const s = { x: v.x * scale, y: v.y * scale }
  const len = pxLength(s, fr)
  if (!Number.isFinite(len) || len <= cap || len === 0) return s
  const k = cap / len
  return { x: s.x * k, y: s.y * k }
}

export interface MotionScales {
  velocity: number
  acceleration: number
}

/** The scales for a curve on this board. */
export function motionScales(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  interval: [number, number],
  fr: PxFrame,
): MotionScales {
  const cap = capPx(fr.widthPx, fr.heightPx)
  const m = maxVectorPx(curve, models, interval, fr)
  return { velocity: vectorScale(m.velocity, cap), acceleration: vectorScale(m.acceleration, cap) }
}

/** Colours the vectors are drawn in: velocity in the curve's colour, acceleration a warm contrast. */
export const ACCEL_COLOR = '#f5a524'

/**
 * The particle and its vectors as scene shapes: a filled dot at the
 * position, the velocity arrow from it (label v), the acceleration arrow
 * when asked (label a). Each at its stated scale, none longer than the cap.
 */
export function particleShapes(
  s: ParamState,
  opts: {
    color: string
    idBase: string
    fr: PxFrame
    scales: MotionScales
    accel: boolean
  },
): Shape[] {
  const cap = capPx(opts.fr.widthPx, opts.fr.heightPx)
  const out: Shape[] = []
  const v = drawnVector(s.velocity, opts.scales.velocity, opts.fr, cap)
  if (Number.isFinite(v.x) && Number.isFinite(v.y) && pxLength(v, opts.fr) > 0.5) {
    out.push({ kind: 'vector', id: `${opts.idBase}:velocity`, tail: s.pos, v, color: opts.color, visible: true, label: 'v' })
  }
  if (opts.accel) {
    const a = drawnVector(s.acceleration, opts.scales.acceleration, opts.fr, cap)
    if (Number.isFinite(a.x) && Number.isFinite(a.y) && pxLength(a, opts.fr) > 0.5) {
      out.push({ kind: 'vector', id: `${opts.idBase}:acceleration`, tail: s.pos, v: a, color: ACCEL_COLOR, visible: true, label: 'a' })
    }
  }
  // the dot last, so it sits on the vectors' tails
  out.push({ kind: 'point', id: `${opts.idBase}:particle`, at: s.pos, color: opts.color, visible: true })
  return out
}

export const RAY_DASH = [5, 5]

/** The dashed ray from the pole to a polar curve's point. */
export function poleRay(s: ParamState, color: string, id: string): Polyline | null {
  if (!Number.isFinite(s.pos.x) || !Number.isFinite(s.pos.y)) return null
  if (Math.hypot(s.pos.x, s.pos.y) < 1e-12) return null
  return { id, pts: [{ x: 0, y: 0 }, { x: s.pos.x, y: s.pos.y }], color, width: 1.25, dash: RAY_DASH }
}

/** The parameters the direction arrowheads sit at: n evenly spaced, clear of the ends. */
export function directionArrowTs(interval: [number, number], n = 4): number[] {
  const [a, b] = interval
  const k = Math.max(3, Math.min(5, Math.round(n)))
  const out: number[] = []
  for (let i = 0; i < k; i++) out.push(a + ((b - a) * (i + 0.5)) / k)
  return out
}

/** How long a direction arrow is on screen: just its head. */
export const ARROW_PX = 11

/**
 * Small arrowheads along the curve in the direction of motion, as vector
 * shapes along the tangent centred on the curve (a polyline has no head).
 * None where the particle is at rest.
 */
export function directionArrows(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  opts: { interval?: [number, number]; fr: PxFrame; color: string; idBase: string; n?: number },
): Shape[] {
  const interval = opts.interval ?? motionInterval(curve)
  const out: Shape[] = []
  directionArrowTs(interval, opts.n ?? 4).forEach((t, i) => {
    const s = safeState(curve, models, t)
    if (!s) return
    // the direction on SCREEN (per-axis scales), then back to math units
    const sx = s.velocity.x * opts.fr.ppx
    const sy = s.velocity.y * opts.fr.ppy
    const len = Math.hypot(sx, sy)
    if (!(len > 1e-9) || !Number.isFinite(len)) return
    const v = { x: ((sx / len) * ARROW_PX) / opts.fr.ppx, y: ((sy / len) * ARROW_PX) / opts.fr.ppy }
    out.push({
      kind: 'vector',
      id: `${opts.idBase}:${i}`,
      tail: { x: s.pos.x - v.x / 2, y: s.pos.y - v.y / 2 },
      v,
      color: opts.color,
      visible: true,
    })
  })
  return out
}

// ---------------------------------------------------------------------------
// the readouts under the slider
// ---------------------------------------------------------------------------

export interface Readout {
  key: string
  label: string
  value: string
}

/** t = 1.25, (x, y), velocity, speed, dy/dx (or vertical tangent), and for polar r, dr/dθ. */
export function motionReadouts(s: ParamState | null, kind: MotionKind): Readout[] {
  if (!s) return []
  const v = VAR_OF[kind]
  const rows: Readout[] = [
    { key: 't', label: `${v} =`, value: num(s.t) },
    { key: 'pos', label: '(x, y) =', value: `(${num(s.pos.x)}, ${num(s.pos.y)})` },
  ]
  if (kind === 'polar') {
    if (s.r !== undefined) rows.push({ key: 'r', label: 'r =', value: num(s.r) })
    if (s.drdt !== undefined) rows.push({ key: 'drdt', label: 'dr/dθ =', value: num(s.drdt) })
  }
  rows.push(
    { key: 'velocity', label: 'velocity', value: `⟨${num(s.velocity.x)}, ${num(s.velocity.y)}⟩` },
    { key: 'speed', label: 'speed', value: num(s.speed) },
  )
  const still = s.speed < 1e-9
  rows.push({
    key: 'slope',
    label: 'dy/dx =',
    value: s.slope !== null && Number.isFinite(s.slope) ? num(s.slope) : still ? 'undefined (at rest)' : 'vertical tangent',
  })
  return rows
}

// ---------------------------------------------------------------------------
// polar area
// ---------------------------------------------------------------------------

/**
 * The θ where r = 0 on the interval (sign changes and touch-zeros of r),
 * ends included when r is 0 there.
 */
export function poleThetas(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  interval: [number, number] = motionInterval(curve),
): number[] {
  const [a, b] = interval
  const n = 1440
  const h = (b - a) / n
  let ext = 0
  const rs: number[] = []
  for (let i = 0; i <= n; i++) {
    const r = rAt(curve, models, a + h * i)
    rs.push(r)
    if (Number.isFinite(r)) ext = Math.max(ext, Math.abs(r))
  }
  if (!(ext > 0)) return []
  const tol = 1e-9 * ext
  const out: number[] = []
  const push = (t: number): void => {
    if (!out.some((u) => Math.abs(u - t) < h * 1.5)) out.push(t)
  }
  const bisect = (lo: number, hi: number): number => {
    let rl = rAt(curve, models, lo)
    for (let k = 0; k < 80; k++) {
      const m = (lo + hi) / 2
      const rm = rAt(curve, models, m)
      if (Math.sign(rm) === Math.sign(rl)) {
        lo = m
        rl = rm
      } else hi = m
    }
    return (lo + hi) / 2
  }
  for (let i = 0; i <= n; i++) {
    const r = rs[i]
    if (!Number.isFinite(r)) continue
    const t = a + h * i
    if (Math.abs(r) <= tol) {
      push(t)
      continue
    }
    if (i < n) {
      const r2 = rs[i + 1]
      if (Number.isFinite(r2) && Math.abs(r2) > tol && Math.sign(r) !== Math.sign(r2)) push(bisect(t, t + h))
    }
    // a touch-zero (a cardioid's cusp): a local minimum of |r| near 0
    if (i > 0 && i < n) {
      const l = Math.abs(rs[i - 1])
      const m = Math.abs(r)
      const rr = Math.abs(rs[i + 1])
      if (m <= l && m <= rr && m < 1e-3 * ext) {
        // refine |r| on the step pair
        let lo = t - h
        let hi = t + h
        const g = (Math.sqrt(5) - 1) / 2
        for (let k = 0; k < 60; k++) {
          const m1 = hi - g * (hi - lo)
          const m2 = lo + g * (hi - lo)
          if (Math.abs(rAt(curve, models, m1)) <= Math.abs(rAt(curve, models, m2))) hi = m2
          else lo = m1
        }
        const tz = (lo + hi) / 2
        if (Math.abs(rAt(curve, models, tz)) < 1e-6 * ext) push(tz)
      }
    }
  }
  return out.sort((p, q) => p - q)
}

/**
 * The default "shade area from θ = a to b": one petal (or loop) — the first
 * stretch between two consecutive zeros of r that is not the whole interval
 * — else one trace of the curve (the interval divided by how many times it
 * retraces).
 */
export function defaultAreaBounds(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  interval: [number, number] = motionInterval(curve),
): [number, number] {
  const [a, b] = interval
  const zs = poleThetas(curve, models, interval)
  for (let i = 0; i + 1 < zs.length; i++) {
    const lo = zs[i]
    const hi = zs[i + 1]
    if (hi - lo < 1e-6 * (b - a)) continue
    // a petal: r keeps one sign in between
    const mid = rAt(curve, models, (lo + hi) / 2)
    if (Number.isFinite(mid) && Math.abs(mid) > 0) return [lo, hi]
  }
  const n = retraceCount(curve, models, interval)
  return [a, a + (b - a) / n]
}

/** The region ½∫r²dθ measures, as a polygon: the pole, r(θ) from a to b, back to the pole. */
export function polarRegion(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  a: number,
  b: number,
  samples = 240,
): Vec2[] {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return []
  const out: Vec2[] = [{ x: 0, y: 0 }]
  for (let i = 0; i <= samples; i++) {
    const th = a + ((b - a) * i) / samples
    const r = rAt(curve, models, th)
    if (!Number.isFinite(r)) continue
    out.push({ x: r * Math.cos(th), y: r * Math.sin(th) })
  }
  out.push({ x: 0, y: 0 })
  return out.length > 3 ? out : []
}

/** polarArea that never throws. */
export function safePolarArea(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  a: number,
  b: number,
): { value: number; exact: boolean; text: string } | null {
  try {
    return polarArea(curve, models, a, b)
  } catch {
    return null
  }
}

/** The readout: "½∫ r² dθ = π/3 ≈ 1.047", or the decimal alone. */
export function polarAreaText(res: { value: number; exact: boolean; text: string } | null): string | null {
  if (!res || !Number.isFinite(res.value)) return null
  const dec = num(res.value)
  const text = res.text.trim()
  if (res.exact && text !== '' && text !== dec) return `½∫ r² dθ = ${text} ≈ ${dec}`
  return `½∫ r² dθ ≈ ${text !== '' ? text : dec}`
}

/** The area's two bounds from the card's fields, or a refusal. */
export function readAreaBounds(aText: string, bText: string): { a: number; b: number } | { error: string } {
  const a = evalText(textToSource(aText))
  const b = evalText(textToSource(bText))
  if (a === null) return { error: 'The first θ is not a number.' }
  if (b === null) return { error: 'The second θ is not a number.' }
  if (a === b) return { error: 'The two θ are the same: there is no area between them.' }
  if (Math.abs(b - a) > 1e3) return { error: 'That θ-range is too long.' }
  return { a: Math.min(a, b), b: Math.max(a, b) }
}

// ---------------------------------------------------------------------------
// the player's state (the App keeps one per curve, for the session)
// ---------------------------------------------------------------------------

export interface MotionAreaState {
  on: boolean
  /** The θ-bounds as typed ("π/6", "pi/2"). */
  a: string
  b: string
}

export interface MotionPlayState {
  t: number
  playing: boolean
  speed: MotionSpeed
  /** Draw the acceleration vector too. */
  accel: boolean
  /** The particle and its vectors go into the exported figure. */
  exportParticle: boolean
  /** Polar only: the shaded area ½∫r²dθ. */
  area: MotionAreaState | null
}

export function defaultPlay(interval: [number, number]): MotionPlayState {
  return { t: interval[0], playing: false, speed: 1, accel: false, exportParticle: false, area: null }
}

/** The area switch turned on: from the default bounds (one petal / one trace). */
export function defaultArea(curve: FittedCurve, models: Record<string, ModelSpec>): MotionAreaState {
  const [a, b] = defaultAreaBounds(curve, models)
  return { on: true, a: valueText(a), b: valueText(b) }
}

/** The shaded region and its readout for an area state, or null when off / unreadable. */
export function areaOverlayFor(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  area: MotionAreaState | null,
): { boundary: Vec2[]; a: number; b: number } | null {
  if (!area || !area.on) return null
  const r = readAreaBounds(area.a, area.b)
  if ('error' in r) return null
  const boundary = polarRegion(curve, models, r.a, r.b)
  return boundary.length > 0 ? { boundary, a: r.a, b: r.b } : null
}

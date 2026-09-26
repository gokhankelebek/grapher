// ============================================================================
// src/ui/transformLinks.ts — a curve read as a TRANSFORMED PARENT.
//
//     y = a·f(b(x − h)) + k
//
// src/core/transform.ts is the bridge: which parent a typed line comes from,
// the steps in textbook order, every parent key point and its image, the
// domain / range / asymptotes / anchor. Everything here sits on top of that
// bridge and is pure (no React, no DOM, no App state), mirroring sinLinks.ts:
//
//   * the draft of "Build ▾ → Transformation" — a parent picked from the
//     gallery and four texts a, b, h, k; picking another parent keeps them;
//   * the sliders beside those fields (a number in, a short text out);
//   * the preview: the line, its KaTeX, the numbered steps, the key-point
//     table "parent → image" and the features;
//   * one committed field edit on a card's Transformation section;
//   * the COEXISTENCE rule: when Roots / Exponential / Logarithmic /
//     Sinusoidal already speaks for the line, the Transformation section is
//     shown too, but collapsed, and the board keeps that family's handles;
//   * what the board shows while it is selected — the image key points (as
//     analysis marks), a faint dashed GHOST of the parent and thin arrows from
//     each parent key point to its image (screen only, never exported) — and
//     the two handles: the anchor (h and k together) and one other key point
//     (vertically a, sideways b);
//   * the gallery's thumbnails: a tiny scene of each parent for renderBoard.
//
// Every result is an ordinary typed curve. Nothing downstream knows.
// ============================================================================

import type { BoardScene } from './renderBoard'
import type { FittedCurve, ModelSpec, Polyline, SpecialPoint, Theme, Vec2 } from '../core/types'
import { CURVE_COLORS } from '../core/types'
import {
  PARENTS,
  describe as describeSteps,
  mapPoints,
  readTransform,
  transformFeatures,
  transformSource,
} from '../core/transform'
import type { ParentFn, ParentId, TransformFeatures, TransformSpec } from '../core/transform'
import { parseExpression } from '../core/parse'
import { evalText } from './factorLinks'
import type { FactoredSpec } from '../core/factored'
import { minus, numOut } from './expLinks'
import { xSource } from './sinLinks'

// ---------------------------------------------------------------------------
// the parent library, as the UI names it
// ---------------------------------------------------------------------------

/** The order of the gallery: the order a Math 3 / Precalculus course meets them. */
export const PARENT_IDS: readonly ParentId[] = PARENTS.map((p) => p.id)

const BY_ID = new Map<ParentId, ParentFn>(PARENTS.map((p) => [p.id, p]))

export function parentOf(id: ParentId): ParentFn {
  return BY_ID.get(id) ?? PARENTS[0]
}

/** The parent as a class writes it, in plain text: "y = x²", "y = √x". */
export const PARENT_TEXT: Record<ParentId, string> = {
  linear: 'y = x',
  quadratic: 'y = x²',
  cubic: 'y = x³',
  absolute: 'y = |x|',
  sqrt: 'y = √x',
  cbrt: 'y = ∛x',
  reciprocal: 'y = 1/x',
  reciprocal2: 'y = 1/x²',
  exp2: 'y = 2ˣ',
  expe: 'y = eˣ',
  log2: 'y = log₂ x',
  ln: 'y = ln x',
  sin: 'y = sin x',
  cos: 'y = cos x',
  tan: 'y = tan x',
  floor: 'y = ⌊x⌋',
}

/** The gallery tile's short name. */
export const PARENT_SHORT: Record<ParentId, string> = {
  linear: 'x',
  quadratic: 'x²',
  cubic: 'x³',
  absolute: '|x|',
  sqrt: '√x',
  cbrt: '∛x',
  reciprocal: '1/x',
  reciprocal2: '1/x²',
  exp2: '2ˣ',
  expe: 'eˣ',
  log2: 'log₂ x',
  ln: 'ln x',
  sin: 'sin x',
  cos: 'cos x',
  tan: 'tan x',
  floor: '⌊x⌋',
}

/** The parents themselves, as numbers (the core keeps its own private). */
const PARENT_F: Record<ParentId, (u: number) => number> = {
  linear: (u) => u,
  quadratic: (u) => u * u,
  cubic: (u) => u * u * u,
  absolute: Math.abs,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  reciprocal: (u) => 1 / u,
  reciprocal2: (u) => 1 / (u * u),
  exp2: (u) => Math.pow(2, u),
  expe: Math.exp,
  log2: Math.log2,
  ln: Math.log,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  floor: Math.floor,
}

export function parentAt(id: ParentId, u: number): number {
  return (PARENT_F[id] ?? PARENT_F.linear)(u)
}

/** f(−u) = f(u): a reflection across the y-axis does nothing to these. */
const EVEN: ReadonlySet<ParentId> = new Set<ParentId>(['quadratic', 'absolute', 'reciprocal2', 'cos'])

// ---------------------------------------------------------------------------
// numbers
// ---------------------------------------------------------------------------

export type TransformField = 'a' | 'b' | 'h' | 'k'

export interface TransformValues {
  a: number
  b: number
  h: number
  k: number
}

/** Every field evaluated, or null while one does not (or b is 0). */
export function transformValues(spec: TransformSpec): TransformValues | null {
  const a = evalText(spec.a || '1')
  const b = evalText(spec.b || '1')
  const h = evalText(spec.h || '0')
  const k = evalText(spec.k || '0')
  if (a === null || b === null || h === null || k === null) return null
  if (b === 0) return null
  return { a, b, h, k }
}

/** f(x) for a spec. */
export function transformEval(spec: TransformSpec, x: number): number {
  const v = transformValues(spec)
  if (!v) return NaN
  return v.a * parentAt(spec.parent, v.b * (x - v.h)) + v.k
}

export interface TransformProblem {
  field: TransformField
  message: string
}

/** Every field that stops the spec being a transformed parent. Empty = buildable. */
export function transformProblems(spec: TransformSpec): TransformProblem[] {
  const out: TransformProblem[] = []
  const num = (field: TransformField, text: string | undefined, what: string): number | null => {
    const t = (text ?? '').trim()
    const v = t === '' ? null : evalText(t)
    if (v === null) {
      out.push({
        field,
        message: t === '' ? `${what} is empty.` : `${what} “${t}” is not a number.`,
      })
    }
    return v
  }
  const a = num('a', spec.a, 'The vertical factor a')
  if (a === 0) out.push({ field: 'a', message: 'a can’t be 0 — that flattens the parent to the line y = k.' })
  const b = num('b', spec.b, 'The horizontal factor b')
  if (b === 0) out.push({ field: 'b', message: 'b can’t be 0 — f(0) is a constant, not a transformation.' })
  num('h', spec.h || '0', 'The horizontal shift h')
  num('k', spec.k || '0', 'The vertical shift k')
  return out
}

// ---------------------------------------------------------------------------
// the core, never throwing
// ---------------------------------------------------------------------------

export function safeReadTransform(src: string | undefined): TransformSpec | null {
  if (!src || !src.trim()) return null
  try {
    const s = readTransform(src)
    return s && transformProblems(s).length === 0 ? s : null
  } catch {
    return null
  }
}

export function safeTransformSource(spec: TransformSpec): string | null {
  if (transformProblems(spec).length > 0) return null
  try {
    return transformSource(spec)
  } catch {
    return null
  }
}

export function safeFeatures(spec: TransformSpec): TransformFeatures | null {
  if (transformProblems(spec).length > 0) return null
  try {
    return transformFeatures(spec)
  } catch {
    return null
  }
}

/** The steps as sentences, in the core's textbook order. */
export function stepSentences(spec: TransformSpec): string[] {
  if (transformProblems(spec).length > 0) return []
  try {
    return describeSteps(spec).map((s) => s.sentence)
  } catch {
    return []
  }
}

type Mapped = ReturnType<typeof mapPoints>[number]

function safeMap(spec: TransformSpec): Mapped[] {
  if (transformProblems(spec).length > 0) return []
  try {
    return mapPoints(spec)
  } catch {
    return []
  }
}

/** One row of the key-point table: parent point → its image. */
export interface PointRow {
  from: string
  to: string
  /** The parent's anchor (vertex, center …) — the row a class tracks first. */
  anchor: boolean
}

const pair = (t: [string, string]): string => `(${t[0]}, ${t[1]})`

function isAnchor(spec: TransformSpec, from: Vec2): boolean {
  const f = safeFeatures(spec)
  const d = parentOf(spec.parent)
  // The parent's own anchor, found among its key points by the image it has.
  if (!f?.anchor) return false
  const img = mapImage(spec, from)
  return (
    img !== null &&
    Math.abs(img.x - f.anchor.x) <= 1e-9 * Math.max(1, Math.abs(img.x)) &&
    Math.abs(img.y - f.anchor.y) <= 1e-9 * Math.max(1, Math.abs(img.y)) &&
    d.keyPoints.some((p) => p.x === from.x && p.y === from.y)
  )
}

/** (x/b + h, a·y + k) for one parent point. */
export function mapImage(spec: TransformSpec, p: Vec2): Vec2 | null {
  const v = transformValues(spec)
  if (!v) return null
  return { x: p.x / v.b + v.h, y: v.a * p.y + v.k }
}

export function pointRows(spec: TransformSpec): PointRow[] {
  return safeMap(spec).map((m) => ({
    from: pair(m.fromText),
    to: pair(m.toText),
    anchor: isAnchor(spec, m.from),
  }))
}

/** "domain: all real numbers", "range: y ≤ 1", "asymptotes: …", "vertex: (3, 1)". */
export function featureLines(spec: TransformSpec, f: TransformFeatures | null = safeFeatures(spec)): string[] {
  if (!f) return []
  const out: string[] = []
  if (f.domain) out.push(`domain: ${f.domain}`)
  if (f.range) out.push(`range: ${f.range}`)
  if (f.asymptotes) out.push(`asymptote${f.asymptotes.includes(',') ? 's' : ''}: ${f.asymptotes}`)
  if (f.anchor) out.push(`${f.anchor.name}: (${f.anchor.xText}, ${f.anchor.yText})`)
  return out
}

// ---------------------------------------------------------------------------
// the draft of "Build ▾ → Transformation"
// ---------------------------------------------------------------------------

export interface TransformDraft {
  parent: ParentId
  a: string
  b: string
  h: string
  k: string
}

/** y = x²: the parent a transformations unit starts from. */
export const DEFAULT_TRANSFORM: TransformDraft = { parent: 'quadratic', a: '1', b: '1', h: '0', k: '0' }

export function blankTransformDraft(): TransformDraft {
  return { ...DEFAULT_TRANSFORM }
}

/** Pick another parent: a, b, h, k stay exactly as they were typed. */
export function withParent(d: TransformDraft, parent: ParentId): TransformDraft {
  return d.parent === parent ? d : { ...d, parent }
}

export interface TransformSpecResult {
  spec: TransformSpec | null
  error: string | null
}

export function specFromDraft(d: TransformDraft): TransformSpecResult {
  const spec: TransformSpec = {
    parent: d.parent,
    a: d.a.trim(),
    b: d.b.trim(),
    h: d.h.trim() || '0',
    k: d.k.trim() || '0',
  }
  const p = transformProblems(spec)
  return p.length > 0 ? { spec: null, error: p[0].message } : { spec, error: null }
}

// ---------------------------------------------------------------------------
// sliders beside the fields
// ---------------------------------------------------------------------------

export interface SliderRange {
  min: number
  max: number
  step: number
}

/** a and b are factors (−5 … 5), h and k are shifts (−10 … 10). */
export const SLIDER: Record<TransformField, SliderRange> = {
  a: { min: -5, max: 5, step: 0.1 },
  b: { min: -5, max: 5, step: 0.1 },
  h: { min: -10, max: 10, step: 0.5 },
  k: { min: -10, max: 10, step: 0.5 },
}

/** Where a field's text puts its slider (clamped; the default when it is no number). */
export function sliderValue(field: TransformField, text: string): number {
  const r = SLIDER[field]
  const dflt = field === 'a' || field === 'b' ? 1 : 0
  const t = text.trim()
  const v = t === '' ? dflt : evalText(t)
  if (v === null) return dflt
  return Math.min(r.max, Math.max(r.min, v))
}

/** A slider's number as the field's text: on its own step, never 0.30000000000000004. */
export function sliderText(field: TransformField, v: number): string {
  const step = SLIDER[field].step
  const on = Math.round(v / step) * step
  const clean = Math.round(on * 1e6) / 1e6
  return clean === 0 ? '0' : String(clean)
}

// ---------------------------------------------------------------------------
// the preview
// ---------------------------------------------------------------------------

export interface TransformPreview {
  src: string | null
  latex: string | null
  steps: string[]
  rows: PointRow[]
  features: string[]
  error: string | null
}

export function transformPreview(spec: TransformSpec | null, error: string | null = null): TransformPreview {
  const none: TransformPreview = { src: null, latex: null, steps: [], rows: [], features: [], error }
  if (!spec) return none
  const src = safeTransformSource(spec)
  if (!src) {
    const p = transformProblems(spec)
    return { ...none, error: p[0]?.message ?? 'This transformation could not be written out.' }
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
    steps: stepSentences(spec),
    rows: pointRows(spec),
    features: featureLines(spec),
    error: err,
  }
}

// ---------------------------------------------------------------------------
// one committed edit on a card
// ---------------------------------------------------------------------------

export const TRANSFORM_FIELD_LABEL: Record<TransformField, string> = {
  a: 'set vertical factor',
  b: 'set horizontal factor',
  h: 'set horizontal shift',
  k: 'set vertical shift',
}

/** The spec with one field retyped. */
export function setTransformField(spec: TransformSpec, field: TransformField, text: string): TransformSpec {
  return { ...spec, [field]: text.trim() }
}

export interface TransformCommitDeps {
  restate(src: string, label: string): string | null
}

/** Apply an edit and restate. The refusal, or null. */
export function commitTransformSpec(
  spec: TransformSpec,
  next: TransformSpec | null,
  label: string,
  deps: TransformCommitDeps,
): string | null {
  if (!next) return 'That can’t be written as this transformation.'
  const p = transformProblems(next)
  if (p.length > 0) return p[0].message
  const src = safeTransformSource(next)
  if (!src) return 'This transformation could not be written out.'
  const before = safeTransformSource(spec)
  if (src === before) return null
  return deps.restate(src, label)
}

// ---------------------------------------------------------------------------
// coexistence with the other family sections
// ---------------------------------------------------------------------------

/** What the card's other sections already make of the same line. */
export interface OtherReadings {
  factored: FactoredSpec | null
  exponential: boolean
  logarithmic: boolean
  sinusoidal: boolean
}

/**
 * Whether the Transformation section opens by itself (and the board shows
 * the parent's ghost, its arrows and the transformation handles).
 *
 * Collapsed — shown, one click away — when another reading is the one the
 * teacher most likely typed:
 *   * the Exponential, Logarithmic or Sinusoidal section applies (2^(x−1)+3
 *     is an exponential first; both readings are wanted, so both are there);
 *   * the Roots section applies with TWO OR MORE distinct factors —
 *     (x − 2)(x − 4) is about its roots, its vertex form is the second
 *     reading. A single factor (x², (x − 1)³, 1/x, 1/(x − 2)²) says nothing a
 *     transformation does not say better, so it does not count;
 *   * the parent is the LINE: y = 2x + 3 is slope-intercept first, and its
 *     transformation is not unique.
 * Open otherwise: x², |x|, √x, ∛x, 1/x, 1/x², x³, ⌊x⌋, tan x and every
 * shift, stretch and reflection of them.
 */
export function transformOpenByDefault(spec: TransformSpec, others: OtherReadings): boolean {
  if (spec.parent === 'linear') return false
  if (others.exponential || others.logarithmic || others.sinusoidal) return false
  const f = others.factored
  if (f && f.num.length + f.den.length >= 2) return false
  return true
}

/** Whether the board's transformation HANDLES belong to this line (no other family's). */
export function transformOwnsHandles(others: OtherReadings): boolean {
  return !others.factored && !others.exponential && !others.logarithmic && !others.sinusoidal
}

// ---------------------------------------------------------------------------
// what the board shows while it is selected
// ---------------------------------------------------------------------------

/** The anchor's mark: what the key point IS, where the parent says so. */
function anchorKind(spec: TransformSpec, v: TransformValues): SpecialPoint['kind'] {
  switch (spec.parent) {
    case 'quadratic':
    case 'absolute':
      return v.a > 0 ? 'minimum' : 'maximum'
    case 'cubic':
    case 'cbrt':
    case 'tan':
      return 'inflection'
    default:
      return 'extreme'
  }
}

/**
 * The image of every parent key point, as analysis marks — the ring and the
 * exact-text chip ("(1, −7)") the board already draws for a special point.
 * The anchor is named ("vertex"); the rest are "key point".
 */
export function transformKeyMarks(spec: TransformSpec): SpecialPoint[] {
  const v = transformValues(spec)
  const f = safeFeatures(spec)
  if (!v) return []
  const out: SpecialPoint[] = []
  for (const m of safeMap(spec)) {
    if (!Number.isFinite(m.to.x) || !Number.isFinite(m.to.y)) continue
    const anchor =
      f?.anchor !== null &&
      f?.anchor !== undefined &&
      Math.abs(m.to.x - f.anchor.x) <= 1e-9 * Math.max(1, Math.abs(m.to.x)) &&
      Math.abs(m.to.y - f.anchor.y) <= 1e-9 * Math.max(1, Math.abs(m.to.y))
    out.push({
      kind: anchor ? anchorKind(spec, v) : 'extreme',
      pos: { x: m.to.x, y: m.to.y },
      label: anchor && f?.anchor ? f.anchor.name : 'key point',
      exactX: m.toText[0],
      exactY: m.toText[1],
      exact: true,
    })
  }
  return out
}

/** A neutral ink for the ghost and the arrows, readable on either ground. */
export function ghostInk(dark: boolean): { ghost: string; arrow: string } {
  return dark
    ? { ghost: 'rgba(200, 206, 222, 0.42)', arrow: 'rgba(200, 206, 222, 0.7)' }
    : { ghost: 'rgba(60, 68, 88, 0.38)', arrow: 'rgba(60, 68, 88, 0.6)' }
}

export const GHOST_DASH = [5, 5]

/** Where the parent jumps: a pole or a step. Two samples on different branches are not joined. */
function branch(id: ParentId, u: number): number {
  switch (id) {
    case 'reciprocal':
    case 'reciprocal2':
      return u < 0 ? -1 : u > 0 ? 1 : 0
    case 'tan':
      return Math.floor((u + Math.PI / 2) / Math.PI)
    default:
      return 0
  }
}

const GAP: Vec2 = { x: NaN, y: NaN }

/**
 * The PARENT y = f(x) sampled across `span` (the view, padded) as one dashed
 * polyline: the pen lifts across a pole (1/x, 1/x², tan x) and between the
 * steps of ⌊x⌋, and outside a domain (√x, logs) the samples are not numbers
 * and lift it by themselves.
 */
export function parentGhost(
  parent: ParentId,
  span: readonly [number, number],
  color: string,
  id: string,
  samples = 480,
): Polyline {
  const lo = Math.min(span[0], span[1])
  const hi = Math.max(span[0], span[1])
  const pts: Vec2[] = []
  if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) {
    if (parent === 'floor') {
      // Exact steps: [n, n + 1) at height n, a gap between them.
      const first = Math.floor(lo)
      const last = Math.ceil(hi)
      if (last - first <= 4000) {
        for (let n = first; n < last; n++) {
          pts.push({ x: n, y: n }, { x: n + 1, y: n }, GAP)
        }
      }
    } else {
      const n = Math.max(8, Math.floor(samples))
      const dx = (hi - lo) / n
      let prev: number | null = null
      for (let i = 0; i <= n; i++) {
        const x = lo + i * dx
        const br = branch(parent, x)
        if (prev !== null && br !== prev) pts.push(GAP)
        prev = br
        const y = parentAt(parent, x)
        pts.push(Number.isFinite(y) ? { x, y } : GAP)
      }
    }
  }
  return { id, pts, color, width: 1.5, dash: GHOST_DASH }
}

/** The screen scale the arrowheads are drawn at: px per unit along each axis. */
export interface ArrowFrame {
  ppx: number
  ppy: number
}

/** px: the head's length, its half-angle, and how far each end stays off its point. */
const HEAD_PX = 9
const HEAD_ANGLE = (26 * Math.PI) / 180
const START_GAP_PX = 4
const END_GAP_PX = 6
/** An arrow shorter than this on screen says nothing: the point hardly moved. */
const MIN_ARROW_PX = 14

/**
 * A thin arrow from each parent key point to its image. A Polyline has no
 * arrowhead, so each arrow IS its head: the shaft, a gap, then the two short
 * barbs meeting at the tip — computed in SCREEN pixels (so the head is the
 * same size at any zoom and on stretched axes) and handed back in math
 * coordinates. Both ends stop a few px short of their points so the ring on
 * the image stays readable. Points that barely move get no arrow.
 */
export function keyPointArrows(
  spec: TransformSpec,
  frame: ArrowFrame,
  color: string,
  idPrefix: string,
): Polyline[] {
  const { ppx, ppy } = frame
  if (!(ppx > 0) || !(ppy > 0)) return []
  const out: Polyline[] = []
  safeMap(spec).forEach((m, i) => {
    const sx = (m.to.x - m.from.x) * ppx
    const sy = (m.to.y - m.from.y) * ppy
    const len = Math.hypot(sx, sy)
    if (!Number.isFinite(len) || len < MIN_ARROW_PX) return
    const ux = sx / len
    const uy = sy / len
    // math ← screen offsets
    const at = (base: Vec2, dxPx: number, dyPx: number): Vec2 => ({
      x: base.x + dxPx / ppx,
      y: base.y + dyPx / ppy,
    })
    const tail = at(m.from, ux * START_GAP_PX, uy * START_GAP_PX)
    const tip = at(m.to, -ux * END_GAP_PX, -uy * END_GAP_PX)
    const barb = (sign: 1 | -1): Vec2 => {
      const c = Math.cos(HEAD_ANGLE)
      const s = Math.sin(HEAD_ANGLE) * sign
      // the reversed direction, rotated by ±HEAD_ANGLE
      const bx = -(ux * c - uy * s)
      const by = -(ux * s + uy * c)
      return at(tip, bx * HEAD_PX, by * HEAD_PX)
    }
    out.push({
      id: `${idPrefix}:${i}`,
      pts: [tail, tip, GAP, barb(1), tip, barb(-1)],
      color,
      width: 1.25,
    })
  })
  return out
}

// ---------------------------------------------------------------------------
// board handles
// ---------------------------------------------------------------------------

export type TransformHandleKind = 'anchor' | 'point'

export interface TransformHandle {
  which: TransformHandleKind
  pos: Vec2
  label: string
  /** The parent point this handle is the image of. */
  from: Vec2
}

/**
 * The parent point the second handle is the image of: to the right of the
 * anchor, off its level (so both a and b can be read off it), one unit right
 * when the table has that point — (1, 1) of x², (1, 2) of 2^x, (2, 1) of
 * log₂ x, (π/2, 1) of sin x, (π, −1) of cos x.
 */
export function handlePoint(parent: ParentId): Vec2 | null {
  const d = parentOf(parent)
  const an = anchorOfParent(parent)
  const cands = d.keyPoints.filter((p) => p.x > an.x && p.y !== an.y && p.y !== 0)
  if (cands.length === 0) return null
  const one = cands.find((p) => Math.abs(p.x - (an.x + 1)) < 1e-12)
  const pick = one ?? cands.reduce((m, p) => (p.x < m.x ? p : m))
  return { x: pick.x, y: pick.y }
}

/** The parent's own anchor: the preimage of transformFeatures' anchor under the identity. */
function anchorOfParent(parent: ParentId): Vec2 {
  try {
    const f = transformFeatures({ parent, a: '1', b: '1', h: '0', k: '0' })
    if (f.anchor) return { x: f.anchor.x, y: f.anchor.y }
  } catch {
    /* fall through */
  }
  return { x: 0, y: 0 }
}

function pt(x: number, y: number, xText?: string, yText?: string): string {
  return `(${xText ?? minus(numOut(x, 4))}, ${yText ?? minus(numOut(y, 4))})`
}

/**
 * The two things a teacher grabs:
 *   anchor — the image of the parent's anchor (the vertex of x², the center
 *            of 1/x, (0, 1) of 2^x …): drag it and the curve moves with it,
 *            h and k together. On a line it is the y-intercept, and moves k.
 *   point  — the image of one other key point (handlePoint): up/down sets a,
 *            sideways sets b, with the anchor held where it is. On a line,
 *            up/down only (the slope).
 */
export function transformHandles(spec: TransformSpec): TransformHandle[] {
  const v = transformValues(spec)
  const f = safeFeatures(spec)
  if (!v || !f?.anchor) return []
  const an = anchorOfParent(spec.parent)
  const line = spec.parent === 'linear'
  const out: TransformHandle[] = [
    {
      which: 'anchor',
      pos: { x: f.anchor.x, y: f.anchor.y },
      from: an,
      label: line
        ? `y-intercept ${pt(f.anchor.x, f.anchor.y, f.anchor.xText, f.anchor.yText)}`
        : `${f.anchor.name} ${pt(f.anchor.x, f.anchor.y, f.anchor.xText, f.anchor.yText)} · moves h and k`,
    },
  ]
  const p = handlePoint(spec.parent)
  if (p) {
    const m = safeMap(spec).find((r) => r.from.x === p.x && r.from.y === p.y)
    const img = m ? m.to : mapImage(spec, p)
    if (img && Number.isFinite(img.x) && Number.isFinite(img.y)) {
      out.push({
        which: 'point',
        pos: img,
        from: p,
        label: line
          ? `${pt(img.x, img.y, m?.toText[0], m?.toText[1])} · up/down: slope`
          : `${pt(img.x, img.y, m?.toText[0], m?.toText[1])} · up/down: a, sideways: b`,
      })
    }
  }
  return out
}

const near = (u: number, w: number): boolean => Math.abs(u - w) <= 1e-12 * Math.max(1, Math.abs(u), Math.abs(w))

/**
 * A handle dragged to `to` (already snapped), computed from the spec at the
 * press. A coordinate that did not move leaves its fields' TEXT untouched
 * (stickyX in the App makes "did not move" exact), so a vertical drag never
 * rewrites b or h and a sideways one never rewrites a or k.
 *
 *   anchor — the anchor goes where it is put: h = X − ax/b, k = Y − a·ay
 *            ((ax, ay) the parent's anchor; for most parents h = X, k = Y).
 *   point  — the anchor stays put and the key point goes where it is put:
 *            a = (Y − Ay)/(py − ay) (dragged past the anchor's level it
 *            reflects), b = (px − ax)/(X − Ax) (past the anchor sideways it
 *            reflects across the y-axis — not for an even parent, where that
 *            is the same curve, so |b|). k and h follow so the anchor holds.
 *
 * Null when that makes no transformation (a = 0, b = 0 or infinite).
 */
export function dragTransformHandle(
  spec: TransformSpec,
  which: TransformHandleKind,
  to: Vec2,
): TransformSpec | null {
  const v = transformValues(spec)
  if (!v || !Number.isFinite(to.x) || !Number.isFinite(to.y)) return null
  const an = anchorOfParent(spec.parent)
  const A = { x: an.x / v.b + v.h, y: v.a * an.y + v.k }
  const line = spec.parent === 'linear'
  if (which === 'anchor') {
    const next: TransformSpec = { ...spec }
    if (!line && !near(to.x, A.x)) next.h = xSource(to.x - an.x / v.b)
    if (!near(to.y, A.y)) next.k = numOut(to.y - v.a * an.y)
    return next
  }
  const p = handlePoint(spec.parent)
  if (!p) return null
  const P = { x: p.x / v.b + v.h, y: v.a * p.y + v.k }
  const next: TransformSpec = { ...spec }
  if (!near(to.y, P.y)) {
    const a = (to.y - A.y) / (p.y - an.y)
    if (!Number.isFinite(a) || Math.abs(a) < 1e-12) return null
    next.a = numOut(a)
    if (an.y !== 0) next.k = numOut(A.y - a * an.y)
  }
  if (!line && !near(to.x, P.x)) {
    let b = (p.x - an.x) / (to.x - A.x)
    if (!Number.isFinite(b) || Math.abs(b) < 1e-12) return null
    if (EVEN.has(spec.parent)) b = Math.abs(b)
    next.b = xSource(b)
    if (an.x !== 0) next.h = xSource(A.x - an.x / b)
  }
  return next
}

export const TRANSFORM_HANDLE_LABEL: Record<TransformHandleKind, string> = {
  anchor: 'move anchor',
  point: 'stretch by a key point',
}

/**
 * A pointer coordinate that has not really moved along an axis stays exactly
 * where it was (the same rule as sinLinks.stickyX, for either axis).
 */
export function sticky(raw: number, anchor: number, pxPerUnit: number, snapped: number): number {
  if (Number.isFinite(anchor) && Math.abs(raw - anchor) * pxPerUnit < 6) return anchor
  return snapped
}

// ---------------------------------------------------------------------------
// the gallery's thumbnails
// ---------------------------------------------------------------------------

/** The window a parent's thumbnail shows: its key points and the origin, padded. */
export function thumbWindow(parent: ParentId): { x: [number, number]; y: [number, number] } {
  if (parent === 'tan') return { x: [-3.4, 3.4], y: [-3, 3] }
  if (parent === 'sin' || parent === 'cos') return { x: [-1, 7.3], y: [-1.8, 1.8] }
  if (parent === 'reciprocal' || parent === 'reciprocal2') return { x: [-3, 3], y: parent === 'reciprocal' ? [-3, 3] : [-0.8, 4.2] }
  const d = parentOf(parent)
  const xs = [0, ...d.keyPoints.map((p) => p.x)]
  const ys = [0, ...d.keyPoints.map((p) => p.y)]
  const span = (vs: number[]): [number, number] => {
    let lo = Math.min(...vs)
    let hi = Math.max(...vs)
    if (hi - lo < 2.5) {
      const mid = (lo + hi) / 2
      lo = mid - 1.25
      hi = mid + 1.25
    }
    const pad = (hi - lo) * 0.18
    return [lo - pad, hi + pad]
  }
  return { x: span(xs), y: span(ys) }
}

const thumbCache = new Map<ParentId, { curve: FittedCurve; model: ModelSpec } | null>()

function thumbCurve(parent: ParentId): { curve: FittedCurve; model: ModelSpec } | null {
  if (thumbCache.has(parent)) return thumbCache.get(parent) ?? null
  let made: { curve: FittedCurve; model: ModelSpec } | null = null
  try {
    const o = parseExpression(`y = ${parentOf(parent).body}`)
    if (o.ok) {
      const modelId = `expr_parent_${parent}`
      made = {
        model: o.plot.makeModel(modelId),
        curve: {
          id: `parent-${parent}`,
          modelId,
          params: o.plot.defaultParams.slice(),
          kind: o.plot.kind,
          domain: o.plot.domain,
          color: CURVE_COLORS[0],
          strokeWidth: 2,
          visible: true,
          error: 0,
        },
      }
    }
  } catch {
    made = null
  }
  thumbCache.set(parent, made)
  return made
}

/**
 * The scene one gallery tile draws: the parent itself through the same
 * renderBoard the board and the export use, on the board's theme, framed on
 * its key points (axes stretched independently where that is what fits).
 */
export function parentThumbScene(parent: ParentId, theme: Theme, widthPx: number, heightPx: number): BoardScene {
  const win = thumbWindow(parent)
  const ppx = widthPx / (win.x[1] - win.x[0])
  const ppy = heightPx / (win.y[1] - win.y[0])
  const made = thumbCurve(parent)
  return {
    vp: {
      center: { x: (win.x[0] + win.x[1]) / 2, y: (win.y[0] + win.y[1]) / 2 },
      pxPerUnit: ppx,
      pxPerUnitY: ppy,
      widthPx,
      heightPx,
    },
    theme,
    curves: made ? [made.curve] : [],
    styles: {},
    models: made ? { [made.curve.modelId]: made.model } : {},
    chrome: null,
  }
}

// ============================================================================
// src/ui/conicLinks.ts — a conic section, edited the way it is STATED.
//
//   circle      (x − h)² + (y − k)² = r²
//   ellipse     (x − h)²/a² + (y − k)²/b² = 1
//   hyperbola   (x − h)²/a² − (y − k)²/b² = 1     or  (y − k)²/a² − (x − h)²/b² = 1
//   parabola    (x − h)² = 4p(y − k)              or  (y − k)² = 4p(x − h)
//
// src/core/conics.ts is the bridge between a typed line and the numbers a
// Math 3 / precalculus class states — center, vertices, foci, directrix,
// asymptotes — and it writes the line. Everything here sits on top of that
// bridge and is pure (no React, no DOM, no App state), mirroring sinLinks.ts:
//
//   * the six tabs of "Build ▾ → Conic" — Circle, Ellipse, Hyperbola,
//     Parabola, Foci (the locus definitions) and Equation (a pasted general
//     form, completed to standard form) — as field sets that each turn into
//     ONE ConicSpec or a refusal in words. Point fields take "(2, -1)" and
//     expressions ("(1 + sqrt(2), -3/2)").
//   * one committed field edit on a card's Conic section, and "write in
//     standard form" for a line typed in general form;
//   * what the board shows while it is selected — the center, vertices,
//     co-vertices and foci as analysis marks (exact text on the chip), the
//     foci named F₁, F₂ (labelled points), a parabola's directrix dashed, a
//     hyperbola's asymptotes dashed and its fundamental rectangle dotted —
//     and the handles: center, the ends of the two semi-axes, a focus;
//   * the note a SKETCHED circle or ellipse wears, and the line "Convert to
//     typed conic" replaces it with.
//
// Every result is an ordinary typed (implicit) curve. Nothing downstream knows.
// ============================================================================

import type { Polyline, Shape, SpecialPoint, Vec2 } from '../core/types'
import {
  classify,
  conicFeatures,
  conicFromCircle,
  conicFromEllipse,
  conicFromFoci,
  conicFromHyperbola,
  conicFromParabola,
  conicSource,
  readConic,
} from '../core/conics'
import type { Built, ConicClass, ConicFeatures, ConicKind, ConicSpec } from '../core/conics'
import { parseExpression } from '../core/parse'
import { evalText } from './factorLinks'
import { numOut } from './expLinks'

// ---------------------------------------------------------------------------
// numbers and points
// ---------------------------------------------------------------------------

/** Every numeric field of a spec, evaluated (NaN where a text does not). */
export interface ConicValues {
  h: number
  k: number
  a: number
  b: number
  p: number
  opens: 'x' | 'y'
}

const val = (t: string | undefined, dflt: string): number => evalText((t ?? '').trim() || dflt) ?? NaN

export function conicValues(spec: ConicSpec): ConicValues {
  const a = Math.abs(val(spec.a, '1'))
  return {
    h: val(spec.h, '0'),
    k: val(spec.k, '0'),
    a,
    b: spec.b !== undefined && spec.b.trim() !== '' ? Math.abs(val(spec.b, '1')) : a,
    p: val(spec.p ?? spec.a, '1'),
    opens: spec.opens ?? (spec.kind === 'parabola' ? 'y' : 'x'),
  }
}

/** Split "a, b" at the top-level comma (not one inside sqrt(…, …) or a call). */
function splitTop(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === ',' && depth === 0) {
      out.push(s.slice(start, i))
      start = i + 1
    }
  }
  out.push(s.slice(start))
  return out
}

/** Do the outer brackets of `s` enclose all of it? "(1, 2)" yes, "(1)+(2)" no. */
function wrapped(s: string): boolean {
  if (!/^[([]/.test(s) || !/[)\]]$/.test(s)) return false
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    if (depth === 0 && i < s.length - 1) return false
  }
  return depth === 0
}

export type PointRead = { pt: Vec2; error: null } | { pt: null; error: string }

/**
 * A point as a teacher types it: "(2, -1)", "2, -1", "(1 + sqrt(2), -3/2)",
 * with a Unicode minus or a full-width comma if it was pasted.
 */
export function parsePoint(text: string, what = 'point'): PointRead {
  let s = (text ?? '').trim().replace(/[−–]/g, '-').replace(/，/g, ',')
  if (s === '') return { pt: null, error: `The ${what} is empty.` }
  if (wrapped(s)) s = s.slice(1, -1).trim()
  const parts = splitTop(s)
  if (parts.length !== 2) return { pt: null, error: `Write the ${what} as (x, y) — “${text.trim()}” is not a point.` }
  const x = evalText(parts[0].trim())
  const y = evalText(parts[1].trim())
  if (x === null || y === null) {
    return { pt: null, error: `The ${what} “${text.trim()}” has a coordinate that is not a number.` }
  }
  return { pt: { x, y }, error: null }
}

/** A point field is red when it has text that is not a point. */
export function badPoint(text: string): boolean {
  return (text ?? '').trim() !== '' && parsePoint(text).pt === null
}

/** "(2, -1)" */
export function pointSource(p: Vec2): string {
  return `(${numOut(p.x)}, ${numOut(p.y)})`
}

/**
 * A length from its square, as source the core reads exactly: a perfect
 * square gives the number (sq = 6.25 → "2.5"), anything else √ of the square
 * (sq = 5 → "sqrt(5)", which conicSource squares back to exactly 5).
 */
export function lengthSource(sq: number): string | null {
  if (!Number.isFinite(sq) || !(sq > 0)) return null
  const r = Math.sqrt(sq)
  const rt = numOut(r)
  const back = evalText(rt)
  if (back !== null && Math.abs(back * back - sq) <= 1e-9 * Math.max(1, sq)) return rt
  return `sqrt(${numOut(sq)})`
}

/** Unicode for display: "-3" → "−3", "sqrt(5)" → "√5", "^2" → "²". */
export function prettyConic(src: string): string {
  return src
    .replace(/sqrt\(([^()]+)\)/g, (_m, inner: string) => (/^[\w.]+$/.test(inner) ? `√${inner}` : `√(${inner})`))
    .replace(/\^2/g, '²')
    .replace(/\*/g, '·')
    .replace(/-/g, '−')
}

// ---------------------------------------------------------------------------
// what is wrong
// ---------------------------------------------------------------------------

export type ConicField = 'h' | 'k' | 'a' | 'b' | 'p'

export interface ConicProblem {
  field: ConicField
  message: string
}

/** Every field that stops the spec being a conic. Empty = drawable. */
export function conicProblems(spec: ConicSpec): ConicProblem[] {
  const out: ConicProblem[] = []
  const num = (field: ConicField, text: string | undefined, what: string): number | null => {
    const t = (text ?? '').trim()
    const v = t === '' ? null : evalText(t)
    if (v === null) {
      out.push({ field, message: t === '' ? `The ${what} is empty.` : `The ${what} “${t}” is not a number.` })
    }
    return v
  }
  num('h', spec.h || '0', 'h')
  num('k', spec.k || '0', 'k')
  if (spec.kind === 'parabola') {
    const p = num('p', spec.p ?? spec.a, 'p')
    if (p === 0) out.push({ field: 'p', message: 'p can’t be 0 — the focus would be on the vertex.' })
    return out
  }
  const aWhat = spec.kind === 'circle' ? 'radius r' : spec.kind === 'hyperbola' ? 'transverse semi-axis a' : 'semi-axis a'
  const a = num('a', spec.a, aWhat)
  if (a !== null && a <= 0) {
    out.push({ field: 'a', message: `The ${aWhat} is a distance — it must be positive.` })
  }
  if (spec.kind !== 'circle') {
    const bWhat = spec.kind === 'hyperbola' ? 'conjugate semi-axis b' : 'semi-axis b'
    const b = num('b', spec.b ?? spec.a, bWhat)
    if (b !== null && b <= 0) out.push({ field: 'b', message: `The ${bWhat} is a distance — it must be positive.` })
  }
  return out
}

// ---------------------------------------------------------------------------
// the core, never throwing
// ---------------------------------------------------------------------------

/** A typed line read as a conic in standard or general form, or null. */
export function safeReadConic(src: string | undefined): ConicSpec | null {
  if (!src || !src.trim()) return null
  try {
    const s = readConic(src)
    return s && conicProblems(s).length === 0 ? s : null
  } catch {
    return null
  }
}

export function safeConicSource(spec: ConicSpec): string | null {
  if (conicProblems(spec).length > 0) return null
  try {
    return conicSource(spec)
  } catch {
    return null
  }
}

export function safeConicFeatures(spec: ConicSpec): ConicFeatures | null {
  if (conicProblems(spec).length > 0) return null
  try {
    return conicFeatures(spec)
  } catch {
    return null
  }
}

export function safeClassify(src: string | undefined): ConicClass | null {
  if (!src || !src.trim()) return null
  try {
    return classify(src)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// the six tabs
// ---------------------------------------------------------------------------

export type ConicTab = 'circle' | 'ellipse' | 'hyperbola' | 'parabola' | 'foci' | 'equation'

export const CONIC_TABS: { tab: ConicTab; label: string }[] = [
  { tab: 'circle', label: 'Circle' },
  { tab: 'ellipse', label: 'Ellipse' },
  { tab: 'hyperbola', label: 'Hyperbola' },
  { tab: 'parabola', label: 'Parabola' },
  { tab: 'foci', label: 'Foci' },
  { tab: 'equation', label: 'Equation' },
]

export interface CircleFields {
  center: string
  by: 'radius' | 'point'
  radius: string
  point: string
}

export interface EllipseFields {
  center: string
  vertex: string
  by: 'focus' | 'coVertex' | 'e'
  focus: string
  coVertex: string
  e: string
}

export interface HyperbolaFields {
  center: string
  vertex: string
  by: 'focus' | 'slope' | 'e'
  focus: string
  slope: string
  e: string
}

export type ParabolaOpens = 'up' | 'down' | 'left' | 'right'

export interface ParabolaFields {
  by: 'vertex-focus' | 'focus-directrix' | 'vertex-point'
  vertex: string
  focus: string
  directrix: string
  point: string
  opens: ParabolaOpens
}

export interface FociFields {
  f1: string
  f2: string
  by: 'sum' | 'difference'
  sum: string
  difference: string
}

export interface EquationFields {
  text: string
}

export interface ConicDraft {
  tab: ConicTab
  circle: CircleFields
  ellipse: EllipseFields
  hyperbola: HyperbolaFields
  parabola: ParabolaFields
  foci: FociFields
  equation: EquationFields
}

export function blankConicDraft(): ConicDraft {
  return {
    tab: 'circle',
    circle: { center: '(0, 0)', by: 'radius', radius: '3', point: '(3, 4)' },
    ellipse: { center: '(0, 0)', vertex: '(5, 0)', by: 'focus', focus: '(3, 0)', coVertex: '(0, 4)', e: '3/5' },
    hyperbola: { center: '(0, 0)', vertex: '(3, 0)', by: 'focus', focus: '(5, 0)', slope: '4/3', e: '5/3' },
    parabola: {
      by: 'vertex-focus',
      vertex: '(0, 0)',
      focus: '(0, 2)',
      directrix: 'y = -2',
      point: '(4, 2)',
      opens: 'up',
    },
    foci: { f1: '(-5, 0)', f2: '(5, 0)', by: 'sum', sum: '12', difference: '8' },
    equation: { text: '9x^2 + 4y^2 - 36x + 8y + 4 = 0' },
  }
}

export interface ConicSpecResult {
  spec: ConicSpec | null
  error: string | null
  /** The Equation tab: the discriminant sentence of what was typed. */
  classSentence?: string
}

/** First letter up and a full stop: the core's refusals are clauses. */
function sentence(s: string): string {
  const t = s.trim()
  if (t === '') return t
  const up = t[0].toUpperCase() + t.slice(1)
  return /[.!?]$/.test(up) ? up : `${up}.`
}

function fromBuilt(b: Built): ConicSpecResult {
  if ('error' in b) return { spec: null, error: sentence(b.error) }
  const p = conicProblems(b)
  return p.length > 0 ? { spec: null, error: p[0].message } : { spec: b, error: null }
}

function need(text: string, what: string): { v: number; error: null } | { v: null; error: string } {
  const t = (text ?? '').trim()
  if (t === '') return { v: null, error: `The ${what} is empty.` }
  const v = evalText(t)
  return v === null ? { v: null, error: `The ${what} “${t}” is not a number.` } : { v, error: null }
}

export function conicSpecFromCircle(f: CircleFields): ConicSpecResult {
  const c = parsePoint(f.center, 'center')
  if (!c.pt) return { spec: null, error: c.error }
  if (f.by === 'radius') {
    const r = need(f.radius, 'radius')
    if (r.v === null) return { spec: null, error: r.error }
    const built = conicFromCircle(c.pt, r.v)
    if ('error' in built) return fromBuilt(built)
    // keep the teacher's own radius text (sqrt(5), 2.5) where it is positive
    return fromBuilt({ ...built, a: f.radius.trim() })
  }
  const q = parsePoint(f.point, 'point on the circle')
  if (!q.pt) return { spec: null, error: q.error }
  return fromBuilt(conicFromCircle(c.pt, q.pt))
}

export function conicSpecFromEllipse(f: EllipseFields): ConicSpecResult {
  const c = parsePoint(f.center, 'center')
  if (!c.pt) return { spec: null, error: c.error }
  const v = parsePoint(f.vertex, 'vertex')
  if (!v.pt) return { spec: null, error: v.error }
  if (f.by === 'focus') {
    const fo = parsePoint(f.focus, 'focus')
    if (!fo.pt) return { spec: null, error: fo.error }
    return fromBuilt(conicFromEllipse({ center: c.pt, vertex: v.pt, focus: fo.pt }))
  }
  if (f.by === 'coVertex') {
    const w = parsePoint(f.coVertex, 'co-vertex')
    if (!w.pt) return { spec: null, error: w.error }
    return fromBuilt(conicFromEllipse({ center: c.pt, vertex: v.pt, coVertex: w.pt }))
  }
  const e = need(f.e, 'eccentricity')
  if (e.v === null) return { spec: null, error: e.error }
  return fromBuilt(conicFromEllipse({ center: c.pt, vertex: v.pt, e: e.v }))
}

export function conicSpecFromHyperbola(f: HyperbolaFields): ConicSpecResult {
  const c = parsePoint(f.center, 'center')
  if (!c.pt) return { spec: null, error: c.error }
  const v = parsePoint(f.vertex, 'vertex')
  if (!v.pt) return { spec: null, error: v.error }
  if (f.by === 'focus') {
    const fo = parsePoint(f.focus, 'focus')
    if (!fo.pt) return { spec: null, error: fo.error }
    return fromBuilt(conicFromHyperbola({ center: c.pt, vertex: v.pt, focus: fo.pt }))
  }
  if (f.by === 'slope') {
    const m = need(f.slope, 'asymptote slope')
    if (m.v === null) return { spec: null, error: m.error }
    return fromBuilt(conicFromHyperbola({ center: c.pt, vertex: v.pt, asymptoteSlope: m.v }))
  }
  const e = need(f.e, 'eccentricity')
  if (e.v === null) return { spec: null, error: e.error }
  return fromBuilt(conicFromHyperbola({ center: c.pt, vertex: v.pt, e: e.v }))
}

/** "y = -2", "x=3", "y = −1/2" → the line; anything else a refusal. */
export function parseDirectrix(
  text: string,
): { line: { axis: 'x' | 'y'; value: number }; error: null } | { line: null; error: string } {
  const s = (text ?? '').trim().replace(/[−–]/g, '-')
  if (s === '') return { line: null, error: 'The directrix is empty.' }
  // "y = -2", or the other way round, "-2 = y"
  const left = /^([xyXY])\s*=\s*(.+)$/.exec(s)
  const right = left ? null : /^(.+?)\s*=\s*([xyXY])$/.exec(s)
  const axisChar = left ? left[1] : right ? right[2] : null
  const rhs = left ? left[2] : right ? right[1] : null
  if (!axisChar || rhs === null) {
    return { line: null, error: `Write the directrix as a line, y = −2 or x = 3 — “${text.trim()}” is not one.` }
  }
  const v = evalText(rhs.trim())
  if (v === null) return { line: null, error: `The directrix “${text.trim()}” is not y = a number or x = a number.` }
  return { line: { axis: axisChar.toLowerCase() as 'x' | 'y', value: v }, error: null }
}

export function conicSpecFromParabola(f: ParabolaFields): ConicSpecResult {
  if (f.by === 'focus-directrix') {
    const fo = parsePoint(f.focus, 'focus')
    if (!fo.pt) return { spec: null, error: fo.error }
    const d = parseDirectrix(f.directrix)
    if (!d.line) return { spec: null, error: d.error }
    return fromBuilt(conicFromParabola({ focus: fo.pt, directrix: d.line }))
  }
  const v = parsePoint(f.vertex, 'vertex')
  if (!v.pt) return { spec: null, error: v.error }
  if (f.by === 'vertex-focus') {
    const fo = parsePoint(f.focus, 'focus')
    if (!fo.pt) return { spec: null, error: fo.error }
    return fromBuilt(conicFromParabola({ vertex: v.pt, focus: fo.pt }))
  }
  const q = parsePoint(f.point, 'point')
  if (!q.pt) return { spec: null, error: q.error }
  return fromBuilt(conicFromParabola({ vertex: v.pt, point: q.pt, opens: f.opens }))
}

export function conicSpecFromFoci(f: FociFields): ConicSpecResult {
  const a = parsePoint(f.f1, 'first focus')
  if (!a.pt) return { spec: null, error: a.error }
  const b = parsePoint(f.f2, 'second focus')
  if (!b.pt) return { spec: null, error: b.error }
  if (f.by === 'sum') {
    const s = need(f.sum, 'sum of the distances')
    if (s.v === null) return { spec: null, error: s.error }
    return fromBuilt(conicFromFoci(a.pt, b.pt, { sum: s.v }))
  }
  const d = need(f.difference, 'difference of the distances')
  if (d.v === null) return { spec: null, error: d.error }
  return fromBuilt(conicFromFoci(a.pt, b.pt, { difference: d.v }))
}

/**
 * The Equation tab: any typed conic — a general form, a standard form, even
 * a function y = x² − 4x + 1 (a parabola, read as the equation it is) — read
 * back as a spec, with the discriminant sentence. A rotated or degenerate
 * quadratic is refused in words (its sentence says why).
 */
export function conicSpecFromEquation(f: EquationFields): ConicSpecResult {
  const text = (f.text ?? '').trim()
  if (text === '') return { spec: null, error: 'Type an equation in x and y, like 9x^2 + 4y^2 - 36x + 8y + 4 = 0.' }
  let spec = safeReadConic(text)
  // y = f(x) is a FUNCTION to the parser; as lhs − rhs = 0 it is the equation it is
  if (!spec) {
    const parts = text.split('=')
    if (parts.length === 2 && parts[0].trim() !== '' && parts[1].trim() !== '') {
      spec = safeReadConic(`(${parts[0].trim()}) - (${parts[1].trim()}) = 0`)
    }
  }
  const cls = safeClassify(text)
  const classSentence = cls && cls.kind !== 'none' ? sentence(cls.sentence) : undefined
  if (spec) return { spec, error: null, classSentence }
  if (!cls || cls.kind === 'none') {
    const why = cls ? cls.sentence.replace(/^not a conic:\s*/, '') : 'it could not be read'
    return { spec: null, error: sentence(`That is not a conic: ${why}`), classSentence: undefined }
  }
  if (cls.kind === 'degenerate') {
    return { spec: null, error: `${sentence(cls.sentence)} There is no standard form to write.`, classSentence }
  }
  if (cls.rotated) {
    return {
      spec: null,
      error: `${sentence(cls.sentence)} Its axes are tilted, so it has no standard form with x and y — this app writes standard form for conics with horizontal and vertical axes.`,
      classSentence,
    }
  }
  return { spec: null, error: `${sentence(cls.sentence)} It could not be completed to standard form.`, classSentence }
}

export function conicSpecFromDraft(d: ConicDraft): ConicSpecResult {
  switch (d.tab) {
    case 'circle':
      return conicSpecFromCircle(d.circle)
    case 'ellipse':
      return conicSpecFromEllipse(d.ellipse)
    case 'hyperbola':
      return conicSpecFromHyperbola(d.hyperbola)
    case 'parabola':
      return conicSpecFromParabola(d.parabola)
    case 'foci':
      return conicSpecFromFoci(d.foci)
    case 'equation':
      return conicSpecFromEquation(d.equation)
  }
}

// ---------------------------------------------------------------------------
// the preview
// ---------------------------------------------------------------------------

export interface ConicPreview {
  src: string | null
  latex: string | null
  kind: ConicKind | null
  sentences: string[]
  error: string | null
}

export function conicPreview(spec: ConicSpec | null, error: string | null = null): ConicPreview {
  if (!spec) return { src: null, latex: null, kind: null, sentences: [], error }
  const src = safeConicSource(spec)
  if (!src) {
    const p = conicProblems(spec)
    return {
      src: null,
      latex: null,
      kind: null,
      sentences: [],
      error: p[0]?.message ?? 'This conic could not be written out.',
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
  const f = safeConicFeatures(spec)
  return {
    src,
    latex,
    kind: spec.kind,
    sentences: f ? f.sentences.filter((t) => t.trim() !== '') : [],
    error: err,
  }
}

export const KIND_NAME: Record<ConicKind, string> = {
  circle: 'Circle',
  ellipse: 'Ellipse',
  hyperbola: 'Hyperbola',
  parabola: 'Parabola',
}

// ---------------------------------------------------------------------------
// the card: which line this is, and "write in standard form"
// ---------------------------------------------------------------------------

/** The text with spacing, `*`, Unicode minus and ² normalised away, for comparing forms. */
function compact(s: string): string {
  return s
    .replace(/²/g, '^2')
    .replace(/[−–]/g, '-')
    .replace(/[\s*]/g, '')
    .toLowerCase()
}

/**
 * Is the typed line already the standard form conicSource writes for it?
 * `(x-2)^2/9 + (y+1)^2/4 = 1` is (spacing aside); `x^2 + y^2 - 4x + 6y - 3 = 0`
 * (general form) and `4x^2 + 9y^2 = 36` (not divided through) are not.
 */
export function isStandardForm(src: string, spec: ConicSpec): boolean {
  const std = safeConicSource(spec)
  return std !== null && compact(std) === compact(src)
}

/** The standard form to restate a general-form line as, or null when it already is one. */
export function writeStandard(src: string | undefined): string | null {
  const spec = safeReadConic(src)
  if (!spec || !src) return null
  if (isStandardForm(src, spec)) return null
  return safeConicSource(spec)
}

export type ConicSectionInfo =
  | { kind: 'conic'; spec: ConicSpec; general: boolean }
  | { kind: 'class'; sentence: string }

/**
 * What a TYPED curve's card says about it as a conic: an axis-aligned conic
 * (editable), or — for a rotated or degenerate quadratic — the discriminant
 * sentence, read-only. Only implicit lines: y = x² is a function and its card
 * already speaks for it.
 */
export function conicSectionInfo(src: string | undefined, curveKind: string): ConicSectionInfo | null {
  if (curveKind !== 'implicit' || !src) return null
  const spec = safeReadConic(src)
  if (spec) return { kind: 'conic', spec, general: !isStandardForm(src, spec) }
  const cls = safeClassify(src)
  if (!cls || cls.kind === 'none') return null
  if (!cls.rotated && cls.kind !== 'degenerate') return null
  return { kind: 'class', sentence: sentence(cls.sentence) }
}

// ---------------------------------------------------------------------------
// one committed edit on a card
// ---------------------------------------------------------------------------

/** The fields a kind's card edits, with their labels. */
export function conicFieldsOf(spec: ConicSpec): { field: ConicField; tag: string; label: string }[] {
  const hk = [
    { field: 'h' as const, tag: 'h =', label: spec.kind === 'parabola' ? 'Vertex x (h)' : 'Center x (h)' },
    { field: 'k' as const, tag: 'k =', label: spec.kind === 'parabola' ? 'Vertex y (k)' : 'Center y (k)' },
  ]
  switch (spec.kind) {
    case 'circle':
      return [...hk, { field: 'a', tag: 'r =', label: 'Radius r' }]
    case 'ellipse':
      return [
        ...hk,
        { field: 'a', tag: 'a =', label: 'a — the semi-axis along x' },
        { field: 'b', tag: 'b =', label: 'b — the semi-axis along y' },
      ]
    case 'hyperbola':
      return [
        ...hk,
        { field: 'a', tag: 'a =', label: 'a — the transverse semi-axis (center to vertex)' },
        { field: 'b', tag: 'b =', label: 'b — the conjugate semi-axis' },
      ]
    case 'parabola':
      return [...hk, { field: 'p', tag: 'p =', label: 'p — vertex to focus (negative opens down / left)' }]
  }
}

export const CONIC_FIELD_LABEL: Record<ConicField, string> = {
  h: 'set h',
  k: 'set k',
  a: 'set a',
  b: 'set b',
  p: 'set p',
}

/** The spec with one field retyped. A parabola's p is mirrored into a (the core's convention). */
export function setConicField(spec: ConicSpec, field: ConicField, text: string): ConicSpec {
  const t = text.trim()
  if (field === 'p') return { ...spec, p: t, a: t }
  if (field === 'b' && spec.kind === 'circle') return spec
  return { ...spec, [field]: t }
}

/** The text of a field as the card shows it. */
export function conicFieldText(spec: ConicSpec, field: ConicField): string {
  switch (field) {
    case 'h':
      return spec.h || '0'
    case 'k':
      return spec.k || '0'
    case 'a':
      return spec.a || '1'
    case 'b':
      return spec.b ?? spec.a ?? '1'
    case 'p':
      return spec.p ?? spec.a ?? '1'
  }
}

/** Which way a parabola opens, as a class says it. */
export function parabolaOpens(spec: ConicSpec): ParabolaOpens {
  const v = conicValues(spec)
  if (v.opens === 'x') return v.p < 0 ? 'left' : 'right'
  return v.p < 0 ? 'down' : 'up'
}

/** A parabola turned to open another way, |p| kept. */
export function setParabolaOpens(spec: ConicSpec, to: ParabolaOpens): ConicSpec {
  const t = (spec.p ?? spec.a ?? '1').trim()
  const v = evalText(t)
  const neg = to === 'down' || to === 'left'
  let p = t
  if (v !== null && (v < 0) !== neg) {
    if (t.startsWith('-') && !/[-+]/.test(t.slice(1))) p = t.slice(1).trim()
    else p = /^[\w.()/]+$/.test(t) ? `-${t}` : `-(${t})`
  }
  return { ...spec, opens: to === 'up' || to === 'down' ? 'y' : 'x', p, a: p }
}

/** A hyperbola opening the other way (a and b kept: a different graph). */
export function setHyperbolaOpens(spec: ConicSpec, opens: 'x' | 'y'): ConicSpec {
  return { ...spec, opens }
}

export interface ConicCommitDeps {
  restate(src: string, label: string): string | null
}

/** Apply an edit and restate. The refusal, or null. */
export function commitConicSpec(
  spec: ConicSpec,
  next: ConicSpec | null,
  label: string,
  deps: ConicCommitDeps,
): string | null {
  if (!next) return 'That can’t be written as this conic.'
  const p = conicProblems(next)
  if (p.length > 0) return p[0].message
  const src = safeConicSource(next)
  if (!src) return 'This conic could not be written out.'
  const before = safeConicSource(spec)
  if (src === before) return null
  return deps.restate(src, label)
}

// ---------------------------------------------------------------------------
// what the board shows while it is selected
// ---------------------------------------------------------------------------

/**
 * The center, vertices, co-vertices and foci as analysis marks — the dot and
 * the exact-text chip the board already draws ("(2 + √5, −1)"). Every one is
 * marked the way a turning point is (a solid dot, its chip BELOW it): the
 * F₁ / F₂ names are labelled points whose tag steps up and to the right, and
 * the board lays its analysis chips out among themselves only — so the two
 * kinds of label are kept on opposite sides of the points they name.
 */
export function conicKeyMarks(spec: ConicSpec): SpecialPoint[] {
  const f = safeConicFeatures(spec)
  if (!f) return []
  const out: SpecialPoint[] = []
  const add = (p: { x: number; y: number; xText: string; yText: string }, kind: SpecialPoint['kind'], label: string) => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return
    out.push({ kind, pos: { x: p.x, y: p.y }, label, exactX: p.xText, exactY: p.yText, exact: true })
  }
  if (f.center) add(f.center, 'minimum', 'center')
  for (const v of f.vertices) add(v, 'minimum', 'vertex')
  for (const v of f.coVertices) add(v, 'minimum', 'co-vertex')
  if (spec.kind !== 'circle') {
    f.foci.forEach((p, i) => add(p, 'minimum', f.foci.length > 1 ? `focus F${SUB[i + 1]}` : 'focus'))
  }
  return out
}

const SUB = ['₀', '₁', '₂']

/** Far enough that no pan or zoom reaches an end; the renderer clips (as the sinusoid's midline). */
const REACH = 1e6

/** Dashes: the directrix and the asymptotes as the midline is; the box dotted. */
export const CONSTRUCTION_DASH = [6, 5]
export const BOX_DASH = [2, 4]

/**
 * The figure's construction lines: a parabola's directrix, a hyperbola's two
 * asymptotes and its fundamental rectangle. In the curve's colour, thin.
 */
export function constructionPolylines(spec: ConicSpec, color: string, idBase: string): Polyline[] {
  const f = safeConicFeatures(spec)
  if (!f) return []
  const out: Polyline[] = []
  if (f.directrix && Number.isFinite(f.directrix.value)) {
    const d = f.directrix.value
    const v = conicValues(spec)
    const along = f.directrix.axis === 'y' ? v.h : v.k
    const c = Number.isFinite(along) ? along : 0
    out.push({
      id: `${idBase}:directrix`,
      pts:
        f.directrix.axis === 'y'
          ? [{ x: c - REACH, y: d }, { x: c + REACH, y: d }]
          : [{ x: d, y: c - REACH }, { x: d, y: c + REACH }],
      color,
      width: 1.25,
      dash: CONSTRUCTION_DASH,
    })
  }
  if (f.center && f.asymptotes.length > 0) {
    const { x: h, y: k } = f.center
    f.asymptotes.forEach((a, i) => {
      if (!Number.isFinite(a.slope)) return
      // a unit step along the line, then REACH of them either way
      const L = Math.hypot(1, a.slope)
      const dx = (REACH / L)
      const dy = (REACH * a.slope) / L
      out.push({
        id: `${idBase}:asymptote:${i}`,
        pts: [{ x: h - dx, y: k - dy }, { x: h + dx, y: k + dy }],
        color,
        width: 1.25,
        dash: CONSTRUCTION_DASH,
      })
    })
  }
  if (f.box && f.box.length === 4 && f.box.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) {
    out.push({
      id: `${idBase}:box`,
      pts: [...f.box, f.box[0]],
      color,
      width: 1,
      dash: BOX_DASH,
    })
  }
  return out
}

/**
 * The named points: the foci as labelled points, F₁ and F₂ (a parabola's one
 * focus is F). With `all`, the center, vertices and co-vertices too, unnamed —
 * the construction as a figure (an export has no analysis chips to mark them).
 */
export function constructionShapes(spec: ConicSpec, color: string, idBase: string, all = false): Shape[] {
  const f = safeConicFeatures(spec)
  if (!f) return []
  const out: Shape[] = []
  const pt = (id: string, p: { x: number; y: number }, label?: string): void => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return
    out.push({ kind: 'point', id: `${idBase}:${id}`, at: { x: p.x, y: p.y }, color, visible: true, ...(label ? { label } : {}) })
  }
  if (all) {
    if (f.center) pt('center', f.center)
    f.vertices.forEach((v, i) => pt(`vertex:${i}`, v))
    f.coVertices.forEach((v, i) => pt(`covertex:${i}`, v))
  }
  if (spec.kind !== 'circle') {
    f.foci.forEach((p, i) => pt(`focus:${i}`, p, f.foci.length > 1 ? `F${SUB[i + 1]}` : 'F'))
  }
  return out
}

/** Every point of the construction that has a place (for framing an export). */
export function constructionPoints(spec: ConicSpec): Vec2[] {
  const f = safeConicFeatures(spec)
  if (!f) return []
  const pts: Vec2[] = []
  const push = (p: { x: number; y: number }) => {
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) pts.push({ x: p.x, y: p.y })
  }
  if (f.center) push(f.center)
  f.vertices.forEach(push)
  f.coVertices.forEach(push)
  f.foci.forEach(push)
  f.box?.forEach(push)
  return pts
}

// ---------------------------------------------------------------------------
// board handles
// ---------------------------------------------------------------------------

/**
 *   center — (h, k): the whole conic moves (a parabola's vertex).
 *   a      — the end of the a semi-axis: along x for an ellipse or a circle
 *            (the radius), the vertex of a hyperbola.
 *   b      — the end of the b semi-axis: along y for an ellipse, the
 *            co-vertex of a hyperbola.
 *   focus  — a focus: c, the major / transverse semi-axis kept (b follows);
 *            a parabola's focus sets p.
 */
export type ConicHandleKind = 'center' | 'a' | 'b' | 'focus'

export interface ConicHandle {
  which: ConicHandleKind
  pos: Vec2
  label: string
}

export const CONIC_HANDLE_LABEL: Record<ConicHandleKind, string> = {
  center: 'move center',
  a: 'set a',
  b: 'set b',
  focus: 'move focus',
}

function ptText(p: { xText: string; yText: string }): string {
  return `(${p.xText}, ${p.yText})`
}

export function conicHandles(spec: ConicSpec): ConicHandle[] {
  const v = conicValues(spec)
  const f = safeConicFeatures(spec)
  if (!f || ![v.h, v.k].every(Number.isFinite)) return []
  const out: ConicHandle[] = []
  if (spec.kind === 'parabola') {
    const vx = f.vertices[0]
    if (vx) out.push({ which: 'center', pos: { x: vx.x, y: vx.y }, label: `vertex ${ptText(vx)}` })
    const fo = f.foci[0]
    if (fo) out.push({ which: 'focus', pos: { x: fo.x, y: fo.y }, label: `focus ${ptText(fo)}` })
    return out
  }
  const c = f.center
  if (c) out.push({ which: 'center', pos: { x: c.x, y: c.y }, label: `center ${ptText(c)}` })
  if (spec.kind === 'circle') {
    out.push({ which: 'a', pos: { x: v.h + v.a, y: v.k }, label: `radius ${prettyConic(spec.a)}` })
    return out
  }
  if (spec.kind === 'ellipse') {
    const horizontal = v.a >= v.b
    out.push({
      which: 'a',
      pos: { x: v.h + v.a, y: v.k },
      label: `${horizontal ? 'vertex' : 'co-vertex'} · a = ${prettyConic(spec.a)}`,
    })
    out.push({
      which: 'b',
      pos: { x: v.h, y: v.k + v.b },
      label: `${horizontal ? 'co-vertex' : 'vertex'} · b = ${prettyConic(spec.b ?? spec.a)}`,
    })
  } else {
    const opensY = v.opens === 'y'
    out.push({
      which: 'a',
      pos: opensY ? { x: v.h, y: v.k + v.a } : { x: v.h + v.a, y: v.k },
      label: `vertex · a = ${prettyConic(spec.a)}`,
    })
    out.push({
      which: 'b',
      pos: opensY ? { x: v.h + v.b, y: v.k } : { x: v.h, y: v.k + v.b },
      label: `co-vertex · b = ${prettyConic(spec.b ?? spec.a)}`,
    })
  }
  // the focus on the positive side of the center
  const fo = f.foci.reduce<(typeof f.foci)[number] | null>(
    (best, p) => (!best || p.x + p.y > best.x + best.y ? p : best),
    null,
  )
  if (fo) out.push({ which: 'focus', pos: { x: fo.x, y: fo.y }, label: `focus ${ptText(fo)}` })
  return out
}

/**
 * A handle dragged to `to` (already snapped), computed from the spec at the
 * press. Null when that makes no conic of this kind — a zero length, a focus
 * outside an ellipse's vertex or inside a hyperbola's, an ellipse whose two
 * semi-axes meet (that would turn it into a circle under the finger).
 */
export function dragConicHandle(spec: ConicSpec, which: ConicHandleKind, to: Vec2): ConicSpec | null {
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) return null
  const v = conicValues(spec)
  if (![v.h, v.k, v.a, v.b].every(Number.isFinite)) return null
  const tiny = 1e-9 * Math.max(1, v.a, v.b)
  switch (which) {
    case 'center':
      return { ...spec, h: numOut(to.x), k: numOut(to.y) }
    case 'a': {
      if (spec.kind === 'parabola') return null
      if (spec.kind === 'circle') {
        const r = Math.hypot(to.x - v.h, to.y - v.k)
        return r > tiny ? { ...spec, a: numOut(r) } : null
      }
      const alongY = spec.kind === 'hyperbola' && v.opens === 'y'
      const a = Math.abs(alongY ? to.y - v.k : to.x - v.h)
      if (!(a > tiny)) return null
      if (spec.kind === 'ellipse' && Math.abs(a - v.b) <= tiny) return null
      return { ...spec, a: numOut(a) }
    }
    case 'b': {
      if (spec.kind === 'parabola' || spec.kind === 'circle') return null
      const alongX = spec.kind === 'hyperbola' && v.opens === 'y'
      const b = Math.abs(alongX ? to.x - v.h : to.y - v.k)
      if (!(b > tiny)) return null
      if (spec.kind === 'ellipse' && Math.abs(b - v.a) <= tiny) return null
      return { ...spec, b: numOut(b) }
    }
    case 'focus': {
      if (spec.kind === 'parabola') {
        const p = v.opens === 'x' ? to.x - v.h : to.y - v.k
        if (!(Math.abs(p) > 1e-9)) return null
        const pt = numOut(p)
        return { ...spec, p: pt, a: pt }
      }
      if (spec.kind === 'circle') return null
      if (spec.kind === 'ellipse') {
        const horizontal = v.a >= v.b
        const M = horizontal ? v.a : v.b
        const c = Math.abs(horizontal ? to.x - v.h : to.y - v.k)
        // c = 0 is a circle and c ≥ M no ellipse at all
        if (!(c > tiny) || c >= M - tiny) return null
        const m = lengthSource(M * M - c * c)
        if (!m) return null
        return horizontal ? { ...spec, b: m } : { ...spec, a: m }
      }
      const opensY = v.opens === 'y'
      const c = Math.abs(opensY ? to.y - v.k : to.x - v.h)
      if (!(c > v.a + tiny)) return null
      const b = lengthSource(c * c - v.a * v.a)
      return b ? { ...spec, b } : null
    }
  }
}

// ---------------------------------------------------------------------------
// a SKETCHED circle or ellipse
// ---------------------------------------------------------------------------

export interface FittedConic {
  /** The typed line "Convert to typed conic" writes. */
  src: string
  /** "(x − 1.2)² + (y + 0.5)² = 9.61 · center (1.2, −0.5) · radius 3.1" */
  note: string
}

/** The library circle [a, b, r]: (x − a)² + (y − b)² = r², four significant digits. */
export function fittedCircle(params: readonly number[]): FittedConic | null {
  const [cx, cy, r0] = params
  if (![cx, cy, r0].every((v) => typeof v === 'number' && Number.isFinite(v))) return null
  const r = Math.abs(r0)
  if (!(r > 1e-9)) return null
  const zero = (v: number) => (Math.abs(v) < 1e-9 * Math.max(1, r) ? 0 : v)
  const spec: ConicSpec = { kind: 'circle', h: numOut(zero(cx), 4), k: numOut(zero(cy), 4), a: numOut(r, 4) }
  const src = safeConicSource(spec)
  if (!src) return null
  const note = [
    prettyConic(src),
    `center (${prettyConic(spec.h)}, ${prettyConic(spec.k)})`,
    `radius ${prettyConic(spec.a)}`,
  ].join(' · ')
  return { src, note }
}

/** A coefficient as source for a general form, 6 significant digits. */
function coefSrc(v: number): string {
  return numOut(v, 6)
}

/**
 * The library ellipse [A, B, C, D, E, F]: Ax² + Bxy + Cy² + Dx + Ey + F = 0.
 * Nearly axis-aligned (|B| < 2% of |A| + |C|, the family's own display
 * rule), it is stated in standard form, four significant digits; tilted, it
 * is written in general form and the note says how far it is rotated.
 */
export function fittedEllipse(params: readonly number[]): FittedConic | null {
  const [A, B, C, D, E, F] = params
  if (![A, B, C, D, E, F].every((v) => typeof v === 'number' && Number.isFinite(v))) return null
  if (A === 0 || C === 0) return null
  if (Math.abs(B) < 0.02 * (Math.abs(A) + Math.abs(C))) {
    const h = -D / (2 * A)
    const k = -E / (2 * C)
    const R = -(F - (D * D) / (4 * A) - (E * E) / (4 * C))
    const a2 = R / A
    const b2 = R / C
    if (!(a2 > 0) || !(b2 > 0)) return null
    const a = Math.sqrt(a2)
    const b = Math.sqrt(b2)
    const zero = (v: number) => (Math.abs(v) < 1e-9 * Math.max(1, a, b) ? 0 : v)
    const at = numOut(a, 4)
    const bt = numOut(b, 4)
    const spec: ConicSpec =
      at === bt
        ? { kind: 'circle', h: numOut(zero(h), 4), k: numOut(zero(k), 4), a: at }
        : { kind: 'ellipse', h: numOut(zero(h), 4), k: numOut(zero(k), 4), a: at, b: bt }
    const src = safeConicSource(spec)
    if (!src) return null
    const f = safeConicFeatures(spec)
    const major = f?.sentences.find((s) => s.startsWith('major axis'))
    const note = [prettyConic(src), `center (${prettyConic(spec.h)}, ${prettyConic(spec.k)})`, major ?? `radius ${at}`]
      .filter(Boolean)
      .join(' · ')
    return { src, note }
  }
  // tilted: general form, the largest quadratic coefficient 1 (positive)
  const s = (A >= 0 ? 1 : -1) / Math.max(Math.abs(A), Math.abs(B), Math.abs(C))
  const terms: [number, string][] = [
    [A * s, 'x^2'],
    // the parser reads xy as one (unknown) name, so the product is written out
    [B * s, 'x*y'],
    [C * s, 'y^2'],
    [D * s, 'x'],
    [E * s, 'y'],
  ]
  let lhs = ''
  for (const [c, m] of terms) {
    if (Math.abs(c) < 1e-9) continue
    const mag = coefSrc(Math.abs(c))
    const body = mag === '1' ? m : `${mag}${m}`
    lhs += lhs === '' ? `${c < 0 ? '-' : ''}${body}` : ` ${c < 0 ? '-' : '+'} ${body}`
  }
  if (lhs === '') return null
  const src = `${lhs} = ${coefSrc(-F * s)}`
  const cls = safeClassify(src)
  if (!cls || cls.kind !== 'ellipse') return null
  return { src, note: `${prettyConic(src.replace(/\*/g, ''))} · ${cls.sentence}` }
}

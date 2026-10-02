// ============================================================================
// Plain-English descriptions of a figure — for the item bank and for screen
// readers.
//
//   export function describeScene(input: DescribeInput, opts?: DescribeOptions): GraphDescription
//
// Two outputs from one plain-data description of the figure:
//
//   figuredesc  ONE line for the bank's `%%% figuredesc=` field, under
//               ~300 characters, the facts in priority order (zeros, extrema,
//               asymptotes, intercepts, then the rest while there is room):
//                 "Graph of y = f′(x) on [−3, 4] × [−2, 5]: zeros at x = −2 and
//                  x = 1; relative max at (−0.5, 3); relative min at (3, −1.5);
//                  y-intercept (0, 2)."
//   long        a multi-sentence description structured by curve, for
//               aria-describedby or a "Describe this graph" panel. Exact forms
//               where known (√3, π/2), with the decimal in brackets when it
//               helps ("x = √3 (about 1.73)").
//
// Answer mode. `{ answers: false }` describes only what a STUDENT copy of a
// stem figure shows: the window and its scale, which function is drawn, the
// labelled points, and the marks drawn on the figure itself (open and closed
// dots, dashed asymptotes, shading, rectangles, a tangent line) — never a
// computed answer (no zeros, extrema, areas, slopes, intersections that are
// not labelled). `{ answers: true }` (the default) includes everything.
//
// The input is plain data, not a BoardScene, so this module stays pure and
// testable; src/core/describeAdapters.ts builds it from the analysis results.
// No imports: nothing here computes, it only says.
// ============================================================================

// ----------------------------------------------------------------------------
// Input
// ----------------------------------------------------------------------------

export interface DescribeWindow {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
  /** tick / grid spacing on each axis */
  xStep?: number
  yStep?: number
  /** the spacing as text when it is not a plain number ("π/2") */
  xStepText?: string
  yStepText?: string
  /** axis labels when they are not plain x and y ("t (hours)", "v(t)") */
  xLabel?: string
  yLabel?: string
}

export type DescribePointKind =
  | 'zero'
  | 'maximum'
  | 'minimum'
  | 'inflection'
  | 'y-intercept'
  | 'extreme' // closed or polar curves: leftmost / top … (the label says which)
  | 'petal-tip'
  | 'endpoint'
  | 'point' // any other point worth naming (a vertex, a centre, a labelled point)

export interface DescribePoint {
  kind: DescribePointKind
  x: number
  y: number
  /** closed forms, plain Unicode: "√3", "−π/2", "1/3" */
  exactX?: string
  exactY?: string
  /** the figure labels this point (so a student copy shows it) */
  labelled?: boolean
  /** the label on the figure ("A") or a word for a 'point' / 'extreme' ("vertex", "top") */
  label?: string
  /** a zero or critical point where the curve touches without crossing */
  tangent?: boolean
  /** maxima / minima: absolute rather than relative */
  absolute?: boolean
  /** endpoints: drawn filled (included) or open (excluded) */
  closed?: boolean
}

export type DescribeAsymptote =
  | { kind: 'vertical'; x: number; exact?: string }
  | { kind: 'horizontal'; y: number; exact?: string }
  | { kind: 'slant'; m: number; b: number; text?: string }
  | { kind: 'line'; text: string }

export interface DescribeHole {
  x: number
  y: number
  exactX?: string
  exactY?: string
}

/** A break between two pieces (or at a step) where the one-sided limits differ. */
export interface DescribeJump {
  x: number
  exactX?: string
  /** one-sided limits; null when that side is not defined */
  left: number | null
  right: number | null
  leftText?: string
  rightText?: string
  /** f(x) at the break: null when undefined there */
  value: number | null
  valueText?: string
}

export interface DescribeCurve {
  /** "f", "f′", "g" — the name the figure and stem use; '' for an unnamed curve */
  name: string
  /** the equation in plain Unicode: "f(x) = x³ − 3x", "r = 1 + cos θ" */
  text: string
  /** what it is, in words: "cubic polynomial", "rational function", "circle" */
  kind: string
  features?: DescribePoint[]
  asymptotes?: DescribeAsymptote[]
  holes?: DescribeHole[]
  jumps?: DescribeJump[]
  /** domain and range in words or set notation ("all real numbers", "x ≠ 3", "[0, 16]") */
  domain?: string
  range?: string
  /** further facts in full sentences, shown with answers only ("Its center is (1, −2) and its radius is 3.") */
  notes?: string[]
  /** drawn dashed (grayscale-safe: solid vs dashed, never colour) */
  dashed?: boolean
  /** what a student copy shows of this curve */
  shows?: {
    /** the figure prints the equation next to the curve (default false) */
    equation?: boolean
    /** asymptotes are drawn as dashed lines (default true) */
    asymptotes?: boolean
    /** open/closed dots at holes, jumps and endpoints are drawn (default true) */
    markers?: boolean
  }
}

export interface DescribeIntersection {
  /** names of the two curves */
  a: string
  b: string
  x: number
  y: number
  exactX?: string
  exactY?: string
  labelled?: boolean
  label?: string
}

export interface DescribeRegion {
  /** "R" */
  label?: string
  /** curve names; `lower` absent means the x-axis */
  upper: string
  lower?: string
  a: number
  b: number
  exactA?: string
  exactB?: string
  /** the area (answers only) */
  value?: number
  exactValue?: string
}

export interface DescribeRiemann {
  curve: string
  method: 'left' | 'right' | 'midpoint' | 'trapezoid'
  n: number
  a: number
  b: number
  exactA?: string
  exactB?: string
  /** the sum (answers only) */
  value?: number
}

export interface DescribeTangent {
  curve: string
  x: number
  exactX?: string
  /** 'tangent' (default), 'secant' (to x2), or 'normal' */
  kind?: 'tangent' | 'secant' | 'normal'
  x2?: number
  exactX2?: string
  /** answers only */
  slope?: number
  exactSlope?: string
  /** its equation in plain text, answers only: "y = 2x − 1" */
  text?: string
}

export interface DescribeNumberLine {
  min: number
  max: number
  step?: number
  /** the statement solved ("x² − 4 > 0"), answers only unless `statementShown` */
  statement?: string
  statementShown?: boolean
  /** interval notation, "(−∞, −2) ∪ (2, ∞)" */
  solution?: string
  /** set-builder / words, "x < −2 or x > 2" */
  builder?: string
  /** the dots on the line */
  points: { x: number; exact?: string; closed: boolean }[]
  /** the shaded stretches; null for an end that runs off the line (an arrow) */
  intervals: { lo: number | null; hi: number | null; loText?: string; hiText?: string }[]
}

export interface DescribeExtra {
  text: string
  /** true when the sentence gives an answer away (omitted from a student copy) */
  answer?: boolean
}

export interface DescribeInput {
  /** default 'cartesian' when there are curves, 'number-line' when only a number line */
  board?: 'cartesian' | 'polar' | 'number-line'
  window: DescribeWindow
  curves: DescribeCurve[]
  intersections?: DescribeIntersection[]
  regions?: DescribeRegion[]
  riemann?: DescribeRiemann[]
  tangents?: DescribeTangent[]
  numberLine?: DescribeNumberLine
  extras?: (string | DescribeExtra)[]
}

export interface DescribeOptions {
  /** include computed answers (default true); false describes a student copy */
  answers?: boolean
  /** the figuredesc limit in characters (default 300) */
  maxLength?: number
}

export interface GraphDescription {
  /** one line for `%%% figuredesc=`, ≤ maxLength characters, no newlines */
  figuredesc: string
  /** the screen-reader description: sentences grouped into paragraphs by '\n\n' */
  long: string
}

// ----------------------------------------------------------------------------
// Numbers and lists
// ----------------------------------------------------------------------------

const MINUS = '−'
const DEFAULT_MAX = 300

/** A decimal as a reader wants it: −2, 0.5, 1.73 (never 1.7320508). */
export function fmt(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? 'undefined' : v > 0 ? '∞' : `${MINUS}∞`
  const r = Math.round(v)
  if (Math.abs(v - r) < 1e-9 * Math.max(1, Math.abs(v))) return r === 0 ? '0' : String(r).replace('-', MINUS)
  const a = Math.abs(v)
  const d = a >= 100 ? 1 : a >= 1 ? digits : digits + 1
  let s = v.toFixed(d)
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
  if (s === '-0' || s === '0') s = a > 0 ? v.toPrecision(2) : '0'
  return s.replace('-', MINUS)
}

/** An exact form is worth a decimal beside it when it is irrational-looking. */
function needsDecimal(exact: string): boolean {
  return /[√πe∛]|ln|log/.test(exact)
}

/** The value as the figuredesc prints it: the exact form when known, else a short decimal. */
function short(v: number, exact?: string): string {
  return exact ? norm(exact) : fmt(v)
}

/** The value as the long description says it: "√3 (about 1.73)". */
function spoken(v: number, exact?: string): string {
  if (!exact) return fmt(v)
  const e = norm(exact)
  return needsDecimal(e) ? `${e} (about ${fmt(v)})` : e
}

function norm(s: string): string {
  return s.replace(/-/g, MINUS)
}

function pointShort(x: number, y: number, ex?: string, ey?: string): string {
  return `(${short(x, ex)}, ${short(y, ey)})`
}

function pointSpoken(x: number, y: number, ex?: string, ey?: string): string {
  const base = `(${short(x, ex)}, ${short(y, ey)})`
  const irr = (ex && needsDecimal(norm(ex))) || (ey && needsDecimal(norm(ey)))
  return irr ? `${base} (about (${fmt(x)}, ${fmt(y)}))` : base
}

/** "a", "a and b", "a, b, and c" */
export function list(items: readonly string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

/** A long list cut to its first few items: "a, b, c, and 6 more". */
function capped(items: readonly string[], max: number): string {
  if (items.length <= max) return list(items)
  const keep = Math.max(1, max - 1)
  return `${items.slice(0, keep).join(', ')}, and ${items.length - keep} more`
}

/** Points grouped by their word: "vertex" ×2 → "vertices at (…) and (…)". */
function groupByLabel(ps: readonly DescribePoint[]): Map<string, DescribePoint[]> {
  const groups = new Map<string, DescribePoint[]>()
  for (const p of ps) {
    const key = p.kind === 'petal-tip' ? 'petal tip' : p.label ?? 'point'
    groups.set(key, [...(groups.get(key) ?? []), p])
  }
  // the order a textbook names a conic's points in
  const rank = (k: string) => { const i = ['center', 'vertex', 'focus'].indexOf(k); return i < 0 ? 3 : i }
  return new Map([...groups].sort((a, b) => rank(a[0]) - rank(b[0])))
}

const PLURALS: Record<string, string> = { vertex: 'vertices', focus: 'foci', 'petal tip': 'petal tips', point: 'points', center: 'centers' }

function pluralWord(word: string, n: number): string {
  if (n === 1) return word
  return PLURALS[word] ?? `${word}s`
}

/** Asymptotes grouped by kind: "vertical asymptotes x = −π/2 and x = π/2". */
function asymptoteGroups(as: readonly DescribeAsymptote[]): string[] {
  const out: string[] = []
  for (const kind of ['vertical', 'horizontal', 'slant', 'line'] as const) {
    const these = as.filter((a) => a.kind === kind)
    if (!these.length) continue
    const word = kind === 'line' ? '' : `${kind} `
    out.push(`${word}${pluralWord('asymptote', these.length)} ${list(these.map(asymptoteShort))}`)
  }
  return out
}

const FD_LIST = 4

/** "3 times " before a list that was cut, so the count is never lost. */
function countWord(n: number): string {
  return n > LONG_LIST ? `${n} times, ` : ''
}
const LONG_LIST = 8

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

function sentence(s: string): string {
  const t = s.trim()
  if (!t) return ''
  return /[.?!]$/.test(t) ? cap(t) : `${cap(t)}.`
}

function stepText(step: number | undefined, text: string | undefined): string | null {
  if (text) return norm(text)
  if (step === undefined || !Number.isFinite(step) || step <= 0) return null
  return fmt(step, 3)
}

function unitWord(t: string): string {
  return t === '1' ? '1 unit' : `${t} units`
}

// ----------------------------------------------------------------------------
// Pieces shared by both outputs
// ----------------------------------------------------------------------------

function windowShort(w: DescribeWindow): string {
  return `[${fmt(w.xMin)}, ${fmt(w.xMax)}] × [${fmt(w.yMin)}, ${fmt(w.yMax)}]`
}

function scaleClause(w: DescribeWindow): string | null {
  const xs = stepText(w.xStep, w.xStepText)
  const ys = stepText(w.yStep, w.yStepText)
  if (xs && ys && xs === ys) return `both axes marked every ${unitWord(xs)}`
  if (xs && ys) return `x-axis marked every ${unitWord(xs)}, y-axis every ${unitWord(ys)}`
  if (xs) return `x-axis marked every ${unitWord(xs)}`
  if (ys) return `y-axis marked every ${unitWord(ys)}`
  return null
}

function curveLabel(c: DescribeCurve): string {
  return c.name || 'the curve'
}

/** "y = f′(x)" style heading text for a curve in answer mode. */
function curveHeading(c: DescribeCurve, answers: boolean): string {
  if (answers || c.shows?.equation) {
    if (c.text) return norm(c.text)
    if (c.name) return `y = ${c.name}(x)`
    return 'a curve'
  }
  return c.name || 'a curve'
}

const byX = (a: { x: number }, b: { x: number }) => a.x - b.x

function featuresOf(c: DescribeCurve, kind: DescribePointKind): DescribePoint[] {
  return (c.features ?? []).filter((p) => p.kind === kind && Number.isFinite(p.x) && Number.isFinite(p.y)).sort(byX)
}

function asymptoteShort(a: DescribeAsymptote): string {
  switch (a.kind) {
    case 'vertical': return `x = ${short(a.x, a.exact)}`
    case 'horizontal': return `y = ${short(a.y, a.exact)}`
    case 'slant': return a.text ? norm(a.text) : `y = ${lineText(a.m, a.b)}`
    case 'line': return norm(a.text)
  }
}

function asymptoteWord(a: DescribeAsymptote): string {
  return a.kind === 'vertical' ? 'vertical' : a.kind === 'horizontal' ? 'horizontal' : a.kind === 'slant' ? 'slant' : ''
}

/** m·x + b as text: "2x − 1", "−x", "3" */
function lineText(m: number, b: number): string {
  const mm = Math.abs(m - 1) < 1e-12 ? 'x' : Math.abs(m + 1) < 1e-12 ? `${MINUS}x` : `${fmt(m)}x`
  if (Math.abs(m) < 1e-12) return fmt(b)
  if (Math.abs(b) < 1e-12) return mm
  return `${mm} ${b < 0 ? MINUS : '+'} ${fmt(Math.abs(b))}`
}

function extremumWord(p: DescribePoint, abbreviated: boolean): string {
  const scope = p.absolute ? 'absolute' : 'relative'
  const what = p.kind === 'maximum' ? (abbreviated ? 'max' : 'maximum') : abbreviated ? 'min' : 'minimum'
  return `${scope} ${what}`
}

function riemannWord(m: DescribeRiemann['method']): string {
  return m === 'left' ? 'left-endpoint' : m === 'right' ? 'right-endpoint' : m === 'midpoint' ? 'midpoint' : 'trapezoid'
}

function extraText(e: string | DescribeExtra): DescribeExtra {
  return typeof e === 'string' ? { text: e } : e
}

/** A labelled point that is not already a named feature. */
function labelledPoints(c: DescribeCurve): DescribePoint[] {
  return (c.features ?? []).filter((p) => p.labelled && Number.isFinite(p.x) && Number.isFinite(p.y)).sort(byX)
}

const markersShown = (c: DescribeCurve) => c.shows?.markers !== false
const asymptotesShown = (c: DescribeCurve) => c.shows?.asymptotes !== false

function samePoint(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6
}

// ----------------------------------------------------------------------------
// figuredesc
// ----------------------------------------------------------------------------

interface Clause {
  tier: number
  text: string
  /** -1: about the whole figure; 0…n−1: curve i; Infinity: the scene (intersections, regions …) */
  group: number
}

const ALL_REAL = /^(all real numbers|\(−∞, ∞\)|ℝ)$/

function curveClauses(c: DescribeCurve, answers: boolean, multi: boolean, group: number): Clause[] {
  const out: Clause[] = []
  const add = (tier: number, text: string) => out.push({ tier, text, group })
  const said: { x: number; y: number }[] = []
  if (answers) {
    const zeros = featuresOf(c, 'zero')
    if (zeros.length) {
      add(1, `${plural(zeros.length, 'zero', 'zeros')} at ${capped(zeros.map((z) => `x = ${short(z.x, z.exactX)}`), FD_LIST)}`)
      zeros.forEach((z) => said.push(z))
    }
    for (const kind of ['maximum', 'minimum'] as const) {
      // absolute and relative extrema are separate clauses
      for (const absolute of [false, true]) {
        const ps = featuresOf(c, kind).filter((p) => !!p.absolute === absolute)
        if (!ps.length) continue
        add(2, `${extremumWord(ps[0], true)} at ${capped(ps.map((p) => pointShort(p.x, p.y, p.exactX, p.exactY)), FD_LIST)}`)
        ps.forEach((p) => said.push(p))
      }
    }
  }
  if (c.asymptotes?.length && (answers || asymptotesShown(c))) {
    if (answers) {
      add(3, list(asymptoteGroups(c.asymptotes)))
    } else {
      add(3, `${plural(c.asymptotes.length, 'dashed line', 'dashed lines')} ${list(c.asymptotes.map(asymptoteShort))}`)
    }
  }
  if (answers) {
    for (const p of featuresOf(c, 'y-intercept')) {
      if (said.some((q) => samePoint(q, p))) continue
      add(4, `y-intercept ${pointShort(p.x, p.y, p.exactX, p.exactY)}`)
      said.push(p)
    }
  }
  if (answers || markersShown(c)) {
    for (const h of c.holes ?? []) {
      add(5, `${answers ? 'hole' : 'open circle'} at ${pointShort(h.x, h.y, h.exactX, h.exactY)}`)
      said.push(h)
    }
    for (const j of c.jumps ?? []) add(5, answers ? jumpShort(j) : jumpMarks(j))
    for (const p of featuresOf(c, 'endpoint')) {
      add(6, `${p.closed === false ? 'open' : 'closed'} endpoint at ${pointShort(p.x, p.y, p.exactX, p.exactY)}`)
      said.push(p)
    }
  }
  if (answers) {
    const infl = featuresOf(c, 'inflection')
    if (infl.length) {
      add(6, `${plural(infl.length, 'inflection point', 'inflection points')} at ${capped(infl.map((p) => pointShort(p.x, p.y, p.exactX, p.exactY)), FD_LIST)}`)
      infl.forEach((p) => said.push(p))
    }
    const others = [...featuresOf(c, 'extreme'), ...featuresOf(c, 'petal-tip'), ...featuresOf(c, 'point')]
      .filter((p) => !p.labelled)
    for (const [word, ps] of groupByLabel(others)) {
      add(7, `${pluralWord(word, ps.length)} at ${capped(ps.map((p) => pointShort(p.x, p.y, p.exactX, p.exactY)), FD_LIST)}`)
      ps.forEach((p) => said.push(p))
    }
    // "all real numbers" says little next to two other curves
    if (c.domain && !(multi && ALL_REAL.test(c.domain))) add(9, `domain ${norm(c.domain)}`)
    if (c.range && !(multi && ALL_REAL.test(c.range))) add(9, `range ${norm(c.range)}`)
  }
  // labelled points: always (they are on the student copy)
  const labelled = labelledPoints(c).filter((p) => !said.some((q) => samePoint(q, p)))
  if (labelled.length) {
    const pts = labelled.map((p) => `${p.label && p.label.length <= 2 ? `${p.label} ` : ''}${pointShort(p.x, p.y, p.exactX, p.exactY)}`)
    add(answers ? 4 : 1, answers
      ? `passes through ${list(pts)}`
      : `the curve passes through the labelled ${plural(pts.length, 'point', 'points')} ${list(pts)}`)
  }
  return out
}

function jumpShort(j: DescribeJump): string {
  const x = short(j.x, j.exactX)
  const l = j.left === null ? 'undefined' : short(j.left, j.leftText)
  const r = j.right === null ? 'undefined' : short(j.right, j.rightText)
  return `jump at x = ${x} (left limit ${l}, right limit ${r})`
}

/** The dots a jump is drawn with — what a student copy shows of it. */
function jumpDots(j: DescribeJump): string[] {
  const xs = short(j.x, j.exactX)
  const near = (a: number | null, b: number | null) =>
    a !== null && b !== null && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a))
  const dots: string[] = []
  if (j.value !== null) dots.push(`a closed dot at (${xs}, ${short(j.value, j.valueText)})`)
  const open: number[] = []
  for (const [v, t] of [[j.left, j.leftText], [j.right, j.rightText]] as const) {
    if (v === null || near(v, j.value) || open.some((o) => near(o, v))) continue
    open.push(v)
    dots.push(`an open circle at (${xs}, ${short(v, t)})`)
  }
  return dots
}

function jumpMarks(j: DescribeJump): string {
  const dots = jumpDots(j).map((d) => d.replace(/^an? /, ''))
  return dots.length ? list(dots) : `break at x = ${short(j.x, j.exactX)}`
}

function sceneClauses(input: DescribeInput, answers: boolean): Clause[] {
  const out: Clause[] = []
  const add = (tier: number, text: string) => out.push({ tier, text, group: Number.POSITIVE_INFINITY })
  const inters = (input.intersections ?? []).filter((p) => answers || p.labelled).sort(byX)
  if (inters.length) {
    const names = new Set(inters.map((p) => `${p.a}\u0000${p.b}`))
    const who = names.size === 1 && inters[0].a && inters[0].b ? `${inters[0].a} and ${inters[0].b} meet` : 'curves meet'
    add(7, `${answers ? who : 'labelled intersection'}${answers ? '' : plural(inters.length, '', 's')} at ${capped(inters.map((p) => `${p.label && !answers ? `${p.label} ` : ''}${pointShort(p.x, p.y, p.exactX, p.exactY)}`), FD_LIST)}`)
  }
  for (const r of input.regions ?? []) {
    const between = r.lower ? `between ${r.upper} and ${r.lower}` : `under ${r.upper}`
    const area = answers && r.value !== undefined ? `, area ${short(r.value, r.exactValue)}` : ''
    add(8, `shaded region${r.label ? ` ${r.label}` : ''} ${between} on [${short(r.a, r.exactA)}, ${short(r.b, r.exactB)}]${area}`)
  }
  for (const s of input.riemann ?? []) {
    const sum = answers && s.value !== undefined ? `, sum ${fmt(s.value, 3)}` : ''
    const shape = s.method === 'trapezoid' ? plural(s.n, 'trapezoid', 'trapezoids') : `${riemannWord(s.method)} ${plural(s.n, 'rectangle', 'rectangles')}`
    add(8, `${s.n} ${shape} under ${s.curve} on [${short(s.a, s.exactA)}, ${short(s.b, s.exactB)}]${sum}`)
  }
  for (const t of input.tangents ?? []) add(8, tangentShort(t, answers))
  for (const e of (input.extras ?? []).map(extraText)) {
    if (!answers && e.answer) continue
    add(10, e.text.replace(/\.$/, ''))
  }
  return out
}

function tangentShort(t: DescribeTangent, answers: boolean): string {
  const kind = t.kind ?? 'tangent'
  const at = kind === 'secant' && t.x2 !== undefined
    ? `from x = ${short(t.x, t.exactX)} to x = ${short(t.x2, t.exactX2)}`
    : `at x = ${short(t.x, t.exactX)}`
  let s = `${kind} line to ${t.curve} ${at}`
  if (answers && t.text) s += `: ${norm(t.text)}`
  else if (answers && t.slope !== undefined) s += ` (slope ${short(t.slope, t.exactSlope)})`
  return s
}

/**
 * Fit a heading and clauses into `max` characters. Clauses are KEPT by
 * priority (tier) — a lower-priority clause never displaces a higher one —
 * and PRINTED grouped: the figure-wide ones, then each curve's, then the
 * scene's. With several curves each curve's group is prefixed "f: ".
 */
function assemble(
  head: string,
  sep: string,
  clauses: Clause[],
  max: number,
  groupName: (g: number) => string | null,
): string {
  const ordered = clauses.map((c, i) => ({ ...c, i })).sort((a, b) => a.tier - b.tier || a.i - b.i)
  const render = (kept: typeof ordered): string => {
    if (kept.length === 0) return `${head}.`
    const byGroup = new Map<number, typeof ordered>()
    for (const c of [...kept].sort((a, b) => a.group - b.group || a.tier - b.tier || a.i - b.i)) {
      byGroup.set(c.group, [...(byGroup.get(c.group) ?? []), c])
    }
    const parts: string[] = []
    for (const [g, cs] of byGroup) {
      const name = groupName(g)
      if (name) parts.push(`${name}: ${cs.map((c) => c.text).join(', ')}`)
      else parts.push(...cs.map((c) => c.text))
    }
    return `${head}${sep}${parts.join('; ')}.`
  }
  let kept: typeof ordered = []
  for (const c of ordered) {
    const next = [...kept, c]
    if (render(next).length <= max) kept = next
  }
  let out = render(kept)
  if (out.length > max) out = `${out.slice(0, Math.max(0, max - 1)).trimEnd()}…`
  return out
}

function oneLine(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

function figuredesc(input: DescribeInput, answers: boolean, max: number): string {
  if (isNumberLine(input)) return oneLine(numberLineShort(input.numberLine!, answers, max))
  const curves = input.curves
  const w = input.window
  const heads = curves.map((c) => curveHeading(c, answers))
  const graphOf = curves.length === 0 ? 'Coordinate grid' : `${curves.length > 1 ? 'Graphs' : 'Graph'} of ${list(heads)}`
  const scale = scaleClause(w)
  const multi = curves.length > 1
  const clauses: Clause[] = []
  // solid vs dashed is how a grayscale figure tells curves apart
  if (multi) {
    const dashed = curves.filter((c) => c.dashed).map(curveLabel)
    if (dashed.length && dashed.length < curves.length) clauses.push({ tier: 0, text: `${list(dashed)} dashed`, group: -1 })
  }
  if (!answers && scale) clauses.push({ tier: 0, text: scale, group: -1 })
  curves.forEach((c, i) => clauses.push(...curveClauses(c, answers, multi, i)))
  clauses.push(...sceneClauses(input, answers))
  if (answers && scale) clauses.push({ tier: 11, text: scale, group: Number.POSITIVE_INFINITY })
  const head = `${graphOf} on ${windowShort(w)}`
  const groupName = (g: number): string | null =>
    multi && g >= 0 && Number.isFinite(g) ? curveLabel(curves[g]) : null
  return oneLine(assemble(head, answers ? ': ' : '; ', clauses, max, groupName))
}

// ----------------------------------------------------------------------------
// Number line
// ----------------------------------------------------------------------------

function isNumberLine(input: DescribeInput): boolean {
  return input.board === 'number-line' || (!!input.numberLine && input.curves.length === 0)
}

function nlShading(nl: DescribeNumberLine): string[] {
  return nl.intervals.map((iv) => {
    const lo = iv.lo === null ? null : short(iv.lo, iv.loText)
    const hi = iv.hi === null ? null : short(iv.hi, iv.hiText)
    if (lo === null && hi === null) return 'the whole line'
    if (lo === null) return `everything to the left of ${hi}`
    if (hi === null) return `everything to the right of ${lo}`
    if (lo === hi) return `the point ${lo}`
    return `from ${lo} to ${hi}`
  })
}

function nlDots(nl: DescribeNumberLine): string[] {
  const closed = nl.points.filter((p) => p.closed).sort(byX)
  const open = nl.points.filter((p) => !p.closed).sort(byX)
  const out: string[] = []
  if (closed.length) out.push(`${plural(closed.length, 'a closed dot', 'closed dots')} at ${list(closed.map((p) => short(p.x, p.exact)))}`)
  if (open.length) out.push(`${plural(open.length, 'an open circle', 'open circles')} at ${list(open.map((p) => short(p.x, p.exact)))}`)
  return out
}

function numberLineShort(nl: DescribeNumberLine, answers: boolean, max: number): string {
  const step = nl.step !== undefined ? `, marked every ${unitWord(fmt(nl.step, 3))}` : ''
  const statement = nl.statement && (answers || nl.statementShown) ? ` showing ${norm(nl.statement)}` : ''
  const head = `Number line from ${fmt(nl.min)} to ${fmt(nl.max)}${step}${statement ? `,${statement}` : ''}`
  const clauses: Clause[] = []
  if (answers && nl.solution) {
    clauses.push({ tier: 1, group: 0, text: `solution ${norm(nl.solution)}${nl.builder && nl.builder !== nl.solution ? ` (${norm(nl.builder)})` : ''}` })
  }
  const dots = nlDots(nl)
  if (dots.length) clauses.push({ tier: 2, group: 0, text: dots.join(', ') })
  const shade = nlShading(nl)
  if (shade.length) clauses.push({ tier: 3, group: 0, text: `shaded ${list(shade)}` })
  return assemble(head, ': ', clauses, max, () => null)
}

function numberLineLong(nl: DescribeNumberLine, answers: boolean): string {
  const s: string[] = []
  const step = nl.step !== undefined ? `, marked every ${unitWord(fmt(nl.step, 3))}` : ''
  s.push(sentence(`A number line from ${fmt(nl.min)} to ${fmt(nl.max)}${step}`))
  if (nl.statement && (answers || nl.statementShown)) {
    if (answers && nl.solution) {
      const b = nl.builder && nl.builder !== nl.solution ? `, that is, ${norm(nl.builder)}` : ''
      s.push(sentence(`It shows the solution of ${norm(nl.statement)}: ${norm(nl.solution)}${b}`))
    } else s.push(sentence(`It shows the solution set of ${norm(nl.statement)}`))
  } else if (answers && nl.solution) {
    s.push(sentence(`It shows the set ${norm(nl.solution)}${nl.builder && nl.builder !== nl.solution ? `, that is, ${norm(nl.builder)}` : ''}`))
  }
  const dots = nlDots(nl)
  if (dots.length) s.push(sentence(`It has ${list(dots)}`))
  const shade = nlShading(nl)
  if (shade.length) s.push(sentence(`The shading covers ${list(shade)}`))
  else s.push('Nothing is shaded.')
  return s.join(' ')
}

// ----------------------------------------------------------------------------
// long
// ----------------------------------------------------------------------------

function overview(input: DescribeInput, answers: boolean): string {
  const w = input.window
  const xl = w.xLabel ? `${norm(w.xLabel)} (horizontal)` : 'x'
  const yl = w.yLabel ? `${norm(w.yLabel)} (vertical)` : 'y'
  const s: string[] = []
  const polar = input.board === 'polar' ? ' on a polar grid' : ''
  s.push(sentence(`A graph${polar} showing ${xl} from ${fmt(w.xMin)} to ${fmt(w.xMax)} and ${yl} from ${fmt(w.yMin)} to ${fmt(w.yMax)}`))
  const xs = stepText(w.xStep, w.xStepText)
  const ys = stepText(w.yStep, w.yStepText)
  if (xs && ys && xs === ys) s.push(sentence(`Both axes are marked every ${unitWord(xs)}`))
  else if (xs && ys) s.push(sentence(`The x-axis is marked every ${unitWord(xs)} and the y-axis every ${unitWord(ys)}`))
  else if (xs) s.push(sentence(`The x-axis is marked every ${unitWord(xs)}`))
  else if (ys) s.push(sentence(`The y-axis is marked every ${unitWord(ys)}`))
  const n = input.curves.length
  if (n === 0) s.push('No curves are drawn.')
  else if (n === 1) {
    const c = input.curves[0]
    s.push(sentence(`It shows one curve${c.name ? `, ${c.name}` : ''}${c.dashed ? ', drawn dashed' : ''}`))
  } else {
    const names = input.curves.map((c) => `${curveLabel(c)}${c.dashed ? ' (dashed)' : ' (solid)'}`)
    s.push(sentence(`It shows ${n} curves: ${list(names)}`))
  }
  if (!answers && input.curves.length) {
    // nothing else: the paragraphs below say what each curve shows
  }
  return s.join(' ')
}

function curveLong(c: DescribeCurve, answers: boolean): string {
  const s: string[] = []
  const who = c.name ? `Curve ${c.name}` : 'The curve'
  const showEq = answers || c.shows?.equation
  const kind = answers && c.kind ? `, ${/^[aeiou]/i.test(c.kind) ? 'an' : 'a'} ${c.kind}` : ''
  const style = c.dashed ? 'dashed' : 'solid'
  if (showEq && c.text) s.push(sentence(`${who}: ${norm(c.text)}${kind}${answers ? '' : `, drawn ${style}`}`))
  else s.push(sentence(`${c.name ? `The graph of ${c.name}` : 'The curve'} is drawn ${style}`))
  if (answers && (c.domain || c.range)) {
    const parts: string[] = []
    if (c.domain) parts.push(`domain ${norm(c.domain)}`)
    if (c.range) parts.push(`range ${norm(c.range)}`)
    s.push(sentence(`It has ${list(parts)}`))
  }
  const said: { x: number; y: number }[] = []
  if (answers) {
    const zeros = featuresOf(c, 'zero')
    const crossing = zeros.filter((z) => !z.tangent)
    const touching = zeros.filter((z) => z.tangent)
    if (crossing.length) s.push(sentence(`It crosses the x-axis ${countWord(crossing.length)}at ${capped(crossing.map((z) => `x = ${spoken(z.x, z.exactX)}`), LONG_LIST)}`))
    if (touching.length) s.push(sentence(`It touches the x-axis without crossing at ${capped(touching.map((z) => `x = ${spoken(z.x, z.exactX)}`), LONG_LIST)}`))
    zeros.forEach((z) => said.push(z))
    for (const p of featuresOf(c, 'y-intercept')) {
      s.push(sentence(`It crosses the y-axis at ${pointSpoken(p.x, p.y, p.exactX, p.exactY)}`))
    }
    const ext = [...featuresOf(c, 'maximum'), ...featuresOf(c, 'minimum')].sort(byX)
    if (ext.length > LONG_LIST) {
      // an oscillating curve: say how many, and where the maxima and minima are
      for (const kind of ['maximum', 'minimum'] as const) {
        const ps = featuresOf(c, kind)
        if (!ps.length) continue
        const word = kind === 'maximum' ? 'relative maxima' : 'relative minima'
        s.push(sentence(`It has ${ps.length === 1 ? `a relative ${kind}` : `${ps.length} ${word}`} in the window, at ${capped(ps.map((p) => pointSpoken(p.x, p.y, p.exactX, p.exactY)), LONG_LIST / 2)}`))
      }
      ext.forEach((p) => said.push(p))
    } else if (ext.length) {
      s.push(sentence(`It has ${list(ext.map((p) => `${/^a/.test(extremumWord(p, false)) ? 'an' : 'a'} ${extremumWord(p, false)} at ${pointSpoken(p.x, p.y, p.exactX, p.exactY)}`))}`))
      ext.forEach((p) => said.push(p))
    }
    const infl = featuresOf(c, 'inflection')
    if (infl.length) {
      s.push(sentence(infl.length > LONG_LIST
        ? `It has ${infl.length} inflection points in the window, at ${capped(infl.map((p) => pointSpoken(p.x, p.y, p.exactX, p.exactY)), LONG_LIST / 2)}`
        : `${plural(infl.length, 'Its inflection point is', 'Its inflection points are')} at ${list(infl.map((p) => pointSpoken(p.x, p.y, p.exactX, p.exactY)))}`))
      infl.forEach((p) => said.push(p))
    }
    const others = [...featuresOf(c, 'extreme'), ...featuresOf(c, 'petal-tip'), ...featuresOf(c, 'point')].filter((p) => !p.labelled)
    for (const [word, ps] of groupByLabel(others)) {
      const at = capped(ps.map((p) => pointSpoken(p.x, p.y, p.exactX, p.exactY)), LONG_LIST)
      s.push(sentence(`Its ${pluralWord(word, ps.length)} ${ps.length === 1 ? 'is' : 'are'} at ${at}`))
    }
  }
  if (c.asymptotes?.length && (answers || asymptotesShown(c))) {
    const drawn = answers ? '' : ', drawn dashed'
    if (answers) {
      s.push(sentence(`It has ${list(asymptoteGroups(c.asymptotes).map((g) => `the ${g}`))}${drawn}`))
    } else {
      s.push(sentence(`${plural(c.asymptotes.length, 'A dashed line is', 'Dashed lines are')} drawn at ${list(c.asymptotes.map(asymptoteShort))}`))
    }
  }
  if (answers || markersShown(c)) {
    const holes = c.holes ?? []
    if (holes.length) {
      const at = list(holes.map((h) => pointSpoken(h.x, h.y, h.exactX, h.exactY)))
      s.push(sentence(answers
        ? `It has ${plural(holes.length, 'a hole', 'holes')}, drawn as ${plural(holes.length, 'an open circle', 'open circles')}, at ${at}`
        : `It has ${plural(holes.length, 'an open circle', 'open circles')} at ${at}`))
      holes.forEach((h) => said.push(h))
    }
    for (const j of c.jumps ?? []) s.push(answers ? jumpLong(j) : jumpLongMarks(j))
    const ends = featuresOf(c, 'endpoint')
    if (ends.length) {
      s.push(sentence(`It ends at ${list(ends.map((p) => `${pointSpoken(p.x, p.y, p.exactX, p.exactY)} with ${p.closed === false ? 'an open circle' : 'a closed dot'}`))}`))
      ends.forEach((p) => said.push(p))
    }
  }
  const labelled = labelledPoints(c).filter((p) => answers ? !said.some((q) => samePoint(q, p)) || !!p.label : true)
  if (labelled.length) {
    const pts = labelled.map((p) => `${p.label && p.label.length <= 3 ? `${p.label} at ` : ''}${pointSpoken(p.x, p.y, p.exactX, p.exactY)}`)
    s.push(sentence(`It passes through the labelled ${plural(labelled.length, 'point', 'points')} ${list(pts)}`))
  }
  if (answers) for (const n of c.notes ?? []) s.push(sentence(n))
  return s.join(' ')
}

function jumpLong(j: DescribeJump): string {
  const xs = short(j.x, j.exactX)
  const parts: string[] = []
  if (j.left !== null) parts.push(`from the left it approaches ${spoken(j.left, j.leftText)}`)
  else parts.push('it is not defined just to the left')
  if (j.right !== null) parts.push(`from the right it approaches ${spoken(j.right, j.rightText)}`)
  else parts.push('it is not defined just to the right')
  const dots = jumpDots(j)
  const undef = j.value === null ? `; it is undefined at x = ${xs}` : ''
  return sentence(`At x = ${spoken(j.x, j.exactX)} the graph jumps: ${parts.join(', and ')}${dots.length ? `; it shows ${list(dots)}` : ''}${undef}`)
}

function jumpLongMarks(j: DescribeJump): string {
  const dots = jumpDots(j)
  return sentence(dots.length
    ? `At x = ${short(j.x, j.exactX)} the graph breaks, with ${list(dots)}`
    : `The graph breaks at x = ${short(j.x, j.exactX)}`)
}

function sceneLong(input: DescribeInput, answers: boolean): string {
  const s: string[] = []
  const inters = (input.intersections ?? []).filter((p) => answers || p.labelled).sort(byX)
  if (inters.length) {
    // group by pair
    const pairs = new Map<string, DescribeIntersection[]>()
    for (const p of inters) {
      const key = `${p.a}\u0000${p.b}`
      pairs.set(key, [...(pairs.get(key) ?? []), p])
    }
    for (const pts of pairs.values()) {
      const { a, b } = pts[0]
      s.push(sentence(`The curves ${a} and ${b} intersect at ${capped(pts.map((p) => `${p.label && !answers ? `${p.label} ` : ''}${pointSpoken(p.x, p.y, p.exactX, p.exactY)}`), LONG_LIST)}`))
    }
  }
  for (const r of input.regions ?? []) {
    const name = r.label ? `The shaded region ${r.label}` : 'A shaded region'
    const where = r.lower
      ? `lies between ${r.upper} (above) and ${r.lower} (below)`
      : `lies between ${r.upper} and the x-axis`
    const area = answers && r.value !== undefined ? `; its area is ${spoken(r.value, r.exactValue)}` : ''
    s.push(sentence(`${name} ${where} from x = ${spoken(r.a, r.exactA)} to x = ${spoken(r.b, r.exactB)}${area}`))
  }
  for (const q of input.riemann ?? []) {
    const shape = q.method === 'trapezoid' ? plural(q.n, 'trapezoid', 'trapezoids') : `${riemannWord(q.method)} ${plural(q.n, 'rectangle', 'rectangles')}`
    const sum = answers && q.value !== undefined ? `; their total area is ${fmt(q.value, 3)}` : ''
    s.push(sentence(`${q.n} ${shape} of equal width approximate the area under ${q.curve} from x = ${spoken(q.a, q.exactA)} to x = ${spoken(q.b, q.exactB)}${sum}`))
  }
  for (const t of input.tangents ?? []) {
    const kind = t.kind ?? 'tangent'
    const at = kind === 'secant' && t.x2 !== undefined
      ? `through the points of ${t.curve} at x = ${spoken(t.x, t.exactX)} and x = ${spoken(t.x2, t.exactX2)}`
      : `to ${t.curve} at x = ${spoken(t.x, t.exactX)}`
    let tail = ''
    if (answers && t.slope !== undefined) tail += `; its slope is ${spoken(t.slope, t.exactSlope)}`
    if (answers && t.text) tail += ` and its equation is ${norm(t.text)}`
    s.push(sentence(`A ${kind} line is drawn ${at}${tail}`))
  }
  for (const e of (input.extras ?? []).map(extraText)) {
    if (!answers && e.answer) continue
    s.push(sentence(e.text))
  }
  return s.join(' ')
}

function longText(input: DescribeInput, answers: boolean): string {
  if (isNumberLine(input)) return numberLineLong(input.numberLine!, answers)
  const paras: string[] = [overview(input, answers)]
  for (const c of input.curves) paras.push(curveLong(c, answers))
  const scene = sceneLong(input, answers)
  if (scene) paras.push(scene)
  if (input.numberLine) paras.push(numberLineLong(input.numberLine, answers))
  return paras.filter(Boolean).join('\n\n')
}

// ----------------------------------------------------------------------------
// Entry point
// ----------------------------------------------------------------------------

export function describeScene(input: DescribeInput, opts?: DescribeOptions): GraphDescription {
  const answers = opts?.answers !== false
  const max = Math.max(40, opts?.maxLength ?? DEFAULT_MAX)
  const safe: DescribeInput = {
    ...input,
    window: input.window,
    curves: (input.curves ?? []).filter(Boolean),
  }
  return {
    figuredesc: figuredesc(safe, answers, max),
    long: longText(safe, answers),
  }
}

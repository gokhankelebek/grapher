// ============================================================================
// Build a DescribeInput (src/core/describeGraph.ts) from the board's own
// analysis — analyzeCurve, findHoles / findAsymptotes, curveDomain /
// curveRange, intersectionPoints, the calculus helpers and the number-line
// solver — so the description says exactly what the cards say.
//
//   describeInputFromCurves(input: AdapterInput): DescribeInput
//   describeCurves(input: AdapterInput, opts?): GraphDescription   (both steps)
//   numberLineFromSolve(result, min, max, step?): DescribeNumberLine
//   latexToPlain(latex): string                                     (equation text fallback)
//
// Everything is filtered to the window: a figure description says what the
// figure shows, and a zero at x = 40 is not on a [−5, 5] figure.
//
// Imports only from src/core/*.
// ============================================================================

import type { Asymptote, FittedCurve, ModelSpec, Shape, SpecialPoint, Vec2 } from './types'
import { triangleCentres } from './triangleCentres'
import { pointText as geoPoint, polygonReport, segmentReport, withApprox, distance, slope as geoSlope, midpoint as geoMid } from './geometry'
import { analyzeCurve, pairMeeting } from './analyze'
import { findAsymptotes, findHoles } from './holes'
import { curveDomain, curveRange, type RealSet } from './domainRange'
import { exactForm } from './exact'
import { areaBetween, areaUnder, polynomialOf, riemann, tangentAt, type RiemannMethod } from './calculus'
import { prettyMath } from './ineqText'
import { piecewiseParts } from './parse'
import { conicFeatures, readConic } from './conics'
import type { SolveResult } from './solveInequality'
import {
  describeScene,
  type DescribeAsymptote,
  type DescribeCurve,
  type DescribeHole,
  type DescribeInput,
  type DescribeJump,
  type DescribeNumberLine,
  type DescribeOptions,
  type DescribePoint,
  type DescribeRegion,
  type DescribeRiemann,
  type DescribeTangent,
  type DescribeWindow,
  type DescribeExtra,
  type DescribeIntersection,
  type GraphDescription,
} from './describeGraph'

// ----------------------------------------------------------------------------
// Input
// ----------------------------------------------------------------------------

export interface AdapterCurve {
  curve: FittedCurve
  /** the name the figure uses ("f", "f′"); default: the typed head, else '' */
  name?: string
  /** the line as typed ("f(x) = x^3 - 3x"): the equation text and the conic reading come from it */
  source?: string
  /** override the equation text */
  text?: string
  /** override the kind in words */
  kind?: string
  /** points the figure labels: plain coordinates, or { x, y, label } */
  labelled?: (Vec2 & { label?: string; exactX?: string; exactY?: string })[]
  dashed?: boolean
  shows?: DescribeCurve['shows']
  /** extra sentences for this curve (answers only) */
  notes?: string[]
}

/** A calculus object on the figure, by curve id; the adapter computes its numbers. */
export type AdapterCalc =
  | { kind: 'area'; curve: string; other?: string; a: number; b: number; label?: string }
  | { kind: 'riemann'; curve: string; a: number; b: number; n: number; method: RiemannMethod }
  | { kind: 'tangent'; curve: string; x: number }
  | { kind: 'secant'; curve: string; x: number; x2: number }

export interface AdapterInput {
  window: DescribeWindow
  curves: AdapterCurve[]
  models: Record<string, ModelSpec>
  /** compute pairwise intersections of the visible curves (default true) */
  intersections?: boolean
  /** intersection points the figure labels (matched to computed ones by position) */
  labelledIntersections?: (Vec2 & { label?: string })[]
  calc?: AdapterCalc[]
  numberLine?: DescribeNumberLine
  extras?: (string | DescribeExtra)[]
  /** Statistics figures: normal curves and simulations (see describeStats). */
  stats?: DescribeStat[]
  board?: DescribeInput['board']
}

/**
 * A statistics figure, as the description states it: a normal curve with its
 * shading, or a simulation's dot plot / histogram with what it found.
 */
export type DescribeStat =
  | {
      kind: 'normal'
      mu: number
      sigma: number
      mode: 'below' | 'above' | 'between' | 'outside' | 'percentile'
      /** The bound(s) in order; percentile mode: the x it marks. */
      bounds: number[]
      z: number[]
      /** The probability (percentile: the share below). */
      p: number
      pct: number
      rule: boolean
    }
  | {
      kind: 'sample'
      /** "a normal population (μ = 100, σ = 15)". */
      population: string
      stat: 'mean' | 'proportion'
      symbol: string
      n: number
      reps: number
      plot: 'dots' | 'hist'
      theory: { center: number; sd: number } | null
      mean: number
      sd: number
      me95: number
    }
  | {
      kind: 'compare'
      nA: number
      nB: number
      reps: number
      plot: 'dots' | 'hist'
      observed: number
      extreme: number
      p: number
      tail: 'two' | 'upper' | 'lower'
    }
  | {
      /** A one-variable data plot: dot plot / histogram and/or box plot, one row per set. */
      kind: 'data'
      dist: 'dots' | 'hist' | 'none'
      box: boolean
      binWidth: number | null
      sets: {
        name: string
        /** Values analysed (after any left out). */
        n: number
        /** Values left out. */
        left: number
        five: [number, number, number, number, number]
        mean: number
        sd: number
        outliers: number[]
        /** "appears skewed right". */
        shape: string
      }[]
      /** The comparison sentence ('' for one set). */
      compare: string
    }
  | {
      /** A probability object (two-way table, Venn or tree diagram): its sentences, answers flagged. */
      kind: 'prob'
      lines: { text: string; answer?: boolean }[]
    }
  | {
      /** A residual plot under a data table's scatter plot. */
      kind: 'resid'
      table: string
      /** "linear", "quadratic" … */
      model: string
      n: number
      maxAbs: number
      verdict: 'none' | 'curved' | 'few'
      /** The card's verdict sentence. */
      sentence: string
      r: number | null
    }

// ----------------------------------------------------------------------------
// Text helpers
// ----------------------------------------------------------------------------

const MINUS = '−'

/** A KaTeX string as plain Unicode — the fallback when no typed source is known. */
export function latexToPlain(latex: string): string {
  let s = String(latex ?? '')
  const SUP: Record<string, string> = {
    '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻',
  }
  // innermost-first rewrites of \frac and \sqrt
  for (let guard = 0; guard < 20; guard++) {
    const before = s
    s = s.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, (_m, a: string, b: string) => {
      const wrap = (t: string) => (/^[\w.√π]+$/.test(t) ? t : `(${t})`)
      return `${wrap(a)}/${wrap(b)}`
    })
    s = s.replace(/\\sqrt\[3\]\{([^{}]*)\}/g, '∛($1)')
    s = s.replace(/\\sqrt\{([^{}]*)\}/g, (_m, a: string) => (/^[\w.]+$/.test(a) ? `√${a}` : `√(${a})`))
    s = s.replace(/\^\{([^{}]*)\}/g, (_m, a: string) => {
      const t = a.replace(/\s+/g, '')
      return /^-?\d+$/.test(t) ? [...t].map((c) => SUP[c] ?? c).join('') : `^(${a})`
    })
    if (s === before) break
  }
  s = s
    .replace(/\\left|\\right|\\displaystyle/g, '')
    .replace(/\\,|\\;|\\!|\\quad/g, ' ')
    .replace(/\\operatorname\{([^{}]*)\}/g, '$1')
    .replace(/\\text\{([^{}]*)\}/g, '$1')
    .replace(/\\begin\{cases\}/g, '{ ')
    .replace(/\\end\{cases\}/g, ' }')
    .replace(/\\\\/g, '; ')
    .replace(/&/g, ' if ')
    .replace(/\\cdot|\\times/g, '·')
    .replace(/\\pi/g, 'π')
    .replace(/\\theta/g, 'θ')
    .replace(/\\infty/g, '∞')
    .replace(/\\leq?|\\le/g, '≤')
    .replace(/\\geq?|\\ge/g, '≥')
    .replace(/\\neq?/g, '≠')
    .replace(/\\in/g, '∈')
    .replace(/\\cup/g, '∪')
    .replace(/\\(arcsin|arccos|arctan|sinh|cosh|tanh|sin|cos|tan|sec|csc|cot|ln|log|exp)/g, '$1')
    .replace(/\^(-?\d)/g, (_m, d: string) => [...d].map((c) => SUP[c] ?? c).join(''))
    .replace(/[{}]/g, (c) => (c === '{' ? '' : ''))
    .replace(/\\/g, '')
    .replace(/-/g, MINUS)
    .replace(/\s+/g, ' ')
    .trim()
  return s
}

/** The equation text a description prints for a curve. */
function equationText(c: AdapterCurve, spec: ModelSpec | undefined): string {
  if (c.text) return c.text
  if (c.source) {
    try { return typedText(c.source) } catch { /* fall through */ }
  }
  if (spec) {
    try { return latexToPlain(spec.latex(c.curve.params)) } catch { /* nothing */ }
  }
  return ''
}

/** A typed line as Unicode; a piecewise or restricted line piece by piece. */
export function typedText(src: string): string {
  const parts = piecewiseParts(src)
  if (!parts) return prettyMath(src)
  const head = parts.head ? `${prettyMath(parts.head)} = ` : ''
  if (parts.restricted && parts.branches.length === 1) {
    const b = parts.branches[0]
    return `${head}${prettyMath(b.expr)} for ${prettyMath(b.cond)}`
  }
  const pieces = parts.branches.map((b) =>
    b.otherwise || !b.cond ? `${prettyMath(b.expr)} otherwise` : `${prettyMath(b.expr)} if ${prettyMath(b.cond)}`)
  return `${head}{${pieces.join('; ')}}`
}

/** "f" from "f(x) = …", "r" from "r = …", '' otherwise. */
function nameFromSource(src: string | undefined): string {
  if (!src) return ''
  const m = /^\s*([A-Za-z])\s*(['′]*)\s*\(\s*(?:[A-Za-z]+|θ)\s*\)\s*=/.exec(src)
  if (m) return m[1] + '′'.repeat(m[2].length)
  return ''
}

const POLY_WORDS = ['constant function', 'linear function', 'quadratic function (a parabola)', 'cubic polynomial', 'quartic polynomial', 'quintic polynomial']

function kindOf(c: AdapterCurve, spec: ModelSpec | undefined, models: Record<string, ModelSpec>): string {
  if (c.kind) return c.kind
  const curve = c.curve
  if (curve.kind === 'polar') return 'polar curve'
  if (curve.kind === 'parametric') return 'parametric curve'
  if (curve.kind === 'implicit') {
    const conic = c.source ? safe(() => readConic(c.source!)) : null
    if (conic) return conic.kind
    if (curve.modelId === 'circle' || curve.modelId === 'ellipse') return curve.modelId
    return 'implicit curve'
  }
  if (spec?.inequality) return 'inequality boundary'
  const pieces = spec?.pieces ? safe(() => spec.pieces!(curve.params)) : null
  if (pieces && pieces.length > 1) return 'piecewise function'
  const poly = safe(() => polynomialOf(curve, models))
  if (poly) {
    let deg = poly.length - 1
    while (deg > 0 && Math.abs(poly[deg]) < 1e-12) deg--
    return POLY_WORDS[deg] ?? `polynomial of degree ${deg}`
  }
  const sing = spec?.singularities ? safe(() => spec.singularities!(curve.params, [-50, 50])) : null
  if (sing && sing.length && c.source && /\//.test(c.source) && !/(sin|cos|tan|sec|csc|cot|ln|log|e\^)/.test(c.source)) {
    return 'rational function'
  }
  if (spec?.name && spec.name !== 'Expression' && !/^expr/i.test(spec.name)) return spec.name.toLowerCase()
  const family = c.source ? familyOf(c.source) : null
  return family ?? 'function'
}

/** The family a typed formula belongs to, when it uses exactly one kind of function. */
function familyOf(src: string): string | null {
  const rhs = src.slice(src.indexOf('=') + 1)
  const word = (w: string) => new RegExp(`(?<![A-Za-z])(?:${w})(?![A-Za-z])`)
  const has = {
    trig: word('sin|cos|tan|sec|csc|cot').test(rhs),
    inverseTrig: word('asin|acos|atan|arcsin|arccos|arctan').test(rhs),
    log: word('ln|log(?:_\\w+)?').test(rhs) || /(?<![A-Za-z])log_/.test(rhs),
    exp: word('exp').test(rhs) || /(?<![A-Za-z])e\s*\^|\d\s*\^\s*\(?[^)]*x/.test(rhs),
    root: word('sqrt|cbrt').test(rhs),
    abs: /\||(?<![A-Za-z])abs(?![A-Za-z])/.test(rhs),
  }
  const on = Object.entries(has).filter(([, v]) => v).map(([k]) => k)
  if (on.length !== 1) return null
  switch (on[0]) {
    case 'trig': return 'trigonometric function'
    case 'inverseTrig': return 'inverse trigonometric function'
    case 'log': return 'logarithmic function'
    case 'exp': return /\/\s*\(?\s*\d+\s*\+/.test(rhs) ? 'logistic function' : 'exponential function'
    case 'root': return 'radical function'
    case 'abs': return 'absolute value function'
  }
  return null
}

function safe<T>(f: () => T): T | null {
  try { return f() } catch { return null }
}

/** Exact text for a computed value, only when it is a confident closed form. */
function ex(v: number): string | undefined {
  const f = exactForm(v, { tol: 1e-9 })
  return f ? f.text : undefined
}

function inWindow(p: { x: number; y: number }, w: DescribeWindow): boolean {
  const sx = (w.xMax - w.xMin) * 1e-6
  const sy = (w.yMax - w.yMin) * 1e-6
  return p.x >= w.xMin - sx && p.x <= w.xMax + sx && p.y >= w.yMin - sy && p.y <= w.yMax + sy
}

function setWords(s: RealSet | null): string | undefined {
  if (!s || s.kind === 'unknown') return undefined
  return s.builder || s.text
}

// ----------------------------------------------------------------------------
// Per-curve
// ----------------------------------------------------------------------------

function pointOf(p: SpecialPoint): DescribePoint | null {
  const kind = p.kind
  if (kind === 'hole' || kind === 'intersection') return null
  const out: DescribePoint = { kind, x: p.pos.x, y: p.pos.y }
  if (p.exactX) out.exactX = p.exactX
  if (p.exactY) out.exactY = p.exactY
  if (p.tangent) out.tangent = true
  if (kind === 'extreme') out.label = p.label
  // a zero's y is 0 and the y-intercept's x is 0 by definition
  if (kind === 'zero') out.exactY = '0'
  if (kind === 'y-intercept') out.exactX = '0'
  return out
}

function asymptoteOf(a: Asymptote): DescribeAsymptote | null {
  if (a.kind === 'vertical') {
    const out: DescribeAsymptote = { kind: 'vertical', x: a.x }
    const e = ex(a.x)
    if (e) out.exact = e
    return out
  }
  const { a: p, dir } = a
  if (Math.abs(dir.x) < 1e-12) {
    return { kind: 'line', text: `x = ${ex(p.x) ?? fmtN(p.x)}` }
  }
  const m = dir.y / dir.x
  const b = p.y - m * p.x
  if (Math.abs(m) < 1e-12) {
    const out: DescribeAsymptote = { kind: 'horizontal', y: b }
    const e = ex(b)
    if (e) out.exact = e
    return out
  }
  return { kind: 'slant', m, b }
}

function fmtN(v: number): string {
  const r = Number(v.toPrecision(4))
  return String(r).replace('-', MINUS)
}

/** Breaks between pieces where the one-sided limits differ, and the restricted ends. */
function jumpsAndEnds(curve: FittedCurve, spec: ModelSpec | undefined, w: DescribeWindow): { jumps: DescribeJump[]; ends: DescribePoint[] } {
  const jumps: DescribeJump[] = []
  const ends: DescribePoint[] = []
  if (!spec?.evalExplicit || !spec.pieces) return { jumps, ends }
  const pieces = safe(() => spec.pieces!(curve.params)) ?? []
  if (pieces.length === 0) return { jumps, ends }
  const f = (x: number) => spec.evalExplicit!(curve.params, x)
  const limit = (x: number, side: -1 | 1): number | null => {
    const vals: number[] = []
    for (const h of [1e-5, 1e-7, 1e-9]) {
      const v = f(x + side * h * Math.max(1, Math.abs(x)))
      if (!Number.isFinite(v)) return null
      vals.push(v)
    }
    // linear extrapolation to h = 0 from the two smallest steps
    const v = vals[2]
    const e = exactForm(v, { tol: 1e-6 })
    return e ? e.value : Number(v.toPrecision(10))
  }
  const valueAt = (x: number): number | null => {
    const v = f(x)
    return Number.isFinite(v) ? v : null
  }
  const ps = [...pieces].sort((p, q) => p.lo - q.lo)
  const same = (a: number, b: number) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a))
  const endpoint = (x: number, side: -1 | 1, closed: boolean) => {
    if (x < w.xMin || x > w.xMax) return
    const inside = limit(x, side)
    const at = closed ? valueAt(x) : null
    const y = at ?? inside
    if (y === null) return
    const p: DescribePoint = { kind: 'endpoint', x, y, closed }
    const exX = ex(x); if (exX) p.exactX = exX
    const ey = ex(y); if (ey) p.exactY = ey
    if (inWindow(p, w)) ends.push(p)
  }
  ps.forEach((p, i) => {
    const prev = ps[i - 1]
    const next = ps[i + 1]
    if (Number.isFinite(p.lo) && !(prev && same(prev.hi, p.lo))) endpoint(p.lo, 1, p.loClosed)
    if (Number.isFinite(p.hi) && !(next && same(next.lo, p.hi))) endpoint(p.hi, -1, p.hiClosed)
    if (!next || !Number.isFinite(p.hi) || !same(next.lo, p.hi)) return
    // a junction between two pieces
    const x = p.hi
    if (x < w.xMin || x > w.xMax) return
    const L = limit(x, -1)
    const R = limit(x, 1)
    if (L === null || R === null) return
    const tol = 1e-6 * Math.max(1, Math.abs(L), Math.abs(R))
    if (Math.abs(L - R) <= tol) return // continuous, or a hole (findHoles reports that one)
    const V = p.hiClosed || next.loClosed ? valueAt(x) : null
    const j: DescribeJump = { x, left: L, right: R, value: V }
    const exactX = ex(x); if (exactX) j.exactX = exactX
    const el = ex(L); if (el) j.leftText = el
    const er = ex(R); if (er) j.rightText = er
    if (V !== null) { const ev = ex(V); if (ev) j.valueText = ev }
    jumps.push(j)
  })
  return { jumps, ends }
}

function describeOne(c: AdapterCurve, input: AdapterInput): DescribeCurve {
  const { models, window: w } = input
  const curve = c.curve
  const spec = models[curve.modelId]
  const range: [number, number] = [w.xMin, w.xMax]
  const out: DescribeCurve = {
    name: c.name ?? nameFromSource(c.source),
    text: equationText(c, spec),
    kind: kindOf(c, spec, models),
  }
  if (c.dashed) out.dashed = true
  if (c.shows) out.shows = c.shows
  if (c.notes?.length) out.notes = [...c.notes]

  const analysis = safe(() => analyzeCurve(curve, models)) ?? []
  const features: DescribePoint[] = []
  for (const p of analysis) {
    const d = pointOf(p)
    if (d && inWindow(d, w)) features.push(d)
  }
  // holes: analyzeCurve's carry exact forms; findHoles fills in any it skipped
  const holes: DescribeHole[] = []
  for (const p of analysis) {
    if (p.kind !== 'hole' || !inWindow(p.pos, w)) continue
    const h: DescribeHole = { x: p.pos.x, y: p.pos.y }
    if (p.exactX) h.exactX = p.exactX
    if (p.exactY) h.exactY = p.exactY
    holes.push(h)
  }
  for (const h of safe(() => findHoles(curve, models, range)) ?? []) {
    if (!inWindow(h, w) || holes.some((k) => Math.abs(k.x - h.x) < 1e-6)) continue
    const d: DescribeHole = { x: h.x, y: h.y }
    const exX = ex(h.x); if (exX) d.exactX = exX
    const exY = ex(h.y); if (exY) d.exactY = exY
    holes.push(d)
  }
  if (holes.length) out.holes = holes.sort((a, b) => a.x - b.x)

  const asym = (safe(() => findAsymptotes(curve, models, range)) ?? [])
    .map(asymptoteOf)
    .filter((a): a is DescribeAsymptote => a !== null)
    .filter((a) => a.kind !== 'vertical' || (a.x >= w.xMin && a.x <= w.xMax))
  if (asym.length) out.asymptotes = asym

  if (curve.kind === 'explicit') {
    const { jumps, ends } = jumpsAndEnds(curve, spec, w)
    if (jumps.length) out.jumps = jumps
    features.push(...ends)
    // a jump's own dots are said with the jump, not as stray extrema
    const d = setWords(safe(() => curveDomain(curve, models)))
    const r = setWords(safe(() => curveRange(curve, models)))
    if (d) out.domain = d
    if (r) out.range = r
  }

  // a typed conic: its centre, vertices, foci and the rest, in sentences
  if (curve.kind === 'implicit' && c.source) {
    const conic = safe(() => readConic(c.source!))
    if (conic) {
      const feats = safe(() => conicFeatures(conic))
      if (feats) {
        const center = conic.kind === 'parabola' ? 'vertex' : 'center'
        if (feats.center) features.push({ kind: 'point', x: feats.center.x, y: feats.center.y, exactX: feats.center.xText, exactY: feats.center.yText, label: center })
        if (conic.kind !== 'circle') {
          feats.vertices.forEach((v) => features.push({ kind: 'point', x: v.x, y: v.y, exactX: v.xText, exactY: v.yText, label: 'vertex' }))
          feats.foci.forEach((v) => features.push({ kind: 'point', x: v.x, y: v.y, exactX: v.xText, exactY: v.yText, label: 'focus' }))
        }
        const notes: string[] = []
        if (conic.kind === 'circle') notes.push(`Its radius is ${conic.a.replace(/-/g, MINUS)}`)
        if (feats.directrix) notes.push(`Its directrix is ${feats.directrix.text}`)
        if (feats.asymptotes.length) notes.push(`Its asymptotes are ${feats.asymptotes.map((a) => a.text).join(' and ')}`)
        if (conic.kind === 'ellipse' || conic.kind === 'hyperbola') {
          const e = ex(feats.eccentricity)
          if (Number.isFinite(feats.eccentricity)) notes.push(`Its eccentricity is ${e ?? fmtN(feats.eccentricity)}`)
        }
        out.notes = [...(out.notes ?? []), ...notes]
      }
    }
  }

  for (const l of c.labelled ?? []) {
    const hit = features.find((p) => Math.abs(p.x - l.x) < 1e-6 && Math.abs(p.y - l.y) < 1e-6)
    if (hit) {
      hit.labelled = true
      if (l.label) hit.label = l.label
      continue
    }
    const p: DescribePoint = { kind: 'point', x: l.x, y: l.y, labelled: true }
    if (l.label) p.label = l.label
    const exX = l.exactX ?? ex(l.x); if (exX) p.exactX = exX
    const exY = l.exactY ?? ex(l.y); if (exY) p.exactY = exY
    features.push(p)
  }
  if (features.length) out.features = features.sort((a, b) => a.x - b.x)
  return out
}

// ----------------------------------------------------------------------------
// Scene
// ----------------------------------------------------------------------------

export function describeInputFromCurves(input: AdapterInput): DescribeInput {
  const w = input.window
  const visible = input.curves.filter((c) => c.curve.visible !== false)
  const described = visible.map((c) => describeOne(c, input))
  // unnamed curves still need a handle for intersections and regions
  const label = new Map<string, string>()
  visible.forEach((c, i) => label.set(c.curve.id, described[i].name || `curve ${i + 1}`))

  const out: DescribeInput = { window: w, curves: described }
  if (input.board) out.board = input.board

  const sameExtras: DescribeExtra[] = []
  if (input.intersections !== false) {
    const inters: DescribeIntersection[] = []
    for (let i = 0; i < visible.length; i++) {
      for (let j = i + 1; j < visible.length; j++) {
        const meet = safe(() => pairMeeting(visible[i].curve, visible[j].curve, input.models, [w.xMin, w.xMax]))
        const pts = meet?.points ?? []
        if (meet?.coincide) {
          const a = label.get(visible[i].curve.id)!
          const b = label.get(visible[j].curve.id)!
          sameExtras.push(
            {
              text: meet.coincide.everywhere
                ? `${a} and ${b} are the same function: their graphs coincide everywhere.`
                : meet.coincide.except && meet.coincide.except.length > 0
                  ? `${a} and ${b} coincide except at ${meet.coincide.except.map((e) => `x = ${e.exact ?? String(Number(e.x.toPrecision(4))).replace('-', '−')}`).join(' and ')}, where only one of them is defined.`
                  : `${a} and ${b} coincide on part of the window.`,
              answer: true,
            },
          )
        }
        for (const p of pts) {
          if (!inWindow(p.pos, w)) continue
          const d: DescribeIntersection = { a: label.get(visible[i].curve.id)!, b: label.get(visible[j].curve.id)!, x: p.pos.x, y: p.pos.y }
          if (p.exactX) d.exactX = p.exactX
          if (p.exactY) d.exactY = p.exactY
          const lab = input.labelledIntersections?.find((q) => Math.abs(q.x - p.pos.x) < 1e-3 && Math.abs(q.y - p.pos.y) < 1e-3)
          if (lab) {
            d.labelled = true
            if (lab.label) d.label = lab.label
          }
          inters.push(d)
        }
      }
    }
    if (inters.length) out.intersections = inters
  }

  const byId = new Map(input.curves.map((c) => [c.curve.id, c.curve]))
  const regions: DescribeRegion[] = []
  const sums: DescribeRiemann[] = []
  const tangents: DescribeTangent[] = []
  for (const k of input.calc ?? []) {
    const curve = byId.get(k.curve)
    if (!curve) continue
    const name = label.get(k.curve) ?? 'the curve'
    if (k.kind === 'area') {
      const other = k.other ? byId.get(k.other) : undefined
      const res = other ? safe(() => areaBetween(curve, other, input.models, k.a, k.b, true)) : safe(() => areaUnder(curve, input.models, k.a, k.b))
      const r: DescribeRegion = { upper: name, a: k.a, b: k.b }
      if (k.other) {
        // which one is on top: compare at the midpoint
        const mid = (k.a + k.b) / 2
        const f = input.models[curve.modelId]?.evalExplicit
        const g = other ? input.models[other.modelId]?.evalExplicit : undefined
        const fv = f ? f(curve.params, mid) : NaN
        const gv = g && other ? g(other.params, mid) : NaN
        const otherName = label.get(k.other) ?? 'the other curve'
        if (Number.isFinite(fv) && Number.isFinite(gv) && gv > fv) {
          r.upper = otherName
          r.lower = name
        } else r.lower = otherName
      }
      if (k.label) r.label = k.label
      const ea = ex(k.a); if (ea) r.exactA = ea
      const eb = ex(k.b); if (eb) r.exactB = eb
      if (res) {
        r.value = k.other ? Math.abs(res.value) : res.value
        const ev = ex(r.value); if (ev) r.exactValue = ev
      }
      regions.push(r)
    } else if (k.kind === 'riemann') {
      const res = safe(() => riemann(curve, input.models, k.a, k.b, k.n, k.method))
      const r: DescribeRiemann = { curve: name, method: k.method, n: k.n, a: k.a, b: k.b }
      const ea = ex(k.a); if (ea) r.exactA = ea
      const eb = ex(k.b); if (eb) r.exactB = eb
      if (res) r.value = res.value
      sums.push(r)
    } else if (k.kind === 'tangent') {
      const t = safe(() => tangentAt(curve, input.models, k.x))
      const d: DescribeTangent = { curve: name, x: k.x }
      const exX = ex(k.x); if (exX) d.exactX = exX
      if (t) {
        d.slope = t.m
        const em = ex(t.m); if (em) d.exactSlope = em
        d.text = `y = ${lineWords(t.m, t.b)}`
      }
      tangents.push(d)
    } else {
      const spec = input.models[curve.modelId]
      const f = spec?.evalExplicit
      const d: DescribeTangent = { curve: name, x: k.x, kind: 'secant', x2: k.x2 }
      const e1 = ex(k.x); if (e1) d.exactX = e1
      const e2 = ex(k.x2); if (e2) d.exactX2 = e2
      if (f && k.x2 !== k.x) {
        const m = (f(curve.params, k.x2) - f(curve.params, k.x)) / (k.x2 - k.x)
        if (Number.isFinite(m)) {
          d.slope = m
          const em = ex(m); if (em) d.exactSlope = em
        }
      }
      tangents.push(d)
    }
  }
  if (regions.length) out.regions = regions
  if (sums.length) out.riemann = sums
  if (tangents.length) out.tangents = tangents
  if (input.numberLine) out.numberLine = input.numberLine
  const extras = [...(input.extras ?? []), ...sameExtras, ...describeStats(input.stats ?? [])]
  if (extras.length) out.extras = extras
  return out
}

// ----------------------------------------------------------------------------
// Statistics figures
// ----------------------------------------------------------------------------

const sNum = (v: number, d = 4): string => {
  if (!Number.isFinite(v)) return 'undefined'
  const t = String(Number(v.toFixed(d)))
  return t.replace(/^-/, MINUS)
}

const fixedN = (v: number, d: number): string => v.toFixed(d).replace(/^-/, MINUS)

/**
 * The sentences a statistics figure contributes: what is drawn (always), and
 * what it shows (answers only — a student copy keeps the question).
 */
export function describeStats(list: readonly DescribeStat[]): DescribeExtra[] {
  const out: DescribeExtra[] = []
  for (const s of list) {
    if (s.kind === 'normal') {
      out.push({ text: `A normal curve with mean ${sNum(s.mu)} and standard deviation ${sNum(s.sigma)} is drawn, with a z-scale beneath its x-axis.` })
      const [a, b] = s.bounds.map((v) => sNum(v))
      if (s.mode === 'percentile') {
        out.push({ text: `The ${sNum(s.pct)}th percentile is marked, with the area below it shaded.` })
        out.push({ text: `The ${sNum(s.pct)}th percentile is x ≈ ${sNum(s.bounds[0], 2)} (z ≈ ${fixedN(s.z[0], 4)}).`, answer: true })
      } else {
        const q =
          s.mode === 'below' ? `P(X < ${a})` : s.mode === 'above' ? `P(X > ${a})` : s.mode === 'between' ? `P(${a} < X < ${b})` : `P(X < ${a} or X > ${b})`
        const region =
          s.mode === 'below' ? `below x = ${a}` : s.mode === 'above' ? `above x = ${a}` : s.mode === 'between' ? `between x = ${a} and x = ${b}` : `below x = ${a} and above x = ${b}`
        out.push({ text: `The area ${region} is shaded, for ${q}.` })
        const zs = s.z.map((z) => fixedN(z, 2)).join(' and ')
        out.push({ text: `${q} ≈ ${fixedN(s.p, 4)}; the z-score${s.z.length > 1 ? 's are' : ' is'} ${zs}.`, answer: true })
      }
      if (s.rule) {
        out.push({ text: 'The empirical rule is marked: about 68% of the area lies within one standard deviation of the mean, 95% within two and 99.7% within three.' })
      }
    } else if (s.kind === 'sample') {
      const what = s.stat === 'proportion' ? 'sample proportions' : 'sample means'
      const plot = s.plot === 'dots' ? 'A dot plot' : 'A histogram'
      const theory = s.theory
        ? `, with the theoretical sampling distribution, a normal curve with mean ${sNum(s.theory.center)} and standard deviation ${sNum(s.theory.sd, 4)}, drawn over it`
        : ''
      out.push({ text: `${plot} shows ${s.reps} simulated ${what} from samples of ${s.n} drawn from ${s.population}${theory}.` })
      out.push({
        text: `The simulated ${what} have mean ${sNum(s.mean)} and standard deviation ${sNum(s.sd)}, so the 95% margin of error is about ${sNum(s.me95)}.`,
        answer: true,
      })
    } else if (s.kind === 'data') {
      describeDataPlot(s, out)
    } else if (s.kind === 'prob') {
      for (const l of s.lines) out.push(l.answer ? { text: l.text, answer: true } : { text: l.text })
    } else if (s.kind === 'resid') {
      out.push({
        text: `A residual plot for the ${s.model} model fitted to ${s.table} shows the ${s.n} residuals against x, with a dashed line at residual 0; the largest residual is ${sNum(s.maxAbs, 3)} in size.`,
      })
      out.push({ text: s.sentence, answer: true })
      if (s.r !== null) out.push({ text: `The correlation coefficient is r = ${fixedN(s.r, 4)}.`, answer: true })
    } else {
      const plot = s.plot === 'dots' ? 'A dot plot' : 'A histogram'
      out.push({
        text: `${plot} shows the difference in means after each of ${s.reps} re-randomizations of two groups of ${s.nA} and ${s.nB}, with the observed difference ${sNum(s.observed, 3)} marked.`,
      })
      const dir = s.tail === 'two' ? 'at least as extreme as' : s.tail === 'upper' ? 'at least as large as' : 'at most'
      out.push({
        text: `In ${s.extreme} of ${s.reps} re-randomizations the difference was ${dir} the observed one, so the p-value is about ${fixedN(s.p, 3)}.`,
        answer: true,
      })
    }
  }
  return out
}

/** A data plot's sentences: what is drawn (always), the summaries (answers). */
function describeDataPlot(s: Extract<DescribeStat, { kind: 'data' }>, out: DescribeExtra[]): void {
  const pics = [s.dist === 'dots' ? 'a dot plot' : s.dist === 'hist' ? `a histogram (bin width ${sNum(s.binWidth ?? 1)})` : '', s.box ? 'a box plot' : '']
    .filter(Boolean)
    .join(' and ')
  const names = s.sets.map((x) => `${x.name} (${x.n} value${x.n === 1 ? '' : 's'})`)
  const list = names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  out.push({
    text:
      s.sets.length > 1
        ? `${pics[0].toUpperCase()}${pics.slice(1)} of ${s.sets.length} data sets on one number line, one row each: ${list}.`
        : `${pics[0].toUpperCase()}${pics.slice(1)} of ${list}.`,
  })
  for (const x of s.sets) {
    if (x.left > 0) out.push({ text: `${x.left} value${x.left === 1 ? ' is' : 's are'} left out of ${x.name} and drawn as dashed rings.` })
    if (x.n === 0) continue
    const [mn, q1, med, q3, mx] = x.five.map((v) => sNum(v, 2))
    out.push({
      text: `${x.name}: minimum ${mn}, Q1 ${q1}, median ${med}, Q3 ${q3}, maximum ${mx}; mean ${sNum(x.mean, 2)}, standard deviation ${sNum(x.sd, 2)}. ${
        x.outliers.length > 0 ? `Outlier${x.outliers.length === 1 ? '' : 's'}: ${x.outliers.map((o) => sNum(o, 2)).join(', ')}.` : 'No outliers.'
      } It ${x.shape}.`,
      answer: true,
    })
  }
  if (s.compare) out.push({ text: s.compare, answer: true })
}

// ----------------------------------------------------------------------------
// Shapes and their measurements
// ----------------------------------------------------------------------------

/** "A(0, 0), B(4, 0) and C(4, 3)" */
function vertexList(names: readonly string[], pts: readonly Vec2[]): string {
  const items = pts.map((p, i) => `${names[i]}${geoPoint(p).text}`)
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

const POLY_WORD: Record<number, string> = { 3: 'Triangle', 4: 'Quadrilateral', 5: 'Pentagon', 6: 'Hexagon' }

/**
 * The sentences a segment, polygon, linked line or measured point
 * contributes: what is drawn (always — the vertices are the question), and
 * what its measurement readouts state (answers only).
 */
export function describeShapes(list: readonly Shape[]): DescribeExtra[] {
  const out: DescribeExtra[] = []
  for (const s of list) {
    if (!s || !s.visible) continue
    try {
      if (s.kind !== 'vector') {
        out.push(...xformSentences(s))
        // a student copy's image is the question: only its given aids are drawn
        if (s.figureHidden) continue
      }
      if (s.kind === 'polygon') {
        const r = polygonReport(s.pts, s.labels)
        if (!r) continue
        const what = POLY_WORD[s.pts.length] ?? 'Polygon'
        out.push({ text: `${what} ${r.names.join('')} has vertices ${vertexList(r.names, s.pts)}.`, ...(s.image ? { answer: true } : {}) })
        if (s.centres && s.centres.length > 0 && s.pts.length === 3) out.push(...centreSentences(s.pts, s.labels, s.centres))
        const m = s.measure
        if (!m) continue
        if (m.right?.some((x) => x)) {
          const at = r.angles.map((a, i) => (a.right ? r.names[i] : '')).filter((x) => x)
          out.push({ text: `A right angle is marked at ${at.join(' and ')}.` })
        }
        if (m.lengths) out.push({ text: `Side lengths: ${r.sides.map((x) => `${x.name} = ${withApprox(x.length)}`).join(', ')}.`, answer: true })
        if (m.slopes) out.push({ text: `Slopes: ${r.sides.map((x) => `${x.name} ${x.slope.text}`).join(', ')}.`, answer: true })
        if (m.angles) out.push({ text: `Angles: ${r.angles.map((a, i) => `${r.names[i]} = ${a.text}`).join(', ')}.`, answer: true })
        if (m.ticks || m.arcs) {
          const groups = new Map<number, string[]>()
          r.sideGroups.forEach((g, i) => g > 0 && groups.set(g, [...(groups.get(g) ?? []), r.sides[i].name]))
          const eq = [...groups.values()].map((g) => g.join(' = '))
          if (eq.length > 0) out.push({ text: `Tick marks show ${eq.join(' and ')}.`, answer: true })
        }
        if (m.midpoints) out.push({ text: `Midpoints: ${r.sides.map((x) => `${x.name} at ${x.midpoint.text}`).join(', ')}.`, answer: true })
        if (m.summary?.some((l) => l.part === 'area')) {
          out.push({ text: `The perimeter is ${withApprox(r.perimeter)} and the area is ${withApprox(r.area.area)}.`, answer: true })
        }
        if (m.summary?.some((l) => l.part === 'class')) out.push({ text: r.classification.sentence, answer: true })
      } else if (s.kind === 'segment') {
        const r = segmentReport(s.a, s.b, s.labels)
        if (!r) continue
        const nm = r.names.join('')
        if (s.labels) out.push({ text: `Segment ${nm} joins ${vertexList(r.names, [s.a, s.b])}.` })
        else out.push({ text: `A segment joins ${geoPoint(s.a).text} and ${geoPoint(s.b).text}.` })
        const m = s.measure
        if (!m) continue
        const facts: string[] = []
        if (m.lengths) facts.push(`its length is ${withApprox(r.length)}`)
        if (m.slopes) facts.push(`its slope is ${r.slope.text}`)
        if (m.midpoints) facts.push(`its midpoint is ${r.midpoint.text}`)
        if (m.equation) facts.push(`it lies on ${r.line.slopeIntercept.text}`)
        if (facts.length > 0) out.push({ text: `${facts.join('; ').replace(/^i/, 'I')}.`, answer: true })
      } else if (s.kind === 'line') {
        if (!Number.isFinite(s.through.x) || !Number.isFinite(s.dir.x)) continue
        out.push({ text: `A line passes through ${geoPoint(s.through).text}.` })
        if (s.measure?.equation) {
          const q = { x: s.through.x + s.dir.x, y: s.through.y + s.dir.y }
          const eq = segmentReport(s.through, q)
          if (eq) out.push({ text: `The line is ${eq.line.slopeIntercept.text}.`, answer: true })
        }
      } else if (s.kind === 'point' && s.image) {
        out.push({ text: `${s.label ? `Point ${s.label}` : 'The image point'} is at ${geoPoint(s.at).text}.`, answer: true })
      } else if (s.kind === 'point' && s.measure?.pair) {
        const p = s.measure.pair
        const nm = s.label ? `Point ${s.label}` : `The point ${geoPoint(s.at).text}`
        out.push({ text: `${nm} is joined to ${geoPoint(p.to).text} by a dashed segment.` })
        const facts: string[] = []
        if (p.length !== null) facts.push(`the distance is ${withApprox(distance(s.at, p.to))}`)
        if (p.slope !== null) facts.push(`the slope is ${geoSlope(s.at, p.to).text}`)
        if (p.midpoint !== null) facts.push(`the midpoint is ${geoMid(s.at, p.to).text}`)
        if (facts.length > 0) out.push({ text: `${facts.join('; ').replace(/^t/, 'T')}.`, answer: true })
      }
    } catch {
      /* a shape that cannot be described is left out, never the description */
    }
  }
  return out
}

/** What a triangle's centres say: what is drawn (always) and where they are (answers). */
function centreSentences(pts: readonly Vec2[], labels: readonly string[] | undefined, flags: readonly string[]): DescribeExtra[] {
  const t = triangleCentres(pts, labels)
  if (!t) return []
  const out: DescribeExtra[] = []
  const tri = `△${t.names.join('')}`
  const drawn: Record<string, string> = {
    centroid: 'the medians and the centroid G',
    circumcentre: 'the perpendicular bisectors, the circumscribed circle and the circumcenter O',
    incentre: 'the angle bisectors, the inscribed circle and the incenter I',
    orthocentre: 'the altitudes and the orthocenter H',
    euler: 'the Euler line',
  }
  const list = flags.map((f) => drawn[f]).filter((x): x is string => !!x)
  if (list.length > 0) {
    const words = list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
    out.push({ text: `${capitalFirst(words)} of ${tri} are drawn.` })
  }
  const where = (k: 'centroid' | 'circumcentre' | 'incentre' | 'orthocentre'): string => {
    const c = t[k]
    return `the ${c.name} ${c.letter} is ${c.exact ? 'at' : 'at about'} ${c.pt.text}${c.where === 'outside' ? ', outside the triangle' : ''}`
  }
  const facts: string[] = []
  if (flags.includes('centroid')) facts.push(where('centroid'))
  if (flags.includes('circumcentre')) facts.push(`${where('circumcentre')} with circumradius ${withApprox(t.circumradius).replace(/^≈/, 'about')}`)
  if (flags.includes('incentre')) facts.push(`${where('incentre')} with inradius ${withApprox(t.inradius).replace(/^≈/, 'about')}`)
  if (flags.includes('orthocentre')) facts.push(where('orthocentre'))
  if (facts.length > 0) out.push({ text: `${capitalFirst(facts.join('; '))}.`, answer: true })
  if (flags.includes('euler')) {
    out.push({
      text: t.euler ? `O, G and H lie on the Euler line ${t.euler.line.slopeIntercept.text}, and ${t.euler.ratioText}.` : `${tri} is equilateral: all four centers coincide.`,
      answer: true,
    })
  }
  return out
}

/** What a transformation's image, its aids and a symmetry overlay say. */
function xformSentences(s: Exclude<Shape, { kind: 'vector' }>): DescribeExtra[] {
  const out: DescribeExtra[] = []
  const a = s.aids
  if (s.image) {
    const im = s.image
    if (s.figureHidden) {
      out.push({ text: `The image of ${im.of} under ${im.words} is to be drawn.` })
    } else {
      out.push({ text: `${capitalFirst(im.name)} is the image of ${im.of} under ${im.words}, drawn dashed: ${im.notation}: ${im.rule}.`, answer: true })
    }
    if (a?.mirror) out.push({ text: `The mirror line ${a.mirror.label} is drawn.` })
    if (a?.center) out.push({ text: `The center ${a.center.label === 'O' ? 'O, the origin' : a.center.label} is marked.` })
    if (a?.vector) out.push({ text: `The translation vector ${a.vector.label} is drawn.` })
  }
  if (a?.symLines && a.symText) {
    out.push({ text: `The symmetry overlay shows ${a.symText.text.replace(' · ', ' of symmetry; rotational symmetry ').replace('no rotation symmetry', 'none')}.`, answer: true })
  }
  return out
}

const capitalFirst = (t: string): string => (t ? t[0].toUpperCase() + t.slice(1) : t)

function lineWords(m: number, b: number): string {
  const num = (v: number) => ex(v) ?? fmtN(v)
  const mm = Math.abs(m - 1) < 1e-12 ? 'x' : Math.abs(m + 1) < 1e-12 ? `${MINUS}x` : `${num(m)}x`
  if (Math.abs(m) < 1e-12) return num(b)
  if (Math.abs(b) < 1e-12) return mm
  return `${mm} ${b < 0 ? MINUS : '+'} ${num(Math.abs(b))}`
}

/** Both steps at once. */
export function describeCurves(input: AdapterInput, opts?: DescribeOptions): GraphDescription {
  return describeScene(describeInputFromCurves(input), opts)
}

// ----------------------------------------------------------------------------
// Number line
// ----------------------------------------------------------------------------

/** The number-line board's solver result, as the dots and shading it draws. */
export function numberLineFromSolve(result: SolveResult, min: number, max: number, step?: number): DescribeNumberLine {
  const parts = result.solution.parts ?? []
  const points: DescribeNumberLine['points'] = []
  const intervals: DescribeNumberLine['intervals'] = []
  const addPoint = (x: number, closed: boolean, exact: string | null | undefined) => {
    if (!Number.isFinite(x) || points.some((p) => Math.abs(p.x - x) < 1e-12)) return
    const p: DescribeNumberLine['points'][number] = { x, closed }
    if (exact) p.exact = exact
    points.push(p)
  }
  if (result.solution.kind === 'finite') {
    for (const x of result.solution.points ?? []) addPoint(x, true, ex(x))
  }
  for (const p of parts) {
    const iv: DescribeNumberLine['intervals'][number] = {
      lo: Number.isFinite(p.lo) ? p.lo : null,
      hi: Number.isFinite(p.hi) ? p.hi : null,
    }
    if (p.loExact) iv.loText = p.loExact.text
    if (p.hiExact) iv.hiText = p.hiExact.text
    intervals.push(iv)
    if (Number.isFinite(p.lo)) addPoint(p.lo, p.loClosed, p.loExact?.text)
    if (Number.isFinite(p.hi)) addPoint(p.hi, p.hiClosed, p.hiExact?.text)
  }
  // excluded critical values inside a shaded stretch (x ≠ 2) are open circles too
  for (const cl of result.clauses ?? []) {
    for (const cv of cl.critical) {
      if (cv.included) continue
      const inside = parts.some((p) => cv.x > p.lo && cv.x < p.hi)
      if (inside) addPoint(cv.x, false, cv.exact?.text)
    }
  }
  const statement = result.clauses?.map((c) => c.text).join(result.combine === 'or' ? ' or ' : ' and ')
  const out: DescribeNumberLine = {
    min,
    max,
    points: points.sort((a, b) => a.x - b.x),
    intervals: result.solution.kind === 'finite' ? [] : intervals,
    solution: result.solution.text,
    builder: result.solution.builder,
  }
  if (step !== undefined) out.step = step
  if (statement) out.statement = prettyMath(statement)
  return out
}

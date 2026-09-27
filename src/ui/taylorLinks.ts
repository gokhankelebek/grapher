// ============================================================================
// src/ui/taylorLinks.ts — the Taylor polynomial link: where its source comes
// from, where a fresh one is centred, what its card says and what it draws.
//
// src/core/taylor.ts owns the mathematics (the jets, Pₙ, the Lagrange and
// alternating bounds, the interval of convergence). What it cannot do is read
// a SKETCHED curve: a library family (poly3, sine, exp …) has no formula of its
// own, and turning one into text is src/ui/equationText.ts's job. So the
// source is built here — curveEquationText → parseExpression → a synthetic
// curve with the parsed plot's params and the ORIGINAL curve's domain — and
// cached by that text, so a slider drag reparses once per distinct equation.
//
// Everything the board and the card show is recomputed from the link
// { a, n, x?, band?, ioc? } on every change, exactly like the other calculus
// objects (src/ui/calcLinks.ts): nothing computed is stored.
//
// Pure: no React, no DOM, no canvas.
// ============================================================================

import type { FittedCurve, ModelSpec } from '../core/types'
import type { Overlay, StripEnd } from '../render/overlays'
import type { TaylorLink } from '../core/persist'
import { TAYLOR_MODEL_PREFIX, clampTaylorN } from '../core/persist'
import {
  TAYLOR_N_DEFAULT,
  TAYLOR_N_MAX,
  TAYLOR_N_MIN,
  alternatingBound,
  convergence,
  errorBand,
  evalTaylor,
  lagrangeBound,
  taylorLatex,
  taylorModel,
  taylorPolynomial,
  taylorSourceOf,
  taylorText,
} from '../core/taylor'
import type { Convergence, EndBehavior, TaylorPoly, TaylorSource } from '../core/taylor'
import { parseExpression } from '../core/parse'
import { exactForm } from '../core/exact'
import { curveEquationText } from './equationText'

export { TAYLOR_N_DEFAULT, TAYLOR_N_MAX, TAYLOR_N_MIN, TAYLOR_MODEL_PREFIX, clampTaylorN }
export type { TaylorLink }

/** The card's sentence for a curve Taylor cannot read. */
export const TAYLOR_NEEDS_FORMULA = 'Taylor polynomials need a formula written out in x'

/** The ▶ demo's pace, and where it runs to from a degree of 0. */
export const TAYLOR_STEP_MS = 600
export const TAYLOR_PLAY_TO = 15

/** Samples across the band's x-range. */
export const TAYLOR_BAND_SAMPLES = 241

// ---------------------------------------------------------------------------
// The source
// ---------------------------------------------------------------------------

/** equation text -> the model it parses to (or null: it does not). Most recent last. */
const SKETCH_CACHE = new Map<string, { spec: ModelSpec; params: number[] } | null>()
const SKETCH_CACHE_MAX = 48
const SKETCH_MODEL_ID = 'tay_src'

function sketchModel(text: string): { spec: ModelSpec; params: number[] } | null {
  if (SKETCH_CACHE.has(text)) {
    const hit = SKETCH_CACHE.get(text) ?? null
    SKETCH_CACHE.delete(text)
    SKETCH_CACHE.set(text, hit)
    return hit
  }
  let built: { spec: ModelSpec; params: number[] } | null = null
  try {
    const out = parseExpression(text)
    if (out.ok && out.plot.kind === 'explicit') {
      const spec = out.plot.makeModel(SKETCH_MODEL_ID)
      if (spec.taylor) built = { spec, params: out.plot.defaultParams.slice() }
    }
  } catch {
    built = null
  }
  SKETCH_CACHE.set(text, built)
  while (SKETCH_CACHE.size > SKETCH_CACHE_MAX) {
    const oldest = SKETCH_CACHE.keys().next().value
    if (oldest === undefined) break
    SKETCH_CACHE.delete(oldest)
  }
  return built
}

/**
 * What Taylor reads a curve through, or null when it cannot read it.
 *
 * A typed explicit line carries its own jets (ModelSpec.taylor). A sketched
 * library family is read through its equation text, with the sketch's own
 * domain — P₃ of a parabola sketched over [−2, 3] is centred inside the ink.
 * A line that calls another curve by name (`f(x − 1)`) has no jet at all:
 * `callsOthers` says so up front rather than refusing at every a.
 */
export function taylorSourceFor(
  curve: FittedCurve | undefined,
  models: Record<string, ModelSpec>,
  callsOthers = false,
): TaylorSource | null {
  if (!curve || callsOthers) return null
  const spec = models[curve.modelId]
  if (!spec || spec.kind !== 'explicit' || curve.kind !== 'explicit') return null
  try {
    if (spec.taylor) return taylorSourceOf(curve, models)
    const text = curveEquationText(curve, spec)
    if (!text) return null
    const m = sketchModel(text)
    if (!m) return null
    const synthetic: FittedCurve = { ...curve, modelId: SKETCH_MODEL_ID, params: m.params.slice() }
    return taylorSourceOf(synthetic, { [SKETCH_MODEL_ID]: m.spec })
  } catch {
    return null
  }
}

/** Why the menu cannot offer Taylor on this curve, or null when it can. */
export function taylorBlocked(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  callsOthers = false,
): string | null {
  if (models[curve.modelId]?.kind !== 'explicit') return null // not offered at all
  return taylorSourceFor(curve, models, callsOthers) ? null : TAYLOR_NEEDS_FORMULA
}

/** Pₙ about a, or null — never throws. */
export function safePoly(src: TaylorSource | null, a: number, n: number): TaylorPoly | null {
  if (!src || !Number.isFinite(a)) return null
  try {
    return taylorPolynomial(src, a, clampTaylorN(n))
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Where a fresh one is centred
// ---------------------------------------------------------------------------

const round6 = (v: number): number => Math.round(v * 1e6) / 1e6

/**
 * The centre a fresh Taylor polynomial opens at.
 *
 * 0 — the Maclaurin polynomial, the AP default — when f is analytic there and
 * 0 is in view. Otherwise the nearest nice number to the middle of the view
 * (the view clipped to the curve's domain): the nearest integer where f is
 * analytic, then the nearest half. Null when nothing nearby will do.
 */
export function defaultTaylorA(
  analytic: (a: number) => boolean,
  window: [number, number],
  domain: [number, number] | null = null,
): number | null {
  let lo = Math.min(window[0], window[1])
  let hi = Math.max(window[0], window[1])
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) {
    lo = -5
    hi = 5
  }
  if (domain && Number.isFinite(domain[0]) && Number.isFinite(domain[1])) {
    const dlo = Math.min(domain[0], domain[1])
    const dhi = Math.max(domain[0], domain[1])
    // A sketch entirely off-screen still gets a centre: on the sketch.
    if (dhi < lo || dlo > hi) {
      lo = dlo
      hi = dhi
    } else {
      lo = Math.max(lo, dlo)
      hi = Math.min(hi, dhi)
    }
  }
  const ok = (a: number): boolean => {
    try {
      return analytic(a)
    } catch {
      return false
    }
  }
  if (lo <= 0 && 0 <= hi && ok(0)) return 0
  const c = (lo + hi) / 2
  const near = (step: number, offset: number): number[] => {
    const out: number[] = []
    const first = Math.ceil((lo - offset) / step)
    const last = Math.floor((hi - offset) / step)
    // Only the closest few dozen: a board zoomed out to ±10⁶ has no business
    // trying a million centres.
    const mid = Math.round((c - offset) / step)
    for (let k = Math.max(first, mid - 30); k <= Math.min(last, mid + 30); k++) out.push(k * step + offset)
    return out.sort((p, q) => Math.abs(p - c) - Math.abs(q - c) || p - q)
  }
  for (const a of near(1, 0)) if (ok(a)) return a === 0 ? 0 : a
  for (const a of near(1, 0.5)) if (ok(a)) return a
  if (ok(c)) return round6(c)
  return null
}

// ---------------------------------------------------------------------------
// Words and numbers
// ---------------------------------------------------------------------------

const MINUS = '−'
const SUB = '₀₁₂₃₄₅₆₇₈₉'
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹'

const script = (n: number, table: string): string =>
  `${n < 0 ? (table === SUP ? '⁻' : '₋') : ''}${String(Math.abs(Math.trunc(n)))
    .split('')
    .map((d) => table[Number(d)])
    .join('')}`

/** "P₃" */
export function pName(n: number): string {
  return `P${script(clampTaylorN(n), SUB)}`
}

/** "R₃" — the remainder */
const rName = (n: number): string => `R${script(clampTaylorN(n), SUB)}`

const withMinus = (s: string): string => s.replace(/^-/, MINUS).replace(/e-/, `e${MINUS}`)

/** A plain decimal, trimmed: never "-0", real minus sign. */
function dec(v: number, sig = 6): string {
  if (!Number.isFinite(v)) return '—'
  if (v === 0) return '0'
  const mag = Math.abs(v)
  if (mag >= 1e6 || mag < 1e-4) return sci(v)
  const s = Number(v.toPrecision(sig)).toString()
  return withMinus(s === '-0' ? '0' : s)
}

/** "2.59 × 10⁻⁴" for the very small and the very large; a trimmed decimal otherwise. */
export function sci(v: number, sig = 3): string {
  if (!Number.isFinite(v)) return v === Infinity ? '∞' : v === -Infinity ? `${MINUS}∞` : '—'
  if (v === 0) return '0'
  const mag = Math.abs(v)
  if (mag >= 1e-3 && mag < 1e5) return withMinus(Number(v.toPrecision(Math.max(sig, 3))).toString())
  const [m, e] = v.toExponential(sig - 1).split('e')
  const mant = Number(m).toString()
  return `${withMinus(mant)} × 10${script(Number(e), SUP)}`
}

/**
 * A number the way a teacher writes it: "2", "−1.5", "π/6", "1/3" — a whole
 * number bare, a short decimal as itself, a closed form when there is one,
 * and a trimmed decimal otherwise.
 */
export function numLabel(v: number): string {
  if (!Number.isFinite(v)) return v === Infinity ? '∞' : v === -Infinity ? `${MINUS}∞` : '—'
  const r = round6(v)
  if (Number.isInteger(r) && Math.abs(v - r) < 1e-9) return withMinus(String(r === 0 ? 0 : r))
  const three = Math.round(v * 1000) / 1000
  if (Math.abs(v - three) < 1e-9 * Math.max(1, Math.abs(v))) return withMinus(String(three))
  const ex = exactForm(v)
  if (ex) return ex.text
  return dec(v, 4)
}

/** "0.4794" beside a closed form, or the closed form alone when it IS the decimal. */
function valueText(v: number, sig = 6): string {
  if (!Number.isFinite(v)) return '—'
  const ex = exactForm(v)
  const d = dec(v, sig)
  if (!ex) return d
  const plain = /^[−-]?\d+(\.\d+)?$/.test(ex.text)
  if (plain) return d
  // "1/2", not "1/2 ≈ 0.5": a decimal that terminates within three places
  // adds nothing to the fraction it spells.
  const three = Math.round(v * 1000) / 1000
  if (Math.abs(v - three) < 1e-12 * Math.max(1, Math.abs(v))) return ex.text
  return `${ex.text} ≈ ${d}`
}

/** Why there is no Pₙ at this a (the polynomial came back null). */
export function taylorProblem(
  link: TaylorLink,
  parent: FittedCurve | undefined,
  src: TaylorSource | null,
  fName = 'f',
): string | null {
  if (!parent) return 'the curve it came from is gone'
  if (!src) return TAYLOR_NEEDS_FORMULA
  if (safePoly(src, link.a, link.n)) return null
  const at = `a = ${numLabel(link.a)}`
  const d = parent.domain
  if (d && Number.isFinite(d[0]) && Number.isFinite(d[1])) {
    const lo = Math.min(d[0], d[1])
    const hi = Math.max(d[0], d[1])
    const tol = 1e-9 * Math.max(1, Math.abs(lo), Math.abs(hi))
    if (link.a < lo - tol || link.a > hi + tol) return `${at} is outside the domain of ${fName}`
  }
  let fa = Number.NaN
  try {
    fa = src.f(link.a)
  } catch {
    fa = Number.NaN
  }
  if (!Number.isFinite(fa)) return `${at} is outside the domain of ${fName}`
  return `${fName} isn't differentiable at ${at}`
}

const endWord = (b: EndBehavior): string =>
  b === 'converges'
    ? 'converges absolutely'
    : b === 'conditional'
      ? 'converges conditionally'
      : b === 'diverges'
        ? 'diverges'
        : 'unknown'

/**
 * "Interval of convergence: (−1, 1] · R = 1" — and, when the ends could not
 * be decided, a sentence that says so rather than a bracket that guesses.
 */
export function iocLine(conv: Convergence | null): { text: string; note: string | null } {
  if (!conv) {
    return { text: 'Interval of convergence: could not be determined', note: null }
  }
  const R =
    conv.R === Infinity ? '∞' : conv.exactR ? conv.exactR.text : numLabel(conv.R)
  const text = `Interval of convergence: ${conv.text} · R = ${R}`
  if (conv.R === Infinity || conv.R === 0) return { text, note: null }
  const unknown: string[] = []
  if (conv.left === 'unknown') unknown.push(`x = ${numLabel(conv.lo)}`)
  if (conv.right === 'unknown') unknown.push(`x = ${numLabel(conv.hi)}`)
  if (unknown.length === 0) {
    return {
      text,
      note: `At x = ${numLabel(conv.lo)} the series ${endWord(conv.left)}; at x = ${numLabel(conv.hi)} it ${endWord(conv.right)}.`,
    }
  }
  return {
    text,
    note: `The series' behaviour at ${unknown.join(' and ')} could not be decided from its terms.`,
  }
}

/** Plain-text strip ends from the series' behaviour there. */
export function stripEnd(b: EndBehavior): StripEnd {
  return b === 'converges' || b === 'conditional' ? 'closed' : b === 'diverges' ? 'open' : 'none'
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export interface TaylorProbeRow {
  x: number
  /** "P₃(0.5) = 0.479167" */
  p: string
  /** "f(0.5) = 0.479426" */
  f: string
  /** "|f(0.5) − P₃(0.5)| = 2.59 × 10⁻⁴" */
  error: string
  /** "Lagrange: |R₃(0.5)| ≤ 2.6 × 10⁻³ · M = max|f⁽⁴⁾| = 0.479 at t = 0.5" */
  lagrange: string | null
  /** "Alternating series: |error| ≤ 2.6 × 10⁻⁴ (the first omitted term)" */
  alternating: string | null
}

/** One Taylor polynomial, as its PARENT's card shows it. */
export interface TaylorRow {
  linkId: string
  a: number
  /** a as it is written: "π/6", "0", "−1.5" */
  aText: string
  n: number
  x: number | null
  /** the probe as it is written, or null */
  xText: string | null
  band: boolean
  ioc: boolean
  /** "P₃" */
  name: string
  /** KaTeX of Pₙ, empty when there is none */
  tex: string
  /** "P₃(x) = x − x³/6", empty when there is none */
  text: string
  problem: string | null
  probe: TaylorProbeRow | null
  /** "Interval of convergence: (−1, 1] · R = 1" */
  iocText: string
  /** Endpoint behaviour, or why it is unknown. */
  iocNote: string | null
}

/** Superscript "(n+1)" for f⁽⁴⁾. */
const order = (k: number): string => `⁽${script(k, SUP)}⁾`

/** Everything the parent's card says about one Taylor link. */
export function taylorRow(
  link: TaylorLink,
  parent: FittedCurve | undefined,
  src: TaylorSource | null,
  fName = 'f',
): TaylorRow {
  const n = clampTaylorN(link.n)
  const P = pName(n)
  const poly = safePoly(src, link.a, n)
  const aText = poly?.exactA?.text ?? numLabel(link.a)
  let tex = ''
  let text = ''
  if (poly) {
    try {
      tex = taylorLatex(poly)
      text = taylorText(poly)
    } catch {
      tex = ''
      text = ''
    }
  }
  let conv: Convergence | null = null
  if (src && poly) {
    try {
      conv = convergence(src, link.a)
    } catch {
      conv = null
    }
  }
  const ioc = poly ? iocLine(conv) : { text: 'Interval of convergence: —', note: null }
  let probe: TaylorProbeRow | null = null
  if (poly && src && link.x !== undefined && Number.isFinite(link.x)) {
    probe = probeRow(src, poly, link.x, fName)
  }
  return {
    linkId: link.id,
    a: link.a,
    aText,
    n,
    x: link.x !== undefined && Number.isFinite(link.x) ? link.x : null,
    xText: link.x !== undefined && Number.isFinite(link.x) ? numLabel(link.x) : null,
    band: link.band === true,
    ioc: link.ioc === true,
    name: P,
    tex,
    text,
    problem: poly ? null : taylorProblem(link, parent, src, fName),
    probe,
    iocText: ioc.text,
    iocNote: ioc.note,
  }
}

function probeRow(src: TaylorSource, poly: TaylorPoly, x: number, fName: string): TaylorProbeRow {
  const n = poly.n
  const P = pName(n)
  const xs = numLabel(x)
  let px = Number.NaN
  let fx = Number.NaN
  try {
    px = evalTaylor(poly, x)
  } catch {
    px = Number.NaN
  }
  try {
    fx = src.f(x)
  } catch {
    fx = Number.NaN
  }
  const err = Math.abs(fx - px)
  // Enough digits that Pₙ(x) and f(x) visibly differ — two past the first
  // digit where they part — and never fewer than seven.
  const sig =
    Number.isFinite(err) && err > 0 && Number.isFinite(fx) && fx !== 0
      ? Math.max(7, Math.min(15, Math.ceil(Math.log10(Math.abs(fx) / err)) + 2))
      : 7
  let lag: ReturnType<typeof lagrangeBound> = null
  let alt: number | null = null
  try {
    lag = lagrangeBound(src, poly.a, n, x)
  } catch {
    lag = null
  }
  try {
    alt = alternatingBound(src, poly.a, n, x)
  } catch {
    alt = null
  }
  const lagrange =
    lag && Number.isFinite(lag.bound)
      ? `Lagrange: |${rName(n)}(${xs})| ≤ M·|x − a|${script(n + 1, SUP)}/${n + 1}! = ${sci(lag.bound)} · M = max|${fName}${order(n + 1)}(t)| = ${valueText(lag.M, 4)} at t = ${numLabel(lag.argMax)}`
      : null
  const alternating =
    alt !== null && Number.isFinite(alt)
      ? `Alternating series: |error| ≤ ${sci(alt)} (the first omitted term)`
      : null
  return {
    x,
    p: `${P}(${xs}) = ${Number.isFinite(px) ? dec(px, sig) : '—'}`,
    f: `${fName}(${xs}) = ${Number.isFinite(fx) ? dec(fx, sig) : `— (${xs} is outside the domain of ${fName})`}`,
    error: `|${fName}(${xs}) − ${P}(${xs})| = ${Number.isFinite(err) ? sci(err) : '—'}`,
    lagrange,
    alternating,
  }
}

// ---------------------------------------------------------------------------
// The child's model
// ---------------------------------------------------------------------------

/**
 * The model the Taylor curve draws with: Pₙ when there is one, and otherwise a
 * model that draws NOTHING — the curve keeps its card, its colour and whether
 * the teacher hid it, and the card says why it is empty.
 */
export function taylorChildModel(
  poly: TaylorPoly | null,
  modelId: string,
  n: number,
): ModelSpec {
  if (poly) {
    try {
      return taylorModel(poly, modelId)
    } catch {
      /* fall through to the empty model */
    }
  }
  const k = clampTaylorN(n)
  return {
    id: modelId,
    kind: 'explicit',
    name: 'Taylor polynomial',
    evalExplicit: () => Number.NaN,
    latex: () => `P_{${k}}(x)\\ \\text{(none at this center)}`,
    paramMeta: () => [],
  }
}

/** "P₃ about a = 0" — the legend's words, and the chip a caption names. */
export function taylorLegend(link: TaylorLink): string {
  return `${pName(link.n)} about a = ${numLabel(link.a)}`
}

/** "\\text{about }a = \\frac{\\pi}{6}" — the legend's KaTeX, beside Pₙ's own equation. */
export function taylorLegendTex(link: TaylorLink): string {
  const ex = exactForm(link.a)
  const r = round6(link.a)
  const a =
    Number.isInteger(r) && Math.abs(link.a - r) < 1e-9
      ? String(r === 0 ? 0 : r)
      : ex
        ? ex.tex
        : String(Number(link.a.toPrecision(4)))
  return `\\text{about }a = ${a}`
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

/**
 * Everything a Taylor link puts on the board besides its own curve:
 *
 *   the centre dot     (a, f(a)) on the parent, in the parent's colour
 *   the probe          a dashed segment from (x, Pₙ(x)) to (x, f(x)), both ends dotted
 *   the error band     Pₙ ± R(x), sampled across `span`, when `band` is on
 *   the IOC strip      on the x-axis over [a − R, a + R], when `ioc` is on
 *
 * `span` is the x-range to sample the band over (the view, padded); without
 * one there is no band. `sources` may be passed in to share a cache.
 */
export function taylorOverlays(
  links: readonly TaylorLink[],
  curves: readonly FittedCurve[],
  models: Record<string, ModelSpec>,
  span: [number, number] | null,
  sourceOf: (c: FittedCurve) => TaylorSource | null = (c) => taylorSourceFor(c, models),
): Overlay[] {
  const fills: Overlay[] = []
  const marks: Overlay[] = []
  const byId = new Map(curves.map((c) => [c.id, c]))
  for (const link of links) {
    const parent = byId.get(link.parentId)
    const child = byId.get(link.curveId)
    if (!parent || !parent.visible) continue
    const src = sourceOf(parent)
    const poly = safePoly(src, link.a, link.n)
    if (!src || !poly) continue
    const childShown = child !== undefined && child.visible
    const at = (fn: () => number): number => {
      try {
        const v = fn()
        return typeof v === 'number' ? v : Number.NaN
      } catch {
        return Number.NaN
      }
    }

    if (link.band && childShown && span && span[1] > span[0]) {
      const N = TAYLOR_BAND_SAMPLES
      const xs: number[] = []
      for (let i = 0; i < N; i++) xs.push(span[0] + ((span[1] - span[0]) * i) / (N - 1))
      // The centre itself, exactly: the band pinches to nothing there, and a
      // grid that straddles a would round the pinch off.
      if (link.a > span[0] && link.a < span[1] && !xs.includes(link.a)) {
        xs.push(link.a)
        xs.sort((p, q) => p - q)
      }
      let R: Float64Array
      try {
        R = errorBand(src, link.a, poly.n, xs)
      } catch {
        R = new Float64Array(xs.length).fill(Number.NaN)
      }
      const lo = new Float64Array(xs.length)
      const hi = new Float64Array(xs.length)
      let any = false
      for (let i = 0; i < xs.length; i++) {
        const p = at(() => evalTaylor(poly, xs[i]))
        const r = R[i]
        if (Number.isFinite(p) && Number.isFinite(r) && r >= 0) {
          lo[i] = p - r
          hi[i] = p + r
          any = true
        } else {
          lo[i] = Number.NaN
          hi[i] = Number.NaN
        }
      }
      if (any) fills.push({ kind: 'band', curveId: child.id, xs, lo, hi })
    }

    if (link.ioc) {
      let conv: Convergence | null = null
      try {
        conv = convergence(src, link.a)
      } catch {
        conv = null
      }
      if (conv && conv.R > 0 && !Number.isNaN(conv.lo) && !Number.isNaN(conv.hi)) {
        fills.push({
          kind: 'axisStrip',
          curveId: child?.id ?? parent.id,
          from: conv.lo,
          to: conv.hi,
          left: stripEnd(conv.left),
          right: stripEnd(conv.right),
        })
      }
    }

    const fa = at(() => src.f(link.a))
    if (Number.isFinite(fa)) {
      marks.push({ kind: 'dot', curveId: parent.id, at: { x: link.a, y: fa } })
    }

    if (link.x !== undefined && Number.isFinite(link.x) && childShown) {
      const x = link.x
      const px = at(() => evalTaylor(poly, x))
      const fx = at(() => src.f(x))
      if (Number.isFinite(px) && Number.isFinite(fx)) {
        marks.push({
          kind: 'segment',
          curveId: child.id,
          from: { x, y: px },
          to: { x, y: fx },
          dashed: true,
        })
      }
      if (Number.isFinite(fx)) marks.push({ kind: 'dot', curveId: parent.id, at: { x, y: fx } })
      if (Number.isFinite(px)) marks.push({ kind: 'dot', curveId: child.id, at: { x, y: px } })
    }
  }
  return [...fills, ...marks]
}

// ---------------------------------------------------------------------------
// Dragging the centre and the probe
// ---------------------------------------------------------------------------

/** How close (px) a pointer has to come to a multiple of π/12 for the centre to land on it. */
export const PI_PULL_PX = 5

/**
 * Where a dragged centre (or probe) lands. On a π-labelled axis, the π ladder
 * (`piSnap`). On a decimal axis, the decimal ladder (`decimalSnap`) — unless
 * the pointer is within a few pixels of a multiple of π/12, which wins: the
 * trig lesson drags a to π/6, and 0.52 is not a number anybody meant.
 */
export function snapCenter(
  x: number,
  pxPerUnit: number,
  decimalSnap: (x: number) => number,
  piAxis = false,
  piSnap?: (x: number) => number,
): number {
  if (!Number.isFinite(x)) return x
  if (piAxis && piSnap) return piSnap(x)
  const ppu = Number.isFinite(pxPerUnit) && pxPerUnit > 0 ? pxPerUnit : 60
  const step = Math.PI / 12
  // Only while the π/12 rungs are far enough apart to aim at.
  if (step * ppu >= 3 * PI_PULL_PX) {
    const k = Math.round(x / step)
    const at = k * step
    if (k !== 0 && Math.abs(at - x) * ppu <= PI_PULL_PX) {
      const d = decimalSnap(x)
      // A whole number within reach is still the whole number (k·π/12 is never one).
      if (!(Number.isInteger(d) && Math.abs(d - x) * ppu <= PI_PULL_PX / 2)) return at
    }
  }
  return decimalSnap(x)
}

// ---------------------------------------------------------------------------
// What a Taylor curve is called
// ---------------------------------------------------------------------------

/**
 * The board's names with every Taylor curve called Pₙ instead of the letter
 * the pool handed it — so a figure's labels read "f" and "P₃", and an AP
 * caption reads "Graphs of f and P₃". A curve the names leave out is named
 * only when `shown` says it is on the board (a hidden curve stays out of a
 * caption); without `shown`, only curves already named are renamed.
 */
export function withTaylorNames(
  names: Readonly<Record<string, string>>,
  links: readonly { kind: string; curveId?: string; n?: number }[],
  shown?: ReadonlySet<string>,
): Record<string, string> {
  let out: Record<string, string> | null = null
  for (const l of links) {
    if (l.kind !== 'taylor' || !l.curveId) continue
    if (names[l.curveId] === undefined && !shown?.has(l.curveId)) continue
    const name = pName(l.n ?? TAYLOR_N_DEFAULT)
    if (names[l.curveId] === name) continue
    if (!out) out = { ...names }
    out[l.curveId] = name
  }
  return out ?? (names as Record<string, string>)
}

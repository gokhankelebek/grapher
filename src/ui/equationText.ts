// ============================================================================
// Plain-text equations for the cards.
//
// A card prints LaTeX, but nobody types LaTeX. To edit the equation on a card
// we need the OTHER form of the same thing: the line a teacher would type into
// the "+" box. Two jobs, driven by one table so they can never drift apart:
//
//   curveEquationText(curve, spec)   params -> text   (seeds the editor)
//   readCurveEquation(src, ...)      text -> params of the SAME family, or a
//                                    typed expression when the family is gone.
//
// WHY THE FAMILY MATTERS. A sketched curve is a fitted model — poly3, sine,
// circle — and the family is what gives it drag handles, arrow-nudge, an
// Interpretations list and feature editing ("put this zero at x = 2"). A typed
// expression has none of that. So editing the coefficients of a cubic must
// leave a cubic behind, not a generic expression that happens to draw the same
// line. Only when the text no longer IS that family do we fall back to a typed
// expression — and the board says so out loud.
//
// HOW A FAMILY IS RECOGNISED. Two routes, both ending in the same proof:
//   1. Polynomials recover their coefficients NUMERICALLY, by evaluating the
//      parsed function at degree+1 nodes and solving the Vandermonde system.
//      That is form-independent: "y = 2(x-1)^2 + 3" comes back as the parabola
//      [5, -4, 2] even though it is not written the way we print it.
//   2. Every other family matches the SAME template that generated its text,
//      with the numbers as slots. That covers the case this feature exists for
//      — the user retyping numbers in the line we handed them.
// Either way the candidate params are then PROVED: the family, evaluated with
// them, must agree with the parsed expression at every sample point. A regex
// that matched by accident, or a Vandermonde solve on a non-polynomial, dies
// here rather than silently redrawing something else.
// ============================================================================

import type { CurveKind, FittedCurve, ModelSpec, ParsedPlot } from '../core/types'
import type { NLItem } from '../core/types'
import { parseExpression } from '../core/parse'

// ----------------------------------------------------------------------------
// Numbers
// ----------------------------------------------------------------------------

/** Relative slack allowed when shortening a number for display. */
const TEXT_REL = 1e-10

/**
 * The shortest decimal that still means this number.
 *
 * A snapped coefficient prints as "0.35"; a raw fit prints all the digits it
 * actually has. That is deliberate: the text seeds an editor, and an editor
 * that quietly rounded what it showed would move the curve the moment the
 * teacher pressed Enter on a line they had not changed.
 */
export function numText(v: number): string {
  if (!Number.isFinite(v)) return '0'
  if (v === 0) return '0'
  for (let d = 1; d <= 15; d++) {
    const r = Number(v.toPrecision(d))
    if (Math.abs(r - v) <= TEXT_REL * Math.abs(v)) return String(r)
  }
  return String(v)
}

/** Unsigned number, as the tokenizer in core/parse spells it. */
const NUM_SRC = '(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:[eE][+-]?\\d+)?'

// ----------------------------------------------------------------------------
// Templates: one description, used both to print and to read back
// ----------------------------------------------------------------------------

/** A number written on its own, sign included: "0.35", "-2". */
interface NumSlot { slot: number }
/** A number written as a continuation of a sum: " + 2.1", " - 0.7". */
interface SignedSlot { slot: number; signed: true; tight?: boolean }
type Part = string | NumSlot | SignedSlot

const isSlot = (p: Part): p is NumSlot | SignedSlot => typeof p !== 'string'
const isSigned = (p: NumSlot | SignedSlot): p is SignedSlot => 'signed' in p

interface Template {
  parts: Part[]
  /** Slot values -> model params. Identity when omitted; null rejects. */
  toParams?(slots: number[]): number[] | null
  /** Model params -> slot values. Identity when omitted; null means "no text". */
  toSlots?(params: number[]): number[] | null
  /**
   * How a candidate is proved. 'none' is only for templates that cannot match
   * anything else at all ("x = 5"), where there is no evaluator to compare
   * against because the family is parametric and the text is not.
   */
  verify: 'explicit' | 'polar' | 'implicit' | 'none'
}

const n = (slot: number): NumSlot => ({ slot })
const s = (slot: number): SignedSlot => ({ slot, signed: true })
const tight = (slot: number): SignedSlot => ({ slot, signed: true, tight: true })

/**
 * Every family that can be written down. `fourier` is deliberately absent: it
 * is a parametric sum of harmonics with no equation form the parser accepts,
 * so its card stays print-only rather than offering an editor that would
 * always throw the curve away.
 */
const TEMPLATES: Record<string, Template> = {
  // y = a·sin(bx + c) + d
  sine: {
    parts: ['y = ', n(0), 'sin(', n(1), 'x ', s(2), ') ', s(3)],
    verify: 'explicit',
  },
  // y = a·exp(−((x − b)/c)²) + d
  gauss: {
    parts: ['y = ', n(0), 'exp(-((x ', s(1), ')/', n(2), ')^2) ', s(3)],
    toSlots: (p) => [p[0], -p[1], p[2], p[3]],
    toParams: (v) => [v[0], -v[1], v[2], v[3]],
    verify: 'explicit',
  },
  // y = a·ln(x − b) + c
  log: {
    parts: ['y = ', n(0), 'ln(x ', s(1), ') ', s(2)],
    toSlots: (p) => [p[0], -p[1], p[2]],
    toParams: (v) => [v[0], -v[1], v[2]],
    verify: 'explicit',
  },
  // y = a/(x − b) + c
  recip: {
    parts: ['y = ', n(0), '/(x ', s(1), ') ', s(2)],
    toSlots: (p) => [p[0], -p[1], p[2]],
    toParams: (v) => [v[0], -v[1], v[2]],
    verify: 'explicit',
  },
  // y = a·exp(bx) + c
  exp: {
    parts: ['y = ', n(0), 'exp(', n(1), 'x) ', s(2)],
    verify: 'explicit',
  },
  // y = a·sqrt(x − b) + c
  sqrt: {
    parts: ['y = ', n(0), 'sqrt(x ', s(1), ') ', s(2)],
    toSlots: (p) => [p[0], -p[1], p[2]],
    toParams: (v) => [v[0], -v[1], v[2]],
    verify: 'explicit',
  },
  // y = a·cbrt(x − b) + c
  cbrt: {
    parts: ['y = ', n(0), 'cbrt(x ', s(1), ') ', s(2)],
    toSlots: (p) => [p[0], -p[1], p[2]],
    toParams: (v) => [v[0], -v[1], v[2]],
    verify: 'explicit',
  },
  // y = a·|x − b|^p + c   (params [a, b, c, p]; the exponent prints last)
  power: {
    parts: ['y = ', n(0), 'abs(x ', s(1), ')^', n(2), ' ', s(3)],
    toSlots: (p) => [p[0], -p[1], p[3], p[2]],
    toParams: (v) => [v[0], -v[1], v[3], v[2]],
    verify: 'explicit',
  },
  // y = a·|x − b| + c
  abs: {
    parts: ['y = ', n(0), 'abs(x ', s(1), ') ', s(2)],
    toSlots: (p) => [p[0], -p[1], p[2]],
    toParams: (v) => [v[0], -v[1], v[2]],
    verify: 'explicit',
  },
  // y = a / (1 + exp(−b(x − c))) + d
  logistic: {
    parts: ['y = ', n(0), '/(1 + exp(', tight(1), '(x ', s(2), '))) ', s(3)],
    toSlots: (p) => [p[0], -p[1], -p[2], p[3]],
    toParams: (v) => [v[0], -v[1], -v[2], v[3]],
    verify: 'explicit',
  },
  // x = a. Parametric family, implicit text — nothing else can be written this
  // way, so the shape of the line IS the proof.
  vline: {
    parts: ['x = ', n(0)],
    verify: 'none',
  },
  // (x − a)² + (y − b)² = r²
  circle: {
    parts: ['(x ', s(0), ')^2 + (y ', s(1), ')^2 = ', n(2)],
    toSlots: (p) => [-p[0], -p[1], p[2] * p[2]],
    toParams: (v) => (v[2] < 0 ? null : [-v[0], -v[1], Math.sqrt(v[2])]),
    verify: 'implicit',
  },
  // Ax² + Bxy + Cy² + Dx + Ey + F = 0
  ellipse: {
    // 'xy' would lex as one (unknown) name, so the product is written out.
    parts: [n(0), 'x^2 ', s(1), 'x*y ', s(2), 'y^2 ', s(3), 'x ', s(4), 'y ', s(5), ' = 0'],
    verify: 'implicit',
  },
  // r = a·cos(kθ + c)
  polarRose: {
    parts: ['r = ', n(0), 'cos(', n(1), 'theta ', s(2), ')'],
    verify: 'polar',
  },
  // r = a + b·cos(θ)
  limacon: {
    parts: ['r = ', n(0), ' ', s(1), 'cos(theta)'],
    verify: 'polar',
  },
  // r = a + b·θ
  spiral: {
    parts: ['r = ', n(0), ' ', s(1), 'theta'],
    verify: 'polar',
  },
}

/** Polynomial families, by the number of coefficients they store (ascending). */
const POLY_DEGREE: Record<string, number> = { line: 1, poly2: 2, poly3: 3, poly4: 4 }

// ----------------------------------------------------------------------------
// Printing
// ----------------------------------------------------------------------------

function renderTemplate(tpl: Template, params: number[]): string | null {
  const slots = tpl.toSlots ? tpl.toSlots(params) : params
  if (!slots || slots.some((v) => !Number.isFinite(v))) return null
  let out = ''
  for (const part of tpl.parts) {
    if (!isSlot(part)) {
      out += part
      continue
    }
    const v = slots[part.slot]
    if (v === undefined || !Number.isFinite(v)) return null
    if (isSigned(part)) {
      out += v < 0 ? '-' : '+'
      out += part.tight ? '' : ' '
      out += numText(Math.abs(v))
    } else {
      out += numText(v)
    }
  }
  return out
}

/**
 * A polynomial the way it is read aloud: highest power first, zero terms gone,
 * a bare "x" rather than "1x". This one is hand-written rather than templated
 * because the number of terms is not fixed.
 */
function polyText(coeffs: number[]): string {
  const terms: string[] = []
  for (let k = coeffs.length - 1; k >= 0; k--) {
    const c = coeffs[k]
    if (!Number.isFinite(c)) return 'y = 0'
    if (c === 0) continue
    const mag = Math.abs(c)
    const unit = mag === 1 && k > 0
    const body = k === 0 ? numText(mag) : k === 1 ? 'x' : `x^${k}`
    const head = unit || k === 0 ? body : `${numText(mag)}${body}`
    terms.push(terms.length === 0 ? (c < 0 ? `-${head}` : head) : `${c < 0 ? '- ' : '+ '}${head}`)
  }
  return `y = ${terms.length === 0 ? '0' : terms.join(' ')}`
}

/**
 * The equation on this card, in the form the user would type — or null when
 * the family has no such form (Fourier curves) and the card must stay
 * print-only.
 */
export function curveEquationText(curve: FittedCurve, spec: ModelSpec | undefined): string | null {
  if (!spec) return null
  const degree = POLY_DEGREE[curve.modelId]
  if (degree !== undefined) {
    const coeffs = curve.params.slice(0, degree + 1)
    if (coeffs.length !== degree + 1) return null
    return polyText(coeffs)
  }
  const tpl = TEMPLATES[curve.modelId]
  if (!tpl) return null
  return renderTemplate(tpl, curve.params)
}

/** Can this curve's equation be edited as text at all? */
export function isEquationEditable(curve: FittedCurve, spec: ModelSpec | undefined): boolean {
  return curveEquationText(curve, spec) !== null
}

// ----------------------------------------------------------------------------
// Reading it back
// ----------------------------------------------------------------------------

const escapeRe = (lit: string): string => lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A template's own text, as a regex: literals fixed, numbers captured. */
function templateRegExp(tpl: Template): RegExp {
  let src = '^\\s*'
  let first = true
  for (const part of tpl.parts) {
    if (!first) src += '\\s*'
    first = false
    if (!isSlot(part)) {
      // Whitespace inside a literal is advisory, not required.
      src += escapeRe(part).replace(/\s+/g, '\\s*')
    } else if (isSigned(part)) {
      src += `([+\\-−])\\s*(${NUM_SRC})`
    } else {
      src += `([+\\-−]?\\s*${NUM_SRC})`
    }
  }
  return new RegExp(`${src}\\s*$`)
}

const RE_CACHE = new Map<string, RegExp>()
function templateRegExpFor(modelId: string, tpl: Template): RegExp {
  let re = RE_CACHE.get(modelId)
  if (!re) {
    re = templateRegExp(tpl)
    RE_CACHE.set(modelId, re)
  }
  return re
}

/** Pull the slot values out of `src`, in template order, or null. */
function matchTemplate(tpl: Template, re: RegExp, src: string): number[] | null {
  const m = re.exec(src.replace(/−/g, '-'))
  if (!m) return null
  const slots: number[] = []
  let g = 1
  for (const part of tpl.parts) {
    if (!isSlot(part)) continue
    let v: number
    if (isSigned(part)) {
      const sign = m[g++] === '+' ? 1 : -1
      v = sign * Number(m[g++])
    } else {
      v = Number(m[g++].replace(/\s+/g, ''))
    }
    if (!Number.isFinite(v)) return null
    slots[part.slot] = v
  }
  return slots
}

/**
 * Recover polynomial coefficients from an arbitrary function, exactly when the
 * function really is a polynomial of that degree. Chebyshev nodes keep the
 * Vandermonde system well conditioned at the degrees we care about (≤ 4).
 */
function recoverPoly(f: (x: number) => number, degree: number): number[] | null {
  const m = degree + 1
  const rows: number[][] = []
  for (let i = 0; i < m; i++) {
    const x = 1.5 * Math.cos((Math.PI * (2 * i + 1)) / (2 * m))
    const y = f(x)
    if (!Number.isFinite(y)) return null
    const row = new Array<number>(m + 1)
    let p = 1
    for (let k = 0; k < m; k++) {
      row[k] = p
      p *= x
    }
    row[m] = y
    rows.push(row)
  }
  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < m; col++) {
    let pivot = col
    for (let r = col + 1; r < m; r++) {
      if (Math.abs(rows[r][col]) > Math.abs(rows[pivot][col])) pivot = r
    }
    if (Math.abs(rows[pivot][col]) < 1e-12) return null
    ;[rows[col], rows[pivot]] = [rows[pivot], rows[col]]
    for (let r = 0; r < m; r++) {
      if (r === col) continue
      const factor = rows[r][col] / rows[col][col]
      if (factor === 0) continue
      for (let k = col; k <= m; k++) rows[r][k] -= factor * rows[col][k]
    }
  }
  const out = new Array<number>(m)
  for (let i = 0; i < m; i++) {
    const v = rows[i][m] / rows[i][i]
    if (!Number.isFinite(v)) return null
    // Round-off is not information. A quadratic typed into a cubic's card must
    // read as x^3·0, not x^3·1e-16, and re-reading an unchanged "+ 2.1" must
    // give back 2.1 rather than 2.0999999999999996 — otherwise pressing Enter
    // on a line nobody edited would count as an edit.
    out[i] = Math.abs(v) < 1e-9 ? 0 : Number(v.toPrecision(12))
  }
  return out
}

/** Two readings of the same number, to the tolerance a redraw could show. */
function near(u: number, v: number): boolean {
  if (Number.isNaN(u) && Number.isNaN(v)) return true
  if (!Number.isFinite(u) || !Number.isFinite(v)) return u === v
  return Math.abs(u - v) <= 1e-6 * Math.max(1, Math.abs(u), Math.abs(v))
}

const SAMPLES = 41

/** Sample points across the curve's own span (or a default window). */
function sampleWindow(domain: [number, number] | null): number[] {
  const [lo, hi] = domain && domain[1] > domain[0] ? domain : [-8, 8]
  const out: number[] = []
  for (let i = 0; i < SAMPLES; i++) {
    // A slight offset keeps the samples off the symmetric points where two
    // different curves are most likely to agree by coincidence.
    out.push(lo + ((hi - lo) * (i + 0.317)) / SAMPLES)
  }
  return out
}

/**
 * Prove that `spec` with `params` is the same curve the user typed. Every
 * sample must agree, and enough of them must be real: a family that returns
 * NaN everywhere would otherwise "agree" with anything.
 */
function provesSame(
  spec: ModelSpec,
  params: number[],
  probe: ModelSpec,
  probeParams: number[],
  mode: Template['verify'],
  domain: [number, number] | null,
): boolean {
  try {
    if (mode === 'none') return true
    if (mode === 'explicit') {
      const a = spec.evalExplicit
      const b = probe.evalExplicit
      if (!a || !b) return false
      let live = 0
      for (const x of sampleWindow(domain)) {
        const u = a.call(spec, params, x)
        const v = b.call(probe, probeParams, x)
        if (!near(u, v)) return false
        if (Number.isFinite(u)) live++
      }
      return live >= 8
    }
    if (mode === 'polar') {
      const a = spec.evalPolar
      const b = probe.evalPolar
      if (!a || !b) return false
      let live = 0
      for (let i = 0; i < SAMPLES; i++) {
        const t = (2 * Math.PI * (i + 0.317)) / SAMPLES
        const u = a.call(spec, params, t)
        const v = b.call(probe, probeParams, t)
        if (!near(u, v)) return false
        if (Number.isFinite(u)) live++
      }
      return live >= 8
    }
    const a = spec.evalImplicit
    const b = probe.evalImplicit
    if (!a || !b) return false
    let live = 0
    for (let i = 0; i < 9; i++) {
      for (let j = 0; j < 9; j++) {
        const x = -8 + (16 * (i + 0.317)) / 9
        const y = -8 + (16 * (j + 0.317)) / 9
        const u = a.call(spec, params, x, y)
        const v = b.call(probe, probeParams, x, y)
        if (!near(u, v)) return false
        if (Number.isFinite(u)) live++
      }
    }
    return live >= 20
  } catch {
    return false
  }
}

const KIND_FOR: Record<Template['verify'], CurveKind | null> = {
  explicit: 'explicit',
  polar: 'polar',
  implicit: 'implicit',
  none: null,
}

export type EquationRead =
  | { ok: false; error: string }
  /** Still this family — same model, same handles, new numbers. */
  | { ok: true; mode: 'family'; params: number[] }
  /** No longer this family: build a typed expression from `plot`. */
  | { ok: true; mode: 'typed'; plot: ParsedPlot }

/**
 * Read an edited equation for `curve`.
 *
 * `spec` is the curve's CURRENT model. Pass it only when the curve belongs to
 * one of the fitted families: a curve that is already a typed expression stays
 * one, because it has no handles to protect and its free constants (a, b, …)
 * are sliders the user asked for by name.
 */
export function readCurveEquation(
  src: string,
  curve: FittedCurve,
  spec: ModelSpec | undefined,
): EquationRead {
  const text = src.trim()
  if (text === '') return { ok: false, error: 'Type an equation, or press Esc to leave this one.' }

  let outcome: ReturnType<typeof parseExpression>
  try {
    outcome = parseExpression(text)
  } catch {
    return { ok: false, error: 'The parser crashed on this input' }
  }
  if (!outcome.ok) return { ok: false, error: outcome.error }
  const plot = outcome.plot

  const params = spec ? recoverFamilyParams(text, curve, spec, plot) : null
  if (params) return { ok: true, mode: 'family', params }
  return { ok: true, mode: 'typed', plot }
}

/** The family route: candidate params, then proof. Null = not this family. */
function recoverFamilyParams(
  text: string,
  curve: FittedCurve,
  spec: ModelSpec,
  plot: ParsedPlot,
): number[] | null {
  // Free constants mean the user asked for sliders by name — that is a typed
  // expression by construction, whatever shape it happens to have.
  if (plot.paramNames.length > 0) return null

  const degree = POLY_DEGREE[curve.modelId]
  const tpl = TEMPLATES[curve.modelId]
  if (degree === undefined && !tpl) return null

  const mode: Template['verify'] = degree !== undefined ? 'explicit' : tpl!.verify
  const wantKind = KIND_FOR[mode]
  if (wantKind !== null && plot.kind !== wantKind) return null

  let probe: ModelSpec
  try {
    probe = plot.makeModel('__probe__')
  } catch {
    return null
  }
  const probeParams = plot.defaultParams.slice()

  let candidate: number[] | null
  if (degree !== undefined) {
    const f = probe.evalExplicit
    if (!f) return null
    candidate = recoverPoly((x) => f.call(probe, probeParams, x), degree)
  } else {
    const slots = matchTemplate(tpl!, templateRegExpFor(curve.modelId, tpl!), text)
    candidate = slots === null ? null : tpl!.toParams ? tpl!.toParams(slots) : slots
  }
  if (!candidate || candidate.length !== curve.params.length) return null
  if (candidate.some((v) => !Number.isFinite(v))) return null
  if (!provesSame(spec, candidate, probe, probeParams, mode, curve.domain)) return null
  return candidate
}

/**
 * The KaTeX for a curve whose equation the USER wrote, when what they wrote is
 * still true of the curve.
 *
 * A lesson whose subject is factored form types "y = 0.25(x+2)(x-1)(x-3)" and
 * gets a cubic — with drag handles, an Interpretations list and feature
 * editing, because the family survived the round trip. Expanding the line on
 * the spot is a different lesson, so the card keeps printing what was typed and
 * only falls back to the family's generated latex when the params have moved
 * away from it (a slider dragged, a zero stated) or the text no longer parses.
 *
 * Returns null whenever the source cannot be trusted; the caller then prints
 * `spec.latex(params)` exactly as before.
 */
export function displayEquationLatex(
  source: string | undefined,
  curve: FittedCurve,
  spec: ModelSpec | undefined,
): string | null {
  if (!source || !source.trim() || !spec) return null
  if (curve.modelId.startsWith('expr_')) return null
  let outcome: ReturnType<typeof parseExpression>
  try {
    outcome = parseExpression(source)
  } catch {
    return null
  }
  if (!outcome.ok) return null
  const params = recoverFamilyParams(source.trim(), curve, spec, outcome.plot)
  if (!params || params.length !== curve.params.length) return null
  // "Still says the same thing" is measured against the params on the card, to
  // the same tolerance a redraw could show.
  for (let i = 0; i < params.length; i++) {
    if (!near(params[i], curve.params[i])) return null
  }
  const latex = outcome.plot.latex
  return typeof latex === 'string' && latex.trim() !== '' ? latex : null
}

// ----------------------------------------------------------------------------
// Number lines
// ----------------------------------------------------------------------------

/** A bound as the inequality parser spells it back. */
function boundText(v: number | null, end: 'lo' | 'hi'): string {
  if (v === null) return end === 'lo' ? '-inf' : 'inf'
  return numText(v)
}

/**
 * What this item says, in text parseInequality reads back.
 *
 * Interval notation is used rather than an inequality because it round-trips
 * exactly, brackets included: "[-2, 5)" comes back as the same half-open
 * interval, where "-2 <= x < 5" would have to be re-derived. A point has no
 * notation for "excluded" — {4} is always closed — so an open point seeds as
 * the set it sits in, and the dot toggle below the equation stays the way to
 * take it out again.
 */
export function itemEquationText(item: NLItem): string {
  if (item.kind === 'point') return `{${numText(item.x)}}`
  const l = item.lo === null ? '(' : item.loClosed ? '[' : '('
  const r = item.hi === null ? ')' : item.hiClosed ? ']' : ')'
  return `${l}${boundText(item.lo, 'lo')}, ${boundText(item.hi, 'hi')}${r}`
}

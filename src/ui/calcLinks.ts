// ============================================================================
// src/ui/calcLinks.ts — the calculus objects a teacher adds to a curve, as
// plain data, plus every pure question the board asks about them.
//
// src/core/calculus.ts already computes the mathematics: a tangent's slope, a
// derivative's family, a definite integral, a Riemann sum's rectangles. None
// of it is STATE. What a board has to remember is much smaller and entirely
// declarative:
//
//   tangent     which curve, at which x        -> a real `line` curve
//   derivative  which curve                    -> a real curve in f's family
//   area        which curve, over [from, to]   -> an `area` overlay
//   riemann     which curve, [from, to], n, method -> a `rects` overlay
//
// That is the LINK. Everything visible is recomputed from it, every time the
// parent moves, which is the whole reason a slider drag can carry a tangent,
// a derivative curve, a shaded region and 200 rectangles with it: none of them
// are stored answers that could go stale, they are questions re-asked.
//
// Pure: no React, no DOM, no canvas. The App owns the state; this owns the
// meaning of it.
// ============================================================================

import type { FittedCurve, ModelSpec } from '../core/types'
import type { Overlay, OverlayRect } from '../render/overlays'
import type { RiemannMethod } from '../core/calculus'
import {
  accumulationModel,
  areaBetween,
  areaUnder,
  curveIntersections,
  isAccumulationOf,
  polynomialOf,
  riemann,
  tangentAt,
} from '../core/calculus'
import { analyzeCurve } from '../core/analyze'
import { exactForm } from '../core/exact'
import type {
  AccumulationLink,
  AreaLink,
  CalcKind,
  CalcLink,
  CurveLink,
  DerivativeLink,
  RiemannLink,
  SecantLink,
  TangentLink,
  TaylorLink,
} from '../core/persist'
import { secantOverlays, secantRow } from './secantLinks'
import type { SecantRow } from './secantLinks'
import {
  pName,
  taylorBlocked,
  taylorLegend,
  taylorLegendTex,
  taylorOverlays,
  taylorProblem,
  taylorRow,
  taylorSourceFor,
} from './taylorLinks'
import type { TaylorRow } from './taylorLinks'
import {
  ACCUM_MODEL_PREFIX,
  RIEMANN_N_DEFAULT,
  RIEMANN_N_MAX,
  RIEMANN_N_MIN,
  clampRiemannN,
  isCurveLink,
} from '../core/persist'

// The link SHAPES live in src/core/persist.ts, beside the format that stores
// and validates them (core may not import from src/ui). This module re-exports
// them so the UI has one place to reach for both the data and its meaning.
export type {
  AccumulationLink,
  AreaLink,
  CalcKind,
  CalcLink,
  CurveLink,
  DerivativeLink,
  RiemannLink,
  RiemannMethod,
  SecantLink,
  SecantRow,
  TangentLink,
  TaylorLink,
  TaylorRow,
}
export { isCurveLink }

export const RIEMANN_METHODS: readonly RiemannMethod[] = [
  'left',
  'right',
  'midpoint',
  'trapezoid',
]

/** n's slider range, as the loader also clamps it. */
export const N_MIN = RIEMANN_N_MIN
export const N_MAX = RIEMANN_N_MAX
export const N_DEFAULT = RIEMANN_N_DEFAULT

/** Integerise and clamp n. One rule, shared with persistence. */
export const clampN = clampRiemannN

// ---------------------------------------------------------------------------
// Dependents
// ---------------------------------------------------------------------------

/**
 * What goes when `curveId` goes.
 *
 * A link dies with its parent AND with its own curve: deleting a tangent line
 * from its own card must not leave a link driving a curve that is not there.
 * Transitive on purpose — the derivative of a curve can itself have a tangent,
 * and deleting the original has to take both.
 *
 * An area BETWEEN two curves has a second parent, and it dies with that one
 * too: the region between f and a curve that is gone is not the region under
 * f, it is nothing at all. So the shading goes, and the toast counts it.
 */
export function dependentsOf(
  links: readonly CalcLink[],
  curveIds: readonly string[],
): { linkIds: Set<string>; curveIds: Set<string> } {
  const deadCurves = new Set(curveIds)
  const deadLinks = new Set<string>()
  // Fixed point: at most one pass per link, since each pass kills one.
  for (let guard = 0; guard <= links.length; guard++) {
    let grew = false
    for (const l of links) {
      if (deadLinks.has(l.id)) continue
      const doomed =
        deadCurves.has(l.parentId) ||
        (isCurveLink(l) && deadCurves.has(l.curveId)) ||
        (l.kind === 'area' && l.otherId !== undefined && deadCurves.has(l.otherId))
      if (!doomed) continue
      deadLinks.add(l.id)
      if (isCurveLink(l)) deadCurves.add(l.curveId)
      grew = true
    }
    if (!grew) break
  }
  return { linkIds: deadLinks, curveIds: deadCurves }
}

/** "2 objects" / "1 object" — for the toast that names what went with it. */
export function countPhrase(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** How a dependent names itself in that toast. */
export function linkNoun(kind: CalcKind): string {
  switch (kind) {
    case 'tangent':
      return 'tangent line'
    case 'derivative':
      return 'derivative curve'
    case 'area':
      return 'shaded area'
    case 'riemann':
      return 'Riemann sum'
    case 'accumulation':
      return 'accumulation function'
    case 'taylor':
      return 'Taylor polynomial'
    case 'secant':
      return 'secant line'
  }
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

const curveById = (
  curves: readonly FittedCurve[],
  id: string,
): FittedCurve | undefined => curves.find((c) => c.id === id)

/**
 * The scene's overlay list, rebuilt from the links.
 *
 * Order matters: areas first, then rectangles, so a Riemann sum sitting on the
 * same interval as its exact integral draws its outlines ON the wash rather
 * than under it — which is exactly the picture "watch it converge" needs.
 *
 * A link whose parent is gone, is hidden, or whose sum refuses contributes
 * nothing: an overlay is a claim about a curve, and there is no curve.
 */
export function overlaysFor(
  links: readonly CalcLink[],
  curves: readonly FittedCurve[],
  models: Record<string, ModelSpec>,
  /**
   * The x-range a Taylor error band is sampled over — the view, padded.
   * Absent: no band (everything else draws as before).
   */
  span: [number, number] | null = null,
): Overlay[] {
  const out: Overlay[] = []
  for (const l of links) {
    if (l.kind !== 'area') continue
    const parent = curveById(curves, l.parentId)
    if (!parent || !parent.visible) continue
    if (!(l.to > l.from)) continue
    if (l.otherId === undefined) {
      out.push({ kind: 'area', curveId: parent.id, from: l.from, to: l.to })
      continue
    }
    // Between two curves, the second curve is a boundary of the region and not
    // a decoration on it: gone or hidden, there is no region to draw, and
    // falling back to the axis would shade a DIFFERENT region under the same
    // two numbers. Same rule as the parent, for the same reason.
    const other = curveById(curves, l.otherId)
    if (!other || !other.visible) continue
    out.push({ kind: 'area', curveId: parent.id, from: l.from, to: l.to, against: other.id })
  }
  // An accumulation's probe: the region from a to x, which IS g(x) − C. Split
  // where f crosses the axis, so the part that ADDS to g and the part that
  // takes away from it read as two different washes — with x left of a the
  // roles swap, because ∫ₐˣ runs backwards there.
  for (const l of links) {
    if (l.kind !== 'accumulation' || l.x === undefined) continue
    const parent = curveById(curves, l.parentId)
    if (!parent || !parent.visible) continue
    if (!Number.isFinite(l.x) || l.x === l.a) continue
    let at: ReturnType<typeof accumAt> = null
    try {
      at = accumAt(l, parent, models, l.x)
    } catch {
      at = null
    }
    if (!at) continue
    for (const piece of signedPieces(parent, models, l.a, l.x)) {
      out.push({
        kind: 'area',
        curveId: parent.id,
        from: piece.from,
        to: piece.to,
        alpha: piece.adds ? ACCUM_ADD_ALPHA : ACCUM_SUB_ALPHA,
      })
    }
  }
  for (const l of links) {
    if (l.kind !== 'riemann') continue
    const parent = curveById(curves, l.parentId)
    if (!parent || !parent.visible) continue
    let rects: readonly OverlayRect[] = []
    try {
      rects = riemann(parent, models, l.from, l.to, clampN(l.n), l.method)?.rects ?? []
    } catch {
      rects = []
    }
    if (rects.length === 0) continue
    out.push({ kind: 'rects', curveId: parent.id, rects })
  }
  // Taylor polynomials: the band and the axis strip wash under the curves,
  // the centre and the probe mark on top of them (src/ui/taylorLinks.ts).
  const taylors = links.filter((l): l is TaylorLink => l.kind === 'taylor')
  if (taylors.length > 0) {
    try {
      out.push(...taylorOverlays(taylors, curves, models, span))
    } catch {
      /* the Taylor marks are lost this frame; the rest of the figure stands */
    }
  }
  // Secants: the average-value rectangle washes under the curves; the secant,
  // the MVT tangents, their dots and chips mark on top (src/ui/secantLinks.ts).
  const secants = links.filter((l): l is SecantLink => l.kind === 'secant')
  if (secants.length > 0) {
    try {
      out.push(...secantOverlays(secants, curves, models))
    } catch {
      /* the secant marks are lost this frame; the rest of the figure stands */
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Readouts
// ---------------------------------------------------------------------------

const MINUS = '−'

/** A readout number: fixed places, a real minus sign, never "-0.000". */
export function fixed(v: number, places: number): string {
  if (!Number.isFinite(v)) return '—'
  const mag = Math.abs(v)
  if (mag !== 0 && (mag >= 1e7 || mag < Math.pow(10, -places) / 2)) {
    // Below what this many places can show, or past where they mean anything.
    if (mag < 1) return `0.${'0'.repeat(places)}`
    return v.toExponential(Math.max(1, places - 1)).replace('-', MINUS)
  }
  const s = v.toFixed(places)
  const cleaned = /^-0\.?0*$/.test(s) ? s.slice(1) : s
  return cleaned.replace('-', MINUS)
}

const SUB = '₀₁₂₃₄₅₆₇₈₉'
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹'

const digits = (n: number, table: string): string =>
  String(Math.abs(n))
    .split('')
    .map((d) => table[Number(d)])
    .join('')

/** Small non-negative integers only; everything else keeps its own row. */
const tiny = (v: number): boolean => Number.isInteger(v) && v >= 0 && v < 1000

/**
 * "∫₀²", when both bounds are small whole numbers, and a bare "∫" otherwise.
 *
 * There is no subscript full stop in Unicode, so "∫₀.₅" cannot be written; a
 * limit of 0.5 therefore goes in the bounds row beneath, where it is already
 * editable, rather than being silently rounded into the symbol.
 */
export function integralSymbol(from: number, to: number): string {
  if (!tiny(from) || !tiny(to)) return '∫'
  return `∫${digits(from, SUB)}${digits(to, SUP)}`
}

export interface AreaReadout {
  /** "∫₀² = 2.667" or "|area| ≈ 2.667" — the whole sentence. */
  text: string
  /** Set instead when the integral does not exist. */
  problem: string | null
  /** Sample count, when the number was integrated numerically. */
  samples: number | null
  value: number | null
}

/**
 * What the card says about one area link.
 *
 * "≈" and the sample count when the quadrature was numeric, "=" when a closed
 * form was used, and a refusal in words when the integral does not exist — a
 * finite number across a pole is the one answer that must never be printed.
 *
 * `other` is the second curve of an area BETWEEN curves, and the link's own
 * `otherId` is what decides whether one is wanted: a link that names a second
 * curve and is handed nothing says so ("the second curve is gone") rather than
 * quietly reading out the area under f, which is a different region.
 *
 * The sentence names the integrand rather than the curves — "∫₀² (f − g)" —
 * because the card already says which two curves those are, above it.
 */
export function areaReadout(
  link: AreaLink,
  parent: FittedCurve | undefined,
  models: Record<string, ModelSpec>,
  other?: FittedCurve,
): AreaReadout {
  const sym = integralSymbol(link.from, link.to)
  const between = link.otherId !== undefined
  const body = between ? (link.abs ? ' |f − g|' : ' (f − g)') : ''
  const lhs = between
    ? `${sym}${body}`
    : link.abs
      ? `|${sym}|`
      : sym
  const miss = (problem: string): AreaReadout => ({
    text: `${lhs} = —`,
    problem,
    samples: null,
    value: null,
  })
  if (!parent) return miss('the curve it was measuring is gone')
  if (between && !other) return miss('the second curve is gone')

  let res: ReturnType<typeof areaUnder>
  try {
    res =
      between && other
        ? areaBetween(parent, other, models, link.from, link.to, link.abs)
        : areaUnder(parent, models, link.from, link.to)
  } catch {
    res = null
  }
  if (!res) {
    // Name the limit that left the curve before calling anything undefined:
    // a sketch ends where its ink ends, and "a = -3.50 is outside …" tells
    // the teacher which chip to nudge. The pole sentence comes next, and the
    // bare "undefined on" is only for what is left.
    const outside =
      limitOutsideDomain(parent, link.from, link.to) ??
      (other ? limitOutsideDomain(other, link.from, link.to, 'the second curve') : null)
    if (outside) return miss(outside)
    const pole =
      poleBetween(parent, models, link.from, link.to) ??
      (other ? poleBetween(other, models, link.from, link.to) : null)
    return miss(
      pole === null
        ? `undefined on [${fixed(link.from, 2)}, ${fixed(link.to, 2)}]`
        : `undefined across the pole at x = ${fixed(pole, 2)}`,
    )
  }
  // areaBetween has already taken |f − g| piece by piece, which is the thing
  // `abs` means between curves; taking |·| again here would be harmless but
  // would also hide a sign the signed reading is entitled to.
  const value = link.abs && !between ? Math.abs(res.value) : res.value
  return {
    text: `${lhs} ${res.exact ? '=' : '≈'} ${fixed(value, 3)}`,
    problem: null,
    samples: res.exact ? null : (res.samples ?? null),
    value,
  }
}

/**
 * "a = -3.50 is outside this curve's domain [-3.42, 4.47]", or null.
 *
 * `noun` names WHICH curve the limit left: between two curves the region needs
 * both of them, and "outside this curve's domain" on the card of the one the
 * limit is comfortably inside is a sentence that sends a teacher hunting.
 */
function limitOutsideDomain(
  curve: FittedCurve,
  a: number,
  b: number,
  noun = 'this curve',
): string | null {
  const d = curve.domain
  if (!d) return null
  const lo = Math.min(d[0], d[1])
  const hi = Math.max(d[0], d[1])
  const tol = 1e-9 * Math.max(1, Math.abs(lo), Math.abs(hi))
  const out = (v: number): boolean => v < lo - tol || v > hi + tol
  const which = out(a) ? 'a' : out(b) ? 'b' : null
  if (!which) return null
  const v = which === 'a' ? a : b
  return `${which} = ${fixed(v, 2)} is outside ${noun}'s domain [${fixed(lo, 2)}, ${fixed(hi, 2)}]`
}

/**
 * Where the curve blows up inside [a, b], to the resolution a teacher reads.
 *
 * areaUnder() refuses without saying where, and "undefined" on its own is not
 * a thing a class can act on. This is a coarse scan for the sign-flipping
 * blow-up between two samples — enough to name the x, never enough to be
 * mistaken for the integral itself.
 */
function poleBetween(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  a: number,
  b: number,
): number | null {
  const spec = models[curve.modelId]
  const f = spec?.evalExplicit
  if (!f) return null
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  if (!(hi > lo)) return null
  const N = 240
  const at = (x: number): number => {
    try {
      const v = f.call(spec, curve.params, x)
      return typeof v === 'number' ? v : Number.NaN
    } catch {
      return Number.NaN
    }
  }
  let prev = at(lo)
  let worst: { x: number; mag: number } | null = null
  for (let i = 1; i <= N; i++) {
    const x = lo + ((hi - lo) * i) / N
    const v = at(x)
    if (!Number.isFinite(v) && Number.isFinite(prev)) return round6(x)
    if (Number.isFinite(v) && Number.isFinite(prev)) {
      const mag = Math.min(Math.abs(v), Math.abs(prev))
      if (Math.sign(v) !== Math.sign(prev) && mag > 1e3) {
        if (!worst || mag > worst.mag) worst = { x: round6(x - (hi - lo) / (2 * N)), mag }
      }
    }
    prev = v
  }
  return worst ? worst.x : null
}

const round6 = (v: number): number => Math.round(v * 1e6) / 1e6

/** "L₈" / "R₈" / "M₈" / "T₈" — the notation the board already writes. */
export function riemannSymbol(method: RiemannMethod, n: number): string {
  const letter =
    method === 'left' ? 'L' : method === 'right' ? 'R' : method === 'midpoint' ? 'M' : 'T'
  return `${letter}${digits(clampN(n), SUB)}`
}

export interface RiemannReadout {
  /** "L₈ = 1.750 → ∫ = 2.667" — the sum, and what it is converging to. */
  text: string
  problem: string | null
  value: number | null
  /** Subintervals whose sample was undefined and contributed nothing. */
  skipped: number
}

export function riemannReadout(
  link: RiemannLink,
  parent: FittedCurve | undefined,
  models: Record<string, ModelSpec>,
): RiemannReadout {
  const sym = riemannSymbol(link.method, link.n)
  if (!parent) {
    return { text: `${sym} = —`, problem: 'the curve it was summing is gone', value: null, skipped: 0 }
  }
  let sum: ReturnType<typeof riemann>
  try {
    sum = riemann(parent, models, link.from, link.to, clampN(link.n), link.method)
  } catch {
    sum = null
  }
  if (!sum) {
    return {
      text: `${sym} = —`,
      problem: `no sum on [${fixed(link.from, 2)}, ${fixed(link.to, 2)}]`,
      value: null,
      skipped: 0,
    }
  }
  let exact: ReturnType<typeof areaUnder>
  try {
    exact = areaUnder(parent, models, link.from, link.to)
  } catch {
    exact = null
  }
  const target = exact ? ` → ∫ = ${fixed(exact.value, 3)}` : ''
  return {
    text: `${sym} = ${fixed(sum.value, 3)}${target}`,
    problem: null,
    value: sum.value,
    skipped: sum.skipped,
  }
}

export interface TangentReadout {
  /** "tangent to Cubic at x = 2.00 · slope 9.00", when there is one. */
  text: string
  /** Set instead when the tangent does not exist; the line hides. */
  problem: string | null
  /** [b, m] for the `line` family. Null when there is no tangent. */
  params: [number, number] | null
  slope: number | null
}

/**
 * The tangent at x, as the card says it and as the line curve takes it.
 *
 * tangentAt() refuses at a corner, a pole, a vertical tangent and outside the
 * domain, and each refusal has a different sentence: a teacher who asked for
 * the slope of |x| at 0 is owed "|x| has a corner there", not a blank.
 */
export function tangentReadout(
  link: TangentLink,
  parent: FittedCurve | undefined,
  models: Record<string, ModelSpec>,
  parentName: string,
): TangentReadout {
  const at = `at x = ${fixed(link.x, 2)}`
  if (!parent) {
    return { text: `tangent ${at}`, problem: 'the curve it touches is gone', params: null, slope: null }
  }
  let t: ReturnType<typeof tangentAt>
  try {
    t = tangentAt(parent, models, link.x)
  } catch {
    t = null
  }
  if (!t) {
    return {
      text: `tangent to ${parentName} ${at}`,
      problem: whyNoTangent(parent, models, link.x),
      params: null,
      slope: null,
    }
  }
  return {
    text: `tangent to ${parentName} ${at} · slope ${fixed(t.m, 2)}`,
    problem: null,
    params: [t.b, t.m],
    slope: t.m,
  }
}

/**
 * Which of the reasons tangentAt() had. It does not say, and "no tangent" is
 * not a sentence a class can use: the three cases are three different lessons.
 */
function whyNoTangent(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  x: number,
): string {
  const d = curve.domain
  if (d && (x < Math.min(d[0], d[1]) || x > Math.max(d[0], d[1]))) {
    return `x = ${fixed(x, 2)} is outside this curve's domain [${fixed(
      Math.min(d[0], d[1]),
      2,
    )}, ${fixed(Math.max(d[0], d[1]), 2)}]`
  }
  const spec = models[curve.modelId]
  const f = spec?.evalExplicit
  if (!f) return 'this curve is not a function of x, so it has no tangent line in x'
  const at = (t: number): number => {
    try {
      const v = f.call(spec, curve.params, t)
      return typeof v === 'number' ? v : Number.NaN
    } catch {
      return Number.NaN
    }
  }
  const y = at(x)
  if (!Number.isFinite(y)) return `this curve is undefined at x = ${fixed(x, 2)}`
  const h = 1e-3 * Math.max(1, Math.abs(x))
  const left = (y - at(x - h)) / h
  const right = (at(x + h) - y) / h
  if (Number.isFinite(left) && Number.isFinite(right)) {
    const scale = Math.max(Math.abs(left), Math.abs(right))
    if (scale > 1e5) return `the slope runs away at x = ${fixed(x, 2)}`
    if (Math.abs(left - right) > 0.05 * Math.max(1, scale)) {
      return `there is a corner at x = ${fixed(x, 2)}, so the slope has no single value`
    }
  }
  return `no tangent line exists at x = ${fixed(x, 2)}`
}


// ---------------------------------------------------------------------------
// Accumulation functions — g(x) = C + ∫ₐˣ f(t) dt
// ---------------------------------------------------------------------------

/** The wash for the part of [a, x] that ADDS to g, and for the part that takes away. */
export const ACCUM_ADD_ALPHA = 0.26
export const ACCUM_SUB_ALPHA = 0.09

const SUB_MINUS = '₋'

/** "₀", "₋₂" — a subscript for a small whole number; "ₐ" for anything else. */
function subLimit(a: number): string {
  if (Number.isInteger(a) && Math.abs(a) < 1000) {
    return `${a < 0 ? SUB_MINUS : ''}${digits(a, SUB)}`
  }
  return 'ₐ'
}

/**
 * A number the way a teacher writes it: "2", "−1.5", "2/3", "√3" — a closed
 * form only when it is one to double precision, trimmed decimals otherwise.
 */
export function short(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const r = round6(v)
  if (Number.isInteger(r) && Math.abs(v - r) < 1e-9) return fixed(r, 0)
  const three = Math.round(v * 1000) / 1000
  if (Math.abs(v - three) < 1e-9 * Math.max(1, Math.abs(v))) {
    return fixed(three, 3).replace(/0+$/, '').replace(/\.$/, '')
  }
  const ex = exactForm(v)
  if (ex) return ex.text
  return fixed(v, 3).replace(/0+$/, '').replace(/\.$/, '')
}

/**
 * g at x, and whether that number came from a closed form. Null when g(x) does
 * not exist: a outside f's domain, f undefined at a, x across a pole or a gap.
 *
 * The closure the board registered for this link is used when it is still the
 * right one — it shares its table with the curve on screen — and is handed the
 * parent's CURRENT params, so a readout never lags a slider by a frame.
 */
export function accumAt(
  link: AccumulationLink,
  parent: FittedCurve,
  models: Record<string, ModelSpec>,
  x: number,
): { value: number; exact: boolean } | null {
  const g = accumEvaluator(link, parent, models)
  return g ? g(x) : null
}

/**
 * accumAt for many x: the model (and, for a closure, its table) is built once.
 * Null when g does not exist anywhere.
 */
export function accumEvaluator(
  link: AccumulationLink,
  parent: FittedCurve,
  models: Record<string, ModelSpec>,
): ((x: number) => { value: number; exact: boolean } | null) | null {
  const id = `${ACCUM_MODEL_PREFIX}${link.id}`
  let acc: ReturnType<typeof accumulationModel> = null
  try {
    acc = accumulationModel(parent, models, link.a, link.C, id)
  } catch {
    acc = null
  }
  if (!acc) return null
  const reg = models[id]
  const spec =
    !acc.exact && isAccumulationOf(reg, models[parent.modelId], parent.params.length) ? reg : acc.spec
  const ev = spec.evalExplicit
  if (!ev) return null
  const params = acc.params
  const exact = acc.exact
  const d = sorted(parent.domain)
  return (x: number) => {
    if (!Number.isFinite(x)) return null
    if (d && (x < d[0] - 1e-9 * Math.max(1, Math.abs(d[0])) || x > d[1] + 1e-9 * Math.max(1, Math.abs(d[1])))) {
      return null
    }
    let v: number
    try {
      v = ev.call(spec, params, x)
    } catch {
      v = Number.NaN
    }
    return Number.isFinite(v) ? { value: v, exact } : null
  }
}

/**
 * [a, x] cut where f crosses the axis, each piece marked by whether it adds to
 * g (f > 0 going right, or f < 0 going left) or takes away.
 */
export function signedPieces(
  parent: FittedCurve,
  models: Record<string, ModelSpec>,
  a: number,
  x: number,
): { from: number; to: number; adds: boolean }[] {
  const spec = models[parent.modelId]
  const ev = spec?.evalExplicit
  const lo = Math.min(a, x)
  const hi = Math.max(a, x)
  if (!ev || !(hi > lo)) return []
  const f = (t: number): number => {
    try {
      const v = ev.call(spec, parent.params, t)
      return typeof v === 'number' ? v : Number.NaN
    } catch {
      return Number.NaN
    }
  }
  const N = 160
  const cuts: number[] = [lo]
  // A zero landing exactly ON a sample (x² − 1 at 1) is a cut of its own; it
  // would otherwise hide between two samples that each have a sign.
  let px = lo
  let py = f(lo)
  for (let i = 1; i <= N; i++) {
    const t = i === N ? hi : lo + ((hi - lo) * i) / N
    const y = f(t)
    if (!Number.isFinite(y)) {
      py = Number.NaN
      continue
    }
    if (y === 0) {
      if (i < N) cuts.push(t)
      px = t
      py = 0
      continue
    }
    if (Number.isFinite(py) && py !== 0 && Math.sign(y) !== Math.sign(py)) {
      let l = px
      let r = t
      const sl = Math.sign(py)
      for (let k = 0; k < 60; k++) {
        const m = (l + r) / 2
        if (m === l || m === r) break
        if (Math.sign(f(m)) === sl) l = m
        else r = m
      }
      const c = (l + r) / 2
      if (c > cuts[cuts.length - 1]) cuts.push(c)
    }
    px = t
    py = y
  }
  cuts.push(hi)
  const forward = x > a
  const out: { from: number; to: number; adds: boolean }[] = []
  for (let i = 0; i + 1 < cuts.length; i++) {
    const from = cuts[i]
    const to = cuts[i + 1]
    if (!(to > from)) continue
    const y = f((from + to) / 2)
    const adds = Number.isFinite(y) ? (y >= 0) === forward : true
    const last = out[out.length - 1]
    if (last && last.adds === adds && last.to === from) last.to = to
    else out.push({ from, to, adds })
  }
  return out
}

export interface AccumReadout {
  /** "g(2) = 2/3 (0.667)", "g(2) ≈ 1.605" — empty when there is no probe. */
  text: string
  problem: string | null
  value: number | null
  exact: boolean
}

/** What the parent's card says at the probe. */
export function accumReadout(
  link: AccumulationLink,
  parent: FittedCurve | undefined,
  models: Record<string, ModelSpec>,
  gName = 'g',
  fName = 'f',
): AccumReadout {
  const none = { text: '', problem: null, value: null, exact: false }
  if (!parent) return { ...none, problem: 'the curve it came from is gone' }
  const startProblem = accumStartProblem(link, parent, models, fName)
  if (startProblem) return { ...none, text: `${gName}(x) = —`, problem: startProblem }
  if (link.x === undefined) return none
  const x = link.x
  const lhs = `${gName}(${short(x)})`
  let at: ReturnType<typeof accumAt> = null
  try {
    at = accumAt(link, parent, models, x)
  } catch {
    at = null
  }
  if (!at) {
    const outside = limitOutsideDomain(parent, link.a, x, `${fName}`)
    if (outside) {
      return { ...none, text: `${lhs} = —`, problem: outside.replace(/^b = /, 'x = ') }
    }
    const pole = poleBetween(parent, models, link.a, x)
    return {
      ...none,
      text: `${lhs} = —`,
      problem:
        pole === null
          ? `${fName} is undefined between a and x, so ${lhs} does not exist`
          : `the integral from a runs into the pole at x = ${fixed(pole, 2)}, so ${lhs} does not exist`,
    }
  }
  const v = at.value
  const dec = fixed(v, 3)
  if (!at.exact) return { text: `${lhs} ≈ ${dec}`, problem: null, value: v, exact: false }
  // A closed form the decimal cannot show ("2/3") is printed with the decimal
  // beside it; a number the decimal already says exactly ("2.25") is not.
  const s = short(v)
  const text = /^[−-]?\d+(\.\d+)?$/.test(s) ? `${lhs} = ${s}` : `${lhs} = ${s} (${dec})`
  return { text, problem: null, value: v, exact: true }
}

/** Why g does not exist at all (a is not a place to start), or null. */
function accumStartProblem(
  link: AccumulationLink,
  parent: FittedCurve,
  models: Record<string, ModelSpec>,
  fName: string,
): string | null {
  const d = parent.domain
  if (d && Number.isFinite(d[0]) && Number.isFinite(d[1])) {
    const lo = Math.min(d[0], d[1])
    const hi = Math.max(d[0], d[1])
    const tol = 1e-9 * Math.max(1, Math.abs(lo), Math.abs(hi))
    if (link.a < lo - tol || link.a > hi + tol) {
      return `a = ${fixed(link.a, 2)} is outside ${fName}'s domain [${fixed(lo, 2)}, ${fixed(hi, 2)}]`
    }
  }
  let acc: ReturnType<typeof accumulationModel> = null
  try {
    acc = accumulationModel(parent, models, link.a, link.C, `${ACCUM_MODEL_PREFIX}${link.id}`)
  } catch {
    acc = null
  }
  if (acc) return null
  if (models[parent.modelId]?.kind !== 'explicit') {
    return `${fName} is not a function of x`
  }
  return `${fName} is undefined at a = ${fixed(link.a, 2)}, so the integral cannot start there`
}

/** "g(x) = 2 + ∫₋₂ˣ f(t) dt" — the definition, with the link's own numbers. */
export function accumHead(link: AccumulationLink, gName = 'g', fName = 'f'): string {
  const c = link.C === 0 ? '' : `${short(link.C)} + `
  return `${gName}(x) = ${c}∫${subLimit(link.a)}ˣ ${fName}(t) dt`
}

/**
 * The AP connections, read off the PARENT's analysis: where g rises and falls
 * (the sign of f), its relative extrema (where f changes sign), its concavity
 * (whether f rises) and its inflection points (f's extrema).
 *
 * Only where g exists — the run of f's domain containing a, up to the first
 * pole or gap — and over the whole line only for a polynomial, whose zeros and
 * extrema the analysis finds all of. Anything else is read over a window, and
 * the last sentence says which.
 */
export function accumFacts(
  link: AccumulationLink,
  parent: FittedCurve | undefined,
  models: Record<string, ModelSpec>,
  gName = 'g',
  fName = 'f',
): string[] {
  const out: string[] = [`${gName}′(x) = ${fName}(x)`]
  if (!parent) return out
  const spec = models[parent.modelId]
  const ev = spec?.evalExplicit
  if (!ev) return out
  const f = (t: number): number => {
    try {
      const v = ev.call(spec, parent.params, t)
      return typeof v === 'number' ? v : Number.NaN
    } catch {
      return Number.NaN
    }
  }
  const dom = sorted(parent.domain)
  // Over the whole line only for a polynomial (a family, or typed text that is
  // one): its zeros and extrema are all in the window the analysis reads.
  const poly = !dom && polynomialOf(parent, models) !== null
  const win: [number, number] = dom ?? [Math.min(-10, link.a - 10), Math.max(10, link.a + 10)]
  const g = accumEvaluator(link, parent, models)
  if (!g || !g(link.a)) return out

  // Where g exists: walk out from a until g stops, and pin the edge down.
  const edge = (dir: 1 | -1): number => {
    const end = dir > 0 ? win[1] : win[0]
    const N = 400
    let good = link.a
    for (let i = 1; i <= N; i++) {
      const t = link.a + ((end - link.a) * i) / N
      if (g(t)) {
        good = t
        continue
      }
      let l = good
      let r = t
      for (let k = 0; k < 50; k++) {
        const m = (l + r) / 2
        if (m === l || m === r) break
        if (g(m)) l = m
        else r = m
      }
      return snapEdge(l, r, spec, parent, win)
    }
    return end
  }
  const L = edge(-1)
  const R = edge(1)
  const infL = poly && L === win[0]
  const infR = poly && R === win[1]
  if (!(R > L)) return out

  let pts: ReturnType<typeof analyzeCurve> = []
  try {
    pts = analyzeCurve({ ...parent, domain: [L, R] }, models)
  } catch {
    pts = []
  }
  const inside = (x: number): boolean => x > L + 1e-9 * (R - L) && x < R - 1e-9 * (R - L)
  const label = new Map<number, string>()
  const name = (x: number): string => label.get(x) ?? short(x)
  const zeros: number[] = []
  const turns: number[] = []
  for (const p of pts) {
    if (!inside(p.pos.x)) continue
    if (p.kind === 'zero') zeros.push(p.pos.x)
    else if (p.kind === 'maximum' || p.kind === 'minimum') turns.push(p.pos.x)
    else continue
    if (p.exactX) label.set(p.pos.x, p.exactX)
  }
  zeros.sort((p, q) => p - q)
  turns.sort((p, q) => p - q)
  const end = (x: number, inf: boolean, side: -1 | 1): string =>
    inf ? (side < 0 ? '−∞' : '∞') : short(x)

  /** Pieces between breakpoints, each with a sign from `probe`, merged. */
  const pieces = (cuts: number[], probe: (m: number) => number) => {
    const bs = [L, ...cuts, R]
    const res: { lo: number; hi: number; sign: number }[] = []
    for (let i = 0; i + 1 < bs.length; i++) {
      const lo = bs[i]
      const hi = bs[i + 1]
      const m =
        i === 0 && infL
          ? hi - Math.max(1, Math.abs(hi) * 0.1)
          : i === bs.length - 2 && infR
            ? lo + Math.max(1, Math.abs(lo) * 0.1)
            : (lo + hi) / 2
      const v = probe(m)
      const sign = Number.isFinite(v) ? Math.sign(v) : 0
      const last = res[res.length - 1]
      if (last && last.sign === sign) last.hi = hi
      else res.push({ lo, hi, sign })
    }
    return res
  }
  const intervals = (ps: { lo: number; hi: number; sign: number }[], sign: number): string =>
    ps
      .filter((p) => p.sign === sign)
      .map((p) => `(${end(p.lo, infL && p.lo === L, -1)}, ${end(p.hi, infR && p.hi === R, 1)})`)
      .join(' ∪ ')
  /** Where the sign flips between neighbouring merged pieces. */
  const flips = (ps: { lo: number; hi: number; sign: number }[], from: number, to: number): number[] => {
    const xs: number[] = []
    for (let i = 0; i + 1 < ps.length; i++) {
      if (ps[i].sign === from && ps[i + 1].sign === to) xs.push(ps[i].hi)
    }
    return xs
  }

  const sgn = pieces(zeros, f)
  const up = intervals(sgn, 1)
  const down = intervals(sgn, -1)
  if (up) out.push(`${gName} increases where ${fName} > 0: ${up}`)
  if (down) out.push(`${gName} decreases where ${fName} < 0: ${down}`)
  const maxes = flips(sgn, 1, -1)
  const mins = flips(sgn, -1, 1)
  if (maxes.length) {
    out.push(`relative max of ${gName} at x = ${maxes.map(name).join(', ')} (${fName} changes + to −)`)
  }
  if (mins.length) {
    out.push(`relative min of ${gName} at x = ${mins.map(name).join(', ')} (${fName} changes − to +)`)
  }

  const slope = (m: number): number => {
    const h = 1e-4 * Math.max(1, Math.abs(m), (R - L) / 100)
    return f(m + h) - f(m - h)
  }
  const bend = pieces(turns, slope)
  const cu = intervals(bend, 1)
  const cd = intervals(bend, -1)
  if (cu) out.push(`${gName} concave up where ${fName} is increasing: ${cu}`)
  if (cd) out.push(`${gName} concave down where ${fName} is decreasing: ${cd}`)
  const infl = [...flips(bend, 1, -1), ...flips(bend, -1, 1)].sort((p, q) => p - q)
  if (infl.length) {
    out.push(
      `inflection point${infl.length === 1 ? '' : 's'} of ${gName} at x = ${infl
        .map(name)
        .join(', ')} (extrema of ${fName})`,
    )
  }
  if (!dom && !poly && (L === win[0] || R === win[1])) {
    out.push(`read over ${short(win[0])} ≤ x ≤ ${short(win[1])}`)
  }
  return out
}

const SPEC_SERIALS = new WeakMap<object, number>()
let specSerialNext = 1

/**
 * A number per ModelSpec OBJECT, so "the same formula" can be part of a string
 * signature: a retyped expression may keep its model id and swap the function.
 */
export function specSerial(spec: ModelSpec | undefined): number {
  if (!spec) return 0
  let n = SPEC_SERIALS.get(spec)
  if (n === undefined) {
    n = specSerialNext++
    SPEC_SERIALS.set(spec, n)
  }
  return n
}

/**
 * The accumulation curve's colour: the parent's, lightened toward white. A
 * derivative is the parent's colour DASHED; g is solid and paler, so f, f′ and
 * g on one board read as one family and still as three different curves.
 */
export function accumColor(color: string): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (!m) return color
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
  const mix = (i: number): string => {
    const v = parseInt(hex.slice(i, i + 2), 16)
    const w = Math.round(v + (255 - v) * 0.45)
    return w.toString(16).padStart(2, '0')
  }
  return `#${mix(0)}${mix(2)}${mix(4)}`
}

/**
 * Pin the end of g's existence onto the thing that ended it. The table walls
 * off a pole to within one cell, so the raw edge is a hair short of it; the
 * family's own singularity (x = b for a log or a reciprocal) or a whole or
 * half number that close is where it really is.
 */
function snapEdge(
  good: number,
  bad: number,
  spec: ModelSpec | undefined,
  parent: FittedCurve,
  win: [number, number],
): number {
  const reach = Math.max(Math.abs(bad - good), (win[1] - win[0]) / 400)
  try {
    const sing = spec?.singularities?.(parent.params, [good - 4 * reach, good + 4 * reach]) ?? []
    for (const x of sing) if (Math.abs(x - good) <= 4 * reach) return x
  } catch {
    /* fall through */
  }
  const half = Math.round(good * 2) / 2
  if (Math.abs(half - good) <= 4 * reach) return half
  return good
}

/**
 * a and the probe x for a fresh accumulation: 0 when the integral can start
 * there (the AP default), and a probe two units to the right when g exists
 * there — the numbers a teacher would have typed.
 */
export function defaultAccum(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  window: [number, number],
): { a: number; x: number | undefined } | null {
  const [lo, hi] = spanOf(curve, window)
  const within = (v: number): boolean => v >= lo - 1e-9 && v <= hi + 1e-9
  const tries = [0, 1, -1, nice((lo + hi) / 2), lo, lo + (hi - lo) / 4, (lo + hi) / 2]
  let a: number | null = null
  for (const t of tries) {
    if (!within(t)) continue
    try {
      if (accumulationModel(curve, models, t, 0, 'intf:probe')) {
        a = round6(t)
        break
      }
    } catch {
      /* next */
    }
  }
  if (a === null) return null
  const probe: AccumulationLink = { kind: 'accumulation', id: 'probe', parentId: curve.id, curveId: '', a, C: 0 }
  const g = accumEvaluator(probe, curve, models)
  for (const t of [a + 2, a + 1, a - 2, a - 1, nice((a + hi) / 2), (a + hi) / 2, (lo + a) / 2]) {
    if (!within(t) || t === a) continue
    if (g?.(t)) return { a, x: round6(t) }
  }
  return { a, x: undefined }
}

// ---------------------------------------------------------------------------
// Defaults for a freshly added object
// ---------------------------------------------------------------------------

/** Round to the nearest half — the numbers a teacher would have typed. */
const nice = (v: number): number => Math.round(v * 2) / 2

/**
 * The x a tangent starts at: 0 when the curve is defined there, otherwise the
 * middle of whatever the curve actually occupies. It is immediately editable
 * and draggable, so this only has to be a place the tangent EXISTS.
 */
export function defaultTangentX(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  window: [number, number],
): number {
  const [lo, hi] = spanOf(curve, window)
  const tries = [0, nice((lo + hi) / 2), (lo + hi) / 2, lo + (hi - lo) / 4, hi - (hi - lo) / 4]
  for (const x of tries) {
    if (x < lo || x > hi) continue
    try {
      if (tangentAt(curve, models, x)) return round6(x)
    } catch {
      /* try the next one */
    }
  }
  return round6(Math.max(lo, Math.min(hi, 0)))
}

/**
 * [a, b] for a fresh area or Riemann sum.
 *
 * A curve with a domain — every sketch, every restricted equation — opens
 * on the WHOLE of it, end to end: that is the region the teacher just drew,
 * and limits sitting on the ends follow the ends when they are dragged
 * (`followDomains`). A curve that is everywhere gets the visible window
 * rounded inward to halves, the numbers a teacher would have typed. Never a
 * window the curve is not on — a shaded region off the end of the sketch is
 * a picture of nothing.
 */
export function defaultBounds(
  curve: FittedCurve,
  window: [number, number],
): [number, number] {
  const d = curve.domain
  if (d && Number.isFinite(d[0]) && Number.isFinite(d[1]) && d[1] > d[0]) {
    return [round6(d[0]), round6(d[1])]
  }
  const [lo, hi] = spanOf(curve, window)
  // Round INWARD: [-3.42, 4.47] must never become [-3.5, 4.5], which areaUnder
  // would rightly refuse ("undefined on …"). A hair of slack keeps a span that
  // already sits on a half (1.0000000001) from being pushed to the next one.
  const slack = 1e-9 * Math.max(1, Math.abs(lo), Math.abs(hi))
  const a = Math.ceil((lo - slack) * 2) / 2
  const b = Math.floor((hi + slack) * 2) / 2
  if (b - a >= 0.5) return [round6(Math.max(a, lo)), round6(Math.min(b, hi))]
  return [round6(lo), round6(hi)]
}

/**
 * [a, b] for a fresh area BETWEEN two curves.
 *
 * The region an AP question is about is almost always the one the curves
 * enclose, so the opening interval runs from the first crossing in view to the
 * last: outermost, not nearest, because two parabolas meeting at ±1 with a
 * third crossing between them still bound ONE region and [−1, 1] is it.
 *
 * One crossing bounds nothing, so it gets a unit of room on each side — enough
 * to see the two curves separate — and none at all falls back to the same rule
 * `defaultBounds` uses, on the overlap of the two curves instead of one.
 *
 * Every case is clipped to where BOTH curves are: an interval reaching past
 * the end of either sketch is a region with one boundary missing, and
 * `areaBetween` would rightly refuse to put a number on it.
 */
export function defaultBetweenBounds(
  parent: FittedCurve,
  other: FittedCurve,
  models: Record<string, ModelSpec>,
  window: [number, number],
): [number, number] {
  const [alo, ahi] = spanOf(parent, window)
  const [blo, bhi] = spanOf(other, window)
  // Where both curves live, whether or not the board is looking at it.
  const olo = Math.max(alo, blo)
  const ohi = Math.min(ahi, bhi)
  // The RESTRICTIONS, separately: a curve with no domain is everywhere, and
  // must not be clipped to the window merely because that is where it was
  // drawn. spanOf's window fallback is for choosing a region to open on; this
  // is for refusing one the curve is not on.
  const dlo = Math.max(domLo(parent), domLo(other))
  const dhi = Math.min(domHi(parent), domHi(other))
  const [wlo, whi] =
    Number.isFinite(window?.[0]) && Number.isFinite(window?.[1]) && window[1] > window[0]
      ? window
      : [olo, ohi]
  const vlo = Math.max(olo, wlo)
  const vhi = Math.min(ohi, whi)

  let hits: number[] = []
  if (vhi > vlo) {
    try {
      hits = curveIntersections(parent, other, models, [vlo, vhi])
    } catch {
      hits = []
    }
  }

  if (hits.length >= 2) {
    return [round6(hits[0]), round6(hits[hits.length - 1])]
  }
  if (hits.length === 1) {
    const x = hits[0]
    // Clipped to the DOMAINS, not to the window: a teacher who zoomed in on
    // the crossing still gets the region, and can pan to see the rest of it.
    const lo = Math.max(x - 1, dlo)
    const hi = Math.min(x + 1, dhi)
    if (hi > lo) return [round6(lo), round6(hi)]
    return [round6(x), round6(x)]
  }

  if (!(vhi > vlo)) {
    // The two curves share no x the board is looking at. Hand back the overlap
    // itself, or — when even that is empty — a degenerate interval, which
    // reads as 0 rather than as a region that is not there.
    return ohi > olo ? [round6(olo), round6(ohi)] : [round6(olo), round6(olo)]
  }
  // Round INWARD to halves, exactly as defaultBounds does, and never past the
  // overlap: [-3.42, 4.47] must not become [-3.5, 4.5].
  const slack = 1e-9 * Math.max(1, Math.abs(vlo), Math.abs(vhi))
  const a = Math.ceil((vlo - slack) * 2) / 2
  const b = Math.floor((vhi + slack) * 2) / 2
  if (b - a >= 0.5) return [round6(Math.max(a, vlo)), round6(Math.min(b, vhi))]
  return [round6(vlo), round6(vhi)]
}

/**
 * Carry an interval with the ends of its curve.
 *
 * A limit sitting ON an end of the sketch means "to the end": when the
 * teacher drags that end out (or in), the limit goes with it, so the shading
 * keeps covering the whole curve they extended. A limit strictly inside the
 * sketch is a number they chose and stays put — unless the sketch shrank
 * past it, in which case it is pulled back to the new end rather than left
 * pointing at nothing. `prev` maps curve id → the domain that curve had the
 * last time this ran; a curve missing from it is skipped (a freshly loaded
 * document, not a drag). Returns null when no link had to move.
 *
 * Between two curves the interval belongs to the INTERSECTION of the two
 * domains: that is the only x-range where "the area between them" is a thing
 * that exists, so shortening either sketch pulls the limits back, and an end
 * sitting on the intersection's edge travels with whichever curve is currently
 * making that edge.
 */
export function followDomains(
  links: readonly CalcLink[],
  prev: ReadonlyMap<string, [number, number] | null>,
  curves: readonly FittedCurve[],
): CalcLink[] | null {
  const byId = new Map(curves.map((c) => [c.id, c]))
  let out: CalcLink[] | null = null
  links.forEach((link, i) => {
    if (link.kind !== 'area' && link.kind !== 'riemann') return
    if (!prev.has(link.parentId)) return
    const parent = byId.get(link.parentId)
    if (!parent) return
    const otherId = link.kind === 'area' ? link.otherId : undefined
    const other = otherId === undefined ? undefined : byId.get(otherId)
    if (otherId !== undefined && (!other || !prev.has(otherId))) return
    const was = both(
      sorted(prev.get(link.parentId) ?? null),
      other ? sorted(prev.get(otherId as string) ?? null) : null,
      other !== undefined,
    )
    const now = both(sorted(parent.domain), other ? sorted(other.domain) : null, other !== undefined)
    if (String(was) === String(now)) return
    const carry = (v: number): number => {
      let x = v
      if (was && now) {
        const tol = 1e-9 * Math.max(1, Math.abs(was[0]), Math.abs(was[1]))
        if (Math.abs(v - was[0]) <= tol) x = now[0]
        else if (Math.abs(v - was[1]) <= tol) x = now[1]
      }
      if (now) x = Math.min(Math.max(x, now[0]), now[1])
      // Not rounded: an end is wherever the drag left it, and a limit a
      // millionth past it would be refused as outside the domain.
      return x
    }
    const from = carry(link.from)
    const to = carry(link.to)
    if (from === link.from && to === link.to) return
    if (!out) out = links.slice()
    out[i] = { ...link, from, to } as CalcLink
  })
  return out
}

/**
 * The x-range two curves share: the intersection, with "no domain" meaning no
 * restriction rather than an empty one. `pair` false is the one-curve case,
 * where `b` is not a second domain but an absence.
 *
 * An empty intersection is reported as no restriction. The two sketches no
 * longer overlap at all, and there is no honest place to put the limits: the
 * readout will refuse in words, which is better than silently collapsing the
 * region to a point on the way past.
 */
function both(
  a: [number, number] | null,
  b: [number, number] | null,
  pair: boolean,
): [number, number] | null {
  if (!pair) return a
  if (!a) return b
  if (!b) return a
  const lo = Math.max(a[0], b[0])
  const hi = Math.min(a[1], b[1])
  return hi > lo ? [lo, hi] : null
}

/** A curve's own x-restriction, as a half-line pair; ±Infinity when it has none. */
const domLo = (c: FittedCurve): number =>
  c.domain && Number.isFinite(c.domain[0]) && Number.isFinite(c.domain[1]) && c.domain[1] > c.domain[0]
    ? c.domain[0]
    : -Infinity

const domHi = (c: FittedCurve): number =>
  c.domain && Number.isFinite(c.domain[0]) && Number.isFinite(c.domain[1]) && c.domain[1] > c.domain[0]
    ? c.domain[1]
    : Infinity

const sorted = (d: [number, number] | null): [number, number] | null =>
  d && Number.isFinite(d[0]) && Number.isFinite(d[1])
    ? [Math.min(d[0], d[1]), Math.max(d[0], d[1])]
    : null

/** Where this curve lives in x: its domain, its ink, or the visible window. */
function spanOf(curve: FittedCurve, window: [number, number]): [number, number] {
  const d = curve.domain
  if (d && Number.isFinite(d[0]) && Number.isFinite(d[1]) && d[1] > d[0]) return [d[0], d[1]]
  const ink = curve.sourceStroke
  if (ink && ink.length > 1) {
    let lo = Infinity
    let hi = -Infinity
    for (const p of ink) {
      if (!Number.isFinite(p.x)) continue
      if (p.x < lo) lo = p.x
      if (p.x > hi) hi = p.x
    }
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) return [lo, hi]
  }
  const [wlo, whi] = window
  return Number.isFinite(wlo) && Number.isFinite(whi) && whi > wlo ? [wlo, whi] : [-4, 4]
}

// ---------------------------------------------------------------------------
// Presentation legend
// ---------------------------------------------------------------------------

export interface LegendLike {
  id: string
  color: string
  tex: string
  text: string
}

/**
 * Say what a derived curve IS, on the projected legend.
 *
 * Without this, adding f′ to a board puts a second anonymous cubic-looking
 * chip on the wall and the class has to work out which is which from the
 * colours. A chip that says f′ (or "tangent at x = 2") is the one piece of
 * information the equation alone does not carry.
 */
export function labelLegend<T extends LegendLike>(
  entries: readonly T[],
  links: readonly CalcLink[],
): T[] {
  const byCurve = new Map<string, CurveLink>()
  for (const l of links) {
    if (isCurveLink(l)) byCurve.set(l.curveId, l)
  }
  if (byCurve.size === 0) return entries.slice()
  return entries.map((e) => {
    const link = byCurve.get(e.id)
    if (!link) return e
    if (link.kind === 'derivative') {
      return { ...e, tex: `f'\\colon\\;${e.tex}`, text: `f′ — ${e.text}` }
    }
    if (link.kind === 'accumulation') {
      const a = short(link.a).replace(MINUS, '-')
      return {
        ...e,
        tex: `\\int_{${a}}^{x} f\\colon\\;${e.tex}`,
        text: `∫ from ${a} of f — ${e.text}`,
      }
    }
    if (link.kind === 'taylor') {
      return {
        ...e,
        tex: e.tex ? `${e.tex}\\quad ${taylorLegendTex(link)}` : taylorLegendTex(link),
        text: taylorLegend(link),
      }
    }
    const x = fixed(link.x, 2).replace(MINUS, '-')
    return {
      ...e,
      tex: `\\text{tangent at }x = ${x}\\colon\\;${e.tex}`,
      text: `tangent at x = ${x}`,
    }
  })
}

// ---------------------------------------------------------------------------
// What a card is handed
// ---------------------------------------------------------------------------

/**
 * Everything one curve's card needs to say about calculus, already computed.
 *
 * The card renders it and nothing else: no curve, no models, no calculus
 * imports. That keeps the readouts and the picture in step by construction —
 * both come from this one pass over the links.
 */
export interface CardCalc {
  /** True when this curve can carry calculus objects at all (explicit in x). */
  canAdd: boolean
  /** Set when this curve IS a derived object — what it is, and of what. */
  origin: OriginRow | null
  areas: AreaRow[]
  riemanns: RiemannRow[]
  /** The accumulation functions built FROM this curve, with their probes. */
  accums: AccumRow[]
  /** The Taylor polynomials built FROM this curve: the degree, centre, probe, bounds. */
  taylors: TaylorRow[]
  /**
   * Why "Taylor polynomial Pₙ" is greyed out on this curve's menu (a line
   * that calls another curve, a family with no formula), or null when it is
   * offered.
   */
  taylorBlocked: string | null
  /** The secants drawn on this curve: the average rate of change, the MVT, f_avg. */
  secants: SecantRow[]
}

export interface OriginRow {
  linkId: string
  kind: 'tangent' | 'derivative' | 'accumulation' | 'taylor'
  /** "tangent to Cubic at x = 2.00 · slope 9.00" / "f′ of Cubic". */
  text: string
  /**
   * The same sentence in three pieces, so the x in the middle of it can be a
   * field without the card having to parse the sentence back apart.
   */
  lead: string
  tail: string
  /** Why there is no such object right now; the curve is hidden while set. */
  problem: string | null
  /** Tangent only: the point, click-to-edit exactly. */
  x: number | null
  /**
   * Accumulation only: "g′(x) = f(x)" and the AP connections read off the
   * parent's analysis — where g rises, its extrema, its concavity.
   */
  facts?: string[]
}

/** One accumulation function, as its PARENT's card shows it. */
export interface AccumRow {
  linkId: string
  a: number
  C: number
  /** The probe, or null when there is none. */
  x: number | null
  /** "g(x) = ∫₀ˣ f(t) dt" */
  head: string
  /** "g(2) = 2/3 (0.667)" / "g(2) ≈ 1.605"; empty without a probe. */
  text: string
  problem: string | null
  /** The letter the accumulation curve goes by, for the chips ("g"). */
  gName: string
}

export interface AreaRow {
  linkId: string
  from: number
  to: number
  abs: boolean
  /** "∫₀² = 2.667", or "∫₀² |f − g| ≈ 2.828" between two curves. */
  text: string
  problem: string | null
  /** Integrand evaluations, when the value was found numerically. */
  samples: number | null
  /**
   * The OTHER curve's label, when this is an area between two curves, so the
   * card can say "between f and g" without being handed the curves. Absent for
   * the ordinary area to the x-axis — and absent, with a problem set, when the
   * second curve is gone.
   */
  otherLabel?: string
}

export interface RiemannRow {
  linkId: string
  from: number
  to: number
  n: number
  method: RiemannMethod
  /** "L₈ = 1.750 → ∫ = 2.667" */
  text: string
  problem: string | null
  skipped: number
}

/** One edit a card can make to a link. The App applies it; the card states it. */
export type CalcChange =
  | { kind: 'tangentX'; linkId: string; x: number }
  | { kind: 'bound'; linkId: string; which: 'from' | 'to'; value: number }
  | { kind: 'abs'; linkId: string; abs: boolean }
  | { kind: 'n'; linkId: string; n: number }
  | { kind: 'method'; linkId: string; method: RiemannMethod }
  | { kind: 'accumA'; linkId: string; a: number }
  | { kind: 'accumC'; linkId: string; C: number }
  | { kind: 'accumX'; linkId: string; x: number | null }
  | { kind: 'taylorA'; linkId: string; a: number }
  | { kind: 'taylorN'; linkId: string; n: number }
  | { kind: 'taylorX'; linkId: string; x: number | null }
  | { kind: 'taylorBand'; linkId: string; on: boolean }
  | { kind: 'taylorIoc'; linkId: string; on: boolean }
  | { kind: 'secantBound'; linkId: string; which: 'a' | 'b'; value: number }
  | { kind: 'secantMvt'; linkId: string; on: boolean }
  | { kind: 'secantAvg'; linkId: string; on: boolean }

/** The undo entry each change deserves, in a teacher's words. */
export function changeLabel(change: CalcChange): string {
  switch (change.kind) {
    case 'tangentX':
      return 'move tangent point'
    case 'bound':
      return 'move area bound'
    case 'abs':
      return 'switch signed area'
    case 'n':
      return 'change n'
    case 'method':
      return 'change Riemann method'
    case 'accumA':
      return 'move lower limit'
    case 'accumC':
      return 'change starting value'
    case 'accumX':
      return 'move probe'
    case 'taylorA':
      return 'move Taylor center'
    case 'taylorN':
      return 'change Taylor degree'
    case 'taylorX':
      return 'move Taylor probe'
    case 'taylorBand':
      return 'switch error band'
    case 'taylorIoc':
      return 'switch interval of convergence'
    case 'secantBound':
      return 'move secant point'
    case 'secantMvt':
      return 'switch Mean Value Theorem'
    case 'secantAvg':
      return 'switch average value'
  }
}

/**
 * Every card's calculus panel, in one pass over the links.
 *
 * Keyed by curve id: a parent gets its areas and sums, a derived curve gets
 * the line that says what it is. Both sides of a tangent therefore come from
 * the same computation, and the card cannot print a slope the line does not
 * have.
 */
export function cardCalc(
  links: readonly CalcLink[],
  curves: readonly FittedCurve[],
  models: Record<string, ModelSpec>,
  nameOf: (curve: FittedCurve) => string,
  /**
   * The board's letters (f, g, h …) by curve id, so an accumulation reads
   * "g(x) = ∫₀ˣ f(t) dt" with the names on the figure. Absent: f and g.
   */
  letters: Readonly<Record<string, string>> = {},
  /**
   * The letters each typed line calls (curve id → letters). A line that calls
   * another curve by name has no Taylor polynomial, and its menu says so.
   */
  calls: Readonly<Record<string, readonly string[]>> = {},
): Record<string, CardCalc> {
  const out: Record<string, CardCalc> = {}
  const callsOthers = (id: string): boolean => (calls[id]?.length ?? 0) > 0
  const blank = (curve: FittedCurve): CardCalc => ({
    canAdd: models[curve.modelId]?.kind === 'explicit',
    origin: null,
    areas: [],
    riemanns: [],
    accums: [],
    taylors: [],
    taylorBlocked: null,
    secants: [],
  })
  const slot = (id: string): CardCalc | null => {
    const curve = curveById(curves, id)
    if (!curve) return null
    const have = out[id] ?? blank(curve)
    out[id] = have
    return have
  }
  // Every curve gets an entry, whether or not it carries anything yet: the
  // card asks this whether it may OFFER a tangent, which is a question about
  // the curve (is it a function of x?) rather than about the links.
  for (const curve of curves) {
    const card = blank(curve)
    if (card.canAdd) {
      try {
        card.taylorBlocked = taylorBlocked(curve, models, callsOthers(curve.id))
      } catch {
        card.taylorBlocked = null
      }
    }
    out[curve.id] = card
  }

  for (const link of links) {
    const parent = curveById(curves, link.parentId)
    switch (link.kind) {
      case 'tangent': {
        const here = slot(link.curveId)
        if (!here) break
        const r = tangentReadout(link, parent, models, parent ? nameOf(parent) : 'that curve')
        here.origin = {
          linkId: link.id,
          kind: 'tangent',
          text: r.text,
          lead: `tangent to ${parent ? nameOf(parent) : 'that curve'} at`,
          tail: r.slope === null ? '' : `\u00b7 slope ${fixed(r.slope, 2)}`,
          problem: r.problem,
          x: link.x,
        }
        break
      }
      case 'derivative': {
        const here = slot(link.curveId)
        if (!here) break
        const text = `f′ of ${parent ? nameOf(parent) : 'that curve'}`
        here.origin = {
          linkId: link.id,
          kind: 'derivative',
          text,
          lead: text,
          tail: '',
          problem: parent ? null : 'the curve it came from is gone',
          x: null,
        }
        break
      }
      case 'area': {
        const here = slot(link.parentId)
        if (!here) break
        const other = link.otherId === undefined ? undefined : curveById(curves, link.otherId)
        const r = areaReadout(link, parent, models, other)
        here.areas.push({
          linkId: link.id,
          from: link.from,
          to: link.to,
          abs: link.abs,
          text: r.text,
          problem: r.problem,
          samples: r.samples,
          ...(other ? { otherLabel: nameOf(other) } : {}),
        })
        break
      }
      case 'riemann': {
        const here = slot(link.parentId)
        if (!here) break
        const r = riemannReadout(link, parent, models)
        here.riemanns.push({
          linkId: link.id,
          from: link.from,
          to: link.to,
          n: clampN(link.n),
          method: link.method,
          text: r.text,
          problem: r.problem,
          skipped: r.skipped,
        })
        break
      }
      case 'accumulation': {
        const [fName, gName] = accumNames(link, letters)
        const r = accumReadout(link, parent, models, gName, fName)
        const head = accumHead(link, gName, fName)
        const own = slot(link.parentId)
        if (own) {
          own.accums.push({
            linkId: link.id,
            a: link.a,
            C: link.C,
            x: link.x ?? null,
            head,
            text: r.text,
            problem: r.problem,
            gName,
          })
        }
        const here = slot(link.curveId)
        if (!here) break
        const of = parent ? nameOf(parent) : 'that curve'
        let facts: string[] = []
        try {
          facts = accumFacts(link, parent, models, gName, fName)
        } catch {
          facts = [`${gName}′(x) = ${fName}(x)`]
        }
        const problem = !parent
          ? 'the curve it came from is gone'
          : accumStartProblem(link, parent, models, fName)
        here.origin = {
          linkId: link.id,
          kind: 'accumulation',
          text: `${head} · ∫ from ${short(link.a)} of ${of}`,
          lead: head,
          tail: `∫ from ${short(link.a)} of ${of}`,
          problem,
          x: null,
          facts,
        }
        break
      }
      case 'taylor': {
        const fName = letters[link.parentId] ?? 'f'
        let src: ReturnType<typeof taylorSourceFor> = null
        try {
          src = taylorSourceFor(parent, models, callsOthers(link.parentId))
        } catch {
          src = null
        }
        const row = taylorRow(link, parent, src, fName)
        const own = slot(link.parentId)
        if (own) own.taylors.push(row)
        const here = slot(link.curveId)
        if (!here) break
        const of = parent ? nameOf(parent) : 'that curve'
        const lead = `${pName(link.n)}: Taylor polynomial of ${fName} about a = ${row.aText}`
        here.origin = {
          linkId: link.id,
          kind: 'taylor',
          text: `${lead} · ${of}`,
          lead,
          tail: '',
          problem: row.problem ?? (parent ? null : taylorProblem(link, parent, src, fName)),
          x: null,
        }
        break
      }
      case 'secant': {
        const own = slot(link.parentId)
        if (!own) break
        let row: SecantRow
        try {
          row = secantRow(link, parent, models, letters[link.parentId] ?? 'f')
        } catch {
          row = {
            ...secantRow({ ...link, mvt: undefined, avg: undefined }, undefined, models),
            problem: 'this secant could not be measured',
          }
        }
        own.secants.push(row)
        break
      }
    }
  }
  return out
}

/** [f, g]: the letters on the board, or f and g — never the same letter twice. */
function accumNames(
  link: AccumulationLink,
  letters: Readonly<Record<string, string>>,
): [string, string] {
  const f = letters[link.parentId] ?? 'f'
  let g = letters[link.curveId] ?? (f === 'g' ? 'G' : 'g')
  if (g === f) g = 'G'
  return [f, g]
}

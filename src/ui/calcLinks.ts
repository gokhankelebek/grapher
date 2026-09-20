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
import { areaUnder, riemann, tangentAt } from '../core/calculus'
import type {
  AreaLink,
  CalcKind,
  CalcLink,
  CurveLink,
  DerivativeLink,
  RiemannLink,
  TangentLink,
} from '../core/persist'
import {
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
  AreaLink,
  CalcKind,
  CalcLink,
  CurveLink,
  DerivativeLink,
  RiemannLink,
  RiemannMethod,
  TangentLink,
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
        deadCurves.has(l.parentId) || (isCurveLink(l) && deadCurves.has(l.curveId))
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
): Overlay[] {
  const out: Overlay[] = []
  for (const l of links) {
    if (l.kind !== 'area') continue
    const parent = curveById(curves, l.parentId)
    if (!parent || !parent.visible) continue
    if (!(l.to > l.from)) continue
    out.push({ kind: 'area', curveId: parent.id, from: l.from, to: l.to })
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
 */
export function areaReadout(
  link: AreaLink,
  parent: FittedCurve | undefined,
  models: Record<string, ModelSpec>,
): AreaReadout {
  const miss = (problem: string): AreaReadout => ({
    text: `${integralSymbol(link.from, link.to)} = —`,
    problem,
    samples: null,
    value: null,
  })
  if (!parent) return miss('the curve it was measuring is gone')
  let res: ReturnType<typeof areaUnder>
  try {
    res = areaUnder(parent, models, link.from, link.to)
  } catch {
    res = null
  }
  if (!res) {
    // Name the limit that left the curve before calling anything undefined:
    // a sketch ends where its ink ends, and "a = -3.50 is outside …" tells
    // the teacher which chip to nudge. The pole sentence comes next, and the
    // bare "undefined on" is only for what is left.
    const outside = limitOutsideDomain(parent, link.from, link.to)
    if (outside) return miss(outside)
    const pole = poleBetween(parent, models, link.from, link.to)
    return miss(
      pole === null
        ? `undefined on [${fixed(link.from, 2)}, ${fixed(link.to, 2)}]`
        : `undefined across the pole at x = ${fixed(pole, 2)}`,
    )
  }
  const value = link.abs ? Math.abs(res.value) : res.value
  const lhs = link.abs ? `|${integralSymbol(link.from, link.to)}|` : integralSymbol(link.from, link.to)
  return {
    text: `${lhs} ${res.exact ? '=' : '≈'} ${fixed(value, 3)}`,
    problem: null,
    samples: res.exact ? null : (res.samples ?? null),
    value,
  }
}

/** "a = -3.50 is outside this curve's domain [-3.42, 4.47]", or null. */
function limitOutsideDomain(curve: FittedCurve, a: number, b: number): string | null {
  const d = curve.domain
  if (!d) return null
  const lo = Math.min(d[0], d[1])
  const hi = Math.max(d[0], d[1])
  const tol = 1e-9 * Math.max(1, Math.abs(lo), Math.abs(hi))
  const out = (v: number): boolean => v < lo - tol || v > hi + tol
  const which = out(a) ? 'a' : out(b) ? 'b' : null
  if (!which) return null
  const v = which === 'a' ? a : b
  return `${which} = ${fixed(v, 2)} is outside this curve's domain [${fixed(lo, 2)}, ${fixed(hi, 2)}]`
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
    const was = sorted(prev.get(link.parentId) ?? null)
    const now = sorted(parent.domain)
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
}

export interface OriginRow {
  linkId: string
  kind: 'tangent' | 'derivative'
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
}

export interface AreaRow {
  linkId: string
  from: number
  to: number
  abs: boolean
  /** "∫₀² = 2.667" */
  text: string
  problem: string | null
  /** Integrand evaluations, when the value was found numerically. */
  samples: number | null
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
): Record<string, CardCalc> {
  const out: Record<string, CardCalc> = {}
  const blank = (curve: FittedCurve): CardCalc => ({
    canAdd: models[curve.modelId]?.kind === 'explicit',
    origin: null,
    areas: [],
    riemanns: [],
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
  for (const curve of curves) out[curve.id] = blank(curve)

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
        const r = areaReadout(link, parent, models)
        here.areas.push({
          linkId: link.id,
          from: link.from,
          to: link.to,
          abs: link.abs,
          text: r.text,
          problem: r.problem,
          samples: r.samples,
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
    }
  }
  return out
}

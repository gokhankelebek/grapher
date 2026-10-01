// ============================================================================
// src/ui/paramCalcLinks.ts — parametric and polar calculus as board objects
// (AP Calculus BC Unit 9), the App half.
//
// src/core/paramCalc.ts owns the mathematics. This module owns what a teacher
// SEES of the two links (src/core/persist.ts):
//
//   pcalc          { t, marks?, a?, b? } on a parametric or polar curve
//       the card: dx/dt, dy/dt, dy/dx, d²y/dx² written out (polar: r′ and
//       the polar dy/dx formula); at t the point, the tangent line, speed,
//       velocity, acceleration (polar: r, r′ and what r′ says about the
//       pole); the horizontal / vertical tangents and singular points; the
//       arc length over [a, b] written as an integral, and the displacement
//       beside the distance travelled.
//       the board: the point (a handle while the curve is selected, dragged
//       ALONG the curve), the tangent line through it, a chip "t = π/4", for
//       polar the dashed ray from the pole — and, with `marks`, the
//       horizontal and vertical tangents as short strokes.
//   polarbetween   { otherId, swap?, a?, b? } between two polar curves
//       the card: where they meet (exact θ), ½∫(R² − r²) dθ written out and
//       its value; the board: the region shaded, the rays to the meeting
//       points.
//
// Everything is recomputed from the link on every change; nothing computed
// is stored. One analysis per (link, curve, source) is cached so the card and
// the board — both rebuilt on every frame of a drag — share it.
//
// Pure: no React, no DOM, no canvas.
// ============================================================================

import type { FittedCurve, ModelSpec, Vec2 } from '../core/types'
import type { Overlay } from '../render/overlays'
import type { CalcLink, ParamCalcLink, PolarBetweenLink } from '../core/persist'
import {
  arcLengthOf,
  atParam,
  betweenRegion,
  bothAtPole,
  boundOf,
  defaultBetweenBounds,
  derivativeLines,
  paramSymbolic,
  polarBetween,
  polarIntersections,
  tangentLists,
} from '../core/paramCalc'
import type { ArcResult, AtParam, BetweenResult, Formula, Meeting, ParamSym, TangentLists } from '../core/paramCalc'
import { motionInterval, motionKindOf, nearestT, posAt } from './motionLinks'
import type { MotionKind } from './motionLinks'

export type { ParamCalcLink, PolarBetweenLink }


// ---------------------------------------------------------------------------
// The symbolic trees, cached per (curve, line)
// ---------------------------------------------------------------------------

const symCache = new Map<string, ParamSym | null>()
const SYM_CACHE_MAX = 48

/** The curve's state as a cache key: its model, sliders, interval and the curves it calls. */
function curveKey(curve: FittedCurve, dep: string): string {
  return `${curve.id}|${curve.modelId}|${curve.params.join(',')}|${curve.domain ? curve.domain.join(',') : ''}|${dep}`
}

/** paramSymbolic, cached and never throwing. */
export function symbolicFor(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  src: string | null | undefined,
  dep = '',
): ParamSym | null {
  if (!src) return null
  const key = `${curveKey(curve, dep)}|${src}`
  if (symCache.has(key)) return symCache.get(key) ?? null
  let sym: ParamSym | null = null
  try {
    sym = paramSymbolic(src, curve, models)
  } catch {
    sym = null
  }
  if (symCache.size >= SYM_CACHE_MAX) symCache.clear()
  symCache.set(key, sym)
  return sym
}

const tanCache = new Map<string, TangentLists>()

/** tangentLists, cached per curve state. */
function tangentsFor(curve: FittedCurve, models: Record<string, ModelSpec>, sym: ParamSym | null, dep: string): TangentLists {
  const key = `${curveKey(curve, dep)}|${sym ? 's' : 'n'}`
  const hit = tanCache.get(key)
  if (hit) return hit
  let out: TangentLists = { horizontal: [], vertical: [], singular: [] }
  try {
    out = tangentLists(curve, models, sym)
  } catch {
    /* no list this time */
  }
  if (tanCache.size >= SYM_CACHE_MAX) tanCache.clear()
  tanCache.set(key, out)
  return out
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Where a fresh "calculus at t" opens: a nice t inside the interval where the
 * curve has a point and is moving (not a cusp) — π/4 for a polar curve, π/2
 * for a parametric one on a π-interval, 1 otherwise — else the middle.
 */
export function defaultParamT(curve: FittedCurve, models: Record<string, ModelSpec>): number {
  const kind = motionKindOf(curve, models)
  const [lo, hi] = motionInterval(curve)
  const P = Math.PI
  // an interval in multiples of π (0 ≤ t ≤ 2π) is a trig curve: start at π/2
  const piish = [lo, hi].every((v) => Math.abs(v / P - Math.round(v / P)) < 1e-9)
  const cands =
    kind === 'polar'
      ? [P / 4, P / 3, P / 6, P / 2, 1, (2 * P) / 3]
      : piish
        ? [P / 2, P / 4, P / 3, 1, P / 6]
        : [1, P / 4, 0.5, 2, P / 3, -1, P / 6]
  for (const t of cands) {
    if (t <= lo || t >= hi) continue
    const at = atParam(curve, models, null, t)
    if (at && !at.singular && at.speed.value > 1e-9) return t
  }
  return (lo + hi) / 2
}

/**
 * A dragged t, snapped: to a whole number, a multiple of π/12 or of 0.5 or
 * 0.1 — the first whose point lands within `tolPx` of where the pointer's t
 * is. Polar (and a curve on a π axis) tries π/12 first. Clamped to the
 * interval.
 */
export function snapParamT(
  t: number,
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  pxPerUnit: number,
  preferPi: boolean,
  tolPx = 7,
): number {
  const [lo, hi] = motionInterval(curve)
  const at = posAt(curve, models, t)
  if (!at || !(pxPerUnit > 0)) return Math.min(hi, Math.max(lo, t))
  const steps = preferPi ? [Math.PI / 12, 1, 0.5, 0.1] : [1, Math.PI / 12, 0.5, 0.1]
  for (const s of steps) {
    const c = Math.round(t / s) * s
    if (c < lo - 1e-12 || c > hi + 1e-12) continue
    const p = posAt(curve, models, c)
    if (!p) continue
    if (Math.hypot(p.x - at.x, p.y - at.y) * pxPerUnit <= tolPx) return Math.min(hi, Math.max(lo, c))
  }
  return Math.min(hi, Math.max(lo, t))
}

/** The t nearest a pointer on the board, snapped (the handle's drag). */
export function dragParamT(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  to: Vec2,
  pxPerUnit: number,
  preferPi: boolean,
): number {
  const raw = nearestT(curve, models, motionInterval(curve), to)
  return snapParamT(raw, curve, models, pxPerUnit, preferPi)
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

/** The edits the two sections make. The App applies them through applyParamCalcChange. */
export type ParamCalcChange =
  | { kind: 'pcalcT'; linkId: string; t: number }
  | { kind: 'pcalcMarks'; linkId: string; on: boolean }
  /** null, null: back to the curve's own interval. */
  | { kind: 'pcalcArc'; linkId: string; a: number | null; b: number | null }
  /** null, null: back to where the curves meet. */
  | { kind: 'pbetweenBounds'; linkId: string; a: number | null; b: number | null }
  | { kind: 'pbetweenSwap'; linkId: string; on: boolean }
  | { kind: 'pbetweenOther'; linkId: string; otherId: string; swap: boolean }

const PCALC_CHANGES = new Set(['pcalcT', 'pcalcMarks', 'pcalcArc', 'pbetweenBounds', 'pbetweenSwap', 'pbetweenOther'])

export function isParamCalcChange(c: { kind: string }): c is ParamCalcChange {
  return PCALC_CHANGES.has(c.kind)
}

export function paramCalcChangeLabel(c: ParamCalcChange): string {
  switch (c.kind) {
    case 'pcalcT':
      return 'move the point on the curve'
    case 'pcalcMarks':
      return 'mark horizontal / vertical tangents'
    case 'pcalcArc':
      return 'change arc-length interval'
    case 'pbetweenBounds':
      return 'change θ-bounds'
    case 'pbetweenSwap':
      return 'swap inside / outside'
    case 'pbetweenOther':
      return 'change the other polar curve'
  }
}

/** The link after one change, or null when nothing changes. */
export function applyParamCalcChange(l: CalcLink, c: ParamCalcChange): CalcLink | null {
  if (l.kind === 'pcalc') {
    if (c.kind === 'pcalcT') {
      if (!Number.isFinite(c.t) || c.t === l.t) return null
      return { ...l, t: c.t }
    }
    if (c.kind === 'pcalcMarks') {
      if ((l.marks === true) === c.on) return null
      const { marks: _was, ...rest } = l
      void _was
      return c.on ? { ...rest, marks: true } : rest
    }
    if (c.kind === 'pcalcArc') {
      const { a: _a, b: _b, ...rest } = l
      void _a
      void _b
      if (c.a === null || c.b === null) return l.a === undefined ? null : rest
      if (!Number.isFinite(c.a) || !Number.isFinite(c.b) || c.a === c.b) return null
      const a = Math.min(c.a, c.b)
      const b = Math.max(c.a, c.b)
      if (l.a === a && l.b === b) return null
      return { ...rest, a, b }
    }
    return null
  }
  if (l.kind === 'polarbetween') {
    if (c.kind === 'pbetweenBounds') {
      const { a: _a, b: _b, ...rest } = l
      void _a
      void _b
      if (c.a === null || c.b === null) return l.a === undefined ? null : rest
      if (!Number.isFinite(c.a) || !Number.isFinite(c.b) || c.a === c.b) return null
      const a = Math.min(c.a, c.b)
      const b = Math.max(c.a, c.b)
      if (l.a === a && l.b === b) return null
      return { ...rest, a, b }
    }
    if (c.kind === 'pbetweenSwap') {
      if ((l.swap === true) === c.on) return null
      const { swap: _was, a: _a, b: _b, ...rest } = l
      void _was
      void _a
      void _b
      // the other region has other bounds: they are found again
      return c.on ? { ...rest, swap: true } : rest
    }
    if (c.kind === 'pbetweenOther') {
      if (c.otherId === l.otherId || c.otherId === l.parentId || c.otherId === '') return null
      const { swap: _was, a: _a, b: _b, ...rest } = l
      void _was
      void _a
      void _b
      return c.swap ? { ...rest, otherId: c.otherId, swap: true } : { ...rest, otherId: c.otherId }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export interface ParamCalcRow {
  linkId: string
  kind: MotionKind
  /** The parameter's letter: t or θ. */
  v: string
  /** The chosen t as the field shows it: π/4, 1, 0.35. */
  tText: string
  /** The formulas came from the typed line (false: a sketch, or a line calling another curve). */
  symbolic: boolean
  /** dx/dt, dy/dt, dy/dx, d²y/dx² (polar: r, r′, the formula, dy/dx, d²y/dx²). */
  lines: Formula[]
  at: AtParam | null
  tangents: TangentLists
  marks: boolean
  arc: (ArcResult & { custom: boolean }) | null
  /** One line on the collapsed header. */
  summary: string
  problem: string | null
}

/** Formulas longer than this are left unexpanded on the card: nobody reads a page of trig. */
const MAX_LINE_TEXT = 110

const rowCache = new Map<string, ParamCalcRow>()

export function paramCalcRow(
  link: ParamCalcLink,
  parent: FittedCurve | undefined,
  models: Record<string, ModelSpec>,
  src: string | null | undefined,
  dep = '',
): ParamCalcRow {
  const kind0 = parent ? motionKindOf(parent, models) : null
  const kind: MotionKind = kind0 ?? 'parametric'
  const v = kind === 'polar' ? 'θ' : 't'
  const base: ParamCalcRow = {
    linkId: link.id,
    kind,
    v,
    tText: boundOf(link.t).text,
    symbolic: false,
    lines: [],
    at: null,
    tangents: { horizontal: [], vertical: [], singular: [] },
    marks: link.marks === true,
    arc: null,
    summary: `at ${v} = ${boundOf(link.t).text}`,
    problem: null,
  }
  if (!parent || !kind0) return { ...base, problem: parent ? 'this curve is not parametric or polar' : 'the curve it belonged to is gone' }
  const key = `${JSON.stringify(link)}|${curveKey(parent, dep)}|${src ?? ''}`
  const hit = rowCache.get(key)
  if (hit) return hit
  const sym = symbolicFor(parent, models, src, dep)
  const lines = sym
    ? derivativeLines(sym).filter((l) => l.text.length <= MAX_LINE_TEXT || !l.text.startsWith('d²'))
    : []
  let at: AtParam | null = null
  try {
    at = atParam(parent, models, sym, link.t)
  } catch {
    at = null
  }
  const [lo, hi] = motionInterval(parent)
  const custom = link.a !== undefined && link.b !== undefined
  let arc: ParamCalcRow['arc'] = null
  try {
    const r = arcLengthOf(parent, models, sym, custom ? (link.a as number) : lo, custom ? (link.b as number) : hi)
    arc = r ? { ...r, custom } : null
  } catch {
    arc = null
  }
  const out: ParamCalcRow = {
    ...base,
    symbolic: sym !== null,
    lines,
    at,
    tangents: tangentsFor(parent, models, sym, dep),
    arc,
    summary: at
      ? at.slope
        ? `at ${v} = ${base.tText}: dy/dx = ${at.slope.text}`
        : at.vertical
          ? `at ${v} = ${base.tText}: vertical tangent`
          : `at ${v} = ${base.tText}`
      : base.summary,
    problem: at ? null : `the curve has no point at ${v} = ${base.tText}`,
  }
  if (rowCache.size >= SYM_CACHE_MAX) rowCache.clear()
  rowCache.set(key, out)
  return out
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

/** The size of a curve's picture: the largest |x|, |y| over its interval (at least 1). */
function extentOf(curve: FittedCurve, models: Record<string, ModelSpec>): number {
  const [lo, hi] = motionInterval(curve)
  let ext = 1
  for (let i = 0; i <= 96; i++) {
    const p = posAt(curve, models, lo + ((hi - lo) * i) / 96)
    if (p) ext = Math.max(ext, Math.abs(p.x), Math.abs(p.y))
  }
  return ext
}

/** Stroke weight of the tangent line at t, CSS px. */
export const PCALC_TANGENT_WIDTH = 2
/** The shaded region between two polar curves: its wash. */
export const PBETWEEN_ALPHA = 0.3

/**
 * What the calculus-at-t objects draw: the tangent line, the point, its chip
 * and (polar) the ray from the pole; with `marks`, the horizontal and
 * vertical tangents. Nothing for a hidden or missing curve, or a t where the
 * curve has no point.
 */
export function paramCalcOverlays(
  links: readonly ParamCalcLink[],
  curves: readonly FittedCurve[],
  models: Record<string, ModelSpec>,
  deps: Readonly<Record<string, string>> = {},
): Overlay[] {
  const lines: Overlay[] = []
  const marks: Overlay[] = []
  for (const l of links) {
    const parent = curves.find((c) => c.id === l.parentId)
    if (!parent || !parent.visible) continue
    const kind = motionKindOf(parent, models)
    if (!kind) continue
    const id = parent.id
    const ext = extentOf(parent, models)
    let at: AtParam | null = null
    try {
      at = atParam(parent, models, null, l.t)
    } catch {
      at = null
    }
    if (at) {
      const p = at.pos
      if (kind === 'polar') lines.push({ kind: 'segment', curveId: id, from: { x: 0, y: 0 }, to: p, dashed: true, width: 1.5 })
      if (at.drawSlope === Infinity) {
        lines.push({
          kind: 'segment',
          curveId: id,
          from: { x: p.x, y: p.y - 6 * ext },
          to: { x: p.x, y: p.y + 6 * ext },
          width: PCALC_TANGENT_WIDTH,
        })
      } else if (at.drawSlope !== null && Number.isFinite(at.drawSlope)) {
        lines.push({ kind: 'line', curveId: id, at: p, slope: at.drawSlope, width: PCALC_TANGENT_WIDTH })
      }
      marks.push({ kind: 'dot', curveId: id, at: p })
      const chip = `${kind === 'polar' ? 'θ' : 't'} = ${boundOf(l.t).text}`
      marks.push(
        at.drawSlope !== null && Number.isFinite(at.drawSlope)
          ? { kind: 'label', curveId: id, at: p, text: chip, across: { slope: at.drawSlope, below: false } }
          : { kind: 'label', curveId: id, at: p, text: chip, dir: { x: 1, y: -1 } },
      )
    }
    if (l.marks) {
      const lists = tangentsFor(parent, models, null, deps[parent.id] ?? '')
      const half = 0.12 * ext
      for (const h of lists.horizontal) {
        lines.push({ kind: 'segment', curveId: id, from: { x: h.pos.x - half, y: h.pos.y }, to: { x: h.pos.x + half, y: h.pos.y }, dashed: true })
        marks.push({ kind: 'dot', curveId: id, at: h.pos, hollow: true })
      }
      for (const vt of lists.vertical) {
        lines.push({ kind: 'segment', curveId: id, from: { x: vt.pos.x, y: vt.pos.y - half }, to: { x: vt.pos.x, y: vt.pos.y + half }, dashed: true })
        marks.push({ kind: 'dot', curveId: id, at: vt.pos, hollow: true })
      }
      for (const s of lists.singular) {
        marks.push({ kind: 'dot', curveId: id, at: s.pos, hollow: true })
        const cusp = (s.notes ?? []).some((n) => n.includes('cusp'))
        marks.push({ kind: 'label', curveId: id, at: s.pos, text: cusp ? 'cusp' : 'dx/dt = dy/dt = 0', dir: { x: -1, y: 1 } })
      }
    }
  }
  return [...lines, ...marks]
}

// ---------------------------------------------------------------------------
// Area between two polar curves
// ---------------------------------------------------------------------------

/** The visible polar curves, other than `self`, a region could run to. */
export function polarPartners(
  self: FittedCurve,
  curves: readonly FittedCurve[],
  models: Record<string, ModelSpec>,
): FittedCurve[] {
  return curves.filter((c) => c.id !== self.id && c.visible && motionKindOf(c, models) === 'polar')
}

/**
 * Which way round a fresh region goes: inside the parent and outside the
 * other (false), or the other way (true) — whichever has a region between
 * two meetings. Null when neither does.
 */
export function orientBetween(
  parent: FittedCurve,
  other: FittedCurve,
  models: Record<string, ModelSpec>,
): { swap: boolean } | null {
  try {
    if (defaultBetweenBounds(parent, other, models)) return { swap: false }
    if (defaultBetweenBounds(other, parent, models)) return { swap: true }
  } catch {
    return null
  }
  return null
}

/** The first partner the parent meets, with the orientation of their region. */
export function defaultPolarBetween(
  parent: FittedCurve,
  curves: readonly FittedCurve[],
  models: Record<string, ModelSpec>,
): { otherId: string; swap: boolean } | null {
  for (const c of polarPartners(parent, curves, models)) {
    const o = orientBetween(parent, c, models)
    if (o) return { otherId: c.id, swap: o.swap }
  }
  return null
}

/** (outer, inner) for a link. */
function roles(
  link: PolarBetweenLink,
  parent: FittedCurve,
  other: FittedCurve,
): { outer: FittedCurve; inner: FittedCurve } {
  return link.swap ? { outer: other, inner: parent } : { outer: parent, inner: other }
}

/** The θ-bounds in force: the link's own, else where the curves meet around the region. */
export function betweenBounds(
  link: PolarBetweenLink,
  parent: FittedCurve,
  other: FittedCurve,
  models: Record<string, ModelSpec>,
): [number, number] | null {
  if (link.a !== undefined && link.b !== undefined) return [link.a, link.b]
  const { outer, inner } = roles(link, parent, other)
  try {
    return defaultBetweenBounds(outer, inner, models)
  } catch {
    return null
  }
}

export interface PolarBetweenRow {
  linkId: string
  otherId: string
  outerLabel: string
  innerLabel: string
  swap: boolean
  /** The other polar curves on the board, for the picker. */
  choices: { id: string; label: string }[]
  meetings: Meeting[]
  /** "Both also pass through the pole" when they do. */
  poleNote: string | null
  aText: string | null
  bText: string | null
  /** The bounds were set by hand (false: where the curves meet). */
  custom: boolean
  result: BetweenResult | null
  summary: string
  problem: string | null
}

const betweenCache = new Map<string, PolarBetweenRow>()

export function polarBetweenRow(
  link: PolarBetweenLink,
  parent: FittedCurve | undefined,
  other: FittedCurve | undefined,
  models: Record<string, ModelSpec>,
  curves: readonly FittedCurve[],
  nameOf: (c: FittedCurve) => string,
  sources: Readonly<Record<string, string>> = {},
  deps: Readonly<Record<string, string>> = {},
): PolarBetweenRow {
  const base: PolarBetweenRow = {
    linkId: link.id,
    otherId: link.otherId,
    outerLabel: '',
    innerLabel: '',
    swap: link.swap === true,
    choices: [],
    meetings: [],
    poleNote: null,
    aText: null,
    bText: null,
    custom: link.a !== undefined && link.b !== undefined,
    result: null,
    summary: '',
    problem: null,
  }
  if (!parent) return { ...base, problem: 'the curve it belonged to is gone' }
  base.choices = polarPartners(parent, curves, models).map((c) => ({ id: c.id, label: nameOf(c) }))
  if (!other) return { ...base, problem: 'the other polar curve is gone' }
  const { outer, inner } = roles(link, parent, other)
  const key = [
    JSON.stringify(link),
    curveKey(parent, deps[parent.id] ?? ''),
    curveKey(other, deps[other.id] ?? ''),
    sources[parent.id] ?? '',
    sources[other.id] ?? '',
    nameOf(parent),
    nameOf(other),
    base.choices.map((c) => `${c.id}:${c.label}`).join(','),
  ].join('|')
  const hit = betweenCache.get(key)
  if (hit) return hit
  const row: PolarBetweenRow = { ...base, outerLabel: nameOf(outer), innerLabel: nameOf(inner) }
  try {
    row.meetings = polarIntersections(outer, inner, models)
    row.poleNote = bothAtPole(outer, inner, models) ? 'Both curves also pass through the pole — at different θ, so the equation r₁ = r₂ does not find it.' : null
  } catch {
    row.meetings = []
  }
  const bounds = betweenBounds(link, parent, other, models)
  if (!bounds) {
    row.problem =
      row.meetings.length === 0
        ? 'the two curves do not meet, so there is no region between them'
        : `no stretch between two meetings has ${row.outerLabel} outside ${row.innerLabel} — try swapping`
  } else {
    const symO = symbolicFor(outer, models, sources[outer.id], deps[outer.id] ?? '')
    const symI = symbolicFor(inner, models, sources[inner.id], deps[inner.id] ?? '')
    let res: BetweenResult | null = null
    try {
      res = polarBetween(outer, inner, models, symO, symI, bounds[0], bounds[1])
    } catch {
      res = null
    }
    row.result = res
    row.aText = boundOf(Math.min(bounds[0], bounds[1])).text
    row.bText = boundOf(Math.max(bounds[0], bounds[1])).text
    if (!res) row.problem = 'this area could not be measured'
  }
  row.summary = row.result
    ? `${row.result.area.exact ? '' : '≈ '}${row.result.area.text}`
    : row.problem ?? ''
  if (betweenCache.size >= SYM_CACHE_MAX) betweenCache.clear()
  betweenCache.set(key, row)
  return row
}

/** The shaded region, the rays to the two bounds, and dots where the curves meet. */
export function polarBetweenOverlays(
  links: readonly PolarBetweenLink[],
  curves: readonly FittedCurve[],
  models: Record<string, ModelSpec>,
): Overlay[] {
  const washes: Overlay[] = []
  const marks: Overlay[] = []
  for (const l of links) {
    const parent = curves.find((c) => c.id === l.parentId)
    const other = curves.find((c) => c.id === l.otherId)
    if (!parent || !other || !parent.visible || !other.visible) continue
    const bounds = betweenBounds(l, parent, other, models)
    if (!bounds) continue
    const { outer, inner } = roles(l, parent, other)
    let boundary: Vec2[] = []
    try {
      boundary = betweenRegion(outer, inner, models, bounds[0], bounds[1])
    } catch {
      boundary = []
    }
    if (boundary.length === 0) continue
    washes.push({ kind: 'region', boundary, color: outer.color, alpha: PBETWEEN_ALPHA })
    for (const th of bounds) {
      const p = posAt(outer, models, th)
      if (!p) continue
      marks.push({ kind: 'segment', curveId: outer.id, from: { x: 0, y: 0 }, to: p, dashed: true, width: 1.5 })
      marks.push({ kind: 'dot', curveId: outer.id, at: p })
      marks.push({
        kind: 'label',
        curveId: outer.id,
        at: p,
        text: `θ = ${boundOf(th).text}`,
        dir: { x: Math.cos(th), y: -Math.sin(th) },
      })
    }
  }
  return [...washes, ...marks]
}

/** A dragged θ-bound, along the outer curve, snapped like the point. */
export function dragBetweenBound(
  outer: FittedCurve,
  models: Record<string, ModelSpec>,
  to: Vec2,
  pxPerUnit: number,
): number {
  return dragParamT(outer, models, to, pxPerUnit, true)
}

/** Which curve bounds the region from outside, for the App's handles. */
export function outerOf(link: PolarBetweenLink, parent: FittedCurve, other: FittedCurve): FittedCurve {
  return roles(link, parent, other).outer
}

// ============================================================================
// src/ui/implicitLinks.ts — tangent lines on IMPLICIT curves, as the board and
// the card see them.
//
// A tangent to x² + y² = 25 is the same TangentLink an explicit tangent is
// (src/core/persist.ts), plus the point's y: x alone does not say which of
// (3, 4) and (3, −4) was meant. Everything else is recomputed from the link
// on every change (src/core/implicitDiff.ts):
//
//   implicitTangent()    the point, re-found on the curve, and its tangent —
//                        a `line` curve, or a `vline` at a vertical tangent
//   implicitRow()        what the parent's card prints: dy/dx = −F_x/F_y
//                        simplified, its value at the point (exact when it
//                        is), the tangent in point-slope form, the horizontal
//                        and vertical tangents, and d²y/dx²
//   implicitOverlays()   the horizontal / vertical tangent points, marked
//   dragImplicitPoint()  where a dragged point goes: onto the curve, snapped
//                        to a round x or y when one is close
//   defaultImplicitPoint()  where a new tangent starts: a lattice point such
//                        as (3, 4) when the curve has one in view
//
// Pure: no React, no DOM, no canvas.
// ============================================================================

import type { FittedCurve, ModelSpec, Vec2 } from '../core/types'
import type { Overlay } from '../render/overlays'
import type { CalcLink, TangentLink } from '../core/persist'
import { splitTyped } from './domainLinks'
import { curveEquationText } from './equationText'
import { parseAst } from '../core/parse'
import {
  astParams,
  coordForm,
  dragOnCurve,
  implicitDiffOf,
  implicitFn,
  onCurve,
  pointSlopeText,
  pointText,
  projectOnto,
  reproject,
  solveXAt,
  solveYAt,
  specialTangents,
  tangentAt,
} from '../core/implicitDiff'
import type { Box, Formula, ImplicitDiff, ImplicitFn, ImplicitTangent } from '../core/implicitDiff'
import { calcKey } from './reveal'

export type { Box }

/** Can this curve carry an implicit tangent? (An equation in x and y, not a shaded inequality.) */
export function isImplicitCurve(curve: FittedCurve | undefined, models: Record<string, ModelSpec>): boolean {
  if (!curve) return false
  const spec = models[curve.modelId]
  return !!spec && spec.kind === 'implicit' && typeof spec.evalImplicit === 'function' && !spec.inequality
}

// ---------------------------------------------------------------------------
// The derivative, cached by formula and slider values
// ---------------------------------------------------------------------------

const diffCache = new Map<string, ImplicitDiff | null>()

/**
 * dy/dx and friends for `src` (the curve's equation as typed, or its family's
 * template), with the sliders at the curve's values. Null when the formula
 * has no symbolic derivative here — the numbers still work, by differences.
 */
export function diffFor(src: string | null | undefined, curve: FittedCurve): ImplicitDiff | null {
  if (!src) return null
  const key = `${src}|${curve.params.join(',')}`
  if (diffCache.has(key)) return diffCache.get(key) ?? null
  let d: ImplicitDiff | null = null
  try {
    const ast = parseAst(src)
    const params: Record<string, number> = {}
    if (ast.ok) {
      const found = astParams(ast.lhs)
      if (ast.rhs) astParams(ast.rhs, found)
      for (const [name, i] of found) {
        const v = curve.params[i]
        if (typeof v === 'number') params[name] = v
      }
    }
    d = implicitDiffOf(src, params)
  } catch {
    d = null
  }
  if (diffCache.size > 96) diffCache.clear()
  diffCache.set(key, d)
  return d
}

/** F for the numeric routines, with the symbolic gradient when it agrees with F. */
export function fnFor(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  diff: ImplicitDiff | null = null,
): ImplicitFn | null {
  const spec = models[curve.modelId]
  const ev = spec?.evalImplicit
  if (!spec || !ev) return null
  const params = curve.params
  const F = (x: number, y: number): number => ev.call(spec, params, x, y)
  const plain = implicitFn(F)
  if (!diff) return plain
  // The symbolic partials must be the partials of THIS F — a template that
  // printed differently from the family would otherwise tilt every tangent.
  const probes: Vec2[] = [
    { x: 0.37, y: 1.13 },
    { x: -1.21, y: 0.59 },
    { x: 2.03, y: -0.77 },
  ]
  let checked = 0
  for (const p of probes) {
    const [a, b] = plain.grad(p.x, p.y)
    const sa = diff.fx(p.x, p.y)
    const sb = diff.fy(p.x, p.y)
    if (![a, b, sa, sb].every(Number.isFinite)) continue
    const scale = Math.max(1, Math.hypot(a, b))
    if (Math.abs(a - sa) > 1e-4 * scale || Math.abs(b - sb) > 1e-4 * scale) return plain
    checked++
  }
  if (checked === 0) return plain
  return implicitFn(F, (x, y) => [diff.fx(x, y), diff.fy(x, y)])
}

// ---------------------------------------------------------------------------
// The tangent
// ---------------------------------------------------------------------------

export interface ImplicitTangentState {
  point: Vec2
  tangent: ImplicitTangent
}

/** The link's point, back on the curve, and the tangent there. Null when the point has no curve under it. */
export function implicitTangent(
  link: TangentLink,
  parent: FittedCurve,
  models: Record<string, ModelSpec>,
  diff: ImplicitDiff | null = null,
): ImplicitTangentState | null {
  const f = fnFor(parent, models, diff)
  if (!f) return null
  const p = link.y !== undefined ? reproject(f, link.x, link.y) : projectOnto(f, { x: link.x, y: 0 })
  if (!p) return null
  return { point: p, tangent: tangentAt(f, p) }
}

/** The child curve the tangent is: y = mx + b, or x = a at a vertical tangent. */
export function tangentCurvePatch(
  t: ImplicitTangent,
): { modelId: 'line'; params: [number, number]; kind: 'explicit' } | { modelId: 'vline'; params: [number]; kind: 'parametric' } | null {
  if (t.kind === 'line') return { modelId: 'line', params: [t.b, t.m], kind: 'explicit' }
  if (t.kind === 'vertical') return { modelId: 'vline', params: [t.point.x], kind: 'parametric' }
  return null
}

/** Settle a stated point onto the curve: what a typed x, or a drag, stores. */
export function settlePoint(
  parent: FittedCurve,
  models: Record<string, ModelSpec>,
  x: number,
  yHint: number,
): Vec2 | null {
  const f = fnFor(parent, models)
  if (!f) return null
  return reproject(f, x, yHint)
}

/**
 * Where a drag puts the point: the pointer's foot on the curve, then — when
 * a round x (or y) is within `slopPx` of it — the curve's point AT that
 * round value. `snap` rounds a coordinate to the board's ladder.
 */
export function dragImplicitPoint(
  parent: FittedCurve,
  models: Record<string, ModelSpec>,
  prev: Vec2,
  pointer: Vec2,
  snap: (v: number, axis: 'x' | 'y') => number,
  pxPerUnit: { x: number; y: number },
  slopPx = 9,
): Vec2 {
  const f = fnFor(parent, models)
  if (!f) return prev
  const p = dragOnCurve(f, prev, pointer)
  const near = (q: Vec2): boolean =>
    Math.hypot((q.x - p.x) * pxPerUnit.x, (q.y - p.y) * pxPerUnit.y) <= slopPx
  const tries: Vec2[] = []
  const sx = snap(p.x, 'x')
  const yAt = Number.isFinite(sx) ? solveYAt(f, sx, p.y, 1) : null
  if (yAt !== null) tries.push({ x: sx, y: yAt })
  const sy = snap(p.y, 'y')
  const xAt = Number.isFinite(sy) ? solveXAt(f, sy, p.x, 1) : null
  if (xAt !== null) tries.push({ x: xAt, y: sy })
  // Both round (a lattice point such as (3, 4)) wins; then whichever is closer.
  const both = tries.find((q) => Math.abs(snap(q.x, 'x') - q.x) < 1e-9 && Math.abs(snap(q.y, 'y') - q.y) < 1e-9)
  if (both && near(both)) return both
  const ok = tries.filter(near).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))
  return ok[0] ?? p
}

/**
 * Where a new tangent starts. A lattice point of the curve in view, such as
 * (3, 4) on x² + y² = 25 or (3, 3) on the folium, away from the axes and
 * from the horizontal and vertical tangents; failing that, the curve's point
 * nearest the middle of the view.
 */
export function defaultImplicitPoint(
  parent: FittedCurve,
  models: Record<string, ModelSpec>,
  box: Box,
): Vec2 | null {
  const f = fnFor(parent, models)
  if (!f) return null
  let best: { p: Vec2; score: number } | null = null
  const x0 = Math.ceil(box.x0)
  const x1 = Math.floor(box.x1)
  const span = x1 - x0
  if (span >= 0 && span <= 80) {
    for (let x = x0; x <= x1; x++) {
      for (const y of rootsAt(f, x, box.y0, box.y1)) {
        const yi = Math.round(y)
        if (Math.abs(y - yi) > 1e-9 || !onCurve(f, x, yi, 1e-10)) continue
        const t = tangentAt(f, { x, y: yi })
        let score = Math.abs(x) + Math.abs(yi)
        if (x === 0 || yi === 0) score += 50
        if (t.kind !== 'line') score += 200
        else if (Math.abs(t.m) < 1e-12) score += 100
        if (!(x > 0 && yi > 0)) score += 20
        if (!best || score < best.score) best = { p: { x, y: yi }, score }
      }
    }
  }
  if (best) return best.p
  // No lattice point: the curve's point nearest the middle of the view,
  // stepped off so it is not the centre of a circle.
  const cx = (box.x0 + box.x1) / 2
  const cy = (box.y0 + box.y1) / 2
  const w = box.x1 - box.x0
  for (const k of [0.13, 0.31, -0.23, 0.47]) {
    const p = projectOnto(f, { x: cx + k * w, y: cy + 0.2 * k * w })
    if (p && tangentAt(f, p).kind === 'line') return p
  }
  return null
}

/** Every y in [y0, y1] with F(x, y) = 0, by sign changes and Newton. */
function rootsAt(f: ImplicitFn, x: number, y0: number, y1: number): number[] {
  const n = 160
  const out: number[] = []
  let prev = f.F(x, y0)
  for (let i = 1; i <= n; i++) {
    const y = y0 + ((y1 - y0) * i) / n
    const v = f.F(x, y)
    if (Number.isFinite(prev) && Number.isFinite(v) && (prev === 0 || prev * v < 0)) {
      const r = solveYAt(f, x, y - (y1 - y0) / (2 * n), (y1 - y0) / n)
      if (r !== null && !out.some((q) => Math.abs(q - r) < 1e-9)) out.push(r)
    } else if (Number.isFinite(v) && Math.abs(v) < 1e-12) {
      if (!out.some((q) => Math.abs(q - y) < 1e-9)) out.push(y)
    }
    prev = v
  }
  return out
}

// ---------------------------------------------------------------------------
// Horizontal and vertical tangents, cached per curve and search box
// ---------------------------------------------------------------------------

interface Specials {
  horizontal: Vec2[]
  vertical: Vec2[]
  singular: Vec2[]
}

const specialCache = new Map<string, Specials>()

export function specialsFor(
  parent: FittedCurve,
  models: Record<string, ModelSpec>,
  box: Box,
  diff: ImplicitDiff | null,
): Specials | null {
  const f = fnFor(parent, models, diff)
  if (!f) return null
  const key = `${parent.modelId}|${parent.params.join(',')}|${box.x0},${box.x1},${box.y0},${box.y1}|${diff ? diff.dydx.text : ''}`
  const hit = specialCache.get(key)
  if (hit) return hit
  const h = specialTangents(f, box, 'h')
  const v = specialTangents(f, box, 'v')
  const singular = [...h.singular]
  for (const p of v.singular) {
    if (!singular.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-6)) singular.push(p)
  }
  const out: Specials = { horizontal: h.points, vertical: v.points, singular }
  if (specialCache.size > 64) specialCache.clear()
  specialCache.set(key, out)
  return out
}

/** The search box for a view: the window padded by half its size, snapped to a coarse grid. */
export function implicitSearchBox(center: Vec2, halfW: number, halfH: number): Box {
  const g = Math.pow(2, Math.ceil(Math.log2(Math.max(halfW, halfH, 1e-6))))
  const snapDown = (v: number): number => Math.floor(v / g) * g
  const snapUp = (v: number): number => Math.ceil(v / g) * g
  return {
    x0: snapDown(center.x - 1.5 * halfW),
    x1: snapUp(center.x + 1.5 * halfW),
    y0: snapDown(center.y - 1.5 * halfH),
    y1: snapUp(center.y + 1.5 * halfH),
  }
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export interface ImplicitRow {
  linkId: string
  /** dy/dx = −F_x/F_y, simplified; null when it has no symbolic form here. */
  dydx: Formula | null
  fx: Formula | null
  fy: Formula | null
  /** The point, exact where it is: "(3, 4)". */
  pointText: string
  pointTex: string
  x: number
  y: number
  /** "−3/4", "≈ −0.577", "undefined (vertical tangent)". */
  slopeText: string
  /** dy/dx at the point as TeX, for the line "dy/dx |₍₃,₄₎ = −3/4". */
  slopeTex: string | null
  /** The tangent line in point-slope form; x = a at a vertical tangent. */
  line: Formula | null
  /** Why there is no tangent right now. */
  problem: string | null
  horizontal: string[]
  vertical: string[]
  singular: string[]
  /** Whether the H/V tangent points are marked on the board. */
  marks: boolean
  /** d²y/dx²: from the quotient rule, on the curve, and its value at the point. */
  d2: { raw: Formula; onCurve: Formula | null; value: string | null } | null
}


/** A slope as the card prints it: exact when exact, three decimals otherwise. */
function slopeWords(m: number): { text: string; tex: string } {
  const c = coordForm(m)
  if (c.exact && c.text.replace('−', '').length <= 5) return { text: c.text, tex: c.tex }
  const d = coordForm(m, () => false)
  return { text: `≈ ${d.text}`, tex: `\\approx ${d.tex}` }
}

export function implicitRow(
  link: TangentLink,
  parent: FittedCurve | undefined,
  models: Record<string, ModelSpec>,
  src: string | null,
  box: Box | null,
): ImplicitRow {
  const base: ImplicitRow = {
    linkId: link.id,
    dydx: null,
    fx: null,
    fy: null,
    pointText: `(${coordForm(link.x).text}, ${link.y === undefined ? '?' : coordForm(link.y).text})`,
    pointTex: '',
    x: link.x,
    y: link.y ?? Number.NaN,
    slopeText: '—',
    slopeTex: null,
    line: null,
    problem: null,
    horizontal: [],
    vertical: [],
    singular: [],
    marks: link.marks === true,
    d2: null,
  }
  if (!parent) return { ...base, problem: 'the curve it touches is gone' }
  const diff = diffFor(src, parent)
  if (diff) {
    base.dydx = diff.dydx
    base.fx = diff.Fx
    base.fy = diff.Fy
  }
  const st = implicitTangent(link, parent, models, diff)
  if (!st) return { ...base, problem: 'the point is no longer on the curve' }
  const p = st.point
  const pt = pointText(p)
  base.pointText = pt.text
  base.pointTex = pt.tex
  base.x = p.x
  base.y = p.y
  const t = st.tangent
  if (t.kind === 'singular') {
    base.problem = `${pt.text} is a singular point (F_x = F_y = 0): the curve has no single tangent there`
    base.slopeText = 'undefined'
  } else if (t.kind === 'vertical') {
    base.slopeText = `undefined (vertical tangent)`
    base.line = pointSlopeText(p, null)
  } else {
    // The exact slope, from the exact point when the point is exact.
    const ex = pt.exact && diff ? diff.slope(coordForm(p.x, undefined, 1e-9, true).value, coordForm(p.y, undefined, 1e-9, true).value) : t.m
    const m = Number.isFinite(ex) && Math.abs(ex - t.m) <= 1e-7 * Math.max(1, Math.abs(t.m)) ? ex : t.m
    const w = slopeWords(m)
    base.slopeText = w.text
    base.slopeTex = w.tex
    base.line = pointSlopeText(p, w.text.startsWith('≈') ? m : coordForm(m).value)
  }
  if (diff?.d2) {
    let value: string | null = null
    if (t.kind === 'line') {
      const v = diff.d2At(p.x, p.y)
      if (v !== null) {
        const c = coordForm(v)
        value = c.exact ? c.text : `≈ ${c.text}`
      }
    }
    base.d2 = { raw: diff.d2.raw, onCurve: diff.d2.onCurve, value }
  }
  if (box) {
    const sp = specialsFor(parent, models, box, diff)
    if (sp) {
      base.horizontal = sp.horizontal.map((q) => pointText(q).text)
      base.vertical = sp.vertical.map((q) => pointText(q).text)
      base.singular = sp.singular.map((q) => pointText(q).text)
    }
  }
  return base
}

/** "tangent to Circle at (3, 4) · slope −3/4" — the tangent line's own card. */
export function implicitOrigin(row: ImplicitRow): { tail: string; problem: string | null } {
  if (row.problem) return { tail: '', problem: row.problem }
  const slope = row.slopeText.startsWith('undefined') ? 'vertical' : `slope ${row.slopeText}`
  return { tail: `${row.pointText} · ${slope}`, problem: null }
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

/** Horizontal-tangent marks in amber, vertical in orchid — the same two inks everywhere. */
export const HV_INK = { h: '#f9a825', v: '#e879f9' } as const

/**
 * The marked horizontal and vertical tangents: a dot at each, a short stroke
 * showing the tangent's direction, and the point, exact where it is.
 * Singular points get a ring.
 */
export function implicitOverlays(
  links: readonly TangentLink[],
  curves: readonly FittedCurve[],
  models: Record<string, ModelSpec>,
  sources: Readonly<Record<string, string>>,
  box: Box | null,
): Overlay[] {
  if (!box) return []
  const out: Overlay[] = []
  const done = new Set<string>()
  for (const link of links) {
    if (!link.marks || done.has(link.parentId)) continue
    const parent = curves.find((c) => c.id === link.parentId)
    if (!parent || !parent.visible || !isImplicitCurve(parent, models)) continue
    done.add(link.parentId)
    const diff = diffFor(sources[parent.id] ?? null, parent)
    const sp = specialsFor(parent, models, box, diff)
    if (!sp) continue
    const len = (box.x1 - box.x0) / 36
    for (const q of sp.horizontal) {
      out.push({ kind: 'segment', from: { x: q.x - len, y: q.y }, to: { x: q.x + len, y: q.y }, color: HV_INK.h, width: 2.5 })
      out.push({ kind: 'dot', at: q, color: HV_INK.h })
      out.push({ kind: 'label', at: q, text: pointText(q).text, color: HV_INK.h, dir: { x: 0, y: q.y >= 0 ? -1 : 1 }, answer: calcKey(link.id) })
    }
    for (const q of sp.vertical) {
      out.push({ kind: 'segment', from: { x: q.x, y: q.y - len }, to: { x: q.x, y: q.y + len }, color: HV_INK.v, width: 2.5 })
      out.push({ kind: 'dot', at: q, color: HV_INK.v })
      out.push({ kind: 'label', at: q, text: pointText(q).text, color: HV_INK.v, dir: { x: q.x >= 0 ? 1 : -1, y: 0 }, answer: calcKey(link.id) })
    }
    for (const q of sp.singular) {
      out.push({ kind: 'dot', at: q, hollow: true, color: parent.color })
    }
  }
  return out
}


// ---------------------------------------------------------------------------
// The equations a figure's implicit tangents differentiate (exports, worksheets)
// ---------------------------------------------------------------------------

/**
 * curveId -> the equation each implicit curve carrying a tangent is
 * differentiated from: the typed line without its restriction, or the
 * equation its family prints. A line that calls another curve is left out
 * (its partials are not symbolic). What overlaysFor's `implicit.sources` reads.
 */
export function implicitTangentSources(
  links: readonly CalcLink[],
  curves: readonly FittedCurve[],
  models: Record<string, ModelSpec>,
  exprSources: Readonly<Record<string, string>>,
  calls: Readonly<Record<string, readonly string[]>>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const l of links) {
    if (l.kind !== 'tangent' || out[l.parentId] !== undefined) continue
    const c = curves.find((cc) => cc.id === l.parentId)
    if (!c || !isImplicitCurve(c, models) || (calls[c.id]?.length ?? 0) > 0) continue
    let src: string | null = null
    const typed = exprSources[c.id]
    if (c.modelId.startsWith('expr_') && typed) {
      const split = splitTyped(typed)
      src = split && split !== 'piecewise' ? split.base : null
    } else {
      try {
        src = curveEquationText(c, models[c.modelId])
      } catch {
        src = null
      }
    }
    if (src) out[c.id] = src
  }
  return out
}

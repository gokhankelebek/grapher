// ============================================================================
// src/ui/centreLinks.ts — a triangle's centres on its card and on the board
// (NC Math 2 G-CO.10).
//
//   centreToggles(settings)          the Centres section's switches
//   toggleCentre(settings, flag)     one flipped (the measure toggles kept)
//   centreOverlays(shapes, compiled) what the board draws for every triangle
//                                    whose centres are on: the lines that meet
//                                    there, the circles, the point and its
//                                    coordinates (an answer chip)
//
// What is STORED is only BoardShape.measure.centres; every point and line is
// recomputed from the vertices (CompiledShape.centres), so dragging a vertex
// carries the medians, the circumcircle and the Euler line with it.
//
// Pure: no React, no DOM.
// ============================================================================

import type { CentreFlag, Vec2 } from '../core/types'
import { CENTRE_FLAGS, CURVE_COLORS } from '../core/types'
import type { BoardShape, ShapeMeasureSettings } from '../core/persist'
import type { TriangleCentres } from '../core/triangleCentres'
import { approxPoint, eqMeasure } from '../core/triangleCentres'
import type { Overlay } from '../render/overlays'
import { shapeKey } from './reveal'
import type { CompiledShape } from './shapeLinks'

/** Each centre's own ink (print-mapped with the curve palette). */
export const CENTRE_COLORS: Record<CentreFlag, string> = {
  centroid: CURVE_COLORS[3],
  circumcentre: CURVE_COLORS[0],
  incentre: CURVE_COLORS[2],
  orthocentre: CURVE_COLORS[1],
  euler: CURVE_COLORS[4],
}

const LABEL: Record<CentreFlag, [string, string]> = {
  centroid: ['Centroid G', 'Where the three medians meet (vertex to the midpoint of the opposite side)'],
  circumcentre: ['Circumcenter O', 'Where the perpendicular bisectors of the sides meet; with the circle through the three vertices'],
  incentre: ['Incenter I', 'Where the three angle bisectors meet; with the circle touching the three sides'],
  orthocentre: ['Orthocenter H', 'Where the three altitudes meet (extended when the triangle is obtuse)'],
  euler: ['Euler line', 'The line through O, G and H — with HG = 2·GO'],
}

export interface CentreToggle {
  flag: CentreFlag
  label: string
  hint: string
  on: boolean
}

export function centreToggles(settings: ShapeMeasureSettings | undefined): CentreToggle[] {
  const on = new Set(settings?.centres ?? [])
  return CENTRE_FLAGS.map((flag) => ({ flag, label: LABEL[flag][0], hint: LABEL[flag][1], on: on.has(flag) }))
}

/** The settings with one centre flipped (or set); undefined when nothing at all is left. */
export function toggleCentre(
  settings: ShapeMeasureSettings | undefined,
  flag: CentreFlag | 'all' | 'none',
): ShapeMeasureSettings | undefined {
  const cur = new Set(settings?.centres ?? [])
  if (flag === 'all') CENTRE_FLAGS.forEach((f) => cur.add(f))
  else if (flag === 'none') cur.clear()
  else if (cur.has(flag)) cur.delete(flag)
  else cur.add(flag)
  const out: ShapeMeasureSettings = {}
  if (settings?.show && settings.show.length > 0) out.show = [...settings.show]
  if (settings?.to) out.to = settings.to
  const centres = CENTRE_FLAGS.filter((f) => cur.has(f))
  if (centres.length > 0) out.centres = centres
  return out.show || out.to || out.centres ? out : undefined
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

const unit = (v: Vec2): Vec2 => {
  const n = Math.hypot(v.x, v.y)
  return n > 0 ? { x: v.x / n, y: v.y / n } : { x: 0, y: 0 }
}
const add = (a: Vec2, b: Vec2, k = 1): Vec2 => ({ x: a.x + k * b.x, y: a.y + k * b.y })
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y)

/** A circle as a closed path. */
export function circlePath(c: Vec2, r: number, n = 120): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n
    out.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) })
  }
  return out
}

/** A right-angle mark at `at`: `s` along u, then along n. */
export function rightMark(at: Vec2, u: Vec2, n: Vec2, s: number): Vec2[] {
  return [add(at, u, s), add(add(at, u, s), n, s), add(at, n, s)]
}

/** The line through a and b as a line overlay (vertical when it is). */
export function lineOverlay(a: Vec2, b: Vec2, color: string, extra: Partial<Extract<Overlay, { kind: 'line' }>> = {}): Overlay {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const vertical = Math.abs(dx) <= 1e-12 * Math.max(1, Math.abs(dy))
  return { kind: 'line', at: a, slope: vertical ? Infinity : dy / dx, color, ...extra }
}

/** One triangle's centre overlays. */
export function triangleCentreOverlays(id: string, t: TriangleCentres, flags: readonly CentreFlag[]): Overlay[] {
  const out: Overlay[] = []
  const marks: Overlay[] = []
  const on = new Set(flags)
  const [A, B, C] = t.pts
  const V = t.pts
  const L = Math.max(dist(A, B), dist(B, C), dist(C, A))
  const minSide = Math.min(dist(A, B), dist(B, C), dist(C, A))
  const s = Math.min(0.07 * minSide, 0.04 * L + 0.1)
  const opp = (i: number): [Vec2, Vec2] => [V[(i + 1) % 3], V[(i + 2) % 3]]
  const chip = (flag: CentreFlag, at: Vec2, text: string, dir: Vec2): void => {
    marks.push({ kind: 'dot', at, color: CENTRE_COLORS[flag] })
    marks.push({ kind: 'label', at, text, dir, color: CENTRE_COLORS[flag], answer: shapeKey(id, flag) })
  }

  if (on.has('centroid')) {
    const c = CENTRE_COLORS.centroid
    for (let i = 0; i < 3; i++) {
      out.push({ kind: 'segment', from: V[i], to: t.midpoints[i], dashed: true, color: c, width: 1.5 })
      marks.push({ kind: 'dot', at: t.midpoints[i], hollow: true, color: c })
    }
    chip('centroid', t.centroid.pt.pt, `G ${t.centroid.pt.text}`, { x: 1, y: 1 })
  }

  if (on.has('circumcentre')) {
    const c = CENTRE_COLORS.circumcentre
    const O = t.circumcentre.pt.pt
    for (let i = 0; i < 3; i++) {
      const [p, q] = opp(i)
      const M = t.midpoints[i]
      const u = unit(sub(q, p))
      let n = { x: -u.y, y: u.x }
      const tO = dot(sub(O, M), n)
      // the bisector from the side to O, and a little past both
      const e = 0.12 * L
      const lo = Math.min(0, tO) - e
      const hi = Math.max(0, tO) + e
      out.push({ kind: 'segment', from: add(M, n, lo), to: add(M, n, hi), dashed: true, color: c, width: 1.5 })
      // the right-angle mark on the triangle's side of the bisector's foot
      if (dot(sub(V[i], M), n) < 0) n = { x: -n.x, y: -n.y }
      out.push({ kind: 'path', points: rightMark(M, u, n, s), color: c, width: 1.25 })
    }
    out.push({ kind: 'path', points: circlePath(O, t.circumradius.value), closed: true, color: c, width: 1.75 })
    // the radius to the vertex farthest from the incentre side, with R on it
    const far = [A, B, C].reduce((best, p) => (dist(p, t.incentre.pt.pt) > dist(best, t.incentre.pt.pt) ? p : best), A)
    out.push({ kind: 'segment', from: O, to: far, dashed: true, color: c, width: 1.25 })
    chip('circumcentre', O, `O ${t.circumcentre.pt.text}`, { x: -1, y: -1 })
    marks.push({
      kind: 'label',
      at: { x: (O.x + far.x) / 2, y: (O.y + far.y) / 2 },
      text: `R ${eqMeasure(t.circumradius)}`,
      dir: { x: -(far.y - O.y), y: -(far.x - O.x) },
      color: c,
      answer: shapeKey(id, 'circumcentre'),
    })
  }

  if (on.has('incentre')) {
    const c = CENTRE_COLORS.incentre
    const I = t.incentre.pt.pt
    for (let i = 0; i < 3; i++) {
      out.push({ kind: 'segment', from: V[i], to: t.bisectorFeet[i], dashed: true, color: c, width: 1.5 })
    }
    out.push({ kind: 'path', points: circlePath(I, t.inradius.value), closed: true, color: c, width: 1.75 })
    // the radius to the touch point on the longest side, with r on it
    const sideLen = [dist(B, C), dist(C, A), dist(A, B)]
    const k = sideLen.indexOf(Math.max(...sideLen))
    const T = t.touch[k]
    out.push({ kind: 'segment', from: I, to: T, dashed: true, color: c, width: 1.25 })
    for (const p of t.touch) marks.push({ kind: 'dot', at: p, hollow: true, color: c })
    chip('incentre', I, `I ${t.incentre.exact ? t.incentre.pt.text : `≈ ${approxPoint(t.incentre.pt)}`}`, { x: 1, y: -1 })
    marks.push({
      kind: 'label',
      at: { x: (I.x + T.x) / 2, y: (I.y + T.y) / 2 },
      text: `r ${eqMeasure(t.inradius)}`,
      dir: { x: T.y - I.y, y: T.x - I.x },
      color: c,
      answer: shapeKey(id, 'incentre'),
    })
  }

  if (on.has('orthocentre')) {
    const c = CENTRE_COLORS.orthocentre
    const H = t.orthocentre.pt.pt
    for (let i = 0; i < 3; i++) {
      const v = V[i]
      const F = t.feet[i]
      const [p, q] = opp(i)
      const d = sub(F, v)
      const dl = Math.hypot(d.x, d.y)
      if (dl > 1e-12) {
        out.push({ kind: 'segment', from: v, to: F, dashed: true, color: c, width: 1.5 })
        // extended to H when H lies beyond the foot or behind the vertex (obtuse)
        const tH = dot(sub(H, v), d) / (dl * dl)
        if (tH > 1 + 1e-9) out.push({ kind: 'segment', from: F, to: H, dashed: true, color: c, width: 1 })
        else if (tH < -1e-9) out.push({ kind: 'segment', from: v, to: H, dashed: true, color: c, width: 1 })
        // the side, extended to the foot when the foot is off it
        if (t.footOutside[i]) {
          const near = dist(F, p) < dist(F, q) ? p : q
          out.push({ kind: 'segment', from: near, to: F, dashed: true, color: c, width: 1 })
        }
        const u = unit(sub(q, p))
        const n = unit(d)
        // the mark's side along the line: toward the triangle's side when the foot is on it
        const toward = dot(sub(p, F), u) + dot(sub(q, F), u) >= 0 ? u : { x: -u.x, y: -u.y }
        out.push({ kind: 'path', points: rightMark(F, toward, { x: -n.x, y: -n.y }, s), color: c, width: 1.25 })
      }
    }
    chip('orthocentre', H, `H ${t.orthocentre.pt.text}`, { x: -1, y: 1 })
  }

  if (on.has('euler')) {
    const c = CENTRE_COLORS.euler
    if (t.euler) {
      const O = t.circumcentre.pt.pt
      const G = t.centroid.pt.pt
      const H = t.orthocentre.pt.pt
      out.push(lineOverlay(O, G, c, { width: 2 }))
      // the three points, named, when their own toggles are off
      const named: [CentreFlag, Vec2, string][] = [
        ['circumcentre', O, 'O'],
        ['centroid', G, 'G'],
        ['orthocentre', H, 'H'],
      ]
      for (const [f, p, nm] of named) {
        if (on.has(f)) continue
        marks.push({ kind: 'dot', at: p, color: c })
        marks.push({ kind: 'label', at: p, text: nm, dir: { x: 0.6, y: 1 }, color: c })
      }
      marks.push({
        kind: 'label',
        at: { x: (H.x + G.x) / 2, y: (H.y + G.y) / 2 },
        text: `Euler line · ${t.euler.ratioText.split(':')[0]}`,
        dir: { x: 1, y: 0.4 },
        color: c,
        answer: shapeKey(id, 'euler'),
      })
    } else {
      const G = t.centroid.pt.pt
      marks.push({ kind: 'dot', at: G, color: c })
      marks.push({ kind: 'label', at: G, text: 'G = O = I = H', dir: { x: 0, y: 1 }, color: c, answer: shapeKey(id, 'euler') })
    }
  }
  return [...out, ...marks]
}

/** Every visible triangle's centre overlays, in board order. */
export function centreOverlays(shapes: readonly BoardShape[], compiled: ReadonlyMap<string, CompiledShape>): Overlay[] {
  const out: Overlay[] = []
  for (const s of shapes) {
    const flags = s.measure?.centres
    if (!s.visible || !flags || flags.length === 0) continue
    const t = compiled.get(s.id)?.centres
    if (!t) continue
    try {
      const marks = triangleCentreOverlays(s.id, t, flags)
      // An image's centres BELONG to the image: while it is hidden (reveal
      // mode, a student copy) its medians, circles and centres would draw
      // the answer, so they go with it.
      out.push(...(s.xform ? marks.map((o) => ({ ...o, hideWith: shapeKey(s.id, 'image') })) : marks))
    } catch {
      /* a triangle whose centres cannot be drawn draws none */
    }
  }
  return out
}

/** Does any shape on the board draw centres? (Cheap: the overlays are skipped when not.) */
export const anyCentres = (shapes: readonly BoardShape[]): boolean =>
  shapes.some((s) => s.visible && (s.measure?.centres?.length ?? 0) > 0)

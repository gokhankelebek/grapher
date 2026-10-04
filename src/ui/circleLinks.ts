// ============================================================================
// src/ui/circleLinks.ts — the "Circle theorems" section of a circle's card
// and what it draws (NC Math 3 G-C.2, G-C.5, G-CO.14).
//
//   circleOf(curve, src)              the circle a curve IS: a typed circle in
//                                     standard or general form, or a sketch
//                                     that fitted the library circle
//   circlePanel(curve, src, view)     everything the section prints
//   circleOverlays(curves, src, views) what the board draws: points, chords,
//                                     radii, the angle marks, the tangent, the
//                                     shaded sector and highlighted arc, the
//                                     crossing chords, the tangents from T —
//                                     with every VALUE an answer chip
//   circleKeysOf(id, view)            reveal order of the section's answers
//   circleSentences(…)                the description's sentences
//   ensurePoints(view, flag)          a figure switched on gets the points it needs
//
// What is STORED is only the CircleView (src/core/persist.ts): the points as
// typed and which figures are drawn. Every number is recomputed from the
// circle, so retyping the radius or dragging the centre carries the angles,
// the tangent and the sector with it.
//
// Pure: no React, no DOM.
// ============================================================================

import type { FittedCurve, Vec2 } from '../core/types'
import { CURVE_COLORS } from '../core/types'
import type { CircleFlag, CircleView } from '../core/persist'
import { CIRCLE_FLAGS } from '../core/persist'
import type {
  ChordsReport,
  Circle,
  CirclePoint,
  InscribedReport,
  SectorReport,
  TangentReport,
  TangentsFromReport,
} from '../core/circleGeometry'
import {
  CIRCLE_POINT_NAMES,
  MAX_CIRCLE_POINTS,
  chordsCross,
  constValue,
  inscribedCentral,
  makeCircle,
  readCirclePoint,
  sectorOf,
  tangentAt,
  tangentsFrom,
} from '../core/circleGeometry'
import { eqM } from '../core/circleGeometry'
import type { Overlay } from '../render/overlays'
import { conicSectionInfo, safeReadConic } from './conicLinks'
import { circleKey } from './reveal'
import type { CirclePart } from './reveal'
import { circlePath, lineOverlay, rightMark } from './centreLinks'

// ---------------------------------------------------------------------------
// Which curves are circles
// ---------------------------------------------------------------------------

/** The circle a curve is, or null: a typed circle, or a sketched one. */
export function circleOf(curve: FittedCurve, src: string | undefined): Circle | null {
  try {
    if (curve.kind === 'implicit' && src) {
      const spec = safeReadConic(src)
      if (!spec || spec.kind !== 'circle') return null
      const h = constValue(spec.h)
      const k = constValue(spec.k)
      const r = constValue(spec.a)
      return h === null || k === null || r === null ? null : makeCircle(h, k, Math.abs(r))
    }
    if (curve.modelId === 'circle' && curve.params.length >= 3) {
      const [a, b, r] = curve.params
      return makeCircle(a, b, Math.abs(r))
    }
  } catch {
    return null
  }
  return null
}

// ---------------------------------------------------------------------------
// The section
// ---------------------------------------------------------------------------

/** Points a figure needs, and the ones it is given when there are too few. */
export const CIRCLE_NEEDS: Record<CircleFlag, number> = { angles: 3, tangent: 1, sector: 2, chords: 4, external: 0 }
/**
 * P = 30°, Q = 150°, R = 270°, S = 90°: an inscribed angle of 60° on a 120°
 * arc, a sector of 2π/3, chords PQ and RS that cross — and exact
 * coordinates on any circle.
 */
export const DEFAULT_CIRCLE_PTS = ['30°', '150°', '270°', '90°'] as const
export const DEFAULT_EXTERNAL = (c: Circle): string => {
  const x = c.centre.x + 2 * c.r
  const fmt = (v: number) => String(Math.round(v * 1000) / 1000)
  return `(${fmt(x)}, ${fmt(c.centre.y)})`
}

const FLAG_TEXT: Record<CircleFlag, [string, string]> = {
  angles: ['Inscribed & central angle', '∠PRQ and ∠POQ on the arc PQ that R is not on — the inscribed angle is half the central angle'],
  tangent: ['Tangent', 'The tangent line at a point, perpendicular to the radius there'],
  sector: ['Arc & sector', 'Counterclockwise from P to Q: the arc length s = rθ and the sector area A = ½r²θ'],
  chords: ['Crossing chords', 'Chords PQ and RS crossing at E: PE·EQ = RE·ES'],
  external: ['Tangents from T', 'The two tangents from an outside point T are equal; with a secant through P, TA² = TP·TP′'],
}

export interface CircleToggle {
  flag: CircleFlag
  label: string
  hint: string
  on: boolean
}

export type PointRow =
  | { name: string; text: string; ok: true; p: CirclePoint }
  | { name: string; text: string; ok: false; error: string }

export interface CirclePanel {
  curveId: string
  circle: Circle
  view: CircleView
  rows: PointRow[]
  toggles: CircleToggle[]
  /** The tangent's point (index into rows). */
  at: number
  angles: InscribedReport | { error: string } | null
  tangent: TangentReport | { error: string } | null
  sector: SectorReport | { error: string } | null
  chords: ChordsReport | { error: string } | null
  external: TangentsFromReport | { error: string } | null
}

const isOn = (v: CircleView | undefined, f: CircleFlag): boolean => !!v?.show?.includes(f)

function rowsOf(c: Circle, view: CircleView | undefined): PointRow[] {
  return (view?.pts ?? []).slice(0, MAX_CIRCLE_POINTS).map((text, i) => {
    const name = CIRCLE_POINT_NAMES[i]
    const r = readCirclePoint(text, c, name)
    return r.ok ? { name, text, ok: true as const, p: r.p } : { name, text, ok: false as const, error: r.error }
  })
}

const pick = (rows: PointRow[], i: number): CirclePoint | null => {
  const r = rows[i]
  return r && r.ok ? r.p : null
}

function needPoints(rows: PointRow[], n: number, what: string): { error: string } | null {
  if (rows.length < n) {
    const names = CIRCLE_POINT_NAMES.slice(0, n).join(', ')
    return { error: `${what} needs ${n} points (${names}) — add ${n - rows.length} more.` }
  }
  for (let i = 0; i < n; i++) {
    const r = rows[i]
    if (!r.ok) return { error: r.error }
  }
  return null
}

/** The outside point T, as typed. */
function readExternal(text: string | undefined): Vec2 | { error: string } {
  const s = (text ?? '').trim().replace(/[−–]/g, '-')
  if (!s.startsWith('(') || !s.endsWith(')')) return { error: 'Type the outside point T as (x, y).' }
  const inner = s.slice(1, -1)
  let depth = 0
  let at = -1
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) at = i
  }
  const x = at >= 0 ? constValue(inner.slice(0, at)) : null
  const y = at >= 0 ? constValue(inner.slice(at + 1)) : null
  if (x === null || y === null) return { error: `“${text}” is not a point — type T as (x, y).` }
  return { x, y }
}

export function circlePanel(curve: FittedCurve, src: string | undefined, view: CircleView | undefined): CirclePanel | null {
  const circle = circleOf(curve, src)
  if (!circle) return null
  const rows = rowsOf(circle, view)
  const at = Math.min(view?.at ?? 0, Math.max(0, rows.length - 1))
  let angles: CirclePanel['angles'] = null
  let tangent: CirclePanel['tangent'] = null
  let sector: CirclePanel['sector'] = null
  let chords: CirclePanel['chords'] = null
  let external: CirclePanel['external'] = null
  if (isOn(view, 'angles')) angles = needPoints(rows, 3, 'The inscribed angle') ?? inscribedCentral(circle, pick(rows, 0)!, pick(rows, 1)!, pick(rows, 2)!)
  if (isOn(view, 'tangent')) {
    const p = pick(rows, at)
    tangent = p ? tangentAt(circle, p) ?? { error: 'No tangent there.' } : { error: rows[at] && !rows[at].ok ? (rows[at] as { error: string }).error : 'Add a point P for the tangent.' }
  }
  if (isOn(view, 'sector')) sector = needPoints(rows, 2, 'The sector') ?? sectorOf(circle, pick(rows, 0)!, pick(rows, 1)!)
  if (isOn(view, 'chords')) {
    chords = needPoints(rows, 4, 'Crossing chords') ?? chordsCross(circle, pick(rows, 0)!, pick(rows, 1)!, pick(rows, 2)!, pick(rows, 3)!)
  }
  if (isOn(view, 'external')) {
    const T = readExternal(view?.ext ?? DEFAULT_EXTERNAL(circle))
    external = 'error' in T ? T : tangentsFrom(circle, T, pick(rows, 0))
  }
  return {
    curveId: curve.id,
    circle,
    view: view ?? {},
    rows,
    toggles: CIRCLE_FLAGS.map((flag) => ({ flag, label: FLAG_TEXT[flag][0], hint: FLAG_TEXT[flag][1], on: isOn(view, flag) })),
    at,
    angles,
    tangent,
    sector,
    chords,
    external,
  }
}

/**
 * The view with `flag` switched on or off. Switching on a figure that needs
 * more points than there are adds the default ones (P = 30°, Q = 150° …), so
 * the click visibly does something on any circle.
 */
export function toggleCircleFlag(view: CircleView | undefined, flag: CircleFlag, circle: Circle | null): CircleView {
  const cur = new Set(view?.show ?? [])
  const turningOn = !cur.has(flag)
  if (turningOn) cur.add(flag)
  else cur.delete(flag)
  const next: CircleView = { ...(view ?? {}), show: CIRCLE_FLAGS.filter((f) => cur.has(f)) }
  if (turningOn) {
    const pts = [...(view?.pts ?? [])]
    const need = CIRCLE_NEEDS[flag]
    while (pts.length < need) pts.push(DEFAULT_CIRCLE_PTS[pts.length] ?? `${(pts.length * 60) % 360}°`)
    next.pts = pts
    if (flag === 'external' && !next.ext && circle) next.ext = DEFAULT_EXTERNAL(circle)
  } else {
    // What switching ON added by itself goes when it is switched off again,
    // so on-then-off stores exactly what was stored before: default points
    // nobody retyped, beyond what the figures still on need, and the default
    // T of a "Tangents from T" that is off.
    const still = Math.max(0, ...[...cur].map((f) => CIRCLE_NEEDS[f]))
    const pts = [...(next.pts ?? [])]
    while (pts.length > still && pts[pts.length - 1] === DEFAULT_CIRCLE_PTS[pts.length - 1]) pts.pop()
    if (pts.length > 0) next.pts = pts
    else delete next.pts
    if (next.at !== undefined && next.at >= pts.length) delete next.at
    if (flag === 'external' && next.ext !== undefined && circle && next.ext === DEFAULT_EXTERNAL(circle)) delete next.ext
  }
  if (next.show && next.show.length === 0) delete next.show
  return next
}

/** One point retyped (or removed with text null). */
export function setCirclePoint(view: CircleView | undefined, i: number, text: string | null): CircleView {
  const pts = [...(view?.pts ?? [])]
  if (text === null) pts.splice(i, 1)
  else if (i >= pts.length) pts.push(text)
  else pts[i] = text
  const next: CircleView = { ...(view ?? {}), pts }
  if (next.at !== undefined && next.at >= pts.length) delete next.at
  return next
}

/** The next default point to add: an angle not yet used. */
export function nextCirclePoint(view: CircleView | undefined): string {
  const n = view?.pts?.length ?? 0
  return DEFAULT_CIRCLE_PTS[n] ?? `${[45, 210, 330, 120][n % 4]}°`
}

// ---------------------------------------------------------------------------
// Dragging a point along the circle
// ---------------------------------------------------------------------------

/** "3.2" / "-1.5": a snapped coordinate as a point is typed. */
const coordText = (v: number): string => String(Object.is(v, -0) ? 0 : v)

/**
 * The text a circle point gets when it is dragged to `pos`: it stays ON the
 * circle (the pointer is projected onto it along the radius), and it keeps
 * the way it was written — a point typed as coordinates "(3, 4)" gets the
 * projected point's coordinates, snapped to the grid's ladder by `snap` (a
 * lattice point on the circle lands exactly; any other is moved onto the
 * circle when it is read, as a typed one is); anything else becomes whole
 * degrees, "37°". Null when the pointer is at the centre.
 */
export function draggedCirclePoint(c: Circle, was: string, pos: Vec2, snap: (p: Vec2) => Vec2): string | null {
  const dx = pos.x - c.centre.x
  const dy = pos.y - c.centre.y
  const d = Math.hypot(dx, dy)
  if (!(d > 0) || !Number.isFinite(d)) return null
  if ((was ?? '').trim().startsWith('(')) {
    const on = snap({ x: c.centre.x + (c.r * dx) / d, y: c.centre.y + (c.r * dy) / d })
    return `(${coordText(on.x)}, ${coordText(on.y)})`
  }
  const deg = (((Math.round((Math.atan2(dy, dx) * 180) / Math.PI) % 360) + 360) % 360)
  return `${deg}°`
}

/** Where each of a panel's points can be grabbed, for the board's drag handles. */
export function circlePointHandles(p: CirclePanel): { index: number; name: string; pos: Vec2; label: string }[] {
  const out: { index: number; name: string; pos: Vec2; label: string }[] = []
  p.rows.forEach((row, index) => {
    if (row.ok) out.push({ index, name: row.name, pos: row.p.pt, label: `${row.name} ${row.p.degText}` })
  })
  return out
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

const COL = {
  central: CURVE_COLORS[3],
  inscribed: CURVE_COLORS[4],
  tangent: CURVE_COLORS[2],
  sector: CURVE_COLORS[6],
  chords: CURVE_COLORS[5],
  external: CURVE_COLORS[1],
}

/** Points along the arc about `c`, counterclockwise from `start` through `sweep` degrees. */
export function arcPoints(c: Vec2, r: number, start: number, sweep: number, n?: number): Vec2[] {
  const steps = n ?? Math.max(8, Math.ceil(sweep / 3))
  const out: Vec2[] = []
  for (let i = 0; i <= steps; i++) {
    const t = ((start + (sweep * i) / steps) * Math.PI) / 180
    out.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) })
  }
  return out
}

const polar = (c: Vec2, r: number, deg: number): Vec2 => ({
  x: c.x + r * Math.cos((deg * Math.PI) / 180),
  y: c.y + r * Math.sin((deg * Math.PI) / 180),
})

/** "= 60°" or "≈ 66.9°" — a text after its name, never "= ≈ 66.9°". */
const eqT = (t: string): string => (t.startsWith('≈') ? t : `= ${t}`)

/** "= 2π" or "≈ 3.71" — a value after its name, never "= ≈ 3.71". */
const eqV = (v: { text: string; exact: boolean }): string => (v.exact ? `= ${v.text}` : v.text.startsWith('≈') ? v.text : `≈ ${v.text}`)

/** A chip direction (screen: y down) pointing away from `from` toward `to`. */
const away = (from: Vec2, to: Vec2): Vec2 => ({ x: to.x - from.x, y: -(to.y - from.y) })

/** One circle's overlays for its panel. */
export function panelOverlays(p: CirclePanel, curveColor: string): Overlay[] {
  const out: Overlay[] = []
  const marks: Overlay[] = []
  const { circle: c } = p
  const O = c.centre
  const r = c.r
  const key = (part: CirclePart) => circleKey(p.curveId, part)
  const pts = p.rows.filter((row): row is Extract<PointRow, { ok: true }> => row.ok).map((row) => row.p)
  const used = new Set<string>()
  const need = (n: number) => pts.slice(0, n).forEach((q) => used.add(q.name))
  const ok = <T,>(x: T | { error: string } | null): x is T => x !== null && !(typeof x === 'object' && x !== null && 'error' in (x as object))

  if (ok<InscribedReport>(p.angles)) {
    const a = p.angles
    need(3)
    const [P, Q, R] = pts
    out.push({ kind: 'path', points: arcPoints(O, r, a.arc.start, a.arc.sweep), color: COL.central, width: 4.5, alpha: 0.55 })
    out.push({ kind: 'segment', from: O, to: P.pt, color: COL.central, width: 1.75 })
    out.push({ kind: 'segment', from: O, to: Q.pt, color: COL.central, width: 1.75 })
    out.push({ kind: 'segment', from: R.pt, to: P.pt, color: COL.inscribed, width: 1.75 })
    out.push({ kind: 'segment', from: R.pt, to: Q.pt, color: COL.inscribed, width: 1.75 })
    const rc = 0.2 * r
    out.push({ kind: 'path', points: arcPoints(O, rc, a.centralMark.start, a.centralMark.sweep), color: COL.central, width: 1.75 })
    const midC = polar(O, rc, a.centralMark.start + a.centralMark.sweep / 2)
    marks.push({ kind: 'label', at: midC, text: `∠${P.name}O${Q.name} ${eqT(a.central.text)}`, dir: away(O, midC), color: COL.central, answer: key('angles') })
    const ri = 0.17 * r
    if (a.diameter) {
      const u1 = { x: (P.pt.x - R.pt.x) / Math.hypot(P.pt.x - R.pt.x, P.pt.y - R.pt.y), y: (P.pt.y - R.pt.y) / Math.hypot(P.pt.x - R.pt.x, P.pt.y - R.pt.y) }
      const u2 = { x: (Q.pt.x - R.pt.x) / Math.hypot(Q.pt.x - R.pt.x, Q.pt.y - R.pt.y), y: (Q.pt.y - R.pt.y) / Math.hypot(Q.pt.x - R.pt.x, Q.pt.y - R.pt.y) }
      out.push({ kind: 'path', points: rightMark(R.pt, u1, u2, 0.1 * r), color: COL.inscribed, width: 1.5 })
    } else {
      out.push({ kind: 'path', points: arcPoints(R.pt, ri, a.inscribedMark.start, a.inscribedMark.sweep), color: COL.inscribed, width: 1.75 })
    }
    const midI = polar(R.pt, ri, a.inscribedMark.start + a.inscribedMark.sweep / 2)
    marks.push({ kind: 'label', at: midI, text: `∠${P.name}${R.name}${Q.name} ${eqT(a.inscribed.text)}`, dir: away(R.pt, midI), color: COL.inscribed, answer: key('angles') })
  }

  if (ok<TangentReport>(p.tangent)) {
    const t = p.tangent
    const P = pts.find((q) => q.name === t.name)
    if (P) {
      used.add(P.name)
      out.push({ kind: 'segment', from: O, to: P.pt, color: COL.tangent, width: 1.75 })
      const n = { x: (O.x - P.pt.x) / r, y: (O.y - P.pt.y) / r }
      const u = { x: -n.y, y: n.x }
      out.push(lineOverlay(P.pt, { x: P.pt.x + u.x, y: P.pt.y + u.y }, COL.tangent, { width: 2 }))
      out.push({ kind: 'path', points: rightMark(P.pt, u, n, 0.09 * r), color: COL.tangent, width: 1.5 })
      const chipAt = { x: P.pt.x + u.x * 0.6 * r, y: P.pt.y + u.y * 0.6 * r }
      marks.push({ kind: 'label', at: chipAt, text: t.line.slopeIntercept.text, dir: away(O, P.pt), color: COL.tangent, answer: key('tangent') })
    }
  }

  if (ok<SectorReport>(p.sector)) {
    const s = p.sector
    need(2)
    const [P, Q] = pts
    const arc = arcPoints(O, r, s.start, s.deg)
    out.push({ kind: 'path', points: [O, ...arc], closed: true, fill: 0.2, alpha: 0, color: COL.sector, under: true })
    out.push({ kind: 'path', points: arc, color: COL.sector, width: 4.5, alpha: 0.75 })
    out.push({ kind: 'segment', from: O, to: P.pt, color: COL.sector, width: 1.75 })
    out.push({ kind: 'segment', from: O, to: Q.pt, color: COL.sector, width: 1.75 })
    const ra = 0.14 * r
    out.push({ kind: 'path', points: arcPoints(O, ra, s.start, s.deg), color: COL.sector, width: 1.5 })
    const mid = s.start + s.deg / 2
    const onArcPt = polar(O, r, mid)
    marks.push({ kind: 'label', at: onArcPt, text: `s ${eqV(s.arc)}`, dir: away(O, onArcPt), color: COL.sector, answer: key('sector') })
    const inside = polar(O, 0.55 * r, mid)
    marks.push({ kind: 'label', at: inside, text: `A ${eqV(s.area)}`, dir: { x: 0, y: 0.01 }, color: COL.sector, answer: key('sector') })
    const thetaAt = polar(O, ra, mid)
    marks.push({ kind: 'label', at: thetaAt, text: `θ ${eqV(s.theta)}`, dir: away(onArcPt, O), color: COL.sector })
  }

  if (ok<ChordsReport>(p.chords)) {
    const ch = p.chords
    need(4)
    const [P, Q, R, S] = pts
    out.push({ kind: 'segment', from: P.pt, to: Q.pt, color: COL.chords, width: 1.75 })
    out.push({ kind: 'segment', from: R.pt, to: S.pt, color: COL.chords, width: 1.75 })
    marks.push({ kind: 'dot', at: ch.E, color: COL.chords })
    marks.push({ kind: 'label', at: ch.E, text: 'E', dir: { x: -1, y: -1 }, color: COL.chords })
    marks.push({
      kind: 'label',
      at: ch.E,
      text: `${P.name}E·E${Q.name} = ${R.name}E·E${S.name} ${eqM(ch.product)}`,
      dir: { x: 1, y: 1 },
      color: COL.chords,
      answer: key('chords'),
    })
  }

  if (ok<TangentsFromReport>(p.external)) {
    const e = p.external
    out.push({ kind: 'segment', from: e.T, to: e.A, color: COL.external, width: 1.75 })
    out.push({ kind: 'segment', from: e.T, to: e.B, color: COL.external, width: 1.75 })
    out.push({ kind: 'segment', from: O, to: e.A, dashed: true, color: COL.external, width: 1.25 })
    out.push({ kind: 'segment', from: O, to: e.B, dashed: true, color: COL.external, width: 1.25 })
    for (const X of [e.A, e.B]) {
      const n = { x: (O.x - X.x) / r, y: (O.y - X.y) / r }
      const tl = Math.hypot(e.T.x - X.x, e.T.y - X.y)
      const u = tl > 0 ? { x: (e.T.x - X.x) / tl, y: (e.T.y - X.y) / tl } : { x: -n.y, y: n.x }
      out.push({ kind: 'path', points: rightMark(X, u, n, 0.09 * r), color: COL.external, width: 1.5 })
    }
    marks.push({ kind: 'dot', at: e.T, color: COL.external })
    marks.push({ kind: 'label', at: e.T, text: 'T', dir: away(O, e.T), color: COL.external })
    for (const [X, nm] of [[e.A, 'A'], [e.B, 'B']] as const) {
      marks.push({ kind: 'dot', at: X, hollow: true, color: COL.external })
      marks.push({ kind: 'label', at: X, text: nm, dir: away(O, X), color: COL.external })
      const mid = { x: (e.T.x + X.x) / 2, y: (e.T.y + X.y) / 2 }
      marks.push({ kind: 'label', at: mid, text: `T${nm} ${eqM(e.length)}`, dir: away(O, mid), color: COL.external, answer: key('external') })
    }
    if (e.secant) {
      used.add(e.secant.through)
      const far = Math.hypot(e.secant.P2.x - e.T.x, e.secant.P2.y - e.T.y) > Math.hypot(e.secant.P.x - e.T.x, e.secant.P.y - e.T.y) ? e.secant.P2 : e.secant.P
      out.push({ kind: 'segment', from: e.T, to: far, color: COL.external, width: 1.5, dashed: true })
      marks.push({ kind: 'dot', at: e.secant.P2, hollow: true, color: COL.external })
      marks.push({ kind: 'label', at: e.secant.P2, text: `${e.secant.through}′`, dir: away(O, e.secant.P2), color: COL.external })
    }
  }

  // The centre and the points, named (always: they are the givens).
  marks.push({ kind: 'dot', at: O, color: curveColor })
  marks.push({ kind: 'label', at: O, text: 'O', dir: { x: -1, y: 1 }, color: curveColor })
  for (const q of pts) {
    marks.push({ kind: 'dot', at: q.pt, color: curveColor })
    marks.push({ kind: 'label', at: q.pt, text: q.name, dir: away(O, q.pt), color: curveColor })
  }
  return [...out, ...marks]
}

/** Every visible circle's overlays, for the circles whose section draws something. */
export function circleOverlays(
  curves: readonly FittedCurve[],
  sources: Readonly<Record<string, string>>,
  views: Readonly<Record<string, CircleView>>,
): Overlay[] {
  const out: Overlay[] = []
  for (const [id, view] of Object.entries(views)) {
    if (!view.show || view.show.length === 0) continue
    const curve = curves.find((c) => c.id === id)
    if (!curve || !curve.visible) continue
    try {
      const p = circlePanel(curve, sources[id], view)
      if (p) out.push(...panelOverlays(p, curve.color))
    } catch {
      /* a circle whose figures cannot be drawn draws none */
    }
  }
  return out
}

/**
 * A circle card's answers, in the order "next" reveals them: the completed
 * square of a general-form circle, then each figure the section draws.
 */
export function circleKeysOf(curve: FittedCurve, src: string | undefined, view: CircleView | undefined): string[] {
  const out: string[] = []
  if (curve.kind === 'implicit' && src) {
    const info = conicSectionInfo(src, 'implicit')
    if (info && info.kind === 'conic' && info.spec.kind === 'circle' && info.general) out.push(circleKey(curve.id, 'square'))
  }
  if (view?.show && view.show.length > 0 && circleOf(curve, src)) {
    for (const f of view.show) out.push(circleKey(curve.id, f))
  }
  return out
}

/** The description's sentences: what is drawn (always) and what it states (answers). */
export function circleSentences(
  curves: readonly FittedCurve[],
  sources: Readonly<Record<string, string>>,
  views: Readonly<Record<string, CircleView>>,
): { text: string; answer?: true }[] {
  const out: { text: string; answer?: true }[] = []
  for (const [id, view] of Object.entries(views)) {
    if (!view.show || view.show.length === 0) continue
    const curve = curves.find((c) => c.id === id)
    if (!curve || !curve.visible) continue
    let p: CirclePanel | null = null
    try {
      p = circlePanel(curve, sources[id], view)
    } catch {
      p = null
    }
    if (!p) continue
    const ptsText = p.rows
      .filter((r): r is Extract<PointRow, { ok: true }> => r.ok)
      .map((r) => `${r.name}${r.p.coords.text.startsWith('≈') ? ' ' : ''}${r.p.coords.text}`)
    out.push({
      text: `On the circle ${p.circle.equation} (center O${p.circle.centreText.text}, radius ${p.circle.radius.text}) the points ${ptsText.join(', ')} are marked.`,
    })
    const ok = <T,>(x: T | { error: string } | null): x is T => x !== null && !(typeof x === 'object' && 'error' in (x as object))
    if (ok<InscribedReport>(p.angles)) {
      out.push({ text: `The central angle and the inscribed angle on arc ${p.angles.ends.join('')} are drawn.` })
      out.push({ text: `${p.angles.relation.replace(/:.*$/, '')}: the central angle is ${p.angles.central.text} and the inscribed angle is ${p.angles.inscribed.text}.`, answer: true })
    }
    if (ok<TangentReport>(p.tangent)) {
      out.push({ text: `The tangent at ${p.tangent.name} is drawn, with a right-angle mark where it meets the radius.` })
      out.push({ text: `The tangent at ${p.tangent.name} is ${p.tangent.line.slopeIntercept.text}.`, answer: true })
    }
    if (ok<SectorReport>(p.sector)) {
      out.push({ text: `The sector ${p.sector.ends[0]}O${p.sector.ends[1]} with central angle θ ${eqV(p.sector.theta)} (${p.sector.degText}) is shaded and its arc highlighted.` })
      out.push({ text: `The arc length is ${p.sector.arc.text} and the sector area is ${p.sector.area.text}.`, answer: true })
    }
    if (ok<ChordsReport>(p.chords)) {
      const [a, b, c2, d] = p.chords.names
      out.push({ text: `Chords ${a}${b} and ${c2}${d} cross at E.` })
      out.push({ text: `${a}E·E${b} = ${c2}E·E${d} ${eqM(p.chords.product)}.`, answer: true })
    }
    if (ok<TangentsFromReport>(p.external)) {
      out.push({ text: `Two tangents are drawn from the point T${p.external.tText.text}, touching the circle at A and B.` })
      out.push({ text: `TA = TB ${eqM(p.external.length)}.`, answer: true })
    }
  }
  return out
}

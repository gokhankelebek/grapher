// ============================================================================
// src/core/circleGeometry.ts — theorems on a circle (NC Math 3 G-C.2, G-C.5,
// G-CO.14), exactly where the numbers allow it.
//
//   makeCircle(h, k, r)                    the circle, its centre and radius exact
//   readCirclePoint(text, circle, name)    a point ON it: "30°", "pi/3", "2.1 rad",
//                                          "(3, 4)" — coordinates off the circle
//                                          are moved onto it along the radius
//   inscribedCentral(c, P, Q, R)           ∠PRQ = ½·∠POQ on the arc PQ that R
//                                          does not lie on; a diameter → 90°
//   tangentAt(c, P)                        the tangent ⟂ the radius OP, its equation
//   sectorOf(c, P, Q)                      counterclockwise from P to Q: θ in
//                                          radians, s = rθ, A = ½r²θ, and the
//                                          degree-proportion forms, exact in π
//   chordsCross(c, P, Q, R, S)             chords PQ and RS meeting at E:
//                                          PE·EQ = RE·ES = r² − OE²
//   tangentsFrom(c, T, P?)                 the two tangents from T are equal,
//                                          √(OT² − r²); a secant through P:
//                                          TA² = TP·TP′
//
// Every angle is held in DEGREES (0 ≤ θ < 360, counterclockwise from the
// positive x-direction about the centre), because that is how the class
// types it; the radian forms are written from θ/180 as a fraction of π.
//
// Pure: no DOM, no React.
// ============================================================================

import type { Vec2 } from './types'
import type { LineEq, Measure, PointMeasure, Rat, SlopeInfo, Surd } from './geometry'
import {
  MINUS,
  angleAt,
  dec,
  degText,
  distance,
  lineRelativeTo,
  measureOf,
  measureOfSurd,
  perpReason,
  pointMeasure,
  pointText,
  ratAdd,
  ratMul,
  ratSub,
  ratText,
  slope,
  sqrtRat,
  surdOf,
  toRat,
  withApprox,
} from './geometry'
import { evalAst, parseAst } from './parse'

// ---------------------------------------------------------------------------
// The circle
// ---------------------------------------------------------------------------

export interface Circle {
  centre: Vec2
  r: number
  /** The centre, exact where it is: "(2, −3)". */
  centreText: PointMeasure
  /** The radius: "4", "√10". */
  radius: Measure
  /** r² exactly, when it is rational. */
  r2: Rat | null
  /** r = c√k, when it is a surd. */
  rSurd: Surd | null
  /** h and k as fractions, when they are. */
  hr: Rat | null
  kr: Rat | null
  /** "(x − 2)² + (y + 3)² = 16" */
  equation: string
}

/** "x − 2", "y + 3", "x" — one squared bracket of the standard form. */
function shifted(v: string, m: Measure): string {
  if (Math.abs(m.value) < 1e-12) return v
  return m.value < 0 ? `${v} + ${m.text.replace(MINUS, '')}` : `${v} ${MINUS} ${m.text}`
}

export function makeCircle(h: number, k: number, r: number): Circle | null {
  if (![h, k, r].every(Number.isFinite) || !(r > 0)) return null
  const centre = { x: h, y: k }
  const centreText = pointText(centre)
  const rSurd = surdOf(r)
  const radius = rSurd ? measureOfSurd(rSurd) : measureOf(r)
  const r2 = toRat(r * r)
  const r2Text = r2 ? ratText(r2) : dec(r * r, 4)
  const sq = (b: string): string => (b.length === 1 ? `${b}²` : `(${b})²`)
  const equation = `${sq(shifted('x', centreText.x))} + ${sq(shifted('y', centreText.y))} = ${r2Text}`
  return { centre, r, centreText, radius, r2, rSurd, hr: toRat(h), kr: toRat(k), equation }
}

// ---------------------------------------------------------------------------
// Points on it
// ---------------------------------------------------------------------------

/** Names the points on a circle are given, in order (T is the outside point). */
export const CIRCLE_POINT_NAMES = ['P', 'Q', 'R', 'S', 'U', 'V'] as const
export const MAX_CIRCLE_POINTS = CIRCLE_POINT_NAMES.length

export interface CirclePoint {
  name: string
  /** Degrees counterclockwise from the positive x-direction, 0 ≤ deg < 360. */
  deg: number
  pt: Vec2
  coords: PointMeasure
  /** "30°", "≈ 41.81°" */
  degText: string
  /** "π/6", "≈ 0.73" */
  radText: string
  /** Typed as coordinates that were not on the circle: moved onto it along the radius. */
  moved: boolean
}

export type CirclePointRead = { ok: true; p: CirclePoint } | { ok: false; error: string }

/** Typed text a parser reads: π, °, Unicode minus. */
function prep(s: string): string {
  return s.replace(/[−–]/g, '-').replace(/π/g, 'pi').replace(/，/g, ',').trim()
}

/** A constant typed expression's value, or null. */
export function constValue(text: string): number | null {
  const s = prep(text)
  if (s === '') return null
  const ast = parseAst(s)
  if (!ast.ok || ast.rhs !== null) return null
  let v = Number.NaN
  try {
    v = evalAst(ast.lhs, Number.NaN)
  } catch {
    return null
  }
  return Number.isFinite(v) ? v : null
}

/** Split "a, b" at its one top-level comma. */
function splitPair(inner: string): [string, string] | null {
  let depth = 0
  let at = -1
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) {
      if (at >= 0) return null
      at = i
    }
  }
  return at < 0 ? null : [inner.slice(0, at), inner.slice(at + 1)]
}

/** A number of degrees in [0, 360), snapped onto the fraction it is (59.999… → 60). */
function normDeg(d: number): number {
  let v = d % 360
  if (v < 0) v += 360
  const r = toRat(v, 1000)
  if (r) v = r.n / r.d
  if (v >= 360 - 1e-9) v = 0
  return v
}

/** θ as a multiple of π when θ/180 is a small fraction: "2π/3", "π", "7π/4". */
export function piText(r: Rat): { text: string; tex: string } {
  if (r.n === 0) return { text: '0', tex: '0' }
  const neg = r.n < 0 ? MINUS : ''
  const negT = r.n < 0 ? '-' : ''
  const n = Math.abs(r.n)
  const head = n === 1 ? 'π' : `${n}π`
  const headT = n === 1 ? '\\pi' : `${n}\\pi`
  return r.d === 1 ? { text: `${neg}${head}`, tex: `${negT}${headT}` } : { text: `${neg}${head}/${r.d}`, tex: `${negT}\\frac{${headT}}{${r.d}}` }
}

/** The radian measure of an angle in degrees: exact in π when it can be. */
export function radiansOf(deg: number): { text: string; tex: string; exact: boolean; value: number; ofPi: Rat | null } {
  const value = (deg * Math.PI) / 180
  const r = toRat(deg / 180, 360)
  if (r) return { ...piText(r), exact: true, value, ofPi: r }
  const t = dec(value, 2)
  return { text: `≈ ${t}`, tex: `\\approx ${t.replace(MINUS, '-')}`, exact: false, value, ofPi: null }
}

function pointAtDeg(c: Circle, deg: number): Vec2 {
  const t = (deg * Math.PI) / 180
  // exact zeros at the quarter turns, so (0, 6) is not (3.7e-16, 6)
  const cs = Math.abs(deg - 90) < 1e-12 || Math.abs(deg - 270) < 1e-12 ? 0 : Math.cos(t)
  const sn = Math.abs(deg) < 1e-12 || Math.abs(deg - 180) < 1e-12 ? 0 : Math.sin(t)
  return { x: c.centre.x + c.r * cs, y: c.centre.y + c.r * sn }
}

/** "2+3√3" → "2 + 3√3": a binary sign gets its spaces, as the rest of the card writes them. */
export function spaced(m: Measure): Measure {
  if (!m.exact) return m
  return { ...m, text: m.text.replace(/([\d√)])([+−])(?=[\d√(])/g, '$1 $2 ') }
}

/** A point's coordinates: fractions when they are, else recognised (2 + 3√3), else decimals. */
function coordsOf(pt: Vec2): PointMeasure {
  const rx = toRat(pt.x)
  const ry = toRat(pt.y)
  if (rx && ry) return pointMeasure(pt, rx, ry)
  const x = rx ? pointMeasure(pt, rx, rx).x : spaced(measureOf(pt.x))
  const y = ry ? pointMeasure(pt, ry, ry).y : spaced(measureOf(pt.y))
  return { pt, x, y, text: `(${x.text}, ${y.text})`, tex: `\\left(${x.tex}, ${y.tex}\\right)` }
}

function makePoint(c: Circle, name: string, deg: number, pt: Vec2, moved: boolean): CirclePoint {
  const d = degText(deg)
  const rad = radiansOf(deg)
  return {
    name,
    deg,
    pt,
    coords: coordsOf(pt),
    degText: d.exact ? d.text : `≈ ${d.text}`,
    radText: rad.text,
    moved,
  }
}

/**
 * A point on the circle from what was typed: an angle ("30", "30°", "pi/3",
 * "2.1 rad") or coordinates "(3, 4)". A plain number is DEGREES; anything
 * with π (or "rad") is radians.
 */
export function readCirclePoint(text: string, c: Circle, name: string): CirclePointRead {
  const raw = (text ?? '').trim()
  if (raw === '') return { ok: false, error: `${name} is empty — type an angle (30°, pi/3) or a point (3, 4).` }
  const s = prep(raw)
  if (s.startsWith('(')) {
    if (!s.endsWith(')')) return { ok: false, error: `Write ${name} as (x, y).` }
    const pair = splitPair(s.slice(1, -1))
    const x = pair ? constValue(pair[0]) : null
    const y = pair ? constValue(pair[1]) : null
    if (x === null || y === null) return { ok: false, error: `“${raw}” is not a point — write ${name} as (x, y).` }
    const dx = x - c.centre.x
    const dy = y - c.centre.y
    const d = Math.hypot(dx, dy)
    if (!(d > 1e-12)) return { ok: false, error: `(${raw.slice(1, -1)}) is the centre, which is not on the circle.` }
    const deg = normDeg((Math.atan2(dy, dx) * 180) / Math.PI)
    const on = Math.abs(d - c.r) <= 1e-9 * Math.max(1, c.r)
    if (on) return { ok: true, p: makePoint(c, name, deg, { x, y }, false) }
    return { ok: true, p: makePoint(c, name, deg, pointAtDeg(c, deg), true) }
  }
  const isDeg = /(°|deg(rees?)?)\s*$/i.test(s)
  const isRad = !isDeg && (/rad(ians?)?\s*$/i.test(s) || /pi/.test(s))
  const body = s.replace(/(°|deg(rees?)?|rad(ians?)?)\s*$/i, '').trim()
  const v = constValue(body)
  if (v === null) return { ok: false, error: `“${raw}” is not an angle — type 30°, pi/3 or a point (3, 4).` }
  const deg = normDeg(isRad ? (v * 180) / Math.PI : v)
  return { ok: true, p: makePoint(c, name, deg, pointAtDeg(c, deg), false) }
}

// ---------------------------------------------------------------------------
// Angles drawn as arcs
// ---------------------------------------------------------------------------

/** An angle mark: from `start` degrees counterclockwise through `sweep` degrees, about `at`. */
export interface AngleMark {
  at: Vec2
  start: number
  sweep: number
}

const dirDeg = (from: Vec2, to: Vec2): number => normDeg((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI)

/** The (smaller) angle at `v` between the rays to a and b, as a mark. */
export function angleMark(v: Vec2, a: Vec2, b: Vec2): AngleMark {
  const da = dirDeg(v, a)
  const db = dirDeg(v, b)
  let sweep = (db - da + 360) % 360
  if (sweep <= 180) return { at: v, start: da, sweep }
  sweep = 360 - sweep
  return { at: v, start: db, sweep }
}

/** Is `deg` on the counterclockwise arc from `from` through `sweep` degrees (ends excluded)? */
export function onArc(deg: number, from: number, sweep: number): boolean {
  const t = (deg - from + 360) % 360
  return t > 1e-9 && t < sweep - 1e-9
}

// ---------------------------------------------------------------------------
// Inscribed and central angles
// ---------------------------------------------------------------------------

export interface InscribedReport {
  /** The intercepted arc PQ (the one R is not on): counterclockwise from `start`, `sweep` degrees. */
  arc: { start: number; sweep: number }
  /** The arc's endpoints in arc order (start, end). */
  ends: [string, string]
  central: { deg: number; text: string; reflex: boolean }
  inscribed: { deg: number; text: string }
  /** PQ is a diameter: the inscribed angle is a right angle. */
  diameter: boolean
  /** "∠PRQ = ½·∠POQ: 60° = ½ · 120°" */
  relation: string
  /** "∠PRQ intercepts arc PQ (120°)" */
  intercepts: string
  centralMark: AngleMark
  inscribedMark: AngleMark
}

export function inscribedCentral(c: Circle, P: CirclePoint, Q: CirclePoint, R: CirclePoint): InscribedReport | { error: string } {
  const same = (a: CirclePoint, b: CirclePoint) => Math.abs(a.deg - b.deg) < 1e-9
  if (same(P, Q)) return { error: `${P.name} and ${Q.name} are the same point — the arc ${P.name}${Q.name} needs two different points.` }
  if (same(R, P) || same(R, Q)) return { error: `${R.name} has to be a third point, different from ${P.name} and ${Q.name}.` }
  const ccw = (Q.deg - P.deg + 360) % 360
  // the arc R is NOT on is the one ∠PRQ intercepts
  const rOnCcw = onArc(R.deg, P.deg, ccw)
  const arc = rOnCcw ? { start: Q.deg, sweep: 360 - ccw } : { start: P.deg, sweep: ccw }
  const ends: [string, string] = rOnCcw ? [Q.name, P.name] : [P.name, Q.name]
  const centralDeg = arc.sweep
  const inscribedDeg = angleAt(P.pt, R.pt, Q.pt)
  const ct = degText(centralDeg)
  const it = degText(inscribedDeg)
  const ctext = ct.exact ? ct.text : `≈ ${ct.text}`
  const itext = it.exact ? it.text : `≈ ${it.text}`
  const diameter = Math.abs(centralDeg - 180) < 1e-7
  const reflex = centralDeg > 180 + 1e-7
  const ang = `∠${P.name}${R.name}${Q.name}`
  const cang = `∠${P.name}O${Q.name}`
  const relation = diameter
    ? `${P.name}${Q.name} is a diameter, so ${ang} = ½ · 180° = 90°`
    : `${ang} = ½·${cang}: ${itext.replace('≈ ', '')} = ½ · ${ctext.replace('≈ ', '')}`
  const intercepts = `${ang} intercepts arc ${P.name}${Q.name} (${ctext}${reflex ? ', the major arc' : ''})`
  return {
    arc,
    ends,
    central: { deg: centralDeg, text: ctext, reflex },
    inscribed: { deg: inscribedDeg, text: itext },
    diameter,
    relation,
    intercepts,
    centralMark: { at: c.centre, start: arc.start, sweep: arc.sweep },
    inscribedMark: angleMark(R.pt, P.pt, Q.pt),
  }
}

// ---------------------------------------------------------------------------
// The tangent at a point
// ---------------------------------------------------------------------------

export interface TangentReport {
  name: string
  at: Vec2
  line: LineEq
  radiusSlope: SlopeInfo
  /** "OP ⟂ the tangent: their slopes −√3/3 and √3 multiply to −1" */
  reason: string
}

export function tangentAt(c: Circle, P: CirclePoint): TangentReport | null {
  const res = lineRelativeTo('perpendicular', c.centre, P.pt, P.pt)
  if (!res) return null
  const rs = slope(c.centre, P.pt)
  const reason = `O${P.name} ⟂ the tangent: ${perpReason(rs, res.line.slope, `O${P.name}`, 'the tangent')}`
  return { name: P.name, at: P.pt, line: res.line, radiusSlope: rs, reason }
}

// ---------------------------------------------------------------------------
// Arc length and sector area
// ---------------------------------------------------------------------------

export interface ExactValue {
  value: number
  text: string
  tex: string
  exact: boolean
}

const approxOf = (v: number): ExactValue => {
  const t = dec(v, 2)
  return { value: v, text: `≈ ${t}`, tex: `\\approx ${t.replace(MINUS, '-')}`, exact: false }
}

/** c·√k·π as text: "4π", "3π/2", "2√3π/3". */
function surdPi(c: Rat, k: number): ExactValue {
  const value = (c.n / c.d) * Math.sqrt(k) * Math.PI
  if (c.n === 0) return { value: 0, text: '0', tex: '0', exact: true }
  if (k === 1) return { value, ...piText(c), exact: true }
  const neg = c.n < 0 ? MINUS : ''
  const negT = c.n < 0 ? '-' : ''
  const n = Math.abs(c.n)
  const head = `${n === 1 ? '' : n}√${k}π`
  const headT = `${n === 1 ? '' : n}\\sqrt{${k}}\\pi`
  return c.d === 1
    ? { value, text: `${neg}${head}`, tex: `${negT}${headT}`, exact: true }
    : { value, text: `${neg}${head}/${c.d}`, tex: `${negT}\\frac{${headT}}{${c.d}}`, exact: true }
}

export interface SectorReport {
  ends: [string, string]
  /** Counterclockwise from P to Q, in degrees (0, 360). */
  deg: number
  degText: string
  theta: ExactValue
  arc: ExactValue
  area: ExactValue
  /** "s = rθ = 6 · 2π/3 = 4π" */
  arcRadian: string
  /** "A = ½r²θ = ½ · 36 · 2π/3 = 12π" */
  areaRadian: string
  /** "s = (120/360) · 2π · 6 = 4π" */
  arcDegree: string
  /** "A = (120/360) · π · 6² = 12π" */
  areaDegree: string
  /** "θ = s/r = 4π/6 = 2π/3: the radian measure is the arc length per unit of radius" */
  radianDef: string
  start: number
}

export function sectorOf(c: Circle, P: CirclePoint, Q: CirclePoint): SectorReport | { error: string } {
  const deg = (Q.deg - P.deg + 360) % 360
  if (deg < 1e-9) return { error: `${P.name} and ${Q.name} are the same point — the sector needs two different points.` }
  const dt = degText(deg)
  const degT = dt.exact ? dt.text : `≈ ${dt.text}`
  const rad = radiansOf(deg)
  const theta: ExactValue = rad.exact ? { value: rad.value, text: rad.text, tex: rad.tex, exact: true } : approxOf(rad.value)
  const sVal = c.r * rad.value
  const aVal = 0.5 * c.r * c.r * rad.value
  let arc = approxOf(sVal)
  let area = approxOf(aVal)
  if (rad.ofPi && c.rSurd) {
    const sc = ratMul(c.rSurd.c, rad.ofPi)
    if (sc) arc = surdPi(sc, c.rSurd.k)
  }
  if (rad.ofPi && c.r2) {
    const ac = ratMul(ratMul(c.r2, { n: 1, d: 2 }), rad.ofPi)
    if (ac) area = surdPi(ac, 1)
  }
  const r = c.radius.exact ? c.radius.text : `≈ ${c.radius.text}`
  const rBr = /[√/]/.test(r) || r.startsWith('≈') ? `(${r})` : r
  const r2 = c.r2 ? ratText(c.r2) : `≈ ${dec(c.r * c.r, 2)}`
  const degNum = dt.exact ? dt.text.replace('°', '') : dec(deg, 2)
  const show = (v: ExactValue): string => (v.exact ? v.text : v.text)
  const thetaT = theta.exact ? theta.text : dec(theta.value, 3)
  const arcRadian = `s = rθ = ${rBr} · ${thetaT} = ${show(arc)}`
  const areaRadian = `A = ½r²θ = ½ · ${r2} · ${thetaT} = ${show(area)}`
  const arcDegree = `s = (${degNum}/360) · 2π · ${rBr} = ${show(arc)}`
  const areaDegree = `A = (${degNum}/360) · π · ${rBr}² = ${show(area)}`
  const radianDef = arc.exact && theta.exact
    ? `θ = s/r = ${/\//.test(arc.text) ? `(${arc.text})` : arc.text} ÷ ${rBr} = ${theta.text} — the radian measure is the arc length per unit of radius`
    : `θ = s/r ≈ ${dec(sVal / c.r, 3)} — the radian measure is the arc length per unit of radius`
  return { ends: [P.name, Q.name], deg, degText: degT, theta, arc, area, arcRadian, areaRadian, arcDegree, areaDegree, radianDef, start: P.deg }
}

// ---------------------------------------------------------------------------
// Intersecting chords
// ---------------------------------------------------------------------------

export interface ChordsReport {
  E: Vec2
  eText: PointMeasure
  pe: Measure
  eq: Measure
  re: Measure
  es: Measure
  /** PE·EQ = RE·ES = r² − OE², the power of E. */
  product: Measure
  names: [string, string, string, string]
  /** "PE · EQ = 3 · 5 = 15" */
  left: string
  right: string
  /** "both equal r² − OE² = 25 − 10 = 15" */
  power: string
}

/** Where segments ab and cd cross (strictly inside both), or null. */
function crossing(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const rx = b.x - a.x
  const ry = b.y - a.y
  const sx = d.x - c.x
  const sy = d.y - c.y
  const den = rx * sy - ry * sx
  const scale = Math.hypot(rx, ry) * Math.hypot(sx, sy)
  if (!(scale > 0) || Math.abs(den) <= 1e-12 * scale) return null
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den
  if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null
  return { x: a.x + t * rx, y: a.y + t * ry }
}

/** A product of two lengths: exact when both are, else their decimals. */
function times(m: Measure, n: Measure): string {
  return `${m.text} · ${n.text}`
}

/** "= √10 ≈ 3.16", "= 7", "≈ 0.93" — a value after an equation. */
export function eqM(m: Measure): string {
  const w = withApprox(m)
  return w.startsWith('≈') ? w : `= ${w}`
}

/** r² − |OX|², exact when X, the centre and r² are rational. */
function powerOf(c: Circle, X: Vec2): { m: Measure; text: string } {
  const val = c.r * c.r - ((X.x - c.centre.x) ** 2 + (X.y - c.centre.y) ** 2)
  const xr = toRat(X.x)
  const yr = toRat(X.y)
  if (xr && yr && c.hr && c.kr && c.r2) {
    const dx = ratSub(xr, c.hr)
    const dy = ratSub(yr, c.kr)
    const d2 = ratAdd(ratMul(dx, dx), ratMul(dy, dy))
    const p = ratSub(c.r2, d2)
    if (d2 && p) {
      const m = measureOfSurd({ c: p, k: 1 })
      return { m, text: `${ratText(c.r2)} ${MINUS} ${ratText(d2)} = ${m.text}` }
    }
  }
  const m = measureOf(val)
  return { m, text: withApprox(m) }
}

export function chordsCross(c: Circle, P: CirclePoint, Q: CirclePoint, R: CirclePoint, S: CirclePoint): ChordsReport | { error: string } {
  const E = crossing(P.pt, Q.pt, R.pt, S.pt)
  const pq = `${P.name}${Q.name}`
  const rs = `${R.name}${S.name}`
  if (!E) {
    return {
      error: `Chords ${pq} and ${rs} do not cross inside the circle — ${R.name} and ${S.name} are on the same arc ${pq}. Move one of them across ${pq}.`,
    }
  }
  const pe = distance(P.pt, E)
  const eq = distance(E, Q.pt)
  const re = distance(R.pt, E)
  const es = distance(E, S.pt)
  const pw = powerOf(c, E)
  const names: [string, string, string, string] = [P.name, Q.name, R.name, S.name]
  return {
    E,
    eText: coordsOf(E),
    pe,
    eq,
    re,
    es,
    product: pw.m,
    names,
    left: `${P.name}E · E${Q.name} = ${times(pe, eq)} ${eqM(pw.m)}`,
    right: `${R.name}E · E${S.name} = ${times(re, es)} ${eqM(pw.m)}`,
    power: `both equal r² ${MINUS} OE² = ${pw.text}`,
  }
}

// ---------------------------------------------------------------------------
// Tangents from an outside point (and a secant through P)
// ---------------------------------------------------------------------------

export interface TangentsFromReport {
  T: Vec2
  tText: PointMeasure
  /** The points of tangency A and B. */
  A: Vec2
  B: Vec2
  aText: PointMeasure
  bText: PointMeasure
  /** TA = TB = √(OT² − r²) */
  length: Measure
  lengthText: string
  /** A secant from T through P, when one was asked for and P is not a point of tangency. */
  secant: {
    through: string
    P: Vec2
    P2: Vec2
    p2Text: PointMeasure
    tp: Measure
    tp2: Measure
    /** "TA² = TP · TP′: 16 = 2 · 8" */
    text: string
  } | null
}

export function tangentsFrom(c: Circle, T: Vec2, P?: CirclePoint | null): TangentsFromReport | { error: string } {
  const dx = T.x - c.centre.x
  const dy = T.y - c.centre.y
  const d = Math.hypot(dx, dy)
  if (Math.abs(d - c.r) <= 1e-9 * Math.max(1, c.r)) {
    return { error: 'T is on the circle: there is one tangent there (the tangent at a point).' }
  }
  if (d < c.r) return { error: 'T is inside the circle: no tangent line passes through it.' }
  const phi = Math.atan2(dy, dx)
  const alpha = Math.acos(c.r / d)
  const A = { x: c.centre.x + c.r * Math.cos(phi + alpha), y: c.centre.y + c.r * Math.sin(phi + alpha) }
  const B = { x: c.centre.x + c.r * Math.cos(phi - alpha), y: c.centre.y + c.r * Math.sin(phi - alpha) }
  const t2Val = d * d - c.r * c.r
  let length = measureOf(Math.sqrt(t2Val))
  let lengthText = `TA = TB = √(OT² ${MINUS} r²) ${eqM(length)}`
  const tr = toRat(T.x)
  const ur = toRat(T.y)
  if (tr && ur && c.hr && c.kr && c.r2) {
    const ex = ratSub(tr, c.hr)
    const ey = ratSub(ur, c.kr)
    const ot2 = ratAdd(ratMul(ex, ex), ratMul(ey, ey))
    const t2 = ratSub(ot2, c.r2)
    const s = sqrtRat(t2)
    if (ot2 && t2 && s) {
      length = measureOfSurd(s)
      lengthText = `TA = TB = √(OT² ${MINUS} r²) = √(${ratText(ot2)} ${MINUS} ${ratText(c.r2)}) ${eqM(length)}`
    }
  }
  let secant: TangentsFromReport['secant'] = null
  if (P) {
    const vx = P.pt.x - T.x
    const vy = P.pt.y - T.y
    const L2 = vx * vx + vy * vy
    if (L2 > 0) {
      const t2 = t2Val / L2 // product of the roots; t = 1 is P
      if (Math.abs(t2 - 1) > 1e-7) {
        const P2 = { x: T.x + t2 * vx, y: T.y + t2 * vy }
        const tp = distance(T, P.pt)
        const tp2 = distance(T, P2)
        const sq = length.exact ? (toRat(length.value * length.value) ? ratText(toRat(length.value * length.value)!) : dec(t2Val, 2)) : dec(t2Val, 2)
        secant = {
          through: P.name,
          P: P.pt,
          P2,
          p2Text: coordsOf(P2),
          tp,
          tp2,
          text: `TA² = T${P.name} · T${P.name}′: ${sq} = ${times(tp, tp2)}`,
        }
      }
    }
  }
  return { T, tText: coordsOf(T), A, B, aText: coordsOf(A), bText: coordsOf(B), length, lengthText, secant }
}

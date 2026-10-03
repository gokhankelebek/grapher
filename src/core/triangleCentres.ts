// ============================================================================
// src/core/triangleCentres.ts — the four classical centres of a triangle
// (NC Math 2 G-CO.10 "verify experimentally properties of the centers of
// triangles", Math 3 G-CO.14).
//
//   triangleCentres(pts, labels)  → TriangleCentres | null (null: collinear)
//
//   centroid G       where the MEDIANS meet: ((x₁+x₂+x₃)/3, (y₁+y₂+y₃)/3).
//                    Rational whenever the vertices are.
//   circumcentre O   where the PERPENDICULAR BISECTORS of the sides meet; the
//                    centre of the circle through the three vertices. Solved
//                    with fractions, so integer vertices give it exactly.
//                    R = OA, exact as a surd (R² is rational).
//   incentre I       where the ANGLE BISECTORS meet; the centre of the circle
//                    touching the three sides. I = (aA + bB + cC)/(a + b + c)
//                    with a = BC … — irrational in general: exact only when
//                    the closed form is a clean one (1, 4 − 2√2), else a
//                    decimal. r = Area / s, the same rule.
//   orthocentre H    where the ALTITUDES meet: H = A + B + C − 2O, so it is
//                    rational whenever O is. Outside an obtuse triangle; the
//                    right-angle vertex of a right triangle.
//
// The construction (midpoints, feet of the altitudes, where each bisector
// meets the opposite side, where the incircle touches) comes with it, so the
// board can draw the lines each centre is the meeting point of.
//
// Notes are stated only when they are TRUE of this triangle: the right
// triangle's circumcentre at the midpoint of the hypotenuse, the obtuse
// triangle's O and H outside it, the equilateral triangle's four centres in
// one point, the Euler line (O, G, H collinear with HG = 2·GO) whenever O ≠ G.
//
// Pure: no DOM, no React.
// ============================================================================

import type { Vec2 } from './types'
import type { LineEq, Measure, PointMeasure, Rat } from './geometry'
import { spaced } from './circleGeometry'
import {
  angleAt,
  decimalMeasure,
  degText,
  distance,
  lineThrough,
  measureOf,
  measureOfSurd,
  pointMeasure,
  ratAdd,
  ratDiv,
  ratMul,
  ratSub,
  sqrtRat,
  toRat,
  vertexNames,
  withApprox,
} from './geometry'

export type CentreKey = 'centroid' | 'circumcentre' | 'incentre' | 'orthocentre'

/** One centre: where it is, exactly where it can be, and where it lies. */
export interface CentreInfo {
  key: CentreKey
  /** "G", "O", "I", "H" */
  letter: string
  /** "centroid" */
  name: string
  /** The lines that meet there: "medians". */
  lines: string
  pt: PointMeasure
  /** True when both coordinates are exact. */
  exact: boolean
  where: 'inside' | 'on' | 'outside'
}

export interface EulerLine {
  /** The line through O, G and H. */
  line: LineEq
  /** HG and GO, exactly where they can be. */
  hg: Measure
  go: Measure
  /** "HG = 2·GO: 2√5 = 2 · √5" */
  ratioText: string
}

export interface TriangleCentres {
  names: [string, string, string]
  pts: [Vec2, Vec2, Vec2]
  centroid: CentreInfo
  circumcentre: CentreInfo
  incentre: CentreInfo
  orthocentre: CentreInfo
  /** The circumradius R = OA = OB = OC. */
  circumradius: Measure
  /** The inradius r — the distance from I to each side. */
  inradius: Measure
  /** Midpoint of the side OPPOSITE vertex i (BC for A). */
  midpoints: [Vec2, Vec2, Vec2]
  /** Foot of the altitude from vertex i on the LINE of the opposite side. */
  feet: [Vec2, Vec2, Vec2]
  /** True when the foot from vertex i lies off the opposite side (an obtuse triangle). */
  footOutside: [boolean, boolean, boolean]
  /** Where the bisector of the angle at vertex i meets the opposite side. */
  bisectorFeet: [Vec2, Vec2, Vec2]
  /** Where the incircle touches the side opposite vertex i. */
  touch: [Vec2, Vec2, Vec2]
  kind: 'acute' | 'right' | 'obtuse'
  /** The right or obtuse vertex (index), else -1. */
  special: number
  equilateral: boolean
  /** Isosceles (not equilateral): the apex vertex index, else -1. */
  apex: number
  /** The Euler line, when O ≠ G (every triangle but an equilateral one). */
  euler: EulerLine | null
  /** Sentences that are true of THIS triangle. */
  notes: string[]
}

// ---------------------------------------------------------------------------
// exact arithmetic on points
// ---------------------------------------------------------------------------

interface Q {
  x: number
  y: number
  rx: Rat | null
  ry: Rat | null
}
const q = (p: Vec2): Q => ({ x: p.x, y: p.y, rx: toRat(p.x), ry: toRat(p.y) })
const R = (n: number, d = 1): Rat => ({ n, d })

const len = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y)

/** A coordinate from its exact fraction when there is one, else recognised, else a decimal. */
function pm(pt: Vec2, rx: Rat | null, ry: Rat | null): PointMeasure {
  return pointMeasure(pt, rx, ry)
}

/** A point with irrational coordinates: each recognised (4 − 2√2) or a decimal. */
function measuredPoint(pt: Vec2): PointMeasure {
  const x = spaced(measureOf(pt.x))
  const y = spaced(measureOf(pt.y))
  return { pt, x, y, text: `(${x.text}, ${y.text})`, tex: `\\left(${x.tex}, ${y.tex}\\right)` }
}

const exactPt = (p: PointMeasure): boolean => p.x.exact && p.y.exact

/** Barycentric test: inside, on a side, or outside. */
function whereIn(p: Vec2, a: Vec2, b: Vec2, c: Vec2): 'inside' | 'on' | 'outside' {
  const cr = (u: Vec2, v: Vec2, w: Vec2): number => (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x)
  const area = cr(a, b, c)
  const scale = Math.max(1e-12, Math.abs(area))
  const s1 = cr(a, b, p) / scale
  const s2 = cr(b, c, p) / scale
  const s3 = cr(c, a, p) / scale
  const sg = Math.sign(area)
  const vals = [s1 * sg, s2 * sg, s3 * sg]
  const eps = 1e-9
  if (vals.some((v) => v < -eps)) return 'outside'
  if (vals.some((v) => Math.abs(v) <= eps)) return 'on'
  return 'inside'
}

/** The foot of the perpendicular from p to the line uv, and whether it lies off the segment. */
function footOn(p: Vec2, u: Vec2, v: Vec2): { at: Vec2; off: boolean } {
  const dx = v.x - u.x
  const dy = v.y - u.y
  const L2 = dx * dx + dy * dy
  const t = L2 > 0 ? ((p.x - u.x) * dx + (p.y - u.y) * dy) / L2 : 0
  return { at: { x: u.x + t * dx, y: u.y + t * dy }, off: t < -1e-9 || t > 1 + 1e-9 }
}

const CENTRE_TEXT: Record<CentreKey, { letter: string; name: string; lines: string }> = {
  centroid: { letter: 'G', name: 'centroid', lines: 'medians' },
  circumcentre: { letter: 'O', name: 'circumcentre', lines: 'perpendicular bisectors' },
  incentre: { letter: 'I', name: 'incentre', lines: 'angle bisectors' },
  orthocentre: { letter: 'H', name: 'orthocentre', lines: 'altitudes' },
}

export function centreLetter(k: CentreKey): string {
  return CENTRE_TEXT[k].letter
}

function centre(key: CentreKey, pt: PointMeasure, tri: [Vec2, Vec2, Vec2]): CentreInfo {
  const t = CENTRE_TEXT[key]
  return { key, ...t, pt, exact: exactPt(pt), where: whereIn(pt.pt, tri[0], tri[1], tri[2]) }
}

// ---------------------------------------------------------------------------
// the centres
// ---------------------------------------------------------------------------

export function triangleCentres(ptsIn: readonly Vec2[], labels?: readonly string[] | null): TriangleCentres | null {
  if (ptsIn.length !== 3 || !ptsIn.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))) return null
  const [A, B, C] = ptsIn
  const tri: [Vec2, Vec2, Vec2] = [A, B, C]
  const cross = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x)
  const scale = Math.max(len(A, B), len(B, C), len(C, A))
  if (!(scale > 0) || Math.abs(cross) <= 1e-10 * scale * scale) return null
  const names = vertexNames(3, labels) as [string, string, string]
  const [nA, nB, nC] = names
  const qa = q(A)
  const qb = q(B)
  const qc = q(C)
  const rational = !!(qa.rx && qa.ry && qb.rx && qb.ry && qc.rx && qc.ry)

  // ---- centroid
  const G = { x: (A.x + B.x + C.x) / 3, y: (A.y + B.y + C.y) / 3 }
  const third = R(1, 3)
  const gx = rational ? ratMul(ratAdd(ratAdd(qa.rx, qb.rx), qc.rx), third) : null
  const gy = rational ? ratMul(ratAdd(ratAdd(qa.ry, qb.ry), qc.ry), third) : null
  const centroidPm = gx && gy ? pm(G, gx, gy) : measuredPoint(G)

  // ---- circumcentre: D = 2(ax(by − cy) + bx(cy − ay) + cx(ay − by))
  const D = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y))
  const sa = A.x * A.x + A.y * A.y
  const sb = B.x * B.x + B.y * B.y
  const sc = C.x * C.x + C.y * C.y
  const O = {
    x: (sa * (B.y - C.y) + sb * (C.y - A.y) + sc * (A.y - B.y)) / D,
    y: (sa * (C.x - B.x) + sb * (A.x - C.x) + sc * (B.x - A.x)) / D,
  }
  let ox: Rat | null = null
  let oy: Rat | null = null
  let R2: Rat | null = null
  if (rational) {
    const sq = (r: Rat | null) => ratMul(r, r)
    const sA = ratAdd(sq(qa.rx), sq(qa.ry))
    const sB = ratAdd(sq(qb.rx), sq(qb.ry))
    const sC = ratAdd(sq(qc.rx), sq(qc.ry))
    const Dr = ratMul(
      R(2),
      ratAdd(
        ratAdd(ratMul(qa.rx, ratSub(qb.ry, qc.ry)), ratMul(qb.rx, ratSub(qc.ry, qa.ry))),
        ratMul(qc.rx, ratSub(qa.ry, qb.ry)),
      ),
    )
    const nx = ratAdd(ratAdd(ratMul(sA, ratSub(qb.ry, qc.ry)), ratMul(sB, ratSub(qc.ry, qa.ry))), ratMul(sC, ratSub(qa.ry, qb.ry)))
    const ny = ratAdd(ratAdd(ratMul(sA, ratSub(qc.rx, qb.rx)), ratMul(sB, ratSub(qa.rx, qc.rx))), ratMul(sC, ratSub(qb.rx, qa.rx)))
    ox = ratDiv(nx, Dr)
    oy = ratDiv(ny, Dr)
    if (ox && oy) {
      const dx = ratSub(qa.rx, ox)
      const dy = ratSub(qa.ry, oy)
      R2 = ratAdd(ratMul(dx, dx), ratMul(dy, dy))
    }
  }
  const circumPm = ox && oy ? pm(O, ox, oy) : measuredPoint(O)
  const Rval = len(O, A)
  const rs = sqrtRat(R2)
  const circumradius = rs ? measureOfSurd(rs) : measureOf(Rval)

  // ---- orthocentre H = A + B + C − 2O
  const H = { x: A.x + B.x + C.x - 2 * O.x, y: A.y + B.y + C.y - 2 * O.y }
  const two = R(2)
  const hx = rational && ox ? ratSub(ratAdd(ratAdd(qa.rx, qb.rx), qc.rx), ratMul(two, ox)) : null
  const hy = rational && oy ? ratSub(ratAdd(ratAdd(qa.ry, qb.ry), qc.ry), ratMul(two, oy)) : null
  const orthoPm = hx && hy ? pm(H, hx, hy) : measuredPoint(H)

  // ---- incentre (aA + bB + cC)/(a + b + c), a = BC opposite A
  const a = len(B, C)
  const b = len(C, A)
  const c = len(A, B)
  const per = a + b + c
  const I = { x: (a * A.x + b * B.x + c * C.x) / per, y: (a * A.y + b * B.y + c * C.y) / per }
  const inPm = measuredPoint(I)
  const area = Math.abs(cross) / 2
  const rIn = area / (per / 2)
  const inradius = spaced(measureOf(rIn))

  // ---- construction
  const mid = (u: Vec2, v: Vec2): Vec2 => ({ x: (u.x + v.x) / 2, y: (u.y + v.y) / 2 })
  const midpoints: [Vec2, Vec2, Vec2] = [mid(B, C), mid(C, A), mid(A, B)]
  const fA = footOn(A, B, C)
  const fB = footOn(B, C, A)
  const fC = footOn(C, A, B)
  // angle bisector from A meets BC at the point dividing it BD : DC = AB : AC
  const along = (u: Vec2, v: Vec2, t: number): Vec2 => ({ x: u.x + t * (v.x - u.x), y: u.y + t * (v.y - u.y) })
  const bisectorFeet: [Vec2, Vec2, Vec2] = [along(B, C, c / (c + b)), along(C, A, a / (a + c)), along(A, B, b / (b + a))]
  const touch: [Vec2, Vec2, Vec2] = [footOn(I, B, C).at, footOn(I, C, A).at, footOn(I, A, B).at]

  // ---- the triangle's kind
  const angles = [angleAt(C, A, B), angleAt(A, B, C), angleAt(B, C, A)]
  const EPS = 1e-7
  const rightAt = angles.findIndex((d) => Math.abs(d - 90) < EPS)
  const obtuseAt = angles.findIndex((d) => d > 90 + EPS)
  const kind: TriangleCentres['kind'] = rightAt >= 0 ? 'right' : obtuseAt >= 0 ? 'obtuse' : 'acute'
  const special = rightAt >= 0 ? rightAt : obtuseAt
  const relEq = (u: number, v: number): boolean => Math.abs(u - v) <= 1e-9 * Math.max(1, u, v)
  const equilateral = relEq(a, b) && relEq(b, c)
  // apex: the vertex between the two equal sides (side opposite i is the base)
  const apex: number = equilateral ? -1 : relEq(b, c) ? 0 : relEq(c, a) ? 1 : relEq(a, b) ? 2 : -1

  const centroid = centre('centroid', centroidPm, tri)
  const circumcentre = centre('circumcentre', circumPm, tri)
  const incentre = centre('incentre', inPm, tri)
  const orthocentre = centre('orthocentre', orthoPm, tri)

  // ---- the Euler line
  let euler: EulerLine | null = null
  if (!equilateral && len(O, G) > 1e-9 * scale) {
    const go = distance(G, O)
    const hg = distance(H, G)
    const line = lineThrough(O, G)
    const ratioText = `HG = 2·GO: ${go.exact && hg.exact ? `${hg.text} = 2 · ${go.text}` : `${withApprox(hg)} = 2 · ${withApprox(go)}`}`
    euler = { line, hg, go, ratioText }
  }

  // ---- what is true of THIS triangle
  const tri3 = `△${nA}${nB}${nC}`
  const notes: string[] = []
  const side = (i: number): string => {
    const j = (i + 1) % 3
    const k = (i + 2) % 3
    return `${names[j]}${names[k]}`
  }
  if (equilateral) {
    notes.push(`${tri3} is equilateral, so its centroid, circumcentre, incentre and orthocentre are one point, ${centroidPm.text}.`)
  } else if (kind === 'right') {
    const hyp = side(rightAt)
    const hypLen = distance(tri[(rightAt + 1) % 3], tri[(rightAt + 2) % 3])
    notes.push(
      `${tri3} is right-angled at ${names[rightAt]}, so the circumcentre O is the midpoint of the hypotenuse ${hyp} and R = ${hyp}/2 = ${circumradius.text}${hypLen.exact ? '' : ' (approximately)'}.`,
    )
    notes.push(`The orthocentre H is the right-angle vertex ${names[rightAt]}: two of the altitudes are the legs.`)
  } else if (kind === 'obtuse') {
    notes.push(
      `${tri3} is obtuse at ${names[obtuseAt]} (${degText(angles[obtuseAt]).text}), so the circumcentre O and the orthocentre H lie outside the triangle.`,
    )
  } else {
    notes.push(`${tri3} is acute, so all four centres lie inside it.`)
  }
  if (apex >= 0) {
    notes.push(
      `${tri3} is isosceles (${names[apex]}${names[(apex + 1) % 3]} = ${names[apex]}${names[(apex + 2) % 3]}): G, O, I and H all lie on its line of symmetry, through ${names[apex]} and the midpoint of ${side(apex)}.`,
    )
  }
  return {
    names,
    pts: tri,
    centroid,
    circumcentre,
    incentre,
    orthocentre,
    circumradius,
    inradius,
    midpoints,
    feet: [fA.at, fB.at, fC.at],
    footOutside: [fA.off, fB.off, fC.off],
    bisectorFeet,
    touch,
    kind,
    special,
    equilateral,
    apex,
    euler,
    notes,
  }
}

/** "inside", "on a side of", "outside" — for running text. */
export function whereWords(w: CentreInfo['where']): string {
  return w === 'inside' ? 'inside' : w === 'on' ? 'on a side of' : 'outside'
}

/** A point on the triangle's boundary: "at vertex A", "on side BC". */
function onWhat(t: TriangleCentres, p: Vec2): string {
  const scale = Math.max(len(t.pts[0], t.pts[1]), len(t.pts[1], t.pts[2]), len(t.pts[2], t.pts[0]))
  const v = t.pts.findIndex((q) => len(q, p) <= 1e-9 * scale)
  if (v >= 0) return `at vertex ${t.names[v]}`
  for (let i = 0; i < 3; i++) {
    const a = t.pts[i]
    const b = t.pts[(i + 1) % 3]
    if (Math.abs(len(a, p) + len(p, b) - len(a, b)) <= 1e-9 * scale) return `on side ${t.names[i]}${t.names[(i + 1) % 3]}`
  }
  return `on a side of △${t.names.join('')}`
}

/** "= √10 ≈ 3.16", "= 5", "≈ 0.93" — a measure after its name. */
export function eqMeasure(m: Measure): string {
  const w = withApprox(m)
  return w.startsWith('≈') ? w : `= ${w}`
}

/** What each centre's card line says about it, beyond its coordinates. */
export function centreFacts(t: TriangleCentres, key: CentreKey): string[] {
  const [nA, nB, nC] = t.names
  const tri = `△${nA}${nB}${nC}`
  const c = t[key]
  const out: string[] = []
  const pos = c.where === 'inside' ? `inside ${tri}` : c.where === 'on' ? onWhat(t, c.pt.pt) : `outside ${tri}`
  switch (key) {
    case 'centroid':
      out.push(`The medians meet at G, ${pos}.`)
      out.push(`G is two-thirds of the way along each median from its vertex: ${nA}G = 2·GM.`)
      break
    case 'circumcentre':
      out.push(`The perpendicular bisectors meet at O, ${pos}.`)
      out.push(`O is equidistant from the vertices: O${nA} = O${nB} = O${nC} = R = ${withApprox(t.circumradius)}.`)
      break
    case 'incentre':
      out.push(`The angle bisectors meet at I, ${pos}.`)
      out.push(`I is equidistant from the sides: r ${eqMeasure(t.inradius)} (r = Area ÷ s).`)
      break
    case 'orthocentre':
      out.push(`The altitudes${t.kind === 'obtuse' ? ', extended,' : ''} meet at H, ${pos}.`)
      break
  }
  return out
}

/** A coordinate pair's decimal, for the "≈" beside an inexact centre. */
export function approxPoint(p: PointMeasure): string {
  const d = (v: number) => decimalMeasure(v).text
  return `(${d(p.pt.x)}, ${d(p.pt.y)})`
}

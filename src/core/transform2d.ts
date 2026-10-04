// ============================================================================
// src/core/transform2d.ts — transformations of FIGURES in the plane, worked
// the way an NC Math 2 class works them (G-CO.2–8, G-SRT.1–3, F-IF.1–2).
//
//   A transformation is a function whose domain and range are points:
//
//     translate ⟨a, b⟩            (x, y) → (x + a, y + b)
//     reflect across a line       x-axis, y-axis, y = x, y = −x, x = k, y = k,
//                                 or any line (two points, y = mx + b)
//     rotate θ about a point      exact for 90°, 180°, 270° and the special
//                                 angles; cos θ / sin θ written out otherwise
//     dilate by k about a point   k may be negative or a fraction
//
//   motionAffine(m)              the map as x' = ax + by + e, y' = cx + dy + f
//   composeMotions(list)         a sequence: its single rule, and what it is
//   motionName / motionRule      textbook notation: R_{90°, O}: (x, y) → (−y, x)
//   classifyAffine / identify    rigid or not, orientation, which motion
//   findMotion(P, Q)             figure → image (with A → A′): the motion
//   compareFigures(P, Q)         the same, trying every correspondence
//   symmetryOf(pts)              lines of symmetry, rotation order and angles
//   compareTriangles(P, Q)       SSS, SAS, ASA, AAS, HL; AA, SAS~, SSS~
//   criterionFromGivens(g)       which criterion a set of given parts is —
//                                and that SSA is not one
//   preservedChecks(P, Q, …)     lengths, angles, parallelism: ✓ or ✗
//
// HOW IT STAYS EXACT. Coordinates a class types are fractions; the images
// under translations, reflections in lines through rational points, quarter
// turns and rational dilations are fractions too, so every image coordinate is
// snapped back to the fraction it is (`clean`) and printed exactly. Rotations
// by 30°, 45°, 60° … use the exact values of cos and sin, so a 45° image reads
// (2√2, 2√2), recognised as a surd. Anything else is a decimal and says so.
//
// Pure: no DOM, no React, no canvas.
// ============================================================================

import type { Vec2 } from './types'
import type { AngleInfo, Measure } from './geometry'
import {
  MINUS,
  coefTex,
  dec,
  distance,
  needsBrackets,
  interiorAngles,
  lineThrough,
  measureOf,
  pointText,
  polygonReport,
  relation,
  signedArea2,
  toRat,
  vertexNames,
} from './geometry'

// ---------------------------------------------------------------------------
// Affine maps
// ---------------------------------------------------------------------------

/** x' = a·x + b·y + e,  y' = c·x + d·y + f */
export interface Affine {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

/**
 * Snap a computed value back to the fraction it is (small denominators), else
 * leave it. Only rounding is removed: the match has to be within RAT_TOL
 * (1e-12, relative) — what a few floating-point steps can be off by — so an
 * irrational image coordinate is never moved onto a nearby fraction (the
 * 4.180633150012 of a 28° turn once became 2245/537, three billionths away).
 */
export function clean(v: number): number {
  if (!Number.isFinite(v)) return v
  if (Math.abs(v) < 1e-12) return 0
  const r = toRat(v, 1000)
  return r ? r.n / r.d : v
}

export function applyAffine(A: Affine, p: Vec2): Vec2 {
  return { x: clean(A.a * p.x + A.b * p.y + A.e), y: clean(A.c * p.x + A.d * p.y + A.f) }
}

/** `then` after `first`: p ↦ then(first(p)). */
export function composeAffine(first: Affine, then: Affine): Affine {
  return {
    a: clean(then.a * first.a + then.b * first.c),
    b: clean(then.a * first.b + then.b * first.d),
    c: clean(then.c * first.a + then.d * first.c),
    d: clean(then.c * first.b + then.d * first.d),
    e: clean(then.a * first.e + then.b * first.f + then.e),
    f: clean(then.c * first.e + then.d * first.f + then.f),
  }
}

export const det = (A: Affine): number => A.a * A.d - A.b * A.c

// ---------------------------------------------------------------------------
// The motions
// ---------------------------------------------------------------------------

/** A mirror line, in the forms a class names them. */
export type Mirror =
  | { kind: 'x-axis' }
  | { kind: 'y-axis' }
  | { kind: 'y=x' }
  | { kind: 'y=-x' }
  | { kind: 'x=k'; k: number }
  | { kind: 'y=k'; k: number }
  /** Any other line: through p and q (two distinct points). */
  | { kind: 'line'; p: Vec2; q: Vec2 }

export type Motion =
  | { kind: 'identity' }
  | { kind: 'translate'; v: Vec2 }
  | { kind: 'reflect'; line: Mirror }
  /** Reflect across `line`, then translate by `v` along it. */
  | { kind: 'glide'; line: Mirror; v: Vec2 }
  /** Counterclockwise for a positive angle. */
  | { kind: 'rotate'; deg: number; center: Vec2 }
  | { kind: 'dilate'; k: number; center: Vec2 }

const ORIGIN: Vec2 = { x: 0, y: 0 }
const isOrigin = (p: Vec2): boolean => Math.abs(p.x) < 1e-12 && Math.abs(p.y) < 1e-12

/** cos and sin of a whole-degree angle — exact at the special angles. */
export function cosSinDeg(deg: number): { c: number; s: number; exact: boolean } {
  const d = ((deg % 360) + 360) % 360
  const r3 = Math.sqrt(3) / 2
  const r2 = Math.SQRT1_2
  const TABLE: Record<number, [number, number]> = {
    0: [1, 0], 30: [r3, 0.5], 45: [r2, r2], 60: [0.5, r3], 90: [0, 1], 120: [-0.5, r3], 135: [-r2, r2],
    150: [-r3, 0.5], 180: [-1, 0], 210: [-r3, -0.5], 225: [-r2, -r2], 240: [-0.5, -r3], 270: [0, -1],
    300: [0.5, -r3], 315: [r2, -r2], 330: [r3, -0.5],
  }
  const key = Math.round(d * 1e9) / 1e9
  const hit = TABLE[key]
  if (hit) return { c: hit[0], s: hit[1], exact: true }
  const t = (d * Math.PI) / 180
  return { c: Math.cos(t), s: Math.sin(t), exact: false }
}

/** A point and a unit direction along a mirror line. */
export function mirrorFrame(m: Mirror): { p: Vec2; u: Vec2 } {
  switch (m.kind) {
    case 'x-axis':
      return { p: ORIGIN, u: { x: 1, y: 0 } }
    case 'y-axis':
      return { p: ORIGIN, u: { x: 0, y: 1 } }
    case 'y=x':
      return { p: ORIGIN, u: { x: Math.SQRT1_2, y: Math.SQRT1_2 } }
    case 'y=-x':
      return { p: ORIGIN, u: { x: Math.SQRT1_2, y: -Math.SQRT1_2 } }
    case 'x=k':
      return { p: { x: m.k, y: 0 }, u: { x: 0, y: 1 } }
    case 'y=k':
      return { p: { x: 0, y: m.k }, u: { x: 1, y: 0 } }
    case 'line': {
      const dx = m.q.x - m.p.x
      const dy = m.q.y - m.p.y
      const L = Math.hypot(dx, dy) || 1
      return { p: m.p, u: { x: dx / L, y: dy / L } }
    }
  }
}

/** The reflection across a line, with rational coefficients when the line has them. */
export function mirrorAffine(m: Mirror): Affine {
  switch (m.kind) {
    case 'x-axis':
      return { a: 1, b: 0, c: 0, d: -1, e: 0, f: 0 }
    case 'y-axis':
      return { a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 }
    case 'y=x':
      return { a: 0, b: 1, c: 1, d: 0, e: 0, f: 0 }
    case 'y=-x':
      return { a: 0, b: -1, c: -1, d: 0, e: 0, f: 0 }
    case 'x=k':
      return { a: -1, b: 0, c: 0, d: 1, e: clean(2 * m.k), f: 0 }
    case 'y=k':
      return { a: 1, b: 0, c: 0, d: -1, e: 0, f: clean(2 * m.k) }
    case 'line': {
      // cos 2θ = (dx² − dy²)/(dx² + dy²), sin 2θ = 2dx·dy/(dx² + dy²): rational
      // whenever the two points are.
      const dx = m.q.x - m.p.x
      const dy = m.q.y - m.p.y
      const L2 = dx * dx + dy * dy
      if (!(L2 > 0)) return IDENTITY
      const c2 = clean((dx * dx - dy * dy) / L2)
      const s2 = clean((2 * dx * dy) / L2)
      const { x: px, y: py } = m.p
      return {
        a: c2,
        b: s2,
        c: s2,
        d: clean(-c2),
        e: clean(px - c2 * px - s2 * py),
        f: clean(py - s2 * px + c2 * py),
      }
    }
  }
}

export function motionAffine(m: Motion): Affine {
  switch (m.kind) {
    case 'identity':
      return IDENTITY
    case 'translate':
      return { a: 1, b: 0, c: 0, d: 1, e: clean(m.v.x), f: clean(m.v.y) }
    case 'reflect':
      return mirrorAffine(m.line)
    case 'glide': {
      const r = mirrorAffine(m.line)
      return { ...r, e: clean(r.e + m.v.x), f: clean(r.f + m.v.y) }
    }
    case 'rotate': {
      const { c, s } = cosSinDeg(m.deg)
      const { x: h, y: k } = m.center
      return { a: c, b: -s, c: s, d: c, e: clean(h - c * h + s * k), f: clean(k - s * h - c * k) }
    }
    case 'dilate': {
      const { x: h, y: k } = m.center
      return { a: m.k, b: 0, c: 0, d: m.k, e: clean((1 - m.k) * h), f: clean((1 - m.k) * k) }
    }
  }
}

export function applyMotion(m: Motion, p: Vec2): Vec2 {
  return applyAffine(motionAffine(m), p)
}

/** The affine map of a sequence, applied left to right (the first motion first). */
export function sequenceAffine(list: readonly Motion[]): Affine {
  let A = IDENTITY
  for (const m of list) A = composeAffine(A, motionAffine(m))
  return A
}

// ---------------------------------------------------------------------------
// Numbers, written exactly
// ---------------------------------------------------------------------------

export interface NumForm {
  value: number
  /** "1/2", "√2/2", "−3", or a decimal "0.940" */
  text: string
  tex: string
  exact: boolean
}

/** A number, exactly where it can be: fraction, surd, recognised form, else 3 decimals. */
export function numForm(v: number): NumForm {
  const c = clean(v)
  if (!Number.isFinite(c)) return { value: c, text: '—', tex: '\\text{—}', exact: false }
  const m = measureOf(c)
  if (m.exact) return { value: c, text: m.text, tex: m.tex, exact: true }
  const t = dec(c, 3)
  return { value: c, text: t, tex: t.replace(MINUS, '-'), exact: false }
}

/** Degrees as a class writes them: "90°", "−45°", "22.5°". */
export function degreeText(deg: number): { text: string; tex: string } {
  const r = Math.round(deg * 1e6) / 1e6
  const s = Number.isInteger(r) ? String(Math.abs(r)) : dec(Math.abs(r), 2)
  const neg = r < 0
  return { text: `${neg ? MINUS : ''}${s}°`, tex: `${neg ? '-' : ''}${s}^\\circ` }
}

/**
 * "(1, 1)", "(√3, 1/2)", "≈ (0.197, 1.4)" — a point, exact where it is and
 * marked "≈" where a coordinate had to be rounded (to 3 places, so a centre
 * at 0.1968 is not printed as a clean-looking 0.2).
 */
export function pointForm(p: Vec2): { text: string; tex: string; exact: boolean } {
  const x = numForm(p.x)
  const y = numForm(p.y)
  const exact = x.exact && y.exact
  return {
    text: `${exact ? '' : '≈ '}(${x.text}, ${y.text})`,
    tex: `${exact ? '' : '\\approx '}(${x.tex}, ${y.tex})`,
    exact,
  }
}

/** "(1, 1)" / "O" — a centre, as a subscript names it. */
export function centreName(p: Vec2): { text: string; tex: string } {
  if (isOrigin(p)) return { text: 'O', tex: 'O' }
  const t = pointForm(p)
  return { text: t.text, tex: t.tex }
}

/** "the origin" / "(1, 1)" — a centre, as a sentence says it. */
export function centreWords(p: Vec2): string {
  return isOrigin(p) ? 'the origin' : pointForm(p).text
}

// ---------------------------------------------------------------------------
// Linear expressions: "2x − y + 3"
// ---------------------------------------------------------------------------

interface Piece {
  neg: boolean
  text: string
  tex: string
  exact: boolean
}

/** One term c·v (v '' for a constant), or null when it is zero. */
function piece(c: number, v: string): Piece | null {
  const cc = clean(c)
  if (Math.abs(cc) < 1e-12) return null
  const neg = cc < 0
  const m = numForm(Math.abs(cc))
  if (v === '') return { neg, text: m.text, tex: m.tex, exact: m.exact }
  if (m.exact && Math.abs(m.value - 1) < 1e-12) return { neg, text: v, tex: v, exact: true }
  // a fraction gets brackets, and so does a SUM: (1 + √2)x, never 1 + √2x;
  // a decimal is a single number and goes bare (the rule says ≈ instead)
  const wrap = m.exact && needsBrackets(m.text)
  return { neg, text: wrap ? `(${m.text})${v}` : `${m.text}${v}`, tex: `${m.exact ? coefTex(m.tex) : m.tex}${v}`, exact: m.exact }
}

function joinPieces(list: readonly (Piece | null)[]): { text: string; tex: string; exact: boolean } {
  const ps = list.filter((p): p is Piece => p !== null)
  if (ps.length === 0) return { text: '0', tex: '0', exact: true }
  let text = ''
  let tex = ''
  ps.forEach((p, i) => {
    if (i === 0) {
      text += `${p.neg ? MINUS : ''}${p.text}`
      tex += `${p.neg ? '-' : ''}${p.tex}`
    } else {
      text += ` ${p.neg ? MINUS : '+'} ${p.text}`
      tex += ` ${p.neg ? '-' : '+'} ${p.tex}`
    }
  })
  return { text, tex, exact: ps.every((p) => p.exact) }
}

/** A mapping rule in textbook form. */
export interface Rule {
  /** "(x, y) → (−y, x)" */
  text: string
  tex: string
  /** The two coordinates of the image: "−y", "x". */
  x: string
  y: string
  /** False when a coefficient had to be written as a decimal. */
  exact: boolean
}

/** The rule of any affine map, coefficients exact where they can be. */
export function ruleOfAffine(A: Affine): Rule {
  const X = joinPieces([piece(A.a, 'x'), piece(A.b, 'y'), piece(A.e, '')])
  const Y = joinPieces([piece(A.c, 'x'), piece(A.d, 'y'), piece(A.f, '')])
  // decimal coefficients are rounded: the rule says so
  const approx = !(X.exact && Y.exact)
  return {
    text: `(x, y) → ${approx ? '≈ ' : ''}(${X.text}, ${Y.text})`,
    tex: `(x, y) \\to ${approx ? '\\approx ' : ''}\\left(${X.tex},\\ ${Y.tex}\\right)`,
    x: X.text,
    y: Y.text,
    exact: X.exact && Y.exact,
  }
}

/** "(x − 1)", "(y + 2)", "x" */
function shifted(v: string, h: number): { text: string; tex: string } {
  if (Math.abs(h) < 1e-12) return { text: v, tex: v }
  const m = numForm(Math.abs(h))
  // a sum subtracted keeps its own brackets: (x − (1 + √2)), not (x − 1 + √2)
  const sum = m.exact && /.[−+]/.test(m.text.replace(/^\(/, '')) && !/^\(.*\)\/\d+$/.test(m.text)
  const mt = sum ? `(${m.text})` : m.text
  const mtex = sum ? `\\left(${m.tex}\\right)` : m.tex
  return h > 0
    ? { text: `(${v} ${MINUS} ${mt})`, tex: `(${v} - ${mtex})` }
    : { text: `(${v} + ${m.text})`, tex: `(${v} + ${m.tex})` }
}

/** A rotation by an angle with no exact cosine: cos θ and sin θ written out. */
function trigRule(deg: number, center: Vec2): Rule {
  const t = degreeText(Math.abs(deg))
  const cw = deg < 0
  const sx = shifted('x', center.x)
  const sy = shifted('y', center.y)
  const cos = { text: `cos ${t.text}`, tex: `\\cos ${t.tex}` }
  const sin = { text: `sin ${t.text}`, tex: `\\sin ${t.tex}` }
  const tail = (h: number): { text: string; tex: string } => {
    if (Math.abs(h) < 1e-12) return { text: '', tex: '' }
    const m = numForm(Math.abs(h))
    return { text: ` ${h < 0 ? MINUS : '+'} ${m.text}`, tex: ` ${h < 0 ? '-' : '+'} ${m.tex}` }
  }
  // ccw: x' = sx·cos − sy·sin, y' = sx·sin + sy·cos; cw flips the sin terms.
  const X = {
    text: `${sx.text} ${cos.text} ${cw ? '+' : MINUS} ${sy.text} ${sin.text}${tail(center.x).text}`,
    tex: `${sx.tex}${cos.tex} ${cw ? '+' : '-'} ${sy.tex}${sin.tex}${tail(center.x).tex}`,
  }
  const Y = {
    text: `${cw ? MINUS : ''}${sx.text} ${sin.text} + ${sy.text} ${cos.text}${tail(center.y).text}`,
    tex: `${cw ? '-' : ''}${sx.tex}${sin.tex} + ${sy.tex}${cos.tex}${tail(center.y).tex}`,
  }
  return {
    text: `(x, y) → (${X.text}, ${Y.text})`,
    tex: `(x, y) \\to \\left(${X.tex},\\ ${Y.tex}\\right)`,
    x: X.text,
    y: Y.text,
    exact: true,
  }
}

export function motionRule(m: Motion): Rule {
  if (m.kind === 'rotate' && !cosSinDeg(m.deg).exact) return trigRule(m.deg, m.center)
  return ruleOfAffine(motionAffine(m))
}

// ---------------------------------------------------------------------------
// Names and words
// ---------------------------------------------------------------------------

export interface Notation {
  text: string
  tex: string
}

/** "y = x", "x-axis", "y = (1/2)x + 1" — a mirror line, as it is said. */
export function mirrorText(m: Mirror): Notation {
  switch (m.kind) {
    case 'x-axis':
      return { text: 'x-axis', tex: 'x\\text{-axis}' }
    case 'y-axis':
      return { text: 'y-axis', tex: 'y\\text{-axis}' }
    case 'y=x':
      return { text: 'y = x', tex: 'y = x' }
    case 'y=-x':
      return { text: `y = ${MINUS}x`, tex: 'y = -x' }
    case 'x=k': {
      const k = numForm(m.k)
      return { text: `x = ${k.text}`, tex: `x = ${k.tex}` }
    }
    case 'y=k': {
      const k = numForm(m.k)
      return { text: `y = ${k.text}`, tex: `y = ${k.tex}` }
    }
    case 'line': {
      const L = lineThrough(m.p, m.q)
      return { text: L.slopeIntercept.text, tex: L.slopeIntercept.tex }
    }
  }
}

/** The subscript a mirror line gets in r_{…}: spaces out. */
function mirrorSub(m: Mirror): Notation {
  const t = mirrorText(m)
  return { text: t.text.replace(/\s+/g, ''), tex: t.tex.replace(/\s+/g, '') }
}

function vecName(v: Vec2): Notation {
  const x = numForm(v.x)
  const y = numForm(v.y)
  const ap = x.exact && y.exact ? '' : '≈ '
  return { text: `${ap}⟨${x.text}, ${y.text}⟩`, tex: `${ap ? '\\approx ' : ''}\\langle ${x.tex}, ${y.tex}\\rangle` }
}

/** Textbook notation: T_{⟨3, −2⟩}, r_{y-axis}, R_{90°, O}, D_{2, O}. */
export function motionName(m: Motion): Notation {
  switch (m.kind) {
    case 'identity':
      return { text: 'I', tex: 'I' }
    case 'translate': {
      const v = vecName(m.v)
      return { text: `T_{${v.text}}`, tex: `T_{${v.tex}}` }
    }
    case 'reflect': {
      const s = mirrorSub(m.line)
      return { text: `r_{${s.text}}`, tex: `r_{${s.tex}}` }
    }
    case 'glide': {
      const s = mirrorSub(m.line)
      const v = vecName(m.v)
      return { text: `T_{${v.text}} ∘ r_{${s.text}}`, tex: `T_{${v.tex}} \\circ r_{${s.tex}}` }
    }
    case 'rotate': {
      const a = degreeText(m.deg)
      const c = centreName(m.center)
      return { text: `R_{${a.text}, ${c.text}}`, tex: `R_{${a.tex},\\,${c.tex}}` }
    }
    case 'dilate': {
      const k = numForm(m.k)
      const c = centreName(m.center)
      return { text: `D_{${k.text}, ${c.text}}`, tex: `D_{${k.tex},\\,${c.tex}}` }
    }
  }
}

/** "3 units right and 2 units down" */
function shiftWords(v: Vec2): string {
  const part = (n: number, pos: string, neg: string): string | null => {
    if (Math.abs(n) < 1e-12) return null
    const m = numForm(Math.abs(n))
    // "1 unit", "1/2 unit", "3 units": plural only past one
    const one = Math.abs(n) <= 1 + 1e-12
    return `${m.exact ? '' : '≈ '}${m.text} unit${one ? '' : 's'} ${n > 0 ? pos : neg}`
  }
  const parts = [part(v.x, 'right', 'left'), part(v.y, 'up', 'down')].filter((p): p is string => p !== null)
  return parts.length === 0 ? 'nowhere' : parts.join(' and ')
}

/** "a rotation of 90° counterclockwise about the origin" */
export function motionWords(m: Motion): string {
  switch (m.kind) {
    case 'identity':
      return 'the identity (every point stays where it is)'
    case 'translate':
      return `a translation ${shiftWords(m.v)} (by ${vecName(m.v).text})`
    case 'reflect':
      return `a reflection across ${mirrorPhrase(m.line)}`
    case 'glide':
      return `a glide reflection: a reflection across ${mirrorPhrase(m.line)}, then a translation by ${vecName(m.v).text} along it`
    case 'rotate': {
      const a = degreeText(Math.abs(m.deg)).text
      const dir = Math.abs(Math.abs(((m.deg % 360) + 360) % 360) - 180) < 1e-9 ? '' : m.deg < 0 ? ' clockwise' : ' counterclockwise'
      return `a rotation of ${a}${dir} about ${centreWords(m.center)}`
    }
    case 'dilate': {
      const k = numForm(m.k)
      const what = Math.abs(m.k) > 1 ? 'an enlargement' : Math.abs(m.k) < 1 ? 'a reduction' : 'a dilation'
      return `a dilation with scale factor ${k.text} centred at ${centreWords(m.center)} (${what}${m.k < 0 ? ' through the centre' : ''})`
    }
  }
}

/** "the y-axis", "the line y = x" */
export function mirrorPhrase(m: Mirror): string {
  if (m.kind === 'x-axis') return 'the x-axis'
  if (m.kind === 'y-axis') return 'the y-axis'
  return `the line ${mirrorText(m).text}`
}

// ---------------------------------------------------------------------------
// What a map is
// ---------------------------------------------------------------------------

export interface AffineClass {
  /** Distances are preserved (an isometry). */
  rigid: boolean
  /** Shape is preserved: distances are all multiplied by one factor. */
  similarity: boolean
  /** That factor (1 for a rigid motion); NaN when not a similarity. */
  scale: number
  /** True when orientation (counterclockwise order) is kept. */
  preservesOrientation: boolean
}

const near = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b))

export function classifyAffine(A: Affine): AffineClass {
  const s1 = A.a * A.a + A.c * A.c
  const s2 = A.b * A.b + A.d * A.d
  const dot = A.a * A.b + A.c * A.d
  const similarity = near(s1, s2) && Math.abs(dot) <= 1e-9 * Math.max(1, s1) && s1 > 1e-18
  const scale = similarity ? Math.sqrt(s1) : NaN
  return {
    similarity,
    rigid: similarity && near(scale, 1),
    scale,
    preservesOrientation: det(A) > 0,
  }
}

/** A mirror from a point on it and a direction, in its plainest name. */
export function mirrorFrom(p: Vec2, u: Vec2): Mirror {
  const L = Math.hypot(u.x, u.y)
  const ux = u.x / L
  const uy = u.y / L
  if (Math.abs(ux) < 1e-9) {
    const k = clean(p.x)
    return k === 0 ? { kind: 'y-axis' } : { kind: 'x=k', k }
  }
  if (Math.abs(uy) < 1e-9) {
    const k = clean(p.y)
    return k === 0 ? { kind: 'x-axis' } : { kind: 'y=k', k }
  }
  const m = clean(uy / ux)
  const b = clean(p.y - m * p.x)
  if (b === 0 && m === 1) return { kind: 'y=x' }
  if (b === 0 && m === -1) return { kind: 'y=-x' }
  // Two clean points on it: the y-intercept and one unit along x.
  return { kind: 'line', p: { x: 0, y: b }, q: { x: 1, y: clean(b + m) } }
}

/** Solve [[a, b], [c, d]]·(x, y) = (e, f); null when singular. */
function solve2(a: number, b: number, c: number, d: number, e: number, f: number): Vec2 | null {
  const D = a * d - b * c
  if (Math.abs(D) < 1e-12) return null
  return { x: clean((e * d - b * f) / D), y: clean((a * f - e * c) / D) }
}

/**
 * The plainest description of a map: one motion when it is one (identity,
 * translation, rotation, reflection, glide reflection, dilation), or a
 * dilation followed by a rigid motion about the same centre (a similarity).
 * Null when it is not a similarity at all.
 */
export function identify(A: Affine): Motion[] | null {
  const k = classifyAffine(A)
  if (!k.similarity) return null
  const t = { x: A.e, y: A.f }
  if (k.preservesOrientation) {
    const deg = cleanDeg((Math.atan2(A.c, A.a) * 180) / Math.PI)
    if (k.rigid) {
      if (deg === 0) {
        return Math.hypot(t.x, t.y) < 1e-9 ? [{ kind: 'identity' }] : [{ kind: 'translate', v: { x: clean(t.x), y: clean(t.y) } }]
      }
      const c = solve2(1 - A.a, -A.b, -A.c, 1 - A.d, t.x, t.y)
      return c ? [{ kind: 'rotate', deg, center: c }] : null
    }
    // a direct similarity: A = s·R + t has one fixed point
    const c = solve2(1 - A.a, -A.b, -A.c, 1 - A.d, t.x, t.y)
    if (!c) return null
    const s = clean(k.scale)
    if (deg === 0) return [{ kind: 'dilate', k: s, center: c }]
    if (deg === 180) return [{ kind: 'dilate', k: -s, center: c }]
    return [
      { kind: 'dilate', k: s, center: c },
      { kind: 'rotate', deg, center: c },
    ]
  }
  // orientation-reversing: linear part s·[[cos 2θ, sin 2θ], [sin 2θ, −cos 2θ]]
  const s = k.scale
  const twoTheta = Math.atan2(A.c / s, A.a / s)
  const u = { x: Math.cos(twoTheta / 2), y: Math.sin(twoTheta / 2) }
  if (k.rigid) {
    const along = t.x * u.x + t.y * u.y
    const par = { x: clean(along * u.x), y: clean(along * u.y) }
    const perp = { x: t.x - par.x, y: t.y - par.y }
    const line = mirrorFrom({ x: perp.x / 2, y: perp.y / 2 }, u)
    if (Math.hypot(par.x, par.y) < 1e-9) return [{ kind: 'reflect', line }]
    return [{ kind: 'glide', line, v: par }]
  }
  // an opposite similarity: one fixed point c = s·Q(c) + t
  const c = solve2(1 - A.a, -A.b, -A.c, 1 - A.d, t.x, t.y)
  if (!c) return null
  return [
    { kind: 'dilate', k: clean(s), center: c },
    { kind: 'reflect', line: mirrorFrom(c, u) },
  ]
}

/** An angle in (−180, 180], snapped to a whole or half degree when it is one. */
function cleanDeg(d: number): number {
  let x = d
  while (x <= -180) x += 360
  while (x > 180) x -= 360
  const r = Math.round(x * 2) / 2
  if (Math.abs(x - r) < 1e-7) x = r
  if (Object.is(x, -0)) x = 0
  return x
}

/** The name of a sequence, written as a composition: last ∘ … ∘ first. */
export function sequenceName(list: readonly Motion[]): Notation {
  if (list.length === 0) return { text: 'I', tex: 'I' }
  const names = list.map(motionName).reverse()
  return { text: names.map((n) => n.text).join(' ∘ '), tex: names.map((n) => n.tex).join(' \\circ ') }
}

/** "a rotation …, then a reflection …" */
export function sequenceWords(list: readonly Motion[]): string {
  if (list.length === 0) return 'nothing'
  return list.map(motionWords).join(', then ')
}

export interface Composite {
  affine: Affine
  /** "r_{y=x} ∘ R_{90°, O}" — applied right to left. */
  name: Notation
  /** The motions in the order they are done. */
  steps: string
  rule: Rule
  /** What the whole sequence amounts to, when it is one motion (or a similarity). */
  single: Motion[] | null
  /** "a reflection across the x-axis" */
  singleWords: string | null
  rigid: boolean
  preservesOrientation: boolean
}

export function composeMotions(list: readonly Motion[]): Composite {
  const A = sequenceAffine(list)
  const k = classifyAffine(A)
  const single = identify(A)
  return {
    affine: A,
    name: sequenceName(list),
    steps: sequenceWords(list),
    rule: list.length === 1 ? motionRule(list[0]) : ruleOfAffine(A),
    single,
    singleWords: single ? sequenceWords(single) : null,
    rigid: k.rigid,
    preservesOrientation: k.preservesOrientation,
  }
}

// ---------------------------------------------------------------------------
// Names with primes
// ---------------------------------------------------------------------------

const PRIMES = ['′', '″', '‴']
const SUB_DIGITS = '₀₁₂₃₄₅₆₇₈₉'
const SUP_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹'
const toSub = (n: number): string => String(n).split('').map((d) => SUB_DIGITS[Number(d)]).join('')
const fromSub = (s: string): number => Number(s.split('').map((c) => SUB_DIGITS.indexOf(c)).join(''))
const toSup = (n: number): string => String(n).split('').map((d) => SUP_DIGITS[Number(d)]).join('')
const fromSup = (s: string): number => Number(s.split('').map((c) => SUP_DIGITS.indexOf(c)).join(''))

/** A label as base + prime mark + subscript: "A", "′", "₂". */
const LABEL_RE = /^(.*?)([′″‴]|⁽[⁰-⁹]+⁾)?([₀-₉]*)$/

/**
 * One more prime: A′ from A, A″ from A′, A‴ from A″, then A⁽⁴⁾, A⁽⁵⁾ … —
 * the PRIMES count the steps from the first figure, so A″ is always the
 * image of A′. A subscript rides along unchanged: it tells apart two images
 * of the same figure (A′ and A′₂), or is the teacher's own (A₁ → A′₁).
 */
export function primeName(label: string): string {
  const m = LABEL_RE.exec(label)
  if (!m) return `${label}′`
  const [, base, mark = '', sub] = m
  let next: string
  if (mark === '') next = '′'
  else if (mark.startsWith('⁽')) next = `⁽${toSup(fromSup(mark.slice(1, -1)) + 1)}⁾`
  else {
    const i = PRIMES.indexOf(mark)
    next = i < PRIMES.length - 1 ? PRIMES[i + 1] : `⁽${toSup(4)}⁾`
  }
  return `${base}${next}${sub}`
}

/**
 * A primed name marked as the n-th image of its figure (n ≥ 2): A′ → A′₂.
 * The first image keeps the plain name.
 */
export function siblingName(primed: string, n: number): string {
  if (!(n >= 2)) return primed
  return `${primed}${toSub(n)}`
}

/** "A′" written for KaTeX: A' / A'' / A''' / A_{4}. */
export function primeTex(label: string): string {
  return label
    .replace(/′/g, "'")
    .replace(/″/g, "''")
    .replace(/‴/g, "'''")
    .replace(/⁽([⁰-⁹]+)⁾/, (_m, d: string) => `^{(${fromSup(d)})}`)
    .replace(/([₀-₉]+)$/, (d) => `_{${fromSub(d)}}`)
}

// ---------------------------------------------------------------------------
// Find the motion: a figure and its image
// ---------------------------------------------------------------------------

interface C {
  re: number
  im: number
}
const cx = (p: Vec2): C => ({ re: p.x, im: p.y })
const csub = (a: C, b: C): C => ({ re: a.re - b.re, im: a.im - b.im })
const cmul = (a: C, b: C): C => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re })
const cconj = (a: C): C => ({ re: a.re, im: -a.im })
function cdiv(a: C, b: C): C {
  const d = b.re * b.re + b.im * b.im
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }
}

export type Relation = 'congruent' | 'similar' | 'neither'

export interface MotionReport {
  relation: Relation
  /** The map found (P → Q), or null when there is none. */
  affine: Affine | null
  /** Distances multiplied by this (1 when congruent). */
  scale: number | null
  scaleText: string | null
  preservesOrientation: boolean | null
  /** The motion found: one motion, or the shortest sequence (dilation then rigid). */
  motions: Motion[]
  /** A textbook sequence that does the same (translate, then rotate …), when different. */
  alternative: Motion[] | null
  /** "a rotation of 90° counterclockwise about the origin" */
  words: string
  name: Notation | null
  rule: Rule | null
  /** Why congruent / similar / neither, with the measurements. */
  reason: string
  /** The corresponding parts compared: "AB = A′B′ = 5". */
  parts: string[]
}

const DIST_TOL = 1e-7

/** Names for a figure's vertices: given labels, else A, B, C… (and A′, B′… for an image). */
export function figureNames(n: number, labels?: readonly string[] | null, prime = false): string[] {
  if (labels && labels.length === n && labels.every((l) => l)) return [...labels]
  const base = vertexNames(n, null)
  return prime ? base.map(primeName) : base
}

function isNiceCentre(p: Vec2): boolean {
  const ok = (v: number): boolean => {
    const r = toRat(v, 12)
    return !!r && Math.abs(r.n / r.d - v) < 1e-9
  }
  return ok(p.x) && ok(p.y)
}

/** The pairs (i, j) a comparison reads: the sides in order, then the diagonals. */
function pairOrder(n: number): [number, number][] {
  const out: [number, number][] = []
  if (n < 2) return out
  if (n === 2) return [[0, 1]]
  for (let i = 0; i < n; i++) out.push([i, (i + 1) % n])
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) if (!(i === 0 && j === n - 1)) out.push([i, j])
  return out
}

/**
 * The motion taking P to Q, vertex by vertex (P[i] → Q[i]).
 *
 * Congruent figures (every corresponding distance equal) get a single rigid
 * motion — translation, rotation, reflection or glide reflection — and, for a
 * rotation, the textbook sequence too (translate A to A′, then turn about
 * A′). Similar figures get a dilation and, when the shape also turned or
 * flipped, the rigid motion after it. Anything else gets the measurement that
 * rules it out.
 */
export function findMotion(
  P: readonly Vec2[],
  Q: readonly Vec2[],
  namesP?: readonly string[] | null,
  namesQ?: readonly string[] | null,
): MotionReport {
  const n = P.length
  const nP = figureNames(n, namesP)
  const nQ = figureNames(Q.length, namesQ, !namesQ)
  const none = (reason: string, parts: string[] = []): MotionReport => ({
    relation: 'neither',
    affine: null,
    scale: null,
    scaleText: null,
    preservesOrientation: null,
    motions: [],
    alternative: null,
    words: '',
    name: null,
    rule: null,
    reason,
    parts,
  })
  if (n === 0 || Q.length !== n) {
    return none(`${nP.join('')} has ${n} vertices and ${nQ.join('')} has ${Q.length}, so they cannot correspond.`)
  }
  if (![...P, ...Q].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return none('A vertex is not a finite point.')
  const extent = Math.max(1, ...[...P, ...Q].map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))))
  const tol = DIST_TOL * extent

  // ---- distances: equal, proportional, or neither
  const pairs = pairOrder(n)
  const seg = (names: readonly string[], i: number, j: number): string => `${names[i]}${names[j]}`
  let far: [number, number] | null = null
  let farLen = 0
  for (const [i, j] of n === 1 ? [] : pairs) {
    const L = Math.hypot(P[j].x - P[i].x, P[j].y - P[i].y)
    if (L > farLen) {
      farLen = L
      far = [i, j]
    }
  }
  const lenP = (i: number, j: number): number => Math.hypot(P[j].x - P[i].x, P[j].y - P[i].y)
  const lenQ = (i: number, j: number): number => Math.hypot(Q[j].x - Q[i].x, Q[j].y - Q[i].y)

  if (n > 1 && (!far || farLen <= tol)) {
    return none(`The vertices of ${nP.join('')} all coincide, so it has no shape to compare.`)
  }
  const k = far ? lenQ(far[0], far[1]) / farLen : 1
  const parts: string[] = []
  let congruent = true
  let similar = k > tol
  let firstBad: { i: number; j: number; side: boolean } | null = null
  let firstRatioBad: [number, number] | null = null
  const sides = n >= 3 ? n : n - 1
  pairs.forEach(([i, j], idx) => {
    const a = lenP(i, j)
    const b = lenQ(i, j)
    const am = distance(P[i], P[j])
    const bm = distance(Q[i], Q[j])
    if (Math.abs(a - b) > tol) {
      congruent = false
      if (!firstBad) firstBad = { i, j, side: idx < sides }
    }
    if (Math.abs(b - k * a) > tol * Math.max(1, k)) {
      similar = false
      if (!firstRatioBad) firstRatioBad = [i, j]
    }
    if (idx < sides) {
      parts.push(
        Math.abs(a - b) <= tol
          ? `${seg(nP, i, j)} = ${seg(nQ, i, j)} = ${am.text}`
          : `${seg(nP, i, j)} = ${am.text}, ${seg(nQ, i, j)} = ${bm.text}`,
      )
    }
  })
  if (n >= 3) {
    const aP = interiorAngles(P)
    const aQ = interiorAngles(Q)
    aP.forEach((a, i) => {
      parts.push(
        Math.abs(a.deg - aQ[i].deg) < 1e-6
          ? `∠${nP[i]} = ∠${nQ[i]} = ${a.text}`
          : `∠${nP[i]} = ${a.text}, ∠${nQ[i]} = ${aQ[i].text}`,
      )
    })
  }

  if (!congruent && !similar) {
    const bad = firstBad as { i: number; j: number; side: boolean } | null
    const rb = firstRatioBad as [number, number] | null
    let reason = ''
    if (bad) {
      const a = distance(P[bad.i], P[bad.j])
      const b = distance(Q[bad.i], Q[bad.j])
      reason = bad.side
        ? `${seg(nP, bad.i, bad.j)} = ${a.text} but ${seg(nQ, bad.i, bad.j)} = ${b.text}, so the figures are not congruent.`
        : `Every side matches, but the diagonal ${seg(nP, bad.i, bad.j)} = ${a.text} while ${seg(nQ, bad.i, bad.j)} = ${b.text} — the angles differ, so the figures are not congruent.`
    }
    if (rb && far) {
      const r1 = numForm(lenQ(far[0], far[1]) / lenP(far[0], far[1]))
      const r2 = numForm(lenQ(rb[0], rb[1]) / lenP(rb[0], rb[1]))
      reason += ` ${seg(nQ, far[0], far[1])}/${seg(nP, far[0], far[1])} = ${r1.text} but ${seg(nQ, rb[0], rb[1])}/${seg(nP, rb[0], rb[1])} = ${r2.text}: the ratios differ, so they are not similar either.`
    }
    return none(reason.trim(), parts)
  }

  // ---- the map itself: z → αz + β, or z → α·conj(z) + β
  let A: Affine | null = null
  const fits = (M: Affine): boolean =>
    P.every((p, i) => {
      const q = applyAffine(M, p)
      return Math.hypot(q.x - Q[i].x, q.y - Q[i].y) <= tol * 10
    })
  if (n === 1 || !far) {
    A = { a: 1, b: 0, c: 0, d: 1, e: clean(Q[0].x - P[0].x), f: clean(Q[0].y - P[0].y) }
  } else {
    const [i, j] = far
    const dp = csub(cx(P[j]), cx(P[i]))
    const dq = csub(cx(Q[j]), cx(Q[i]))
    const direct = (): Affine => {
      const al = cdiv(dq, dp)
      const be = csub(cx(Q[i]), cmul(al, cx(P[i])))
      return { a: clean(al.re), b: clean(-al.im), c: clean(al.im), d: clean(al.re), e: clean(be.re), f: clean(be.im) }
    }
    const opposite = (): Affine => {
      const al = cdiv(dq, cconj(dp))
      const be = csub(cx(Q[i]), cmul(al, cconj(cx(P[i]))))
      return { a: clean(al.re), b: clean(al.im), c: clean(al.im), d: clean(-al.re), e: clean(be.re), f: clean(be.im) }
    }
    const D = direct()
    if (fits(D)) A = D
    else {
      const O = opposite()
      if (fits(O)) A = O
    }
  }
  if (!A) return none('The distances match, but no single map carries every vertex to its partner.', parts)

  const cls = classifyAffine(A)
  const motions = identify(A) ?? []
  let alternative: Motion[] | null = null
  // A rotation about an awkward centre, or any rotation: the textbook
  // sequence translates the first vertex onto its image, then turns about it.
  if (motions.length === 1 && motions[0].kind === 'rotate') {
    const r = motions[0]
    const v = { x: clean(Q[0].x - P[0].x), y: clean(Q[0].y - P[0].y) }
    alternative = Math.hypot(v.x, v.y) < 1e-12 ? null : [{ kind: 'translate', v }, { kind: 'rotate', deg: r.deg, center: Q[0] }]
  } else if (motions.length === 1 && motions[0].kind === 'glide') {
    alternative = [
      { kind: 'reflect', line: motions[0].line },
      { kind: 'translate', v: motions[0].v },
    ]
  } else if (!cls.rigid && motions.length > 0 && motions.some((m) => m.kind === 'dilate' && !isNiceCentre(m.center))) {
    // a similarity whose own centre is awkward: dilate about the origin, then
    // whatever rigid motion is left
    const s = clean(cls.scale)
    const D: Motion = { kind: 'dilate', k: s, center: ORIGIN }
    const rest = identify(composeAffine(invertAffine(motionAffine(D)), A))
    if (rest && rest.every((m) => m.kind !== 'dilate')) alternative = [D, ...rest.filter((m) => m.kind !== 'identity')]
  }

  const relationOf: Relation = congruent ? 'congruent' : 'similar'
  const scaleText = numForm(cls.scale).text
  const sideParts = pairs.slice(0, sides)
  let reason: string
  if (relationOf === 'congruent') {
    reason =
      n === 1
        ? 'One point maps to one point.'
        : `Every distance between corresponding vertices matches (${sideParts
            .map(([i, j]) => `${seg(nP, i, j)} = ${seg(nQ, i, j)} = ${distance(P[i], P[j]).text}`)
            .join(', ')}${n > 3 ? ', and the diagonals' : ''}), so the figures are congruent.`
  } else {
    reason = `Every distance is multiplied by ${scaleText} (${sideParts
      .map(([i, j]) => `${seg(nQ, i, j)}/${seg(nP, i, j)}`)
      .join(' = ')} = ${scaleText}), so the figures are similar with scale factor ${scaleText}.`
  }
  const shown = motions.filter((m) => m.kind !== 'identity')
  return {
    relation: relationOf,
    affine: A,
    scale: cls.scale,
    scaleText,
    preservesOrientation: cls.preservesOrientation,
    motions: shown.length > 0 ? shown : [{ kind: 'identity' }],
    alternative,
    words: shown.length > 0 ? sequenceWords(shown) : 'the identity — the figure is already on its image',
    name: shown.length > 0 ? sequenceName(shown) : { text: 'I', tex: 'I' },
    rule: shown.length === 1 ? motionRule(shown[0]) : ruleOfAffine(A),
    reason,
    parts,
  }
}

export function invertAffine(A: Affine): Affine {
  const D = det(A)
  const a = A.d / D
  const b = -A.b / D
  const c = -A.c / D
  const d = A.a / D
  return { a: clean(a), b: clean(b), c: clean(c), d: clean(d), e: clean(-(a * A.e + b * A.f)), f: clean(-(c * A.e + d * A.f)) }
}

export interface FigureComparison {
  report: MotionReport
  /** order[i] = the index in Q that P[i] corresponds to. */
  order: number[]
  /** "A → D, B → E, C → F" */
  correspondence: string
  /** Triangle criteria, when both figures are triangles. */
  triangle: TriangleComparison | null
}

/**
 * Two figures with no correspondence given: every way of matching their
 * vertices in order (each starting vertex, both directions) is tried, and the
 * first that makes them congruent — else similar — is the one reported.
 */
export function compareFigures(
  P: readonly Vec2[],
  Q: readonly Vec2[],
  namesP?: readonly string[] | null,
  namesQ?: readonly string[] | null,
): FigureComparison {
  const n = P.length
  const nP = figureNames(n, namesP)
  const nQ = figureNames(Q.length, namesQ, !namesQ)
  const orders: number[][] = []
  if (Q.length === n) {
    for (const dir of [1, -1]) {
      for (let s = 0; s < n; s++) orders.push(Array.from({ length: n }, (_v, i) => (((s + dir * i) % n) + n) % n))
    }
  }
  let best: { report: MotionReport; order: number[] } | null = null
  for (const order of orders) {
    const report = findMotion(P, order.map((i) => Q[i]), nP, order.map((i) => nQ[i]))
    if (report.relation === 'congruent') {
      best = { report, order }
      break
    }
    if (report.relation === 'similar' && (!best || best.report.relation !== 'similar')) best = { report, order }
  }
  if (!best) {
    const order = orders[0] ?? []
    best = { report: findMotion(P, Q, nP, nQ), order }
  }
  const order = best.order
  const correspondence = order.map((qi, i) => `${nP[i]} → ${nQ[qi]}`).join(', ')
  const triangle =
    n === 3 && Q.length === 3 && order.length === 3
      ? compareTriangles(P, order.map((i) => Q[i]), nP, order.map((i) => nQ[i]))
      : null
  return { report: best.report, order, correspondence, triangle }
}

// ---------------------------------------------------------------------------
// Symmetry: the motions that carry a figure onto itself
// ---------------------------------------------------------------------------

export interface SymmetryLine {
  mirror: Mirror
  /** A point on the line and its direction, for drawing. */
  through: Vec2
  dir: Vec2
  /** "y = x" */
  equation: string
  /** "through A and C", "through the midpoints of AB and CD" */
  via: string
}

export interface SymmetryReport {
  lines: SymmetryLine[]
  /** Rotation symmetry order: 1 when only the full turn works. */
  order: number
  /** The turns (degrees, counterclockwise, 0 < θ < 360) that carry it onto itself. */
  angles: number[]
  /** The centre of the rotations (the vertices' centroid). */
  center: Vec2
  /** 180° is among them: point symmetry. */
  point: boolean
  /** "4 lines · order 4 (90°, 180°, 270°)" */
  summary: string
  /** The whole statement, in a sentence. */
  sentence: string
}

/** The lines of reflection symmetry and the rotations of a polygon. */
export function symmetryOf(pts: readonly Vec2[], labels?: readonly string[] | null): SymmetryReport | null {
  const n = pts.length
  if (n < 3 || !pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return null
  if (Math.abs(signedArea2(pts)) < 1e-12) return null
  const names = figureNames(n, labels)
  const center = { x: clean(pts.reduce((t, p) => t + p.x, 0) / n), y: clean(pts.reduce((t, p) => t + p.y, 0) / n) }
  const angles: number[] = []
  for (let s = 1; s < n; s++) {
    const r = findMotion(pts, pts.map((_p, i) => pts[(i + s) % n]))
    if (r.relation !== 'congruent' || !r.affine) continue
    const m = identify(r.affine)
    if (m && m.length === 1 && m[0].kind === 'rotate') angles.push(((m[0].deg % 360) + 360) % 360)
  }
  angles.sort((a, b) => a - b)
  const lines: SymmetryLine[] = []
  const seen: Mirror[] = []
  for (let j = 0; j < n; j++) {
    const r = findMotion(pts, pts.map((_p, i) => pts[(((j - i) % n) + n) % n]))
    if (r.relation !== 'congruent' || !r.affine) continue
    const m = identify(r.affine)
    if (!m || m.length !== 1 || m[0].kind !== 'reflect') continue
    const mirror = m[0].line
    const key = mirrorText(mirror).text
    if (seen.some((s) => mirrorText(s).text === key)) continue
    seen.push(mirror)
    const fr = mirrorFrame(mirror)
    lines.push({ mirror, through: fr.p, dir: fr.u, equation: key, via: viaWords(pts, names, fr) })
  }
  const order = angles.length + 1
  const point = angles.some((a) => Math.abs(a - 180) < 1e-9)
  const lineCount = lines.length === 0 ? 'no lines of symmetry' : lines.length === 1 ? '1 line of symmetry' : `${lines.length} lines of symmetry`
  const turns = angles.map((a) => degreeText(a).text)
  const rot = order === 1 ? 'no rotational symmetry' : `rotational symmetry of order ${order} (${turns.join(', ')})`
  const summary = `${lines.length === 0 ? 'no lines' : lines.length === 1 ? '1 line' : `${lines.length} lines`} · ${order === 1 ? 'no turn' : `order ${order}`}`
  const fig = n === 3 ? `△${names.join('')}` : names.join('')
  const what = polygonReport(pts, names)?.classification.name ?? 'figure'
  const carry =
    order > 1
      ? ` Turns of ${listAnd(turns)} about ${centreWords(center)} carry ${fig} onto itself${point ? ' (180° is point symmetry)' : ''}.`
      : ''
  const reflect =
    lines.length > 0
      ? ` Reflecting across ${lines.length === 1 ? 'that line' : 'any of those lines'} carries it onto itself.`
      : ''
  const sentence = `${fig} (${articleOf(what)}) has ${lineCount} and ${rot}.${reflect}${carry}`
  return { lines, order, angles, center, point, summary, sentence }
}

const articleOf = (w: string): string => (/^[aeiou]/i.test(w) ? `an ${w}` : `a ${w}`)

function listAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** Which vertices and side midpoints a symmetry line passes through. */
function viaWords(pts: readonly Vec2[], names: readonly string[], fr: { p: Vec2; u: Vec2 }): string {
  const on = (q: Vec2): boolean => Math.abs((q.x - fr.p.x) * fr.u.y - (q.y - fr.p.y) * fr.u.x) < 1e-7
  const n = pts.length
  const verts = names.filter((_v, i) => on(pts[i]))
  const mids: string[] = []
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    if (on({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })) mids.push(`${names[i]}${names[(i + 1) % n]}`)
  }
  const bits: string[] = []
  if (verts.length > 0) bits.push(verts.length === 1 ? `vertex ${verts[0]}` : `${listAnd(verts)}`)
  if (mids.length > 0) bits.push(mids.length === 1 ? `the midpoint of ${mids[0]}` : `the midpoints of ${listAnd(mids)}`)
  return bits.length > 0 ? `through ${bits.join(' and ')}` : ''
}

// ---------------------------------------------------------------------------
// Triangles: congruence and similarity criteria
// ---------------------------------------------------------------------------

export type CongruenceCriterion = 'SSS' | 'SAS' | 'ASA' | 'AAS' | 'HL'
export type SimilarityCriterion = 'AA' | 'SAS~' | 'SSS~'

export interface CriterionHit<T> {
  name: T
  /** The matching parts it uses: "AB = DE = 5", "∠B = ∠E = 90°". */
  parts: string[]
}

export interface TriangleComparison {
  congruent: boolean
  similar: boolean
  /** Q's sides over P's, when similar. */
  k: number | null
  kText: string | null
  /** AB ↔ DE, BC ↔ EF, CA ↔ FD */
  sides: { p: string; q: string; lp: Measure; lq: Measure; equal: boolean; ratio: number }[]
  /** ∠A ↔ ∠D … */
  angles: { p: string; q: string; ap: AngleInfo; aq: AngleInfo; equal: boolean }[]
  /** Every congruence criterion the matching parts satisfy (all of them, when congruent). */
  criteria: CriterionHit<CongruenceCriterion>[]
  simCriteria: CriterionHit<SimilarityCriterion>[]
  /** When only two sides and a non-included angle match: why that proves nothing. */
  ssa: string | null
  /** The verdict, in a sentence. */
  sentence: string
}

const SIDE_TOL = 1e-9

/**
 * Two triangles with P[i] ↔ Q[i]. Sides are named by their endpoints (side i
 * joins vertex i and i + 1), angles by their vertex — so the included angle of
 * sides i and i − 1 is the angle at vertex i.
 */
export function compareTriangles(
  P: readonly Vec2[],
  Q: readonly Vec2[],
  namesP?: readonly string[] | null,
  namesQ?: readonly string[] | null,
): TriangleComparison {
  const nP = figureNames(3, namesP)
  const nQ = figureNames(3, namesQ, !namesQ)
  const sides = [0, 1, 2].map((i) => {
    const j = (i + 1) % 3
    const lp = distance(P[i], P[j])
    const lq = distance(Q[i], Q[j])
    const equal = Math.abs(lp.value - lq.value) <= SIDE_TOL * Math.max(1, lp.value, lq.value)
    return { p: `${nP[i]}${nP[j]}`, q: `${nQ[i]}${nQ[j]}`, lp, lq, equal, ratio: lq.value / lp.value }
  })
  const aP = interiorAngles(P)
  const aQ = interiorAngles(Q)
  const angles = [0, 1, 2].map((i) => ({
    p: nP[i],
    q: nQ[i],
    ap: aP[i],
    aq: aQ[i],
    equal: Math.abs(aP[i].deg - aQ[i].deg) < 1e-6,
  }))
  const sideTxt = (i: number): string => (sides[i].equal ? `${sides[i].p} = ${sides[i].q} = ${sides[i].lp.text}` : '')
  const angTxt = (i: number): string => (angles[i].equal ? `∠${angles[i].p} = ∠${angles[i].q} = ${angles[i].ap.text}` : '')

  const sEq = sides.map((s) => s.equal)
  const aEq = angles.map((a) => a.equal)
  const criteria: CriterionHit<CongruenceCriterion>[] = []
  // SSS
  if (sEq.every((x) => x)) criteria.push({ name: 'SSS', parts: [0, 1, 2].map(sideTxt) })
  // SAS: sides i−1 and i with the angle at vertex i between them
  for (let v = 0; v < 3; v++) {
    const s1 = (v + 2) % 3
    const s2 = v
    if (sEq[s1] && sEq[s2] && aEq[v]) {
      criteria.push({ name: 'SAS', parts: [sideTxt(s1), angTxt(v), sideTxt(s2)] })
      break
    }
  }
  // ASA: angles at i and i+1 and side i between them
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3
    if (aEq[i] && aEq[j] && sEq[i]) {
      criteria.push({ name: 'ASA', parts: [angTxt(i), sideTxt(i), angTxt(j)] })
      break
    }
  }
  // AAS: two angles and a side not between them
  outer: for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (i === j || !aEq[i] || !aEq[j]) continue
      for (let s = 0; s < 3; s++) {
        const between = (s === i && (i + 1) % 3 === j) || (s === j && (j + 1) % 3 === i)
        if (!between && sEq[s]) {
          criteria.push({ name: 'AAS', parts: [angTxt(i), angTxt(j), sideTxt(s)] })
          break outer
        }
      }
    }
  }
  // HL: both right at the same vertex, hypotenuse and a leg
  const r = aP.findIndex((a) => a.right)
  if (r >= 0 && aQ[r].right) {
    const hyp = (r + 1) % 3 // side opposite vertex r joins r+1 and r+2
    const legs = [(r + 2) % 3, r]
    const leg = legs.find((s) => sEq[s])
    if (sEq[hyp] && leg !== undefined) {
      criteria.push({ name: 'HL', parts: [`∠${nP[r]} = ∠${nQ[r]} = 90°`, `hypotenuse ${sideTxt(hyp)}`, `leg ${sideTxt(leg)}`] })
    }
  }
  const congruent = sEq.every((x) => x)

  // similarity
  const ratios = sides.map((s) => s.ratio)
  const sameRatio = (i: number, j: number): boolean => Math.abs(ratios[i] - ratios[j]) <= 1e-9 * Math.max(1, ratios[i])
  const simCriteria: CriterionHit<SimilarityCriterion>[] = []
  const ratioTxt = (i: number): string => `${sides[i].q}/${sides[i].p} = ${numForm(ratios[i]).text}`
  const aaPair = [0, 1, 2].flatMap((i) => [0, 1, 2].filter((j) => j > i && aEq[i] && aEq[j]).map((j) => [i, j] as const))[0]
  if (aaPair) simCriteria.push({ name: 'AA', parts: [angTxt(aaPair[0]), angTxt(aaPair[1])] })
  for (let v = 0; v < 3; v++) {
    const s1 = (v + 2) % 3
    const s2 = v
    if (sameRatio(s1, s2) && aEq[v]) {
      simCriteria.push({ name: 'SAS~', parts: [ratioTxt(s1), angTxt(v), ratioTxt(s2)] })
      break
    }
  }
  if (sameRatio(0, 1) && sameRatio(1, 2)) simCriteria.push({ name: 'SSS~', parts: [0, 1, 2].map(ratioTxt) })
  const similar = simCriteria.length > 0
  const k = similar && sameRatio(0, 1) && sameRatio(1, 2) ? ratios[0] : null

  // SSA: two sides and an angle that is NOT between them — a trap, never a proof
  let ssa: string | null = null
  if (!congruent) {
    for (let v = 0; v < 3 && !ssa; v++) {
      // the side opposite vertex v is side (v + 1) % 3; with it, either of the others
      const opp = (v + 1) % 3
      for (const other of [v, (v + 2) % 3]) {
        if (aEq[v] && sEq[opp] && sEq[other]) {
          ssa = `${sideTxt(other)}, ${sideTxt(opp)} and ${angTxt(v)} match — two sides and a non-included angle (SSA). SSA is not a congruence criterion, and here the third sides differ (${sides[3 - opp - other].p} = ${sides[3 - opp - other].lp.text}, ${sides[3 - opp - other].q} = ${sides[3 - opp - other].lq.text}).`
          break
        }
      }
    }
  }

  const tP = `△${nP.join('')}`
  const tQ = `△${nQ.join('')}`
  let sentence: string
  if (congruent) {
    const best = criteria[0]
    sentence = `${tP} ≅ ${tQ} by SSS: ${best.parts.join(', ')}.${
      criteria.length > 1 ? ` (${criteria.slice(1).map((c) => c.name).join(', ')} hold too.)` : ''
    }`
  } else if (similar) {
    const best = simCriteria[0]
    sentence = `${tP} ~ ${tQ} by ${best.name}: ${best.parts.join(', ')}${k !== null ? `; scale factor ${numForm(k).text}` : ''}. They are not congruent — ${firstUnequal(sides)}.`
  } else {
    sentence = `${tP} and ${tQ} are neither congruent nor similar with this correspondence: ${firstUnequal(sides)}, and the angles ${angles.some((a) => !a.equal) ? 'differ' : 'match'}.`
  }
  return {
    congruent,
    similar,
    k,
    kText: k !== null ? numForm(k).text : null,
    sides,
    angles,
    criteria,
    simCriteria,
    ssa,
    sentence,
  }
}

function firstUnequal(sides: TriangleComparison['sides']): string {
  const s = sides.find((x) => !x.equal)
  return s ? `${s.p} = ${s.lp.text} but ${s.q} = ${s.lq.text}` : 'every side matches'
}

/** Which parts are GIVEN equal: side i joins vertices i and i + 1; angle i is at vertex i. */
export interface Givens {
  sides: readonly [boolean, boolean, boolean]
  angles: readonly [boolean, boolean, boolean]
  /** Both triangles are right-angled at this vertex. */
  right?: 0 | 1 | 2
}

/**
 * Which criterion a set of given parts establishes, or null with the reason.
 *
 * The point of this function is the null: two sides and an angle that is not
 * between them (SSA) look like enough and are not — the ambiguous case gives
 * two different triangles — so it is refused, except as HL when the angle is
 * the right angle. Three angles prove similarity, never congruence.
 */
export function criterionFromGivens(g: Givens): { criterion: CongruenceCriterion | null; reason: string } {
  const S = g.sides
  const Aq = g.angles
  const ns = S.filter((x) => x).length
  const na = Aq.filter((x) => x).length
  if (ns === 3) return { criterion: 'SSS', reason: 'Three pairs of sides: SSS.' }
  if (ns >= 2) {
    for (let v = 0; v < 3; v++) {
      if (S[(v + 2) % 3] && S[v] && Aq[v]) return { criterion: 'SAS', reason: 'Two sides and the angle between them: SAS.' }
    }
  }
  if (na >= 2) {
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3
      if (Aq[i] && Aq[j] && S[i]) return { criterion: 'ASA', reason: 'Two angles and the side between them: ASA.' }
    }
    for (let s = 0; s < 3; s++) if (S[s]) return { criterion: 'AAS', reason: 'Two angles and a side that is not between them: AAS.' }
  }
  if (g.right !== undefined) {
    const r = g.right
    const hyp = (r + 1) % 3
    if (S[hyp] && (S[r] || S[(r + 2) % 3])) {
      return { criterion: 'HL', reason: 'Right triangles with the hypotenuse and a leg: HL.' }
    }
  }
  if (ns === 2 && na >= 1) {
    return {
      criterion: null,
      reason: 'Two sides and an angle that is not between them (SSA) is not a congruence criterion: the ambiguous case can give two different triangles.',
    }
  }
  if (na === 3 || (na === 2 && ns === 0)) {
    return { criterion: null, reason: 'Angles alone (AAA, or AA) prove the triangles similar, not congruent.' }
  }
  return { criterion: null, reason: 'Not enough parts are given to prove the triangles congruent.' }
}

// ---------------------------------------------------------------------------
// What a transformation preserves: the checks an image card ticks
// ---------------------------------------------------------------------------

export interface PreservedCheck {
  /** "A′B′ = AB = 5" */
  text: string
  /** true ✓, false ✗, null: a fact, not a check. */
  ok: boolean | null
  kind: 'length' | 'angle' | 'parallel' | 'orientation' | 'fixed' | 'area'
}

/**
 * Lengths equal (or scaled by k), angles equal, parallel sides still parallel,
 * each side parallel to its image (dilations and translations), orientation,
 * the centre fixed — measured on the two figures, not assumed.
 */
export function preservedChecks(
  P: readonly Vec2[],
  Q: readonly Vec2[],
  names: readonly string[],
  primes: readonly string[],
  m: Motion | null,
): PreservedCheck[] {
  const out: PreservedCheck[] = []
  const n = P.length
  if (n < 2 || Q.length !== n) return out
  const A = m ? motionAffine(m) : null
  const cls = A ? classifyAffine(A) : null
  const k = m?.kind === 'dilate' ? Math.abs(m.k) : 1
  const kText = numForm(k).text
  const edges = n >= 3 ? n : 1
  for (let i = 0; i < edges; i++) {
    const j = (i + 1) % n
    const lp = distance(P[i], P[j])
    const lq = distance(Q[i], Q[j])
    const ok = Math.abs(lq.value - k * lp.value) <= 1e-9 * Math.max(1, lq.value)
    const sp = `${names[i]}${names[j]}`
    const sq = `${primes[i]}${primes[j]}`
    out.push({
      kind: 'length',
      ok,
      text: k === 1 ? `${sq} = ${sp} = ${lp.text}` : `${sq} = ${lq.text} = ${kText} · ${sp}  (${sp} = ${lp.text})`,
    })
  }
  if (n >= 3) {
    const aP = interiorAngles(P)
    const aQ = interiorAngles(Q)
    aP.forEach((a, i) => {
      const ok = Math.abs(a.deg - aQ[i].deg) < 1e-6
      out.push({ kind: 'angle', ok, text: ok ? `∠${primes[i]} = ∠${names[i]} = ${a.text}` : `∠${primes[i]} = ${aQ[i].text}, ∠${names[i]} = ${a.text}` })
    })
    // parallel pairs of sides stay parallel
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const i2 = (i + 1) % n
        const j2 = (j + 1) % n
        if (relation(P[i], P[i2], P[j], P[j2]) !== 'parallel') continue
        const ok = relation(Q[i], Q[i2], Q[j], Q[j2]) === 'parallel'
        out.push({
          kind: 'parallel',
          ok,
          text: `${names[i]}${names[i2]} ‖ ${names[j]}${names[j2]}, and ${primes[i]}${primes[i2]} ${ok ? '‖' : '∦'} ${primes[j]}${primes[j2]}`,
        })
      }
    }
  }
  // a dilation or translation sends every line to a parallel line (or itself)
  if (m && (m.kind === 'dilate' || m.kind === 'translate')) {
    const sides: string[] = []
    let all = true
    for (let i = 0; i < edges; i++) {
      const j = (i + 1) % n
      const rel = relation(P[i], P[j], Q[i], Q[j])
      if (rel !== 'parallel' && rel !== 'same') all = false
      sides.push(`${primes[i]}${primes[j]} ${rel === 'same' ? 'on' : '‖'} ${names[i]}${names[j]}`)
    }
    out.push({ kind: 'parallel', ok: all, text: `Each side maps to a parallel line (or itself): ${sides.join(', ')}` })
  }
  if (n >= 3 && cls) {
    const same = signedArea2(P) * signedArea2(Q) > 0
    const turn = (pts: readonly Vec2[]): string => (signedArea2(pts) > 0 ? 'counterclockwise' : 'clockwise')
    out.push({
      kind: 'orientation',
      ok: null,
      text: same
        ? `Orientation kept: ${names.join('')} and ${primes.join('')} both run ${turn(P)}`
        : `Orientation reversed: ${names.join('')} runs ${turn(P)}, ${primes.join('')} runs ${turn(Q)}`,
    })
    const areaP = Math.abs(signedArea2(P)) / 2
    const areaQ = Math.abs(signedArea2(Q)) / 2
    const k2 = k * k
    out.push({
      kind: 'area',
      ok: Math.abs(areaQ - k2 * areaP) <= 1e-9 * Math.max(1, areaQ),
      text: k === 1 ? `Area ${numForm(areaQ).text} = area of ${names.join('')}` : `Area ${numForm(areaQ).text} = ${numForm(k2).text} · ${numForm(areaP).text} (k²)`,
    })
  }
  if (m && (m.kind === 'rotate' || m.kind === 'dilate')) {
    const c = applyMotion(m, m.center)
    out.push({
      kind: 'fixed',
      ok: Math.hypot(c.x - m.center.x, c.y - m.center.y) < 1e-9,
      text: `The centre ${isOrigin(m.center) ? 'O (the origin)' : pointText(m.center).text} stays fixed`,
    })
  }
  return out
}

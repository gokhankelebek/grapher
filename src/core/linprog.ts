// ============================================================================
// src/core/linprog.ts — linear programming in the plane (NC Math 3, Alg 2).
//
// A system of LINEAR inequalities a·x + b·y + c ≥ 0 (> 0 when strict) has a
// convex feasible region. Its corners are the intersections of pairs of
// boundary lines that satisfy every constraint; they are computed in exact
// rational arithmetic whenever the coefficients are rational (they almost
// always are: a teacher types 2x + 3y ≤ 12), so a corner reads (8/3, 4/3)
// rather than (2.667, 1.333).
//
//   feasibleRegion(cons)    corners in boundary order, bounded / unbounded /
//                           empty, and the recession directions of an
//                           unbounded region
//   optimize(region, P, g)  P = p·x + q·y + k at every corner, the optimum,
//                           and the honest cases: no maximum (the region is
//                           unbounded in a direction P grows), an optimum
//                           along a whole edge (two corners tie), an optimum
//                           on a dashed boundary (approached, never attained),
//                           and no solution at all (empty region)
//   parseObjective(src)     "P = 3x + 2y", "C = 5x + 4y + 10", "3x + 2y"
//
// Pure: no drawing, no state. The board and the system card read these.
// ============================================================================

import type { Vec2 } from './types'
import { compileExpr } from './parse'

/** a·x + b·y + c ≥ 0 (> 0 when strict). */
export interface LinConstraint {
  a: number
  b: number
  c: number
  strict: boolean
}

// ---------------------------------------------------------------------------
// Exact rationals (small: a teacher's coefficients)
// ---------------------------------------------------------------------------

export interface Frac {
  n: number
  d: number
}

const LIMIT = 2 ** 50

function gcd(a: number, b: number): number {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b) [a, b] = [b, a % b]
  return a || 1
}

function mk(n: number, d: number): Frac | null {
  if (d === 0 || !Number.isFinite(n) || !Number.isFinite(d)) return null
  if (d < 0) {
    n = -n
    d = -d
  }
  const g = gcd(n, d)
  n /= g
  d /= g
  if (Math.abs(n) > LIMIT || d > LIMIT) return null
  return { n: n === 0 ? 0 : n, d }
}

/** The simplest p/q (q ≤ 10000) equal to v to 1e-9, or null. */
export function toFrac(v: number): Frac | null {
  if (!Number.isFinite(v)) return null
  const r = Math.round(v)
  if (Math.abs(v - r) < 1e-9 * Math.max(1, Math.abs(v))) return { n: r === 0 ? 0 : r, d: 1 }
  // continued fraction
  let h0 = 1
  let h1 = 0
  let k0 = 0
  let k1 = 1
  let x = v
  for (let i = 0; i < 24; i++) {
    const a = Math.floor(x)
    const h2 = a * h0 + h1
    const k2 = a * k0 + k1
    if (k2 > 10000) break
    h1 = h0
    h0 = h2
    k1 = k0
    k0 = k2
    if (Math.abs(v - h0 / k0) < 1e-9 * Math.max(1, Math.abs(v))) return mk(h0, k0)
    const frac = x - a
    if (frac < 1e-12) break
    x = 1 / frac
  }
  return null
}

const fadd = (a: Frac, b: Frac): Frac | null => mk(a.n * b.d + b.n * a.d, a.d * b.d)
const fsub = (a: Frac, b: Frac): Frac | null => mk(a.n * b.d - b.n * a.d, a.d * b.d)
const fmul = (a: Frac, b: Frac): Frac | null => mk(a.n * b.n, a.d * b.d)
const fdiv = (a: Frac, b: Frac): Frac | null => (b.n === 0 ? null : mk(a.n * b.d, a.d * b.n))
const fval = (a: Frac): number => a.n / a.d

/** "8/3", "−4", "0". */
export function fracText(f: Frac): string {
  const s = f.d === 1 ? String(Math.abs(f.n)) : `${Math.abs(f.n)}/${f.d}`
  return f.n < 0 ? `−${s}` : s
}

/** A value as the card prints it: exact when known, else a short decimal. */
export function valueText(v: number, exact: Frac | null): string {
  if (exact) return fracText(exact)
  if (!Number.isFinite(v)) return '—'
  const s = String(Number(v.toFixed(3)))
  return s.replace('-', '−')
}

// ---------------------------------------------------------------------------
// The feasible region
// ---------------------------------------------------------------------------

export interface LpVertex {
  x: number
  y: number
  exact: { x: Frac; y: Frac } | null
  /** "(8/3, 4/3)" */
  label: string
  /** True when the corner sits on a strict (dashed) boundary: not in the region. */
  onStrict: boolean
}

export interface FeasibleRegion {
  status: 'empty' | 'bounded' | 'unbounded'
  /** Corners in order around the boundary (counter-clockwise). */
  vertices: LpVertex[]
  /** Unit directions the region runs off in (unbounded only). */
  rays: Vec2[]
  /** True when every boundary is parallel: a strip or a half-plane, no corners. */
  parallel: boolean
}

const TOL = 1e-9

function slack(k: LinConstraint, x: number, y: number): number {
  return k.a * x + k.b * y + k.c
}

function scaleOf(k: LinConstraint): number {
  return Math.hypot(k.a, k.b) || 1
}

/** The corners, boundedness and recession directions of a linear system. */
export function feasibleRegion(cons: readonly LinConstraint[]): FeasibleRegion {
  const cs = cons.filter((k) => Number.isFinite(k.a) && Number.isFinite(k.b) && Number.isFinite(k.c))
  // A constraint 0x + 0y + c ≥ 0 is always or never true.
  for (const k of cs) {
    if (k.a === 0 && k.b === 0 && (k.c < 0 || (k.c === 0 && k.strict))) {
      return { status: 'empty', vertices: [], rays: [], parallel: false }
    }
  }
  const lines = cs.filter((k) => k.a !== 0 || k.b !== 0)
  if (lines.length === 0) return { status: 'unbounded', vertices: [], rays: [], parallel: true }
  const ex = lines.map((k) => {
    const a = toFrac(k.a)
    const b = toFrac(k.b)
    const c = toFrac(k.c)
    return a && b && c ? { a, b, c } : null
  })

  let rank2 = false
  const raw: LpVertex[] = []
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const p = lines[i]
      const q = lines[j]
      const det = p.a * q.b - q.a * p.b
      if (Math.abs(det) <= TOL * scaleOf(p) * scaleOf(q)) continue
      rank2 = true
      let x = (-p.c * q.b + q.c * p.b) / det
      let y = (-p.a * q.c + q.a * p.c) / det
      let exact: LpVertex['exact'] = null
      const P = ex[i]
      const Q = ex[j]
      if (P && Q) {
        const D = fsub(fmul(P.a, Q.b) ?? { n: 0, d: 0 }, fmul(Q.a, P.b) ?? { n: 0, d: 0 })
        const nx = fmul(P.b, Q.c) && fmul(Q.b, P.c) ? fsub(fmul(P.b, Q.c)!, fmul(Q.b, P.c)!) : null
        const ny = fmul(Q.a, P.c) && fmul(P.a, Q.c) ? fsub(fmul(Q.a, P.c)!, fmul(P.a, Q.c)!) : null
        const fx = D && nx ? fdiv(nx, D) : null
        const fy = D && ny ? fdiv(ny, D) : null
        if (fx && fy) {
          exact = { x: fx, y: fy }
          x = fval(fx)
          y = fval(fy)
        }
      }
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      const scale = 1 + Math.abs(x) + Math.abs(y)
      let ok = true
      let onStrict = false
      for (const k of cs) {
        const s = slack(k, x, y) / scaleOf(k)
        if (s < -TOL * scale) {
          ok = false
          break
        }
        if (Math.abs(s) <= TOL * scale && k.strict) onStrict = true
      }
      if (!ok) continue
      if (raw.some((v) => Math.abs(v.x - x) <= TOL * scale && Math.abs(v.y - y) <= TOL * scale)) continue
      raw.push({ x, y, exact, onStrict, label: vertexLabel(x, y, exact) })
    }
  }

  if (!rank2) return parallelRegion(lines)
  if (raw.length === 0) return { status: 'empty', vertices: [], rays: [], parallel: false }

  // Recession directions: along a boundary line, into every constraint.
  const rays: Vec2[] = []
  for (const k of lines) {
    const n = scaleOf(k)
    for (const sgn of [1, -1]) {
      const d = { x: (-k.b / n) * sgn, y: (k.a / n) * sgn }
      if (lines.every((m) => (m.a * d.x + m.b * d.y) / scaleOf(m) >= -TOL)) {
        if (!rays.some((r) => Math.abs(r.x - d.x) < 1e-9 && Math.abs(r.y - d.y) < 1e-9)) rays.push(d)
      }
    }
  }

  // Order the corners around a point inside the region.
  let cx = 0
  let cy = 0
  for (const v of raw) {
    cx += v.x
    cy += v.y
  }
  cx /= raw.length
  cy /= raw.length
  for (const r of rays) {
    cx += r.x * 1e-3
    cy += r.y * 1e-3
  }
  const vertices = raw
    .map((v) => ({ v, ang: Math.atan2(v.y - cy, v.x - cx) }))
    .sort((p, q) => p.ang - q.ang)
    .map((p) => p.v)
  return { status: rays.length > 0 ? 'unbounded' : 'bounded', vertices, rays, parallel: false }
}

/** Every boundary parallel: the region is a strip, a half-plane, a line or empty. */
function parallelRegion(lines: readonly LinConstraint[]): FeasibleRegion {
  const n0 = scaleOf(lines[0])
  const nx = lines[0].a / n0
  const ny = lines[0].b / n0
  let lo = -Infinity
  let hi = Infinity
  let loStrict = false
  let hiStrict = false
  for (const k of lines) {
    const lam = k.a * nx + k.b * ny
    const t = -k.c / lam
    if (lam > 0) {
      if (t > lo || (t === lo && k.strict)) {
        lo = t
        loStrict = k.strict
      }
    } else if (t < hi || (t === hi && k.strict)) {
      hi = t
      hiStrict = k.strict
    }
  }
  const empty = lo > hi + TOL || (Math.abs(lo - hi) <= TOL && (loStrict || hiStrict))
  const rays = empty ? [] : [{ x: -ny, y: nx }, { x: ny, y: -nx }]
  return { status: empty ? 'empty' : 'unbounded', vertices: [], rays, parallel: true }
}

export function vertexLabel(x: number, y: number, exact: LpVertex['exact']): string {
  return `(${valueText(x, exact?.x ?? null)}, ${valueText(y, exact?.y ?? null)})`
}

// ---------------------------------------------------------------------------
// The objective
// ---------------------------------------------------------------------------

export interface Objective {
  /** The letter on the left: "P", "C". */
  name: string
  p: number
  q: number
  k: number
  /** "3x + 2y" as the teacher typed it (for the card). */
  text: string
}

export type ObjectiveOutcome = { ok: true; obj: Objective } | { ok: false; error: string }

/** "P = 3x + 2y" → P = 3x + 2y + 0. Refuses anything not linear in x and y. */
export function parseObjective(src: string): ObjectiveOutcome {
  const text = src.trim()
  if (text === '') return { ok: false, error: 'Type an objective, like P = 3x + 2y' }
  const m = /^([A-Za-z])\s*=(?!=)\s*(.*)$/.exec(text)
  const name = m && m[1] !== 'x' && m[1] !== 'y' ? m[1] : 'P'
  const body = m && m[1] !== 'x' && m[1] !== 'y' ? m[2] : text
  if (body.trim() === '') return { ok: false, error: 'Type the objective after the =, like P = 3x + 2y' }
  const o = compileExpr(body)
  if (!o.ok) return { ok: false, error: o.error }
  if (o.expr.paramNames.length > 0) {
    return { ok: false, error: `The objective uses ${o.expr.paramNames.join(', ')} — use numbers and x, y only` }
  }
  if (o.expr.vars.some((v) => v !== 'x' && v !== 'y')) {
    return { ok: false, error: 'The objective is a function of x and y' }
  }
  const f = (x: number, y: number): number => o.expr.ev([], x, y)
  const k = f(0, 0)
  const p = f(1, 0) - k
  const q = f(0, 1) - k
  for (const [x, y] of [
    [2, 3],
    [-1.5, 4],
    [7, -2],
  ]) {
    const want = p * x + q * y + k
    if (!(Math.abs(f(x, y) - want) <= 1e-9 * (1 + Math.abs(want)))) {
      return { ok: false, error: 'Linear programming needs a linear objective, like P = 3x + 2y' }
    }
  }
  if (!Number.isFinite(p) || !Number.isFinite(q) || !Number.isFinite(k)) {
    return { ok: false, error: 'The objective is not defined everywhere' }
  }
  return { ok: true, obj: { name, p, q, k, text: body.trim() } }
}

export type Goal = 'max' | 'min'

export interface LpRow {
  vertex: LpVertex
  value: number
  exact: Frac | null
  /** "3(8/3) + 2(4/3) = 32/3" */
  work: string
  best: boolean
}

export interface LpResult {
  status: 'optimal' | 'none' | 'empty'
  rows: LpRow[]
  /** The optimal value (optimal only). */
  value?: number
  valueText?: string
  /** Where: one corner, a whole edge (two corners), or a ray from a corner. */
  at?: LpVertex[]
  along?: 'corner' | 'edge' | 'ray'
  /** False when the optimum corner is on a dashed boundary (approached, not attained). */
  attained?: boolean
  /** One or two sentences for the card. */
  sentence: string
}

function evalExact(obj: Objective, v: LpVertex): Frac | null {
  if (!v.exact) return null
  const p = toFrac(obj.p)
  const q = toFrac(obj.q)
  const k = toFrac(obj.k)
  if (!p || !q || !k) return null
  const a = fmul(p, v.exact.x)
  const b = fmul(q, v.exact.y)
  const s = a && b ? fadd(a, b) : null
  return s ? fadd(s, k) : null
}

function coefText(c: number): string {
  const f = toFrac(c)
  return f ? fracText(f) : valueText(c, null)
}

/** "3(8/3) + 2(4/3) = 32/3" — the substitution a student writes in the table. */
function workText(obj: Objective, v: LpVertex, value: number, exact: Frac | null): string {
  const xs = valueText(v.x, v.exact?.x ?? null)
  const ys = valueText(v.y, v.exact?.y ?? null)
  const term = (c: number, s: string): string | null => {
    if (Math.abs(c) < 1e-15) return null
    const cs = coefText(Math.abs(c))
    const factor = cs === '1' ? `(${s})` : `${cs}(${s})`
    return factor
  }
  let out = ''
  const push = (c: number, t: string | null): void => {
    if (t === null) return
    if (out === '') out = c < 0 ? `−${t}` : t
    else out += c < 0 ? ` − ${t}` : ` + ${t}`
  }
  push(obj.p, term(obj.p, xs))
  push(obj.q, term(obj.q, ys))
  if (Math.abs(obj.k) > 1e-15) push(obj.k, coefText(Math.abs(obj.k)))
  if (out === '') out = '0'
  return `${out} = ${valueText(value, exact)}`
}

/** Evaluate P at every corner and say where (whether) it is optimal. */
export function optimize(region: FeasibleRegion, obj: Objective, goal: Goal): LpResult {
  const word = goal === 'max' ? 'maximum' : 'minimum'
  if (region.status === 'empty') {
    return { status: 'empty', rows: [], sentence: 'No solution: the constraints have no point in common, so there is nothing to optimize.' }
  }
  const sgn = goal === 'max' ? 1 : -1
  const rows: LpRow[] = region.vertices.map((v) => {
    const exact = evalExact(obj, v)
    const value = exact ? fval(exact) : obj.p * v.x + obj.q * v.y + obj.k
    return { vertex: v, value, exact, work: workText(obj, v, value, exact), best: false }
  })
  const pn = Math.hypot(obj.p, obj.q)
  if (pn === 0) {
    return {
      status: 'optimal',
      rows,
      value: obj.k,
      valueText: valueText(obj.k, toFrac(obj.k)),
      at: region.vertices,
      along: 'edge',
      attained: true,
      sentence: `${obj.name} is the constant ${valueText(obj.k, toFrac(obj.k))} everywhere in the region.`,
    }
  }
  // Unbounded in a direction P improves: no optimum.
  const grows = region.rays.some((d) => (sgn * (obj.p * d.x + obj.q * d.y)) / pn > 1e-9)
  if (grows || region.vertices.length === 0) {
    if (!grows && region.parallel) {
      return {
        status: 'optimal',
        rows,
        at: [],
        along: 'edge',
        attained: true,
        sentence: `${obj.name} is constant along the boundary lines; its ${word} is taken along a whole line.`,
      }
    }
    return {
      status: 'none',
      rows,
      sentence: `No ${word}: the region is unbounded and ${obj.name} ${goal === 'max' ? 'grows' : 'falls'} without bound in it.${
        region.vertices.length > 0 ? ` Try the ${goal === 'max' ? 'minimum' : 'maximum'}.` : ''
      }`,
    }
  }
  let best = -Infinity
  for (const r of rows) best = Math.max(best, sgn * r.value)
  const tol = 1e-9 * (1 + Math.abs(best))
  const winners = rows.filter((r) => Math.abs(sgn * r.value - best) <= tol)
  for (const r of winners) r.best = true
  const at = winners.map((r) => r.vertex)
  const value = winners[0].value
  const vText = valueText(value, winners[0].exact)
  // A ray along which P is constant, leaving an optimal corner.
  const flatRay = region.rays.find((d) => Math.abs(obj.p * d.x + obj.q * d.y) / pn <= 1e-9)
  const attained = at.every((v) => !v.onStrict)
  let along: LpResult['along'] = 'corner'
  let sentence: string
  if (winners.length >= 2) {
    along = 'edge'
    const [a, b] = [at[0], at[at.length - 1]]
    sentence = `${word[0].toUpperCase()}${word.slice(1)} ${obj.name} = ${vText} at ${a.label} and ${b.label} — and at every point of the edge between them (multiple optimal solutions).`
  } else if (flatRay) {
    along = 'ray'
    sentence = `${word[0].toUpperCase()}${word.slice(1)} ${obj.name} = ${vText}, at ${at[0].label} and along the whole boundary ray from it (multiple optimal solutions).`
  } else {
    sentence = `${word[0].toUpperCase()}${word.slice(1)} ${obj.name} = ${vText} at ${at[0].label}.`
  }
  if (!attained) {
    sentence += ` That corner is on a dashed (strict) boundary, so ${obj.name} gets as close to ${vText} as you like but never reaches it.`
  }
  return { status: 'optimal', rows, value, valueText: vText, at, along, attained, sentence }
}

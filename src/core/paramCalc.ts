// ============================================================================
// src/core/paramCalc.ts — parametric and polar CALCULUS, the AP Calculus BC
// Unit 9 way: the formulas written out, the values at a chosen t exact.
//
// src/core/motion.ts already reads a parametric or polar curve as a moving
// point, numerically: the particle's velocity, speed and acceleration at t,
// the horizontal / vertical tangents and singular points of the whole
// interval, the arc length of the whole interval, the polar area ½∫r²dθ.
// This module is the other half — what a BC student WRITES:
//
//   paramSymbolic(src, curve, models)   the typed line differentiated in t
//       (or θ): dx/dt, dy/dt, dy/dx = (dy/dt)/(dx/dt) and
//       d²y/dx² = (d/dt(dy/dx))/(dx/dt), simplified; for polar also r′ and
//       x = r cos θ, y = r sin θ, with dx/dθ = r′cos θ − r sin θ and
//       dy/dθ = r′sin θ + r cos θ. Null for a sketch, a line that calls
//       another curve, or anything the differentiator has no rule for — the
//       trees are CHECKED against the curve's own model before they are
//       believed, so a named call read as a product can never print.
//   atParam(curve, models, sym, t)      everything at one t: the point,
//       dx/dt, dy/dt, dy/dx, d²y/dx², the tangent line in point-slope form,
//       speed, velocity ⟨x′, y′⟩ and acceleration ⟨x″, y″⟩ — exact when the
//       formula makes them exact (evaluated in double precision from the
//       symbolic trees, then recognised by exact.ts) — and for polar r, r′
//       and what r′ says about the pole. At a singular point (both
//       derivatives 0) the 0/0 is SAID, with the limit of the simplified
//       dy/dx and whether the particle turns back (a cusp).
//   arcLengthOf(curve, models, sym, a, b)   L = ∫ₐᵇ √(x′² + y′²) dt (polar:
//       √(r² + r′²) dθ) written out, its value and exact form, and — for a
//       parametric curve — the displacement beside the distance travelled.
//   polarAreaFormula(sym, a, b)         ½∫ₐᵇ r² dθ written with r.
//   polarIntersections / defaultBetweenBounds / polarBetween / betweenRegion
//       the region inside one polar curve and outside another: where they
//       meet (exact θ when the curves agree with a closed form there), the
//       integral ½∫(R² − r²) dθ written out, its value, and the polygon the
//       board shades.
// ============================================================================

import type { FittedCurve, ModelSpec, Vec2 } from './types'
import { parseExpression, parametricComponentAsts, polarBodyAst } from './parse'
import type { ExprNode } from './parse'
import {
  D,
  N,
  ONE,
  ZERO,
  add,
  div,
  evalS,
  fn,
  fromAst,
  isN,
  mul,
  neg,
  pow,
  printIn,
  sub,
  tex as texS,
  text as textS,
} from './symbolic'
import type { S } from './symbolic'
import { exactForm, verifiedExact } from './exact'
import { coordForm, pointSlopeText, pointText } from './implicitDiff'
import { critical, integrate, paramArcLength, paramState, trackOf, zerosOf } from './motion'
import type { Track } from './motion'

const MINUS = '−'
const TWO_PI = 2 * Math.PI

export type PKind = 'parametric' | 'polar'

/** Something printed two ways: Unicode for the card and a tooltip, KaTeX for the typeset line. */
export interface Formula {
  text: string
  tex: string
}

/** A number as the card prints it. */
export interface Val {
  value: number
  text: string
  tex: string
  exact: boolean
}

// ============================================================================
// Symbolic
// ============================================================================

export interface ParamSym {
  kind: PKind
  /** Position: x(t), y(t) — for polar r(θ)cos θ and r(θ)sin θ. */
  X: S
  Y: S
  /** Polar only: r(θ) and dr/dθ. */
  R: S | null
  dR: S | null
  /** dx/dt, dy/dt (dx/dθ, dy/dθ). */
  dX: S
  dY: S
  /** x″, y″; null when the differentiator has no rule. */
  ddX: S | null
  ddY: S | null
  /** dy/dx, simplified. */
  slope: S
  /** d²y/dx² = (d/dt(dy/dx)) / (dx/dt), simplified; null when it cannot be formed. */
  second: S | null
  /** The sliders' values, by name. */
  params: Readonly<Record<string, number>>
}

const VAR: S = { t: 'x' }

/** The tree with variable `from` (t, theta) renamed x — the differentiator's variable. */
function renameVar(n: ExprNode, from: string): ExprNode {
  const go = (u: unknown): unknown => {
    if (Array.isArray(u)) return u.map(go)
    if (u && typeof u === 'object') {
      const o = u as Record<string, unknown>
      if (o.t === 'var') return o.name === from ? { t: 'var', name: 'x' } : o
      if (o.t === 'ucall') return o // a named call: fromAst refuses it
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(o)) out[k] = typeof o[k] === 'object' ? go(o[k]) : o[k]
      return out
    }
    return u
  }
  return go(n) as ExprNode
}

/** s at t, the sliders at their values. */
export function evalAt(sym: ParamSym, s: S, t: number): number {
  try {
    const v = evalS(s, { x: t, y: Number.NaN, yp: Number.NaN, p: (name) => sym.params[name] ?? Number.NaN })
    return typeof v === 'number' ? v : Number.NaN
  } catch {
    return Number.NaN
  }
}

// ---- simplifying ----------------------------------------------------------
//
// symbolic.ts's constructors already fold numbers and merge like factors of a
// product. Three more things turn a derivative into the line a teacher
// writes, and they live here rather than there so nothing that prints today
// can change:
//   * LIKE TERMS of a sum are combined (2cos θ sin θ + 2sin θ cos θ →
//     4sin θ cos θ), a product of a sum distributed when that is small, and
//     sin²u + cos²u → 1 (the circle's d²y/dx² is −1/sin³t, not a page);
//   * a SUM AS A FACTOR is keyed up to sign, so (cos t − 1)/(1 − cos t)³
//     cancels to −1/(1 − cos t)² (the cycloid);
//   * an integer common to every term of a sum comes out in front, so
//     4sin θ cos θ/(2cos²θ − 2sin²θ) reduces to 2sin θ cos θ/(cos²θ − sin²θ).
// Every simplified tree is checked against the one it came from at several
// points before it replaces it.

interface Fac {
  b: S
  e: number
  /** Orientation of `b` against its canonical key (a sum and its negative share a key). */
  o: 1 | -1
}
interface Term {
  c: number
  fs: Map<string, Fac>
}

const keyOf = (s: S): string => textS(s)

function flatten(s: S, sign: 1 | -1, out: { s: S; sign: 1 | -1 }[]): void {
  if (s.t === 'add' || s.t === 'sub') {
    flatten(s.a, sign, out)
    flatten(s.b, s.t === 'sub' ? ((-sign) as 1 | -1) : sign, out)
  } else if (s.t === 'neg') flatten(s.a, (-sign) as 1 | -1, out)
  else out.push({ s, sign })
}

function sigOf(fs: Map<string, Fac>, skip?: string): string {
  const parts: string[] = []
  for (const [k, f] of fs) if (f.e !== 0 && k !== skip) parts.push(`${k}^${f.e}`)
  return parts.sort().join('*')
}

const tidyNum = (v: number): number => Number(v.toPrecision(12))

/** A sum's canonical key and its orientation against it; null for anything else. */
function sumKey(s: S): { key: string; sign: 1 | -1 } | null {
  if (s.t !== 'add' && s.t !== 'sub') return null
  const pieces: { s: S; sign: 1 | -1 }[] = []
  flatten(s, 1, pieces)
  const items = pieces.map((p) => {
    const t = termOf(p.s)
    return { sig: sigOf(t.fs), c: tidyNum(t.c * p.sign) }
  })
  items.sort((p, q) => (p.sig < q.sig ? -1 : p.sig > q.sig ? 1 : p.c - q.c))
  if (items.length === 0) return null
  const sign: 1 | -1 = items[0].c < 0 ? -1 : 1
  return { key: `Σ[${items.map((i) => `${tidyNum(i.c * sign)}·${i.sig}`).join('+')}]`, sign }
}

/** A product / quotient as coefficient × factors with integer exponents. */
function termOf(s: S): Term {
  const t: Term = { c: 1, fs: new Map() }
  const put = (u: S, e: number): void => {
    const sk = sumKey(u)
    const key = sk ? sk.key : keyOf(u)
    const o: 1 | -1 = sk ? sk.sign : 1
    const f = t.fs.get(key)
    if (f) {
      if (f.o !== o && Math.abs(e) % 2 === 1) t.c = -t.c
      f.e += e
    } else t.fs.set(key, { b: u, e, o })
  }
  const go = (u: S, e: number): void => {
    switch (u.t) {
      case 'n':
        t.c *= Math.pow(u.v, e)
        return
      case 'neg':
        if (Math.abs(e) % 2 === 1) t.c = -t.c
        go(u.a, e)
        return
      case 'mul':
        go(u.a, e)
        go(u.b, e)
        return
      case 'div':
        go(u.a, e)
        go(u.b, -e)
        return
      case 'pow':
        if (isN(u.b) && Number.isInteger(u.b.v) && !isN(u.a)) {
          go(u.a, e * u.b.v)
          return
        }
        break
      default:
        break
    }
    put(u, e)
  }
  go(s, 1)
  return t
}

/** p/q for a coefficient that is one (q ≤ 1000). */
function fraction(v: number): { p: number; q: number } | null {
  if (!Number.isFinite(v)) return null
  for (let q = 1; q <= 1000; q++) {
    const p = Math.round(v * q)
    if (Math.abs(p / q - v) <= 1e-12 * Math.max(1, Math.abs(v)) && Math.abs(p) <= 1e7) return { p, q }
  }
  return null
}

function buildTerm(c: number, fs: Map<string, Fac>): S {
  const cc = tidyNum(c)
  if (cc === 0 || !Number.isFinite(cc)) return Number.isFinite(cc) ? ZERO : N(cc)
  const fr = fraction(Math.abs(cc))
  let top: S = fr ? N(fr.p) : N(Math.abs(cc))
  let bot: S = fr && fr.q !== 1 ? N(fr.q) : ONE
  for (const f of fs.values()) {
    if (f.e === 0) continue
    const pe = Math.abs(f.e)
    // (cos t − 1)² reads better as (1 − cos t)²: under an even power, a sum
    // whose number is negative is written the other way round
    let base = f.b
    if (pe % 2 === 0 && (base.t === 'add' || base.t === 'sub')) {
      const parts: { s: S; sign: 1 | -1 }[] = []
      flatten(base, 1, parts)
      const k = parts.find((p) => p.s.t === 'n')
      if (k && k.s.t === 'n' && k.s.v * k.sign < 0) base = combineSum(neg(base))
    }
    const piece = pe === 1 ? base : pow(base, N(pe))
    if (f.e > 0) top = mul(top, piece)
    else bot = mul(bot, piece)
  }
  const out = isN(bot, 1) ? top : div(top, bot)
  return cc < 0 ? neg(out) : out
}

const MAX_EXPAND = 12

/** c · (A + B + …) · rest → c·A·rest + c·B·rest + …, when that stays small. */
function expand(t: Term): Term[] {
  for (const [k, f] of t.fs) {
    if (f.e !== 1 || (f.b.t !== 'add' && f.b.t !== 'sub')) continue
    const pieces: { s: S; sign: 1 | -1 }[] = []
    flatten(f.b, 1, pieces)
    if (pieces.length > MAX_EXPAND) return [t]
    const rest = new Map(t.fs)
    rest.delete(k)
    const restS = buildTerm(1, rest)
    const out: Term[] = []
    for (const p of pieces) {
      const u = termOf(mul(p.s, restS))
      u.c *= t.c * p.sign
      out.push(...expand(u))
      if (out.length > MAX_EXPAND) return [t]
    }
    return out
  }
  return [t]
}

function gcd(a: number, b: number): number {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b > 0) [a, b] = [b, a % b]
  return a
}

/** A sum with like terms combined, sin² + cos² = 1, and an integer factor pulled out. */
function combineSum(s: S): S {
  const pieces: { s: S; sign: 1 | -1 }[] = []
  flatten(s, 1, pieces)
  let terms: Term[] = []
  for (const p of pieces) {
    const t = termOf(p.s)
    t.c *= p.sign
    terms.push(t)
  }
  const expanded: Term[] = []
  for (const t of terms) expanded.push(...expand(t))
  if (expanded.length <= MAX_EXPAND * 2) terms = expanded

  const bySig = new Map<string, Term>()
  const add1 = (t: Term): void => {
    const k = sigOf(t.fs)
    const hit = bySig.get(k)
    if (hit) hit.c += t.c
    else bySig.set(k, { c: t.c, fs: new Map([...t.fs].filter(([, f]) => f.e !== 0)) })
  }
  for (const t of terms) add1(t)

  // sin²u·X + cos²u·X = X
  for (let guard = 0; guard < 8; guard++) {
    let changed = false
    outer: for (const [k1, t1] of bySig) {
      if (Math.abs(t1.c) < 1e-300) continue
      for (const [fk, f] of t1.fs) {
        if (f.e !== 2 || f.b.t !== 'fn' || f.b.fn !== 'sin') continue
        const want = `cos(${keyOf(f.b.a)})`
        const rest = sigOf(t1.fs, fk)
        for (const [k2, t2] of bySig) {
          if (k2 === k1) continue
          const cf = t2.fs.get(want)
          if (!cf || cf.e !== 2 || sigOf(t2.fs, want) !== rest) continue
          if (Math.abs(t1.c - t2.c) > 1e-12 * Math.max(1, Math.abs(t1.c))) continue
          const c = t1.c
          const fs = new Map(t1.fs)
          fs.delete(fk)
          bySig.delete(k1)
          bySig.delete(k2)
          add1({ c, fs })
          changed = true
          break outer
        }
      }
    }
    if (!changed) break
  }

  const kept = [...bySig.values()].filter((t) => Math.abs(tidyNum(t.c)) > 0)
  if (kept.length === 0) return ZERO
  // numbers last ("t² − 1", "cos t + 1" read as a class writes them) — unless
  // the number is all there is in front of a single term that leads negative
  kept.sort((p, q) => (p.fs.size === 0 ? 1 : 0) - (q.fs.size === 0 ? 1 : 0))
  const lead = kept.findIndex((t) => t.c > 0)
  if (lead > 0) kept.unshift(...kept.splice(lead, 1))
  const allNeg = kept.every((t) => t.c < 0)
  const sgn = allNeg ? -1 : 1
  const ints = kept.every((t) => Number.isInteger(tidyNum(t.c)))
  const g = ints && kept.length > 1 ? kept.reduce((acc, t) => gcd(acc, tidyNum(t.c)), 0) : 1
  const scale = sgn * (g > 1 ? g : 1)
  let out: S | null = null
  for (const t of kept) {
    const body = buildTerm(Math.abs(t.c / scale), t.fs)
    const minus = t.c / scale < 0
    if (out === null) out = minus ? neg(body) : body
    else out = minus ? sub(out, body) : add(out, body)
  }
  let res: S = out ?? ZERO
  if (Math.abs(scale) !== 1) res = mul(N(Math.abs(scale)), res)
  return scale < 0 ? neg(res) : res
}

function tidyRec(s: S): S {
  switch (s.t) {
    case 'n':
    case 'c':
    case 'x':
    case 'y':
    case 'yp':
    case 'p':
      return s
    case 'neg':
      return neg(tidyRec(s.a))
    case 'add':
    case 'sub':
      return combineSum({ t: s.t, a: tidyRec(s.a), b: tidyRec(s.b) })
    case 'mul':
    case 'div': {
      const raw: S = s.t === 'mul' ? { t: 'mul', a: tidyRec(s.a), b: tidyRec(s.b) } : { t: 'div', a: tidyRec(s.a), b: tidyRec(s.b) }
      const t = termOf(raw)
      return buildTerm(t.c, t.fs)
    }
    case 'pow':
      return pow(tidyRec(s.a), tidyRec(s.b))
    case 'fn':
      return fn(s.fn, tidyRec(s.a))
  }
}

/** Two trees in the one variable that agree at several points (sliders at their values). */
function agree(a: S, b: S, params: Readonly<Record<string, number>>): boolean {
  let finite = 0
  for (let i = 0; i < 9; i++) {
    const x = 0.31 + 0.67 * i
    const env = { x, y: Number.NaN, yp: Number.NaN, p: (n: string) => params[n] ?? 1.3 }
    const u = evalS(a, env)
    const v = evalS(b, env)
    if (!Number.isFinite(u) && !Number.isFinite(v)) continue
    if (!Number.isFinite(u) || !Number.isFinite(v)) return false
    if (Math.abs(u - v) > 1e-8 * Math.max(1, Math.abs(u), Math.abs(v))) return false
    finite++
  }
  return finite >= 3
}

/** The simplest tree this module can make of s — never one that disagrees with it. */
export function tidy(s: S, params: Readonly<Record<string, number>> = {}): S {
  let out: S
  try {
    out = tidyRec(s)
  } catch {
    return s
  }
  // twice: a sum that only became like-termed after its factors settled
  try {
    const again = tidyRec(out)
    if (agree(again, s, params)) out = again
  } catch {
    /* keep the first pass */
  }
  return agree(out, s, params) ? out : s
}

/** Two trees with the same printed line. */
const sameText = (a: S, b: S): boolean => textS(a) === textS(b)

/** d/dt, tidied; null when the differentiator has no rule for a piece. */
function Dt(s: S, params: Readonly<Record<string, number>>): S | null {
  const d = D(s)
  return d ? tidy(d, params) : null
}

/** How far a tree built from the line may disagree with the curve's model and still be it. */
function matches(u: number, v: number): boolean {
  if (!Number.isFinite(u) && !Number.isFinite(v)) return true
  if (!Number.isFinite(u) || !Number.isFinite(v)) return false
  return Math.abs(u - v) <= 1e-9 * Math.max(1, Math.abs(u), Math.abs(v))
}

/**
 * The typed line differentiated, or null. `src` is the line as typed; a
 * sketch (no line), a line that calls another curve, and a line with a piece
 * the differentiator does not know all come back null — and so does any tree
 * that does not reproduce the curve's own model at several t, which is what
 * makes it safe to parse without the board's env.
 */
export function paramSymbolic(
  src: string | null | undefined,
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
): ParamSym | null {
  if (!src || !curve) return null
  const tr = trackOf(curve, models)
  if (!tr || (tr.kind !== 'parametric' && tr.kind !== 'polar')) return null
  let names: string[] = []
  try {
    const o = parseExpression(src)
    if (!o.ok || o.plot.kind !== tr.kind) return null
    names = o.plot.paramNames
  } catch {
    return null
  }
  const params: Record<string, number> = {}
  names.forEach((n, i) => {
    params[n] = curve.params[i]
  })
  let X: S | null = null
  let Y: S | null = null
  let R: S | null = null
  if (tr.kind === 'parametric') {
    const asts = parametricComponentAsts(src)
    if (!asts) return null
    X = fromAst(renameVar(asts.x, 't'))
    Y = fromAst(renameVar(asts.y, 't'))
  } else {
    const body = polarBodyAst(src)
    if (!body) return null
    R = fromAst(renameVar(body, 'theta'))
    if (R) {
      X = mul(R, fn('cos', VAR))
      Y = mul(R, fn('sin', VAR))
    }
  }
  if (!X || !Y) return null
  const env = (t: number) => ({ x: t, y: Number.NaN, yp: Number.NaN, p: (n: string) => params[n] ?? Number.NaN })

  // The trees must BE the curve: agree with its model at several t.
  const [a, b] = tr.interval
  let ok = 0
  for (let i = 0; i < 9; i++) {
    const t = a + ((b - a) * (i + 0.37)) / 9
    const mx = tr.X(t)
    const my = tr.Y(t)
    const sx = evalS(X, env(t))
    const sy = evalS(Y, env(t))
    if (!matches(sx, mx) || !matches(sy, my)) return null
    if (Number.isFinite(mx) && Number.isFinite(my)) ok++
  }
  if (ok < 3) return null

  let dX: S | null
  let dY: S | null
  let dR: S | null = null
  if (R) {
    dR = Dt(R, params)
    if (!dR) return null
    const cos: S = fn('cos', VAR)
    const sin: S = fn('sin', VAR)
    dX = tidy(sub(mul(dR, cos), mul(R, sin)), params)
    dY = tidy(add(mul(dR, sin), mul(R, cos)), params)
  } else {
    dX = Dt(X, params)
    dY = Dt(Y, params)
  }
  if (!dX || !dY) return null
  const ddX = Dt(dX, params)
  const ddY = Dt(dY, params)
  const slope = tidy(div(dY, dX), params)
  const dSlope = D(slope)
  const second = dSlope ? tidy(div(dSlope, dX), params) : null
  return { kind: tr.kind, X, Y, R, dR, dX, dY, ddX, ddY, slope, second, params }
}

// ---- printing --------------------------------------------------------------

const varText = (kind: PKind): string => (kind === 'polar' ? 'θ' : 't')
const varTex = (kind: PKind): string => (kind === 'polar' ? '\\theta' : 't')

/** Mark a coefficient-times-one-thing over a number as tight: 3t/2, not (3t)/2. */
function tighten(s: S): S {
  switch (s.t) {
    case 'neg':
      return { t: 'neg', a: tighten(s.a) }
    case 'add':
    case 'sub':
    case 'mul':
    case 'pow':
      return { t: s.t, a: tighten(s.a), b: tighten(s.b) }
    case 'div': {
      const a = tighten(s.a)
      const b = tighten(s.b)
      const tight =
        a.t === 'mul' && a.a.t === 'n' && ['x', 'c', 'p', 'fn', 'pow'].includes(a.b.t) ? true : undefined
      return tight ? { t: 'div', a, b, tight } : { t: 'div', a, b }
    }
    case 'fn':
      return { t: 'fn', fn: s.fn, a: tighten(s.a) }
    default:
      return s
  }
}

/** A tree as a formula in t (θ for polar). */
export function formulaOf(kind: PKind, s: S): Formula {
  return printIn(varText(kind), varTex(kind), () => ({ text: textS(tighten(s)), tex: texS(s) }))
}

/** (u)² printed as written — never simplified into something the student did not write. */
function squared(s: S): S {
  return { t: 'pow', a: s, b: N(2) }
}

// ============================================================================
// Numbers
// ============================================================================

const decimal = (v: number): string => {
  if (!Number.isFinite(v)) return 'undefined'
  let r = Number(v.toFixed(3))
  if (Object.is(r, -0)) r = 0
  return r < 0 ? MINUS + String(-r) : String(r)
}

/** A value: exact when it is one (precise values at 1e-9, measured ones tighter). */
export function valOf(v: number, precise = true): Val {
  if (!Number.isFinite(v)) return { value: v, text: 'undefined', tex: '\\text{undefined}', exact: false }
  if (Math.abs(v) < 1e-13) return { value: 0, text: '0', tex: '0', exact: true }
  const f = coordForm(v, undefined, precise ? 1e-9 : 1e-11)
  return { value: v, text: f.text, tex: f.tex, exact: f.exact }
}

/** A bound or a parameter value as a class writes it: π/4, 2π, 1, 0.35. */
export function boundOf(v: number): Val {
  if (!Number.isFinite(v)) return { value: v, text: '—', tex: '—', exact: false }
  if (Math.abs(v) < 1e-13) return { value: 0, text: '0', tex: '0', exact: true }
  const e = exactForm(v)
  if (e) return { value: e.value, text: e.text, tex: e.tex, exact: true }
  let t = String(Number(v.toPrecision(6)))
  if (t.startsWith('-')) t = MINUS + t.slice(1)
  return { value: v, text: t, tex: t.replace(MINUS, '-'), exact: false }
}

/** An integral's value: matched to a closed form at 1e-9 (the quadrature is good to ~1e-12). */
export function integralVal(v: number): Val {
  if (!Number.isFinite(v)) return { value: v, text: 'undefined', tex: '\\text{undefined}', exact: false }
  if (Math.abs(v) < 1e-12) return { value: 0, text: '0', tex: '0', exact: true }
  const e = exactForm(v, { tol: 1e-9 })
  if (e) return { value: e.value, text: e.text, tex: e.tex, exact: true }
  return { value: v, text: decimal(v), tex: decimal(v).replace(MINUS, '-'), exact: false }
}

/** "= 3π/2 ≈ 4.712" / "≈ 4.712" — the value after an integral sign. */
export function equalsText(v: Val): Formula {
  const dec = decimal(v.value)
  if (v.exact && v.text !== dec) return { text: `= ${v.text} ≈ ${dec}`, tex: `= ${v.tex} \\approx ${dec.replace(MINUS, '-')}` }
  if (v.exact) return { text: `= ${v.text}`, tex: `= ${v.tex}` }
  return { text: `≈ ${dec}`, tex: `\\approx ${dec.replace(MINUS, '-')}` }
}

// ============================================================================
// At one t
// ============================================================================

export interface AtParam {
  kind: PKind
  t: number
  tVal: Val
  pos: Vec2
  point: Formula
  /** dx/dt, dy/dt (dx/dθ, dy/dθ). */
  dx: Val
  dy: Val
  /** dy/dx; null at a vertical tangent or a singular point. */
  slope: Val | null
  /** d²y/dx²; null with the slope, or when it cannot be formed. */
  second: Val | null
  /** dx/dt = 0, dy/dt ≠ 0. */
  vertical: boolean
  /** dx/dt = dy/dt = 0. */
  singular: boolean
  /** The tangent line (point-slope, or x = c), null at a singular point. */
  tangent: Formula | null
  /** The tangent's slope for drawing: a number, Infinity for vertical, null for none. */
  drawSlope: number | null
  speed: Val
  velocity: [Val, Val]
  acceleration: [Val, Val] | null
  /** Polar only. */
  r?: Val
  dr?: Val
  /** Polar only: what r′ says about the pole. */
  drSentence?: string
  /** At a singular point: the 0/0 said, the limit, and whether it is a cusp. */
  notes: string[]
  /** Whether the numbers came from the typed formula (exact) or from the model (measured). */
  symbolic: boolean
}

/** What dr/dθ says: moving toward or away from the pole. */
export function drSentence(r: number, dr: number, scale = 1): string {
  const tiny = 1e-10 * Math.max(1, scale)
  if (Math.abs(r) <= tiny) return 'r = 0: the point is at the pole.'
  if (Math.abs(dr) <= tiny) {
    return 'dr/dθ = 0: r is not changing at this instant, so the point is moving neither toward nor away from the pole.'
  }
  if (r > 0) {
    return dr > 0
      ? 'dr/dθ > 0 and r > 0: r is increasing, so the point is moving away from the pole.'
      : 'dr/dθ < 0 and r > 0: r is decreasing, so the point is moving toward the pole.'
  }
  return dr > 0
    ? 'dr/dθ > 0 but r < 0: |r| is decreasing, so the point is moving toward the pole.'
    : 'dr/dθ < 0 and r < 0: |r| is increasing, so the point is moving away from the pole.'
}

/** The four numbers at t, from the formula when there is one, else from the model. */
function jetAt(
  tr: Track,
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  sym: ParamSym | null,
  t: number,
): { x: number; y: number; dx: number; dy: number; ddx: number; ddy: number; r?: number; dr?: number } {
  if (sym) {
    const e = (s: S | null): number => (s ? evalAt(sym, s, t) : Number.NaN)
    const out = { x: e(sym.X), y: e(sym.Y), dx: e(sym.dX), dy: e(sym.dY), ddx: e(sym.ddX), ddy: e(sym.ddY) }
    if (!Number.isFinite(out.ddx) || !Number.isFinite(out.ddy)) {
      const st = paramState(curve, models, t)
      out.ddx = st.acceleration.x
      out.ddy = st.acceleration.y
    }
    return sym.R ? { ...out, r: e(sym.R), dr: e(sym.dR) } : out
  }
  const st = paramState(curve, models, t)
  const out = {
    x: st.pos.x,
    y: st.pos.y,
    dx: st.velocity.x,
    dy: st.velocity.y,
    ddx: st.acceleration.x,
    ddy: st.acceleration.y,
  }
  return tr.kind === 'polar' ? { ...out, r: st.r, dr: st.drdt } : out
}

/**
 * The tangent line in point-slope form. implicitDiff's pointSlopeText, except
 * that a slope which is itself a sum or difference (1 − √2) is bracketed —
 * "y − 1.207 = (1 − √2)(x − 1.207)", never the ambiguous "1 − √2 (x − …)".
 */
export function tangentText(p: Vec2, m: number | null): Formula {
  const f = pointSlopeText(p, m)
  if (m === null) return { text: f.text, tex: f.tex }
  const k = coordForm(m)
  const compound = /[+−-]/.test(k.text.slice(1))
  if (!compound || Math.abs(p.x) < 1e-15) {
    if (!compound) return { text: f.text, tex: f.tex }
    const lhs = f.text.split(' = ')[0]
    const lhsTex = f.tex.split(' = ')[0]
    return { text: `${lhs} = (${k.text})x`, tex: `${lhsTex} = \left(${k.tex}\right)x` }
  }
  const x = coordForm(p.x, undefined, 1e-9, true)
  const neg = x.value < 0
  const body = neg ? x.text.replace(MINUS, '') : x.text
  const bodyTex = neg ? x.tex.replace(/^-/, '') : x.tex
  const lhs = f.text.split(' = ')[0]
  const lhsTex = f.tex.split(' = ')[0]
  return {
    text: `${lhs} = (${k.text})(x ${neg ? '+' : MINUS} ${body})`,
    tex: `${lhsTex} = \left(${k.tex}\right)\left(x ${neg ? '+' : '-'} ${bodyTex}\right)`,
  }
}

/**
 * Everything at one t. Null when the curve has no point there (outside where
 * its formula is defined, or not a parametric / polar curve at all).
 */
export function atParam(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  sym: ParamSym | null,
  t: number,
): AtParam | null {
  const tr = trackOf(curve, models)
  if (!tr || (tr.kind !== 'parametric' && tr.kind !== 'polar') || !Number.isFinite(t)) return null
  const kind: PKind = tr.kind
  const j = jetAt(tr, curve, models, sym, t)
  if (!Number.isFinite(j.x) || !Number.isFinite(j.y)) return null
  const precise = sym !== null
  const scale = Math.max(1, Math.abs(j.x), Math.abs(j.y), Math.abs(j.dx), Math.abs(j.dy))
  const tiny = (precise ? 1e-12 : 1e-8) * scale
  const xZero = !(Math.abs(j.dx) > tiny)
  const yZero = !(Math.abs(j.dy) > tiny)
  const singular = xZero && yZero
  const vertical = xZero && !yZero
  const v = varText(kind)

  let slope: Val | null = null
  let second: Val | null = null
  if (!xZero && Number.isFinite(j.dx) && Number.isFinite(j.dy)) {
    slope = valOf(j.dy / j.dx, precise)
    let c = Number.NaN
    if (sym?.second) c = evalAt(sym, sym.second, t)
    if (!Number.isFinite(c)) c = (j.ddy * j.dx - j.dy * j.ddx) / (j.dx * j.dx * j.dx)
    if (Number.isFinite(c)) second = valOf(c, precise && sym?.second !== null)
  }
  const pos = { x: j.x, y: j.y }
  const pt = pointText(pos)
  let tangent: Formula | null = null
  let drawSlope: number | null = null
  if (!singular) {
    tangent = tangentText(pos, vertical ? null : (slope?.value ?? null))
    drawSlope = vertical ? Infinity : (slope?.value ?? null)
  }
  const speedV = Math.hypot(j.dx, j.dy)
  const out: AtParam = {
    kind,
    t,
    tVal: boundOf(t),
    pos,
    point: { text: pt.text, tex: pt.tex },
    dx: valOf(xZero ? 0 : j.dx, precise),
    dy: valOf(yZero ? 0 : j.dy, precise),
    slope,
    second,
    vertical,
    singular,
    tangent,
    drawSlope,
    speed: valOf(speedV, precise),
    velocity: [valOf(xZero ? 0 : j.dx, precise), valOf(yZero ? 0 : j.dy, precise)],
    acceleration:
      Number.isFinite(j.ddx) && Number.isFinite(j.ddy) ? [valOf(j.ddx, precise), valOf(j.ddy, precise)] : null,
    notes: [],
    symbolic: precise,
  }
  if (kind === 'polar' && j.r !== undefined && j.dr !== undefined) {
    out.r = valOf(j.r, precise)
    out.dr = valOf(j.dr, precise)
    out.drSentence = drSentence(j.r, j.dr, scale)
  }
  if (singular) out.notes = singularNotes(curve, models, sym, t, out.tVal.text, v)
  else if (vertical) out.notes = [`dx/d${v} = 0 and dy/d${v} ≠ 0: dy/dx is undefined and the tangent line is vertical.`]
  else if (slope && Math.abs(slope.value) < 1e-13) out.notes = [`dy/d${v} = 0 and dx/d${v} ≠ 0: the tangent line is horizontal.`]
  return out
}

/**
 * Both derivatives 0 at t: dy/dx = 0/0 is undetermined there. What the
 * simplified dy/dx tends to, and what the particle does — turn back (a
 * cusp), stop and go on (smooth), or turn a corner.
 */
export function singularNotes(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  sym: ParamSym | null,
  t: number,
  tText: string,
  v: string,
): string[] {
  const tr = trackOf(curve, models)
  const out = [`dx/d${v} = 0 and dy/d${v} = 0 at ${v} = ${tText}, so dy/dx = 0/0 there: undetermined.`]
  if (!tr) return out
  const h = 1e-4 * Math.max(1, Math.abs(t))
  const vel = (u: number): [number, number] => {
    if (sym) return [evalAt(sym, sym.dX, u), evalAt(sym, sym.dY, u)]
    const st = paramState(curve, models, u)
    return [st.velocity.x, st.velocity.y]
  }
  const [lx, ly] = vel(t - h)
  const [rx, ry] = vel(t + h)
  // dy/dx on each side, and the simplified formula AT t — believed only when
  // it agrees with both sides (a formula that is still 0/0 there can print
  // any rounding at all)
  const sl = sym ? evalAt(sym, sym.slope, t - h) : ly / lx
  const sr = sym ? evalAt(sym, sym.slope, t + h) : ry / rx
  const simplified = sym ? evalAt(sym, sym.slope, t) : Number.NaN
  const close = (p: number, q: number): boolean => Math.abs(p - q) <= 1e-2 * Math.max(1, Math.abs(p), Math.abs(q))
  if (Number.isFinite(sl) && Number.isFinite(sr)) {
    const big = 1e3
    if (sym && Number.isFinite(simplified) && close(simplified, sl) && close(simplified, sr)) {
      const f = formulaOf(sym.kind, sym.slope)
      const lim = valOf(simplified).text
      out.push(
        f.text.length <= 40
          ? `The simplified dy/dx = ${f.text} → ${lim} as ${v} → ${tText}.`
          : `dy/dx → ${lim} as ${v} → ${tText}.`,
      )
    } else if (Math.abs(sl) > big && Math.abs(sr) > big) {
      out.push(`|dy/dx| → ∞ as ${v} → ${tText}: the tangent direction there is vertical.`)
    } else if (close(sl, sr)) {
      out.push(`dy/dx → ${decimal((sl + sr) / 2)} (approximately) as ${v} → ${tText}.`)
    } else out.push(`dy/dx tends to different values on the two sides of ${v} = ${tText}.`)
  }
  const nl = Math.hypot(lx, ly)
  const nr = Math.hypot(rx, ry)
  if (nl > 0 && nr > 0 && Number.isFinite(nl) && Number.isFinite(nr)) {
    const dot = (lx * rx + ly * ry) / (nl * nr)
    if (dot < -0.99) out.push('The particle reverses direction there: the curve has a cusp.')
    else if (dot > 0.99) out.push('The particle stops for an instant and moves on the same way: the curve is smooth there.')
    else out.push('The direction of motion turns sharply there: the curve has a corner.')
  } else if (Number.isFinite(nl) && Number.isFinite(nr)) {
    out.push('The particle is at rest around this point.')
  }
  return out
}

// ============================================================================
// Written formulas
// ============================================================================

export interface DerivLines {
  /** "dx/dt = 2t" / "r′ = dr/dθ = −sin θ" … in order. */
  lines: Formula[]
}

/** The derivative block the card typesets: dx/dt, dy/dt, dy/dx, d²y/dx² (polar: r′ and the polar dy/dx). */
export function derivativeLines(sym: ParamSym): Formula[] {
  const f = (s: S): Formula => formulaOf(sym.kind, s)
  const out: Formula[] = []
  if (sym.kind === 'parametric') {
    const dx = f(sym.dX)
    const dy = f(sym.dY)
    out.push({ text: `dx/dt = ${dx.text}`, tex: `\\frac{dx}{dt} = ${dx.tex}` })
    out.push({ text: `dy/dt = ${dy.text}`, tex: `\\frac{dy}{dt} = ${dy.tex}` })
    const sl = f(sym.slope)
    const q: S = { t: 'div', a: sym.dY, b: sym.dX }
    const raw = f(q)
    const mid = sameText(q, sym.slope) ? '' : ` = ${raw.tex}`
    out.push({
      text: `dy/dx = (dy/dt)/(dx/dt) = ${sl.text}`,
      tex: `\\frac{dy}{dx} = \\frac{dy/dt}{dx/dt}${mid} = ${sl.tex}`,
    })
    if (sym.second) {
      const s2 = f(sym.second)
      out.push({
        text: `d²y/dx² = (d/dt(dy/dx))/(dx/dt) = ${s2.text}`,
        tex: `\\frac{d^2y}{dx^2} = \\frac{\\frac{d}{dt}\\left(\\frac{dy}{dx}\\right)}{dx/dt} = ${s2.tex}`,
      })
    }
    return out
  }
  if (sym.R && sym.dR) {
    const r = f(sym.R)
    const dr = f(sym.dR)
    out.push({ text: `r = ${r.text}`, tex: `r = ${r.tex}` })
    out.push({ text: `r′ = dr/dθ = ${dr.text}`, tex: `r' = \\frac{dr}{d\\theta} = ${dr.tex}` })
  }
  out.push({
    text: 'dy/dx = (r′ sin θ + r cos θ)/(r′ cos θ − r sin θ)',
    tex: "\\frac{dy}{dx} = \\frac{dy/d\\theta}{dx/d\\theta} = \\frac{r'\\sin\\theta + r\\cos\\theta}{r'\\cos\\theta - r\\sin\\theta}",
  })
  const sl = f(sym.slope)
  out.push({ text: `dy/dx = ${sl.text}`, tex: `\\frac{dy}{dx} = ${sl.tex}` })
  if (sym.second) {
    const s2 = f(sym.second)
    out.push({
      text: `d²y/dx² = (d/dθ(dy/dx))/(dx/dθ) = ${s2.text}`,
      tex: `\\frac{d^2y}{dx^2} = \\frac{\\frac{d}{d\\theta}\\left(\\frac{dy}{dx}\\right)}{dx/d\\theta} = ${s2.tex}`,
    })
  }
  return out
}

// ============================================================================
// Arc length, displacement, distance
// ============================================================================

export interface ArcResult {
  a: number
  b: number
  aVal: Val
  bVal: Val
  length: Val
  /** L = ∫ₐᵇ √((dx/dt)² + (dy/dt)²) dt = …, written with the formulas when there are any. */
  integral: Formula
  /** Parametric only: the displacement vector and its length. */
  displacement?: { dx: Val; dy: Val; length: Val }
  /** Parametric only: a sentence comparing the two. */
  compare?: string
}

export function arcLengthOf(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  sym: ParamSym | null,
  a: number,
  b: number,
): ArcResult | null {
  const tr = trackOf(curve, models)
  if (!tr || (tr.kind !== 'parametric' && tr.kind !== 'polar')) return null
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return null
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  const L = paramArcLength(curve, models, lo, hi)
  if (!Number.isFinite(L)) return null
  const kind: PKind = tr.kind
  const aVal = boundOf(lo)
  const bVal = boundOf(hi)
  const length = integralVal(L)
  const eq = equalsText(length)
  let body: Formula
  if (sym && kind === 'parametric') {
    const s: S = { t: 'add', a: squared(sym.dX), b: squared(sym.dY) }
    const f = formulaOf(kind, s)
    body = { text: `√(${f.text}) dt`, tex: `\\sqrt{${f.tex}}\\,dt` }
  } else if (sym && sym.R && sym.dR) {
    const s: S = { t: 'add', a: squared(sym.R), b: squared(sym.dR) }
    const f = formulaOf(kind, s)
    body = { text: `√(${f.text}) dθ`, tex: `\\sqrt{${f.tex}}\\,d\\theta` }
  } else if (kind === 'parametric') {
    body = {
      text: '√((dx/dt)² + (dy/dt)²) dt',
      tex: '\\sqrt{\\left(\\frac{dx}{dt}\\right)^2 + \\left(\\frac{dy}{dt}\\right)^2}\\,dt',
    }
  } else {
    body = { text: '√(r² + (dr/dθ)²) dθ', tex: '\\sqrt{r^2 + \\left(\\frac{dr}{d\\theta}\\right)^2}\\,d\\theta' }
  }
  const integral: Formula = {
    text: `L = ∫ from ${aVal.text} to ${bVal.text} of ${body.text} ${eq.text}`,
    tex: `L = \\int_{${aVal.tex}}^{${bVal.tex}} ${body.tex} ${eq.tex}`,
  }
  const out: ArcResult = { a: lo, b: hi, aVal, bVal, length, integral }
  if (kind === 'parametric') {
    const at = (t: number): Vec2 =>
      sym ? { x: evalAt(sym, sym.X, t), y: evalAt(sym, sym.Y, t) } : { x: tr.X(t), y: tr.Y(t) }
    const p = at(lo)
    const q = at(hi)
    const dx = q.x - p.x
    const dy = q.y - p.y
    if ([dx, dy].every(Number.isFinite)) {
      const disp = Math.hypot(dx, dy)
      const precise = sym !== null
      out.displacement = { dx: valOf(dx, precise), dy: valOf(dy, precise), length: valOf(disp, precise) }
      const d = out.displacement.length
      out.compare =
        disp <= 1e-9 * Math.max(1, L)
          ? `The particle ends where it started: the displacement is 0, but the distance travelled is ${length.exact ? length.text : `≈ ${decimal(L)}`}.`
          : L - disp <= 1e-7 * Math.max(1, L)
          ? 'The distance travelled equals the length of the displacement: the particle moves in one straight direction.'
          : `The distance travelled (${length.exact ? length.text : `≈ ${decimal(L)}`}) is more than the length of the displacement (${d.exact ? d.text : `≈ ${decimal(disp)}`}): the path is not one straight run.`
    }
  }
  return out
}

// ============================================================================
// Polar area, one curve
// ============================================================================

/** ½∫ₐᵇ r² dθ written with r (or r itself when there is no formula), and its value. */
export function polarAreaFormula(sym: ParamSym | null, a: number, b: number, value: number): Formula {
  const A = boundOf(Math.min(a, b))
  const B = boundOf(Math.max(a, b))
  const eq = equalsText(integralVal(value))
  let body: Formula = { text: 'r²', tex: 'r^2' }
  if (sym?.R) body = formulaOf('polar', squared(sym.R))
  return {
    text: `½∫ from ${A.text} to ${B.text} of ${body.text} dθ ${eq.text}`,
    tex: `\\frac{1}{2}\\int_{${A.tex}}^{${B.tex}} ${body.tex}\\,d\\theta ${eq.tex}`,
  }
}

// ============================================================================
// Area between two polar curves
// ============================================================================

export interface Meeting {
  t: number
  text: string
  tex: string
  exact: boolean
  pos: Vec2
}

/** The model's r at θ, NaN when it has none. */
function rOf(tr: Track, t: number): number {
  if (!tr.R) return Number.NaN
  try {
    const v = tr.R(t)
    return Number.isFinite(v) ? v : Number.NaN
  } catch {
    return Number.NaN
  }
}

/** The polar interval both curves are searched over: the first's own, at most one turn past its start. */
function searchInterval(tr: Track): [number, number] {
  const [a, b] = tr.interval
  return [a, Math.min(b, a + TWO_PI)]
}

/**
 * The θ where r₁(θ) = r₂(θ) on the first curve's interval (one turn at
 * most), each snapped to a closed form the two curves agree with there.
 * The pole is a meeting point too when both pass through it, at different
 * θ — that one is reported by `bothAtPole`, not here.
 */
export function polarIntersections(
  one: FittedCurve,
  two: FittedCurve,
  models: Record<string, ModelSpec>,
): Meeting[] {
  const t1 = trackOf(one, models)
  const t2 = trackOf(two, models)
  if (!t1?.R || !t2?.R) return []
  const [a, b] = searchInterval(t1)
  const f = (t: number): number => rOf(t1, t) - rOf(t2, t)
  let scale = 0
  for (let i = 0; i <= 64; i++) {
    const t = a + ((b - a) * i) / 64
    for (const r of [rOf(t1, t), rOf(t2, t)]) if (Number.isFinite(r)) scale = Math.max(scale, Math.abs(r))
  }
  if (!(scale > 0)) return []
  const tol = 1e-9 * scale
  const zs = zerosOf(f, a, b, tol)
  const out: Meeting[] = []
  for (const z of zs) {
    const form = verifiedExact(z, (c) => Math.abs(f(c)) <= 1e-9 * scale)
    const t = form ? form.value : z
    // one turn: θ and θ + 2π are the same meeting
    if (out.some((m) => Math.abs(((t - m.t) % TWO_PI + TWO_PI) % TWO_PI) < 1e-7 || Math.abs(((m.t - t) % TWO_PI + TWO_PI) % TWO_PI) < 1e-7)) continue
    const r = rOf(t1, t)
    const pos = { x: r * Math.cos(t), y: r * Math.sin(t) }
    const bv = boundOf(t)
    out.push({ t, text: form ? form.text : bv.text, tex: form ? form.tex : bv.tex, exact: form !== null, pos })
  }
  return out.sort((p, q) => p.t - q.t)
}

/** Whether both curves pass through the pole (a meeting the θ-equation misses). */
export function bothAtPole(one: FittedCurve, two: FittedCurve, models: Record<string, ModelSpec>): boolean {
  const atPole = (c: FittedCurve): boolean => {
    const tr = trackOf(c, models)
    if (!tr?.R) return false
    const [a, b] = searchInterval(tr)
    let scale = 0
    for (let i = 0; i <= 64; i++) {
      const r = rOf(tr, a + ((b - a) * i) / 64)
      if (Number.isFinite(r)) scale = Math.max(scale, Math.abs(r))
    }
    if (!(scale > 0)) return false
    return zerosOf((t) => rOf(tr, t), a, b, 1e-9 * scale).length > 0
  }
  return atPole(one) && atPole(two)
}

/**
 * The region inside `outer` and outside `inner`: the first stretch between
 * consecutive meetings where the outer r is positive and beats the inner
 * one — inside r = 3 sin θ, outside r = 1 + sin θ: [π/6, 5π/6]. On a full
 * turn the stretch across the end of the interval counts too. Null when the
 * curves do not meet, or no stretch has the outer curve outside.
 */
export function defaultBetweenBounds(
  outer: FittedCurve,
  inner: FittedCurve,
  models: Record<string, ModelSpec>,
): [number, number] | null {
  const to = trackOf(outer, models)
  const ti = trackOf(inner, models)
  if (!to?.R || !ti?.R) return null
  const ms = polarIntersections(outer, inner, models).map((m) => m.t)
  if (ms.length < 1) return null
  const [a, b] = searchInterval(to)
  const pairs: [number, number][] = []
  for (let i = 0; i + 1 < ms.length; i++) pairs.push([ms[i], ms[i + 1]])
  if (b - a >= TWO_PI - 1e-9) pairs.push([ms[ms.length - 1], ms[0] + TWO_PI])
  for (const [lo, hi] of pairs) {
    if (!(hi - lo > 1e-9)) continue
    let ok = true
    for (let k = 1; k < 8 && ok; k++) {
      const m = lo + ((hi - lo) * k) / 8
      const R = rOf(to, m)
      const r = rOf(ti, m)
      if (!(R > 0) || !(R > r) || !Number.isFinite(r)) ok = false
    }
    if (ok) return [lo, hi]
  }
  return null
}

export interface BetweenResult {
  a: number
  b: number
  aVal: Val
  bVal: Val
  area: Val
  /** A = ½∫ₐᵇ (R² − r²) dθ = … written with both formulas when there are. */
  integral: Formula
  /** Sentences that qualify the number: the curves cross inside, r < 0 somewhere. */
  notes: string[]
}

/** ½∫ₐᵇ (R(θ)² − r(θ)²) dθ, written out. Null when either curve is not polar or the bounds are not numbers. */
export function polarBetween(
  outer: FittedCurve,
  inner: FittedCurve,
  models: Record<string, ModelSpec>,
  symOuter: ParamSym | null,
  symInner: ParamSym | null,
  a: number,
  b: number,
): BetweenResult | null {
  const to = trackOf(outer, models)
  const ti = trackOf(inner, models)
  if (!to?.R || !ti?.R || !Number.isFinite(a) || !Number.isFinite(b) || a === b) return null
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  const g = (t: number): number => {
    const R = rOf(to, t)
    const r = rOf(ti, t)
    return 0.5 * (R * R - r * r)
  }
  const v = integrate(g, lo, hi)
  if (!Number.isFinite(v)) return null
  const aVal = boundOf(lo)
  const bVal = boundOf(hi)
  const area = integralVal(v)
  const eq = equalsText(area)
  const big = symOuter?.R ? formulaOf('polar', squared(symOuter.R)) : { text: 'R²', tex: 'R^2' }
  const small = symInner?.R ? formulaOf('polar', squared(symInner.R)) : { text: 'r²', tex: 'r^2' }
  const integral: Formula = {
    text: `A = ½∫ from ${aVal.text} to ${bVal.text} of (${big.text} − ${small.text}) dθ ${eq.text}`,
    tex: `A = \\frac{1}{2}\\int_{${aVal.tex}}^{${bVal.tex}} \\left[${big.tex} - ${small.tex}\\right]d\\theta ${eq.tex}`,
  }
  const notes: string[] = []
  let crosses = false
  let negInner = false
  for (let k = 1; k < 64; k++) {
    const m = lo + ((hi - lo) * k) / 64
    const R = rOf(to, m)
    const r = rOf(ti, m)
    if (Number.isFinite(R) && Number.isFinite(r) && R * R < r * r - 1e-9) crosses = true
    if (r < -1e-9) negInner = true
  }
  if (crosses) notes.push('The curves cross inside this θ-interval: there the integrand is negative and that part is subtracted.')
  if (negInner) notes.push('The inner r is negative on part of this interval: those points lie on the opposite side of the pole.')
  return { a: lo, b: hi, aVal, bVal, area, integral, notes }
}

/** The shaded region: the outer curve from a to b, then the inner one back from b to a. */
export function betweenRegion(
  outer: FittedCurve,
  inner: FittedCurve,
  models: Record<string, ModelSpec>,
  a: number,
  b: number,
  samples = 240,
): Vec2[] {
  const to = trackOf(outer, models)
  const ti = trackOf(inner, models)
  if (!to?.R || !ti?.R || !Number.isFinite(a) || !Number.isFinite(b) || a === b) return []
  const out: Vec2[] = []
  for (let i = 0; i <= samples; i++) {
    const t = a + ((b - a) * i) / samples
    const r = rOf(to, t)
    if (Number.isFinite(r)) out.push({ x: r * Math.cos(t), y: r * Math.sin(t) })
  }
  for (let i = samples; i >= 0; i--) {
    const t = a + ((b - a) * i) / samples
    const r = rOf(ti, t)
    if (Number.isFinite(r)) out.push({ x: r * Math.cos(t), y: r * Math.sin(t) })
  }
  return out.length > 3 ? out : []
}

// ============================================================================
// Horizontal / vertical tangents, as the card lists them
// ============================================================================

export interface TangentPoint {
  t: number
  tText: string
  point: string
  pos: Vec2
  /** Singular points: the 0/0 analysis. */
  notes?: string[]
}

export interface TangentLists {
  horizontal: TangentPoint[]
  vertical: TangentPoint[]
  singular: TangentPoint[]
}

/**
 * Where dy/dt = 0 (dx/dt ≠ 0), dx/dt = 0 (dy/dt ≠ 0) and both, on the
 * curve's interval: the t exact when the curve agrees with a closed form
 * there, and the point exact with it. A closed curve's t = b is its t = a
 * and is listed once.
 */
export function tangentLists(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  sym: ParamSym | null,
): TangentLists {
  const tr = trackOf(curve, models)
  const empty: TangentLists = { horizontal: [], vertical: [], singular: [] }
  if (!tr || (tr.kind !== 'parametric' && tr.kind !== 'polar')) return empty
  const [a, b] = tr.interval
  const crit = critical(tr, a, b)
  const v = varText(tr.kind)
  const posAt = (t: number): Vec2 =>
    sym ? { x: evalAt(sym, sym.X, t), y: evalAt(sym, sym.Y, t) } : { x: tr.X(t), y: tr.Y(t) }
  const p0 = posAt(a)
  const p1 = posAt(b)
  const size = Math.max(1, Math.abs(p0.x), Math.abs(p0.y))
  const closed = [p0.x, p0.y, p1.x, p1.y].every(Number.isFinite) && Math.hypot(p1.x - p0.x, p1.y - p0.y) <= 1e-9 * size
  const one = (t: number, check: (c: number) => boolean): TangentPoint | null => {
    const form = verifiedExact(t, check)
    const tt = form ? form.value : t
    const pos = posAt(tt)
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return null
    const x = form ? valOf(pos.x).text : decimal(pos.x)
    const y = form ? valOf(pos.y).text : decimal(pos.y)
    return { t: tt, tText: form ? form.text : decimal(t), point: `(${x}, ${y})`, pos }
  }
  const list = (ts: number[], check: (c: number) => boolean): TangentPoint[] => {
    let use = ts
    if (closed && use.length >= 2) {
      const eps = 1e-7 * (b - a)
      if (Math.abs(use[0] - a) <= eps && Math.abs(use[use.length - 1] - b) <= eps) use = use.slice(0, -1)
    }
    return use.map((t) => one(t, check)).filter((p): p is TangentPoint => p !== null)
  }
  const singular = list(crit.singular, crit.checkBoth)
  for (const p of singular) p.notes = singularNotes(curve, models, sym, p.t, p.tText, v)
  return {
    horizontal: list(crit.horizontal, crit.checkY),
    vertical: list(crit.vertical, crit.checkX),
    singular,
  }
}

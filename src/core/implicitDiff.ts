// ============================================================================
// src/core/implicitDiff.ts — implicit differentiation (AP Calculus Unit 3).
//
//   export function implicitDiffOf(src, params?): ImplicitDiff | null
//   export function implicitFn(F, grad?): ImplicitFn
//   export function solveYAt / reproject / projectOnto / dragOnCurve
//   export function tangentAt(f, p): ImplicitTangent
//   export function specialTangents(f, box, which): SpecialTangents
//   export function coordForm(v, check?): CoordForm
//
// THE ALGEBRA. For a curve F(x, y) = 0 (a typed x³ + y³ = 6xy, or a sketched
// circle's equation) the partials F_x and F_y are taken symbolically over the
// parser's AST (src/core/symbolic.ts, the differentiator Euler's d²y/dx²
// already used), and
//
//     dy/dx = −F_x / F_y
//
// is brought to the form a student writes: one fraction of two polynomials,
// the numbers made whole and their common factor divided out, a monomial
// common to top and bottom cancelled, the minus sign absorbed into a sum.
// x² + y² = 25 gives −x/y; the folium gives (2y − x²)/(y² − 2x). Anything
// that is not a polynomial in x and y (e^(xy), sin y, √x) rides along as an
// opaque ATOM — a letter of its own — so e^(xy) = x + y still prints as
// (1 − y·e^(xy))/(x·e^(xy) − 1).
//
// d²y/dx² is the quotient rule on y′ = P/Q with y′ substituted back:
//
//     y″ = [Q(P_x Q + P_y P) − P(Q_x Q + Q_y P)] / Q³
//
// and then, the step every AP key takes, the RELATION is used: a multiple of
// F's own polynomial is subtracted from the numerator whenever that leaves
// fewer terms. For the circle −(x² + y²)/y³ becomes −25/y³; for
// x² − xy + y² = 3, −18/(2y − x)³.
//
// THE NUMBERS. A tangent point lives ON the curve, so every point here is
// re-found on the curve by Newton's method: at a fixed x along its branch
// (solveYAt) where that is well-posed, and by projection along ∇F where it is
// not — which is what carries a dragged point round a circle and straight
// past its vertical tangents. Horizontal and vertical tangents are the
// solutions of F = 0 with F_x = 0 (or F_y = 0), found by 2-D Newton from
// every cell of a grid where both change sign, and printed exactly when an
// exact form checks out on the curve — (1, 2), (2∛2, 2∛4).
//
// Pure: no DOM, no React.
// ============================================================================

import type { Vec2 } from './types'
import { parseAst } from './parse'
import type { ExprNode } from './parse'
import { exactForm } from './exact'
import type { S } from './symbolic'
import { Dm, evalS, fromAst, sub as sSub, tex as sTex, text as sText } from './symbolic'

const MINUS = '−'

// ===========================================================================
// Polynomials in atoms
// ===========================================================================

/** A letter of the polynomial ring: x, y, a slider, π, or an opaque sub-tree (e^(xy)). */
interface Atom {
  key: string
  /** Print order: constants, parameters, x, y, everything else. */
  rank: number
  s: S
  text: string
  tex: string
}

interface Term {
  c: number
  /** [atom key, exponent > 0], in atom order. */
  m: [string, number][]
}

/** A polynomial: like terms merged, keyed by monomial. */
type MP = Map<string, Term>

/** Numerator over denominator, both polynomials. */
interface RF {
  n: MP
  d: MP
}

/** The atoms one computation uses, so a monomial can be ordered and printed. */
class Ring {
  atoms = new Map<string, Atom>()
  params: Record<string, number>

  constructor(params: Record<string, number>) {
    this.params = params
  }

  atom(s: S): string {
    let key: string
    let rank: number
    if (s.t === 'x') {
      key = 'x'
      rank = 2
    } else if (s.t === 'y') {
      key = 'y'
      rank = 3
    } else if (s.t === 'p') {
      key = `p:${s.name}`
      rank = 1
    } else if (s.t === 'c') {
      key = `c:${s.name}`
      rank = 0
    } else {
      key = `o:${sText(s)}`
      rank = 4
    }
    if (!this.atoms.has(key)) {
      const f = rank === 4 ? opaqueFormula(this, s) : { text: sText(s), tex: sTex(s) }
      this.atoms.set(key, { key, rank, s, text: f.text, tex: f.tex })
    }
    return key
  }

  order(a: string, b: string): number {
    const A = this.atoms.get(a)
    const B = this.atoms.get(b)
    const ra = A ? A.rank : 9
    const rb = B ? B.rank : 9
    return ra !== rb ? ra - rb : a < b ? -1 : a > b ? 1 : 0
  }
}

const MAX_TERMS = 400

const monoKey = (m: readonly [string, number][]): string => m.map(([k, e]) => `${k}^${e}`).join('*')

function mpOf(terms: Term[]): MP {
  const out: MP = new Map()
  for (const t of terms) addTerm(out, t)
  return out
}

function addTerm(p: MP, t: Term): void {
  if (t.c === 0 || !Number.isFinite(t.c)) {
    if (!Number.isFinite(t.c)) throw new Error('non-finite coefficient')
    return
  }
  const k = monoKey(t.m)
  const hit = p.get(k)
  if (hit) {
    const c = hit.c + t.c
    if (Math.abs(c) <= 1e-12 * Math.max(Math.abs(hit.c), Math.abs(t.c))) p.delete(k)
    else p.set(k, { c, m: hit.m })
  } else p.set(k, { c: t.c, m: t.m })
  if (p.size > MAX_TERMS) throw new Error('too many terms')
}

const mpConst = (c: number): MP => mpOf([{ c, m: [] }])
const ZERO_MP = (): MP => new Map()

function mpAdd(a: MP, b: MP, sign = 1): MP {
  const out: MP = new Map()
  for (const t of a.values()) addTerm(out, t)
  for (const t of b.values()) addTerm(out, { c: sign * t.c, m: t.m })
  return out
}

function mpScale(a: MP, k: number): MP {
  const out: MP = new Map()
  if (k === 0) return out
  for (const t of a.values()) addTerm(out, { c: t.c * k, m: t.m })
  return out
}

function monoMul(R: Ring, a: [string, number][], b: [string, number][]): [string, number][] {
  const map = new Map<string, number>()
  for (const [k, e] of a) map.set(k, (map.get(k) ?? 0) + e)
  for (const [k, e] of b) map.set(k, (map.get(k) ?? 0) + e)
  return [...map.entries()].filter(([, e]) => e !== 0).sort((x, y) => R.order(x[0], y[0]))
}

function mpMul(R: Ring, a: MP, b: MP): MP {
  const out: MP = new Map()
  for (const s of a.values()) for (const t of b.values()) addTerm(out, { c: s.c * t.c, m: monoMul(R, s.m, t.m) })
  return out
}

function mpPow(R: Ring, a: MP, n: number): MP {
  let out = mpConst(1)
  for (let i = 0; i < n; i++) out = mpMul(R, out, a)
  return out
}

function mpConstValue(a: MP): number | null {
  if (a.size === 0) return 0
  if (a.size !== 1) return null
  const t = [...a.values()][0]
  return t.m.length === 0 ? t.c : null
}

function mpEq(a: MP, b: MP): boolean {
  if (a.size !== b.size) return false
  for (const [k, t] of a) {
    const u = b.get(k)
    if (!u || Math.abs(u.c - t.c) > 1e-12 * Math.max(1, Math.abs(t.c))) return false
  }
  return true
}

const degOf = (t: Term): number => t.m.reduce((s, [, e]) => s + e, 0)
const expOf = (t: Term, k: string): number => t.m.find(([kk]) => kk === k)?.[1] ?? 0

/** Graded order: higher total degree first, then the earlier atoms' exponents. */
function cmpTerms(R: Ring, a: Term, b: Term): number {
  const da = degOf(a)
  const db = degOf(b)
  if (da !== db) return db - da
  const keys = [...new Set([...a.m.map(([k]) => k), ...b.m.map(([k]) => k)])].sort((x, y) => R.order(x, y))
  for (const k of keys) {
    const d = expOf(b, k) - expOf(a, k)
    if (d !== 0) return d
  }
  return 0
}

function leadTerm(R: Ring, p: MP): Term | null {
  let best: Term | null = null
  for (const t of p.values()) if (!best || cmpTerms(R, t, best) < 0) best = t
  return best
}

/** a / b when b divides a EXACTLY (remainder zero), else null. */
function mpDivExact(R: Ring, a: MP, b: MP): MP | null {
  const lb = leadTerm(R, b)
  if (!lb) return null
  let r = mpAdd(a, ZERO_MP())
  const q: MP = new Map()
  const scale = Math.max(1e-300, ...[...a.values()].map((t) => Math.abs(t.c)))
  for (let guard = 0; guard < 600; guard++) {
    // Drop coefficients that are rounding dust relative to a.
    for (const [k, t] of r) if (Math.abs(t.c) <= 1e-10 * scale) r.delete(k)
    if (r.size === 0) return q
    const lr = leadTerm(R, r)!
    const m: [string, number][] = []
    for (const [k, e] of lb.m) {
      if (expOf(lr, k) < e) return null
    }
    for (const [k, e] of lr.m) {
      const d = e - expOf(lb, k)
      if (d > 0) m.push([k, d])
    }
    const t: Term = { c: lr.c / lb.c, m }
    addTerm(q, t)
    r = mpAdd(r, mpMul(R, mpOf([t]), b), -1)
  }
  return null
}

// ---- from the tree -------------------------------------------------------

function toRF(R: Ring, s: S): RF | null {
  switch (s.t) {
    case 'n':
      return { n: mpConst(s.v), d: mpConst(1) }
    case 'x':
    case 'y':
    case 'p':
    case 'c':
      return { n: mpOf([{ c: 1, m: [[R.atom(s), 1]] }]), d: mpConst(1) }
    case 'yp':
      return null
    case 'neg': {
      const a = toRF(R, s.a)
      return a ? { n: mpScale(a.n, -1), d: a.d } : null
    }
    case 'add':
    case 'sub': {
      const a = toRF(R, s.a)
      const b = toRF(R, s.b)
      return a && b ? rfAdd(R, a, b, s.t === 'add' ? 1 : -1) : null
    }
    case 'mul': {
      const a = toRF(R, s.a)
      const b = toRF(R, s.b)
      return a && b ? { n: mpMul(R, a.n, b.n), d: mpMul(R, a.d, b.d) } : null
    }
    case 'div': {
      const a = toRF(R, s.a)
      const b = toRF(R, s.b)
      if (!a || !b || b.n.size === 0) return null
      return { n: mpMul(R, a.n, b.d), d: mpMul(R, a.d, b.n) }
    }
    case 'pow': {
      if (s.b.t === 'n' && Number.isInteger(s.b.v) && Math.abs(s.b.v) <= 12) {
        const a = toRF(R, s.a)
        if (!a) return null
        const e = s.b.v
        const n = mpPow(R, a.n, Math.abs(e))
        const d = mpPow(R, a.d, Math.abs(e))
        if (e >= 0) return { n, d }
        if (n.size === 0) return null
        return { n: d, d: n }
      }
      return { n: mpOf([{ c: 1, m: [[R.atom(s), 1]] }]), d: mpConst(1) }
    }
    case 'fn':
      return { n: mpOf([{ c: 1, m: [[R.atom(s), 1]] }]), d: mpConst(1) }
  }
}

function rfAdd(R: Ring, a: RF, b: RF, sign: number): RF {
  if (mpEq(a.d, b.d)) return { n: mpAdd(a.n, b.n, sign), d: a.d }
  return { n: mpAdd(mpMul(R, a.n, b.d), mpMul(R, b.n, a.d), sign), d: mpMul(R, a.d, b.d) }
}

// ---- normal form ---------------------------------------------------------

/** p/q for a coefficient that is one (q ≤ 1000), else null. */
function ratio(v: number): { p: number; q: number } | null {
  if (!Number.isFinite(v)) return null
  for (let q = 1; q <= 1000; q++) {
    const p = Math.round(v * q)
    if (Math.abs(p / q - v) <= 1e-10 * Math.max(1, Math.abs(v)) && Math.abs(p) <= 1e9) return { p, q }
  }
  return null
}

function gcd(a: number, b: number): number {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b > 0) [a, b] = [b, a % b]
  return a
}

/** Whole numbers top and bottom, their common factor divided out. */
function integerise(n: MP, d: MP): [MP, MP] {
  const all = [...n.values(), ...d.values()]
  const rs = all.map((t) => ratio(t.c))
  if (rs.some((r) => r === null)) return [n, d]
  let L = 1
  for (const r of rs) {
    L = (L / gcd(L, r!.q)) * r!.q
    if (L > 1e7) return [n, d]
  }
  let G = 0
  for (const r of rs) G = gcd(G, Math.round((r!.p * L) / r!.q))
  if (G === 0) return [n, d]
  const k = L / G
  const fix = (p: MP): MP => {
    const out: MP = new Map()
    for (const [key, t] of p) out.set(key, { c: Math.round(t.c * k * 1e9) / 1e9, m: t.m })
    return out
  }
  return [fix(n), fix(d)]
}

/** The monomial common to every term of both, divided out. */
function cancelMonomial(R: Ring, n: MP, d: MP): [MP, MP] {
  const terms = [...n.values(), ...d.values()]
  if (terms.length === 0) return [n, d]
  const common = new Map<string, number>()
  for (const [k, e] of terms[0].m) common.set(k, e)
  for (const t of terms.slice(1)) {
    for (const k of [...common.keys()]) {
      const e = expOf(t, k)
      if (e === 0) common.delete(k)
      else common.set(k, Math.min(common.get(k)!, e))
    }
  }
  if (common.size === 0) return [n, d]
  const strip = (p: MP): MP => {
    const out: MP = new Map()
    for (const t of p.values()) {
      const m = t.m
        .map(([k, e]): [string, number] => [k, e - (common.get(k) ?? 0)])
        .filter(([, e]) => e > 0)
        .sort((a, b) => R.order(a[0], b[0]))
      addTerm(out, { c: t.c, m })
    }
    return out
  }
  return [strip(n), strip(d)]
}

/** n/d in lowest terms, as far as this can tell. */
function reduceFrac(R: Ring, n: MP, d: MP): RF {
  const dc = mpConstValue(d)
  if (dc !== null && dc !== 0) {
    ;[n, d] = integerise(mpScale(n, 1 / dc), mpConst(1))
    return { n, d }
  }
  ;[n, d] = integerise(n, d)
  ;[n, d] = cancelMonomial(R, n, d)
  if (mpConstValue(d) === null && n.size > 0) {
    const q = mpDivExact(R, n, d)
    if (q) return reduceFrac(R, q, mpConst(1))
    if (mpConstValue(n) === null) {
      const q2 = mpDivExact(R, d, n)
      if (q2) return reduceFrac(R, mpConst(1), q2)
    }
  }
  // A denominator that is all minus signs gives them to the numerator.
  if (d.size > 0 && [...d.values()].every((t) => t.c < 0)) {
    n = mpScale(n, -1)
    d = mpScale(d, -1)
  }
  const dc2 = mpConstValue(d)
  if (dc2 !== null && dc2 !== 1 && dc2 !== 0) return reduceFrac(R, n, d)
  return { n, d }
}

// ---- printing ------------------------------------------------------------

export interface Formula {
  text: string
  tex: string
}

const SUP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
}
const sup = (e: number): string => String(e).split('').map((ch) => SUP[ch] ?? ch).join('')

function coefText(v: number): string {
  const r = Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)))
  return r
}

function coefTex(v: number): string {
  const r = ratio(v)
  if (r && r.q !== 1 && r.q <= 64) return `\\tfrac{${r.p}}{${r.q}}`
  return coefText(v)
}

function coefPlain(v: number): string {
  const r = ratio(v)
  if (r && r.q !== 1 && r.q <= 64) return `${r.p}/${r.q}`
  return coefText(v)
}

/** |t|, without its sign: "2x²y", "y·e^(xy)". */
function termBody(R: Ring, t: Term): Formula {
  const mag = Math.abs(t.c)
  const parts: Formula[] = []
  for (const [k, e] of t.m) {
    const a = R.atoms.get(k)
    if (!a) continue
    const opaque = a.rank === 4
    const bt = opaque && e > 1 ? `(${a.text})` : a.text
    parts.push({
      text: e === 1 ? bt : `${bt}${sup(e)}`,
      tex: e === 1 ? a.tex : opaque ? `\\left(${a.tex}\\right)^{${e}}` : `${a.tex}^{${e}}`,
    })
  }
  const showC = parts.length === 0 || Math.abs(mag - 1) > 1e-12
  let text = showC ? coefPlain(mag) : ''
  let tex = showC ? coefTex(mag) : ''
  t.m.forEach(([k], i) => {
    const a = R.atoms.get(k)
    const p = parts[i]
    if (!a || !p) return
    const opaque = a.rank === 4
    // Letters juxtapose (2x²y); an opaque factor after anything takes a dot.
    if (text !== '' && opaque && !/[0-9]$/.test(text)) {
      text += '·'
      tex += '\\,'
    } else if (text !== '' && /[0-9]$/.test(text) && /^[0-9]/.test(p.text)) {
      text += '·'
      tex += '\\cdot '
    }
    text += p.text
    tex += p.tex
  })
  return { text, tex }
}

function sortedTerms(R: Ring, p: MP): Term[] {
  const ts = [...p.values()].sort((a, b) => cmpTerms(R, a, b))
  // Lead with a positive term when there is one: 2y − x², not −x² + 2y.
  const i = ts.findIndex((t) => t.c > 0)
  if (i > 0) ts.unshift(...ts.splice(i, 1))
  return ts
}

function mpFormula(R: Ring, p: MP): Formula {
  if (p.size === 0) return { text: '0', tex: '0' }
  let text = ''
  let tex = ''
  sortedTerms(R, p).forEach((t, i) => {
    const b = termBody(R, t)
    if (i === 0) {
      text = t.c < 0 ? `${MINUS}${b.text}` : b.text
      tex = t.c < 0 ? `-${b.tex}` : b.tex
    } else {
      text += t.c < 0 ? ` ${MINUS} ${b.text}` : ` + ${b.text}`
      tex += t.c < 0 ? ` - ${b.tex}` : ` + ${b.tex}`
    }
  })
  return { text, tex }
}

/** Does this print as one factor that needs no bracket under a fraction bar ("y³", "x")? */
function bare(_R: Ring, p: MP): boolean {
  if (p.size !== 1) return false
  const t = [...p.values()][0]
  if (t.c !== 1) return t.m.length === 0
  return t.m.length === 1
}

/**
 * n/d as a student writes it: −x/y, −4x/(9y), (2y − x²)/(y² − 2x),
 * −(x² + y²)/y³. `dPow` raises the (bracketed) denominator: −18/(2y − x)³.
 */
function fracFormula(R: Ring, n: MP, d: MP, dPow = 1, dCoef = 1): Formula {
  let sign = 1
  let top = n
  // More minus signs than plus signs: pull one out front, −(x² + y²)/y³.
  const negs = [...top.values()].filter((t) => t.c < 0).length
  if (top.size > 0 && negs * 2 > top.size) {
    sign = -1
    top = mpScale(top, -1)
  }
  const dConst = mpConstValue(d)
  if (dConst === 1 && dPow === 1 && dCoef === 1) {
    const f = mpFormula(R, n)
    return f
  }
  // A whole-number factor common to a sum on top comes out front: 6(x² − xy + y²).
  let g = 0
  for (const t of top.values()) g = Number.isInteger(t.c) && Math.abs(t.c) < 1e9 ? gcd(g, t.c) : -1e18
  const pulled = top.size > 1 && g > 1
  const T0 = mpFormula(R, pulled ? mpScale(top, 1 / g) : top)
  const T = pulled ? { text: `${g}(${T0.text})`, tex: `${g}\\left(${T0.tex}\\right)` } : T0
  const B = mpFormula(R, d)
  const topWrap = top.size > 1 && !pulled
  const multiTermD = d.size > 1
  const cPrefix = dCoef !== 1 ? coefText(dCoef) : ''
  let bText: string
  let bTex: string
  if (dPow === 1) {
    const plain = cPrefix === '' && bare(R, d)
    bText = plain ? B.text : `(${cPrefix}${multiTermD && cPrefix ? `(${B.text})` : B.text})`
    bTex = `${cPrefix}${multiTermD && cPrefix ? `\\left(${B.tex}\\right)` : B.tex}`
  } else {
    const baseText = multiTermD || !bare(R, d) ? `(${B.text})` : B.text
    const baseTex = multiTermD || !bare(R, d) ? `\\left(${B.tex}\\right)` : B.tex
    const inner = `${cPrefix}${baseText}${sup(dPow)}`
    bText = cPrefix === '' && !multiTermD && bare(R, d) ? inner : cPrefix === '' ? inner : `(${inner})`
    bTex = `${cPrefix}${baseTex}^{${dPow}}`
  }
  const tText = topWrap ? `(${T.text})` : T.text
  return {
    text: `${sign < 0 ? MINUS : ''}${tText}/${bText}`,
    tex: `${sign < 0 ? '-' : ''}\\frac{${T.tex}}{${bTex}}`,
  }
}

const FN_TEX: Record<string, string> = { asin: '\\arcsin', acos: '\\arccos', atan: '\\arctan' }

/** e^(xy), sin(y), √(x + 1): an opaque atom printed with its inside in the ring's own voice. */
function opaqueFormula(R: Ring, s: S): Formula {
  const inner = (u: S): Formula => {
    try {
      const f = toRF(R, u)
      if (f) return fracFormula(R, f.n, f.d)
    } catch {
      /* fall through to the tree's own printer */
    }
    return { text: sText(u), tex: sTex(u) }
  }
  const single = (f: Formula): boolean => /^[a-zA-Zπ]$|^[0-9]+$/.test(f.text)
  if (s.t === 'pow' && s.a.t === 'c' && s.a.name === 'e') {
    const I = inner(s.b)
    return { text: single(I) ? `e^${I.text}` : `e^(${I.text})`, tex: `e^{${I.tex}}` }
  }
  if (s.t === 'fn') {
    const I = inner(s.a)
    if (s.fn === 'sqrt') return { text: single(I) ? `√${I.text}` : `√(${I.text})`, tex: `\\sqrt{${I.tex}}` }
    if (s.fn === 'exp') return { text: `e^(${I.text})`, tex: `e^{${I.tex}}` }
    return { text: `${s.fn}(${I.text})`, tex: `${FN_TEX[s.fn] ?? `\\${s.fn}`}\\left(${I.tex}\\right)` }
  }
  if (s.t === 'pow') {
    const B = inner(s.a)
    const E = inner(s.b)
    return {
      text: `${single(B) ? B.text : `(${B.text})`}^${single(E) ? E.text : `(${E.text})`}`,
      tex: `{${single(B) ? B.tex : `\\left(${B.tex}\\right)`}}^{${E.tex}}`,
    }
  }
  return { text: sText(s), tex: sTex(s) }
}

// ---- evaluation ------------------------------------------------------------

function evalMP(R: Ring, p: MP, x: number, y: number): number {
  const env = { x, y, yp: Number.NaN, p: (name: string) => R.params[name] ?? Number.NaN }
  const val = new Map<string, number>()
  let sum = 0
  for (const t of p.values()) {
    let v = t.c
    for (const [k, e] of t.m) {
      let a = val.get(k)
      if (a === undefined) {
        const atom = R.atoms.get(k)
        a = atom ? evalS(atom.s, env) : Number.NaN
        val.set(k, a)
      }
      v *= Math.pow(a, e)
    }
    sum += v
  }
  return sum
}

/** ∂p/∂v, as a fraction (an opaque atom's derivative may have a denominator). */
function dMP(R: Ring, p: MP, v: 'x' | 'y'): RF | null {
  let out: RF = { n: ZERO_MP(), d: mpConst(1) }
  for (const t of p.values()) {
    for (let i = 0; i < t.m.length; i++) {
      const [k, e] = t.m[i]
      const atom = R.atoms.get(k)
      if (!atom) return null
      let da: RF | null
      if (atom.rank === 4) {
        const ds = Dm(atom.s, v)
        da = ds ? toRF(R, ds) : null
        if (!da) return null
      } else if (k === v) da = { n: mpConst(1), d: mpConst(1) }
      else continue
      if (da.n.size === 0) continue
      const rest: [string, number][] = t.m
        .map(([kk, ee], j): [string, number] => [kk, j === i ? ee - 1 : ee])
        .filter(([, ee]) => ee > 0)
      const piece: RF = { n: mpMul(R, mpOf([{ c: t.c * e, m: rest }]), da.n), d: da.d }
      out = rfAdd(R, out, piece, 1)
    }
  }
  return out
}

/** Subtract multiples of the relation while that leaves fewer terms. */
function reduceByRelation(R: Ring, n: MP, rel: MP): MP {
  let best = n
  for (let round = 0; round < 6; round++) {
    let next: MP | null = null
    for (const t of best.values()) {
      for (const r of rel.values()) {
        // λ = (t / r): a number times a monomial, when r's monomial divides t's.
        if (r.m.some(([k, e]) => expOf(t, k) < e)) continue
        const m: [string, number][] = []
        for (const [k, e] of t.m) {
          const d = e - expOf(r, k)
          if (d > 0) m.push([k, d])
        }
        const cand = mpAdd(best, mpMul(R, mpOf([{ c: t.c / r.c, m }]), rel), -1)
        if (cand.size < (next ?? best).size) next = cand
      }
    }
    if (!next) break
    best = next
  }
  return best
}

// ===========================================================================
// The public derivative
// ===========================================================================

export interface ImplicitDiff {
  /** F = left − right, as it was differentiated. */
  F: Formula
  /** ∂F/∂x and ∂F/∂y. */
  Fx: Formula
  Fy: Formula
  /** dy/dx = −F_x/F_y, simplified: "−x/y". */
  dydx: Formula
  /**
   * d²y/dx², y′ substituted: `raw` straight from the quotient rule,
   * `onCurve` with the relation used when that shortened it (−25/y³).
   * Null when a piece had no rule (a denominator inside F_x, say).
   */
  d2: { raw: Formula; onCurve: Formula | null } | null
  /** The formulas, evaluated (parameters at their values). */
  fx(x: number, y: number): number
  fy(x: number, y: number): number
  slope(x: number, y: number): number
  d2At(x: number, y: number): number | null
}

/** Parameters an AST mentions, with the index each reads its value from. */
export function astParams(n: ExprNode, out: Map<string, number> = new Map()): Map<string, number> {
  switch (n.t) {
    case 'param':
      out.set(n.name, n.i)
      break
    case 'neg':
      astParams(n.a, out)
      break
    case 'bin':
      astParams(n.a, out)
      astParams(n.b, out)
      break
    case 'call':
      for (const a of n.args) astParams(a, out)
      break
    default:
      break
  }
  return out
}

/**
 * The implicit derivative of the curve `src` ("x^2 + y^2 = 25"), or null when
 * the line is not an equation in x and y the differentiator has rules for.
 * `params` are the sliders' values by name (for the numeric evaluators).
 */
export function implicitDiffOf(src: string, params: Record<string, number> = {}): ImplicitDiff | null {
  try {
    return implicitDiffUnsafe(src, params)
  } catch {
    return null
  }
}

function implicitDiffUnsafe(src: string, params: Record<string, number>): ImplicitDiff | null {
  if (typeof src !== 'string' || !src.includes('=')) return null
  const ast = parseAst(src)
  if (!ast.ok || ast.rhs === null) return null
  const l = fromAst(ast.lhs)
  const r = fromAst(ast.rhs)
  if (!l || !r) return null
  const Fs = sSub(l, r)
  const R = new Ring(params)
  const FxS = Dm(Fs, 'x')
  const FyS = Dm(Fs, 'y')
  if (!FxS || !FyS) return null
  const Frf = toRF(R, Fs)
  const Fx = toRF(R, FxS)
  const Fy = toRF(R, FyS)
  if (!Frf || !Fx || !Fy) return null
  if (Fy.n.size === 0) return null // no y at all: not a curve dy/dx is asked of
  const FxN = reduceFrac(R, Fx.n, Fx.d)
  const FyN = reduceFrac(R, Fy.n, Fy.d)
  // dy/dx = −(Fx.n·Fy.d)/(Fx.d·Fy.n)
  const top = mpScale(mpMul(R, Fx.n, Fy.d), -1)
  const bottom = mpMul(R, Fx.d, Fy.n)
  const yp = reduceFrac(R, top, bottom)
  const dydx = fracFormula(R, yp.n, yp.d)
  const FF = reduceFrac(R, Frf.n, Frf.d)

  const P = yp.n
  const Q = yp.d
  const evalRF = (f: RF) => (x: number, y: number): number => evalMP(R, f.n, x, y) / evalMP(R, f.d, x, y)

  // ---- y″
  let d2: ImplicitDiff['d2'] = null
  let d2Rf: { n: MP; base: MP; pow: number; coef: number } | null = null
  const Px = dMP(R, P, 'x')
  const Py = dMP(R, P, 'y')
  const Qx = dMP(R, Q, 'x')
  const Qy = dMP(R, Q, 'y')
  const poly = (f: RF | null): MP | null => {
    if (!f) return null
    const c = mpConstValue(f.d)
    return c === null || c === 0 ? null : mpScale(f.n, 1 / c)
  }
  const px = poly(Px)
  const py = poly(Py)
  const qx = poly(Qx)
  const qy = poly(Qy)
  if (px && py && qx && qy) {
    // [Q(P_x Q + P_y P) − P(Q_x Q + Q_y P)] / Q³
    const a = mpMul(R, Q, mpAdd(mpMul(R, px, Q), mpMul(R, py, P)))
    const b = mpMul(R, P, mpAdd(mpMul(R, qx, Q), mpMul(R, qy, P)))
    const N = mpAdd(a, b, -1)
    const build = (num: MP): { n: MP; base: MP; pow: number; coef: number; f: Formula } => {
      if (Q.size === 1) {
        // A monomial Q: expand Q³ and let the normal form cancel.
        const f = reduceFrac(R, num, mpPow(R, Q, 3))
        return { n: f.n, base: f.d, pow: 1, coef: 1, f: fracFormula(R, f.n, f.d) }
      }
      // Q = c·Q̂, Q̂ primitive with a positive lead: the bottom is c³·Q̂³.
      const [, qHat] = integerise(mpConst(1), Q)
      const lead = sortedTerms(R, qHat)[0]
      const qn = lead && lead.c < 0 ? mpScale(qHat, -1) : qHat
      const qT = [...Q.values()][0]
      const qnT = qn.get(monoKey(qT.m))
      const c = qnT ? qT.c / qnT.c : 1
      let pow = 3
      let top = mpScale(num, 1 / (c * c * c))
      // Q̂ may divide the numerator: (Q̂·A)/Q̂³ = A/Q̂².
      for (; pow > 0; pow--) {
        const q = mpDivExact(R, top, qn)
        if (!q) break
        top = q
      }
      // Whole-number coefficients: k·top/Q̂ᵖ with k pulled to a fraction p/q.
      const [tn, td] = integerise(top, mpConst(1))
      const dc = mpConstValue(td) ?? 1
      if (pow === 0) {
        const f = reduceFrac(R, tn, td)
        return { n: f.n, base: f.d, pow: 1, coef: 1, f: fracFormula(R, f.n, f.d) }
      }
      return { n: tn, base: qn, pow, coef: dc, f: fracFormula(R, tn, qn, pow, dc) }
    }
    const raw = build(N)
    let onCurve: Formula | null = null
    const rel = FF.n
    if (rel.size > 0) {
      const reduced = reduceByRelation(R, N, rel)
      // Offered only when the relation really shortens it: −25/y³, not a
      // shuffle of e^(xy) terms.
      if (reduced !== N && reduced.size <= Math.max(1, Math.floor(N.size / 2))) {
        const red = build(reduced)
        onCurve = red.f
        d2Rf = red
      }
    }
    if (!d2Rf) d2Rf = raw
    d2 = { raw: raw.f, onCurve }
  }

  const fxEval = evalRF(Fx)
  const fyEval = evalRF(Fy)
  const d2Eval = d2Rf
  return {
    F: mpFormula(R, FF.n),
    Fx: fracFormula(R, FxN.n, FxN.d),
    Fy: fracFormula(R, FyN.n, FyN.d),
    dydx,
    d2,
    fx: fxEval,
    fy: fyEval,
    slope: (x, y) => -fxEval(x, y) / fyEval(x, y),
    d2At: (x, y) => {
      if (!d2Eval) return null
      const num = evalMP(R, d2Eval.n, x, y)
      const den = d2Eval.coef * Math.pow(evalMP(R, d2Eval.base, x, y), d2Eval.pow)
      const v = num / den
      return Number.isFinite(v) ? v : null
    },
  }
}

// ===========================================================================
// On the curve: numbers
// ===========================================================================

/** F and its gradient, evaluated. */
export interface ImplicitFn {
  F(x: number, y: number): number
  grad(x: number, y: number): [number, number]
}

/**
 * A curve F(x, y) = 0 for the numeric routines. `grad` is the symbolic one
 * when there is one; otherwise central differences on F.
 */
export function implicitFn(
  F: (x: number, y: number) => number,
  grad?: ((x: number, y: number) => [number, number]) | null,
): ImplicitFn {
  const safe = (x: number, y: number): number => {
    try {
      const v = F(x, y)
      return typeof v === 'number' ? v : Number.NaN
    } catch {
      return Number.NaN
    }
  }
  const numeric = (x: number, y: number): [number, number] => {
    const hx = 1e-6 * Math.max(1, Math.abs(x))
    const hy = 1e-6 * Math.max(1, Math.abs(y))
    return [(safe(x + hx, y) - safe(x - hx, y)) / (2 * hx), (safe(x, y + hy) - safe(x, y - hy)) / (2 * hy)]
  }
  return {
    F: safe,
    grad: grad
      ? (x, y) => {
          const g = grad(x, y)
          return Number.isFinite(g[0]) && Number.isFinite(g[1]) ? g : numeric(x, y)
        }
      : numeric,
  }
}

const scaleOf = (x: number, y: number): number => Math.max(1, Math.abs(x), Math.abs(y))

/** Is (x, y) on the curve, to within a hair of its own scale? */
export function onCurve(f: ImplicitFn, x: number, y: number, tol = 1e-8): boolean {
  const v = f.F(x, y)
  if (!Number.isFinite(v)) return false
  if (v === 0) return true
  const [a, b] = f.grad(x, y)
  const g = Math.hypot(a, b)
  if (!(g > 0) || !Number.isFinite(g)) return Math.abs(v) < 1e-12
  return Math.abs(v) / g <= tol * scaleOf(x, y)
}

/** The y with F(x, y) = 0 nearest `y0` along this branch, by Newton in y. Null when it will not settle. */
export function solveYAt(f: ImplicitFn, x: number, y0: number, maxJump = Infinity): number | null {
  let y = y0
  for (let i = 0; i < 60; i++) {
    const v = f.F(x, y)
    if (!Number.isFinite(v)) return null
    const [, fy] = f.grad(x, y)
    if (!Number.isFinite(fy) || Math.abs(fy) < 1e-14) return null
    let step = v / fy
    const cap = 0.5 * scaleOf(x, y)
    if (Math.abs(step) > cap) step = Math.sign(step) * cap
    y -= step
    if (Math.abs(y - y0) > maxJump) return null
    if (Math.abs(step) <= 1e-14 * scaleOf(x, y)) break
  }
  return onCurve(f, x, y, 1e-9) ? y : null
}

/** The x with F(x, y) = 0 nearest `x0` — solveYAt with the roles swapped. */
export function solveXAt(f: ImplicitFn, y: number, x0: number, maxJump = Infinity): number | null {
  const swapped: ImplicitFn = {
    F: (a, b) => f.F(b, a),
    grad: (a, b) => {
      const [gx, gy] = f.grad(b, a)
      return [gy, gx]
    },
  }
  return solveYAt(swapped, y, x0, maxJump)
}

/** The foot of p on the curve, by Newton along ∇F. Null when it will not settle. */
export function projectOnto(f: ImplicitFn, p: Vec2): Vec2 | null {
  let x = p.x
  let y = p.y
  for (let i = 0; i < 80; i++) {
    const v = f.F(x, y)
    if (!Number.isFinite(v)) return null
    const [a, b] = f.grad(x, y)
    const g2 = a * a + b * b
    if (!(g2 > 0) || !Number.isFinite(g2)) return null
    let dx = (v * a) / g2
    let dy = (v * b) / g2
    const len = Math.hypot(dx, dy)
    const cap = 0.5 * scaleOf(x, y)
    if (len > cap) {
      dx *= cap / len
      dy *= cap / len
    }
    x -= dx
    y -= dy
    if (Math.hypot(dx, dy) <= 1e-14 * scaleOf(x, y)) break
  }
  return onCurve(f, x, y, 1e-9) ? { x, y } : null
}

/**
 * A stored point put back on the curve after the curve changed: the same x
 * on the branch its y was on, when that is well-posed; otherwise the foot of
 * the old point (a vertical tangent, a branch that is gone).
 */
export function reproject(f: ImplicitFn, x: number, yHint: number): Vec2 | null {
  if (onCurve(f, x, yHint, 1e-12)) return { x, y: yHint }
  const [a, b] = f.grad(x, yHint)
  // Near a vertical tangent y(x) is ill-conditioned: project instead.
  const steep = Math.abs(b) < 1e-3 * Math.hypot(a, b)
  if (!steep) {
    const y = solveYAt(f, x, yHint, 0.5 * scaleOf(x, yHint) + 2)
    if (y !== null) return { x, y }
  }
  return projectOnto(f, { x, y: yHint })
}

/**
 * Where a drag puts the point: the pointer's foot on the curve — which is
 * what lets it run round a circle and straight through (5, 0), where x
 * stops increasing. Falls back to the previous point when the pointer sits
 * where ∇F vanishes (a circle's centre).
 */
export function dragOnCurve(f: ImplicitFn, prev: Vec2, pointer: Vec2): Vec2 {
  const foot = projectOnto(f, pointer)
  if (foot) return foot
  // Half-way from the old point toward the pointer, then project.
  const mid = projectOnto(f, { x: (prev.x + pointer.x) / 2, y: (prev.y + pointer.y) / 2 })
  return mid ?? prev
}

export type ImplicitTangent =
  | { kind: 'line'; point: Vec2; m: number; b: number }
  | { kind: 'vertical'; point: Vec2 }
  | { kind: 'singular'; point: Vec2 }

/** The tangent at a point already on the curve. */
export function tangentAt(f: ImplicitFn, p: Vec2): ImplicitTangent {
  const [a, b] = f.grad(p.x, p.y)
  const g = Math.hypot(a, b)
  if (!(g > 1e-9) || !Number.isFinite(g)) return { kind: 'singular', point: p }
  if (Math.abs(b) <= 1e-9 * g) return { kind: 'vertical', point: p }
  const m = -a / b
  if (!Number.isFinite(m) || Math.abs(m) > 1e9) return { kind: 'vertical', point: p }
  return { kind: 'line', point: p, m, b: p.y - m * p.x }
}

// ---- horizontal and vertical tangents ------------------------------------

export interface SpecialTangents {
  /** Points where the tangent is horizontal (or vertical), exact where exact. */
  points: Vec2[]
  /** Points where F_x = F_y = 0 as well: no single tangent there. */
  singular: Vec2[]
}

export interface Box {
  x0: number
  x1: number
  y0: number
  y1: number
}

const GRID = 90

/**
 * Solutions of F = 0 and F_x = 0 ('h': horizontal tangents) or F_y = 0
 * ('v': vertical) inside `box`. Every grid cell where F and the partial both
 * change sign seeds a 2-D Newton; the results are deduplicated and, where an
 * exact form satisfies both equations, snapped onto it.
 */
export function specialTangents(f: ImplicitFn, box: Box, which: 'h' | 'v'): SpecialTangents {
  const G = (x: number, y: number): number => f.grad(x, y)[which === 'h' ? 0 : 1]
  const other = (x: number, y: number): number => f.grad(x, y)[which === 'h' ? 1 : 0]
  const { x0, x1, y0, y1 } = box
  if (!(x1 > x0) || !(y1 > y0)) return { points: [], singular: [] }
  const n = GRID
  const dx = (x1 - x0) / n
  const dy = (y1 - y0) / n
  const Fv: number[] = []
  const Gv: number[] = []
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      // A hair off the lattice, so a curve through a grid node still changes sign.
      const x = x0 + i * dx + dx * 1e-3
      const y = y0 + j * dy + dy * 1.7e-3
      Fv.push(f.F(x, y))
      Gv.push(G(x, y))
    }
  }
  const at = (arr: number[], i: number, j: number): number => arr[j * (n + 1) + i]
  const changes = (arr: number[], i: number, j: number): boolean => {
    const v = [at(arr, i, j), at(arr, i + 1, j), at(arr, i, j + 1), at(arr, i + 1, j + 1)]
    if (v.some((u) => !Number.isFinite(u))) return false
    return Math.min(...v) <= 0 && Math.max(...v) >= 0
  }
  const found: Vec2[] = []
  const tolD = 1e-7 * Math.max(1, Math.abs(x0), Math.abs(x1), Math.abs(y0), Math.abs(y1))
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (!changes(Fv, i, j) || !changes(Gv, i, j)) continue
      const r = newton2(f.F, G, x0 + (i + 0.5) * dx, y0 + (j + 0.5) * dy, Math.max(dx, dy))
      if (!r) continue
      if (r.x < x0 - dx || r.x > x1 + dx || r.y < y0 - dy || r.y > y1 + dy) continue
      if (found.some((q) => Math.hypot(q.x - r.x, q.y - r.y) <= Math.max(tolD, 1e-4 * Math.max(dx, dy)))) continue
      found.push(r)
    }
  }
  const points: Vec2[] = []
  const singular: Vec2[] = []
  for (const p0 of found) {
    // A point where ∇F itself vanishes (the folium's node) is found by Newton
    // on F_x = F_y = 0 far more sharply than on F = G = 0.
    const crit = newton2(
      (x, y) => f.grad(x, y)[0],
      (x, y) => f.grad(x, y)[1],
      p0.x,
      p0.y,
      Math.max(dx, dy),
    )
    const isCrit =
      crit !== null &&
      Math.hypot(crit.x - p0.x, crit.y - p0.y) <= Math.max(dx, dy) &&
      onCurve(f, crit.x, crit.y, 1e-6)
    const p = isCrit && crit ? crit : p0
    const q = snapPoint(f, p, G)
    const [a, b] = f.grad(q.x, q.y)
    const g = Math.hypot(a, b)
    const o = Math.abs(other(q.x, q.y))
    const tiny = isCrit || !(g > 1e-7 * scaleOf(q.x, q.y)) || o <= 1e-7 * Math.max(1, scaleOf(q.x, q.y))
    const list = tiny ? singular : points
    if (!list.some((r) => Math.hypot(r.x - q.x, r.y - q.y) <= tolD)) list.push(q)
  }
  const byX = (a: Vec2, b: Vec2): number => a.x - b.x || a.y - b.y
  return { points: points.sort(byX), singular: singular.sort(byX) }
}

/** Newton on the 2×2 system F = 0, G = 0, Jacobian by differences. */
function newton2(
  F: (x: number, y: number) => number,
  G: (x: number, y: number) => number,
  x: number,
  y: number,
  cell: number,
): Vec2 | null {
  const sx = x
  const sy = y
  let best: { x: number; y: number; r: number } | null = null
  for (let it = 0; it < 60; it++) {
    const f = F(x, y)
    const g = G(x, y)
    if (!Number.isFinite(f) || !Number.isFinite(g)) return null
    const h = 1e-7 * scaleOf(x, y)
    const fx = (F(x + h, y) - F(x - h, y)) / (2 * h)
    const fy = (F(x, y + h) - F(x, y - h)) / (2 * h)
    const gx = (G(x + h, y) - G(x - h, y)) / (2 * h)
    const gy = (G(x, y + h) - G(x, y - h)) / (2 * h)
    const det = fx * gy - fy * gx
    const res = Math.abs(f) / Math.max(1e-300, Math.hypot(fx, fy)) + Math.abs(g) / Math.max(1e-300, Math.hypot(gx, gy))
    if (!best || res < best.r) best = { x, y, r: res }
    if (!Number.isFinite(det) || Math.abs(det) < 1e-300) break
    let ddx = (f * gy - g * fy) / det
    let ddy = (g * fx - f * gx) / det
    const len = Math.hypot(ddx, ddy)
    if (len > 2 * cell) {
      ddx *= (2 * cell) / len
      ddy *= (2 * cell) / len
    }
    x -= ddx
    y -= ddy
    if (Math.hypot(x - sx, y - sy) > 6 * cell) return null
    if (Math.hypot(ddx, ddy) <= 1e-15 * scaleOf(x, y)) break
  }
  if (!best) return null
  const f = F(best.x, best.y)
  const g = G(best.x, best.y)
  const s = scaleOf(best.x, best.y)
  // A singular point converges only linearly; accept a small residual there.
  const ok = Math.abs(f) <= 1e-8 * s * s * s && Math.abs(g) <= 1e-6 * s * s
  return ok || best.r <= 1e-9 * s ? { x: best.x, y: best.y } : null
}

/** The exact point near p that satisfies F = 0 and G = 0, or p itself. */
function snapPoint(f: ImplicitFn, p: Vec2, G: (x: number, y: number) => number): Vec2 {
  const cx = coordForm(p.x, undefined, 1e-7)
  const cy = coordForm(p.y, undefined, 1e-7)
  if (!cx.exact && !cy.exact) return p
  const q = { x: cx.value, y: cy.value }
  const s = scaleOf(q.x, q.y)
  const fv = f.F(q.x, q.y)
  const gv = G(q.x, q.y)
  const [a, b] = f.grad(q.x, q.y)
  const g = Math.hypot(a, b)
  const onF = g > 0 ? Math.abs(fv) / g <= 1e-9 * s : Math.abs(fv) <= 1e-9 * s
  const onG = Math.abs(gv) <= 1e-8 * Math.max(1, g, s)
  return onF && onG ? q : p
}

// ---- exact coordinates -----------------------------------------------------

export interface CoordForm {
  text: string
  tex: string
  value: number
  exact: boolean
}

const MINUS_RE = /^-/

function decimalText(v: number, places = 3): string {
  if (!Number.isFinite(v)) return '—'
  let t = v.toFixed(places)
  if (t.includes('.')) t = t.replace(/0+$/, '').replace(/\.$/, '')
  if (t === '-0') t = '0'
  return t.replace(MINUS_RE, MINUS)
}

/** k·∛n with n cube-free, for v = ±∛m, m a whole number ≤ 10⁶. */
function cubeRootForm(v: number): CoordForm | null {
  const m = v * v * v
  const mi = Math.round(m)
  if (mi === 0 || Math.abs(mi) > 1e6 || Math.abs(m - mi) > 1e-8 * Math.max(1, Math.abs(m))) return null
  let n = Math.abs(mi)
  let k = 1
  for (let f = 2; f * f * f <= n; f++) {
    while (n % (f * f * f) === 0) {
      n /= f * f * f
      k *= f
    }
  }
  if (n === 1) return null // a whole number; exactForm has it
  const value = Math.sign(mi) * k * Math.cbrt(n)
  if (Math.abs(value - v) > 1e-9 * Math.max(1, Math.abs(v))) return null
  const sign = mi < 0 ? MINUS : ''
  const head = k === 1 ? '' : String(k)
  return {
    text: `${sign}${head}∛${n}`,
    tex: `${mi < 0 ? '-' : ''}${head}\\sqrt[3]{${n}}`,
    value,
    exact: true,
  }
}

/**
 * A coordinate as the card prints it: exact (3, −3/4, 2√3, 2∛2) when it is
 * one within `tol`, else three decimals. `check` may veto a candidate.
 *
 * `point`: a coordinate of a POINT, where a short decimal reads better as
 * itself (1.8, not 9/5 — it is where a drag snapped) and an exact form only
 * earns its place while it is short: 2∛2 and √3/2 yes, 4√34/5 no.
 */
export function coordForm(v: number, check?: (c: number) => boolean, tol = 1e-9, point = false): CoordForm {
  if (!Number.isFinite(v)) return { text: '—', tex: '—', value: v, exact: false }
  const t = decimalText(v)
  const dec: CoordForm = { text: t, tex: t.replace(MINUS, '-'), value: v, exact: false }
  if (point && !Number.isInteger(Math.round(v * 1e9) / 1e9)) {
    const r2 = Math.round(v * 100) / 100
    if (Math.abs(r2 - v) <= 1e-10 * Math.max(1, Math.abs(v))) return { ...dec, value: r2, exact: true }
  }
  const short = (f: CoordForm): boolean => !point || f.text.replace(MINUS, '').length <= 5
  const e = exactForm(v, { tol })
  if (e && (!check || check(e.value))) {
    const f = { text: e.text, tex: e.tex, value: e.value, exact: true }
    if (short(f)) return f
    return dec
  }
  const c = cubeRootForm(v)
  if (c && (!check || check(c.value)) && short(c)) return c
  return dec
}

/** "(3, 4)", "(2∛2, 2∛4)", "(1.732, 0.5)". */
export function pointText(p: Vec2): { text: string; tex: string; exact: boolean } {
  const x = coordForm(p.x, undefined, 1e-9, true)
  const y = coordForm(p.y, undefined, 1e-9, true)
  return { text: `(${x.text}, ${y.text})`, tex: `\\left(${x.tex},\\ ${y.tex}\\right)`, exact: x.exact && y.exact }
}

/**
 * The tangent line, point-slope: "y − 4 = −3/4 (x − 3)", "x = 5", "y = 5".
 * The point and the slope print exactly when they are.
 */
export function pointSlopeText(p: Vec2, m: number | null): Formula {
  const x = coordForm(p.x, undefined, 1e-9, true)
  const y = coordForm(p.y, undefined, 1e-9, true)
  if (m === null) return { text: `x = ${x.text}`, tex: `x = ${x.tex}` }
  const k = coordForm(m)
  if (Math.abs(m) < 1e-12) return { text: `y = ${y.text}`, tex: `y = ${y.tex}` }
  const shift = (v: CoordForm, letter: string): Formula => {
    if (Math.abs(v.value) < 1e-15) return { text: letter, tex: letter }
    const neg = v.value < 0
    const body = neg ? v.text.replace(MINUS, '') : v.text
    const bodyTex = neg ? v.tex.replace(/^-/, '') : v.tex
    return { text: `${letter} ${neg ? '+' : MINUS} ${body}`, tex: `${letter} ${neg ? '+' : '-'} ${bodyTex}` }
  }
  const L = shift(y, 'y')
  const Rr = shift(x, 'x')
  const zeroX = Math.abs(x.value) < 1e-15
  const one = Math.abs(m - 1) < 1e-15
  const minusOne = Math.abs(m + 1) < 1e-15
  let joinText: string
  let joinTex: string
  if (one) {
    joinText = Rr.text
    joinTex = Rr.tex
  } else if (minusOne) {
    joinText = zeroX ? `${MINUS}x` : `${MINUS}(${Rr.text})`
    joinTex = zeroX ? '-x' : `-\\left(${Rr.tex}\\right)`
  } else if (zeroX) {
    joinText = `${k.text}x`
    joinTex = `${k.tex}x`
    if (k.text.includes('/') || k.text.includes('.')) joinText = `${k.text}·x`
  } else {
    joinText = `${k.text} (${Rr.text})`
    joinTex = `${k.tex}\\left(${Rr.tex}\\right)`
  }
  return { text: `${L.text} = ${joinText}`, tex: `${L.tex} = ${joinTex}` }
}

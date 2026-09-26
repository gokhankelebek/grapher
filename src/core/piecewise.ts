// ============================================================================
// Piecewise and step functions, built and read the way a teacher states them
// (src/core/piecewise.ts)
//
//     f(x) = { x² + 1   if x < 0
//            { 3        if 0 ≤ x ≤ 2
//            { −x + 5   if x > 2
//
// The parser already reads piecewise lines ({expr if cond, expr if cond}
// and restricted domains) — see src/core/parse/index.ts and condition.ts —
// so, like every sibling (factored, exponential, logarithmic, sinusoidal,
// transform), a spec becomes a TYPED EXPRESSION. This module is the bridge
// between that text and a table of pieces a card can edit, plus the
// analysis a piecewise question asks for: what happens at each breakpoint.
//
// The PARSER, in the same wave, fills ModelSpec.pieces (src/core/types.ts)
// with each piece's interval and closed/open ends, so the renderer can draw
// the filled and open dots every textbook piecewise graph has.
//
//   export function piecewiseSource(spec): string
//       canonical parseable source in the parser's piecewise syntax.
//   export function readPiecewise(src): PiecewiseSpec | null
//       any typed piecewise line (or a single restricted expression) → the
//       table; null for anything else. Verified numerically.
//   export function breakpoints(spec, evalPiece): Breakpoint[]
//       at every boundary between consecutive pieces and at every bounded
//       end: the left and right limits, the value (from whichever piece
//       includes the point, or none), and the verdict: 'continuous',
//       'jump' (size), 'removable' (limits agree, value missing or
//       different), 'infinite' (a side runs away), 'gap' (the pieces do not
//       meet — x in neither), 'overlap' (both include it — an error in the
//       definition, named); with a teacher sentence ("jump of 2 at x = 0:
//       left limit 1, right limit 3, f(0) = 3").
//   export function stepSpec(kind, opts): PiecewiseSpec | string
//       step functions: 'floor' ⌊x⌋, 'ceil' ⌈x⌉, 'round', and a 'table' of
//       constant values on intervals (a postage / parking / tax table) —
//       returns a spec when a table is given, or the one-line typed source
//       a·⌊b(x − h)⌋ + k for the greatest-integer family.
//
// DECISIONS (the contract left these open)
//
//   Syntax. The canonical line is the brace form with one `if` per piece,
//   pieces separated by commas, the way a textbook lists cases:
//       f(x) = {x^2 + 1 if x < 0, 3 if 0 <= x <= 2, -x + 5 if x > 2}
//   (the parser prints it as a \begin{cases} table). One piece is written
//   as a restriction, `f(x) = x^2 {0 <= x < 3}`; a last piece with no bounds
//   as `… otherwise`.
//   Reading. Each piece is what its branch OWNS under the parser's rule that
//   the first matching branch wins: an `otherwise` owns the complement of
//   the earlier branches, and a typed overlap goes to the earlier branch
//   (`{1 if x < 5, 2 if x < 10}` reads as x < 5 and 5 <= x < 10). A branch
//   whose set is not one interval — a union (x < -1 or x > 2), an
//   exclusion (x != 2) — is SPLIT into one piece per interval, with the same
//   formula. Bound text is the teacher's own ("1/2", "sqrt(2)"). A line
//   with a slider bound (x < a) cannot be ordered or intersected without
//   the slider's value, so it reads as typed: one piece per branch, in the
//   typed order, `otherwise` as an unbounded last piece.
//   Overlap. breakpoints() calls a point 'overlap' when two pieces both
//   include it and give DIFFERENT values, or both claim the same side of it
//   with different limits. Two pieces that include it and agree are fine:
//   the verdict is the ordinary one and the sentence says they agree.
//   Bounds. breakpoints() needs constant bounds; a piece whose bound uses a
//   slider is skipped (substitute the slider values into the text first).
//   Round. The parser has no round(); stepSpec('round') writes
//   a·floor(b(x − h) + 1/2) + k, which is JavaScript's Math.round exactly
//   (halves round up: round(−2.5) = −2).
// ============================================================================

import { analyzeExpr, compileExpr, parseExpression, piecewiseParts } from './parse'
import {
  complementOf,
  excludedPoints,
  liveClause,
  newCtx,
  parseCondition,
  type Piece,
} from './parse/condition'
import { exactForm } from './exact'
import type { ModelSpec } from './types'
import { transformSource } from './transform'

export interface PieceSpec {
  /** The expression in x, as typed: "x^2 + 1", "3", "-x + 5". */
  expr: string
  /** Lower bound as typed, absent for −∞. */
  lo?: string
  /** Upper bound as typed, absent for +∞. */
  hi?: string
  loClosed: boolean
  hiClosed: boolean
}

export interface PiecewiseSpec {
  /** The function's name when typed as f(x) = …; absent for y = … */
  name?: string
  pieces: PieceSpec[]
}

export type BreakKind = 'continuous' | 'jump' | 'removable' | 'infinite' | 'gap' | 'overlap' | 'end'

export interface Breakpoint {
  x: number
  xText: string
  leftLimit: number | null
  rightLimit: number | null
  value: number | null
  kind: BreakKind
  sentence: string
}


// ----------------------------------------------------------------------------
// Small helpers
// ----------------------------------------------------------------------------

const INF_TEXT = /^[+\-−]?\s*(?:inf|infty|infinity|oo|∞|\\infty)$/i

/** A bound as written, or undefined for an absent / infinite one. */
function boundText(t: string | undefined | null): string | undefined {
  if (t === undefined || t === null) return undefined
  const s = t.trim()
  if (s === '' || INF_TEXT.test(s)) return undefined
  return s
}

/** A finite number the parser reads back exactly (no exponent notation). */
function numSrc(v: number): string {
  const r = Number(v.toPrecision(15))
  if (Number.isInteger(r)) return String(r)
  const s = String(r)
  if (!/e/i.test(s)) return s
  return r.toFixed(20).replace(/0+$/, '').replace(/\.$/, '')
}

/** Same number, or NaN on both sides. */
function same(a: number, b: number, tol = 1e-9): boolean {
  if (Number.isNaN(a) && Number.isNaN(b)) return true
  if (a === b) return true
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b))
}

/** Unicode text for a number a teacher reads: 2, −1/2, √3, π/4, 0.3183. */
function numText(v: number): string {
  if (v === Number.POSITIVE_INFINITY) return '∞'
  if (v === Number.NEGATIVE_INFINITY) return '−∞'
  const ex = exactForm(v)
  if (ex) return ex.text
  const r = Number(v.toPrecision(6))
  return String(r).replace('-', '−')
}

/** Round off the last few ulps a limit carries: 2.9999999999 → 3. */
function snap(v: number): number {
  if (!Number.isFinite(v)) return v
  const ex = exactForm(v, { tol: 1e-9 })
  if (ex) return ex.value
  return Number(v.toPrecision(12))
}

// ----------------------------------------------------------------------------
// piecewiseSource
// ----------------------------------------------------------------------------

/** The condition of one piece in input syntax; null for a piece with no bounds. */
function condSource(p: PieceSpec): string | null {
  const lo = boundText(p.lo)
  const hi = boundText(p.hi)
  if (lo !== undefined && hi !== undefined) {
    if (lo === hi && p.loClosed && p.hiClosed) return `x = ${lo}`
    return `${lo} ${p.loClosed ? '<=' : '<'} x ${p.hiClosed ? '<=' : '<'} ${hi}`
  }
  if (lo !== undefined) return `x ${p.loClosed ? '>=' : '>'} ${lo}`
  if (hi !== undefined) return `x ${p.hiClosed ? '<=' : '<'} ${hi}`
  return null
}

/**
 * The canonical typed line for a table:
 *   f(x) = {x^2 + 1 if x < 0, 3 if 0 <= x <= 2, -x + 5 if x > 2}
 * Pieces in the spec's order (the parser's first match wins, so the order is
 * part of the meaning); formulas and bounds exactly as the teacher typed them.
 */
export function piecewiseSource(spec: PiecewiseSpec): string {
  const head = spec.name ? `${spec.name}(x) = ` : 'y = '
  const pieces = spec.pieces ?? []
  const expr = (p: PieceSpec): string => (p.expr ?? '').trim() || '0'
  if (pieces.length === 0) return `${head}0`
  if (pieces.length === 1) {
    const c = condSource(pieces[0])
    return c === null ? `${head}${expr(pieces[0])}` : `${head}${expr(pieces[0])} {${c}}`
  }
  const rows = pieces.map((p, i) => {
    const c = condSource(p)
    if (c !== null) return `${expr(p)} if ${c}`
    // No bounds: last, it is `otherwise`; earlier (first match wins) it
    // claims every x no earlier piece did, which is also what -inf < x < inf says.
    return i === pieces.length - 1 ? `${expr(p)} otherwise` : `${expr(p)} if -inf < x < inf`
  })
  return `${head}{${rows.join(', ')}}`
}

// ----------------------------------------------------------------------------
// readPiecewise
// ----------------------------------------------------------------------------

const NAME_HEAD_RE = /^([A-Za-z])\s*\(\s*x\s*\)$/

/** One interval of a condition → a PieceSpec, bounds as typed. */
function pieceOf(expr: string, q: Piece): PieceSpec {
  const out: PieceSpec = { expr, loClosed: false, hiClosed: false }
  if (Number.isFinite(q.lo)) {
    out.lo = q.loSrc ?? numSrc(q.lo)
    out.loClosed = q.loC
  }
  if (Number.isFinite(q.hi)) {
    out.hi = q.hiSrc ?? numSrc(q.hi)
    out.hiClosed = q.hiC
  }
  return out
}

/** A condition on x, constant bounds only; null when it is anything else. */
function constCondition(cond: string): Piece[] | null {
  try {
    const ctx = newCtx(analyzeExpr)
    const ps = parseCondition(cond, ctx)
    if (ctx.name !== null && ctx.name !== 'x') return null
    return ps
  } catch {
    return null
  }
}

/** A single-interval condition whose bounds may be sliders (x < a). */
function sliderCondition(expr: string, cond: string): PieceSpec | null {
  const cl = liveClause(cond, newCtx(analyzeExpr), 'x', (text) => {
    const c = compileExpr(text)
    if (!c.ok || c.expr.vars.length > 0) return null
    return { tex: c.expr.latex, live: c.expr.paramNames.length > 0 }
  })
  if (!cl) return null
  const out: PieceSpec = { expr, loClosed: false, hiClosed: false }
  if (cl.lo) { out.lo = cl.lo.src; out.loClosed = cl.loC }
  if (cl.hi) { out.hi = cl.hi.src; out.hiClosed = cl.hiC }
  return out
}

/**
 * Does `spec`, written back out, evaluate as `src` does? Compared at the
 * default slider values and at a second set, over a grid and at every piece
 * end (±1e-6), NaN matching NaN — a gap has to survive as a gap.
 */
function verify(src: string, spec: PiecewiseSpec): boolean {
  const a = parseExpression(src)
  const b = parseExpression(piecewiseSource(spec))
  if (!a.ok || !b.ok || a.plot.kind !== 'explicit' || b.plot.kind !== 'explicit') return false
  const na = a.plot.paramNames
  const nb = b.plot.paramNames
  if (na.length !== nb.length || nb.some((n) => !na.includes(n))) return false
  const ma = a.plot.makeModel('pw-verify-a')
  const mb = b.plot.makeModel('pw-verify-b')
  const sets = [a.plot.defaultParams, na.map((_, i) => 1.37 + 0.61 * i)]
  for (const pa of sets) {
    const pb = nb.map((n) => pa[na.indexOf(n)])
    const ga = graphOf(ma, pa)
    const gb = graphOf(mb, pb)
    const xs: number[] = []
    for (let i = 0; i <= 48; i++) xs.push(-12 + 0.5 * i + 0.013)
    for (const q of ma.pieces?.(pa) ?? []) {
      for (const e of [q.lo, q.hi]) {
        if (Number.isFinite(e)) xs.push(e, e - 1e-6, e + 1e-6, e - 0.25, e + 0.25)
      }
    }
    for (const x of xs) {
      if (!same(ga(x), gb(x))) return false
    }
  }
  return true
}

/**
 * The function a line DRAWS: its evaluator, undefined outside the reported
 * pieces. (A plain bounded restriction keeps an ungated evaluator and lets
 * the domain clip it, so the evaluator alone says nothing at x = 5 of
 * x^2 {0 <= x < 3}; the pieces do.)
 */
function graphOf(m: ModelSpec, params: number[]): (x: number) => number {
  const ps = m.pieces?.(params) ?? null
  return (x) => {
    if (ps && !ps.some((q) => (x > q.lo || (x === q.lo && q.loClosed)) && (x < q.hi || (x === q.hi && q.hiClosed)))) {
      return Number.NaN
    }
    return m.evalExplicit!(params, x)
  }
}

/**
 * Any typed piecewise line — `{ … if … ; … }`, `{ … if …, … }`, `{ e, c ; … }`,
 * `piecewise(e, c, …)` — or one restricted formula (`x^2 {0 <= x < 3}`,
 * `x^2, 0 <= x < 3`, `x^2 for x > 0`) → the table. Null for an ordinary
 * line, a polar or implicit one, a condition in another variable, or any
 * reading that does not evaluate exactly like the line itself.
 */
export function readPiecewise(src: string): PiecewiseSpec | null {
  if (typeof src !== 'string' || src.trim() === '') return null
  const parsed = parseExpression(src)
  if (!parsed.ok || parsed.plot.kind !== 'explicit') return null
  const parts = piecewiseParts(src)
  if (!parts || parts.branches.length === 0) return null

  let name: string | undefined
  if (parts.head !== '' && parts.head !== 'y') {
    const m = NAME_HEAD_RE.exec(parts.head)
    if (!m) return null
    name = m[1]
  }

  // Constant bounds everywhere: what each branch OWNS, sorted.
  const sets: (Piece[] | null)[] = parts.branches.map((b) =>
    b.otherwise || b.cond === '' ? null : constCondition(b.cond),
  )
  let pieces: PieceSpec[]
  if (sets.every((s, i) => s !== null || parts.branches[i].otherwise || parts.branches[i].cond === '')) {
    const owned: { p: PieceSpec; lo: number; hi: number; order: number }[] = []
    const before: Piece[] = []
    parts.branches.forEach((b, i) => {
      const set = sets[i]
      const claim: Piece[] = set ?? [{ lo: -Infinity, hi: Infinity, loC: false, hiC: false, loTex: null, hiTex: null }]
      const mine = before.length === 0 ? claim : complementOf([...complementOf(claim), ...before])
      for (const q of mine) owned.push({ p: pieceOf(b.expr, q), lo: q.lo, hi: q.hi, order: owned.length })
      before.push(...claim)
    })
    owned.sort((u, v) => u.lo - v.lo || u.hi - v.hi || u.order - v.order)
    pieces = owned.map((o) => o.p)
  } else {
    // A slider bound somewhere: the typed order, one piece per branch.
    pieces = []
    for (const [i, b] of parts.branches.entries()) {
      if (b.otherwise || b.cond === '') {
        pieces.push({ expr: b.expr, loClosed: false, hiClosed: false })
        continue
      }
      const set = sets[i]
      if (set) {
        const holes = excludedPoints(set)
        if (set.length !== 1 || (holes && holes.length > 0)) return null
        pieces.push(pieceOf(b.expr, set[0]))
        continue
      }
      const live = sliderCondition(b.expr, b.cond)
      if (!live) return null
      pieces.push(live)
    }
  }
  if (pieces.length === 0) return null
  const spec: PiecewiseSpec = name ? { name, pieces } : { pieces }
  return verify(src, spec) ? spec : null
}

// ----------------------------------------------------------------------------
// breakpoints
// ----------------------------------------------------------------------------

interface NumPiece {
  i: number
  lo: number
  hi: number
  loC: boolean
  hiC: boolean
}

/** A bound's value; ±∞ when absent; NaN when it is not a constant. */
function boundValue(t: string | undefined, absent: number): number {
  const s = boundText(t)
  if (s === undefined) return absent
  const a = analyzeExpr(s)
  if (!a.ok || a.free.length > 0 || !Number.isFinite(a.value)) return Number.NaN
  return a.value
}

const contains = (p: NumPiece, x: number): boolean =>
  (x > p.lo || (x === p.lo && p.loC)) && (x < p.hi || (x === p.hi && p.hiC))
/** p owns a left neighbourhood of c: (c − δ, c). */
const claimsLeft = (p: NumPiece, c: number): boolean => p.lo < c && c <= p.hi
/** p owns a right neighbourhood of c: (c, c + δ). */
const claimsRight = (p: NumPiece, c: number): boolean => p.lo <= c && c < p.hi

/**
 * The one-sided limit of one piece's own formula at c, approached from
 * `dir` (−1 from the left, +1 from the right). The formula AT c is preferred
 * — it is usually defined there even when the piece stops short — provided
 * it agrees with the formula a hair inside (so a floor stepping exactly at c
 * is not mistaken for its value). Otherwise the limit is extrapolated from
 * inside samples; a side whose samples keep growing runs off to ±∞. Null
 * when the formula has no values near c at all.
 */
function sideLimit(f: (x: number) => number, c: number, dir: -1 | 1): number | null {
  const scale = Math.max(1, Math.abs(c))
  const at = f(c)
  const hair = f(c + dir * 1e-9 * scale)
  if (Number.isFinite(at) && Number.isFinite(hair) && Math.abs(at - hair) <= 1e-4 * Math.max(1, Math.abs(at))) {
    return snap(at)
  }
  const hs = [1e-3, 1e-4, 1e-5, 1e-6, 1e-7].map((h) => h * scale)
  const vs = hs.map((h) => f(c + dir * h))
  const tail = vs.slice(2)
  if (tail.some((v) => Number.isNaN(v))) return null
  if (tail.some((v) => !Number.isFinite(v))) {
    const inf = tail.find((v) => !Number.isFinite(v))!
    return inf > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
  }
  const d1 = Math.abs(vs[3] - vs[2])
  const d2 = Math.abs(vs[4] - vs[3])
  if (d2 > 0.5 * d1 && d2 > 1e-6 * Math.max(1, Math.abs(vs[4]))) {
    return vs[4] > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
  }
  const h = 1e-6 * scale
  const lin = 2 * f(c + dir * h) - f(c + dir * 2 * h)
  return snap(Number.isFinite(lin) ? lin : vs[4])
}

/** "2 < x < 3", "2 ≤ x < 3" — the stretch a gap leaves undefined. */
function stretch(a: number, aIn: boolean, b: number, bIn: boolean): string {
  return `${numText(a)} ${aIn ? '<' : '≤'} x ${bIn ? '<' : '≤'} ${numText(b)}`
}

/**
 * What happens at every boundary between pieces and at every bounded end:
 * the one-sided limits (each piece's own formula, via `evalPiece`), the
 * value (from the first piece that includes the point — the parser's rule),
 * the verdict and the sentence a teacher would say. Left to right.
 */
export function breakpoints(
  spec: PiecewiseSpec,
  evalPiece: (index: number, x: number) => number,
): Breakpoint[] {
  const pieces: NumPiece[] = []
  ;(spec.pieces ?? []).forEach((p, i) => {
    const lo = boundValue(p.lo, Number.NEGATIVE_INFINITY)
    const hi = boundValue(p.hi, Number.POSITIVE_INFINITY)
    if (Number.isNaN(lo) || Number.isNaN(hi) || lo > hi) return
    const q: NumPiece = { i, lo, hi, loC: Number.isFinite(lo) && p.loClosed, hiC: Number.isFinite(hi) && p.hiClosed }
    if (lo === hi && !(q.loC && q.hiC)) return
    pieces.push(q)
  })
  const fname = spec.name ?? 'f'
  const ev = (i: number, x: number): number => {
    try {
      const v = evalPiece(i, x)
      return typeof v === 'number' ? v : Number.NaN
    } catch {
      return Number.NaN
    }
  }

  const xs: number[] = []
  for (const p of pieces) {
    for (const e of [p.lo, p.hi]) {
      if (Number.isFinite(e) && !xs.some((x) => same(x, e, 1e-12))) xs.push(e)
    }
  }
  xs.sort((a, b) => a - b)

  const out: Breakpoint[] = []
  for (const c of xs) {
    const xt = numText(c)
    const fAt = `${fname}(${xt})`
    const incl = pieces.filter((p) => contains(p, c))
    const lefts = pieces.filter((p) => claimsLeft(p, c))
    const rights = pieces.filter((p) => claimsRight(p, c))
    const vals = incl.map((p) => {
      const v = ev(p.i, c)
      return Number.isFinite(v) ? snap(v) : null
    })
    const value = incl.length > 0 ? vals[0] : null
    const lLims = lefts.map((p) => sideLimit((x) => ev(p.i, x), c, -1))
    const rLims = rights.map((p) => sideLimit((x) => ev(p.i, x), c, 1))
    const leftLimit = lefts.length > 0 ? lLims[0] : null
    const rightLimit = rights.length > 0 ? rLims[0] : null
    const valueText = value === null ? `${fAt} is not defined` : `${fAt} = ${numText(value)}`
    const differ = (vs: (number | null)[]): boolean =>
      vs.some((v) => (v === null) !== (vs[0] === null) || (v !== null && vs[0] !== null && !same(v, vs[0])))

    let kind: BreakKind
    let sentence: string
    const inf = (v: number | null): boolean => v !== null && !Number.isFinite(v)

    if (incl.length > 1 && differ(vals)) {
      kind = 'overlap'
      sentence =
        `overlap at x = ${xt}: two pieces both include x = ${xt} and disagree — ` +
        vals.map((v) => (v === null ? 'undefined' : `${fAt} = ${numText(v)}`)).join(' and ')
    } else if (lefts.length > 1 && differ(lLims)) {
      kind = 'overlap'
      sentence = `overlap at x = ${xt}: two pieces both define ${fname} just left of x = ${xt} ` +
        `(limits ${lLims.map((v) => (v === null ? 'undefined' : numText(v))).join(' and ')})`
    } else if (rights.length > 1 && differ(rLims)) {
      kind = 'overlap'
      sentence = `overlap at x = ${xt}: two pieces both define ${fname} just right of x = ${xt} ` +
        `(limits ${rLims.map((v) => (v === null ? 'undefined' : numText(v))).join(' and ')})`
    } else if (inf(leftLimit) || inf(rightLimit)) {
      kind = 'infinite'
      sentence = `infinite discontinuity at x = ${xt}`
    } else if (lefts.length > 0 && rights.length > 0) {
      if (leftLimit === null || rightLimit === null) {
        kind = 'gap'
        sentence = `gap: ${fname} has no values just ${leftLimit === null ? 'left' : 'right'} of x = ${xt}`
      } else if (!same(leftLimit, rightLimit)) {
        kind = 'jump'
        sentence =
          `jump of ${numText(snap(Math.abs(rightLimit - leftLimit)))} at x = ${xt}: ` +
          `left limit ${numText(leftLimit)}, right limit ${numText(rightLimit)}, ${valueText}`
      } else if (value === null || !same(value, leftLimit)) {
        kind = 'removable'
        sentence = `removable discontinuity at x = ${xt}: limit ${numText(leftLimit)}, ${valueText}`
      } else {
        kind = 'continuous'
        sentence = `continuous at x = ${xt}`
      }
    } else {
      // One side (or neither) is claimed: an end, or the edge of a gap.
      const later = pieces.filter((p) => p.lo > c || (p.lo === c && !contains(p, c) && p.hi > c))
      const next = later.length > 0 ? Math.min(...later.map((p) => p.lo)) : null
      if (rights.length === 0 && next !== null) {
        kind = 'gap'
        const nextIn = pieces.some((p) => contains(p, next))
        sentence = `gap: ${fname} is not defined on ${stretch(c, value !== null, next, nextIn)}`
      } else if (lefts.length > 0) {
        kind = 'end'
        sentence = `${fname} ends at x = ${xt}: left limit ${leftLimit === null ? 'undefined' : numText(leftLimit)}, ${valueText}`
      } else if (rights.length > 0) {
        kind = 'end'
        const earlier = pieces.some((p) => p.hi < c)
        sentence =
          `${fname} ${earlier ? 'resumes' : 'starts'} at x = ${xt}: ` +
          `right limit ${rightLimit === null ? 'undefined' : numText(rightLimit)}, ${valueText}`
      } else {
        kind = 'end'
        sentence = value === null ? `${valueText}` : `isolated point at x = ${xt}: ${valueText}`
      }
    }
    if (kind !== 'overlap' && incl.length > 1 && value !== null) {
      sentence += ` (two pieces include x = ${xt} and agree: ${fAt} = ${numText(value)})`
    }
    out.push({ x: c, xText: xt, leftLimit, rightLimit, value, kind, sentence })
  }
  return out
}

// ----------------------------------------------------------------------------
// stepSpec
// ----------------------------------------------------------------------------

/** Index of the ')' closing the '(' at `i`; -1 when it never closes. */
function closeParen(s: string, i: number): number {
  let depth = 0
  for (let k = i; k < s.length; k++) {
    if (s[k] === '(') depth++
    else if (s[k] === ')') {
      depth--
      if (depth === 0) return k
    }
  }
  return -1
}

/**
 * Step functions. 'floor' / 'ceil' / 'round' → the one-line typed source
 * a·floor(b(x − h)) + k (written by transform.ts's own textbook rules, so the
 * coefficient and shift read as they do on every other card); 'round' is
 * floor(b(x − h) + 1/2), the parser having no round(). 'table' → a spec of
 * constant pieces, e.g. a parking fee:
 *   0 < x ≤ 1 → 5,  1 < x ≤ 2 → 8,  2 < x ≤ 3 → 11.
 * An empty or infinite table bound is an unbounded side.
 */
export function stepSpec(
  kind: 'floor' | 'ceil' | 'round' | 'table',
  opts: { a?: string; b?: string; h?: string; k?: string; table?: { lo: string; hi: string; value: string; loClosed: boolean; hiClosed: boolean }[] },
): PiecewiseSpec | string {
  if (kind === 'table') {
    const pieces: PieceSpec[] = (opts?.table ?? []).map((r) => {
      const lo = boundText(r.lo)
      const hi = boundText(r.hi)
      const p: PieceSpec = {
        expr: (r.value ?? '').trim() || '0',
        loClosed: lo !== undefined && r.loClosed === true,
        hiClosed: hi !== undefined && r.hiClosed === true,
      }
      if (lo !== undefined) p.lo = lo
      if (hi !== undefined) p.hi = hi
      return p
    })
    return { pieces }
  }
  const t = (s: string | undefined, d: string): string => (s === undefined || s.trim() === '' ? d : s.trim())
  const src = transformSource({ parent: 'floor', a: t(opts?.a, '1'), b: t(opts?.b, '1'), h: t(opts?.h, '0'), k: t(opts?.k, '0') })
  if (kind === 'floor') return src
  // The step's own floor( — the last one whose argument holds the x.
  let at = -1
  for (let i = src.indexOf('floor('); i >= 0; i = src.indexOf('floor(', i + 1)) {
    const close = closeParen(src, i + 5)
    if (close > 0 && /x/.test(src.slice(i + 6, close))) at = i
  }
  if (at < 0) return src // a = 0: the line is the constant k
  const close = closeParen(src, at + 5)
  const inner = src.slice(at + 6, close)
  const fn = kind === 'ceil' ? `ceil(${inner})` : `floor(${inner} + 1/2)`
  return src.slice(0, at) + fn + src.slice(close + 1)
}

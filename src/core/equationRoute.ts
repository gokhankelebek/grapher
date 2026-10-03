// ============================================================================
// src/core/equationRoute.ts — the ALGEBRAIC route through an equation, and the
// extraneous solutions it produces (NC.M2/M3.A-REI.2).
//
//   equationRoute(L, R, v)     the route for L = R, or null when none applies
//
// The number-line solver (./solveInequality.ts) solves L = R by the sign of
// h = L − R, so it never meets an extraneous root: it only ever evaluates the
// original equation. A class does not solve it that way. It
//
//   squares both sides          √(x + 7) = x − 5   →  x + 7 = (x − 5)²
//   multiplies by the LCD       x/(x−2) = 2/(x−2) + 5  →  x = 2 + 5(x − 2)
//   combines the logs           log x + log(x − 3) = 1  →  x(x − 3) = 10
//
// and each of those steps can ADD roots: squaring forgets the sign, clearing
// denominators forgets they could be 0, and combining logs forgets each
// argument had to be positive. So the route is: the step, the polynomial it
// leaves, its roots (the candidates — exact by the solver's own rational-root
// and surd code), and then every candidate checked in the ORIGINAL equation,
// exactly where it is rational: ✓ a solution, ✗ extraneous, with the reason.
//
// What is read, and only this (anything else: null, and the card shows the
// sign-chart working alone):
//   radical   ONE √ of a polynomial, α·√u + β(x) = (polynomial), α a constant;
//             or α√u = γ√w with each root alone on its side
//   rational  both sides ratios of polynomials with a denominator in x
//   log       Σ kᵢ·log_b(uᵢ) + K = 0 with one base, integer kᵢ, polynomial uᵢ,
//             and b^(−K) rational (an integer K for log, K = 0 for ln)
//
// Pure: no DOM, nothing from src/ui.
// ============================================================================

import type { ExprNode } from './parse'
import type { Q, QP, IsVar } from './solveInequality'
import {
  mkQ, Q0, Q1, qadd, qmul, qdiv, qneg, qz, qsign, qeq, qnum, qint, qText, qTex,
  qpTrim, qpDeg, qpLead, qpSub, qpMul, qpScale, qpEq, qpDivmod, qpGcd, qpEval, qpEvalF, qpMonic,
  qpText, qpTex, qRoots, toRQ, hasVarNode, constValue,
} from './solveInequality'

const MINUS = '−'

export type RouteKind = 'radical' | 'rational' | 'log'

export interface RouteStep {
  text: string
  tex?: string
}

export interface RouteCandidate {
  x: number
  /** the candidate as written: "9", "−3/2", "(1 + √5)/2", or a decimal */
  text: string
  tex: string
  /** the text is the exact value */
  exact: boolean
  /** a solution of the ORIGINAL equation */
  ok: boolean
  /** why: "√(9 + 7) = 4 and 9 − 5 = 4", "√(2 + 7) = 3 but 2 − 5 = −3: squaring lost the sign" */
  reason: string
}

export interface EquationRoute {
  kind: RouteKind
  /** "Square both sides", "Multiply both sides by the LCD", "Combine the logs" */
  method: string
  /** the working, in order, up to the candidates */
  steps: RouteStep[]
  /** the polynomial the step leaves, = 0 */
  polynomial: { text: string; tex: string } | null
  candidates: RouteCandidate[]
  /** the equation holds for every x the original allows (P ≡ 0) */
  identity: boolean
  /** "x = 9 is the solution; x = 2 is extraneous." */
  summary: string
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const RAT_RE = /^(−|-)?(\d+)(?:\/(\d+))?$/

/** The rational a root's exact text names, or null for a surd / decimal. */
function rootQ(text: string | undefined): Q | null {
  if (!text) return null
  const m = RAT_RE.exec(text.trim())
  if (!m) return null
  const n = BigInt(m[2]) * (m[1] ? -1n : 1n)
  return mkQ(n, m[3] ? BigInt(m[3]) : 1n)
}

/** A rational that is a perfect square: its square root, else null. */
function qSqrt(a: Q): Q | null {
  if (qsign(a) < 0) return null
  const isq = (n: bigint): bigint | null => {
    if (n < 0n) return null
    if (n < 2n) return n
    let x = BigInt(Math.floor(Math.sqrt(Number(n))))
    while (x * x > n) x--
    while ((x + 1n) * (x + 1n) <= n) x++
    return x * x === n ? x : null
  }
  const n = isq(a.n)
  const d = isq(a.d)
  return n !== null && d !== null ? mkQ(n, d) : null
}

function decimal(v: number): string {
  if (!Number.isFinite(v)) return '?'
  if (Math.abs(v) < 1e-12) return '0'
  const s = String(Number(v.toPrecision(4)))
  return s.startsWith('-') ? MINUS + s.slice(1) : s
}

/** A polynomial in v as text, wrapped when it is a sum: "(x − 5)". */
function wrapPoly(p: QP, v: string): string {
  const t = qpText(p, v)
  return /[+−] /.test(t.replace(/^−/, '')) || (qpDeg(p) >= 1 && !qeq(qpLead(p), Q1) && qpDeg(p) >= 1 && p.length > 1 && p.filter((c) => !qz(c)).length > 1) ? `(${t})` : t
}
function wrapPolyTex(p: QP, v: string): string {
  const t = qpTex(p, v)
  return p.filter((c) => !qz(c)).length > 1 ? `\\left(${t}\\right)` : t
}

/** A polynomial (denominator a nonzero constant) or null. */
function polyOf(n: ExprNode, isVar: IsVar): QP | null {
  const r = toRQ(n, isVar)
  if (!r || r.den.length === 0) return null
  if (qpDeg(r.den) !== 0) return null
  return qpScale(r.num, qdiv(Q1, r.den[0]))
}

/** Exact rational of a var-free node, or null. */
function constQ(n: ExprNode, isVar: IsVar): Q | null {
  if (hasVarNode(n, isVar)) return null
  const r = toRQ(n, isVar)
  if (r && qpDeg(r.den) === 0 && r.den.length === 1) {
    const v = r.num.length === 0 ? Q0 : qpDeg(r.num) === 0 ? r.num[0] : null
    return v ? qdiv(v, r.den[0]) : null
  }
  return null
}

/** Real roots of P as candidates (exact texts where the solver has them). */
function candidatesOf(P: QP, v: string): { x: number; text: string; tex: string; exact: boolean; q: Q | null }[] {
  if (qpDeg(P) < 1) return []
  const { roots } = qRoots(P, v)
  return roots.map((r) => ({
    x: r.exact ? r.exact.value : r.x,
    text: r.exact ? r.exact.text : decimal(r.x),
    tex: r.exact ? r.exact.tex : decimal(r.x).replace(MINUS, '-'),
    exact: !!r.exact,
    q: r.exact ? rootQ(r.exact.text) : null,
  }))
}

function listText(xs: readonly string[]): string {
  if (xs.length <= 1) return xs.join('')
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}

function summaryOf(cands: readonly RouteCandidate[], v: string, identity: boolean): string {
  if (identity) return `The equation holds for every ${v} the original allows.`
  if (cands.length === 0) return 'The resulting equation has no real solutions, so neither does the original.'
  const good = cands.filter((c) => c.ok).map((c) => `${v} = ${c.text}`)
  const bad = cands.filter((c) => !c.ok).map((c) => `${v} = ${c.text}`)
  const parts: string[] = []
  if (good.length) parts.push(`${listText(good)} ${good.length > 1 ? 'are solutions' : 'is the solution'}`)
  else parts.push('there is no solution')
  if (bad.length) parts.push(`${listText(bad)} ${bad.length > 1 ? 'are' : 'is'} extraneous`)
  const s = parts.join('; ')
  return (s.startsWith('there') ? 'T' + s.slice(1) : s) + '.'
}

/** "x² − 2x − 8 = 0" with the polynomial made primitive (integer coefficients, positive lead). */
function primitive(P: QP): QP {
  if (P.length === 0) return P
  let L = 1n
  const g = (a: bigint, b: bigint): bigint => {
    a = a < 0n ? -a : a
    b = b < 0n ? -b : b
    while (b !== 0n) [a, b] = [b, a % b]
    return a
  }
  for (const c of P) L = (L / g(L, c.d)) * c.d
  let G = 0n
  for (const c of P) G = g(G, (c.n * L) / c.d)
  if (G === 0n) G = 1n
  let s = mkQ(L, G)
  if (qsign(qpLead(P)) < 0) s = qneg(s)
  return qpScale(P, s)
}

// ---------------------------------------------------------------------------
// The tree, read
// ---------------------------------------------------------------------------

/** The √ calls (and ^(1/2)) in a tree that contain the variable. */
function sqrtNodes(n: ExprNode, isVar: IsVar, out: ExprNode[] = []): ExprNode[] {
  switch (n.t) {
    case 'call':
      if (n.fn === 'sqrt' && n.args.length === 1 && hasVarNode(n.args[0], isVar)) out.push(n)
      else n.args.forEach((a) => sqrtNodes(a, isVar, out))
      return out
    case 'bin':
      if (n.op === '^' && hasVarNode(n.a, isVar) && !hasVarNode(n.b, isVar) && Math.abs(constValue(n.b) - 0.5) < 1e-15) {
        out.push(n)
        return out
      }
      sqrtNodes(n.a, isVar, out)
      sqrtNodes(n.b, isVar, out)
      return out
    case 'neg':
      sqrtNodes(n.a, isVar, out)
      return out
    default:
      return out
  }
}

const sqrtArg = (n: ExprNode): ExprNode => (n.t === 'call' ? n.args[0] : (n as Extract<ExprNode, { t: 'bin' }>).a)

/** The tree with node `at` replaced by the number k (unchanged subtrees are shared, so node identity survives). */
function replaceNode(n: ExprNode, at: ExprNode, k: number): ExprNode {
  if (n === at) return { t: 'num', v: k, raw: String(k) } as ExprNode
  switch (n.t) {
    case 'neg': {
      const a = replaceNode(n.a, at, k)
      return a === n.a ? n : ({ ...n, a } as ExprNode)
    }
    case 'bin': {
      const a = replaceNode(n.a, at, k)
      const b = replaceNode(n.b, at, k)
      return a === n.a && b === n.b ? n : ({ ...n, a, b } as ExprNode)
    }
    case 'call': {
      const args = n.args.map((x) => replaceNode(x, at, k))
      return args.every((x, i) => x === n.args[i]) ? n : ({ ...n, args } as ExprNode)
    }
    default:
      return n
  }
}

/** Does the tree contain anything a polynomial / rational route cannot read? */
function hasTranscendental(n: ExprNode, isVar: IsVar): boolean {
  switch (n.t) {
    case 'call':
      return hasVarNode(n, isVar)
    case 'bin':
      if (n.op === '^' && hasVarNode(n.b, isVar)) return true
      return hasTranscendental(n.a, isVar) || hasTranscendental(n.b, isVar)
    case 'neg':
      return hasTranscendental(n.a, isVar)
    default:
      return false
  }
}

// ---------------------------------------------------------------------------
// Radical: isolate, square, check the sign
// ---------------------------------------------------------------------------

/** S = α·√u + β(x) with α a nonzero constant and β a polynomial, or null. */
function linearInRoot(S: ExprNode, root: ExprNode, isVar: IsVar): { alpha: Q; beta: QP } | null {
  const beta = polyOf(replaceNode(S, root, 0), isVar)
  const one = polyOf(replaceNode(S, root, 1), isVar)
  const two = polyOf(replaceNode(S, root, 2), isVar)
  if (!beta || !one || !two) return null
  const a = qpSub(one, beta)
  if (qpDeg(a) !== 0) return null
  const alpha = a[0]
  // linear in the root: S(2) − β = 2α
  if (!qpEq(qpSub(two, beta), qpScale(a, mkQ(2n)))) return null
  return { alpha, beta }
}

/** √u as text: "√x", "√(x + 7)", with a constant in front: "2√(x + 1)". */
function rootText(c: Q, u: QP, v: string): { text: string; tex: string } {
  const inner = u.filter((k) => !qz(k)).length > 1 || (qpDeg(u) >= 1 && !qeq(qpLead(u), Q1)) ? `√(${qpText(u, v)})` : `√${qpText(u, v)}`
  const head = qeq(c, Q1) ? '' : qeq(c, qneg(Q1)) ? MINUS : qint(c) ? qText(c) : `(${qText(c)})`
  const headX = qeq(c, Q1) ? '' : qeq(c, qneg(Q1)) ? '-' : qTex(c)
  return { text: `${head}${inner}`, tex: `${headX}\\sqrt{${qpTex(u, v)}}` }
}

/** "W² − 2γW√w" style: a polynomial times a root, signed, for the middle of a line. */
function timesRoot(k: QP, w: QP, v: string): { text: string; tex: string; neg: boolean } {
  const neg = k.length > 0 && qsign(qpLead(k)) < 0 && k.filter((c) => !qz(c)).length === 1
  const kk = neg ? qpScale(k, qneg(Q1)) : k
  const r = rootText(Q1, w, v)
  if (qpDeg(kk) === 0 && kk.length === 1) {
    const c = kk[0]
    const t = qeq(c, Q1) ? '' : qint(c) ? qText(c) : `(${qText(c)})`
    return { text: `${t}${r.text}`, tex: `${qeq(c, Q1) ? '' : qTex(c)}${r.tex}`, neg }
  }
  return { text: `${wrapPoly(kk, v)}${r.text}`, tex: `${wrapPolyTex(kk, v)}${r.tex}`, neg }
}

/** Exact √ of a rational where it is rational; else null. */
const exactRoot = (q: Q): Q | null => qSqrt(q)

/** The value of α√u at c, exactly (a rational) when it is one, else a decimal; null when u(c) < 0. */
function rootValue(alpha: Q, u: QP, c: { x: number; q: Q | null }): { v: number; text: string } | null {
  if (c.q) {
    const uc = qpEval(u, c.q)
    if (qsign(uc) < 0) return null
    const s = exactRoot(uc)
    if (s) {
      const val = qmul(alpha, s)
      return { v: qnum(val), text: qText(val) }
    }
    const v = qnum(alpha) * Math.sqrt(qnum(uc))
    return { v, text: `${qeq(alpha, Q1) ? '' : `${qText(alpha)}`}√${qint(uc) ? qText(uc) : `(${qText(uc)})`}` }
  }
  const ucf = qpEvalF(u, c.x)
  if (ucf < -1e-9 * Math.max(1, Math.abs(c.x))) return null
  const v = qnum(alpha) * Math.sqrt(Math.max(0, ucf))
  return { v, text: `≈ ${decimal(v)}` }
}

function polyValue(p: QP, c: { x: number; q: Q | null }): { v: number; text: string } {
  if (c.q) {
    const val = qpEval(p, c.q)
    return { v: qnum(val), text: qText(val) }
  }
  const v = qpEvalF(p, c.x)
  return { v, text: `≈ ${decimal(v)}` }
}

const eqSign = (t: string): string => (t.startsWith('≈') ? t : `= ${t}`)

function radicalRoute(L: ExprNode, R: ExprNode, isVar: IsVar, v: string): EquationRoute | null {
  const rl = sqrtNodes(L, isVar)
  const rr = sqrtNodes(R, isVar)
  const steps: RouteStep[] = []
  if (rl.length + rr.length > 2 || rl.length > 2 || rr.length > 2) return null
  // Every root to the left: Σ αᵢ√uᵢ + β(x) = o(x). Read each side's roots
  // with the other root (if any) held at 0, so a side may hold both.
  type RootPart = { alpha: Q; u: QP; node: ExprNode; side: 'L' | 'R' }
  const parts: RootPart[] = []
  let beta: QP = []
  let other: QP = []
  const readSide = (S: ExprNode, roots: ExprNode[], side: 'L' | 'R'): boolean => {
    let rest = S
    for (const r of roots) {
      const others = roots.filter((x) => x !== r)
      let probe = S
      for (const o of others) probe = replaceNode(probe, o, 0)
      const lin = linearInRoot(probe, r, isVar)
      const u = polyOf(sqrtArg(r), isVar)
      if (!lin || !u || qz(lin.alpha)) return false
      parts.push({ alpha: lin.alpha, u, node: r, side })
      rest = replaceNode(rest, r, 0)
    }
    if (hasTranscendental(rest, isVar)) return false
    const poly = polyOf(rest, isVar)
    if (!poly) return false
    if (side === 'L') beta = poly
    else other = poly
    return true
  }
  if (!readSide(L, rl, 'L') || !readSide(R, rr, 'R')) return null
  // the full equation evaluated at a candidate, for the check
  const evalSide = (side: 'L' | 'R', c: { x: number; q: Q | null }): { v: number; text: string } | null => {
    let total = 0
    let exact: Q | null = Q0
    const mine = parts.filter((q) => q.side === side)
    const polyHere = side === 'L' ? beta : other
    // a lone root keeps its exact form: √7
    if (mine.length === 1 && polyHere.length === 0) return rootValue(mine[0].alpha, mine[0].u, c)
    for (const p of mine) {
      const r = rootValue(p.alpha, p.u, c)
      if (!r) return null
      total += r.v
      const rq = c.q ? exactRoot(qpEval(p.u, c.q)) : null
      exact = exact && rq ? qadd(exact, qmul(p.alpha, rq)) : null
    }
    const pol = side === 'L' ? beta : other
    const pv = polyValue(pol, c)
    total += pv.v
    if (exact && c.q) {
      const val = qadd(exact, qpEval(pol, c.q))
      return { v: qnum(val), text: qText(val) }
    }
    return { v: total, text: `≈ ${decimal(total)}` }
  }

  let P: QP
  let isolated: { lhs: { text: string }; w: QP; alpha: Q; u: QP } | null = null
  if (parts.length === 1) {
    // ---- one root: α√u = w, w = o − β (moved to the side away from the root)
    const p0 = parts[0]
    // a negative coefficient goes to the other side: −√x = 6 − x is √x = x − 6
    const flip = qsign(p0.alpha) < 0
    const p = flip ? { ...p0, alpha: qneg(p0.alpha) } : p0
    const w0 = p.side === 'L' ? qpSub(other, beta) : qpSub(beta, other)
    const w = flip ? qpScale(w0, qneg(Q1)) : w0
    const rt = rootText(p.alpha, p.u, v)
    const sideHasMore = (p.side === 'L' ? beta : other).length !== 0
    if (sideHasMore) steps.push({ text: `Isolate the square root: ${rt.text} = ${qpText(w, v)}`, tex: `${rt.tex} = ${qpTex(w, v)}` })
    const a2 = qmul(p.alpha, p.alpha)
    const lhsT = qeq(a2, Q1) ? qpText(p.u, v) : `${qText(a2)}${wrapPoly(p.u, v)}`
    const lhsX = qeq(a2, Q1) ? qpTex(p.u, v) : `${qTex(a2)}${wrapPolyTex(p.u, v)}`
    steps.push({ text: `Square both sides: ${lhsT} = ${wrapPoly(w, v)}²`, tex: `${lhsX} = ${wrapPolyTex(w, v)}^{2}` })
    P = primitive(qpSub(qpMul(w, w), qpScale(p.u, a2)))
    isolated = { lhs: rt, w, alpha: p.alpha, u: p.u }
  } else {
    // ---- two roots
    const [p1, p2] = parts
    // Bring every term to the form α√u + γ√w = W (both roots on the left).
    const a = p1.alpha
    const u = p1.u
    const g = p2.side === p1.side ? p2.alpha : qneg(p2.alpha)
    const w2 = p2.u
    const W = p1.side === 'L' ? qpSub(other, beta) : qpSub(beta, other)
    const r1 = rootText(a, u, v)
    const r2 = rootText(g, w2, v)
    const a2 = qmul(a, a)
    if (W.length === 0 && p1.side !== p2.side) {
      // α√u = γ'√w with nothing else: one squaring
      const g2 = qmul(g, g)
      const rr2 = rootText(qneg(g), w2, v)
      steps.push({ text: `${r1.text} = ${rr2.text}`, tex: `${r1.tex} = ${rr2.tex}` })
      const lt = qeq(a2, Q1) ? qpText(u, v) : `${qText(a2)}${wrapPoly(u, v)}`
      const rt2 = qeq(g2, Q1) ? qpText(w2, v) : `${qText(g2)}${wrapPoly(w2, v)}`
      steps.push({ text: `Square both sides: ${lt} = ${rt2}` })
      P = primitive(qpSub(qpScale(u, a2), qpScale(w2, g2)))
    } else {
      // α√u = W − γ√w → α²u = W² + γ²w − 2γW√w → 2γW√w = W² + γ²w − α²u → square again
      const negR2 = rootText(qneg(g), w2, v)
      const rhs1 = W.length === 0 ? negR2.text : `${qpText(W, v)} ${negR2.text.startsWith(MINUS) ? `${MINUS} ${negR2.text.slice(1)}` : `+ ${negR2.text}`}`
      steps.push({ text: `Isolate one square root: ${r1.text} = ${rhs1}` })
      const g2 = qmul(g, g)
      const sumPoly = qpAdd2(qpMul(W, W), qpScale(w2, g2))
      const K = qpScale(W, qmul(mkQ(2n), g)) // the coefficient of √w on the right, with a minus in front
      const tr = timesRoot(K, w2, v)
      const lt = qeq(a2, Q1) ? qpText(u, v) : `${qText(a2)}${wrapPoly(u, v)}`
      steps.push({ text: `Square both sides: ${lt} = ${qpText(sumPoly, v)} ${tr.neg ? '+' : MINUS} ${tr.text}` })
      let M = qpSub(sumPoly, qpScale(u, a2))
      if (K.length === 0) return null
      // K√w = M, written with a positive coefficient on the root
      let Kd = K
      if (qsign(qpLead(K)) < 0) {
        Kd = qpScale(K, qneg(Q1))
        M = qpScale(M, qneg(Q1))
      }
      steps.push({ text: `Isolate the other square root: ${timesRoot(Kd, w2, v).text} = ${qpText(M, v)}` })
      const K2 = qpMul(K, K)
      steps.push({ text: `Square again: ${qpText(qpMul(K2, w2), v)} = ${qpDeg(M) < 1 ? qpText(qpMul(M, M), v) : `${wrapPoly(M, v)}²`}` })
      P = primitive(qpSub(qpMul(K2, w2), qpMul(M, M)))
    }
  }
  if (P.length === 0) return null
  steps.push({ text: `Expand and collect: ${qpText(P, v)} = 0`, tex: `${qpTex(P, v)} = 0` })
  const cands: RouteCandidate[] = candidatesOf(P, v).map((c) => {
    const base = { x: c.x, text: c.text, tex: c.tex, exact: c.exact }
    // a root of a negative number: not even defined
    for (const p of parts) {
      const uc = c.q ? qpEval(p.u, c.q) : null
      const ucf = uc ? qnum(uc) : qpEvalF(p.u, c.x)
      if (uc ? qsign(uc) < 0 : ucf < -1e-9 * Math.max(1, Math.abs(c.x) ** Math.max(1, qpDeg(p.u)))) {
        return { ...base, ok: false, reason: `${qpText(p.u, v)} ${uc ? `= ${qText(uc)}` : `≈ ${decimal(ucf)}`} is negative, so ${rootText(Q1, p.u, v).text} is not a real number` }
      }
    }
    if (isolated) {
      const rv = rootValue(isolated.alpha, isolated.u, c) as { v: number; text: string }
      const wv = polyValue(isolated.w, c)
      const tol = 1e-9 * Math.max(1, Math.abs(wv.v))
      const ok = c.q ? qsign(qpEval(isolated.w, c.q)) * qsign(isolated.alpha) >= 0 : wv.v * qnum(isolated.alpha) >= -tol
      const wT = qpText(isolated.w, v)
      if (!ok) return { ...base, ok: false, reason: `${isolated.lhs.text} ${eqSign(rv.text)} but ${wT} ${eqSign(wv.text)}: squaring lost the sign` }
      return { ...base, ok: true, reason: `${isolated.lhs.text} ${eqSign(rv.text)} and ${wT} ${eqSign(wv.text)}` }
    }
    const lv = evalSide('L', c)
    const rv = evalSide('R', c)
    if (!lv || !rv) return { ...base, ok: false, reason: 'a square root is not defined there' }
    const tol = 1e-9 * Math.max(1, Math.abs(lv.v), Math.abs(rv.v))
    const ok = Math.abs(lv.v - rv.v) <= tol
    return {
      ...base,
      ok,
      reason: ok
        ? `left side ${eqSign(lv.text)} and right side ${eqSign(rv.text)}`
        : `left side ${eqSign(lv.text)} but right side ${eqSign(rv.text)}: squaring lost a sign`,
    }
  })
  return finish('radical', 'Square both sides', steps, P, cands, v)
}

function qpAdd2(a: QP, b: QP): QP {
  return qpSub(a, qpScale(b, qneg(Q1)))
}

// ---------------------------------------------------------------------------
// Rational: multiply by the LCD, check the denominators
// ---------------------------------------------------------------------------

/** Every denominator in x in the tree (as polynomials), or null when one is not a polynomial. */
function denominators(n: ExprNode, isVar: IsVar, out: QP[]): boolean {
  switch (n.t) {
    case 'bin':
      if (n.op === '/' && hasVarNode(n.b, isVar)) {
        const d = polyOf(n.b, isVar)
        if (!d) return false
        out.push(d)
      }
      if (n.op === '^' && hasVarNode(n.a, isVar) && constValue(n.b) < 0) return false
      return denominators(n.a, isVar, out) && denominators(n.b, isVar, out)
    case 'neg':
      return denominators(n.a, isVar, out)
    case 'call':
      return !hasVarNode(n, isVar)
    default:
      return true
  }
}

/** A polynomial as a product of its factors where they are rational: "x(x − 2)", "(x + 3)²". */
function factoredText(p: QP, v: string): { text: string; tex: string } {
  if (qpDeg(p) < 1) return { text: qpText(p, v), tex: qpTex(p, v) }
  const { roots, rest, content } = qRoots(p, v)
  const parts: { t: string; x: string }[] = []
  const sup = (n: number): string => String(n).split('').map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(c)]).join('')
  for (const r of roots) {
    if (!r.factorText) continue
    parts.push({ t: r.factorText + (r.mult > 1 ? sup(r.mult) : ''), x: r.factorTex + (r.mult > 1 ? `^{${r.mult}}` : '') })
  }
  for (const f of rest) parts.push({ t: f.text + (f.mult > 1 ? sup(f.mult) : ''), x: f.tex + (f.mult > 1 ? `^{${f.mult}}` : '') })
  if (parts.length === 0 || roots.some((r) => !r.factorText && r.exact === null)) return { text: qpText(p, v), tex: qpTex(p, v) }
  const c = qeq(content, Q1) ? '' : qeq(content, qneg(Q1)) ? MINUS : qText(content)
  const cx = qeq(content, Q1) ? '' : qeq(content, qneg(Q1)) ? '-' : qTex(content)
  const t = parts.map((p2) => p2.t).join('')
  // a single factor: no parentheses around "x − 2" once it stands alone
  const lone = parts.length === 1 && c === '' && /^\(.*\)$/.test(t) && !/\)\(/.test(t) ? t.slice(1, -1) : t
  return { text: `${c}${lone}`, tex: `${cx}${parts.map((p2) => p2.x).join('')}` }
}

function rationalRoute(L: ExprNode, R: ExprNode, isVar: IsVar, v: string): EquationRoute | null {
  if (hasTranscendental(L, isVar) || hasTranscendental(R, isVar)) return null
  const dens: QP[] = []
  if (!denominators(L, isVar, dens) || !denominators(R, isVar, dens)) return null
  const real = dens.filter((d) => qpDeg(d) >= 1)
  if (real.length === 0) return null
  let lcd: QP = [Q1]
  for (const d of real) {
    const g = qpGcd(lcd, d)
    lcd = qpMonic(qpDivmod(qpMul(lcd, d), g).q)
  }
  const h = toRQ({ t: 'bin', op: '-', a: L, b: R } as ExprNode, isVar)
  if (!h) return null
  const { q: Praw, r } = qpDivmod(qpMul(h.num, lcd), h.den)
  if (r.length !== 0) return null
  const P = primitive(qpTrim(Praw))
  const lcdF = factoredText(lcd, v)
  const steps: RouteStep[] = []
  // the excluded values: every denominator's real zeros
  const excluded: { x: number; text: string; q: Q | null }[] = []
  for (const d of real) {
    for (const c of candidatesOf(d, v)) {
      if (!excluded.some((e) => Math.abs(e.x - c.x) <= 1e-9 * Math.max(1, Math.abs(c.x)))) excluded.push({ x: c.x, text: c.text, q: c.q })
    }
  }
  excluded.sort((a, b) => a.x - b.x)
  if (excluded.length > 0) {
    steps.push({ text: `Excluded values (a denominator would be 0): ${excluded.map((e) => `${v} ≠ ${e.text}`).join(', ')}` })
  }
  steps.push({ text: `Multiply both sides by the LCD, ${lcdF.text}`, tex: `\\text{Multiply both sides by the LCD, } ${lcdF.tex}` })
  if (P.length === 0) {
    return {
      kind: 'rational', method: 'Multiply both sides by the LCD', steps: steps.concat([{ text: 'Every term cancels: 0 = 0.' }]),
      polynomial: null, candidates: [], identity: true,
      summary: excluded.length > 0 ? `The equation holds for every ${v} except the excluded values ${listText(excluded.map((e) => e.text))}.` : `The equation holds for every ${v}.`,
    }
  }
  steps.push({ text: `Expand and collect: ${qpText(P, v)} = 0`, tex: `${qpTex(P, v)} = 0` })
  const cands: RouteCandidate[] = candidatesOf(P, v).map((c) => {
    const bad = real.find((d) => (c.q ? qz(qpEval(d, c.q)) : Math.abs(qpEvalF(d, c.x)) <= 1e-9 * Math.max(1, Math.abs(c.x) ** qpDeg(d))))
    if (bad) {
      return { x: c.x, text: c.text, tex: c.tex, exact: c.exact, ok: false, reason: `${v} = ${c.text} makes a denominator 0 (${qpText(bad, v)} = 0)` }
    }
    return { x: c.x, text: c.text, tex: c.tex, exact: c.exact, ok: true, reason: 'every denominator is nonzero there' }
  })
  return finish('rational', 'Multiply both sides by the LCD', steps, P, cands, v)
}

// ---------------------------------------------------------------------------
// Logarithms: combine, exponentiate, check the arguments
// ---------------------------------------------------------------------------

interface LogTerm {
  k: bigint
  base: number
  baseQ: Q | null
  baseText: string
  u: QP
}

const LOG_BASES: Record<string, { base: number; text: string }> = {
  ln: { base: Math.E, text: 'ln' },
  log: { base: 10, text: 'log' },
  log10: { base: 10, text: 'log' },
  log2: { base: 2, text: 'log₂' },
}

/** Flatten L − R into Σ k·log(u) + K, or null. */
function logTerms(n: ExprNode, sign: Q, isVar: IsVar, terms: LogTerm[], konst: { K: Q }): boolean {
  switch (n.t) {
    case 'bin':
      if (n.op === '+' || n.op === '-') {
        return logTerms(n.a, sign, isVar, terms, konst) && logTerms(n.b, n.op === '-' ? qneg(sign) : sign, isVar, terms, konst)
      }
      if (n.op === '*') {
        const ka = constQ(n.a, isVar)
        if (ka && !hasVarNode(n.a, isVar) && isLogish(n.b)) return logTerms(n.b, qmul(sign, ka), isVar, terms, konst)
        const kb = constQ(n.b, isVar)
        if (kb && !hasVarNode(n.b, isVar) && isLogish(n.a)) return logTerms(n.a, qmul(sign, kb), isVar, terms, konst)
      }
      break
    case 'neg':
      return logTerms(n.a, qneg(sign), isVar, terms, konst)
    case 'call': {
      let base: number
      let baseQ: Q | null
      let baseText: string
      let arg: ExprNode
      if (n.fn === 'log_' && n.args.length === 2) {
        if (hasVarNode(n.args[0], isVar)) return false
        baseQ = constQ(n.args[0], isVar)
        if (!baseQ || qsign(baseQ) <= 0 || qeq(baseQ, Q1)) return false
        base = qnum(baseQ)
        baseText = `log_${qText(baseQ)}`
        arg = n.args[1]
      } else if (LOG_BASES[n.fn] && n.args.length === 1) {
        base = LOG_BASES[n.fn].base
        baseQ = n.fn === 'ln' ? null : mkQ(BigInt(base))
        baseText = LOG_BASES[n.fn].text
        arg = n.args[0]
      } else break
      if (!qint(sign)) return false
      const u = polyOf(arg, isVar)
      if (!u) return false
      terms.push({ k: sign.n, base, baseQ, baseText, u })
      return true
    }
    default:
      break
  }
  if (hasVarNode(n, isVar)) return false
  const c = constQ(n, isVar)
  if (!c) return false
  konst.K = qadd(konst.K, qmul(sign, c))
  return true
}

const isLogish = (n: ExprNode): boolean => n.t === 'call' && (n.fn === 'log_' || n.fn in LOG_BASES)

const SUPS = '⁰¹²³⁴⁵⁶⁷⁸⁹'
const supN = (n: bigint): string => String(n).split('').map((c) => SUPS[Number(c)]).join('')

/** A product of polynomial factors as a class writes it: "x(x − 3)", "(x + 1)²". */
function productText(fs: { u: QP; k: bigint }[], v: string, alone: boolean): { text: string; tex: string } {
  if (fs.length === 0) return { text: '1', tex: '1' }
  const one = fs.length === 1 && fs[0].k === 1n
  const text = fs.map((f) => {
    const t = one && alone ? qpText(f.u, v) : f.u.filter((c) => !qz(c)).length > 1 ? `(${qpText(f.u, v)})` : qpText(f.u, v)
    return `${t}${f.k > 1n ? supN(f.k) : ''}`
  }).join('')
  const tex = fs.map((f) => {
    const t = one && alone ? qpTex(f.u, v) : f.u.filter((c) => !qz(c)).length > 1 ? `\\left(${qpTex(f.u, v)}\\right)` : qpTex(f.u, v)
    return `${t}${f.k > 1n ? `^{${f.k}}` : ''}`
  }).join('')
  return { text, tex }
}

function logRoute(L: ExprNode, R: ExprNode, isVar: IsVar, v: string): EquationRoute | null {
  const terms: LogTerm[] = []
  const konst = { K: Q0 }
  if (!logTerms(L, Q1, isVar, terms, konst) || !logTerms(R, qneg(Q1), isVar, terms, konst)) return null
  const withVar = terms.filter((t) => qpDeg(t.u) >= 1)
  if (withVar.length === 0) return null
  const b0 = terms[0].base
  if (!terms.every((t) => t.base === b0)) return null
  const name = terms[0].baseText
  const baseQ = terms[0].baseQ
  // Σ kᵢ log uᵢ (x in uᵢ) = C + log c′, everything constant moved right
  const C = qneg(konst.K)
  let cPrime = Q1
  for (const t of terms) {
    if (qpDeg(t.u) >= 1) continue
    const c = t.u.length === 0 ? Q0 : t.u[0]
    if (qsign(c) <= 0) return null
    const k = t.k < 0n ? -t.k : t.k
    for (let i = 0n; i < k; i++) cPrime = t.k > 0n ? qdiv(cPrime, c) : qmul(cPrime, c)
  }
  // b^C must be rational: an integer C for a rational base, C = 0 for ln
  let bC: Q
  if (qz(C)) bC = Q1
  else if (baseQ && qint(C) && (C.n < 0n ? -C.n : C.n) <= 30n) {
    const e = Number(C.n)
    let acc = Q1
    for (let i = 0; i < Math.abs(e); i++) acc = qmul(acc, baseQ)
    bC = e < 0 ? qdiv(Q1, acc) : acc
  } else return null
  const power = qmul(bC, cPrime)
  let A: QP = [Q1]
  let B: QP = [Q1]
  const aF: { u: QP; k: bigint }[] = []
  const bF: { u: QP; k: bigint }[] = []
  for (const t of withVar) {
    const k = t.k < 0n ? -t.k : t.k
    for (let i = 0n; i < k; i++) {
      if (t.k > 0n) A = qpMul(A, t.u)
      else B = qpMul(B, t.u)
    }
    if (t.k > 0n) aF.push({ u: t.u, k })
    else if (t.k < 0n) bF.push({ u: t.u, k })
  }
  if (qpDeg(A) > 12 || qpDeg(B) > 12) return null
  const P = primitive(qpSub(A, qpScale(B, power)))
  const steps: RouteStep[] = []
  steps.push({ text: `Each logarithm needs a positive argument: ${withVar.map((t) => `${qpText(t.u, v)} > 0`).join(', ')}` })
  // log(ARG) = RHS
  const aT = productText(aF, v, bF.length === 0)
  const bT = productText(bF, v, false)
  const argT = bF.length === 0 ? aT.text : `${aF.length === 1 && aF[0].k === 1n && aF[0].u.filter((c) => !qz(c)).length > 1 ? `(${qpText(aF[0].u, v)})` : aT.text}/${bF.length > 1 || bF[0].k > 1n ? `(${bT.text})` : bT.text}`
  const argX = bF.length === 0 ? aT.tex : `\\frac{${productText(aF, v, true).tex}}{${productText(bF, v, true).tex}}`
  const logOf = (t: string): string => `${name}(${t})`
  const logTex = name === 'ln' ? '\\ln' : name === 'log' ? '\\log' : name === 'log₂' ? '\\log_{2}' : `\\log_{${baseQ ? qTex(baseQ) : ''}}`
  const constLog = !qeq(cPrime, Q1)
  const rhsParts: string[] = []
  const rhsTex: string[] = []
  if (!qz(C) || !constLog) { rhsParts.push(qText(C)); rhsTex.push(qTex(C)) }
  if (constLog) {
    const cp = qint(cPrime) ? ` ${qText(cPrime)}` : `(${qText(cPrime)})`
    rhsParts.push(`${name}${cp}`)
    rhsTex.push(`${logTex}${qint(cPrime) ? ` ${qTex(cPrime)}` : `\\left(${qTex(cPrime)}\\right)`}`)
  }
  steps.push({ text: `Combine the logs: ${logOf(argT)} = ${rhsParts.join(' + ')}`, tex: `${logTex}\\left(${argX}\\right) = ${rhsTex.join(' + ')}` })
  const bName = name === 'ln' ? 'e' : baseQ ? qText(baseQ) : '?'
  const powT = constLog || qz(C) || qeq(C, Q1) ? qText(power) : `${bName}${supN(C.n < 0n ? -C.n : C.n).replace(/^/, C.n < 0n ? '⁻' : '')} = ${qText(power)}`
  const left = productText(aF, v, true).text
  const right = bF.length === 0 ? powT : `${qeq(power, Q1) ? '' : `${qText(power)}`}${productText(bF, v, qeq(power, Q1)).text}`
  steps.push({ text: `Rewrite without logs: ${left} = ${right}` })
  if (P.length === 0) return null
  steps.push({ text: `Expand and collect: ${qpText(P, v)} = 0`, tex: `${qpTex(P, v)} = 0` })
  const cands: RouteCandidate[] = candidatesOf(P, v).map((c) => {
    for (const t of withVar) {
      const uc = c.q ? qpEval(t.u, c.q) : null
      const ucf = uc ? qnum(uc) : qpEvalF(t.u, c.x)
      const zero = uc ? qz(uc) : Math.abs(ucf) <= 1e-9 * Math.max(1, Math.abs(c.x))
      if (zero || ucf < 0) {
        const val = uc ? qText(uc) : decimal(ucf)
        const what = zero ? 'the log of 0, which is undefined' : `the log of ${val}, a negative number`
        return { x: c.x, text: c.text, tex: c.tex, exact: c.exact, ok: false, reason: `${name}(${qpText(t.u, v)}) would be ${what}` }
      }
    }
    return { x: c.x, text: c.text, tex: c.tex, exact: c.exact, ok: true, reason: 'every log argument is positive' }
  })
  return finish('log', 'Combine the logs', steps, P, cands, v)
}

// ---------------------------------------------------------------------------

function finish(kind: RouteKind, method: string, steps: RouteStep[], P: QP, cands: RouteCandidate[], v: string): EquationRoute {
  if (cands.length > 0) {
    steps.push({ text: `Candidates: ${cands.map((c) => `${v} = ${c.text}`).join(', ')}` })
  } else if (qpDeg(P) >= 1) {
    steps.push({ text: `${qpText(P, v)} = 0 has no real solutions.` })
  } else {
    steps.push({ text: `${qpText(P, v)} = 0 is false: there are no candidates.` })
  }
  return { kind, method, steps, polynomial: { text: `${qpText(P, v)} = 0`, tex: `${qpTex(P, v)} = 0` }, candidates: cands, identity: false, summary: summaryOf(cands, v, false) }
}

/**
 * The algebraic route for L = R in the variable named `name` (`v` is how it
 * is printed: "x", "θ"). Null when the equation is none of the shapes above —
 * a plain polynomial equation has no step that adds roots, and gets none.
 */
export function equationRoute(L: ExprNode, R: ExprNode, name = 'x', v = name): EquationRoute | null {
  const isVar: IsVar = (n) => (n.t === 'var' || n.t === 'param') && n.name === name
  try {
    if (!hasVarNode(L, isVar) && !hasVarNode(R, isVar)) return null
    if (sqrtNodes(L, isVar).length + sqrtNodes(R, isVar).length > 0) return radicalRoute(L, R, isVar, v)
    const logs = (n: ExprNode): boolean =>
      n.t === 'call' ? isLogish(n) && hasVarNode(n, isVar) : n.t === 'bin' ? logs(n.a) || logs(n.b) : n.t === 'neg' ? logs(n.a) : false
    if (logs(L) || logs(R)) return logRoute(L, R, isVar, v)
    return rationalRoute(L, R, isVar, v)
  } catch {
    return null
  }
}

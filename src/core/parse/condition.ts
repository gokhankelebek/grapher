// ============================================================================
// Conditions on one variable — the shared engine behind number-line solution
// sets (./inequality.ts) and restricted domains / piecewise branches
// (./index.ts).
//
//   export function parseCondition(src, ctx): Piece[]
//
// A condition is a set of disjoint pieces of the real line, left to right.
// That is all a solution set is, and all a restricted domain is, so both
// callers share one comparison parser rather than growing a second one.
//
// Grammar (informal):
//   input      := disjunction
//   disjunction:= conjunction ( ('or' | '∪') conjunction )*
//   conjunction:= clause ( ('and' | '∩') clause )*
//   clause     := interval | set | chain | '(' disjunction ')'
//   interval   := ('[' | '(') bound ',' bound (']' | ')')
//   set        := '{' ( bound (',' bound)* )? '}'
//   chain      := operand rel operand ( rel operand )?
//   rel        := '<' | '<=' | '>' | '>=' | '=' | '!='        (≤ ≥ ≠ == also)
//   operand    := VARIABLE | constant-expression | infinity
//   infinity   := ('+'|'-')? ('inf' | 'infty' | 'infinity' | 'oo' | '∞')
//
// 'and' binds tighter than 'or', as usual. In a three-operand chain the
// variable must sit in the middle and both comparisons must point the same
// way: -2 <= x < 5, or 7 >= x > 2.
//
// Everything is normalised before it is returned (see `union` / `intersect`
// below), because the picture has to be honest: overlapping or touching
// pieces are merged, a closed point inside a covering interval is absorbed,
// and two pieces that meet at an endpoint neither of them contains stay
// apart so the hole is drawn.
//
// Bounds are parsed by the expression engine in ./index.ts, which is INJECTED
// as `ctx.an` rather than imported: ./index.ts calls into this module for
// piecewise conditions, and a module cycle between the two would be a
// load-order trap waiting for whichever entry point happened to run first.
// ============================================================================

import type { NLItem } from '../types'
import type { ExprAnalysis } from './index'

/** The expression engine's constant-folder — `analyzeExpr` from ./index.ts. */
export type Analyzer = (src: string) => ExprAnalysis

/**
 * One drawable item, minus the id/colour the board assigns.
 *
 * `Omit` does not distribute over a union, so `Omit<NLItem, 'id' | 'color'>`
 * collapses to the members' common keys. This spells the intended thing out.
 */
export type NLItemDraft =
  | Omit<Extract<NLItem, { kind: 'point' }>, 'id' | 'color'>
  | Omit<Extract<NLItem, { kind: 'interval' }>, 'id' | 'color'>

// ----------------------------------------------------------------------------
// Errors
// ----------------------------------------------------------------------------

export class CondError extends Error {
  pos: number | undefined
  constructor(message: string, pos?: number) {
    super(message)
    this.pos = pos
  }
}

function fail(message: string, pos?: number): never {
  throw new CondError(message, pos)
}

// ----------------------------------------------------------------------------
// Numeric helpers. Bounds come out of a floating-point evaluator, so "touching"
// has to tolerate the last ulp or two — 2*pi and tau must land on each other.
// ----------------------------------------------------------------------------

export function eq(a: number, b: number): boolean {
  if (a === b) return true
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  return Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b))
}

/** Strictly less, with the same tolerance `eq` uses. */
function lt(a: number, b: number): boolean {
  return a < b && !eq(a, b)
}

/** Same rendering as `intervalNotation` in types.ts, so the two agree. */
function numTex(v: number): string {
  const s = v.toPrecision(6)
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

// ----------------------------------------------------------------------------
// Internal representation: a set of disjoint pieces, left to right.
// A point is the degenerate closed piece [c, c]. `loTex` / `hiTex` keep the
// bound as it was written (2\pi rather than 6.28319) for the card.
// ----------------------------------------------------------------------------

export interface Piece {
  lo: number
  hi: number
  loC: boolean
  hiC: boolean
  loTex: string | null
  hiTex: string | null
}

const NEG_INF = Number.NEGATIVE_INFINITY
const POS_INF = Number.POSITIVE_INFINITY

export const WHOLE_LINE = (): Piece[] => [
  { lo: NEG_INF, hi: POS_INF, loC: false, hiC: false, loTex: null, hiTex: null },
]

function nonEmpty(p: Piece): boolean {
  if (lt(p.lo, p.hi)) return true
  return eq(p.lo, p.hi) && p.loC && p.hiC && Number.isFinite(p.lo)
}

/** Sort left to right; at equal left ends the closed one comes first. */
function cmp(a: Piece, b: Piece): number {
  if (!eq(a.lo, b.lo)) return a.lo < b.lo ? -1 : 1
  if (a.loC !== b.loC) return a.loC ? -1 : 1
  if (!eq(a.hi, b.hi)) return a.hi < b.hi ? -1 : 1
  return 0
}

/**
 * Merge overlapping and touching pieces.
 *
 * Two pieces that meet at a shared endpoint merge only when at least one of
 * them contains it: [1,3] ∪ [3,5] = [1,5], but [1,3) ∪ (3,5] keeps the hole.
 */
function union(pieces: Piece[]): Piece[] {
  const list = pieces.filter(nonEmpty).map((p) => ({ ...p })).sort(cmp)
  const out: Piece[] = []
  for (const p of list) {
    const last = out[out.length - 1]
    const touches =
      last !== undefined &&
      (lt(p.lo, last.hi) || (eq(p.lo, last.hi) && (last.hiC || p.loC)))
    if (!touches) {
      out.push(p)
      continue
    }
    if (lt(last.hi, p.hi) || (eq(last.hi, p.hi) && p.hiC && !last.hiC)) {
      last.hi = p.hi
      last.hiC = p.hiC
      last.hiTex = p.hiTex
    }
  }
  return out
}

/** Pairwise intersection. An empty result is a perfectly good answer. */
function intersect(as: Piece[], bs: Piece[]): Piece[] {
  const out: Piece[] = []
  for (const a of as) {
    for (const b of bs) {
      let lo: number, loC: boolean, loTex: string | null
      if (lt(a.lo, b.lo)) ({ lo, loC, loTex } = { lo: b.lo, loC: b.loC, loTex: b.loTex })
      else if (lt(b.lo, a.lo)) ({ lo, loC, loTex } = { lo: a.lo, loC: a.loC, loTex: a.loTex })
      else ({ lo, loC, loTex } = { lo: a.lo, loC: a.loC && b.loC, loTex: a.loTex ?? b.loTex })

      let hi: number, hiC: boolean, hiTex: string | null
      if (lt(b.hi, a.hi)) ({ hi, hiC, hiTex } = { hi: b.hi, hiC: b.hiC, hiTex: b.hiTex })
      else if (lt(a.hi, b.hi)) ({ hi, hiC, hiTex } = { hi: a.hi, hiC: a.hiC, hiTex: a.hiTex })
      else ({ hi, hiC, hiTex } = { hi: a.hi, hiC: a.hiC && b.hiC, hiTex: a.hiTex ?? b.hiTex })

      const p: Piece = { lo, hi, loC, hiC, loTex, hiTex }
      if (nonEmpty(p)) out.push(p)
    }
  }
  return union(out)
}

// ----------------------------------------------------------------------------
// Source scanning helpers. Everything works on offsets into the original
// string so error positions point at what the teacher actually typed.
// ----------------------------------------------------------------------------

const OPENERS = '([{'
const CLOSERS = ')]}'

interface Span {
  text: string
  start: number
}

/** Trim whitespace, keeping the offset of the first surviving character. */
function trimSpan(s: Span): Span {
  let a = 0
  let b = s.text.length
  while (a < b && /\s/.test(s.text[a])) a++
  while (b > a && /\s/.test(s.text[b - 1])) b--
  return { text: s.text.slice(a, b), start: s.start + a }
}

/** Index of the closer matching the bracket at `i`, or -1. Types may differ:
 *  a half-open interval like [1, 3) is legal notation. */
function matchBracket(s: string, i: number): number {
  let depth = 0
  for (let k = i; k < s.length; k++) {
    const c = s[k]
    if (OPENERS.includes(c)) depth++
    else if (CLOSERS.includes(c)) {
      depth--
      if (depth === 0) return k
    }
  }
  return -1
}

/** Bracket balance, reported at the offending character. `at` shifts offsets. */
export function checkBalanced(src: string, at = 0): void {
  const stack: { c: string; at: number }[] = []
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (OPENERS.includes(c)) stack.push({ c, at: i + at })
    else if (CLOSERS.includes(c)) {
      if (stack.length === 0) fail(`Unmatched '${c}' at position ${i + at}`, i + at)
      stack.pop()
    }
  }
  if (stack.length > 0) {
    const top = stack[stack.length - 1]
    const want = CLOSERS[OPENERS.indexOf(top.c)]
    fail(`Missing closing '${want}' for the '${top.c}' at position ${top.at}`, top.at)
  }
}

/** Offsets of commas at bracket depth 0 within `s`. */
function topLevelCommas(s: string): number[] {
  const out: number[] = []
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (OPENERS.includes(c)) depth++
    else if (CLOSERS.includes(c)) depth--
    else if (c === ',' && depth === 0) out.push(i)
  }
  return out
}

// ----------------------------------------------------------------------------
// Connectives
// ----------------------------------------------------------------------------

type Conn = 'or' | 'and'

/** Split on top-level `or` / `and` / `∪` / `∩`, keeping source offsets. */
function splitConnectives(src: string): { parts: Span[]; ops: Conn[] } {
  const parts: Span[] = []
  const ops: Conn[] = []
  let depth = 0
  let segStart = 0
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (OPENERS.includes(c)) { depth++; continue }
    if (CLOSERS.includes(c)) { depth--; continue }
    if (depth !== 0) continue

    let op: Conn | null = null
    let len = 0
    if (c === '∪') { op = 'or'; len = 1 }
    else if (c === '∩') { op = 'and'; len = 1 }
    else if (/[A-Za-z]/.test(c) && (i === 0 || !/[A-Za-z0-9]/.test(src[i - 1]))) {
      let j = i
      while (j < src.length && /[A-Za-z0-9]/.test(src[j])) j++
      const word = src.slice(i, j).toLowerCase()
      if (word === 'or' || word === 'and') { op = word; len = j - i }
      else { i = j - 1; continue } // skip the whole word: 'sqrt' hides no 'or'
    }
    if (op === null) continue

    parts.push({ text: src.slice(segStart, i), start: segStart })
    ops.push(op)
    segStart = i + len
    i += len - 1
  }
  parts.push({ text: src.slice(segStart), start: segStart })
  return { parts, ops }
}

// ----------------------------------------------------------------------------
// Operands
// ----------------------------------------------------------------------------

/** A finite bound keeps the LaTeX it was written with; ±∞ has none. */
interface Bound {
  v: number
  tex: string | null
}

const INFINITY_RE = /^([+\-−]?)\s*(?:inf|infty|infinity|oo|∞|\\infty)$/i
const HAS_INFINITY_RE = /(^|[^A-Za-z])(inf|infty|infinity|oo)([^A-Za-z]|$)|∞/i
/** Single letter, ASCII or Greek — the variable may be x, t, n, θ, … */
const SINGLE_LETTER_RE = /^[A-Za-zͰ-Ͽ]$/

/**
 * Shared state for one condition: which variable it is about, and the
 * expression engine that folds its bounds.
 */
export interface CondCtx {
  /** identity used for comparison, e.g. 'x' or 'theta' */
  name: string | null
  /** how to print it, e.g. 'x' or '\theta' */
  tex: string | null
  /** where the variable was first seen, for the caller's error messages */
  pos: number
  /** the expression engine (injected — see the header) */
  an: Analyzer
}

export function newCtx(an: Analyzer): CondCtx {
  return { name: null, tex: null, pos: 0, an }
}

function noteVariable(ctx: CondCtx, name: string, tex: string, pos: number): void {
  if (ctx.name !== null && ctx.name !== name) {
    fail(
      `Two different variables ('${ctx.name}' and '${name}') — a number line shows one variable at a time`,
      pos,
    )
  }
  if (ctx.name === null) ctx.pos = pos
  ctx.name = name
  ctx.tex = tex
}

type Operand =
  | { kind: 'var'; name: string; tex: string; pos: number }
  | { kind: 'bound'; b: Bound; pos: number }

/**
 * Classify one operand. Anything constant is a bound; a bare single letter is
 * the variable; anything else (2x, x+1) is an inequality that has not been
 * solved yet, which this parser deliberately does not do.
 */
function classifyOperand(raw: Span, ctx: CondCtx, missing: string): Operand {
  const s = trimSpan(raw)
  if (s.text === '') fail(missing, s.start)

  const inf = INFINITY_RE.exec(s.text)
  if (inf) {
    const neg = inf[1] === '-' || inf[1] === '−'
    return { kind: 'bound', b: { v: neg ? NEG_INF : POS_INF, tex: null }, pos: s.start }
  }
  if (HAS_INFINITY_RE.test(s.text)) {
    fail(`'${s.text}' — infinity can only be used on its own as a bound`, s.start)
  }

  const a = ctx.an(s.text)
  if (!a.ok) fail(a.error, s.start + (a.pos ?? 0))
  if (a.free.length === 0) {
    if (!Number.isFinite(a.value)) {
      fail(`'${s.text}' is not a finite number, so it cannot be a bound`, s.start)
    }
    return { kind: 'bound', b: { v: a.value, tex: a.latex }, pos: s.start }
  }
  // A bare variable: a single letter (x, n, θ), or a reserved name spelled out
  // — "theta" is how a polar domain gets typed on a keyboard.
  if (SINGLE_LETTER_RE.test(s.text) || (a.free.length === 1 && a.free[0] === s.text)) {
    return { kind: 'var', name: a.free[0], tex: a.latex, pos: s.start }
  }
  fail(
    `'${s.text}' is more than just the variable — solve for ${a.free[0]} first, ` +
      `then draw the answer (something like ${a.free[0]} < 3)`,
    s.start,
  )
}

/** Classify, and require a constant (or infinite) bound. */
function boundOperand(raw: Span, ctx: CondCtx, missing: string): Bound {
  const op = classifyOperand(raw, ctx, missing)
  if (op.kind === 'var') {
    noteVariable(ctx, op.name, op.tex, op.pos)
    fail(`'${op.name}' is a variable, but a bound has to be a number`, op.pos)
  }
  return op.b
}

// ----------------------------------------------------------------------------
// Relational operators
// ----------------------------------------------------------------------------

type Rel = '<' | '<=' | '>' | '>=' | '=' | '!='

interface RelTok {
  op: Rel
  at: number
  len: number
}

/** Relational operators at bracket depth 0, left to right. */
function scanRels(s: string, at: number): RelTok[] {
  const out: RelTok[] = []
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (OPENERS.includes(c)) { depth++; continue }
    if (CLOSERS.includes(c)) { depth--; continue }
    if (depth !== 0) continue
    if (c === '≤') { out.push({ op: '<=', at: i, len: 1 }); continue }
    if (c === '≥') { out.push({ op: '>=', at: i, len: 1 }); continue }
    if (c === '≠') { out.push({ op: '!=', at: i, len: 1 }); continue }
    if (c === '!') {
      if (s[i + 1] === '=') { out.push({ op: '!=', at: i, len: 2 }); i++; continue }
      fail(`Unexpected '!' at position ${i + at} — did you mean '!=' ?`, i + at)
    }
    if (c === '<') {
      if (s[i + 1] === '=') { out.push({ op: '<=', at: i, len: 2 }); i++; continue }
      if (s[i + 1] === '>') { out.push({ op: '!=', at: i, len: 2 }); i++; continue }
      out.push({ op: '<', at: i, len: 1 }); continue
    }
    if (c === '>') {
      if (s[i + 1] === '=') { out.push({ op: '>=', at: i, len: 2 }); i++; continue }
      out.push({ op: '>', at: i, len: 1 }); continue
    }
    if (c === '=') {
      if (s[i + 1] === '=') { out.push({ op: '=', at: i, len: 2 }); i++; continue }
      if (s[i + 1] === '<') { out.push({ op: '<=', at: i, len: 2 }); i++; continue }
      out.push({ op: '=', at: i, len: 1 }); continue
    }
  }
  return out
}

const REL_TEXT: Record<Rel, string> = {
  '<': '<', '<=': '<=', '>': '>', '>=': '>=', '=': '=', '!=': '!=',
}

const isLess = (r: Rel): boolean => r === '<' || r === '<='
const isGreater = (r: Rel): boolean => r === '>' || r === '>='
/** Flip a comparison when the variable turns out to be on the right. */
const flip = (r: Rel): Rel =>
  r === '<' ? '>' : r === '<=' ? '>=' : r === '>' ? '<' : r === '>=' ? '<=' : r

// ----------------------------------------------------------------------------
// Piece constructors
// ----------------------------------------------------------------------------

/** x < b, x <= b, x > b, x >= b — with ±∞ folded to the whole line / nothing. */
function ray(rel: Rel, b: Bound): Piece[] {
  if (isLess(rel)) {
    if (b.v === POS_INF) return WHOLE_LINE()
    if (b.v === NEG_INF) return []
    return [{ lo: NEG_INF, hi: b.v, loC: false, hiC: rel === '<=', loTex: null, hiTex: b.tex }]
  }
  if (b.v === NEG_INF) return WHOLE_LINE()
  if (b.v === POS_INF) return []
  return [{ lo: b.v, hi: POS_INF, loC: rel === '>=', hiC: false, loTex: b.tex, hiTex: null }]
}

function pointPiece(b: Bound): Piece {
  return { lo: b.v, hi: b.v, loC: true, hiC: true, loTex: b.tex, hiTex: b.tex }
}

/** x != b: everything the point does not cover, i.e. two open rays. */
function excludePoint(b: Bound): Piece[] {
  if (!Number.isFinite(b.v)) return WHOLE_LINE()
  return [
    { lo: NEG_INF, hi: b.v, loC: false, hiC: false, loTex: null, hiTex: b.tex },
    { lo: b.v, hi: POS_INF, loC: false, hiC: false, loTex: b.tex, hiTex: null },
  ]
}

// ----------------------------------------------------------------------------
// Clause parsing
// ----------------------------------------------------------------------------

function parseClause(raw: Span, ctx: CondCtx): Piece[] {
  const s = trimSpan(raw)
  if (s.text === '') fail('Expected an inequality, an interval or a set of points', s.start)

  const head = s.text[0]
  if (head === '{' || head === '[' || head === '(') {
    const close = matchBracket(s.text, 0)
    if (close === s.text.length - 1) {
      const inner: Span = { text: s.text.slice(1, close), start: s.start + 1 }
      const closer = s.text[close]
      if (head === '{') return parseSet(inner, closer, s, ctx)
      const commas = topLevelCommas(inner.text)
      if (commas.length === 1) return parseInterval(inner, head, closer, commas[0], s, ctx)
      if (commas.length > 1) {
        fail(`An interval has exactly two bounds, e.g. [1, 3]`, s.start)
      }
      if (head === '[') {
        fail(`An interval needs two bounds separated by a comma, e.g. [1, 3]`, s.start)
      }
      // '( ... )' with no comma: a parenthesised clause, e.g. (x < 3)
      return parseClause(inner, ctx)
    }
  }
  if (head === '}' || head === ']') fail(`Unmatched '${head}' at position ${s.start}`, s.start)

  const stray = topLevelCommas(s.text)
  if (stray.length > 0) {
    fail(
      `Unexpected ',' at position ${s.start + stray[0]} — an interval needs brackets, e.g. [1, 3]`,
      s.start + stray[0],
    )
  }
  return parseChain(s, ctx)
}

function parseSet(inner: Span, closer: string, whole: Span, ctx: CondCtx): Piece[] {
  if (closer !== '}') fail(`A set of points must close with '}', e.g. {1, 2, 5}`, whole.start)
  if (inner.text.trim() === '') return []
  const cuts = topLevelCommas(inner.text)
  const pieces: Piece[] = []
  let from = 0
  for (const cut of [...cuts, inner.text.length]) {
    const el: Span = { text: inner.text.slice(from, cut), start: inner.start + from }
    const b = boundOperand(el, ctx, 'Expected a number in the set')
    if (!Number.isFinite(b.v)) fail('A set of points cannot contain ∞', el.start)
    pieces.push(pointPiece(b))
    from = cut + 1
  }
  return union(pieces)
}

function parseInterval(
  inner: Span,
  opener: string,
  closer: string,
  commaAt: number,
  whole: Span,
  ctx: CondCtx,
): Piece[] {
  if (closer !== ']' && closer !== ')') {
    fail(`An interval must close with ']' or ')', e.g. [1, 3)`, whole.start)
  }
  const loSpan: Span = { text: inner.text.slice(0, commaAt), start: inner.start }
  const hiSpan: Span = { text: inner.text.slice(commaAt + 1), start: inner.start + commaAt + 1 }
  const lo = boundOperand(loSpan, ctx, `Expected a number after '${opener}'`)
  const hi = boundOperand(hiSpan, ctx, "Expected a number after ','")

  if (lo.v === POS_INF) fail('An interval cannot start at +∞', loSpan.start)
  if (hi.v === NEG_INF) fail('An interval cannot end at -∞', hiSpan.start)

  // An unbounded end is always drawn as an arrow, so '[' on -∞ is a slip we
  // quietly straighten rather than an error worth stopping for.
  const loC = Number.isFinite(lo.v) && opener === '['
  const hiC = Number.isFinite(hi.v) && closer === ']'

  if (lt(hi.v, lo.v)) {
    const a = lo.tex ?? numTex(lo.v)
    const b = hi.tex ?? numTex(hi.v)
    fail(
      `The interval ${opener}${a}, ${b}${closer} is empty because ${a} > ${b} — ` +
        `did you mean ${opener}${b}, ${a}${closer}?`,
      whole.start,
    )
  }
  const p: Piece = {
    lo: lo.v, hi: hi.v, loC, hiC,
    loTex: Number.isFinite(lo.v) ? lo.tex : null,
    hiTex: Number.isFinite(hi.v) ? hi.tex : null,
  }
  return nonEmpty(p) ? [p] : []
}

function parseChain(s: Span, ctx: CondCtx): Piece[] {
  const rels = scanRels(s.text, s.start)
  if (rels.length === 0) {
    fail(
      `Expected a comparison in '${s.text}' — something like x < 3, or an interval like [1, 3]`,
      s.start,
    )
  }
  if (rels.length > 2) {
    fail(
      `Too many comparisons in one chain at position ${s.start + rels[2].at} — ` +
        `use 'and' / 'or' to join separate inequalities`,
      s.start + rels[2].at,
    )
  }

  // operand spans, split by the relational operators
  const spans: Span[] = []
  let from = 0
  for (const r of rels) {
    spans.push({ text: s.text.slice(from, r.at), start: s.start + from })
    from = r.at + r.len
  }
  spans.push({ text: s.text.slice(from), start: s.start + from })

  const ops = spans.map((sp, i) => {
    const before = i === 0 ? null : rels[i - 1]
    const after = i < rels.length ? rels[i] : null
    const missing =
      before !== null
        ? `Expected a number after '${REL_TEXT[before.op]}'`
        : `Expected a number before '${REL_TEXT[after!.op]}'`
    return classifyOperand(sp, ctx, missing)
  })

  // A disagreement between two variables is the most useful thing to report,
  // so register every one of them before looking at the shape of the chain.
  for (const o of ops) if (o.kind === 'var') noteVariable(ctx, o.name, o.tex, o.pos)

  const varAt = ops.map((o, i) => (o.kind === 'var' ? i : -1)).filter((i) => i >= 0)
  if (varAt.length === 0) {
    fail(
      `There is no variable in '${s.text}', so there is nothing to solve for — ` +
        `write something like x ${REL_TEXT[rels[0].op]} ${trimSpan(spans[spans.length - 1]).text || '3'}`,
      s.start,
    )
  }
  if (varAt.length > 1) {
    fail(
      `'${ctx.name}' appears on both sides at position ${ops[varAt[1]].pos} — ` +
        `a number line needs the variable alone on one side`,
      ops[varAt[1]].pos,
    )
  }

  if (rels.length === 1) {
    const i = varAt[0]
    const other = (ops[1 - i] as Extract<Operand, { kind: 'bound' }>).b
    const rel = i === 0 ? rels[0].op : flip(rels[0].op)
    if (rel === '=') {
      if (!Number.isFinite(other.v)) fail('∞ is not a point on the line', ops[1 - i].pos)
      return [pointPiece(other)]
    }
    if (rel === '!=') return excludePoint(other)
    return ray(rel, other)
  }

  // three operands: a < x < b
  if (varAt[0] !== 1) {
    fail(
      `In a chain the variable goes in the middle, like -2 <= ${ctx.tex ?? 'x'} < 5`,
      ops[varAt[0]].pos,
    )
  }
  const [r1, r2] = rels
  for (const r of rels) {
    if (r.op === '=' || r.op === '!=') {
      fail(
        `'${REL_TEXT[r.op]}' cannot be part of a chain at position ${s.start + r.at} — ` +
          `use 'and' / 'or' instead`,
        s.start + r.at,
      )
    }
  }
  const left = (ops[0] as Extract<Operand, { kind: 'bound' }>).b
  const right = (ops[2] as Extract<Operand, { kind: 'bound' }>).b
  if (isLess(r1.op) !== isLess(r2.op) || isGreater(r1.op) !== isGreater(r2.op)) {
    fail(
      `The chain changes direction at position ${s.start + r2.at} — ` +
        `write it as a < ${ctx.tex ?? 'x'} < b (or all the other way round)`,
      s.start + r2.at,
    )
  }

  // A chain is a conjunction, so a reversed one ("5 <= x < 2") is an empty
  // solution set rather than an error — see intersect().
  const lower = isLess(r1.op) ? { b: left, closed: r1.op === '<=' } : { b: right, closed: r2.op === '>=' }
  const upper = isLess(r1.op) ? { b: right, closed: r2.op === '<=' } : { b: left, closed: r1.op === '>=' }
  return intersect(
    ray(lower.closed ? '>=' : '>', lower.b),
    ray(upper.closed ? '<=' : '<', upper.b),
  )
}

// ----------------------------------------------------------------------------
// Entry point
// ----------------------------------------------------------------------------

/**
 * Parse one condition into normalised pieces. Throws `CondError` with a
 * position into `src` (shifted by `at`, so a caller can pass the offset of
 * the condition inside a longer equation).
 */
export function parseCondition(src: string, ctx: CondCtx, at = 0): Piece[] {
  checkBalanced(src, at)
  const { parts, ops } = splitConnectives(src)

  // 'and' binds tighter than 'or': fold conjunctions first, union the rest.
  const clauses = parts.map((p) => parseClause({ text: p.text, start: p.start + at }, ctx))
  let acc = clauses[0]
  const groups: Piece[][] = []
  for (let i = 0; i < ops.length; i++) {
    if (ops[i] === 'and') acc = intersect(acc, clauses[i + 1])
    else { groups.push(acc); acc = clauses[i + 1] }
  }
  groups.push(acc)

  return union(groups.flat())
}

// ----------------------------------------------------------------------------
// Membership + extent — what a restricted domain and a piecewise branch need.
// ----------------------------------------------------------------------------

/** Does `u` lie in any piece? NaN is in nothing, which is the honest answer. */
export function inPieces(pieces: readonly Piece[], u: number): boolean {
  for (const p of pieces) {
    if ((u > p.lo || (u === p.lo && p.loC)) && (u < p.hi || (u === p.hi && p.hiC))) {
      return true
    }
  }
  return false
}

/** Overall [leftmost, rightmost] extent, ±∞ included. Empty sets give null. */
export function extentOf(pieces: readonly Piece[]): [number, number] | null {
  if (pieces.length === 0) return null
  let lo = POS_INF
  let hi = NEG_INF
  for (const p of pieces) {
    if (p.lo < lo) lo = p.lo
    if (p.hi > hi) hi = p.hi
  }
  return [lo, hi]
}

/** True when the pieces are the whole line minus finitely many points. */
export function excludedPoints(pieces: readonly Piece[]): Piece[] | null {
  if (pieces.length === 0) return null
  if (pieces[0].lo !== NEG_INF || pieces[pieces.length - 1].hi !== POS_INF) return null
  const holes: Piece[] = []
  for (let i = 0; i + 1 < pieces.length; i++) {
    const a = pieces[i]
    const b = pieces[i + 1]
    if (!eq(a.hi, b.lo) || a.hiC || b.loC) return null // a real gap, not a hole
    holes.push(a)
  }
  return holes
}

// ----------------------------------------------------------------------------
// Output
// ----------------------------------------------------------------------------

export function toItems(pieces: readonly Piece[]): NLItemDraft[] {
  return pieces.map((p): NLItemDraft => {
    if (eq(p.lo, p.hi) && Number.isFinite(p.lo)) {
      return { kind: 'point', x: p.lo, closed: true }
    }
    return {
      kind: 'interval',
      lo: Number.isFinite(p.lo) ? p.lo : null,
      hi: Number.isFinite(p.hi) ? p.hi : null,
      loClosed: Number.isFinite(p.lo) ? p.loC : false,
      hiClosed: Number.isFinite(p.hi) ? p.hiC : false,
    }
  })
}

/**
 * The bound as it was written, falling back to its value. A negative fraction
 * comes back from the expression engine as \frac{-3}{4}; on a number line the
 * sign belongs out front where a reader can see it.
 */
function bt(v: number, tex: string | null): string {
  if (tex === null) return numTex(v)
  const frac = /^\\frac\{-(.+)\}\{(.+)\}$/.exec(tex)
  return frac ? `-\\frac{${frac[1]}}{${frac[2]}}` : tex
}

/** Interval / set notation, with the bounds as they were typed. */
export function setLatex(pieces: readonly Piece[], varTex: string | null): string {
  if (pieces.length === 0) return '\\varnothing'
  const parts: string[] = []
  let run: string[] = []
  const flush = () => {
    if (run.length > 0) {
      parts.push(`\\{${run.join(',\\, ')}\\}`)
      run = []
    }
  }
  for (const p of pieces) {
    if (eq(p.lo, p.hi) && Number.isFinite(p.lo)) {
      run.push(bt(p.lo, p.loTex))
      continue
    }
    flush()
    // Same shape as intervalNotation() in types.ts, so the card and the
    // board's own read-out agree.
    const l = Number.isFinite(p.lo) && p.loC ? '[' : '('
    const r = Number.isFinite(p.hi) && p.hiC ? ']' : ')'
    const lo = Number.isFinite(p.lo) ? bt(p.lo, p.loTex) : '-\\infty'
    const hi = Number.isFinite(p.hi) ? bt(p.hi, p.hiTex) : '\\infty'
    parts.push(`${l}${lo}, ${hi}${r}`)
  }
  flush()
  const body = parts.join(' \\cup ')
  return varTex ? `${varTex} \\in ${body}` : body
}

/**
 * The short form a cases table wants: `x < 0`, `0 \leq x < 3`, `x = 2`.
 * A union has no short form, so it falls back to interval notation — which is
 * the tidy thing to read there anyway.
 */
export function compactLatex(pieces: readonly Piece[], varTex: string | null): string {
  const v = varTex ?? 'x'
  if (pieces.length !== 1) return setLatex(pieces, varTex)
  const p = pieces[0]
  const loInf = !Number.isFinite(p.lo)
  const hiInf = !Number.isFinite(p.hi)
  if (loInf && hiInf) return '\\text{otherwise}'
  if (loInf) return `${v} ${p.hiC ? '\\leq' : '<'} ${bt(p.hi, p.hiTex)}`
  if (hiInf) return `${v} ${p.loC ? '\\geq' : '>'} ${bt(p.lo, p.loTex)}`
  if (eq(p.lo, p.hi)) return `${v} = ${bt(p.lo, p.loTex)}`
  return (
    `${bt(p.lo, p.loTex)} ${p.loC ? '\\leq' : '<'} ${v} ` +
    `${p.hiC ? '\\leq' : '<'} ${bt(p.hi, p.hiTex)}`
  )
}

/** `x \neq 0` — a restriction that only removes points. */
export function exclusionLatex(holes: readonly Piece[], varTex: string | null): string {
  const v = varTex ?? 'x'
  return holes.map((h) => `${v} \\neq ${bt(h.hi, h.hiTex)}`).join(',\\; ')
}

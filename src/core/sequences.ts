// ============================================================================
// Sequences and series, AP Precalculus 2.1–2.2 and AP Calculus BC
// (src/core/sequences.ts)
//
// A sequence is DISCRETE: the points (n, aₙ) for n = n₀, n₀ + 1, …, drawn as
// dots (BoardScene.scatter), with an optional continuous partner — the
// linear function behind an arithmetic sequence, the exponential behind a
// geometric one — dashed, so the class sees the sequence as the function
// sampled at the integers. Series are the partial sums Sₙ as their own
// sequence.
//
// Sequences are NOT curves and do not go through parseExpression as a
// curve: the App routes lines that look like a sequence here first.
//
//   export function parseSequence(src): SequenceParse
//     explicit      a_n = 3 + 2(n - 1)      a(n) = 5(0.8)^(n-1)     b_n = n^2
//     recursive     a_1 = 3, a_(n+1) = a_n + 4        (also a_n = a_(n-1) + 4,
//                   a_0 = 1, a_(n+1) = 2a_n + 1, Fibonacci a_1 = a_2 = 1,
//                   a_(n+2) = a_(n+1) + a_n — up to two previous terms)
//     a list        3, 7, 11, 15, …        (terms; "…" optional)
//     with an optional index range {1 <= n <= 20} / for n = 1 to 20;
//     free single letters other than n become sliders (a_n = a + d(n-1)).
//   export function terms(seq, params, n0, count): number[]
//   export function classify(values: number[]): SeqClass
//     from the terms: arithmetic (common difference d), geometric (common
//     ratio r), quadratic (constant second differences), or none — each
//     with exact text and the explicit AND recursive formulas
//     ("aₙ = 3 + 4(n − 1)" and "a₁ = 3, aₙ₊₁ = aₙ + 4").
//   export function partialSums(values): number[]
//   export function seriesInfo(seq, params): SeriesInfo
//     Sₙ in closed form for arithmetic (n/2·(a₁ + aₙ)) and geometric
//     (a₁(1 − rⁿ)/(1 − r)); the infinite geometric sum a₁/(1 − r) when
//     |r| < 1, "diverges" when |r| ≥ 1 (with the reason); for other
//     sequences numeric partial sums and a cautious sentence (the terms
//     do not go to 0 → diverges by the nth-term test; otherwise no claim).
//   export function partnerSource(cls): string | null
//     the continuous partner as a typed explicit source in x:
//     arithmetic → "y = 4x - 1", geometric → "y = 5(0.8)^(x - 1)" (the
//     exponential module's canonical form), quadratic → its parabola.
//   export function sequenceSource(spec): string
//     canonical sources for the builder (both explicit and recursive).
// ============================================================================

import { analyzeExpr, compileExpr } from './parse'
import { compactLatex, CondError, newCtx, parseCondition } from './parse/condition'
import { exactForm } from './exact'
import { expSource } from './exponential'

export type SeqKind = 'explicit' | 'recursive' | 'list'

export interface SequenceDef {
  /** The letter: a, b, u … */
  name: string
  kind: SeqKind
  /** Evaluate term n at the given slider values (explicit/recursive/list). */
  term(params: number[], n: number): number
  /** The first index the definition gives (1 for a_1 = …, 0 for a_0 = …). */
  start: number
  /** Index range if the line gives one; else null (the App picks 1…10). */
  range: [number, number] | null
  paramNames: string[]
  defaultParams: number[]
  /** KaTeX of the definition as typed. */
  latex: string
}

export type SequenceParse =
  | { ok: true; seq: SequenceDef }
  | { ok: false; error: string; pos?: number }

export type SeqClass =
  | { kind: 'arithmetic'; a1: number; d: number; a1Text: string; dText: string; explicit: string; recursive: string }
  | { kind: 'geometric'; a1: number; r: number; a1Text: string; rText: string; explicit: string; recursive: string }
  | { kind: 'quadratic'; coef: [number, number, number]; explicit: string; recursive: string }
  | { kind: 'none' }

export interface SeriesInfo {
  /** Closed form of Sₙ as text, when known. */
  closedForm: string | null
  /** Infinite sum when it converges and is known. */
  sum: { value: number; text: string } | null
  converges: boolean | null
  sentence: string
}

// ============================================================================
// Implementation notes
//
// SYNTAX (decided here; the tests pin every line of it).
//
//   A term is written  a_n  a_{n}  a_(n)  a(n)  aₙ      (any single letter
//   for the name; the index letter is n — or k, i, j, m, whichever the rule's
//   head uses). Shifted: a_(n+1), a_{n-1}, a(n+2), aₙ₊₁; a given term: a_1,
//   a_{0}, a(1), a₁. `a[n]` is NOT accepted — no textbook writes it. On the
//   LEFT of '=' the shorthand a_n+1 = … means a_(n+1) (a_n + 1 = … would be
//   an equation to solve, which no sequence line is); on the right, a_n + 1
//   is a_n plus 1.
//
//   The parts of a line are separated at the top level by ',', ';' or the
//   words "with", "and", "where"; a given term may be chained, a_1 = a_2 = 1.
//   A line with no '=' at all is a list of numbers (constant expressions),
//   at least two of them, optionally ending in "…" or "...".
//
//   Index range: a trailing {1 <= n <= 20} (any one-stretch condition the
//   piecewise engine reads: n >= 0, 1 <= n < 21, …), a trailing
//   "for n = 1 to 20" / "for n >= 1", or a comparison part ", 1 <= n <= 20".
//   A one-sided range (n >= 0) sets where the sequence starts and leaves
//   `range` null.
//
// THE RIGHT-HAND SIDE goes through the ordinary expression engine
// (compileExpr), after a same-length rewrite: every term reference becomes
// one placeholder capital letter (a capital the teacher did not type, never E,
// which the tokenizer would read as an exponent), padded with spaces so every
// position in an engine error is still a position in the line:
//       2a_(n-1) + n      →      2 A      + n
// The engine then sees single-letter constants: the placeholders, the index
// n and the sliders. x, y, r and t — variables to the engine — are renamed
// the same way, so in a_n = a·r^(n − 1) the r is a slider like any other.
// Each engine parameter slot is then bound to what it stands for: the index,
// a previous term, a given term, or a slider. The engine's LaTeX gets the
// placeholders substituted back (capitals only ever come from parameters,
// and the placeholders are capitals nobody typed).
//
// In function notation a(n) = …, `a(n − 1)` on the right is the previous term
// (not the slider a times n − 1): a teacher who names the sequence a and
// writes a(n − 1) means the term. In subscript notation `a` alone on the
// right is a slider (a_n = a + d(n − 1)).
//
// TERMS. Explicit: the formula with n set (non-integer n → NaN). Recursive:
// iterated from the given terms and memoised per slider vector, at most
// 10 000 terms past the first; the first term that is NaN or ±∞ stops the
// iteration and every later term is NaN. List: by position; past the list,
// NaN.
//
// CLASSIFICATION reads numbers only. Three terms are the least that can say
// anything: ANY two numbers have a common difference (and a common ratio), so
// two terms prove nothing and classify as none; a quadratic needs four, since
// any three numbers have a constant (single) second difference.
// ============================================================================

const TERM_CAP = 10_000
const INDEX_LETTERS: ReadonlySet<string> = new Set(['n', 'k', 'i', 'j', 'm'])
/** The engine's variables: renamed to sliders inside a sequence formula. */
const ENGINE_VARS: ReadonlySet<string> = new Set(['x', 'y', 'r', 't'])
const REL_TOL = 1e-9
const SERIES_TERMS = 12
const MINUS = '−'

class SeqError extends Error {
  pos: number | undefined
  constructor(message: string, pos?: number) {
    super(message)
    this.pos = pos
  }
}

/** Extra facts about a parsed sequence that the public type does not carry. */
interface Internal {
  listValues?: number[]
  ellipsis?: boolean
}
const INTERNAL = new WeakMap<SequenceDef, Internal>()

// ----------------------------------------------------------------------------
// Normalisation: Unicode subscripts (aₙ₊₁ → a_(n+1)), with a position map
// ----------------------------------------------------------------------------

const SUB_IN: Record<string, string> = {
  'ₙ': 'n', 'ₖ': 'k', 'ᵢ': 'i', 'ⱼ': 'j', 'ₘ': 'm',
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  '₊': '+', '₋': '-',
}

interface Norm {
  text: string
  /** map[i] = offset in the typed line of normalised character i */
  map: number[]
}

function normalize(src: string): Norm {
  let text = ''
  const map: number[] = []
  let i = 0
  while (i < src.length) {
    if (SUB_IN[src[i]] !== undefined) {
      const at = i
      let run = ''
      while (i < src.length && SUB_IN[src[i]] !== undefined) run += SUB_IN[src[i++]]
      const out = /^\d+$|^[a-z]$/.test(run) ? `_${run}` : `_(${run})`
      for (const ch of out) { text += ch; map.push(at) }
      continue
    }
    text += src[i]
    map.push(i)
    i++
  }
  map.push(src.length)
  return { text, map }
}

// ----------------------------------------------------------------------------
// Spans and top-level splitting
// ----------------------------------------------------------------------------

interface Span {
  text: string
  start: number
}

function trimSpan(s: Span): Span {
  const lead = s.text.length - s.text.trimStart().length
  return { text: s.text.trim(), start: s.start + lead }
}

function sub(s: Span, from: number, to = s.text.length): Span {
  return { text: s.text.slice(from, to), start: s.start + from }
}

const OPEN = '({['
const CLOSE = ')}]'
const SEPARATOR_WORDS: ReadonlySet<string> = new Set(['with', 'and', 'where'])

/** Split at top-level ',', ';' and the words with / and / where. */
function splitParts(s: Span): Span[] {
  const out: Span[] = []
  let depth = 0
  let from = 0
  const t = s.text
  let i = 0
  while (i < t.length) {
    const c = t[i]
    if (OPEN.includes(c)) { depth++; i++; continue }
    if (CLOSE.includes(c)) { depth = Math.max(0, depth - 1); i++; continue }
    if (depth === 0 && (c === ',' || c === ';')) {
      out.push(sub(s, from, i))
      from = i + 1
      i++
      continue
    }
    if (/[A-Za-z]/.test(c)) {
      let j = i
      while (j < t.length && /[A-Za-z]/.test(t[j])) j++
      const w = t.slice(i, j)
      const before = i === 0 ? ' ' : t[i - 1]
      if (depth === 0 && SEPARATOR_WORDS.has(w) && !/[A-Za-z0-9_]/.test(before)) {
        out.push(sub(s, from, i))
        from = j
      }
      i = j
      continue
    }
    i++
  }
  out.push(sub(s, from))
  return out
}

/** The range part of the line (a trailing {…} or "for …"), and the rest. */
function splitRange(s: Span): { body: Span; range: Span | null } {
  const t = s.text.trimEnd()
  if (t.endsWith('}')) {
    let depth = 0
    for (let k = t.length - 1; k >= 0; k--) {
      if (t[k] === '}') depth++
      else if (t[k] === '{') {
        depth--
        if (depth === 0) {
          let b = k - 1
          while (b >= 0 && /\s/.test(t[b])) b--
          if (b >= 0 && t[b] === '_') break // a_{n+1}, not a range
          return { body: sub(s, 0, k), range: sub(s, k + 1, t.length - 1) }
        }
      }
    }
  }
  // the last top-level word "for"
  let depth = 0
  let at = -1
  let i = 0
  while (i < t.length) {
    const c = t[i]
    if (OPEN.includes(c)) { depth++; i++; continue }
    if (CLOSE.includes(c)) { depth = Math.max(0, depth - 1); i++; continue }
    if (/[A-Za-z]/.test(c)) {
      let j = i
      while (j < t.length && /[A-Za-z]/.test(t[j])) j++
      if (depth === 0 && t.slice(i, j) === 'for' && (i === 0 || !/[A-Za-z0-9_]/.test(t[i - 1]))) at = i
      i = j
      continue
    }
    i++
  }
  if (at >= 0) return { body: sub(s, 0, at), range: sub(s, at + 3) }
  return { body: s, range: null }
}

/** Offsets of the top-level '=' signs (not those of <=, >=, !=, ==). */
function equalsAt(s: Span): number[] {
  const out: number[] = []
  let depth = 0
  const t = s.text
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (OPEN.includes(c)) depth++
    else if (CLOSE.includes(c)) depth = Math.max(0, depth - 1)
    else if (c === '=' && depth === 0) {
      const prev = t[i - 1] ?? ''
      const next = t[i + 1] ?? ''
      const partOfRelation = (prev !== '' && '<>!='.includes(prev)) || next === '='
      if (!partOfRelation) out.push(i)
    }
  }
  return out
}

const isComparison = (s: Span): boolean => /[<>≤≥≠]/.test(s.text)
const isEllipsis = (t: string): boolean => /^(…|\.\.\.)$/.test(t.trim())

// ----------------------------------------------------------------------------
// Numbers
// ----------------------------------------------------------------------------

function nearInt(v: number): number | null {
  const r = Math.round(v)
  return Math.abs(v - r) <= 1e-9 * Math.max(1, Math.abs(v)) ? r : null
}

/** A constant expression's value (sliders and variables refused). */
function constantOf(s: Span, what: string): number {
  const t = trimSpan(s)
  const a = analyzeExpr(t.text)
  if (!a.ok) throw new SeqError(a.error.replace(/at position (\d+)/, (_, p) => `at position ${t.start + Number(p)}`), t.start + (a.pos ?? 0))
  if (a.free.length > 0) throw new SeqError(`${what} must be a number, not ${a.free[0]}`, t.start)
  return a.value
}

// ----------------------------------------------------------------------------
// The index range
// ----------------------------------------------------------------------------

interface RangeInfo {
  lo: number
  hi: number
  letter: string
  latex: string
  pos: number
}

function wholeBound(v: number, letter: string, pos: number): number {
  const r = nearInt(v)
  if (r === null) {
    throw new SeqError(`${letter} must be a whole number — use whole-number bounds, e.g. {1 <= ${letter} <= 20}`, pos)
  }
  return r
}

function parseRange(raw: Span): RangeInfo {
  const s = trimSpan(raw)
  if (s.text === '') throw new SeqError('The index range is empty — write it like {1 <= n <= 20}', s.start)
  const forTo = /^([A-Za-z])\s*=\s*(.+?)\s+to\s+(.+)$/.exec(s.text)
  if (forTo) {
    const letter = forTo[1]
    const loAt = s.text.indexOf(forTo[2], forTo[1].length)
    const hiAt = s.text.lastIndexOf(forTo[3])
    const lo = wholeBound(constantOf(sub(s, loAt, loAt + forTo[2].length), 'The first index'), letter, s.start + loAt)
    const hi = wholeBound(constantOf(sub(s, hiAt), 'The last index'), letter, s.start + hiAt)
    if (lo > hi) throw new SeqError(`The index range ${letter} = ${lo} to ${hi} holds no whole numbers`, s.start)
    return { lo, hi, letter, latex: `\\left\\{${lo}\\leq ${letter}\\leq ${hi}\\right\\}`, pos: s.start }
  }
  const ctx = newCtx(analyzeExpr)
  let pieces
  try {
    pieces = parseCondition(s.text, ctx, s.start)
  } catch (e) {
    if (e instanceof CondError) throw new SeqError(e.message, e.pos)
    throw e
  }
  const letter = ctx.name
  if (letter === null || !/^[A-Za-z]$/.test(letter)) {
    throw new SeqError('The index range needs the index, e.g. {1 <= n <= 20}', s.start)
  }
  if (pieces.length !== 1) {
    throw new SeqError(`The index range must be one stretch of whole numbers, e.g. {1 <= ${letter} <= 20}`, s.start)
  }
  const p = pieces[0]
  if (!Number.isFinite(p.lo)) {
    throw new SeqError(`The index range needs a first index, e.g. {${letter} >= 1}`, s.start)
  }
  const lo = p.loC ? wholeBound(p.lo, letter, s.start) : Math.floor(p.lo + 1e-9) + 1
  const hi = !Number.isFinite(p.hi) ? Infinity : p.hiC ? wholeBound(p.hi, letter, s.start) : Math.ceil(p.hi - 1e-9) - 1
  if (lo > hi) throw new SeqError(`The index range holds no whole numbers — try {1 <= ${letter} <= 20}`, s.start)
  return { lo, hi, letter, latex: `\\left\\{${compactLatex(pieces, letter)}\\right\\}`, pos: s.start }
}

// ----------------------------------------------------------------------------
// Heads: a_n, a_(n+1), a(n), a_1 …
// ----------------------------------------------------------------------------

type Index = { fixed: number } | { letter: string; offset: number }

interface Head {
  name: string
  fn: boolean
  idx: Index
  start: number
}

/** Read a subscript / argument: 1, n, n+1, n − 2. Throws on a bad one. */
function parseIndex(content: string, pos: number): Index | null {
  const c = content.replace(/\s+/g, '').replace(/−/g, '-')
  if (/^\d+$/.test(c)) return { fixed: Number(c) }
  if (/^\d*\.\d+$|^\d+\.$/.test(c)) throw new SeqError('n must be a whole number — a term is a_1, a_2, …, never a_1.5', pos)
  let m = /^([A-Za-z])$/.exec(c)
  if (m) return { letter: m[1], offset: 0 }
  m = /^([A-Za-z])([+-])(\d+)$/.exec(c)
  if (m) return { letter: m[1], offset: (m[2] === '-' ? -1 : 1) * Number(m[3]) }
  m = /^([A-Za-z])([+-])(\d*\.\d+)$/.exec(c)
  if (m) throw new SeqError(`${m[1]} must be a whole number — shift the index by a whole number, e.g. a_(${m[1]}+1)`, pos)
  return null
}

const BAD_INDEX = 'Write the index as n, n + 1, n − 1 or a whole number like 1'

/** A head, or null when the text is not a sequence term at all. */
function parseHead(raw: Span): Head | null {
  const s = trimSpan(raw)
  const t = s.text
  let m = /^([A-Za-z])\s*_\s*(?:\{([^{}]*)\}|\(([^()]*)\)|([A-Za-z]|\d+(?:\.\d*)?))$/.exec(t)
  if (m) {
    const content = m[2] ?? m[3] ?? m[4] ?? ''
    const idx = parseIndex(content, s.start + 2)
    if (!idx) throw new SeqError(BAD_INDEX, s.start + 2)
    return { name: m[1], fn: false, idx, start: s.start }
  }
  // a_n+1 = … on the left: the textbook shorthand for a_(n+1)
  m = /^([A-Za-z])\s*_\s*([A-Za-z])\s*([+\-−])\s*(\d+)$/.exec(t)
  if (m) {
    return { name: m[1], fn: false, idx: { letter: m[2], offset: (m[3] === '+' ? 1 : -1) * Number(m[4]) }, start: s.start }
  }
  m = /^([A-Za-z])\s*\(([^()]*)\)$/.exec(t)
  if (m) {
    const idx = parseIndex(m[2], s.start + 2)
    if (!idx) return null
    if ('letter' in idx && !INDEX_LETTERS.has(idx.letter)) return null // f(x) = … is a function
    return { name: m[1], fn: true, idx, start: s.start }
  }
  return null
}

function idxText(idx: Index): { tex: string; plain: string } {
  if ('fixed' in idx) return { tex: String(idx.fixed), plain: String(idx.fixed) }
  const o = idx.offset
  const tail = o === 0 ? '' : o > 0 ? `+${o}` : `-${-o}`
  return { tex: `${idx.letter}${tail}`, plain: `${idx.letter}${tail}` }
}

function termTex(name: string, fn: boolean, idx: Index): string {
  const { tex } = idxText(idx)
  return fn ? `${name}\\left(${tex}\\right)` : `${name}_{${tex}}`
}

/** a_n, a_(n+1), a_1 — or a(n), a(n+1) — as the teacher would type it. */
function termPlain(name: string, fn: boolean, idx: Index): string {
  const { plain } = idxText(idx)
  if (fn) return `${name}(${plain})`
  return plain.length === 1 || /^\d+$/.test(plain) ? `${name}_${plain}` : `${name}_(${plain})`
}

// ----------------------------------------------------------------------------
// Right-hand sides: rewrite, compile, bind the parameter slots
// ----------------------------------------------------------------------------

type Slot =
  | { kind: 'n' }
  | { kind: 'ref'; offset: number }
  | { kind: 'fixed'; index: number }
  | { kind: 'slider'; name: string }

interface Sub {
  tex: string
  plain: string
  slot: Slot
  pos: number
}

interface RhsCtx {
  name: string
  /** the index letter (null in a list / before the rule is known) */
  letter: string | null
  fn: boolean
  pool: string[]
}

interface Compiled {
  latex: string
  slots: Slot[]
  /** first position of each kind of use, for messages */
  refs: { slot: Slot; pos: number; plain: string }[]
  usesIndex: boolean
  ev: (buf: readonly number[]) => number
}

function takePlaceholder(ctx: RhsCtx, pos: number): string {
  const ch = ctx.pool.shift()
  if (!ch) throw new SeqError('This line uses too many different terms to read', pos)
  return ch
}

function rewrite(s: Span, ctx: RhsCtx): { code: string; subs: Map<string, Sub> } {
  const t = s.text
  const out: string[] = []
  const subs = new Map<string, Sub>()
  const byKey = new Map<string, string>()
  const refPlaceholder = (key: string, sb: Omit<Sub, 'pos'>, pos: number): string => {
    let ch = byKey.get(key)
    if (!ch) {
      ch = takePlaceholder(ctx, pos)
      byKey.set(key, ch)
      subs.set(ch, { ...sb, pos })
    }
    return ch
  }
  const plainWord = (w: string, at: number): string => {
    if (w.length === 1 && ENGINE_VARS.has(w)) {
      return refPlaceholder(`var:${w}`, { tex: w, plain: w, slot: { kind: 'slider', name: w } }, s.start + at)
    }
    return w
  }
  let i = 0
  while (i < t.length) {
    const c = t[i]
    if (!/[A-Za-z]/.test(c)) { out.push(c); i++; continue }
    let j = i
    while (j < t.length && /[A-Za-z]/.test(t[j])) j++
    const w = t.slice(i, j)
    const last = w[w.length - 1]
    const prefix = w.slice(0, -1)
    // a subscript: a_n, a_(n-1), a_{n+1}, a_1
    if (t[j] === '_' && w !== 'log') {
      if (last !== ctx.name) {
        throw new SeqError(
          `Only ${ctx.name}'s own terms can be used here — ${last}_… is a different sequence`,
          s.start + j - 1,
        )
      }
      let k = j + 1
      let content: string
      if (t[k] === '(' || t[k] === '{') {
        const close = t[k] === '(' ? ')' : '}'
        const end = t.indexOf(close, k)
        if (end < 0) throw new SeqError(`Missing '${close}' after ${ctx.name}_${t[k]}`, s.start + k)
        content = t.slice(k + 1, end)
        k = end + 1
      } else {
        const m = /^(\d+(?:\.\d+)?|[A-Za-z])/.exec(t.slice(k))
        if (!m) throw new SeqError(BAD_INDEX, s.start + k)
        content = m[1]
        k += m[1].length
      }
      const idx = parseIndex(content, s.start + j + 1)
      if (!idx) throw new SeqError(BAD_INDEX, s.start + j + 1)
      if (prefix) out.push(...splitPrefix(prefix, i, plainWord))
      out.push(' ', refFor(idx, i + prefix.length, k))
      out.push(' '.repeat(k - (j + 1)))
      i = k
      continue
    }
    // function notation, only when the head is a(n): a(n-1), a(2)
    if (ctx.fn && last === ctx.name && t[j] === '(') {
      const end = t.indexOf(')', j)
      const inner = end > 0 ? t.slice(j + 1, end) : ''
      let idx: Index | null = null
      try { idx = end > 0 ? parseIndex(inner, s.start + j + 1) : null } catch { idx = null }
      if (idx && ('fixed' in idx || idx.letter === ctx.letter)) {
        if (prefix) out.push(...splitPrefix(prefix, i, plainWord))
        out.push(' ', refFor(idx, i + prefix.length, end + 1))
        out.push(' '.repeat(end - j))
        i = end + 1
        continue
      }
    }
    out.push(plainWord(w, i))
    i = j
  }
  return { code: out.join(''), subs }

  function refFor(idx: Index, at: number, end: number): string {
    const plain = t.slice(at, end).replace(/\s+/g, '')
    if ('fixed' in idx) {
      return refPlaceholder(
        `fixed:${idx.fixed}`,
        { tex: termTex(ctx.name, ctx.fn, idx), plain, slot: { kind: 'fixed', index: idx.fixed } },
        s.start + at,
      )
    }
    if (ctx.letter !== null && idx.letter !== ctx.letter) {
      throw new SeqError(
        `Use ${ctx.letter} as the index, as the rule does: ${termPlain(ctx.name, ctx.fn, { letter: ctx.letter, offset: idx.offset })}`,
        s.start + at,
      )
    }
    return refPlaceholder(
      `ref:${idx.offset}`,
      { tex: termTex(ctx.name, ctx.fn, idx), plain, slot: { kind: 'ref', offset: idx.offset } },
      s.start + at,
    )
  }
}

/**
 * The letters glued in front of a term reference: "ra_n" is r·a_n, as it is
 * written on paper. A longer prefix is left to the engine, which reads a
 * function name (sin a_n) and refuses any other word, as it always does.
 */
function splitPrefix(prefix: string, at: number, plainWord: (w: string, at: number) => string): string[] {
  return [prefix.length === 1 ? plainWord(prefix, at) : prefix]
}

function compileRhs(raw: Span, ctx: RhsCtx, sliders: string[]): Compiled {
  const s = trimSpan(raw)
  if (s.text === '') throw new SeqError('Something is missing after =', s.start)
  const { code, subs } = rewrite(s, ctx)
  const c = compileExpr(code)
  if (!c.ok) {
    let msg = c.error.replace(/at position (\d+)/g, (_, p) => `at position ${s.start + Number(p)}`)
    msg = msg.replace(/'([A-Z])'/g, (whole, ch: string) => {
      const sb = subs.get(ch)
      return sb ? `'${sb.plain}'` : whole
    })
    throw new SeqError(msg, c.pos !== undefined ? s.start + c.pos : s.start)
  }
  if (c.expr.vars.length > 0) {
    const v = c.expr.vars[0] === 'theta' ? 'θ' : c.expr.vars[0]
    throw new SeqError(`A sequence formula can only use ${ctx.letter ?? 'n'} and sliders — ${v} is not allowed here`, s.start)
  }
  const refs: Compiled['refs'] = []
  let usesIndex = false
  const slots: Slot[] = c.expr.paramNames.map((p) => {
    const sb = subs.get(p)
    if (sb) {
      if (sb.slot.kind !== 'slider') refs.push({ slot: sb.slot, pos: sb.pos, plain: sb.plain })
      return sb.slot
    }
    if (ctx.letter !== null && p === ctx.letter) {
      usesIndex = true
      return { kind: 'n' } as Slot
    }
    return { kind: 'slider', name: p } as Slot
  })
  for (const sl of slots) {
    if (sl.kind === 'slider' && !sliders.includes(sl.name)) sliders.push(sl.name)
  }
  let latex = ''
  for (const ch of c.expr.latex) latex += subs.get(ch)?.tex ?? ch
  const ev = c.expr.ev
  return { latex, slots, refs, usesIndex, ev: (buf) => ev(buf, Number.NaN, Number.NaN) }
}

/** Bind a compiled formula's slots: (sliders, n, previous term, given term) → value. */
function binder(
  c: Compiled,
  sliders: string[],
): (pub: readonly number[], n: number, prev: (offset: number) => number, given: (index: number) => number) => number {
  const where = c.slots.map((sl) => (sl.kind === 'slider' ? sliders.indexOf(sl.name) : -1))
  const buf = new Array<number>(c.slots.length).fill(Number.NaN)
  return (pub, n, prev, given) => {
    for (let q = 0; q < c.slots.length; q++) {
      const sl = c.slots[q]
      switch (sl.kind) {
        case 'n': buf[q] = n; break
        case 'ref': buf[q] = prev(sl.offset); break
        case 'fixed': buf[q] = given(sl.index); break
        case 'slider': {
          const v = pub[where[q]]
          buf[q] = typeof v === 'number' ? v : Number.NaN
          break
        }
      }
    }
    return c.ev(buf)
  }
}

// ----------------------------------------------------------------------------
// parseSequence
// ----------------------------------------------------------------------------

const NOT_A_SEQUENCE =
  'Not a sequence — write a formula like a_n = 2n + 1, a rule like a_1 = 3, a_(n+1) = a_n + 4, or a list like 3, 7, 11, …'

function placeholderPool(text: string): string[] {
  return [...'ABCDFGHJKLMNPQRSUVWZ'].filter((ch) => !text.includes(ch))
}

export function parseSequence(src: string): SequenceParse {
  if (typeof src !== 'string' || src.trim() === '') return { ok: false, error: 'Empty sequence' }
  const norm = normalize(src)
  const toSrc = (p: number | undefined): number | undefined =>
    p === undefined ? undefined : norm.map[Math.max(0, Math.min(p, norm.map.length - 1))]
  try {
    return { ok: true, seq: parseInner(norm.text) }
  } catch (e) {
    if (e instanceof SeqError) {
      const pos = toSrc(e.pos)
      const msg = e.message.replace(/at position (\d+)/g, (_, p) => `at position ${toSrc(Number(p))}`)
      return pos === undefined ? { ok: false, error: msg } : { ok: false, error: msg, pos }
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function parseInner(text: string): SequenceDef {
  const whole: Span = { text, start: 0 }
  const { body, range: rangeSpan } = splitRange(whole)
  let parts = splitParts(body).map(trimSpan)
  // a trailing separator ("3, 7, 11,") is harmless; an empty part elsewhere is not
  while (parts.length > 1 && parts[parts.length - 1].text === '') parts.pop()
  const empty = parts.find((p) => p.text === '')
  if (empty) throw new SeqError('Two separators in a row — something is missing between them', empty.start)

  const rangeParts: Span[] = rangeSpan ? [rangeSpan] : []
  const eqParts: Span[] = []
  const others: Span[] = []
  for (const p of parts) {
    if (equalsAt(p).length > 0) eqParts.push(p)
    else if (isComparison(p)) rangeParts.push(p)
    else others.push(p)
  }
  if (rangeParts.length > 1) throw new SeqError('Give the index range once, e.g. {1 <= n <= 20}', rangeParts[1].start)
  const range = rangeParts.length ? parseRange(rangeParts[0]) : null

  if (eqParts.length === 0) return parseList(others, range)
  return parseDefinition(text, parts, eqParts, others, range)
}

function finishRange(range: RangeInfo | null): [number, number] | null {
  return range && Number.isFinite(range.hi) ? [range.lo, range.hi] : null
}

function rangeTex(range: RangeInfo | null): string {
  return range ? `\\ ${range.latex}` : ''
}

function parseList(items: Span[], range: RangeInfo | null): SequenceDef {
  let ellipsis = false
  const values: number[] = []
  const texs: string[] = []
  items.forEach((raw, q) => {
    let it = raw
    if (isEllipsis(it.text)) {
      if (q !== items.length - 1) throw new SeqError("'…' can only end the list, e.g. 3, 7, 11, …", it.start)
      ellipsis = true
      return
    }
    // "15..." / "15…" at the very end
    const tail = /(\s*(?:…|\.\.\.))$/.exec(it.text)
    if (tail) {
      if (q !== items.length - 1) throw new SeqError("'…' can only end the list, e.g. 3, 7, 11, …", it.start)
      ellipsis = true
      it = { text: it.text.slice(0, it.text.length - tail[1].length), start: it.start }
    }
    const a = analyzeExpr(it.text)
    if (!a.ok) {
      if (items.length < 2) throw new SeqError(NOT_A_SEQUENCE, it.start)
      throw new SeqError(a.error.replace(/at position (\d+)/g, (_, p) => `at position ${it.start + Number(p)}`), it.start + (a.pos ?? 0))
    }
    if (a.free.length > 0) {
      throw new SeqError(
        items.length < 2 ? NOT_A_SEQUENCE : 'A list of terms can only hold numbers, e.g. 3, 7, 11, …',
        it.start,
      )
    }
    values.push(a.value)
    texs.push(a.latex)
  })
  if (values.length < 2) throw new SeqError(NOT_A_SEQUENCE, items[0]?.start ?? 0)
  const start = range ? range.lo : 1
  const seq: SequenceDef = {
    name: 'a',
    kind: 'list',
    term: (_p, n) => (Number.isInteger(n) && n >= start && n - start < values.length ? values[n - start] : Number.NaN),
    start,
    range: finishRange(range),
    paramNames: [],
    defaultParams: [],
    latex: texs.join(',\\ ') + (ellipsis ? ',\\ \\ldots' : '') + rangeTex(range),
  }
  INTERNAL.set(seq, { listValues: values, ellipsis })
  return seq
}

interface EqPart {
  span: Span
  heads: Head[]
  value: Span
}

function parseDefinition(text: string, parts: Span[], eqSpans: Span[], others: Span[], range: RangeInfo | null): SequenceDef {
  if (others.length > 0) {
    const o = others[0]
    throw new SeqError(
      isEllipsis(o.text) ? "'…' belongs to a list of numbers, not to a formula" : `Expected a term like a_1 = 3 here, found '${o.text}'`,
      o.start,
    )
  }
  // heads first: the name and the index letter come from them
  const eqs: EqPart[] = eqSpans.map((span, q) => {
    const at = equalsAt(span)
    const heads: Head[] = []
    let from = 0
    for (const e of at) {
      const h = parseHead(sub(span, from, e))
      if (!h) {
        if (q === 0) throw new SeqError(NOT_A_SEQUENCE, span.start)
        throw new SeqError('Write a term on the left, like a_1 = 3 or a_(n+1) = a_n + 4', span.start + from)
      }
      heads.push(h)
      from = e + 1
    }
    return { span, heads, value: sub(span, from) }
  })
  const first = eqs[0].heads[0]
  const name = first.name
  for (const e of eqs) {
    for (const h of e.heads) {
      if (h.name !== name) {
        throw new SeqError(`Every part must be about the same sequence — ${h.name} is not ${name}`, h.start)
      }
    }
  }
  const ruleEqs = eqs.filter((e) => e.heads.some((h) => 'letter' in h.idx))
  if (ruleEqs.length === 0) {
    const h = eqs[0].heads[0]
    throw new SeqError(
      `${termPlain(name, h.fn, h.idx)} = … gives a starting term — add the rule, e.g. ${name}_(n+1) = ${name}_n + 4`,
      h.start,
    )
  }
  if (ruleEqs.length > 1) {
    throw new SeqError('Give one rule for the sequence — the other parts must be starting terms like a_1 = 3', ruleEqs[1].span.start)
  }
  const ruleEq = ruleEqs[0]
  if (ruleEq.heads.length > 1) {
    throw new SeqError('The rule cannot be chained with another term — write it on its own, e.g. a_(n+1) = a_n + 4', ruleEq.span.start)
  }
  const ruleHead = ruleEq.heads[0]
  const ruleIdx = ruleHead.idx as { letter: string; offset: number }
  const letter = ruleIdx.letter
  if (!INDEX_LETTERS.has(letter)) throw new SeqError(NOT_A_SEQUENCE, ruleHead.start)
  if (range && range.letter !== letter) {
    throw new SeqError(`The index range must use ${letter}, the sequence's index`, range.pos)
  }
  const h = ruleIdx.offset
  const fn = ruleHead.fn

  const pool = placeholderPool(text)
  const sliders: string[] = []
  const ctx: RhsCtx = { name, letter, fn, pool }

  // compile every right-hand side in the order typed, so the sliders keep
  // their order of first appearance
  interface Given { index: number; c: Compiled; start: number }
  const givens: Given[] = []
  let rule: Compiled | null = null
  const latexParts: string[] = []
  for (const e of eqs) {
    const c = compileRhs(e.value, ctx, sliders)
    const lhsTex = e.heads.map((hd) => termTex(name, hd.fn, hd.idx)).join('=')
    latexParts.push(`${lhsTex}=${c.latex}`)
    if (e === ruleEq) { rule = c; continue }
    for (const hd of e.heads) {
      const idx = hd.idx as { fixed: number }
      if (c.refs.length > 0) {
        throw new SeqError(`A starting term must be a number, e.g. ${name}_1 = 3`, c.refs[0].pos)
      }
      if (c.usesIndex) {
        throw new SeqError(`${termPlain(name, hd.fn, idx)} is one term, so its value cannot use ${letter}`, e.value.start)
      }
      if (givens.some((g) => g.index === idx.fixed)) {
        throw new SeqError(`${termPlain(name, hd.fn, idx)} is given twice`, hd.start)
      }
      givens.push({ index: idx.fixed, c, start: hd.start })
    }
  }
  const r = rule as Compiled
  givens.sort((a, b) => a.index - b.index)
  const givenIdx = givens.map((g) => g.index)

  // references: previous terms (the recursion) and given terms
  let order = 0
  for (const ref of r.refs) {
    if (ref.slot.kind === 'ref') {
      const lag = h - ref.slot.offset
      if (lag < 1 || lag > 2) {
        const at = (o: number) => termPlain(name, fn, { letter, offset: o })
        throw new SeqError(`${at(h)} can only use ${at(h - 1)} and ${at(h - 2)}`, ref.pos)
      }
      order = Math.max(order, lag)
    } else if (ref.slot.kind === 'fixed') {
      if (!givenIdx.includes(ref.slot.index)) {
        throw new SeqError(
          `${ref.plain} is not given — give it as a starting term (${name}_${ref.slot.index} = …), or use ${termPlain(name, fn, { letter, offset: 0 })}`,
          ref.pos,
        )
      }
    }
  }
  const run = binder(r, sliders)
  const givenRuns = new Map(givens.map((g) => [g.index, binder(g.c, sliders)] as const))
  const givenVal = (p: readonly number[], index: number): number => {
    const f = givenRuns.get(index)
    return f ? f(p, Number.NaN, () => Number.NaN, () => Number.NaN) : Number.NaN
  }
  const latex = latexParts.join(',\\ ') + rangeTex(range)
  const paramNames = [...sliders]
  const defaultParams = paramNames.map(() => 1)

  if (order === 0) {
    // explicit (given terms, if any, stand as typed)
    const start = range ? range.lo : givenIdx.length ? Math.min(givenIdx[0], 1) : 1
    return {
      name,
      kind: 'explicit',
      term: (p, m) => {
        if (!Number.isInteger(m)) return Number.NaN
        if (givenRuns.has(m)) return givenVal(p, m)
        return run(p, m - h, () => Number.NaN, (index) => givenVal(p, index))
      },
      start,
      range: finishRange(range),
      paramNames,
      defaultParams,
      latex,
    }
  }

  // recursive
  const ruleText = termPlain(name, fn, { letter, offset: h })
  if (givens.length === 0) {
    throw new SeqError(
      order === 1
        ? `A recursive sequence needs a starting term, e.g. ${name}_1 = 3`
        : `${ruleText} uses the two terms before it, so it needs two starting terms, e.g. ${name}_1 = 1, ${name}_2 = 1`,
      ruleHead.start,
    )
  }
  if (givens.length < order) {
    throw new SeqError(
      `${ruleText} uses the two terms before it, so it needs two starting terms, e.g. ${name}_1 = 1, ${name}_2 = 1`,
      ruleHead.start,
    )
  }
  for (let q = 1; q < givens.length; q++) {
    if (givens[q].index !== givens[q - 1].index + 1) {
      throw new SeqError(
        `The starting terms must be next to each other, e.g. ${name}_1 = 1, ${name}_2 = 1`,
        givens[q].start,
      )
    }
  }
  const g0 = givens[0].index
  if (g0 < 0) throw new SeqError('The first index must be 0 or more', givens[0].start)
  if (range && range.lo < g0) {
    throw new SeqError(
      `The index range starts at ${letter} = ${range.lo}, before the first term given, ${name}_${g0}`,
      range.pos,
    )
  }

  // memo per slider vector: memo[q] is the term at g0 + q
  let memoKey: number[] | null = null
  let memo: number[] = []
  let dead = false
  const sameKey = (p: readonly number[]): boolean =>
    memoKey !== null && memoKey.length === p.length && memoKey.every((v, q) => Object.is(v, p[q]))
  const term = (p: number[], m: number): number => {
    if (!Number.isInteger(m) || m < g0) return Number.NaN
    const q = m - g0
    if (q >= TERM_CAP) return Number.NaN
    if (!sameKey(p)) {
      memoKey = [...p]
      memo = givens.map((g) => givenVal(p, g.index))
      dead = memo.some((v) => !Number.isFinite(v))
    }
    if (q < memo.length) return Number.isFinite(memo[q]) ? memo[q] : Number.NaN
    while (memo.length <= q) {
      if (dead) return Number.NaN
      const mm = g0 + memo.length
      const v = run(
        p,
        mm - h,
        (offset) => memo[mm - g0 - (h - offset)],
        (index) => givenVal(p, index),
      )
      if (!Number.isFinite(v)) {
        dead = true
        return Number.NaN
      }
      memo.push(v)
    }
    return memo[q]
  }
  return {
    name,
    kind: 'recursive',
    term,
    start: g0,
    range: finishRange(range),
    paramNames,
    defaultParams,
    latex,
  }
}

// ============================================================================
// terms, partial sums
// ============================================================================

export function terms(seq: SequenceDef, params: number[], n0: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => seq.term(params, n0 + i))
}

export function partialSums(values: number[]): number[] {
  const out: number[] = []
  let s = 0
  for (const v of values) {
    s += v
    out.push(s)
  }
  return out
}

// ============================================================================
// Number text
//
// A textbook writes r = 1/2 and r = 0.8, d = 2.5 and d = 1/3: terminating
// decimals stay decimals, except the halves and quarters below 1 (1/2, 3/4),
// which read as fractions; repeating ones become fractions (1/3, 5/6); the
// surds and multiples of π the exact module recognises are written as such;
// anything else is a decimal to 6 significant digits.
// ============================================================================

interface Nice {
  /** snapped value */
  v: number
  /** display text, true minus sign */
  text: string
  /** ASCII parseable text */
  src: string
  isFrac: boolean
  /** bare decimal / integer (no fraction bar, no symbol) */
  plain: boolean
}

function trimNum(s: string): string {
  if (!s.includes('e') && s.includes('.')) s = s.replace(/\.?0+$/, '')
  return s === '-0' ? '0' : s
}

function nice(v: number): Nice {
  if (!Number.isFinite(v)) return { v, text: 'undefined', src: 'NaN', isFrac: false, plain: false }
  const sign = v < 0 ? MINUS : ''
  const sgnSrc = v < 0 ? '-' : ''
  const i = nearInt(v)
  if (i !== null) {
    const a = Math.abs(i)
    return { v: i, text: i === 0 ? '0' : `${sign}${a}`, src: i === 0 ? '0' : `${sgnSrc}${a}`, isFrac: false, plain: true }
  }
  const av = Math.abs(v)
  // halves and quarters below 1: 1/2, 1/4, 3/4
  if (av < 1) {
    const q4 = nearInt(av * 4)
    if (q4 !== null) {
      const [p, q] = q4 % 2 === 0 ? [q4 / 2, 2] : [q4, 4]
      return { v: (v < 0 ? -1 : 1) * (p / q), text: `${sign}${p}/${q}`, src: `${sgnSrc}${p}/${q}`, isFrac: true, plain: false }
    }
  }
  // terminating decimals with up to 4 places
  for (let d = 1; d <= 4; d++) {
    const k = Math.pow(10, d)
    const r = nearInt(av * k)
    if (r !== null && Math.abs(av * k - r) <= 1e-9 * Math.max(1, av * k)) {
      const s = trimNum((r / k).toFixed(d))
      return { v: (v < 0 ? -1 : 1) * (r / k), text: `${sign}${s}`, src: `${sgnSrc}${s}`, isFrac: false, plain: true }
    }
  }
  const ef = exactForm(v)
  if (ef) {
    const frac = /^−?\d+\/\d+$/.exec(ef.text)
    const src = frac ? ef.text.replace(MINUS, '-') : trimNum(v.toPrecision(12))
    return { v: ef.value, text: ef.text, src, isFrac: !!frac, plain: false }
  }
  const t = trimNum(av.toPrecision(6))
  return { v, text: `${sign}${t}`, src: trimNum(v.toPrecision(12)), isFrac: false, plain: true }
}

const SUB_OUT: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', n: 'ₙ',
}
const SUP_OUT: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', n: 'ⁿ',
}
const toSub = (s: string): string => [...s].map((c) => SUB_OUT[c] ?? c).join('')
const toSup = (s: string): string => [...s].map((c) => SUP_OUT[c] ?? c).join('')

/** "n − 1", "n", "n + 2" for the index minus n0. */
function shiftText(n0: number): string {
  if (n0 === 0) return 'n'
  return n0 > 0 ? `n ${MINUS} ${n0}` : `n + ${-n0}`
}

/** Exponent n − n0 as superscript: ⁿ⁻¹, ⁿ. */
function shiftSup(n0: number): string {
  if (n0 === 0) return 'ⁿ'
  return toSup(n0 > 0 ? `n-${n0}` : `n+${-n0}`)
}

/**
 * A coefficient in front of `what` (a letter group or a parenthesis):
 * "4n", "(1/2)n", "√2·n", "n" for 1 — `mag` is already non-negative.
 */
function coefBefore(mag: Nice, what: string): string {
  if (mag.v === 1) return what
  if (mag.isFrac) return `(${mag.text})${what}`
  if (!mag.plain && what[0] !== '(') return `${mag.text}·${what}`
  return `${mag.text}${what}`
}

/** A power base: bare for a positive integer / decimal, else parenthesised. */
function baseText(r: Nice): string {
  return r.plain && r.v > 0 ? r.text : `(${r.text})`
}

/** Polynomial text in `v`: "n² + 2n + 1", "−(1/2)n² + 3". */
function polyText(coef: [number, number, number], v: string): string {
  const parts: string[] = []
  const pw = ['²', '', '']
  coef.forEach((c, q) => {
    const nc = nice(c)
    if (nc.v === 0) return
    const mag = nice(Math.abs(nc.v))
    const body = q === 2 ? mag.text : coefBefore(mag, `${v}${pw[q]}`)
    if (parts.length === 0) parts.push(nc.v < 0 ? `${MINUS}${body}` : body)
    else parts.push(nc.v < 0 ? `${MINUS} ${body}` : `+ ${body}`)
  })
  return parts.length ? parts.join(' ') : '0'
}

/** ASCII polynomial in x for the parser: "x^2 + 2x + 1", "(1/2)x - 3". */
function polySrc(coef: [number, number, number]): string {
  const parts: string[] = []
  const pw = ['x^2', 'x', '']
  coef.forEach((c, q) => {
    const nc = nice(c)
    if (nc.v === 0) return
    const mag = nice(Math.abs(nc.v))
    let body: string
    if (q === 2) body = mag.src
    else if (mag.v === 1) body = pw[q]
    else body = `${mag.isFrac || !mag.plain ? `(${mag.src})` : mag.src}${pw[q]}`
    if (parts.length === 0) parts.push(nc.v < 0 ? `-${body}` : body)
    else parts.push(nc.v < 0 ? `- ${body}` : `+ ${body}`)
  })
  return parts.length ? parts.join(' ') : '0'
}

// ============================================================================
// classify
// ============================================================================

function allClose(xs: number[], ref: number, scale: number): boolean {
  const tol = REL_TOL * scale
  return xs.every((x) => Math.abs(x - ref) <= tol)
}

/**
 * Arithmetic, geometric or quadratic from the terms alone. `values[0]` is the
 * term at index `n0` (default 1); a1 / a1Text are always the term at n = 1,
 * so the formulas and the partner hold for every n. `name` letters the texts.
 */
export function classify(values: number[], n0 = 1, name = 'a'): SeqClass {
  // Fewer than three terms prove nothing: any two numbers have a common
  // difference AND a common ratio.
  if (!Array.isArray(values) || values.length < 3) return { kind: 'none' }
  if (!values.every((v) => typeof v === 'number' && Number.isFinite(v))) return { kind: 'none' }
  if (!Number.isInteger(n0)) n0 = 1
  const maxAbs = Math.max(...values.map(Math.abs))
  const an = `${name}ₙ`
  const a0Name = `${name}${toSub(String(n0))}`
  const next = `${name}ₙ₊₁`

  // arithmetic
  const diffs = values.slice(1).map((v, q) => v - values[q])
  if (allClose(diffs, diffs[0], maxAbs)) {
    const d = nice(diffs.reduce((s, x) => s + x, 0) / diffs.length)
    const first = nice(values[0])
    const a1 = nice(first.v + (1 - n0) * d.v)
    const explicit = arithExplicit(an, first, d, n0)
    const recursive = `${a0Name} = ${first.text}, ${next} = ${an}${
      d.v === 0 ? '' : d.v < 0 ? ` ${MINUS} ${nice(-d.v).text}` : ` + ${d.text}`
    }`
    return { kind: 'arithmetic', a1: a1.v, d: d.v, a1Text: a1.text, dText: d.text, explicit, recursive }
  }

  // geometric: no zero terms
  if (values.every((v) => v !== 0)) {
    const ratios = values.slice(1).map((v, q) => v / values[q])
    if (allClose(ratios, ratios[0], Math.abs(ratios[0]))) {
      const r = nice(ratios[0])
      const first = nice(values[0])
      const a1 = nice(first.v * Math.pow(r.v, 1 - n0))
      const explicit = `${an} = ${geomTerm(first, r, shiftSup(n0))}`
      let rc: string
      if (r.v === -1) rc = MINUS
      else {
        const mag = nice(Math.abs(r.v))
        rc = (r.v < 0 ? MINUS : '') + (mag.isFrac ? `(${mag.text})` : mag.plain ? mag.text : `${mag.text}·`)
      }
      const recursive = `${a0Name} = ${first.text}, ${next} = ${rc}${an}`
      return { kind: 'geometric', a1: a1.v, r: r.v, a1Text: a1.text, rText: r.text, explicit, recursive }
    }
  }

  // quadratic: constant, nonzero second differences; four terms at least
  if (values.length >= 4) {
    const second = diffs.slice(1).map((v, q) => v - diffs[q])
    if (allClose(second, second[0], maxAbs) && Math.abs(second[0]) > REL_TOL * maxAbs) {
      const A = nice(second[0] / 2).v
      const B = nice(diffs[0] - A * (2 * n0 + 1)).v
      const C = nice(values[0] - A * n0 * n0 - B * n0).v
      const coef: [number, number, number] = [A, B, C]
      const explicit = `${an} = ${polyText(coef, 'n')}`
      // aₙ₊₁ − aₙ = A(2n + 1) + B, added term by term
      const step = polyText([0, 2 * A, A + B], 'n')
      const tail = step.startsWith(MINUS) ? ` ${MINUS} ${step.slice(1)}` : ` + ${step}`
      const recursive = `${a0Name} = ${nice(values[0]).text}, ${next} = ${an}${tail}`
      return { kind: 'quadratic', coef, explicit, recursive }
    }
  }
  return { kind: 'none' }
}

function arithExplicit(an: string, first: Nice, d: Nice, n0: number): string {
  if (d.v === 0) return `${an} = ${first.text}`
  const group = n0 === 0 ? 'n' : `(${shiftText(n0)})`
  const dPart = coefBefore(nice(Math.abs(d.v)), group)
  if (first.v === 0) return `${an} = ${d.v < 0 ? MINUS : ''}${dPart}`
  return `${an} = ${first.text} ${d.v < 0 ? MINUS : '+'} ${dPart}`
}

/** first·r^(exp): "5·0.8ⁿ⁻¹", "3(−2)ⁿ⁻¹", "10(1/2)ⁿ⁻¹", "2ⁿ⁻¹". */
function geomTerm(first: Nice, r: Nice, sup: string): string {
  const b = baseText(r)
  const pow = `${b}${sup}`
  if (first.v === 1) return pow
  if (first.v === -1) return `${MINUS}${pow}`
  const coef = first.isFrac ? `(${first.text})` : first.text
  const sep = b[0] === '(' ? '' : '·'
  return `${coef}${sep}${pow}`
}

// ============================================================================
// seriesInfo
// ============================================================================

export function seriesInfo(seq: SequenceDef, params: number[]): SeriesInfo {
  const internal = INTERNAL.get(seq) ?? {}
  const n0 = Number.isInteger(seq.start) ? seq.start : 1
  const name = seq.name || 'a'
  let values = terms(seq, params, n0, SERIES_TERMS)
  if (seq.kind === 'list') {
    let k = 0
    while (k < values.length && Number.isFinite(values[k])) k++
    values = values.slice(0, k)
  }
  if (values.length === 0 || values.some((v) => !Number.isFinite(v))) {
    return {
      closedForm: null,
      sum: null,
      converges: null,
      sentence: 'Some of the first terms are undefined, so there is no series to add up.',
    }
  }
  const info = patternSeries(seq, params, values, n0, name)
  if (seq.kind === 'list' && !internal.ellipsis && internal.listValues) {
    // a finite list: its series is a finite sum
    const total = internal.listValues.reduce((s, v) => s + v, 0)
    const t = nice(total).text
    return {
      closedForm: info.closedForm,
      sum: { value: total, text: t },
      converges: true,
      sentence: `A finite list: its ${internal.listValues.length} terms add up to ${t}.`,
    }
  }
  return info
}

function patternSeries(seq: SequenceDef, params: number[], values: number[], n0: number, name: string): SeriesInfo {
  const cls = classify(values, n0, name)
  const first = nice(values[0])
  const firstName = `${name}${toSub(String(n0))}`
  const Sn = 'Sₙ'

  if (cls.kind === 'arithmetic') {
    const d = nice(cls.d)
    const poly = polyText([d.v / 2, first.v - d.v / 2, 0], 'n')
    const closedForm = `${Sn} = n/2·(2${firstName} + (n ${MINUS} 1)d) = ${poly}`
    if (d.v === 0 && first.v === 0) {
      return { closedForm, sum: { value: 0, text: '0' }, converges: true, sentence: 'Every term is 0, so the series converges to 0.' }
    }
    const sentence =
      d.v === 0
        ? `Every term is ${first.text}, so the terms do not approach 0 and the series diverges (nth-term test).`
        : `The terms change by ${d.text} each time, so they do not approach 0 and the series diverges (nth-term test).`
    return { closedForm, sum: null, converges: false, sentence }
  }

  if (cls.kind === 'geometric') {
    const r = nice(cls.r)
    const rIn = r.v < 0 ? `(${r.text})` : r.text
    const rPow = `${baseText(r)}ⁿ`
    const a = first.isFrac ? `(${first.text})` : first.text
    const C = nice(first.v / (1 - r.v))
    let simple: string
    if (C.v === 1) simple = `1 ${MINUS} ${rPow}`
    else if (C.v === -1) simple = `${rPow} ${MINUS} 1`
    else if (C.v < 0) {
      const m = nice(-C.v)
      simple = `${m.isFrac ? `(${m.text})` : m.text}(${rPow} ${MINUS} 1)`
    } else simple = `${C.isFrac ? `(${C.text})` : C.text}(1 ${MINUS} ${rPow})`
    const lead = first.v === 1 ? '' : first.v === -1 ? MINUS : a
    const closedForm = `${Sn} = ${lead}(1 ${MINUS} ${rPow})/(1 ${MINUS} ${rIn}) = ${simple}`
    const absR = nice(Math.abs(r.v)).text
    if (Math.abs(r.v) < 1) {
      const text = `${a}/(1 ${MINUS} ${rIn}) = ${C.text}`
      return {
        closedForm,
        sum: { value: C.v, text },
        converges: true,
        sentence: `|r| = ${absR} < 1, so the series converges: S = ${text}.`,
      }
    }
    return {
      closedForm,
      sum: null,
      converges: false,
      sentence: `|r| = ${absR} ≥ 1, so the terms do not approach 0 and the series diverges.`,
    }
  }

  if (cls.kind === 'quadratic') {
    return {
      closedForm: null,
      sum: null,
      converges: false,
      sentence: 'The terms grow without bound, so they do not approach 0 and the series diverges (nth-term test).',
    }
  }

  if (seq.kind === 'list') {
    return {
      closedForm: null,
      sum: null,
      converges: null,
      sentence: 'Only the listed terms are known — no conclusion from the nth-term test.',
    }
  }
  return nthTermTest(seq, params, n0)
}

/**
 * The nth-term test, read off the tail: the largest |aₙ| in a window of 8
 * terms near 100, 1000 and 10 000 terms in. Flat or growing → the terms do not
 * approach 0 → diverges. Shrinking steadily → the terms approach 0, which
 * decides nothing. Anything in between → no conclusion either.
 */
function nthTermTest(seq: SequenceDef, params: number[], n0: number): SeriesInfo {
  const win = (N: number): number => {
    let m = 0
    for (let k = 0; k < 8; k++) {
      const v = seq.term(params, n0 + N + k)
      if (Number.isNaN(v)) return Number.NaN
      m = Math.max(m, Math.abs(v))
    }
    return m
  }
  const M1 = win(100)
  const M2 = win(1000)
  const M3 = win(TERM_CAP - 10)
  const none = (sentence: string): SeriesInfo => ({ closedForm: null, sum: null, converges: null, sentence })
  if ([M1, M2, M3].some(Number.isNaN)) {
    return none('Far-out terms are undefined or too large to compute — no conclusion from the nth-term test.')
  }
  const tiny = 1e-10
  if (M3 > tiny && (!Number.isFinite(M3) || (M3 >= 0.9 * M2 && M2 >= 0.9 * M1))) {
    return {
      closedForm: null,
      sum: null,
      converges: false,
      sentence: 'The terms do not approach 0, so the series diverges (nth-term test).',
    }
  }
  if (M3 <= tiny || (M3 <= 0.5 * M1 && M3 <= M2 * (1 + 1e-9) && M2 <= M1 * (1 + 1e-9))) {
    return none('The terms approach 0, but that alone decides nothing — no conclusion from the nth-term test.')
  }
  return none('No conclusion from the nth-term test.')
}

// ============================================================================
// partnerSource, sequenceSource
// ============================================================================

/**
 * The continuous function through every (n, aₙ): a line, an exponential
 * y = a₁·r^(x − 1) (the exponential module's canonical form), a parabola.
 * A negative ratio has no exponential partner — (−2)^x is undefined between
 * the integers — so that, and anything unclassified, is null.
 */
export function partnerSource(cls: SeqClass): string | null {
  if (!cls || typeof cls !== 'object') return null
  switch (cls.kind) {
    case 'arithmetic': {
      if (!Number.isFinite(cls.a1) || !Number.isFinite(cls.d)) return null
      return `y = ${polySrc([0, cls.d, nice(cls.a1 - cls.d).v])}`
    }
    case 'geometric': {
      if (!(cls.r > 0) || !Number.isFinite(cls.a1) || !Number.isFinite(cls.r)) return null
      return expSource({ a: nice(cls.a1).src, b: nice(cls.r).src, p: '1', h: '1', k: '0' })
    }
    case 'quadratic':
      if (!cls.coef.every(Number.isFinite)) return null
      return `y = ${polySrc(cls.coef)}`
    default:
      return null
  }
}

/** A number the teacher typed: its sign split off, and whether it can stand bare. */
function typedNumber(raw: string, fallback: string): { neg: boolean; mag: string; bare: boolean; text: string } {
  const text = (raw ?? '').replace(/−/g, '-').trim() || fallback
  const m = /^-\s*(.+)$/.exec(text)
  const neg = !!m
  const mag = m ? m[1].trim() : text
  const bare = /^\d+(\.\d+)?$|^\.\d+$/.test(mag)
  return { neg, mag, bare, text }
}

export function sequenceSource(spec: {
  name: string
  kind: 'arithmetic' | 'geometric'
  a1: string
  step: string
  form: 'explicit' | 'recursive'
}): string {
  const L = typeof spec?.name === 'string' && /^[A-Za-z]$/.test(spec.name) ? spec.name : 'a'
  const a1 = typedNumber(spec?.a1, '1')
  const a1Text = a1.neg && !a1.bare ? `-(${a1.mag})` : a1.text
  const step = typedNumber(spec?.step, spec?.kind === 'geometric' ? '1' : '0')
  if (spec?.kind === 'geometric') {
    if (spec.form === 'recursive') {
      const coef = step.bare ? step.text : `(${step.text})`
      const factor = step.text === '1' ? '' : step.text === '-1' ? '-' : coef
      return `${L}_1 = ${a1Text}, ${L}_(n+1) = ${factor}${L}_n`
    }
    const pow = `(${step.text})^(n - 1)`
    if (a1.text === '1') return `${L}_n = ${pow}`
    if (a1.text === '-1') return `${L}_n = -${pow}`
    const coef = a1.bare || (a1.neg && a1.bare) ? a1.text : `(${a1.text})`
    return `${L}_n = ${coef}${pow}`
  }
  // arithmetic
  const sign = step.neg ? '-' : '+'
  const mag = step.bare ? step.mag : `(${step.mag})`
  if (spec?.form === 'recursive') {
    return `${L}_1 = ${a1Text}, ${L}_(n+1) = ${L}_n ${sign} ${mag}`
  }
  const dPart = step.mag === '1' ? '(n - 1)' : `${mag}(n - 1)`
  return `${L}_n = ${a1Text} ${sign} ${dPart}`
}

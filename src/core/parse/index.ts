// ============================================================================
// Typed math-expression engine for Grapher.
//   export function parseExpression(src: string): ParseOutcome
//
// Hand-rolled tokenizer + Pratt (precedence-climbing) parser + AST,
// closure-compiled evaluators (no eval / new Function), LaTeX generation.
// Zero dependencies. Implements the ParsedPlot/ParseOutcome contract in
// src/core/types.ts.
//
// Grammar (informal):
//   input      := expr ( '=' expr )?
//   expr       := term ( ('+'|'-') term )*
//   term       := factor ( ('*'|'/') factor | juxtaposed-factor )*      // implicit mult
//   factor     := ('-'|'+') factor | power
//   power      := atom ( '^' factor )?                                   // right-assoc
//   atom       := number | ident | '(' expr ')' | '|' expr '|'
//                | func '(' expr (',' expr)? ')' | func tight-product
//   (implemented as a Pratt parser with binding powers:
//      + -            10
//      * / juxtapose  20
//      unary -        25
//      ^              30 (right-assoc))
//   Paren-less function application binds a full product: sin 2x = sin(2x),
//   sin x + 1 = sin(x) + 1.
//   Logarithms in any base: log_B(u) := `log_` base arg, where base is a
//   number literal, a constant, a single letter or '(' expr ')', never
//   depending on the variable; arg is '(' expr ')' or paren-less like ln x.
//   log_(B, u) is the same call. log_e(u) is ln(u). See Parser.logBaseNud.
//
// Named calls (functions that use other functions — see ../functionEnv.ts):
//   parseExpression(src, env), compileExpr(src, env), analyzeExpr(src, env)
//   take an optional FunctionEnv. A single letter the env defines, IMMEDIATELY
//   followed by `(` — or by `'(` / `''(` — is a call of that curve:
//       f(x − 1)   f(g(x))   f'(x)   f''(2x)
//   and becomes one AST node, { t: 'ucall', name, arg, order }. Nothing else
//   changes: without an env, or for a letter the env does not define,
//   `a(x + 1)` is still the slider a times (x + 1), and `f'(x)` is still the
//   "Unexpected character" it always was. See Parser.userCall.
// ============================================================================

import type {
  CurveKind,
  IneqPart,
  IneqRel,
  IneqSide,
  InequalityInfo,
  ModelSpec,
  ParamMeta,
  ParseOutcome,
  ParsedPlot,
  PieceInfo,
} from '../types'
import { prettyMath } from '../ineqText'
import type { FunctionEnv } from '../functionEnv'
import { evalExactAt } from './exactEval'
import { jetAt } from './jets'
import {
  CondError,
  compactLatex,
  complementOf,
  liveClause,
  exclusionLatex,
  excludedPoints,
  extentOf,
  inPieces,
  newCtx,
  parseCondition,
  setLatex,
  WHOLE_LINE,
  type CondCtx,
  type LiveClause,
  type Piece,
} from './condition'

// ----------------------------------------------------------------------------
// Function / constant / variable tables
// ----------------------------------------------------------------------------

interface FuncDef {
  arity: 1 | 2
  fn: (a: number, b: number) => number
  latex: (args: string[]) => string
}

const wrap = (s: string) => `\\left(${s}\\right)`

/**
 * Own-property membership. `w in FUNCS` also answers yes for "toString" and
 * "constructor", which came off Object.prototype, not off the table.
 */
const has = (table: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(table, key)

/** env.has, and a throwing env is an env that does not have the name. */
function envHas(env: FunctionEnv, name: string): boolean {
  try { return env.has(name) === true } catch { return false }
}

const FUNCS: Record<string, FuncDef> = {
  sin:   { arity: 1, fn: (a) => Math.sin(a),   latex: (x) => `\\sin${wrap(x[0])}` },
  cos:   { arity: 1, fn: (a) => Math.cos(a),   latex: (x) => `\\cos${wrap(x[0])}` },
  tan:   { arity: 1, fn: (a) => Math.tan(a),   latex: (x) => `\\tan${wrap(x[0])}` },
  // the reciprocal functions: poles where cos (sec) or sin (csc, cot) is 0 —
  // see TRIG_POLE, which is what makes them singular sources like tan
  sec:   { arity: 1, fn: (a) => 1 / Math.cos(a), latex: (x) => `\\sec${wrap(x[0])}` },
  csc:   { arity: 1, fn: (a) => 1 / Math.sin(a), latex: (x) => `\\csc${wrap(x[0])}` },
  cot:   { arity: 1, fn: (a) => Math.cos(a) / Math.sin(a), latex: (x) => `\\cot${wrap(x[0])}` },
  asin: { arity: 1, fn: (a) => Math.asin(a),  latex: (x) => `\\arcsin${wrap(x[0])}` },
  acos:  { arity: 1, fn: (a) => Math.acos(a),  latex: (x) => `\\arccos${wrap(x[0])}` },
  atan:  { arity: 1, fn: (a) => Math.atan(a),  latex: (x) => `\\arctan${wrap(x[0])}` },
  sinh:  { arity: 1, fn: (a) => Math.sinh(a),  latex: (x) => `\\sinh${wrap(x[0])}` },
  cosh:  { arity: 1, fn: (a) => Math.cosh(a),  latex: (x) => `\\cosh${wrap(x[0])}` },
  tanh:  { arity: 1, fn: (a) => Math.tanh(a),  latex: (x) => `\\tanh${wrap(x[0])}` },
  sqrt:  { arity: 1, fn: (a) => Math.sqrt(a),  latex: (x) => `\\sqrt{${x[0]}}` },
  cbrt:  { arity: 1, fn: (a) => Math.cbrt(a),  latex: (x) => `\\sqrt[3]{${x[0]}}` },
  abs:   { arity: 1, fn: (a) => Math.abs(a),   latex: (x) => `\\left|${x[0]}\\right|` },
  ln:    { arity: 1, fn: (a) => Math.log(a),   latex: (x) => `\\ln${wrap(x[0])}` },
  log:   { arity: 1, fn: (a) => Math.log10(a), latex: (x) => `\\log${wrap(x[0])}` },
  log2:  { arity: 1, fn: (a) => Math.log2(a),  latex: (x) => `\\log_{2}${wrap(x[0])}` },
  log10: { arity: 1, fn: (a) => Math.log10(a), latex: (x) => `\\log_{10}${wrap(x[0])}` },
  exp:   { arity: 1, fn: (a) => Math.exp(a),   latex: (x) => `\\exp${wrap(x[0])}` },
  floor: { arity: 1, fn: (a) => Math.floor(a), latex: (x) => `\\left\\lfloor ${x[0]}\\right\\rfloor` },
  ceil:  { arity: 1, fn: (a) => Math.ceil(a),  latex: (x) => `\\left\\lceil ${x[0]}\\right\\rceil` },
  sign:  { arity: 1, fn: (a) => Math.sign(a),  latex: (x) => `\\operatorname{sign}${wrap(x[0])}` },
  min:   { arity: 2, fn: (a, b) => Math.min(a, b), latex: (x) => `\\min${wrap(`${x[0]},\\,${x[1]}`)}` },
  max:   { arity: 2, fn: (a, b) => Math.max(a, b), latex: (x) => `\\max${wrap(`${x[0]},\\,${x[1]}`)}` },
  // log_B(u): args are [B, u] (source order, so free constants keep their
  // order of first appearance). Typed only as `log_…` — the tokenizer never
  // produces the name `log_` from a plain word. See LOG_BASE below.
  log_:  { arity: 2, fn: (b, u) => logBase(b, u), latex: (x) => `\\log_{${x[0]}}${wrap(x[1])}` },
}

/**
 * Other spellings of a function in FUNCS. The alias is resolved in the
 * parser, so the AST — and everything downstream of it — only ever sees the
 * one name: arcsin(x) IS asin(x), and renders \arcsin exactly as asin does.
 * (A Map, not an object: `'constructor' in {}` is true.)
 */
const FUNC_ALIASES: ReadonlyMap<string, string> = new Map([
  ['arcsin', 'asin'],
  ['arccos', 'acos'],
  ['arctan', 'atan'],
])

/**
 * Functions that take a textbook power written between the name and the
 * argument: sin^2(x) = (sin x)², cos^3 x = (cos x)³. Only a whole-number
 * power is accepted, or −1 — and sin^-1 means arcsin, as every textbook and
 * calculator writes it (never 1/sin, which is csc).
 */
const POWERED: ReadonlySet<string> = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot'])

/** f^-1: the inverse function, for the three that have one here. */
const INVERSE_FN: ReadonlyMap<string, string> = new Map([
  ['sin', 'asin'],
  ['cos', 'acos'],
  ['tan', 'atan'],
])

/** The odd denominators realPow recognises in an exponent: 1/3, 2/5, 4/7 … */
const REAL_ROOT_MAX_Q = 15

/**
 * u^r as a textbook reads it. Math.pow is NaN for a negative base and a
 * non-integer exponent, but x^(1/3) is the cube root and x^(2/3) is (∛x)²
 * on ALL of ℝ in every Precalc book: an exponent that is p/q in lowest terms
 * with q ODD has a real value, (−1)^p · |u|^r. An even q (x^(1/2)) stays
 * undefined for u < 0, and so does an irrational exponent (x^π).
 */
function realPow(u: number, r: number): number {
  const v = Math.pow(u, r)
  if (!(u < 0) || v === v || !Number.isFinite(r)) return v
  for (let q = 3; q <= REAL_ROOT_MAX_Q; q += 2) {
    const pq = r * q
    const pr = Math.round(pq)
    if (Math.abs(pq - pr) > 1e-9 * Math.max(1, Math.abs(pq))) continue
    const m = Math.pow(-u, r)
    return pr % 2 === 0 ? m : -m
  }
  return v
}

/**
 * log_b(u) = ln(u)/ln(b). A base that is not positive, or is 1, has no
 * logarithm: NaN everywhere (a slider passing through b = 1 lifts the pen
 * rather than drawing ±∞). Bases 2 and 10 use the exact library functions,
 * so log_10(1000) is 3 and log_2(8) is 3, not 2.9999999999999996.
 */
function logBase(b: number, u: number): number {
  if (!(b > 0) || b === 1 || !Number.isFinite(b)) return Number.NaN
  if (b === 10) return Math.log10(u)
  if (b === 2) return Math.log2(u)
  return Math.log(u) / Math.log(b)
}

const CONSTS: Record<string, { v: number; latex: string }> = {
  pi:  { v: Math.PI,     latex: '\\pi' },
  tau: { v: 2 * Math.PI, latex: '\\tau' },
  e:   { v: Math.E,      latex: 'e' },
}

type VarName = 'x' | 'y' | 'r' | 'theta' | 't'
const VAR_NAMES: ReadonlySet<string> = new Set(['x', 'y', 'r', 'theta', 't'])
const VAR_LATEX: Record<VarName, string> = { x: 'x', y: 'y', r: 'r', theta: '\\theta', t: 't' }

// ----------------------------------------------------------------------------
// AST
// ----------------------------------------------------------------------------

type Node =
  | { t: 'num'; v: number; raw: string }
  | { t: 'const'; name: keyof typeof CONSTS }
  | { t: 'var'; name: VarName }
  | { t: 'param'; name: string; i: number }
  | { t: 'neg'; a: Node }
  | { t: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Node; b: Node }
  | { t: 'call'; fn: string; args: Node[] }
  | UCallNode

/**
 * A call of a named curve: f(u), f'(u), f''(u). Made only when an env was
 * given AND defines `name` (see Parser.userCall). The node carries the env it
 * was parsed against, so the compiled closure asks the env for f at EVERY
 * evaluation — the model sees f's current formula and sliders, never a copy.
 */
interface UCallNode {
  t: 'ucall'
  name: string
  arg: Node
  /** 0 = f(u), 1 = f′(u), 2 = f″(u) — numeric, from env.eval */
  order: 0 | 1 | 2
  env: FunctionEnv
}

// ----------------------------------------------------------------------------
// Named calls — derivatives of a curve known only through env.eval
// ----------------------------------------------------------------------------

/**
 * Richardson step for f′: the one src/core/calculus.ts uses (eps^(1/5) —
 * truncation O(h⁴) and roundoff O(eps/h) both ≈ 1e-13), scaled to |u|.
 */
const H_UCALL_D1 = Math.pow(Number.EPSILON, 1 / 5)
/** Richardson step for f″: truncation O(h⁴) against roundoff O(eps/h²). */
const H_UCALL_D2 = Math.pow(Number.EPSILON, 1 / 6)

/**
 * f′(u) by Richardson extrapolation of the central difference — four
 * evaluations, no corner test (it runs per sample, hundreds of times a frame;
 * a corner simply shows as the slope jumping). NaN where f is undefined
 * nearby. Exported for ../functionEnv.ts (the horizontal line test).
 */
export function richardsonD1(f: (u: number) => number, u: number): number {
  let h = H_UCALL_D1 * Math.max(1, Math.abs(u))
  const up = u + h
  h = up - u // a step the floating-point grid can actually take
  const d1 = (f(up) - f(u - h)) / (2 * h)
  const d2 = (f(u + h / 2) - f(u - h / 2)) / h
  return (4 * d2 - d1) / 3
}

/** f″(u): Richardson-extrapolated second central difference, five evaluations. */
export function richardsonD2(f: (u: number) => number, u: number): number {
  let h = H_UCALL_D2 * Math.max(1, Math.abs(u))
  const up = u + h
  h = up - u
  const f0 = f(u)
  const k1 = (f(up) - 2 * f0 + f(u - h)) / (h * h)
  const q = h / 2
  const k2 = (f(u + q) - 2 * f0 + f(u - q)) / (q * q)
  return (4 * k2 - k1) / 3
}

function containsUcall(n: Node): boolean {
  switch (n.t) {
    case 'ucall': return true
    case 'neg': return containsUcall(n.a)
    case 'bin': return containsUcall(n.a) || containsUcall(n.b)
    case 'call': return n.args.some(containsUcall)
    default: return false
  }
}

// ----------------------------------------------------------------------------
// Errors
// ----------------------------------------------------------------------------

class ParseError extends Error {
  pos: number | undefined
  constructor(message: string, pos?: number) {
    super(message)
    this.pos = pos
  }
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const prev = new Array<number>(n + 1)
  const cur = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= n; j++) prev[j] = cur[j]
  }
  return prev[n]
}

/** Suggest a known function/constant name at Levenshtein distance <= 1. */
function suggest(word: string): string | null {
  const lower = word.toLowerCase()
  // `log_` is reached only through the subscript syntax, never suggested as a word
  const candidates = [
    ...Object.keys(FUNCS).filter((w) => !w.includes('_')),
    ...FUNC_ALIASES.keys(),
    ...Object.keys(CONSTS),
    'theta',
  ]
  if (lower !== word && candidates.includes(lower)) return lower
  let best: string | null = null
  let bestD = 2
  for (const c of candidates) {
    const d = levenshtein(lower, c)
    if (d < bestD) { bestD = d; best = c }
  }
  return bestD <= 1 ? best : null
}

// ----------------------------------------------------------------------------
// Tokenizer
// ----------------------------------------------------------------------------

function isKnownName(w: string): boolean {
  return has(FUNCS, w) || FUNC_ALIASES.has(w) || has(CONSTS, w) || VAR_NAMES.has(w)
}

type TokType = 'num' | 'ident' | 'op' | 'lparen' | 'rparen' | 'comma' | 'eq' | 'bar' | 'end'
interface Token {
  type: TokType
  text: string
  pos: number
  value: number
  /** f' / f'': the primes after a named curve's letter (only ever set with an env) */
  primes?: 1 | 2
}

/**
 * How many primes follow the letter ending at `j` when they lead straight
 * into '(' — `f'(`, `f''(` — else 0. Three primes, or a space, is not a call.
 */
function primesBeforeParen(src: string, j: number): 0 | 1 | 2 {
  if (src[j] !== "'") return 0
  if (src[j + 1] === '(') return 1
  if (src[j + 1] === "'" && src[j + 2] === '(') return 2
  return 0
}

const NUM_RE = /^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/

/**
 * `callable(letter)` says which single letters may take primes (f'(x)); with
 * none, a prime is the error it always was. `lenient` skips characters the
 * expression grammar does not know ({, <, ;, …) instead of failing — used
 * only by namedCallSites, which reads a whole line, conditions and all.
 */
function tokenize(src: string, callable?: (w: string) => boolean, lenient = false): Token[] {
  const toks: Token[] = []
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    // numbers (decimal + scientific)
    if (/[0-9]/.test(c) || (c === '.' && i + 1 < n && /[0-9]/.test(src[i + 1]))) {
      const m = NUM_RE.exec(src.slice(i))!
      toks.push({ type: 'num', text: m[0], pos: i, value: parseFloat(m[0]) })
      i += m[0].length
      continue
    }
    // identifier runs (ASCII letters, digits allowed after the first letter so
    // that names like log2 lex as one word)
    if (/[A-Za-z]/.test(c)) {
      let j = i
      while (j < n && /[A-Za-z0-9]/.test(src[j])) j++
      const word = src.slice(i, j)
      // log_B: the subscript marks an arbitrary base (log_3, log_(1/2), log_b).
      // The underscore is consumed here; the base is read by the parser.
      if (word === 'log' && src[j] === '_') {
        toks.push({ type: 'ident', text: 'log_', pos: i, value: 0 })
        i = j + 1
        continue
      }
      if (!/[0-9]/.test(word) || isKnownName(word)) {
        // pure letters (parser classifies / errors) or a known digit-bearing
        // name such as log2
        // f'(u), f''(u): a named curve's derivative. Only for a letter the
        // env defines — everywhere else the prime stays an error.
        if (callable && word.length === 1 && !isKnownName(word) && callable(word)) {
          const primes = primesBeforeParen(src, j)
          if (primes > 0) {
            toks.push({ type: 'ident', text: word, pos: i, value: 0, primes: primes as 1 | 2 })
            i = j + primes
            continue
          }
        }
        toks.push({ type: 'ident', text: word, pos: i, value: 0 })
        i = j
        continue
      }
      // digit-bearing unknown word: peel off the longest known prefix
      // ("sin2x" -> sin, "x2" -> x) and re-lex the remainder
      let len = word.length - 1
      for (; len > 1; len--) {
        if (isKnownName(word.slice(0, len))) break
      }
      toks.push({ type: 'ident', text: word.slice(0, len), pos: i, value: 0 })
      i += len
      continue
    }
    // Greek / unicode aliases
    if (c === 'θ') { toks.push({ type: 'ident', text: 'theta', pos: i, value: 0 }); i++; continue }
    if (c === 'π') { toks.push({ type: 'ident', text: 'pi', pos: i, value: 0 }); i++; continue }
    if (c === 'τ') { toks.push({ type: 'ident', text: 'tau', pos: i, value: 0 }); i++; continue }
    // '**' as power
    if (c === '*' && src[i + 1] === '*') { toks.push({ type: 'op', text: '^', pos: i, value: 0 }); i += 2; continue }
    if (c === '+' || c === '-' || c === '*' || c === '/' || c === '^') {
      toks.push({ type: 'op', text: c, pos: i, value: 0 }); i++; continue
    }
    if (c === '·' || c === '×' || c === '∙') { toks.push({ type: 'op', text: '*', pos: i, value: 0 }); i++; continue }
    if (c === '÷') { toks.push({ type: 'op', text: '/', pos: i, value: 0 }); i++; continue }
    if (c === '−') { toks.push({ type: 'op', text: '-', pos: i, value: 0 }); i++; continue }
    if (c === '(') { toks.push({ type: 'lparen', text: c, pos: i, value: 0 }); i++; continue }
    if (c === ')') { toks.push({ type: 'rparen', text: c, pos: i, value: 0 }); i++; continue }
    if (c === ',') { toks.push({ type: 'comma', text: c, pos: i, value: 0 }); i++; continue }
    if (c === '=') { toks.push({ type: 'eq', text: c, pos: i, value: 0 }); i++; continue }
    if (c === '|') { toks.push({ type: 'bar', text: c, pos: i, value: 0 }); i++; continue }
    if (lenient) { i++; continue }
    throw new ParseError(`Unexpected character '${c}' at position ${i}`, i)
  }
  toks.push({ type: 'end', text: '', pos: n, value: 0 })
  return toks
}

// ----------------------------------------------------------------------------
// Pratt parser
// ----------------------------------------------------------------------------

const BP_ADD = 10
const BP_MUL = 20
const BP_UNARY = 25
const BP_POW = 30

class Parser {
  private toks: Token[]
  private k = 0
  private barDepth = 0
  paramIndex = new Map<string, number>()
  paramNames: string[] = []
  private env: FunctionEnv | null
  /** the name this line defines (`g` of `g(x) = …`) when the env has it */
  private selfName: string | null
  /** true when token 0 is that definition's head, `g` of `g(x) =` */
  private headAtStart: boolean

  /**
   * `env` turns `f(u)` into a call of the named curve f (see userCall).
   * `self` is the name the line defines: its head (token 0, when
   * `headAtStart`) parses as it always has; any other `self(` is an error.
   */
  constructor(
    src: string,
    env?: FunctionEnv | null,
    self?: { name: string; headAtStart: boolean } | null,
  ) {
    this.env = env ?? null
    this.selfName = self?.name ?? null
    this.headAtStart = self?.headAtStart ?? false
    const e = this.env
    this.toks = tokenize(src, e ? (w) => envHas(e, w) : undefined)
  }

  private peek(): Token { return this.toks[this.k] }
  private next(): Token { return this.toks[this.k++] }

  private fail(tok: Token, what?: string): never {
    if (tok.type === 'end') {
      throw new ParseError(
        what ? `Unexpected end of input — ${what}` : 'Unexpected end of input',
        tok.pos,
      )
    }
    throw new ParseError(
      what
        ? `Expected ${what} but found '${tok.text}' at position ${tok.pos}`
        : `Unexpected '${tok.text}' at position ${tok.pos}`,
      tok.pos,
    )
  }

  private registerParam(name: string): Node {
    let i = this.paramIndex.get(name)
    if (i === undefined) {
      i = this.paramNames.length
      this.paramIndex.set(name, i)
      this.paramNames.push(name)
    }
    return { t: 'param', name, i }
  }

  /** Can this token begin an expression? (used for implicit multiplication) */
  private startsExpr(tok: Token): boolean {
    switch (tok.type) {
      case 'num':
      case 'ident':
      case 'lparen':
        return true
      case 'bar':
        return this.barDepth === 0 // inside |...| a bar always closes
      default:
        return false
    }
  }

  // ---- nud: parse a prefix/atomic expression ------------------------------
  private nud(): Node {
    const tok = this.next()
    switch (tok.type) {
      case 'num':
        return { t: 'num', v: tok.value, raw: tok.text }

      case 'ident':
        return this.identNud(tok)

      case 'lparen': {
        const e = this.parseExpr(0)
        const close = this.peek()
        if (close.type !== 'rparen') this.fail(close, "')'")
        this.next()
        return e
      }

      case 'bar': {
        this.barDepth++
        const e = this.parseExpr(0)
        const close = this.peek()
        if (close.type !== 'bar') {
          if (close.type === 'end') throw new ParseError("Missing closing '|' for absolute value", close.pos)
          this.fail(close, "closing '|'")
        }
        this.next()
        this.barDepth--
        return { t: 'call', fn: 'abs', args: [e] }
      }

      case 'op':
        if (tok.text === '-') return { t: 'neg', a: this.parseExpr(BP_UNARY) }
        if (tok.text === '+') return this.parseExpr(BP_UNARY)
        this.fail(tok)
        break

      default:
        this.fail(tok)
    }
    // unreachable
    throw new ParseError('internal parser error', tok.pos)
  }

  /**
   * `log_B(u)`, after the `log_` token. B is one of
   *   a number literal     log_3(x), log_10(x), log_2.5(x)
   *   a constant or letter log_e(x) (= ln), log_pi(x), log_b(x) (a slider)
   *   a parenthesised constant expression   log_(1/2)(x), log_(sqrt(2))(x)
   * and must not depend on the variable. The argument is parenthesised, or
   * paren-less exactly like `ln x`: `log_2 x` = log₂(x), `log_2 3x` = log₂(3x),
   * `log_2 x + 1` = log₂(x) + 1 — the digits after `_` are always the whole
   * base, so `log_2x` is log₂(x) too. `log_(B, u)` (one pair of parentheses,
   * a comma) is the same call, and is how the AST prints back as source.
   */
  private logBaseNud(tok: Token): Node {
    const at = this.peek()
    const needBase = (): never => {
      throw new ParseError(
        `'log_' needs a base, e.g. log_2(x) or log_(1/2)(x)`,
        at.type === 'end' ? tok.pos : at.pos,
      )
    }
    let base: Node
    let args: Node[] | null = null
    switch (at.type) {
      case 'num':
        this.next()
        base = { t: 'num', v: at.value, raw: at.text }
        break
      case 'ident': {
        const w = at.text
        if (VAR_NAMES.has(w)) {
          this.next()
          base = { t: 'var', name: w as VarName }
        } else if (has(CONSTS, w)) {
          this.next()
          base = { t: 'const', name: w as keyof typeof CONSTS }
        } else if (w.length === 1 && !(has(FUNCS, w))) {
          this.next()
          base = this.registerParam(w)
        } else {
          throw new ParseError(
            `Put a longer base in parentheses, e.g. log_(${w === 'sqrt' ? 'sqrt(2)' : w})(x)`,
            at.pos,
          )
        }
        break
      }
      case 'lparen': {
        this.next()
        base = this.parseExpr(0)
        if (this.peek().type === 'comma') {
          // log_(B, u)
          this.next()
          args = [base, this.parseExpr(0)]
        }
        const close = this.peek()
        if (close.type !== 'rparen') this.fail(close, "')'")
        this.next()
        break
      }
      case 'op':
        if (at.text === '-') {
          throw new ParseError('The base of a logarithm must be a positive number, e.g. log_2(x)', at.pos)
        }
        return needBase()
      default:
        return needBase()
    }
    const vars = new Set<VarName>()
    collectVars(base, vars)
    if (vars.size > 0) {
      const v = [...vars][0]
      throw new ParseError(
        `The base of a logarithm must be a number — it cannot depend on ${v === 'theta' ? 'θ' : v}`,
        at.pos,
      )
    }
    if (!args) {
      const nxt = this.peek()
      let arg: Node
      if (nxt.type === 'lparen') {
        this.next()
        arg = this.parseExpr(0)
        const close = this.peek()
        if (close.type === 'comma') {
          throw new ParseError(`'log_' takes one argument — unexpected ',' at position ${close.pos}`, close.pos)
        }
        if (close.type !== 'rparen') this.fail(close, "')'")
        this.next()
      } else if (this.startsExpr(nxt) || (nxt.type === 'op' && (nxt.text === '-' || nxt.text === '+'))) {
        // paren-less application binds a full product, stops at + / − (as ln x)
        arg = this.parseExpr(BP_ADD)
      } else {
        throw new ParseError(`A logarithm needs an argument, e.g. log_2(x)`, nxt.pos)
      }
      args = [base, arg]
    }
    // log_e is ln: one function, one spelling on the card
    if (args[0].t === 'const' && args[0].name === 'e') return { t: 'call', fn: 'ln', args: [args[1]] }
    return { t: 'call', fn: 'log_', args }
  }

  /**
   * `name(args)` or paren-less `name u`, after the function's name. `typed` is
   * the name as written (for messages: arcsin, not asin), `w` the FUNCS key.
   */
  private applyFunc(tok: Token, typed: string, w: string): Node {
    const fdef = FUNCS[w]
    if (this.peek().type === 'lparen') {
      this.next()
      const args: Node[] = [this.parseExpr(0)]
      if (fdef.arity === 2) {
        const comma = this.peek()
        if (comma.type !== 'comma') this.fail(comma, `',' ('${typed}' takes two arguments)`)
        this.next()
        args.push(this.parseExpr(0))
      }
      const close = this.peek()
      if (close.type === 'comma') {
        throw new ParseError(
          `'${typed}' takes ${fdef.arity === 1 ? 'one argument' : 'two arguments'} — unexpected ',' at position ${close.pos}`,
          close.pos,
        )
      }
      if (close.type !== 'rparen') this.fail(close, "')'")
      this.next()
      return { t: 'call', fn: w, args }
    }
    if (fdef.arity === 2) {
      throw new ParseError(`'${typed}' needs parentheses, e.g. ${typed}(a, b)`, tok.pos)
    }
    // paren-less application: binds a full product, stops at + / -
    const nxt = this.peek()
    if (!this.startsExpr(nxt) && !(nxt.type === 'op' && (nxt.text === '-' || nxt.text === '+'))) {
      throw new ParseError(`'${typed}' needs an argument, e.g. ${typed}(x)`, tok.pos)
    }
    const arg = this.parseExpr(BP_ADD)
    return { t: 'call', fn: w, args: [arg] }
  }

  /**
   * The textbook power of a trig function, after its name: `sin^2(x)`,
   * `cos^3 x`, `tan^(2)(x)` are (sin x)², (cos x)³, (tan x)² — the same AST
   * as sin(x)^2, so the card prints it that way. `sin^-1(x)` and
   * `sin^(-1)(x)` are arcsin, as a textbook and a calculator mean it (never
   * 1/sin x, which is csc x). The power must be a whole number ≥ 1, or −1 for
   * sin, cos and tan; anything else is refused with a message saying how to
   * write it instead. Before this, `sin^2(x)` was an error ("'sin' needs an
   * argument"), so nothing that parsed changes meaning.
   */
  private poweredNud(tok: Token, w: string): Node {
    const caret = this.next() // '^'
    const name = tok.text
    const asPower = `(${name}(x))^2`
    let t = this.peek()
    const paren = t.type === 'lparen'
    if (paren) { this.next(); t = this.peek() }
    let negative = false
    if (t.type === 'op' && t.text === '-') { negative = true; this.next(); t = this.peek() }
    if (t.type !== 'num' || !/^\d+$/.test(t.text)) {
      throw new ParseError(
        `Only a whole-number power can go between '${name}' and its argument, as in ${name}^2(x) — ` +
          `otherwise put the power after the argument, e.g. ${asPower}`,
        caret.pos,
      )
    }
    this.next()
    if (paren) {
      const close = this.peek()
      if (close.type !== 'rparen') this.fail(close, "')'")
      this.next()
    }
    const n = Number(t.text)
    if (negative) {
      const inv = INVERSE_FN.get(w)
      if (n !== 1) {
        throw new ParseError(
          `${name}^-${t.text} is ambiguous — write the power after the argument, e.g. (${name}(x))^(-${t.text})`,
          caret.pos,
        )
      }
      if (!inv) {
        throw new ParseError(
          `${name}^-1 (the inverse of ${name}) is not available — write e.g. ${w === 'sec' ? 'acos(1/x)' : w === 'csc' ? 'asin(1/x)' : 'atan(1/x)'}, ` +
            `or (${name}(x))^(-1) for 1/${name}(x)`,
          caret.pos,
        )
      }
      return this.applyFunc(tok, `${name}^-1`, inv)
    }
    if (n === 0) {
      throw new ParseError(`${name}^0 is just 1 — write the power after the argument if you mean it: (${name}(x))^0`, caret.pos)
    }
    const call = this.applyFunc(tok, `${name}^${t.text}`, w)
    if (n === 1) return call
    return { t: 'bin', op: '^', a: call, b: { t: 'num', v: n, raw: t.text } }
  }

  /**
   * `f(u)`, `f'(u)`, `f''(u)` for a curve the env defines, after its letter.
   * The '(' must follow the letter (or its primes) directly: `f (x)` stays
   * the product f·x, as it always was. One argument, any expression —
   * f(g(x)), f(2x), f(x − 1) — and the call is an atom, so f(x)^2, 2f(x) and
   * f(x)g(x) mean what they say.
   */
  private userCall(tok: Token): Node {
    const name = tok.text
    const order = tok.primes ?? 0
    const typed = `${name}${"'".repeat(order)}`
    this.next() // '('
    const arg = this.parseExpr(0)
    const close = this.peek()
    if (close.type === 'comma') {
      throw new ParseError(`'${typed}' takes one argument — unexpected ',' at position ${close.pos}`, close.pos)
    }
    if (close.type !== 'rparen') this.fail(close, "')'")
    this.next()
    return { t: 'ucall', name, arg, order, env: this.env! }
  }

  /** Is `tok` a named call — an env letter with '(' right after it (and its primes)? */
  private isUserCall(tok: Token): boolean {
    if (!this.env || tok.text.length !== 1 || isKnownName(tok.text)) return false
    if (!envHas(this.env, tok.text)) return false
    const nxt = this.peek()
    return nxt.type === 'lparen' && nxt.pos === tok.pos + 1 + (tok.primes ?? 0)
  }

  private identNud(tok: Token): Node {
    if (tok.text === 'log_') return this.logBaseNud(tok)
    if (this.isUserCall(tok)) {
      const isHead = this.headAtStart && this.k === 1 && tok.primes === undefined
      if (tok.text === this.selfName && !isHead) {
        const n = tok.text
        throw new ParseError(
          `${n} cannot use itself — this line defines ${n}, so its own formula cannot call ${n} (at position ${tok.pos})`,
          tok.pos,
        )
      }
      if (!isHead) return this.userCall(tok)
    }
    // arcsin → asin: the AST only ever carries the one name
    const w = FUNC_ALIASES.get(tok.text) ?? tok.text
    const fdef = has(FUNCS, w) ? FUNCS[w] : undefined
    if (fdef) {
      const nxt = this.peek()
      if (POWERED.has(w) && nxt.type === 'op' && nxt.text === '^') return this.poweredNud(tok, w)
      return this.applyFunc(tok, tok.text, w)
    }
    if (VAR_NAMES.has(w)) return { t: 'var', name: w as VarName }
    if (has(CONSTS, w)) return { t: 'const', name: w as keyof typeof CONSTS }
    if (w.length === 1) return this.registerParam(w)
    // "xy" (and "yx", "x2y" won't reach here) in a conic such as
    // x² + xy + y² = 3 is the product x·y, as every textbook writes it.
    // Only words made of the variables x and y are split; anything else
    // stays the error it was, so no name that parsed before changes.
    if (/^[xy]{2,4}$/.test(w)) {
      let node: Node = { t: 'var', name: w[0] as VarName }
      for (let i = 1; i < w.length; i++) {
        node = { t: 'bin', op: '*', a: node, b: { t: 'var', name: w[i] as VarName } }
      }
      return node
    }
    const s = suggest(w)
    if (s) {
      throw new ParseError(`Unknown function '${w}' — did you mean '${s}'?`, tok.pos)
    }
    throw new ParseError(
      `Unknown name '${w}' at position ${tok.pos} — multi-letter names aren't supported (use single letters like a, b, k for constants)`,
      tok.pos,
    )
  }

  // ---- precedence-climbing loop -------------------------------------------
  parseExpr(minBP: number): Node {
    let left = this.nud()
    for (;;) {
      const tok = this.peek()
      let bp = 0
      let op: '+' | '-' | '*' | '/' | '^' | null = null
      let rightAssoc = false
      let implicit = false

      if (tok.type === 'op') {
        if (tok.text === '+' || tok.text === '-') { bp = BP_ADD; op = tok.text }
        else if (tok.text === '*' || tok.text === '/') { bp = BP_MUL; op = tok.text }
        else if (tok.text === '^') { bp = BP_POW; op = '^'; rightAssoc = true }
      } else if (this.startsExpr(tok)) {
        bp = BP_MUL; op = '*'; implicit = true // juxtaposition: 2x, x y, (a)(b), 2|x|
      }

      if (op === null || bp <= minBP) return left
      if (!implicit) this.next()
      const right = this.parseExpr(rightAssoc ? bp - 1 : bp)
      left = { t: 'bin', op, a: left, b: right }
    }
  }

  /** Parse the whole input: expr ( '=' expr )? end */
  parseInput(): { lhs: Node; rhs: Node | null } {
    const lhs = this.parseExpr(0)
    let rhs: Node | null = null
    if (this.peek().type === 'eq') {
      this.next()
      rhs = this.parseExpr(0)
    }
    const end = this.peek()
    if (end.type !== 'end') {
      if (end.type === 'eq') {
        throw new ParseError(`Only one '=' is allowed — unexpected '=' at position ${end.pos}`, end.pos)
      }
      this.fail(end)
    }
    return { lhs, rhs }
  }
}

// ----------------------------------------------------------------------------
// Analysis helpers
// ----------------------------------------------------------------------------

function collectVars(n: Node, out: Set<VarName>): void {
  switch (n.t) {
    case 'var': out.add(n.name); break
    case 'neg': collectVars(n.a, out); break
    case 'bin': collectVars(n.a, out); collectVars(n.b, out); break
    case 'call': for (const a of n.args) collectVars(a, out); break
    case 'ucall': collectVars(n.arg, out); break
    default: break
  }
}

const isVar = (n: Node, name: VarName): boolean => n.t === 'var' && n.name === name

function countParam(n: Node, name: string): number {
  switch (n.t) {
    case 'param': return n.name === name ? 1 : 0
    case 'neg': return countParam(n.a, name)
    case 'bin': return countParam(n.a, name) + countParam(n.b, name)
    case 'call': {
      let c = 0
      for (const a of n.args) c += countParam(a, name)
      return c
    }
    case 'ucall': return countParam(n.arg, name)
    default: return 0
  }
}

/**
 * Renumber `param` slots by first textual appearance within `n` (pre-order walk
 * matches source order), returning the new name list. Used after a free
 * constant is removed from the parse, so the remaining indices stay dense and
 * aligned with the reported paramNames.
 */
function reindexParams(n: Node, names: string[] = [], index = new Map<string, number>()): string[] {
  switch (n.t) {
    case 'param': {
      let i = index.get(n.name)
      if (i === undefined) { i = names.length; index.set(n.name, i); names.push(n.name) }
      n.i = i
      break
    }
    case 'neg': reindexParams(n.a, names, index); break
    case 'bin': reindexParams(n.a, names, index); reindexParams(n.b, names, index); break
    case 'call': for (const a of n.args) reindexParams(a, names, index); break
    case 'ucall': reindexParams(n.arg, names, index); break
    default: break
  }
  return names
}

/**
 * Recognize function-definition notation: `<single letter>(<variable>) = <expr>`,
 * e.g. "f(x) = x^2", "g(t) = 2t+1". The tokenizer sees the head as an implicit
 * product (param `f` times variable `x`), so without this the equation would be
 * plotted as the implicit relation f·x = x², with `f` as a slider — a
 * confidently wrong graph. We instead drop the head and plot the body, which is
 * what the notation means.
 *
 * Deliberately narrow, to avoid stealing legitimate slider expressions:
 *  - only the LHS head position (so `y = f(x)` still means y = f·x),
 *  - the LHS must be exactly `param * var` (so `a(x+1) = 3` and `2f(x) = x` are
 *    untouched),
 *  - the letter must not occur anywhere else (so `a(x) = a + x`, genuinely
 *    ambiguous, keeps its slider reading).
 */
function matchFuncDef(
  lhs: Node,
  rhs: Node | null,
): { head: string; boundVar: VarName; body: Node } | null {
  if (rhs === null) return null
  if (lhs.t !== 'bin' || lhs.op !== '*') return null
  const head = lhs.a
  const arg = lhs.b
  if (head.t !== 'param' || arg.t !== 'var') return null
  if (countParam(rhs, head.name) > 0) return null
  return {
    head: `${head.name}${wrap(VAR_LATEX[arg.name])}`,
    boundVar: arg.name,
    body: rhs,
  }
}

// ----------------------------------------------------------------------------
// Closure compiler: AST -> (params, a, b) => number
//   slot `a` carries the independent variable (x, theta, or t); slot `b` = y.
// ----------------------------------------------------------------------------

type Evaluator = (p: readonly number[], a: number, b: number) => number

function compile(n: Node): Evaluator {
  switch (n.t) {
    case 'num': { const v = n.v; return () => v }
    case 'const': { const v = CONSTS[n.name].v; return () => v }
    case 'var':
      return n.name === 'y' ? (_p, _a, b) => b : (_p, a) => a
    case 'param': { const i = n.i; return (p) => p[i] }
    case 'neg': { const f = compile(n.a); return (p, a, b) => -f(p, a, b) }
    case 'bin': {
      const f = compile(n.a)
      const g = compile(n.b)
      switch (n.op) {
        case '+': return (p, a, b) => f(p, a, b) + g(p, a, b)
        case '-': return (p, a, b) => f(p, a, b) - g(p, a, b)
        case '*': return (p, a, b) => f(p, a, b) * g(p, a, b)
        case '/': return (p, a, b) => f(p, a, b) / g(p, a, b)
        case '^': {
          if (n.b.t === 'num') {
            const e = n.b.v
            if (e === 2) return (p, a, b) => { const u = f(p, a, b); return u * u }
            if (e === 3) return (p, a, b) => { const u = f(p, a, b); return u * u * u }
            if (e === 0.5) return (p, a, b) => Math.sqrt(f(p, a, b))
          }
          return (p, a, b) => realPow(f(p, a, b), g(p, a, b))
        }
      }
      break
    }
    case 'call': {
      const def = FUNCS[n.fn]
      const fn = def.fn
      if (def.arity === 2) {
        const f = compile(n.args[0])
        const g = compile(n.args[1])
        return (p, a, b) => fn(f(p, a, b), g(p, a, b))
      }
      const f = compile(n.args[0])
      return (p, a, b) => fn(f(p, a, b), 0)
    }
    case 'ucall': {
      // Asked of the env at every evaluation: g follows f's slider live.
      const inner = compile(n.arg)
      const env = n.env
      const name = n.name
      const at = (u: number): number => {
        const v = env.eval(name, u)
        return typeof v === 'number' ? v : Number.NaN
      }
      if (n.order === 0) return (p, a, b) => at(inner(p, a, b))
      if (n.order === 1) return (p, a, b) => richardsonD1(at, inner(p, a, b))
      return (p, a, b) => richardsonD2(at, inner(p, a, b))
    }
  }
  throw new ParseError('internal compile error')
}

// ----------------------------------------------------------------------------
// Singularities — where the formula is UNDEFINED as written
//
// Collected ONCE, at compile time, by walking the AST: every denominator, the
// cos/sin whose zeros are a tan/sec/cot/csc pole, and the base of a negative
// power. Each becomes a compiled evaluator q(params, x); the singular x are
// the zeros of q. Points the teacher excluded with `{x != c}` are carried
// alongside as exact values — the exclusion is a real singularity of the
// written formula, not only a note on the equation.
//
// At call time each q is scanned over the requested range (SING_SAMPLES + 1
// samples), sign changes are bisected, and a q that TOUCHES zero without
// changing sign (x² in 1/x²) is caught by refining the minima of |q|. The
// result is sorted, deduplicated and memoised on (params, range): the renderer
// asks per frame.
//
// Sorting holes from poles is src/core/holes.ts's job — this only says where
// the formula stops being a formula.
// ----------------------------------------------------------------------------

/** Samples used to bracket the zeros of one denominator. */
const SING_SAMPLES = 512

/** Two singular points closer than this (relative) are the same point. */
const SING_DEDUPE = 1e-9

/**
 * tan and sec blow up where cos(arg) = 0; cot and csc where sin(arg) = 0.
 * (Only `tan` is in FUNCS today; the others are listed so that adding them is
 * a one-line change here rather than a forgotten case.)
 */
const TRIG_POLE: Record<string, 'cos' | 'sin'> = {
  tan: 'cos', sec: 'cos',
  cot: 'sin', csc: 'sin',
}

/**
 * A logarithm is undefined where its argument is zero, and runs to −∞ there:
 * the zeros of g are singularities of ln(g) exactly as they are of 1/g. The
 * base changes nothing — it only scales the logarithm by a constant.
 */
const LOG_ARG: ReadonlySet<string> = new Set(['ln', 'log', 'log2', 'log10', 'log_'])

/** The argument of a logarithm call (log_B(u) carries [B, u]). */
const logArgOf = (n: { fn: string; args: Node[] }): Node => (n.fn === 'log_' ? n.args[1] : n.args[0])

/** One sub-expression whose zeros are singular, and where they may lie. */
interface SingSource {
  q: Evaluator
  /** null = anywhere; otherwise only zeros this piecewise branch owns count */
  within: Piece[] | null
  /** q calls a named curve, so its zeros move when that curve changes */
  live?: boolean
  /**
   * Set for a named call f(u), f′(u), f″(u): q is then the ARGUMENT u, and the
   * singular x are where u(x) hits one of f's own singular values (asked of
   * env.singularities) — not the zeros of q.
   */
  call?: CallSing
}

/** A named call's singularities, mapped back through its argument. */
interface CallSing {
  name: string
  env: FunctionEnv
  /** u = a·x + b with a, b free of x: solved exactly, no scan */
  linear: boolean
}

/** Everything a compiled expression knows about its own singularities. */
interface SingPlan {
  sources: SingSource[]
  /** x values removed by an explicit `{x != c}` — exact, no scanning needed */
  exclusions: number[]
}

const emptySingPlan = (): SingPlan => ({ sources: [], exclusions: [] })

/** True for a literal negative exponent, written `-2` or `(-2)`. */
function negativeExponent(n: Node): boolean {
  if (n.t === 'num') return n.v < 0
  if (n.t === 'neg') return n.a.t === 'num' && n.a.v > 0
  return false
}

/**
 * Walk the AST once, compiling every sub-expression whose zeros are singular.
 *
 * A named call f(u) — and f′(u), f″(u), which are undefined wherever f is —
 * contributes f's OWN singular values s (poles, holes, exclusions, vertical
 * asymptotes), asked of env.singularities at scan time, mapped back through
 * the argument: the x where u(x) = s. So g(x) = 2f(x − 1) + 3 with f = 1/x
 * reports its asymptote at x = 1. An env without `singularities` makes the
 * call contribute nothing of its own (and adds no source, so such a plan is
 * exactly what it was before). The argument is walked as well, so f(1/x) is
 * singular at 0 and f(g(x)) collects g's own set through the inner call; a
 * named call INSIDE a written denominator, tan or logarithm counts as usual —
 * 1/f(x) is singular where f(x) = 0.
 */
function collectSingSources(n: Node, within: Piece[] | null, out: SingSource[]): void {
  const push = (m: Node, q: Evaluator): void => {
    out.push(containsUcall(m) ? { q, within, live: true } : { q, within })
  }
  switch (n.t) {
    case 'ucall':
      if (typeof n.env.singularities === 'function') {
        const shape = affineShape(n.arg)
        // a constant argument (f(2)) is singular everywhere or nowhere: no x
        if (shape !== 'const') {
          out.push({
            q: compile(n.arg),
            within,
            live: true,
            call: { name: n.name, env: n.env, linear: shape === 'lin' },
          })
        }
      }
      collectSingSources(n.arg, within, out)
      break
    case 'neg':
      collectSingSources(n.a, within, out)
      break
    case 'bin':
      if (n.op === '/') {
        push(n.b, compile(n.b))
      } else if (n.op === '^' && negativeExponent(n.b)) {
        // x^-2 is 1/x²: the base is a denominator wearing a different hat
        push(n.a, compile(n.a))
      }
      collectSingSources(n.a, within, out)
      collectSingSources(n.b, within, out)
      break
    case 'call': {
      const trig = TRIG_POLE[n.fn]
      if (trig) {
        const inner = compile(n.args[0])
        const g = trig === 'cos' ? Math.cos : Math.sin
        push(n.args[0], (p, a, b) => g(inner(p, a, b)))
      } else if (LOG_ARG.has(n.fn)) {
        // ln(x² − 4) stops being a formula where x² − 4 does: at ±2, where it
        // dives to −∞. The argument is a denominator wearing a third hat.
        push(logArgOf(n), compile(logArgOf(n)))
      }
      for (const arg of n.args) collectSingSources(arg, within, out)
      break
    }
    default:
      break
  }
}

/**
 * How an expression depends on the scanned variable (slot a: x, θ or t):
 * 'const' — not at all; 'lin' — a·x + b with a, b free of it; null — any
 * other way (or through y, or through a named call of it). Conservative: a
 * linear expression written unusually ((x + 1)^1) is null and simply gets
 * the scan instead of the closed form.
 */
function affineShape(n: Node): 'const' | 'lin' | null {
  switch (n.t) {
    case 'num':
    case 'const':
    case 'param':
      return 'const'
    case 'var':
      return n.name === 'y' ? null : 'lin'
    case 'neg':
      return affineShape(n.a)
    case 'bin': {
      const a = affineShape(n.a)
      const b = affineShape(n.b)
      if (a === null || b === null) return null
      switch (n.op) {
        case '+':
        case '-':
          return a === 'lin' || b === 'lin' ? 'lin' : 'const'
        case '*':
          if (a === 'const') return b
          if (b === 'const') return a
          return null
        case '/':
          return b === 'const' ? a : null
        case '^':
          return a === 'const' && b === 'const' ? 'const' : null
      }
      return null
    }
    case 'call':
      return n.args.every((m) => affineShape(m) === 'const') ? 'const' : null
    case 'ucall':
      return affineShape(n.arg) === 'const' ? 'const' : null
  }
  return null
}

/** The singularity plan for one explicit body, unrestricted. */
function singPlanOf(body: Node | null): SingPlan {
  const plan = emptySingPlan()
  if (body) collectSingSources(body, null, plan.sources)
  return plan
}

type Scalar = (x: number) => number

/** Bisect q to a zero inside a bracket it changes sign across. */
function bisectSingular(q: Scalar, a: number, b: number): number | null {
  let lo = a
  let hi = b
  let flo = q(lo)
  let fhi = q(hi)
  if (!Number.isFinite(flo) || !Number.isFinite(fhi)) return null
  if (flo === 0) return lo
  if (fhi === 0) return hi
  if (flo > 0 === fhi > 0) return null
  for (let i = 0; i < 80; i++) {
    const m = 0.5 * (lo + hi)
    if (m === lo || m === hi) break
    const fm = q(m)
    if (!Number.isFinite(fm)) return null
    if (fm === 0) return m
    if (fm > 0 === flo > 0) { lo = m; flo = fm } else { hi = m; fhi = fm }
  }
  return snapSingular(q, 0.5 * (lo + hi), lo, hi)
}

/**
 * The simplest number in [lo, hi] that q likes at least as much as `m`.
 *
 * Bisection lands within an ulp of the root; a teacher typed a number. Taking
 * the round number back turns 0.9999999999999998 into exactly 1 — which is
 * what lets the hole be reported at the x that was written, and what lets
 * src/core/holes.ts call it exact.
 */
function snapSingular(q: Scalar, m: number, lo: number, hi: number): number {
  const a = Math.min(lo, hi)
  const b = Math.max(lo, hi)
  const best = Math.abs(q(m))
  const better = (c: number): boolean => {
    const v = Math.abs(q(c))
    return Number.isFinite(v) && (v <= best || !Number.isFinite(best))
  }
  if (a <= 0 && b >= 0 && better(0)) return 0
  for (let p = 1; p <= 15; p++) {
    const c = Number(m.toPrecision(p))
    if (c >= a && c <= b && better(c)) return c
  }
  return m
}

/** Golden-section minimum of |q| on [a, b] — derivative free. */
function goldenMinAbs(q: Scalar, a: number, b: number): number {
  const phi = 0.6180339887498949
  let lo = a
  let hi = b
  let x1 = hi - (hi - lo) * phi
  let x2 = lo + (hi - lo) * phi
  let f1 = Math.abs(q(x1))
  let f2 = Math.abs(q(x2))
  for (let i = 0; i < 80; i++) {
    if (!Number.isFinite(f1) || !Number.isFinite(f2)) break
    if (f1 < f2) {
      hi = x2; x2 = x1; f2 = f1
      x1 = hi - (hi - lo) * phi
      f1 = Math.abs(q(x1))
    } else {
      lo = x1; x1 = x2; f1 = f2
      x2 = lo + (hi - lo) * phi
      f2 = Math.abs(q(x2))
    }
    if (hi - lo < 1e-15 * Math.max(1, Math.abs(lo))) break
  }
  return 0.5 * (lo + hi)
}

/** Every zero of q in [lo, hi] — sign changes AND the ones that only touch. */
function scanSingularZeros(q: Scalar, lo: number, hi: number, out: number[]): void {
  const n = SING_SAMPLES
  const step = (hi - lo) / n
  const xs = new Array<number>(n + 1)
  const ys = new Array<number>(n + 1)
  for (let i = 0; i <= n; i++) {
    const x = i === n ? hi : lo + i * step
    xs[i] = x
    ys[i] = q(x)
  }
  scanSampledZeros(q, xs, ys, out)
}

/** scanSingularZeros on samples already taken: ys[i] = q(xs[i]). */
function scanSampledZeros(q: Scalar, xs: number[], ys: number[], out: number[]): void {
  const n = xs.length - 1
  const mags: number[] = []
  for (let i = 0; i <= n; i++) {
    const v = ys[i]
    if (Number.isFinite(v)) mags.push(Math.abs(v))
  }
  if (mags.length === 0) return
  mags.sort((p, r) => p - r)
  // the curve's own magnitude, so "close to zero" means close relative to it
  const qScale = Math.max(mags[Math.min(mags.length - 1, Math.floor(0.75 * mags.length))], 1e-300)
  const touchTol = 1e-10 * qScale

  for (let i = 0; i <= n; i++) {
    if (ys[i] === 0) out.push(xs[i])
  }
  for (let i = 0; i < n; i++) {
    const ya = ys[i]
    const yb = ys[i + 1]
    if (!Number.isFinite(ya) || !Number.isFinite(yb)) continue
    if (ya === 0 || yb === 0) continue // already taken, exactly
    if (ya > 0 === yb > 0) continue
    const r = bisectSingular(q, xs[i], xs[i + 1])
    if (r !== null) out.push(r)
  }
  // A denominator that only TOUCHES zero (x² in 1/x²) never changes sign, so
  // the scan above cannot see it. Look for minima of |q| that are not a
  // crossing, refine them, and accept only a genuine zero.
  for (let i = 1; i < n; i++) {
    const a = ys[i - 1]
    const b = ys[i]
    const c = ys[i + 1]
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) continue
    if (a === 0 || b === 0 || c === 0) continue
    if (a > 0 !== c > 0) continue // a crossing — the sign-change scan has it
    const pa = Math.abs(a), pb = Math.abs(b), pc = Math.abs(c)
    if (!(pb <= pa && pb <= pc) || (pb === pa && pb === pc)) continue
    const xm = goldenMinAbs(q, xs[i - 1], xs[i + 1])
    const v = q(xm)
    if (!Number.isFinite(v) || Math.abs(v) > touchTol) continue
    out.push(snapSingular(q, xm, xs[i - 1], xs[i + 1]))
  }
}

/**
 * More singular values of a called curve than this in the image of its
 * argument (tan called with e^x) and the call reports none: a list that
 * long is a smear at any zoom, and scanning it would be the frame budget.
 */
const SING_CALL_MAX = 2000

/** env.singularities, guarded: a throwing or odd env reports nothing. */
function envSingularities(c: CallSing, lo: number, hi: number): number[] {
  let r: unknown
  try { r = c.env.singularities!(c.name, [lo, hi]) } catch { return [] }
  if (!Array.isArray(r)) return []
  return r.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
}

/**
 * The x in [lo, hi] where a named call f(u) is undefined: u(x) = s for each
 * singular value s of f. `u` is the call's argument at the current params.
 *
 * Linear u (x − 1, 2x, (x + 3)/a) is solved in closed form, x = (s − b)/a.
 * Anything else is sampled once (SING_SAMPLES + 1 points, which also gives
 * the image of u to ask f about) and each u − s is scanned on those samples
 * exactly as a denominator is — sign changes bisected, touches refined. A
 * "crossing" that is really u jumping across s at its own pole is dropped:
 * u there is nowhere near s (u's pole is reported by u's own sources).
 */
function callSingularities(c: CallSing, u: Scalar, lo: number, hi: number, out: number[]): void {
  if (c.linear) {
    const b = u(0)
    const a = u(1) - b
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return
    const ua = a * lo + b
    const ub = a * hi + b
    const uLo = Math.min(ua, ub)
    const uHi = Math.max(ua, ub)
    const pad = 1e-9 * Math.max(1, Math.abs(uLo), Math.abs(uHi))
    const ss = envSingularities(c, uLo - pad, uHi + pad)
    if (ss.length > SING_CALL_MAX) return
    for (const s of ss) {
      const x = (s - b) / a
      if (!Number.isFinite(x)) continue
      const tol = 1e-12 * Math.max(1, Math.abs(x))
      out.push(snapSingular((t) => u(t) - s, x, x - tol, x + tol))
    }
    return
  }

  const n = SING_SAMPLES
  const step = (hi - lo) / n
  const xs = new Array<number>(n + 1)
  const us = new Array<number>(n + 1)
  let uLo = Infinity
  let uHi = -Infinity
  for (let i = 0; i <= n; i++) {
    const x = i === n ? hi : lo + i * step
    xs[i] = x
    const v = u(x)
    us[i] = v
    if (Number.isFinite(v)) {
      if (v < uLo) uLo = v
      if (v > uHi) uHi = v
    }
  }
  if (!(uHi > uLo)) return // u never moves (or is never defined): no x to name
  // samples can step over an extremum of u; the touch scan finds it exactly
  const pad = 0.02 * (uHi - uLo)
  const ss = envSingularities(c, uLo - pad, uHi + pad)
  if (ss.length > SING_CALL_MAX) return
  const ys = new Array<number>(n + 1)
  for (const s of ss) {
    const q: Scalar = (x) => u(x) - s
    for (let i = 0; i <= n; i++) ys[i] = us[i] - s
    const found: number[] = []
    scanSampledZeros(q, xs, ys, found)
    const tol = 1e-6 * Math.max(1, Math.abs(s))
    for (const r of found) {
      const v = q(r)
      if (Number.isFinite(v) && Math.abs(v) <= tol) out.push(r)
    }
  }
}

/** True when `x` is a number somebody could have written down. */
const looksWritten = (x: number): boolean => x === Number(x.toPrecision(12))

function computeSingularities(
  plan: SingPlan,
  params: readonly number[],
  range: [number, number],
): number[] {
  const lo = Math.min(range[0], range[1])
  const hi = Math.max(range[0], range[1])
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return []

  const raw: number[] = []
  for (const s of plan.sources) {
    const q: Scalar = (x) => {
      let v: number
      try { v = s.q(params, x, 0) } catch { return Number.NaN }
      return typeof v === 'number' ? v : Number.NaN
    }
    const found: number[] = []
    if (s.call) callSingularities(s.call, q, lo, hi, found)
    else scanSingularZeros(q, lo, hi, found)
    for (const r of found) {
      if (s.within === null || inPieces(s.within, r)) raw.push(r)
    }
  }
  for (const c of plan.exclusions) raw.push(c)

  raw.sort((a, b) => a - b)
  const kept: number[] = []
  for (const x of raw) {
    if (!Number.isFinite(x) || x < lo || x > hi) continue
    const n = kept.length
    if (n > 0 && Math.abs(x - kept[n - 1]) <= SING_DEDUPE * Math.max(1, Math.abs(x))) {
      // same point, two spellings: keep the one that was written down
      if (looksWritten(x) && !looksWritten(kept[n - 1])) kept[n - 1] = x
      continue
    }
    kept.push(x)
  }
  return kept
}

/**
 * The memoised `singularities` a typed explicit expression carries.
 * The renderer asks once per frame with the same (params, range); scanning
 * every denominator again each time would be the whole budget.
 */
function makeSingularities(
  plan: SingPlan,
): (params: number[], range: [number, number]) => number[] {
  // A source that calls a named curve moves when THAT curve changes, which
  // (params, range) cannot see — so such a plan is rescanned on every ask.
  if (plan.sources.some((s) => s.live)) {
    return (params, range) => computeSingularities(plan, params, range)
  }
  let key: string | null = null
  let cached: number[] = []
  return (params, range) => {
    const k = `${params.join(',')}|${range[0]}|${range[1]}`
    if (k !== key) {
      key = k
      cached = computeSingularities(plan, params, range)
    }
    return cached.slice()
  }
}

// ----------------------------------------------------------------------------
// LaTeX generation
// ----------------------------------------------------------------------------

// precedence classes for rendering: 1 add/sub/neg, 2 mul (& slash-div), 3 pow, 4 atom
function precOf(n: Node): number {
  switch (n.t) {
    case 'num': return numIsCompound(n.raw) ? 2 : 4
    case 'const':
    case 'var':
    case 'param':
    case 'call':
    case 'ucall': return 4
    case 'neg': return 1
    case 'bin':
      switch (n.op) {
        case '+': case '-': return 1
        // A product whose first factor is negated is WRITTEN with a leading
        // minus (−u·v, see toLatex), so it sits at the precedence of a
        // negation: as the right operand of −, + or × it must be wrapped.
        case '*': return stripLeadingNeg(n) ? 1 : 2
        case '/': return isAtomic(n.a) && isAtomic(n.b) ? 2 : 4 // \frac is self-delimiting
        case '^': return 3
      }
  }
}

/**
 * For a product chain whose leftmost factor is a negation — (−2)(x+1)²(x−3),
 * parsed left-associatively — the same chain with that one minus removed;
 * null otherwise. The minus is then written once, in front of the product.
 */
function stripLeadingNeg(n: Node): Node | null {
  if (n.t !== 'bin' || n.op !== '*') return null
  if (n.a.t === 'neg') return { t: 'bin', op: '*', a: n.a.a, b: n.b }
  const inner = stripLeadingNeg(n.a)
  return inner ? { t: 'bin', op: '*', a: inner, b: n.b } : null
}

function isAtomic(n: Node): boolean {
  return (n.t === 'num' && !numIsCompound(n.raw)) || n.t === 'const' || n.t === 'var' || n.t === 'param'
}

function numLatex(raw: string): string {
  if (!/[eE]/.test(raw)) return raw
  const plain = String(Number(raw))
  // Prefer the plain decimal ("5e2" -> 500, "1.5e-2" -> 0.015): it reads better
  // and, unlike `5\cdot 10^{2}`, it stays a single atom rather than a product
  // that could re-associate. JS switches its own toString to exponential
  // exactly when the decimal form gets unwieldy, which is the threshold we want.
  if (!/[eE]/.test(plain)) return plain
  const [mantissa, exp] = plain.split(/[eE]/)
  return `${mantissa}\\cdot 10^{${String(parseInt(exp, 10))}}`
}

/** True when numLatex renders `raw` as a product rather than a single atom. */
function numIsCompound(raw: string): boolean {
  return numLatex(raw).includes('\\cdot')
}

function child(n: Node, minPrec: number): string {
  const s = toLatex(n)
  return precOf(n) < minPrec ? wrap(s) : s
}

const GREEK_STARTS = ['\\pi', '\\theta', '\\tau']

function mulSep(ls: string, rs: string): string {
  if (/^[0-9.]/.test(rs)) return ' \\cdot '
  // A digit run followed by Euler's e must not be glued: "2e+1" would re-read
  // (by our own tokenizer, and by a human) as scientific notation 2e+1 = 20.
  // `e` is the only right operand that can start a numeric exponent, since
  // params are single letters and `e` is always the constant.
  // Before e^… a thin space is enough — "5\,e^{0.2x}" reads as a textbook
  // writes it, and still never as scientific notation.
  if (/[0-9]$/.test(ls) && /^e\^/.test(rs)) return '\\,'
  if (/[0-9]$/.test(ls) && /^e/.test(rs)) return ' \\cdot '
  const leftEndsLetter = /[A-Za-z]$/.test(ls)
  if (leftEndsLetter && (/^[A-Za-z]/.test(rs) || GREEK_STARTS.some((g) => rs.startsWith(g)))) {
    return '\\,' // thin space keeps "a x" as a\,x and never glues letters into "\pix"
  }
  return ''
}

/** The subscript of \log_{…}: a fraction n/d as \frac, everything else as usual. */
function baseLatex(n: Node): string {
  if (n.t === 'bin' && n.op === '/' && isAtomic(n.a) && isAtomic(n.b)) {
    return `\\frac{${toLatex(n.a)}}{${toLatex(n.b)}}`
  }
  return toLatex(n)
}

function toLatex(n: Node): string {
  switch (n.t) {
    case 'num': return numLatex(n.raw)
    case 'const': return CONSTS[n.name].latex
    case 'var': return VAR_LATEX[n.name]
    case 'param': return n.name
    case 'neg': return `-${child(n.a, 2)}`
    case 'call':
      // log_B: a simple fraction base is typeset as one, \log_{\frac{1}{2}}
      if (n.fn === 'log_') return FUNCS.log_.latex([baseLatex(n.args[0]), toLatex(n.args[1])])
      return FUNCS[n.fn].latex(n.args.map(toLatex))
    case 'ucall':
      // f\left(x-1\right), f'\left(x\right), f''\left(x\right)
      return `${n.name}${"'".repeat(n.order)}${wrap(toLatex(n.arg))}`
    case 'bin':
      switch (n.op) {
        case '+': {
          const rs = n.b.t === 'neg' ? wrap(toLatex(n.b)) : toLatex(n.b)
          return `${toLatex(n.a)}+${rs}`
        }
        case '-': return `${toLatex(n.a)}-${child(n.b, 2)}`
        case '*': {
          // (−u)·v is written −u·v: a leading minus belongs to the whole
          // product, and "(−x)(x − 1/2)" reads as if the sign were a factor.
          const positive = stripLeadingNeg(n)
          if (positive) return `-${toLatex(positive)}`
          // A fraction coefficient is typeset as a fraction: "1/2x" reads as
          // 1/(2x), which is not what (1/2)·x means.
          const ls =
            n.a.t === 'bin' && n.a.op === '/' && isAtomic(n.a.a) && isAtomic(n.a.b)
              ? `\\frac{${toLatex(n.a.a)}}{${toLatex(n.a.b)}}`
              : child(n.a, 2)
          const rs = child(n.b, 2)
          return `${ls}${mulSep(ls, rs)}${rs}`
        }
        case '/':
          if (isAtomic(n.a) && isAtomic(n.b)) return `${toLatex(n.a)}/${toLatex(n.b)}`
          return `\\frac{${toLatex(n.a)}}{${toLatex(n.b)}}`
        case '^': {
          // A decimal base is written in parentheses, (1.05)^{x}: bare, the
          // coefficient in front of it runs into it ("3 · 1.05^x").
          const decimalBase = n.a.t === 'num' && n.a.raw.includes('.')
          const base = precOf(n.a) < 4 || decimalBase ? wrap(toLatex(n.a)) : toLatex(n.a)
          return `${base}^{${toLatex(n.b)}}`
        }
      }
  }
}

// ----------------------------------------------------------------------------
// Classification + model construction
// ----------------------------------------------------------------------------

function metaFor(name: string, v: number): ParamMeta {
  const av = Math.abs(v)
  if (!Number.isFinite(v) || av < 5) {
    return { name, min: v - 10, max: v + 10, step: 0.01 }
  }
  const span = 2 * av
  const step = Math.pow(10, Math.floor(Math.log10(span)) - 3)
  return { name, min: v - span, max: v + span, step }
}

interface Classified {
  kind: CurveKind
  domain: [number, number] | null
  latex: string
  /** compiled evaluator; meaning of slots depends on kind */
  ev: Evaluator
  /** the explicit body, kept so its singularities can be collected; null otherwise */
  body: Node | null
}

function classify(lhs: Node, rhs: Node | null): Classified {
  const vars = new Set<VarName>()
  collectVars(lhs, vars)
  if (rhs) collectVars(rhs, vars)

  const usesX = vars.has('x'), usesY = vars.has('y')
  const usesR = vars.has('r'), usesTh = vars.has('theta'), usesT = vars.has('t')

  if ((usesR || usesTh) && (usesX || usesY || usesT)) {
    throw new ParseError(
      "Cannot mix polar variables (r, θ) with x, y, or t — use either 'r = f(θ)' or a cartesian equation",
    )
  }
  if (usesT && usesX) {
    throw new ParseError("Cannot mix 'x' and 't' in one expression — use one independent variable")
  }

  // ---- polar --------------------------------------------------------------
  if (usesR || usesTh) {
    let body: Node | null = null
    if (rhs === null) {
      if (!usesR) body = lhs // bare f(theta)
    } else if (isVar(lhs, 'r')) {
      const rv = new Set<VarName>(); collectVars(rhs, rv)
      if (!rv.has('r')) body = rhs
    } else if (isVar(rhs, 'r')) {
      const lv = new Set<VarName>(); collectVars(lhs, lv)
      if (!lv.has('r')) body = lhs
    }
    if (!body) {
      throw new ParseError("Polar equations must have the form 'r = f(θ)'")
    }
    return {
      kind: 'polar',
      domain: [0, 2 * Math.PI],
      latex: `r = ${toLatex(body)}`,
      ev: compile(body),
      // r(θ) has singularities of its own — the zeros of every denominator,
      // tan/sec/cot/csc, the argument of a logarithm — and they are where the
      // polar curve has a hole or runs off along a line. They are found by the
      // same machinery; only the variable they live in is θ rather than x.
      body,
    }
  }

  // ---- cartesian ----------------------------------------------------------
  if (rhs === null) {
    if (usesY) {
      // bare expression containing y -> implicit expr = 0
      return { kind: 'implicit', domain: null, latex: `${toLatex(lhs)} = 0`, ev: compile(lhs), body: null }
    }
    // bare f(x) (or f(t), or a constant) -> y = expr
    return { kind: 'explicit', domain: null, latex: `y = ${toLatex(lhs)}`, ev: compile(lhs), body: lhs }
  }

  // y = f(...) / f(...) = y  (rhs must not itself contain y)
  for (const [side, other] of [[lhs, rhs], [rhs, lhs]] as const) {
    if (isVar(side, 'y')) {
      const ov = new Set<VarName>(); collectVars(other, ov)
      if (!ov.has('y')) {
        return { kind: 'explicit', domain: null, latex: `y = ${toLatex(other)}`, ev: compile(other), body: other }
      }
    }
  }

  // general equation -> implicit lhs - rhs = 0 (covers x^2+y^2=4, x*y=1, x=2, ...)
  if (!usesX && !usesY && !usesT) {
    throw new ParseError('Equation has no variables to plot — try using x, y, or θ')
  }
  return {
    kind: 'implicit',
    domain: null,
    latex: `${toLatex(lhs)} = ${toLatex(rhs)}`,
    ev: compile({ t: 'bin', op: '-', a: lhs, b: rhs }),
    body: null,
  }
}

// ----------------------------------------------------------------------------
// Plot assembly — shared by the plain, restricted and piecewise paths.
// ----------------------------------------------------------------------------

/** `g(x) =` at the very start of a line: the head of a definition. */
const DEF_HEAD_RE = /^\s*([A-Za-z])\s*\(\s*([A-Za-z]+|θ)\s*\)\s*=(?!=)/

/**
 * The curve a line DEFINES, when the env knows that name: `g` for
 * `g(x) = 2f(x − 1) + 3`. Its head parses as it always has (matchFuncDef
 * drops it), and a call of it anywhere else on the line is refused. `y = …`
 * and bare expressions define nothing. Without an env, or when the env does
 * not have the name, null — and the line parses exactly as before.
 */
function selfOf(src: string, env: FunctionEnv | null | undefined): { name: string; headAtStart: boolean } | null {
  if (!env) return null
  const m = DEF_HEAD_RE.exec(src)
  if (!m) return null
  const name = m[1]
  const arg = m[2] === 'θ' ? 'theta' : m[2]
  if (isKnownName(name) || !VAR_NAMES.has(arg) || !envHas(env, name)) return null
  return { name, headAtStart: true }
}

/** Parse one whole equation into its classified, compiled form. */
function compileEquation(src: string, env?: FunctionEnv | null): {
  cls: Classified
  paramNames: string[]
  vars: Set<VarName>
  logBases: Set<string>
} {
  const parser = new Parser(src, env, selfOf(src, env))
  const { lhs, rhs } = parser.parseInput()

  // "f(x) = x^2" — plot the body, not the implicit relation f·x = x².
  const fdef = matchFuncDef(lhs, rhs)
  const vars = new Set<VarName>()
  let cls: Classified
  let paramNames: string[]
  if (fdef) {
    // The function letter is not a plottable free constant; drop it and
    // renumber the survivors so param indices stay dense.
    paramNames = reindexParams(fdef.body)
    cls = classify(fdef.body, null)
    cls.latex = `${fdef.head} = ${toLatex(fdef.body)}`
    collectVars(fdef.body, vars)
    vars.add(fdef.boundVar)
  } else {
    cls = classify(lhs, rhs)
    paramNames = [...parser.paramNames] // order of first appearance, deduped
    collectVars(lhs, vars)
    if (rhs) collectVars(rhs, vars)
  }
  return { cls, paramNames, vars, logBases: logBaseParams([lhs, rhs]) }
}

/**
 * Free constants used as the bare base of a logarithm (the b of log_b(x)).
 * Every other slider starts at 1, but a base of 1 has no logarithm — the
 * curve would start out invisible — so these start at 2.
 */
function logBaseParams(nodes: readonly (Node | null)[]): Set<string> {
  const out = new Set<string>()
  const walk = (n: Node): void => {
    switch (n.t) {
      case 'neg': walk(n.a); break
      case 'bin': walk(n.a); walk(n.b); break
      case 'call':
        if (n.fn === 'log_' && n.args[0].t === 'param') out.add(n.args[0].name)
        for (const a of n.args) walk(a)
        break
      case 'ucall': walk(n.arg); break
      default: break
    }
  }
  for (const n of nodes) if (n) walk(n)
  return out
}

/** The default value of one free constant. */
const LOG_BASE_DEFAULT = 2

function makePlot(
  kind: CurveKind,
  latex: string,
  paramNames: string[],
  domain: [number, number] | null,
  ev: Evaluator,
  sing: SingPlan | null = null,
  logBases: ReadonlySet<string> = new Set(),
  pieces: ((params: readonly number[]) => PieceInfo[]) | null = null,
  /** The formula itself, when one formula holds everywhere the curve is
   *  drawn — what ModelSpec.evalExact walks (./exactEval.ts). */
  exactBody: Node | null = null,
): ParsedPlot {
  const defaultParams = paramNames.map((nm) => (logBases.has(nm) ? LOG_BASE_DEFAULT : 1))
  return {
    kind,
    latex,
    paramNames,
    defaultParams,
    domain,
    makeModel(modelId: string): ModelSpec {
      const spec: ModelSpec = {
        id: modelId,
        kind,
        name: 'Expression',
        latex: () => latex,
        paramMeta: (params: number[]) =>
          paramNames.map((nm, i) => metaFor(nm, params[i] ?? defaultParams[i])),
      }
      if (kind === 'explicit') {
        spec.evalExplicit = (params, x) => ev(params, x, 0)
        spec.singularities = makeSingularities(sing ?? emptySingPlan())
        if (pieces) spec.pieces = (params) => pieces(params)
        if (exactBody) {
          const body = exactBody
          spec.evalExact = (params, x) => evalExactAt(body, params, x)
          spec.taylor = (params, a, n) => jetAt(body, params, a, n)
        }
      } else if (kind === 'polar') {
        spec.evalPolar = (params, theta) => ev(params, theta, 0)
        // Same slot, read in θ: the candidates src/core/holes.ts sorts into
        // polar holes and the lines a polar curve runs out along. An implicit
        // plot still carries none — there is no one variable to scan.
        spec.singularities = makeSingularities(sing ?? emptySingPlan())
      } else {
        spec.evalImplicit = (params, x, y) => ev(params, x, y)
      }
      return spec
    },
  }
}

// ----------------------------------------------------------------------------
// Restricted domains and piecewise definitions
//
//   y = x^2 {0 <= x < 3}      y = x^2, 0 <= x < 3      y = x^2 for x > 0
//   y = { x^2 if x < 0 ; 2x if x >= 0 }
//   y = { x^2, x < 0 ; 2x, x >= 0 }
//   y = piecewise(x^2, x < 0, 2x, x >= 0)
//   f(x) = { -x if x < 0 ; x if x >= 0 }
//
// Both shapes compile to the SAME thing: a list of branches, each a compiled
// expression plus the set of x it owns. A restriction is the one-branch case,
// which is why `y = { x^2 if 0 < x < 3 }` and `y = x^2 {0 < x < 3}` come out
// identical — same domain, same evaluator, same latex.
//
// The first branch whose condition holds wins; where none holds the function
// is undefined and evaluates to NaN, which the renderer already draws as a
// pen-lift. That is the honest picture: a gap is a gap, not a vertical jump.
//
// Conditions are parsed by ./condition.ts — the same engine the number-line
// board uses — so `0 <= x < 3`, `x != 0`, `[0, 3)` and `x < -1 or x > 2` all
// mean here exactly what they mean there.
// ----------------------------------------------------------------------------

const TWO_PI = 2 * Math.PI

/** Words that introduce a condition: "x^2 for x > 0", "x^2 if x > 0". */
const COND_WORDS: ReadonlySet<string> = new Set(['for', 'if', 'where', 'when'])
/** Words for "everything no earlier branch claimed". */
const ELSE_WORDS: ReadonlySet<string> = new Set(['otherwise', 'else'])

const OPENERS = '([{'
const CLOSERS = ')]}'

/** Re-point the "at position N" inside a message parsed from a substring. */
function shiftPositions(msg: string, by: number): string {
  if (by === 0) return msg
  return msg.replace(/position (\d+)/g, (_m, d: string) => `position ${Number(d) + by}`)
}

/** Run a sub-parse whose source starts at offset `at` in the real input. */
function atOffset<T>(at: number, f: () => T): T {
  try {
    return f()
  } catch (err) {
    if (err instanceof ParseError) {
      throw new ParseError(shiftPositions(err.message, at), err.pos === undefined ? undefined : err.pos + at)
    }
    if (err instanceof CondError) {
      throw new ParseError(err.message, err.pos)
    }
    throw err
  }
}

/** Index of the '}' closing the '{' at `i`; -1 when it never closes. */
function matchBrace(src: string, i: number): number {
  let depth = 0
  for (let k = i; k < src.length; k++) {
    const c = src[k]
    if (OPENERS.includes(c)) depth++
    else if (CLOSERS.includes(c)) {
      depth--
      if (depth === 0) return src[k] === '}' ? k : -1
    }
  }
  return -1
}

interface Cut {
  kind: 'brace' | 'comma' | 'word'
  /** offset of the marker itself */
  at: number
  /** offset just past the marker (for a brace: past the '}') */
  end: number
  /** the condition text and where it starts */
  cond: string
  condAt: number
  /** the matched word, lower-cased ('' for brace/comma) */
  word: string
}

/**
 * The first top-level condition marker in `src`: a `{...}` group, a comma, or
 * one of the joining words. Brackets are honoured so that `min(x, 2)` and
 * `[0, 3]` keep their own commas.
 *
 * Only an unclosed `{` is reported here; every other bracket slip is left to
 * the expression parser, whose message for it is already the better one.
 */
function findCut(src: string, words: ReadonlySet<string>, at = 0): Cut | null {
  let depth = 0
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '{' && depth === 0) {
      // "x^{2}" is pasted LaTeX, not a condition. Leave it to the tokenizer,
      // whose "Unexpected character '{'" is the message that fits.
      if (/[\^_]\s*$/.test(src.slice(0, i))) continue
      const close = matchBrace(src, i)
      if (close < 0) {
        throw new ParseError(`Missing closing '}' for the '{' at position ${i + at}`, i + at)
      }
      return {
        kind: 'brace',
        at: i,
        end: close + 1,
        cond: src.slice(i + 1, close),
        condAt: i + 1,
        word: '',
      }
    }
    if (OPENERS.includes(c)) { depth++; continue }
    if (CLOSERS.includes(c)) { if (depth > 0) depth--; continue }
    if (depth !== 0) continue
    if (c === ',') {
      return { kind: 'comma', at: i, end: i + 1, cond: src.slice(i + 1), condAt: i + 1, word: '' }
    }
    if (/[A-Za-z]/.test(c) && (i === 0 || !/[A-Za-z0-9]/.test(src[i - 1]))) {
      let j = i
      while (j < src.length && /[A-Za-z0-9]/.test(src[j])) j++
      const w = src.slice(i, j).toLowerCase()
      if (words.has(w)) {
        const isElse = ELSE_WORDS.has(w)
        return {
          kind: 'word',
          at: i,
          end: j,
          cond: isElse ? w : src.slice(j),
          condAt: isElse ? i : j,
          word: w,
        }
      }
      i = j - 1 // skip the whole word: 'floor' hides no 'for'
    }
  }
  return null
}

/** Split `text` on a depth-0 separator, keeping source offsets. */
function splitTop(text: string, at: number, sep: string): { text: string; at: number }[] {
  const out: { text: string; at: number }[] = []
  let depth = 0
  let from = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (OPENERS.includes(c)) depth++
    else if (CLOSERS.includes(c)) { if (depth > 0) depth-- }
    else if (c === sep && depth === 0) {
      out.push({ text: text.slice(from, i), at: at + from })
      from = i + 1
    }
  }
  out.push({ text: text.slice(from), at: at + from })
  return out
}

/** Offset of the first top-level '=', skipping <=, >=, !=, ==. -1 when none. */
function topLevelEq(src: string): number {
  let depth = 0
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (OPENERS.includes(c)) depth++
    else if (CLOSERS.includes(c)) { if (depth > 0) depth-- }
    else if (c === '=' && depth === 0) {
      if ('<>=!'.includes(src[i - 1] ?? '') || src[i + 1] === '=') continue
      return i
    }
  }
  return -1
}

/** One piece of a piecewise definition (a restriction is the one-branch case). */
interface Branch {
  ev: Evaluator
  pieces: Piece[]
  /** the branch expression, as KaTeX */
  bodyTex: string
  /** the branch condition, as KaTeX */
  condTex: string
  /**
   * The set this branch owns when a bound is a SLIDER (`x < a`): recomputed
   * from the current params. `pieces` then holds the default-params set,
   * for the printed table only. See liveBranch.
   */
  live?: (params: readonly number[]) => Piece[]
  /** an `otherwise` / `else` branch: it owns what no earlier branch claimed */
  otherwise?: boolean
}

const isWholeLine = (ps: readonly Piece[]): boolean =>
  ps.length === 1 && ps[0].lo === -Infinity && ps[0].hi === Infinity

/**
 * Turn branches into the (domain, evaluator) pair the contract carries.
 *
 * `ParsedPlot.domain` is one interval, so it holds the overall extent and the
 * evaluator holds the detail. When the branches ARE one plain interval the
 * evaluator is left alone: the domain already says everything, and an
 * ungated closure keeps the domain handles draggable.
 */
function planBranches(
  kind: CurveKind,
  branches: Branch[],
): { domain: [number, number] | null; ev: Evaluator } {
  const single = branches.length === 1
  if (branches.some((b) => b.live)) return { domain: null, ev: liveGate(branches) }
  if (single && isWholeLine(branches[0].pieces)) {
    return { domain: kind === 'polar' ? [0, TWO_PI] : null, ev: branches[0].ev }
  }

  const all = branches.flatMap((b) => b.pieces)
  const ext = extentOf(all)!
  const finite = Number.isFinite(ext[0]) && Number.isFinite(ext[1])

  const sets = branches.map((b) => b.pieces)
  const evs = branches.map((b) => b.ev)
  const gated: Evaluator = (p, a, b) => {
    for (let i = 0; i < sets.length; i++) {
      if (inPieces(sets[i], a)) return evs[i](p, a, b)
    }
    return Number.NaN // undefined here — the renderer lifts the pen
  }

  if (kind === 'polar') {
    // θ has a natural default turn; an unbounded end means "as far as usual".
    const domain: [number, number] = [
      Number.isFinite(ext[0]) ? ext[0] : 0,
      Number.isFinite(ext[1]) ? ext[1] : TWO_PI,
    ]
    const plain = single && branches[0].pieces.length === 1
    return { domain, ev: plain ? branches[0].ev : gated }
  }

  const plain = single && branches[0].pieces.length === 1 && finite
  return {
    domain: finite ? [ext[0], ext[1]] : null,
    ev: plain ? branches[0].ev : gated,
  }
}

/** The set a branch owns at these params (a live branch follows its sliders). */
const setAt = (b: Branch, params: readonly number[]): Piece[] => (b.live ? b.live(params) : b.pieces)

/**
 * The gated evaluator for branches whose bounds are sliders. The sets are
 * recomputed only when the params change — never per x.
 */
function liveGate(branches: Branch[]): Evaluator {
  const evs = branches.map((b) => b.ev)
  let last: number[] | null = null
  let sets: Piece[][] = []
  const current = (p: readonly number[]): Piece[][] => {
    let same = last !== null && last.length === p.length
    for (let i = 0; same && i < p.length; i++) if (!Object.is(last![i], p[i])) same = false
    if (!same) {
      last = [...p]
      sets = branches.map((b) => setAt(b, p))
    }
    return sets
  }
  return (p, a, b) => {
    const ss = current(p)
    for (let i = 0; i < ss.length; i++) {
      if (inPieces(ss[i], a)) return evs[i](p, a, b)
    }
    return Number.NaN
  }
}

/**
 * ModelSpec.pieces for an explicit piecewise / restricted curve: every
 * interval a branch OWNS, left to right, with its ends as written (≤ closed,
 * < open). "Owns" is the evaluator's rule — the first matching branch wins —
 * so these are exactly the pieces the graph has, and exactly the dots a
 * textbook draws:
 *
 *   - a UNION condition (x < −1 or x > 2) is reported as its separate
 *     intervals — each has its own ends to mark;
 *   - an EXCLUSION (x ≠ 2) is not a piece end: the branch is taken as the
 *     whole line and the excluded point is left to the holes layer (the
 *     parser already lists it as an exact singularity) — unless an EARLIER
 *     branch claims that point (`{ 5 if x = 2 ; x^2 if x != 2 }`), in which
 *     case the point is simply another branch's, as below;
 *   - a branch loses whatever an earlier branch already claimed, so
 *     `{ 1 if x < 5 ; 2 if x < 10 }` has the pieces x < 5 and 5 ≤ x < 10,
 *     and an `otherwise` branch owns the complement of every earlier one.
 *
 * Null when there is nothing to mark: one branch that owns the whole line
 * (an ordinary curve, or a pure exclusion like 1/x {x ≠ 0}).
 */
function pieceInfoOf(
  kind: CurveKind,
  branches: Branch[],
): ((params: readonly number[]) => PieceInfo[]) | null {
  if (kind !== 'explicit' || branches.length === 0) return null
  const owned = (params: readonly number[]): Piece[] => {
    const out: Piece[] = []
    const before: Piece[] = []
    for (const b of branches) {
      const set = setAt(b, params)
      const holes = b.otherwise ? null : excludedPoints(set)
      const claim = b.otherwise || (holes && holes.length > 0) ? WHOLE_LINE() : set
      // claim minus everything already claimed: A ∩ ¬B = ¬(¬A ∪ B)
      const mine = before.length === 0 ? claim : complementOf([...complementOf(claim), ...before])
      out.push(...mine)
      before.push(...set)
    }
    return out
  }
  const toInfo = (ps: Piece[]): PieceInfo[] =>
    ps
      .map((q) => ({
        lo: q.lo,
        hi: q.hi,
        loClosed: Number.isFinite(q.lo) && q.loC,
        hiClosed: Number.isFinite(q.hi) && q.hiC,
      }))
      .sort((a, b) => a.lo - b.lo || a.hi - b.hi || 0)
  if (branches.length === 1) {
    const b = branches[0]
    if (!b.live) {
      const ps = owned([])
      if (ps.length === 1 && isWholeLine(ps)) return null
      const info = toInfo(ps)
      return () => info.map((q) => ({ ...q }))
    }
  } else if (!branches.some((b) => b.live)) {
    const info = toInfo(owned([]))
    return () => info.map((q) => ({ ...q }))
  }
  return (params) => toInfo(owned(params))
}

/**
 * A condition the constant-folding parser refused may still be ONE interval
 * whose bounds are sliders: `0 <= x < a`, `x > b`, `[a, b)`. Returns the
 * branch's live set (params → pieces), the LaTeX to print, and the
 * default-params pieces; the sliders it uses are appended to `paramNames`.
 * Null when the condition is not of that shape (the caller rethrows).
 */
function liveBranch(
  cond: string,
  want: VarName,
  ctx: CondCtx,
  paramNames: string[],
  defaults: (names: readonly string[]) => number[],
): {
  live: (params: readonly number[]) => Piece[]
  pieces: Piece[]
  tex: (v: string) => string
  setTex: (v: string) => string
} | null {
  const compiled = new Map<string, CompiledExpr>()
  const cl: LiveClause | null = liveClause(cond, ctx, want, (text) => {
    const c = compileExpr(text)
    if (!c.ok || c.expr.vars.length > 0) return null
    compiled.set(text, c.expr)
    return { tex: c.expr.latex, live: c.expr.paramNames.length > 0 }
  })
  if (!cl) return null
  const boundFn = (b: LiveClause['lo']): ((p: readonly number[]) => number) | null => {
    if (!b) return null
    const c = compiled.get(b.src)!
    const idx = c.paramNames.map((nm) => {
      let i = paramNames.indexOf(nm)
      if (i < 0) { paramNames.push(nm); i = paramNames.length - 1 }
      return i
    })
    const local = idx.map(() => 0)
    return (p) => {
      for (let k = 0; k < idx.length; k++) local[k] = p[idx[k]] ?? Number.NaN
      return c.ev(local, Number.NaN, Number.NaN)
    }
  }
  const lo = boundFn(cl.lo)
  const hi = boundFn(cl.hi)
  const live = (p: readonly number[]): Piece[] => {
    const a = lo ? lo(p) : Number.NEGATIVE_INFINITY
    const b = hi ? hi(p) : Number.POSITIVE_INFINITY
    if (Number.isNaN(a) || Number.isNaN(b)) return []
    const q: Piece = {
      lo: a, hi: b, loC: cl.loC && Number.isFinite(a), hiC: cl.hiC && Number.isFinite(b),
      loTex: cl.lo?.tex ?? null, hiTex: cl.hi?.tex ?? null,
      loSrc: cl.lo?.src ?? null, hiSrc: cl.hi?.src ?? null,
    }
    if (a < b || (a === b && q.loC && q.hiC && Number.isFinite(a))) return [q]
    return []
  }
  const tex = (v: string): string => {
    if (cl.lo && cl.hi) {
      return `${cl.lo.tex} ${cl.loC ? '\\leq' : '<'} ${v} ${cl.hiC ? '\\leq' : '<'} ${cl.hi.tex}`
    }
    if (cl.lo) return `${v} ${cl.loC ? '\\geq' : '>'} ${cl.lo.tex}`
    return `${v} ${cl.hiC ? '\\leq' : '<'} ${cl.hi!.tex}`
  }
  // Interval notation, as setLatex prints a constant restriction.
  const setTex = (v: string): string =>
    `${v} \\in ${cl.loC ? '[' : '('}${cl.lo?.tex ?? '-\\infty'}, ` +
    `${cl.hi?.tex ?? '\\infty'}${cl.hiC ? ']' : ')'}`
  return { live, pieces: live(defaults(paramNames)), tex, setTex }
}

/** Which variable a curve is a function of, for checking against a condition. */
function independentVar(vars: ReadonlySet<VarName>): VarName {
  if (vars.has('theta') || vars.has('r')) return 'theta'
  if (vars.has('t')) return 't'
  return 'x'
}

/** Parse a condition, and insist it is about `want`. */
function branchPieces(
  cond: string,
  at: number,
  want: VarName,
  ctx: CondCtx,
): Piece[] {
  if (cond.trim() === '') {
    throw new ParseError('Empty condition — write something like {0 < x < 3}', at)
  }
  let pieces: Piece[]
  try {
    pieces = parseCondition(cond, ctx, at)
  } catch (err) {
    if (err instanceof CondError) throw new ParseError(err.message, err.pos)
    throw err
  }
  if (ctx.name !== null && ctx.name !== want) {
    throw new ParseError(
      `The condition is about '${ctx.name}' but the equation is in '${want}' — ` +
        `write the condition in ${want} (like ${want} > 0)`,
      ctx.pos,
    )
  }
  if (pieces.length === 0) {
    throw new ParseError(
      `That condition is never true, so there would be nothing to draw`,
      at,
    )
  }
  return pieces
}

const varTexOf = (ctx: CondCtx, want: VarName): string => ctx.tex ?? VAR_LATEX[want]

/**
 * `y = f(x) <condition>` — one expression, restricted.
 * `cut` has already located the condition.
 */
function parseRestricted(src: string, cut: Cut, env?: FunctionEnv | null): ParsedPlot {
  const base = src.slice(0, cut.at)
  if (cut.kind === 'brace' && src.slice(cut.end).trim() !== '') {
    throw new ParseError(
      `Unexpected '${src.slice(cut.end).trim()[0]}' after the condition at position ${cut.end}`,
      cut.end,
    )
  }
  if (base.trim() === '') {
    throw new ParseError('Write the formula before the condition, e.g. y = x^2 {0 < x < 3}', 0)
  }
  if (cut.cond.trim() === '') {
    // Reported at the marker, not inside it: that is where the eye goes.
    throw new ParseError('Empty condition — write something like {0 < x < 3}', cut.at)
  }

  const { cls, paramNames, vars, logBases } = compileEquation(base, env)
  if (cls.kind !== 'explicit' && cls.kind !== 'polar') {
    throw new ParseError(
      'A domain restriction needs an explicit curve — write it as y = f(x) or r = f(θ)',
      cut.at,
    )
  }
  const want = cls.kind === 'polar' ? 'theta' : independentVar(vars)
  let ctx = newCtx(analyzeExpr)
  let pieces: Piece[]
  let live: ReturnType<typeof liveBranch> = null
  try {
    pieces = branchPieces(cut.cond, cut.condAt, want, ctx)
  } catch (err) {
    // `y = x^2 {0 <= x <= a}`: a slider bound. Only ever tried where the
    // constant-bound parse has already failed, so nothing that parsed
    // before changes.
    if (cls.kind !== 'explicit') throw err
    const lctx = newCtx(analyzeExpr)
    live = liveBranch(cut.cond, want, lctx, paramNames, (names) => defaultsOf(names, logBases))
    if (!live) throw err
    ctx = lctx
    pieces = live.pieces
  }
  const vTex = varTexOf(ctx, want)
  if (live) {
    const branch: Branch = { ev: cls.ev, pieces, live: live.live, bodyTex: cls.latex, condTex: live.tex(vTex) }
    const layout = planBranches(cls.kind, [branch])
    const latex = `${cls.latex},\\ ${live.setTex(vTex)}`
    return makePlot(
      cls.kind, latex, paramNames, layout.domain, layout.ev, singPlanOf(cls.body), logBases,
      pieceInfoOf(cls.kind, [branch]), cls.body,
    )
  }

  // "1/x {x != 0}" removes a single point from an otherwise whole line. The
  // curve is not a piecewise and there is no gap to draw at sampling width —
  // so the restriction becomes a note on the equation, not a fake hole.
  const holes = excludedPoints(pieces)
  // An exclusion is not only a note on the equation: `{x != 2}` says the
  // formula is undefined at 2, which is exactly a singularity — an exact one,
  // with no scanning needed to find it.
  const plan = singPlanOf(cls.body)
  if (holes) {
    for (const h of holes) if (Number.isFinite(h.hi)) plan.exclusions.push(h.hi)
  }
  const branch: Branch = {
    ev: cls.ev,
    pieces: holes && holes.length > 0 ? WHOLE_LINE() : pieces,
    bodyTex: cls.latex,
    condTex: '',
  }
  const layout = planBranches(cls.kind, [branch])

  let latex = cls.latex
  if (holes && holes.length > 0) latex += `,\\ ${exclusionLatex(holes, vTex)}`
  else if (!isWholeLine(pieces)) latex += `,\\ ${setLatex(pieces, vTex)}`

  return makePlot(
    cls.kind, latex, paramNames, layout.domain, layout.ev, plan, logBases,
    pieceInfoOf(cls.kind, [branch]),
    // an excluded point {x != c} is undefined there, whatever the formula says
    holes && holes.length > 0 ? null : cls.body,
  )
}

/** Slider defaults, exactly as makePlot assigns them. */
const defaultsOf = (names: readonly string[], logBases: ReadonlySet<string>): number[] =>
  names.map((nm) => (logBases.has(nm) ? LOG_BASE_DEFAULT : 1))

/** The `y =` / `f(x) =` / `r =` head of a piecewise definition. */
interface PieceHead {
  tex: string
  /** true when there was no head at all, so a polar body may rename it 'r' */
  implied: boolean
  /** the letter to drop, when the head is a function definition */
  fnName: string | null
  /** the variable the head names, when it names one */
  boundVar: VarName | null
  polar: boolean
}

const HEAD_FN_RE = /^([A-Za-z])\s*\(\s*([A-Za-z]+|θ)\s*\)$/
const HEAD_ARGS: ReadonlySet<string> = new Set(['x', 't', 'theta'])

function parseHead(raw: string, at: number): PieceHead {
  const head = raw.trim()
  if (head === '' || head === 'y') {
    return { tex: 'y', implied: head === '', fnName: null, boundVar: null, polar: false }
  }
  if (head === 'r') return { tex: 'r', implied: false, fnName: null, boundVar: null, polar: true }

  const m = HEAD_FN_RE.exec(head)
  if (m) {
    const name = m[1]
    const argRaw = m[2] === 'θ' ? 'theta' : m[2]
    if (!(has(FUNCS, name)) && !(has(CONSTS, name)) && !VAR_NAMES.has(name) && HEAD_ARGS.has(argRaw)) {
      const arg = argRaw as VarName
      return {
        tex: `${name}${wrap(VAR_LATEX[arg])}`,
        implied: false,
        fnName: name,
        boundVar: arg,
        polar: arg === 'theta',
      }
    }
  }
  throw new ParseError(
    `'${head}' cannot be defined piecewise — write 'y = { ... }' or 'f(x) = { ... }'`,
    at,
  )
}

/** One branch of a piecewise body: an expression and the condition it owns. */
interface RawBranch {
  expr: string
  exprAt: number
  cond: string
  condAt: number
  otherwise: boolean
}

const BRANCH_WORDS: ReadonlySet<string> = new Set([...COND_WORDS, ...ELSE_WORDS])

/**
 * Split "x^2 if x < 0" / "x^2, x < 0" / "2x otherwise" into its two halves.
 *
 * A piece with no condition at all is refused rather than guessed at: a
 * trailing default is spelled `otherwise`, which is unambiguous, and
 * `{ x^2 ; 2x }` is far more likely to be a forgotten condition than a
 * deliberate one.
 */
function splitBranch(seg: { text: string; at: number }): RawBranch {
  const cut = findCut(seg.text, BRANCH_WORDS, seg.at)
  if (cut === null || cut.kind === 'brace') {
    throw new ParseError(
      `Each piece needs a condition — 'x^2 if x < 0'`,
      seg.at + (seg.text.length - seg.text.trimStart().length),
    )
  }
  const cond = cut.cond.trim()
  return {
    expr: seg.text.slice(0, cut.at),
    exprAt: seg.at,
    cond: cut.cond,
    condAt: seg.at + cut.condAt,
    otherwise: ELSE_WORDS.has(cond.toLowerCase()),
  }
}

/** Compile the branch bodies, sharing one deduplicated parameter list. */
function compileBranchBodies(
  raws: RawBranch[],
  env?: FunctionEnv | null,
  selfName: string | null = null,
): { bodies: Node[]; paramNames: string[] } {
  const bodies = raws.map((b) => {
    if (b.expr.trim() === '') {
      throw new ParseError(`Each piece needs a formula, e.g. 'x^2 if x < 0'`, b.exprAt)
    }
    return atOffset(b.exprAt, () => {
      const parser = new Parser(b.expr, env, selfName ? { name: selfName, headAtStart: false } : null)
      const { lhs, rhs } = parser.parseInput()
      if (rhs !== null) {
        throw new ParseError(`A piece is a formula, not an equation — drop the '='`)
      }
      return lhs
    })
  })
  // One shared, deduplicated list: `{ a x if x<0 ; b x if x>=0 }` has two
  // sliders, and a repeated letter is the SAME slider in every branch.
  const paramNames: string[] = []
  const index = new Map<string, number>()
  for (const body of bodies) reindexParams(body, paramNames, index)
  return { bodies, paramNames }
}

function buildPiecewise(
  headRaw: string,
  headAt: number,
  raws: RawBranch[],
  env?: FunctionEnv | null,
): ParsedPlot {
  const head = parseHead(headRaw, headAt)
  // `f(x) = { f(x − 1) if … }`: the pieces may call other curves, not f
  const selfName = env && head.fnName !== null && envHas(env, head.fnName) ? head.fnName : null
  const { bodies, paramNames } = compileBranchBodies(raws, env, selfName)

  const vars = new Set<VarName>()
  for (const b of bodies) collectVars(b, vars)
  if (vars.has('y')) {
    throw new ParseError("A piece cannot contain 'y' — each piece is a formula in x")
  }
  if (vars.has('r')) {
    throw new ParseError("A piece cannot contain 'r' — each piece is a formula in θ")
  }
  const polar = head.polar || vars.has('theta')
  if (polar && (vars.has('x') || vars.has('t'))) {
    throw new ParseError(
      "Cannot mix polar variables (r, θ) with x, y, or t — use either 'r = f(θ)' or a cartesian equation",
    )
  }
  if (polar && head.tex === 'y') {
    if (!head.implied) {
      throw new ParseError(
        "Cannot mix polar variables (r, θ) with x, y, or t — use either 'r = f(θ)' or a cartesian equation",
      )
    }
    head.tex = 'r' // a bare "{ 1 + cos(theta) if ... }" is polar, and says so
  }
  if (vars.has('x') && vars.has('t')) {
    throw new ParseError("Cannot mix 'x' and 't' in one expression — use one independent variable")
  }
  if (head.fnName !== null) {
    for (const b of bodies) {
      if (countParam(b, head.fnName) > 0) {
        throw new ParseError(
          `'${head.fnName}' is the function's own name, so it cannot also be a constant inside it`,
          headAt,
        )
      }
    }
  }

  const kind: CurveKind = polar ? 'polar' : 'explicit'
  const want: VarName = polar ? 'theta' : head.boundVar ?? independentVar(vars)

  // Every branch is checked against the same variable, so each gets its own
  // context and the mismatch is reported branch by branch.
  const ctxs: CondCtx[] = []
  // Each branch owns its own singularities, and only inside the set it owns:
  // the 0 of `1/x if x < 0` is the branch's edge, not a pole of the piece.
  const plan = emptySingPlan()
  const logBases = logBaseParams(bodies)
  const lives: ReturnType<typeof liveBranch>[] = []
  const branches: Branch[] = raws.map((raw, i) => {
    let ctx = newCtx(analyzeExpr)
    let pieces: Piece[]
    let live: ReturnType<typeof liveBranch> = null
    if (raw.otherwise) pieces = WHOLE_LINE()
    else {
      try {
        pieces = branchPieces(raw.cond, raw.condAt, want, ctx)
      } catch (err) {
        // `{ x^2 if x < a ; … }`: a slider bound — tried only where the
        // constant-bound parse has already failed.
        if (kind !== 'explicit') throw err
        const lctx = newCtx(analyzeExpr)
        live = liveBranch(raw.cond, want, lctx, paramNames, (names) => defaultsOf(names, logBases))
        if (!live) throw err
        ctx = lctx
        pieces = live.pieces
      }
    }
    ctxs.push(ctx)
    lives.push(live)
    if (live) {
      // the set moves with the slider: the body's singularities count anywhere
      collectSingSources(bodies[i], null, plan.sources)
      return {
        ev: compile(bodies[i]), pieces, bodyTex: toLatex(bodies[i]), condTex: '',
        live: live.live, otherwise: false,
      }
    }
    {
      // `{ x^2 if x != 2 }` removes a point rather than cutting the branch in
      // two; the excluded x is an exact singularity of that branch. A polar
      // branch says the same thing about θ — `{ 1/θ if θ != 1 }`.
      const excluded = excludedPoints(pieces)
      const owns = excluded && excluded.length > 0 ? WHOLE_LINE() : pieces
      collectSingSources(bodies[i], isWholeLine(owns) ? null : owns, plan.sources)
      if (excluded) {
        for (const h of excluded) if (Number.isFinite(h.hi)) plan.exclusions.push(h.hi)
      }
    }
    return {
      ev: compile(bodies[i]),
      pieces,
      bodyTex: toLatex(bodies[i]),
      condTex: '',
      otherwise: raw.otherwise,
    }
  })
  const vTex = ctxs.find((c) => c.tex !== null)?.tex ?? VAR_LATEX[want]
  branches.forEach((b, i) => {
    const lv = lives[i]
    b.condTex = lv ? lv.tex(vTex) : compactLatex(b.pieces, vTex)
  })

  const layout = planBranches(kind, branches)

  // One branch IS a restriction — print it as one, so the two spellings of the
  // same curve produce the same card.
  let latex: string
  const live0 = lives[0]
  if (branches.length === 1 && live0) {
    latex = `${head.tex} = ${branches[0].bodyTex},\\ ${live0.setTex(vTex)}`
  } else if (branches.length === 1) {
    latex = `${head.tex} = ${branches[0].bodyTex}`
    if (!isWholeLine(branches[0].pieces)) {
      latex += `,\\ ${setLatex(branches[0].pieces, vTex)}`
    }
  } else {
    // Overlaps are legal and the top row wins, which is exactly how a reader
    // scans \begin{cases} — so the printed order is the evaluated order.
    const rows = branches.map((b) => `${b.bodyTex} & ${b.condTex}`)
    latex = `${head.tex} = \\begin{cases} ${rows.join(' \\\\ ')} \\end{cases}`
  }
  return makePlot(kind, latex, paramNames, layout.domain, layout.ev, plan, logBases, pieceInfoOf(kind, branches))
}

/** `piecewise(e1, c1, e2, c2, ...)` with an optional final default value. */
function piecewiseCall(inner: string, at: number): RawBranch[] {
  const args = splitTop(inner, at, ',')
  if (args.length < 2) {
    throw new ParseError(
      `piecewise() needs a formula and a condition, e.g. piecewise(x^2, x < 0, 2x, x >= 0)`,
      at,
    )
  }
  const raws: RawBranch[] = []
  for (let i = 0; i + 1 < args.length; i += 2) {
    raws.push({
      expr: args[i].text,
      exprAt: args[i].at,
      cond: args[i + 1].text,
      condAt: args[i + 1].at,
      otherwise: ELSE_WORDS.has(args[i + 1].text.trim().toLowerCase()),
    })
  }
  if (args.length % 2 === 1) {
    const last = args[args.length - 1]
    raws.push({ expr: last.text, exprAt: last.at, cond: '', condAt: last.at, otherwise: true })
  }
  return raws
}

const PIECEWISE_RE = /^(\s*)piecewise\s*\(/i

/**
 * The branches of a `{ … }` body. `;` separates them — and so may `,`, the
 * way a textbook lists cases: `{ x^2 if x < 0, 3 if 0 <= x <= 2, -x + 5 if
 * x > 2 }`. A comma only separates when there is no `;` at all and EVERY
 * comma-separated segment carries its own `if` / `for` / `otherwise`; the
 * `x^2, x < 0` spelling (a comma between formula and condition) keeps its
 * meaning, and every body that parsed before splits exactly as it did.
 */
function bodySegments(text: string, at: number): { text: string; at: number }[] {
  const segs = splitTop(text, at, ';')
  if (segs.length !== 1) return segs
  const commas = splitTop(text, at, ',')
  if (commas.length < 2) return segs
  const worded = commas.every((c) => {
    try {
      const k = findCut(c.text, BRANCH_WORDS, c.at)
      return k !== null && k.kind === 'word'
    } catch {
      return false
    }
  })
  return worded ? commas : segs
}

/**
 * The front door for both new shapes. Returns null when `src` is an ordinary
 * equation, so the plain path stays byte-for-byte what it was.
 */
function parsePieced(src: string, env?: FunctionEnv | null): ParsedPlot | null {
  const cut = findCut(src, COND_WORDS)

  if (cut === null) {
    // y = piecewise(x^2, x < 0, 2x, x >= 0)
    const eqAt = topLevelEq(src)
    const rhs = src.slice(eqAt + 1)
    const m = PIECEWISE_RE.exec(rhs)
    if (!m) return null
    const open = eqAt + 1 + m[0].length - 1
    const close = matchParen(src, open)
    if (close < 0) {
      throw new ParseError(`Missing closing ')' for the '(' at position ${open}`, open)
    }
    if (src.slice(close + 1).trim() !== '') {
      throw new ParseError(`Unexpected text after piecewise(...) at position ${close + 1}`, close + 1)
    }
    const raws = piecewiseCall(src.slice(open + 1, close), open + 1)
    return buildPiecewise(eqAt < 0 ? '' : src.slice(0, eqAt), 0, raws, env)
  }

  // A brace that IS the whole right-hand side is a piecewise body; a brace
  // AFTER an expression is that expression's domain.
  if (cut.kind === 'brace') {
    const head = src.slice(0, cut.at).trim()
    const isBody =
      head === '' ||
      (head.endsWith('=') && (head.length === 1 || !'<>=!'.includes(head.slice(-2, -1))))
    if (isBody) {
      if (src.slice(cut.end).trim() !== '') {
        throw new ParseError(
          `Unexpected text after the piecewise body at position ${cut.end}`,
          cut.end,
        )
      }
      if (cut.cond.trim() === '') {
        throw new ParseError('Empty condition — write something like {0 < x < 3}', cut.at)
      }
      const raws = bodySegments(cut.cond, cut.condAt).map(splitBranch)
      return buildPiecewise(head.slice(0, -1), 0, raws, env)
    }
  }

  return parseRestricted(src, cut, env)
}

/** A piecewise or restricted line, split into text (see piecewiseParts). */
export interface PiecewiseParts {
  /** the text before '=', trimmed ('' when there is none): 'y', 'f(x)' */
  head: string
  /** each branch as typed, trimmed; `cond` is '' for piecewise()'s default */
  branches: { expr: string; cond: string; otherwise: boolean }[]
  /** `expr {cond}`, `expr, cond`, `expr for cond` — one restricted formula */
  restricted: boolean
}

/**
 * The same split parsePieced makes, as TEXT — for src/core/piecewise.ts,
 * which reads a line back into a table and must keep what the teacher typed.
 * Null for a line that is neither piecewise nor restricted, or that the
 * splitter refuses (parseExpression then has the error to report).
 */
export function piecewiseParts(src: string): PiecewiseParts | null {
  try {
    const out = (head: string, raws: RawBranch[], restricted: boolean): PiecewiseParts => ({
      head: head.trim(),
      branches: raws.map((r) => ({ expr: r.expr.trim(), cond: r.cond.trim(), otherwise: r.otherwise })),
      restricted,
    })
    const cut = findCut(src, COND_WORDS)
    if (cut === null) {
      const eqAt = topLevelEq(src)
      const m = PIECEWISE_RE.exec(src.slice(eqAt + 1))
      if (!m) return null
      const open = eqAt + 1 + m[0].length - 1
      const close = matchParen(src, open)
      if (close < 0 || src.slice(close + 1).trim() !== '') return null
      return out(eqAt < 0 ? '' : src.slice(0, eqAt), piecewiseCall(src.slice(open + 1, close), open + 1), false)
    }
    if (cut.kind === 'brace') {
      const head = src.slice(0, cut.at).trim()
      const isBody =
        head === '' ||
        (head.endsWith('=') && (head.length === 1 || !'<>=!'.includes(head.slice(-2, -1))))
      if (isBody) {
        if (src.slice(cut.end).trim() !== '' || cut.cond.trim() === '') return null
        return out(head.slice(0, -1), bodySegments(cut.cond, cut.condAt).map(splitBranch), false)
      }
      if (src.slice(cut.end).trim() !== '') return null
    }
    const base = src.slice(0, cut.at)
    const eqAt = topLevelEq(base)
    const raw: RawBranch = {
      expr: base.slice(eqAt + 1), exprAt: eqAt + 1, cond: cut.cond, condAt: cut.condAt, otherwise: false,
    }
    return out(eqAt < 0 ? '' : base.slice(0, eqAt), [raw], true)
  } catch {
    return null
  }
}

/** Index of the ')' closing the '(' at `i`; -1 when it never closes. */
function matchParen(src: string, i: number): number {
  let depth = 0
  for (let k = i; k < src.length; k++) {
    const c = src[k]
    if (OPENERS.includes(c)) depth++
    else if (CLOSERS.includes(c)) {
      depth--
      if (depth === 0) return src[k] === ')' ? k : -1
    }
  }
  return -1
}

// ----------------------------------------------------------------------------
// Typed parametric curves — the BC particle (see ../motion.ts)
//
//   (2cos(t), 3sin(t))                 a bare ordered pair of t-expressions
//   (x, y) = (t^2, t^3 - 3t)           the same pair with its (x, y) = head
//   x = 2cos(t), y = 3sin(t)           two equations (either order)
//
// followed, optionally, by the t-interval in any of the restriction spellings
//   … {0 <= t <= 2pi}     … for 0 <= t <= 2pi     … , 0 <= t <= 2pi
// (and `[0, 2pi]` / `t in …`, whatever ./condition.ts reads as one interval).
// Without one the interval is [0, 2π] when a trig function of t appears in
// either component — one turn — and [−10, 10] otherwise.
//
// ADDITIVE, by construction: every one of these shapes is an ERROR on the
// ordinary path (a comma inside a bracket, or `x = …` mixing x with t), so
// parseExpression only tries them after the ordinary parse has failed. Nothing
// that parsed before can change; a line that is not shaped like a parametric
// curve keeps its old message word for word. A shape with no t anywhere —
// `(1, 2)`, `x = 2, y = 3` — is not a curve either, and keeps its old error.
//
// Each component is an ordinary expression in t: sliders (shared between the
// two components, in order of first appearance), named calls through the env
// — (f(t), g(t)) — and everything else the engine reads. x, y, r and θ are
// refused inside a component, as are a third component and an interval that
// is not in t. The interval must be one bounded stretch; its bounds are
// constants (a slider bound is not supported: ParsedPlot.domain is fixed).
// ----------------------------------------------------------------------------

/** Trig functions whose argument makes a curve periodic in t. */
const TRIG_OF_T: ReadonlySet<string> = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot'])

/** Does a trig function of t appear anywhere in `n`? */
function hasTrigOfT(n: Node): boolean {
  switch (n.t) {
    case 'call': {
      if (TRIG_OF_T.has(n.fn)) {
        const v = new Set<VarName>()
        collectVars(n.args[0], v)
        if (v.has('t')) return true
      }
      return n.args.some(hasTrigOfT)
    }
    case 'neg': return hasTrigOfT(n.a)
    case 'bin': return hasTrigOfT(n.a) || hasTrigOfT(n.b)
    case 'ucall': return hasTrigOfT(n.arg)
    default: return false
  }
}

/** Default t-interval when none is typed: one turn for trig, [−10, 10] else. */
export const PARAM_TRIG_INTERVAL: [number, number] = [0, 2 * Math.PI]
export const PARAM_PLAIN_INTERVAL: [number, number] = [-10, 10]

interface Span { text: string; at: number }

/** The shape of a parametric line, as text; null when it is not one. */
interface ParamShape {
  comps: Span[]
  interval: Span | null
  /** where the interval marker sits (for messages) */
  intervalAt: number
}

/**
 * The first top-level interval marker: a `{…}` group (not LaTeX's ^{…}) or
 * the word `for`. Commas are the caller's business.
 */
function paramIntervalMarker(src: string): { at: number; cond: Span; brace: boolean; end: number } | null {
  let depth = 0
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '{' && depth === 0) {
      if (/[\^_]\s*$/.test(src.slice(0, i))) continue
      const close = matchBrace(src, i)
      if (close < 0) return null
      return { at: i, cond: { text: src.slice(i + 1, close), at: i + 1 }, brace: true, end: close + 1 }
    }
    if (OPENERS.includes(c)) { depth++; continue }
    if (CLOSERS.includes(c)) { if (depth > 0) depth--; continue }
    if (depth !== 0) continue
    if (/[A-Za-z]/.test(c) && (i === 0 || !/[A-Za-z0-9]/.test(src[i - 1]))) {
      let j = i
      while (j < src.length && /[A-Za-z0-9]/.test(src[j])) j++
      if (src.slice(i, j).toLowerCase() === 'for') {
        return { at: i, cond: { text: src.slice(j), at: j }, brace: false, end: src.length }
      }
      i = j - 1
    }
  }
  return null
}

const PAIR_HEAD_RE = /^\s*\(\s*x\s*,\s*y\s*\)\s*=(?!=)/
const X_EQ_RE = /^\s*x\s*=(?!=)/
const Y_EQ_RE = /^\s*y\s*=(?!=)/
/** `z = …`, `w = …`: a third equation, not an interval */
const LETTER_EQ_RE = /^\s*[A-Za-z]\s*=(?!=)/

/** The segment after its `x =` / `y =`, with its offset. */
function afterEq(seg: Span): Span {
  const k = seg.text.indexOf('=')
  return { text: seg.text.slice(k + 1), at: seg.at + k + 1 }
}

/**
 * Read the ordered pair `( a, b [, c…] )` that `s` consists of (plus an
 * optional `, interval` after it). Null when `s` is not a bracketed list.
 */
function readPair(s: Span): { comps: Span[]; rest: Span | null } | null {
  const lead = s.text.length - s.text.trimStart().length
  const open = lead
  if (s.text[open] !== '(') return null
  const close = matchParen(s.text, open)
  if (close < 0) return null
  const inner = splitTop(s.text.slice(open + 1, close), s.at + open + 1, ',')
  if (inner.length < 2) return null
  const tail = s.text.slice(close + 1)
  if (tail.trim() === '') return { comps: inner, rest: null }
  const t = tail.trimStart()
  if (t[0] !== ',') return null
  const at = s.at + close + 1 + (tail.length - t.length) + 1
  return { comps: inner, rest: { text: t.slice(1), at } }
}

/** Recognise the three spellings. Throws for a malformed one it is sure of. */
function paramShapeOf(src: string): ParamShape | null {
  const marker = paramIntervalMarker(src)
  if (marker && marker.brace && src.slice(marker.end).trim() !== '') return null
  const body: Span = { text: marker ? src.slice(0, marker.at) : src, at: 0 }
  let interval: Span | null = marker ? marker.cond : null
  const intervalAt = marker ? marker.at : -1

  const withRest = (comps: Span[], rest: Span | null): ParamShape | null => {
    if (rest) {
      if (interval) {
        throw new ParseError('Give the t-interval once — e.g. {0 <= t <= 2pi}', rest.at)
      }
      interval = rest
    }
    return { comps, interval, intervalAt: rest ? rest.at : intervalAt }
  }

  // (x, y) = ( … , … )
  const head = PAIR_HEAD_RE.exec(body.text)
  if (head) {
    const pair = readPair({ text: body.text.slice(head[0].length), at: head[0].length })
    return pair ? withRest(pair.comps, pair.rest) : null
  }
  // ( … , … )
  const pair = readPair(body)
  if (pair) return withRest(pair.comps, pair.rest)

  // x = …, y = …   (or y = …, x = …)
  const segs = splitTop(body.text, 0, ',')
  if (segs.length < 2) return null
  const [s0, s1] = segs
  let xs: Span, ys: Span
  if (X_EQ_RE.test(s0.text) && Y_EQ_RE.test(s1.text)) { xs = s0; ys = s1 }
  else if (Y_EQ_RE.test(s0.text) && X_EQ_RE.test(s1.text)) { xs = s1; ys = s0 }
  else return null
  const comps = [afterEq(xs), afterEq(ys)]
  const extra = segs.slice(2)
  for (let i = 0; i < extra.length; i++) {
    if (LETTER_EQ_RE.test(extra[i].text)) comps.push(afterEq(extra[i]))
    else if (i === extra.length - 1) return withRest(comps, extra[i])
    else return null
  }
  return withRest(comps, null)
}

/**
 * Parse a parametric line; null when it is not shaped like one (the caller
 * then reports its own error). Throws ParseError for one that is, but is
 * wrong — a third component, an x in a component, an interval in x.
 */
function parseParametric(src: string, env?: FunctionEnv | null): ParsedPlot | null {
  const shape = paramShapeOf(src)
  if (!shape) return null

  const nodes = shape.comps.map((c) => {
    if (c.text.trim() === '') {
      throw new ParseError('Each component needs a formula in t, e.g. (cos(t), sin(t))', c.at)
    }
    return atOffset(c.at, () => {
      const { lhs, rhs } = new Parser(c.text, env).parseInput()
      if (rhs !== null) throw new ParseError(`A component is a formula in t, not an equation — drop the '='`)
      return lhs
    })
  })
  const varsOf = nodes.map((n) => { const v = new Set<VarName>(); collectVars(n, v); return v })
  const anyT = varsOf.some((v) => v.has('t'))
  const bad = varsOf.findIndex((v) => v.has('x') || v.has('y') || v.has('r') || v.has('theta'))
  // a pair of plain numbers is a point, not a curve — not ours to claim
  if (!anyT && bad < 0) return null
  if (nodes.length !== 2) {
    throw new ParseError(
      `A parametric curve has two components, x(t) and y(t) — this one has ${nodes.length}`,
      shape.comps[2].at,
    )
  }
  if (bad >= 0) {
    const v = varsOf[bad]
    const name = v.has('x') ? 'x' : v.has('y') ? 'y' : v.has('r') ? 'r' : 'θ'
    throw new ParseError(
      `Each component of a parametric curve is a formula in t — ${bad === 0 ? 'x(t)' : 'y(t)'} cannot use ${name}`,
      shape.comps[bad].at,
    )
  }

  // the sliders of both components, one shared list in order of appearance
  const paramNames: string[] = []
  const index = new Map<string, number>()
  for (const n of nodes) reindexParams(n, paramNames, index)
  const logBases = logBaseParams(nodes)

  let domain: [number, number]
  let intervalTex: string
  if (shape.interval) {
    const iv = shape.interval
    if (iv.text.trim() === '') {
      throw new ParseError('Empty interval — write something like {0 <= t <= 2pi}', shape.intervalAt)
    }
    const ctx = newCtx(analyzeExpr)
    const pieces = atOffset(0, () => parseCondition(iv.text, ctx, iv.at))
    if (ctx.name !== null && ctx.name !== 't') {
      const nm = ctx.name === 'theta' ? 'θ' : ctx.name
      throw new ParseError(
        `The interval is about '${nm}', but a parametric curve runs in t — write it as {0 <= t <= 2pi}`,
        ctx.pos,
      )
    }
    const p = pieces.length === 1 ? pieces[0] : null
    if (!p || !Number.isFinite(p.lo) || !Number.isFinite(p.hi) || !(p.hi > p.lo)) {
      throw new ParseError(
        'The t-interval must be one stretch with both ends, e.g. {0 <= t <= 2pi}',
        iv.at,
      )
    }
    domain = [p.lo, p.hi]
    intervalTex = compactLatex([p], 't')
  } else if (nodes.some(hasTrigOfT)) {
    domain = [PARAM_TRIG_INTERVAL[0], PARAM_TRIG_INTERVAL[1]]
    intervalTex = '0 \\leq t \\leq 2\\pi'
  } else {
    domain = [PARAM_PLAIN_INTERVAL[0], PARAM_PLAIN_INTERVAL[1]]
    intervalTex = '-10 \\leq t \\leq 10'
  }

  const latex = `\\left(${toLatex(nodes[0])},\\ ${toLatex(nodes[1])}\\right),\\ ${intervalTex}`
  const ex = compile(nodes[0])
  const ey = compile(nodes[1])
  const defaultParams = defaultsOf(paramNames, logBases)
  return {
    kind: 'parametric',
    latex,
    paramNames,
    defaultParams,
    domain,
    makeModel(modelId: string): ModelSpec {
      return {
        id: modelId,
        kind: 'parametric',
        name: 'Expression',
        latex: () => latex,
        paramMeta: (params: number[]) =>
          paramNames.map((nm, i) => metaFor(nm, params[i] ?? defaultParams[i])),
        evalParametric: (params, t) => ({ x: ex(params, t, 0), y: ey(params, t, 0) }),
      }
    },
  }
}

/** parseParametric as an outcome; null when the line is not parametric-shaped. */
function tryParametric(src: string, env?: FunctionEnv | null): ParseOutcome | null {
  try {
    const plot = parseParametric(src, env)
    return plot ? { ok: true, plot } : null
  } catch (err) {
    if (err instanceof ParseError) {
      return err.pos !== undefined
        ? { ok: false, error: err.message, pos: err.pos }
        : { ok: false, error: err.message }
    }
    if (err instanceof CondError) {
      return err.pos !== undefined
        ? { ok: false, error: err.message, pos: err.pos }
        : { ok: false, error: err.message }
    }
    return null
  }
}

// ----------------------------------------------------------------------------
// Two-variable inequalities — regions of the plane
//
//   y < x^2 - 4      y >= 2x + 1      x > 3      x <= -1
//   x + 2y <= 8      x^2 + y^2 < 9    2 < y < x + 3      y ≤ a x + b
//
// A line is an inequality when its TOP LEVEL (outside every bracket) carries
// one or two relation signs and no bare '='. That keeps every line that
// parsed before parsing exactly as it did: `y = x^2 {x < 2}` has its '<'
// inside braces, and `y = x^2 for x > 0` has an '='.
//
// Each side is parsed by the ordinary Pratt parser (the sides share one
// param table, so `y < a x + b` has sliders a and b in order of appearance)
// and every inequality of the chain becomes a PART, stated as s(x, y) > 0
// (strict) or ≥ 0 — s is R − L for < and ≤, L − R for > and ≥. A part is
// then read structurally, from the AST:
//
//   s linear in y with a coefficient B free of x   → y-part: boundary
//       y = −A(x)/B, shaded above when B > 0 and below when B < 0 (the sign
//       is read at the CURRENT params, so a slider that flips B flips the side)
//   s free of y and linear in x                      → x-part: x = c
//   anything else                                    → implicit: s = 0
//
// The curve on the board is the BOUNDARY: explicit y = f(x) for a single
// y-part (with the full typed-explicit machinery — holes, exact values,
// Taylor — when the line literally reads y < f(x)), implicit otherwise (the
// product of the parts' s for a compound, whose zero set is both boundaries).
// ModelSpec.inequality(params) carries the rest.
// ----------------------------------------------------------------------------

interface RelCut {
  at: number
  len: number
  rel: IneqRel
}

const REL_LATEX: Record<IneqRel, string> = { '<': '<', '<=': '\\le', '>': '>', '>=': '\\ge' }
const REL_TEXT: Record<IneqRel, string> = { '<': '<', '<=': '≤', '>': '>', '>=': '≥' }

/**
 * The top-level relation signs of a line — `<`, `>`, `≤`, `≥`, `<=`, `>=`,
 * `=<`, `=>` (and ⩽ ⩾ ≦ ≧) — or null when the line is not an inequality: it
 * has none, it has a bare '=' (an equation, possibly restricted), or it uses
 * a condition word (for / if / where / when / and / or).
 */
export function inequalityCuts(src: string): RelCut[] | null {
  let depth = 0
  const cuts: RelCut[] = []
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (OPENERS.includes(c)) {
      depth++
      continue
    }
    if (CLOSERS.includes(c)) {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (depth > 0) continue
    const two = src.slice(i, i + 2)
    if (two === '<=' || two === '=<') {
      cuts.push({ at: i, len: 2, rel: '<=' })
      i++
      continue
    }
    if (two === '>=' || two === '=>') {
      cuts.push({ at: i, len: 2, rel: '>=' })
      i++
      continue
    }
    if (c === '≤' || c === '⩽' || c === '≦') cuts.push({ at: i, len: 1, rel: '<=' })
    else if (c === '≥' || c === '⩾' || c === '≧') cuts.push({ at: i, len: 1, rel: '>=' })
    else if (c === '<') cuts.push({ at: i, len: 1, rel: '<' })
    else if (c === '>') cuts.push({ at: i, len: 1, rel: '>' })
    else if (c === '=' || c === '≠') return null
  }
  if (cuts.length === 0) return null
  if (/(^|[^A-Za-z])(for|if|where|when|and|or)([^A-Za-z]|$)/i.test(src)) return null
  return cuts
}

const ZERO_NODE: Node = { t: 'num', v: 0, raw: '0' }
const ONE_NODE: Node = { t: 'num', v: 1, raw: '1' }

function usesVar(n: Node, v: VarName): boolean {
  const s = new Set<VarName>()
  collectVars(n, s)
  return s.has(v)
}

/** n = a + b·v with a and b free of v; null when n is not linear in v. */
function linIn(n: Node, v: VarName): { a: Node; b: Node } | null {
  if (!usesVar(n, v)) return { a: n, b: ZERO_NODE }
  switch (n.t) {
    case 'var':
      return { a: ZERO_NODE, b: ONE_NODE }
    case 'neg': {
      const r = linIn(n.a, v)
      return r ? { a: { t: 'neg', a: r.a }, b: { t: 'neg', a: r.b } } : null
    }
    case 'bin': {
      if (n.op === '+' || n.op === '-') {
        const l = linIn(n.a, v)
        const r = linIn(n.b, v)
        if (!l || !r) return null
        return {
          a: { t: 'bin', op: n.op, a: l.a, b: r.a },
          b: { t: 'bin', op: n.op, a: l.b, b: r.b },
        }
      }
      if (n.op === '*') {
        if (!usesVar(n.a, v)) {
          const r = linIn(n.b, v)
          return r ? { a: { t: 'bin', op: '*', a: n.a, b: r.a }, b: { t: 'bin', op: '*', a: n.a, b: r.b } } : null
        }
        if (!usesVar(n.b, v)) {
          const l = linIn(n.a, v)
          return l ? { a: { t: 'bin', op: '*', a: l.a, b: n.b }, b: { t: 'bin', op: '*', a: l.b, b: n.b } } : null
        }
        return null
      }
      if (n.op === '/') {
        if (usesVar(n.b, v)) return null
        const l = linIn(n.a, v)
        return l ? { a: { t: 'bin', op: '/', a: l.a, b: n.b }, b: { t: 'bin', op: '/', a: l.b, b: n.b } } : null
      }
      if (n.op === '^' && n.b.t === 'num' && n.b.v === 1) return linIn(n.a, v)
      return null
    }
    default:
      return null
  }
}

/** How one part of the chain is read (structure only; numbers come at params). */
interface PartPlan {
  kind: 'y' | 'x' | 'implicit'
  strict: boolean
  /** s(x, y): the region is s > 0 / s ≥ 0. */
  s: Evaluator
  /** y-part: A(x) and B of s = A(x) + B·y. x-part: A and B of s = A + B·x. */
  A: Evaluator | null
  B: Evaluator | null
  /** The explicit body when the line literally reads y < body (or body > y). */
  literal: Node | null
  literalEv: Evaluator | null
  /** s = a·x + b·y + c with a, b, c free of x and y. */
  lin: { a: Evaluator; b: Evaluator; c: Evaluator } | null
  boundaryLatex: string
  boundaryText: string
  terms: [number, number]
}

function planPart(
  L: Node,
  rel: IneqRel,
  R: Node,
  texts: [string, string],
  terms: [number, number],
): PartPlan {
  const less = rel === '<' || rel === '<='
  const strict = rel === '<' || rel === '>'
  const sNode: Node = less ? { t: 'bin', op: '-', a: R, b: L } : { t: 'bin', op: '-', a: L, b: R }
  // A side that is the bare variable goes first: 2 < y has the boundary
  // y = 2, not 2 = y.
  const flip =
    (isVar(R, 'y') && !usesVar(L, 'y')) || (isVar(R, 'x') && !usesVar(L, 'x') && !usesVar(L, 'y'))
  const [bl, br] = flip ? [R, L] : [L, R]
  const [tl, tr] = flip ? [texts[1], texts[0]] : texts
  const boundaryLatex = `${toLatex(bl)} = ${toLatex(br)}`
  const boundaryText = `${prettyMath(tl)} = ${prettyMath(tr)}`
  const s = compile(sNode)
  let lin: PartPlan['lin'] = null
  const ly = linIn(sNode, 'y')
  if (ly && !usesVar(ly.b, 'x')) {
    const lx = linIn(ly.a, 'x')
    if (lx && !usesVar(lx.b, 'y') && !usesVar(lx.a, 'x')) {
      lin = { a: compile(lx.b), b: compile(ly.b), c: compile(lx.a) }
    }
  }
  const base = { strict, s, lin, boundaryLatex, boundaryText, terms }
  if (!usesVar(sNode, 'y')) {
    const lx = linIn(sNode, 'x')
    if (lx && !usesVar(lx.b, 'x') && usesVar(sNode, 'x')) {
      return { ...base, kind: 'x', A: compile(lx.a), B: compile(lx.b), literal: null, literalEv: null }
    }
    return { ...base, kind: 'implicit', A: null, B: null, literal: null, literalEv: null }
  }
  if (ly && !usesVar(ly.b, 'x')) {
    let literal: Node | null = null
    if (isVar(L, 'y') && !usesVar(R, 'y')) literal = R
    else if (isVar(R, 'y') && !usesVar(L, 'y')) literal = L
    return {
      ...base,
      kind: 'y',
      A: compile(ly.a),
      B: compile(ly.b),
      literal,
      literalEv: literal ? compile(literal) : null,
    }
  }
  return { ...base, kind: 'implicit', A: null, B: null, literal: null, literalEv: null }
}

/** Far points: a region that holds at none of them is bounded ("inside"). */
const FAR_PROBES: readonly Vec2Like[] = (() => {
  const out: Vec2Like[] = []
  for (const r of [1e3, 1e5]) {
    for (let k = 0; k < 16; k++) {
      const a = (2 * Math.PI * (k + 0.37)) / 16
      out.push({ x: r * Math.cos(a), y: r * Math.sin(a) })
    }
    // Straight up the axes too: x² < 4 is a strip, not the inside of anything.
    out.push({ x: 0, y: r }, { x: 0, y: -r }, { x: r, y: 0 }, { x: -r, y: 0 })
  }
  return out
})()

interface Vec2Like {
  x: number
  y: number
}

function implicitSide(s: (x: number, y: number) => number): IneqSide {
  let yes = 0
  let no = 0
  for (const p of FAR_PROBES) {
    const v = s(p.x, p.y)
    if (v >= 0) yes++
    else no++
  }
  if (yes === 0) return 'inside'
  if (no === 0) return 'outside'
  return 'where'
}

/** A small number for a solved boundary's text and KaTeX: 4, −1/2, 2.35. */
function niceCoef(v: number): { tex: string; text: string; one: boolean; zero: boolean; neg: boolean } {
  const neg = v < 0
  const a = Math.abs(v)
  const zero = a < 1e-12
  let tex = ''
  let text = ''
  let found = false
  for (let q = 1; q <= 12 && !found; q++) {
    const p = Math.round(a * q)
    if (Math.abs(a * q - p) < 1e-9 * Math.max(1, a * q)) {
      found = true
      if (q === 1) {
        tex = String(p)
        text = String(p)
      } else {
        tex = `\\frac{${p}}{${q}}`
        text = `${p}/${q}`
      }
    }
  }
  if (!found) {
    const t = String(Number(a.toPrecision(4)))
    tex = t
    text = t
  }
  return { tex, text, one: Math.abs(a - 1) < 1e-12, zero, neg }
}

/** y = m x + k (or x = c) in KaTeX and in Unicode, from numbers. */
function solvedLine(kind: 'y' | 'x', m: number, k: number): { tex: string; text: string } {
  if (kind === 'x') {
    const c = niceCoef(k)
    return { tex: `x = ${c.neg && !c.zero ? '-' : ''}${c.tex}`, text: `x = ${c.neg && !c.zero ? '−' : ''}${c.text}` }
  }
  const M = niceCoef(m)
  const K = niceCoef(k)
  let tex = 'y = '
  let text = 'y = '
  if (!M.zero) {
    const coefTex = M.one ? '' : M.tex
    const coefText = M.one ? '' : M.text.includes('/') ? `(${M.text})` : M.text
    tex += `${M.neg ? '-' : ''}${coefTex}x`
    text += `${M.neg ? '−' : ''}${coefText}x`
    if (!K.zero) {
      tex += ` ${K.neg ? '-' : '+'} ${K.tex}`
      text += ` ${K.neg ? '−' : '+'} ${K.text}`
    }
  } else {
    tex += `${K.neg && !K.zero ? '-' : ''}${K.tex}`
    text += `${K.neg && !K.zero ? '−' : ''}${K.text}`
  }
  return { tex, text }
}

/** Is this word one of the parser's own names (sin, sqrt, pi, e, x …)? */
export function isReservedWord(w: string): boolean {
  return isKnownName(w) || w === 'log_'
}

function parseRegion(src: string, cuts: RelCut[], env?: FunctionEnv | null): ParsedPlot {
  if (cuts.length > 2) {
    throw new ParseError(
      `At most two inequality signs — a compound inequality reads like 2 < y < x + 3 (unexpected sign at position ${cuts[2].at})`,
      cuts[2].at,
    )
  }
  // A restriction has no meaning on a region yet; saying so beats the
  // parser's "Unexpected character '{'".
  {
    let depth = 0
    for (let i = 0; i < src.length; i++) {
      const c = src[i]
      if (c === '{' && depth === 0) {
        throw new ParseError(
          `A restriction { … } on an inequality is not supported — add the condition as another inequality instead (x > 0) (position ${i})`,
          i,
        )
      }
      if (OPENERS.includes(c)) depth++
      else if (CLOSERS.includes(c)) depth = Math.max(0, depth - 1)
    }
  }
  const segs: { text: string; at: number }[] = []
  let from = 0
  for (const c of cuts) {
    segs.push({ text: src.slice(from, c.at), at: from })
    from = c.at + c.len
  }
  segs.push({ text: src.slice(from), at: from })
  for (let k = 0; k < segs.length; k++) {
    if (segs[k].text.trim() === '') {
      const pos = k === 0 ? cuts[0].at : cuts[k - 1].at + cuts[k - 1].len
      throw new ParseError(
        k === 0
          ? `Nothing before '${REL_TEXT[cuts[0].rel]}' — an inequality compares two expressions, like y < x^2 (position ${pos})`
          : `Nothing after '${REL_TEXT[cuts[k - 1].rel]}' at position ${pos}`,
        pos,
      )
    }
  }
  if (cuts.length === 2) {
    const up = (r: IneqRel): boolean => r === '<' || r === '<='
    if (up(cuts[0].rel) !== up(cuts[1].rel)) {
      throw new ParseError(
        `A compound inequality points one way — 2 < y < x + 3, or 5 > y > x (position ${cuts[1].at})`,
        cuts[1].at,
      )
    }
  }

  let shared: Parser | null = null
  const nodes: Node[] = segs.map((seg) =>
    atOffset(seg.at, () => {
      const p = new Parser(seg.text, env)
      if (shared) {
        p.paramIndex = shared.paramIndex
        p.paramNames = shared.paramNames
      } else shared = p
      const { lhs, rhs } = p.parseInput()
      if (rhs !== null) throw new ParseError("An inequality has no '=' of its own — write ≤ as <=")
      return lhs
    }),
  )
  const paramNames = shared ? [...(shared as Parser).paramNames] : []
  const vars = new Set<VarName>()
  for (const n of nodes) collectVars(n, vars)
  if (vars.has('r') || vars.has('theta') || vars.has('t')) {
    throw new ParseError('An inequality on a graph board is in x and y — r, θ and t are not used here')
  }
  if (!vars.has('x') && !vars.has('y')) {
    throw new ParseError('This inequality has no x or y to shade — try y < 2x + 1')
  }

  const rels = cuts.map((c) => c.rel)
  const plans: PartPlan[] = []
  for (let k = 0; k < rels.length; k++) {
    plans.push(planPart(nodes[k], rels[k], nodes[k + 1], [segs[k].text, segs[k + 1].text], [k, k + 1]))
  }
  const latex = nodes.map((n, k) => (k === 0 ? toLatex(n) : `${REL_LATEX[rels[k - 1]]} ${toLatex(n)}`)).join(' ')
  const termEvals = nodes.map((n) => compile(n))
  const termTexts = segs.map((s) => s.text.trim())
  const logBases = logBaseParams(nodes)

  const single = plans.length === 1 ? plans[0] : null
  let kind: CurveKind
  let ev: Evaluator
  let body: Node | null = null
  if (single && single.kind === 'y') {
    kind = 'explicit'
    if (single.literal) {
      body = single.literal
      ev = compile(single.literal)
    } else {
      const A = single.A!
      const B = single.B!
      ev = (p, x) => -A(p, x, 0) / B(p, x, 0)
    }
  } else {
    kind = 'implicit'
    ev = plans.length === 1 ? plans[0].s : (p, x, y) => plans[0].s(p, x, y) * plans[1].s(p, x, y)
  }

  const infoAt = (params: number[]): InequalityInfo => {
    const P = params.slice()
    const parts: IneqPart[] = plans.map((pl) => {
      const s = (x: number, y: number): number => pl.s(P, x, y)
      let linear: IneqPart['linear']
      if (pl.lin) {
        const a = pl.lin.a(P, 0, 0)
        const b = pl.lin.b(P, 0, 0)
        const c = pl.lin.c(P, 0, 0)
        if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && (a !== 0 || b !== 0)) {
          linear = { a, b, c }
        }
      }
      const common = {
        s,
        strict: pl.strict,
        boundaryLatex: pl.boundaryLatex,
        boundaryText: pl.boundaryText,
        terms: pl.terms,
        ...(linear ? { linear } : {}),
      }
      if (pl.kind === 'y') {
        const B = pl.B!(P, 0, 0)
        if (Number.isFinite(B) && B !== 0) {
          const A = pl.A!
          const lit = pl.literalEv
          const f = lit ? (x: number): number => lit(P, x, 0) : (x: number): number => -A(P, x, 0) / B
          const part: IneqPart = { ...common, boundary: { kind: 'y', f }, side: B > 0 ? 'above' : 'below' }
          if (linear && !pl.literal) {
            const sl = solvedLine('y', -linear.a / linear.b, -linear.c / linear.b)
            part.boundaryLatex = `${pl.boundaryLatex}\\;\\Leftrightarrow\\; ${sl.tex}`
          }
          return part
        }
      } else if (pl.kind === 'x') {
        const B = pl.B!(P, 0, 0)
        const A = pl.A!(P, 0, 0)
        if (Number.isFinite(B) && B !== 0 && Number.isFinite(A)) {
          const c = -A / B
          const part: IneqPart = { ...common, boundary: { kind: 'x', c }, side: B > 0 ? 'right' : 'left' }
          const sl = solvedLine('x', 0, c)
          if (!(pl.boundaryText.replace(/\s/g, '') === sl.text.replace(/\s/g, ''))) {
            part.boundaryLatex = `${pl.boundaryLatex}\\;\\Leftrightarrow\\; ${sl.tex}`
          }
          return part
        }
      }
      return { ...common, boundary: { kind: 'implicit', F: s }, side: implicitSide(s) }
    })
    return {
      parts,
      terms: termTexts,
      rels,
      term: (i, x, y) => termEvals[i](P, x, y),
      paramNames,
      params: P,
    }
  }

  const plot = makePlot(kind, latex, paramNames, null, ev, body ? singPlanOf(body) : null, logBases, null, body)
  return {
    ...plot,
    makeModel(modelId: string): ModelSpec {
      const spec = plot.makeModel(modelId)
      // The renderer asks every frame: the last answer is kept per params.
      let lastKey = ''
      let last: InequalityInfo | null = null
      spec.inequality = (params: number[]) => {
        const key = params.join(',')
        if (last && key === lastKey) return last
        last = infoAt(params)
        lastKey = key
        return last
      }
      return spec
    },
  }
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Parse one typed line into a plot.
 *
 * `env` (optional) names the curves the line may call — f(x − 1), f(g(x)),
 * f'(x), f''(x) — each evaluated through env.eval at the moment the model is
 * evaluated, never snapshotted (see ../functionEnv.ts). Without it, or for a
 * letter it does not define, every input parses exactly as it always has.
 * A line `f(x) = …` whose own name the env has cannot call f: that is a
 * positioned error.
 */
export function parseExpression(src: string, env?: FunctionEnv | null): ParseOutcome {
  try {
    if (!src || src.trim() === '') {
      return { ok: false, error: 'Empty expression' }
    }
    // "y < x^2 - 4", "x + 2y <= 8", "2 < y < x + 3": a region, not a curve.
    // Only a line whose top level carries a relation sign and no '=' comes
    // here, so every line that parsed before parses exactly as it did.
    const cuts = inequalityCuts(src)
    if (cuts) return { ok: true, plot: parseRegion(src, cuts, env) }
    // "y = x^2 {0 <= x < 3}", "y = { x^2 if x < 0 ; 2x if x >= 0 }", ...
    const restricted = parsePieced(src, env)
    if (restricted) return { ok: true, plot: restricted }

    const { cls, paramNames, logBases } = compileEquation(src, env)
    return {
      ok: true,
      plot: makePlot(
        cls.kind, cls.latex, paramNames, cls.domain, cls.ev, singPlanOf(cls.body), logBases, null, cls.body,
      ),
    }
  } catch (err) {
    // Only a line the ordinary path REFUSED is tried as a parametric curve,
    // so nothing that parsed before can change (see parseParametric).
    const param = tryParametric(src, env)
    if (param) return param
    if (err instanceof ParseError) {
      return err.pos !== undefined
        ? { ok: false, error: err.message, pos: err.pos }
        : { ok: false, error: err.message }
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ----------------------------------------------------------------------------
// Sub-expression analysis — used by the inequality parser (./inequality.ts) so
// that interval bounds can be arbitrary constant expressions (2*pi, sqrt(2),
// -3/4) without anyone having to write a second tokenizer.
// ----------------------------------------------------------------------------

export type ExprAnalysis =
  | {
      ok: true
      /** value of the expression; only meaningful when `free` is empty */
      value: number
      latex: string
      /**
       * Names that stop the expression from being a constant: the reserved
       * variables (x, y, r, θ, t) and any single-letter free constants.
       */
      free: string[]
    }
  | { ok: false; error: string; pos?: number }

const NO_PARAMS: readonly number[] = []

/**
 * Parse one self-contained expression and report whether it is constant.
 * Positions in errors are relative to `src`.
 */
export function analyzeExpr(src: string, env?: FunctionEnv | null): ExprAnalysis {
  try {
    if (!src || src.trim() === '') return { ok: false, error: 'Empty expression' }
    // With an env, f(2) is a constant too — its value is f's value NOW
    const parser = new Parser(src, env)
    const { lhs, rhs } = parser.parseInput()
    if (rhs !== null) return { ok: false, error: "Unexpected '='" }
    const vars = new Set<VarName>()
    collectVars(lhs, vars)
    const free = [...vars, ...parser.paramNames]
    const value = free.length === 0 ? compile(lhs)(NO_PARAMS, NaN, NaN) : NaN
    return { ok: true, value, latex: toLatex(lhs), free }
  } catch (err) {
    if (err instanceof ParseError) {
      return err.pos !== undefined
        ? { ok: false, error: err.message, pos: err.pos }
        : { ok: false, error: err.message }
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ----------------------------------------------------------------------------
// Whole-expression compilation — used by the slope-field parser
// (./slopeField.ts), which needs the compiled closure that `analyzeExpr` only
// constant-folds away. Same tokenizer, same Pratt parser, same LaTeX emitter;
// the only difference is that the caller keeps the evaluator and decides for
// itself which variables are legal.
//
// No cycle: ./slopeField.ts imports this module, never the other way round.
// ----------------------------------------------------------------------------

export interface CompiledExpr {
  /** `(params, x, y) => value` — one closure, no per-call parsing */
  ev: (params: readonly number[], x: number, y: number) => number
  latex: string
  /** reserved variables actually used, e.g. ['x', 'y'] */
  vars: string[]
  /** single-letter free constants, in order of first appearance */
  paramNames: string[]
}

export type CompileOutcome =
  | { ok: true; expr: CompiledExpr }
  | { ok: false; error: string; pos?: number }

/**
 * Parse and compile one self-contained expression (no '='). Positions in
 * errors are relative to `src`.
 */
export function compileExpr(src: string, env?: FunctionEnv | null): CompileOutcome {
  try {
    if (!src || src.trim() === '') return { ok: false, error: 'Empty expression' }
    // With an env, the closure calls named curves live, as parseExpression's does
    const parser = new Parser(src, env)
    const { lhs, rhs } = parser.parseInput()
    if (rhs !== null) return { ok: false, error: "Unexpected '='" }
    const vars = new Set<VarName>()
    collectVars(lhs, vars)
    const ev = compile(lhs)
    return {
      ok: true,
      expr: {
        ev: (params, x, y) => ev(params, x, y),
        latex: toLatex(lhs),
        vars: [...vars],
        paramNames: [...parser.paramNames],
      },
    }
  } catch (err) {
    if (err instanceof ParseError) {
      return err.pos !== undefined
        ? { ok: false, error: err.message, pos: err.pos }
        : { ok: false, error: err.message }
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ----------------------------------------------------------------------------
// Raw AST access — used by ./factored.ts, which reads a typed product of
// factors structurally (roots, multiplicities, the leading coefficient)
// instead of re-parsing the source with regular expressions. Same tokenizer
// and Pratt parser; no head handling (`f(x) =` stays the implicit product
// f·x on the left), no piecewise/restriction syntax, nothing compiled.
// ----------------------------------------------------------------------------

/** The parser's own AST node (read-only use outside this module). */
export type ExprNode = Node

export type AstOutcome =
  | { ok: true; lhs: ExprNode; rhs: ExprNode | null }
  | { ok: false; error: string; pos?: number }

/** Parse `lhs ( '=' rhs )?` into the raw AST. */
export function parseAst(src: string): AstOutcome {
  try {
    if (!src || src.trim() === '') return { ok: false, error: 'Empty expression' }
    const { lhs, rhs } = new Parser(src).parseInput()
    return { ok: true, lhs, rhs }
  } catch (err) {
    if (err instanceof ParseError) {
      return err.pos !== undefined
        ? { ok: false, error: err.message, pos: err.pos }
        : { ok: false, error: err.message }
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Evaluate an AST node at `x` (free constants read as NaN, y as NaN). */
export function evalAst(n: ExprNode, x: number): number {
  return compile(n)(NO_PARAMS, x, NaN)
}

// ----------------------------------------------------------------------------
// Named-call sites — used by ../functionEnv.ts (referencedNames), which must
// say which curves a line calls BEFORE any env exists, so the App can order
// and wire curves before parsing them. Same tokenizer, so a letter is a call
// here exactly when the parser, given an env with that letter, would call it.
// ----------------------------------------------------------------------------

export interface NamedCallSite {
  name: string
  /** offset of the letter in the source */
  pos: number
  /** 0 = f(u), 1 = f'(u), 2 = f''(u) */
  order: 0 | 1 | 2
}

/**
 * Every single letter that is not a built-in name (x, y, r, t, e) and is
 * followed IMMEDIATELY by `(`, `'(` or `''(` — in source order, repeats
 * included — except the base of log_b(…) and the head of a definition
 * `g(x) = …` (whose name is returned as `head`). `a(x + 1)` IS listed: the
 * letter is a call exactly when some curve is named a; the caller decides.
 * Never throws: characters the expression grammar does not know (conditions,
 * braces) are skipped.
 */
export function namedCallSites(src: string): { head: string | null; sites: NamedCallSite[] } {
  const sites: NamedCallSite[] = []
  if (typeof src !== 'string' || src.trim() === '') return { head: null, sites }
  let head: string | null = null
  const m = DEF_HEAD_RE.exec(src)
  if (m && !isKnownName(m[1]) && VAR_NAMES.has(m[2] === 'θ' ? 'theta' : m[2])) head = m[1]
  let toks: Token[]
  try {
    toks = tokenize(src, () => true, true)
  } catch {
    return { head, sites }
  }
  for (let i = 0; i < toks.length - 1; i++) {
    const tok = toks[i]
    if (tok.type !== 'ident' || tok.text.length !== 1 || isKnownName(tok.text)) continue
    if (i > 0 && toks[i - 1].type === 'ident' && toks[i - 1].text === 'log_') continue // log_b(x)
    const nxt = toks[i + 1]
    const primes = tok.primes ?? 0
    if (nxt.type !== 'lparen' || nxt.pos !== tok.pos + 1 + primes) continue
    if (head !== null && i === 0 && primes === 0) continue // the head g of g(x) = …
    sites.push({ name: tok.text, pos: tok.pos, order: primes as 0 | 1 | 2 })
  }
  return { head, sites }
}

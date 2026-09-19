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
// ============================================================================

import type { CurveKind, ModelSpec, ParamMeta, ParseOutcome, ParsedPlot } from '../types'
import {
  CondError,
  compactLatex,
  exclusionLatex,
  excludedPoints,
  extentOf,
  inPieces,
  newCtx,
  parseCondition,
  setLatex,
  WHOLE_LINE,
  type CondCtx,
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

const FUNCS: Record<string, FuncDef> = {
  sin:   { arity: 1, fn: (a) => Math.sin(a),   latex: (x) => `\\sin${wrap(x[0])}` },
  cos:   { arity: 1, fn: (a) => Math.cos(a),   latex: (x) => `\\cos${wrap(x[0])}` },
  tan:   { arity: 1, fn: (a) => Math.tan(a),   latex: (x) => `\\tan${wrap(x[0])}` },
  asin:  { arity: 1, fn: (a) => Math.asin(a),  latex: (x) => `\\arcsin${wrap(x[0])}` },
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
  exp:   { arity: 1, fn: (a) => Math.exp(a),   latex: (x) => `\\exp${wrap(x[0])}` },
  floor: { arity: 1, fn: (a) => Math.floor(a), latex: (x) => `\\left\\lfloor ${x[0]}\\right\\rfloor` },
  ceil:  { arity: 1, fn: (a) => Math.ceil(a),  latex: (x) => `\\left\\lceil ${x[0]}\\right\\rceil` },
  sign:  { arity: 1, fn: (a) => Math.sign(a),  latex: (x) => `\\operatorname{sign}${wrap(x[0])}` },
  min:   { arity: 2, fn: (a, b) => Math.min(a, b), latex: (x) => `\\min${wrap(`${x[0]},\\,${x[1]}`)}` },
  max:   { arity: 2, fn: (a, b) => Math.max(a, b), latex: (x) => `\\max${wrap(`${x[0]},\\,${x[1]}`)}` },
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
  const candidates = [...Object.keys(FUNCS), ...Object.keys(CONSTS), 'theta']
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
  return w in FUNCS || w in CONSTS || VAR_NAMES.has(w)
}

type TokType = 'num' | 'ident' | 'op' | 'lparen' | 'rparen' | 'comma' | 'eq' | 'bar' | 'end'
interface Token { type: TokType; text: string; pos: number; value: number }

const NUM_RE = /^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/

function tokenize(src: string): Token[] {
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
      if (!/[0-9]/.test(word) || isKnownName(word)) {
        // pure letters (parser classifies / errors) or a known digit-bearing
        // name such as log2
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

  constructor(src: string) {
    this.toks = tokenize(src)
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

  private identNud(tok: Token): Node {
    const w = tok.text
    const fdef = FUNCS[w]
    if (fdef) {
      if (this.peek().type === 'lparen') {
        this.next()
        const args: Node[] = [this.parseExpr(0)]
        if (fdef.arity === 2) {
          const comma = this.peek()
          if (comma.type !== 'comma') this.fail(comma, `',' ('${w}' takes two arguments)`)
          this.next()
          args.push(this.parseExpr(0))
        }
        const close = this.peek()
        if (close.type === 'comma') {
          throw new ParseError(
            `'${w}' takes ${fdef.arity === 1 ? 'one argument' : 'two arguments'} — unexpected ',' at position ${close.pos}`,
            close.pos,
          )
        }
        if (close.type !== 'rparen') this.fail(close, "')'")
        this.next()
        return { t: 'call', fn: w, args }
      }
      if (fdef.arity === 2) {
        throw new ParseError(`'${w}' needs parentheses, e.g. ${w}(a, b)`, tok.pos)
      }
      // paren-less application: binds a full product, stops at + / -
      const nxt = this.peek()
      if (!this.startsExpr(nxt) && !(nxt.type === 'op' && (nxt.text === '-' || nxt.text === '+'))) {
        throw new ParseError(`'${w}' needs an argument, e.g. ${w}(x)`, tok.pos)
      }
      const arg = this.parseExpr(BP_ADD)
      return { t: 'call', fn: w, args: [arg] }
    }
    if (VAR_NAMES.has(w)) return { t: 'var', name: w as VarName }
    if (w in CONSTS) return { t: 'const', name: w as keyof typeof CONSTS }
    if (w.length === 1) return this.registerParam(w)
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
          return (p, a, b) => Math.pow(f(p, a, b), g(p, a, b))
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
  }
  throw new ParseError('internal compile error')
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
    case 'call': return 4
    case 'neg': return 1
    case 'bin':
      switch (n.op) {
        case '+': case '-': return 1
        case '*': return 2
        case '/': return isAtomic(n.a) && isAtomic(n.b) ? 2 : 4 // \frac is self-delimiting
        case '^': return 3
      }
  }
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
  if (/[0-9]$/.test(ls) && /^e/.test(rs)) return ' \\cdot '
  const leftEndsLetter = /[A-Za-z]$/.test(ls)
  if (leftEndsLetter && (/^[A-Za-z]/.test(rs) || GREEK_STARTS.some((g) => rs.startsWith(g)))) {
    return '\\,' // thin space keeps "a x" as a\,x and never glues letters into "\pix"
  }
  return ''
}

function toLatex(n: Node): string {
  switch (n.t) {
    case 'num': return numLatex(n.raw)
    case 'const': return CONSTS[n.name].latex
    case 'var': return VAR_LATEX[n.name]
    case 'param': return n.name
    case 'neg': return `-${child(n.a, 2)}`
    case 'call': return FUNCS[n.fn].latex(n.args.map(toLatex))
    case 'bin':
      switch (n.op) {
        case '+': {
          const rs = n.b.t === 'neg' ? wrap(toLatex(n.b)) : toLatex(n.b)
          return `${toLatex(n.a)}+${rs}`
        }
        case '-': return `${toLatex(n.a)}-${child(n.b, 2)}`
        case '*': {
          const ls = child(n.a, 2)
          const rs = child(n.b, 2)
          return `${ls}${mulSep(ls, rs)}${rs}`
        }
        case '/':
          if (isAtomic(n.a) && isAtomic(n.b)) return `${toLatex(n.a)}/${toLatex(n.b)}`
          return `\\frac{${toLatex(n.a)}}{${toLatex(n.b)}}`
        case '^': {
          const base = precOf(n.a) < 4 ? wrap(toLatex(n.a)) : toLatex(n.a)
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
    }
  }

  // ---- cartesian ----------------------------------------------------------
  if (rhs === null) {
    if (usesY) {
      // bare expression containing y -> implicit expr = 0
      return { kind: 'implicit', domain: null, latex: `${toLatex(lhs)} = 0`, ev: compile(lhs) }
    }
    // bare f(x) (or f(t), or a constant) -> y = expr
    return { kind: 'explicit', domain: null, latex: `y = ${toLatex(lhs)}`, ev: compile(lhs) }
  }

  // y = f(...) / f(...) = y  (rhs must not itself contain y)
  for (const [side, other] of [[lhs, rhs], [rhs, lhs]] as const) {
    if (isVar(side, 'y')) {
      const ov = new Set<VarName>(); collectVars(other, ov)
      if (!ov.has('y')) {
        return { kind: 'explicit', domain: null, latex: `y = ${toLatex(other)}`, ev: compile(other) }
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
  }
}

// ----------------------------------------------------------------------------
// Plot assembly — shared by the plain, restricted and piecewise paths.
// ----------------------------------------------------------------------------

/** Parse one whole equation into its classified, compiled form. */
function compileEquation(src: string): {
  cls: Classified
  paramNames: string[]
  vars: Set<VarName>
} {
  const parser = new Parser(src)
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
  return { cls, paramNames, vars }
}

function makePlot(
  kind: CurveKind,
  latex: string,
  paramNames: string[],
  domain: [number, number] | null,
  ev: Evaluator,
): ParsedPlot {
  const defaultParams = paramNames.map(() => 1)
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
          paramNames.map((nm, i) => metaFor(nm, params[i] ?? 1)),
      }
      if (kind === 'explicit') {
        spec.evalExplicit = (params, x) => ev(params, x, 0)
      } else if (kind === 'polar') {
        spec.evalPolar = (params, theta) => ev(params, theta, 0)
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
function parseRestricted(src: string, cut: Cut): ParsedPlot {
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

  const { cls, paramNames, vars } = compileEquation(base)
  if (cls.kind !== 'explicit' && cls.kind !== 'polar') {
    throw new ParseError(
      'A domain restriction needs an explicit curve — write it as y = f(x) or r = f(θ)',
      cut.at,
    )
  }
  const want = cls.kind === 'polar' ? 'theta' : independentVar(vars)
  const ctx = newCtx(analyzeExpr)
  const pieces = branchPieces(cut.cond, cut.condAt, want, ctx)
  const vTex = varTexOf(ctx, want)

  // "1/x {x != 0}" removes a single point from an otherwise whole line. The
  // curve is not a piecewise and there is no gap to draw at sampling width —
  // so the restriction becomes a note on the equation, not a fake hole.
  const holes = excludedPoints(pieces)
  const branch: Branch = {
    ev: cls.ev,
    pieces: holes && holes.length > 0 ? WHOLE_LINE() : pieces,
    bodyTex: cls.latex,
    condTex: '',
  }
  const plan = planBranches(cls.kind, [branch])

  let latex = cls.latex
  if (holes && holes.length > 0) latex += `,\\ ${exclusionLatex(holes, vTex)}`
  else if (!isWholeLine(pieces)) latex += `,\\ ${setLatex(pieces, vTex)}`

  return makePlot(cls.kind, latex, paramNames, plan.domain, plan.ev)
}

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
    if (!(name in FUNCS) && !(name in CONSTS) && !VAR_NAMES.has(name) && HEAD_ARGS.has(argRaw)) {
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
function compileBranchBodies(raws: RawBranch[]): { bodies: Node[]; paramNames: string[] } {
  const bodies = raws.map((b) => {
    if (b.expr.trim() === '') {
      throw new ParseError(`Each piece needs a formula, e.g. 'x^2 if x < 0'`, b.exprAt)
    }
    return atOffset(b.exprAt, () => {
      const parser = new Parser(b.expr)
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

function buildPiecewise(headRaw: string, headAt: number, raws: RawBranch[]): ParsedPlot {
  const head = parseHead(headRaw, headAt)
  const { bodies, paramNames } = compileBranchBodies(raws)

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
  const branches: Branch[] = raws.map((raw, i) => {
    const ctx = newCtx(analyzeExpr)
    ctxs.push(ctx)
    const pieces = raw.otherwise
      ? WHOLE_LINE()
      : branchPieces(raw.cond, raw.condAt, want, ctx)
    return {
      ev: compile(bodies[i]),
      pieces,
      bodyTex: toLatex(bodies[i]),
      condTex: '',
    }
  })
  const vTex = ctxs.find((c) => c.tex !== null)?.tex ?? VAR_LATEX[want]
  for (const b of branches) b.condTex = compactLatex(b.pieces, vTex)

  const plan = planBranches(kind, branches)

  // One branch IS a restriction — print it as one, so the two spellings of the
  // same curve produce the same card.
  let latex: string
  if (branches.length === 1) {
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
  return makePlot(kind, latex, paramNames, plan.domain, plan.ev)
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
 * The front door for both new shapes. Returns null when `src` is an ordinary
 * equation, so the plain path stays byte-for-byte what it was.
 */
function parsePieced(src: string): ParsedPlot | null {
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
    return buildPiecewise(eqAt < 0 ? '' : src.slice(0, eqAt), 0, raws)
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
      const segs = splitTop(cut.cond, cut.condAt, ';')
      const raws = segs.map(splitBranch)
      return buildPiecewise(head.slice(0, -1), 0, raws)
    }
  }

  return parseRestricted(src, cut)
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
// Public API
// ----------------------------------------------------------------------------

export function parseExpression(src: string): ParseOutcome {
  try {
    if (!src || src.trim() === '') {
      return { ok: false, error: 'Empty expression' }
    }
    // "y = x^2 {0 <= x < 3}", "y = { x^2 if x < 0 ; 2x if x >= 0 }", ...
    const restricted = parsePieced(src)
    if (restricted) return { ok: true, plot: restricted }

    const { cls, paramNames } = compileEquation(src)
    return { ok: true, plot: makePlot(cls.kind, cls.latex, paramNames, cls.domain, cls.ev) }
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
export function analyzeExpr(src: string): ExprAnalysis {
  try {
    if (!src || src.trim() === '') return { ok: false, error: 'Empty expression' }
    const parser = new Parser(src)
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

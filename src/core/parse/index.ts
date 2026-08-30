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
// Public API
// ----------------------------------------------------------------------------

export function parseExpression(src: string): ParseOutcome {
  try {
    if (!src || src.trim() === '') {
      return { ok: false, error: 'Empty expression' }
    }
    const parser = new Parser(src)
    const { lhs, rhs } = parser.parseInput()

    // "f(x) = x^2" — plot the body, not the implicit relation f·x = x².
    const fdef = matchFuncDef(lhs, rhs)
    let cls: Classified
    let paramNames: string[]
    if (fdef) {
      // The function letter is not a plottable free constant; drop it and
      // renumber the survivors so param indices stay dense.
      paramNames = reindexParams(fdef.body)
      cls = classify(fdef.body, null)
      cls.latex = `${fdef.head} = ${toLatex(fdef.body)}`
    } else {
      cls = classify(lhs, rhs)
      paramNames = [...parser.paramNames] // order of first appearance, deduped
    }
    const defaultParams = paramNames.map(() => 1)
    const { kind, domain, latex, ev } = cls

    const plot: ParsedPlot = {
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
    return { ok: true, plot }
  } catch (err) {
    if (err instanceof ParseError) {
      return err.pos !== undefined
        ? { ok: false, error: err.message, pos: err.pos }
        : { ok: false, error: err.message }
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

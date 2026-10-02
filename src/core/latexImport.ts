// ============================================================================
// LaTeX → Grapher: read the function definitions out of an item's LaTeX.
//
//   export function importFromLatex(src: string): LatexImport
//
// `src` is anything from one definition (`g(t)=e^{4t^{3}-t}`) to a whole
// bank.tex record (`%%% ITEM …` lines, \begin{stem}…\end{stem}, choices, key).
// Every definition found is translated into a line Grapher's own parser
// accepts — and is CHECKED with it (parseExpression, or parseSlopeField for a
// differential equation) before it is returned. Anything that cannot be
// translated is reported in `warnings` with the offending LaTeX; nothing is
// ever silently guessed.
//
// What is read as a definition (in math mode: $…$, \(…\), \[…\], $$…$$,
// equation/align environments, or the whole input when it has no delimiters):
//
//   f(x) = …          a function (any single letter; any variable — g(t), A(r)
//                     are plotted with the variable renamed to x, the original
//                     recorded in `variable` so the card can label it)
//   f'(x) = …         a derivative given as data: plotted as y = …, named f′
//   y = …             a function of x
//   r = …, r(θ) = …   a polar curve
//   dy/dx = …         a slope field; \frac{dP}{dt} = kP(1-P/M) is read with
//                     P → y and t → x
//   … = …             any equation in x and y (conics, implicit curves)
//   \begin{cases}…    piecewise, as Grapher's y = { … if … ; … if … }
//   \left\{\begin{array}…\end{array}\right.   (Mathpix's spelling of cases)
//
// Domain hints: "for $0\le t\le 8$", "on the interval $[0, 4]$", ", x \ge 0"
// next to a definition become a restriction {0 <= x <= 8}.
//
// Figure hints: "The graph of $f'$ is shown" → hints.graphOf = "f'"; the first
// interval the stem mentions → hints.interval.
//
// Pure: no DOM, imports only the parser.
// ============================================================================

import { analyzeExpr, parseExpression } from './parse'
import { parseSlopeField } from './parse/slopeField'

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

export type ImportKind = 'function' | 'derivative' | 'polar' | 'parametric' | 'slope-field' | 'relation'

export interface ImportedDefinition {
  /** "f", "g", "R", "f′" (a given derivative), "y", "r", "dy/dx", "dP/dt"; '' for a relation */
  name: string
  /** the independent variable as written: "x", "t", "θ" (renamed to x / θ in `typed`) */
  variable: string
  /** the line for Grapher's equation box, already checked by its parser */
  typed: string
  /** the LaTeX the definition came from, as found */
  latex: string
  kind: ImportKind
  /** a numeric restriction read from a domain hint, when it has two finite ends */
  domain?: [number, number]
  /** the restriction as Grapher text ("0 <= x <= 8", "x >= 0"), when there was one */
  restriction?: string
  /** for a slope field written in other letters: the dependent variable ("P") */
  dependent?: string
  /** free constants that become sliders (k, a, …) */
  params?: string[]
}

export type GraphOf = 'f' | "f'" | "f''"

export interface LatexHints {
  /** which function the figure shows: f, its derivative, or its second derivative */
  graphOf: GraphOf
  /** the letter the stem names ("g" in "the graph of g′"), when it names one */
  name?: string
  /** the first interval the stem mentions, numerically */
  interval?: [number, number]
  /** the stem refers to a figure ("is shown", "shown above", "the graph of") */
  figure: boolean
}

export interface LatexImport {
  definitions: ImportedDefinition[]
  warnings: string[]
  hints: LatexHints
}

// ----------------------------------------------------------------------------
// Tokens
// ----------------------------------------------------------------------------

type TokType =
  | 'cmd' // \name (already normalised)
  | 'num'
  | 'let' // one letter
  | 'ch' // + - * / = ( ) [ ] | , ; ! ' : < > (and '<=', '>=', '!=', 'in' relations)
  | 'open' // {
  | 'close' // }
  | 'sup' // ^
  | 'sub' // _
  | 'amp' // &
  | 'nl' // \\
  | 'sep' // \quad, \qquad
  | 'text' // \text{…}
  | 'begin'
  | 'end'

interface Tok {
  t: TokType
  v: string
  /** preceded by whitespace in the source (a letter run broken by a space is two words) */
  sp: boolean
}

/** Commands that are nothing but space or size. */
const DROP = new Set([
  ',', ';', ':', '!', ' ', '>', 'enspace', 'thinspace', 'medspace', 'thickspace', 'negthinspace',
  'negmedspace', 'negthickspace', 'displaystyle', 'textstyle', 'scriptstyle', 'limits', 'nolimits',
  'left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'Bigl', 'Bigr', 'biggl', 'biggr',
  'Biggl', 'Biggr', 'bigm', 'Bigm', 'middle', 'mathstrut', 'strut', 'nonumber', 'notag', 'phantom',
])

/** Command spellings → one canonical name or a punctuation token. */
const CMD_ALIAS: Record<string, { t: TokType; v: string }> = {
  dfrac: { t: 'cmd', v: 'frac' },
  tfrac: { t: 'cmd', v: 'frac' },
  cfrac: { t: 'cmd', v: 'frac' },
  le: { t: 'ch', v: '<=' },
  leq: { t: 'ch', v: '<=' },
  leqslant: { t: 'ch', v: '<=' },
  leqq: { t: 'ch', v: '<=' },
  ge: { t: 'ch', v: '>=' },
  geq: { t: 'ch', v: '>=' },
  geqslant: { t: 'ch', v: '>=' },
  geqq: { t: 'ch', v: '>=' },
  lt: { t: 'ch', v: '<' },
  gt: { t: 'ch', v: '>' },
  ne: { t: 'ch', v: '!=' },
  neq: { t: 'ch', v: '!=' },
  in: { t: 'ch', v: 'in' },
  cdot: { t: 'ch', v: '*' },
  times: { t: 'ch', v: '*' },
  ast: { t: 'ch', v: '*' },
  div: { t: 'ch', v: '/' },
  lvert: { t: 'ch', v: '|' },
  rvert: { t: 'ch', v: '|' },
  vert: { t: 'ch', v: '|' },
  mid: { t: 'ch', v: '|' },
  '|': { t: 'ch', v: '|' },
  '{': { t: 'ch', v: '{' },
  '}': { t: 'ch', v: '}' },
  lbrace: { t: 'ch', v: '{' },
  rbrace: { t: 'ch', v: '}' },
  prime: { t: 'ch', v: "'" },
  vartheta: { t: 'cmd', v: 'theta' },
  varpi: { t: 'cmd', v: 'pi' },
  quad: { t: 'sep', v: 'quad' },
  qquad: { t: 'sep', v: 'qquad' },
  '\\': { t: 'nl', v: '\\\\' },
  cr: { t: 'nl', v: '\\\\' },
  '%': { t: 'ch', v: '%' },
  arcsec: { t: 'cmd', v: 'arcsec' },
}

/** Text-like commands whose braced argument is read as words. */
const TEXT_CMDS = new Set(['text', 'textnormal', 'textrm', 'textit', 'textbf', 'mbox', 'hbox', 'textsf'])
/** Font commands whose braced argument is math (or a function name). */
const FONT_CMDS = new Set([
  'mathrm', 'operatorname', 'mathit', 'mathbf', 'boldsymbol', 'bm', 'mathsf', 'mathnormal', 'rm', 'it',
])

/** Function names a Mathpix snip may leave without a backslash (longest first). */
const FUNC_WORDS = [
  'arcsin', 'arccos', 'arctan', 'arcsec', 'arccsc', 'arccot', 'sinh', 'cosh', 'tanh',
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'exp', 'log', 'ln',
]

/** Commands that are functions of one argument, and Grapher's name for each. */
const FUNC_CMDS: Record<string, string> = {
  sin: 'sin', cos: 'cos', tan: 'tan', sec: 'sec', csc: 'csc', cot: 'cot',
  arcsin: 'asin', arccos: 'acos', arctan: 'atan', asin: 'asin', acos: 'acos', atan: 'atan',
  sinh: 'sinh', cosh: 'cosh', tanh: 'tanh',
  ln: 'ln', log: 'log', lg: 'log', exp: 'exp',
  arcsec: 'arcsec', arccsc: 'arccsc', arccot: 'arccot',
  sgn: 'sign', sign: 'sign', abs: 'abs', sqrt: 'sqrt', cbrt: 'cbrt', floor: 'floor', ceil: 'ceil',
}

const GREEK_UNSUPPORTED = new Set([
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'iota', 'kappa',
  'lambda', 'mu', 'nu', 'xi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi',
  'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Sigma', 'Phi', 'Psi', 'Omega',
])

const UNICODE: Record<string, string> = {
  '−': '-', '–': '-', '—': '-', '·': '\\cdot ', '×': '\\times ', '÷': '/', '≤': '\\le ', '≥': '\\ge ',
  '≠': '\\ne ', 'π': '\\pi ', 'θ': '\\theta ', '∞': '\\infty ', '′': "'", '″': "''", '’': "'",
  '∈': '\\in ', '√': '\\sqrt ', ' ': ' ', ' ': ' ', ' ': ' ',
}

class TranslateError extends Error {}

function readBraced(src: string, i: number): { body: string; end: number } | null {
  let j = i
  while (j < src.length && /\s/.test(src[j])) j++
  if (src[j] !== '{') return null
  let depth = 0
  for (let k = j; k < src.length; k++) {
    const c = src[k]
    if (c === '\\') { k++; continue }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return { body: src.slice(j + 1, k), end: k + 1 }
    }
  }
  return null
}

function tokenize(raw: string): Tok[] {
  let src = ''
  for (const c of raw) src += UNICODE[c] ?? c
  const out: Tok[] = []
  let sp = false
  const push = (t: TokType, v: string) => { out.push({ t, v, sp }); sp = false }
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { sp = true; i++; continue }
    if (c === '%') { // comment to end of line
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (c === '\\') {
      const m = /^\\([A-Za-z]+)\*?|^\\(.)/.exec(src.slice(i, i + 40))
      if (!m) { i++; continue }
      const name = m[1] ?? m[2]
      i += m[0].length
      if (name === 'left' || name === 'right') {
        // \left. and \right. are invisible; \left| is an absolute-value bar
        let j = i
        while (j < src.length && /\s/.test(src[j])) j++
        if (src[j] === '.') { i = j + 1; continue }
        sp = true
        continue
      }
      if (DROP.has(name)) { sp = true; continue }
      if (name === 'hspace' || name === 'vspace' || name === 'label' || name === 'tag') {
        const b = readBraced(src, i)
        if (b) i = b.end
        sp = true
        continue
      }
      if (name === 'begin' || name === 'end') {
        const b = readBraced(src, i)
        if (!b) { push('cmd', name); continue }
        i = b.end
        push(name, b.body.replace(/\*$/, '').trim())
        continue
      }
      if (TEXT_CMDS.has(name)) {
        const b = readBraced(src, i)
        if (!b) continue
        i = b.end
        push('text', b.body)
        continue
      }
      if (FONT_CMDS.has(name)) {
        const b = readBraced(src, i)
        if (!b) continue
        i = b.end
        const word = b.body.replace(/\s+/g, '')
        if (FUNC_CMDS[word] !== undefined || word === 'arcsec' || word === 'arccsc' || word === 'arccot') {
          push('cmd', word)
        } else {
          const inner = tokenize(b.body)
          if (inner.length) inner[0].sp = inner[0].sp || sp
          out.push(...inner)
          sp = false
        }
        continue
      }
      const alias = CMD_ALIAS[name]
      if (alias) { push(alias.t, alias.v); continue }
      push('cmd', name)
      continue
    }
    if (c === '{') { push('open', c); i++; continue }
    if (c === '}') { push('close', c); i++; continue }
    if (c === '^') { push('sup', c); i++; continue }
    if (c === '_') { push('sub', c); i++; continue }
    if (c === '&') { push('amp', c); i++; continue }
    if (c === '~') { sp = true; i++; continue }
    if (/[0-9.]/.test(c)) {
      const m = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(src.slice(i))
      if (m) {
        push('num', m[0])
        i += m[0].length
        continue
      }
      push('ch', c)
      i++
      continue
    }
    if (/[A-Za-z]/.test(c)) { push('let', c); i++; continue }
    if (c === '<' || c === '>') {
      if (src[i + 1] === '=') { push('ch', c + '='); i += 2; continue }
      push('ch', c)
      i++
      continue
    }
    if (c === '!' && src[i + 1] === '=') { push('ch', '!='); i += 2; continue }
    push('ch', c)
    i++
  }
  return primes(thousands(out))
}

/** 1{,}000 → 1000 (the way a typeset number is written). */
function thousands(toks: Tok[]): Tok[] {
  const out: Tok[] = []
  for (let i = 0; i < toks.length; i++) {
    const a = toks[i]
    if (a.t === 'num' && toks[i + 1]?.t === 'open' && toks[i + 2]?.v === ',' && toks[i + 3]?.t === 'close' && toks[i + 4]?.t === 'num') {
      out.push({ ...a, v: a.v + toks[i + 4].v })
      i += 4
      continue
    }
    out.push(a)
  }
  return out
}

/** ^{\prime}, ^\prime, ^{\prime\prime}, ^{''} → ' tokens. */
function primes(toks: Tok[]): Tok[] {
  const out: Tok[] = []
  for (let i = 0; i < toks.length; i++) {
    const a = toks[i]
    if (a.t === 'sup') {
      const b = toks[i + 1]
      if (b && b.t === 'ch' && b.v === "'") {
        out.push(b)
        i += 1
        continue
      }
      if (b && b.t === 'open') {
        let j = i + 2
        const ps: Tok[] = []
        while (toks[j] && toks[j].t === 'ch' && toks[j].v === "'") { ps.push(toks[j]); j++ }
        if (ps.length > 0 && toks[j]?.t === 'close') {
          out.push(...ps)
          i = j
          continue
        }
      }
    }
    out.push(a)
  }
  return out
}

/** The LaTeX-ish text of a token run, for warnings. */
function show(toks: readonly Tok[]): string {
  let s = ''
  for (const k of toks) {
    const v =
      k.t === 'cmd' ? `\\${k.v}` : k.t === 'open' ? '{' : k.t === 'close' ? '}' : k.t === 'sup' ? '^'
      : k.t === 'sub' ? '_' : k.t === 'amp' ? '&' : k.t === 'nl' ? '\\\\' : k.t === 'sep' ? `\\${k.v}`
      : k.t === 'text' ? `\\text{${k.v}}` : k.t === 'begin' ? `\\begin{${k.v}}` : k.t === 'end' ? `\\end{${k.v}}`
      : k.v
    s += (k.sp && s ? ' ' : '') + v
  }
  return s
}

// ----------------------------------------------------------------------------
// Expression tree
// ----------------------------------------------------------------------------

type Node =
  | { k: 'num'; v: string }
  | { k: 'sym'; v: string } // a letter, 'pi', 'theta', 'e'
  | { k: 'call'; fn: string; arg: Node }
  | { k: 'logb'; base: Node; arg: Node }
  | { k: 'call2'; fn: 'min' | 'max'; a: Node; b: Node }
  | { k: 'root'; n: Node | null; arg: Node }
  | { k: 'pow'; base: Node; exp: Node }
  | { k: 'neg'; a: Node }
  | { k: 'bin'; op: '+' | '-' | '*' | '/'; a: Node; b: Node }
  | { k: 'abs'; a: Node }
  | { k: 'fact'; a: Node }
  | { k: 'ucall'; name: string; order: number; arg: Node } // f(x), f'(x) inside a body

const NOT_ATOM_CMDS = new Set(['infty', 'rfloor', 'rceil', 'to', 'rightarrow', 'quad', 'qquad'])

const RELS = new Set(['<', '<=', '>', '>=', '=', '!=', 'in'])

/** Recursive-descent reader for one LaTeX expression. */
class Reader {
  i = 0
  bars = 0
  constructor(readonly toks: Tok[]) {}

  peek(o = 0): Tok | undefined { return this.toks[this.i + o] }
  done(): boolean { return this.i >= this.toks.length }
  next(): Tok {
    const t = this.toks[this.i++]
    if (!t) throw new TranslateError('unexpected end of the expression')
    return t
  }
  isCh(v: string, o = 0): boolean {
    const t = this.peek(o)
    return !!t && t.t === 'ch' && t.v === v
  }
  expectCh(v: string): void {
    if (!this.isCh(v)) throw new TranslateError(`expected '${v}' near "${show(this.toks.slice(this.i, this.i + 4))}"`)
    this.i++
  }

  /** expr := term (('+'|'-') term)* */
  expr(): Node {
    let a = this.term()
    for (;;) {
      if (this.isCh('+')) { this.i++; a = { k: 'bin', op: '+', a, b: this.term() }; continue }
      if (this.isCh('-')) { this.i++; a = { k: 'bin', op: '-', a, b: this.term() }; continue }
      return a
    }
  }

  /** term := unary (('*'|'/') unary | juxtaposed unary)* */
  term(): Node {
    let a = this.unary()
    for (;;) {
      if (this.isCh('*')) { this.i++; a = { k: 'bin', op: '*', a, b: this.unary() }; continue }
      if (this.isCh('/')) { this.i++; a = { k: 'bin', op: '/', a, b: this.unary() }; continue }
      if (this.startsAtom()) { a = { k: 'bin', op: '*', a, b: this.postfix() }; continue }
      return a
    }
  }

  unary(): Node {
    if (this.isCh('-')) { this.i++; return { k: 'neg', a: this.unary() } }
    if (this.isCh('+')) { this.i++; return this.unary() }
    return this.postfix()
  }

  /** Can the next token start a juxtaposed factor? */
  startsAtom(): boolean {
    const t = this.peek()
    if (!t) return false
    switch (t.t) {
      case 'num': case 'let': case 'open': return true
      case 'cmd': return !NOT_ATOM_CMDS.has(t.v)
      case 'begin': return false
      case 'ch': return t.v === '(' || t.v === '[' || (t.v === '|' && this.bars === 0)
      default: return false
    }
  }

  postfix(): Node {
    let a = this.atom()
    for (;;) {
      if (this.isCh('!')) { this.i++; a = { k: 'fact', a }; continue }
      if (this.peek()?.t === 'sup') {
        this.i++
        const e = this.supArg()
        a = { k: 'pow', base: a, exp: e }
        continue
      }
      if (this.isCh("'")) throw new TranslateError(`a prime is only understood in a definition's head, near "${show(this.toks.slice(Math.max(0, this.i - 2), this.i + 2))}"`)
      return a
    }
  }

  /** The argument of ^ or _: a braced group, or ONE token (x^23 is x²·3 in LaTeX). */
  supArg(): Node {
    const t = this.peek()
    if (!t) throw new TranslateError("nothing after '^'")
    if (t.t === 'open') return this.group()
    if (t.t === 'num') {
      this.i++
      if (t.v.length > 1 && !t.v.includes('.')) {
        // split the rest back into the stream
        this.toks.splice(this.i, 0, { t: 'num', v: t.v.slice(1), sp: false })
        return { k: 'num', v: t.v[0] }
      }
      return { k: 'num', v: t.v }
    }
    if (t.t === 'ch' && t.v === '-') { // Mathpix noise: x^-1
      this.i++
      return { k: 'neg', a: this.supArg() }
    }
    if (t.t === 'ch' && t.v === '(') return this.atom()
    if (t.t === 'let') { this.i++; return this.letter(t.v) }
    if (t.t === 'cmd') return this.atom()
    throw new TranslateError(`cannot read the exponent near "${show(this.toks.slice(this.i, this.i + 3))}"`)
  }

  /** { expr } */
  group(): Node {
    if (this.peek()?.t !== 'open') throw new TranslateError(`expected '{' near "${show(this.toks.slice(this.i, this.i + 3))}"`)
    this.i++
    const saved = this.bars
    this.bars = 0
    const e = this.expr()
    this.bars = saved
    if (this.peek()?.t !== 'close') throw new TranslateError(`expected '}' near "${show(this.toks.slice(this.i, this.i + 3))}"`)
    this.i++
    return e
  }

  letter(v: string): Node {
    if (v === 'e') return { k: 'sym', v: 'e' }
    return { k: 'sym', v }
  }

  /** A run of letters with no space that spells a function name, at the cursor. */
  funcWord(): string | null {
    let word = ''
    for (let j = this.i; j < this.toks.length; j++) {
      const t = this.toks[j]
      if (t.t !== 'let' || (j > this.i && t.sp)) break
      word += t.v
      if (word.length > 6) break
    }
    for (const w of FUNC_WORDS) if (word.startsWith(w)) return w
    return null
  }

  atom(): Node {
    const t = this.peek()
    if (!t) throw new TranslateError('unexpected end of the expression')
    if (t.t === 'num') { this.i++; return { k: 'num', v: t.v } }
    if (t.t === 'let') {
      const w = this.funcWord()
      if (w) {
        this.i += w.length
        return this.func(w)
      }
      // a user function call inside a body: f(x), g'(2x)
      if (/^[a-dfhA-Z]$/.test(t.v) || t.v === 'g') {
        let o = 1
        let order = 0
        while (this.isCh("'", o)) { order++; o++ }
        if (this.isCh('(', o) && (order > 0 || /^[fghFGH]$/.test(t.v))) {
          this.i += o + 1
          const arg = this.expr()
          this.expectCh(')')
          return { k: 'ucall', name: t.v, order, arg }
        }
      }
      this.i++
      return this.letter(t.v)
    }
    if (t.t === 'open') return this.group()
    if (t.t === 'ch') {
      if (t.v === '(' || t.v === '[') {
        this.i++
        const saved = this.bars
        this.bars = 0
        const e = this.expr()
        this.bars = saved
        const close = t.v === '(' ? ')' : ']'
        if (this.isCh(close)) this.i++
        else if (this.isCh(')') || this.isCh(']')) this.i++ // mismatched but harmless
        else throw new TranslateError(`missing '${close}'`)
        return e
      }
      if (t.v === '|') {
        this.i++
        this.bars++
        const e = this.expr()
        this.bars--
        this.expectCh('|')
        return { k: 'abs', a: e }
      }
      throw new TranslateError(`unexpected '${t.v}' near "${show(this.toks.slice(Math.max(0, this.i - 2), this.i + 3))}"`)
    }
    if (t.t === 'cmd') {
      this.i++
      const v = t.v
      if (v === 'pi') return { k: 'sym', v: 'pi' }
      if (v === 'theta') return { k: 'sym', v: 'theta' }
      if (v === 'frac') {
        const n = this.fracArg()
        const d = this.fracArg()
        return { k: 'bin', op: '/', a: n, b: d }
      }
      if (v === 'sqrt') {
        let n: Node | null = null
        if (this.isCh('[')) {
          this.i++
          n = this.expr()
          this.expectCh(']')
        }
        const arg = this.peek()?.t === 'open' ? this.group() : this.postfixLess()
        return { k: 'root', n, arg }
      }
      if (v === 'lfloor' || v === 'lceil') {
        const e = this.expr()
        const close = this.peek()
        if (!close || close.t !== 'cmd' || (close.v !== 'rfloor' && close.v !== 'rceil')) throw new TranslateError(`missing \\r${v.slice(1)}`)
        this.i++
        return { k: 'call', fn: v === 'lfloor' ? 'floor' : 'ceil', arg: e }
      }
      if (v === 'max' || v === 'min') {
        this.expectCh('(')
        const a = this.expr()
        this.expectCh(',')
        const b = this.expr()
        this.expectCh(')')
        return { k: 'call2', fn: v, a, b }
      }
      if (FUNC_CMDS[v] !== undefined) return this.func(v)
      if (v === 'infty') throw new TranslateError('∞ cannot be plotted as a value')
      if (GREEK_UNSUPPORTED.has(v)) throw new TranslateError(`the Greek letter \\${v} has no Grapher equivalent — rename it to a Latin letter`)
      if (v === 'int' || v === 'iint' || v === 'oint') throw new TranslateError('integrals cannot be translated into a plotted formula')
      if (v === 'sum' || v === 'prod') throw new TranslateError(`\\${v} cannot be translated into a plotted formula`)
      if (v === 'lim') throw new TranslateError('limits cannot be translated into a plotted formula')
      throw new TranslateError(`unsupported command \\${v}`)
    }
    if (t.t === 'begin') throw new TranslateError(`a nested \\begin{${t.v}} is not supported`)
    throw new TranslateError(`unexpected "${show([t])}"`)
  }

  /** \frac's arguments: braced, or one token (\frac12). */
  fracArg(): Node {
    const t = this.peek()
    if (!t) throw new TranslateError('\\frac is missing an argument')
    if (t.t === 'open') return this.group()
    if (t.t === 'num') {
      this.i++
      if (t.v.length > 1 && !t.v.includes('.')) {
        this.toks.splice(this.i, 0, { t: 'num', v: t.v.slice(1), sp: false })
        return { k: 'num', v: t.v[0] }
      }
      return { k: 'num', v: t.v }
    }
    if (t.t === 'let') { this.i++; return this.letter(t.v) }
    return this.atom()
  }

  /** One atom with its postfixes, for \sqrt x or a paren-less function argument piece. */
  postfixLess(): Node {
    return this.postfix()
  }

  /** A function after its name: optional ^power / _base, then its argument. */
  func(name: string): Node {
    let power: Node | null = null
    let base: Node | null = null
    for (;;) {
      if (this.peek()?.t === 'sup' && power === null) { this.i++; power = this.supArg(); continue }
      if (this.peek()?.t === 'sub' && base === null) { this.i++; base = this.subArg(); continue }
      break
    }
    const arg = this.funcArg()
    let call: Node
    const g = FUNC_CMDS[name] ?? name
    if (g === 'log' && base) call = { k: 'logb', base, arg }
    else if (base) throw new TranslateError(`a subscript on \\${name} is not understood`)
    else if (g === 'arcsec') call = { k: 'call', fn: 'acos', arg: { k: 'bin', op: '/', a: { k: 'num', v: '1' }, b: arg } }
    else if (g === 'arccsc') call = { k: 'call', fn: 'asin', arg: { k: 'bin', op: '/', a: { k: 'num', v: '1' }, b: arg } }
    else if (g === 'arccot') call = { k: 'bin', op: '-', a: { k: 'bin', op: '/', a: { k: 'sym', v: 'pi' }, b: { k: 'num', v: '2' } }, b: { k: 'call', fn: 'atan', arg } }
    else call = { k: 'call', fn: g, arg }
    if (power) {
      // sin^{-1} x is arcsin; sin^2 x is (sin x)^2
      if (power.k === 'neg' && power.a.k === 'num' && power.a.v === '1') {
        if (call.k === 'call' && (call.fn === 'sin' || call.fn === 'cos' || call.fn === 'tan')) {
          return { k: 'call', fn: 'a' + call.fn, arg }
        }
        throw new TranslateError(`\\${name}^{-1} is ambiguous here`)
      }
      return { k: 'pow', base: call, exp: power }
    }
    return call
  }

  subArg(): Node {
    const t = this.peek()
    if (!t) throw new TranslateError("nothing after '_'")
    if (t.t === 'open') return this.group()
    if (t.t === 'num') {
      this.i++
      if (t.v.length > 1 && !t.v.includes('.')) {
        this.toks.splice(this.i, 0, { t: 'num', v: t.v.slice(1), sp: false })
        return { k: 'num', v: t.v[0] }
      }
      return { k: 'num', v: t.v }
    }
    if (t.t === 'let') { this.i++; return this.letter(t.v) }
    return this.atom()
  }

  /**
   * A function's argument. Parenthesised: just that group. Paren-less (\sin 3x,
   * \cos\theta, \ln x): the tight product that follows — stopping at + − = ,
   * another function, \cdot, or a relation.
   */
  funcArg(): Node {
    const t = this.peek()
    if (!t) throw new TranslateError('a function is missing its argument')
    if (t.t === 'ch' && (t.v === '(' || t.v === '[')) return this.atom()
    if (t.t === 'open') return this.group()
    if (t.t === 'ch' && t.v === '-') { this.i++; return { k: 'neg', a: this.funcArg() } }
    let a = this.postfix()
    for (;;) {
      const n = this.peek()
      if (!n) break
      const isFn = (n.t === 'cmd' && FUNC_CMDS[n.v] !== undefined) || (n.t === 'let' && this.funcWord() !== null)
      if (isFn) break
      if (n.t === 'cmd' && (n.v === 'frac' || n.v === 'sqrt')) break
      if (!this.startsAtom()) break
      if (n.t === 'ch' && (n.v === '(' || n.v === '[')) {
        // sin x (x+1)? ambiguous — keep the textbook reading sin(x)·(x+1)
        break
      }
      a = { k: 'bin', op: '*', a, b: this.postfix() }
    }
    return a
  }
}

// ----------------------------------------------------------------------------
// Tree → Grapher text
// ----------------------------------------------------------------------------

const PREC = { add: 1, mul: 2, neg: 3, pow: 4, atom: 5 }

function precOf(n: Node): number {
  switch (n.k) {
    case 'bin': return n.op === '+' || n.op === '-' ? PREC.add : PREC.mul
    case 'neg': return PREC.neg
    case 'pow': return PREC.pow
    default: return PREC.atom
  }
}

function rename(n: Node, from: string, to: string): Node {
  return replaceSym(n, from, { k: 'sym', v: to })
}

/** Every occurrence of the symbol `from` replaced by the tree `to`. */
function replaceSym(n: Node, from: string, to: Node): Node {
  const r = (m: Node) => replaceSym(m, from, to)
  switch (n.k) {
    case 'sym': return n.v === from ? to : n
    case 'num': return n
    case 'call': return { ...n, arg: r(n.arg) }
    case 'logb': return { ...n, base: r(n.base), arg: r(n.arg) }
    case 'call2': return { ...n, a: r(n.a), b: r(n.b) }
    case 'root': return { ...n, n: n.n ? r(n.n) : null, arg: r(n.arg) }
    case 'pow': return { ...n, base: r(n.base), exp: r(n.exp) }
    case 'neg': return { ...n, a: r(n.a) }
    case 'bin': return { ...n, a: r(n.a), b: r(n.b) }
    case 'abs': return { ...n, a: r(n.a) }
    case 'fact': return { ...n, a: r(n.a) }
    case 'ucall': return { ...n, arg: r(n.arg) }
  }
}

/** f(2x) inside a body, with f defined earlier in the same item: substitute f's formula. */
function inline(n: Node, known: ReadonlyMap<string, Node>): Node {
  const r = (m: Node) => inline(m, known)
  switch (n.k) {
    case 'sym': case 'num': return n
    case 'ucall': {
      const arg = r(n.arg)
      const body = n.order === 0 ? known.get(n.name) : undefined
      return body ? replaceSym(body, 'x', arg) : { ...n, arg }
    }
    case 'call': return { ...n, arg: r(n.arg) }
    case 'logb': return { ...n, base: r(n.base), arg: r(n.arg) }
    case 'call2': return { ...n, a: r(n.a), b: r(n.b) }
    case 'root': return { ...n, n: n.n ? r(n.n) : null, arg: r(n.arg) }
    case 'pow': return { ...n, base: r(n.base), exp: r(n.exp) }
    case 'neg': return { ...n, a: r(n.a) }
    case 'bin': return { ...n, a: r(n.a), b: r(n.b) }
    case 'abs': return { ...n, a: r(n.a) }
    case 'fact': return { ...n, a: r(n.a) }
  }
}

function symbols(n: Node, out: Set<string>): Set<string> {
  switch (n.k) {
    case 'sym': out.add(n.v); break
    case 'num': break
    case 'call': symbols(n.arg, out); break
    case 'logb': symbols(n.base, out); symbols(n.arg, out); break
    case 'call2': symbols(n.a, out); symbols(n.b, out); break
    case 'root': if (n.n) symbols(n.n, out); symbols(n.arg, out); break
    case 'pow': symbols(n.base, out); symbols(n.exp, out); break
    case 'neg': case 'abs': case 'fact': symbols(n.a, out); break
    case 'bin': symbols(n.a, out); symbols(n.b, out); break
    case 'ucall': out.add(`${n.name}${"'".repeat(n.order)}(`); symbols(n.arg, out); break
  }
  return out
}

function hasAbs(n: Node): boolean {
  switch (n.k) {
    case 'abs': return true
    case 'sym': case 'num': return false
    case 'call': case 'ucall': return hasAbs(n.arg)
    case 'logb': return hasAbs(n.base) || hasAbs(n.arg)
    case 'call2': return hasAbs(n.a) || hasAbs(n.b)
    case 'root': return (n.n ? hasAbs(n.n) : false) || hasAbs(n.arg)
    case 'pow': return hasAbs(n.base) || hasAbs(n.exp)
    case 'neg': case 'fact': return hasAbs(n.a)
    case 'bin': return hasAbs(n.a) || hasAbs(n.b)
  }
}

/** Does the emitted text of `n` start with a digit? */
function startsWithDigit(s: string): boolean { return /^[0-9.]/.test(s) }

function emit(n: Node): string {
  switch (n.k) {
    case 'num': return n.v.startsWith('.') ? '0' + n.v : n.v.endsWith('.') ? n.v.slice(0, -1) : n.v
    case 'sym': return n.v
    case 'call': return `${n.fn}(${emit(n.arg)})`
    case 'call2': return `${n.fn}(${emit(n.a)}, ${emit(n.b)})`
    case 'logb': {
      const b = emit(n.base)
      const base = n.base.k === 'num' || (n.base.k === 'sym' && n.base.v.length === 1) ? b : `(${b})`
      return `log_${base}(${emit(n.arg)})`
    }
    case 'root': {
      if (!n.n) return `sqrt(${emit(n.arg)})`
      if (n.n.k === 'num' && n.n.v === '2') return `sqrt(${emit(n.arg)})`
      if (n.n.k === 'num' && n.n.v === '3') return `cbrt(${emit(n.arg)})`
      return `(${emit(n.arg)})^(1/${wrapIf(n.n, PREC.atom)})`
    }
    case 'abs': return hasAbs(n.a) ? `abs(${emit(n.a)})` : `|${emit(n.a)}|`
    case 'fact': return `${wrapIf(n.a, PREC.atom)}!`
    case 'ucall': return `${n.name}${"'".repeat(n.order)}(${emit(n.arg)})`
    case 'neg': return `-${wrapIf(n.a, PREC.mul)}`
    case 'pow': {
      const base = wrapIf(n.base, PREC.atom)
      const e = n.exp
      const simple = (e.k === 'num' && !e.v.includes('.')) || (e.k === 'sym')
      return `${base}^${simple ? emit(e) : `(${emit(e)})`}`
    }
    case 'bin': {
      if (n.op === '+' || n.op === '-') {
        const right = n.op === '-' ? wrapIf(n.b, PREC.mul) : wrapIf(n.b, PREC.add)
        // a + (-b) reads better as a - b
        if (n.b.k === 'neg' && n.op === '+') return `${emit(n.a)} - ${wrapIf(n.b.a, PREC.mul)}`
        return `${emit(n.a)} ${n.op} ${right}`
      }
      if (n.op === '/') {
        // a fraction is always one parenthesised unit where it sits inside a
        // product, so \frac{1}{2}x is (1/2)x and never 1/(2x)
        const a = wrapIf(n.a, PREC.mul)
        const b = wrapIf(n.b, PREC.pow)
        return `${a}/${b}`
      }
      // product
      const a = n.a.k === 'bin' && n.a.op === '/' ? `(${emit(n.a)})` : wrapIf(n.a, PREC.mul)
      const b = (n.b.k === 'bin' && n.b.op === '/') || n.b.k === 'neg' ? `(${emit(n.b)})` : wrapIf(n.b, PREC.mul)
      // 2x, 2sin(x), 2(x+1), 3pi — juxtapose a number with what follows it
      if (/^[0-9.]+$/.test(a) && !startsWithDigit(b)) return `${a}${b}`
      // (x + 1)(x - 2), (1/2)x — but never after a power: x^(2/3)(x - 5) must not read as one exponent
      if (a.endsWith(')') && n.a.k !== 'pow' && /^[A-Za-z(]/.test(b)) return `${a}${b}`
      return `${a}*${b}`
    }
  }
}

function wrapIf(n: Node, need: number): string {
  const s = emit(n)
  return precOf(n) < need ? `(${s})` : s
}

/** Strip one pair of parentheses that wraps the whole string. */
function stripOuter(s: string): string {
  if (!s.startsWith('(') || !s.endsWith(')')) return s
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')') {
      depth--
      if (depth === 0 && i < s.length - 1) return s
    }
  }
  return s.slice(1, -1)
}

// ----------------------------------------------------------------------------
// Splitting tokens
// ----------------------------------------------------------------------------

/** Split at top-level tokens matching `pred` (outside (), [], {}). */
function splitTop(toks: Tok[], pred: (t: Tok) => boolean): Tok[][] {
  const out: Tok[][] = [[]]
  let depth = 0
  let envDepth = 0
  for (const t of toks) {
    if (t.t === 'open' || (t.t === 'ch' && (t.v === '(' || t.v === '['))) depth++
    else if (t.t === 'close' || (t.t === 'ch' && (t.v === ')' || t.v === ']'))) depth = Math.max(0, depth - 1)
    else if (t.t === 'begin') envDepth++
    else if (t.t === 'end') envDepth = Math.max(0, envDepth - 1)
    if (depth === 0 && envDepth === 0 && pred(t) && !(t.t === 'begin' || t.t === 'end')) {
      out.push([])
      continue
    }
    out[out.length - 1].push(t)
  }
  return out
}

/** Index of the first top-level relation token, or -1. */
function relIndex(toks: Tok[], from = 0): number {
  let depth = 0
  let env = 0
  for (let i = from; i < toks.length; i++) {
    const t = toks[i]
    if (t.t === 'open' || (t.t === 'ch' && (t.v === '(' || t.v === '['))) depth++
    else if (t.t === 'close' || (t.t === 'ch' && (t.v === ')' || t.v === ']'))) depth = Math.max(0, depth - 1)
    else if (t.t === 'begin') env++
    else if (t.t === 'end') env = Math.max(0, env - 1)
    else if (depth === 0 && env === 0 && t.t === 'ch' && RELS.has(t.v)) return i
  }
  return -1
}

/** Read a whole token run as one expression (throws TranslateError). */
function readExpr(toks: Tok[]): Node {
  if (toks.length === 0) throw new TranslateError('empty expression')
  const r = new Reader(toks.slice())
  const n = r.expr()
  if (!r.done()) throw new TranslateError(`could not read past "${show(r.toks.slice(r.i, r.i + 5))}"`)
  return n
}

function trimPunct(toks: Tok[]): Tok[] {
  let a = 0
  let b = toks.length
  const junk = (t: Tok) => (t.t === 'ch' && (t.v === ',' || t.v === ';' || t.v === '.' || t.v === ':')) || t.t === 'sep'
  while (a < b && junk(toks[a])) a++
  while (b > a && junk(toks[b - 1])) b--
  return toks.slice(a, b)
}

// ----------------------------------------------------------------------------
// Conditions: cases rows and domain hints
// ----------------------------------------------------------------------------

const COND_LEAD = /^(?:\s*(?:if|for|when|where|whenever|with|and|,)\s*)+/i

interface Cond {
  /** Grapher condition text, or 'otherwise' */
  text: string
  /** numeric bounds when the condition is an interval in the variable */
  lo?: number
  hi?: number
}

/** The letters of a plain-word run (no LaTeX), lower-cased. */
function wordOf(toks: Tok[], i: number): { word: string; len: number } {
  let w = ''
  let j = i
  while (j < toks.length && toks[j].t === 'let' && (j === i || !toks[j].sp)) { w += toks[j].v; j++ }
  return { word: w.toLowerCase(), len: j - i }
}

function constValue(n: Node): number | null {
  const a = analyzeExpr(stripOuter(emit(n)))
  if (!a.ok || a.free.length > 0 || !Number.isFinite(a.value)) return null
  return a.value
}

/**
 * A condition in `variable` (renamed to `to`): "x < 1", "1 \le x < 3",
 * "x \in [0, 1)", "\text{otherwise}", "x<-1 \text{ or } x>2".
 */
function readCond(raw: Tok[], variable: string, to: string): Cond {
  let toks = trimPunct(raw)
  // leading words: \text{if }, plain "if", "for"
  for (;;) {
    const t = toks[0]
    if (!t) break
    if (t.t === 'text') {
      const rest = t.v.replace(COND_LEAD, '').trim()
      if (/^(otherwise|else|elsewhere)\b/i.test(rest)) return { text: 'otherwise' }
      if (rest === '') { toks = toks.slice(1); continue }
      break
    }
    if (t.t === 'let') {
      const { word, len } = wordOf(toks, 0)
      if (/^(if|for|when|where|and)$/.test(word)) { toks = toks.slice(len); continue }
      if (/^(otherwise|else|elsewhere)$/.test(word)) return { text: 'otherwise' }
    }
    if (t.t === 'ch' && t.v === ',') { toks = toks.slice(1); continue }
    break
  }
  if (toks.length === 0) throw new TranslateError('empty condition')

  // "or" / "and" between clauses
  const clauses: { toks: Tok[]; join: string }[] = []
  let cur: Tok[] = []
  let join = ''
  let depth = 0
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t.t === 'text') {
      const w = t.v.trim().toLowerCase()
      if (w === 'or' || w === 'and') { clauses.push({ toks: cur, join }); cur = []; join = w; continue }
      if (w === '') continue
    }
    if (t.t === 'let') {
      const { word, len } = wordOf(toks, i)
      if ((word === 'or' || word === 'and') && len === word.length) { clauses.push({ toks: cur, join }); cur = []; join = word; i += len - 1; continue }
    }
    if (t.t === 'cmd' && (t.v === 'lor' || t.v === 'vee' || t.v === 'land' || t.v === 'wedge')) {
      clauses.push({ toks: cur, join }); cur = []; join = t.v === 'lor' || t.v === 'vee' ? 'or' : 'and'; continue
    }
    if (t.t === 'open' || (t.t === 'ch' && (t.v === '(' || t.v === '['))) depth++
    else if (t.t === 'close' || (t.t === 'ch' && (t.v === ')' || t.v === ']'))) depth = Math.max(0, depth - 1)
    if (depth === 0 && t.t === 'ch' && t.v === ',' && cur.length > 0 && relIndex(cur) >= 0) { clauses.push({ toks: cur, join }); cur = []; join = 'and'; continue }
    cur.push(t)
  }
  clauses.push({ toks: cur, join })

  const texts: string[] = []
  let lo: number | undefined
  let hi: number | undefined
  for (const c of clauses) {
    const one = readChain(trimPunct(c.toks), variable, to)
    texts.push((c.join ? `${c.join} ` : '') + one.text)
    if (clauses.length === 1) { lo = one.lo; hi = one.hi }
  }
  const out: Cond = { text: texts.join(' ') }
  if (lo !== undefined) out.lo = lo
  if (hi !== undefined) out.hi = hi
  return out
}

/** One comparison chain, or `var \in interval`. */
function readChain(toks: Tok[], variable: string, to: string): Cond {
  const parts: Tok[][] = []
  const rels: string[] = []
  let start = 0
  for (;;) {
    const k = relIndex(toks, start)
    if (k < 0) { parts.push(toks.slice(start)); break }
    parts.push(toks.slice(start, k))
    rels.push(toks[k].v)
    start = k + 1
  }
  if (rels.length === 0) {
    // a bare interval [0, 4]
    const iv = readInterval(toks)
    if (iv) return intervalCond(iv, to)
    throw new TranslateError(`"${show(toks)}" is not a condition`)
  }
  if (rels.length === 1 && rels[0] === 'in') {
    const iv = readInterval(parts[1])
    if (!iv) throw new TranslateError(`cannot read the interval in "${show(toks)}"`)
    return intervalCond(iv, to)
  }
  if (rels.includes('in') || (rels.includes('=') && rels.length > 1)) throw new TranslateError(`cannot read the condition "${show(toks)}"`)
  const exprs = parts.map((p) => {
    const n = rename(readExpr(p), variable, to)
    return n
  })
  if (!exprs.some((n) => mentions(n, to))) throw new TranslateError(`"${show(toks)}" is not a condition on ${variable === 'theta' ? 'θ' : variable}`)
  const texts = exprs.map((n) => stripOuter(emit(n)))
  let text = texts[0]
  for (let i = 0; i < rels.length; i++) text += ` ${rels[i]} ${texts[i + 1]}`
  const out: Cond = { text }
  // numeric bounds for "a REL v REL b", "v REL b", "a REL v"
  const isVar = (n: Node) => n.k === 'sym' && n.v === to
  if (exprs.length === 3 && isVar(exprs[1])) {
    const a = constValue(exprs[0])
    const b = constValue(exprs[2])
    if (a !== null && b !== null && (rels[0][0] === '<') === (rels[1][0] === '<')) {
      out.lo = Math.min(a, b)
      out.hi = Math.max(a, b)
    }
  } else if (exprs.length === 2 && (isVar(exprs[0]) || isVar(exprs[1]))) {
    const vFirst = isVar(exprs[0])
    const c = constValue(vFirst ? exprs[1] : exprs[0])
    if (c !== null && rels[0] === '=') {
      out.lo = c
      out.hi = c
    } else if (c !== null && rels[0] !== '!=') {
      const greater = vFirst ? rels[0][0] === '>' : rels[0][0] === '<'
      if (greater) out.lo = c
      else out.hi = c
    }
  }
  return out
}

interface Interval { a: Node; b: Node; loClosed: boolean; hiClosed: boolean }

/** [a, b], (a, b], (−\infty, 3) … as a token run. */
function readInterval(toks: Tok[]): Interval | null {
  const t = trimPunct(toks)
  if (t.length < 5) return null
  const open = t[0]
  const close = t[t.length - 1]
  if (open.t !== 'ch' || (open.v !== '[' && open.v !== '(')) return null
  if (close.t !== 'ch' || (close.v !== ']' && close.v !== ')')) return null
  const inner = t.slice(1, -1)
  const halves = splitTop(inner, (k) => k.t === 'ch' && k.v === ',')
  if (halves.length !== 2) return null
  const end = (h: Tok[], sign: 1 | -1): Node => {
    const hs = trimPunct(h)
    const inf = hs.findIndex((k) => k.t === 'cmd' && k.v === 'infty')
    if (inf >= 0) {
      const neg = hs.some((k) => k.t === 'ch' && k.v === '-')
      return { k: 'sym', v: neg || sign < 0 ? '-inf' : 'inf' }
    }
    return readExpr(hs)
  }
  try {
    return { a: end(halves[0], -1), b: end(halves[1], 1), loClosed: open.v === '[', hiClosed: close.v === ']' }
  } catch {
    return null
  }
}

function intervalCond(iv: Interval, v: string): Cond {
  const loInf = iv.a.k === 'sym' && iv.a.v.endsWith('inf')
  const hiInf = iv.b.k === 'sym' && iv.b.v.endsWith('inf')
  const a = loInf ? null : stripOuter(emit(iv.a))
  const b = hiInf ? null : stripOuter(emit(iv.b))
  const out: Cond = { text: '' }
  if (a !== null && b !== null) out.text = `${a} ${iv.loClosed ? '<=' : '<'} ${v} ${iv.hiClosed ? '<=' : '<'} ${b}`
  else if (a !== null) out.text = `${v} ${iv.loClosed ? '>=' : '>'} ${a}`
  else if (b !== null) out.text = `${v} ${iv.hiClosed ? '<=' : '<'} ${b}`
  else throw new TranslateError('the interval is the whole line')
  if (a !== null) { const c = constValue(iv.a); if (c !== null) out.lo = c }
  if (b !== null) { const c = constValue(iv.b); if (c !== null) out.hi = c }
  return out
}

// ----------------------------------------------------------------------------
// Definitions
// ----------------------------------------------------------------------------

interface Head {
  kind: 'fn' | 'y' | 'r' | 'deriv' | 'relation'
  name: string
  variable: string // as written: 'x', 't', 'theta'
  order: number
  dependent?: string
}

/** Read a definition head (the tokens left of '='). */
function readHead(lhs: Tok[]): Head | null {
  const t = lhs.filter((k) => !(k.t === 'sep'))
  // y
  if (t.length === 1 && t[0].t === 'let' && t[0].v === 'y') return { kind: 'y', name: 'y', variable: 'x', order: 0 }
  // r
  if (t.length === 1 && t[0].t === 'let' && t[0].v === 'r') return { kind: 'r', name: 'r', variable: 'theta', order: 0 }
  // f(x), f'(x), r(\theta)
  if (t.length >= 4 && t[0].t === 'let') {
    let i = 1
    let order = 0
    while (t[i] && t[i].t === 'ch' && t[i].v === "'") { order++; i++ }
    if (t[i]?.t === 'ch' && t[i].v === '(' && t[i + 2]?.t === 'ch' && t[i + 2].v === ')' && i + 3 === t.length) {
      const v = t[i + 1]
      const variable = v.t === 'let' ? v.v : v.t === 'cmd' && v.v === 'theta' ? 'theta' : null
      if (variable && variable !== 'e') {
        const name = t[0].v
        if (name === 'r' && variable === 'theta' && order === 0) return { kind: 'r', name: 'r', variable, order }
        if (name === 'y' && order === 0) return { kind: 'y', name: 'y', variable, order }
        if (name === variable) return null
        return { kind: 'fn', name, variable, order }
      }
    }
    // y'(x) = …: a derivative of y, i.e. a slope field
    if (t[0].v === 'y' && order === 1) return { kind: 'deriv', name: 'dy/dx', variable: 'x', order: 1, dependent: 'y' }
  }
  // y' = …
  if (t.length === 2 && t[0].t === 'let' && t[0].v === 'y' && t[1].t === 'ch' && t[1].v === "'") {
    return { kind: 'deriv', name: 'dy/dx', variable: 'x', order: 1, dependent: 'y' }
  }
  // \frac{dy}{dx}, \frac{d y}{d x}, \frac{dP}{dt}, dy/dx
  const letters = t.filter((k) => !(k.t === 'open' || k.t === 'close'))
  if (letters[0]?.t === 'cmd' && letters[0].v === 'frac' && letters.length === 5) {
    const [, d1, u, d2, v] = letters
    if (d1.t === 'let' && d1.v === 'd' && d2.t === 'let' && d2.v === 'd' && u.t === 'let' && v.t === 'let') {
      return { kind: 'deriv', name: `d${u.v}/d${v.v}`, variable: v.v, order: 1, dependent: u.v }
    }
  }
  if (letters.length === 5 && letters[2].t === 'ch' && letters[2].v === '/') {
    const [d1, u, , d2, v] = letters
    if (d1.t === 'let' && d1.v === 'd' && d2.t === 'let' && d2.v === 'd' && u.t === 'let' && v.t === 'let') {
      return { kind: 'deriv', name: `d${u.v}/d${v.v}`, variable: v.v, order: 1, dependent: u.v }
    }
  }
  return null
}

/** The cases block of a right-hand side, or null when the RHS is not one. */
function casesRows(rhs: Tok[]): Tok[][] | null {
  let t = rhs
  if (t[0]?.t === 'ch' && t[0].v === '{') t = t.slice(1) // \left\{
  if (t[0]?.t !== 'begin') return null
  const env = t[0].v
  if (env !== 'cases' && env !== 'array' && env !== 'dcases' && env !== 'rcases') return null
  let body = t.slice(1)
  if (env === 'array' && body[0]?.t === 'open') {
    // column spec {ll}
    const close = body.findIndex((k) => k.t === 'close')
    body = body.slice(close + 1)
  }
  const endAt = body.findIndex((k) => k.t === 'end' && k.v === env)
  if (endAt < 0) throw new TranslateError(`missing \\end{${env}}`)
  const after = body.slice(endAt + 1).filter((k) => !(k.t === 'ch' && (k.v === '.' || k.v === '}' || k.v === ',')))
  if (after.length > 0) throw new TranslateError(`unexpected text after \\end{${env}}: "${show(after)}"`)
  body = body.slice(0, endAt)
  return splitTop(body, (k) => k.t === 'nl').filter((row) => row.length > 0)
}

/** Translate a cases body into Grapher's { … if … ; … } text. */
function translateCases(rows: Tok[][], variable: string): string {
  const pieces: string[] = []
  for (const row of rows) {
    let cols = splitTop(row, (k) => k.t === 'amp')
    if (cols.length === 1) {
      // no &: split at a \text{if} / \text{for} or a top-level comma
      const at = row.findIndex((k) => k.t === 'text' && /^\s*(if|for|when|otherwise|else)\b/i.test(k.v))
      if (at > 0) cols = [row.slice(0, at), row.slice(at)]
      else {
        const byComma = splitTop(row, (k) => k.t === 'ch' && k.v === ',')
        if (byComma.length === 2) cols = byComma
      }
    }
    if (cols.length !== 2) throw new TranslateError(`cannot split the row "${show(row)}" into a formula and a condition`)
    const body = stripOuter(emit(rename(readExpr(trimPunct(cols[0])), variable, 'x')))
    const cond = readCond(cols[1], variable, 'x')
    pieces.push(cond.text === 'otherwise' ? `${body} otherwise` : `${body} if ${cond.text}`)
  }
  if (pieces.length === 0) throw new TranslateError('empty cases')
  return `{ ${pieces.join(' ; ')} }`
}

interface Built {
  def: ImportedDefinition
  /** the body in x, for substituting into a later g(x) = f(2x) + 1 */
  body?: Node
  /** one half of a parametric pair x(t) = …, y(t) = … */
  component?: { axis: 'x' | 'y'; text: string }
}

/** Does `n` mention the symbol `v`? */
function mentions(n: Node, v: string): boolean {
  return symbols(n, new Set()).has(v)
}

/** Cut units and other prose off a right-hand side; return what follows a "for"/"on" word. */
function splitRhs(rhs: Tok[]): { rhs: Tok[]; domain: Tok[] | null } {
  if (casesRows(rhs)) return { rhs, domain: null }
  // a \quad that is only spacing (x + \quad 1) is dropped; one before a condition cuts
  rhs = rhs.filter((k, i) => {
    if (k.t !== 'sep') return true
    const rest = trimPunct(rhs.slice(i + 1))
    return relIndex(rest) >= 0 || readInterval(rest) !== null
  })
  const cut = rhs.findIndex((k, i) => i > 0 && (k.t === 'sep' || k.t === 'text'))
  if (cut > 0) {
    const k = rhs[cut]
    const rest = rhs.slice(cut)
    const domainy =
      k.t === 'sep' ||
      (k.t === 'text' && /^\s*(for|on|over|where|when|if|with)\b/i.test(k.v)) ||
      (k.t === 'text' && /^\s*,?\s*$/.test(k.v))
    const dom = rest.filter((t) => !(t.t === 'text' && /^[\s,]*(?:(?:for|on|over|where|when|if|with|the|all|closed|open|interval)\b[\s,]*)*$/i.test(t.v)))
    return { rhs: trimPunct(rhs.slice(0, cut)), domain: domainy && dom.length > 0 ? trimPunct(dom) : null }
  }
  const commaParts = splitTop(rhs, (k) => k.t === 'ch' && k.v === ',')
  if (commaParts.length === 2 && (relIndex(commaParts[1]) >= 0 || readInterval(commaParts[1]))) {
    return { rhs: trimPunct(commaParts[0]), domain: trimPunct(commaParts[1]) }
  }
  return { rhs, domain: null }
}

/** Build one definition from a segment, or null when the segment defines nothing. */
function buildDefinition(
  seg: Tok[],
  latex: string,
  proseDomain: Tok[] | null,
  known: ReadonlyMap<string, Node>,
  warnings: string[],
): Built | null {
  const eq = relIndex(seg)
  if (eq < 0 || seg[eq].v !== '=') return null
  const lhs = trimPunct(seg.slice(0, eq))
  const split = splitRhs(trimPunct(seg.slice(eq + 1)))
  const rhs = split.rhs
  if (lhs.length === 0 || rhs.length === 0) return null
  if (relIndex(rhs) >= 0) return null // a = b = c, a chain: not a definition
  const head = readHead(lhs)

  if (!head) {
    // an equation in x and y: a relation (conic, implicit curve)
    const l = inline(readExpr(lhs), known)
    const r = inline(readExpr(rhs), known)
    const syms = new Set<string>()
    symbols(l, syms)
    symbols(r, syms)
    if (!syms.has('x') || !syms.has('y')) return null
    for (const s of syms) {
      if (s.endsWith('(')) throw new TranslateError(`the equation calls ${s.slice(0, -1)}, which is not defined in this item`)
    }
    const typed = `${stripOuter(emit(l))} = ${stripOuter(emit(r))}`
    return { def: { name: '', variable: 'x', typed, latex, kind: 'relation' } }
  }

  if (head.kind === 'deriv') {
    const dep = head.dependent ?? 'y'
    let body = inline(readExpr(rhs), known)
    if (dep !== 'y') {
      if (mentions(body, 'y')) throw new TranslateError(`the equation uses y as well as ${dep}`)
      body = rename(body, dep, 'y')
    }
    if (head.variable !== 'x') {
      if (mentions(body, 'x')) throw new TranslateError(`the equation uses x as well as ${head.variable}`)
      body = rename(body, head.variable, 'x')
    }
    const typed = `dy/dx = ${stripOuter(emit(body))}`
    const def: ImportedDefinition = { name: head.name, variable: head.variable, typed, latex, kind: 'slope-field' }
    if (dep !== 'y') def.dependent = dep
    return { def }
  }

  const polar = head.kind === 'r' || head.variable === 'theta'
  const variable = head.variable
  const to = polar ? 'theta' : 'x'
  const rows = casesRows(rhs)
  let bodyText: string
  let body: Node | undefined
  if (rows) {
    bodyText = translateCases(rows, variable)
  } else {
    let b = readExpr(rhs)
    // y = f(x) / y = f'(x): a reference to a function, not a definition
    if (b.k === 'ucall' && b.arg.k === 'sym') return null
    b = inline(b, known)
    for (const s of symbols(b, new Set())) {
      if (s.endsWith('(')) throw new TranslateError(`the formula calls ${s.slice(0, -1)}, which is not defined in this item`)
    }
    // x(t) = …, y(t) = …: one half of a parametric pair
    if ((head.name === 'x' || head.name === 'y') && head.order === 0 && variable === 't') {
      return {
        def: { name: head.name, variable: 't', typed: '', latex, kind: 'parametric' },
        component: { axis: head.name, text: stripOuter(emit(b)) },
      }
    }
    if (variable !== to) {
      if (mentions(b, to)) throw new TranslateError(`the formula uses both ${variable} and ${to === 'theta' ? 'θ' : to}`)
      b = rename(b, variable, to)
    }
    body = b
    bodyText = stripOuter(emit(b))
  }

  const prime = '′'.repeat(head.order)
  let name = head.name
  let headText: string
  let kind: ImportKind
  if (polar) {
    headText = 'r'
    kind = 'polar'
  } else if (head.kind === 'y') {
    headText = 'y'
    kind = 'function'
  } else if (head.order > 0) {
    headText = 'y'
    name = head.name + prime
    kind = 'derivative'
  } else if (/^[xyrte]$/.test(head.name)) {
    headText = 'y'
    kind = 'function'
  } else {
    headText = `${head.name}(x)`
    kind = 'function'
  }

  const def: ImportedDefinition = {
    name,
    variable: variable === 'theta' ? 'θ' : variable,
    typed: `${headText} = ${bodyText}`,
    latex,
    kind,
  }
  // a restriction: inline (", 0 \le x \le 4") first, else the prose hint ("for $0\le t\le 8$")
  const restriction = split.domain ?? proseDomain
  if (restriction && restriction.length > 0 && !rows) {
    try {
      const cond = readCond(restriction, variable, to)
      if (cond.text !== 'otherwise') {
        def.typed = `${def.typed} {${cond.text}}`
        def.restriction = cond.text
        if (cond.lo !== undefined && cond.hi !== undefined) def.domain = [cond.lo, cond.hi]
      }
    } catch (err) {
      // a prose hint about some other letter is simply not a hint; an inline one is reported
      if (split.domain) {
        warnings.push(`Ignored the restriction "${show(restriction)}" on "${latex}": ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }
  const out: Built = { def }
  if (body && kind === 'function' && head.kind === 'fn') out.body = body
  return out
}

/** Check a translated line with Grapher's own parser. */
function verify(def: ImportedDefinition): string | null {
  if (def.kind === 'slope-field') {
    const o = parseSlopeField(def.typed)
    if (!o.ok) return o.error
    def.params = o.paramNames.length ? [...o.paramNames] : undefined
    if (!def.params) delete def.params
    return null
  }
  const o = parseExpression(def.typed)
  if (!o.ok) return o.error
  const want = def.kind === 'polar' ? 'polar' : def.kind === 'relation' ? 'implicit' : def.kind === 'parametric' ? 'parametric' : 'explicit'
  if (o.plot.kind !== want && !(def.kind === 'relation' && o.plot.kind === 'explicit')) {
    return `it reads as a ${o.plot.kind} curve, not a ${want} one (other variables in the formula?)`
  }
  if (o.plot.paramNames.length) def.params = [...o.plot.paramNames]
  return null
}

// ----------------------------------------------------------------------------
// Scanning the source
// ----------------------------------------------------------------------------

interface MathSeg {
  latex: string
  /** offset of the segment in the scanned text */
  start: number
  end: number
}

/** The parts of a record that hold the question: stem(s), else everything minus choices/keys. */
function questionText(src: string): string {
  const noComments = src
    .split('\n')
    .filter((l) => !/^\s*%/.test(l))
    .join('\n')
  const stems = [...noComments.matchAll(/\\begin\{stem\}([\s\S]*?)\\end\{stem\}/g)].map((m) => m[1])
  if (stems.length > 0) return stems.join('\n\n')
  return noComments.replace(
    /\\begin\{(choices|key|distractors|solution|tikzpicture|axis)\}[\s\S]*?\\end\{\1\}/g,
    ' ',
  )
}

const MATH_ENVS = 'equation|equation\\*|align|align\\*|gather|gather\\*|displaymath|math|multline|multline\\*'

/** Every math-mode segment of `text`; the whole text when it has no delimiters. */
function mathSegments(text: string): MathSeg[] {
  const out: MathSeg[] = []
  const re = new RegExp(
    `\\$\\$([\\s\\S]+?)\\$\\$|(?<!\\\\)\\$((?:\\\\\\$|[^$])+?)\\$|\\\\\\(([\\s\\S]+?)\\\\\\)|\\\\\\[([\\s\\S]+?)\\\\\\]|\\\\begin\\{(${MATH_ENVS})\\}([\\s\\S]*?)\\\\end\\{\\5\\}`,
    'g',
  )
  for (const m of text.matchAll(re)) {
    const body = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[6] ?? ''
    out.push({ latex: body, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length })
  }
  if (out.length === 0) {
    const trimmed = text.trim()
    if (trimmed) out.push({ latex: trimmed, start: 0, end: text.length })
  }
  return out
}

/** Split one math segment into definition-sized pieces. */
function definitionPieces(toks: Tok[]): Tok[][] {
  const out: Tok[][] = []
  let cur: Tok[] = []
  let depth = 0
  let env = 0
  for (let i = 0; i < toks.length; i++) {
    const k = toks[i]
    if (k.t === 'open' || (k.t === 'ch' && (k.v === '(' || k.v === '['))) depth++
    else if (k.t === 'close' || (k.t === 'ch' && (k.v === ')' || k.v === ']'))) depth = Math.max(0, depth - 1)
    else if (k.t === 'begin') env++
    else if (k.t === 'end') env = Math.max(0, env - 1)
    const top = depth === 0 && env === 0 && k.t !== 'end'
    if (top) {
      // align rows, ';', \text{and} separate definitions; & is alignment only
      if (k.t === 'amp') continue
      const and = k.t === 'text' && /^\s*(and|,)\s*$/i.test(k.v)
      const hard = k.t === 'nl' || (k.t === 'ch' && k.v === ';')
      // a comma or \quad followed by another head "g(x) =" / "y =" starts a new definition
      const soft = ((k.t === 'ch' && k.v === ',') || k.t === 'sep') && startsDefinition(toks, i + 1)
      if (and || hard || soft) {
        if (cur.length) out.push(cur)
        cur = []
        continue
      }
    }
    cur.push(k)
  }
  if (cur.length) out.push(cur)
  return out
}

function startsDefinition(toks: Tok[], i: number): boolean {
  const eq = relIndex(toks, i)
  if (eq < 0 || toks[eq].v !== '=') return false
  return readHead(trimPunct(toks.slice(i, eq))) !== null
}

/** Text between two offsets with math removed, for reading hint words. */
function plain(text: string): string {
  return text.replace(/\s+/g, ' ')
}

/**
 * Prose between a definition and the next math that makes that math its
 * domain: "for", "on the interval", "cubic feet per hour for" — within the
 * same sentence (no . ? ! ;) and short.
 */
const DOMAIN_TAIL = /(?:^|[\s,])(?:(?:defined\s+)?(?:for|on|over|where|when|with)(?:\s+(?:the|all))?(?:\s+(?:closed|open|half-open))?(?:\s+interval)?|in\s+the\s+(?:closed\s+|open\s+)?interval)\s*$/i

function isDomainLead(between: string): boolean {
  return between.length <= 80 && !/[.?!;]/.test(between) && DOMAIN_TAIL.test(between)
}

function readHints(text: string, segs: MathSeg[]): LatexHints {
  const norm = text
    .replace(/\^\{\\prime\\prime\}|\^\{''\}|\\prime\\prime|″/g, "''")
    .replace(/\^\{\\prime\}|\^\\prime|\\prime|′|’/g, "'")
    .replace(/\\left|\\right/g, '')
    .replace(/\$/g, '')
    .replace(/\\[,;:! ]/g, ' ')
  const hints: LatexHints = { graphOf: 'f', figure: false }
  if (/\b(is|are)\s+shown\b|shown\s+(above|below|at\s+right|to\s+the\s+right)|\bgraph(ed)?\s+(above|below)|\bfigure\b/i.test(norm)) {
    hints.figure = true
  }
  const m = /graph\s+of\s+(?:the\s+(?:function\s+|derivative\s+of\s+|second\s+derivative\s+of\s+)?)?(?:y\s*=\s*)?([A-Za-z])\s*('{0,2})(?![A-Za-z])/i.exec(norm)
  const deriv2 = /graph\s+of\s+the\s+second\s+derivative/i.test(norm)
  const deriv1 = /graph\s+of\s+the\s+derivative/i.test(norm)
  if (m) {
    hints.figure = true
    const name = m[1]
    if (!/^(a|an|the)$/i.test(name)) {
      hints.name = name
      const order = deriv2 ? 2 : deriv1 ? 1 : m[2].length
      hints.graphOf = order >= 2 ? "f''" : order === 1 ? "f'" : 'f'
    }
  } else if (deriv2) hints.graphOf = "f''"
  else if (deriv1) hints.graphOf = "f'"

  // first interval: a math segment that is an interval or a closed chain
  for (const s of segs) {
    let toks: Tok[]
    try { toks = tokenize(s.latex) } catch { continue }
    const iv = readInterval(toks)
    try {
      if (iv) {
        const a = constValue(iv.a)
        const b = constValue(iv.b)
        if (a !== null && b !== null && a < b) { hints.interval = [a, b]; break }
        continue
      }
      // a ≤ v ≤ b anywhere (also inside a definition's restriction)
      const pieces = splitTop(toks, (k) => k.t === 'ch' && k.v === ',')
      let found = false
      for (const p of pieces) {
        const k1 = relIndex(p)
        if (k1 < 0) continue
        const k2 = relIndex(p, k1 + 1)
        if (k2 < 0 || relIndex(p, k2 + 1) >= 0) continue
        const mid = trimPunct(p.slice(k1 + 1, k2))
        if (mid.length !== 1 || !(mid[0].t === 'let' || (mid[0].t === 'cmd' && mid[0].v === 'theta'))) continue
        const r1 = p[k1].v
        const r2 = p[k2].v
        if (!(r1[0] === '<' && r2[0] === '<')) continue
        const a = constValue(readExpr(trimPunct(p.slice(0, k1))))
        const b = constValue(readExpr(trimPunct(p.slice(k2 + 1))))
        if (a !== null && b !== null && a < b) { hints.interval = [a, b]; found = true; break }
      }
      if (found) break
    } catch {
      continue
    }
  }
  return hints
}

// ----------------------------------------------------------------------------
// Entry point
// ----------------------------------------------------------------------------

export function importFromLatex(src: string): LatexImport {
  const definitions: ImportedDefinition[] = []
  const warnings: string[] = []
  const text = questionText(typeof src === 'string' ? src : '')
  const segs = mathSegments(text)
  const seen = new Set<string>()
  const known = new Map<string, Node>()
  const halves: { x?: { text: string; latex: string }; y?: { text: string; latex: string } } = {}

  const add = (def: ImportedDefinition): boolean => {
    let problem = verify(def)
    if (problem && def.restriction) {
      // keep the curve, drop a restriction Grapher will not take
      const bare = def.typed.slice(0, def.typed.lastIndexOf(' {'))
      const again: ImportedDefinition = { ...def, typed: bare }
      delete again.restriction
      delete again.domain
      if (!verify(again)) {
        warnings.push(`Dropped the restriction {${def.restriction}} on "${def.latex}": ${problem}`)
        def = again
        problem = null
      }
    }
    if (problem) {
      warnings.push(`Could not translate "${def.latex}": Grapher reads "${def.typed}" as an error — ${problem}`)
      return false
    }
    if (seen.has(def.typed)) return true
    seen.add(def.typed)
    definitions.push(def)
    return true
  }

  segs.forEach((seg, si) => {
    let toks: Tok[]
    try {
      toks = tokenize(seg.latex)
    } catch (err) {
      warnings.push(`Could not read "${seg.latex.trim()}": ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    // a domain hint in the prose right after this segment: "for $0\le t\le 8$"
    let proseDomain: Tok[] | null = null
    const nextSeg = segs[si + 1]
    if (nextSeg && isDomainLead(plain(text.slice(seg.end, nextSeg.start)))) {
      try {
        const nt = tokenize(nextSeg.latex)
        const eq = relIndex(nt)
        // a condition or an interval — never another definition
        if ((eq >= 0 && nt[eq].v !== '=') || readInterval(nt)) proseDomain = nt
      } catch { /* not a hint */ }
    }
    const pieces = definitionPieces(toks)
    pieces.forEach((piece, pi) => {
      const latex = pieces.length === 1 ? seg.latex.trim() : show(piece)
      let built: Built | null
      try {
        built = buildDefinition(piece, latex, pi === pieces.length - 1 ? proseDomain : null, known, warnings)
      } catch (err) {
        if (!(err instanceof TranslateError)) throw err
        if (looksLikeDefinition(piece)) warnings.push(`Could not translate "${latex}": ${err.message}`)
        return
      }
      if (!built) return
      if (built.component) {
        halves[built.component.axis] = { text: built.component.text, latex }
        return
      }
      if (add(built.def) && built.body) known.set(built.def.name, built.body)
    })
  })

  if (halves.x && halves.y) {
    add({
      name: '(x, y)',
      variable: 't',
      typed: `(x, y) = (${halves.x.text}, ${halves.y.text})`,
      latex: `${halves.x.latex}, ${halves.y.latex}`,
      kind: 'parametric',
    })
  } else if (halves.x || halves.y) {
    const h = (halves.x ?? halves.y)!
    warnings.push(`Could not translate "${h.latex}": a parametric curve needs both x(t) and y(t)`)
  }

  return { definitions, warnings, hints: readHints(text, segs) }
}

/** Is this piece shaped like a definition (worth a warning when it fails)? */
function looksLikeDefinition(piece: Tok[]): boolean {
  const eq = relIndex(piece)
  if (eq < 0 || piece[eq].v !== '=') return false
  if (readHead(trimPunct(piece.slice(0, eq)))) return true
  if (piece.some((k) => k.t === 'cmd' && (k.v === 'lim' || k.v === 'int' || k.v === 'sum'))) return false
  const letters = new Set(piece.filter((k) => k.t === 'let').map((k) => k.v))
  return letters.has('x') && letters.has('y')
}

/** Exposed for tests: translate one LaTeX expression (no '=') into Grapher text. */
export function latexToTyped(latex: string): { ok: true; text: string } | { ok: false; error: string } {
  try {
    const toks = tokenize(latex)
    return { ok: true, text: stripOuter(emit(readExpr(trimPunct(toks)))) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

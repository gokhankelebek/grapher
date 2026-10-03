// ============================================================================
// src/core/mathSpeech.ts — a KaTeX string as words, for a screen reader.
//
//   speakLatex('y = x^{2} - 3')   → 'y equals x squared minus 3'
//   speakLatex('f(x)=\\frac{1}{x}') → 'f of x equals 1 over x'
//
// An equation button on a card is named "Equation: …" with this text, so a
// screen reader says the mathematics instead of "button" (or KaTeX's MathML
// read symbol by symbol). It covers the forms the app writes — polynomials,
// powers and roots, fractions, absolute values, trig and inverse trig, logs
// and exponentials, primes, subscripts, limits, integrals, sums, piecewise
// cases, inequalities — in the plain "ClearSpeak" style: "the square root of",
// "the fraction with numerator … and denominator …", "the quantity … squared".
// Anything it does not know is spoken as its letters; it never throws.
// ============================================================================

type Tok =
  | { t: 'cmd'; v: string } // \frac, \sin, \pi, \{ …
  | { t: 'num'; v: string }
  | { t: 'ch'; v: string } // a letter or a symbol

interface Atom {
  base: Base
  sup?: Atom[]
  sub?: Atom[]
  primes?: number
}

type Base =
  | { k: 'num'; v: string }
  | { k: 'var'; v: string }
  | { k: 'op'; v: string }
  | { k: 'word'; v: string } // \text{…}, a named constant
  | { k: 'fn'; v: string } // sin, ln, log …
  | { k: 'big'; v: 'int' | 'sum' | 'prod' | 'lim' }
  | { k: 'group'; kids: Atom[] } // { … }
  | { k: 'paren'; kids: Atom[]; open: string; close: string }
  | { k: 'abs'; kids: Atom[] }
  | { k: 'frac'; num: Atom[]; den: Atom[] }
  | { k: 'sqrt'; idx: Atom[] | null; body: Atom[] }
  | { k: 'cases'; rows: Atom[][][] }

// ----------------------------------------------------------------------------
// Tokens
// ----------------------------------------------------------------------------

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (c === '\\') {
      const m = /^\\([a-zA-Z]+)/.exec(src.slice(i))
      if (m) {
        out.push({ t: 'cmd', v: m[1] })
        i += m[0].length
      } else {
        out.push({ t: 'cmd', v: src[i + 1] ?? '' })
        i += 2
      }
      continue
    }
    const n = /^(\d+(?:\.\d*)?|\.\d+)/.exec(src.slice(i))
    if (n) {
      out.push({ t: 'num', v: n[1] })
      i += n[1].length
      continue
    }
    out.push({ t: 'ch', v: c === '−' ? '-' : c })
    i++
  }
  return out
}

// ----------------------------------------------------------------------------
// Parse
// ----------------------------------------------------------------------------

const FUNCS: Record<string, string> = {
  sin: 'sine', cos: 'cosine', tan: 'tangent', sec: 'secant', csc: 'cosecant', cot: 'cotangent',
  arcsin: 'arc sine', arccos: 'arc cosine', arctan: 'arc tangent',
  sinh: 'hyperbolic sine', cosh: 'hyperbolic cosine', tanh: 'hyperbolic tangent',
  ln: 'natural log', log: 'log', exp: 'exp',
}

const SYMBOLS: Record<string, string> = {
  pi: 'pi', theta: 'theta', alpha: 'alpha', beta: 'beta', gamma: 'gamma', delta: 'delta', Delta: 'delta',
  epsilon: 'epsilon', varepsilon: 'epsilon', lambda: 'lambda', mu: 'mu', sigma: 'sigma', phi: 'phi',
  varphi: 'phi', omega: 'omega', tau: 'tau', rho: 'rho', infty: 'infinity', circ: 'degrees',
}

const OPS: Record<string, string> = {
  '+': 'plus', '-': 'minus', '=': 'equals', '<': 'is less than', '>': 'is greater than',
  le: 'is less than or equal to', leq: 'is less than or equal to', '≤': 'is less than or equal to',
  ge: 'is greater than or equal to', geq: 'is greater than or equal to', '≥': 'is greater than or equal to',
  ne: 'is not equal to', neq: 'is not equal to', '≠': 'is not equal to', approx: 'is approximately',
  cdot: 'times', times: 'times', '·': 'times', '/': 'divided by', ',': ',', ';': ';', to: 'approaches',
  rightarrow: 'approaches', pm: 'plus or minus', in: 'is in', cup: 'union', cap: 'intersect',
  '!': 'factorial', ':': 'such that', mid: 'such that', div: 'divided by',
}

const SPACES = new Set([',', ';', ':', '!', ' ', 'quad', 'qquad', 'displaystyle', 'left.', 'right.', 'limits', 'big', 'Big'])

class Parser {
  i = 0
  constructor(private toks: Tok[]) {}

  peek(): Tok | undefined {
    return this.toks[this.i]
  }

  /** A sequence up to a closing token (not consumed). */
  seq(stop: (t: Tok) => boolean): Atom[] {
    const out: Atom[] = []
    while (this.i < this.toks.length) {
      const t = this.toks[this.i]
      if (stop(t)) break
      this.i++
      if (t.t === 'ch' && (t.v === '^' || t.v === '_')) {
        const arg = this.arg()
        const last = out[out.length - 1]
        if (!last) continue
        if (t.v === '^') last.sup = arg
        else last.sub = arg
        continue
      }
      if (t.t === 'ch' && t.v === "'") {
        const last = out[out.length - 1]
        if (last) last.primes = (last.primes ?? 0) + 1
        continue
      }
      const b = this.base(t)
      if (b) out.push({ base: b })
    }
    return out
  }

  /** One argument: a braced group's contents, or a single token. */
  arg(): Atom[] {
    const t = this.peek()
    if (!t) return []
    this.i++
    if (t.t === 'ch' && t.v === '{') {
      const kids = this.seq((x) => x.t === 'ch' && x.v === '}')
      this.i++
      return kids
    }
    const b = this.base(t)
    return b ? [{ base: b }] : []
  }

  /** The raw text of a braced argument (\text{…}, \begin{…}). */
  rawArg(): string {
    const t = this.peek()
    if (!t || !(t.t === 'ch' && t.v === '{')) return ''
    this.i++
    let s = ''
    let depth = 1
    while (this.i < this.toks.length) {
      const x = this.toks[this.i++]
      if (x.t === 'ch' && x.v === '{') depth++
      if (x.t === 'ch' && x.v === '}' && --depth === 0) break
      s += x.t === 'cmd' ? (SYMBOLS[x.v] ? ` ${SYMBOLS[x.v]} ` : '') : x.v
    }
    return s
  }

  base(t: Tok): Base | null {
    if (t.t === 'num') return { k: 'num', v: t.v.replace(/\.$/, '') }
    if (t.t === 'ch') {
      if (t.v === '{') {
        const kids = this.seq((x) => x.t === 'ch' && x.v === '}')
        this.i++
        return { k: 'group', kids }
      }
      if (t.v === '(' || t.v === '[') {
        const close = t.v === '(' ? ')' : ']'
        const kids = this.seq((x) => x.t === 'ch' && (x.v === close || x.v === ')' || x.v === ']'))
        const end = this.toks[this.i++]
        return { k: 'paren', kids, open: t.v, close: end && end.t === 'ch' ? end.v : close }
      }
      if (t.v === '|') {
        const kids = this.seq((x) => x.t === 'ch' && x.v === '|')
        this.i++
        return { k: 'abs', kids }
      }
      if (t.v === '}' || t.v === ')' || t.v === ']' || t.v === '&') return null
      if (/^[a-zA-Z]$/.test(t.v)) return { k: 'var', v: t.v }
      if (OPS[t.v]) return { k: 'op', v: t.v }
      if (t.v === 'π') return { k: 'word', v: 'pi' }
      if (t.v === 'θ') return { k: 'word', v: 'theta' }
      if (t.v === '∞') return { k: 'word', v: 'infinity' }
      return null
    }
    const v = t.v
    if (SPACES.has(v)) return null
    if (v === 'frac' || v === 'dfrac' || v === 'tfrac') {
      const num = this.arg()
      const den = this.arg()
      return { k: 'frac', num, den }
    }
    if (v === 'sqrt') {
      let idx: Atom[] | null = null
      const p = this.peek()
      if (p && p.t === 'ch' && p.v === '[') {
        this.i++
        idx = this.seq((x) => x.t === 'ch' && x.v === ']')
        this.i++
      }
      return { k: 'sqrt', idx, body: this.arg() }
    }
    if (v === 'left') {
      const d = this.toks[this.i++]
      const open = d ? d.v : '('
      const kids = this.seq((x) => x.t === 'cmd' && x.v === 'right')
      this.i++ // \right
      const endTok = this.toks[this.i++]
      if (open === '|' || open === 'vert' || open === 'lvert') return { k: 'abs', kids }
      if (open === '{' || open === '.') return { k: 'group', kids }
      return { k: 'paren', kids, open, close: endTok ? endTok.v : ')' }
    }
    if (v === 'right') return null
    if (v === 'text' || v === 'mathrm' || v === 'operatorname' || v === 'textrm' || v === 'mathit') {
      const w = this.rawArg().trim()
      if (FUNCS[w]) return { k: 'fn', v: w }
      return w ? { k: 'word', v: w } : null
    }
    if (v === 'begin') {
      const env = this.rawArg()
      if (env !== 'cases') return null
      const rows: Atom[][][] = []
      let row: Atom[][] = []
      for (;;) {
        const cell = this.seq((x) => (x.t === 'cmd' && (x.v === '\\' || x.v === 'end')) || (x.t === 'ch' && x.v === '&'))
        row.push(cell)
        const t2 = this.toks[this.i++]
        if (!t2 || (t2.t === 'cmd' && t2.v === 'end')) {
          this.rawArg()
          rows.push(row)
          break
        }
        if (t2.t === 'cmd' && t2.v === '\\') {
          rows.push(row)
          row = []
        }
      }
      return { k: 'cases', rows: rows.filter((r) => r.some((c) => c.length > 0)) }
    }
    if (v === 'int' || v === 'sum' || v === 'prod' || v === 'lim') return { k: 'big', v }
    if (FUNCS[v]) return { k: 'fn', v }
    if (SYMBOLS[v]) return { k: 'word', v: SYMBOLS[v] }
    if (OPS[v]) return { k: 'op', v }
    if (v === '{' || v === '}') return null
    if (v === '|' || v === 'vert') {
      const kids = this.seq((x) => x.t === 'cmd' && (x.v === '|' || x.v === 'vert'))
      this.i++
      return { k: 'abs', kids }
    }
    if (v === 'mathbb' || v === 'mathbf') return null
    return { k: 'word', v }
  }
}

// ----------------------------------------------------------------------------
// Speak
// ----------------------------------------------------------------------------

const FUNCTION_LETTERS = new Set(['f', 'g', 'h', 'p', 'q'])

/** One term — no operator at the top level — speaks without "the quantity". */
function simple(atoms: Atom[]): boolean {
  if (atoms.length === 1) return true
  if (atoms.length === 2 && atoms[0].base.k === 'op' && atoms[0].base.v === '-') return true
  return !atoms.some((a) => a.base.k === 'op' || a.base.k === 'frac' || a.base.k === 'cases')
}

const ORDINAL_ROOT: Record<string, string> = { '2': 'square', '3': 'cube', '4': 'fourth', '5': 'fifth' }

function textOf(atoms: Atom[]): string {
  return atoms.map((a) => (a.base.k === 'num' || a.base.k === 'var' ? a.base.v : a.base.k === 'op' ? a.base.v : '?')).join('')
}

/** "squared", "cubed", "to the fourth", "to the n", "to the x plus 1". */
function power(sup: Atom[]): string {
  const t = textOf(sup)
  if (t === '2') return 'squared'
  if (t === '3') return 'cubed'
  if (sup.length === 1 && sup[0].base.k === 'word' && sup[0].base.v === 'degrees') return 'degrees'
  if (/^\d+$/.test(t)) return `to the ${ordinal(t)}`
  const s = speakSeq(sup)
  return simple(sup) ? `to the ${s}` : `to the ${s}, end exponent`
}

function ordinal(n: string): string {
  const v = Number(n)
  if (v === 1) return 'first'
  if (v === 4) return 'fourth'
  if (v === 5) return 'fifth'
  if (v === 6) return 'sixth'
  if (v === 7) return 'seventh'
  if (v === 8) return 'eighth'
  if (v === 9) return 'ninth'
  if (v === 10) return 'tenth'
  return n.endsWith('1') && !n.endsWith('11') ? `${n}st` : n.endsWith('2') && !n.endsWith('12') ? `${n}nd` : n.endsWith('3') && !n.endsWith('13') ? `${n}rd` : `${n}th`
}

const DENOMINATORS: Record<string, [string, string]> = {
  '2': ['half', 'halves'], '3': ['third', 'thirds'], '4': ['fourth', 'fourths'], '5': ['fifth', 'fifths'],
  '6': ['sixth', 'sixths'], '7': ['seventh', 'sevenths'], '8': ['eighth', 'eighths'], '9': ['ninth', 'ninths'],
  '10': ['tenth', 'tenths'],
}

/** 3/4 → "3 fourths", 1/2 → "1 half": small whole-number fractions as a person says them. */
function commonFraction(n: string, d: string): string | null {
  if (!/^\d{1,2}$/.test(n) || !DENOMINATORS[d]) return null
  return `${n} ${DENOMINATORS[d][n === '1' ? 0 : 1]}`
}

/** [−2, 5) → "the interval from negative 2 to 5, including negative 2". */
function intervalWords(b: Extract<Base, { k: 'paren' }>): string | null {
  const commas = b.kids.filter((a) => a.base.k === 'op' && a.base.v === ',')
  if (commas.length !== 1) return null
  const at = b.kids.indexOf(commas[0])
  const lo = b.kids.slice(0, at)
  const hi = b.kids.slice(at + 1)
  if (lo.length === 0 || hi.length === 0) return null
  const loS = speakSeq(lo)
  const hiS = speakSeq(hi)
  const infinite = /infinity/.test(loS) || /infinity/.test(hiS)
  const closedLo = b.open === '['
  const closedHi = b.close === ']'
  if (!infinite && !closedLo && !closedHi) return `the point ${loS}, ${hiS}`
  const inc = [closedLo ? loS : null, closedHi ? hiS : null].filter((x): x is string => x !== null)
  const tail = inc.length === 2 ? ', including both ends' : inc.length === 1 ? `, including ${inc[0]}` : ''
  return `the interval from ${loS} to ${hiS}${tail}`
}

const PRIMES = ['', 'prime', 'double prime', 'triple prime']

function primeWords(n: number | undefined): string {
  if (!n) return ''
  return ` ${PRIMES[n] ?? `${n} primes`}`
}

/** A single atom, ignoring its scripts. */
function speakBase(a: Atom): string {
  const b = a.base
  switch (b.k) {
    case 'num':
    case 'var':
      return b.v
    case 'word':
      return b.v
    case 'op':
      return OPS[b.v] ?? b.v
    case 'fn':
      return FUNCS[b.v] ?? b.v
    case 'big':
      return b.v
    case 'group':
      return speakSeq(b.kids)
    case 'paren': {
      const iv = intervalWords(b)
      if (iv) return iv
      return simple(b.kids) ? speakSeq(b.kids) : `the quantity ${speakSeq(b.kids)}`
    }
    case 'abs':
      return simple(b.kids)
        ? `the absolute value of ${speakSeq(b.kids)}`
        : `the absolute value of ${speakSeq(b.kids)}, end absolute value`
    case 'frac': {
      const n = textOf(b.num)
      const d = textOf(b.den)
      if (n === 'dy' && d === 'dx') return 'd y by d x'
      if (n === 'd' && /^d[a-z]$/.test(d)) return `the derivative with respect to ${d[1]} of`
      if (/^d[a-z]$/.test(n) && /^d[a-z]$/.test(d)) return `d ${n[1]} by d ${d[1]}`
      const common = commonFraction(n, d)
      if (common) return common
      if (simple(b.num) && simple(b.den)) return `${speakSeq(b.num)} over ${speakSeq(b.den)}`
      return `the fraction with numerator ${speakSeq(b.num)} and denominator ${speakSeq(b.den)}`
    }
    case 'sqrt': {
      const idx = b.idx ? textOf(b.idx) : '2'
      const kind = ORDINAL_ROOT[idx] ?? `${speakSeq(b.idx ?? [])}th`
      const body = speakSeq(b.body)
      return simple(b.body) ? `the ${kind} root of ${body}` : `the ${kind} root of ${body}, end root`
    }
    case 'cases': {
      const rows = b.rows.map((r) => {
        const val = speakSeq(r[0] ?? [])
        const cond = speakSeq(r[1] ?? []).trim()
        if (!cond) return val
        if (/^(if|for|when|otherwise)\b/.test(cond)) return `${val} ${cond}`
        return `${val} if ${cond}`
      })
      return `piecewise: ${rows.join('; ')}`
    }
  }
}

/** A sequence of atoms as words. */
function speakSeq(atoms: Atom[]): string {
  const words: string[] = []
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i]
    const b = a.base
    const prev = atoms[i - 1]
    const next = atoms[i + 1]

    // A minus at the start, or after an operator or an opening, is a sign.
    if (b.k === 'op' && b.v === '-' && (!prev || prev.base.k === 'op')) {
      words.push('negative')
      continue
    }

    // Big operators: their limits are their scripts.
    if (b.k === 'big') {
      const lo = a.sub ? speakSeq(a.sub) : ''
      const hi = a.sup ? speakSeq(a.sup) : ''
      if (b.v === 'lim') words.push(lo ? `the limit as ${lo} of` : 'the limit of')
      else {
        const name = b.v === 'int' ? 'integral' : b.v === 'sum' ? 'sum' : 'product'
        words.push(lo && hi ? `the ${name} from ${lo} to ${hi} of` : lo ? `the ${name} over ${lo} of` : `the ${name} of`)
      }
      continue
    }

    // Functions: "sine of x", "sine squared of x", "inverse sine of x", "log base 2 of x".
    if (b.k === 'fn') {
      let name = FUNCS[b.v] ?? b.v
      const supText = a.sup ? textOf(a.sup) : ''
      if (supText === '-1') name = `inverse ${name}`
      else if (a.sup) name = `${name} ${power(a.sup)}`
      if (a.sub) name = `${name} base ${speakSeq(a.sub)}`
      if (b.v === 'exp') {
        words.push('e to the')
        continue
      }
      if (next && (next.base.k === 'paren' || next.base.k === 'var' || next.base.k === 'num' || next.base.k === 'word' || next.base.k === 'group')) {
        const inner = next.base.k === 'paren' ? next.base.kids : null
        const arg = inner ? (simple(inner) ? speakSeq(inner) : `the quantity ${speakSeq(inner)},`) : speakBase(next)
        let w = `${name} of ${arg}`
        if (next.sup) w += next.base.k === 'paren' ? `, ${power(next.sup)}` : ` ${power(next.sup)}`
        words.push(w)
        i++
        continue
      }
      words.push(name)
      continue
    }

    // f(x), f′(x), g(x + 1): a function letter applied to a bracket.
    if (b.k === 'var' && FUNCTION_LETTERS.has(b.v) && next && next.base.k === 'paren' && !a.sup) {
      const inner = next.base.kids
      words.push(`${b.v}${primeWords(a.primes)} of ${simple(inner) ? speakSeq(inner) : `the quantity ${speakSeq(inner)},`}`)
      if (next.sup) words.push(power(next.sup))
      i++
      continue
    }

    let w = speakBase(a) + primeWords(a.primes)
    if (a.sub) w += ` sub ${speakSeq(a.sub)}`
    if (a.sup) {
      if (b.k === 'paren' && !simple(b.kids)) w = `${w}, ${power(a.sup)}`
      else if (b.k === 'word' && b.v === 'e') w = `e ${power(a.sup)}`
      else w = `${w} ${power(a.sup)}`
    }
    // a(x − 1): a coefficient times a bracket says so.
    if (prev && (prev.base.k === 'num' || prev.base.k === 'var' || prev.base.k === 'word') && b.k === 'paren' && !simple(b.kids)) {
      words.push('times')
    }
    words.push(w)
  }
  return words.join(' ')
}

/** A LaTeX string (as KaTeX renders it) in words. Never throws. */
export function speakLatex(latex: string): string {
  try {
    const p = new Parser(tokenize(String(latex ?? '')))
    const atoms = p.seq(() => false)
    return tidy(speakSeq(atoms))
  } catch {
    return tidy(String(latex ?? '').replace(/\\/g, ' '))
  }
}

function tidy(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/\s+([,;])/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*$/g, '')
    .replace(/,\s*end (exponent|root|absolute value)\s*$/g, '')
    .replace(/,\s*$/g, '')
    .trim()
}

/** The accessible name of an equation button: "Equation: y equals x squared minus 3". */
export function equationLabel(latex: string, what = 'Equation'): string {
  const s = speakLatex(latex)
  return s ? `${what}: ${s}` : what
}

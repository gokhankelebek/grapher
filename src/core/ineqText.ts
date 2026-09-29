// ============================================================================
// src/core/ineqText.ts — typed math as a sentence can print it.
//
// The inequality card and the test point write what a teacher writes on the
// board: "Test (0, 0): 0 < 0² − 4 → 0 < −4 ✗". That is the TYPED expression
// with numbers substituted for x, y and the sliders — not the parser's LaTeX,
// which has already reordered and bracketed it — prettified into Unicode
// (² for ^2, − for -, · for an explicit product).
//
// Pure string work, no parser import: the parser imports prettyMath from here
// for its boundary text, and src/core/inequality2d.ts passes the parser's own
// "is this a function name" predicate into substitute().
// ============================================================================

const SUP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻',
}

const WORDS: Record<string, string> = { pi: 'π', sqrt: '√', theta: 'θ', tau: 'τ' }

/** A number as a sentence prints it: 3, −0.5, 2.333 (never 2.3333333333). */
export function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? 'undefined' : v > 0 ? '∞' : '−∞'
  const r = Math.round(v)
  if (Math.abs(v - r) < 1e-9 * Math.max(1, Math.abs(v))) return r === 0 ? '0' : String(r).replace('-', '−')
  const a = Math.abs(v)
  const digits = a >= 100 ? 1 : a >= 1 ? 3 : 4
  let s = v.toFixed(digits)
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
  if (s === '-0') s = '0'
  return s.replace('-', '−')
}

/** ASCII form of a number for substitution into typed text (fmtNum, with '-'). */
function asciiNum(v: number): string {
  return fmtNum(v).replace('−', '-')
}

type Kind = 'num' | 'ident' | 'op' | 'open' | 'close' | 'rel' | 'comma' | 'bar' | 'none'

interface Tok {
  k: Kind
  t: string
}

const REL_TEXT: Record<string, string> = { '<=': '≤', '>=': '≥', '=<': '≤', '=>': '≥' }

function lex(src: string): Tok[] {
  const out: Tok[] = []
  const s = src.replace(/\*\*/g, '^')
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (/[0-9.]/.test(c)) {
      let j = i
      while (j < s.length && /[0-9.]/.test(s[j])) j++
      out.push({ k: 'num', t: s.slice(i, j) })
      i = j
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++
      out.push({ k: 'ident', t: s.slice(i, j) })
      i = j
      continue
    }
    const two = s.slice(i, i + 2)
    if (REL_TEXT[two]) {
      out.push({ k: 'rel', t: REL_TEXT[two] })
      i += 2
      continue
    }
    if (c === '<' || c === '>' || c === '≤' || c === '≥' || c === '=') {
      out.push({ k: 'rel', t: c })
      i++
      continue
    }
    if (c === '(' || c === '[' || c === '{') out.push({ k: 'open', t: c })
    else if (c === ')' || c === ']' || c === '}') out.push({ k: 'close', t: c })
    else if (c === ',') out.push({ k: 'comma', t: c })
    else if (c === '|') out.push({ k: 'bar', t: c })
    else if (c === '−') out.push({ k: 'op', t: '-' })
    else if (c === '·' || c === '×') out.push({ k: 'op', t: '*' })
    else if ('+-*/^'.includes(c)) out.push({ k: 'op', t: c })
    else out.push({ k: 'ident', t: c }) // π, θ, anything else: kept as written
    i++
  }
  return out
}

/** The exponent text right after a '^' when it can be written in superscript. */
function superscript(toks: Tok[], i: number): { text: string; next: number } | null {
  // ^2   ^-1   ^(2)   ^(-1)
  let j = i
  let paren = false
  if (toks[j]?.k === 'open' && toks[j].t === '(') {
    paren = true
    j++
  }
  let neg = false
  if (toks[j]?.k === 'op' && toks[j].t === '-') {
    neg = true
    j++
  }
  const n = toks[j]
  if (!n || n.k !== 'num' || !/^\d+$/.test(n.t) || n.t.length > 2) return null
  j++
  if (paren) {
    if (toks[j]?.k !== 'close') return null
    j++
  }
  // x^2 followed by another factor that is a number would read as x²3.
  const text = (neg ? '⁻' : '') + [...n.t].map((d) => SUP[d]).join('')
  return { text, next: j }
}

/**
 * Typed math as Unicode: x^2 - 4 → x² − 4, 2*x → 2x, a*x+b → ax + b,
 * sqrt(x) → √(x), pi → π, <= → ≤. Spacing is normalised: binary + − and the
 * relation signs get one space each side, nothing else does.
 */
export function prettyMath(src: string): string {
  const toks = lex(src)
  let out = ''
  let prev: Tok | null = null
  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i]
    if (tk.k === 'op') {
      if (tk.t === '^') {
        const sup = superscript(toks, i + 1)
        if (sup) {
          out += sup.text
          i = sup.next - 1
          prev = { k: 'close', t: ')' }
          continue
        }
        out += '^'
        prev = tk
        continue
      }
      if (tk.t === '*') {
        const nxt = toks[i + 1]
        const pDigit = prev?.k === 'num'
        const nDigit = nxt?.k === 'num'
        const joinable =
          prev !== null &&
          (prev.k === 'num' || prev.k === 'ident' || prev.k === 'close') &&
          nxt !== undefined &&
          (nxt.k === 'ident' || (nxt.k === 'open' && !pDigit)) &&
          !(pDigit && nDigit)
        out += joinable ? '' : '·'
        prev = tk
        continue
      }
      if (tk.t === '/') {
        out += '/'
        prev = tk
        continue
      }
      // + and −: binary (spaced) or unary (tight)
      const unary =
        prev === null || prev.k === 'op' || prev.k === 'open' || prev.k === 'rel' || prev.k === 'comma'
      const sign = tk.t === '-' ? '−' : '+'
      out += unary ? sign : ` ${sign} `
      prev = tk
      continue
    }
    if (tk.k === 'rel') {
      out += ` ${tk.t} `
      prev = tk
      continue
    }
    if (tk.k === 'comma') {
      out += ', '
      prev = tk
      continue
    }
    if (tk.k === 'ident') {
      out += WORDS[tk.t] ?? tk.t
      prev = tk
      continue
    }
    out += tk.t
    prev = tk
  }
  return out.replace(/\s+/g, ' ').trim()
}

/**
 * The typed text with numbers in place of letters: x and y, and every slider
 * the line has. `reserved(word)` is the parser's own test for a built-in name
 * (sin, sqrt, pi, e …) — such a word is kept whole; any other run of letters
 * is read letter by letter, exactly as the parser reads "ax" as a·x. A
 * substituted negative is bracketed, and a product that was juxtaposed
 * (2x, xy) gets its · back, so 2x at x = −1 reads 2·(−1).
 *
 * Returns the ASCII text; prettyMath() makes it printable.
 */
export function substitute(
  src: string,
  vals: Readonly<Record<string, number>>,
  reserved: (word: string) => boolean,
): string {
  let out = ''
  type Last = 'num' | 'subst' | 'ident' | 'close' | 'other'
  let last = 'other' as Last
  const emit = (kind: Last, text: string): void => {
    const atomic = kind === 'num' || kind === 'subst' || kind === 'ident'
    const lastAtomic = last === 'num' || last === 'subst' || last === 'ident' || last === 'close'
    if (atomic && lastAtomic && (kind === 'subst' || last === 'subst')) out += '*'
    out += text
    last = kind
  }
  let i = 0
  const s = src
  while (i < s.length) {
    const c = s[i]
    if (/\s/.test(c)) {
      out += c
      i++
      continue
    }
    if (/[0-9.]/.test(c)) {
      let j = i
      while (j < s.length && /[0-9.]/.test(s[j])) j++
      emit('num', s.slice(i, j))
      i = j
      continue
    }
    if (/[A-Za-z]/.test(c)) {
      let j = i
      while (j < s.length && /[A-Za-z0-9]/.test(s[j])) j++
      const word = s.slice(i, j)
      i = j
      if (reserved(word) && !(word in vals)) {
        emit('ident', word)
        continue
      }
      if (word === 'log' && s[i] === '_') {
        emit('ident', word)
        continue
      }
      // Letter by letter, the way the parser splits an unknown word.
      for (const ch of word) {
        if (/[0-9]/.test(ch)) {
          emit('num', ch)
          continue
        }
        const v = vals[ch]
        if (v === undefined) {
          emit('ident', ch)
          continue
        }
        const t = asciiNum(v)
        emit('subst', v < 0 && t !== '0' ? `(${t})` : t)
      }
      continue
    }
    if (c === '(' && (last === 'subst')) {
      out += '*('
      last = 'other'
      i++
      continue
    }
    if (c === ')' || c === ']' || c === '|') {
      out += c
      last = c === '|' ? 'other' : 'close'
      i++
      continue
    }
    out += c
    last = 'other'
    i++
  }
  return out
}

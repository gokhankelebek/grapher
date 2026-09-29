// ============================================================================
// src/render/texText.ts — a board label, as LaTeX that pdflatex will accept.
//
// Every string the renderer draws — a tick number, a π tick, a coordinate
// chip, an axis name, a curve letter, a caption — becomes one piece of LaTeX
// for the TikZ and pgfplots exports. Two promises:
//
//   * MATH IS MATH. A label with no prose in it is set in $…$ as a whole:
//     "−π/2" is $-\frac{\pi}{2}$, "(2, 4)" is $(2, 4)$, "P₀" is $P_{0}$,
//     "c = 2√3/3" is $c = \frac{2\sqrt{3}}{3}$, and a plain "3" is $3$ too, so
//     the digits of −3 and 3 on the same axis come from the same font. In a
//     label that does contain words ("Graph of f", "(2, 0) (touches)") only the
//     runs that carry mathematics go into $…$.
//   * NOTHING BREAKS THE FILE. Every TeX special (\ { } $ & # % _ ^ ~) is
//     escaped, every non-ASCII character this knows is mapped to a command,
//     and anything it does not know becomes "?" — never a raw byte that
//     pdflatex's default setup cannot typeset.
// ============================================================================

/** Unicode → math-mode LaTeX. */
const MATH_SYMBOLS: Readonly<Record<string, string>> = {
  '−': '-', '–': '-', 'π': '\\pi', 'θ': '\\theta', '∞': '\\infty', '≈': '\\approx',
  '≤': '\\le', '≥': '\\ge', '≠': '\\ne', '·': '\\cdot', '⋅': '\\cdot', '×': '\\times',
  '÷': '\\div', '±': '\\pm', '°': '^{\\circ}', '′': "'", '″': "''", 'Δ': '\\Delta',
  'δ': '\\delta', 'ε': '\\varepsilon', 'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma',
  'λ': '\\lambda', 'μ': '\\mu', 'σ': '\\sigma', 'φ': '\\varphi', 'ω': '\\omega',
  'τ': '\\tau', 'ρ': '\\rho', 'Σ': '\\Sigma', 'Ω': '\\Omega', '∫': '\\int',
  '→': '\\to', '∈': '\\in', '∪': '\\cup', '∩': '\\cap', '∂': '\\partial', '∑': '\\sum',
  '≡': '\\equiv', '∅': '\\emptyset', '⇒': '\\Rightarrow', '…': '\\ldots', 'ℝ': '\\mathbf{R}',
  '∠': '\\angle', '∘': '\\circ', '|': '|',
}

const SUPERS: Readonly<Record<string, string>> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8',
  '⁹': '9', '⁻': '-', '⁺': '+', 'ⁿ': 'n', 'ⁱ': 'i', 'ˣ': 'x',
}
const SUBS: Readonly<Record<string, string>> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8',
  '₉': '9', '₋': '-', '₊': '+', 'ₙ': 'n', 'ₓ': 'x', 'ᵢ': 'i', 'ₖ': 'k', 'ₐ': 'a',
}

/** Unicode → text-mode LaTeX (for prose runs). */
const TEXT_SYMBOLS: Readonly<Record<string, string>> = {
  '‘': '`', '’': "'", '“': '``', '”': "''", '–': '--', '—': '---', '…': '\\ldots{}',
  '•': '\\textbullet{}', ' ': '~',
}

/** Latin-1 letters pdflatex's default UTF-8 input handles. */
const LATIN1_LETTER = /[À-ÖØ-öø-ÿ]/

const FUNCTION_NAMES = [
  'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'sin', 'cos', 'tan', 'sec', 'csc',
  'cot', 'ln', 'log', 'exp', 'lim', 'max', 'min',
]

const FN_RE = new RegExp(`(${FUNCTION_NAMES.join('|')})(?=\\s*[(^0-9a-zA-Zπθ√])`, 'g')

/** Escape a prose run. */
export function texEscapeText(s: string): string {
  let out = ''
  for (const ch of s) {
    switch (ch) {
      case '\\': out += '\\textbackslash{}'; break
      case '{': case '}': case '$': case '&': case '#': case '%': case '_':
        out += '\\' + ch
        break
      case '~': out += '\\textasciitilde{}'; break
      case '^': out += '\\textasciicircum{}'; break
      case '<': out += '\\textless{}'; break
      case '>': out += '\\textgreater{}'; break
      case '|': out += '\\textbar{}'; break
      default: {
        const code = ch.codePointAt(0) ?? 63
        if (code >= 32 && code <= 126) out += ch
        else if (TEXT_SYMBOLS[ch] !== undefined) out += TEXT_SYMBOLS[ch]
        else if (LATIN1_LETTER.test(ch)) out += ch
        else if (MATH_SYMBOLS[ch] !== undefined) out += `$${MATH_SYMBOLS[ch]}$`
        else if (SUPERS[ch] !== undefined) out += `\\textsuperscript{${SUPERS[ch]}}`
        else if (SUBS[ch] !== undefined) out += `$_{${SUBS[ch]}}$`
        else if (ch === '\t' || ch === '\n') out += ' '
        else out += '?'
      }
    }
  }
  return out
}

/** A fraction's numerator or denominator as the renderer writes them. */
const ATOM = String.raw`(?:\d+(?:\.\d+)?)?(?:√\d+)?π?`
const FRAC_RE = new RegExp(`(${ATOM})/(${ATOM})`, 'g')

/** Convert a run that is known to be mathematics (no $ around it). */
export function texMath(src: string): string {
  // 1. Fractions the board writes: π/2, 3π/2, 2√3/3, 1/2 (sign stays outside).
  let s = src.replace(FRAC_RE, (m, a: string, b: string) =>
    a === '' || b === '' ? m : `\u0001${a}\u0002${b}\u0003`,
  )
  // 2. Function names typed as words: sin(x) → \sin(x).
  s = s.replace(FN_RE, (_m, f: string) => `\u0004${f}\u0005`)

  let out = ''
  const chars = [...s]
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    if (ch === '\u0001') { out += '\\frac{'; continue }
    if (ch === '\u0002') { out += '}{'; continue }
    if (ch === '\u0003') { out += '}'; continue }
    if (ch === '\u0004') {
      let name = ''
      while (i + 1 < chars.length && chars[i + 1] !== '\u0005') name += chars[++i]
      i++ // skip \u0005
      out += `\\${name}\u0006`
      continue
    }
    if (ch === '√') {
      // √2, √x, √(x + 1), √π
      const next = chars[i + 1]
      if (next === '(') {
        let depth = 0
        let j = i + 1
        for (; j < chars.length; j++) {
          if (chars[j] === '(') depth++
          else if (chars[j] === ')') { depth--; if (depth === 0) break }
        }
        if (j < chars.length) {
          out += `\\sqrt{${texMath(chars.slice(i + 2, j).join(''))}}`
          i = j
          continue
        }
      }
      let j = i + 1
      if (j < chars.length && /[0-9.]/.test(chars[j])) {
        while (j < chars.length && /[0-9.]/.test(chars[j])) j++
      } else if (j < chars.length && /[A-Za-zπθ]/.test(chars[j])) {
        j++
      }
      if (j > i + 1) {
        out += `\\sqrt{${texMath(chars.slice(i + 1, j).join(''))}}`
        i = j - 1
      } else {
        out += '\\surd\u0006'
      }
      continue
    }
    if (SUPERS[ch] !== undefined || SUBS[ch] !== undefined) {
      const table = SUPERS[ch] !== undefined ? SUPERS : SUBS
      let run = ''
      let j = i
      while (j < chars.length && table[chars[j]] !== undefined) run += table[chars[j++]]
      out += `${table === SUPERS ? '^' : '_'}{${run}}`
      i = j - 1
      continue
    }
    switch (ch) {
      case '\\': out += '\\backslash\u0006'; continue
      case '{': case '}': case '$': case '&': case '#': case '%': case '_':
        out += '\\' + ch
        continue
      case '~': out += '\\sim\u0006'; continue
      case '^': {
        // A typed power: x^2, e^(−x), x^-1.
        let j = i + 1
        let body = ''
        if (chars[j] === '(') {
          let depth = 0
          let k = j
          for (; k < chars.length; k++) {
            if (chars[k] === '(') depth++
            else if (chars[k] === ')') { depth--; if (depth === 0) break }
          }
          if (k < chars.length) { body = chars.slice(j + 1, k).join(''); j = k + 1 }
        } else {
          if (chars[j] === '-' || chars[j] === '−') j++
          while (j < chars.length && /[0-9.]/.test(chars[j])) j++
          if (j === i + 1 && j < chars.length && /[A-Za-zπθ]/.test(chars[j])) j++
          body = chars.slice(i + 1, j).join('')
        }
        out += body === '' ? '\\hat{}' : `^{${texMath(body)}}`
        i = j - 1
        continue
      }
      case '\t': case '\n': out += ' '; continue
    }
    const code = ch.codePointAt(0) ?? 63
    if (code >= 32 && code <= 126) out += ch
    else if (MATH_SYMBOLS[ch] !== undefined) out += MATH_SYMBOLS[ch] + '\u0006'
    else if (LATIN1_LETTER.test(ch)) out += `\\text{${ch}}`
    else out += '?'
  }
  // A command written just before a letter needs a space (\pi x, not \pix);
  // \u0006 marks where a command name ended.
  return out.replace(/\u0006(?=[a-zA-Z])/g, ' ').replace(/\u0006/g, '')
}

/** A whitespace-delimited token that reads as prose: a word of 2+ letters that is not a function call. */
function isProse(token: string): boolean {
  const stripped = token.replace(FN_RE, ' ')
  return /[A-Za-zÀ-ÿ]{2,}/.test(stripped)
}

/** Does a run of non-prose tokens carry any mathematics worth $…$? */
function hasMathSignal(run: string): boolean {
  if (/(^|[^A-Za-z])[A-Za-z]($|[^A-Za-z])/.test(run)) return true // a single-letter variable
  if (/[=<>^/]/.test(run)) return true
  if (/\(.*,.*\)/.test(run)) return true
  for (const ch of run) {
    const c = ch.codePointAt(0) ?? 0
    if (c > 126 && (MATH_SYMBOLS[ch] !== undefined || SUPERS[ch] !== undefined || SUBS[ch] !== undefined || ch === '√')) return true
  }
  return false
}

/**
 * The LaTeX for one board label: math in $…$, prose escaped. Empty for an
 * empty or blank label.
 */
export function texLabel(label: string): string {
  const s = label.replace(/\s+/g, ' ').trim()
  if (s === '') return ''
  const tokens = s.split(' ')
  if (!tokens.some(isProse)) return `$${texMath(s)}$`
  const out: string[] = []
  let run: string[] = []
  const flush = (): void => {
    if (run.length === 0) return
    const text = run.join(' ')
    out.push(hasMathSignal(text) ? `$${texMath(text)}$` : texEscapeText(text))
    run = []
  }
  for (const t of tokens) {
    if (isProse(t)) {
      flush()
      out.push(texEscapeText(t))
    } else {
      run.push(t)
    }
  }
  flush()
  return out.join(' ')
}

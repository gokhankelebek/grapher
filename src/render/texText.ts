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
//     an accented letter outside Latin-1 (ğ ş İ ı …) becomes its TeX accent
//     (\u{g}, \c{s}, \.{I}, \i), prose punctuation inside mathematics (‘ ’ “ ”
//     — …) is set in \mbox{…} in text mode, and anything still unknown
//     becomes a visible [U+XXXX] — never a raw byte that pdflatex's default
//     setup cannot typeset, and never a silent "?".
//   * ONLY THE KERNEL + TikZ. Nothing here needs amsmath or amssymb: text in
//     math is \mbox (not \text), ✓ is \surd and ✗ is \times (not
//     \checkmark, which is amssymb), so the TikZ export compiles with just
//     \usepackage{tikz} and the pgfplots export with just pgfplots.
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
  // Verdict marks (a test point's "(1, 2) ✓"): kernel-only symbols, so no
  // amssymb is needed — \surd for a tick, \times for a cross.
  '✓': '\\surd', '✔': '\\surd', '✗': '\\times', '✘': '\\times', '✕': '\\times',
  '∓': '\\mp', '∝': '\\propto', '⊂': '\\subset', '⊆': '\\subseteq', '⊃': '\\supset',
  '⊇': '\\supseteq', '∉': '\\notin', '∀': '\\forall', '∃': '\\exists', '¬': '\\neg',
  '∧': '\\wedge', '∨': '\\vee', '≅': '\\cong', '≃': '\\simeq', '∼': '\\sim', '⊥': '\\perp',
  '∥': '\\parallel', '∇': '\\nabla', '∮': '\\oint', '←': '\\leftarrow', '↔': '\\leftrightarrow',
  '⇔': '\\Leftrightarrow', '⟹': '\\Longrightarrow', '↦': '\\mapsto', '↑': '\\uparrow', '↓': '\\downarrow',
  '⌊': '\\lfloor', '⌋': '\\rfloor', '⌈': '\\lceil', '⌉': '\\rceil', '⟨': '\\langle', '⟩': '\\rangle',
  '‖': '\\|', '∖': '\\setminus', '∗': '*', '∙': '\\cdot', '≪': '\\ll', '≫': '\\gg',
  'ℕ': '\\mathbf{N}', 'ℤ': '\\mathbf{Z}', 'ℚ': '\\mathbf{Q}', 'ℂ': '\\mathbf{C}',
  'ζ': '\\zeta', 'η': '\\eta', 'ι': '\\iota', 'κ': '\\kappa', 'ν': '\\nu', 'ξ': '\\xi',
  'ο': 'o', 'υ': '\\upsilon', 'χ': '\\chi', 'ψ': '\\psi', 'ϕ': '\\phi', 'ϑ': '\\vartheta',
  'Γ': '\\Gamma', 'Θ': '\\Theta', 'Λ': '\\Lambda', 'Ξ': '\\Xi', 'Π': '\\Pi', 'Φ': '\\Phi',
  'Ψ': '\\Psi', 'Υ': '\\Upsilon',
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

/** Combining accents → the kernel's text accent commands (\u{g}, \c{s}, …). */
const ACCENTS: Readonly<Record<string, string>> = {
  '\u0300': '\\`', '\u0301': "\\'", '\u0302': '\\^', '\u0303': '\\~', '\u0304': '\\=',
  '\u0306': '\\u', '\u0307': '\\.', '\u0308': '\\"', '\u030A': '\\r', '\u030B': '\\H',
  '\u030C': '\\v', '\u0323': '\\d', '\u0327': '\\c', '\u0328': '\\k', '\u0331': '\\b',
}

/** Letters with no decomposition that the kernel still has a command for. */
const TEXT_LETTERS: Readonly<Record<string, string>> = {
  'ı': '{\\i}', 'ȷ': '{\\j}', 'ł': '{\\l}', 'Ł': '{\\L}', 'đ': '{\\dj}', 'Đ': '{\\DJ}',
  'œ': '{\\oe}', 'Œ': '{\\OE}', 'ŋ': '{\\ng}', 'Ŋ': '{\\NG}',
}

/** Is this a combining mark (it decorates the character before it)? */
const COMBINING = /[\u0300-\u036f\u1ab0-\u1aff\u20d0-\u20ff\ufe20-\ufe2f]/

/**
 * Text-mode LaTeX for a character none of the tables knows — never "?", never
 * a raw byte: an accented letter as its accent command, a compatibility form
 * (ﬁ, full-width digits) as its plain letters, and anything else as a visible
 * [U+XXXX] so the author can see what to fix. Empty for a lone combining mark.
 */
function textFallback(ch: string): string {
  if (TEXT_LETTERS[ch] !== undefined) return TEXT_LETTERS[ch]
  if (COMBINING.test(ch)) return ''
  const code = ch.codePointAt(0) ?? 63
  if (code < 32 || code === 127 || (code >= 0x80 && code < 0xa0)) return ' '
  const nfd = ch.normalize('NFD')
  const base = [...nfd]
  if (base.length >= 2 && base.slice(1).every((c) => ACCENTS[c] !== undefined)) {
    const first = base[0]
    const cp = first.codePointAt(0) ?? 0
    if ((cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122)) {
      // i and j lose their dot under an accent above: \u{\i}.
      let out = first === 'i' ? '\\i' : first === 'j' ? '\\j' : first
      for (const acc of base.slice(1)) out = `${ACCENTS[acc]}{${out}}`
      return out
    }
  }
  const compat = ch.normalize('NFKD').replace(COMBINING, '')
  if (compat !== ch && compat.length > 0 && [...compat].every((c) => {
    const k = c.codePointAt(0) ?? 0
    return k >= 32 && k <= 126
  })) {
    return texEscapeText(compat)
  }
  return `[U+${code.toString(16).toUpperCase().padStart(4, '0')}]`
}

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
      // The symbols OT1 has no glyph for — \{ \} < > | \ — are set in math:
      // their text forms come from the OMS/OML fonts, which have no bold or
      // sans shape, so in a bold title (\bfseries) pdflatex would substitute.
      case '\\': out += '$\\backslash$'; break
      case '{': out += '$\\{$'; break
      case '}': out += '$\\}$'; break
      case '$': case '&': case '#': case '%': case '_':
        out += '\\' + ch
        break
      case '~': out += '\\textasciitilde{}'; break
      case '^': out += '\\textasciicircum{}'; break
      case '<': out += '$<$'; break
      case '>': out += '$>$'; break
      case '|': out += '$|$'; break
      case '√': out += '$\\surd$'; break
      default: {
        const code = ch.codePointAt(0) ?? 63
        if (code >= 32 && code <= 126) out += ch
        else if (TEXT_SYMBOLS[ch] !== undefined) out += TEXT_SYMBOLS[ch]
        else if (LATIN1_LETTER.test(ch)) out += ch
        else if (MATH_SYMBOLS[ch] !== undefined) out += `$${MATH_SYMBOLS[ch]}$`
        else if (SUPERS[ch] !== undefined) out += `\\textsuperscript{${SUPERS[ch]}}`
        else if (SUBS[ch] !== undefined) out += `$_{${SUBS[ch]}}$`
        else if (ch === '\t' || ch === '\n') out += ' '
        else out += textFallback(ch)
      }
    }
  }
  return out
}

export interface TexOptions {
  /**
   * Keep a/b on one line, as the board writes it, instead of \frac{a}{b}: for
   * a chip placed where the board's one-line chip went, which a stacked
   * fraction would make taller than the room it was given.
   */
  slash?: boolean
}

/** A fraction's numerator or denominator as the renderer writes them. */
const ATOM = String.raw`(?:\d+(?:\.\d+)?)?(?:√\d+)?π?`
const FRAC_RE = new RegExp(`(${ATOM})/(${ATOM})`, 'g')

/** What may end / start an operand: a space between two of them is kept in math. */
const OPERAND_END = /[A-Za-z0-9.)\]#&%πθ∞'′″⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉ₙₓᵢₖₐ✓✔✗✘\u0003\u0005]/
const OPERAND_START = /[A-Za-z0-9(#&%πθ√∞✓✔✗✘\u0001\u0004]/

/** Convert a run that is known to be mathematics (no $ around it). */
export function texMath(src: string, opts: TexOptions = {}): string {
  // 1. Fractions the board writes: π/2, 3π/2, 2√3/3, 1/2 (sign stays outside).
  // Inline (opts.slash) they stay as the board writes them, a/b on one line.
  let s = opts.slash
    ? src
    : src.replace(FRAC_RE, (m, a: string, b: string) =>
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
          out += `\\sqrt{${texMath(chars.slice(i + 2, j).join(''), opts)}}`
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
        out += `\\sqrt{${texMath(chars.slice(i + 1, j).join(''), opts)}}`
        i = j - 1
      } else {
        out += '\\surd\u0006'
      }
      continue
    }
    if (ch === ' ') {
      // TeX drops spaces in mathematics. Between two operands ("#3 & x_1",
      // "(1, 1) ✓", "max P") the board's space is a real gap: keep it.
      // Around an operator or after punctuation TeX spaces it already.
      const prev = chars[i - 1] ?? ''
      const next = chars[i + 1] ?? ''
      out += OPERAND_END.test(prev) && OPERAND_START.test(next) ? '\\ ' : ' '
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
        out += body === '' ? '\\hat{}' : `^{${texMath(body, opts)}}`
        i = j - 1
        continue
      }
      case '\t': case '\n': out += ' '; continue
    }
    const code = ch.codePointAt(0) ?? 63
    if (code >= 32 && code <= 126) out += ch
    else if (MATH_SYMBOLS[ch] !== undefined) out += MATH_SYMBOLS[ch] + '\u0006'
    // Text inside mathematics goes in \mbox (kernel LaTeX; \text is amsmath):
    // a Latin-1 letter, prose punctuation (‘ ’ “ ” —), anything else known.
    else if (LATIN1_LETTER.test(ch)) out += `\\mbox{${ch}}`
    else if (TEXT_SYMBOLS[ch] !== undefined) out += `\\mbox{${TEXT_SYMBOLS[ch]}}`
    else if (code < 32 || code === 127) out += ' '
    else {
      const t = textFallback(ch)
      if (t !== '') out += `\\mbox{${t}}`
    }
  }
  // A command written just before a letter needs a space (\pi x, not \pix);
  // \u0006 marks where a command name ended.
  return out.replace(/\u0006(?=[a-zA-Z])/g, ' ').replace(/\u0006/g, '')
}

/** A whitespace-delimited token that reads as prose: a word of 2+ letters that is not a function call. */
function isProse(token: string): boolean {
  const stripped = token.replace(FN_RE, ' ')
  // Latin-1 and Latin Extended-A letters: "ılık", "Gökhan’s", "İzmir" are words.
  return /[A-Za-zÀ-ÖØ-öø-ÿĀ-ſ]{2,}/.test(stripped)
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
export function texLabel(label: string, opts: TexOptions = {}): string {
  const s = label.replace(/\s+/g, ' ').trim()
  if (s === '') return ''
  const tokens = s.split(' ')
  if (!tokens.some(isProse)) return `$${texMath(s, opts)}$`
  const out: string[] = []
  let run: string[] = []
  const flush = (): void => {
    if (run.length === 0) return
    const text = run.join(' ')
    out.push(hasMathSignal(text) ? `$${texMath(text, opts)}$` : texEscapeText(text))
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

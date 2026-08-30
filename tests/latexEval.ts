// ============================================================================
// tests/latexEval.ts — read a MODELS latex() string BACK into a function.
//
// The whole point of the printed equation is that it is the curve. The only
// way to test that claim is to evaluate what was actually printed, so this
// de-LaTeXes the (small, known) subset of KaTeX that src/core/fit/models.ts
// emits into a JS expression and compiles it. Anything it cannot read is a
// thrown error, not a silent pass.
// ============================================================================

/** Read a brace-balanced group starting at `i` (which must index the "{"). */
function readGroup(s: string, i: number): [string, number] {
  if (s[i] !== '{') throw new Error(`expected "{" at ${i} in ${s}`)
  let depth = 0
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') depth++
    else if (s[j] === '}') {
      depth--
      if (depth === 0) return [s.slice(i + 1, j), j + 1]
    }
  }
  throw new Error(`unbalanced braces from ${i} in ${s}`)
}

/** Replace every `${head}{G}` with `open + G + close`, innermost-safe. */
function replaceOneGroup(s: string, head: string, open: string, close: string): string {
  let out = ''
  let i = 0
  while (i < s.length) {
    if (s.startsWith(head, i)) {
      const [g, j] = readGroup(s, i + head.length)
      out += open + replaceOneGroup(g, head, open, close) + close
      i = j
      continue
    }
    out += s[i++]
  }
  return out
}

/** Replace every `\frac{A}{B}` with `((A)/(B))`. */
function replaceFrac(s: string): string {
  let out = ''
  let i = 0
  while (i < s.length) {
    if (s.startsWith('\\frac{', i)) {
      const [a, j] = readGroup(s, i + 5)
      const [b, k] = readGroup(s, j)
      out += `((${replaceFrac(a)})/(${replaceFrac(b)}))`
      i = k
      continue
    }
    out += s[i++]
  }
  return out
}

/**
 * Replace `BASE^{E}` with `Math.pow(BASE, E)`. The base has to be found rather
 * than assumed: `1.2x^{2}` must raise x, not 1.2x, once implicit
 * multiplication is inserted. Math.pow rather than ** because JS rejects
 * `-a**b` outright, and a leading unary minus is exactly what gauss prints.
 */
function replacePow(s: string): string {
  let out = ''
  let i = 0
  while (i < s.length) {
    if (s[i] === '^' && s[i + 1] === '{') {
      const [g, j] = readGroup(s, i + 1)
      let k = out.length
      if (out[k - 1] === ')') {
        let depth = 0
        while (k > 0) {
          k--
          if (out[k] === ')') depth++
          else if (out[k] === '(') { depth--; if (depth === 0) break }
        }
        while (k > 0 && /[A-Za-z_.]/.test(out[k - 1])) k--
      } else if (/[A-Za-z_]/.test(out[k - 1] ?? '')) {
        while (k > 0 && /[A-Za-z_.]/.test(out[k - 1])) k--
      } else {
        while (k > 0 && /[0-9.]/.test(out[k - 1])) k--
      }
      out = `${out.slice(0, k)}Math.pow(${out.slice(k)}, ${replacePow(g)})`
      i = j
      continue
    }
    out += s[i++]
  }
  return out
}

/** Replace `\left|A\right|` with `Math.abs(A)`. */
function replaceAbs(s: string): string {
  const open = '\\left|'
  const close = '\\right|'
  let out = ''
  let i = 0
  while (i < s.length) {
    if (s.startsWith(open, i)) {
      const end = s.indexOf(close, i + open.length)
      if (end < 0) throw new Error(`unclosed \\left| in ${s}`)
      out += `Math.abs(${replaceAbs(s.slice(i + open.length, end))})`
      i = end + close.length
      continue
    }
    out += s[i++]
  }
  return out
}

/** Turn one KaTeX expression from models.ts into a JS expression. */
export function delatex(src: string): string {
  let s = src
  s = s.replace(/ \\cdot 10\^\{(-?\d+)\}/g, '*10**($1)')
  s = replaceOneGroup(s, '\\sqrt[3]', 'Math.cbrt(', ')')
  s = replaceOneGroup(s, '\\sqrt', 'Math.sqrt(', ')')
  s = replaceFrac(s)
  s = replaceAbs(s)
  s = s.split('\\left(').join('(').split('\\right)').join(')')
  s = replaceOneGroup(s, 'e^', 'Math.exp(', ')')
  s = replacePow(s)
  s = s.split('\\cos\\theta').join('Math.cos(t)').split('\\sin\\theta').join('Math.sin(t)')
  s = s.split('\\cos t').join('Math.cos(t)').split('\\sin t').join('Math.sin(t)')
  s = s.split('\\cos').join('Math.cos').split('\\sin').join('Math.sin')
  s = s.split('\\theta').join('t')
  // implicit multiplication: "2x", "2(", "3t", "1.5Math.sin(...)", "0.4xy"
  s = s.replace(/([\d)])(?=[xyt]|Math\.|\()/g, '$1*')
  s = s.replace(/x(?=y)/g, 'x*')
  if (/\\[a-zA-Z]/.test(s)) throw new Error(`unhandled latex command in "${src}" -> "${s}"`)
  return s
}

/** Compile a KaTeX expression into f(x, y, t). */
export function compileLatex(src: string): (x: number, y: number, t: number) => number {
  const js = delatex(src)
  // eslint-disable-next-line no-new-func
  return new Function('x', 'y', 't', `"use strict"; return (${js})`) as (
    x: number, y: number, t: number,
  ) => number
}

/** "y = <expr>" / "r = <expr>" / "x = <expr>" -> f(x, y, t) of the RHS. */
export function compileRhs(tex: string): (x: number, y: number, t: number) => number {
  const i = tex.indexOf(' = ')
  if (i < 0) throw new Error(`no " = " in ${tex}`)
  return compileLatex(tex.slice(i + 3))
}

/** "<lhs> = <rhs>" -> Q(x, y) = lhs - rhs, the implicit form as printed. */
export function compileImplicit(tex: string): (x: number, y: number) => number {
  const i = tex.lastIndexOf(' = ')
  if (i < 0) throw new Error(`no " = " in ${tex}`)
  const lhs = compileLatex(tex.slice(0, i))
  const rhs = compileLatex(tex.slice(i + 3))
  return (x, y) => lhs(x, y, 0) - rhs(x, y, 0)
}

/** Fourier's latex: pull the x(t) and y(t) halves back out. */
export function compileFourier(tex: string): (t: number) => { x: number; y: number } {
  const m = /x \\approx (.*),\\;\\; y \\approx (.*)$/.exec(tex)
  if (!m) throw new Error(`unreadable fourier latex: ${tex}`)
  const fx = compileLatex(m[1])
  const fy = compileLatex(m[2])
  return t => ({ x: fx(0, 0, t), y: fy(0, 0, t) })
}

// ============================================================================
// tests/latexImport.test.ts — item-bank LaTeX → Grapher lines
// (src/core/latexImport.ts).
//
// Every translation is checked two ways: Grapher's own parser accepts the
// line, and the line EVALUATES equal to a hand-written Grapher equivalent at
// several points (so "parses" can never hide "means something else").
// ============================================================================

import { describe, it, expect } from 'vitest'
import { importFromLatex, latexToTyped, type ImportedDefinition } from '../src/core/latexImport'
import { parseExpression } from '../src/core/parse'
import { parseSlopeField } from '../src/core/parse/slopeField'

const XS = [-2.3, -1.7, -0.6, 0.35, 0.8, 1.3, 2.45, 3.1]
const TH = [0.2, 0.9, 1.7, 2.6, 4.1]
const PTS: [number, number][] = [[0.5, 1.5], [-1.2, 0.7], [2, -1], [1.1, 2.3]]

type Evaluator = (a: number, b?: number) => number

/** A Grapher line as a function: explicit f(x), polar r(θ), implicit F(x, y), slope f(x, y). */
function evaluator(line: string): Evaluator {
  if (/^\s*dy\/dx/.test(line)) {
    const o = parseSlopeField(line)
    if (!o.ok) throw new Error(`slope field "${line}" did not parse: ${o.error}`)
    const field = o.makeField('t', o.defaultParams, '#000')
    return (x, y) => field.f(x, y ?? 0)
  }
  const o = parseExpression(line)
  if (!o.ok) throw new Error(`"${line}" did not parse: ${o.error}`)
  const m = o.plot.makeModel('t')
  const p = o.plot.defaultParams
  if (m.evalExplicit) return (x) => m.evalExplicit!(p, x)
  if (m.evalPolar) return (t) => m.evalPolar!(p, t)
  if (m.evalImplicit) return (x, y) => m.evalImplicit!(p, x, y ?? 0)
  if (m.evalParametric) return (t) => { const v = m.evalParametric!(p, t); return v.x * 1000 + v.y }
  throw new Error(`"${line}" has no evaluator`)
}

function close(a: number, b: number): boolean {
  if (Number.isNaN(a) && Number.isNaN(b)) return true
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
}

/** The translated line evaluates like the hand-written one. */
function expectSame(got: string, want: string, kind: 'x' | 'theta' | 'xy' = 'x'): void {
  const f = evaluator(got)
  const g = evaluator(want)
  let finite = 0
  if (kind === 'xy') {
    for (const [x, y] of PTS) {
      const a = f(x, y)
      const b = g(x, y)
      expect(close(a, b), `${got} vs ${want} at (${x}, ${y}): ${a} vs ${b}`).toBe(true)
      if (Number.isFinite(a)) finite++
    }
  } else {
    for (const x of kind === 'theta' ? TH : XS) {
      const a = f(x)
      const b = g(x)
      expect(close(a, b), `${got} vs ${want} at ${x}: ${a} vs ${b}`).toBe(true)
      if (Number.isFinite(a)) finite++
    }
  }
  expect(finite, `${got}: too few finite sample values`).toBeGreaterThanOrEqual(2)
}

function only(src: string): ImportedDefinition {
  const r = importFromLatex(src)
  expect(r.warnings, `warnings for ${src}`).toEqual([])
  expect(r.definitions.length, `definitions for ${src}`).toBe(1)
  return r.definitions[0]
}

// ---------------------------------------------------------------------------
// The corpus: realistic AP Calc / Precalc / Math 3 snippets
// ---------------------------------------------------------------------------

interface Case {
  latex: string
  /** a hand-written Grapher line meaning the same thing */
  want: string
  name: string
  variable?: string
  kind?: ImportedDefinition['kind']
  eval?: 'x' | 'theta' | 'xy'
}

const CORPUS: Case[] = [
  { latex: 'Let $f(x)=\\sin(3x^{2}+1)$. What is $f\'(x)$?', want: 'y = sin(3*x^2 + 1)', name: 'f' },
  { latex: 'Let $g(t)=e^{\\,4t^{3}-t}$. What is $g\'(t)$?', want: 'y = exp(4x^3 - x)', name: 'g', variable: 't' },
  { latex: '$y=\\frac{x^2-9}{x-3}$', want: 'y = (x^2 - 9)/(x - 3)', name: 'y' },
  { latex: 'h(x)=\\begin{cases} x^2 & x<1 \\\\ 2x-1 & x\\ge 1 \\end{cases}', want: 'y = { x^2 if x < 1 ; 2x - 1 if x >= 1 }', name: 'h' },
  { latex: '$r(\\theta)=1+\\cos\\theta$', want: 'r = 1 + cos(theta)', name: 'r', kind: 'polar', eval: 'theta', variable: 'θ' },
  { latex: '$\\frac{dy}{dx}=x-y$', want: 'dy/dx = x - y', name: 'dy/dx', kind: 'slope-field', eval: 'xy' },
  { latex: '$x^2+y^2=25$', want: 'x^2 + y^2 = 25', name: '', kind: 'relation', eval: 'xy' },
  { latex: '$f(x)=\\dfrac{1}{3}x^{3}-4x+2$', want: 'y = x^3/3 - 4x + 2', name: 'f' },
  { latex: '$f(x)=\\sqrt[3]{x^{2}}\\left(x-5\\right)$', want: 'y = (x^2)^(1/3) * (x - 5)', name: 'f' },
  { latex: '$f(x)=x^{\\frac{2}{3}}(x-5)$', want: 'y = x^(2/3) * (x - 5)', name: 'f' },
  { latex: '$g(x)=\\ln\\left|x^{2}-4\\right|$', want: 'y = ln(abs(x^2 - 4))', name: 'g' },
  { latex: '$h(x)=\\log_{2}(x+1)$', want: 'y = ln(x + 1)/ln(2)', name: 'h' },
  { latex: '$k(x)=\\log x$', want: 'y = ln(x)/ln(10)', name: 'k' },
  { latex: '$y=2\\sec^{2}x-\\tan^{-1}(x)$', want: 'y = 2/cos(x)^2 - atan(x)', name: 'y' },
  { latex: '$f(x)=\\arcsin(x/2)+\\arccos\\frac{x}{3}$', want: 'y = asin(x/2) + acos(x/3)', name: 'f' },
  { latex: '$P(t)=\\frac{1000}{1+49e^{-0.3t}}$', want: 'y = 1000/(1 + 49*exp(-0.3*x))', name: 'P', variable: 't' },
  { latex: '$R(t)=20\\sin\\!\\left(\\tfrac{t}{4}\\right)$', want: 'y = 20*sin(x/4)', name: 'R', variable: 't' },
  { latex: '$v(t)=3t^{2}-12t+9$', want: 'y = 3x^2 - 12x + 9', name: 'v', variable: 't' },
  { latex: '$f(x)=\\frac{3x^{2}-5x}{x^{2}-1}$', want: 'y = (3x^2 - 5x)/(x^2 - 1)', name: 'f' },
  { latex: '$f(x)=x e^{-x^{2}}$', want: 'y = x*exp(-(x^2))', name: 'f' },
  { latex: '$f(x)=\\cos^{2}(2x)-\\sin(2x)\\cos(2x)$', want: 'y = cos(2x)^2 - sin(2x)*cos(2x)', name: 'f' },
  { latex: '$f(x)=\\left(x+1\\right)\\left(x-2\\right)^{2}$', want: 'y = (x + 1)*(x - 2)^2', name: 'f' },
  { latex: '$f(x)=2^{x}-3\\cdot 4^{-x}$', want: 'y = 2^x - 3*4^(-x)', name: 'f' },
  { latex: '$f(x)=\\frac{1}{2}x\\sqrt{4-x^{2}}$', want: 'y = 0.5*x*sqrt(4 - x^2)', name: 'f' },
  { latex: '$g(x)=\\lvert x-1\\rvert+\\left|x+1\\right|$', want: 'y = abs(x - 1) + abs(x + 1)', name: 'g' },
  { latex: '$f(x)=\\exp(x)-\\pi x$', want: 'y = exp(x) - 3.141592653589793*x', name: 'f' },
  { latex: '$f(x)=\\tan\\left(\\frac{\\pi x}{4}\\right)$', want: 'y = tan(pi*x/4)', name: 'f' },
  { latex: '$r=2\\sin(3\\theta)$', want: 'r = 2sin(3theta)', name: 'r', kind: 'polar', eval: 'theta', variable: 'θ' },
  { latex: '$r=\\frac{4}{1-\\cos\\theta}$', want: 'r = 4/(1 - cos(theta))', name: 'r', kind: 'polar', eval: 'theta', variable: 'θ' },
  { latex: '$\\frac{x^{2}}{9}+\\frac{y^{2}}{4}=1$', want: 'x^2/9 + y^2/4 = 1', name: '', kind: 'relation', eval: 'xy' },
  { latex: '$\\frac{(x-1)^{2}}{16}-\\frac{(y+2)^{2}}{9}=1$', want: '(x - 1)^2/16 - (y + 2)^2/9 = 1', name: '', kind: 'relation', eval: 'xy' },
  { latex: '$y\'=x y^{2}$', want: 'dy/dx = x*y^2', name: 'dy/dx', kind: 'slope-field', eval: 'xy' },
  { latex: '$\\frac{dy}{dx}=\\frac{x}{y}$', want: 'dy/dx = x/y', name: 'dy/dx', kind: 'slope-field', eval: 'xy' },
  { latex: '$\\frac{dP}{dt}=0.2P\\left(1-\\frac{P}{100}\\right)$', want: 'dy/dx = 0.2*y*(1 - y/100)', name: 'dP/dt', kind: 'slope-field', eval: 'xy', variable: 't' },
  { latex: '$A(r)=\\pi r^{2}$', want: 'y = pi*x^2', name: 'A', variable: 'r' },
  { latex: '$f(x)=1{,}000e^{0.05x}$', want: 'y = 1000*exp(0.05x)', name: 'f' },
  { latex: '$f(x)=\\frac{x}{\\sqrt{x^{2}+1}}$', want: 'y = x/sqrt(x^2 + 1)', name: 'f' },
  { latex: '$f(x)=\\sin x\\cos x$', want: 'y = sin(x)*cos(x)', name: 'f' },
  { latex: '$f(x)=\\sin 2x+\\cos 3x$', want: 'y = sin(2x) + cos(3x)', name: 'f' },
  { latex: '$f(x)=\\frac{e^{x}-e^{-x}}{2}$', want: 'y = sinh(x)', name: 'f' },
  { latex: '$f(x)=\\sqrt{x^{2}-4x+5}$', want: 'y = sqrt((x - 2)^2 + 1)', name: 'f' },
  { latex: '$f(x)=\\left\\lfloor x\\right\\rfloor+\\frac{1}{x}$', want: 'y = floor(x) + 1/x', name: 'f' },
  { latex: '$g(x)=\\operatorname{arcsec}(x)$', want: 'y = acos(1/x)', name: 'g' },
  { latex: '$y=\\left(\\frac{1}{2}\\right)^{x}+3$', want: 'y = 0.5^x + 3', name: 'y' },
]

describe('importFromLatex — the AP-style corpus', () => {
  it('has well over 25 snippets', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(40)
  })
  for (const c of CORPUS) {
    it(`${c.latex}`, () => {
      const d = only(c.latex)
      expect(d.name).toBe(c.name)
      if (c.variable) expect(d.variable).toBe(c.variable)
      expect(d.kind).toBe(c.kind ?? (c.name === 'y' ? 'function' : 'function'))
      expect(d.latex.length).toBeGreaterThan(0)
      expectSame(d.typed, c.want, c.eval ?? (c.kind === 'polar' ? 'theta' : 'x'))
    })
  }
})

describe('importFromLatex — the exact lines it writes', () => {
  const lines: [string, string][] = [
    ['$f(x)=\\sin(3x^{2}+1)$', 'f(x) = sin(3x^2 + 1)'],
    ['g(t)=e^{4t^{3}-t}', 'g(x) = e^(4x^3 - x)'],
    ['y=\\frac{x^2-9}{x-3}', 'y = (x^2 - 9)/(x - 3)'],
    ['h(x)=\\begin{cases} x^2 & x<1 \\\\ 2x-1 & x\\ge 1 \\end{cases}', 'h(x) = { x^2 if x < 1 ; 2x - 1 if x >= 1 }'],
    ['r(\\theta)=1+\\cos\\theta', 'r = 1 + cos(theta)'],
    ['\\frac{dy}{dx}=x-y', 'dy/dx = x - y'],
    ['x^2+y^2=25', 'x^2 + y^2 = 25'],
    ['$f(x)=\\frac{1}{2}x^{2}$', 'f(x) = (1/2)x^2'],
    ['$f(x)=(x+1)(x-2)$', 'f(x) = (x + 1)(x - 2)'],
  ]
  for (const [latex, typed] of lines) {
    it(latex, () => {
      expect(only(latex).typed).toBe(typed)
    })
  }

  it('reports the original variable and plots in x', () => {
    const d = only('g(t)=e^{4t^{3}-t}')
    expect(d.variable).toBe('t')
    expect(d.typed).not.toMatch(/t/)
  })

  it('a derivative given as data is named with a prime and plotted as y =', () => {
    const d = only("The derivative of $f$ is given by $f'(x)=3x^{2}-4$.")
    expect(d.kind).toBe('derivative')
    expect(d.name).toBe('f′')
    expect(d.typed).toBe('y = 3x^2 - 4')
  })

  it('records free constants as sliders', () => {
    const d = only('$\\frac{dy}{dt}=ky$')
    expect(d.typed).toBe('dy/dx = k*y')
    expect(d.params).toEqual(['k'])
    const e = only('$f(x)=a\\sin(bx)$')
    expect(e.params).toEqual(['a', 'b'])
  })
})

describe('importFromLatex — the cases environment', () => {
  it('translates a three-piece cases with \\text{if} and otherwise', () => {
    const d = only('$f(x)=\\begin{cases} 3 & \\text{if } x \\le -1 \\\\ x^2 & \\text{if } -1 < x < 2 \\\\ 2x & \\text{otherwise}\\end{cases}$')
    expect(d.typed).toBe('f(x) = { 3 if x <= -1 ; x^2 if -1 < x < 2 ; 2x otherwise }')
    expectSame(d.typed, 'y = { 3 if x <= -1 ; x^2 if -1 < x < 2 ; 2x if x >= 2 }')
  })

  it("reads Mathpix's \\left\\{\\begin{array}…\\end{array}\\right. spelling", () => {
    const d = only('$f(x)=\\left\\{\\begin{array}{ll}x^{2}, & x<1 \\\\ 2 x-1, & x \\geq 1\\end{array}\\right.$')
    expect(d.typed).toBe('f(x) = { x^2 if x < 1 ; 2x - 1 if x >= 1 }')
  })

  it('keeps a single-point piece (x = 2) and a ≠ condition', () => {
    const d = only('$f(x)=\\left\\{\\begin{array}{ll}\\frac{x^{2}-4}{x-2}, & \\text { if } x \\neq 2 \\\\ 1, & \\text { if } x=2\\end{array}\\right.$')
    expect(d.typed).toBe('f(x) = { (x^2 - 4)/(x - 2) if x != 2 ; 1 if x = 2 }')
    const f = evaluator(d.typed)
    expect(f(2)).toBe(1)
    expect(f(3)).toBeCloseTo(5, 12)
  })

  it('reads x \\in [a, b) as a chain', () => {
    const d = only('$g(x)=\\begin{cases} x^2 & x \\in [0, 1) \\\\ 1 & x\\ge 1\\end{cases}$')
    expect(d.typed).toBe('g(x) = { x^2 if 0 <= x < 1 ; 1 if x >= 1 }')
  })

  it('reads "or" between conditions', () => {
    const d = only('$f(x)=\\begin{cases} x^2 & x<-1 \\text{ or } x>1 \\\\ 0 & \\text{otherwise}\\end{cases}$')
    expect(d.typed).toBe('f(x) = { x^2 if x < -1 or x > 1 ; 0 otherwise }')
    expectSame(d.typed, 'y = { x^2 if x < -1 ; x^2 if x > 1 ; 0 if -1 <= x <= 1 }')
  })

  it('a step function with a jump evaluates piece by piece', () => {
    const d = only('$h(t)=\\begin{cases} 2t+1, & t<0 \\\\ 3-t^{2}, & t\\ge 0\\end{cases}$')
    expect(d.variable).toBe('t')
    expect(d.typed).toBe('h(x) = { 2x + 1 if x < 0 ; 3 - x^2 if x >= 0 }')
    expectSame(d.typed, 'y = { 2x + 1 if x < 0 ; 3 - x^2 if x >= 0 }')
  })
})

describe('importFromLatex — Mathpix noise', () => {
  it('spaced letters and \\left / \\right', () => {
    const d = only('$f(x)=\\left( 3 x^{2} - 2 x \\right) e^{ - x }$')
    expectSame(d.typed, 'y = (3x^2 - 2x)*exp(-x)')
  })

  it('\\mathrm{d} and \\mathrm{~d} in a derivative', () => {
    const d = only('$\\frac{\\mathrm{d} y}{\\mathrm{~d} x}=x^{2}-y$')
    expect(d.typed).toBe('dy/dx = x^2 - y')
  })

  it('d y / d x spelled with spaces', () => {
    expect(only('$\\frac{d y}{d x} = 2 x y$').typed).toBe('dy/dx = 2x*y')
  })

  it('function names without a backslash', () => {
    const d = only('$y = sin x + cos 2x$')
    expectSame(d.typed, 'y = sin(x) + cos(2x)')
  })

  it('\\operatorname{} and \\mathrm{} function names', () => {
    const d = only('$f(x)=\\operatorname{sin}\\, x+\\mathrm{ln}(x)$')
    expectSame(d.typed, 'y = sin(x) + ln(x)')
  })

  it('spacing commands of every kind', () => {
    const d = only('$f(x)\\;=\\;x^{2}\\!+\\,3\\:x\\ +\\quad 1$')
    expectSame(d.typed, 'y = x^2 + 3x + 1')
  })

  it('Unicode minus, ≤ and π from a word processor', () => {
    const d = only('$f(x)=π x − 2$, for $0 ≤ x ≤ 4$')
    expectSame(d.typed, 'y = pi*x - 2 {0 <= x <= 4}')
    expect(d.domain).toEqual([0, 4])
  })

  it('^{\\prime} heads', () => {
    const d = only('$f^{\\prime}(x)=x^{2}-1$')
    expect(d.name).toBe('f′')
  })

  it('x^23 means x²·3, the way LaTeX reads it', () => {
    expect(latexToTyped('x^23')).toEqual({ ok: true, text: 'x^2*3' })
  })

  it('\\cdot and \\times are multiplication', () => {
    expectSame(only('$f(x)=2\\cdot x\\times 3$').typed, 'y = 6x')
  })
})

describe('importFromLatex — domain hints', () => {
  it('"for $0\\le t\\le 8$" after the definition (with units in between)', () => {
    const d = only('Water flows into a tank at a rate modeled by $R(t)=20\\sin\\!\\left(\\tfrac{t}{4}\\right)$ cubic feet per hour for $0\\le t\\le 8$. Find the total volume.')
    expect(d.typed).toBe('R(x) = 20sin(x/4) {0 <= x <= 8}')
    expect(d.domain).toEqual([0, 8])
    expect(d.restriction).toBe('0 <= x <= 8')
    const o = parseExpression(d.typed)
    expect(o.ok && o.plot.domain).toEqual([0, 8])
  })

  it('"on the closed interval $[-3, 4]$"', () => {
    const d = only('Let $f$ be the function given by $f(x)=x^{3}-3x$ on the closed interval $[-3, 4]$.')
    expect(d.typed).toBe('f(x) = x^3 - 3x {-3 <= x <= 4}')
    expect(d.domain).toEqual([-3, 4])
  })

  it('an inline restriction after a comma or \\quad', () => {
    expect(only('$f(x)=\\sqrt{x}\\,,\\quad x\\ge 0$').typed).toBe('f(x) = sqrt(x) {x >= 0}')
    expect(only('$f(x)=x^2, 0\\le x\\le 4$').typed).toBe('f(x) = x^2 {0 <= x <= 4}')
    expect(only('$f(x)=x^2 \\text{ for } 0 < x < 2\\pi$').typed).toBe('f(x) = x^2 {0 < x < 2pi}')
  })

  it('an open interval with π ends', () => {
    const d = only('$g(x)=\\tan x$ on the interval $\\left(-\\frac{\\pi}{2}, \\frac{\\pi}{2}\\right)$')
    expect(d.typed).toBe('g(x) = tan(x) {-pi/2 < x < pi/2}')
    expect(d.domain![0]).toBeCloseTo(-Math.PI / 2, 12)
    expect(d.domain![1]).toBeCloseTo(Math.PI / 2, 12)
  })

  it('a one-sided hint', () => {
    const d = only('Let $f(x)=\\ln x$ for $x>0$.')
    expect(d.typed).toBe('f(x) = ln(x) {x > 0}')
    expect(d.domain).toBeUndefined()
  })

  it('a hint about another letter is not a restriction', () => {
    const d = only('Let $f(x)=kx^{2}$ for $k>0$.')
    expect(d.typed).toBe('f(x) = k*x^2')
  })

  it('a hint in the next sentence is not a restriction', () => {
    const d = only('Let $f(x)=x^{2}$. For $x>3$, find $f(x)$.')
    expect(d.typed).toBe('f(x) = x^2')
  })
})

describe('importFromLatex — figure hints', () => {
  it("\"The graph of $f'$ is shown\" → graphOf f′", () => {
    const r = importFromLatex("The graph of $f'$ is shown above. On which interval is $f$ both increasing and concave down?")
    expect(r.hints).toEqual({ graphOf: "f'", name: 'f', figure: true })
    expect(r.definitions).toEqual([])
    expect(r.warnings).toEqual([])
  })

  it('reads ^{\\prime} and the interval of the figure', () => {
    const r = importFromLatex('The graph of $f^{\\prime}$, the derivative of $f$, is shown above for $-3 \\leq x \\leq 4$.')
    expect(r.hints.graphOf).toBe("f'")
    expect(r.hints.interval).toEqual([-3, 4])
  })

  it('second derivative, by primes or in words', () => {
    expect(importFromLatex("The graph of $y=g''(x)$ is shown.").hints).toMatchObject({ graphOf: "f''", name: 'g' })
    expect(importFromLatex('The graph of the second derivative of $h$ is shown.').hints).toMatchObject({ graphOf: "f''", name: 'h' })
    expect(importFromLatex('The graph of the derivative of $f$ is shown.').hints.graphOf).toBe("f'")
  })

  it('the graph of f itself', () => {
    const r = importFromLatex('The graph of the function $f$ is shown on the interval $[0, 6]$.')
    expect(r.hints).toEqual({ graphOf: 'f', name: 'f', figure: true, interval: [0, 6] })
  })

  it('no figure', () => {
    expect(importFromLatex('Let $f(x)=x^2$.').hints).toEqual({ graphOf: 'f', figure: false })
  })

  it('a π interval', () => {
    const r = importFromLatex('The graph of $f\'$ on the interval $\\left[-2, \\frac{\\pi}{2}\\right]$ is shown.')
    expect(r.hints.interval![0]).toBe(-2)
    expect(r.hints.interval![1]).toBeCloseTo(Math.PI / 2, 12)
  })
})

describe('importFromLatex — whole records', () => {
  const RECORD = `%%% ITEM AB-0042
%%% status=captured secure=true
%%% figure=none
%%% answer=A
\\begin{stem}
Let $f(x)=\\sin(3x^{2}+1)$. What is $f'(x)$?
\\end{stem}
\\begin{choices}
\\choice $6x\\cos(3x^{2}+1)$
\\choice $f(x)=\\cos(3x^{2}+1)$
\\end{choices}
%%% END`

  it('reads the stem only — never the choices', () => {
    const r = importFromLatex(RECORD)
    expect(r.definitions.map((d) => d.typed)).toEqual(['f(x) = sin(3x^2 + 1)'])
    expect(r.warnings).toEqual([])
  })

  it('several definitions in one stem, and a later one using an earlier one', () => {
    const r = importFromLatex('Let $f(x)=x^{2}$ and $g(x)=f(2x)+1$. Let $h(x)=\\sqrt{x}$, $k(x)=3x$.')
    expect(r.definitions.map((d) => d.name)).toEqual(['f', 'g', 'h', 'k'])
    expectSame(r.definitions[1].typed, 'y = 4x^2 + 1')
  })

  it('x(t) and y(t) together are one parametric curve', () => {
    const r = importFromLatex('A particle moves with $x(t)=\\cos t$ and $y(t)=\\sin(2t)$.')
    expect(r.definitions).toHaveLength(1)
    expect(r.definitions[0].kind).toBe('parametric')
    expect(r.definitions[0].typed).toBe('(x, y) = (cos(t), sin(2t))')
    expect(parseExpression(r.definitions[0].typed).ok).toBe(true)
  })

  it('values and references are not definitions', () => {
    const r = importFromLatex("Given $f(2)=5$, $f'(2)=-1$, and the graph of $y=f'(x)$, find $\\lim_{x \\to 2} f(x)$.")
    expect(r.definitions).toEqual([])
    expect(r.warnings).toEqual([])
  })

  it('accepts \\( \\), \\[ \\] and equation environments', () => {
    const r = importFromLatex('Let \\(f(x)=x+1\\). \\[g(x)=2x\\] \\begin{equation} h(x)=x^3 \\end{equation}')
    expect(r.definitions.map((d) => d.typed)).toEqual(['f(x) = x + 1', 'g(x) = 2x', 'h(x) = x^3'])
  })
})

describe('importFromLatex — warnings', () => {
  it('reports an integral-defined function with its LaTeX', () => {
    const r = importFromLatex('Let $F(x)=\\int_{0}^{x}\\sin t\\,dt$.')
    expect(r.definitions).toEqual([])
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toContain('F(x)=\\int_{0}^{x}\\sin t\\,dt')
    expect(r.warnings[0]).toMatch(/integral/)
  })

  it('reports an unsupported Greek letter', () => {
    const r = importFromLatex('$f(x)=\\lambda e^{-\\lambda x}$')
    expect(r.definitions).toEqual([])
    expect(r.warnings[0]).toMatch(/\\lambda/)
  })

  it('reports a call of a function the item does not define', () => {
    const r = importFromLatex('$g(x)=f(x)+2$')
    expect(r.definitions).toEqual([])
    expect(r.warnings[0]).toMatch(/calls f/)
  })

  it('reports a half parametric pair', () => {
    const r = importFromLatex('$x(t)=t^{2}$')
    expect(r.definitions).toEqual([])
    expect(r.warnings[0]).toMatch(/both x\(t\) and y\(t\)/)
  })

  it('keeps going after a failure', () => {
    const r = importFromLatex('$f(x)=\\sum_{n=0}^{\\infty} x^n$ and $g(x)=x^2$')
    expect(r.definitions.map((d) => d.typed)).toEqual(['g(x) = x^2'])
    expect(r.warnings).toHaveLength(1)
  })

  it('never throws on junk', () => {
    for (const junk of ['', '$$', '$f(x)=$', '\\frac{', '$y=\\frac{1}{$', '}}}{{{', '$x=$', '$f(x)=\\begin{cases}$']) {
      expect(() => importFromLatex(junk)).not.toThrow()
    }
  })
})

// ============================================================================
// tests/parse.test.ts — the expression engine (src/core/parse).
// Tokenizer, Pratt parser, classifier, closure-compiled evaluator, LaTeX.
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { ParsedPlot } from '../src/core/types'
import { parseExpression } from '../src/core/parse'
import { makeRng } from './helpers'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function plot(src: string): ParsedPlot {
  const r = parseExpression(src)
  if (!r.ok) throw new Error(`expected "${src}" to parse, got: ${r.error}`)
  return r.plot
}

function err(src: string): { error: string; pos?: number } {
  const r = parseExpression(src)
  if (r.ok) throw new Error(`expected "${src}" to fail, but it parsed as ${r.plot.latex}`)
  return { error: r.error, pos: r.pos }
}

/** Evaluate an explicit expression at x (free constants take their defaults). */
function f(src: string, x: number, params?: number[]): number {
  const p = plot(src)
  expect(p.kind).toBe('explicit')
  const spec = p.makeModel('t')
  return spec.evalExplicit!(params ?? p.defaultParams, x)
}

const SAMPLE_XS = (() => {
  const rng = makeRng(7)
  const xs: number[] = []
  for (let i = 0; i < 40; i++) xs.push(-5 + 10 * rng())
  return xs
})()

// ---------------------------------------------------------------------------

describe('parse — implicit multiplication', () => {
  it('number juxtaposed with a variable', () => {
    expect(f('2x', 3)).toBe(6)
    expect(f('2x', -1.5)).toBe(-3)
  })

  it('adjacent parenthesized groups', () => {
    expect(f('(x+1)(x-2)', 2)).toBe(0)
    expect(f('(x+1)(x-2)', 4)).toBe(10)
    expect(f('2(x+1)', 2)).toBe(6)
  })

  it('adjacent function calls', () => {
    for (const x of SAMPLE_XS) {
      expect(f('sin(x)cos(x)', x)).toBeCloseTo(Math.sin(x) * Math.cos(x), 12)
    }
  })

  it('number juxtaposed with a constant', () => {
    expect(f('2pi', 0)).toBeCloseTo(2 * Math.PI, 12)
    expect(f('2e', 0)).toBeCloseTo(2 * Math.E, 12)
    expect(f('2tau', 0)).toBeCloseTo(4 * Math.PI, 12)
  })

  it('variable juxtaposed with a bar-expression and with another variable', () => {
    expect(f('2|x|', -3)).toBe(6)
    expect(f('x|x|', -3)).toBe(-9)
  })

  it('unicode operators and greek aliases', () => {
    expect(f('2·x', 4)).toBe(8)
    expect(f('6÷x', 3)).toBe(2)
    expect(f('2−x', 5)).toBe(-3)
    expect(f('2π', 0)).toBeCloseTo(2 * Math.PI, 12)
    const p = plot('r = 1 + cos(θ)')
    expect(p.kind).toBe('polar')
  })
})

describe('parse — paren-less function application', () => {
  it('binds a full product: sin 2x === sin(2x)', () => {
    for (const x of SAMPLE_XS) {
      expect(f('sin 2x', x)).toBeCloseTo(Math.sin(2 * x), 12)
    }
  })

  it('stops at + and -: sin x + 1 === sin(x) + 1', () => {
    for (const x of SAMPLE_XS) {
      expect(f('sin x + 1', x)).toBeCloseTo(Math.sin(x) + 1, 12)
      expect(f('cos x - 2', x)).toBeCloseTo(Math.cos(x) - 2, 12)
    }
  })

  it('binds tighter than a following power: sin x^2 === sin(x^2)', () => {
    for (const x of SAMPLE_XS) {
      expect(f('sin x^2', x)).toBeCloseTo(Math.sin(x * x), 12)
    }
  })

  it('a paren-less unary function still needs an argument', () => {
    expect(err('sin').error).toMatch(/needs an argument/)
    expect(err('2 + sin').error).toMatch(/needs an argument/)
  })

  it('two-argument functions require parentheses', () => {
    expect(err('min x').error).toMatch(/needs parentheses/)
    expect(err('min(x)').error).toMatch(/two arguments/)
    expect(err('sin(x, 2)').error).toMatch(/one argument/)
  })
})

describe('parse — precedence and associativity', () => {
  it('^ is right-associative: 2^3^2 === 512', () => {
    expect(f('2^3^2', 0)).toBe(512)
    expect(f('2**3**2', 0)).toBe(512)
  })

  it('unary minus binds looser than ^: -x^2 is negative', () => {
    expect(f('-x^2', 3)).toBe(-9)
    expect(f('-x^2', -3)).toBe(-9)
    expect(f('-2^2', 0)).toBe(-4)
    expect(f('(-x)^2', 3)).toBe(9)
  })

  it('* and / bind tighter than + and -, left to right', () => {
    expect(f('1 + 2*3', 0)).toBe(7)
    expect(f('12/3/2', 0)).toBe(2)
    expect(f('10 - 3 - 2', 0)).toBe(5)
    expect(f('2*x^2', 3)).toBe(18)
  })

  it('implicit multiplication has the same binding power as explicit *', () => {
    for (const x of SAMPLE_XS) {
      expect(f('2x^2', x)).toBeCloseTo(2 * x * x, 12)
      expect(f('2*x^2', x)).toBeCloseTo(2 * x * x, 12)
    }
  })

  it('negative exponents parse', () => {
    expect(f('2^-1', 0)).toBe(0.5)
    expect(f('x^-2', 2)).toBe(0.25)
  })
})

describe('parse — classification', () => {
  const cases: Array<[string, string]> = [
    ['y = 2sin(3x) + 1', 'explicit'],
    ['2x + 1', 'explicit'],
    ['sin(x)/x', 'explicit'],
    ['3', 'explicit'],
    ['2x = y', 'explicit'],
    ['r = 1 + cos(theta)', 'polar'],
    ['r = 2', 'polar'],
    ['1 + cos(theta)', 'polar'],
    ['3cos(2theta) = r', 'polar'],
    ['x^2 + y^2 = 4', 'implicit'],
    ['x*y = 1', 'implicit'],
    ['x = 2', 'implicit'],
    ['x^2 + y^2 - 4', 'implicit'],
    ['y^2 = x', 'implicit'],
  ]
  for (const [src, kind] of cases) {
    it(`${JSON.stringify(src)} -> ${kind}`, () => {
      expect(plot(src).kind).toBe(kind)
    })
  }

  it('polar plots carry a full-turn default domain', () => {
    expect(plot('r = 1 + cos(theta)').domain).toEqual([0, 2 * Math.PI])
  })

  it('mixing polar and cartesian variables is rejected', () => {
    expect(err('r = x + theta').error).toMatch(/Cannot mix/)
    expect(err('r = t').error).toMatch(/Cannot mix/)
  })

  it('mixing x and t is rejected', () => {
    expect(err('x + t').error).toMatch(/Cannot mix/)
  })

  it('an equation with no plottable variable is rejected', () => {
    expect(err('2 = 3').error).toMatch(/no variables to plot/)
  })

  it('a malformed polar equation is rejected', () => {
    expect(err('r + theta = r').error).toMatch(/Polar equations must have the form/)
  })
})

describe('parse — free-constant discovery', () => {
  it('discovers constants in order of first appearance', () => {
    const p = plot('a sin(b x + c) + d')
    expect(p.paramNames).toEqual(['a', 'b', 'c', 'd'])
    expect(p.defaultParams).toEqual([1, 1, 1, 1])
  })

  it('deduplicates repeated constants', () => {
    const p = plot('a x^2 + a x + b')
    expect(p.paramNames).toEqual(['a', 'b'])
    expect(p.defaultParams).toHaveLength(2)
  })

  it('orders by appearance, not alphabetically', () => {
    expect(plot('k x + a').paramNames).toEqual(['k', 'a'])
    expect(plot('d + a').paramNames).toEqual(['d', 'a'])
  })

  it('e, pi and tau stay constants — never free parameters', () => {
    expect(plot('e^x').paramNames).toEqual([])
    expect(plot('a e^(b x)').paramNames).toEqual(['a', 'b'])
    expect(plot('pi x + tau').paramNames).toEqual([])
    expect(f('e', 0)).toBeCloseTo(Math.E, 12)
    expect(f('e^x', 1)).toBeCloseTo(Math.E, 12)
  })

  it('x, y, r, theta and t are variables, never parameters', () => {
    expect(plot('x + y').paramNames).toEqual([])
    expect(plot('r = theta').paramNames).toEqual([])
  })

  it('parameters drive the compiled evaluator', () => {
    const p = plot('a sin(b x + c) + d')
    const spec = p.makeModel('m')
    const params = [2, 3, 0.5, -1]
    for (const x of SAMPLE_XS) {
      expect(spec.evalExplicit!(params, x)).toBeCloseTo(2 * Math.sin(3 * x + 0.5) - 1, 12)
    }
  })

  it('paramMeta returns one usable entry per free constant', () => {
    const p = plot('a x^2 + b x + c')
    const metas = p.makeModel('m').paramMeta([2, -3, 0.5])
    expect(metas.map(m => m.name)).toEqual(['a', 'b', 'c'])
    for (const m of metas) {
      expect(m.min).toBeLessThan(m.max)
      expect(m.step).toBeGreaterThan(0)
      expect(Number.isFinite(m.min) && Number.isFinite(m.max)).toBe(true)
    }
  })
})

describe('parse — evaluator correctness against Math.*', () => {
  const unary: Array<[string, (x: number) => number, number, number]> = [
    ['sin(x)', Math.sin, -5, 5],
    ['cos(x)', Math.cos, -5, 5],
    ['tan(x)', Math.tan, -1.2, 1.2],
    ['asin(x)', Math.asin, -0.99, 0.99],
    ['acos(x)', Math.acos, -0.99, 0.99],
    ['atan(x)', Math.atan, -5, 5],
    ['sinh(x)', Math.sinh, -3, 3],
    ['cosh(x)', Math.cosh, -3, 3],
    ['tanh(x)', Math.tanh, -3, 3],
    ['sqrt(x)', Math.sqrt, 0.01, 9],
    ['cbrt(x)', Math.cbrt, -9, 9],
    ['abs(x)', Math.abs, -5, 5],
    ['ln(x)', Math.log, 0.05, 9],
    ['log(x)', Math.log10, 0.05, 9],
    ['log2(x)', Math.log2, 0.05, 9],
    ['exp(x)', Math.exp, -3, 3],
    ['floor(x)', Math.floor, -5, 5],
    ['ceil(x)', Math.ceil, -5, 5],
    ['sign(x)', Math.sign, -5, 5],
  ]
  for (const [src, ref, lo, hi] of unary) {
    it(`${src} matches Math.* over [${lo}, ${hi}]`, () => {
      const rng = makeRng(src.length * 31 + 5)
      for (let i = 0; i < 25; i++) {
        const x = lo + (hi - lo) * rng()
        expect(f(src, x)).toBeCloseTo(ref(x), 10)
      }
    })
  }

  it('min and max match Math.min / Math.max', () => {
    const rng = makeRng(99)
    for (let i = 0; i < 25; i++) {
      const x = -5 + 10 * rng()
      expect(f('min(x, 2)', x)).toBe(Math.min(x, 2))
      expect(f('max(x, -1)', x)).toBe(Math.max(x, -1))
    }
  })

  it('the |...| absolute-value form matches abs()', () => {
    for (const x of SAMPLE_XS) {
      expect(f('|x - 1|', x)).toBeCloseTo(Math.abs(x - 1), 12)
      expect(f('|sin(x)|', x)).toBeCloseTo(Math.abs(Math.sin(x)), 12)
    }
  })

  it('sin^2 + cos^2 === 1 for every sampled x', () => {
    for (const x of SAMPLE_XS) {
      expect(f('sin(x)^2 + cos(x)^2', x)).toBeCloseTo(1, 12)
    }
  })

  it('special-cased integer powers agree with Math.pow', () => {
    for (const x of SAMPLE_XS) {
      expect(f('x^2', x)).toBeCloseTo(Math.pow(x, 2), 10)
      expect(f('x^3', x)).toBeCloseTo(Math.pow(x, 3), 10)
      expect(f('(x*x)^0.5', x)).toBeCloseTo(Math.abs(x), 10)
      expect(f('x^4', x)).toBeCloseTo(Math.pow(x, 4), 10)
    }
  })

  it('scientific-notation literals evaluate', () => {
    expect(f('1e3', 0)).toBe(1000)
    expect(f('1.5e-2 x', 2)).toBeCloseTo(0.03, 12)
    expect(f('.5x', 4)).toBe(2)
  })

  it('implicit evaluators receive both x and y', () => {
    const spec = plot('x^2 + y^2 = 4').makeModel('m')
    expect(spec.evalImplicit!([], 2, 0)).toBeCloseTo(0, 12)
    expect(spec.evalImplicit!([], 0, 2)).toBeCloseTo(0, 12)
    expect(spec.evalImplicit!([], 3, 4)).toBeCloseTo(21, 12)
  })

  it('polar evaluators receive theta', () => {
    const spec = plot('r = 1 + cos(theta)').makeModel('m')
    for (const t of [0, 0.7, Math.PI, 4.2]) {
      expect(spec.evalPolar!([], t)).toBeCloseTo(1 + Math.cos(t), 12)
    }
  })
})

describe('parse — error reporting', () => {
  it('empty input', () => {
    expect(err('').error).toBe('Empty expression')
    expect(err('   ').error).toBe('Empty expression')
  })

  it('unknown function suggests the nearest known name', () => {
    expect(err('sim(x)').error).toMatch(/did you mean 'sin'\?/)
    expect(err('sqr(x)').error).toMatch(/did you mean 'sqrt'\?/)
    expect(err('cso(x)').error).toMatch(/Unknown/)
    expect(err('SIN(x)').error).toMatch(/did you mean 'sin'\?/)
  })

  it('an unknown multi-letter name explains the single-letter rule', () => {
    const e = err('foo(x)')
    expect(e.error).toMatch(/multi-letter names aren't supported/)
    expect(e.pos).toBe(0)
  })

  it('unexpected token and unexpected end of input are distinguished', () => {
    expect(err('x + ').error).toMatch(/Unexpected end of input/)
    expect(err('sin()').error).toMatch(/Unexpected '\)'/)
    expect(err('x + * 2').error).toMatch(/Unexpected '\*'/)
    expect(err('y =').error).toMatch(/Unexpected end of input/)
  })

  it('unbalanced delimiters are reported', () => {
    // at end-of-input the message names the missing token; mid-expression it
    // names both the expectation and what it actually found
    expect(err('(x + 1').error).toMatch(/end of input — '\)'/)
    expect(err('sin(x').error).toMatch(/end of input — '\)'/)
    expect(err('(x + 1]').error).toMatch(/Unexpected character/)
    expect(err('(x + 1 = 2)').error).toMatch(/Expected '\)' but found '='/)
    expect(err('|x').error).toMatch(/Missing closing '\|'/)
  })

  it('a second = is rejected with a specific message', () => {
    expect(err('x = y = 2').error).toMatch(/Only one '=' is allowed/)
  })

  it('an unexpected character reports its position', () => {
    const e = err('x @ 2')
    expect(e.error).toMatch(/Unexpected character '@'/)
    expect(e.pos).toBe(2)
  })

  it('errors carry a character position where one is known', () => {
    const e = err('2 + sim(x)')
    expect(e.pos).toBe(4)
  })

  it('parseExpression never throws — it always returns an outcome', () => {
    const nasty = ['', '((((', ')))', '^^^', '=', 'x^^2', '1e', '...', '|||', 'sin(sin(sin(', '@#$%']
    for (const s of nasty) {
      expect(() => parseExpression(s), s).not.toThrow()
      const r = parseExpression(s)
      if (!r.ok) expect(typeof r.error).toBe('string')
    }
  })
})

describe('parse — LaTeX generation', () => {
  const cases: Array<[string, string]> = [
    ['2x', 'y = 2x'],
    ['x^2', 'y = x^{2}'],
    ['-x^2', 'y = -x^{2}'],
    ['sin(x)', 'y = \\sin\\left(x\\right)'],
    ['sin 2x', 'y = \\sin\\left(2x\\right)'],
    ['(x+1)(x-2)', 'y = \\left(x+1\\right)\\left(x-2\\right)'],
    ['a sin(b x + c) + d', 'y = a\\sin\\left(b\\,x+c\\right)+d'],
    ['x/(x+1)', 'y = \\frac{x}{x+1}'],
    ['3/4', 'y = 3/4'],
    ['sqrt(x)', 'y = \\sqrt{x}'],
    ['cbrt(x)', 'y = \\sqrt[3]{x}'],
    ['|x|', 'y = \\left|x\\right|'],
    ['2pi', 'y = 2\\pi'],
    ['x^2 + y^2 = 4', 'x^{2}+y^{2} = 4'],
    ['r = 1 + cos(theta)', 'r = 1+\\cos\\left(\\theta\\right)'],
    ['1e3', 'y = 1\\cdot 10^{3}'],
    ['min(x, 2)', 'y = \\min\\left(x,\\,2\\right)'],
  ]
  for (const [src, tex] of cases) {
    it(`latex(${JSON.stringify(src)})`, () => {
      expect(plot(src).latex).toBe(tex)
    })
  }

  it('a thin space keeps adjacent letters apart (never glues into \\pix)', () => {
    expect(plot('pi x').latex).toBe('y = \\pi\\,x')
    expect(plot('a x').latex).toBe('y = a\\,x')
    expect(plot('2 3').latex).toBe('y = 2 \\cdot 3')
  })

  it('generated latex has balanced braces and no doubled signs', () => {
    for (const [src] of cases) {
      const tex = plot(src).latex
      let depth = 0
      for (let i = 0; i < tex.length; i++) {
        if (tex[i] === '{' && tex[i - 1] !== '\\') depth++
        if (tex[i] === '}' && tex[i - 1] !== '\\') depth--
        expect(depth, `${src}: unbalanced at ${i}`).toBeGreaterThanOrEqual(0)
      }
      expect(depth, `${src}: unbalanced braces in ${tex}`).toBe(0)
      expect(tex).not.toMatch(/\+\s*-/)
      expect(tex).not.toMatch(/1\\cdot(?![ ]?10)/)
      expect(tex.length).toBeGreaterThan(0)
    }
  })

  it('the model built from a parse reports the same latex regardless of params', () => {
    const p = plot('a x + b')
    const spec = p.makeModel('m')
    expect(spec.latex([1, 2])).toBe(p.latex)
    expect(spec.latex([7, -3])).toBe(p.latex)
    expect(spec.id).toBe('m')
    expect(spec.kind).toBe('explicit')
  })
})

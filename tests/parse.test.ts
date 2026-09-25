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
    ['1e3', 'y = 1000'],
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

describe('parse — log_B in any base', () => {
  it('evaluates as ln(u)/ln(B), exactly for bases 2 and 10', () => {
    expect(f('log_3(x)', 9)).toBeCloseTo(2, 14)
    expect(f('log_3(x)', 1 / 27)).toBeCloseTo(-3, 14)
    expect(f('log_(1/2)(x - 1)', 5)).toBeCloseTo(-2, 14)
    expect(f('log_10(x)', 1000)).toBe(3)
    expect(f('log_2(x)', 8)).toBe(3)
    expect(f('log_2.5(x)', 6.25)).toBeCloseTo(2, 14)
    expect(f('log_0.5(x)', 8)).toBeCloseTo(-3, 14)
    expect(f('log_(sqrt(2))(x)', 4)).toBeCloseTo(4, 12)
    expect(f('log_pi(x)', Math.PI ** 3)).toBeCloseTo(3, 12)
    for (const x of [0.6, 1, 2.7, 9]) {
      expect(f('log_e(x)', x)).toBe(Math.log(x))
      expect(f('log_(2, x)', x)).toBe(Math.log2(x))
      expect(f('2log_5(x - 1/2) + 4', x)).toBeCloseTo((2 * Math.log(x - 0.5)) / Math.log(5) + 4, 12)
    }
  })

  it('is undefined outside its domain and for a base that is not a base', () => {
    expect(f('log_3(x)', 0)).toBe(-Infinity)
    expect(f('log_3(x)', -1)).toBeNaN()
    expect(f('log_1(x)', 5)).toBeNaN()
    expect(f('log_0(x)', 5)).toBeNaN()
    expect(f('log_(-2)(x)', 5)).toBeNaN()
    expect(f('log_(1/2 + 1/2)(x)', 5)).toBeNaN()
  })

  it('a paren-less argument binds a full product and stops at + / −, like ln x', () => {
    expect(f('log_2 x + 1', 8)).toBe(4)
    expect(f('log_2 2x', 4)).toBe(3)
    // the digits after _ are the whole base: log_2x is log₂(x), never log(2x)
    expect(f('log_2x', 8)).toBe(3)
    expect(plot('log_2x').latex).toBe(plot('log_2(x)').latex)
    expect(f('log_b x', 8)).toBe(3)
    expect(f('ln x + 1', 1)).toBe(1) // (and ln is unchanged)
  })

  it('a single-letter base is a slider that starts at 2, not at 1', () => {
    const p = plot('a log_b(x)')
    expect(p.paramNames).toEqual(['a', 'b'])
    expect(p.defaultParams).toEqual([1, 2])
    expect(f('a log_b(x)', 8)).toBe(3)
    expect(f('a log_b(x)', 9, [2, 3])).toBeCloseTo(4, 12)
    expect(plot('log_(b)(x)').defaultParams).toEqual([2])
    // only a BARE letter is a base slider: (2b) is an ordinary constant
    expect(plot('log_(2b)(x)').defaultParams).toEqual([1])
    expect(plot('f(x) = log_b(x) + c').defaultParams).toEqual([2, 1])
    expect(plot('y = { log_b(x) if x > 0 ; 0 otherwise }').defaultParams).toEqual([2])
    expect(plot('y = log_b(x) {x > 1}').defaultParams).toEqual([2])
    // the slider range is built around the value it starts at
    const meta = p.makeModel('m').paramMeta([1, 2])
    expect(meta[1].min).toBeLessThan(2)
    expect(meta[1].max).toBeGreaterThan(2)
  })

  const tex: Array<[string, string]> = [
    ['log_3(x)', 'y = \\log_{3}\\left(x\\right)'],
    ['log_(1/2)(x - 1)', 'y = \\log_{\\frac{1}{2}}\\left(x-1\\right)'],
    ['log_10(x)', 'y = \\log_{10}\\left(x\\right)'],
    ['log_2.5(x)', 'y = \\log_{2.5}\\left(x\\right)'],
    ['log_(sqrt(2))(x)', 'y = \\log_{\\sqrt{2}}\\left(x\\right)'],
    ['log_b(x)', 'y = \\log_{b}\\left(x\\right)'],
    ['log_pi(x)', 'y = \\log_{\\pi}\\left(x\\right)'],
    ['log_e(x)', 'y = \\ln\\left(x\\right)'],
    ['2log_3(x - 1) + 4', 'y = 2\\log_{3}\\left(x-1\\right)+4'],
    ['-log_(1/2)(2(x + 3))', 'y = -\\log_{\\frac{1}{2}}\\left(2\\left(x+3\\right)\\right)'],
    ['log_2 x + 1', 'y = \\log_{2}\\left(x\\right)+1'],
    ['f(x) = log_3(x)', 'f\\left(x\\right) = \\log_{3}\\left(x\\right)'],
  ]
  for (const [src, want] of tex) {
    it(`latex(${JSON.stringify(src)})`, () => {
      expect(plot(src).latex).toBe(want)
    })
  }

  it('the base must not depend on the variable — a positioned error', () => {
    const e1 = err('log_(x)(2)')
    expect(e1.error).toMatch(/^The base of a logarithm must be a number/)
    expect(e1.pos).toBe(4)
    const e2 = err('y = log_x(2)')
    expect(e2.error).toMatch(/^The base of a logarithm must be a number/)
    expect(e2.pos).toBe(8)
    expect(err('log_(x + 1)(3)').error).toMatch(/must be a number/)
    expect(err('f(t) = log_t(3)').error).toMatch(/cannot depend on t/)
    expect(err('r = log_theta(2)').error).toMatch(/cannot depend on θ/)
  })

  it('a missing base or argument is an error, never a guess', () => {
    const bare = err('log_')
    expect(bare.error).toMatch(/needs a base/)
    expect(bare.pos).toBe(0)
    expect(err('log_ + 1').error).toMatch(/needs a base/)
    expect(err('y = log_(x')).toBeTruthy()
    expect(err('log_3').error).toMatch(/needs an argument/)
    expect(err('log_3 * 2').error).toMatch(/needs an argument/)
    // a sign may start a paren-less argument, exactly as for ln: log_3 -x
    expect(plot('log_3 -x').latex).toBe('y = \\log_{3}\\left(-x\\right)')
    expect(plot('ln -x').latex).toBe('y = \\ln\\left(-x\\right)')
    expect(err('log_-2(x)').error).toMatch(/positive number/)
    expect(err('log_sqrt(2)(x)').error).toMatch(/parentheses, e\.g\. log_\(sqrt\(2\)\)\(x\)/)
    expect(err('log_ab(x)').error).toMatch(/parentheses/)
    expect(err('log_3(x, 2)').error).toMatch(/one argument/)
    expect(err('log_{3}(x)').error).toMatch(/Unexpected character '\{'/)
  })

  it('leaves log, ln, log2 and log10 exactly as they were', () => {
    expect(f('log(x)', 1000)).toBe(3)
    expect(plot('log(x)').latex).toBe('y = \\log\\left(x\\right)')
    expect(plot('log2(x)').latex).toBe('y = \\log_{2}\\left(x\\right)')
    expect(plot('log10(x)').latex).toBe('y = \\log_{10}\\left(x\\right)')
    expect(plot('ln x').latex).toBe('y = \\ln\\left(x\\right)')
    expect(err('logg(x)').error).toMatch(/did you mean 'log'\?/)
    expect(err('x_2').error).toMatch(/Unexpected character '_'/)
    expect(err('ln_2(x)').error).toMatch(/Unexpected character '_'/)
  })
})

// ===========================================================================
// Regressions for the two P0 correctness bugs found in the parser audit.
// ===========================================================================

describe('function-definition notation (P0: f(x) = ... was plotted as f*x = ...)', () => {
  it('plots f(x) = x^2 as the explicit curve y = x^2', () => {
    const p = plot('f(x)=x^2')
    expect(p.kind).toBe('explicit')
    expect(p.paramNames).toEqual([]) // 'f' must NOT become a slider
    const m = p.makeModel('m')
    for (const x of [-3, -0.5, 0, 1.5, 4]) {
      expect(m.evalExplicit!([], x)).toBe(x * x)
    }
  })

  it('is identical to the equivalent y = form', () => {
    for (const [fn, y] of [['f(x) = x^2', 'y = x^2'], ['g(x) = 2x+1', 'y = 2x+1'],
                           ['h(x) = sin(x)/x', 'y = sin(x)/x']]) {
      const a = plot(fn), b = plot(y)
      expect(a.kind).toBe(b.kind)
      expect(a.paramNames).toEqual(b.paramNames)
      const ma = a.makeModel('a'), mb = b.makeModel('b')
      for (const x of [-2.5, -1, 0.5, 2, 3.5]) {
        expect(ma.evalExplicit!([], x)).toBe(mb.evalExplicit!([], x))
      }
    }
  })

  it('respects the bound variable', () => {
    const t = plot('f(t) = t^2')
    expect(t.kind).toBe('explicit')
    expect(t.makeModel('m').evalExplicit!([], 3)).toBe(9)
    // a theta body is still recognised as polar
    const th = plot('f(theta) = 1 + cos(theta)')
    expect(th.kind).toBe('polar')
    expect(th.makeModel('m').evalPolar!([], Math.PI / 3)).toBeCloseTo(1.5, 12)
  })

  it('keeps other free constants, densely indexed after dropping the head', () => {
    const p = plot('f(x) = a x^2 + b')
    expect(p.paramNames).toEqual(['a', 'b'])
    expect(p.defaultParams).toEqual([1, 1])
    expect(p.makeModel('m').evalExplicit!([2, 1], 3)).toBe(19) // 2*9 + 1
  })

  it('shows the definition back in the latex', () => {
    expect(plot('f(x)=x^2').latex).toBe('f\\left(x\\right) = x^{2}')
    expect(plot('g(t) = 2t').latex).toBe('g\\left(t\\right) = 2t')
  })

  it('does not steal legitimate slider expressions', () => {
    // y = f(x) means y = f*x with f a slider: the head rule is LHS-only.
    const a = plot('y = f(x)')
    expect(a.paramNames).toEqual(['f'])
    expect(a.makeModel('m').evalExplicit!([3], 4)).toBe(12)
    // the letter recurring on the right keeps the ambiguous case as a product
    const b = plot('a(x) = a + x')
    expect(b.kind).toBe('implicit')
    expect(b.paramNames).toEqual(['a'])
    // a non-variable argument is not a function definition
    expect(plot('a(x+1) = 3').paramNames).toEqual(['a'])
    // and neither is a head that is itself a product
    expect(plot('2f(x) = x').paramNames).toEqual(['f'])
  })
})

describe('latex round-trip (P0: "2e + 1" rendered as "2e+1", re-reading as 20)', () => {
  const cases: Array<[string, number, number]> = [
    // [source, x, expected f(x)]
    ['2e + 1', 0, 2 * Math.E + 1],
    ['3.5e + 12', 0, 3.5 * Math.E + 12],
    ['2e - 3.572', 0, 2 * Math.E - 3.572],
    ['1e - 7 + 2', 0, Math.E - 5],
    ['atan(7e - 7x)', 2, Math.atan(7 * Math.E - 14)],
  ]
  for (const [src, x, want] of cases) {
    it(`${src} keeps a separator before e`, () => {
      const p = plot(src)
      expect(p.makeModel('m').evalExplicit!([], x)).toBeCloseTo(want, 12)
      // the rendered form must not contain a digit immediately followed by 'e',
      // which our own tokenizer (and a reader) would take as an exponent
      expect(p.latex).not.toMatch(/[0-9]e/)
    })
  }

  it('renders scientific literals as plain decimals when readable', () => {
    expect(plot('1e3').latex).toBe('y = 1000')
    expect(plot('1.5e-2 x').latex).toBe('y = 0.015x')
    expect(plot('1e21').latex).toBe('y = 1\\cdot 10^{21}') // unwieldy: keep the power
  })
})

// ---------------------------------------------------------------------------
// Seeded source -> parse -> latex -> de-latex -> re-parse fuzz.
// Guards the whole LaTeX emitter against rendering a curve that reads back as
// a different one (the class "2e+1" belonged to).
// ---------------------------------------------------------------------------

describe('latex round-trip fuzz', () => {
  /** Render our KaTeX output back into Grapher input syntax. */
  function readGroup(s: string, i: number): [string, number] {
    let depth = 0
    for (let j = i; j < s.length; j++) {
      if (s[j] === '{') depth++
      else if (s[j] === '}' && --depth === 0) return [s.slice(i + 1, j), j + 1]
    }
    throw new Error(`unbalanced braces in ${s}`)
  }

  const NAME_MAP: Record<string, string> = { arcsin: 'asin', arccos: 'acos', arctan: 'atan' }

  function delatex(s: string): string {
    let out = ''
    let i = 0
    while (i < s.length) {
      if (s.startsWith('\\frac{', i)) {
        const [a, j] = readGroup(s, i + 5)
        const [b, k] = readGroup(s, j)
        out += `((${delatex(a)})/(${delatex(b)}))`; i = k; continue
      }
      if (s.startsWith('\\sqrt[3]{', i)) {
        const [a, j] = readGroup(s, i + 8); out += ` cbrt(${delatex(a)})`; i = j; continue
      }
      if (s.startsWith('\\sqrt{', i)) {
        const [a, j] = readGroup(s, i + 5); out += ` sqrt(${delatex(a)})`; i = j; continue
      }
      if (s.startsWith('\\operatorname{', i)) {
        const [a, j] = readGroup(s, i + 13); out += ` ${a}`; i = j; continue
      }
      if (s.startsWith('\\log_{2}', i)) { out += ' log2'; i += 8; continue }
      if (s.startsWith('\\log_{', i)) {
        const [b, j] = readGroup(s, i + 5); out += ` log_(${delatex(b)})`; i = j; continue
      }
      if (s.startsWith('\\left\\lfloor', i)) { out += ' floor('; i += 12; continue }
      if (s.startsWith('\\right\\rfloor', i)) { out += ')'; i += 13; continue }
      if (s.startsWith('\\left\\lceil', i)) { out += ' ceil('; i += 11; continue }
      if (s.startsWith('\\right\\rceil', i)) { out += ')'; i += 12; continue }
      // \left| .. \right| is a matched pair, so the nesting is recoverable
      if (s.startsWith('\\left|', i)) { out += ' abs('; i += 6; continue }
      if (s.startsWith('\\right|', i)) { out += ')'; i += 7; continue }
      if (s.startsWith('\\left(', i)) { out += '('; i += 6; continue }
      if (s.startsWith('\\right)', i)) { out += ')'; i += 7; continue }
      if (s.startsWith('\\cdot', i)) { out += ' * '; i += 5; continue }
      if (s.startsWith('\\,', i)) { out += ' '; i += 2; continue }
      if (s[i] === '^' && s[i + 1] === '{') {
        const [a, j] = readGroup(s, i + 1); out += `^(${delatex(a)})`; i = j; continue
      }
      if (s[i] === '\\') {
        const m = /^\\([a-zA-Z]+)/.exec(s.slice(i))
        if (!m) throw new Error(`stray backslash in ${s}`)
        out += ` ${NAME_MAP[m[1]] ?? m[1]} `; i += m[0].length; continue
      }
      out += s[i]; i++
    }
    return out
  }

  type Rng = () => number
  const pick = <T,>(r: Rng, xs: T[]): T => xs[Math.floor(r() * xs.length)]

  // floor/ceil/sign are excluded on purpose: they turn a sub-ulp difference
  // into a jump of 1, which makes the round-trip sensitive to floating-point
  // RE-ASSOCIATION (500*(4.76x) vs (500*4.76)x) rather than to the LaTeX. Their
  // rendering is covered by the explicit cases below.
  const UNARY = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh',
    'sqrt', 'cbrt', 'abs', 'ln', 'log', 'log2', 'exp']
  const PARAMS = ['a', 'b', 'c', 'k', 'w']
  /** Bases for log_B: literals, fractions, constants, a slider, log_e (= ln). */
  const LOG_BASES = ['2', '3', '10', '2.5', '0.5', '(1/2)', '(sqrt(2))', '(2/3)', 'b', 'e', 'pi', '(a)']

  function num(r: Rng): string {
    const roll = r()
    if (roll < 0.25) return String(Math.floor(r() * 10))
    if (roll < 0.5) return (r() * 10).toFixed(2)
    if (roll < 0.65) return `${Math.floor(r() * 9) + 1}e${r() < 0.5 ? '' : '-'}${Math.floor(r() * 3) + 1}`
    if (roll < 0.8) return pick(r, ['pi', 'e', 'tau'])
    return String(Math.floor(r() * 5) + 1)
  }

  // logB: also generate log_B(…) in any base. Off by default, so the seeds
  // below keep generating exactly the inputs they always have.
  function genExpr(r: Rng, vars: string[], depth: number, logB = false): string {
    if (depth <= 0) return r() < 0.45 ? pick(r, vars) : (r() < 0.75 ? num(r) : pick(r, PARAMS))
    const roll = r()
    const sub = (d = depth - 1) => genExpr(r, vars, d, logB)
    if (logB && roll >= 0.38 && roll < 0.52) {
      const base = pick(r, LOG_BASES)
      if (roll < 0.44) return `log_${base}(${sub()})`
      if (roll < 0.48) return `log_${base} ${sub(0)}`             // paren-less, as ln x
      return `${num(r)}log_${base}(${sub()})`
    }
    if (roll < 0.18) return `${sub()} ${pick(r, ['+', '-'])} ${sub()}`
    if (roll < 0.3) return `${sub()} ${pick(r, ['*', '/'])} ${sub()}`
    if (roll < 0.38) return `(${sub()})^${r() < 0.5 ? String(Math.floor(r() * 4)) : `(${sub(0)})`}`
    if (roll < 0.46) return `${pick(r, UNARY)}(${sub()})`
    if (roll < 0.52) return `${pick(r, UNARY)} ${sub(0)}`      // paren-less application
    if (roll < 0.58) return `${pick(r, ['min', 'max'])}(${sub()}, ${sub()})`
    if (roll < 0.64) return `|${sub()}|`
    if (roll < 0.7) return `-${sub()}`
    if (roll < 0.78) return `(${sub()})(${sub()})`             // juxtaposition
    if (roll < 0.86) return `${num(r)}${pick(r, vars)}`        // implicit multiplication
    if (roll < 0.92) return `(${sub()})`
    return `${sub()} ${pick(r, ['+', '-', '*'])} ${sub()}`
  }

  function genInput(r: Rng, logB = false): string {
    const roll = r()
    if (roll < 0.2) {
      const e = genExpr(r, ['theta'], 3, logB)
      return r() < 0.5 ? `r = ${e}` : e
    }
    if (roll < 0.35) return `${genExpr(r, ['x', 'y'], 3, logB)} = ${genExpr(r, ['x', 'y'], 2, logB)}`
    if (roll < 0.45) return `${pick(r, ['f', 'g', 'h'])}(x) = ${genExpr(r, ['x'], 3, logB)}`
    if (roll < 0.5) return `${pick(r, ['f', 'g'])}(t) = ${genExpr(r, ['t'], 3, logB)}`
    if (roll < 0.7) return `y = ${genExpr(r, ['x'], 3, logB)}`
    return genExpr(r, ['x'], 3, logB)
  }

  // Tolerance is deliberately loose. The bug class this guards against (a curve
  // rendering as a DIFFERENT curve, e.g. "2e+1" re-reading as 20) is wrong by
  // orders of magnitude, while an exact comparison would trip on floating-point
  // re-association: latex drops the mathematically redundant parens in
  // `500*(4.76x)`, so the re-parse computes `(500*4.76)*x` and lands one ulp
  // away. That is invisible in the app (nothing re-parses latex) but a step
  // function, or a periodic function of a huge argument, can amplify it into a
  // visible jump — which is why floor/ceil/sign are left out of the generator.
  const sameNum = (a: number, b: number): boolean =>
    (Number.isNaN(a) && Number.isNaN(b)) || a === b ||
    Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b))

  /** Returns a description of the first discrepancy, or null when it round-trips. */
  function roundTrip(src: string): string | null {
    const first = parseExpression(src)
    if (!first.ok) return null // only valid inputs are round-trip candidates
    const latex = first.plot.latex
    const round = delatex(latex)
    const second = parseExpression(round)
    const bad = (why: string) => `${src}\n  latex: ${latex}\n  round: ${round}\n  ${why}`
    if (!second.ok) return bad(`re-parse failed: ${second.error}`)
    const A = first.plot, B = second.plot
    if (A.kind !== B.kind) return bad(`kind ${A.kind} -> ${B.kind}`)
    if (A.paramNames.join(',') !== B.paramNames.join(',')) {
      return bad(`params [${A.paramNames}] -> [${B.paramNames}]`)
    }
    const ma = A.makeModel('a'), mb = B.makeModel('b')
    const params = A.paramNames.map((_, i) => 0.7 + i * 0.4)
    const probes = [-3.25, -1.5, -0.5, 0.25, 0.75, 1.5, 2.75, 4.5]
    for (const u of probes) {
      if (A.kind === 'explicit' || A.kind === 'polar') {
        const ea = A.kind === 'explicit' ? ma.evalExplicit! : ma.evalPolar!
        const eb = A.kind === 'explicit' ? mb.evalExplicit! : mb.evalPolar!
        if (!sameNum(ea(params, u), eb(params, u))) {
          return bad(`at ${u}: ${ea(params, u)} vs ${eb(params, u)}`)
        }
      } else {
        for (const v of probes) {
          if (!sameNum(ma.evalImplicit!(params, u, v), mb.evalImplicit!(params, u, v))) {
            return bad(`at (${u},${v}): ${ma.evalImplicit!(params, u, v)} vs ${mb.evalImplicit!(params, u, v)}`)
          }
        }
      }
    }
    return null
  }

  for (const seed of [1, 2, 3, 12345]) {
    it(`4000 generated inputs round-trip through latex (seed ${seed})`, () => {
      const rng = makeRng(seed)
      const bad: string[] = []
      for (let i = 0; i < 4000; i++) {
        const found = roundTrip(genInput(rng))
        if (found) bad.push(found)
      }
      expect(bad.slice(0, 5).join('\n---\n')).toBe('')
    })
  }

  for (const seed of [21, 22]) {
    it(`4000 generated inputs with log_B in any base round-trip through latex (seed ${seed})`, () => {
      const rng = makeRng(seed)
      const bad: string[] = []
      let parsed = 0
      let withLog = 0
      for (let i = 0; i < 4000; i++) {
        const src = genInput(rng, true)
        if (parseExpression(src).ok) {
          parsed++
          if (src.includes('log_')) withLog++
        }
        const found = roundTrip(src)
        if (found) bad.push(found)
      }
      expect(bad.slice(0, 5).join('\n---\n')).toBe('')
      // the generator really does exercise the new syntax
      expect(withLog).toBeGreaterThan(parsed / 5)
    })
  }

  it('round-trips the step functions and other fixed shapes', () => {
    const fixed = [
      'floor(x)', 'ceil(2x)', 'sign(x-1)', 'floor(x)+ceil(x)', 'sign(x) * floor(|x|)',
      '2e + 1', '3.5e + 12', 'atan(7e - 7x)', '1e3 x', '1.5e-2 x',
      'x^2 + y^2 = 4', 'r = 1 + cos(theta)', 'f(x) = a x^2 + b', 'y = f(x)',
      'min(x, 2)', 'max(sin x, 0)', '|x - 2| + 1', '|(-x)(abs 6)|', 'sqrt(x)/(x+1)',
      'a sin(b x + c) + d', 'log2(x+1)', 'cbrt(x)', 'x*y = 1', 'exp(-x^2)', '2^3^2',
      'log_3(x)', 'log_(1/2)(x - 1)', 'f(x) = log_b(a x)', 'log_2 x + 1', 'log_(sqrt(2))(x)',
      '2log_10(x) - 1', 'log_e(x)', 'log_(2, x)', 'r = log_3(theta)', '-log_(1/3)(2(x + 3)) - 1',
    ]
    const bad = fixed.map(roundTrip).filter(Boolean)
    expect(bad.join('\n---\n')).toBe('')
  })

  // -------------------------------------------------------------------------
  // Restricted domains and piecewise definitions go through the same wringer:
  // the equation card is the curve, and that claim is only worth anything if
  // the CONDITIONS survive the trip too.
  // -------------------------------------------------------------------------

  /** Our printed condition, read back into input syntax. */
  function deCondition(tex: string): string {
    let s = tex
      .split('\\text{otherwise}').join('otherwise')
      .split('\\leq').join('<=')
      .split('\\geq').join('>=')
      .split('\\neq').join('!=')
      .split('\\cup').join(' or ')
      .split('\\infty').join('inf')
      .split('\\theta').join('theta')
      .split('\\pi').join('pi')
      .split('\\tau').join('tau')
      .split('\\,').join(' ')
      .split('\\;').join(' ')
    // "x \in A" -> A on its own: interval notation is accepted as a condition.
    s = s.replace(/^[A-Za-z]+\s*\\in\s*/, '')
    s = s.split('\\{').join('{').split('\\}').join('}')
    if (/\\[a-zA-Z]/.test(s)) throw new Error(`unhandled latex in condition "${tex}"`)
    return s
  }

  /** A whole restricted / piecewise card, read back into input syntax. */
  function dePieced(latex: string): string {
    const cases = /^([\s\S]*?) = \\begin\{cases\} ([\s\S]*) \\end\{cases\}$/.exec(latex)
    if (cases) {
      const rows = cases[2].split(' \\\\ ').map((row) => {
        const k = row.indexOf('&')
        if (k < 0) throw new Error(`cases row without a condition: ${row}`)
        return `${delatex(row.slice(0, k))} if ${deCondition(row.slice(k + 1))}`
      })
      return `${delatex(cases[1])} = { ${rows.join(' ; ')} }`
    }
    const i = latex.indexOf(',\\ ') // the suffix separator, and only ours
    if (i < 0) return delatex(latex)
    return `${delatex(latex.slice(0, i))} {${deCondition(latex.slice(i + 3))}}`
  }

  const rel = (r: Rng): string => (r() < 0.5 ? '<=' : '<')

  function genRestricted(r: Rng, logB = false): string {
    const e = genExpr(r, ['x'], 3, logB)
    const lo = Math.floor(r() * 7) - 3
    const hi = lo + 1 + Math.floor(r() * 5)
    return pick(r, [
      `y = ${e} {${lo} ${rel(r)} x ${rel(r)} ${hi}}`,
      `y = ${e}, x >${r() < 0.5 ? '=' : ''} ${lo}`,
      `y = ${e} for x ${rel(r)} ${hi}`,
      `y = ${e} where x != ${lo}`,
      `y = ${e} {x < ${lo} or x > ${hi}}`,
      `y = ${e} {[${lo}, ${hi})}`,
      `f(x) = ${e} {${lo} ${rel(r)} x ${rel(r)} ${hi}}`,
    ])
  }

  function genPiecewise(r: Rng, logB = false): string {
    const n = 2 + Math.floor(r() * 2)
    const cuts: number[] = []
    let c = Math.floor(r() * 5) - 4
    for (let i = 0; i < n - 1; i++) { cuts.push(c); c += 1 + Math.floor(r() * 3) }
    const rows: string[] = []
    for (let i = 0; i < n; i++) {
      const body = genExpr(r, ['x'], 2, logB)
      if (i === 0) rows.push(`${body} if x ${rel(r)} ${cuts[0]}`)
      else if (i === n - 1) {
        rows.push(r() < 0.4 ? `${body} otherwise` : `${body} if x >${r() < 0.5 ? '=' : ''} ${cuts[i - 1]}`)
      } else rows.push(`${body} if ${cuts[i - 1]} <= x < ${cuts[i]}`)
    }
    const head = r() < 0.2 ? 'f(x)' : 'y'
    if (r() < 0.25) {
      // the piecewise(...) spelling, which prints the same table
      const args = rows.map((row) => {
        const k = row.lastIndexOf(' if ')
        return k < 0 ? row.replace(/ otherwise$/, '') : `${row.slice(0, k)}, ${row.slice(k + 4)}`
      })
      return `${head} = piecewise(${args.join(', ')})`
    }
    return `${head} = { ${rows.join(' ; ')} }`
  }

  const PROBES = [-4.25, -3, -2.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 3, 4.75]

  function roundTripPieced(src: string): string | null {
    const first = parseExpression(src)
    if (!first.ok) return null // only valid inputs are round-trip candidates
    const latex = first.plot.latex
    let round: string
    try {
      round = dePieced(latex)
    } catch (e) {
      return `${src}\n  latex: ${latex}\n  ${(e as Error).message}`
    }
    const second = parseExpression(round)
    const bad = (why: string) => `${src}\n  latex: ${latex}\n  round: ${round}\n  ${why}`
    if (!second.ok) return bad(`re-parse failed: ${second.error}`)
    const A = first.plot, B = second.plot
    if (A.kind !== B.kind) return bad(`kind ${A.kind} -> ${B.kind}`)
    if (A.paramNames.join(',') !== B.paramNames.join(',')) {
      return bad(`params [${A.paramNames}] -> [${B.paramNames}]`)
    }
    if (JSON.stringify(A.domain) !== JSON.stringify(B.domain)) {
      return bad(`domain ${JSON.stringify(A.domain)} -> ${JSON.stringify(B.domain)}`)
    }
    const ea = A.makeModel('a').evalExplicit!
    const eb = B.makeModel('b').evalExplicit!
    const params = A.paramNames.map((_, i) => 0.7 + i * 0.4)
    for (const u of PROBES) {
      // NaN counts as a value here: a gap has to come back as the same gap.
      if (!sameNum(ea(params, u), eb(params, u))) {
        return bad(`at ${u}: ${ea(params, u)} vs ${eb(params, u)}`)
      }
    }
    return null
  }

  for (const seed of [5, 99]) {
    it(`2000 restricted and piecewise inputs round-trip (seed ${seed})`, () => {
      const rng = makeRng(seed)
      const bad: string[] = []
      for (let i = 0; i < 2000; i++) {
        const src = rng() < 0.5 ? genRestricted(rng) : genPiecewise(rng)
        const found = roundTripPieced(src)
        if (found) bad.push(found)
      }
      expect(bad.slice(0, 5).join('\n---\n')).toBe('')
    })
  }

  it('restricted and piecewise inputs with log_B round-trip (seed 23)', () => {
    const rng = makeRng(23)
    const bad: string[] = []
    for (let i = 0; i < 2000; i++) {
      const src = rng() < 0.5 ? genRestricted(rng, true) : genPiecewise(rng, true)
      const found = roundTripPieced(src)
      if (found) bad.push(found)
    }
    expect(bad.slice(0, 5).join('\n---\n')).toBe('')
  })

  it('round-trips the fixed restricted and piecewise shapes', () => {
    const fixed = [
      'y = x^2 {0 <= x < 3}',
      'y = x^2, 0 <= x < 3',
      'y = x^2 for x > 0',
      'y = sqrt(x) {x >= 0}',
      'y = 1/x {x != 0}',
      'y = 1/x {x < -1 or x > 2}',
      'y = { x^2 if x < 0 ; 2x if x >= 0 }',
      'y = { x^2, x < 0 ; 2x, x >= 0 }',
      'y = piecewise(x^2, x < 0, 2x, x >= 0)',
      'f(x) = { -x if x < 0 ; x if x >= 0 }',
      'y = { a x if x < 0 ; b x if x >= 0 }',
      'y = { -1 if x < 0 ; 1 if x >= 0 }',
      'y = { 1 if x < 5 ; 2 if x < 10 ; 3 otherwise }',
      'y = { sqrt(x) if 0 <= x <= 4 ; 2 otherwise }',
      'y = min(x, 2) {0 < x <= 5}',
      'y = |x - 2| {x != 2}',
    ]
    const bad = fixed.map(roundTripPieced).filter(Boolean)
    expect(bad.join('\n---\n')).toBe('')
  })
})

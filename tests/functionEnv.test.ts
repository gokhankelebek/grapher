// ============================================================================
// tests/functionEnv.test.ts — functions that use other functions.
//   g(x) = 2f(x − 1) + 3    h(x) = f(g(x))    k(x) = f'(x)    f^-1
// The parser's named calls (parseExpression(src, env)), referencedNames,
// dependencyOrder and inverseRelation (src/core/functionEnv.ts).
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { FittedCurve, ModelSpec, ParsedPlot } from '../src/core/types'
import { analyzeExpr, compileExpr, parseExpression } from '../src/core/parse'
import {
  dependencyOrder,
  inverseRelation,
  referencedNames,
  type FunctionEnv,
} from '../src/core/functionEnv'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * A live env over typed formulas, the way the App will build one: each name
 * is a parsed explicit model, looked up at EVERY eval — so `define` after a
 * model was built is seen by it.
 */
function makeEnv(defs: Record<string, string>): FunctionEnv & { define(name: string, src: string): void } {
  const models = new Map<string, { spec: ModelSpec; params: number[] }>()
  const define = (name: string, src: string): void => {
    const o = parseExpression(src)
    if (!o.ok) throw new Error(`bad def ${src}: ${o.error}`)
    models.set(name, { spec: o.plot.makeModel(name), params: o.plot.defaultParams })
  }
  for (const [k, v] of Object.entries(defs)) define(k, v)
  return {
    has: (n) => models.has(n),
    eval: (n, x) => {
      const m = models.get(n)
      return m ? m.spec.evalExplicit!(m.params, x) : Number.NaN
    },
    define,
  }
}

function plotWith(src: string, env: FunctionEnv): ParsedPlot {
  const r = parseExpression(src, env)
  if (!r.ok) throw new Error(`expected "${src}" to parse, got: ${r.error}`)
  return r.plot
}

const XS = [-3.7, -2, -1.25, -0.5, 0, 0.3, 1, 1.75, 2.5, 4.2]

function curveOf(src: string, domain: [number, number] | null = null): {
  curve: FittedCurve
  models: Record<string, ModelSpec>
} {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(o.error)
  const spec = o.plot.makeModel('typed')
  return {
    curve: {
      id: 'c1', modelId: 'typed', params: o.plot.defaultParams, kind: o.plot.kind,
      domain: domain ?? o.plot.domain, color: '#fff', strokeWidth: 2, visible: true, error: 0,
    },
    models: { typed: spec },
  }
}

// ---------------------------------------------------------------------------
// named calls in the parser
// ---------------------------------------------------------------------------

describe('named calls — values with env {f: x², g: sin}', () => {
  const env = makeEnv({ f: 'x^2', g: 'sin(x)' })
  const ev = (src: string) => {
    const p = plotWith(src, env)
    expect(p.kind).toBe('explicit')
    const m = p.makeModel('m')
    return (x: number) => m.evalExplicit!(p.defaultParams, x)
  }

  it('2f(x − 1) + 3 is a transformation of f', () => {
    const h = ev('2f(x-1)+3')
    for (const x of XS) expect(h(x)).toBeCloseTo(2 * (x - 1) ** 2 + 3, 12)
    // the Unicode minus and spacing a teacher types
    const h2 = ev('2f(x − 1) + 3')
    for (const x of XS) expect(h2(x)).toBeCloseTo(2 * (x - 1) ** 2 + 3, 12)
  })

  it('composition f(g(x)) and g(f(x))', () => {
    const fg = ev('f(g(x))')
    const gf = ev('g(f(x))')
    for (const x of XS) {
      expect(fg(x)).toBeCloseTo(Math.sin(x) ** 2, 12)
      expect(gf(x)).toBeCloseTo(Math.sin(x * x), 12)
    }
  })

  it('products, differences, quotients and powers of named curves', () => {
    const prod = ev('f(x)g(x)')
    const diff = ev('f(x) - g(x)')
    const quo = ev('g(x)/f(x)')
    const pow = ev('f(x)^2')
    const inner = ev('f(2x)')
    for (const x of XS) {
      expect(prod(x)).toBeCloseTo(x * x * Math.sin(x), 12)
      expect(diff(x)).toBeCloseTo(x * x - Math.sin(x), 12)
      if (x !== 0) expect(quo(x)).toBeCloseTo(Math.sin(x) / (x * x), 10)
      expect(pow(x)).toBeCloseTo(x ** 4, 10)
      expect(inner(x)).toBeCloseTo(4 * x * x, 12)
    }
  })

  it("f'(x) ≈ 2x and g'(x) ≈ cos x within 1e-7", () => {
    const fp = ev("f'(x)")
    const gp = ev("g'(x)")
    for (const x of XS) {
      expect(Math.abs(fp(x) - 2 * x)).toBeLessThan(1e-7)
      expect(Math.abs(gp(x) - Math.cos(x))).toBeLessThan(1e-7)
    }
  })

  it("f''(x) ≈ 2 and g''(x) ≈ −sin x", () => {
    const fpp = ev("f''(x)")
    const gpp = ev("g''(x)")
    for (const x of XS) {
      expect(Math.abs(fpp(x) - 2)).toBeLessThan(1e-6)
      expect(Math.abs(gpp(x) + Math.sin(x))).toBeLessThan(1e-6)
    }
  })

  it("the derivative is taken of the curve, then evaluated at the argument: f'(g(x)) = 2 sin x", () => {
    const h = ev("f'(g(x))")
    for (const x of XS) expect(Math.abs(h(x) - 2 * Math.sin(x))).toBeLessThan(1e-7)
  })

  it('free constants alongside named calls stay sliders', () => {
    const p = plotWith('a f(x - h) + k', env)
    expect(p.paramNames).toEqual(['a', 'h', 'k'])
    const m = p.makeModel('m')
    expect(m.evalExplicit!([2, 1, 3], 4)).toBeCloseTo(2 * 9 + 3, 12)
  })

  it('works in restricted and piecewise definitions', () => {
    const r = ev('y = f(x) {x > 0}')
    expect(r(2)).toBe(4)
    expect(r(-2)).toBeNaN()
    const pw = ev('h(x) = { f(x) if x < 0 ; g(x) otherwise }')
    expect(pw(-3)).toBe(9)
    expect(pw(1)).toBeCloseTo(Math.sin(1), 14)
    const pc = ev('y = piecewise(f(x), x < 0, 2g(x))')
    expect(pc(-2)).toBe(4)
    expect(pc(2)).toBeCloseTo(2 * Math.sin(2), 14)
  })

  it('a name the env does not have is a slider, as always', () => {
    const p = plotWith('q(x+1)', env)
    expect(p.paramNames).toEqual(['q'])
  })
})

describe('named calls — LaTeX', () => {
  const env = makeEnv({ f: 'x^2', g: 'sin(x)' })
  const tex = (src: string) => plotWith(src, env).latex

  it('renders calls as f\\left(…\\right), with primes', () => {
    expect(tex('2f(x-1)+3')).toBe('y = 2f\\left(x-1\\right)+3')
    expect(tex('f(g(x))')).toBe('y = f\\left(g\\left(x\\right)\\right)')
    expect(tex('f(x)g(x)')).toBe('y = f\\left(x\\right)g\\left(x\\right)')
    expect(tex('f(x) - g(x)')).toBe('y = f\\left(x\\right)-g\\left(x\\right)')
    expect(tex("f'(x)")).toBe("y = f'\\left(x\\right)")
    expect(tex("f''(x)")).toBe("y = f''\\left(x\\right)")
    expect(tex('f(x)^2')).toBe('y = f\\left(x\\right)^{2}')
    expect(tex('a f(x)')).toBe('y = a\\,f\\left(x\\right)')
    expect(tex('-f(x)')).toBe('y = -f\\left(x\\right)')
  })

  it("a definition's head names the line", () => {
    expect(tex('h(x) = 2f(x - 1) + 3')).toBe('h\\left(x\\right) = 2f\\left(x-1\\right)+3')
    // a line may DEFINE a name the env has (the App registers it); the head is not a call
    expect(tex('g(x) = f(x) + 1')).toBe('g\\left(x\\right) = f\\left(x\\right)+1')
    expect(tex('y = f(x) + 1')).toBe('y = f\\left(x\\right)+1')
  })
})

describe('named calls — errors', () => {
  const env = makeEnv({ f: 'x^2', g: 'sin(x)' })
  const err = (src: string) => {
    const r = parseExpression(src, env)
    if (r.ok) throw new Error(`expected "${src}" to fail, parsed as ${r.plot.latex}`)
    return r
  }

  it('a curve cannot call itself — a positioned error', () => {
    const e = err('f(x) = f(x - 1) + 1')
    expect(e.error).toMatch(/^f cannot use itself/)
    expect(e.pos).toBe(7)
    const e2 = err("g(x) = 2 + g'(x)")
    expect(e2.error).toMatch(/^g cannot use itself/)
    expect(e2.pos).toBe(11)
  })

  it('also inside a piece of a piecewise definition', () => {
    const src = 'f(x) = { x if x < 0 ; f(x - 1) otherwise }'
    const e = err(src)
    expect(e.error).toMatch(/^f cannot use itself/)
    expect(e.pos).toBe(src.indexOf('f(x - 1)'))
  })

  it('a named call takes one argument and needs its closing parenthesis', () => {
    expect(err('f(x, 2)').error).toMatch(/'f' takes one argument/)
    expect(err('f(x').error).toMatch(/Unexpected end of input/)
  })

  it('three primes, or a prime on a name the env lacks, stay the old error', () => {
    expect(err("f'''(x)").error).toMatch(/Unexpected character/)
    expect(err("q'(x)").error).toMatch(/Unexpected character/)
  })
})

describe('named calls — the model reads the env live', () => {
  it('redefining f is seen by an already-built g, without re-parsing', () => {
    const env = makeEnv({ f: 'x^2' })
    const p = plotWith('g(x) = 2f(x - 1) + 3', env)
    const g = p.makeModel('g')
    expect(g.evalExplicit!([], 3)).toBe(11)
    env.define('f', 'x^3')
    expect(g.evalExplicit!([], 3)).toBe(19)
    env.define('f', 'sin(x)')
    expect(g.evalExplicit!([], 3)).toBeCloseTo(2 * Math.sin(2) + 3, 14)
  })

  it('a name that evaluates to NaN everywhere is just an empty graph', () => {
    const env: FunctionEnv = { has: (n) => n === 'c', eval: () => Number.NaN }
    const p = plotWith('c(x) + 1', env)
    expect(p.makeModel('m').evalExplicit!([], 1)).toBeNaN()
  })

  it("singularities: a call contributes none, its own written denominators do — and they follow f", () => {
    const env = makeEnv({ f: 'x^2 - 4' })
    // f(x) itself: no singularity reported
    const plain = plotWith('f(x) + 1', env).makeModel('p')
    expect(plain.singularities!([], [-5, 5])).toEqual([])
    // 1/f(x): the zeros of f, found by scanning the written denominator
    const recip = plotWith('1/f(x)', env).makeModel('r')
    const s1 = recip.singularities!([], [-5, 5])
    expect(s1).toHaveLength(2)
    expect(s1[0]).toBeCloseTo(-2, 9)
    expect(s1[1]).toBeCloseTo(2, 9)
    // same params and range, but f moved: the answer is not a stale cache
    env.define('f', 'x - 1')
    const s2 = recip.singularities!([], [-5, 5])
    expect(s2).toHaveLength(1)
    expect(s2[0]).toBeCloseTo(1, 9)
    // the argument's own singularity: f(1/x) is undefined at 0
    expect(plotWith('f(1/x)', env).makeModel('q').singularities!([], [-5, 5])).toEqual([0])
  })

  it('compileExpr and analyzeExpr accept the env too', () => {
    const env = makeEnv({ f: 'x^2' })
    const c = compileExpr("f(x) + f'(y)", env)
    if (!c.ok) throw new Error(c.error)
    expect(c.expr.ev([], 3, 2)).toBeCloseTo(9 + 4, 7)
    expect(c.expr.latex).toBe("f\\left(x\\right)+f'\\left(y\\right)")
    const a = analyzeExpr('f(3) + 1', env)
    expect(a.ok && a.value).toBe(10)
    // without the env, the same text is a slider product, as before
    const b = analyzeExpr('f(3) + 1')
    expect(b.ok && b.free).toEqual(['f'])
  })
})

describe('named calls — speed', () => {
  it('f(g(x)) + 2f\'(x), 1000 evaluations, under 2 ms (best of five)', () => {
    const env = makeEnv({ f: 'x^2', g: 'sin(x)' })
    const m = plotWith("f(g(x)) + 2f'(x)", env).makeModel('m')
    const ev = m.evalExplicit!
    const xs = Array.from({ length: 1000 }, (_, i) => -10 + (20 * i) / 999)
    let sink = 0
    for (let w = 0; w < 20; w++) for (const x of xs) sink += ev([], x) // warm the JIT
    let best = Infinity
    for (let run = 0; run < 5; run++) {
      const t0 = performance.now()
      for (const x of xs) sink += ev([], x)
      best = Math.min(best, performance.now() - t0)
    }
    expect(Number.isFinite(sink)).toBe(true)
    expect(best).toBeLessThan(2)
  })
})

// ---------------------------------------------------------------------------
// named calls — a called curve's singularities, mapped through the argument
// ---------------------------------------------------------------------------

/**
 * makeEnv plus `singularities`, answered from each name's real parsed model —
 * its own `singularities` (denominators, exclusions), as the App's env does.
 */
function makeSingEnv(defs: Record<string, string>): FunctionEnv & { define(name: string, src: string): void } {
  const models = new Map<string, { spec: ModelSpec; params: number[] }>()
  const define = (name: string, src: string): void => {
    const o = parseExpression(src)
    if (!o.ok) throw new Error(`bad def ${src}: ${o.error}`)
    models.set(name, { spec: o.plot.makeModel(name), params: o.plot.defaultParams })
  }
  for (const [k, v] of Object.entries(defs)) define(k, v)
  return {
    has: (n) => models.has(n),
    eval: (n, x) => {
      const m = models.get(n)
      return m ? m.spec.evalExplicit!(m.params, x) : Number.NaN
    },
    singularities: (n, range) => {
      const m = models.get(n)
      return m?.spec.singularities ? m.spec.singularities(m.params, range) : []
    },
    define,
  }
}

describe('named calls — the called curve\'s singularities', () => {
  const singWith = (src: string, env: FunctionEnv, range: [number, number] = [-10, 10]) =>
    plotWith(src, env).makeModel('m').singularities!([], range)

  it('g(x) = 2f(x − 1) + 3 with f = 1/x is singular at exactly 1', () => {
    const env = makeSingEnv({ f: '1/x' })
    expect(singWith('2f(x - 1) + 3', env)).toEqual([1])
    expect(singWith('g(x) = 2f(x - 1) + 3', env)).toEqual([1])
    // linear arguments of every spelling, solved exactly
    expect(singWith('f(2x)', env)).toEqual([0])
    expect(singWith('f(3 - x)', env)).toEqual([3])
    expect(singWith('f((x + 3)/2)', env)).toEqual([-3])
  })

  it('a nonlinear argument is scanned: f(x² − 4) at ±2, f(x²) touching at 0', () => {
    const env = makeSingEnv({ f: '1/x' })
    expect(singWith('f(x^2 - 4)', env)).toEqual([-2, 2])
    expect(singWith('f(x^2)', env)).toEqual([0])
    // a value f's argument never reaches gives nothing: x² + 1 never hits 0
    expect(singWith('f(x^2 + 1)', env)).toEqual([])
  })

  it("f'(u) and f''(u) inherit f's singularities", () => {
    const env = makeSingEnv({ f: '1/x' })
    expect(singWith("f'(x - 1)", env)).toEqual([1])
    expect(singWith("f''(2x + 4)", env)).toEqual([-2])
  })

  it('an exclusion of f is mapped too: f = x² {x ≠ 2} called as f(2x) is singular at 1', () => {
    const env = makeSingEnv({ f: 'y = x^2 {x != 2}' })
    expect(singWith('f(2x)', env)).toEqual([1])
  })

  it('composition: f(g(x)) collects f through g AND g\'s own set', () => {
    const env = makeSingEnv({ f: '1/x', g: 'x - 1', h: '1/(x - 3)' })
    // f's 0 is where g(x) = 0
    expect(singWith('f(g(x))', env)).toEqual([1])
    // h's pole at 3 comes from the inner call; h(x) = 0 nowhere (its jump
    // across 0 at the pole is not a crossing)
    expect(singWith('f(h(x))', env)).toEqual([3])
  })

  it('follows f live: redefining f moves the answer without re-parsing', () => {
    const env = makeSingEnv({ f: '1/x' })
    const m = plotWith('f(x - 1)', env).makeModel('m')
    expect(m.singularities!([], [-10, 10])).toEqual([1])
    env.define('f', '1/(x - 2)')
    expect(m.singularities!([], [-10, 10])).toEqual([3])
    env.define('f', 'x^2')
    expect(m.singularities!([], [-10, 10])).toEqual([])
  })

  it('an argument with a slider is solved at the current params', () => {
    const env = makeSingEnv({ f: '1/x' })
    const p = plotWith('f(x - a)', env)
    const m = p.makeModel('m')
    expect(m.singularities!([1], [-10, 10])).toEqual([1])
    expect(m.singularities!([2.5], [-10, 10])).toEqual([2.5])
  })

  it('only the requested range counts, and a constant argument names no x', () => {
    const env = makeSingEnv({ f: '1/x' })
    expect(singWith('f(x - 5)', env, [-2, 2])).toEqual([])
    expect(singWith('f(0) + x', env)).toEqual([])
  })

  it('an env without singularities, or one that throws, reports exactly as before', () => {
    const plain = makeEnv({ f: '1/x' })
    for (const src of ['2f(x - 1) + 3', 'f(x^2 - 4)', "f'(x)", 'f(x)·x']) {
      expect(singWith(src, plain), src).toEqual([])
    }
    // the old behaviour, byte-identical, where a denominator is written
    expect(singWith('1/f(x - 1) + 1/(x + 4)', plain)).toEqual([-4])
    const throwing: FunctionEnv = {
      has: (n) => n === 'f',
      eval: (_n, x) => 1 / x,
      singularities: () => { throw new Error('boom') },
    }
    expect(singWith('2f(x - 1) + 3', throwing)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// referencedNames
// ---------------------------------------------------------------------------

describe('referencedNames', () => {
  const table: [string, string[]][] = [
    ['2f(x-1)+3', ['f']],
    ['g(x) = 2f(x − 1) + 3', ['f']],
    ['h(x) = f(g(x))', ['f', 'g']],
    ["f(g(x)) + g'(x)", ['f', 'g']],
    ["k(x) = f'(x)", ['f']],
    ["y = f''(x) + f(x)", ['f']],
    ['p(x) = f(x)g(x)', ['f', 'g']],
    ['q(x) = f(x) - g(x)', ['f', 'g']],
    ['y = f(x) + 1', ['f']],
    ['a(x+1)', ['a']], // a slider times a bracket, or a call — the App decides
    ['y = a(x - h)^2 + k', ['a']],
    ['f(x) = x^2', []],
    ['f(x) = f(x - 1) + 1', []], // its own name: the parser reports that
    ['f (x)', []], // a space: a product, never a call
    ['x(x+1)', []],
    ['e(x)', []],
    ['t(t+1)', []],
    ['sin(x) + cos(2x)', []],
    ['log_b(x)', []], // the base of a logarithm
    ['log_b(g(x))', ['g']],
    ['ln(f(x))', ['f']],
    ['y = f(x) {x > 0}', ['f']],
    ['y = { f(x) if x < 0 ; g(x) otherwise }', ['f', 'g']],
    ['h(x) = { f(x) if x < 0 ; h(x) otherwise }', ['f']],
    ['y = piecewise(f(x), x < 0, g(x))', ['f', 'g']],
    ["y' = x", []],
    ["y' = f(x)", ['f']],
    ['g(f(h(x)))', ['g', 'f', 'h']],
    ['f(x) + f(2x) + f(3x)', ['f']],
    ["f'''(x)", []],
    ['', []],
    ['2 +* (', []],
    ['r = f(theta)', ['f']],
    ['2f(x)3g(x)', ['f', 'g']],
  ]
  for (const [src, want] of table) {
    it(`${JSON.stringify(src)} → [${want.join(', ')}]`, () => {
      expect(referencedNames(src)).toEqual(want)
    })
  }
})

// ---------------------------------------------------------------------------
// dependencyOrder
// ---------------------------------------------------------------------------

describe('dependencyOrder', () => {
  const def = (name: string, ...uses: string[]) => ({ name, uses })

  it('orders every name after the names it uses', () => {
    const r = dependencyOrder([def('h', 'f', 'g'), def('g', 'f'), def('f')])
    expect(r.order).toEqual(['f', 'g', 'h'])
    expect(r.cycles).toEqual([])
  })

  it('keeps input order among names that are ready together', () => {
    const r = dependencyOrder([def('b'), def('a'), def('d', 'a'), def('c', 'b')])
    // b, a are ready first; then c and d both are — d was typed before c
    expect(r.order).toEqual(['b', 'a', 'd', 'c'])
  })

  it('a diamond', () => {
    const r = dependencyOrder([def('k', 'g', 'h'), def('g', 'f'), def('h', 'f'), def('f')])
    expect(r.order).toEqual(['f', 'g', 'h', 'k'])
  })

  it('unknown names are not edges (the App reports them), and not cycles', () => {
    const r = dependencyOrder([def('g', 'f', 'z'), def('f', 'q')])
    expect(r.order).toEqual(['f', 'g'])
    expect(r.cycles).toEqual([])
  })

  it('reports a two-name cycle as its path', () => {
    const r = dependencyOrder([def('f', 'g'), def('g', 'f')])
    expect(r.cycles).toEqual([['f', 'g', 'f']])
    expect(r.order).toEqual(['f', 'g'])
  })

  it('a three-name cycle, a self-loop, and a name downstream of a cycle', () => {
    const r = dependencyOrder([
      def('a'),
      def('f', 'g'),
      def('g', 'h'),
      def('h', 'f'),
      def('k', 'k'),
      def('p', 'h', 'a'),
    ])
    expect(r.cycles).toEqual([['f', 'g', 'h', 'f'], ['k', 'k']])
    // the orderable come first; the stuck follow, in input order
    expect(r.order).toEqual(['a', 'f', 'g', 'h', 'k', 'p'])
  })

  it('a repeated name merges its uses; an empty list is empty', () => {
    const r = dependencyOrder([def('g', 'f'), def('f'), def('g', 'h'), def('h')])
    expect(r.order).toEqual(['f', 'h', 'g'])
    expect(dependencyOrder([])).toEqual({ order: [], cycles: [] })
  })

  it('works on referencedNames output', () => {
    const lines: Record<string, string> = {
      h: 'h(x) = f(g(x))',
      g: 'g(x) = 2f(x - 1) + 3',
      f: 'f(x) = x^2',
    }
    const r = dependencyOrder(Object.entries(lines).map(([name, src]) => ({ name, uses: referencedNames(src) })))
    expect(r.order).toEqual(['f', 'g', 'h'])
  })
})

// ---------------------------------------------------------------------------
// inverseRelation
// ---------------------------------------------------------------------------

describe('inverseRelation', () => {
  it('x³ is one-to-one; the relation is (t³, t)', () => {
    const { curve, models } = curveOf('y = x^3')
    const inv = inverseRelation(curve, models, [-10, 10])
    expect(inv.oneToOne).toBe(true)
    expect(inv.sentence).toBe('f is one-to-one, so its inverse is a function')
    expect(inv.tRange).toEqual([-10, 10])
    expect(inv.monotoneIntervals).toEqual([[-10, 10]])
    const m = inv.makeModel('inv')
    expect(m.kind).toBe('parametric')
    expect(m.paramMeta([])).toEqual([])
    expect(m.evalParametric!([], 2)).toEqual({ x: 8, y: 2 })
    expect(m.evalParametric!([], -1.5)).toEqual({ x: -3.375, y: -1.5 })
    expect(m.latex([])).toBe('x = y^{3}')
  })

  it('x² is not: intervals x ≤ 0 and x ≥ 0, advice x ≥ 0', () => {
    const { curve, models } = curveOf('y = x^2')
    const inv = inverseRelation(curve, models, [-10, 10])
    expect(inv.oneToOne).toBe(false)
    expect(inv.monotoneIntervals).toHaveLength(2)
    const sorted = inv.monotoneIntervals.slice().sort((a, b) => a[0] - b[0])
    expect(sorted).toEqual([[-10, 0], [0, 10]])
    expect(inv.sentence).toBe('f fails the horizontal line test — restrict its domain to x ≥ 0')
    const m = inv.makeModel('inv')
    expect(m.evalParametric!([], -3)).toEqual({ x: 9, y: -3 })
  })

  it('sin on [−2π, 2π]: five monotone pieces, the widest around 0 first, advice −π/2 ≤ x ≤ π/2', () => {
    const { curve, models } = curveOf('y = sin(x)')
    const inv = inverseRelation(curve, models, [-2 * Math.PI, 2 * Math.PI])
    expect(inv.oneToOne).toBe(false)
    expect(inv.monotoneIntervals).toHaveLength(5)
    const [first] = inv.monotoneIntervals
    expect(first[0]).toBeCloseTo(-Math.PI / 2, 12)
    expect(first[1]).toBeCloseTo(Math.PI / 2, 12)
    for (let i = 1; i < 3; i++) {
      const [a, b] = inv.monotoneIntervals[i]
      expect(b - a).toBeCloseTo(Math.PI, 9)
    }
    expect(inv.sentence).toBe('f fails the horizontal line test — restrict its domain to −π/2 ≤ x ≤ π/2')
  })

  it('e^x is one-to-one, even where its slope is tiny', () => {
    for (const range of [[-10, 10], [-40, 40]] as [number, number][]) {
      const { curve, models } = curveOf('y = e^x')
      const inv = inverseRelation(curve, models, range)
      expect(inv.oneToOne).toBe(true)
      expect(inv.monotoneIntervals).toEqual([range])
    }
  })

  it('poles: 1/x passes, 1/x² and tan fail with open bounds', () => {
    const r1 = inverseRelation(curveOf('y = 1/x').curve, curveOf('y = 1/x').models, [-10, 10])
    expect(r1.oneToOne).toBe(true)
    const c2 = curveOf('y = 1/x^2')
    const r2 = inverseRelation(c2.curve, c2.models, [-10, 10])
    expect(r2.oneToOne).toBe(false)
    expect(r2.sentence).toBe('f fails the horizontal line test — restrict its domain to x > 0')
    const c3 = curveOf('y = tan(x)')
    const r3 = inverseRelation(c3.curve, c3.models, [-2 * Math.PI, 2 * Math.PI])
    expect(r3.oneToOne).toBe(false)
    expect(r3.sentence).toBe('f fails the horizontal line test — restrict its domain to −π/2 < x < π/2')
  })

  it('cos reads 0 ≤ x ≤ π; a constant has no interval at all', () => {
    const c = curveOf('y = cos(x)')
    expect(inverseRelation(c.curve, c.models, [-10, 10]).sentence).toBe(
      'f fails the horizontal line test — restrict its domain to 0 ≤ x ≤ π',
    )
    const k = curveOf('y = 3')
    const r = inverseRelation(k.curve, k.models, [-10, 10])
    expect(r.oneToOne).toBe(false)
    expect(r.monotoneIntervals).toEqual([])
  })

  it("the range is clipped to the curve's domain; the name is the curve's", () => {
    const { curve, models } = curveOf('y = x^2', [0, 3])
    const inv = inverseRelation(curve, models, [-10, 10], 'g')
    expect(inv.tRange).toEqual([0, 3])
    expect(inv.oneToOne).toBe(true)
    expect(inv.sentence).toBe('g is one-to-one, so its inverse is a function')
  })

  it('a curve that is not y = f(x) has no inverse drawn this way', () => {
    const { curve, models } = curveOf('x^2 + y^2 = 4')
    const inv = inverseRelation(curve, models, [-10, 10])
    expect(inv.oneToOne).toBe(false)
    expect(inv.monotoneIntervals).toEqual([])
    expect(inv.makeModel('i').evalParametric!([], 1).x).toBeNaN()
  })
})

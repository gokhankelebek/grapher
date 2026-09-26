import { describe as group, expect, it } from 'vitest'
import {
  PARENTS,
  describe,
  mapPoints,
  readTransform,
  transformFeatures,
  transformSource,
  type ParentId,
  type TransformSpec,
} from '../src/core/transform'
import { parseExpression } from '../src/core/parse'
import { makeRng } from './helpers'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Constant string → number, through the app's own parser. */
function val(s: string): number {
  const o = parseExpression(s)
  if (!o.ok) throw new Error(`not a constant: ${s}`)
  return o.plot.makeModel('v').evalExplicit!(o.plot.defaultParams, 0)
}

const spec = (parent: ParentId, a: string, b = '1', h = '0', k = '0', name?: string): TransformSpec =>
  name ? { name, parent, a, b, h, k } : { parent, a, b, h, k }

/** The parents, written independently of the module under test. */
const F: Record<ParentId, (u: number) => number> = {
  linear: (u) => u,
  quadratic: (u) => u ** 2,
  cubic: (u) => u ** 3,
  absolute: Math.abs,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  reciprocal: (u) => 1 / u,
  reciprocal2: (u) => 1 / u ** 2,
  exp2: (u) => 2 ** u,
  expe: Math.exp,
  log2: Math.log2,
  ln: Math.log,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  floor: Math.floor,
}

const IDS = Object.keys(F) as ParentId[]

/** y = a·f(b(x − h)) + k, straight from the spec. */
function formula(s: TransformSpec, x: number): number {
  return val(s.a) * F[s.parent](val(s.b) * (x - val(s.h))) + val(s.k)
}

/** Twenty parent-argument values inside each parent's domain, off its breaks. */
function argsFor(p: ParentId): number[] {
  if (p === 'sqrt' || p === 'log2' || p === 'ln') return Array.from({ length: 20 }, (_, i) => 0.07 + i * 0.53)
  if (p === 'tan') return Array.from({ length: 20 }, (_, i) => -1.45 + i * 0.1513)
  // symmetric, never an integer (floor), never 0 (reciprocals)
  return Array.from({ length: 20 }, (_, i) => -3.13 + i * 0.3217)
}

/** Twenty x in the transformed domain: x = h + u/b. */
const xsFor = (s: TransformSpec) => argsFor(s.parent).map((u) => val(s.h) + u / val(s.b))

/** A typed source as a function of x. */
function fnOf(src: string): (x: number) => number {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(`${src}: ${o.error}`)
  expect(o.plot.kind).toBe('explicit')
  const m = o.plot.makeModel('t')
  return (x) => m.evalExplicit!(o.plot.defaultParams, x)
}

/** transformSource parses, has no sliders, and equals the formula at 20 points. */
function expectParses(s: TransformSpec): string {
  const src = transformSource(s)
  const o = parseExpression(src)
  expect(o.ok, `${src}: ${o.ok ? '' : o.error}`).toBe(true)
  if (!o.ok) return src
  expect(o.plot.kind).toBe('explicit')
  expect(o.plot.paramNames).toEqual([])
  const f = fnOf(src)
  for (const x of xsFor(s)) {
    const want = formula(s, x)
    expect(Number.isFinite(want), `${src} at x=${x}`).toBe(true)
    expect(Math.abs(f(x) - want), `${src} at x=${x}`).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(want)))
  }
  return src
}

const EVEN = new Set<ParentId>(['quadratic', 'absolute', 'reciprocal2', 'cos'])

/**
 * What readTransform gives back for a spec: even parents with b > 0; a line
 * in slope-intercept form (a = a·b, k = k − a·b·h).
 */
function normalised(s: TransformSpec): { parent: ParentId; a: number; b: number; h: number; k: number } {
  const [a, b, h, k] = [val(s.a), val(s.b), val(s.h), val(s.k)]
  if (s.parent === 'linear') return { parent: 'linear', a: a * b, b: 1, h: 0, k: k - a * b * h }
  return { parent: s.parent, a, b: EVEN.has(s.parent) ? Math.abs(b) : b, h, k }
}

function expectSameSpec(got: TransformSpec | null, want: TransformSpec, label: string) {
  expect(got, label).not.toBeNull()
  if (!got) return
  const n = normalised(want)
  expect(got.parent, label).toBe(n.parent)
  for (const key of ['a', 'b', 'h', 'k'] as const) {
    expect(val(got[key]), `${label} ${key}=${got[key]}`).toBeCloseTo(n[key], 10)
  }
}

const read = (src: string) => readTransform(src)
const sentences = (s: TransformSpec) => describe(s).map((x) => x.sentence)
const kinds = (s: TransformSpec) => describe(s).map((x) => x.kind)

// ---------------------------------------------------------------------------
// PARENTS
// ---------------------------------------------------------------------------

group('PARENTS', () => {
  it('lists all sixteen parents once, in the contract order', () => {
    expect(PARENTS.map((p) => p.id)).toEqual(IDS)
  })

  it('each body is its parent, and every key point lies on it', () => {
    for (const p of PARENTS) {
      expect(p.name.length).toBeGreaterThan(0)
      expect(p.latex.startsWith('y = ')).toBe(true)
      expect(p.anchorName.length).toBeGreaterThan(0)
      const f = fnOf(p.body)
      for (const x of argsFor(p.id)) expect(f(x)).toBeCloseTo(F[p.id](x), 12)
      expect(p.keyPoints.length).toBeGreaterThanOrEqual(2)
      for (const kp of p.keyPoints) {
        expect(f(kp.x), `${p.id} (${kp.xText}, ${kp.yText})`).toBeCloseTo(kp.y, 12)
      }
      // the identity transform reproduces the parent's own sentences
      const feats = transformFeatures(spec(p.id, '1'))
      expect([feats.domain, feats.range, feats.asymptotes]).toEqual([p.domain, p.range, p.asymptotes])
      expect(feats.anchor?.name).toBe(p.anchorName)
      expect(describe(spec(p.id, '1'))).toEqual([])
    }
  })

  it('uses the textbook tables', () => {
    const table = (id: ParentId) =>
      PARENTS.find((p) => p.id === id)!.keyPoints.map((k) => `(${k.xText}, ${k.yText})`).join(' ')
    expect(table('quadratic')).toBe('(−2, 4) (−1, 1) (0, 0) (1, 1) (2, 4)')
    expect(table('cubic')).toBe('(−2, −8) (−1, −1) (0, 0) (1, 1) (2, 8)')
    expect(table('absolute')).toBe('(−2, 2) (−1, 1) (0, 0) (1, 1) (2, 2)')
    expect(table('sqrt')).toBe('(0, 0) (1, 1) (4, 2) (9, 3)')
    expect(table('cbrt')).toBe('(−8, −2) (−1, −1) (0, 0) (1, 1) (8, 2)')
    expect(table('reciprocal')).toBe('(−2, −1/2) (−1, −1) (−1/2, −2) (1/2, 2) (1, 1) (2, 1/2)')
    expect(table('reciprocal2')).toBe('(−2, 1/4) (−1, 1) (−1/2, 4) (1/2, 4) (1, 1) (2, 1/4)')
    expect(table('exp2')).toBe('(−1, 1/2) (0, 1) (1, 2) (2, 4)')
    expect(table('expe')).toBe('(0, 1) (1, e)')
    expect(table('log2')).toBe('(1/2, −1) (1, 0) (2, 1) (4, 2)')
    expect(table('ln')).toBe('(1, 0) (e, 1)')
    expect(table('sin')).toBe('(0, 0) (π/2, 1) (π, 0) (3π/2, −1) (2π, 0)')
    expect(table('cos')).toBe('(0, 1) (π/2, 0) (π, −1) (3π/2, 0) (2π, 1)')
    expect(table('tan')).toBe('(−π/4, −1) (0, 0) (π/4, 1)')
    expect(table('floor')).toBe('(−2, −2) (−1, −1) (0, 0) (1, 1) (2, 2)')
  })

  it('names the anchor the way a textbook does', () => {
    const name = (id: ParentId) => PARENTS.find((p) => p.id === id)!.anchorName
    expect(name('quadratic')).toBe('vertex')
    expect(name('absolute')).toBe('vertex')
    expect(name('cubic')).toBe('inflection point')
    expect(name('cbrt')).toBe('inflection point')
    expect(name('sqrt')).toBe('starting point')
    expect(name('reciprocal')).toBe('center')
    expect(name('reciprocal2')).toBe('center')
  })
})

// ---------------------------------------------------------------------------
// transformSource
// ---------------------------------------------------------------------------

group('transformSource', () => {
  it('writes each parent the textbook way', () => {
    const cases: [TransformSpec, string][] = [
      [spec('quadratic', '-2', '1', '3', '1'), 'y = -2(x - 3)^2 + 1'],
      [spec('quadratic', '1', '2'), 'y = (2x)^2'],
      [spec('quadratic', '1/2', '1', '-1'), 'y = (1/2)(x + 1)^2'],
      [spec('quadratic', '-1'), 'y = -x^2'],
      [spec('cubic', '1', '2'), 'y = (2x)^3'],
      [spec('cubic', '1', '1', '1', '-2'), 'y = (x - 1)^3 - 2'],
      [spec('absolute', '1', '1', '-2', '-3'), 'y = |x + 2| - 3'],
      [spec('absolute', '1', '3'), 'y = |3x|'],
      [spec('absolute', '1', '2', '3', '1'), 'y = |2(x - 3)| + 1'],
      [spec('absolute', '3'), 'y = 3|x|'],
      [spec('sqrt', '1', '-1', '1'), 'y = sqrt(-(x - 1))'],
      [spec('sqrt', '1', '2'), 'y = sqrt(2x)'],
      [spec('sqrt', '2', '1', '1', '3'), 'y = 2sqrt(x - 1) + 3'],
      [spec('cbrt', '1', '8'), 'y = cbrt(8x)'],
      [spec('reciprocal', '3', '1', '2', '1'), 'y = 3/(x - 2) + 1'],
      [spec('reciprocal', '-1'), 'y = -1/x'],
      [spec('reciprocal', '1', '2'), 'y = 1/(2x)'],
      [spec('reciprocal2', '1', '1', '2'), 'y = 1/(x - 2)^2'],
      [spec('exp2', '-1', '1', '-1', '4', 'f'), 'f(x) = -2^(x + 1) + 4'],
      [spec('exp2', '3', '1', '1'), 'y = 3(2)^(x - 1)'],
      [spec('exp2', '1', '-1'), 'y = 2^(-x)'],
      [spec('expe', '2', '1', '0', '1'), 'y = 2e^x + 1'],
      [spec('log2', '1', '1', '1'), 'y = log_2(x - 1)'],
      [spec('ln', '-2', '2'), 'y = -2ln(2x)'],
      [spec('sin', '3', '2', 'pi/4', '1'), 'y = 3sin(2(x - pi/4)) + 1'],
      [spec('cos', '1', '1/2'), 'y = cos(1/2 x)'],
      [spec('tan', '1', '1', '-pi/2'), 'y = tan(x + pi/2)'],
      [spec('floor', '2', '1', '1', '3'), 'y = 2floor(x - 1) + 3'],
      [spec('linear', '2', '1', '0', '3'), 'y = 2x + 3'],
      [spec('linear', '-1', '1', '0', '4'), 'y = -x + 4'],
      [spec('linear', '2', '1', '3', '1'), 'y = 2(x - 3) + 1'],
    ]
    for (const [s, src] of cases) {
      expect(transformSource(s)).toBe(src)
      expectParses(s)
    }
  })

  it('writes a = 0 as the constant k', () => {
    expect(transformSource(spec('sqrt', '0', '1', '2', '5'))).toBe('y = 5')
  })

  it('every parent, every sign of b, parses and is the formula', () => {
    for (const id of IDS) {
      for (const b of ['1', '-1', '2', '-1/3', '1/2']) {
        for (const [a, h, k] of [['1', '0', '0'], ['-3', '2', '-1'], ['1/2', '-5/2', '2/3'], ['sqrt(2)', '1', 'pi']]) {
          expectParses(spec(id, a, b, h, k))
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// readTransform
// ---------------------------------------------------------------------------

group('readTransform', () => {
  it('reads every natural spelling', () => {
    const table: [string, TransformSpec][] = [
      ['-2(x-3)^2+1', spec('quadratic', '-2', '1', '3', '1')],
      ['y = (x-3)^2*2', spec('quadratic', '2', '1', '3')],
      ['|2x-6|+1', spec('absolute', '1', '2', '3', '1')],
      ['sqrt(4-x)', spec('sqrt', '1', '-1', '4')],
      ['1/(x+2) - 3', spec('reciprocal', '1', '1', '-2', '-3')],
      ['-x^2', spec('quadratic', '-1')],
      ['x^3', spec('cubic', '1')],
      ['(x-1)^3', spec('cubic', '1', '1', '1')],
      ['2^(x-1)+3', spec('exp2', '1', '1', '1', '3')],
      ['cbrt(8x)', spec('cbrt', '1', '8')],
      ['abs(x)', spec('absolute', '1')],
      ['3|x|', spec('absolute', '3')],
      ['|x|/2', spec('absolute', '1/2')],
      ['y = 3/(x - 2) + 1', spec('reciprocal', '3', '1', '2', '1')],
      ['1/(2x+4)', spec('reciprocal', '1', '2', '-2')],
      ['2/(x-1)^2', spec('reciprocal2', '2', '1', '1')],
      ['(x-1)^(-2)', spec('reciprocal2', '1', '1', '1')],
      ['x^(-1) + 2', spec('reciprocal', '1', '1', '0', '2')],
      ['3(2)^x', spec('exp2', '3')],
      ['1/2^x', spec('exp2', '1', '-1')],
      ['e^x', spec('expe', '1')],
      ['exp(2x) - 1', spec('expe', '1', '2', '0', '-1')],
      ['4 - e^(x+1)', spec('expe', '-1', '1', '-1', '4')],
      ['log_2(x-1)', spec('log2', '1', '1', '1')],
      ['log2(x) + 3', spec('log2', '1', '1', '0', '3')],
      ['-ln(2x)', spec('ln', '-1', '2')],
      ['x^(1/2)', spec('sqrt', '1')],
      ['sqrt(x - 1)*2 + 3', spec('sqrt', '2', '1', '1', '3')],
      ['sin(2x - pi/2)', spec('sin', '1', '2', 'pi/4')],
      ['3cos(x/2) + 1', spec('cos', '3', '1/2', '0', '1')],
      ['tan(x + pi/4)', spec('tan', '1', '1', '-pi/4')],
      ['floor(2x - 1)', spec('floor', '1', '2', '1/2')],
      ['2x + 3', spec('linear', '2', '1', '0', '3')],
      ['3 - x', spec('linear', '-1', '1', '0', '3')],
      ['x/2', spec('linear', '1/2')],
      ['f(x) = -2^(x + 1) + 4', spec('exp2', '-1', '1', '-1', '4', 'f')],
    ]
    for (const [src, want] of table) {
      const got = read(src)
      expect(got, src).not.toBeNull()
      expect(got, src).toEqual(want)
    }
  })

  it('keeps a factor written inside as b, and one written outside as a', () => {
    expect(read('(2x)^2')).toEqual(spec('quadratic', '1', '2'))
    expect(read('4x^2')).toEqual(spec('quadratic', '4'))
    expect(read('|3x|')).toEqual(spec('absolute', '1', '3'))
    expect(read('3|x|')).toEqual(spec('absolute', '3'))
    expect(read('sqrt(4x)')).toEqual(spec('sqrt', '1', '4'))
    expect(read('2sqrt(x)')).toEqual(spec('sqrt', '2'))
    expect(read('cbrt(8x)')).toEqual(spec('cbrt', '1', '8'))
    // the denominator of a reciprocal is inside
    expect(read('1/(2(x-1))')).toEqual(spec('reciprocal', '1', '2', '1'))
    expect(read('3/(2x - 2) + 1')).toEqual(spec('reciprocal', '3', '2', '1', '1'))
    expect(read('3/(-x)')).toEqual(spec('reciprocal', '3', '-1'))
    expect(read('(1/2)/x')).toEqual(spec('reciprocal', '1/2'))
    expect(read('1/(2(x-1)^2)')).toEqual(spec('reciprocal2', '1/2', '1', '1'))
  })

  it('normalises b > 0 for the even parents only', () => {
    expect(read('|3 - x|')).toEqual(spec('absolute', '1', '1', '3'))
    expect(read('|-2x|')).toEqual(spec('absolute', '1', '2'))
    expect(read('(-2x)^2')).toEqual(spec('quadratic', '1', '2'))
    expect(read('(3 - x)^2 + 1')).toEqual(spec('quadratic', '1', '1', '3', '1'))
    expect(read('1/(1 - x)^2')).toEqual(spec('reciprocal2', '1', '1', '1'))
    expect(read('cos(-2x)')).toEqual(spec('cos', '1', '2'))
    // odd / no symmetry: the sign is the teacher's
    expect(read('sqrt(-x)')).toEqual(spec('sqrt', '1', '-1'))
    expect(read('(-x)^3')).toEqual(spec('cubic', '1', '-1'))
    expect(read('sin(-x)')).toEqual(spec('sin', '1', '-1'))
    expect(read('1/(2 - x)')).toEqual(spec('reciprocal', '1', '-1', '2'))
  })

  it('reads a quadratic in standard or factored form in vertex form', () => {
    expect(read('x^2 - 6x + 8')).toEqual(spec('quadratic', '1', '1', '3', '-1'))
    expect(read('(x-2)(x-4)')).toEqual(spec('quadratic', '1', '1', '3', '-1'))
    expect(read('y = 2x^2 + 4x')).toEqual(spec('quadratic', '2', '1', '-1', '-2'))
    expect(read('-x^2 + 3x')).toEqual(spec('quadratic', '-1', '1', '3/2', '9/4'))
    expect(read('3x^2 - 2x + 1')).toEqual(spec('quadratic', '3', '1', '1/3', '2/3'))
    expect(read('y = 0.5x^2 - x')).toEqual(spec('quadratic', '0.5', '1', '1', '-0.5'))
    expect(read('x*x + 1')).toEqual(spec('quadratic', '1', '1', '0', '1'))
  })

  it('reads a line in slope-intercept form, however it is written', () => {
    expect(read('2(x - 3) + 1')).toEqual(spec('linear', '2', '1', '0', '-5'))
    expect(read('x')).toEqual(spec('linear', '1'))
    expect(read('3 + 2x - x')).toEqual(spec('linear', '1', '1', '0', '3'))
  })

  it('reads a cubic that is a(x − h)³ + k, and no other', () => {
    expect(read('x^3 - 3x^2 + 3x - 1')).toEqual(spec('cubic', '1', '1', '1', '0'))
    expect(read('2x^3 + 6x^2 + 6x + 5')).toEqual(spec('cubic', '2', '1', '-1', '3'))
    expect(read('x^3 - x')).toBeNull()
  })

  it('refuses anything that is not one parent', () => {
    for (const src of [
      'x^2 + |x|', 'sin(x) + cos(x)', 'x*sin(x)', '|x|*x', 'sqrt(x^2 + 1)', 'sin(x^2)',
      '3^x', 'log_3(x)', 'log(x)', 'x^4', '1/x^3', '5', 'y = 5', 'a x^2', 'x^2 + y',
      'sqrt(x)^2', '2^x + 2^(2x)', 'y = x^2 {x > 0}', 'floor(x) + floor(x/2)', 'x^2 = 4', '',
    ]) {
      expect(read(src), src).toBeNull()
    }
  })

  it('verifies the reading numerically against the typed body', () => {
    for (const src of ['-2(x-3)^2+1', '|2x-6|+1', 'sqrt(4-x)', '1/(x+2) - 3', 'x^2 - 6x + 8', 'ln(3 - x) + 1', 'tan(2x) - 1']) {
      const s = read(src)!
      const f = fnOf(src)
      for (const x of xsFor(s)) expect(f(x)).toBeCloseTo(formula(s, x), 9)
    }
  })

  it('round-trips every parent through its canonical source', () => {
    const reps: [ParentId, string, string, string, string][] = [
      ['linear', '2', '1', '0', '3'],
      ['quadratic', '-2', '1', '3', '1'],
      ['cubic', '1/2', '2', '-1', '0'],
      ['absolute', '3', '2', '3', '1'],
      ['sqrt', '2', '-1', '1', '3'],
      ['cbrt', '-1', '8', '0', '2'],
      ['reciprocal', '3', '1', '2', '1'],
      ['reciprocal2', '-1', '2', '1', '-1'],
      ['exp2', '-1', '1', '-1', '4'],
      ['expe', '2', '-1/2', '0', '1'],
      ['log2', '1', '1', '1', '-2'],
      ['ln', '-2', '-1', '3', '0'],
      ['sin', '3', '2', 'pi/4', '1'],
      ['cos', '-1/2', 'pi/6', '1', '0'],
      ['tan', '1', '1/2', '-pi/2', '0'],
      ['floor', '2', '1', '1', '3'],
    ]
    for (const [id, a, b, h, k] of reps) {
      for (const s of [spec(id, '1'), spec(id, a, b, h, k)]) {
        const src = transformSource(s)
        const got = read(src)
        expectSameSpec(got, s, src)
        if (id !== 'linear') expect(got, src).toEqual(s) // text kept exactly
      }
    }
  })

  it('round-trips 200 random specs across all parents (property)', () => {
    const rng = makeRng(20260925)
    const pick = <T>(xs: T[]): T => xs[Math.floor(rng() * xs.length)]
    const A = ['1', '-1', '2', '-3', '1/2', '-2/3', '3/2', '0.5']
    const B = ['1', '-1', '2', '-2', '1/2', '3', '-1/3']
    const H = ['0', '1', '-2', '3', '1/2', '-5/2']
    const HT = ['0', 'pi/4', '-pi/3', '1', 'pi']
    const K = ['0', '1', '-4', '2/3', '-1/2']
    for (let i = 0; i < 200; i++) {
      const id = IDS[i % IDS.length]
      const trig = id === 'sin' || id === 'cos' || id === 'tan'
      const s = spec(id, pick(A), pick(B), pick(trig ? HT : H), pick(K))
      const src = expectParses(s)
      const got = read(src)
      expectSameSpec(got, s, src)
      if (got) {
        // the read-back spec is itself the same function
        const f = fnOf(src)
        for (const x of xsFor(got)) expect(formula(got, x)).toBeCloseTo(f(x), 8)
        // and a second round trip is the identity
        expect(read(transformSource(got)), src).toEqual(got)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// describe
// ---------------------------------------------------------------------------

group('describe', () => {
  it('lists b, then h, then a, then k — identity steps omitted', () => {
    const s = spec('sqrt', '-3', '-2', '1', '-4')
    expect(sentences(s)).toEqual([
      'horizontal compression by a factor of 1/2',
      'reflection across the y-axis',
      'shift right 1',
      'vertical stretch by a factor of 3',
      'reflection across the x-axis',
      'shift down 4',
    ])
    expect(kinds(s)).toEqual(['h-compress', 'reflect-y', 'shift-h', 'v-stretch', 'reflect-x', 'shift-v'])
  })

  it('says each step the textbook way', () => {
    expect(sentences(spec('quadratic', '-2', '1', '3', '1'))).toEqual([
      'shift right 3', 'vertical stretch by a factor of 2', 'reflection across the x-axis', 'shift up 1',
    ])
    expect(sentences(spec('absolute', '1/3', '1/3', '-2'))).toEqual([
      'horizontal stretch by a factor of 3', 'shift left 2', 'vertical compression by a factor of 1/3',
    ])
    expect(sentences(spec('sin', '1', '2', 'pi/4'))).toEqual([
      'horizontal compression by a factor of 1/2', 'shift right π/4',
    ])
    expect(sentences(spec('cos', '1', 'pi/6'))).toEqual(['horizontal stretch by a factor of 6/π'])
    expect(sentences(spec('ln', '1', '-1'))).toEqual(['reflection across the y-axis'])
    expect(sentences(spec('exp2', '1', '1', '0', '-1/2'))).toEqual(['shift down 1/2'])
    expect(sentences(spec('cubic', 'sqrt(2)'))).toEqual(['vertical stretch by a factor of √2'])
    expect(sentences(spec('quadratic', '1'))).toEqual([])
  })

  it('describes what readTransform read', () => {
    expect(sentences(read('y = -2(x-3)^2 + 1')!)).toEqual([
      'shift right 3', 'vertical stretch by a factor of 2', 'reflection across the x-axis', 'shift up 1',
    ])
    expect(sentences(read('sqrt(4 - x)')!)).toEqual(['reflection across the y-axis', 'shift right 4'])
  })
})

// ---------------------------------------------------------------------------
// mapPoints
// ---------------------------------------------------------------------------

group('mapPoints', () => {
  const images = (s: TransformSpec) => mapPoints(s).map((m) => `(${m.toText.join(', ')})`)

  it('maps (x, y) → (x/b + h, a·y + k)', () => {
    const m = mapPoints(spec('sqrt', '2', '1', '1', '3'))
    expect(m.find((p) => p.from.x === 4)!.to).toEqual({ x: 5, y: 7 })
    expect(images(spec('sqrt', '2', '1', '1', '3'))).toEqual(['(1, 3)', '(2, 5)', '(5, 7)', '(10, 9)'])
    expect(images(spec('quadratic', '-2', '1', '3', '1'))).toEqual(['(1, −7)', '(2, −1)', '(3, 1)', '(4, −1)', '(5, −7)'])
    expect(images(spec('sqrt', '1', '-1', '1'))).toEqual(['(1, 0)', '(0, 1)', '(−3, 2)', '(−8, 3)'])
    expect(images(spec('reciprocal', '1', '2'))).toEqual(['(−1, −1/2)', '(−1/2, −1)', '(−1/4, −2)', '(1/4, 2)', '(1/2, 1)', '(1, 1/2)'])
    for (const s of [spec('cbrt', '-1/2', '3', '1', '2'), spec('log2', '3', '-2', '1/2', '1'), spec('tan', '2', '1/2', 'pi', '1')]) {
      for (const p of mapPoints(s)) {
        expect(p.to.x).toBeCloseTo(p.from.x / val(s.b) + val(s.h), 12)
        expect(p.to.y).toBeCloseTo(val(s.a) * p.from.y + val(s.k), 12)
        expect(formula(s, p.to.x)).toBeCloseTo(p.to.y, 9) // on the curve
      }
    }
  })

  it('writes π and e exactly', () => {
    expect(images(spec('sin', '3', '2', 'pi/4', '1'))).toEqual(['(π/4, 1)', '(π/2, 4)', '(3π/4, 1)', '(π, −2)', '(5π/4, 1)'])
    expect(images(spec('cos', '1', 'pi/6'))).toEqual(['(0, 1)', '(3, 0)', '(6, −1)', '(9, 0)', '(12, 1)'])
    expect(images(spec('tan', '1', '1', '1'))).toEqual(['(−π/4 + 1, −1)', '(1, 0)', '(π/4 + 1, 1)'])
    expect(images(spec('expe', '2', '1', '0', '1'))).toEqual(['(0, 3)', '(1, 2e + 1)'])
    expect(images(spec('ln', '1', '2', '1'))).toEqual(['(3/2, 0)', '(e/2 + 1, 1)'])
    expect(images(spec('absolute', 'sqrt(2)'))).toEqual(['(−2, 2√2)', '(−1, √2)', '(0, 0)', '(1, √2)', '(2, 2√2)'])
  })

  it('keeps the parent point with its text', () => {
    const m = mapPoints(spec('sin', '1'))
    expect(m.map((p) => p.fromText)).toEqual([['0', '0'], ['π/2', '1'], ['π', '0'], ['3π/2', '−1'], ['2π', '0']])
    expect(m.map((p) => p.toText)).toEqual(m.map((p) => p.fromText))
  })
})

// ---------------------------------------------------------------------------
// transformFeatures
// ---------------------------------------------------------------------------

group('transformFeatures', () => {
  const feats = (s: TransformSpec) => {
    const f = transformFeatures(s)
    return [f.domain, f.range, f.asymptotes, f.anchor && `${f.anchor.name} (${f.anchor.xText}, ${f.anchor.yText})`]
  }

  it('derives each family’s domain, range, asymptotes and anchor', () => {
    expect(feats(spec('linear', '2', '1', '0', '3'))).toEqual(['all real numbers', 'all real numbers', '', 'reference point (0, 3)'])
    expect(feats(spec('quadratic', '-2', '1', '3', '1'))).toEqual(['all real numbers', 'y ≤ 1', '', 'vertex (3, 1)'])
    expect(feats(spec('cubic', '2', '1', '-1', '3'))).toEqual(['all real numbers', 'all real numbers', '', 'inflection point (−1, 3)'])
    expect(feats(spec('absolute', '1', '2', '3', '-1'))).toEqual(['all real numbers', 'y ≥ −1', '', 'vertex (3, −1)'])
    expect(feats(spec('sqrt', '1', '-1', '1'))).toEqual(['x ≤ 1', 'y ≥ 0', '', 'starting point (1, 0)'])
    expect(feats(spec('sqrt', '-2', '1', '-3', '4'))).toEqual(['x ≥ −3', 'y ≤ 4', '', 'starting point (−3, 4)'])
    expect(feats(spec('cbrt', '1', '8', '2'))).toEqual(['all real numbers', 'all real numbers', '', 'inflection point (2, 0)'])
    expect(feats(spec('reciprocal', '3', '1', '2', '1'))).toEqual(['x ≠ 2', 'y ≠ 1', 'x = 2, y = 1', 'center (2, 1)'])
    expect(feats(spec('reciprocal2', '-1', '1', '-1', '2'))).toEqual(['x ≠ −1', 'y < 2', 'x = −1, y = 2', 'center (−1, 2)'])
    expect(feats(spec('exp2', '-1', '1', '-1', '4'))).toEqual(['all real numbers', 'y < 4', 'y = 4', 'key point (−1, 3)'])
    expect(feats(spec('expe', '2', '1', '0', '1'))).toEqual(['all real numbers', 'y > 1', 'y = 1', 'key point (0, 3)'])
    expect(feats(spec('log2', '1', '1', '1', '-2'))).toEqual(['x > 1', 'all real numbers', 'x = 1', 'key point (2, −2)'])
    expect(feats(spec('ln', '1', '-1', '3'))).toEqual(['x < 3', 'all real numbers', 'x = 3', 'key point (2, 0)'])
    expect(feats(spec('sin', '3', '2', 'pi/4', '1'))).toEqual(['all real numbers', '−2 ≤ y ≤ 4', '', 'cycle start (π/4, 1)'])
    expect(feats(spec('cos', '-2', '1', '0', '1/2'))).toEqual(['all real numbers', '−3/2 ≤ y ≤ 5/2', '', 'cycle start (0, −3/2)'])
    expect(feats(spec('tan', '1', '2'))).toEqual(['x ≠ π/4 + nπ/2', 'all real numbers', 'x = π/4 + nπ/2', 'inflection point (0, 0)'])
    expect(feats(spec('tan', '1', '1', 'pi/2'))).toEqual(['x ≠ nπ', 'all real numbers', 'x = nπ', 'inflection point (π/2, 0)'])
    expect(feats(spec('floor', '2', '1', '1', '3'))).toEqual(['all real numbers', 'y = 2n + 1', '', 'step endpoint (1, 3)'])
    expect(feats(spec('floor', '-1', '2', '0', '4'))[1]).toBe('all integers')
    expect(feats(spec('floor', '1/2'))[1]).toBe('y = n/2')
  })

  it('works from a read spec: the vertex of a standard-form quadratic', () => {
    const f = transformFeatures(read('x^2 - 6x + 8')!)
    expect(f.anchor).toEqual({ name: 'vertex', x: 3, y: -1, xText: '3', yText: '−1' })
    expect(f.range).toBe('y ≥ −1')
    const g = transformFeatures(read('y = -2(x - 3)^2 + 1')!)
    expect(g.anchor).toMatchObject({ name: 'vertex', x: 3, y: 1 })
  })

  it('gives nothing for a spec that is not a function', () => {
    expect(transformFeatures(spec('sqrt', '1', '0'))).toEqual({ domain: '', range: '', asymptotes: '', anchor: null })
    expect(mapPoints(spec('sqrt', '1', 'q'))).toEqual([])
    expect(describe(spec('sqrt', '0'))).toEqual([])
  })
})

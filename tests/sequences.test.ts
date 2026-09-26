// ============================================================================
// tests/sequences.test.ts — sequences and series (src/core/sequences.ts).
//
// The shapes a teacher types (explicit, recursive with one or two previous
// terms, a list, an index range), the terms they produce, the classification
// with its textbook formulas, the series sentences, the continuous partner
// through every (n, aₙ), and the builder's sources round-tripping.
// ============================================================================

import { describe, it, expect } from 'vitest'
import { parseExpression } from '../src/core/parse'
import {
  classify,
  parseSequence,
  partialSums,
  partnerSource,
  sequenceSource,
  seriesInfo,
  terms,
  type SeqClass,
  type SequenceDef,
} from '../src/core/sequences'
import { makeRng } from './helpers'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function seq(src: string): SequenceDef {
  const r = parseSequence(src)
  if (!r.ok) throw new Error(`expected "${src}" to parse, got: ${r.error}`)
  return r.seq
}

function err(src: string): { error: string; pos?: number } {
  const r = parseSequence(src)
  if (r.ok) throw new Error(`expected "${src}" to be refused`)
  return r
}

function first(src: string, count = 8, params?: number[]): number[] {
  const s = seq(src)
  return terms(s, params ?? s.defaultParams, s.start, count)
}

function close(a: number[], b: number[], tol = 1e-9): void {
  expect(a.length).toBe(b.length)
  a.forEach((v, i) => {
    if (Number.isNaN(b[i])) expect(v).toBeNaN()
    else expect(Math.abs(v - b[i])).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b[i])))
  })
}

/** The partner curve evaluated at x. */
function partnerAt(src: string): (x: number) => number {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(`partner "${src}" does not parse: ${o.error}`)
  const m = o.plot.makeModel('partner')
  const p = o.plot.defaultParams
  return (x) => m.evalExplicit!(p, x)
}

function partnerPasses(values: number[], n0 = 1): SeqClass {
  const cls = classify(values, n0)
  const src = partnerSource(cls)
  expect(src).not.toBeNull()
  const f = partnerAt(src!)
  values.forEach((v, i) => {
    expect(Math.abs(f(n0 + i) - v)).toBeLessThanOrEqual(1e-8 * Math.max(1, Math.abs(v)))
  })
  return cls
}

// ---------------------------------------------------------------------------
// parse: every form
// ---------------------------------------------------------------------------

describe('parseSequence — explicit', () => {
  it('reads a_n = …, a(n) = …, b_n = …', () => {
    const a = seq('a_n = 3 + 2(n - 1)')
    expect(a.kind).toBe('explicit')
    expect(a.name).toBe('a')
    expect(a.start).toBe(1)
    expect(a.range).toBeNull()
    expect(a.latex).toBe('a_{n}=3+2\\left(n-1\\right)')
    close(terms(a, [], 1, 5), [3, 5, 7, 9, 11])

    const g = seq('a(n) = 5(0.8)^(n-1)')
    expect(g.kind).toBe('explicit')
    close(terms(g, [], 1, 4), [5, 4, 3.2, 2.56])
    expect(g.latex).toBe('a\\left(n\\right)=5\\left(0.8\\right)^{n-1}')

    const b = seq('b_n = n^2')
    expect(b.name).toBe('b')
    close(terms(b, [], 1, 4), [1, 4, 9, 16])
  })

  it('accepts a_{n}, a_(n), Unicode aₙ and the index letter k', () => {
    close(first('a_{n} = 2n', 3), [2, 4, 6])
    close(first('a_(n) = 2n', 3), [2, 4, 6])
    close(first('aₙ = 2n', 3), [2, 4, 6])
    close(first('b_k = k^2 + 1', 3), [2, 5, 10])
  })

  it('a_n = (−1)^n/n alternates and shrinks', () => {
    close(first('a_n = (-1)^n/n', 4), [-1, 1 / 2, -1 / 3, 1 / 4])
  })

  it('free letters other than n are sliders, in order of appearance', () => {
    const s = seq('a_n = a + d(n-1)')
    expect(s.paramNames).toEqual(['a', 'd'])
    expect(s.defaultParams).toEqual([1, 1])
    close(terms(s, [3, 4], 1, 4), [3, 7, 11, 15])
  })

  it('x, y, r and t are sliders too inside a sequence (a_n = a r^(n−1))', () => {
    const s = seq('a_n = a r^(n-1)')
    expect(s.paramNames).toEqual(['a', 'r'])
    expect(s.latex).toBe('a_{n}=a\\,r^{n-1}')
    close(terms(s, [5, 0.8], 1, 3), [5, 4, 3.2])
  })

  it('a non-integer n has no term', () => {
    expect(seq('a_n = 2n').term([], 1.5)).toBeNaN()
  })

  it('a given term with an explicit rule stands as typed', () => {
    close(first('a_1 = 3, a_n = a_1 + 4(n - 1)', 4), [3, 7, 11, 15])
  })
})

describe('parseSequence — recursive', () => {
  it('a_1 = 3, a_(n+1) = a_n + 4', () => {
    const s = seq('a_1 = 3, a_(n+1) = a_n + 4')
    expect(s.kind).toBe('recursive')
    expect(s.start).toBe(1)
    expect(s.latex).toBe('a_{1}=3,\\ a_{n+1}=a_{n}+4')
    close(terms(s, [], 1, 5), [3, 7, 11, 15, 19])
  })

  it('the rule first, the starting term after, joined by "," or "with"', () => {
    close(first('a_n = a_(n-1) + 4, a_1 = 3', 3), [3, 7, 11])
    const s = seq('a_n = 2a_(n-1) with a_0 = 5')
    expect(s.start).toBe(0)
    close(terms(s, [], 0, 4), [5, 10, 20, 40])
    expect(s.latex).toBe('a_{n}=2a_{n-1},\\ a_{0}=5')
  })

  it('a_0 = 1, a_(n+1) = 2a_n + 1', () => {
    const s = seq('a_0 = 1, a_(n+1) = 2a_n + 1')
    expect(s.start).toBe(0)
    close(terms(s, [], 0, 5), [1, 3, 7, 15, 31])
    expect(s.term([], -1)).toBeNaN()
  })

  it('Fibonacci, chained or separate starting terms', () => {
    const fib = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55]
    close(first('a_1 = a_2 = 1, a_(n+2) = a_(n+1) + a_n', 10), fib)
    close(first('a_1 = 1, a_2 = 1, a_n = a_(n-1) + a_(n-2)', 10), fib)
    expect(seq('a_1 = a_2 = 1, a_(n+2) = a_(n+1) + a_n').latex).toBe(
      'a_{1}=a_{2}=1,\\ a_{n+2}=a_{n+1}+a_{n}',
    )
  })

  it('Unicode subscripts, function notation, the a_n+1 shorthand on the left', () => {
    close(first('aₙ₊₁ = 2aₙ, a₁ = 3', 4), [3, 6, 12, 24])
    close(first('a(n) = a(n-1) + 3, a(1) = 2', 4), [2, 5, 8, 11])
    close(first('a_n+1 = a_n + 2, a_1 = 0', 4), [0, 2, 4, 6])
    close(first('a_{n+1} = a_{n} - 1, a_{1} = 10', 3), [10, 9, 8])
  })

  it('the rule may use n and sliders; a starting term may be a slider', () => {
    close(first('a_1 = 1, a_(n+1) = a_n + n', 5), [1, 2, 4, 7, 11])
    const s = seq('a_1 = c, a_(n+1) = r a_n')
    expect(s.paramNames).toEqual(['c', 'r'])
    close(terms(s, [2, 3], 1, 4), [2, 6, 18, 54])
  })

  it('memoised per slider vector; iteration capped at 10 000 terms', () => {
    const s = seq('a_1 = 1, a_(n+1) = a_n + d')
    expect(s.term([2], 5000)).toBe(1 + 2 * 4999)
    expect(s.term([3], 5000)).toBe(1 + 3 * 4999)
    expect(s.term([3], 10_000)).toBe(1 + 3 * 9999)
    expect(s.term([3], 10_001)).toBeNaN()
  })

  it('NaN or overflow stops the iteration', () => {
    const s = seq('a_1 = 2, a_(n+1) = a_n^2')
    const t = terms(s, [], 1, 15)
    expect(t[0]).toBe(2)
    expect(t[4]).toBe(65536)
    expect(t[14]).toBeNaN()
    expect(s.term([], 20)).toBeNaN()
    const q = seq('a_1 = 1, a_(n+1) = sqrt(a_n - 2)')
    expect(q.term([], 2)).toBeNaN()
    expect(q.term([], 3)).toBeNaN()
  })
})

describe('parseSequence — lists and ranges', () => {
  it('a comma list, with or without …', () => {
    const s = seq('3, 7, 11, 15, …')
    expect(s.kind).toBe('list')
    expect(s.start).toBe(1)
    close(terms(s, [], 1, 6), [3, 7, 11, 15, NaN, NaN])
    expect(s.latex).toBe('3,\\ 7,\\ 11,\\ 15,\\ \\ldots')
    close(first('3, 7, 11, 15...', 4), [3, 7, 11, 15])
    close(first('1/2, 1/4, 1/8', 3), [0.5, 0.25, 0.125])
  })

  it('{1 <= n <= 20}, for n = 1 to 20, a comparison part, a one-sided range', () => {
    const a = seq('a_n = 3 + 2(n-1) {1 <= n <= 20}')
    expect(a.range).toEqual([1, 20])
    expect(a.latex).toContain('\\left\\{1 \\leq n \\leq 20\\right\\}')
    expect(seq('a_n = n for n = 1 to 5').range).toEqual([1, 5])
    expect(seq('u_n = 3 + 2(n - 1), 1 <= n <= 10').range).toEqual([1, 10])
    expect(seq('a_n = n^2 {0 <= n < 6}').range).toEqual([0, 5])
    const one = seq('a_n = 1/n {n >= 0}')
    expect(one.range).toBeNull()
    expect(one.start).toBe(0)
    expect(seq('a_1 = 3, a_(n+1) = a_n + 4 {1 <= n <= 8}').range).toEqual([1, 8])
  })
})

describe('parseSequence — errors in teacher words', () => {
  it('a recursion needs its starting terms', () => {
    expect(err('a_(n+1) = a_n + 4').error).toBe('A recursive sequence needs a starting term, e.g. a_1 = 3')
    expect(err('a_(n+2) = a_(n+1) + a_n, a_1 = 1').error).toMatch(/needs two starting terms, e.g. a_1 = 1, a_2 = 1/)
    expect(err('a_1 = 1, a_3 = 1, a_(n+2) = a_(n+1) + a_n').error).toMatch(/next to each other/)
  })

  it('only the previous one or two terms', () => {
    const e = err('a_1 = 1, a_2 = 1, a_(n+1) = a_(n-1) + a_(n-2)')
    expect(e.error).toBe('a_(n+1) can only use a_n and a_(n-1)')
    expect(e.pos).toBe('a_1 = 1, a_2 = 1, a_(n+1) = a_(n-1) + '.length)
    expect(err('a_1 = 1, a_(n+1) = a_(n+1) + 1').error).toBe('a_(n+1) can only use a_n and a_(n-1)')
  })

  it('n must be a whole number', () => {
    expect(err('a_1.5 = 3, a_(n+1) = a_n').error).toMatch(/^n must be a whole number/)
    expect(err('a_n = n {1.5 <= n <= 4}').error).toMatch(/^n must be a whole number/)
    expect(err('a_(n+0.5) = a_n, a_1 = 1').error).toMatch(/^n must be a whole number/)
  })

  it('not a sequence at all: curves, functions, a lone number', () => {
    for (const s of ['y = 2x + 1', 'f(x) = x^2', '5', 'x^2 + y^2 = 4', 'a[n] = 2n']) {
      expect(err(s).error).toMatch(/^Not a sequence/)
    }
  })

  it('other mistakes, positioned', () => {
    expect(err('a_1 = 3, a_(n+1) = a_n + b_n').error).toMatch(/different sequence/)
    expect(err('a_1 = 3, a_(n+1) = a_n + b_n').pos).toBe('a_1 = 3, a_(n+1) = a_n + '.length)
    expect(err('a_n = 2n + ').error).toMatch(/Unexpected end/)
    expect(err('a_1 = 3').error).toMatch(/add the rule/)
    expect(err('a_1 = 3, a_1 = 4, a_(n+1) = a_n').error).toMatch(/given twice/)
    expect(err('a_1 = n, a_(n+1) = a_n').error).toMatch(/cannot use n/)
    expect(err('3, …, 11').error).toMatch(/can only end the list/)
    expect(err('3, x, 11').error).toMatch(/only hold numbers/)
    expect(err('a_n = 2n, b_1 = 3').error).toMatch(/same sequence/)
    expect(err('a_n = n {0 <= k <= 3}').error).toMatch(/must use n/)
    expect(err('a_1 = 1, a_n = a_3 + n').error).toMatch(/a_3 is not given/)
  })

  it('an error position points into the typed line, Unicode included', () => {
    const e = err('aₙ₊₁ = aₙ + ')
    expect(e.pos).toBeLessThanOrEqual('aₙ₊₁ = aₙ + '.length)
  })
})

// ---------------------------------------------------------------------------
// classify
// ---------------------------------------------------------------------------

describe('classify', () => {
  const table: [string, number[], Partial<Record<string, unknown>>][] = [
    ['arithmetic', [3, 7, 11, 15], { d: 4, a1Text: '3', dText: '4', explicit: 'aₙ = 3 + 4(n − 1)', recursive: 'a₁ = 3, aₙ₊₁ = aₙ + 4' }],
    ['arithmetic', [10, 7, 4, 1], { d: -3, dText: '−3', explicit: 'aₙ = 10 − 3(n − 1)', recursive: 'a₁ = 10, aₙ₊₁ = aₙ − 3' }],
    ['arithmetic', [1 / 3, 2 / 3, 1], { a1Text: '1/3', dText: '1/3', explicit: 'aₙ = 1/3 + (1/3)(n − 1)' }],
    ['arithmetic', [5, 5, 5, 5], { d: 0, explicit: 'aₙ = 5', recursive: 'a₁ = 5, aₙ₊₁ = aₙ' }],
    ['geometric', [5, 4, 3.2, 2.56], { r: 0.8, rText: '0.8', explicit: 'aₙ = 5·0.8ⁿ⁻¹', recursive: 'a₁ = 5, aₙ₊₁ = 0.8aₙ' }],
    ['geometric', [10, 5, 2.5, 1.25], { rText: '1/2', explicit: 'aₙ = 10(1/2)ⁿ⁻¹', recursive: 'a₁ = 10, aₙ₊₁ = (1/2)aₙ' }],
    ['geometric', [3, -6, 12, -24], { r: -2, rText: '−2', explicit: 'aₙ = 3(−2)ⁿ⁻¹', recursive: 'a₁ = 3, aₙ₊₁ = −2aₙ' }],
    ['geometric', [1, 2, 4, 8], { explicit: 'aₙ = 2ⁿ⁻¹' }],
    ['quadratic', [1, 4, 9, 16], { coef: [1, 0, 0], explicit: 'aₙ = n²', recursive: 'a₁ = 1, aₙ₊₁ = aₙ + 2n + 1' }],
    ['quadratic', [2, 6, 12, 20, 30], { coef: [1, 1, 0], explicit: 'aₙ = n² + n' }],
    ['none', [1, 1, 2, 3, 5], {}],
    ['none', [1, 2], {}], // two terms: any two numbers have a d and an r
    ['none', [1, 4, 9], {}], // three terms: any three have one second difference
    ['none', [1, 0, 1, 0], {}],
    ['none', [1, NaN, 3], {}],
  ]
  for (const [kind, values, want] of table) {
    it(`${values.join(', ')} → ${kind}`, () => {
      const c = classify(values) as Record<string, unknown>
      expect(c.kind).toBe(kind)
      for (const [k, v] of Object.entries(want)) {
        if (typeof v === 'number') expect(c[k] as number).toBeCloseTo(v, 12)
        else expect(c[k]).toEqual(v)
      }
    })
  }

  it('a1 is the term at n = 1 even when the terms start at n = 0', () => {
    const c = classify([5, 10, 20, 40], 0)
    expect(c.kind).toBe('geometric')
    if (c.kind !== 'geometric') return
    expect(c.a1).toBe(10)
    expect(c.explicit).toBe('aₙ = 5·2ⁿ')
    expect(c.recursive).toBe('a₀ = 5, aₙ₊₁ = 2aₙ')
    const a = classify([5, 9, 13], 0)
    expect(a.kind === 'arithmetic' && a.explicit).toBe('aₙ = 5 + 4n')
  })

  it('tolerates roundoff at 1e-9 relative, not a real difference', () => {
    expect(classify([0.1, 0.2, 0.30000000000000004, 0.4]).kind).toBe('arithmetic')
    expect(classify([1, 2, 3.0001, 4]).kind).toBe('none')
  })
})

// ---------------------------------------------------------------------------
// series
// ---------------------------------------------------------------------------

describe('seriesInfo', () => {
  const info = (src: string, params?: number[]) => {
    const s = seq(src)
    return seriesInfo(s, params ?? s.defaultParams)
  }

  it('geometric with r = 1/2 converges to 20', () => {
    const i = info('a_n = 10(1/2)^(n-1)')
    expect(i.converges).toBe(true)
    expect(i.sum!.value).toBeCloseTo(20, 12)
    expect(i.sum!.text).toBe('10/(1 − 1/2) = 20')
    expect(i.closedForm).toBe('Sₙ = 10(1 − (1/2)ⁿ)/(1 − 1/2) = 20(1 − (1/2)ⁿ)')
    expect(i.sentence).toMatch(/\|r\| = 1\/2 < 1, so the series converges/)
    // the same from a recursion
    expect(info('a_1 = 10, a_(n+1) = a_n/2').sum!.text).toBe('10/(1 − 1/2) = 20')
  })

  it('2ⁿ diverges, with the reason', () => {
    const i = info('a_n = 2^n')
    expect(i.converges).toBe(false)
    expect(i.sum).toBeNull()
    expect(i.sentence).toMatch(/\|r\| = 2 ≥ 1/)
    expect(i.sentence).toMatch(/diverges/)
  })

  it('harmonic-like: no conclusion from the nth-term test', () => {
    for (const s of ['a_n = 1/n', 'a_n = (-1)^n/n', 'a_n = 1/sqrt(n)']) {
      const i = info(s)
      expect(i.converges).toBeNull()
      expect(i.sentence).toMatch(/no conclusion from the nth-term test/)
    }
  })

  it('terms that do not approach 0 diverge by the nth-term test', () => {
    for (const s of ['a_n = n/(n+1)', 'a_n = sin(n)', 'a_n = n^3 - n']) {
      const i = info(s)
      expect(i.converges).toBe(false)
      expect(i.sentence).toMatch(/do not approach 0/)
    }
  })

  it('arithmetic: Sₙ in closed form; diverges unless every term is 0', () => {
    const i = info('a_n = 3 + 4(n-1)')
    expect(i.closedForm).toBe('Sₙ = n/2·(2a₁ + (n − 1)d) = 2n² + n')
    expect(i.converges).toBe(false)
    const z = info('a_n = 0n')
    expect(z.converges).toBe(true)
  })

  it('the closed forms agree with partial sums', () => {
    const s = seq('a_n = 3 + 4(n-1)')
    const sums = partialSums(terms(s, [], 1, 10))
    sums.forEach((v, i) => expect(v).toBe(2 * (i + 1) ** 2 + (i + 1)))
    const g = seq('a_n = 10(1/2)^(n-1)')
    partialSums(terms(g, [], 1, 10)).forEach((v, i) => expect(v).toBeCloseTo(20 * (1 - 0.5 ** (i + 1)), 12))
  })

  it('a finite list adds up; an open list with a pattern follows it', () => {
    const f = info('3, 7, 11')
    expect(f.converges).toBe(true)
    expect(f.sum!.value).toBe(21)
    const o = info('8, 4, 2, 1, …')
    expect(o.sum!.text).toBe('8/(1 − 1/2) = 16')
    expect(info('1, 5, 2, 8, …').sentence).toMatch(/no conclusion/)
  })

  it('undefined early terms are said so', () => {
    expect(info('a_n = 1/(n - 2)').converges).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// partner
// ---------------------------------------------------------------------------

describe('partnerSource', () => {
  it('arithmetic → the line, geometric → the exponential, quadratic → the parabola', () => {
    expect(partnerSource(classify([3, 7, 11, 15]))).toBe('y = 4x - 1')
    expect(partnerSource(classify([5, 4, 3.2, 2.56]))).toBe('y = 5(0.8)^(x - 1)')
    expect(partnerSource(classify([1, 4, 9, 16]))).toBe('y = x^2')
    expect(partnerSource(classify([1, 1, 2, 3, 5]))).toBeNull()
    expect(partnerSource({ kind: 'none' })).toBeNull()
  })

  it('a negative ratio has no exponential partner', () => {
    expect(partnerSource(classify([3, -6, 12, -24]))).toBeNull()
  })

  it('passes through every (n, aₙ)', () => {
    partnerPasses([3, 7, 11, 15, 19])
    partnerPasses([10, 5, 2.5, 1.25, 0.625])
    partnerPasses([-2, -6, -18, -54])
    partnerPasses([1 / 3, 2 / 3, 1, 4 / 3])
    partnerPasses([2, 6, 12, 20, 30])
    partnerPasses([0.5, 2, 4.5, 8, 12.5])
    partnerPasses([5, 10, 20, 40], 0)
    partnerPasses([5, 9, 13], 0)
  })
})

// ---------------------------------------------------------------------------
// builder
// ---------------------------------------------------------------------------

describe('sequenceSource', () => {
  it('canonical sources', () => {
    expect(sequenceSource({ name: 'a', kind: 'arithmetic', a1: '3', step: '4', form: 'explicit' })).toBe('a_n = 3 + 4(n - 1)')
    expect(sequenceSource({ name: 'a', kind: 'arithmetic', a1: '3', step: '4', form: 'recursive' })).toBe('a_1 = 3, a_(n+1) = a_n + 4')
    expect(sequenceSource({ name: 'b', kind: 'arithmetic', a1: '5', step: '-2', form: 'explicit' })).toBe('b_n = 5 - 2(n - 1)')
    expect(sequenceSource({ name: 'a', kind: 'geometric', a1: '5', step: '0.8', form: 'explicit' })).toBe('a_n = 5(0.8)^(n - 1)')
    expect(sequenceSource({ name: 'a', kind: 'geometric', a1: '10', step: '1/2', form: 'recursive' })).toBe('a_1 = 10, a_(n+1) = (1/2)a_n')
  })

  it('round-trips through parseSequence, both forms giving the same terms', () => {
    const specs = [
      { a1: '3', step: '4' }, { a1: '-3', step: '1/2' }, { a1: '1/2', step: '-2' }, { a1: '0', step: '2.5' },
    ]
    for (const kind of ['arithmetic', 'geometric'] as const) {
      for (const sp of specs) {
        const ex = seq(sequenceSource({ name: 'u', kind, ...sp, form: 'explicit' }))
        const rc = seq(sequenceSource({ name: 'u', kind, ...sp, form: 'recursive' }))
        expect(ex.name).toBe('u')
        expect(rc.kind).toBe('recursive')
        close(terms(rc, [], 1, 8), terms(ex, [], 1, 8))
      }
    }
  })
})

// ---------------------------------------------------------------------------
// property test: 200 random arithmetic / geometric specs
// ---------------------------------------------------------------------------

describe('property: random arithmetic and geometric sequences', () => {
  it('parse → terms → classify → partner agree, for 200 specs in both forms', () => {
    const rng = makeRng(20260926)
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rng() * xs.length)]
    const ints = () => Math.floor(rng() * 41) - 20
    const decs = () => Math.round((rng() * 20 - 10) * 100) / 100
    for (let trial = 0; trial < 200; trial++) {
      const kind = trial % 2 === 0 ? 'arithmetic' : 'geometric'
      let a1 = pick([ints, decs])()
      if (a1 === 0) a1 = 7
      let step: number
      if (kind === 'arithmetic') step = pick([ints, decs])()
      else step = pick([2, 3, -2, -3, 0.5, 0.8, 1.05, 1.5, -0.5, 0.25, 0.9, 4])
      const form = pick(['explicit', 'recursive'] as const)
      const src = sequenceSource({ name: 'a', kind, a1: String(a1), step: String(step), form })
      const s = seq(src)
      const vals = terms(s, [], 1, 8)
      const want = Array.from({ length: 8 }, (_, i) =>
        kind === 'arithmetic' ? a1 + step * i : a1 * Math.pow(step, i),
      )
      close(vals, want, 1e-9)
      const c = classify(vals)
      if (kind === 'arithmetic') {
        expect(c.kind, src).toBe('arithmetic')
        if (c.kind === 'arithmetic') {
          expect(c.d).toBeCloseTo(step, 9)
          expect(c.a1).toBeCloseTo(a1, 9)
        }
      } else {
        expect(c.kind, src).toBe('geometric')
        if (c.kind === 'geometric') {
          expect(c.r).toBeCloseTo(step, 9)
          expect(c.a1).toBeCloseTo(a1, 9)
        }
      }
      const partner = partnerSource(c)
      if (kind === 'geometric' && step < 0) expect(partner).toBeNull()
      else {
        const f = partnerAt(partner!)
        vals.forEach((v, i) => expect(Math.abs(f(i + 1) - v)).toBeLessThanOrEqual(1e-8 * Math.max(1, Math.abs(v))))
      }
      // the other form reads the same sequence
      const other = seq(sequenceSource({ name: 'a', kind, a1: String(a1), step: String(step), form: form === 'explicit' ? 'recursive' : 'explicit' }))
      close(terms(other, [], 1, 8), vals, 1e-9)
    }
  })
})

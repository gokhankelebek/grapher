// ============================================================================
// tests/exact.test.ts — closed forms for the numbers a graph produces
// (src/core/exact.ts).
//
// Two halves, and the second one matters more than the first:
//
//   * the RECOGNITION table — √3, 2√3/9, π/4, (1+√5)/2 — where every expected
//     string is the form a teacher would write on the board;
//   * the FALSE POSITIVES — ln 2, e, a decimal that is only six digits long —
//     where the only correct answer is null. A graphing tool that prints "√2"
//     next to a number that is not √2 has told a class something untrue, and
//     no amount of correct recognition pays that back.
// ============================================================================

import { describe, it, expect } from 'vitest'
import { exactForm, verifiedExact } from '../src/core/exact'

const MINUS = '−'
const RT = '√'
const PI = 'π'

/** text of the recognised form, or null. */
const t = (v: number, tol?: number): string | null => {
  const f = exactForm(v, tol === undefined ? undefined : { tol })
  return f ? f.text : null
}

describe('exactForm — integers and fractions', () => {
  it('recognises integers, with a true minus', () => {
    expect(t(0)).toBe('0')
    expect(t(3)).toBe('3')
    expect(t(-2)).toBe(MINUS + '2')
    expect(t(-2)).not.toBe('-2') // U+2212, not the hyphen
    expect(t(17)).toBe('17')
  })

  it('recognises p/q up to q = 64, always in lowest terms', () => {
    expect(t(1.5)).toBe('3/2')
    expect(t(-1.5)).toBe(MINUS + '3/2')
    expect(t(1 / 3)).toBe('1/3')
    expect(t(2 / 6)).toBe('1/3') // not 2/6
    expect(t(5 / 64)).toBe('5/64')
    expect(t(-7 / 12)).toBe(MINUS + '7/12')
    expect(t(0.7)).toBe('7/10')
    expect(t(-1.25)).toBe(MINUS + '5/4')
  })

  it('stops at q = 64: 1/65 is a decimal and nothing more', () => {
    expect(t(1 / 65)).toBe(null)
    expect(t(13 / 100)).toBe(null)
  })

  it('an integer beats the fraction that equals it', () => {
    expect(t(4)).toBe('4') // never 8/2
    expect(t(-6)).toBe(MINUS + '6')
  })
})

describe('exactForm — square roots', () => {
  it('recognises a√n/b across the shapes a lesson uses', () => {
    expect(t(Math.sqrt(3))).toBe(RT + '3')
    expect(t(2 * Math.sqrt(3))).toBe('2' + RT + '3')
    expect(t(Math.sqrt(3) / 2)).toBe(RT + '3/2')
    expect(t((2 * Math.sqrt(3)) / 9)).toBe('2' + RT + '3/9')
    expect(t(-Math.sqrt(5))).toBe(MINUS + RT + '5')
    expect(t(Math.SQRT2)).toBe(RT + '2')
    expect(t(Math.SQRT1_2)).toBe(RT + '2/2')
    expect(t(Math.sqrt(17) / 4)).toBe(RT + '17/4')
  })

  it('the radicand is always square-free: √12 is 2√3, √8 is 2√2', () => {
    expect(t(Math.sqrt(12))).toBe('2' + RT + '3')
    expect(t(Math.sqrt(8))).toBe('2' + RT + '2')
    expect(t(Math.sqrt(50))).toBe('5' + RT + '2')
    expect(t(Math.sqrt(45) / 3)).toBe(RT + '5')
  })

  it('never emits √1 or √4 — a perfect square is an integer or a fraction', () => {
    const suspects = [1, 2, 3, 4, 0.5, 1.5, -2, 2 / 3, 9, -0.25]
    for (const v of suspects) {
      const f = exactForm(v)
      expect(f, `${v} has a form`).not.toBe(null)
      expect(f!.text, `${v} -> ${f!.text}`).not.toMatch(new RegExp(RT + '(1|4|9|16|25)(?!\\d)'))
      expect(f!.tex, `${v} -> ${f!.tex}`).not.toMatch(/\\sqrt\{(1|4|9|16|25)\}/)
    }
    expect(t(1.5)).toBe('3/2') // 3√1/2 is not a thing
    expect(t(2)).toBe('2') // nor √4
  })

  it('reduces a/b: 2√2/4 is √2/2', () => {
    expect(t((2 * Math.SQRT2) / 4)).toBe(RT + '2/2')
    expect(t((3 * Math.sqrt(7)) / 6)).toBe(RT + '7/2')
  })
})

describe('exactForm — multiples of π', () => {
  it('recognises pπ/q up to q = 24', () => {
    expect(t(Math.PI)).toBe(PI)
    expect(t(Math.PI / 4)).toBe(PI + '/4')
    expect(t(Math.PI / 2)).toBe(PI + '/2')
    expect(t((-3 * Math.PI) / 2)).toBe(MINUS + '3' + PI + '/2')
    expect(t(2 * Math.PI)).toBe('2' + PI)
    expect(t(-Math.PI)).toBe(MINUS + PI)
    expect(t((5 * Math.PI) / 6)).toBe('5' + PI + '/6')
    expect(t(Math.PI / 24)).toBe(PI + '/24')
  })

  it('π wins over a square root that happens to sit nearby', () => {
    // {pπ/q} is a sparse family and {a√n/b} a dense one, so at the loose
    // PROPOSAL tolerance a surd is nearly always available within 1e-6 of a
    // multiple of π — 2π has 13√146/25 three parts in a billion away.
    expect(t(2 * Math.PI)).toBe('2' + PI)
    expect(verifiedExact(2 * Math.PI, () => true)!.text).toBe('2' + PI)
    expect(verifiedExact(Math.PI / 4, () => true)!.text).toBe(PI + '/4')
    expect(verifiedExact(Math.PI / 2, () => true)!.text).toBe(PI + '/2')
  })
})

describe('exactForm — quadratic surds', () => {
  it('recognises (a ± b√n)/c — the roots of a quadratic', () => {
    expect(t((1 + Math.sqrt(5)) / 2)).toBe('(1+' + RT + '5)/2')
    expect(t((1 - Math.sqrt(5)) / 2)).toBe('(1' + MINUS + RT + '5)/2')
    expect(t((-3 - Math.sqrt(17)) / 4)).toBe('(' + MINUS + '3' + MINUS + RT + '17)/4')
    expect(t((1 - Math.SQRT2) / 3)).toBe('(1' + MINUS + RT + '2)/3')
    expect(t((2 - Math.sqrt(19)) / 3)).toBe('(2' + MINUS + RT + '19)/3')
    expect(t((5 + 3 * Math.sqrt(2)) / 7)).toBe('(5+3' + RT + '2)/7')
  })

  it('drops the denominator when c = 1', () => {
    expect(t(1 + Math.sqrt(5))).toBe('1+' + RT + '5')
    expect(t(3 - Math.SQRT2)).toBe('3' + MINUS + RT + '2')
  })

  it('never writes (0 + √5)/2 — that value is a plain square root', () => {
    expect(t(Math.sqrt(5) / 2)).toBe(RT + '5/2')
    expect(t(-Math.sqrt(5) / 2)).toBe(MINUS + RT + '5/2')
    for (const v of [Math.sqrt(5) / 2, Math.sqrt(3) / 4, -Math.SQRT2 / 2]) {
      expect(exactForm(v)!.text).not.toMatch(/\(0/)
    }
  })

  it('reduces a common factor: (2 + 2√5)/4 is (1 + √5)/2', () => {
    expect(t((2 + 2 * Math.sqrt(5)) / 4)).toBe('(1+' + RT + '5)/2')
    expect(t((3 + 3 * Math.sqrt(2)) / 6)).toBe('(1+' + RT + '2)/2')
  })

  it('drops a coefficient of 1 on the radical', () => {
    expect(exactForm((1 + Math.sqrt(5)) / 2)!.text).not.toMatch(/1√/)
  })
})

describe('exactForm — the numbers that must come back null', () => {
  it('ln 2 is not √2, not a fraction and not a multiple of π', () => {
    expect(t(Math.log(2))).toBe(null)
    expect(t(Math.log(3))).toBe(null)
    expect(t(Math.log(10))).toBe(null)
  })

  it('e and its neighbours are not recognised', () => {
    expect(t(Math.E)).toBe(null)
    expect(t(1 / Math.E)).toBe(null)
    expect(t(Math.E * Math.E)).toBe(null)
  })

  it('a decimal that is just a decimal stays one', () => {
    expect(t(0.1234567)).toBe(null)
    expect(t(1.4329)).toBe(null)
    expect(t(2.718)).toBe(null)
    expect(t(-0.4142135)).toBe(null)
  })

  it('but a short decimal that IS a small fraction is one: −3.02 = −151/50', () => {
    // the line between "a decimal" and "a closed form" is the q ≤ 64 table,
    // not how the number looks written down
    expect(t(-3.02)).toBe(MINUS + '151/50')
    expect(t(0.25)).toBe('1/4')
  })

  it('a value given to six digits is NOT claimed as the form it rounds to', () => {
    // 1.414214 is 4.4e-7 away from √2 — a mile, at 1e-11
    expect(t(1.414214)).toBe(null)
    expect(t(0.333333)).toBe(null)
    expect(t(3.141593)).toBe(null)
    expect(t(1.618034)).toBe(null)
  })

  it('twelve digits of 1/3 ARE 1/3 — and are not, at a tighter tolerance', () => {
    expect(t(0.333333333333)).toBe('1/3') // 3.3e-13 away: inside 1e-11
    expect(t(0.333333333333, 1e-14)).toBe(null) // outside 1e-14
    expect(t(1 / 3, 1e-14)).toBe('1/3') // the real thing still matches
  })

  it('NaN and the infinities have no closed form', () => {
    expect(exactForm(Number.NaN)).toBe(null)
    expect(exactForm(Number.POSITIVE_INFINITY)).toBe(null)
    expect(exactForm(Number.NEGATIVE_INFINITY)).toBe(null)
    expect(verifiedExact(Number.NaN, () => true)).toBe(null)
  })
})

describe('exactForm — a complicated form has to fit better', () => {
  // Counting, not taste: there is one integer near any value, 63 fractions,
  // and roughly 1450 quadratic surds. At one flat tolerance the crowded
  // families "recognise" a sketch's numbers thousands of times more often
  // than the simple ones do, and every one of those is a coincidence.

  it('a cheap form keeps the full tolerance', () => {
    expect(t(Math.sqrt(3) + 3e-12)).toBe(RT + '3')
    expect(t(1.5 + 5e-12)).toBe('3/2')
    expect(t(Math.PI / 4 + 3e-12)).toBe(PI + '/4')
    expect(t((1 + Math.sqrt(5)) / 2 + 5e-12)).toBe('(1+' + RT + '5)/2')
  })

  it('an expensive form is charged for its complexity', () => {
    // (−26 + 7√91)/7 costs 26·7·91·7 ≈ 116k, so it is matched ~15000× tighter
    const v = (-26 + 7 * Math.sqrt(91)) / 7
    expect(t(v)).toBe('(' + MINUS + '26+7' + RT + '91)/7') // the number IS that
    expect(t(v + 1e-9)).toBe(null) // a sketch that merely passes nearby is not
    // the cheap form, at the same distance, is also refused — 1e-9 is simply
    // outside 1e-11, and nothing here is being given away
    expect(t(Math.sqrt(3) + 1e-9)).toBe(null)
  })

  it('a value with no form is not given one, 5000 tries running', () => {
    // the property that matters most: numbers off a sketched curve are not
    // closed forms, and must not be dressed as them
    let seed = 987654321
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    let hits = 0
    const examples: string[] = []
    for (let i = 0; i < 5000; i++) {
      const x = rnd() * 12 - 6
      const f = exactForm(x)
      if (f) { hits++; if (examples.length < 5) examples.push(`${x} -> ${f.text}`) }
    }
    expect(hits, `recognised ${hits}/5000: ${examples.join(', ')}`).toBe(0)
  })
})

describe('exactForm — text, tex and value are the same number', () => {
  it('produces KaTeX beside the Unicode', () => {
    const cases: [number, string, string][] = [
      [3, '3', '3'],
      [-2, MINUS + '2', '-2'],
      [1.5, '3/2', '\\frac{3}{2}'],
      [Math.sqrt(3), RT + '3', '\\sqrt{3}'],
      [2 * Math.sqrt(3), '2' + RT + '3', '2\\sqrt{3}'],
      [(2 * Math.sqrt(3)) / 9, '2' + RT + '3/9', '\\frac{2\\sqrt{3}}{9}'],
      [-Math.sqrt(5), MINUS + RT + '5', '-\\sqrt{5}'],
      [Math.PI / 4, PI + '/4', '\\frac{\\pi}{4}'],
      [(-3 * Math.PI) / 2, MINUS + '3' + PI + '/2', '-\\frac{3\\pi}{2}'],
      [2 * Math.PI, '2' + PI, '2\\pi'],
      [(1 + Math.sqrt(5)) / 2, '(1+' + RT + '5)/2', '\\frac{1+\\sqrt{5}}{2}'],
      [(-3 - Math.sqrt(17)) / 4, '(' + MINUS + '3' + MINUS + RT + '17)/4', '\\frac{-3-\\sqrt{17}}{4}'],
    ]
    for (const [v, text, tex] of cases) {
      const f = exactForm(v)
      expect(f, `${v}`).not.toBe(null)
      expect(f!.text, `text of ${v}`).toBe(text)
      expect(f!.tex, `tex of ${v}`).toBe(tex)
      expect(f!.value, `value of ${v}`).toBeCloseTo(v, 12)
    }
  })

  it('value is the form evaluated, so a caller can polish a point onto it', () => {
    expect(exactForm(Math.sqrt(3))!.value).toBe(Math.sqrt(3))
    expect(exactForm(1.5)!.value).toBe(1.5)
    expect(exactForm(Math.PI / 4)!.value).toBe(Math.PI / 4)
    // and the recognised value is the EXACT one, not the input
    expect(exactForm(0.333333333333)!.value).toBe(1 / 3)
  })
})

describe('verifiedExact — the curve has the last word', () => {
  it('returns the first candidate the check accepts', () => {
    // x² − 2, with a root located only to seven digits
    const f = (x: number) => x * x - 2
    const found = verifiedExact(1.4142136, c => Math.abs(f(c)) <= 1e-12)
    expect(found).not.toBe(null)
    expect(found!.text).toBe(RT + '2')
    expect(found!.value).toBe(Math.SQRT2)
  })

  it('returns null when nothing the generator proposes passes', () => {
    expect(verifiedExact(1.4142136, () => false)).toBe(null)
    // ln 2 is not proposed as anything even at the loose tolerance...
    expect(verifiedExact(Math.log(2), c => Math.abs(Math.exp(c) - 2) < 1e-9)).toBe(null)
  })

  it('a form that is merely CLOSE is refused by the check', () => {
    // 1.7320520 is 1.2e-6 from √3 — near enough to be proposed at 1e-5, and
    // the curve x² − 3 says no.
    const check = (c: number) => Math.abs(c * c - 3) <= 1e-12
    expect(verifiedExact(1.732052, check, { tol: 1e-5 })!.text).toBe(RT + '3')
    // ... but with a candidate that is genuinely wrong, nothing comes back
    expect(verifiedExact(1.7300001, check, { tol: 1e-5 })).toBe(null)
  })

  it('proposes at 1e-6 by default: a value ten times looser finds nothing', () => {
    expect(verifiedExact(1.4142136, () => true)!.text).toBe(RT + '2') // 3.8e-8 away
    expect(verifiedExact(1.41423, () => true)).toBe(null) // 1.4e-5 away
    expect(verifiedExact(1.41423, () => true, { tol: 1e-4 })!.text).toBe(RT + '2')
  })

  it('a simpler form wins the tie', () => {
    // 3/2 is a fraction before it is anything with a radical in it
    expect(verifiedExact(1.5, () => true)!.text).toBe('3/2')
    expect(verifiedExact(1.5000001, () => true)!.text).toBe('3/2')
    // √2/2, not (0 + √2)/2
    expect(verifiedExact(Math.SQRT1_2, () => true)!.text).toBe(RT + '2/2')
    // an integer before a fraction before a surd
    expect(verifiedExact(2, () => true)!.text).toBe('2')
    // and the check can still send the simple one back: the SECOND candidate
    // is then the answer
    const notTwo = verifiedExact(2.0000001, c => c !== 2)
    expect(notTwo === null || notTwo.text !== '2').toBe(true)
  })

  it('a check that throws is a failed check, not a crash', () => {
    expect(verifiedExact(Math.SQRT2, () => { throw new Error('nope') })).toBe(null)
  })

  it('is fast enough to run on every special point of every curve', () => {
    // the worst case is a value with NO form: every family is exhausted
    for (let i = 0; i < 200; i++) verifiedExact(1.2345678912 + i * 1e-7, () => false)
    const t0 = performance.now()
    const REPS = 500
    for (let i = 0; i < REPS; i++) verifiedExact(1.2345678912 + i * 1e-7, () => false)
    const us = ((performance.now() - t0) / REPS) * 1000
    expect(us, `${us.toFixed(1)}us per unrecognisable value`).toBeLessThan(200)
  })
})

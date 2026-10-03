// ============================================================================
// tests/mathSpeech.test.ts — equations as words, for a screen reader
// (src/core/mathSpeech.ts): the accessible name of every equation button.
// ============================================================================

import { describe, expect, it } from 'vitest'
import { equationLabel, speakLatex } from '../src/core/mathSpeech'

const FORMS: [string, string][] = [
  // polynomials, powers
  ['y = x^{2} - 3', 'y equals x squared minus 3'],
  ['y=x^2-3', 'y equals x squared minus 3'],
  ['y = x^{4} - x^{3}', 'y equals x to the fourth minus x cubed'],
  ['x^{n}', 'x to the n'],
  ['y = -2(x - 1)^{2} + 4', 'y equals negative 2 times the quantity x minus 1, squared plus 4'],
  ['x^{2} + y^{2} = 25', 'x squared plus y squared equals 25'],
  // fractions and roots
  ['f(x) = \\frac{1}{x}', 'f of x equals 1 over x'],
  ['y=\\frac{3}{4}x', 'y equals 3 fourths x'],
  ['y = \\frac{x+1}{x-2}', 'y equals the fraction with numerator x plus 1 and denominator x minus 2'],
  ['y = \\sqrt{x}', 'y equals the square root of x'],
  ['y=\\sqrt[3]{x}', 'y equals the cube root of x'],
  ['y = \\sqrt{x+4} + 1', 'y equals the square root of x plus 4, end root plus 1'],
  // absolute value
  ['y = \\left|x - 2\\right| + 1', 'y equals the absolute value of x minus 2, end absolute value plus 1'],
  // trig, inverse trig, polar
  ['y = 2\\sin(3x) + 1', 'y equals 2 sine of 3 x plus 1'],
  ['y = \\sin^{2}(x)', 'y equals sine squared of x'],
  ['y=\\sin^{-1}(x)', 'y equals inverse sine of x'],
  ['r = 1 + \\cos\\left(\\theta\\right)', 'r equals 1 plus cosine of theta'],
  // exponentials and logs
  ['y = e^{x}', 'y equals e to the x'],
  ['y = 3e^{-0.5x}', 'y equals 3 e to the negative 0.5 x'],
  ['y = \\ln(x)', 'y equals natural log of x'],
  ['y = \\log_{2}(x)', 'y equals log base 2 of x'],
  ['y = 5\\cdot 2^{x}', 'y equals 5 times 2 to the x'],
  // calculus
  ["f'(x) = 3x^{2} - 3", 'f prime of x equals 3 x squared minus 3'],
  ['\\frac{dy}{dx} = x + y', 'd y by d x equals x plus y'],
  ['\\int_{0}^{2} x^{2}\\,dx', 'the integral from 0 to 2 of x squared d x'],
  ['\\sum_{n=1}^{\\infty} \\frac{1}{n^{2}}', 'the sum from n equals 1 to infinity of 1 over n squared'],
  ['\\lim_{x \\to 0} \\frac{\\sin x}{x}', 'the limit as x approaches 0 of sine of x over x'],
  ['a_{n} = 2n + 1', 'a sub n equals 2 n plus 1'],
  // composition of named functions
  ['g(x)=2f(x-1)+3', 'g of x equals 2 f of the quantity x minus 1, plus 3'],
  // inequalities, intervals, piecewise
  ['y < x^{2} - 4', 'y is less than x squared minus 4'],
  ['y \\geq 2x + 1', 'y is greater than or equal to 2 x plus 1'],
  ['[-2, 5)', 'the interval from negative 2 to 5, including negative 2'],
  ['(2, \\infty)', 'the interval from 2 to infinity'],
  [
    'f(x) = \\begin{cases} x^{2} & x < 1 \\\\ 2x + 1 & x \\ge 1 \\end{cases}',
    'f of x equals piecewise: x squared if x is less than 1; 2 x plus 1 if x is greater than or equal to 1',
  ],
]

describe('speakLatex: the common forms, as words', () => {
  for (const [tex, words] of FORMS) {
    it(`${tex} → ${words}`, () => {
      expect(speakLatex(tex)).toBe(words)
    })
  }

  it('covers at least twenty forms', () => {
    expect(FORMS.length).toBeGreaterThanOrEqual(20)
  })
})

describe('speakLatex: robust', () => {
  it('never throws, and never says a backslash or a brace', () => {
    for (const bad of ['', '\\frac{', '}}{{', '\\unknown{x}', '^^__', '\\left(', 'y = \\', '\\begin{cases}']) {
      const s = speakLatex(bad)
      expect(typeof s).toBe('string')
      expect(s).not.toMatch(/[\\{}]/)
    }
  })

  it('an unknown command is spoken as its name, not dropped', () => {
    expect(speakLatex('y = \\alpha x')).toBe('y equals alpha x')
    expect(speakLatex('\\mathrm{speed} = 3')).toBe('speed equals 3')
  })
})

describe('equationLabel: the accessible name of an equation button', () => {
  it('says what the button is, then the equation', () => {
    expect(equationLabel('y = x^{2} - 3')).toBe('Equation: y equals x squared minus 3')
    expect(equationLabel('y\\prime = x - y', 'Differential equation')).toMatch(/^Differential equation: /)
    expect(equationLabel('')).toBe('Equation')
  })
})

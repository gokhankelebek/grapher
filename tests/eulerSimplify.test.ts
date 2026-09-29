// d²y/dx² for the logistic family: like terms in dy/dx collected, so the
// verdict reads (1 − 2y)·dy/dx rather than the product rule's two terms.
import { describe, expect, it } from 'vitest'
import { eulerVerdict, secondDerivativeOf } from '../src/core/euler'

const d = (src: string) => secondDerivativeOf(src)

describe('secondDerivativeOf — like terms in dy/dx collected', () => {
  it('dy/dx = y(1 − y) gives (1 − 2y)·dy/dx', () => {
    expect(d('dy/dx = y(1 - y)')).toMatchObject({
      text: '(1 − 2y)·dy/dx',
      tex: '\\left(1 - 2y\\right)\\,\\frac{dy}{dx}',
      inXY: { text: '(1 − 2y)·y·(1 − y)' },
    })
    expect(d('dy/dx = y*(1 - y)')!.text).toBe('(1 − 2y)·dy/dx')
    expect(d('dy/dx = y - y^2')!.text).toBe('(1 − 2y)·dy/dx')
  })

  it('the forms the logistic "Show slope field" writes', () => {
    // logistic.ts fieldSource: `dy/dx = k*y*(1 - y/L)`
    expect(d('dy/dx = 0.5*y*(1 - y/10)')!.text).toBe('0.5(1 − y/5)·dy/dx')
    expect(d('dy/dx = 0.5y(1 - y/10)')!.text).toBe('0.5(1 − y/5)·dy/dx')
    expect(d('dy/dx = 0.3*y*(1 - y/1000)')!.text).toBe('0.3(1 − y/500)·dy/dx')
  })

  it('symbolic k and L: k(1 − y/L) − k·y/L → k(1 − 2y/L)', () => {
    const r = d('dy/dx = k*y*(1 - y/L)')!
    expect(r.text).toBe('k·(1 − 2y/L)·dy/dx')
    expect(r.tex).toContain('\\frac{2y}{L}')
  })

  it('an integer gcd comes out front, and a positive term leads', () => {
    expect(d('dy/dx = 2y(3 - y)')!.text).toBe('2(3 − 2y)·dy/dx')
    expect(d('dy/dx = -y(1 - y)')!.text).toBe('(2y − 1)·dy/dx')
  })

  it('leaves alone what it cannot collect safely', () => {
    // dy/dx inside a bracket with x: not a top-level A·dy/dx term
    expect(d('dy/dx = x*y*(1-y)')!.text).toBe('(y + x·dy/dx)·(1 − y) − x·y·dy/dx')
    // one dy/dx term: nothing to collect
    expect(d('dy/dx = x + y')!.text).toBe('1 + dy/dx')
    expect(d('dy/dx = 2x - 3y + 1')!.text).toBe('2 − 3·dy/dx')
    expect(d('dy/dx = (y-1)^2')!.text).toBe('2(y − 1)·dy/dx')
    expect(d('dy/dx = x/y')!.text).toBe('(y − x·dy/dx)/y²')
  })

  it('the verdict quotes the collected form', () => {
    const f = (_x: number, y: number): number => y * (1 - y)
    const v = eulerVerdict(f, 0, 0.1, 1, { d2: d('dy/dx = y(1 - y)') })
    expect(v.reason).toContain('(1 − 2y)·dy/dx')
    expect(v.reason).not.toContain('(1 − y)·dy/dx − y·dy/dx')
  })
})

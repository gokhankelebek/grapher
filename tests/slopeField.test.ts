// ============================================================================
// tests/slopeField.test.ts — the differential-equation parser
// (src/core/parse/slopeField.ts). Left-hand-side shapes, the shared expression
// engine on the right, free constants as sliders, LaTeX, and the errors.
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { SlopeField } from '../src/core/types'
import { parseSlopeField } from '../src/core/parse/slopeField'

function ok(src: string) {
  const r = parseSlopeField(src)
  if (!r.ok) throw new Error(`expected "${src}" to parse, got: ${r.error}`)
  return r
}

function err(src: string): { error: string; pos?: number } {
  const r = parseSlopeField(src)
  if (r.ok) throw new Error(`expected "${src}" to fail, but it parsed as ${r.latex}`)
  return { error: r.error, pos: r.pos }
}

function field(src: string, params?: number[]): SlopeField {
  const r = ok(src)
  return r.makeField('f1', params ?? r.defaultParams, '#123456')
}

describe('parseSlopeField — accepted left-hand sides', () => {
  const equivalents = [
    'dy/dx = x - y',
    'dy / dx = x - y',
    'd y / d x = x - y',
    'dydx = x - y',
    'dy/dx: x - y',
    "y' = x - y",
    "y '= x - y",
    "y'(x) = x - y",
    "f'(x) = x - y",
    "g' = x - y",
  ]
  for (const src of equivalents) {
    it(`accepts ${JSON.stringify(src)}`, () => {
      const f = field(src)
      expect(f.latex).toBe('\\frac{dy}{dx} = x-y')
      expect(f.f(3, 1)).toBeCloseTo(2, 12)
    })
  }

  it('accepts the unicode prime a word processor substitutes', () => {
    expect(field('y’ = x - y').f(3, 1)).toBeCloseTo(2, 12)
    expect(field('y′ = x - y').f(3, 1)).toBeCloseTo(2, 12)
  })
})

describe('parseSlopeField — the AP classics', () => {
  it('dy/dx = x - y', () => {
    const f = field('dy/dx = x - y')
    expect(f.f(2, 5)).toBeCloseTo(-3, 12)
    expect(f.visible).toBe(true)
    expect(f.id).toBe('f1')
    expect(f.color).toBe('#123456')
  })

  it("y' = x*y, and the juxtaposed spelling agrees", () => {
    expect(field("y' = x*y").f(3, 4)).toBeCloseTo(12, 12)
    expect(field("y' = x y").f(3, 4)).toBeCloseTo(12, 12)
    // 'xy' lexes as one multi-letter name here, exactly as it does in every
    // other equation box in the app — same engine, same rule.
    expect(err("y' = xy").error).toMatch(/multi-letter names aren't supported/)
  })

  it('dy/dx = -x/y', () => {
    const f = field('dy/dx = -x/y')
    expect(f.f(1, 2)).toBeCloseTo(-0.5, 12)
    expect(f.f(0, 2)).toBeCloseTo(0, 12)
    expect(Number.isFinite(f.f(1, 0))).toBe(false) // pole, honestly reported
  })

  it('y\' = sin(x) + y', () => {
    const f = field("y' = sin(x) + y")
    expect(f.f(Math.PI / 2, 3)).toBeCloseTo(4, 12)
  })

  it('dy/dx = y*(1 - y) — the logistic', () => {
    const f = field('dy/dx = y*(1 - y)')
    expect(f.f(99, 0.25)).toBeCloseTo(0.1875, 12)
    expect(field('dy/dx = y(1-y)').f(99, 0.25)).toBeCloseTo(0.1875, 12)
  })

  it('a field may use neither variable', () => {
    const f = field('dy/dx = 2')
    expect(f.f(-8, 17)).toBe(2)
    expect(f.latex).toBe('\\frac{dy}{dx} = 2')
  })

  it('a field may use only x, or only y', () => {
    expect(field('dy/dx = x^2').f(3, 100)).toBeCloseTo(9, 12)
    expect(field("y' = y^2").f(100, 3)).toBeCloseTo(9, 12)
  })

  it('the full expression language is available', () => {
    expect(field('dy/dx = sqrt(|x|) + e^y').f(-4, 0)).toBeCloseTo(3, 12)
    expect(field('dy/dx = max(x, y)').f(2, 7)).toBe(7)
    expect(field('dy/dx = pi').f(0, 0)).toBeCloseTo(Math.PI, 12)
  })
})

describe('parseSlopeField — free constants become sliders', () => {
  it('a*x + b*y reports both, in order of first appearance, defaulting to 1', () => {
    const r = ok('dy/dx = a*x + b*y')
    expect(r.paramNames).toEqual(['a', 'b'])
    expect(r.defaultParams).toEqual([1, 1])
    expect(r.makeField('i', [1, 1], '#000').f(2, 3)).toBeCloseTo(5, 12)
    expect(r.makeField('i', [10, -2], '#000').f(2, 3)).toBeCloseTo(14, 12)
  })

  it('a repeated constant is one slider', () => {
    const r = ok("y' = k*y - k")
    expect(r.paramNames).toEqual(['k'])
    expect(r.makeField('i', [3], '#000').f(0, 2)).toBeCloseTo(3, 12)
  })

  it('e and pi are constants, not sliders', () => {
    expect(ok('dy/dx = e*x + pi').paramNames).toEqual([])
  })

  it('x and y are not sliders', () => {
    expect(ok('dy/dx = x*y').paramNames).toEqual([])
  })

  it('each makeField call captures its own params', () => {
    const r = ok('dy/dx = k*y')
    const slow = r.makeField('a', [0.5], '#000')
    const fast = r.makeField('b', [4], '#000')
    expect(slow.f(0, 2)).toBeCloseTo(1, 12)
    expect(fast.f(0, 2)).toBeCloseTo(8, 12)
  })
})

describe('parseSlopeField — LaTeX', () => {
  it('always leads with \\frac{dy}{dx}', () => {
    expect(ok("y' = x*y").latex).toBe('\\frac{dy}{dx} = x\\,y')
    expect(ok('dy/dx = x - y').latex).toBe('\\frac{dy}{dx} = x-y')
  })

  it('uses the engine\'s own emitter for the body', () => {
    expect(ok('dy/dx = -x/y').latex).toBe('\\frac{dy}{dx} = \\frac{-x}{y}')
    expect(ok('dy/dx = y*(1-y)').latex).toBe('\\frac{dy}{dx} = y\\left(1-y\\right)')
    expect(ok("y' = sin(x) + y").latex).toBe('\\frac{dy}{dx} = \\sin\\left(x\\right)+y')
  })

  it('the field carries the same latex as the outcome', () => {
    const r = ok('dy/dx = a*x + b*y')
    expect(r.makeField('i', [1, 1], '#000').latex).toBe(r.latex)
  })
})

describe('parseSlopeField — errors', () => {
  it('empty input', () => {
    expect(err('').error).toMatch(/empty/i)
    expect(err('   ').error).toMatch(/empty/i)
  })

  it('no equals sign', () => {
    const e = err('dy/dx x - y')
    expect(e.error).toMatch(/needs an equals sign/)
    expect(e.pos).toBe(0)
  })

  it('a plain equation is not a differential equation', () => {
    const e = err('y = x - y')
    expect(e.error).toMatch(/ordinary equation/)
    expect(e.error).toMatch(/dy\/dx/)
    expect(e.pos).toBe(0)
  })

  it('a derivative in the wrong variables', () => {
    const e = err('dy/dt = x - y')
    expect(e.error).toMatch(/Only dy\/dx makes a slope field/)
    expect(e.error).toMatch(/'dy\/dt'/)
    expect(e.pos).toBe(0)
  })

  it('a second derivative', () => {
    expect(err("y'' = -y").error).toMatch(/Second derivatives aren't supported/)
    expect(err('y″ = -y').error).toMatch(/Second derivatives aren't supported/)
  })

  it('a prime in the wrong variable', () => {
    const e = err("y'(t) = x - y")
    expect(e.error).toMatch(/with respect to x/)
    expect(e.error).toContain("y'(x)")
  })

  it('an unrecognised left side', () => {
    const e = err('slope = x - y')
    expect(e.error).toMatch(/left side has to be the derivative/)
  })

  it('an empty right side', () => {
    const e = err('dy/dx =   ')
    expect(e.error).toMatch(/right side is empty/)
    expect(e.pos).toBe(7)
  })

  it('a second equals sign', () => {
    const e = err('dy/dx = x - y = 0')
    expect(e.error).toMatch(/Only one '=' is allowed/)
    expect(e.error).toContain('position 14')
    expect(e.pos).toBe(14)
  })

  it('the derivative mentioned again on the right', () => {
    for (const src of ['dy/dx = dy/dx + 1', "dy/dx = y' + x", 'dy/dx = x + dydx']) {
      const e = err(src)
      expect(e.error).toMatch(/can't mention the derivative again/)
      expect(e.pos).toBeGreaterThan(5)
    }
  })

  it('a variable that is not x or y', () => {
    const t = err('dy/dx = x + t')
    expect(t.error).toMatch(/isn't available here/)
    expect(t.error).toContain("'t'")
    expect(t.pos).toBe(12)

    expect(err('dy/dx = r').error).toContain("'r'")
    expect(err('dy/dx = theta').error).toContain('θ')
    expect(err('dy/dx = θ').error).toContain('θ')
  })

  it('expression errors come through with positions shifted to the whole input', () => {
    const e = err('dy/dx = sin(')
    expect(e.error).toMatch(/end of input|\)/)
    const unknown = err('dy/dx = x + foo')
    expect(unknown.error).toMatch(/Unknown/)
    expect(unknown.pos).toBe(12)
    expect(unknown.error).toContain('position 12')
  })

  it('a stray character', () => {
    const e = err('dy/dx = x @ y')
    expect(e.error).toMatch(/Unexpected character '@'/)
    expect(e.pos).toBe(10)
    expect(e.error).toContain('position 10')
  })
})

describe('parseSlopeField — the renderer\'s hot path', () => {
  it('makeField compiles once: 40x30 lattice evaluations are cheap and exact', () => {
    const r = ok('dy/dx = a*x + b*y')
    const f = r.makeField('i', [2, -1], '#000').f
    let checked = 0
    for (let i = 0; i < 40; i++) {
      for (let j = 0; j < 30; j++) {
        const x = -5 + i * 0.25
        const y = -4 + j * 0.25
        expect(f(x, y)).toBeCloseTo(2 * x - y, 12)
        checked++
      }
    }
    expect(checked).toBe(1200)
  })
})

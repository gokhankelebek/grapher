// ============================================================================
// tests/inequality.test.ts — the solution-set parser (src/core/parse/inequality).
//
// Every expectation below is written out by hand: the items a teacher should
// see drawn, not whatever the implementation happens to produce.
// ============================================================================

import { describe, it, expect } from 'vitest'
import { intervalNotation, type NLItem } from '../src/core/types'
import { parseInequality } from '../src/core/parse/inequality'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

type Draft = Record<string, unknown>

function items(src: string): Draft[] {
  const r = parseInequality(src)
  if (!r.ok) throw new Error(`expected "${src}" to parse, got: ${r.error}`)
  return r.items as unknown as Draft[]
}

function latex(src: string): string {
  const r = parseInequality(src)
  if (!r.ok) throw new Error(`expected "${src}" to parse, got: ${r.error}`)
  return r.latex
}

function err(src: string): { error: string; pos?: number } {
  const r = parseInequality(src)
  if (r.ok) throw new Error(`expected "${src}" to fail, but it parsed as ${r.latex}`)
  return { error: r.error, pos: r.pos }
}

/** interval item, written the long way so the tests state the contract */
const iv = (
  lo: number | null,
  hi: number | null,
  loClosed: boolean,
  hiClosed: boolean,
): Draft => ({ kind: 'interval', lo, hi, loClosed, hiClosed })

const pt = (x: number, closed = true): Draft => ({ kind: 'point', x, closed })

/** items(), but with the bounds rounded so irrational bounds can be asserted */
function rounded(src: string, dp = 9): Draft[] {
  const round = (v: unknown) =>
    typeof v === 'number' ? Number(v.toFixed(dp)) : v
  return items(src).map((it) => {
    const out: Draft = { ...it }
    for (const k of ['x', 'lo', 'hi']) if (k in out) out[k] = round(out[k])
    return out
  })
}

// ---------------------------------------------------------------------------
// Simple inequalities
// ---------------------------------------------------------------------------

describe('single inequalities', () => {
  it('parses the four one-sided forms', () => {
    expect(items('x < 3')).toEqual([iv(null, 3, false, false)])
    expect(items('x > -2')).toEqual([iv(-2, null, false, false)])
    expect(items('x <= 1')).toEqual([iv(null, 1, false, true)])
    expect(items('x >= -2')).toEqual([iv(-2, null, true, false)])
  })

  it('accepts the unicode relations', () => {
    expect(items('x ≤ 1')).toEqual(items('x <= 1'))
    expect(items('x ≥ -2')).toEqual(items('x >= -2'))
    expect(items('x ≠ 3')).toEqual(items('x != 3'))
  })

  it('treats = as a single closed point', () => {
    expect(items('x = 4')).toEqual([pt(4)])
    expect(latex('x = 4')).toBe('x \\in \\{4\\}')
  })

  it('draws != as two open rays with the hole between them', () => {
    expect(items('x != 3')).toEqual([
      iv(null, 3, false, false),
      iv(3, null, false, false),
    ])
    expect(latex('x != 3')).toBe('x \\in (-\\infty, 3) \\cup (3, \\infty)')
  })

  it('reads the comparison backwards when the variable is on the right', () => {
    expect(items('3 > x')).toEqual([iv(null, 3, false, false)])
    expect(items('-2 <= x')).toEqual([iv(-2, null, true, false)])
  })

  it('accepts any single letter, used consistently', () => {
    expect(items('t < 3')).toEqual([iv(null, 3, false, false)])
    expect(items('n >= 0 and n <= 4')).toEqual([iv(0, 4, true, true)])
    expect(latex('t < 3')).toBe('t \\in (-\\infty, 3)')
    expect(latex('θ < 3')).toBe('\\theta \\in (-\\infty, 3)')
  })

  it('does not care about whitespace', () => {
    expect(items('x<3')).toEqual(items('   x   <   3   '))
  })
})

// ---------------------------------------------------------------------------
// Chained inequalities
// ---------------------------------------------------------------------------

describe('chained inequalities', () => {
  it('parses an ascending chain', () => {
    expect(items('-2 <= x < 5')).toEqual([iv(-2, 5, true, false)])
    expect(items('2 < x <= 7')).toEqual([iv(2, 7, false, true)])
  })

  it('parses a descending chain to the same interval', () => {
    expect(items('5 > x >= -2')).toEqual([iv(-2, 5, true, false)])
    expect(items('7 >= x > 2')).toEqual([iv(2, 7, false, true)])
  })

  it('closes both ends when both comparisons do', () => {
    expect(items('0 <= x <= 1')).toEqual([iv(0, 1, true, true)])
  })

  it('collapses a chain that pins a single value', () => {
    expect(items('3 <= x <= 3')).toEqual([pt(3)])
  })

  it('treats a reversed chain as the empty conjunction it literally is', () => {
    // "5 <= x < 2" says x is at least 5 and less than 2. Nothing is.
    expect(items('5 <= x < 2')).toEqual([])
    expect(latex('5 <= x < 2')).toBe('\\varnothing')
  })
})

// ---------------------------------------------------------------------------
// or / and
// ---------------------------------------------------------------------------

describe('unions and intersections', () => {
  it('unions with or', () => {
    expect(items('x < -2 or x >= 3')).toEqual([
      iv(null, -2, false, false),
      iv(3, null, true, false),
    ])
  })

  it('intersects with and', () => {
    expect(items('x <= 1 and x > -4')).toEqual([iv(-4, 1, false, true)])
    expect(items('x > 1 and x < 5')).toEqual([iv(1, 5, false, false)])
  })

  it('accepts the unicode set operators', () => {
    expect(items('x < 1 ∪ x > 4')).toEqual(items('x < 1 or x > 4'))
    expect(items('x > 0 ∩ x < 9')).toEqual(items('x > 0 and x < 9'))
  })

  it('binds and tighter than or', () => {
    expect(items('x < 3 and x > 1 or x > 10')).toEqual([
      iv(1, 3, false, false),
      iv(10, null, false, false),
    ])
  })

  it('is case-insensitive about the keywords and ignores them inside names', () => {
    expect(items('x < 1 OR x > 4')).toEqual(items('x < 1 or x > 4'))
    // 'floor' contains no connective, and neither does the bound 'sqrt(2)'
    expect(rounded('x > floor(2.7) and x < sqrt(9)')).toEqual([iv(2, 3, false, false)])
  })

  it('accepts a parenthesised clause', () => {
    expect(items('(x < 3)')).toEqual([iv(null, 3, false, false)])
  })
})

// ---------------------------------------------------------------------------
// Normalisation — the pedagogical core
// ---------------------------------------------------------------------------

describe('normalisation', () => {
  it('sorts items left to right', () => {
    expect(items('x > 10 or x < -10')).toEqual([
      iv(null, -10, false, false),
      iv(10, null, false, false),
    ])
    expect(items('{5, -1, 2}')).toEqual([pt(-1), pt(2), pt(5)])
  })

  it('merges nested rays into one ray', () => {
    expect(items('x < 1 or x < 3')).toEqual([iv(null, 3, false, false)])
    expect(items('x > 4 or x > 0')).toEqual([iv(0, null, false, false)])
  })

  it('merges overlapping intervals', () => {
    expect(items('[1, 4] or [2, 7]')).toEqual([iv(1, 7, true, true)])
  })

  it('covers the whole line when two rays meet and one endpoint is closed', () => {
    expect(items('x <= 2 or x > 2')).toEqual([iv(null, null, false, false)])
    expect(latex('x <= 2 or x > 2')).toBe('x \\in (-\\infty, \\infty)')
  })

  it('keeps two rays apart when neither contains the meeting point', () => {
    expect(items('x < 2 or x > 2')).toEqual([
      iv(null, 2, false, false),
      iv(2, null, false, false),
    ])
  })

  it('joins touching intervals only when an endpoint there is closed', () => {
    expect(items('[1,3] or [3,5]')).toEqual([iv(1, 5, true, true)])
    expect(items('[1,3) or [3,5]')).toEqual([iv(1, 5, true, true)])
    expect(items('[1,3] or (3,5]')).toEqual([iv(1, 5, true, true)])
    // neither side owns 3, so the hole survives and gets drawn
    expect(items('[1,3) or (3,5]')).toEqual([
      iv(1, 3, true, false),
      iv(3, 5, false, true),
    ])
    expect(latex('[1,3) or (3,5]')).toBe('[1, 3) \\cup (3, 5]')
  })

  it('absorbs a point that lies inside a covering interval', () => {
    expect(items('[1,5] or {3}')).toEqual([iv(1, 5, true, true)])
    expect(items('x <= 5 or x = 5')).toEqual([iv(null, 5, false, true)])
  })

  it('lets a point close an interval it was missing from', () => {
    // the hole at 5 is exactly what {5} fills, so [1,5) becomes [1,5]
    expect(items('[1,5) or {5}')).toEqual([iv(1, 5, true, true)])
    expect(items('(1,5) or {1}')).toEqual([iv(1, 5, true, false)])
    expect(items('x < 5 or x = 5')).toEqual([iv(null, 5, false, true)])
  })

  it('merges duplicate points', () => {
    expect(items('{2, 2, 2}')).toEqual([pt(2)])
    expect(items('x = 2 or x = 2')).toEqual([pt(2)])
  })

  it('returns an empty but successful result for an empty intersection', () => {
    const r = parseInequality('x > 5 and x < 1')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.items).toEqual([])
    expect(r.latex).toBe('\\varnothing')
  })

  it('intersects down to a single point when the ends meet', () => {
    expect(items('x >= 3 and x <= 3')).toEqual([pt(3)])
    // ...but an open end there leaves nothing
    expect(items('x > 3 and x <= 3')).toEqual([])
  })

  it('intersects a two-piece set with a ray', () => {
    expect(items('x != 3 and x > 0')).toEqual([
      iv(0, 3, false, false),
      iv(3, null, false, false),
    ])
  })

  it('intersects two sets of points', () => {
    expect(items('{1, 2, 3} and {2, 3, 4}')).toEqual([pt(2), pt(3)])
  })
})

// ---------------------------------------------------------------------------
// Interval and set notation
// ---------------------------------------------------------------------------

describe('interval notation', () => {
  it('parses all four bracket combinations', () => {
    expect(items('[-2, 5)')).toEqual([iv(-2, 5, true, false)])
    expect(items('(-2, 5]')).toEqual([iv(-2, 5, false, true)])
    expect(items('[-2, 5]')).toEqual([iv(-2, 5, true, true)])
    expect(items('(-2, 5)')).toEqual([iv(-2, 5, false, false)])
  })

  it('parses infinite ends, spelled or symbolic', () => {
    expect(items('(-inf, 3]')).toEqual([iv(null, 3, false, true)])
    expect(items('(-infinity, 3]')).toEqual([iv(null, 3, false, true)])
    expect(items('(-∞, 3]')).toEqual([iv(null, 3, false, true)])
    expect(items('[0, ∞)')).toEqual([iv(0, null, true, false)])
    expect(items('[0, inf)')).toEqual([iv(0, null, true, false)])
    expect(items('(-inf, inf)')).toEqual([iv(null, null, false, false)])
  })

  it('draws an unbounded end open however it was bracketed', () => {
    expect(items('[-inf, 3]')).toEqual([iv(null, 3, false, true)])
  })

  it('accepts infinity in an inequality too', () => {
    expect(items('x < inf')).toEqual([iv(null, null, false, false)])
    expect(items('x > -infinity')).toEqual([iv(null, null, false, false)])
  })

  it('collapses a degenerate interval', () => {
    expect(items('[3, 3]')).toEqual([pt(3)])
    expect(items('[3, 3)')).toEqual([])
    expect(items('(3, 3)')).toEqual([])
  })

  it('parses a set of points', () => {
    expect(items('{-1, 2, 5}')).toEqual([pt(-1), pt(2), pt(5)])
    expect(items('{}')).toEqual([])
    expect(items('{7}')).toEqual([pt(7)])
  })

  it('mixes notations across or', () => {
    expect(items('(-inf, -2] or {0} or [3, 5)')).toEqual([
      iv(null, -2, false, true),
      pt(0),
      iv(3, 5, true, false),
    ])
  })
})

// ---------------------------------------------------------------------------
// Constant-expression bounds
// ---------------------------------------------------------------------------

describe('constant-expression bounds', () => {
  it('evaluates expressions as bounds', () => {
    expect(rounded('x < 2*pi')).toEqual([iv(null, Number((2 * Math.PI).toFixed(9)), false, false)])
    expect(rounded('x >= sqrt(2)')).toEqual([iv(Number(Math.SQRT2.toFixed(9)), null, true, false)])
    expect(items('x < -3/4')).toEqual([iv(null, -0.75, false, false)])
    expect(items('x < 1e2')).toEqual([iv(null, 100, false, false)])
    expect(items('[-(1+1), 3^2)')).toEqual([iv(-2, 9, true, false)])
    expect(items('x > |-5|')).toEqual([iv(5, null, false, false)])
    expect(rounded('x < e')).toEqual([iv(null, Number(Math.E.toFixed(9)), false, false)])
  })

  it('keeps the bound as written in the latex', () => {
    expect(latex('x < 2*pi')).toBe('x \\in (-\\infty, 2\\pi)')
    expect(latex('x >= sqrt(2)')).toBe('x \\in [\\sqrt{2}, \\infty)')
    expect(latex('x < -3/4')).toBe('x \\in (-\\infty, -\\frac{3}{4})')
    expect(latex('[0, pi]')).toBe('[0, \\pi]')
  })

  it('treats 2*pi and tau as the same point when merging', () => {
    expect(items('x <= 2*pi or x > tau')).toEqual([iv(null, null, false, false)])
  })

  it('uses commas inside a function call without splitting an interval', () => {
    expect(items('[min(1, 2), max(3, 4)]')).toEqual([iv(1, 4, true, true)])
  })
})

// ---------------------------------------------------------------------------
// intervalNotation round-trips
// ---------------------------------------------------------------------------

describe('intervalNotation round-trips', () => {
  const full = (d: Draft): Extract<NLItem, { kind: 'interval' }> =>
    ({ ...d, id: 'i', color: '#000' }) as unknown as Extract<NLItem, { kind: 'interval' }>

  const notationOf = (src: string): string[] =>
    items(src).map((d) => intervalNotation(full(d)))

  it('renders each parsed interval the way it was written', () => {
    expect(notationOf('[-2, 5)')).toEqual(['[-2, 5)'])
    expect(notationOf('(-inf, 3]')).toEqual(['(-\\infty, 3]'])
    expect(notationOf('[0, ∞)')).toEqual(['[0, \\infty)'])
    expect(notationOf('x < -2 or x >= 3')).toEqual(['(-\\infty, -2)', '[3, \\infty)'])
    expect(notationOf('[1,3) or (3,5]')).toEqual(['[1, 3)', '(3, 5]'])
  })

  it('re-parses its own notation to the same items', () => {
    for (const src of [
      '[-2, 5)',
      '(-2, 5]',
      '[-2, 5]',
      '(-2, 5)',
      '(-inf, 3]',
      '[0, inf)',
      '(-inf, inf)',
      '[-0.75, 2.5)',
    ]) {
      const first = items(src)
      const text = first.map((d) => intervalNotation(full(d))).join(' or ')
      // intervalNotation emits \infty, which the parser accepts back
      expect(items(text)).toEqual(first)
    }
  })
})

// ---------------------------------------------------------------------------
// latex for the card
// ---------------------------------------------------------------------------

describe('latex', () => {
  it('names the variable when the input did', () => {
    expect(latex('x < 3')).toBe('x \\in (-\\infty, 3)')
    expect(latex('-2 <= x < 5')).toBe('x \\in [-2, 5)')
  })

  it('leaves the variable out when the input never gave one', () => {
    expect(latex('[-2, 5)')).toBe('[-2, 5)')
    expect(latex('{-1, 2, 5}')).toBe('\\{-1,\\, 2,\\, 5\\}')
  })

  it('joins the pieces with a union sign', () => {
    expect(latex('x < -2 or x >= 3')).toBe('x \\in (-\\infty, -2) \\cup [3, \\infty)')
    expect(latex('(-inf, -2] or {0} or [3, 5)')).toBe('(-\\infty, -2] \\cup \\{0\\} \\cup [3, 5)')
  })

  it('says so plainly when nothing is left', () => {
    expect(latex('x > 5 and x < 1')).toBe('\\varnothing')
    expect(latex('{}')).toBe('\\varnothing')
  })
})

// ---------------------------------------------------------------------------
// Variables spelled out — a polar domain is typed "theta", not "θ"
// ---------------------------------------------------------------------------

describe('the variable may be a reserved name spelled out', () => {
  it('reads theta as the variable, and prints it as one', () => {
    expect(items('0 <= theta < pi')).toEqual([iv(0, Math.PI, true, false)])
    expect(latex('0 <= theta < pi')).toBe('\\theta \\in [0, \\pi)')
    expect(latex('theta > 0')).toBe('\\theta \\in (0, \\infty)')
  })

  it('θ is the same variable', () => {
    expect(latex('θ > 0')).toBe('\\theta \\in (0, \\infty)')
  })

  it('still refuses an unsolved expression in that variable', () => {
    expect(err('2 theta < 3').error).toMatch(/solve for theta first/)
  })
})

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

describe('errors', () => {
  it('reports a missing bound at the position it should have been', () => {
    const e = err('x < ')
    expect(e.error).toBe("Expected a number after '<'")
    expect(e.pos).toBe(3)

    const e2 = err('x >= ')
    expect(e2.error).toBe("Expected a number after '>='")
    expect(e2.pos).toBe(4)

    const e3 = err('< 3')
    expect(e3.error).toBe("Expected a number before '<'")
    expect(e3.pos).toBe(0)
  })

  it('refuses a comparison with no variable in it', () => {
    const e = err('3 < 5')
    expect(e.error).toContain('no variable')
    expect(e.error).toContain('nothing to solve for')
    expect(e.pos).toBe(0)
  })

  it('refuses two different variables, pointing at the second', () => {
    const e = err('x < 3 < y')
    expect(e.error).toContain('Two different variables')
    expect(e.error).toContain("'x'")
    expect(e.error).toContain("'y'")
    expect(e.pos).toBe(8)

    const e2 = err('x < 3 or y > 5')
    expect(e2.error).toContain('Two different variables')
    expect(e2.pos).toBe(9)
  })

  it('spots a backwards interval and offers the swap', () => {
    const e = err('[3, 1]')
    expect(e.error).toBe('The interval [3, 1] is empty because 3 > 1 — did you mean [1, 3]?')
    expect(e.pos).toBe(0)

    const e2 = err('x < 1 or (7, 2)')
    expect(e2.error).toBe('The interval (7, 2) is empty because 7 > 2 — did you mean (2, 7)?')
    expect(e2.pos).toBe(9)
  })

  it('refuses an unsolved inequality rather than guessing', () => {
    expect(err('2x < 6').error).toContain('more than just the variable')
    expect(err('x + 1 < 3').error).toContain('more than just the variable')
    expect(err('2x < 6').pos).toBe(0)
  })

  it('refuses the variable on both sides', () => {
    const e = err('x < x')
    expect(e.error).toContain('both sides')
    expect(e.pos).toBe(4)
  })

  it('wants the variable in the middle of a chain', () => {
    const e = err('x < 3 < 5')
    expect(e.error).toContain('the variable goes in the middle')
    expect(e.pos).toBe(0)
  })

  it('refuses a chain that changes direction', () => {
    const e = err('2 < x > 5')
    expect(e.error).toContain('changes direction')
    expect(e.pos).toBe(6)
  })

  it('refuses = and != inside a chain', () => {
    expect(err('1 < x = 3').error).toContain('cannot be part of a chain')
    expect(err('1 < x != 3').error).toContain('cannot be part of a chain')
  })

  it('refuses more than two comparisons in one chain', () => {
    const e = err('1 < x < 3 < 5')
    expect(e.error).toContain('Too many comparisons')
    expect(e.pos).toBe(10)
  })

  it('reports unbalanced brackets at the bracket', () => {
    expect(err('{1, 2').error).toBe("Missing closing '}' for the '{' at position 0")
    expect(err('{1, 2').pos).toBe(0)
    expect(err('x < 3)').error).toBe("Unmatched ')' at position 5")
    expect(err('x < 3)').pos).toBe(5)
    expect(err('[1, 2').error).toContain("Missing closing ']'")
  })

  it('explains a malformed interval', () => {
    expect(err('[1, 2, 3]').error).toContain('exactly two bounds')
    expect(err('[1]').error).toContain('two bounds separated by a comma')
    expect(err('(1, 2}').error).toContain("must close with ']' or ')'")
    expect(err('{1, 2)').error).toContain("must close with '}'")
  })

  it('explains a stray comma outside brackets', () => {
    const e = err('x < 1, x > 3')
    expect(e.error).toContain('an interval needs brackets')
    expect(e.pos).toBe(5)
  })

  it('refuses an interval that runs the wrong way past infinity', () => {
    expect(err('(inf, 3]').error).toBe('An interval cannot start at +∞')
    expect(err('[0, -inf)').error).toBe('An interval cannot end at -∞')
  })

  it('refuses infinity where a point is required', () => {
    expect(err('x = inf').error).toBe('∞ is not a point on the line')
    expect(err('{1, inf}').error).toBe('A set of points cannot contain ∞')
  })

  it('refuses infinity buried inside an expression', () => {
    expect(err('x < 2*inf').error).toContain('infinity can only be used on its own')
  })

  it('asks for a comparison when there is none', () => {
    const e = err('x')
    expect(e.error).toContain('Expected a comparison')
    expect(e.pos).toBe(0)
  })

  it('rejects empty input', () => {
    expect(err('').error).toContain('Empty input')
    expect(err('   ').error).toContain('Empty input')
  })

  it('passes the expression engine errors through, repositioned', () => {
    const e = err('x < sqrtt(2)')
    expect(e.error).toContain('sqrtt')
    expect(e.pos).toBe(4)
  })

  it('never throws, whatever it is handed', () => {
    for (const junk of ['<<<', '???', '[[[]]]', 'or', 'and and', 'x <= or', '{,}', '()', '[,]']) {
      expect(() => parseInequality(junk)).not.toThrow()
    }
  })
})

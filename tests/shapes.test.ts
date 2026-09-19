// ============================================================================
// tests/shapes.test.ts — the typed-shape parser (src/core/parse/shapes.ts).
// Every accepted form, the coordinates it produces, the labels a name gives,
// the LaTeX per kind, free constants as sliders, and the error table.
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { Shape } from '../src/core/types'
import { parseShape } from '../src/core/parse/shapes'

function ok(src: string) {
  const r = parseShape(src)
  if (!r.ok) throw new Error(`expected "${src}" to parse, got: ${r.error}`)
  return r
}

function err(src: string): { error: string; pos?: number } {
  const r = parseShape(src)
  if (r.ok) throw new Error(`expected "${src}" to fail, but it parsed as ${r.latex}`)
  return { error: r.error, pos: r.pos }
}

function shape(src: string, params?: number[]): Shape {
  const r = ok(src)
  return r.makeShape('s1', params ?? r.defaultParams, '#123456')
}

/** Narrowing helpers — a failed cast should read as a test failure, not a crash. */
function asPoint(s: Shape): Extract<Shape, { kind: 'point' }> {
  if (s.kind !== 'point') throw new Error(`expected a point, got ${s.kind}`)
  return s
}
function asSegment(s: Shape): Extract<Shape, { kind: 'segment' }> {
  if (s.kind !== 'segment') throw new Error(`expected a segment, got ${s.kind}`)
  return s
}
function asVector(s: Shape): Extract<Shape, { kind: 'vector' }> {
  if (s.kind !== 'vector') throw new Error(`expected a vector, got ${s.kind}`)
  return s
}
function asPolygon(s: Shape): Extract<Shape, { kind: 'polygon' }> {
  if (s.kind !== 'polygon') throw new Error(`expected a polygon, got ${s.kind}`)
  return s
}

// ----------------------------------------------------------------------------
// Points
// ----------------------------------------------------------------------------

describe('parseShape — points', () => {
  it('point (1, 2)', () => {
    const r = ok('point (1, 2)')
    expect(r.kind).toBe('point')
    const p = asPoint(r.makeShape('p1', [], '#e11'))
    expect(p.at).toEqual({ x: 1, y: 2 })
    expect(p.id).toBe('p1')
    expect(p.color).toBe('#e11')
    expect(p.visible).toBe(true)
    expect(p.label).toBeUndefined()
    expect(r.latex).toBe('(1, 2)')
  })

  it('P = (1, 2) — the name becomes the label', () => {
    const p = asPoint(shape('P = (1, 2)'))
    expect(p.at).toEqual({ x: 1, y: 2 })
    expect(p.label).toBe('P')
    expect(ok('P = (1, 2)').latex).toBe('P = (1, 2)')
  })

  it('P(1, 2) — the equals sign is optional', () => {
    const p = asPoint(shape('P(1, 2)'))
    expect(p.at).toEqual({ x: 1, y: 2 })
    expect(p.label).toBe('P')
    expect(ok('P(1,2)').latex).toBe('P = (1, 2)')
  })

  it('a bare pair with no keyword is a point', () => {
    const r = ok('(1, 2)')
    expect(r.kind).toBe('point')
    expect(asPoint(r.makeShape('s', [], '#000')).at).toEqual({ x: 1, y: 2 })
    expect(r.latex).toBe('(1, 2)')
  })

  it('keywords are case-insensitive and whitespace is free', () => {
    for (const src of ['POINT (1,2)', 'Point(1 , 2)', '   point    (  1 ,  2  )  ']) {
      expect(asPoint(shape(src)).at).toEqual({ x: 1, y: 2 })
    }
  })

  it('coordinates are full expressions, negatives included', () => {
    expect(asPoint(shape('(-3/2, 2^3)')).at).toEqual({ x: -1.5, y: 8 })
    const p = asPoint(shape('P = (2pi, sqrt(2))'))
    expect(p.at.x).toBeCloseTo(2 * Math.PI, 12)
    expect(p.at.y).toBeCloseTo(Math.SQRT2, 12)
  })

  it('a comma inside a function call is not the separator', () => {
    expect(asPoint(shape('(max(1, 5), min(2, 7))')).at).toEqual({ x: 5, y: 2 })
  })
})

// ----------------------------------------------------------------------------
// Segments
// ----------------------------------------------------------------------------

describe('parseShape — segments', () => {
  it('segment (0,0) (3,4)', () => {
    const r = ok('segment (0,0) (3,4)')
    expect(r.kind).toBe('segment')
    const s = asSegment(r.makeShape('s', [], '#000'))
    expect(s.a).toEqual({ x: 0, y: 0 })
    expect(s.b).toEqual({ x: 3, y: 4 })
    expect(s.visible).toBe(true)
    expect(s.labels).toBeUndefined()
  })

  it('AB = (0,0) (3,4) — the two letters label the two ends', () => {
    const r = ok('AB = (0,0) (3,4)')
    expect(r.kind).toBe('segment')
    const s = asSegment(r.makeShape('s', [], '#000'))
    expect(s.labels).toEqual(['A', 'B'])
    expect(s.a).toEqual({ x: 0, y: 0 })
    expect(s.b).toEqual({ x: 3, y: 4 })
  })

  it('a comma between the pairs is allowed, and so is "from … to"', () => {
    for (const src of [
      'segment (0,0), (3,4)',
      'segment (0,0) (3,4)',
      'segment from (0,0) to (3,4)',
      '(0,0) (3,4)',
      '(0,0), (3,4)',
    ]) {
      const s = asSegment(shape(src))
      expect(s.a).toEqual({ x: 0, y: 0 })
      expect(s.b).toEqual({ x: 3, y: 4 })
    }
  })
})

// ----------------------------------------------------------------------------
// Vectors
// ----------------------------------------------------------------------------

describe('parseShape — vectors', () => {
  it('vector <3, 4> — tail at the origin', () => {
    const r = ok('vector <3, 4>')
    expect(r.kind).toBe('vector')
    const v = asVector(r.makeShape('v', [], '#000'))
    expect(v.tail).toEqual({ x: 0, y: 0 })
    expect(v.v).toEqual({ x: 3, y: 4 })
    expect(v.label).toBeUndefined()
  })

  it('v = <3, 4> — the name becomes the label', () => {
    const v = asVector(shape('v = <3, 4>'))
    expect(v.v).toEqual({ x: 3, y: 4 })
    expect(v.label).toBe('v')
  })

  it('v = <3,4> from (1,1) — components with a tail', () => {
    const v = asVector(shape('v = <3,4> from (1,1)'))
    expect(v.tail).toEqual({ x: 1, y: 1 })
    expect(v.v).toEqual({ x: 3, y: 4 })
    expect(v.label).toBe('v')
  })

  it('vector (1,1) to (4,5) — tail and tip, components subtracted', () => {
    const v = asVector(shape('vector (1,1) to (4,5)'))
    expect(v.tail).toEqual({ x: 1, y: 1 })
    expect(v.v).toEqual({ x: 3, y: 4 })
  })

  it('the joining words are decoration: "vector (1,1) (4,5)" is the same', () => {
    const v = asVector(shape('vector (1,1) (4,5)'))
    expect(v.tail).toEqual({ x: 1, y: 1 })
    expect(v.v).toEqual({ x: 3, y: 4 })
    expect(asVector(shape('vector from (1,1) to (4,5)')).v).toEqual({ x: 3, y: 4 })
  })

  it('angle brackets alone make a vector, with no keyword', () => {
    expect(ok('<3, 4>').kind).toBe('vector')
    expect(asVector(shape('<3, 4>')).v).toEqual({ x: 3, y: 4 })
  })

  it('a single paren pair after "vector" is its components', () => {
    const v = asVector(shape('vector (3, 4)'))
    expect(v.tail).toEqual({ x: 0, y: 0 })
    expect(v.v).toEqual({ x: 3, y: 4 })
  })
})

// ----------------------------------------------------------------------------
// Polygons
// ----------------------------------------------------------------------------

describe('parseShape — polygons', () => {
  it('polygon (0,0) (4,0) (4,3)', () => {
    const r = ok('polygon (0,0) (4,0) (4,3)')
    expect(r.kind).toBe('polygon')
    const g = asPolygon(r.makeShape('g', [], '#000'))
    expect(g.pts).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
    ])
    expect(g.fill).toBe(false)
    expect(g.visible).toBe(true)
    expect(g.labels).toBeUndefined()
  })

  it('triangle wants exactly three, quadrilateral exactly four', () => {
    expect(asPolygon(shape('triangle (0,0) (4,0) (4,3)')).pts).toHaveLength(3)
    expect(asPolygon(shape('quadrilateral (0,0) (4,0) (4,3) (0,3)')).pts).toHaveLength(4)
    expect(asPolygon(shape('quad (0,0) (4,0) (4,3) (0,3)')).pts).toHaveLength(4)
  })

  it('ABC = (0,0) (4,0) (4,3) — the letters label the vertices', () => {
    const r = ok('ABC = (0,0) (4,0) (4,3)')
    expect(r.kind).toBe('polygon')
    const g = asPolygon(r.makeShape('g', [], '#000'))
    expect(g.labels).toEqual(['A', 'B', 'C'])
    expect(g.pts[2]).toEqual({ x: 4, y: 3 })
  })

  it('four or more vertices, named or not', () => {
    expect(asPolygon(shape('ABCD = (0,0) (4,0) (4,3) (0,3)')).labels).toEqual([
      'A', 'B', 'C', 'D',
    ])
    expect(asPolygon(shape('polygon (0,0) (2,0) (3,2) (1,3) (-1,2)')).pts).toHaveLength(5)
  })

  it('a polygon with no keyword: three pairs or more', () => {
    expect(ok('(0,0) (4,0) (4,3)').kind).toBe('polygon')
  })
})

// ----------------------------------------------------------------------------
// Free constants → sliders
// ----------------------------------------------------------------------------

describe('parseShape — free constants become sliders', () => {
  it('(a, a^2) is one slider, defaulting to 1', () => {
    const r = ok('(a, a^2)')
    expect(r.paramNames).toEqual(['a'])
    expect(r.defaultParams).toEqual([1])
    expect(asPoint(r.makeShape('p', [1], '#000')).at).toEqual({ x: 1, y: 1 })
    expect(asPoint(r.makeShape('p', [3], '#000')).at).toEqual({ x: 3, y: 9 })
    expect(asPoint(r.makeShape('p', [-2], '#000')).at).toEqual({ x: -2, y: 4 })
  })

  it('(a, 2a) — implicit multiplication, one slider', () => {
    const r = ok('(a, 2a)')
    expect(r.paramNames).toEqual(['a'])
    expect(asPoint(r.makeShape('p', [3], '#000')).at).toEqual({ x: 3, y: 6 })
  })

  it('constants are shared across coordinates and pairs, in first-appearance order', () => {
    const r = ok('triangle (0,0) (b,0) (0,h)')
    expect(r.paramNames).toEqual(['b', 'h'])
    expect(r.defaultParams).toEqual([1, 1])
    expect(asPolygon(r.makeShape('g', [4, 3], '#000')).pts).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 3 },
    ])
  })

  it('a repeated letter is one slider, wherever it appears', () => {
    const r = ok('segment (0, k) (k, 0)')
    expect(r.paramNames).toEqual(['k'])
    const s = asSegment(r.makeShape('s', [5], '#000'))
    expect(s.a).toEqual({ x: 0, y: 5 })
    expect(s.b).toEqual({ x: 5, y: 0 })
  })

  it('t is an ordinary slider here — a shape has no running variable', () => {
    const r = ok('<cos(t), sin(t)>')
    expect(r.paramNames).toEqual(['t'])
    const v = asVector(r.makeShape('v', [Math.PI / 2], '#000'))
    expect(v.v.x).toBeCloseTo(0, 12)
    expect(v.v.y).toBeCloseTo(1, 12)
  })

  it('pi and e are constants, not sliders', () => {
    expect(ok('(2pi, e)').paramNames).toEqual([])
  })

  it('each makeShape call captures its own params', () => {
    const r = ok('P = (a, 0)')
    const small = asPoint(r.makeShape('a', [1], '#000'))
    const big = asPoint(r.makeShape('b', [100], '#000'))
    expect(small.at.x).toBe(1)
    expect(big.at.x).toBe(100)
  })

  it('makeShape never returns NaN when the params are finite', () => {
    const sources = [
      'point (1, 2)',
      'P = (a, 2a)',
      '(a, a^2)',
      'segment (0, k) (k, 0)',
      'AB = (a+b, a-b) (a-b, a+b)',
      'vector <3, 4>',
      'v = <a, b> from (b, a)',
      'vector (a,1) to (4,b)',
      '<cos(t), sin(t)>',
      'triangle (0,0) (b,0) (0,h)',
      'ABCD = (0,0) (s,0) (s,s) (0,s)',
    ]
    const finite = (n: number) => expect(Number.isFinite(n)).toBe(true)
    for (const src of sources) {
      const r = ok(src)
      for (const value of [1, -2.5, 0.5, 7]) {
        const s = r.makeShape('s', r.paramNames.map(() => value), '#000')
        const pts =
          s.kind === 'point'
            ? [s.at]
            : s.kind === 'segment'
              ? [s.a, s.b]
              : s.kind === 'vector'
                ? [s.tail, s.v]
                : s.pts
        for (const p of pts) {
          finite(p.x)
          finite(p.y)
        }
      }
    }
  })
})

// ----------------------------------------------------------------------------
// LaTeX
// ----------------------------------------------------------------------------

describe('parseShape — LaTeX', () => {
  it('points', () => {
    expect(ok('point (1, 2)').latex).toBe('(1, 2)')
    expect(ok('P = (1, 2)').latex).toBe('P = (1, 2)')
    expect(ok('Q(0, -3)').latex).toBe('Q = (0, -3)')
  })

  it('segments', () => {
    expect(ok('AB = (0,0) (3,4)').latex).toBe('\\overline{AB}: (0,0)\\to(3,4)')
    expect(ok('segment (0,0) (3,4)').latex).toBe('\\text{segment }(0,0)\\to(3,4)')
  })

  it('vectors', () => {
    expect(ok('v = <3, 4>').latex).toBe('\\vec{v} = \\langle 3, 4 \\rangle')
    expect(ok('vector <3, 4>').latex).toBe('\\langle 3, 4 \\rangle')
    expect(ok('v = <3,4> from (1,1)').latex).toBe(
      '\\vec{v} = \\langle 3, 4 \\rangle\\text{ from }(1,1)',
    )
    expect(ok('vector (1,1) to (4,5)').latex).toBe('\\text{vector }(1,1)\\to(4,5)')
    expect(ok('vector u = (1,1) to (4,5)').latex).toBe('\\vec{u}: (1,1)\\to(4,5)')
  })

  it('polygons', () => {
    expect(ok('ABC = (0,0) (4,0) (4,3)').latex).toBe('\\triangle ABC: (0,0),(4,0),(4,3)')
    expect(ok('ABCD = (0,0) (4,0) (4,3) (0,3)').latex).toBe('ABCD: (0,0),(4,0),(4,3),(0,3)')
    expect(ok('polygon (0,0) (4,0) (4,3)').latex).toBe('\\text{polygon}: (0,0),(4,0),(4,3)')
    expect(ok('triangle (0,0) (4,0) (4,3)').latex).toBe('\\text{triangle}: (0,0),(4,0),(4,3)')
  })

  it('coordinates go through the engine\'s own emitter', () => {
    expect(ok('(a, 2a)').latex).toBe('(a, 2a)')
    expect(ok('(a, a^2)').latex).toBe('(a, a^{2})')
    expect(ok('P = (2pi, sqrt(2))').latex).toBe('P = (2\\pi, \\sqrt{2})')
    expect(ok('<cos(t), sin(t)>').latex).toBe(
      '\\langle \\cos\\left(t\\right), \\sin\\left(t\\right) \\rangle',
    )
    expect(ok('segment (0, -1/2) (1, 3)').latex).toBe('\\text{segment }(0,\\frac{-1}{2})\\to(1,3)')
  })

  it('the shape carries no latex of its own — the outcome owns it', () => {
    // Shape is plain data for the renderer; the card shows outcome.latex.
    const r = ok('P = (1, 2)')
    expect(Object.keys(r.makeShape('p', [], '#000'))).not.toContain('latex')
  })
})

// ----------------------------------------------------------------------------
// Errors
// ----------------------------------------------------------------------------

describe('parseShape — errors', () => {
  it('empty input', () => {
    expect(err('').error).toMatch(/empty/i)
    expect(err('   ').error).toMatch(/empty/i)
  })

  it('no keyword and no name', () => {
    const e = err('x^2 + 1')
    expect(e.error).toBe(
      'Start with point, segment, vector or polygon — or name it, e.g. P = (1, 2)',
    )
    expect(e.pos).toBe(0)
    // a stray word before the points is the same mistake
    expect(err('blah (1,2)').error).toMatch(/^Start with point, segment, vector or polygon/)
  })

  it('an equation is a curve, not a shape', () => {
    for (const src of ['y = x', 'y = x^2 - 1', 'f(x) = x^2', 'r = 2cos(theta)']) {
      const e = err(src)
      expect(e.error).toBe('That is a curve — type it in the equation box as it is')
      expect(e.pos).toBe(0)
    }
    // a single parenthesised formula is a curve too, not a point missing a comma
    expect(err('(x + 1)').error).toBe('That is a curve — type it in the equation box as it is')
  })

  it('x and y are not available inside a coordinate', () => {
    const e = err('(x, 2)')
    expect(e.error).toMatch(/'x' isn't available here/)
    expect(e.error).toMatch(/fixed values/)
    expect(e.pos).toBe(1)

    const e2 = err('point (1, y)')
    expect(e2.error).toMatch(/'y' isn't available here/)
    expect(e2.pos).toBe(10)

    expect(err('(r, 2)').error).toMatch(/'r' isn't available here/)
    expect(err('(theta, 2)').error).toMatch(/θ isn't available here/)
  })

  it('a pair needs its comma', () => {
    const e = err('(1 2)')
    expect(e.error).toBe('A point needs two coordinates separated by a comma, e.g. (1, 2)')
    expect(e.pos).toBe(0)
    expect(err('<3 4>').error).toBe(
      'A vector needs two components separated by a comma, e.g. <3, 4>',
    )
  })

  it('a pair holds just two numbers', () => {
    const e = err('(1,2,3)')
    expect(e.error).toMatch(/just two numbers/)
    expect(e.error).toMatch(/has 3/)
    expect(e.pos).toBe(4)
  })

  it('a missing coordinate', () => {
    expect(err('(, 2)').error).toMatch(/missing a coordinate/)
    expect(err('(1, )').error).toMatch(/missing a coordinate/)
  })

  it('unbalanced brackets', () => {
    const e = err('point (1, 2')
    expect(e.error).toBe("Missing closing ')' for the '(' at position 6")
    expect(e.pos).toBe(6)

    const a = err('v = <3, 4')
    expect(a.error).toBe("Missing closing '>' for the '<' at position 4")
    expect(a.pos).toBe(4)

    const stray = err('point 1, 2)')
    expect(stray.error).toMatch(/Unexpected '\)' at position 10/)
    expect(stray.pos).toBe(10)
  })

  it('a keyword with no points at all', () => {
    const e = err('polygon')
    expect(e.error).toMatch(/A polygon needs coordinates/)
    expect(e.pos).toBe(0)
    expect(err('vector').error).toMatch(/e\.g\. vector <3, 4>/)
  })

  it('too few points for a segment', () => {
    const e = err('segment (0,0)')
    expect(e.error).toBe('A segment needs two points, e.g. segment (0, 0) (3, 4)')
    expect(e.pos).toBe(13)
  })

  it('too many points for a segment or a point', () => {
    const e = err('segment (0,0) (1,1) (2,2)')
    expect(e.error).toBe('A segment has just two points — for more, say polygon')
    expect(e.pos).toBe(20)

    const p = err('point (1,2) (3,4)')
    expect(p.error).toBe('A point is one pair of coordinates — for two, say segment')
    expect(p.pos).toBe(12)
  })

  it('too few points for a polygon', () => {
    const e = err('polygon (0,0) (1,1)')
    expect(e.error).toBe(
      'A polygon needs at least three points, e.g. polygon (0, 0) (4, 0) (4, 3)',
    )
    expect(e.pos).toBe(19)
  })

  it('a triangle has exactly three vertices, a quadrilateral four', () => {
    const few = err('triangle (0,0) (1,1)')
    expect(few.error).toBe('A triangle has exactly 3 vertices — you gave 2')
    expect(few.pos).toBe(20)

    const many = err('triangle (0,0) (1,1) (2,2) (3,3)')
    expect(many.error).toBe('A triangle has exactly 3 vertices — you gave 4')
    expect(many.pos).toBe(27)

    const q = err('quadrilateral (0,0) (1,1) (2,2)')
    expect(q.error).toBe('A quadrilateral has exactly 4 vertices — you gave 3')
  })

  it('a name has to have one letter per vertex', () => {
    expect(err('ABC = (0,0) (1,1)').error).toBe("'ABC' names 3 vertices but you gave 2 points")
    expect(err('ABC = (0,0) (1,1)').pos).toBe(0)
    expect(err('s = (0,0) (3,4)').error).toMatch(/names one vertex but a segment has two/)
    expect(err('ABCD = (0,0) (1,1) (2,2)').error).toBe(
      "'ABCD' names 4 vertices but you gave 3 points",
    )
    expect(err('AB = (1,2)').error).toMatch(/but there is only one point/)
  })

  it('angle brackets belong to vectors', () => {
    const e = err('point <1,2>')
    expect(e.error).toMatch(/Angle brackets make a vector/)
    expect(e.pos).toBe(6)
    expect(err('triangle (0,0) (1,1) <2,2>').error).toMatch(/Angle brackets make a vector/)
    expect(err('<1,2> <3,4>').error).toMatch(/one pair of components/)
  })

  it('a tail has to be introduced', () => {
    const e = err('v = <3,4> (1,1)')
    expect(e.error).toBe("Write 'from' before the tail, e.g. v = <3, 4> from (1, 1)")
    expect(e.pos).toBe(10)
    expect(err('v = <3,4> from').error).toMatch(/'from' has to be followed by a point/)
  })

  it('a vector has at most two points', () => {
    const e = err('vector (0,0) (1,1) (2,2)')
    expect(e.error).toBe('A vector is a tail and a tip — that is more than two points')
    expect(e.pos).toBe(19)
  })

  it('trailing junk is named and located', () => {
    const e = err('point (1, 2) junk')
    expect(e.error).toMatch(/Unexpected 'junk' at position 13/)
    expect(e.pos).toBe(13)
  })

  it('a keyword in the middle is a keyword out of place', () => {
    const e = err('(0,0) segment (1,1)')
    expect(e.error).toMatch(/comes first/)
    expect(e.pos).toBe(6)
  })

  it('the engine\'s own expression errors come through, positioned', () => {
    const e = err('point (1, 2 +)')
    expect(e.pos).toBeGreaterThan(9)
    expect(e.error).toMatch(/position 12|Unexpected/)

    const u = err('(1, foo(2))')
    expect(u.error).toMatch(/multi-letter names aren't supported|Unknown/)
    expect(u.pos).toBe(4)
  })
})

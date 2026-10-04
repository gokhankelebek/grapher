// ============================================================================
// tests/describeGraph.test.ts — figure descriptions for the item bank and for
// screen readers (src/core/describeGraph.ts, src/core/describeAdapters.ts).
//
// The facts asserted here are worked out by hand (x³ − 3x has zeros ±√3 and 0,
// a relative max at (−1, 2) …); the tests check that the description SAYS
// them, in the bank's one-line form and in the long form, and that a student
// copy says none of them.
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { parseExpression } from '../src/core/parse'
import { solveInequality, type SolveResult } from '../src/core/solveInequality'
import {
  describeScene,
  fmt,
  list,
  type DescribeInput,
  type DescribeWindow,
} from '../src/core/describeGraph'
import {
  describeCurves,
  describeInputFromCurves,
  latexToPlain,
  numberLineFromSolve,
  typedText,
  type AdapterCalc,
  type AdapterCurve,
  type AdapterInput,
} from '../src/core/describeAdapters'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let seq = 0

interface Board {
  curves: AdapterCurve[]
  models: Record<string, ModelSpec>
  ids: string[]
}

/** Typed lines as the board holds them: one expr_N model per curve. */
function board(lines: (string | { src: string; extra: Partial<AdapterCurve> })[]): Board {
  const curves: AdapterCurve[] = []
  const models: Record<string, ModelSpec> = {}
  const ids: string[] = []
  for (const line of lines) {
    const src = typeof line === 'string' ? line : line.src
    const r = parseExpression(src)
    if (!r.ok) throw new Error(`expected "${src}" to parse: ${r.error}`)
    const id = `expr_${++seq}`
    models[id] = r.plot.makeModel(id)
    const curve: FittedCurve = {
      id,
      modelId: id,
      params: r.plot.defaultParams,
      kind: r.plot.kind,
      domain: r.plot.domain,
      color: '#000',
      strokeWidth: 2,
      visible: true,
      error: 0,
    }
    curves.push({ curve, source: src, ...(typeof line === 'string' ? {} : line.extra) })
    ids.push(id)
  }
  return { curves, models, ids }
}

function input(b: Board, window: DescribeWindow, more: Partial<AdapterInput> = {}): AdapterInput {
  return { window, curves: b.curves, models: b.models, ...more }
}

const UNIT = { xStep: 1, yStep: 1 }

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

describe('describeGraph — numbers and lists', () => {
  it('formats decimals for reading', () => {
    expect(fmt(2)).toBe('2')
    expect(fmt(-1.5)).toBe('−1.5')
    expect(fmt(Math.sqrt(3))).toBe('1.73')
    expect(fmt(0.123456)).toBe('0.123')
    expect(fmt(-0)).toBe('0')
    expect(fmt(Infinity)).toBe('∞')
  })

  it('joins lists the way a sentence does', () => {
    expect(list(['a'])).toBe('a')
    expect(list(['a', 'b'])).toBe('a and b')
    expect(list(['a', 'b', 'c'])).toBe('a, b, and c')
  })

  it('turns typed lines and KaTeX into readable text', () => {
    expect(typedText('f(x) = x^3 - 3x')).toBe('f(x) = x³ − 3x')
    expect(typedText('f(x) = { x^2 if x < 1 ; 2x + 1 if x >= 1 }')).toBe('f(x) = {x² if x < 1; 2x + 1 if x ≥ 1}')
    expect(typedText('y = x^2 {0 <= x <= 4}')).toBe('y = x² for 0 ≤ x ≤ 4')
    expect(latexToPlain('y = \\frac{x^{2}-9}{x-3}')).toBe('y = (x²−9)/(x−3)')
    expect(latexToPlain('r = 1+\\cos\\left(\\theta\\right)')).toBe('r = 1+cos(θ)')
    expect(latexToPlain('y = \\sqrt{x}')).toBe('y = √x')
  })
})

// ---------------------------------------------------------------------------
// The bank's own example, as plain data
// ---------------------------------------------------------------------------

describe('describeScene — the bank example (plain data)', () => {
  const scene: DescribeInput = {
    window: { xMin: -3, xMax: 4, yMin: -2, yMax: 5 },
    curves: [
      {
        name: 'f′',
        text: 'y = f′(x)',
        kind: 'function',
        features: [
          { kind: 'zero', x: -2, y: 0 },
          { kind: 'zero', x: 1, y: 0 },
          { kind: 'maximum', x: -0.5, y: 3 },
          { kind: 'minimum', x: 3, y: -1.5 },
          { kind: 'point', x: 0, y: 2, labelled: true },
        ],
      },
    ],
  }

  it('answers: true writes the bank line, zeros first', () => {
    const d = describeScene(scene)
    expect(d.figuredesc).toBe(
      'Graph of y = f′(x) on [−3, 4] × [−2, 5]: zeros at x = −2 and x = 1; relative max at (−0.5, 3); relative min at (3, −1.5); passes through (0, 2).',
    )
  })

  it('answers: false is the student copy — window, scale, the labeled point, nothing computed', () => {
    const d = describeScene({ ...scene, window: { ...scene.window, xStep: 1 } }, { answers: false })
    expect(d.figuredesc).toBe(
      'Graph of f′ on [−3, 4] × [−2, 5]; x-axis marked every 1 unit; the curve passes through the labeled point (0, 2).',
    )
    expect(d.long).not.toMatch(/−0\.5|−1\.5|zero|maximum|minimum|crosses/)
    expect(d.long).toContain('(0, 2)')
  })

  it('the long form is structured by curve', () => {
    const d = describeScene(scene)
    const paras = d.long.split('\n\n')
    expect(paras).toHaveLength(2)
    expect(paras[0]).toMatch(/^A graph showing x from −3 to 4 and y from −2 to 5\./)
    expect(paras[1]).toMatch(/^Curve f′: y = f′\(x\), a function\./)
    expect(paras[1]).toContain('It crosses the x-axis at x = −2 and x = 1.')
    expect(paras[1]).toContain('a relative maximum at (−0.5, 3) and a relative minimum at (3, −1.5)')
    expect(paras[1]).toContain('labeled point (0, 2)')
  })

  it('never contains a newline in figuredesc', () => {
    const d = describeScene({ ...scene, extras: ['line one\nline two'] })
    expect(d.figuredesc).not.toMatch(/\n/)
  })
})

// ---------------------------------------------------------------------------
// x³ − 3x — exact zeros ±√3 and 0
// ---------------------------------------------------------------------------

describe('describeCurves — x³ − 3x', () => {
  const b = board(['f(x) = x^3 - 3x'])
  const inp = input(b, { xMin: -3, xMax: 3, yMin: -4, yMax: 4, ...UNIT })
  const d = describeCurves(inp)

  it('figuredesc has the exact zeros and both extrema', () => {
    expect(d.figuredesc).toMatch(/^Graph of f\(x\) = x³ − 3x on \[−3, 3\] × \[−4, 4\]: /)
    expect(d.figuredesc).toContain('zeros at x = −√3, x = 0, and x = √3')
    expect(d.figuredesc).toContain('relative max at (−1, 2)')
    expect(d.figuredesc).toContain('relative min at (1, −2)')
    expect(d.figuredesc).toContain('inflection point at (0, 0)')
    expect(d.figuredesc.length).toBeLessThanOrEqual(300)
  })

  it('zeros come before extrema, extrema before inflection', () => {
    const z = d.figuredesc.indexOf('zeros')
    const m = d.figuredesc.indexOf('relative max')
    const i = d.figuredesc.indexOf('inflection')
    expect(z).toBeGreaterThan(0)
    expect(z).toBeLessThan(m)
    expect(m).toBeLessThan(i)
  })

  it('long form: exact forms with decimals in brackets, the kind, domain and range', () => {
    expect(d.long).toContain('Curve f: f(x) = x³ − 3x, a cubic polynomial.')
    expect(d.long).toContain('x = −√3 (about −1.73), x = 0, and x = √3 (about 1.73)')
    expect(d.long).toContain('a relative maximum at (−1, 2) and a relative minimum at (1, −2)')
    expect(d.long).toContain('Its inflection point is at (0, 0).')
    expect(d.long).toContain('domain all real numbers and range all real numbers')
    expect(d.long).toContain('Both axes are marked every 1 unit.')
  })

  it('the adapter output is plain data', () => {
    const scene = describeInputFromCurves(inp)
    expect(JSON.parse(JSON.stringify(scene))).toEqual(scene)
    const zeros = scene.curves[0].features!.filter((p) => p.kind === 'zero')
    expect(zeros.map((z) => z.exactX)).toEqual(['−√3', '0', '√3'])
  })

  it('a narrower window drops what it cannot show', () => {
    const narrow = describeCurves(input(b, { xMin: 0.5, xMax: 3, yMin: -4, yMax: 4 }))
    expect(narrow.figuredesc).toContain('zero at x = √3')
    expect(narrow.figuredesc).not.toContain('−√3')
    expect(narrow.figuredesc).not.toContain('relative max')
  })

  it('student copy: no zeros, extrema or equation', () => {
    const s = describeCurves(inp, { answers: false })
    expect(s.figuredesc).toBe('Graph of f on [−3, 3] × [−4, 4]; both axes marked every 1 unit.')
    expect(s.long).not.toMatch(/√3|−2\)|maximum|cubic|x³/)
    expect(s.long).toContain('The graph of f is drawn solid.')
  })

  it('student copy shows the equation when the figure prints it', () => {
    const shown = board([{ src: 'f(x) = x^3 - 3x', extra: { shows: { equation: true } } }])
    const s = describeCurves(input(shown, { xMin: -3, xMax: 3, yMin: -4, yMax: 4 }), { answers: false })
    expect(s.figuredesc).toMatch(/^Graph of f\(x\) = x³ − 3x on/)
    expect(s.figuredesc).not.toContain('√3')
  })
})

// ---------------------------------------------------------------------------
// Rational functions: asymptotes and a hole
// ---------------------------------------------------------------------------

describe('describeCurves — a rational function with asymptotes and a hole', () => {
  // (x − 2)(x + 1) / ((x − 2)(x + 2)): hole at (2, 3/4), VA x = −2, HA y = 1, zero x = −1
  const b = board(['f(x) = (x^2 - x - 2)/(x^2 - 4)'])
  const W = { xMin: -6, xMax: 6, yMin: -6, yMax: 6, ...UNIT }
  const d = describeCurves(input(b, W))

  it('figuredesc: zero, both asymptotes, intercept and the hole', () => {
    expect(d.figuredesc).toContain('zero at x = −1')
    expect(d.figuredesc).toContain('vertical asymptote x = −2 and horizontal asymptote y = 1')
    expect(d.figuredesc).toContain('y-intercept (0, 1/2)')
    expect(d.figuredesc).toContain('hole at (2, 3/4)')
    expect(d.figuredesc.indexOf('asymptote')).toBeLessThan(d.figuredesc.indexOf('y-intercept'))
  })

  it('long: names the kind, the domain and the hole as an open circle', () => {
    expect(d.long).toContain('a rational function')
    expect(d.long).toContain('domain x ≠ −2, 2')
    expect(d.long).toContain('It has a hole, drawn as an open circle, at (2, 3/4).')
    expect(d.long).toContain('It has the vertical asymptote x = −2 and the horizontal asymptote y = 1.')
  })

  it('student copy: the dashed lines and open circle the figure shows, no zero', () => {
    const s = describeCurves(input(b, W), { answers: false })
    expect(s.figuredesc).toContain('dashed lines x = −2 and y = 1')
    expect(s.figuredesc).toContain('open circle at (2, 3/4)')
    expect(s.figuredesc).not.toMatch(/zero|asymptote|intercept/)
    expect(s.long).toContain('Dashed lines are drawn at x = −2 and y = 1.')
    expect(s.long).not.toMatch(/hole|asymptote|rational/)
  })

  it('student copy can hide the asymptotes when the figure does not draw them', () => {
    const hidden = board([{ src: 'f(x) = (x^2 - x - 2)/(x^2 - 4)', extra: { shows: { asymptotes: false, markers: false } } }])
    const s = describeCurves(input(hidden, W), { answers: false })
    expect(s.figuredesc).not.toMatch(/dashed|circle/)
  })

  it('a removable discontinuity alone (x² − 9)/(x − 3)', () => {
    const r = describeCurves(input(board(['y = (x^2 - 9)/(x - 3)']), { xMin: -5, xMax: 5, yMin: -2, yMax: 10 }))
    expect(r.figuredesc).toContain('hole at (3, 6)')
    expect(r.figuredesc).toContain('zero at x = −3')
    expect(r.figuredesc).not.toContain('asymptote')
  })
})

// ---------------------------------------------------------------------------
// Piecewise with a jump
// ---------------------------------------------------------------------------

describe('describeCurves — a piecewise function with a jump', () => {
  const b = board(['f(x) = { x^2 if x < 1 ; 2x + 1 if x >= 1 }'])
  const W = { xMin: -2, xMax: 4, yMin: -1, yMax: 9, ...UNIT }

  it('answers: the jump with both one-sided limits', () => {
    const d = describeCurves(input(b, W))
    expect(d.figuredesc).toContain('jump at x = 1 (left limit 1, right limit 3)')
    expect(d.long).toContain('At x = 1 the graph jumps: from the left it approaches 1, and from the right it approaches 3')
    expect(d.long).toContain('a closed dot at (1, 3) and an open circle at (1, 1)')
    expect(d.long).toContain('a piecewise function')
    expect(d.long).toContain('f(x) = {x² if x < 1; 2x + 1 if x ≥ 1}')
  })

  it('student copy: the dots, never the limits', () => {
    const s = describeCurves(input(b, W), { answers: false })
    expect(s.figuredesc).toContain('closed dot at (1, 3) and open circle at (1, 1)')
    expect(s.figuredesc).not.toMatch(/limit|jump/)
    expect(s.long).toContain('At x = 1 the graph breaks, with a closed dot at (1, 3) and an open circle at (1, 1).')
    expect(s.long).not.toMatch(/approaches/)
  })

  it('a restricted domain ends in closed and open dots', () => {
    const r = describeCurves(input(board(['g(x) = x^2 {0 <= x < 2}']), { xMin: -1, xMax: 3, yMin: -1, yMax: 5 }))
    expect(r.figuredesc).toContain('closed endpoint at (0, 0)')
    expect(r.figuredesc).toContain('open endpoint at (2, 4)')
    expect(r.long).toContain('It ends at (0, 0) with a closed dot and (2, 4) with an open circle.')
  })
})

// ---------------------------------------------------------------------------
// Area between curves, Riemann sums, tangent lines
// ---------------------------------------------------------------------------

describe('describeCurves — calculus objects', () => {
  const b = board(['f(x) = x^2', 'g(x) = 2x'])
  const W = { xMin: -1, xMax: 3, yMin: -1, yMax: 5, ...UNIT }
  const calc: AdapterCalc[] = [{ kind: 'area', curve: b.ids[0], other: b.ids[1], a: 0, b: 2, label: 'R' }]

  it('the area between x² and 2x on [0, 2] is 4/3, with g on top', () => {
    const d = describeCurves(input(b, W, { calc }))
    expect(d.figuredesc).toContain('shaded region R between g and f on [0, 2], area 4/3')
    expect(d.long).toContain('The shaded region R lies between g (above) and f (below) from x = 0 to x = 2; its area is 4/3.')
    expect(d.long).toContain('The curves f and g intersect at (0, 0) and (2, 4).')
  })

  it('multi-curve figuredesc groups the facts by curve', () => {
    const d = describeCurves(input(b, W, { calc }))
    expect(d.figuredesc).toMatch(/^Graphs of f\(x\) = x² and g\(x\) = 2x on \[−1, 3\] × \[−1, 5\]: f: zero at x = 0, relative min at \(0, 0\)/)
    expect(d.figuredesc).toContain('; g: zero at x = 0')
    expect(d.figuredesc).toContain('f and g meet at (0, 0) and (2, 4)')
  })

  it('student copy: the shaded region without its area, intersections only when labeled', () => {
    const s = describeCurves(input(b, W, { calc }), { answers: false })
    expect(s.figuredesc).toBe('Graphs of f and g on [−1, 3] × [−1, 5]; both axes marked every 1 unit; shaded region R between g and f on [0, 2].')
    expect(s.long).not.toMatch(/4\/3|intersect/)
    const labelled = describeCurves(input(b, W, { calc, labelledIntersections: [{ x: 2, y: 4, label: 'P' }] }), { answers: false })
    expect(labelled.figuredesc).toContain('labeled intersection at P (2, 4)')
    expect(labelled.figuredesc).not.toContain('(0, 0)')
  })

  it('area under a curve, Riemann rectangles and a tangent line', () => {
    const one = board(['f(x) = x^2'])
    const id = one.ids[0]
    const d = describeCurves(input(one, { xMin: -1, xMax: 3, yMin: -1, yMax: 5 }, {
      calc: [
        { kind: 'area', curve: id, a: 0, b: 1 },
        { kind: 'riemann', curve: id, a: 0, b: 2, n: 4, method: 'left' },
        { kind: 'tangent', curve: id, x: 1 },
      ],
    }))
    expect(d.figuredesc).toContain('shaded region under f on [0, 1], area 1/3')
    expect(d.figuredesc).toContain('4 left-endpoint rectangles under f on [0, 2], sum 1.75')
    expect(d.figuredesc).toContain('tangent line to f at x = 1: y = 2x − 1')
    expect(d.long).toContain('A tangent line is drawn to f at x = 1; its slope is 2 and its equation is y = 2x − 1.')
    expect(d.long).toContain('4 left-endpoint rectangles of equal width approximate the area under f from x = 0 to x = 2; their total area is 1.75.')
    const s = describeCurves(input(one, { xMin: -1, xMax: 3, yMin: -1, yMax: 5 }, {
      calc: [{ kind: 'riemann', curve: id, a: 0, b: 2, n: 4, method: 'left' }, { kind: 'tangent', curve: id, x: 1 }],
    }), { answers: false })
    expect(s.figuredesc).toContain('4 left-endpoint rectangles under f on [0, 2]')
    expect(s.figuredesc).toContain('tangent line to f at x = 1')
    expect(s.figuredesc).not.toMatch(/1\.75|2x − 1|slope/)
  })

  it('a secant line has the average rate of change as its slope', () => {
    const one = board(['f(x) = x^2'])
    const d = describeCurves(input(one, { xMin: -1, xMax: 4, yMin: -1, yMax: 10 }, {
      calc: [{ kind: 'secant', curve: one.ids[0], x: 1, x2: 3 }],
    }))
    expect(d.figuredesc).toContain('secant line to f from x = 1 to x = 3 (slope 4)')
  })
})

// ---------------------------------------------------------------------------
// Exact π forms, polar curves, conics
// ---------------------------------------------------------------------------

describe('describeCurves — π, polar and conics', () => {
  it('sin x on [0, 2π]: zeros and extrema in π', () => {
    const d = describeCurves(input(board(['y = sin(x)']), { xMin: 0, xMax: 2 * Math.PI, yMin: -1.5, yMax: 1.5, xStep: Math.PI / 2, xStepText: 'π/2', yStep: 0.5 }))
    expect(d.figuredesc).toContain('x = π')
    expect(d.figuredesc).toContain('relative max at (π/2, 1)')
    expect(d.figuredesc).toContain('relative min at (3π/2, −1)')
    expect(d.long).toContain('x = π (about 3.14)')
    expect(d.long).toContain('(π/2, 1) (about (1.57, 1))')
    expect(d.long).toContain('The x-axis is marked every π/2 units and the y-axis every 0.5 units.')
    expect(d.figuredesc).toContain('[0, 6.28]')
  })

  it('a circle: kind, center and radius', () => {
    const d = describeCurves(input(board(['x^2 + y^2 = 25']), { xMin: -6, xMax: 6, yMin: -6, yMax: 6 }))
    expect(d.long).toContain('a circle')
    expect(d.long).toContain('Its center is at (0, 0).')
    expect(d.long).toContain('Its radius is 5.')
    expect(d.long).not.toMatch(/focus|foci/)
    expect(d.figuredesc).toContain('center at (0, 0)')
  })

  it('a hyperbola: center, vertices, foci, asymptotes and eccentricity', () => {
    const d = describeCurves(input(board(['(x-1)^2/16 - (y+2)^2/9 = 1']), { xMin: -8, xMax: 10, yMin: -10, yMax: 6 }))
    expect(d.figuredesc).toContain('center at (1, −2); vertices at (−3, −2) and (5, −2); foci at (−4, −2) and (6, −2)')
    expect(d.long).toContain('a hyperbola')
    expect(d.long).toContain('Its eccentricity is 5/4.')
    expect(d.long).toMatch(/Its asymptotes are y = /)
  })

  it('names the family of a typed formula', () => {
    const W = { xMin: -3, xMax: 3, yMin: -3, yMax: 8 }
    expect(describeCurves(input(board(['y = e^x']), W)).long).toContain('an exponential function')
    expect(describeCurves(input(board(['y = ln(x)']), W)).long).toContain('a logarithmic function')
    expect(describeCurves(input(board(['y = 2sin(x) + 1']), W)).long).toContain('a trigonometric function')
    expect(describeCurves(input(board(['y = sqrt(x + 2)']), W)).long).toContain('a radical function')
  })

  it('caps long lists and keeps the count', () => {
    const d = describeCurves(input(board(['y = cos(2x)']), { xMin: -10, xMax: 10, yMin: -2, yMax: 2 }))
    expect(d.figuredesc).toContain('zeros at x = −11π/4, x = −9π/4, x = −7π/4, and 9 more')
    expect(d.long).toContain('It crosses the x-axis 12 times, at')
    expect(d.long).toContain('It has 7 relative maxima in the window')
  })

  it('a polar curve is named as one', () => {
    const d = describeCurves(input(board(['r = 1 + cos(theta)']), { xMin: -1, xMax: 3, yMin: -2, yMax: 2 }, { board: 'polar' }))
    expect(d.long).toContain('a polar curve')
    expect(d.long).toContain('on a polar grid')
    expect(d.figuredesc).toMatch(/^Graph of r = 1 \+ cos\(θ\)|^Graph of r = 1 \+ cos θ/)
  })

  it('dashed vs solid is said when curves differ by style', () => {
    const b = board(['f(x) = x', { src: 'g(x) = -x', extra: { dashed: true } }])
    const d = describeCurves(input(b, { xMin: -2, xMax: 2, yMin: -2, yMax: 2 }))
    expect(d.figuredesc).toContain('g dashed')
    expect(d.long).toContain('It shows 2 curves: f (solid) and g (dashed).')
  })
})

// ---------------------------------------------------------------------------
// Number line
// ---------------------------------------------------------------------------

describe('describeScene — number line solutions', () => {
  const W: DescribeWindow = { xMin: -5, xMax: 5, yMin: -1, yMax: 1 }

  function nl(src: string) {
    const r = solveInequality(src)
    if (!('ok' in r) || !r.ok) throw new Error(`no solution for ${src}`)
    return numberLineFromSolve(r as SolveResult, -5, 5, 1)
  }

  it('x² − 4 > 0: open circles at ±2, shading outward', () => {
    const d = describeScene({ window: W, curves: [], numberLine: nl('x^2 - 4 > 0') })
    expect(d.figuredesc).toBe(
      'Number line from −5 to 5, marked every 1 unit, showing x² − 4 > 0: solution (−∞, −2) ∪ (2, ∞) (x < −2 or x > 2); open circles at −2 and 2; shaded everything to the left of −2 and everything to the right of 2.',
    )
    expect(d.long).toContain('It shows the solution of x² − 4 > 0: (−∞, −2) ∪ (2, ∞), that is, x < −2 or x > 2.')
    expect(d.long).toContain('It has open circles at −2 and 2.')
  })

  it('|x − 1| ≤ 2: closed dots at −1 and 3, shaded between', () => {
    const d = describeScene({ window: W, curves: [], numberLine: nl('|x - 1| <= 2') })
    expect(d.figuredesc).toContain('closed dots at −1 and 3')
    expect(d.figuredesc).toContain('shaded from −1 to 3')
    expect(d.figuredesc).toContain('[−1, 3]')
  })

  it('x² ≤ 0 is the single point 0', () => {
    const d = describeScene({ window: W, curves: [], numberLine: nl('x^2 <= 0') })
    expect(d.figuredesc).toContain('a closed dot at 0')
  })

  it('student copy: the marks, not the statement or the notation', () => {
    const d = describeScene({ window: W, curves: [], numberLine: nl('x^2 - 4 > 0') }, { answers: false })
    expect(d.figuredesc).toBe(
      'Number line from −5 to 5, marked every 1 unit: open circles at −2 and 2; shaded everything to the left of −2 and everything to the right of 2.',
    )
    expect(d.long).not.toMatch(/x² − 4|∪|solution/)
  })

  it('rational inequality keeps the excluded value open', () => {
    const d = describeScene({ window: W, curves: [], numberLine: nl('(x - 1)/(x + 2) >= 0') })
    expect(d.figuredesc).toContain('closed dot at 1')
    expect(d.figuredesc).toContain('open circle at −2')
  })
})

// ---------------------------------------------------------------------------
// figuredesc limits
// ---------------------------------------------------------------------------

describe('describeScene — figuredesc length', () => {
  const busy = board([
    'f(x) = sin(3x) + x/4',
    'g(x) = cos(2x)',
    'h(x) = x^3/10 - x',
  ])
  const W = { xMin: -10, xMax: 10, yMin: -4, yMax: 4, ...UNIT }

  it('a busy figure stays under 300 characters', () => {
    const d = describeCurves(input(busy, W))
    expect(d.figuredesc.length).toBeLessThanOrEqual(300)
    expect(d.figuredesc.endsWith('.')).toBe(true)
    expect(d.figuredesc).not.toMatch(/\n/)
    // the long form keeps everything
    expect(d.long.length).toBeGreaterThan(d.figuredesc.length * 3)
  })

  it('honours a custom limit and keeps the higher priorities', () => {
    const b = board(['f(x) = x^3 - 3x'])
    const d = describeCurves(input(b, { xMin: -3, xMax: 3, yMin: -4, yMax: 4, ...UNIT }), { maxLength: 120 })
    expect(d.figuredesc.length).toBeLessThanOrEqual(120)
    expect(d.figuredesc).toContain('zeros at x = −√3, x = 0, and x = √3')
    expect(d.figuredesc).not.toContain('inflection')
  })

  it('every limit from 40 to 400 is honoured', () => {
    const scene = describeInputFromCurves(input(busy, W))
    for (let max = 40; max <= 400; max += 20) {
      for (const answers of [true, false]) {
        const d = describeScene(scene, { maxLength: max, answers })
        expect(d.figuredesc.length).toBeLessThanOrEqual(max)
        expect(d.figuredesc.length).toBeGreaterThan(10)
      }
    }
  })

  it('an over-long heading is cut with an ellipsis, never overflowing', () => {
    const d = describeScene({
      window: { xMin: 0, xMax: 1, yMin: 0, yMax: 1 },
      curves: [{ name: 'f', text: `f(x) = ${'x + '.repeat(100)}1`, kind: 'function' }],
    })
    expect(d.figuredesc.length).toBeLessThanOrEqual(300)
    expect(d.figuredesc.endsWith('…')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Answer mode as a whole
// ---------------------------------------------------------------------------

describe('describeScene — answer mode on and off', () => {
  it('extras flagged as answers are dropped from a student copy', () => {
    const scene: DescribeInput = {
      window: { xMin: 0, xMax: 4, yMin: 0, yMax: 4, xStep: 1, yStep: 1 },
      curves: [{ name: 'f', text: 'f(x) = √x', kind: 'function' }],
      extras: ['The point A is labelled.', { text: 'The area of R is 16/3.', answer: true }],
    }
    const on = describeScene(scene)
    const off = describeScene(scene, { answers: false })
    expect(on.long).toContain('The area of R is 16/3.')
    expect(off.long).not.toContain('16/3')
    expect(off.long).toContain('The point A is labelled.')
  })

  it('the student copy never mentions a computed feature for any curve on the board', () => {
    const b = board(['f(x) = x^3 - 3x', 'g(x) = (x^2 - x - 2)/(x^2 - 4)', 'h(x) = { x^2 if x < 1 ; 2x + 1 if x >= 1 }'])
    const s = describeCurves(input(b, { xMin: -5, xMax: 5, yMin: -6, yMax: 6, ...UNIT }), { answers: false })
    for (const text of [s.figuredesc, s.long]) {
      expect(text).not.toMatch(/zero|maximum|minimum|\bmax\b|\bmin\b|inflection|intercept|asymptote|domain|range|limit|intersect|√3/)
    }
  })

  it('empty input still describes the window', () => {
    const d = describeScene({ window: { xMin: -1, xMax: 1, yMin: -1, yMax: 1 }, curves: [] })
    expect(d.figuredesc).toBe('Coordinate grid on [−1, 1] × [−1, 1].')
    expect(d.long).toContain('No curves are drawn.')
  })
})

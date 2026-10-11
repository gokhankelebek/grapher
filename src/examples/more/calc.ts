// ============================================================================
// src/examples/more/calc.ts — more gallery examples (see catalog.ts for the
// ExampleDef contract). Appended to EXAMPLE_DEFS; ids are permanent.
// ============================================================================

import type { ExampleDef } from '../catalog'

const PI = Math.PI

export const MORE_CALC: readonly ExampleDef[] = [
  {
    id: 'calc-u2-difference-quotient',
    course: 'calc',
    unit: 'U2',
    help: ['calc-2', 'calc-1'],
    title: 'A limit that is a derivative in disguise',
    short: 'lim (√(4 + h) − 2)/h',
    note:
      'The curve is the difference quotient q(h) = (√(4 + h) − 2)/h of f(x) = √x at 4, with h on the horizontal axis: it has a hole at h = 0, and the table closes in on 1/4. Ask the class to recognize the limit as f′(4) for f(x) = √x and get 1/(2√4) = 1/4 without the table, then to rationalize the numerator to confirm it (Calc 2.2).',
    keywords: ['definition of derivative', 'difference quotient', 'limit', 'h → 0', 'recognize derivative', 'rationalize', '2.2'],
    build: (b) => {
      b.frame([-4.5, 6], [-0.1, 0.6], { independent: true })
      const q = b.line('q(x) = (sqrt(4 + x) - 2)/x')
      b.limit(q, 0, { table: true })
    },
  },
  {
    id: 'calc-u2-corner',
    course: 'calc',
    unit: 'U2',
    help: ['calc-2', 'calc-1'],
    title: 'Continuous but not differentiable',
    short: 'the corner of |x² − 4| at 2',
    note:
      'f(x) = |x² − 4| is continuous at x = 2 (its limit there is 0 = f(2)), but the difference quotient q(x) = (f(x) − f(2))/(x − 2) jumps there: its left limit is −4 and its right limit is 4. Ask the class why that makes f′(2) fail to exist, and what a corner looks like on the graph of f (Calc 2.4).',
    keywords: ['differentiability', 'continuity', 'corner', 'one-sided derivative', 'absolute value', 'difference quotient', '2.4'],
    build: (b) => {
      b.frame([-4.5, 5.5], [-5.5, 8])
      const f = b.line('f(x) = |x^2 - 4|')
      const q = b.line('q(x) = |x^2 - 4|/(x - 2)')
      b.limit(f, 2)
      b.limit(q, 2, { table: true })
    },
  },
  {
    id: 'calc-u3-inverse-derivative',
    course: 'calc',
    unit: 'U3',
    help: ['calc-3'],
    title: 'The derivative of an inverse function',
    short: '(f⁻¹)′(3) for f(x) = x³ + x + 1',
    note:
      'f(x) = x³ + x + 1 passes through (1, 3) with slope f′(1) = 4; its inverse, typed as x = y³ + y + 1, passes through (3, 1) with slope 1/4, and the two tangent lines are reflections of each other in y = x. Ask the class for (f⁻¹)′(3) = 1/f′(1) before revealing the cards, then to get the same 1/4 by differentiating x = y³ + y + 1 implicitly (Calc 3.3).',
    keywords: ['inverse function', 'derivative of inverse', 'reciprocal slope', 'reflection', 'implicit', '3.3'],
    build: (b) => {
      b.frame([-2.5, 4.5], [-2, 4])
      b.line('y = x', { dash: [6, 5], color: '#9aa4b2', strokeWidth: 1.5 })
      const g = b.line('x = y^3 + y + 1')
      b.tangent(g, 3, { y: 1 })
      const f = b.line('f(x) = x^3 + x + 1')
      b.tangent(f, 1)
      b.select(f)
    },
  },
  {
    id: 'calc-u3-implicit-ellipse',
    course: 'calc',
    unit: 'U3',
    help: ['calc-3', 'calc-5'],
    title: 'Implicit differentiation: a horizontal tangent',
    short: 'x² + 4y² = 7 + 3xy',
    note:
      'Implicit differentiation of x² + 4y² = 7 + 3xy gives dy/dx = (3y − 2x)/(8y − 3x), which is 0 at P(3, 2), so the tangent there is horizontal. Ask the class to find P by setting 3y − 2x = 0 with x = 3, then to show d²y/dx² = −2/7 at P, so the curve has a local maximum there (Calc 3.2, 3.6).',
    keywords: ['implicit differentiation', 'horizontal tangent', 'vertical tangent', 'second derivative', 'ellipse', 'free response', '3.2'],
    build: (b) => {
      b.frame([-5, 5], [-3.5, 3.5])
      const c = b.line('x^2 + 4y^2 = 7 + 3x y')
      b.tangent(c, 3, { y: 2, marks: true })
    },
  },
  {
    id: 'calc-u4-cone',
    course: 'calc',
    unit: 'U4',
    help: ['calc-4'],
    title: 'Related rates: filling a conical tank',
    short: 'the cone, when h = 4',
    note:
      'Water flows at 10 ft³/min into a cone, vertex down, 10 ft tall with top radius 5 ft, so r = h/2 and V = πh³/12. When the water is 4 ft deep, dh/dt = 10/(π · 2²) = 5/(2π) ≈ 0.796 ft/min — ask the class to set up the similar triangles and differentiate before revealing the card, then to explain why the level rises more slowly as the tank fills.',
    keywords: ['related rates', 'cone', 'conical tank', 'similar triangles', 'volume', 'rates of change', '4.4'],
    build: (b) => {
      b.relatedRatesProblem('cone', { params: { R: 5, H: 10, k: 10 }, when: { q: 'h', v: 4 } })
    },
  },
  {
    id: 'calc-u4-linearization',
    course: 'calc',
    unit: 'U4',
    help: ['calc-4', 'calc-2'],
    title: 'Local linearization: over or under?',
    short: 'tangent line estimate of ln 1.5',
    note:
      'The tangent to f(x) = ln x at x = 1 is L(x) = x − 1, so L(1.5) = 0.5 estimates ln 1.5 ≈ 0.405. Ask the class to decide before computing whether 0.5 is too big or too small: f″(x) = −1/x² < 0, so the graph is concave down and lies below its tangent line, and the estimate is an overestimate (Calc 4.6).',
    keywords: ['linearization', 'linear approximation', 'tangent line approximation', 'overestimate', 'underestimate', 'concavity', 'local linearity', '4.6'],
    build: (b) => {
      b.frame([0, 2.6], [-0.9, 1.1])
      const f = b.line('f(x) = ln(x)')
      b.tangent(f, 1)
      b.line('x = 1.5', { dash: [6, 5], color: '#9aa4b2', strokeWidth: 1.5 })
      b.select(f)
    },
  },
  {
    id: 'calc-u4-lhopital',
    course: 'calc',
    unit: 'U4',
    help: ['calc-4', 'calc-1'],
    title: "L'Hôpital's rule: the ratio of the slopes",
    short: "L'Hôpital: arctan 2x / arctan x",
    note:
      "N(x) = arctan 2x and D(x) = arctan x (dashed) are both 0 at x = 0, so q(x) = N(x)/D(x) has the form 0/0 there; the limit card's table closes in on 2. Ask the class for N′(0) = 2 and D′(0) = 1: near 0 the two curves look like the lines y = 2x and y = x, so their ratio is close to 2/1, which is L'Hôpital's rule — and why q levels off at 1 far from 0 (Calc 4.7).",
    keywords: ["l'hopital", 'lhopital', "l'hospital", 'indeterminate form', '0/0', 'limit', 'local linearity', 'arctangent', '4.7'],
    build: (b) => {
      b.frame([-5, 5], [-2, 3])
      const n = b.line('N(x) = arctan(2x)', { dash: [6, 5] })
      const d = b.line('D(x) = arctan(x)', { dash: [6, 5] })
      b.view(n, { showParent: false }).view(d, { showParent: false })
      const q = b.line('q(x) = arctan(2x)/arctan(x)')
      b.limit(q, 0, { table: true })
    },
  },
  {
    id: 'calc-u4-particle-motion',
    course: 'calc',
    unit: 'U4',
    help: ['calc-4', 'calc-5'],
    title: 'Particle motion on a line',
    short: 'position s(t) = t³ − 6t² + 9t',
    note:
      'The curve is the position s(t) = t³ − 6t² + 9t of a particle on a line, t on the horizontal axis, with the sign chart of s, v = s′ = 3(t − 1)(t − 3) and a = s″ = 6(t − 2) underneath. Ask the class when the particle is at rest (t = 1 and 3), when it moves left (1 < t < 3), and when it speeds up — where v and a have the same sign, 1 < t < 2 and t > 3 (Calc 4.2).',
    keywords: ['particle motion', 'position', 'velocity', 'acceleration', 'speeding up', 'slowing down', 'at rest', 'rectilinear motion', 'free response', '4.2'],
    build: (b) => {
      b.frame([-0.8, 5], [-2.5, 6.5])
      const s = b.line('s(x) = x^3 - 6x^2 + 9x {x >= 0}')
      b.signChart(s, { rows: ['f', 'f1', 'f2'], guides: true })
    },
  },
  {
    id: 'calc-u5-candidates',
    course: 'calc',
    unit: 'U5',
    help: ['calc-5'],
    title: 'The Candidates Test on a closed interval',
    short: 'absolute extrema on [−2, 3]',
    note:
      'f(x) = 2x³ − 3x² − 12x + 1 on [−2, 3]: f′(x) = 6(x + 1)(x − 2), so the candidates are the endpoints and the critical points x = −1 and x = 2. The card evaluates f(−2) = −3, f(−1) = 8, f(2) = −19 and f(3) = −8 — ask the class to build that table first and name the absolute maximum 8 and the absolute minimum −19, and why the Extreme Value Theorem promises both (Calc 5.5).',
    keywords: ['candidates test', 'closed interval method', 'absolute extrema', 'absolute maximum', 'absolute minimum', 'extreme value theorem', 'critical points', '5.5'],
    build: (b) => {
      b.frame([-3, 4], [-23, 14], { independent: true })
      const f = b.line('f(x) = 2x^3 - 3x^2 - 12x + 1 {-2 <= x <= 3}')
      b.signChart(f, { rows: ['f1'], guides: true, a: -2, b: 3 })
    },
  },
  {
    id: 'calc-u7-separable',
    course: 'calc',
    unit: 'U7',
    help: ['calc-7'],
    title: 'A slope field and its particular solution',
    short: 'dy/dx = −x/y through (0, 2)',
    note:
      'The slope field of dy/dx = −x/y with the solution curve through (0, 2). Separating gives y dy = −x dx, so x² + y² = C, and the initial condition makes the particular solution y = √(4 − x²) on −2 < x < 2. Ask the class why the solution cannot be continued past x = ±2 (the slope is undefined where y = 0) and to sketch the solution through (0, −2) on the field (Calc 7.3, 7.7).',
    keywords: ['slope field', 'separable', 'separation of variables', 'particular solution', 'initial condition', 'differential equation', 'domain', 'free response', '7.7'],
    build: (b) => {
      b.frame([-3.5, 3.5], [-3, 3])
      b.field('dy/dx = -x/y', { through: [{ x: 0, y: 2 }] })
    },
  },
  {
    id: 'calc-u9-cycloid',
    course: 'calc',
    unit: 'U9',
    help: ['calc-9', 'calc-4'],
    title: 'Speed and distance along a cycloid',
    short: 'the cycloid t − sin t, 1 − cos t',
    note:
      'A point on a rolling wheel traces x = t − sin t, y = 1 − cos t; at t = π/2 its velocity is ⟨1, 1⟩, its speed √2 and the tangent slope dy/dx = 1. Over 0 ≤ t ≤ 2π the speed is √(2 − 2cos t) = 2 sin(t/2), so the distance traveled is ∫ 2 sin(t/2) dt = 8 while the displacement is only 2π. Ask the class where the point is momentarily at rest and what the curve does there (BC 9.3, 9.6).',
    keywords: ['parametric', 'cycloid', 'speed', 'velocity vector', 'arc length', 'distance traveled', 'displacement', 'bc', 'free response', '9.3'],
    build: (b) => {
      b.frame([-0.6, 7], [-0.8, 2.8])
      const c = b.line('(x, y) = (t - sin(t), 1 - cos(t)) {0 <= t <= 2pi}')
      b.paramCalc(c, PI / 2, { marks: true, a: 0, b: 2 * PI })
    },
  },
  {
    id: 'calc-u10-lagrange',
    course: 'calc',
    unit: 'U10',
    help: ['calc-10'],
    title: 'The Lagrange error bound for cos x',
    short: 'P₄ of cos x and its error at 1',
    note:
      'P₄(x) = 1 − x²/2 + x⁴/24 approximates cos x, and the band around it is the Lagrange bound. At x = 1 the actual error is |cos 1 − 13/24| ≈ 0.00136, under the Lagrange bound max|f⁽⁵⁾| · 1⁵/120 = sin 1/120 ≈ 0.0070 and the alternating series bound 1/720 ≈ 0.00139. Ask the class which bound is sharper here, and why the usual estimate |f⁽⁵⁾(t)| ≤ 1 gives 1/120 (BC 10.12).',
    keywords: ['lagrange error bound', 'taylor polynomial', 'remainder', 'error bound', 'alternating series error', 'maclaurin', 'cosine', 'bc', '10.12'],
    build: (b) => {
      b.frame([-4.5, 4.5], [-2.2, 2])
      const f = b.line('f(x) = cos(x)')
      b.taylor(f, 0, 4, { x: 1, band: true })
    },
  },
]

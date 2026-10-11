// ============================================================================
// src/examples/more/precalc.ts — more gallery examples (see catalog.ts for the
// ExampleDef contract). Appended to EXAMPLE_DEFS; ids are permanent.
//
// AP Precalculus, one lesson moment per AP CED topic ("PC 2.5"): Units 1–3
// are on the exam; Unit 4 (parametric functions and conics) is taught but
// not assessed. Every number in a note is asserted in
// tests/examples-more-precalc.test.ts.
// ============================================================================

import type { ExampleDef } from '../catalog'

const PI = Math.PI
const GRAY = '#9aa4b2'

export const MORE_PRECALC: readonly ExampleDef[] = [
  // ------------------------------------------------------------ Unit 1
  {
    id: 'pc-u1-rates-quadratic',
    course: 'precalc',
    unit: 'PC1',
    help: ['pc-1'],
    title: 'Average rates of change of a quadratic',
    short: 'rates of change of a thrown ball',
    note:
      'h(t) = −16t² + 64t + 5 is the height in feet of a ball t seconds after it is thrown; the table on the figure steps t by 1 second, and its average rate of change column gives 48, 16, −16 and −48 ft/sec, the slopes of secants like the two drawn on [0, 1] and [2, 3]. Those rates drop by 32 every second (the constant Δ²y), which is what makes h quadratic (PC 1.3). Ask the class when the ball is rising and how they know from the rates alone, then what the constant −32 says about the ball.',
    keywords: ['average rate of change', 'rate of change', 'secant', 'quadratic', 'second difference', 'projectile', 'table of values', 'PC 1.1', 'PC 1.2', 'PC 1.3', 'PC 1.4'],
    build: (b) => {
      b.frame([-0.6, 5.4], [-12, 82], { independent: true })
      const h = b.line('h(t) = -16t^2 + 64t + 5')
      b.secant(h, 0, 1)
      b.secant(h, 2, 3)
      b.view(h, { table: { n: 5, cols: ['d2', 'avg'], fig: true } })
      b.select(h)
    },
  },
  {
    id: 'pc-u1-slant-asymptote',
    course: 'precalc',
    unit: 'PC1',
    help: ['pc-1'],
    title: 'A rational function with a hole and a slant asymptote',
    short: 'hole, vertical and slant asymptotes',
    note:
      'f(x) = (x + 1)(x² − 4)/((x + 1)(x − 1)): the common factor x + 1 leaves a hole at (−1, 3/2), the zero of x − 1 gives the vertical asymptote x = 1, and because the numerator’s degree is one more than the denominator’s, the end behavior is the slant asymptote y = x + 1 (PC 1.7–1.10). Have the class divide x² − 4 by x − 1 to get x + 1 with remainder −3, so f(x) = x + 1 − 3/(x − 1) away from the hole. Ask which side of the slant asymptote the graph is on for large positive x, and why.',
    keywords: ['rational function', 'slant asymptote', 'oblique asymptote', 'vertical asymptote', 'hole', 'removable discontinuity', 'long division', 'end behavior', 'PC 1.7', 'PC 1.8', 'PC 1.9', 'PC 1.10'],
    build: (b) => {
      b.frame([-6, 7], [-6, 9])
      b.line('f(x) = (x + 1)(x^2 - 4)/((x + 1)(x - 1))')
    },
  },
  {
    id: 'pc-u1-model-selection',
    course: 'precalc',
    unit: 'PC1',
    help: ['pc-1'],
    title: 'Choosing a model: linear or quadratic?',
    short: 'stopping distance: choosing a model',
    note:
      'Stopping distances in feet at speeds from 20 to 70 mph, with the linear and the quadratic regressions and the linear model’s residual plot underneath. The line has r ≈ 0.992, yet its residuals run +, −, −, −, −, + in a curve, so a linear model is not appropriate, while the quadratic has R² ≈ 0.9999 and no pattern in its residuals (PC 1.13–1.14). Ask the class why a strong r is not enough, then use the quadratic to predict the stopping distance at 80 mph (about 407 ft) and say why that prediction is an extrapolation.',
    keywords: ['regression', 'model selection', 'quadratic regression', 'linear regression', 'residual', 'residual plot', 'correlation', 'extrapolation', 'stopping distance', 'PC 1.13', 'PC 1.14'],
    build: (b) => {
      b.table(
        'Stopping distance',
        [
          [20, 42],
          [30, 77],
          [40, 125],
          [50, 179],
          [60, 247],
          [70, 321],
        ],
        { xLabel: 'speed (mph)', yLabel: 'distance (ft)', regressions: ['linear', 'quadratic'], residualPlot: 'linear' },
      )
    },
  },

  // ------------------------------------------------------------ Unit 2
  {
    id: 'pc-u2-two-sequences',
    course: 'precalc',
    unit: 'PC2',
    help: ['pc-2'],
    title: 'Arithmetic or geometric through the same two terms',
    short: 'arithmetic and geometric, a₁ = 2 and a₃ = 18',
    note:
      'Both sequences have a₁ = 2 and a₃ = 18: the arithmetic one adds d = 8 (2, 10, 18, 26, …) and the geometric one multiplies by r = 3 (2, 6, 18, 54, …), and the dashed curves are the linear function y = 8x − 6 and the exponential function y = 2·3^(x − 1) they sample (PC 2.1–2.3). Ask the class to find d from (18 − 2)/2 and r from r² = 18/2, and whether r = −3 works too. Then compare the sixth terms, 42 and 486, and ask which kind of sequence eventually wins and why.',
    keywords: ['sequence', 'arithmetic sequence', 'geometric sequence', 'common difference', 'common ratio', 'linear', 'exponential', 'PC 2.1', 'PC 2.2', 'PC 2.3'],
    build: (b) => {
      b.frame([-0.5, 5.5], [-6, 62], { independent: true })
      b.sequence('a_n = 2 + 8(n - 1)', { n0: 1, count: 4, partner: true })
      b.sequence('g_n = 2(3)^(n - 1)', { n0: 1, count: 4, partner: true })
    },
  },
  {
    id: 'pc-u2-exp-two-points',
    course: 'precalc',
    unit: 'PC2',
    help: ['pc-2'],
    title: 'An exponential model from two points',
    short: 'a car’s value from two points',
    note:
      'A car is worth $24,000 one year after it is bought and $15,360 three years after; the exponential V(x) = 30000(0.8)^x passes through both points A and B (PC 2.5). Dividing gives b² = 15360/24000 = 0.64, so b = 0.8 and the car loses 20% of its value each year, and a = 24000/0.8 = 30,000 is its price new. Ask the class to set up the two equations before you reveal the curve, then to find when the car is worth half its price (log base 0.8 of 0.5 ≈ 3.11 years).',
    keywords: ['exponential model', 'two points', 'growth factor', 'decay', 'depreciation', 'percent change', 'half-life', 'PC 2.5'],
    build: (b) => {
      b.frame([-1, 11], [-3000, 34000], { independent: true })
      const v = b.line('V(x) = 30000(0.8)^x')
      b.shape('A = (1, 24000)')
      b.shape('B = (3, 15360)')
      b.select(v)
    },
  },
  {
    id: 'pc-u2-exp-residuals',
    course: 'precalc',
    unit: 'PC2',
    help: ['pc-2'],
    title: 'An exponential regression and its residuals',
    short: 'penicillin: exponential regression and residuals',
    note:
      'The penicillin in a patient’s bloodstream (mg), measured every hour, with the exponential regression y = 500.19(0.7465)^x and its residual plot underneath. The residuals scatter above and below 0 with no pattern, so an exponential model is appropriate, and b ≈ 0.7465 says about 25.3% of the drug is eliminated each hour (PC 2.6). Ask the class to predict the amount after 8 hours (about 48 mg), then why a linear model could not work here.',
    keywords: ['exponential regression', 'residual', 'residual plot', 'decay', 'data modeling', 'model validation', 'PC 2.6'],
    build: (b) => {
      b.table(
        'Penicillin',
        [
          [0, 500],
          [1, 372],
          [2, 280],
          [3, 208],
          [4, 155],
          [5, 117],
          [6, 86],
        ],
        { xLabel: 't (hours)', yLabel: 'amount (mg)', regressions: ['exponential'], residualPlot: 'exponential' },
      )
    },
  },
  {
    id: 'pc-u2-exp-equation',
    course: 'precalc',
    unit: 'PC2',
    help: ['pc-2'],
    title: 'An exponential equation with two bases',
    short: '2ˣ = 3^(x − 1), solved exactly',
    note:
      'f(x) = 2ˣ and g(x) = 3^(x − 1) meet once, at x = ln 3/(ln 3 − ln 2) ≈ 2.7095, and the card writes the exact logarithm beside the decimal (PC 2.13). Taking ln of both sides gives x ln 2 = (x − 1) ln 3, and collecting the x terms finishes it. Ask the class to do the algebra by hand, then to read from the graph where 2ˣ > 3^(x − 1) (for x < 2.7095).',
    keywords: ['exponential equation', 'logarithm', 'natural log', 'solve with logs', 'exact form', 'intersection', 'exponential inequality', 'PC 2.13'],
    build: (b) => {
      b.frame([-2, 5], [-1.5, 13], { independent: true })
      const f = b.line('f(x) = 2^x')
      b.line('g(x) = 3^(x - 1)')
      b.select(f)
    },
  },

  // ------------------------------------------------------------ Unit 3
  {
    id: 'pc-u3-ferris-wheel',
    course: 'precalc',
    unit: 'PC3',
    help: ['pc-3'],
    title: 'A sinusoid from a maximum and a minimum',
    short: 'Ferris wheel: h(t) from max and min',
    note:
      'A Ferris wheel rider is 2 m above the ground at the bottom (t = 0) and 42 m at the top 4 minutes later, so the midline is (42 + 2)/2 = 22, the amplitude (42 − 2)/2 = 20 and the period 8 minutes, giving h(t) = 22 − 20cos(πt/4) (PC 3.6–3.7). Select the curve to see the key points of one cycle; the dashed line y = 32 meets it first at t = 8/3 minutes. Ask the class why the cosine is negated, then to find 8/3 by hand from cos(πt/4) = −1/2.',
    keywords: ['sinusoid', 'sinusoidal model', 'ferris wheel', 'amplitude', 'midline', 'period', 'maximum', 'minimum', 'trig equation', 'PC 3.6', 'PC 3.7'],
    build: (b) => {
      b.frame([-1, 17], [-6, 48], { independent: true })
      b.line('y = 32', { dash: [6, 5], color: GRAY, strokeWidth: 1.5 })
      const h = b.line('h(t) = 22 - 20cos(pi t/4)')
      b.select(h)
    },
  },
  {
    id: 'pc-u3-trig-inequality',
    course: 'precalc',
    unit: 'PC3',
    help: ['pc-3'],
    title: 'A trig inequality and its general solution',
    short: '2cos x + 1 < 0',
    kind: 'number-line',
    note:
      '2cos x + 1 < 0 is solved over one period, 0 ≤ x < 2π: the critical values are where cos x = −1/2, x = 2π/3 and 4π/3, and the test points give the solution (2π/3, 4π/3) (PC 3.10). Every solution plus a multiple of 2π is also a solution, so the general solution is 2π/3 + 2kπ < x < 4π/3 + 2kπ for integers k. Ask the class to find the critical values on the unit circle first, then press Show on graph and point to where y = 2cos x + 1 is below the axis.',
    keywords: ['trig inequality', 'trigonometric equation', 'general solution', 'period', 'unit circle', 'cosine', 'test point', 'PC 3.10'],
    build: (b) => {
      b.frame([-0.8, 7.2])
      b.solve('2cos(x) + 1 < 0', { signs: true, tests: true })
    },
  },
  {
    id: 'pc-u3-polar-limacon',
    course: 'precalc',
    unit: 'PC3',
    help: ['pc-3'],
    title: 'A limaçon and the rate of change of r',
    short: 'the limaçon r = 1 + 2cos θ',
    note:
      'r = 1 + 2cos θ is a limaçon with an inner loop: r = 3 at θ = 0, r = 0 at θ = 2π/3 and 4π/3, and r < 0 between them, which traces the inner loop. The card evaluates θ = π/3, where r = 2 and dr/dθ = −2sin θ = −√3 < 0, so r is decreasing and the point is moving toward the pole (PC 3.13–3.15). Ask the class where the distance from the pole is increasing, on (2π/3, π) and (4π/3, 2π), and why r < 0 counts.',
    keywords: ['polar', 'limacon', 'limaçon', 'inner loop', 'rate of change', 'dr/dθ', 'pole', 'polar graph', 'PC 3.13', 'PC 3.14', 'PC 3.15'],
    build: (b) => {
      b.polarGrid()
      b.frame([-2, 4.5], [-2.5, 2.5])
      const r = b.line('r = 1 + 2cos(theta)')
      b.paramCalc(r, PI / 3)
    },
  },

  // ------------------------------------------------------------ Unit 4 (not on the exam)
  {
    id: 'pc-u4-particle-motion',
    course: 'precalc',
    unit: 'PC4',
    help: ['pc-4'],
    title: 'A particle in the plane: parametric motion',
    short: 'a particle on a figure eight',
    note:
      'A particle moves along (x(t), y(t)) = (2cos t, sin 2t) for 0 ≤ t ≤ 2π, a figure eight that passes through the origin twice. The card evaluates t = π/2, where dx/dt = −2 and dy/dt = −2, so the particle is moving left and down along a slope of 1; at t = 3π/2 it crosses the same point moving right and down, along a slope of −1 (PC 4.1–4.3). Ask the class on which interval x(t) is decreasing (0 < t < π) and where the motion is momentarily straight up or down (t = 0 and π, at (±2, 0)), then press play to check.',
    keywords: ['parametric', 'parametric function', 'particle motion', 'direction of motion', 'dx/dt', 'dy/dt', 'figure eight', 'lissajous', 'vertical tangent', 'PC 4.1', 'PC 4.2', 'PC 4.3'],
    build: (b) => {
      b.frame([-3.2, 3.2], [-1.8, 1.8])
      const c = b.line('(x, y) = (2cos(t), sin(2t)) {0 <= t <= 2pi}')
      b.paramCalc(c, PI / 2, { marks: true })
    },
  },
  {
    id: 'pc-u4-ellipse-parametric',
    course: 'precalc',
    unit: 'PC4',
    help: ['pc-4'],
    title: 'An ellipse, implicitly and parametrically',
    short: 'x²/9 + y²/4 = 1 and (3cos t, 2sin t)',
    note:
      'The ellipse x²/9 + y²/4 = 1 is typed implicitly, and its construction shows the vertices (±3, 0), the co-vertices (0, ±2) and the foci (±√5, 0), since c² = 9 − 4 = 5; drawn over it is the parametric function (3cos t, 2sin t) for 0 ≤ t ≤ 2π (PC 4.4–4.6). Because cos²t + sin²t = 1, every point (3cos t, 2sin t) satisfies (x/3)² + (y/2)² = 1, and as t increases the particle runs counterclockwise from (3, 0), with dy/dx = −2/3 at t = π/4. Ask the class which interval of t traces only the top half, then for a parametrization that runs clockwise.',
    keywords: ['ellipse', 'conic section', 'implicit', 'parametric', 'parametrization', 'foci', 'vertices', 'eliminate the parameter', 'counterclockwise', 'PC 4.4', 'PC 4.5', 'PC 4.6'],
    build: (b) => {
      b.frame([-3.6, 3.6], [-2.4, 2.4])
      const e = b.line('x^2/9 + y^2/4 = 1')
      b.view(e, { construction: true })
      const p = b.line('(x, y) = (3cos(t), 2sin(t)) {0 <= t <= 2pi}')
      b.paramCalc(p, PI / 4)
    },
  },
]

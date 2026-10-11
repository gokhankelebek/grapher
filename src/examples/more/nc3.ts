// ============================================================================
// src/examples/more/nc3.ts — more gallery examples (see catalog.ts for the
// ExampleDef contract). Appended to EXAMPLE_DEFS; ids are permanent.
//
// NC Math 3 (2016 NC SCOS), unit tag M3. Every number a note states is
// asserted in tests/examples-more-nc3.test.ts.
// ============================================================================

import type { ExampleDef } from '../catalog'

const PI = Math.PI

export const MORE_NC3: readonly ExampleDef[] = [
  {
    id: 'm3-remainder-theorem',
    course: 'math3',
    unit: 'M3',
    help: ['m3-poly'],
    title: 'The Remainder Theorem by synthetic division',
    short: 'remainder theorem for x³ − 4x² + x + 6',
    note:
      'On the card’s Table, synthetic division of f(x) = x³ − 4x² + x + 6 by (x − 1) leaves the quotient x² − 3x − 2 and the remainder 4, and the dot on the graph shows f(1) = 4: the remainder is the value. Ask the class to change a to 2 on the card, get remainder 0, and say why that makes (x − 2) a factor and what the zeros of f must be. Honors extension: why are ±1, ±2, ±3 and ±6 the only rational a worth trying?',
    keywords: ['remainder theorem', 'factor theorem', 'synthetic division', 'polynomial division', 'quotient', 'remainder', 'rational root theorem', 'A-APR.2', 'NC.M3.A-APR.2', 'A-APR.3'],
    build: (b) => {
      b.frame([-2.5, 4.5], [-5, 9], { independent: true })
      const f = b.line('f(x) = x^3 - 4x^2 + x + 6')
      b.view(f, { table: { div: '1', ev: 'f(1)' } })
      b.select(f)
    },
  },
  {
    id: 'm3-extraneous-rational',
    course: 'math3',
    unit: 'M3',
    help: ['m3-ineq', 'm3-poly'],
    title: 'A rational equation with an extraneous solution',
    short: 'x/(x − 3) + 1/x = 3/(x − 3)',
    kind: 'number-line',
    note:
      'Multiplying both sides by the LCD x(x − 3) gives x² − 2x − 3 = 0, so the candidates are x = −1 and x = 3; the card’s Algebraic route keeps −1 and rejects 3, which makes a denominator 0. Ask the class why multiplying by an expression that can be 0 lets a false solution in, then press Show on graph and look for what happens at x = 3.',
    keywords: ['rational equation', 'extraneous', 'extraneous solution', 'LCD', 'least common denominator', 'excluded value', 'check', 'candidate', 'A-REI.2', 'NC.M3.A-REI.2', 'A-REI.1'],
    build: (b) => {
      b.frame([-4, 5])
      b.solve('x/(x - 3) + 1/x = 3/(x - 3)')
    },
  },
  {
    id: 'm3-temperature-inverse',
    course: 'math3',
    unit: 'M3',
    help: ['m3-functions'],
    title: 'Celsius to Fahrenheit and back: a linear inverse',
    short: 'Celsius and Fahrenheit inverses',
    note:
      'f(C) = (9/5)C + 32 turns Celsius into Fahrenheit, and its reflection in y = x is the inverse f⁻¹(F) = (5/9)(F − 32); the probe joins (10, 50) on f to (50, 10) on f⁻¹. Ask the class to find the inverse by swapping and solving, then to explain why f and f⁻¹ cross at (−40, −40), the one temperature that reads the same on both scales. Honors extension: must a function and its inverse always meet on y = x?',
    keywords: ['inverse', 'inverse function', 'linear', 'celsius', 'fahrenheit', 'temperature', 'reflection', 'y = x', 'swap x and y', 'F-BF.4', 'NC.M3.F-BF.4'],
    build: (b) => {
      b.frame([-75, 90], [-60, 70])
      const f = b.line('f(x) = (9/5)x + 32')
      b.view(f, { reflect: 10 })
      b.inverse(f)
      b.select(f)
    },
  },
  {
    id: 'm3-parking-piecewise',
    course: 'math3',
    unit: 'M3',
    help: ['m3-functions', 'm3-ineq'],
    title: 'A parking garage’s step function',
    short: 'parking cost C(t)',
    note:
      'The garage charges $3 for the first hour or any part of it, $2 for each extra hour or part, and never more than $15 a day, so for t hours C(t) = 3 + 2⌈t − 1⌉ up to 6 hours and 15 after that. The table evaluates C(2.5) = 7, and every step ends in a closed dot: C(3) = 7 but C(3.01) = 9. Ask the class where C jumps and by how much, and why the cap starts just after 6 hours.',
    keywords: ['piecewise', 'step function', 'ceiling', 'jump', 'jump discontinuity', 'open dot', 'closed dot', 'cost', 'context', 'F-IF.2', 'NC.M3.F-IF.2', 'F-IF.7', 'NC.M3.F-IF.7'],
    build: (b) => {
      b.frame([-0.8, 12.8], [-1.5, 17], { independent: true })
      const c = b.line('C(t) = {3 + 2ceil(t - 1) if 0 < t <= 6, 15 if 6 < t <= 12}')
      b.view(c, { table: { ev: 'C(2.5)' } })
      b.select(c)
    },
  },
  {
    id: 'm3-unit-circle-radians',
    course: 'math3',
    unit: 'M3',
    help: ['m3-trig'],
    title: 'Radians on the unit circle: 7π/6',
    short: 'the unit circle at 7π/6',
    note:
      'On the unit circle an angle in radians is the arc it cuts off, so θ = 7π/6 ≈ 3.67 is that far around from (1, 0): P = (−√3/2, −1/2) in Quadrant III, with reference angle π/6. Ask the class to reflect the point for π/6 across the axes to find 5π/6, 7π/6 and 11π/6 and say which signs change, then why 7π/6 + 2π lands on the same point.',
    keywords: ['unit circle', 'radian', 'radian measure', 'arc length', 'reference angle', 'special angles', 'quadrant', 'coterminal', 'symmetry', 'F-TF.1', 'F-TF.2', 'NC.M3.F-TF.1', 'NC.M3.F-TF.2'],
    build: (b) => {
      b.decimalAxis()
      b.frame([-1.95, 1.95], [-1.3, 1.3])
      b.unitCircle({ theta: (7 * PI) / 6, center: { x: 0, y: 0 }, show: { astc: true } })
    },
  },
  {
    id: 'm3-tide-sinusoid',
    course: 'math3',
    unit: 'M3',
    help: ['m3-trig'],
    title: 'Modeling the tide with a sine function',
    short: 'the tide: 3 sin(πt/6) + 8',
    note:
      'd(t) = 3 sin(πt/6) + 8 is the water depth in feet t hours after 9 AM, over the next day (0 ≤ t ≤ 24): amplitude 3, period 2π ÷ (π/6) = 12 hours, midline 8 ft, so high tide is 11 ft at noon and low tide 5 ft at 6 PM. A boat needs 9.5 ft, and the line y = 9.5 meets the curve at t = 1, 5, 13 and 17. Ask the class to solve sin(πt/6) = 1/2 by hand and turn the answer into clock times.',
    keywords: ['sinusoid', 'sine', 'tide', 'periodic', 'amplitude', 'period', 'midline', 'model', 'context', 'F-TF.5', 'NC.M3.F-TF.5', 'F-IF.4'],
    build: (b) => {
      // hours, not radians: the tick marks read 0, 5, 10 … rather than π, 2π …
      b.decimalAxis()
      b.frame([-1, 25], [-1, 13], { independent: true })
      const d = b.line('d(t) = 3sin(pi t/6) + 8 {0 <= t <= 24}')
      b.line('y = 9.5', { color: '#9aa4b2', strokeWidth: 2 })
      b.select(d)
    },
  },
  {
    id: 'm3-tangent-diameter',
    course: 'math3',
    unit: 'M3',
    help: ['m3-geo'],
    title: 'A tangent ⟂ its radius, and an angle on a diameter',
    short: 'tangent and diameter',
    note:
      'P (4, 3) and Q (−2, −5) are the ends of a diameter of (x − 1)² + (y + 1)² = 25, so the inscribed angle ∠PRQ at R (−3, 2) is 90°. The tangent at P is y = −(3/4)x + 6: the radius OP has slope 4/3 and (4/3)(−3/4) = −1. Ask the class to check ∠PRQ with slopes (RP has slope 1/7 and RQ −7), then why the tangent at Q is parallel to the one at P.',
    keywords: ['tangent', 'radius', 'perpendicular', 'diameter', 'inscribed angle', 'right angle', 'Thales', 'circle theorem', 'tangent line equation', 'G-C.2', 'NC.M3.G-C.2'],
    build: (b) => {
      b.frame([-8, 10], [-7.5, 5.5])
      const c = b.line('(x - 1)^2 + (y + 1)^2 = 25')
      b.circle(c, { pts: ['(4, 3)', '(-2, -5)', '(-3, 2)'], show: ['angles', 'tangent'] })
      b.select(c)
    },
  },
  {
    id: 'm3-sampling-margin',
    course: 'math3',
    unit: 'M3',
    help: ['m3-stats'],
    title: 'A poll’s margin of error by simulation',
    short: 'margin of error for a poll',
    note:
      'In a poll of 100 students, 58 would buy a yearbook. The simulation draws 1000 samples of 100 from a population with p = 0.58: the sample proportions pile up around 0.58 with SD close to √(0.58 · 0.42/100) ≈ 0.049, so the 95% margin of error is about 0.10 and the interval runs from about 0.48 to 0.68. Ask the class whether the staff can claim a majority, and how large n must be to halve the margin (four times as large: 400).',
    keywords: ['simulation', 'sampling distribution', 'sample proportion', 'margin of error', 'confidence interval', 'poll', 'survey', 'inference', 'S-IC.4', 'NC.M3.S-IC.4', 'S-IC.1'],
    build: (b) => {
      b.simulation({ pop: 'proportion', p: 0.58, stat: 'proportion', n: 100, reps: 1000, observed: 0.58, seed: 2016 })
    },
  },
]

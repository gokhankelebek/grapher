// ============================================================================
// src/examples/catalog.ts — the examples gallery, one entry per lesson.
//
// Each entry is a recipe in the teacher's own words: the lines to type and
// what to switch on, carried out by ExampleBoard (src/examples/builder.ts)
// through the App's construction path. Adding an example is one entry here:
//
//   {
//     id: 'calc-u2-secant',            // stable: never rename one
//     course: 'calc', unit: 'U2', help: ['calc-2'],
//     title: 'The derivative as a limit of secants',
//     short: 'secants to the tangent', // → "Example: U2 — secants to the tangent"
//     note: 'What to show and what to ask, in two or three sentences.',
//     build: (b) => { const f = b.line('f(x) = x^2'); b.secant(f, 1, 3); b.frame([-2, 4], [-2, 10]) },
//   },
//
// `help` names the help sheet's unit sections (src/ui/commands.ts
// HELP_SECTIONS) whose "See an example" opens this one. tests/examples.test.ts
// loads every entry through deserializeDoc (zero problems), renders its
// thumbnail scene and checks its note.
// ============================================================================

import type { BoardKind } from '../core/types'
import type { ExampleBoard } from './builder'

export type ExampleCourse = 'calc' | 'precalc' | 'math1' | 'math2' | 'math3'

export const COURSE_NAMES: Record<ExampleCourse, string> = {
  calc: 'AP Calculus AB / BC',
  precalc: 'AP Precalculus',
  math1: 'NC Math 1',
  math2: 'NC Math 2',
  math3: 'NC Math 3',
}

export const COURSE_ORDER: readonly ExampleCourse[] = ['calc', 'precalc', 'math1', 'math2', 'math3']

export interface ExampleDef {
  /** Stable id (a gallery link and a test name). Never rename one. */
  id: string
  course: ExampleCourse
  /** The unit tag in the document name: U5, PC2, M1, M2, M3. */
  unit: string
  /** The help sheet sections (HELP_SECTIONS ids) that link here; the first is its home unit. */
  help: readonly string[]
  /** The card's title. */
  title: string
  /** The document name's tail: "Example: U5 — graph of f′". */
  short: string
  /** What to show, what to ask the class: two or three sentences. */
  note: string
  /** Extra search words (the title, note and unit are searched already). */
  keywords?: readonly string[]
  /** A number line rather than a graph. */
  kind?: BoardKind
  build(b: ExampleBoard): void
}

const PI = Math.PI

export const EXAMPLE_DEFS: readonly ExampleDef[] = [
  // ======================================================== AP Calculus
  {
    id: 'calc-u1-holes-jumps',
    course: 'calc',
    unit: 'U1',
    help: ['calc-1'],
    title: 'Limits at a hole and at a jump',
    short: 'hole and jump',
    note:
      'f has a removable hole at x = 3 and the step function g jumps at x = 2; each limit card has its table of values on. Ask the class to read lim f(x) as x → 3 from the table even though f(3) does not exist, then why lim g(x) as x → 2 does not exist while both one-sided limits do.',
    keywords: ['removable discontinuity', 'jump discontinuity', 'floor', 'greatest integer', 'one-sided', 'table'],
    build: (b) => {
      b.frame([-1.5, 6], [-1.5, 9.5])
      const g = b.line('g(x) = floor(x)')
      b.limit(g, 2, { table: true })
      const f = b.line('f(x) = (x^2 - 9)/(x - 3)')
      b.limit(f, 3, { table: true })
      b.select(f)
    },
  },
  {
    id: 'calc-u1-epsilon-delta',
    course: 'calc',
    unit: 'U1',
    help: ['calc-1'],
    title: 'ε–δ: the limit of x² at 2',
    short: 'ε–δ for x² at 2',
    note:
      'The horizontal band is L ± ε around 4 and the vertical band is the δ it forces around x = 2. Drag ε smaller on the card and watch δ shrink with it; ask why δ is set by the steeper (right-hand) side of the parabola.',
    keywords: ['epsilon', 'delta', 'formal definition', 'precise definition'],
    build: (b) => {
      b.frame([0, 3.6], [-0.5, 7])
      const f = b.line('f(x) = x^2')
      b.limit(f, 2, { epsilon: true, eps: 0.75 })
    },
  },
  {
    id: 'calc-u2-secant-tangent',
    course: 'calc',
    unit: 'U2',
    help: ['calc-2'],
    title: 'The derivative as a limit of secants',
    short: 'secants to the tangent',
    note:
      'The secant from x = 1 to x = 3 has slope 4; drag b toward 1 and the slope closes in on 2, the slope of the tangent line at x = 1. The dashed curve is f′(x) = 2x — ask the class to read f′(1) off it and say why it matches the limiting secant slope.',
    keywords: ['difference quotient', 'average rate of change', 'instantaneous rate', 'tangent line', 'definition of derivative'],
    build: (b) => {
      b.frame([-2.5, 4.5], [-2, 10])
      const f = b.line('f(x) = x^2')
      b.derivative(f)
      b.tangent(f, 1)
      b.secant(f, 1, 3)
    },
  },
  {
    id: 'calc-u3-implicit-circle',
    course: 'calc',
    unit: 'U3',
    help: ['calc-3'],
    title: 'Implicit differentiation on a circle',
    short: 'tangents to x² + y² = 25',
    note:
      'dy/dx = −x/y comes from differentiating x² + y² = 25 implicitly; the tangent is at (3, 4), with slope −3/4. The marked points are where the tangent is horizontal (y′ = 0) or vertical (y′ undefined) — ask the class to predict them from −x/y before you drag the point around.',
    keywords: ['implicit', 'dy/dx', 'horizontal tangent', 'vertical tangent', 'circle'],
    build: (b) => {
      b.frame([-8, 8], [-6.5, 6.5])
      const c = b.line('x^2 + y^2 = 25')
      b.tangent(c, 3, { y: 4, marks: true })
    },
  },
  {
    id: 'calc-u3-implicit-folium',
    course: 'calc',
    unit: 'U3',
    help: ['calc-3'],
    title: 'The folium of Descartes',
    short: 'the folium x³ + y³ = 6xy',
    note:
      'Implicit differentiation gives dy/dx = (2y − x²)/(y² − 2x); the tangent sits at (3, 3), where the slope is −1. Ask the class which points make the numerator zero (horizontal tangents) and which make the denominator zero (vertical), then check against the marked points.',
    keywords: ['folium', 'implicit', 'horizontal tangent', 'vertical tangent'],
    build: (b) => {
      b.frame([-4.5, 6], [-4.5, 6])
      const c = b.line('x^3 + y^3 = 6x y')
      b.tangent(c, 3, { y: 3, marks: true })
    },
  },
  {
    id: 'calc-u4-ladder',
    course: 'calc',
    unit: 'U4',
    help: ['calc-4'],
    title: 'Related rates: the sliding ladder',
    short: 'the ladder, when x = 6',
    note:
      'The foot of a 10 ft ladder slides away from the wall; the instant is set to "when x = 6", so y = 8. Have the class differentiate x² + y² = 100 and find dy/dt before you reveal the card, then press play and watch the rate graph — why does the top speed up as it falls?',
    keywords: ['related rates', 'ladder', 'pythagorean', 'rates of change'],
    build: (b) => {
      b.relatedRatesProblem('ladder', { when: { q: 'x', v: 6 } })
    },
  },
  {
    id: 'calc-u5-graph-of-fprime',
    course: 'calc',
    unit: 'U5',
    help: ['calc-5'],
    title: 'The graph of f′ is shown',
    short: 'graph of f′',
    note:
      'The curve on the board is f′, not f — the sign chart reads it that way, with f′ and f″ rows, arrows and concavity. Ask where f has relative extrema and why x = 1 is not one (f′ touches zero but does not change sign); then where f is concave up.',
    keywords: ['first derivative test', 'second derivative', 'increasing', 'decreasing', 'concavity', 'sign chart', 'free response'],
    build: (b) => {
      b.frame([-4.5, 5.5], [-3.5, 3.5])
      const fp = b.line('y = (x + 3)(x - 1)^2(x - 4)/20')
      b.signChart(fp, { as: 'f1', rows: ['f1', 'f2'], arrows: true, cup: true, guides: true })
    },
  },
  {
    id: 'calc-u5-mvt',
    course: 'calc',
    unit: 'U5',
    help: ['calc-5', 'calc-2'],
    title: 'The Mean Value Theorem on x³',
    short: 'MVT on x³ over [−2, 2]',
    note:
      'The secant over [−2, 2] has slope 4, and the MVT points are where f′(c) = 3c² = 4, c = ±2/√3 — two of them, each with its parallel tangent. Ask the class to check the hypotheses on the card first, then to find c by hand.',
    keywords: ['mean value theorem', 'mvt', 'average rate of change', 'secant', 'parallel tangent'],
    build: (b) => {
      b.frame([-3, 3], [-10, 10], { independent: true })
      const f = b.line('f(x) = x^3')
      b.secant(f, -2, 2, { mvt: true })
    },
  },
  {
    id: 'calc-u6-riemann',
    course: 'calc',
    unit: 'U6',
    help: ['calc-6'],
    title: 'Riemann sums converging',
    short: 'Riemann sums, n = 4 and n = 50',
    note:
      'f(x) = x²/2 + 1 is symmetric, so the regions over [−4, 0] and [0, 4] have the same area, 44/3 ≈ 14.67. On the right is a left sum with n = 4; on the left, a right sum with n = 50 (the mirror image of a left sum, so it errs the same way). Compare the two sums on the cards with 44/3 — ask why both underestimate here, and what happens to the gap as n grows.',
    keywords: ['riemann sum', 'left sum', 'right sum', 'rectangles', 'definite integral', 'approximation'],
    build: (b) => {
      b.frame([-5, 5], [-1, 10])
      const f = b.line('f(x) = x^2/2 + 1')
      b.view(f, { showParent: false })
      b.riemann(f, -4, 0, 50, 'right')
      b.riemann(f, 0, 4, 4, 'left')
    },
  },
  {
    id: 'calc-u6-accumulation',
    course: 'calc',
    unit: 'U6',
    help: ['calc-6'],
    title: 'An accumulation function from a piecewise f',
    short: 'g(x) = ∫₀ˣ f(t) dt',
    note:
      'f is piecewise linear and g(x) = ∫₀ˣ f(t) dt is the lighter curve; the probe at x = 3 shades the area that g(3) = 4 adds up. Ask where g is increasing, where it has its maximum (where f changes sign), and why g is linear where f is constant.',
    keywords: ['accumulation', 'fundamental theorem', 'ftc', 'piecewise', 'area function', 'free response'],
    build: (b) => {
      b.frame([-1, 7], [-2.5, 6])
      const f = b.line('f(x) = {2 if x < 1, 3 - x if 1 <= x <= 4, -1 if x > 4}')
      b.accumulation(f, 0, { x: 3 })
    },
  },
  {
    id: 'calc-u7-euler',
    course: 'calc',
    unit: 'U7',
    help: ['calc-7'],
    title: "Slope field and Euler's method",
    short: "Euler with h = 0.5 and 0.25",
    note:
      "Two Euler runs from (0, 1) along dy/dx = x + y — h = 0.5 (two steps, labelled) and h = 0.25 (four) — with the true solution dashed. Ask the class to do the h = 0.5 table by hand, then explain why both runs fall below the true curve here (it is concave up).",
    keywords: ['euler', 'slope field', 'differential equation', 'step size', 'approximation'],
    build: (b) => {
      b.frame([-1.5, 2], [-1, 4.5])
      b.field('dy/dx = x + y', {
        euler: [
          { x0: 0, y0: 1, h: 0.5, n: 2, labels: true },
          { x0: 0, y0: 1, h: 0.25, n: 4, showTrue: true },
        ],
      })
    },
  },
  {
    id: 'calc-u7-logistic',
    course: 'calc',
    unit: 'U7',
    help: ['calc-7'],
    title: 'Logistic growth and its slope field',
    short: 'logistic growth',
    note:
      'P(t) = 10/(1 + 9e^(−0.8t)) solves dP/dt = 0.8P(1 − P/10); its slope field is drawn behind it with the curve as the solution through (0, 1). Ask where the population grows fastest (at P = L/2 = 5) and what happens to solutions that start above 10.',
    keywords: ['logistic', 'carrying capacity', 'slope field', 'differential equation', 'bc'],
    build: (b) => {
      b.frame([-2, 12], [-1.5, 12])
      const p = b.line('P(x) = 10/(1 + 9e^(-0.8x))')
      b.logisticField(p)
    },
  },
  {
    id: 'calc-u8-area-between',
    course: 'calc',
    unit: 'U8',
    help: ['calc-8'],
    title: 'Area between two curves',
    short: 'area between curves',
    note:
      'The region between f(x) = 4 − x² and g(x) = x + 2 runs between their intersections at x = −2 and x = 1, and its area is ∫(f − g) dx = 9/2. Ask the class to find the bounds by setting f = g, then to say which curve is on top.',
    keywords: ['area between curves', 'top minus bottom', 'definite integral', 'intersection'],
    build: (b) => {
      b.frame([-3.5, 2.5], [-1.5, 5])
      const f = b.line('f(x) = 4 - x^2')
      const g = b.line('g(x) = x + 2')
      b.view(f, { showParent: false }).view(g, { showParent: false })
      b.area(f, -2, 1, { other: g })
      b.select(f)
    },
  },
  {
    id: 'calc-u8-washers',
    course: 'calc',
    unit: 'U8',
    help: ['calc-8'],
    title: 'Washers about y = 2',
    short: 'washers about y = 2',
    note:
      'The region between y = x and y = x² on [0, 1] is revolved about the line y = 2, so each slice is a washer with outer radius 2 − x² and inner radius 2 − x. Ask the class for both radii before showing the card’s integral, then why the outer radius belongs to x² here.',
    keywords: ['volume', 'washer', 'solid of revolution', 'axis of revolution', 'disk'],
    build: (b) => {
      b.frame([-1, 2.5], [-0.75, 4.5])
      const f = b.line('f(x) = x')
      const g = b.line('g(x) = x^2')
      b.line('y = 2', { dash: [6, 5], color: '#9aa4b2', strokeWidth: 1.5 })
      b.volume(f, 0, 1, { other: g, axis: { dir: 'h', at: 2 }, x: 0.5 })
      b.select(f)
    },
  },
  {
    id: 'calc-u8-cross-sections',
    course: 'calc',
    unit: 'U8',
    help: ['calc-8'],
    title: 'Square cross-sections',
    short: 'square cross-sections',
    note:
      'The base is the region under y = √x on [0, 4]; every cross-section perpendicular to the x-axis is a square of side √x, so V = ∫₀⁴ x dx = 8. Drag the slice along the base and ask for its area as a function of x.',
    keywords: ['cross sections', 'known cross section', 'square', 'volume', 'slice'],
    build: (b) => {
      b.frame([-1, 5], [-1, 3])
      const f = b.line('f(x) = sqrt(x)')
      b.volume(f, 0, 4, { method: 'section', section: 'square', x: 2 })
    },
  },
  {
    id: 'calc-u9-polar-area',
    course: 'calc',
    unit: 'U9',
    help: ['calc-9'],
    title: 'Polar area between two curves',
    short: 'inside 3 sin θ, outside 1 + sin θ',
    note:
      'The shaded region is inside r = 3 sin θ and outside r = 1 + sin θ, between their meetings at θ = π/6 and 5π/6; its area is ½∫(R² − r²) dθ = π. Ask the class to find the bounds by setting 3 sin θ = 1 + sin θ, and which curve is R.',
    keywords: ['polar', 'area', 'polar area', 'bc', 'cardioid', 'circle'],
    build: (b) => {
      b.polarGrid()
      b.frame([-3, 3], [-1, 3.5])
      const big = b.line('r = 3sin(theta)')
      const small = b.line('r = 1 + sin(theta)')
      b.polarBetween(big, small)
    },
  },
  {
    id: 'calc-u9-parametric-cusp',
    course: 'calc',
    unit: 'U9',
    help: ['calc-9'],
    title: 'A parametric curve with a cusp',
    short: 'x = t², y = t³: tangent and cusp',
    note:
      'For x = t², y = t³, dy/dx = 3t/2, and the tangent is drawn at t = 1 with slope 3/2. At t = 0 both dx/dt and dy/dt are zero — a cusp, marked on the board. Ask the class what dy/dx does as t → 0 from either side and why the curve has no tangent slope there.',
    keywords: ['parametric', 'dy/dx', 'cusp', 'singular point', 'bc', 'tangent'],
    build: (b) => {
      b.frame([-1, 3], [-3.5, 3.5])
      const c = b.line('(x, y) = (t^2, t^3) {-1.5 <= t <= 1.5}')
      b.paramCalc(c, 1, { marks: true })
    },
  },
  {
    id: 'calc-u10-taylor-sin',
    course: 'calc',
    unit: 'U10',
    help: ['calc-10'],
    title: 'Taylor polynomials of sin x',
    short: 'Taylor polynomials of sin x',
    note:
      'P₃ and P₇ of sin x about 0 hug the sine for longer as the degree grows. Step n up and down on the card and ask the class where each polynomial peels away — and why only odd powers appear.',
    keywords: ['taylor', 'maclaurin', 'polynomial approximation', 'sine', 'bc'],
    build: (b) => {
      b.piAxis()
      b.frame([-2 * PI, 2 * PI], [-3, 3])
      const f = b.line('f(x) = sin(x)')
      b.taylor(f, 0, 3)
      b.taylor(f, 0, 7)
    },
  },
  {
    id: 'calc-u10-ln-convergence',
    course: 'calc',
    unit: 'U10',
    help: ['calc-10'],
    title: 'Interval of convergence of ln(1 + x)',
    short: 'ln(1 + x) and its interval of convergence',
    note:
      'P₈ of ln(1 + x) about 0 follows the curve only on (−1, 1]; the interval of convergence is marked on the x-axis. Ask the class to run the ratio test on Σ(−1)ⁿ⁺¹xⁿ/n and to check both endpoints — why is x = 1 in and x = −1 out?',
    keywords: ['interval of convergence', 'radius of convergence', 'taylor series', 'ratio test', 'logarithm', 'bc'],
    build: (b) => {
      b.frame([-1.6, 2.2], [-3, 2])
      const f = b.line('f(x) = ln(1 + x)')
      b.view(f, { showParent: false })
      b.taylor(f, 0, 8, { ioc: true })
    },
  },
  {
    id: 'calc-u10-alternating',
    course: 'calc',
    unit: 'U10',
    help: ['calc-10'],
    title: 'The alternating harmonic series',
    short: 'Σ(−1)ⁿ⁺¹/n and its error bound',
    note:
      'The dots are the terms (−1)ⁿ⁺¹/n and the joined rings are the partial sums, closing in on ln 2 ≈ 0.693. The card states the alternating series error bound |S − S₁₀| ≤ 1/11 — ask the class why the first omitted term bounds the error.',
    keywords: ['alternating series', 'error bound', 'partial sums', 'harmonic', 'convergence', 'bc'],
    build: (b) => {
      b.frame([-1, 21], [-0.7, 1.25], { independent: true })
      b.sequence('a_n = (-1)^(n+1)/n', { n0: 1, count: 20, series: { N: 10, connect: true } })
    },
  },

  // ======================================================== AP Precalculus
  {
    id: 'pc-u1-zeros',
    course: 'precalc',
    unit: 'PC1',
    help: ['pc-1', 'm3-poly'],
    title: 'A polynomial from its zeros',
    short: 'polynomial from its zeros',
    note:
      'f is built from its zeros: −2 with multiplicity 2 (touches), 1 with multiplicity 3 (flattens through) and 3 (crosses). Ask the class for the degree and the end behaviour from the leading term before zooming out, then edit a multiplicity on the card.',
    keywords: ['zeros', 'roots', 'multiplicity', 'end behavior', 'factored form', 'polynomial'],
    build: (b) => {
      b.frame([-3.5, 4], [-4, 5])
      b.line('f(x) = 1/10(x + 2)^2(x - 1)^3(x - 3)')
    },
  },
  {
    id: 'pc-u1-rational',
    course: 'precalc',
    unit: 'PC1',
    help: ['pc-1', 'm3-poly'],
    title: 'A rational function: asymptotes and a hole',
    short: 'rational: asymptotes and a hole',
    note:
      'f(x) = 2(x + 1)(x − 1)/((x + 1)(x − 2)): the shared factor leaves a hole at x = −1, the remaining zero of the denominator a vertical asymptote at x = 2, and the leading terms a horizontal asymptote y = 2. Ask the class to find all three from the factors before you point at the graph.',
    keywords: ['rational function', 'vertical asymptote', 'horizontal asymptote', 'hole', 'removable discontinuity'],
    build: (b) => {
      b.frame([-6, 8], [-6, 9])
      b.line('f(x) = 2(x + 1)(x - 1)/((x + 1)(x - 2))')
    },
  },
  {
    id: 'pc-u1-inverse-restricted',
    course: 'precalc',
    unit: 'PC1',
    help: ['pc-1', 'm3-functions', 'calc-3'],
    title: 'The inverse of x² on x ≥ 0',
    short: 'inverse of x² on x ≥ 0',
    note:
      'f(x) = x² is restricted to x ≥ 0 (the cut-off half is the faint ghost), so it passes the horizontal line test and its reflection in y = x is the function √x. The probe joins (1.5, 2.25) on f to (2.25, 1.5) on f⁻¹ — ask why the full parabola has no inverse function.',
    keywords: ['inverse', 'restricted domain', 'one-to-one', 'horizontal line test', 'reflection', 'square root'],
    build: (b) => {
      b.frame([-3, 4.5], [-2, 4.5])
      const f = b.line('f(x) = x^2 {x >= 0}')
      b.view(f, { ghost: true, reflect: 1.5 })
      b.inverse(f)
      b.select(f)
    },
  },
  {
    id: 'pc-u2-exp-log',
    course: 'precalc',
    unit: 'PC2',
    help: ['pc-2', 'm3-explog'],
    title: 'Exponential and logarithm as inverses',
    short: '2ˣ and log₂ x',
    note:
      'y = 2ˣ and y = log₂ x are reflections of each other in the dashed line y = x. Ask the class to swap the coordinates of (0, 1), (1, 2) and (3, 8) and find them on the logarithm, and to say how the horizontal asymptote of one becomes the vertical asymptote of the other.',
    keywords: ['exponential', 'logarithm', 'inverse', 'reflection', 'asymptote', 'log base 2'],
    build: (b) => {
      b.frame([-4, 9], [-4, 9])
      const f = b.line('f(x) = 2^x')
      b.inverse(f)
      b.select(f)
    },
  },
  {
    id: 'pc-u2-logistic-regression',
    course: 'precalc',
    unit: 'PC2',
    help: ['pc-2', 'm3-explog'],
    title: 'Logistic regression from a data table',
    short: 'logistic regression from data',
    note:
      'The table is the number of students who have heard a rumour, t days after it starts; the logistic regression levels off at its carrying capacity. Ask the class to read the limiting value from the equation and to predict when half the school has heard it — then check with the curve.',
    keywords: ['regression', 'logistic', 'data', 'model', 'carrying capacity', 'scatter plot'],
    build: (b) => {
      b.frame([-1, 18], [-15, 230], { independent: true })
      b.table(
        'Rumour',
        [
          [0, 12], [2, 25], [4, 48], [6, 82], [8, 118], [10, 148], [12, 167], [14, 178], [16, 184],
        ],
        { xLabel: 't', yLabel: 'N', regressions: ['logistic'] },
      )
    },
  },
  {
    id: 'pc-u3-unit-circle',
    course: 'precalc',
    unit: 'PC3',
    help: ['pc-3', 'm3-trig'],
    title: 'The unit circle unwrapping sine',
    short: 'the unit circle unwrapping sine',
    note:
      'P(θ) = (cos θ, sin θ) at θ = π/3, with its reference triangle; the height of P is carried across to the right, where it traces y = sin x. Play θ around the circle and ask the class where sin θ is largest, where it is zero, and what one full turn of the circle is on the graph.',
    keywords: ['unit circle', 'sine', 'radian', 'reference angle', 'trigonometry'],
    build: (b) => {
      b.piAxis()
      b.unitCircle({ theta: PI / 3, unwrap: 'sin' })
    },
  },
  {
    id: 'pc-u3-sinusoid',
    course: 'precalc',
    unit: 'PC3',
    help: ['pc-3', 'm3-trig'],
    title: 'A sinusoidal model and its key points',
    short: '3 sin(2(x − π/4)) + 1',
    note:
      'f(x) = 3 sin(2(x − π/4)) + 1: amplitude 3, period π, phase shift π/4 right, midline y = 1. Select the curve to see the key points of one cycle as handles; ask the class to find them by hand first, then drag one and watch the equation change.',
    keywords: ['sinusoid', 'amplitude', 'period', 'phase shift', 'midline', 'key points', 'transformation'],
    build: (b) => {
      b.piAxis()
      b.frame([-PI / 2, 2 * PI], [-3, 5])
      const f = b.line('f(x) = 3sin(2(x - pi/4)) + 1')
      b.view(f, { showParent: false })
    },
  },
  {
    id: 'pc-u3-tangent',
    course: 'precalc',
    unit: 'PC3',
    help: ['pc-3', 'm3-trig'],
    title: 'Tangent and its asymptotes',
    short: 'tan x and its asymptotes',
    note:
      'y = tan x = sin x / cos x has a vertical asymptote wherever cos x = 0, at x = π/2 + kπ, and a period of π. Ask the class to explain the asymptotes from the unit circle, and where tan x is zero.',
    keywords: ['tangent', 'asymptote', 'period', 'trigonometry'],
    build: (b) => {
      b.piAxis()
      b.frame([-2 * PI, 2 * PI], [-5, 5])
      b.line('f(x) = tan(x)')
    },
  },

  // ======================================================== NC Math 1
  {
    id: 'm1-linear-vs-exponential',
    course: 'math1',
    unit: 'M1',
    help: ['m1-linexp', 'm1-functions'],
    title: 'Linear or exponential? Reading the table',
    short: '3x + 5 against 2ˣ',
    note:
      'Both tables step x by 1: f(x) = 3x + 5 adds 3 every step (Δy = 3), while g(x) = 2ˣ multiplies by 2 (ratio 2). Ask the class which function is ahead at x = 4 and at x = 5, then why the exponential passes the linear one and never falls behind again.',
    keywords: ['linear', 'exponential', 'table of values', 'common difference', 'common ratio', 'constant rate', 'growth factor', 'compare', 'F-LE.1', 'F-LE.3'],
    build: (b) => {
      b.frame([-4, 7], [-30, 66], { independent: true })
      const f = b.line('f(x) = 3x + 5')
      const g = b.line('g(x) = 2^x')
      b.view(g, { table: { n: 7, cols: ['ratio'] } })
      b.view(f, { table: { n: 7, cols: ['d1'], vs: g, fig: true } })
      b.select(f)
    },
  },
  {
    id: 'm1-sequences',
    course: 'math1',
    unit: 'M1',
    help: ['m1-linexp'],
    title: 'Arithmetic and geometric sequences',
    short: 'arithmetic and geometric sequences',
    note:
      'aₙ = 3 + 4(n − 1) adds 4 each term and bₙ = 2(1.5)ⁿ⁻¹ multiplies by 1.5; the dashed curves are the linear and exponential functions the dots sit on. Ask the class for the recursive rule of each, then which sequence is larger at n = 10 and how they know without computing every term.',
    keywords: ['sequence', 'arithmetic', 'geometric', 'common difference', 'common ratio', 'explicit', 'recursive', 'F-BF.2', 'F-IF.3'],
    build: (b) => {
      b.frame([-0.5, 9.5], [-3, 40], { independent: true })
      b.sequence('a_n = 3 + 4(n - 1)', { n0: 1, count: 8, partner: true })
      b.sequence('b_n = 2(1.5)^(n - 1)', { n0: 1, count: 8, partner: true })
    },
  },
  {
    id: 'm1-quadratic-features',
    course: 'math1',
    unit: 'M1',
    help: ['m1-quad'],
    title: 'Key features of a quadratic',
    short: 'vertex, zeros and axis of −x² + 2x + 8',
    note:
      'f(x) = −x² + 2x + 8 opens down, with its vertex at (1, 9), zeros at x = −2 and x = 4, y-intercept 8, and the dashed axis of symmetry x = 1. Ask the class to find the vertex from x = −b/(2a) and the zeros by factoring before you point at the marks, then why the axis sits halfway between the zeros.',
    keywords: ['quadratic', 'parabola', 'vertex', 'zeros', 'roots', 'x-intercepts', 'y-intercept', 'axis of symmetry', 'maximum', 'standard form', 'F-IF.4', 'F-IF.7'],
    build: (b) => {
      b.frame([-5, 7], [-5, 11])
      b.line('x = 1', { dash: [6, 5], color: '#9aa4b2', strokeWidth: 1.5 })
      const f = b.line('f(x) = -x^2 + 2x + 8')
      b.view(f, { table: { start: '-2', n: 7, cols: ['d1', 'd2'] } })
      b.select(f)
    },
  },
  {
    id: 'm1-system-of-lines',
    course: 'math1',
    unit: 'M1',
    help: ['m1-systems'],
    title: 'A system of two linear equations',
    short: 'the system y = 2x − 1, y = −x + 5',
    note:
      'The lines y = 2x − 1 and y = −x + 5 meet at (2, 3), the one solution of the system; the point is listed on both cards. Have the class solve by substitution first, then check that (2, 3) makes both equations true and ask what the graphs would look like if the system had no solution.',
    keywords: ['system of equations', 'linear system', 'intersection', 'solution', 'substitution', 'elimination', 'A-REI.6', 'A-REI.11'],
    build: (b) => {
      b.frame([-4, 7], [-3, 7])
      b.line('y = 2x - 1')
      b.line('y = -x + 5')
    },
  },
  {
    id: 'm1-inequality-system',
    course: 'math1',
    unit: 'M1',
    help: ['m1-systems'],
    title: 'A system of linear inequalities',
    short: 'y > 2x − 3 and y ≤ −x/2 + 2',
    note:
      'Only the overlap is shaded: points above the dashed line y = 2x − 3 and on or below the solid line y = −x/2 + 2. The test point (0, 0) satisfies both inequalities — drag it into each region and ask the class why the corner (2, 1) belongs to one boundary and not the other.',
    keywords: ['system of inequalities', 'linear inequality', 'shading', 'half-plane', 'test point', 'dashed', 'solid', 'A-REI.12'],
    build: (b) => {
      b.frame([-5, 6], [-5, 5])
      b.line('y > 2x - 3')
      b.line('y <= -x/2 + 2')
      b.system({ solution: true, test: { x: 0, y: 0 } })
    },
  },
  {
    id: 'm1-absolute-value',
    course: 'math1',
    unit: 'M1',
    help: ['m1-functions', 'm1-systems'],
    title: 'Absolute value as a piecewise function',
    short: '|x − 1| − 2 and |x − 1| − 2 = 1',
    note:
      'f(x) = |x − 1| − 2 is the parent V moved right 1 and down 2, so its vertex is (1, −2); the line y = 1 meets it at x = −2 and x = 4, the solutions of |x − 1| − 2 = 1. Ask the class to write f piecewise (−x − 1 for x < 1, x − 3 for x ≥ 1) and to read the domain and range from the graph.',
    keywords: ['absolute value', 'piecewise', 'vertex', 'absolute value equation', 'transformation', 'domain', 'range', 'intersection'],
    build: (b) => {
      b.frame([-5, 7], [-4, 5])
      const f = b.line('f(x) = |x - 1| - 2')
      b.view(f, { showParent: true })
      b.line('y = 1', { color: '#9aa4b2', strokeWidth: 2 })
      b.select(f)
    },
  },
  {
    id: 'm1-parallelogram',
    course: 'math1',
    unit: 'M1',
    help: ['m1-coord'],
    title: 'Prove it is a parallelogram with slopes',
    short: 'ABCD is a parallelogram',
    note:
      'Opposite sides have equal slopes, AB ∥ DC (slope 1/5) and AD ∥ BC (slope 2), so ABCD is a parallelogram; its perimeter is 2√26 + 4√5 ≈ 19.14 and its area 18. Ask the class why it is not a rectangle (1/5 · 2 ≠ −1), then to show that both diagonals have the midpoint (1/2, 3/2).',
    keywords: ['parallelogram', 'coordinate proof', 'slope', 'parallel', 'perpendicular', 'distance', 'perimeter', 'area', 'shoelace', 'quadrilateral', 'G-GPE.4', 'G-GPE.5'],
    build: (b) => {
      b.frame([-5, 6], [-3, 6])
      b.shape('ABCD = (-3,-1) (2,0) (4,4) (-1,3)', { fill: true, measure: ['lengths', 'slopes', 'area', 'classify'] })
    },
  },
  {
    id: 'm1-box-plots',
    course: 'math1',
    unit: 'M1',
    help: ['m1-stats'],
    title: 'Comparing two classes with box plots',
    short: 'two classes, one outlier',
    note:
      'The same test in two classes: Period 1 is tightly clustered except for one score of 42, an outlier beyond the lower 1.5·IQR fence, and Period 4 is more spread out. Ask the class which measures of centre and spread are fair to compare here and why, then leave the outlier out and watch which numbers change.',
    keywords: ['box plot', 'dot plot', 'outlier', 'iqr', 'median', 'mean', 'compare data sets', 'parallel box plots', 'five-number summary', 'S-ID.1', 'S-ID.2', 'S-ID.3'],
    build: (b) => {
      b.dataPlot(
        [
          { name: 'Period 1', values: [78, 82, 85, 74, 88, 91, 79, 84, 86, 80, 77, 83, 90, 87, 81, 76, 89, 85, 42, 84] },
          { name: 'Period 4', values: [65, 92, 71, 88, 58, 95, 77, 83, 69, 90, 74, 86, 62, 98, 80, 73, 91, 67, 85, 79] },
        ],
        { dist: 'dots', box: true },
      )
    },
  },
  {
    id: 'm1-scatter-residuals',
    course: 'math1',
    unit: 'M1',
    help: ['m1-bivariate'],
    title: 'Line of best fit and its residual plot',
    short: 'study hours and scores: residuals',
    note:
      'Ten students’ study hours and test scores, with the least squares line and its residual plot underneath. Ask the class to interpret the slope in context and to read r, then decide from the residual plot whether a linear model is appropriate — and whether the data show that studying causes higher scores.',
    keywords: ['scatter plot', 'regression', 'line of best fit', 'least squares', 'residual', 'residual plot', 'correlation', 'r', 'causation', 'S-ID.6', 'S-ID.8'],
    build: (b) => {
      b.table(
        'Study time',
        [[1, 60], [2, 62], [3, 68], [4, 71], [5, 73], [6, 80], [7, 82], [8, 86], [9, 90], [10, 93]],
        { xLabel: 'hours', yLabel: 'score', regressions: ['linear'], residualPlot: 'linear' },
      )
    },
  },

  // ======================================================== NC Math 2
  {
    id: 'm2-quadratic-forms',
    course: 'math2',
    unit: 'M2',
    help: ['m2-quad'],
    title: 'One parabola, three forms',
    short: 'standard, factored and vertex form',
    note:
      'f(x) = x² − 2x − 8 is in standard form, which shows the y-intercept −8; g and h, hidden in the sidebar, are the same function in factored form (x − 4)(x + 2), which shows the zeros 4 and −2, and vertex form (x − 1)² − 9, which shows the vertex (1, −9). Ask the class to factor f and complete the square by hand, then select g and h to check against their cards.',
    keywords: ['quadratic', 'standard form', 'factored form', 'vertex form', 'completing the square', 'zeros', 'vertex', 'y-intercept', 'equivalent forms', 'A-SSE.3', 'F-IF.8'],
    build: (b) => {
      b.frame([-5, 7], [-11, 5])
      const f = b.line('f(x) = x^2 - 2x - 8')
      b.line('g(x) = (x - 4)(x + 2)', { hidden: true })
      b.line('h(x) = (x - 1)^2 - 9', { hidden: true })
      b.select(f)
    },
  },
  {
    id: 'm2-line-parabola',
    course: 'math2',
    unit: 'M2',
    help: ['m2-quad'],
    title: 'A system of a line and a parabola',
    short: 'y = x² − 2x − 3 and y = x + 1',
    note:
      'The parabola y = x² − 2x − 3 and the line y = x + 1 meet at (−1, 0) and (4, 5). Ask the class to set the two equal, solve x² − 3x − 4 = 0 by factoring, and say how a different line could meet the parabola once or not at all.',
    keywords: ['system', 'linear and quadratic', 'intersection', 'parabola', 'line', 'substitution', 'A-REI.7'],
    build: (b) => {
      b.frame([-4, 7], [-5, 9])
      b.line('f(x) = x^2 - 2x - 3')
      b.line('g(x) = x + 1')
    },
  },
  {
    id: 'm2-square-root',
    course: 'math2',
    unit: 'M2',
    help: ['m2-radical'],
    title: 'A square root function and its domain',
    short: '2√(x + 3) − 1',
    note:
      'f(x) = 2√(x + 3) − 1 is √x stretched by 2, shifted left 3 and down 1, so it starts at (−3, −1): its domain is x ≥ −3 and its range y ≥ −1. Ask the class to map the parent’s key points (0, 0), (1, 1) and (4, 2), then why nothing is drawn to the left of x = −3.',
    keywords: ['square root', 'radical function', 'domain', 'range', 'starting point', 'transformation', 'parent function', 'F-IF.7', 'F-BF.3'],
    build: (b) => {
      b.frame([-5, 8], [-3, 7])
      const f = b.line('f(x) = 2sqrt(x + 3) - 1')
      b.view(f, { showParent: true })
    },
  },
  {
    id: 'm2-inverse-variation',
    course: 'math2',
    unit: 'M2',
    help: ['m2-radical'],
    title: 'Inverse variation: y = 12/x',
    short: 'inverse variation y = 12/x',
    note:
      'y = 12/x: in the table on the figure every x times its y is 12, so doubling x halves y; both axes are asymptotes. Ask the class for the constant of variation, then what happens to y as x grows and as x approaches 0 from either side.',
    keywords: ['inverse variation', 'varies inversely', 'reciprocal', 'k/x', 'constant of variation', 'asymptote', 'hyperbola', 'A-CED.1', 'F-IF.7'],
    build: (b) => {
      b.frame([-13, 13], [-9, 14])
      const f = b.line('f(x) = 12/x')
      b.view(f, { table: { list: '1, 2, 3, 4, 6, 12', fig: true } })
    },
  },
  {
    id: 'm2-function-transformations',
    course: 'math2',
    unit: 'M2',
    help: ['m2-functions'],
    title: 'Transforming f(x) = |x|: −2f(x − 3) + 1',
    short: '−2f(x − 3) + 1 for f(x) = |x|',
    note:
      'g(x) = −2|x − 3| + 1 is −2f(x − 3) + 1 for the parent f(x) = |x|, drawn as a ghost: reflected across the x-axis, stretched by 2, shifted right 3 and up 1. Ask the class where the parent’s points (0, 0), (1, 1) and (−1, 1) land, then which steps change the vertex and which change the slopes.',
    keywords: ['transformation', 'parent function', 'reflection', 'vertical stretch', 'shift', 'absolute value', 'F-BF.3'],
    build: (b) => {
      b.frame([-3, 8], [-6, 4])
      const g = b.line('g(x) = -2|x - 3| + 1')
      b.view(g, { showParent: true })
    },
  },
  {
    id: 'm2-rotate-reflect',
    course: 'math2',
    unit: 'M2',
    help: ['m2-xform'],
    title: 'A rotation, then a reflection',
    short: 'rotate ABC, then reflect',
    note:
      'ABC is rotated 90° about the origin, (x, y) → (−y, x), and its image A′B′C′ is reflected across the y-axis to A″B″C″. Ask the class for each image’s coordinates from the mapping rules before you reveal them, then for one transformation that takes ABC straight to A″B″C″ (the card names it).',
    keywords: ['rotation', 'reflection', 'composition', 'mapping notation', 'image', 'prime', 'rigid motion', 'G-CO.2', 'G-CO.5'],
    build: (b) => {
      b.frame([-5, 7], [-1, 6])
      b.shape('ABC = (2,1) (5,1) (2,3)', { fill: true })
      b.image('rotate ABC 90° about (0, 0)')
      b.image('reflect A′B′C′ across the y-axis')
    },
  },
  {
    id: 'm2-dilation-similarity',
    course: 'math2',
    unit: 'M2',
    help: ['m2-xform'],
    title: 'A dilation and similar triangles',
    short: 'dilate by 2: similar, not congruent',
    note:
      'A′B′C′ is ABC dilated by 2 about the origin, (x, y) → (2x, 2y): every side doubles and every angle stays the same. The comparison on ABC’s card says the triangles are similar with scale factor 2 — ask the class which criterion proves it and why they are not congruent.',
    keywords: ['dilation', 'scale factor', 'similar', 'similarity', 'center of dilation', 'proportional sides', 'AA', 'SSS similarity', 'G-SRT.1', 'G-SRT.2'],
    build: (b) => {
      b.frame([-1.5, 9], [-1, 9])
      const abc = b.shape('ABC = (1,1) (3,1) (1,4)', { fill: true, measure: ['lengths'] })
      const img = b.image('dilate ABC by 2 about (0, 0)', { measure: ['lengths'] })
      b.compare(abc, img)
    },
  },
  {
    id: 'm2-triangle-centres',
    course: 'math2',
    unit: 'M2',
    help: ['m2-centres'],
    title: 'Centres of an obtuse triangle and the Euler line',
    short: 'four centres and the Euler line',
    note:
      'ABC is obtuse at C, so the circumcentre O (2, −2) and the orthocentre H (0, 6) fall outside it while the centroid G (4/3, 2/3) and the incentre I stay inside. O, G and H lie on the Euler line y = −4x + 6 with HG = 2·GO. Ask the class to check O by showing OA = OB = OC = 2√5, then to drag C up until the triangle is acute and watch O and H move inside.',
    keywords: [
      'centroid', 'circumcenter', 'circumcentre', 'incenter', 'incentre', 'orthocenter', 'orthocentre', 'median',
      'perpendicular bisector', 'angle bisector', 'altitude', 'circumscribed circle', 'inscribed circle',
      'points of concurrency', 'euler line', 'obtuse', 'G-CO.10',
    ],
    build: (b) => {
      b.frame([-6, 10], [-7, 7.5])
      b.shape('ABC = (-2,0) (6,0) (0,2)', { centres: ['centroid', 'circumcentre', 'incentre', 'orthocentre', 'euler'] })
    },
  },
  {
    id: 'm2-right-triangle-trig',
    course: 'math2',
    unit: 'M2',
    help: ['m2-trig'],
    title: 'Trigonometric ratios in a right triangle',
    short: 'sin, cos and tan in a 3-4-5 triangle',
    note:
      'ABC has its right angle at B, legs 4 and 3 and hypotenuse 5, so sin A = 3/5, cos A = 4/5 and tan A = 3/4, and ∠A ≈ 36.87°. Ask the class to write the three ratios for ∠C as well and explain why sin A = cos C.',
    keywords: ['right triangle', 'trigonometry', 'sine', 'cosine', 'tangent', 'sohcahtoa', 'pythagorean theorem', 'complementary angles', 'G-SRT.6', 'G-SRT.8'],
    build: (b) => {
      b.frame([-1, 6], [-1, 4])
      b.shape('ABC = (0,0) (4,0) (4,3)', { fill: true, measure: ['lengths', 'angles', 'right'] })
    },
  },
  {
    id: 'm2-two-way-table',
    course: 'math2',
    unit: 'M2',
    help: ['m2-prob'],
    title: 'A two-way table: are the events independent?',
    short: 'two-way table and independence',
    note:
      'In this survey of 100 students, P(Junior | drives) = 24/40 = 3/5 and P(Junior) = 60/100 = 3/5, so being a junior and driving to school are independent here. Ask the class to check with P(A and B) = P(A)·P(B), then change one count and watch the verdict change.',
    keywords: ['two-way table', 'conditional probability', 'independent', 'independence', 'joint', 'marginal', 'S-CP.4', 'S-CP.5', 'S-CP.6'],
    build: (b) => {
      b.probability('table', {
        table: {
          rows: ['Junior', 'Senior'],
          cols: ['Drives', 'Doesn’t drive'],
          counts: [
            [24, 36],
            [16, 24],
          ],
          a: 0,
          b: 0,
        },
      })
    },
  },
  {
    id: 'm2-tree-without-replacement',
    course: 'math2',
    unit: 'M2',
    help: ['m2-prob'],
    title: 'A tree diagram: drawing without replacement',
    short: 'two draws without replacement',
    note:
      'A bag holds 4 green and 6 yellow marbles and two are drawn without replacement, so the second-stage branches change: P(both green) = 4/10 · 3/9 = 2/15. The event shown is at least one green, 2/3 — ask the class to find it from the paths, then as 1 − P(no green).',
    keywords: ['tree diagram', 'without replacement', 'dependent events', 'multiplication rule', 'conditional probability', 'complement', 'marbles', 'S-CP.8'],
    build: (b) => {
      b.probability('tree', {
        tree: {
          mode: 'bag',
          bag: [
            { name: 'Green', count: 4 },
            { name: 'Yellow', count: 6 },
          ],
          draws: 2,
          replace: false,
          pick: [],
          event: 'at least one Green',
        },
      })
    },
  },

  // ======================================================== NC Math 3
  {
    id: 'm3-rational-inequality',
    course: 'math3',
    unit: 'M3',
    help: ['m3-ineq', 'm3-poly'],
    title: 'Solving a rational inequality',
    short: '(x − 1)/(x + 2) ≤ 0',
    kind: 'number-line',
    note:
      'The critical values are x = 1 (a zero, included) and x = −2 (undefined, never included); the sign row and the test points show the working. Ask the class why −2 gets an open circle even though the inequality says "or equal to".',
    keywords: ['rational inequality', 'sign chart', 'test point', 'critical value', 'number line', 'interval notation'],
    build: (b) => {
      b.frame([-5, 4])
      b.solve('(x - 1)/(x + 2) <= 0', { signs: true, tests: true })
    },
  },
  {
    id: 'm3-linear-programming',
    course: 'math3',
    unit: 'M3',
    help: ['m3-ineq'],
    title: 'Linear programming: the corner points',
    short: 'linear programming, P = 3x + 2y',
    note:
      'The feasible region is where all four inequalities overlap; its corners are (0, 0), (4, 0), (3, 1) and (0, 2). The card evaluates P = 3x + 2y at each one — ask the class to do the table first, then drag the test point and the dashed iso-profit line to see why the maximum is at a corner.',
    keywords: ['linear programming', 'feasible region', 'vertices', 'corner points', 'objective function', 'system of inequalities'],
    build: (b) => {
      b.frame([-1, 6], [-1, 4.5])
      b.line('y >= 0')
      b.line('x >= 0')
      b.line('x + y <= 4')
      b.line('x + 3y <= 6')
      b.system({ solution: true, test: { x: 1, y: 1 }, objective: { src: 'P = 3x + 2y', goal: 'max' }, iso: true })
    },
  },
  {
    id: 'm3-piecewise-step',
    course: 'math3',
    unit: 'M3',
    help: ['m3-functions', 'm3-ineq'],
    title: 'Piecewise and step functions',
    short: 'piecewise and step functions',
    note:
      'f is defined in three pieces, with open and closed dots at x = −1 and x = 2; g(x) = ⌊x⌋ − 3 is a step function. Ask the class to evaluate f(−1), f(2) and g(1.5) from the dots, and to give the domain and range of each.',
    keywords: ['piecewise', 'step function', 'greatest integer', 'floor', 'open dot', 'closed dot', 'domain', 'range'],
    build: (b) => {
      b.frame([-5, 5], [-6.5, 6])
      const f = b.line('f(x) = {x + 3 if x < -1, x^2 if -1 <= x < 2, 1 if x >= 2}')
      const g = b.line('g(x) = floor(x) - 3')
      b.view(g, { showParent: false })
      b.select(f)
    },
  },
  {
    id: 'm3-transformations',
    course: 'math3',
    unit: 'M3',
    help: ['m3-functions', 'pc-1'],
    title: 'Transformations of a parent function',
    short: 'transforming y = x²',
    note:
      'g(x) = −2(x − 1)² + 3 is y = x² reflected, stretched by 2, shifted right 1 and up 3; the parent is drawn as a ghost and the card lists the steps in order. Ask the class to map the parent’s points (0, 0), (1, 1) and (−1, 1), then drag the vertex.',
    keywords: ['transformation', 'parent function', 'reflection', 'stretch', 'shift', 'translation', 'vertex form'],
    build: (b) => {
      b.frame([-4, 5], [-5, 5])
      const g = b.line('g(x) = -2(x - 1)^2 + 3')
      b.view(g, { showParent: true })
    },
  },
  {
    id: 'm3-circle',
    course: 'math3',
    unit: 'M3',
    help: ['m3-geo'],
    title: 'A circle from its general equation',
    short: 'circle by completing the square',
    note:
      'The line was typed in general form, x² + y² − 2x + 4y − 4 = 0; the card completes the square to (x − 1)² + (y + 2)² = 9, and the construction shows the centre (1, −2) and the radius 3. Ask the class to complete the square by hand before you open the card.',
    keywords: ['circle', 'conic', 'completing the square', 'center', 'radius', 'general form', 'standard form'],
    build: (b) => {
      b.frame([-4, 6], [-6, 2])
      const c = b.line('x^2 + y^2 - 2x + 4y - 4 = 0')
      b.view(c, { construction: true })
    },
  },
  {
    id: 'm3-inscribed-central',
    course: 'math3',
    unit: 'M3',
    help: ['m3-geo'],
    title: 'An inscribed angle is half the central angle',
    short: 'inscribed and central angles',
    note:
      'P (3, 4), Q (−4, 3) and R (0, −5) are on x² + y² = 25. The central angle ∠POQ is 90° (OP · OQ = −12 + 12 = 0), so the inscribed angle ∠PRQ on the same arc is 45°. Ask the class to predict ∠PRQ before you reveal it, then to retype R as 100° (a point on arc PQ) and explain why the angle becomes 135°.',
    keywords: ['inscribed angle', 'central angle', 'intercepted arc', 'chord', 'circle theorem', 'arc measure', 'G-C.2'],
    build: (b) => {
      b.frame([-8.5, 8.5], [-6.5, 6.5])
      const c = b.line('x^2 + y^2 = 25')
      b.circle(c, { pts: ['(3, 4)', '(-4, 3)', '(0, -5)'], show: ['angles'] })
      b.select(c)
    },
  },
  {
    id: 'm3-arc-sector',
    course: 'math3',
    unit: 'M3',
    help: ['m3-geo'],
    title: 'Arc length and sector area in radians',
    short: 'arc length and sector area',
    note:
      'The sector runs counterclockwise from P at 30° to Q at 150° on a circle of radius 6, so θ = 120° = 2π/3. The arc length is s = rθ = 6 · 2π/3 = 4π and the area A = ½r²θ = 12π — the same as (120/360) · 2π · 6 and (120/360) · π · 6². Ask the class why θ = s/r makes the radian the natural unit, and what s is on a circle of radius 12 with the same angle.',
    keywords: ['arc length', 'sector', 'sector area', 'radian', 'radian measure', 'central angle', 's = rθ', 'proportion', 'G-C.5'],
    build: (b) => {
      b.frame([-9.5, 9.5], [-7.5, 7.5])
      const c = b.line('x^2 + y^2 = 36')
      b.circle(c, { pts: ['30°', '150°'], show: ['sector'] })
      b.select(c)
    },
  },
]

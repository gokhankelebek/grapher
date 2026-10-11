// ============================================================================
// src/examples/more/nc12.ts — more gallery examples (see catalog.ts for the
// ExampleDef contract). Appended to EXAMPLE_DEFS; ids are permanent.
//
// NC Math 1 and NC Math 2, 2016 NC SCOS: each note's numbers are asserted in
// tests/examples-more-nc12.test.ts.
// ============================================================================

import type { ExampleDef } from '../catalog'

export const MORE_NC12: readonly ExampleDef[] = [
  // ======================================================== NC Math 1
  {
    id: 'm1-slope-in-context',
    course: 'math1',
    unit: 'M1',
    help: ['m1-linexp', 'm1-functions'],
    title: 'Slope and intercepts in context: a burning candle',
    short: 'a candle burning down',
    note:
      'A 12-inch candle burns down at a constant rate: h(t) = 12 − 0.75t is its height in inches after t hours, for 0 ≤ t ≤ 16. The slope −0.75 means it loses 0.75 inch every hour (the table drops 3 inches every 4 hours), the vertical intercept 12 is its height when it is lit, and the t-intercept 16 is when it burns out. Ask the class what h(6) = 7.5 means in context, then how the graph would change for a candle that burns 0.5 inch per hour.',
    keywords: ['slope', 'rate of change', 'y-intercept', 'x-intercept', 'interpret', 'context', 'linear model', 'constant rate', 'domain', 'NC.M1.F-LE.5', 'NC.M1.F-IF.4', 'F-LE.5', 'F-IF.4'],
    build: (b) => {
      b.frame([-3, 19], [-2, 14])
      const h = b.line('h(t) = 12 - 0.75t {0 <= t <= 16}')
      b.view(h, { table: { step: '4', n: 5, cols: ['d1'], ev: 'h(6)' } })
    },
  },
  {
    id: 'm1-system-in-context',
    course: 'math1',
    unit: 'M1',
    help: ['m1-systems'],
    title: 'A system in context: ticket sales',
    short: 'adult and student tickets',
    note:
      'A school play sold 200 tickets for $1210 in all, adult tickets at $8 and student tickets at $5. With x adult and y student tickets, x + y = 200 counts the tickets and 8x + 5y = 1210 counts the dollars, and the two lines meet at (70, 130). Ask the class to solve by elimination (subtracting 5 times the first equation leaves 3x = 210), then to say what (70, 130) means and check it in both equations.',
    keywords: ['system of equations', 'linear system', 'context', 'word problem', 'tickets', 'elimination', 'substitution', 'standard form', 'intersection', 'NC.M1.A-CED.3', 'NC.M1.A-REI.6', 'A-CED.3', 'A-REI.6'],
    build: (b) => {
      b.frame([-20, 260], [-20, 260])
      b.line('x + y = 200')
      b.line('8x + 5y = 1210')
    },
  },
  {
    id: 'm1-projectile',
    course: 'math1',
    unit: 'M1',
    help: ['m1-quad'],
    title: 'A projectile: key features in context',
    short: 'a ball thrown from a roof',
    note:
      'A ball is thrown upward from an 80 ft roof, and h(t) = −16t² + 64t + 80 is its height in feet after t seconds: the vertical intercept 80 is the roof, the vertex (2, 144) is the highest point, and the zero t = 5 is when it lands, since −16t² + 64t + 80 = −16(t − 5)(t + 1). Ask the class why t = −1 is not an answer here and what the domain and range are, then when the ball is 128 ft up: the line meets the curve at t = 1 and t = 3, equally spaced around t = 2.',
    keywords: ['quadratic', 'projectile', 'vertex', 'maximum', 'zeros', 'height', 'context', 'domain', 'range', 'factoring', 'NC.M1.F-IF.4', 'NC.M1.A-SSE.3', 'F-IF.4', 'A-SSE.3'],
    build: (b) => {
      b.frame([-1, 6.5], [-20, 170], { independent: true })
      const h = b.line('h(t) = -16t^2 + 64t + 80 {0 <= t <= 5}')
      b.line('y = 128', { color: '#9aa4b2', strokeWidth: 2 })
      b.select(h)
    },
  },
  {
    id: 'm1-right-triangle-coords',
    course: 'math1',
    unit: 'M1',
    help: ['m1-coord'],
    title: 'Distance, midpoint and perpendicular slopes',
    short: 'an isosceles right triangle by coordinates',
    note:
      'In △ABC with A(2, 3), B(10, 9) and C(9, 2), AB = 10 with midpoint (6, 6) and slope 3/4, while BC = CA = 5√2 with slopes 7 and −1/7, whose product is −1; so ABC is an isosceles right triangle with its right angle at C and area 25. The line is perpendicular to AB through its midpoint, y = −(4/3)x + 14, and it passes through C. Ask the class to find each length with the distance formula, then why C, being the same distance from A and from B, has to lie on that perpendicular bisector.',
    keywords: ['distance formula', 'midpoint', 'slope', 'perpendicular', 'opposite reciprocal', 'perpendicular bisector', 'right triangle', 'isosceles', 'coordinate proof', 'area', 'NC.M1.G-GPE.4', 'NC.M1.G-GPE.5', 'NC.M1.G-GPE.6', 'G-GPE.4', 'G-GPE.5', 'G-GPE.6'],
    build: (b) => {
      b.frame([-1, 13], [-1, 11.5])
      const t = b.shape('ABC = (2,3) (10,9) (9,2)', { fill: true, measure: ['lengths', 'slopes', 'midpoints', 'right', 'area', 'classify'] })
      b.shape('perpendicular to AB through (6, 6)', { measure: ['equation'] })
      b.select(t)
    },
  },
  {
    id: 'm1-histogram-skew',
    course: 'math1',
    unit: 'M1',
    help: ['m1-stats'],
    title: 'A skewed histogram: mean or median?',
    short: 'homework minutes, skewed right',
    note:
      'Twenty students’ minutes of homework last night, as a histogram with bin width 10 above a box plot: the long right tail pulls the mean (26.75 min) well above the median (17.5 min), and 110 is an outlier, beyond the upper fence Q3 + 1.5·IQR = 32.5 + 1.5(22.5) = 66.25. So the card recommends the median and IQR (22.5) for center and spread rather than the mean and standard deviation (Sx ≈ 25.46). Ask the class which number better describes a typical student, then leave the outlier out and compare: the mean falls to about 22.37 while the median only moves to 15.',
    keywords: ['histogram', 'bin width', 'skewed', 'skewed right', 'shape', 'center', 'spread', 'mean', 'median', 'iqr', 'standard deviation', 'outlier', 'resistant', 'NC.M1.S-ID.1', 'NC.M1.S-ID.2', 'NC.M1.S-ID.3', 'S-ID.1', 'S-ID.2', 'S-ID.3'],
    build: (b) => {
      b.dataPlot(
        [{ name: 'Homework (min)', values: [5, 5, 10, 10, 10, 10, 15, 15, 15, 15, 20, 20, 20, 25, 30, 35, 45, 60, 60, 110] }],
        { dist: 'hist', box: true, binWidth: 10 },
      )
    },
  },
  {
    id: 'm1-correlation-causation',
    course: 'math1',
    unit: 'M1',
    help: ['m1-bivariate'],
    title: 'Correlation is not causation',
    short: 'ice cream sales and sunburns',
    note:
      'Ten summer weeks in a beach town: ice cream sales (hundreds of cones) against sunburn cases at the clinic, with the least squares line y = 0.8168x − 2.4699 and r ≈ 0.988, a strong positive linear association. Ask the class to describe the association in words from r, then whether selling more ice cream causes sunburns, and what lurking variable (hot, sunny weather) could drive both.',
    keywords: ['correlation', 'causation', 'association', 'lurking variable', 'confounding', 'correlation coefficient', 'r', 'scatter plot', 'line of best fit', 'NC.M1.S-ID.8', 'NC.M1.S-ID.9', 'S-ID.8', 'S-ID.9'],
    build: (b) => {
      b.frame([0, 50], [-4, 40], { independent: true })
      b.table(
        'Beach town',
        [[12, 8], [15, 11], [18, 10], [22, 16], [25, 18], [30, 21], [34, 27], [38, 26], [41, 32], [45, 35]],
        { xLabel: 'cones (100s)', yLabel: 'sunburns', regressions: ['linear'] },
      )
    },
  },

  // ======================================================== NC Math 2
  {
    id: 'm2-quadratic-inequality',
    course: 'math2',
    unit: 'M2',
    help: ['m2-quad'],
    title: 'A quadratic inequality: when is the ball above 36 ft?',
    short: '−16t² + 48t + 4 > 36',
    kind: 'number-line',
    note:
      'A ball’s height is −16t² + 48t + 4 feet after t seconds, and it is above 36 ft when −16t² + 48t + 4 > 36, that is −16t² + 48t − 32 > 0, or −16(t − 1)(t − 2) > 0. The critical values t = 1 and t = 2 get open circles, and the test points 0, 3/2 and 3 give −32, 4 and −32, so the ball is above 36 ft for 1 < t < 2. Ask the class why the circles are open and what changes for "at least 36 ft", then why dividing by −16 flips the sign to (t − 1)(t − 2) < 0.',
    keywords: ['quadratic inequality', 'sign chart', 'test point', 'critical value', 'number line', 'interval notation', 'projectile', 'context', 'NC.M2.A-CED.1', 'A-CED.1'],
    build: (b) => {
      b.frame([-1.5, 4.5])
      b.solve('-16t^2 + 48t + 4 > 36', { signs: true, tests: true })
    },
  },
  {
    id: 'm2-glide-reflection',
    course: 'math2',
    unit: 'M2',
    help: ['m2-xform'],
    title: 'A reflection, then a translation: a glide reflection',
    short: 'reflect, then translate: a glide',
    note:
      'ABC is reflected across the y-axis, (x, y) → (−x, y), and its image A′B′C′ is translated by ⟨0, 6⟩ to A″B″C″, so A(2, −4) lands on A″(−2, 2). The composite (x, y) → (−x, y + 6) is a single motion, a glide reflection, because the translation runs parallel to the mirror line; A″B″C″’s card names it. Ask the class whether translating first and reflecting second gives the same image, and why A″B″C″ has the opposite orientation to ABC.',
    keywords: ['glide reflection', 'reflection', 'translation', 'composition', 'rigid motion', 'mapping notation', 'orientation', 'isometry', 'NC.M2.G-CO.5', 'NC.M2.G-CO.2', 'G-CO.5', 'G-CO.2'],
    build: (b) => {
      b.frame([-7.5, 7.5], [-5.5, 6.5])
      b.shape('ABC = (2,-4) (5,-3) (4,-1)', { fill: true })
      b.image('reflect ABC across the y-axis')
      b.image('translate A′B′C′ by <0, 6>')
    },
  },
  {
    id: 'm2-dilation-center',
    course: 'math2',
    unit: 'M2',
    help: ['m2-xform'],
    title: 'A dilation about a center that is not the origin',
    short: 'dilate by 2 about P(−2, 1)',
    note:
      'ABC is dilated by 2 about P(−2, 1), not the origin, so (x, y) → (−2 + 2(x + 2), 1 + 2(y − 1)) = (2x + 2, 2y − 1): A(1, 2) goes to A′(4, 3), and the rays from P run through each vertex and its image. Every side of A′B′C′ is twice as long as its pre-image (AB = 3 and A′B′ = 6, BC = √13 and B′C′ = 2√13) and parallel to it (BC and B′C′ both have slope −2/3). Ask the class to find B′ and C′ by counting from P, then where (2x, 2y), the dilation about the origin, would have put the image instead.',
    keywords: ['dilation', 'center of dilation', 'scale factor', 'enlargement', 'similar', 'parallel', 'proportional', 'mapping notation', 'NC.M2.G-SRT.1', 'G-SRT.1'],
    build: (b) => {
      b.frame([-3.5, 11.5], [-1, 8.5])
      b.shape('P = (-2, 1)')
      const abc = b.shape('ABC = (1,2) (4,2) (1,4)', { fill: true, measure: ['lengths'] })
      b.image('dilate ABC by 2 about P', { aids: ['rays'], measure: ['lengths'] })
      b.select(abc)
    },
  },
  {
    id: 'm2-angle-of-elevation',
    course: 'math2',
    unit: 'M2',
    help: ['m2-trig'],
    title: 'Angle of elevation: solving a right triangle',
    short: 'angle of elevation to a treetop',
    note:
      'You stand at A, 24 m from the foot B of a 10 m tree, and look up at its top C: ∠A is the angle of elevation. tan A = 10/24 = 5/12, so ∠A = tan⁻¹(5/12) ≈ 22.6°, ∠C ≈ 67.4°, and the line of sight AC = √(24² + 10²) = 26 m. Ask the class to solve the triangle by hand before you reveal it, then how tall a tree would be if the angle of elevation from the same spot were 35° (24·tan 35° ≈ 16.8 m).',
    keywords: ['angle of elevation', 'right triangle', 'solve a right triangle', 'inverse tangent', 'trigonometry', 'tangent', 'sohcahtoa', 'pythagorean theorem', 'line of sight', 'NC.M2.G-SRT.8', 'G-SRT.8'],
    build: (b) => {
      b.frame([-1, 31], [-1.5, 14.5])
      b.shape('ABC = (3,2) (27,2) (27,12)', { fill: true, measure: ['lengths', 'angles', 'right'] })
    },
  },
  {
    id: 'm2-venn-addition-rule',
    course: 'math2',
    unit: 'M2',
    help: ['m2-prob'],
    title: 'The Addition Rule on a Venn diagram',
    short: 'P(Spanish or band)',
    note:
      'Of 30 students, 18 take Spanish (A), 12 are in band (B) and 5 do both, so 13 take only Spanish, 7 are only in band and 5 are in neither. The shaded event is A ∪ B, and the Addition Rule gives P(A or B) = 18/30 + 12/30 − 5/30 = 25/30 = 5/6. Ask the class why the 5 students in both are subtracted once, then to check the answer as 1 − P(neither) = 1 − 5/30.',
    keywords: ['venn diagram', 'addition rule', 'union', 'or', 'intersection', 'and', 'overlap', 'complement', 'mutually exclusive', 'NC.M2.S-CP.7', 'NC.M2.S-CP.1', 'S-CP.7', 'S-CP.1'],
    build: (b) => {
      b.probability('venn', {
        venn: { sets: 2, names: ['Spanish', 'Band', ''], regions: ['5', '13', '7', '5'], fromTable: false, expr: 'A ∪ B' },
      })
    },
  },
  {
    id: 'm2-tree-with-replacement',
    course: 'math2',
    unit: 'M2',
    help: ['m2-prob'],
    title: 'A tree diagram: drawing with replacement',
    short: 'two draws with replacement',
    note:
      'A bag holds 3 red and 2 blue marbles; one is drawn, its color noted, and it goes back before the second draw, so every second-stage branch is again 3/5 and 2/5. The event shown is the same color twice: P(RR) + P(BB) = 9/25 + 4/25 = 13/25. Ask the class why the two draws are independent here, then to redo the tree without replacement, where P(same color) = 3/10 + 1/10 = 2/5.',
    keywords: ['tree diagram', 'with replacement', 'independent events', 'multiplication rule', 'marbles', 'same color', 'NC.M2.S-CP.8', 'NC.M2.S-CP.5', 'S-CP.8', 'S-CP.5'],
    build: (b) => {
      b.probability('tree', {
        tree: {
          mode: 'bag',
          bag: [
            { name: 'Red', count: 3 },
            { name: 'Blue', count: 2 },
          ],
          draws: 2,
          replace: true,
          pick: [],
          event: 'same color',
        },
      })
    },
  },
]

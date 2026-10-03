// ============================================================================
// tests/latexCorpus.ts — a broad set of Grapher documents, and every LaTeX
// export of them, for tests/latexCompile.test.ts to compile with pdflatex.
//
// Each document is stored JSON built the way the app writes it (docFromBoard
// → serializeDoc), loaded back with docModelFromJSON and drawn by docFigure —
// the same pure path the worksheet builder uses, which is the App's own
// export pipeline (useExport) without React. Every figure is exported in every
// figure style as TikZ (the display list) and, on a graph, as pgfplots (the
// scene); worksheets of several figures are written as student and key, in
// both the TikZ and pgfplots variants.
// ============================================================================

import { parseExpression } from '../src/core/parse'
import type { FigureStyleId, FittedCurve, NLItem } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { derivativeModel, tangentAt } from '../src/core/calculus'
import type { BoardInput, DocMeta, Worksheet } from '../src/core/persist'
import { TAYLOR_MODEL_PREFIX, docFromBoard, newWorksheet, serializeDoc } from '../src/core/persist'
import type { DocModel } from '../src/ui/docScene'
import { docFigure, docModelFromJSON, recordFigure } from '../src/ui/docScene'
import { toTikz } from '../src/render/vectorTikz'
import { toPgfplots } from '../src/ui/pgfplotsExport'
import { buildSheet, sheetLatex } from '../src/ui/worksheetExport'
import { newRelatedRates } from '../src/ui/relatedRatesLinks'
import { newUnitCircle } from '../src/ui/unitCircleLinks'
import { EXAMPLE_GROUP_A, EXAMPLE_GROUP_B, newNormal, newSim } from '../src/ui/statsLinks'
import { bankFigure, buildItemDoc, planItem } from '../src/ui/itemBank'

export const STYLES: readonly FigureStyleId[] = ['screen', 'textbook', 'sat', 'ap']

/** Captions a teacher might really type, with every character that has bitten LaTeX. */
export const TRICKY_CAPTION =
  'Graph of f(x) = √(x + 1) on [0, ∞) — “quotes”, 50% off, #3 & x_1, π/2; Gökhan’s ğ ş ı İ ç ö ü'

const COLORS = ['#4f9cf9', '#f97316', '#22c55e', '#e879f9', '#facc15', '#38bdf8', '#f43f5e', '#a3e635']

function typed(id: string, src: string, modelId: string, color: string): FittedCurve {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(`corpus fixture failed to parse: ${src}: ${o.error}`)
  return {
    id,
    modelId,
    params: o.plot.defaultParams.slice(),
    kind: o.plot.kind,
    domain: o.plot.domain,
    color,
    strokeWidth: 2.5,
    visible: true,
    error: 0,
  }
}

function input(over: Partial<BoardInput>): BoardInput {
  return {
    curves: [],
    styles: {},
    candidates: new Map(),
    exprSources: {},
    viewport: { center: { x: 0, y: 0 }, pxPerUnit: 60 },
    selectedId: null,
    mode: 'draw',
    ...over,
  }
}

/** Typed lines, by id → source, each its own expr_N model. */
function lines(srcs: Record<string, string>, first = 1): { curves: FittedCurve[]; exprSources: Record<string, string> } {
  const curves = Object.entries(srcs).map(([id, src], i) => typed(id, src, `expr_${first + i}`, COLORS[i % COLORS.length]))
  return { curves, exprSources: { ...srcs } }
}

export interface CorpusDoc {
  id: string
  name: string
  json: string
}

function doc(id: string, name: string, b: BoardInput): CorpusDoc {
  const meta: DocMeta = { id, name, createdAt: 1, modifiedAt: 1 }
  return { id, name, json: serializeDoc(docFromBoard(meta, b, 2)) }
}

function parseOk(src: string) {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(src)
  return o.plot
}

/** The documents: one per feature family the exports have to carry. */
export function corpusDocs(): CorpusDoc[] {
  const out: CorpusDoc[] = []

  // ---- explicit typed curves, selected, with a tricky caption
  {
    const l = lines({ f: 'y = x^3 - 3x', g: 'y = e^(x/2) - 2' })
    out.push(doc('explicit', 'Explicit curves', input({ ...l, selectedId: 'f' })))
    out.push(doc('caption', 'Caption: “tricky” — 50% & #1 ğ', input({ ...l, selectedId: 'f', caption: TRICKY_CAPTION, captionAuto: false })))
  }

  // ---- sketched curves: a library family with its ink
  {
    const stroke = Array.from({ length: 30 }, (_, i) => {
      const x = -2 + (4 * i) / 29
      return { x, y: 0.5 * x * x - 1 }
    })
    const c: FittedCurve = {
      id: 's1', modelId: 'poly2', params: [-1, 0, 0.5], kind: 'explicit', domain: [-2, 2],
      color: '#22c55e', strokeWidth: 2.5, visible: true, error: 0.01, sourceStroke: stroke,
    }
    const s2: FittedCurve = {
      id: 's2', modelId: 'sine', params: [1.5, 1, 0, 0], kind: 'explicit', domain: null,
      color: '#f97316', strokeWidth: 2.5, visible: true, error: 0.02,
    }
    out.push(doc('sketch', 'Sketched', input({ curves: [c, s2], selectedId: 's1' })))
  }

  // ---- piecewise with dots, a hole, asymptotes
  {
    const l = lines({
      p: 'f(x) = {x^2 + 1 if x < 0, 3 if 0 <= x <= 2, -x + 5 if x > 2}',
      h: 'y = (x^2 - 1)/(x - 1)',
      r: 'y = (x + 1)/(x - 2)',
    })
    out.push(doc('piecewise', 'Piecewise, hole, asymptotes', input({ ...l, selectedId: 'r', viewport: { center: { x: 0, y: 1 }, pxPerUnit: 50 } })))
  }

  // ---- π axes
  {
    const l = lines({ s: 'y = 2sin(x)', c: 'y = cos(2x)' })
    out.push(doc('piaxes', 'Trig on π axes', input({ ...l, selectedId: 's', axisUnits: { x: 'pi', y: 'auto' } })))
  }

  // ---- shaded area, area between, Riemann sum, accumulation
  {
    const l = lines({ f: 'y = 0.5x^2 + 1', g: 'y = sqrt(x)', h: 'y = x + 3' })
    const acc: FittedCurve = { ...typed('A', 'y = x', 'intf_ACC', '#a78bfa'), id: 'A', modelId: 'intf_ACC', params: [] }
    out.push(
      doc('areas', 'Areas and Riemann sums', input({
        curves: [...l.curves, acc],
        exprSources: l.exprSources,
        selectedId: 'f',
        viewport: { center: { x: 1.5, y: 2 }, pxPerUnit: 60 },
        calc: [
          { kind: 'area', id: 'L1', parentId: 'f', from: -2, to: 0, abs: false },
          { kind: 'riemann', id: 'L2', parentId: 'g', from: 0, to: 4, n: 6, method: 'midpoint' },
          { kind: 'area', id: 'L3', parentId: 'h', otherId: 'f', from: 0, to: 2, abs: true },
          { kind: 'accumulation', id: 'ACC', parentId: 'g', curveId: 'A', a: 0, C: 0, x: 2 },
        ],
      })),
    )
  }

  // ---- tangent, derivative, secant/MVT/average value
  {
    const f = typed('f', 'y = x^3 - 3x', 'expr_1', COLORS[0])
    const models = { ...MODELS, expr_1: parseOk('y = x^3 - 3x').makeModel('expr_1') }
    const t = tangentAt(f, models, 1.5)!
    const tan: FittedCurve = { id: 't', modelId: 'line', params: [t.b, t.m], kind: 'explicit', domain: null, color: '#f43f5e', strokeWidth: 2, visible: true, error: 0 }
    const d = derivativeModel(f, models, 'dfdx_1')!
    const deriv: FittedCurve = { id: 'd', modelId: d.spec.id, params: d.params.slice(), kind: 'explicit', domain: d.domain, color: '#22c55e', strokeWidth: 2.5, visible: true, error: 0 }
    out.push(
      doc('tangent', 'Tangent and derivative', input({
        curves: [f, tan, deriv], exprSources: { f: 'y = x^3 - 3x' }, selectedId: 'f',
        calc: [
          { kind: 'tangent', id: 'T1', parentId: 'f', curveId: 't', x: 1.5 },
          { kind: 'derivative', id: 'D1', parentId: 'f', curveId: 'd' },
        ],
      })),
    )
    out.push(
      doc('secant', 'Secant, MVT, average value', input({
        curves: [{ ...f }], exprSources: { f: 'y = x^3 - 3x' }, selectedId: 'f',
        calc: [{ kind: 'secant', id: 'S1', parentId: 'f', a: 0, b: 2, mvt: true, avg: true }],
      })),
    )
  }

  // ---- limit with the ε–δ picture and table
  {
    const l = lines({ f: 'y = (x^2 - 1)/(x - 1)' })
    out.push(
      doc('limit', 'Limit with epsilon-delta', input({
        ...l, selectedId: 'f', viewport: { center: { x: 1, y: 2 }, pxPerUnit: 80 },
        calc: [{ kind: 'limit', id: 'LIM', parentId: 'f', a: 1, table: true, epsilon: true, eps: 0.5 }],
      })),
    )
  }

  // ---- Taylor with band and interval of convergence
  {
    const f = typed('f', 'y = ln(1 + x)', 'expr_1', COLORS[0])
    const p: FittedCurve = { ...f, id: 'p', modelId: `${TAYLOR_MODEL_PREFIX}T`, params: [], domain: null, color: '#f59e0b' }
    out.push(
      doc('taylor', 'Taylor polynomial', input({
        curves: [f, p], exprSources: { f: 'y = ln(1 + x)' }, selectedId: 'f',
        viewport: { center: { x: 0.5, y: 0 }, pxPerUnit: 80 },
        calc: [{ kind: 'taylor', id: 'T', parentId: 'f', curveId: 'p', a: 0, n: 4, x: 0.5, band: true, ioc: true }],
      })),
    )
  }

  // ---- volume: washers about the x-axis, shells, squares
  {
    const l = lines({ f: 'y = sqrt(x)', g: 'y = x/2' })
    out.push(
      doc('volume', 'Volume of revolution', input({
        ...l, selectedId: 'f', viewport: { center: { x: 2, y: 0.5 }, pxPerUnit: 60 },
        calc: [{ kind: 'volume', id: 'V', parentId: 'f', otherId: 'g', a: 0, b: 4, method: 'washer', x: 1.5 }],
      })),
    )
    out.push(
      doc('volume2', 'Shells and sections', input({
        ...lines({ f: 'y = 4 - x^2' }), selectedId: 'f', viewport: { center: { x: 0, y: 2 }, pxPerUnit: 50 },
        calc: [
          { kind: 'volume', id: 'V1', parentId: 'f', a: 0, b: 2, method: 'shell', axis: { dir: 'v', at: 0 } },
          { kind: 'volume', id: 'V2', parentId: 'f', a: -2, b: 0, method: 'section', section: 'semicircle' },
        ],
      })),
    )
  }

  // ---- sign chart strips
  {
    const l = lines({ f: 'y = x^3 - 3x' })
    out.push(
      doc('signchart', 'Sign chart', input({
        ...l, selectedId: 'f',
        calc: [{ kind: 'signchart', id: 'SC', parentId: 'f', rows: ['f', 'f1', 'f2'], arrows: true, cup: true, guides: true, a: -2, b: 2 }],
      })),
    )
  }

  // ---- slope field, solutions, Euler
  {
    out.push(
      doc('slopefield', 'Slope field and Euler', input({
        viewport: { center: { x: 0, y: 0 }, pxPerUnit: 50 },
        fields: [{
          id: 'F1', src: 'dy/dx = x - y', params: [], color: '#94a3b8', spacingPx: 32, visible: true,
          solutions: [{ id: 's1', x: 0, y: 1 }, { id: 's2', x: -2, y: -1 }],
          eulers: [{ id: 'e1', x0: 0, y0: 1, h: 0.5, n: 4, showTrue: true, labels: true }],
        }],
      })),
    )
  }

  // ---- inequality system with LP
  {
    const l = lines({ i1: 'y <= -x + 4', i2: 'x >= 0', i3: 'y >= 0', i4: 'y < 2x + 1' })
    out.push(
      doc('lp', 'Inequality system and LP', input({
        ...l, viewport: { center: { x: 2, y: 2 }, pxPerUnit: 50 },
        system: { solution: true, objective: { src: 'P = 3x + 2y', goal: 'max' }, iso: true, test: { x: 1, y: 1 } },
      })),
    )
  }

  // ---- unit circle (with ASTC, tan, unwrap)
  {
    const uc = newUnitCircle('U1')
    const uc2 = { ...uc, theta: (5 * Math.PI) / 6, show: { ...uc.show, astc: true, tan: true }, unwrap: 'sin' as const }
    out.push(doc('unitcircle', 'Unit circle', input({ unitCircles: [uc2], viewport: { center: { x: 1, y: 0 }, pxPerUnit: 70 } })))
  }

  // ---- related rates
  {
    out.push(doc('rrladder', 'Related rates: ladder', input({ relatedRates: [newRelatedRates('R1')] })))
    out.push(doc('rrcone', 'Related rates: cone', input({ relatedRates: [newRelatedRates('R2', 'cone')] })))
  }

  // ---- statistics: a normal curve (shaded, empirical rule, z row), a
  // percentile, a seeded sampling simulation and a randomisation test
  {
    const n = { ...newNormal('N1'), rule: true as const }
    out.push(doc('normal', 'Normal distribution', input({ stats: [n], viewport: { center: { x: 0, y: 0 }, pxPerUnit: 60 } })))
    const pct = { ...newNormal('N2'), mu: 0, sigma: 1, mode: 'percentile' as const, pct: 97.5, zRow: false as const }
    const sim = { ...newSim('S1', 12345), plot: 'hist' as const }
    out.push(doc('normalsim', 'Percentile and sampling', input({ stats: [pct, sim], viewport: { center: { x: 0, y: -4 }, pxPerUnit: 45 } })))
    const prop = { ...newSim('S2', 777), pop: 'proportion' as const, p: 0.42, n: 50, reps: 500 }
    const cmp = { ...newSim('S3', 99), mode: 'compare' as const, groupA: EXAMPLE_GROUP_A.slice(), groupB: EXAMPLE_GROUP_B.slice(), reps: 1000 }
    out.push(doc('simcompare', 'Proportions and treatments: 50% ğ', input({ stats: [prop, cmp], viewport: { center: { x: 0, y: -4 }, pxPerUnit: 45 } })))
  }

  // ---- polar curves, polar area, polar area-between, on a polar grid
  {
    const l = lines({ a: 'r = 3sin(θ)', b: 'r = 1 + sin(θ)' })
    out.push(
      doc('polar', 'Polar area between', input({
        ...l, grid: 'polar', viewport: { center: { x: 0, y: 1.5 }, pxPerUnit: 60 },
        calc: [{ kind: 'polarbetween', id: 'PB', parentId: 'a', otherId: 'b' }],
      })),
    )
    const r = lines({ p1: 'r = 2cos(3θ)' })
    out.push(
      doc('rose', 'Polar rose petal', input({
        ...r, grid: 'polar', selectedId: 'p1',
        curveViews: { p1: { area: { on: true, a: '-pi/6', b: 'pi/6' }, exportParticle: true } },
      })),
    )
  }

  // ---- parametric calculus
  {
    const l = lines({ c: '(x, y) = (2cos(3t), 2sin(2t))' })
    out.push(
      doc('param', 'Parametric calculus', input({
        ...l, selectedId: 'c',
        calc: [{ kind: 'pcalc', id: 'PC', parentId: 'c', t: 0.5, marks: true }],
      })),
    )
  }

  // ---- sequences and series
  {
    out.push(
      doc('series', 'Sequence and series', input({
        sequences: [
          { id: 'q1', src: 'a_n = 3 + 4(n - 1)', color: '#4f9cf9', visible: true, n0: 1, count: 6, showPartner: true, showSums: true, params: [] },
          { id: 'g', src: 'b_n = 2(1/2)^(n - 1)', color: '#f97316', visible: true, n0: 1, count: 8, showPartner: false, showSums: false, params: [], series: { N: 8, connect: true, bars: true } },
        ],
        viewport: { center: { x: 5, y: 10 }, pxPerUnit: 20 },
      })),
    )
  }

  // ---- number lines: solve, stacked, distance, plain
  {
    const items: NLItem[] = [
      { kind: 'solve', id: 'q1', src: 'x^2 - 4 > 0', color: '#4f9cf9', label: 'Q1', show: { signs: true, tests: true } },
    ]
    out.push(doc('nlsolve', 'Number line solve', input({ kind: 'number-line', items, viewport: { center: { x: 0, y: 0 }, pxPerUnit: 50 } })))
    out.push(
      doc('nlstacked', 'Number line stacked', input({
        kind: 'number-line',
        items: [{ kind: 'solve', id: 'q2', src: 'x^2 > 1 and x < 3', color: '#f97316', show: { stacked: true, signs: true } }],
        viewport: { center: { x: 0, y: 0 }, pxPerUnit: 50 },
      })),
    )
    out.push(
      doc('nldistance', 'Number line distance', input({
        kind: 'number-line',
        items: [{ kind: 'solve', id: 'q3', src: '|2x - 3| < 5', color: '#22c55e', show: { distance: true } }],
        viewport: { center: { x: 1.5, y: 0 }, pxPerUnit: 40 },
      })),
    )
    out.push(
      doc('nlplain', 'Number line intervals', input({
        kind: 'number-line',
        items: [
          { kind: 'interval', id: 'i1', lo: -2, hi: 5, loClosed: true, hiClosed: false, color: '#4f9cf9', label: 'domain ğ' },
          { kind: 'interval', id: 'i2', lo: null, hi: -3, loClosed: false, hiClosed: true, color: '#e879f9' },
          { kind: 'point', id: 'p1', x: 7, closed: false, color: '#f59e0b', label: 'x = 7' },
        ],
        viewport: { center: { x: 2, y: 0 }, pxPerUnit: 40 },
      })),
    )
  }

  // ---- a data table with a regression
  {
    const reg = typed('c1', 'y = 2.98(1.99)^x', 'expr_1', '#4f9cf9')
    out.push(
      doc('data', 'Data and regression', input({
        curves: [reg], exprSources: { c1: 'y = 2.98(1.99)^x' },
        viewport: { center: { x: 2, y: 25 }, pxPerUnit: 60, pxPerUnitY: 8 },
        data: [{
          id: 'T1', name: 'Table 1', xLabel: 'Year', yLabel: 'Pop', color: '#4f9cf9', visible: true,
          rows: [['0', '3'], ['1', '6.1'], ['2', '11.8'], ['3', '24.5'], ['4', '47.9']].map(([x, y]) => ({ x, y })),
          regressions: [{ id: 'r1', kind: 'exponential', curveId: 'c1', digits: 4, residuals: true }],
        }],
      })),
    )
  }

  // ---- shapes
  {
    const shapes = [
      { id: 'S1', src: 'ABC = (0,0) (4,0) (4,3)', params: [], color: '#4f9cf9', fill: true, visible: true },
      { id: 'S2', src: 'v = <2, 1>', params: [], color: '#f97316', fill: false, visible: true },
      { id: 'S3', src: 'P = (1, 2)', params: [], color: '#22c55e', fill: false, visible: true },
      { id: 'S4', src: 'DE = (-3,1) (-1,3)', params: [], color: '#e879f9', fill: false, visible: true },
    ]
    out.push(doc('shapes', 'Shapes', input({ shapes, viewport: { center: { x: 1, y: 1.5 }, pxPerUnit: 50 } })))
  }

  // ---- measurements on shapes: every chip a measured shape can draw — √
  // lengths, fractional slopes, degree arcs, △ / ∥ / ⊥ in the summary, a
  // midpoint's fractions, a point pair and a linked line's equation
  {
    const all = ['lengths', 'slopes', 'angles', 'right', 'marks', 'midpoints', 'area', 'classify'] as const
    const shapes = [
      { id: 'M1', src: 'ABCD = (0,0) (4,1) (5,4) (1,3)', params: [], color: '#4f9cf9', fill: false, visible: true, measure: { show: [...all] } },
      { id: 'M2', src: 'EFG = (-6,0) (-6+2sqrt(3),0) (-6+2sqrt(3),2)', params: [], color: '#f97316', fill: false, visible: true, measure: { show: [...all] } },
      { id: 'M3', src: 'HK = (-5,-4) (-1,-2)', params: [], color: '#22c55e', fill: false, visible: true, measure: { show: ['lengths', 'slopes', 'midpoints', 'equation'] } },
      { id: 'M4', src: 'P = (2, -3)', params: [], color: '#e879f9', fill: false, visible: true, measure: { show: ['lengths', 'slopes', 'midpoints'], to: 'M1#1' } },
      { id: 'M5', src: 'perpendicular to AB through P', params: [], color: '#f43f5e', fill: false, visible: true, measure: { show: ['equation', 'slopes'] } },
    ] as const
    out.push(doc('measure', 'Measurements: ABCD ∥ & △EFG', input({ shapes: shapes.map((x) => ({ ...x, measure: { ...x.measure, show: [...x.measure.show] } })), viewport: { center: { x: 0, y: 0.5 }, pxPerUnit: 45 } })))
  }

  // ---- transformations of shapes: a rotation (arc, centre O), a reflection of
  // the image (mirror line, primes ″), a dilation by 1/2 (rays, centre), a
  // translation (vector ⟨a, b⟩) with vertex paths, and a symmetry overlay
  {
    const sh = (id: string, src: string, color: string, extra: Record<string, unknown> = {}) => ({ id, src, params: [], color, fill: false, visible: true, ...extra })
    const shapes = [
      sh('X1', 'ABC = (1,1) (4,1) (4,3)', '#4f9cf9'),
      sh('X2', 'rotate ABC 90° about (0, 0)', '#f97316', { xform: { of: 'X1', op: { t: 'rotate', angle: '90', about: '(0, 0)' } } }),
      sh('X3', 'reflect A′B′C′ across y = x', '#22c55e', { xform: { of: 'X2', op: { t: 'reflect', line: 'y = x' } } }),
      sh('X4', 'dilate ABC by 1/2 about (1, -1)', '#e879f9', { xform: { of: 'X1', op: { t: 'dilate', k: '1/2', about: '(1, -1)' } } }),
      sh('X5', 'PQ = (-6,-4) (-4,-2)', '#f43f5e'),
      sh('X6', 'translate PQ by <3, -2>', '#f43f5e', { xform: { of: 'X5', op: { t: 'translate', by: ['3', '-2'] }, aids: ['paths', 'vector'] } }),
      sh('X7', 'KLMN = (-6,1) (-4,1) (-4,3) (-6,3)', '#4f9cf9', { sym: true }),
    ]
    out.push(doc('xform', 'Transformations: A′B′C′, A″B″C″', input({ shapes: shapes as never, viewport: { center: { x: -0.5, y: 0 }, pxPerUnit: 38 } })))
  }

  // ---- implicit curve with tangent marks, and a conic construction
  {
    const { curves, exprSources } = lines({ P: 'x^2 + y^2 = 25', c1: '(x - 1)^2/25 + (y - 2)^2/9 = 1' })
    const line: FittedCurve = { id: 'L', modelId: 'line', params: [6.25, 0.75], kind: 'explicit', domain: null, color: '#f43f5e', strokeWidth: 2, visible: true, error: 0 }
    out.push(
      doc('implicit', 'Implicit tangent and conic', input({
        curves: [...curves, line], exprSources, viewport: { center: { x: 0, y: 0 }, pxPerUnit: 30 },
        curveViews: { c1: { construction: true } },
        calc: [{ kind: 'tangent', id: 'T', parentId: 'P', curveId: 'L', x: -3, y: 4, marks: true }],
      })),
    )
  }

  return out
}

/** One LaTeX export to compile. */
export interface CorpusTex {
  /** A file-safe name: doc-style-format. */
  name: string
  format: 'tikz' | 'pgfplots' | 'sheet-tikz' | 'sheet-pgfplots' | 'bank-stem' | 'bank-key'
  tex: string
}

export const FIGURE_WIDTH_CM = 8

export function loadModels(docs: readonly CorpusDoc[]): Map<string, DocModel> {
  const out = new Map<string, DocModel>()
  for (const d of docs) {
    const m = docModelFromJSON(d.json)
    if (!m) throw new Error(`corpus document ${d.id} did not load`)
    if (m.problems.length > 0) throw new Error(`corpus document ${d.id}: ${m.problems.join('; ')}`)
    out.set(d.id, m)
  }
  return out
}

/** Every single-figure export: each document, in each style, as TikZ and pgfplots. */
export function figureExports(models: Map<string, DocModel>, styles: readonly FigureStyleId[] = STYLES): CorpusTex[] {
  const out: CorpusTex[] = []
  for (const [id, m] of models) {
    for (const style of styles) {
      for (const answers of [true, false]) {
        // The key in every style; the student copy in one (it is a subset).
        if (!answers && style !== 'textbook') continue
        // The default width in every style; the narrowest and a wide one in two.
        const widths = !answers ? [FIGURE_WIDTH_CM] : style === 'textbook' ? [FIGURE_WIDTH_CM, 3] : style === 'ap' ? [FIGURE_WIDTH_CM, 16] : [FIGURE_WIDTH_CM]
        for (const widthCm of widths) {
          const f = docFigure(m, { style, answers, widthCm })
          const tag = `${id}-${style}${answers ? '' : '-student'}${widthCm === FIGURE_WIDTH_CM ? '' : `-${widthCm}cm`}`
          const list = recordFigure(f)
          out.push({ name: `${tag}-tikz`, format: 'tikz', tex: toTikz(list, { title: m.name }) })
          if (m.kind === 'cartesian') {
            out.push({
              name: `${tag}-pgfplots`,
              format: 'pgfplots',
              tex: toPgfplots(f.scene, { widthCm, sources: f.sources, extraMarkers: f.context, title: m.name }),
            })
          }
        }
      }
    }
  }
  return out
}

/** Worksheets of several figures: student and key, TikZ and pgfplots, in 1, 2 and 3 columns. */
export function sheetExports(models: Map<string, DocModel>): CorpusTex[] {
  const lookup = (id: string): DocModel | null => models.get(id) ?? null
  const sheets: Worksheet[] = [
    {
      ...newWorksheet('Quiz 3', 100),
      id: 'ws2',
      title: 'Quiz 3 — Graphs {of} f & g: 100% ğ',
      cols: 2,
      style: 'sat',
      items: [
        { docId: 'explicit', caption: 'y = x³ − 3x' },
        { docId: 'piecewise', caption: TRICKY_CAPTION },
        { docId: 'areas' },
        { docId: 'taylor', style: 'ap' },
        { docId: 'nlsolve' },
        { docId: 'lp', style: 'textbook' },
      ],
    },
    {
      ...newWorksheet('AP bank', 100),
      id: 'ws3',
      title: 'AP Calculus — item bank',
      cols: 3,
      style: 'ap',
      items: [
        { docId: 'signchart' },
        { docId: 'slopefield' },
        { docId: 'polar' },
        { docId: 'param' },
        { docId: 'series' },
        { docId: 'secant' },
        { docId: 'limit' },
        { docId: 'volume' },
        { docId: 'unitcircle' },
        { docId: 'normal' },
        { docId: 'simcompare' },
        { docId: 'gone' },
      ],
    },
    {
      ...newWorksheet('A4 landscape', 100),
      id: 'ws4',
      title: 'Number lines & polar — A4',
      cols: 3,
      page: 'a4',
      orientation: 'landscape',
      numbering: '1',
      style: 'screen',
      items: [{ docId: 'nlstacked' }, { docId: 'nldistance' }, { docId: 'rose' }, { docId: 'rrladder' }, { docId: 'caption', caption: 'ı İ ğ Ğ ş Ş — 1/2' }],
    },
    {
      ...newWorksheet('One column', 100),
      id: 'ws1',
      title: 'Warm-up',
      cols: 1,
      style: 'textbook',
      items: [{ docId: 'data', caption: 'Population, 50% growth?' }, { docId: 'shapes' }, { docId: 'measure', caption: 'Classify ABCD; find sin E.' }],
    },
  ]
  const out: CorpusTex[] = []
  for (const sheet of sheets) {
    for (const answers of [false, true]) {
      const built = buildSheet(sheet, lookup, answers)
      for (const pgf of [false, true]) {
        out.push({
          name: `${sheet.id}-${answers ? 'key' : 'student'}-${pgf ? 'pgfplots' : 'tikz'}`,
          format: pgf ? 'sheet-pgfplots' : 'sheet-tikz',
          tex: sheetLatex(sheet, built.figures, answers, { pgfplots: pgf }),
        })
      }
    }
  }
  return out
}

/**
 * The preamble an export's header comment declares: every `%   \command…`
 * line under "% Preamble", with its trailing comment dropped. The contract
 * the teacher follows.
 */
export function declaredPreamble(tex: string): string[] {
  const out: string[] = []
  let inside = false
  for (const line of tex.split('\n')) {
    if (!line.startsWith('%')) break
    if (/^%\s*Preamble/i.test(line)) {
      inside = true
      continue
    }
    if (!inside) continue
    const m = /^%\s+(\\\S.*)$/.exec(line)
    if (!m) {
      inside = false
      continue
    }
    out.push(m[1].replace(/\s+%.*$/, '').trim())
  }
  return out
}

// ---------------------------------------------------------------------------
// The AP item bank: "Copy for item bank" blocks, pasted into a record
// ---------------------------------------------------------------------------

/** The graphs whose bank blocks are compiled (every family a stem figure can be). */
export const BANK_DOCS: readonly string[] = [
  'explicit', 'caption', 'sketch', 'piecewise', 'piaxes', 'areas', 'tangent', 'secant', 'signchart',
  'slopefield', 'polar', 'param', 'series', 'shapes', 'measure', 'xform', 'implicit', 'data', 'lp',
]

/** Stems as the bank holds them, graphed by "Graph from item" and copied back. */
export const BANK_STEMS: readonly { id: string; src: string }[] = [
  {
    id: 'AB-0044',
    src: [
      '%%% ITEM AB-0044',
      '%%% figure=needed',
      "\\begin{stem} The graph of $f'$, the derivative of $f$, is shown above for $-3 \\le x \\le 4$, where $f(x) = x^3 - 3x$. \\end{stem}",
      '%%% END',
    ].join('\n'),
  },
  {
    id: 'AB-0050',
    src: "Let $f(x)=\\begin{cases} x^2+1 & x<1 \\\\ 3-x & x\\ge 1\\end{cases}$. Is $f$ continuous at $x=1$?",
  },
  { id: 'BC-0007', src: 'The polar curve $r = 2 + \\cos\\theta$ for $0\\le\\theta\\le 2\\pi$ is shown.' },
  { id: 'BC-0012', src: 'A particle moves with $x(t) = t^2 - 1$ and $y(t) = 2t$ for $0 \\le t \\le 3$.' },
  { id: 'AB-0061', src: 'Consider the differential equation $\\frac{dy}{dx} = x - y$.' },
]

/**
 * Every bank block to compile: the student figure (house style, TikZ and
 * pgfplots) of each graph, its key figure, a few without house style, and the
 * documents "Graph from item" builds from BANK_STEMS. 'bank-stem' blocks are
 * pasted inside a stem, 'bank-key' blocks inside a key.
 */
export function bankExports(models: Map<string, DocModel>, widthCm = 7): CorpusTex[] {
  const out: CorpusTex[] = []
  const add = (tag: string, m: DocModel): void => {
    out.push({ name: `bank-${tag}-tikz`, format: 'bank-stem', tex: bankFigure(m, { format: 'tikz', answers: false, widthCm, house: true }).block })
    out.push({ name: `bank-${tag}-pgfplots`, format: 'bank-stem', tex: bankFigure(m, { format: 'pgfplots', answers: false, widthCm, house: true }).block })
    out.push({ name: `bank-${tag}-key-tikz`, format: 'bank-key', tex: bankFigure(m, { format: 'tikz', answers: true, widthCm, house: true }).block })
  }
  for (const id of BANK_DOCS) {
    const m = models.get(id)
    if (!m) throw new Error(`bank corpus: no document ${id}`)
    add(id, m)
  }
  for (const id of ['explicit', 'areas']) {
    const m = models.get(id)!
    out.push({ name: `bank-${id}-plain-pgfplots`, format: 'bank-key', tex: bankFigure(m, { format: 'pgfplots', answers: true, widthCm: 9, house: false }).block })
  }
  for (const st of BANK_STEMS) {
    const plan = planItem(st.src)
    const m = docModelFromJSON(buildItemDoc(plan, st.id).json)
    if (!m) throw new Error(`bank corpus: ${st.id} did not load`)
    add(st.id.toLowerCase(), m)
  }
  return out
}

/** The packages a bank block's comment line names (its preamble). */
export function bankPreamble(tex: string): string[] {
  const line = tex.split('\n').find((l) => /^% Grapher figure .* — preamble:/.test(l)) ?? ''
  return [...line.matchAll(/\\(?:usepackage|pgfplotsset|usepgfplotslibrary)\{[^}]*\}/g)].map((m) => m[0])
}

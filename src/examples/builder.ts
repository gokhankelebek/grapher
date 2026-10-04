// ============================================================================
// src/examples/builder.ts — an example document, written as typed source.
//
// An example is not a JSON blob somebody saved once: it is a short recipe —
// "type f(x) = x³, put a secant on it from −2 to 2, switch on the MVT" — that
// this builder carries out through the SAME construction path the App takes
// when a teacher does those things by hand:
//
//   - a typed line is parsed by parseExpression and gets the next expr_N
//     model, its letter from its head (f of `f(x) = …`), the next free colour;
//   - a derivative, a tangent, an accumulation function, a Taylor polynomial
//     get the curve the App's addCalcObject would make (derivativeModel,
//     tangentAt / implicitTangent, accumulationModel, tay_<link id>);
//   - an inverse is the App's linked relation (inverseRange / inverseInfo) or,
//     for an exponential or a logarithm, its exact inverse (planInverse);
//   - a slope field is read by readField, a sequence by readSequence, a
//     regression fitted by fitRegression and written by regressionSource, a
//     unit circle and a related-rates problem start from newUnitCircle /
//     newRelatedRates, an inequality on the number line is solved first;
//   - a shape's image is the App's addImageCommand ("rotate ABC 90° about
//     (0, 0)": parseXformCommand, the target found by name, resolveOp), and a
//     data plot or a probability object starts from newDataPlot / newProb and
//     is framed the way Build ▾ frames it (statsBox).
//
// What comes out is a BoardInput, stored with docFromBoard → serializeDoc —
// the bytes the App would write — and every example is loaded back through
// deserializeDoc in tests/examples.test.ts with zero load problems.
//
// Pure: no React, no DOM, no storage. Each method validates as the App's own
// action does and THROWS (with the example's line in the message) where the
// App would have shown a toast, so a broken example fails its test loudly
// instead of shipping a board with something quietly missing.
// ============================================================================

import type { BoardKind, FittedCurve, ModelSpec, NLSolveShow, Vec2 } from '../core/types'
import { CURVE_COLORS, NL_SOLVE_DEFAULTS } from '../core/types'
import { MODELS } from '../core/fit/models'
import { parseExpression } from '../core/parse'
import { accumulationModel, derivativeModel, tangentAt } from '../core/calculus'
import type { RiemannMethod } from '../core/calculus'
import type { RegressionKind } from '../core/data'
import { fitRegression, regressionSource } from '../core/data'
import type { RRScenario } from '../core/relatedRates'
import { solveWhen } from '../core/relatedRates'
import { solveInequality } from '../core/solveInequality'
import type { SectionShape, VolumeAxis, VolumeMethod } from '../core/volume'
import type { UnwrapFn, InvFn } from '../core/trig'
import type {
  BoardData,
  BoardField,
  BoardGrid,
  BoardIneqSystem,
  BoardInput,
  BoardRelatedRates,
  BoardSequence,
  BoardShape,
  BoardUnitCircle,
  CalcLink,
  CurveStyle,
  CurveView,
  DataRegression,
  InverseLink,
  SignLevel,
  StoredDoc,
  UnitCircleShow,
} from '../core/persist'
import {
  ACCUM_MODEL_PREFIX,
  DERIV_MODEL_PREFIX,
  FIELD_SPACING_DEFAULT,
  INV_MODEL_PREFIX,
  REG_DIGITS_DEFAULT,
  TAYLOR_MODEL_PREFIX,
  cleanSignRows,
  docFromBoard,
} from '../core/persist'
import type { CentreFlag, FigureStyleId, MeasureFlag, NLItem, XformAid } from '../core/types'
import { CENTRE_FLAGS, MEASURE_FLAGS } from '../core/types'
import { cleanXform, NEW_DOC_FIGURE } from '../core/persist'
import type { CircleView, ShapeMeasureSettings, TableCalcView } from '../core/persist'
import { normalizeTableCalc } from '../core/persist'
import { parseXformCommand, resolveOp } from '../core/parse/xform'
import type { BoardStat, DataDist, DataPlotSet } from '../core/statsPersist'
import { newProb } from '../core/probPersist'
import type { ProbTable, ProbTree, ProbVenn, ProbView } from '../core/probPersist'
import { newDataPlot } from '../ui/dataPlotLinks'
import { probCard, settleProb } from '../ui/probLinks'
import { statsBox } from '../ui/statsLinks'
import { compileShapes, namedPointMap } from '../ui/shapeLinks'
import { imageSrc, shapeByName } from '../ui/shapeXform'
import { dataBox } from '../ui/dataLinks'
import { typedName } from '../render/curveNames'
import { accumColor } from '../ui/calcLinks'
import { dataColumns } from '../ui/dataLinks'
import { readField } from '../ui/fieldLinks'
import { implicitTangent, isImplicitCurve, tangentCurvePatch } from '../ui/implicitLinks'
import { MIRROR_COLOR, MIRROR_DASH, MIRROR_SRC, inverseColor, isIdentityLine, planInverse } from '../ui/logLinks'
import { boardLetters, boundCalls, inverseInfo, inverseRange } from '../ui/nameLinks'
import { readShape } from '../ui/shapeLinks'
import { defaultSeriesView, defaultWindow, nextSequenceLetter, readSequence } from '../ui/seqLinks'
import { newRelatedRates, relatedRatesBox } from '../ui/relatedRatesLinks'
import { safePoly, taylorSourceFor } from '../ui/taylorLinks'
import { newUnitCircle, unitCircleBox } from '../ui/unitCircleLinks'
import { logisticFieldPlan, safeReadLogistic } from '../ui/logisticLinks'

/** The board size an example's window is framed for (the thumbnails' size too). */
export const EXAMPLE_SCREEN = { widthPx: 900, heightPx: 600 } as const

/** The derivative's dash, as the App draws it (useCalcLinks' DERIV_DASH). */
const DERIV_DASH = [8, 6]

/** A window: the x-range and (on a graph) the y-range the board opens on. */
export interface ExampleWindow {
  x: [number, number]
  /** Absent on a number line. */
  y?: [number, number]
  /** Scale the axes independently (data in years against thousands). */
  independent?: boolean
}

export interface LineOptions {
  color?: string
  /** Dash pattern in px, as Curve ⋯ → Line sets it. */
  dash?: number[]
  strokeWidth?: number
  hidden?: boolean
}

/** One example board under construction. */
export class ExampleBoard {
  readonly kind: BoardKind
  private seq = 0
  private exprCounter = 0
  private derivCounter = 0
  private readonly curves: FittedCurve[] = []
  private readonly models: Record<string, ModelSpec> = { ...MODELS }
  private readonly exprSources: Record<string, string> = {}
  private readonly names: Record<string, string> = {}
  private readonly styles: Record<string, CurveStyle> = {}
  private readonly calc: CalcLink[] = []
  private readonly inverses: InverseLink[] = []
  private readonly fields: BoardField[] = []
  private readonly shapes: BoardShape[] = []
  private readonly data: BoardData[] = []
  private readonly sequences: BoardSequence[] = []
  private readonly unitCircles: BoardUnitCircle[] = []
  private readonly relatedRates: BoardRelatedRates[] = []
  private readonly stats: BoardStat[] = []
  private readonly items: NLItem[] = []
  private readonly views: Record<string, CurveView> = {}
  private systemSettings: BoardIneqSystem | null = null
  private selected: string | null = null
  private win: ExampleWindow | null = null
  private ruling: BoardGrid = 'cartesian'
  // An opened example is a new document: it exports in the new-document style.
  private figureStyle: FigureStyleId = NEW_DOC_FIGURE
  private axisX: 'auto' | 'pi' | 'decimal' = 'auto'

  constructor(kind: BoardKind = 'cartesian') {
    this.kind = kind
  }

  // ------------------------------------------------------------ internals

  private id(): string {
    return `e${++this.seq}`
  }

  /** The next palette colour nobody on the board has, as the App's pickColor. */
  private nextColor(): string {
    const used = new Set<string>([
      ...this.curves.map((c) => c.color),
      ...this.fields.map((f) => f.color),
      ...this.shapes.map((s) => s.color),
      ...this.data.map((d) => d.color),
      ...this.sequences.map((q) => q.color),
      ...this.items.map((i) => i.color),
    ])
    const free = CURVE_COLORS.find((c) => !used.has(c))
    return free ?? CURVE_COLORS[used.size % CURVE_COLORS.length]
  }

  private curve(id: string, what: string): FittedCurve {
    const c = this.curves.find((k) => k.id === id)
    if (!c) throw new Error(`example: ${what} — no curve ${id}`)
    return c
  }

  private requireGraph(what: string): void {
    if (this.kind !== 'cartesian') throw new Error(`example: ${what} belongs on a graph, not a number line`)
  }

  /** The x-range the board opens on (what the App calls the view window). */
  private windowX(): [number, number] {
    return this.win ? this.win.x : [-10, 10]
  }

  /** Add one typed line exactly as addExpression does; returns its curve id. */
  private typed(src: string, o: LineOptions, color: string): string {
    this.requireGraph(src)
    const head = typedName(src)
    const calls = boundCalls(src, { letters: boardLetters(this.names, {}, head ?? undefined) })
    if (calls.length > 0) {
      throw new Error(`example: “${src}” calls ${calls.join(', ')} — write the line out in full instead`)
    }
    if (head && Object.values(this.names).includes(head)) {
      throw new Error(`example: “${src}” claims the letter ${head}, which another line already has`)
    }
    const outcome = parseExpression(src)
    if (!outcome.ok) throw new Error(`example: “${src}” does not parse: ${outcome.error}`)
    const modelId = `expr_${++this.exprCounter}`
    this.models[modelId] = outcome.plot.makeModel(modelId)
    const id = this.id()
    this.curves.push({
      id,
      modelId,
      params: outcome.plot.defaultParams.slice(),
      kind: outcome.plot.kind,
      domain: outcome.plot.domain,
      color,
      strokeWidth: o.strokeWidth ?? 2.5,
      visible: o.hidden !== true,
      error: 0,
    })
    this.exprSources[id] = src
    if (head) this.names[id] = head
    if (o.dash) this.styles[id] = { ...this.styles[id], dash: o.dash.slice() }
    this.selected = id
    return id
  }

  // ------------------------------------------------------------ the board

  /** The window the board opens on. */
  frame(x: [number, number], y?: [number, number], opts: { independent?: boolean } = {}): this {
    this.win = { x, ...(y ? { y } : {}), ...(opts.independent ? { independent: true } : {}) }
    return this
  }

  /** Draw on circles and spokes (Settings → Ruling: polar). */
  polarGrid(): this {
    this.requireGraph('the polar ruling')
    this.ruling = 'polar'
    return this
  }

  /** The x axis in multiples of π. */
  piAxis(): this {
    this.requireGraph('π on the x-axis')
    this.axisX = 'pi'
    return this
  }

  /** The figure style the document exports in. */
  figure(style: FigureStyleId): this {
    this.figureStyle = style
    return this
  }

  /** Which object is selected when the board opens (its card is the open one). */
  select(id: string): this {
    this.selected = id
    return this
  }

  /**
   * A circle's Circle theorems section: points typed on it and the figures
   * drawn — the card's own switches, with the points it would add.
   */
  circle(curveId: string, v: CircleView): this {
    this.curve(curveId, 'circle theorems')
    return this.view(curveId, { circle: { ...v, ...(v.pts ? { pts: v.pts.slice() } : {}), ...(v.show ? { show: v.show.slice() } : {}) } })
  }

  /** A curve's view settings: a conic's construction, a restricted line's ghost, … */
  view(curveId: string, v: CurveView): this {
    this.curve(curveId, 'view settings')
    this.views[curveId] = { ...this.views[curveId], ...v }
    return this
  }

  // ------------------------------------------------------------ typed lines

  /** A typed line — an equation, an inequality, a polar or parametric curve. */
  line(src: string, o: LineOptions = {}): string {
    return this.typed(src, o, o.color ?? this.nextColor())
  }

  // ------------------------------------------------------------ calculus (Curve ⋯ → Calculus)

  /** f′, drawn dashed in f's colour. */
  derivative(parentId: string): string {
    const parent = this.curve(parentId, 'derivative')
    const n = this.derivCounter + 1
    const wantId = `${DERIV_MODEL_PREFIX}${n}`
    const d = derivativeModel(parent, this.models, wantId)
    if (!d) throw new Error(`example: ${this.exprSources[parentId] ?? parentId} cannot be differentiated`)
    if (d.spec.id === wantId) {
      this.derivCounter = n
      this.models[wantId] = d.spec
    }
    const id = this.id()
    this.curves.push({
      id,
      modelId: d.spec.id,
      params: d.params.slice(),
      kind: 'explicit',
      domain: d.domain,
      color: parent.color,
      strokeWidth: 2.5,
      visible: true,
      error: 0,
    })
    this.styles[id] = { ...this.styles[id], dash: DERIV_DASH.slice() }
    this.calc.push({ kind: 'derivative', id: this.id(), parentId, curveId: id })
    this.selected = id
    return id
  }

  /**
   * The tangent line at x. On an implicit curve, at the point (x, y) — y says
   * which branch — with `marks` for the horizontal and vertical tangents.
   */
  tangent(parentId: string, x: number, o: { y?: number; marks?: boolean } = {}): string {
    const parent = this.curve(parentId, 'tangent')
    const linkId = this.id()
    if (isImplicitCurve(parent, this.models)) {
      if (o.y === undefined) throw new Error('example: a tangent to an implicit curve needs its point’s y')
      const probe = { kind: 'tangent' as const, id: linkId, parentId, curveId: '', x, y: o.y }
      const st = implicitTangent(probe, parent, this.models)
      const patch = st ? tangentCurvePatch(st.tangent) : null
      if (!st || !patch) throw new Error(`example: no tangent at (${x}, ${o.y})`)
      const id = this.id()
      this.curves.push({
        id,
        modelId: patch.modelId,
        params: patch.params.slice(),
        kind: patch.kind,
        domain: null,
        color: parent.color,
        strokeWidth: 2,
        visible: true,
        error: 0,
      })
      this.calc.push({
        kind: 'tangent',
        id: linkId,
        parentId,
        curveId: id,
        x: st.point.x,
        y: st.point.y,
        ...(o.marks ? { marks: true as const } : {}),
      })
      this.selected = parentId
      return id
    }
    const t = tangentAt(parent, this.models, x)
    if (!t) throw new Error(`example: no tangent at x = ${x}`)
    const id = this.id()
    this.curves.push({
      id,
      modelId: 'line',
      params: [t.b, t.m],
      kind: 'explicit',
      domain: null,
      color: parent.color,
      strokeWidth: 2,
      visible: true,
      error: 0,
    })
    this.calc.push({ kind: 'tangent', id: linkId, parentId, curveId: id, x })
    this.selected = id
    return id
  }

  /** The secant over [a, b]; `mvt` and `avg` switch on the MVT and the average value. */
  secant(parentId: string, a: number, b: number, o: { mvt?: boolean; avg?: boolean } = {}): this {
    this.curve(parentId, 'secant')
    this.calc.push({
      kind: 'secant',
      id: this.id(),
      parentId,
      a,
      b,
      ...(o.mvt ? { mvt: true as const } : {}),
      ...(o.avg ? { avg: true as const } : {}),
    })
    this.selected = parentId
    return this
  }

  /** lim x→a, with the table of values and / or the ε–δ picture. */
  limit(
    parentId: string,
    a: number,
    o: { side?: 'left' | 'right'; table?: boolean; epsilon?: boolean; eps?: number } = {},
  ): this {
    this.curve(parentId, 'limit')
    this.calc.push({
      kind: 'limit',
      id: this.id(),
      parentId,
      a,
      ...(o.side ? { side: o.side } : {}),
      ...(o.table ? { table: true as const } : {}),
      ...(o.epsilon ? { epsilon: true as const } : {}),
      ...(o.eps !== undefined ? { eps: o.eps } : {}),
    })
    this.selected = parentId
    return this
  }

  /** ∫ from `from` to `to`, shaded — between two curves when `other` is given (∫|f − g| by default). */
  area(parentId: string, from: number, to: number, o: { other?: string; abs?: boolean } = {}): this {
    this.curve(parentId, 'area')
    if (o.other !== undefined) this.curve(o.other, 'area between curves')
    this.calc.push({
      kind: 'area',
      id: this.id(),
      parentId,
      ...(o.other !== undefined ? { otherId: o.other } : {}),
      from,
      to,
      abs: o.abs ?? o.other !== undefined,
    })
    this.selected = parentId
    return this
  }

  /** A Riemann sum with n rectangles (or trapezoids). */
  riemann(parentId: string, from: number, to: number, n: number, method: RiemannMethod = 'left'): this {
    this.curve(parentId, 'Riemann sum')
    this.calc.push({ kind: 'riemann', id: this.id(), parentId, from, to, n, method })
    this.selected = parentId
    return this
  }

  /** g(x) = C + ∫ₐˣ f(t) dt, with the probe at x. */
  accumulation(parentId: string, a: number, o: { C?: number; x?: number } = {}): string {
    const parent = this.curve(parentId, 'accumulation function')
    const linkId = this.id()
    const wantId = `${ACCUM_MODEL_PREFIX}${linkId}`
    const C = o.C ?? 0
    const acc = accumulationModel(parent, this.models, a, C, wantId)
    if (!acc) throw new Error(`example: no accumulation function from a = ${a}`)
    if (acc.spec.id === wantId) this.models[wantId] = acc.spec
    const id = this.id()
    this.curves.push({
      id,
      modelId: acc.spec.id,
      params: acc.params.slice(),
      kind: 'explicit',
      domain: acc.domain,
      color: accumColor(parent.color),
      strokeWidth: 2.5,
      visible: true,
      error: 0,
    })
    this.calc.push({
      kind: 'accumulation',
      id: linkId,
      parentId,
      curveId: id,
      a,
      C,
      ...(o.x !== undefined ? { x: o.x } : {}),
    })
    this.selected = parentId
    return id
  }

  /** Pₙ about a, its own curve; `band` the Lagrange error band, `ioc` the interval of convergence. */
  taylor(
    parentId: string,
    a: number,
    n: number,
    o: { x?: number; band?: boolean; ioc?: boolean; color?: string } = {},
  ): string {
    const parent = this.curve(parentId, 'Taylor polynomial')
    if (!safePoly(taylorSourceFor(parent, this.models, false), a, n)) {
      throw new Error(`example: no Taylor polynomial of degree ${n} about ${a}`)
    }
    const linkId = this.id()
    const id = this.id()
    this.curves.push({
      id,
      modelId: `${TAYLOR_MODEL_PREFIX}${linkId}`,
      params: [],
      kind: 'explicit',
      domain: null,
      color: o.color ?? this.nextColor(),
      strokeWidth: 2.5,
      visible: true,
      error: 0,
    })
    this.calc.push({
      kind: 'taylor',
      id: linkId,
      parentId,
      curveId: id,
      a,
      n,
      ...(o.x !== undefined ? { x: o.x } : {}),
      ...(o.band ? { band: true } : {}),
      ...(o.ioc ? { ioc: true } : {}),
    })
    this.selected = parentId
    return id
  }

  /** A solid on the region under f (or between f and `other`) over [a, b]. */
  volume(
    parentId: string,
    a: number,
    b: number,
    o: {
      other?: string
      method?: VolumeMethod
      axis?: VolumeAxis
      section?: SectionShape
      ratio?: number
      perp?: 'y'
      x?: number
    } = {},
  ): this {
    this.curve(parentId, 'volume')
    if (o.other !== undefined) this.curve(o.other, 'volume')
    this.calc.push({
      kind: 'volume',
      id: this.id(),
      parentId,
      ...(o.other !== undefined ? { otherId: o.other } : {}),
      a,
      b,
      method: o.method ?? 'washer',
      ...(o.axis ? { axis: o.axis } : {}),
      ...(o.section ? { section: o.section } : {}),
      ...(o.ratio !== undefined ? { ratio: o.ratio } : {}),
      ...(o.perp ? { perp: o.perp } : {}),
      ...(o.x !== undefined ? { x: o.x } : {}),
    })
    this.selected = parentId
    return this
  }

  /** The sign chart; `as: 'f1'` reads the graph as f′ ("the graph of f′ is shown"). */
  signChart(
    parentId: string,
    o: { as?: 'f1' | 'f2'; rows?: SignLevel[]; arrows?: boolean; cup?: boolean; guides?: boolean; a?: number; b?: number } = {},
  ): this {
    this.curve(parentId, 'sign chart')
    const rows = cleanSignRows(o.rows ?? [o.as ?? 'f1'], o.as)
    if (rows.length === 0) throw new Error('example: a sign chart needs at least one row it can show')
    this.calc.push({
      kind: 'signchart',
      id: this.id(),
      parentId,
      ...(o.as ? { as: o.as } : {}),
      rows,
      ...(o.arrows ? { arrows: true as const } : {}),
      ...(o.cup ? { cup: true as const } : {}),
      ...(o.guides ? { guides: true as const } : {}),
      ...(o.a !== undefined && o.b !== undefined ? { a: o.a, b: o.b } : {}),
    })
    this.selected = parentId
    return this
  }

  /** Parametric / polar calculus at t (θ); `marks` the horizontal and vertical tangents. */
  paramCalc(parentId: string, t: number, o: { marks?: boolean; a?: number; b?: number } = {}): this {
    const c = this.curve(parentId, 'parametric calculus')
    if (c.kind !== 'parametric' && c.kind !== 'polar') throw new Error('example: only a parametric or polar curve')
    this.calc.push({
      kind: 'pcalc',
      id: this.id(),
      parentId,
      t,
      ...(o.marks ? { marks: true as const } : {}),
      ...(o.a !== undefined && o.b !== undefined ? { a: o.a, b: o.b } : {}),
    })
    this.selected = parentId
    return this
  }

  /** The area inside the parent polar curve and outside `other` (or the other way round with `swap`). */
  polarBetween(parentId: string, other: string, o: { swap?: boolean } = {}): this {
    this.curve(parentId, 'polar area')
    this.curve(other, 'polar area')
    this.calc.push({
      kind: 'polarbetween',
      id: this.id(),
      parentId,
      otherId: other,
      ...(o.swap ? { swap: true as const } : {}),
    })
    this.selected = parentId
    return this
  }

  // ------------------------------------------------------------ inverses (Curve ⋯ → Show inverse)

  /**
   * "Show inverse": an exponential or a logarithm gets its exact inverse as a
   * typed line; anything else the linked relation x = f(y). Either way, the
   * dashed y = x once per board. Returns the inverse's curve id.
   */
  inverse(parentId: string): string {
    const parent = this.curve(parentId, 'inverse')
    const src = this.exprSources[parentId]
    const existing = Object.values(this.exprSources)
    const plan = src ? planInverse(src, existing) : null
    let inverseId: string
    if (plan) {
      if (!plan.src) throw new Error(`example: the inverse of “${src}” is already on the board`)
      inverseId = this.typed(plan.src, {}, inverseColor(parent.color))
    } else {
      const range = inverseRange(parent, this.windowX())
      const linkId = this.id()
      const link: InverseLink = { id: linkId, parentId, curveId: this.id(), from: range[0], to: range[1] }
      const info = inverseInfo(parent, this.models, link, this.names[parentId] ?? 'f')
      this.curves.push({
        id: link.curveId,
        modelId: `${INV_MODEL_PREFIX}${linkId}`,
        params: [],
        kind: 'parametric',
        domain: info.tRange,
        color: inverseColor(parent.color),
        strokeWidth: 2.5,
        visible: true,
        error: 0,
      })
      this.inverses.push(link)
      inverseId = link.curveId
    }
    if (!existing.some(isIdentityLine)) this.typed(MIRROR_SRC, { dash: MIRROR_DASH }, MIRROR_COLOR)
    this.selected = parentId
    return inverseId
  }

  // ------------------------------------------------------------ other objects on a graph

  /** A slope field, with solution curves through `through` and Euler runs. */
  field(
    src: string,
    o: {
      through?: Vec2[]
      euler?: { x0: number; y0: number; h: number; n: number; showTrue?: boolean; labels?: boolean }[]
      spacing?: number
      color?: string
    } = {},
  ): string {
    this.requireGraph(src)
    const outcome = readField(src)
    if (!outcome.ok) throw new Error(`example: “${src}” is not a slope field: ${outcome.error}`)
    const id = this.id()
    const field: BoardField = {
      id,
      src,
      params: outcome.defaultParams.slice(),
      color: o.color ?? this.nextColor(),
      spacingPx: o.spacing ?? FIELD_SPACING_DEFAULT,
      visible: true,
      solutions: (o.through ?? []).map((p) => ({ id: this.id(), x: p.x, y: p.y })),
    }
    if (o.euler && o.euler.length > 0) {
      field.eulers = o.euler.map((r) => ({
        id: this.id(),
        x0: r.x0,
        y0: r.y0,
        h: r.h,
        n: r.n,
        ...(r.showTrue ? { showTrue: true as const } : {}),
        ...(r.labels ? { labels: true as const } : {}),
      }))
    }
    this.fields.push(field)
    this.selected = id
    return id
  }

  /**
   * A logistic's "Show slope field": the equation it solves, with its own
   * initial condition (0, y(0)) as the solution curve — the App's
   * showLogisticField.
   */
  logisticField(curveId: string): string {
    const c = this.curve(curveId, 'logistic slope field')
    const spec = safeReadLogistic(this.exprSources[curveId])
    const plan = spec ? logisticFieldPlan(spec) : null
    if (!plan) throw new Error(`example: “${this.exprSources[curveId]}” is not a logistic with a slope field`)
    const id = this.field(plan.src, { through: plan.through ? [plan.through] : [], color: c.color })
    this.selected = curveId
    return id
  }

  /** A data table, and the regressions fitted to it (each a linked typed curve). */
  table(
    name: string,
    rows: [number | string, number | string][],
    o: {
      xLabel?: string
      yLabel?: string
      regressions?: RegressionKind[]
      color?: string
      /** Draw each point's residual to this fit (one per table). */
      residuals?: RegressionKind
      /** The residual plot of this fit, in a panel under the scatter plot — framed with it, as the App frames it. */
      residualPlot?: RegressionKind
      /** "Calculus on this table": the tools switched on (src/ui/tableCalcLinks.ts). */
      calc?: TableCalcView
    } = {},
  ): string {
    this.requireGraph('a data table')
    const id = this.id()
    const color = o.color ?? this.nextColor()
    const table: BoardData = {
      id,
      name,
      xLabel: o.xLabel ?? 'x',
      yLabel: o.yLabel ?? 'y',
      rows: rows.map(([x, y]) => ({ x: String(x), y: String(y) })),
      color,
      visible: true,
      regressions: [],
    }
    if (o.calc) {
      const calc = normalizeTableCalc(o.calc)
      if (!calc) throw new Error('example: an empty calc setting')
      table.calc = calc
    }
    // The table first, so the regression curve's colour is the table's own.
    this.data.push(table)
    for (const kind of o.regressions ?? []) {
      const cols = dataColumns(table.rows)
      const res = fitRegression(kind, cols.xs, cols.ys)
      if (!res.ok) throw new Error(`example: the ${kind} regression does not fit: ${res.error}`)
      const src = regressionSource(res, REG_DIGITS_DEFAULT)
      if (!src) throw new Error(`example: the ${kind} regression could not be written out`)
      const curveId = this.typed(src, { strokeWidth: 2 }, color)
      const reg: DataRegression = {
        id: this.id(),
        kind,
        curveId,
        digits: REG_DIGITS_DEFAULT,
        residuals: o.residuals === kind,
        ...(o.residualPlot === kind ? { residualPlot: true as const } : {}),
      }
      table.regressions.push(reg)
    }
    for (const want of [o.residuals, o.residualPlot]) {
      if (want && !table.regressions.some((r) => r.kind === want)) {
        throw new Error(`example: residuals of a ${want} fit the table does not have`)
      }
    }
    if ((o.residualPlot || o.calc) && !this.win) {
      const box = dataBox(table)
      if (box) this.win = { x: [box.min.x, box.max.x], y: [box.min.y, box.max.y], independent: true }
    }
    this.selected = id
    return id
  }

  /** A sequence as typed; `series` shows Σ with the partial sums to S_N. */
  sequence(
    src: string,
    o: {
      n0?: number
      count?: number
      partner?: boolean
      sums?: boolean
      series?: { N?: number; connect?: boolean; bars?: boolean }
      color?: string
    } = {},
  ): string {
    this.requireGraph(src)
    const parse = readSequence(src)
    if (!parse.ok) throw new Error(`example: “${src}” is not a sequence: ${parse.error}`)
    const s = parse.seq
    const params = s.defaultParams.slice()
    const win = defaultWindow(s, params)
    const id = this.id()
    const q: BoardSequence = {
      id,
      src,
      color: o.color ?? this.nextColor(),
      visible: true,
      n0: o.n0 ?? win.n0,
      count: o.count ?? win.count,
      showPartner: o.partner === true,
      showSums: o.sums === true,
      params,
      ...(s.kind === 'list' ? { name: nextSequenceLetter(Object.values(this.names)) } : {}),
    }
    if (o.series) {
      const base = defaultSeriesView(q)
      q.series = {
        N: o.series.N ?? base.N,
        connect: o.series.connect ?? base.connect,
        bars: o.series.bars ?? base.bars,
      }
    }
    this.sequences.push(q)
    this.selected = id
    return id
  }

  /** The unit circle, at θ, with what the lesson switches on. */
  unitCircle(o: {
    theta?: number
    center?: Vec2
    show?: Partial<UnitCircleShow>
    unwrap?: UnwrapFn
    inv?: { fn: InvFn; v: number }
    deg?: boolean
  } = {}): string {
    this.requireGraph('a unit circle')
    const uc = newUnitCircle(this.id())
    if (o.theta !== undefined) uc.theta = o.theta
    if (o.center) {
      uc.cx = o.center.x
      uc.cy = o.center.y
    }
    if (o.show) uc.show = { ...uc.show, ...o.show }
    if (o.unwrap) uc.unwrap = o.unwrap
    if (o.inv) uc.inv = { ...o.inv }
    if (o.deg) uc.deg = true
    // Framed as Build ▾ → Unit circle frames it: the circle and the room to
    // its right where the graph unwraps — unless the example says otherwise.
    if (!this.win) {
      const box = unitCircleBox(uc, true)
      this.win = { x: [box.min.x, box.max.x], y: [box.min.y, box.max.y] }
    }
    this.unitCircles.push(uc)
    this.selected = uc.id
    return uc.id
  }

  /** The related-rates problem; `when` asks "when x = 6" and moves t there. */
  relatedRatesProblem(
    scenario: RRScenario,
    o: { when?: { q: string; v: number }; params?: Record<string, number>; pause?: boolean } = {},
  ): string {
    this.requireGraph('a related-rates problem')
    const rr = newRelatedRates(this.id(), scenario)
    if (o.params) rr.params = { ...rr.params, ...o.params }
    if (o.when) rr.when = { ...o.when }
    if (rr.when) {
      const w = solveWhen(rr.scenario, rr.params, rr.when.q, rr.when.v)
      if (!w.ok) throw new Error(`example: related rates — ${w.error}`)
      rr.t = w.t
    }
    if (o.pause) rr.pause = true
    // Framed as Build ▾ → Related rates frames it, unless the example says otherwise.
    if (!this.win) {
      const box = relatedRatesBox(rr)
      this.win = { x: [box.min.x, box.max.x], y: [box.min.y, box.max.y] }
    }
    this.relatedRates.push(rr)
    this.selected = rr.id
    return rr.id
  }

  /** The inequality system's settings: solution region, test point, LP objective. */
  system(sys: BoardIneqSystem): this {
    this.requireGraph('an inequality system')
    this.systemSettings = { ...sys }
    return this
  }

  /**
   * A point, segment, vector or polygon, as typed — with the Measurements
   * toggles the lesson switches on (`measure`), and a polygon's symmetry
   * overlay (`sym`).
   */
  shape(
    src: string,
    o: { fill?: boolean; color?: string; measure?: MeasureFlag[]; sym?: boolean; centres?: CentreFlag[] } = {},
  ): string {
    this.requireGraph(src)
    const outcome = readShape(src)
    if (!outcome.ok) throw new Error(`example: “${src}” is not a shape: ${outcome.error}`)
    const id = this.id()
    const shape: BoardShape = {
      id,
      src,
      params: outcome.defaultParams.slice(),
      color: o.color ?? this.nextColor(),
      fill: o.fill === true,
      visible: true,
    }
    const measure = measureOf(o.measure)
    if (measure) shape.measure = measure
    if (o.centres && o.centres.length > 0) {
      if (outcome.kind !== 'polygon') throw new Error(`example: only a triangle has centers (“${src}”)`)
      shape.measure = { ...(shape.measure ?? {}), centres: CENTRE_FLAGS.filter((f) => o.centres!.includes(f)) }
    }
    if (o.sym) {
      if (outcome.kind !== 'polygon') throw new Error(`example: only a polygon has a symmetry overlay (“${src}”)`)
      shape.sym = true
    }
    this.shapes.push(shape)
    this.selected = id
    return id
  }

  /**
   * A figure's image, typed as the + box takes it — "rotate ABC 90° about
   * (0, 0)", "reflect ABC across y = x", "dilate ABC by 2 about (0, 0)" —
   * the App's addImageCommand: the figure found by name, the parameters
   * checked against the board's named points. Returns the image's id.
   */
  image(src: string, o: { aids?: XformAid[]; color?: string; measure?: MeasureFlag[] } = {}): string {
    this.requireGraph(src)
    const cmd = parseXformCommand(src)
    if ('error' in cmd) throw new Error(`example: “${src}” is not a transformation: ${cmd.error}`)
    const compiled = compileShapes(this.shapes)
    const list = [...compiled.values()].map((c) => ({ id: c.id, shape: c.shape }))
    const parentId = shapeByName(cmd.target, list)
    if (!parentId) throw new Error(`example: “${src}” — there is no figure named ${cmd.target} on the board`)
    const ok = resolveOp(cmd.op, namedPointMap(this.shapes, compiled))
    if ('error' in ok) throw new Error(`example: “${src}” — ${ok.error}`)
    const parent = compiled.get(parentId)?.shape ?? null
    const id = this.id()
    const xform = cleanXform({ of: parentId, op: cmd.op, ...(o.aids ? { aids: o.aids } : {}) })
    if (!xform) throw new Error(`example: “${src}” could not be stored`)
    const shape: BoardShape = {
      id,
      src: imageSrc(cmd.op, parent),
      params: [],
      color: o.color ?? this.nextColor(),
      fill: false,
      visible: true,
      xform,
    }
    const measure = measureOf(o.measure)
    if (measure) shape.measure = measure
    this.shapes.push(shape)
    if (compileShapes(this.shapes).get(id)?.error) throw new Error(`example: “${src}” — the image cannot be drawn`)
    this.selected = id
    return id
  }

  /** Shape card → Compare: this figure against another (congruent? similar? by what?). */
  compare(shapeId: string, otherId: string): this {
    const s = this.shapes.find((x) => x.id === shapeId)
    if (!s || !this.shapes.some((x) => x.id === otherId)) throw new Error('example: compare needs two shapes on the board')
    s.compare = otherId
    this.selected = shapeId
    return this
  }

  // ------------------------------------------------------------ statistics objects (Build ▾)

  /** Framed as Build ▾ frames a new statistics panel, unless the example says otherwise. */
  private addStat(s: BoardStat): string {
    this.requireGraph('a statistics panel')
    const index = this.stats.length
    this.stats.push(s)
    if (!this.win) {
      const box = statsBox(index)
      this.win = { x: [box.min.x, box.max.x], y: [box.min.y, box.max.y] }
    }
    this.selected = s.id
    return s.id
  }

  /** Build ▾ → One-variable data: the lists, a dot plot or histogram, and the box plot. */
  dataPlot(
    sets: DataPlotSet[],
    o: { dist?: DataDist; box?: boolean; binWidth?: number; dropOutliers?: boolean } = {},
  ): string {
    if (sets.length === 0 || sets.some((x) => x.values.length === 0)) throw new Error('example: a data plot needs its lists')
    const p = newDataPlot(this.id())
    p.sets = sets.map((x) => ({ name: x.name, values: x.values.slice(), ...(x.off ? { off: x.off.slice() } : {}) }))
    if (o.dist) p.dist = o.dist
    if (o.box !== undefined) p.box = o.box
    if (o.binWidth !== undefined) p.binWidth = o.binWidth
    if (o.dropOutliers) p.dropOutliers = true
    return this.addStat(p)
  }

  /**
   * Build ▾ → Probability, showing `view`: the two-way table, the Venn
   * diagram or the tree, each from the lesson's own numbers (the card's
   * examples where none are given). A tree's named event follows its
   * definition, as the card settles it.
   */
  probability(
    view: ProbView,
    o: { table?: Partial<ProbTable>; venn?: Partial<ProbVenn>; tree?: Partial<ProbTree> } = {},
  ): string {
    const base = newProb(this.id())
    const tree: ProbTree = { ...base.tree, ...o.tree }
    // the card's ready-made event belongs to the card's ready-made bag
    if (o.tree && o.tree.event === undefined) delete tree.event
    const p = settleProb({
      ...base,
      view,
      table: { ...base.table, ...o.table },
      venn: { ...base.venn, ...o.venn },
      tree,
    })
    const card = probCard(p)
    if (view === 'venn' && card.venn.error) throw new Error(`example: the Venn diagram cannot be read: ${card.venn.error}`)
    if (view === 'tree' && card.tree.problems.length > 0) throw new Error(`example: the tree cannot be read: ${card.tree.problems.join('; ')}`)
    return this.addStat(p)
  }

  // ------------------------------------------------------------ the number line

  /** An inequality solved on the number line, with the working the lesson shows. */
  solve(src: string, show: NLSolveShow = {}): string {
    if (this.kind !== 'number-line') throw new Error(`example: “${src}” is solved on a number line`)
    const solved = solveInequality(src)
    if (!solved.ok) throw new Error(`example: “${src}” could not be solved: ${solved.error}`)
    const id = this.id()
    this.items.push({
      kind: 'solve',
      id,
      src,
      color: this.nextColor(),
      show: { ...NL_SOLVE_DEFAULTS, stacked: /\b(and|or)\b/i.test(src), ...show },
    })
    this.selected = id
    return id
  }

  // ------------------------------------------------------------ out

  /** The window the board opens on, as declared (a default when none was). */
  window(): ExampleWindow {
    if (this.win) return this.win
    return this.kind === 'number-line' ? { x: [-10, 10] } : { x: [-10, 10], y: [-7, 7] }
  }

  /** Centre and scale for the declared window on a screen (the nominal example screen unless told). */
  private viewport(screen: { widthPx: number; heightPx: number } = EXAMPLE_SCREEN): BoardInput['viewport'] {
    const w = this.window()
    const cx = (w.x[0] + w.x[1]) / 2
    const ppuX = screen.widthPx / Math.max(1e-6, w.x[1] - w.x[0])
    if (this.kind === 'number-line' || !w.y) return { center: { x: cx, y: 0 }, pxPerUnit: ppuX }
    const cy = (w.y[0] + w.y[1]) / 2
    const ppuY = screen.heightPx / Math.max(1e-6, w.y[1] - w.y[0])
    if (w.independent) return { center: { x: cx, y: cy }, pxPerUnit: ppuX, pxPerUnitY: ppuY }
    return { center: { x: cx, y: cy }, pxPerUnit: Math.min(ppuX, ppuY) }
  }

  /** The board as the serializer takes it — what the App's currentBoardInput would hand over. */
  toInput(note?: string, screen?: { widthPx: number; heightPx: number }): BoardInput {
    const curveViews: Record<string, CurveView> = {}
    for (const c of this.curves) if (this.views[c.id]) curveViews[c.id] = this.views[c.id]
    return {
      curves: this.curves.map((c) => ({ ...c, params: c.params.slice() })),
      kind: this.kind,
      items: this.items.slice(),
      styles: { ...this.styles },
      candidates: new Map(),
      exprSources: { ...this.exprSources },
      ...(this.axisX !== 'auto' ? { axisUnits: { x: this.axisX, y: 'auto' as const } } : {}),
      calc: this.calc.slice(),
      names: { ...this.names },
      inverses: this.inverses.slice(),
      fields: this.fields.slice(),
      shapes: this.shapes.slice(),
      data: this.data.slice(),
      sequences: this.sequences.slice(),
      unitCircles: this.unitCircles.slice(),
      relatedRates: this.relatedRates.slice(),
      stats: this.stats.slice(),
      system: this.systemSettings,
      grid: this.ruling,
      figure: this.figureStyle,
      curveViews,
      viewport: this.viewport(screen),
      selectedId: this.selected,
      mode: 'draw',
      ...(note ? { note } : {}),
    }
  }

  /** The stored document (fixed id and stamps: the gallery copies it under a fresh id). */
  toDoc(id: string, name: string, note?: string): StoredDoc {
    return docFromBoard({ id, name, createdAt: 0, modifiedAt: 0 }, this.toInput(note), 0)
  }
}

/** The Measurements toggles as the document keeps them (canonical order), or nothing. */
function measureOf(flags: readonly MeasureFlag[] | undefined): ShapeMeasureSettings | undefined {
  if (!flags || flags.length === 0) return undefined
  return { show: MEASURE_FLAGS.filter((f) => flags.includes(f)) }
}

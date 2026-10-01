// ============================================================================
// src/ui/docScene.ts — the export scene of a document that is NOT open.
//
// The App builds its export scene from live state: dozens of memos and refs
// derived from the board the teacher is editing. A worksheet needs the same
// figure for documents that are only JSON in localStorage. This module is the
// pure path from a stored document to a BoardScene — no React, no DOM — built
// from the very helpers the App's memos call, so a figure on a sheet is the
// figure the document's own Download would make.
//
//   1. deserializeDoc — the loader the App uses. It rebuilds every typed
//      line's model (expr_N), every derivative and accumulation model, and
//      validates every link.
//   2. the models the App registers AFTER a load: one inverse spec per
//      inverse link, one Taylor polynomial per Taylor link.
//   3. what the App derives from the links for the export: calculus overlays
//      (tangent marks, shaded areas, Riemann sums, secants, limits, volumes),
//      slope fields with their solution curves and Euler paths, shapes, data
//      tables' scatter plots, unit circles, sign-chart strips, curve names,
//      the auto caption and the axis units.
//   4. the export framing: the document's own export settings (fit, aspect,
//      margin), laid out at the PHYSICAL width it will have on paper.
//
// SCOPE. Some objects only the App can build, because they depend on state
// the document does not hold or on long per-card pipelines: sequences and
// series, related-rates diagrams, the inequality system's solution region and
// corners, conic constructions, particle motion, transformation ghosts and
// the domain/range shading views. A figure leaves those out and says so in
// `omitted`, which the sheet editor prints under the figure's row — never a
// silent difference between the sheet and the document.
//
// THE BOARD SIZE. A document stores its centre and zoom, not the size of the
// window it was framed in. The caller passes the size of the live board (the
// same screen the teacher framed every document on); tests pass a fixed one.
// ============================================================================

import type { BoardKind, FigureStyleId, FittedCurve, ModelSpec, SpecialPoint, Viewport } from '../core/types'
import { DARK_THEME, ppuX } from '../core/types'
import { MODELS } from '../core/fit/models'
import type { CalcLink, HydratedBoard, SignChartLink } from '../core/persist'
import { TAYLOR_MODEL_PREFIX, deserializeDoc, resolveAxisUnits } from '../core/persist'
import { analyzeCurve } from '../core/analyze'
import type { BoardScene } from './renderBoard'
import { answerLabel, captionHeight, exportTheme, sceneInk, suggestAxisUnits } from './renderBoard'
import type { FitExportSettings } from './exportFit'
import { clampFitSettings, contentBounds, defaultFit, exportViewport } from './exportFit'
import { DEFAULT_EXPORT } from './renderBoard'
import { defaultCaption, exportLook } from './figureStyle'
import { boardIntersections, crossingsClearOf, intersectionSpan, taylorApart } from './intersections'
import { inverseSpec } from './nameLinks'
import { ensureNames, legacyNames } from './nameLinks'
import { curveNames, namesInOrder } from '../render/curveNames'
import { safePoly, taylorChildModel, taylorSourceFor, withTaylorNames } from './taylorLinks'
import { overlaysFor } from './calcLinks'
import { compileFields, sceneFields, solutionPolylines, solveSpan } from './fieldLinks'
import { eulerScene } from './eulerLinks'
import { compileShapes, sceneShapes } from './shapeLinks'
import { dataBox, scatterSets } from './dataLinks'
import { unitCircleBox, unitCircleFigure } from './unitCircleLinks'
import { signChartFigures, signRange } from './signChartLinks'
import { signBandHeight } from '../render/signChart'
import { unionBoxes } from './curveState'
import { physicalViewport, recordScene } from './vectorExport'
import { drawContextMarkers } from './AnalysisOverlay'
import { asymptoteText } from './CurveCard'
import { findAsymptotes } from '../core/holes'
import type { DisplayList } from '../render/vectorCtx'
import { measure } from '../render/vectorPage'
import type { TextOpts } from '../render/vectorPage'

/** The board size assumed when the caller does not know the live one. */
export const DEFAULT_SCREEN = { widthPx: 900, heightPx: 600 } as const

/** Everything about a stored document that does not depend on how it is drawn. */
export interface DocModel {
  id: string
  name: string
  kind: BoardKind
  board: HydratedBoard
  models: Record<string, ModelSpec>
  /** The window the teacher framed, at the assumed board size. */
  vp: Viewport
  /** Export framing the document remembers (fit, aspect, margin). */
  settings: FitExportSettings
  /** curveId → its letter on the figure (f, g, P₃ …). */
  curveNames: Record<string, string>
  /** exprSources over displaySources: what pgfplots writes for each curve. */
  sources: Record<string, string>
  /** Objects on the document a sheet cannot draw yet, as short phrases. */
  omitted: string[]
  /** What the loader had to repair or drop. */
  problems: string[]
}

export interface DocModelOptions {
  /** The live board's size; DEFAULT_SCREEN when absent. */
  screen?: { widthPx: number; heightPx: number }
  /** The document's own export settings; the app defaults when absent. */
  settings?: FitExportSettings
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/** Hydrate a stored document into a DocModel. Null when nothing could be read. */
export function docModelFromJSON(json: string, opts: DocModelOptions = {}): DocModel | null {
  const res = deserializeDoc(json)
  if (!res.meta || !res.board) return null
  const board = res.board
  const kind = board.kind

  // ---- models: the library, the loader's rebuilt closures, then the ones the
  // App registers after a load (inverse relations, Taylor polynomials).
  let curves = board.curves
  const models: Record<string, ModelSpec> = { ...MODELS, ...board.extraModels }
  for (const l of board.inverses) {
    const child = curves.find((c) => c.id === l.curveId)
    if (!child) continue
    models[child.modelId] = inverseSpec(
      child.modelId,
      l.parentId,
      () => ({ curves, models }),
      () => 'x = f\\left(y\\right)',
    )
  }
  for (const l of board.calc) {
    if (l.kind !== 'taylor') continue
    const parent = curves.find((c) => c.id === l.parentId)
    const wantId = `${TAYLOR_MODEL_PREFIX}${l.id}`
    const src = taylorSourceFor(parent, models, (board.calls[l.parentId]?.length ?? 0) > 0)
    models[wantId] = taylorChildModel(safePoly(src, l.a, l.n), wantId, l.n)
    curves = curves.map((c) =>
      c.id === l.curveId ? { ...c, modelId: wantId, params: [], kind: 'explicit', domain: null } : c,
    )
  }
  const hydrated: HydratedBoard = { ...board, curves }

  // ---- names, as applyHydrated seeds them, then as the board shows them.
  const sources = { ...board.displaySources, ...board.exprSources }
  const nameBoard = { curves, sources, calc: board.calc, inverses: board.inverses, calls: board.calls }
  const seed =
    Object.keys(board.names).length > 0
      ? board.names
      : legacyNames(curveNames(curves, sources, board.calc), nameBoard)
  const names = ensureNames(seed, nameBoard)
  const shown =
    kind === 'cartesian'
      ? withTaylorNames(
          curveNames(curves, sources, board.calc, names, board.inverses),
          board.calc,
          new Set(curves.filter((c) => c.visible).map((c) => c.id)),
        )
      : {}

  const screen = opts.screen ?? DEFAULT_SCREEN
  const vp: Viewport = {
    center: { x: board.viewport.center.x, y: kind === 'number-line' ? 0 : board.viewport.center.y },
    pxPerUnit: board.viewport.pxPerUnit,
    widthPx: Math.max(100, Math.round(screen.widthPx)),
    heightPx: Math.max(80, Math.round(screen.heightPx)),
  }
  if (board.viewport.pxPerUnitY !== undefined && board.grid !== 'polar') vp.pxPerUnitY = board.viewport.pxPerUnitY

  const omitted: string[] = []
  if (board.sequences.length > 0) omitted.push(plural(board.sequences.length, 'sequence'))
  if (board.relatedRates.length > 0) omitted.push('the related-rates diagram')
  if (board.system) omitted.push('the inequality system’s solution region')
  if (Object.keys(board.curveViews).length > 0) omitted.push('per-curve views (constructions, particles, shading)')

  return {
    id: res.meta.id,
    name: res.meta.name,
    kind,
    board: hydrated,
    models,
    vp,
    settings: clampFitSettings(opts.settings ?? { ...DEFAULT_EXPORT, ...defaultFit(kind) }),
    curveNames: shown,
    sources,
    omitted,
    problems: res.problems,
  }
}

export interface FigureOptions {
  /** The look to draw in. */
  style: FigureStyleId
  /** The answer key: analysis markers, labels and intersection chips. */
  answers: boolean
  /** Physical width of the whole figure (margins included), in cm. Absent: the board's own size. */
  widthCm?: number
  /**
   * The line printed under the figure. undefined = the document's own (the
   * teacher's, or the AP auto caption); '' = none.
   */
  caption?: string
}

export interface DocFigure {
  scene: BoardScene
  /** The unselected curves' markers (answer key only), drawn over the plot. */
  context: { curve: FittedCurve; points: SpecialPoint[] }[]
  /** Export margin in CSS px around the plot. */
  margin: number
  /** curveId → the equation as typed: what pgfplots writes each curve from. */
  sources: Record<string, string>
  /**
   * The key's asymptotes in words ("x = 2", "y = 0"), every visible curve's,
   * once each — stated under the figure. Empty on a student figure.
   */
  asymptotes: string[]
}

const analyze = (c: FittedCurve, models: Record<string, ModelSpec>): SpecialPoint[] => {
  try {
    const pts = analyzeCurve(c, models)
    return Array.isArray(pts) ? pts : []
  } catch {
    return []
  }
}

/** The export scene of a document, as its own Download would build it. */
export function docFigure(m: DocModel, o: FigureOptions): DocFigure {
  const board = m.board
  const cartesian = m.kind === 'cartesian'
  // Paper: whatever the document's export ground was, a sheet is printed.
  const settings: FitExportSettings = { ...m.settings, theme: 'light' }
  const curves = board.curves
  const models = m.models

  const ownCaption = board.captionAuto
    ? defaultCaption(o.style, namesInOrder(curves, m.curveNames))
    : board.caption
  const { figure, caption } = exportLook({
    style: o.style,
    caption: o.caption !== undefined ? o.caption : ownCaption,
    cartesian,
  })

  const vp = o.widthCm !== undefined ? physicalViewport(m.vp, o.widthCm, settings.margin) : m.vp
  const half = vp.widthPx / 2 / ppuX(vp)
  const window: [number, number] = [vp.center.x - half, vp.center.x + half]
  const span = intersectionSpan(window)

  // ---- what the links draw
  const signLinks = board.calc.filter((l): l is SignChartLink => l.kind === 'signchart')
  const signs = cartesian && signLinks.length > 0
    ? safe(() => signChartFigures(signLinks, curves, models, m.curveNames, {}, signRange(span)), [])
    : []
  const unitCircles = cartesian ? board.unitCircles.map((u) => unitCircleFigure(u)) : []
  const curveIds = new Set(curves.map((c) => c.id))
  const scatter = cartesian ? safe(() => scatterSets(board.data, curveIds), []) : []

  // ---- framing (exportContent + buildExportScene in the App)
  let content = null
  if (settings.fit) {
    const box = contentBounds({ kind: m.kind, curves, items: board.items, models, window })
    content = cartesian
      ? unionBoxes([
          box,
          ...board.data.filter((d) => d.visible).map((d) => safe(() => dataBox(d), null)),
          ...board.unitCircles.filter((u) => u.hidden !== true).map((u) => unitCircleBox(u)),
        ])
      : box
  }
  let capPx = 0
  if (caption !== '') {
    const plain = exportViewport(vp, settings, content, m.kind, board.items, 0)
    capPx = captionHeight(null, caption, plain.widthPx)
  }
  if (signs.length > 0) capPx += signBandHeight(signs, null)
  const evp = exportViewport(vp, settings, content, m.kind, board.items, capPx)
  const ehalf = evp.widthPx / 2 / ppuX(evp)
  const solve = solveSpan([evp.center.x - ehalf, evp.center.x + ehalf])

  const fieldsCompiled = cartesian ? compileFields(board.fields) : new Map()
  const euler = cartesian ? safe(() => eulerScene(board.fields, fieldsCompiled, solve), null) : null
  const polylines = cartesian
    ? [...safe(() => solutionPolylines(board.fields, fieldsCompiled, solve), []), ...(euler?.polylines ?? [])]
    : []
  const overlays = cartesian
    ? safe(() => overlaysFor(board.calc, curves, models, board.calc.some(isBand) ? span : null), [])
    : []
  const shapes = cartesian ? safe(() => sceneShapes(board.shapes, compileShapes(board.shapes)), []) : []

  // ---- the answers: the selected curve's markers with their labels, every
  // other visible curve's markers, and where the curves cross.
  let analysis: BoardScene['analysis'] = null
  let intersections: BoardScene['intersections'] = undefined
  const context: DocFigure['context'] = []
  if (o.answers && cartesian) {
    const shown = curves.filter((c) => c.visible)
    const sel = shown.find((c) => c.id === board.selectedId) ?? shown.find((c) => c.kind === 'explicit') ?? null
    if (sel) {
      const pts = analyze(sel, models)
      if (pts.length > 0) analysis = { curve: sel, points: pts }
    }
    for (const c of shown) {
      if (c === sel) continue
      const pts = analyze(c, models)
      if (pts.length > 0) context.push({ curve: c, points: pts })
    }
    const crossings = safe(() => boardIntersections(curves, models, span, taylorApart(board.calc)), [])
    intersections = crossingsClearOf(crossings, analysis ? analysis.points : [], span)
  }

  const axisSuggestion = !cartesian
    ? {}
    : board.unitCircles.some((u) => u.hidden !== true)
      ? { x: 'pi' as const }
      : suggestAxisUnits(curves, board.exprSources)

  const scene: BoardScene = {
    vp: evp,
    theme: figure ? figure.theme : exportTheme(settings, DARK_THEME),
    kind: m.kind,
    items: board.items,
    curves,
    styles: board.styles,
    models,
    analysis,
    intersections,
    printColors: true,
    axisUnits: resolveAxisUnits(board.axisUnits, axisSuggestion),
    overlays,
    fields: cartesian ? sceneFields(board.fields, fieldsCompiled) : [],
    polylines,
    ...(euler && euler.paths.length > 0 ? { eulers: euler.paths } : {}),
    shapes,
    ...(scatter.length > 0 ? { scatter } : {}),
    ...(unitCircles.length > 0 ? { unitCircles } : {}),
    ...(signs.length > 0 ? { signCharts: signs } : {}),
    grid: board.grid,
    ...(figure ? { figure } : {}),
    ...(caption !== '' ? { caption } : {}),
    ...(figure ? { curveNames: m.curveNames } : {}),
    // The key labels EVERY visible curve's points, near their markers, and
    // reports what it could not place (see BoardScene.answerKey).
    ...(o.answers && cartesian ? { answerKey: { more: context, unlabelled: [] } } : {}),
    chrome: null,
  }
    // The key states the asymptotes the figure dashes in: the vertical ones
  // inside the frame and whatever the ends lean on.
  const asymptotes: string[] = []
  if (o.answers && cartesian) {
    const lo = evp.center.x - ehalf
    const hi = evp.center.x + ehalf
    const pad = (hi - lo) * 0.05
    for (const c of curves) {
      if (!c.visible) continue
      const found = safe(() => findAsymptotes(c, models, [lo - pad, hi + pad]), [])
      for (const a of found) {
        if (a.kind === 'vertical' && !(a.x >= lo && a.x <= hi)) continue
        const t = asymptoteText(a)
        if (t !== '' && !asymptotes.includes(t)) asymptotes.push(t)
      }
    }
  }
  return { scene, context, margin: settings.margin, sources: board.exprSources, asymptotes }
}

const isBand = (l: CalcLink): boolean => l.kind === 'taylor' && l.band === true

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

/** Draw the context markers of a figure (the App's paintExportExtras). A key draws its own. */
export function paintContext(ctx: CanvasRenderingContext2D, f: DocFigure): void {
  if (f.context.length === 0 || f.scene.answerKey) return
  const ink = sceneInk(f.scene)
  for (const m of f.context) drawContextMarkers(ctx, f.scene.vp, m.points, ink(m.curve.color), f.scene.theme.bg)
}

/** How a key's text line names each kind of point. */
const KIND_WORDS: Partial<Record<SpecialPoint['kind'], string>> = {
  zero: 'zeros',
  maximum: 'max',
  minimum: 'min',
  inflection: 'inflection',
  'y-intercept': 'y-int',
  intersection: 'meets',
  hole: 'hole',
}

/**
 * The answers a key could not put in a chip, as one sentence:
 * "zeros: −√3, √3 · max: (π/2, 1)". Points are grouped by kind, in the order
 * the kinds first appear, each value exactly as its chip would have said it.
 */
export function unplacedAnswers(points: readonly SpecialPoint[]): string {
  return answerTokens(points).join(' ')
}

/**
 * The same sentence as unbreakable pieces: "zeros: −√3," "√3 ·" "max:" … A
 * line may break between pieces, never inside a coordinate pair.
 */
function answerTokens(points: readonly SpecialPoint[]): string[] {
  const groups = new Map<string, string[]>()
  for (const p of points) {
    const word = KIND_WORDS[p.kind] ?? p.label ?? p.kind
    const list = groups.get(word) ?? []
    const text = answerLabel(p)
    if (!list.includes(text)) list.push(text)
    groups.set(word, list)
  }
  const out: string[] = []
  const entries = [...groups.entries()]
  entries.forEach(([word, values], g) => {
    values.forEach((v, i) => {
      const head = i === 0 ? `${word}: ` : ''
      const tail = i < values.length - 1 ? ',' : g < entries.length - 1 ? ' ·' : ''
      out.push(`${head}${v}${tail}`)
    })
  })
  return out
}

/** Lines of the key's answer text under a figure, at most this many. */
const ANSWER_LINES_MAX = 6
const ANSWER_PX = 10

/** The figure as a display list in CSS px — what SVG, PDF and TikZ are written from. */
export function recordFigure(f: DocFigure): DisplayList {
  const key = f.scene.answerKey
  if (key) key.unlabelled.length = 0
  const list: DisplayList = recordScene(f.scene, f.margin, (ctx) => paintContext(ctx, f))
  const tokens = [
    ...f.asymptotes.map((a, i) => `${i === 0 ? 'asymptotes: ' : ''}${a}${i < f.asymptotes.length - 1 ? ',' : ''}`),
    ...(key ? answerTokens(key.unlabelled) : []),
  ]
  if (!key || tokens.length === 0) return list
  if (f.asymptotes.length > 0 && tokens.length > f.asymptotes.length) {
    tokens[f.asymptotes.length - 1] += ' ·'
  }
  // A key never leaves an answer unstated: what found no room for a chip is
  // written under the figure, in a band added to its bottom.
  const generic = f.scene.figure?.font === 'serif' ? 'serif' : 'sans-serif'
  const o: TextOpts = { size: ANSWER_PX, generic }
  const lines = wrapAll(tokens, list.width - 2 * Math.max(4, f.margin), o)
  const lead = ANSWER_PX * 1.25
  const band = lines.length * lead + 6
  const top = list.height
  list.height += band
  list.items.push({
    t: 'path',
    segs: [
      { k: 'M', x: 0, y: top },
      { k: 'L', x: list.width, y: top },
      { k: 'L', x: list.width, y: top + band },
      { k: 'L', x: 0, y: top + band },
      { k: 'Z' },
    ],
    fill: { r: 255, g: 255, b: 255, a: 1 },
    stroke: null,
    clip: 0,
  })
  const family = generic === 'serif' ? 'Times New Roman, Times, serif' : 'Helvetica, Arial, sans-serif'
  lines.forEach((line, i) => {
    list.items.push({
      t: 'text',
      text: line,
      x: list.width / 2,
      y: top + lead * (i + 1) - 2,
      anchor: 'middle',
      font: { family, generic, size: ANSWER_PX, italic: false, bold: false },
      color: { r: 0, g: 0, b: 0, a: 1 },
      width: measure(line, o),
      clip: 0,
    })
  })
  return list
}

/** Greedy wrap between pieces, never dropping one (a key states every answer). */
function wrapAll(tokens: readonly string[], width: number, o: TextOpts): string[] {
  const fill = (w: number): string[] => {
    const lines: string[] = []
    let cur = ''
    for (const t of tokens) {
      const next = cur ? `${cur} ${t}` : t
      if (cur && measure(next, o) > w) {
        lines.push(cur)
        cur = t
      } else cur = next
    }
    if (cur) lines.push(cur)
    return lines
  }
  let lines = fill(width)
  // Too long for the band at this width: longer lines rather than lost answers.
  for (let w = width * 1.5; lines.length > ANSWER_LINES_MAX; w *= 1.5) lines = fill(w)
  return lines
}

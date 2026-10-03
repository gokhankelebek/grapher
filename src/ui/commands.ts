// ============================================================================
// src/ui/commands.ts — every tool Grapher has, in one list.
//
// The single source of truth for the command palette (⌘K, src/ui/
// CommandPalette.tsx) and the help sheet (?, src/ui/HelpSheet.tsx). Each
// command is an id, a title, the words a teacher would type to find it, a
// group, `when` (is it on offer here at all?) and `run` — and `run` only ever
// calls an App callback, the SAME one the menu or button calls. Nothing here
// adds, computes or decides anything the menus do not.
//
// CONTEXT. Commands are pure functions of a CommandContext: a snapshot of the
// board (graph or number line, what is selected, the facts each curve's ⋯
// menu decides by) plus the App's callbacks. A command that acts ON something
// (a curve, a slope field, a sequence, a solved inequality) names its target
// kind; `availability` then says whether it runs on the selection, needs a
// "which curve?" pick, is greyed out with a reason, or is hidden — hidden
// exactly when the selected object's ⋯ menu would not offer it (calcMenu.ts).
//
// KEYS. Shortcuts are stated here, once, and the help sheet's Keyboard
// section is generated from them. The App's keydown handler still owns the
// keys; tests/commands.test.ts checks the two agree and that nothing clashes.
// ============================================================================

import type { BoardKind, CurveKind, FigureStyleId } from '../core/types'
import type { AxisUnitChoice, BoardGrid } from '../core/persist'
import type { CalcKind } from './calcLinks'
import type { ExportFormat } from './vectorExport'
import { calcMenuBlocked, calcMenuOffers } from './calcMenu'
import type { CalcMenuFacts, CalcMenuKind } from './calcMenu'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommandGroup = 'Actions' | 'Calculus' | 'Build' | 'Document' | 'Export' | 'View'

/** The order groups are listed in (palette and help sheet). */
export const GROUP_ORDER: readonly CommandGroup[] = ['Actions', 'Calculus', 'Build', 'Document', 'Export', 'View']

/** What a command acts on, when it acts on one object. */
export type TargetKind = 'curve' | 'field' | 'sequence' | 'solve' | 'shape'

/** Where the Table section's commands land: the table, Evaluate, Compare, Divide. */
export type TableTool = 'table' | 'evaluate' | 'compare' | 'divide'

/** The builders under Build ▾ (plus the + box itself, 'expr'). */
export type BuilderKey =
  | 'expr'
  | 'factor'
  | 'exp'
  | 'logistic'
  | 'log'
  | 'sin'
  | 'transform'
  | 'piecewise'
  | 'conic'
  | 'motion'
  | 'seq'

/** One object a command can act on, as the "which curve?" picker lists it. */
export interface TargetFacts {
  id: string
  /** "f", "g", "Parabola", "Slope field 1". */
  name: string
  /** The equation in LaTeX, when there is one. */
  tex?: string
  /** A plain-text equation (search, screen readers). */
  text: string
  /** Its colour on the board, for the picker's name chip. */
  color?: string
}

/** A curve, with the facts its ⋯ menu decides by. */
export interface CurveFacts extends TargetFacts {
  kind: CurveKind
  /** The card's calculus facts; null when the menu has no Calculus group. */
  calc: CalcMenuFacts | null
  /** "Area between curves…" has a second curve to point at. */
  between: boolean
  /** "Show inverse" is on the menu (an explicit curve that is not broken). */
  inverse: boolean
  /** A function with Domain / range rows (and the horizontal line test). */
  domain: boolean
  /** The horizontal line test is currently drawn on it. */
  hlt: boolean
  /** A function of x with a Table section (absent: not known, read as no). */
  table?: boolean
  /** A polynomial: its Table section can divide by (x − a). */
  poly?: boolean
  /** A circle (typed or sketched): its card has the Circle theorems section. */
  circle?: boolean
}

export interface SequenceFacts extends TargetFacts {
  series: boolean
  sums: boolean
}

/** A point, segment, polygon (or vector, line) on the board. */
export interface ShapeFacts extends TargetFacts {
  kind: 'point' | 'segment' | 'vector' | 'polygon' | 'line' | null
  /** It is a transformation's image. */
  image: boolean
  /** A triangle (three non-collinear vertices): its card has the Centres section. */
  triangle?: boolean
}

export interface SolveFacts extends TargetFacts {
  signs: boolean
  tests: boolean
}

/** The App's callbacks — the same functions the menus and buttons call. */
export interface CommandActions {
  select(id: string): void
  // ---- the + box and the builders
  typeLine(seed?: string): void
  openBuilder(which: BuilderKey): void
  addDataTable(): void
  addUnitCircle(): void
  addRelatedRates(): void
  addNormal(): void
  addSimulation(): void
  addDataPlot(): void
  addProbability(): void
  // ---- a curve's ⋯ menu
  addCalc(curveId: string, kind: CalcKind): void
  addAreaBetween(curveId: string): void
  showInverse(curveId: string): void
  setHlt(curveId: string, on: boolean): void
  /** Bring a function's Domain & range rows into view; `restrict` opens the restrict editor. */
  showDomain(curveId: string, restrict: boolean): void
  duplicateCurve(curveId: string): void
  toggleVisible(curveId: string): void
  deleteSelected(): void
  // ---- other cards
  addEuler(fieldId: string): void
  toggleSeqSeries(seqId: string): void
  toggleSeqSums(seqId: string): void
  solveShow(itemId: string, patch: { signs?: boolean; tests?: boolean }): void
  /** A shape's card, with one of its sections opened (Transform, Compare, Symmetry). */
  openShapeTool?(shapeId: string, tool: 'transform' | 'compare' | 'symmetry' | 'centres'): void
  /** A circle's card with its Circle theorems section open and one figure drawn. */
  openCircleTool?(curveId: string, flag: 'angles' | 'tangent' | 'sector' | 'chords' | 'external'): void
  /** A function's card with its Table section open, at one of its tools. */
  openTableTool?(curveId: string, tool: TableTool): void
  solveGraph(itemId: string): void
  // ---- history
  undo(): void
  redo(): void
  // ---- document
  newDocument(kind: BoardKind): void
  setBoardKind(kind: BoardKind): void
  duplicateDocument(): void
  openWorksheet(): void
  /** The examples gallery (Document menu → Examples…). */
  openExamples(): void
  /** Document menu → Graph from item…: paste an item bank record, graph what it defines. */
  graphFromItem(): void
  share(): void
  backup(): void
  importFile(): void
  makeCopy(): void
  // ---- export
  download(): void
  downloadAs(format: ExportFormat): void
  copyPng(): void
  copyLatex(): void
  /** Download ▾ → Copy for item bank…: the figure as a block for an item bank record. */
  copyForBank(): void
  setFigure(style: FigureStyleId): void
  setPreview(on: boolean): void
  // ---- view
  setAxisUnitX(choice: AxisUnitChoice): void
  cycleAxisX(): void
  setRuling(grid: BoardGrid): void
  toggleAnalysis(): void
  toggleTheme(): void
  setPresent(on: boolean): void
  toggleReveal(): void
  revealStep(dir: 'next' | 'back'): void
  toggleSidebar(): void
  zoomFit(): void
  zoomIn(): void
  zoomOut(): void
  resetView(): void
  help(): void
  // ---- accessibility
  /** "Describe this graph": the board in words, with Copy. */
  describe(): void
  /** Curve colours: standard, or colour-blind safe (a preference). */
  setCurvePalette(palette: 'standard' | 'safe'): void
}

/** A snapshot of the board, for deciding what is on offer. */
export interface CommandContext {
  board: BoardKind
  /** A shared graph opened view-only: nothing that changes the board. */
  readOnly: boolean
  /** A shared graph (view or edit) that is not in the documents yet. */
  shared: boolean
  selectedId: string | null
  curves: readonly CurveFacts[]
  fields: readonly TargetFacts[]
  sequences: readonly SequenceFacts[]
  solves: readonly SolveFacts[]
  /** The shapes on the board (absent: none). */
  shapes?: readonly ShapeFacts[]
  canUndo: boolean
  canRedo: boolean
  hasContent: boolean
  showAnalysis: boolean
  canvasTheme: 'dark' | 'light'
  presentMode: boolean
  revealOn: boolean
  sidebarOpen: boolean
  /** The figure style, or null on a board that has none (a number line). */
  figure: FigureStyleId | null
  previewFigure: boolean
  exportFormat: ExportFormat
  /** The x axis' unit choice, or null on a board with no axes (a number line). */
  axisX: AxisUnitChoice | null
  grid: BoardGrid | null
  /** Curve colours (Board & export settings → Curve colours). Absent: standard. */
  curvePalette?: 'standard' | 'safe'
  actions: CommandActions
}

export interface Command {
  /** Stable: stored in Prefs.recentCommands. Never rename one. */
  id: string
  title: string
  /** The title as the current board would say it ("Hide analysis markers"). */
  label?(ctx: CommandContext): string
  /** One short line: what it does. */
  description: string
  /** Every word a teacher might type for it, synonyms included. */
  keywords: readonly string[]
  group: CommandGroup
  /** Where it lives in the menus ("Curve ⋯ → Calculus → Taylor polynomial"). */
  path: string
  /** Key specs ('Mod+K', 'Shift+P', 'A', '?', 'Delete'); the first is shown. */
  shortcuts?: readonly string[]
  /** Acts on one object of this kind (the selection, or a picked one). */
  target?: TargetKind
  /** On offer on this board at all. */
  when(ctx: CommandContext): boolean
  /** For a targeted command: whether it applies to THIS object (its ⋯ menu would offer it). */
  accepts?(ctx: CommandContext, id: string): boolean
  /** Shown, but greyed out with this reason (null: can run). */
  blocked?(ctx: CommandContext, targetId?: string): string | null
  run(ctx: CommandContext, targetId?: string): void
  /** Listed in the help sheet only (the palette's own key, say). */
  hideInPalette?: boolean
}

// ---------------------------------------------------------------------------
// Small predicates
// ---------------------------------------------------------------------------

const graph = (ctx: CommandContext): boolean => ctx.board === 'cartesian'
const numberLine = (ctx: CommandContext): boolean => ctx.board === 'number-line'
const editable = (ctx: CommandContext): boolean => !ctx.readOnly
const graphEdit = (ctx: CommandContext): boolean => graph(ctx) && editable(ctx)
const always = (): boolean => true

function curveOf(ctx: CommandContext, id: string | undefined): CurveFacts | undefined {
  return id ? ctx.curves.find((c) => c.id === id) : undefined
}

/** A calculus item of the ⋯ menu, as a command. */
function calcCommand(
  id: string,
  kind: CalcMenuKind,
  title: string,
  description: string,
  path: string,
  keywords: readonly string[],
): Command {
  return {
    id,
    title,
    description,
    keywords,
    group: 'Calculus',
    path: `Curve ⋯ → ${path}`,
    target: 'curve',
    when: graphEdit,
    accepts: (ctx, cid) => {
      const c = curveOf(ctx, cid)
      return !!c && calcMenuOffers(kind, c.calc, c.between)
    },
    blocked: (ctx, cid) => calcMenuBlocked(kind, curveOf(ctx, cid)?.calc),
    run: (ctx, cid) => {
      if (!cid) return
      if (kind === 'between') ctx.actions.addAreaBetween(cid)
      else ctx.actions.addCalc(cid, kind)
    },
  }
}

function builder(
  id: string,
  which: BuilderKey,
  title: string,
  description: string,
  keywords: readonly string[],
  menuLabel: string = title,
): Command {
  return {
    id,
    title,
    description,
    keywords,
    group: 'Build',
    path: `Build ▾ → ${menuLabel}`,
    when: graphEdit,
    run: (ctx) => ctx.actions.openBuilder(which),
  }
}

function seeded(
  id: string,
  seed: string,
  title: string,
  description: string,
  keywords: readonly string[],
): Command {
  return {
    id,
    title,
    description,
    keywords,
    group: 'Build',
    path: `Sidebar + → type “${seed.trim()} …”`,
    when: graphEdit,
    run: (ctx) => ctx.actions.typeLine(seed),
  }
}

const FORMAT_NAMES: Record<ExportFormat, string> = {
  png: 'PNG',
  svg: 'SVG',
  pdf: 'PDF',
  tikz: 'TikZ',
  pgfplots: 'pgfplots',
}

function downloadAs(format: ExportFormat, description: string, keywords: readonly string[]): Command {
  return {
    id: `export-${format}`,
    title: `Download as ${FORMAT_NAMES[format]}`,
    description,
    keywords,
    group: 'Export',
    path: `Download ▾ (caret) → Format: ${FORMAT_NAMES[format]}`,
    when: (ctx) => format !== 'pgfplots' || graph(ctx),
    blocked: (ctx) => (ctx.hasContent ? null : 'The board is empty'),
    run: (ctx) => ctx.actions.downloadAs(format),
  }
}

const STYLE_NAMES: Record<FigureStyleId, string> = {
  screen: 'Screen',
  textbook: 'Textbook',
  sat: 'SAT',
  ap: 'AP Calculus',
}

function figureStyle(style: FigureStyleId, description: string, keywords: readonly string[]): Command {
  return {
    id: `style-${style}`,
    title: `Figure style: ${STYLE_NAMES[style]}`,
    description,
    keywords,
    group: 'Export',
    path: `Download ▾ (caret) → Figure style → ${STYLE_NAMES[style]}`,
    when: (ctx) => graphEdit(ctx) && ctx.figure !== null,
    blocked: (ctx) => (ctx.figure === style ? 'Already the figure style' : null),
    run: (ctx) => ctx.actions.setFigure(style),
  }
}

function axisUnit(choice: AxisUnitChoice, title: string, description: string, keywords: readonly string[]): Command {
  return {
    id: `axis-${choice}`,
    title,
    description,
    keywords,
    group: 'View',
    path: 'Download ▾ (caret) → Axis units → x',
    when: (ctx) => graph(ctx) && ctx.axisX !== null,
    blocked: (ctx) => (ctx.axisX === choice ? 'Already set' : null),
    run: (ctx) => ctx.actions.setAxisUnitX(choice),
  }
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

export const COMMANDS: readonly Command[] = [
  // ======================================================== Actions
  {
    id: 'type-equation',
    title: 'Type an equation',
    description: 'Open the + box: y = 2sin(3x) + 1, x^2 + y^2 = 25, r = 2cos(3θ), g(x) = f(x − 1)',
    keywords: ['+', 'add', 'new curve', 'equation', 'function', 'type', 'enter', 'plot', 'graph', 'y =', 'expression', 'input'],
    group: 'Actions',
    path: 'Sidebar → +',
    when: graphEdit,
    run: (ctx) => ctx.actions.typeLine(),
  },
  {
    id: 'nl-solve',
    title: 'Solve an inequality',
    description: 'Type an inequality on the number line: critical values, test points, sign chart, the set',
    keywords: [
      'inequality', 'solve', 'number line', 'interval', 'interval notation', 'test point', 'critical values',
      'absolute value', 'rational inequality', 'polynomial inequality', 'solution set', 'compound', 'and', 'or',
    ],
    group: 'Actions',
    path: 'Number line → +',
    when: (ctx) => numberLine(ctx) && editable(ctx),
    run: (ctx) => ctx.actions.typeLine(),
  },
  {
    id: 'undo',
    title: 'Undo',
    description: 'Take back the last change',
    keywords: ['undo', 'back', 'oops', 'take back', 'revert', 'mistake'],
    group: 'Actions',
    path: 'Toolbar → Undo',
    shortcuts: ['Mod+Z'],
    when: editable,
    blocked: (ctx) => (ctx.canUndo ? null : 'Nothing to undo'),
    run: (ctx) => ctx.actions.undo(),
  },
  {
    id: 'redo',
    title: 'Redo',
    description: 'Put back what Undo took',
    keywords: ['redo', 'again', 'forward', 'put back'],
    group: 'Actions',
    path: 'Toolbar → Redo',
    shortcuts: ['Shift+Mod+Z', 'Mod+Y'],
    when: editable,
    blocked: (ctx) => (ctx.canRedo ? null : 'Nothing to redo'),
    run: (ctx) => ctx.actions.redo(),
  },
  {
    id: 'duplicate-curve',
    title: 'Duplicate curve',
    description: 'A copy of the curve, to transform beside the original',
    keywords: ['duplicate', 'copy', 'clone', 'another'],
    group: 'Actions',
    path: 'Curve ⋯ → Duplicate',
    target: 'curve',
    when: graphEdit,
    accepts: (ctx, id) => !!curveOf(ctx, id),
    run: (ctx, id) => id && ctx.actions.duplicateCurve(id),
  },
  {
    id: 'toggle-visible',
    title: 'Hide or show curve',
    description: 'Hide a curve without deleting it (its card stays)',
    keywords: ['hide', 'show', 'visible', 'invisible', 'toggle'],
    group: 'Actions',
    path: 'Curve ⋯ → Hide / Show',
    target: 'curve',
    when: graphEdit,
    accepts: (ctx, id) => !!curveOf(ctx, id),
    run: (ctx, id) => id && ctx.actions.toggleVisible(id),
  },
  {
    id: 'delete-selected',
    title: 'Delete the selection',
    description: 'Remove the selected curve, field, table or item (Undo brings it back)',
    keywords: ['delete', 'remove', 'erase', 'trash', 'get rid of'],
    group: 'Actions',
    path: 'Curve ⋯ → Delete',
    shortcuts: ['Delete', 'Backspace'],
    when: (ctx) => editable(ctx) && ctx.selectedId !== null,
    run: (ctx) => ctx.actions.deleteSelected(),
  },
  {
    id: 'help',
    title: 'Help: what Grapher can do',
    description: 'Every tool by course and unit, how to reach it, and the keyboard shortcuts',
    keywords: [
      'help', 'what can', 'how do i', 'how to', 'guide', 'cheat sheet', 'keyboard shortcuts', 'shortcuts', 'keys',
      'manual', 'docs', 'reference', 'handout', 'features', 'tools', '?',
    ],
    group: 'Actions',
    path: 'Toolbar → ?',
    shortcuts: ['?'],
    when: always,
    run: (ctx) => ctx.actions.help(),
  },
  {
    id: 'palette',
    title: 'Command palette',
    description: 'Find any tool by name and run it',
    keywords: ['command', 'palette', 'search', 'find'],
    group: 'Actions',
    path: '⌘K anywhere',
    shortcuts: ['Mod+K', '/'],
    when: always,
    hideInPalette: true,
    run: () => {},
  },

  // ======================================================== Calculus
  calcCommand('calc-limit', 'limit', 'Limit at a point', 'One- and two-sided limits, a table of values, ε–δ; limits at ±∞', 'Calculus → Limit at a point', [
    'limit', 'limits', 'one-sided', 'two-sided', 'left-hand limit', 'right-hand limit', 'continuity', 'continuous',
    'discontinuity', 'hole', 'removable', 'jump', 'epsilon delta', 'ε δ', 'table of values', 'infinity',
    'limit at infinity', "l'hopital", 'lhopital', 'approach',
  ]),
  calcCommand('calc-secant', 'secant', 'Average rate of change (secant)', 'The secant on [a, b], its slope, the Mean Value Theorem point c, and f average', 'Calculus → Average rate of change', [
    'secant', 'secant line', 'average rate', 'average rate of change', 'arc', 'difference quotient', 'mvt',
    'mean value theorem', 'mean value', 'average value', 'f avg', 'rolle', "rolle's theorem", 'slope between two points',
  ]),
  calcCommand('calc-tangent', 'tangent', 'Tangent line', 'The tangent at a point you drag: its slope and equation (implicit curves too)', 'Calculus → Tangent line', [
    'tangent', 'tangent line', 'slope at a point', 'instantaneous rate', 'linearization', 'linear approximation',
    'local linearity', 'normal line', 'implicit differentiation', 'dy/dx', 'point slope',
  ]),
  calcCommand('calc-derivative', 'derivative', 'Derivative f′', "Graph f′ beside f, live as f changes", 'Calculus → Derivative f′', [
    'derivative', "f'", 'f prime', 'fprime', 'derivative graph', 'graph of the derivative', 'differentiate',
    'differentiation', 'slope function', 'rate of change', 'velocity',
  ]),
  calcCommand('calc-signchart', 'signchart', "Sign chart (f′, f″)", "Where f′ and f″ are + / −: increasing, decreasing, concavity, extrema, inflection", "Calculus → Sign chart (f′, f″)", [
    'sign chart', 'sign analysis', 'first derivative test', 'second derivative test', 'increasing', 'decreasing',
    'concavity', 'concave up', 'concave down', 'inflection', 'relative extrema', 'critical points', 'sign line',
    'candidates test',
  ]),
  calcCommand('calc-riemann', 'riemann', 'Riemann sum', 'Left, right, midpoint or trapezoid rectangles on [a, b], with n you set', 'Calculus → Riemann sum', [
    'riemann', 'riemann sum', 'rectangles', 'left sum', 'right sum', 'midpoint', 'trapezoid', 'trapezoidal',
    'lrams', 'rrams', 'mrams', 'approximate area', 'estimate area', 'upper sum', 'lower sum',
  ]),
  calcCommand('calc-area', 'area', 'Area under the curve', 'Shade ∫ₐᵇ f(x) dx and give its exact value', 'Calculus → Area under curve', [
    'integral', 'area', 'definite integral', 'area under the curve', 'area under', 'integrate', 'integration',
    'antiderivative', 'net area', 'signed area', 'shade', '∫',
  ]),
  calcCommand('calc-between', 'between', 'Area between curves…', 'Shade between this curve and another (pick the second curve on the board)', 'Calculus → Area between curves…', [
    'area between', 'area between curves', 'between two curves', 'region between', 'top minus bottom',
    'enclosed area', 'bounded region',
  ]),
  calcCommand('calc-accumulation', 'accumulation', 'Accumulation function ∫ₐˣ f', 'Graph g(x) = ∫ₐˣ f(t) dt: the Fundamental Theorem of Calculus', 'Calculus → Accumulation function', [
    'accumulation', 'accumulation function', 'ftc', 'fundamental theorem', 'fundamental theorem of calculus',
    'integral function', 'g(x) = integral', 'area function', 'net change', 'antiderivative graph',
  ]),
  calcCommand('calc-volume', 'volume', 'Volume of a solid…', 'Disk, washer or shell method, or cross-sections; the integral and its value', 'Calculus → Volume of a solid…', [
    'volume', 'disk', 'disc', 'disk method', 'washer', 'washer method', 'shell', 'shell method', 'cylindrical shells',
    'solid of revolution', 'revolve', 'rotate', 'cross sections', 'cross-sections', 'squares', 'semicircles',
  ]),
  calcCommand('calc-taylor', 'taylor', 'Taylor polynomial Pₙ', 'Pₙ(x) about a centre you set, its degree, the error bound', 'Series → Taylor polynomial Pₙ', [
    'taylor', 'taylor polynomial', 'taylor series', 'maclaurin', 'maclaurin series', 'series', 'power series',
    'approximation', 'polynomial approximation', 'lagrange error', 'error bound', 'remainder', 'degree n',
  ]),
  calcCommand('calc-pcalc', 'pcalc', 'Calculus at t (parametric / polar)', 'dy/dx, speed, velocity and arc length at t; dr/dθ for a polar curve', 'Parametric & polar → Calculus at t', [
    'parametric', 'polar', 'parametric derivative', 'dy/dx parametric', 'speed', 'velocity vector', 'arc length',
    'dr/dθ', 'polar slope', 'particle motion', 'vector valued', 'position vector',
  ]),
  calcCommand('calc-polarbetween', 'polarbetween', 'Area between polar curves', '½∫(r₁² − r₂²) dθ between this polar curve and another', 'Parametric & polar → Area between polar curves', [
    'polar area', 'area between polar', 'area between polar curves', 'inside outside', 'region polar', '1/2 r^2',
  ]),
  {
    id: 'show-inverse',
    title: 'Show inverse f⁻¹',
    description: 'Reflect the function across y = x, with the inverse’s formula when there is one',
    keywords: ['inverse', 'inverse function', 'f inverse', 'f^-1', 'reflect', 'reflection', 'y = x', 'swap x and y', 'undo function'],
    group: 'Calculus',
    path: 'Curve ⋯ → Inverse & domain → Show inverse',
    target: 'curve',
    when: graphEdit,
    accepts: (ctx, id) => !!curveOf(ctx, id)?.inverse,
    run: (ctx, id) => id && ctx.actions.showInverse(id),
  },
  {
    id: 'hlt',
    title: 'Horizontal line test',
    label: (ctx) => (curveOf(ctx, ctx.selectedId ?? undefined)?.hlt ? 'Hide the horizontal line test' : 'Horizontal line test'),
    description: 'A horizontal line to drag: is the function one-to-one?',
    keywords: ['horizontal line test', 'one-to-one', 'one to one', 'injective', 'hlt', 'invertible'],
    group: 'Calculus',
    path: 'Curve ⋯ → Inverse & domain → Horizontal line test',
    target: 'curve',
    when: graphEdit,
    accepts: (ctx, id) => !!curveOf(ctx, id)?.domain,
    run: (ctx, id) => {
      const c = curveOf(ctx, id)
      if (c) ctx.actions.setHlt(c.id, !c.hlt)
    },
  },
  {
    id: 'domain-range',
    title: 'Domain & range',
    description: 'The function’s domain and range, in interval notation or set-builder',
    keywords: ['domain', 'range', 'domain and range', 'interval notation', 'set builder', 'inputs', 'outputs'],
    group: 'Calculus',
    path: 'Curve card → Analysis → Domain / Range',
    target: 'curve',
    when: graph,
    accepts: (ctx, id) => !!curveOf(ctx, id)?.domain,
    run: (ctx, id) => id && ctx.actions.showDomain(id, false),
  },
  {
    id: 'curve-table',
    title: 'Table of values',
    description: 'f(x) from a start by a step, or at a list of x’s — exact where exact; Δy, Δ²y, ratios and average rates of change',
    keywords: [
      'table', 'table of values', 't-table', 't chart', 'input output table', 'function table', 'x y table',
      'first differences', 'second differences', 'common difference', 'common ratio', 'ratio', 'rate of change',
      'linear or exponential', 'copy to data table', 'table on figure',
    ],
    group: 'Calculus',
    path: 'Curve card → Table',
    target: 'curve',
    when: graph,
    accepts: (ctx, id) => curveOf(ctx, id)?.table === true,
    run: (ctx, id) => id && ctx.actions.openTableTool?.(id, 'table'),
  },
  {
    id: 'curve-evaluate',
    title: 'Evaluate f(a)',
    description: 'f(2.5), f(π/6) or f(−3) + g(2): the exact value and its decimal, and the point (a, f(a)) on the graph',
    keywords: ['evaluate', 'function notation', 'f(2)', 'f of', 'plug in', 'substitute', 'input', 'output', 'find f(a)', 'value of f'],
    group: 'Calculus',
    path: 'Curve card → Table → Evaluate',
    target: 'curve',
    when: graph,
    accepts: (ctx, id) => curveOf(ctx, id)?.table === true,
    run: (ctx, id) => id && ctx.actions.openTableTool?.(id, 'evaluate'),
  },
  {
    id: 'curve-compare',
    title: 'Compare two functions',
    description: 'Two functions side by side in one table, and where one overtakes the other for good (2ˣ passes x³)',
    keywords: [
      'compare', 'compare functions', 'side by side', 'overtake', 'exceeds', 'eventually exceeds', 'end behavior',
      'end behaviour', 'exponential vs polynomial', 'grows faster', 'which is bigger', 'linear vs exponential',
    ],
    group: 'Calculus',
    path: 'Curve card → Table → Compare',
    target: 'curve',
    when: graph,
    accepts: (ctx, id) => curveOf(ctx, id)?.table === true,
    blocked: (ctx) =>
      ctx.curves.filter((c) => c.table === true).length >= 2 ? null : 'Needs a second function on the board',
    run: (ctx, id) => id && ctx.actions.openTableTool?.(id, 'compare'),
  },
  {
    id: 'curve-remainder',
    title: 'Divide by (x − a): Remainder Theorem',
    description: 'Synthetic division of a polynomial by (x − a): the tableau, the quotient, f(a) = remainder, and whether (x − a) is a factor',
    keywords: [
      'remainder theorem', 'synthetic division', 'divide', 'division', 'factor theorem', 'is a factor',
      'quotient', 'remainder', 'polynomial division', 'x - a',
    ],
    group: 'Calculus',
    path: 'Curve card → Table → Divide by (x − a)',
    target: 'curve',
    when: graph,
    accepts: (ctx, id) => curveOf(ctx, id)?.poly === true,
    run: (ctx, id) => id && ctx.actions.openTableTool?.(id, 'divide'),
  },
  {
    id: 'domain-restrict',
    title: 'Restrict the domain…',
    description: 'Cut the function to an interval (to make it one-to-one, say); the cut part ghosts',
    keywords: ['restrict', 'restrict domain', 'restriction', 'domain restriction', 'limit the domain', 'make one-to-one', 'x >= 0'],
    group: 'Calculus',
    path: 'Curve card → Analysis → Domain → Restrict',
    target: 'curve',
    when: graphEdit,
    accepts: (ctx, id) => !!curveOf(ctx, id)?.domain,
    run: (ctx, id) => id && ctx.actions.showDomain(id, true),
  },
  {
    id: 'field-euler',
    title: 'Euler’s method',
    description: 'Step along the slope field from a start point with step h; the table of steps',
    keywords: ['euler', "euler's method", 'eulers method', 'step size', 'h', 'approximate solution', 'numerical solution', 'tangent line steps'],
    group: 'Calculus',
    path: 'Slope field card → Euler’s method',
    target: 'field',
    when: graphEdit,
    accepts: (ctx, id) => ctx.fields.some((f) => f.id === id),
    run: (ctx, id) => id && ctx.actions.addEuler(id),
  },
  {
    id: 'seq-series',
    title: 'Series Σ and convergence tests',
    description: 'The series of a sequence: partial sums Sₙ and which convergence test applies',
    keywords: [
      'series', 'sigma', 'Σ', 'infinite series', 'convergence', 'converge', 'diverge', 'divergence',
      'convergence test', 'ratio test', 'nth term test', 'geometric series', 'p-series', 'comparison test',
      'alternating series', 'integral test', 'sum',
    ],
    group: 'Calculus',
    path: 'Sequence card → Σ Show series',
    target: 'sequence',
    when: graphEdit,
    accepts: (ctx, id) => ctx.sequences.some((q) => q.id === id),
    run: (ctx, id) => id && ctx.actions.toggleSeqSeries(id),
  },
  {
    id: 'seq-sums',
    title: 'Partial sums Sₙ',
    description: 'Plot the partial sums S₁, S₂, … beside the terms',
    keywords: ['partial sums', 'partial sum', 'sn', 's_n', 'running total', 'sum of terms'],
    group: 'Calculus',
    path: 'Sequence card → Partial sums',
    target: 'sequence',
    when: graphEdit,
    accepts: (ctx, id) => ctx.sequences.some((q) => q.id === id),
    run: (ctx, id) => id && ctx.actions.toggleSeqSums(id),
  },
  {
    id: 'nl-signs',
    title: 'Sign chart on the number line',
    description: 'The + / − row above the line, with 0 and und at the critical values',
    keywords: ['sign chart', 'signs', 'sign line', 'plus minus', 'critical values', 'sign analysis'],
    group: 'Calculus',
    path: 'Solved inequality card → Signs',
    target: 'solve',
    when: (ctx) => numberLine(ctx) && editable(ctx),
    accepts: (ctx, id) => ctx.solves.some((s) => s.id === id),
    run: (ctx, id) => {
      const s = ctx.solves.find((x) => x.id === id)
      if (s) ctx.actions.solveShow(s.id, { signs: !s.signs })
    },
  },
  {
    id: 'nl-tests',
    title: 'Test points',
    description: 'Mark the test point in each interval, labelled t = …',
    keywords: ['test points', 'test point', 'test values', 'check', 'intervals'],
    group: 'Calculus',
    path: 'Solved inequality card → Test points',
    target: 'solve',
    when: (ctx) => numberLine(ctx) && editable(ctx),
    accepts: (ctx, id) => ctx.solves.some((s) => s.id === id),
    run: (ctx, id) => {
      const s = ctx.solves.find((x) => x.id === id)
      if (s) ctx.actions.solveShow(s.id, { tests: !s.tests })
    },
  },
  {
    id: 'nl-graph',
    title: 'Show the inequality on the graph',
    description: 'Switch to the graph with both sides drawn, so the solution can be seen there too',
    keywords: ['show on graph', 'graph it', 'graphically', 'graph both sides', 'intersection', 'visual'],
    group: 'Calculus',
    path: 'Solved inequality card → Show on graph',
    target: 'solve',
    when: (ctx) => numberLine(ctx) && editable(ctx),
    accepts: (ctx, id) => ctx.solves.some((s) => s.id === id),
    run: (ctx, id) => id && ctx.actions.solveGraph(id),
  },

  // ======================================================== Build
  builder('build-roots', 'factor', 'From roots (polynomial / rational)', 'State the zeros, multiplicities, asymptotes and holes; get the function', [
    'roots', 'zeros', 'factored form', 'polynomial', 'rational', 'rational function', 'x-intercepts', 'factors',
    'multiplicity', 'asymptote', 'vertical asymptote', 'hole', 'end behavior', 'cubic', 'quadratic',
  ]),
  builder('build-exp', 'exp', 'Exponential', 'From a starting value and a growth or decay rate (or two points)', [
    'exponential', 'growth', 'decay', 'half-life', 'half life', 'doubling', 'compound interest', 'initial value',
    'percent', 'a b^x', 'e^x',
  ]),
  builder('build-logistic', 'logistic', 'Logistic', 'From L, k and y(0), the way a BC problem states it', [
    'logistic', 'logistic growth', 'carrying capacity', 'population', 'limiting value', 'logistic differential equation',
  ]),
  builder('build-log', 'log', 'Logarithmic', 'From the base, the asymptote and the shifts (or as the inverse of an exponential)', [
    'log', 'logarithm', 'logarithmic', 'ln', 'natural log', 'log base', 'inverse of exponential',
  ]),
  builder('build-sin', 'sin', 'Sinusoidal', 'From amplitude, period, phase shift and midline', [
    'sine', 'sin', 'cosine', 'cos', 'sinusoid', 'sinusoidal', 'trig graph', 'trig function', 'amplitude', 'period',
    'phase shift', 'midline', 'frequency', 'periodic', 'ferris wheel', 'tides',
  ]),
  builder('build-transform', 'transform', 'Transformation of a parent', 'a·f(b(x − h)) + k from a gallery of sixteen parent functions', [
    'transformation', 'transformations', 'parent function', 'parent', 'shift', 'translate', 'stretch', 'compress',
    'reflect', 'vertex form', 'a f(b(x-h))+k', 'square root', 'cube root', 'absolute value', 'reciprocal',
  ], 'Transformation'),
  builder('build-piecewise', 'piecewise', 'Piecewise / step function', 'Piece by piece in a table, with open and closed ends', [
    'piecewise', 'piecewise function', 'step function', 'greatest integer', 'floor', 'ceiling', 'split function',
    'jump discontinuity', 'cases',
  ], 'Piecewise / step'),
  builder('build-conic', 'conic', 'Conic section', 'Circle, ellipse, hyperbola or parabola from its centre, vertices, foci or directrix', [
    'conic', 'conics', 'circle', 'ellipse', 'hyperbola', 'parabola', 'foci', 'focus', 'directrix', 'vertices',
    'center radius', 'general form', 'standard form', 'eccentricity',
  ]),
  builder('build-motion', 'motion', 'Parametric / polar curve', 'A named family or x(t), y(t) / r(θ), animated in t', [
    'parametric', 'parametric equations', 'polar', 'polar curve', 'polar graph', 'x(t)', 'y(t)', 'r(θ)', 'r theta',
    'rose', 'cardioid', 'limacon', 'spiral', 'lemniscate', 'projectile', 'particle motion',
  ], 'Parametric / polar'),
  builder('build-seq', 'seq', 'Sequence', 'Arithmetic, geometric, explicit, recursive or listed — the dots (n, aₙ)', [
    'sequence', 'sequences', 'arithmetic', 'geometric', 'recursive', 'recursion', 'explicit formula', 'a_n', 'an',
    'terms', 'nth term', 'common difference', 'common ratio',
  ]),
  {
    id: 'build-data',
    title: 'Data table & regression',
    description: 'Type or paste x, y columns, then fit linear, quadratic, exponential … with r and residuals',
    keywords: [
      'data', 'table', 'data table', 'regression', 'scatter plot', 'scatterplot', 'line of best fit', 'best fit',
      'paste', 'spreadsheet', 'residuals', 'r squared', 'correlation', 'modeling', 'statistics', 'points',
    ],
    group: 'Build',
    path: 'Build ▾ → Data table',
    when: graphEdit,
    run: (ctx) => ctx.actions.addDataTable(),
  },
  {
    id: 'build-unit-circle',
    title: 'Unit circle',
    description: 'P(θ) = (cos θ, sin θ), the reference angle, exact values and the unwrapped graph',
    keywords: [
      'unit circle', 'trig', 'trigonometry', 'reference angle', 'radians', 'degrees', 'exact values', 'sin cos tan',
      'inverse trig', 'arcsin', 'arccos', 'arctan', 'special angles', 'coterminal', 'angle',
    ],
    group: 'Build',
    path: 'Build ▾ → Unit circle',
    when: graphEdit,
    run: (ctx) => ctx.actions.addUnitCircle(),
  },
  {
    id: 'build-related-rates',
    title: 'Related rates',
    description: 'A sliding ladder, a cone tank, a shadow, a ripple or a balloon, animated with live rates',
    keywords: [
      'related rates', 'related rate', 'ladder', 'cone', 'tank', 'shadow', 'balloon', 'ripple', 'dv/dt', 'dr/dt',
      'rates', 'implicit in time',
    ],
    group: 'Build',
    path: 'Build ▾ → Related rates',
    when: graphEdit,
    run: (ctx) => ctx.actions.addRelatedRates(),
  },
  {
    id: 'build-normal',
    title: 'Normal distribution',
    description: 'N(μ, σ) with a shaded probability, z-scores, percentiles and the empirical rule',
    keywords: [
      'normal', 'normal distribution', 'normal curve', 'bell curve', 'gaussian', 'z-score', 'z score',
      'z-scores', 'empirical rule', '68 95 99.7', 'percentile', 'invnorm', 'normalcdf', 'probability',
      'area under the curve', 'standard deviation', 'statistics', 'stats',
    ],
    group: 'Build',
    path: 'Build ▾ → Normal distribution',
    when: graphEdit,
    run: (ctx) => ctx.actions.addNormal(),
  },
  {
    id: 'build-simulation',
    title: 'Sampling simulation',
    description: 'Repeated samples (means or proportions), margin of error, and a randomisation test for two treatments',
    keywords: [
      'simulation', 'simulate', 'sampling', 'sampling distribution', 'sample mean', 'sample proportion',
      'margin of error', 'confidence interval', 'randomization', 'randomisation', 'permutation test',
      'compare treatments', 'experiment', 'p-value', 'p value', 'inference', 'dot plot', 'statistics', 'stats',
    ],
    group: 'Build',
    path: 'Build ▾ → Simulation',
    when: graphEdit,
    run: (ctx) => ctx.actions.addSimulation(),
  },
  {
    id: 'build-data-plot',
    title: 'One-variable data (dot plot, histogram, box plot)',
    description: 'Paste a list — or several to compare — for a dot plot, histogram and parallel box plots, the summary, shape, outliers and which measures to use',
    keywords: [
      'data', 'one-variable', 'one variable', '1-var stats', 'dot plot', 'histogram', 'box plot', 'boxplot',
      'box and whisker', 'parallel box plots', 'five-number summary', 'five number summary', 'quartiles', 'iqr',
      'interquartile range', 'median', 'mean', 'mode', 'standard deviation', 'outlier', 'outliers', 'fences',
      'skewed', 'skew', 'symmetric', 'shape', 'center', 'centre', 'spread', 'compare data sets', 'statistics', 'stats',
    ],
    group: 'Build',
    path: 'Build ▾ → One-variable data',
    when: graphEdit,
    run: (ctx) => ctx.actions.addDataPlot(),
  },
  {
    id: 'build-probability',
    title: 'Probability (two-way table, Venn diagram, tree diagram)',
    description: 'A two-way table with joint, marginal and conditional probabilities and the independence check; a Venn diagram that shades A ∩ Bᶜ, A ∪ B … with the Addition Rule; a tree diagram for draws with or without replacement with the Multiplication Rule',
    keywords: [
      'probability', 'two-way table', 'two way table', 'contingency table', 'conditional probability', 'conditional',
      'given', 'p(a|b)', 'independent', 'independence', 'dependent', 'joint', 'marginal', 'relative frequency',
      'venn', 'venn diagram', 'union', 'intersection', 'complement', 'addition rule', 'or', 'and', 'not',
      'tree', 'tree diagram', 'multiplication rule', 'with replacement', 'without replacement', 'draws', 'bag',
      'marbles', 'compound events', 'sample space', 'outcomes', 'events', 'counting',
    ],
    group: 'Build',
    path: 'Build ▾ → Probability',
    when: graphEdit,
    run: (ctx) => ctx.actions.addProbability(),
  },
  seeded('build-slope-field', 'dy/dx = ', 'Slope field', 'Type dy/dx = … and get its slope field; tap to draw solutions', [
    'slope field', 'slope fields', 'direction field', 'differential equation', 'diff eq', 'dy/dx', 'ode',
    'separable', 'solution curve', 'initial condition',
  ]),
  seeded('build-inequality', 'y > ', 'Shade an inequality (2-D)', 'Type y > … (or several) to shade regions; systems, test points, linear programming', [
    'inequality', 'inequalities', 'shade', 'shading', 'region', 'system of inequalities', 'systems',
    'linear programming', 'feasible region', 'corner points', 'vertices', 'objective function', 'optimize',
    'half plane',
  ]),
  seeded('build-shape', 'ABC = ', 'Triangle or polygon', 'Type ABC = (0,0) (4,0) (4,3) — its card measures sides, slopes, angles, perimeter and area, and classifies it', [
    'triangle', 'polygon', 'shape', 'quadrilateral', 'geometry', 'vertices', 'points', 'right triangle',
    'perimeter', 'area', 'shoelace', 'angles', 'classify', 'parallelogram', 'rectangle', 'rhombus', 'square',
    'trapezoid', 'kite', 'isosceles', 'equilateral', 'scalene', 'congruence marks', 'tick marks',
    'trig ratios', 'sine', 'cosine', 'tangent', 'sohcahtoa', 'pythagorean theorem', '30-60-90', '45-45-90',
    'special right triangles', 'measurements',
  ]),
  seeded('build-segment', 'AB = ', 'Segment: distance, midpoint, slope', 'Type AB = (1,2) (4,6) — its card gives the exact length, midpoint, slope and the line through it', [
    'segment', 'distance', 'distance formula', 'midpoint', 'midpoint formula', 'endpoint', 'slope', 'rise over run',
    'line through two points', 'slope-intercept', 'point-slope', 'length',
  ]),
  {
    id: 'shape-transform',
    title: 'Transform a figure',
    description: 'Translate, reflect, rotate or dilate a figure: a linked image A′B′C′ with its mapping rule, rigid or not, and what is preserved',
    keywords: [
      'transformation', 'transformations', 'transform', 'translate', 'translation', 'reflect', 'reflection',
      'rotate', 'rotation', 'dilate', 'dilation', 'scale factor', 'image', 'pre-image', 'preimage', 'prime',
      'mapping rule', 'mapping notation', 'rigid motion', 'isometry', 'composition', 'sequence of transformations',
      'mirror line', 'center of rotation', 'centre of rotation', 'center of dilation', 'enlargement', 'reduction',
      'glide reflection', 'function notation', 'G-CO', 'G-SRT',
    ],
    group: 'Build',
    path: 'Shape card → Transform (or type rotate ABC 90° about (0, 0))',
    target: 'shape',
    when: graphEdit,
    accepts: (ctx, id) => {
      const k = ctx.shapes?.find((s) => s.id === id)?.kind
      return k === 'point' || k === 'segment' || k === 'polygon'
    },
    run: (ctx, id) => {
      if (id) ctx.actions.openShapeTool?.(id, 'transform')
    },
  },
  {
    id: 'shape-compare',
    title: 'Compare two figures',
    description: 'Congruent or similar? The rigid motion (or similarity) that maps one figure onto the other, the criterion and the corresponding parts',
    keywords: [
      'compare', 'congruent', 'congruence', 'similar', 'similarity', 'sss', 'sas', 'asa', 'aas', 'hl', 'ssa',
      'aa', 'aa similarity', 'corresponding parts', 'cpctc', 'find the transformation', 'which transformation',
      'sequence of rigid motions', 'scale factor', 'proportional sides',
    ],
    group: 'Build',
    path: 'Shape card → Compare',
    target: 'shape',
    when: graphEdit,
    accepts: (ctx, id) => {
      const k = ctx.shapes?.find((s) => s.id === id)?.kind
      return k === 'segment' || k === 'polygon'
    },
    run: (ctx, id) => {
      if (id) ctx.actions.openShapeTool?.(id, 'compare')
    },
  },
  {
    id: 'shape-symmetry',
    title: 'Lines and rotations of symmetry',
    description: 'Draw a polygon’s lines of symmetry and state its rotation symmetry: the motions that carry it onto itself',
    keywords: [
      'symmetry', 'line symmetry', 'lines of symmetry', 'reflection symmetry', 'rotational symmetry',
      'rotation symmetry', 'order of rotation', 'point symmetry', 'carry onto itself', 'regular polygon',
    ],
    group: 'Build',
    path: 'Polygon card → Symmetry → Lines of symmetry',
    target: 'shape',
    when: graphEdit,
    accepts: (ctx, id) => ctx.shapes?.find((s) => s.id === id)?.kind === 'polygon',
    run: (ctx, id) => {
      if (id) ctx.actions.openShapeTool?.(id, 'symmetry')
    },
  },
  {
    id: 'shape-centres',
    title: 'Triangle centres',
    description: 'Centroid, circumcentre, incentre and orthocentre — exact where they can be — drawn with the medians, bisectors and altitudes, the two circles and the Euler line',
    keywords: [
      'centroid', 'circumcenter', 'circumcentre', 'incenter', 'incentre', 'orthocenter', 'orthocentre',
      'triangle centers', 'triangle centres', 'points of concurrency', 'concurrency', 'medians', 'median',
      'perpendicular bisector', 'perpendicular bisectors', 'angle bisector', 'angle bisectors', 'altitude',
      'altitudes', 'circumscribed circle', 'circumcircle', 'inscribed circle', 'incircle', 'circumradius',
      'inradius', 'euler line', 'G-CO.10', 'G-CO.14',
    ],
    group: 'Build',
    path: 'Triangle card → Centres',
    target: 'shape',
    when: graphEdit,
    accepts: (ctx, id) => ctx.shapes?.find((s) => s.id === id)?.triangle === true,
    run: (ctx, id) => {
      if (id) ctx.actions.openShapeTool?.(id, 'centres')
    },
  },
  {
    id: 'circle-angles',
    title: 'Inscribed and central angles',
    description: 'Points on a circle: the inscribed angle ∠PRQ is half the central angle ∠POQ on the same arc — 90° on a diameter',
    keywords: [
      'inscribed angle', 'central angle', 'intercepted arc', 'arc', 'chord', 'chords', 'circle theorems',
      'circle theorem', 'semicircle', 'thales', 'angle in a semicircle', 'points on a circle', 'G-C.2',
    ],
    group: 'Build',
    path: 'Circle card → Circle theorems → Inscribed & central angle',
    target: 'curve',
    when: graphEdit,
    accepts: (ctx, id) => curveOf(ctx, id)?.circle === true,
    run: (ctx, id) => id && ctx.actions.openCircleTool?.(id, 'angles'),
  },
  {
    id: 'circle-tangent',
    title: 'Tangent to a circle',
    description: 'The tangent line at a point of a circle, its equation, and the right angle it makes with the radius',
    keywords: [
      'tangent to a circle', 'tangent line', 'tangent', 'radius perpendicular', 'perpendicular to the radius',
      'point of tangency', 'tangents from a point', 'two tangents', 'tangent segments', 'secant', 'tangent secant',
      'intersecting chords', 'chord chord', 'power of a point', 'G-C.2',
    ],
    group: 'Build',
    path: 'Circle card → Circle theorems → Tangent',
    target: 'curve',
    when: graphEdit,
    accepts: (ctx, id) => curveOf(ctx, id)?.circle === true,
    run: (ctx, id) => id && ctx.actions.openCircleTool?.(id, 'tangent'),
  },
  {
    id: 'circle-sector',
    title: 'Arc length and sector area',
    description: 'A sector of a circle shaded and its arc highlighted: θ in radians, s = rθ and A = ½r²θ, exact in π, with the degree-proportion forms',
    keywords: [
      'arc length', 'sector', 'sector area', 'area of a sector', 'radian', 'radians', 'radian measure',
      's = r theta', 'central angle', 'proportional', 'degree to radian', 'G-C.5',
    ],
    group: 'Build',
    path: 'Circle card → Circle theorems → Arc & sector',
    target: 'curve',
    when: graphEdit,
    accepts: (ctx, id) => curveOf(ctx, id)?.circle === true,
    run: (ctx, id) => id && ctx.actions.openCircleTool?.(id, 'sector'),
  },
  seeded('build-parallel-line', 'parallel to ', 'Line parallel or perpendicular through a point', 'Type parallel to AB through P (or perpendicular to …) — a line that follows A, B and P', [
    'parallel', 'perpendicular', 'parallel line', 'perpendicular line', 'through a point', 'slope criteria',
    'negative reciprocal', 'linked line', 'construct',
  ]),

  // ======================================================== Document
  {
    id: 'doc-new-graph',
    title: 'New graph',
    description: 'A fresh coordinate-plane document (this one is saved first)',
    keywords: ['new', 'new graph', 'new document', 'blank', 'fresh', 'start over', 'coordinate plane', 'empty'],
    group: 'Document',
    path: 'Document menu → New graph',
    when: always,
    run: (ctx) => ctx.actions.newDocument('cartesian'),
  },
  {
    id: 'doc-new-nl',
    title: 'New number line',
    description: 'A fresh number-line document, for solving inequalities',
    keywords: ['new number line', 'number line', 'new', 'inequality board', 'blank number line'],
    group: 'Document',
    path: 'Document menu → New number line',
    when: always,
    run: (ctx) => ctx.actions.newDocument('number-line'),
  },
  {
    id: 'doc-switch-nl',
    title: 'Switch this board to the number line',
    description: 'Show this document’s number line; the curves wait, untouched',
    keywords: ['number line', 'switch', 'board type', 'change board', '1d'],
    group: 'Document',
    path: 'Sidebar → Graph | Number line',
    when: graphEdit,
    run: (ctx) => ctx.actions.setBoardKind('number-line'),
  },
  {
    id: 'doc-switch-graph',
    title: 'Switch this board to the graph',
    description: 'Show this document’s graph; the number line waits, untouched',
    keywords: ['graph', 'switch', 'board type', 'change board', 'coordinate plane', '2d'],
    group: 'Document',
    path: 'Sidebar → Graph | Number line',
    when: (ctx) => numberLine(ctx) && editable(ctx),
    run: (ctx) => ctx.actions.setBoardKind('cartesian'),
  },
  {
    id: 'doc-duplicate',
    title: 'Duplicate this document',
    description: 'A copy of the whole document, to change without losing this one',
    keywords: ['duplicate document', 'copy document', 'save as', 'version', 'clone'],
    group: 'Document',
    path: 'Document menu → Duplicate',
    when: (ctx) => !ctx.shared,
    run: (ctx) => ctx.actions.duplicateDocument(),
  },
  {
    id: 'doc-worksheet',
    title: 'Worksheet…',
    description: 'Several figures from your documents on one printable page; student and key versions',
    keywords: [
      'worksheet', 'handout', 'print', 'printable', 'several figures', 'quiz', 'test', 'student version',
      'answer key', 'key', 'page', 'packet', 'multiple graphs',
    ],
    group: 'Document',
    path: 'Document menu → Worksheet…',
    when: always,
    run: (ctx) => ctx.actions.openWorksheet(),
  },
  {
    id: 'doc-examples',
    title: 'Open an example',
    description: 'Ready-to-teach boards for every unit, each with a teacher note; opens as a copy',
    keywords: [
      'example', 'examples', 'gallery', 'sample', 'demo', 'template', 'lesson', 'ready made', 'tour',
      'what can it do', 'unit', 'ap calculus', 'precalculus', 'math 3',
    ],
    group: 'Document',
    path: 'Document menu → Examples…',
    when: always,
    run: (ctx) => ctx.actions.openExamples(),
  },
  {
    id: 'doc-graph-from-item',
    title: 'Graph from item…',
    description: 'Paste an item bank stem or %%% ITEM record; its definitions open as a new graph',
    keywords: [
      'graph from item', 'item bank', 'bank', 'stem', 'mathpix', 'latex', 'paste latex', 'import latex',
      'ap classroom', 'free response', 'frq', 'figure needed', 'bank.tex', 'record', 'figuredesc', 'tikz',
    ],
    group: 'Document',
    path: 'Document menu → Graph from item…',
    when: always,
    run: (ctx) => ctx.actions.graphFromItem(),
  },
  {
    id: 'doc-share',
    title: 'Share link / QR code…',
    description: 'A link or QR code that opens exactly this graph, no account needed',
    keywords: ['share', 'link', 'url', 'qr', 'qr code', 'send', 'students', 'google classroom', 'copy link', 'post'],
    group: 'Document',
    path: 'Document menu → Share link…',
    when: always,
    run: (ctx) => ctx.actions.share(),
  },
  {
    id: 'doc-backup',
    title: 'Save a backup…',
    description: 'Download this document as a .json file you can import later',
    keywords: ['backup', 'save', 'save file', 'json', 'export document', 'download document', 'keep'],
    group: 'Document',
    path: 'Document menu → Save a backup…',
    when: always,
    run: (ctx) => ctx.actions.backup(),
  },
  {
    id: 'doc-import',
    title: 'Import from file…',
    description: 'Open a .json document saved earlier (or drop it on the board)',
    keywords: ['import', 'open file', 'open', 'load', 'restore', 'upload', 'json'],
    group: 'Document',
    path: 'Document menu → Import from file…',
    when: always,
    run: (ctx) => ctx.actions.importFile(),
  },
  {
    id: 'doc-make-copy',
    title: 'Make a copy of this shared graph',
    description: 'Save the shared graph into your own documents, where you can edit it',
    keywords: ['make a copy', 'copy', 'save shared', 'keep', 'edit shared'],
    group: 'Document',
    path: 'Shared-graph banner → Make a copy',
    when: (ctx) => ctx.shared,
    run: (ctx) => ctx.actions.makeCopy(),
  },

  // ======================================================== Export
  {
    id: 'export-download',
    title: 'Download the figure',
    label: (ctx) => `Download the figure (${FORMAT_NAMES[ctx.exportFormat]})`,
    description: 'Download the board in your chosen format, figure style and size',
    keywords: ['download', 'export', 'save image', 'save picture', 'figure', 'image', 'save graph'],
    group: 'Export',
    path: 'Toolbar → Download',
    when: always,
    blocked: (ctx) => (ctx.hasContent ? null : 'The board is empty'),
    run: (ctx) => ctx.actions.download(),
  },
  downloadAs('png', 'A picture: for Word, Google Docs, slides', ['png', 'image', 'picture', 'word', 'google docs', 'slides', 'raster']),
  downloadAs('svg', 'Vector, sized in px: for the web, Illustrator, Inkscape', ['svg', 'vector', 'scalable', 'illustrator', 'inkscape']),
  downloadAs('pdf', 'Vector, sized in cm: for \\includegraphics in LaTeX', ['pdf', 'vector', 'includegraphics', 'print quality']),
  downloadAs('tikz', 'The figure as TikZ commands: a .tex file to \\input and edit', ['tikz', 'latex', 'tex', 'overleaf', '.tex']),
  downloadAs('pgfplots', 'A pgfplots axis with the equations themselves', ['pgfplots', 'latex', 'tex', 'overleaf', 'axis environment']),
  {
    id: 'export-copy',
    title: 'Copy the figure to the clipboard',
    description: 'A PNG on the clipboard, to paste into a doc or a slide',
    keywords: ['copy', 'clipboard', 'paste', 'copy image', 'copy png', 'copy picture', 'screenshot'],
    group: 'Export',
    path: 'Download ▾ (caret) → Copy',
    when: always,
    blocked: (ctx) => (ctx.hasContent ? null : 'The board is empty'),
    run: (ctx) => ctx.actions.copyPng(),
  },
  {
    id: 'export-copy-latex',
    title: 'Copy LaTeX (TikZ / pgfplots)',
    description: 'The figure’s TikZ or pgfplots source on the clipboard',
    keywords: ['latex', 'copy latex', 'tikz', 'pgfplots', 'tex', 'overleaf', 'item bank'],
    group: 'Export',
    path: 'Download ▾ (caret) → Format: TikZ / pgfplots → Copy LaTeX',
    when: always,
    blocked: (ctx) => (ctx.hasContent ? null : 'The board is empty'),
    run: (ctx) => ctx.actions.copyLatex(),
  },
  {
    id: 'export-item-bank',
    title: 'Copy for item bank…',
    description: 'The figure as a block for a bank.tex record: %%% figure=tikz, the figuredesc, the TikZ or pgfplots picture',
    keywords: [
      'item bank', 'bank', 'figuredesc', 'tikz', 'pgfplots', 'stem', 'mathpix', 'bank.tex', 'record',
      'figure=tikz', 'figure described', 'house style', 'ap item', 'copy for bank', 'latex',
    ],
    group: 'Export',
    path: 'Download ▾ (caret) → Copy for item bank…',
    when: graph,
    blocked: (ctx) => (ctx.hasContent ? null : 'The board is empty'),
    run: (ctx) => ctx.actions.copyForBank(),
  },
  figureStyle('screen', 'The figure as the board looks on screen', ['screen', 'default style', 'neon', 'plain', 'no style', 'reset style']),
  figureStyle('textbook', 'Black on white, grid every unit, labels every 5', ['textbook', 'book', 'black and white', 'print style', 'clean']),
  figureStyle('sat', 'The look of an SAT figure', ['sat', 'sat style', 'college board', 'digital sat', 'test style']),
  figureStyle('ap', 'The look of an AP Calculus exam figure', ['ap', 'ap style', 'ap calculus', 'ap calc', 'ap exam', 'frq', 'college board']),
  {
    id: 'style-preview',
    title: 'Preview the figure style on the board',
    label: (ctx) => (ctx.previewFigure ? 'Stop previewing the figure style' : 'Preview the figure style on the board'),
    description: 'See the export look on the board for a moment; the canvas goes back after',
    keywords: ['preview', 'preview style', 'what will it look like', 'see export'],
    group: 'Export',
    path: 'Download ▾ (caret) → Figure style → Preview on board',
    when: (ctx) => graph(ctx) && ctx.figure !== null && ctx.figure !== 'screen',
    run: (ctx) => ctx.actions.setPreview(!ctx.previewFigure),
  },

  // ======================================================== View
  {
    id: 'view-analysis',
    title: 'Analysis markers',
    label: (ctx) => (ctx.showAnalysis ? 'Hide analysis markers' : 'Show analysis markers'),
    description: 'Zeros, extrema, inflection points, intercepts and asymptotes on the board',
    keywords: [
      'analysis', 'markers', 'key points', 'zeros', 'extrema', 'max', 'min', 'maximum', 'minimum', 'intercepts',
      'inflection points', 'critical points', 'asymptotes', 'features',
    ],
    group: 'View',
    path: 'Toolbar → Analysis',
    shortcuts: ['A'],
    when: always,
    run: (ctx) => ctx.actions.toggleAnalysis(),
  },
  {
    id: 'view-theme',
    title: 'Light or dark canvas',
    label: (ctx) => (ctx.canvasTheme === 'dark' ? 'Light canvas' : 'Dark canvas'),
    description: 'The board’s ground on screen (exports have their own)',
    keywords: ['dark', 'light', 'theme', 'dark mode', 'light mode', 'background', 'white board', 'black board', 'contrast'],
    group: 'View',
    path: 'Toolbar → ☾ / ☀',
    when: always,
    run: (ctx) => ctx.actions.toggleTheme(),
  },
  {
    id: 'view-describe',
    title: 'Describe this graph',
    description: 'The board in words, as a screen reader hears it — copy it as alt text',
    keywords: [
      'describe', 'description', 'alt text', 'alternative text', 'screen reader', 'accessibility', 'a11y',
      'blind', 'low vision', 'read aloud', 'words', 'text version', 'accommodation', 'iep', '504',
    ],
    group: 'View',
    path: 'Toolbar → ⋯ → Describe this graph',
    when: always,
    run: (ctx) => ctx.actions.describe(),
  },
  {
    id: 'view-colour-safe',
    title: 'Colour-blind-safe curve colours',
    label: (ctx) =>
      ctx.curvePalette === 'safe' ? 'Standard curve colours' : 'Colour-blind-safe curve colours',
    description: 'Okabe–Ito colours and a dash pattern per curve, on screen and in exports',
    keywords: [
      'colour blind', 'color blind', 'colourblind', 'colorblind', 'cvd', 'deuteranopia', 'protanopia',
      'tritanopia', 'palette', 'colours', 'colors', 'accessible colours', 'okabe ito', 'dashes',
      'accessibility', 'a11y', 'contrast',
    ],
    group: 'View',
    path: 'Download ▾ (caret) → Curve colours',
    when: always,
    run: (ctx) => ctx.actions.setCurvePalette(ctx.curvePalette === 'safe' ? 'standard' : 'safe'),
  },
  {
    id: 'view-present',
    title: 'Presentation mode',
    label: (ctx) => (ctx.presentMode ? 'Leave presentation mode' : 'Presentation mode'),
    description: 'Big type, no sidebar, the equations on the board — for the projector',
    keywords: ['present', 'presentation', 'projector', 'full screen', 'fullscreen', 'big', 'classroom', 'smartboard', 'display', 'slideshow'],
    group: 'View',
    path: 'Toolbar → ▭ (Present)',
    shortcuts: ['F'],
    when: always,
    run: (ctx) => ctx.actions.setPresent(!ctx.presentMode),
  },
  {
    id: 'view-reveal',
    title: 'Reveal mode',
    label: (ctx) => (ctx.revealOn ? 'Leave reveal mode' : 'Reveal mode'),
    description: 'Hide the answers, then reveal them one at a time',
    keywords: ['reveal', 'hide answers', 'answers', 'quiz mode', 'one at a time', 'step by step', 'cover', 'mask', 'predict'],
    group: 'View',
    path: 'Toolbar → Reveal',
    shortcuts: ['R'],
    when: always,
    run: (ctx) => ctx.actions.toggleReveal(),
  },
  {
    id: 'view-reveal-next',
    title: 'Reveal the next answer',
    description: 'Show the next hidden answer (→ or a clicker’s Page Down)',
    keywords: ['next', 'reveal next', 'next answer', 'show answer', 'clicker'],
    group: 'View',
    path: 'Reveal bar → Next',
    shortcuts: ['PageDown'],
    when: (ctx) => ctx.revealOn,
    run: (ctx) => ctx.actions.revealStep('next'),
  },
  {
    id: 'view-reveal-back',
    title: 'Hide the last answer again',
    description: 'Take the last revealed answer back (← or a clicker’s Page Up)',
    keywords: ['back', 'previous', 'hide answer', 'unreveal', 'clicker'],
    group: 'View',
    path: 'Reveal bar → Back',
    shortcuts: ['PageUp'],
    when: (ctx) => ctx.revealOn,
    run: (ctx) => ctx.actions.revealStep('back'),
  },
  {
    id: 'view-sidebar',
    title: 'Sidebar',
    label: (ctx) => (ctx.sidebarOpen ? 'Hide the sidebar' : 'Show the sidebar'),
    description: 'The list of curves and their cards',
    keywords: ['sidebar', 'panel', 'list', 'cards', 'hide sidebar', 'show sidebar', 'more room'],
    group: 'View',
    path: 'Toolbar → ▯ (left)',
    shortcuts: ['\\'],
    when: (ctx) => !ctx.presentMode,
    run: (ctx) => ctx.actions.toggleSidebar(),
  },
  {
    id: 'view-zoom-fit',
    title: 'Zoom to fit',
    description: 'Frame everything on the board',
    keywords: ['zoom fit', 'zoom to fit', 'fit', 'frame', 'show everything', 'fit to curves', 'see all', 'auto zoom', 'window'],
    group: 'View',
    path: 'Board corner → ⤢ (Fit to curves)',
    when: always,
    run: (ctx) => ctx.actions.zoomFit(),
  },
  {
    id: 'view-zoom-in',
    title: 'Zoom in',
    description: 'Closer, about the centre of the board',
    keywords: ['zoom in', 'closer', 'magnify', 'bigger', 'enlarge'],
    group: 'View',
    path: 'Board corner → +',
    shortcuts: ['+', '='],
    when: always,
    run: (ctx) => ctx.actions.zoomIn(),
  },
  {
    id: 'view-zoom-out',
    title: 'Zoom out',
    description: 'Further away, about the centre of the board',
    keywords: ['zoom out', 'further', 'smaller', 'wider view'],
    group: 'View',
    path: 'Board corner → −',
    shortcuts: ['-'],
    when: always,
    run: (ctx) => ctx.actions.zoomOut(),
  },
  {
    id: 'view-reset',
    title: 'Reset the view',
    description: 'Back to the origin at the standard scale',
    keywords: ['reset', 'home', 'origin', 'center', 'centre', 'standard window', 'zoom standard', 'zoom reset'],
    group: 'View',
    path: 'Board corner → ⊕ (Reset view)',
    when: always,
    run: (ctx) => ctx.actions.resetView(),
  },
  axisUnit('pi', 'x axis in multiples of π', 'Ticks at π/2, π, 3π/2 … for trig', [
    'π axis', 'pi axis', 'radians', 'multiples of pi', 'multiples of π', 'trig axis', 'pi', 'π', 'pi ticks',
  ]),
  axisUnit('decimal', 'x axis in decimals', 'Ticks at 1, 2, 3 …', ['decimal axis', 'decimals', 'numbers', 'integer ticks', 'plain axis']),
  axisUnit('auto', 'x axis units: automatic', 'π when the curves are trig, decimals otherwise', ['auto axis', 'automatic units', 'axis units']),
  {
    id: 'axis-cycle',
    title: 'Cycle the x-axis units',
    description: 'Auto → π → decimals, one press each',
    keywords: ['cycle axis', 'axis units', 'toggle pi', 'switch units'],
    group: 'View',
    path: 'Download ▾ (caret) → Axis units',
    shortcuts: ['Shift+P'],
    when: (ctx) => graph(ctx) && ctx.axisX !== null,
    run: (ctx) => ctx.actions.cycleAxisX(),
  },
  {
    id: 'grid-polar',
    title: 'Polar grid',
    description: 'Circles of constant r and spokes of constant θ',
    keywords: ['polar grid', 'polar graph paper', 'circles', 'spokes', 'theta', 'ruling'],
    group: 'View',
    path: 'Download ▾ (caret) → Ruling → Polar',
    when: (ctx) => graph(ctx) && ctx.grid !== null && ctx.grid !== 'polar',
    run: (ctx) => ctx.actions.setRuling('polar'),
  },
  {
    id: 'grid-square',
    title: 'Square grid',
    description: 'Back to the square lattice',
    keywords: ['square grid', 'cartesian grid', 'graph paper', 'rectangular', 'ruling'],
    group: 'View',
    path: 'Download ▾ (caret) → Ruling → Square',
    when: (ctx) => graph(ctx) && ctx.grid === 'polar',
    run: (ctx) => ctx.actions.setRuling('cartesian'),
  },
]

export const COMMAND_BY_ID: ReadonlyMap<string, Command> = new Map(COMMANDS.map((c) => [c.id, c]))

/** The title as the board would say it now. */
export function commandLabel(cmd: Command, ctx: CommandContext | null): string {
  if (!ctx || !cmd.label) return cmd.title
  try {
    return cmd.label(ctx)
  } catch {
    return cmd.title
  }
}

// ---------------------------------------------------------------------------
// Availability: run it here, ask "which curve?", grey it out, or hide it
// ---------------------------------------------------------------------------

export type Availability =
  | { state: 'hidden' }
  | { state: 'ready'; targetId?: string }
  | { state: 'pick'; candidates: TargetFacts[] }
  | { state: 'disabled'; reason: string }

/** Every object of one target kind on the board. */
export function targetsOf(ctx: CommandContext, kind: TargetKind): readonly TargetFacts[] {
  switch (kind) {
    case 'curve':
      return ctx.curves
    case 'field':
      return ctx.fields
    case 'sequence':
      return ctx.sequences
    case 'solve':
      return ctx.solves
    case 'shape':
      return ctx.shapes ?? []
  }
}

const TARGET_NOUN: Record<TargetKind, { one: string; first: string }> = {
  curve: { one: 'curve', first: 'Draw or type a curve first' },
  field: { one: 'slope field', first: 'Add a slope field first (type dy/dx = …)' },
  sequence: { one: 'sequence', first: 'Build a sequence first' },
  solve: { one: 'solved inequality', first: 'Type an inequality to solve first' },
  shape: { one: 'figure', first: 'Type a figure first, e.g. ABC = (0,0) (4,0) (4,3)' },
}

/** "curve", "slope field" … — what the picker asks for. */
export function targetNoun(kind: TargetKind): string {
  return TARGET_NOUN[kind].one
}

/**
 * Whether a command is on offer now, and how it would run.
 *
 * A targeted command runs on the SELECTED object when that object is of its
 * kind — and is hidden when that object's menu would not offer it (a Riemann
 * sum on a polar curve). With nothing of its kind selected, it asks "which
 * curve?" among the objects it applies to, or is greyed out with what to do
 * first.
 */
export function availability(cmd: Command, ctx: CommandContext): Availability {
  if (!cmd.when(ctx)) return { state: 'hidden' }
  if (!cmd.target) {
    const why = cmd.blocked?.(ctx) ?? null
    return why ? { state: 'disabled', reason: why } : { state: 'ready' }
  }
  const all = targetsOf(ctx, cmd.target)
  const accepts = (id: string): boolean => (cmd.accepts ? cmd.accepts(ctx, id) : true)
  const sel = ctx.selectedId ? all.find((t) => t.id === ctx.selectedId) : undefined
  if (sel) {
    if (!accepts(sel.id)) return { state: 'hidden' }
    const why = cmd.blocked?.(ctx, sel.id) ?? null
    return why ? { state: 'disabled', reason: why } : { state: 'ready', targetId: sel.id }
  }
  if (all.length === 0) return { state: 'disabled', reason: TARGET_NOUN[cmd.target].first }
  const candidates = all.filter((t) => accepts(t.id) && !(cmd.blocked?.(ctx, t.id) ?? null))
  if (candidates.length === 0) {
    return { state: 'disabled', reason: `No ${TARGET_NOUN[cmd.target].one} on this board takes this` }
  }
  return { state: 'pick', candidates }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** Lower case, accents off, the math glyphs a teacher would type in words. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[′’ʼ]/g, "'")
    .replace(/″/g, "''")
    .replace(/π/g, 'pi')
    .replace(/θ/g, 'theta')
    .replace(/…/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** How well `q` matches `text`: 4 exact, 3 prefix, 2 at a word start, 1 inside, 0 none. */
function matchLevel(q: string, text: string): number {
  if (!q || !text) return 0
  if (text === q) return 4
  if (text.startsWith(q)) return 3
  const at = text.indexOf(q)
  if (at < 0) return 0
  // a word start: after a space or punctuation
  let i = at
  while (i >= 0) {
    if (i === 0 || /[^a-z0-9']/.test(text[i - 1])) return 2
    i = text.indexOf(q, i + 1)
  }
  return 1
}

const TITLE_SCORE = [0, 600, 800, 920, 1000]
const KEYWORD_SCORE = [0, 560, 760, 860, 950]

/** Each word of `text` (for multi-word queries). */
function words(text: string): string[] {
  return text.split(/[^a-z0-9'/^]+/).filter(Boolean)
}

/**
 * How well a query matches a command (0: not at all).
 *
 * The whole query first — the title, then each keyword phrase, then the
 * description — so "area between" and "disk method" land on the command that
 * says exactly that. Failing that, every word must match the start of some
 * word somewhere ("taylor poly", "copy tikz"); failing that, the letters of a
 * single word in order in the title ("tngnt").
 */
export function scoreCommand(cmd: Command, label: string, query: string): number {
  const q = normalize(query)
  if (!q) return 1
  const title = normalize(label)
  const title0 = label === cmd.title ? title : normalize(cmd.title)
  const inTitle = Math.max(matchLevel(q, title), matchLevel(q, title0))
  let best = TITLE_SCORE[inTitle]
  for (const k of cmd.keywords) best = Math.max(best, KEYWORD_SCORE[matchLevel(q, normalize(k))])
  // a keyword hit on a command that also SAYS the word in its title wins the tie
  if (best > TITLE_SCORE[inTitle] && inTitle >= 2) best += 20
  if (best > 0) return best
  const desc = normalize(cmd.description)
  const dl = matchLevel(q, desc)
  if (dl >= 2) return 300
  // every word somewhere
  const tokens = q.split(' ').filter(Boolean)
  if (tokens.length > 1) {
    const titleWords = words(title)
    const kwWords = cmd.keywords.flatMap((k) => words(normalize(k)))
    const descWords = words(desc)
    let sum = 0
    for (const t of tokens) {
      const s = titleWords.some((w) => w.startsWith(t))
        ? 100
        : kwWords.some((w) => w.startsWith(t))
          ? 80
          : descWords.some((w) => w.startsWith(t))
            ? 40
            : normalize(cmd.group).startsWith(t)
              ? 30
              : 0
      if (s === 0) return 0
      sum += s
    }
    return 200 + Math.round(sum / tokens.length)
  }
  // the letters in order, in the title
  const compact = q.replace(/\s/g, '')
  if (compact.length >= 4) {
    let i = 0
    let gaps = 0
    let last = -1
    let first = -1
    for (let j = 0; j < title.length && i < compact.length; j++) {
      if (title[j] === compact[i]) {
        if (last >= 0 && j > last + 1) gaps++
        if (first < 0) first = j
        last = j
        i++
      }
    }
    // starting at the start of a word reads as an abbreviation; mid-word does not
    const wordStart = first === 0 || /[^a-z0-9]/.test(title[first - 1] ?? ' ')
    if (i === compact.length && gaps <= 3) return 120 - gaps * 15 - (wordStart ? 0 : 10)
  }
  return 0
}

/** A row of the palette. */
export interface PaletteRow {
  cmd: Command
  label: string
  /** The heading it is listed under: a group, or 'Recent'. */
  heading: CommandGroup | 'Recent'
  avail: Exclude<Availability, { state: 'hidden' }>
  score: number
}

/** How much a recent command is lifted, by its place in the list (most recent first). */
function recentBoost(recent: readonly string[], id: string): number {
  const i = recent.indexOf(id)
  return i < 0 ? 0 : Math.max(4, 30 - i * 3)
}

/** How many recent commands head the palette before anything is typed. */
export const RECENT_SHOWN = 5

/**
 * The palette's rows for a query, in order.
 *
 * Nothing typed: the recent commands first (under "Recent"), then every group
 * in GROUP_ORDER, each in registry order. Something typed: ranked by score
 * (recency lifts a tie; a greyed-out command sinks below one that can run),
 * and then gathered under their group headings — the groups ordered by their
 * best row, so the first row is always the best match.
 */
export function paletteRows(ctx: CommandContext, query: string, recent: readonly string[] = []): PaletteRow[] {
  const live: { cmd: Command; label: string; avail: PaletteRow['avail']; order: number }[] = []
  COMMANDS.forEach((cmd, order) => {
    if (cmd.hideInPalette) return
    const avail = availability(cmd, ctx)
    if (avail.state === 'hidden') return
    live.push({ cmd, label: commandLabel(cmd, ctx), avail, order })
  })
  if (!normalize(query)) {
    const rows: PaletteRow[] = []
    const seen = new Set<string>()
    for (const id of recent) {
      if (rows.length >= RECENT_SHOWN) break
      const r = live.find((x) => x.cmd.id === id)
      if (!r || r.avail.state === 'disabled') continue
      rows.push({ cmd: r.cmd, label: r.label, heading: 'Recent', avail: r.avail, score: 0 })
      seen.add(id)
    }
    for (const g of GROUP_ORDER) {
      for (const r of live) {
        if (r.cmd.group !== g || seen.has(r.cmd.id)) continue
        rows.push({ cmd: r.cmd, label: r.label, heading: g, avail: r.avail, score: 0 })
      }
    }
    return rows
  }
  const scored = live
    .map((r) => {
      const s = scoreCommand(r.cmd, r.label, query)
      return { ...r, score: s > 0 ? s + recentBoost(recent, r.cmd.id) - (r.avail.state === 'disabled' ? 45 : 0) : 0 }
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
  const groups: CommandGroup[] = []
  for (const r of scored) if (!groups.includes(r.cmd.group)) groups.push(r.cmd.group)
  const rows: PaletteRow[] = []
  for (const g of groups) {
    for (const r of scored) {
      if (r.cmd.group === g) rows.push({ cmd: r.cmd, label: r.label, heading: g, avail: r.avail, score: r.score })
    }
  }
  return rows
}

/** The recent list after running `id`: it moves to the front; the list is capped. */
export function pushRecent(recent: readonly string[], id: string, max = 8): string[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, max)
}

/** Filter the "which curve?" list by what is typed: name or equation. */
export function filterTargets(targets: readonly TargetFacts[], query: string): TargetFacts[] {
  const q = normalize(query)
  if (!q) return targets.slice()
  return targets.filter((t) => normalize(t.name).includes(q) || normalize(t.text).includes(q))
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/**
 * Keys the App uses that belong to no command — gestures and modes, listed in
 * the help sheet beside the commands' own keys. A command shortcut must never
 * be one of these.
 */
export const RESERVED_KEYS: readonly { keys: string; what: string }[] = [
  { keys: 'Space', what: 'Hold and drag to pan the board' },
  { keys: 'ArrowLeft', what: 'Nudge the selected curve 0.1 (with Shift: 1); on the focused board with nothing selected, pan' },
  { keys: 'ArrowRight', what: 'Nudge the selected curve 0.1 (with Shift: 1); in reveal mode, the next answer' },
  { keys: 'ArrowUp', what: 'Nudge the selected curve up' },
  { keys: 'ArrowDown', what: 'Nudge the selected curve down' },
  { keys: 'Escape', what: 'Close a box, cancel a pick, leave presentation mode; on the focused board, let go of the selected curve' },
  { keys: 'Alt', what: 'Hold while dragging to skip snapping' },
  { keys: 'Tab', what: 'On the focused board with a curve selected: the next handle (Shift+Tab: the previous); arrows then move it' },
  { keys: 'Enter', what: 'On a focused handle: type its exact value; on a card: select its curve' },
]

/**
 * A key spec's parts: modifiers, then the key. '+' joins them, and a '+' with
 * nothing after it IS the key ('+', 'Shift++'), so the plus key can be named.
 */
export function keyParts(spec: string): string[] {
  return spec.split(/\+(?=.)/)
}

/** A key spec in canonical form ('Shift+Mod+Z'), for comparing. */
export function canonicalKey(spec: string): string {
  const parts = keyParts(spec)
  const key = parts.pop() ?? ''
  const mods = parts.map((m) => m.trim()).sort()
  return [...mods, key.length === 1 ? key.toUpperCase() : key].join('+')
}

/** Is this a Mac (⌘) or everything else (Ctrl)? */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return true
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const p = nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent ?? ''
  return /mac|iphone|ipad|ipod/i.test(p)
}

const KEY_GLYPHS: Record<string, string> = {
  PageDown: 'Page Down',
  PageUp: 'Page Up',
  Delete: 'Delete',
  Backspace: '⌫',
  Escape: 'Esc',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
}

/** A key spec as a person reads it: ⌘K / Ctrl+K, ⇧P / Shift+P. */
export function formatShortcut(spec: string, mac: boolean = isMacPlatform()): string {
  const parts = keyParts(spec)
  const key = parts.pop() ?? ''
  const shown = KEY_GLYPHS[key] ?? (key.length === 1 ? key.toUpperCase() : key)
  const mods = parts.map((m) => {
    if (m === 'Mod') return mac ? '⌘' : 'Ctrl+'
    if (m === 'Shift') return mac ? '⇧' : 'Shift+'
    if (m === 'Alt') return mac ? '⌥' : 'Alt+'
    return `${m}+`
  })
  // ⇧ before ⌘ is the Mac order; Ctrl+Shift+ elsewhere
  const order = mac ? mods : mods.slice().sort((a, b) => (a.startsWith('Ctrl') ? -1 : b.startsWith('Ctrl') ? 1 : 0))
  return `${order.join('')}${shown}`
}

/** Does a keydown match a key spec? 'Mod' is ⌘ on a Mac and Ctrl elsewhere (either is accepted). */
export function matchesKey(
  e: { key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean },
  spec: string,
): boolean {
  const parts = keyParts(spec)
  const key = parts.pop() ?? ''
  const wantMod = parts.includes('Mod')
  const wantShift = parts.includes('Shift')
  const mod = !!(e.metaKey || e.ctrlKey)
  if (mod !== wantMod) return false
  if (!!e.altKey !== parts.includes('Alt')) return false
  if (key.length === 1 && /[a-z]/i.test(key)) {
    if (!!e.shiftKey !== wantShift) return false
    return e.key.toLowerCase() === key.toLowerCase()
  }
  // punctuation ('?', '/') is already shifted by the layout
  if (wantShift && !e.shiftKey) return false
  return e.key === key
}

// ---------------------------------------------------------------------------
// The help sheet's map: courses and units → commands
// ---------------------------------------------------------------------------

/** One line of the help sheet: a command (title, path and keys from the registry) or a static line. */
export type HelpEntry =
  | { id: string; note?: string }
  | { title: string; text: string; how: string; keys?: string }

export interface HelpSection {
  id: string
  /** The course it belongs to, as a heading above its units. */
  course: string
  title: string
  entries: readonly HelpEntry[]
}

export const HELP_COURSES: readonly string[] = [
  'AP Calculus AB / BC',
  'AP Precalculus',
  'NC Math 1',
  'NC Math 2',
  'NC Math 3',
  'Drawing & editing',
  'Exports & worksheets',
  'In class',
]

export const HELP_SECTIONS: readonly HelpSection[] = [
  // ---------------------------------------------------- AP Calculus
  { id: 'calc-1', course: 'AP Calculus AB / BC', title: 'Unit 1 · Limits and continuity', entries: [
    { id: 'calc-limit', note: 'One- and two-sided limits, a table of values, ε–δ, limits at ±∞' },
    { id: 'view-analysis', note: 'Holes, jumps and asymptotes marked on the graph' },
    { id: 'build-piecewise', note: 'Build a piecewise function to test continuity at a seam' },
  ] },
  { id: 'calc-2', course: 'AP Calculus AB / BC', title: 'Unit 2 · Differentiation: definition and basic rules', entries: [
    { id: 'calc-secant', note: 'Average rate of change → the difference quotient' },
    { id: 'calc-tangent' },
    { id: 'calc-derivative' },
  ] },
  { id: 'calc-3', course: 'AP Calculus AB / BC', title: 'Unit 3 · Composite, implicit and inverse functions', entries: [
    { id: 'calc-tangent', note: 'On an implicit curve (x² + y² = 25): dy/dx by implicit differentiation' },
    { id: 'show-inverse', note: 'f⁻¹ by reflection; compare slopes at reflected points' },
  ] },
  { id: 'calc-4', course: 'AP Calculus AB / BC', title: 'Unit 4 · Contextual applications of differentiation', entries: [
    { id: 'build-related-rates' },
    { id: 'calc-tangent', note: 'Local linearity and linear approximation' },
    { id: 'calc-pcalc', note: 'Motion along a curve: velocity and speed' },
  ] },
  { id: 'calc-5', course: 'AP Calculus AB / BC', title: 'Unit 5 · Analytical applications of differentiation', entries: [
    { id: 'calc-secant', note: 'The Mean Value Theorem point c' },
    { id: 'calc-signchart', note: 'Increasing / decreasing, concavity, the first and second derivative tests' },
    { id: 'view-analysis', note: 'Extrema and inflection points on the graph' },
  ] },
  { id: 'calc-6', course: 'AP Calculus AB / BC', title: 'Unit 6 · Integration and accumulation of change', entries: [
    { id: 'calc-riemann' },
    { id: 'calc-area' },
    { id: 'calc-accumulation' },
  ] },
  { id: 'calc-7', course: 'AP Calculus AB / BC', title: 'Unit 7 · Differential equations', entries: [
    { id: 'build-slope-field' },
    { id: 'field-euler', note: 'Step along the slope field with step h; the table of steps (BC)' },
    { id: 'build-logistic', note: 'Logistic growth from L, k and y(0) (BC)' },
    { id: 'build-exp', note: 'Exponential models: dy/dt = ky' },
  ] },
  { id: 'calc-8', course: 'AP Calculus AB / BC', title: 'Unit 8 · Applications of integration', entries: [
    { id: 'calc-secant', note: 'Average value of a function on [a, b]' },
    { id: 'calc-between' },
    { id: 'calc-volume' },
  ] },
  { id: 'calc-9', course: 'AP Calculus AB / BC', title: 'Unit 9 · Parametric, polar and vector-valued functions (BC)', entries: [
    { id: 'build-motion' },
    { id: 'calc-pcalc' },
    { id: 'calc-polarbetween' },
    { id: 'grid-polar' },
  ] },
  { id: 'calc-10', course: 'AP Calculus AB / BC', title: 'Unit 10 · Infinite sequences and series (BC)', entries: [
    { id: 'build-seq' },
    { id: 'seq-sums' },
    { id: 'seq-series' },
    { id: 'calc-taylor', note: 'Taylor and Maclaurin polynomials, the Lagrange error bound' },
  ] },
  // ---------------------------------------------------- AP Precalculus
  { id: 'pc-1', course: 'AP Precalculus', title: 'Unit 1 · Polynomial and rational functions', entries: [
    { id: 'calc-secant', note: 'Average rate of change over an interval' },
    { id: 'build-roots', note: 'Polynomials from zeros and multiplicities; rationals with asymptotes and holes' },
    { id: 'build-transform' },
    { id: 'view-analysis', note: 'Zeros, extrema, inflection points, end behaviour' },
    { id: 'build-data', note: 'Regression models from data' },
  ] },
  { id: 'pc-2', course: 'AP Precalculus', title: 'Unit 2 · Exponential and logarithmic functions', entries: [
    { id: 'build-seq', note: 'Arithmetic and geometric sequences' },
    { id: 'build-exp' },
    { id: 'build-log' },
    { id: 'show-inverse' },
    { id: 'domain-restrict', note: 'Restrict the domain to make an inverse a function' },
    { id: 'build-data', note: 'Exponential and logarithmic regression' },
  ] },
  { id: 'pc-3', course: 'AP Precalculus', title: 'Unit 3 · Trigonometric and polar functions', entries: [
    { id: 'build-unit-circle' },
    { id: 'build-sin' },
    { id: 'axis-pi' },
    { id: 'build-motion', note: 'Polar curves r = f(θ)' },
    { id: 'grid-polar' },
  ] },
  // ---------------------------------------------------- NC Math 3
  { id: 'm3-functions', course: 'NC Math 3', title: 'Functions, inverses and transformations', entries: [
    { id: 'build-transform' },
    { id: 'domain-range' },
    { id: 'hlt' },
    { id: 'show-inverse' },
    { id: 'domain-restrict' },
  ] },
  { id: 'm3-poly', course: 'NC Math 3', title: 'Polynomial and rational functions', entries: [
    { id: 'build-roots' },
    { id: 'curve-remainder', note: 'Synthetic division by (x − a), exact with a fraction a: f(a) = remainder, and (x − a) is a factor when it is 0 (A-APR.2)' },
    { id: 'view-analysis' },
    { id: 'nl-solve', note: 'Polynomial and rational inequalities, with a sign chart' },
  ] },
  { id: 'm3-explog', course: 'NC Math 3', title: 'Exponential and logarithmic functions', entries: [
    { id: 'build-exp' },
    { id: 'build-log' },
    { id: 'build-data' },
    { id: 'curve-compare', note: 'Compare two functions given different ways, and show an exponential eventually exceeds a polynomial (F-IF.9, F-LE.3)' },
  ] },
  { id: 'm3-trig', course: 'NC Math 3', title: 'Trigonometric functions', entries: [
    { id: 'build-unit-circle' },
    { id: 'build-sin' },
    { id: 'axis-pi' },
  ] },
  // ---------------------------------------------------- NC Math 1
  { id: 'm1-functions', course: 'NC Math 1', title: 'Functions: notation, domain, piecewise and comparing (F-IF.1, 2, 5, 9; F-LE.3)', entries: [
    { id: 'curve-evaluate', note: 'Function notation: f(2.5), f(−1/3), f(−3) + g(2) — the exact value, its decimal, and the point on the graph (F-IF.2)' },
    { id: 'curve-table', note: 'A table from a start by a step (0.5, π/6) or a list; Δy constant means linear, the ratio constant means exponential (F-LE.1)' },
    { id: 'curve-compare', note: 'Two functions side by side; where an exponential passes a linear or quadratic one and stays ahead (F-IF.9, F-LE.3)' },
    { id: 'domain-range', note: 'Domain and range in interval notation or set-builder (F-IF.1, F-IF.5)' },
    { id: 'build-piecewise', note: 'Piece by piece, with open and closed dots where the pieces meet' },
    { id: 'build-transform', note: 'Absolute value a|x − h| + k: the vertex, and the V of the parent |x| as a ghost' },
    { title: 'Table to data', text: 'Turn the table into a data table for a scatter plot or a regression', how: 'Curve card → Table → Copy to a data table' },
  ] },
  { id: 'm1-linexp', course: 'NC Math 1', title: 'Linear and exponential functions, sequences (F-IF.3, 6; F-BF.2; F-LE.1, 2, 5)', entries: [
    { id: 'build-segment', note: 'The line through two points: its slope, and y = mx + b from Equation on its card (F-LE.2)' },
    { id: 'build-exp', note: 'y = a·bˣ from a starting value and a growth or decay rate, or through two points (F-LE.2, F-LE.5)' },
    { id: 'curve-table', note: 'Equal steps in x: Δy constant for a linear function, the ratio constant for an exponential one (F-LE.1)' },
    { id: 'calc-secant', note: 'Average rate of change over an interval, as the slope of the secant (F-IF.6)' },
    { id: 'build-seq', note: 'Arithmetic and geometric sequences, explicit and recursive, with the linear or exponential function behind the dots drawn dashed (F-IF.3, F-BF.2)' },
    { id: 'view-analysis', note: 'Intercepts and asymptotes marked on the graph (F-IF.4)' },
  ] },
  { id: 'm1-quad', course: 'NC Math 1', title: 'Quadratic functions (F-IF.4, 7, 8; A-SSE.3)', entries: [
    { id: 'view-analysis', note: 'The vertex (maximum or minimum), the zeros and the y-intercept marked on the graph (F-IF.4)' },
    { id: 'build-transform', note: 'Vertex form a(x − h)² + k; a quadratic typed in standard form is read in vertex form on its card' },
    { id: 'build-roots', note: 'Factored form from the zeros; a typed (x − 4)(x + 2) is read back as its roots on the card (A-SSE.3)' },
    { id: 'curve-table', note: 'Δ²y is constant: the table of a quadratic' },
    { id: 'domain-range' },
  ] },
  { id: 'm1-systems', course: 'NC Math 1', title: 'Equations, inequalities and systems (A-REI.3, 6, 10–12)', entries: [
    { title: 'Intersections', text: 'Where two graphs meet, exact where it can be: the solution of a system of equations (A-REI.6, A-REI.11)', how: 'Type both equations: the points are marked on the board and listed on each curve’s card' },
    { id: 'build-inequality', note: 'y > 2x − 3: the boundary dashed for < and >, solid for ≤ and ≥; several at once shade the solution of the system, with a test point (A-REI.12)' },
    { id: 'nl-solve', note: 'Linear and absolute value inequalities in one variable, the solution on a number line (A-REI.3)' },
  ] },
  { id: 'm1-coord', course: 'NC Math 1', title: 'Coordinate geometry: distance, midpoint, slope, polygons (G-GPE.4–6)', entries: [
    { id: 'build-segment', note: 'AB = (1,2) (4,6): the exact length, the midpoint and the slope (G-GPE.6)' },
    { id: 'build-shape', note: 'Side lengths and slopes, perimeter and area (shoelace), and what the figure is with the reason: “AB ∥ DC and AD ∥ BC, so ABCD is a parallelogram” (G-GPE.4)' },
    { id: 'build-parallel-line', note: 'The line through a point parallel or perpendicular to a side: equal slopes, or opposite reciprocals (G-GPE.5)' },
  ] },
  { id: 'm1-stats', course: 'NC Math 1', title: 'Statistics: one-variable data (S-ID.1–3)', entries: [
    { id: 'build-data-plot', note: 'Paste a list for a dot plot or histogram (bin width editable) and a box plot with outliers as separate points (S-ID.1)' },
    { id: 'build-data-plot', note: 'Paste two or more sets: parallel box plots, a table of mean, median, SD, IQR, and the sentence comparing centre and spread (S-ID.2)' },
    { id: 'build-data-plot', note: 'Shape (roughly symmetric / skewed) and which measures fit it: median and IQR for skewed data or outliers, mean and SD otherwise' },
    { id: 'build-data-plot', note: 'Outliers by the 1.5·IQR fences: leave them out, or click dots, and compare before and after (S-ID.3)' },
  ] },
  { id: 'm1-bivariate', course: 'NC Math 1', title: 'Statistics: two-variable data (S-ID.6–9)', entries: [
    { id: 'build-data', note: 'Paste (x, y) data for a scatter plot, then Regression ▾ → Linear for the line of best fit (S-ID.6a)' },
    { title: 'Residual plot', text: 'Residuals vs x under the scatter plot, the residuals in the table, and whether a linear model appears appropriate (S-ID.6b)', how: 'Data table → select a regression → residual plot' },
    { id: 'build-data', note: 'Regression ▾ → Exponential for data that grows by a factor (S-ID.6c)' },
    { title: 'Correlation coefficient', text: 'r and its meaning in words — strong / moderate / weak, positive / negative — and that correlation is not causation (S-ID.8, S-ID.9)', how: 'Data table → Regression ▾ → Linear' },
  ] },
  // ---------------------------------------------------- NC Math 2
  { id: 'm2-quad', course: 'NC Math 2', title: 'Quadratics: forms, equations and systems (F-IF.7, 8; A-SSE.3; A-REI.4, 7)', entries: [
    { id: 'build-transform', note: 'Vertex form a(x − h)² + k; a quadratic typed in standard form is read in vertex form on its card (completing the square, A-SSE.3)' },
    { id: 'build-roots', note: 'Factored form: the zeros and their multiplicities; a typed (x − 4)(x + 2) is read back as its roots (F-IF.8)' },
    { id: 'view-analysis', note: 'Vertex, zeros and y-intercept on the graph — the solutions of f(x) = 0 (A-REI.4)' },
    { title: 'Line and parabola', text: 'Type the parabola and the line: their intersections — none, one or two — are marked, exact where they can be (A-REI.7)', how: 'Each curve’s card → Intersection' },
    { id: 'nl-solve', note: 'Quadratic inequalities such as x² − 2x − 3 ≤ 0, with critical values and a sign chart (A-CED.1)' },
  ] },
  { id: 'm2-radical', course: 'NC Math 2', title: 'Square root and inverse variation functions (F-IF.7, F-BF.3)', entries: [
    { id: 'build-transform', note: 'Square root a√(x − h) + k and inverse variation a/(x − h) + k from the parent gallery, with the parent ghost and its key points mapped' },
    { id: 'domain-range', note: 'Domain and range: √(x + 3) needs x ≥ −3; 12/x is undefined at x = 0' },
    { id: 'view-analysis', note: 'The asymptotes of y = k/x and the intercepts' },
    { id: 'curve-table', note: 'A list of x’s (1, 2, 3, 4, 6, 12) for y = 12/x: double x and y halves' },
  ] },
  { id: 'm2-functions', course: 'NC Math 2', title: 'Functions: transformations and comparing representations (F-BF.3, F-IF.9)', entries: [
    { id: 'build-transform', note: 'a·f(b(x − h)) + k: the steps in order, the parent as a ghost and each key point’s image (F-BF.3)' },
    { id: 'duplicate-curve', note: 'A copy of f to transform beside the original' },
    { id: 'curve-table', note: 'A quadratic’s table: Δ²y is constant; a table on the figure for a worksheet' },
    { id: 'curve-compare', note: 'A quadratic beside a linear or exponential function, given by equation, graph or table' },
    { id: 'curve-evaluate' },
  ] },
  { id: 'm2-xform', course: 'NC Math 2', title: 'Transformations, congruence and similarity (G-CO.2–8, G-SRT.1–3)', entries: [
    { id: 'build-shape', note: 'Type the figure: ABC = (1,2) (4,2) (4,6)' },
    { id: 'shape-transform', note: 'Translate, reflect, rotate or dilate it: a linked image A′B′C′ with R_{90°, O}: (x, y) → (−y, x), rigid or not, and ✓ for what is preserved' },
    { id: 'shape-transform', note: 'Chain them: transform the image to get A″B″C″ and the composite rule; or type reflect A′B′C′ across y = x' },
    { id: 'shape-compare', note: 'Congruent or similar, the motion that maps one onto the other, and SSS / SAS / ASA / AAS / HL or AA / SAS~ / SSS~ (never SSA)' },
    { id: 'shape-symmetry', note: 'The lines of symmetry and the rotation symmetry of a triangle, quadrilateral or regular polygon' },
  ] },
  { id: 'm2-centres', course: 'NC Math 2', title: 'Centres of triangles (G-CO.10)', entries: [
    { id: 'shape-centres', note: 'Centroid G where the medians meet, exact: ((x₁ + x₂ + x₃)/3, (y₁ + y₂ + y₃)/3); G is two-thirds of the way along each median' },
    { id: 'shape-centres', note: 'Circumcentre O where the perpendicular bisectors meet, with the circle through the vertices and R exact; on a right triangle it is the midpoint of the hypotenuse' },
    { id: 'shape-centres', note: 'Incentre I where the angle bisectors meet, with the inscribed circle and r = Area ÷ s' },
    { id: 'shape-centres', note: 'Orthocentre H where the altitudes meet — outside an obtuse triangle, the altitudes extended; drag a vertex and watch O and H leave' },
    { id: 'shape-centres', note: 'The Euler line through O, G and H with HG = 2·GO; an equilateral triangle has all four centres in one point' },
  ] },
  { id: 'm2-trig', course: 'NC Math 2', title: 'Right triangle trigonometry (G-SRT.6–8, 12)', entries: [
    { id: 'build-shape', note: 'ABC = (0,0) (4,0) (4,3): the right angle, 4² + 3² = 5², and sin, cos and tan of each acute angle as side ratios (G-SRT.6–8)' },
    { id: 'build-shape', note: 'A 45-45-90 or 30-60-90 triangle is recognised, with its side ratio (G-SRT.12)' },
    { id: 'shape-compare', note: 'Two right triangles with an equal acute angle are similar (AA), so their trig ratios match (G-SRT.6)' },
  ] },
  { id: 'm2-prob', course: 'NC Math 2', title: 'Probability (S-CP.1, 3–8)', entries: [
    { id: 'build-probability', note: 'Two-way table: type the counts; the totals, P(A and B), P(A), P(B) and P(A | B) as the fraction of B’s outcomes, with B’s column and the cell highlighted (S-CP.3a, 6)' },
    { id: 'build-probability', note: 'Independent? P(A | B) against P(A) and P(A and B) against P(A)·P(B), with a verdict about the sample (S-CP.3b, 5)' },
    { id: 'build-probability', note: 'Joint, row and column percentages (Show → Joint % / Row % / Column %)' },
    { id: 'build-probability', note: 'Venn diagram: two or three sets; shade A ∪ B, A ∩ Bᶜ, (A ∪ B)ᶜ … and read P by the Addition Rule P(A ∪ B) = P(A) + P(B) − P(A ∩ B) (S-CP.1, 7)' },
    { id: 'build-probability', note: 'Tree diagram: draw 2 from 3 red and 2 blue with or without replacement, or type the stages; path products by the Multiplication Rule and an event as a sum of paths (S-CP.4, 8)' },
  ] },
  { id: 'm3-geo', course: 'NC Math 3', title: 'Circles, conics and shapes', entries: [
    { id: 'build-conic', note: 'Type x² + y² − 4x + 6y − 3 = 0: the Conic section completes the square step by step to (x − 2)² + (y + 3)² = 16 (G-GPE.1)' },
    { id: 'circle-angles', note: 'Points on the circle typed as angles (30°, pi/6) or points: ∠PRQ = ½·∠POQ on the arc PQ, and 90° on a diameter (G-C.2)' },
    { id: 'circle-tangent', note: 'The tangent at P ⟂ the radius OP, with its equation; tangents from an outside point are equal, TA² = TP·TP′ for a secant, and PE·EQ = RE·ES for crossing chords (G-C.2)' },
    { id: 'circle-sector', note: 'θ = 2π/3 on r = 6: s = rθ = 4π and A = ½r²θ = 12π, and the same as (120/360)·2πr — radians as arc per unit of radius (G-C.5)' },
    { id: 'shape-centres', note: 'A triangle’s centroid, circumcentre, incentre and orthocentre, for proofs with coordinates (G-CO.14)' },
    { id: 'build-shape' },
  ] },
  { id: 'm3-ineq', course: 'NC Math 3', title: 'Equations, inequalities and systems', entries: [
    { id: 'nl-solve' },
    { id: 'doc-new-nl' },
    { id: 'build-inequality' },
    { id: 'build-piecewise' },
  ] },
  { id: 'm3-stats', course: 'NC Math 3', title: 'Statistics: normal distributions and simulation', entries: [
    { id: 'build-normal', note: 'Shade P(a < X < b), read the z-scores, find the value for a percentile; drag the peak for μ and a shoulder for σ' },
    { id: 'build-normal', note: 'The empirical rule: μ ± σ, 2σ, 3σ with 68%, 95%, 99.7% (Show → empirical rule)' },
    { id: 'build-simulation', note: 'Sample means or proportions, n × samples, with σ/√n, the margin of error and an interval estimate' },
    { id: 'build-simulation', note: 'Compare treatments: paste two groups, re-randomise, read the p-value and the conclusion' },
  ] },
  // ---------------------------------------------------- Drawing & editing
  { id: 'draw', course: 'Drawing & editing', title: 'On the board', entries: [
    { title: 'Draw a curve', text: 'Each stroke becomes a live equation: a line, a parabola, a sine, a circle, a rose…', how: 'Draw with a finger, pen or mouse' },
    { title: 'Select', text: 'Selecting a curve shows its handles and its card', how: 'Tap the curve; tap empty board to deselect' },
    { title: 'Reshape', text: 'Drag a handle (vertex, zero, peak) to change the equation', how: 'Drag a handle; hold Alt to skip snapping' },
    { title: 'Type an exact value', text: 'Set a handle or a coefficient to an exact number', how: 'Double-click the handle, or click the number on the card' },
    { title: 'Redraw over it', text: 'Draw near the selected curve to re-fit it to the new stroke', how: 'Draw over the selected curve' },
    { title: 'Pan and zoom', text: 'Move and scale the board', how: 'Space-drag, middle-drag or two fingers; pinch or the wheel to zoom', keys: 'Space' },
    { title: 'Nudge', text: 'Move the selected curve by 0.1 (with Shift, by 1)', how: 'Arrow keys', keys: '← → ↑ ↓' },
    { title: 'Another reading', text: 'The same stroke read as another family (cubic, sine, exponential…)', how: 'Curve card → Read as (a sketched curve)' },
    { title: 'Name a curve', text: 'Rename f to g; every line that calls it follows', how: 'Click the name chip on the card' },
  ] },
  { id: 'edit', course: 'Drawing & editing', title: 'Equations and cards', entries: [
    { id: 'type-equation' },
    { id: 'duplicate-curve' },
    { id: 'toggle-visible' },
    { id: 'delete-selected' },
    { id: 'undo' },
    { id: 'redo' },
    { title: 'Line style', text: 'Width, dashes, opacity; arrows, open or closed dots at the ends', how: 'Curve ⋯ → Line / Ends' },
    { title: 'Use one curve in another', text: 'g(x) = 2f(x − 1) + 3 follows f as f changes', how: 'Type it in the + box' },
  ] },
  // ---------------------------------------------------- Exports & worksheets
  { id: 'export', course: 'Exports & worksheets', title: 'Figures', entries: [
    { id: 'export-download' },
    { id: 'export-copy' },
    { id: 'export-pdf' },
    { id: 'export-tikz' },
    { id: 'export-pgfplots' },
    { id: 'export-copy-latex' },
    { id: 'style-textbook' },
    { id: 'style-sat' },
    { id: 'style-ap' },
    { id: 'style-preview' },
    { title: 'Size, margin, caption, window', text: 'Width, aspect, framing, the caption under the figure, the TI window', how: 'Download ▾ (caret)' },
  ] },
  { id: 'itembank', course: 'Exports & worksheets', title: 'AP item bank', entries: [
    { id: 'export-item-bank', note: 'AP item bank: copy a figure — a ready-to-paste %%% figure=tikz block with its figuredesc, student or key, in house style' },
    { id: 'doc-graph-from-item', note: 'Graph from an item — paste a stem or a %%% ITEM record; “graph of f′ is shown”, intervals and domains are read for you' },
  ] },
  { id: 'docs', course: 'Exports & worksheets', title: 'Documents and worksheets', entries: [
    { id: 'doc-examples' },
    { id: 'doc-worksheet' },
    { id: 'doc-new-graph' },
    { id: 'doc-new-nl' },
    { id: 'doc-duplicate' },
    { id: 'doc-backup' },
    { id: 'doc-import' },
  ] },
  // ---------------------------------------------------- In class
  { id: 'class', course: 'In class', title: 'Presentation, reveal and sharing', entries: [
    { id: 'view-present' },
    { id: 'view-reveal' },
    { id: 'view-reveal-next' },
    { id: 'view-reveal-back' },
    { id: 'doc-share' },
    { id: 'view-theme' },
    { id: 'view-analysis' },
    { id: 'view-zoom-fit' },
    { id: 'view-sidebar' },
    { id: 'palette' },
  ] },
  { id: 'a11y', course: 'In class', title: 'Accessibility', entries: [
    { id: 'view-describe', note: 'The board in words for a screen reader — copy it as alt text for a worksheet or an LMS' },
    { id: 'view-colour-safe', note: 'For colour-vision deficiency: Okabe–Ito colours, a dash pattern per curve, on screen and on paper' },
    { title: 'Keyboard only', text: 'Everything is reachable without a mouse', how: 'Tab to “Skip to board”; Tab onto the board; arrows pan; + / − zoom; select a curve on its card with Enter; on the board Tab steps through its handles, arrows move one (Shift: further), Enter types an exact value', keys: 'Tab' },
    { title: 'Bigger and calmer', text: 'Presentation mode for large type; the system’s reduced-motion setting stops the animations', how: 'F, or Toolbar → ▭' },
  ] },
]

/** The keyboard section of the help sheet: every command with a key, in registry order. */
export function shortcutRows(): { id: string; title: string; keys: readonly string[] }[] {
  return COMMANDS.filter((c) => c.shortcuts && c.shortcuts.length > 0).map((c) => ({
    id: c.id,
    title: c.title,
    keys: c.shortcuts ?? [],
  }))
}

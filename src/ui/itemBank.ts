// ============================================================================
// src/ui/itemBank.ts — the bridge between Grapher and the AP item bank.
//
// The teacher's bank (bank.tex) is append-only LaTeX: one record per item,
// delimited by `%%%` lines —
//
//   %%% ITEM AB-0044
//   %%% status=captured secure=true
//   %%% figure=needed            ← none | needed | described | tikz
//   %%% figuredesc=<free text>   ← only when figure=described
//   \begin{stem} … \end{stem}
//   %%% END
//
// Two directions, both pure (no React, no DOM, no storage):
//
//   Grapher → bank   bankFigure(model, options): the document's figure as a
//                    ready-to-paste block — `%%% figure=tikz`, `%%% figuredesc=`
//                    (always the STUDENT description: a figuredesc is what a
//                    student who cannot see the figure is told), a comment
//                    naming the preamble, and the picture centred. The figure
//                    is drawn by docScene's docFigure, the worksheet's student
//                    / key path, so a bank figure is the figure the document's
//                    own Download makes. HOUSE STYLE (on by default) forces
//                    the bank's rules: grayscale ink, curves told apart by
//                    dash pattern rather than colour, named axes with a scale,
//                    and at least one labelled point — when the student figure
//                    has none, one neutral point is labelled (never a zero, an
//                    extremum or an inflection point: that would be an answer).
//
//   bank → Grapher   planItem(src) reads a stem or a whole record with
//                    importFromLatex and decides what to graph — "the graph of
//                    f′ is shown" with only f defined becomes f′ (the
//                    derivative link) with f hidden — and the window the
//                    interval hint asks for. buildItemDoc(plan) writes it as a
//                    stored document through the examples' builder, the same
//                    construction path the App takes, in the AP figure style.
// ============================================================================

import type { FigureStyle, FigureStyleId, FittedCurve, ModelSpec, Shape, SpecialPoint, Vec2 } from '../core/types'
import { FIGURE_STYLES, ppuX, ppuY } from '../core/types'
import type { CurveStyle, StyleMap } from '../core/persist'
import { docFromBoard, serializeDoc } from '../core/persist'
import { analyzeCurve } from '../core/analyze'
import type { ImportedDefinition, LatexImport } from '../core/latexImport'
import { importFromLatex } from '../core/latexImport'
import type { AdapterCurve, AdapterInput } from '../core/describeAdapters'
import { describeCurves } from '../core/describeAdapters'
import type { DescribeExtra, DescribeWindow } from '../core/describeGraph'
import { fmt } from '../core/describeGraph'
import { formatPiTick, pickPiTickStep, pickTickStep, PI_LABEL_MIN_PX, UNIT_MIN_PX } from '../render/grid'
import { toTikz } from '../render/vectorTikz'
import { texLabel } from '../render/texText'
import { ExampleBoard } from '../examples/builder'
import type { ExampleWindow } from '../examples/builder'
import type { BoardScene } from './renderBoard'
import type { DocModel } from './docScene'
import { docFigure, docModelFromJSON, recordFigure } from './docScene'
import { PGFPLOTS_FILLBETWEEN, PGFPLOTS_PREAMBLE, toPgfplots } from './pgfplotsExport'
import { clampLatexWidth } from './vectorExport'

// ============================================================================
// The record
// ============================================================================

export const FIGURE_FIELDS = ['none', 'needed', 'described', 'tikz'] as const
export type FigureField = (typeof FIGURE_FIELDS)[number]

export interface ItemRecord {
  /** "AB-0044" from `%%% ITEM AB-0044`; null for a bare stem. */
  id: string | null
  /** Every `key=value` on the `%%%` lines (figuredesc keeps its whole line). */
  fields: Record<string, string>
  /** The record's figure= field, when it states a known one. */
  figure: FigureField | null
  figuredesc: string | null
  /** The input had `%%%` header lines at all. */
  isRecord: boolean
}

/** Read the `%%%` header lines of a record (or nothing, for a bare stem). */
export function readItemRecord(src: string): ItemRecord {
  const fields: Record<string, string> = {}
  let id: string | null = null
  let isRecord = false
  for (const raw of String(src ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith('%%%')) continue
    isRecord = true
    const body = line.replace(/^%%%+\s*/, '')
    const item = /^ITEM\s+(\S+)/i.exec(body)
    if (item) {
      id = item[1]
      continue
    }
    if (/^END\b/i.test(body)) continue
    // figuredesc= is free text to the end of the line.
    const desc = /^figuredesc\s*=\s*(.*)$/i.exec(body)
    if (desc) {
      fields.figuredesc = desc[1].trim().replace(/^"([^"]*)"$/, '$1')
      continue
    }
    for (const m of body.matchAll(/([A-Za-z][\w-]*)\s*=\s*(\S+)/g)) fields[m[1].toLowerCase()] = m[2]
  }
  const fig = (fields.figure ?? '').toLowerCase()
  return {
    id,
    fields,
    figure: (FIGURE_FIELDS as readonly string[]).includes(fig) ? (fig as FigureField) : null,
    figuredesc: fields.figuredesc ?? null,
    isRecord,
  }
}

// ============================================================================
// Grapher → bank
// ============================================================================

export type BankFormat = 'tikz' | 'pgfplots'

export interface BankOptions {
  format: BankFormat
  /** false: the student (stem) figure, no answers. true: the key figure. */
  answers: boolean
  /** Physical width of the whole figure, cm. */
  widthCm: number
  /** Force the bank's house figure rules (see the file header). */
  house: boolean
}

export const DEFAULT_BANK_OPTIONS: BankOptions = { format: 'tikz', answers: false, widthCm: 7, house: true }

/**
 * Dash patterns, in the order curves take them under house style: solid,
 * dashed, dotted, dash-dot — the Curve ⋯ → Line presets first, so a curve the
 * teacher dashed by hand reads the same as one dashed here.
 */
export const HOUSE_DASHES: readonly (readonly number[])[] = [[], [8, 6], [2, 5], [10, 4, 2, 4]]

/** The figure style house rules draw in: a textbook or SAT figure keeps its look, anything else is AP. */
export function houseStyleId(style: FigureStyleId): FigureStyleId {
  return style === 'textbook' || style === 'sat' ? style : 'ap'
}

/** A #rrggbb colour as the grey of the same lightness (a photocopy of it). */
export function toGrey(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const v = Math.round(0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255))
  const h = v.toString(16).padStart(2, '0')
  return `#${h}${h}${h}`
}

/** That style, with the house rules forced: mono ink, grey ground and grid, named axes. */
export function houseFigure(style: FigureStyleId): FigureStyle {
  const base = FIGURE_STYLES[houseStyleId(style)]
  const t = base.theme
  return {
    ...base,
    theme: { ...t, bg: toGrey(t.bg), gridMinor: toGrey(t.gridMinor), gridMajor: toGrey(t.gridMajor), axis: toGrey(t.axis), label: toGrey(t.label) },
    curveInk: 'mono',
    axisNames: true,
  }
}

const sameDash = (a: readonly number[] | undefined, b: readonly number[]): boolean =>
  (a?.length ?? 0) === b.length && (a ?? []).every((v, i) => v === b[i])

/**
 * One dash pattern per visible curve: a curve the teacher dashed keeps its
 * dash; every other takes the next house pattern nobody has yet. With more
 * curves than patterns the cycle repeats (and the curves' names tell them apart).
 */
export function houseDashes(curves: readonly FittedCurve[], styles: StyleMap): StyleMap {
  const out: StyleMap = { ...styles }
  const shown = curves.filter((c) => c.visible)
  const used: (readonly number[])[] = []
  for (const c of shown) {
    const d = styles[c.id]?.dash
    if (d && d.length > 0) used.push(d)
  }
  let next = 0
  for (const c of shown) {
    const own = styles[c.id]?.dash
    if (own && own.length > 0) continue
    let pick: readonly number[] | null = null
    for (let k = 0; k < HOUSE_DASHES.length; k++) {
      const cand = HOUSE_DASHES[(next + k) % HOUSE_DASHES.length]
      if (!used.some((u) => sameDash(u, cand))) {
        pick = cand
        next = (next + k + 1) % HOUSE_DASHES.length
        break
      }
    }
    if (!pick) {
      pick = HOUSE_DASHES[next % HOUSE_DASHES.length]
      next++
    }
    used.push(pick)
    const style: CurveStyle = { ...(styles[c.id] ?? {}) }
    if (pick.length > 0) style.dash = pick.slice()
    else delete style.dash
    out[c.id] = style
  }
  return out
}

/** Apply the house rules to a figure's scene (a new scene; the input is not changed). */
export function houseScene(scene: BoardScene, style: FigureStyleId): BoardScene {
  const figure = houseFigure(style)
  return {
    ...scene,
    figure,
    theme: figure.theme,
    printColors: true,
    styles: houseDashes(scene.curves, scene.styles),
  }
}

/** The math window a scene shows. */
export function sceneWindow(scene: BoardScene): { xMin: number; xMax: number; yMin: number; yMax: number } {
  const vp = scene.vp
  const hx = vp.widthPx / 2 / ppuX(vp)
  const hy = vp.heightPx / 2 / ppuY(vp)
  return { xMin: vp.center.x - hx, xMax: vp.center.x + hx, yMin: vp.center.y - hy, yMax: vp.center.y + hy }
}

/** Does the figure already label a point (a named shape point, a chip that is not an answer)? */
export function figureHasLabelledPoint(scene: BoardScene): boolean {
  for (const s of scene.shapes ?? []) {
    if (!s.visible) continue
    if (s.kind === 'point' && s.label && s.label.trim() !== '') return true
    if (s.kind === 'segment' && s.labels?.some((l) => l.trim() !== '')) return true
    if (s.kind === 'polygon' && s.labels?.some((l) => l.trim() !== '')) return true
  }
  for (const ov of scene.overlays ?? []) {
    if (ov.kind === 'label' && !ov.answer && ov.text.trim() !== '') return true
  }
  return false
}

/** A point the bank figure labels because the student figure labelled none. */
export interface LabelledPoint {
  x: number
  y: number
  /** "(2, 2)" — what the figure prints beside it. */
  label: string
  curveId: string
  /** "f", or '' when the curve has no name. */
  curveName: string
  /** "the y-intercept of f", "a lattice point on f (not a zero, extremum or inflection point)". */
  why: string
}

/** Kinds of analysis point that are ANSWERS to a stem: never labelled on a student figure. */
const ANSWER_KINDS = new Set<SpecialPoint['kind']>([
  'zero', 'maximum', 'minimum', 'inflection', 'extreme', 'petal-tip', 'hole', 'intersection',
])

const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b))
const isInt = (v: number): boolean => Number.isFinite(v) && Math.abs(v - Math.round(v)) < 1e-9

/** "(2, 2)", "(0, −1.5)": the coordinates as the figure prints them. */
export function pointLabel(x: number, y: number): string {
  const r = (v: number): number => (Math.abs(v) < 1e-12 ? 0 : isInt(v) ? Math.round(v) : v)
  return `(${fmt(r(x))}, ${fmt(r(y))})`
}

function safeAnalysis(c: FittedCurve, models: Record<string, ModelSpec>): SpecialPoint[] {
  try {
    const pts = analyzeCurve(c, models)
    return Array.isArray(pts) ? pts : []
  } catch {
    return []
  }
}

/**
 * The one point a house-style figure labels when nothing else is labelled: a
 * point that gives the reader the scale and gives no answer away.
 *
 *   1. the y-intercept of the first function, when it is not the origin (the
 *      "O" is there) and not itself a zero, extremum or inflection point;
 *   2. otherwise a lattice point a curve passes through that is none of those,
 *      nearest the y-axis;
 *   3. otherwise a non-lattice y-intercept (still not an answer).
 *
 * Points within 6% of the frame (or in the caption band) are passed over: a
 * label there is clipped or crowds the axis numbers. Null when nothing fits.
 */
export function pickLabelPoint(scene: BoardScene, names: Readonly<Record<string, string>>): LabelledPoint | null {
  const w = sceneWindow(scene)
  const mx = 0.06 * (w.xMax - w.xMin)
  const my = 0.06 * (w.yMax - w.yMin)
  const capBand = scene.caption ? 0.14 * (w.yMax - w.yMin) : 0
  const inside = (x: number, y: number): boolean =>
    x >= w.xMin + mx && x <= w.xMax - mx && y >= w.yMin + my + capBand && y <= w.yMax - my
  const curves = scene.curves.filter((c) => c.visible && scene.models[c.modelId])
  const answersOf = new Map<string, Vec2[]>()
  const answers = (c: FittedCurve): Vec2[] => {
    let a = answersOf.get(c.id)
    if (!a) {
      a = safeAnalysis(c, scene.models)
        .filter((p) => ANSWER_KINDS.has(p.kind))
        .map((p) => p.pos)
      answersOf.set(c.id, a)
    }
    return a
  }
  // A point any curve on the figure treats as an answer is an answer.
  const isAnswer = (x: number, y: number): boolean =>
    curves.some((c) => answers(c).some((p) => near(p.x, x) && near(p.y, y)))
  const ok = (x: number, y: number): boolean =>
    Number.isFinite(x) && Number.isFinite(y) && !(near(x, 0) && near(y, 0)) && inside(x, y) && !isAnswer(x, y)
  const inDomain = (c: FittedCurve, t: number): boolean => !c.domain || (t >= c.domain[0] - 1e-12 && t <= c.domain[1] + 1e-12)
  const nameOf = (c: FittedCurve): string => names[c.id] ?? ''
  const make = (c: FittedCurve, x: number, y: number, why: string): LabelledPoint => {
    const rx = isInt(x) ? Math.round(x) : x
    const ry = isInt(y) ? Math.round(y) : y
    return { x: rx, y: ry, label: pointLabel(rx, ry), curveId: c.id, curveName: nameOf(c), why }
  }
  const of = (c: FittedCurve): string => (nameOf(c) ? ` of ${nameOf(c)}` : '')
  const on = (c: FittedCurve): string => (nameOf(c) ? ` on ${nameOf(c)}` : ' on the curve')
  const explicit = curves.filter((c) => c.kind === 'explicit' && scene.models[c.modelId].evalExplicit)
  const f = (c: FittedCurve, x: number): number => {
    try {
      return scene.models[c.modelId].evalExplicit!(c.params, x)
    } catch {
      return NaN
    }
  }

  // 1. a lattice y-intercept
  for (const c of explicit) {
    if (!inDomain(c, 0)) continue
    const y = f(c, 0)
    if (isInt(y) && ok(0, y)) return make(c, 0, y, `the y-intercept${of(c)}`)
  }
  // 2. lattice points
  const cands: { c: FittedCurve; x: number; y: number }[] = []
  for (const c of explicit) {
    for (let x = Math.ceil(w.xMin); x <= Math.floor(w.xMax); x++) {
      if (!inDomain(c, x)) continue
      const y = f(c, x)
      if (isInt(y) && ok(x, Math.round(y))) cands.push({ c, x, y: Math.round(y) })
    }
  }
  for (const c of curves) {
    const spec = scene.models[c.modelId]
    if (c.kind === 'explicit' || (!spec.evalPolar && !spec.evalParametric)) continue
    const [t0, t1] = c.domain ?? (spec.evalPolar ? [0, 2 * Math.PI] : [-10, 10])
    const ts: number[] = []
    for (let k = Math.ceil((t0 * 12) / Math.PI); k <= Math.floor((t1 * 12) / Math.PI); k++) ts.push((k * Math.PI) / 12)
    for (let t = Math.ceil(t0); t <= Math.floor(t1); t++) ts.push(t)
    for (const t of ts) {
      let p: Vec2
      try {
        if (spec.evalPolar) {
          const r = spec.evalPolar(c.params, t)
          p = { x: r * Math.cos(t), y: r * Math.sin(t) }
        } else p = spec.evalParametric!(c.params, t)
      } catch {
        continue
      }
      if (isInt(p.x) && isInt(p.y) && ok(Math.round(p.x), Math.round(p.y))) cands.push({ c, x: Math.round(p.x), y: Math.round(p.y) })
    }
  }
  if (cands.length > 0) {
    // Nearest the y-axis, then right of it, then nearest the x-axis.
    cands.sort((a, b) => Math.abs(a.x) - Math.abs(b.x) || b.x - a.x || Math.abs(a.y) - Math.abs(b.y))
    const p = cands[0]
    return make(p.c, p.x, p.y, `a lattice point${on(p.c)} (not a zero, extremum or inflection point)`)
  }
  // 3. any y-intercept that is not an answer
  for (const c of explicit) {
    if (!inDomain(c, 0)) continue
    const y = f(c, 0)
    if (ok(0, y)) return make(c, 0, Math.round(y * 100) / 100, `the y-intercept${of(c)}`)
  }
  return null
}

/** The tick spacing a figure's numbers are set at (DescribeWindow.xStep / xStepText). */
function axisSteps(scene: BoardScene): Pick<DescribeWindow, 'xStep' | 'yStep' | 'xStepText' | 'yStepText'> {
  const fig = scene.figure
  const step = (ppu: number, pi: boolean): { v: number; text?: string } => {
    if (pi) {
      if ((Math.PI / 2) * ppu >= PI_LABEL_MIN_PX) return { v: Math.PI / 2, text: 'π/2' }
      const s = pickPiTickStep(ppu, PI_LABEL_MIN_PX)
      return { v: s.major, text: formatPiTick(s.num, s.den).replace(/-/g, '−') }
    }
    if (fig?.spacing === 'unit' && ppu >= UNIT_MIN_PX) {
      // numbers on every unit, or on the majors (every 5) of the unit ruling
      return { v: fig.numbers === 'unit' ? 1 : 5 }
    }
    return { v: pickTickStep(ppu).major }
  }
  const x = step(ppuX(scene.vp), scene.axisUnits?.x === 'pi')
  const y = step(ppuY(scene.vp), scene.axisUnits?.y === 'pi')
  return {
    xStep: x.v,
    yStep: y.v,
    ...(x.text ? { xStepText: x.text } : {}),
    ...(y.text ? { yStepText: y.text } : {}),
  }
}

/**
 * A derivative's name from its parent's letter, hidden parent or not: the
 * graph of f′ under a stem that says "the graph of f′ is shown" is f′ in its
 * description even while f itself is hidden (the board then gives it a letter
 * of its own — a derivative must be called something on the board).
 */
function derivedName(m: DocModel, curveId: string): string | null {
  let at = curveId
  let order = 0
  for (let guard = 0; guard < 8; guard++) {
    const link = m.board.calc.find((l) => l.kind === 'derivative' && l.curveId === at)
    if (!link || link.kind !== 'derivative') break
    at = link.parentId
    order++
  }
  if (order === 0) return null
  const base = m.names[at] ?? m.curveNames[at]
  return base ? `${base}${order === 1 ? '′' : order === 2 ? '″' : `⁽${order}⁾`}` : null
}

/** The adapter input for a bank figure: the curves the scene draws, as it draws them. */
export function describeInputOf(
  m: DocModel,
  scene: BoardScene,
  added: LabelledPoint | null,
): AdapterInput {
  const w = sceneWindow(scene)
  const curves: AdapterCurve[] = scene.curves
    .filter((c) => c.visible)
    .map((c) => {
      const name = derivedName(m, c.id) ?? m.curveNames[c.id] ?? m.names[c.id]
      const source = m.sources[c.id]
      const out: AdapterCurve = { curve: c, shows: { equation: false } }
      if (name) out.name = name
      if (source) out.source = source
      if ((scene.styles[c.id]?.dash?.length ?? 0) > 0) out.dashed = true
      if (added && added.curveId === c.id) out.labelled = [{ x: added.x, y: added.y }]
      return out
    })
  const extras: (string | DescribeExtra)[] = []
  for (const s of scene.shapes ?? []) {
    if (!s.visible || s.kind !== 'point' || !s.label || s.id === ADDED_POINT_ID) continue
    extras.push(`Point ${s.label} is marked at ${pointLabel(s.at.x, s.at.y)}.`)
  }
  if ((scene.fields ?? []).some((f) => f.visible)) {
    extras.push('A slope field is drawn.')
    for (const f of scene.fields ?? []) if (f.visible) extras.push({ text: `The slope field is ${f.latex}.`, answer: true })
  }
  return {
    window: { ...w, ...axisSteps(scene) },
    curves,
    models: scene.models,
    ...(extras.length > 0 ? { extras } : {}),
    board: scene.grid === 'polar' ? 'polar' : 'cartesian',
  }
}

/** The id of the point house style adds (never a document's own). */
export const ADDED_POINT_ID = '__bank_label'

export interface BankFigure {
  /** The ready-to-paste block: %%% lines, preamble comment, the centred picture. */
  block: string
  /** `%%% figure=described` + `%%% figuredesc=…`, for the text form. */
  descriptionBlock: string
  /** The STUDENT description, one line. */
  figuredesc: string
  /** The long (screen-reader) description of the student figure. */
  long: string
  /** The point house style labelled, when the student figure had none. */
  added: LabelledPoint | null
  /** True when the student figure has a labelled point (its own, or the added one). */
  labelled: boolean
  /** What the dialog should say (added point, things not exported). */
  notes: string[]
  /** The style it was drawn in. */
  style: FigureStyleId
  /** The preamble the block needs. */
  preamble: string[]
  /** The scene that was written (tests). */
  scene: BoardScene
}

/** A picture's body: no comment lines, no blank lines. */
function pictureBody(src: string): string {
  return src
    .split('\n')
    .filter((l) => l.trim() !== '' && !/^\s*%/.test(l))
    .join('\n')
}

/** A comment's text: one line, no control characters. */
const commentText = (s: string): string => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()

/** The description as one line of text: no line breaks, no ASCII quotes, never empty. */
export function figuredescText(desc: string): string {
  const one = commentText(desc).replace(/\s+/g, ' ').replace(/"/g, '”')
  return one === '' ? 'Graph.' : one
}

/**
 * The `%%% figuredesc=` line. QUOTED: bank.py reads a header value as one
 * whitespace-free token unless it is in double quotes (KV_RE), so an unquoted
 * description would be cut to its first word; quoted, it reads back whole
 * (and readItemRecord takes it either way).
 */
export function figuredescLine(desc: string): string {
  return `%%% figuredesc="${figuredescText(desc)}"`
}

/** Draw a document's figure for the bank, and write the block. */
export function bankFigure(m: DocModel, o: BankOptions): BankFigure {
  const widthCm = clampLatexWidth(o.widthCm)
  const style: FigureStyleId = o.house ? houseStyleId(m.board.figure) : m.board.figure
  const notes: string[] = []

  // The student figure decides the description and whether a point is labelled.
  const student = docFigure(m, { style, answers: false, widthCm })
  if (o.house) student.scene = houseScene(student.scene, style)
  const fig = o.answers ? docFigure(m, { style, answers: true, widthCm }) : student
  if (o.answers && o.house) fig.scene = houseScene(fig.scene, style)

  let added: LabelledPoint | null = null
  let labelled = figureHasLabelledPoint(student.scene)
  if (o.house && !labelled && m.kind === 'cartesian') {
    added = pickLabelPoint(student.scene, m.curveNames)
    if (added) {
      const shape: Shape = { kind: 'point', id: ADDED_POINT_ID, at: { x: added.x, y: added.y }, color: '#000000', visible: true, label: added.label }
      student.scene = { ...student.scene, shapes: [...(student.scene.shapes ?? []), shape] }
      if (fig !== student) fig.scene = { ...fig.scene, shapes: [...(fig.scene.shapes ?? []), shape] }
      labelled = true
      notes.push(`The student figure labelled no point, so ${added.label} is labelled — ${added.why}.`)
    } else {
      notes.push('The student figure labels no point, and no neutral point was found to label. Add one (Build ▾ → Shape: A = (a, b)) before banking it.')
    }
  }

  const description = describeCurves(describeInputOf(m, student.scene, added), { answers: false })
  const figuredesc = figuredescText(description.figuredesc)

  // The picture.
  const format: BankFormat = o.format === 'pgfplots' && m.kind === 'cartesian' ? 'pgfplots' : 'tikz'
  if (o.format === 'pgfplots' && format === 'tikz') notes.push('A number line has no pgfplots form — written as TikZ.')
  let src: string
  if (format === 'pgfplots') {
    src = toPgfplots(fig.scene, { widthCm, sources: fig.sources, extraMarkers: fig.context })
  } else {
    src = toTikz(recordFigure(fig), {})
  }
  for (const line of src.split('\n')) {
    const ne = /^%\s*not exported:\s*(.*)$/.exec(line)
    if (ne && !/caption/.test(ne[1])) notes.push(`Not in the figure: ${ne[1]}`)
  }
  const preamble =
    format === 'pgfplots'
      ? [...PGFPLOTS_PREAMBLE, ...(src.includes(PGFPLOTS_FILLBETWEEN) ? [PGFPLOTS_FILLBETWEEN] : [])]
      : ['\\usepackage{tikz}']
  const body = pictureBody(src)
  const caption = fig.scene.caption?.trim() ?? ''
  const lines: string[] = [
    '%%% figure=tikz',
    figuredescLine(figuredesc),
    `% Grapher figure "${commentText(m.name)}" — preamble: \\usepackage{tikz}` +
      (format === 'pgfplots' ? ` (pgfplots: ${preamble.join(' ')})` : ''),
    '\\begin{center}',
    body,
  ]
  // The pgfplots axis leaves its caption to the page; under a stem it goes
  // right under the picture, where the TikZ figure draws its own.
  if (format === 'pgfplots' && caption !== '') lines.push(`\\par\\smallskip{\\small ${texLabel(caption)}}`)
  lines.push('\\end{center}')
  return {
    block: lines.join('\n') + '\n',
    descriptionBlock: `%%% figure=described\n${figuredescLine(figuredesc)}\n`,
    figuredesc,
    long: description.long,
    added,
    labelled,
    notes,
    style,
    preamble,
    scene: fig.scene,
  }
}

/** A .tex file name for the block, from the document name. */
export function bankFileName(docName: string): string {
  const safe = docName.replace(/[^\w\d\-. ]+/g, '_').trim()
  return `${safe || 'grapher'}-bank.tex`
}

// ============================================================================
// bank → Grapher
// ============================================================================

/** What one definition becomes on the board. */
export interface PlannedLine {
  def: ImportedDefinition
  /** 'line' — typed as is; 'hidden' — typed, then hidden (f, under its graphed f′); 'field' — a slope field. */
  role: 'line' | 'hidden' | 'field'
}

export interface ItemPlan {
  record: ItemRecord
  imported: LatexImport
  /** "f′" when the stem says the graph of f′ is shown; null when it shows f (or says nothing). */
  graphOf: string | null
  lines: PlannedLine[]
  /** Differentiate this definition (by index into lines) once / twice, and graph that. */
  derive: { line: number; times: 1 | 2 } | null
  /** Sentences for the dialog: what will be graphed and why. */
  notes: string[]
  /** The record says figure=needed: the teacher must build it. */
  needsFigure: boolean
  /** The figure's caption ("Graph of f′"), when the stem says which graph it is. */
  caption: string | null
  /** The document's name before numbering: the item id, else "Item figure". */
  baseName: string
  /** Nothing to graph. */
  empty: boolean
}

const PRIME = ['', '′', '″']

/** A number as Grapher's equation box reads it: 2pi, pi/2, 3, 0.25. */
function numText(v: number): string {
  for (const d of [1, 2, 3, 4, 6]) {
    const k = (v * d) / Math.PI
    if (Math.abs(k - Math.round(k)) < 1e-9 && Math.round(k) !== 0) {
      const n = Math.round(k)
      const head = n === 1 ? 'pi' : n === -1 ? '-pi' : `${n}pi`
      return d === 1 ? head : `${head}/${d}`
    }
  }
  return String(Math.round(v * 1e6) / 1e6)
}

export interface PlanOptions {
  /**
   * Follow "the graph of f′ is shown" (default true). False graphs the
   * definitions exactly as written — the teacher's answer to "graph f′?".
   */
  followGraphOf?: boolean
}

/** Decide what to graph from a stem or a whole record. */
export function planItem(src: string, opts: PlanOptions = {}): ItemPlan {
  const record = readItemRecord(src)
  const imported = importFromLatex(src)
  const defs = imported.definitions
  const hints = imported.hints
  const notes: string[] = []
  // A parametric pair is read without its t-range; the stem's interval is it
  // ("for 0 ≤ t ≤ 3"), so it becomes the curve's restriction.
  const iv = hints.interval
  const withRange = (def: ImportedDefinition): ImportedDefinition => {
    if (def.kind !== 'parametric' || def.restriction || !iv) return def
    const restriction = `${numText(iv[0])} <= t <= ${numText(iv[1])}`
    return { ...def, typed: `${def.typed} {${restriction}}`, restriction, domain: [iv[0], iv[1]] }
  }
  const lines: PlannedLine[] = defs.map((d) => {
    const def = withRange(d)
    return { def, role: def.kind === 'slope-field' ? 'field' : 'line' }
  })
  let derive: ItemPlan['derive'] = null
  let caption: string | null = null

  const order = hints.graphOf === "f''" ? 2 : hints.graphOf === "f'" ? 1 : 0
  if (order > 0 && opts.followGraphOf === false) {
    const shown = `${hints.name ?? 'f'}${PRIME[order]}`
    notes.push(`The stem shows the graph of ${shown}; graphing the definitions as written instead.`)
  } else if (order > 0) {
    const letter = hints.name ?? 'f'
    const shown = `${letter}${PRIME[order]}`
    caption = `Graph of ${shown}`
    // Given as data: f′(x) = … (named "f′"), graphed as it stands.
    const given = defs.findIndex((d) => d.kind === 'derivative' && d.name === shown)
    const fIdx = defs.findIndex((d) => d.kind === 'function' && d.name === letter)
    if (given >= 0) {
      notes.push(`The stem shows the graph of ${shown}, and ${shown} is given — graphing ${shown} as it stands.`)
      if (fIdx >= 0) {
        lines[fIdx] = { ...lines[fIdx], role: 'hidden' }
        notes.push(`${letter} is added too, hidden: the figure is the graph of ${shown}.`)
      }
    } else if (fIdx >= 0) {
      derive = { line: fIdx, times: order as 1 | 2 }
      lines[fIdx] = { ...lines[fIdx], role: 'hidden' }
      notes.push(
        `The stem shows the graph of ${shown}, and only ${letter} is defined — graphing ${shown} ` +
          `(Curve ⋯ → Calculus → Derivative${order === 2 ? ', twice' : ''}) and hiding ${letter}.`,
      )
    } else {
      notes.push(`The stem shows the graph of ${shown}, but neither ${letter} nor ${shown} is defined in it — sketch it, or type it.`)
    }
  }
  if (iv) {
    const span = `[${fmt(iv[0])}, ${fmt(iv[1])}]`
    if (defs.some((d) => d.kind !== 'polar' && d.kind !== 'parametric')) notes.push(`Framed to the interval ${span} the stem gives.`)
    else if (defs.some((d) => d.kind === 'parametric' && !d.restriction)) notes.push(`t runs over ${span}, the interval the stem gives.`)
  }
  for (const l of lines) {
    if (l.def.restriction) notes.push(`${l.def.name || 'The relation'} is restricted to ${l.def.restriction.replace(/<=/g, '≤').replace(/>=/g, '≥')}.`)
  }
  const needsFigure = record.figure === 'needed'
  return {
    record,
    imported,
    graphOf: order > 0 ? `${hints.name ?? 'f'}${PRIME[order]}` : null,
    lines,
    derive,
    notes,
    needsFigure,
    caption,
    baseName: record.id ?? 'Item figure',
    empty: lines.length === 0,
  }
}

/** The name a new item document takes: the item id, or the next "(2)", "(3)" when that is taken. */
export function itemDocName(base: string, existing: readonly string[]): string {
  const used = new Set(existing.map((n) => n.trim().toLowerCase()))
  if (!used.has(base.toLowerCase())) return base
  let n = 2
  while (used.has(`${base} (${n})`.toLowerCase())) n++
  return `${base} (${n})`
}

/** The nominal board an item document is framed on (the examples' screen). */
const SCREEN = { widthPx: 900, heightPx: 600 }

const pctl = (xs: readonly number[], p: number): number => {
  const s = xs.slice().sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))]
}

/**
 * The window an item's figure is framed to: the stem's interval (else the
 * graphed curves' domain, else [−5, 5]) across, and what the visible curves do
 * over it up and down — with the axes kept in view when they are close, the
 * way an exam figure keeps them. Polar and parametric curves are framed whole.
 */
export function itemWindow(
  curves: readonly FittedCurve[],
  models: Record<string, ModelSpec>,
  interval: [number, number] | undefined,
  hasField: boolean,
): ExampleWindow {
  const shown = curves.filter((c) => c.visible && models[c.modelId])
  const closed = shown.filter((c) => c.kind !== 'explicit')
  const explicit = shown.filter((c) => c.kind === 'explicit' && models[c.modelId].evalExplicit)
  const pts: Vec2[] = []
  for (const c of closed) {
    const spec = models[c.modelId]
    if (!spec.evalPolar && !spec.evalParametric) continue
    const [t0, t1] = c.domain ?? (spec.evalPolar ? [0, 2 * Math.PI] : [-5, 5])
    for (let i = 0; i <= 400; i++) {
      const t = t0 + ((t1 - t0) * i) / 400
      try {
        if (spec.evalPolar) {
          const r = spec.evalPolar(c.params, t)
          pts.push({ x: r * Math.cos(t), y: r * Math.sin(t) })
        } else pts.push(spec.evalParametric!(c.params, t))
      } catch {
        /* skip */
      }
    }
  }
  const finitePts = pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) < 1e6 && Math.abs(p.y) < 1e6)

  // x: the interval, else the explicit curves' domains, else the closed curves' extent.
  let x0: number
  let x1: number
  if (interval) [x0, x1] = interval
  else {
    const doms = explicit.map((c) => c.domain).filter((d): d is [number, number] => !!d && Number.isFinite(d[0]) && Number.isFinite(d[1]))
    if (doms.length > 0) {
      x0 = Math.min(...doms.map((d) => d[0]))
      x1 = Math.max(...doms.map((d) => d[1]))
    } else if (explicit.length === 0 && finitePts.length > 0) {
      x0 = Math.min(...finitePts.map((p) => p.x))
      x1 = Math.max(...finitePts.map((p) => p.x))
    } else {
      x0 = -5
      x1 = 5
    }
  }
  if (!(x1 > x0)) {
    x0 -= 1
    x1 += 1
  }
  // y: what the curves do over that x.
  const ys: number[] = []
  for (const c of explicit) {
    const f = models[c.modelId].evalExplicit!
    for (let i = 0; i <= 300; i++) {
      const x = x0 + ((x1 - x0) * i) / 300
      if (c.domain && (x < c.domain[0] || x > c.domain[1])) continue
      let y: number
      try {
        y = f(c.params, x)
      } catch {
        continue
      }
      if (Number.isFinite(y) && Math.abs(y) < 1e6) ys.push(y)
    }
  }
  for (const p of finitePts) ys.push(p.y)
  let y0: number
  let y1: number
  if (ys.length > 0) {
    // Poles go off the board rather than squashing the rest of the graph
    // flat: an end is trimmed only when it runs far past everything else.
    y0 = Math.min(...ys)
    y1 = Math.max(...ys)
    if (ys.length > 40 && explicit.length > 0) {
      const lo = pctl(ys, 0.02)
      const hi = pctl(ys, 0.98)
      const body = Math.max(hi - lo, 1e-9)
      if (y1 - hi > 2 * body) y1 = hi
      if (lo - y0 > 2 * body) y0 = lo
    }
  } else {
    const h = hasField ? (x1 - x0) / 2 : 5
    y0 = -h
    y1 = h
  }
  if (!(y1 - y0 > 1e-9)) {
    y0 -= 1
    y1 += 1
  }
  if (closed.length > 0 && explicit.length === 0) {
    x0 = Math.min(x0, 0)
    x1 = Math.max(x1, 0)
  }
  // The axes stay in the figure when they are near it.
  const wx = x1 - x0
  const wy = y1 - y0
  if (x0 > 0 && x0 <= 0.6 * wx) x0 = 0
  if (x1 < 0 && -x1 <= 0.6 * wx) x1 = 0
  y0 = Math.min(y0, 0)
  y1 = Math.max(y1, 0)
  const px = 0.06 * (x1 - x0)
  const py = 0.1 * (y1 - y0 || wy || 1)
  const x: [number, number] = [x0 - px, x1 + px]
  const y: [number, number] = [y0 - py, y1 + py]
  // Lopsided against the board (a cubic over [−3, 4] reaches 52): scale the
  // axes independently, as an exam figure does, rather than flattening it.
  const want = (y[1] - y[0]) / (x[1] - x[0])
  const screen = SCREEN.heightPx / SCREEN.widthPx
  const lopsided = closed.length === 0 && (want / screen > 2.5 || screen / want > 2.5)
  return { x, y, ...(lopsided ? { independent: true } : {}) }
}

export interface BuiltItem {
  json: string
  window: ExampleWindow
  /** Lines the board refused, with why. */
  problems: string[]
  /** What ended up on the board, in words ("f (hidden)", "f′"). */
  graphed: string[]
}

/** Write the plan as a stored document (the gallery's construction path), named `name`, in the AP figure style. */
export function buildItemDoc(plan: ItemPlan, name: string): BuiltItem {
  const problems: string[] = []
  const graphed: string[] = []
  const build = (win: ExampleWindow | null): { b: ExampleBoard; hide: string[] } => {
    const b = new ExampleBoard('cartesian')
    const hide: string[] = []
    const ids: (string | null)[] = []
    for (const l of plan.lines) {
      try {
        if (l.role === 'field') {
          ids.push(b.field(l.def.typed))
        } else {
          const id = b.line(l.def.typed)
          ids.push(id)
          if (l.role === 'hidden') hide.push(id)
        }
        if (!win) graphed.push(`${l.def.name || 'relation'}${l.role === 'hidden' ? ' (hidden)' : ''}`)
      } catch (err) {
        ids.push(null)
        if (!win) problems.push(`${l.def.typed}: ${err instanceof Error ? err.message.replace(/^example:\s*/, '') : String(err)}`)
      }
    }
    if (plan.derive) {
      const parent = ids[plan.derive.line]
      if (parent) {
        try {
          let d = b.derivative(parent)
          if (plan.derive.times === 2) {
            hide.push(d)
            d = b.derivative(d)
          }
          b.select(d)
          if (!win) graphed.push(`${plan.lines[plan.derive.line].def.name}${PRIME[plan.derive.times]}`)
        } catch (err) {
          if (!win) problems.push(`the derivative: ${err instanceof Error ? err.message.replace(/^example:\s*/, '') : String(err)}`)
        }
      }
    }
    b.figure('ap')
    if (win) b.frame(win.x, win.y, { independent: win.independent === true })
    return { b, hide }
  }
  const store = (b: ExampleBoard, hide: string[]): string => {
    const input = b.toInput()
    input.curves = input.curves.map((c) => (hide.includes(c.id) ? { ...c, visible: false } : c))
    if (plan.caption) {
      input.caption = plan.caption
      input.captionAuto = false
    }
    return serializeDoc(docFromBoard({ id: 'item', name, createdAt: 0, modifiedAt: 0 }, input, 0))
  }
  // First pass: the curves, to measure what they do over the interval.
  const first = build(null)
  const draft = docModelFromJSON(store(first.b, first.hide))
  // The stem's interval frames x — unless every curve is polar or parametric,
  // when it is the θ- or t-range (already the curves' own restriction).
  const closedOnly =
    draft !== null &&
    draft.board.curves.some((c) => c.visible) &&
    draft.board.curves.filter((c) => c.visible).every((c) => c.kind === 'polar' || c.kind === 'parametric')
  const interval = closedOnly ? undefined : plan.imported.hints.interval
  const win = draft
    ? itemWindow(draft.board.curves, draft.models, interval, plan.lines.some((l) => l.role === 'field'))
    : { x: [-5, 5] as [number, number], y: [-5, 5] as [number, number] }
  const second = build(win)
  return { json: store(second.b, second.hide), window: win, problems, graphed }
}

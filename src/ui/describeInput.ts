// ============================================================================
// src/ui/describeInput.ts — a document figure's description input: what the
// board's live description (src/ui/boardDescription.ts) and an item-bank
// figure's figuredesc (src/ui/itemBank.ts, which re-exports these) both read.
//
// Split out of itemBank.ts so the board's first render does not need the item
// bank, its LaTeX importer or the TikZ / pgfplots writers (src/ui/lazyLoad.tsx).
// ============================================================================

import { ppuX, ppuY } from '../core/types'
import type { AdapterCurve, AdapterInput } from '../core/describeAdapters'
import { describeShapes } from '../core/describeAdapters'
import type { DescribeExtra, DescribeWindow } from '../core/describeGraph'
import { fmt } from '../core/describeGraph'
import { formatPiTick, pickPiTickStep, pickTickStep, PI_LABEL_MIN_PX, UNIT_MIN_PX } from '../render/grid'
import type { BoardScene } from './renderBoard'
import type { DocModel } from './docScene'

const isInt = (v: number): boolean => Number.isFinite(v) && Math.abs(v - Math.round(v)) < 1e-9

/** The math window a scene shows. */
export function sceneWindow(scene: BoardScene): { xMin: number; xMax: number; yMin: number; yMax: number } {
  const vp = scene.vp
  const hx = vp.widthPx / 2 / ppuX(vp)
  const hy = vp.heightPx / 2 / ppuY(vp)
  return { xMin: vp.center.x - hx, xMax: vp.center.x + hx, yMin: vp.center.y - hy, yMax: vp.center.y + hy }
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

/** "(2, 2)", "(0, −1.5)": the coordinates as the figure prints them. */
export function pointLabel(x: number, y: number): string {
  const r = (v: number): number => (Math.abs(v) < 1e-12 ? 0 : isInt(v) ? Math.round(v) : v)
  return `(${fmt(r(x))}, ${fmt(r(y))})`
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
  extras.push(...describeShapes((scene.shapes ?? []).filter((s) => s.id !== ADDED_POINT_ID)))
  if ((scene.fields ?? []).some((f) => f.visible)) {
    extras.push('A slope field is drawn.')
    for (const f of scene.fields ?? []) if (f.visible) extras.push({ text: `The slope field is ${f.latex}.`, answer: true })
  }
  const stats = (scene.stats ?? []).flatMap((f) => (f.visible && f.describe ? [f.describe] : []))
  return {
    window: { ...w, ...axisSteps(scene) },
    curves,
    models: scene.models,
    ...(extras.length > 0 ? { extras } : {}),
    ...(stats.length > 0 ? { stats } : {}),
    board: scene.grid === 'polar' ? 'polar' : 'cartesian',
  }
}

/** The id of the point house style adds (never a document's own). */
export const ADDED_POINT_ID = '__bank_label'

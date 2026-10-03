// ============================================================================
// src/app/types.ts — the types App's hooks share: the undo snapshot, the
// state patch every mutation commits, and the record of a curve's edits.
//
// Moved out of App.tsx unchanged; App.tsx re-exports Mode and CurveEdit.
// ============================================================================

import type { BoardIneqSystem, CurveViews, InverseLink, StyleMap } from '../core/persist'
import type {
  BoardKind,
  FigureStyleId,
  FitResult,
  FittedCurve,
  NLItem,
  SpecialPoint,
} from '../core/types'
import type { CalcLink } from '../ui/calcLinks'
import type { BoardData } from '../ui/dataLinks'
import type { BoardField } from '../ui/fieldLinks'
import type { BoardRelatedRates } from '../ui/relatedRatesLinks'
import type { BoardStat } from '../ui/statsLinks'
import type { BoardSequence } from '../ui/seqLinks'
import type { BoardShape } from '../ui/shapeLinks'
import type { BoardUnitCircle } from '../ui/unitCircleLinks'

/**
 * The canvas is MODELESS — Space or a middle-drag or two fingers pan, a tap
 * selects, a tap on nothing deselects. The type survives because the stages and
 * the document format still name it; it has exactly one value that is ever used.
 */
export type Mode = 'draw' | 'pan'

/**
 * One undo/redo history entry.
 *
 * exprSources/brokenExpr/candidates belong in here, not beside it: a typed
 * equation's source text is the ONLY thing that can rebuild its model closure
 * after a reload, so a snapshot that restored the curve but not its source
 * produced a curve that looked fine until the next load and then came back dead
 * (labelled "expr_1", drawing nothing, with no warning — persist.ts only renders
 * its "can't restore" card when a source IS present).
 */
export interface Snapshot {
  curves: FittedCurve[]
  /** Number-line items. They live in the same history as the curves so a board
   *  whose kind was switched still undoes in the order things happened. */
  items: NLItem[]
  kind: BoardKind
  styles: StyleMap
  exprSources: Record<string, string>
  brokenExpr: Record<string, string>
  /** curveId -> the user's own typed form, while the params still mean it. */
  displaySources: Record<string, string>
  /** curveId -> the edits made since recognition, in the order they were made. */
  edits: Record<string, CurveEdit[]>
  /**
   * The calculus objects: tangents, derivative curves, shaded integrals,
   * Riemann sums. They are in the SAME history as the curves because they are
   * in the same breath — deleting a curve takes its tangent with it, and one
   * undo has to bring both back or the board comes back half-built.
   */
  calc: CalcLink[]
  /**
   * The slope fields, in the same history for the same reason: a field and the
   * solution curves through it are one object, and one undo has to bring the
   * whole picture back rather than half of it.
   */
  fields: BoardField[]
  /**
   * The shapes, in the same history again: a triangle deleted beside the
   * curve it was measured against has to come back with it, in one undo.
   */
  shapes: BoardShape[]
  /**
   * The data tables, in the same history once more: deleting a table takes
   * its regression curves with it, and one undo has to bring all of them back.
   */
  data: BoardData[]
  /**
   * The sequences, in the same history for the same reason: a sequence
   * deleted, retyped or re-windowed comes back with one undo.
   */
  sequences: BoardSequence[]
  /**
   * The unit circle, in the same history: a dragged θ, a switch, an inverse
   * question — each comes back with one undo.
   */
  unitCircles: BoardUnitCircle[]
  /** The related-rates problem (none or one): givens, t, the when-question. */
  relatedRates: BoardRelatedRates[]
  /** The statistics objects: normal distributions and simulations (settings and seeds). */
  stats: BoardStat[]
  /**
   * The inequality system's settings — solution region, test point, the
   * objective — in the same history: each switch comes back with one undo.
   */
  system: BoardIneqSystem | null
  /**
   * Curve names (f, g, h …), the letters each typed line calls, and the
   * "Show inverse" links. In the history because they are the document's:
   * a rename rewrites every line that calls the old letter, and one undo has
   * to take the letter AND the rewritten lines back together.
   */
  names: Record<string, string>
  calls: Record<string, string[]>
  inverses: InverseLink[]
  /**
   * The LOOK the board is in, and the line printed under the figure.
   *
   * Unlike the ruling and the axis units — which are ways of MEASURING a board
   * and stay out of the history — a style change repaints every pixel of the
   * figure and a caption is words the teacher wrote. Both are therefore one
   * undo each, named after what they did ("figure style: SAT"), because the
   * largest visible change on the board must not be the one thing Cmd+Z will
   * not take back.
   */
  figure: FigureStyleId
  /** The teacher's own caption, or null while the board derives one. */
  caption: string | null
  /**
   * The per-curve view settings (show construction, show parent, a polar
   * area, the Motion switches, a factored curve's point) as they were. Not
   * an undo step of their own: applying a snapshot only hands them back to
   * curves it brings back (src/ui/curveViews.ts restoreViewStates).
   */
  views: CurveViews
  candidates: Map<string, FitResult[]>
  /**
   * What the action was, in three or four words: "set zero", "edit equation",
   * "delete curve". Undo changed 0.6% of the pixels on a measured board and
   * said nothing; now it says what it took back.
   */
  label: string
}

/**
 * One thing done to a curve after it was recognised.
 *
 * `feature` edits are recorded in full because they can be RE-APPLIED: asking
 * for another reading of the same sketch then re-states "the zero is at −2"
 * against the new family, and only falls back to the confirm when the new
 * family refuses. The others cannot be replayed and are remembered only so the
 * board knows the curve is no longer a reading of its ink.
 */
export type CurveEdit =
  | { kind: 'feature'; point: SpecialPoint; to: { x?: number; y?: number } }
  | { kind: 'equation' }
  | { kind: 'handle' }
  | { kind: 'param' }

/** The board-state slice any mutation may change; omitted keys are untouched. */
export interface StatePatch {
  curves?: FittedCurve[]
  items?: NLItem[]
  kind?: BoardKind
  styles?: StyleMap
  exprSources?: Record<string, string>
  brokenExpr?: Record<string, string>
  displaySources?: Record<string, string>
  edits?: Record<string, CurveEdit[]>
  calc?: CalcLink[]
  fields?: BoardField[]
  shapes?: BoardShape[]
  data?: BoardData[]
  sequences?: BoardSequence[]
  unitCircles?: BoardUnitCircle[]
  relatedRates?: BoardRelatedRates[]
  stats?: BoardStat[]
  /** null clears the system's settings; absent leaves them. */
  system?: BoardIneqSystem | null
  names?: Record<string, string>
  calls?: Record<string, string[]>
  inverses?: InverseLink[]
  figure?: FigureStyleId
  caption?: string | null
  /** Undo / redo only: the view settings for curves the patch brings back. */
  views?: CurveViews
  candidates?: Map<string, FitResult[]>
}

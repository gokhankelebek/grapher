import type {
  BoardKind,
  EndCap,
  FitResult,
  FittedCurve,
  ModelSpec,
  NLItem,
  SpecialPoint,
  Vec2,
} from '../core/types'
import type { ReactNode } from 'react'
import type { FactoredSpec } from '../core/factored'
import type { ExpSpec } from '../core/exponential'
import type { LogisticSpec } from '../core/logistic'
import type { LogSpec } from '../core/logarithmic'
import type { StyleMap } from '../App'
import type { NLPart } from '../render/numberline'
import type { DomainActions, DomainPanel, SetNotation } from './domainLinks'
import { CurveCard } from './CurveCard'
import type { BetweenInfo } from './CurveCard'
import type { CurveIntersections } from './intersections'
import type { CalcChange, CalcKind, CardCalc } from './calcLinks'
import { FieldCard } from './FieldCard'
import type { BoardField, FieldCardData } from './fieldLinks'
import type { RunPatch } from './eulerLinks'
import { ShapeCard } from './ShapeCard'
import { DataCard } from './DataCard'
import { SequenceCard } from './SequenceCard'
import { SequenceEditor } from './SequenceEditor'
import type { BoardSequence, SequenceCardData } from './seqLinks'
import type { DataParse } from '../core/data'
import type { BoardData, DataCardData, DataMarker, PasteMode, RegressionKind } from './dataLinks'
import type { BoardShape, ShapeCardData } from './shapeLinks'
import { NLCard } from './NLCard'
import { ExprInput } from './ExprInput'
import { FactorEditor } from './FactorEditor'
import { ExpEditor } from './ExpEditor'
import { LogisticEditor } from './LogisticEditor'
import { LogEditor } from './LogEditor'
import { SinEditor } from './SinEditor'
import { TransformEditor } from './TransformEditor'
import { PiecewiseEditor } from './PiecewiseEditor'
import { ConicEditor } from './ConicEditor'
import { MotionEditor } from './MotionEditor'
import type { MotionPlayState, MotionScales } from './motionLinks'
import type { FunctionEnv } from '../core/functionEnv'
import type { TransformSpec } from '../core/transform'
import type { Theme } from '../core/types'
import type { SinSpec } from '../core/sinusoidal'
import type { InverseSource } from './logLinks'
import { BuildMenu } from './BuildMenu'
import { BoardKindSwitch } from './BoardKindSwitch'

interface Props {
  open: boolean
  /** Which board this is. A number line lists items, not curves. */
  kind: BoardKind
  /** Switch the whole board over. Lossless, and one undo step. */
  onSetKind(kind: BoardKind): void
  items: NLItem[]
  /** Number-line item edits (ignored on a cartesian board). */
  onItemDelete(id: string): void
  onItemCycleColor(id: string): void
  onItemToggleEnd(id: string, part: NLPart): void
  onItemSetBound(id: string, part: NLPart, value: number | null): void
  onItemLabel(id: string, label: string): void
  onItemWidth(id: string, width: number): void
  /** Restate a number-line item from its notation. Error message, or null. */
  onItemEquation(id: string, src: string): string | null
  curves: FittedCurve[]
  styles: StyleMap
  models: Record<string, ModelSpec>
  selectedId: string | null
  exprOpen: boolean
  snapFlash: { id: string; mask: boolean[]; key: number } | null
  shake: { id: string; key: number } | null
  /** curveId -> the equation text, for typed curves. */
  exprSources: Record<string, string>
  /** curveId -> why its equation could not be restored on load. */
  brokenExpr: Record<string, string>
  /** curveId -> the user's own typed form of a curve that is still a family. */
  displaySources: Record<string, string>
  /** curveId -> true once the curve stopped being a reading of its own ink. */
  editedIds: Record<string, boolean>
  /** Special points of the selected curve, in analyzeCurve() order. */
  analysis: SpecialPoint[]
  /** Hovering a listed value emphasises its marker on canvas. */
  onAnalysisHover(index: number | null): void
  /** Type an exact position for a special point. False = refused, keep editing. */
  onFeatureEdit(id: string, index: number, to: { x?: number; y?: number }): boolean
  candidatesFor(id: string): FitResult[]
  onSelect(id: string | null): void
  onDelete(id: string): void
  onDuplicate(id: string): void
  onToggleVisible(id: string): void
  onCycleColor(id: string): void
  onParamChange(id: string, index: number, value: number): void
  onParamEditStart(): void
  onParamEditEnd(): void
  /** Param-slider commit (snap-aware). */
  onParamCommit(id: string): void
  /** Exact typed value commit (inline edit). */
  onParamSetExact(id: string, index: number, value: number): void
  onApplyCandidate(id: string, candidate: FitResult): void
  /** Retype a curve's equation. Error message to show, or null on success. */
  onCurveEquation(id: string, src: string): string | null
  onStrokeWidth(id: string, width: number): void
  onDash(id: string, dash: number[] | undefined): void
  onEnds(id: string, which: 'start' | 'end', cap: EndCap): void
  onOpacity(id: string, opacity: number): void
  onExprToggle(): void
  onExprSubmit(src: string): string | null
  /** "Build from roots" is open at the top of the list. */
  factorOpen?: boolean
  onFactorToggle?(): void
  /** Put a function built from its roots on the board. Error, or null. */
  onFactorBuild?(spec: FactoredSpec, through: Vec2 | null): string | null
  /** Rewrite a typed curve's line in place from its Roots section. */
  onFactorRestate?(id: string, src: string, label: string): string | null
  /** The point a curve was built through, if it was. */
  factorThroughFor?(id: string): Vec2 | null
  onFactorThroughDrop?(id: string): void
  /** "Build ▾ → Exponential" is open at the top of the list. */
  expOpen?: boolean
  onExpToggle?(): void
  /** Put an exponential stated the precalculus way on the board. Error, or null. */
  onExpBuild?(spec: ExpSpec): string | null
  /** Rewrite a typed curve's line in place from its Exponential section. */
  onExpRestate?(id: string, src: string, label: string): string | null
  /** Replace a sketched curve with a typed line, in place. */
  onConvertTyped?(id: string, src: string, label: string): string | null
  /** "Build ▾ → Logarithmic" is open at the top of the list. */
  logOpen?: boolean
  onLogToggle?(): void
  /** Put a logarithm stated the precalculus way on the board. Error, or null. */
  onLogBuild?(spec: LogSpec): string | null
  /** The exponentials on the board "Inverse of…" can pick. */
  logInverseSources?: readonly InverseSource[]
  /** Rewrite a typed curve's line in place from its Logarithmic section. */
  onLogRestate?(id: string, src: string, label: string): string | null
  /** "Show inverse" on an Exponential or Logarithmic section. */
  onShowInverse?(id: string): void
  /** "Build ▾ → Logistic" is open at the top of the list. */
  logisticOpen?: boolean
  onLogisticToggle?(): void
  /** Put a logistic stated the AP way (L, k, y(0)) on the board. Error, or null. */
  onLogisticBuild?(spec: LogisticSpec): string | null
  /** Rewrite a typed curve's line in place from its Logistic section. */
  onLogisticRestate?(id: string, src: string, label: string): string | null
  /** "Show slope field" on a Logistic section. */
  onShowLogisticField?(id: string): void
  /** "Build ▾ → Sinusoidal" is open at the top of the list. */
  sinOpen?: boolean
  onSinToggle?(): void
  /** Put a sinusoid stated the precalculus way on the board. Error, or null. */
  onSinBuild?(spec: SinSpec): string | null
  /** Rewrite a typed curve's line in place from its Sinusoidal section. */
  onSinRestate?(id: string, src: string, label: string): string | null
  /** "Build ▾ → Transformation" is open at the top of the list. */
  transformOpen?: boolean
  onTransformToggle?(): void
  /** Put a transformed parent on the board. Error, or null. */
  onTransformBuild?(spec: TransformSpec): string | null
  /** Rewrite a typed curve's line in place from its Transformation section. */
  onTransformRestate?(id: string, src: string, label: string): string | null
  /** The "show parent" switch's state for a curve; undefined = the section's default. */
  transformShowParentFor?(id: string): boolean | undefined
  onTransformShowParent?(id: string, on: boolean): void
  /** "Build ▾ → Conic" is open at the top of the list. */
  conicOpen?: boolean
  onConicToggle?(): void
  /** Put a conic's standard form on the board. Error, or null. */
  onConicBuild?(src: string): string | null
  /** Rewrite a typed curve's line in place from its Conic section. */
  onConicRestate?(id: string, src: string, label: string): string | null
  /** Whether a conic's construction is figure content (drawn always, exported). */
  conicConstructionFor?(id: string): boolean
  onConicConstruction?(id: string, on: boolean): void
  /** "Build ▾ → Parametric / polar" is open at the top of the list. */
  motionOpen?: boolean
  onMotionToggle?(): void
  /** Put a built parametric or polar line on the board. Error, or null. */
  onMotionBuild?(src: string, tab: 'parametric' | 'polar'): string | null
  /** "Build ▾ → Unit circle": put it on the board (or select the one there). */
  onUnitCircleAdd?(): void
  /** The unit circle's card, rendered by the App (it owns the play state). */
  unitCircleCards?: ReactNode
  /** The inequality system's card (solution region, test point, linear programming). */
  systemCard?: ReactNode
  /** How many unit circles the list holds, for the header count. */
  unitCircleCount?: number
  /** "Build ▾ → Sequence" open at the top of the list. */
  seqOpen?: boolean
  onSeqToggle?(): void
  /** Add a built sequence over n = n0 … n0 + count − 1. Error to show, or null. */
  onSeqBuild?(src: string, n0: number, count: number): string | null
  /** The letter the builder offers a new sequence. */
  seqDefaultName?: string
  /**
   * The sequences on this board. In the SAME list once more: a sequence is an
   * object a teacher typed, with a colour dot and a ⋯ menu — dots, not a curve.
   */
  sequences?: BoardSequence[]
  seqCardFor?(id: string): SequenceCardData | undefined
  onSeqDelete?(id: string): void
  onSeqDuplicate?(id: string): void
  onSeqToggleVisible?(id: string): void
  onSeqCycleColor?(id: string): void
  onSeqZoom?(id: string): void
  onSeqParamChange?(id: string, index: number, value: number): void
  onSeqParamSetExact?(id: string, index: number, value: number): void
  /** Retype a sequence. Error message to show, or null. */
  onSeqEquation?(id: string, src: string): string | null
  onSeqWindow?(id: string, n0: number, count: number): string | null
  onSeqTogglePartner?(id: string): void
  onSeqToggleSums?(id: string): void
  /** The player's state for a parametric / polar curve (the selected one plays). */
  motionFor?(id: string): MotionPlayState | undefined
  /** The vectors' scales on this board for a curve. */
  motionScalesFor?(id: string): MotionScales | undefined
  onMotionPlay?(id: string, patch: Partial<MotionPlayState>): void
  /** Commit a new parameter interval from a card's Motion section. Error, or null. */
  onMotionInterval?(id: string, lo: string, hi: string): string | null
  /** "Build ▾ → Piecewise" is open at the top of the list. */
  piecewiseOpen?: boolean
  onPiecewiseToggle?(): void
  /** Put a piecewise (or step) line on the board. Error, or null. */
  onPiecewiseBuild?(src: string): string | null
  /** Rewrite a typed curve's line in place from its Piecewise section. */
  onPiecewiseRestate?(id: string, src: string, label: string): string | null
  /** The env a rewritten line of curve `id` is parsed against (its calls of named curves). */
  piecewiseEnvFor?(id: string, src: string): FunctionEnv | undefined
  /** The same for a new line from the builder. */
  piecewiseBuildEnv?(src: string): FunctionEnv | undefined
  /** The builder's first name: the next free letter. */
  piecewiseName?: string
  /** Letters curves already hold. */
  takenNames?: readonly string[]
  /** The board's ground, for the transformation gallery's thumbnails. */
  boardTheme?: Theme
  /** What this curve's card says about calculus. Undefined = nothing to say. */
  /**
   * Where each curve meets the OTHERS, already named — the row is the same
   * points on both cards, which is what makes them agree. Absent on a board
   * where nothing crosses.
   */
  intersectionsFor?(id: string): readonly CurveIntersections[] | undefined
  calcFor(id: string): CardCalc | undefined
  onAddCalc(id: string, kind: CalcKind): void
  /** Whether this curve may host an area between curves, and whose it is in. */
  betweenFor(id: string): BetweenInfo | undefined
  /** "Area between curves…" on this curve's menu. */
  onAddAreaBetween(id: string): void
  onCalcChange(change: CalcChange, live?: boolean): void
  onCalcRemove(linkId: string): void
  /**
   * The slope fields on this board. They are in the SAME list as the curves —
   * one column of objects a teacher typed, each with a colour dot, a ⋯ menu
   * and an equation you can click — because that is what they are. Splitting
   * them into a second list would have made "what is on this board?" a
   * question with two answers.
   */
  fields: BoardField[]
  /** Everything one field's card prints, already computed. */
  fieldCardFor(id: string): FieldCardData | undefined
  /** The field whose next board click places a solution curve, if any. */
  armedField: string | null
  onFieldArm(id: string): void
  onFieldDelete(id: string): void
  onFieldToggleVisible(id: string): void
  onFieldCycleColor(id: string): void
  onFieldSpacing(id: string, px: number): void
  onFieldParamChange(id: string, index: number, value: number): void
  onFieldParamSetExact(id: string, index: number, value: number): void
  /** Retype a differential equation. Error message to show, or null. */
  onFieldEquation(id: string, src: string): string | null
  onSolutionSet(fieldId: string, solutionId: string, to: { x?: number; y?: number }): void
  onSolutionRemove(fieldId: string, solutionId: string): void
  onEulerAdd(fieldId: string): void
  onEulerPatch(fieldId: string, runId: string, patch: RunPatch): void
  onEulerRemove(fieldId: string, runId: string): void
  /**
   * The shapes on this board — points, segments, vectors, polygons. In the
   * SAME list again, for the same reason: one column of objects a teacher
   * typed. A board with a triangle and a tangent line on it has ONE list of
   * what is on it.
   */
  shapes: BoardShape[]
  /** Everything one shape's card prints, already computed. */
  shapeCardFor(id: string): ShapeCardData | undefined
  onShapeDelete(id: string): void
  onShapeToggleVisible(id: string): void
  onShapeCycleColor(id: string): void
  onShapeToggleFill(id: string): void
  onShapeParamChange(id: string, index: number, value: number): void
  onShapeParamSetExact(id: string, index: number, value: number): void
  /** Retype a shape. Error message to show, or null. */
  onShapeEquation(id: string, src: string): string | null
  /** Type one exact coordinate, which rewrites that coordinate's source text. */
  onShapeCoord(id: string, pair: number, axis: 'x' | 'y', value: number): void
  /** "Build ▾ → Data table". Absent hides the item. */
  onDataAdd?(): void
  /**
   * The data tables on this board. In the SAME list once more: a table is an
   * object a teacher put on the board, with a colour dot and a ⋯ menu.
   */
  data?: BoardData[]
  dataCardFor?(id: string): DataCardData | undefined
  onDataDelete?(id: string): void
  onDataDuplicate?(id: string): void
  onDataToggleVisible?(id: string): void
  onDataCycleColor?(id: string): void
  onDataZoom?(id: string): void
  onDataMarker?(id: string, marker: DataMarker): void
  onDataCell?(id: string, row: number, col: 'x' | 'y', text: string): void
  onDataLabel?(id: string, col: 'x' | 'y', text: string): void
  onDataRemoveRow?(id: string, row: number): void
  onDataPaste?(id: string, parse: DataParse, mode: PasteMode): void
  onRegressionAdd?(id: string, kind: RegressionKind): string | null
  onRegressionRemove?(id: string, regId: string): void
  onRegressionDigits?(id: string, regId: string, digits: number): void
  onRegressionResiduals?(id: string, regId: string): void
  onRegressionRefit?(id: string, regId: string): void
  /**
   * What each card is called (f, g, f′, f⁻¹), keyed by curve id — shown as the
   * chip in its header. Absent: no chips.
   */
  cardNames?: Readonly<Record<string, string>>
  /** The curves that hold a letter of their own (their chip renames). */
  storedNames?: Readonly<Record<string, string>>
  /** Rename a curve; every line calling it follows. Refusal, or null. */
  onRename?(id: string, letter: string): string | null
  /** Why a typed line that calls another curve can't be drawn, per curve. */
  linkErrors?: Readonly<Record<string, string>>
  /** A read-only line under a card's equation (an inverse's horizontal line test). */
  cardNotes?: Readonly<Record<string, string>>
  /** "Show inverse" on any explicit curve's ⋯ menu. */
  onShowInverseOf?(id: string): void
  /** curveId -> the state of the curves that line calls (memo keys). */
  depKeys?: Readonly<Record<string, string>>
  /** The board's callable names, offered as chips in the equation box. */
  exprNames?: readonly string[]
  /** Domain / range / one-to-one / inverse rows for the selected card (src/ui/DomainSection.tsx). */
  domainPanelFor?(id: string): DomainPanel | undefined
  domainActions?: DomainActions
  setNotation?: SetNotation
}

const NO_DATA: BoardData[] = []
const NO_SEQS: BoardSequence[] = []
const noop = (): void => {}

/** Stable empty array for the cards that aren't selected. */
const EMPTY_ANALYSIS: SpecialPoint[] = []

export function Sidebar({
  open,
  kind,
  onSetKind,
  items,
  onItemDelete,
  onItemCycleColor,
  onItemToggleEnd,
  onItemSetBound,
  onItemLabel,
  onItemWidth,
  onItemEquation,
  curves,
  styles,
  models,
  selectedId,
  exprOpen,
  snapFlash,
  shake,
  exprSources,
  brokenExpr,
  displaySources,
  editedIds,
  analysis,
  onAnalysisHover,
  onFeatureEdit,
  candidatesFor,
  onSelect,
  onDelete,
  onDuplicate,
  onToggleVisible,
  onCycleColor,
  onParamChange,
  onParamEditStart,
  onParamEditEnd,
  onParamCommit,
  onParamSetExact,
  onApplyCandidate,
  onCurveEquation,
  onStrokeWidth,
  onDash,
  onEnds,
  onOpacity,
  onExprToggle,
  onExprSubmit,
  factorOpen = false,
  onFactorToggle,
  onFactorBuild,
  onFactorRestate,
  factorThroughFor,
  onFactorThroughDrop,
  expOpen = false,
  onExpToggle,
  onExpBuild,
  onExpRestate,
  onConvertTyped,
  logOpen = false,
  onLogToggle,
  onLogBuild,
  logInverseSources,
  onLogRestate,
  logisticOpen = false,
  onLogisticToggle,
  onLogisticBuild,
  onLogisticRestate,
  onShowLogisticField,
  sinOpen = false,
  onSinToggle,
  onSinBuild,
  onSinRestate,
  transformOpen = false,
  onTransformToggle,
  onTransformBuild,
  onTransformRestate,
  transformShowParentFor,
  onTransformShowParent,
  conicOpen = false,
  onConicToggle,
  onConicBuild,
  onConicRestate,
  conicConstructionFor,
  onConicConstruction,
  motionOpen = false,
  onMotionToggle,
  onMotionBuild,
  seqOpen = false,
  onUnitCircleAdd,
  unitCircleCards,
  systemCard,
  unitCircleCount = 0,
  onSeqToggle,
  onSeqBuild,
  seqDefaultName,
  sequences = NO_SEQS,
  seqCardFor,
  onSeqDelete = noop,
  onSeqDuplicate = noop,
  onSeqToggleVisible = noop,
  onSeqCycleColor = noop,
  onSeqZoom = noop,
  onSeqParamChange = noop,
  onSeqParamSetExact = noop,
  onSeqEquation = () => null,
  onSeqWindow = () => null,
  onSeqTogglePartner = noop,
  onSeqToggleSums = noop,
  motionFor,
  motionScalesFor,
  onMotionPlay,
  onMotionInterval,
  piecewiseOpen = false,
  onPiecewiseToggle,
  onPiecewiseBuild,
  onPiecewiseRestate,
  piecewiseEnvFor,
  piecewiseBuildEnv,
  piecewiseName,
  takenNames,
  boardTheme,
  onShowInverse,
  intersectionsFor,
  calcFor,
  onAddCalc,
  betweenFor,
  onAddAreaBetween,
  onCalcChange,
  onCalcRemove,
  fields,
  fieldCardFor,
  armedField,
  onFieldArm,
  onFieldDelete,
  onFieldToggleVisible,
  onFieldCycleColor,
  onFieldSpacing,
  onFieldParamChange,
  onFieldParamSetExact,
  onFieldEquation,
  onSolutionSet,
  onSolutionRemove,
  onEulerAdd,
  onEulerPatch,
  onEulerRemove,
  shapes,
  shapeCardFor,
  onShapeDelete,
  onShapeToggleVisible,
  onShapeCycleColor,
  onShapeToggleFill,
  onShapeParamChange,
  onShapeParamSetExact,
  onShapeEquation,
  onShapeCoord,
  onDataAdd,
  data = NO_DATA,
  dataCardFor,
  onDataDelete = noop,
  onDataDuplicate = noop,
  onDataToggleVisible = noop,
  onDataCycleColor = noop,
  onDataZoom = noop,
  onDataMarker = noop,
  onDataCell = noop,
  onDataLabel = noop,
  onDataRemoveRow = noop,
  onDataPaste = noop,
  onRegressionAdd = () => null,
  onRegressionRemove = noop,
  onRegressionDigits = noop,
  onRegressionResiduals = noop,
  onRegressionRefit = noop,
  cardNames,
  storedNames,
  onRename,
  linkErrors,
  cardNotes,
  onShowInverseOf,
  depKeys,
  domainPanelFor,
  domainActions,
  setNotation,
  exprNames,
}: Props) {
  const numberLine = kind === 'number-line'

  return (
    <aside className={`sidebar${open ? '' : ' sidebar-closed'}`}>
      <div className="sidebar-inner">
        <div className="sidebar-head">
          <BoardKindSwitch kind={kind} onSetKind={onSetKind} />
          <div className="sidebar-head-row">
            <span className="sidebar-title">{numberLine ? 'Solution set' : 'Curves'}</span>
            <span className="sidebar-count">
              {numberLine
                ? items.length
                : curves.length + fields.length + shapes.length + data.length + sequences.length + unitCircleCount}
            </span>
            <button
              className={`add-btn${exprOpen ? ' add-open' : ''}`}
              title={
                exprOpen
                  ? 'Close input (Esc)'
                  : numberLine
                    ? 'Type an inequality'
                    : 'Type an equation'
              }
              aria-label={numberLine ? 'Type an inequality' : 'Type an equation'}
              onClick={onExprToggle}
            >
              +
            </button>
            {!numberLine && (onFactorToggle || onExpToggle || onLogisticToggle || onLogToggle || onSinToggle || onTransformToggle || onPiecewiseToggle || onConicToggle || onMotionToggle || onSeqToggle || onDataAdd || onUnitCircleAdd) && (
              <BuildMenu
                factorOpen={factorOpen}
                expOpen={expOpen}
                logOpen={logOpen}
                onFactorToggle={onFactorToggle}
                onExpToggle={onExpToggle}
                logisticOpen={logisticOpen}
                onLogisticToggle={onLogisticToggle}
                onLogToggle={onLogToggle}
                sinOpen={sinOpen}
                onSinToggle={onSinToggle}
                transformOpen={transformOpen}
                onTransformToggle={onTransformToggle}
                piecewiseOpen={piecewiseOpen}
                onPiecewiseToggle={onPiecewiseToggle}
                conicOpen={conicOpen}
                onConicToggle={onConicToggle}
                motionOpen={motionOpen}
                onMotionToggle={onMotionToggle}
                seqOpen={seqOpen}
                onSeqToggle={onSeqToggle}
                onDataAdd={onDataAdd}
                onUnitCircleAdd={onUnitCircleAdd}
              />
            )}
          </div>
        </div>
        <div className="sidebar-list">
          {!numberLine && factorOpen && onFactorBuild && onFactorToggle && (
            <FactorEditor onBuild={onFactorBuild} onClose={onFactorToggle} />
          )}
          {!numberLine && expOpen && onExpBuild && onExpToggle && (
            <ExpEditor onBuild={onExpBuild} onClose={onExpToggle} />
          )}
          {!numberLine && logisticOpen && onLogisticBuild && onLogisticToggle && (
            <LogisticEditor onBuild={onLogisticBuild} onClose={onLogisticToggle} />
          )}
          {!numberLine && logOpen && onLogBuild && onLogToggle && (
            <LogEditor onBuild={onLogBuild} onClose={onLogToggle} sources={logInverseSources} />
          )}
          {!numberLine && sinOpen && onSinBuild && onSinToggle && (
            <SinEditor onBuild={onSinBuild} onClose={onSinToggle} />
          )}
          {!numberLine && transformOpen && onTransformBuild && onTransformToggle && (
            <TransformEditor onBuild={onTransformBuild} onClose={onTransformToggle} theme={boardTheme} />
          )}
          {!numberLine && piecewiseOpen && onPiecewiseBuild && onPiecewiseToggle && (
            <PiecewiseEditor
              onAdd={onPiecewiseBuild}
              onClose={onPiecewiseToggle}
              envFor={piecewiseBuildEnv}
              defaultName={piecewiseName}
              takenNames={takenNames}
            />
          )}
          {!numberLine && conicOpen && onConicBuild && onConicToggle && (
            <ConicEditor onBuild={onConicBuild} onClose={onConicToggle} />
          )}
          {!numberLine && motionOpen && onMotionBuild && onMotionToggle && (
            <MotionEditor onBuild={onMotionBuild} onClose={onMotionToggle} />
          )}
          {!numberLine && seqOpen && onSeqBuild && onSeqToggle && (
            <SequenceEditor onBuild={onSeqBuild} onClose={onSeqToggle} defaultName={seqDefaultName} />
          )}
          {exprOpen && (
            <ExprInput
              onSubmit={onExprSubmit}
              onClose={onExprToggle}
              names={numberLine ? undefined : exprNames}
              placeholder={
                numberLine
                  ? '-2 <= x < 5'
                  : 'y = 2sin(3x) + 1   ·   dy/dx = x - y   ·   ABC = (0,0) (4,0) (4,3)'
              }
            />
          )}
          {numberLine &&
            items.map((item) => (
              <NLCard
                key={item.id}
                item={item}
                style={styles[item.id]}
                selected={item.id === selectedId}
                onSelect={() => onSelect(item.id)}
                onDelete={() => onItemDelete(item.id)}
                onCycleColor={() => onItemCycleColor(item.id)}
                onToggleEnd={(part) => onItemToggleEnd(item.id, part)}
                onSetBound={(part, value) => onItemSetBound(item.id, part, value)}
                onLabel={(label) => onItemLabel(item.id, label)}
                onEquationCommit={(src) => onItemEquation(item.id, src)}
                onDash={(d) => onDash(item.id, d)}
                onOpacity={(o) => onOpacity(item.id, o)}
                onWidth={(w) => onItemWidth(item.id, w)}
                onStyleEditStart={onParamEditStart}
                onStyleEditEnd={onParamEditEnd}
              />
            ))}
          {!numberLine &&
            curves.map((curve) => (
            <CurveCard
              key={curve.id}
              curve={curve}
              style={styles[curve.id]}
              models={models}
              selected={curve.id === selectedId}
              candidates={candidatesFor(curve.id)}
              snapMask={snapFlash && snapFlash.id === curve.id ? snapFlash.mask : null}
              snapKey={snapFlash && snapFlash.id === curve.id ? snapFlash.key : 0}
              shaking={shake !== null && shake.id === curve.id}
              exprSource={exprSources[curve.id]}
              displaySource={displaySources[curve.id]}
              brokenReason={brokenExpr[curve.id]}
              edited={editedIds[curve.id] === true}
              analysis={curve.id === selectedId ? analysis : EMPTY_ANALYSIS}
              intersections={intersectionsFor?.(curve.id)}
              onAnalysisHover={onAnalysisHover}
              onFeatureEdit={(i, to) => onFeatureEdit(curve.id, i, to)}
              onSelect={() => onSelect(curve.id)}
              onDelete={() => onDelete(curve.id)}
              onDuplicate={() => onDuplicate(curve.id)}
              onToggleVisible={() => onToggleVisible(curve.id)}
              onCycleColor={() => onCycleColor(curve.id)}
              onParamChange={(i, v) => onParamChange(curve.id, i, v)}
              onParamEditStart={onParamEditStart}
              onParamEditEnd={onParamEditEnd}
              onParamCommit={() => onParamCommit(curve.id)}
              onParamSetExact={(i, v) => onParamSetExact(curve.id, i, v)}
              onApplyCandidate={(c) => onApplyCandidate(curve.id, c)}
              onEquationCommit={(src) => onCurveEquation(curve.id, src)}
              onStrokeWidth={(w) => onStrokeWidth(curve.id, w)}
              onDash={(d) => onDash(curve.id, d)}
              onEnds={(which, cap) => onEnds(curve.id, which, cap)}
              onOpacity={(o) => onOpacity(curve.id, o)}
              calc={calcFor(curve.id)}
              onAddCalc={(kind) => onAddCalc(curve.id, kind)}
              between={betweenFor(curve.id)}
              onAddAreaBetween={() => onAddAreaBetween(curve.id)}
              onCalcChange={onCalcChange}
              onCalcRemove={onCalcRemove}
              onFactorRestate={
                onFactorRestate
                  ? (src, label) => onFactorRestate(curve.id, src, label)
                  : undefined
              }
              factorThrough={factorThroughFor?.(curve.id) ?? null}
              onFactorThroughDrop={
                onFactorThroughDrop ? () => onFactorThroughDrop(curve.id) : undefined
              }
              onExpRestate={
                onExpRestate ? (src, label) => onExpRestate(curve.id, src, label) : undefined
              }
              onConvertTyped={
                onConvertTyped ? (src, label) => onConvertTyped(curve.id, src, label) : undefined
              }
              onLogRestate={
                onLogRestate ? (src, label) => onLogRestate(curve.id, src, label) : undefined
              }
              onShowInverse={onShowInverse ? () => onShowInverse(curve.id) : undefined}
              onSinRestate={
                onSinRestate ? (src, label) => onSinRestate(curve.id, src, label) : undefined
              }
              onLogisticRestate={
                onLogisticRestate ? (src, label) => onLogisticRestate(curve.id, src, label) : undefined
              }
              onShowLogisticField={onShowLogisticField ? () => onShowLogisticField(curve.id) : undefined}
              onTransformRestate={
                onTransformRestate
                  ? (src, label) => onTransformRestate(curve.id, src, label)
                  : undefined
              }
              onPiecewiseRestate={
                onPiecewiseRestate
                  ? (src, label) => onPiecewiseRestate(curve.id, src, label)
                  : undefined
              }
              piecewiseEnvFor={piecewiseEnvFor ? (src) => piecewiseEnvFor(curve.id, src) : undefined}
              onConicRestate={
                onConicRestate ? (src, label) => onConicRestate(curve.id, src, label) : undefined
              }
              conicConstruction={conicConstructionFor?.(curve.id)}
              motion={motionFor?.(curve.id)}
              motionScales={motionScalesFor?.(curve.id)}
              onMotionPlay={onMotionPlay ? (patch) => onMotionPlay(curve.id, patch) : undefined}
              onMotionInterval={
                onMotionInterval ? (lo, hi) => onMotionInterval(curve.id, lo, hi) : undefined
              }
              onConicConstruction={
                onConicConstruction ? (on) => onConicConstruction(curve.id, on) : undefined
              }
              transformShowParent={transformShowParentFor?.(curve.id)}
              onTransformShowParent={
                onTransformShowParent ? (on) => onTransformShowParent(curve.id, on) : undefined
              }
              name={cardNames?.[curve.id]}
              nameEditable={storedNames?.[curve.id] !== undefined}
              onRename={onRename ? (letter) => onRename(curve.id, letter) : undefined}
              linkError={linkErrors?.[curve.id]}
              note={cardNotes?.[curve.id]}
              onShowInverseOf={onShowInverseOf ? () => onShowInverseOf(curve.id) : undefined}
              depKey={depKeys?.[curve.id]}
              domainPanel={curve.id === selectedId ? domainPanelFor?.(curve.id) : undefined}
              domainActions={domainActions}
              setNotation={setNotation}
            />
          ))}
          {!numberLine && systemCard}
          {!numberLine &&
            fields.map((field) => {
              const data = fieldCardFor(field.id)
              if (!data) return null
              return (
                <FieldCard
                  key={field.id}
                  field={field}
                  data={data}
                  selected={field.id === selectedId}
                  arming={armedField === field.id || field.id === selectedId}
                  onSelect={() => onSelect(field.id)}
                  onDelete={() => onFieldDelete(field.id)}
                  onToggleVisible={() => onFieldToggleVisible(field.id)}
                  onCycleColor={() => onFieldCycleColor(field.id)}
                  onArmSolution={() => onFieldArm(field.id)}
                  onSpacing={(px) => onFieldSpacing(field.id, px)}
                  onParamChange={(i, v) => onFieldParamChange(field.id, i, v)}
                  onParamEditStart={onParamEditStart}
                  onParamEditEnd={onParamEditEnd}
                  onParamSetExact={(i, v) => onFieldParamSetExact(field.id, i, v)}
                  onEquationCommit={(src) => onFieldEquation(field.id, src)}
                  onSolutionSet={(solId, to) => onSolutionSet(field.id, solId, to)}
                  onSolutionRemove={(solId) => onSolutionRemove(field.id, solId)}
                  onEulerAdd={() => onEulerAdd(field.id)}
                  onEulerPatch={(runId, patch) => onEulerPatch(field.id, runId, patch)}
                  onEulerRemove={(runId) => onEulerRemove(field.id, runId)}
                />
              )
            })}
          {!numberLine &&
            shapes.map((shape) => {
              const data = shapeCardFor(shape.id)
              if (!data) return null
              return (
                <ShapeCard
                  key={shape.id}
                  shape={shape}
                  data={data}
                  selected={shape.id === selectedId}
                  onSelect={() => onSelect(shape.id)}
                  onDelete={() => onShapeDelete(shape.id)}
                  onToggleVisible={() => onShapeToggleVisible(shape.id)}
                  onCycleColor={() => onShapeCycleColor(shape.id)}
                  onToggleFill={() => onShapeToggleFill(shape.id)}
                  onParamChange={(i, v) => onShapeParamChange(shape.id, i, v)}
                  onParamEditStart={onParamEditStart}
                  onParamEditEnd={onParamEditEnd}
                  onParamSetExact={(i, v) => onShapeParamSetExact(shape.id, i, v)}
                  onEquationCommit={(src) => onShapeEquation(shape.id, src)}
                  onCoordSet={(pair, axis, v) => onShapeCoord(shape.id, pair, axis, v)}
                />
              )
            })}
          {!numberLine &&
            data.map((table) => {
              const card = dataCardFor?.(table.id)
              if (!card) return null
              return (
                <DataCard
                  key={table.id}
                  data={table}
                  card={card}
                  selected={table.id === selectedId}
                  onSelect={() => onSelect(table.id)}
                  onDelete={() => onDataDelete(table.id)}
                  onDuplicate={() => onDataDuplicate(table.id)}
                  onToggleVisible={() => onDataToggleVisible(table.id)}
                  onCycleColor={() => onDataCycleColor(table.id)}
                  onZoom={() => onDataZoom(table.id)}
                  onMarker={(m) => onDataMarker(table.id, m)}
                  onCell={(row, col, text) => onDataCell(table.id, row, col, text)}
                  onLabel={(col, text) => onDataLabel(table.id, col, text)}
                  onRemoveRow={(row) => onDataRemoveRow(table.id, row)}
                  onPaste={(parse, mode) => onDataPaste(table.id, parse, mode)}
                  onAddRegression={(kind) => onRegressionAdd(table.id, kind)}
                  onRemoveRegression={(regId) => onRegressionRemove(table.id, regId)}
                  onDigits={(regId, d) => onRegressionDigits(table.id, regId, d)}
                  onResiduals={(regId) => onRegressionResiduals(table.id, regId)}
                  onRefit={(regId) => onRegressionRefit(table.id, regId)}
                />
              )
            })}
          {!numberLine &&
            sequences.map((q) => {
              const card = seqCardFor?.(q.id)
              if (!card) return null
              return (
                <SequenceCard
                  key={q.id}
                  seq={q}
                  card={card}
                  selected={q.id === selectedId}
                  onSelect={() => onSelect(q.id)}
                  onDelete={() => onSeqDelete(q.id)}
                  onDuplicate={() => onSeqDuplicate(q.id)}
                  onToggleVisible={() => onSeqToggleVisible(q.id)}
                  onCycleColor={() => onSeqCycleColor(q.id)}
                  onZoom={() => onSeqZoom(q.id)}
                  onParamChange={(i, v) => onSeqParamChange(q.id, i, v)}
                  onParamEditStart={onParamEditStart}
                  onParamEditEnd={onParamEditEnd}
                  onParamSetExact={(i, v) => onSeqParamSetExact(q.id, i, v)}
                  onEquationCommit={(src) => onSeqEquation(q.id, src)}
                  onWindow={(n0, count) => onSeqWindow(q.id, n0, count)}
                  onTogglePartner={() => onSeqTogglePartner(q.id)}
                  onToggleSums={() => onSeqToggleSums(q.id)}
                />
              )
            })}
          {!numberLine && unitCircleCards}
        </div>
      </div>
    </aside>
  )
}

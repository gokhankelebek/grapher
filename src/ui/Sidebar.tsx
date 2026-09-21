import type {
  BoardKind,
  EndCap,
  FitResult,
  FittedCurve,
  ModelSpec,
  NLItem,
  SpecialPoint,
} from '../core/types'
import type { StyleMap } from '../App'
import type { NLPart } from '../render/numberline'
import { CurveCard } from './CurveCard'
import type { BetweenInfo } from './CurveCard'
import type { CurveIntersections } from './intersections'
import type { CalcChange, CalcKind, CardCalc } from './calcLinks'
import { FieldCard } from './FieldCard'
import type { BoardField, FieldCardData } from './fieldLinks'
import { ShapeCard } from './ShapeCard'
import type { BoardShape, ShapeCardData } from './shapeLinks'
import { NLCard } from './NLCard'
import { ExprInput } from './ExprInput'
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
}

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
              {numberLine ? items.length : curves.length + fields.length + shapes.length}
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
          </div>
        </div>
        <div className="sidebar-list">
          {exprOpen && (
            <ExprInput
              onSubmit={onExprSubmit}
              onClose={onExprToggle}
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
            />
          ))}
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
        </div>
      </div>
    </aside>
  )
}

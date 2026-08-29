import type { FitResult, FittedCurve, ModelSpec } from '../core/types'
import type { StyleMap } from '../App'
import { CurveCard } from './CurveCard'
import { ExprInput } from './ExprInput'

interface Props {
  open: boolean
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
  onStrokeWidth(id: string, width: number): void
  onDash(id: string, dash: number[] | undefined): void
  onOpacity(id: string, opacity: number): void
  onExprToggle(): void
  onExprSubmit(src: string): string | null
}

export function Sidebar({
  open,
  curves,
  styles,
  models,
  selectedId,
  exprOpen,
  snapFlash,
  shake,
  exprSources,
  brokenExpr,
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
  onStrokeWidth,
  onDash,
  onOpacity,
  onExprToggle,
  onExprSubmit,
}: Props) {
  return (
    <aside className={`sidebar${open ? '' : ' sidebar-closed'}`}>
      <div className="sidebar-inner">
        <div className="sidebar-head">
          <span className="sidebar-title">Curves</span>
          <span className="sidebar-count">{curves.length}</span>
          <button
            className={`add-btn${exprOpen ? ' add-open' : ''}`}
            title={exprOpen ? 'Close equation input (Esc)' : 'Type an equation'}
            aria-label="Type an equation"
            onClick={onExprToggle}
          >
            +
          </button>
        </div>
        <div className="sidebar-list">
          {exprOpen && <ExprInput onSubmit={onExprSubmit} onClose={onExprToggle} />}
          {curves.length === 0 && !exprOpen && (
            <div className="sidebar-empty">
              Nothing here yet.
              <br />
              Sketch on the canvas — or press + and type an equation.
            </div>
          )}
          {curves.map((curve) => (
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
              brokenReason={brokenExpr[curve.id]}
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
              onStrokeWidth={(w) => onStrokeWidth(curve.id, w)}
              onDash={(d) => onDash(curve.id, d)}
              onOpacity={(o) => onOpacity(curve.id, o)}
            />
          ))}
        </div>
      </div>
    </aside>
  )
}

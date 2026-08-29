import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { FitResult, FittedCurve, ModelSpec, ParamMeta } from '../core/types'
import type { CurveStyle } from '../App'
import { Latex } from './Latex'

interface Props {
  curve: FittedCurve
  style: CurveStyle | undefined
  models: Record<string, ModelSpec>
  selected: boolean
  candidates: FitResult[]
  /** Which params just snapped (accent pulse), or null. */
  snapMask: boolean[] | null
  snapKey: number
  /** Brief shake after a failed oversketch. */
  shaking: boolean
  onSelect(): void
  onDelete(): void
  onDuplicate(): void
  onToggleVisible(): void
  onCycleColor(): void
  onParamChange(index: number, value: number): void
  onParamEditStart(): void
  onParamEditEnd(): void
  /** Param-slider commit (snap-aware, replaces plain onParamEditEnd for params). */
  onParamCommit(): void
  /** Exact typed value (inline edit), undoable. */
  onParamSetExact(index: number, value: number): void
  onApplyCandidate(candidate: FitResult): void
  onStrokeWidth(width: number): void
  onDash(dash: number[] | undefined): void
  onOpacity(opacity: number): void
}

const DASH_STYLES: { key: string; label: string; title: string; dash: number[] | undefined }[] = [
  { key: 'solid', label: '━', title: 'Solid line', dash: undefined },
  { key: 'dashed', label: '╍ ╍', title: 'Dashed line', dash: [8, 6] },
  { key: 'dotted', label: '· · ·', title: 'Dotted line', dash: [2, 5] },
]

export function formatError(err: number): string {
  if (!Number.isFinite(err)) return '—'
  if (err !== 0 && Math.abs(err) < 0.001) return err.toExponential(1)
  return err.toFixed(3)
}

/** Fixed-precision readout: 4 significant digits, consistent width. */
function formatValue(v: number): string {
  if (!Number.isFinite(v)) return '—'
  if (v === 0) return '0.000'
  const abs = Math.abs(v)
  if (abs >= 1e5 || abs < 1e-3) return v.toExponential(2)
  return v.toPrecision(4)
}

/** Filled-track stop for a range input (consumed by the --fill token in CSS). */
function fillStyle(value: number, min: number, max: number): CSSProperties {
  const span = max - min || 1
  const pct = Math.max(0, Math.min(100, ((value - min) / span) * 100))
  return { '--fill': `${pct}%` } as CSSProperties
}

export function CurveCard({
  curve,
  style,
  models,
  selected,
  candidates,
  snapMask,
  snapKey,
  shaking,
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
}: Props) {
  const spec: ModelSpec | undefined = models[curve.modelId]
  const isExpression = curve.modelId.startsWith('expr_')

  // Inline coefficient editing.
  const [editing, setEditing] = useState<{ index: number; text: string; bad: boolean } | null>(
    null,
  )
  const editInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (editing) editInputRef.current?.select()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.index])
  useEffect(() => {
    if (!selected && editing) setEditing(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  const latexStr = useMemo(() => {
    try {
      return spec ? spec.latex(curve.params) : curve.modelId
    } catch {
      return curve.modelId
    }
  }, [spec, curve.params, curve.modelId])

  // Freeze slider ranges while this card is expanded so paramMeta (which
  // centers ranges on current values) doesn't re-center under a drag.
  const meta: ParamMeta[] = useMemo(() => {
    if (!selected || !spec) return []
    try {
      return spec.paramMeta(curve.params)
    } catch {
      return []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, spec, curve.id, curve.modelId])

  const modelName = (() => {
    try {
      return spec?.name ?? curve.modelId
    } catch {
      return curve.modelId
    }
  })()

  const activeDashKey =
    DASH_STYLES.find((d) => JSON.stringify(d.dash) === JSON.stringify(style?.dash))?.key ?? 'solid'

  const commitInlineEdit = (): void => {
    if (!editing) return
    const v = Number(editing.text.trim())
    if (editing.text.trim() === '' || !Number.isFinite(v)) {
      setEditing({ ...editing, bad: true })
      return
    }
    onParamSetExact(editing.index, v)
    setEditing(null)
  }

  return (
    <div
      className={`card${selected ? ' card-selected' : ''}${curve.visible ? '' : ' card-hidden'}${
        shaking ? ' card-shake' : ''
      }`}
      style={{ '--curve': curve.color } as CSSProperties}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${modelName} curve${curve.visible ? '' : ', hidden'}`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
    >
      <div className="card-head">
        <button
          className="color-dot"
          style={{ background: curve.color }}
          title="Change color"
          aria-label="Change curve color"
          onClick={(e) => {
            e.stopPropagation()
            onCycleColor()
          }}
        />
        <div className="card-formula">
          <Latex tex={latexStr} className="card-latex" />
        </div>
        <button
          className="icon-btn dup"
          title="Duplicate curve"
          aria-label="Duplicate curve"
          onClick={(e) => {
            e.stopPropagation()
            onDuplicate()
          }}
        >
          <svg width="13" height="13" viewBox="0 0 15 15" fill="none" aria-hidden="true">
            <rect x="1.5" y="4.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M4.5 4.5v-1a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-1" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
        <button
          className={`icon-btn eye${curve.visible ? '' : ' eye-off'}`}
          title={curve.visible ? 'Hide curve' : 'Show curve'}
          aria-label={curve.visible ? 'Hide curve' : 'Show curve'}
          onClick={(e) => {
            e.stopPropagation()
            onToggleVisible()
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <circle cx="12" cy="12" r="2.8" stroke="currentColor" strokeWidth="1.8" />
            {!curve.visible && (
              <line x1="4" y1="20" x2="20" y2="4" stroke="currentColor" strokeWidth="1.8" />
            )}
          </svg>
        </button>
        <button
          className="icon-btn del"
          title="Delete curve (Del)"
          aria-label="Delete curve"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="card-sub">
        <span className="model-name">{modelName}</span>
        {isExpression ? (
          <span className="err-badge" title="Typed expression">
            typed
          </span>
        ) : (
          <span className="err-badge" title="RMS fit error (math units)">
            σ {formatError(curve.error)}
          </span>
        )}
      </div>

      {selected && (
        <div className="card-body" onClick={(e) => e.stopPropagation()}>
          {meta.length > 0 && (
            <div className="param-list">
              {meta.map((m, i) => {
                const value = curve.params[i] ?? 0
                const isEditing = editing?.index === i
                const snapped = snapMask?.[i] === true
                return (
                  <div className="param-row" key={`${curve.modelId}-${m.name}-${i}`}>
                    <span className="param-name">
                      <Latex tex={m.name} />
                    </span>
                    <input
                      type="range"
                      min={m.min}
                      max={m.max}
                      step={m.step}
                      value={value}
                      style={fillStyle(value, m.min, m.max)}
                      onPointerDown={onParamEditStart}
                      onPointerUp={onParamCommit}
                      onKeyDown={onParamEditStart}
                      onKeyUp={onParamCommit}
                      onBlur={onParamEditEnd}
                      onChange={(e) => onParamChange(i, Number(e.target.value))}
                    />
                    {isEditing ? (
                      <input
                        ref={editInputRef}
                        className={`param-edit${editing.bad ? ' param-edit-bad' : ''}`}
                        type="text"
                        inputMode="decimal"
                        spellCheck={false}
                        value={editing.text}
                        onChange={(e) => setEditing({ index: i, text: e.target.value, bad: false })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            commitInlineEdit()
                          } else if (e.key === 'Escape') {
                            e.preventDefault()
                            setEditing(null)
                          }
                        }}
                        onBlur={() => setEditing(null)}
                      />
                    ) : (
                      <button
                        key={snapped ? snapKey : 0}
                        className={`param-value${snapped ? ' param-snap' : ''}`}
                        title="Click to type an exact value"
                        onClick={() =>
                          setEditing({ index: i, text: String(value), bad: false })
                        }
                      >
                        {formatValue(value)}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <div className="style-row">
            <input
              type="range"
              className="style-slider"
              title="Stroke width"
              min={1}
              max={6}
              step={0.5}
              value={curve.strokeWidth}
              style={fillStyle(curve.strokeWidth, 1, 6)}
              onPointerDown={onParamEditStart}
              onPointerUp={onParamEditEnd}
              onKeyDown={onParamEditStart}
              onKeyUp={onParamEditEnd}
              onBlur={onParamEditEnd}
              onChange={(e) => onStrokeWidth(Number(e.target.value))}
            />
            <div className="dash-seg" role="group" aria-label="Line style">
              {DASH_STYLES.map((d) => (
                <button
                  key={d.key}
                  className={`dash-btn${activeDashKey === d.key ? ' dash-on' : ''}`}
                  title={d.title}
                  onClick={() => onDash(d.dash)}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <input
              type="range"
              className="style-slider"
              title="Opacity"
              min={0.1}
              max={1}
              step={0.05}
              value={style?.opacity ?? 1}
              style={fillStyle(style?.opacity ?? 1, 0.1, 1)}
              onPointerDown={onParamEditStart}
              onPointerUp={onParamEditEnd}
              onKeyDown={onParamEditStart}
              onKeyUp={onParamEditEnd}
              onBlur={onParamEditEnd}
              onChange={(e) => onOpacity(Number(e.target.value))}
            />
          </div>

          {!isExpression && candidates.length > 1 && (
            <div className="cand-section">
              <div className="cand-title">Interpretations</div>
              <div className="cand-list">
                {candidates.map((cand, i) => {
                  const candSpec: ModelSpec | undefined = models[cand.modelId]
                  const active = cand.modelId === curve.modelId
                  return (
                    <button
                      key={`${cand.modelId}-${i}`}
                      className={`cand-item${active ? ' cand-active' : ''}`}
                      title={`Reinterpret as ${candSpec?.name ?? cand.modelId}`}
                      onClick={() => onApplyCandidate(cand)}
                    >
                      <span className="cand-name">{candSpec?.name ?? cand.modelId}</span>
                      <span className="cand-err">σ {formatError(cand.error)}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

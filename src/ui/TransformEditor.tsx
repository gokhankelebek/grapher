import { useEffect, useMemo, useRef, useState } from 'react'
import type { ParentId, TransformSpec } from '../core/transform'
import type { Theme } from '../core/types'
import { DARK_THEME } from '../core/types'
import { Latex } from './Latex'
import { XField, badText } from './ExpEditor'
import { renderBoard } from './renderBoard'
import {
  PARENT_IDS,
  PARENT_SHORT,
  PARENT_TEXT,
  SLIDER,
  TRANSFORM_FIELD_LABEL,
  blankTransformDraft,
  commitTransformSpec,
  featureLines,
  parentOf,
  parentThumbScene,
  pointRows,
  setTransformField,
  sliderText,
  sliderValue,
  specFromDraft,
  stepSentences,
  transformPreview,
  withParent,
} from './transformLinks'
import type { PointRow, TransformDraft, TransformField } from './transformLinks'

// ============================================================================
// src/ui/TransformEditor.tsx — a function as a TRANSFORMED PARENT.
//
//     y = a·f(b(x − h)) + k
//
// The sibling of SinEditor.tsx, in the same two places:
//
//   * TransformEditor, "Build ▾ → Transformation". A gallery of the sixteen
//     parents — each tile a real board drawn by renderBoard, as the figure
//     style picker's thumbnails are — and a, b, h, k as fields (expressions
//     accepted: pi/2, 1/3) with a slider beside each for quick exploration.
//     Picking another parent keeps a, b, h, k. The preview shows the line,
//     the steps in textbook order, the key points "parent → image" and the
//     features. Nothing reaches the board until "Add to graph".
//   * TransformSection, on the card of any typed curve that reads back as a
//     transformed parent — -2(x-3)^2+1, |2x-6|+1, sqrt(4-x), x^2 - 6x + 8
//     (vertex form), 1/(x+2) - 3. COMMITTED: a field is an edit on Enter or
//     blur, one undo entry each. Collapsed by default when the Roots,
//     Exponential, Logarithmic or Sinusoidal section already speaks for the
//     line (both readings of 2^(x−1)+3 are there, one click apart).
//
// Both only ever produce an ordinary typed equation (src/core/transform.ts
// writes it). The logic is pure and lives in src/ui/transformLinks.ts.
// ============================================================================

const THUMB_H = 40

/** One parent, drawn by the board's own renderer. */
function ParentThumb({ id, theme }: { id: ParentId; theme: Theme }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const paint = (): void => {
      const w = Math.max(1, Math.round(canvas.getBoundingClientRect().width || 60))
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(THUMB_H * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      try {
        renderBoard(ctx, parentThumbScene(id, theme, w, THUMB_H))
      } catch {
        // A tile that could not be drawn must not take the gallery with it.
        ctx.fillStyle = theme.bg
        ctx.fillRect(0, 0, w, THUMB_H)
      }
    }
    paint()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(paint)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [id, theme])
  return (
    <canvas
      ref={ref}
      className="te-thumb-canvas"
      style={{ height: `${THUMB_H}px` }}
      data-testid={`parent-thumb-${id}`}
      aria-hidden="true"
    />
  )
}

/** The sixteen parents. */
export function ParentGallery({
  value,
  theme = DARK_THEME,
  onPick,
}: {
  value: ParentId
  theme?: Theme
  onPick(id: ParentId): void
}) {
  return (
    <div className="te-gallery" role="radiogroup" aria-label="Parent function" data-testid="parent-gallery">
      {PARENT_IDS.map((id) => {
        const on = id === value
        const p = parentOf(id)
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            className={`te-tile${on ? ' te-tile-on' : ''}`}
            data-testid={`parent-${id}`}
            title={`${p.name}: ${PARENT_TEXT[id]}`}
            onClick={(e) => {
              e.stopPropagation()
              onPick(id)
            }}
          >
            <ParentThumb id={id} theme={theme} />
            <span className="te-tile-name">{PARENT_SHORT[id]}</span>
          </button>
        )
      })}
    </div>
  )
}

/** The steps, numbered, in the order a textbook applies them. */
export function StepList({ steps }: { steps: readonly string[] }) {
  if (steps.length === 0) {
    return (
      <div className="te-steps-none field-hint" data-testid="transform-steps">
        No transformation — this is the parent itself.
      </div>
    )
  }
  return (
    <ol className="te-steps" data-testid="transform-steps">
      {steps.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ol>
  )
}

/** Two columns: each parent key point and where it goes. */
export function MapTable({ rows }: { rows: readonly PointRow[] }) {
  if (rows.length === 0) return null
  return (
    <table className="te-map" data-testid="transform-map">
      <thead>
        <tr>
          <th scope="col">parent</th>
          <th scope="col" aria-hidden="true" />
          <th scope="col">image</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={r.anchor ? 'te-map-anchor' : undefined}>
            <td>{r.from}</td>
            <td className="te-map-arrow" aria-label="maps to">
              →
            </td>
            <td>{r.to}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function FeatureList({ lines }: { lines: readonly string[] }) {
  if (lines.length === 0) return null
  return (
    <ul className="xe-features te-features" data-testid="transform-features">
      {lines.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ul>
  )
}

const FIELD_TAG: Record<TransformField, string> = { a: 'a =', b: 'b =', h: 'h =', k: 'k =' }
const FIELD_HELP: Record<TransformField, string> = {
  a: 'a — vertical stretch/compression; negative reflects across the x-axis',
  b: 'b — horizontal compression/stretch by 1/|b|; negative reflects across the y-axis',
  h: 'h — horizontal shift (right when positive)',
  k: 'k — vertical shift (up when positive)',
}

/** One of a, b, h, k: the exact text, and a slider for quick exploration. */
function DraftRow({
  field,
  value,
  inputRef,
  onChange,
}: {
  field: TransformField
  value: string
  inputRef?: (el: HTMLInputElement | null) => void
  onChange(text: string): void
}) {
  const r = SLIDER[field]
  return (
    <div className="te-row">
      <span className="calc-tag te-tag">{FIELD_TAG[field]}</span>
      <XField
        value={value}
        mode="draft"
        label={FIELD_HELP[field]}
        className="fe-input-part te-input"
        bad={badText(value)}
        inputRef={inputRef}
        onCommit={onChange}
      />
      <input
        type="range"
        className="te-slider"
        min={r.min}
        max={r.max}
        step={r.step}
        value={sliderValue(field, value)}
        aria-label={`${field} slider`}
        data-testid={`transform-slider-${field}`}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onChange(sliderText(field, Number(e.target.value)))}
      />
    </div>
  )
}

// ============================================================================
// the "Build ▾ → Transformation" card
// ============================================================================

interface EditorProps {
  /** Put it on the board. Error to show, or null (the editor then closes). */
  onBuild(spec: TransformSpec): string | null
  onClose(): void
  /** The board's ground, for the gallery's thumbnails. */
  theme?: Theme
  /** Start from this draft (tests). */
  initial?: TransformDraft
}

export function TransformEditor({ onBuild, onClose, theme, initial }: EditorProps) {
  const [draft, setDraft] = useState<TransformDraft>(() => initial ?? blankTransformDraft())
  const [buildError, setBuildError] = useState<string | null>(null)
  const firstRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    firstRef.current?.focus()
    firstRef.current?.select()
  }, [])

  const made = useMemo(() => specFromDraft(draft), [draft])
  const preview = useMemo(() => transformPreview(made.spec, made.error), [made])
  const error = made.error ?? preview.error
  const canBuild = !error && preview.src !== null && made.spec !== null

  const set = (field: TransformField) => (text: string): void => {
    setBuildError(null)
    setDraft((d) => ({ ...d, [field]: text }))
  }

  const build = (): void => {
    if (!canBuild || !made.spec) return
    const err = onBuild(made.spec)
    if (err) setBuildError(err)
  }

  return (
    <div
      className="expr-card fe-card xe-card te-card"
      data-testid="transform-editor"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        } else if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
          e.preventDefault()
          build()
        }
      }}
    >
      <div className="fe-head">
        <span className="fe-title">Transformation</span>
        <button
          type="button"
          className="calc-drop fe-close"
          title="Close (Esc)"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <ParentGallery
        value={draft.parent}
        theme={theme}
        onPick={(id) => {
          setBuildError(null)
          setDraft((d) => withParent(d, id))
        }}
      />
      <div className="te-parent" data-testid="transform-parent">
        {parentOf(draft.parent).name}: {PARENT_TEXT[draft.parent]}
      </div>

      <div className="xe-body">
        <div className="xe-formula">y = a·f(b(x − h)) + k</div>
        <DraftRow
          field="a"
          value={draft.a}
          inputRef={(el) => {
            firstRef.current = el
          }}
          onChange={set('a')}
        />
        <DraftRow field="b" value={draft.b} onChange={set('b')} />
        <DraftRow field="h" value={draft.h} onChange={set('h')} />
        <DraftRow field="k" value={draft.k} onChange={set('k')} />
      </div>

      <div
        className="fe-preview"
        data-src={preview.src ?? undefined}
        data-tex={preview.latex ?? undefined}
        aria-label={preview.src ?? 'No equation yet'}
      >
        {preview.latex ? (
          <Latex tex={preview.latex} className="card-latex" />
        ) : (
          <span className="fe-preview-none">—</span>
        )}
      </div>
      {preview.src && <StepList steps={preview.steps} />}
      <MapTable rows={preview.rows} />
      <FeatureList lines={preview.features} />
      {(error || buildError) && <div className="expr-error">{buildError ?? error}</div>}

      <div className="fe-actions">
        <span className="expr-hint">Enter adds · Esc closes</span>
        <button type="button" className="fe-build" disabled={!canBuild} onClick={build}>
          Add to graph
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// the Transformation section on a typed curve's card
// ============================================================================

interface SectionProps {
  spec: TransformSpec
  /** Open by itself? False when another family section already speaks for the line. */
  defaultOpen: boolean
  /** Whether the board shows the parent's ghost and the arrows. */
  showParent: boolean
  onShowParent?(on: boolean): void
  /** The board carries this section's handles (no other family's). */
  handles?: boolean
  /** Rewrite the curve's line in place. Error message, or null. */
  onRestate(src: string, label: string): string | null
}

export function TransformSection({
  spec,
  defaultOpen,
  showParent,
  onShowParent,
  handles = true,
  onRestate,
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setError(null), [spec])

  const field = (f: TransformField) => (text: string): string | null => {
    const err = commitTransformSpec(spec, setTransformField(spec, f, text), TRANSFORM_FIELD_LABEL[f], {
      restate: onRestate,
    })
    setError(err)
    return err
  }

  const anchorWord = parentOf(spec.parent).anchorName
  const line = spec.parent === 'linear'

  return (
    <div className="field-section fe-section te-section" data-testid="transform-section">
      <button
        type="button"
        className="an-title fe-toggle"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
      >
        Transformation <span className="te-of">of {PARENT_TEXT[spec.parent]}</span>{' '}
        <span className="fe-caret">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <>
          <div className="xe-formula">y = a·f(b(x − h)) + k</div>
          <div className="fe-a-row">
            <span className="calc-tag">a =</span>
            <XField value={spec.a || '1'} mode="commit" label={FIELD_HELP.a} className="fe-input-part" onCommit={field('a')} />
            <span className="calc-tag">b =</span>
            <XField value={spec.b || '1'} mode="commit" label={FIELD_HELP.b} className="fe-input-part" onCommit={field('b')} />
          </div>
          <div className="fe-a-row">
            <span className="calc-tag">h =</span>
            <XField value={spec.h || '0'} mode="commit" label={FIELD_HELP.h} className="fe-input-part" onCommit={field('h')} />
            <span className="calc-tag">k =</span>
            <XField value={spec.k || '0'} mode="commit" label={FIELD_HELP.k} className="fe-input-part" onCommit={field('k')} />
          </div>
          <StepList steps={stepSentences(spec)} />
          <MapTable rows={pointRows(spec)} />
          <FeatureList lines={featureLines(spec)} />
          {error && <div className="expr-error">{error}</div>}
          {onShowParent && (
            <label className="te-check" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={showParent}
                data-testid="transform-show-parent"
                onChange={(e) => onShowParent(e.target.checked)}
              />
              <span>show parent</span>
            </label>
          )}
          {handles && (
            <div className="field-hint">
            {line
              ? 'Drag the y-intercept (k) or the second point (the slope) on the board.'
              : `Drag the ${anchorWord} (moves h and k) or the other marked point (up/down: a, sideways: b) on the board.`}
            </div>
          )}
        </>
      )}
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import type { LogisticSpec } from '../core/logistic'
import { Latex } from './Latex'
import { ExpFacts, XField, badText } from './ExpEditor'
import {
  LOGISTIC_FIELD_LABEL,
  LOGISTIC_FORMS,
  blankLogisticDraft,
  commitLogisticSpec,
  defaultForm,
  initialRefusal,
  logisticFactLines,
  logisticFieldValues,
  logisticPreview,
  safeLogisticFeatures,
  setLogisticField,
  specFromLogisticDraft,
} from './logisticLinks'
import type { LogisticDraft, LogisticField, LogisticForm } from './logisticLinks'

// ============================================================================
// src/ui/LogisticEditor.tsx — a logistic function, stated the AP way.
//
//     y = L/(1 + A·e^(−kt))            AP Calculus BC
//     y = a/(1 + b·e^(−kx)) + d        AP Precalculus
//
// Two places, like the exponential editor next door (ExpEditor.tsx):
//
//   * LogisticEditor, "Build ▾ → Logistic" at the top of the list: a DRAFT
//     that takes what a BC problem states — L, k and y(0) — and solves
//     A = L/y(0) − 1. Nothing reaches the board until "Add to graph".
//   * LogisticSection, on the card of any curve that reads as a logistic —
//     typed, or a sketch that fitted the library's logistic. COMMITTED: a
//     field is an edit on Enter or blur, one undo entry through the App's
//     in-place restate path (a sketch becomes the typed line on its first
//     edit). "AP Calc / Precalc" switches the vocabulary, never the curve.
//
// Both only ever produce an ordinary typed equation (src/core/logistic.ts
// writes it). The logic is pure and lives in src/ui/logisticLinks.ts.
// ============================================================================

// ============================================================================
// the "Build ▾ → Logistic" card
// ============================================================================

interface EditorProps {
  /** Put it on the board. Error to show, or null (the editor then closes). */
  onBuild(spec: LogisticSpec): string | null
  onClose(): void
  /** Start from this draft (tests). */
  initial?: LogisticDraft
}

export function LogisticEditor({ onBuild, onClose, initial }: EditorProps) {
  const [draft, setDraft] = useState<LogisticDraft>(() => initial ?? blankLogisticDraft())
  const [buildError, setBuildError] = useState<string | null>(null)
  const [shiftOpen, setShiftOpen] = useState(() => (initial?.d ?? '0').trim() !== '0' && (initial?.d ?? '').trim() !== '')
  const firstRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    firstRef.current?.focus()
    firstRef.current?.select()
  }, [])

  const made = useMemo(() => specFromLogisticDraft(draft), [draft])
  const preview = useMemo(() => logisticPreview(made.spec, made.error), [made])
  const error = made.error ?? preview.error
  const canBuild = !error && preview.src !== null && made.spec !== null

  const set = (patch: Partial<LogisticDraft>): void => {
    setBuildError(null)
    setDraft((d) => ({ ...d, ...patch }))
  }
  const build = (): void => {
    if (!canBuild || !made.spec) return
    const err = onBuild(made.spec)
    if (err) setBuildError(err)
  }
  const t = draft.v

  return (
    <div
      className="expr-card fe-card xe-card"
      data-testid="logistic-editor"
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
        <span className="fe-title">Logistic</span>
        <button type="button" className="calc-drop fe-close" title="Close (Esc)" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="xe-body">
        <div className="xe-formula">
          y = L/(1 + A·e^(−k{t})), A = L/y(0) − 1
        </div>
        <div className="fe-a-row">
          <span className="calc-tag">L =</span>
          <XField
            value={draft.L}
            mode="draft"
            label="Carrying capacity L"
            className="fe-input-part"
            bad={badText(draft.L)}
            inputRef={(el) => {
              firstRef.current = el
            }}
            onCommit={(L) => set({ L })}
          />
          <span className="calc-tag">k =</span>
          <XField
            value={draft.k}
            mode="draft"
            label="Growth constant k"
            className="fe-input-part"
            bad={badText(draft.k)}
            onCommit={(k) => set({ k })}
          />
          <span className="calc-tag">y(0) =</span>
          <XField
            value={draft.y0}
            mode="draft"
            label="Initial value y(0)"
            className="fe-input-part"
            bad={badText(draft.y0)}
            onCommit={(y0) => set({ y0 })}
          />
        </div>
        <div className="fe-a-row">
          <span className="calc-tag">variable</span>
          <div className="seg lg-forms" role="radiogroup" aria-label="Write the line in">
            {(['x', 't'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={draft.v === v}
                className={`seg-btn${draft.v === v ? ' seg-on' : ''}`}
                onClick={() => set({ v })}
              >
                {v}
              </button>
            ))}
          </div>
          {shiftOpen ? (
            <>
              <span className="calc-tag">shift d =</span>
              <XField
                value={draft.d}
                mode="draft"
                label="Vertical shift d"
                className="fe-input-part"
                bad={badText(draft.d)}
                onCommit={(d) => set({ d })}
              />
            </>
          ) : (
            <button type="button" className="calc-chip fe-add xe-shift" onClick={() => setShiftOpen(true)}>
              + vertical shift
            </button>
          )}
        </div>
      </div>
      <div
        className="fe-preview"
        data-src={preview.src ?? undefined}
        data-tex={preview.latex ?? undefined}
        aria-label={preview.src ?? 'No equation yet'}
      >
        {preview.latex ? <Latex tex={preview.latex} className="card-latex" /> : <span className="fe-preview-none">—</span>}
      </div>
      {made.spec && <div className="field-hint">A = {made.spec.A}</div>}
      {preview.deTex && (
        <div className="lg-de" data-testid="logistic-editor-de">
          <Latex tex={preview.deTex} />
        </div>
      )}
      <ExpFacts sentences={[]} features={preview.facts} testPrefix="logistic-editor" />
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
// the Logistic section on a card
// ============================================================================

interface SectionProps {
  spec: LogisticSpec
  /**
   * Rewrite the curve's line in place (a typed curve), or replace the sketch
   * with the typed line (a sketched one). Error message, or null.
   */
  onRestate(src: string, label: string): string | null
  /** "Show slope field": add dy/dx = k·y·(1 − y/L) with this curve as a solution. */
  onShowField?(): void
  /** The curve is a sketch: its first edit makes it a typed logistic. */
  sketched?: boolean
}

export function LogisticSection({ spec, onRestate, onShowField, sketched = false }: SectionProps) {
  const [open, setOpen] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<LogisticForm>(() => defaultForm(spec))
  useEffect(() => setError(null), [spec])

  const commit = (next: LogisticSpec | null, label: string, why?: string | null): string | null => {
    const err = next ? commitLogisticSpec(spec, next, label, { restate: onRestate }) : why ?? 'That can’t be written as this logistic.'
    setError(err)
    return err
  }
  const field = (f: LogisticField) => (text: string): string | null =>
    commit(
      setLogisticField(spec, f, text),
      sketched ? 'convert to typed logistic' : LOGISTIC_FIELD_LABEL[f],
      f === 'y0' ? initialRefusal(spec, text) : null,
    )

  const vals = logisticFieldValues(spec)
  const features = safeLogisticFeatures(spec)
  const facts = logisticFactLines(spec, form)
  const base = spec.b !== undefined && spec.b.trim() !== ''
  const t = spec.v === 't' ? 't' : 'x'
  const input = (f: LogisticField, label: string, value = vals[f]): JSX.Element => (
    <XField value={value} mode="commit" label={label} className="fe-input-part" onCommit={field(f)} />
  )
  const rate = base ? (
    <>
      <span className="calc-tag">base</span>
      {input('b', 'Base b')}
    </>
  ) : (
    <>
      <span className="calc-tag">k =</span>
      {input('k', 'Growth constant k')}
    </>
  )

  return (
    <div className="field-section fe-section xe-section" data-testid="logistic-section">
      <div className="lg-head">
        <button
          type="button"
          className="an-title fe-toggle"
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation()
            setOpen((o) => !o)
          }}
        >
          Logistic <span className="fe-caret">{open ? '▾' : '▸'}</span>
        </button>
        {open && (
          <div className="seg lg-forms" role="radiogroup" aria-label="State it the way">
            {LOGISTIC_FORMS.map((f) => (
              <button
                key={f.form}
                type="button"
                role="radio"
                aria-checked={form === f.form}
                data-form={f.form}
                title={f.title}
                className={`seg-btn${form === f.form ? ' seg-on' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setForm(f.form)
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {open && (
        <>
          {form === 'ap' ? (
            <>
              <div className="fe-a-row">
                <span className="calc-tag">L =</span>
                {input('L', 'Carrying capacity L')}
                {rate}
                <span className="calc-tag">A =</span>
                {input('A', 'A (= L/y(0) − 1)')}
              </div>
              <div className="fe-a-row">
                <span className="calc-tag">y(0) =</span>
                {input('y0', 'Initial value y(0)')}
                <span className="calc-tag">midpoint {t} =</span>
                {input('x0', 'Inflection point x')}
                {vals.d.trim() !== '0' && (
                  <>
                    <span className="calc-tag">shift d =</span>
                    {input('d', 'Vertical shift d')}
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="fe-a-row">
                <span className="calc-tag">a =</span>
                {input('L', 'a (the distance between the asymptotes)')}
                <span className="calc-tag">b =</span>
                {input('A', 'b (the constant in the denominator)')}
                {rate}
              </div>
              <div className="fe-a-row">
                <span className="calc-tag">d =</span>
                {input('d', 'Vertical shift d (lower asymptote)')}
                <span className="calc-tag">midpoint {t} =</span>
                {input('x0', 'Inflection point x')}
              </div>
            </>
          )}
          {features && (
            <div className="lg-de" data-testid="logistic-de" data-de={features.de} title="The differential equation this curve solves">
              <Latex tex={features.deTex} />
            </div>
          )}
          <ExpFacts
            sentences={form === 'ap' && features ? features.apFacts : []}
            features={facts}
            testPrefix="logistic"
          />
          {error && <div className="expr-error">{error}</div>}
          {onShowField && features && (
            <div className="fe-a-row">
              <button
                type="button"
                className="calc-chip xe-inverse"
                data-testid="logistic-show-field"
                title={`Add the slope field ${features.fieldSource} with this curve as a solution`}
                onClick={(e) => {
                  e.stopPropagation()
                  onShowField()
                }}
              >
                Show slope field
              </button>
            </div>
          )}
          <div className="field-hint">
            {sketched
              ? 'Editing a value makes this sketch a typed logistic.'
              : 'Drag the inflection point or either asymptote on the board.'}
          </div>
        </>
      )}
    </div>
  )
}

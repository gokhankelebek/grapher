import { useEffect, useMemo, useRef, useState } from 'react'
import type { SinFn, SinSpec, SinStart } from '../core/sinusoidal'
import { Latex } from './Latex'
import { ExpFacts, XField, badText } from './ExpEditor'
import {
  KIND_WORD,
  SIN_FIELD_LABEL,
  START_CHOICES,
  blankSinDraft,
  commitSinSpec,
  keyRows,
  periodSource,
  periodText,
  safeSinFeatures,
  setSinField,
  setSinFn,
  sinPreview,
  sinSpecFromDraft,
  sinValues,
  startChoice,
  switchSinTab,
  withB,
  withPeriod,
  writeAs,
  writePositive,
} from './sinLinks'
import type {
  KeyRow,
  SinDraft,
  SinEdit,
  SinExtremaFields,
  SinParamFields,
  SinPartFields,
  SinTab,
} from './sinLinks'

// ============================================================================
// src/ui/SinEditor.tsx — a sinusoid, stated the precalculus way.
//
//     y = a·sin(b(x − h)) + k        or        y = a·cos(b(x − h)) + k
//
// The sibling of ExpEditor.tsx and LogEditor.tsx, in the same two places:
//
//   * SinEditor, "Build ▾ → Sinusoidal". A DRAFT with three tabs over ONE
//     function — Parts (amplitude, period, phase shift, midline and where the
//     cycle starts), Extrema (a maximum and the minimum next to it) and the
//     Parameters themselves — switching tab re-seeds the new tab from the
//     curve the old one made, so the preview never jumps. Nothing reaches the
//     board until "Add to graph".
//   * SinSection, on the card of any typed curve that reads back as a
//     sinusoid — including a hand-typed 3sin(2x - pi/2) + 1, 4 - 2cos(x) and
//     sin(x) + cos(x) (folded into one). COMMITTED: a field is an edit on
//     Enter or blur, "write as" restates the same function with the other of
//     sin/cos or a positive amplitude; each is one undo entry.
//
// Both only ever produce an ordinary typed equation (src/core/sinusoidal.ts
// writes it). The logic is pure and lives in src/ui/sinLinks.ts.
// ============================================================================

const TABS: { tab: SinTab; label: string }[] = [
  { tab: 'parts', label: 'Parts' },
  { tab: 'extrema', label: 'Extrema' },
  { tab: 'params', label: 'Parameters' },
]

/** The five key points of one cycle, with their exact text. */
export function KeyPointTable({ rows }: { rows: readonly KeyRow[] }) {
  if (rows.length === 0) return null
  return (
    <table className="se-keys" data-testid="sin-keys">
      <caption className="se-keys-cap">Key points of one cycle</caption>
      <tbody>
        <tr>
          <th scope="row">x</th>
          {rows.map((r, i) => (
            <td key={i}>{r.x}</td>
          ))}
        </tr>
        <tr>
          <th scope="row">y</th>
          {rows.map((r, i) => (
            <td key={i} className={`se-key-${r.kind}`}>
              {r.y}
            </td>
          ))}
        </tr>
        <tr className="se-keys-kind">
          <th scope="row" />
          {rows.map((r, i) => (
            <td key={i}>{KIND_WORD[r.kind]}</td>
          ))}
        </tr>
      </tbody>
    </table>
  )
}

/** sin / cos. */
function FnPicker({
  fn,
  onChange,
  label = 'Function',
}: {
  fn: SinFn
  onChange(fn: SinFn): void
  label?: string
}) {
  return (
    <select
      className="xe-select"
      aria-label={label}
      value={fn}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value as SinFn)}
    >
      <option value="sin">sin</option>
      <option value="cos">cos</option>
    </select>
  )
}

// ============================================================================
// the "Build ▾ → Sinusoidal" card
// ============================================================================

interface EditorProps {
  /** Put it on the board. Error to show, or null (the editor then closes). */
  onBuild(spec: SinSpec): string | null
  onClose(): void
  /** Start from this draft (tests). */
  initial?: SinDraft
}

export function SinEditor({ onBuild, onClose, initial }: EditorProps) {
  const [draft, setDraft] = useState<SinDraft>(() => initial ?? blankSinDraft())
  const [buildError, setBuildError] = useState<string | null>(null)
  const firstRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    firstRef.current?.focus()
    firstRef.current?.select()
  }, [])

  const made = useMemo(() => sinSpecFromDraft(draft), [draft])
  const preview = useMemo(() => sinPreview(made.spec, made.error), [made])
  const error = made.error ?? preview.error
  const canBuild = !error && preview.src !== null && made.spec !== null

  const setParts = (patch: Partial<SinPartFields>): void => {
    setBuildError(null)
    setDraft((d) => ({ ...d, carried: null, parts: { ...d.parts, ...patch } }))
  }
  const setExtrema = (patch: Partial<SinExtremaFields>): void => {
    setBuildError(null)
    setDraft((d) => ({ ...d, carried: null, extrema: { ...d.extrema, ...patch } }))
  }
  const setParams = (next: (p: SinParamFields) => SinParamFields): void => {
    setBuildError(null)
    setDraft((d) => ({ ...d, carried: null, params: next(d.params) }))
  }

  const build = (): void => {
    if (!canBuild || !made.spec) return
    const err = onBuild(made.spec)
    if (err) setBuildError(err)
  }

  const pa = draft.parts
  const ex = draft.extrema
  const pr = draft.params
  const focusFirst = (el: HTMLInputElement | null): void => {
    firstRef.current = el
  }

  return (
    <div
      className="expr-card fe-card xe-card se-card"
      data-testid="sin-editor"
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
        <span className="fe-title">Sinusoidal</span>
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

      <div className="seg xe-tabs" role="tablist" aria-label="State it by">
        {TABS.map((t) => (
          <button
            key={t.tab}
            type="button"
            role="tab"
            aria-selected={draft.tab === t.tab}
            data-tab={t.tab}
            className={`seg-btn xe-tab${draft.tab === t.tab ? ' seg-on' : ''}`}
            onClick={() => {
              setBuildError(null)
              setDraft((d) => switchSinTab(d, t.tab))
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {draft.tab === 'parts' && (
        <div className="xe-body" data-testid="sin-tab-parts">
          <div className="fe-a-row">
            <span className="calc-tag">amplitude</span>
            <XField
              value={pa.amplitude}
              mode="draft"
              label="Amplitude"
              className="fe-input-part"
              bad={badText(pa.amplitude)}
              inputRef={focusFirst}
              onCommit={(amplitude) => setParts({ amplitude })}
            />
            <span className="calc-tag">period</span>
            <XField
              value={pa.period}
              mode="draft"
              label="Period"
              className="fe-input-part"
              bad={badText(pa.period)}
              onCommit={(period) => setParts({ period })}
            />
          </div>
          <div className="fe-a-row">
            <span className="calc-tag">phase shift</span>
            <XField
              value={pa.phase}
              mode="draft"
              label="Phase shift (the cycle starts at x = h)"
              className="fe-input-part"
              bad={badText(pa.phase)}
              onCommit={(phase) => setParts({ phase })}
            />
            <span className="calc-tag">midline y =</span>
            <XField
              value={pa.midline}
              mode="draft"
              label="Midline"
              className="fe-input-part"
              bad={badText(pa.midline)}
              onCommit={(midline) => setParts({ midline })}
            />
          </div>
          <div className="fe-a-row">
            <span className="calc-tag">the cycle starts at</span>
            <select
              className="xe-select"
              aria-label="The cycle starts at"
              data-testid="sin-start"
              value={pa.start}
              onChange={(e) => setParts({ start: e.target.value as SinStart })}
            >
              {START_CHOICES.map((c) => (
                <option key={c.start} value={c.start}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field-hint" data-testid="sin-choice">
            → {startChoice(pa.start)}
          </div>
        </div>
      )}

      {draft.tab === 'extrema' && (
        <div className="xe-body" data-testid="sin-tab-extrema">
          <div className="fe-a-row">
            <span className="calc-tag">maximum</span>
            <span className="field-sol-pt">
              (
              <XField
                value={ex.maxX}
                mode="draft"
                label="Maximum x"
                className="fe-input-part"
                bad={badText(ex.maxX)}
                inputRef={focusFirst}
                onCommit={(maxX) => setExtrema({ maxX })}
              />
              <span className="calc-tag">,</span>
              <XField
                value={ex.maxY}
                mode="draft"
                label="Maximum y"
                className="fe-input-part"
                bad={badText(ex.maxY)}
                onCommit={(maxY) => setExtrema({ maxY })}
              />
              )
            </span>
          </div>
          <div className="fe-a-row">
            <span className="calc-tag">next minimum</span>
            <span className="field-sol-pt">
              (
              <XField
                value={ex.minX}
                mode="draft"
                label="Minimum x"
                className="fe-input-part"
                bad={badText(ex.minX)}
                onCommit={(minX) => setExtrema({ minX })}
              />
              <span className="calc-tag">,</span>
              <XField
                value={ex.minY}
                mode="draft"
                label="Minimum y"
                className="fe-input-part"
                bad={badText(ex.minY)}
                onCommit={(minY) => setExtrema({ minY })}
              />
              )
            </span>
          </div>
          <div className="field-hint">
            An adjacent maximum and minimum: half a period apart. Written as cos starting at the
            maximum.
          </div>
        </div>
      )}

      {draft.tab === 'params' && (
        <div className="xe-body" data-testid="sin-tab-params">
          <div className="xe-formula">y = a·sin(b(x − h)) + k  or  a·cos(b(x − h)) + k</div>
          <div className="fe-a-row">
            <FnPicker fn={pr.fn} onChange={(fn) => setParams((p) => ({ ...p, fn }))} />
            <span className="calc-tag">a =</span>
            <XField
              value={pr.a}
              mode="draft"
              label="a (amplitude, negative reflects)"
              className="fe-input-part"
              bad={badText(pr.a)}
              inputRef={focusFirst}
              onCommit={(a) => setParams((p) => ({ ...p, a }))}
            />
          </div>
          <div className="fe-a-row">
            <span className="calc-tag">b =</span>
            <XField
              value={pr.b}
              mode="draft"
              label="b"
              className="fe-input-part"
              bad={badText(pr.b)}
              onCommit={(b) => setParams((p) => withB(p, b))}
            />
            <span className="calc-tag">or period</span>
            <XField
              value={pr.period}
              mode="draft"
              label="Period (sets b = 2π/P)"
              className="fe-input-part"
              bad={badText(pr.period)}
              onCommit={(period) => setParams((p) => withPeriod(p, period))}
            />
          </div>
          <div className="fe-a-row">
            <span className="calc-tag">h =</span>
            <XField
              value={pr.h}
              mode="draft"
              label="h (phase shift)"
              className="fe-input-part"
              bad={badText(pr.h)}
              onCommit={(h) => setParams((p) => ({ ...p, h }))}
            />
            <span className="calc-tag">k =</span>
            <XField
              value={pr.k}
              mode="draft"
              label="k (midline)"
              className="fe-input-part"
              bad={badText(pr.k)}
              onCommit={(k) => setParams((p) => ({ ...p, k }))}
            />
          </div>
        </div>
      )}

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
      <ExpFacts sentences={preview.sentences} features={[]} testPrefix="sin" />
      <KeyPointTable rows={preview.keys} />
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
// the Sinusoidal section on a typed curve's card
// ============================================================================

interface SectionProps {
  spec: SinSpec
  /** Rewrite the curve's line in place. Error message, or null. */
  onRestate(src: string, label: string): string | null
}

export function SinSection({ spec, onRestate }: SectionProps) {
  const [open, setOpen] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setError(null), [spec])

  const commit = (next: SinSpec | null, label: string): string | null => {
    const err = commitSinSpec(spec, next, label, { restate: onRestate })
    setError(err)
    return err
  }
  const field = (f: SinEdit) => (text: string): string | null =>
    commit(setSinField(spec, f, text), SIN_FIELD_LABEL[f])

  const features = safeSinFeatures(spec)
  const fn: SinFn = spec.fn === 'cos' ? 'cos' : 'sin'
  const other: SinFn = fn === 'sin' ? 'cos' : 'sin'
  const negative = (sinValues(spec)?.a ?? 1) < 0

  return (
    <div className="field-section fe-section xe-section se-section" data-testid="sin-section">
      <button
        type="button"
        className="an-title fe-toggle"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
      >
        Sinusoidal <span className="fe-caret">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <>
          <div className="fe-a-row">
            <FnPicker
              fn={fn}
              label="Function (switching changes the graph — use “write as” to keep it)"
              onChange={(to) => {
                if (to !== fn) commit(setSinFn(spec, to), `switch to ${to}`)
              }}
            />
            <span className="calc-tag">a =</span>
            <XField value={spec.a} mode="commit" label="Amplitude a (negative reflects)" className="fe-input-part" onCommit={field('a')} />
          </div>
          <div className="fe-a-row">
            <span className="calc-tag">b =</span>
            <XField value={spec.b} mode="commit" label="b (period 2π/|b|)" className="fe-input-part" onCommit={field('b')} />
            <span className="calc-tag">period</span>
            <XField
              value={periodSource(spec)}
              mode="commit"
              label={`Period (${periodText(spec, features)}) — sets b = 2π/P`}
              className="fe-input-part"
              onCommit={field('period')}
            />
          </div>
          <div className="fe-a-row">
            <span className="calc-tag">h =</span>
            <XField value={spec.h || '0'} mode="commit" label="Phase shift h" className="fe-input-part" onCommit={field('h')} />
            <span className="calc-tag">k =</span>
            <XField value={spec.k || '0'} mode="commit" label="Midline k" className="fe-input-part" onCommit={field('k')} />
          </div>
          <div className="fe-a-row">
            <span className="calc-tag">write as</span>
            <button
              type="button"
              className="calc-chip se-write"
              data-testid="sin-write-other"
              title={`The same graph, written with ${other} (the phase shift moves a quarter period)`}
              onClick={(e) => {
                e.stopPropagation()
                commit(writeAs(spec, other), `write as ${other}`)
              }}
            >
              {other}
            </button>
            {negative && (
              <button
                type="button"
                className="calc-chip se-write"
                data-testid="sin-write-positive"
                title="The same graph with a positive amplitude (the phase shift moves half a period)"
                onClick={(e) => {
                  e.stopPropagation()
                  commit(writePositive(spec), 'write with positive amplitude')
                }}
              >
                positive amplitude
              </button>
            )}
          </div>
          <ExpFacts sentences={features ? features.sentences : []} features={[]} testPrefix="sin" />
          <KeyPointTable rows={keyRows(features)} />
          {error && <div className="expr-error">{error}</div>}
          <div className="field-hint">
            Drag the midline, the first maximum (up/down: amplitude, sideways: phase shift) or the
            end of the cycle (period) on the board.
          </div>
        </>
      )}
    </div>
  )
}

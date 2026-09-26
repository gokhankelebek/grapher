import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Latex } from './Latex'
import { SEQ_TABS, blankSeqDraft, fibonacciDraft, renameSequenceSrc, seqPreview, subscript } from './seqLinks'
import type { SeqDraft } from './seqLinks'

// ============================================================================
// src/ui/SequenceEditor.tsx — "Build ▾ → Sequence".
//
// A DRAFT with five tabs — Arithmetic (a₁, d), Geometric (a₁, r), Explicit
// (aₙ = …), Recursive (a₁ = …, aₙ₊₁ = …, or two starting terms for
// Fibonacci) and From terms (a pasted list) — and an index window. Live KaTeX
// of the line it will add, the first terms, what kind of sequence it is with
// both formulas, and what its series does. Nothing reaches the board until
// "Add to graph", which goes through the SAME path as a line typed in the
// equation box, as one undo ("build sequence").
// ============================================================================

interface Props {
  /** Put the line on the board. Error to show, or null (the editor then closes). */
  onBuild(src: string, n0: number, count: number): string | null
  onClose(): void
  /** The letter a new sequence is offered. */
  defaultName?: string
  /** Start from this draft (tests). */
  initial?: SeqDraft
}

function Row({ tag, children }: { tag: ReactNode; children: ReactNode }) {
  return (
    <div className="fe-a-row">
      <span className="calc-tag mo-tag">{tag}</span>
      {children}
    </div>
  )
}

function Field({
  value,
  label,
  placeholder,
  wide,
  inputRef,
  onChange,
}: {
  value: string
  label: string
  placeholder?: string
  wide?: boolean
  inputRef?: (el: HTMLInputElement | null) => void
  onChange(text: string): void
}) {
  return (
    <input
      ref={inputRef}
      className={`calc-input fe-input xe-input${wide ? ' mo-input-f' : ' fe-input-part'}`}
      type="text"
      spellCheck={false}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      aria-label={label}
      title={label}
      placeholder={placeholder}
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

export function SequenceEditor({ onBuild, onClose, defaultName = 'a', initial }: Props) {
  const [draft, setDraft] = useState<SeqDraft>(() => initial ?? blankSeqDraft(defaultName))
  const [buildError, setBuildError] = useState<string | null>(null)
  const firstRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    firstRef.current?.focus()
    firstRef.current?.select()
  }, [draft.tab])

  const preview = useMemo(() => seqPreview(draft), [draft])
  const canBuild = preview.src !== null && preview.error === null && preview.window !== null

  const update = (patch: Partial<SeqDraft>): void => {
    setBuildError(null)
    setDraft((d) => ({ ...d, ...patch }))
  }
  const build = (): void => {
    if (!canBuild || !preview.src || !preview.window) return
    const err = onBuild(preview.src, preview.window.n0, preview.window.count)
    if (err) setBuildError(err)
  }
  const first = (node: HTMLInputElement | null): void => {
    firstRef.current = node
  }

  const L = draft.name.trim() || 'a'
  const sub = (s: string | number): string => `${L}${subscript(s)}`
  const card = preview.card
  const head = card ? card.rows.slice(0, 6) : []
  const twoTerm = draft.r2.trim() !== ''

  return (
    <div
      className="expr-card fe-card xe-card seq-editor"
      data-testid="seq-editor"
      onKeyDown={(ev) => {
        if (ev.key === 'Escape') {
          ev.preventDefault()
          ev.stopPropagation()
          onClose()
        } else if (ev.key === 'Enter' && (ev.target as HTMLElement).tagName === 'INPUT') {
          ev.preventDefault()
          build()
        }
      }}
    >
      <div className="fe-head">
        <span className="fe-title">Sequence</span>
        <button type="button" className="calc-drop fe-close" title="Close (Esc)" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="seg xe-tabs seq-tabs" role="tablist" aria-label="Kind of sequence">
        {SEQ_TABS.map((t) => (
          <button
            key={t.tab}
            type="button"
            role="tab"
            aria-selected={draft.tab === t.tab}
            data-tab={t.tab}
            className={`seg-btn xe-tab${draft.tab === t.tab ? ' seg-on' : ''}`}
            onClick={() => update({ tab: t.tab })}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="xe-body" data-testid={`seq-tab-${draft.tab}`}>
        {draft.tab !== 'list' && (
          <Row tag="name">
            <Field
              value={draft.name}
              label="The sequence's letter"
              placeholder="a"
              onChange={(text) => {
                const name = text.trim().slice(0, 1)
                const was = draft.name.trim()
                // The rule mentions the letter (aₙ₊₁ = aₙ + 4): it follows.
                update({ name, rule: name && was ? renameSequenceSrc(draft.rule, was, name) : draft.rule })
              }}
            />
          </Row>
        )}

        {(draft.tab === 'arithmetic' || draft.tab === 'geometric') && (
          <>
            <Row tag={`${sub(1)} =`}>
              <Field value={draft.a1} label="The first term" inputRef={first} onChange={(a1) => update({ a1 })} />
            </Row>
            <Row tag={draft.tab === 'arithmetic' ? 'd =' : 'r ='}>
              <Field
                value={draft.step}
                label={draft.tab === 'arithmetic' ? 'The common difference' : 'The common ratio'}
                onChange={(step) => update({ step })}
              />
            </Row>
            <Row tag="write as">
              <div className="seg seq-form" role="group" aria-label="Write it as">
                {(['explicit', 'recursive'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`seg-btn${draft.form === f ? ' seg-on' : ''}`}
                    aria-pressed={draft.form === f}
                    onClick={() => update({ form: f })}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </Row>
          </>
        )}

        {draft.tab === 'explicit' && (
          <Row tag={`${sub('n')} =`}>
            <Field
              value={draft.formula}
              label={`${sub('n')} as a formula in n`}
              placeholder="3 + 4(n - 1)"
              wide
              inputRef={first}
              onChange={(formula) => update({ formula })}
            />
          </Row>
        )}

        {draft.tab === 'recursive' && (
          <>
            <Row tag={`${sub(1)} =`}>
              <Field value={draft.r1} label="The first term" inputRef={first} onChange={(r1) => update({ r1 })} />
            </Row>
            <Row tag={`${sub(2)} =`}>
              <Field
                value={draft.r2}
                label="The second term (only for a rule that uses two previous terms)"
                placeholder="optional"
                onChange={(r2) => update({ r2 })}
              />
            </Row>
            <Row tag={`${twoTerm ? sub('n+2') : sub('n+1')} =`}>
              <Field
                value={draft.rule}
                label="The rule"
                placeholder={twoTerm ? `${L}_(n+1) + ${L}_n` : `${L}_n + 4`}
                wide
                onChange={(rule) => update({ rule })}
              />
            </Row>
            <div className="fe-a-row">
              <button
                type="button"
                className="calc-chip"
                data-testid="seq-fibonacci"
                title="1, 1, 2, 3, 5, 8, …"
                onClick={() => {
                  setBuildError(null)
                  setDraft((d) => fibonacciDraft(d))
                }}
              >
                Fibonacci
              </button>
            </div>
          </>
        )}

        {draft.tab === 'list' && (
          <Row tag="terms">
            <Field
              value={draft.list}
              label="The terms, separated by commas"
              placeholder="3, 7, 11, 15"
              wide
              inputRef={first}
              onChange={(list) => update({ list })}
            />
          </Row>
        )}

        <Row tag="n from">
          <Field value={draft.from} label="n from" onChange={(from) => update({ from })} />
          <span className="calc-tag">to</span>
          <Field value={draft.to} label="n to" onChange={(to) => update({ to })} />
        </Row>
      </div>

      <div className="fe-preview" data-src={preview.src ?? undefined} aria-label={preview.src ?? 'No sequence yet'}>
        {card?.latex ? <Latex tex={card.latex} className="card-latex" /> : <span className="fe-preview-none">—</span>}
      </div>

      {card && head.length > 0 && (
        <table className="seq-table seq-table-preview" data-testid="seq-preview-terms">
          <thead>
            <tr>
              <th>n</th>
              {head.map((r) => (
                <th key={r.n}>{String(r.n).replace('-', '−')}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="seq-n">{sub('n')}</td>
              {head.map((r) => (
                <td key={r.n}>{r.aText}</td>
              ))}
            </tr>
          </tbody>
        </table>
      )}
      {card?.classText && (
        <div className="seq-class" data-testid="seq-preview-class">
          <span className="seq-class-kind">{card.classText}</span>
          {card.explicit && (
            <>
              <span className="seq-sep"> · </span>
              <span className="seq-formula">{card.explicit}</span>
            </>
          )}
          {card.recursive && (
            <>
              <span className="seq-sep"> · </span>
              <span className="seq-formula">{card.recursive}</span>
            </>
          )}
        </div>
      )}
      {card?.seriesLine && (
        <div className="seq-series" data-testid="seq-preview-series">
          {card.seriesLine}
        </div>
      )}
      {card?.seriesNote && <div className="field-hint">{card.seriesNote}</div>}

      {(preview.error || buildError) && <div className="expr-error">{buildError ?? preview.error}</div>}

      <div className="fe-actions">
        <span className="expr-hint">Enter adds · Esc closes</span>
        <button type="button" className="fe-build" data-testid="seq-build" disabled={!canBuild} onClick={build}>
          Add to graph
        </button>
      </div>
    </div>
  )
}

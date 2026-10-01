// ============================================================================
// src/ui/LimitSection.tsx — one limit, as its PARENT's card shows it: the
// limit asked for, typeset (lim_{x→3} f(x) = 6), both one-sided limits, why it
// fails when it does, f(a), what kind of point a is, and the AP continuity
// checklist ticked line by line. Controls: a (typed exactly — pi/2, -1/3 — or
// ∞ / −∞ from the dropdown), which side, and the two switches: the table of
// values and the ε–δ picture with its ε slider.
//
// Everything it prints arrives computed (src/ui/limitLinks.ts → LimitRow);
// every edit leaves as one CalcChange. The only state kept here is the field
// being typed into.
// ============================================================================

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { CardSection, SectionDrop } from './CardSection'
import { parseNumeric } from './numeric'
import type { CalcChange, LimitRow } from './calcLinks'
import { EPS_MAX, EPS_MIN, EPS_STEP } from './limitLinks'
import { Answer, AnswerTex } from './RevealAnswer'
import { calcKey } from './reveal'

interface Props {
  row: LimitRow
  onCalcChange(change: CalcChange, live?: boolean): void
  onRemove(): void
  /** Open / close one undo bracket around the ε slider's drag. */
  onEditStart(): void
  onEditEnd(): void
}

/** What a typed field is prefilled with: the exact text, in the parser's spelling. */
function editable(text: string): string {
  return text.replace(/−/g, '-').replace(/π/g, 'pi').replace(/√(\d+)/g, 'sqrt($1)')
}

function fillStyle(value: number, min: number, max: number): CSSProperties {
  const span = max - min || 1
  const pct = Math.max(0, Math.min(100, ((value - min) / span) * 100))
  return { '--fill': `${pct}%` } as CSSProperties
}

/** "∞", "inf", "-infinity" … as typed into a. */
function typedInfinity(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, '').replace(/−/g, '-')
  if (t === '∞' || t === '+∞' || t === 'inf' || t === '+inf' || t === 'infinity' || t === '+infinity') return Infinity
  if (t === '-∞' || t === '-inf' || t === '-infinity') return -Infinity
  return null
}

export function LimitSection({ row, onCalcChange, onRemove, onEditStart, onEditEnd }: Props) {
  const [edit, setEdit] = useState<{ text: string; bad: boolean } | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const linkId = row.linkId

  useEffect(() => {
    if (edit && inputRef.current && document.activeElement !== inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [edit])

  const commit = (): void => {
    if (!edit) return
    const v = typedInfinity(edit.text) ?? parseNumeric(edit.text)
    if (v === null || Number.isNaN(v)) {
      setEdit({ ...edit, bad: true })
      return
    }
    onCalcChange({ kind: 'limitA', linkId, a: v })
    setEdit(null)
  }

  const title = 'The point x approaches — type 3, -1/3, pi/2 …'
  const aField =
    edit !== null ? (
      <span className="calc-field">
        <span className="calc-field-label">a</span>
        <input
          ref={inputRef}
          className={`calc-input${edit.bad ? ' param-edit-bad' : ''}`}
          type="text"
          spellCheck={false}
          aria-label={title}
          value={edit.text}
          onChange={(e) => setEdit({ text: e.target.value, bad: false })}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setEdit(null)
            }
          }}
          onBlur={() => setEdit(null)}
        />
      </span>
    ) : (
      <button
        type="button"
        className="calc-field calc-field-btn"
        title={title}
        onClick={() => setEdit({ text: editable(row.aText), bad: false })}
      >
        <span className="calc-field-label">a</span>
        <span className="calc-field-value">{row.aText}</span>
      </button>
    )

  const where = row.infinity === 1 ? 'inf' : row.infinity === -1 ? '-inf' : 'a'
  /** Reveal mode: everything this section computes is one answer. */
  const ak = calcKey(linkId)

  return (
    <CardSection
      kind="limit"
      title="Limit"
      titleHint={row.title}
      summary={limitSummary(row)}
      actions={<SectionDrop what="limit" onRemove={onRemove} />}
      className="calc-row limit-row"
      data={{ link: linkId }}
      answerKey={ak}
    >

      <div className="limit-tex" title={row.head.text} aria-label={row.head.text}>
        <AnswerTex k={ak} tex={row.head.tex} what="the limit" />
      </div>
      {/* The two one-sided limits, one per line: side by side they wrap
          mid-formula in a 272px card. */}
      {row.sides && (
        <div className="limit-tex limit-sides" title={row.sides.text} aria-label={row.sides.text}>
          {row.sides.tex.split(/,\s*\\qquad\s*/).map((tex, i) => (
            <div key={i}>
              <AnswerTex k={ak} tex={tex} what="the one-sided limit" />
            </div>
          ))}
        </div>
      )}

      <div className="calc-controls">
        <select
          className="calc-select"
          aria-label="What x approaches"
          title="What x approaches: a number, or ±∞"
          value={where}
          onChange={(e) => {
            const v = e.target.value
            onCalcChange({ kind: 'limitA', linkId, a: v === 'inf' ? Infinity : v === '-inf' ? -Infinity : 0 })
          }}
        >
          <option value="a">x → a</option>
          <option value="inf">x → ∞</option>
          <option value="-inf">x → −∞</option>
        </select>
        {row.infinity === 0 && aField}
        {row.infinity === 0 && (
          <select
            className="calc-select"
            aria-label="Which side"
            title="Two-sided, or one-sided from the left (a⁻) or the right (a⁺)"
            value={row.side}
            onChange={(e) =>
              onCalcChange({
                kind: 'limitSide',
                linkId,
                side: e.target.value === 'left' ? 'left' : e.target.value === 'right' ? 'right' : 'both',
              })
            }
          >
            <option value="both">both sides</option>
            <option value="left">from the left (a⁻)</option>
            <option value="right">from the right (a⁺)</option>
          </select>
        )}
      </div>

      <div className="calc-controls">
        <button
          type="button"
          className={`calc-chip${row.table ? ' calc-chip-on' : ''}`}
          aria-pressed={row.table}
          title="The table of values: x approaching a from each side, and f(x)"
          onClick={() => onCalcChange({ kind: 'limitTable', linkId, on: !row.table })}
        >
          table of values
        </button>
        <button
          type="button"
          className={`calc-chip${row.epsilon ? ' calc-chip-on' : ''}`}
          aria-pressed={row.epsilon}
          title="The ε–δ picture: the band L ± ε, the δ that keeps f inside it, and the box they share"
          onClick={() => onCalcChange({ kind: 'limitEpsilon', linkId, on: !row.epsilon })}
        >
          ε–δ
        </button>
      </div>

      {row.problem && <div className="calc-why">{`Nothing is drawn: ${row.problem}.`}</div>}

      {(row.why || row.fa || row.klass) && (
        <Answer k={ak} block what="the facts">
        <ul className="calc-facts limit-facts">
          {row.why && <li className="calc-fact">{row.why}</li>}
          {row.fa && <li className="calc-fact calc-fact-lead">{row.fa}</li>}
          {row.klass && <li className="calc-fact calc-fact-lead">{row.klass}</li>}
        </ul>
        </Answer>
      )}

      {row.checklist && (
        <div className="secant-block">
          <div className="secant-block-title">{`Continuity at x = ${row.aText}`}</div>
          <Answer k={ak} block what="the checklist">
          <ol className="calc-facts secant-hyps limit-checks">
            {row.checklist.map((c, i) => (
              <li key={i} className={`calc-fact secant-hyp ${c.ok ? 'secant-hyp-ok' : 'secant-hyp-bad'}`}>
                <span className="secant-mark" aria-hidden="true">
                  {c.ok ? '✓' : '✗'}
                </span>
                <span>{`(${i + 1}) ${c.text}`}</span>
              </li>
            ))}
            {row.verdict && (
              <li className={`calc-fact ${row.verdictOk ? 'calc-fact-lead' : 'secant-verdict-bad'}`}>{row.verdict}</li>
            )}
          </ol>
          </Answer>
        </div>
      )}

      {row.columns && row.columns.length > 0 && (
        <div className="secant-block">
          <div className="secant-block-title">Table of values</div>
          <div className="limit-table-wrap">
            {row.columns.map((col, ci) => (
              <table className="limit-table" key={ci}>
                <thead>
                  <tr>
                    <th colSpan={2}>{col.title}</th>
                  </tr>
                  <tr>
                    <th>x</th>
                    <th>{`${row.fName}(x)`}</th>
                  </tr>
                </thead>
                <tbody>
                  {col.rows.map((r, ri) => (
                    <tr key={ri}>
                      <td>{r.x}</td>
                      <td>{r.y}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </div>
        </div>
      )}

      {row.epsilon && (
        <div className="secant-block">
          <div className="secant-block-title">ε–δ</div>
          {row.delta && row.delta.value !== null && (
            <div className="limit-eps">
              <span className="calc-n-label">ε</span>
              <input
                type="range"
                min={EPS_MIN}
                max={EPS_MAX}
                step={EPS_STEP}
                value={row.eps}
                aria-label="ε"
                style={fillStyle(row.eps, EPS_MIN, EPS_MAX)}
                onPointerDown={onEditStart}
                onPointerUp={onEditEnd}
                onKeyDown={onEditStart}
                onKeyUp={onEditEnd}
                onBlur={onEditEnd}
                onChange={(e) => onCalcChange({ kind: 'limitEps', linkId, eps: Number(e.target.value) }, true)}
              />
              <span className="calc-n-value limit-eps-value">{row.eps.toFixed(2)}</span>
            </div>
          )}
          {row.delta && (
            <Answer k={ak} block what="δ">
              <div className="calc-read calc-accum-read limit-delta">{row.delta.text}</div>
            </Answer>
          )}
        </div>
      )}
    </CardSection>
  )
}

/** "x → 3 = 6", "x → ∞ = 0" — the limit, folded into its header. */
export function limitSummary(row: Pick<LimitRow, 'head'>): string {
  return row.head.text
    .replace(/^lim\s*/, '')
    .replace(/\s+[^\s()]+\(x\)\s*/, ' ')
    .replace(/(\S)→/, '$1 → ')
    .replace(/→(\S)/, '→ $1')
    .trim()
}

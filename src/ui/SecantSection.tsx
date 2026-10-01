// ============================================================================
// src/ui/SecantSection.tsx — one secant, as its PARENT's card shows it: the
// average rate of change of f over [a, b] with its difference quotient written
// out, the secant line in point-slope form, a and b (typed exactly: pi/2, -1,
// 1/3), and the two switches — the Mean Value Theorem (its hypotheses in AP
// language, every c, or why it does not apply; Rolle's theorem when
// f(a) = f(b)) and the average value (f_avg, and every c with f(c) = f_avg).
//
// Everything it prints arrives computed (src/ui/secantLinks.ts → SecantRow);
// every edit leaves as one CalcChange. The only state kept here is the field
// being typed into.
// ============================================================================

import { useEffect, useRef, useState } from 'react'
import { Latex } from './Latex'
import { Answer, AnswerTex, AnswerText } from './RevealAnswer'
import { calcKey } from './reveal'
import { CardSection, SectionDrop } from './CardSection'
import { parseNumeric } from './numeric'
import type { CalcChange, SecantRow } from './calcLinks'

interface Props {
  row: SecantRow
  onCalcChange(change: CalcChange, live?: boolean): void
  onRemove(): void
}

/** What a typed field is prefilled with: the exact text, in the parser's spelling. */
function editable(text: string): string {
  return text.replace(/−/g, '-').replace(/π/g, 'pi').replace(/√(\d+)/g, 'sqrt($1)')
}

export function SecantSection({ row, onCalcChange, onRemove }: Props) {
  const [edit, setEdit] = useState<{ which: 'a' | 'b'; text: string; bad: boolean } | null>(null)
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
    const v = parseNumeric(edit.text)
    if (v === null) {
      setEdit({ ...edit, bad: true })
      return
    }
    onCalcChange({ kind: 'secantBound', linkId, which: edit.which, value: v })
    setEdit(null)
  }

  const field = (which: 'a' | 'b', shown: string): JSX.Element => {
    const title = `${which} — type 1, -2, 1/2, pi/2 …`
    if (edit?.which === which) {
      return (
        <span className="calc-field">
          <span className="calc-field-label">{which}</span>
          <input
            ref={inputRef}
            className={`calc-input${edit.bad ? ' param-edit-bad' : ''}`}
            type="text"
            spellCheck={false}
            aria-label={title}
            value={edit.text}
            onChange={(e) => setEdit({ which, text: e.target.value, bad: false })}
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
      )
    }
    return (
      <button
        type="button"
        className="calc-field calc-field-btn"
        title={title}
        onClick={() => setEdit({ which, text: editable(shown), bad: false })}
      >
        <span className="calc-field-label">{which}</span>
        <span className="calc-field-value">{shown}</span>
      </button>
    )
  }

  const thm = row.theorem
  const avg = row.average
  /** Reveal mode: everything this section computes is one answer. */
  const ak = calcKey(linkId)

  return (
    <CardSection
      kind="secant"
      title="Avg. rate of change"
      titleHint={row.value === null ? row.head : `${row.head} ${row.value.startsWith('≈') ? row.value : `= ${row.value}`}`}
      summary={`[${row.aText}, ${row.bText}]${
        row.value === null ? '' : ` ${row.value.startsWith('≈') ? row.value : `= ${row.value}`}`
      }`}
      actions={<SectionDrop what="secant line" onRemove={onRemove} />}
      className="calc-row secant-row"
      data={{ link: linkId }}
      answerKey={ak}
    >
      {/* The sentence, when there is no difference quotient to show it. */}
      {!row.quotient && (
      <div className="calc-line">
        <span className="calc-read secant-head">
          {row.value === null ? (
            row.head
          ) : (
            <AnswerText
              k={ak}
              text={`${row.head} ${row.value.startsWith('≈') ? row.value : `= ${row.value}`}`}
              what="the average rate of change"
            />
          )}
        </span>
      </div>
      )}

      {row.quotient && (
        <div className="secant-tex" title={row.quotient.text} aria-label={row.quotient.text}>
          <AnswerTex k={ak} tex={row.quotient.tex} what="the average rate of change" />
        </div>
      )}
      {row.line && (
        <div className="secant-line" title="The secant line through (a, f(a)) and (b, f(b)), in point-slope form">
          <span className="secant-line-label">secant line</span>
          <Answer k={ak} what="the secant line">
            <Latex tex={row.line.tex} />
          </Answer>
        </div>
      )}

      <div className="calc-controls">
        {field('a', row.aText)}
        {field('b', row.bText)}
        <button
          type="button"
          className={`calc-chip${row.mvt ? ' calc-chip-on' : ''}`}
          aria-pressed={row.mvt}
          title="The Mean Value Theorem on [a, b]: its hypotheses, every c with f′(c) equal to the average rate of change, and the tangent lines there"
          onClick={() => onCalcChange({ kind: 'secantMvt', linkId, on: !row.mvt })}
        >
          MVT
        </button>
        <button
          type="button"
          className={`calc-chip${row.avg ? ' calc-chip-on' : ''}`}
          aria-pressed={row.avg}
          title="The average value of f on [a, b]: the rectangle whose area is the integral, and every c with f(c) = f_avg"
          onClick={() => onCalcChange({ kind: 'secantAvg', linkId, on: !row.avg })}
        >
          average value
        </button>
      </div>

      {row.problem && <div className="calc-why">{`Nothing is drawn: ${row.problem}.`}</div>}

      {thm && (
        <div className="secant-block">
          <div className="secant-block-title">{thm.title}</div>
          <Answer k={ak} block what="the Mean Value Theorem">
          <ul className="calc-facts secant-hyps">
            {thm.hyps.map((h, i) => (
              <li key={i} className={`calc-fact secant-hyp ${h.ok ? 'secant-hyp-ok' : 'secant-hyp-bad'}`}>
                <span className="secant-mark" aria-hidden="true">
                  {h.ok ? '✓' : '✗'}
                </span>
                <span>{h.text}</span>
              </li>
            ))}
            <li className={`calc-fact ${thm.ok ? 'calc-fact-lead' : 'secant-verdict-bad'}`}>{thm.verdict}</li>
            {thm.points && <li className="calc-fact calc-fact-lead">{thm.points}</li>}
          </ul>
          </Answer>
        </div>
      )}

      {avg && (
        <div className="secant-block">
          <div className="secant-block-title">Average value</div>
          <Answer k={ak} block what="the average value">
          {avg.problem ? (
            <div className="calc-why">{avg.problem}.</div>
          ) : (
            <>
              <div className="secant-tex" title={avg.text} aria-label={avg.text}>
                <Latex tex={avg.tex} />
              </div>
              <ul className="calc-facts">
                {avg.points && <li className="calc-fact calc-fact-lead">{avg.points}</li>}
                {avg.note && <li className="calc-fact">{avg.note}</li>}
              </ul>
            </>
          )}
          </Answer>
        </div>
      )}
    </CardSection>
  )
}

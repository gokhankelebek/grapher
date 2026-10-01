// ============================================================================
// src/ui/SignChartSection.tsx — one sign chart, as its PARENT's card shows it:
// what the graph is taken to be (f, f′, f″ — "the graph of f′ is shown"), which
// strips go on the board, a small copy of each strip, the AP statements with
// their justifications (copyable as plain text), and the closed interval of
// the Candidates Test.
//
// Everything it prints arrives computed (src/ui/signChartLinks.ts →
// SignChartRow); every edit leaves as one CalcChange. The only state kept here
// is the field being typed into and the "Copied" flash.
// ============================================================================

import { useEffect, useRef, useState } from 'react'
import { Answer } from './RevealAnswer'
import { calcKey } from './reveal'
import { CardSection, SectionDrop } from './CardSection'
import { parseNumeric } from './numeric'
import type { CalcChange } from './calcLinks'
import type { SignChartRow, SignLevel } from './signChartLinks'
import { levelName } from './signChartLinks'

interface Props {
  row: SignChartRow
  onCalcChange(change: CalcChange, live?: boolean): void
  onRemove(): void
}

/** What a typed field is prefilled with: the exact text, in the parser's spelling. */
function editable(text: string): string {
  return text.replace(/−/g, '-').replace(/π/g, 'pi').replace(/√(\d+)/g, 'sqrt($1)')
}

const AS_CHOICES: { as: SignLevel; title: string }[] = [
  { as: 'f', title: 'The graph shown is f itself' },
  { as: 'f1', title: 'The graph of f′ is shown: reason about the unseen f (AP)' },
  { as: 'f2', title: 'The graph of f″ is shown: concavity of the unseen f' },
]

export function SignChartSection({ row, onCalcChange, onRemove }: Props) {
  const [edit, setEdit] = useState<{ which: 'a' | 'b'; text: string; bad: boolean } | null>(null)
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const linkId = row.linkId
  const F = row.fName

  useEffect(() => {
    if (edit && inputRef.current && document.activeElement !== inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [edit])

  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(false), 1400)
    return () => window.clearTimeout(t)
  }, [copied])

  const commit = (): void => {
    if (!edit) return
    const v = parseNumeric(edit.text)
    if (v === null || !Number.isFinite(v)) {
      setEdit({ ...edit, bad: true })
      return
    }
    // A fresh interval opens one unit wide; an edited end keeps the other.
    const a = edit.which === 'a' ? v : (row.a ?? v - 1)
    const b = edit.which === 'b' ? v : (row.b ?? v + 1)
    if (a === b) {
      setEdit({ ...edit, bad: true })
      return
    }
    onCalcChange({ kind: 'signInterval', linkId, a, b })
    setEdit(null)
  }

  const field = (which: 'a' | 'b', shown: string): JSX.Element => {
    const title = `${which} — type -2, 1/2, pi …`
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
        <span className="calc-field-value">{shown || '…'}</span>
      </button>
    )
  }

  const toggleRow = (level: SignLevel): void => {
    const on = row.rows.includes(level)
    const rows = row.available.filter((l) => (l === level ? !on : row.rows.includes(l)))
    onCalcChange({ kind: 'signRows', linkId, rows })
  }

  const copy = (): void => {
    const text = row.plain
    try {
      void navigator.clipboard?.writeText(text).then(
        () => setCopied(true),
        () => setCopied(false),
      )
    } catch {
      /* no clipboard: nothing to do */
    }
  }

  const summary = row.rows.length > 0 ? row.rows.map((l) => levelName(l, F)).join(', ') : 'statements only'

  return (
    <CardSection
      kind="signchart"
      title="Sign chart"
      titleHint={row.title}
      summary={row.as === 'f' ? summary : `graph is ${levelName(row.as, F)} · ${summary}`}
      actions={<SectionDrop what="sign chart" onRemove={onRemove} />}
      className="calc-row signchart-row"
      data={{ link: linkId }}
      answerKey={calcKey(linkId)}
    >
      <div className="calc-controls signchart-as" role="group" aria-label="What this graph is">
        <span className="calc-field-label">graph is</span>
        {AS_CHOICES.map((c) => (
          <button
            key={c.as}
            type="button"
            className={`calc-chip${row.as === c.as ? ' calc-chip-on' : ''}`}
            aria-pressed={row.as === c.as}
            title={c.title.replace(/\bf\b/g, F)}
            onClick={() => onCalcChange({ kind: 'signAs', linkId, as: c.as })}
          >
            {levelName(c.as, F)}
          </button>
        ))}
      </div>

      <div className="calc-controls" role="group" aria-label="Strips on the board">
        <span className="calc-field-label">rows</span>
        {row.available.map((l) => (
          <button
            key={l}
            type="button"
            className={`calc-chip${row.rows.includes(l) ? ' calc-chip-on' : ''}`}
            aria-pressed={row.rows.includes(l)}
            title={`Show the sign of ${levelName(l, F)} as a strip along the bottom of the board`}
            onClick={() => toggleRow(l)}
          >
            {levelName(l, F)}
          </button>
        ))}
        {row.as !== 'f2' && (
          <button
            type="button"
            className={`calc-chip${row.arrows ? ' calc-chip-on' : ''}`}
            aria-pressed={row.arrows}
            title={`A row of arrows: where ${F} increases ↗ and decreases ↘`}
            onClick={() => onCalcChange({ kind: 'signFlag', linkId, flag: 'arrows', on: !row.arrows })}
          >
            ↗↘
          </button>
        )}
        <button
          type="button"
          className={`calc-chip${row.cup ? ' calc-chip-on' : ''}`}
          aria-pressed={row.cup}
          title={`A row of cups: where the graph of ${F} is concave up ∪ and down ∩`}
          onClick={() => onCalcChange({ kind: 'signFlag', linkId, flag: 'cup', on: !row.cup })}
        >
          ∪∩
        </button>
        <button
          type="button"
          className={`calc-chip${row.guides ? ' calc-chip-on' : ''}`}
          aria-pressed={row.guides}
          title="Dashed guides from each critical x up through the graph"
          onClick={() => onCalcChange({ kind: 'signFlag', linkId, flag: 'guides', on: !row.guides })}
        >
          guides
        </button>
      </div>

      {row.problem && <div className="calc-why">{`Nothing is drawn: ${row.problem}.`}</div>}

      {row.chart.length > 0 && (
        <Answer k={calcKey(linkId)} block what="the sign chart">
        <div className="signchart-mini" aria-label="The sign chart">
          {row.chart.map((r, i) => (
            <div key={`${r.level}-${i}`} className="signchart-line">
              <span className="signchart-label">{r.label}</span>
              <span className="signchart-cells">
                {r.cells.map((c, j) =>
                  c.kind === 'sign' ? (
                    <span
                      key={j}
                      className={`signchart-sign${c.sign === 1 ? ' is-pos' : c.sign === -1 ? ' is-neg' : ''}`}
                    >
                      {c.text}
                    </span>
                  ) : c.kind === 'more' ? (
                    <span key={j} className="signchart-more" title="The signs keep changing past the view">
                      …
                    </span>
                  ) : (
                    <span key={j} className="signchart-mark">
                      <span className="signchart-x">{c.x}</span>
                      {c.at && <span className="signchart-at">{c.at}</span>}
                    </span>
                  ),
                )}
              </span>
            </div>
          ))}
        </div>
        </Answer>
      )}

      {row.conclusions.length > 0 && (
        <div className="secant-block">
          <div className="signchart-head">
            <span className="secant-block-title">Conclusions</span>
            <button
              type="button"
              className={`calc-chip${copied ? ' calc-chip-on' : ''}`}
              title="Copy the chart and the statements as plain text"
              onClick={copy}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <Answer k={calcKey(linkId)} block quiet={row.chart.length > 0} what="the conclusions">
          <ul className="calc-facts signchart-facts">
            {row.conclusions.map((c, i) => (
              <li key={i} className={`calc-fact signchart-fact signchart-${c.kind}`}>
                {c.text}
              </li>
            ))}
          </ul>
          </Answer>
        </div>
      )}

      {row.as !== 'f2' && (
        <div className="calc-controls" role="group" aria-label="Candidates Test interval">
          <span className="calc-field-label" title="The absolute extrema on a closed interval [a, b]">
            Candidates on
          </span>
          {field('a', row.aText)}
          {field('b', row.bText)}
          {row.a !== null && (
            <button
              type="button"
              className="calc-chip"
              title="Clear the interval"
              onClick={() => onCalcChange({ kind: 'signInterval', linkId, a: null, b: null })}
            >
              clear
            </button>
          )}
        </div>
      )}
    </CardSection>
  )
}

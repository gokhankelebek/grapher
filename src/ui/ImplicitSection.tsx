// ============================================================================
// src/ui/ImplicitSection.tsx — one tangent on an implicit curve, as the
// CURVE's card shows it: implicit differentiation, the AP Unit 3 way.
//
//   dy/dx = −F_x/F_y              simplified: −x/y, (2y − x²)/(y² − 2x)
//   dy/dx at (3, 4) = −3/4        exact when it is
//   tangent line                  y − 4 = −3/4 (x − 3); x = 5 when vertical
//   horizontal / vertical tangents   the points, exact where exact, and a
//                                 switch that marks them on the board
//   d²y/dx²                       folded: the quotient rule's answer and,
//                                 with the relation used, −25/y³
//
// Everything arrives computed (src/ui/implicitLinks.ts → ImplicitRow); every
// edit leaves as one CalcChange. Kept here: the x being typed, and whether
// d²y/dx² is unfolded.
// ============================================================================

import { useEffect, useRef, useState } from 'react'
import { Latex } from './Latex'
import { Answer, AnswerTex } from './RevealAnswer'
import { calcKey } from './reveal'
import { CardSection, SectionDrop } from './CardSection'
import { parseNumeric } from './numeric'
import type { CalcChange, ImplicitRow } from './calcLinks'

interface Props {
  row: ImplicitRow
  onCalcChange(change: CalcChange, live?: boolean): void
  onRemove(): void
}

function editable(v: number): string {
  return String(Number(v.toFixed(6)))
}

export function ImplicitSection({ row, onCalcChange, onRemove }: Props) {
  const [edit, setEdit] = useState<{ text: string; bad: boolean } | null>(null)
  const [showD2, setShowD2] = useState(false)
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
    onCalcChange({ kind: 'tangentX', linkId, x: v })
    setEdit(null)
  }

  const summary = row.problem
    ? 'no tangent'
    : `${row.dydx ? `dy/dx = ${row.dydx.text} · ` : ''}at ${row.pointText}: ${row.slopeText}`

  /** Reveal mode: everything this section computes is one answer. */
  const ak = calcKey(linkId)

  const list = (label: string, pts: string[], cls: string): JSX.Element => (
    <li className={`calc-fact ${cls}`}>
      <span className="impl-label">{label}</span>{' '}
      {pts.length === 0 ? <span className="impl-none">none in view</span> : pts.join(', ')}
    </li>
  )

  return (
    <CardSection
      kind="implicit"
      title="Implicit differentiation"
      titleHint="dy/dx = −F_x / F_y, the tangent line at a point, horizontal and vertical tangents, d²y/dx²"
      summary={summary}
      actions={<SectionDrop what="tangent line" onRemove={onRemove} />}
      className="calc-row impl-row"
      data={{ link: linkId }}
      answerKey={ak}
    >
      <div
        className="secant-tex impl-dydx"
        data-testid="impl-dydx"
        title={row.dydx ? `dy/dx = ${row.dydx.text}` : 'dy/dx = −F_x / F_y'}
      >
        {row.dydx ? (
          <AnswerTex
            k={ak}
            tex={`\\frac{dy}{dx} = -\\frac{F_x}{F_y} = ${row.dydx.tex}`}
            question={`\\frac{dy}{dx} = -\\frac{F_x}{F_y}`}
            what="dy/dx"
          />
        ) : (
          <Latex tex={`\\frac{dy}{dx} = -\\frac{F_x}{F_y}`} />
        )}
      </div>
      {row.fx && row.fy && (
        <Answer k={ak} quiet>
          <div className="impl-partials" title="The partial derivatives: y held constant, then x held constant">
            <Latex tex={`F_x = ${row.fx.tex},\\quad F_y = ${row.fy.tex}`} />
          </div>
        </Answer>
      )}

      <div className="calc-controls impl-point">
        <span className="calc-tag">at</span>
        {edit ? (
          <span className="calc-field">
            <span className="calc-field-label">x</span>
            <input
              ref={inputRef}
              className={`calc-input${edit.bad ? ' param-edit-bad' : ''}`}
              type="text"
              spellCheck={false}
              aria-label="x — the point moves along its branch"
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
            data-testid="impl-x"
            title="Type an x — the point stays on its branch. Or drag the point along the curve."
            onClick={() => setEdit({ text: editable(row.x), bad: false })}
          >
            <span className="calc-field-value">{row.pointText}</span>
          </button>
        )}
      </div>

      {row.problem ? (
        <div className="calc-why">{`No line is drawn: ${row.problem}.`}</div>
      ) : (
        <>
          <div className="secant-tex impl-value" data-testid="impl-value" title={`dy/dx at ${row.pointText} ${row.slopeText.startsWith('≈') ? row.slopeText : `= ${row.slopeText}`}`}>
            <AnswerTex
              k={ak}
              what="the slope"
              tex={`\\left.\\frac{dy}{dx}\\right|_{${row.pointTex}} ${
                row.slopeTex === null
                  ? '\\text{ is undefined (vertical tangent)}'
                  : row.slopeTex.startsWith('\\approx')
                    ? row.slopeTex
                    : `= ${row.slopeTex}`
              }`}
            />
          </div>
          {row.line && (
            <div className="secant-line" data-testid="impl-line" title={`The tangent line at ${row.pointText}, point-slope form`}>
              <span className="secant-line-label">tangent line</span>
              <Answer k={ak} what="the tangent line">
                <Latex tex={row.line.tex} />
              </Answer>
            </div>
          )}
        </>
      )}

      <Answer k={ak} block quiet>
      <ul className="calc-facts impl-hv" data-testid="impl-hv">
        {list('horizontal tangents (F_x = 0):', row.horizontal, 'impl-h')}
        {list('vertical tangents (F_y = 0):', row.vertical, 'impl-v')}
        {row.singular.length > 0 && (
          <li className="calc-fact">
            <span className="impl-label">singular (F_x = F_y = 0):</span> {row.singular.join(', ')}
          </li>
        )}
      </ul>
      </Answer>
      <div className="calc-controls">
        <button
          type="button"
          className={`calc-chip${row.marks ? ' calc-chip-on' : ''}`}
          aria-pressed={row.marks}
          data-testid="impl-marks"
          title="Mark the horizontal and vertical tangent points on the board"
          onClick={() => onCalcChange({ kind: 'tangentMarks', linkId, on: !row.marks })}
        >
          mark on board
        </button>
        {row.d2 && (
          <button
            type="button"
            className={`calc-chip${showD2 ? ' calc-chip-on' : ''}`}
            aria-pressed={showD2}
            data-testid="impl-d2-toggle"
            title="The second derivative: the quotient rule on dy/dx, with dy/dx substituted — and the curve's own equation used"
            onClick={() => setShowD2((v) => !v)}
          >
            d²y/dx²
          </button>
        )}
      </div>
      {showD2 && row.d2 && (
        <Answer k={ak} block what="d²y/dx²">
        <div className="secant-block" data-testid="impl-d2">
          <div className="secant-tex">
            <Latex
              tex={`\\frac{d^2y}{dx^2} = ${row.d2.raw.tex}${row.d2.onCurve ? ` = ${row.d2.onCurve.tex}` : ''}`}
            />
          </div>
          {row.d2.onCurve && <div className="impl-note">using the curve's equation</div>}
          {row.d2.value !== null && !row.problem && (
            <div className="impl-note">
              at {row.pointText}: <span className="impl-k">{row.d2.value}</span>
            </div>
          )}
        </div>
        </Answer>
      )}
    </CardSection>
  )
}

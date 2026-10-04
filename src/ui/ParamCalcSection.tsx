// ============================================================================
// src/ui/ParamCalcSection.tsx — parametric and polar calculus on the curve's
// card (AP Calculus BC Unit 9).
//
//   ParamCalcSection     calculus at t: the derivatives written out, the chosen
//                        t (typed exactly: pi/4, 1, -2/3), everything at it,
//                        the horizontal / vertical tangents, the arc length
//                        (and displacement vs distance) over [a, b].
//   PolarBetweenSection  the area inside one polar curve and outside another:
//                        which curve, which way round, where they meet, the
//                        integral written out and its value.
//
// Everything it prints arrives computed (src/ui/paramCalcLinks.ts → the rows);
// every edit leaves as one CalcChange. The only state kept here is the field
// being typed into.
// ============================================================================

import { useEffect, useRef, useState } from 'react'
import { Latex } from './Latex'
import { Answer, AnswerTex } from './RevealAnswer'
import { calcKey } from './reveal'
import { CardSection, SectionDrop } from './CardSection'
import { parseNumeric } from './numeric'
import type { CalcChange } from './calcLinks'
import type { ParamCalcRow, PolarBetweenRow } from './paramCalcLinks'
import type { TangentPoint } from '../core/paramCalc'
import { entryHandlers } from './fieldEntry'

/** What a typed field is prefilled with: the exact text, in the parser's spelling. */
function editable(text: string): string {
  return text
    .replace(/−/g, '-')
    .replace(/(\d)π/g, '$1pi')
    .replace(/π/g, 'pi')
    .replace(/√(\d+)/g, 'sqrt($1)')
}

/** A click-to-edit number: shows its exact text, takes 1, -2, 1/2, pi/4 … */
function NumField({
  label,
  shown,
  title,
  onCommit,
}: {
  label: string
  shown: string
  title: string
  onCommit(v: number): void
}) {
  const [edit, setEdit] = useState<{ text: string; bad: boolean } | null>(null)
  const ref = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (edit && ref.current && document.activeElement !== ref.current) {
      ref.current.focus()
      ref.current.select()
    }
  }, [edit])
  const commit = (): void => {
    if (!edit) return
    const v = parseNumeric(edit.text)
    if (v === null) {
      setEdit({ ...edit, bad: true })
      return
    }
    onCommit(v)
    setEdit(null)
  }
  if (edit) {
    return (
      <span className="calc-field">
        <span className="calc-field-label">{label}</span>
        <input
          ref={ref}
          className={`calc-input${edit.bad ? ' param-edit-bad' : ''}`}
          type="text"
          spellCheck={false}
          aria-label={title}
          value={edit.text}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setEdit({ text: e.target.value, bad: false })}
          {...entryHandlers(commit, () => setEdit(null))}
        />
      </span>
    )
  }
  return (
    <button
      type="button"
      className="calc-field calc-field-btn"
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        setEdit({ text: editable(shown), bad: false })
      }}
    >
      <span className="calc-field-label">{label}</span>
      <span className="calc-field-value">{shown}</span>
    </button>
  )
}

function Readout({ label, value, k, ak }: { label: string; value: string; k: string; ak: string }) {
  return (
    <div className="mo-readout" data-readout={k}>
      <span className="mo-r-label">{label}</span>{' '}
      <Answer k={ak} what={label.replace(/\s*=$/, '')}>
        <span className="mo-r-value">{value}</span>
      </Answer>
    </div>
  )
}

function pointList(ps: TangentPoint[], v: string): string {
  return ps.map((p) => `${p.point} at ${v} = ${p.tText}`).join('; ')
}

// ============================================================================
// Calculus at t
// ============================================================================

interface Props {
  row: ParamCalcRow
  onCalcChange(change: CalcChange, live?: boolean): void
  onRemove(): void
}

export function ParamCalcSection({ row, onCalcChange, onRemove }: Props) {
  const linkId = row.linkId
  const v = row.v
  const polar = row.kind === 'polar'
  const at = row.at
  const d = polar ? 'dθ' : 'dt'
  const tl = row.tangents
  const arc = row.arc
  /** Reveal mode: everything this section computes is one answer. */
  const ak = calcKey(linkId)

  return (
    <CardSection
      kind="pcalc"
      title={polar ? 'Polar calculus' : 'Parametric calculus'}
      titleHint={polar ? 'dy/dx, dr/dθ, the tangent line and arc length of a polar curve' : 'dy/dx, d²y/dx², the tangent line, speed and arc length of a parametric curve'}
      summary={row.summary}
      actions={<SectionDrop what={polar ? 'polar calculus' : 'parametric calculus'} onRemove={onRemove} />}
      className="calc-row pcalc-row"
      testId="pcalc-section"
      data={{ link: linkId, kind: row.kind }}
      answerKey={ak}
    >
      {row.lines.length > 0 ? (
        <div className="pcalc-lines" data-testid="pcalc-lines">
          {row.lines.map((l, i) => (
            <div key={i} className="secant-tex pcalc-tex" title={l.text} aria-label={l.text}>
              <AnswerTex k={ak} tex={l.tex} />
            </div>
          ))}
        </div>
      ) : (
        <div className="calc-note pcalc-note">
          {polar
            ? 'Measured from the curve. Type it as r = … to see r′ and dy/dx written out.'
            : 'Measured from the curve. Type it as x = …, y = … to see dy/dx written out.'}
        </div>
      )}

      <div className="calc-controls">
        <NumField
          label={`${v} =`}
          shown={row.tText}
          title={`${v} — type 1, -2, 1/2, pi/4 …`}
          onCommit={(t) => onCalcChange({ kind: 'pcalcT', linkId, t })}
        />
      </div>
      {row.problem && <div className="calc-why">{`Nothing is drawn: ${row.problem}.`}</div>}

      {at && (
        <div className="mo-readouts pcalc-at" data-testid="pcalc-at">
          <Readout ak={ak} k="point" label="(x, y) =" value={at.point.text} />
          {polar && at.r && <Readout ak={ak} k="r" label="r =" value={at.r.text} />}
          {polar && at.dr && <Readout ak={ak} k="dr" label="dr/dθ =" value={at.dr.text} />}
          <Readout ak={ak} k="dx" label={`dx/d${v} =`} value={at.dx.text} />
          <Readout ak={ak} k="dy" label={`dy/d${v} =`} value={at.dy.text} />
          <Readout
            ak={ak}
            k="slope"
            label="dy/dx ="
            value={at.slope ? at.slope.text : at.vertical ? 'undefined (vertical tangent)' : 'undetermined (0/0)'}
          />
          {at.second && <Readout ak={ak} k="second" label="d²y/dx² =" value={at.second.text} />}
          <Readout ak={ak} k="speed" label="speed =" value={at.speed.text} />
          <Readout ak={ak} k="velocity" label="velocity" value={`⟨${at.velocity[0].text}, ${at.velocity[1].text}⟩`} />
          {at.acceleration && (
            <Readout ak={ak} k="accel" label="acceleration" value={`⟨${at.acceleration[0].text}, ${at.acceleration[1].text}⟩`} />
          )}
        </div>
      )}
      {at?.tangent && (
        <div className="secant-line pcalc-tangent" title="The tangent line at this point" data-testid="pcalc-tangent">
          <span className="secant-line-label">tangent line</span>
          <Answer k={ak} what="the tangent line">
            <Latex tex={at.tangent.tex} />
          </Answer>
        </div>
      )}
      {at && (at.drSentence || at.notes.length > 0) && (
        <Answer k={ak} block quiet>
        <ul className="calc-facts pcalc-notes">
          {at.drSentence && <li className="calc-fact calc-fact-lead">{at.drSentence}</li>}
          {at.notes.map((n, i) => (
            <li key={i} className="calc-fact">
              {n}
            </li>
          ))}
        </ul>
        </Answer>
      )}

      <div className="secant-block pcalc-block" data-testid="pcalc-tangents">
        <div className="secant-block-title pcalc-block-head">
          <span>Horizontal &amp; vertical tangents</span>
          <button
            type="button"
            className={`calc-chip${row.marks ? ' calc-chip-on' : ''}`}
            aria-pressed={row.marks}
            title="Mark the horizontal and vertical tangents (and any cusp) on the board"
            onClick={(e) => {
              e.stopPropagation()
              onCalcChange({ kind: 'pcalcMarks', linkId, on: !row.marks })
            }}
          >
            mark
          </button>
        </div>
        <Answer k={ak} block what="the tangents">
        <ul className="calc-facts">
          <li className="calc-fact">
            {tl.horizontal.length > 0
              ? `Horizontal (dy/d${v} = 0, dx/d${v} ≠ 0): ${pointList(tl.horizontal, v)}`
              : `No horizontal tangent on this interval.`}
          </li>
          <li className="calc-fact">
            {tl.vertical.length > 0
              ? `Vertical (dx/d${v} = 0, dy/d${v} ≠ 0): ${pointList(tl.vertical, v)}`
              : `No vertical tangent on this interval.`}
          </li>
          {tl.singular.map((s, i) => (
            <li key={i} className="calc-fact pcalc-singular">
              {`Both zero at ${v} = ${s.tText}, ${s.point}: ${(s.notes ?? []).slice(1).join(' ')}`}
            </li>
          ))}
        </ul>
        </Answer>
      </div>

      <div className="secant-block pcalc-block" data-testid="pcalc-arc">
        <div className="secant-block-title pcalc-block-head">
          <span>{polar ? 'Arc length' : 'Arc length · displacement vs distance'}</span>
        </div>
        <div className="calc-controls">
          <NumField
            label={`${v} from`}
            shown={arc ? arc.aVal.text : '—'}
            title={`Arc length from ${v} = …`}
            onCommit={(a) => onCalcChange({ kind: 'pcalcArc', linkId, a, b: arc ? arc.b : a + 1 })}
          />
          <NumField
            label="to"
            shown={arc ? arc.bVal.text : '—'}
            title={`Arc length to ${v} = …`}
            onCommit={(b) => onCalcChange({ kind: 'pcalcArc', linkId, a: arc ? arc.a : b - 1, b })}
          />
          {arc?.custom && (
            <button
              type="button"
              className="calc-chip"
              title="Back to the curve's whole interval"
              onClick={(e) => {
                e.stopPropagation()
                onCalcChange({ kind: 'pcalcArc', linkId, a: null, b: null })
              }}
            >
              whole curve
            </button>
          )}
        </div>
        {arc ? (
          <>
            <div className="secant-tex pcalc-tex" title={arc.integral.text} aria-label={arc.integral.text}>
              <AnswerTex k={ak} tex={arc.integral.tex} what="the arc length" />
            </div>
            {arc.displacement && (
              <Answer k={ak} block quiet>
              <ul className="calc-facts">
                <li className="calc-fact">
                  {`Displacement ⟨Δx, Δy⟩ = ⟨${arc.displacement.dx.text}, ${arc.displacement.dy.text}⟩, length ${arc.displacement.length.text}`}
                </li>
                <li className="calc-fact">{`Distance traveled = ∫ speed ${d} = L ${arc.length.exact ? '=' : '≈'} ${arc.length.text}`}</li>
                {arc.compare && <li className="calc-fact calc-fact-lead">{arc.compare}</li>}
              </ul>
              </Answer>
            )}
          </>
        ) : (
          <div className="calc-why">The arc length could not be measured on this interval.</div>
        )}
      </div>
    </CardSection>
  )
}

// ============================================================================
// Area between two polar curves
// ============================================================================

interface BetweenProps {
  row: PolarBetweenRow
  onCalcChange(change: CalcChange, live?: boolean): void
  onRemove(): void
}

export function PolarBetweenSection({ row, onCalcChange, onRemove }: BetweenProps) {
  const linkId = row.linkId
  const res = row.result
  return (
    <CardSection
      kind="pbetween"
      title="Area between polar curves"
      titleHint="½∫(R² − r²) dθ: inside one polar curve and outside another"
      summary={row.summary}
      actions={<SectionDrop what="area between polar curves" onRemove={onRemove} />}
      className="calc-row pbetween-row"
      testId="pbetween-section"
      data={{ link: linkId }}
      answerKey={calcKey(linkId)}
    >
      <div className="calc-line">
        <span className="calc-read calc-between" data-testid="pbetween-which">
          {row.outerLabel ? `inside ${row.outerLabel}, outside ${row.innerLabel}` : 'between two polar curves'}
        </span>
      </div>
      <div className="calc-controls">
        {row.choices.length > 1 && (
          <select
            className="xe-select"
            aria-label="The other polar curve"
            value={row.otherId}
            onClick={(e) => e.stopPropagation()}
            // the App turns the region the way round it exists
            onChange={(e) => onCalcChange({ kind: 'pbetweenOther', linkId, otherId: e.target.value, swap: false })}
          >
            {row.choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className={`calc-chip${row.swap ? ' calc-chip-on' : ''}`}
          aria-pressed={row.swap}
          title="Swap which curve is outside and which is inside"
          onClick={(e) => {
            e.stopPropagation()
            onCalcChange({ kind: 'pbetweenSwap', linkId, on: !row.swap })
          }}
        >
          swap inside / outside
        </button>
      </div>
      {row.meetings.length > 0 && (
        <Answer k={calcKey(linkId)} block what="where they meet">
        <ul className="calc-facts" data-testid="pbetween-meetings">
          <li className="calc-fact">
            {`${row.outerLabel} = ${row.innerLabel} at θ = ${row.meetings.map((m) => m.text).join(', ')}`}
          </li>
          {row.poleNote && <li className="calc-fact">{row.poleNote}</li>}
        </ul>
        </Answer>
      )}
      {row.aText !== null && row.bText !== null && (
        <div className="calc-controls">
          <NumField
            label="θ from"
            shown={row.aText}
            title="θ from — type pi/6 …"
            onCommit={(a) => onCalcChange({ kind: 'pbetweenBounds', linkId, a, b: res ? res.b : a + 1 })}
          />
          <NumField
            label="to"
            shown={row.bText}
            title="θ to — type 5pi/6 …"
            onCommit={(b) => onCalcChange({ kind: 'pbetweenBounds', linkId, a: res ? res.a : b - 1, b })}
          />
          {row.custom && (
            <button
              type="button"
              className="calc-chip"
              title="Back to where the curves meet"
              onClick={(e) => {
                e.stopPropagation()
                onCalcChange({ kind: 'pbetweenBounds', linkId, a: null, b: null })
              }}
            >
              where they meet
            </button>
          )}
        </div>
      )}
      {res && (
        <div className="secant-tex pcalc-tex" title={res.integral.text} aria-label={res.integral.text} data-testid="pbetween-integral">
          <AnswerTex k={calcKey(linkId)} tex={res.integral.tex} what="the area" />
        </div>
      )}
      {res && res.notes.length > 0 && (
        <Answer k={calcKey(linkId)} block quiet>
        <ul className="calc-facts">
          {res.notes.map((n, i) => (
            <li key={i} className="calc-fact">
              {n}
            </li>
          ))}
        </ul>
        </Answer>
      )}
      {row.problem && <div className="calc-why">{`Nothing is shaded: ${row.problem}.`}</div>}
    </CardSection>
  )
}

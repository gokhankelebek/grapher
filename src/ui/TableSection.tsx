// ============================================================================
// src/ui/TableSection.tsx — the Table section of an explicit curve's card.
//
//   x from [0] by [1] rows [6]     (or a list: −2, −1, 0, 1/2, π)
//   [Δy] [Δ²y] [ratio] [avg rate]
//   ┌────┬──────┬────┐
//   │ x  │ f(x) │ Δy │
//   │ 0  │ 1    │    │
//   │ 1  │ 3    │ 2  │ …
//   Δy is constant (2): linear
//   Evaluate [f(2.5)]  → f(2.5) = 6         [dot on graph]
//   Compare with [g ▾] → 2ˣ passes x³ after x ≈ 9.94 …
//   Divide by (x − a) [x + 2] → the synthetic-division tableau, the quotient,
//                                f(−2) = remainder = 0, (x + 2) is a factor
//   [Copy to a data table]  [show table on figure]
//
// Everything it prints arrives computed (src/ui/valueTableLinks.ts →
// TablePanel); every edit leaves as one patch of the curve's stored settings.
// The only state kept here is the text being typed into a field.
// ============================================================================

import { useEffect, useState } from 'react'
import type { ValueTableCol, ValueTableView } from '../core/persist'
import type { Cell } from '../core/valueTable'
import { CardSection } from './CardSection'
import { Latex } from './Latex'
import { Answer, AnswerText, RevealPill, useReveal } from './RevealAnswer'
import type { TablePanel, TableRowView } from './valueTableLinks'
import { COL_HEAD, COL_TITLE, TABLE_COLS, TABLE_N_MAX, TABLE_N_MIN, tableKey } from './valueTableLinks'

/** What the section can ask of the App. */
export interface TableActions {
  /** Change one curve's stored table settings; `undefined` / null clears a field. */
  patch(curveId: string, patch: Partial<Record<keyof ValueTableView, unknown>>): void
  /** "Copy to a data table": a new data table holding the rows. */
  copyToData(curveId: string): void
}

interface Props {
  panel: TablePanel
  actions: TableActions
}

/** A typed field that commits on Enter or blur and gives up on Escape. */
function Field({
  label,
  value,
  width,
  title,
  placeholder,
  onCommit,
  testId,
}: {
  label?: string
  value: string
  width?: number
  title: string
  placeholder?: string
  onCommit(text: string): void
  testId?: string
}) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <label className="calc-field vt-field" title={title}>
      {label && <span className="calc-field-label">{label}</span>}
      <input
        className="calc-input"
        style={width ? { width } : undefined}
        type="text"
        spellCheck={false}
        autoComplete="off"
        aria-label={title}
        placeholder={placeholder}
        data-testid={testId}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            if (text !== value) onCommit(text)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setText(value)
          }
        }}
        onBlur={() => {
          if (text !== value) onCommit(text)
        }}
      />
    </label>
  )
}

/** One table cell: a closed form says so (its decimal in the tooltip), a rounded decimal is marked. */
function CellText({ c, hidden }: { c: Cell | undefined; hidden: boolean }) {
  if (!c) return null
  if (hidden) return <span className="vt-q">?</span>
  const approx = !c.exact
  return (
    <span className={approx ? 'vt-approx' : undefined} title={approx ? `≈ ${c.text} (rounded)` : String(c.v)}>
      {c.text}
    </span>
  )
}

export function TableSection({ panel, actions }: Props) {
  const reveal = useReveal()
  const id = panel.curveId
  const s = panel.settings
  const patch = (p: Partial<Record<keyof ValueTableView, unknown>>): void => actions.patch(id, p)
  const kValues = tableKey(id, 'values')
  const kEval = tableKey(id, 'eval')
  const kCompare = tableKey(id, 'compare')
  const kDivide = tableKey(id, 'divide')
  const valuesHidden = reveal.on && reveal.hidden(kValues)
  const fx = `${panel.name}(x)`
  const gx = panel.compare ? `${panel.compare.otherName}(x)` : null
  const listMode = s.list !== null

  const toggleCol = (c: ValueTableCol): void => {
    const on = s.cols.includes(c)
    const next = on ? s.cols.filter((k) => k !== c) : [...s.cols, c]
    patch({ cols: next.length > 0 ? next : undefined })
  }

  const headCell = (c: ValueTableCol): string => COL_HEAD[c]
  const colCell = (r: TableRowView, c: ValueTableCol): Cell | undefined => r[c]

  return (
    <CardSection
      kind="table"
      title="Table"
      titleHint="Table of values: f(x) at chosen x's, differences and ratios, Evaluate, compare, divide"
      summary={panel.summary}
      defaultOpen={false}
      className="vt-section"
      testId="table-section"
    >
      {/* ---- which x's */}
      <div className="calc-controls">
        <select
          className="calc-select"
          aria-label="Which x values"
          title="x from a start by a step, or a list you type"
          value={listMode ? 'list' : 'step'}
          data-testid="table-mode"
          onChange={(e) =>
            e.target.value === 'list'
              ? patch({ list: panel.rows.map((r) => r.x.text).join(', ') })
              : patch({ list: undefined })
          }
        >
          <option value="step">x from … by …</option>
          <option value="list">a list of x’s</option>
        </select>
      </div>
      <div className="calc-controls">
        {listMode ? (
          <Field
            label="x ="
            value={s.list ?? ''}
            width={180}
            title="The x values, separated by commas: −2, −1, 0, 1/2, pi"
            placeholder="−2, −1, 0, 1/2, π"
            testId="table-list"
            onCommit={(t) => patch({ list: t })}
          />
        ) : (
          <>
            <Field
              label="x from"
              value={s.start}
              width={48}
              title="The first x — type 0, −2, 1/2 or pi/6"
              testId="table-start"
              onCommit={(t) => patch({ start: t.trim() === '' ? undefined : t })}
            />
            <Field
              label="by"
              value={s.step}
              width={48}
              title="The step — type 1, 0.5 or pi/6"
              testId="table-step"
              onCommit={(t) => patch({ step: t.trim() === '' ? undefined : t })}
            />
            <label className="calc-field vt-field" title={`How many rows (${TABLE_N_MIN}–${TABLE_N_MAX})`}>
              <span className="calc-field-label">rows</span>
              <input
                className="calc-input"
                style={{ width: 40 }}
                type="number"
                min={TABLE_N_MIN}
                max={TABLE_N_MAX}
                aria-label="Rows"
                data-testid="table-n"
                value={s.n}
                onKeyDown={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value))
                  if (Number.isFinite(n) && n >= TABLE_N_MIN && n <= TABLE_N_MAX) patch({ n })
                }}
              />
            </label>
          </>
        )}
      </div>
      <div className="calc-controls" role="group" aria-label="Columns">
        {TABLE_COLS.map((c) => (
          <button
            key={c}
            type="button"
            className={`calc-chip${s.cols.includes(c) ? ' calc-chip-on' : ''}`}
            aria-pressed={s.cols.includes(c)}
            title={COL_TITLE[c]}
            data-testid={`table-col-${c}`}
            onClick={() => toggleCol(c)}
          >
            {headCell(c)}
          </button>
        ))}
      </div>

      {panel.error && <div className="calc-why">{panel.error}</div>}

      {/* ---- the table */}
      {panel.rows.length > 0 && (
        <div className="vt-table-wrap">
          {valuesHidden && (
            <div className="reveal-pill-row">
              <RevealPill k={kValues} what="the table’s values" />
            </div>
          )}
          <table className="limit-table vt-table" data-testid="value-table">
            <thead>
              <tr>
                <th>x</th>
                <th>{fx}</th>
                {gx && <th>{gx}</th>}
                {panel.cols.map((c) => (
                  <th key={c} title={COL_TITLE[c]}>
                    {headCell(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {panel.rows.map((r, i) => (
                <tr key={i} className={r.flip && !valuesHidden ? 'vt-flip' : undefined}>
                  <td>{r.x.text}</td>
                  <td className={r.lead === 'f' && !valuesHidden ? 'vt-lead' : undefined}>
                    <CellText c={r.y} hidden={valuesHidden} />
                  </td>
                  {gx && (
                    <td className={r.lead === 'g' && !valuesHidden ? 'vt-lead' : undefined}>
                      <CellText c={r.g} hidden={valuesHidden} />
                    </td>
                  )}
                  {panel.cols.map((c) => (
                    <td key={c} className="vt-diff">
                      <CellText c={colCell(r, c)} hidden={valuesHidden} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {panel.pattern && (
        <Answer k={kValues} block quiet>
          <div className="calc-fact calc-fact-lead vt-pattern" data-testid="table-pattern">
            {panel.pattern.text}
          </div>
        </Answer>
      )}

      {/* ---- Evaluate (F-IF.2) */}
      <div className="secant-block">
        <div className="secant-block-title">Evaluate</div>
        <div className="calc-controls">
          <Field
            value={s.ev}
            width={150}
            title={`Type ${panel.name}(2.5), or an expression of the board’s functions: f(−3) + g(2)`}
            placeholder={`${panel.name}(2.5)`}
            testId="table-eval"
            onCommit={(t) => patch({ ev: t.trim() === '' ? undefined : t })}
          />
          {panel.evaluate?.ok && panel.evaluate.point && (
            <button
              type="button"
              className={`calc-chip${s.dot ? ' calc-chip-on' : ''}`}
              aria-pressed={s.dot}
              title="The point (a, f(a)) on the graph, with dashed guides to both axes"
              data-testid="table-eval-dot"
              onClick={() => patch({ dot: s.dot ? false : undefined })}
            >
              dot on graph
            </button>
          )}
        </div>
        {panel.evaluate && (
          <div className="calc-read vt-eval" data-testid="table-eval-result">
            {panel.evaluate.ok ? (
              <AnswerText k={kEval} text={panel.evaluate.text} what="the value" />
            ) : (
              <span className="calc-why">{panel.evaluate.error}</span>
            )}
          </div>
        )}
      </div>

      {/* ---- Compare (F-IF.9, F-LE.3) */}
      {panel.others.length > 0 && (
        <div className="secant-block">
          <div className="secant-block-title">Compare</div>
          <div className="calc-controls">
            <select
              className="calc-select"
              aria-label="Compare with another function"
              title="Put another function's values beside these, and find where one overtakes the other"
              value={s.vs ?? ''}
              data-testid="table-compare"
              onChange={(e) => patch({ vs: e.target.value === '' ? undefined : e.target.value })}
            >
              <option value="">compare with…</option>
              {panel.others.map((o) => (
                <option key={o.id} value={o.id}>
                  {`${o.name}(x)`}
                </option>
              ))}
            </select>
          </div>
          {panel.compare && (panel.compare.sentence || panel.compare.crossings || panel.compare.avg) && (
            <Answer k={kCompare} block what="the comparison">
              <ul className="calc-facts vt-compare" data-testid="table-compare-result">
                {panel.compare.sentence && <li className="calc-fact calc-fact-lead">{panel.compare.sentence}</li>}
                {panel.compare.crossings && <li className="calc-fact">{panel.compare.crossings}</li>}
                {panel.compare.avg && <li className="calc-fact">{panel.compare.avg}</li>}
              </ul>
            </Answer>
          )}
        </div>
      )}

      {/* ---- the Remainder Theorem (A-APR.2), for a polynomial */}
      {panel.division && (
        <div className="secant-block">
          <div className="secant-block-title">Divide by (x − a)</div>
          <div className="calc-controls">
            <Field
              label="a or divisor"
              value={s.div}
              width={80}
              title="Type a (−2, 1/3) or the divisor (x + 2): synthetic division and the Remainder Theorem"
              placeholder="x + 2"
              testId="table-divide"
              onCommit={(t) => patch({ div: t.trim() === '' ? undefined : t })}
            />
          </div>
          {panel.division.error && <div className="calc-why">{panel.division.error}</div>}
          {panel.division.work && (
            <Answer k={kDivide} block what="the division">
              <div className="vt-division" data-testid="table-division">
                <table className="vt-synth" aria-label="Synthetic division">
                  <tbody>
                    <tr>
                      <td className="vt-synth-a">{panel.division.work.a.text}</td>
                      {panel.division.coeffs.map((c, i) => (
                        <td key={i} className={i === panel.division!.coeffs.length - 1 ? 'vt-synth-last' : undefined}>
                          {c.text}
                        </td>
                      ))}
                    </tr>
                    <tr className="vt-synth-products">
                      <td className="vt-synth-a" />
                      <td />
                      {panel.division.work.products.map((c, i) => (
                        <td key={i} className={i === panel.division!.work!.products.length - 1 ? 'vt-synth-last' : undefined}>
                          {c.text}
                        </td>
                      ))}
                    </tr>
                    <tr className="vt-synth-bottom">
                      <td className="vt-synth-a vt-synth-blank" />
                      {panel.division.work.bottom.map((c, i) => (
                        <td
                          key={i}
                          className={i === panel.division!.work!.bottom.length - 1 ? 'vt-synth-last vt-synth-rem' : undefined}
                        >
                          {c.text}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
                <ul className="calc-facts">
                  <li className="calc-fact">{`Quotient: ${panel.division.work.quotient.text}`}</li>
                  <li className="calc-fact calc-fact-lead" data-testid="table-remainder">
                    {panel.division.work.statement}
                  </li>
                  <li className={`calc-fact${panel.division.work.factor ? ' calc-fact-lead' : ''}`}>
                    {panel.division.work.verdict}
                  </li>
                </ul>
                <div className="limit-tex">
                  <Latex tex={panel.division.work.identity} />
                </div>
              </div>
            </Answer>
          )}
        </div>
      )}

      {/* ---- out of the card */}
      <div className="calc-controls vt-footer">
        <button
          type="button"
          className="calc-chip"
          title="A new data table holding these (x, f(x)) rows — for a scatter plot or a regression"
          data-testid="table-copy-data"
          disabled={panel.rows.length === 0}
          onClick={() => actions.copyToData(id)}
        >
          Copy to a data table
        </button>
        <button
          type="button"
          className={`calc-chip${s.fig ? ' calc-chip-on' : ''}`}
          aria-pressed={s.fig}
          title="Draw this table on the figure, so it goes into exports and worksheets"
          data-testid="table-figure"
          onClick={() => patch({ fig: s.fig ? undefined : true })}
        >
          show table on figure
        </button>
      </div>
    </CardSection>
  )
}

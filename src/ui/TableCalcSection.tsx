// ============================================================================
// src/ui/TableCalcSection.tsx — "Calculus on this table", on a data table's card.
//
//   ▸ CALCULUS ON THIS TABLE   sum · r′(7) · average
//
//   [Σ sum] [r′(c) ≈] [average value] [MVT] [IVT]
//   ☐ r is differentiable on [0, 12]
//   RIEMANN / TRAPEZOIDAL SUM   [L] [R] [M] [T]   from [0 ▾] to [12 ▾]
//     L₄ = Σ r(tₖ₋₁)Δtₖ = (2)(4.3) + (3)(5.0) + … = 68.5
//     Δt₁ = 2, Δt₂ = 3 …   ∫₀¹² r(t) dt ≈ 68.5 gallons
//     If r is increasing on [0, 12], the left sum L₄ is an underestimate …
//
// Everything printed arrives computed (src/ui/tableCalcLinks.ts → the card);
// every choice leaves as the table's next settings (onCalc). The only state
// kept here is a field being typed into. In reveal mode the Σ form, the
// interval and the hypotheses stay — they are the question — and every value
// is a Reveal pill (src/ui/RevealAnswer.tsx).
// ============================================================================

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Latex } from './Latex'
import { Answer, AnswerTex } from './RevealAnswer'
import { CardSection } from './CardSection'
import { entryHandlers } from './fieldEntry'
import type { BoardData, TableCalcView } from '../core/persist'
import type { SumMethod } from '../core/tableCalc'
import { SUM_LETTER, SUM_METHODS, SUM_NAME } from '../core/tableCalc'
import type { TableCalcCard, TableCalcNext, TableCalcPart } from './tableCalcLinks'
import { partOn, tableCalcKey, turnOff, turnOn, typedNum } from './tableCalcLinks'

interface Props {
  data: BoardData
  card: TableCalcCard
  /** The table's next settings (undefined: every tool off), with an undo label. */
  onCalc(next: TableCalcNext, label: string): void
  /** "Sort by x": reorder the rows so x increases. */
  onSort(): void
}

const stop = (e: { stopPropagation(): void }): void => e.stopPropagation()

const TOOL_CHIP: Record<TableCalcPart, (fn: string) => string> = {
  sum: () => 'Σ sum',
  deriv: (f) => `${f}′(c) ≈`,
  avg: () => 'average value',
  mvt: () => 'MVT',
  ivt: () => 'IVT',
}

const TOOL_HINT: Record<TableCalcPart, string> = {
  sum: 'A left, right, midpoint or trapezoidal sum over any rows, unequal widths and all, written out term by term (AP 6.2, 6.3)',
  deriv: 'Estimate the derivative at c by the difference quotient of the rows around it (AP 2.1, 2.3)',
  avg: 'The average value on [a, b]: a trapezoidal sum divided by b − a (AP 8.1)',
  mvt: 'Must the rate equal the average rate of change somewhere? The Mean Value Theorem, when its hypothesis is granted (AP 5.1)',
  ivt: 'Must the function take a value between two table values? The Intermediate Value Theorem, when its hypothesis is granted (AP 1.16)',
}

export function TableCalcSection({ data, card, onCalc, onSort }: Props) {
  const v: TableCalcView = data.calc ?? {}
  const f = card.fn
  const t = card.arg
  const key = (p: TableCalcPart): string => tableCalcKey(data.id, p)

  const toggle = (p: TableCalcPart): void => {
    // worked out from the table as it is when the change lands, so quick clicks add up
    if (partOn(v, p)) onCalc((d) => turnOff(d.calc, p), `hide ${TOOL_CHIP[p](f)}`)
    else onCalc((d) => (partOn(d.calc, p) ? d.calc : turnOn(d, p)), `table ${TOOL_CHIP[p](f)}`)
  }

  const set = (patch: TableCalcView, label: string): void => {
    onCalc((d) => ({ ...(d.calc ?? {}), ...patch }), label)
  }

  /** An interval's settings: an end at the table's own end is not stored. */
  const ends = (i: number, j: number): { a?: number; b?: number } => {
    const out: { a?: number; b?: number } = {}
    if (i > 0) out.a = card.xs[i].v
    if (j < card.xs.length - 1) out.b = card.xs[j].v
    return out
  }

  const summary = card.any
    ? [
        v.sum ? `${SUM_LETTER[v.sum.m ?? 'left']} sum` : '',
        v.der ? `${f}′(${v.der.c.trim()})` : '',
        v.avg ? 'average' : '',
        v.mvt ? 'MVT' : '',
        v.ivt ? 'IVT' : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : 'sums, rates, average value, IVT / MVT'

  return (
    <CardSection
      kind="table-calc"
      title="Calculus on this table"
      titleHint="Riemann and trapezoidal sums with unequal widths, a derivative estimate, the average value, and the IVT / MVT — from the rows alone"
      summary={summary}
      defaultOpen={card.any}
      testId="table-calc"
    >
      {!card.read.ok ? (
        <div className="field-hint" data-testid="table-calc-wait">
          {card.read.text}
          {card.read.canSort && (
            <>
              {' '}
              <button
                type="button"
                className="calc-chip"
                data-testid="table-calc-sort"
                title="Reorder the rows so x increases down the table (one undo step)"
                onClick={(e) => {
                  stop(e)
                  onSort()
                }}
              >
                Sort by {t}
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="calc-controls" role="group" aria-label="Calculus tools">
            {(['sum', 'deriv', 'avg', 'mvt', 'ivt'] as const).map((p) => {
              const on = partOn(v, p)
              return (
                <button
                  key={p}
                  type="button"
                  className={`calc-chip${on ? ' calc-chip-on' : ''}`}
                  aria-pressed={on}
                  data-testid={`table-calc-${p}`}
                  title={TOOL_HINT[p]}
                  onClick={(e) => {
                    stop(e)
                    toggle(p)
                  }}
                >
                  {TOOL_CHIP[p](f)}
                </button>
              )
            })}
          </div>

          {(v.mvt || v.ivt) && (
            <label className="te-check" onClick={stop} title="A table cannot show continuity or differentiability: tick this only when the problem states it">
              <input
                type="checkbox"
                checked={card.diff}
                data-testid="table-calc-diff"
                onChange={() => set({ diff: card.diff ? undefined : true }, card.diff ? `${f} not granted differentiable` : `${f} is differentiable`)}
              />
              <span>
                {f} is differentiable on {card.span}
              </span>
            </label>
          )}

          {card.sum && (
            <Block title="Riemann / trapezoidal sum" testId="table-calc-sum-block">
              <div className="calc-controls">
                <span className="tc-seg" role="group" aria-label="Method">
                  {SUM_METHODS.map((m) => {
                    const on = card.sum?.method === m
                    const why = card.sum?.others.find((o) => o.method === m)?.why ?? null
                    return (
                      <button
                        key={m}
                        type="button"
                        className={`calc-chip${on ? ' calc-chip-on' : ''}${why ? ' tc-unavailable' : ''}`}
                        aria-pressed={on}
                        data-testid={`table-calc-m-${m}`}
                        title={why ?? `The ${SUM_NAME[m]}`}
                        onClick={(e) => {
                          stop(e)
                          const next: { m?: SumMethod; a?: number; b?: number } = { ...(v.sum ?? {}) }
                          if (m === 'left') delete next.m
                          else next.m = m
                          set({ sum: next }, SUM_NAME[m])
                        }}
                      >
                        {SUM_LETTER[m]}
                      </button>
                    )
                  })}
                </span>
                <Range
                  card={card}
                  i={card.sum.i}
                  j={card.sum.j}
                  what="sum"
                  onPick={(i, j) => set({ sum: { ...(v.sum?.m ? { m: v.sum.m } : {}), ...ends(i, j) } }, 'sum interval')}
                />
              </div>
              {card.sum.lost && <div className="field-hint">{card.sum.lost}</div>}
              {card.sum.result.ok ? (
                <>
                  <div className="secant-tex tc-tex" title={card.sum.result.text} aria-label={card.sum.result.text}>
                    <AnswerTex k={key('sum')} tex={card.sum.tex ?? ''} question={card.sum.result.sigmaTex} what="the sum" />
                  </div>
                  <div className="field-hint tc-index">
                    {t}₀, {t}₁, … are the table’s {t} values in order.
                  </div>
                  <Answer k={key('sum')} block what="the sum" quiet>
                    <div className="secant-tex">
                      <Latex tex={card.sum.result.widthsTex} />
                    </div>
                    <div className="secant-tex" title={card.sum.result.integralText} aria-label={card.sum.result.integralText}>
                      <Latex tex={card.sum.result.integralTex} />
                    </div>
                    <ul className="calc-facts">
                      {card.sum.result.estimate && <li className="calc-fact">{card.sum.result.estimate}</li>}
                      <li className="calc-fact tc-others" data-testid="table-calc-others">
                        Same interval:{' '}
                        {card.sum.others.map((o) => (o.chip ? o.chip : `${SUM_LETTER[o.method]} unavailable`)).join(' · ')}
                      </li>
                    </ul>
                  </Answer>
                </>
              ) : (
                <div className="calc-why" data-testid="table-calc-sum-why">
                  {card.sum.result.why}
                </div>
              )}
            </Block>
          )}

          {card.deriv && (
            <Block title={`Derivative estimate: ${f}′(c)`} testId="table-calc-deriv-block">
              <div className="calc-controls">
                <TypedField
                  label="c"
                  title={`c — a ${t} from ${card.xs[0]?.text} to ${card.xs[card.xs.length - 1]?.text}`}
                  value={card.deriv.c}
                  testId="table-calc-c"
                  onCommit={(text) => set({ der: { c: text } }, `${f}′(${text})`)}
                />
              </div>
              {card.deriv.result.ok ? (
                <>
                  <div className="secant-tex tc-tex" title={card.deriv.result.text} aria-label={card.deriv.result.text}>
                    <AnswerTex k={key('deriv')} tex={card.deriv.result.tex} question={card.deriv.result.setupTex} what="the estimate" />
                  </div>
                  <div className="field-hint">{card.deriv.result.why}</div>
                </>
              ) : (
                <div className="calc-why">{card.deriv.result.why}</div>
              )}
            </Block>
          )}

          {card.avg && (
            <Block title="Average value" testId="table-calc-avg-block">
              <div className="calc-controls">
                <Range card={card} i={card.avg.i} j={card.avg.j} what="average" onPick={(i, j) => set({ avg: ends(i, j) }, 'average-value interval')} />
              </div>
              {card.avg.lost && <div className="field-hint">{card.avg.lost}</div>}
              {card.avg.result.ok ? (
                <>
                  <div className="secant-tex tc-tex">
                    <Latex tex={card.avg.result.setupTex} />
                  </div>
                  <Answer k={key('avg')} block what="the average value">
                    <div className="secant-tex tc-tex">
                      <Latex tex={card.avg.trapTex ?? ''} />
                    </div>
                    <div className="secant-tex tc-tex" title={card.avg.result.text} aria-label={card.avg.result.text}>
                      <Latex tex={card.avg.result.workTex} />
                    </div>
                  </Answer>
                </>
              ) : (
                <div className="calc-why">{card.avg.result.why}</div>
              )}
            </Block>
          )}

          {card.mvt && (
            <Block title="Mean Value Theorem" testId="table-calc-mvt-block">
              <div className="calc-controls">
                <Range card={card} i={card.mvt.i} j={card.mvt.j} what="pair" onPick={(i, j) => set({ mvt: ends(i, j) }, 'MVT rows')} />
              </div>
              {card.mvt.lost && <div className="field-hint">{card.mvt.lost}</div>}
              {card.mvt.result.ok ? (
                <Answer k={key('mvt')} block what="the Mean Value Theorem">
                  <div className={card.mvt.result.holds ? 'tc-statement' : 'calc-why'} data-testid="table-calc-mvt-text">
                    {card.mvt.result.statement}
                  </div>
                </Answer>
              ) : (
                <div className="calc-why">{card.mvt.result.why}</div>
              )}
            </Block>
          )}

          {card.ivt && (
            <Block title="Intermediate Value Theorem" testId="table-calc-ivt-block">
              <div className="calc-controls">
                <Range card={card} i={card.ivt.i} j={card.ivt.j} what="pair" onPick={(i, j) => set({ ivt: { ...ends(i, j), ...(v.ivt?.y ? { y: v.ivt.y } : {}) } }, 'IVT rows')} />
                <TypedField
                  label={`${f}(c) =`}
                  title={`The value ${f} should take between the two rows`}
                  value={card.ivt.y}
                  testId="table-calc-y"
                  onCommit={(text) => set({ ivt: { ...(v.ivt ?? {}), y: text } }, `${f}(c) = ${text}`)}
                />
              </div>
              {card.ivt.result.ok ? (
                <Answer k={key('ivt')} block what="the Intermediate Value Theorem">
                  <div className={card.ivt.result.holds ? 'tc-statement' : 'calc-why'} data-testid="table-calc-ivt-text">
                    {card.ivt.result.statement}
                  </div>
                </Answer>
              ) : (
                <div className="calc-why">{card.ivt.result.why}</div>
              )}
            </Block>
          )}
        </>
      )}
    </CardSection>
  )
}

function Block({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    <div className="secant-block tc-block" data-testid={testId}>
      <div className="secant-block-title">{title}</div>
      {children}
    </div>
  )
}

/** Two row pickers: an interval (sum, average) or a pair of rows (MVT, IVT). */
function Range({
  card,
  i,
  j,
  what,
  onPick,
}: {
  card: TableCalcCard
  i: number
  j: number
  what: string
  onPick(i: number, j: number): void
}) {
  const t = card.arg
  const pick = (which: 'a' | 'b', value: string): void => {
    const k = Number(value)
    if (!Number.isInteger(k)) return
    const ni = which === 'a' ? k : i
    const nj = which === 'b' ? k : j
    if (ni < nj) onPick(ni, nj)
  }
  return (
    <span className="tc-range">
      <span className="calc-tag">{what === 'pair' ? `${t} =` : 'from'}</span>
      <select
        className="calc-select"
        aria-label={what === 'pair' ? `First row (${t})` : `From ${t}`}
        data-testid={`table-calc-${what}-a`}
        value={String(i)}
        onClick={stop}
        onChange={(e) => pick('a', e.target.value)}
      >
        {card.xs.map((x, k) => (
          <option key={k} value={k} disabled={k >= j}>
            {x.text}
          </option>
        ))}
      </select>
      <span className="calc-tag">{what === 'pair' ? 'and' : 'to'}</span>
      <select
        className="calc-select"
        aria-label={what === 'pair' ? `Second row (${t})` : `To ${t}`}
        data-testid={`table-calc-${what}-b`}
        value={String(j)}
        onClick={stop}
        onChange={(e) => pick('b', e.target.value)}
      >
        {card.xs.map((x, k) => (
          <option key={k} value={k} disabled={k <= i}>
            {x.text}
          </option>
        ))}
      </select>
    </span>
  )
}

/** A click-to-type value (c, a target), committed on Enter, Tab or leaving it. */
function TypedField({
  label,
  title,
  value,
  testId,
  onCommit,
}: {
  label: string
  title: string
  value: string
  testId: string
  onCommit(text: string): void
}) {
  const [edit, setEdit] = useState<{ text: string; bad: boolean } | null>(null)
  const commit = (): void => {
    if (!edit) return
    const text = edit.text.trim()
    if (typedNum(text) === null) {
      setEdit({ ...edit, bad: true })
      return
    }
    if (text !== value) onCommit(text)
    setEdit(null)
  }
  if (edit) {
    return (
      <span className="calc-field">
        <span className="calc-field-label">{label}</span>
        <input
          className={`calc-input${edit.bad ? ' param-edit-bad' : ''}`}
          type="text"
          spellCheck={false}
          autoFocus
          aria-label={title}
          data-testid={`${testId}-input`}
          value={edit.text}
          onClick={stop}
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
      data-testid={testId}
      onClick={(e) => {
        stop(e)
        setEdit({ text: value, bad: false })
      }}
    >
      <span className="calc-field-label">{label}</span>
      <span className="calc-field-value">{value.replace(/-/g, '−') || '—'}</span>
    </button>
  )
}
